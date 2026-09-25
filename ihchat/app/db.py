"""Engine, sessao e base declarativa do SQLAlchemy."""
from __future__ import annotations

from collections.abc import Iterator

import json

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.schema import CreateIndex, CreateTable
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import obter_config


class Base(DeclarativeBase):
    pass


def _criar_engine(url: str):
    kwargs: dict = {"future": True, "pool_pre_ping": True}
    if url.startswith("sqlite"):
        # necessario porque o FastAPI atende requisicoes em threads distintas
        kwargs["connect_args"] = {"check_same_thread": False}
    return create_engine(url, **kwargs)


engine = _criar_engine(obter_config().banco_url)
SessaoLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, class_=Session)


@event.listens_for(engine, "connect")
def _ativar_chaves_estrangeiras(dbapi_connection, _record):  # pragma: no cover - trivial
    if engine.dialect.name == "sqlite":
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def criar_tabelas() -> None:
    from . import models  # noqa: F401  - registra os modelos no metadata

    Base.metadata.create_all(bind=engine)
    migrar_chat_interno(engine)


# ------------------------------------------------------- chat interno: subida
# Tabelas do chat que precisam de AUTOINCREMENT no SQLite (ver models.py).
TABELAS_AUTOINCREMENTO = ("interno_salas", "interno_mensagens")


def migrar_chat_interno(motor) -> list[str]:
    """Acerta uma base do chat interno criada antes das correções (idempotente).

    - interno_membros.visivel_desde (coluna nova): o create_all não mexe em
      tabela que já existe. 0 nas linhas antigas = continuam vendo tudo.
    - No SQLite, interno_salas e interno_mensagens sem AUTOINCREMENT são
      reconstruídas: não há ALTER TABLE que o acrescente.
    Devolve o que foi feito (vazio quando a base já está em dia).
    """
    feitas: list[str] = []
    inspetor = inspect(motor)
    tabelas = set(inspetor.get_table_names())
    if "interno_membros" in tabelas and "visivel_desde" not in {
        c["name"] for c in inspetor.get_columns("interno_membros")
    }:
        with motor.begin() as conexao:
            conexao.execute(text("ALTER TABLE interno_membros ADD COLUMN visivel_desde INTEGER NOT NULL DEFAULT 0"))
        feitas.append("interno_membros.visivel_desde")
    if motor.dialect.name == "sqlite":
        feitas += _reconstruir_com_autoincremento(motor)
    return feitas


def _reconstruir_com_autoincremento(motor) -> list[str]:
    """Recria as tabelas do chat com AUTOINCREMENT, mantendo ids e dados.

    Sem ele o SQLite reaproveita o maior id apagado: o grupo esvaziado (o
    último criado) cedia o id à próxima sala, e os eventos dele que ficaram
    na fila chegavam a quem estava na sala nova. O roteiro é o da
    documentação do SQLite (criar a nova, copiar, apagar a velha, renomear),
    com as chaves estrangeiras desligadas: apagar interno_salas com elas
    ligadas levaria membros e mensagens junto (ON DELETE CASCADE).
    """
    with motor.connect() as conexao:
        ddl = dict(
            conexao.execute(
                text("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('interno_salas', 'interno_mensagens')")
            ).all()
        )
    faltam = [t for t in TABELAS_AUTOINCREMENTO if t in ddl and "AUTOINCREMENT" not in (ddl[t] or "").upper()]
    if not faltam:
        return []
    bruta = motor.raw_connection()
    try:
        banco = bruta.driver_connection
        isolamento = banco.isolation_level
        # BEGIN e COMMIT explícitos: o PRAGMA das chaves é ignorado dentro de transação
        banco.isolation_level = None
        cursor = banco.cursor()
        cursor.execute("PRAGMA foreign_keys=OFF")
        try:
            cursor.execute("BEGIN IMMEDIATE")
            try:
                for nome in faltam:
                    _reconstruir(cursor, motor, nome)
                sanear_eventos_de_salas_apagadas(cursor)
                cursor.execute("COMMIT")
            except Exception:
                cursor.execute("ROLLBACK")
                raise
        finally:
            cursor.execute("PRAGMA foreign_keys=ON")
            banco.isolation_level = isolamento
    finally:
        bruta.close()
    return [f"{nome}: AUTOINCREMENT" for nome in faltam]


def _reconstruir(cursor, motor, nome: str) -> None:
    tabela = Base.metadata.tables[nome]
    nova = f"{nome}_nova"
    # o DDL do modelo (já com AUTOINCREMENT) com o nome provisório; nomes fixos daqui, nada a escapar
    criar = str(CreateTable(tabela).compile(dialect=motor.dialect)).replace(
        f"CREATE TABLE {nome} (", f"CREATE TABLE {nova} (", 1
    )
    antigas = {linha[1] for linha in cursor.execute(f"PRAGMA table_info({nome})").fetchall()}
    colunas = ", ".join(c.name for c in tabela.columns if c.name in antigas)
    cursor.execute(f"DROP TABLE IF EXISTS {nova}")
    cursor.execute(criar)
    cursor.execute(f"INSERT INTO {nova} ({colunas}) SELECT {colunas} FROM {nome}")
    cursor.execute(f"DROP TABLE {nome}")
    cursor.execute(f"ALTER TABLE {nova} RENAME TO {nome}")
    for indice in tabela.indexes:  # os índices saíram com a tabela velha
        cursor.execute(str(CreateIndex(indice).compile(dialect=motor.dialect)))


def sanear_eventos_de_salas_apagadas(cursor) -> int:
    """Esvazia na fila os eventos "interno.*" de salas que não existem mais.

    Numa base antiga, um grupo apagado antes desta correção deixou os eventos
    (com o texto) e pode ter cedido o id a uma sala nova. Vira
    "interno.removido" sem dados: o filtro não entrega a ninguém, e a linha
    fica (apagar abriria uma lacuna de id que faz o cursor esperar).
    """
    from .servicos.chat_interno import TIPO_REMOVIDO

    tabelas = {linha[0] for linha in cursor.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()}
    if "fila_eventos" not in tabelas:
        return 0
    salas = {linha[0] for linha in cursor.execute("SELECT id FROM interno_salas").fetchall()}
    orfaos = []
    for evento_id, dados in cursor.execute(
        "SELECT id, dados FROM fila_eventos WHERE tipo LIKE 'interno.%' AND tipo <> ?", (TIPO_REMOVIDO,)
    ).fetchall():
        try:
            lido = json.loads(dados)
        except (TypeError, ValueError):
            lido = None
        sala_id = lido.get("sala_id") if isinstance(lido, dict) else None
        if isinstance(sala_id, int) and sala_id not in salas:
            orfaos.append(evento_id)
    for evento_id in orfaos:
        cursor.execute("UPDATE fila_eventos SET tipo = ?, dados = '{}' WHERE id = ?", (TIPO_REMOVIDO, evento_id))
    return len(orfaos)


def obter_sessao() -> Iterator[Session]:
    """Dependencia do FastAPI: uma sessao por requisicao."""
    sessao = SessaoLocal()
    try:
        yield sessao
        sessao.commit()
    except Exception:
        sessao.rollback()
        raise
    finally:
        sessao.close()

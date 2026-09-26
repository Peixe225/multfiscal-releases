"""Modelos de dominio do IHchat.

A ideia central e que *um contato* pode falar por varios canais. Por isso a
identidade externa (numero de WhatsApp, chat_id do Telegram, e-mail...) fica em
`ContatoIdentidade`, e nao no contato. Assim o historico do cliente permanece
unico mesmo quando ele troca de canal.
"""
from __future__ import annotations

import enum
import json
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Table,
    Text,
    UniqueConstraint,
    event,
    inspect,
    select,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, object_session, relationship
from sqlalchemy.types import TypeDecorator

from . import permissoes as perm
from .db import Base
from .util import garantir_utc


def agora() -> datetime:
    return datetime.now(timezone.utc)


class DataHoraUTC(TypeDecorator):
    """Data e hora sempre gravadas em UTC e sempre devolvidas com fuso.

    O SQLite não guarda fuso: sem isto, a data volta "ingênua", sai da API
    sem o "+00:00", e o navegador no horário de Brasília mostra a hora UTC
    como se fosse local — três horas adiantada. Resolver aqui, na coluna,
    vale para toda leitura; remendar cada tela deixaria uma sempre esquecida.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, valor, dialeto):
        if valor is None:
            return None
        return garantir_utc(valor)

    def process_result_value(self, valor, dialeto):
        return garantir_utc(valor)


class JSONEmTexto(TypeDecorator):
    """Objeto pequeno gravado como texto JSON numa coluna VARCHAR.

    É o formato da coluna `mensagens.assinatura` no PHP (VARCHAR(255) com
    `{"nome", "setor"}`): o tipo JSON do SQLAlchemy viraria JSON nativo no
    MySQL, e uma base criada por um lado não abriria igual no outro.
    """

    impl = String(255)
    cache_ok = True

    def process_bind_param(self, valor, dialeto):
        if valor is None:
            return None
        return json.dumps(valor, ensure_ascii=False, separators=(",", ":"))

    def process_result_value(self, valor, dialeto):
        if valor is None or valor == "":
            return None
        try:
            return json.loads(valor)
        except (TypeError, ValueError):
            return None  # texto que não é JSON não derruba a leitura da conversa


class TipoCanal(str, enum.Enum):
    WHATSAPP = "whatsapp"  # API oficial da Meta (Cloud API)
    # WhatsApp comum conectado pelo QR Code, com a sessão num provedor online
    # (Z-API ou Evolution API): ver app/canais/whatsapp_qr.py
    WHATSAPP_QR = "whatsapp_qr"
    TELEGRAM = "telegram"
    EMAIL = "email"
    WEBCHAT = "webchat"


class StatusConversa(str, enum.Enum):
    ABERTA = "aberta"
    PENDENTE = "pendente"
    RESOLVIDA = "resolvida"


class Prioridade(str, enum.Enum):
    BAIXA = "baixa"
    NORMAL = "normal"
    ALTA = "alta"


class Direcao(str, enum.Enum):
    ENTRADA = "entrada"
    SAIDA = "saida"


class TipoMensagem(str, enum.Enum):
    TEXTO = "texto"
    NOTA_INTERNA = "nota_interna"
    SISTEMA = "sistema"


class StatusMensagem(str, enum.Enum):
    RECEBIDA = "recebida"
    ENVIADA = "enviada"
    ENTREGUE = "entregue"
    LIDA = "lida"
    FALHOU = "falhou"
    SIMULADA = "simulada"


class Papel(str, enum.Enum):
    ADMIN = "admin"
    ATENDENTE = "atendente"


conversa_etiqueta = Table(
    "conversa_etiqueta",
    Base.metadata,
    Column("conversa_id", ForeignKey("conversas.id", ondelete="CASCADE"), primary_key=True),
    Column("etiqueta_id", ForeignKey("etiquetas.id", ondelete="CASCADE"), primary_key=True),
)


class ListaDeTextoJSON(TypeDecorator):
    """Lista de textos (as permissões de um cargo) gravada como texto JSON,
    como a coluna {JSON} (LONGTEXT) da migração PHP."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, valor, dialeto):
        return json.dumps([str(item) for item in (valor or [])], ensure_ascii=False, separators=(",", ":"))

    def process_result_value(self, valor, dialeto):
        try:
            lido = json.loads(valor) if valor else []
        except (TypeError, ValueError):
            return []
        return [item for item in lido if isinstance(item, str)] if isinstance(lido, list) else []


class Cargo(Base):
    """Cargo da equipe: nível (hierarquia) e permissões (app/permissoes.py).

    `chave` identifica os de fábrica ("administrador", "gerente", "lider",
    "conferente", "colaborador"); cargo criado pelo admin tem chave NULL.
    `sistema` = de fábrica, não pode ser apagado. Mesmas colunas e índices da
    migração PHP M20260925_1500_CargosESetores. AUTOINCREMENT no SQLite, como
    o {ID} do PHP: id de cargo apagado nunca volta.
    """

    __tablename__ = "cargos"
    __table_args__ = (
        Index("uq_cargos_chave", "chave", unique=True),
        Index("uq_cargos_nome", "nome", unique=True),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    chave: Mapped[str | None] = mapped_column(String(20), nullable=True)
    nome: Mapped[str] = mapped_column(String(60))
    nivel: Mapped[int] = mapped_column(Integer)
    permissoes: Mapped[list] = mapped_column(ListaDeTextoJSON, default=list)
    sistema: Mapped[bool] = mapped_column(Boolean, default=False)
    criado_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora)

    @property
    def e_administrador(self) -> bool:
        return self.chave == perm.ADMINISTRADOR

    @property
    def permissoes_efetivas(self) -> list[str]:
        """O Administrador tem todas, sempre: não depende do que está gravado."""
        return list(perm.TODAS) if self.e_administrador else perm.ordenar(self.permissoes or [])

    @classmethod
    def vazio(cls, chave: str) -> "Cargo":
        """Cargo que não está no banco (base sem a migração): o Administrador
        continua com tudo; qualquer outro fica sem nada."""
        admin = chave == perm.ADMINISTRADOR
        return cls(
            id=0,
            chave=chave,
            nome="Administrador" if admin else "Colaborador",
            nivel=perm.NIVEL_ADMINISTRADOR if admin else 0,
            permissoes=list(perm.TODAS) if admin else [],
            sistema=True,
        )


class Setor(Base):
    """Setor (departamento). O nome é único sem diferença de maiúsculas e
    espaços repetidos (conferido no código: servicos/setores.py)."""

    __tablename__ = "setores"
    __table_args__ = (Index("uq_setores_nome", "nome", unique=True), {"sqlite_autoincrement": True})

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(60))
    descricao: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    criado_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora)


class Atendente(Base):
    __tablename__ = "atendentes"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    senha_hash: Mapped[str] = mapped_column(String(255))
    # espelho do cargo ("admin" se Administrador, senão "atendente"): o JSON
    # antigo e o front ainda o leem. Quem decide é o cargo.
    papel: Mapped[str] = mapped_column(String(20), default=Papel.ATENDENTE.value)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    disponivel: Mapped[bool] = mapped_column(Boolean, default=True)
    # o NOME do setor (setor_id), mostrado ao cliente junto com o nome de quem
    # responde ("Ana · Suporte técnico"); gravado junto com o setor_id
    setor: Mapped[str | None] = mapped_column(String(80), nullable=True)
    criado_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora)
    # sem chave estrangeira, como na migração PHP (o SQLite não acrescenta FK
    # com ALTER TABLE); apagar cargo ou setor em uso é recusado pela API
    cargo_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    setor_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    cargo_rel: Mapped[Cargo | None] = relationship(
        primaryjoin="foreign(Atendente.cargo_id) == Cargo.id", lazy="joined", viewonly=True
    )

    @property
    def cargo(self) -> Cargo:
        """O cargo efetivo. Sem cargo_id (linha gravada por código antigo),
        vale o papel: admin é Administrador, o resto é Colaborador — a mesma
        regra da migração. Assim ninguém fica sem cargo nem ganha mais."""
        cargo = self.cargo_rel
        sessao = object_session(self)
        if self.cargo_id is not None and (cargo is None or cargo.id != self.cargo_id) and sessao is not None:
            cargo = sessao.get(Cargo, self.cargo_id)  # mudou nesta sessão: a relação ainda é a velha
        if cargo is not None and self.cargo_id is not None:
            return cargo
        chave = perm.ADMINISTRADOR if self.papel == Papel.ADMIN.value else perm.COLABORADOR
        if sessao is not None:
            achado = sessao.scalar(select(Cargo).where(Cargo.chave == chave))
            if achado is not None:
                return achado
        return Cargo.vazio(chave)

    @property
    def permissoes(self) -> list[str]:
        """Efetivas, na ordem do catálogo. Inativo não tem nenhuma."""
        if not self.ativo:
            return []
        return self.cargo.permissoes_efetivas

    @property
    def nivel(self) -> int:
        return int(self.cargo.nivel)

    @property
    def e_admin(self) -> bool:
        """Tem o cargo Administrador (o papel é só espelho)."""
        return self.cargo.e_administrador

    @property
    def papel_efetivo(self) -> str:
        return Papel.ADMIN.value if self.e_admin else Papel.ATENDENTE.value


class Canal(Base):
    __tablename__ = "canais"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(120))
    tipo: Mapped[str] = mapped_column(String(20), index=True)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    # credenciais especificas do provedor (token, numero, servidor imap...)
    credenciais: Mapped[dict] = mapped_column(JSON, default=dict)
    # identificador publico usado pelo widget de webchat
    chave_publica: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    # segredo compartilhado para validar a assinatura dos webhooks
    segredo_webhook: Mapped[str | None] = mapped_column(String(120), nullable=True)
    criado_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora)
    # conversa nova deste canal entra na fila deste setor (NULL: fila geral)
    setor_padrao_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    conversas: Mapped[list["Conversa"]] = relationship(back_populates="canal")


class Contato(Base):
    __tablename__ = "contatos"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(160))
    empresa: Mapped[str | None] = mapped_column(String(160), nullable=True)
    documento: Mapped[str | None] = mapped_column(String(32), nullable=True)  # CNPJ/CPF
    email: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    telefone: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    observacoes: Mapped[str | None] = mapped_column(Text, nullable=True)
    criado_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora)
    atualizado_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora, onupdate=agora)

    # passive_deletes deixa o ON DELETE CASCADE do banco fazer o trabalho, em
    # vez de o ORM carregar e apagar filho por filho
    identidades: Mapped[list["ContatoIdentidade"]] = relationship(
        back_populates="contato", cascade="all, delete-orphan", lazy="selectin", passive_deletes=True
    )
    conversas: Mapped[list["Conversa"]] = relationship(back_populates="contato", passive_deletes=True)


class ContatoIdentidade(Base):
    """Como um contato e identificado dentro de um canal especifico."""

    __tablename__ = "contato_identidades"
    __table_args__ = (UniqueConstraint("canal_tipo", "identificador", name="uq_identidade_canal"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    contato_id: Mapped[int] = mapped_column(ForeignKey("contatos.id", ondelete="CASCADE"), index=True)
    canal_tipo: Mapped[str] = mapped_column(String(20))
    identificador: Mapped[str] = mapped_column(String(200))
    nome_exibicao: Mapped[str | None] = mapped_column(String(160), nullable=True)
    criado_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora)

    contato: Mapped[Contato] = relationship(back_populates="identidades")


class Etiqueta(Base):
    __tablename__ = "etiquetas"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(60), unique=True)
    cor: Mapped[str] = mapped_column(String(9), default="#6b7cff")


class Conversa(Base):
    __tablename__ = "conversas"

    id: Mapped[int] = mapped_column(primary_key=True)
    contato_id: Mapped[int] = mapped_column(ForeignKey("contatos.id", ondelete="CASCADE"), index=True)
    canal_id: Mapped[int] = mapped_column(ForeignKey("canais.id", ondelete="CASCADE"), index=True)
    atendente_id: Mapped[int | None] = mapped_column(
        ForeignKey("atendentes.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(20), default=StatusConversa.ABERTA.value, index=True)
    prioridade: Mapped[str] = mapped_column(String(10), default=Prioridade.NORMAL.value)
    assunto: Mapped[str | None] = mapped_column(String(200), nullable=True)
    previa: Mapped[str | None] = mapped_column(String(200), nullable=True)
    nao_lidas: Mapped[int] = mapped_column(Integer, default=0)
    criada_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora)
    atualizada_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora, onupdate=agora)
    ultima_mensagem_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora, index=True)
    primeira_resposta_em: Mapped[datetime | None] = mapped_column(DataHoraUTC, nullable=True)
    resolvida_em: Mapped[datetime | None] = mapped_column(DataHoraUTC, nullable=True)
    # a fila de setor em que a conversa está (NULL: fila geral)
    setor_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    setor_rel: Mapped[Setor | None] = relationship(
        primaryjoin="foreign(Conversa.setor_id) == Setor.id", lazy="joined", viewonly=True
    )
    contato: Mapped[Contato] = relationship(back_populates="conversas", lazy="joined")
    canal: Mapped[Canal] = relationship(back_populates="conversas", lazy="joined")
    atendente: Mapped[Atendente | None] = relationship(lazy="joined")
    mensagens: Mapped[list["Mensagem"]] = relationship(
        back_populates="conversa",
        cascade="all, delete-orphan",
        order_by="Mensagem.criada_em",
        passive_deletes=True,
    )
    etiquetas: Mapped[list[Etiqueta]] = relationship(secondary=conversa_etiqueta, lazy="selectin")

    @property
    def setor(self) -> str | None:
        """O nome do setor da fila (a relação pode estar velha se o setor_id
        mudou nesta sessão: aí busca de novo)."""
        if self.setor_id is None:
            return None
        setor = self.setor_rel
        if setor is None or setor.id != self.setor_id:
            sessao = object_session(self)
            setor = sessao.get(Setor, self.setor_id) if sessao is not None else None
        return setor.nome if setor is not None else None


class Mensagem(Base):
    __tablename__ = "mensagens"
    # o id externo ja chega prefixado pelo canal (ex.: "whatsapp:wamid.XX"),
    # o que garante idempotencia em reentregas de webhook
    __table_args__ = (UniqueConstraint("externo_id", name="uq_mensagem_externo"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    conversa_id: Mapped[int] = mapped_column(ForeignKey("conversas.id", ondelete="CASCADE"), index=True)
    direcao: Mapped[str] = mapped_column(String(10))
    tipo: Mapped[str] = mapped_column(String(20), default=TipoMensagem.TEXTO.value)
    conteudo: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default=StatusMensagem.RECEBIDA.value)
    atendente_id: Mapped[int | None] = mapped_column(
        ForeignKey("atendentes.id", ondelete="SET NULL"), nullable=True
    )
    externo_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    erro: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadados: Mapped[dict] = mapped_column(JSON, default=dict)
    # {"nome", "setor"} de quem respondeu, gravado NO ENVIO: se o atendente
    # mudar de setor depois, o histórico continua dizendo o que o cliente viu
    assinatura: Mapped[dict | None] = mapped_column(JSONEmTexto, nullable=True)
    criada_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora, index=True)

    conversa: Mapped[Conversa] = relationship(back_populates="mensagens")
    atendente: Mapped[Atendente | None] = relationship(lazy="joined")
    anexos: Mapped[list["Anexo"]] = relationship(
        back_populates="mensagem",
        cascade="all, delete-orphan",
        lazy="selectin",
        passive_deletes=True,
    )


class Anexo(Base):
    """Arquivo trocado numa conversa.

    Os bytes ficam no armazenamento (`app/armazenamento.py`); aqui guardamos
    só o suficiente para servir e listar. Quando o download no provedor falha,
    a linha continua existindo com `erro` preenchido: o atendente precisa saber
    que veio um arquivo, mesmo que não tenha sido possível buscá-lo.
    """

    __tablename__ = "anexos"

    id: Mapped[int] = mapped_column(primary_key=True)
    mensagem_id: Mapped[int] = mapped_column(
        ForeignKey("mensagens.id", ondelete="CASCADE"), index=True
    )
    nome: Mapped[str] = mapped_column(String(160))
    tipo_conteudo: Mapped[str] = mapped_column(String(120), default="application/octet-stream")
    tamanho: Mapped[int] = mapped_column(Integer, default=0)
    chave: Mapped[str | None] = mapped_column(String(200), nullable=True)
    externo_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    erro: Mapped[str | None] = mapped_column(Text, nullable=True)
    criado_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora)

    mensagem: Mapped["Mensagem"] = relationship(back_populates="anexos")


class RespostaRapida(Base):
    __tablename__ = "respostas_rapidas"

    id: Mapped[int] = mapped_column(primary_key=True)
    atalho: Mapped[str] = mapped_column(String(40), unique=True)
    titulo: Mapped[str] = mapped_column(String(120))
    conteudo: Mapped[str] = mapped_column(Text)
    criada_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora)


class Evento(Base):
    """Trilha de auditoria: quem atribuiu, resolveu, reabriu, etc."""

    __tablename__ = "eventos"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversa_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversas.id", ondelete="CASCADE"), nullable=True, index=True
    )
    atendente_id: Mapped[int | None] = mapped_column(
        ForeignKey("atendentes.id", ondelete="SET NULL"), nullable=True
    )
    tipo: Mapped[str] = mapped_column(String(40))
    descricao: Mapped[str] = mapped_column(String(300))
    criado_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora)


class SessaoWidget(Base):
    """Sessao anonima do visitante no widget de webchat."""

    __tablename__ = "sessoes_widget"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    canal_id: Mapped[int] = mapped_column(ForeignKey("canais.id", ondelete="CASCADE"))
    contato_id: Mapped[int] = mapped_column(ForeignKey("contatos.id", ondelete="CASCADE"))
    criada_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora)


class FilaEvento(Base):
    """Eventos de tempo real guardados, para quem consulta em vez de escutar.

    O SSE entrega só a quem está conectado; esta fila deixa o painel e o
    widget pedirem "o que houve depois do id N" (GET /api/eventos/desde), o
    mesmo contrato do servidor PHP, e não perde o que chegou com a conexão
    caída. AUTOINCREMENT no SQLite: id nunca reaproveitado, senão um cursor
    antigo pularia eventos novos. Mesmo DDL da migração do PHP.
    """

    __tablename__ = "fila_eventos"
    __table_args__ = (
        Index("ix_fila_eventos_contato", "contato_id", "id"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    tipo: Mapped[str] = mapped_column(String(60))
    dados: Mapped[str] = mapped_column(Text)  # JSON pronto: sai como veio
    contato_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    criado_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora, index=True)


# ------------------------------------------------------------ chat interno
# Conversa da equipe entre si, sem misturar com os clientes. Mesmas tabelas,
# colunas e nomes de índice das migrações PHP M20260924_1200_ChatInterno e
# M20260925_0900_ChatInternoVisibilidade: uma
# base criada por um lado abre no outro. Regras em app/servicos/chat_interno.py.
class TipoSala(str, enum.Enum):
    GERAL = "geral"  # todos os atendentes ativos
    SETOR = "setor"  # quem tem o mesmo setor no perfil
    DIRETA = "direta"  # dois atendentes, uma sala só por par
    GRUPO = "grupo"  # membros escolhidos por quem criou


class ListaJSONEmTexto(TypeDecorator):
    """Lista pequena (ids mencionados) gravada como texto JSON.

    O tipo JSON do SQLAlchemy viraria JSON nativo no MySQL, e a migração do
    PHP cria LONGTEXT: texto nos dois lados, para a base abrir igual.
    """

    impl = Text
    cache_ok = True

    def process_bind_param(self, valor, dialeto):
        return json.dumps(list(valor or []), separators=(",", ":"))

    def process_result_value(self, valor, dialeto):
        try:
            lido = json.loads(valor) if valor else []
        except (TypeError, ValueError):
            return []  # texto estragado não derruba a leitura da sala
        return [int(item) for item in lido if isinstance(item, int)] if isinstance(lido, list) else []


class SalaInterna(Base):
    __tablename__ = "interno_salas"
    # `chave` torna única a sala automática ("geral", "setor:<hash>") e a
    # direta de cada par ("direta:3:8"); grupo não tem chave (NULL repete).
    # AUTOINCREMENT no SQLite (o {ID} da migração PHP): sem ele o id do grupo
    # apagado mais recente voltaria na próxima sala, e quem estivesse nela
    # passaria a "ser membro" dos eventos antigos daquele grupo na fila.
    # Bases criadas antes disso são reconstruídas na subida (app/db.py).
    __table_args__ = (
        Index("uq_interno_salas_chave", "chave", unique=True),
        Index("ix_interno_salas_tipo", "tipo"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tipo: Mapped[str] = mapped_column(String(10))
    nome: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # o nome do setor da sala de setor (acompanha o cadastro de setores)
    setor: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # sala de setor: o setor do cadastro (chave "setor:id:<setor_id>")
    setor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chave: Mapped[str | None] = mapped_column(String(120), nullable=True)
    criada_por: Mapped[int | None] = mapped_column(
        ForeignKey("atendentes.id", ondelete="SET NULL"), nullable=True
    )
    criada_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora)
    atualizada_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora)


class MembroSala(Base):
    """Quem está na sala, até onde leu (cursor por membro) e se silenciou."""

    __tablename__ = "interno_membros"
    __table_args__ = (Index("ix_interno_membros_atendente", "atendente_id"),)

    sala_id: Mapped[int] = mapped_column(
        ForeignKey("interno_salas.id", ondelete="CASCADE"), primary_key=True
    )
    atendente_id: Mapped[int] = mapped_column(
        ForeignKey("atendentes.id", ondelete="CASCADE"), primary_key=True
    )
    # id da última mensagem lida: não lidas = mensagens de outros com id maior
    lida_ate: Mapped[int] = mapped_column(Integer, default=0)
    # só vê mensagens com id maior que este. Na sala de setor é a última
    # mensagem de quando a pessoa entrou: o setor é editável no próprio
    # perfil, e trocá-lo não pode abrir o histórico de outro setor. 0 = tudo.
    visivel_desde: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    silenciada: Mapped[bool] = mapped_column(Boolean, default=False)
    entrou_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora)


class MensagemInterna(Base):
    __tablename__ = "interno_mensagens"
    # AUTOINCREMENT no SQLite, como a sala: id de mensagem nunca volta
    __table_args__ = (Index("ix_interno_mensagens_sala", "sala_id", "id"), {"sqlite_autoincrement": True})

    id: Mapped[int] = mapped_column(primary_key=True)
    sala_id: Mapped[int] = mapped_column(ForeignKey("interno_salas.id", ondelete="CASCADE"))
    autor_id: Mapped[int | None] = mapped_column(
        ForeignKey("atendentes.id", ondelete="SET NULL"), nullable=True
    )
    conteudo: Mapped[str] = mapped_column(Text)
    mencoes: Mapped[list] = mapped_column(ListaJSONEmTexto, default=list)
    # "compartilhar uma conversa de cliente": vira um cartão que abre a conversa
    conversa_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversas.id", ondelete="SET NULL"), nullable=True
    )
    criada_em: Mapped[datetime] = mapped_column(DataHoraUTC, default=agora)
    editada_em: Mapped[datetime | None] = mapped_column(DataHoraUTC, nullable=True)
    # apagar é "mensagem apagada": o texto sai do banco, a linha fica no lugar
    apagada: Mapped[bool] = mapped_column(Boolean, default=False)


# ---------------------------------------------------------------- migração
# O create_all só cria tabela que falta: coluna nova numa tabela que já
# existe não aparece numa base antiga. Estas são acrescentadas na subida,
# uma vez, e só se faltarem (idempotente).
COLUNAS_ACRESCENTADAS = (
    ("atendentes", "setor", "VARCHAR(80)"),
    ("mensagens", "assinatura", "VARCHAR(255)"),
    # cargos e setores (migração PHP M20260925_1500_CargosESetores)
    ("atendentes", "cargo_id", "INTEGER"),
    ("atendentes", "setor_id", "INTEGER"),
    ("canais", "setor_padrao_id", "INTEGER"),
    ("conversas", "setor_id", "INTEGER"),
    ("interno_salas", "setor_id", "INTEGER"),
)
# índices das colunas acima (nomes iguais aos da migração PHP)
INDICES_ACRESCENTADOS = (
    ("atendentes", "ix_atendentes_cargo_id", "cargo_id"),
    ("atendentes", "ix_atendentes_setor_id", "setor_id"),
    ("conversas", "ix_conversas_setor_id", "setor_id"),
)


def acrescentar_colunas_faltantes(conexao) -> list[str]:
    """ALTER TABLE ... ADD COLUMN para cada coluna nova que a base não tem."""
    inspetor = inspect(conexao)
    tabelas = set(inspetor.get_table_names())
    feitas = []
    for tabela, coluna, tipo in COLUNAS_ACRESCENTADAS:
        if tabela not in tabelas:
            continue
        if coluna in {c["name"] for c in inspetor.get_columns(tabela)}:
            continue
        # nomes fixos daqui, nunca vindos de fora: nada a escapar
        conexao.execute(text(f"ALTER TABLE {tabela} ADD COLUMN {coluna} {tipo} NULL"))
        feitas.append(f"{tabela}.{coluna}")
    inspetor = inspect(conexao)
    for tabela, nome, coluna in INDICES_ACRESCENTADOS:
        if tabela not in tabelas or nome in {i["name"] for i in inspetor.get_indexes(tabela)}:
            continue
        conexao.execute(text(f"CREATE INDEX {nome} ON {tabela} ({coluna})"))
        feitas.append(nome)
    return feitas


def criar_cargos_de_fabrica(conexao) -> dict[str, int]:
    """Os cinco cargos de fábrica, se faltarem (idempotente). {chave: id}."""
    if "cargos" not in set(inspect(conexao).get_table_names()):
        return {}
    ids: dict[str, int] = {}
    for chave, (nome, nivel, permissoes) in perm.FABRICA.items():
        existente = conexao.execute(text("SELECT id FROM cargos WHERE chave = :chave"), {"chave": chave}).scalar()
        if existente is None:
            conexao.execute(
                Cargo.__table__.insert().values(
                    chave=chave, nome=nome, nivel=nivel, permissoes=list(permissoes), sistema=True, criado_em=agora()
                )
            )
            existente = conexao.execute(text("SELECT id FROM cargos WHERE chave = :chave"), {"chave": chave}).scalar()
        ids[chave] = int(existente)
    return ids


@event.listens_for(Base.metadata, "after_create")
def _migrar_depois_do_create_all(alvo, conexao, **_):
    # todo create_all (subida do app, seed, testes) passa por aqui: colunas
    # novas em tabelas antigas e os cargos de fábrica (sem eles ninguém tem
    # permissão nenhuma; a migração dos dados antigos fica em app/db.py)
    acrescentar_colunas_faltantes(conexao)
    criar_cargos_de_fabrica(conexao)

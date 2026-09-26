"""Setores (departamentos) como cadastro (o mesmo de php/app/Equipe/Setores.php).

O nome é único sem diferença de maiúsculas e espaços repetidos ("  Suporte
técnico" e "suporte TÉCNICO" são o mesmo setor), a regra que as salas do chat
já usavam para o texto livre. A comparação é feita aqui, no Python: o LOWER
do SQLite não baixa letra acentuada.

O nome do setor também fica gravado em atendentes.setor (vai na assinatura
das mensagens e no JSON antigo): renomear o setor atualiza as pessoas dele.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Atendente, Setor
from ..schemas import SetorSaida

MAX_NOME = 60
JA_EXISTE = "ja existe um setor com esse nome"


def espacos(texto: str) -> str:
    return " ".join((texto or "").split())


def normalizar(nome: str | None) -> str:
    return espacos(nome or "").lower()


def por_nome(sessao: Session, nome: str, exceto: int | None = None) -> Setor | None:
    alvo = normalizar(nome)
    if not alvo:
        return None
    for setor in sessao.scalars(select(Setor)):
        if setor.id != exceto and normalizar(setor.nome) == alvo:
            return setor
    return None


def todos(sessao: Session) -> list[Setor]:
    return sorted(sessao.scalars(select(Setor)), key=lambda s: (normalizar(s.nome), s.id))


def criar(sessao: Session, nome: str, descricao: str | None = None) -> Setor:
    """Cria o setor (409 se o nome já existe). Não confirma a transação."""
    nome = espacos(nome)
    if por_nome(sessao, nome) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, JA_EXISTE)
    setor = Setor(nome=nome, descricao=(descricao or "").strip() or None, ativo=True)
    sessao.add(setor)
    try:
        sessao.flush()
    except IntegrityError:
        sessao.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, JA_EXISTE) from None
    return setor


def pessoas_ativas_por_setor(sessao: Session) -> dict[int, int]:
    return {
        int(setor_id): int(total)
        for setor_id, total in sessao.execute(
            select(Atendente.setor_id, func.count(Atendente.id))
            .where(Atendente.ativo.is_(True), Atendente.setor_id.is_not(None))
            .group_by(Atendente.setor_id)
        )
    }


def saida(setor: Setor, total_pessoas: int) -> SetorSaida:
    return SetorSaida(
        id=setor.id, nome=setor.nome, descricao=setor.descricao or None, ativo=bool(setor.ativo), total_pessoas=total_pessoas
    )

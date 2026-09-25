"""Quem vê qual conversa (a mesma regra de php/app/Atendimento/Visibilidade.php).

- conversas.ver_todas: todas;
- todo mundo: as atribuídas a si e as da fila (sem atendente) do próprio
  setor ou da fila geral (conversa sem setor);
- conversas.ver_setor: também as do próprio setor, que são as que estão na
  fila do setor (conversas.setor_id) ou com alguém do setor.

Quem não vê a conversa recebe 404 nela (lista, detalhe, ações, anexos) e não
recebe os eventos dela: para essa pessoa a conversa não existe.
"""
from __future__ import annotations

from collections.abc import Callable

from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from .. import permissoes as perm
from ..models import Atendente, Conversa

NAO_ENCONTRADA = "conversa nao encontrada"


def condicao(atendente: Atendente, como_setor: bool = False):
    """Condição SQLAlchemy das conversas que a pessoa vê; None = vê todas.

    como_setor: o recorte "do setor" mesmo sem conversas.ver_setor (as
    métricas do setor usam)."""
    if not como_setor and perm.tem(atendente, "conversas.ver_todas"):
        return None
    setor = atendente.setor_id
    partes = [Conversa.atendente_id == atendente.id]
    if setor is None:
        partes.append(and_(Conversa.atendente_id.is_(None), Conversa.setor_id.is_(None)))
    else:
        partes.append(
            and_(Conversa.atendente_id.is_(None), or_(Conversa.setor_id.is_(None), Conversa.setor_id == setor))
        )
        if como_setor or perm.tem(atendente, "conversas.ver_setor"):
            do_setor = select(Atendente.id).where(Atendente.setor_id == setor).scalar_subquery()
            partes.append(Conversa.setor_id == setor)
            partes.append(Conversa.atendente_id.in_(do_setor))
    return or_(*partes)


def pode_ver_id(sessao: Session, atendente: Atendente, conversa_id: int) -> bool:
    consulta = select(Conversa.id).where(Conversa.id == conversa_id)
    filtro = condicao(atendente)
    if filtro is not None:
        consulta = consulta.where(filtro)
    return sessao.scalar(consulta) is not None


def exigir(sessao: Session, atendente: Atendente, conversa_id: int) -> Conversa:
    """A conversa, ou 404 "conversa nao encontrada" também para quem não a vê
    (não revela que o id existe)."""
    conversa = sessao.get(Conversa, conversa_id)
    if conversa is None or not pode_ver_id(sessao, atendente, conversa_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, NAO_ENCONTRADA)
    return conversa


def filtro(sessao: Session, atendente: Atendente) -> Callable[[int], bool]:
    """Pergunta "vê a conversa N?" memorizada durante UM lote de eventos."""
    if perm.tem(atendente, "conversas.ver_todas"):
        return lambda _conversa_id: True
    vistas: dict[int, bool] = {}

    def ve(conversa_id: int) -> bool:
        if conversa_id not in vistas:
            vistas[conversa_id] = pode_ver_id(sessao, atendente, conversa_id)
        return vistas[conversa_id]

    return ve

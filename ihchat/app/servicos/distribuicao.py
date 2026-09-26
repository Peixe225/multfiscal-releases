"""Distribuicao de conversas entre os atendentes."""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Atendente, Conversa, StatusConversa


def proximo_atendente(sessao: Session, setor_id: int | None = None) -> Atendente | None:
    """Menor fila primeiro: entrega a quem tem menos conversas em andamento.

    Empate e desfeito pelo id, o que faz a distribuicao circular entre
    atendentes com a mesma carga. Conversa de um setor só vai para quem está
    disponível NAQUELE setor; sem ninguém, fica sem atendente na fila do
    setor (não "vaza" para outro). Conversa sem setor vai para qualquer um.
    """
    carga = (
        select(Conversa.atendente_id, func.count(Conversa.id).label("total"))
        .where(Conversa.status != StatusConversa.RESOLVIDA.value)
        .group_by(Conversa.atendente_id)
        .subquery()
    )
    consulta = (
        select(Atendente)
        .outerjoin(carga, carga.c.atendente_id == Atendente.id)
        .where(Atendente.ativo.is_(True), Atendente.disponivel.is_(True))
        .order_by(func.coalesce(carga.c.total, 0).asc(), Atendente.id.asc())
        .limit(1)
    )
    if setor_id is not None:
        consulta = consulta.where(Atendente.setor_id == setor_id)
    return sessao.scalar(consulta)

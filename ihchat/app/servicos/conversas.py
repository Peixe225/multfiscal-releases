"""Ciclo de vida das conversas."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import obter_config
from ..models import Atendente, Canal, Contato, Conversa, Evento, Setor, StatusConversa, agora
from ..util import garantir_utc
from .distribuicao import proximo_atendente


def registrar_evento(
    sessao: Session, conversa: Conversa | None, tipo: str, descricao: str, atendente: Atendente | None = None
) -> Evento:
    evento = Evento(
        conversa_id=conversa.id if conversa else None,
        atendente_id=atendente.id if atendente else None,
        tipo=tipo,
        descricao=descricao,
    )
    sessao.add(evento)
    return evento


def obter_ou_criar_conversa(
    sessao: Session, contato: Contato, canal: Canal, assunto: str | None = None
) -> tuple[Conversa, bool]:
    """Encontra a conversa viva do contato naquele canal, ou abre uma nova.

    Uma conversa resolvida ha pouco tempo e reaberta em vez de duplicada: quem
    responde "obrigado" cinco minutos depois nao deve virar um novo atendimento.
    """
    conversa = sessao.scalar(
        select(Conversa)
        .where(
            Conversa.contato_id == contato.id,
            Conversa.canal_id == canal.id,
            Conversa.status != StatusConversa.RESOLVIDA.value,
        )
        .order_by(Conversa.ultima_mensagem_em.desc())
        .limit(1)
    )
    if conversa is not None:
        return conversa, False

    limite = agora() - timedelta(hours=obter_config().horas_reabertura)
    recente = sessao.scalar(
        select(Conversa)
        .where(
            Conversa.contato_id == contato.id,
            Conversa.canal_id == canal.id,
            Conversa.status == StatusConversa.RESOLVIDA.value,
        )
        .order_by(Conversa.ultima_mensagem_em.desc())
        .limit(1)
    )
    if recente is not None and garantir_utc(recente.ultima_mensagem_em) >= limite:
        recente.status = StatusConversa.ABERTA.value
        recente.resolvida_em = None
        registrar_evento(sessao, recente, "conversa.reaberta", "Conversa reaberta por nova mensagem do contato")
        sessao.flush()
        return recente, False

    # o canal pode mandar as conversas novas para a fila de um setor (ativo)
    setor_id = None
    if canal.setor_padrao_id is not None:
        setor = sessao.get(Setor, canal.setor_padrao_id)
        setor_id = setor.id if setor is not None and setor.ativo else None
    conversa = Conversa(
        contato_id=contato.id,
        canal_id=canal.id,
        setor_id=setor_id,
        assunto=assunto,
        status=StatusConversa.ABERTA.value,
        ultima_mensagem_em=agora(),
    )
    sessao.add(conversa)
    sessao.flush()
    if obter_config().distribuicao_automatica:
        atendente = proximo_atendente(sessao, setor_id)
        if atendente is not None:
            conversa.atendente_id = atendente.id
            registrar_evento(
                sessao, conversa, "conversa.atribuida", f"Atribuida automaticamente a {atendente.nome}"
            )
    sessao.flush()
    sessao.refresh(conversa)
    return conversa, True


def atribuir(
    sessao: Session,
    conversa: Conversa,
    atendente: Atendente | None,
    autor: Atendente | None = None,
    setor: Setor | None = None,
    muda_setor: bool = False,
) -> Conversa:
    """Atribui (e, com muda_setor, transfere de setor) e registra no histórico."""
    conversa.atendente_id = atendente.id if atendente else None
    if muda_setor:
        conversa.setor_id = setor.id if setor else None
        para = f"o setor {setor.nome}" if setor else "a fila geral"
        descricao = f"Transferida para {atendente.nome} ({para})" if atendente else f"Transferida para {para}"
        tipo = "conversa.transferida"
    else:
        atual = sessao.get(Setor, conversa.setor_id) if conversa.setor_id is not None else None
        if atendente:
            descricao = f"Atribuida a {atendente.nome}"
        else:
            descricao = f"Devolvida a fila do setor {atual.nome}" if atual else "Devolvida a fila geral"
        tipo = "conversa.atribuida"
    registrar_evento(sessao, conversa, tipo, descricao, autor)
    sessao.flush()
    sessao.refresh(conversa)
    return conversa


def mudar_status(
    sessao: Session, conversa: Conversa, status: StatusConversa, autor: Atendente | None = None
) -> Conversa:
    anterior = conversa.status
    conversa.status = status.value
    conversa.resolvida_em = agora() if status is StatusConversa.RESOLVIDA else None
    registrar_evento(sessao, conversa, "conversa.status", f"Status: {anterior} -> {status.value}", autor)
    sessao.flush()
    sessao.refresh(conversa)
    return conversa


def marcar_lida(sessao: Session, conversa: Conversa) -> Conversa:
    conversa.nao_lidas = 0
    sessao.flush()
    return conversa

"""Numeros do atendimento para o topo do painel."""
from __future__ import annotations

from datetime import datetime, time, timezone

from sqlalchemy import func, select

from fastapi import APIRouter

from .. import permissoes as perm
from ..dependencias import AtendenteAtual, Sessao
from ..models import Canal, Conversa, Mensagem, StatusConversa, agora
from ..schemas import MetricasSaida
from ..util import garantir_utc

rotas = APIRouter(prefix="/api/metricas", tags=["metricas"])


def _inicio_do_dia() -> datetime:
    return datetime.combine(agora().date(), time.min, tzinfo=timezone.utc)


@rotas.get("/resumo", response_model=MetricasSaida)
def resumo(sessao: Sessao, atual: AtendenteAtual) -> MetricasSaida:
    """metricas.ver_todas: o atendimento inteiro; metricas.ver_setor: o
    recorte do próprio setor (as conversas que o setor vê); sem nenhuma, 403."""
    from ..servicos import visibilidade

    recorte = None
    if not perm.tem(atual, "metricas.ver_todas"):
        perm.exigir(atual, "metricas.ver_setor")
        recorte = visibilidade.condicao(atual, como_setor=True)
    dentro = [recorte] if recorte is not None else []
    inicio = _inicio_do_dia()

    def contar(*condicoes) -> int:
        return sessao.scalar(select(func.count(Conversa.id)).where(*condicoes, *dentro)) or 0

    por_canal = {
        nome: total
        for nome, total in sessao.execute(
            select(Canal.nome, func.count(Conversa.id))
            .join(Conversa, Conversa.canal_id == Canal.id)
            .where(Conversa.status != StatusConversa.RESOLVIDA.value, *dentro)
            .group_by(Canal.nome)
        )
    }

    consulta_mensagens = select(func.count(Mensagem.id)).where(Mensagem.criada_em >= inicio)
    if dentro:
        consulta_mensagens = consulta_mensagens.join(Conversa, Conversa.id == Mensagem.conversa_id).where(*dentro)
    mensagens_hoje = sessao.scalar(consulta_mensagens) or 0

    # tempo ate a primeira resposta, so das conversas ja respondidas
    tempos = sessao.execute(
        select(Conversa.criada_em, Conversa.primeira_resposta_em).where(
            Conversa.primeira_resposta_em.is_not(None), *dentro
        )
    ).all()
    media = None
    if tempos:
        segundos = [
            (garantir_utc(resposta) - garantir_utc(criada)).total_seconds()
            for criada, resposta in tempos
        ]
        media = round(sum(segundos) / len(segundos), 1)

    return MetricasSaida(
        abertas=contar(Conversa.status == StatusConversa.ABERTA.value),
        pendentes=contar(Conversa.status == StatusConversa.PENDENTE.value),
        resolvidas_hoje=contar(
            Conversa.status == StatusConversa.RESOLVIDA.value, Conversa.resolvida_em >= inicio
        ),
        sem_atendente=contar(
            Conversa.atendente_id.is_(None), Conversa.status != StatusConversa.RESOLVIDA.value
        ),
        mensagens_hoje=mensagens_hoje,
        por_canal=por_canal,
        tempo_medio_primeira_resposta_seg=media,
    )

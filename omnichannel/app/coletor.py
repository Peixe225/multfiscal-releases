"""Coleta periodica dos canais que buscam as mensagens em vez de recebe-las.

Hoje sao o e-mail via IMAP e o Telegram em modo polling. O coletor passa por
todos os canais ativos e deixa cada adaptador decidir em `coletar()` se ha o
que buscar (a base devolve lista vazia), para nao conhecer provedor nenhum.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Container, Iterable, Mapping
from functools import partial
from typing import NamedTuple

from sqlalchemy import select

from .canais.base import ErroCanal
from .canais.registro import adaptador_para
from .config import obter_config
from .db import SessaoLocal
from .models import Canal, TipoCanal
from .servicos.mensagens import publicar_conversa, publicar_mensagem, registrar_entrada

log = logging.getLogger("omnichannel.coletor")

# IMAP e lento e caro; todo o resto e chat, em que o contato espera ver a
# resposta andar em segundos
TIPOS_LENTOS = frozenset({TipoCanal.EMAIL.value})
# nenhuma configuracao deve transformar o laco numa consulta ao banco sem pausa
PASSO_MINIMO = 1.0


class CanalAtivo(NamedTuple):
    id: int
    tipo: str
    nome: str


# ------------------------------------------------------------------ agenda
def intervalo_de(tipo: str, intervalo_polling: float, intervalo_coleta: float) -> float:
    return intervalo_coleta if tipo in TIPOS_LENTOS else intervalo_polling


def canais_a_coletar(
    canais: Iterable[CanalAtivo],
    ultima_coleta: Mapping[int, float],
    em_andamento: Container[int],
    agora: float,
    intervalo_polling: float,
    intervalo_coleta: float,
) -> list[CanalAtivo]:
    """Decide quem coletar neste instante, sem relogio nem banco: testavel sem dormir.

    `ultima_coleta` guarda quando cada coleta *comecou*. Canal que nunca foi
    coletado entra ja. Canal com coleta ainda em andamento fica de fora: um
    IMAP lento nao empilha coletas, e dois getUpdates simultaneos do mesmo bot
    fariam o Telegram responder 409.
    """
    devidos = []
    for canal in canais:
        if canal.id in em_andamento:
            continue
        anterior = ultima_coleta.get(canal.id)
        intervalo = intervalo_de(canal.tipo, intervalo_polling, intervalo_coleta)
        if anterior is None or agora - anterior >= intervalo:
            devidos.append(canal)
    return devidos


# ------------------------------------------------------------------ coleta
def canais_ativos() -> list[CanalAtivo]:
    with SessaoLocal() as sessao:
        linhas = sessao.execute(
            select(Canal.id, Canal.tipo, Canal.nome).where(Canal.ativo.is_(True)).order_by(Canal.id)
        )
        return [CanalAtivo(*linha) for linha in linhas]


def coletar_canal(canal_id: int) -> int:
    """Busca e grava as mensagens de um canal. Devolve quantas entraram.

    ErroCanal sobe: quem chama decide como registrar (o laco evita repetir o
    mesmo aviso a cada poucos segundos).
    """
    with SessaoLocal() as sessao:
        canal = sessao.get(Canal, canal_id)
        if canal is None or not canal.ativo:  # removido ou desligado desde a listagem
            return 0
        # nao se checa `configurado` aqui: aquilo mede as credenciais de
        # ENVIO, e uma caixa pode estar configurada so para leitura.
        # `coletar()` devolve lista vazia quando nao ha o que buscar.
        recebidas = adaptador_para(canal).coletar()
        novas, conversas = [], {}
        for recebida in recebidas:
            mensagem = registrar_entrada(sessao, canal, recebida)
            if mensagem is not None:
                novas.append(mensagem)
                conversas[mensagem.conversa_id] = mensagem.conversa
        sessao.commit()
        for mensagem in novas:
            publicar_mensagem(mensagem)
        for conversa in conversas.values():
            publicar_conversa(conversa)
        return len(novas)


def coletar_uma_vez() -> int:
    """Coleta todos os canais ativos agora, um depois do outro. Devolve quantas mensagens entraram."""
    total = 0
    for canal in canais_ativos():
        try:
            total += coletar_canal(canal.id)
        except ErroCanal as exc:
            log.warning("canal %s: %s", canal.nome, exc)
        except Exception:  # um canal quebrado nao impede os outros
            log.exception("canal %s: falha inesperada na coleta", canal.nome)
    return total


# ------------------------------------------------------------------- laco
def _ao_terminar(
    canal: CanalAtivo, em_andamento: dict[int, asyncio.Task], falhas: dict[int, str], tarefa: asyncio.Task
) -> None:
    em_andamento.pop(canal.id, None)
    if tarefa.cancelled():
        return
    erro = tarefa.exception()
    if erro is None:
        if falhas.pop(canal.id, None) is not None:
            log.info("canal %s voltou a coletar", canal.nome)
        return
    # a cada 3 s o mesmo aviso viraria ruido: registra quando comeca ou muda
    if falhas.get(canal.id) == str(erro):
        return
    falhas[canal.id] = str(erro)
    if isinstance(erro, ErroCanal):
        log.warning("canal %s: %s", canal.nome, erro)
    else:
        log.error("canal %s: falha inesperada na coleta", canal.nome, exc_info=erro)


async def laco(intervalo_coleta: float | None = None, intervalo_polling: float | None = None) -> None:
    """Dispara a coleta de cada canal no seu ritmo, cada uma na sua thread.

    Coletas separadas fazem o chat continuar rapido enquanto um IMAP demora, e
    a falha de um canal nao derruba os outros nem o laco.
    """
    config = obter_config()
    lento = intervalo_coleta or config.intervalo_coleta
    rapido = intervalo_polling or config.intervalo_polling
    # nenhum canal espera mais que um passo alem do proprio prazo
    passo = max(PASSO_MINIMO, min(lento, rapido))
    ultima_coleta: dict[int, float] = {}
    em_andamento: dict[int, asyncio.Task] = {}
    falhas: dict[int, str] = {}
    try:
        while True:
            try:
                canais = await asyncio.to_thread(canais_ativos)
                agora = time.monotonic()
                for canal in canais_a_coletar(canais, ultima_coleta, em_andamento, agora, rapido, lento):
                    ultima_coleta[canal.id] = agora
                    tarefa = asyncio.create_task(asyncio.to_thread(coletar_canal, canal.id))
                    em_andamento[canal.id] = tarefa
                    tarefa.add_done_callback(partial(_ao_terminar, canal, em_andamento, falhas))
            except Exception:  # ex.: banco indisponivel; tenta de novo no proximo passo
                log.exception("falha ao agendar a coleta")
            await asyncio.sleep(passo)
    finally:
        # a thread em si termina sozinha (o getUpdates espera poucos segundos)
        for tarefa in list(em_andamento.values()):
            tarefa.cancel()

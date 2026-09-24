"""Tempo real para o painel: fluxo SSE e consulta por cursor.

Todo evento publicado fica na tabela `fila_eventos` (servicos/mensagens.py),
com id crescente. Daí saem os dois jeitos de acompanhar:

- GET /api/eventos/stream   Server-Sent Events. Cada evento leva o seu `id:`;
  o navegador reconecta sozinho mandando Last-Event-ID e recebe o que perdeu
  com a conexão caída. O barramento em memória só acorda o fluxo.
- GET /api/eventos/desde    consulta "o que há depois do id N", o contrato do
  servidor PHP (a hospedagem compartilhada não segura conexão aberta):
  {"eventos": [{"id", "tipo", "dados"}], "ultimo": <id>}. Sem `depois`,
  devolve só o cursor atual, para a tela começar "de agora".

O front lê /saude ("eventos": "stream" aqui, "consulta" no PHP) e escolhe.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator, Callable
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Query, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select

from ..db import SessaoLocal
from ..dependencias import AtendenteDeArquivo, Sessao
from ..eventos import barramento
from ..models import Atendente, Direcao, FilaEvento, TipoMensagem, agora
from ..schemas import EventosDesdeSaida
from ..security import ler_token
from ..util import garantir_utc

rotas = APIRouter(prefix="/api/eventos", tags=["eventos"])

CABECALHOS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",  # evita buffer do nginx na frente do app
}

LIMITE_PADRAO = 200
LIMITE_MAXIMO = 500
# Uma lacuna de id recente pode ser uma transação ainda não confirmada (MySQL
# e PostgreSQL reservam o id antes do commit): o cursor espera por ela até
# este tempo. Passado isso, é id perdido num rollback e a leitura segue.
SEGUNDOS_LACUNA = 3.0
# de quanto em quanto tempo o fluxo SSE confere a fila mesmo sem ser acordado
VERIFICACAO = 3.0

Filtro = Callable[[FilaEvento, object], bool]

# os parâmetros da consulta, iguais nas duas rotas (a do widget também usa)
Depois = Annotated[int | None, Query(ge=0, description="id do último evento visto")]
Limite = Annotated[int, Query(ge=1, le=LIMITE_MAXIMO)]


def ultimo_id() -> int:
    with SessaoLocal() as sessao:
        return int(sessao.scalar(select(func.max(FilaEvento.id))) or 0)


def ler_desde(depois: int | None, limite: int = LIMITE_PADRAO, filtro: Filtro | None = None) -> dict:
    """Eventos depois do cursor, respeitando lacunas recentes.

    O cursor ("ultimo") avança por TODOS os ids lidos, mesmo os que o filtro
    descarta: senão quem só enxerga os próprios eventos (o widget) ficaria
    relendo os dos outros para sempre.
    """
    if depois is None:
        return {"eventos": [], "ultimo": ultimo_id()}
    with SessaoLocal() as sessao:
        linhas = sessao.scalars(
            select(FilaEvento).where(FilaEvento.id > depois).order_by(FilaEvento.id).limit(limite)
        ).all()
    eventos: list[dict] = []
    ultimo = depois
    esperado = depois + 1
    limite_lacuna = agora() - timedelta(seconds=SEGUNDOS_LACUNA)
    for linha in linhas:
        if linha.id != esperado and depois > 0:
            criado = garantir_utc(linha.criado_em)
            if criado is not None and criado > limite_lacuna:
                break  # um id anterior pode estar numa transação ainda aberta
        esperado = linha.id + 1
        ultimo = linha.id
        try:
            dados = json.loads(linha.dados)
        except (TypeError, ValueError):
            dados = None
        if filtro is not None and not filtro(linha, dados):
            continue
        eventos.append({"id": linha.id, "tipo": linha.tipo, "dados": dados})
    return {"eventos": eventos, "ultimo": ultimo}


def do_visitante(contato_id: int) -> Filtro:
    """O visitante do widget só vê a resposta para ele, nunca nota interna."""

    def filtro(linha: FilaEvento, dados) -> bool:
        return (
            linha.tipo == "mensagem.nova"
            and isinstance(dados, dict)
            and dados.get("contato_id") == contato_id
            and dados.get("direcao") == Direcao.SAIDA.value
            and dados.get("tipo") != TipoMensagem.NOTA_INTERNA.value
        )

    return filtro


def cursor_inicial(depois: int | None, ultimo_visto: str | None) -> int | None:
    """Last-Event-ID (reconexão automática do EventSource) vence o ?depois=."""
    if ultimo_visto and ultimo_visto.strip().isdigit():
        return int(ultimo_visto.strip())
    return depois


async def fluxo_persistido(depois: int | None, filtro: Filtro | None = None) -> AsyncIterator[str]:
    """Corpo text/event-stream lido da fila, com `id:` em cada evento.

    O barramento em memória serve de despertador: a cada publicação (ou ping
    de 25 s) o fluxo consulta a fila. Inscrito ANTES da primeira consulta,
    nada publicado no meio do caminho escapa. O barramento só conhece o
    próprio processo: com mais de um worker (ou num reinício, em que o
    processo velho segura as conexões abertas) quem publica é outro, então a
    fila também é conferida a cada VERIFICACAO segundos.
    """
    despertador = barramento.fluxo()
    proximo: asyncio.Future | None = None
    try:
        yield await despertador.__anext__()  # ": conectado", já inscrito
        cursor = depois if depois is not None else await run_in_threadpool(ultimo_id)
        while True:
            lote = await run_in_threadpool(ler_desde, cursor, LIMITE_PADRAO, filtro)
            for evento in lote["eventos"]:
                dados = json.dumps(evento["dados"], ensure_ascii=False, default=str)
                yield f"id: {evento['id']}\nevent: {evento['tipo']}\ndata: {dados}\n\n"
            if lote["ultimo"] != cursor:
                cursor = lote["ultimo"]
                continue  # pode haver mais que um lote na fila
            # a espera fica pendente entre as voltas: cancelar o __anext__ no
            # meio encerraria o gerador do barramento
            if proximo is None:
                proximo = asyncio.ensure_future(despertador.__anext__())
            feitos, _ = await asyncio.wait({proximo}, timeout=VERIFICACAO)
            if feitos:
                trecho = proximo.result()
                proximo = None
                if trecho.startswith(": ping"):
                    yield trecho
    finally:
        if proximo is not None:
            proximo.cancel()
            with contextlib.suppress(BaseException):
                await proximo
        await despertador.aclose()


@rotas.get("/stream")
def stream(
    sessao: Sessao,
    token: str = Query(description="token do atendente"),
    depois: Depois = None,
    last_event_id: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    """EventSource nao permite cabecalhos, entao o token vem na query string."""
    atendente_id = ler_token(token)
    atendente = sessao.get(Atendente, atendente_id) if atendente_id else None
    if atendente is None or not atendente.ativo:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token invalido ou expirado")
    return StreamingResponse(
        fluxo_persistido(cursor_inicial(depois, last_event_id)),
        media_type="text/event-stream",
        headers=CABECALHOS,
    )


@rotas.get("/desde", response_model=EventosDesdeSaida)
def desde(_: AtendenteDeArquivo, depois: Depois = None, limite: Limite = LIMITE_PADRAO) -> dict:
    """Token no cabeçalho Authorization ou em ?token= (mesma regra dos arquivos)."""
    return ler_desde(depois, limite)

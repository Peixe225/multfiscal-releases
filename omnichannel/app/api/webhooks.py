"""Recepcao de mensagens vindas dos provedores."""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select

from ..canais.registro import CanalNaoSuportado, adaptador_para
from ..dependencias import Sessao
from ..models import Canal
from ..servicos.mensagens import (
    aplicar_status_externo,
    publicar_conversa,
    publicar_mensagem,
    registrar_entrada,
)

rotas = APIRouter(prefix="/webhooks", tags=["webhooks"])


def _canal(sessao, canal_id: int) -> Canal:
    canal = sessao.scalar(select(Canal).where(Canal.id == canal_id))
    if canal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "canal nao encontrado")
    if not canal.ativo:
        raise HTTPException(status.HTTP_409_CONFLICT, "canal desativado")
    return canal


@rotas.get("/{canal_id}")
async def verificar(canal_id: int, request: Request, sessao: Sessao) -> Response:
    """Handshake de verificacao exigido por alguns provedores (Meta)."""
    canal = _canal(sessao, canal_id)
    desafio = adaptador_para(canal).desafio_verificacao(dict(request.query_params))
    if desafio is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "verificacao recusada")
    return Response(content=desafio, media_type="text/plain")


@rotas.post("/{canal_id}")
async def receber(canal_id: int, request: Request, sessao: Sessao) -> dict:
    canal = _canal(sessao, canal_id)
    try:
        adaptador = adaptador_para(canal)
    except CanalNaoSuportado as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    corpo = await request.body()
    cabecalhos = {chave.lower(): valor for chave, valor in request.headers.items()}
    if not adaptador.verificar_assinatura(corpo, cabecalhos):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "assinatura invalida")

    try:
        payload = json.loads(corpo or b"{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "corpo nao e JSON valido") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "corpo deve ser um objeto JSON")

    novas, conversas = [], {}
    for recebida in adaptador.analisar_webhook(payload):
        mensagem = registrar_entrada(sessao, canal, recebida)
        if mensagem is not None:  # None = reentrega do mesmo webhook
            novas.append(mensagem)
            conversas[mensagem.conversa_id] = mensagem.conversa

    atualizadas = aplicar_status_externo(sessao, adaptador.analisar_status(payload))
    sessao.commit()

    for mensagem in novas:
        publicar_mensagem(mensagem)
    for conversa in conversas.values():
        publicar_conversa(conversa)
    for mensagem in atualizadas:
        publicar_mensagem(mensagem, "mensagem.status")

    return {"recebidas": len(novas), "status_atualizados": len(atualizadas)}

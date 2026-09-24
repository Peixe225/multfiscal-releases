"""Recepcao de mensagens vindas dos provedores."""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select
from starlette.datastructures import UploadFile

from ..canais.base import AdaptadorCanal, AnexoRecebido
from ..canais.email import AdaptadorEmail
from ..canais.registro import CanalNaoSuportado, adaptador_para
from ..canais.whatsapp import AdaptadorWhatsApp, entrega_com, valores_por_numero
from ..dependencias import Sessao
from ..models import Canal, TipoCanal
from ..servicos.mensagens import (
    aplicar_status_externo,
    publicar_conversa,
    publicar_mensagem,
    registrar_entrada,
)

log = logging.getLogger("ihchat.webhooks")

rotas = APIRouter(prefix="/webhooks", tags=["webhooks"])

TIPOS_DE_FORMULARIO = ("multipart/form-data", "application/x-www-form-urlencoded")


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
    try:
        desafio = adaptador_para(canal).desafio_verificacao(dict(request.query_params))
    except CanalNaoSuportado:
        desafio = None
    if desafio is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "verificacao recusada")
    return Response(content=desafio, media_type="text/plain")


def _objeto_do_corpo(corpo: bytes) -> dict:
    if not corpo.strip():
        return {}  # corpo vazio e um objeto vazio: nada a gravar
    try:
        payload = json.loads(corpo)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "corpo nao e JSON valido") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "corpo deve ser um objeto JSON")
    return payload


async def _formulario(request: Request) -> tuple[dict, list[AnexoRecebido]]:
    """Campos de texto e arquivos de uma entrega em formulário (SendGrid, Mailgun)."""
    formulario = await request.form()
    campos: dict = {}
    arquivos: list[AnexoRecebido] = []
    for chave, valor in formulario.multi_items():
        if isinstance(valor, UploadFile):
            dados = await valor.read()
            if dados:
                arquivos.append(
                    AnexoRecebido(nome=valor.filename or "arquivo", dados=dados, tipo_conteudo=valor.content_type or None)
                )
        elif chave not in campos:
            campos[chave] = valor
    return campos, arquivos


def _whatsapp_por_numero(sessao) -> dict[str, Canal]:
    """Canais WhatsApp ativos pelo Phone number ID (o de menor id, se repetido)."""
    mapa: dict[str, Canal] = {}
    canais = sessao.scalars(
        select(Canal).where(Canal.tipo == TipoCanal.WHATSAPP.value, Canal.ativo.is_(True)).order_by(Canal.id)
    )
    for outro in canais:
        numero = AdaptadorWhatsApp(outro).id_numero
        if numero and numero not in mapa:
            mapa[numero] = outro
    return mapa


def _destinos(sessao, canal: Canal, adaptador: AdaptadorCanal, payload: dict) -> list[tuple[Canal, AdaptadorCanal, dict]]:
    """A que canal vai cada parte da entrega.

    Só o WhatsApp divide: a Meta manda as entregas de TODOS os números do app
    para a URL cadastrada no app, e cada "value" diz o número
    (metadata.phone_number_id). A parte de outro número vai para o canal
    WhatsApp ativo daquele número; a de um número que nenhum canal tem é
    descartada (com aviso no log), para a conversa do número B nunca abrir no
    canal A e ser respondida pelo A. A assinatura já foi conferida: os números
    do mesmo app têm o mesmo App Secret.
    """
    if not isinstance(adaptador, AdaptadorWhatsApp):
        return [(canal, adaptador, payload)]
    meu = adaptador.id_numero
    por_numero: dict[str, Canal] | None = None
    grupos: dict[int, tuple[Canal, list[dict]]] = {}
    for numero, valor in valores_por_numero(payload):
        destino = canal
        if numero is not None and numero != meu:
            if por_numero is None:
                por_numero = _whatsapp_por_numero(sessao)
            if numero in por_numero:
                destino = por_numero[numero]
            elif meu:
                log.warning(
                    "webhook do canal %s: entrega do número %s, que nenhum canal WhatsApp ativo tem; descartada",
                    canal.id, numero,
                )
                continue
            # sem id_numero neste canal (sandbox) e número sem dono: fica aqui
        grupos.setdefault(destino.id, (destino, []))[1].append(valor)
    return [
        (destino, adaptador if destino.id == canal.id else AdaptadorWhatsApp(destino), entrega_com(valores))
        for destino, valores in grupos.values()
    ]


@rotas.post("/{canal_id}")
async def receber(canal_id: int, request: Request, sessao: Sessao) -> dict:
    canal = _canal(sessao, canal_id)
    try:
        adaptador = adaptador_para(canal)
    except CanalNaoSuportado as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    if not adaptador.recebe_webhook:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "este canal nao recebe por webhook")

    corpo = await request.body()
    cabecalhos = {chave.lower(): valor for chave, valor in request.headers.items()}
    # o token do webhook de e-mail pode vir na URL cadastrada no provedor
    # (SendGrid e Mailgun não deixam escolher cabeçalhos)
    token = request.query_params.get("token")
    if "x-ihchat-token" not in cabecalhos and token:
        cabecalhos["x-ihchat-token"] = token
    if not adaptador.verificar_assinatura(corpo, cabecalhos):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "assinatura invalida")

    tipo_conteudo = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if isinstance(adaptador, AdaptadorEmail) and tipo_conteudo in TIPOS_DE_FORMULARIO:
        # SendGrid Inbound Parse e Mailgun entregam em formulário, não em JSON
        campos, arquivos = await _formulario(request)
        lotes = [(canal, adaptador.analisar_formulario(campos, arquivos), [])]
    else:
        payload = _objeto_do_corpo(corpo)
        lotes = [
            (destino, adaptador_destino.analisar_webhook(parte), adaptador_destino.analisar_status(parte))
            for destino, adaptador_destino, parte in _destinos(sessao, canal, adaptador, payload)
        ]

    novas, conversas, atualizadas = [], {}, []
    for destino, recebidas, recibos in lotes:
        for recebida in recebidas:
            mensagem = registrar_entrada(sessao, destino, recebida)
            if mensagem is not None:  # None = reentrega do mesmo webhook
                novas.append(mensagem)
                conversas[mensagem.conversa_id] = mensagem.conversa
        atualizadas.extend(aplicar_status_externo(sessao, recibos))
    sessao.commit()

    for mensagem in novas:
        publicar_mensagem(mensagem)
    for conversa in conversas.values():
        publicar_conversa(conversa)
    for mensagem in atualizadas:
        publicar_mensagem(mensagem, "mensagem.status")

    return {"recebidas": len(novas), "status_atualizados": len(atualizadas)}

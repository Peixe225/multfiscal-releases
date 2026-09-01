"""Coleta periodica dos canais que nao tem webhook (e-mail via IMAP)."""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select

from .canais.base import ErroCanal
from .canais.registro import adaptador_para
from .db import SessaoLocal
from .models import Canal, TipoCanal
from .servicos.mensagens import publicar_conversa, publicar_mensagem, registrar_entrada

log = logging.getLogger("omnichannel.coletor")
INTERVALO_PADRAO = 60


def coletar_uma_vez() -> int:
    """Le as caixas de entrada configuradas. Devolve quantas mensagens entraram."""
    total = 0
    with SessaoLocal() as sessao:
        canais = sessao.scalars(
            select(Canal).where(Canal.tipo == TipoCanal.EMAIL.value, Canal.ativo.is_(True))
        ).all()
        for canal in canais:
            adaptador = adaptador_para(canal)
            if not adaptador.configurado:
                continue
            try:
                recebidas = adaptador.coletar()
            except ErroCanal as exc:
                log.warning("canal %s: %s", canal.nome, exc)
                continue
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
            total += len(novas)
    return total


async def laco(intervalo: int = INTERVALO_PADRAO) -> None:
    while True:
        try:
            await asyncio.to_thread(coletar_uma_vez)
        except asyncio.CancelledError:
            raise
        except Exception:  # nao derruba o laco por causa de um canal quebrado
            log.exception("falha no ciclo de coleta")
        await asyncio.sleep(intervalo)

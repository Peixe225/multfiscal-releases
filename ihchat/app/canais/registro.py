"""Fabrica de adaptadores a partir de um canal cadastrado."""
from __future__ import annotations

from ..models import Canal, TipoCanal
from .base import AdaptadorCanal
from .email import AdaptadorEmail
from .telegram import AdaptadorTelegram
from .webchat import AdaptadorWebchat
from .whatsapp import AdaptadorWhatsApp
from .whatsapp_qr import AdaptadorWhatsAppQR

ADAPTADORES: dict[str, type[AdaptadorCanal]] = {
    TipoCanal.WHATSAPP.value: AdaptadorWhatsApp,
    TipoCanal.WHATSAPP_QR.value: AdaptadorWhatsAppQR,
    TipoCanal.TELEGRAM.value: AdaptadorTelegram,
    TipoCanal.EMAIL.value: AdaptadorEmail,
    TipoCanal.WEBCHAT.value: AdaptadorWebchat,
}


class CanalNaoSuportado(Exception):
    pass


def adaptador_para(canal: Canal) -> AdaptadorCanal:
    classe = ADAPTADORES.get(canal.tipo)
    if classe is None:
        raise CanalNaoSuportado(f"tipo de canal desconhecido: {canal.tipo}")
    return classe(canal)

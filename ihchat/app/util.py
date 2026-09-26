"""Utilidades pequenas usadas em varios modulos."""
from __future__ import annotations

import re
from datetime import datetime, timezone


def garantir_utc(valor: datetime | None) -> datetime | None:
    """SQLite devolve datetimes sem fuso; normaliza tudo para UTC ciente.

    Sem isso, comparar uma data lida do banco com `agora()` levanta
    TypeError ("offset-naive and offset-aware").
    """
    if valor is None:
        return None
    if valor.tzinfo is None:
        return valor.replace(tzinfo=timezone.utc)
    return valor.astimezone(timezone.utc)


def normalizar_telefone(numero: str) -> str:
    """Mantem apenas digitos; e assim que o WhatsApp identifica o contato."""
    return re.sub(r"\D", "", numero or "")


def resumir(texto: str, limite: int = 160) -> str:
    texto = " ".join((texto or "").split())
    return texto if len(texto) <= limite else texto[: limite - 1] + "…"

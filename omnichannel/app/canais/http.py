"""Cliente HTTP compartilhado pelos adaptadores.

O transporte pode ser trocado nos testes, evitando qualquer chamada de rede.
"""
from __future__ import annotations

import contextlib
from typing import Iterator

import httpx

from ..config import obter_config

_transporte: httpx.BaseTransport | None = None


def definir_transporte(transporte: httpx.BaseTransport | None) -> None:
    global _transporte
    _transporte = transporte


@contextlib.contextmanager
def cliente() -> Iterator[httpx.Client]:
    with httpx.Client(timeout=obter_config().timeout_http, transport=_transporte) as c:
        yield c

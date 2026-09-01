"""Barramento de eventos em memoria que alimenta os fluxos SSE.

As rotas que gravam no banco sao sincronas (rodam no threadpool do FastAPI),
enquanto os assinantes SSE sao corrotinas. Por isso a entrega passa por
`call_soon_threadsafe`: `asyncio.Queue.put_nowait` chamado de outra thread nao
acorda o consumidor de forma confiavel.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import threading
from collections.abc import AsyncIterator, Callable
from typing import Any

LIMITE_FILA = 500


class Assinante:
    def __init__(self, loop: asyncio.AbstractEventLoop, filtro: Callable[[dict], bool] | None):
        self.fila: asyncio.Queue[dict] = asyncio.Queue(maxsize=LIMITE_FILA)
        self.loop = loop
        self.filtro = filtro

    def entregar(self, evento: dict) -> None:
        if self.filtro and not self.filtro(evento):
            return
        try:
            self.fila.put_nowait(evento)
        except asyncio.QueueFull:
            # assinante lento: descarta o mais antigo para nao travar o publicador
            with contextlib.suppress(asyncio.QueueEmpty):
                self.fila.get_nowait()
            with contextlib.suppress(asyncio.QueueFull):
                self.fila.put_nowait(evento)


class Barramento:
    def __init__(self) -> None:
        self._assinantes: set[Assinante] = set()
        self._trava = threading.Lock()

    def publicar(self, tipo: str, dados: Any) -> None:
        evento = {"tipo": tipo, "dados": dados}
        with self._trava:
            alvos = list(self._assinantes)
        for assinante in alvos:
            try:
                assinante.loop.call_soon_threadsafe(assinante.entregar, evento)
            except RuntimeError:
                # o loop do assinante ja foi encerrado; sera removido ao sair
                continue

    def _registrar(self, assinante: Assinante) -> None:
        with self._trava:
            self._assinantes.add(assinante)

    def _remover(self, assinante: Assinante) -> None:
        with self._trava:
            self._assinantes.discard(assinante)

    @property
    def total_assinantes(self) -> int:
        with self._trava:
            return len(self._assinantes)

    async def fluxo(self, filtro: Callable[[dict], bool] | None = None) -> AsyncIterator[str]:
        """Gera o corpo text/event-stream, com ping periodico para manter viva."""
        assinante = Assinante(asyncio.get_running_loop(), filtro)
        self._registrar(assinante)
        try:
            yield ": conectado\n\n"
            while True:
                try:
                    evento = await asyncio.wait_for(assinante.fila.get(), timeout=25)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                dados = json.dumps(evento["dados"], ensure_ascii=False, default=str)
                yield f"event: {evento['tipo']}\ndata: {dados}\n\n"
        finally:
            self._remover(assinante)


barramento = Barramento()

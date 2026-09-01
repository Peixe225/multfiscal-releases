"""Aplicacao OmniChannel 2."""
from __future__ import annotations

import asyncio
import contextlib
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import coletor
from .api import (
    anexos,
    atendentes,
    canais,
    catalogo,
    contatos,
    conversas,
    eventos,
    metricas,
    webhooks,
    widget,
)
from .config import obter_config
from .db import criar_tabelas

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

WEB = Path(__file__).parent / "web"


@contextlib.asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    config = obter_config()
    criar_tabelas()
    tarefa: asyncio.Task | None = None
    if config.coletor_ativo:
        tarefa = asyncio.create_task(coletor.laco(config.intervalo_coleta))
    try:
        yield
    finally:
        if tarefa is not None:
            tarefa.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await tarefa


def criar_app() -> FastAPI:
    config = obter_config()
    app = FastAPI(
        title=config.nome_aplicacao,
        version=config.versao,
        description="Central de atendimento unificada: WhatsApp, Telegram, e-mail e webchat "
        "numa unica caixa de entrada.",
        lifespan=ciclo_de_vida,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.origens_permitidas,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from .api import auth

    for modulo in (
        auth,
        anexos,
        atendentes,
        canais,
        contatos,
        catalogo,
        conversas,
        eventos,
        metricas,
        widget,
        webhooks,
    ):
        app.include_router(modulo.rotas)

    app.mount("/static", StaticFiles(directory=WEB), name="static")

    @app.get("/saude", tags=["infra"])
    def saude() -> dict:
        return {"status": "ok", "aplicacao": config.nome_aplicacao, "versao": config.versao}

    @app.get("/", include_in_schema=False)
    def raiz() -> RedirectResponse:
        return RedirectResponse("/painel")

    @app.get("/painel", include_in_schema=False)
    def painel() -> FileResponse:
        return FileResponse(WEB / "painel.html")

    @app.get("/widget.js", include_in_schema=False)
    def widget_js() -> FileResponse:
        return FileResponse(WEB / "widget.js", media_type="application/javascript")

    @app.get("/widget/demo", include_in_schema=False)
    def widget_demo() -> FileResponse:
        return FileResponse(WEB / "demo.html")

    return app


app = criar_app()

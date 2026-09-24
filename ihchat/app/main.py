"""Aplicacao IHchat."""
from __future__ import annotations

import asyncio
import contextlib
import logging
import re
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
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
    simulador,
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


# senha e segredo nunca voltam na resposta, nem para quem os digitou (a mesma
# regra do Validador do PHP): o 422 do FastAPI devolve o "input" de cada erro
_CAMPO_SENSIVEL = re.compile(r"senha|segredo|secret|token|password", re.IGNORECASE)


def _sem_segredos(valor):
    if isinstance(valor, dict):
        return {k: _sem_segredos(v) for k, v in valor.items() if not _CAMPO_SENSIVEL.search(str(k))}
    if isinstance(valor, list):
        return [_sem_segredos(v) for v in valor]
    return valor


async def erro_de_validacao(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """O 422 de sempre ({"detail": [{type, loc, msg, input}]}), sem segredos."""
    erros = []
    for erro in exc.errors():
        erro = dict(erro)
        if any(isinstance(parte, str) and _CAMPO_SENSIVEL.search(parte) for parte in erro.get("loc", ())):
            erro.pop("input", None)
        elif "input" in erro:
            erro["input"] = _sem_segredos(erro["input"])
        erros.append(erro)
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(erros)})


class CabecalhosDeSeguranca:
    """Os mesmos cabeçalhos que o servidor PHP põe em toda resposta.

    Middleware ASGI puro (e não @app.middleware): só mexe no início da
    resposta, então não segura nem bufferiza o fluxo SSE.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        caminho = scope.get("path", "")

        async def enviar(mensagem):
            if mensagem["type"] == "http.response.start":
                cabecalhos = list(mensagem.get("headers", []))
                nomes = {nome.lower() for nome, _ in cabecalhos}

                def por(nome: bytes, valor: bytes) -> None:
                    if nome not in nomes:
                        cabecalhos.append((nome, valor))
                        nomes.add(nome)

                por(b"x-content-type-options", b"nosniff")
                por(b"referrer-policy", b"same-origin")
                if caminho.startswith("/api/"):
                    # dados de atendimento e tokens fora de cache de proxy e do navegador
                    por(b"cache-control", b"no-store")
                tipo = next((v for n, v in cabecalhos if n.lower() == b"content-type"), b"")
                if tipo.startswith(b"text/html"):
                    # o painel nunca pode ser emoldurado por outro site (clickjacking)
                    por(b"content-security-policy", b"frame-ancestors 'self'")
                    por(b"x-frame-options", b"SAMEORIGIN")
                mensagem = {**mensagem, "headers": cabecalhos}
            await send(mensagem)

        await self.app(scope, receive, enviar)


class ConfirmarAntesDeResponder:
    """Segura o fim da resposta até a rota terminar de verdade.

    A sessão do banco (app/db.py) é uma dependência com yield, e o FastAPI,
    no escopo padrão ("request"), roda o commit DEPOIS de a resposta sair.
    O navegador recebia o 201 e mandava o pedido seguinte antes do commit:
    o widget abria a sessão e a primeira mensagem voltava "sessao do widget
    invalida"; o canal recém-criado dava 404. E um commit que falhasse
    deixava para trás um 201 mentiroso.

    Aqui o início e o corpo de uma resposta de uma parte só ficam guardados
    até a rota voltar (commit feito). Se o commit falhar, o erro chega ao
    ServerErrorMiddleware com a resposta ainda não iniciada, e sai 500.
    Resposta em partes (SSE, arquivo grande) segue na hora, sem buffer.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        guardadas: list[dict] = []
        fluindo = False

        async def enviar(mensagem):
            nonlocal fluindo
            if fluindo:
                return await send(mensagem)
            parte_final = mensagem["type"] == "http.response.body" and not mensagem.get("more_body", False)
            if mensagem["type"] == "http.response.start" or parte_final:
                guardadas.append(mensagem)
                return
            # corpo em partes (ou outra extensão): daqui em diante passa direto
            fluindo = True
            for guardada in guardadas:
                await send(guardada)
            guardadas.clear()
            await send(mensagem)

        await self.app(scope, receive, enviar)
        for guardada in guardadas:
            await send(guardada)


def criar_app() -> FastAPI:
    config = obter_config()
    app = FastAPI(
        title=config.nome_aplicacao,
        version=config.versao,
        description="Central de atendimento unificada: WhatsApp, Telegram, e-mail e webchat "
        "numa unica caixa de entrada.",
        lifespan=ciclo_de_vida,
    )
    app.add_exception_handler(RequestValidationError, erro_de_validacao)
    # o mais interno: envolve a rota e o commit da sessão
    app.add_middleware(ConfirmarAntesDeResponder)
    app.add_middleware(CabecalhosDeSeguranca)
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
        simulador,
        widget,
        webhooks,
    ):
        app.include_router(modulo.rotas)

    app.mount("/static", StaticFiles(directory=WEB), name="static")

    @app.get("/saude", tags=["infra"])
    def saude() -> dict:
        # "stream": o front usa EventSource. O PHP (hospedagem compartilhada,
        # sem conexão longa) responde "consulta" e o front pergunta a cada 2 s
        return {
            "status": "ok",
            "aplicacao": config.nome_aplicacao,
            "versao": config.versao,
            "eventos": "stream",
        }

    @app.get("/", include_in_schema=False)
    def raiz() -> RedirectResponse:
        return RedirectResponse("/painel")

    @app.get("/painel", include_in_schema=False)
    def painel() -> FileResponse:
        return FileResponse(WEB / "painel.html")

    @app.get("/simulador", include_in_schema=False)
    def pagina_simulador() -> FileResponse:
        return FileResponse(WEB / "simulador.html")

    @app.get("/widget.js", include_in_schema=False)
    def widget_js() -> FileResponse:
        return FileResponse(WEB / "widget.js", media_type="application/javascript")

    @app.get("/widget/demo", include_in_schema=False)
    def widget_demo() -> FileResponse:
        return FileResponse(WEB / "demo.html")

    return app


app = criar_app()

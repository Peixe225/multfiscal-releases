"""A resposta só sai depois do commit da sessão (app/main.py).

A dependência de sessão confirma no fim do escopo "request" do FastAPI, que
termina DEPOIS de a resposta sair: o cliente via 201 antes de o dado existir
para o próximo pedido, e um commit que falhasse virava um 201 falso.
"""
import asyncio

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.main import ConfirmarAntesDeResponder


def _app_com_dependencia(ao_sair):
    app = FastAPI()

    def dependencia():
        yield
        ao_sair()

    @app.post("/coisa", status_code=201, dependencies=[Depends(dependencia)])
    def criar():
        return {"ok": True}

    app.add_middleware(ConfirmarAntesDeResponder)
    return app


def test_resposta_espera_o_fim_da_dependencia():
    ordem = []
    app = _app_com_dependencia(lambda: ordem.append("commit"))

    async def cenario():
        async def receber():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def enviar(mensagem):
            ordem.append(mensagem["type"])

        escopo = {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
            "scheme": "http", "path": "/coisa", "raw_path": b"/coisa", "query_string": b"",
            "headers": [], "client": ("127.0.0.1", 1), "server": ("teste", 80), "root_path": "",
        }
        await app(escopo, receber, enviar)

    asyncio.run(cenario())
    assert ordem == ["commit", "http.response.start", "http.response.body"]


def test_commit_que_falha_vira_500_e_nao_201():
    def falhar():
        raise RuntimeError("o banco recusou o commit")

    with TestClient(_app_com_dependencia(falhar), raise_server_exceptions=False) as cliente:
        assert cliente.post("/coisa").status_code == 500


def test_corpo_em_partes_passa_direto():
    """SSE e arquivo grande (corpo em partes) não ficam guardados."""
    enviados = []

    async def app_em_partes(escopo, receber, enviar):
        await enviar({"type": "http.response.start", "status": 200, "headers": []})
        await enviar({"type": "http.response.body", "body": b": conectado\n\n", "more_body": True})
        enviados.append("depois-da-primeira-parte")
        await enviar({"type": "http.response.body", "body": b"", "more_body": False})

    async def cenario():
        async def enviar(mensagem):
            enviados.append(mensagem["type"])

        await ConfirmarAntesDeResponder(app_em_partes)({"type": "http"}, None, enviar)

    asyncio.run(cenario())
    assert enviados == ["http.response.start", "http.response.body", "depois-da-primeira-parte", "http.response.body"]

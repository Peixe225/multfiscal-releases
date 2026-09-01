"""Envio real pelos adaptadores, com o transporte HTTP substituido."""
import httpx
import pytest
from conftest import criar_canal, payload_whatsapp

from app.canais import http as canal_http
from app.db import SessaoLocal
from app.models import Conversa, Mensagem, TipoCanal


def transporte(handler):
    canal_http.definir_transporte(httpx.MockTransport(handler))


@pytest.fixture
def canal_whatsapp_configurado():
    return criar_canal(
        TipoCanal.WHATSAPP,
        "WhatsApp Produção",
        credenciais={"token": "tk-123", "id_numero": "5599"},
    )


def _abrir_conversa(cliente, canal, numero="5533991269149", externo="wamid.1"):
    cliente.post(f"/webhooks/{canal.id}", json=payload_whatsapp(numero, "oi", externo))
    with SessaoLocal() as sessao:
        return sessao.query(Conversa).one().id


def test_envio_pelo_whatsapp_chama_a_api_da_meta(
    cliente, cabecalho_atendente, canal_whatsapp_configurado
):
    chamadas = []

    def responder(requisicao: httpx.Request) -> httpx.Response:
        chamadas.append(requisicao)
        return httpx.Response(200, json={"messages": [{"id": "wamid.enviada"}]})

    transporte(responder)
    conversa_id = _abrir_conversa(cliente, canal_whatsapp_configurado)

    resposta = cliente.post(
        f"/api/conversas/{conversa_id}/mensagens",
        headers=cabecalho_atendente,
        json={"conteudo": "Bom dia!"},
    )
    assert resposta.status_code == 201
    assert resposta.json()["status"] == "enviada"

    requisicao = chamadas[-1]
    assert requisicao.url.path.endswith("/5599/messages")
    assert requisicao.headers["authorization"] == "Bearer tk-123"
    import json as _json

    corpo = _json.loads(requisicao.content)
    assert corpo["to"] == "5533991269149"
    assert corpo["text"]["body"] == "Bom dia!"

    with SessaoLocal() as sessao:
        mensagem = sessao.get(Mensagem, resposta.json()["id"])
        assert mensagem.externo_id == "whatsapp:wamid.enviada"


def test_erro_do_provedor_vira_mensagem_com_falha(
    cliente, cabecalho_atendente, canal_whatsapp_configurado
):
    transporte(lambda _: httpx.Response(401, json={"error": {"message": "token expirado"}}))
    conversa_id = _abrir_conversa(cliente, canal_whatsapp_configurado)

    resposta = cliente.post(
        f"/api/conversas/{conversa_id}/mensagens",
        headers=cabecalho_atendente,
        json={"conteudo": "Bom dia!"},
    )
    # a resposta continua 201: a mensagem existe, marcada como falha, e pode
    # ser reenviada pelo painel sem perder o texto digitado
    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["status"] == "falhou"
    assert "401" in corpo["erro"]


def test_queda_de_rede_nao_derruba_a_requisicao(
    cliente, cabecalho_atendente, canal_whatsapp_configurado
):
    def cair(_):
        raise httpx.ConnectError("sem rota para o host")

    transporte(cair)
    conversa_id = _abrir_conversa(cliente, canal_whatsapp_configurado)

    corpo = cliente.post(
        f"/api/conversas/{conversa_id}/mensagens",
        headers=cabecalho_atendente,
        json={"conteudo": "teste"},
    ).json()
    assert corpo["status"] == "falhou"
    assert "rede" in corpo["erro"]


def test_envio_pelo_telegram(cliente, cabecalho_atendente):
    canal = criar_canal(TipoCanal.TELEGRAM, "TG", credenciais={"token": "bot-token"})
    transporte(lambda _: httpx.Response(200, json={"ok": True, "result": {"message_id": 55}}))

    cliente.post(
        f"/webhooks/{canal.id}",
        json={"message": {"message_id": 1, "chat": {"id": 884412}, "from": {"first_name": "Zé"}, "text": "oi"}},
    )
    with SessaoLocal() as sessao:
        conversa_id = sessao.query(Conversa).one().id

    corpo = cliente.post(
        f"/api/conversas/{conversa_id}/mensagens",
        headers=cabecalho_atendente,
        json={"conteudo": "Olá!"},
    ).json()
    assert corpo["status"] == "enviada"
    with SessaoLocal() as sessao:
        assert sessao.get(Mensagem, corpo["id"]).externo_id == "telegram:884412-55"


def test_telegram_recusando_o_envio(cliente, cabecalho_atendente):
    canal = criar_canal(TipoCanal.TELEGRAM, "TG", credenciais={"token": "bot-token"})
    transporte(lambda _: httpx.Response(200, json={"ok": False, "description": "chat not found"}))
    cliente.post(
        f"/webhooks/{canal.id}",
        json={"message": {"message_id": 1, "chat": {"id": 1}, "from": {"first_name": "X"}, "text": "oi"}},
    )
    with SessaoLocal() as sessao:
        conversa_id = sessao.query(Conversa).one().id

    corpo = cliente.post(
        f"/api/conversas/{conversa_id}/mensagens", headers=cabecalho_atendente, json={"conteudo": "oi"}
    ).json()
    assert corpo["status"] == "falhou"
    assert "chat not found" in corpo["erro"]


def test_sem_credenciais_o_envio_e_apenas_simulado(cliente, cabecalho_atendente, canal_whatsapp):
    def nao_deveria_chamar(_):  # pragma: no cover
        raise AssertionError("o modo sandbox nao pode chamar o provedor")

    transporte(nao_deveria_chamar)
    conversa_id = _abrir_conversa(cliente, canal_whatsapp)

    corpo = cliente.post(
        f"/api/conversas/{conversa_id}/mensagens", headers=cabecalho_atendente, json={"conteudo": "oi"}
    ).json()
    assert corpo["status"] == "simulada"

import hashlib
import hmac
import json

from conftest import criar_canal, payload_whatsapp

from app.db import SessaoLocal
from app.models import Conversa, Mensagem, TipoCanal


def test_webhook_whatsapp_cria_contato_conversa_e_mensagem(cliente, canal_whatsapp):
    resposta = cliente.post(
        f"/webhooks/{canal_whatsapp.id}",
        json=payload_whatsapp("5500912345678", "Bom dia, preciso de ajuda", "wamid.1", "Ian"),
    )
    assert resposta.status_code == 200
    assert resposta.json()["recebidas"] == 1

    with SessaoLocal() as sessao:
        conversa = sessao.query(Conversa).one()
        assert conversa.contato.nome == "Ian"
        assert conversa.contato.telefone == "5500912345678"
        assert conversa.nao_lidas == 1
        assert conversa.previa == "Bom dia, preciso de ajuda"
        mensagem = sessao.query(Mensagem).one()
        assert mensagem.direcao == "entrada"
        assert mensagem.externo_id == "whatsapp:wamid.1"


def test_reentrega_do_mesmo_webhook_nao_duplica(cliente, canal_whatsapp):
    payload = payload_whatsapp("5500912345678", "oi", "wamid.repetido")
    primeira = cliente.post(f"/webhooks/{canal_whatsapp.id}", json=payload)
    segunda = cliente.post(f"/webhooks/{canal_whatsapp.id}", json=payload)

    assert primeira.json()["recebidas"] == 1
    assert segunda.json()["recebidas"] == 0
    with SessaoLocal() as sessao:
        assert sessao.query(Mensagem).count() == 1


def test_mensagens_seguidas_ficam_na_mesma_conversa(cliente, canal_whatsapp):
    for indice in range(3):
        cliente.post(
            f"/webhooks/{canal_whatsapp.id}",
            json=payload_whatsapp("5511999999999", f"mensagem {indice}", f"wamid.{indice}"),
        )
    with SessaoLocal() as sessao:
        assert sessao.query(Conversa).count() == 1
        conversa = sessao.query(Conversa).one()
        assert conversa.nao_lidas == 3
        assert len(conversa.mensagens) == 3


def test_webhook_valida_assinatura_quando_ha_segredo(cliente):
    canal = criar_canal(TipoCanal.WHATSAPP, "WA assinado", segredo_webhook="segredo-forte")
    corpo = json.dumps(payload_whatsapp("5511988887777", "olá", "wamid.assinado")).encode()

    sem_assinatura = cliente.post(
        f"/webhooks/{canal.id}", content=corpo, headers={"content-type": "application/json"}
    )
    assert sem_assinatura.status_code == 401

    assinatura = hmac.new(b"segredo-forte", corpo, hashlib.sha256).hexdigest()
    com_assinatura = cliente.post(
        f"/webhooks/{canal.id}",
        content=corpo,
        headers={"content-type": "application/json", "x-hub-signature-256": f"sha256={assinatura}"},
    )
    assert com_assinatura.status_code == 200


def test_handshake_de_verificacao_do_whatsapp(cliente):
    canal = criar_canal(TipoCanal.WHATSAPP, "WA verificado", credenciais={"token_verificacao": "abc"})
    ok = cliente.get(
        f"/webhooks/{canal.id}",
        params={"hub.mode": "subscribe", "hub.verify_token": "abc", "hub.challenge": "12345"},
    )
    assert ok.status_code == 200 and ok.text == "12345"

    recusado = cliente.get(
        f"/webhooks/{canal.id}",
        params={"hub.mode": "subscribe", "hub.verify_token": "errado", "hub.challenge": "12345"},
    )
    assert recusado.status_code == 403


def test_webhook_do_telegram(cliente, canal_telegram):
    resposta = cliente.post(
        f"/webhooks/{canal_telegram.id}",
        json={
            "message": {
                "message_id": 7,
                "chat": {"id": 884412},
                "from": {"first_name": "Marcos", "last_name": "Silva"},
                "text": "Tenho uma dúvida",
            }
        },
    )
    assert resposta.json()["recebidas"] == 1
    with SessaoLocal() as sessao:
        conversa = sessao.query(Conversa).one()
        assert conversa.contato.nome == "Marcos Silva"
        assert conversa.mensagens[0].externo_id == f"telegram:{canal_telegram.id}:884412-7"


def test_canal_desativado_recusa_webhook(cliente, canal_whatsapp):
    canal = criar_canal(TipoCanal.WHATSAPP, "Desativado", ativo=False)
    resposta = cliente.post(f"/webhooks/{canal.id}", json=payload_whatsapp("551199", "x", "wamid.z"))
    assert resposta.status_code == 409


def test_canal_inexistente(cliente):
    assert cliente.post("/webhooks/9999", json={}).status_code == 404


def test_recibo_de_entrega_atualiza_status(cliente, cabecalho_atendente, canal_whatsapp):
    cliente.post(
        f"/webhooks/{canal_whatsapp.id}", json=payload_whatsapp("5511911112222", "oi", "wamid.a")
    )
    with SessaoLocal() as sessao:
        conversa_id = sessao.query(Conversa).one().id
    enviada = cliente.post(
        f"/api/conversas/{conversa_id}/mensagens",
        headers=cabecalho_atendente,
        json={"conteudo": "Olá!"},
    )
    # em sandbox a mensagem sai como simulada e sem id externo, entao o recibo
    # e testado sobre um id externo conhecido
    with SessaoLocal() as sessao:
        mensagem = sessao.get(Mensagem, enviada.json()["id"])
        mensagem.externo_id = "whatsapp:wamid.saida"
        sessao.commit()

    cliente.post(
        f"/webhooks/{canal_whatsapp.id}",
        json={"entry": [{"changes": [{"value": {"statuses": [{"id": "wamid.saida", "status": "read"}]}}]}]},
    )
    with SessaoLocal() as sessao:
        assert sessao.get(Mensagem, enviada.json()["id"]).status == "lida"

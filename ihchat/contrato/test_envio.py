"""Envio de verdade pelos adaptadores (provedor falso no lugar da Meta/Telegram).

Porte de tests/test_envio.py só com HTTP: a resposta do atendente sai por
POST /api/conversas/{id}/mensagens e o que o servidor mandou ao provedor é
conferido no registro do provedor falso.
"""
from __future__ import annotations

import json
import random
import socket

import pytest

from utilitarios import criar_canal, exigir_rota, unico


def numero() -> str:
    return "55009" + "".join(random.choice("0123456789") for _ in range(8))


def payload_whatsapp(numero_: str, texto: str, externo_id: str) -> dict:
    return {"entry": [{"changes": [{"value": {
        "contacts": [{"wa_id": numero_, "profile": {"name": "Cliente"}}],
        "messages": [{"from": numero_, "id": externo_id, "type": "text", "text": {"body": texto}}],
    }}]}]}


def exigir_provedor(servidor, provedor) -> None:
    """Os dois alvos leem IHCHAT_TESTE_PROVEDOR: sem chamada registrada, o envio nem saiu."""
    assert provedor.chamadas(), f"o servidor ({servidor.alvo}) não chamou o provedor falso"


def abrir_conversa(cliente, cabecalho, canal: dict, entrega: dict, cabecalhos: dict | None = None) -> int:
    assert cliente.post(f"/webhooks/{canal['id']}", json=entrega, headers=cabecalhos or {}).json()["recebidas"] == 1
    resposta = exigir_rota(cliente.get("/api/conversas", params={"canal_id": canal["id"]}, headers=cabecalho), "GET /api/conversas")
    [conversa] = resposta.json()
    return conversa["id"]


def responder(cliente, cabecalho, conversa_id: int, texto: str):
    return exigir_rota(
        cliente.post(f"/api/conversas/{conversa_id}/mensagens", headers=cabecalho, json={"conteudo": texto}),
        "POST /api/conversas/{id}/mensagens",
    )


@pytest.fixture
def whatsapp_configurado(cliente, cabecalho_admin) -> dict:
    return criar_canal(cliente, cabecalho_admin, "whatsapp", credenciais={"token": "tk-123", "id_numero": "5599"})


def _telegram(cliente, cabecalho_admin) -> tuple[dict, dict]:
    canal = criar_canal(cliente, cabecalho_admin, "telegram", credenciais={"token": "bot-token"})
    segredo = cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho_admin).json()["segredo_webhook"]
    return canal, {"x-telegram-bot-api-secret-token": segredo}


# ---------------------------------------------------------------- WhatsApp
def test_envio_pelo_whatsapp_chama_a_api_da_meta(cliente, cabecalho_atendente, whatsapp_configurado, servidor, provedor):
    telefone = numero()
    conversa_id = abrir_conversa(cliente, cabecalho_atendente, whatsapp_configurado, payload_whatsapp(telefone, "oi", unico("wamid.")))
    provedor.roteirar("/messages", metodo="POST", json={"messages": [{"id": unico("wamid.enviada")}]})

    resposta = responder(cliente, cabecalho_atendente, conversa_id, "Bom dia!")
    assert resposta.status_code == 201
    exigir_provedor(servidor, provedor)
    assert resposta.json()["status"] == "enviada" and resposta.json()["erro"] is None

    chamada = provedor.chamadas()[-1]
    assert chamada["url"] == "https://graph.facebook.com/v20.0/5599/messages"
    assert chamada["cabecalhos"]["authorization"] == "Bearer tk-123"
    corpo = json.loads(chamada["corpo"])
    assert corpo["to"] == telefone and corpo["type"] == "text"
    # o texto pode vir precedido da assinatura de quem atende ("*Ana · Suporte*")
    assert corpo["text"]["body"].endswith("Bom dia!")


def test_erro_do_provedor_vira_mensagem_com_falha(cliente, cabecalho_atendente, whatsapp_configurado, servidor, provedor):
    conversa_id = abrir_conversa(cliente, cabecalho_atendente, whatsapp_configurado, payload_whatsapp(numero(), "oi", unico("wamid.")))
    provedor.roteirar("graph.facebook.com", status=401, json={"error": {"message": "token expirado"}})

    resposta = responder(cliente, cabecalho_atendente, conversa_id, "Bom dia!")
    # continua 201: a mensagem existe, marcada como falha, e pode ser reenviada
    assert resposta.status_code == 201
    exigir_provedor(servidor, provedor)
    corpo = resposta.json()
    assert corpo["status"] == "falhou" and "401" in corpo["erro"]
    assert "tk-123" not in corpo["erro"]


def test_queda_de_rede_nao_derruba_a_requisicao(cliente, cabecalho_atendente, whatsapp_configurado, servidor, provedor):
    conversa_id = abrir_conversa(cliente, cabecalho_atendente, whatsapp_configurado, payload_whatsapp(numero(), "oi", unico("wamid.")))
    provedor.roteirar("graph.facebook.com", erro_rede="sem rota para o host")

    resposta = responder(cliente, cabecalho_atendente, conversa_id, "teste")
    assert resposta.status_code == 201
    exigir_provedor(servidor, provedor)
    assert resposta.json()["status"] == "falhou" and "rede" in resposta.json()["erro"]


def test_sem_credenciais_o_envio_e_apenas_simulado(cliente, cabecalho_atendente, canal_whatsapp, provedor):
    conversa_id = abrir_conversa(cliente, cabecalho_atendente, canal_whatsapp, payload_whatsapp(numero(), "oi", unico("wamid.")))
    corpo = responder(cliente, cabecalho_atendente, conversa_id, "oi").json()
    assert corpo["status"] == "simulada"
    assert provedor.chamadas() == []  # o sandbox nunca chama o provedor


# ---------------------------------------------------------------- Telegram
def test_envio_pelo_telegram(cliente, cabecalho_admin, cabecalho_atendente, servidor, provedor):
    canal, assinatura = _telegram(cliente, cabecalho_admin)
    chat = random.randint(10**8, 10**9)
    conversa_id = abrir_conversa(
        cliente, cabecalho_atendente, canal,
        {"message": {"message_id": 1, "chat": {"id": chat}, "from": {"first_name": "Zé"}, "text": "oi"}}, assinatura,
    )
    provedor.roteirar("/sendMessage", json={"ok": True, "result": {"message_id": 55}})

    corpo = responder(cliente, cabecalho_atendente, conversa_id, "Olá!").json()
    exigir_provedor(servidor, provedor)
    assert corpo["status"] == "enviada"
    chamada = provedor.chamadas()[-1]
    assert chamada["url"] == "https://api.telegram.org/botbot-token/sendMessage"
    enviado = json.loads(chamada["corpo"])
    assert str(enviado["chat_id"]) == str(chat) and enviado["text"].endswith("Olá!")
    # o token vai só na URL do provedor, nunca na resposta ao painel
    assert "bot-token" not in json.dumps(corpo)

    # o id externo ("telegram:<chat>-55") é o que casa os recibos: um segundo
    # envio com o mesmo id do provedor não pode derrubar a resposta
    segunda = responder(cliente, cabecalho_atendente, conversa_id, "de novo")
    assert segunda.status_code == 201 and segunda.json()["status"] == "enviada"


def test_telegram_recusando_o_envio(cliente, cabecalho_admin, cabecalho_atendente, servidor, provedor):
    canal, assinatura = _telegram(cliente, cabecalho_admin)
    conversa_id = abrir_conversa(
        cliente, cabecalho_atendente, canal,
        {"message": {"message_id": 1, "chat": {"id": 1}, "from": {"first_name": "X"}, "text": "oi"}}, assinatura,
    )
    provedor.roteirar("api.telegram.org", json={"ok": False, "description": "chat not found"})
    corpo = responder(cliente, cabecalho_atendente, conversa_id, "oi").json()
    exigir_provedor(servidor, provedor)
    assert corpo["status"] == "falhou" and "chat not found" in corpo["erro"]


def test_arquivo_pelo_telegram_vai_como_documento(cliente, cabecalho_admin, cabecalho_atendente, servidor, provedor):
    canal, assinatura = _telegram(cliente, cabecalho_admin)
    conversa_id = abrir_conversa(
        cliente, cabecalho_atendente, canal,
        {"message": {"message_id": 1, "chat": {"id": 42}, "from": {"first_name": "X"}, "text": "manda o boleto"}}, assinatura,
    )
    provedor.roteirar("/sendDocument", json={"ok": True, "result": {"message_id": 9}})
    resposta = exigir_rota(
        cliente.post(f"/api/conversas/{conversa_id}/anexos", headers=cabecalho_atendente,
                     files={"arquivo": ("boleto.pdf", b"%PDF-1.4 boleto", "application/pdf")}, data={"conteudo": "Segue"}),
        "POST /api/conversas/{id}/anexos",
    )
    exigir_provedor(servidor, provedor)
    assert resposta.status_code == 201 and resposta.json()["status"] == "enviada"
    chamada = provedor.chamadas()[-1]
    assert chamada["url"].endswith("/sendDocument")
    assert chamada["cabecalhos"]["content-type"].startswith("multipart/form-data")
    assert 'name="document"; filename="boleto.pdf"' in chamada["corpo"] and "%PDF-1.4 boleto" in chamada["corpo"]
    assert 'name="chat_id"' in chamada["corpo"]


# ------------------------------------------------------------------ e-mail
def test_email_com_servidor_fora_do_ar_vira_falha_com_o_motivo(cliente, cabecalho_admin, cabecalho_atendente):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        porta = s.getsockname()[1]
    canal = criar_canal(cliente, cabecalho_admin, "email", credenciais={
        "remetente": "Suporte <suporte@empresa.com.br>", "smtp_host": "127.0.0.1", "smtp_porta": str(porta),
        "smtp_usuario": "u", "smtp_senha": "senha-que-nao-aparece",
    })
    endereco = f"{unico('cliente')}@empresa.com.br"
    # o webhook de e-mail exige o segredo do canal
    segredo = cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho_admin).json()["segredo_webhook"]
    conversa_id = abrir_conversa(
        cliente, cabecalho_atendente, canal,
        {"from": endereco, "subject": "Erro na apuração", "text": "Segue o print.", "message-id": f"<{unico()}@empresa.com.br>"},
        {"X-IHchat-Token": segredo} if segredo else None,
    )
    resposta = responder(cliente, cabecalho_atendente, conversa_id, "Segue a segunda via.")
    # a resposta do atendente vira "falhou" com o motivo, não um 500 sem registro
    assert resposta.status_code == 201, resposta.text
    corpo = resposta.json()
    assert corpo["status"] == "falhou" and "falha ao enviar e-mail" in corpo["erro"]
    assert "senha-que-nao-aparece" not in corpo["erro"]


def test_mensagem_do_cliente_com_o_id_de_uma_enviada_por_outro_bot(cliente, cabecalho_admin, cabecalho_atendente, servidor, provedor, request):
    """O bot A mandou a mensagem 7 ao usuário U; a mensagem 7 que U manda
    depois ao bot B é outra mensagem e não pode sumir como repetida."""
    chat = random.randint(10**8, 10**9)
    canal_a, assinatura_a = _telegram(cliente, cabecalho_admin)
    conversa_id = abrir_conversa(
        cliente, cabecalho_atendente, canal_a,
        {"message": {"message_id": 1, "chat": {"id": chat}, "from": {"first_name": "U"}, "text": "oi A"}}, assinatura_a,
    )
    provedor.roteirar("/sendMessage", json={"ok": True, "result": {"message_id": 7}})
    assert responder(cliente, cabecalho_atendente, conversa_id, "Olá do A").json()["status"] == "enviada"
    exigir_provedor(servidor, provedor)

    canal_b, assinatura_b = _telegram(cliente, cabecalho_admin)
    abrir_conversa(
        cliente, cabecalho_atendente, canal_b,
        {"message": {"message_id": 7, "chat": {"id": chat}, "from": {"first_name": "U"}, "text": "oi B"}}, assinatura_b,
    )


@pytest.mark.parametrize("nome, tipo, dados, especie", [
    ("foto.png", "image/png", b"\x89PNG\r\n\x1a\nimagem", "image"),
    ("anim.gif", "image/gif", b"GIF89a animacao", "document"),
    ("logo.svg", "image/svg+xml", b'<svg xmlns="http://www.w3.org/2000/svg"></svg>', "document"),
])
def test_whatsapp_so_manda_como_imagem_o_que_a_meta_aceita(
    cliente, cabecalho_atendente, whatsapp_configurado, servidor, provedor, request, nome, tipo, dados, especie
):
    """O tipo "image" da Cloud API só aceita JPEG e PNG; o resto vai como documento."""
    conversa_id = abrir_conversa(cliente, cabecalho_atendente, whatsapp_configurado, payload_whatsapp(numero(), "oi", unico("wamid.")))
    provedor.roteirar("/media", metodo="POST", json={"id": "midia-1"})
    provedor.roteirar("/messages", metodo="POST", json={"messages": [{"id": unico("wamid.env")}]})
    resposta = exigir_rota(
        cliente.post(f"/api/conversas/{conversa_id}/anexos", headers=cabecalho_atendente, files={"arquivo": (nome, dados, tipo)}),
        "POST /api/conversas/{id}/anexos",
    )
    exigir_provedor(servidor, provedor)
    assert resposta.status_code == 201 and resposta.json()["status"] == "enviada", resposta.text
    corpo = json.loads(provedor.chamadas()[-1]["corpo"])
    assert corpo["type"] == especie
    if especie == "document":
        assert corpo["document"]["filename"] == nome


@pytest.mark.parametrize("nome, tipo, dados, metodo", [
    ("foto.jpg", "image/jpeg", b"\xff\xd8\xff\xe0 jpeg", "sendPhoto"),
    ("logo.svg", "image/svg+xml", b'<svg xmlns="http://www.w3.org/2000/svg"></svg>', "sendDocument"),
    ("scan.bmp", "image/bmp", b"BM bitmap", "sendDocument"),
])
def test_telegram_so_usa_o_sendphoto_com_o_que_ele_processa(
    cliente, cabecalho_admin, cabecalho_atendente, servidor, provedor, request, nome, tipo, dados, metodo
):
    """O sendPhoto recusa SVG, HEIC, BMP (IMAGE_PROCESS_FAILED); o sendDocument entrega qualquer arquivo."""
    canal, assinatura = _telegram(cliente, cabecalho_admin)
    conversa_id = abrir_conversa(
        cliente, cabecalho_atendente, canal,
        {"message": {"message_id": 1, "chat": {"id": random.randint(10**8, 10**9)}, "from": {"first_name": "X"}, "text": "manda"}},
        assinatura,
    )
    provedor.roteirar(f"/{metodo}", json={"ok": True, "result": {"message_id": 9}})
    resposta = exigir_rota(
        cliente.post(f"/api/conversas/{conversa_id}/anexos", headers=cabecalho_atendente, files={"arquivo": (nome, dados, tipo)}),
        "POST /api/conversas/{id}/anexos",
    )
    exigir_provedor(servidor, provedor)
    assert resposta.status_code == 201 and resposta.json()["status"] == "enviada", resposta.text
    assert provedor.chamadas()[-1]["url"].endswith(f"/{metodo}")

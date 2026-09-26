"""Recepção dos webhooks dos provedores: POST/GET /webhooks/{canal_id}.

Porte de tests/test_webhooks.py e da parte de webhook de tests/test_email.py,
só com HTTP: o que o teste Python conferia no banco aqui é conferido pela API
(/api/conversas?canal_id=, /api/conversas/{id}) e, quando o alvo tem, pela
fila de eventos (/api/eventos/desde).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import random

from utilitarios import criar_canal, data_com_fuso, exigir_rota, unico


# ------------------------------------------------------------------ apoio
def numero() -> str:
    return "55009" + "".join(random.choice("0123456789") for _ in range(8))


def payload_whatsapp(numero_: str, texto: str, externo_id: str, nome: str = "Cliente") -> dict:
    return {
        "entry": [{"changes": [{"value": {
            "contacts": [{"wa_id": numero_, "profile": {"name": nome}}],
            "messages": [{"from": numero_, "id": externo_id, "type": "text", "text": {"body": texto}}],
        }}]}]
    }


def conversas_do_canal(cliente, cabecalho, canal_id: int) -> list[dict]:
    resposta = exigir_rota(
        cliente.get("/api/conversas", params={"canal_id": canal_id}, headers=cabecalho), "GET /api/conversas"
    )
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


def detalhe(cliente, cabecalho, conversa_id: int) -> dict:
    resposta = exigir_rota(cliente.get(f"/api/conversas/{conversa_id}", headers=cabecalho), "GET /api/conversas/{id}")
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


def token_do_email(cliente, cabecalho_admin, canal: dict) -> dict:
    """Cabeçalho com o segredo do webhook de e-mail (X-IHchat-Token)."""
    segredo = cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho_admin).json()["segredo_webhook"]
    return {"X-IHchat-Token": segredo} if segredo else {}


def exigir_provedor(servidor, provedor) -> None:
    """Os dois alvos leem IHCHAT_TESTE_PROVEDOR: sem chamada registrada, o envio nem saiu."""
    assert provedor.chamadas(), f"o servidor ({servidor.alvo}) não chamou o provedor falso"


# ------------------------------------------------------------- WhatsApp
def test_webhook_whatsapp_cria_contato_conversa_e_mensagem(cliente, cabecalho_atendente, canal_whatsapp):
    telefone = numero()
    resposta = cliente.post(
        f"/webhooks/{canal_whatsapp['id']}",
        json=payload_whatsapp(telefone, "Bom dia, preciso de ajuda", unico("wamid."), "Ian"),
    )
    assert resposta.status_code == 200
    assert resposta.json() == {"recebidas": 1, "status_atualizados": 0}

    [conversa] = conversas_do_canal(cliente, cabecalho_atendente, canal_whatsapp["id"])
    assert conversa["contato"]["nome"] == "Ian"
    assert conversa["contato"]["telefone"] == telefone
    assert conversa["nao_lidas"] == 1
    assert conversa["previa"] == "Bom dia, preciso de ajuda"
    assert conversa["canal"]["id"] == canal_whatsapp["id"]
    assert {"canal_tipo": "whatsapp", "identificador": telefone, "nome_exibicao": "Ian"} in conversa["contato"]["identidades"]
    [mensagem] = detalhe(cliente, cabecalho_atendente, conversa["id"])["mensagens"]
    assert mensagem["direcao"] == "entrada" and mensagem["status"] == "recebida"
    assert mensagem["conteudo"] == "Bom dia, preciso de ajuda"
    data_com_fuso(mensagem["criada_em"])


def test_numero_formatado_e_normalizado(cliente, cabecalho_atendente, canal_whatsapp):
    telefone = numero()
    formatado = f"+{telefone[:2]} ({telefone[2:4]}) {telefone[4:9]}-{telefone[9:]}"
    cliente.post(f"/webhooks/{canal_whatsapp['id']}", json=payload_whatsapp(formatado, "oi", unico("wamid.")))
    [conversa] = conversas_do_canal(cliente, cabecalho_atendente, canal_whatsapp["id"])
    assert conversa["contato"]["telefone"] == telefone


def test_reentrega_do_mesmo_webhook_nao_duplica(cliente, cabecalho_atendente, canal_whatsapp):
    payload = payload_whatsapp(numero(), "oi", unico("wamid.repetido"))
    primeira = cliente.post(f"/webhooks/{canal_whatsapp['id']}", json=payload)
    segunda = cliente.post(f"/webhooks/{canal_whatsapp['id']}", json=payload)
    assert primeira.json()["recebidas"] == 1
    assert segunda.status_code == 200 and segunda.json()["recebidas"] == 0

    [conversa] = conversas_do_canal(cliente, cabecalho_atendente, canal_whatsapp["id"])
    assert len(detalhe(cliente, cabecalho_atendente, conversa["id"])["mensagens"]) == 1


def test_mensagens_seguidas_ficam_na_mesma_conversa(cliente, cabecalho_atendente, canal_whatsapp):
    telefone = numero()
    for indice in range(3):
        cliente.post(
            f"/webhooks/{canal_whatsapp['id']}",
            json=payload_whatsapp(telefone, f"mensagem {indice}", unico(f"wamid.{indice}.")),
        )
    [conversa] = conversas_do_canal(cliente, cabecalho_atendente, canal_whatsapp["id"])
    assert conversa["nao_lidas"] == 3 and conversa["previa"] == "mensagem 2"
    assert [m["conteudo"] for m in detalhe(cliente, cabecalho_atendente, conversa["id"])["mensagens"]] == [
        "mensagem 0", "mensagem 1", "mensagem 2",
    ]


def test_varias_mensagens_numa_entrega(cliente, cabecalho_atendente, canal_whatsapp):
    a, b = numero(), numero()
    payload = {"entry": [{"changes": [{"value": {
        "contacts": [{"wa_id": a, "profile": {"name": "A"}}, {"wa_id": b, "profile": {"name": "B"}}],
        "messages": [
            {"from": a, "id": unico("wamid.a"), "type": "text", "text": {"body": "de A"}},
            {"from": b, "id": unico("wamid.b"), "type": "button", "button": {"text": "Sim"}},
            {"from": b, "id": unico("wamid.c"), "type": "reaction", "reaction": {"emoji": "👍"}},  # ignorada
        ],
    }}]}]}
    assert cliente.post(f"/webhooks/{canal_whatsapp['id']}", json=payload).json()["recebidas"] == 2
    previas = sorted(c["previa"] for c in conversas_do_canal(cliente, cabecalho_atendente, canal_whatsapp["id"]))
    assert previas == ["Sim", "de A"]


def test_webhook_valida_assinatura_quando_ha_segredo(cliente, cabecalho_admin):
    canal = criar_canal(cliente, cabecalho_admin, "whatsapp", credenciais={"segredo_app": "segredo-forte"})
    corpo = json.dumps(payload_whatsapp(numero(), "olá", unico("wamid.assinado"))).encode()

    sem = cliente.post(f"/webhooks/{canal['id']}", content=corpo, headers={"content-type": "application/json"})
    assert sem.status_code == 401 and sem.json() == {"detail": "assinatura invalida"}

    assinatura = hmac.new(b"segredo-forte", corpo, hashlib.sha256).hexdigest()
    com = cliente.post(
        f"/webhooks/{canal['id']}",
        content=corpo,
        headers={"content-type": "application/json", "x-hub-signature-256": f"sha256={assinatura}"},
    )
    assert com.status_code == 200

    # a assinatura é sobre os BYTES: o mesmo JSON reformatado não passa
    outro = json.dumps(json.loads(corpo), indent=2).encode()
    assert cliente.post(
        f"/webhooks/{canal['id']}", content=outro,
        headers={"content-type": "application/json", "x-hub-signature-256": f"sha256={assinatura}"},
    ).status_code == 401


def test_handshake_de_verificacao_do_whatsapp(cliente, cabecalho_admin):
    canal = criar_canal(cliente, cabecalho_admin, "whatsapp", credenciais={"token_verificacao": "abc"})
    ok = cliente.get(
        f"/webhooks/{canal['id']}",
        params={"hub.mode": "subscribe", "hub.verify_token": "abc", "hub.challenge": "12345"},
    )
    assert ok.status_code == 200 and ok.text == "12345"
    assert ok.headers["content-type"].startswith("text/plain")

    recusado = cliente.get(
        f"/webhooks/{canal['id']}",
        params={"hub.mode": "subscribe", "hub.verify_token": "errado", "hub.challenge": "12345"},
    )
    assert recusado.status_code == 403 and recusado.json() == {"detail": "verificacao recusada"}


def test_handshake_sem_token_de_verificacao_cadastrado_e_recusado(cliente, canal_whatsapp):
    resposta = cliente.get(
        f"/webhooks/{canal_whatsapp['id']}",
        params={"hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1"},
    )
    assert resposta.status_code == 403


def test_recibo_de_entrega_atualiza_status(cliente, cabecalho_admin, cabecalho_atendente, servidor, provedor):
    canal = criar_canal(cliente, cabecalho_admin, "whatsapp", credenciais={"token": "tk", "id_numero": "5599"})
    externo = unico("wamid.saida")
    provedor.roteirar("/messages", metodo="POST", json={"messages": [{"id": externo}]})
    cliente.post(f"/webhooks/{canal['id']}", json=payload_whatsapp(numero(), "oi", unico("wamid.a")))
    [conversa] = conversas_do_canal(cliente, cabecalho_atendente, canal["id"])
    enviada = exigir_rota(
        cliente.post(f"/api/conversas/{conversa['id']}/mensagens", headers=cabecalho_atendente, json={"conteudo": "Olá!"}),
        "POST /api/conversas/{id}/mensagens",
    )
    exigir_provedor(servidor, provedor)
    assert enviada.json()["status"] == "enviada"

    for status_meta, esperado in (("delivered", "entregue"), ("read", "lida")):
        resposta = cliente.post(
            f"/webhooks/{canal['id']}",
            json={"entry": [{"changes": [{"value": {"statuses": [{"id": externo, "status": status_meta}]}}]}]},
        )
        assert resposta.json() == {"recebidas": 0, "status_atualizados": 1}
        mensagens = detalhe(cliente, cabecalho_atendente, conversa["id"])["mensagens"]
        assert next(m for m in mensagens if m["id"] == enviada.json()["id"])["status"] == esperado

    # recibo de mensagem que não é daqui: ignorado sem erro
    resposta = cliente.post(
        f"/webhooks/{canal['id']}",
        json={"entry": [{"changes": [{"value": {"statuses": [{"id": "wamid.de-outro", "status": "read"}]}}]}]},
    )
    assert resposta.json() == {"recebidas": 0, "status_atualizados": 0}


def test_dois_numeros_no_mesmo_app_da_meta(cliente, cabecalho_admin, cabecalho_atendente, servidor, request):
    """A Meta cadastra a URL do webhook por app: as entregas de todos os números
    chegam na mesma URL, e o metadata.phone_number_id diz de qual é cada uma."""
    id_a, id_b, sem_dono = (str(random.randint(10**14, 10**15)) for _ in range(3))
    canal_a = criar_canal(cliente, cabecalho_admin, "whatsapp", credenciais={"token": "tk", "id_numero": id_a})
    canal_b = criar_canal(cliente, cabecalho_admin, "whatsapp", credenciais={"token": "tk", "id_numero": id_b})

    def valor(id_numero: str, telefone: str, texto: str) -> dict:
        return {"messaging_product": "whatsapp", "metadata": {"phone_number_id": id_numero},
                "contacts": [{"wa_id": telefone, "profile": {"name": "Cliente " + texto}}],
                "messages": [{"from": telefone, "id": unico("wamid."), "type": "text", "text": {"body": texto}}]}

    tel_a, tel_b, tel_x = numero(), numero(), numero()
    entrega = {"entry": [{"changes": [{"value": valor(id_a, tel_a, "A")}, {"value": valor(id_b, tel_b, "B")},
                                      {"value": valor(sem_dono, tel_x, "X")}]}]}
    # tudo chega na URL do canal A (a cadastrada no app)
    resposta = cliente.post(f"/webhooks/{canal_a['id']}", json=entrega)
    assert resposta.json()["recebidas"] == 2
    [conversa_a] = conversas_do_canal(cliente, cabecalho_atendente, canal_a["id"])
    [conversa_b] = conversas_do_canal(cliente, cabecalho_atendente, canal_b["id"])
    assert conversa_a["contato"]["nome"] == "Cliente A" and conversa_b["contato"]["nome"] == "Cliente B"
    # a do número que nenhum canal tem não abre conversa no canal errado
    assert all(c["contato"]["nome"] != "Cliente X" for c in conversas_do_canal(cliente, cabecalho_atendente, canal_a["id"]))


# ------------------------------------------------------------- Telegram
def test_webhook_do_telegram_confere_o_secret_token(cliente, cabecalho_admin, cabecalho_atendente, canal_telegram):
    segredo = cliente.get(f"/api/canais/{canal_telegram['id']}/credenciais", headers=cabecalho_admin).json()["segredo_webhook"]
    chat = random.randint(10**8, 10**9)
    update = {"message": {"message_id": 7, "chat": {"id": chat}, "from": {"first_name": "Marcos", "last_name": "Silva"},
                          "text": "Tenho uma dúvida"}}
    url = f"/webhooks/{canal_telegram['id']}"

    assert cliente.post(url, json=update).status_code == 401
    assert cliente.post(url, json=update, headers={"x-telegram-bot-api-secret-token": "errado"}).status_code == 401
    resposta = cliente.post(url, json=update, headers={"x-telegram-bot-api-secret-token": segredo})
    assert resposta.json()["recebidas"] == 1
    # reentrega: o id externo é chat-mensagem
    assert cliente.post(url, json=update, headers={"x-telegram-bot-api-secret-token": segredo}).json()["recebidas"] == 0

    [conversa] = conversas_do_canal(cliente, cabecalho_atendente, canal_telegram["id"])
    assert conversa["contato"]["nome"] == "Marcos Silva"
    assert {"canal_tipo": "telegram", "identificador": str(chat), "nome_exibicao": "Marcos Silva"} in conversa["contato"]["identidades"]


def test_dois_bots_do_telegram_com_o_mesmo_chat_e_message_id(cliente, cabecalho_admin, cabecalho_atendente, servidor, request):
    """Em chat privado o chat.id é o id do usuário e cada conversa bot-usuário
    numera as mensagens desde 1: dois bots recebem o mesmo par de verdade."""
    chat = random.randint(10**8, 10**9)
    for texto in ("oi bot A", "mensagem para o bot B"):
        canal = criar_canal(cliente, cabecalho_admin, "telegram")
        segredo = cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho_admin).json()["segredo_webhook"]
        update = {"message": {"message_id": 3, "chat": {"id": chat}, "from": {"first_name": "Zé"}, "text": texto}}
        resposta = cliente.post(f"/webhooks/{canal['id']}", json=update, headers={"x-telegram-bot-api-secret-token": segredo})
        assert resposta.json()["recebidas"] == 1, texto
        [conversa] = conversas_do_canal(cliente, cabecalho_atendente, canal["id"])
        assert detalhe(cliente, cabecalho_atendente, conversa["id"])["mensagens"][-1]["conteudo"] == texto


def test_update_do_telegram_sem_texto_nem_arquivo_e_ignorado(cliente, cabecalho_admin, canal_telegram):
    segredo = cliente.get(f"/api/canais/{canal_telegram['id']}/credenciais", headers=cabecalho_admin).json()["segredo_webhook"]
    for update in ({"my_chat_member": {"chat": {"id": 1}}}, {"message": {"message_id": 1, "chat": {"id": 1}, "sticker": {}}}):
        resposta = cliente.post(
            f"/webhooks/{canal_telegram['id']}", json=update, headers={"x-telegram-bot-api-secret-token": segredo}
        )
        assert resposta.status_code == 200 and resposta.json()["recebidas"] == 0


# ---------------------------------------------------------------- e-mail
def test_webhook_de_provedor_de_email_abre_conversa_com_assunto(cliente, cabecalho_admin, cabecalho_atendente, canal_email):
    token = token_do_email(cliente, cabecalho_admin, canal_email)
    endereco = f"{unico('financeiro')}@Loja.com.BR"
    corpo = {
        "from": f"Financeiro Loja <{endereco}>",
        "subject": "Segunda via do boleto",
        "text": "Bom dia, preciso da segunda via.\n",
        "message-id": f"<{unico()}@loja.com.br>",
    }
    resposta = cliente.post(f"/webhooks/{canal_email['id']}", json=corpo, headers=token)
    assert resposta.json()["recebidas"] == 1
    assert cliente.post(f"/webhooks/{canal_email['id']}", json=corpo, headers=token).json()["recebidas"] == 0  # mesmo message-id

    [conversa] = conversas_do_canal(cliente, cabecalho_atendente, canal_email["id"])
    assert conversa["assunto"] == "Segunda via do boleto"
    assert conversa["contato"]["email"] == endereco.lower()
    assert conversa["contato"]["nome"] == "Financeiro Loja"
    assert detalhe(cliente, cabecalho_atendente, conversa["id"])["mensagens"][0]["conteudo"] == "Bom dia, preciso da segunda via."


def test_email_sem_remetente_ou_corpo_e_ignorado(cliente, cabecalho_admin, canal_email):
    url = f"/webhooks/{canal_email['id']}"
    token = token_do_email(cliente, cabecalho_admin, canal_email)
    assert cliente.post(url, json={"subject": "vazio"}, headers=token).json()["recebidas"] == 0
    assert cliente.post(url, json={"from": "a@b.com.br", "text": ""}, headers=token).json()["recebidas"] == 0


def test_webhook_de_email_exige_o_token_do_canal(cliente, cabecalho_admin, cabecalho_atendente, canal_email, servidor, request):
    """Sem o segredo, qualquer um que achasse a URL (ids sequenciais) punha
    mensagens na ficha de um cliente real, e a resposta ia para o cliente."""
    url = f"/webhooks/{canal_email['id']}"
    corpo = {"from": f"Cliente <{unico('c')}@empresa.com.br>", "text": "Cancelem meu pedido", "message-id": f"<{unico()}@x>"}
    for cabecalhos in ({}, {"X-IHchat-Token": "chute"}):
        resposta = cliente.post(url, json=corpo, headers=cabecalhos)
        assert resposta.status_code == 401 and resposta.json() == {"detail": "assinatura invalida"}
    assert conversas_do_canal(cliente, cabecalho_atendente, canal_email["id"]) == []
    # o provedor não escolhe cabeçalhos: o token também vale na URL cadastrada
    segredo = token_do_email(cliente, cabecalho_admin, canal_email)["X-IHchat-Token"]
    assert cliente.post(url, params={"token": segredo}, json=corpo).json()["recebidas"] == 1


def test_webhook_de_email_em_formulario_do_sendgrid_e_do_mailgun(cliente, cabecalho_admin, cabecalho_atendente, canal_email, servidor, request):
    """SendGrid Inbound Parse (multipart, com anexo) e Mailgun (urlencoded) não mandam JSON."""
    url = f"/webhooks/{canal_email['id']}"
    segredo = token_do_email(cliente, cabecalho_admin, canal_email)["X-IHchat-Token"]
    endereco = f"{unico('sg')}@empresa.com.br"
    resposta = cliente.post(
        url, params={"token": segredo},
        data={"from": f"Cliente SG <{endereco}>", "subject": "Nota fiscal", "text": "Segue a nota.",
              "headers": f"Message-ID: <{unico()}@sendgrid.example>\nSubject: Nota fiscal"},
        files={"attachment1": ("nota.pdf", b"%PDF-1.4 nota", "application/pdf")},
    )
    assert resposta.status_code == 200 and resposta.json()["recebidas"] == 1, resposta.text
    mailgun = cliente.post(
        url, params={"token": segredo},
        content=f"sender={unico('mg')}%40empresa.com.br&subject=Oi&body-plain=Pelo+Mailgun&Message-Id=%3C{unico()}%40mg%3E".encode(),
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    assert mailgun.status_code == 200 and mailgun.json()["recebidas"] == 1, mailgun.text
    conversa = next(c for c in conversas_do_canal(cliente, cabecalho_atendente, canal_email["id"]) if c["contato"]["email"] == endereco)
    [mensagem] = detalhe(cliente, cabecalho_atendente, conversa["id"])["mensagens"]
    assert mensagem["conteudo"] == "Segue a nota." and conversa["assunto"] == "Nota fiscal"
    [anexo] = mensagem["anexos"]
    assert anexo["nome"] == "nota.pdf"
    assert cliente.get(anexo["url"], headers=cabecalho_atendente).content == b"%PDF-1.4 nota"


def test_mesmo_message_id_em_duas_caixas_chega_nas_duas(cliente, cabecalho_admin, servidor, request):
    """O cliente que escreve para suporte@ e vendas@ manda o mesmo Message-ID às duas."""
    corpo = {"from": f"{unico('c')}@empresa.com.br", "text": "Para os dois setores", "message-id": f"<{unico()}@empresa.com.br>"}
    for _ in range(2):
        canal = criar_canal(cliente, cabecalho_admin, "email")
        resposta = cliente.post(f"/webhooks/{canal['id']}", json=corpo, headers=token_do_email(cliente, cabecalho_admin, canal))
        assert resposta.json()["recebidas"] == 1


def test_webhook_do_webchat_e_recusado(cliente, cabecalho_atendente, canal_webchat, servidor, request):
    """O widget tem rotas próprias, com sessão; o webhook só servia para forjar conversas."""
    resposta = cliente.post(f"/webhooks/{canal_webchat['id']}", json={"visitante": "vis-1", "conteudo": "forjado", "nome": "Fulano"})
    assert resposta.status_code == 404 and resposta.json() == {"detail": "este canal nao recebe por webhook"}
    assert conversas_do_canal(cliente, cabecalho_atendente, canal_webchat["id"]) == []


# ---------------------------------------------------------- erros comuns
def test_canal_desativado_recusa_webhook(cliente, cabecalho_admin):
    canal = criar_canal(cliente, cabecalho_admin, "whatsapp", ativo=False)
    resposta = cliente.post(f"/webhooks/{canal['id']}", json=payload_whatsapp(numero(), "x", unico("wamid.z")))
    assert resposta.status_code == 409 and resposta.json() == {"detail": "canal desativado"}
    assert cliente.get(f"/webhooks/{canal['id']}", params={"hub.mode": "subscribe"}).status_code == 409


def test_canal_inexistente(cliente):
    resposta = cliente.post("/webhooks/99999999", json={})
    assert resposta.status_code == 404 and resposta.json() == {"detail": "canal nao encontrado"}
    assert cliente.get("/webhooks/99999999").status_code == 404


def test_id_de_canal_nao_numerico(cliente):
    assert cliente.post("/webhooks/abc", json={}).status_code == 422


def test_corpo_que_nao_e_json(cliente, canal_whatsapp):
    url = f"/webhooks/{canal_whatsapp['id']}"
    resposta = cliente.post(url, content=b"from=a%40b.com&text=oi", headers={"content-type": "application/x-www-form-urlencoded"})
    assert resposta.status_code == 400 and resposta.json() == {"detail": "corpo nao e JSON valido"}
    resposta = cliente.post(url, content=b"[1, 2]", headers={"content-type": "application/json"})
    assert resposta.status_code == 400 and resposta.json() == {"detail": "corpo deve ser um objeto JSON"}
    # corpo vazio é um objeto vazio: nada a gravar
    assert cliente.post(url, content=b"", headers={"content-type": "application/json"}).json() == {
        "recebidas": 0, "status_atualizados": 0,
    }


def test_payload_em_formato_inesperado_nao_derruba(cliente, canal_whatsapp, servidor, request):
    # a entrega vem de fora: tipo errado em qualquer campo é ignorado, não 500
    for payload in (
        {"entry": "x"},
        {"entry": [{"changes": [{"value": None}]}]},
        {"entry": [{"changes": [{"value": {"messages": [1]}}]}]},
        # status que não é texto derrubava a entrega com TypeError (500)
        {"entry": [{"changes": [{"value": {"statuses": [{"status": ["read"], "id": "wamid.X"}, {"status": 3, "id": "w"}]}}]}]},
        {"entry": [{"changes": [{"value": {"metadata": {"phone_number_id": ["x"]}, "messages": []}}]}]},
    ):
        resposta = cliente.post(f"/webhooks/{canal_whatsapp['id']}", json=payload)
        assert resposta.status_code == 200, (payload, resposta.text)
        assert resposta.json()["recebidas"] == 0


# ------------------------------------------------------ tempo real (PHP)
def test_webhook_publica_eventos_com_o_contato(cliente, cabecalho_atendente, canal_whatsapp):
    cursor = exigir_rota(
        cliente.get("/api/eventos/desde", headers=cabecalho_atendente), "GET /api/eventos/desde"
    ).json()["ultimo"]
    cliente.post(f"/webhooks/{canal_whatsapp['id']}", json=payload_whatsapp(numero(), "tempo real", unico("wamid.ev")))
    eventos = cliente.get("/api/eventos/desde", params={"depois": cursor}, headers=cabecalho_atendente).json()["eventos"]
    nova = next(e for e in eventos if e["tipo"] == "mensagem.nova" and e["dados"]["conteudo"] == "tempo real")
    atualizada = next(e for e in eventos if e["tipo"] == "conversa.atualizada" and e["dados"]["id"] == nova["dados"]["conversa_id"])
    assert nova["dados"]["direcao"] == "entrada" and nova["dados"]["contato_id"] == atualizada["dados"]["contato"]["id"]
    assert atualizada["dados"]["canal"]["id"] == canal_whatsapp["id"]

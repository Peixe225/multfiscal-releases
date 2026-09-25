"""WhatsApp pelo QR Code (tipo "whatsapp_qr"), nos dois servidores.

A sessão do WhatsApp fica num provedor online (Z-API ou Evolution API): aqui
o provedor falso da suíte faz o papel dos dois. Rotas e formatos conferidos
na documentação e no código deles: php/app/Canais/PROVEDORES-WHATSAPP.md.

    GET  /api/canais/{id}/qr            -> {status, qr, numero, mensagem}
    POST /api/canais/{id}/desconectar   -> {ok, mensagem, alerta}
    POST /api/canais/{id}/conectar-webhook
    POST /webhooks/{id}?token=<segredo do canal>

O caminho feliz do conectar-webhook (que exige url_publica) está em
test_whatsapp_qr_publico.py, com um servidor próprio.
"""
from __future__ import annotations

import base64
import json
import random

import pytest

from utilitarios import criar_canal, exigir_rota, unico

PNG = b"\x89PNG\r\n\x1a\n" + b"imagem falsa do cliente"
QR = "data:image/png;base64," + base64.b64encode(b"qr falso").decode()

INSTANCIA = "INST123"
TOKEN_INSTANCIA = "tok-instancia-secreto"
CLIENT_TOKEN = "client-token-secreto"
API_KEY = "api-key-secreta-evolution"
SERVIDOR_EVOLUTION = "https://evolution.teste"
SEGREDOS = (TOKEN_INSTANCIA, CLIENT_TOKEN, API_KEY)


def numero() -> str:
    return "55119" + "".join(random.choice("0123456789") for _ in range(8))


def sem_segredos(texto: str) -> None:
    for segredo in SEGREDOS:
        assert segredo not in texto, f"segredo vazou: {texto}"


# ------------------------------------------------------------------- canais
def canal_zapi(cliente, cabecalho_admin, **extra) -> dict:
    credenciais = {"provedor": "zapi", "instancia_id": INSTANCIA, "instancia_token": TOKEN_INSTANCIA, "client_token": CLIENT_TOKEN}
    return criar_canal(cliente, cabecalho_admin, "whatsapp_qr", credenciais=credenciais, **extra)


def canal_evolution(cliente, cabecalho_admin, instancia: str | None = None) -> dict:
    credenciais = {
        "provedor": "evolution",
        "url_servidor": SERVIDOR_EVOLUTION + "/",
        "api_key": API_KEY,
        "nome_instancia": instancia or unico("ihchat-"),
    }
    return criar_canal(cliente, cabecalho_admin, "whatsapp_qr", credenciais=credenciais)


def credenciais(cliente, cabecalho_admin, canal: dict) -> dict:
    resposta = cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho_admin)
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


def qr(cliente, cabecalho_admin, canal: dict, **params) -> dict:
    resposta = exigir_rota(
        cliente.get(f"/api/canais/{canal['id']}/qr", headers=cabecalho_admin, params=params or None), "GET /api/canais/{id}/qr"
    )
    assert resposta.status_code == 200, resposta.text
    sem_segredos(resposta.text)
    corpo = resposta.json()
    assert set(corpo) == {"status", "qr", "numero", "mensagem"}
    return corpo


def webhook(cliente, canal: dict, segredo: str | None, payload: dict):
    params = {"token": segredo} if segredo is not None else None
    return cliente.post(f"/webhooks/{canal['id']}", params=params, json=payload)


def conversa_do_canal(cliente, cabecalho, canal: dict) -> dict:
    resposta = exigir_rota(cliente.get("/api/conversas", params={"canal_id": canal["id"]}, headers=cabecalho), "GET /api/conversas")
    [conversa] = resposta.json()
    return conversa


def mensagens(cliente, cabecalho, conversa_id: int) -> list[dict]:
    return cliente.get(f"/api/conversas/{conversa_id}", headers=cabecalho).json()["mensagens"]


def responder(cliente, cabecalho, conversa_id: int, texto: str):
    return exigir_rota(
        cliente.post(f"/api/conversas/{conversa_id}/mensagens", headers=cabecalho, json={"conteudo": texto}),
        "POST /api/conversas/{id}/mensagens",
    )


def linha_da_assinatura(cliente, cabecalho) -> str:
    """A primeira linha que o cliente vê: "*Ana · Suporte técnico*" (como está AGORA)."""
    atendente = cliente.get("/api/auth/eu", headers=cabecalho).json()
    setor = (atendente.get("setor") or "").strip()
    return f"*{atendente['nome']} · {setor}*" if setor else f"*{atendente['nome']}*"


# ------------------------------------------------------ payloads da Z-API
def zapi_recebida(telefone: str, id_: str, **extra) -> dict:
    base = {
        "type": "ReceivedCallback", "instanceId": INSTANCIA, "messageId": id_, "phone": telefone,
        "fromMe": False, "fromApi": False, "isGroup": False, "isNewsletter": False, "broadcast": False,
        "senderName": "Cliente QR", "chatName": "Cliente QR", "status": "RECEIVED", "momment": 1632228638000,
    }
    return {**base, **extra}


def zapi_texto(telefone: str, id_: str, texto: str, **extra) -> dict:
    return zapi_recebida(telefone, id_, text={"message": texto}, **extra)


# ------------------------------------------------- payloads da Evolution
def evolution_upsert(instancia: str, jid: str, id_: str, mensagem: dict, tipo: str, de_mim: bool = False, **extra) -> dict:
    return {
        "event": "messages.upsert",
        "instance": instancia,
        "data": {
            "key": {"remoteJid": jid, "fromMe": de_mim, "id": id_},
            "pushName": "Você" if de_mim else "Cliente Evo",
            "message": mensagem,
            "messageType": tipo,
            "messageTimestamp": 1727200000,
            "source": "android",
            **extra,
        },
        "date_time": "2026-09-24T12:00:00.000Z",
        "sender": "5511900000000@s.whatsapp.net",
        "server_url": SERVIDOR_EVOLUTION,
        "apikey": "token-da-instancia",
    }


# ======================================================================
#   cadastro
# ======================================================================
def test_tipo_whatsapp_qr_tem_os_campos_dos_dois_provedores(cliente, cabecalho_atendente):
    tipos = exigir_rota(cliente.get("/api/canais/tipos", headers=cabecalho_atendente), "GET /api/canais/tipos").json()
    assert "whatsapp_qr" in tipos, "o tipo whatsapp_qr não existe neste servidor"
    campos = {c["chave"]: c for c in tipos["whatsapp_qr"]}
    assert list(campos) == [
        "provedor", "instancia_id", "instancia_token", "client_token", "url_servidor", "api_key", "nome_instancia",
    ]
    assert campos["provedor"]["opcoes"] == ["zapi", "evolution"] and campos["provedor"]["padrao"] == "zapi"
    assert {c for c, campo in campos.items() if campo["secreto"]} == {"instancia_token", "client_token", "api_key"}
    # trocar o servidor da Evolution exige digitar a API key de novo
    assert campos["api_key"]["destinos"] == ["url_servidor"]
    # o tipo "whatsapp" continua sendo a API oficial da Meta
    assert [c["chave"] for c in tipos["whatsapp"]][:2] == ["token", "id_numero"]


def test_canal_novo_grava_o_provedor_padrao_e_gera_o_segredo_do_webhook(cliente, cabecalho_admin):
    canal = criar_canal(cliente, cabecalho_admin, "whatsapp_qr")
    assert canal["tipo"] == "whatsapp_qr" and canal["configurado"] is False
    dados = credenciais(cliente, cabecalho_admin, canal)
    assert dados["credenciais"] == {"provedor": "zapi"}
    assert dados["campos_obrigatorios"] == ["instancia_id", "instancia_token"]
    assert isinstance(dados["segredo_webhook"], str) and len(dados["segredo_webhook"]) >= 20

    # os obrigatórios acompanham o provedor
    resposta = cliente.patch(f"/api/canais/{canal['id']}", headers=cabecalho_admin, json={"credenciais": {"provedor": "evolution"}})
    assert resposta.status_code == 200, resposta.text
    assert credenciais(cliente, cabecalho_admin, canal)["campos_obrigatorios"] == ["url_servidor", "api_key", "nome_instancia"]


def test_segredos_do_provedor_nunca_voltam_ao_navegador(cliente, cabecalho_admin):
    canal = canal_zapi(cliente, cabecalho_admin)
    assert canal["configurado"] is True
    dados = credenciais(cliente, cabecalho_admin, canal)
    assert dados["credenciais"] == {"provedor": "zapi", "instancia_id": INSTANCIA}
    assert sorted(dados["secretos_definidos"]) == ["client_token", "instancia_token"]
    sem_segredos(json.dumps(dados))
    sem_segredos(json.dumps(cliente.get("/api/canais", headers=cabecalho_admin).json()))


def test_provedor_e_endereco_da_evolution_sao_conferidos_ao_salvar(cliente, cabecalho_admin):
    canal = criar_canal(cliente, cabecalho_admin, "whatsapp_qr")
    ruim = cliente.patch(f"/api/canais/{canal['id']}", headers=cabecalho_admin, json={"credenciais": {"provedor": "baileys"}})
    assert ruim.status_code == 422
    assert ruim.json()["detail"] == "Provedor da conexão precisa ser zapi ou evolution"

    ruim = cliente.patch(f"/api/canais/{canal['id']}", headers=cabecalho_admin, json={"credenciais": {"url_servidor": "evolution.teste"}})
    assert ruim.status_code == 422
    assert ruim.json()["detail"].startswith("Endereço do servidor Evolution precisa começar com https://")

    ok = cliente.patch(
        f"/api/canais/{canal['id']}", headers=cabecalho_admin,
        json={"credenciais": {"provedor": "EVOLUTION", "url_servidor": " https://evo.teste/// "}},
    )
    assert ok.status_code == 200, ok.text
    gravadas = credenciais(cliente, cabecalho_admin, canal)["credenciais"]
    assert gravadas["provedor"] == "evolution" and gravadas["url_servidor"] == "https://evo.teste"


def test_trocar_o_servidor_da_evolution_exige_a_api_key_de_novo(cliente, cabecalho_admin):
    canal = canal_evolution(cliente, cabecalho_admin)
    resposta = cliente.patch(
        f"/api/canais/{canal['id']}", headers=cabecalho_admin, json={"credenciais": {"url_servidor": "https://outro.teste"}}
    )
    assert resposta.status_code == 422
    assert "API key (Evolution)" in resposta.json()["detail"]


# ======================================================================
#   QR Code e estado da conexão
# ======================================================================
def test_qr_sem_credenciais_diz_o_que_falta(cliente, cabecalho_admin, provedor):
    canal = criar_canal(cliente, cabecalho_admin, "whatsapp_qr")
    corpo = qr(cliente, cabecalho_admin, canal)
    assert corpo == {
        "status": "erro", "qr": None, "numero": None,
        "mensagem": "preencha: ID da instância (Z-API), Token da instância (Z-API)",
    }
    assert provedor.chamadas() == []


def test_qr_de_canal_que_nao_e_do_tipo_qr(cliente, cabecalho_admin, canal_telegram):
    corpo = qr(cliente, cabecalho_admin, canal_telegram)
    assert corpo["status"] == "erro" and "QR Code" in corpo["mensagem"]


def test_qr_exige_admin(cliente, cabecalho_atendente, cabecalho_admin):
    canal = criar_canal(cliente, cabecalho_admin, "whatsapp_qr")
    assert cliente.get(f"/api/canais/{canal['id']}/qr", headers=cabecalho_atendente).status_code == 403
    assert cliente.get(f"/api/canais/{canal['id']}/qr").status_code == 401
    assert cliente.post(f"/api/canais/{canal['id']}/desconectar", headers=cabecalho_atendente).status_code == 403


def test_zapi_qr_aguardando_leitura_e_depois_conectado(cliente, cabecalho_admin, servidor, provedor):
    canal = canal_zapi(cliente, cabecalho_admin)
    provedor.roteirar("/status", metodo="GET", json={"connected": False, "error": "You are not connected.", "smartphoneConnected": False})
    provedor.roteirar("/qr-code/image", metodo="GET", json={"value": QR})

    corpo = qr(cliente, cabecalho_admin, canal)
    assert corpo["status"] == "aguardando_leitura" and corpo["qr"] == QR and corpo["numero"] is None
    assert corpo["mensagem"]
    chamada = provedor.chamadas()[-1]
    assert chamada["url"] == f"https://api.z-api.io/instances/{INSTANCIA}/token/{TOKEN_INSTANCIA}/qr-code/image"
    assert chamada["cabecalhos"]["client-token"] == CLIENT_TOKEN
    assert credenciais(cliente, cabecalho_admin, canal)["credenciais"]["estado_conexao"] == "aguardando_leitura"

    # o celular leu o QR Code
    provedor.limpar()
    provedor.roteirar("/status", metodo="GET", json={"connected": True, "error": "You are already connected.", "smartphoneConnected": True})
    provedor.roteirar("/device", metodo="GET", json={"phone": "5511988887777", "name": "Loja"})
    corpo = qr(cliente, cabecalho_admin, canal)
    assert corpo == {"status": "conectado", "qr": None, "numero": "5511988887777", "mensagem": corpo["mensagem"]}
    # a frase já vem com o número legível, como o painel o mostra
    assert "+55 (11) 98888-7777" in corpo["mensagem"]
    gravadas = credenciais(cliente, cabecalho_admin, canal)["credenciais"]
    assert gravadas["estado_conexao"] == "conectado" and gravadas["numero_conectado"] == "5511988887777"


def test_so_estado_confere_a_conexao_sem_gerar_qr(cliente, cabecalho_admin, provedor):
    """O painel consulta o estado a cada ~3 s e só pede QR novo a cada ~15 s."""
    canal = canal_zapi(cliente, cabecalho_admin)
    provedor.roteirar("/status", metodo="GET", json={"connected": False})
    provedor.roteirar("/qr-code/image", metodo="GET", json={"value": QR})
    corpo = qr(cliente, cabecalho_admin, canal, so_estado="1")
    assert corpo["status"] == "desconectado" and corpo["qr"] is None and corpo["mensagem"]
    assert [c["url"].rsplit("/", 1)[-1] for c in provedor.chamadas()] == ["status"]

    # Evolution: sem a instância, só avisa (quem cria é o pedido de QR)
    instancia = unico("loja-")
    evolucao = canal_evolution(cliente, cabecalho_admin, instancia)
    provedor.limpar()
    provedor.roteirar("/instance/connectionState/", metodo="GET", status=404,
                      json={"status": 404, "error": "Not Found", "response": {"message": [f'The "{instancia}" instance does not exist']}})
    corpo = qr(cliente, cabecalho_admin, evolucao, so_estado="1")
    assert corpo["status"] == "desconectado" and instancia in corpo["mensagem"]
    assert all("/instance/create" not in c["url"] for c in provedor.chamadas())


def test_zapi_qr_base64_sem_prefixo_vira_imagem(cliente, cabecalho_admin, provedor):
    canal = canal_zapi(cliente, cabecalho_admin)
    provedor.roteirar("/status", metodo="GET", json={"connected": False})
    provedor.roteirar("/qr-code/image", metodo="GET", json={"value": "iVBORw0KGgo="})
    assert qr(cliente, cabecalho_admin, canal)["qr"] == "data:image/png;base64,iVBORw0KGgo="


def test_zapi_chave_de_acesso_pede_o_painel_da_zapi(cliente, cabecalho_admin, provedor):
    canal = canal_zapi(cliente, cabecalho_admin)
    provedor.roteirar("/status", metodo="GET", json={"connected": False})
    provedor.roteirar("/qr-code/image", metodo="GET", json={"challenge": {"challenge": "abc", "rpId": "whatsapp.com"}})
    corpo = qr(cliente, cabecalho_admin, canal)
    assert corpo["status"] == "erro" and "Chave de Acesso" in corpo["mensagem"]


def test_erro_do_provedor_vira_status_erro_com_a_frase_dele(cliente, cabecalho_admin, provedor):
    canal = canal_zapi(cliente, cabecalho_admin)
    provedor.roteirar("/status", metodo="GET", status=400, json={"error": "null not allowed"})
    corpo = qr(cliente, cabecalho_admin, canal)
    assert corpo["status"] == "erro" and corpo["qr"] is None
    assert "null not allowed" in corpo["mensagem"] and "Client-Token" in corpo["mensagem"]


def test_falha_de_rede_com_o_provedor(cliente, cabecalho_admin, provedor):
    canal = canal_zapi(cliente, cabecalho_admin)
    provedor.roteirar("api.z-api.io", erro_rede="timeout")
    corpo = qr(cliente, cabecalho_admin, canal)
    assert corpo["status"] == "erro" and "falha de rede com a Z-API" in corpo["mensagem"]


def test_evolution_cria_a_instancia_que_nao_existe(cliente, cabecalho_admin, provedor):
    instancia = unico("loja-")
    canal = canal_evolution(cliente, cabecalho_admin, instancia)
    inexistente = {"status": 404, "error": "Not Found", "response": {"message": [f'The "{instancia}" instance does not exist']}}
    provedor.roteirar("/instance/connectionState/", metodo="GET", status=404, json=inexistente)
    provedor.roteirar("/instance/create", metodo="POST", status=201, json={
        "instance": {"instanceName": instancia, "status": "connecting"}, "hash": "hash-da-instancia",
        "qrcode": {"pairingCode": None, "code": "2@abc", "base64": QR, "count": 1},
    })

    corpo = qr(cliente, cabecalho_admin, canal)
    assert corpo["status"] == "aguardando_leitura" and corpo["qr"] == QR
    criacao = provedor.chamadas()[-1]
    assert criacao["url"] == f"{SERVIDOR_EVOLUTION}/instance/create"
    assert criacao["cabecalhos"]["apikey"] == API_KEY
    assert json.loads(criacao["corpo"]) == {
        "instanceName": instancia, "integration": "WHATSAPP-BAILEYS", "qrcode": True, "groupsIgnore": True,
    }
    assert "hash-da-instancia" not in json.dumps(corpo)


def test_evolution_qr_da_instancia_existente_e_depois_conectada(cliente, cabecalho_admin, provedor):
    instancia = unico("loja-")
    canal = canal_evolution(cliente, cabecalho_admin, instancia)
    provedor.roteirar("/instance/connectionState/", metodo="GET", json={"instance": {"instanceName": instancia, "state": "close"}})
    provedor.roteirar("/instance/connect/", metodo="GET", json={"pairingCode": None, "code": "2@x", "base64": QR, "count": 2})
    corpo = qr(cliente, cabecalho_admin, canal)
    assert corpo["status"] == "aguardando_leitura" and corpo["qr"] == QR
    assert provedor.chamadas()[-1]["url"] == f"{SERVIDOR_EVOLUTION}/instance/connect/{instancia}"

    provedor.limpar()
    provedor.roteirar("/instance/connectionState/", metodo="GET", json={"instance": {"instanceName": instancia, "state": "open"}})
    provedor.roteirar("/instance/fetchInstances", metodo="GET", json=[{"name": instancia, "ownerJid": "5521977776666@s.whatsapp.net", "token": "nao-mostrar"}])
    corpo = qr(cliente, cabecalho_admin, canal)
    assert corpo["status"] == "conectado" and corpo["numero"] == "5521977776666"
    assert "nao-mostrar" not in json.dumps(corpo)
    assert f"instanceName={instancia}" in provedor.chamadas()[-1]["url"]


def test_evolution_api_key_recusada(cliente, cabecalho_admin, provedor):
    canal = canal_evolution(cliente, cabecalho_admin)
    provedor.roteirar("/instance/connectionState/", metodo="GET", status=401, json={"status": 401, "error": "Unauthorized", "response": {"message": "Unauthorized"}})
    corpo = qr(cliente, cabecalho_admin, canal)
    assert corpo["status"] == "erro" and "(401)" in corpo["mensagem"] and "API key" in corpo["mensagem"]


def test_testar_conexao_mostra_o_estado_da_instancia(cliente, cabecalho_admin, provedor):
    canal = canal_zapi(cliente, cabecalho_admin)
    provedor.roteirar("/status", metodo="GET", json={"connected": False})
    resultado = cliente.post(f"/api/canais/{canal['id']}/testar", headers=cabecalho_admin).json()
    assert resultado["ok"] is True
    assert "Conectar pelo QR Code" in resultado["alerta"] and "webhook" in resultado["alerta"]
    assert all("qr-code" not in c["url"] for c in provedor.chamadas()), "o teste não gera QR Code"

    provedor.limpar()
    provedor.roteirar("/status", metodo="GET", json={"connected": True})
    provedor.roteirar("/device", metodo="GET", json={"phone": "5511944443333"})
    resultado = cliente.post(f"/api/canais/{canal['id']}/testar", headers=cabecalho_admin).json()
    assert resultado["ok"] is True and "+55 (11) 94444-3333" in resultado["mensagem"]

    provedor.limpar()
    provedor.roteirar("/status", metodo="GET", status=404, json={"error": "Instance not found"})
    resultado = cliente.post(f"/api/canais/{canal['id']}/testar", headers=cabecalho_admin).json()
    assert resultado["ok"] is False and "ID e o token da instância" in resultado["mensagem"]


# ======================================================================
#   desconectar e conectar-webhook
# ======================================================================
def test_desconectar_na_zapi(cliente, cabecalho_admin, provedor):
    canal = canal_zapi(cliente, cabecalho_admin)
    provedor.roteirar("/disconnect", metodo="GET", json={"value": True})
    resultado = exigir_rota(cliente.post(f"/api/canais/{canal['id']}/desconectar", headers=cabecalho_admin), "POST /desconectar").json()
    assert resultado["ok"] is True
    assert provedor.chamadas()[-1]["url"].endswith(f"/instances/{INSTANCIA}/token/{TOKEN_INSTANCIA}/disconnect")
    assert credenciais(cliente, cabecalho_admin, canal)["credenciais"]["estado_conexao"] == "desconectado"


def test_desconectar_na_evolution_ja_desconectada_nao_e_erro(cliente, cabecalho_admin, provedor):
    instancia = unico("loja-")
    canal = canal_evolution(cliente, cabecalho_admin, instancia)
    provedor.roteirar("/instance/logout/", metodo="DELETE", status=400,
                      json={"status": 400, "error": "Bad Request", "response": {"message": [f'The "{instancia}" instance is not connected']}})
    resultado = cliente.post(f"/api/canais/{canal['id']}/desconectar", headers=cabecalho_admin).json()
    assert resultado["ok"] is True and "desconectado" in resultado["mensagem"]
    assert provedor.chamadas()[-1]["metodo"] == "DELETE"


def test_desconectar_canal_de_outro_tipo(cliente, cabecalho_admin, canal_whatsapp):
    resultado = cliente.post(f"/api/canais/{canal_whatsapp['id']}/desconectar", headers=cabecalho_admin).json()
    assert resultado["ok"] is False


def test_conectar_webhook_sem_endereco_publico_explica(cliente, cabecalho_admin, provedor):
    canal = canal_zapi(cliente, cabecalho_admin)
    resultado = cliente.post(f"/api/canais/{canal['id']}/conectar-webhook", headers=cabecalho_admin).json()
    assert resultado["ok"] is False and "url_publica" in resultado["mensagem"]
    assert provedor.chamadas() == []


# ======================================================================
#   webhook: Z-API
# ======================================================================
@pytest.fixture
def zapi(cliente, cabecalho_admin) -> tuple[dict, str]:
    canal = canal_zapi(cliente, cabecalho_admin)
    return canal, credenciais(cliente, cabecalho_admin, canal)["segredo_webhook"]


def test_webhook_sem_token_ou_com_token_errado_e_recusado(cliente, zapi):
    canal, segredo = zapi
    payload = zapi_texto(numero(), unico("zm"), "oi")
    assert webhook(cliente, canal, None, payload).status_code == 401
    assert webhook(cliente, canal, segredo + "x", payload).status_code == 401
    assert webhook(cliente, canal, segredo[:-1], payload).status_code == 401
    # o cabeçalho também vale (Evolution deixa configurar cabeçalhos)
    resposta = cliente.post(f"/webhooks/{canal['id']}", headers={"X-IHchat-Token": segredo}, json=payload)
    assert resposta.status_code == 200 and resposta.json()["recebidas"] == 1


def test_zapi_texto_abre_conversa_e_e_idempotente(cliente, cabecalho_atendente, zapi):
    canal, segredo = zapi
    telefone = numero()
    payload = zapi_texto(telefone, unico("zm"), "Olá, vi o anúncio")
    resposta = webhook(cliente, canal, segredo, payload)
    assert resposta.status_code == 200, resposta.text
    assert resposta.json() == {"recebidas": 1, "status_atualizados": 0, "enviadas_pelo_celular": 0}
    # reentrega do mesmo id: nada novo
    assert webhook(cliente, canal, segredo, payload).json()["recebidas"] == 0

    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal)
    assert conversa["contato"]["nome"] == "Cliente QR"
    [mensagem] = mensagens(cliente, cabecalho_atendente, conversa["id"])
    assert mensagem["direcao"] == "entrada" and mensagem["conteudo"] == "Olá, vi o anúncio"


def test_zapi_imagem_com_legenda_e_baixada(cliente, cabecalho_atendente, zapi, servidor, provedor):
    canal, segredo = zapi
    provedor.roteirar("storage.z-api.teste/imagem", metodo="GET", corpo_bytes=PNG, cabecalhos={"Content-Type": "image/png"})
    payload = zapi_recebida(numero(), unico("zm"), image={
        "mimeType": "image/png", "imageUrl": "https://storage.z-api.teste/imagem/1.png", "caption": "olha a foto",
    })
    assert webhook(cliente, canal, segredo, payload).json()["recebidas"] == 1
    download = provedor.chamadas()[-1]
    assert download["url"] == "https://storage.z-api.teste/imagem/1.png"
    # a URL da mídia nunca recebe as credenciais da instância
    assert "client-token" not in download["cabecalhos"]

    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal)
    [mensagem] = mensagens(cliente, cabecalho_atendente, conversa["id"])
    assert mensagem["conteudo"] == "olha a foto"
    [anexo] = mensagem["anexos"]
    assert anexo["nome"] == "imagem.png" and anexo["tamanho"] == len(PNG) and anexo["imagem"] is True
    assert cliente.get(anexo["url"], headers=cabecalho_atendente).content == PNG


def test_zapi_documento_audio_e_video(cliente, cabecalho_atendente, zapi, provedor):
    canal, segredo = zapi
    telefone = numero()
    provedor.roteirar("storage.z-api.teste", metodo="GET", corpo_bytes=b"%PDF-1.4 falso")
    entregas = [
        zapi_recebida(telefone, unico("zd"), document={"documentUrl": "https://storage.z-api.teste/d.pdf", "mimeType": "application/pdf", "fileName": "boleto.pdf", "title": "boleto"}),
        zapi_recebida(telefone, unico("za"), audio={"audioUrl": "https://storage.z-api.teste/a.ogg", "mimeType": "audio/ogg; codecs=opus", "ptt": True}),
        zapi_recebida(telefone, unico("zv"), video={"videoUrl": "https://storage.z-api.teste/v.mp4", "mimeType": "video/mp4", "caption": "vídeo"}),
    ]
    for entrega in entregas:
        assert webhook(cliente, canal, segredo, entrega).json()["recebidas"] == 1
    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal)
    lista = mensagens(cliente, cabecalho_atendente, conversa["id"])
    assert [m["anexos"][0]["nome"] for m in lista] == ["boleto.pdf", "audio.ogg", "video.mp4"]
    assert [m["conteudo"] for m in lista] == ["", "", "vídeo"]


def test_zapi_grupo_canal_e_status_sao_ignorados(cliente, cabecalho_atendente, zapi):
    canal, segredo = zapi
    ignoradas = [
        zapi_texto("120363019502650977-group", unico("zg"), "no grupo", isGroup=True, participantPhone="5511999990000"),
        zapi_texto("5511999990000", unico("zg"), "grupo sinalizado", isGroup=True),
        zapi_texto("120363166555745933@newsletter", unico("zn"), "canal", isNewsletter=True),
        zapi_texto("status@broadcast", unico("zs"), "status", broadcast=True),
        zapi_recebida(numero(), unico("zr"), reaction={"value": "👍"}),
    ]
    for entrega in ignoradas:
        resposta = webhook(cliente, canal, segredo, entrega)
        assert resposta.status_code == 200 and resposta.json()["recebidas"] == 0, entrega
    assert cliente.get("/api/conversas", params={"canal_id": canal["id"]}, headers=cabecalho_atendente).json() == []


def test_zapi_resposta_pelo_celular_entra_como_saida_sem_reenviar(cliente, cabecalho_atendente, zapi, provedor):
    canal, segredo = zapi
    telefone = numero()
    webhook(cliente, canal, segredo, zapi_texto(telefone, unico("zm"), "Vocês abrem sábado?"))
    provedor.limpar()

    resposta = webhook(cliente, canal, segredo, zapi_texto(telefone, unico("zme"), "Abrimos sim, das 8h às 12h", fromMe=True))
    assert resposta.json() == {"recebidas": 0, "status_atualizados": 0, "enviadas_pelo_celular": 1}
    assert provedor.chamadas() == [], "a mensagem do celular não é reenviada"

    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal)
    assert conversa["nao_lidas"] == 0 and conversa["previa"] == "Abrimos sim, das 8h às 12h"
    entrada, saida = mensagens(cliente, cabecalho_atendente, conversa["id"])
    assert entrada["direcao"] == "entrada"
    assert saida["direcao"] == "saida" and saida["status"] == "enviada"
    assert saida["autor"] == "Enviada pelo celular" and saida["atendente_id"] is None
    assert saida["assinatura"] == {"nome": "Enviada pelo celular", "setor": None}
    # o painel distingue a resposta do celular (selo próprio) da que saiu pelo IHchat
    assert saida["pelo_celular"] is True and entrada["pelo_celular"] is False

    # a que o próprio IHchat mandou pela API volta com fromApi: ignorada
    resposta = webhook(cliente, canal, segredo, zapi_texto(telefone, unico("zme"), "via API", fromMe=True, fromApi=True))
    assert resposta.json()["enviadas_pelo_celular"] == 0


def test_zapi_dono_puxa_conversa_nova_pelo_celular(cliente, cabecalho_atendente, zapi):
    canal, segredo = zapi
    resposta = webhook(cliente, canal, segredo, zapi_texto(numero(), unico("zme"), "Oi, seu pedido chegou", fromMe=True, chatName="Dona Maria"))
    assert resposta.json()["enviadas_pelo_celular"] == 1
    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal)
    assert conversa["contato"]["nome"] == "Dona Maria"
    [saida] = mensagens(cliente, cabecalho_atendente, conversa["id"])
    assert saida["direcao"] == "saida" and saida["autor"] == "Enviada pelo celular"


def test_zapi_eventos_de_conexao_atualizam_o_estado(cliente, cabecalho_admin, zapi):
    canal, segredo = zapi
    resposta = webhook(cliente, canal, segredo, {"type": "ConnectedCallback", "connected": True, "phone": "5544999999999", "instanceId": INSTANCIA})
    assert resposta.status_code == 200
    gravadas = credenciais(cliente, cabecalho_admin, canal)["credenciais"]
    assert gravadas["estado_conexao"] == "conectado" and gravadas["numero_conectado"] == "5544999999999"

    webhook(cliente, canal, segredo, {"type": "DisconnectedCallback", "disconnected": True, "error": "Device has been disconnected"})
    gravadas = credenciais(cliente, cabecalho_admin, canal)["credenciais"]
    assert gravadas["estado_conexao"] == "desconectado" and "numero_conectado" not in gravadas


def test_webhook_de_canal_desativado_e_recusado(cliente, cabecalho_admin, zapi):
    canal, segredo = zapi
    cliente.patch(f"/api/canais/{canal['id']}", headers=cabecalho_admin, json={"ativo": False})
    assert webhook(cliente, canal, segredo, zapi_texto(numero(), unico("zm"), "oi")).status_code == 409


def test_payload_estranho_nao_derruba(cliente, zapi):
    canal, segredo = zapi
    for estranho in ({}, {"type": 5}, {"type": "ReceivedCallback", "phone": ["x"], "text": "oi"},
                     {"type": "MessageStatusCallback", "ids": "x", "status": ["READ"]},
                     {"type": "ReceivedCallback", "phone": "5511", "image": [], "text": {"message": 7}}):
        resposta = webhook(cliente, canal, segredo, estranho)
        assert resposta.status_code == 200, (estranho, resposta.text)


# ======================================================================
#   envio pela Z-API
# ======================================================================
def abrir_conversa_zapi(cliente, cabecalho, canal, segredo, telefone) -> int:
    assert webhook(cliente, canal, segredo, zapi_texto(telefone, unico("zm"), "oi")).json()["recebidas"] == 1
    return conversa_do_canal(cliente, cabecalho, canal)["id"]


def test_zapi_envio_de_texto_com_assinatura_e_recibos(cliente, cabecalho_atendente, zapi, provedor):
    canal, segredo = zapi
    telefone = numero()
    conversa_id = abrir_conversa_zapi(cliente, cabecalho_atendente, canal, segredo, telefone)
    id_enviado = unico("3EB0")
    provedor.roteirar("/send-text", metodo="POST", json={"zaapId": "z1", "messageId": id_enviado, "id": id_enviado})

    resposta = responder(cliente, cabecalho_atendente, conversa_id, "Bom dia! Como posso ajudar?")
    assert resposta.status_code == 201, resposta.text
    assert resposta.json()["status"] == "enviada" and resposta.json()["conteudo"] == "Bom dia! Como posso ajudar?"
    chamada = provedor.chamadas()[-1]
    assert chamada["url"] == f"https://api.z-api.io/instances/{INSTANCIA}/token/{TOKEN_INSTANCIA}/send-text"
    assert chamada["cabecalhos"]["client-token"] == CLIENT_TOKEN
    corpo = json.loads(chamada["corpo"])
    assert corpo == {"phone": telefone, "message": f"{linha_da_assinatura(cliente, cabecalho_atendente)}\nBom dia! Como posso ajudar?"}

    # recibo de leitura
    recibo = {"type": "MessageStatusCallback", "status": "READ", "ids": [id_enviado], "phone": telefone, "isGroup": False}
    assert webhook(cliente, canal, segredo, recibo).json()["status_atualizados"] == 1
    assert mensagens(cliente, cabecalho_atendente, conversa_id)[-1]["status"] == "lida"
    # a mesma mensagem voltando pelo notifySentByMe (sem fromApi) não duplica
    eco = zapi_texto(telefone, id_enviado, corpo["message"], fromMe=True)
    assert webhook(cliente, canal, segredo, eco).json()["enviadas_pelo_celular"] == 0
    assert len(mensagens(cliente, cabecalho_atendente, conversa_id)) == 2


def test_zapi_envio_de_documento_e_imagem(cliente, cabecalho_atendente, zapi, provedor):
    canal, segredo = zapi
    telefone = numero()
    conversa_id = abrir_conversa_zapi(cliente, cabecalho_atendente, canal, segredo, telefone)
    provedor.roteirar("/send-document/", metodo="POST", json={"messageId": unico("doc"), "id": "x"})
    provedor.roteirar("/send-image", metodo="POST", json={"messageId": unico("img"), "id": "y"})

    resposta = exigir_rota(cliente.post(
        f"/api/conversas/{conversa_id}/anexos", headers=cabecalho_atendente,
        files={"arquivo": ("orcamento.pdf", b"%PDF-1.4 orcamento", "application/pdf")}, data={"conteudo": "Segue o orçamento"},
    ), "POST /api/conversas/{id}/anexos")
    assert resposta.status_code == 201, resposta.text
    assert resposta.json()["status"] == "enviada"
    chamada = provedor.chamadas()[-1]
    assert chamada["url"].endswith("/send-document/pdf")
    corpo = json.loads(chamada["corpo"])
    assert corpo["phone"] == telefone and corpo["fileName"] == "orcamento.pdf"
    assert corpo["document"] == "data:application/pdf;base64," + base64.b64encode(b"%PDF-1.4 orcamento").decode()
    assert corpo["caption"].endswith("\nSegue o orçamento") and corpo["caption"].startswith("*")

    resposta = cliente.post(
        f"/api/conversas/{conversa_id}/anexos", headers=cabecalho_atendente, files={"arquivo": ("foto.png", PNG, "image/png")},
    )
    assert resposta.status_code == 201 and resposta.json()["status"] == "enviada"
    corpo = json.loads(provedor.chamadas()[-1]["corpo"])
    assert provedor.chamadas()[-1]["url"].endswith("/send-image")
    assert corpo["image"].startswith("data:image/png;base64,") and corpo["caption"].startswith("*")


def test_zapi_falha_no_envio_vira_mensagem_falhou(cliente, cabecalho_atendente, zapi, provedor):
    canal, segredo = zapi
    conversa_id = abrir_conversa_zapi(cliente, cabecalho_atendente, canal, segredo, numero())
    provedor.roteirar("/send-text", metodo="POST", status=400, json={"error": "Instance not connected"})
    resposta = responder(cliente, cabecalho_atendente, conversa_id, "Olá")
    assert resposta.status_code == 201
    assert resposta.json()["status"] == "falhou"
    assert "Instance not connected" in resposta.json()["erro"]
    sem_segredos(resposta.text)


def test_canal_qr_sem_credenciais_no_sandbox_simula(cliente, cabecalho_admin, cabecalho_atendente, provedor):
    canal = criar_canal(cliente, cabecalho_admin, "whatsapp_qr")
    segredo = credenciais(cliente, cabecalho_admin, canal)["segredo_webhook"]
    assert webhook(cliente, canal, segredo, zapi_texto(numero(), unico("zm"), "oi")).json()["recebidas"] == 1
    conversa_id = conversa_do_canal(cliente, cabecalho_atendente, canal)["id"]
    provedor.limpar()
    resposta = responder(cliente, cabecalho_atendente, conversa_id, "resposta de teste")
    assert resposta.json()["status"] == "simulada"
    assert provedor.chamadas() == []


# ======================================================================
#   webhook e envio: Evolution API
# ======================================================================
@pytest.fixture
def evolution(cliente, cabecalho_admin) -> tuple[dict, str, str]:
    instancia = unico("loja-")
    canal = canal_evolution(cliente, cabecalho_admin, instancia)
    return canal, credenciais(cliente, cabecalho_admin, canal)["segredo_webhook"], instancia


def test_evolution_texto_midia_e_resposta_pelo_celular(cliente, cabecalho_atendente, evolution, provedor):
    canal, segredo, instancia = evolution
    telefone = numero()
    jid = f"{telefone}@s.whatsapp.net"

    resposta = webhook(cliente, canal, segredo, evolution_upsert(instancia, jid, unico("EV"), {"conversation": "Quero um orçamento"}, "conversation"))
    assert resposta.json() == {"recebidas": 1, "status_atualizados": 0, "enviadas_pelo_celular": 0}

    # webhook antigo, cadastrado com base64: a mídia já vem no corpo, nenhuma ida ao servidor
    imagem = {"imageMessage": {"caption": "a peça", "mimetype": "image/png"}, "base64": base64.b64encode(PNG).decode()}
    assert webhook(cliente, canal, segredo, evolution_upsert(instancia, jid, unico("EV"), imagem, "imageMessage")).json()["recebidas"] == 1
    assert provedor.chamadas() == []

    # sem base64 (o webhook que o IHchat cadastra): busca pela API da Evolution,
    # mandando a mensagem inteira do webhook (a Evolution baixa por ela mesmo
    # sem tê-la guardado no banco)
    id_doc = unico("EVD")
    provedor.roteirar("/chat/getBase64FromMediaMessage/", metodo="POST", json={
        "mediaType": "documentMessage", "fileName": "nota.pdf", "mimetype": "application/pdf", "base64": base64.b64encode(b"%PDF nota").decode(),
    })
    documento = {"documentMessage": {
        "fileName": "nota.pdf", "mimetype": "application/pdf", "caption": "nota fiscal",
        "url": "https://mmg.whatsapp.net/d/f/x.enc", "mediaKey": "Y2hhdmU=", "directPath": "/v/t62/x.enc",
    }}
    # uma mediaUrl no webhook NÃO é seguida: quem forja a entrega escolheria o endereço
    entrega = evolution_upsert(instancia, jid, id_doc, {**documento, "mediaUrl": "http://169.254.169.254/latest/"}, "documentMessage")
    assert webhook(cliente, canal, segredo, entrega).json()["recebidas"] == 1
    [busca] = provedor.chamadas()
    assert busca["url"] == f"{SERVIDOR_EVOLUTION}/chat/getBase64FromMediaMessage/{instancia}"
    assert busca["cabecalhos"]["apikey"] == API_KEY
    assert json.loads(busca["corpo"]) == {
        "message": {"key": {"remoteJid": jid, "fromMe": False, "id": id_doc}, "message": documento},
        "convertToMp4": False,
    }

    # o dono respondeu pelo celular (fromMe): saída, sem reenviar
    resposta = webhook(cliente, canal, segredo, evolution_upsert(instancia, jid, unico("EVM"), {"conversation": "Já te mando"}, "conversation", de_mim=True))
    assert resposta.json()["enviadas_pelo_celular"] == 1

    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal)
    assert conversa["contato"]["nome"] == "Cliente Evo", "o pushName 'Você' do dono não vira nome do cliente"
    lista = mensagens(cliente, cabecalho_atendente, conversa["id"])
    assert [(m["direcao"], m["conteudo"]) for m in lista] == [
        ("entrada", "Quero um orçamento"), ("entrada", "a peça"), ("entrada", "nota fiscal"), ("saida", "Já te mando"),
    ]
    assert lista[1]["anexos"][0]["nome"] == "imagem.png" and lista[1]["anexos"][0]["tamanho"] == len(PNG)
    assert lista[2]["anexos"][0]["nome"] == "nota.pdf" and lista[2]["anexos"][0]["tamanho"] == len(b"%PDF nota")
    assert lista[3]["autor"] == "Enviada pelo celular"


def test_evolution_ignora_grupo_status_e_outra_instancia(cliente, cabecalho_atendente, evolution):
    canal, segredo, instancia = evolution
    ignoradas = [
        evolution_upsert(instancia, "120363040000000000@g.us", unico("EG"), {"conversation": "grupo"}, "conversation"),
        evolution_upsert(instancia, "status@broadcast", unico("ES"), {"conversation": "status"}, "conversation"),
        evolution_upsert("outra-instancia", f"{numero()}@s.whatsapp.net", unico("EO"), {"conversation": "de outra"}, "conversation"),
        evolution_upsert(instancia, f"{numero()}@s.whatsapp.net", unico("ER"), {"reactionMessage": {"text": "👍"}}, "reactionMessage"),
    ]
    for entrega in ignoradas:
        resposta = webhook(cliente, canal, segredo, entrega)
        assert resposta.status_code == 200 and resposta.json()["recebidas"] == 0
    assert cliente.get("/api/conversas", params={"canal_id": canal["id"]}, headers=cabecalho_atendente).json() == []


def test_evolution_envio_texto_midia_recibo_e_conexao(cliente, cabecalho_admin, cabecalho_atendente, evolution, provedor):
    canal, segredo, instancia = evolution
    telefone = numero()
    webhook(cliente, canal, segredo, evolution_upsert(instancia, f"{telefone}@s.whatsapp.net", unico("EV"), {"conversation": "oi"}, "conversation"))
    conversa_id = conversa_do_canal(cliente, cabecalho_atendente, canal)["id"]

    id_texto = unico("3EB0T")
    provedor.roteirar("/message/sendText/", metodo="POST", status=201, json={"key": {"remoteJid": f"{telefone}@s.whatsapp.net", "fromMe": True, "id": id_texto}, "status": "PENDING"})
    assert responder(cliente, cabecalho_atendente, conversa_id, "Tudo certo").json()["status"] == "enviada"
    chamada = provedor.chamadas()[-1]
    assert chamada["url"] == f"{SERVIDOR_EVOLUTION}/message/sendText/{instancia}"
    assert chamada["cabecalhos"]["apikey"] == API_KEY
    assert json.loads(chamada["corpo"]) == {"number": telefone, "text": f"{linha_da_assinatura(cliente, cabecalho_atendente)}\nTudo certo"}

    provedor.roteirar("/message/sendMedia/", metodo="POST", status=201, json={"key": {"id": unico("3EB0M")}})
    resposta = cliente.post(
        f"/api/conversas/{conversa_id}/anexos", headers=cabecalho_atendente,
        files={"arquivo": ("tabela.xlsx", b"PK planilha", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"conteudo": "tabela de preços"},
    )
    assert resposta.status_code == 201 and resposta.json()["status"] == "enviada", resposta.text
    corpo = json.loads(provedor.chamadas()[-1]["corpo"])
    assert corpo["number"] == telefone and corpo["mediatype"] == "document" and corpo["fileName"] == "tabela.xlsx"
    assert base64.b64decode(corpo["media"]) == b"PK planilha" and not corpo["media"].startswith("data:")
    assert corpo["caption"].endswith("\ntabela de preços")

    # recibo: só os das NOSSAS mensagens (fromMe) contam
    recibo = {"event": "messages.update", "instance": instancia, "data": {"keyId": id_texto, "remoteJid": f"{telefone}@s.whatsapp.net", "fromMe": True, "status": "DELIVERY_ACK"}}
    assert webhook(cliente, canal, segredo, recibo).json()["status_atualizados"] == 1
    enviadas = [m for m in mensagens(cliente, cabecalho_atendente, conversa_id) if m["conteudo"] == "Tudo certo"]
    assert enviadas[0]["status"] == "entregue"

    conexao = {"event": "connection.update", "instance": instancia, "data": {"instance": instancia, "state": "open", "wuid": "5531955554444@s.whatsapp.net", "statusReason": 200}}
    assert webhook(cliente, canal, segredo, conexao).status_code == 200
    gravadas = credenciais(cliente, cabecalho_admin, canal)["credenciais"]
    assert gravadas["estado_conexao"] == "conectado" and gravadas["numero_conectado"] == "5531955554444"
    webhook(cliente, canal, segredo, {"event": "qrcode.updated", "instance": instancia, "data": {"qrcode": {"base64": QR}}})
    assert credenciais(cliente, cabecalho_admin, canal)["credenciais"]["estado_conexao"] == "aguardando_leitura"


def test_evolution_erro_no_envio(cliente, cabecalho_atendente, evolution, provedor):
    canal, segredo, instancia = evolution
    webhook(cliente, canal, segredo, evolution_upsert(instancia, f"{numero()}@s.whatsapp.net", unico("EV"), {"conversation": "oi"}, "conversation"))
    conversa_id = conversa_do_canal(cliente, cabecalho_atendente, canal)["id"]
    provedor.roteirar("/message/sendText/", metodo="POST", status=400,
                      json={"status": 400, "error": "Bad Request", "response": {"message": [{"exists": False, "jid": "x", "number": "y"}]}})
    resposta = responder(cliente, cabecalho_atendente, conversa_id, "Olá")
    assert resposta.json()["status"] == "falhou" and "(400)" in resposta.json()["erro"]


# ======================================================================
#   API oficial: a versão vigente da Graph API
# ======================================================================
def test_api_oficial_usa_a_graph_api_v26(cliente, cabecalho_admin, provedor):
    canal = criar_canal(cliente, cabecalho_admin, "whatsapp", credenciais={"token": "tk-v26", "id_numero": "7788"})
    provedor.roteirar("graph.facebook.com", metodo="GET", json={"display_phone_number": "+55 11 3000-0000", "verified_name": "Loja"})
    resultado = cliente.post(f"/api/canais/{canal['id']}/testar", headers=cabecalho_admin).json()
    assert resultado["ok"] is True
    assert provedor.chamadas()[-1]["url"].startswith("https://graph.facebook.com/v26.0/7788?")

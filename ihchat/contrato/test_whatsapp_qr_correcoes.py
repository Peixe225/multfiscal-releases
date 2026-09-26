"""WhatsApp pelo QR Code: regressões dos achados da revisão, nos dois servidores.

Cada teste é o cenário que mostrou o defeito (webhook de outra instância
dado como cadastrado, API key da Evolution nunca conferida, webhook base64,
@lid que dividia o cliente, coordenada cortada, recibo que rebaixava o
status, mídia buscada na rede interna, API key e webhook por http://).
Os que precisam do endereço público usam o servidor de
test_whatsapp_qr_publico.py; os de http:// sobem um servidor FORA do sandbox.
"""
from __future__ import annotations

import json
import os
import random
import shutil
import subprocess
import tempfile
from pathlib import Path

import httpx
import pytest

import conftest
import test_whatsapp_qr as qr
from test_whatsapp_qr_publico import URL_PUBLICA, cliente_publico, publico  # noqa: F401  (fixtures)
from utilitarios import ADMIN_EMAIL, ADMIN_SENHA, CHAVE_SECRETA, criar_canal, entrar, unico

INEXISTENTE = 'The "{}" instance does not exist'


def _credenciais(cliente, cabecalho, canal) -> dict:
    return cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho).json()["credenciais"]


def _conversas(cliente, cabecalho, canal) -> list[dict]:
    return cliente.get("/api/conversas", params={"canal_id": canal["id"]}, headers=cabecalho).json()


# ======================================================================
#   webhook_url é da instância: trocar a instância o invalida
# ======================================================================
def test_trocar_a_instancia_da_zapi_limpa_webhook_estado_e_numero(cliente_publico):
    cliente, provedor, cabecalho = cliente_publico
    canal = criar_canal(cliente, cabecalho, "whatsapp_qr", credenciais={
        "provedor": "zapi", "instancia_id": "VELHA", "instancia_token": "tok-velho",
    })
    provedor.roteirar("/update-every-webhooks", metodo="PUT", json={"value": True})
    assert cliente.post(f"/api/canais/{canal['id']}/conectar-webhook", headers=cabecalho).json()["ok"] is True
    provedor.roteirar("/status", metodo="GET", json={"connected": True})
    provedor.roteirar("/device", metodo="GET", json={"phone": "5511900001111"})
    assert cliente.post(f"/api/canais/{canal['id']}/testar", headers=cabecalho).json()["alerta"] is None
    antes = _credenciais(cliente, cabecalho, canal)
    assert antes["webhook_url"] and antes["estado_conexao"] == "conectado" and antes["numero_conectado"]

    # o teste grátis acabou e o dono contratou outra instância
    resposta = cliente.patch(f"/api/canais/{canal['id']}", headers=cabecalho, json={
        "credenciais": {"instancia_id": "NOVA", "instancia_token": "tok-novo"},
    })
    assert resposta.status_code == 200, resposta.text
    gravadas = _credenciais(cliente, cabecalho, canal)
    assert gravadas == {"provedor": "zapi", "instancia_id": "NOVA"}, "webhook, estado e número eram da instância VELHA"

    # o teste volta a avisar, e o conectar-webhook vai para a instância NOVA
    provedor.limpar()
    provedor.roteirar("/status", metodo="GET", json={"connected": True})
    provedor.roteirar("/device", metodo="GET", json={"phone": "5511900001111"})
    teste = cliente.post(f"/api/canais/{canal['id']}/testar", headers=cabecalho).json()
    assert teste["ok"] is True and "webhook" in (teste["alerta"] or ""), teste
    provedor.roteirar("/update-every-webhooks", metodo="PUT", json={"value": True})
    assert cliente.post(f"/api/canais/{canal['id']}/conectar-webhook", headers=cabecalho).json()["ok"] is True
    assert provedor.chamadas()[-1]["url"] == "https://api.z-api.io/instances/NOVA/token/tok-novo/update-every-webhooks"

    # salvar sem mexer na instância (só o nome, ou o Client-Token) não apaga nada
    cliente.patch(f"/api/canais/{canal['id']}", headers=cabecalho, json={"nome": unico("Loja "), "credenciais": {"client_token": "ct"}})
    assert _credenciais(cliente, cabecalho, canal)["webhook_url"] == f"{URL_PUBLICA}/webhooks/{canal['id']}"


def test_trocar_de_provedor_limpa_o_webhook(cliente_publico):
    cliente, provedor, cabecalho = cliente_publico
    canal = criar_canal(cliente, cabecalho, "whatsapp_qr", credenciais={
        "provedor": "zapi", "instancia_id": "VELHA2", "instancia_token": "tok-velho",
    })
    provedor.roteirar("/update-every-webhooks", metodo="PUT", json={"value": True})
    assert cliente.post(f"/api/canais/{canal['id']}/conectar-webhook", headers=cabecalho).json()["ok"] is True
    resposta = cliente.patch(f"/api/canais/{canal['id']}", headers=cabecalho, json={"credenciais": {
        "provedor": "evolution", "url_servidor": "https://evo.x", "api_key": "k", "nome_instancia": "loja",
    }})
    assert resposta.status_code == 200, resposta.text
    assert "webhook_url" not in _credenciais(cliente, cabecalho, canal)

    provedor.limpar()
    provedor.roteirar("/instance/connectionState/", metodo="GET", json={"instance": {"instanceName": "loja", "state": "open"}})
    provedor.roteirar("/instance/fetchInstances", metodo="GET", json=[{"ownerJid": "5511900001111@s.whatsapp.net"}])
    teste = cliente.post(f"/api/canais/{canal['id']}/testar", headers=cabecalho).json()
    assert teste["ok"] is True and "webhook" in (teste["alerta"] or ""), teste


def test_webhook_gravado_para_outro_endereco_e_avisado(cliente_publico):
    """O endereço público mudou depois do cadastro: o provedor entrega no antigo."""
    cliente, provedor, cabecalho = cliente_publico
    canal = criar_canal(cliente, cabecalho, "whatsapp_qr", credenciais={
        "provedor": "zapi", "instancia_id": "END", "instancia_token": "tok-end",
    })
    # como ficaria gravado por um cadastro feito quando o endereço público era outro
    resposta = cliente.patch(f"/api/canais/{canal['id']}", headers=cabecalho, json={
        "credenciais": {"webhook_url": "https://antigo.teste/webhooks/1"},
    })
    assert resposta.status_code == 200, resposta.text
    provedor.roteirar("/status", metodo="GET", json={"connected": True})
    provedor.roteirar("/device", metodo="GET", json={"phone": "5511900001111"})
    teste = cliente.post(f"/api/canais/{canal['id']}/testar", headers=cabecalho).json()
    assert teste["ok"] is True and "https://antigo.teste/webhooks/1" in (teste["alerta"] or ""), teste
    assert "Reconectar webhook" in teste["alerta"]


def test_instancia_recriada_na_evolution_nasce_com_o_webhook(cliente_publico):
    cliente, provedor, cabecalho = cliente_publico
    instancia = unico("rc-")
    canal = criar_canal(cliente, cabecalho, "whatsapp_qr", credenciais={
        "provedor": "evolution", "url_servidor": "https://evo.x", "api_key": "k", "nome_instancia": instancia,
    })
    segredo = cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho).json()["segredo_webhook"]
    provedor.roteirar("/webhook/set/", metodo="POST", status=201, json={"enabled": True})
    assert cliente.post(f"/api/canais/{canal['id']}/conectar-webhook", headers=cabecalho).json()["ok"] is True

    # a instância some do servidor Evolution (apagada no manager, banco refeito...)
    provedor.limpar()
    provedor.roteirar("/instance/connectionState/", metodo="GET", status=404,
                      json={"status": 404, "error": "Not Found", "response": {"message": [INEXISTENTE.format(instancia)]}})
    provedor.roteirar("/instance/create", metodo="POST", status=201, json={"instance": {"instanceName": instancia}, "qrcode": {"base64": qr.QR}})
    corpo = cliente.get(f"/api/canais/{canal['id']}/qr", headers=cabecalho).json()
    assert corpo["status"] == "aguardando_leitura"
    [criacao] = [c for c in provedor.chamadas() if c["url"].endswith("/instance/create")]
    webhook = json.loads(criacao["corpo"])["webhook"]
    assert webhook["url"] == f"{URL_PUBLICA}/webhooks/{canal['id']}?token={segredo}"
    assert webhook["enabled"] is True and webhook["base64"] is False
    assert segredo not in json.dumps(corpo)
    assert _credenciais(cliente, cabecalho, canal)["webhook_url"] == f"{URL_PUBLICA}/webhooks/{canal['id']}"


def test_instancia_recriada_sem_endereco_publico_perde_o_webhook(cliente, cabecalho_admin, provedor):
    """Sem url_publica não há webhook a mandar junto: o gravado era da instância que sumiu."""
    instancia = unico("rs-")
    canal = criar_canal(cliente, cabecalho_admin, "whatsapp_qr", credenciais={
        "provedor": "evolution", "url_servidor": qr.SERVIDOR_EVOLUTION, "api_key": qr.API_KEY, "nome_instancia": instancia,
    })
    # o webhook cadastrado (à mão, no provedor) quando a instância ainda existia
    cliente.patch(f"/api/canais/{canal['id']}", headers=cabecalho_admin, json={"credenciais": {"webhook_url": "https://antes.teste/webhooks/9"}})
    assert _credenciais(cliente, cabecalho_admin, canal)["webhook_url"] == "https://antes.teste/webhooks/9"
    provedor.roteirar("/instance/connectionState/", metodo="GET", status=404,
                      json={"status": 404, "error": "Not Found", "response": {"message": [INEXISTENTE.format(instancia)]}})
    provedor.roteirar("/instance/create", metodo="POST", status=201, json={"instance": {"instanceName": instancia}, "qrcode": {"base64": qr.QR}})
    assert qr.qr(cliente, cabecalho_admin, canal)["status"] == "aguardando_leitura"
    [criacao] = [c for c in provedor.chamadas() if c["url"].endswith("/instance/create")]
    assert "webhook" not in json.loads(criacao["corpo"])
    assert "webhook_url" not in _credenciais(cliente, cabecalho_admin, canal)


# ======================================================================
#   Evolution: "Testar conexão" confere a API key
# ======================================================================
def test_evolution_testar_confere_a_api_key_de_instancia_inexistente(cliente, cabecalho_admin, provedor):
    canal = qr.canal_evolution(cliente, cabecalho_admin, "nao-existe")
    inexistente = {"status": 404, "error": "Not Found", "response": {"message": [INEXISTENTE.format("nao-existe")]}}
    # a Evolution confere a instância ANTES da chave: o 404 não diz nada sobre ela
    provedor.roteirar("/instance/connectionState/", metodo="GET", status=404, json=inexistente)
    provedor.roteirar("/instance/fetchInstances", metodo="GET", status=401,
                      json={"status": 401, "error": "Unauthorized", "response": {"message": "Unauthorized"}})
    teste = cliente.post(f"/api/canais/{canal['id']}/testar", headers=cabecalho_admin).json()
    assert teste["ok"] is False and "API key" in teste["mensagem"], teste
    assert "aceitou" not in teste["mensagem"]
    qr.sem_segredos(json.dumps(teste))
    busca = provedor.chamadas()[-1]
    assert busca["url"] == f"{qr.SERVIDOR_EVOLUTION}/instance/fetchInstances?instanceName=nao-existe"
    assert busca["cabecalhos"]["apikey"] == qr.API_KEY

    # com a chave global: 404 no fetchInstances também (a instância não existe), mas a chave vale
    provedor.limpar()
    provedor.roteirar("/instance/connectionState/", metodo="GET", status=404, json=inexistente)
    provedor.roteirar("/instance/fetchInstances", metodo="GET", status=404,
                      json={"status": 404, "error": "Not Found", "response": {"message": ['Instance "nao-existe" not found']}})
    teste = cliente.post(f"/api/canais/{canal['id']}/testar", headers=cabecalho_admin).json()
    assert teste["ok"] is True and "Conectar pelo QR Code" in teste["alerta"], teste
    assert all("/instance/create" not in c["url"] for c in provedor.chamadas()), "o teste não cria a instância"


# ======================================================================
#   @lid: o mesmo cliente não vira dois contatos
# ======================================================================
def novo_lid() -> str:
    """Um "@lid" novo por teste (a base é da sessão inteira)."""
    return f"{random.randint(10**13, 10**14 - 1)}@lid"


def test_zapi_numero_com_chatlid_e_depois_so_o_lid_e_uma_conversa(cliente, cabecalho_admin, cabecalho_atendente, provedor):
    canal = qr.canal_zapi(cliente, cabecalho_admin)
    segredo = qr.credenciais(cliente, cabecalho_admin, canal)["segredo_webhook"]
    telefone = qr.numero()
    lid = novo_lid()
    assert qr.webhook(cliente, canal, segredo, qr.zapi_texto(telefone, unico("a"), "primeira", chatLid=lid)).json()["recebidas"] == 1
    assert qr.webhook(cliente, canal, segredo, qr.zapi_texto(lid, unico("b"), "segunda", chatLid=lid)).json()["recebidas"] == 1
    # o dono respondendo pelo celular, com o phone vindo como @lid
    assert qr.webhook(cliente, canal, segredo, qr.zapi_texto(lid, unico("c"), "do dono", chatLid=lid, fromMe=True)).json()["enviadas_pelo_celular"] == 1

    conversas = _conversas(cliente, cabecalho_atendente, canal)
    assert len(conversas) == 1, [(c["contato"]["nome"], c["previa"]) for c in conversas]
    lista = qr.mensagens(cliente, cabecalho_atendente, conversas[0]["id"])
    assert [(m["direcao"], m["conteudo"]) for m in lista] == [("entrada", "primeira"), ("entrada", "segunda"), ("saida", "do dono")]

    # a resposta vai para o NÚMERO, não para o @lid
    provedor.roteirar("/send-text", metodo="POST", json={"messageId": unico("3EB0"), "id": "x"})
    assert qr.responder(cliente, cabecalho_atendente, conversas[0]["id"], "oi").json()["status"] == "enviada"
    assert json.loads(provedor.chamadas()[-1]["corpo"])["phone"] == telefone


def test_zapi_lid_primeiro_e_numero_depois_e_uma_conversa(cliente, cabecalho_admin, cabecalho_atendente):
    canal = qr.canal_zapi(cliente, cabecalho_admin)
    segredo = qr.credenciais(cliente, cabecalho_admin, canal)["segredo_webhook"]
    lid = novo_lid()
    qr.webhook(cliente, canal, segredo, qr.zapi_texto(lid, unico("a"), "só o lid", chatLid=lid))
    qr.webhook(cliente, canal, segredo, qr.zapi_texto(qr.numero(), unico("b"), "com o número", chatLid=lid))
    qr.webhook(cliente, canal, segredo, qr.zapi_texto(lid, unico("c"), "lid de novo", chatLid=lid))
    conversas = _conversas(cliente, cabecalho_atendente, canal)
    assert len(conversas) == 1
    assert len(qr.mensagens(cliente, cabecalho_atendente, conversas[0]["id"])) == 3


def test_evolution_lid_com_numero_alternativo_e_uma_conversa(cliente, cabecalho_admin, cabecalho_atendente):
    instancia = unico("lid-")
    canal = qr.canal_evolution(cliente, cabecalho_admin, instancia)
    segredo = qr.credenciais(cliente, cabecalho_admin, canal)["segredo_webhook"]
    telefone = qr.numero()
    lid = novo_lid()
    com_os_dois = qr.evolution_upsert(instancia, lid, unico("EV"), {"conversation": "oi"}, "conversation")
    com_os_dois["data"]["key"]["remoteJidAlt"] = f"{telefone}@s.whatsapp.net"
    assert qr.webhook(cliente, canal, segredo, com_os_dois).json()["recebidas"] == 1
    so_o_lid = qr.evolution_upsert(instancia, lid, unico("EV"), {"conversation": "tudo bem?"}, "conversation")
    assert qr.webhook(cliente, canal, segredo, so_o_lid).json()["recebidas"] == 1
    conversas = _conversas(cliente, cabecalho_atendente, canal)
    assert len(conversas) == 1


# ======================================================================
#   localização com a precisão de um GPS de celular
# ======================================================================
def test_localizacao_com_todos_os_digitos(cliente, cabecalho_admin, cabecalho_atendente):
    canal = qr.canal_zapi(cliente, cabecalho_admin)
    segredo = qr.credenciais(cliente, cabecalho_admin, canal)["segredo_webhook"]
    local = {"latitude": -23.561414213562372, "longitude": -46.65588379999999}
    assert qr.webhook(cliente, canal, segredo, qr.zapi_recebida(qr.numero(), unico("zl"), location=local)).json()["recebidas"] == 1
    [mensagem] = qr.mensagens(cliente, cabecalho_atendente, qr.conversa_do_canal(cliente, cabecalho_atendente, canal)["id"])
    assert mensagem["conteudo"] == "[localizacao] -23.561414213562372,-46.65588379999999"

    instancia = unico("gps-")
    evolucao = qr.canal_evolution(cliente, cabecalho_admin, instancia)
    segredo = qr.credenciais(cliente, cabecalho_admin, evolucao)["segredo_webhook"]
    entrega = qr.evolution_upsert(instancia, f"{qr.numero()}@s.whatsapp.net", unico("EL"), {
        "locationMessage": {"degreesLatitude": -22.906847123456789, "degreesLongitude": -43.17289654321012},
    }, "locationMessage")
    assert qr.webhook(cliente, evolucao, segredo, entrega).json()["recebidas"] == 1
    [mensagem] = qr.mensagens(cliente, cabecalho_atendente, qr.conversa_do_canal(cliente, cabecalho_atendente, evolucao)["id"])
    assert mensagem["conteudo"] == "[localizacao] -22.90684712345679,-43.17289654321012"


# ======================================================================
#   recibos fora de ordem não rebaixam o status
# ======================================================================
def test_zapi_recibo_atrasado_nao_rebaixa(cliente, cabecalho_admin, cabecalho_atendente, provedor):
    canal = qr.canal_zapi(cliente, cabecalho_admin)
    segredo = qr.credenciais(cliente, cabecalho_admin, canal)["segredo_webhook"]
    telefone = qr.numero()
    conversa_id = qr.abrir_conversa_zapi(cliente, cabecalho_atendente, canal, segredo, telefone)
    enviado = unico("3EB0")
    provedor.roteirar("/send-text", metodo="POST", json={"messageId": enviado, "id": enviado})
    assert qr.responder(cliente, cabecalho_atendente, conversa_id, "oi").json()["status"] == "enviada"

    def recibo(status):
        return {"type": "MessageStatusCallback", "status": status, "ids": [enviado], "phone": telefone, "isGroup": False}

    assert qr.webhook(cliente, canal, segredo, recibo("READ")).json()["status_atualizados"] == 1
    # o RECEIVED que chega depois do READ não muda nada
    assert qr.webhook(cliente, canal, segredo, recibo("RECEIVED")).json()["status_atualizados"] == 0
    assert qr.webhook(cliente, canal, segredo, recibo("SENT")).json()["status_atualizados"] == 0
    erro = {"type": "DeliveryCallback", "messageId": enviado, "phone": telefone, "error": "atrasado"}
    assert qr.webhook(cliente, canal, segredo, erro).json()["status_atualizados"] == 0
    assert qr.mensagens(cliente, cabecalho_atendente, conversa_id)[-1]["status"] == "lida"


def test_evolution_edicao_nao_vira_recibo(cliente, cabecalho_admin, cabecalho_atendente, provedor):
    instancia = unico("ed-")
    canal = qr.canal_evolution(cliente, cabecalho_admin, instancia)
    segredo = qr.credenciais(cliente, cabecalho_admin, canal)["segredo_webhook"]
    telefone = qr.numero()
    qr.webhook(cliente, canal, segredo, qr.evolution_upsert(instancia, f"{telefone}@s.whatsapp.net", unico("EV"), {"conversation": "oi"}, "conversation"))
    conversa_id = qr.conversa_do_canal(cliente, cabecalho_atendente, canal)["id"]
    enviado = unico("3EB0E")
    provedor.roteirar("/message/sendText/", metodo="POST", status=201, json={"key": {"id": enviado}})
    qr.responder(cliente, cabecalho_atendente, conversa_id, "texto")
    base = {"keyId": enviado, "remoteJid": f"{telefone}@s.whatsapp.net", "fromMe": True}

    def atualizacao(**dados):
        return {"event": "messages.update", "instance": instancia, "data": {**base, **dados}}

    assert qr.webhook(cliente, canal, segredo, atualizacao(status="DELIVERY_ACK")).json()["status_atualizados"] == 1
    assert qr.webhook(cliente, canal, segredo, atualizacao(status="READ")).json()["status_atualizados"] == 1
    # edição: o Baileys não manda status e a Evolution preenche "SERVER_ACK"
    edicao = atualizacao(status="SERVER_ACK", message={"editedMessage": {"message": {"conversation": "texto editado"}}})
    assert qr.webhook(cliente, canal, segredo, edicao).json()["status_atualizados"] == 0
    assert qr.webhook(cliente, canal, segredo, atualizacao(status="DELIVERY_ACK")).json()["status_atualizados"] == 0
    assert qr.mensagens(cliente, cabecalho_atendente, conversa_id)[-1]["status"] == "lida"


# ======================================================================
#   mídia: nada de buscar endereço da rede interna
# ======================================================================
@pytest.mark.parametrize("endereco", [
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:3306/",
    "http://localhost:8080/admin",
    "http://[::1]/x",
    "http://10.0.0.5/foto.png",
])
def test_zapi_midia_na_rede_interna_nao_e_buscada(cliente, cabecalho_admin, cabecalho_atendente, provedor, endereco):
    canal = qr.canal_zapi(cliente, cabecalho_admin)
    segredo = qr.credenciais(cliente, cabecalho_admin, canal)["segredo_webhook"]
    provedor.roteirar(metodo="GET", corpo_bytes=b"segredo interno")
    entrega = qr.zapi_recebida(qr.numero(), unico("zi"), image={"imageUrl": endereco, "mimeType": "image/png", "caption": "olha"})
    assert qr.webhook(cliente, canal, segredo, entrega).json()["recebidas"] == 1
    assert provedor.chamadas() == [], "o servidor não pode buscar endereço interno"
    [mensagem] = qr.mensagens(cliente, cabecalho_atendente, qr.conversa_do_canal(cliente, cabecalho_atendente, canal)["id"])
    # a mensagem (e a legenda) chegam; o anexo fica registrado com o motivo
    assert mensagem["conteudo"] == "olha"
    [anexo] = mensagem["anexos"]
    assert anexo["url"] is None and "rede interna" in anexo["erro"]


def test_zapi_midia_publica_continua_sendo_baixada(cliente, cabecalho_admin, cabecalho_atendente, provedor):
    canal = qr.canal_zapi(cliente, cabecalho_admin)
    segredo = qr.credenciais(cliente, cabecalho_admin, canal)["segredo_webhook"]
    provedor.roteirar("storage.z-api.teste", metodo="GET", corpo_bytes=qr.PNG, cabecalhos={"Content-Type": "image/png"})
    entrega = qr.zapi_recebida(qr.numero(), unico("zp"), image={"imageUrl": "https://storage.z-api.teste/i.png", "mimeType": "image/png"})
    assert qr.webhook(cliente, canal, segredo, entrega).json()["recebidas"] == 1
    [mensagem] = qr.mensagens(cliente, cabecalho_atendente, qr.conversa_do_canal(cliente, cabecalho_atendente, canal)["id"])
    assert mensagem["anexos"][0]["tamanho"] == len(qr.PNG) and mensagem["anexos"][0]["erro"] is None


# ======================================================================
#   fora do sandbox: API key e webhook só por HTTPS
# ======================================================================
URL_PUBLICA_HTTP = "http://ihchat.teste"


def _subir_producao(pasta: Path, porta: int, ambiente: dict, log: Path, alvo: str) -> subprocess.Popen:
    if alvo == "python":
        ambiente.update(
            IHCHAT_BANCO_URL=f"sqlite:///{pasta / 'producao.db'}",
            IHCHAT_CHAVE_SECRETA=CHAVE_SECRETA,
            IHCHAT_MODO_SANDBOX="0",
            IHCHAT_COLETOR_ATIVO="0",
            IHCHAT_PASTA_ANEXOS=str(pasta / "anexos"),
            IHCHAT_URL_PUBLICA=URL_PUBLICA_HTTP,
        )
        conftest._rodar([str(conftest.PYTHON), "-m", "scripts.seed"], ambiente, log)
        comando = [str(conftest.PYTHON), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(porta), "--log-level", "warning"]
    else:
        config = {
            "driver": "sqlite", "dsn": f"sqlite:{pasta / 'producao.sqlite'}", "chave_secreta": CHAVE_SECRETA,
            "modo_sandbox": False, "pasta_dados": str(pasta / "dados"), "pasta_web": str(conftest.RAIZ / "app" / "web"),
            "url_publica": URL_PUBLICA_HTTP,
        }
        (pasta / "config.json").write_text(json.dumps(config))
        arquivo = pasta / "config.php"
        arquivo.write_text("<?php return json_decode(file_get_contents(__DIR__ . '/config.json'), true);\n")
        ambiente.update(IHCHAT_CONFIG=str(arquivo), PHP_CLI_SERVER_WORKERS="2")
        conftest._rodar([conftest.PHP, "php/console.php", "semear"], ambiente, log)
        comando = [conftest.PHP, "-S", f"127.0.0.1:{porta}", "-t", "php/public", "php/public/index.php"]
    return subprocess.Popen(comando, cwd=conftest.RAIZ, env=ambiente, stdout=log.open("a"), stderr=subprocess.STDOUT)


@pytest.fixture(scope="module")
def producao():
    """(cliente, cabeçalho do admin) de um servidor FORA do sandbox, com url_publica http://."""
    if os.environ.get("IHCHAT_CONTRATO_URL"):
        pytest.skip("servidor externo: não dá para subir outro fora do sandbox")
    alvo = os.environ.get("IHCHAT_CONTRATO_ALVO", "python").lower()
    pasta = Path(tempfile.mkdtemp(prefix=f"ihchat-contrato-producao-{alvo}-"))
    porta = conftest._porta_livre()
    log = pasta / "servidor.log"
    ambiente = {**os.environ, "IHCHAT_SENHA_ADMIN": ADMIN_SENHA}
    for variavel in ("IHCHAT_CONFIG", "IHCHAT_TESTE_PROVEDOR"):
        ambiente.pop(variavel, None)
    processo = _subir_producao(pasta, porta, ambiente, log, alvo)
    url = f"http://127.0.0.1:{porta}"
    try:
        conftest._esperar(url, processo, log)
        with httpx.Client(base_url=url, timeout=15.0) as cliente:
            cabecalho = {"Authorization": f"Bearer {entrar(cliente, ADMIN_EMAIL, ADMIN_SENHA)['token']}"}
            yield cliente, cabecalho
    finally:
        processo.terminate()
        try:
            processo.wait(timeout=10)
        except subprocess.TimeoutExpired:
            processo.kill()
        if os.environ.get("IHCHAT_CONTRATO_MANTER") != "1":
            shutil.rmtree(pasta, ignore_errors=True)


def test_fora_do_sandbox_a_evolution_exige_https(producao):
    cliente, cabecalho = producao
    canal = criar_canal(cliente, cabecalho, "whatsapp_qr")
    ruim = cliente.patch(f"/api/canais/{canal['id']}", headers=cabecalho, json={"credenciais": {
        "provedor": "evolution", "url_servidor": "http://evolution.empresa.com.br", "api_key": "chave", "nome_instancia": "loja",
    }})
    assert ruim.status_code == 422
    assert ruim.json()["detail"].startswith("Endereço do servidor Evolution precisa usar https://"), ruim.json()
    # criar já com http:// também não passa
    resposta = cliente.post("/api/canais", headers=cabecalho, json={"nome": unico("Evo "), "tipo": "whatsapp_qr", "credenciais": {
        "provedor": "evolution", "url_servidor": "http://evolution.empresa.com.br", "api_key": "chave", "nome_instancia": "loja",
    }})
    assert resposta.status_code == 422

    # na mesma máquina (loopback) o http:// não sai para a internet
    for endereco in ("http://localhost:8080", "http://127.0.0.1:8080", "https://evolution.empresa.com.br"):
        ok = cliente.patch(f"/api/canais/{canal['id']}", headers=cabecalho, json={"credenciais": {
            "provedor": "evolution", "url_servidor": endereco, "api_key": "chave", "nome_instancia": "loja",
        }})
        assert ok.status_code == 200, (endereco, ok.text)


def test_fora_do_sandbox_o_webhook_da_evolution_exige_endereco_https(producao):
    cliente, cabecalho = producao
    canal = criar_canal(cliente, cabecalho, "whatsapp_qr", credenciais={
        # porta 9 do loopback: se o servidor tentasse chamar, a frase seria de falha de rede
        "provedor": "evolution", "url_servidor": "http://127.0.0.1:9", "api_key": "chave", "nome_instancia": "loja",
    })
    resultado = cliente.post(f"/api/canais/{canal['id']}/conectar-webhook", headers=cabecalho).json()
    assert resultado["ok"] is False and "url_publica" in resultado["mensagem"] and "https://" in resultado["mensagem"], resultado
    assert "falha de rede" not in resultado["mensagem"]

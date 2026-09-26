"""WhatsApp pelo QR Code: "Conectar webhook" com o endereço público configurado.

O servidor da sessão da suíte roda sem url_publica (é o caso do computador
local). Aqui sobe um segundo servidor do mesmo alvo, com
url_publica=https://ihchat.teste, SQLite próprio e provedor falso próprio,
para conferir o que vai ao provedor quando o endereço existe.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

import conftest
from utilitarios import ADMIN_EMAIL, ADMIN_SENHA, CHAVE_SECRETA, ProvedorFalso, criar_canal, entrar, unico

URL_PUBLICA = "https://ihchat.teste"


def _subir_php_publico(pasta: Path, porta: int, ambiente: dict, log: Path) -> subprocess.Popen:
    """Como conftest._subir_php, mas SEMPRE em SQLite (o MySQL descartável é
    do servidor da sessão: apagar as tabelas dele derrubaria os outros testes)."""
    config = {
        "driver": "sqlite",
        "dsn": f"sqlite:{pasta / 'publico.sqlite'}",
        "chave_secreta": CHAVE_SECRETA,
        "modo_sandbox": True,
        "pasta_dados": str(pasta / "dados"),
        "pasta_web": str(conftest.RAIZ / "app" / "web"),
        "url_publica": URL_PUBLICA,
    }
    (pasta / "config.json").write_text(json.dumps(config))
    arquivo = pasta / "config.php"
    arquivo.write_text("<?php return json_decode(file_get_contents(__DIR__ . '/config.json'), true);\n")
    ambiente.update(IHCHAT_CONFIG=str(arquivo), PHP_CLI_SERVER_WORKERS="2")
    conftest._rodar([conftest.PHP, "php/console.php", "semear"], ambiente, log)
    return subprocess.Popen(
        [conftest.PHP, "-S", f"127.0.0.1:{porta}", "-t", "php/public", "php/public/index.php"],
        cwd=conftest.RAIZ, env=ambiente, stdout=log.open("a"), stderr=subprocess.STDOUT,
    )


@pytest.fixture(scope="module")
def publico():
    """(url, provedor falso, cabeçalho do admin) de um servidor com url_publica."""
    if os.environ.get("IHCHAT_CONTRATO_URL"):
        pytest.skip("servidor externo: não dá para subir outro com url_publica")
    alvo = os.environ.get("IHCHAT_CONTRATO_ALVO", "python").lower()
    pasta = Path(tempfile.mkdtemp(prefix=f"ihchat-contrato-publico-{alvo}-"))
    provedor = ProvedorFalso(pasta / "provedor.json")
    provedor.limpar()
    porta = conftest._porta_livre()
    log = pasta / "servidor.log"
    ambiente = {**os.environ, "IHCHAT_TESTE_PROVEDOR": str(provedor.arquivo), "IHCHAT_SENHA_ADMIN": ADMIN_SENHA}
    ambiente.pop("IHCHAT_CONFIG", None)
    if alvo == "python":
        ambiente["IHCHAT_URL_PUBLICA"] = URL_PUBLICA
        processo = conftest._subir_python(pasta, porta, ambiente, log)
    else:
        processo = _subir_php_publico(pasta, porta, ambiente, log)
    url = f"http://127.0.0.1:{porta}"
    try:
        conftest._esperar(url, processo, log)
        with httpx.Client(base_url=url, timeout=15.0) as c:
            cabecalho = {"Authorization": f"Bearer {entrar(c, ADMIN_EMAIL, ADMIN_SENHA)['token']}"}
        yield url, provedor, cabecalho
    finally:
        processo.terminate()
        try:
            processo.wait(timeout=10)
        except subprocess.TimeoutExpired:
            processo.kill()
        if os.environ.get("IHCHAT_CONTRATO_MANTER") != "1":
            shutil.rmtree(pasta, ignore_errors=True)


@pytest.fixture
def cliente_publico(publico):
    url, provedor, cabecalho = publico
    provedor.limpar()
    with httpx.Client(base_url=url, timeout=15.0) as c:
        yield c, provedor, cabecalho


def _segredo(cliente, cabecalho, canal) -> str:
    return cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho).json()["segredo_webhook"]


def test_zapi_recebe_a_url_do_webhook_com_o_token_do_canal(cliente_publico):
    cliente, provedor, cabecalho = cliente_publico
    canal = criar_canal(cliente, cabecalho, "whatsapp_qr", credenciais={
        "provedor": "zapi", "instancia_id": "INSTP", "instancia_token": "tok-publico", "client_token": "ct-publico",
    })
    assert canal["url_webhook"] == f"{URL_PUBLICA}/webhooks/{canal['id']}"
    segredo = _segredo(cliente, cabecalho, canal)
    provedor.roteirar("/update-every-webhooks", metodo="PUT", json={"value": True})

    resultado = cliente.post(f"/api/canais/{canal['id']}/conectar-webhook", headers=cabecalho).json()
    assert resultado["ok"] is True, resultado
    assert segredo not in json.dumps(resultado), "o token do webhook não volta em frase nenhuma"

    chamada = provedor.chamadas()[-1]
    assert chamada["metodo"] == "PUT"
    assert chamada["url"] == "https://api.z-api.io/instances/INSTP/token/tok-publico/update-every-webhooks"
    assert chamada["cabecalhos"]["client-token"] == "ct-publico"
    corpo = json.loads(chamada["corpo"])
    assert corpo["notifySentByMe"] is True
    endereco = urlsplit(corpo["value"])
    assert f"{endereco.scheme}://{endereco.netloc}{endereco.path}" == f"{URL_PUBLICA}/webhooks/{canal['id']}"
    assert parse_qs(endereco.query) == {"token": [segredo]}

    # a URL gravada (sem o token) tira o aviso de "webhook não conectado" do teste
    gravadas = cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho).json()["credenciais"]
    assert gravadas["webhook_url"] == f"{URL_PUBLICA}/webhooks/{canal['id']}"
    provedor.roteirar("/status", metodo="GET", json={"connected": True})
    provedor.roteirar("/device", metodo="GET", json={"phone": "5511900001111"})
    teste = cliente.post(f"/api/canais/{canal['id']}/testar", headers=cabecalho).json()
    assert teste["ok"] is True and teste["alerta"] is None, teste

    # e o webhook cadastrado aceita a entrega com esse token
    entrega = {"type": "ReceivedCallback", "phone": "5511900002222", "messageId": unico("zp"), "fromMe": False, "text": {"message": "oi"}}
    resposta = cliente.post(corpo["value"].replace(URL_PUBLICA, ""), json=entrega)
    assert resposta.status_code == 200 and resposta.json()["recebidas"] == 1


def test_evolution_cadastra_o_webhook_e_cria_a_instancia_se_preciso(cliente_publico):
    cliente, provedor, cabecalho = cliente_publico
    instancia = unico("pub-")
    canal = criar_canal(cliente, cabecalho, "whatsapp_qr", credenciais={
        "provedor": "evolution", "url_servidor": "http://evo.interno:8080", "api_key": "chave-evo", "nome_instancia": instancia,
    })
    segredo = _segredo(cliente, cabecalho, canal)
    inexistente = {"status": 404, "error": "Not Found", "response": {"message": [f'The "{instancia}" instance does not exist']}}
    provedor.roteirar("/webhook/set/", metodo="POST", status=404, json=inexistente)
    provedor.roteirar("/instance/create", metodo="POST", status=201, json={"instance": {"instanceName": instancia}, "qrcode": {"base64": None}})

    resultado = cliente.post(f"/api/canais/{canal['id']}/conectar-webhook", headers=cabecalho).json()
    # a instância nasceu, mas o webhook/set (roteirado como 404) continua falhando
    assert resultado["ok"] is False and segredo not in json.dumps(resultado)
    urls = [c["url"] for c in provedor.chamadas()]
    assert urls == [
        f"http://evo.interno:8080/webhook/set/{instancia}",
        "http://evo.interno:8080/instance/create",
        f"http://evo.interno:8080/webhook/set/{instancia}",
    ]
    # a instância criada aqui já nasce com o webhook do IHchat
    criacao = json.loads(provedor.chamadas()[1]["corpo"])
    assert criacao["webhook"]["url"] == f"{URL_PUBLICA}/webhooks/{canal['id']}?token={segredo}"
    assert criacao["webhook"]["base64"] is False

    provedor.limpar()
    provedor.roteirar("/webhook/set/", metodo="POST", status=201, json={"id": "w1", "enabled": True})
    resultado = cliente.post(f"/api/canais/{canal['id']}/conectar-webhook", headers=cabecalho).json()
    assert resultado["ok"] is True, resultado
    chamada = provedor.chamadas()[-1]
    assert chamada["cabecalhos"]["apikey"] == "chave-evo"
    webhook = json.loads(chamada["corpo"])["webhook"]
    # base64 false: a mídia é baixada depois pela API; no JSON do webhook, um
    # vídeo grande estouraria o post_max_size da hospedagem (413) e sumiria
    assert webhook["enabled"] is True and webhook["byEvents"] is False and webhook["base64"] is False
    assert webhook["events"] == ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"]
    assert webhook["url"] == f"{URL_PUBLICA}/webhooks/{canal['id']}?token={segredo}"


def test_conectar_webhook_sem_credenciais_diz_o_que_falta(publico):
    url, provedor, cabecalho = publico
    provedor.limpar()
    with httpx.Client(base_url=url, timeout=15.0) as cliente:
        canal = criar_canal(cliente, cabecalho, "whatsapp_qr")
        resultado = cliente.post(f"/api/canais/{canal['id']}/conectar-webhook", headers=cabecalho).json()
    assert resultado == {
        "ok": False, "mensagem": "preencha: ID da instância (Z-API), Token da instância (Z-API)", "alerta": None,
    }
    assert provedor.chamadas() == []

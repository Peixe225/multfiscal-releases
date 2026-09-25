"""WhatsApp pelo QR Code: o que só o Python tem a provar.

  - o token da instância da Z-API e o token do webhook nunca vão para o log
    (o PHP não registra URLs);
  - o download de mídia vai ao IP conferido, com o nome no Host e no SNI, e
    para ao passar do limite de anexos (no contrato, o provedor falso não
    deixa ver isso: lá o que se prova é que a rede interna não é buscada).
"""
from __future__ import annotations

import logging

import httpx
import pytest

from app.canais import http as canal_http
from app.canais import rede
from app.canais.base import ErroCanal
from app.canais.whatsapp_qr import AdaptadorWhatsAppQR, numero_legivel, problema_no_endereco_evolution
from app.models import Canal, TipoCanal

TOKEN = "TOKEN-SECRETO-DA-INSTANCIA"


def adaptador(credenciais: dict) -> AdaptadorWhatsAppQR:
    return AdaptadorWhatsAppQR(Canal(id=3, nome="QR", tipo=TipoCanal.WHATSAPP_QR.value, credenciais=credenciais, segredo_webhook="s"))


@pytest.fixture
def transporte():
    pedidos: list[httpx.Request] = []
    tratador = {"responder": lambda pedido: httpx.Response(200, json={"connected": True, "phone": "5511988887777"})}

    def responder(pedido: httpx.Request) -> httpx.Response:
        pedidos.append(pedido)
        return tratador["responder"](pedido)

    canal_http.definir_transporte(httpx.MockTransport(responder))
    yield pedidos, tratador
    canal_http.definir_transporte(None)


# ---------------------------------------------------------------- o log
def test_token_da_zapi_nao_vai_para_o_log(transporte, caplog):
    caplog.set_level(logging.INFO, logger="httpx")
    estado = adaptador({"provedor": "zapi", "instancia_id": "INST", "instancia_token": TOKEN}).estado_qr(com_qr=False)
    assert estado.status == "conectado"
    linhas = [r.getMessage() for r in caplog.records if r.name == "httpx"]
    assert linhas, "o httpx registra cada requisição: sem linha, o teste não prova nada"
    assert all(TOKEN not in linha for linha in linhas), linhas
    assert any("/instances/INST/token/<oculto>/status" in linha for linha in linhas), linhas


def test_token_do_webhook_nao_vai_para_o_log_de_acesso(caplog):
    caplog.set_level(logging.INFO, logger="uvicorn.access")
    # o formato do uvicorn: '%s - "%s %s HTTP/%s" %d'
    logging.getLogger("uvicorn.access").info(
        '%s - "%s %s HTTP/%s" %d', "203.0.113.9", "POST", "/webhooks/5?token=SEGREDO-DO-CANAL&x=1", "1.1", 200
    )
    [linha] = [r.getMessage() for r in caplog.records if r.name == "uvicorn.access"]
    assert "SEGREDO-DO-CANAL" not in linha and "/webhooks/5?token=<oculto>&x=1" in linha


# ------------------------------------------------------ rede e tamanho
@pytest.mark.parametrize(
    ("ip", "publico"),
    [
        ("93.184.216.34", True),
        ("2606:2800:220:1:248:1893:25c8:1946", True),
        ("127.0.0.1", False),
        ("10.1.2.3", False),
        ("172.16.0.1", False),
        ("192.168.0.10", False),
        ("169.254.169.254", False),
        ("100.64.0.1", False),
        ("0.0.0.0", False),
        ("224.0.0.1", False),
        ("::1", False),
        ("fe80::1", False),
        ("fd00::1", False),
        ("::ffff:127.0.0.1", False),
        ("::ffff:10.0.0.1", False),
    ],
)
def test_so_endereco_publico(ip, publico):
    assert rede.endereco_publico(ip) is publico


def test_host_que_resolve_para_a_rede_interna_e_recusado(monkeypatch):
    monkeypatch.setattr(rede, "usa_provedor_falso", lambda: False)
    monkeypatch.setattr(rede, "_resolver", lambda host, porta: ["93.184.216.34", "10.0.0.7"])
    with pytest.raises(ErroCanal, match="rede interna"):
        rede.destino_conferido("https://midia.exemplo.com/a.png")
    monkeypatch.setattr(rede, "_resolver", lambda host, porta: [])
    with pytest.raises(ErroCanal, match="localizar"):
        rede.destino_conferido("https://nao-existe.exemplo.com/a.png")


def test_download_vai_ao_ip_conferido_com_o_nome_no_host_e_no_sni(monkeypatch, transporte):
    pedidos, tratador = transporte
    monkeypatch.setattr(rede, "usa_provedor_falso", lambda: False)
    monkeypatch.setattr(rede, "_resolver", lambda host, porta: ["93.184.216.34"])
    tratador["responder"] = lambda pedido: httpx.Response(200, content=b"imagem")
    assert rede.baixar_publico("https://midia.exemplo.com/pasta/a.png?v=1", 1000) == b"imagem"
    [pedido] = pedidos
    assert str(pedido.url) == "https://93.184.216.34/pasta/a.png?v=1"
    assert pedido.headers["host"] == "midia.exemplo.com"
    assert pedido.extensions.get("sni_hostname") == "midia.exemplo.com"


def test_download_para_ao_passar_do_limite(monkeypatch, transporte):
    _, tratador = transporte
    # com Content-Length: recusa antes de ler
    tratador["responder"] = lambda pedido: httpx.Response(200, content=b"x" * 5000)
    with pytest.raises(ErroCanal, match="limite"):
        rede.baixar_publico("https://storage.z-api.teste/grande.mp4", 1000)

    # sem Content-Length (chunked): para no meio, sem juntar o resto
    lidos = []

    def pedacos():
        for _ in range(100):
            lidos.append(1)
            yield b"y" * 400

    tratador["responder"] = lambda pedido: httpx.Response(200, content=pedacos())
    with pytest.raises(ErroCanal, match="limite"):
        rede.baixar_publico("https://storage.z-api.teste/grande.mp4", 1000)
    assert len(lidos) < 10


def test_midia_da_zapi_acima_do_limite_de_anexos(monkeypatch, transporte):
    """O adaptador usa o limite configurado de anexos (tamanho_max_anexo_mb)."""
    from app.servicos import anexos

    _, tratador = transporte
    monkeypatch.setattr(anexos, "limite_bytes", lambda: 10)
    tratador["responder"] = lambda pedido: httpx.Response(200, content=b"z" * 11)
    provedor = adaptador({"provedor": "zapi", "instancia_id": "I", "instancia_token": "t"}).provedor
    with pytest.raises(ErroCanal, match="limite"):
        provedor.baixar_url("https://storage.z-api.teste/a.pdf")


# --------------------------------------------------------------- frases
def test_numero_legivel_como_no_painel():
    assert numero_legivel("5511988887777") == "+55 (11) 98888-7777"
    assert numero_legivel("551133334444") == "+55 (11) 3333-4444"
    assert numero_legivel("14155550100") == "+14155550100"
    assert numero_legivel("123@lid") == "123@lid"


def test_endereco_da_evolution(monkeypatch):
    from app import config

    assert problema_no_endereco_evolution("https://evo.exemplo.com") is None
    assert problema_no_endereco_evolution("evo.exemplo.com").startswith("precisa começar com https://")
    monkeypatch.setattr(config.obter_config(), "modo_sandbox", False)
    assert "https://" in (problema_no_endereco_evolution("http://evo.exemplo.com") or "")
    for local in ("http://localhost:8080", "http://127.0.0.1:8080", "http://[::1]:8080", "http://evo.localhost"):
        assert problema_no_endereco_evolution(local) is None, local

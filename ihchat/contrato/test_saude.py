"""Infra: /saude, front estático, CORS do widget e respostas padrão."""
from __future__ import annotations


def test_saude_anuncia_o_modo_de_eventos(cliente, servidor):
    resposta = cliente.get("/saude")
    assert resposta.status_code == 200
    dados = resposta.json()
    assert dados["status"] == "ok"
    assert dados["aplicacao"] and dados["versao"]
    # o front escolhe EventSource ("stream") ou consulta a cada 2 s ("consulta")
    esperado = {"python": "stream", "php": "consulta"}.get(servidor.alvo)
    assert dados["eventos"] == esperado if esperado else dados["eventos"] in ("stream", "consulta")


def test_raiz_leva_ao_painel(cliente):
    resposta = cliente.get("/")
    assert resposta.status_code == 307
    assert resposta.headers["location"].endswith("/painel")


def test_paginas_do_front(cliente):
    for caminho in ("/painel", "/simulador", "/widget/demo"):
        resposta = cliente.get(caminho)
        assert resposta.status_code == 200, caminho
        assert resposta.headers["content-type"].startswith("text/html"), caminho
    widget = cliente.get("/widget.js")
    assert widget.status_code == 200
    assert "javascript" in widget.headers["content-type"]
    assert cliente.get("/static/painel.css").status_code == 200


def test_static_nao_sai_da_pasta_do_front(cliente):
    assert cliente.get("/static/nao-existe.js").status_code == 404
    assert cliente.get("/static/%2e%2e/main.py").status_code == 404


def test_painel_nao_pode_ser_emoldurado_nem_farejado(cliente):
    resposta = cliente.get("/painel")
    assert resposta.headers.get("x-content-type-options") == "nosniff"
    assert "frame-ancestors" in resposta.headers.get("content-security-policy", "")


def test_rota_desconhecida_e_404_no_formato_do_fastapi(cliente):
    resposta = cliente.get("/api/rota-que-nao-existe")
    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "Not Found"}


def test_metodo_errado_e_405(cliente):
    resposta = cliente.delete("/api/auth/login")
    assert resposta.status_code == 405
    assert resposta.json() == {"detail": "Method Not Allowed"}


def test_preflight_cors_do_widget(cliente):
    resposta = cliente.options(
        "/api/widget/sessao",
        headers={
            "Origin": "https://site-do-cliente.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-sessao",
        },
    )
    assert resposta.status_code == 200
    assert resposta.headers["access-control-allow-origin"] in ("*", "https://site-do-cliente.example")
    assert "POST" in resposta.headers["access-control-allow-methods"]
    assert "x-sessao" in resposta.headers["access-control-allow-headers"].lower()


def test_widget_js_pode_ser_carregado_de_outro_site(cliente):
    resposta = cliente.get("/widget.js", headers={"Origin": "https://site-do-cliente.example"})
    assert resposta.headers.get("access-control-allow-origin") in ("*", "https://site-do-cliente.example")

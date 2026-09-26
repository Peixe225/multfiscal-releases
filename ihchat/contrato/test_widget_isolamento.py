"""O que o navegador anônimo do widget alcança (e o que o freia).

O histórico unificado é da EQUIPE. O visitante só enxerga o que ele mesmo
conversou naquela sessão: nem o e-mail digitado, nem o contato que a sessão
aponta dão acesso ao que chegou por outro canal. E, sendo a única porta da
API aberta a anônimos, a sessão tem freio de ritmo e morre com o canal.
"""
from __future__ import annotations

from utilitarios import exigir_rota, unico

PDF = b"%PDF-1.4\n% boleto privado do cliente\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"print do visitante"


def abrir_sessao(cliente, canal: dict, **dados) -> dict:
    resposta = exigir_rota(
        cliente.post("/api/widget/sessao", json={"chave_publica": canal["chave_publica"], **dados}),
        "POST /api/widget/sessao",
    )
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


def mandar(cliente, visitante: dict, texto: str):
    return cliente.post("/api/widget/mensagens", json={"conteudo": texto}, headers={"X-Sessao": visitante["token"]})


def cursor(cliente, visitante: dict) -> int:
    resposta = exigir_rota(
        cliente.get("/api/widget/eventos/desde", params={"token": visitante["token"]}), "GET /api/widget/eventos/desde"
    )
    assert resposta.status_code == 200, resposta.text
    return resposta.json()["ultimo"]


def test_email_de_cliente_no_widget_nao_abre_o_historico_de_outro_canal(
    cliente, cabecalho_atendente, canal_email, canal_webchat
):
    """A vítima escreve por e-mail; um estranho abre o widget com o endereço
    dela. Nada da conversa de e-mail chega ao navegador dele: nem histórico,
    nem a resposta seguinte, nem o anexo, e a ficha dela não muda de nome."""
    vitima = f"{unico('vitima')}@cliente.example"
    entrada = exigir_rota(
        cliente.post(
            "/api/simulador/mensagens",
            headers=cabecalho_atendente,
            json={"canal_id": canal_email["id"], "identificador": vitima, "conteudo": "Segue meu CPF 123.456.789-00"},
        ),
        "POST /api/simulador/mensagens",
    )
    assert entrada.status_code in (200, 201), entrada.text
    [conversa] = cliente.get("/api/conversas", params={"canal_id": canal_email["id"]}, headers=cabecalho_atendente).json()
    nome_antes = conversa["contato"]["nome"]

    estranho = abrir_sessao(cliente, canal_webchat, nome="Estranho", email=vitima)
    assert estranho["contato_id"] != conversa["contato"]["id"]
    inicio = cursor(cliente, estranho)
    assert cliente.get("/api/widget/mensagens", headers={"X-Sessao": estranho["token"]}).json() == []

    resposta = cliente.post(
        f"/api/conversas/{conversa['id']}/mensagens",
        json={"conteudo": "Sua nova senha provisória é X9"},
        headers=cabecalho_atendente,
    )
    assert resposta.status_code == 201, resposta.text
    anexo = cliente.post(
        f"/api/conversas/{conversa['id']}/anexos",
        headers=cabecalho_atendente,
        files={"arquivo": ("boleto.pdf", PDF, "application/pdf")},
    )
    assert anexo.status_code == 201, anexo.text
    anexo_id = anexo.json()["anexos"][0]["id"]

    eventos = cliente.get("/api/widget/eventos/desde", params={"token": estranho["token"], "depois": inicio})
    assert eventos.status_code == 200 and eventos.json()["eventos"] == []
    assert "X9" not in cliente.get("/api/widget/mensagens", headers={"X-Sessao": estranho["token"]}).text
    baixado = cliente.get(f"/api/widget/anexos/{anexo_id}", params={"token": estranho["token"]})
    assert baixado.status_code == 404
    ficha = cliente.get(f"/api/contatos/{conversa['contato']['id']}", headers=cabecalho_atendente).json()
    assert ficha["nome"] == nome_antes


def test_email_digitado_antes_nao_captura_o_email_que_chega_depois(
    cliente, cabecalho_atendente, canal_email, canal_webchat
):
    """Ordem inversa: o estranho digita o endereço ANTES de a cliente
    escrever. O e-mail dela não pode cair na ficha dele."""
    vitima = f"{unico('cliente')}@empresa.example"
    estranho = abrir_sessao(cliente, canal_webchat, nome="Atacante", email=vitima)
    mandar(cliente, estranho, "oi")
    inicio = cursor(cliente, estranho)

    exigir_rota(
        cliente.post(
            "/api/simulador/mensagens",
            headers=cabecalho_atendente,
            json={"canal_id": canal_email["id"], "identificador": vitima, "conteudo": "Meu CPF é 111.222.333-44"},
        ),
        "POST /api/simulador/mensagens",
    )
    [conversa] = cliente.get("/api/conversas", params={"canal_id": canal_email["id"]}, headers=cabecalho_atendente).json()
    assert conversa["contato"]["id"] != estranho["contato_id"]
    cliente.post(f"/api/conversas/{conversa['id']}/mensagens", json={"conteudo": "boleto W4"}, headers=cabecalho_atendente)

    texto = cliente.get("/api/widget/mensagens", headers={"X-Sessao": estranho["token"]}).text
    assert "111.222.333-44" not in texto and "W4" not in texto
    eventos = cliente.get("/api/widget/eventos/desde", params={"token": estranho["token"], "depois": inicio}).json()
    assert eventos["eventos"] == []


def test_canal_desativado_encerra_as_sessoes_abertas(cliente, cabecalho_admin, canal_webchat):
    """Desligar o canal no meio de um abuso detém quem já tem sessão."""
    visitante = abrir_sessao(cliente, canal_webchat)
    assert mandar(cliente, visitante, "antes").status_code == 201
    anexo_id = cliente.post(
        "/api/widget/anexos", headers={"X-Sessao": visitante["token"]}, files={"arquivo": ("a.png", PNG, "image/png")}
    ).json()["anexos"][0]["id"]

    desligado = cliente.patch(f"/api/canais/{canal_webchat['id']}", json={"ativo": False}, headers=cabecalho_admin)
    assert desligado.status_code == 200, desligado.text
    cabecalho = {"X-Sessao": visitante["token"]}
    tentativas = [
        mandar(cliente, visitante, "canal desativado e eu ainda escrevo"),
        cliente.get("/api/widget/mensagens", headers=cabecalho),
        cliente.post("/api/widget/anexos", headers=cabecalho, files={"arquivo": ("b.png", PNG, "image/png")}),
        cliente.get(f"/api/widget/anexos/{anexo_id}", params={"token": visitante["token"]}),
        cliente.get("/api/widget/eventos/desde", params={"token": visitante["token"], "depois": 0}),
    ]
    for resposta in tentativas:
        assert resposta.status_code == 401, (resposta.request.url, resposta.text)
        assert resposta.json() == {"detail": "sessao do widget invalida"}

    # religado, a conversa continua de onde parou
    cliente.patch(f"/api/canais/{canal_webchat['id']}", json={"ativo": True}, headers=cabecalho_admin)
    assert [m["conteudo"] for m in cliente.get("/api/widget/mensagens", headers=cabecalho).json()] == ["antes", ""]


def test_ritmo_de_mensagens_por_sessao(cliente, canal_webchat):
    """Um robô com a chave pública não despeja mensagens sem fim."""
    visitante = abrir_sessao(cliente, canal_webchat)
    for numero in range(20):
        resposta = mandar(cliente, visitante, f"mensagem {numero}")
        assert resposta.status_code == 201, (numero, resposta.text)
    freada = mandar(cliente, visitante, "a vigésima primeira")
    assert freada.status_code == 429
    assert freada.json() == {"detail": "muitas mensagens em pouco tempo; aguarde um instante"}
    assert freada.headers.get("retry-after")
    arquivo = cliente.post(
        "/api/widget/anexos", headers={"X-Sessao": visitante["token"]}, files={"arquivo": ("a.png", PNG, "image/png")}
    )
    assert arquivo.status_code == 429
    # outra sessão não é afetada
    assert mandar(cliente, abrir_sessao(cliente, canal_webchat), "oi").status_code == 201


def test_html_do_visitante_nao_vira_pagina_no_painel(cliente, cabecalho_atendente, canal_webchat):
    """O tipo vem dos bytes, não do que o navegador declarou: um HTML
    "comprovante" aberto pelo atendente não roda na origem do painel."""
    visitante = abrir_sessao(cliente, canal_webchat)
    html = b"<!doctype html><script>fetch('/api/atendentes?token='+localStorage.ihchat_token)</script>"
    enviada = cliente.post(
        "/api/widget/anexos",
        headers={"X-Sessao": visitante["token"]},
        files={"arquivo": ("comprovante.html", html, "text/html")},
    )
    assert enviada.status_code == 201, enviada.text
    anexo = enviada.json()["anexos"][0]
    assert anexo["imagem"] is False
    for url, parametros in (
        (f"/api/anexos/{anexo['id']}", {"token": cabecalho_atendente["Authorization"].split(" ", 1)[1]}),
        (anexo["url"], {"token": visitante["token"]}),
    ):
        baixado = cliente.get(url, params=parametros)
        assert baixado.status_code == 200, baixado.text
        tipo = baixado.headers["content-type"]
        executavel = tipo.startswith("text/html") or "xml" in tipo or "svg" in tipo
        assert not executavel or (
            "attachment" in baixado.headers.get("content-disposition", "")
            and "sandbox" in baixado.headers.get("content-security-policy", "")
        ), (url, tipo)

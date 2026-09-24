"""Arquivos nas conversas: entrada pelos provedores, saída pelo atendente,
download protegido e limites. Porte de tests/test_anexos.py só com HTTP.

Rotas: POST /api/conversas/{id}/anexos (multipart: arquivo + conteudo) e
GET /api/anexos/{id} (Authorization ou ?token=). Os downloads de mídia da
Meta/Telegram passam pelo provedor falso.
"""
from __future__ import annotations

import base64
import json
import random

import pytest

from utilitarios import criar_canal, exigir_rota, unico

PNG = b"\x89PNG\r\n\x1a\n" + b"conteudo falso de imagem"


def numero() -> str:
    return "55009" + "".join(random.choice("0123456789") for _ in range(8))


def payload_whatsapp(numero_: str, texto: str, externo_id: str) -> dict:
    return {"entry": [{"changes": [{"value": {
        "contacts": [{"wa_id": numero_, "profile": {"name": "Cliente"}}],
        "messages": [{"from": numero_, "id": externo_id, "type": "text", "text": {"body": texto}}],
    }}]}]}


def payload_midia(numero_: str, externo_id: str, midia: dict, tipo: str = "image") -> dict:
    return {"entry": [{"changes": [{"value": {
        "contacts": [{"wa_id": numero_, "profile": {"name": "Cliente"}}],
        "messages": [{"from": numero_, "id": externo_id, "type": tipo, tipo: midia}],
    }}]}]}


def exigir_provedor(servidor, provedor) -> None:
    """Os dois alvos leem OMNI_TESTE_PROVEDOR: sem chamada registrada, o envio nem saiu."""
    assert provedor.chamadas(), f"o servidor ({servidor.alvo}) não chamou o provedor falso"


def conversa_do_canal(cliente, cabecalho, canal_id: int) -> dict:
    resposta = exigir_rota(cliente.get("/api/conversas", params={"canal_id": canal_id}, headers=cabecalho), "GET /api/conversas")
    [conversa] = resposta.json()
    return conversa


def mensagens(cliente, cabecalho, conversa_id: int) -> list[dict]:
    resposta = exigir_rota(cliente.get(f"/api/conversas/{conversa_id}", headers=cabecalho), "GET /api/conversas/{id}")
    return resposta.json()["mensagens"]


def roteirar_midia_ok(provedor) -> None:
    """Os dois passos da Meta: metadados (com a URL temporária) e o arquivo."""
    provedor.roteirar("/media-1", metodo="GET", json={"url": "https://lookaside.fb.example/arquivo", "mime_type": "image/png"})
    provedor.roteirar("lookaside.fb.example", corpo_bytes=PNG, cabecalhos={"Content-Type": "image/png"})


@pytest.fixture
def canal_configurado(cliente, cabecalho_admin) -> dict:
    return criar_canal(cliente, cabecalho_admin, "whatsapp", credenciais={"token": "tk", "id_numero": "5599"})


@pytest.fixture
def conversa_whatsapp(cliente, cabecalho_atendente, canal_configurado) -> dict:
    """Conversa aberta por um "oi" do cliente no canal configurado."""
    cliente.post(f"/webhooks/{canal_configurado['id']}", json=payload_whatsapp(numero(), "oi", unico("wamid.")))
    return conversa_do_canal(cliente, cabecalho_atendente, canal_configurado["id"])


def enviar_arquivo(cliente, cabecalho, conversa_id: int, nome: str, dados: bytes, tipo: str, conteudo: str | None = None):
    campos = {"conteudo": conteudo} if conteudo is not None else None
    return exigir_rota(
        cliente.post(
            f"/api/conversas/{conversa_id}/anexos", headers=cabecalho, files={"arquivo": (nome, dados, tipo)}, data=campos
        ),
        "POST /api/conversas/{id}/anexos",
    )


# --------------------------------------------------------------------- entrada
def test_imagem_do_whatsapp_e_baixada_e_guardada(cliente, cabecalho_atendente, canal_configurado, servidor, provedor):
    roteirar_midia_ok(provedor)
    resposta = cliente.post(
        f"/webhooks/{canal_configurado['id']}",
        json=payload_midia(numero(), unico("wamid.img"), {"id": "media-1", "mime_type": "image/png", "caption": "Segue o print do erro"}),
    )
    assert resposta.json()["recebidas"] == 1
    exigir_provedor(servidor, provedor)
    # o token da Meta vai nas duas chamadas (a URL temporária também o exige)
    assert [c["cabecalhos"]["authorization"] for c in provedor.chamadas()] == ["Bearer tk", "Bearer tk"]

    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal_configurado["id"])
    [mensagem] = mensagens(cliente, cabecalho_atendente, conversa["id"])
    assert mensagem["conteudo"] == "Segue o print do erro"
    [anexo] = mensagem["anexos"]
    assert anexo["nome"] == "image.png" and anexo["tipo_conteudo"] == "image/png"
    assert anexo["tamanho"] == len(PNG) and anexo["erro"] is None
    assert anexo["imagem"] is True
    assert anexo["url"] == f"/api/anexos/{anexo['id']}"

    baixado = cliente.get(anexo["url"], headers=cabecalho_atendente)
    assert baixado.status_code == 200 and baixado.content == PNG
    assert baixado.headers["content-type"].startswith("image/png")
    assert baixado.headers["content-disposition"].startswith("inline")
    assert baixado.headers["x-content-type-options"] == "nosniff"


def test_documento_sem_legenda_vira_previa_com_o_nome(cliente, cabecalho_atendente, canal_configurado, servidor, provedor):
    roteirar_midia_ok(provedor)
    cliente.post(
        f"/webhooks/{canal_configurado['id']}",
        json=payload_midia(numero(), unico("wamid.doc"), {"id": "media-1", "mime_type": "application/pdf", "filename": "apuracao.pdf"}, tipo="document"),
    )
    exigir_provedor(servidor, provedor)
    assert conversa_do_canal(cliente, cabecalho_atendente, canal_configurado["id"])["previa"] == "📎 apuracao.pdf"


def test_falha_no_download_registra_o_anexo_com_erro(cliente, cabecalho_atendente, canal_configurado, servidor, provedor):
    provedor.roteirar("graph.facebook.com", status=404, json={"error": "expirou"})
    resposta = cliente.post(
        f"/webhooks/{canal_configurado['id']}",
        json=payload_midia(numero(), unico("wamid.err"), {"id": "media-1", "mime_type": "image/png"}),
    )
    # a mensagem entra mesmo assim: o atendente precisa saber que veio arquivo
    assert resposta.json()["recebidas"] == 1
    exigir_provedor(servidor, provedor)
    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal_configurado["id"])
    [anexo] = mensagens(cliente, cabecalho_atendente, conversa["id"])[0]["anexos"]
    assert anexo["url"] is None  # sem link, porque não há arquivo
    assert "indisponivel" in anexo["erro"]
    assert cliente.get(f"/api/anexos/{anexo['id']}", headers=cabecalho_atendente).status_code == 404


def test_foto_do_telegram_pega_o_maior_tamanho(cliente, cabecalho_admin, cabecalho_atendente, servidor, provedor):
    canal = criar_canal(cliente, cabecalho_admin, "telegram", credenciais={"token": "bot"})
    segredo = cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho_admin).json()["segredo_webhook"]
    provedor.roteirar("/getFile", json={"ok": True, "result": {"file_path": "photos/f.jpg"}})
    provedor.roteirar("/file/botbot/photos/f.jpg", corpo_bytes=PNG)
    cliente.post(
        f"/webhooks/{canal['id']}",
        json={"message": {"message_id": 3, "chat": {"id": random.randint(1, 10**9)}, "from": {"first_name": "Ana"},
                          "caption": "olha o erro", "photo": [{"file_id": "pequena"}, {"file_id": "grande"}]}},
        headers={"x-telegram-bot-api-secret-token": segredo},
    )
    exigir_provedor(servidor, provedor)
    assert "file_id=grande" in provedor.chamadas()[0]["url"]  # o maior tamanho, não o primeiro
    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal["id"])
    [mensagem] = mensagens(cliente, cabecalho_atendente, conversa["id"])
    assert mensagem["conteudo"] == "olha o erro"
    assert mensagem["anexos"][0]["tamanho"] == len(PNG) and mensagem["anexos"][0]["nome"] == "foto.jpg"


def test_arquivo_do_telegram_grande_demais_fica_registrado_com_o_motivo(cliente, cabecalho_admin, cabecalho_atendente, servidor, provedor):
    canal = criar_canal(cliente, cabecalho_admin, "telegram", credenciais={"token": "bot"})
    segredo = cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho_admin).json()["segredo_webhook"]
    provedor.roteirar("/getFile", status=400, json={"ok": False, "description": "Bad Request: file is too big"})
    cliente.post(
        f"/webhooks/{canal['id']}",
        json={"message": {"message_id": 4, "chat": {"id": random.randint(1, 10**9)}, "from": {"first_name": "Ana"},
                          "document": {"file_id": "doc", "file_name": "balanco.pdf", "mime_type": "application/pdf"}}},
        headers={"x-telegram-bot-api-secret-token": segredo},
    )
    exigir_provedor(servidor, provedor)
    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal["id"])
    assert conversa["previa"] == "📎 balanco.pdf"
    [anexo] = mensagens(cliente, cabecalho_atendente, conversa["id"])[0]["anexos"]
    assert "file is too big" in anexo["erro"] and anexo["url"] is None


# ----------------------------------------------------------------------- saída
def test_atendente_envia_arquivo_pelo_whatsapp(cliente, cabecalho_atendente, conversa_whatsapp, servidor, provedor):
    provedor.roteirar("/media", metodo="POST", json={"id": "media-subida"})
    provedor.roteirar("/messages", metodo="POST", json={"messages": [{"id": unico("wamid.saiu")}]})

    resposta = enviar_arquivo(cliente, cabecalho_atendente, conversa_whatsapp["id"], "manual.pdf", b"%PDF-1.4 conteudo",
                              "application/pdf", "Segue o manual")
    assert resposta.status_code == 201, resposta.text
    exigir_provedor(servidor, provedor)
    corpo = resposta.json()
    assert corpo["status"] == "enviada" and corpo["direcao"] == "saida"
    assert corpo["anexos"][0]["nome"] == "manual.pdf" and corpo["anexos"][0]["imagem"] is False
    assert corpo["anexos"][0]["tipo_conteudo"] == "application/pdf"

    # subiu o arquivo antes de citá-lo na mensagem
    chamadas = provedor.chamadas()
    assert chamadas[-2]["url"].endswith("/5599/media")
    assert b"%PDF-1.4 conteudo" in base64.b64decode(chamadas[-2]["corpo_base64"])
    envio = json.loads(chamadas[-1]["corpo"])
    assert envio["type"] == "document"
    assert envio["document"]["id"] == "media-subida" and envio["document"]["filename"] == "manual.pdf"
    assert envio["document"]["caption"].endswith("Segue o manual")


def test_arquivo_fica_guardado_mesmo_quando_o_envio_falha(cliente, cabecalho_atendente, conversa_whatsapp, servidor, provedor):
    provedor.roteirar("/media", metodo="POST", json={"id": "media-subida"})
    provedor.roteirar("/messages", metodo="POST", status=500, corpo="indisponivel")

    corpo = enviar_arquivo(cliente, cabecalho_atendente, conversa_whatsapp["id"], "print.png", PNG, "image/png").json()
    exigir_provedor(servidor, provedor)
    assert corpo["status"] == "falhou" and "500" in corpo["erro"]
    assert corpo["anexos"][0]["url"]  # o arquivo continua disponível para reenviar
    assert corpo["anexos"][0]["imagem"] is True
    assert cliente.get(corpo["anexos"][0]["url"], headers=cabecalho_atendente).content == PNG


def test_arquivo_em_canal_sem_credenciais_e_simulado_e_guardado(cliente, cabecalho_atendente, canal_whatsapp, provedor):
    cliente.post(f"/webhooks/{canal_whatsapp['id']}", json=payload_whatsapp(numero(), "oi", unico("w.")))
    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal_whatsapp["id"])
    resposta = enviar_arquivo(cliente, cabecalho_atendente, conversa["id"], "relatório final (2).pdf", b"%PDF-1.4 x", "application/pdf")
    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["status"] == "simulada" and corpo["conteudo"] == ""
    # o nome mostrado é o original; o do disco é outro (gerado pelo servidor)
    assert corpo["anexos"][0]["nome"] == "relatório final (2).pdf"
    assert provedor.chamadas() == []
    lista = cliente.get("/api/conversas", params={"canal_id": canal_whatsapp["id"]}, headers=cabecalho_atendente).json()
    assert lista[0]["previa"] == "📎 relatório final (2).pdf"


def test_arquivo_vazio_e_recusado(cliente, cabecalho_atendente, canal_whatsapp):
    cliente.post(f"/webhooks/{canal_whatsapp['id']}", json=payload_whatsapp(numero(), "oi", unico("w.")))
    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal_whatsapp["id"])
    resposta = enviar_arquivo(cliente, cabecalho_atendente, conversa["id"], "vazio.txt", b"", "text/plain")
    assert resposta.status_code == 422
    assert resposta.json() == {"detail": "arquivo vazio"}


def test_sem_o_campo_arquivo(cliente, cabecalho_atendente, canal_whatsapp):
    cliente.post(f"/webhooks/{canal_whatsapp['id']}", json=payload_whatsapp(numero(), "oi", unico("w.")))
    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal_whatsapp["id"])
    resposta = exigir_rota(
        cliente.post(f"/api/conversas/{conversa['id']}/anexos", headers=cabecalho_atendente, files={"outro": ("a.txt", b"x")}),
        "POST /api/conversas/{id}/anexos",
    )
    assert resposta.status_code == 422
    assert resposta.json()["detail"][0]["loc"] == ["body", "arquivo"]


def test_arquivo_acima_do_limite(cliente, cabecalho_atendente, canal_whatsapp):
    cliente.post(f"/webhooks/{canal_whatsapp['id']}", json=payload_whatsapp(numero(), "oi", unico("w.")))
    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal_whatsapp["id"])
    # o limite padrão é 20 MB nos dois servidores
    resposta = enviar_arquivo(cliente, cabecalho_atendente, conversa["id"], "grande.bin", b"x" * (21 * 1024 * 1024),
                              "application/octet-stream")
    assert resposta.status_code == 413
    assert "limite de 20 MB" in resposta.json()["detail"]


def test_envio_em_conversa_inexistente(cliente, cabecalho_atendente):
    resposta = enviar_arquivo(cliente, cabecalho_atendente, 99999999, "a.txt", b"x", "text/plain")
    assert resposta.status_code == 404 and resposta.json() == {"detail": "conversa nao encontrada"}


def test_envio_exige_atendente(cliente, conversa_whatsapp):
    resposta = cliente.post(f"/api/conversas/{conversa_whatsapp['id']}/anexos", files={"arquivo": ("a.txt", b"x", "text/plain")})
    assert resposta.status_code == 401


# -------------------------------------------------------------------- download
def _anexo_guardado(cliente, cabecalho, conversa_id: int, nome="print.png", dados=PNG, tipo="image/png") -> dict:
    resposta = enviar_arquivo(cliente, cabecalho, conversa_id, nome, dados, tipo)
    assert resposta.status_code == 201, resposta.text
    return resposta.json()["anexos"][0]


def test_download_exige_atendente(cliente, cabecalho_atendente, canal_whatsapp):
    cliente.post(f"/webhooks/{canal_whatsapp['id']}", json=payload_whatsapp(numero(), "oi", unico("w.")))
    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal_whatsapp["id"])
    anexo = _anexo_guardado(cliente, cabecalho_atendente, conversa["id"])
    assert cliente.get(f"/api/anexos/{anexo['id']}").status_code == 401


def test_download_aceita_token_na_query(cliente, login_atendente, cabecalho_atendente, canal_whatsapp):
    """`<img src>` não manda cabeçalho; o token na query é a saída."""
    cliente.post(f"/webhooks/{canal_whatsapp['id']}", json=payload_whatsapp(numero(), "oi", unico("w.")))
    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal_whatsapp["id"])
    anexo = _anexo_guardado(cliente, cabecalho_atendente, conversa["id"])
    assert cliente.get(f"/api/anexos/{anexo['id']}", params={"token": login_atendente["token"]}).content == PNG
    assert cliente.get(f"/api/anexos/{anexo['id']}", params={"token": "lixo"}).status_code == 401


def test_anexo_inexistente(cliente, cabecalho_atendente):
    resposta = cliente.get("/api/anexos/99999999", headers=cabecalho_atendente)
    assert resposta.status_code == 404 and resposta.json() == {"detail": "anexo não encontrado"}


def test_nome_com_caminho_nao_escapa_da_pasta(cliente, cabecalho_atendente, canal_whatsapp):
    cliente.post(f"/webhooks/{canal_whatsapp['id']}", json=payload_whatsapp(numero(), "oi", unico("w.")))
    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal_whatsapp["id"])
    anexo = _anexo_guardado(cliente, cabecalho_atendente, conversa["id"], nome="../../etc/passwd", dados=b"dados", tipo="text/plain")
    # o disco usa uma chave gerada pelo servidor: o download é o que foi mandado, não o do sistema
    assert anexo["nome"].endswith("passwd")
    assert cliente.get(anexo["url"], headers=cabecalho_atendente).content == b"dados"


def test_html_enviado_nunca_roda_na_origem_do_painel(cliente, cabecalho_atendente, canal_whatsapp, servidor, request):
    cliente.post(f"/webhooks/{canal_whatsapp['id']}", json=payload_whatsapp(numero(), "oi", unico("w.")))
    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal_whatsapp["id"])
    # disfarçado de imagem: o tipo guardado vem dos bytes, não do que o navegador disse
    html = b"<!doctype html><html><body><script>alert(1)</script></body></html>"
    anexo = _anexo_guardado(cliente, cabecalho_atendente, conversa["id"], nome="foto.png", dados=html, tipo="image/png")
    assert anexo["imagem"] is False
    baixado = cliente.get(anexo["url"], headers=cabecalho_atendente)
    assert baixado.headers["content-disposition"].startswith("attachment")
    assert "sandbox" in baixado.headers.get("content-security-policy", "")


# o Chromium abre text/xsl como documento XML e executa o script de um elemento
# XHTML dentro dele: na origem do painel, com o ?token= do atendente na URL
XSL = b'<r><img xmlns="http://www.w3.org/1999/xhtml" src="data:," onerror="alert(document.domain)"/></r>'


def conferir_download_inerte(resposta) -> None:
    """Ou sai como texto puro (nosniff: o navegador não interpreta), ou como
    download binário isolado. Nunca com um tipo que o navegador executaria."""
    assert resposta.status_code == 200
    if resposta.headers["content-type"].startswith("text/plain"):
        assert resposta.headers["x-content-type-options"] == "nosniff"
        return
    assert resposta.headers["content-disposition"].startswith("attachment")
    assert resposta.headers["content-type"].startswith("application/octet-stream")
    politica = resposta.headers.get("content-security-policy", "")
    assert "sandbox" in politica and "default-src 'none'" in politica


def test_xsl_do_atendente_sai_como_download_isolado(cliente, cabecalho_atendente, canal_whatsapp, servidor, request):
    cliente.post(f"/webhooks/{canal_whatsapp['id']}", json=payload_whatsapp(numero(), "oi", unico("w.")))
    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal_whatsapp["id"])
    anexo = _anexo_guardado(cliente, cabecalho_atendente, conversa["id"], nome="relatorio.xsl", dados=XSL, tipo="text/xsl")
    assert anexo["tipo_conteudo"] != "text/xsl"  # os bytes dizem "texto": o informado ativo não vale
    conferir_download_inerte(cliente.get(anexo["url"], headers=cabecalho_atendente))


def test_xsl_mandado_por_visitante_anonimo_nao_roda_no_painel(cliente, cabecalho_atendente, canal_webchat, servidor, request):
    visitante = exigir_rota(
        cliente.post("/api/widget/sessao", json={"chave_publica": canal_webchat["chave_publica"]}), "POST /api/widget/sessao"
    ).json()
    enviada = exigir_rota(
        cliente.post("/api/widget/anexos", headers={"X-Sessao": visitante["token"]}, files={"arquivo": ("x.xsl", XSL, "text/xsl")}),
        "POST /api/widget/anexos",
    )
    assert enviada.status_code == 201, enviada.text
    [anexo] = enviada.json()["anexos"]
    conferir_download_inerte(cliente.get(f"/api/anexos/{anexo['id']}", headers=cabecalho_atendente))
    conferir_download_inerte(cliente.get(anexo["url"], params={"token": visitante["token"]}))


def test_xsl_declarado_pelo_remetente_do_telegram_nao_roda_no_painel(cliente, cabecalho_admin, cabecalho_atendente, servidor, provedor, request):
    """O tipo do Telegram (document.mime_type) é o que o remetente disse."""
    canal = criar_canal(cliente, cabecalho_admin, "telegram", credenciais={"token": "bot"})
    segredo = cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho_admin).json()["segredo_webhook"]
    provedor.roteirar("/getFile", json={"ok": True, "result": {"file_path": "documents/x.xsl"}})
    provedor.roteirar("/file/botbot/documents/x.xsl", corpo_bytes=XSL)
    cliente.post(
        f"/webhooks/{canal['id']}",
        json={"message": {"message_id": 5, "chat": {"id": random.randint(1, 10**9)}, "from": {"first_name": "Ana"},
                          "document": {"file_id": "doc", "file_name": "x.xsl", "mime_type": "text/xsl"}}},
        headers={"x-telegram-bot-api-secret-token": segredo},
    )
    exigir_provedor(servidor, provedor)
    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal["id"])
    [anexo] = mensagens(cliente, cabecalho_atendente, conversa["id"])[0]["anexos"]
    conferir_download_inerte(cliente.get(anexo["url"], headers=cabecalho_atendente))


def test_tipos_exibiveis_continuam_inline(cliente, cabecalho_atendente, canal_whatsapp, servidor):
    cliente.post(f"/webhooks/{canal_whatsapp['id']}", json=payload_whatsapp(numero(), "oi", unico("w.")))
    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal_whatsapp["id"])
    for nome, dados, tipo in (("nota.pdf", b"%PDF-1.4 nota", "application/pdf"), ("leia.txt", b"texto puro", "text/plain")):
        anexo = _anexo_guardado(cliente, cabecalho_atendente, conversa["id"], nome=nome, dados=dados, tipo=tipo)
        baixado = cliente.get(anexo["url"], headers=cabecalho_atendente)
        assert baixado.headers["content-type"].startswith(tipo), baixado.headers
        assert baixado.headers["content-disposition"].startswith("inline")

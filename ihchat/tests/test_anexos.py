"""Arquivos nas conversas: entrada, saída, permissão e limites."""
import httpx
import pytest
from conftest import criar_canal, payload_whatsapp, payload_whatsapp_midia

from app.armazenamento import ArmazenamentoLocal, nome_seguro
from app.canais import http as canal_http
from app.db import SessaoLocal
from app.models import Anexo, Conversa, Mensagem, TipoCanal

PNG = b"\x89PNG\r\n\x1a\n" + b"conteudo falso de imagem"


@pytest.fixture
def canal_configurado():
    return criar_canal(
        TipoCanal.WHATSAPP, "WhatsApp", credenciais={"token": "tk", "id_numero": "5599"}
    )


def transporte(handler):
    canal_http.definir_transporte(httpx.MockTransport(handler))


def midia_ok(requisicao: httpx.Request) -> httpx.Response:
    """Simula os dois passos da Meta: metadados e depois o arquivo."""
    if requisicao.url.path.endswith("/media-1"):
        return httpx.Response(200, json={"url": "https://lookaside.fb/arquivo", "mime_type": "image/png"})
    if "lookaside" in requisicao.url.host:
        return httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    return httpx.Response(404)


# --------------------------------------------------------------------- entrada
def test_imagem_do_whatsapp_e_baixada_e_guardada(cliente, cabecalho_atendente, canal_configurado):
    transporte(midia_ok)
    resposta = cliente.post(
        f"/webhooks/{canal_configurado.id}",
        json=payload_whatsapp_midia(
            "5500912345678",
            "wamid.img",
            {"id": "media-1", "mime_type": "image/png", "caption": "Segue o print do erro"},
        ),
    )
    assert resposta.json()["recebidas"] == 1

    with SessaoLocal() as sessao:
        anexo = sessao.query(Anexo).one()
        assert anexo.nome == "image.png"
        assert anexo.tipo_conteudo == "image/png"
        assert anexo.tamanho == len(PNG)
        assert anexo.erro is None
        assert sessao.query(Mensagem).one().conteudo == "Segue o print do erro"

    conversa = cliente.get("/api/conversas", headers=cabecalho_atendente).json()[0]
    detalhe = cliente.get(f"/api/conversas/{conversa['id']}", headers=cabecalho_atendente).json()
    anexo = detalhe["mensagens"][0]["anexos"][0]
    assert anexo["imagem"] is True
    assert anexo["url"] == f"/api/anexos/{anexo['id']}"

    baixado = cliente.get(anexo["url"], headers=cabecalho_atendente)
    assert baixado.status_code == 200
    assert baixado.content == PNG
    assert baixado.headers["content-type"].startswith("image/png")


def test_documento_sem_legenda_vira_previa_com_o_nome(cliente, cabecalho_atendente, canal_configurado):
    transporte(midia_ok)
    cliente.post(
        f"/webhooks/{canal_configurado.id}",
        json=payload_whatsapp_midia(
            "5511900000000",
            "wamid.doc",
            {"id": "media-1", "mime_type": "application/pdf", "filename": "apuracao.pdf"},
            tipo="document",
        ),
    )
    conversa = cliente.get("/api/conversas", headers=cabecalho_atendente).json()[0]
    assert conversa["previa"] == "📎 apuracao.pdf"


def test_falha_no_download_registra_o_anexo_com_erro(cliente, cabecalho_atendente, canal_configurado):
    transporte(lambda _: httpx.Response(404, json={"error": "expirou"}))
    resposta = cliente.post(
        f"/webhooks/{canal_configurado.id}",
        json=payload_whatsapp_midia(
            "5511911112222", "wamid.err", {"id": "media-1", "mime_type": "image/png"}
        ),
    )
    # a mensagem entra mesmo assim: o atendente precisa saber que veio arquivo
    assert resposta.json()["recebidas"] == 1
    with SessaoLocal() as sessao:
        anexo = sessao.query(Anexo).one()
        assert anexo.chave is None
        assert "indisponivel" in anexo.erro

    conversa = cliente.get("/api/conversas", headers=cabecalho_atendente).json()[0]
    detalhe = cliente.get(f"/api/conversas/{conversa['id']}", headers=cabecalho_atendente).json()
    anexo = detalhe["mensagens"][0]["anexos"][0]
    assert anexo["url"] is None  # sem link, porque não há arquivo
    assert cliente.get(f"/api/anexos/{anexo['id']}", headers=cabecalho_atendente).status_code == 404


def test_foto_do_telegram(cliente, cabecalho_atendente):
    canal = criar_canal(TipoCanal.TELEGRAM, "TG", credenciais={"token": "bot"})

    def responder(requisicao: httpx.Request) -> httpx.Response:
        if "getFile" in requisicao.url.path:
            return httpx.Response(200, json={"ok": True, "result": {"file_path": "photos/f.jpg"}})
        return httpx.Response(200, content=PNG)

    transporte(responder)
    cliente.post(
        f"/webhooks/{canal.id}",
        json={
            "message": {
                "message_id": 3,
                "chat": {"id": 7},
                "from": {"first_name": "Ana"},
                "caption": "olha o erro",
                "photo": [{"file_id": "pequena"}, {"file_id": "grande"}],
            }
        },
    )
    with SessaoLocal() as sessao:
        anexo = sessao.query(Anexo).one()
        assert anexo.externo_id == "grande"  # o maior tamanho, não o primeiro
        assert anexo.tamanho == len(PNG)


# ----------------------------------------------------------------------- saída
def test_atendente_envia_arquivo_pelo_whatsapp(cliente, cabecalho_atendente, canal_configurado):
    chamadas = []

    def responder(requisicao: httpx.Request) -> httpx.Response:
        chamadas.append(requisicao)
        if requisicao.url.path.endswith("/media"):
            return httpx.Response(200, json={"id": "media-subida"})
        return httpx.Response(200, json={"messages": [{"id": "wamid.saiu"}]})

    transporte(responder)
    cliente.post(
        f"/webhooks/{canal_configurado.id}", json=payload_whatsapp("5500912345678", "oi", "wamid.1")
    )
    with SessaoLocal() as sessao:
        conversa_id = sessao.query(Conversa).one().id

    resposta = cliente.post(
        f"/api/conversas/{conversa_id}/anexos",
        headers=cabecalho_atendente,
        files={"arquivo": ("manual.pdf", b"%PDF-1.4 conteudo", "application/pdf")},
        data={"conteudo": "Segue o manual"},
    )
    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["status"] == "enviada"
    assert corpo["anexos"][0]["nome"] == "manual.pdf"
    assert corpo["anexos"][0]["imagem"] is False

    # subiu o arquivo antes de citá-lo na mensagem
    assert chamadas[-2].url.path.endswith("/media")
    import json as _json

    envio = _json.loads(chamadas[-1].content)
    assert envio["type"] == "document"
    assert envio["document"] == {
        "id": "media-subida",
        "caption": "*Ana*\nSegue o manual",  # quem responde vai na primeira linha
        "filename": "manual.pdf",
    }


def test_arquivo_fica_guardado_mesmo_quando_o_envio_falha(
    cliente, cabecalho_atendente, canal_configurado
):
    def responder(requisicao: httpx.Request) -> httpx.Response:
        if requisicao.url.path.endswith("/media"):
            return httpx.Response(200, json={"id": "media-subida"})
        return httpx.Response(500, text="indisponivel")

    transporte(responder)
    cliente.post(
        f"/webhooks/{canal_configurado.id}", json=payload_whatsapp("5511933334444", "oi", "wamid.2")
    )
    with SessaoLocal() as sessao:
        conversa_id = sessao.query(Conversa).one().id

    corpo = cliente.post(
        f"/api/conversas/{conversa_id}/anexos",
        headers=cabecalho_atendente,
        files={"arquivo": ("print.png", PNG, "image/png")},
    ).json()
    assert corpo["status"] == "falhou"
    assert corpo["anexos"][0]["url"]  # o arquivo continua disponível para reenviar
    assert cliente.get(corpo["anexos"][0]["url"], headers=cabecalho_atendente).content == PNG


def test_canal_que_nao_transporta_arquivo_recusa_antes_de_gravar(
    cliente, cabecalho_atendente, canal_whatsapp, monkeypatch
):
    cliente.post(f"/webhooks/{canal_whatsapp.id}", json=payload_whatsapp("5511955556666", "oi", "w.3"))
    with SessaoLocal() as sessao:
        conversa_id = sessao.query(Conversa).one().id

    monkeypatch.setattr("app.canais.whatsapp.AdaptadorWhatsApp.envia_arquivos", property(lambda self: False))
    resposta = cliente.post(
        f"/api/conversas/{conversa_id}/anexos",
        headers=cabecalho_atendente,
        files={"arquivo": ("x.png", PNG, "image/png")},
    )
    assert resposta.status_code == 409
    with SessaoLocal() as sessao:
        assert sessao.query(Anexo).count() == 0


def test_arquivo_acima_do_limite(cliente, cabecalho_atendente, canal_whatsapp, monkeypatch):
    from app.config import obter_config

    monkeypatch.setattr(obter_config(), "tamanho_max_anexo_mb", 0)
    cliente.post(f"/webhooks/{canal_whatsapp.id}", json=payload_whatsapp("5511977778888", "oi", "w.4"))
    with SessaoLocal() as sessao:
        conversa_id = sessao.query(Conversa).one().id

    resposta = cliente.post(
        f"/api/conversas/{conversa_id}/anexos",
        headers=cabecalho_atendente,
        files={"arquivo": ("grande.bin", b"x" * 10, "application/octet-stream")},
    )
    assert resposta.status_code == 413


def test_arquivo_vazio_e_recusado(cliente, cabecalho_atendente, canal_whatsapp):
    cliente.post(f"/webhooks/{canal_whatsapp.id}", json=payload_whatsapp("5511999990000", "oi", "w.5"))
    with SessaoLocal() as sessao:
        conversa_id = sessao.query(Conversa).one().id
    resposta = cliente.post(
        f"/api/conversas/{conversa_id}/anexos",
        headers=cabecalho_atendente,
        files={"arquivo": ("vazio.txt", b"", "text/plain")},
    )
    assert resposta.status_code == 422


def test_download_exige_atendente(cliente, cabecalho_atendente, canal_configurado):
    transporte(midia_ok)
    cliente.post(
        f"/webhooks/{canal_configurado.id}",
        json=payload_whatsapp_midia("5511900001111", "wamid.p", {"id": "media-1", "mime_type": "image/png"}),
    )
    with SessaoLocal() as sessao:
        anexo_id = sessao.query(Anexo).one().id
    assert cliente.get(f"/api/anexos/{anexo_id}").status_code == 401


# ------------------------------------------------------------------- unidade
def test_nome_de_arquivo_nao_escapa_da_pasta(tmp_path):
    armazenamento = ArmazenamentoLocal(tmp_path / "anexos")
    chave = armazenamento.salvar(b"dados", "../../etc/passwd")
    assert "/" not in chave and chave.endswith("passwd")
    assert armazenamento.ler(chave) == b"dados"
    armazenamento.remover(chave)
    assert nome_seguro("relatório final (2).pdf") == "relatorio_final_2_.pdf"


def test_download_aceita_token_na_query(cliente, cabecalho_atendente, canal_configurado):
    """`<img src>` não manda cabeçalho; o token na query é a saída."""
    transporte(midia_ok)
    cliente.post(
        f"/webhooks/{canal_configurado.id}",
        json=payload_whatsapp_midia("5511900002222", "wamid.q", {"id": "media-1", "mime_type": "image/png"}),
    )
    with SessaoLocal() as sessao:
        anexo_id = sessao.query(Anexo).one().id

    token = cabecalho_atendente["Authorization"].split(" ")[1]
    assert cliente.get(f"/api/anexos/{anexo_id}", params={"token": token}).content == PNG
    assert cliente.get(f"/api/anexos/{anexo_id}", params={"token": "lixo"}).status_code == 401

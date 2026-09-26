"""Widget de webchat (app/api/widget.py e php/app/Widget/Rotas.php).

O visitante do site não tem login: abre uma sessão com a chave pública do
canal e fala por ela. Quem responde aparece para ele com nome e setor
("Ana · Suporte técnico"), sem o texto da mensagem mudar.

A base é compartilhada pela sessão de testes: cada teste cria o seu canal de
webchat e filtra as conversas por ele.
"""
from __future__ import annotations

import pytest

from utilitarios import data_com_fuso, exigir_rota, unico

PNG = b"\x89PNG\r\n\x1a\n" + b"print do visitante"
CAMPOS_WIDGET = {"id", "direcao", "conteudo", "criada_em", "autor", "assinatura", "anexos"}


# ------------------------------------------------------------------ apoio
def abrir_sessao(cliente, canal: dict, **dados) -> dict:
    resposta = exigir_rota(
        cliente.post("/api/widget/sessao", json={"chave_publica": canal["chave_publica"], **dados}),
        "POST /api/widget/sessao",
    )
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


def mandar(cliente, visitante: dict, texto: str):
    return cliente.post("/api/widget/mensagens", json={"conteudo": texto}, headers={"X-Sessao": visitante["token"]})


def historico(cliente, visitante: dict) -> list[dict]:
    resposta = cliente.get("/api/widget/mensagens", headers={"X-Sessao": visitante["token"]})
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


def conversa_do_canal(cliente, cabecalho, canal: dict) -> dict:
    [conversa] = cliente.get("/api/conversas", params={"canal_id": canal["id"]}, headers=cabecalho).json()
    return conversa


def desde_widget(cliente, visitante: dict, depois=None):
    parametros = {"token": visitante["token"]}
    if depois is not None:
        parametros["depois"] = depois
    return exigir_rota(cliente.get("/api/widget/eventos/desde", params=parametros), "GET /api/widget/eventos/desde")


@pytest.fixture
def ana_com_setor(cliente, cabecalho_atendente, cabecalho_admin, login_atendente):
    """A Ana responde como "Suporte técnico" (e volta ao setor de antes). O
    setor é de quem gerencia a equipe: o admin põe e tira."""
    eu = login_atendente["atendente"]
    antes = cliente.get("/api/auth/eu", headers=cabecalho_atendente).json().get("setor")
    mudou = cliente.patch(f"/api/atendentes/{eu['id']}", json={"setor": "Suporte técnico"}, headers=cabecalho_admin)
    if "setor" not in mudou.json():
        pytest.skip("o alvo ainda não tem o setor do atendente")
    yield {"nome": eu["nome"], "setor": "Suporte técnico"}
    cliente.patch(f"/api/atendentes/{eu['id']}", json={"setor": antes}, headers=cabecalho_admin)


# ----------------------------------------------------------------- sessão
def test_sessao_devolve_token_contato_e_nome(cliente, canal_webchat):
    visitante = abrir_sessao(cliente, canal_webchat, nome="Padaria do Zé")
    assert set(visitante) == {"token", "contato_id", "nome"}
    assert visitante["token"].startswith("ws_")
    assert visitante["nome"] == "Padaria do Zé"
    assert isinstance(visitante["contato_id"], int)


def test_sessao_sem_nome_vira_visitante_do_site(cliente, canal_webchat):
    assert abrir_sessao(cliente, canal_webchat)["nome"] == "Visitante do site"


def test_email_digitado_nao_liga_a_sessao_a_ficha_de_ninguem(cliente, cabecalho_atendente, canal_webchat):
    """O e-mail digitado no widget não prova nada (a chave pública está no
    HTML do site): cada sessão tem a sua ficha, a segunda sessão com o mesmo
    endereço não lê a primeira, e a ficha da primeira não é renomeada."""
    email = f"{unico('cliente')}@Empresa.example"
    primeira = abrir_sessao(cliente, canal_webchat, nome="Maria", email=email)
    mandar(cliente, primeira, "meu CPF é 123.456.789-00")
    segunda = abrir_sessao(cliente, canal_webchat, nome="Estranho", email=email.lower())
    assert segunda["contato_id"] != primeira["contato_id"]
    assert segunda["nome"] == "Estranho"
    assert historico(cliente, segunda) == []
    assert [m["conteudo"] for m in historico(cliente, primeira)] == ["meu CPF é 123.456.789-00"]

    ficha = cliente.get(f"/api/contatos/{primeira['contato_id']}", headers=cabecalho_atendente).json()
    assert ficha["nome"] == "Maria"
    # o endereço fica à vista da equipe, sem virar o e-mail da ficha
    nova = cliente.get(f"/api/contatos/{segunda['contato_id']}", headers=cabecalho_atendente).json()
    assert nova["email"] is None
    assert email.lower() in (nova["observacoes"] or "")


def test_chave_publica_desconhecida(cliente):
    resposta = exigir_rota(
        cliente.post("/api/widget/sessao", json={"chave_publica": "wc_nao_existe"}), "POST /api/widget/sessao"
    )
    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "canal de webchat nao encontrado"}


def test_canal_desativado_nao_abre_sessao(cliente, cabecalho_admin, canal_webchat):
    cliente.patch(f"/api/canais/{canal_webchat['id']}", json={"ativo": False}, headers=cabecalho_admin)
    resposta = cliente.post("/api/widget/sessao", json={"chave_publica": canal_webchat["chave_publica"]})
    assert resposta.status_code == 404


def test_sessao_valida_o_corpo(cliente, canal_webchat):
    assert cliente.post("/api/widget/sessao", json={}).status_code == 422
    invalido = cliente.post(
        "/api/widget/sessao", json={"chave_publica": canal_webchat["chave_publica"], "email": "nao-e-email"}
    )
    assert invalido.status_code == 422
    longo = cliente.post("/api/widget/sessao", json={"chave_publica": canal_webchat["chave_publica"], "nome": "x" * 161})
    assert longo.status_code == 422


def test_sem_sessao_ou_sessao_invalida(cliente):
    sem = exigir_rota(cliente.post("/api/widget/mensagens", json={"conteudo": "oi"}), "POST /api/widget/mensagens")
    assert sem.status_code == 401
    assert sem.json() == {"detail": "sessao do widget ausente"}
    falsa = cliente.post("/api/widget/mensagens", json={"conteudo": "oi"}, headers={"X-Sessao": "ws_falsa"})
    assert falsa.status_code == 401
    assert falsa.json() == {"detail": "sessao do widget invalida"}
    assert cliente.get("/api/widget/mensagens").status_code == 401


# ------------------------------------------------------------- conversa
def test_visitante_escreve_e_cai_na_caixa_de_entrada(cliente, cabecalho_atendente, canal_webchat):
    visitante = abrir_sessao(cliente, canal_webchat, nome="Visitante Teste")
    enviada = mandar(cliente, visitante, "  Vocês atendem no sábado?  ")
    assert enviada.status_code == 201, enviada.text
    corpo = enviada.json()
    assert set(corpo) >= CAMPOS_WIDGET
    assert corpo["direcao"] == "entrada"
    assert corpo["conteudo"] == "Vocês atendem no sábado?"
    assert corpo["autor"] == "Visitante Teste"
    assert corpo["assinatura"] is None
    data_com_fuso(corpo["criada_em"])

    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal_webchat)
    assert conversa["canal"]["tipo"] == "webchat"
    assert conversa["contato"]["id"] == visitante["contato_id"]
    assert conversa["previa"] == "Vocês atendem no sábado?"

    # a segunda mensagem entra na mesma conversa
    assert mandar(cliente, visitante, "É para amanhã").status_code == 201
    assert conversa_do_canal(cliente, cabecalho_atendente, canal_webchat)["id"] == conversa["id"]


def test_mensagem_vazia_ou_longa_demais(cliente, canal_webchat):
    visitante = abrir_sessao(cliente, canal_webchat)
    assert mandar(cliente, visitante, "").status_code == 422
    # só espaços também: viraria uma mensagem vazia na caixa da equipe
    assert mandar(cliente, visitante, "   ").status_code == 422
    assert mandar(cliente, visitante, "x" * 8001).status_code == 422


def test_resposta_chega_ao_visitante_com_nome_e_setor(cliente, cabecalho_atendente, canal_webchat, ana_com_setor):
    visitante = abrir_sessao(cliente, canal_webchat, nome="Cliente do site")
    mandar(cliente, visitante, "Preciso de ajuda com a nota")
    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal_webchat)
    cursor = desde_widget(cliente, visitante).json()["ultimo"]

    resposta = cliente.post(
        f"/api/conversas/{conversa['id']}/mensagens", json={"conteudo": "Olá! Já vejo."}, headers=cabecalho_atendente
    )
    assert resposta.status_code == 201, resposta.text
    # webchat: o texto fica intacto; nome e setor vão em campos próprios
    assert resposta.json()["conteudo"] == "Olá! Já vejo."
    assert resposta.json()["status"] == "enviada"

    mensagens = historico(cliente, visitante)
    assert [(m["direcao"], m["conteudo"]) for m in mensagens] == [
        ("entrada", "Preciso de ajuda com a nota"),
        ("saida", "Olá! Já vejo."),
    ]
    assert mensagens[1]["assinatura"] == ana_com_setor
    assert mensagens[1]["autor"] == ana_com_setor["nome"]
    assert mensagens[0]["assinatura"] is None

    # e em tempo real, pela consulta do widget
    eventos = desde_widget(cliente, visitante, cursor).json()["eventos"]
    assert [e["tipo"] for e in eventos] == ["mensagem.nova"]
    assert eventos[0]["dados"]["conteudo"] == "Olá! Já vejo."
    assert eventos[0]["dados"]["assinatura"] == ana_com_setor


def test_nota_interna_nunca_chega_ao_visitante(cliente, cabecalho_atendente, canal_webchat):
    visitante = abrir_sessao(cliente, canal_webchat)
    mandar(cliente, visitante, "olá")
    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal_webchat)
    cursor = desde_widget(cliente, visitante).json()["ultimo"]
    nota = cliente.post(
        f"/api/conversas/{conversa['id']}/notas", json={"conteudo": "cliente inadimplente"}, headers=cabecalho_atendente
    )
    assert nota.status_code == 201
    assert [m["conteudo"] for m in historico(cliente, visitante)] == ["olá"]
    assert desde_widget(cliente, visitante, cursor).json()["eventos"] == []


def test_visitante_nao_ve_conversa_de_outro(cliente, cabecalho_atendente, canal_webchat):
    um = abrir_sessao(cliente, canal_webchat, nome="Um")
    outro = abrir_sessao(cliente, canal_webchat, nome="Outro")
    mandar(cliente, um, "mensagem do um")
    mandar(cliente, outro, "mensagem do outro")
    assert [m["conteudo"] for m in historico(cliente, um)] == ["mensagem do um"]
    assert [m["conteudo"] for m in historico(cliente, outro)] == ["mensagem do outro"]


# ------------------------------------------------------------- eventos
def test_eventos_do_widget_sem_cursor_e_validacao(cliente, canal_webchat):
    visitante = abrir_sessao(cliente, canal_webchat)
    inicio = desde_widget(cliente, visitante)
    assert inicio.status_code == 200
    assert inicio.json()["eventos"] == [] and isinstance(inicio.json()["ultimo"], int)
    assert cliente.get("/api/widget/eventos/desde", params={"token": visitante["token"], "depois": "x"}).status_code == 422
    assert cliente.get("/api/widget/eventos/desde", params={"token": visitante["token"], "depois": -1}).status_code == 422


def test_eventos_do_widget_exigem_sessao(cliente):
    sem = exigir_rota(cliente.get("/api/widget/eventos/desde"), "GET /api/widget/eventos/desde")
    assert sem.status_code == 401
    assert sem.json() == {"detail": "sessao do widget ausente"}
    falsa = cliente.get("/api/widget/eventos/desde", params={"token": "ws_falsa", "depois": 0})
    assert falsa.status_code == 401
    assert falsa.json() == {"detail": "sessao do widget invalida"}


def test_eventos_do_widget_aceitam_a_sessao_no_cabecalho(cliente, canal_webchat):
    visitante = abrir_sessao(cliente, canal_webchat)
    resposta = cliente.get("/api/widget/eventos/desde", headers={"X-Sessao": visitante["token"]})
    assert resposta.status_code == 200
    # ?token= vazio conta como ausente: vale o cabeçalho (era 401 no PHP)
    vazio = cliente.get("/api/widget/eventos/desde?token=&depois=0", headers={"X-Sessao": visitante["token"]})
    assert vazio.status_code == 200, vazio.text
    assert vazio.json()["eventos"] == []


@pytest.mark.parametrize("depois", ["99999999999999999999", "9223372036854775808", str(10**18)])
def test_cursor_enorme_do_widget_e_422(cliente, canal_webchat, depois):
    """Maior que 18 dígitos: 422 nos dois (no Python era 500)."""
    visitante = abrir_sessao(cliente, canal_webchat)
    resposta = cliente.get("/api/widget/eventos/desde", params={"token": visitante["token"], "depois": depois})
    assert resposta.status_code == 422, resposta.text


def test_widget_descobre_o_modo_de_eventos_numa_rota_com_cors(cliente):
    """O widget roda no site de terceiros: o /saude do PHP não tem CORS, então
    o modo ("stream" ou "consulta") também sai em /api/widget/saude."""
    resposta = exigir_rota(
        cliente.get("/api/widget/saude", headers={"Origin": "https://loja.example"}), "GET /api/widget/saude"
    )
    assert resposta.status_code == 200
    assert resposta.headers.get("access-control-allow-origin") in ("*", "https://loja.example")
    assert resposta.json()["eventos"] == cliente.get("/saude").json()["eventos"]
    assert resposta.json()["eventos"] in ("stream", "consulta")


def test_evento_do_widget_tem_o_formato_do_historico(cliente, cabecalho_atendente, canal_webchat):
    """Nada da MensagemSaida do painel (status, erro, atendente_id, conversa_id)
    vai ao navegador do visitante; o anexo aponta para a rota do widget."""
    visitante = abrir_sessao(cliente, canal_webchat)
    mandar(cliente, visitante, "oi")
    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal_webchat)
    cursor = desde_widget(cliente, visitante).json()["ultimo"]
    enviada = cliente.post(
        f"/api/conversas/{conversa['id']}/anexos",
        headers=cabecalho_atendente,
        files={"arquivo": ("tela.png", PNG, "image/png")},
        data={"conteudo": "veja"},
    )
    assert enviada.status_code == 201, enviada.text
    [evento] = desde_widget(cliente, visitante, cursor).json()["eventos"]
    assert set(evento["dados"]) == CAMPOS_WIDGET
    [anexo] = evento["dados"]["anexos"]
    assert anexo["url"] == f"/api/widget/anexos/{anexo['id']}"
    assert evento["dados"] == historico(cliente, visitante)[-1]


def test_mensagem_do_proprio_visitante_nao_volta_como_evento(cliente, canal_webchat):
    """O widget desenha o que o visitante mandou com a resposta do POST."""
    visitante = abrir_sessao(cliente, canal_webchat)
    cursor = desde_widget(cliente, visitante).json()["ultimo"]
    mandar(cliente, visitante, "oi")
    dados = desde_widget(cliente, visitante, cursor).json()
    assert dados["eventos"] == []
    assert dados["ultimo"] > cursor  # o cursor anda mesmo sem nada para ele


# ------------------------------------------------------------- anexos
def test_visitante_manda_arquivo_e_o_atendente_recebe(cliente, cabecalho_atendente, canal_webchat):
    visitante = abrir_sessao(cliente, canal_webchat, nome="Padaria")
    enviada = exigir_rota(
        cliente.post(
            "/api/widget/anexos",
            headers={"X-Sessao": visitante["token"]},
            files={"arquivo": ("erro.png", PNG, "image/png")},
            data={"conteudo": "É essa tela"},
        ),
        "POST /api/widget/anexos",
    )
    assert enviada.status_code == 201, enviada.text
    corpo = enviada.json()
    assert corpo["conteudo"] == "É essa tela"
    [anexo] = corpo["anexos"]
    assert anexo["imagem"] is True and anexo["nome"] == "erro.png"
    assert anexo["url"] == f"/api/widget/anexos/{anexo['id']}"

    baixado = cliente.get(anexo["url"], params={"token": visitante["token"]})
    assert baixado.status_code == 200 and baixado.content == PNG

    conversa = conversa_do_canal(cliente, cabecalho_atendente, canal_webchat)
    detalhe = cliente.get(f"/api/conversas/{conversa['id']}", headers=cabecalho_atendente).json()
    do_atendente = detalhe["mensagens"][0]["anexos"][0]
    assert do_atendente["url"] == f"/api/anexos/{do_atendente['id']}"
    assert cliente.get(do_atendente["url"], headers=cabecalho_atendente).content == PNG


def test_anexo_so_para_o_dono_da_sessao(cliente, canal_webchat):
    dono = abrir_sessao(cliente, canal_webchat)
    outro = abrir_sessao(cliente, canal_webchat)
    anexo = cliente.post(
        "/api/widget/anexos", headers={"X-Sessao": dono["token"]}, files={"arquivo": ("a.png", PNG, "image/png")}
    ).json()["anexos"][0]
    assert cliente.get(anexo["url"], params={"token": dono["token"]}).status_code == 200
    alheio = cliente.get(anexo["url"], params={"token": outro["token"]})
    assert alheio.status_code == 404
    assert alheio.json() == {"detail": "anexo não encontrado"}
    assert cliente.get(anexo["url"], params={"token": "ws_falsa"}).status_code == 401
    assert cliente.get(anexo["url"]).status_code == 422  # o token é obrigatório


def test_arquivo_vazio_ou_ausente(cliente, canal_webchat):
    visitante = abrir_sessao(cliente, canal_webchat)
    vazio = cliente.post(
        "/api/widget/anexos", headers={"X-Sessao": visitante["token"]}, files={"arquivo": ("v.txt", b"", "text/plain")}
    )
    assert vazio.status_code == 422
    assert vazio.json() == {"detail": "arquivo vazio"}
    sem = cliente.post("/api/widget/anexos", headers={"X-Sessao": visitante["token"]}, data={"conteudo": "x"})
    assert sem.status_code == 422


def test_anexo_sem_sessao(cliente):
    resposta = cliente.post("/api/widget/anexos", files={"arquivo": ("a.png", PNG, "image/png")})
    assert resposta.status_code == 401


def test_html_enviado_pelo_widget_nao_roda_no_navegador(cliente, canal_webchat):
    """Um HTML chamado "foto.png" não pode ser servido como página."""
    visitante = abrir_sessao(cliente, canal_webchat)
    html = b"<!doctype html><html><body><script>alert(1)</script></body></html>"
    anexo = cliente.post(
        "/api/widget/anexos", headers={"X-Sessao": visitante["token"]}, files={"arquivo": ("foto.png", html, "image/png")}
    ).json()["anexos"][0]
    baixado = cliente.get(anexo["url"], params={"token": visitante["token"]})
    assert baixado.status_code == 200
    tipo = baixado.headers["content-type"]
    executavel = tipo.startswith("text/html") or "svg" in tipo
    # ou sai com outro tipo, ou sai como download com CSP sandbox
    assert not executavel or (
        "attachment" in baixado.headers.get("content-disposition", "")
        and "sandbox" in baixado.headers.get("content-security-policy", "")
    )
    assert baixado.headers.get("x-content-type-options") == "nosniff"


# ---------------------------------------------------------------- CORS
def test_widget_responde_a_outro_site(cliente, canal_webchat):
    resposta = cliente.post(
        "/api/widget/sessao",
        json={"chave_publica": canal_webchat["chave_publica"]},
        headers={"Origin": "https://site-do-cliente.example"},
    )
    assert resposta.status_code == 201
    assert resposta.headers.get("access-control-allow-origin") in ("*", "https://site-do-cliente.example")

from app.db import SessaoLocal
from app.models import Contato, Conversa, Mensagem


def abrir_sessao(cliente, canal, **dados):
    resposta = cliente.post(
        "/api/widget/sessao", json={"chave_publica": canal.chave_publica, **dados}
    )
    assert resposta.status_code == 201, resposta.text
    return resposta.json()["token"]


def test_visitante_conversa_e_atendente_responde(cliente, cabecalho_atendente, canal_webchat):
    token = abrir_sessao(cliente, canal_webchat, nome="Visitante Teste")

    enviada = cliente.post(
        "/api/widget/mensagens", headers={"X-Sessao": token}, json={"conteudo": "Vocês atendem no sábado?"}
    )
    assert enviada.status_code == 201
    assert enviada.json()["direcao"] == "entrada"

    # a mensagem cai na caixa de entrada como qualquer outro canal
    conversas = cliente.get("/api/conversas", headers=cabecalho_atendente).json()
    assert len(conversas) == 1
    assert conversas[0]["canal"]["tipo"] == "webchat"

    cliente.post(
        f"/api/conversas/{conversas[0]['id']}/mensagens",
        headers=cabecalho_atendente,
        json={"conteudo": "Atendemos sim, das 8h às 12h."},
    )

    historico = cliente.get("/api/widget/mensagens", headers={"X-Sessao": token}).json()
    assert [m["conteudo"] for m in historico] == [
        "Vocês atendem no sábado?",
        "Atendemos sim, das 8h às 12h.",
    ]
    assert historico[1]["autor"] == "Ana"


def test_nota_interna_nao_aparece_para_o_visitante(cliente, cabecalho_atendente, canal_webchat):
    token = abrir_sessao(cliente, canal_webchat)
    cliente.post("/api/widget/mensagens", headers={"X-Sessao": token}, json={"conteudo": "olá"})
    conversa_id = cliente.get("/api/conversas", headers=cabecalho_atendente).json()[0]["id"]

    cliente.post(
        f"/api/conversas/{conversa_id}/notas",
        headers=cabecalho_atendente,
        json={"conteudo": "Visitante veio da campanha do Google"},
    )
    historico = cliente.get("/api/widget/mensagens", headers={"X-Sessao": token}).json()
    assert len(historico) == 1


def test_visitante_com_email_reaproveita_a_ficha_existente(cliente, canal_webchat, sessao):
    sessao.add(Contato(nome="Loja Exemplo", email="contato@loja.com.br"))
    sessao.commit()

    dados = cliente.post(
        "/api/widget/sessao",
        json={"chave_publica": canal_webchat.chave_publica, "email": "Contato@Loja.com.br"},
    ).json()
    with SessaoLocal() as s:
        assert s.query(Contato).count() == 1
        assert dados["contato_id"] == s.query(Contato).one().id


def test_chave_publica_invalida(cliente):
    assert cliente.post("/api/widget/sessao", json={"chave_publica": "wc_nao_existe"}).status_code == 404


def test_sessao_invalida_no_widget(cliente, canal_webchat):
    assert cliente.post(
        "/api/widget/mensagens", headers={"X-Sessao": "ws_falsa"}, json={"conteudo": "oi"}
    ).status_code == 401
    assert cliente.post("/api/widget/mensagens", json={"conteudo": "oi"}).status_code == 401


def test_stream_do_widget_exige_sessao_valida(cliente):
    assert cliente.get("/api/widget/stream", params={"token": "ws_falsa"}).status_code == 401


def test_duas_mensagens_do_visitante_ficam_na_mesma_conversa(cliente, canal_webchat):
    token = abrir_sessao(cliente, canal_webchat)
    cliente.post("/api/widget/mensagens", headers={"X-Sessao": token}, json={"conteudo": "primeira"})
    cliente.post("/api/widget/mensagens", headers={"X-Sessao": token}, json={"conteudo": "segunda"})
    with SessaoLocal() as sessao:
        assert sessao.query(Conversa).count() == 1
        assert sessao.query(Mensagem).count() == 2


# ------------------------------------------------------------------- anexos
PNG = b"\x89PNG\r\n\x1a\n" + b"print do visitante"


def test_visitante_manda_print_e_o_atendente_recebe(cliente, cabecalho_atendente, canal_webchat):
    token = abrir_sessao(cliente, canal_webchat, nome="Padaria do Zé")

    enviada = cliente.post(
        "/api/widget/anexos",
        headers={"X-Sessao": token},
        files={"arquivo": ("erro.png", PNG, "image/png")},
        data={"conteudo": "É essa tela"},
    )
    assert enviada.status_code == 201
    anexo = enviada.json()["anexos"][0]
    assert anexo["imagem"] is True
    assert anexo["url"] == f"/api/widget/anexos/{anexo['id']}"

    # o visitante busca o próprio arquivo com o token da sessão
    baixado = cliente.get(anexo["url"], params={"token": token})
    assert baixado.status_code == 200 and baixado.content == PNG

    # e o atendente vê o mesmo anexo na conversa
    conversa = cliente.get("/api/conversas", headers=cabecalho_atendente).json()[0]
    detalhe = cliente.get(f"/api/conversas/{conversa['id']}", headers=cabecalho_atendente).json()
    do_atendente = detalhe["mensagens"][0]["anexos"][0]
    assert cliente.get(do_atendente["url"], headers=cabecalho_atendente).content == PNG


def test_visitante_nao_alcanca_anexo_de_outro_contato(cliente, canal_webchat):
    primeiro = abrir_sessao(cliente, canal_webchat, nome="Visitante A")
    segundo = abrir_sessao(cliente, canal_webchat, nome="Visitante B")

    anexo = cliente.post(
        "/api/widget/anexos",
        headers={"X-Sessao": primeiro},
        files={"arquivo": ("a.png", PNG, "image/png")},
    ).json()["anexos"][0]

    assert cliente.get(anexo["url"], params={"token": primeiro}).status_code == 200
    assert cliente.get(anexo["url"], params={"token": segundo}).status_code == 404
    assert cliente.get(anexo["url"], params={"token": "ws_falsa"}).status_code == 401


def test_anexo_de_nota_interna_nao_chega_ao_visitante(cliente, cabecalho_atendente, canal_webchat):
    token = abrir_sessao(cliente, canal_webchat)
    cliente.post("/api/widget/mensagens", headers={"X-Sessao": token}, json={"conteudo": "olá"})
    conversa_id = cliente.get("/api/conversas", headers=cabecalho_atendente).json()[0]["id"]

    nota = cliente.post(
        f"/api/conversas/{conversa_id}/notas",
        headers=cabecalho_atendente,
        json={"conteudo": "print do cadastro interno"},
    ).json()
    with SessaoLocal() as sessao:
        from app.servicos.anexos import guardar

        mensagem = sessao.get(Mensagem, nota["id"])
        anexo = guardar(sessao, mensagem, "interno.png", PNG, "image/png")
        sessao.commit()
        anexo_id = anexo.id

    assert cliente.get(f"/api/widget/anexos/{anexo_id}", params={"token": token}).status_code == 404
    # e o histórico do visitante segue sem a nota
    assert len(cliente.get("/api/widget/mensagens", headers={"X-Sessao": token}).json()) == 1


def test_arquivo_vazio_no_widget(cliente, canal_webchat):
    token = abrir_sessao(cliente, canal_webchat)
    resposta = cliente.post(
        "/api/widget/anexos",
        headers={"X-Sessao": token},
        files={"arquivo": ("vazio.txt", b"", "text/plain")},
    )
    assert resposta.status_code == 422

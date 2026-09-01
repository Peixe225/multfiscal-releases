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

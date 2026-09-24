"""Tempo real por consulta: GET /api/eventos/desde e /api/widget/eventos/desde.

Contrato (igual nos dois servidores):
    GET /api/eventos/desde?depois=<id>&limite=<n>   token: Authorization OU ?token=
    -> {"eventos": [{"id": int, "tipo": str, "dados": {...}}], "ultimo": int}
Sem "depois": nenhum evento, só o cursor atual ("começar de agora").
O visitante (widget) só recebe "mensagem.nova" de SAÍDA do próprio contato,
nunca nota interna.
"""
from __future__ import annotations

import pytest

from utilitarios import data_com_fuso, exigir_rota, unico


def _desde(cliente, cabecalho, depois=None, **extra):
    parametros = {**extra}
    if depois is not None:
        parametros["depois"] = depois
    return cliente.get("/api/eventos/desde", params=parametros, headers=cabecalho)


def test_desde_exige_token(cliente):
    resposta = cliente.get("/api/eventos/desde")
    assert resposta.status_code == 401


def test_desde_recusa_token_invalido(cliente):
    resposta = cliente.get("/api/eventos/desde", params={"token": "lixo"})
    assert resposta.status_code == 401
    assert resposta.json() == {"detail": "token invalido ou expirado"}


def test_desde_sem_cursor_devolve_so_o_ultimo(cliente, cabecalho_atendente):
    resposta = _desde(cliente, cabecalho_atendente)
    assert resposta.status_code == 200
    dados = resposta.json()
    assert dados["eventos"] == []
    assert isinstance(dados["ultimo"], int) and dados["ultimo"] >= 0


def test_desde_aceita_token_na_query(cliente, login_atendente):
    resposta = cliente.get("/api/eventos/desde", params={"token": login_atendente["token"], "depois": 0})
    assert resposta.status_code == 200
    assert set(resposta.json()) == {"eventos", "ultimo"}


def test_desde_valida_parametros(cliente, cabecalho_atendente):
    assert _desde(cliente, cabecalho_atendente, depois="abc").status_code == 422
    assert _desde(cliente, cabecalho_atendente, depois=-1).status_code == 422
    assert _desde(cliente, cabecalho_atendente, depois=0, limite=0).status_code == 422


def test_cursor_no_futuro_nao_devolve_nada(cliente, cabecalho_atendente):
    ultimo = _desde(cliente, cabecalho_atendente).json()["ultimo"]
    dados = _desde(cliente, cabecalho_atendente, depois=ultimo + 1000).json()
    assert dados["eventos"] == []
    assert dados["ultimo"] >= ultimo


# --- eventos de verdade: gerados pelo widget --------------------------------
@pytest.fixture
def visitante(cliente, canal_webchat):
    """Sessão de widget aberta num canal de webchat novo."""
    resposta = exigir_rota(
        cliente.post(
            "/api/widget/sessao",
            json={"chave_publica": canal_webchat["chave_publica"], "nome": unico("Visitante ")},
        ),
        "POST /api/widget/sessao",
    )
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


def _mandar_do_widget(cliente, visitante, texto):
    resposta = exigir_rota(
        cliente.post("/api/widget/mensagens", json={"conteudo": texto}, headers={"X-Sessao": visitante["token"]}),
        "POST /api/widget/mensagens",
    )
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


def test_mensagem_do_widget_vira_evento(cliente, cabecalho_atendente, visitante):
    cursor = _desde(cliente, cabecalho_atendente).json()["ultimo"]
    texto = unico("olá do widget ")
    _mandar_do_widget(cliente, visitante, texto)

    dados = _desde(cliente, cabecalho_atendente, depois=cursor).json()
    tipos = [e["tipo"] for e in dados["eventos"]]
    assert "mensagem.nova" in tipos and "conversa.atualizada" in tipos
    ids = [e["id"] for e in dados["eventos"]]
    assert ids == sorted(ids) and all(i > cursor for i in ids)
    assert dados["ultimo"] == ids[-1]

    nova = next(e["dados"] for e in dados["eventos"] if e["tipo"] == "mensagem.nova")
    assert nova["conteudo"] == texto
    assert nova["direcao"] == "entrada"
    assert nova["contato_id"] == visitante["contato_id"]
    data_com_fuso(nova["criada_em"])

    # o cursor devolvido não repete o que já foi entregue
    assert _desde(cliente, cabecalho_atendente, depois=dados["ultimo"]).json()["eventos"] == []


def test_limite_corta_e_o_cursor_continua(cliente, cabecalho_atendente, visitante):
    cursor = _desde(cliente, cabecalho_atendente).json()["ultimo"]
    for i in range(3):
        _mandar_do_widget(cliente, visitante, f"mensagem {i}")
    primeira = _desde(cliente, cabecalho_atendente, depois=cursor, limite=2).json()
    assert len(primeira["eventos"]) == 2
    resto = _desde(cliente, cabecalho_atendente, depois=primeira["ultimo"]).json()
    todos = [e["id"] for e in primeira["eventos"] + resto["eventos"]]
    assert len(todos) == len(set(todos)) >= 6


def test_visitante_so_ve_resposta_para_ele(cliente, cabecalho_atendente, visitante):
    def desde_widget(depois=None):
        parametros = {"token": visitante["token"]}
        if depois is not None:
            parametros["depois"] = depois
        return exigir_rota(
            cliente.get("/api/widget/eventos/desde", params=parametros), "GET /api/widget/eventos/desde"
        )

    inicio = desde_widget()
    assert inicio.status_code == 200
    cursor = inicio.json()["ultimo"]

    cursor_painel = _desde(cliente, cabecalho_atendente).json()["ultimo"]
    _mandar_do_widget(cliente, visitante, "preciso de ajuda")
    eventos_painel = _desde(cliente, cabecalho_atendente, depois=cursor_painel).json()["eventos"]
    conversa_id = next(e["dados"]["conversa_id"] for e in eventos_painel if e["tipo"] == "mensagem.nova")

    resposta = unico("resposta do atendente ")
    exigir_rota(
        cliente.post(f"/api/conversas/{conversa_id}/notas", json={"conteudo": "nota secreta"}, headers=cabecalho_atendente),
        "POST /api/conversas/{id}/notas",
    )
    enviada = exigir_rota(
        cliente.post(f"/api/conversas/{conversa_id}/mensagens", json={"conteudo": resposta}, headers=cabecalho_atendente),
        "POST /api/conversas/{id}/mensagens",
    )
    assert enviada.status_code == 201, enviada.text

    dados = desde_widget(cursor).json()
    assert [e["tipo"] for e in dados["eventos"]] == ["mensagem.nova"]
    visto = dados["eventos"][0]["dados"]
    assert visto["conteudo"] == resposta
    assert "nota secreta" not in str(dados)
    assert dados["ultimo"] >= dados["eventos"][0]["id"]


def test_widget_desde_exige_sessao(cliente):
    resposta = exigir_rota(
        cliente.get("/api/widget/eventos/desde", params={"token": "sessao-inexistente"}),
        "GET /api/widget/eventos/desde",
    )
    assert resposta.status_code == 401

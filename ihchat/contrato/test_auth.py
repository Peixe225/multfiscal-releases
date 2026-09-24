"""Login, /eu e proteção das rotas (app/api/auth.py, app/dependencias.py)."""
from __future__ import annotations

import time

import pytest

from utilitarios import (
    ADMIN_EMAIL,
    ADMIN_SENHA,
    ATENDENTE_EMAIL,
    ATENDENTE_SENHA,
    CAMPOS_ATENDENTE,
    exigir_rota,
    token_forjado,
)


def test_login_devolve_token_e_perfil(cliente):
    resposta = cliente.post("/api/auth/login", json={"email": ADMIN_EMAIL, "senha": ADMIN_SENHA})
    assert resposta.status_code == 200
    dados = resposta.json()
    assert isinstance(dados["token"], str) and dados["token"].count(".") == 1
    assert set(dados["atendente"]) >= CAMPOS_ATENDENTE
    assert dados["atendente"]["email"] == ADMIN_EMAIL
    assert dados["atendente"]["papel"] == "admin"
    assert dados["atendente"]["ativo"] is True
    assert "senha_hash" not in dados["atendente"] and "senha" not in resposta.text


def test_login_ignora_maiusculas_no_email(cliente):
    resposta = cliente.post("/api/auth/login", json={"email": ATENDENTE_EMAIL.upper(), "senha": ATENDENTE_SENHA})
    assert resposta.status_code == 200
    assert resposta.json()["atendente"]["papel"] == "atendente"


@pytest.mark.parametrize(
    "email,senha",
    [(ADMIN_EMAIL, "senha-errada"), ("ninguem@nao-existe.example", "qualquer")],
    ids=["senha-errada", "usuario-inexistente"],
)
def test_login_recusado_com_a_mesma_resposta(cliente, email, senha):
    resposta = cliente.post("/api/auth/login", json={"email": email, "senha": senha})
    assert resposta.status_code == 401
    # mesma frase para os dois casos: não revela quem tem conta
    assert resposta.json() == {"detail": "e-mail ou senha invalidos"}


def test_login_sem_campo_e_422_com_lista(cliente):
    resposta = cliente.post("/api/auth/login", json={"email": ADMIN_EMAIL})
    assert resposta.status_code == 422
    problemas = resposta.json()["detail"]
    assert isinstance(problemas, list) and problemas
    assert problemas[0]["loc"] == ["body", "senha"]
    assert isinstance(problemas[0]["msg"], str) and problemas[0]["msg"]


def test_login_com_json_quebrado_e_422(cliente):
    resposta = cliente.post(
        "/api/auth/login", content=b'{"email": ', headers={"Content-Type": "application/json"}
    )
    assert resposta.status_code == 422
    assert isinstance(resposta.json()["detail"], list)


def test_eu_devolve_o_atendente_do_token(cliente, login_atendente, cabecalho_atendente):
    resposta = cliente.get("/api/auth/eu", headers=cabecalho_atendente)
    assert resposta.status_code == 200
    assert resposta.json() == login_atendente["atendente"]
    assert set(resposta.json()) >= CAMPOS_ATENDENTE


def test_eu_sem_token(cliente):
    resposta = cliente.get("/api/auth/eu")
    assert resposta.status_code == 401
    assert resposta.json() == {"detail": "informe o token de acesso"}


def test_esquema_de_autorizacao_errado_conta_como_sem_token(cliente, login_admin):
    resposta = cliente.get("/api/auth/eu", headers={"Authorization": f"Token {login_admin['token']}"})
    assert resposta.status_code == 401
    assert resposta.json() == {"detail": "informe o token de acesso"}


@pytest.mark.parametrize("token", ["lixo", "a.b", "a.b.c", "eyJzdWIiOiAxfQ.assinatura-falsa"])
def test_token_invalido_e_recusado(cliente, token):
    resposta = cliente.get("/api/auth/eu", headers={"Authorization": f"Bearer {token}"})
    assert resposta.status_code == 401
    assert resposta.json() == {"detail": "token invalido ou expirado"}


@pytest.mark.parametrize(
    "rota", ["/api/auth/eu", "/api/conversas", "/api/canais", "/api/atendentes", "/api/metricas/resumo"]
)
def test_rota_protegida_exige_token(cliente, rota):
    resposta = exigir_rota(cliente.get(rota), f"GET {rota}")
    assert resposta.status_code == 401


# --- formato do token: o mesmo nos dois servidores --------------------------
@pytest.fixture
def chave(servidor):
    if servidor.chave_secreta is None:
        pytest.skip("servidor externo: chave secreta desconhecida")
    return servidor.chave_secreta


def test_token_assinado_fora_do_servidor_vale(cliente, chave, login_admin):
    """Assinado aqui, no formato de app/security.py: vale no Python E no PHP."""
    token = token_forjado(chave, login_admin["atendente"]["id"])
    resposta = cliente.get("/api/auth/eu", headers={"Authorization": f"Bearer {token}"})
    assert resposta.status_code == 200
    assert resposta.json()["email"] == ADMIN_EMAIL


def test_token_vencido_e_recusado(cliente, chave, login_admin):
    token = token_forjado(chave, login_admin["atendente"]["id"], expira_em=time.time() - 5)
    resposta = cliente.get("/api/auth/eu", headers={"Authorization": f"Bearer {token}"})
    assert resposta.status_code == 401
    assert resposta.json() == {"detail": "token invalido ou expirado"}


def test_token_com_outra_chave_e_recusado(cliente, chave, login_admin):
    token = token_forjado(chave + "-outra", login_admin["atendente"]["id"])
    assert cliente.get("/api/auth/eu", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_token_de_atendente_inexistente(cliente, chave):
    token = token_forjado(chave, 987654)
    resposta = cliente.get("/api/auth/eu", headers={"Authorization": f"Bearer {token}"})
    assert resposta.status_code == 401
    assert resposta.json() == {"detail": "atendente sem acesso"}

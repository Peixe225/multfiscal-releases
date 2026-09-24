"""Atendentes, etiquetas e respostas rápidas (app/api/atendentes.py e app/api/catalogo.py).

A base é compartilhada pela sessão: nomes e e-mails únicos, e todo atendente
criado aqui é tirado da distribuição (disponivel=false) para não roubar
conversas de outros testes.
"""
from __future__ import annotations

import pytest

from utilitarios import CAMPOS_ATENDENTE, unico


@pytest.fixture
def campos_atendente() -> set[str]:
    """AtendenteSaida (os dois alvos têm o setor)."""
    return CAMPOS_ATENDENTE


@pytest.fixture
def com_setor(login_atendente):
    assert "setor" in login_atendente["atendente"], login_atendente["atendente"]


def _criar_atendente(cliente, cabecalho_admin, **extra) -> dict:
    corpo = {"nome": unico("Atendente "), "email": f"{unico('a')}@Empresa.COM.br", "senha": "segredo1", **extra}
    resposta = cliente.post("/api/atendentes", json=corpo, headers=cabecalho_admin)
    assert resposta.status_code == 201, resposta.text
    criado = resposta.json()
    fora = cliente.patch(f"/api/atendentes/{criado['id']}", json={"disponivel": False}, headers=cabecalho_admin)
    assert fora.status_code == 200
    return criado


# ------------------------------------------------------------- atendentes
def test_listar_atendentes_em_ordem_de_nome(cliente, cabecalho_atendente, campos_atendente):
    resposta = cliente.get("/api/atendentes", headers=cabecalho_atendente)
    assert resposta.status_code == 200
    lista = resposta.json()
    assert all(set(a) >= campos_atendente for a in lista)
    assert "senha_hash" not in resposta.text
    nomes = [a["nome"] for a in lista]
    assert nomes == sorted(nomes)
    assert {"Administrador", "Ana Suporte"} <= set(nomes)


def test_admin_cria_atendente(cliente, cabecalho_admin, campos_atendente):
    criado = _criar_atendente(cliente, cabecalho_admin)
    assert set(criado) >= campos_atendente
    assert criado["email"] == criado["email"].lower()
    assert criado["papel"] == "atendente" and criado["ativo"] is True
    # o novo atendente entra com a senha dada
    login = cliente.post("/api/auth/login", json={"email": criado["email"], "senha": "segredo1"})
    assert login.status_code == 200


def test_email_repetido_e_recusado(cliente, cabecalho_admin):
    criado = _criar_atendente(cliente, cabecalho_admin)
    resposta = cliente.post(
        "/api/atendentes",
        json={"nome": "Outro", "email": criado["email"].upper(), "senha": "segredo1"},
        headers=cabecalho_admin,
    )
    assert resposta.status_code == 409
    assert resposta.json() == {"detail": "ja existe um atendente com esse e-mail"}


@pytest.mark.parametrize(
    "senha",
    [
        "a" * 73,  # o bcrypt cortaria em 72 bytes, em silêncio
        "é" * 37,  # 37 caracteres, 74 bytes: o limite é de bytes
        "segredo\ncom quebra",
        "segredo\x00nulo",
    ],
)
def test_senha_que_o_bcrypt_nao_guarda_inteira_e_recusada(cliente, cabecalho_admin, senha):
    corpo = {"nome": unico("Atendente "), "email": f"{unico('s')}@empresa.com.br", "senha": senha}
    resposta = cliente.post("/api/atendentes", json=corpo, headers=cabecalho_admin)
    assert resposta.status_code == 422, resposta.text
    [erro] = resposta.json()["detail"]
    assert erro["loc"] == ["body", "senha"]
    # a senha digitada nunca volta na resposta (nem no "input")
    assert "input" not in erro and senha not in resposta.text


def test_senha_de_72_bytes_com_acento_entra(cliente, cabecalho_admin):
    senha = "é" * 36
    criado = _criar_atendente(cliente, cabecalho_admin, senha=senha)
    assert cliente.post("/api/auth/login", json={"email": criado["email"], "senha": senha}).status_code == 200
    # a troca pelo PATCH segue a mesma regra
    resposta = cliente.patch(f"/api/atendentes/{criado['id']}", json={"senha": "b" * 73}, headers=cabecalho_admin)
    assert resposta.status_code == 422 and resposta.json()["detail"][0]["loc"] == ["body", "senha"]


def test_erro_de_validacao_nao_devolve_a_senha(cliente, cabecalho_admin):
    """Faltando outro campo, o 422 não carrega o corpo inteiro com a senha."""
    senha = unico("SenhaSecreta-")
    resposta = cliente.post(
        "/api/atendentes", json={"email": f"{unico('s')}@empresa.com.br", "senha": senha}, headers=cabecalho_admin
    )
    assert resposta.status_code == 422
    assert ["body", "nome"] in [e["loc"] for e in resposta.json()["detail"]]
    assert senha not in resposta.text


def test_criar_atendente_valida_e_exige_admin(cliente, cabecalho_admin, cabecalho_atendente):
    corpo = {"nome": "Z", "email": "nao-e-email", "senha": "123"}
    resposta = cliente.post("/api/atendentes", json=corpo, headers=cabecalho_admin)
    assert resposta.status_code == 422
    campos = {tuple(p["loc"]) for p in resposta.json()["detail"]}
    assert {("body", "nome"), ("body", "email"), ("body", "senha")} <= campos

    comum = cliente.post(
        "/api/atendentes", json={"nome": "Zé", "email": f"{unico('z')}@empresa.com.br", "senha": "123456"},
        headers=cabecalho_atendente,
    )
    assert comum.status_code == 403
    assert comum.json() == {"detail": "acao restrita a administradores"}


def test_atendente_cuida_do_proprio_perfil(cliente, cabecalho_atendente, login_atendente, cabecalho_admin):
    eu = login_atendente["atendente"]
    resposta = cliente.patch(f"/api/atendentes/{eu['id']}", json={"disponivel": False}, headers=cabecalho_atendente)
    try:
        assert resposta.status_code == 200
        assert resposta.json()["disponivel"] is False
    finally:
        volta = cliente.patch(f"/api/atendentes/{eu['id']}", json={"disponivel": True}, headers=cabecalho_atendente)
        assert volta.json()["disponivel"] is True

    papel = cliente.patch(f"/api/atendentes/{eu['id']}", json={"papel": "admin"}, headers=cabecalho_atendente)
    assert papel.status_code == 403
    assert papel.json() == {"detail": "somente admin altera papel ou acesso"}

    outro = _criar_atendente(cliente, cabecalho_admin)
    alheio = cliente.patch(f"/api/atendentes/{outro['id']}", json={"nome": "Mexido"}, headers=cabecalho_atendente)
    assert alheio.status_code == 403
    assert alheio.json() == {"detail": "acao restrita a administradores"}


def test_admin_desativa_e_atendente_perde_acesso(cliente, cabecalho_admin):
    criado = _criar_atendente(cliente, cabecalho_admin)
    token = cliente.post("/api/auth/login", json={"email": criado["email"], "senha": "segredo1"}).json()["token"]
    desativado = cliente.patch(f"/api/atendentes/{criado['id']}", json={"ativo": False}, headers=cabecalho_admin)
    assert desativado.status_code == 200 and desativado.json()["ativo"] is False
    assert cliente.get("/api/auth/eu", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_patch_de_atendente_inexistente(cliente, cabecalho_admin):
    resposta = cliente.patch("/api/atendentes/999999", json={"nome": "Ninguém"}, headers=cabecalho_admin)
    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "atendente nao encontrado"}


def test_setor_do_atendente(cliente, cabecalho_admin, com_setor):
    criado = _criar_atendente(cliente, cabecalho_admin, setor="  Financeiro  ")
    assert criado["setor"] == "Financeiro"
    mudado = cliente.patch(f"/api/atendentes/{criado['id']}", json={"setor": "Comercial"}, headers=cabecalho_admin)
    assert mudado.json()["setor"] == "Comercial"
    limpo = cliente.patch(f"/api/atendentes/{criado['id']}", json={"setor": ""}, headers=cabecalho_admin)
    assert limpo.json()["setor"] is None
    longo = cliente.patch(f"/api/atendentes/{criado['id']}", json={"setor": "x" * 61}, headers=cabecalho_admin)
    assert longo.status_code == 422


def test_atendente_muda_o_proprio_setor(cliente, cabecalho_atendente, login_atendente, com_setor):
    eu = login_atendente["atendente"]
    antes = eu["setor"]
    try:
        resposta = cliente.patch(f"/api/atendentes/{eu['id']}", json={"setor": "Implantação"}, headers=cabecalho_atendente)
        assert resposta.status_code == 200 and resposta.json()["setor"] == "Implantação"
    finally:
        cliente.patch(f"/api/atendentes/{eu['id']}", json={"setor": antes}, headers=cabecalho_atendente)


# --------------------------------------------------------------- etiquetas
def test_etiquetas_crud(cliente, cabecalho_atendente):
    nome = unico("fiscal-")
    criada = cliente.post("/api/etiquetas", json={"nome": nome}, headers=cabecalho_atendente)
    assert criada.status_code == 201
    etiqueta = criada.json()
    assert etiqueta == {"id": etiqueta["id"], "nome": nome, "cor": "#6b7cff"}

    repetida = cliente.post("/api/etiquetas", json={"nome": nome.upper()}, headers=cabecalho_atendente)
    assert repetida.status_code == 409
    assert repetida.json() == {"detail": "ja existe uma etiqueta com esse nome"}

    lista = cliente.get("/api/etiquetas", headers=cabecalho_atendente).json()
    assert etiqueta in lista
    assert [e["nome"] for e in lista] == sorted(e["nome"] for e in lista)

    assert cliente.delete(f"/api/etiquetas/{etiqueta['id']}", headers=cabecalho_atendente).status_code == 204
    sumiu = cliente.delete(f"/api/etiquetas/{etiqueta['id']}", headers=cabecalho_atendente)
    assert sumiu.status_code == 404
    assert sumiu.json() == {"detail": "etiqueta nao encontrada"}


def test_etiqueta_valida_campos(cliente, cabecalho_atendente):
    assert cliente.post("/api/etiquetas", json={"nome": ""}, headers=cabecalho_atendente).status_code == 422
    assert cliente.post("/api/etiquetas", json={"nome": "x" * 61}, headers=cabecalho_atendente).status_code == 422
    assert cliente.post("/api/etiquetas", json={"nome": unico("c"), "cor": "#1234567890"}, headers=cabecalho_atendente).status_code == 422
    assert cliente.get("/api/etiquetas").status_code == 401


# -------------------------------------------------------- respostas rápidas
def test_respostas_rapidas_crud(cliente, cabecalho_atendente):
    atalho = unico("ola")
    criada = cliente.post(
        "/api/respostas-rapidas",
        json={"atalho": f" /{atalho} ", "titulo": "Saudação", "conteudo": "Olá! Como posso ajudar?"},
        headers=cabecalho_atendente,
    )
    assert criada.status_code == 201
    resposta = criada.json()
    # a barra que o painel usa para chamar o atalho não é guardada
    assert resposta == {"id": resposta["id"], "atalho": atalho, "titulo": "Saudação", "conteudo": "Olá! Como posso ajudar?"}

    repetida = cliente.post(
        "/api/respostas-rapidas", json={"atalho": atalho, "titulo": "x", "conteudo": "y"}, headers=cabecalho_atendente
    )
    assert repetida.status_code == 409
    assert repetida.json() == {"detail": "ja existe uma resposta com esse atalho"}

    lista = cliente.get("/api/respostas-rapidas", headers=cabecalho_atendente).json()
    assert resposta in lista
    assert [r["atalho"] for r in lista] == sorted(r["atalho"] for r in lista)

    assert cliente.delete(f"/api/respostas-rapidas/{resposta['id']}", headers=cabecalho_atendente).status_code == 204
    sumiu = cliente.delete(f"/api/respostas-rapidas/{resposta['id']}", headers=cabecalho_atendente)
    assert sumiu.status_code == 404
    assert sumiu.json() == {"detail": "resposta nao encontrada"}


def test_resposta_rapida_valida_campos(cliente, cabecalho_atendente):
    faltando = cliente.post("/api/respostas-rapidas", json={"atalho": "x"}, headers=cabecalho_atendente)
    assert faltando.status_code == 422
    campos = {tuple(p["loc"]) for p in faltando.json()["detail"]}
    assert {("body", "titulo"), ("body", "conteudo")} <= campos
    grande = cliente.post(
        "/api/respostas-rapidas", json={"atalho": unico("g"), "titulo": "t", "conteudo": "x" * 4001}, headers=cabecalho_atendente
    )
    assert grande.status_code == 422


@pytest.mark.parametrize("atalho", ["", "   ", "/", " / "])
def test_atalho_vazio_e_recusado(cliente, cabecalho_atendente, atalho):
    """Sem nada além da barra, o atalho não chamaria nada no painel."""
    resposta = cliente.post(
        "/api/respostas-rapidas", json={"atalho": atalho, "titulo": "t", "conteudo": "c"}, headers=cabecalho_atendente
    )
    assert resposta.status_code == 422, resposta.text

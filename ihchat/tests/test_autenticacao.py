from app.models import Papel


def test_login_devolve_token_e_perfil(cliente, admin):
    resposta = cliente.post("/api/auth/login", json={"email": "admin@teste.com.br", "senha": "admin123"})
    assert resposta.status_code == 200
    dados = resposta.json()
    assert dados["atendente"]["papel"] == Papel.ADMIN.value
    assert dados["token"]


def test_login_recusa_senha_errada(cliente, admin):
    resposta = cliente.post("/api/auth/login", json={"email": "admin@teste.com.br", "senha": "errada"})
    assert resposta.status_code == 401


def test_rota_protegida_exige_token(cliente):
    assert cliente.get("/api/conversas").status_code == 401


def test_token_invalido_e_recusado(cliente):
    resposta = cliente.get("/api/conversas", headers={"Authorization": "Bearer lixo"})
    assert resposta.status_code == 401


def test_somente_admin_cria_atendente(cliente, cabecalho_atendente):
    resposta = cliente.post(
        "/api/atendentes",
        headers=cabecalho_atendente,
        json={"nome": "Novo", "email": "novo@teste.com.br", "senha": "senha123"},
    )
    assert resposta.status_code == 403


def test_admin_cria_atendente(cliente, cabecalho_admin):
    resposta = cliente.post(
        "/api/atendentes",
        headers=cabecalho_admin,
        json={"nome": "Novo", "email": "Novo@Teste.com.br", "senha": "senha123"},
    )
    assert resposta.status_code == 201
    assert resposta.json()["email"] == "novo@teste.com.br"
    # e-mail duplicado nao passa
    assert cliente.post(
        "/api/atendentes",
        headers=cabecalho_admin,
        json={"nome": "Outro", "email": "novo@teste.com.br", "senha": "senha123"},
    ).status_code == 409


def test_atendente_nao_muda_papel_de_ninguem(cliente, cabecalho_atendente, atendente):
    resposta = cliente.patch(
        f"/api/atendentes/{atendente.id}", headers=cabecalho_atendente, json={"papel": "admin"}
    )
    assert resposta.status_code == 403


def test_atendente_edita_o_proprio_nome(cliente, cabecalho_atendente, atendente):
    resposta = cliente.patch(
        f"/api/atendentes/{atendente.id}", headers=cabecalho_atendente, json={"nome": "Ana Paula"}
    )
    assert resposta.status_code == 200
    assert resposta.json()["nome"] == "Ana Paula"


# ------------------------------------------------ base migrada da hospedagem PHP
# gerados pelo password_hash do PHP 8.4 (bcrypt "$2y$", custo 12)
HASH_PHP_ANA = "$2y$12$I/.wLv3n/mrJFuMhZMbi3.hGcp2BP0pkliAJZVjZ6G1AEK5rwv0k2"  # ana12345
HASH_PHP_LONGA = "$2y$12$Q/uu/fJRzwhvEBO9KPznVuNpYe50obgnInm0Yb0fWTQZoHMRB.PnO"  # "é" * 40 + "fim"


def test_senha_com_hash_do_php_confere():
    from app.security import conferir_senha

    assert conferir_senha("ana12345", HASH_PHP_ANA) is True
    assert conferir_senha("ana12346", HASH_PHP_ANA) is False
    # o bcrypt do PHP só olha os 72 primeiros bytes: o mesmo vale aqui, sem erro
    assert conferir_senha("é" * 40 + "fim", HASH_PHP_LONGA) is True
    assert conferir_senha("é" * 36, HASH_PHP_LONGA) is True
    assert conferir_senha("é" * 35, HASH_PHP_LONGA) is False
    assert conferir_senha("ana12345", "$2y$12$corrompido") is False


def test_login_com_hash_migrado_do_php(cliente, admin):
    from app.db import SessaoLocal
    from app.models import Atendente

    with SessaoLocal() as sessao:
        sessao.get(Atendente, admin.id).senha_hash = HASH_PHP_ANA
        sessao.commit()
    resposta = cliente.post("/api/auth/login", json={"email": admin.email, "senha": "ana12345"})
    assert resposta.status_code == 200, resposta.text

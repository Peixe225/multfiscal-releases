"""Cargos, permissões e setores: catálogo, cargos, hierarquia e setores.

Contrato (igual nos dois servidores):
    GET  /api/permissoes                    [{chave, rotulo, grupo}] (catálogo fixo)
    GET/POST /api/cargos, PATCH/DELETE /api/cargos/{id}
        CargoSaida {id, nome, nivel, permissoes, sistema, total_pessoas}
    GET/POST /api/setores, PATCH/DELETE /api/setores/{id}
        SetorSaida {id, nome, descricao, ativo, total_pessoas}
    AtendenteSaida ganha setor_id, cargo {id, nome, nivel} e permissoes
    (lista efetiva); papel = "admin" só para o cargo Administrador.

Regras de hierarquia: ninguém gerencia quem tem nível igual ou maior nem
concede cargo de nível igual ou maior (o Administrador pode tudo); quem não
define setor só gerencia gente do próprio setor; ninguém cria/edita cargo
com permissão que não tem; sempre sobra um Administrador ativo; no próprio
perfil, só senha e disponibilidade.
"""
from __future__ import annotations

import pytest

from apoio_equipe import (
    CARGO_ACIMA,
    CARGO_ADMIN_TRAVADO,
    CARGO_DE_FABRICA,
    CONCEDER_ABAIXO,
    PROPRIO_PERFIL,
    SENHA,
    SO_ABAIXO,
    SO_SEU_SETOR,
    ULTIMO_ADMIN,
    cargo_id,
    cargos,
    nova_pessoa,
    novo_cargo,
    novo_setor,
    sem_permissao,
)
from utilitarios import ADMIN_EMAIL, ATENDENTE_EMAIL, criar_canal, entrar, exigir_rota, unico

PERMISSOES_MINIMAS = {
    "equipe.ver", "equipe.gerenciar", "equipe.definir_cargo", "equipe.definir_setor", "cargos.gerenciar",
    "setores.gerenciar", "canais.ver", "canais.gerenciar", "conversas.ver_todas", "conversas.ver_setor",
    "conversas.transferir", "conversas.resolver", "conversas.reabrir", "contatos.editar", "contatos.mesclar",
    "respostas.gerenciar", "etiquetas.gerenciar", "metricas.ver_todas", "metricas.ver_setor",
    "chat.criar_grupo", "chat.moderar", "simulador.usar",
}
FABRICA = {"Administrador": 100, "Gerente": 80, "Líder": 60, "Conferente": 40, "Colaborador": 20}
GERENCIAR_EQUIPE = sem_permissao("gerenciar pessoas de cargo abaixo do seu (cadastrar, editar, desativar)")


@pytest.fixture(autouse=True)
def _tem_cargos(cliente, cabecalho_admin):
    exigir_rota(cliente.get("/api/cargos", headers=cabecalho_admin), "GET /api/cargos")


# ------------------------------------------------------------ catálogo e eu
def test_catalogo_de_permissoes(cliente, cabecalho_atendente):
    resposta = cliente.get("/api/permissoes", headers=cabecalho_atendente)
    assert resposta.status_code == 200
    catalogo = resposta.json()
    assert all(set(p) == {"chave", "rotulo", "grupo"} for p in catalogo)
    assert PERMISSOES_MINIMAS <= {p["chave"] for p in catalogo}
    assert len({p["chave"] for p in catalogo}) == len(catalogo)
    assert all(p["rotulo"] and p["grupo"] for p in catalogo)
    assert cliente.get("/api/permissoes").status_code == 401


def test_cargos_de_fabrica_decrescentes(cliente, cabecalho_admin):
    todos = cargos(cliente, cabecalho_admin)
    catalogo = {p["chave"] for p in cliente.get("/api/permissoes", headers=cabecalho_admin).json()}
    for nome, nivel in FABRICA.items():
        assert todos[nome]["nivel"] == nivel and todos[nome]["sistema"] is True
        assert set(todos[nome]) == {"id", "nome", "nivel", "permissoes", "sistema", "total_pessoas"}
    assert set(todos["Administrador"]["permissoes"]) == catalogo
    ordem = list(FABRICA)
    for maior, menor in zip(ordem, ordem[1:]):
        assert set(todos[menor]["permissoes"]) < set(todos[maior]["permissoes"]), (menor, maior)
    # Conferente revisa o setor (vê, reabre), mas não gerencia equipe nem transfere
    conferente = set(todos["Conferente"]["permissoes"])
    assert {"conversas.ver_setor", "conversas.reabrir"} <= conferente
    assert not {"equipe.gerenciar", "conversas.transferir", "conversas.ver_todas"} & conferente
    colaborador = set(todos["Colaborador"]["permissoes"])
    assert not {"conversas.ver_setor", "conversas.ver_todas", "equipe.gerenciar", "canais.gerenciar"} & colaborador
    assert "canais.gerenciar" not in todos["Gerente"]["permissoes"]


def test_eu_traz_cargo_setor_e_permissoes(cliente, cabecalho_admin):
    admin = cliente.get("/api/auth/eu", headers=cabecalho_admin).json()
    assert admin["papel"] == "admin"
    assert admin["cargo"] == {"id": cargo_id(cliente, cabecalho_admin, "Administrador"), "nome": "Administrador", "nivel": 100}
    catalogo = [p["chave"] for p in cliente.get("/api/permissoes", headers=cabecalho_admin).json()]
    assert admin["permissoes"] == catalogo

    setor = novo_setor(cliente, cabecalho_admin)
    pessoa = nova_pessoa(cliente, cabecalho_admin, "Colaborador", setor)
    eu = pessoa.eu()
    assert eu["papel"] == "atendente"
    assert eu["cargo"]["nome"] == "Colaborador" and eu["cargo"]["nivel"] == 20
    assert eu["setor_id"] == setor["id"] and eu["setor"] == setor["nome"]
    assert eu["permissoes"] == cargos(cliente, cabecalho_admin)["Colaborador"]["permissoes"]
    login = cliente.post("/api/auth/login", json={"email": eu["email"], "senha": SENHA}).json()
    assert login["atendente"] == eu


def test_base_antiga_vira_cargos_e_setores(cliente, cabecalho_admin, login_admin):
    """A migração no contrato HTTP: o admin do seed é Administrador; o texto
    de setor da Ana ("Suporte técnico") é um setor do cadastro; e o papel
    antigo ainda funciona na entrada (admin -> Administrador, atendente ->
    Colaborador; "atendente" num cargo que não é admin mantém o cargo)."""
    assert login_admin["atendente"]["cargo"]["nome"] == "Administrador"
    equipe = {p["email"]: p for p in cliente.get("/api/atendentes", headers=cabecalho_admin).json()}
    ana = equipe[ATENDENTE_EMAIL]
    setores = {s["id"]: s for s in cliente.get("/api/setores", headers=cabecalho_admin).json()}
    assert ana["setor_id"] in setores and setores[ana["setor_id"]]["nome"] == ana["setor"] == "Suporte técnico"
    assert equipe[ADMIN_EMAIL]["papel"] == "admin"

    def criar(**extra):
        corpo = {"nome": unico("Legado "), "email": f"{unico('legado')}@exemplo.com.br", "senha": SENHA,
                 "disponivel": False, **extra}
        resposta = cliente.post("/api/atendentes", json=corpo, headers=cabecalho_admin)
        assert resposta.status_code == 201, resposta.text
        return resposta.json()

    admin = criar(papel="admin")
    assert admin["cargo"]["nome"] == "Administrador" and admin["papel"] == "admin"
    comum = criar(papel="atendente", setor="  " + unico("Setor Legado ") + " ")
    assert comum["cargo"]["nome"] == "Colaborador" and comum["papel"] == "atendente"
    assert comum["setor_id"] is not None and comum["setor"] == comum["setor"].strip()
    assert comum["setor_id"] in {s["id"] for s in cliente.get("/api/setores", headers=cabecalho_admin).json()}
    rebaixado = cliente.patch(f"/api/atendentes/{admin['id']}", json={"papel": "atendente"}, headers=cabecalho_admin)
    assert rebaixado.json()["cargo"]["nome"] == "Colaborador" and rebaixado.json()["papel"] == "atendente"
    gerente = criar(cargo_id=cargo_id(cliente, cabecalho_admin, "Gerente"))
    mantido = cliente.patch(f"/api/atendentes/{gerente['id']}", json={"papel": "atendente"}, headers=cabecalho_admin)
    assert mantido.json()["cargo"]["nome"] == "Gerente"


# -------------------------------------------------------------------- cargos
def test_admin_cria_edita_e_apaga_cargo(cliente, cabecalho_admin):
    nome = unico("Supervisor ")
    criado = cliente.post(
        "/api/cargos",
        json={"nome": nome, "nivel": 50, "permissoes": ["conversas.ver_setor", "equipe.ver", "equipe.ver"]},
        headers=cabecalho_admin,
    )
    assert criado.status_code == 201, criado.text
    cargo = criado.json()
    assert cargo["nome"] == nome and cargo["nivel"] == 50 and cargo["sistema"] is False
    assert cargo["permissoes"] == ["equipe.ver", "conversas.ver_setor"]  # sem repetir, na ordem do catálogo
    assert cargo["total_pessoas"] == 0

    repetido = cliente.post("/api/cargos", json={"nome": f"  {nome.upper()} ", "nivel": 10, "permissoes": []}, headers=cabecalho_admin)
    assert repetido.status_code == 409
    assert cliente.post("/api/cargos", json={"nome": unico("X "), "nivel": 100, "permissoes": []}, headers=cabecalho_admin).status_code == 422
    assert cliente.post("/api/cargos", json={"nome": unico("X "), "nivel": 0, "permissoes": []}, headers=cabecalho_admin).status_code == 422
    desconhecida = cliente.post("/api/cargos", json={"nome": unico("X "), "nivel": 10, "permissoes": ["voar"]}, headers=cabecalho_admin)
    assert desconhecida.status_code == 422

    editado = cliente.patch(f"/api/cargos/{cargo['id']}", json={"nivel": 45, "permissoes": ["conversas.reabrir"]}, headers=cabecalho_admin)
    assert editado.status_code == 200
    assert editado.json()["nivel"] == 45 and editado.json()["permissoes"] == ["conversas.reabrir"]

    pessoa = nova_pessoa(cliente, cabecalho_admin, cargo["id"])
    assert pessoa.eu()["permissoes"] == ["conversas.reabrir"]
    em_uso = cliente.delete(f"/api/cargos/{cargo['id']}", headers=cabecalho_admin)
    assert em_uso.status_code == 409
    mudou = cliente.patch(f"/api/atendentes/{pessoa.id}", json={"cargo_id": cargo_id(cliente, cabecalho_admin, "Colaborador")}, headers=cabecalho_admin)
    assert mudou.status_code == 200
    assert cliente.delete(f"/api/cargos/{cargo['id']}", headers=cabecalho_admin).status_code == 204
    assert cliente.patch(f"/api/cargos/{cargo['id']}", json={"nivel": 10}, headers=cabecalho_admin).status_code == 404


def test_cargo_administrador_e_de_fabrica_travados(cliente, cabecalho_admin):
    todos = cargos(cliente, cabecalho_admin)
    admin = todos["Administrador"]
    for corpo in ({"nivel": 90}, {"permissoes": []}, {"nome": "Chefão"}):
        resposta = cliente.patch(f"/api/cargos/{admin['id']}", json=corpo, headers=cabecalho_admin)
        assert resposta.status_code == 403 and resposta.json() == {"detail": CARGO_ADMIN_TRAVADO}
    assert cliente.delete(f"/api/cargos/{admin['id']}", headers=cabecalho_admin).status_code == 403
    apagar = cliente.delete(f"/api/cargos/{todos['Conferente']['id']}", headers=cabecalho_admin)
    assert apagar.status_code == 403 and apagar.json() == {"detail": CARGO_DE_FABRICA}


def test_quem_gerencia_cargos_nao_passa_do_proprio_nivel(cliente, cabecalho_admin):
    rh = novo_cargo(cliente, cabecalho_admin, 70, ["equipe.ver", "cargos.gerenciar", "conversas.ver_setor"], "RH ")
    pessoa = nova_pessoa(cliente, cabecalho_admin, rh["id"])

    acima = pessoa.post("/api/cargos", {"nome": unico("Alto "), "nivel": 70, "permissoes": []})
    assert acima.status_code == 403 and acima.json() == {"detail": CARGO_ACIMA}
    sem_ter = pessoa.post("/api/cargos", {"nome": unico("Poder "), "nivel": 10, "permissoes": ["canais.gerenciar"]})
    assert sem_ter.status_code == 403
    assert sem_ter.json()["detail"].startswith("você não pode dar a um cargo permissões que você não tem")
    criado = pessoa.post("/api/cargos", {"nome": unico("Auxiliar "), "nivel": 30, "permissoes": ["conversas.ver_setor"]})
    assert criado.status_code == 201, criado.text
    auxiliar = criado.json()

    # o cargo dele mesmo e os de cima não são dele para mexer
    assert pessoa.patch(f"/api/cargos/{rh['id']}", {"nivel": 75}).json() == {"detail": CARGO_ACIMA}
    gerente = cargos(cliente, cabecalho_admin)["Gerente"]
    assert pessoa.patch(f"/api/cargos/{gerente['id']}", {"permissoes": []}).status_code == 403
    assert pessoa.patch(f"/api/cargos/{auxiliar['id']}", {"nivel": 70}).json() == {"detail": CARGO_ACIMA}
    assert pessoa.patch(f"/api/cargos/{auxiliar['id']}", {"permissoes": ["chat.moderar"]}).status_code == 403
    renomeado = pessoa.patch(f"/api/cargos/{auxiliar['id']}", {"nome": unico("Assistente "), "permissoes": []})
    assert renomeado.status_code == 200 and renomeado.json()["permissoes"] == []
    assert pessoa.delete(f"/api/cargos/{auxiliar['id']}").status_code == 204

    comum = nova_pessoa(cliente, cabecalho_admin, "Colaborador")
    negado = comum.post("/api/cargos", {"nome": unico("X "), "nivel": 1, "permissoes": []})
    assert negado.status_code == 403 and negado.json() == sem_permissao("criar e editar cargos e permissões")


# ----------------------------------------------------------------- hierarquia
def test_gerente_gerencia_so_abaixo(cliente, cabecalho_admin):
    gerente = nova_pessoa(cliente, cabecalho_admin, "Gerente")
    ids = {nome: cargo_id(cliente, cabecalho_admin, nome) for nome in FABRICA}

    def cadastrar(quem, cargo):
        return quem.post("/api/atendentes", {
            "nome": unico("Nova "), "email": f"{unico('n')}@exemplo.com.br", "senha": SENHA,
            "cargo_id": ids[cargo], "disponivel": False,
        })

    lider = cadastrar(gerente, "Líder")
    assert lider.status_code == 201, lider.text
    for cargo in ("Gerente", "Administrador"):
        negado = cadastrar(gerente, cargo)
        assert negado.status_code == 403 and negado.json() == {"detail": CONCEDER_ABAIXO}

    outro_gerente = nova_pessoa(cliente, cabecalho_admin, "Gerente")
    mexer = gerente.patch(f"/api/atendentes/{outro_gerente.id}", {"nome": "Mexido"})
    assert mexer.status_code == 403 and mexer.json() == {"detail": SO_ABAIXO}
    admin_id = cliente.get("/api/auth/eu", headers=cabecalho_admin).json()["id"]
    assert gerente.patch(f"/api/atendentes/{admin_id}", {"ativo": False}).json() == {"detail": SO_ABAIXO}

    liderado = lider.json()["id"]
    promover = gerente.patch(f"/api/atendentes/{liderado}", {"cargo_id": ids["Gerente"]})
    assert promover.status_code == 403 and promover.json() == {"detail": CONCEDER_ABAIXO}
    rebaixar = gerente.patch(f"/api/atendentes/{liderado}", {"cargo_id": ids["Conferente"], "nome": "Renomeada"})
    assert rebaixar.status_code == 200
    assert rebaixar.json()["cargo"]["nome"] == "Conferente" and rebaixar.json()["nome"] == "Renomeada"
    desativar = gerente.patch(f"/api/atendentes/{liderado}", {"ativo": False})
    assert desativar.status_code == 200 and desativar.json()["ativo"] is False


def test_lider_cuida_do_proprio_setor(cliente, cabecalho_admin):
    setor, outro = novo_setor(cliente, cabecalho_admin), novo_setor(cliente, cabecalho_admin)
    lider = nova_pessoa(cliente, cabecalho_admin, "Líder", setor)
    ids = {nome: cargo_id(cliente, cabecalho_admin, nome) for nome in FABRICA}

    def cadastrar(**extra):
        return lider.post("/api/atendentes", {
            "nome": unico("Da Equipe "), "email": f"{unico('eq')}@exemplo.com.br", "senha": SENHA,
            "disponivel": False, **extra,
        })

    # sem escolher setor, entra no setor do líder; outro setor ele não define
    padrao = cadastrar()
    assert padrao.status_code == 201, padrao.text
    assert padrao.json()["setor_id"] == setor["id"] and padrao.json()["cargo"]["nome"] == "Colaborador"
    fora = cadastrar(setor_id=outro["id"])
    assert fora.status_code == 403 and fora.json() == sem_permissao("definir o setor das pessoas")
    assert cadastrar(setor_id=setor["id"]).status_code == 201
    conferente = cadastrar(cargo_id=ids["Conferente"])
    assert conferente.status_code == 201
    assert cadastrar(cargo_id=ids["Líder"]).json() == {"detail": CONCEDER_ABAIXO}

    colega_de_fora = nova_pessoa(cliente, cabecalho_admin, "Colaborador", outro)
    negado = lider.patch(f"/api/atendentes/{colega_de_fora.id}", {"nome": "Mexido"})
    assert negado.status_code == 403 and negado.json() == {"detail": SO_SEU_SETOR}
    mover = lider.patch(f"/api/atendentes/{padrao.json()['id']}", {"setor_id": outro["id"]})
    assert mover.status_code == 403 and mover.json() == sem_permissao("definir o setor das pessoas")
    outro_lider = nova_pessoa(cliente, cabecalho_admin, "Líder", setor)
    assert lider.patch(f"/api/atendentes/{outro_lider.id}", {"nome": "X Y"}).json() == {"detail": SO_ABAIXO}
    ok = lider.patch(f"/api/atendentes/{padrao.json()['id']}", {"nome": "Nome Novo", "disponivel": True, "senha": "outra-senha"})
    assert ok.status_code == 200 and ok.json()["nome"] == "Nome Novo"
    assert entrar(cliente, padrao.json()["email"], "outra-senha")["atendente"]["id"] == padrao.json()["id"]
    cliente.patch(f"/api/atendentes/{padrao.json()['id']}", json={"disponivel": False}, headers=cabecalho_admin)


def test_proprio_perfil_so_senha_e_disponibilidade(cliente, cabecalho_admin):
    setor = novo_setor(cliente, cabecalho_admin)
    for cargo, outro_cargo in (("Colaborador", "Líder"), ("Gerente", "Colaborador")):
        pessoa = nova_pessoa(cliente, cabecalho_admin, cargo, setor)
        outro = cargo_id(cliente, cabecalho_admin, outro_cargo)
        for corpo in ({"nome": "Outro Nome"}, {"setor_id": None}, {"cargo_id": outro}, {"ativo": False}, {"cargo_id": 987654}):
            resposta = pessoa.patch(f"/api/atendentes/{pessoa.id}", corpo)
            assert resposta.status_code == 403, (cargo, corpo, resposta.text)
            assert resposta.json() == {"detail": PROPRIO_PERFIL}
        mesmo = pessoa.patch(f"/api/atendentes/{pessoa.id}", {"nome": pessoa.nome, "setor_id": setor["id"], "disponivel": False})
        assert mesmo.status_code == 200
        senha = pessoa.patch(f"/api/atendentes/{pessoa.id}", {"senha": "senha-nova-1"})
        assert senha.status_code == 200
        assert entrar(cliente, pessoa.dados["email"], "senha-nova-1")["atendente"]["id"] == pessoa.id


def test_sempre_sobra_um_administrador_ativo(cliente, cabecalho_admin, login_admin):
    eu = login_admin["atendente"]
    ids = {nome: cargo_id(cliente, cabecalho_admin, nome) for nome in FABRICA}
    # os administradores que outros testes criaram saem do caminho (a base é da sessão)
    for pessoa in cliente.get("/api/atendentes", headers=cabecalho_admin).json():
        if pessoa["id"] != eu["id"] and pessoa["cargo"]["nome"] == "Administrador" and pessoa["ativo"]:
            fora = cliente.patch(f"/api/atendentes/{pessoa['id']}", json={"cargo_id": ids["Colaborador"]}, headers=cabecalho_admin)
            assert fora.status_code == 200, fora.text

    for corpo in ({"ativo": False}, {"cargo_id": ids["Gerente"]}, {"papel": "atendente"}):
        resposta = cliente.patch(f"/api/atendentes/{eu['id']}", json=corpo, headers=cabecalho_admin)
        assert resposta.status_code == 403, resposta.text
        assert resposta.json() == {"detail": ULTIMO_ADMIN}
    assert cliente.get("/api/auth/eu", headers=cabecalho_admin).json()["cargo"]["nome"] == "Administrador"

    # com outro Administrador, o outro pode deixar de ser (e sobra este)
    segundo = nova_pessoa(cliente, cabecalho_admin, "Administrador")
    assert segundo.eu()["papel"] == "admin"
    rebaixa = segundo.patch(f"/api/atendentes/{segundo.id}", {"cargo_id": ids["Líder"]})
    assert rebaixa.status_code == 200 and rebaixa.json()["cargo"]["nome"] == "Líder"
    assert cliente.patch(f"/api/atendentes/{eu['id']}", json={"ativo": False}, headers=cabecalho_admin).status_code == 403


# ------------------------------------------------------------------- setores
def test_setores_crud(cliente, cabecalho_admin):
    nome = unico("Fiscal ")
    criado = cliente.post("/api/setores", json={"nome": f"  {nome} ", "descricao": "Notas e impostos"}, headers=cabecalho_admin)
    assert criado.status_code == 201, criado.text
    setor = criado.json()
    assert setor == {"id": setor["id"], "nome": nome, "descricao": "Notas e impostos", "ativo": True, "total_pessoas": 0}
    assert cliente.post("/api/setores", json={"nome": nome.upper()}, headers=cabecalho_admin).status_code == 409
    assert setor in cliente.get("/api/setores", headers=cabecalho_admin).json()

    pessoa = nova_pessoa(cliente, cabecalho_admin, "Colaborador", setor)
    novo_nome = unico("Tributário ")
    renomeado = cliente.patch(f"/api/setores/{setor['id']}", json={"nome": novo_nome}, headers=cabecalho_admin)
    assert renomeado.status_code == 200 and renomeado.json()["nome"] == novo_nome
    assert renomeado.json()["total_pessoas"] == 1
    assert pessoa.eu()["setor"] == novo_nome  # a assinatura acompanha o nome novo
    sala = next(s for s in pessoa.get("/api/interno/salas").json() if s["tipo"] == "setor")
    assert sala["nome"] == novo_nome and sala["setor_id"] == setor["id"]

    canal = criar_canal(cliente, cabecalho_admin, "webchat", setor_padrao_id=setor["id"])
    ocupado = cliente.patch(f"/api/setores/{setor['id']}", json={"ativo": False}, headers=cabecalho_admin)
    assert ocupado.status_code == 409
    assert cliente.delete(f"/api/setores/{setor['id']}", headers=cabecalho_admin).status_code == 409  # em uso
    assert cliente.patch(f"/api/atendentes/{pessoa.id}", json={"setor_id": None}, headers=cabecalho_admin).status_code == 200
    desativado = cliente.patch(f"/api/setores/{setor['id']}", json={"ativo": False}, headers=cabecalho_admin)
    assert desativado.status_code == 200 and desativado.json()["ativo"] is False
    canais = {c["id"]: c for c in cliente.get("/api/canais", headers=cabecalho_admin).json()}
    assert canais[canal["id"]]["setor_padrao_id"] is None  # a conversa nova volta para a fila geral
    inativo = cliente.patch(f"/api/atendentes/{pessoa.id}", json={"setor_id": setor["id"]}, headers=cabecalho_admin)
    assert inativo.status_code == 422
    assert cliente.patch(f"/api/setores/{setor['id']}", json={"ativo": True}, headers=cabecalho_admin).json()["ativo"] is True

    vazio = novo_setor(cliente, cabecalho_admin)
    assert cliente.delete(f"/api/setores/{vazio['id']}", headers=cabecalho_admin).status_code == 204
    assert cliente.patch(f"/api/setores/{vazio['id']}", json={"nome": "X Y"}, headers=cabecalho_admin).status_code == 404


def test_quem_pode_mexer_em_setores(cliente, cabecalho_admin):
    gerente = nova_pessoa(cliente, cabecalho_admin, "Gerente")
    criado = gerente.post("/api/setores", {"nome": unico("Comercial ")})
    assert criado.status_code == 201
    lider = nova_pessoa(cliente, cabecalho_admin, "Líder")
    negado = lider.post("/api/setores", {"nome": unico("Outro ")})
    assert negado.status_code == 403 and negado.json() == sem_permissao("criar, renomear e desativar setores")
    assert lider.patch(f"/api/setores/{criado.json()['id']}", {"nome": "Tomado"}).status_code == 403
    assert lider.get("/api/setores").status_code == 200

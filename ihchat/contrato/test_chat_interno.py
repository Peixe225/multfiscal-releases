"""Chat interno da equipe: /api/interno/... e o tempo real restrito a membros.

Contrato (igual nos dois servidores):
    Salas automáticas: "Geral" com todos os atendentes ativos e uma sala por
    setor do cadastro (mantida em dia quando quem gerencia a equipe muda o
    setor de alguém ou desativa alguém; o próprio atendente não muda o seu). Direta única por par. Grupo com os membros escolhidos; quem
    cria administra. Quem não é membro recebe 404 em tudo da sala (nem sabe
    se ela existe), e os eventos "interno.*" só chegam a membros.

A base é da sessão inteira: cada teste cria as próprias pessoas (nomes,
e-mails e setores únicos) e nunca conta com o total de salas ou de membros.
"""
from __future__ import annotations

import pytest

from utilitarios import data_com_fuso, entrar, exigir_rota, unico

SENHA = "senha-da-equipe-123"
CAMPOS_SALA = {
    "id", "tipo", "nome", "setor", "setor_id", "com", "criada_por", "administrador", "total_membros",
    "nao_lidas", "lida_ate", "silenciada", "ultima_mensagem", "atualizada_em",
}
CAMPOS_MENSAGEM = {
    "id", "sala_id", "autor", "conteudo", "mencoes", "conversa_id", "conversa",
    "criada_em", "editada_em", "apagada",
}


# ------------------------------------------------------------------ apoio
class Pessoa:
    def __init__(self, cliente, dados: dict, token: str, cab_admin: dict | None = None):
        self.cliente = cliente
        self.id = dados["id"]
        self.nome = dados["nome"]
        self.dados = dados
        self.cab = {"Authorization": f"Bearer {token}"}
        self.cab_admin = cab_admin

    def mudar(self, corpo: dict):
        """Nome e setor são de quem gerencia a equipe: o admin muda por ela."""
        resposta = self.cliente.patch(f"/api/atendentes/{self.id}", json=corpo, headers=self.cab_admin)
        assert resposta.status_code == 200, resposta.text
        return resposta

    def get(self, caminho, **kw):
        return self.cliente.get(caminho, headers=self.cab, **kw)

    def post(self, caminho, corpo=None, **kw):
        return self.cliente.post(caminho, json=corpo, headers=self.cab, **kw)

    def patch(self, caminho, corpo, **kw):
        return self.cliente.patch(caminho, json=corpo, headers=self.cab, **kw)

    def delete(self, caminho, **kw):
        return self.cliente.delete(caminho, headers=self.cab, **kw)

    # atalhos da API do chat interno
    def salas(self) -> list[dict]:
        resposta = exigir_rota(self.get("/api/interno/salas"), "GET /api/interno/salas")
        assert resposta.status_code == 200, resposta.text
        return resposta.json()

    def sala(self, tipo: str, **filtro) -> dict | None:
        for sala in self.salas():
            if sala["tipo"] == tipo and all(sala.get(k) == v for k, v in filtro.items()):
                return sala
        return None

    def enviar(self, sala_id: int, conteudo: str, **extra) -> dict:
        resposta = self.post(f"/api/interno/salas/{sala_id}/mensagens", {"conteudo": conteudo, **extra})
        assert resposta.status_code == 201, resposta.text
        return resposta.json()

    def direta(self, outro: "Pessoa") -> dict:
        resposta = exigir_rota(self.post("/api/interno/diretas", {"atendente_id": outro.id}), "POST /api/interno/diretas")
        assert resposta.status_code == 200, resposta.text
        return resposta.json()

    def cursor(self) -> int:
        return self.get("/api/eventos/desde").json()["ultimo"]

    def eventos(self, depois: int) -> list[dict]:
        resposta = self.get("/api/eventos/desde", params={"depois": depois})
        assert resposta.status_code == 200, resposta.text
        return resposta.json()["eventos"]


@pytest.fixture
def equipe(cliente, cabecalho_admin):
    """Fábrica de atendentes novos (criados pelo admin, já com login)."""

    def nova(setor: str | None = None, nome: str | None = None, papel: str = "atendente", cargo: str | None = None) -> Pessoa:
        corpo = {
            "nome": nome or unico("Pessoa "),
            "email": f"{unico('equipe')}@exemplo.com.br",
            "senha": SENHA,
            "papel": papel,
        }
        if setor is not None:
            corpo["setor"] = setor
        if cargo is not None:  # pelo nome ("Gerente"): o id muda de base para base
            cargos = cliente.get("/api/cargos", headers=cabecalho_admin).json()
            corpo["cargo_id"] = next(c["id"] for c in cargos if c["nome"] == cargo)
        resposta = cliente.post("/api/atendentes", json=corpo, headers=cabecalho_admin)
        assert resposta.status_code == 201, resposta.text
        return Pessoa(cliente, resposta.json(), entrar(cliente, corpo["email"], SENHA)["token"], cabecalho_admin)

    return nova


def _grupo(dono: Pessoa, nome: str, membros: list[Pessoa]) -> dict:
    resposta = exigir_rota(
        dono.post("/api/interno/grupos", {"nome": nome, "membros": [m.id for m in membros]}),
        "POST /api/interno/grupos",
    )
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


def _ids(membros: list[dict]) -> set[int]:
    return {m["id"] for m in membros}


# ------------------------------------------------------------------ acesso
def test_exige_login(cliente):
    resposta = exigir_rota(cliente.get("/api/interno/salas"), "GET /api/interno/salas")
    assert resposta.status_code == 401
    assert cliente.post("/api/interno/grupos", json={"nome": "x"}).status_code == 401
    assert cliente.get("/api/interno/salas/1/mensagens").status_code == 401


def test_geral_com_todos_os_ativos(equipe):
    ana, bia = equipe(), equipe()
    geral_ana, geral_bia = ana.sala("geral"), bia.sala("geral")
    assert geral_ana is not None and geral_bia is not None
    assert geral_ana["id"] == geral_bia["id"]
    assert set(geral_ana) == CAMPOS_SALA
    assert geral_ana["nome"] == "Geral"
    assert geral_ana["administrador"] is False and geral_ana["com"] is None
    data_com_fuso(geral_ana["atualizada_em"])

    detalhe = ana.get(f"/api/interno/salas/{geral_ana['id']}").json()
    assert {ana.id, bia.id} <= _ids(detalhe["membros"])
    # resumo sem e-mail (e sem senha, claro)
    assert set(detalhe["membros"][0]) == {"id", "nome", "setor", "ativo", "disponivel", "admin"}
    assert detalhe["total_membros"] == len([m for m in detalhe["membros"] if m["ativo"]])


def test_sala_de_setor_segue_o_perfil(equipe):
    setor = unico("Setor ")
    outro_setor = unico("Outro ")
    ana = equipe(setor=setor)
    bia = equipe(setor=f"  {setor.upper()}  ")  # mesmo setor com outra caixa e espaços
    caio = equipe(setor=outro_setor)

    sala = ana.sala("setor", nome=setor)
    assert sala is not None, ana.salas()
    assert sala["setor"] == setor
    assert bia.sala("setor", id=sala["id"]) is not None
    detalhe = ana.get(f"/api/interno/salas/{sala['id']}").json()
    assert _ids(detalhe["membros"]) == {ana.id, bia.id}

    # quem é de outro setor não vê nem lê
    assert caio.sala("setor", id=sala["id"]) is None
    assert caio.get(f"/api/interno/salas/{sala['id']}").status_code == 404
    assert caio.get(f"/api/interno/salas/{sala['id']}/mensagens").status_code == 404
    assert caio.post(f"/api/interno/salas/{sala['id']}/mensagens", {"conteudo": "oi"}).status_code == 404

    # Caio não muda o próprio setor (antes mudava e caía na sala de outro setor)
    antiga = caio.sala("setor", nome=outro_setor)
    assert antiga is not None
    recusado = caio.patch(f"/api/atendentes/{caio.id}", {"setor": setor})
    assert recusado.status_code == 403, recusado.text
    assert caio.sala("setor", id=sala["id"]) is None

    # quem gerencia muda o setor do Caio: ele entra na sala nova e sai da antiga
    caio.mudar({"setor": setor})
    assert caio.sala("setor", id=sala["id"]) is not None
    assert caio.sala("setor", id=antiga["id"]) is None
    assert caio.get(f"/api/interno/salas/{antiga['id']}").status_code == 404
    detalhe = ana.get(f"/api/interno/salas/{sala['id']}").json()
    assert _ids(detalhe["membros"]) == {ana.id, bia.id, caio.id}

    # sem setor: fica só com a Geral (e diretas/grupos)
    bia.mudar({"setor": None})
    assert bia.sala("setor", id=sala["id"]) is None


def test_quem_troca_de_setor_nao_ve_o_historico_do_outro(equipe):
    """Trocar de setor (quem gerencia a equipe troca) põe a pessoa na sala do
    setor novo, mas só do momento em que entrou para a frente — nem a lista
    de mensagens, nem a prévia, nem os eventos guardados na fila entregam o
    que foi dito antes."""
    setor = unico("Financeiro ")
    fabi, gil = equipe(setor=setor), equipe(setor=setor)
    caio = equipe(setor=unico("Suporte "))
    sala = fabi.sala("setor", nome=setor)
    cursor_caio = caio.cursor()
    segredo = fabi.enviar(sala["id"], unico("folha: salário do João = R$ 12.000 "))
    assert caio.get(f"/api/interno/salas/{sala['id']}/mensagens").status_code == 404

    caio.mudar({"setor": setor})
    vista = caio.sala("setor", id=sala["id"])
    assert vista is not None and vista["ultima_mensagem"] is None and vista["nao_lidas"] == 0
    pagina = caio.get(f"/api/interno/salas/{sala['id']}/mensagens").json()
    assert pagina == {"mensagens": [], "tem_mais": False}
    assert caio.get(f"/api/interno/salas/{sala['id']}/mensagens", params={"antes": segredo["id"] + 1}).json()["mensagens"] == []
    assert segredo["conteudo"] not in str(caio.eventos(cursor_caio))
    # quem já era do setor continua vendo tudo
    assert segredo["id"] in [m["id"] for m in gil.get(f"/api/interno/salas/{sala['id']}/mensagens").json()["mensagens"]]

    # dali para a frente, sim
    depois = gil.enviar(sala["id"], unico("bem-vindo, Caio "))
    assert [m["id"] for m in caio.get(f"/api/interno/salas/{sala['id']}/mensagens").json()["mensagens"]] == [depois["id"]]
    assert caio.sala("setor", id=sala["id"])["ultima_mensagem"]["id"] == depois["id"]
    recebidas = [e["dados"]["id"] for e in caio.eventos(cursor_caio) if e["tipo"] == "interno.mensagem"]
    assert depois["id"] in recebidas and segredo["id"] not in recebidas

    # sair e voltar não reabre o que foi dito enquanto estava fora
    caio.mudar({"setor": unico("Suporte ")})
    assert caio.get(f"/api/interno/salas/{sala['id']}/mensagens").status_code == 404
    fora = fabi.enviar(sala["id"], unico("enquanto o Caio estava fora "))
    caio.mudar({"setor": setor})
    ids = [m["id"] for m in caio.get(f"/api/interno/salas/{sala['id']}/mensagens").json()["mensagens"]]
    assert fora["id"] not in ids and segredo["id"] not in ids


def test_desativado_perde_acesso(equipe, cliente, cabecalho_admin):
    setor = unico("Setor ")
    ana, bia = equipe(setor=setor), equipe(setor=setor)
    direta = ana.direta(bia)
    sala_setor = ana.sala("setor", nome=setor)
    geral = ana.sala("geral")
    assert bia.get(f"/api/interno/salas/{direta['id']}").status_code == 200

    resposta = cliente.patch(f"/api/atendentes/{bia.id}", json={"ativo": False}, headers=cabecalho_admin)
    assert resposta.status_code == 200, resposta.text
    assert bia.get("/api/interno/salas").status_code == 401
    assert bia.get(f"/api/interno/salas/{direta['id']}/mensagens").status_code == 401
    assert bia.get("/api/eventos/desde").status_code == 401
    # sai da Geral e do setor na próxima chamada de qualquer pessoa
    assert bia.id not in _ids(ana.get(f"/api/interno/salas/{geral['id']}").json()["membros"])
    assert _ids(ana.get(f"/api/interno/salas/{sala_setor['id']}").json()["membros"]) == {ana.id}
    # a direta fica (é o histórico), com a outra pessoa marcada como inativa
    detalhe = ana.get(f"/api/interno/salas/{direta['id']}").json()
    assert detalhe["com"]["id"] == bia.id and detalhe["com"]["ativo"] is False


# ----------------------------------------------------------------- diretas
def test_direta_unica_por_par(equipe):
    ana, bia, caio = equipe(), equipe(), equipe()
    primeira = ana.direta(bia)
    assert primeira["tipo"] == "direta"
    assert primeira["nome"] == bia.nome
    assert primeira["com"]["id"] == bia.id
    assert _ids(primeira["membros"]) == {ana.id, bia.id}
    assert primeira["total_membros"] == 2

    de_volta = bia.direta(ana)
    assert de_volta["id"] == primeira["id"]
    assert de_volta["nome"] == ana.nome and de_volta["com"]["id"] == ana.id
    assert ana.direta(bia)["id"] == primeira["id"]
    assert len([s for s in ana.salas() if s["tipo"] == "direta" and s["com"]["id"] == bia.id]) == 1

    # terceiro não vê, não lê, não escreve, não apaga
    assert caio.get(f"/api/interno/salas/{primeira['id']}").status_code == 404
    assert caio.get(f"/api/interno/salas/{primeira['id']}/mensagens").status_code == 404
    assert caio.post(f"/api/interno/salas/{primeira['id']}/mensagens", {"conteudo": "psiu"}).status_code == 404
    assert caio.post(f"/api/interno/salas/{primeira['id']}/lida", {}).status_code == 404
    mensagem = ana.enviar(primeira["id"], "só entre nós")
    assert caio.patch(f"/api/interno/mensagens/{mensagem['id']}", {"conteudo": "x"}).status_code == 404
    assert caio.delete(f"/api/interno/mensagens/{mensagem['id']}").status_code == 404
    assert caio.get(f"/api/interno/salas/{primeira['id']}").json() == {"detail": "sala não encontrada"}


def test_direta_recusa_a_si_mesmo_e_quem_nao_existe(equipe):
    ana = equipe()
    assert ana.post("/api/interno/diretas", {"atendente_id": ana.id}).status_code == 422
    assert ana.post("/api/interno/diretas", {"atendente_id": 987654321}).status_code == 404
    assert ana.post("/api/interno/diretas", {}).status_code == 422
    assert ana.post("/api/interno/diretas", {"atendente_id": "abc"}).status_code == 422


# ------------------------------------------------------------------ grupos
def test_grupo_quem_cria_administra(equipe):
    ana, bia, caio = equipe(), equipe(), equipe()
    grupo = _grupo(ana, f"  Plantão   {unico()} ", [bia, bia])
    assert grupo["tipo"] == "grupo"
    assert "  " not in grupo["nome"] and grupo["nome"].startswith("Plantão ")
    assert _ids(grupo["membros"]) == {ana.id, bia.id}
    assert grupo["criada_por"] == ana.id and grupo["administrador"] is True

    visto_por_bia = bia.get(f"/api/interno/salas/{grupo['id']}").json()
    assert visto_por_bia["administrador"] is False
    assert caio.get(f"/api/interno/salas/{grupo['id']}").status_code == 404

    # só quem administra renomeia e mexe nos membros
    assert bia.patch(f"/api/interno/salas/{grupo['id']}", {"nome": "tomado"}).status_code == 403
    assert bia.patch(f"/api/interno/salas/{grupo['id']}", {"adicionar": [caio.id]}).status_code == 403
    novo_nome = unico("Turno ")
    alterado = ana.patch(f"/api/interno/salas/{grupo['id']}", {"nome": novo_nome, "adicionar": [caio.id]})
    assert alterado.status_code == 200, alterado.text
    assert alterado.json()["nome"] == novo_nome
    assert _ids(alterado.json()["membros"]) == {ana.id, bia.id, caio.id}
    assert caio.get(f"/api/interno/salas/{grupo['id']}").status_code == 200

    tirado = ana.patch(f"/api/interno/salas/{grupo['id']}", {"remover": [caio.id]})
    assert _ids(tirado.json()["membros"]) == {ana.id, bia.id}
    assert caio.get(f"/api/interno/salas/{grupo['id']}").status_code == 404

    # quem criou sai: a administração passa para quem ficou
    assert ana.post(f"/api/interno/salas/{grupo['id']}/sair").status_code == 204
    assert ana.get(f"/api/interno/salas/{grupo['id']}").status_code == 404
    ficou = bia.get(f"/api/interno/salas/{grupo['id']}").json()
    assert ficou["criada_por"] == bia.id and ficou["administrador"] is True
    assert _ids(ficou["membros"]) == {bia.id}


def test_criador_desativado_passa_a_administracao(equipe, cliente, cabecalho_admin):
    """Desativar quem criou o grupo equivale a ele sair: administra quem está
    no grupo há mais tempo entre os ativos (senão ninguém mais o altera)."""
    gil, hana, ivo = equipe(), equipe(), equipe()
    grupo = _grupo(gil, unico("Plantão "), [hana])
    resposta = cliente.patch(f"/api/atendentes/{gil.id}", json={"ativo": False}, headers=cabecalho_admin)
    assert resposta.status_code == 200, resposta.text

    visto = hana.get(f"/api/interno/salas/{grupo['id']}").json()
    assert visto["criada_por"] == hana.id and visto["administrador"] is True
    posto = hana.patch(f"/api/interno/salas/{grupo['id']}", {"adicionar": [ivo.id]})
    assert posto.status_code == 200, posto.text
    assert ivo.get(f"/api/interno/salas/{grupo['id']}").json()["administrador"] is False
    # o desativado continua listado (é histórico), e pode ser tirado
    tirado = hana.patch(f"/api/interno/salas/{grupo['id']}", {"remover": [gil.id]})
    assert tirado.status_code == 200, tirado.text
    assert _ids(tirado.json()["membros"]) == {hana.id, ivo.id}


def test_administracao_nao_passa_a_desativado(equipe, cliente, cabecalho_admin):
    ana, bia, caio = equipe(), equipe(), equipe()
    grupo = _grupo(ana, unico("Turno "), [bia, caio])
    # Bia está no grupo há tanto tempo quanto Caio e tem id menor, mas foi desativada
    assert cliente.patch(f"/api/atendentes/{bia.id}", json={"ativo": False}, headers=cabecalho_admin).status_code == 200
    assert ana.post(f"/api/interno/salas/{grupo['id']}/sair").status_code == 204
    visto = caio.get(f"/api/interno/salas/{grupo['id']}").json()
    assert visto["criada_por"] == caio.id and visto["administrador"] is True


def test_grupo_validacoes(equipe):
    ana, bia = equipe(), equipe()
    assert ana.post("/api/interno/grupos", {"nome": "   ", "membros": [bia.id]}).status_code == 422
    assert ana.post("/api/interno/grupos", {"nome": "x" * 81, "membros": []}).status_code == 422
    assert ana.post("/api/interno/grupos", {"nome": "ok", "membros": [987654321]}).status_code == 422
    assert ana.post("/api/interno/grupos", {"nome": "ok", "membros": ["abc"]}).status_code == 422
    assert ana.post("/api/interno/grupos", {"membros": []}).status_code == 422
    sozinho = _grupo(ana, "Rascunhos", [])
    assert _ids(sozinho["membros"]) == {ana.id}


def test_so_grupo_pode_ser_alterado_ou_deixado(equipe):
    ana, bia = equipe(), equipe()
    geral = ana.sala("geral")
    direta = ana.direta(bia)
    assert ana.post(f"/api/interno/salas/{geral['id']}/sair").status_code == 400
    assert ana.post(f"/api/interno/salas/{direta['id']}/sair").status_code == 400
    assert ana.patch(f"/api/interno/salas/{geral['id']}", {"nome": "Minha"}).status_code == 400
    # silenciar vale em qualquer sala e é só para quem pediu
    silenciada = ana.patch(f"/api/interno/salas/{geral['id']}", {"silenciada": True})
    assert silenciada.status_code == 200 and silenciada.json()["silenciada"] is True
    assert bia.sala("geral")["silenciada"] is False
    assert ana.patch(f"/api/interno/salas/{geral['id']}", {"silenciada": False}).json()["silenciada"] is False


# -------------------------------------------------------------- mensagens
def test_enviar_e_listar_paginado(equipe):
    ana, bia = equipe(), equipe()
    sala = ana.direta(bia)
    enviadas = [ana.enviar(sala["id"], f"mensagem {i}") for i in range(5)]
    primeira = enviadas[0]
    assert set(primeira) == CAMPOS_MENSAGEM
    assert primeira["sala_id"] == sala["id"]
    assert primeira["autor"] == {"id": ana.id, "nome": ana.nome, "setor": None, "admin": False}
    assert primeira["mencoes"] == [] and primeira["conversa"] is None and primeira["apagada"] is False
    assert primeira["editada_em"] is None
    data_com_fuso(primeira["criada_em"])

    pagina = bia.get(f"/api/interno/salas/{sala['id']}/mensagens", params={"limite": 2}).json()
    assert [m["conteudo"] for m in pagina["mensagens"]] == ["mensagem 3", "mensagem 4"]
    assert pagina["tem_mais"] is True
    antes = pagina["mensagens"][0]["id"]
    resto = bia.get(f"/api/interno/salas/{sala['id']}/mensagens", params={"antes": antes, "limite": 10}).json()
    assert [m["conteudo"] for m in resto["mensagens"]] == ["mensagem 0", "mensagem 1", "mensagem 2"]
    assert resto["tem_mais"] is False
    tudo = bia.get(f"/api/interno/salas/{sala['id']}/mensagens").json()
    assert [m["id"] for m in tudo["mensagens"]] == [m["id"] for m in enviadas]

    for parametros in ({"limite": 0}, {"limite": 101}, {"antes": 0}, {"antes": "abc"}):
        assert bia.get(f"/api/interno/salas/{sala['id']}/mensagens", params=parametros).status_code == 422


def test_conteudo_validado(equipe):
    ana, bia = equipe(), equipe()
    sala = ana.direta(bia)
    caminho = f"/api/interno/salas/{sala['id']}/mensagens"
    assert ana.post(caminho, {"conteudo": "   "}).status_code == 422
    assert ana.post(caminho, {}).status_code == 422
    assert ana.post(caminho, {"conteudo": None}).status_code == 422
    assert ana.post(caminho, {"conteudo": 123}).status_code == 422
    assert ana.post(caminho, {"conteudo": "x" * 4001}).status_code == 422
    limite = ana.post(caminho, {"conteudo": "é" * 4000})
    assert limite.status_code == 201 and len(limite.json()["conteudo"]) == 4000
    aparado = ana.enviar(sala["id"], "  com espaço em volta \n")
    assert aparado["conteudo"] == "com espaço em volta"
    assert ana.get("/api/interno/salas/abc/mensagens").status_code == 422
    assert ana.get(f"/api/interno/salas/{10**19}").status_code == 422
    assert ana.get("/api/interno/salas/987654321").status_code == 404


def test_mencoes_resolvidas_no_servidor(equipe):
    marca = unico()
    ana = equipe(nome=f"Ana{marca} Lima")
    bia = equipe(nome=f"Bia{marca} Souza")
    caio = equipe(nome=f"Caio{marca} Reis")
    fora = equipe(nome=f"Duda{marca} Paz")  # não é do grupo
    grupo = _grupo(ana, "Menções", [bia, caio])

    texto = f"@bia{marca} souza, veja com @Caio{marca}. @Duda{marca} Paz não está aqui; @Ana{marca} Lima sou eu"
    mensagem = ana.enviar(grupo["id"], texto)
    assert mensagem["mencoes"] == sorted([bia.id, caio.id])
    assert fora.id not in mensagem["mencoes"] and ana.id not in mensagem["mencoes"]

    # e-mail não é menção, e "@Bia..." colado em outra palavra também não
    nada = ana.enviar(grupo["id"], f"escreva para contato@Bia{marca}.com ou @Bia{marca}zinha")
    assert nada["mencoes"] == []

    # primeiro nome repetido na sala: só o nome completo menciona
    xara = equipe(nome=f"Bia{marca} Alves")
    ana.patch(f"/api/interno/salas/{grupo['id']}", {"adicionar": [xara.id]})
    ambiguo = ana.enviar(grupo["id"], f"oi @Bia{marca}")
    assert ambiguo["mencoes"] == []
    completo = ana.enviar(grupo["id"], f"oi @Bia{marca} Alves")
    assert completo["mencoes"] == [xara.id]


def test_nome_repetido_nao_recebe_mencao_de_outro(equipe):
    """Quem tem o nome igual ao de outra pessoa não passa a receber as
    menções dela, e o cargo de Administrador (que só quem gerencia concede)
    aparece no autor e nos membros."""
    marca = unico()
    chefe = equipe(nome=f"Chefe{marca}", papel="admin")
    ana = equipe(nome=f"Ana{marca} Lima")
    bia = equipe(nome=f"Bia{marca} Souza")
    grupo = _grupo(chefe, "Diretoria", [ana, bia])
    antes = bia.enviar(grupo["id"], f"@Chefe{marca} pode ver?")
    assert antes["mencoes"] == [chefe.id]

    ana.mudar({"nome": f"chefe{marca}"})
    imitada = bia.enviar(grupo["id"], f"@Chefe{marca} pode ver?")
    assert imitada["mencoes"] == []  # ambíguo: ninguém, e não os dois

    do_chefe = chefe.enviar(grupo["id"], "sou eu mesmo")
    da_ana = ana.enviar(grupo["id"], "sou eu mesmo")
    assert do_chefe["autor"]["admin"] is True and da_ana["autor"]["admin"] is False
    membros = {m["id"]: m for m in bia.get(f"/api/interno/salas/{grupo['id']}").json()["membros"]}
    assert membros[chefe.id]["admin"] is True and membros[ana.id]["admin"] is False


def test_editar_e_apagar_a_propria_mensagem(equipe):
    marca = unico()
    ana = equipe(nome=f"Ana{marca} Rocha")
    bia = equipe(nome=f"Bia{marca} Melo")
    sala = ana.direta(bia)
    cursor_antes = bia.cursor()
    mensagem = ana.enviar(sala["id"], "primeira versão")

    assert bia.patch(f"/api/interno/mensagens/{mensagem['id']}", {"conteudo": "invasão"}).status_code == 403
    assert bia.delete(f"/api/interno/mensagens/{mensagem['id']}").status_code == 403
    assert ana.patch(f"/api/interno/mensagens/{mensagem['id']}", {"conteudo": "  "}).status_code == 422

    editada = ana.patch(f"/api/interno/mensagens/{mensagem['id']}", {"conteudo": f"segunda versão, @Bia{marca}"})
    assert editada.status_code == 200, editada.text
    corpo = editada.json()
    assert corpo["conteudo"] == f"segunda versão, @Bia{marca}"
    assert corpo["mencoes"] == [bia.id]
    assert corpo["criada_em"] == mensagem["criada_em"]
    data_com_fuso(corpo["editada_em"])

    apagada = ana.delete(f"/api/interno/mensagens/{mensagem['id']}")
    assert apagada.status_code == 200, apagada.text
    assert apagada.json()["apagada"] is True
    assert apagada.json()["conteudo"] == "" and apagada.json()["mencoes"] == []
    assert ana.patch(f"/api/interno/mensagens/{mensagem['id']}", {"conteudo": "volta"}).status_code == 409
    # para a outra pessoa também fica só o lugar
    vista = bia.get(f"/api/interno/salas/{sala['id']}/mensagens").json()["mensagens"]
    assert [(m["id"], m["apagada"], m["conteudo"]) for m in vista] == [(mensagem["id"], True, "")]
    assert ana.delete("/api/interno/mensagens/987654321").status_code == 404

    # quem relê a fila de um cursor antigo não recupera o texto apagado
    relidos = [e for e in bia.eventos(cursor_antes) if e["tipo"].startswith("interno.mensagem")]
    assert relidos and all(e["dados"]["id"] == mensagem["id"] for e in relidos)
    assert "versão" not in str(relidos)
    assert all(e["dados"]["apagada"] is True for e in relidos)


def test_nao_lidas_e_cursor_de_leitura(equipe):
    ana, bia = equipe(), equipe()
    sala = ana.direta(bia)
    assert bia.sala("direta", id=sala["id"])["nao_lidas"] == 0
    ana.enviar(sala["id"], "um")
    segunda = ana.enviar(sala["id"], "dois")

    vista = bia.sala("direta", id=sala["id"])
    assert vista["nao_lidas"] == 2
    assert vista["ultima_mensagem"]["id"] == segunda["id"]
    # a própria mensagem não conta
    assert ana.sala("direta", id=sala["id"])["nao_lidas"] == 0
    assert ana.sala("direta", id=sala["id"])["lida_ate"] == segunda["id"]

    parcial = bia.post(f"/api/interno/salas/{sala['id']}/lida", {"ate": segunda["id"] - 1})
    assert parcial.status_code == 200, parcial.text
    assert parcial.json() == {"sala_id": sala["id"], "lida_ate": segunda["id"] - 1, "nao_lidas": 1}
    # o cursor não volta e não passa da última mensagem
    atras = bia.post(f"/api/interno/salas/{sala['id']}/lida", {"ate": 1}).json()
    assert atras["lida_ate"] == segunda["id"] - 1
    tudo = bia.post(f"/api/interno/salas/{sala['id']}/lida")
    assert tudo.status_code == 200, tudo.text
    assert tudo.json() == {"sala_id": sala["id"], "lida_ate": segunda["id"], "nao_lidas": 0}
    alem = bia.post(f"/api/interno/salas/{sala['id']}/lida", {"ate": segunda["id"] + 1000}).json()
    assert alem["lida_ate"] == segunda["id"]
    assert bia.sala("direta", id=sala["id"])["nao_lidas"] == 0


def test_quem_entra_na_geral_nao_herda_nao_lidas(equipe):
    ana = equipe()
    geral = ana.sala("geral")
    ana.enviar(geral["id"], unico("antes de a Bia chegar "))
    bia = equipe()
    assert bia.sala("geral")["nao_lidas"] == 0
    depois = ana.enviar(geral["id"], unico("depois "))
    vista = bia.sala("geral")
    assert vista["nao_lidas"] >= 1
    assert vista["ultima_mensagem"]["id"] == depois["id"]
    # o histórico continua visível
    ids = [m["id"] for m in bia.get(f"/api/interno/salas/{geral['id']}/mensagens").json()["mensagens"]]
    assert depois["id"] in ids


def test_compartilhar_conversa_de_cliente(equipe, cliente, canal_webchat, cabecalho_admin):
    ana, bia = equipe(cargo="Gerente"), equipe()  # a Ana vê todas as conversas
    sala = ana.direta(bia)
    visitante_nome = unico("Visitante ")
    sessao = exigir_rota(
        cliente.post(
            "/api/widget/sessao", json={"chave_publica": canal_webchat["chave_publica"], "nome": visitante_nome}
        ),
        "POST /api/widget/sessao",
    ).json()
    cursor = ana.cursor()
    enviada = cliente.post("/api/widget/mensagens", json={"conteudo": "preciso de ajuda"}, headers={"X-Sessao": sessao["token"]})
    assert enviada.status_code == 201, enviada.text
    conversa_id = next(
        e["dados"]["conversa_id"] for e in ana.eventos(cursor) if e["tipo"] == "mensagem.nova"
    )

    cartao = ana.enviar(sala["id"], "olha esse cliente", conversa_id=conversa_id)
    assert cartao["conversa_id"] == conversa_id
    assert cartao["conversa"] == {
        "id": conversa_id,
        "contato": visitante_nome,
        "canal_tipo": "webchat",
        "canal_nome": canal_webchat["nome"],
        "status": "aberta",
        "assunto": cartao["conversa"]["assunto"],
    }
    # só o cartão, sem texto, também vale
    so_cartao = ana.enviar(sala["id"], "", conversa_id=conversa_id)
    assert so_cartao["conteudo"] == "" and so_cartao["conversa"]["id"] == conversa_id
    # conversa que não existe: 404, e nada é gravado
    inexistente = ana.post(f"/api/interno/salas/{sala['id']}/mensagens", {"conteudo": "x", "conversa_id": 987654321})
    assert inexistente.status_code == 404
    assert inexistente.json() == {"detail": "conversa nao encontrada"}
    assert ana.post(f"/api/interno/salas/{sala['id']}/mensagens", {"conteudo": "x", "conversa_id": 0}).status_code == 422
    vistas = bia.get(f"/api/interno/salas/{sala['id']}/mensagens").json()["mensagens"]
    assert [m["id"] for m in vistas] == [cartao["id"], so_cartao["id"]]
    assert vistas[0]["conversa"]["contato"] == visitante_nome


# ------------------------------------------------- tempo real com privacidade
def _do_chat(eventos: list[dict]) -> list[dict]:
    return [e for e in eventos if e["tipo"].startswith("interno.")]


def test_evento_de_mensagem_so_para_membros(equipe):
    ana, bia, caio = equipe(), equipe(), equipe()
    sala = ana.direta(bia)
    grupo = _grupo(ana, "Segredo", [bia])
    cursores = {p.id: p.cursor() for p in (ana, bia, caio)}

    texto = unico("confidencial ")
    mensagem = ana.enviar(sala["id"], texto)
    no_grupo = ana.enviar(grupo["id"], unico("do grupo "))

    para_bia = _do_chat(bia.eventos(cursores[bia.id]))
    recebidas = [e["dados"] for e in para_bia if e["tipo"] == "interno.mensagem"]
    assert {m["id"] for m in recebidas} >= {mensagem["id"], no_grupo["id"]}
    vista = next(m for m in recebidas if m["id"] == mensagem["id"])
    assert vista["conteudo"] == texto and vista["sala_id"] == sala["id"]
    assert set(vista) == CAMPOS_MENSAGEM
    # quem escreveu também recebe (as outras abas dele)
    assert mensagem["id"] in {e["dados"]["id"] for e in _do_chat(ana.eventos(cursores[ana.id])) if e["tipo"] == "interno.mensagem"}

    # quem não é membro NÃO recebe nada da sala (nem da direta, nem do grupo)
    resposta = caio.get("/api/eventos/desde", params={"depois": cursores[caio.id]}).json()
    salas_proibidas = {sala["id"], grupo["id"]}
    for evento in resposta["eventos"]:
        assert texto not in str(evento["dados"])
        if evento["tipo"].startswith("interno."):
            assert evento["dados"].get("sala_id") not in salas_proibidas, evento
    # mas o cursor dele anda por cima (não relê os eventos dos outros para sempre)
    assert resposta["ultimo"] > cursores[caio.id]


def test_grupo_apagado_nao_deixa_o_texto_na_fila(equipe):
    """O último sai, o grupo é apagado com as mensagens, e os eventos dele
    guardados na fila (48 h) são esvaziados: nem quem era membro relê o
    texto, nem uma sala criada depois (que no SQLite antigo podia herdar o
    id) recebe algo dele."""
    ana, bia, caio, duda = equipe(), equipe(), equipe(), equipe()
    cursores = {p.id: p.cursor() for p in (ana, bia, caio, duda)}
    grupo = _grupo(ana, "Diretoria", [bia])
    segredo = unico("a senha do cofre é ")
    ana.enviar(grupo["id"], segredo)
    ana.patch(f"/api/interno/mensagens/{ana.enviar(grupo['id'], 'rascunho')['id']}", {"conteudo": unico("editada ")})
    assert ana.post(f"/api/interno/salas/{grupo['id']}/sair").status_code == 204
    assert bia.post(f"/api/interno/salas/{grupo['id']}/sair").status_code == 204
    assert bia.get(f"/api/interno/salas/{grupo['id']}").status_code == 404

    nova = caio.direta(duda)
    _grupo(caio, "Outro", [duda])
    for pessoa in (ana, bia, caio, duda):
        eventos = pessoa.eventos(cursores[pessoa.id])
        assert segredo not in str(eventos)
        do_grupo = [e["dados"] for e in _do_chat(eventos) if e["dados"].get("sala_id") == grupo["id"]]
        # sobra só o "você saiu" de quem saiu, sem conteúdo
        assert all(d.get("acao") == "saiu" and d.get("para") == [pessoa.id] for d in do_grupo), do_grupo
        assert not [e for e in eventos if e["tipo"] == "interno.removido"]
    assert nova["id"] != grupo["id"]


def test_evento_de_sala_e_de_leitura(equipe):
    ana, bia, caio = equipe(), equipe(), equipe()
    cursores = {p.id: p.cursor() for p in (ana, bia, caio)}
    grupo = _grupo(ana, "Avisos", [bia])
    criada = [e["dados"] for e in _do_chat(bia.eventos(cursores[bia.id])) if e["tipo"] == "interno.sala"]
    assert {"sala_id": grupo["id"], "acao": "criada"} in criada
    assert all(e["dados"].get("sala_id") != grupo["id"] for e in _do_chat(caio.eventos(cursores[caio.id])))

    # tirar alguém avisa só essa pessoa (ela deixa de ser membro)
    ana.patch(f"/api/interno/salas/{grupo['id']}", {"adicionar": [caio.id]})
    cursor_caio = caio.cursor()
    ana.patch(f"/api/interno/salas/{grupo['id']}", {"remover": [caio.id]})
    saiu = [e["dados"] for e in _do_chat(caio.eventos(cursor_caio)) if e["tipo"] == "interno.sala"]
    assert {"sala_id": grupo["id"], "acao": "saiu", "para": [caio.id]} in saiu
    cursor_caio = caio.cursor()
    ana.enviar(grupo["id"], "depois que o Caio saiu")
    assert all(e["dados"].get("sala_id") != grupo["id"] for e in _do_chat(caio.eventos(cursor_caio)))

    # o cursor de leitura vai só para a própria pessoa
    cursor_ana, cursor_bia = ana.cursor(), bia.cursor()
    bia.post(f"/api/interno/salas/{grupo['id']}/lida")
    lida = [e["dados"] for e in _do_chat(bia.eventos(cursor_bia)) if e["tipo"] == "interno.lida"]
    assert lida and lida[-1]["sala_id"] == grupo["id"] and lida[-1]["para"] == [bia.id]
    assert not [e for e in _do_chat(ana.eventos(cursor_ana)) if e["tipo"] == "interno.lida"]


def test_evento_de_edicao_chega_aos_membros(equipe):
    ana, bia, caio = equipe(), equipe(), equipe()
    sala = ana.direta(bia)
    mensagem = ana.enviar(sala["id"], "vou editar")
    cursores = {p.id: p.cursor() for p in (bia, caio)}
    ana.patch(f"/api/interno/mensagens/{mensagem['id']}", {"conteudo": "editei"})
    atualizadas = [e["dados"] for e in _do_chat(bia.eventos(cursores[bia.id])) if e["tipo"] == "interno.mensagem.atualizada"]
    assert [(m["conteudo"], m["apagada"]) for m in atualizadas] == [("editei", False)]
    ana.delete(f"/api/interno/mensagens/{mensagem['id']}")
    # depois de apagada, até o evento da edição já guardado passa a dizer "apagada"
    atualizadas = [e["dados"] for e in _do_chat(bia.eventos(cursores[bia.id])) if e["tipo"] == "interno.mensagem.atualizada"]
    assert [(m["conteudo"], m["apagada"]) for m in atualizadas] == [("", True), ("", True)]
    assert all(e["dados"].get("sala_id") != sala["id"] for e in _do_chat(caio.eventos(cursores[caio.id])))


def test_eventos_de_atendimento_continuam_para_todos(equipe, cliente, canal_webchat):
    """O filtro do chat não pode esconder o atendimento de quem o vê (quem
    não vê a conversa não recebe: test_cargos_visibilidade.py)."""
    ana = equipe(cargo="Gerente")
    cursor = ana.cursor()
    sessao = cliente.post(
        "/api/widget/sessao", json={"chave_publica": canal_webchat["chave_publica"], "nome": unico("Cliente ")}
    ).json()
    cliente.post("/api/widget/mensagens", json={"conteudo": "olá"}, headers={"X-Sessao": sessao["token"]})
    tipos = [e["tipo"] for e in ana.eventos(cursor)]
    assert "mensagem.nova" in tipos and "conversa.atualizada" in tipos

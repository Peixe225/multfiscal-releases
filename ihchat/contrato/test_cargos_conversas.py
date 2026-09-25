"""Cargos e setores no atendimento: quem vê qual conversa, transferência,
distribuição por setor e a permissão de cada rota protegida.

Contrato (igual nos dois servidores):
    Visibilidade: conversas.ver_todas vê tudo; todo mundo vê as atribuídas a
    si e as da fila (sem atendente) do próprio setor ou da fila geral;
    conversas.ver_setor vê também as do setor (na fila do setor ou com alguém
    do setor). Quem não vê recebe 404 (lista, detalhe, ações, anexos) e não
    recebe os eventos da conversa ("mensagem.*", "conversa.*").
    Canal com setor_padrao_id: conversa nova entra na fila do setor e só é
    distribuída entre quem está disponível no setor (ninguém: fica na fila).
    POST /api/conversas/{id}/atribuir {atendente_id?, setor_id?}: transferir
    exige conversas.transferir; sem ela, só pegar da fila e devolver a sua.
    ConversaSaida ganha setor_id e setor; o detalhe ganha historico.
"""
from __future__ import annotations

import pytest

from apoio_equipe import (
    canal_do_setor,
    cargo_id,
    cliente_escreve,
    conversa,
    nova_pessoa,
    novo_cargo,
    novo_setor,
    sem_permissao,
)
from utilitarios import exigir_rota, unico

TRANSFERIR = sem_permissao("transferir conversas para outra pessoa ou setor")


@pytest.fixture(autouse=True)
def _tem_cargos(cliente, cabecalho_admin):
    exigir_rota(cliente.get("/api/cargos", headers=cabecalho_admin), "GET /api/cargos")


@pytest.fixture
def cenario(cliente, cabecalho_admin):
    """Dois setores; no A, só a Colaboradora "a1" está disponível."""
    setor_a, setor_b = novo_setor(cliente, cabecalho_admin, "Setor A "), novo_setor(cliente, cabecalho_admin, "Setor B ")
    pessoas = {
        "a1": nova_pessoa(cliente, cabecalho_admin, "Colaborador", setor_a, disponivel=True),
        "a2": nova_pessoa(cliente, cabecalho_admin, "Colaborador", setor_a),
        "conferente_a": nova_pessoa(cliente, cabecalho_admin, "Conferente", setor_a),
        "lider_a": nova_pessoa(cliente, cabecalho_admin, "Líder", setor_a),
        "b1": nova_pessoa(cliente, cabecalho_admin, "Colaborador", setor_b),
        "lider_b": nova_pessoa(cliente, cabecalho_admin, "Líder", setor_b),
        "gerente": nova_pessoa(cliente, cabecalho_admin, "Gerente"),
        "sem_setor": nova_pessoa(cliente, cabecalho_admin, "Colaborador"),
    }
    canal = canal_do_setor(cliente, cabecalho_admin, setor_a)
    return {"a": setor_a, "b": setor_b, "canal": canal, **pessoas}


def _quem_ve(cenario, conversa_id: int) -> set[str]:
    nomes = ("a1", "a2", "conferente_a", "lider_a", "b1", "lider_b", "gerente", "sem_setor")
    return {n for n in nomes if cenario[n].ve(conversa_id, cenario["canal"]["id"])}


# ------------------------------------------------------------- visibilidade
def test_visibilidade_por_setor_na_lista_no_detalhe_e_nos_eventos(cliente, cabecalho_admin, cenario):
    nomes = ("a1", "a2", "conferente_a", "lider_a", "b1", "lider_b", "gerente", "sem_setor")
    cursores = {n: cenario[n].cursor() for n in nomes}

    # canal do setor A: a conversa entra na fila do A e vai para a única disponível
    x = cliente_escreve(cliente, cabecalho_admin, cenario["canal"])
    assert x["setor_id"] == cenario["a"]["id"] and x["setor"] == cenario["a"]["nome"]
    assert x["atendente"]["id"] == cenario["a1"].id
    assert _quem_ve(cenario, x["id"]) == {"a1", "conferente_a", "lider_a", "gerente"}

    # eventos: só quem vê recebe a mensagem nova e a conversa atualizada
    for nome in nomes:
        recebeu = x["id"] in cenario[nome].conversas_dos_eventos(cursores[nome])
        assert recebeu == (nome in {"a1", "conferente_a", "lider_a", "gerente"}), nome

    # ações na conversa de quem não a vê: o mesmo 404 da inexistente
    b1 = cenario["b1"]
    for metodo, caminho, corpo in (
        ("POST", "mensagens", {"conteudo": "oi"}),
        ("POST", "notas", {"conteudo": "oi"}),
        ("POST", "status", {"status": "pendente"}),
        ("POST", "prioridade", {"prioridade": "alta"}),
        ("POST", "ler", None),
        ("POST", "atribuir", {"atendente_id": b1.id}),
        ("POST", "etiquetas", {"etiqueta_id": 1}),
    ):
        resposta = cliente.request(metodo, f"/api/conversas/{x['id']}/{caminho}", json=corpo, headers=b1.cab)
        assert resposta.status_code == 404, (caminho, resposta.text)
        assert resposta.json() == {"detail": "conversa nao encontrada"}

    # sem ninguém disponível no A, a próxima fica na fila do A: a2 (do A) vê, b1 não
    fora = cliente.patch(f"/api/atendentes/{cenario['a1'].id}", json={"disponivel": False}, headers=cabecalho_admin)
    assert fora.status_code == 200
    cursores = {n: cenario[n].cursor() for n in nomes}
    y = cliente_escreve(cliente, cabecalho_admin, cenario["canal"], "segunda conversa")
    assert y["atendente"] is None and y["setor_id"] == cenario["a"]["id"]
    assert _quem_ve(cenario, y["id"]) == {"a1", "a2", "conferente_a", "lider_a", "gerente"}
    assert y["id"] in cenario["a2"].conversas_dos_eventos(cursores["a2"])
    assert y["id"] not in cenario["b1"].conversas_dos_eventos(cursores["b1"])
    assert y["id"] not in cenario["sem_setor"].conversas_dos_eventos(cursores["sem_setor"])


def test_fila_geral_e_de_todos_mas_a_conversa_atribuida_nao(cliente, cabecalho_admin):
    canal = canal_do_setor(cliente, cabecalho_admin, None)
    setor = novo_setor(cliente, cabecalho_admin)
    colaboradora = nova_pessoa(cliente, cabecalho_admin, "Colaborador", setor)
    outra = nova_pessoa(cliente, cabecalho_admin, "Colaborador")
    x = cliente_escreve(cliente, cabecalho_admin, canal)
    assert x["setor_id"] is None
    # a distribuição da fila geral depende de quem está disponível na base; o
    # contrato é: na fila (sem ninguém) todos veem; com alguém, só ele
    solta = cliente.post(f"/api/conversas/{x['id']}/atribuir", json={"atendente_id": None}, headers=cabecalho_admin)
    assert solta.status_code == 200 and solta.json()["atendente"] is None and solta.json()["setor_id"] is None
    assert colaboradora.ve(x["id"]) and outra.ve(x["id"])
    # pegar da fila geral: a conversa vai com a pessoa para o setor dela
    pegou = colaboradora.post(f"/api/conversas/{x['id']}/atribuir", {"atendente_id": colaboradora.id})
    assert pegou.status_code == 200, pegou.text
    assert pegou.json()["setor_id"] == setor["id"] and pegou.json()["atendente"]["id"] == colaboradora.id
    assert colaboradora.ve(x["id"]) and not outra.ve(x["id"])


def test_anexo_segue_a_visibilidade_da_conversa(cliente, cabecalho_admin, cenario):
    x = cliente_escreve(cliente, cabecalho_admin, cenario["canal"])
    enviado = cliente.post(
        f"/api/conversas/{x['id']}/anexos",
        files={"arquivo": ("nota.txt", b"conteudo do anexo", "text/plain")},
        headers=cenario["a1"].cab,
    )
    assert enviado.status_code == 201, enviado.text
    anexo = enviado.json()["anexos"][0]
    assert cenario["a1"].get(f"/api/anexos/{anexo['id']}").status_code == 200
    negado = cenario["b1"].get(f"/api/anexos/{anexo['id']}")
    assert negado.status_code == 404
    envio_alheio = cliente.post(
        f"/api/conversas/{x['id']}/anexos", files={"arquivo": ("x.txt", b"x", "text/plain")}, headers=cenario["b1"].cab
    )
    assert envio_alheio.status_code == 404


# -------------------------------------------------------------- transferência
def test_transferir_pegar_e_devolver(cliente, cabecalho_admin, cenario):
    x = cliente_escreve(cliente, cabecalho_admin, cenario["canal"])
    a1, a2, lider_a, b1, gerente = (cenario[n] for n in ("a1", "a2", "lider_a", "b1", "gerente"))
    assert x["atendente"]["id"] == a1.id

    # sem conversas.transferir: não passa para outra pessoa nem para outro setor
    for corpo in ({"atendente_id": a2.id}, {"setor_id": cenario["b"]["id"]}, {"atendente_id": a1.id, "setor_id": cenario["b"]["id"]}):
        negado = a1.post(f"/api/conversas/{x['id']}/atribuir", corpo)
        assert negado.status_code == 403 and negado.json() == TRANSFERIR, corpo
    # mas devolve a sua para a fila do setor, e a colega do setor pega
    devolvida = a1.post(f"/api/conversas/{x['id']}/atribuir", {"atendente_id": None})
    assert devolvida.status_code == 200
    assert devolvida.json()["atendente"] is None and devolvida.json()["setor_id"] == cenario["a"]["id"]
    assert a2.post(f"/api/conversas/{x['id']}/atribuir", {"atendente_id": a2.id}).status_code == 200
    roubo = a1.post(f"/api/conversas/{x['id']}/atribuir", {"atendente_id": a1.id})
    assert roubo.status_code == 404  # já não é dela nem está na fila: nem a vê

    # o Líder transfere para a fila do setor B (com evento para quem vê e histórico)
    cursor_b1 = b1.cursor()
    transferida = lider_a.post(f"/api/conversas/{x['id']}/atribuir", {"setor_id": cenario["b"]["id"]})
    assert transferida.status_code == 200, transferida.text
    saida = transferida.json()
    assert saida["setor_id"] == cenario["b"]["id"] and saida["setor"] == cenario["b"]["nome"] and saida["atendente"] is None
    atualizada = [e for e in b1.eventos(cursor_b1) if e["tipo"] == "conversa.atualizada" and e["dados"]["id"] == x["id"]]
    assert atualizada and atualizada[-1]["dados"]["setor_id"] == cenario["b"]["id"]
    assert b1.ve(x["id"]) and not a2.ve(x["id"]) and not lider_a.ve(x["id"])
    historico = conversa(cliente, cabecalho_admin, x["id"])["historico"]
    assert set(historico[0]) == {"id", "tipo", "descricao", "atendente_id", "autor", "criado_em"}
    ultimo = historico[-1]
    assert ultimo["tipo"] == "conversa.transferida" and ultimo["atendente_id"] == lider_a.id
    assert cenario["b"]["nome"] in ultimo["descricao"] and ultimo["autor"] == lider_a.nome

    # pessoa + setor: precisa ser do setor; sem setor_id, a conversa vai com a pessoa
    errado = gerente.post(f"/api/conversas/{x['id']}/atribuir", {"atendente_id": b1.id, "setor_id": cenario["a"]["id"]})
    assert errado.status_code == 422
    para_a2 = gerente.post(f"/api/conversas/{x['id']}/atribuir", {"atendente_id": a2.id})
    assert para_a2.status_code == 200
    assert para_a2.json()["setor_id"] == cenario["a"]["id"] and para_a2.json()["atendente"]["id"] == a2.id
    assert "Transferida para" in conversa(cliente, cabecalho_admin, x["id"])["historico"][-1]["descricao"]

    # destino inexistente, desativado ou setor que não existe
    assert gerente.post(f"/api/conversas/{x['id']}/atribuir", {"atendente_id": 99999999}).status_code == 404
    assert gerente.post(f"/api/conversas/{x['id']}/atribuir", {"setor_id": 99999999}).status_code == 404
    inativa = nova_pessoa(cliente, cabecalho_admin, "Colaborador", cenario["a"])
    cliente.patch(f"/api/atendentes/{inativa.id}", json={"ativo": False}, headers=cabecalho_admin)
    assert gerente.post(f"/api/conversas/{x['id']}/atribuir", {"atendente_id": inativa.id}).status_code == 422


# -------------------------------------------------------------- distribuição
def test_distribuicao_so_entre_disponiveis_do_setor(cliente, cabecalho_admin):
    setor = novo_setor(cliente, cabecalho_admin, "Distribuição ")
    d1 = nova_pessoa(cliente, cabecalho_admin, "Colaborador", setor, disponivel=True)
    d2 = nova_pessoa(cliente, cabecalho_admin, "Colaborador", setor, disponivel=True)
    canal = canal_do_setor(cliente, cabecalho_admin, setor)

    primeira = cliente_escreve(cliente, cabecalho_admin, canal)
    segunda = cliente_escreve(cliente, cabecalho_admin, canal)
    # menor fila primeiro: uma para cada, e ninguém de fora do setor
    assert {primeira["atendente"]["id"], segunda["atendente"]["id"]} == {d1.id, d2.id}
    assert primeira["setor_id"] == segunda["setor_id"] == setor["id"]

    for pessoa in (d1, d2):
        assert pessoa.patch(f"/api/atendentes/{pessoa.id}", {"disponivel": False}).status_code == 200
    terceira = cliente_escreve(cliente, cabecalho_admin, canal)
    assert terceira["atendente"] is None and terceira["setor_id"] == setor["id"]  # fila do setor

    # canal sem setor padrão: fila geral (setor_id null)
    sem_setor = cliente_escreve(cliente, cabecalho_admin, canal_do_setor(cliente, cabecalho_admin, None))
    assert sem_setor["setor_id"] is None


def test_canal_com_setor_padrao(cliente, cabecalho_admin):
    setor = novo_setor(cliente, cabecalho_admin)
    canal = canal_do_setor(cliente, cabecalho_admin, None)
    mudou = cliente.patch(f"/api/canais/{canal['id']}", json={"setor_padrao_id": setor["id"]}, headers=cabecalho_admin)
    assert mudou.status_code == 200 and mudou.json()["setor_padrao_id"] == setor["id"]
    assert cliente_escreve(cliente, cabecalho_admin, canal)["setor_id"] == setor["id"]
    tirou = cliente.patch(f"/api/canais/{canal['id']}", json={"setor_padrao_id": None}, headers=cabecalho_admin)
    assert tirou.json()["setor_padrao_id"] is None
    assert cliente.patch(f"/api/canais/{canal['id']}", json={"setor_padrao_id": 99999999}, headers=cabecalho_admin).status_code == 404


# ------------------------------------------------------- permissão por rota
def test_resolver_e_reabrir(cliente, cabecalho_admin, cenario):
    x = cliente_escreve(cliente, cabecalho_admin, cenario["canal"])
    a1, conferente = cenario["a1"], cenario["conferente_a"]
    assert a1.post(f"/api/conversas/{x['id']}/status", {"status": "pendente"}).status_code == 200
    assert a1.post(f"/api/conversas/{x['id']}/status", {"status": "resolvida"}).status_code == 200
    reabrir = a1.post(f"/api/conversas/{x['id']}/status", {"status": "aberta"})
    assert reabrir.status_code == 403 and reabrir.json() == sem_permissao("reabrir conversas resolvidas")
    # a Conferente revisa o setor: vê e reabre a conversa da colega
    assert conferente.post(f"/api/conversas/{x['id']}/status", {"status": "aberta"}).status_code == 200
    assert conferente.post(f"/api/conversas/{x['id']}/notas", {"conteudo": "conferido"}).status_code == 201

    so_ver = novo_cargo(cliente, cabecalho_admin, 10, ["conversas.ver_todas"], "Só olha ")
    observador = nova_pessoa(cliente, cabecalho_admin, so_ver["id"])
    negado = observador.post(f"/api/conversas/{x['id']}/status", {"status": "resolvida"})
    assert negado.status_code == 403 and negado.json() == sem_permissao("resolver conversas")


def test_catalogo_contatos_metricas_e_simulador(cliente, cabecalho_admin, cenario):
    a1, lider, conferente, gerente = cenario["a1"], cenario["lider_a"], cenario["conferente_a"], cenario["gerente"]

    # respostas rápidas e etiquetas: todos leem, criar/apagar é de quem gerencia
    atalho = unico("r")
    negado = a1.post("/api/respostas-rapidas", {"atalho": atalho, "titulo": "Oi", "conteudo": "Olá"})
    assert negado.status_code == 403 and negado.json() == sem_permissao("criar e apagar respostas rápidas")
    criada = lider.post("/api/respostas-rapidas", {"atalho": atalho, "titulo": "Oi", "conteudo": "Olá"})
    assert criada.status_code == 201
    assert atalho in [r["atalho"] for r in a1.get("/api/respostas-rapidas").json()]
    assert a1.delete(f"/api/respostas-rapidas/{criada.json()['id']}").status_code == 403
    assert lider.delete(f"/api/respostas-rapidas/{criada.json()['id']}").status_code == 204
    etiqueta = unico("tag-")
    assert a1.post("/api/etiquetas", {"nome": etiqueta}).json() == sem_permissao("criar e apagar etiquetas")
    criada = lider.post("/api/etiquetas", {"nome": etiqueta})
    assert criada.status_code == 201
    assert a1.get("/api/etiquetas").status_code == 200
    assert a1.delete(f"/api/etiquetas/{criada.json()['id']}").status_code == 403
    # marcar etiqueta na conversa que se vê é do dia a dia
    x = cliente_escreve(cliente, cabecalho_admin, cenario["canal"])
    marcada = a1.post(f"/api/conversas/{x['id']}/etiquetas", {"etiqueta_id": criada.json()["id"]})
    assert marcada.status_code == 200 and etiqueta in [e["nome"] for e in marcada.json()["etiquetas"]]

    # contatos: editar é de todos os cargos de fábrica; mesclar, não
    y = cliente_escreve(cliente, cabecalho_admin, cenario["canal"])
    contato_x, contato_y = x["contato"]["id"], y["contato"]["id"]
    assert a1.patch(f"/api/contatos/{contato_x}", {"empresa": "ACME"}).status_code == 200
    mesclar = a1.post(f"/api/contatos/{contato_x}/mesclar/{contato_y}")
    assert mesclar.status_code == 403 and mesclar.json() == sem_permissao("mesclar contatos")
    assert lider.post(f"/api/contatos/{contato_x}/mesclar/{contato_y}").status_code == 200

    # métricas: a Colaboradora não vê; a Conferente vê o recorte do setor; o Gerente, tudo
    assert a1.get("/api/metricas/resumo").json() == sem_permissao("ver as métricas do próprio setor")
    do_setor = conferente.get("/api/metricas/resumo")
    assert do_setor.status_code == 200
    tudo = gerente.get("/api/metricas/resumo").json()
    assert do_setor.json()["abertas"] <= tudo["abertas"]
    assert set(do_setor.json()["por_canal"]) <= set(tudo["por_canal"])
    assert set(do_setor.json()["por_canal"]) >= {cenario["canal"]["nome"]}

    # simulador (o servidor da suíte está em sandbox)
    negado = a1.get("/api/simulador/canais")
    assert negado.status_code == 403 and negado.json() == sem_permissao("usar o simulador de clientes")
    assert lider.get("/api/simulador/canais").status_code == 200


def test_canais_e_equipe_por_permissao(cliente, cabecalho_admin):
    nada = novo_cargo(cliente, cabecalho_admin, 5, [], "Sem nada ")
    ninguem = nova_pessoa(cliente, cabecalho_admin, nada["id"])
    assert ninguem.eu()["permissoes"] == []
    assert ninguem.get("/api/canais").json() == sem_permissao("ver os canais")
    assert ninguem.get("/api/canais/tipos").status_code == 403
    assert ninguem.get("/api/atendentes").json() == sem_permissao("ver a equipe")
    # ler o catálogo, os cargos e os setores é de qualquer um logado (o painel monta a tela)
    for caminho in ("/api/permissoes", "/api/cargos", "/api/setores", "/api/etiquetas", "/api/respostas-rapidas"):
        assert ninguem.get(caminho).status_code == 200, caminho

    colaborador = nova_pessoa(cliente, cabecalho_admin, "Colaborador")
    gerente = nova_pessoa(cliente, cabecalho_admin, "Gerente")
    assert colaborador.get("/api/canais").status_code == 200
    assert colaborador.get("/api/atendentes").status_code == 200
    for pessoa in (colaborador, gerente):
        novo = pessoa.post("/api/canais", {"nome": unico("Canal "), "tipo": "webchat"})
        assert novo.status_code == 403 and novo.json() == sem_permissao("cadastrar e configurar canais")
    admin_canal = cliente.post("/api/canais", json={"nome": unico("Canal "), "tipo": "webchat"}, headers=cabecalho_admin).json()
    assert gerente.get(f"/api/canais/{admin_canal['id']}/credenciais").status_code == 403
    assert gerente.patch(f"/api/canais/{admin_canal['id']}", {"ativo": False}).status_code == 403
    assert gerente.delete(f"/api/canais/{admin_canal['id']}").status_code == 403
    assert colaborador.post("/api/atendentes", {"nome": "Xx", "email": f"{unico('x')}@e.com.br", "senha": "123456"}).status_code == 403


def test_chat_criar_grupo_e_moderar(cliente, cabecalho_admin):
    sem_grupo = novo_cargo(cliente, cabecalho_admin, 10, ["equipe.ver"], "Sem grupo ")
    quieto = nova_pessoa(cliente, cabecalho_admin, sem_grupo["id"])
    colaborador = nova_pessoa(cliente, cabecalho_admin, "Colaborador")
    gerente = nova_pessoa(cliente, cabecalho_admin, "Gerente")
    negado = quieto.post("/api/interno/grupos", {"nome": "Meu grupo", "membros": [colaborador.id]})
    assert negado.status_code == 403 and negado.json() == sem_permissao("criar grupos no chat da equipe")

    grupo = colaborador.post("/api/interno/grupos", {"nome": unico("Grupo "), "membros": [gerente.id, quieto.id]})
    assert grupo.status_code == 201, grupo.text
    sala = grupo.json()
    mensagem = colaborador.post(f"/api/interno/salas/{sala['id']}/mensagens", {"conteudo": "mensagem para moderar"}).json()
    # quem não modera não apaga a mensagem dos outros; quem modera, sim
    assert quieto.delete(f"/api/interno/mensagens/{mensagem['id']}").status_code == 403
    apagada = gerente.delete(f"/api/interno/mensagens/{mensagem['id']}")
    assert apagada.status_code == 200 and apagada.json()["apagada"] is True and apagada.json()["conteudo"] == ""
    # editar continua só de quem escreveu, mesmo para quem modera
    outra = colaborador.post(f"/api/interno/salas/{sala['id']}/mensagens", {"conteudo": "texto"}).json()
    assert gerente.patch(f"/api/interno/mensagens/{outra['id']}", {"conteudo": "mudado"}).status_code == 403
    # quem modera administra o grupo que não criou
    detalhe = gerente.get(f"/api/interno/salas/{sala['id']}").json()
    assert detalhe["administrador"] is True
    assert quieto.get(f"/api/interno/salas/{sala['id']}").json()["administrador"] is False


def test_compartilhar_so_conversa_que_ve(cliente, cabecalho_admin, cenario):
    x = cliente_escreve(cliente, cabecalho_admin, cenario["canal"])
    b1, a1 = cenario["b1"], cenario["a1"]
    direta = b1.post("/api/interno/diretas", {"atendente_id": a1.id}).json()
    negado = b1.post(f"/api/interno/salas/{direta['id']}/mensagens", {"conteudo": "olha", "conversa_id": x["id"]})
    assert negado.status_code == 404 and negado.json() == {"detail": "conversa nao encontrada"}
    assert a1.post(f"/api/interno/salas/{direta['id']}/mensagens", {"conteudo": "olha", "conversa_id": x["id"]}).status_code == 201


def test_cargo_do_colaborador_ajustavel_pelo_admin(cliente, cabecalho_admin):
    """O admin edita as permissões de um cargo de fábrica (não Administrador)
    e vale na hora para quem tem o cargo; volta ao que era no fim."""
    conferente = next(c for c in cliente.get("/api/cargos", headers=cabecalho_admin).json() if c["nome"] == "Conferente")
    pessoa = nova_pessoa(cliente, cabecalho_admin, "Conferente")
    antes = conferente["permissoes"]
    try:
        mudou = cliente.patch(f"/api/cargos/{conferente['id']}", json={"permissoes": antes + ["simulador.usar"]}, headers=cabecalho_admin)
        assert mudou.status_code == 200 and "simulador.usar" in mudou.json()["permissoes"]
        assert "simulador.usar" in pessoa.eu()["permissoes"]
        assert pessoa.get("/api/simulador/canais").status_code == 200
    finally:
        volta = cliente.patch(f"/api/cargos/{conferente['id']}", json={"permissoes": antes}, headers=cabecalho_admin)
        assert volta.status_code == 200 and volta.json()["permissoes"] == antes
    assert pessoa.get("/api/simulador/canais").status_code == 403
    assert cargo_id(cliente, cabecalho_admin, "Conferente") == conferente["id"]

"""Eventos guardados em fila: consulta por cursor (/desde) e SSE com id.

É o contrato que o servidor PHP também cumpre; o front usa um ou outro
conforme o /saude.
"""
import asyncio
import json

import pytest
from sqlalchemy import select

from app.api import eventos as rotas_eventos
from app.db import SessaoLocal
from app.models import FilaEvento


def abrir_sessao(cliente, canal, **dados) -> dict:
    resposta = cliente.post("/api/widget/sessao", json={"chave_publica": canal.chave_publica, **dados})
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


def mandar(cliente, sessao_widget: dict, texto: str) -> dict:
    resposta = cliente.post(
        "/api/widget/mensagens", headers={"X-Sessao": sessao_widget["token"]}, json={"conteudo": texto}
    )
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


def desde(cliente, cabecalho, **parametros):
    return cliente.get("/api/eventos/desde", params=parametros, headers=cabecalho)


def test_saude_anuncia_stream(cliente):
    assert cliente.get("/saude").json()["eventos"] == "stream"


def test_desde_sem_cursor_so_devolve_o_ultimo(cliente, cabecalho_atendente):
    resposta = desde(cliente, cabecalho_atendente)
    assert resposta.status_code == 200
    assert resposta.json() == {"eventos": [], "ultimo": 0}


def test_desde_exige_token_e_aceita_na_query(cliente, cabecalho_atendente):
    assert cliente.get("/api/eventos/desde").status_code == 401
    token = cabecalho_atendente["Authorization"].split(" ", 1)[1]
    assert cliente.get("/api/eventos/desde", params={"token": token, "depois": 0}).status_code == 200


@pytest.mark.parametrize(
    "parametros",
    [
        {"depois": "abc"},
        {"depois": -1},
        {"depois": 0, "limite": 0},
        {"depois": 0, "limite": 501},
        # maior que o inteiro de 64 bits do banco: era 500 (OverflowError)
        {"depois": "9223372036854775808"},
        {"depois": "99999999999999999999"},
        # 19 dígitos: o PHP (Validador::inteiro) aceita no máximo 18
        {"depois": str(10**18)},
    ],
)
def test_desde_valida_parametros(cliente, cabecalho_atendente, parametros):
    assert desde(cliente, cabecalho_atendente, **parametros).status_code == 422


def test_mensagem_vira_evento_guardado_e_cursor_avanca(cliente, cabecalho_atendente, canal_webchat):
    visitante = abrir_sessao(cliente, canal_webchat, nome="Visitante")
    cursor = desde(cliente, cabecalho_atendente).json()["ultimo"]
    mandar(cliente, visitante, "olá")

    dados = desde(cliente, cabecalho_atendente, depois=cursor).json()
    assert [e["tipo"] for e in dados["eventos"]] == ["mensagem.nova", "conversa.atualizada"]
    assert dados["eventos"][0]["dados"]["conteudo"] == "olá"
    assert dados["eventos"][0]["dados"]["contato_id"] == visitante["contato_id"]
    assert dados["ultimo"] == dados["eventos"][-1]["id"]
    assert desde(cliente, cabecalho_atendente, depois=dados["ultimo"]).json()["eventos"] == []

    # o contato dono do evento fica gravado: é por ele que o widget filtra
    with SessaoLocal() as sessao:
        assert {e.contato_id for e in sessao.scalars(select(FilaEvento))} == {visitante["contato_id"]}


def test_limite_corta_e_o_resto_vem_depois(cliente, cabecalho_atendente, canal_webchat):
    visitante = abrir_sessao(cliente, canal_webchat)
    for i in range(3):
        mandar(cliente, visitante, f"mensagem {i}")
    primeira = desde(cliente, cabecalho_atendente, depois=0, limite=2).json()
    assert len(primeira["eventos"]) == 2
    resto = desde(cliente, cabecalho_atendente, depois=primeira["ultimo"]).json()
    ids = [e["id"] for e in primeira["eventos"] + resto["eventos"]]
    assert ids == sorted(set(ids)) and len(ids) == 6


def test_widget_so_ve_a_resposta_para_ele(cliente, cabecalho_atendente, canal_webchat):
    ana_visitante = abrir_sessao(cliente, canal_webchat, nome="Um")
    outro = abrir_sessao(cliente, canal_webchat, nome="Outro")
    cursor = cliente.get("/api/widget/eventos/desde", params={"token": ana_visitante["token"]}).json()["ultimo"]

    mandar(cliente, ana_visitante, "preciso de ajuda")
    mandar(cliente, outro, "eu também")
    conversas = cliente.get("/api/conversas", headers=cabecalho_atendente).json()
    for conversa in conversas:
        cliente.post(f"/api/conversas/{conversa['id']}/notas", headers=cabecalho_atendente, json={"conteudo": "nota secreta"})
        cliente.post(
            f"/api/conversas/{conversa['id']}/mensagens",
            headers=cabecalho_atendente,
            json={"conteudo": f"resposta para {conversa['contato']['nome']}"},
        )

    dados = cliente.get(
        "/api/widget/eventos/desde", params={"token": ana_visitante["token"], "depois": cursor}
    ).json()
    assert [e["dados"]["conteudo"] for e in dados["eventos"]] == ["resposta para Um"]
    assert "nota secreta" not in json.dumps(dados)
    # o cursor do visitante passa por cima dos eventos dos outros
    assert dados["ultimo"] == desde(cliente, cabecalho_atendente).json()["ultimo"]
    # a sessão também pode vir no cabeçalho, como nas outras rotas do widget
    pelo_cabecalho = cliente.get(
        "/api/widget/eventos/desde", params={"depois": cursor}, headers={"X-Sessao": ana_visitante["token"]}
    )
    assert pelo_cabecalho.json() == dados


def test_widget_desde_exige_sessao(cliente):
    assert cliente.get("/api/widget/eventos/desde").status_code == 401
    resposta = cliente.get("/api/widget/eventos/desde", params={"token": "ws_falsa"})
    assert resposta.status_code == 401
    assert resposta.json() == {"detail": "sessao do widget invalida"}


def test_lacuna_recente_segura_o_cursor(cliente, cabecalho_atendente):
    """Id que falta e é recente pode ser transação ainda aberta: espera."""
    with SessaoLocal() as sessao:
        for evento_id in (1, 2, 4):
            sessao.add(FilaEvento(id=evento_id, tipo="teste", dados="{}", contato_id=None))
        sessao.commit()
    dados = desde(cliente, cabecalho_atendente, depois=1).json()
    assert [e["id"] for e in dados["eventos"]] == [2]
    assert dados["ultimo"] == 2


def _ler_fluxo(depois, filtro=None, quantos=2):
    """Consome o gerador do SSE até `quantos` eventos (sem servidor HTTP)."""

    async def consumir():
        fluxo = rotas_eventos.fluxo_persistido(depois, filtro)
        partes = []
        try:
            async for trecho in fluxo:
                if trecho.startswith("id:"):
                    partes.append(trecho)
                if len(partes) >= quantos:
                    break
        finally:
            await fluxo.aclose()
        return partes

    return asyncio.run(asyncio.wait_for(consumir(), timeout=5))


def test_stream_entrega_com_id_a_partir_do_cursor(cliente, canal_webchat):
    visitante = abrir_sessao(cliente, canal_webchat)
    mandar(cliente, visitante, "primeira")
    partes = _ler_fluxo(0)
    assert partes[0].startswith("id: 1\nevent: mensagem.nova\n")
    assert json.loads(partes[0].split("data: ", 1)[1])["conteudo"] == "primeira"
    assert partes[1].startswith("id: 2\nevent: conversa.atualizada\n")
    # reconexão com Last-Event-ID: só o que veio depois
    mandar(cliente, visitante, "segunda")
    partes = _ler_fluxo(2, quantos=1)
    assert partes[0].startswith("id: 3\nevent: mensagem.nova\n")


def test_last_event_id_vence_o_depois():
    assert rotas_eventos.cursor_inicial(5, "9") == 9
    assert rotas_eventos.cursor_inicial(5, None) == 5
    assert rotas_eventos.cursor_inicial(None, "lixo") is None


@pytest.mark.parametrize("cabecalho", ["²", "99999999999999999999", "9223372036854775808", "-3", "1e3"])
def test_last_event_id_estranho_e_ignorado(cabecalho):
    """"²".isdigit() é True e um número enorme quebrava a consulta do fluxo."""
    assert rotas_eventos.cursor_inicial(5, cabecalho) == 5


def test_desde_no_teto_do_cursor_responde(cliente, cabecalho_atendente):
    resposta = desde(cliente, cabecalho_atendente, depois=str(10**18 - 1))
    assert resposta.status_code == 200
    assert resposta.json() == {"eventos": [], "ultimo": 10**18 - 1}


def test_fluxo_aberto_para_quando_quem_escuta_perde_o_acesso(monkeypatch):
    """Atendente desativado com a aba aberta não segue recebendo: o fluxo
    confere de tempos em tempos e se encerra."""
    monkeypatch.setattr(rotas_eventos, "VERIFICACAO", 0.05)
    monkeypatch.setattr(rotas_eventos, "REVALIDACAO", 0)  # confere a cada volta
    pode = {"sim": True}

    async def consumir():
        fluxo = rotas_eventos.fluxo_persistido(0, validar=lambda: pode["sim"])
        recebidos = []
        try:
            assert (await fluxo.__anext__()).startswith(": conectado")
            with SessaoLocal() as sessao:
                sessao.add(FilaEvento(tipo="mensagem.nova", dados='{"id": 1}', contato_id=None))
                sessao.commit()
            recebidos.append(await asyncio.wait_for(fluxo.__anext__(), timeout=3))
            pode["sim"] = False  # o admin desativou quem escuta
            with SessaoLocal() as sessao:
                sessao.add(FilaEvento(tipo="mensagem.nova", dados='{"id": 2, "segredo": true}', contato_id=None))
                sessao.commit()
            async for trecho in fluxo:  # termina sozinho, sem entregar o segundo
                recebidos.append(trecho)
        finally:
            await fluxo.aclose()
        return recebidos

    recebidos = asyncio.run(asyncio.wait_for(consumir(), timeout=5))
    assert len(recebidos) == 1 and recebidos[0].startswith("id: 1\n")


def test_stream_do_painel_revalida_o_atendente(cliente, atendente, monkeypatch):
    """A validação que o fluxo usa olha o atendente de novo no banco."""
    from app.security import criar_token

    token = criar_token(atendente.id)
    assert rotas_eventos._ainda_pode(token) is True
    with SessaoLocal() as sessao:
        sessao.get(type(atendente), atendente.id).ativo = False
        sessao.commit()
    assert rotas_eventos._ainda_pode(token) is False
    assert rotas_eventos._ainda_pode("lixo") is False


def test_stream_do_widget_recusa_sessao_invalida(cliente):
    assert cliente.get("/api/widget/stream", params={"token": "ws_falsa"}).status_code == 401


def test_stream_ve_evento_gravado_por_outro_processo(monkeypatch):
    """Sem ser acordado pelo barramento (outro worker gravou), o fluxo confere
    a fila sozinho a cada VERIFICACAO segundos."""
    monkeypatch.setattr(rotas_eventos, "VERIFICACAO", 0.2)

    async def consumir():
        fluxo = rotas_eventos.fluxo_persistido(0)
        try:
            assert (await fluxo.__anext__()).startswith(": conectado")
            proximo = asyncio.ensure_future(fluxo.__anext__())
            await asyncio.sleep(0.3)
            with SessaoLocal() as sessao:  # direto no banco: o barramento não fica sabendo
                sessao.add(FilaEvento(tipo="mensagem.nova", dados='{"id": 7}', contato_id=None))
                sessao.commit()
            return await asyncio.wait_for(proximo, timeout=3)
        finally:
            await fluxo.aclose()

    trecho = asyncio.run(consumir())
    assert trecho.startswith("id: 1\nevent: mensagem.nova\n")


def test_stream_do_widget_entrega_o_formato_do_widget(cliente, cabecalho_atendente, canal_webchat):
    """O SSE do widget troca a MensagemSaida do painel pelo formato do
    histórico do widget (sem status, erro nem ids da equipe)."""
    from app.api import widget as rotas_widget

    visitante = abrir_sessao(cliente, canal_webchat, nome="Visitante")
    mandar(cliente, visitante, "oi")
    [conversa] = cliente.get("/api/conversas", headers=cabecalho_atendente).json()
    cursor = desde(cliente, cabecalho_atendente).json()["ultimo"]
    cliente.post(f"/api/conversas/{conversa['id']}/mensagens", headers=cabecalho_atendente, json={"conteudo": "olá!"})

    async def consumir():
        fluxo = rotas_eventos.fluxo_persistido(
            cursor,
            rotas_eventos.do_visitante(visitante["contato_id"]),
            transformar=rotas_widget._para_o_visitante(visitante["token"]),
        )
        try:
            async for trecho in fluxo:
                if trecho.startswith("id:"):
                    return trecho
        finally:
            await fluxo.aclose()

    trecho = asyncio.run(asyncio.wait_for(consumir(), timeout=5))
    dados = json.loads(trecho.split("data: ", 1)[1])
    assert set(dados) == {"id", "direcao", "conteudo", "criada_em", "autor", "assinatura", "anexos"}
    assert dados["conteudo"] == "olá!"


def test_sessao_do_widget_deixa_de_valer_com_o_canal_desativado(cliente, canal_webchat):
    from app.api import widget as rotas_widget
    from app.models import Canal

    visitante = abrir_sessao(cliente, canal_webchat)
    assert rotas_widget._sessao_valida(visitante["token"]) is True
    with SessaoLocal() as sessao:
        sessao.get(Canal, canal_webchat.id).ativo = False
        sessao.commit()
    assert rotas_widget._sessao_valida(visitante["token"]) is False

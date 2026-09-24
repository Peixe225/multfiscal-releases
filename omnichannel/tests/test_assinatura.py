"""Quem atende aparece para o cliente: setor do atendente e assinatura.

O formato do texto que vai a cada provedor é o mesmo do servidor PHP
(php/app/Atendimento/Assinaturas.php).
"""
import json

import httpx
import pytest
from conftest import criar_canal, payload_whatsapp
from sqlalchemy import create_engine, inspect, text

from app.canais import http as canal_http
from app.db import SessaoLocal
from app.models import Atendente, Conversa, TipoCanal, acrescentar_colunas_faltantes
from app.servicos.mensagens import aplicar_assinatura

ANA = {"nome": "Ana", "setor": "Suporte técnico"}


# --------------------------------------------------------------- formato
def test_whatsapp_leva_a_assinatura_em_negrito_na_primeira_linha():
    assert aplicar_assinatura("whatsapp", "Bom dia!", ANA) == "*Ana · Suporte técnico*\nBom dia!"


def test_telegram_leva_texto_puro_na_primeira_linha():
    assert aplicar_assinatura("telegram", "Olá", ANA) == "Ana · Suporte técnico\nOlá"


def test_email_leva_a_assinatura_no_fim():
    assert aplicar_assinatura("email", "Segue o boleto.\n", ANA) == "Segue o boleto.\n\n-- \nAna\nSuporte técnico"


def test_webchat_nao_mexe_no_texto():
    assert aplicar_assinatura("webchat", "Olá", ANA) == "Olá"


def test_sem_setor_vai_so_o_nome_e_sem_assinatura_nada_muda():
    assert aplicar_assinatura("whatsapp", "Oi", {"nome": "Ana", "setor": None}) == "*Ana*\nOi"
    assert aplicar_assinatura("email", "", {"nome": "Ana", "setor": None}) == "-- \nAna"
    assert aplicar_assinatura("whatsapp", "Oi", None) == "Oi"


def test_quebra_de_linha_no_nome_nao_desmonta_o_formato():
    assert aplicar_assinatura("telegram", "Oi", {"nome": "Ana\nMaria", "setor": "Suporte\n técnico"}) == (
        "Ana Maria · Suporte técnico\nOi"
    )


# ------------------------------------------------------------------ setor
def test_setor_no_cadastro_e_no_patch(cliente, cabecalho_admin):
    criado = cliente.post(
        "/api/atendentes",
        headers=cabecalho_admin,
        json={"nome": "Bia", "email": "bia@teste.com.br", "senha": "segredo1", "setor": "  Financeiro  "},
    ).json()
    assert criado["setor"] == "Financeiro"
    url = f"/api/atendentes/{criado['id']}"
    assert cliente.patch(url, headers=cabecalho_admin, json={"setor": "Comercial"}).json()["setor"] == "Comercial"
    # PATCH sem o campo mantém; "" e null limpam
    assert cliente.patch(url, headers=cabecalho_admin, json={"disponivel": False}).json()["setor"] == "Comercial"
    assert cliente.patch(url, headers=cabecalho_admin, json={"setor": ""}).json()["setor"] is None
    cliente.patch(url, headers=cabecalho_admin, json={"setor": "Comercial"})
    assert cliente.patch(url, headers=cabecalho_admin, json={"setor": None}).json()["setor"] is None
    assert cliente.patch(url, headers=cabecalho_admin, json={"setor": "x" * 61}).status_code == 422


def test_atendente_muda_o_proprio_setor(cliente, cabecalho_atendente, atendente):
    resposta = cliente.patch(f"/api/atendentes/{atendente.id}", headers=cabecalho_atendente, json={"setor": "Implantação"})
    assert resposta.status_code == 200
    assert resposta.json()["setor"] == "Implantação"
    assert cliente.get("/api/auth/eu", headers=cabecalho_atendente).json()["setor"] == "Implantação"


# ------------------------------------------------------------- assinatura
def _com_setor(atendente, setor="Suporte técnico"):
    with SessaoLocal() as sessao:
        sessao.get(Atendente, atendente.id).setor = setor
        sessao.commit()


def test_resposta_grava_assinatura_e_o_texto_fica_limpo(cliente, cabecalho_atendente, atendente, canal_whatsapp):
    _com_setor(atendente)
    cliente.post(f"/webhooks/{canal_whatsapp.id}", json=payload_whatsapp("5500912345678", "oi", "wamid.a1"))
    with SessaoLocal() as sessao:
        conversa_id = sessao.query(Conversa).one().id

    corpo = cliente.post(
        f"/api/conversas/{conversa_id}/mensagens", headers=cabecalho_atendente, json={"conteudo": "Olá!"}
    ).json()
    assert corpo["assinatura"] == ANA
    assert corpo["conteudo"] == "Olá!"
    entrada, saida = cliente.get(f"/api/conversas/{conversa_id}", headers=cabecalho_atendente).json()["mensagens"]
    assert entrada["assinatura"] is None
    assert saida["assinatura"] == ANA

    # mudar de setor depois não reescreve o que o cliente já viu
    _com_setor(atendente, "Financeiro")
    saida = cliente.get(f"/api/conversas/{conversa_id}", headers=cabecalho_atendente).json()["mensagens"][1]
    assert saida["assinatura"] == ANA


def test_texto_enviado_ao_telegram_leva_a_assinatura(cliente, cabecalho_atendente, atendente):
    _com_setor(atendente)
    canal = criar_canal(TipoCanal.TELEGRAM, "Bot", credenciais={"token": "123:abc"})
    enviados = []

    def responder(requisicao: httpx.Request) -> httpx.Response:
        enviados.append(json.loads(requisicao.content or b"{}"))
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 5}})

    canal_http.definir_transporte(httpx.MockTransport(responder))
    entrada = {"update_id": 1, "message": {"message_id": 1, "chat": {"id": 777}, "from": {"first_name": "Zé"}, "text": "oi"}}
    assert cliente.post(f"/webhooks/{canal.id}", json=entrada).status_code == 200
    with SessaoLocal() as sessao:
        conversa_id = sessao.query(Conversa).one().id
    corpo = cliente.post(
        f"/api/conversas/{conversa_id}/mensagens", headers=cabecalho_atendente, json={"conteudo": "Olá, Zé"}
    ).json()
    assert corpo["status"] == "enviada", corpo
    assert enviados[-1]["text"] == "Ana · Suporte técnico\nOlá, Zé"


def test_widget_mostra_nome_e_setor_de_quem_respondeu(cliente, cabecalho_atendente, atendente, canal_webchat):
    _com_setor(atendente)
    sessao = cliente.post("/api/widget/sessao", json={"chave_publica": canal_webchat.chave_publica, "nome": "Vi"}).json()
    cliente.post("/api/widget/mensagens", headers={"X-Sessao": sessao["token"]}, json={"conteudo": "oi"})
    [conversa] = cliente.get("/api/conversas", headers=cabecalho_atendente).json()
    resposta = cliente.post(
        f"/api/conversas/{conversa['id']}/mensagens", headers=cabecalho_atendente, json={"conteudo": "Olá!"}
    ).json()
    assert resposta["status"] == "enviada" and resposta["conteudo"] == "Olá!"

    historico = cliente.get("/api/widget/mensagens", headers={"X-Sessao": sessao["token"]}).json()
    assert [m["assinatura"] for m in historico] == [None, ANA]
    assert historico[1]["autor"] == "Ana"


def test_conversa_do_simulador_nunca_sai_pelo_provedor(cliente, cabecalho_atendente, atendente):
    """O simulador inventa o número: com credencial posta depois, a resposta
    não pode ir para esse número, que pode ser de alguém."""
    canal = criar_canal(TipoCanal.WHATSAPP, "Zap")
    escrita = cliente.post(
        "/api/simulador/mensagens",
        headers=cabecalho_atendente,
        json={"canal_id": canal.id, "identificador": "5500911112222", "conteudo": "oi"},
    )
    assert escrita.status_code == 201, escrita.text
    with SessaoLocal() as sessao:
        from app.models import Canal

        sessao.get(Canal, canal.id).credenciais = {"token": "tk", "id_numero": "1"}
        sessao.commit()
    chamadas = []
    canal_http.definir_transporte(httpx.MockTransport(lambda r: chamadas.append(r) or httpx.Response(500)))
    resposta = cliente.post(
        f"/api/conversas/{escrita.json()['conversa_id']}/mensagens", headers=cabecalho_atendente, json={"conteudo": "Olá"}
    ).json()
    assert resposta["status"] == "simulada"
    assert chamadas == []


# --------------------------------------------------------------- migração
def test_base_antiga_ganha_as_colunas_novas(tmp_path):
    motor = create_engine(f"sqlite:///{tmp_path / 'antiga.db'}")
    with motor.begin() as conexao:
        conexao.execute(text("CREATE TABLE atendentes (id INTEGER PRIMARY KEY, nome VARCHAR(120))"))
        conexao.execute(text("CREATE TABLE mensagens (id INTEGER PRIMARY KEY, conteudo TEXT)"))
        conexao.execute(text("INSERT INTO atendentes (nome) VALUES ('Ana')"))
    with motor.begin() as conexao:
        assert sorted(acrescentar_colunas_faltantes(conexao)) == ["atendentes.setor", "mensagens.assinatura"]
    with motor.begin() as conexao:
        assert acrescentar_colunas_faltantes(conexao) == []  # idempotente
    colunas = {c["name"] for c in inspect(motor).get_columns("atendentes")}
    assert "setor" in colunas
    with motor.connect() as conexao:
        assert conexao.execute(text("SELECT nome, setor FROM atendentes")).one() == ("Ana", None)


@pytest.mark.parametrize("valor", ["", "não é json", None])
def test_assinatura_ilegivel_nao_derruba_a_conversa(valor):
    from app.models import JSONEmTexto

    assert JSONEmTexto().process_result_value(valor, None) is None

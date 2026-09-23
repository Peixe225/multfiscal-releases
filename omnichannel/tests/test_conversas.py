from datetime import timedelta

import pytest
from conftest import payload_whatsapp

from app.config import obter_config
from app.db import SessaoLocal
from app.models import Conversa, Mensagem, StatusConversa, agora


@pytest.fixture
def conversa_id(cliente, canal_whatsapp):
    cliente.post(
        f"/webhooks/{canal_whatsapp.id}",
        json=payload_whatsapp("5500912345678", "Bom dia, tenho uma dúvida", "wamid.1", "Ian"),
    )
    with SessaoLocal() as sessao:
        return sessao.query(Conversa).one().id


def test_listar_e_abrir_conversa_zera_nao_lidas(cliente, cabecalho_atendente, conversa_id):
    listagem = cliente.get("/api/conversas", headers=cabecalho_atendente).json()
    assert len(listagem) == 1
    assert listagem[0]["nao_lidas"] == 1
    assert listagem[0]["canal"]["tipo"] == "whatsapp"

    detalhe = cliente.get(f"/api/conversas/{conversa_id}", headers=cabecalho_atendente).json()
    assert [m["conteudo"] for m in detalhe["mensagens"]] == ["Bom dia, tenho uma dúvida"]
    assert cliente.get("/api/conversas", headers=cabecalho_atendente).json()[0]["nao_lidas"] == 0


def test_responder_grava_saida_e_marca_primeira_resposta(cliente, cabecalho_atendente, conversa_id):
    resposta = cliente.post(
        f"/api/conversas/{conversa_id}/mensagens",
        headers=cabecalho_atendente,
        json={"conteudo": "Bom dia! Pode me dizer o CNPJ?"},
    )
    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["direcao"] == "saida"
    assert corpo["autor"] == "Ana"
    # sem credenciais do provedor, o envio fica registrado como simulado
    assert corpo["status"] == "simulada"

    with SessaoLocal() as sessao:
        conversa = sessao.get(Conversa, conversa_id)
        assert conversa.primeira_resposta_em is not None
        assert conversa.previa == "Bom dia! Pode me dizer o CNPJ?"


def test_nota_interna_nao_e_resposta_ao_contato(cliente, cabecalho_atendente, conversa_id):
    resposta = cliente.post(
        f"/api/conversas/{conversa_id}/notas",
        headers=cabecalho_atendente,
        json={"conteudo": "Cliente já ligou sobre isso ontem."},
    )
    assert resposta.status_code == 201
    assert resposta.json()["tipo"] == "nota_interna"
    with SessaoLocal() as sessao:
        assert sessao.get(Conversa, conversa_id).previa == "Bom dia, tenho uma dúvida"


def test_atribuir_e_resolver(cliente, cabecalho_atendente, atendente, conversa_id):
    atribuida = cliente.post(
        f"/api/conversas/{conversa_id}/atribuir",
        headers=cabecalho_atendente,
        json={"atendente_id": atendente.id},
    ).json()
    assert atribuida["atendente"]["nome"] == "Ana"

    resolvida = cliente.post(
        f"/api/conversas/{conversa_id}/status", headers=cabecalho_atendente, json={"status": "resolvida"}
    ).json()
    assert resolvida["status"] == "resolvida"

    devolvida = cliente.post(
        f"/api/conversas/{conversa_id}/atribuir", headers=cabecalho_atendente, json={"atendente_id": None}
    ).json()
    assert devolvida["atendente"] is None


def test_responder_reabre_conversa_resolvida(cliente, cabecalho_atendente, conversa_id):
    cliente.post(
        f"/api/conversas/{conversa_id}/status", headers=cabecalho_atendente, json={"status": "resolvida"}
    )
    cliente.post(
        f"/api/conversas/{conversa_id}/mensagens", headers=cabecalho_atendente, json={"conteudo": "Voltando..."}
    )
    with SessaoLocal() as sessao:
        assert sessao.get(Conversa, conversa_id).status == StatusConversa.ABERTA.value


def test_mensagem_logo_apos_resolver_reabre_a_mesma_conversa(cliente, cabecalho_atendente, canal_whatsapp, conversa_id):
    cliente.post(
        f"/api/conversas/{conversa_id}/status", headers=cabecalho_atendente, json={"status": "resolvida"}
    )
    cliente.post(
        f"/webhooks/{canal_whatsapp.id}",
        json=payload_whatsapp("5500912345678", "Obrigado!", "wamid.2", "Ian"),
    )
    with SessaoLocal() as sessao:
        assert sessao.query(Conversa).count() == 1
        assert sessao.get(Conversa, conversa_id).status == StatusConversa.ABERTA.value


def test_mensagem_muito_depois_abre_conversa_nova(
    cliente, cabecalho_atendente, canal_whatsapp, conversa_id
):
    cliente.post(
        f"/api/conversas/{conversa_id}/status", headers=cabecalho_atendente, json={"status": "resolvida"}
    )
    janela = obter_config().horas_reabertura
    with SessaoLocal() as sessao:
        conversa = sessao.get(Conversa, conversa_id)
        conversa.ultima_mensagem_em = agora() - timedelta(hours=janela + 1)
        sessao.commit()

    cliente.post(
        f"/webhooks/{canal_whatsapp.id}",
        json=payload_whatsapp("5500912345678", "Oi, outro assunto", "wamid.3", "Ian"),
    )
    with SessaoLocal() as sessao:
        assert sessao.query(Conversa).count() == 2


def test_etiquetas_na_conversa(cliente, cabecalho_atendente, conversa_id):
    etiqueta = cliente.post(
        "/api/etiquetas", headers=cabecalho_atendente, json={"nome": "urgente", "cor": "#ff0000"}
    ).json()

    marcada = cliente.post(
        f"/api/conversas/{conversa_id}/etiquetas",
        headers=cabecalho_atendente,
        json={"etiqueta_id": etiqueta["id"]},
    ).json()
    assert [e["nome"] for e in marcada["etiquetas"]] == ["urgente"]

    filtrada = cliente.get(
        "/api/conversas", headers=cabecalho_atendente, params={"etiqueta_id": etiqueta["id"]}
    ).json()
    assert len(filtrada) == 1

    desmarcada = cliente.delete(
        f"/api/conversas/{conversa_id}/etiquetas/{etiqueta['id']}", headers=cabecalho_atendente
    ).json()
    assert desmarcada["etiquetas"] == []


def test_filtros_da_caixa_de_entrada(cliente, cabecalho_atendente, atendente, conversa_id, canal_telegram):
    cliente.post(
        f"/webhooks/{canal_telegram.id}",
        json={"message": {"message_id": 1, "chat": {"id": 99}, "from": {"first_name": "Zé"}, "text": "boleto"}},
    )
    with SessaoLocal() as sessao:
        outra_id = sessao.query(Conversa).filter(Conversa.id != conversa_id).one().id

    # a distribuicao automatica ja entregou as duas para a Ana; devolvo uma
    # para a fila geral para exercitar os dois filtros
    cliente.post(
        f"/api/conversas/{conversa_id}/atribuir",
        headers=cabecalho_atendente,
        json={"atendente_id": atendente.id},
    )
    cliente.post(
        f"/api/conversas/{outra_id}/atribuir", headers=cabecalho_atendente, json={"atendente_id": None}
    )

    def listar(**params):
        return cliente.get("/api/conversas", headers=cabecalho_atendente, params=params).json()

    assert len(listar()) == 2
    assert [c["id"] for c in listar(atendente="eu")] == [conversa_id]
    assert [c["id"] for c in listar(atendente="sem")] == [outra_id]
    assert [c["id"] for c in listar(atendente=str(atendente.id))] == [conversa_id]
    assert len(listar(status="aberta")) == 2
    assert len(listar(status="resolvida")) == 0
    assert [c["id"] for c in listar(canal_id=canal_telegram.id)] == [outra_id]
    # a busca cobre o conteudo das mensagens e os dados do contato
    assert [c["id"] for c in listar(q="boleto")] == [outra_id]
    assert [c["id"] for c in listar(q="Ian")] == [conversa_id]


def test_filtro_de_atendente_invalido_e_recusado(cliente, cabecalho_atendente):
    resposta = cliente.get("/api/conversas", headers=cabecalho_atendente, params={"atendente": "abc"})
    assert resposta.status_code == 422


def test_distribuicao_automatica_equilibra_a_carga(cliente, canal_whatsapp, admin, atendente):
    for indice in range(4):
        cliente.post(
            f"/webhooks/{canal_whatsapp.id}",
            json=payload_whatsapp(f"55119000000{indice}", "oi", f"wamid.d{indice}"),
        )
    with SessaoLocal() as sessao:
        cargas = {}
        for conversa in sessao.query(Conversa):
            assert conversa.atendente_id is not None
            cargas[conversa.atendente_id] = cargas.get(conversa.atendente_id, 0) + 1
        assert sorted(cargas.values()) == [2, 2]


def test_conversa_inexistente(cliente, cabecalho_atendente):
    assert cliente.get("/api/conversas/999", headers=cabecalho_atendente).status_code == 404


def test_datas_da_api_saem_com_fuso(cliente, cabecalho_atendente, conversa_id):
    """Sem o fuso, o navegador em Brasília mostra a hora UTC como local: 3 h adiantada."""
    import re
    from datetime import datetime

    cliente.post(
        f"/api/conversas/{conversa_id}/mensagens", headers=cabecalho_atendente, json={"conteudo": "Oi!"}
    )
    detalhe = cliente.get(f"/api/conversas/{conversa_id}", headers=cabecalho_atendente).json()
    datas = [detalhe["ultima_mensagem_em"], detalhe["criada_em"]] + [m["criada_em"] for m in detalhe["mensagens"]]
    for valor in datas:
        assert re.search(r"(Z|[+-]\d\d:\d\d)$", valor), valor
        assert datetime.fromisoformat(valor.replace("Z", "+00:00")).utcoffset().total_seconds() == 0

"""A promessa do omnichannel: um cliente, um historico."""
from conftest import criar_canal, payload_whatsapp

from app.db import SessaoLocal
from app.models import Contato, Conversa, TipoCanal
from app.servicos.contatos import identificador_no_canal, mesclar, resolver_contato


def test_mesmo_numero_em_dois_webhooks_e_um_so_contato(cliente, canal_whatsapp):
    outro_canal = criar_canal(TipoCanal.WHATSAPP, "WhatsApp Vendas")
    cliente.post(f"/webhooks/{canal_whatsapp.id}", json=payload_whatsapp("5533991269149", "oi", "w1"))
    cliente.post(f"/webhooks/{outro_canal.id}", json=payload_whatsapp("5533991269149", "oi de novo", "w2"))

    with SessaoLocal() as sessao:
        assert sessao.query(Contato).count() == 1
        # canais diferentes => atendimentos diferentes, mesmo contato
        assert sessao.query(Conversa).count() == 2


def test_contato_de_email_reconhecido_pelo_endereco(sessao):
    contato = Contato(nome="Loja Exemplo", email="financeiro@lojaexemplo.com.br")
    sessao.add(contato)
    sessao.commit()

    encontrado = resolver_contato(sessao, TipoCanal.EMAIL.value, "Financeiro@LojaExemplo.com.BR")
    sessao.commit()
    assert encontrado.id == contato.id
    assert [i.canal_tipo for i in encontrado.identidades] == [TipoCanal.EMAIL.value]


def test_contato_de_whatsapp_reconhecido_pelo_telefone(sessao):
    contato = Contato(nome="Ian", telefone="5533991269149")
    sessao.add(contato)
    sessao.commit()

    encontrado = resolver_contato(sessao, TipoCanal.WHATSAPP.value, "+55 (33) 99126-9149", "Ian D.")
    sessao.commit()
    assert encontrado.id == contato.id


def test_identidade_e_reaproveitada_e_nome_e_completado(sessao):
    primeiro = resolver_contato(sessao, TipoCanal.WHATSAPP.value, "5511999998888")
    sessao.commit()
    assert primeiro.nome == "5511999998888"  # so temos o numero

    segundo = resolver_contato(sessao, TipoCanal.WHATSAPP.value, "5511999998888", "Joana")
    sessao.commit()
    assert segundo.id == primeiro.id
    assert segundo.nome == "Joana"


def test_para_onde_responder(sessao):
    contato = resolver_contato(sessao, TipoCanal.TELEGRAM.value, "884412", "Marcos")
    sessao.commit()
    assert identificador_no_canal(sessao, contato, TipoCanal.TELEGRAM.value) == "884412"
    assert identificador_no_canal(sessao, contato, TipoCanal.EMAIL.value) is None


def test_mesclar_junta_identidades_e_conversas(cliente, sessao, canal_whatsapp):
    telefone = resolver_contato(sessao, TipoCanal.WHATSAPP.value, "5511977776666", "Cliente WhatsApp")
    email = resolver_contato(sessao, TipoCanal.EMAIL.value, "cliente@empresa.com.br", "Cliente E-mail")
    sessao.add(Conversa(contato_id=email.id, canal_id=canal_whatsapp.id))
    sessao.commit()

    principal = mesclar(sessao, telefone, email)
    sessao.commit()

    assert sorted(i.canal_tipo for i in principal.identidades) == ["email", "whatsapp"]
    assert principal.email == "cliente@empresa.com.br"
    assert sessao.query(Contato).count() == 1
    assert sessao.query(Conversa).filter_by(contato_id=principal.id).count() == 1


def test_rota_de_mesclagem(cliente, cabecalho_atendente, sessao):
    a = resolver_contato(sessao, TipoCanal.WHATSAPP.value, "5511911110000", "Duplicado A")
    b = resolver_contato(sessao, TipoCanal.EMAIL.value, "duplicado@empresa.com.br", "Duplicado B")
    sessao.commit()

    resposta = cliente.post(f"/api/contatos/{a.id}/mesclar/{b.id}", headers=cabecalho_atendente)
    assert resposta.status_code == 200
    assert len(resposta.json()["identidades"]) == 2


def test_busca_de_contatos(cliente, cabecalho_atendente, sessao):
    resolver_contato(sessao, TipoCanal.WHATSAPP.value, "5511911110000", "Padaria do Zé")
    resolver_contato(sessao, TipoCanal.WHATSAPP.value, "5511922220000", "Mercado Central")
    sessao.commit()

    resposta = cliente.get("/api/contatos", headers=cabecalho_atendente, params={"q": "padaria"})
    assert [c["nome"] for c in resposta.json()] == ["Padaria do Zé"]


def test_telefone_editado_no_painel_e_normalizado(cliente, cabecalho_atendente, sessao):
    contato = resolver_contato(sessao, TipoCanal.EMAIL.value, "alguem@empresa.com.br", "Alguém")
    sessao.commit()

    cliente.patch(
        f"/api/contatos/{contato.id}",
        headers=cabecalho_atendente,
        json={"telefone": "+55 (33) 99126-9149"},
    )
    with SessaoLocal() as s:
        assert s.get(Contato, contato.id).telefone == "5533991269149"

import httpx
import pytest
from conftest import criar_canal

from app.api import simulador
from app.canais import http as canal_http
from app.config import obter_config
from app.db import SessaoLocal
from app.models import Canal, ContatoIdentidade, Conversa, Mensagem, TipoCanal


@pytest.fixture
def canal_email():
    return criar_canal(TipoCanal.EMAIL, "suporte@multfiscal")


@pytest.fixture
def sem_rede():
    """Falha o teste se algo tentar falar com um provedor."""
    chamadas = []

    def recusar(requisicao):
        chamadas.append(requisicao)
        return httpx.Response(500)

    canal_http.definir_transporte(httpx.MockTransport(recusar))
    return chamadas


def escrever(cliente, cabecalho, canal, identificador, conteudo="oi", **extra):
    return cliente.post(
        "/api/simulador/mensagens",
        headers=cabecalho,
        json={"canal_id": canal.id, "identificador": identificador, "conteudo": conteudo, **extra},
    )


def historico(cliente, cabecalho, canal, identificador):
    resposta = cliente.get(
        "/api/simulador/conversa",
        headers=cabecalho,
        params={"canal_id": canal.id, "identificador": identificador},
    )
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


# ------------------------------------------------------------------- canais
def test_lista_canais_com_disponibilidade_e_motivo(
    cliente, cabecalho_atendente, canal_whatsapp, canal_webchat
):
    configurado = criar_canal(
        TipoCanal.TELEGRAM, "Telegram real", credenciais={"token": "123:ABC"}
    )
    criar_canal(TipoCanal.EMAIL, "E-mail desligado", ativo=False)

    resposta = cliente.get("/api/simulador/canais", headers=cabecalho_atendente)
    assert resposta.status_code == 200
    por_id = {c["id"]: c for c in resposta.json()}

    assert set(por_id) == {canal_whatsapp.id, canal_webchat.id, configurado.id}
    assert por_id[canal_whatsapp.id]["disponivel"] is True
    # o webchat tem widget proprio: o motivo leva para ele
    webchat = por_id[canal_webchat.id]
    assert webchat["disponivel"] is False
    assert f"/widget/demo?chave={canal_webchat.chave_publica}" in webchat["motivo"]
    assert webchat["link"] == f"/widget/demo?chave={canal_webchat.chave_publica}"
    assert por_id[configurado.id]["disponivel"] is False
    assert "provedor real" in por_id[configurado.id]["motivo"]


# ---------------------------------------------- entrada pelo adaptador real
def test_whatsapp_entra_pelo_adaptador_com_numero_normalizado(
    cliente, cabecalho_atendente, canal_whatsapp, atendente, monkeypatch
):
    publicadas = []
    monkeypatch.setattr(simulador, "publicar_mensagem", lambda m: publicadas.append(m.id))

    resposta = escrever(
        cliente, cabecalho_atendente, canal_whatsapp, "+55 (33) 99126-9149",
        "Bom dia! O DIFAL está certo?", nome="Ian Dantas",
    )
    assert resposta.status_code == 201, resposta.text
    corpo = resposta.json()
    assert corpo["direcao"] == "entrada"
    assert corpo["contato_id"] is not None
    assert publicadas == [corpo["id"]]

    with SessaoLocal() as sessao:
        mensagem = sessao.get(Mensagem, corpo["id"])
        assert mensagem.externo_id.startswith("whatsapp:wamid.")
        assert mensagem.metadados["tipo_whatsapp"] == "text"  # veio do adaptador
        assert mensagem.metadados["simulada_por"] == atendente.id
        identidade = sessao.query(ContatoIdentidade).one()
        assert (identidade.canal_tipo, identidade.identificador) == ("whatsapp", "5533991269149")
        assert identidade.contato.nome == "Ian Dantas"
        assert identidade.contato.telefone == "5533991269149"

    # e aparece na caixa de entrada como qualquer mensagem de WhatsApp
    conversas = cliente.get("/api/conversas", headers=cabecalho_atendente).json()
    assert [c["canal"]["tipo"] for c in conversas] == ["whatsapp"]


def test_telegram_entra_pelo_adaptador_com_id_numerico(cliente, cabecalho_atendente, canal_telegram):
    resposta = escrever(
        cliente, cabecalho_atendente, canal_telegram, " 884412 ", "Consigo cadastrar a UF?",
        nome="Marcos Contabilidade",
    )
    assert resposta.status_code == 201, resposta.text

    grupo = escrever(cliente, cabecalho_atendente, canal_telegram, "-1001234", "oi do grupo", nome="Contadores")
    assert grupo.status_code == 201, grupo.text

    with SessaoLocal() as sessao:
        mensagem = sessao.get(Mensagem, resposta.json()["id"])
        assert mensagem.externo_id.startswith("telegram:884412-")
        identidades = {i.identificador: i.contato.nome for i in sessao.query(ContatoIdentidade)}
        assert identidades == {"884412": "Marcos Contabilidade", "-1001234": "Contadores"}


def test_email_entra_pelo_adaptador_com_endereco_minusculo_e_assunto(
    cliente, cabecalho_atendente, canal_email
):
    resposta = escrever(
        cliente, cabecalho_atendente, canal_email, "Financeiro@LojaExemplo.com.br",
        "Preciso da segunda via do boleto.",
        nome='Financeiro, Loja "Exemplo"', assunto="Segunda via do boleto",
    )
    assert resposta.status_code == 201, resposta.text
    assert resposta.json()["assunto"] == "Segunda via do boleto"

    with SessaoLocal() as sessao:
        mensagem = sessao.get(Mensagem, resposta.json()["id"])
        assert mensagem.externo_id.startswith("email:<")
        assert mensagem.conversa.assunto == "Segunda via do boleto"
        identidade = sessao.query(ContatoIdentidade).one()
        assert identidade.identificador == "financeiro@lojaexemplo.com.br"
        # virgula e aspas no nome sobrevivem ao cabecalho From
        assert identidade.contato.nome == 'Financeiro, Loja "Exemplo"'


def test_mensagens_repetidas_do_mesmo_cliente_caem_na_mesma_conversa(
    cliente, cabecalho_atendente, canal_whatsapp
):
    # formatos diferentes do mesmo numero: continua sendo um cliente so
    for indice, numero in enumerate(["5533991269149", "+55 33 99126-9149", "55 33 991269149"]):
        resposta = escrever(cliente, cabecalho_atendente, canal_whatsapp, numero, f"mensagem {indice}")
        assert resposta.status_code == 201, resposta.text

    with SessaoLocal() as sessao:
        conversa = sessao.query(Conversa).one()
        assert conversa.nao_lidas == 3
        externos = {m.externo_id for m in conversa.mensagens}
        assert len(externos) == 3  # id externo novo a cada mensagem


# ------------------------------------------------------ o que o cliente ve
def test_historico_tem_resposta_do_atendente_e_nao_tem_nota_interna(
    cliente, cabecalho_atendente, canal_whatsapp, sem_rede
):
    assert historico(cliente, cabecalho_atendente, canal_whatsapp, "5533991269149") == {
        "contato_id": None,
        "mensagens": [],
    }

    enviada = escrever(cliente, cabecalho_atendente, canal_whatsapp, "5533991269149", "Bom dia!").json()
    conversa_id = enviada["conversa_id"]
    cliente.post(
        f"/api/conversas/{conversa_id}/notas",
        headers=cabecalho_atendente,
        json={"conteudo": "cliente antigo, tratar com carinho"},
    )
    resposta = cliente.post(
        f"/api/conversas/{conversa_id}/mensagens",
        headers=cabecalho_atendente,
        json={"conteudo": "Bom dia, Ian! Como posso ajudar?"},
    )
    assert resposta.json()["status"] == "simulada"

    # pedido com o numero formatado: a normalizacao e a mesma da gravacao
    vista = historico(cliente, cabecalho_atendente, canal_whatsapp, "+55 (33) 99126-9149")
    assert vista["contato_id"] == enviada["contato_id"]
    assert [(m["direcao"], m["conteudo"]) for m in vista["mensagens"]] == [
        ("entrada", "Bom dia!"),
        ("saida", "Bom dia, Ian! Como posso ajudar?"),
    ]
    assert vista["mensagens"][1]["autor"] == "Ana"
    assert sem_rede == []  # nada saiu para provedor nenhum


def test_historico_fica_no_canal_pedido(cliente, cabecalho_atendente, canal_whatsapp):
    outro = criar_canal(TipoCanal.WHATSAPP, "WhatsApp Vendas")
    escrever(cliente, cabecalho_atendente, canal_whatsapp, "5533991269149", "no suporte")
    escrever(cliente, cabecalho_atendente, outro, "5533991269149", "em vendas")

    vista = historico(cliente, cabecalho_atendente, outro, "5533991269149")
    assert [m["conteudo"] for m in vista["mensagens"]] == ["em vendas"]


# --------------------------------------------------------------- recusas
def test_sandbox_desligado_esconde_o_simulador(cliente, cabecalho_atendente, canal_whatsapp, monkeypatch):
    monkeypatch.setattr(obter_config(), "modo_sandbox", False)

    respostas = [
        cliente.get("/api/simulador/canais", headers=cabecalho_atendente),
        escrever(cliente, cabecalho_atendente, canal_whatsapp, "5533991269149"),
        cliente.get(
            "/api/simulador/conversa",
            headers=cabecalho_atendente,
            params={"canal_id": canal_whatsapp.id, "identificador": "5533991269149"},
        ),
        # desligado, nem a falta de token denuncia que a rota existe
        cliente.get("/api/simulador/canais"),
    ]
    assert [r.status_code for r in respostas] == [404, 404, 404, 404]
    assert respostas[0].json()["detail"] == "simulador desligado fora do modo sandbox"
    with SessaoLocal() as sessao:
        assert sessao.query(Mensagem).count() == 0


def test_exige_atendente_autenticado(cliente, canal_whatsapp):
    assert cliente.get("/api/simulador/canais").status_code == 401
    assert escrever(cliente, {}, canal_whatsapp, "5533991269149").status_code == 401
    assert escrever(
        cliente, {"Authorization": "Bearer inventado"}, canal_whatsapp, "5533991269149"
    ).status_code == 401


def test_recusa_canal_configurado_de_verdade(cliente, cabecalho_atendente):
    real = criar_canal(
        TipoCanal.WHATSAPP, "WhatsApp real", credenciais={"token": "EAAG", "id_numero": "123"}
    )
    resposta = escrever(cliente, cabecalho_atendente, real, "5533991269149")
    assert resposta.status_code == 409
    assert "provedor real" in resposta.json()["detail"]
    with SessaoLocal() as sessao:
        assert sessao.query(Mensagem).count() == 0


def test_recusa_canal_inexistente_ou_desativado(cliente, cabecalho_atendente):
    desligado = criar_canal(TipoCanal.WHATSAPP, "WhatsApp antigo", ativo=False)
    assert escrever(cliente, cabecalho_atendente, desligado, "5533991269149").status_code == 404

    fantasma = Canal(id=9999)
    assert escrever(cliente, cabecalho_atendente, fantasma, "5533991269149").status_code == 404


def test_recusa_webchat_apontando_o_widget(cliente, cabecalho_atendente, canal_webchat):
    resposta = escrever(cliente, cabecalho_atendente, canal_webchat, "visitante")
    assert resposta.status_code == 422
    assert "/widget/demo?chave=" in resposta.json()["detail"]


@pytest.mark.parametrize(
    "tipo, identificador",
    [
        (TipoCanal.WHATSAPP, "123456"),            # curto demais
        (TipoCanal.WHATSAPP, "5533991269149000"),  # 16 digitos
        (TipoCanal.WHATSAPP, "ian dantas"),
        (TipoCanal.TELEGRAM, "@marcos"),
        (TipoCanal.TELEGRAM, "88a12"),
        (TipoCanal.TELEGRAM, "0"),
        (TipoCanal.EMAIL, "financeiro-sem-arroba"),
        (TipoCanal.EMAIL, "a@b"),
    ],
)
def test_recusa_identificador_invalido_para_o_canal(cliente, cabecalho_atendente, tipo, identificador):
    canal = criar_canal(tipo)
    resposta = escrever(cliente, cabecalho_atendente, canal, identificador)
    assert resposta.status_code == 422, resposta.text
    assert isinstance(resposta.json()["detail"], str)  # frase em portugues, nao erro do pydantic

    consulta = cliente.get(
        "/api/simulador/conversa",
        headers=cabecalho_atendente,
        params={"canal_id": canal.id, "identificador": identificador},
    )
    assert consulta.status_code == 422


def test_recusa_mensagem_vazia(cliente, cabecalho_atendente, canal_whatsapp):
    assert escrever(cliente, cabecalho_atendente, canal_whatsapp, "5533991269149", "   ").status_code == 422

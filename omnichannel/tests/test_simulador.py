import os
import re
import socket
import threading
import time
from pathlib import Path

import httpx
import pytest
from conftest import criar_canal

from app.api import simulador
from app.canais import http as canal_http
from app.canais.base import MensagemRecebida
from app.config import obter_config
from app.db import SessaoLocal
from app.main import criar_app
from app.models import Canal, ContatoIdentidade, Conversa, Mensagem, TipoCanal
from app.servicos.mensagens import registrar_entrada


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
        cliente, cabecalho_atendente, canal_whatsapp, "+55 (00) 91234-5678",
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
        assert (identidade.canal_tipo, identidade.identificador) == ("whatsapp", "5500912345678")
        assert identidade.contato.nome == "Ian Dantas"
        assert identidade.contato.telefone == "5500912345678"

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
        cliente, cabecalho_atendente, canal_email, "Financeiro@Loja.EXAMPLE",
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
        assert identidade.identificador == "financeiro@loja.example"
        # virgula e aspas no nome sobrevivem ao cabecalho From
        assert identidade.contato.nome == 'Financeiro, Loja "Exemplo"'


def test_email_assunto_longo_e_cortado_e_nao_trava_a_thread(cliente, cabecalho_atendente, canal_email):
    longo = "Pedido " + "A" * 300
    primeira = escrever(cliente, cabecalho_atendente, canal_email, "compras@cliente.example", "Primeiro", assunto=longo)
    assert primeira.status_code == 201, primeira.text
    assert len(primeira.json()["assunto"]) == 200  # o que cabe na conversa

    # o que o simulador poe no campo depois: "Re: " + o assunto ja no limite
    resposta = "Re: " + primeira.json()["assunto"]
    segunda = escrever(cliente, cabecalho_atendente, canal_email, "compras@cliente.example", "Segundo", assunto=resposta)
    assert segunda.status_code == 201, segunda.text
    assert segunda.json()["conversa_id"] == primeira.json()["conversa_id"]
    assert len(segunda.json()["assunto"]) == 200

    grande_demais = escrever(cliente, cabecalho_atendente, canal_email, "compras@cliente.example", "x", assunto="A" * 999)
    assert grande_demais.status_code == 422  # mais que uma linha de cabecalho


def test_email_cada_mensagem_mostra_o_assunto_que_o_cliente_digitou(
    cliente, cabecalho_atendente, canal_email, sem_rede
):
    primeira = escrever(
        cliente, cabecalho_atendente, canal_email, "financeiro@loja.example",
        "Preciso da segunda via.", assunto="Segunda via do boleto",
    ).json()
    segunda = escrever(
        cliente, cabecalho_atendente, canal_email, "financeiro@loja.example",
        "Outra coisa: a nota de agosto saiu com CFOP errado.", assunto="Nota fiscal de agosto errada",
    ).json()
    # mesma conversa, que guarda o primeiro assunto; o cartao, o que foi digitado
    assert segunda["conversa_id"] == primeira["conversa_id"]
    assert segunda["assunto"] == "Nota fiscal de agosto errada"
    assert segunda["assunto_conversa"] == "Segunda via do boleto"

    cliente.post(
        f"/api/conversas/{primeira['conversa_id']}/mensagens",
        headers=cabecalho_atendente,
        json={"conteudo": "Segue a segunda via."},
    )
    vista = historico(cliente, cabecalho_atendente, canal_email, "financeiro@loja.example")
    assert [(m["direcao"], m["assunto"]) for m in vista["mensagens"]] == [
        ("entrada", "Segunda via do boleto"),
        ("entrada", "Nota fiscal de agosto errada"),
        # a resposta vai com o assunto da conversa, como o adaptador envia
        ("saida", "Re: Segunda via do boleto"),
    ]
    assert {m["assunto_conversa"] for m in vista["mensagens"]} == {"Segunda via do boleto"}


def test_email_de_antes_do_assunto_nao_herda_o_que_veio_depois(cliente, cabecalho_atendente, canal_email):
    # como o seed --demo: um e-mail sem assunto, que nao passou pelo simulador
    with SessaoLocal() as sessao:
        canal = sessao.get(Canal, canal_email.id)
        antigo = registrar_entrada(
            sessao, canal,
            MensagemRecebida(identificador="financeiro@loja.example", conteudo="Preciso do boleto."),
        )
        sessao.commit()
        conversa_id = antigo.conversa_id
    cliente.post(
        f"/api/conversas/{conversa_id}/mensagens", headers=cabecalho_atendente, json={"conteudo": "Qual mes?"}
    )
    escrever(
        cliente, cabecalho_atendente, canal_email, "financeiro@loja.example", "Agosto.", assunto="Boleto de agosto"
    )

    vista = historico(cliente, cabecalho_atendente, canal_email, "financeiro@loja.example")
    assert [(m["direcao"], m["assunto"]) for m in vista["mensagens"]] == [
        ("entrada", None),                   # nunca teve assunto
        ("saida", "Re: Atendimento"),        # a conversa nao tinha assunto ao responder
        ("entrada", "Boleto de agosto"),     # foi este que deu nome a conversa
    ]
    assert vista["mensagens"][0]["assunto_conversa"] == "Boleto de agosto"


def test_whatsapp_e_telegram_nao_tem_assunto(cliente, cabecalho_atendente, canal_whatsapp):
    corpo = escrever(cliente, cabecalho_atendente, canal_whatsapp, "5500912345678", assunto="ignorado").json()
    assert corpo["assunto"] is None and corpo["assunto_conversa"] is None


def test_mensagens_repetidas_do_mesmo_cliente_caem_na_mesma_conversa(
    cliente, cabecalho_atendente, canal_whatsapp
):
    # formatos diferentes do mesmo numero: continua sendo um cliente so
    for indice, numero in enumerate(["5500912345678", "+55 00 91234-5678", "55 00 912345678"]):
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
    assert historico(cliente, cabecalho_atendente, canal_whatsapp, "5500912345678") == {
        "contato_id": None,
        "mensagens": [],
    }

    enviada = escrever(cliente, cabecalho_atendente, canal_whatsapp, "5500912345678", "Bom dia!").json()
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
    vista = historico(cliente, cabecalho_atendente, canal_whatsapp, "+55 (00) 91234-5678")
    assert vista["contato_id"] == enviada["contato_id"]
    assert [(m["direcao"], m["conteudo"]) for m in vista["mensagens"]] == [
        ("entrada", "Bom dia!"),
        ("saida", "Bom dia, Ian! Como posso ajudar?"),
    ]
    assert vista["mensagens"][1]["autor"] == "Ana"
    assert sem_rede == []  # nada saiu para provedor nenhum


def test_historico_fica_no_canal_pedido(cliente, cabecalho_atendente, canal_whatsapp):
    outro = criar_canal(TipoCanal.WHATSAPP, "WhatsApp Vendas")
    escrever(cliente, cabecalho_atendente, canal_whatsapp, "5500912345678", "no suporte")
    escrever(cliente, cabecalho_atendente, outro, "5500912345678", "em vendas")

    vista = historico(cliente, cabecalho_atendente, outro, "5500912345678")
    assert [m["conteudo"] for m in vista["mensagens"]] == ["em vendas"]


# --------------------------------------------------------------- recusas
def test_sandbox_desligado_esconde_o_simulador(cliente, cabecalho_atendente, canal_whatsapp, monkeypatch):
    monkeypatch.setattr(obter_config(), "modo_sandbox", False)

    respostas = [
        cliente.get("/api/simulador/canais", headers=cabecalho_atendente),
        escrever(cliente, cabecalho_atendente, canal_whatsapp, "5500912345678"),
        cliente.get(
            "/api/simulador/conversa",
            headers=cabecalho_atendente,
            params={"canal_id": canal_whatsapp.id, "identificador": "5500912345678"},
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
    assert escrever(cliente, {}, canal_whatsapp, "5500912345678").status_code == 401
    assert escrever(
        cliente, {"Authorization": "Bearer inventado"}, canal_whatsapp, "5500912345678"
    ).status_code == 401


def test_recusa_canal_configurado_de_verdade(cliente, cabecalho_atendente):
    real = criar_canal(
        TipoCanal.WHATSAPP, "WhatsApp real", credenciais={"token": "EAAG", "id_numero": "123"}
    )
    resposta = escrever(cliente, cabecalho_atendente, real, "5500912345678")
    assert resposta.status_code == 409
    assert "provedor real" in resposta.json()["detail"]
    with SessaoLocal() as sessao:
        assert sessao.query(Mensagem).count() == 0


@pytest.mark.parametrize(
    "tipo, credenciais",
    [
        # caixa so de leitura: o coletor ja traz e-mails de clientes reais
        (TipoCanal.EMAIL, {"imap_host": "imap.empresa.com.br", "imap_usuario": "suporte", "imap_senha": "x"}),
        # recebe da Meta (assinatura conferida), o token de envio ainda por colar
        (TipoCanal.WHATSAPP, {"segredo_app": "app-secret", "token_verificacao": "verifica"}),
        (TipoCanal.WHATSAPP, {"token": "EAAG-colado-pela-metade"}),
    ],
)
def test_recusa_canal_com_credencial_de_provedor_mesmo_sem_envio(
    cliente, cabecalho_atendente, tipo, credenciais
):
    canal = criar_canal(tipo, "Canal meio ligado", credenciais=credenciais)
    identificador = "joao@clientereal.com.br" if tipo is TipoCanal.EMAIL else "5511912345678"

    lista = cliente.get("/api/simulador/canais", headers=cabecalho_atendente).json()
    situacao = next(c for c in lista if c["id"] == canal.id)
    assert situacao["disponivel"] is False
    assert "provedor real" in situacao["motivo"]

    resposta = escrever(cliente, cabecalho_atendente, canal, identificador, "Cancelem meu contrato")
    assert resposta.status_code == 409
    assert "provedor real" in resposta.json()["detail"]
    with SessaoLocal() as sessao:
        assert sessao.query(Mensagem).count() == 0


@pytest.mark.parametrize(
    "tipo, credenciais, identificador",
    [
        # so ajustes com valor padrao: nao ha token nem servidor para receber
        (TipoCanal.TELEGRAM, {"modo_recebimento": "webhook"}, "884412"),
        (TipoCanal.EMAIL, {"smtp_porta": "465", "imap_senha": ""}, "cliente@loja.example"),
    ],
)
def test_ajuste_sem_credencial_continua_simulavel(cliente, cabecalho_atendente, tipo, credenciais, identificador):
    canal = criar_canal(tipo, credenciais=credenciais)
    assert escrever(cliente, cabecalho_atendente, canal, identificador).status_code == 201


def test_recusa_canal_inexistente_ou_desativado(cliente, cabecalho_atendente):
    desligado = criar_canal(TipoCanal.WHATSAPP, "WhatsApp antigo", ativo=False)
    assert escrever(cliente, cabecalho_atendente, desligado, "5500912345678").status_code == 404

    fantasma = Canal(id=9999)
    assert escrever(cliente, cabecalho_atendente, fantasma, "5500912345678").status_code == 404


def test_recusa_webchat_apontando_o_widget(cliente, cabecalho_atendente, canal_webchat):
    resposta = escrever(cliente, cabecalho_atendente, canal_webchat, "visitante")
    assert resposta.status_code == 422
    assert "/widget/demo?chave=" in resposta.json()["detail"]


@pytest.mark.parametrize(
    "tipo, identificador",
    [
        (TipoCanal.WHATSAPP, "123456"),            # curto demais
        (TipoCanal.WHATSAPP, "5500912345678000"),  # 16 digitos
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
    assert escrever(cliente, cabecalho_atendente, canal_whatsapp, "5500912345678", "   ").status_code == 422


# ------------------------------------------------- a pagina, no navegador
# O que o simulador faz de errado aparece no navegador, nao na API: estes
# testes abrem o /simulador de verdade num Chromium contra um servidor vivo.
# Sem Playwright ou sem Chromium na maquina, sao pulados.
CHROMIUM = Path(os.environ.get("OMNI_TESTE_CHROMIUM", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"))
SIMULADOR_JS = Path(simulador.__file__).resolve().parents[1] / "web" / "simulador.js"


@pytest.fixture(scope="module")
def servidor_vivo():
    uvicorn = pytest.importorskip("uvicorn")
    with socket.socket() as sonda:
        sonda.bind(("127.0.0.1", 0))
        porta = sonda.getsockname()[1]
    servidor = uvicorn.Server(
        uvicorn.Config(
            criar_app(), host="127.0.0.1", port=porta, log_level="warning", timeout_graceful_shutdown=2
        )
    )
    fio = threading.Thread(target=servidor.run, daemon=True)
    fio.start()
    for _ in range(200):
        if servidor.started:
            break
        time.sleep(0.05)
    else:
        pytest.skip("o servidor de teste nao subiu")
    yield f"http://127.0.0.1:{porta}"
    servidor.should_exit = True
    fio.join(timeout=10)


@pytest.fixture(scope="module")
def navegador():
    sync_api = pytest.importorskip("playwright.sync_api")
    with sync_api.sync_playwright() as playwright:
        opcoes = {"executable_path": str(CHROMIUM)} if CHROMIUM.exists() else {}
        try:
            chromium = playwright.chromium.launch(**opcoes)
        except Exception as exc:  # navegador nao instalado
            pytest.skip(f"sem Chromium para os testes da pagina: {exc}")
        yield chromium
        chromium.close()


@pytest.fixture
def abrir_simulador(servidor_vivo, navegador, cabecalho_atendente):
    """Abre o /simulador ja logado, com as preferencias dadas no localStorage."""
    contextos = []

    def abrir(preferencias: dict | None = None, largura=1280, altura=900):
        contexto = navegador.new_context(viewport={"width": largura, "height": altura})
        contextos.append(contexto)
        pagina = contexto.new_page()
        pagina.goto(f"{servidor_vivo}/simulador")
        token = cabecalho_atendente["Authorization"].removeprefix("Bearer ")
        pagina.evaluate(
            "([token, preferencias]) => {"
            " localStorage.setItem('omni_token', token);"
            " if (preferencias) localStorage.setItem('omni_simulador', JSON.stringify(preferencias));"
            "}",
            [token, preferencias],
        )
        pagina.reload()
        pagina.locator("#app").wait_for()
        pagina.locator("#ao-vivo.ligado").wait_for()  # respostas ao vivo ja chegam
        return pagina

    yield abrir
    for contexto in contextos:
        contexto.close()


def test_pagina_ignora_canal_salvo_de_outro_tipo(abrir_simulador, canal_whatsapp, canal_telegram):
    # o id salvo e de um Telegram: um canal apagado cujo id o SQLite
    # reaproveitou, ou a preferencia de outro banco na mesma origem
    pagina = abrir_simulador({"personaId": "ian", "canalPorPersona": {"ian": canal_telegram.id}})
    assert pagina.locator("#celular").get_attribute("data-tipo") == "whatsapp"
    assert pagina.locator("#canais .canal.ativo").inner_text().startswith("WhatsApp Suporte")

    pagina.locator("#texto").fill("sou o Ian do WhatsApp")
    pagina.locator("#texto").press("Enter")
    pagina.locator(".msg.minha").wait_for()
    with SessaoLocal() as sessao:
        identidades = {(i.canal_tipo, i.identificador) for i in sessao.query(ContatoIdentidade)}
        assert identidades == {("whatsapp", "5500912345678")}


def test_novo_cliente_nao_reaproveita_identificador_de_outro_tipo(
    abrir_simulador, canal_whatsapp, canal_telegram
):
    pagina = abrir_simulador({
        "personaId": "novo",
        "canalPorPersona": {"novo": canal_telegram.id},
        # digitado quando o canal do novo cliente era um WhatsApp
        "novo": {"identificador": "5500912345678", "nome": "Cliente X", "tipo": "whatsapp"},
    })
    assert pagina.locator("#celular").get_attribute("data-tipo") == "telegram"
    assert pagina.locator("#novo-identificador").input_value() == ""
    assert pagina.locator("#texto").is_disabled()
    assert pagina.locator("#novo-nome").input_value() == "Cliente X"  # o nome vale em qualquer canal


def test_novo_cliente_leva_ao_formulario_em_tela_de_notebook(
    abrir_simulador, canal_whatsapp, canal_telegram, canal_email, canal_webchat
):
    pagina = abrir_simulador(largura=1366, altura=768)
    pagina.locator(".persona", has_text="Novo cliente").click()
    assert pagina.evaluate("document.activeElement.id") == "novo-identificador"
    botao = pagina.locator("#form-novo button[type=submit]").bounding_box()
    assert botao["y"] + botao["height"] <= 768  # "Abrir a conversa" a vista

    # e o celular aponta o caminho, para quem rolou para longe
    pagina.evaluate("window.scrollTo(0, 0)")
    pagina.locator("#conversa .tela-vazia button").click()
    assert pagina.evaluate("document.activeElement.id") == "novo-identificador"


def test_email_assunto_no_limite_nao_trava_e_cada_cartao_tem_o_seu(
    abrir_simulador, canal_email, cliente, cabecalho_atendente
):
    expect = pytest.importorskip("playwright.sync_api").expect
    pagina = abrir_simulador({"personaId": "financeiro", "canalPorPersona": {"financeiro": canal_email.id}})
    assunto, texto = pagina.locator("#assunto"), pagina.locator("#texto")

    assunto.fill("A" * 200)
    texto.fill("Primeiro e-mail")
    texto.press("Enter")
    expect(pagina.locator(".carta.minha")).to_have_count(1)
    # "Re: " + 200 passaria do limite; o campo guarda o que cabe
    assert len(assunto.input_value()) == 200
    assert assunto.input_value().startswith("Re: AAA")

    texto.fill("Segundo e-mail, respondendo a thread")
    texto.press("Enter")
    expect(pagina.locator(".carta.minha")).to_have_count(2)
    assert pagina.locator(".aviso.falha").count() == 0

    assunto.fill("Nota fiscal de agosto errada")
    texto.fill("Outra coisa: a nota de agosto saiu com CFOP errado.")
    texto.press("Enter")
    expect(pagina.locator(".carta.minha")).to_have_count(3)
    expect(pagina.locator(".carta.minha .assunto-linha").last).to_have_text("Nota fiscal de agosto errada")
    assert assunto.input_value() == "Re: Nota fiscal de agosto errada"

    # a resposta chega ao vivo com o assunto da conversa, como o e-mail real
    conversa_id = cliente.get("/api/conversas", headers=cabecalho_atendente).json()[0]["id"]
    cliente.post(
        f"/api/conversas/{conversa_id}/mensagens", headers=cabecalho_atendente, json={"conteudo": "Vou verificar."}
    )
    expect(pagina.locator(".carta.deles .assunto-linha")).to_have_text("Re: " + "A" * 200)

    # recarregada, a pagina mostra os mesmos assuntos
    pagina.reload()
    expect(pagina.locator(".carta .assunto-linha")).to_have_text(
        ["A" * 200, "Re: " + "A" * 196, "Nota fiscal de agosto errada", "Re: " + "A" * 200]
    )


def test_erro_de_validacao_diz_o_campo(abrir_simulador, canal_whatsapp):
    pagina = abrir_simulador()
    # o servidor recusa com a lista do pydantic, nao com uma frase
    erro = pagina.evaluate(
        "(canal) => api('POST', '/api/simulador/mensagens',"
        " {canal_id: canal, identificador: '5500912345678', conteudo: '   '}).catch((e) => e.message)",
        canal_whatsapp.id,
    )
    assert erro == "mensagem: preencha este campo"
    erro = pagina.evaluate(
        "(canal) => api('POST', '/api/simulador/mensagens',"
        " {canal_id: canal, identificador: '5500912345678', conteudo: 'oi', assunto: 'A'.repeat(999)})"
        ".catch((e) => e.message)",
        canal_whatsapp.id,
    )
    assert erro == "assunto: no máximo 998 caracteres"


def test_personas_de_email_usam_dominio_reservado():
    # se o canal ganhar SMTP depois, a resposta a uma conversa de teste nao
    # pode chegar a caixa de alguem de verdade
    fonte = SIMULADOR_JS.read_text(encoding="utf-8")
    enderecos = re.findall(r'"([\w.+-]+@[\w.-]+)"', fonte)
    assert enderecos, "o simulador deixou de ter persona de e-mail?"
    for endereco in enderecos:
        dominio = endereco.rsplit("@", 1)[1]
        assert dominio.endswith(".example") or dominio in {"example.com", "example.net", "example.org"}, endereco

"""Simulador de clientes (app/api/simulador.py e php/app/Simulador/Rotas.php).

O atendente escreve "como cliente" pelo WhatsApp, Telegram ou e-mail; a
mensagem entra pelo adaptador do canal, como um webhook de verdade. Só com
o sandbox ligado (o conftest sobe os dois servidores assim) e só em canal
sem credencial de provedor: a resposta iria para um número inventado.
"""
from __future__ import annotations

import random

import pytest

from utilitarios import criar_canal, data_com_fuso, exigir_rota, unico

CAMPOS_VISTA = {
    "id", "conversa_id", "contato_id", "direcao", "tipo", "conteudo", "status", "erro",
    "atendente_id", "autor", "anexos", "criada_em", "assunto", "assunto_conversa",
}


def numero_novo() -> str:
    return "55009" + "".join(random.choices("0123456789", k=8))


def escrever(cliente, cabecalho, canal: dict, identificador: str, conteudo: str = "oi", **extra):
    return exigir_rota(
        cliente.post(
            "/api/simulador/mensagens",
            headers=cabecalho,
            json={"canal_id": canal["id"], "identificador": identificador, "conteudo": conteudo, **extra},
        ),
        "POST /api/simulador/mensagens",
    )


def historico(cliente, cabecalho, canal: dict, identificador: str) -> dict:
    resposta = exigir_rota(
        cliente.get(
            "/api/simulador/conversa",
            headers=cabecalho,
            params={"canal_id": canal["id"], "identificador": identificador},
        ),
        "GET /api/simulador/conversa",
    )
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


def situacoes(cliente, cabecalho) -> dict[int, dict]:
    resposta = exigir_rota(cliente.get("/api/simulador/canais", headers=cabecalho), "GET /api/simulador/canais")
    assert resposta.status_code == 200, resposta.text
    return {c["id"]: c for c in resposta.json()}


# ----------------------------------------------------------------- canais
def test_lista_canais_ativos_com_disponibilidade(cliente, cabecalho_admin, cabecalho_atendente, canal_whatsapp, canal_webchat):
    real = criar_canal(cliente, cabecalho_admin, "telegram", credenciais={"token": "123:ABC"})
    desligado = criar_canal(cliente, cabecalho_admin, "email")
    cliente.patch(f"/api/canais/{desligado['id']}", json={"ativo": False}, headers=cabecalho_admin)

    por_id = situacoes(cliente, cabecalho_atendente)
    assert desligado["id"] not in por_id
    zap = por_id[canal_whatsapp["id"]]
    assert set(zap) == {"id", "nome", "tipo", "disponivel", "motivo", "link"}
    assert zap["disponivel"] is True and zap["motivo"] is None and zap["link"] is None

    webchat = por_id[canal_webchat["id"]]
    link = f"/widget/demo?chave={canal_webchat['chave_publica']}"
    assert webchat["disponivel"] is False
    assert webchat["link"] == link and link in webchat["motivo"]

    assert por_id[real["id"]]["disponivel"] is False
    assert "provedor real" in por_id[real["id"]]["motivo"]


def test_exige_atendente(cliente, canal_whatsapp):
    assert exigir_rota(cliente.get("/api/simulador/canais"), "GET /api/simulador/canais").status_code == 401
    assert escrever(cliente, {}, canal_whatsapp, numero_novo()).status_code == 401
    assert escrever(cliente, {"Authorization": "Bearer inventado"}, canal_whatsapp, numero_novo()).status_code == 401


# ---------------------------------------------------------------- entrada
def test_whatsapp_entra_pelo_adaptador_e_cai_na_caixa(cliente, cabecalho_atendente, canal_whatsapp):
    numero = numero_novo()
    formatado = f"+{numero[:2]} ({numero[2:4]}) {numero[4:9]}-{numero[9:]}"
    resposta = escrever(cliente, cabecalho_atendente, canal_whatsapp, formatado, "Bom dia! O DIFAL está certo?", nome="Ian Dantas")
    assert resposta.status_code == 201, resposta.text
    corpo = resposta.json()
    assert set(corpo) >= CAMPOS_VISTA
    assert corpo["direcao"] == "entrada" and corpo["status"] == "recebida"
    assert corpo["conteudo"] == "Bom dia! O DIFAL está certo?"
    assert corpo["autor"] == "Ian Dantas"
    assert corpo["assunto"] is None and corpo["assunto_conversa"] is None  # só o e-mail tem assunto
    data_com_fuso(corpo["criada_em"])

    [conversa] = cliente.get("/api/conversas", params={"canal_id": canal_whatsapp["id"]}, headers=cabecalho_atendente).json()
    assert conversa["contato"]["nome"] == "Ian Dantas"
    assert conversa["contato"]["telefone"] == numero
    assert [(i["canal_tipo"], i["identificador"]) for i in conversa["contato"]["identidades"]] == [("whatsapp", numero)]

    # o mesmo número escrito de outro jeito é o mesmo cliente, na mesma conversa
    outra = escrever(cliente, cabecalho_atendente, canal_whatsapp, numero, "mais uma")
    assert outra.json()["conversa_id"] == corpo["conversa_id"]


def test_telegram_privado_e_grupo(cliente, cabecalho_atendente, canal_telegram):
    chat = str(random.randint(10_000, 99_999_999))
    privado = escrever(cliente, cabecalho_atendente, canal_telegram, f" {chat} ", "Consigo cadastrar a UF?", nome="Marcos Contabilidade")
    assert privado.status_code == 201, privado.text
    grupo = escrever(cliente, cabecalho_atendente, canal_telegram, f"-100{chat}", "oi do grupo", nome="Contadores")
    assert grupo.status_code == 201, grupo.text

    conversas = cliente.get("/api/conversas", params={"canal_id": canal_telegram["id"]}, headers=cabecalho_atendente).json()
    identidades = {c["contato"]["identidades"][0]["identificador"]: c["contato"]["nome"] for c in conversas}
    assert identidades == {chat: "Marcos Contabilidade", f"-100{chat}": "Contadores"}


def test_email_com_nome_estranho_e_assunto(cliente, cabecalho_atendente, canal_email):
    usuario = unico("financeiro")
    resposta = escrever(
        cliente, cabecalho_atendente, canal_email, f"{usuario}@Loja.EXAMPLE", "Preciso da segunda via.",
        nome='Financeiro, Loja "Exemplo"', assunto="Segunda via do boleto",
    )
    assert resposta.status_code == 201, resposta.text
    corpo = resposta.json()
    assert corpo["assunto"] == "Segunda via do boleto"
    assert corpo["assunto_conversa"] == "Segunda via do boleto"
    assert corpo["autor"] == 'Financeiro, Loja "Exemplo"'  # vírgula e aspas sobrevivem ao From

    vista = historico(cliente, cabecalho_atendente, canal_email, f"{usuario}@loja.example")
    assert vista["contato_id"] == corpo["contato_id"]


def test_email_cada_mensagem_com_o_seu_assunto(cliente, cabecalho_atendente, canal_email):
    endereco = f"{unico('compras')}@loja.example"
    primeira = escrever(cliente, cabecalho_atendente, canal_email, endereco, "Preciso da segunda via.", assunto="Segunda via do boleto").json()
    segunda = escrever(
        cliente, cabecalho_atendente, canal_email, endereco, "A nota de agosto saiu errada.", assunto="Nota fiscal de agosto"
    ).json()
    assert segunda["conversa_id"] == primeira["conversa_id"]
    assert segunda["assunto"] == "Nota fiscal de agosto"
    assert segunda["assunto_conversa"] == "Segunda via do boleto"

    cliente.post(f"/api/conversas/{primeira['conversa_id']}/mensagens", json={"conteudo": "Segue a segunda via."}, headers=cabecalho_atendente)
    vista = historico(cliente, cabecalho_atendente, canal_email, endereco)
    assert [(m["direcao"], m["assunto"]) for m in vista["mensagens"]] == [
        ("entrada", "Segunda via do boleto"),
        ("entrada", "Nota fiscal de agosto"),
        ("saida", "Re: Segunda via do boleto"),  # como o adaptador de e-mail responde
    ]
    assert {m["assunto_conversa"] for m in vista["mensagens"]} == {"Segunda via do boleto"}


def test_email_sem_assunto_e_assunto_longo(cliente, cabecalho_atendente, canal_email):
    endereco = f"{unico('sem')}@loja.example"
    sem = escrever(cliente, cabecalho_atendente, canal_email, endereco, "oi").json()
    assert sem["assunto"] is None
    cliente.post(f"/api/conversas/{sem['conversa_id']}/mensagens", json={"conteudo": "Olá"}, headers=cabecalho_atendente)
    assert historico(cliente, cabecalho_atendente, canal_email, endereco)["mensagens"][-1]["assunto"] == "Re: Atendimento"

    longo = escrever(cliente, cabecalho_atendente, canal_email, f"{unico('longo')}@loja.example", "x", assunto="Pedido " + "A" * 300)
    assert longo.status_code == 201
    assert len(longo.json()["assunto"]) == 200  # o que cabe na conversa
    grande = escrever(cliente, cabecalho_atendente, canal_email, f"{unico('g')}@loja.example", "x", assunto="A" * 999)
    assert grande.status_code == 422


# ----------------------------------------------------- o que o cliente vê
def test_historico_tem_a_resposta_e_nao_tem_nota(cliente, cabecalho_atendente, canal_whatsapp):
    numero = numero_novo()
    assert historico(cliente, cabecalho_atendente, canal_whatsapp, numero) == {"contato_id": None, "mensagens": []}
    enviada = escrever(cliente, cabecalho_atendente, canal_whatsapp, numero, "Bom dia!").json()
    conversa_id = enviada["conversa_id"]
    cliente.post(f"/api/conversas/{conversa_id}/notas", json={"conteudo": "cliente antigo"}, headers=cabecalho_atendente)
    resposta = cliente.post(f"/api/conversas/{conversa_id}/mensagens", json={"conteudo": "Bom dia, Ian!"}, headers=cabecalho_atendente)
    assert resposta.json()["status"] == "simulada"  # sandbox: não sai para provedor nenhum

    vista = historico(cliente, cabecalho_atendente, canal_whatsapp, numero)
    assert vista["contato_id"] == enviada["contato_id"]
    assert [(m["direcao"], m["conteudo"]) for m in vista["mensagens"]] == [("entrada", "Bom dia!"), ("saida", "Bom dia, Ian!")]
    saida = vista["mensagens"][1]
    assert saida["atendente_id"] is not None and saida["autor"]
    # quem respondeu, para o simulador mostrar como o canal mostraria
    if "assinatura" in saida:
        assert saida["assinatura"]["nome"] == saida["autor"]


def test_historico_fica_no_canal_pedido(cliente, cabecalho_admin, cabecalho_atendente, canal_whatsapp):
    outro = criar_canal(cliente, cabecalho_admin, "whatsapp")
    numero = numero_novo()
    escrever(cliente, cabecalho_atendente, canal_whatsapp, numero, "no suporte")
    escrever(cliente, cabecalho_atendente, outro, numero, "em vendas")
    assert [m["conteudo"] for m in historico(cliente, cabecalho_atendente, outro, numero)["mensagens"]] == ["em vendas"]


# ----------------------------------------------------------------- recusas
def test_recusa_canal_ligado_a_provedor(cliente, cabecalho_admin, cabecalho_atendente):
    real = criar_canal(cliente, cabecalho_admin, "whatsapp", credenciais={"token": "EAAG", "id_numero": "123"})
    resposta = escrever(cliente, cabecalho_atendente, real, numero_novo())
    assert resposta.status_code == 409
    assert "provedor real" in resposta.json()["detail"]
    # só com credencial de recebimento (IMAP) também: ela traz clientes reais
    caixa = criar_canal(
        cliente, cabecalho_admin, "email",
        credenciais={"imap_host": "imap.empresa.example", "imap_usuario": "suporte", "imap_senha": "x"},
    )
    assert situacoes(cliente, cabecalho_atendente)[caixa["id"]]["disponivel"] is False
    assert escrever(cliente, cabecalho_atendente, caixa, "joao@cliente.example").status_code == 409


def test_ajuste_sem_credencial_continua_simulavel(cliente, cabecalho_admin, cabecalho_atendente):
    canal = criar_canal(cliente, cabecalho_admin, "telegram", credenciais={"modo_recebimento": "webhook"})
    assert situacoes(cliente, cabecalho_atendente)[canal["id"]]["disponivel"] is True
    assert escrever(cliente, cabecalho_atendente, canal, str(random.randint(10_000, 99_999))).status_code == 201


def test_recusa_canal_inexistente_desativado_ou_webchat(cliente, cabecalho_admin, cabecalho_atendente, canal_webchat):
    fantasma = escrever(cliente, cabecalho_atendente, {"id": 999999}, numero_novo())
    assert fantasma.status_code == 404
    assert fantasma.json() == {"detail": "canal nao encontrado ou desativado"}

    desligado = criar_canal(cliente, cabecalho_admin, "whatsapp")
    cliente.patch(f"/api/canais/{desligado['id']}", json={"ativo": False}, headers=cabecalho_admin)
    assert escrever(cliente, cabecalho_atendente, desligado, numero_novo()).status_code == 404

    webchat = escrever(cliente, cabecalho_atendente, canal_webchat, "visitante")
    assert webchat.status_code == 422
    assert "/widget/demo?chave=" in webchat.json()["detail"]


@pytest.mark.parametrize(
    "tipo, identificador, frase",
    [
        ("whatsapp", "123456", "numero de WhatsApp invalido"),
        ("whatsapp", "5500912345678000", "numero de WhatsApp invalido"),
        ("whatsapp", "ian dantas", "numero de WhatsApp invalido"),
        ("telegram", "@marcos", "id do Telegram invalido"),
        ("telegram", "88a12", "id do Telegram invalido"),
        ("telegram", "0", "id do Telegram invalido"),
        ("email", "financeiro-sem-arroba", "endereco de e-mail invalido"),
    ],
)
def test_recusa_identificador_invalido(cliente, cabecalho_admin, cabecalho_atendente, tipo, identificador, frase):
    canal = criar_canal(cliente, cabecalho_admin, tipo)
    resposta = escrever(cliente, cabecalho_atendente, canal, identificador)
    assert resposta.status_code == 422, resposta.text
    assert isinstance(resposta.json()["detail"], str) and frase in resposta.json()["detail"]
    consulta = cliente.get(
        "/api/simulador/conversa", headers=cabecalho_atendente, params={"canal_id": canal["id"], "identificador": identificador}
    )
    assert consulta.status_code == 422


def test_recusa_corpo_invalido(cliente, cabecalho_atendente, canal_whatsapp):
    assert escrever(cliente, cabecalho_atendente, canal_whatsapp, numero_novo(), "   ").status_code == 422
    assert escrever(cliente, cabecalho_atendente, canal_whatsapp, numero_novo(), "x" * 8001).status_code == 422
    assert escrever(cliente, cabecalho_atendente, canal_whatsapp, "").status_code == 422
    assert escrever(cliente, cabecalho_atendente, canal_whatsapp, numero_novo(), nome="x" * 161).status_code == 422
    sem_canal = cliente.post("/api/simulador/mensagens", headers=cabecalho_atendente, json={"identificador": "1", "conteudo": "oi"})
    assert sem_canal.status_code == 422
    consulta = cliente.get("/api/simulador/conversa", headers=cabecalho_atendente, params={"canal_id": canal_whatsapp["id"]})
    assert consulta.status_code == 422


def test_resposta_a_cliente_simulado_nunca_sai_pelo_provedor(cliente, cabecalho_admin, cabecalho_atendente, provedor):
    """Canal que ganhou credencial depois: o número inventado pode ser de alguém."""
    canal = criar_canal(cliente, cabecalho_admin, "whatsapp")
    simulada = escrever(cliente, cabecalho_atendente, canal, numero_novo(), "oi").json()
    cliente.patch(
        f"/api/canais/{canal['id']}", json={"credenciais": {"token": "tk", "id_numero": "1"}}, headers=cabecalho_admin
    )
    provedor.roteirar("graph.facebook.com", json={"messages": [{"id": "wamid.X"}]})
    resposta = cliente.post(
        f"/api/conversas/{simulada['conversa_id']}/mensagens", json={"conteudo": "Olá"}, headers=cabecalho_atendente
    )
    assert resposta.status_code == 201
    assert resposta.json()["status"] == "simulada"
    assert [c for c in provedor.chamadas() if "graph.facebook.com" in c["url"]] == []

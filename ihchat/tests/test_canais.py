"""Tela de canais: campos por tipo, credenciais sem segredo, teste de conexão."""
import hashlib
import hmac
import imaplib
import json
import os
import smtplib
import socket
import ssl
import threading
import time
from pathlib import Path

import httpx
import pytest
from conftest import TOKEN_EMAIL, criar_canal, payload_whatsapp

from app.canais import http as canal_http
from app.canais.base import ErroCanal
from app.canais.email import AdaptadorEmail
from app.db import SessaoLocal
from app.main import criar_app
from app.models import Canal, Conversa, Mensagem, TipoCanal

WHATSAPP_COMPLETO = {
    "token": "EAAG-token-secreto",
    "id_numero": "10987654321",
    "token_verificacao": "palavra-combinada",
    "segredo_app": "app-secret-da-meta",
}

EMAIL_COMPLETO = {
    "remetente": "Suporte <suporte@empresa.com.br>",
    "smtp_host": "smtp.empresa.com.br",
    "smtp_porta": "587",
    "smtp_usuario": "suporte@empresa.com.br",
    "smtp_senha": "senha-smtp-secreta",
    "imap_host": "imap.empresa.com.br",
}


def transporte(handler):
    canal_http.definir_transporte(httpx.MockTransport(handler))


def criar_pela_api(cliente, cabecalho, tipo: str, credenciais: dict | None = None, nome="Canal") -> dict:
    resposta = cliente.post(
        "/api/canais",
        json={"nome": nome, "tipo": tipo, "credenciais": credenciais or {}},
        headers=cabecalho,
    )
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


def credenciais_gravadas(canal_id: int) -> dict:
    with SessaoLocal() as sessao:
        return dict(sessao.get(Canal, canal_id).credenciais or {})


def pedir_teste(cliente, cabecalho, canal_id: int) -> dict:
    resposta = cliente.post(f"/api/canais/{canal_id}/testar", headers=cabecalho)
    # sempre 200: credencial errada é o resultado do teste, não erro da requisição
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


# ---------------------------------------------------------------------- tipos
def test_tipos_trazem_os_campos_de_cada_canal(cliente, cabecalho_atendente):
    resposta = cliente.get("/api/canais/tipos", headers=cabecalho_atendente)
    assert resposta.status_code == 200
    tipos = resposta.json()

    assert set(tipos) == {"whatsapp", "telegram", "email", "webchat"}
    whatsapp = {c["chave"]: c for c in tipos["whatsapp"]}
    assert whatsapp["token"]["secreto"] and whatsapp["token"]["obrigatorio"]
    assert whatsapp["segredo_app"]["secreto"] and not whatsapp["segredo_app"]["obrigatorio"]
    assert not whatsapp["id_numero"]["secreto"] and whatsapp["id_numero"]["ajuda"]
    modo = next(c for c in tipos["telegram"] if c["chave"] == "modo_recebimento")
    assert modo["opcoes"] == ["polling", "webhook"] and modo["padrao"] == "polling"
    assert tipos["webchat"] == []
    # a tela marca a senha como obrigatória quando um destes muda
    email = {c["chave"]: c for c in tipos["email"]}
    assert email["smtp_senha"]["destinos"] == ["smtp_host", "smtp_porta", "smtp_usuario"]
    assert email["imap_senha"]["destinos"] == ["imap_host", "imap_porta", "imap_usuario"]
    assert email["smtp_host"]["destinos"] == [] and whatsapp["token"]["destinos"] == []


def test_tipos_exigem_login(cliente):
    assert cliente.get("/api/canais/tipos").status_code == 401


# ----------------------------------------------------------------- credenciais
def test_credenciais_nunca_devolvem_o_valor_de_um_segredo(cliente, cabecalho_admin):
    whatsapp = criar_pela_api(cliente, cabecalho_admin, "whatsapp", WHATSAPP_COMPLETO)
    email = criar_pela_api(
        cliente, cabecalho_admin, "email", {**EMAIL_COMPLETO, "imap_senha": "senha-imap-secreta"}
    )

    resposta = cliente.get(f"/api/canais/{whatsapp['id']}/credenciais", headers=cabecalho_admin)
    assert resposta.status_code == 200
    dados = resposta.json()
    assert dados["credenciais"] == {"id_numero": "10987654321", "token_verificacao": "palavra-combinada"}
    assert set(dados["secretos_definidos"]) == {"token", "segredo_app"}
    assert "EAAG-token-secreto" not in resposta.text and "app-secret-da-meta" not in resposta.text

    resposta = cliente.get(f"/api/canais/{email['id']}/credenciais", headers=cabecalho_admin)
    dados = resposta.json()
    assert "smtp_senha" not in dados["credenciais"] and dados["credenciais"]["smtp_host"] == "smtp.empresa.com.br"
    assert set(dados["secretos_definidos"]) == {"smtp_senha", "imap_senha"}
    assert "senha-smtp-secreta" not in resposta.text and "senha-imap-secreta" not in resposta.text


def test_chave_fora_do_contrato_com_cara_de_senha_tambem_fica_escondida(cliente, cabecalho_admin):
    # canal cadastrado à mão, antes da tela existir
    canal = criar_canal(
        TipoCanal.EMAIL, "Legado", credenciais={"api_password": "p4ss", "imap_pasta": "Suporte"}
    )
    dados = cliente.get(f"/api/canais/{canal.id}/credenciais", headers=cabecalho_admin).json()
    assert dados["credenciais"] == {"imap_pasta": "Suporte"}
    assert dados["secretos_definidos"] == ["api_password"]


def test_patch_com_segredo_em_branco_ou_ausente_mantem_o_atual(cliente, cabecalho_admin):
    canal = criar_pela_api(cliente, cabecalho_admin, "whatsapp", WHATSAPP_COMPLETO)

    # é o que a tela manda ao salvar sem mexer no token: ele nunca volta a ela
    resposta = cliente.patch(
        f"/api/canais/{canal['id']}",
        json={"credenciais": {"token": "", "segredo_app": None, "id_numero": "222"}},
        headers=cabecalho_admin,
    )
    assert resposta.status_code == 200
    gravadas = credenciais_gravadas(canal["id"])
    assert gravadas["token"] == "EAAG-token-secreto"
    assert gravadas["segredo_app"] == "app-secret-da-meta"
    assert gravadas["id_numero"] == "222"

    cliente.patch(f"/api/canais/{canal['id']}", json={"credenciais": {"token": "  novo-token\n"}}, headers=cabecalho_admin)
    gravadas = credenciais_gravadas(canal["id"])
    assert gravadas["token"] == "novo-token"  # colado com espaço e quebra de linha
    assert gravadas["segredo_app"] == "app-secret-da-meta"


def test_patch_com_campo_comum_em_branco_limpa_o_campo(cliente, cabecalho_admin):
    canal = criar_pela_api(cliente, cabecalho_admin, "email", EMAIL_COMPLETO)

    cliente.patch(
        f"/api/canais/{canal['id']}",
        json={"credenciais": {"imap_host": "", "smtp_senha": ""}},
        headers=cabecalho_admin,
    )
    gravadas = credenciais_gravadas(canal["id"])
    assert "imap_host" not in gravadas
    assert gravadas["smtp_senha"] == "senha-smtp-secreta"


def test_patch_troca_nome_e_desativa(cliente, cabecalho_admin):
    canal = criar_pela_api(cliente, cabecalho_admin, "telegram")
    resposta = cliente.patch(
        f"/api/canais/{canal['id']}", json={"nome": "Bot da loja", "ativo": False}, headers=cabecalho_admin
    )
    assert resposta.json()["nome"] == "Bot da loja" and resposta.json()["ativo"] is False
    assert cliente.patch(f"/api/canais/{canal['id']}", json={"nome": ""}, headers=cabecalho_admin).status_code == 422


@pytest.mark.parametrize("nome", ["", "   ", " x ", "x" * 121])
def test_nome_e_medido_depois_de_aparado_e_o_erro_sai_em_portugues(cliente, cabecalho_admin, nome):
    canal = criar_pela_api(cliente, cabecalho_admin, "telegram", nome="Bot da loja")
    for resposta in (
        cliente.patch(f"/api/canais/{canal['id']}", json={"nome": nome}, headers=cabecalho_admin),
        cliente.post("/api/canais", json={"nome": nome, "tipo": "webchat"}, headers=cabecalho_admin),
    ):
        assert resposta.status_code == 422
        # o painel mostra a frase como vem: nada de "String should have at least"
        assert resposta.json()["detail"][0]["msg"] == (
            "o nome do canal precisa ter de 2 a 120 caracteres (espaços não contam)"
        )
    with SessaoLocal() as sessao:
        assert [c.nome for c in sessao.query(Canal)] == ["Bot da loja"]


def test_nome_chega_aparado_na_criacao_e_na_edicao(cliente, cabecalho_admin):
    canal = criar_pela_api(cliente, cabecalho_admin, "webchat", nome="  Chat do site  ")
    assert canal["nome"] == "Chat do site"
    resposta = cliente.patch(f"/api/canais/{canal['id']}", json={"nome": "  Chat novo "}, headers=cabecalho_admin)
    assert resposta.json()["nome"] == "Chat novo"


# ------------------------------------------------- senha e servidor de destino
def test_trocar_o_servidor_smtp_exige_digitar_a_senha_de_novo(cliente, cabecalho_admin):
    # sem isto: PATCH só no host, depois /testar, e a senha guardada ia parar
    # no servidor de quem editou, contornando o /credenciais que nunca a mostra
    canal = criar_pela_api(cliente, cabecalho_admin, "email", EMAIL_COMPLETO)
    url = f"/api/canais/{canal['id']}"

    for troca in ({"smtp_host": "smtp.atacante.invalid"}, {"smtp_porta": "2525"}, {"smtp_usuario": "outro"}):
        resposta = cliente.patch(url, json={"credenciais": {**troca, "smtp_senha": ""}}, headers=cabecalho_admin)
        assert resposta.status_code == 422, troca
        assert "digite de novo a Senha SMTP" in resposta.json()["detail"]
    assert credenciais_gravadas(canal["id"]) == EMAIL_COMPLETO  # nada gravado pela metade

    resposta = cliente.patch(
        url, json={"credenciais": {"smtp_host": "smtp.novo.com.br", "smtp_senha": "senha-nova"}}, headers=cabecalho_admin
    )
    assert resposta.status_code == 200
    assert credenciais_gravadas(canal["id"])["smtp_host"] == "smtp.novo.com.br"
    # mudar outra coisa (o remetente) continua sem pedir a senha
    assert cliente.patch(url, json={"credenciais": {"remetente": "a@b.com"}}, headers=cabecalho_admin).status_code == 200


def test_ligar_o_imap_com_a_senha_do_smtp_guardada_exige_uma_senha(cliente, cabecalho_admin):
    # sem imap_senha, o IMAP entra com a do SMTP: um imap_host novo a levaria junto
    credenciais = dict(EMAIL_COMPLETO)
    credenciais.pop("imap_host")
    canal = criar_pela_api(cliente, cabecalho_admin, "email", credenciais)
    url = f"/api/canais/{canal['id']}"

    resposta = cliente.patch(url, json={"credenciais": {"imap_host": "imap.atacante.invalid"}}, headers=cabecalho_admin)
    assert resposta.status_code == 422 and "Senha IMAP" in resposta.json()["detail"]
    assert "imap_host" not in credenciais_gravadas(canal["id"])

    # a senha do IMAP digitada agora, ou a do SMTP redigitada, resolvem
    corpo = {"credenciais": {"imap_host": "imap.empresa.com.br", "imap_senha": "senha-imap"}}
    assert cliente.patch(url, json=corpo, headers=cabecalho_admin).status_code == 200
    corpo = {"credenciais": {"imap_host": "imap2.empresa.com.br", "imap_senha": ""}}
    assert cliente.patch(url, json=corpo, headers=cabecalho_admin).status_code == 422
    # tirar o IMAP não manda senha a lugar nenhum
    assert cliente.patch(url, json={"credenciais": {"imap_host": ""}}, headers=cabecalho_admin).status_code == 200


def test_servidor_trocado_sem_senha_guardada_nao_pede_nada(cliente, cabecalho_admin):
    canal = criar_pela_api(cliente, cabecalho_admin, "email", {"smtp_host": "smtp.a.com"})
    resposta = cliente.patch(
        f"/api/canais/{canal['id']}", json={"credenciais": {"smtp_host": "smtp.b.com"}}, headers=cabecalho_admin
    )
    assert resposta.status_code == 200


# ------------------------------------------------------------ apagar segredo
def test_limpar_apaga_o_segredo_e_devolve_o_canal_ao_sandbox(cliente, cabecalho_admin):
    # token de teste colado num canal de demonstração: em branco = manter, então
    # sem `limpar` o canal nunca mais voltava ao sandbox (nem podia ser removido)
    canal = criar_pela_api(cliente, cabecalho_admin, "telegram", {"token": "123:teste"})
    assert canal["configurado"] is True
    url = f"/api/canais/{canal['id']}"

    for corpo in ({"credenciais": {"token": ""}}, {"credenciais": {"token": None}}):
        assert cliente.patch(url, json=corpo, headers=cabecalho_admin).json()["configurado"] is True

    resposta = cliente.patch(url, json={"limpar": ["token"]}, headers=cabecalho_admin)
    assert resposta.status_code == 200 and resposta.json()["configurado"] is False
    # sobra só o modo de recebimento, gravado com o padrão da instalação
    assert credenciais_gravadas(canal["id"]) == {"modo_recebimento": "polling"}
    dados = cliente.get(f"{url}/credenciais", headers=cabecalho_admin).json()
    assert dados["secretos_definidos"] == []


def test_limpar_e_valor_novo_no_mesmo_pedido(cliente, cabecalho_admin):
    canal = criar_pela_api(cliente, cabecalho_admin, "email", {**EMAIL_COMPLETO, "imap_senha": "senha-imap"})
    cliente.patch(
        f"/api/canais/{canal['id']}",
        json={"limpar": ["imap_senha"], "credenciais": {"smtp_senha": "trocada"}},
        headers=cabecalho_admin,
    )
    gravadas = credenciais_gravadas(canal["id"])
    assert "imap_senha" not in gravadas and gravadas["smtp_senha"] == "trocada"


def test_atendente_comum_nao_apaga_segredo(cliente, cabecalho_atendente, canal_telegram):
    resposta = cliente.patch(
        f"/api/canais/{canal_telegram.id}", json={"limpar": ["token"]}, headers=cabecalho_atendente
    )
    assert resposta.status_code == 403


# ----------------------------------------------------------------- segredos
def test_criar_whatsapp_nao_gera_segredo_de_webhook(cliente, cabecalho_admin):
    whatsapp = criar_pela_api(cliente, cabecalho_admin, "whatsapp", nome="WA")
    telegram = criar_pela_api(cliente, cabecalho_admin, "telegram", nome="TG")
    webchat = criar_pela_api(cliente, cabecalho_admin, "webchat", nome="Chat")

    with SessaoLocal() as sessao:
        # a Meta assina com o App Secret dela: um segredo nosso recusaria tudo
        assert sessao.get(Canal, whatsapp["id"]).segredo_webhook is None
        # o do Telegram vai no secret_token do setWebhook
        assert sessao.get(Canal, telegram["id"]).segredo_webhook
        assert sessao.get(Canal, webchat["id"]).chave_publica.startswith("wc_")

    dados = cliente.get(f"/api/canais/{telegram['id']}/credenciais", headers=cabecalho_admin).json()
    assert dados["segredo_webhook"]


def test_seed_nao_gera_segredo_para_o_whatsapp(capsys):
    from scripts.seed import semear

    semear()
    with SessaoLocal() as sessao:
        canais = {c.tipo: c for c in sessao.query(Canal)}
    assert canais["whatsapp"].segredo_webhook is None
    assert canais["telegram"].segredo_webhook


def _assinar(segredo: str, corpo: bytes) -> dict:
    assinatura = hmac.new(segredo.encode(), corpo, hashlib.sha256).hexdigest()
    return {"content-type": "application/json", "x-hub-signature-256": f"sha256={assinatura}"}


def test_webhook_do_whatsapp_confere_a_assinatura_com_o_segredo_app(cliente, cabecalho_admin):
    canal = criar_pela_api(cliente, cabecalho_admin, "whatsapp", WHATSAPP_COMPLETO)
    corpo = json.dumps(payload_whatsapp("5511988887777", "olá", "wamid.app")).encode()
    url = f"/webhooks/{canal['id']}"

    sem_assinatura = cliente.post(url, content=corpo, headers={"content-type": "application/json"})
    assert sem_assinatura.status_code == 401
    assert cliente.post(url, content=corpo, headers=_assinar("outro-segredo", corpo)).status_code == 401

    aceito = cliente.post(url, content=corpo, headers=_assinar("app-secret-da-meta", corpo))
    assert aceito.status_code == 200 and aceito.json()["recebidas"] == 1


def test_segredo_app_vale_mais_que_o_segredo_legado(cliente):
    canal = criar_canal(
        TipoCanal.WHATSAPP, "WA antigo", segredo_webhook="aleatorio-antigo", credenciais={"segredo_app": "app-secret"}
    )
    corpo = json.dumps(payload_whatsapp("5511977776666", "oi", "wamid.legado")).encode()
    url = f"/webhooks/{canal.id}"
    assert cliente.post(url, content=corpo, headers=_assinar("aleatorio-antigo", corpo)).status_code == 401
    assert cliente.post(url, content=corpo, headers=_assinar("app-secret", corpo)).status_code == 200


def test_whatsapp_criado_sem_app_secret_aceita_webhook_sem_assinatura(cliente, cabecalho_admin):
    canal = criar_pela_api(cliente, cabecalho_admin, "whatsapp", {"token": "t", "id_numero": "1"})
    resposta = cliente.post(f"/webhooks/{canal['id']}", json=payload_whatsapp("5511966665555", "oi", "wamid.livre"))
    assert resposta.status_code == 200
    dados = cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho_admin).json()
    assert dados["assinatura"] == "nenhuma"


def _meta_conectada(requisicao: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"display_phone_number": "+55 11 4000-0000", "verified_name": "Loja"})


def test_testar_whatsapp_sem_app_secret_avisa_que_aceita_entrega_forjada(cliente, cabecalho_admin):
    # antes: "✓ Funcionou" em verde, e o webhook aceitava qualquer POST
    canal = criar_pela_api(cliente, cabecalho_admin, "whatsapp", {"token": "t", "id_numero": "1"})
    transporte(_meta_conectada)
    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    assert resultado["ok"] is True and resultado["mensagem"].startswith("Conectado ao número")
    assert "App Secret" in resultado["alerta"] and "forjar" in resultado["alerta"]


def test_segredo_legado_do_whatsapp_aparece_e_morre_com_o_app_secret(cliente, cabecalho_admin):
    # base semeada antes da correção: segredo aleatório que a Meta nunca viu
    canal = criar_canal(
        TipoCanal.WHATSAPP, "WA antigo", segredo_webhook="aleatorio-do-seed-antigo",
        credenciais={"token": "t", "id_numero": "1"},
    )
    corpo = json.dumps(payload_whatsapp("5511944443333", "oi", "wamid.meta")).encode()
    url_webhook = f"/webhooks/{canal.id}"

    dados = cliente.get(f"/api/canais/{canal.id}/credenciais", headers=cabecalho_admin).json()
    assert dados["assinatura"] == "legada"  # a tela avisa, sem ver o valor
    assert "aleatorio-do-seed-antigo" not in json.dumps(dados)
    transporte(_meta_conectada)
    resultado = pedir_teste(cliente, cabecalho_admin, canal.id)
    assert resultado["ok"] is True and "recusada" in resultado["alerta"]
    assert cliente.post(url_webhook, content=corpo, headers=_assinar("app-secret-real", corpo)).status_code == 401

    cliente.patch(
        f"/api/canais/{canal.id}", json={"credenciais": {"segredo_app": "app-secret-real"}}, headers=cabecalho_admin
    )
    with SessaoLocal() as sessao:
        assert sessao.get(Canal, canal.id).segredo_webhook is None
    assert cliente.get(f"/api/canais/{canal.id}/credenciais", headers=cabecalho_admin).json()["assinatura"] == "app_secret"
    assert cliente.post(url_webhook, content=corpo, headers=_assinar("app-secret-real", corpo)).status_code == 200

    # sem o legado, tirar o App Secret deixa sem assinatura, não recusando tudo
    cliente.patch(f"/api/canais/{canal.id}", json={"limpar": ["segredo_app"]}, headers=cabecalho_admin)
    assert cliente.get(f"/api/canais/{canal.id}/credenciais", headers=cabecalho_admin).json()["assinatura"] == "nenhuma"


def test_segredo_legado_do_whatsapp_pode_ser_descartado(cliente, cabecalho_admin):
    canal = criar_canal(TipoCanal.WHATSAPP, "WA antigo", segredo_webhook="aleatorio", credenciais={"token": "t"})
    cliente.patch(f"/api/canais/{canal.id}", json={"limpar": ["segredo_webhook"]}, headers=cabecalho_admin)
    with SessaoLocal() as sessao:
        assert sessao.get(Canal, canal.id).segredo_webhook is None


def test_app_secret_em_segredo_webhook_como_o_readme_ensinava_e_conferido(cliente, cabecalho_admin):
    # o README mandava "preencher segredo_webhook": via API, ele caía nas
    # credenciais e era ignorado, e a entrega forjada entrava
    canal = criar_pela_api(
        cliente, cabecalho_admin, "whatsapp", {"token": "EAAG", "id_numero": "123", "segredo_webhook": "APP_SECRET_REAL"}
    )
    corpo = json.dumps(payload_whatsapp("5511933332222", "boleto para golpe@x.com", "wamid.forjada")).encode()
    url = f"/webhooks/{canal['id']}"
    assert cliente.post(url, content=corpo, headers={"content-type": "application/json"}).status_code == 401
    assert cliente.post(url, content=corpo, headers=_assinar("outro", corpo)).status_code == 401
    assert cliente.post(url, content=corpo, headers=_assinar("APP_SECRET_REAL", corpo)).status_code == 200
    dados = cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho_admin).json()
    assert dados["assinatura"] == "app_secret" and "APP_SECRET_REAL" not in json.dumps(dados)


# ------------------------------------------------------------------ testar
def test_testar_whatsapp_conectado(cliente, cabecalho_admin):
    canal = criar_pela_api(cliente, cabecalho_admin, "whatsapp", WHATSAPP_COMPLETO)
    chamadas = []

    def meta(requisicao: httpx.Request) -> httpx.Response:
        chamadas.append(requisicao)
        return httpx.Response(
            200,
            json={"display_phone_number": "+55 00 91234-5678", "verified_name": "MultFiscal", "id": "10987654321"},
        )

    transporte(meta)
    assert pedir_teste(cliente, cabecalho_admin, canal["id"]) == {
        "ok": True,
        "mensagem": "Conectado ao número +55 00 91234-5678 (MultFiscal)",
        "alerta": None,  # com App Secret e ativo, nada a ressalvar
    }
    requisicao = chamadas[0]
    assert requisicao.method == "GET"
    assert requisicao.url.path == "/v20.0/10987654321"
    assert requisicao.url.params["fields"] == "display_phone_number,verified_name"
    assert requisicao.headers["authorization"] == "Bearer EAAG-token-secreto"


def test_testar_whatsapp_repete_o_erro_da_meta(cliente, cabecalho_admin):
    canal = criar_pela_api(cliente, cabecalho_admin, "whatsapp", WHATSAPP_COMPLETO)
    transporte(
        lambda requisicao: httpx.Response(
            401,
            json={"error": {"message": "Error validating access token: Session has expired", "code": 190}},
        )
    )
    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    assert resultado["ok"] is False
    # "token" já vem na frase da Meta: a dica é conferida por um trecho só dela
    assert "Session has expired" in resultado["mensagem"] and "token permanente" in resultado["mensagem"]
    assert "EAAG-token-secreto" not in resultado["mensagem"]


def test_testar_whatsapp_com_id_do_numero_errado_diz_onde_corrigir(cliente, cabecalho_admin):
    canal = criar_pela_api(cliente, cabecalho_admin, "whatsapp", WHATSAPP_COMPLETO)
    transporte(
        lambda requisicao: httpx.Response(
            400,
            json={"error": {"message": "Unsupported get request. Object with ID '10987654321' does not exist", "code": 100}},
        )
    )
    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    assert resultado["ok"] is False
    assert "does not exist" in resultado["mensagem"] and "Phone number ID" in resultado["mensagem"]
    assert "token permanente" not in resultado["mensagem"]


def test_testar_whatsapp_sem_rede(cliente, cabecalho_admin):
    canal = criar_pela_api(cliente, cabecalho_admin, "whatsapp", WHATSAPP_COMPLETO)

    def sem_rede(requisicao):
        raise httpx.ConnectError("sem rota para o host")

    transporte(sem_rede)
    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    assert resultado["ok"] is False and "falha de rede" in resultado["mensagem"]


def test_testar_canal_sem_credenciais_diz_o_que_falta_com_os_nomes_do_formulario(cliente, cabecalho_admin):
    whatsapp = criar_pela_api(cliente, cabecalho_admin, "whatsapp", nome="WA")
    email = criar_pela_api(cliente, cabecalho_admin, "email", {"smtp_host": "smtp.x.com"}, nome="Mail")
    telegram = criar_pela_api(cliente, cabecalho_admin, "telegram", nome="TG")

    assert pedir_teste(cliente, cabecalho_admin, whatsapp["id"]) == {
        "ok": False,
        "mensagem": "preencha: Token de acesso permanente, ID do número de telefone",
        "alerta": None,
    }
    assert pedir_teste(cliente, cabecalho_admin, email["id"])["mensagem"] == (
        "preencha: Usuário SMTP, Senha SMTP, Remetente"
    )
    assert pedir_teste(cliente, cabecalho_admin, telegram["id"])["mensagem"] == "preencha: Token do bot"


def test_testar_webchat_sempre_pronto(cliente, cabecalho_admin):
    canal = criar_pela_api(cliente, cabecalho_admin, "webchat")
    assert pedir_teste(cliente, cabecalho_admin, canal["id"])["ok"] is True


def test_testar_canal_desativado_nao_diz_so_que_funcionou(cliente, cabecalho_admin):
    webchat = criar_pela_api(cliente, cabecalho_admin, "webchat", nome="Chat")
    telegram = criar_pela_api(cliente, cabecalho_admin, "telegram", {"token": "123:abc"}, nome="TG")
    for canal in (webchat, telegram):
        cliente.patch(f"/api/canais/{canal['id']}", json={"ativo": False}, headers=cabecalho_admin)

    # sem provedor, o webchat desligado é o widget fora do ar: não há o que aprovar
    resultado = pedir_teste(cliente, cabecalho_admin, webchat["id"])
    assert resultado["ok"] is False and "desativado" in resultado["mensagem"]
    assert "sempre pronto" not in resultado["mensagem"]

    def telegram_ok(requisicao: httpx.Request) -> httpx.Response:
        if requisicao.url.path.endswith("/getMe"):
            return httpx.Response(200, json={"ok": True, "result": {"username": "bot_suporte"}})
        return httpx.Response(200, json={"ok": True, "result": {"url": ""}})

    transporte(telegram_ok)
    resultado = pedir_teste(cliente, cabecalho_admin, telegram["id"])
    # o token funciona, mas nada chega: a tela precisa mostrar as duas coisas
    assert resultado["ok"] is True and "@bot_suporte" in resultado["mensagem"]
    assert "desativado" in resultado["alerta"]


def test_testar_nunca_devolve_500(cliente, cabecalho_admin, monkeypatch):
    canal = criar_pela_api(cliente, cabecalho_admin, "webchat")

    def defeito(self):
        raise RuntimeError("bug no adaptador")

    monkeypatch.setattr("app.canais.webchat.AdaptadorWebchat.verificar_conexao", defeito)
    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    assert resultado["ok"] is False and "inesperado" in resultado["mensagem"]


# ---------------------------------------------------------- testar: e-mail
class ServidorFalso:
    """Faz o papel de smtplib.SMTP / SMTP_SSL e de imaplib.IMAP4_SSL."""

    def __init__(self, registro: list, falhar_em: str | None = None, excecao: Exception | None = None):
        self.registro = registro
        self.falhar_em = falhar_em
        self.excecao = excecao
        self.contextos: list = []  # o ssl.SSLContext de cada conexão TLS

    def fabrica(self, nome: str):
        def criar(host, porta, timeout=None, context=None, ssl_context=None):
            self.registro.append((nome, host, porta, timeout))
            if nome != "SMTP":  # SMTP puro só cifra no starttls
                self.contextos.append(context or ssl_context)
            self._talvez_falhar(nome)
            return self

        return criar

    def _talvez_falhar(self, etapa: str):
        if etapa == self.falhar_em:
            raise self.excecao

    def starttls(self, context=None):
        self.registro.append(("starttls",))
        self.contextos.append(context)
        self._talvez_falhar("starttls")

    def send_message(self, mensagem):
        self.registro.append(("send_message", mensagem["To"]))

    def select(self, pasta):
        self.registro.append(("select", pasta))

    def search(self, *_):
        return "OK", [b""]  # caixa sem nada novo

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.quit()

    def login(self, usuario, senha):
        self.registro.append(("login", usuario, senha))
        self._talvez_falhar("login")

    def quit(self):
        self.registro.append(("quit",))

    def close(self):
        pass

    def logout(self):
        self.registro.append(("logout",))


def servidores_falsos(monkeypatch, smtp=None, imap=None) -> list:
    registro: list = []
    smtp = smtp or ServidorFalso(registro)
    imap = imap or ServidorFalso(registro)
    smtp.registro = imap.registro = registro
    monkeypatch.setattr(smtplib, "SMTP", smtp.fabrica("SMTP"))
    monkeypatch.setattr(smtplib, "SMTP_SSL", smtp.fabrica("SMTP_SSL"))
    monkeypatch.setattr(imaplib, "IMAP4_SSL", imap.fabrica("IMAP4_SSL"))
    return registro


def test_testar_email_entra_no_smtp_e_no_imap(cliente, cabecalho_admin, monkeypatch):
    canal = criar_pela_api(cliente, cabecalho_admin, "email", EMAIL_COMPLETO)
    registro = servidores_falsos(monkeypatch)

    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    assert resultado["ok"] is True
    assert "SMTP ok" in resultado["mensagem"] and "IMAP ok" in resultado["mensagem"]

    assert registro[0] == ("SMTP", "smtp.empresa.com.br", 587, 10)
    assert ("starttls",) in registro
    assert ("login", "suporte@empresa.com.br", "senha-smtp-secreta") in registro
    # sem usuário e senha próprios, o IMAP usa os do SMTP
    assert ("IMAP4_SSL", "imap.empresa.com.br", 993, 10) in registro
    assert registro.count(("login", "suporte@empresa.com.br", "senha-smtp-secreta")) == 2


def test_testar_email_na_porta_465_usa_ssl_e_avisa_sem_imap(cliente, cabecalho_admin, monkeypatch):
    credenciais = {**EMAIL_COMPLETO, "smtp_porta": "465"}
    credenciais.pop("imap_host")
    canal = criar_pela_api(cliente, cabecalho_admin, "email", credenciais)
    registro = servidores_falsos(monkeypatch)

    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    assert resultado["ok"] is True and "sem servidor IMAP" in resultado["mensagem"]
    assert registro[0][0] == "SMTP_SSL" and ("starttls",) not in registro


def _certificado_invalido() -> ssl.SSLCertVerificationError:
    erro = ssl.SSLCertVerificationError(1, "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed")
    erro.verify_message = "self-signed certificate"
    return erro


@pytest.mark.parametrize(
    ("falhar_em", "excecao", "trecho"),
    [
        ("SMTP", OSError("Connection refused"), "falha ao conectar ao servidor SMTP smtp.empresa.com.br:587"),
        ("starttls", smtplib.SMTPNotSupportedError("STARTTLS extension not supported"), "porta 465"),
        ("login", smtplib.SMTPAuthenticationError(535, b"5.7.8 bad credentials"), "SMTP recusou o usuário e a senha"),
        # smtplib codifica o AUTH em ASCII: "senhação" estourava como "erro inesperado"
        ("login", UnicodeEncodeError("ascii", "senhação", 5, 7, "ordinal not in range(128)"), "fora do ASCII"),
        ("starttls", _certificado_invalido(), "certificado TLS do servidor SMTP smtp.empresa.com.br"),
    ],
)
def test_testar_email_diz_qual_etapa_do_smtp_falhou(cliente, cabecalho_admin, monkeypatch, falhar_em, excecao, trecho):
    canal = criar_pela_api(cliente, cabecalho_admin, "email", EMAIL_COMPLETO)
    servidores_falsos(monkeypatch, smtp=ServidorFalso([], falhar_em=falhar_em, excecao=excecao))

    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    assert resultado["ok"] is False and trecho in resultado["mensagem"]
    assert "senha-smtp-secreta" not in resultado["mensagem"]


@pytest.mark.parametrize(
    ("falhar_em", "excecao", "trecho"),
    [
        ("login", imaplib.IMAP4.error("AUTHENTICATIONFAILED"), "IMAP recusou o usuário e a senha"),
        ("login", UnicodeEncodeError("ascii", '"senhação"', 6, 8, "ordinal not in range(128)"), "fora do ASCII"),
        ("IMAP4_SSL", _certificado_invalido(), "certificado TLS do servidor IMAP imap.empresa.com.br"),
    ],
)
def test_testar_email_diz_qual_etapa_do_imap_falhou(cliente, cabecalho_admin, monkeypatch, falhar_em, excecao, trecho):
    canal = criar_pela_api(cliente, cabecalho_admin, "email", EMAIL_COMPLETO)
    servidores_falsos(monkeypatch, imap=ServidorFalso([], falhar_em=falhar_em, excecao=excecao))
    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    assert resultado["ok"] is False and trecho in resultado["mensagem"]
    assert "inesperado" not in resultado["mensagem"]


def _exige_certificado_valido(contexto) -> bool:
    return (
        isinstance(contexto, ssl.SSLContext)
        and contexto.verify_mode == ssl.CERT_REQUIRED
        and contexto.check_hostname is True
    )


def test_testar_email_confere_o_certificado_do_servidor(cliente, cabecalho_admin, monkeypatch):
    # sem contexto, smtplib e imaplib aceitam qualquer certificado: quem
    # estiver no caminho recebe a senha no login e o teste ainda diz "ok"
    canal = criar_pela_api(cliente, cabecalho_admin, "email", EMAIL_COMPLETO)
    smtp, imap = ServidorFalso([]), ServidorFalso([])
    servidores_falsos(monkeypatch, smtp=smtp, imap=imap)
    assert pedir_teste(cliente, cabecalho_admin, canal["id"])["ok"] is True
    assert len(smtp.contextos) == 1 and _exige_certificado_valido(smtp.contextos[0])  # o do STARTTLS
    assert len(imap.contextos) == 1 and _exige_certificado_valido(imap.contextos[0])

    cliente.patch(
        f"/api/canais/{canal['id']}",
        json={"credenciais": {"smtp_porta": "465", "smtp_senha": "senha-smtp-secreta"}},
        headers=cabecalho_admin,
    )
    smtp.contextos.clear()
    assert pedir_teste(cliente, cabecalho_admin, canal["id"])["ok"] is True
    assert len(smtp.contextos) == 1 and _exige_certificado_valido(smtp.contextos[0])  # o do SMTP_SSL


def test_envio_e_coleta_tambem_conferem_o_certificado(monkeypatch):
    canal = criar_canal(TipoCanal.EMAIL, "Caixa", credenciais=EMAIL_COMPLETO)
    smtp, imap = ServidorFalso([]), ServidorFalso([])
    registro = servidores_falsos(monkeypatch, smtp=smtp, imap=imap)

    AdaptadorEmail(canal)._enviar("cliente@exemplo.com.br", "Segue a segunda via.", {})
    assert ("send_message", "cliente@exemplo.com.br") in registro
    assert len(smtp.contextos) == 1 and _exige_certificado_valido(smtp.contextos[0])

    assert AdaptadorEmail(canal).coletar() == []
    assert ("select", "INBOX") in registro
    assert len(imap.contextos) == 1 and _exige_certificado_valido(imap.contextos[0])


# ---------------------------------------------------------- porta do e-mail
@pytest.mark.parametrize("porta", ["abc", "porta 587", "0", "70000"])
def test_porta_invalida_e_recusada_ao_salvar(cliente, cabecalho_admin, porta):
    resposta = cliente.post(
        "/api/canais",
        json={"nome": "Mail", "tipo": "email", "credenciais": {**EMAIL_COMPLETO, "smtp_porta": porta}},
        headers=cabecalho_admin,
    )
    assert resposta.status_code == 422
    assert resposta.json()["detail"] == "Porta SMTP precisa ser um número de 1 a 65535 (ex.: 587)"

    canal = criar_pela_api(cliente, cabecalho_admin, "email", EMAIL_COMPLETO)
    resposta = cliente.patch(
        f"/api/canais/{canal['id']}", json={"credenciais": {"smtp_porta": porta}}, headers=cabecalho_admin
    )
    assert resposta.status_code == 422
    assert credenciais_gravadas(canal["id"])["smtp_porta"] == "587"


def test_porta_valida_e_gravada_como_numero_limpo(cliente, cabecalho_admin):
    canal = criar_pela_api(cliente, cabecalho_admin, "email", {**EMAIL_COMPLETO, "smtp_porta": " 465 "})
    assert credenciais_gravadas(canal["id"])["smtp_porta"] == "465"


def test_porta_invalida_gravada_antes_da_validacao(cliente, cabecalho_admin, cabecalho_atendente, monkeypatch):
    # base antiga: a porta foi gravada como texto livre, antes de a API recusar
    canal = criar_canal(TipoCanal.EMAIL, "Mail", credenciais={**EMAIL_COMPLETO, "smtp_porta": "porta 587"})
    servidores_falsos(monkeypatch)
    resultado = pedir_teste(cliente, cabecalho_admin, canal.id)
    assert resultado["ok"] is False and "Porta SMTP inválida" in resultado["mensagem"]

    # a resposta do atendente vira "falhou" com o motivo, não um 500 sem registro
    cliente.post(
        f"/webhooks/{canal.id}", json={"from": "Loja <financeiro@loja.com.br>", "text": "2a via?"}, headers=TOKEN_EMAIL
    )
    with SessaoLocal() as sessao:
        conversa_id = sessao.query(Conversa).one().id
    resposta = cliente.post(
        f"/api/conversas/{conversa_id}/mensagens", json={"conteudo": "Segue."}, headers=cabecalho_atendente
    )
    assert resposta.status_code == 201, resposta.text
    assert resposta.json()["status"] == "falhou" and "Porta SMTP inválida" in resposta.json()["erro"]
    with SessaoLocal() as sessao:
        assert sessao.query(Mensagem).filter_by(direcao="saida").count() == 1


# -------------------------------------------------------------- permissões
@pytest.mark.parametrize(
    ("metodo", "caminho", "corpo"),
    [
        ("POST", "/api/canais", {"nome": "Novo", "tipo": "telegram"}),
        ("GET", "/api/canais/{id}/credenciais", None),
        ("PATCH", "/api/canais/{id}", {"ativo": False}),
        ("POST", "/api/canais/{id}/testar", None),
        ("DELETE", "/api/canais/{id}", None),
    ],
)
def test_atendente_comum_nao_mexe_em_canais(cliente, cabecalho_atendente, canal_telegram, metodo, caminho, corpo):
    resposta = cliente.request(
        metodo, caminho.format(id=canal_telegram.id), json=corpo, headers=cabecalho_atendente
    )
    assert resposta.status_code == 403


def test_atendente_comum_ve_a_lista_e_os_tipos(cliente, cabecalho_atendente, canal_telegram):
    assert cliente.get("/api/canais", headers=cabecalho_atendente).status_code == 200
    assert cliente.get("/api/canais/tipos", headers=cabecalho_atendente).status_code == 200


# ----------------------------------------------------------------- remover
def test_remover_canal_sem_conversas(cliente, cabecalho_admin):
    canal = criar_pela_api(cliente, cabecalho_admin, "telegram")
    assert cliente.delete(f"/api/canais/{canal['id']}", headers=cabecalho_admin).status_code == 204
    with SessaoLocal() as sessao:
        assert sessao.get(Canal, canal["id"]) is None


def test_remover_canal_com_conversas_e_recusado(cliente, cabecalho_admin, canal_whatsapp):
    cliente.post(f"/webhooks/{canal_whatsapp.id}", json=payload_whatsapp("5511955554444", "oi", "wamid.h"))

    resposta = cliente.delete(f"/api/canais/{canal_whatsapp.id}", headers=cabecalho_admin)
    assert resposta.status_code == 409
    assert "desative" in resposta.json()["detail"]
    with SessaoLocal() as sessao:
        assert sessao.get(Canal, canal_whatsapp.id) is not None


# ------------------------------------------------- a tela, no navegador
# O que a tela de canais faz de errado aparece no navegador, não na API: estes
# testes abrem o /painel num Chromium contra um servidor vivo, no mesmo
# processo (os monkeypatch valem para ele). Sem Playwright ou Chromium, pulam.
CHROMIUM = Path(os.environ.get("IHCHAT_TESTE_CHROMIUM", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"))


@pytest.fixture(scope="module")
def servidor_vivo():
    uvicorn = pytest.importorskip("uvicorn")
    with socket.socket() as sonda:
        sonda.bind(("127.0.0.1", 0))
        porta = sonda.getsockname()[1]
    servidor = uvicorn.Server(
        uvicorn.Config(criar_app(), host="127.0.0.1", port=porta, log_level="warning", timeout_graceful_shutdown=2)
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
            pytest.skip(f"sem Chromium para os testes da tela: {exc}")
        yield chromium
        chromium.close()


@pytest.fixture
def abrir_canais(servidor_vivo, navegador, cabecalho_admin):
    """Abre o /painel logado como admin, já com a gaveta de canais."""
    contextos = []

    def abrir():
        contexto = navegador.new_context(viewport={"width": 1280, "height": 900})
        contextos.append(contexto)
        pagina = contexto.new_page()
        pagina.goto(f"{servidor_vivo}/painel")
        token = cabecalho_admin["Authorization"].removeprefix("Bearer ")
        pagina.evaluate("token => localStorage.setItem('ihchat_token', token)", token)
        pagina.reload()
        pagina.locator("#abrir-canais").click()
        pagina.locator("#corpo-canais article.cartao-canal").first.wait_for()
        return pagina

    yield abrir
    for contexto in contextos:
        contexto.close()


@pytest.fixture
def telegram_lento(monkeypatch):
    """Telegram configurado cujo teste demora, como um SMTP ou a Meta lentos."""
    liberar = threading.Event()

    def verificar(self):
        liberar.wait(timeout=10)
        raise ErroCanal("token recusado pelo Telegram (teste lento)")

    monkeypatch.setattr("app.canais.telegram.AdaptadorTelegram.verificar_conexao", verificar)
    canal = criar_canal(TipoCanal.TELEGRAM, "Bot lento", credenciais={"token": "123:lento"})
    yield canal, liberar
    liberar.set()


def _cartao(pagina, canal_id):
    return pagina.locator(f'article[data-canal="{canal_id}"]')


def test_resultado_do_teste_chega_ao_formulario_aberto_no_meio_do_teste(abrir_canais, telegram_lento):
    expect = pytest.importorskip("playwright.sync_api").expect
    canal, liberar = telegram_lento
    pagina = abrir_canais()

    _cartao(pagina, canal.id).get_by_role("button", name="Testar conexão").click()
    _cartao(pagina, canal.id).get_by_role("button", name="Editar").click()
    formulario = pagina.locator(f'form[data-canal="{canal.id}"]')
    expect(formulario.locator(".resultado-teste")).to_contain_text("Testando")
    # o teste de antes ainda corre: salvar agora começaria outro por cima
    expect(formulario.get_by_role("button", name="Testando…")).to_be_disabled()

    liberar.set()
    expect(formulario.locator(".resultado-teste")).to_contain_text("token recusado pelo Telegram")
    expect(formulario.get_by_role("button", name="Salvar e testar")).to_be_enabled()


def test_resultado_do_teste_chega_ao_cartao_redesenhado(abrir_canais, telegram_lento):
    expect = pytest.importorskip("playwright.sync_api").expect
    canal, liberar = telegram_lento
    pagina = abrir_canais()

    _cartao(pagina, canal.id).get_by_role("button", name="Testar conexão").click()
    _cartao(pagina, canal.id).get_by_role("button", name="Desativar").click()
    # exact: sem ele, "Ativar" casa com o "Desativar" do cartão antigo
    expect(_cartao(pagina, canal.id).get_by_role("button", name="Ativar", exact=True)).to_be_visible()
    # o cartão novo nasce sabendo que há teste em andamento
    expect(_cartao(pagina, canal.id).locator("button.testar")).to_be_disabled()
    expect(_cartao(pagina, canal.id).locator("button.testar")).to_have_text("Testando…")
    liberar.set()
    expect(_cartao(pagina, canal.id).locator(".resultado-teste")).to_contain_text("token recusado pelo Telegram")
    expect(_cartao(pagina, canal.id).locator("button.testar")).to_be_enabled()


def test_selo_diz_que_falhou_e_nao_volta_a_conectado_ao_reabrir(abrir_canais, telegram_lento):
    expect = pytest.importorskip("playwright.sync_api").expect
    canal, liberar = telegram_lento
    liberar.set()
    pagina = abrir_canais()
    # credencial salva ainda não é conexão
    expect(_cartao(pagina, canal.id).locator(".situacao")).to_have_text("Não testado")

    _cartao(pagina, canal.id).get_by_role("button", name="Testar conexão").click()
    expect(_cartao(pagina, canal.id).locator(".situacao")).to_have_text("Falhou no teste")
    expect(pagina.locator(f'#filtros-canais [data-chave="canal-{canal.id}"]')).to_contain_text("falhou")

    pagina.keyboard.press("Escape")
    pagina.locator("#abrir-canais").click()
    expect(_cartao(pagina, canal.id).locator(".situacao")).to_have_text("Falhou no teste")
    expect(_cartao(pagina, canal.id).locator(".resultado-teste")).to_contain_text("token recusado")


def test_apagar_o_token_pela_tela_devolve_o_canal_ao_sandbox(abrir_canais):
    expect = pytest.importorskip("playwright.sync_api").expect
    canal = criar_canal(TipoCanal.TELEGRAM, "Telegram Suporte", credenciais={"token": "123:colado-sem-querer"})
    pagina = abrir_canais()

    _cartao(pagina, canal.id).get_by_role("button", name="Editar").click()
    pagina.get_by_role("button", name="Apagar Token do bot ao salvar").click()
    pagina.get_by_role("button", name="Salvar e testar").click()

    formulario = pagina.locator(f'form[data-canal="{canal.id}"]')
    expect(formulario.locator(".resultado-teste")).to_contain_text("preencha: Token do bot")
    expect(formulario.locator(".alerta-canal")).to_contain_text("está no sandbox")
    assert credenciais_gravadas(canal.id) == {"modo_recebimento": "polling"}
    expect(pagina.locator(f'#filtros-canais [data-chave="canal-{canal.id}"]')).to_contain_text("sandbox")


def test_trocar_o_servidor_marca_a_senha_como_obrigatoria(abrir_canais):
    canal = criar_canal(TipoCanal.EMAIL, "suporte@loja", credenciais=EMAIL_COMPLETO)
    pagina = abrir_canais()
    _cartao(pagina, canal.id).get_by_role("button", name="Editar").click()
    senha = pagina.locator('input[name="smtp_senha"]')
    assert senha.get_attribute("required") is None

    servidor = pagina.locator('input[name="smtp_host"]')
    servidor.fill("smtp.outro.com.br")
    assert senha.evaluate("campo => campo.required") is True
    assert senha.get_attribute("placeholder") == "digite de novo: o servidor mudou"
    servidor.fill(EMAIL_COMPLETO["smtp_host"])
    assert senha.evaluate("campo => campo.required") is False


def test_nome_so_de_espacos_e_barrado_em_portugues_antes_de_ir_a_api(abrir_canais):
    criar_canal(TipoCanal.WEBCHAT, "Chat do site")
    pagina = abrir_canais()
    pedidos = []
    pagina.on("request", lambda pedido: pedido.method == "POST" and pedidos.append(pedido.url))

    pagina.locator("#canais-novo").click()
    nome = pagina.locator(".novo-canal").get_by_label("Nome")
    nome.fill("   ")
    pagina.get_by_role("button", name="Criar e configurar").click()
    assert nome.evaluate("campo => campo.validationMessage") == "Use pelo menos 2 caracteres (espaços não contam)."
    assert not [url for url in pedidos if url.endswith("/api/canais")]


def test_sair_nao_deixa_credenciais_do_admin_na_aba(abrir_canais):
    canal = criar_canal(
        TipoCanal.TELEGRAM, "Bot webhook", segredo_webhook="segredo-do-set-webhook",
        credenciais={"token": "123:abc", "modo_recebimento": "webhook"},
    )
    pagina = abrir_canais()
    assert "segredo-do-set-webhook" in pagina.evaluate("JSON.stringify(telaCanais.credenciais)")
    _cartao(pagina, canal.id).get_by_role("button", name="Testar conexão").wait_for()

    pagina.keyboard.press("Escape")
    pagina.locator("#sair").click()
    pagina.locator("#tela-login").wait_for()
    # a próxima pessoa na mesma aba pode ser uma atendente
    memoria = pagina.evaluate("JSON.stringify([telaCanais.credenciais, telaCanais.resultados, telaCanais.testes])")
    assert memoria == "[{},{},{}]"

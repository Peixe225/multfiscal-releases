"""Cadastro de canais: campos por tipo, credenciais sem segredo, teste de conexão.

Porte de tests/test_canais.py só com HTTP. O que lá dependia de mexer no banco
(canal legado com segredo aleatório na coluna) ou de trocar smtplib por um
falso fica nos testes de unidade de cada lado; aqui, as conversas com a Meta e
o Telegram passam pelo provedor falso (IHCHAT_TESTE_PROVEDOR) e as com SMTP por
um servidor falso de verdade, aberto pelo próprio teste em 127.0.0.1.

Os dois alvos leem IHCHAT_TESTE_PROVEDOR (só com sandbox): um teste que
depende do provedor e não o viu ser chamado falha, não é pulado.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import random
import shutil
import socket
import socketserver
import ssl
import subprocess
import tempfile
import threading
from pathlib import Path

import pytest

from utilitarios import criar_canal, exigir_rota, unico

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


# ------------------------------------------------------------------ apoio
def criar(cliente, cabecalho, tipo: str, credenciais: dict | None = None, nome: str | None = None, **extra) -> dict:
    return criar_canal(cliente, cabecalho, tipo, nome=nome, credenciais=credenciais or {}, **extra)


def credenciais_de(cliente, cabecalho, canal_id: int) -> dict:
    resposta = cliente.get(f"/api/canais/{canal_id}/credenciais", headers=cabecalho)
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


def pedir_teste(cliente, cabecalho, canal_id: int) -> dict:
    resposta = cliente.post(f"/api/canais/{canal_id}/testar", headers=cabecalho)
    # sempre 200: credencial errada é o resultado do teste, não erro da requisição
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


def exigir_provedor(servidor, provedor) -> None:
    """Os dois alvos leem IHCHAT_TESTE_PROVEDOR: sem chamada registrada, o envio nem saiu."""
    assert provedor.chamadas(), f"o servidor ({servidor.alvo}) não chamou o provedor falso"


def numero() -> str:
    """Telefone fictício e único (faixa 5500 9...): a base é da sessão inteira."""
    return "55009" + "".join(random.choice("0123456789") for _ in range(8))


def payload_whatsapp(numero_: str, texto: str, externo_id: str, nome: str = "Cliente") -> dict:
    return {
        "entry": [{"changes": [{"value": {
            "contacts": [{"wa_id": numero_, "profile": {"name": nome}}],
            "messages": [{"from": numero_, "id": externo_id, "type": "text", "text": {"body": texto}}],
        }}]}]
    }


def assinar(segredo: str, corpo: bytes) -> dict:
    assinatura = hmac.new(segredo.encode(), corpo, hashlib.sha256).hexdigest()
    return {"content-type": "application/json", "x-hub-signature-256": f"sha256={assinatura}"}


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
    # sem url_publica (a suíte sobe sem ela) o padrão é o polling
    assert modo["opcoes"] == ["polling", "webhook"] and modo["padrao"] == "polling"
    assert tipos["webchat"] == []
    email = {c["chave"]: c for c in tipos["email"]}
    assert email["smtp_senha"]["destinos"] == ["smtp_host", "smtp_porta", "smtp_usuario"]
    assert email["imap_senha"]["destinos"] == ["imap_host", "imap_porta", "imap_usuario"]
    assert email["smtp_host"]["destinos"] == [] and whatsapp["token"]["destinos"] == []
    for campo in tipos["email"]:
        assert set(campo) == {"chave", "rotulo", "secreto", "obrigatorio", "ajuda", "padrao", "opcoes", "destinos"}


def test_tipos_exigem_login(cliente):
    assert cliente.get("/api/canais/tipos").status_code == 401
    assert cliente.get("/api/canais").status_code == 401


def test_lista_traz_canal_saida(cliente, cabecalho_atendente, canal_webchat):
    canais = cliente.get("/api/canais", headers=cabecalho_atendente).json()
    achado = next(c for c in canais if c["id"] == canal_webchat["id"])
    assert set(achado) == {"id", "nome", "tipo", "ativo", "chave_publica", "configurado", "url_webhook"}
    assert achado["configurado"] is True and achado["chave_publica"].startswith("wc_")
    # relativa sem url_publica; absoluta quando a instalação conhece o endereço
    assert achado["url_webhook"].endswith(f"/webhooks/{canal_webchat['id']}")
    assert "credenciais" not in achado


# ----------------------------------------------------------------- credenciais
def test_credenciais_nunca_devolvem_o_valor_de_um_segredo(cliente, cabecalho_admin):
    whatsapp = criar(cliente, cabecalho_admin, "whatsapp", WHATSAPP_COMPLETO)
    email = criar(cliente, cabecalho_admin, "email", {**EMAIL_COMPLETO, "imap_senha": "senha-imap-secreta"})

    resposta = cliente.get(f"/api/canais/{whatsapp['id']}/credenciais", headers=cabecalho_admin)
    assert resposta.status_code == 200
    dados = resposta.json()
    assert dados["credenciais"] == {"id_numero": "10987654321", "token_verificacao": "palavra-combinada"}
    assert set(dados["secretos_definidos"]) == {"token", "segredo_app"}
    assert dados["campos_obrigatorios"] == ["token", "id_numero"]
    assert "EAAG-token-secreto" not in resposta.text and "app-secret-da-meta" not in resposta.text

    resposta = cliente.get(f"/api/canais/{email['id']}/credenciais", headers=cabecalho_admin)
    dados = resposta.json()
    assert "smtp_senha" not in dados["credenciais"] and dados["credenciais"]["smtp_host"] == "smtp.empresa.com.br"
    assert set(dados["secretos_definidos"]) == {"smtp_senha", "imap_senha"}
    assert "senha-smtp-secreta" not in resposta.text and "senha-imap-secreta" not in resposta.text


def test_credenciais_vazias_saem_como_objeto(cliente, cabecalho_admin, canal_webchat):
    dados = credenciais_de(cliente, cabecalho_admin, canal_webchat["id"])
    assert dados["credenciais"] == {} and dados["secretos_definidos"] == []
    assert dados["chave_publica"] == canal_webchat["chave_publica"]


def test_chave_fora_do_contrato_com_cara_de_senha_tambem_fica_escondida(cliente, cabecalho_admin):
    canal = criar(cliente, cabecalho_admin, "email", {"api_password": "p4ss", "imap_pasta": "Suporte"})
    dados = credenciais_de(cliente, cabecalho_admin, canal["id"])
    assert dados["credenciais"] == {"imap_pasta": "Suporte"}
    assert dados["secretos_definidos"] == ["api_password"]


def test_patch_com_segredo_em_branco_ou_ausente_mantem_o_atual(cliente, cabecalho_admin):
    canal = criar(cliente, cabecalho_admin, "whatsapp", WHATSAPP_COMPLETO)
    url = f"/api/canais/{canal['id']}"

    # é o que a tela manda ao salvar sem mexer no token: ele nunca volta a ela
    resposta = cliente.patch(
        url, json={"credenciais": {"token": "", "segredo_app": None, "id_numero": "222"}}, headers=cabecalho_admin
    )
    assert resposta.status_code == 200
    dados = credenciais_de(cliente, cabecalho_admin, canal["id"])
    assert set(dados["secretos_definidos"]) == {"token", "segredo_app"}
    assert dados["credenciais"]["id_numero"] == "222"
    assert resposta.json()["configurado"] is True


def test_patch_apara_o_token_colado(cliente, cabecalho_admin, servidor, provedor):
    canal = criar(cliente, cabecalho_admin, "whatsapp", WHATSAPP_COMPLETO)
    cliente.patch(f"/api/canais/{canal['id']}", json={"credenciais": {"token": "  novo-token\n"}}, headers=cabecalho_admin)
    provedor.roteirar("graph.facebook.com", json={"display_phone_number": "+55 11 4000-0000"})
    pedir_teste(cliente, cabecalho_admin, canal["id"])
    exigir_provedor(servidor, provedor)
    # o token gravado é o aparado: é ele que vai no Authorization
    assert provedor.chamadas()[-1]["cabecalhos"]["authorization"] == "Bearer novo-token"


def test_patch_com_campo_comum_em_branco_limpa_o_campo(cliente, cabecalho_admin):
    canal = criar(cliente, cabecalho_admin, "email", EMAIL_COMPLETO)
    cliente.patch(
        f"/api/canais/{canal['id']}", json={"credenciais": {"imap_host": "", "smtp_senha": ""}}, headers=cabecalho_admin
    )
    dados = credenciais_de(cliente, cabecalho_admin, canal["id"])
    assert "imap_host" not in dados["credenciais"]
    assert "smtp_senha" in dados["secretos_definidos"]


def test_patch_troca_nome_e_desativa(cliente, cabecalho_admin):
    canal = criar(cliente, cabecalho_admin, "telegram")
    resposta = cliente.patch(
        f"/api/canais/{canal['id']}", json={"nome": "Bot da loja", "ativo": False}, headers=cabecalho_admin
    )
    assert resposta.status_code == 200
    assert resposta.json()["nome"] == "Bot da loja" and resposta.json()["ativo"] is False
    assert cliente.patch(f"/api/canais/{canal['id']}", json={"nome": ""}, headers=cabecalho_admin).status_code == 422


def test_patch_de_canal_inexistente(cliente, cabecalho_admin):
    resposta = cliente.patch("/api/canais/99999999", json={"ativo": False}, headers=cabecalho_admin)
    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "canal nao encontrado"}


@pytest.mark.parametrize("nome", ["", "   ", " x ", "x" * 121])
def test_nome_e_medido_depois_de_aparado_e_o_erro_sai_em_portugues(cliente, cabecalho_admin, nome):
    canal = criar(cliente, cabecalho_admin, "telegram", nome=unico("Bot "))
    for resposta in (
        cliente.patch(f"/api/canais/{canal['id']}", json={"nome": nome}, headers=cabecalho_admin),
        cliente.post("/api/canais", json={"nome": nome, "tipo": "webchat"}, headers=cabecalho_admin),
    ):
        assert resposta.status_code == 422
        assert resposta.json()["detail"][0]["msg"] == (
            "o nome do canal precisa ter de 2 a 120 caracteres (espaços não contam)"
        )
        assert resposta.json()["detail"][0]["loc"] == ["body", "nome"]


def test_nome_chega_aparado_na_criacao_e_na_edicao(cliente, cabecalho_admin):
    canal = criar(cliente, cabecalho_admin, "webchat", nome="  Chat do site  ")
    assert canal["nome"] == "Chat do site"
    resposta = cliente.patch(f"/api/canais/{canal['id']}", json={"nome": "  Chat novo "}, headers=cabecalho_admin)
    assert resposta.json()["nome"] == "Chat novo"


def test_tipo_desconhecido_e_recusado(cliente, cabecalho_admin):
    resposta = cliente.post("/api/canais", json={"nome": "Fax", "tipo": "fax"}, headers=cabecalho_admin)
    assert resposta.status_code == 422
    assert resposta.json()["detail"][0]["loc"] == ["body", "tipo"]


# ------------------------------------------------- senha e servidor de destino
def test_trocar_o_servidor_smtp_exige_digitar_a_senha_de_novo(cliente, cabecalho_admin):
    canal = criar(cliente, cabecalho_admin, "email", EMAIL_COMPLETO)
    url = f"/api/canais/{canal['id']}"

    for troca in ({"smtp_host": "smtp.atacante.invalid"}, {"smtp_porta": "2525"}, {"smtp_usuario": "outro"}):
        resposta = cliente.patch(url, json={"credenciais": {**troca, "smtp_senha": ""}}, headers=cabecalho_admin)
        assert resposta.status_code == 422, troca
        assert "digite de novo a Senha SMTP" in resposta.json()["detail"]
    # nada gravado pela metade
    assert credenciais_de(cliente, cabecalho_admin, canal["id"])["credenciais"]["smtp_host"] == "smtp.empresa.com.br"

    resposta = cliente.patch(
        url, json={"credenciais": {"smtp_host": "smtp.novo.com.br", "smtp_senha": "senha-nova"}}, headers=cabecalho_admin
    )
    assert resposta.status_code == 200
    assert credenciais_de(cliente, cabecalho_admin, canal["id"])["credenciais"]["smtp_host"] == "smtp.novo.com.br"
    # mudar outra coisa (o remetente) continua sem pedir a senha
    assert cliente.patch(url, json={"credenciais": {"remetente": "a@b.com"}}, headers=cabecalho_admin).status_code == 200


def test_ligar_o_imap_com_a_senha_do_smtp_guardada_exige_uma_senha(cliente, cabecalho_admin):
    credenciais = dict(EMAIL_COMPLETO)
    credenciais.pop("imap_host")
    canal = criar(cliente, cabecalho_admin, "email", credenciais)
    url = f"/api/canais/{canal['id']}"

    resposta = cliente.patch(url, json={"credenciais": {"imap_host": "imap.atacante.invalid"}}, headers=cabecalho_admin)
    assert resposta.status_code == 422 and "Senha IMAP" in resposta.json()["detail"]
    assert "imap_host" not in credenciais_de(cliente, cabecalho_admin, canal["id"])["credenciais"]

    corpo = {"credenciais": {"imap_host": "imap.empresa.com.br", "imap_senha": "senha-imap"}}
    assert cliente.patch(url, json=corpo, headers=cabecalho_admin).status_code == 200
    corpo = {"credenciais": {"imap_host": "imap2.empresa.com.br", "imap_senha": ""}}
    assert cliente.patch(url, json=corpo, headers=cabecalho_admin).status_code == 422
    # tirar o IMAP não manda senha a lugar nenhum
    assert cliente.patch(url, json={"credenciais": {"imap_host": ""}}, headers=cabecalho_admin).status_code == 200


def test_servidor_trocado_sem_senha_guardada_nao_pede_nada(cliente, cabecalho_admin):
    canal = criar(cliente, cabecalho_admin, "email", {"smtp_host": "smtp.a.com"})
    resposta = cliente.patch(
        f"/api/canais/{canal['id']}", json={"credenciais": {"smtp_host": "smtp.b.com"}}, headers=cabecalho_admin
    )
    assert resposta.status_code == 200


# ------------------------------------------------------------ apagar segredo
def test_limpar_apaga_o_segredo_e_devolve_o_canal_ao_sandbox(cliente, cabecalho_admin):
    canal = criar(cliente, cabecalho_admin, "telegram", {"token": "123:teste"})
    assert canal["configurado"] is True
    url = f"/api/canais/{canal['id']}"

    for corpo in ({"credenciais": {"token": ""}}, {"credenciais": {"token": None}}):
        assert cliente.patch(url, json=corpo, headers=cabecalho_admin).json()["configurado"] is True

    resposta = cliente.patch(url, json={"limpar": ["token"]}, headers=cabecalho_admin)
    assert resposta.status_code == 200 and resposta.json()["configurado"] is False
    dados = credenciais_de(cliente, cabecalho_admin, canal["id"])
    # o PHP grava o modo de recebimento efetivo do Telegram (o que o servidor usa)
    visiveis = {k: v for k, v in dados["credenciais"].items() if k != "modo_recebimento"}
    assert visiveis == {} and dados["secretos_definidos"] == []


def test_limpar_e_valor_novo_no_mesmo_pedido(cliente, cabecalho_admin):
    canal = criar(cliente, cabecalho_admin, "email", {**EMAIL_COMPLETO, "imap_senha": "senha-imap"})
    cliente.patch(
        f"/api/canais/{canal['id']}",
        json={"limpar": ["imap_senha"], "credenciais": {"smtp_senha": "trocada"}},
        headers=cabecalho_admin,
    )
    assert credenciais_de(cliente, cabecalho_admin, canal["id"])["secretos_definidos"] == ["smtp_senha"]


def test_atendente_comum_nao_apaga_segredo(cliente, cabecalho_atendente, canal_telegram):
    resposta = cliente.patch(
        f"/api/canais/{canal_telegram['id']}", json={"limpar": ["token"]}, headers=cabecalho_atendente
    )
    assert resposta.status_code == 403
    assert resposta.json() == {"detail": "acao restrita a administradores"}


# ----------------------------------------------------------------- segredos
def test_segredos_gerados_no_cadastro(cliente, cabecalho_admin):
    whatsapp = criar(cliente, cabecalho_admin, "whatsapp")
    telegram = criar(cliente, cabecalho_admin, "telegram")
    webchat = criar(cliente, cabecalho_admin, "webchat")

    # a Meta assina com o App Secret dela: um segredo nosso recusaria tudo
    assert credenciais_de(cliente, cabecalho_admin, whatsapp["id"])["segredo_webhook"] is None
    # o do Telegram vai no secret_token do setWebhook
    assert credenciais_de(cliente, cabecalho_admin, telegram["id"])["segredo_webhook"]
    assert webchat["chave_publica"].startswith("wc_") and whatsapp["chave_publica"] is None


def test_webhook_do_whatsapp_confere_a_assinatura_com_o_segredo_app(cliente, cabecalho_admin):
    canal = criar(cliente, cabecalho_admin, "whatsapp", WHATSAPP_COMPLETO)
    corpo = json.dumps(payload_whatsapp(numero(), "olá", unico("wamid.app"))).encode()
    url = f"/webhooks/{canal['id']}"

    assert cliente.post(url, content=corpo, headers={"content-type": "application/json"}).status_code == 401
    assert cliente.post(url, content=corpo, headers=assinar("outro-segredo", corpo)).status_code == 401
    aceito = cliente.post(url, content=corpo, headers=assinar("app-secret-da-meta", corpo))
    assert aceito.status_code == 200 and aceito.json()["recebidas"] == 1
    assert credenciais_de(cliente, cabecalho_admin, canal["id"])["assinatura"] == "app_secret"


def test_whatsapp_criado_sem_app_secret_aceita_webhook_sem_assinatura(cliente, cabecalho_admin):
    canal = criar(cliente, cabecalho_admin, "whatsapp", {"token": "t", "id_numero": "1"})
    resposta = cliente.post(f"/webhooks/{canal['id']}", json=payload_whatsapp(numero(), "oi", unico("wamid.livre")))
    assert resposta.status_code == 200
    assert credenciais_de(cliente, cabecalho_admin, canal["id"])["assinatura"] == "nenhuma"


def test_app_secret_em_segredo_webhook_como_o_readme_ensinava_e_conferido(cliente, cabecalho_admin):
    canal = criar(cliente, cabecalho_admin, "whatsapp", {"token": "EAAG", "id_numero": "123", "segredo_webhook": "APP_SECRET_REAL"})
    corpo = json.dumps(payload_whatsapp(numero(), "boleto para golpe@x.com", unico("wamid.forjada"))).encode()
    url = f"/webhooks/{canal['id']}"
    assert cliente.post(url, content=corpo, headers={"content-type": "application/json"}).status_code == 401
    assert cliente.post(url, content=corpo, headers=assinar("outro", corpo)).status_code == 401
    assert cliente.post(url, content=corpo, headers=assinar("APP_SECRET_REAL", corpo)).status_code == 200
    dados = credenciais_de(cliente, cabecalho_admin, canal["id"])
    assert dados["assinatura"] == "app_secret" and "APP_SECRET_REAL" not in json.dumps(dados)


def test_tirar_o_app_secret_volta_a_nenhuma(cliente, cabecalho_admin):
    canal = criar(cliente, cabecalho_admin, "whatsapp", WHATSAPP_COMPLETO)
    cliente.patch(f"/api/canais/{canal['id']}", json={"limpar": ["segredo_app"]}, headers=cabecalho_admin)
    assert credenciais_de(cliente, cabecalho_admin, canal["id"])["assinatura"] == "nenhuma"


# ------------------------------------------------------------------ testar
def test_testar_whatsapp_conectado(cliente, cabecalho_admin, servidor, provedor):
    canal = criar(cliente, cabecalho_admin, "whatsapp", WHATSAPP_COMPLETO)
    provedor.roteirar(
        "graph.facebook.com",
        json={"display_phone_number": "+55 00 91234-5678", "verified_name": "MultFiscal", "id": "10987654321"},
    )
    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    exigir_provedor(servidor, provedor)
    assert resultado == {
        "ok": True,
        "mensagem": "Conectado ao número +55 00 91234-5678 (MultFiscal)",
        "alerta": None,  # com App Secret e ativo, nada a ressalvar
    }
    chamada = provedor.chamadas()[0]
    assert chamada["metodo"] == "GET"
    assert chamada["url"].startswith("https://graph.facebook.com/v20.0/10987654321?")
    assert "fields=display_phone_number%2Cverified_name" in chamada["url"] or "fields=display_phone_number,verified_name" in chamada["url"]
    assert chamada["cabecalhos"]["authorization"] == "Bearer EAAG-token-secreto"


def test_testar_whatsapp_sem_app_secret_avisa_que_aceita_entrega_forjada(cliente, cabecalho_admin, servidor, provedor):
    canal = criar(cliente, cabecalho_admin, "whatsapp", {"token": "t", "id_numero": "1"})
    provedor.roteirar("graph.facebook.com", json={"display_phone_number": "+55 11 4000-0000", "verified_name": "Loja"})
    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    exigir_provedor(servidor, provedor)
    assert resultado["ok"] is True and resultado["mensagem"].startswith("Conectado ao número")
    assert "App Secret" in resultado["alerta"] and "forjar" in resultado["alerta"]


def test_testar_whatsapp_repete_o_erro_da_meta(cliente, cabecalho_admin, servidor, provedor):
    canal = criar(cliente, cabecalho_admin, "whatsapp", WHATSAPP_COMPLETO)
    provedor.roteirar(
        "graph.facebook.com",
        status=401,
        json={"error": {"message": "Error validating access token: Session has expired", "code": 190}},
    )
    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    exigir_provedor(servidor, provedor)
    assert resultado["ok"] is False
    assert "Session has expired" in resultado["mensagem"] and "token permanente" in resultado["mensagem"]
    assert "EAAG-token-secreto" not in resultado["mensagem"]


def test_testar_whatsapp_com_id_do_numero_errado_diz_onde_corrigir(cliente, cabecalho_admin, servidor, provedor):
    canal = criar(cliente, cabecalho_admin, "whatsapp", WHATSAPP_COMPLETO)
    provedor.roteirar(
        "graph.facebook.com",
        status=400,
        json={"error": {"message": "Unsupported get request. Object with ID '10987654321' does not exist", "code": 100}},
    )
    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    exigir_provedor(servidor, provedor)
    assert resultado["ok"] is False
    assert "does not exist" in resultado["mensagem"] and "Phone number ID" in resultado["mensagem"]
    assert "token permanente" not in resultado["mensagem"]


def test_testar_whatsapp_sem_rede(cliente, cabecalho_admin, servidor, provedor):
    canal = criar(cliente, cabecalho_admin, "whatsapp", WHATSAPP_COMPLETO)
    provedor.roteirar("graph.facebook.com", erro_rede="sem rota para o host")
    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    exigir_provedor(servidor, provedor)
    assert resultado["ok"] is False and "falha de rede" in resultado["mensagem"]


def test_testar_canal_sem_credenciais_diz_o_que_falta_com_os_nomes_do_formulario(cliente, cabecalho_admin):
    whatsapp = criar(cliente, cabecalho_admin, "whatsapp")
    email = criar(cliente, cabecalho_admin, "email", {"smtp_host": "smtp.x.com"})
    telegram = criar(cliente, cabecalho_admin, "telegram")

    assert pedir_teste(cliente, cabecalho_admin, whatsapp["id"]) == {
        "ok": False,
        "mensagem": "preencha: Token de acesso permanente, ID do número de telefone",
        "alerta": None,
    }
    assert pedir_teste(cliente, cabecalho_admin, email["id"])["mensagem"] == "preencha: Usuário SMTP, Senha SMTP, Remetente"
    assert pedir_teste(cliente, cabecalho_admin, telegram["id"])["mensagem"] == "preencha: Token do bot"


def test_testar_webchat_sempre_pronto(cliente, cabecalho_admin, canal_webchat):
    resultado = pedir_teste(cliente, cabecalho_admin, canal_webchat["id"])
    assert resultado["ok"] is True and resultado["alerta"] is None


def test_testar_canal_desativado_nao_diz_so_que_funcionou(cliente, cabecalho_admin, servidor, provedor):
    webchat = criar(cliente, cabecalho_admin, "webchat")
    telegram = criar(cliente, cabecalho_admin, "telegram", {"token": "123:abc"})
    for canal in (webchat, telegram):
        cliente.patch(f"/api/canais/{canal['id']}", json={"ativo": False}, headers=cabecalho_admin)

    resultado = pedir_teste(cliente, cabecalho_admin, webchat["id"])
    assert resultado["ok"] is False and "desativado" in resultado["mensagem"]

    provedor.roteirar("/getMe", json={"ok": True, "result": {"username": "bot_suporte"}})
    provedor.roteirar("/getWebhookInfo", json={"ok": True, "result": {"url": ""}})
    resultado = pedir_teste(cliente, cabecalho_admin, telegram["id"])
    exigir_provedor(servidor, provedor)
    # o token funciona, mas nada chega: a tela precisa mostrar as duas coisas
    assert resultado["ok"] is True and "@bot_suporte" in resultado["mensagem"]
    assert "desativado" in resultado["alerta"]
    # o token vai no caminho da URL, nunca na resposta
    assert all("/bot123:abc/" in c["url"] for c in provedor.chamadas())
    assert "123:abc" not in json.dumps(resultado)


def test_testar_telegram_com_token_recusado(cliente, cabecalho_admin, servidor, provedor):
    canal = criar(cliente, cabecalho_admin, "telegram", {"token": "123:errado"})
    provedor.roteirar("api.telegram.org", status=401, json={"ok": False, "description": "Unauthorized"})
    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    exigir_provedor(servidor, provedor)
    assert resultado["ok"] is False and "token recusado pelo Telegram" in resultado["mensagem"]


def test_testar_telegram_em_polling_com_webhook_ativo_explica_o_conflito(cliente, cabecalho_admin, servidor, provedor):
    canal = criar(cliente, cabecalho_admin, "telegram", {"token": "123:abc", "modo_recebimento": "polling"})
    provedor.roteirar("/getMe", json={"ok": True, "result": {"username": "bot_suporte"}})
    provedor.roteirar("/getWebhookInfo", json={"ok": True, "result": {"url": "https://outro.example/hook"}})
    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    exigir_provedor(servidor, provedor)
    assert resultado["ok"] is False
    assert "webhook ativo (https://outro.example/hook)" in resultado["mensagem"]


def test_testar_telegram_em_webhook_apontando_para_outro_lugar(cliente, cabecalho_admin, servidor, provedor):
    canal = criar(cliente, cabecalho_admin, "telegram", {"token": "123:abc", "modo_recebimento": "webhook"})
    provedor.roteirar("/getMe", json={"ok": True, "result": {"username": "bot_suporte"}})
    provedor.roteirar("/getWebhookInfo", json={"ok": True, "result": {"url": "https://outro.example/webhooks/1"}})
    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    exigir_provedor(servidor, provedor)
    assert resultado["ok"] is False and f"/webhooks/{canal['id']}" in resultado["mensagem"]


def test_testar_canal_inexistente(cliente, cabecalho_admin):
    assert cliente.post("/api/canais/99999999/testar", headers=cabecalho_admin).status_code == 404


# ------------------------------------------------- testar: e-mail (SMTP falso)
class _SmtpFalso(socketserver.StreamRequestHandler):
    """SMTP de mentira em 127.0.0.1: saúda e responde ao EHLO sem STARTTLS,
    ou com STARTTLS e um certificado autoassinado (que ninguém deve aceitar)."""

    def handle(self):
        self.wfile.write(b"220 falso ESMTP\r\n")
        cifrado = False
        while True:
            linha = self.rfile.readline()
            if not linha:
                return
            comando = linha.decode(errors="replace").strip().upper()
            if comando.startswith(("EHLO", "HELO")):
                extras = b"250-STARTTLS\r\n" if self.server.contexto and not cifrado else b""
                self.wfile.write(b"250-falso\r\n" + extras + b"250 AUTH PLAIN LOGIN\r\n")
            elif comando == "STARTTLS" and self.server.contexto:
                self.wfile.write(b"220 pronto\r\n")
                try:
                    self.request = self.server.contexto.wrap_socket(self.request, server_side=True)
                except (ssl.SSLError, OSError):
                    return  # o cliente recusou o certificado: é o esperado
                self.rfile = self.request.makefile("rb")
                self.wfile = self.request.makefile("wb", buffering=0)
                cifrado = True
            elif comando.startswith("AUTH"):
                self.wfile.write(b"535 5.7.8 credenciais recusadas\r\n")
            elif comando == "QUIT":
                self.wfile.write(b"221 tchau\r\n")
                return
            else:
                self.wfile.write(b"502 nao implementado\r\n")


@pytest.fixture
def smtp_falso():
    """Liga um SMTP falso; `contexto` com certificado autoassinado quando pedido."""
    servidores = []

    def ligar(com_tls: bool = False) -> int:
        contexto = None
        if com_tls:
            if shutil.which("openssl") is None:
                pytest.skip("sem openssl para gerar o certificado de teste")
            pasta = Path(tempfile.mkdtemp(prefix="ihchat-smtp-"))
            subprocess.run(
                ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
                 "-keyout", str(pasta / "chave.pem"), "-out", str(pasta / "cert.pem")],
                check=True, capture_output=True,
            )
            contexto = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            contexto.load_cert_chain(pasta / "cert.pem", pasta / "chave.pem")
        servidor = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _SmtpFalso)
        servidor.daemon_threads = True
        servidor.contexto = contexto
        threading.Thread(target=servidor.serve_forever, daemon=True).start()
        servidores.append(servidor)
        return servidor.server_address[1]

    yield ligar
    for servidor in servidores:
        servidor.shutdown()
        servidor.server_close()


def _porta_fechada() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _email_para(cliente, cabecalho, porta: int) -> dict:
    return criar(cliente, cabecalho, "email", {
        **EMAIL_COMPLETO, "smtp_host": "127.0.0.1", "smtp_porta": str(porta), "imap_host": "",
    })


def test_testar_email_com_servidor_fora_do_ar_diz_a_etapa(cliente, cabecalho_admin):
    porta = _porta_fechada()
    canal = _email_para(cliente, cabecalho_admin, porta)
    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    assert resultado["ok"] is False
    assert f"falha ao conectar ao servidor SMTP 127.0.0.1:{porta}" in resultado["mensagem"]
    assert "senha-smtp-secreta" not in resultado["mensagem"]


def test_testar_email_sem_starttls_sugere_a_porta_465(cliente, cabecalho_admin, smtp_falso):
    porta = smtp_falso(com_tls=False)
    canal = _email_para(cliente, cabecalho_admin, porta)
    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    assert resultado["ok"] is False
    assert f"iniciar STARTTLS em 127.0.0.1:{porta}" in resultado["mensagem"]
    assert "porta 465" in resultado["mensagem"]


def test_testar_email_recusa_certificado_invalido_antes_de_mandar_a_senha(cliente, cabecalho_admin, smtp_falso):
    # sem conferir o certificado, quem estivesse no caminho receberia a senha
    porta = smtp_falso(com_tls=True)
    canal = _email_para(cliente, cabecalho_admin, porta)
    resultado = pedir_teste(cliente, cabecalho_admin, canal["id"])
    assert resultado["ok"] is False
    assert "certificado TLS do servidor SMTP 127.0.0.1" in resultado["mensagem"]
    assert "a senha não foi enviada" in resultado["mensagem"]


# ---------------------------------------------------------- porta do e-mail
@pytest.mark.parametrize("porta", ["abc", "porta 587", "0", "70000"])
def test_porta_invalida_e_recusada_ao_salvar(cliente, cabecalho_admin, porta):
    resposta = cliente.post(
        "/api/canais",
        json={"nome": unico("Mail "), "tipo": "email", "credenciais": {**EMAIL_COMPLETO, "smtp_porta": porta}},
        headers=cabecalho_admin,
    )
    assert resposta.status_code == 422
    assert resposta.json()["detail"] == "Porta SMTP precisa ser um número de 1 a 65535 (ex.: 587)"

    canal = criar(cliente, cabecalho_admin, "email", EMAIL_COMPLETO)
    resposta = cliente.patch(f"/api/canais/{canal['id']}", json={"credenciais": {"smtp_porta": porta}}, headers=cabecalho_admin)
    assert resposta.status_code == 422
    assert credenciais_de(cliente, cabecalho_admin, canal["id"])["credenciais"]["smtp_porta"] == "587"


def test_porta_valida_e_gravada_como_numero_limpo(cliente, cabecalho_admin):
    canal = criar(cliente, cabecalho_admin, "email", {**EMAIL_COMPLETO, "smtp_porta": " 465 "})
    assert credenciais_de(cliente, cabecalho_admin, canal["id"])["credenciais"]["smtp_porta"] == "465"


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
    resposta = cliente.request(metodo, caminho.format(id=canal_telegram["id"]), json=corpo, headers=cabecalho_atendente)
    assert resposta.status_code == 403


def test_atendente_comum_ve_a_lista_e_os_tipos(cliente, cabecalho_atendente, canal_telegram):
    assert cliente.get("/api/canais", headers=cabecalho_atendente).status_code == 200
    assert cliente.get("/api/canais/tipos", headers=cabecalho_atendente).status_code == 200


# ----------------------------------------------------------------- remover
def test_remover_canal_sem_conversas(cliente, cabecalho_admin, cabecalho_atendente):
    canal = criar(cliente, cabecalho_admin, "telegram")
    resposta = cliente.delete(f"/api/canais/{canal['id']}", headers=cabecalho_admin)
    assert resposta.status_code == 204 and resposta.content == b""
    ids = [c["id"] for c in cliente.get("/api/canais", headers=cabecalho_atendente).json()]
    assert canal["id"] not in ids
    assert cliente.delete(f"/api/canais/{canal['id']}", headers=cabecalho_admin).status_code == 404


def test_remover_canal_com_conversas_e_recusado(cliente, cabecalho_admin, canal_whatsapp):
    cliente.post(f"/webhooks/{canal_whatsapp['id']}", json=payload_whatsapp(numero(), "oi", unico("wamid.h")))
    resposta = cliente.delete(f"/api/canais/{canal_whatsapp['id']}", headers=cabecalho_admin)
    assert resposta.status_code == 409
    assert "desative" in resposta.json()["detail"] and "1 conversa(s)" in resposta.json()["detail"]


# ------------------------------------------- Telegram: webhook pelo servidor
def test_conectar_webhook_exige_admin(cliente, cabecalho_atendente, canal_telegram):
    resposta = exigir_rota(
        cliente.post(f"/api/canais/{canal_telegram['id']}/conectar-webhook", headers=cabecalho_atendente),
        "POST /api/canais/{id}/conectar-webhook",
    )
    assert resposta.status_code == 403


def test_conectar_webhook_sem_url_publica_explica_e_nao_chama_o_telegram(cliente, cabecalho_admin, provedor):
    canal = criar(cliente, cabecalho_admin, "telegram", {"token": "123:abc"})
    resposta = exigir_rota(
        cliente.post(f"/api/canais/{canal['id']}/conectar-webhook", headers=cabecalho_admin),
        "POST /api/canais/{id}/conectar-webhook",
    )
    assert resposta.status_code == 200
    corpo = resposta.json()
    # a suíte sobe sem url_publica: sem HTTPS público o Telegram não entrega
    assert corpo["ok"] is False and "url_publica" in corpo["mensagem"]
    assert provedor.chamadas() == []


def test_conectar_webhook_em_canal_que_nao_e_telegram(cliente, cabecalho_admin, canal_whatsapp):
    resposta = exigir_rota(
        cliente.post(f"/api/canais/{canal_whatsapp['id']}/conectar-webhook", headers=cabecalho_admin),
        "POST /api/canais/{id}/conectar-webhook",
    )
    assert resposta.status_code == 200 and resposta.json()["ok"] is False
    assert "Meta" in resposta.json()["mensagem"]


def test_remover_webhook_chama_o_telegram_e_volta_ao_polling(cliente, cabecalho_admin, servidor, provedor):
    canal = criar(cliente, cabecalho_admin, "telegram", {"token": "123:abc", "modo_recebimento": "webhook"})
    provedor.roteirar("/deleteWebhook", json={"ok": True, "result": True})
    resposta = exigir_rota(
        cliente.post(f"/api/canais/{canal['id']}/remover-webhook", headers=cabecalho_admin),
        "POST /api/canais/{id}/remover-webhook",
    )
    assert resposta.status_code == 200
    exigir_provedor(servidor, provedor)
    assert resposta.json()["ok"] is True
    chamada = provedor.chamadas()[-1]
    assert chamada["url"].endswith("/bot123:abc/deleteWebhook")
    assert json.loads(chamada["corpo"]) == {"drop_pending_updates": False}
    assert credenciais_de(cliente, cabecalho_admin, canal["id"])["credenciais"]["modo_recebimento"] == "polling"
    assert "123:abc" not in resposta.text


def test_remover_webhook_com_token_recusado(cliente, cabecalho_admin, servidor, provedor):
    canal = criar(cliente, cabecalho_admin, "telegram", {"token": "123:abc", "modo_recebimento": "webhook"})
    provedor.roteirar("api.telegram.org", status=401, json={"ok": False, "description": "Unauthorized"})
    resposta = exigir_rota(
        cliente.post(f"/api/canais/{canal['id']}/remover-webhook", headers=cabecalho_admin),
        "POST /api/canais/{id}/remover-webhook",
    )
    exigir_provedor(servidor, provedor)
    assert resposta.json()["ok"] is False and "token recusado" in resposta.json()["mensagem"]
    # nada mudou no canal
    assert credenciais_de(cliente, cabecalho_admin, canal["id"])["credenciais"]["modo_recebimento"] == "webhook"


def test_telegram_sem_modo_ganha_o_modo_efetivo(cliente, cabecalho_admin, servidor, request):
    """A tela lia "polling" quando o campo faltava, enquanto o servidor (com
    url_publica https) tratava o canal como webhook: os dois veem o mesmo modo."""
    canal = criar(cliente, cabecalho_admin, "telegram")
    cliente.patch(f"/api/canais/{canal['id']}", json={"credenciais": {"token": "123:abc"}}, headers=cabecalho_admin)
    modo = next(c for c in cliente.get("/api/canais/tipos", headers=cabecalho_admin).json()["telegram"] if c["chave"] == "modo_recebimento")
    assert credenciais_de(cliente, cabecalho_admin, canal["id"])["credenciais"]["modo_recebimento"] == modo["padrao"]


def test_canal_de_email_tem_segredo_para_o_webhook(cliente, cabecalho_admin, servidor, request):
    """O webhook genérico de e-mail só aceita entregas com este segredo."""
    canal = criar(cliente, cabecalho_admin, "email")
    segredo = credenciais_de(cliente, cabecalho_admin, canal["id"])["segredo_webhook"]
    assert isinstance(segredo, str) and len(segredo) >= 32
    assert segredo not in json.dumps(cliente.get("/api/canais", headers=cabecalho_admin).json())

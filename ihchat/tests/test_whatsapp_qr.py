"""WhatsApp pelo QR Code (app/canais/whatsapp_qr.py, zapi.py, evolution.py).

O fluxo HTTP completo (QR, webhook, envio, desconectar) roda nos DOIS
servidores em contrato/test_whatsapp_qr*.py. Aqui ficam os detalhes do
Python que não passam por lá: tradução de casos raros, a assinatura que não
duplica, segredos fora das frases de erro e a resposta pelo celular numa
conversa resolvida.
"""
from __future__ import annotations

import json

import httpx
import pytest

from app.canais import http as canal_http
from app.canais import whatsapp
from app.canais.base import AnexoRecebido, ErroCanal
from app.canais.whatsapp_qr import (
    AdaptadorWhatsAppQR,
    credenciais_com_conexao,
    e_conversa_privada,
    identificador_do_contato,
    url_de_midia,
)
from app.db import SessaoLocal
from app.models import Canal, Conversa, StatusMensagem, TipoCanal

from conftest import criar_canal

ZAPI = {"provedor": "zapi", "instancia_id": "I1", "instancia_token": "token-secreto-zapi", "client_token": "ct-secreto"}
EVOLUTION = {"provedor": "evolution", "url_servidor": "https://evo.teste", "api_key": "chave-secreta-evo", "nome_instancia": "loja"}


def adaptador(credenciais: dict, canal_id: int = 7) -> AdaptadorWhatsAppQR:
    return AdaptadorWhatsAppQR(Canal(id=canal_id, nome="QR", tipo=TipoCanal.WHATSAPP_QR.value, credenciais=credenciais, segredo_webhook="s3gredo"))


def roteiro(tratador) -> list[httpx.Request]:
    pedidos: list[httpx.Request] = []

    def responder(pedido: httpx.Request) -> httpx.Response:
        pedidos.append(pedido)
        return tratador(pedido)

    canal_http.definir_transporte(httpx.MockTransport(responder))
    return pedidos


# ------------------------------------------------------------- utilitários
@pytest.mark.parametrize(
    ("bruto", "esperado"),
    [
        ("5511988887777", "5511988887777"),
        ("+55 (11) 98888-7777", "5511988887777"),
        ("5511988887777@s.whatsapp.net", "5511988887777"),
        ("5511988887777:12@s.whatsapp.net", "5511988887777"),
        ("5511988887777@c.us", "5511988887777"),
        ("123456789012345@lid", "123456789012345@lid"),
        ("@lid", None),
        ("", None),
        (None, None),
    ],
)
def test_identificador_do_contato(bruto, esperado):
    assert identificador_do_contato(bruto) == esperado


def test_conversa_privada():
    assert e_conversa_privada("5511@s.whatsapp.net") and e_conversa_privada("5511")
    for jid in ("120363@g.us", "1203-group", "status@broadcast", "123@broadcast", "123@newsletter", "", None):
        assert not e_conversa_privada(jid), jid


def test_so_baixa_midia_de_http():
    assert url_de_midia("https://storage.teste/a.png") == "https://storage.teste/a.png"
    for url in ("file:///etc/passwd", "gopher://x", "ftp://x/a", "javascript:alert(1)", 5, None):
        assert url_de_midia(url) is None


def test_estado_da_conexao_so_grava_o_que_mudou():
    assert credenciais_com_conexao({"estado_conexao": "conectado", "numero_conectado": "55"}, "conectado", "55") is None
    assert credenciais_com_conexao({"x": 1}, "conectado", "5511") == {"x": 1, "estado_conexao": "conectado", "numero_conectado": "5511"}
    # desconectou: o número sai junto
    assert credenciais_com_conexao({"estado_conexao": "conectado", "numero_conectado": "55"}, "desconectado", None) == {
        "estado_conexao": "desconectado"
    }
    assert credenciais_com_conexao({}, "erro", None) is None


def test_campos_obrigatorios_seguem_o_provedor():
    assert adaptador({}).campos_obrigatorios == ("instancia_id", "instancia_token")
    assert adaptador({"provedor": "evolution"}).campos_obrigatorios == ("url_servidor", "api_key", "nome_instancia")
    assert adaptador({"provedor": "???"}).campos_obrigatorios == ("provedor",)
    assert adaptador(ZAPI).configurado and not adaptador({"provedor": "zapi", "instancia_id": "x"}).configurado


def test_token_do_webhook_confere_em_tempo_constante():
    qr = adaptador(ZAPI)
    assert qr.verificar_assinatura(b"{}", {"x-ihchat-token": "s3gredo"})
    assert not qr.verificar_assinatura(b"{}", {"x-ihchat-token": "s3gredO"})
    assert not qr.verificar_assinatura(b"{}", {})
    sem_segredo = AdaptadorWhatsAppQR(Canal(id=1, nome="x", tipo="whatsapp_qr", credenciais=ZAPI, segredo_webhook=None))
    assert not sem_segredo.verificar_assinatura(b"{}", {"x-ihchat-token": ""})


# ------------------------------------------------------------------ Z-API
def test_zapi_traduz_localizacao_contato_botoes_e_recibos():
    qr = adaptador(ZAPI)
    base = {"type": "ReceivedCallback", "phone": "5511999990000", "fromMe": False, "senderName": "Zé"}
    recebidas = []
    for i, extra in enumerate(
        (
            {"location": {"latitude": -23.5, "longitude": -46.6}},
            {"contact": {"displayName": "Maria"}},
            {"buttonsResponseMessage": {"buttonId": "1", "message": "Sim"}},
            {"listResponseMessage": {"title": "Financeiro", "message": "Financeiro"}},
            {"reaction": {"value": "x"}},  # reação não vira mensagem
            {"text": {"message": ""}},  # vazio também não
        )
    ):
        recebidas += qr.analisar_webhook({**base, "messageId": f"m{i}", **extra})
    assert [r.conteudo for r in recebidas] == ["[localizacao] -23.5,-46.6", "[contato] Maria", "Sim", "Financeiro"]
    assert recebidas[0].externo_id == "whatsapp_qr:7:m0" and recebidas[0].nome_exibicao == "Zé"

    recibos = qr.analisar_status({"type": "MessageStatusCallback", "status": "READ_BY_ME", "ids": ["a"]})
    assert recibos == []
    [falha] = qr.analisar_status({"type": "DeliveryCallback", "messageId": "b", "error": "number not exists"})
    assert (falha.externo_id, falha.status) == ("whatsapp_qr:7:b", StatusMensagem.FALHOU)


def test_zapi_mensagem_de_erro_nunca_leva_o_token():
    def falhar(pedido):
        raise httpx.ConnectError(f"sem rota para {pedido.url}")

    roteiro(falhar)
    estado = adaptador(ZAPI).estado_qr()
    assert estado.status == "erro"
    assert "token-secreto-zapi" not in estado.mensagem and "<oculto>" in estado.mensagem


def test_zapi_midia_baixada_sem_as_credenciais():
    pedidos = roteiro(lambda pedido: httpx.Response(200, content=b"bytes"))
    dados = adaptador(ZAPI).baixar_anexo(AnexoRecebido(nome="a.png", referencia="https://storage.z-api.io/x/a.png"))
    assert dados == b"bytes"
    assert "client-token" not in pedidos[0].headers
    with pytest.raises(ErroCanal):
        adaptador(ZAPI).baixar_anexo(AnexoRecebido(nome="a", referencia="file:///etc/passwd"))


# -------------------------------------------------------------- Evolution
def test_evolution_usa_o_numero_de_verdade_do_lid_ou_responde_ao_lid():
    qr = adaptador(EVOLUTION)
    com_alt = {"event": "messages.upsert", "instance": "loja", "data": {
        "key": {"remoteJid": "987654321@lid", "remoteJidAlt": "5521911112222@s.whatsapp.net", "fromMe": False, "id": "L1"},
        "pushName": "Ana", "messageType": "conversation", "message": {"conversation": "oi"},
    }}
    [recebida] = qr.analisar_webhook(com_alt)
    assert recebida.identificador == "5521911112222"

    sem_alt = json.loads(json.dumps(com_alt))
    del sem_alt["data"]["key"]["remoteJidAlt"]
    sem_alt["data"]["key"]["id"] = "L2"
    [recebida] = adaptador(EVOLUTION).analisar_webhook(sem_alt)
    assert recebida.identificador == "987654321@lid"

    pedidos = roteiro(lambda pedido: httpx.Response(201, json={"key": {"id": "S1"}}))
    resultado = adaptador(EVOLUTION).enviar("987654321@lid", "resposta", {})
    assert resultado.status is StatusMensagem.ENVIADA and resultado.externo_id == "whatsapp_qr:7:S1"
    assert json.loads(pedidos[0].content)["number"] == "987654321@lid"


def test_evolution_endereco_sem_esquema_e_erro_claro():
    estado = adaptador({**EVOLUTION, "url_servidor": "evo.teste"}).estado_qr()
    assert estado.status == "erro" and "https://" in estado.mensagem


def test_evolution_recibo_de_mensagem_recebida_e_ignorado():
    qr = adaptador(EVOLUTION)
    entrega = {"event": "MESSAGES_UPDATE", "instance": "loja",
               "data": [{"keyId": "a", "fromMe": False, "status": "READ", "remoteJid": "5511@s.whatsapp.net"},
                        {"keyId": "b", "fromMe": True, "status": "PLAYED", "remoteJid": "5511@s.whatsapp.net"}]}
    assert [(r.externo_id, r.status) for r in qr.analisar_status(entrega)] == [("whatsapp_qr:7:b", StatusMensagem.LIDA)]


# -------------------------------------------------------------- assinatura
def test_assinatura_na_primeira_linha_e_sem_duplicar():
    assinatura = {"nome": "Ana", "setor": "Suporte"}
    assert AdaptadorWhatsAppQR.com_assinatura("Oi", assinatura) == "*Ana · Suporte*\nOi"
    # se o núcleo um dia passar a assinar este tipo, o texto não ganha a linha duas vezes
    assert AdaptadorWhatsAppQR.com_assinatura("*Ana · Suporte*\nOi", assinatura) == "*Ana · Suporte*\nOi"
    assert AdaptadorWhatsAppQR.com_assinatura("", assinatura) == "*Ana · Suporte*"
    assert AdaptadorWhatsAppQR.com_assinatura("Oi", None) == "Oi"


def test_api_oficial_da_meta_na_versao_vigente():
    assert whatsapp.VERSAO_API == "v26.0"
    assert whatsapp.BASE == "https://graph.facebook.com/v26.0"


# ------------------------------------------------- resposta pelo celular
def test_resposta_pelo_celular_nao_reabre_conversa_resolvida(cliente, cabecalho_atendente):
    canal = criar_canal(TipoCanal.WHATSAPP_QR, credenciais=dict(ZAPI), segredo_webhook="segredo-do-canal")
    entrega = {"type": "ReceivedCallback", "phone": "5511933334444", "fromMe": False, "messageId": "E1", "text": {"message": "obrigado!"}}
    assert cliente.post(f"/webhooks/{canal.id}?token=segredo-do-canal", json=entrega).json()["recebidas"] == 1
    with SessaoLocal() as sessao:
        conversa = sessao.query(Conversa).filter_by(canal_id=canal.id).one()
        conversa.status = "resolvida"
        sessao.commit()
        conversa_id = conversa.id

    do_celular = {**entrega, "messageId": "C1", "fromMe": True, "text": {"message": "de nada 🙂"}}
    resposta = cliente.post(f"/webhooks/{canal.id}", headers={"X-IHchat-Token": "segredo-do-canal"}, json=do_celular)
    assert resposta.json() == {"recebidas": 0, "status_atualizados": 0, "enviadas_pelo_celular": 1}
    detalhe = cliente.get(f"/api/conversas/{conversa_id}", headers=cabecalho_atendente).json()
    assert detalhe["status"] == "resolvida", "a resposta do dono não cria trabalho para a equipe"
    assert [m["autor"] for m in detalhe["mensagens"]] == [detalhe["contato"]["nome"], "Enviada pelo celular"]

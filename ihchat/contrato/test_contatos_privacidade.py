"""Identidade unificada sem vazamento para o widget.

O histórico unificado ("um cliente, um histórico") é da EQUIPE. O navegador
anônimo do widget só pode ver o que ele mesmo conversou: juntar fichas
(mesclagem feita pela atendente, ou e-mail digitado pelo visitante) não pode
entregar a ele a conversa de WhatsApp ou e-mail de outra pessoa.

Os testes afirmam a PROPRIEDADE (o conteúdo alheio não chega ao navegador,
nem no histórico nem nos eventos), e não um jeito específico de corrigir:
tanto "a sessão acaba (401)" quanto "a sessão só enxerga a própria conversa"
passam.
"""
from __future__ import annotations

import random

from utilitarios import criar_canal, exigir_rota, unico


def numero_novo() -> str:
    return "55009" + "".join(random.choices("0123456789", k=8))


def whatsapp_entra(cliente, canal: dict, numero: str, texto: str, nome: str) -> None:
    valor = {
        "messages": [{"from": numero, "id": unico("wamid."), "type": "text", "text": {"body": texto}}],
        "contacts": [{"wa_id": numero, "profile": {"name": nome}}],
    }
    resposta = exigir_rota(
        cliente.post(f"/webhooks/{canal['id']}", json={"entry": [{"changes": [{"value": valor}]}]}),
        "POST /webhooks/{canal_id}",
    )
    assert resposta.status_code == 200, resposta.text


def unica_conversa(cliente, cabecalho, canal: dict) -> dict:
    resposta = cliente.get("/api/conversas", params={"canal_id": canal["id"]}, headers=cabecalho)
    assert resposta.status_code == 200, resposta.text
    [conversa] = resposta.json()
    return conversa


def abrir_widget(cliente, canal_webchat: dict, nome: str, texto: str = "olá", email: str | None = None) -> str:
    corpo = {"chave_publica": canal_webchat["chave_publica"], "nome": nome}
    if email:
        corpo["email"] = email
    sessao = exigir_rota(cliente.post("/api/widget/sessao", json=corpo), "POST /api/widget/sessao")
    assert sessao.status_code == 201, sessao.text
    token = sessao.json()["token"]
    enviada = cliente.post("/api/widget/mensagens", json={"conteudo": texto}, headers={"X-Sessao": token})
    assert enviada.status_code == 201, enviada.text
    return token


def cursor_do_widget(cliente, token: str) -> int | None:
    """Cursor atual dos eventos do visitante (None: o alvo não tem a rota de consulta)."""
    resposta = cliente.get("/api/widget/eventos/desde", params={"token": token})
    if resposta.status_code == 404:
        return None
    assert resposta.status_code == 200, resposta.text
    return resposta.json()["ultimo"]


def navegador_nao_ve(cliente, token: str, cursor: int | None, *segredos: str) -> None:
    """Nem o histórico nem os eventos do widget trazem o conteúdo alheio."""
    historico = cliente.get("/api/widget/mensagens", headers={"X-Sessao": token})
    assert historico.status_code in (200, 401), historico.text
    for segredo in segredos:
        assert segredo not in historico.text, f"o widget recebeu no histórico: {segredo}"
    if cursor is not None:
        eventos = cliente.get("/api/widget/eventos/desde", params={"token": token, "depois": cursor})
        assert eventos.status_code in (200, 401), eventos.text
        for segredo in segredos:
            assert segredo not in eventos.text, f"o widget recebeu nos eventos: {segredo}"


def responder(cliente, cabecalho, conversa_id: int, texto: str) -> None:
    resposta = cliente.post(f"/api/conversas/{conversa_id}/mensagens", json={"conteudo": texto}, headers=cabecalho)
    assert resposta.status_code == 201, resposta.text


# ------------------------------------------------------------- mesclagem
def test_mesclar_no_visitante_nao_entrega_a_ele_o_historico_do_outro_canal(
    cliente, cabecalho_atendente, canal_whatsapp, canal_webchat, servidor, request
):
    """O visitante do site diz ser o cliente do WhatsApp e a atendente junta
    as fichas com a do SITE como principal. Mesclar é decisão da equipe, não
    prova de identidade: o navegador anônimo não passa a ver o CPF que o
    cliente mandou pelo WhatsApp, nem as respostas seguintes por lá."""
    token = abrir_widget(cliente, canal_webchat, "Visitante que diz ser o Ian")
    principal = unica_conversa(cliente, cabecalho_atendente, canal_webchat)["contato"]
    cursor = cursor_do_widget(cliente, token)

    whatsapp_entra(cliente, canal_whatsapp, numero_novo(), "Meu CPF é 123.456.789-00", nome="Ian")
    do_zap = unica_conversa(cliente, cabecalho_atendente, canal_whatsapp)
    mescla = cliente.post(
        f"/api/contatos/{principal['id']}/mesclar/{do_zap['contato']['id']}", headers=cabecalho_atendente
    )
    assert mescla.status_code == 200, mescla.text
    assert sorted(i["canal_tipo"] for i in mescla.json()["identidades"]) == ["webchat", "whatsapp"]

    responder(cliente, cabecalho_atendente, do_zap["id"], "Sua senha provisória é X9-TEMP")
    navegador_nao_ve(cliente, token, cursor, "123.456.789-00", "X9-TEMP")


def test_mesclar_dois_visitantes_nao_mostra_a_conversa_de_um_ao_outro(
    cliente, cabecalho_atendente, canal_webchat, servidor, request
):
    """Dois navegadores no mesmo webchat, fichas juntadas pela atendente:
    nenhum dos dois passa a ler o que o outro escreveu."""
    segredo_a, segredo_b = unico("segredo-a-"), unico("segredo-b-")
    canal = canal_webchat
    token_a = abrir_widget(cliente, canal, "Visitante A", texto=segredo_a)
    token_b = abrir_widget(cliente, canal, "Visitante B", texto=segredo_b)
    por_previa = {
        c["previa"]: c
        for c in cliente.get("/api/conversas", params={"canal_id": canal["id"]}, headers=cabecalho_atendente).json()
    }
    contato_a = por_previa[segredo_a]["contato"]["id"]
    contato_b = por_previa[segredo_b]["contato"]["id"]
    cursor = cursor_do_widget(cliente, token_a)

    mescla = cliente.post(f"/api/contatos/{contato_a}/mesclar/{contato_b}", headers=cabecalho_atendente)
    assert mescla.status_code == 200, mescla.text

    navegador_nao_ve(cliente, token_a, cursor, segredo_b)
    navegador_nao_ve(cliente, token_b, cursor, segredo_a)


# ------------------------------------------ e-mail digitado no widget
# O e-mail que o visitante digita não é comprovado. A ordem "cliente escreve
# por e-mail, depois o estranho digita o endereço no widget" está em
# contrato/test_webhooks_isolamento_widget.py. Aqui fica a ordem inversa, que
# passa pela identidade unificada (Contatos::resolver junta o e-mail que
# chega à ficha que já tem aquele endereço). A correção mora no widget
# (php/app/Widget/Rotas.php e app/api/widget.py): o endereço digitado não
# pode ir para contatos.email como se fosse comprovado.
def test_email_digitado_antes_no_widget_nao_captura_o_email_real_do_cliente(
    cliente, cabecalho_admin, cabecalho_atendente, canal_webchat
):
    """Ordem inversa: o atacante digita o e-mail da vítima ANTES de ela
    escrever. O e-mail real dela não pode cair na ficha do atacante (e,
    portanto, no navegador dele)."""
    canal_email = criar_canal(cliente, cabecalho_admin, "email")
    vitima = f"{unico('cliente')}@empresa.example"
    marca = unico("oi, sou eu ")
    token = abrir_widget(cliente, canal_webchat, "Atacante", texto=marca, email=vitima)
    [do_site] = [
        c for c in cliente.get("/api/conversas", params={"canal_id": canal_webchat["id"]}, headers=cabecalho_atendente).json()
        if c["previa"] == marca
    ]
    cursor = cursor_do_widget(cliente, token)

    entrada = exigir_rota(
        cliente.post(
            "/api/simulador/mensagens",
            headers=cabecalho_atendente,
            json={"canal_id": canal_email["id"], "identificador": vitima, "conteudo": "Meu CPF é 111.222.333-44"},
        ),
        "POST /api/simulador/mensagens",
    )
    assert entrada.status_code in (200, 201), entrada.text
    conversa = unica_conversa(cliente, cabecalho_atendente, canal_email)
    responder(cliente, cabecalho_atendente, conversa["id"], "Segue o boleto: W4-TEMP")

    # e a equipe não vê a conversa do estranho como se fosse da cliente
    assert conversa["contato"]["id"] != do_site["contato"]["id"]
    navegador_nao_ve(cliente, token, cursor, "111.222.333-44", "W4-TEMP")

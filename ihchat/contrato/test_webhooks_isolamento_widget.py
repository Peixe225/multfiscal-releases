"""Isolamento entre o widget e os contatos que os webhooks criam.

O canal de e-mail (e o WhatsApp, o Telegram...) cria contatos com o endereço
de quem escreveu. O widget de webchat é público: qualquer um com a chave
pública do site (ela vai no widget.js) abre uma sessão digitando um e-mail.
Se a sessão se ligar à ficha que já tem esse e-mail, sem prova de posse, um
estranho lê as mensagens de e-mail do cliente, recebe em tempo real as
respostas dos atendentes, baixa os anexos e ainda troca o nome da ficha.

Este teste descreve o comportamento seguro sem escolher a correção: seja
criando sempre uma identidade nova, seja exigindo verificação do e-mail, a
sessão aberta só com o endereço não pode alcançar nada do que chegou por
outro canal. Corrigido nos dois alvos (php/app/Widget/Rotas.php e
app/api/widget.py): cada visitante tem a sua ficha, e o e-mail digitado fica
só nas observações, sem confirmação.
"""
from __future__ import annotations

from utilitarios import exigir_rota, unico

PDF = b"%PDF-1.4\n% boleto privado do cliente\n%%EOF\n"


def _token_do_email(cliente, cabecalho_admin, canal: dict) -> dict:
    """Cabeçalho com o segredo do webhook de e-mail (X-IHchat-Token)."""
    segredo = cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho_admin).json()["segredo_webhook"]
    return {"X-IHchat-Token": segredo} if segredo else {}


def _rota_ausente(resposta) -> bool:
    return resposta.status_code in (404, 405) and resposta.headers.get("content-type", "").startswith(
        "application/json"
    ) and resposta.json().get("detail") in ("Not Found", "Method Not Allowed")


def test_sessao_do_widget_com_email_alheio_nao_alcanca_o_que_chegou_por_email(
    cliente, cabecalho_admin, cabecalho_atendente, canal_email, canal_webchat
):
    # 1) a cliente escreve pelo canal de e-mail: o webhook cria a ficha com o endereço dela
    endereco = f"{unico('maria')}@cliente.example"
    segredo_cliente = f"SEGREDO {unico()}: meu CPF e 123.456.789-00"
    resposta = cliente.post(
        f"/webhooks/{canal_email['id']}",
        json={
            "from": f"Maria Cliente <{endereco}>",
            "subject": "Segunda via",
            "text": segredo_cliente,
            "message-id": f"<{unico()}@cliente.example>",
        },
        headers=_token_do_email(cliente, cabecalho_admin, canal_email),
    )
    assert resposta.status_code == 200 and resposta.json()["recebidas"] == 1, resposta.text
    [conversa] = cliente.get("/api/conversas", params={"canal_id": canal_email["id"]}, headers=cabecalho_atendente).json()
    contato = conversa["contato"]
    assert contato["email"] == endereco

    # 2) um estranho, sem login, abre a sessão do widget com o e-mail dela
    aberta = exigir_rota(
        cliente.post(
            "/api/widget/sessao",
            json={"chave_publica": canal_webchat["chave_publica"], "email": endereco, "nome": "Atacante"},
        ),
        "POST /api/widget/sessao",
    )
    if aberta.status_code != 201:
        return  # recusar a sessão sem verificação também protege
    sessao = aberta.json()
    vazamentos: list[str] = []

    cursor = cliente.get("/api/widget/eventos/desde", params={"token": sessao["token"]})
    tem_eventos = not _rota_ausente(cursor)
    ultimo = cursor.json()["ultimo"] if tem_eventos else None

    # 3) o histórico do widget não pode trazer o e-mail da cliente
    historico = cliente.get("/api/widget/mensagens", headers={"X-Sessao": sessao["token"]})
    assert historico.status_code == 200, historico.text
    if any(segredo_cliente in (m.get("conteudo") or "") for m in historico.json()):
        vazamentos.append("o histórico do widget mostrou a mensagem que chegou por e-mail")

    # 4) o atendente responde por e-mail, com anexo (sandbox: envio simulado)
    resposta_privada = f"segue a segunda via: link-privado-{unico()}"
    enviada = cliente.post(
        f"/api/conversas/{conversa['id']}/mensagens", json={"conteudo": resposta_privada}, headers=cabecalho_atendente
    )
    assert enviada.status_code == 201, enviada.text
    com_anexo = exigir_rota(
        cliente.post(
            f"/api/conversas/{conversa['id']}/anexos",
            headers=cabecalho_atendente,
            files={"arquivo": ("boleto.pdf", PDF, "application/pdf")},
        ),
        "POST /api/conversas/{id}/anexos",
    )
    assert com_anexo.status_code == 201, com_anexo.text
    anexo_id = com_anexo.json()["anexos"][0]["id"]

    # 5) nem em tempo real, nem no histórico seguinte, nem pelo download do widget
    if tem_eventos:
        novos = cliente.get("/api/widget/eventos/desde", params={"token": sessao["token"], "depois": ultimo})
        assert novos.status_code == 200, novos.text
        if any(resposta_privada in str(e.get("dados")) for e in novos.json()["eventos"]):
            vazamentos.append("os eventos do widget entregaram a resposta do atendente por e-mail")
    depois = cliente.get("/api/widget/mensagens", headers={"X-Sessao": sessao["token"]}).json()
    if any(resposta_privada in (m.get("conteudo") or "") for m in depois):
        vazamentos.append("o histórico do widget mostrou a resposta do atendente por e-mail")
    baixado = cliente.get(f"/api/widget/anexos/{anexo_id}", params={"token": sessao["token"]})
    if not _rota_ausente(baixado) and baixado.status_code == 200 and baixado.content == PDF:
        vazamentos.append("o widget baixou o anexo da conversa de e-mail")

    # 6) e a ficha da cliente continua com o nome dela
    ficha = cliente.get(f"/api/contatos/{contato['id']}", headers=cabecalho_atendente)
    if ficha.status_code == 200 and ficha.json()["nome"] != "Maria Cliente":
        vazamentos.append(f"a sessão do widget renomeou a ficha para {ficha.json()['nome']!r}")

    assert vazamentos == [], "; ".join(vazamentos)

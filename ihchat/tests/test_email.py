"""Canal de e-mail: entrada por webhook, coleta e contexto da resposta."""
from conftest import TOKEN_EMAIL, criar_canal

from app.canais.registro import adaptador_para
from app.canais.base import MensagemRecebida
from app.coletor import coletar_uma_vez
from app.db import SessaoLocal
from app.models import Canal, Conversa, TipoCanal
from app.servicos.mensagens import contexto_de_envio


def test_webhook_de_provedor_de_email_abre_conversa_com_assunto(cliente):
    canal = criar_canal(TipoCanal.EMAIL, "Suporte")
    resposta = cliente.post(
        f"/webhooks/{canal.id}",
        json={
            "from": "Financeiro Loja <Financeiro@Loja.com.BR>",
            "subject": "Segunda via do boleto",
            "text": "Bom dia, preciso da segunda via.\n",
            "message-id": "<abc@loja.com.br>",
        },
        headers=TOKEN_EMAIL,
    )
    assert resposta.json()["recebidas"] == 1
    with SessaoLocal() as sessao:
        conversa = sessao.query(Conversa).one()
        assert conversa.assunto == "Segunda via do boleto"
        assert conversa.contato.email == "financeiro@loja.com.br"
        # com o canal: o mesmo Message-ID mandado a duas caixas chega nas duas
        assert conversa.mensagens[0].externo_id == f"email:{canal.id}:<abc@loja.com.br>"


def test_email_sem_remetente_ou_corpo_e_ignorado(cliente):
    canal = criar_canal(TipoCanal.EMAIL, "Suporte")
    assert cliente.post(f"/webhooks/{canal.id}", json={"subject": "vazio"}, headers=TOKEN_EMAIL).json()["recebidas"] == 0


def test_webhook_de_email_sem_o_segredo_do_canal_e_recusado(cliente):
    canal = criar_canal(TipoCanal.EMAIL, "Suporte")
    corpo = {"from": "cliente@empresa.com.br", "text": "Cancelem meu pedido"}
    for cabecalhos in ({}, {"X-IHchat-Token": "chute"}):
        resposta = cliente.post(f"/webhooks/{canal.id}", json=corpo, headers=cabecalhos)
        assert resposta.status_code == 401
    # o provedor não escolhe cabeçalhos: o token também vale na URL cadastrada
    resposta = cliente.post(f"/webhooks/{canal.id}", params={"token": TOKEN_EMAIL["X-IHchat-Token"]}, json=corpo)
    assert resposta.json()["recebidas"] == 1
    sem_segredo = criar_canal(TipoCanal.EMAIL, "Legado", segredo_webhook=None)
    assert cliente.post(f"/webhooks/{sem_segredo.id}", json=corpo, headers=TOKEN_EMAIL).status_code == 401


def test_resposta_reaproveita_assunto_e_thread(cliente, sessao):
    canal = criar_canal(TipoCanal.EMAIL, "Suporte")
    cliente.post(
        f"/webhooks/{canal.id}",
        json={
            "from": "cliente@empresa.com.br",
            "subject": "Erro na apuração",
            "text": "Segue o print.",
            "message-id": "<original@empresa.com.br>",
        },
        headers=TOKEN_EMAIL,
    )
    with SessaoLocal() as s:
        conversa = s.query(Conversa).one()
        # a referencia da thread vem dos metadados da ultima mensagem recebida
        conversa.mensagens[0].metadados = {"referencias": "<original@empresa.com.br>"}
        s.commit()
        contexto = contexto_de_envio(s, conversa)

    assert contexto["assunto"] == "Erro na apuração"
    assert contexto["referencia"] == "<original@empresa.com.br>"


def test_coletor_traz_as_mensagens_da_caixa(monkeypatch):
    canal = criar_canal(
        TipoCanal.EMAIL,
        "Caixa só de leitura",
        credenciais={"imap_host": "imap.provedor.com.br", "imap_usuario": "u", "imap_senha": "s"},
    )
    # sem credenciais de SMTP o canal nao envia, mas precisa continuar lendo
    with SessaoLocal() as sessao:
        assert adaptador_para(sessao.get(Canal, canal.id)).configurado is False

    monkeypatch.setattr(
        "app.canais.email.AdaptadorEmail.coletar",
        lambda self: [
            MensagemRecebida(
                identificador="cliente@empresa.com.br",
                conteudo="Chegou por IMAP",
                nome_exibicao="Cliente",
                externo_id="email:<imap-1@empresa.com.br>",
                assunto="Dúvida",
            )
        ],
    )

    assert coletar_uma_vez() == 1
    # o id externo evita reprocessar a mesma mensagem numa segunda passada
    assert coletar_uma_vez() == 0
    with SessaoLocal() as sessao:
        conversa = sessao.query(Conversa).one()
        assert conversa.mensagens[0].conteudo == "Chegou por IMAP"


def test_coletor_ignora_canal_sem_imap(monkeypatch):
    criar_canal(TipoCanal.EMAIL, "Só envio", credenciais={"smtp_host": "smtp.x"})
    assert coletar_uma_vez() == 0


def test_coletor_sobrevive_a_falha_de_um_canal(monkeypatch):
    from app.canais.base import ErroCanal

    criar_canal(TipoCanal.EMAIL, "Caixa instável", credenciais={"imap_host": "imap.x"})

    def explodir(self):
        raise ErroCanal("servidor recusou a conexão")

    monkeypatch.setattr("app.canais.email.AdaptadorEmail.coletar", explodir)
    assert coletar_uma_vez() == 0  # o erro é registrado, não propagado

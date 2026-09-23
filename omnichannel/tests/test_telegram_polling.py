"""Telegram por polling: coleta com getUpdates, offset, conflitos e verificação da conexão.

Nenhum teste toca a rede: a API do Telegram é simulada com MockTransport.
"""
import asyncio
import json
import logging

import httpx
import pytest
from conftest import criar_canal

from app import coletor
from app.canais import http as canal_http
from app.canais.base import ErroCanal
from app.canais.registro import adaptador_para
from app.canais.telegram import esquecer_offsets
from app.coletor import CanalAtivo, canais_a_coletar, coletar_uma_vez
from app.db import SessaoLocal
from app.models import Anexo, Canal, Mensagem, TipoCanal

PNG = b"\x89PNG\r\n\x1a\n" + b"conteudo falso de imagem"

CONFLITO_WEBHOOK = (
    "Conflict: can't use getUpdates method while webhook is active; "
    "use deleteWebhook to delete the webhook first"
)
CONFLITO_INSTANCIA = (
    "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running"
)


@pytest.fixture(autouse=True)
def offsets_zerados():
    # o offset vive em memória no módulo; cada teste começa como um servidor recém-ligado
    esquecer_offsets()
    yield
    esquecer_offsets()


def transporte(handler):
    canal_http.definir_transporte(httpx.MockTransport(handler))


def metodo(requisicao: httpx.Request) -> str:
    return requisicao.url.path.rsplit("/", 1)[-1]


def corpo(requisicao: httpx.Request) -> dict:
    return json.loads(requisicao.content or b"{}")


def ok(resultado) -> httpx.Response:
    return httpx.Response(200, json={"ok": True, "result": resultado})


def recusa(status: int, descricao: str) -> httpx.Response:
    return httpx.Response(status, json={"ok": False, "error_code": status, "description": descricao})


def update(update_id: int, texto: str, chat_id: int = 7, message_id: int | None = None, **extras) -> dict:
    mensagem = {
        "message_id": message_id or update_id,
        "chat": {"id": chat_id},
        "from": {"first_name": "Ana", "last_name": "Souza", "username": "anasouza"},
        **({"text": texto} if texto else {}),
        **extras,
    }
    return {"update_id": update_id, "message": mensagem}


def canal_polling(nome: str = "Telegram", token: str = "tk", **credenciais):
    return criar_canal(TipoCanal.TELEGRAM, nome, credenciais={"token": token, **credenciais})


# ---------------------------------------------------------------- coleta
def test_updates_viram_mensagens_na_caixa_de_entrada(cliente, cabecalho_atendente):
    canal_polling()
    transporte(
        lambda r: ok([update(100, "Oi, preciso de ajuda", chat_id=7), update(101, "Boa tarde", chat_id=8)])
    )

    assert coletar_uma_vez() == 2

    conversas = cliente.get("/api/conversas", headers=cabecalho_atendente).json()
    assert sorted(c["previa"] for c in conversas) == ["Boa tarde", "Oi, preciso de ajuda"]
    with SessaoLocal() as sessao:
        externos = sorted(m.externo_id for m in sessao.query(Mensagem))
    # mesmo formato do webhook: quem trocar de modo não recebe tudo em dobro
    assert externos == ["telegram:7-100", "telegram:8-101"]


def test_segundo_getupdates_manda_o_offset_avancado():
    canal_polling()
    pedidos = []

    def responder(requisicao):
        pedidos.append(corpo(requisicao))
        return ok([update(41, "a"), update(43, "b")] if len(pedidos) == 1 else [])

    transporte(responder)
    assert coletar_uma_vez() == 2
    assert coletar_uma_vez() == 0

    primeiro, segundo = pedidos
    assert "offset" not in primeiro  # sem memória: o Telegram manda tudo o que não foi confirmado
    assert primeiro["allowed_updates"] == ["message", "edited_message", "channel_post"]
    assert 0 < primeiro["timeout"] <= 5  # espera curta, para não prender o coletor
    assert segundo["offset"] == 44  # max(update_id) + 1 confirma os dois de uma vez


def test_update_repetido_nao_duplica_nem_depois_de_reiniciar():
    canal_polling()
    transporte(lambda r: ok([update(7, "Oi")]))

    assert coletar_uma_vez() == 1
    # reinício do servidor: o offset some e o Telegram reentrega o que não foi
    # confirmado; o id externo único descarta a repetida
    esquecer_offsets()
    assert coletar_uma_vez() == 0
    with SessaoLocal() as sessao:
        assert sessao.query(Mensagem).count() == 1


def test_trocar_o_token_recomeca_o_offset():
    canal = canal_polling(token="bot-antigo")
    pedidos = []

    def responder(requisicao):
        pedidos.append((requisicao.url.path, corpo(requisicao)))
        return ok([update(500, "do bot antigo")] if "bot-antigo" in requisicao.url.path else [])

    transporte(responder)
    coletar_uma_vez()
    with SessaoLocal() as sessao:
        sessao.get(Canal, canal.id).credenciais = {"token": "bot-novo"}
        sessao.commit()
    coletar_uma_vez()

    caminho, pedido = pedidos[-1]
    assert "bot-novo" in caminho
    # o offset 501 do bot antigo esconderia as primeiras mensagens do novo
    assert "offset" not in pedido


def test_modo_webhook_nao_chama_a_api():
    canal_polling(modo_recebimento="webhook")
    chamadas = []
    transporte(lambda r: chamadas.append(r) or ok([]))

    assert coletar_uma_vez() == 0
    assert chamadas == []


def test_sem_token_nao_chama_a_api():
    criar_canal(TipoCanal.TELEGRAM, "Telegram sem token")
    chamadas = []
    transporte(lambda r: chamadas.append(r) or ok([]))

    assert coletar_uma_vez() == 0
    assert chamadas == []


@pytest.mark.parametrize(
    "descricao, trecho",
    [(CONFLITO_WEBHOOK, "webhook ativo"), (CONFLITO_INSTANCIA, "outra instância")],
)
def test_conflito_409_e_registrado_sem_derrubar_outro_canal(caplog, descricao, trecho):
    canal_polling("Bot em conflito", token="conflito")
    canal_polling("Bot saudável", token="saudavel")

    def responder(requisicao):
        if "/botconflito/" in requisicao.url.path:
            return recusa(409, descricao)
        return ok([update(1, "chegou mesmo assim")])

    transporte(responder)
    with caplog.at_level(logging.WARNING, logger="omnichannel.coletor"):
        assert coletar_uma_vez() == 1

    avisos = [r.getMessage() for r in caplog.records if r.name == "omnichannel.coletor"]
    assert len(avisos) == 1
    assert "Bot em conflito" in avisos[0] and trecho in avisos[0]


def test_409_nao_apaga_o_webhook_do_bot():
    canal_polling()
    chamados = []

    def responder(requisicao):
        chamados.append(metodo(requisicao))
        return recusa(409, CONFLITO_WEBHOOK)

    transporte(responder)
    coletar_uma_vez()
    # apagar o webhook muda o bot do usuário; o sistema só explica as saídas
    assert chamados == ["getUpdates"]


def test_token_do_bot_nao_vai_para_o_log(caplog):
    canal = canal_polling(token="123:segredo")
    transporte(lambda r: ok([update(1, "oi")] if metodo(r) == "getUpdates" else {"message_id": 2}))

    with caplog.at_level(logging.INFO, logger="httpx"):
        coletar_uma_vez()
        adaptador_para(canal).enviar("7", "resposta")

    linhas = [r.getMessage() for r in caplog.records if r.name == "httpx"]
    # o getUpdates de rotina, a cada 3 s, afogaria o log; o envio continua visível
    assert not any("getUpdates" in linha for linha in linhas)
    assert any("/bot<token>/sendMessage" in linha for linha in linhas)
    assert not any("123:segredo" in linha for linha in linhas)


def test_foto_recebida_por_polling_vira_anexo():
    canal_polling()

    def responder(requisicao):
        if metodo(requisicao) == "getUpdates":
            foto = [{"file_id": "pequena"}, {"file_id": "grande"}]
            return ok([update(9, "", caption="olha o erro", photo=foto)])
        if metodo(requisicao) == "getFile":
            assert requisicao.url.params["file_id"] == "grande"  # o maior tamanho
            return ok({"file_path": "photos/f.jpg"})
        if requisicao.url.path == "/file/bottk/photos/f.jpg":
            return httpx.Response(200, content=PNG)
        return httpx.Response(404)

    transporte(responder)
    assert coletar_uma_vez() == 1

    with SessaoLocal() as sessao:
        anexo = sessao.query(Anexo).one()
        assert anexo.erro is None
        assert anexo.externo_id == "grande"
        assert anexo.tamanho == len(PNG)
        assert anexo.mensagem.conteudo == "olha o erro"


# --------------------------------------------------------- verificação
def adaptador(**credenciais):
    return adaptador_para(canal_polling(**credenciais))


def api_do_bot(webhook: str = "", status_getme: int = 200):
    def responder(requisicao):
        if metodo(requisicao) == "getMe":
            if status_getme != 200:
                return recusa(status_getme, "Unauthorized" if status_getme == 401 else "Not Found")
            return ok({"id": 1, "is_bot": True, "first_name": "Suporte", "username": "suporte_bot"})
        if metodo(requisicao) == "getWebhookInfo":
            return ok({"url": webhook, "pending_update_count": 0})
        return httpx.Response(404)

    return responder


def test_verificar_conexao_feliz():
    transporte(api_do_bot())
    assert adaptador().verificar_conexao() == "Conectado como @suporte_bot"


@pytest.mark.parametrize("status", [401, 404])
def test_verificar_conexao_com_token_recusado(status):
    # token com formato inválido o Telegram devolve como 404, não 401
    transporte(api_do_bot(status_getme=status))
    with pytest.raises(ErroCanal, match="token recusado pelo Telegram"):
        adaptador(token="123:errado").verificar_conexao()


def test_verificar_conexao_aponta_conflito_de_webhook_no_modo_polling():
    transporte(api_do_bot(webhook="https://servidor-antigo.com.br/hook"))
    with pytest.raises(ErroCanal) as erro:
        adaptador(token="123:segredo").verificar_conexao()

    mensagem = str(erro.value)
    assert "webhook ativo" in mensagem and "https://servidor-antigo.com.br/hook" in mensagem
    # as duas saídas: trocar o modo ou remover o webhook
    assert "'webhook'" in mensagem and "deleteWebhook" in mensagem
    assert "123:segredo" not in mensagem  # a mensagem vai para a tela e para o log


def test_verificar_conexao_no_modo_webhook():
    transporte(api_do_bot(webhook="https://meu-host/webhooks/1"))
    assert adaptador(modo_recebimento="webhook").verificar_conexao() == "Conectado como @suporte_bot"

    transporte(api_do_bot(webhook=""))
    aviso = adaptador(modo_recebimento="webhook").verificar_conexao()
    assert aviso.startswith("Conectado como @suporte_bot") and "setWebhook" in aviso


def test_verificar_conexao_sem_rede_e_sem_token():
    def sem_rede(requisicao):
        raise httpx.ConnectError("sem rota para o host")

    transporte(sem_rede)
    with pytest.raises(ErroCanal, match="falha de rede"):
        adaptador().verificar_conexao()

    sem_token = adaptador_para(criar_canal(TipoCanal.TELEGRAM, "Sem token"))
    with pytest.raises(ErroCanal, match="preencha: token"):
        sem_token.verificar_conexao()


# --------------------------------------------------------------- agenda
def test_agenda_separa_polling_rapido_de_imap_lento():
    telegram = CanalAtivo(1, TipoCanal.TELEGRAM.value, "Telegram")
    email = CanalAtivo(2, TipoCanal.EMAIL.value, "E-mail")
    canais = [telegram, email]

    def devidos(ultima, agora, em_andamento=()):
        return canais_a_coletar(canais, ultima, set(em_andamento), agora, 3, 60)

    # recém-ligado: todo mundo entra já
    assert devidos({}, agora=1000) == [telegram, email]
    ultima = {1: 1000.0, 2: 1000.0}
    assert devidos(ultima, agora=1002) == []
    assert devidos(ultima, agora=1003) == [telegram]  # o chat anda a cada 3 s...
    assert devidos(ultima, agora=1059) == [telegram]
    assert devidos(ultima, agora=1060) == [telegram, email]  # ...o IMAP a cada minuto
    # coleta ainda em andamento não é disparada de novo (evita 409 e fila de IMAP)
    assert devidos(ultima, agora=1060, em_andamento=[2]) == [telegram]


def test_laco_continua_quando_um_canal_falha_e_nao_repete_o_aviso(caplog):
    canal_polling("Bot em conflito", token="conflito")
    canal_polling("Bot saudável", token="saudavel")
    tentativas = {"conflito": 0}

    def responder(requisicao):
        if "/botconflito/" in requisicao.url.path:
            tentativas["conflito"] += 1
            return recusa(409, CONFLITO_INSTANCIA)
        return ok([update(1, "chegou pelo laço")])

    transporte(responder)

    async def rodar():
        tarefa = asyncio.create_task(coletor.laco(intervalo_coleta=60, intervalo_polling=1))
        # três tentativas do bot em conflito provam que o laço seguiu girando
        for _ in range(100):
            if tentativas["conflito"] >= 3:
                break
            await asyncio.sleep(0.05)
        vivo = not tarefa.done()
        tarefa.cancel()
        with pytest.raises(asyncio.CancelledError):
            await tarefa
        return vivo

    with caplog.at_level(logging.WARNING, logger="omnichannel.coletor"):
        assert asyncio.run(rodar()) is True

    assert tentativas["conflito"] >= 3
    with SessaoLocal() as sessao:
        assert sessao.query(Mensagem).one().conteudo == "chegou pelo laço"
    avisos = [r.getMessage() for r in caplog.records if r.name == "omnichannel.coletor"]
    # o mesmo erro a cada ciclo viraria ruído: registra uma vez só
    assert len(avisos) == 1 and "outra instância" in avisos[0]

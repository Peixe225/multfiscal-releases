"""Telegram por polling: coleta com getUpdates, offset, conflitos e verificação da conexão.

Nenhum teste toca a rede: a API do Telegram é simulada com MockTransport.
"""
import asyncio
import contextlib
import json
import logging
import re
import sqlite3
import threading
import time

import httpx
import pytest
from conftest import criar_canal
from sqlalchemy.exc import OperationalError

from app import coletor
from app.armazenamento import ArmazenamentoLocal, definir_armazenamento
from app.canais import http as canal_http
from app.canais.base import ErroCanal
from app.canais.registro import adaptador_para
from app.canais.telegram import ESPERA_GETUPDATES, esquecer_offsets
from app.coletor import (
    JANELA_RECUPERACAO,
    CanalAtivo,
    SituacaoColeta,
    anotar_resultado,
    canais_a_coletar,
    coletar_uma_vez,
    repetidos,
)
from app.db import SessaoLocal
from app.models import Anexo, Canal, Contato, ContatoIdentidade, Conversa, Mensagem, TipoCanal

PNG = b"\x89PNG\r\n\x1a\n" + b"conteudo falso de imagem"
PDF = b"%PDF-1.4 contrato falso"

CONFLITO_WEBHOOK = (
    "Conflict: can't use getUpdates method while webhook is active; "
    "use deleteWebhook to delete the webhook first"
)
CONFLITO_INSTANCIA = (
    "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running"
)


def esperar_threads_do_coletor(prazo: float = 5.0) -> None:
    # as threads do laço são daemon e seguem depois do cancelamento; sem
    # esperar, uma delas gravaria no banco do teste seguinte
    for thread in threading.enumerate():
        if thread.name.startswith("coletor-"):
            thread.join(prazo)


@pytest.fixture(autouse=True)
def memoria_zerada():
    # offset e situação vivem em memória no módulo; cada teste começa como um servidor recém-ligado
    esquecer_offsets()
    coletor.esquecer_situacoes()
    yield
    esperar_threads_do_coletor()
    esquecer_offsets()
    coletor.esquecer_situacoes()


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


class TelegramFalso:
    """Bot API que segue a regra do offset: pedir com offset=N apaga os updates menores que N.

    Sem essa regra, um teste não enxerga a perda: o update "confirmado cedo
    demais" continuaria disponível na simulação, e não no Telegram de verdade.
    """

    def __init__(self):
        self.fila: list[dict] = []
        self.offsets: list[int | None] = []
        self.arquivos: dict[str, bytes] = {}

    def chegar(self, *updates: dict) -> None:
        self.fila.extend(updates)

    def responder(self, requisicao: httpx.Request) -> httpx.Response:
        if metodo(requisicao) == "getUpdates":
            offset = corpo(requisicao).get("offset")
            self.offsets.append(offset)
            if offset is not None:
                self.fila = [u for u in self.fila if u["update_id"] >= offset]
            return ok(list(self.fila))
        if metodo(requisicao) == "getFile":
            return ok({"file_path": f"docs/{requisicao.url.params['file_id']}"})
        if requisicao.url.path.startswith("/file/bot"):
            return httpx.Response(200, content=self.arquivos[metodo(requisicao)])
        return httpx.Response(404)


def conteudos() -> list[str]:
    with SessaoLocal() as sessao:
        return sorted(m.conteudo for m in sessao.query(Mensagem))


# ---------------------------------------------------------------- coleta
def test_updates_viram_mensagens_na_caixa_de_entrada(cliente, cabecalho_atendente):
    canal = canal_polling()
    transporte(
        lambda r: ok([update(100, "Oi, preciso de ajuda", chat_id=7), update(101, "Boa tarde", chat_id=8)])
    )

    assert coletar_uma_vez() == 2

    conversas = cliente.get("/api/conversas", headers=cabecalho_atendente).json()
    assert sorted(c["previa"] for c in conversas) == ["Boa tarde", "Oi, preciso de ajuda"]
    with SessaoLocal() as sessao:
        externos = sorted(m.externo_id for m in sessao.query(Mensagem))
    # mesmo formato do webhook: quem trocar de modo não recebe tudo em dobro
    assert externos == [f"telegram:{canal.id}:7-100", f"telegram:{canal.id}:8-101"]


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


def test_getupdates_tem_prazo_de_leitura_curto():
    canal_polling()
    prazos = []
    transporte(lambda r: prazos.append(r.extensions["timeout"]) or ok([]))

    coletar_uma_vez()
    # o timeout_http geral (15 s) somado à espera deixava uma API muda
    # prender a coleta do canal por 17 s a cada tentativa
    assert ESPERA_GETUPDATES < prazos[0]["read"] <= ESPERA_GETUPDATES + 5


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
    [(CONFLITO_WEBHOOK, "webhook ativo"), (CONFLITO_INSTANCIA, "outra cópia do OmniChannel")],
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


def test_download_que_falha_registra_o_anexo_sem_voltar_a_rede():
    canal_polling()
    arquivos_pedidos = []

    def responder(requisicao):
        if metodo(requisicao) == "getUpdates":
            return ok([update(9, "", caption="segue o boleto", document={"file_id": "boleto"})])
        arquivos_pedidos.append(metodo(requisicao))
        return recusa(400, "Bad Request: file is too big")

    transporte(responder)
    assert coletar_uma_vez() == 1

    with SessaoLocal() as sessao:
        anexo = sessao.query(Anexo).one()
        assert "file is too big" in anexo.erro and anexo.externo_id == "boleto"
    # a gravação usa o erro guardado na coleta; uma segunda tentativa ali
    # seria rede dentro da transação do banco
    assert arquivos_pedidos == ["getFile"]


# ---------------------------------------- confirmação só depois de gravar
def test_falha_ao_gravar_nao_confirma_o_lote(monkeypatch):
    canal_polling()
    telegram = TelegramFalso()
    telegram.chegar(update(10, "Oi", chat_id=1), update(11, "Quero comprar", chat_id=2))
    transporte(telegram.responder)
    original = coletor.registrar_entrada
    travar = {"Quero comprar": 1}

    def registrar(sessao, canal, recebida):
        if travar.get(recebida.conteudo):
            travar[recebida.conteudo] -= 1
            # outro gravador segurou o SQLite além dos 5 s de espera
            raise OperationalError("INSERT INTO contatos", {}, sqlite3.OperationalError("database is locked"))
        return original(sessao, canal, recebida)

    monkeypatch.setattr(coletor, "registrar_entrada", registrar)

    coletar_uma_vez()  # a falha fica no log e na situação, não sobe
    assert conteudos() == ["Oi"]
    assert len(telegram.fila) == 2  # nada confirmado: o Telegram ainda tem o lote

    # o lote volta inteiro; "Oi" morre na deduplicação e "Quero comprar" entra
    assert coletar_uma_vez() == 1
    coletar_uma_vez()
    assert conteudos() == ["Oi", "Quero comprar"]
    assert telegram.offsets == [None, None, 12]
    assert telegram.fila == []


def test_disco_cheio_segura_o_lote_ate_voltar(tmp_path):
    canal_polling()
    telegram = TelegramFalso()
    telegram.arquivos["foto"] = PNG
    telegram.chegar(
        update(10, "Ana aqui", chat_id=1),
        update(11, "", chat_id=2, caption="print do erro", photo=[{"file_id": "foto"}]),
        update(12, "Carla aqui", chat_id=3),
    )
    transporte(telegram.responder)

    class DiscoCheio(ArmazenamentoLocal):
        cheio = True

        def salvar(self, dados, nome):
            if self.cheio:
                raise OSError(28, "No space left on device")
            return super().salvar(dados, nome)

    disco = DiscoCheio(tmp_path / "anexos-cheio")
    definir_armazenamento(disco)

    coletar_uma_vez()
    assert conteudos() == ["Ana aqui"]
    assert len(telegram.fila) == 3  # nada confirmado

    disco.cheio = False
    assert coletar_uma_vez() == 2
    coletar_uma_vez()
    assert conteudos() == ["Ana aqui", "Carla aqui", "print do erro"]
    assert telegram.fila == []
    with SessaoLocal() as sessao:
        assert sessao.query(Anexo).one().tamanho == len(PNG)


def test_mensagem_com_defeito_e_pulada_sem_levar_as_do_lote(monkeypatch, caplog):
    canal_polling()
    telegram = TelegramFalso()
    telegram.chegar(
        update(10, "Ana", chat_id=1), update(11, "Bruno", chat_id=2), update(12, "Carla", chat_id=3)
    )
    transporte(telegram.responder)
    original = coletor.registrar_entrada

    def registrar(sessao, canal, recebida):
        if recebida.conteudo == "Bruno":
            raise ValueError("formato que nunca vai gravar")
        return original(sessao, canal, recebida)

    monkeypatch.setattr(coletor, "registrar_entrada", registrar)

    with caplog.at_level(logging.ERROR, logger="omnichannel.coletor"):
        assert coletar_uma_vez() == 2
    coletar_uma_vez()

    assert conteudos() == ["Ana", "Carla"]
    # um defeito permanente não pode travar a fila do bot para sempre
    assert telegram.fila == []
    assert any("descartada" in r.getMessage() for r in caplog.records)


def test_mesmo_cliente_em_dois_bots_ao_mesmo_tempo_nao_perde_mensagem(monkeypatch):
    canal_polling()
    telegram = TelegramFalso()
    telegram.chegar(update(10, "Quero comprar", chat_id=7))
    transporte(telegram.responder)
    from app.servicos import contatos

    original = contatos._por_dado_conhecido
    corrida = {"pendente": True}

    def outra_thread_grava_antes(sessao, canal_tipo, identificador):
        # entre a consulta e a gravação, a coleta do outro bot cria a mesma identidade
        if corrida.pop("pendente", False):
            with SessaoLocal() as outra:
                contato = Contato(nome="Ana (pelo outro bot)")
                outra.add(contato)
                outra.flush()
                outra.add(ContatoIdentidade(contato_id=contato.id, canal_tipo="telegram", identificador="7"))
                outra.commit()
        return original(sessao, canal_tipo, identificador)

    monkeypatch.setattr(contatos, "_por_dado_conhecido", outra_thread_grava_antes)

    assert coletar_uma_vez() == 1
    with SessaoLocal() as sessao:
        assert sessao.query(Contato).count() == 1
        assert sessao.query(Mensagem).one().conversa.contato.nome == "Ana (pelo outro bot)"


def test_download_lento_de_um_bot_nao_trava_a_gravacao_de_outro():
    canal_polling("Vendas", token="vendas")
    canal_polling("Suporte", token="suporte")
    download_comecou = threading.Event()
    gravou_durante_o_download = {}

    def gravada(texto):
        with SessaoLocal() as sessao:
            return sessao.query(Mensagem).filter_by(conteudo=texto).count() > 0

    documento = {"file_id": "contrato", "file_name": "contrato.pdf", "mime_type": "application/pdf"}
    vendas, suporte = TelegramFalso(), TelegramFalso()
    vendas.chegar(update(20, "", chat_id=1, caption="segue o contrato", document=documento))
    suporte.chegar(update(21, "Oi, preciso de suporte", chat_id=2))

    def responder(requisicao):
        token = re.search(r"/bot([^/]+)/", requisicao.url.path).group(1)
        if token == "suporte" and metodo(requisicao) == "getUpdates":
            # o cliente do Suporte escreve enquanto o PDF do Vendas desce
            download_comecou.wait(3)
        if token == "vendas" and requisicao.url.path.startswith("/file/"):
            download_comecou.set()
            # download lento: só termina quando o Suporte gravou (ou em 3 s).
            # Com a rede dentro da transação, o Vendas seguraria o SQLite e o
            # Suporte ficaria esperando a trava até desistir.
            prazo = time.monotonic() + 3
            while time.monotonic() < prazo and not gravada("Oi, preciso de suporte"):
                time.sleep(0.05)
            gravou_durante_o_download["suporte"] = gravada("Oi, preciso de suporte")
            return httpx.Response(200, content=PDF)
        return (vendas if token == "vendas" else suporte).responder(requisicao)

    transporte(responder)

    async def rodar():
        tarefa = asyncio.create_task(coletor.laco(intervalo_coleta=60, intervalo_polling=1))
        for _ in range(200):
            if len(conteudos()) == 2 and not vendas.fila and not suporte.fila:
                break
            await asyncio.sleep(0.05)
        tarefa.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await tarefa

    asyncio.run(rodar())

    assert gravou_durante_o_download == {"suporte": True}
    assert conteudos() == ["Oi, preciso de suporte", "segue o contrato"]
    assert vendas.fila == [] and suporte.fila == []  # confirmados só depois de gravados
    with SessaoLocal() as sessao:
        assert sessao.query(Anexo).one().tamanho == len(PDF)


# ------------------------------------------------ mesmo token, dois canais
def test_chave_de_coleta_identifica_o_bot_sem_expor_o_token():
    def chave(**credenciais):
        return adaptador_para(canal_polling(**credenciais)).chave_coleta

    mesmo = chave(token="123:segredo")
    assert mesmo == chave(token="123:segredo") != chave(token="456:outro")
    assert "segredo" not in mesmo
    # no modo webhook o Telegram entrega num endereço só: ninguém disputa o getUpdates
    assert chave(token="123:segredo", modo_recebimento="webhook") is None


def test_agenda_so_deixa_o_canal_mais_antigo_buscar_o_mesmo_bot():
    antigo = CanalAtivo(1, TipoCanal.TELEGRAM.value, "Bot antigo", "telegram:abc")
    email = CanalAtivo(2, TipoCanal.EMAIL.value, "E-mail")
    novo = CanalAtivo(3, TipoCanal.TELEGRAM.value, "Bot novo", "telegram:abc")
    outro = CanalAtivo(4, TipoCanal.TELEGRAM.value, "Outro bot", "telegram:xyz")
    canais = [novo, antigo, email, outro]

    assert repetidos(canais) == {3: antigo}
    assert canais_a_coletar(canais, {}, set(), 0, 3, 60) == [antigo, email, outro]


def test_canal_estranho_nao_impede_a_coleta_dos_outros():
    with SessaoLocal() as sessao:
        # tipo que o registro não conhece: a listagem monta o adaptador de
        # todos para achar repetidos, e um erro ali pararia a coleta de todos
        sessao.add(Canal(nome="Canal legado", tipo="fax", credenciais={}, ativo=True))
        sessao.commit()
    canal_polling(token=12345)  # token salvo como número, via curl
    transporte(lambda r: ok([update(1, "chegou")]))

    assert [c.nome for c in coletor.canais_ativos()] == ["Canal legado", "Telegram"]
    assert coletar_uma_vez() == 1


def test_mesmo_token_em_dois_canais_nao_divide_o_cliente(caplog):
    antigo = canal_polling("Bot antigo", token="mesmo")
    novo = canal_polling("Bot novo", token="mesmo")
    telegram = TelegramFalso()
    transporte(telegram.responder)

    with caplog.at_level(logging.WARNING, logger="omnichannel.coletor"):
        for i in range(4):
            telegram.chegar(update(100 + i, f"msg {i}", chat_id=7))
            coletar_uma_vez()

    with SessaoLocal() as sessao:
        conversa = sessao.query(Conversa).one()  # um cliente, uma conversa
        assert conversa.canal_id == antigo.id
        assert sorted(m.conteudo for m in conversa.mensagens) == ["msg 0", "msg 1", "msg 2", "msg 3"]
    avisos = [r.getMessage() for r in caplog.records if r.name == "omnichannel.coletor"]
    # a instrução aponta o outro canal deste servidor, não "outro computador"
    assert len(avisos) == 1 and "Bot novo" in avisos[0] and "'Bot antigo'" in avisos[0]
    assert coletor.situacao(novo.id)["recebendo"] is False
    assert coletor.situacao(antigo.id)["recebendo"] is True


# -------------------------------------------------- situação da coleta
def test_situacao_so_diz_que_voltou_depois_de_uma_janela_sem_erro():
    situacao = SituacaoColeta()
    assert anotar_resultado(situacao, "409", 0) == "falhou"
    # outra cópia disputando o bot: um sucesso no meio não quer dizer que acabou
    assert anotar_resultado(situacao, None, 3) is None
    assert anotar_resultado(situacao, "409", 6) is None  # o mesmo erro não se repete no log
    assert anotar_resultado(situacao, "sem rede", 9) == "falhou"  # mudou: vale registrar
    assert (situacao.erro, situacao.erro_desde, situacao.ultima_coleta_ok) == ("sem rede", 0, 3)

    assert anotar_resultado(situacao, None, 9 + JANELA_RECUPERACAO - 1) is None
    assert situacao.erro == "sem rede"
    assert anotar_resultado(situacao, None, 9 + JANELA_RECUPERACAO) == "voltou"
    assert situacao.erro is None and situacao.erro_desde is None


def test_falha_intermitente_fica_visivel_e_nao_alterna_no_log(caplog):
    canal = canal_polling()
    respostas = iter([recusa(409, CONFLITO_INSTANCIA), ok([])] * 3)
    transporte(lambda r: next(respostas))
    assert coletor.situacao(canal.id) is None  # o coletor ainda não passou por ele

    with caplog.at_level(logging.INFO, logger="omnichannel.coletor"):
        for _ in range(6):
            coletar_uma_vez()

    situacao = coletor.situacao(canal.id)
    # o "Testar conexão" diria "Conectado": é isto que mostra que não está recebendo
    assert situacao["recebendo"] is False and "outra cópia do OmniChannel" in situacao["erro"]
    assert situacao["erro_desde"] is not None and situacao["ultima_coleta_ok"] is not None
    linhas = [r.getMessage() for r in caplog.records if r.name == "omnichannel.coletor"]
    assert len(linhas) == 1 and "voltou" not in linhas[0]

    with SessaoLocal() as sessao:
        sessao.get(Canal, canal.id).ativo = False
        sessao.commit()
    coletar_uma_vez()
    assert coletor.situacao(canal.id) is None  # desativado não tem coleta a mostrar


def test_erro_inesperado_na_situacao_nao_carrega_o_sql(monkeypatch):
    canal = canal_polling()
    transporte(lambda r: ok([update(1, "texto do cliente")]))

    def banco_fora(*args):
        raise OperationalError(
            "INSERT INTO mensagens (conteudo) VALUES (?)",
            ("texto do cliente",),
            sqlite3.OperationalError("disk I/O error"),
        )

    monkeypatch.setattr(coletor, "registrar_entrada", banco_fora)
    coletar_uma_vez()

    erro = coletor.situacao(canal.id)["erro"]
    assert "disk I/O error" in erro
    assert "texto do cliente" not in erro and "INSERT" not in erro


# --------------------------------------------------------- verificação
def adaptador(**credenciais):
    return adaptador_para(canal_polling(**credenciais))


def api_do_bot(webhook: str = "", status_getme: int = 200, **info_webhook):
    def responder(requisicao):
        if metodo(requisicao) == "getMe":
            if status_getme != 200:
                return recusa(status_getme, "Unauthorized" if status_getme == 401 else "Not Found")
            return ok({"id": 1, "is_bot": True, "first_name": "Suporte", "username": "suporte_bot"})
        if metodo(requisicao) == "getWebhookInfo":
            return ok({"url": webhook, "pending_update_count": 0, **info_webhook})
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
    # as duas saídas: trocar o modo ou remover o webhook pelo próprio sistema
    assert "'webhook'" in mensagem and "Remover webhook" in mensagem
    assert "123:segredo" not in mensagem  # a mensagem vai para a tela e para o log
    # nada de mandar abrir uma URL com o token no navegador (histórico, extensões, proxy)
    assert "api.telegram.org" not in mensagem and "TOKEN" not in mensagem


def test_remover_webhook_pede_ao_telegram_sem_descartar_pendentes():
    pedidos = []
    transporte(lambda r: pedidos.append((metodo(r), corpo(r))) or ok(True))

    assert "Webhook removido" in adaptador().remover_webhook()
    # drop_pending_updates falso: as mensagens que esperavam o webhook chegam pelo polling
    assert pedidos == [("deleteWebhook", {"drop_pending_updates": False})]

    with pytest.raises(ErroCanal, match="preencha: Token do bot"):
        adaptador_para(criar_canal(TipoCanal.TELEGRAM, "Sem token")).remover_webhook()


def test_verificar_conexao_no_modo_webhook():
    canal = canal_polling(modo_recebimento="webhook")
    transporte(api_do_bot(webhook=f"https://meu-host/webhooks/{canal.id}"))
    assert adaptador_para(canal).verificar_conexao() == "Conectado como @suporte_bot"

    transporte(api_do_bot(webhook=""))
    aviso = adaptador_para(canal).verificar_conexao()
    assert aviso.startswith("Conectado como @suporte_bot") and "setWebhook" in aviso


def test_verificar_conexao_no_modo_webhook_aponta_endereco_de_outro_sistema():
    canal = canal_polling(modo_recebimento="webhook")
    transporte(api_do_bot(webhook="https://n8n.outra-empresa.com/webhook/abc"))

    with pytest.raises(ErroCanal) as erro:
        adaptador_para(canal).verificar_conexao()
    mensagem = str(erro.value)
    assert "outro endereço" in mensagem and "n8n.outra-empresa.com" in mensagem
    assert f"/webhooks/{canal.id}" in mensagem  # o que o setWebhook precisa ter


def test_verificar_conexao_no_modo_webhook_mostra_entrega_recusada():
    canal = canal_polling(modo_recebimento="webhook")
    url = f"https://meu-host.com.br/webhooks/{canal.id}"
    transporte(
        api_do_bot(
            webhook=url,
            pending_update_count=3,
            last_error_date=1_700_000_000,
            last_error_message="Wrong response from the webhook: 401 Unauthorized",
        )
    )
    with pytest.raises(ErroCanal) as erro:
        adaptador_para(canal).verificar_conexao()
    mensagem = str(erro.value)
    # a nossa rota recusa a entrega sem o segredo: a dica é o secret_token
    assert "401 Unauthorized" in mensagem and "secret_token" in mensagem

    # o Telegram guarda o último erro mesmo depois de resolvido; sem entrega
    # pendente, ele é passado
    transporte(api_do_bot(webhook=url, last_error_message="Wrong response from the webhook: 401 Unauthorized"))
    assert adaptador_para(canal).verificar_conexao() == "Conectado como @suporte_bot"


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
    assert len(avisos) == 1 and "outra cópia do OmniChannel" in avisos[0]


def test_desligar_o_laco_nao_espera_a_api_muda():
    canal_polling()
    chamou, solta = threading.Event(), threading.Event()

    def api_muda(requisicao):
        # aceita a conexão e nunca responde (proxy travado, rede que descarta pacotes)
        chamou.set()
        solta.wait(10)
        return ok([])

    transporte(api_muda)

    async def rodar():
        tarefa = asyncio.create_task(coletor.laco(intervalo_coleta=60, intervalo_polling=1))
        for _ in range(100):
            if chamou.is_set():
                break
            await asyncio.sleep(0.05)
        tarefa.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await tarefa

    inicio = time.monotonic()
    try:
        asyncio.run(rodar())
        # com o executor padrão, o asyncio.run esperaria a thread presa no
        # getUpdates, e o Ctrl+C ficaria travado pelo prazo inteiro do httpx
        assert chamou.is_set() and time.monotonic() - inicio < 3
    finally:
        solta.set()


# ------------------------------------------- endereço público (url_publica)
@pytest.fixture
def url_publica(monkeypatch):
    """Instalação com endereço público HTTPS, como a da hospedagem."""
    from app.config import obter_config

    monkeypatch.setattr(obter_config(), "url_publica", "https://atendimento.exemplo.com.br/")
    return "https://atendimento.exemplo.com.br"


def test_com_url_publica_o_telegram_novo_nasce_em_webhook(cliente, cabecalho_admin, url_publica):
    tipos = cliente.get("/api/canais/tipos", headers=cabecalho_admin).json()
    assert next(c for c in tipos["telegram"] if c["chave"] == "modo_recebimento")["padrao"] == "webhook"
    canal = cliente.post("/api/canais", json={"nome": "Bot", "tipo": "telegram"}, headers=cabecalho_admin).json()
    # o modo fica GRAVADO, e a URL mostrada ao admin é a absoluta
    assert canal["url_webhook"] == f"{url_publica}/webhooks/{canal['id']}"
    credenciais = cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho_admin).json()
    assert credenciais["credenciais"]["modo_recebimento"] == "webhook"


def test_conectar_webhook_faz_o_setwebhook_com_o_segredo_do_canal(cliente, cabecalho_admin, url_publica):
    pedidos = []
    transporte(lambda r: pedidos.append((metodo(r), corpo(r), str(r.url))) or ok(True))
    canal = cliente.post(
        "/api/canais",
        json={"nome": "Bot", "tipo": "telegram", "credenciais": {"token": "123:abc", "modo_recebimento": "polling"}},
        headers=cabecalho_admin,
    ).json()
    segredo = cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho_admin).json()["segredo_webhook"]

    resposta = cliente.post(f"/api/canais/{canal['id']}/conectar-webhook", headers=cabecalho_admin)
    assert resposta.status_code == 200 and resposta.json()["ok"] is True, resposta.text
    [(nome, enviado, url)] = pedidos
    assert nome == "setWebhook" and url.endswith("/bot123:abc/setWebhook")
    assert enviado == {
        "url": f"{url_publica}/webhooks/{canal['id']}",
        "secret_token": segredo,
        "allowed_updates": ["message", "edited_message", "channel_post"],
        "drop_pending_updates": False,
    }
    # o token do bot nunca volta ao navegador
    assert "123:abc" not in resposta.text
    credenciais = cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho_admin).json()
    assert credenciais["credenciais"]["modo_recebimento"] == "webhook"


def test_testar_em_modo_webhook_sem_webhook_ja_o_conecta(cliente, cabecalho_admin, url_publica):
    """"Salvar e testar" deixa o canal recebendo: com endereço HTTPS, o
    servidor mesmo faz o setWebhook que faltava."""
    pedidos = []

    def responder(requisicao):
        pedidos.append(metodo(requisicao))
        if metodo(requisicao) == "setWebhook":
            return ok(True)
        return api_do_bot(webhook="")(requisicao)

    transporte(responder)
    canal = cliente.post(
        "/api/canais", json={"nome": "Bot", "tipo": "telegram", "credenciais": {"token": "123:abc"}}, headers=cabecalho_admin
    ).json()
    resultado = cliente.post(f"/api/canais/{canal['id']}/testar", headers=cabecalho_admin).json()
    assert resultado["ok"] is True, resultado
    assert resultado["mensagem"].startswith("Conectado como @suporte_bot. Webhook conectado")
    assert pedidos == ["getMe", "getWebhookInfo", "setWebhook"]

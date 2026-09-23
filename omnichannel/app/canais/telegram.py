"""Telegram Bot API.

Recebe de dois jeitos: por webhook (exige URL publica) ou por polling, em que o
coletor chama `getUpdates` a cada poucos segundos. O polling e o padrao porque
funciona ate no computador do dono, sem endereco publico nenhum.
"""
from __future__ import annotations

import hmac
import logging
import re
import threading
from typing import Any, Mapping

import httpx

from ..config import obter_config
from ..models import StatusMensagem, TipoCanal
from .base import (
    AdaptadorCanal,
    AnexoRecebido,
    ArquivoParaEnviar,
    ErroCanal,
    MensagemRecebida,
    ResultadoEnvio,
)
from .http import cliente

log = logging.getLogger("omnichannel.telegram")

BASE = "https://api.telegram.org"

# O Telegram segura o getUpdates vazio por ate estes segundos esperando uma
# mensagem: quem escreve nesse meio-tempo aparece na hora. Curto para nao
# prender a thread do coletor nem atrasar o desligamento do servidor.
ESPERA_GETUPDATES = 2
# so o que vira mensagem; o resto (entrada em grupo, enquete...) nem precisa
# trafegar
TIPOS_DE_UPDATE = ["message", "edited_message", "channel_post"]

TOKEN_RECUSADO = (
    "token recusado pelo Telegram: confira se colou o token inteiro que o @BotFather "
    "enviou (formato 123456789:ABC...)"
)

# Proximo offset do getUpdates, por canal e token (trocar o bot recomeca a
# fila, e o offset do bot antigo esconderia as mensagens do novo). Fica so em
# memoria de proposito: o id externo unico ja descarta repetidas, entao depois
# de um reinicio os updates ainda nao confirmados voltam e morrem na
# deduplicacao em vez de virar mensagem em dobro.
_offsets: dict[tuple[int, str], int] = {}
_trava_offsets = threading.Lock()


def esquecer_offsets() -> None:
    """Zera a memoria de offsets (testes; equivale a reiniciar o servidor)."""
    with _trava_offsets:
        _offsets.clear()


_TOKEN_NA_URL = re.compile(r"/bot[^/\s]+/")


class _FiltroLogHttpx(logging.Filter):
    """O httpx registra cada requisicao em INFO com a URL inteira, e o Telegram
    poe o token do bot no caminho. Com polling a cada 3 s, o token iria para o
    log milhares de vezes por dia e afogaria o resto: o getUpdates de rotina
    some (falhas o coletor registra) e, nas demais linhas, o token vira <token>.
    """

    def filter(self, registro: logging.LogRecord) -> bool:
        texto = registro.getMessage()
        if "/bot" not in texto:
            return True
        if "/getUpdates" in texto and registro.levelno <= logging.INFO:
            return False
        registro.msg, registro.args = _TOKEN_NA_URL.sub("/bot<token>/", texto), None
        return True


logging.getLogger("httpx").addFilter(_FiltroLogHttpx())


def _conflito_webhook(url: str | None = None) -> str:
    onde = f" ({url})" if url else ""
    return (
        f"o bot tem um webhook ativo{onde}, e o Telegram não entrega mensagens por polling "
        "enquanto ele existir. Duas saídas: se esse endereço aponta para este servidor, mude "
        "'Como receber mensagens' para 'webhook'; ou, para continuar no polling, remova o "
        "webhook abrindo no navegador https://api.telegram.org/bot<SEU_TOKEN>/deleteWebhook "
        "e verifique a conexão de novo"
    )


def _explicar_conflito(descricao: str) -> str:
    """O 409 do Telegram tem duas causas, e cada uma pede uma acao diferente."""
    if "webhook" in descricao.lower():
        return _conflito_webhook()
    return (
        "outra instância está buscando as mensagens deste bot ao mesmo tempo (outro "
        "computador ou programa com o mesmo token). Deixe só uma ligada, ou gere um token "
        "novo no @BotFather (/revoke) para usar só aqui"
    )


class AdaptadorTelegram(AdaptadorCanal):
    tipo = TipoCanal.TELEGRAM
    campos_obrigatorios = ("token",)

    def _url(self, metodo: str) -> str:
        return f"{BASE}/bot{self.credenciais['token']}/{metodo}"

    @property
    def modo_recebimento(self) -> str:
        # ausente ou desconhecido = polling, o unico que funciona sem URL publica
        modo = str(self.credenciais.get("modo_recebimento") or "").strip().lower()
        return "webhook" if modo == "webhook" else "polling"

    def _chamar(
        self, http: httpx.Client, metodo: str, corpo: dict | None = None, timeout: float | None = None
    ) -> Any:
        """Chama um metodo da Bot API e devolve o `result`, ou ErroCanal legivel."""
        extras = {"timeout": timeout} if timeout is not None else {}
        try:
            resposta = http.post(self._url(metodo), json=corpo or {}, **extras)
        except Exception as exc:
            raise ErroCanal(f"falha de rede com a API do Telegram: {exc}") from exc
        try:
            dados = resposta.json()
        except ValueError:
            dados = {}
        if not isinstance(dados, dict):
            dados = {}
        descricao = str(dados.get("description") or resposta.text[:300])
        # token com formato invalido chega como 404, nao 401
        if resposta.status_code in (401, 404):
            raise ErroCanal(TOKEN_RECUSADO)
        if resposta.status_code == 409:
            raise ErroCanal(_explicar_conflito(descricao))
        if resposta.status_code >= 400 or not dados.get("ok", False):
            raise ErroCanal(f"Telegram respondeu {resposta.status_code}: {descricao}")
        return dados.get("result")

    def verificar_conexao(self) -> str:
        if not self.configurado:
            return super().verificar_conexao()  # a base diz o que falta preencher
        with cliente() as http:
            bot = self._chamar(http, "getMe") or {}
            webhook = (self._chamar(http, "getWebhookInfo") or {}).get("url")
        nome = f"@{bot['username']}" if bot.get("username") else (bot.get("first_name") or "o bot")
        if self.modo_recebimento == "polling" and webhook:
            # sem isso o admin ve "conectado" e as mensagens nunca chegam
            raise ErroCanal(_conflito_webhook(webhook))
        if self.modo_recebimento == "webhook" and not webhook:
            return (
                f"Conectado como {nome}, mas o bot ainda não tem webhook cadastrado: as "
                "mensagens só chegam depois do setWebhook apontando para este servidor"
            )
        return f"Conectado como {nome}"

    def coletar(self) -> list[MensagemRecebida]:
        """Modo polling: busca no Telegram o que chegou desde a ultima coleta."""
        if not self.configurado or self.modo_recebimento == "webhook":
            return []
        chave = (self.canal.id, self.credenciais["token"])
        with _trava_offsets:
            offset = _offsets.get(chave)
        corpo: dict = {"timeout": ESPERA_GETUPDATES, "allowed_updates": TIPOS_DE_UPDATE}
        if offset is not None:
            corpo["offset"] = offset
        with cliente() as http:
            # o prazo da requisicao soma a espera que o proprio Telegram faz
            resultado = self._chamar(
                http, "getUpdates", corpo, timeout=obter_config().timeout_http + ESPERA_GETUPDATES
            )
        updates = [u for u in resultado if isinstance(u, dict)] if isinstance(resultado, list) else []

        ids = [u["update_id"] for u in updates if isinstance(u.get("update_id"), int)]
        if ids:
            # nao se confirma nada aqui: e o proximo getUpdates, com este
            # offset, que diz ao Telegram que estes updates podem ser apagados.
            # O max() impede que uma coleta atrasada faca o offset voltar.
            with _trava_offsets:
                _offsets[chave] = max(_offsets.get(chave, 0), max(ids) + 1)

        recebidas: list[MensagemRecebida] = []
        for update in updates:
            try:
                recebidas.extend(self.analisar_webhook(update))
            except Exception:
                # um update num formato inesperado nao pode travar a fila do
                # bot para sempre: o offset ja passou por ele
                log.exception("canal %s: update %s ignorado", self.canal.nome, update.get("update_id"))
        return recebidas

    def verificar_assinatura(self, corpo: bytes, cabecalhos: Mapping[str, str]) -> bool:
        segredo = self.canal.segredo_webhook
        if not segredo:
            return True
        enviado = cabecalhos.get("x-telegram-bot-api-secret-token", "")
        return hmac.compare_digest(enviado, segredo)

    def analisar_webhook(self, payload: dict) -> list[MensagemRecebida]:
        msg = payload.get("message") or payload.get("edited_message") or payload.get("channel_post")
        if not msg:
            return []
        texto = msg.get("text") or msg.get("caption") or ""
        anexos = self._anexos_de(msg)
        if not texto and not anexos:
            return []
        chat = msg.get("chat") or {}
        autor = msg.get("from") or {}
        nome = " ".join(filter(None, [autor.get("first_name"), autor.get("last_name")])) or chat.get("title")
        return [
            MensagemRecebida(
                identificador=str(chat.get("id")),
                conteudo=texto,
                nome_exibicao=nome or autor.get("username"),
                externo_id=self._prefixar(f"{chat.get('id')}-{msg.get('message_id')}"),
                metadados={"usuario": autor.get("username")},
                anexos=anexos,
            )
        ]

    @staticmethod
    def _anexos_de(msg: dict) -> list[AnexoRecebido]:
        if "photo" in msg and msg["photo"]:
            # o Telegram manda a mesma foto em varios tamanhos; o ultimo e o maior
            maior = msg["photo"][-1]
            return [AnexoRecebido(nome="foto.jpg", referencia=maior.get("file_id"), tipo_conteudo="image/jpeg")]
        for especie, padrao in (
            ("document", None),
            ("voice", "audio.ogg"),
            ("audio", "audio.mp3"),
            ("video", "video.mp4"),
        ):
            arquivo = msg.get(especie)
            if not arquivo:
                continue
            return [
                AnexoRecebido(
                    nome=arquivo.get("file_name") or padrao or f"{especie}.bin",
                    referencia=arquivo.get("file_id"),
                    tipo_conteudo=arquivo.get("mime_type"),
                )
            ]
        return []

    def baixar_anexo(self, anexo: AnexoRecebido) -> bytes:
        if anexo.dados is not None:
            return anexo.dados
        if not anexo.referencia:
            raise ErroCanal("anexo sem file_id")
        with cliente() as http:
            try:
                # getFile devolve um caminho valido por cerca de uma hora
                descricao = http.get(self._url("getFile"), params={"file_id": anexo.referencia})
                dados = descricao.json() if descricao.status_code < 400 else {}
                caminho = (dados.get("result") or {}).get("file_path")
                if not caminho:
                    raise ErroCanal(f"o Telegram nao devolveu o arquivo: {dados.get('description')}")
                arquivo = http.get(f"{BASE}/file/bot{self.credenciais['token']}/{caminho}")
            except ErroCanal:
                raise
            except Exception as exc:
                raise ErroCanal(f"falha de rede ao baixar o arquivo: {exc}") from exc
        if arquivo.status_code >= 400:
            raise ErroCanal(f"download falhou ({arquivo.status_code})")
        return arquivo.content

    @property
    def envia_arquivos(self) -> bool:
        return True

    def _enviar(self, destino: str, conteudo: str, contexto: dict) -> ResultadoEnvio:
        arquivos: list[ArquivoParaEnviar] = contexto.get("arquivos") or []
        with cliente() as http:
            try:
                if arquivos:
                    arquivo = arquivos[0]
                    imagem = arquivo.tipo_conteudo.startswith("image/")
                    metodo = "sendPhoto" if imagem else "sendDocument"
                    campo = "photo" if imagem else "document"
                    resposta = http.post(
                        self._url(metodo),
                        data={"chat_id": destino, "caption": conteudo[:1024]},
                        files={campo: (arquivo.nome, arquivo.dados, arquivo.tipo_conteudo)},
                    )
                else:
                    resposta = http.post(
                        self._url("sendMessage"), json={"chat_id": destino, "text": conteudo}
                    )
            except Exception as exc:
                raise ErroCanal(f"falha de rede com a API do Telegram: {exc}") from exc
        if resposta.status_code >= 400:
            raise ErroCanal(f"Telegram respondeu {resposta.status_code}: {resposta.text[:300]}")
        dados = resposta.json()
        if not dados.get("ok", False):
            raise ErroCanal(f"Telegram recusou o envio: {dados.get('description')}")
        resultado = dados.get("result") or {}
        externo = f"{destino}-{resultado.get('message_id')}" if resultado.get("message_id") else None
        return ResultadoEnvio(status=StatusMensagem.ENVIADA, externo_id=self._prefixar(externo))

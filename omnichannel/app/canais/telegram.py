"""Telegram Bot API.

Recebe de dois jeitos: por webhook (exige URL publica) ou por polling, em que o
coletor chama `getUpdates` a cada poucos segundos. O polling e o padrao porque
funciona ate no computador do dono, sem endereco publico nenhum.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import re
import threading
from dataclasses import dataclass
from typing import Any, Mapping
from urllib.parse import urlsplit

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
from .campos import modo_telegram_padrao
from .http import cliente

log = logging.getLogger("omnichannel.telegram")

BASE = "https://api.telegram.org"

# O Telegram segura o getUpdates vazio por ate estes segundos esperando uma
# mensagem: quem escreve nesse meio-tempo aparece na hora. Curto para nao
# prender a thread do coletor nem atrasar o desligamento do servidor.
ESPERA_GETUPDATES = 2
# Prazo de leitura do getUpdates alem da espera: o timeout_http geral (15 s)
# somado a ela deixava uma API que aceita a conexao e nunca responde prender a
# coleta do canal por 17 s a cada tentativa.
FOLGA_GETUPDATES = 5
# so o que vira mensagem; o resto (entrada em grupo, enquete...) nem precisa
# trafegar
TIPOS_DE_UPDATE = ["message", "edited_message", "channel_post"]
# O sendPhoto recomprime a imagem e so processa JPEG, PNG e WebP: SVG, HEIC ou
# BMP voltam "IMAGE_PROCESS_FAILED", e um GIF perderia a animacao. O resto vai
# por sendDocument, que entrega qualquer arquivo como esta.
TIPOS_DE_FOTO = ("image/jpeg", "image/png", "image/webp")


def vai_como_foto(tipo_conteudo: str) -> bool:
    return (tipo_conteudo or "").split(";")[0].strip().lower() in TIPOS_DE_FOTO

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


@dataclass(slots=True)
class _AnexoIndisponivel(AnexoRecebido):
    """Anexo cujo download ja falhou na coleta.

    Guarda o motivo para que a gravacao registre o anexo com o erro sem voltar
    a rede, o que aconteceria dentro da transacao do banco.
    """

    erro: str = ""


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
    # Nada de ensinar a abrir api.telegram.org/bot<token>/deleteWebhook no
    # navegador: o token iria para o historico (sincronizado entre aparelhos)
    # e quem o tiver desvia as mensagens do bot. O token so trafega entre este
    # servidor e o Telegram: o botao do painel pede a remocao ao servidor
    # (remover_webhook).
    onde = f" ({url})" if url else ""
    return (
        f"o bot tem um webhook ativo{onde}, e o Telegram não entrega mensagens por polling "
        "enquanto ele existir. Duas saídas: se esse endereço aponta para este servidor, mude "
        "'Como receber mensagens' para 'webhook'; ou, para continuar no polling, use "
        "'Remover webhook' neste canal (ou desligue-o no sistema que o cadastrou) e "
        "verifique a conexão de novo"
    )


def _explicar_conflito(descricao: str) -> str:
    """O 409 do Telegram tem duas causas, e cada uma pede uma acao diferente."""
    if "webhook" in descricao.lower():
        return _conflito_webhook()
    # Dois canais deste servidor com o mesmo token nao chegam aqui: o coletor
    # so deixa o de menor id buscar (ver chave_coleta). Sobra quem esta fora
    # deste processo, inclusive uma segunda copia aberta no mesmo computador.
    return (
        "outro programa está buscando as mensagens deste bot ao mesmo tempo: outra cópia "
        "do OmniChannel (neste ou em outro computador) ou outro sistema com o mesmo token. "
        "Deixe só um ligado, ou gere um token novo no @BotFather (/revoke) para usar só aqui"
    )


class AdaptadorTelegram(AdaptadorCanal):
    tipo = TipoCanal.TELEGRAM
    campos_obrigatorios = ("token",)
    # offset que o proximo getUpdates mandara, quando o coletor confirmar que
    # gravou o lote: (chave em _offsets, offset)
    _a_confirmar: tuple[tuple[int, str], int] | None = None

    def _url(self, metodo: str) -> str:
        return f"{BASE}/bot{self.credenciais['token']}/{metodo}"

    @property
    def modo_recebimento(self) -> str:
        # ausente = o padrao desta instalacao (webhook so com URL publica
        # HTTPS); desconhecido = polling, o unico que funciona sem URL publica
        modo = str(self.credenciais.get("modo_recebimento") or "").strip().lower() or modo_telegram_padrao()
        return "webhook" if modo == "webhook" else "polling"

    @property
    def chave_coleta(self) -> str | None:
        """Identifica o bot de onde este canal busca, para o coletor achar repetidos.

        Dois canais com o mesmo token buscando ao mesmo tempo dividem as
        conversas de um cliente ao acaso entre eles (cada getUpdates leva o que
        chegou desde o outro). Vai um resumo do token, nunca o token.
        """
        if not self.configurado or self.modo_recebimento == "webhook":
            return None
        return "telegram:" + hashlib.sha256(str(self.credenciais["token"]).encode()).hexdigest()[:16]

    def _chamar(
        self,
        http: httpx.Client,
        metodo: str,
        corpo: dict | None = None,
        timeout: float | httpx.Timeout | None = None,
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
            webhook = self._chamar(http, "getWebhookInfo") or {}
        nome = f"@{bot['username']}" if bot.get("username") else (bot.get("first_name") or "o bot")
        url = webhook.get("url")
        if self.modo_recebimento == "polling" and url:
            # sem isso o admin ve "conectado" e as mensagens nunca chegam
            raise ErroCanal(_conflito_webhook(url))
        self.sem_webhook_cadastrado = False
        if self.modo_recebimento == "webhook":
            if not url:
                self.sem_webhook_cadastrado = True
                return (
                    f"Conectado como {nome}, mas o bot ainda não tem webhook cadastrado: as "
                    "mensagens só chegam depois do setWebhook apontando para este servidor"
                )
            self._conferir_webhook(webhook)
        return f"Conectado como {nome}"

    # a ultima verificar_conexao achou o bot em modo webhook sem webhook
    # cadastrado: o canal nao recebe nada ate o setWebhook (o testar o faz)
    sem_webhook_cadastrado = False

    def _conferir_webhook(self, info: dict) -> None:
        """No modo webhook, getMe respondendo nao basta: o token pode estar
        perfeito e as mensagens irem para outro sistema, ou baterem aqui e
        serem recusadas. O getWebhookInfo ja diz as duas coisas."""
        url = str(info.get("url") or "")
        esperado = f"/webhooks/{self.canal.id}"
        # so o caminho e conferivel: o endereco publico deste servidor (tunel,
        # proxy) o sistema nao conhece
        if self.canal.id is not None and not urlsplit(url).path.rstrip("/").endswith(esperado):
            raise ErroCanal(
                f"o webhook do bot aponta para outro endereço ({url}): as mensagens vão para lá, "
                f"não para este canal. Refaça o setWebhook com a URL deste canal, terminada em {esperado}"
            )
        falha = str(info.get("last_error_message") or "").strip()
        # O Telegram guarda o ultimo erro mesmo depois de resolvido. Com
        # entrega pendente, porem, ele ainda esta tentando: o erro e atual.
        if falha and int(info.get("pending_update_count") or 0) > 0:
            dica = ""
            if "401" in falha:
                # a rota recusa a entrega sem o segredo que o cadastro gerou
                dica = (
                    " O setWebhook foi feito sem o secret_token deste canal (ou com outro): "
                    'use "Conectar webhook" neste canal para refazê-lo com o segredo certo'
                )
            raise ErroCanal(f"o Telegram não consegue entregar as mensagens no webhook: {falha}.{dica}")

    def conectar_webhook(self, url: str, segredo: str) -> str:
        """Cadastra no bot o webhook deste canal, com o segredo que o cadastro gerou.

        Feito pelo servidor: o token nunca aparece em URL nenhuma do navegador.
        """
        if not self.configurado:
            raise ErroCanal("preencha: Token do bot")
        with cliente() as http:
            self._chamar(http, "setWebhook", {
                "url": url,
                "secret_token": segredo,
                "allowed_updates": TIPOS_DE_UPDATE,
                # o que chegou enquanto nao havia webhook vem na primeira entrega
                "drop_pending_updates": False,
            })
        return f"Webhook conectado: o Telegram entrega as mensagens em {url}"

    def remover_webhook(self) -> str:
        """Apaga o webhook do bot para o polling voltar a receber.

        So por clique explicito do admin: e uma mudanca no bot dele, e outro
        sistema pode depender desse webhook, por isso o coletor nunca chama
        isto sozinho ao ver o 409. Feito pelo servidor para o token nao
        precisar aparecer em URL nenhuma no navegador. As mensagens que
        esperavam o webhook ficam (drop_pending_updates falso): o proximo
        getUpdates as traz.
        """
        if not self.configurado:
            raise ErroCanal("preencha: Token do bot")
        with cliente() as http:
            self._chamar(http, "deleteWebhook", {"drop_pending_updates": False})
        return "Webhook removido: o bot volta a entregar as mensagens por polling"

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
        prazo = httpx.Timeout(obter_config().timeout_http, read=ESPERA_GETUPDATES + FOLGA_GETUPDATES)
        with cliente() as http:
            resultado = self._chamar(http, "getUpdates", corpo, timeout=prazo)
        updates = [u for u in resultado if isinstance(u, dict)] if isinstance(resultado, list) else []

        ids = [u["update_id"] for u in updates if isinstance(u.get("update_id"), int)]
        # O offset so anda em confirmar_coleta, depois que o coletor gravou: e
        # o proximo getUpdates com ele que manda o Telegram apagar o lote. Se
        # andasse aqui, qualquer falha ao gravar (banco travado, disco cheio)
        # perderia o lote inteiro; assim ele volta e a deduplicacao descarta o
        # que ja tinha entrado.
        self._a_confirmar = (chave, max(ids) + 1) if ids else None

        recebidas: list[MensagemRecebida] = []
        for update in updates:
            try:
                recebidas.extend(self.analisar_webhook(update))
            except Exception:
                # um update num formato inesperado nao pode travar a fila do
                # bot para sempre: sai do lote e e confirmado com ele
                log.exception("canal %s: update %s ignorado", self.canal.nome, update.get("update_id"))
        return recebidas

    def confirmar_coleta(self) -> None:
        """O coletor chama depois de gravar o lote da ultima coleta."""
        if self._a_confirmar is None:
            return
        chave, proximo = self._a_confirmar
        self._a_confirmar = None
        with _trava_offsets:
            # o max() impede que uma coleta atrasada faca o offset voltar
            _offsets[chave] = max(_offsets.get(chave, 0), proximo)

    def preparar_entrada(self, recebida: MensagemRecebida) -> None:
        """Baixa os arquivos da mensagem antes de o coletor abrir a transacao.

        Baixar la dentro (registrar_entrada -> guardar_recebidos) prende a
        trava de escrita do SQLite pelo tempo do download: um PDF grande de um
        cliente fazia a gravacao de outro canal esperar os 5 s do banco e
        falhar. Uma mensagem por vez, para um lote de documentos nao ficar
        inteiro na memoria.
        """
        for posicao, anexo in enumerate(recebida.anexos):
            if anexo.dados is not None:
                continue
            try:
                anexo.dados = self.baixar_anexo(anexo)
            except ErroCanal as exc:
                recebida.anexos[posicao] = _AnexoIndisponivel(
                    nome=anexo.nome,
                    referencia=anexo.referencia,
                    tipo_conteudo=anexo.tipo_conteudo,
                    erro=str(exc),
                )

    def verificar_assinatura(self, corpo: bytes, cabecalhos: Mapping[str, str]) -> bool:
        segredo = self.canal.segredo_webhook
        if not segredo:
            return True
        enviado = cabecalhos.get("x-telegram-bot-api-secret-token", "")
        return hmac.compare_digest(enviado, segredo)

    def analisar_webhook(self, payload: dict) -> list[MensagemRecebida]:
        msg = next(
            (payload[c] for c in ("message", "edited_message", "channel_post") if isinstance(payload.get(c), dict) and payload[c]),
            None,
        )
        if not msg:
            return []
        texto = next((v for v in (msg.get("text"), msg.get("caption")) if isinstance(v, str) and v), "")
        anexos = self._anexos_de(msg)
        if not texto and not anexos:
            return []
        chat = msg.get("chat") if isinstance(msg.get("chat"), dict) else {}
        autor = msg.get("from") if isinstance(msg.get("from"), dict) else {}
        if chat.get("id") is None:
            return []  # sem chat nao ha a quem responder (o "None" virava contato)
        nome = " ".join(filter(None, [autor.get("first_name"), autor.get("last_name")])) or chat.get("title")
        return [
            MensagemRecebida(
                identificador=str(chat.get("id")),
                conteudo=texto,
                nome_exibicao=nome or autor.get("username"),
                # com o canal: dois bots conversando com o mesmo usuario numeram
                # as mensagens do mesmo jeito (chat.id = id do usuario, desde 1)
                externo_id=self._prefixar_no_canal(f"{chat.get('id')}-{msg.get('message_id')}"),
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
        if isinstance(anexo, _AnexoIndisponivel):
            raise ErroCanal(anexo.erro)
        if not anexo.referencia:
            raise ErroCanal("anexo sem file_id")
        with cliente() as http:
            try:
                # getFile devolve um caminho valido por cerca de uma hora
                descricao = http.get(self._url("getFile"), params={"file_id": anexo.referencia})
                # o erro tambem vem em JSON, e o motivo ("file is too big", o
                # limite de 20 MB do getFile) e o que o atendente precisa ver
                try:
                    dados = descricao.json()
                except ValueError:
                    dados = {}
                dados = dados if isinstance(dados, dict) else {}
                caminho = (dados.get("result") or {}).get("file_path")
                if not caminho:
                    motivo = dados.get("description") or f"resposta {descricao.status_code}"
                    raise ErroCanal(f"o Telegram nao devolveu o arquivo: {motivo}")
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
                    imagem = vai_como_foto(arquivo.tipo_conteudo)
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
        return ResultadoEnvio(status=StatusMensagem.ENVIADA, externo_id=self._prefixar_no_canal(externo))

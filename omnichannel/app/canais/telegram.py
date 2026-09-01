"""Telegram Bot API."""
from __future__ import annotations

import hmac
from typing import Mapping

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


BASE = "https://api.telegram.org"


class AdaptadorTelegram(AdaptadorCanal):
    tipo = TipoCanal.TELEGRAM
    campos_obrigatorios = ("token",)

    def _url(self, metodo: str) -> str:
        return f"{BASE}/bot{self.credenciais['token']}/{metodo}"

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

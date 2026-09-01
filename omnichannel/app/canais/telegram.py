"""Telegram Bot API."""
from __future__ import annotations

import hmac
from typing import Mapping

from ..models import StatusMensagem, TipoCanal
from .base import AdaptadorCanal, ErroCanal, MensagemRecebida, ResultadoEnvio
from .http import cliente


class AdaptadorTelegram(AdaptadorCanal):
    tipo = TipoCanal.TELEGRAM
    campos_obrigatorios = ("token",)

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
        texto = msg.get("text") or msg.get("caption")
        if not texto:
            for tipo in ("photo", "document", "voice", "video", "audio"):
                if tipo in msg:
                    texto = f"[{tipo} recebido]"
                    break
        if not texto:
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
            )
        ]

    def _enviar(self, destino: str, conteudo: str, contexto: dict) -> ResultadoEnvio:
        url = f"https://api.telegram.org/bot{self.credenciais['token']}/sendMessage"
        with cliente() as http:
            try:
                resposta = http.post(url, json={"chat_id": destino, "text": conteudo})
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

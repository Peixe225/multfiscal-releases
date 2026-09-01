"""WhatsApp Cloud API (Meta)."""
from __future__ import annotations

from typing import Mapping

from ..models import StatusMensagem, TipoCanal
from ..security import assinatura_valida
from ..util import normalizar_telefone
from .base import AdaptadorCanal, AtualizacaoStatus, ErroCanal, MensagemRecebida, ResultadoEnvio
from .http import cliente

VERSAO_API = "v20.0"

_STATUS = {
    "sent": StatusMensagem.ENVIADA,
    "delivered": StatusMensagem.ENTREGUE,
    "read": StatusMensagem.LIDA,
    "failed": StatusMensagem.FALHOU,
}


class AdaptadorWhatsApp(AdaptadorCanal):
    tipo = TipoCanal.WHATSAPP
    campos_obrigatorios = ("token", "id_numero")

    # ---------------------------------------------------------------- entrada
    def verificar_assinatura(self, corpo: bytes, cabecalhos: Mapping[str, str]) -> bool:
        segredo = self.canal.segredo_webhook
        if not segredo:
            return True
        return assinatura_valida(segredo, corpo, cabecalhos.get("x-hub-signature-256"))

    def desafio_verificacao(self, parametros: Mapping[str, str]) -> str | None:
        esperado = self.credenciais.get("token_verificacao")
        if parametros.get("hub.mode") == "subscribe" and esperado and parametros.get("hub.verify_token") == esperado:
            return parametros.get("hub.challenge")
        return None

    def analisar_webhook(self, payload: dict) -> list[MensagemRecebida]:
        recebidas: list[MensagemRecebida] = []
        for entrada in payload.get("entry", []):
            for mudanca in entrada.get("changes", []):
                valor = mudanca.get("value", {}) or {}
                # os dois lados sao normalizados: o numero pode vir formatado
                perfis = {
                    normalizar_telefone(c.get("wa_id", "")): (c.get("profile") or {}).get("name")
                    for c in valor.get("contacts", []) or []
                }
                for msg in valor.get("messages", []) or []:
                    conteudo = self._extrair_conteudo(msg)
                    if conteudo is None:
                        continue
                    remetente = normalizar_telefone(msg.get("from", ""))
                    recebidas.append(
                        MensagemRecebida(
                            identificador=remetente,
                            conteudo=conteudo,
                            nome_exibicao=perfis.get(remetente),
                            externo_id=self._prefixar(msg.get("id")),
                            metadados={"tipo_whatsapp": msg.get("type")},
                        )
                    )
        return recebidas

    @staticmethod
    def _extrair_conteudo(msg: dict) -> str | None:
        tipo = msg.get("type")
        if tipo == "text":
            return (msg.get("text") or {}).get("body", "")
        if tipo == "button":
            return (msg.get("button") or {}).get("text", "")
        if tipo == "interactive":
            interativo = msg.get("interactive") or {}
            for chave in ("button_reply", "list_reply"):
                if chave in interativo:
                    return interativo[chave].get("title", "")
            return None
        if tipo in {"image", "audio", "video", "document", "sticker"}:
            legenda = (msg.get(tipo) or {}).get("caption")
            return legenda or f"[{tipo} recebido]"
        if tipo == "location":
            local = msg.get("location") or {}
            return f"[localizacao] {local.get('latitude')},{local.get('longitude')}"
        return None

    def analisar_status(self, payload: dict) -> list[AtualizacaoStatus]:
        atualizacoes: list[AtualizacaoStatus] = []
        for entrada in payload.get("entry", []):
            for mudanca in entrada.get("changes", []):
                for st in (mudanca.get("value", {}) or {}).get("statuses", []) or []:
                    novo = _STATUS.get(st.get("status"))
                    if novo and st.get("id"):
                        atualizacoes.append(AtualizacaoStatus(self._prefixar(st["id"]), novo))
        return atualizacoes

    # ------------------------------------------------------------------ saida
    def _enviar(self, destino: str, conteudo: str, contexto: dict) -> ResultadoEnvio:
        url = f"https://graph.facebook.com/{VERSAO_API}/{self.credenciais['id_numero']}/messages"
        corpo = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": normalizar_telefone(destino),
            "type": "text",
            "text": {"preview_url": False, "body": conteudo},
        }
        with cliente() as http:
            try:
                resposta = http.post(
                    url,
                    json=corpo,
                    headers={"Authorization": f"Bearer {self.credenciais['token']}"},
                )
            except Exception as exc:  # httpx.HTTPError e afins
                raise ErroCanal(f"falha de rede com a API do WhatsApp: {exc}") from exc
        if resposta.status_code >= 400:
            raise ErroCanal(f"WhatsApp respondeu {resposta.status_code}: {resposta.text[:300]}")
        dados = resposta.json()
        externo = (dados.get("messages") or [{}])[0].get("id")
        return ResultadoEnvio(status=StatusMensagem.ENVIADA, externo_id=self._prefixar(externo))

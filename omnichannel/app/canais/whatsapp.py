"""WhatsApp Cloud API (Meta)."""
from __future__ import annotations

from typing import Mapping

from ..models import StatusMensagem, TipoCanal
from ..security import assinatura_valida
from ..util import normalizar_telefone
from .base import (
    AdaptadorCanal,
    AnexoRecebido,
    ArquivoParaEnviar,
    AtualizacaoStatus,
    ErroCanal,
    MensagemRecebida,
    ResultadoEnvio,
)
from .http import cliente

VERSAO_API = "v20.0"
BASE = f"https://graph.facebook.com/{VERSAO_API}"
TIPOS_COM_ARQUIVO = ("image", "audio", "video", "document", "sticker")

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
                    anexos = self._anexos_de(msg)
                    if not conteudo and not anexos:
                        continue  # nada que valha uma mensagem
                    remetente = normalizar_telefone(msg.get("from", ""))
                    recebidas.append(
                        MensagemRecebida(
                            identificador=remetente,
                            conteudo=conteudo,
                            nome_exibicao=perfis.get(remetente),
                            externo_id=self._prefixar(msg.get("id")),
                            metadados={"tipo_whatsapp": msg.get("type")},
                            anexos=anexos,
                        )
                    )
        return recebidas

    @staticmethod
    def _anexos_de(msg: dict) -> list[AnexoRecebido]:
        tipo = msg.get("type")
        if tipo not in TIPOS_COM_ARQUIVO:
            return []
        midia = msg.get(tipo) or {}
        if not midia.get("id"):
            return []
        mime = (midia.get("mime_type") or "").split(";")[0].strip()
        extensao = mime.split("/")[-1] if "/" in mime else "bin"
        return [
            AnexoRecebido(
                nome=midia.get("filename") or f"{tipo}.{extensao}",
                referencia=midia["id"],
                tipo_conteudo=mime or None,
            )
        ]

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
        if tipo in TIPOS_COM_ARQUIVO:
            # o arquivo vem junto como anexo; sem legenda, a mensagem é só ele
            return (msg.get(tipo) or {}).get("caption") or ""
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

    def baixar_anexo(self, anexo: AnexoRecebido) -> bytes:
        if anexo.dados is not None:
            return anexo.dados
        if not anexo.referencia:
            raise ErroCanal("anexo sem referencia de midia")
        cabecalhos = {"Authorization": f"Bearer {self.credenciais['token']}"}
        with cliente() as http:
            try:
                # a Meta entrega uma URL temporaria, que ainda exige o token
                metadados = http.get(f"{BASE}/{anexo.referencia}", headers=cabecalhos)
                if metadados.status_code >= 400:
                    raise ErroCanal(f"midia indisponivel ({metadados.status_code})")
                url = metadados.json().get("url")
                if not url:
                    raise ErroCanal("a resposta da Meta nao trouxe a URL da midia")
                arquivo = http.get(url, headers=cabecalhos)
            except ErroCanal:
                raise
            except Exception as exc:
                raise ErroCanal(f"falha de rede ao baixar a midia: {exc}") from exc
        if arquivo.status_code >= 400:
            raise ErroCanal(f"download da midia falhou ({arquivo.status_code})")
        return arquivo.content

    # ------------------------------------------------------------------ saida
    @property
    def envia_arquivos(self) -> bool:
        return True

    def _subir_midia(self, arquivo: ArquivoParaEnviar) -> str:
        """A Meta exige subir o arquivo antes de citá-lo numa mensagem."""
        with cliente() as http:
            try:
                resposta = http.post(
                    f"{BASE}/{self.credenciais['id_numero']}/media",
                    headers={"Authorization": f"Bearer {self.credenciais['token']}"},
                    data={"messaging_product": "whatsapp"},
                    files={"file": (arquivo.nome, arquivo.dados, arquivo.tipo_conteudo)},
                )
            except Exception as exc:
                raise ErroCanal(f"falha de rede ao subir o arquivo: {exc}") from exc
        if resposta.status_code >= 400:
            raise ErroCanal(f"upload recusado ({resposta.status_code}): {resposta.text[:200]}")
        identificador = resposta.json().get("id")
        if not identificador:
            raise ErroCanal("a Meta nao devolveu o id da midia")
        return identificador

    def _enviar(self, destino: str, conteudo: str, contexto: dict) -> ResultadoEnvio:
        url = f"{BASE}/{self.credenciais['id_numero']}/messages"
        corpo = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": normalizar_telefone(destino),
            "type": "text",
            "text": {"preview_url": False, "body": conteudo},
        }
        arquivos: list[ArquivoParaEnviar] = contexto.get("arquivos") or []
        if arquivos:
            # uma mensagem carrega uma mídia; o texto vira legenda dela
            arquivo = arquivos[0]
            especie = "image" if arquivo.tipo_conteudo.startswith("image/") else "document"
            midia = {"id": self._subir_midia(arquivo)}
            if conteudo:
                midia["caption"] = conteudo
            if especie == "document":
                midia["filename"] = arquivo.nome
            corpo.pop("text")
            corpo["type"] = especie
            corpo[especie] = midia
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

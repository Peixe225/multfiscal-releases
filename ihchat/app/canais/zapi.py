"""Z-API: WhatsApp pelo QR Code num serviço hospedado (brasileiro, pago).

Rotas e formatos conferidos na documentação (links em
php/app/Canais/PROVEDORES-WHATSAPP.md). Mesmo comportamento do PHP
(php/app/Canais/WhatsAppQr/ProvedorZApi.php).
"""
from __future__ import annotations

import base64
import re
from urllib.parse import quote

from ..models import StatusMensagem
from .base import AnexoRecebido, ArquivoParaEnviar, AtualizacaoStatus, ErroCanal
from .whatsapp_qr import (
    AGUARDANDO,
    CONECTADO,
    DESCONECTADO,
    ERRO,
    EstadoConexao,
    Evento,
    ProvedorQR,
    METADADO_LID,
    e_conversa_privada,
    e_lid,
    especie_de_envio,
    extensao,
    frase_do_estado,
    identificador_do_contato,
    mime_limpo,
    montar_mensagem,
    numero_python,
    objeto,
    qr_como_imagem,
    texto,
    url_de_midia,
    verdade,
)

BASE_ZAPI = "https://api.z-api.io/instances"

# MessageStatusCallback -> status da mensagem de saída. READ_BY_ME é a
# leitura que o próprio dono fez de uma mensagem RECEBIDA: não é recibo nosso
STATUS_ZAPI = {
    "SENT": StatusMensagem.ENVIADA,
    "RECEIVED": StatusMensagem.ENTREGUE,
    "READ": StatusMensagem.LIDA,
    "PLAYED": StatusMensagem.LIDA,
}

# tipo de mensagem -> (campo da URL da mídia, nome padrão do arquivo)
MIDIAS_ZAPI = {
    "image": ("imageUrl", "imagem"),
    "audio": ("audioUrl", "audio"),
    "video": ("videoUrl", "video"),
    "document": ("documentUrl", "documento"),
    "sticker": ("stickerUrl", "figurinha"),
}


class ProvedorZApi(ProvedorQR):
    chave = "zapi"
    rotulo = "Z-API"
    nome = "a Z-API"
    obrigatorios = ("instancia_id", "instancia_token")

    # ----------------------------------------------------------- transporte
    def _url(self, caminho: str) -> str:
        instancia = quote(self.credencial("instancia_id"), safe="")
        token = quote(self.credencial("instancia_token"), safe="")
        return f"{BASE_ZAPI}/{instancia}/token/{token}{caminho}"

    def _cabecalhos(self) -> dict:
        # a Z-API responde 415 sem Content-Type, inclusive no GET
        cabecalhos = {"Content-Type": "application/json"}
        if self.credencial("client_token"):
            cabecalhos["Client-Token"] = self.credencial("client_token")
        return cabecalhos

    def _chamar(self, metodo: str, caminho: str, corpo=None) -> dict:
        """JSON-objeto da resposta; status de erro vira ErroCanal explicado."""
        status, dados, bruto = self.pedir(metodo, self._url(caminho), corpo=corpo, cabecalhos=self._cabecalhos())
        dados = dados if isinstance(dados, dict) else {}
        if status >= 400:
            raise ErroCanal(self._explicar(status, dados, bruto))
        return dados

    def _explicar(self, status: int, dados: dict, bruto: str) -> str:
        mensagem = texto(dados.get("error")) or texto(dados.get("message")) or bruto.strip()[:300] or f"HTTP {status}"
        mensagem = self.sem_segredos(mensagem)
        minusculo = mensagem.lower()
        if "null not allowed" in minusculo or "client-token" in minusculo or "client token" in minusculo:
            dica = "confira o Client-Token (painel da Z-API → Segurança → Token de segurança da conta)"
        elif status in (401, 403, 404) or "instance not found" in minusculo:
            dica = "confira o ID e o token da instância no painel da Z-API"
        else:
            return f"a Z-API recusou ({status}): {mensagem}"
        return f"a Z-API recusou ({status}): {mensagem} — {dica}"

    # --------------------------------------------------------------- estado
    def _numero_conectado(self) -> str | None:
        try:
            dados = self._chamar("GET", "/device")
        except ErroCanal:
            return None  # o número é um detalhe: a conexão já foi confirmada
        return identificador_do_contato(texto(dados.get("phone")))

    def estado(self, com_qr: bool) -> EstadoConexao:
        situacao = self._chamar("GET", "/status")
        if verdade(situacao.get("connected")):
            numero = self._numero_conectado()
            return EstadoConexao(CONECTADO, numero=numero, mensagem=frase_do_estado(CONECTADO, numero))
        if not com_qr:
            return EstadoConexao(DESCONECTADO, mensagem=frase_do_estado(DESCONECTADO))
        imagem = self._chamar("GET", "/qr-code/image")
        if verdade(imagem.get("connected")):
            numero = self._numero_conectado()
            return EstadoConexao(CONECTADO, numero=numero, mensagem=frase_do_estado(CONECTADO, numero))
        if "challenge" in imagem:
            # aparelhos com Chave de Acesso: o WebAuthn é concluído no painel deles
            return EstadoConexao(
                ERRO,
                mensagem="o WhatsApp pediu a Chave de Acesso (passkey) deste celular: "
                "conclua a conexão pelo painel da Z-API",
            )
        qr = qr_como_imagem(texto(imagem.get("value")))
        if qr is None:
            return EstadoConexao(AGUARDANDO, mensagem="a Z-API ainda está gerando o QR Code; aguarde alguns segundos")
        return EstadoConexao(AGUARDANDO, qr=qr, mensagem=frase_do_estado(AGUARDANDO))

    def desconectar(self) -> str:
        self._chamar("GET", "/disconnect")
        return "WhatsApp desconectado da Z-API: para voltar, leia um QR Code novo"

    def conectar_webhook(self, url: str) -> str:
        # um só endereço para todos os eventos; notifySentByMe faz chegar também
        # o que o dono manda pelo celular (e o histórico fica completo)
        dados = self._chamar("PUT", "/update-every-webhooks", {"value": url, "notifySentByMe": True})
        if dados.get("value") is False:
            raise ErroCanal("a Z-API não aceitou o endereço do webhook")
        return "Webhook conectado: a Z-API passa a entregar as mensagens deste número ao IHchat"

    # ---------------------------------------------------------------- envio
    @staticmethod
    def _id_enviado(dados: dict) -> str:
        identificador = texto(dados.get("messageId")) or texto(dados.get("id"))
        if not identificador:
            erro = texto(dados.get("error"))
            raise ErroCanal(f"a Z-API não confirmou o envio: {erro}" if erro else "a Z-API não devolveu o id da mensagem")
        return identificador

    def enviar_texto(self, numero: str, texto_: str) -> str | None:
        return self._id_enviado(self._chamar("POST", "/send-text", {"phone": numero, "message": texto_}))

    def enviar_midia(self, numero: str, arquivo: ArquivoParaEnviar, legenda: str) -> str | None:
        mime = mime_limpo(arquivo.tipo_conteudo) or "application/octet-stream"
        conteudo = f"data:{mime};base64,{base64.b64encode(arquivo.dados).decode()}"
        especie = especie_de_envio(mime)
        corpo: dict = {"phone": numero}
        if especie == "image":
            caminho, corpo["image"] = "/send-image", conteudo
        elif especie == "video":
            caminho, corpo["video"] = "/send-video", conteudo
        else:
            caminho = f"/send-document/{self._extensao_do_arquivo(arquivo)}"
            corpo["document"] = conteudo
            corpo["fileName"] = arquivo.nome
        if legenda:
            corpo["caption"] = legenda
        return self._id_enviado(self._chamar("POST", caminho, corpo))

    @staticmethod
    def _extensao_do_arquivo(arquivo: ArquivoParaEnviar) -> str:
        """A extensão vai no caminho (/send-document/pdf): só letras e números."""
        nome = arquivo.nome.rsplit(".", 1)
        bruta = nome[1] if len(nome) == 2 else extensao(arquivo.tipo_conteudo)
        limpa = re.sub(r"[^a-z0-9]", "", bruta.lower())[:10]
        return limpa or "bin"

    # -------------------------------------------------------------- entrada
    def analisar(self, payload: dict) -> Evento:
        evento = Evento()
        tipo = texto(payload.get("type")) or ""
        if tipo == "ReceivedCallback":
            self._mensagem(payload, evento)
        elif tipo == "MessageStatusCallback":
            if not verdade(payload.get("isGroup")):
                novo = STATUS_ZAPI.get(texto(payload.get("status")) or "")
                ids = payload.get("ids") if isinstance(payload.get("ids"), list) else [payload.get("id")]
                for bruto in ids:
                    identificador = texto(bruto)
                    if novo and identificador:
                        evento.recibos.append(AtualizacaoStatus(self.adaptador.id_externo(identificador), novo))
        elif tipo == "DeliveryCallback":
            identificador = texto(payload.get("messageId"))
            if identificador and texto(payload.get("error")):
                evento.recibos.append(AtualizacaoStatus(self.adaptador.id_externo(identificador), StatusMensagem.FALHOU))
        elif tipo == "ConnectedCallback":
            evento.conexao = (CONECTADO, identificador_do_contato(texto(payload.get("phone"))))
        elif tipo == "DisconnectedCallback":
            evento.conexao = (DESCONECTADO, None)
        return evento

    def _mensagem(self, payload: dict, evento: Evento) -> None:
        telefone = texto(payload.get("phone"))
        if (
            verdade(payload.get("isGroup"))
            or verdade(payload.get("isNewsletter"))
            or verdade(payload.get("broadcast"))
            or not e_conversa_privada(telefone)
        ):
            return
        de_mim = verdade(payload.get("fromMe"))
        if de_mim and verdade(payload.get("fromApi")):
            return  # foi o próprio IHchat que mandou: já está no histórico
        identificador = identificador_do_contato(telefone)
        if not identificador:
            return
        conteudo, anexos, especie = self._conteudo(payload)
        nome = texto(payload.get("chatName")) if de_mim else (texto(payload.get("senderName")) or texto(payload.get("chatName")))
        mensagem = montar_mensagem(
            self.adaptador, identificador, texto(payload.get("messageId")), conteudo, anexos, nome, especie
        )
        if mensagem is not None:
            # "phone" pode vir ora com o número, ora com o próprio @lid; o
            # chatLid é o estável (developer.z-api.io/tips/lid). Com os dois, o
            # webhook liga o @lid ao contato do número; só com o @lid, acha o
            # contato por ele — o mesmo cliente não vira duas conversas
            lid = texto(payload.get("chatLid"))
            if e_lid(lid) and not e_lid(identificador):
                mensagem.metadados[METADADO_LID] = lid
            (evento.do_celular if de_mim else evento.recebidas).append(mensagem)

    @staticmethod
    def _conteudo(payload: dict) -> tuple[str | None, list[AnexoRecebido], str | None]:
        """(texto, anexos, tipo). Texto None = tipo que não vira mensagem (reação...)."""
        for especie, (campo_url, nome_padrao) in MIDIAS_ZAPI.items():
            midia = payload.get(especie)
            if not isinstance(midia, dict) or not midia:
                continue  # vazio não é mídia (e no PHP {} e [] são a mesma coisa)
            url = url_de_midia(midia.get(campo_url))
            mime = mime_limpo(texto(midia.get("mimeType")))
            anexos = []
            if url:
                nome = (texto(midia.get("fileName")) or texto(midia.get("title"))) if especie == "document" else None
                anexos.append(
                    AnexoRecebido(
                        nome=nome or f"{nome_padrao}.{extensao(mime, 'webp' if especie == 'sticker' else 'bin')}",
                        referencia=url,
                        tipo_conteudo=mime or None,
                    )
                )
            return texto(midia.get("caption")) or "", anexos, especie
        texto_ = objeto(payload.get("text"))
        if texto_:
            return texto(texto_.get("message")) or "", [], "text"
        local = objeto(payload.get("location"))
        if local:
            return (
                f"[localizacao] {numero_python(local.get('latitude'))},{numero_python(local.get('longitude'))}",
                [],
                "location",
            )
        contato = objeto(payload.get("contact"))
        if contato:
            return f"[contato] {texto(contato.get('displayName')) or ''}".strip(), [], "contact"
        for chave in ("buttonsResponseMessage", "listResponseMessage"):
            resposta = objeto(payload.get(chave))
            if resposta:
                return texto(resposta.get("message")) or texto(resposta.get("title")) or "", [], chave
        return None, [], None

    def baixar(self, anexo: AnexoRecebido) -> bytes:
        url = url_de_midia(anexo.referencia)
        if url is None:
            raise ErroCanal("a Z-API não informou o endereço da mídia")
        return self.baixar_url(url)

"""Evolution API v2: WhatsApp pelo QR Code num servidor próprio (software livre).

Rotas conferidas no código-fonte (github.com/evolution-foundation/evolution-api,
v2.3.7), não só na documentação, que em dois pontos está desatualizada: o
formato de erro e o corpo do webhook/set. Detalhes e links em
php/app/Canais/PROVEDORES-WHATSAPP.md. Mesmo comportamento do PHP
(php/app/Canais/WhatsAppQr/ProvedorEvolution.php).
"""
from __future__ import annotations

import base64
import json
from urllib.parse import quote, urlsplit

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
    base64_ou_nada,
    e_conversa_privada,
    especie_de_envio,
    extensao,
    frase_do_estado,
    identificador_do_contato,
    lista,
    mime_limpo,
    montar_mensagem,
    numero_python,
    objeto,
    qr_como_imagem,
    texto,
    url_de_midia,
    verdade,
)

# eventos que o IHchat assina no webhook/set (os nomes do enum da Evolution)
EVENTOS_EVOLUTION = ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"]

# messages.update -> status da mensagem de saída (src/utils/renderStatus.ts)
STATUS_EVOLUTION = {
    "SERVER_ACK": StatusMensagem.ENVIADA,
    "DELIVERY_ACK": StatusMensagem.ENTREGUE,
    "READ": StatusMensagem.LIDA,
    "PLAYED": StatusMensagem.LIDA,
    "ERROR": StatusMensagem.FALHOU,
}

# messageType -> (tipo, nome padrão do arquivo)
MIDIAS_EVOLUTION = {
    "imageMessage": ("image", "imagem"),
    "videoMessage": ("video", "video"),
    "ptvMessage": ("video", "video"),
    "audioMessage": ("audio", "audio"),
    "documentMessage": ("document", "documento"),
    "stickerMessage": ("sticker", "figurinha"),
}


def _mensagens_do_erro(dados: dict) -> str | None:
    """{"status", "error", "response": {"message": [...]}} (src/main.ts)."""
    resposta = objeto(dados.get("response"))
    mensagens = resposta.get("message")
    if isinstance(mensagens, list):
        partes = [
            texto(m) or (json.dumps(m, ensure_ascii=False, separators=(",", ":")) if isinstance(m, (dict, list)) else "")
            for m in mensagens
        ]
        juntas = "; ".join(p for p in partes if p)
        if juntas:
            return juntas
    return texto(mensagens) or texto(dados.get("message")) or texto(dados.get("error"))


class ProvedorEvolution(ProvedorQR):
    chave = "evolution"
    rotulo = "Evolution API"
    nome = "a Evolution API"
    obrigatorios = ("url_servidor", "api_key", "nome_instancia")

    # ----------------------------------------------------------- transporte
    def _url(self, caminho: str) -> str:
        base = self.credencial("url_servidor").rstrip("/")
        if urlsplit(base).scheme not in ("http", "https") or not urlsplit(base).netloc:
            raise ErroCanal("o endereço do servidor Evolution precisa começar com https:// (ou http://)")
        return f"{base}{caminho}"

    @property
    def instancia(self) -> str:
        return self.credencial("nome_instancia")

    def _caminho(self, rota: str) -> str:
        return f"{rota}/{quote(self.instancia, safe='')}"

    def _chamar(self, metodo: str, caminho: str, corpo=None, params=None) -> tuple[int, dict | list]:
        status, dados, bruto = self.pedir(
            metodo, self._url(caminho), corpo=corpo, cabecalhos={"apikey": self.credencial("api_key")}, params=params
        )
        if dados is None:
            dados = {} if status < 400 else {"message": bruto.strip()[:300]}
        return status, dados

    def _explicar(self, status: int, dados) -> str:
        mensagem = _mensagens_do_erro(dados if isinstance(dados, dict) else {}) or f"HTTP {status}"
        mensagem = self.sem_segredos(mensagem)
        if status == 401:
            return f"a Evolution API recusou ({status}): {mensagem} — confira a API key"
        return f"a Evolution API recusou ({status}): {mensagem}"

    @staticmethod
    def _inexistente(status: int, dados) -> bool:
        """A instância não existe (404 do instanceExistsGuard)."""
        if status != 404:
            return False
        mensagem = (_mensagens_do_erro(dados if isinstance(dados, dict) else {}) or "").lower()
        return "does not exist" in mensagem or "not found" in mensagem or not mensagem

    def _criar_instancia(self) -> dict:
        """Cria a instância (Baileys, com QR Code, ignorando grupos)."""
        status, dados = self._chamar(
            "POST",
            "/instance/create",
            {"instanceName": self.instancia, "integration": "WHATSAPP-BAILEYS", "qrcode": True, "groupsIgnore": True},
        )
        if status == 403 and "already in use" in (_mensagens_do_erro(objeto(dados)) or ""):
            return {}  # criada por outra requisição ao mesmo tempo
        if status in (401, 403):
            raise ErroCanal(
                f"{self._explicar(status, dados)}. Para o IHchat criar a instância, use a API key global "
                "do servidor (AUTHENTICATION_API_KEY), ou crie a instância no painel da Evolution"
            )
        if status >= 400:
            raise ErroCanal(self._explicar(status, dados))
        return objeto(dados)

    # --------------------------------------------------------------- estado
    def _numero_conectado(self) -> str | None:
        try:
            status, dados = self._chamar("GET", "/instance/fetchInstances", params={"instanceName": self.instancia})
        except ErroCanal:
            return None
        if status >= 400:
            return None
        for instancia in lista(dados) if isinstance(dados, list) else [objeto(dados)]:
            numero = identificador_do_contato(texto(instancia.get("ownerJid")))
            if numero:
                return numero
        return None

    def _conectado(self) -> EstadoConexao:
        numero = self._numero_conectado()
        return EstadoConexao(CONECTADO, numero=numero, mensagem=frase_do_estado(CONECTADO, numero))

    def _com_qr(self, dados: dict) -> EstadoConexao:
        qr = qr_como_imagem(texto(dados.get("base64")))
        if qr is None:
            return EstadoConexao(AGUARDANDO, mensagem="o servidor Evolution ainda está gerando o QR Code; aguarde alguns segundos")
        return EstadoConexao(AGUARDANDO, qr=qr, mensagem=frase_do_estado(AGUARDANDO))

    def estado(self, com_qr: bool) -> EstadoConexao:
        status, dados = self._chamar("GET", self._caminho("/instance/connectionState"))
        if self._inexistente(status, dados):
            if not com_qr:
                return EstadoConexao(
                    DESCONECTADO,
                    mensagem=f"a instância “{self.instancia}” ainda não existe no servidor Evolution: "
                    "“Conectar pelo QR Code” a cria",
                )
            return self._com_qr(objeto(self._criar_instancia().get("qrcode")))
        if status >= 400:
            raise ErroCanal(self._explicar(status, dados))
        if texto(objeto(objeto(dados).get("instance")).get("state")) == "open":
            return self._conectado()
        if not com_qr:
            return EstadoConexao(DESCONECTADO, mensagem=frase_do_estado(DESCONECTADO))
        status, dados = self._chamar("GET", self._caminho("/instance/connect"))
        if self._inexistente(status, dados):
            return self._com_qr(objeto(self._criar_instancia().get("qrcode")))
        if status >= 400:
            raise ErroCanal(self._explicar(status, dados))
        dados = objeto(dados)
        if verdade(dados.get("error")):
            return EstadoConexao(ERRO, mensagem=f"a Evolution API recusou: {texto(dados.get('message')) or 'erro ao conectar'}")
        if texto(objeto(dados.get("instance")).get("state")) == "open":
            return self._conectado()
        return self._com_qr(dados)

    def desconectar(self) -> str:
        status, dados = self._chamar("DELETE", self._caminho("/instance/logout"))
        if status < 400:
            return "WhatsApp desconectado da Evolution API: para voltar, leia um QR Code novo"
        mensagem = (_mensagens_do_erro(objeto(dados)) or "").lower()
        if self._inexistente(status, dados) or "not connected" in mensagem:
            return "O WhatsApp já estava desconectado"
        raise ErroCanal(self._explicar(status, dados))

    def conectar_webhook(self, url: str) -> str:
        corpo = {
            "webhook": {
                "enabled": True,
                "url": url,
                "byEvents": False,
                # a mídia recebida já vem no webhook: sem outra ida ao servidor
                "base64": True,
                "events": EVENTOS_EVOLUTION,
            }
        }
        status, dados = self._chamar("POST", self._caminho("/webhook/set"), corpo)
        if self._inexistente(status, dados):
            self._criar_instancia()
            status, dados = self._chamar("POST", self._caminho("/webhook/set"), corpo)
        if status >= 400:
            raise ErroCanal(self._explicar(status, dados))
        return "Webhook conectado: a Evolution API passa a entregar as mensagens deste número ao IHchat"

    # ---------------------------------------------------------------- envio
    def _id_enviado(self, status: int, dados) -> str:
        if status >= 400:
            raise ErroCanal(self._explicar(status, dados))
        identificador = texto(objeto(objeto(dados).get("key")).get("id"))
        if not identificador:
            raise ErroCanal("a Evolution API não devolveu o id da mensagem")
        return identificador

    def enviar_texto(self, numero: str, texto_: str) -> str | None:
        return self._id_enviado(*self._chamar("POST", self._caminho("/message/sendText"), {"number": numero, "text": texto_}))

    def enviar_midia(self, numero: str, arquivo: ArquivoParaEnviar, legenda: str) -> str | None:
        mime = mime_limpo(arquivo.tipo_conteudo) or "application/octet-stream"
        corpo = {
            "number": numero,
            "mediatype": especie_de_envio(mime),
            "mimetype": mime,
            # base64 puro (sem "data:"): é o que o isBase64 do servidor aceita
            "media": base64.b64encode(arquivo.dados).decode(),
            "fileName": arquivo.nome,
        }
        if legenda:
            corpo["caption"] = legenda
        return self._id_enviado(*self._chamar("POST", self._caminho("/message/sendMedia"), corpo))

    # -------------------------------------------------------------- entrada
    def analisar(self, payload: dict) -> Evento:
        evento = Evento()
        nome = texto(payload.get("event")) or ""
        tipo = nome.upper().replace(".", "_").replace("-", "_")
        instancia = texto(payload.get("instance"))
        if instancia and self.instancia and instancia != self.instancia:
            return evento  # entrega de outra instância do mesmo servidor
        dados = payload.get("data")
        itens = lista(dados) if isinstance(dados, list) else [objeto(dados)]
        if tipo == "MESSAGES_UPSERT":
            for item in itens:
                self._mensagem(item, evento)
        elif tipo == "MESSAGES_UPDATE":
            for item in itens:
                novo = STATUS_EVOLUTION.get(texto(item.get("status")) or "")
                identificador = texto(item.get("keyId")) or texto(objeto(item.get("key")).get("id"))
                # só as NOSSAS mensagens têm recibo a aplicar
                if novo and identificador and verdade(item.get("fromMe")) and e_conversa_privada(texto(item.get("remoteJid"))):
                    evento.recibos.append(AtualizacaoStatus(self.adaptador.id_externo(identificador), novo))
        elif tipo == "CONNECTION_UPDATE":
            estado = texto(itens[0].get("state")) if itens else None
            if estado == "open":
                evento.conexao = (CONECTADO, identificador_do_contato(texto(itens[0].get("wuid"))))
            elif estado in ("close", "refused"):
                evento.conexao = (DESCONECTADO, None)
        elif tipo == "QRCODE_UPDATED":
            evento.conexao = (AGUARDANDO, None)
        elif tipo in ("LOGOUT_INSTANCE", "REMOVE_INSTANCE"):
            evento.conexao = (DESCONECTADO, None)
        return evento

    def _mensagem(self, item: dict, evento: Evento) -> None:
        chave = objeto(item.get("key"))
        jid = texto(chave.get("remoteJid"))
        if jid and jid.endswith("@lid") and texto(chave.get("remoteJidAlt")):
            jid = texto(chave.get("remoteJidAlt"))  # o número de verdade, quando o WhatsApp o dá
        if not e_conversa_privada(jid):
            return
        identificador = identificador_do_contato(jid)
        if not identificador:
            return
        de_mim = verdade(chave.get("fromMe"))
        conteudo, anexos, especie = self._conteudo(item, texto(chave.get("id")))
        # o pushName de uma mensagem do próprio dono é "Você": não é o contato
        nome = None if de_mim else texto(item.get("pushName"))
        mensagem = montar_mensagem(self.adaptador, identificador, texto(chave.get("id")), conteudo, anexos, nome, especie)
        if mensagem is not None:
            (evento.do_celular if de_mim else evento.recebidas).append(mensagem)

    @staticmethod
    def _conteudo(item: dict, id_mensagem: str | None) -> tuple[str | None, list[AnexoRecebido], str | None]:
        mensagem = objeto(item.get("message"))
        tipo = texto(item.get("messageType")) or next(
            (chave for chave in mensagem if chave.endswith("Message") or chave == "conversation"), None
        )
        if tipo == "conversation":
            return texto(mensagem.get("conversation")) or "", [], "conversation"
        if tipo == "extendedTextMessage":
            return texto(objeto(mensagem.get("extendedTextMessage")).get("text")) or "", [], tipo
        if tipo in MIDIAS_EVOLUTION:
            especie, nome_padrao = MIDIAS_EVOLUTION[tipo]
            midia = objeto(mensagem.get(tipo))
            mime = mime_limpo(texto(midia.get("mimetype")))
            nome = (texto(midia.get("fileName")) or texto(midia.get("title"))) if especie == "document" else None
            nome = nome or f"{nome_padrao}.{extensao(mime, 'webp' if especie == 'sticker' else 'bin')}"
            # com webhook base64 a mídia já vem aqui; senão, pela URL (S3) ou pela API
            dados = base64_ou_nada(mensagem.get("base64"))
            referencia = url_de_midia(mensagem.get("mediaUrl")) or id_mensagem
            anexo = AnexoRecebido(nome=nome, referencia=None if dados is not None else referencia, dados=dados, tipo_conteudo=mime or None)
            anexos = [anexo] if (anexo.dados is not None or anexo.referencia) else []
            return texto(midia.get("caption")) or "", anexos, especie
        if tipo == "locationMessage":
            local = objeto(mensagem.get("locationMessage"))
            return (
                f"[localizacao] {numero_python(local.get('degreesLatitude'))},{numero_python(local.get('degreesLongitude'))}",
                [],
                "location",
            )
        if tipo == "contactMessage":
            return f"[contato] {texto(objeto(mensagem.get('contactMessage')).get('displayName')) or ''}".strip(), [], "contact"
        if tipo == "buttonsResponseMessage":
            return texto(objeto(mensagem.get(tipo)).get("selectedDisplayText")) or "", [], tipo
        if tipo == "templateButtonReplyMessage":
            return texto(objeto(mensagem.get(tipo)).get("selectedDisplayText")) or "", [], tipo
        if tipo == "listResponseMessage":
            return texto(objeto(mensagem.get(tipo)).get("title")) or "", [], tipo
        return None, [], None

    def baixar(self, anexo: AnexoRecebido) -> bytes:
        referencia = anexo.referencia or ""
        url = url_de_midia(referencia)
        if url is not None:
            return self.baixar_url(url)
        status, dados = self._chamar(
            "POST",
            self._caminho("/chat/getBase64FromMediaMessage"),
            {"message": {"key": {"id": referencia}}, "convertToMp4": False},
        )
        if status >= 400:
            raise ErroCanal(self._explicar(status, dados))
        conteudo = base64_ou_nada(objeto(dados).get("base64"))
        if conteudo is None:
            raise ErroCanal("a Evolution API não devolveu a mídia")
        return conteudo

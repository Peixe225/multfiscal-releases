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

# Versão da Graph API: o ÚNICO lugar a mudar quando a Meta lançar outra (cada
# versão vale cerca de dois anos; a v20.0 expirou em 24/09/2026). A v26.0 saiu
# em 29/07/2026: https://developers.facebook.com/docs/graph-api/changelog/
# O PHP tem a mesma constante em php/app/Canais/AdaptadorWhatsApp.php.
VERSAO_API = "v26.0"
BASE = f"https://graph.facebook.com/{VERSAO_API}"
TIPOS_COM_ARQUIVO = ("image", "audio", "video", "document", "sticker")
# O tipo "image" da Cloud API so aceita JPEG e PNG (WebP e so figurinha): um
# GIF, SVG ou HEIC como "image" e recusado e a mensagem fica "falhou". Como
# documento, com o nome, a Meta entrega o que a lista dela aceitar.
TIPOS_DE_IMAGEM = ("image/jpeg", "image/png")


def especie_da_midia(tipo_conteudo: str) -> str:
    return "image" if (tipo_conteudo or "").split(";")[0].strip().lower() in TIPOS_DE_IMAGEM else "document"


# ----------------------------------------------------- leitura defensiva
# A entrega vem de fora: qualquer campo pode ter o tipo errado. Um .get() sobre
# uma lista derrubava o webhook inteiro com 500 (e a Meta reenvia sem parar).
def _lista(valor) -> list[dict]:
    """Itens-objeto de uma lista JSON; qualquer outra coisa vira lista vazia."""
    return [v for v in valor if isinstance(v, dict)] if isinstance(valor, list) else []


def _objeto(valor) -> dict:
    return valor if isinstance(valor, dict) else {}


def _texto(valor) -> str | None:
    if isinstance(valor, str):
        return valor or None
    if isinstance(valor, (int, float)) and not isinstance(valor, bool):
        return str(valor)
    return None


def _valores(payload: dict) -> list[dict]:
    """Os "value" de entry[].changes[] do webhook da Meta."""
    return [
        mudanca["value"]
        for entrada in _lista(payload.get("entry"))
        for mudanca in _lista(entrada.get("changes"))
        if isinstance(mudanca.get("value"), dict)
    ]


def valores_por_numero(payload: dict) -> list[tuple[str | None, dict]]:
    """O número (Phone number ID) de cada "value" da entrega, na ordem.

    A Meta cadastra a URL do webhook por APP, não por número: com dois números
    no mesmo app (um por setor, por exemplo), as entregas dos dois chegam na
    mesma URL, e o metadata.phone_number_id diz de qual é cada uma.
    """
    return [(_texto(_objeto(v.get("metadata")).get("phone_number_id")), v) for v in _valores(payload)]


def entrega_com(valores: list[dict]) -> dict:
    """Uma entrega só com os "value" dados (o que outro canal recebe dela)."""
    return {
        "object": "whatsapp_business_account",
        "entry": [{"changes": [{"field": "messages", "value": v} for v in valores]}],
    }

_STATUS = {
    "sent": StatusMensagem.ENVIADA,
    "delivered": StatusMensagem.ENTREGUE,
    "read": StatusMensagem.LIDA,
    "failed": StatusMensagem.FALHOU,
}


def _explicar_erro_meta(status: int, dados: dict, texto: str) -> str:
    """Repete a mensagem da Meta e, nos erros comuns, diz onde corrigir."""
    erro = dados.get("error") if isinstance(dados.get("error"), dict) else {}
    mensagem = erro.get("message") or texto[:300] or f"HTTP {status}"
    codigo = erro.get("code")
    if codigo == 190 or status == 401:
        dica = "o token está inválido ou expirou; gere um token permanente (usuário do sistema)"
    elif codigo == 100:
        dica = "confira o ID do número: é o 'Phone number ID', não o telefone"
    else:
        return f"a Meta recusou ({status}): {mensagem}"
    return f"a Meta recusou ({status}): {mensagem} — {dica}"


class AdaptadorWhatsApp(AdaptadorCanal):
    tipo = TipoCanal.WHATSAPP
    campos_obrigatorios = ("token", "id_numero")

    # ------------------------------------------------------------------ estado
    def verificar_conexao(self) -> str:
        if not self.configurado:
            return super().verificar_conexao()  # a base diz o que falta preencher
        id_numero = self.credenciais["id_numero"]
        with cliente() as http:
            try:
                resposta = http.get(
                    f"{BASE}/{id_numero}",
                    params={"fields": "display_phone_number,verified_name"},
                    headers={"Authorization": f"Bearer {self.credenciais['token']}"},
                )
            except Exception as exc:
                raise ErroCanal(f"falha de rede com a API do WhatsApp: {exc}") from exc
        try:
            dados = resposta.json()
        except ValueError:
            dados = {}
        if not isinstance(dados, dict):
            dados = {}
        if resposta.status_code >= 400:
            raise ErroCanal(_explicar_erro_meta(resposta.status_code, dados, resposta.text))
        numero = dados.get("display_phone_number") or id_numero
        nome = dados.get("verified_name")
        return f"Conectado ao número {numero} ({nome})" if nome else f"Conectado ao número {numero}"

    # ------------------------------------------------------------- assinatura
    def _segredo_de_assinatura(self) -> tuple[str | None, str]:
        """O segredo que confere as entregas e de onde ele veio.

        A Meta assina com o App Secret do app dela, nunca com um segredo nosso.
        Ordem: `segredo_app` (o campo da tela); `segredo_webhook` dentro das
        credenciais, que e onde o README antigo mandava pôr o App Secret via
        curl; por ultimo a coluna do canal, que o cadastro antigo enchia com um
        valor aleatorio que a Meta nunca conheceu.
        """
        for chave in ("segredo_app", "segredo_webhook"):
            if self.credenciais.get(chave):
                return self.credenciais[chave], "app_secret"
        if self.canal.segredo_webhook:
            return self.canal.segredo_webhook, "legada"
        return None, "nenhuma"

    @property
    def origem_assinatura(self) -> str:
        """Um de "app_secret", "legada" ou "nenhuma": a tela avisa cada caso de um jeito."""
        return self._segredo_de_assinatura()[1]

    @property
    def alerta_de_assinatura(self) -> str | None:
        """O que o admin precisa saber mesmo com o token funcionando."""
        origem = self.origem_assinatura
        if origem == "nenhuma":
            return (
                "sem o App Secret, a assinatura das entregas não é conferida: quem souber a URL "
                "do webhook pode forjar mensagens de clientes. Preencha-o em Editar"
            )
        if origem == "legada":
            # quem semeou a base antes da correcao cai aqui sem ter feito nada
            return (
                "há um segredo antigo, gerado pelo sistema, que a Meta não conhece: toda entrega "
                "da Meta será recusada (401) até você preencher o App Secret em Editar"
            )
        return None

    # ---------------------------------------------------------------- entrada
    def verificar_assinatura(self, corpo: bytes, cabecalhos: Mapping[str, str]) -> bool:
        segredo, _ = self._segredo_de_assinatura()
        if not segredo:
            return True
        return assinatura_valida(segredo, corpo, cabecalhos.get("x-hub-signature-256"))

    def desafio_verificacao(self, parametros: Mapping[str, str]) -> str | None:
        esperado = self.credenciais.get("token_verificacao")
        if parametros.get("hub.mode") == "subscribe" and esperado and parametros.get("hub.verify_token") == esperado:
            return parametros.get("hub.challenge")
        return None

    @property
    def id_numero(self) -> str:
        """O Phone number ID deste canal ('' quando não preenchido)."""
        return str(self.credenciais.get("id_numero") or "").strip()

    def _valores_deste_numero(self, payload: dict) -> list[dict]:
        """Os "value" que são deste canal: sem metadata (entrega montada à mão)
        ou sem id_numero cadastrado (sandbox), tudo; senão, só os do seu
        número. A rota já encaminha os dos outros números ao canal certo; isto
        garante que, mesmo sem ela, a conversa do número B nunca abre no A."""
        meu = self.id_numero
        return [v for numero, v in valores_por_numero(payload) if numero is None or not meu or numero == meu]

    def analisar_webhook(self, payload: dict) -> list[MensagemRecebida]:
        recebidas: list[MensagemRecebida] = []
        for valor in self._valores_deste_numero(payload):
            # os dois lados sao normalizados: o numero pode vir formatado
            perfis = {
                normalizar_telefone(_texto(c.get("wa_id")) or ""): _texto(_objeto(c.get("profile")).get("name"))
                for c in _lista(valor.get("contacts"))
            }
            for msg in _lista(valor.get("messages")):
                conteudo = self._extrair_conteudo(msg)
                if conteudo is None:
                    continue
                anexos = self._anexos_de(msg)
                if not conteudo and not anexos:
                    continue  # nada que valha uma mensagem
                remetente = normalizar_telefone(_texto(msg.get("from")) or "")
                if not remetente:
                    continue
                recebidas.append(
                    MensagemRecebida(
                        identificador=remetente,
                        conteudo=conteudo,
                        nome_exibicao=perfis.get(remetente),
                        externo_id=self._prefixar(_texto(msg.get("id"))),
                        metadados={"tipo_whatsapp": _texto(msg.get("type"))},
                        anexos=anexos,
                    )
                )
        return recebidas

    @staticmethod
    def _anexos_de(msg: dict) -> list[AnexoRecebido]:
        tipo = msg.get("type")
        if tipo not in TIPOS_COM_ARQUIVO:
            return []
        midia = _objeto(msg.get(tipo))
        referencia = _texto(midia.get("id"))
        if not referencia:
            return []
        mime = (_texto(midia.get("mime_type")) or "").split(";")[0].strip()
        extensao = mime.split("/")[-1] if "/" in mime else "bin"
        return [
            AnexoRecebido(
                nome=_texto(midia.get("filename")) or f"{tipo}.{extensao}",
                referencia=referencia,
                tipo_conteudo=mime or None,
            )
        ]

    @staticmethod
    def _extrair_conteudo(msg: dict) -> str | None:
        tipo = msg.get("type")
        parte = _objeto(msg.get(tipo)) if isinstance(tipo, str) else {}
        if tipo == "text":
            return _texto(parte.get("body")) or ""
        if tipo == "button":
            return _texto(parte.get("text")) or ""
        if tipo == "interactive":
            for chave in ("button_reply", "list_reply"):
                if chave in parte:
                    return _texto(_objeto(parte[chave]).get("title")) or ""
            return None
        if tipo in TIPOS_COM_ARQUIVO:
            # o arquivo vem junto como anexo; sem legenda, a mensagem é só ele
            return _texto(parte.get("caption")) or ""
        if tipo == "location":
            return f"[localizacao] {parte.get('latitude')},{parte.get('longitude')}"
        return None

    def analisar_status(self, payload: dict) -> list[AtualizacaoStatus]:
        atualizacoes: list[AtualizacaoStatus] = []
        for valor in self._valores_deste_numero(payload):
            for st in _lista(valor.get("statuses")):
                # status em formato inesperado (lista, número) é ignorado: como
                # chave de dicionário, derrubava a entrega inteira com TypeError
                status = _texto(st.get("status"))
                novo = _STATUS.get(status) if isinstance(st.get("status"), str) else None
                identificador = _texto(st.get("id"))
                if novo and identificador:
                    atualizacoes.append(AtualizacaoStatus(self._prefixar(identificador), novo))
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
            especie = especie_da_midia(arquivo.tipo_conteudo)
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

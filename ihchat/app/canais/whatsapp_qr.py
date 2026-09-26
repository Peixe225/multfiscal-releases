"""WhatsApp comum conectado pelo QR Code, com a sessão num provedor online.

O QR Code do WhatsApp (o protocolo do WhatsApp Web) exige uma sessão ligada o
tempo todo, e a hospedagem compartilhada não mantém processo nenhum. A sessão
fica então num PROVEDOR (Z-API, hospedado; ou Evolution API, software livre
num servidor próprio) e o IHchat fala com ele por REST e recebe por webhook.
Nada é instalado no computador do dono.

Não é a API oficial da Meta (essa é o tipo "whatsapp"): o WhatsApp pode
bloquear o número que mandar mensagem em massa. Rotas, formatos e links dos
dois provedores: php/app/Canais/PROVEDORES-WHATSAPP.md. O PHP tem o mesmo
comportamento em php/app/Canais/AdaptadorWhatsAppQr.php e WhatsAppQr/.
"""
from __future__ import annotations

import base64
import hmac
import ipaddress
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Mapping
from urllib.parse import urlsplit

from ..config import obter_config
from ..models import StatusMensagem, TipoCanal
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

PROVEDORES = ("zapi", "evolution")
PROVEDOR_PADRAO = "zapi"

# estado da conexão: o que GET /api/canais/{id}/qr devolve em "status"
CONECTADO = "conectado"
AGUARDANDO = "aguardando_leitura"
DESCONECTADO = "desconectado"
ERRO = "erro"

# credenciais NÃO secretas que o próprio servidor grava (não são campos do formulário)
CHAVE_ESTADO = "estado_conexao"
CHAVE_NUMERO = "numero_conectado"
CHAVE_WEBHOOK = "webhook_url"

# Dados que valem para UMA instância do provedor. Trocar de instância (outro
# ID na Z-API, outro servidor ou nome na Evolution, outro provedor) os
# invalida: a instância nova nasce sem webhook e sem número conectado, e
# mantê-los fazia o painel dizer "webhook cadastrado" enquanto nenhuma
# mensagem chegava. Igual ao AdaptadorWhatsAppQr.php.
CHAVES_DA_INSTANCIA = (CHAVE_ESTADO, CHAVE_NUMERO, CHAVE_WEBHOOK)

# o que o painel mostra como "autor" de uma resposta que o dono mandou pelo
# celular: gravado em mensagens.assinatura, que os dois servidores já leem
ASSINATURA_DO_CELULAR = {"nome": "Enviada pelo celular", "setor": None}

# metadado da mensagem recebida com o "@lid" do contato quando a entrega traz
# também o número: o webhook liga as duas identidades ao mesmo contato
METADADO_LID = "lid_whatsapp"

# Recibos chegam fora de ordem (a Evolution dispara cada webhook sem esperar
# o anterior; a Z-API pode mandar o RECEIVED depois do READ): o recibo só
# AVANÇA o status. Para cada status novo, os atuais que ele pode substituir.
# "enviada" não substitui nada (a mensagem já nasce enviada), e "falhou" só
# vale enquanto ninguém confirmou a entrega. Igual ao PHP.
RECIBO_SUBSTITUI = {
    StatusMensagem.ENTREGUE.value: (StatusMensagem.ENVIADA.value, StatusMensagem.FALHOU.value),
    StatusMensagem.LIDA.value: (StatusMensagem.ENVIADA.value, StatusMensagem.ENTREGUE.value, StatusMensagem.FALHOU.value),
    StatusMensagem.FALHOU.value: (StatusMensagem.ENVIADA.value,),
}

# o que vai como imagem ou vídeo; o resto segue como documento, com o nome
# (um GIF ou HEIC como "imagem" pode ser recusado ou chegar estragado)
TIPOS_DE_IMAGEM = ("image/jpeg", "image/png")
TIPOS_DE_VIDEO = ("video/mp4", "video/3gpp")


# ----------------------------------------------------- leitura defensiva
# A entrega vem de fora: qualquer campo pode ter o tipo errado, e um 500 faz o
# provedor reenviar sem parar.
def objeto(valor) -> dict:
    return valor if isinstance(valor, dict) else {}


def lista(valor) -> list[dict]:
    return [v for v in valor if isinstance(v, dict)] if isinstance(valor, list) else []


def texto(valor) -> str | None:
    if isinstance(valor, str):
        return valor or None
    if isinstance(valor, (int, float)) and not isinstance(valor, bool):
        return str(valor)
    return None


def verdade(valor) -> bool:
    return valor is True or (isinstance(valor, str) and valor.lower() == "true")


def numero_python(valor) -> str:
    """Número como str() do Python o escreve (o PHP imita em Leitura::numero)."""
    if isinstance(valor, bool) or valor is None:
        return "None"
    if isinstance(valor, (int, float)):
        return str(valor)
    return texto(valor) or "None"


def numero_legivel(numero: str | None) -> str:
    """"+55 (11) 98888-7777", como o painel mostra (numeroLegivel do painel.js)."""
    digitos = str(numero or "")
    brasil = re.fullmatch(r"55(\d{2})(\d{4,5})(\d{4})", digitos)
    if brasil:
        return f"+55 ({brasil[1]}) {brasil[2]}-{brasil[3]}"
    return f"+{digitos}" if digitos.isdigit() else digitos


def e_lid(valor: str | None) -> bool:
    """"81896604192873@lid": o id oculto do WhatsApp, sem telefone."""
    usuario, arroba, servidor = (valor or "").strip().partition("@")
    return bool(usuario) and arroba == "@" and servidor == "lid"


def identidade_da_instancia(credenciais: dict) -> tuple:
    """O que identifica a instância no provedor (a sessão do WhatsApp)."""
    provedor = credenciais.get("provedor")
    provedor = provedor.strip().lower() if isinstance(provedor, str) and provedor.strip() else PROVEDOR_PADRAO

    def valor(chave: str) -> str:
        bruto = credenciais.get(chave)
        return str(bruto).strip() if bruto is not None else ""

    if provedor == "evolution":
        return (provedor, valor("url_servidor").rstrip("/"), valor("nome_instancia"))
    return (provedor, valor("instancia_id"), valor("instancia_token"))


def sem_dados_de_outra_instancia(atuais: dict, novas: dict) -> dict:
    """As credenciais novas sem estado, número e webhook quando a instância mudou."""
    if identidade_da_instancia(atuais) == identidade_da_instancia(novas):
        return novas
    return {chave: valor for chave, valor in novas.items() if chave not in CHAVES_DA_INSTANCIA}


def mime_limpo(tipo: str | None) -> str:
    return (tipo or "").split(";")[0].strip().lower()


def extensao(tipo: str | None, padrao: str = "bin") -> str:
    mime = mime_limpo(tipo)
    return mime.split("/")[-1] if "/" in mime and mime.split("/")[-1] else padrao


def especie_de_envio(tipo_conteudo: str) -> str:
    mime = mime_limpo(tipo_conteudo)
    if mime in TIPOS_DE_IMAGEM:
        return "image"
    if mime in TIPOS_DE_VIDEO:
        return "video"
    return "document"


def identificador_do_contato(valor: str | None) -> str | None:
    """O número (só dígitos) de "5511...", "5511...@s.whatsapp.net" ou
    "5511...@c.us". Um "@lid" (id oculto do WhatsApp, sem telefone) fica
    inteiro: é para ele que a resposta volta."""
    bruto = (valor or "").strip()
    if not bruto:
        return None
    if "@" in bruto:
        usuario, _, servidor = bruto.partition("@")
        if servidor == "lid":
            return bruto if usuario else None
        bruto = usuario.split(":")[0]
    digitos = normalizar_telefone(bruto)
    return digitos or None


def e_conversa_privada(jid: str | None) -> bool:
    """Grupo, lista de transmissão, status e canal (newsletter) ficam de fora."""
    valor = (jid or "").strip().lower()
    if not valor:
        return False
    return not (
        valor.endswith("@g.us")
        or valor.endswith("-group")
        or valor.endswith("@broadcast")
        or valor.endswith("@newsletter")
        or valor == "status@broadcast"
    )


def url_de_midia(valor) -> str | None:
    """Só baixa de http(s): nenhuma outra URL chega ao cliente HTTP."""
    endereco = texto(valor)
    if not endereco:
        return None
    return endereco if urlsplit(endereco).scheme in ("http", "https") else None


def host_local(host: str) -> bool:
    """localhost ou IP de loopback: o tráfego não sai do próprio servidor."""
    nome = (host or "").strip().lower().rstrip(".").strip("[]")
    if nome == "localhost" or nome.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(nome).is_loopback
    except ValueError:
        return False


def problema_no_endereco_evolution(endereco: str) -> str | None:
    """Por que o endereço do servidor Evolution não serve (None = serve).

    A API key (muitas vezes a GLOBAL, que controla todas as instâncias) vai
    num cabeçalho de cada chamada: por http:// ela passaria sem criptografia
    pela internet a cada consulta do diálogo, envio e teste. Fora do sandbox,
    só https://, ou http:// para o próprio servidor (localhost). Igual ao PHP.
    """
    partes = urlsplit(endereco)
    esquema = partes.scheme.lower()
    if esquema not in ("http", "https") or not partes.hostname:
        return "precisa começar com https://, ex.: https://evolution.suaempresa.com.br"
    if esquema == "http" and not host_local(partes.hostname) and not obter_config().modo_sandbox:
        return (
            "precisa usar https://: por http:// a API key iria sem criptografia pela internet "
            "(http:// só vale para um servidor Evolution nesta mesma máquina, em localhost)"
        )
    return None


def qr_como_imagem(valor: str | None) -> str | None:
    """"data:image/png;base64,..." (o provedor às vezes manda só o base64)."""
    if not valor:
        return None
    return valor if valor.startswith("data:image/") else f"data:image/png;base64,{valor}"


# ------------------------------------------------------------- resultados
@dataclass(slots=True)
class EstadoConexao:
    status: str
    qr: str | None = None
    numero: str | None = None
    mensagem: str = ""

    def como_dict(self) -> dict:
        return {"status": self.status, "qr": self.qr, "numero": self.numero, "mensagem": self.mensagem}


@dataclass(slots=True)
class Evento:
    """O que uma entrega do provedor traz, já traduzido."""

    recebidas: list[MensagemRecebida] = field(default_factory=list)
    do_celular: list[MensagemRecebida] = field(default_factory=list)  # fromMe: o dono pelo celular
    recibos: list[AtualizacaoStatus] = field(default_factory=list)
    conexao: tuple[str, str | None] | None = None  # (estado, número)


def credenciais_com_conexao(credenciais: dict, estado: str, numero: str | None) -> dict | None:
    """As credenciais com o estado novo, ou None se nada mudou (sem gravar à toa).

    O número só fica enquanto está conectado: depois de desconectar, ele não
    diz mais nada.
    """
    if estado not in (CONECTADO, AGUARDANDO, DESCONECTADO):
        return None
    novas = {**credenciais, CHAVE_ESTADO: estado}
    if estado == CONECTADO and numero:
        novas[CHAVE_NUMERO] = numero
    elif estado != CONECTADO:
        novas.pop(CHAVE_NUMERO, None)
    return None if novas == credenciais else novas


# --------------------------------------------------------------- provedor
class ProvedorQR(ABC):
    """O que cada provedor sabe fazer. Um objeto por requisição."""

    chave: str
    rotulo: str  # "Z-API"
    nome: str  # "a Z-API": entra nas frases de erro
    obrigatorios: tuple[str, ...] = ()

    def __init__(self, adaptador: "AdaptadorWhatsAppQR"):
        self.adaptador = adaptador
        self.credenciais = adaptador.credenciais

    def credencial(self, chave: str) -> str:
        valor = self.credenciais.get(chave)
        return str(valor).strip() if isinstance(valor, (str, int, float)) and not isinstance(valor, bool) else ""

    def sem_segredos(self, mensagem: str) -> str:
        """Token e API key nunca aparecem num erro que vai para a tela."""
        for chave in ("instancia_token", "client_token", "api_key"):
            valor = self.credencial(chave)
            if len(valor) >= 4:
                mensagem = mensagem.replace(valor, "<oculto>")
        return mensagem

    def pedir(self, metodo: str, url: str, *, corpo=None, cabecalhos: dict | None = None, params=None):
        """(status, json-objeto, texto). Falha de rede vira ErroCanal sem segredo."""
        with cliente() as http:
            try:
                resposta = http.request(metodo, url, json=corpo, headers=cabecalhos or {}, params=params)
            except Exception as exc:  # httpx.HTTPError e afins
                raise ErroCanal(self.sem_segredos(f"falha de rede com {self.nome}: {exc}")) from exc
        try:
            dados = resposta.json()
        except ValueError:
            dados = None
        return resposta.status_code, dados, resposta.text

    def baixar_url(self, url: str) -> bytes:
        """Mídia hospedada pelo provedor: GET simples, SEM as credenciais (a URL
        veio no webhook e não pode receber o token de ninguém). Só endereço
        público e até o limite de anexos: a URL pode ter sido forjada por quem
        tem o token do webhook (rede.py)."""
        from ..servicos.anexos import limite_bytes  # tardia: anexos importa os canais
        from .rede import baixar_publico

        return baixar_publico(url, limite_bytes())

    @abstractmethod
    def estado(self, com_qr: bool) -> EstadoConexao: ...

    @abstractmethod
    def desconectar(self) -> str: ...

    @abstractmethod
    def conectar_webhook(self, url: str) -> str: ...

    @abstractmethod
    def enviar_texto(self, numero: str, texto_: str) -> str | None: ...

    @abstractmethod
    def enviar_midia(self, numero: str, arquivo: ArquivoParaEnviar, legenda: str) -> str | None: ...

    @abstractmethod
    def analisar(self, payload: dict) -> Evento: ...

    @abstractmethod
    def baixar(self, anexo: AnexoRecebido) -> bytes: ...


def frase_do_estado(estado: str, numero: str | None = None) -> str:
    if estado == CONECTADO:
        return f"WhatsApp conectado ao número {numero_legivel(numero)}" if numero else "WhatsApp conectado"
    if estado == AGUARDANDO:
        return "Abra o WhatsApp no celular e leia o QR Code"
    return "O WhatsApp não está conectado: leia o QR Code para conectar"


# -------------------------------------------------------------- adaptador
class AdaptadorWhatsAppQR(AdaptadorCanal):
    tipo = TipoCanal.WHATSAPP_QR

    def __init__(self, canal):
        super().__init__(canal)
        self._traduzido: tuple[dict, Evento] | None = None
        # preenchidos por verificar_conexao, para o "Testar conexão"
        self.ultimo_estado: EstadoConexao | None = None
        self.alerta_de_conexao: str | None = None
        # Evolution: quem chama pode pedir que uma instância criada agora já
        # nasça com o webhook (a URL com o token do canal). Depois da chamada,
        # instancia_criada diz se o provedor criou a instância, e
        # webhook_na_criacao se ela nasceu com esse webhook: uma instância
        # recriada sem ele não recebe nada, e o webhook gravado deixa de valer
        self.webhook_da_instancia: str | None = None
        self.instancia_criada = False
        self.webhook_na_criacao = False

    # ------------------------------------------------------------ provedor
    @property
    def chave_provedor(self) -> str:
        valor = self.credenciais.get("provedor")
        valor = valor.strip().lower() if isinstance(valor, str) and valor.strip() else PROVEDOR_PADRAO
        return valor

    @property
    def provedor(self) -> ProvedorQR:
        # importação tardia: cada provedor importa este módulo
        from .evolution import ProvedorEvolution
        from .zapi import ProvedorZApi

        classes = {"zapi": ProvedorZApi, "evolution": ProvedorEvolution}
        classe = classes.get(self.chave_provedor)
        if classe is None:
            raise ErroCanal(f"provedor desconhecido: {self.chave_provedor} (use zapi ou evolution)")
        return classe(self)

    @property
    def campos_obrigatorios(self) -> tuple[str, ...]:  # type: ignore[override]
        try:
            return self.provedor.obrigatorios
        except ErroCanal:
            return ("provedor",)

    # ------------------------------------------------------------- entrada
    def verificar_assinatura(self, corpo: bytes, cabecalhos: Mapping[str, str]) -> bool:
        """O token do canal vem na URL cadastrada no provedor (?token=), que a
        rota copia para X-IHchat-Token. Sem segredo no canal, nada passa: sem
        ele qualquer um que soubesse a URL forjaria mensagens de clientes."""
        segredo = self.canal.segredo_webhook or ""
        recebido = cabecalhos.get("x-ihchat-token") or ""
        if not segredo or not recebido:
            return False
        return hmac.compare_digest(recebido.encode(), segredo.encode())

    def _evento(self, payload: dict) -> Evento:
        # a rota pede entradas, recibos, "do celular" e conexão da MESMA entrega:
        # traduz uma vez só (a referência ao payload fica guardada junto)
        if self._traduzido is None or self._traduzido[0] is not payload:
            try:
                evento = self.provedor.analisar(payload)
            except ErroCanal:
                evento = Evento()  # provedor desconhecido: nada a registrar
            self._traduzido = (payload, evento)
        return self._traduzido[1]

    def analisar_webhook(self, payload: dict) -> list[MensagemRecebida]:
        return self._evento(payload).recebidas

    def analisar_status(self, payload: dict) -> list[AtualizacaoStatus]:
        return self._evento(payload).recibos

    def analisar_do_celular(self, payload: dict) -> list[MensagemRecebida]:
        """Mensagens que o dono mandou pelo próprio celular (fromMe)."""
        return self._evento(payload).do_celular

    def analisar_conexao(self, payload: dict) -> tuple[str, str | None] | None:
        return self._evento(payload).conexao

    def baixar_anexo(self, anexo: AnexoRecebido) -> bytes:
        if anexo.dados is not None:
            return anexo.dados
        if not anexo.referencia:
            raise ErroCanal("anexo sem referência de mídia")
        return self.provedor.baixar(anexo)

    def id_externo(self, identificador: str | None) -> str | None:
        """"whatsapp_qr:<canal>:<id>": o id da mensagem é do WhatsApp, e a mesma
        mensagem entre dois números conectados chegaria aos dois canais."""
        return self._prefixar_no_canal(identificador)

    # -------------------------------------------------------------- estado
    def estado_qr(self, com_qr: bool = True) -> EstadoConexao:
        """Estado (e o QR Code, se com_qr) no provedor; erro vira status "erro"."""
        try:
            return self.provedor.estado(com_qr=com_qr)
        except ErroCanal as exc:
            return EstadoConexao(ERRO, mensagem=str(exc))

    def verificar_conexao(self) -> str:
        if not self.configurado:
            return super().verificar_conexao()
        provedor = self.provedor
        estado = provedor.estado(com_qr=False)
        self.ultimo_estado = estado
        if estado.status == ERRO:
            raise ErroCanal(estado.mensagem)
        if estado.status == CONECTADO:
            return f"{estado.mensagem} (via {provedor.rotulo})"
        # as credenciais funcionam; o que falta é o celular ler o QR Code
        self.alerta_de_conexao = (
            "o WhatsApp ainda não está conectado: use “Conectar pelo QR Code” e leia o código com o celular"
        )
        return f"{provedor.nome[0].upper()}{provedor.nome[1:]} aceitou as credenciais"

    def desconectar(self) -> str:
        return self.provedor.desconectar()

    def conectar_webhook(self, url: str) -> str:
        return self.provedor.conectar_webhook(url)

    # --------------------------------------------------------------- saída
    @property
    def envia_arquivos(self) -> bool:
        return True

    def _enviar(self, destino: str, conteudo: str, contexto: dict) -> ResultadoEnvio:
        provedor = self.provedor
        # o texto já chega assinado ("*Ana · Suporte*" na primeira linha) pelo
        # núcleo (aplicar_assinatura), como no WhatsApp oficial
        texto_ = conteudo
        arquivos: list[ArquivoParaEnviar] = contexto.get("arquivos") or []
        numero = identificador_do_contato(destino) or destino
        if arquivos:
            # uma mensagem carrega uma mídia; o texto vira a legenda dela
            identificador = provedor.enviar_midia(numero, arquivos[0], texto_)
        else:
            identificador = provedor.enviar_texto(numero, texto_)
        return ResultadoEnvio(status=StatusMensagem.ENVIADA, externo_id=self.id_externo(identificador))


# ------------------------------------------------ montagem das mensagens
def montar_mensagem(
    adaptador: AdaptadorWhatsAppQR,
    identificador: str,
    id_mensagem: str | None,
    conteudo: str | None,
    anexos: list[AnexoRecebido],
    nome: str | None,
    tipo: str | None,
) -> MensagemRecebida | None:
    """A mensagem traduzida, ou None quando não há nada que valha registrar."""
    if conteudo is None or (not conteudo and not anexos):
        return None
    return MensagemRecebida(
        identificador=identificador,
        conteudo=conteudo,
        nome_exibicao=nome,
        externo_id=adaptador.id_externo(id_mensagem),
        metadados={"tipo_whatsapp": tipo},
        anexos=anexos,
    )


def base64_ou_nada(valor) -> bytes | None:
    bruto = texto(valor)
    if not bruto:
        return None
    if bruto.startswith("data:") and "," in bruto:
        bruto = bruto.split(",", 1)[1]
    try:
        return base64.b64decode(re.sub(r"\s+", "", bruto), validate=True)
    except (ValueError, TypeError):
        return None

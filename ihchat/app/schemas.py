"""Contratos de entrada e saida da API (pydantic v2)."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, ConfigDict, EmailStr, Field, field_validator
from pydantic_core import PydanticCustomError

from .models import Direcao, Papel, Prioridade, StatusConversa, TipoCanal


class Modelo(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ----------------------------------------------------------------- atendentes
MAX_SETOR = 60


def _aparar(valor):
    """Espaço em volta não conta no limite; em branco é "sem setor"."""
    return valor.strip() if isinstance(valor, str) else valor


# o setor aparece para o cliente ao lado do nome ("Ana · Suporte técnico")
Setor = Annotated[Annotated[str, Field(max_length=MAX_SETOR)] | None, BeforeValidator(_aparar)]


# O bcrypt (password_hash do PHP, e o que a base migrada usa) só olha os 72
# primeiros BYTES: uma senha maior seria cortada em silêncio, e quem digitasse
# só o começo entraria. Caractere de controle (NUL, quebra de linha) derruba o
# password_hash do PHP. As mesmas regras nos dois servidores.
SENHA_MAX_BYTES = 72
_CONTROLE = re.compile(r"[\x00-\x1f\x7f]")


def _senha_valida(valor: str | None) -> str | None:
    if valor is None:
        return valor
    if _CONTROLE.search(valor):
        raise ValueError("senha: não pode ter caracteres de controle (tabulação, quebra de linha, caractere nulo)")
    if len(valor.encode()) > SENHA_MAX_BYTES:
        raise ValueError(f"senha: pode ter no máximo {SENHA_MAX_BYTES} bytes (letra com acento conta 2)")
    return valor


class AtendenteEntrada(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    email: EmailStr
    senha: str = Field(min_length=6, max_length=128)
    papel: Papel = Papel.ATENDENTE
    setor: Setor = None

    senha_valida = field_validator("senha")(_senha_valida)


class AtendenteAtualizacao(BaseModel):
    nome: str | None = Field(default=None, min_length=2, max_length=120)
    senha: str | None = Field(default=None, min_length=6, max_length=128)
    papel: Papel | None = None
    ativo: bool | None = None
    disponivel: bool | None = None
    # PATCH: ausente mantém; null ou "" limpa (ver model_fields_set na rota)
    setor: Setor = None

    senha_valida = field_validator("senha")(_senha_valida)


class AtendenteSaida(Modelo):
    id: int
    nome: str
    email: str
    papel: str
    ativo: bool
    disponivel: bool
    setor: str | None = None

    @field_validator("setor")
    @classmethod
    def _vazio_e_nulo(cls, valor: str | None) -> str | None:
        return valor or None


class Credenciais(BaseModel):
    # no login o e-mail e apenas uma chave de busca; validar formato aqui so
    # atrapalharia instalacoes internas (dominios .local, por exemplo)
    email: str
    senha: str


class TokenSaida(BaseModel):
    token: str
    atendente: AtendenteSaida


# ---------------------------------------------------------------------- canais
def _nome_de_canal(valor: str | None) -> str | None:
    """Apara antes de medir: com min_length sobre o texto cru, "   " passava e
    virava um canal sem nome nos filtros. A mensagem vai direto para a tela."""
    if valor is None:
        return None
    valor = valor.strip()
    if not 2 <= len(valor) <= 120:
        raise PydanticCustomError(
            "nome_do_canal", "o nome do canal precisa ter de 2 a 120 caracteres (espaços não contam)"
        )
    return valor


class CanalEntrada(BaseModel):
    nome: str
    tipo: TipoCanal
    credenciais: dict = Field(default_factory=dict)
    ativo: bool = True

    _validar_nome = field_validator("nome")(_nome_de_canal)


class CanalAtualizacao(BaseModel):
    nome: str | None = None
    # so as chaves enviadas mudam; segredo em branco mantem o atual (a tela
    # nunca recebe o valor de volta para poder reenvia-lo)
    credenciais: dict | None = None
    # o unico jeito de apagar um segredo: em branco quer dizer "manter", e sem
    # isto um token colado num canal de demonstracao nao teria volta ao sandbox
    limpar: list[str] = Field(default_factory=list)
    ativo: bool | None = None

    _validar_nome = field_validator("nome")(_nome_de_canal)


class CampoCanalSaida(BaseModel):
    chave: str
    rotulo: str
    secreto: bool = False
    obrigatorio: bool = False
    ajuda: str = ""
    padrao: str = ""
    opcoes: list[str] = []
    # num segredo: os campos que dizem para onde ele vai. Mudou um deles, a
    # API exige o segredo digitado de novo (a tela ja o marca como obrigatorio)
    destinos: list[str] = []


class CredenciaisCanalSaida(BaseModel):
    # sem os campos secretos: deles o navegador so fica sabendo se existem
    credenciais: dict
    secretos_definidos: list[str] = []
    segredo_webhook: str | None = None
    chave_publica: str | None = None
    campos_obrigatorios: list[str] = []
    # so WhatsApp: "app_secret", "legada" (segredo antigo que a Meta nao
    # conhece: recusa tudo) ou "nenhuma" (nao confere nada)
    assinatura: str | None = None


class TesteConexaoSaida(BaseModel):
    ok: bool
    mensagem: str
    # conectou, mas ha algo a resolver (canal desativado, webhook sem
    # assinatura): a tela mostra em ambar, nao em verde
    alerta: str | None = None


class CanalSaida(Modelo):
    id: int
    nome: str
    tipo: str
    ativo: bool
    chave_publica: str | None = None
    configurado: bool = False
    url_webhook: str | None = None
    # só no WhatsApp pelo QR Code: "conectado", "aguardando_leitura" ou
    # "desconectado", o último estado que o servidor viu (webhook, /qr ou
    # testar). None nos outros tipos e antes da primeira conferência. Não é
    # segredo: é o que deixa a equipe ver que o celular caiu.
    conexao: str | None = None


# -------------------------------------------------------------------- contatos
class IdentidadeSaida(Modelo):
    canal_tipo: str
    identificador: str
    nome_exibicao: str | None = None


# o telefone é gravado só com dígitos numa coluna de 32 (contatos.telefone)
MAX_DIGITOS_TELEFONE = 32


class ContatoAtualizacao(BaseModel):
    """PATCH da ficha: só os campos enviados mudam; null limpa (menos o nome).

    Os limites são os das colunas: sem eles, texto longo demais virava 500 do
    banco (o MySQL estrito recusa), em vez de um 422 que a tela mostra.
    """

    nome: str | None = Field(default=None, min_length=1, max_length=160)
    empresa: str | None = Field(default=None, max_length=160)
    documento: str | None = Field(default=None, max_length=32)
    email: EmailStr | None = None
    telefone: str | None = Field(default=None, max_length=40)
    observacoes: str | None = Field(default=None, max_length=10000)

    @field_validator("nome", mode="before")
    @classmethod
    def _nome_nao_nulo(cls, valor):
        # o nome é obrigatório na ficha: null não "limpa", é erro (era 500)
        if valor is None:
            raise ValueError("nome: não pode ser vazio")
        return valor

    @field_validator("email")
    @classmethod
    def _email_cabe(cls, valor):
        if valor is not None and len(valor) > 160:
            raise ValueError("email: pode ter no máximo 160 caracteres")
        return valor

    @field_validator("telefone")
    @classmethod
    def _telefone_cabe(cls, valor):
        # o limite vale DEPOIS de tirar a formatação: é o que vai para o banco
        if valor is not None and len(re.sub(r"\D", "", valor)) > MAX_DIGITOS_TELEFONE:
            raise ValueError(f"telefone: pode ter no máximo {MAX_DIGITOS_TELEFONE} dígitos")
        return valor


class ContatoSaida(Modelo):
    id: int
    nome: str
    empresa: str | None = None
    documento: str | None = None
    email: str | None = None
    telefone: str | None = None
    observacoes: str | None = None
    identidades: list[IdentidadeSaida] = []


# ------------------------------------------------------------------- etiquetas
class EtiquetaEntrada(BaseModel):
    nome: str = Field(min_length=1, max_length=60)
    cor: str = Field(default="#6b7cff", max_length=9)


class EtiquetaSaida(Modelo):
    id: int
    nome: str
    cor: str


# ------------------------------------------------------------------- mensagens
class AnexoSaida(Modelo):
    id: int
    nome: str
    tipo_conteudo: str
    tamanho: int
    erro: str | None = None
    imagem: bool = False
    url: str | None = None


class AssinaturaSaida(BaseModel):
    """Quem respondeu, como o cliente viu: gravado na mensagem no envio."""

    nome: str
    setor: str | None = None


# Espaço em volta não conta: "   " não é mensagem (viraria uma linha vazia na
# caixa da equipe ou uma resposta em branco ao cliente). Mede depois de aparar.
TextoDeMensagem = Annotated[str, BeforeValidator(_aparar), Field(min_length=1, max_length=8000)]


class MensagemEntrada(BaseModel):
    conteudo: TextoDeMensagem


class MensagemSaida(Modelo):
    id: int
    conversa_id: int
    contato_id: int | None = None
    direcao: Direcao
    tipo: str
    conteudo: str
    status: str
    erro: str | None = None
    atendente_id: int | None = None
    autor: str | None = None
    assinatura: AssinaturaSaida | None = None
    anexos: list[AnexoSaida] = []
    criada_em: datetime
    # WhatsApp pelo QR Code: o dono respondeu direto pelo celular. Não saiu
    # pelo IHchat nem levou a assinatura de ninguém; o painel mostra um selo
    # próprio em vez de "como o cliente viu quem respondeu".
    pelo_celular: bool = False


# ------------------------------------------------------------------- conversas
class ConversaSaida(Modelo):
    id: int
    status: str
    prioridade: str
    assunto: str | None = None
    previa: str | None = None
    nao_lidas: int
    ultima_mensagem_em: datetime
    criada_em: datetime
    contato: ContatoSaida
    canal: CanalSaida
    atendente: AtendenteSaida | None = None
    etiquetas: list[EtiquetaSaida] = []


class ConversaDetalhe(ConversaSaida):
    mensagens: list[MensagemSaida] = []


class AtribuicaoEntrada(BaseModel):
    atendente_id: int | None = None


class StatusEntrada(BaseModel):
    status: StatusConversa


class PrioridadeEntrada(BaseModel):
    prioridade: Prioridade


class EtiquetaConversaEntrada(BaseModel):
    etiqueta_id: int


# ------------------------------------------------------------ respostas rapidas
def _atalho(valor):
    # a barra que o painel usa para chamar o atalho não faz parte dele
    return valor.strip().lstrip("/").strip() if isinstance(valor, str) else valor


class RespostaRapidaEntrada(BaseModel):
    atalho: Annotated[str, BeforeValidator(_atalho), Field(min_length=1, max_length=40)]
    titulo: str = Field(min_length=1, max_length=120)
    conteudo: str = Field(min_length=1, max_length=4000)


class RespostaRapidaSaida(Modelo):
    id: int
    atalho: str
    titulo: str
    conteudo: str


# --------------------------------------------------------------------- widget
class WidgetSessaoEntrada(BaseModel):
    chave_publica: str
    nome: str | None = Field(default=None, max_length=160)
    email: EmailStr | None = None


class WidgetSessaoSaida(BaseModel):
    token: str
    contato_id: int
    nome: str


class WidgetMensagemSaida(BaseModel):
    id: int
    direcao: Direcao
    conteudo: str
    criada_em: datetime
    autor: str | None = None
    # nome e setor de quem respondeu: o visitante precisa saber com quem fala
    assinatura: AssinaturaSaida | None = None
    anexos: list[AnexoSaida] = []


class EventoSaida(BaseModel):
    id: int
    tipo: str
    dados: Any = None


class EventosDesdeSaida(BaseModel):
    """GET /api/eventos/desde: o que houve depois do cursor, e o cursor novo."""

    eventos: list[EventoSaida] = []
    ultimo: int


# -------------------------------------------------------------------- metricas
class MetricasSaida(BaseModel):
    abertas: int
    pendentes: int
    resolvidas_hoje: int
    sem_atendente: int
    mensagens_hoje: int
    por_canal: dict[str, int]
    tempo_medio_primeira_resposta_seg: float | None = None

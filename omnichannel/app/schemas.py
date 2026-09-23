"""Contratos de entrada e saida da API (pydantic v2)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from pydantic_core import PydanticCustomError

from .models import Direcao, Papel, Prioridade, StatusConversa, TipoCanal


class Modelo(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ----------------------------------------------------------------- atendentes
class AtendenteEntrada(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    email: EmailStr
    senha: str = Field(min_length=6, max_length=128)
    papel: Papel = Papel.ATENDENTE


class AtendenteAtualizacao(BaseModel):
    nome: str | None = Field(default=None, min_length=2, max_length=120)
    senha: str | None = Field(default=None, min_length=6, max_length=128)
    papel: Papel | None = None
    ativo: bool | None = None
    disponivel: bool | None = None


class AtendenteSaida(Modelo):
    id: int
    nome: str
    email: str
    papel: str
    ativo: bool
    disponivel: bool


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


# -------------------------------------------------------------------- contatos
class IdentidadeSaida(Modelo):
    canal_tipo: str
    identificador: str
    nome_exibicao: str | None = None


class ContatoAtualizacao(BaseModel):
    nome: str | None = None
    empresa: str | None = None
    documento: str | None = None
    email: EmailStr | None = None
    telefone: str | None = None
    observacoes: str | None = None


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


class MensagemEntrada(BaseModel):
    conteudo: str = Field(min_length=1, max_length=8000)


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
    anexos: list[AnexoSaida] = []
    criada_em: datetime


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
class RespostaRapidaEntrada(BaseModel):
    atalho: str = Field(min_length=1, max_length=40)
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
    anexos: list[AnexoSaida] = []


# -------------------------------------------------------------------- metricas
class MetricasSaida(BaseModel):
    abertas: int
    pendentes: int
    resolvidas_hoje: int
    sem_atendente: int
    mensagens_hoje: int
    por_canal: dict[str, int]
    tempo_medio_primeira_resposta_seg: float | None = None

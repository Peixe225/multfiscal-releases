"""Contrato comum a todos os canais.

Cada provedor traduz seu formato proprio para `MensagemRecebida` e sabe enviar
uma resposta. O restante do sistema (conversas, painel, metricas) nunca conhece
detalhes de WhatsApp, Telegram ou e-mail.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Mapping

from ..config import obter_config
from ..models import Canal, StatusMensagem, TipoCanal


@dataclass(slots=True)
class AnexoRecebido:
    """Um arquivo anunciado pelo provedor.

    `referencia` e o id da midia no provedor; `dados` ja vem preenchido quando
    o proprio webhook trouxe o conteudo (e-mail, por exemplo). Um dos dois
    sempre existe.
    """

    nome: str
    referencia: str | None = None
    dados: bytes | None = None
    tipo_conteudo: str | None = None


@dataclass(slots=True)
class ArquivoParaEnviar:
    nome: str
    tipo_conteudo: str
    dados: bytes


@dataclass(slots=True)
class MensagemRecebida:
    identificador: str          # como o contato e identificado no canal
    conteudo: str
    nome_exibicao: str | None = None
    externo_id: str | None = None
    assunto: str | None = None
    metadados: dict = field(default_factory=dict)
    anexos: list[AnexoRecebido] = field(default_factory=list)


@dataclass(slots=True)
class AtualizacaoStatus:
    externo_id: str
    status: StatusMensagem


@dataclass(slots=True)
class ResultadoEnvio:
    status: StatusMensagem
    externo_id: str | None = None
    erro: str | None = None


class ErroCanal(Exception):
    """Falha ao falar com o provedor (rede, credencial, formato)."""


class AdaptadorCanal(ABC):
    tipo: TipoCanal
    campos_obrigatorios: tuple[str, ...] = ()

    def __init__(self, canal: Canal):
        self.canal = canal
        self.credenciais = canal.credenciais or {}

    # ------------------------------------------------------------------ estado
    @property
    def configurado(self) -> bool:
        return all(self.credenciais.get(campo) for campo in self.campos_obrigatorios)

    def _prefixar(self, externo_id: str | None) -> str | None:
        """Garante unicidade global do id externo entre provedores."""
        return f"{self.tipo.value}:{externo_id}" if externo_id else None

    # ---------------------------------------------------------------- entrada
    def verificar_assinatura(self, corpo: bytes, cabecalhos: Mapping[str, str]) -> bool:
        """Sem segredo cadastrado, nao ha o que verificar."""
        return True

    def desafio_verificacao(self, parametros: Mapping[str, str]) -> str | None:
        """Resposta ao handshake GET que alguns provedores exigem."""
        return None

    @abstractmethod
    def analisar_webhook(self, payload: dict) -> list[MensagemRecebida]:
        ...

    def analisar_status(self, payload: dict) -> list[AtualizacaoStatus]:
        """Recibos de entrega/leitura, quando o canal os envia."""
        return []

    def coletar(self) -> list[MensagemRecebida]:
        """Canais sem webhook (e-mail via IMAP) buscam mensagens aqui."""
        return []

    def baixar_anexo(self, anexo: AnexoRecebido) -> bytes:
        """Busca no provedor os bytes de um arquivo anunciado no webhook."""
        if anexo.dados is not None:
            return anexo.dados
        raise ErroCanal(f"o canal {self.tipo.value} nao sabe baixar anexos")

    @property
    def envia_arquivos(self) -> bool:
        """Se falso, um anexo na resposta e recusado antes de gravar nada."""
        return False

    def verificar_conexao(self) -> str:
        """Confere, no provedor, se as credenciais funcionam.

        Devolve uma frase curta para o painel ("Conectado como @bot_suporte")
        ou levanta ErroCanal dizendo o que está errado. E o que da ao admin a
        resposta imediata "meu token funcionou?" ao ligar um canal.
        """
        faltando = [c for c in self.campos_obrigatorios if not self.credenciais.get(c)]
        if faltando:
            raise ErroCanal(f"preencha: {', '.join(faltando)}")
        raise ErroCanal(f"o canal {self.tipo.value} nao tem verificacao automatica")

    # ----------------------------------------------------------------- saida
    @abstractmethod
    def _enviar(self, destino: str, conteudo: str, contexto: dict) -> ResultadoEnvio:
        ...

    def enviar(self, destino: str, conteudo: str, contexto: dict | None = None) -> ResultadoEnvio:
        """Envia de fato, ou apenas registra quando o canal nao tem credenciais.

        O modo sandbox e o que permite rodar o produto inteiro (painel, fluxo,
        metricas) sem contratar nenhum provedor.
        """
        if not self.configurado:
            if obter_config().modo_sandbox:
                return ResultadoEnvio(status=StatusMensagem.SIMULADA)
            return ResultadoEnvio(
                status=StatusMensagem.FALHOU,
                erro=f"canal {self.canal.nome} sem credenciais configuradas",
            )
        try:
            return self._enviar(destino, conteudo, contexto or {})
        except ErroCanal as exc:
            return ResultadoEnvio(status=StatusMensagem.FALHOU, erro=str(exc))

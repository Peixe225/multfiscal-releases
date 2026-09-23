"""Configuracao da aplicacao, lida de variaveis de ambiente ou de um arquivo .env."""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Configuracao(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="OMNI_", extra="ignore")

    nome_aplicacao: str = "OmniChannel 2"
    versao: str = "2.0.0"

    # sqlite por padrao; aceita postgresql+psycopg://... sem mudanca de codigo
    banco_url: str = "sqlite:///./omnichannel.db"

    # chave usada para assinar os tokens de sessao dos atendentes
    chave_secreta: str = "troque-esta-chave-em-producao"
    horas_token: int = 12

    # janela em que uma nova mensagem do contato reaproveita a conversa ja
    # resolvida em vez de abrir outra (evita fragmentar o historico)
    horas_reabertura: int = 24

    # distribui automaticamente conversas novas entre os atendentes disponiveis
    distribuicao_automatica: bool = True

    # quando um canal nao tem credenciais, o envio e apenas registrado
    # (status "simulada") em vez de falhar - util em desenvolvimento e testes
    modo_sandbox: bool = True

    timeout_http: float = 15.0

    # anexos
    pasta_anexos: str = "./anexos"
    tamanho_max_anexo_mb: int = 20

    # coleta dos canais que buscam as mensagens em vez de recebe-las por webhook
    coletor_ativo: bool = True
    # IMAP e lento e caro (login e busca a cada ciclo): uma vez por minuto basta
    intervalo_coleta: int = 60
    # chat (Telegram em modo polling) e conversa: o contato espera ver a
    # mensagem chegar em segundos, e um getUpdates vazio custa quase nada
    intervalo_polling: int = 3

    # origens liberadas para o widget de webchat embutido em outros sites
    origens_permitidas: list[str] = ["*"]


@lru_cache
def obter_config() -> Configuracao:
    return Configuracao()

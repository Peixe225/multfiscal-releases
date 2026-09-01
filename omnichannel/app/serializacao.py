"""Conversao de modelos para os schemas de saida.

Fica isolado aqui porque tanto a API quanto os eventos SSE precisam do mesmo
formato - se divergirem, o painel mostra uma coisa e recebe outra.
"""
from __future__ import annotations

from .canais.registro import adaptador_para
from .models import Canal, Conversa, Mensagem, TipoMensagem
from .schemas import CanalSaida, ConversaDetalhe, ConversaSaida, MensagemSaida


def canal_saida(canal: Canal) -> CanalSaida:
    dados = CanalSaida.model_validate(canal)
    dados.configurado = adaptador_para(canal).configurado
    dados.url_webhook = f"/webhooks/{canal.id}"
    return dados


def autor_de(mensagem: Mensagem) -> str:
    if mensagem.tipo == TipoMensagem.SISTEMA.value:
        return "Sistema"
    if mensagem.atendente is not None:
        return mensagem.atendente.nome
    return mensagem.conversa.contato.nome if mensagem.conversa else "Contato"


def mensagem_saida(mensagem: Mensagem) -> MensagemSaida:
    dados = MensagemSaida.model_validate(mensagem)
    dados.autor = autor_de(mensagem)
    # o widget filtra o fluxo de eventos por contato, nao por conversa
    dados.contato_id = mensagem.conversa.contato_id if mensagem.conversa else None
    return dados


def conversa_saida(conversa: Conversa) -> ConversaSaida:
    dados = ConversaSaida.model_validate(conversa)
    dados.canal = canal_saida(conversa.canal)
    return dados


def conversa_detalhe(conversa: Conversa) -> ConversaDetalhe:
    dados = ConversaDetalhe.model_validate(conversa)
    dados.canal = canal_saida(conversa.canal)
    dados.mensagens = [mensagem_saida(m) for m in conversa.mensagens]
    return dados


def json_de(modelo) -> dict:
    return modelo.model_dump(mode="json")

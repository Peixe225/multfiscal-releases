"""Conversao de modelos para os schemas de saida.

Fica isolado aqui porque tanto a API quanto os eventos SSE precisam do mesmo
formato - se divergirem, o painel mostra uma coisa e recebe outra.
"""
from __future__ import annotations

from .armazenamento import TIPOS_IMAGEM
from .canais.registro import adaptador_para
from .models import Anexo, Canal, Conversa, Direcao, Mensagem, TipoMensagem
from .schemas import AnexoSaida, AssinaturaSaida, CanalSaida, ConversaDetalhe, ConversaSaida, MensagemSaida


def canal_saida(canal: Canal) -> CanalSaida:
    dados = CanalSaida.model_validate(canal)
    dados.configurado = adaptador_para(canal).configurado
    dados.url_webhook = f"/webhooks/{canal.id}"
    return dados


def anexo_saida(anexo: Anexo, base: str = "/api/anexos") -> AnexoSaida:
    dados = AnexoSaida.model_validate(anexo)
    dados.imagem = anexo.tipo_conteudo in TIPOS_IMAGEM
    # sem chave o arquivo não chegou a ser guardado: link nenhum a oferecer
    dados.url = f"{base}/{anexo.id}" if anexo.chave else None
    return dados


def assinatura_de(mensagem: Mensagem) -> dict | None:
    """{nome, setor} gravado no envio, ou None (entrada, sistema, base antiga)."""
    valor = mensagem.assinatura
    if not isinstance(valor, dict) or not valor.get("nome"):
        return None
    return {"nome": str(valor["nome"]), "setor": valor.get("setor") or None}


def autor_de(mensagem: Mensagem) -> str:
    if mensagem.tipo == TipoMensagem.SISTEMA.value:
        return "Sistema"
    if mensagem.atendente is not None:
        return mensagem.atendente.nome
    # atendente apagado: a resposta continua com o nome que o cliente viu,
    # em vez de virar o nome do próprio cliente
    assinatura = assinatura_de(mensagem)
    if mensagem.direcao == Direcao.SAIDA.value and assinatura:
        return assinatura["nome"]
    return mensagem.conversa.contato.nome if mensagem.conversa else "Contato"


def mensagem_saida(mensagem: Mensagem) -> MensagemSaida:
    dados = MensagemSaida.model_validate(mensagem)
    dados.autor = autor_de(mensagem)
    assinatura = assinatura_de(mensagem)
    dados.assinatura = AssinaturaSaida(**assinatura) if assinatura else None
    # o widget filtra o fluxo de eventos por contato, nao por conversa
    dados.contato_id = mensagem.conversa.contato_id if mensagem.conversa else None
    dados.anexos = [anexo_saida(a) for a in mensagem.anexos]
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

"""Conversao de modelos para os schemas de saida.

Fica isolado aqui porque tanto a API quanto os eventos SSE precisam do mesmo
formato - se divergirem, o painel mostra uma coisa e recebe outra.
"""
from __future__ import annotations

from .armazenamento import TIPOS_IMAGEM
from .canais import whatsapp_qr
from .canais.registro import adaptador_para
from .config import url_publica
from .models import Anexo, Canal, Conversa, Direcao, Mensagem, TipoCanal, TipoMensagem
from .schemas import AnexoSaida, AssinaturaSaida, CanalSaida, ConversaDetalhe, ConversaSaida, MensagemSaida


def url_webhook(canal_id: int) -> str:
    """"/webhooks/5", ou "https://atendimento.../webhooks/5" com url_publica:
    é o que o admin cola na Meta ou vê no setWebhook."""
    return f"{url_publica()}/webhooks/{canal_id}"


def canal_saida(canal: Canal) -> CanalSaida:
    dados = CanalSaida.model_validate(canal)
    dados.configurado = adaptador_para(canal).configurado
    dados.url_webhook = url_webhook(canal.id)
    dados.conexao = conexao_do_canal(canal)
    return dados


def conexao_do_canal(canal: Canal) -> str | None:
    """O estado da conexão gravado pelo servidor (só no WhatsApp pelo QR Code)."""
    if canal.tipo != TipoCanal.WHATSAPP_QR.value:
        return None
    estado = (canal.credenciais or {}).get(whatsapp_qr.CHAVE_ESTADO)
    return estado if estado in (whatsapp_qr.CONECTADO, whatsapp_qr.AGUARDANDO, whatsapp_qr.DESCONECTADO) else None


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
    metadados = mensagem.metadados if isinstance(mensagem.metadados, dict) else {}
    dados.pelo_celular = metadados.get("enviada_pelo_celular") is True
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

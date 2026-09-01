"""Entrada e saida de mensagens - o coracao do atendimento."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..canais.base import ArquivoParaEnviar, AtualizacaoStatus, MensagemRecebida
from ..canais.registro import adaptador_para
from ..eventos import barramento
from ..models import (
    Atendente,
    Canal,
    Conversa,
    Direcao,
    Mensagem,
    StatusConversa,
    StatusMensagem,
    TipoMensagem,
    agora,
)
from ..serializacao import conversa_saida, json_de, mensagem_saida
from ..util import resumir
from . import anexos as svc_anexos
from .contatos import identificador_no_canal, resolver_contato
from .conversas import obter_ou_criar_conversa, registrar_evento


def _tocar_conversa(conversa: Conversa, mensagem: Mensagem) -> None:
    conversa.ultima_mensagem_em = mensagem.criada_em or agora()
    conversa.previa = resumir(mensagem.conteudo, 180)


def _previa_de_arquivo(conversa: Conversa, mensagem: Mensagem, anexos) -> None:
    """Mensagem só com arquivo precisa de uma prévia; senão a lista fica vazia."""
    if not mensagem.conteudo.strip() and anexos:
        conversa.previa = f"📎 {anexos[0].nome}"


def ja_processada(sessao: Session, externo_id: str | None) -> Mensagem | None:
    """Webhooks sao reentregues; o id externo evita mensagem duplicada."""
    if not externo_id:
        return None
    return sessao.scalar(select(Mensagem).where(Mensagem.externo_id == externo_id))


def registrar_entrada(sessao: Session, canal: Canal, recebida: MensagemRecebida) -> Mensagem | None:
    """Grava uma mensagem que chegou do contato. Devolve None se for repetida."""
    if ja_processada(sessao, recebida.externo_id) is not None:
        return None

    contato = resolver_contato(sessao, canal.tipo, recebida.identificador, recebida.nome_exibicao)
    conversa, _nova = obter_ou_criar_conversa(sessao, contato, canal, recebida.assunto)
    if recebida.assunto and not conversa.assunto:
        conversa.assunto = recebida.assunto

    mensagem = Mensagem(
        conversa_id=conversa.id,
        direcao=Direcao.ENTRADA.value,
        tipo=TipoMensagem.TEXTO.value,
        conteudo=recebida.conteudo,
        status=StatusMensagem.RECEBIDA.value,
        externo_id=recebida.externo_id,
        metadados=recebida.metadados or {},
        criada_em=agora(),
    )
    sessao.add(mensagem)
    conversa.nao_lidas += 1
    _tocar_conversa(conversa, mensagem)
    sessao.flush()

    if recebida.anexos:
        guardados = svc_anexos.guardar_recebidos(sessao, adaptador_para(canal), mensagem, recebida.anexos)
        _previa_de_arquivo(conversa, mensagem, guardados)
    sessao.refresh(mensagem)
    return mensagem


class CanalSemArquivos(Exception):
    """O canal da conversa não transporta arquivos."""


def enviar_mensagem(
    sessao: Session,
    conversa: Conversa,
    conteudo: str,
    atendente: Atendente | None = None,
    arquivos: list[ArquivoParaEnviar] | None = None,
) -> Mensagem:
    """Responde ao contato pelo mesmo canal em que ele falou."""
    adaptador = adaptador_para(conversa.canal)
    destino = identificador_no_canal(sessao, conversa.contato, conversa.canal.tipo)
    arquivos = arquivos or []
    if arquivos and not adaptador.envia_arquivos:
        raise CanalSemArquivos(f"o canal {conversa.canal.tipo} não envia arquivos")

    if destino is None:
        resultado_status = StatusMensagem.FALHOU
        externo_id, erro = None, f"contato sem identificacao no canal {conversa.canal.tipo}"
    else:
        contexto = contexto_de_envio(sessao, conversa)
        contexto["arquivos"] = arquivos
        resultado = adaptador.enviar(destino, conteudo, contexto)
        resultado_status, externo_id, erro = resultado.status, resultado.externo_id, resultado.erro

    mensagem = Mensagem(
        conversa_id=conversa.id,
        direcao=Direcao.SAIDA.value,
        tipo=TipoMensagem.TEXTO.value,
        conteudo=conteudo,
        status=resultado_status.value,
        atendente_id=atendente.id if atendente else None,
        externo_id=externo_id,
        erro=erro,
        criada_em=agora(),
    )
    sessao.add(mensagem)
    _tocar_conversa(conversa, mensagem)
    if conversa.primeira_resposta_em is None and resultado_status is not StatusMensagem.FALHOU:
        conversa.primeira_resposta_em = mensagem.criada_em
    if conversa.status == StatusConversa.RESOLVIDA.value:
        conversa.status = StatusConversa.ABERTA.value
        conversa.resolvida_em = None
    sessao.flush()

    # guardado mesmo quando o envio falha: o atendente reenvia sem subir de novo
    guardados = [
        svc_anexos.guardar(sessao, mensagem, a.nome, a.dados, a.tipo_conteudo) for a in arquivos
    ]
    _previa_de_arquivo(conversa, mensagem, guardados)
    sessao.refresh(mensagem)
    return mensagem


def contexto_de_envio(sessao: Session, conversa: Conversa) -> dict:
    """Dados extras que alguns canais precisam (assunto e thread do e-mail)."""
    ultima_entrada = sessao.scalar(
        select(Mensagem)
        .where(Mensagem.conversa_id == conversa.id, Mensagem.direcao == Direcao.ENTRADA.value)
        .order_by(Mensagem.criada_em.desc())
        .limit(1)
    )
    referencia = (ultima_entrada.metadados or {}).get("referencias") if ultima_entrada else None
    return {"assunto": conversa.assunto, "referencia": referencia}


def registrar_nota(sessao: Session, conversa: Conversa, conteudo: str, atendente: Atendente) -> Mensagem:
    """Nota interna: fica no historico da equipe e nunca vai para o contato."""
    mensagem = Mensagem(
        conversa_id=conversa.id,
        direcao=Direcao.SAIDA.value,
        tipo=TipoMensagem.NOTA_INTERNA.value,
        conteudo=conteudo,
        status=StatusMensagem.ENVIADA.value,
        atendente_id=atendente.id,
        criada_em=agora(),
    )
    sessao.add(mensagem)
    sessao.flush()
    sessao.refresh(mensagem)
    return mensagem


def aplicar_status_externo(sessao: Session, atualizacoes: list[AtualizacaoStatus]) -> list[Mensagem]:
    """Recibos de entrega/leitura vindos do provedor."""
    alteradas: list[Mensagem] = []
    for atualizacao in atualizacoes:
        mensagem = sessao.scalar(select(Mensagem).where(Mensagem.externo_id == atualizacao.externo_id))
        if mensagem is None:
            continue
        mensagem.status = atualizacao.status.value
        alteradas.append(mensagem)
    sessao.flush()
    return alteradas


# ------------------------------------------------------------------- eventos
# As rotas publicam *depois* do commit, para que o painel nunca receba um
# evento cujo dado ainda nao esta no banco.
def publicar_mensagem(mensagem: Mensagem, tipo: str = "mensagem.nova") -> None:
    barramento.publicar(tipo, json_de(mensagem_saida(mensagem)))


def publicar_conversa(conversa: Conversa, tipo: str = "conversa.atualizada") -> None:
    barramento.publicar(tipo, json_de(conversa_saida(conversa)))

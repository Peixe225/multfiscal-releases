"""Entrada e saida de mensagens - o coracao do atendimento."""
from __future__ import annotations

import json
import logging
import random
import re
from datetime import timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..canais.base import ArquivoParaEnviar, AtualizacaoStatus, MensagemRecebida
from ..canais.registro import adaptador_para
from ..db import SessaoLocal
from ..eventos import barramento
from ..models import (
    Atendente,
    Canal,
    ContatoIdentidade,
    Conversa,
    Direcao,
    FilaEvento,
    Mensagem,
    StatusConversa,
    StatusMensagem,
    TipoCanal,
    TipoMensagem,
    agora,
)
from ..serializacao import canal_saida, conversa_saida, json_de, mensagem_saida
from ..util import resumir
from . import anexos as svc_anexos
from .contatos import identificador_no_canal, normalizar_identificador, resolver_contato
from .conversas import obter_ou_criar_conversa, registrar_evento

log = logging.getLogger(__name__)


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


CHAVE_IDENTIDADE = "identidade"  # metadados da entrada: quem escreveu (igual ao PHP)


def destino_da_conversa(sessao: Session, conversa: Conversa) -> str | None:
    """Para onde responder: a identidade que escreveu por último nesta
    conversa, se ela ainda é do contato; senão (conversa antiga, sem o
    registro) uma identidade do contato no canal."""
    ultima = sessao.scalar(
        select(Mensagem)
        .where(Mensagem.conversa_id == conversa.id, Mensagem.direcao == Direcao.ENTRADA.value)
        .order_by(Mensagem.criada_em.desc(), Mensagem.id.desc())
        .limit(1)
    )
    identidade = (ultima.metadados or {}).get(CHAVE_IDENTIDADE) if ultima is not None else None
    if isinstance(identidade, str) and identidade:
        do_contato = sessao.scalar(
            select(ContatoIdentidade.identificador).where(
                ContatoIdentidade.contato_id == conversa.contato_id,
                ContatoIdentidade.canal_tipo == conversa.canal.tipo,
                ContatoIdentidade.identificador == identidade,
            )
        )
        if do_contato is not None:
            return do_contato
    return identificador_no_canal(sessao, conversa.contato, conversa.canal.tipo)


def registrar_entrada(sessao: Session, canal: Canal, recebida: MensagemRecebida) -> Mensagem | None:
    """Grava uma mensagem que chegou do contato. Devolve None se for repetida."""
    if ja_processada(sessao, recebida.externo_id) is not None:
        return None

    contato = resolver_contato(sessao, canal.tipo, recebida.identificador, recebida.nome_exibicao)
    conversa, _nova = obter_ou_criar_conversa(sessao, contato, canal, recebida.assunto)
    if recebida.assunto and not conversa.assunto:
        conversa.assunto = recebida.assunto

    metadados = dict(recebida.metadados or {})
    # quem escreveu NESTA conversa: é para essa identidade que a resposta
    # volta (destino_da_conversa), mesmo com dois números no contato
    metadados[CHAVE_IDENTIDADE] = normalizar_identificador(canal.tipo, recebida.identificador)[:200]
    mensagem = Mensagem(
        conversa_id=conversa.id,
        direcao=Direcao.ENTRADA.value,
        tipo=TipoMensagem.TEXTO.value,
        conteudo=recebida.conteudo,
        status=StatusMensagem.RECEBIDA.value,
        externo_id=recebida.externo_id,
        metadados=metadados,
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


# ------------------------------------------------------------- assinatura
# Quem responde aparece para o cliente. A mensagem grava {nome, setor} do
# atendente NO ENVIO; o texto que vai ao provedor leva a assinatura no jeito
# de cada canal, e o `conteudo` gravado fica sem ela (o painel não mostra o
# nome duas vezes). Mesmo formato do PHP (Atendimento/Assinaturas.php):
#   WhatsApp  primeira linha "*Ana · Suporte técnico*" (negrito do WhatsApp)
#   Telegram  primeira linha "Ana · Suporte técnico" (texto puro)
#   e-mail    no fim, depois do separador de assinatura "-- "
#   webchat   texto intacto: o widget mostra nome e setor em campos próprios
SEPARADOR_ASSINATURA = " · "


def assinatura_do_atendente(atendente: Atendente | None) -> dict | None:
    if atendente is None:
        return None
    return {"nome": atendente.nome, "setor": (atendente.setor or "").strip() or None}


def _uma_linha(texto: str | None) -> str:
    # quebra de linha no nome ou no setor desmontaria o formato (e, no
    # e-mail, pareceria parte da mensagem)
    return re.sub(r"\s+", " ", texto or "").strip()


def linha_da_assinatura(assinatura: dict) -> str:
    nome, setor = _uma_linha(assinatura.get("nome")), _uma_linha(assinatura.get("setor"))
    return f"{nome}{SEPARADOR_ASSINATURA}{setor}" if setor else nome


def aplicar_assinatura(tipo_canal: str, conteudo: str, assinatura: dict | None) -> str:
    """O texto como o cliente vai recebê-lo no canal."""
    if not assinatura or not _uma_linha(assinatura.get("nome")):
        return conteudo
    linha = linha_da_assinatura(assinatura)
    # o WhatsApp pelo QR Code mostra o texto igual ao da API oficial: negrito
    # com *...* na primeira linha (o adaptador recebe o texto já assinado)
    if tipo_canal in (TipoCanal.WHATSAPP.value, TipoCanal.WHATSAPP_QR.value):
        cabecalho = f"*{linha}*"
    elif tipo_canal == TipoCanal.TELEGRAM.value:
        cabecalho = linha
    elif tipo_canal == TipoCanal.EMAIL.value:
        setor = _uma_linha(assinatura.get("setor"))
        bloco = "-- \n" + _uma_linha(assinatura.get("nome")) + (f"\n{setor}" if setor else "")
        return f"{conteudo.rstrip()}\n\n{bloco}" if conteudo else bloco
    else:
        return conteudo
    return f"{cabecalho}\n{conteudo}" if conteudo else cabecalho


def tem_entrada_simulada(sessao: Session, conversa: Conversa) -> bool:
    """A ÚLTIMA mensagem do cliente nesta conversa foi escrita pelo simulador?

    O simulador inventa o número ou o endereço do cliente: responder a ele por
    um provedor real poderia chegar a um estranho. Mas vale só enquanto a
    última entrada for simulada: quando o canal vai ao ar e o cliente de
    verdade escreve na mesma conversa, a resposta precisa sair (mesma regra
    de Mensagens::temEntradaSimulada no PHP). A chave é conferida no
    dicionário, não com LIKE no texto: um username "simulada_por" vindo do
    Telegram não pode travar a conversa.
    """
    ultima = sessao.scalar(
        select(Mensagem.metadados)
        .where(Mensagem.conversa_id == conversa.id, Mensagem.direcao == Direcao.ENTRADA.value)
        .order_by(Mensagem.criada_em.desc(), Mensagem.id.desc())
        .limit(1)
    )
    return isinstance(ultima, dict) and "simulada_por" in ultima


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
    destino = destino_da_conversa(sessao, conversa)
    arquivos = arquivos or []
    if arquivos and not adaptador.envia_arquivos:
        raise CanalSemArquivos(f"o canal {conversa.canal.tipo} não envia arquivos")

    assinatura = assinatura_do_atendente(atendente)
    if destino is None:
        resultado_status = StatusMensagem.FALHOU
        externo_id, erro = None, f"contato sem identificacao no canal {conversa.canal.tipo}"
    elif conversa.canal.tipo != TipoCanal.WEBCHAT.value and tem_entrada_simulada(sessao, conversa):
        resultado_status, externo_id, erro = StatusMensagem.SIMULADA, None, None
    else:
        contexto = contexto_de_envio(sessao, conversa)
        contexto["arquivos"] = arquivos
        contexto["assinatura"] = assinatura
        texto = aplicar_assinatura(conversa.canal.tipo, conteudo, assinatura)
        resultado = adaptador.enviar(destino, texto, contexto)
        resultado_status, externo_id, erro = resultado.status, resultado.externo_id, resultado.erro
        if externo_id and ja_processada(sessao, externo_id) is not None:
            # id repetido do provedor (o Telegram numera por conversa, um bot de
            # testes repete ids) não pode derrubar com 500 a resposta que o
            # cliente já recebeu; só os recibos deixam de casar com ela
            externo_id = None

    mensagem = Mensagem(
        conversa_id=conversa.id,
        direcao=Direcao.SAIDA.value,
        tipo=TipoMensagem.TEXTO.value,
        conteudo=conteudo,
        status=resultado_status.value,
        atendente_id=atendente.id if atendente else None,
        externo_id=externo_id,
        erro=erro,
        assinatura=assinatura,
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
# evento cujo dado ainda nao esta no banco. Cada evento vai para a tabela
# fila_eventos (quem consulta por /api/eventos/desde, e quem reconecta o SSE
# com Last-Event-ID, nao perde nada) e depois acorda os fluxos SSE.
HORAS_RETENCAO = 48
CHANCE_PODA = 50  # uma poda a cada N publicacoes, em media


def publicar_evento(tipo: str, dados: dict, contato_id: int | None) -> int | None:
    """Grava o evento na fila e avisa o barramento. Devolve o id gravado."""
    evento_id = None
    try:
        with SessaoLocal() as sessao:
            evento = FilaEvento(
                tipo=tipo,
                dados=json.dumps(dados, ensure_ascii=False, default=str),
                contato_id=contato_id,
                criado_em=agora(),
            )
            sessao.add(evento)
            if random.randint(1, CHANCE_PODA) == 1:
                limite = agora() - timedelta(hours=HORAS_RETENCAO)
                sessao.execute(delete(FilaEvento).where(FilaEvento.criado_em < limite))
            sessao.commit()
            evento_id = evento.id
    except Exception:  # pragma: no cover - o dado ja foi gravado; o SSE ainda entrega
        log.exception("nao foi possivel gravar o evento %s na fila", tipo)
    barramento.publicar(tipo, dados)
    return evento_id


def publicar_mensagem(mensagem: Mensagem, tipo: str = "mensagem.nova") -> None:
    dados = json_de(mensagem_saida(mensagem))
    publicar_evento(tipo, dados, dados.get("contato_id"))


def publicar_conversa(conversa: Conversa, tipo: str = "conversa.atualizada") -> None:
    publicar_evento(tipo, json_de(conversa_saida(conversa)), conversa.contato_id)


def publicar_canal(canal) -> None:
    """'canal.atualizado' com o CanalSaida (sem credenciais): hoje, quando o
    WhatsApp pelo QR Code conecta ou cai, para a equipe inteira ver na hora.
    Sem contato: vai a todo atendente logado, como a lista de /api/canais."""
    publicar_evento("canal.atualizado", json_de(canal_saida(canal)), None)

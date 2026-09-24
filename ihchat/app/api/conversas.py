"""Caixa de entrada unificada: listagem, leitura e resposta."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import exists, or_, select
from sqlalchemy.orm import selectinload

from ..dependencias import AtendenteAtual, ConversaAtual, Sessao
from ..models import (
    Atendente,
    Contato,
    Conversa,
    Etiqueta,
    Mensagem,
    StatusConversa,
    conversa_etiqueta,
)
from ..schemas import (
    AtribuicaoEntrada,
    ConversaDetalhe,
    ConversaSaida,
    EtiquetaConversaEntrada,
    MensagemEntrada,
    MensagemSaida,
    PrioridadeEntrada,
    StatusEntrada,
)
from ..serializacao import conversa_detalhe, conversa_saida, mensagem_saida
from ..servicos import conversas as svc
from ..servicos.mensagens import (
    enviar_mensagem,
    publicar_conversa,
    publicar_mensagem,
    registrar_nota,
)

rotas = APIRouter(prefix="/api/conversas", tags=["conversas"])


@rotas.get("", response_model=list[ConversaSaida])
def listar(
    sessao: Sessao,
    atual: AtendenteAtual,
    status_: StatusConversa | None = Query(default=None, alias="status"),
    atendente: str | None = Query(default=None, description="id do atendente, 'eu' ou 'sem'"),
    canal_id: int | None = None,
    etiqueta_id: int | None = None,
    q: str | None = Query(default=None, description="busca no contato e no conteudo das mensagens"),
    limite: int = Query(default=50, le=200),
    deslocamento: int = Query(default=0, ge=0),
) -> list[ConversaSaida]:
    consulta = (
        select(Conversa)
        .options(selectinload(Conversa.etiquetas))
        .order_by(Conversa.ultima_mensagem_em.desc())
        .limit(limite)
        .offset(deslocamento)
    )
    if status_ is not None:
        consulta = consulta.where(Conversa.status == status_.value)
    if atendente == "eu":
        consulta = consulta.where(Conversa.atendente_id == atual.id)
    elif atendente == "sem":
        consulta = consulta.where(Conversa.atendente_id.is_(None))
    elif atendente:
        if not atendente.isdigit():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "filtro de atendente invalido")
        consulta = consulta.where(Conversa.atendente_id == int(atendente))
    if canal_id is not None:
        consulta = consulta.where(Conversa.canal_id == canal_id)
    if etiqueta_id is not None:
        consulta = consulta.where(
            exists().where(
                (conversa_etiqueta.c.conversa_id == Conversa.id)
                & (conversa_etiqueta.c.etiqueta_id == etiqueta_id)
            )
        )
    if q:
        alvo = f"%{q.strip()}%"
        consulta = consulta.join(Contato).where(
            or_(
                Contato.nome.ilike(alvo),
                Contato.email.ilike(alvo),
                Contato.telefone.ilike(alvo),
                Conversa.assunto.ilike(alvo),
                exists().where((Mensagem.conversa_id == Conversa.id) & Mensagem.conteudo.ilike(alvo)),
            )
        )
    return [conversa_saida(c) for c in sessao.scalars(consulta)]


@rotas.get("/{conversa_id}", response_model=ConversaDetalhe)
def obter(conversa: ConversaAtual, sessao: Sessao, _: AtendenteAtual) -> ConversaDetalhe:
    svc.marcar_lida(sessao, conversa)
    return conversa_detalhe(conversa)


@rotas.post("/{conversa_id}/mensagens", response_model=MensagemSaida, status_code=status.HTTP_201_CREATED)
def responder(
    conversa: ConversaAtual, dados: MensagemEntrada, sessao: Sessao, atual: AtendenteAtual
) -> MensagemSaida:
    mensagem = enviar_mensagem(sessao, conversa, dados.conteudo.strip(), atual)
    svc.marcar_lida(sessao, conversa)
    sessao.commit()
    publicar_mensagem(mensagem)
    publicar_conversa(conversa)
    return mensagem_saida(mensagem)


@rotas.post("/{conversa_id}/notas", response_model=MensagemSaida, status_code=status.HTTP_201_CREATED)
def anotar(
    conversa: ConversaAtual, dados: MensagemEntrada, sessao: Sessao, atual: AtendenteAtual
) -> MensagemSaida:
    mensagem = registrar_nota(sessao, conversa, dados.conteudo.strip(), atual)
    sessao.commit()
    publicar_mensagem(mensagem)
    return mensagem_saida(mensagem)


@rotas.post("/{conversa_id}/atribuir", response_model=ConversaSaida)
def atribuir(
    conversa: ConversaAtual, dados: AtribuicaoEntrada, sessao: Sessao, atual: AtendenteAtual
) -> ConversaSaida:
    destino = None
    if dados.atendente_id is not None:
        destino = sessao.get(Atendente, dados.atendente_id)
        if destino is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "atendente nao encontrado")
    svc.atribuir(sessao, conversa, destino, atual)
    sessao.commit()
    publicar_conversa(conversa)
    return conversa_saida(conversa)


@rotas.post("/{conversa_id}/status", response_model=ConversaSaida)
def mudar_status(
    conversa: ConversaAtual, dados: StatusEntrada, sessao: Sessao, atual: AtendenteAtual
) -> ConversaSaida:
    svc.mudar_status(sessao, conversa, dados.status, atual)
    sessao.commit()
    publicar_conversa(conversa)
    return conversa_saida(conversa)


@rotas.post("/{conversa_id}/prioridade", response_model=ConversaSaida)
def mudar_prioridade(
    conversa: ConversaAtual, dados: PrioridadeEntrada, sessao: Sessao, _: AtendenteAtual
) -> ConversaSaida:
    conversa.prioridade = dados.prioridade.value
    sessao.commit()
    publicar_conversa(conversa)
    return conversa_saida(conversa)


@rotas.post("/{conversa_id}/etiquetas", response_model=ConversaSaida)
def marcar_etiqueta(
    conversa: ConversaAtual, dados: EtiquetaConversaEntrada, sessao: Sessao, _: AtendenteAtual
) -> ConversaSaida:
    etiqueta = sessao.get(Etiqueta, dados.etiqueta_id)
    if etiqueta is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "etiqueta nao encontrada")
    if etiqueta not in conversa.etiquetas:
        conversa.etiquetas.append(etiqueta)
    sessao.commit()
    publicar_conversa(conversa)
    return conversa_saida(conversa)


@rotas.delete("/{conversa_id}/etiquetas/{etiqueta_id}", response_model=ConversaSaida)
def desmarcar_etiqueta(
    conversa: ConversaAtual, etiqueta_id: int, sessao: Sessao, _: AtendenteAtual
) -> ConversaSaida:
    conversa.etiquetas = [e for e in conversa.etiquetas if e.id != etiqueta_id]
    sessao.commit()
    publicar_conversa(conversa)
    return conversa_saida(conversa)


@rotas.post("/{conversa_id}/ler", response_model=ConversaSaida)
def ler(conversa: ConversaAtual, sessao: Sessao, _: AtendenteAtual) -> ConversaSaida:
    svc.marcar_lida(sessao, conversa)
    sessao.commit()
    publicar_conversa(conversa)
    return conversa_saida(conversa)

"""Cadastro de atendentes.

O `setor` aparece para o cliente junto com o nome de quem responde ("Ana ·
Suporte técnico"), então cada atendente pode ajustar o seu no painel.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from ..dependencias import AdminAtual, AtendenteAtual, Sessao
from ..models import Atendente
from ..schemas import AtendenteAtualizacao, AtendenteEntrada, AtendenteSaida
from ..security import gerar_hash_senha
from ..servicos import chat_interno

rotas = APIRouter(prefix="/api/atendentes", tags=["atendentes"])
log = logging.getLogger("ihchat.atendentes")


def _sincronizar_chat(sessao) -> None:
    """Geral e salas de setor acompanham o cadastro NA HORA: quem entra, muda
    de setor ou é desativado ganha ou perde a sala já (com o evento
    "interno.sala" entrou/saiu), sem esperar a próxima chamada a /api/interno.
    Uma falha aqui não desfaz o cadastro já confirmado: a próxima chamada ao
    chat acerta de novo (a sincronização é idempotente). Igual ao PHP."""
    try:
        chat_interno.sincronizar(sessao)
    except Exception:  # pragma: no cover - o cadastro já foi gravado
        sessao.rollback()
        log.exception("não foi possível sincronizar as salas do chat interno")


@rotas.get("", response_model=list[AtendenteSaida])
def listar(sessao: Sessao, _: AtendenteAtual) -> list[Atendente]:
    return list(sessao.scalars(select(Atendente).order_by(Atendente.nome)))


@rotas.post("", response_model=AtendenteSaida, status_code=status.HTTP_201_CREATED)
def criar(dados: AtendenteEntrada, sessao: Sessao, _: AdminAtual) -> Atendente:
    if sessao.scalar(select(Atendente).where(func.lower(Atendente.email) == dados.email.lower())):
        raise HTTPException(status.HTTP_409_CONFLICT, "ja existe um atendente com esse e-mail")
    atendente = Atendente(
        nome=dados.nome,
        email=dados.email.lower(),
        senha_hash=gerar_hash_senha(dados.senha),
        papel=dados.papel.value,
        setor=dados.setor or None,
    )
    sessao.add(atendente)
    # commit ANTES da resposta: a dependência (escopo "request" do FastAPI)
    # só confirma depois de a resposta sair, e o próximo pedido do navegador
    # podia chegar antes e não ver o dado
    sessao.commit()
    _sincronizar_chat(sessao)
    sessao.refresh(atendente)
    return atendente


@rotas.patch("/{atendente_id}", response_model=AtendenteSaida)
def atualizar(
    atendente_id: int, dados: AtendenteAtualizacao, sessao: Sessao, atual: AtendenteAtual
) -> Atendente:
    alvo = sessao.get(Atendente, atendente_id)
    if alvo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "atendente nao encontrado")
    # cada um cuida do proprio perfil; mexer nos outros e coisa de admin
    if alvo.id != atual.id and not atual.e_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "acao restrita a administradores")
    if (dados.papel is not None or dados.ativo is not None) and not atual.e_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "somente admin altera papel ou acesso")
    if dados.nome is not None:
        alvo.nome = dados.nome
    if dados.senha is not None:
        alvo.senha_hash = gerar_hash_senha(dados.senha)
    if dados.papel is not None:
        alvo.papel = dados.papel.value
    if dados.ativo is not None:
        alvo.ativo = dados.ativo
    if dados.disponivel is not None:
        alvo.disponivel = dados.disponivel
    if "setor" in dados.model_fields_set:
        # null ou "" limpa: o cliente passa a ver só o nome
        alvo.setor = dados.setor or None
    sessao.commit()  # antes da resposta (ver criar)
    _sincronizar_chat(sessao)
    sessao.refresh(alvo)
    return alvo

"""Cadastro de atendentes."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from ..dependencias import AdminAtual, AtendenteAtual, Sessao
from ..models import Atendente
from ..schemas import AtendenteAtualizacao, AtendenteEntrada, AtendenteSaida
from ..security import gerar_hash_senha

rotas = APIRouter(prefix="/api/atendentes", tags=["atendentes"])


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
    )
    sessao.add(atendente)
    sessao.flush()
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
    sessao.flush()
    return alvo

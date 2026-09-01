"""Dependencias compartilhadas pelas rotas."""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException, Path, status
from sqlalchemy.orm import Session

from .db import obter_sessao
from .models import Atendente, Conversa
from .security import ler_token

Sessao = Annotated[Session, Depends(obter_sessao)]


def atendente_atual(
    sessao: Sessao,
    authorization: Annotated[str | None, Header()] = None,
) -> Atendente:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "informe o token de acesso")
    atendente_id = ler_token(authorization.split(" ", 1)[1].strip())
    if atendente_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token invalido ou expirado")
    atendente = sessao.get(Atendente, atendente_id)
    if atendente is None or not atendente.ativo:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "atendente sem acesso")
    return atendente


AtendenteAtual = Annotated[Atendente, Depends(atendente_atual)]


def admin_atual(atendente: AtendenteAtual) -> Atendente:
    if not atendente.e_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "acao restrita a administradores")
    return atendente


AdminAtual = Annotated[Atendente, Depends(admin_atual)]


def conversa_por_id(conversa_id: Annotated[int, Path()], sessao: Sessao) -> Conversa:
    conversa = sessao.get(Conversa, conversa_id)
    if conversa is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversa nao encontrada")
    return conversa


ConversaAtual = Annotated[Conversa, Depends(conversa_por_id)]

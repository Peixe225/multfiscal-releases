"""Dependencias compartilhadas pelas rotas."""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException, Path, Query, status
from sqlalchemy.orm import Session

from . import permissoes as perm
from .db import obter_sessao
from .models import Atendente, Conversa
from .security import ler_token

Sessao = Annotated[Session, Depends(obter_sessao)]


def atendente_do_token(sessao: Session, token: str | None) -> Atendente:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "informe o token de acesso")
    atendente_id = ler_token(token)
    if atendente_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token invalido ou expirado")
    atendente = sessao.get(Atendente, atendente_id)
    if atendente is None or not atendente.ativo:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "atendente sem acesso")
    return atendente


def _do_cabecalho(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return authorization.split(" ", 1)[1].strip()


def atendente_atual(
    sessao: Sessao,
    authorization: Annotated[str | None, Header()] = None,
) -> Atendente:
    return atendente_do_token(sessao, _do_cabecalho(authorization))


def atendente_de_arquivo(
    sessao: Sessao,
    authorization: Annotated[str | None, Header()] = None,
    token: Annotated[str | None, Query(description="alternativa ao cabeçalho")] = None,
) -> Atendente:
    """Aceita o token na query além do cabeçalho.

    `<img src>` e `<a download>` não mandam cabeçalho nenhum; é o mesmo motivo
    pelo qual o fluxo SSE também recebe o token por query string.
    """
    return atendente_do_token(sessao, _do_cabecalho(authorization) or token)


AtendenteAtual = Annotated[Atendente, Depends(atendente_atual)]
AtendenteDeArquivo = Annotated[Atendente, Depends(atendente_de_arquivo)]


def admin_atual(atendente: AtendenteAtual) -> Atendente:
    """Cargo Administrador (o papel "admin" é só o espelho dele)."""
    if not atendente.e_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "acao restrita a administradores")
    return atendente


AdminAtual = Annotated[Atendente, Depends(admin_atual)]


def com_permissao(permissao: str):
    """Login + permissão do catálogo (app/permissoes.py); 403 com a frase
    "sem permissão para ..." se o cargo não a tiver. Uso:

        def criar(..., atual: Annotated[Atendente, com_permissao("canais.gerenciar")])
    """

    def dependencia(atendente: AtendenteAtual) -> Atendente:
        perm.exigir(atendente, permissao)
        return atendente

    return Depends(dependencia)


def conversa_por_id(conversa_id: Annotated[int, Path()], sessao: Sessao, atual: AtendenteAtual) -> Conversa:
    """A conversa da rota, DEPOIS do login: sem token, "existe" e "não existe"
    respondem o mesmo 401, e ninguém enumera ids (igual ao PHP). A conversa
    que a pessoa não pode ver (servicos/visibilidade.py: outro setor) também
    é 404. O atendente_atual fica em cache na requisição."""
    from .servicos import visibilidade  # import tardio: servicos importa daqui

    return visibilidade.exigir(sessao, atual, conversa_id)


ConversaAtual = Annotated[Conversa, Depends(conversa_por_id)]

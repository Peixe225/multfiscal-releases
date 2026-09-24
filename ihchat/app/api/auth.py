"""Login dos atendentes."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from ..dependencias import AtendenteAtual, Sessao
from ..models import Atendente
from ..schemas import AtendenteSaida, Credenciais, TokenSaida
from ..security import conferir_senha, criar_token

rotas = APIRouter(prefix="/api/auth", tags=["autenticacao"])


@rotas.post("/login", response_model=TokenSaida)
def login(dados: Credenciais, sessao: Sessao) -> TokenSaida:
    atendente = sessao.scalar(select(Atendente).where(func.lower(Atendente.email) == dados.email.lower()))
    if atendente is None or not conferir_senha(dados.senha, atendente.senha_hash) or not atendente.ativo:
        # mesma resposta para usuario inexistente e senha errada
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "e-mail ou senha invalidos")
    return TokenSaida(token=criar_token(atendente.id), atendente=AtendenteSaida.model_validate(atendente))


@rotas.get("/eu", response_model=AtendenteSaida)
def eu(atendente: AtendenteAtual) -> Atendente:
    return atendente

"""Fluxo de eventos em tempo real para o painel (Server-Sent Events)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from ..dependencias import Sessao
from ..eventos import barramento
from ..models import Atendente
from ..security import ler_token

rotas = APIRouter(prefix="/api/eventos", tags=["eventos"])

CABECALHOS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",  # evita buffer do nginx na frente do app
}


@rotas.get("/stream")
def stream(sessao: Sessao, token: str = Query(description="token do atendente")) -> StreamingResponse:
    """EventSource nao permite cabecalhos, entao o token vem na query string."""
    atendente_id = ler_token(token)
    atendente = sessao.get(Atendente, atendente_id) if atendente_id else None
    if atendente is None or not atendente.ativo:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token invalido ou expirado")
    return StreamingResponse(barramento.fluxo(), media_type="text/event-stream", headers=CABECALHOS)

"""Simulador de clientes (esqueleto; a implementação vem a seguir)."""
from __future__ import annotations

from fastapi import APIRouter

rotas = APIRouter(prefix="/api/simulador", tags=["simulador"])

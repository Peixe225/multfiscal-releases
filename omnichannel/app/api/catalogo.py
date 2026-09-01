"""Etiquetas e respostas rapidas."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from ..dependencias import AtendenteAtual, Sessao
from ..models import Etiqueta, RespostaRapida
from ..schemas import (
    EtiquetaEntrada,
    EtiquetaSaida,
    RespostaRapidaEntrada,
    RespostaRapidaSaida,
)

rotas = APIRouter(prefix="/api", tags=["catalogo"])


@rotas.get("/etiquetas", response_model=list[EtiquetaSaida])
def listar_etiquetas(sessao: Sessao, _: AtendenteAtual) -> list[Etiqueta]:
    return list(sessao.scalars(select(Etiqueta).order_by(Etiqueta.nome)))


@rotas.post("/etiquetas", response_model=EtiquetaSaida, status_code=status.HTTP_201_CREATED)
def criar_etiqueta(dados: EtiquetaEntrada, sessao: Sessao, _: AtendenteAtual) -> Etiqueta:
    if sessao.scalar(select(Etiqueta).where(func.lower(Etiqueta.nome) == dados.nome.lower())):
        raise HTTPException(status.HTTP_409_CONFLICT, "ja existe uma etiqueta com esse nome")
    etiqueta = Etiqueta(nome=dados.nome, cor=dados.cor)
    sessao.add(etiqueta)
    sessao.flush()
    return etiqueta


@rotas.delete("/etiquetas/{etiqueta_id}", status_code=status.HTTP_204_NO_CONTENT)
def remover_etiqueta(etiqueta_id: int, sessao: Sessao, _: AtendenteAtual) -> None:
    etiqueta = sessao.get(Etiqueta, etiqueta_id)
    if etiqueta is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "etiqueta nao encontrada")
    sessao.delete(etiqueta)


@rotas.get("/respostas-rapidas", response_model=list[RespostaRapidaSaida])
def listar_respostas(sessao: Sessao, _: AtendenteAtual) -> list[RespostaRapida]:
    return list(sessao.scalars(select(RespostaRapida).order_by(RespostaRapida.atalho)))


@rotas.post(
    "/respostas-rapidas", response_model=RespostaRapidaSaida, status_code=status.HTTP_201_CREATED
)
def criar_resposta(dados: RespostaRapidaEntrada, sessao: Sessao, _: AtendenteAtual) -> RespostaRapida:
    atalho = dados.atalho.strip().lstrip("/")
    if sessao.scalar(select(RespostaRapida).where(RespostaRapida.atalho == atalho)):
        raise HTTPException(status.HTTP_409_CONFLICT, "ja existe uma resposta com esse atalho")
    resposta = RespostaRapida(atalho=atalho, titulo=dados.titulo, conteudo=dados.conteudo)
    sessao.add(resposta)
    sessao.flush()
    return resposta


@rotas.delete("/respostas-rapidas/{resposta_id}", status_code=status.HTTP_204_NO_CONTENT)
def remover_resposta(resposta_id: int, sessao: Sessao, _: AtendenteAtual) -> None:
    resposta = sessao.get(RespostaRapida, resposta_id)
    if resposta is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "resposta nao encontrada")
    sessao.delete(resposta)

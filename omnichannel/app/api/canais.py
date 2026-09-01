"""Cadastro de canais de atendimento."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from ..canais.registro import adaptador_para
from ..dependencias import AdminAtual, AtendenteAtual, Sessao
from ..models import Canal, TipoCanal
from ..schemas import CanalAtualizacao, CanalEntrada, CanalSaida
from ..security import gerar_chave
from ..serializacao import canal_saida

rotas = APIRouter(prefix="/api/canais", tags=["canais"])


@rotas.get("", response_model=list[CanalSaida])
def listar(sessao: Sessao, _: AtendenteAtual) -> list[CanalSaida]:
    canais = sessao.scalars(select(Canal).order_by(Canal.nome))
    return [canal_saida(c) for c in canais]


@rotas.post("", response_model=CanalSaida, status_code=status.HTTP_201_CREATED)
def criar(dados: CanalEntrada, sessao: Sessao, _: AdminAtual) -> CanalSaida:
    canal = Canal(
        nome=dados.nome,
        tipo=dados.tipo.value,
        credenciais=dados.credenciais,
        ativo=dados.ativo,
        # o webchat precisa de uma chave publica para o widget; os demais
        # canais recebem um segredo para validar a assinatura dos webhooks
        chave_publica=gerar_chave("wc_") if dados.tipo is TipoCanal.WEBCHAT else None,
        segredo_webhook=None if dados.tipo is TipoCanal.WEBCHAT else gerar_chave(),
    )
    sessao.add(canal)
    sessao.flush()
    return canal_saida(canal)


@rotas.get("/{canal_id}/credenciais", response_model=dict)
def ver_credenciais(canal_id: int, sessao: Sessao, _: AdminAtual) -> dict:
    canal = sessao.get(Canal, canal_id)
    if canal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "canal nao encontrado")
    return {
        "credenciais": canal.credenciais or {},
        "segredo_webhook": canal.segredo_webhook,
        "chave_publica": canal.chave_publica,
        "campos_obrigatorios": list(adaptador_para(canal).campos_obrigatorios),
    }


@rotas.patch("/{canal_id}", response_model=CanalSaida)
def atualizar(canal_id: int, dados: CanalAtualizacao, sessao: Sessao, _: AdminAtual) -> CanalSaida:
    canal = sessao.get(Canal, canal_id)
    if canal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "canal nao encontrado")
    if dados.nome is not None:
        canal.nome = dados.nome
    if dados.credenciais is not None:
        # mescla para nao apagar um segredo que o painel nao reenviou
        canal.credenciais = {**(canal.credenciais or {}), **dados.credenciais}
    if dados.ativo is not None:
        canal.ativo = dados.ativo
    sessao.flush()
    return canal_saida(canal)


@rotas.delete("/{canal_id}", status_code=status.HTTP_204_NO_CONTENT)
def remover(canal_id: int, sessao: Sessao, _: AdminAtual) -> None:
    canal = sessao.get(Canal, canal_id)
    if canal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "canal nao encontrado")
    sessao.delete(canal)

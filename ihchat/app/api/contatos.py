"""Consulta e edicao da ficha do contato."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import or_, select

from typing import Annotated

from ..dependencias import AtendenteAtual, Sessao, com_permissao
from ..models import Atendente, Contato, Conversa
from ..schemas import ContatoAtualizacao, ContatoSaida
from ..servicos.contatos import mesclar
from ..servicos.mensagens import publicar_conversa
from ..util import normalizar_telefone

rotas = APIRouter(prefix="/api/contatos", tags=["contatos"])


@rotas.get("", response_model=list[ContatoSaida])
def listar(
    sessao: Sessao,
    _: AtendenteAtual,
    q: str | None = Query(default=None, description="busca por nome, e-mail, telefone ou empresa"),
    limite: int = Query(default=50, le=200),
) -> list[Contato]:
    consulta = select(Contato).order_by(Contato.nome).limit(limite)
    if q:
        alvo = f"%{q.strip()}%"
        consulta = consulta.where(
            or_(
                Contato.nome.ilike(alvo),
                Contato.email.ilike(alvo),
                Contato.telefone.ilike(alvo),
                Contato.empresa.ilike(alvo),
                Contato.documento.ilike(alvo),
            )
        )
    return list(sessao.scalars(consulta))


@rotas.get("/{contato_id}", response_model=ContatoSaida)
def obter(contato_id: int, sessao: Sessao, _: AtendenteAtual) -> Contato:
    contato = sessao.get(Contato, contato_id)
    if contato is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "contato nao encontrado")
    return contato


@rotas.patch("/{contato_id}", response_model=ContatoSaida)
def atualizar(
    contato_id: int, dados: ContatoAtualizacao, sessao: Sessao, _: Annotated[Atendente, com_permissao("contatos.editar")]
) -> Contato:
    contato = sessao.get(Contato, contato_id)
    if contato is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "contato nao encontrado")
    for campo, valor in dados.model_dump(exclude_unset=True).items():
        if campo == "telefone" and valor:
            valor = normalizar_telefone(valor)  # guardado so com digitos
        if campo == "email" and valor:
            valor = valor.lower()
        setattr(contato, campo, valor)
    sessao.flush()
    return contato


@rotas.post("/{contato_id}/mesclar/{outro_id}", response_model=ContatoSaida)
def mesclar_contatos(
    contato_id: int, outro_id: int, sessao: Sessao, _: Annotated[Atendente, com_permissao("contatos.mesclar")]
) -> Contato:
    """Junta duas fichas do mesmo cliente que chegaram por canais diferentes."""
    principal = sessao.get(Contato, contato_id)
    secundario = sessao.get(Contato, outro_id)
    if principal is None or secundario is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "contato nao encontrado")
    movidas = [] if principal.id == secundario.id else list(
        sessao.scalars(select(Conversa.id).where(Conversa.contato_id == secundario.id))
    )
    principal = mesclar(sessao, principal, secundario)
    sessao.commit()
    # o painel atualiza a ficha nas conversas que mudaram de dono
    for conversa_id in movidas:
        conversa = sessao.get(Conversa, conversa_id)
        if conversa is not None:
            publicar_conversa(conversa)
    return principal

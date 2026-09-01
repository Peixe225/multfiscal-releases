"""Identidade unificada do contato entre canais."""
from __future__ import annotations

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from ..models import Contato, ContatoIdentidade, Conversa, TipoCanal
from ..util import normalizar_telefone

# canais cujo identificador ja e um dado de contato conhecido - permitem
# reconhecer que o "novo" contato e alguem que ja fala por outro canal
CANAIS_TELEFONE = {TipoCanal.WHATSAPP.value}
CANAIS_EMAIL = {TipoCanal.EMAIL.value}


def _por_identidade(sessao: Session, canal_tipo: str, identificador: str) -> Contato | None:
    return sessao.scalar(
        select(Contato)
        .join(ContatoIdentidade)
        .where(
            ContatoIdentidade.canal_tipo == canal_tipo,
            ContatoIdentidade.identificador == identificador,
        )
    )


def _por_dado_conhecido(sessao: Session, canal_tipo: str, identificador: str) -> Contato | None:
    """Reconhece o contato que ja existe com o mesmo telefone ou e-mail."""
    if canal_tipo in CANAIS_TELEFONE:
        telefone = normalizar_telefone(identificador)
        # o telefone e sempre gravado so com digitos (ver api/contatos.py),
        # entao a comparacao direta funciona em qualquer banco
        return sessao.scalar(select(Contato).where(Contato.telefone == telefone)) if telefone else None
    if canal_tipo in CANAIS_EMAIL:
        return sessao.scalar(select(Contato).where(func.lower(Contato.email) == identificador.lower()))
    return None


def resolver_contato(
    sessao: Session, canal_tipo: str, identificador: str, nome_exibicao: str | None = None
) -> Contato:
    """Devolve o contato dono daquela identidade, criando-o se for a primeira vez."""
    identificador = identificador.strip()
    if canal_tipo in CANAIS_TELEFONE:
        identificador = normalizar_telefone(identificador)
    elif canal_tipo in CANAIS_EMAIL:
        identificador = identificador.lower()

    contato = _por_identidade(sessao, canal_tipo, identificador)
    if contato is not None:
        if nome_exibicao and contato.nome == identificador:
            contato.nome = nome_exibicao  # antes so tinhamos o numero/endereco
        return contato

    contato = _por_dado_conhecido(sessao, canal_tipo, identificador)
    if contato is None:
        contato = Contato(
            nome=nome_exibicao or identificador,
            telefone=identificador if canal_tipo in CANAIS_TELEFONE else None,
            email=identificador if canal_tipo in CANAIS_EMAIL else None,
        )
        sessao.add(contato)
        sessao.flush()

    sessao.add(
        ContatoIdentidade(
            contato_id=contato.id,
            canal_tipo=canal_tipo,
            identificador=identificador,
            nome_exibicao=nome_exibicao,
        )
    )
    sessao.flush()
    sessao.refresh(contato)
    return contato


def identificador_no_canal(sessao: Session, contato: Contato, canal_tipo: str) -> str | None:
    """Para onde responder este contato dentro de um canal."""
    identidade = sessao.scalar(
        select(ContatoIdentidade).where(
            ContatoIdentidade.contato_id == contato.id,
            ContatoIdentidade.canal_tipo == canal_tipo,
        )
    )
    if identidade:
        return identidade.identificador
    if canal_tipo in CANAIS_TELEFONE and contato.telefone:
        return normalizar_telefone(contato.telefone)
    if canal_tipo in CANAIS_EMAIL and contato.email:
        return contato.email
    return None


def mesclar(sessao: Session, principal: Contato, secundario: Contato) -> Contato:
    """Junta um contato duplicado no principal, preservando todo o historico."""
    if principal.id == secundario.id:
        return principal

    # comandos diretos, e nao a colecao do ORM: mexer na colecao do contato que
    # sera apagado faria o cascade delete-orphan levar junto as identidades
    existentes = {(i.canal_tipo, i.identificador) for i in principal.identidades}
    duplicadas = [
        i.id for i in secundario.identidades if (i.canal_tipo, i.identificador) in existentes
    ]
    if duplicadas:
        sessao.execute(delete(ContatoIdentidade).where(ContatoIdentidade.id.in_(duplicadas)))
    sessao.execute(
        update(ContatoIdentidade)
        .where(ContatoIdentidade.contato_id == secundario.id)
        .values(contato_id=principal.id)
    )
    sessao.execute(
        update(Conversa).where(Conversa.contato_id == secundario.id).values(contato_id=principal.id)
    )
    principal.email = principal.email or secundario.email
    principal.telefone = principal.telefone or secundario.telefone
    principal.empresa = principal.empresa or secundario.empresa
    principal.documento = principal.documento or secundario.documento
    sessao.flush()
    sessao.expire(secundario)
    sessao.delete(secundario)
    sessao.flush()
    sessao.refresh(principal)
    return principal

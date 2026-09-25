"""Chat interno da equipe: /api/interno/...

    GET    /api/interno/salas                         salas de quem pede (não lidas, última mensagem)
    GET    /api/interno/salas/{sala_id}               detalhe com os membros
    PATCH  /api/interno/salas/{sala_id}               silenciada; no grupo, nome/adicionar/remover (quem administra)
    POST   /api/interno/salas/{sala_id}/sair          sai do grupo (204)
    GET    /api/interno/salas/{sala_id}/mensagens     ?antes=<id>&limite=<n> (mais novas por último)
    POST   /api/interno/salas/{sala_id}/mensagens     {conteudo, conversa_id?} -> 201
    POST   /api/interno/salas/{sala_id}/lida          {ate?} marca como lida até a mensagem
    PATCH  /api/interno/mensagens/{mensagem_id}       {conteudo} (só quem escreveu)
    DELETE /api/interno/mensagens/{mensagem_id}       vira "mensagem apagada" (só quem escreveu)
    POST   /api/interno/grupos                        {nome, membros: [ids]} -> 201
    POST   /api/interno/diretas                       {atendente_id} abre (ou devolve) a direta do par

Quem não é membro recebe 404 em tudo da sala, sem saber se ela existe. As
regras ficam em app/servicos/chat_interno.py; o PHP tem o mesmo contrato em
php/app/ChatInterno. Cada rota confirma ANTES de publicar o evento: o painel
nunca recebe o aviso de um dado que ainda não está no banco.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Body, Path, Query, Response, status
from pydantic import BaseModel, Field

from ..dependencias import AtendenteAtual, Sessao
from ..servicos import chat_interno as svc
from ..servicos.chat_interno import (
    LIMITE_MAXIMO,
    LIMITE_PADRAO,
    MAIOR_ID,
    MAX_CONTEUDO,
    MAX_MEMBROS,
    LidaSaida,
    MensagemInternaSaida,
    PaginaMensagens,
    SalaDetalhe,
    SalaSaida,
)

rotas = APIRouter(prefix="/api/interno", tags=["chat interno"])

SalaId = Annotated[int, Path(le=MAIOR_ID)]
MensagemId = Annotated[int, Path(le=MAIOR_ID)]
Id = Annotated[int, Field(ge=1, le=MAIOR_ID)]


class MensagemInternaEntrada(BaseModel):
    conteudo: str = Field(default="", max_length=MAX_CONTEUDO)
    # compartilhar uma conversa de cliente: precisa existir (senão 404)
    conversa_id: Id | None = None


class MensagemInternaEdicao(BaseModel):
    conteudo: str = Field(max_length=MAX_CONTEUDO)


class GrupoEntrada(BaseModel):
    nome: str = Field(max_length=200)  # o limite de verdade (80, sem espaços sobrando) é conferido no serviço
    membros: list[Id] = Field(default_factory=list, max_length=MAX_MEMBROS)


class DiretaEntrada(BaseModel):
    atendente_id: Id


class SalaAlteracao(BaseModel):
    silenciada: bool | None = None
    nome: str | None = Field(default=None, max_length=200)
    adicionar: list[Id] | None = Field(default=None, max_length=MAX_MEMBROS)
    remover: list[Id] | None = Field(default=None, max_length=MAX_MEMBROS)


class LidaEntrada(BaseModel):
    ate: Annotated[int, Field(ge=0, le=MAIOR_ID)] | None = None


def _confirmar(sessao, eventos) -> None:
    sessao.commit()
    svc.publicar(eventos)


@rotas.get("/salas", response_model=list[SalaSaida])
def listar_salas(sessao: Sessao, atual: AtendenteAtual) -> list[SalaSaida]:
    svc.sincronizar(sessao)
    return svc.listar_salas(sessao, atual)


@rotas.get("/salas/{sala_id}", response_model=SalaDetalhe)
def obter_sala(sala_id: SalaId, sessao: Sessao, atual: AtendenteAtual) -> SalaDetalhe:
    svc.sincronizar(sessao)
    sala, membro = svc.exigir_sala(sessao, sala_id, atual)
    return svc.sala_detalhe(sessao, sala, membro, atual)


@rotas.patch("/salas/{sala_id}", response_model=SalaDetalhe)
def alterar_sala(sala_id: SalaId, dados: SalaAlteracao, sessao: Sessao, atual: AtendenteAtual) -> SalaDetalhe:
    svc.sincronizar(sessao)
    sala, membro = svc.exigir_sala(sessao, sala_id, atual)
    detalhe, eventos = svc.alterar_sala(
        sessao,
        sala,
        membro,
        atual,
        # campo enviado como null conta como "não mexer", igual ao PHP
        {campo for campo in dados.model_fields_set if getattr(dados, campo) is not None},
        dados.silenciada,
        dados.nome,
        dados.adicionar,
        dados.remover,
    )
    _confirmar(sessao, eventos)
    return detalhe


@rotas.post("/salas/{sala_id}/sair", status_code=status.HTTP_204_NO_CONTENT)
def sair(sala_id: SalaId, sessao: Sessao, atual: AtendenteAtual) -> Response:
    svc.sincronizar(sessao)
    sala, _ = svc.exigir_sala(sessao, sala_id, atual)
    _confirmar(sessao, svc.sair(sessao, sala, atual))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@rotas.get("/salas/{sala_id}/mensagens", response_model=PaginaMensagens)
def listar_mensagens(
    sala_id: SalaId,
    sessao: Sessao,
    atual: AtendenteAtual,
    antes: Annotated[int | None, Query(ge=1, le=MAIOR_ID, description="só mensagens com id menor")] = None,
    limite: Annotated[int, Query(ge=1, le=LIMITE_MAXIMO)] = LIMITE_PADRAO,
) -> PaginaMensagens:
    svc.sincronizar(sessao)
    sala, membro = svc.exigir_sala(sessao, sala_id, atual)
    return svc.pagina(sessao, sala, membro, antes, limite)


@rotas.post(
    "/salas/{sala_id}/mensagens", response_model=MensagemInternaSaida, status_code=status.HTTP_201_CREATED
)
def enviar(
    sala_id: SalaId, dados: MensagemInternaEntrada, sessao: Sessao, atual: AtendenteAtual
) -> MensagemInternaSaida:
    svc.sincronizar(sessao)
    sala, membro = svc.exigir_sala(sessao, sala_id, atual)
    saida, eventos = svc.enviar(sessao, sala, membro, atual, dados.conteudo, dados.conversa_id)
    _confirmar(sessao, eventos)
    return saida


@rotas.post("/salas/{sala_id}/lida", response_model=LidaSaida)
def marcar_lida(
    sala_id: SalaId,
    sessao: Sessao,
    atual: AtendenteAtual,
    dados: Annotated[LidaEntrada | None, Body()] = None,
) -> LidaSaida:
    svc.sincronizar(sessao)
    sala, membro = svc.exigir_sala(sessao, sala_id, atual)
    saida, eventos = svc.marcar_lida(sessao, sala, membro, atual, dados.ate if dados else None)
    _confirmar(sessao, eventos)
    return saida


@rotas.patch("/mensagens/{mensagem_id}", response_model=MensagemInternaSaida)
def editar(
    mensagem_id: MensagemId, dados: MensagemInternaEdicao, sessao: Sessao, atual: AtendenteAtual
) -> MensagemInternaSaida:
    svc.sincronizar(sessao)
    mensagem, _, _ = svc.exigir_mensagem(sessao, mensagem_id, atual)
    saida, eventos = svc.editar(sessao, mensagem, atual, dados.conteudo)
    _confirmar(sessao, eventos)
    return saida


@rotas.delete("/mensagens/{mensagem_id}", response_model=MensagemInternaSaida)
def apagar(mensagem_id: MensagemId, sessao: Sessao, atual: AtendenteAtual) -> MensagemInternaSaida:
    svc.sincronizar(sessao)
    mensagem, _, _ = svc.exigir_mensagem(sessao, mensagem_id, atual)
    saida, eventos = svc.apagar(sessao, mensagem, atual)
    _confirmar(sessao, eventos)
    return saida


@rotas.post("/grupos", response_model=SalaDetalhe, status_code=status.HTTP_201_CREATED)
def criar_grupo(dados: GrupoEntrada, sessao: Sessao, atual: AtendenteAtual) -> SalaDetalhe:
    svc.sincronizar(sessao)
    detalhe, eventos = svc.criar_grupo(sessao, atual, dados.nome, list(dados.membros))
    _confirmar(sessao, eventos)
    return detalhe


@rotas.post("/diretas", response_model=SalaDetalhe)
def abrir_direta(dados: DiretaEntrada, sessao: Sessao, atual: AtendenteAtual) -> SalaDetalhe:
    svc.sincronizar(sessao)
    detalhe, eventos = svc.abrir_direta(sessao, atual, dados.atendente_id)
    _confirmar(sessao, eventos)
    return detalhe

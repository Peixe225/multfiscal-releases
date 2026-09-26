"""Cargos, setores e o catálogo de permissões (mesmo contrato de
php/app/Equipe/Rotas.php):

  GET    /api/permissoes              catálogo [{chave, rotulo, grupo}]
  GET    /api/cargos                  [CargoSaida] do nível mais alto ao mais baixo
  POST   /api/cargos                  {nome, nivel, permissoes} -> 201       (cargos.gerenciar)
  PATCH  /api/cargos/{id}             {nome?, nivel?, permissoes?}           (cargos.gerenciar)
  DELETE /api/cargos/{id}             só cargo criado pelo admin e sem ninguém (204)
  GET    /api/setores                 [SetorSaida] (ativos e inativos)
  POST   /api/setores                 {nome, descricao?} -> 201              (setores.gerenciar)
  PATCH  /api/setores/{id}            {nome?, descricao?, ativo?}            (setores.gerenciar)
  DELETE /api/setores/{id}            só setor que ninguém usa (204)

Ler é para qualquer atendente logado: o painel monta os seletores daqui.
"""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from .. import permissoes as perm
from ..dependencias import AtendenteAtual, Sessao, com_permissao
from ..models import Atendente, Canal, Cargo, Conversa, SalaInterna, Setor, TipoSala
from ..schemas import (
    CargoAtualizacao,
    CargoEntrada,
    CargoSaida,
    PermissaoSaida,
    SetorAtualizacao,
    SetorEntrada,
    SetorSaida,
)
from ..servicos import chat_interno, hierarquia
from ..servicos import setores as svc_setores

rotas = APIRouter(prefix="/api", tags=["equipe"])
log = logging.getLogger("ihchat.equipe")

GerenteDeCargos = Annotated[Atendente, com_permissao("cargos.gerenciar")]
GerenteDeSetores = Annotated[Atendente, com_permissao("setores.gerenciar")]
CARGO_REPETIDO = "ja existe um cargo com esse nome"


@rotas.get("/permissoes", response_model=list[PermissaoSaida])
def permissoes(_: AtendenteAtual) -> list[dict]:
    return perm.catalogo()


# ------------------------------------------------------------------ cargos
def _pessoas_por_cargo(sessao) -> dict[int, int]:
    return {
        int(cargo_id): int(total)
        for cargo_id, total in sessao.execute(
            select(Atendente.cargo_id, func.count(Atendente.id))
            .where(Atendente.cargo_id.is_not(None))
            .group_by(Atendente.cargo_id)
        )
    }


def _cargo_saida(cargo: Cargo, total: int) -> CargoSaida:
    return CargoSaida(
        id=cargo.id,
        nome=cargo.nome,
        nivel=cargo.nivel,
        permissoes=cargo.permissoes_efetivas,
        sistema=bool(cargo.sistema),
        total_pessoas=total,
    )


def _exigir_nome_livre(sessao, nome: str, exceto: int | None = None) -> None:
    alvo = svc_setores.normalizar(nome)
    for cargo in sessao.scalars(select(Cargo)):
        if cargo.id != exceto and svc_setores.normalizar(cargo.nome) == alvo:
            raise HTTPException(status.HTTP_409_CONFLICT, CARGO_REPETIDO)


def _confirmar(sessao, frase_conflito: str) -> None:
    try:
        sessao.commit()
    except IntegrityError:
        sessao.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, frase_conflito) from None


@rotas.get("/cargos", response_model=list[CargoSaida])
def listar_cargos(sessao: Sessao, _: AtendenteAtual) -> list[CargoSaida]:
    pessoas = _pessoas_por_cargo(sessao)
    cargos = sessao.scalars(select(Cargo).order_by(Cargo.nivel.desc(), Cargo.nome, Cargo.id))
    return [_cargo_saida(c, pessoas.get(c.id, 0)) for c in cargos]


@rotas.post("/cargos", response_model=CargoSaida, status_code=status.HTTP_201_CREATED)
def criar_cargo(dados: CargoEntrada, sessao: Sessao, eu: GerenteDeCargos) -> CargoSaida:
    hierarquia.exigir_nivel_de_cargo(eu, dados.nivel)
    hierarquia.exigir_permissoes_que_tem(eu, dados.permissoes)
    _exigir_nome_livre(sessao, dados.nome)
    cargo = Cargo(chave=None, nome=dados.nome, nivel=dados.nivel, permissoes=dados.permissoes, sistema=False)
    sessao.add(cargo)
    _confirmar(sessao, CARGO_REPETIDO)
    return _cargo_saida(cargo, 0)


@rotas.patch("/cargos/{cargo_id}", response_model=CargoSaida)
def atualizar_cargo(cargo_id: int, dados: CargoAtualizacao, sessao: Sessao, eu: GerenteDeCargos) -> CargoSaida:
    cargo = sessao.get(Cargo, cargo_id)
    if cargo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "cargo nao encontrado")
    hierarquia.exigir_gerenciar_cargo(eu, cargo)
    if dados.nome is not None and dados.nome != cargo.nome:
        _exigir_nome_livre(sessao, dados.nome, cargo.id)
        cargo.nome = dados.nome
    if dados.nivel is not None and dados.nivel != cargo.nivel:
        hierarquia.exigir_nivel_de_cargo(eu, dados.nivel)
        cargo.nivel = dados.nivel
    if dados.permissoes is not None:
        # o que o cargo GANHA precisa ser de quem edita; tirar é sempre possível
        atuais = set(cargo.permissoes_efetivas)
        hierarquia.exigir_permissoes_que_tem(eu, [p for p in dados.permissoes if p not in atuais])
        cargo.permissoes = list(dados.permissoes)
    _confirmar(sessao, CARGO_REPETIDO)
    return _cargo_saida(cargo, _pessoas_por_cargo(sessao).get(cargo.id, 0))


@rotas.delete("/cargos/{cargo_id}", status_code=status.HTTP_204_NO_CONTENT)
def apagar_cargo(cargo_id: int, sessao: Sessao, eu: GerenteDeCargos) -> Response:
    cargo = sessao.get(Cargo, cargo_id)
    if cargo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "cargo nao encontrado")
    hierarquia.exigir_gerenciar_cargo(eu, cargo)
    if cargo.sistema:
        raise HTTPException(status.HTTP_403_FORBIDDEN, hierarquia.CARGO_DE_FABRICA)
    total = len(sessao.scalars(select(Atendente.id).where(Atendente.cargo_id == cargo.id).with_for_update()).all())
    if total:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"cargo em uso por {total} {'pessoa' if total == 1 else 'pessoas'}: mude o cargo antes de apagá-lo",
        )
    sessao.delete(cargo)
    sessao.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ----------------------------------------------------------------- setores
def _setor_ou_404(sessao, setor_id: int) -> Setor:
    setor = sessao.get(Setor, setor_id)
    if setor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "setor nao encontrado")
    return setor


@rotas.get("/setores", response_model=list[SetorSaida])
def listar_setores(sessao: Sessao, _: AtendenteAtual) -> list[SetorSaida]:
    pessoas = svc_setores.pessoas_ativas_por_setor(sessao)
    return [svc_setores.saida(s, pessoas.get(s.id, 0)) for s in svc_setores.todos(sessao)]


@rotas.post("/setores", response_model=SetorSaida, status_code=status.HTTP_201_CREATED)
def criar_setor(dados: SetorEntrada, sessao: Sessao, _: GerenteDeSetores) -> SetorSaida:
    setor = svc_setores.criar(sessao, dados.nome, dados.descricao)
    _confirmar(sessao, svc_setores.JA_EXISTE)
    return svc_setores.saida(setor, 0)


@rotas.patch("/setores/{setor_id}", response_model=SetorSaida)
def atualizar_setor(setor_id: int, dados: SetorAtualizacao, sessao: Sessao, _: GerenteDeSetores) -> SetorSaida:
    """Renomear leva o nome novo às pessoas do setor (assinatura das próximas
    mensagens) e à sala do chat. Desativar exige o setor sem ninguém ativo e
    tira o setor padrão dos canais que o usavam (a conversa nova volta para a
    fila geral em vez de cair numa fila que ninguém vê)."""
    setor = _setor_ou_404(sessao, setor_id)
    campos = dados.model_fields_set
    if dados.nome is not None and dados.nome != setor.nome:
        if svc_setores.por_nome(sessao, dados.nome, exceto=setor.id) is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, svc_setores.JA_EXISTE)
        setor.nome = dados.nome
        sessao.execute(update(Atendente).where(Atendente.setor_id == setor.id).values(setor=dados.nome))
    if "descricao" in campos:
        setor.descricao = dados.descricao or None
    if dados.ativo is not None and dados.ativo != setor.ativo:
        if not dados.ativo:
            ativos = sessao.scalars(
                select(Atendente.id).where(Atendente.ativo.is_(True), Atendente.setor_id == setor.id).with_for_update()
            ).all()
            if ativos:
                raise HTTPException(
                    status.HTTP_409_CONFLICT, "setor com pessoas ativas: mova-as para outro setor antes de desativá-lo"
                )
            sessao.execute(update(Canal).where(Canal.setor_padrao_id == setor.id).values(setor_padrao_id=None))
        setor.ativo = dados.ativo
    _confirmar(sessao, svc_setores.JA_EXISTE)
    chat_interno.sincronizar_sem_falhar(sessao)  # a sala do setor acompanha o nome novo
    sessao.refresh(setor)
    return svc_setores.saida(setor, svc_setores.pessoas_ativas_por_setor(sessao).get(setor.id, 0))


@rotas.delete("/setores/{setor_id}", status_code=status.HTTP_204_NO_CONTENT)
def apagar_setor(setor_id: int, sessao: Sessao, _: GerenteDeSetores) -> Response:
    """Só apaga o setor que ninguém usa (pessoa, mesmo inativa, conversa ou
    canal): o que já foi usado é desativado, e o histórico continua
    apontando para ele."""
    setor = _setor_ou_404(sessao, setor_id)
    usos = sum(
        int(sessao.scalar(consulta) or 0)
        for consulta in (
            select(func.count(Atendente.id)).where(Atendente.setor_id == setor.id),
            select(func.count(Conversa.id)).where(Conversa.setor_id == setor.id),
            select(func.count(Canal.id)).where(Canal.setor_padrao_id == setor.id),
        )
    )
    if usos:
        raise HTTPException(status.HTTP_409_CONFLICT, "setor em uso: desative-o em vez de apagar")
    # a sala antiga do setor (sem membros: ninguém tem o setor) fica como
    # histórico, desligada do id que deixa de existir
    sessao.execute(
        update(SalaInterna)
        .where(SalaInterna.tipo == TipoSala.SETOR.value, SalaInterna.setor_id == setor.id)
        .values(setor_id=None, chave=f"setor:apagado:{setor.id}")
    )
    sessao.delete(setor)
    sessao.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

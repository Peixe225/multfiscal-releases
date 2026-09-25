"""Cadastro da equipe, com cargos e setores (mesmo contrato de
php/app/Atendimento/ApiAtendentes.php).

  GET   /api/atendentes         equipe.ver
  POST  /api/atendentes         equipe.gerenciar (+ definir_cargo / definir_setor)
  PATCH /api/atendentes/{id}    a própria senha e disponibilidade: qualquer um;
                                o resto, só quem gerencia (servicos/hierarquia.py)

Entrada: cargo_id e setor_id (o jeito novo) ou, por compatibilidade, papel
("admin" = Administrador, "atendente" = Colaborador) e setor (o nome; quem
pode gerenciar setores cria na hora o que não existir).
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from .. import permissoes as perm
from ..dependencias import AtendenteAtual, Sessao, com_permissao
from ..models import Atendente, Cargo, Papel, Setor
from ..schemas import AtendenteAtualizacao, AtendenteEntrada, AtendenteSaida
from ..security import gerar_hash_senha
from ..servicos import chat_interno, hierarquia
from ..servicos import setores as svc_setores

rotas = APIRouter(prefix="/api/atendentes", tags=["atendentes"])

EMAIL_REPETIDO = "ja existe um atendente com esse e-mail"
SETOR_INATIVO = "setor inativo: reative-o ou escolha outro"


def _cargo_de_fabrica(sessao, chave: str) -> Cargo:
    cargo = sessao.scalar(select(Cargo).where(Cargo.chave == chave))
    if cargo is None:  # pragma: no cover - a migração cria os de fábrica
        raise RuntimeError(f"cargo de fábrica ausente: {chave}")
    return cargo


def _cargo_do_papel(sessao, papel: Papel | None, atual: Cargo | None) -> Cargo | None:
    """O papel antigo: "admin" é o Administrador; "atendente" é "não
    Administrador" (quem já não é admin continua no cargo que tem)."""
    if papel is None:
        return None
    if papel == Papel.ADMIN:
        return _cargo_de_fabrica(sessao, perm.ADMINISTRADOR)
    if atual is not None and not atual.e_administrador:
        return atual
    return _cargo_de_fabrica(sessao, perm.COLABORADOR)


def _setor_pedido(sessao, dados, campos: set[str]) -> dict | None:
    """O setor pedido, SEM lançar erro (as permissões vêm antes): None = não
    pediu; {"vazio"}; {"setor": Setor}; {"novo": nome}; {"inexistente"}."""
    if "setor_id" in campos:
        if dados.setor_id is None:
            return {"vazio": True}
        setor = sessao.get(Setor, dados.setor_id)
        return {"setor": setor} if setor is not None else {"inexistente": True}
    if "setor" not in campos:
        return None
    texto = svc_setores.espacos(dados.setor or "")
    if not texto:
        return {"vazio": True}
    setor = svc_setores.por_nome(sessao, texto)
    return {"setor": setor} if setor is not None else {"novo": texto[: svc_setores.MAX_NOME]}


def _id_do_pedido(pedido: dict):
    """O setor_id que o pedido deixaria (False = um setor que ainda não existe)."""
    if "setor" in pedido:
        return pedido["setor"].id
    return None if "vazio" in pedido else False


def _confirmar_setor(sessao, eu: Atendente, pedido: dict, atual: int | None) -> Setor | None:
    """Depois das permissões: o setor de verdade (404 / 422 / cria o novo)."""
    if "vazio" in pedido:
        return None
    if "novo" in pedido:
        if not perm.tem(eu, "setores.gerenciar"):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "setor nao encontrado")
        return svc_setores.criar(sessao, pedido["novo"])
    setor = pedido.get("setor")
    if setor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "setor nao encontrado")
    if not setor.ativo and setor.id != atual:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, SETOR_INATIVO)
    return setor


@rotas.get("", response_model=list[AtendenteSaida])
def listar(sessao: Sessao, _: Annotated[Atendente, com_permissao("equipe.ver")]) -> list[Atendente]:
    return list(sessao.scalars(select(Atendente).order_by(Atendente.nome, Atendente.id)))


@rotas.post("", response_model=AtendenteSaida, status_code=status.HTTP_201_CREATED)
def criar(
    dados: AtendenteEntrada, sessao: Sessao, eu: Annotated[Atendente, com_permissao("equipe.gerenciar")]
) -> Atendente:
    campos = dados.model_fields_set
    # cargo: sem escolha, o Colaborador; escolher outro é definir cargo
    colaborador = _cargo_de_fabrica(sessao, perm.COLABORADOR)
    if dados.cargo_id is not None:
        cargo = sessao.get(Cargo, dados.cargo_id)
        if cargo is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "cargo nao encontrado")
    else:
        cargo = _cargo_do_papel(sessao, dados.papel, None) or colaborador
    if cargo.id != colaborador.id:
        hierarquia.exigir_conceder(eu, cargo)
    else:
        hierarquia.exigir_nivel_abaixo(eu, cargo)

    # setor: quem não define setor cadastra no PRÓPRIO (é o líder da equipe)
    pedido = _setor_pedido(sessao, dados, campos)
    if perm.tem(eu, "equipe.definir_setor"):
        setor = _confirmar_setor(sessao, eu, pedido, None) if pedido is not None else None
    else:
        if pedido is not None and _id_do_pedido(pedido) != eu.setor_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, perm.mensagem("equipe.definir_setor"))
        setor = sessao.get(Setor, eu.setor_id) if eu.setor_id is not None else None

    if sessao.scalar(select(Atendente).where(func.lower(Atendente.email) == dados.email.lower())):
        raise HTTPException(status.HTTP_409_CONFLICT, EMAIL_REPETIDO)
    atendente = Atendente(
        nome=dados.nome,
        email=dados.email.lower(),
        senha_hash=gerar_hash_senha(dados.senha),
        papel=Papel.ADMIN.value if cargo.e_administrador else Papel.ATENDENTE.value,
        cargo_id=cargo.id,
        disponivel=dados.disponivel,
        setor_id=setor.id if setor else None,
        setor=setor.nome if setor else None,
    )
    sessao.add(atendente)
    # commit ANTES da resposta: a dependência (escopo "request" do FastAPI)
    # só confirma depois de a resposta sair, e o próximo pedido do navegador
    # podia chegar antes e não ver o dado
    sessao.commit()
    chat_interno.sincronizar_sem_falhar(sessao)
    sessao.refresh(atendente)
    return atendente


@rotas.patch("/{atendente_id}", response_model=AtendenteSaida)
def atualizar(atendente_id: int, dados: AtendenteAtualizacao, sessao: Sessao, eu: AtendenteAtual) -> Atendente:
    """Só o que mudou de verdade conta: mandar o nome igual ao atual (um
    formulário que reenvia tudo) não exige permissão de gerenciar. As
    permissões são conferidas ANTES de procurar o cargo ou o setor pedido:
    quem não pode mexer recebe 403, não descobre o que existe."""
    alvo = sessao.get(Atendente, atendente_id)
    if alvo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "atendente nao encontrado")
    campos = dados.model_fields_set
    cargo_atual = alvo.cargo

    muda_nome = dados.nome is not None and dados.nome != alvo.nome
    muda_ativo = dados.ativo is not None and dados.ativo != bool(alvo.ativo)
    if dados.cargo_id is not None:  # inexistente conta como mudança: 403 antes do 404
        cargo = sessao.get(Cargo, dados.cargo_id)
        muda_cargo = cargo is None or cargo.id != cargo_atual.id
    else:
        cargo = _cargo_do_papel(sessao, dados.papel, cargo_atual)
        muda_cargo = cargo is not None and cargo.id != cargo_atual.id
    pedido = _setor_pedido(sessao, dados, campos)
    muda_setor = pedido is not None and _id_do_pedido(pedido) != alvo.setor_id

    proprio = alvo.id == eu.id
    if muda_nome or muda_ativo or muda_cargo or muda_setor:
        if proprio:
            # nome, setor, cargo e acesso são de quem gerencia; o
            # Administrador é o único que se gerencia
            if not eu.e_admin:
                raise HTTPException(status.HTTP_403_FORBIDDEN, hierarquia.PROPRIO_PERFIL)
        else:
            hierarquia.exigir_gerenciar(eu, alvo)
    elif not proprio and (dados.senha is not None or dados.disponivel is not None):
        # senha e disponibilidade de OUTRA pessoa também são gestão
        hierarquia.exigir_gerenciar(eu, alvo)
    if muda_cargo:
        if cargo is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "cargo nao encontrado")
        hierarquia.exigir_conceder(eu, cargo)
    setor = None
    if muda_setor:
        perm.exigir(eu, "equipe.definir_setor")
        setor = _confirmar_setor(sessao, eu, pedido, alvo.setor_id)

    # perder o último Administrador ativo trancaria o sistema: a conferência
    # e a gravação vão juntas, travando os administradores (hierarquia)
    if cargo_atual.e_administrador and alvo.ativo and (
        (muda_ativo and dados.ativo is False) or (muda_cargo and not cargo.e_administrador)
    ):
        hierarquia.exigir_outro_administrador(sessao, alvo.id)

    if muda_nome:
        alvo.nome = dados.nome
    if dados.senha is not None:
        alvo.senha_hash = gerar_hash_senha(dados.senha)
    if muda_cargo:
        alvo.cargo_id = cargo.id
        alvo.papel = Papel.ADMIN.value if cargo.e_administrador else Papel.ATENDENTE.value
    if muda_ativo:
        alvo.ativo = dados.ativo
    if dados.disponivel is not None:
        alvo.disponivel = dados.disponivel
    if muda_setor:
        alvo.setor_id = setor.id if setor else None
        alvo.setor = setor.nome if setor else None
    sessao.commit()  # antes da resposta (ver criar)
    if muda_ativo or muda_setor or muda_cargo:
        chat_interno.sincronizar_sem_falhar(sessao)
    sessao.refresh(alvo)
    return alvo

"""As regras de hierarquia, conferidas no servidor (as mesmas de
php/app/Equipe/Hierarquia.php). O painel esconde o que a pessoa não pode, mas
quem decide é daqui:

- ninguém gerencia quem tem nível igual ou maior que o seu, e ninguém concede
  cargo de nível igual ou maior que o seu (o Administrador passa por cima);
- quem não pode definir setor só gerencia gente do PRÓPRIO setor (é o líder
  de uma equipe: cadastra no setor dele e cuida de quem está nele);
- ninguém cria ou edita cargo com permissão que ele próprio não tem, nem mexe
  em cargo de nível igual ou maior que o seu; o cargo Administrador não se
  edita (tem tudo, sempre);
- sempre sobra pelo menos um Administrador ativo;
- no próprio perfil, cada um só troca a senha e a disponibilidade: nome,
  setor e cargo são de quem gerencia (antes o próprio atendente trocava o
  setor e passava a ver a sala de outro setor no chat).
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from .. import permissoes as perm
from ..models import Atendente, Cargo, Papel

SO_ABAIXO = "você só gerencia pessoas de cargo abaixo do seu"
CONCEDER_ABAIXO = "você só pode conceder cargos abaixo do seu"
SO_SEU_SETOR = "você só gerencia pessoas do seu setor"
PROPRIO_PERFIL = "no próprio perfil você só altera a senha e a disponibilidade"
ULTIMO_ADMIN = "é preciso manter pelo menos um Administrador ativo"
CARGO_ADMIN_TRAVADO = "o cargo Administrador não pode ser alterado"
CARGO_ACIMA = "você só gerencia cargos abaixo do seu"
CARGO_DE_FABRICA = "cargo de fábrica não pode ser apagado"
PERMISSAO_QUE_NAO_TEM = "você não pode dar a um cargo permissões que você não tem"


def _proibido(frase: str) -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, frase)


def exigir_gerenciar(eu: Atendente, alvo: Atendente) -> None:
    """eu pode editar/desativar alvo (outra pessoa)?"""
    perm.exigir(eu, "equipe.gerenciar")
    if eu.e_admin:
        return
    if alvo.nivel >= eu.nivel:
        raise _proibido(SO_ABAIXO)
    if not perm.tem(eu, "equipe.definir_setor") and alvo.setor_id != eu.setor_id:
        raise _proibido(SO_SEU_SETOR)


def exigir_conceder(eu: Atendente, cargo: Cargo) -> None:
    """eu pode dar o cargo a alguém?"""
    perm.exigir(eu, "equipe.definir_cargo")
    exigir_nivel_abaixo(eu, cargo)


def exigir_nivel_abaixo(eu: Atendente, cargo: Cargo) -> None:
    """O cargo cabe abaixo de quem dá? (quem não define cargo só cadastra com
    o padrão, e mesmo assim o nível dele precisa ficar abaixo do seu)"""
    if not eu.e_admin and cargo.nivel >= eu.nivel:
        raise _proibido(CONCEDER_ABAIXO)


def exigir_outro_administrador(sessao: Session, alvo_id: int) -> None:
    """Antes de desativar ou tirar o cargo de um Administrador ativo: sobra
    outro? As linhas dos administradores ficam travadas até o fim da
    transação (FOR UPDATE onde o banco tem): duas pessoas rebaixando uma à
    outra ao mesmo tempo não deixam o sistema sem ninguém."""
    admin = sessao.scalar(select(Cargo).where(Cargo.chave == perm.ADMINISTRADOR))
    condicao = and_(Atendente.cargo_id.is_(None), Atendente.papel == Papel.ADMIN.value)
    if admin is not None:
        condicao = or_(Atendente.cargo_id == admin.id, condicao)
    outros = sessao.scalars(
        select(Atendente.id)
        .where(Atendente.ativo.is_(True), Atendente.id != alvo_id, condicao)
        .with_for_update()
    ).all()
    if not outros:
        raise _proibido(ULTIMO_ADMIN)


# ---------------------------------------------------------------- cargos
def exigir_gerenciar_cargo(eu: Atendente, cargo: Cargo) -> None:
    perm.exigir(eu, "cargos.gerenciar")
    if cargo.e_administrador:
        raise _proibido(CARGO_ADMIN_TRAVADO)
    exigir_nivel_de_cargo(eu, cargo.nivel)


def exigir_nivel_de_cargo(eu: Atendente, nivel: int) -> None:
    """O nível (novo ou atual) de um cargo precisa ficar abaixo do de quem mexe."""
    if not eu.e_admin and nivel >= eu.nivel:
        raise _proibido(CARGO_ACIMA)


def exigir_permissoes_que_tem(eu: Atendente, permissoes: list[str]) -> None:
    """Ninguém entrega a um cargo o que não tem (senão criaria um cargo mais
    poderoso que o próprio e o daria a alguém de confiança)."""
    if eu.e_admin:
        return
    minhas = set(eu.permissoes)
    faltam = [p for p in permissoes if p not in minhas]
    if faltam:
        raise _proibido(f"{PERMISSAO_QUE_NAO_TEM}: {', '.join(faltam)}")

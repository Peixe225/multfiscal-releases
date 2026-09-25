"""Chat interno da equipe: salas, membros, mensagens e quem pode ver o quê.

Os atendentes conversam entre si sem misturar com os clientes. Quatro tipos
de sala (models.TipoSala):

  geral   todos os atendentes ativos; uma só (chave "geral");
  setor   uma por setor do perfil (chave "setor:<hash do setor normalizado>");
  direta  uma por par de atendentes (chave "direta:<menor id>:<maior id>");
  grupo   criado por qualquer atendente com os membros escolhidos; quem cria
          administra (renomeia, põe e tira gente), e o admin do sistema também.

Geral e setores não têm cadastro: são SINCRONIZADAS no começo de toda chamada
a /api/interno, a partir de atendentes.ativo e atendentes.setor. Mudou o setor
no perfil ou alguém foi desativado, a próxima chamada de qualquer pessoa
acerta os membros; e como nenhuma mensagem entra numa sala sem passar por
essa conferência antes, o evento de uma sala nunca vai para quem já saiu dela.

Privacidade: só membro lê ou escreve; para quem não é, a sala (e a mensagem)
não existe: 404, sem revelar nada. Os eventos "interno.*" levam o sala_id e
o filtro de app/api/eventos.py só os entrega a membros; os que são de uma
pessoa só (cursor de leitura, "você saiu") levam "para": [ids].

Mesmo contrato no PHP (php/app/ChatInterno). Formatos de saída neste arquivo.
"""
from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from datetime import datetime

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import SessaoLocal
from ..models import (
    Atendente,
    Canal,
    Contato,
    Conversa,
    FilaEvento,
    MembroSala,
    MensagemInterna,
    SalaInterna,
    TipoSala,
    agora,
)

NOME_GERAL = "Geral"
CHAVE_GERAL = "geral"
MAX_CONTEUDO = 4000
MAX_NOME_GRUPO = 80
MAX_MEMBROS = 200
LIMITE_PADRAO = 50
LIMITE_MAXIMO = 100
# ids aceitos na rota e no corpo: o mesmo teto do PHP (18 dígitos); acima
# disso o banco estouraria o inteiro de 64 bits e sairia 500 em vez de 422
MAIOR_ID = 10**18 - 1
TENTATIVAS = 3

Evento = tuple[str, dict]


# -------------------------------------------------------------------- saídas
class AtendenteResumo(BaseModel):
    id: int
    nome: str
    setor: str | None = None
    ativo: bool
    disponivel: bool


class AutorResumo(BaseModel):
    id: int
    nome: str
    setor: str | None = None


class ConversaCartao(BaseModel):
    """O que o cartão de "conversa de cliente" mostra; o clique abre a conversa."""

    id: int
    contato: str
    canal_tipo: str
    canal_nome: str
    status: str
    assunto: str | None = None


class MensagemInternaSaida(BaseModel):
    id: int
    sala_id: int
    autor: AutorResumo | None = None
    conteudo: str
    mencoes: list[int]
    conversa_id: int | None = None
    conversa: ConversaCartao | None = None
    criada_em: datetime
    editada_em: datetime | None = None
    apagada: bool


class SalaSaida(BaseModel):
    id: int
    tipo: str
    nome: str
    setor: str | None = None
    com: AtendenteResumo | None = None  # na direta: a outra pessoa
    criada_por: int | None = None
    administrador: bool  # quem pede pode renomear e mexer nos membros (grupo)
    total_membros: int
    nao_lidas: int
    lida_ate: int
    silenciada: bool
    ultima_mensagem: MensagemInternaSaida | None = None
    atualizada_em: datetime


class SalaDetalhe(SalaSaida):
    membros: list[AtendenteResumo]


class PaginaMensagens(BaseModel):
    mensagens: list[MensagemInternaSaida]
    tem_mais: bool


class LidaSaida(BaseModel):
    sala_id: int
    lida_ate: int
    nao_lidas: int


def _json(modelo: BaseModel) -> dict:
    return modelo.model_dump(mode="json")


# ------------------------------------------------------------------- chaves
def normalizar_setor(setor: str | None) -> str:
    """"  Suporte   Técnico " e "suporte técnico" são o mesmo setor."""
    return " ".join((setor or "").split()).lower()


def chave_setor(setor: str | None) -> str | None:
    """Hash, e não o texto: a chave é única no banco, e o MySQL com colação
    *_ci acharia "Implantação" igual a "Implantacao" (outro setor aqui)."""
    normal = normalizar_setor(setor)
    if not normal:
        return None
    return "setor:" + hashlib.sha256(normal.encode()).hexdigest()[:40]


def chave_direta(a: int, b: int) -> str:
    menor, maior = sorted((int(a), int(b)))
    return f"direta:{menor}:{maior}"


# ------------------------------------------------------------ sincronização
def sincronizar(sessao: Session) -> None:
    """Acerta Geral e setores com os atendentes de agora (idempotente).

    Duas chamadas simultâneas podem tentar criar a mesma sala ou o mesmo
    membro: a segunda esbarra na unicidade, desfaz e confere de novo (aí já
    vê o que a outra gravou). Confirma e publica só quando muda algo.
    """
    for tentativa in range(TENTATIVAS):
        try:
            mudancas = _sincronizar(sessao)
            if mudancas:
                sessao.commit()
            break
        except IntegrityError:
            sessao.rollback()
            if tentativa == TENTATIVAS - 1:
                raise
    publicar(mudancas)


def _sincronizar(sessao: Session) -> list[Evento]:
    momento = agora()
    ativos = sessao.execute(
        select(Atendente.id, Atendente.setor).where(Atendente.ativo.is_(True)).order_by(Atendente.id)
    ).all()
    automaticas = {
        s.chave: s
        for s in sessao.scalars(
            select(SalaInterna).where(SalaInterna.tipo.in_([TipoSala.GERAL.value, TipoSala.SETOR.value]))
        )
    }

    def sala_automatica(chave: str, tipo: TipoSala, nome: str, setor: str | None) -> SalaInterna:
        sala = automaticas.get(chave)
        if sala is None:
            sala = SalaInterna(
                tipo=tipo.value, nome=nome, setor=setor, chave=chave, criada_em=momento, atualizada_em=momento
            )
            sessao.add(sala)
            sessao.flush()
            automaticas[chave] = sala
        return sala

    geral = sala_automatica(CHAVE_GERAL, TipoSala.GERAL, NOME_GERAL, None)
    esperado: set[tuple[int, int]] = set()
    for atendente_id, setor in ativos:
        esperado.add((geral.id, atendente_id))
        chave = chave_setor(setor)
        if chave is not None:
            # o primeiro atendente (menor id) dá o nome de exibição da sala
            exibicao = " ".join(setor.split())[:80]
            esperado.add((sala_automatica(chave, TipoSala.SETOR, exibicao, exibicao).id, atendente_id))

    ids_salas = [s.id for s in automaticas.values()]
    atuais = {
        (sala_id, atendente_id)
        for sala_id, atendente_id in sessao.execute(
            select(MembroSala.sala_id, MembroSala.atendente_id).where(MembroSala.sala_id.in_(ids_salas))
        )
    }
    faltam = sorted(esperado - atuais)
    sobram = sorted(atuais - esperado)
    if faltam:
        # quem entra vê o histórico, mas o que veio antes não conta como não lido
        ultimas = _ultimas_ids(sessao, {sala_id for sala_id, _ in faltam})
        for sala_id, atendente_id in faltam:
            sessao.add(
                MembroSala(
                    sala_id=sala_id,
                    atendente_id=atendente_id,
                    lida_ate=ultimas.get(sala_id, 0),
                    silenciada=False,
                    entrou_em=momento,
                )
            )
    for sala_id, atendente_id in sobram:
        sessao.execute(
            delete(MembroSala).where(MembroSala.sala_id == sala_id, MembroSala.atendente_id == atendente_id)
        )
    if faltam or sobram:
        sessao.flush()
    return [
        ("interno.sala", {"sala_id": sala_id, "acao": "entrou", "para": [atendente_id]})
        for sala_id, atendente_id in faltam
    ] + [
        ("interno.sala", {"sala_id": sala_id, "acao": "saiu", "para": [atendente_id]})
        for sala_id, atendente_id in sobram
    ]


def _ultimas_ids(sessao: Session, salas: set[int]) -> dict[int, int]:
    if not salas:
        return {}
    return {
        sala_id: int(maior or 0)
        for sala_id, maior in sessao.execute(
            select(MensagemInterna.sala_id, func.max(MensagemInterna.id))
            .where(MensagemInterna.sala_id.in_(list(salas)))
            .group_by(MensagemInterna.sala_id)
        )
    }


# ------------------------------------------------------------------ acesso
def ids_das_salas(atendente_id: int) -> set[int]:
    """Salas de que a pessoa é membro agora (o filtro dos eventos usa)."""
    with SessaoLocal() as sessao:
        return set(sessao.scalars(select(MembroSala.sala_id).where(MembroSala.atendente_id == atendente_id)))


def exigir_sala(sessao: Session, sala_id: int, atendente: Atendente) -> tuple[SalaInterna, MembroSala]:
    """A sala e o vínculo de quem pede; quem não é membro recebe 404."""
    linha = sessao.execute(
        select(SalaInterna, MembroSala)
        .join(MembroSala, MembroSala.sala_id == SalaInterna.id)
        .where(SalaInterna.id == sala_id, MembroSala.atendente_id == atendente.id)
    ).first()
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sala não encontrada")
    return linha[0], linha[1]


def exigir_mensagem(
    sessao: Session, mensagem_id: int, atendente: Atendente
) -> tuple[MensagemInterna, SalaInterna, MembroSala]:
    mensagem = sessao.get(MensagemInterna, mensagem_id)
    if mensagem is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "mensagem não encontrada")
    try:
        sala, membro = exigir_sala(sessao, mensagem.sala_id, atendente)
    except HTTPException:
        # de outra sala: não confirma nem que a mensagem existe
        raise HTTPException(status.HTTP_404_NOT_FOUND, "mensagem não encontrada") from None
    return mensagem, sala, membro


def pode_administrar(sala: SalaInterna, atendente: Atendente) -> bool:
    return sala.tipo == TipoSala.GRUPO.value and (sala.criada_por == atendente.id or atendente.e_admin)


# ----------------------------------------------------------- serialização
def _resumo(atendente: Atendente) -> AtendenteResumo:
    return AtendenteResumo(
        id=atendente.id,
        nome=atendente.nome,
        setor=atendente.setor or None,
        ativo=bool(atendente.ativo),
        disponivel=bool(atendente.disponivel),
    )


def mensagens_saida(sessao: Session, mensagens: list[MensagemInterna]) -> list[MensagemInternaSaida]:
    """Em lote: uma consulta para os autores e uma para as conversas."""
    ids_autores = {m.autor_id for m in mensagens if m.autor_id}
    autores = (
        {a.id: a for a in sessao.scalars(select(Atendente).where(Atendente.id.in_(list(ids_autores))))}
        if ids_autores
        else {}
    )
    ids_conversas = {m.conversa_id for m in mensagens if m.conversa_id and not m.apagada}
    cartoes: dict[int, ConversaCartao] = {}
    if ids_conversas:
        for conversa_id, conversa_status, assunto, contato, canal_tipo, canal_nome in sessao.execute(
            select(Conversa.id, Conversa.status, Conversa.assunto, Contato.nome, Canal.tipo, Canal.nome)
            .join(Contato, Contato.id == Conversa.contato_id)
            .join(Canal, Canal.id == Conversa.canal_id)
            .where(Conversa.id.in_(list(ids_conversas)))
        ):
            cartoes[conversa_id] = ConversaCartao(
                id=conversa_id,
                contato=contato,
                canal_tipo=canal_tipo,
                canal_nome=canal_nome,
                status=conversa_status,
                assunto=assunto or None,
            )
    saida = []
    for m in mensagens:
        autor = autores.get(m.autor_id) if m.autor_id else None
        cartao = cartoes.get(m.conversa_id) if m.conversa_id and not m.apagada else None
        saida.append(
            MensagemInternaSaida(
                id=m.id,
                sala_id=m.sala_id,
                autor=AutorResumo(id=autor.id, nome=autor.nome, setor=autor.setor or None) if autor else None,
                conteudo="" if m.apagada else m.conteudo,
                mencoes=[] if m.apagada else list(m.mencoes or []),
                conversa_id=cartao.id if cartao else None,
                conversa=cartao,
                criada_em=m.criada_em,
                editada_em=m.editada_em,
                apagada=bool(m.apagada),
            )
        )
    return saida


def mensagem_saida(sessao: Session, mensagem: MensagemInterna) -> MensagemInternaSaida:
    return mensagens_saida(sessao, [mensagem])[0]


_ORDEM_TIPO = {TipoSala.GERAL.value: 0, TipoSala.SETOR.value: 1, TipoSala.GRUPO.value: 2, TipoSala.DIRETA.value: 3}


def salas_saida(
    sessao: Session, linhas: list[tuple[SalaInterna, MembroSala]], atendente: Atendente
) -> list[SalaSaida]:
    """SalaSaida de cada (sala, vínculo), com contagens em lote.

    Ordem: Geral, setores (por nome), grupos e diretas (a mais recente
    primeiro). O painel agrupa por tipo; a ordem só evita pular na tela.
    """
    if not linhas:
        return []
    ids = [sala.id for sala, _ in linhas]
    totais = dict(
        sessao.execute(
            select(MembroSala.sala_id, func.count())
            .join(Atendente, Atendente.id == MembroSala.atendente_id)
            .where(MembroSala.sala_id.in_(ids), Atendente.ativo.is_(True))
            .group_by(MembroSala.sala_id)
        ).all()
    )
    nao_lidas = dict(
        sessao.execute(
            select(MensagemInterna.sala_id, func.count())
            .join(
                MembroSala,
                and_(MembroSala.sala_id == MensagemInterna.sala_id, MembroSala.atendente_id == atendente.id),
            )
            .where(
                MensagemInterna.sala_id.in_(ids),
                MensagemInterna.id > MembroSala.lida_ate,
                or_(MensagemInterna.autor_id.is_(None), MensagemInterna.autor_id != atendente.id),
                MensagemInterna.apagada.is_(False),
            )
            .group_by(MensagemInterna.sala_id)
        ).all()
    )
    ultimas_ids = _ultimas_ids(sessao, set(ids))
    ultimas = {}
    if ultimas_ids:
        mensagens = list(
            sessao.scalars(select(MensagemInterna).where(MensagemInterna.id.in_(list(ultimas_ids.values()))))
        )
        ultimas = {s.sala_id: s for s in mensagens_saida(sessao, mensagens)}
    diretas = [sala.id for sala, _ in linhas if sala.tipo == TipoSala.DIRETA.value]
    outros: dict[int, Atendente] = {}
    if diretas:
        for sala_id, pessoa in sessao.execute(
            select(MembroSala.sala_id, Atendente)
            .join(Atendente, Atendente.id == MembroSala.atendente_id)
            .where(MembroSala.sala_id.in_(diretas), MembroSala.atendente_id != atendente.id)
        ):
            outros[sala_id] = pessoa

    saida = []
    for sala, membro in linhas:
        com = outros.get(sala.id)
        if sala.tipo == TipoSala.DIRETA.value:
            nome = com.nome if com else "Conversa direta"
        else:
            nome = sala.nome or NOME_GERAL
        saida.append(
            SalaSaida(
                id=sala.id,
                tipo=sala.tipo,
                nome=nome,
                setor=sala.setor if sala.tipo == TipoSala.SETOR.value else None,
                com=_resumo(com) if com else None,
                criada_por=sala.criada_por if sala.tipo == TipoSala.GRUPO.value else None,
                administrador=pode_administrar(sala, atendente),
                total_membros=int(totais.get(sala.id, 0)),
                nao_lidas=int(nao_lidas.get(sala.id, 0)),
                lida_ate=int(membro.lida_ate or 0),
                silenciada=bool(membro.silenciada),
                ultima_mensagem=ultimas.get(sala.id),
                atualizada_em=sala.atualizada_em,
            )
        )
    saida.sort(
        key=lambda s: (
            _ORDEM_TIPO.get(s.tipo, 9),
            s.nome.lower() if s.tipo == TipoSala.SETOR.value else "",
            -s.atualizada_em.timestamp() if s.tipo in (TipoSala.GRUPO.value, TipoSala.DIRETA.value) else 0,
            s.id,
        )
    )
    return saida


def listar_salas(sessao: Session, atendente: Atendente) -> list[SalaSaida]:
    linhas = sessao.execute(
        select(SalaInterna, MembroSala)
        .join(MembroSala, MembroSala.sala_id == SalaInterna.id)
        .where(MembroSala.atendente_id == atendente.id)
    ).all()
    return salas_saida(sessao, [(s, m) for s, m in linhas], atendente)


def sala_detalhe(sessao: Session, sala: SalaInterna, membro: MembroSala, atendente: Atendente) -> SalaDetalhe:
    base = salas_saida(sessao, [(sala, membro)], atendente)[0]
    membros = sessao.scalars(
        select(Atendente)
        .join(MembroSala, MembroSala.atendente_id == Atendente.id)
        .where(MembroSala.sala_id == sala.id)
        .order_by(Atendente.nome, Atendente.id)
    )
    return SalaDetalhe(**base.model_dump(), membros=[_resumo(a) for a in membros])


# --------------------------------------------------------------- mensagens
def pagina(sessao: Session, sala: SalaInterna, antes: int | None, limite: int) -> PaginaMensagens:
    consulta = select(MensagemInterna).where(MensagemInterna.sala_id == sala.id)
    if antes is not None:
        consulta = consulta.where(MensagemInterna.id < antes)
    linhas = list(sessao.scalars(consulta.order_by(MensagemInterna.id.desc()).limit(limite + 1)))
    tem_mais = len(linhas) > limite
    linhas = list(reversed(linhas[:limite]))
    return PaginaMensagens(mensagens=mensagens_saida(sessao, linhas), tem_mais=tem_mais)


def _padrao_nome(nome: str) -> str:
    # espaços do nome casam com qualquer espaço digitado; "@" sem letra antes
    # (e-mail não menciona) e sem letra depois ("@Ana" não casa "@Anabela")
    partes = [re.escape(parte) for parte in nome.split()]
    return r"(?<!\w)@" + r"\s+".join(partes) + r"(?!\w)"


def resolver_mencoes(conteudo: str, candidatos: list[tuple[int, str]], autor_id: int | None) -> list[int]:
    """Ids mencionados por @Nome Completo, ou por @Primeiro nome quando só
    um membro da sala tem esse primeiro nome. Só membros ativos da sala
    (menção a quem não vai ler não avisa ninguém); nunca o próprio autor."""
    if "@" not in conteudo:
        return []
    primeiros = Counter(nome.split()[0].lower() for _, nome in candidatos if nome.split())
    achados: set[int] = set()
    for atendente_id, nome in candidatos:
        if atendente_id == autor_id or not nome.split():
            continue
        if re.search(_padrao_nome(nome), conteudo, re.IGNORECASE):
            achados.add(atendente_id)
            continue
        primeiro = nome.split()[0]
        if primeiros[primeiro.lower()] == 1 and re.search(_padrao_nome(primeiro), conteudo, re.IGNORECASE):
            achados.add(atendente_id)
    return sorted(achados)


def _candidatos(sessao: Session, sala_id: int) -> list[tuple[int, str]]:
    return [
        (atendente_id, nome)
        for atendente_id, nome in sessao.execute(
            select(Atendente.id, Atendente.nome)
            .join(MembroSala, MembroSala.atendente_id == Atendente.id)
            .where(MembroSala.sala_id == sala_id, Atendente.ativo.is_(True))
            .order_by(Atendente.id)
        )
    ]


def _aparar(conteudo: str | None) -> str:
    return (conteudo or "").strip()


def exigir_conversa(sessao: Session, conversa_id: int | None) -> int | None:
    if conversa_id is None:
        return None
    if sessao.get(Conversa, conversa_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversa nao encontrada")
    return conversa_id


def enviar(
    sessao: Session,
    sala: SalaInterna,
    membro: MembroSala,
    atendente: Atendente,
    conteudo: str | None,
    conversa_id: int | None,
) -> tuple[MensagemInternaSaida, list[Evento]]:
    texto = _aparar(conteudo)
    conversa_id = exigir_conversa(sessao, conversa_id)
    if not texto and conversa_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "conteudo: não pode ficar vazio")
    momento = agora()
    mensagem = MensagemInterna(
        sala_id=sala.id,
        autor_id=atendente.id,
        conteudo=texto,
        mencoes=resolver_mencoes(texto, _candidatos(sessao, sala.id), atendente.id),
        conversa_id=conversa_id,
        criada_em=momento,
        apagada=False,
    )
    sessao.add(mensagem)
    sessao.flush()
    sala.atualizada_em = momento
    membro.lida_ate = max(int(membro.lida_ate or 0), mensagem.id)  # a própria mensagem já está lida
    sessao.flush()
    saida = mensagem_saida(sessao, mensagem)
    return saida, [("interno.mensagem", _json(saida))]


def editar(
    sessao: Session, mensagem: MensagemInterna, atendente: Atendente, conteudo: str | None
) -> tuple[MensagemInternaSaida, list[Evento]]:
    if mensagem.autor_id != atendente.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "só quem escreveu pode editar a mensagem")
    if mensagem.apagada:
        raise HTTPException(status.HTTP_409_CONFLICT, "mensagem apagada não pode ser editada")
    texto = _aparar(conteudo)
    if not texto and mensagem.conversa_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "conteudo: não pode ficar vazio")
    mensagem.conteudo = texto
    mensagem.mencoes = resolver_mencoes(texto, _candidatos(sessao, mensagem.sala_id), atendente.id)
    mensagem.editada_em = agora()
    sessao.flush()
    saida = mensagem_saida(sessao, mensagem)
    _sanear_fila(sessao, mensagem, _json(saida))
    return saida, [("interno.mensagem.atualizada", _json(saida))]


def apagar(
    sessao: Session, mensagem: MensagemInterna, atendente: Atendente
) -> tuple[MensagemInternaSaida, list[Evento]]:
    if mensagem.autor_id != atendente.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "só quem escreveu pode apagar a mensagem")
    if not mensagem.apagada:
        # o texto sai do banco de verdade; fica só o lugar ("mensagem apagada")
        mensagem.apagada = True
        mensagem.conteudo = ""
        mensagem.mencoes = []
        mensagem.conversa_id = None
        mensagem.editada_em = agora()
        sessao.flush()
    saida = mensagem_saida(sessao, mensagem)
    _sanear_fila(sessao, mensagem, _json(saida))
    return saida, [("interno.mensagem.atualizada", _json(saida))]


TIPOS_DE_MENSAGEM = ("interno.mensagem", "interno.mensagem.atualizada")


def _sanear_fila(sessao: Session, mensagem: MensagemInterna, atual: dict) -> None:
    """Troca, nos eventos já gravados desta mensagem, o texto velho pelo atual.

    A fila guarda os eventos por 48 h, e quem relê a partir de um cursor
    antigo leria de novo o texto apagado (ou o de antes da edição). Só olha
    os eventos do chat criados depois da mensagem; é raro (editar, apagar).
    """
    novo = json.dumps(atual, ensure_ascii=False)
    for evento_id, dados in sessao.execute(
        select(FilaEvento.id, FilaEvento.dados).where(
            FilaEvento.tipo.in_(TIPOS_DE_MENSAGEM), FilaEvento.criado_em >= mensagem.criada_em
        )
    ):
        try:
            lido = json.loads(dados)
        except (TypeError, ValueError):
            continue
        if isinstance(lido, dict) and lido.get("id") == mensagem.id and lido.get("sala_id") == mensagem.sala_id:
            sessao.execute(update(FilaEvento).where(FilaEvento.id == evento_id).values(dados=novo))


def marcar_lida(
    sessao: Session, sala: SalaInterna, membro: MembroSala, atendente: Atendente, ate: int | None
) -> tuple[LidaSaida, list[Evento]]:
    """O cursor só anda para a frente e nunca passa da última mensagem."""
    ultima = _ultimas_ids(sessao, {sala.id}).get(sala.id, 0)
    alvo = ultima if ate is None else min(int(ate), ultima)
    eventos: list[Evento] = []
    if alvo > int(membro.lida_ate or 0):
        membro.lida_ate = alvo
        sessao.flush()
        # só para a própria pessoa: as outras abas dela zeram o contador
        eventos.append(("interno.lida", {"sala_id": sala.id, "lida_ate": alvo, "para": [atendente.id]}))
    restantes = sessao.scalar(
        select(func.count())
        .select_from(MensagemInterna)
        .where(
            MensagemInterna.sala_id == sala.id,
            MensagemInterna.id > membro.lida_ate,
            or_(MensagemInterna.autor_id.is_(None), MensagemInterna.autor_id != atendente.id),
            MensagemInterna.apagada.is_(False),
        )
    )
    return LidaSaida(sala_id=sala.id, lida_ate=int(membro.lida_ate), nao_lidas=int(restantes or 0)), eventos


# ------------------------------------------------------------ salas: gestão
def _ativos(sessao: Session, ids: list[int]) -> set[int]:
    if not ids:
        return set()
    return set(sessao.scalars(select(Atendente.id).where(Atendente.id.in_(ids), Atendente.ativo.is_(True))))


def _conferir_membros(sessao: Session, ids: list[int], campo: str) -> list[int]:
    unicos = sorted(set(ids))
    validos = _ativos(sessao, unicos)
    faltando = [i for i in unicos if i not in validos]
    if faltando:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"{campo}: atendente inexistente ou inativo: {', '.join(map(str, faltando))}",
        )
    return unicos


def _nome_grupo(nome: str | None) -> str:
    texto = " ".join((nome or "").split())
    if not texto:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "nome: não pode ficar vazio")
    if len(texto) > MAX_NOME_GRUPO:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"nome: pode ter no máximo {MAX_NOME_GRUPO} caracteres"
        )
    return texto


def criar_grupo(
    sessao: Session, atendente: Atendente, nome: str, membros: list[int]
) -> tuple[SalaDetalhe, list[Evento]]:
    nome = _nome_grupo(nome)
    ids = _conferir_membros(sessao, [i for i in membros if i != atendente.id], "membros")
    momento = agora()
    sala = SalaInterna(
        tipo=TipoSala.GRUPO.value,
        nome=nome,
        criada_por=atendente.id,
        criada_em=momento,
        atualizada_em=momento,
    )
    sessao.add(sala)
    sessao.flush()
    for atendente_id in [atendente.id, *ids]:
        sessao.add(MembroSala(sala_id=sala.id, atendente_id=atendente_id, lida_ate=0, entrou_em=momento))
    sessao.flush()
    membro = sessao.get(MembroSala, (sala.id, atendente.id))
    return sala_detalhe(sessao, sala, membro, atendente), [
        ("interno.sala", {"sala_id": sala.id, "acao": "criada"})
    ]


def abrir_direta(sessao: Session, atendente: Atendente, outro_id: int) -> tuple[SalaDetalhe, list[Evento]]:
    """A direta do par: devolve a que existe ou cria (uma só por par)."""
    if outro_id == atendente.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "escolha outra pessoa para a conversa direta")
    outro = sessao.get(Atendente, outro_id)
    if outro is None or not outro.ativo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "atendente nao encontrado")
    chave = chave_direta(atendente.id, outro.id)
    eventos: list[Evento] = []
    for tentativa in range(TENTATIVAS):
        sala = sessao.scalar(select(SalaInterna).where(SalaInterna.chave == chave))
        if sala is not None:
            break
        try:
            momento = agora()
            sala = SalaInterna(tipo=TipoSala.DIRETA.value, chave=chave, criada_em=momento, atualizada_em=momento)
            sessao.add(sala)
            sessao.flush()
            for atendente_id in (atendente.id, outro.id):
                sessao.add(MembroSala(sala_id=sala.id, atendente_id=atendente_id, lida_ate=0, entrou_em=momento))
            sessao.commit()  # a outra pessoa pode abrir a mesma direta agora mesmo
            eventos.append(("interno.sala", {"sala_id": sala.id, "acao": "criada"}))
            break
        except IntegrityError:
            # a outra pessoa criou no mesmo instante: usa a dela
            sessao.rollback()
            if tentativa == TENTATIVAS - 1:
                raise
    sala, membro = exigir_sala(sessao, sala.id, atendente)
    return sala_detalhe(sessao, sala, membro, atendente), eventos


def alterar_sala(
    sessao: Session,
    sala: SalaInterna,
    membro: MembroSala,
    atendente: Atendente,
    campos: set[str],
    silenciada: bool | None,
    nome: str | None,
    adicionar: list[int] | None,
    remover: list[int] | None,
) -> tuple[SalaDetalhe, list[Evento]]:
    eventos: list[Evento] = []
    if "silenciada" in campos and silenciada is not None and bool(membro.silenciada) != silenciada:
        membro.silenciada = silenciada
        eventos.append(("interno.sala", {"sala_id": sala.id, "acao": "atualizada", "para": [atendente.id]}))
    gestao = {"nome", "adicionar", "remover"} & campos
    if gestao:
        if sala.tipo != TipoSala.GRUPO.value:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "só grupos podem ser renomeados ou ter membros alterados")
        if not pode_administrar(sala, atendente):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "só quem administra o grupo pode alterá-lo")
        mudou = False
        if "nome" in campos:
            novo = _nome_grupo(nome)
            if novo != sala.nome:
                sala.nome = novo
                mudou = True
        atuais = set(sessao.scalars(select(MembroSala.atendente_id).where(MembroSala.sala_id == sala.id)))
        if adicionar:
            novos = [i for i in _conferir_membros(sessao, adicionar, "adicionar") if i not in atuais]
            if novos:
                ultima = _ultimas_ids(sessao, {sala.id}).get(sala.id, 0)
                for atendente_id in novos:
                    sessao.add(
                        MembroSala(sala_id=sala.id, atendente_id=atendente_id, lida_ate=ultima, entrou_em=agora())
                    )
                atuais |= set(novos)
                mudou = True
        if remover:
            tirar = sorted({i for i in remover if i in atuais and i != atendente.id})
            for atendente_id in tirar:
                sessao.execute(
                    delete(MembroSala).where(MembroSala.sala_id == sala.id, MembroSala.atendente_id == atendente_id)
                )
                eventos.append(("interno.sala", {"sala_id": sala.id, "acao": "saiu", "para": [atendente_id]}))
            if tirar:
                atuais -= set(tirar)
                mudou = True
                _passar_administracao(sessao, sala, atuais)
        if mudou:
            sala.atualizada_em = agora()
            eventos.append(("interno.sala", {"sala_id": sala.id, "acao": "atualizada"}))
    sessao.flush()
    return sala_detalhe(sessao, sala, membro, atendente), eventos


def _passar_administracao(sessao: Session, sala: SalaInterna, restantes: set[int]) -> None:
    """Quem criou saiu: administra quem está no grupo há mais tempo."""
    if sala.criada_por in restantes or not restantes:
        return
    sala.criada_por = sessao.scalar(
        select(MembroSala.atendente_id)
        .where(MembroSala.sala_id == sala.id, MembroSala.atendente_id.in_(list(restantes)))
        .order_by(MembroSala.entrou_em, MembroSala.atendente_id)
        .limit(1)
    )


def sair(sessao: Session, sala: SalaInterna, atendente: Atendente) -> list[Evento]:
    if sala.tipo != TipoSala.GRUPO.value:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "só é possível sair de grupos")
    sessao.execute(delete(MembroSala).where(MembroSala.sala_id == sala.id, MembroSala.atendente_id == atendente.id))
    restantes = set(sessao.scalars(select(MembroSala.atendente_id).where(MembroSala.sala_id == sala.id)))
    eventos: list[Evento] = [("interno.sala", {"sala_id": sala.id, "acao": "saiu", "para": [atendente.id]})]
    if not restantes:
        # grupo sem ninguém não volta a ser visto: sai do banco com as mensagens
        sessao.delete(sala)
    else:
        _passar_administracao(sessao, sala, restantes)
        sala.atualizada_em = agora()
        eventos.append(("interno.sala", {"sala_id": sala.id, "acao": "atualizada"}))
    sessao.flush()
    return eventos


# ------------------------------------------------------------------ eventos
def publicar(eventos: list[Evento]) -> None:
    """Grava na fila e acorda o SSE. Chame DEPOIS do commit (ver mensagens.py)."""
    if not eventos:
        return
    from .mensagens import publicar_evento  # import tardio: mensagens puxa os canais

    for tipo, dados in eventos:
        publicar_evento(tipo, dados, None)

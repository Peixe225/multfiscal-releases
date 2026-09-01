"""Webchat embutido no site do cliente.

O visitante nao tem login: ele recebe um token de sessao opaco, que amarra o
navegador dele a um contato e a um canal de webchat.
"""
from __future__ import annotations

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from typing import Annotated

from ..dependencias import Sessao
from ..eventos import barramento
from ..models import (
    Anexo,
    Canal,
    Contato,
    ContatoIdentidade,
    Direcao,
    Mensagem,
    SessaoWidget,
    TipoCanal,
    TipoMensagem,
)
from ..schemas import MensagemEntrada, WidgetMensagemSaida, WidgetSessaoEntrada, WidgetSessaoSaida
from ..security import gerar_chave
from ..canais.base import AnexoRecebido, MensagemRecebida
from ..serializacao import anexo_saida
from ..servicos import anexos as svc_anexos
from ..servicos.mensagens import publicar_conversa, publicar_mensagem, registrar_entrada
from ..api.anexos import resposta_de_arquivo
from ..api.eventos import CABECALHOS

rotas = APIRouter(prefix="/api/widget", tags=["widget"])
LIMITE_HISTORICO = 100


def _canal_por_chave(sessao, chave: str) -> Canal:
    canal = sessao.scalar(
        select(Canal).where(
            Canal.chave_publica == chave,
            Canal.tipo == TipoCanal.WEBCHAT.value,
            Canal.ativo.is_(True),
        )
    )
    if canal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "canal de webchat nao encontrado")
    return canal


def _sessao_widget(sessao, token: str | None) -> SessaoWidget:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "sessao do widget ausente")
    registro = sessao.get(SessaoWidget, token)
    if registro is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "sessao do widget invalida")
    return registro


def _canal_e_identidade(sessao, registro: SessaoWidget) -> tuple[Canal, ContatoIdentidade]:
    canal = sessao.get(Canal, registro.canal_id)
    identidade = sessao.scalar(
        select(ContatoIdentidade).where(
            ContatoIdentidade.contato_id == registro.contato_id,
            ContatoIdentidade.canal_tipo == TipoCanal.WEBCHAT.value,
        )
    )
    if canal is None or identidade is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "sessao do widget inconsistente")
    return canal, identidade


@rotas.post("/sessao", response_model=WidgetSessaoSaida, status_code=status.HTTP_201_CREATED)
def abrir_sessao(dados: WidgetSessaoEntrada, sessao: Sessao) -> WidgetSessaoSaida:
    canal = _canal_por_chave(sessao, dados.chave_publica)
    contato = None
    if dados.email:
        # visitante identificado: reaproveita a ficha que ja existe
        contato = sessao.scalar(select(Contato).where(Contato.email == dados.email.lower()))
    if contato is None:
        contato = Contato(nome=dados.nome or "Visitante do site", email=dados.email.lower() if dados.email else None)
        sessao.add(contato)
        sessao.flush()
    elif dados.nome:
        contato.nome = dados.nome

    visitante = gerar_chave("v_")
    sessao.add(
        ContatoIdentidade(
            contato_id=contato.id,
            canal_tipo=TipoCanal.WEBCHAT.value,
            identificador=visitante,
            nome_exibicao=contato.nome,
        )
    )
    token = gerar_chave("ws_")
    sessao.add(SessaoWidget(token=token, canal_id=canal.id, contato_id=contato.id))
    sessao.flush()
    return WidgetSessaoSaida(token=token, contato_id=contato.id, nome=contato.nome)


@rotas.post("/mensagens", response_model=WidgetMensagemSaida, status_code=status.HTTP_201_CREATED)
def enviar(
    dados: MensagemEntrada,
    sessao: Sessao,
    x_sessao: Annotated[str | None, Header()] = None,
) -> WidgetMensagemSaida:
    registro = _sessao_widget(sessao, x_sessao)
    canal, identidade = _canal_e_identidade(sessao, registro)

    mensagem = registrar_entrada(
        sessao,
        canal,
        MensagemRecebida(
            identificador=identidade.identificador,
            conteudo=dados.conteudo.strip(),
            nome_exibicao=identidade.nome_exibicao,
        ),
    )
    if mensagem is None:  # pragma: no cover - o widget nao reenvia id externo
        raise HTTPException(status.HTTP_409_CONFLICT, "mensagem duplicada")
    conversa = mensagem.conversa
    sessao.commit()
    publicar_mensagem(mensagem)
    publicar_conversa(conversa)
    return _saida_widget(mensagem, identidade.nome_exibicao)


@rotas.get("/mensagens", response_model=list[WidgetMensagemSaida])
def historico(sessao: Sessao, x_sessao: Annotated[str | None, Header()] = None) -> list[WidgetMensagemSaida]:
    registro = _sessao_widget(sessao, x_sessao)
    mensagens = sessao.scalars(
        select(Mensagem)
        .join(Mensagem.conversa)
        .where(
            Mensagem.conversa.has(contato_id=registro.contato_id),
            Mensagem.tipo != TipoMensagem.NOTA_INTERNA.value,
        )
        .order_by(Mensagem.criada_em.asc())
        .limit(LIMITE_HISTORICO)
    )
    return [_saida_widget(m, m.atendente.nome if m.atendente else None) for m in mensagens]


def _saida_widget(mensagem: Mensagem, autor: str | None) -> WidgetMensagemSaida:
    return WidgetMensagemSaida(
        id=mensagem.id,
        direcao=Direcao(mensagem.direcao),
        conteudo=mensagem.conteudo,
        criada_em=mensagem.criada_em,
        autor=autor,
        anexos=[anexo_saida(a, base="/api/widget/anexos") for a in mensagem.anexos],
    )


@rotas.post("/anexos", response_model=WidgetMensagemSaida, status_code=status.HTTP_201_CREATED)
async def enviar_arquivo(
    sessao: Sessao,
    arquivo: Annotated[UploadFile, File()],
    conteudo: Annotated[str, Form()] = "",
    x_sessao: Annotated[str | None, Header()] = None,
) -> WidgetMensagemSaida:
    """O visitante manda um print ou um PDF direto do widget."""
    registro = _sessao_widget(sessao, x_sessao)
    canal, identidade = _canal_e_identidade(sessao, registro)
    dados = await arquivo.read()
    if not dados:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "arquivo vazio")
    try:
        svc_anexos.conferir_tamanho(dados)
    except svc_anexos.AnexoGrande as exc:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, str(exc)) from exc

    mensagem = registrar_entrada(
        sessao,
        canal,
        MensagemRecebida(
            identificador=identidade.identificador,
            conteudo=conteudo.strip(),
            nome_exibicao=identidade.nome_exibicao,
            anexos=[
                AnexoRecebido(
                    nome=arquivo.filename or "arquivo",
                    dados=dados,
                    tipo_conteudo=arquivo.content_type,
                )
            ],
        ),
    )
    if mensagem is None:  # pragma: no cover
        raise HTTPException(status.HTTP_409_CONFLICT, "mensagem duplicada")
    conversa = mensagem.conversa
    sessao.commit()
    publicar_mensagem(mensagem)
    publicar_conversa(conversa)
    return _saida_widget(mensagem, identidade.nome_exibicao)


@rotas.get("/anexos/{anexo_id}")
def baixar_anexo(anexo_id: int, sessao: Sessao, token: str = Query(description="token da sessão")):
    """O visitante só alcança arquivo da própria conversa, e nunca de nota interna."""
    registro = _sessao_widget(sessao, token)
    anexo = sessao.get(Anexo, anexo_id)
    if (
        anexo is None
        or anexo.mensagem.conversa.contato_id != registro.contato_id
        or anexo.mensagem.tipo == TipoMensagem.NOTA_INTERNA.value
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "anexo não encontrado")
    return resposta_de_arquivo(anexo)


@rotas.get("/stream")
def stream(sessao: Sessao, token: str = Query(description="token da sessao do widget")) -> StreamingResponse:
    registro = _sessao_widget(sessao, token)
    contato_id = registro.contato_id

    def so_do_visitante(evento: dict) -> bool:
        dados = evento.get("dados") or {}
        return (
            evento.get("tipo") == "mensagem.nova"
            and dados.get("contato_id") == contato_id
            and dados.get("direcao") == Direcao.SAIDA.value
            and dados.get("tipo") != TipoMensagem.NOTA_INTERNA.value
        )

    return StreamingResponse(
        barramento.fluxo(so_do_visitante), media_type="text/event-stream", headers=CABECALHOS
    )

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
from ..schemas import (
    AssinaturaSaida,
    EventosDesdeSaida,
    MensagemEntrada,
    WidgetMensagemSaida,
    WidgetSessaoEntrada,
    WidgetSessaoSaida,
)
from ..security import gerar_chave
from ..canais.base import AnexoRecebido, MensagemRecebida
from ..serializacao import anexo_saida, assinatura_de
from ..servicos import anexos as svc_anexos
from ..servicos.mensagens import publicar_conversa, publicar_mensagem, registrar_entrada
from ..api.anexos import resposta_de_arquivo
from ..api.eventos import (
    CABECALHOS,
    LIMITE_PADRAO,
    Depois,
    Limite,
    cursor_inicial,
    do_visitante,
    fluxo_persistido,
    ler_desde,
)

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
        # as mais novas primeiro para o limite cortar o passado, nao o presente
        .order_by(Mensagem.criada_em.desc(), Mensagem.id.desc())
        .limit(LIMITE_HISTORICO)
    ).all()
    return [_saida_widget(m, _autor_para_o_visitante(m)) for m in reversed(mensagens)]


def _autor_para_o_visitante(mensagem: Mensagem) -> str | None:
    """Quem respondeu, com o nome gravado no envio (o que o cliente viu)."""
    assinatura = assinatura_de(mensagem)
    if assinatura:
        return assinatura["nome"]
    return mensagem.atendente.nome if mensagem.atendente else None


def _saida_widget(mensagem: Mensagem, autor: str | None) -> WidgetMensagemSaida:
    assinatura = assinatura_de(mensagem) if mensagem.direcao == Direcao.SAIDA.value else None
    return WidgetMensagemSaida(
        id=mensagem.id,
        direcao=Direcao(mensagem.direcao),
        conteudo=mensagem.conteudo,
        criada_em=mensagem.criada_em,
        autor=autor,
        assinatura=AssinaturaSaida(**assinatura) if assinatura else None,
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
def stream(
    sessao: Sessao,
    token: str = Query(description="token da sessao do widget"),
    depois: Depois = None,
    last_event_id: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    registro = _sessao_widget(sessao, token)
    return StreamingResponse(
        fluxo_persistido(cursor_inicial(depois, last_event_id), do_visitante(registro.contato_id)),
        media_type="text/event-stream",
        headers=CABECALHOS,
    )


@rotas.get("/eventos/desde", response_model=EventosDesdeSaida)
def eventos_desde(
    sessao: Sessao,
    token: str | None = Query(default=None, description="token da sessao do widget"),
    depois: Depois = None,
    limite: Limite = LIMITE_PADRAO,
    x_sessao: Annotated[str | None, Header()] = None,
) -> dict:
    """Consulta por cursor (o contrato do PHP): só a resposta para o visitante.

    A sessão vem em ?token= (como no stream) ou no cabeçalho X-Sessao.
    """
    registro = _sessao_widget(sessao, token or x_sessao)
    return ler_desde(depois, limite, do_visitante(registro.contato_id))

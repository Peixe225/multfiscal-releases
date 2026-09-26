"""Envio e download de arquivos das conversas.

O download passa pela API, e não por uma pasta estática: assim o arquivo tem a
mesma proteção da conversa a que pertence.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile, status

from ..armazenamento import ErroArmazenamento, disposicao, exibivel
from ..canais.base import ErroCanal
from ..dependencias import AtendenteAtual, AtendenteDeArquivo, ConversaAtual, Sessao
from ..models import Anexo
from ..schemas import MensagemSaida
from ..serializacao import mensagem_saida
from ..servicos import anexos as svc
from ..servicos.conversas import marcar_lida
from ..servicos.mensagens import (
    CanalSemArquivos,
    enviar_mensagem,
    publicar_conversa,
    publicar_mensagem,
)

rotas = APIRouter(prefix="/api", tags=["anexos"])


def resposta_de_arquivo(anexo: Anexo) -> Response:
    """Os bytes de um anexo (também serve à rota do widget).

    Inline só a lista fechada (o painel exibe imagem, PDF, áudio, texto); o
    nome vale no "salvar como". O resto — inclusive anexos gravados antes do
    filtro de tipos, com "text/html" ou "text/xsl" — vai como download inerte
    e isolado, que o navegador nunca abre na origem do painel.
    """
    try:
        dados = svc.bytes_de(anexo)
    except (ErroCanal, ErroArmazenamento) as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    cabecalhos = {"Cache-Control": "private, max-age=3600"}
    if exibivel(anexo.tipo_conteudo):
        tipo = anexo.tipo_conteudo.split(";")[0].strip().lower()
        cabecalhos["Content-Disposition"] = disposicao("inline", anexo.nome)
    else:
        tipo = "application/octet-stream"
        cabecalhos["Content-Disposition"] = disposicao("attachment", anexo.nome)
        cabecalhos["Content-Security-Policy"] = "sandbox; default-src 'none'"
    return Response(content=dados, media_type=tipo, headers=cabecalhos)


@rotas.post(
    "/conversas/{conversa_id}/anexos",
    response_model=MensagemSaida,
    status_code=status.HTTP_201_CREATED,
)
async def enviar_arquivo(
    conversa: ConversaAtual,
    sessao: Sessao,
    atual: AtendenteAtual,
    arquivo: Annotated[UploadFile, File(description="arquivo a enviar")],
    conteudo: Annotated[str, Form(description="legenda opcional")] = "",
) -> MensagemSaida:
    dados = await arquivo.read()
    if not dados:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "arquivo vazio")
    try:
        para_enviar = svc.para_envio(arquivo.filename or "arquivo", dados, arquivo.content_type)
        mensagem = enviar_mensagem(sessao, conversa, conteudo.strip(), atual, [para_enviar])
    except svc.AnexoGrande as exc:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, str(exc)) from exc
    except CanalSemArquivos as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    marcar_lida(sessao, conversa)
    sessao.commit()
    publicar_mensagem(mensagem)
    publicar_conversa(conversa)
    return mensagem_saida(mensagem)


@rotas.get("/anexos/{anexo_id}")
def baixar(anexo_id: int, sessao: Sessao, atual: AtendenteDeArquivo) -> Response:
    from ..servicos import visibilidade

    anexo = sessao.get(Anexo, anexo_id)
    # o arquivo é da conversa: quem não a vê (outro setor) não baixa (o mesmo 404)
    if anexo is None or not visibilidade.pode_ver_id(sessao, atual, anexo.mensagem.conversa_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "anexo não encontrado")
    return resposta_de_arquivo(anexo)

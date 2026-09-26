"""Guarda e recupera os arquivos trocados nas conversas."""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ..armazenamento import armazenamento, tipo_seguro
from ..canais.base import AdaptadorCanal, AnexoRecebido, ArquivoParaEnviar, ErroCanal
from ..config import obter_config
from ..models import Anexo, Mensagem

log = logging.getLogger("ihchat.anexos")


class AnexoGrande(Exception):
    """Arquivo acima do limite configurado."""


def limite_bytes() -> int:
    return obter_config().tamanho_max_anexo_mb * 1024 * 1024


def conferir_tamanho(dados: bytes) -> None:
    if len(dados) > limite_bytes():
        limite = obter_config().tamanho_max_anexo_mb
        raise AnexoGrande(f"arquivo maior que o limite de {limite} MB")


def guardar(sessao: Session, mensagem: Mensagem, nome: str, dados: bytes, tipo: str | None = None) -> Anexo:
    conferir_tamanho(dados)
    anexo = Anexo(
        mensagem_id=mensagem.id,
        nome=nome,
        # pelos bytes, não pelo que o remetente disse: um HTML chamado
        # "foto.png" não pode virar página na origem do painel
        tipo_conteudo=tipo_seguro(nome, tipo, dados),
        tamanho=len(dados),
        chave=armazenamento().salvar(dados, nome),
    )
    sessao.add(anexo)
    sessao.flush()
    return anexo


def guardar_recebidos(
    sessao: Session, adaptador: AdaptadorCanal, mensagem: Mensagem, recebidos: list[AnexoRecebido]
) -> list[Anexo]:
    """Baixa no provedor os arquivos anunciados e os guarda.

    Uma falha de download não derruba a mensagem: o anexo fica registrado com o
    erro, porque o atendente precisa saber que veio um arquivo mesmo quando não
    foi possível buscá-lo.
    """
    guardados: list[Anexo] = []
    for recebido in recebidos:
        try:
            dados = adaptador.baixar_anexo(recebido)
            conferir_tamanho(dados)
        except (ErroCanal, AnexoGrande) as exc:
            log.warning("anexo de %s não baixado: %s", adaptador.tipo.value, exc)
            anexo = Anexo(
                mensagem_id=mensagem.id,
                nome=recebido.nome,
                # sem bytes: só o anúncio, filtrado (nunca um tipo executável)
                tipo_conteudo=tipo_seguro(recebido.nome, recebido.tipo_conteudo),
                externo_id=recebido.referencia,
                erro=str(exc),
            )
            sessao.add(anexo)
            guardados.append(anexo)
            continue
        anexo = guardar(sessao, mensagem, recebido.nome, dados, recebido.tipo_conteudo)
        anexo.externo_id = recebido.referencia
        guardados.append(anexo)
    sessao.flush()
    return guardados


def bytes_de(anexo: Anexo) -> bytes:
    if not anexo.chave:
        raise ErroCanal(anexo.erro or "anexo sem conteúdo guardado")
    return armazenamento().ler(anexo.chave)


def para_envio(nome: str, dados: bytes, tipo: str | None = None) -> ArquivoParaEnviar:
    conferir_tamanho(dados)
    return ArquivoParaEnviar(nome=nome, tipo_conteudo=tipo_seguro(nome, tipo, dados), dados=dados)

"""Simulador de clientes: faz o papel do contato no WhatsApp, Telegram e e-mail.

Sem credencial de provedor ninguem consegue escrever "como cliente" para testar
o atendimento. O simulador monta o JSON que o provedor mandaria no webhook e o
entrega ao adaptador do canal, pelo mesmo caminho de um webhook real: o que se
testa aqui e o codigo de producao, nao uma imitacao dele.

So existe no modo sandbox. Fora dele, qualquer atendente poderia forjar
mensagens de cliente na caixa de entrada.
"""
from __future__ import annotations

import re
import time
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field, StringConstraints, TypeAdapter, ValidationError
from sqlalchemy import select

from ..canais.registro import CanalNaoSuportado, adaptador_para
from ..config import obter_config
from ..dependencias import AtendenteAtual, Sessao
from ..models import (
    Canal,
    ContatoIdentidade,
    Conversa,
    Mensagem,
    StatusMensagem,
    TipoCanal,
    TipoMensagem,
)
from ..schemas import MensagemSaida
from ..serializacao import mensagem_saida
from ..servicos.mensagens import publicar_conversa, publicar_mensagem, registrar_entrada
from ..util import normalizar_telefone


def _exigir_sandbox() -> None:
    # 404 e nao 403: fora do sandbox a rota simplesmente nao existe, e quem
    # procura por ela nao aprende nada
    if not obter_config().modo_sandbox:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "simulador desligado fora do modo sandbox")


# a dependencia do roteador roda antes da autenticacao de cada rota: desligado,
# o simulador responde 404 ate para quem nao mandou token
rotas = APIRouter(
    prefix="/api/simulador", tags=["simulador"], dependencies=[Depends(_exigir_sandbox)]
)

LIMITE_HISTORICO = 200
# o nome da constante 422 mudou entre versoes do Starlette; o numero, nao
INVALIDO = 422
# o cliente nunca ve o que e da equipe, nem o que o provedor nao entregou
TIPOS_INTERNOS = (TipoMensagem.NOTA_INTERNA.value, TipoMensagem.SISTEMA.value)
TIPOS_SIMULAVEIS = {TipoCanal.WHATSAPP.value, TipoCanal.TELEGRAM.value, TipoCanal.EMAIL.value}

_EMAIL = TypeAdapter(EmailStr)
_ID_TELEGRAM = re.compile(r"-?\d{1,20}")


# -------------------------------------------------------------------- modelos
class CanalSimulado(BaseModel):
    id: int
    nome: str
    tipo: str
    disponivel: bool
    motivo: str | None = None
    link: str | None = None  # para onde ir quando o canal tem outro jeito de testar


class MensagemDoCliente(BaseModel):
    canal_id: int
    identificador: str = Field(min_length=1, max_length=200)
    nome: str | None = Field(default=None, max_length=160)
    conteudo: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8000)]
    assunto: str | None = Field(default=None, max_length=200, description="so para e-mail")


class MensagemVista(MensagemSaida):
    # o e-mail mostra o assunto em cada mensagem; ele vive na conversa
    assunto: str | None = None


class ConversaDoCliente(BaseModel):
    contato_id: int | None = None
    mensagens: list[MensagemVista] = []


# ------------------------------------------------------------------ situacao
def _situacao(canal: Canal) -> CanalSimulado:
    """Diz se da para simular um cliente naquele canal, e por que nao."""
    base = {"id": canal.id, "nome": canal.nome, "tipo": canal.tipo}
    if canal.tipo == TipoCanal.WEBCHAT.value:
        link = f"/widget/demo?chave={canal.chave_publica}"
        return CanalSimulado(
            **base,
            disponivel=False,
            motivo=f"o webchat tem widget de verdade: teste em {link}",
            link=link,
        )
    try:
        adaptador = adaptador_para(canal)
    except CanalNaoSuportado:
        adaptador = None
    if adaptador is None or canal.tipo not in TIPOS_SIMULAVEIS:
        return CanalSimulado(**base, disponivel=False, motivo="o simulador ainda nao imita este canal")
    if adaptador.configurado:
        # com credencial, a resposta do atendente sairia pela API do provedor
        # para o numero ou endereco inventado aqui - que pode ser de alguem
        return CanalSimulado(
            **base,
            disponivel=False,
            motivo="canal ligado a um provedor real: a resposta do atendente iria "
            "para um numero ou endereco de verdade",
        )
    return CanalSimulado(**base, disponivel=True)


def _canal_ativo(sessao, canal_id: int) -> Canal:
    canal = sessao.get(Canal, canal_id)
    if canal is None or not canal.ativo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "canal nao encontrado ou desativado")
    if canal.tipo not in TIPOS_SIMULAVEIS:
        raise HTTPException(INVALIDO, _situacao(canal).motivo)
    return canal


def _normalizar(tipo: str, identificador: str) -> str:
    """Valida e normaliza como `resolver_contato` grava a identidade.

    Sem isso, "+55 (33) 9..." e "5533..." virariam dois clientes, e o
    historico pedido com um nao acharia as mensagens mandadas com o outro.
    """
    bruto = identificador.strip()
    if tipo == TipoCanal.WHATSAPP.value:
        numero = normalizar_telefone(bruto)
        if not 10 <= len(numero) <= 15:
            raise HTTPException(
                INVALIDO,
                "numero de WhatsApp invalido: use DDI + DDD + numero (10 a 15 digitos)",
            )
        return numero
    if tipo == TipoCanal.TELEGRAM.value:
        # o chat_id e numerico; grupos tem id negativo
        if not _ID_TELEGRAM.fullmatch(bruto) or int(bruto) == 0:
            raise HTTPException(
                INVALIDO,
                "id do Telegram invalido: e um numero (negativo para grupos)",
            )
        return str(int(bruto))  # como o adaptador grava: str(chat["id"])
    try:
        return _EMAIL.validate_python(bruto).lower()
    except ValidationError as exc:
        raise HTTPException(INVALIDO, "endereco de e-mail invalido") from exc


# ----------------------------------------------------------------- payloads
# Cada funcao devolve o corpo que o provedor mandaria no webhook, com um id
# externo novo: o adaptador descarta id repetido como reentrega.
def _payload_whatsapp(numero: str, nome: str | None, dados: MensagemDoCliente) -> dict:
    contato: dict = {"wa_id": numero}
    if nome:
        contato["profile"] = {"name": nome}
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "simulador",
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "messaging_product": "whatsapp",
                            "contacts": [contato],
                            "messages": [
                                {
                                    "from": numero,
                                    "id": f"wamid.SIM{uuid.uuid4().hex}",
                                    "timestamp": str(int(time.time())),
                                    "type": "text",
                                    "text": {"body": dados.conteudo},
                                }
                            ],
                        },
                    }
                ],
            }
        ],
    }


def _payload_telegram(chat_id: str, nome: str | None, dados: MensagemDoCliente) -> dict:
    numero = int(chat_id)
    chat: dict = {"id": numero, "type": "private" if numero > 0 else "group"}
    autor: dict = {"id": abs(numero), "is_bot": False}
    if nome:
        primeiro, _, resto = nome.partition(" ")
        autor["first_name"] = primeiro
        if resto.strip():
            autor["last_name"] = resto.strip()
        if numero < 0:
            chat["title"] = nome
    return {
        "update_id": uuid.uuid4().int >> 97,
        "message": {
            # inteiro como no Telegram; 63 bits de uuid bastam para nao repetir
            "message_id": uuid.uuid4().int >> 65,
            "date": int(time.time()),
            "chat": chat,
            "from": autor,
            "text": dados.conteudo,
        },
    }


def _payload_email(endereco: str, nome: str | None, dados: MensagemDoCliente) -> dict:
    remetente = endereco
    if nome:
        # entre aspas, virgula ou parenteses no nome nao quebram o parseaddr
        escapado = nome.replace("\\", "\\\\").replace('"', '\\"')
        remetente = f'"{escapado}" <{endereco}>'
    payload = {
        "from": remetente,
        "text": dados.conteudo,
        "message-id": f"<{uuid.uuid4().hex}@simulador.omnichannel>",
    }
    assunto = (dados.assunto or "").strip()
    if assunto:
        payload["subject"] = assunto
    return payload


MONTADORES = {
    TipoCanal.WHATSAPP.value: _payload_whatsapp,
    TipoCanal.TELEGRAM.value: _payload_telegram,
    TipoCanal.EMAIL.value: _payload_email,
}


def _vista(mensagem: Mensagem) -> MensagemVista:
    saida = mensagem_saida(mensagem)
    return MensagemVista(**saida.model_dump(), assunto=mensagem.conversa.assunto)


# -------------------------------------------------------------------- rotas
@rotas.get("/canais", response_model=list[CanalSimulado])
def canais(sessao: Sessao, _: AtendenteAtual) -> list[CanalSimulado]:
    ativos = sessao.scalars(select(Canal).where(Canal.ativo.is_(True)).order_by(Canal.tipo, Canal.nome))
    return [_situacao(c) for c in ativos]


@rotas.post("/mensagens", response_model=MensagemVista, status_code=status.HTTP_201_CREATED)
def escrever_como_cliente(
    dados: MensagemDoCliente, sessao: Sessao, atendente: AtendenteAtual
) -> MensagemVista:
    canal = _canal_ativo(sessao, dados.canal_id)
    situacao = _situacao(canal)
    if not situacao.disponivel:
        raise HTTPException(status.HTTP_409_CONFLICT, situacao.motivo)

    identificador = _normalizar(canal.tipo, dados.identificador)
    nome = (dados.nome or "").strip() or None
    payload = MONTADORES[canal.tipo](identificador, nome, dados)

    recebidas = adaptador_para(canal).analisar_webhook(payload)
    if len(recebidas) != 1:  # pragma: no cover - o payload e montado aqui
        raise HTTPException(INVALIDO, "o canal nao reconheceu a mensagem")
    recebida = recebidas[0]
    # rastro para auditoria: mensagem de cliente que foi escrita por um atendente
    recebida.metadados = {**(recebida.metadados or {}), "simulada_por": atendente.id}

    mensagem = registrar_entrada(sessao, canal, recebida)
    if mensagem is None:  # pragma: no cover - id externo e sempre novo
        raise HTTPException(status.HTTP_409_CONFLICT, "mensagem duplicada")
    conversa = mensagem.conversa
    sessao.commit()

    publicar_mensagem(mensagem)
    publicar_conversa(conversa)
    return _vista(mensagem)


@rotas.get("/conversa", response_model=ConversaDoCliente)
def conversa_do_cliente(
    sessao: Sessao,
    _: AtendenteAtual,
    canal_id: int = Query(),
    identificador: str = Query(min_length=1, max_length=200),
) -> ConversaDoCliente:
    """O que o cliente veria no aparelho dele: todas as conversas naquele canal."""
    canal = _canal_ativo(sessao, canal_id)
    normalizado = _normalizar(canal.tipo, identificador)
    identidade = sessao.scalar(
        select(ContatoIdentidade).where(
            ContatoIdentidade.canal_tipo == canal.tipo,
            ContatoIdentidade.identificador == normalizado,
        )
    )
    if identidade is None:
        return ConversaDoCliente()

    recentes = sessao.scalars(
        select(Mensagem)
        .join(Conversa, Mensagem.conversa_id == Conversa.id)
        .where(
            Conversa.contato_id == identidade.contato_id,
            Conversa.canal_id == canal.id,
            Mensagem.tipo.not_in(TIPOS_INTERNOS),
            Mensagem.status != StatusMensagem.FALHOU.value,
        )
        # as mais novas primeiro para o limite cortar o passado, nao o presente
        .order_by(Mensagem.criada_em.desc(), Mensagem.id.desc())
        .limit(LIMITE_HISTORICO)
    ).all()
    return ConversaDoCliente(
        contato_id=identidade.contato_id, mensagens=[_vista(m) for m in reversed(recentes)]
    )

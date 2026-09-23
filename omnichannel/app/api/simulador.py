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
from datetime import datetime
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
    Direcao,
    Mensagem,
    StatusMensagem,
    TipoCanal,
    TipoMensagem,
)
from ..schemas import MensagemSaida
from ..serializacao import mensagem_saida
from ..servicos.mensagens import publicar_conversa, publicar_mensagem, registrar_entrada
from ..util import normalizar_telefone, resumir


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
# ajustes que sozinhos nao ligam o canal a provedor nenhum: sem token nem
# servidor, porta e modo de recebimento nao recebem nem enviam nada
AJUSTES_SEM_PROVEDOR = frozenset({"modo_recebimento", "smtp_porta", "imap_porta", "imap_pasta"})
# o que cabe no assunto da conversa
ASSUNTO_MAXIMO = Conversa.__table__.c.assunto.type.length
# o que o AdaptadorEmail poe no assunto da resposta quando a conversa nao tem um
ASSUNTO_SEM_ASSUNTO = "Atendimento"

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
    # 998 e o limite de uma linha de cabecalho (RFC 5322). Acima de 200 o
    # assunto e cortado, nao recusado: ele so da nome a conversa, e o "Re: "
    # de uma resposta num assunto ja longo nao pode travar a thread
    assunto: str | None = Field(default=None, max_length=998, description="so para e-mail")


class MensagemVista(MensagemSaida):
    # so no e-mail. Cada mensagem tem a sua linha de assunto: a que o cliente
    # digitou, ou a da resposta; a da conversa e a que as proximas respostas
    # do atendente vao usar
    assunto: str | None = None
    assunto_conversa: str | None = None


class ConversaDoCliente(BaseModel):
    contato_id: int | None = None
    mensagens: list[MensagemVista] = []


# ------------------------------------------------------------------ situacao
def _ligado_a_provedor(canal: Canal) -> bool:
    """Alguma credencial preenchida, mesmo que ainda nao de para enviar.

    `configurado` mede so o ENVIO: uma caixa so com IMAP, ou um WhatsApp com o
    App Secret e ainda sem token, ja recebe clientes de verdade. Simular ali
    poria a mensagem forjada na conversa de um cliente real - e, no WhatsApp,
    por cima da assinatura que protege o webhook.
    """
    return any(
        valor for chave, valor in (canal.credenciais or {}).items() if chave not in AJUSTES_SEM_PROVEDOR
    )


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
    if _ligado_a_provedor(canal):
        return CanalSimulado(
            **base,
            disponivel=False,
            motivo="canal com credenciais de um provedor real: ele recebe clientes de "
            "verdade, e a mensagem simulada entraria na conversa deles",
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
    assunto = resumir(dados.assunto or "", ASSUNTO_MAXIMO)
    if assunto:
        payload["subject"] = assunto
    return payload


MONTADORES = {
    TipoCanal.WHATSAPP.value: _payload_whatsapp,
    TipoCanal.TELEGRAM.value: _payload_telegram,
    TipoCanal.EMAIL.value: _payload_email,
}


def _como_resposta(assunto: str | None) -> str:
    # a regra do AdaptadorEmail._enviar: o que o cliente recebe de volta
    base = assunto or ASSUNTO_SEM_ASSUNTO
    return base if base.lower().startswith("re:") else f"Re: {base}"


def _batizadas(mensagens: list[Mensagem]) -> dict[int, datetime]:
    """Quando cada conversa ganhou o assunto que tem hoje, se foi o simulador.

    `registrar_entrada` so preenche o assunto da conversa que ainda nao tem
    um. Se quem o deu foi uma mensagem simulada, o que veio antes dela (o
    e-mail do seed, uma resposta) e de quando a conversa nao tinha assunto, e
    nao pode herdar o que so apareceu depois.
    """
    batizadas: dict[int, datetime] = {}
    for mensagem in mensagens:  # em ordem cronologica: fica a primeira
        proprio = (mensagem.metadados or {}).get("assunto")
        if proprio and proprio == mensagem.conversa.assunto:
            batizadas.setdefault(mensagem.conversa_id, mensagem.criada_em)
    return batizadas


def _vista(mensagem: Mensagem, batizada_em: datetime | None = None) -> MensagemVista:
    dados = mensagem_saida(mensagem).model_dump()
    conversa = mensagem.conversa
    if conversa.canal.tipo == TipoCanal.EMAIL.value:
        dados["assunto_conversa"] = conversa.assunto
        # o assunto que a conversa tinha quando esta mensagem foi escrita
        na_epoca = None if batizada_em and mensagem.criada_em < batizada_em else conversa.assunto
        metadados = mensagem.metadados or {}
        if mensagem.direcao == Direcao.SAIDA.value:
            dados["assunto"] = _como_resposta(na_epoca)
        elif "assunto" in metadados:  # gravado pelo simulador: o que o cliente digitou
            dados["assunto"] = metadados["assunto"]
        else:
            dados["assunto"] = na_epoca
    return MensagemVista(**dados)


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
    # quebra de linha num nome viraria cabecalho extra no From do e-mail
    nome = " ".join((dados.nome or "").split()) or None
    payload = MONTADORES[canal.tipo](identificador, nome, dados)

    recebidas = adaptador_para(canal).analisar_webhook(payload)
    if len(recebidas) != 1:  # pragma: no cover - o payload e montado aqui
        raise HTTPException(INVALIDO, "o canal nao reconheceu a mensagem")
    recebida = recebidas[0]
    # rastro para auditoria: mensagem de cliente que foi escrita por um atendente
    extras: dict = {"simulada_por": atendente.id}
    if canal.tipo == TipoCanal.EMAIL.value:
        # a conversa so guarda o primeiro assunto: sem isto, o cliente que muda
        # de assunto num e-mail seguinte veria o cartao dele com outro assunto
        extras["assunto"] = recebida.assunto
    recebida.metadados = {**(recebida.metadados or {}), **extras}

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
    cronologicas = list(reversed(recentes))
    batizadas = _batizadas(cronologicas)
    return ConversaDoCliente(
        contato_id=identidade.contato_id,
        mensagens=[_vista(m, batizadas.get(m.conversa_id)) for m in cronologicas],
    )

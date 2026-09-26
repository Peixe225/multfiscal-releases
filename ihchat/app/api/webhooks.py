"""Recepcao de mensagens vindas dos provedores."""
from __future__ import annotations

import dataclasses
import json
import logging

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from starlette.datastructures import UploadFile

from ..canais.base import AdaptadorCanal, AnexoRecebido, AtualizacaoStatus, MensagemRecebida
from ..canais.email import AdaptadorEmail
from ..canais.registro import CanalNaoSuportado, adaptador_para
from ..canais.whatsapp import AdaptadorWhatsApp, entrega_com, valores_por_numero
from ..canais.whatsapp_qr import (
    ASSINATURA_DO_CELULAR,
    METADADO_LID,
    RECIBO_SUBSTITUI,
    AdaptadorWhatsAppQR,
    credenciais_com_conexao,
    e_lid,
)
from ..dependencias import Sessao
from ..models import (
    Canal,
    ContatoIdentidade,
    Conversa,
    Direcao,
    Mensagem,
    StatusConversa,
    StatusMensagem,
    TipoCanal,
    TipoMensagem,
    agora,
)
from ..serializacao import conexao_do_canal
from ..servicos import anexos as svc_anexos
from ..servicos.contatos import resolver_contato
from ..servicos.conversas import obter_ou_criar_conversa
from ..servicos.mensagens import (
    aplicar_status_externo,
    ja_processada,
    publicar_canal,
    publicar_conversa,
    publicar_mensagem,
    registrar_entrada,
)
from ..util import resumir

log = logging.getLogger("ihchat.webhooks")

rotas = APIRouter(prefix="/webhooks", tags=["webhooks"])

TIPOS_DE_FORMULARIO = ("multipart/form-data", "application/x-www-form-urlencoded")


def _canal(sessao, canal_id: int) -> Canal:
    canal = sessao.scalar(select(Canal).where(Canal.id == canal_id))
    if canal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "canal nao encontrado")
    if not canal.ativo:
        raise HTTPException(status.HTTP_409_CONFLICT, "canal desativado")
    return canal


@rotas.get("/{canal_id}")
async def verificar(canal_id: int, request: Request, sessao: Sessao) -> Response:
    """Handshake de verificacao exigido por alguns provedores (Meta)."""
    canal = _canal(sessao, canal_id)
    try:
        desafio = adaptador_para(canal).desafio_verificacao(dict(request.query_params))
    except CanalNaoSuportado:
        desafio = None
    if desafio is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "verificacao recusada")
    return Response(content=desafio, media_type="text/plain")


def _objeto_do_corpo(corpo: bytes) -> dict:
    if not corpo.strip():
        return {}  # corpo vazio e um objeto vazio: nada a gravar
    try:
        payload = json.loads(corpo)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "corpo nao e JSON valido") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "corpo deve ser um objeto JSON")
    return payload


async def _formulario(request: Request) -> tuple[dict, list[AnexoRecebido]]:
    """Campos de texto e arquivos de uma entrega em formulário (SendGrid, Mailgun)."""
    formulario = await request.form()
    campos: dict = {}
    arquivos: list[AnexoRecebido] = []
    for chave, valor in formulario.multi_items():
        if isinstance(valor, UploadFile):
            dados = await valor.read()
            if dados:
                arquivos.append(
                    AnexoRecebido(nome=valor.filename or "arquivo", dados=dados, tipo_conteudo=valor.content_type or None)
                )
        elif chave not in campos:
            campos[chave] = valor
    return campos, arquivos


def _whatsapp_por_numero(sessao) -> dict[str, Canal]:
    """Canais WhatsApp ativos pelo Phone number ID (o de menor id, se repetido)."""
    mapa: dict[str, Canal] = {}
    canais = sessao.scalars(
        select(Canal).where(Canal.tipo == TipoCanal.WHATSAPP.value, Canal.ativo.is_(True)).order_by(Canal.id)
    )
    for outro in canais:
        numero = AdaptadorWhatsApp(outro).id_numero
        if numero and numero not in mapa:
            mapa[numero] = outro
    return mapa


def _destinos(sessao, canal: Canal, adaptador: AdaptadorCanal, payload: dict) -> list[tuple[Canal, AdaptadorCanal, dict]]:
    """A que canal vai cada parte da entrega.

    Só o WhatsApp divide: a Meta manda as entregas de TODOS os números do app
    para a URL cadastrada no app, e cada "value" diz o número
    (metadata.phone_number_id). A parte de outro número vai para o canal
    WhatsApp ativo daquele número; a de um número que nenhum canal tem é
    descartada (com aviso no log), para a conversa do número B nunca abrir no
    canal A e ser respondida pelo A. A assinatura já foi conferida: os números
    do mesmo app têm o mesmo App Secret.
    """
    if not isinstance(adaptador, AdaptadorWhatsApp):
        return [(canal, adaptador, payload)]
    meu = adaptador.id_numero
    por_numero: dict[str, Canal] | None = None
    grupos: dict[int, tuple[Canal, list[dict]]] = {}
    for numero, valor in valores_por_numero(payload):
        destino = canal
        if numero is not None and numero != meu:
            if por_numero is None:
                por_numero = _whatsapp_por_numero(sessao)
            if numero in por_numero:
                destino = por_numero[numero]
            elif meu:
                log.warning(
                    "webhook do canal %s: entrega do número %s, que nenhum canal WhatsApp ativo tem; descartada",
                    canal.id, numero,
                )
                continue
            # sem id_numero neste canal (sandbox) e número sem dono: fica aqui
        grupos.setdefault(destino.id, (destino, []))[1].append(valor)
    return [
        (destino, adaptador if destino.id == canal.id else AdaptadorWhatsApp(destino), entrega_com(valores))
        for destino, valores in grupos.values()
    ]


# ---------------------------------------- WhatsApp pelo QR Code: o @lid
def _dono_da_identidade(sessao, canal_tipo: str, identificador: str) -> int | None:
    return sessao.scalar(
        select(ContatoIdentidade.contato_id).where(
            ContatoIdentidade.canal_tipo == canal_tipo, ContatoIdentidade.identificador == identificador
        )
    )


def _ligar_identidade(sessao, contato_id: int, canal_tipo: str, identificador: str, nome: str | None) -> None:
    """Mais uma identidade do contato; se outra entrega a gravou ao mesmo
    tempo (índice único), fica valendo a dela."""
    try:
        with sessao.begin_nested():
            sessao.add(
                ContatoIdentidade(contato_id=contato_id, canal_tipo=canal_tipo, identificador=identificador, nome_exibicao=nome)
            )
    except IntegrityError:
        pass


def ligar_lid(sessao, canal: Canal, recebida: MensagemRecebida) -> MensagemRecebida:
    """O mesmo cliente com número e com @lid fica UM contato (e uma conversa).

    O WhatsApp esconde o número de parte dos contatos atrás de um "@lid", e o
    provedor manda ora um, ora outro. Quando a entrega traz os dois, o @lid
    vira mais uma identidade do contato do número; quando traz só o @lid, a
    mensagem vai para o número já ligado a ele (é para o número que a
    resposta volta). Igual ao Rotas::ligarLid do PHP.
    """
    tipo = canal.tipo
    if ja_processada(sessao, recebida.externo_id) is not None:
        return recebida  # reentrega: nada a ligar
    if e_lid(recebida.identificador):
        dono = _dono_da_identidade(sessao, tipo, recebida.identificador)
        if dono is None:
            return recebida
        numero = sessao.scalar(
            select(ContatoIdentidade.identificador)
            .where(
                ContatoIdentidade.contato_id == dono,
                ContatoIdentidade.canal_tipo == tipo,
                ContatoIdentidade.identificador.not_like("%@lid"),
            )
            .order_by(ContatoIdentidade.id)
            .limit(1)
        )
        return dataclasses.replace(recebida, identificador=numero) if numero else recebida
    lid = (recebida.metadados or {}).get(METADADO_LID)
    if not e_lid(lid):
        return recebida
    do_numero = _dono_da_identidade(sessao, tipo, recebida.identificador)
    do_lid = _dono_da_identidade(sessao, tipo, lid)
    if do_numero is None and do_lid is not None:
        # o cliente escreveu antes só com o @lid: o número passa a ser dele
        _ligar_identidade(sessao, do_lid, tipo, recebida.identificador, recebida.nome_exibicao)
    elif do_lid is None:
        dono = do_numero or resolver_contato(sessao, tipo, recebida.identificador, recebida.nome_exibicao).id
        _ligar_identidade(sessao, dono, tipo, lid, recebida.nome_exibicao)
    sessao.flush()
    return recebida


def aplicar_recibos_em_ordem(sessao, recibos: list[AtualizacaoStatus]) -> list[Mensagem]:
    """Recibos do WhatsApp pelo QR Code: só AVANÇAM o status (RECIBO_SUBSTITUI).

    A condição vai no próprio UPDATE: dois recibos quase simultâneos (entrega
    e leitura com o cliente na conversa) não se atropelam. Igual ao PHP.
    """
    alteradas: list[Mensagem] = []
    for recibo in recibos:
        anteriores = RECIBO_SUBSTITUI.get(recibo.status.value)
        if not anteriores or not recibo.externo_id:
            continue
        resultado = sessao.execute(
            update(Mensagem)
            .where(Mensagem.externo_id == recibo.externo_id, Mensagem.status.in_(anteriores))
            .values(status=recibo.status.value)
            .execution_options(synchronize_session=False)
        )
        if resultado.rowcount:
            mensagem = sessao.scalar(select(Mensagem).where(Mensagem.externo_id == recibo.externo_id))
            if mensagem is not None:
                sessao.refresh(mensagem)
                alteradas.append(mensagem)
    sessao.flush()
    return alteradas


# ------------------------------------------- WhatsApp pelo QR Code: o celular
def _conversa_do_celular(sessao, contato, canal: Canal) -> Conversa:
    """Onde entra a resposta que o dono deu pelo celular.

    A conversa viva do contato neste canal; senão a mais recente, mesmo
    resolvida (o dono respondendo "de nada" não reabre atendimento para a
    equipe); senão uma nova, como se o cliente tivesse escrito.
    """
    base = select(Conversa).where(Conversa.contato_id == contato.id, Conversa.canal_id == canal.id)
    viva = sessao.scalar(
        base.where(Conversa.status != StatusConversa.RESOLVIDA.value)
        .order_by(Conversa.ultima_mensagem_em.desc(), Conversa.id.desc())
        .limit(1)
    )
    if viva is not None:
        return viva
    recente = sessao.scalar(base.order_by(Conversa.ultima_mensagem_em.desc(), Conversa.id.desc()).limit(1))
    if recente is not None:
        return recente
    return obter_ou_criar_conversa(sessao, contato, canal)[0]


def registrar_do_celular(
    sessao, canal: Canal, adaptador: AdaptadorCanal, recebida: MensagemRecebida
) -> Mensagem | None:
    """Mensagem que o dono mandou pelo próprio WhatsApp (fromMe): entra no
    histórico como SAÍDA "Enviada pelo celular" e NÃO é reenviada. Assim a
    equipe vê a conversa inteira. None = já registrada (reentrega, ou a que o
    próprio IHchat mandou e voltou pelo webhook). Igual ao DoCelular.php."""
    if ja_processada(sessao, recebida.externo_id) is not None:
        return None
    recebida = ligar_lid(sessao, canal, recebida)
    contato = resolver_contato(sessao, canal.tipo, recebida.identificador, recebida.nome_exibicao)
    conversa = _conversa_do_celular(sessao, contato, canal)
    tinha_entrada = sessao.scalar(
        select(Mensagem.id)
        .where(Mensagem.conversa_id == conversa.id, Mensagem.direcao == Direcao.ENTRADA.value)
        .limit(1)
    ) is not None
    mensagem = Mensagem(
        conversa_id=conversa.id,
        direcao=Direcao.SAIDA.value,
        tipo=TipoMensagem.TEXTO.value,
        conteudo=recebida.conteudo,
        status=StatusMensagem.ENVIADA.value,
        externo_id=recebida.externo_id,
        metadados={**(recebida.metadados or {}), "enviada_pelo_celular": True},
        # o painel mostra "Enviada pelo celular" no lugar do atendente
        assinatura=dict(ASSINATURA_DO_CELULAR),
        criada_em=agora(),
    )
    sessao.add(mensagem)
    conversa.ultima_mensagem_em = mensagem.criada_em
    conversa.previa = resumir(recebida.conteudo, 180)
    if tinha_entrada and conversa.primeira_resposta_em is None:
        # o cliente foi atendido, só que pelo celular
        conversa.primeira_resposta_em = mensagem.criada_em
    conversa.nao_lidas = 0  # quem respondeu já leu, como numa resposta pelo painel
    sessao.flush()
    if recebida.anexos:
        guardados = svc_anexos.guardar_recebidos(sessao, adaptador, mensagem, recebida.anexos)
        if not recebida.conteudo.strip() and guardados:
            conversa.previa = f"📎 {guardados[0].nome}"
    sessao.refresh(mensagem)
    return mensagem


@rotas.post("/{canal_id}")
async def receber(canal_id: int, request: Request, sessao: Sessao) -> dict:
    canal = _canal(sessao, canal_id)
    try:
        adaptador = adaptador_para(canal)
    except CanalNaoSuportado as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    if not adaptador.recebe_webhook:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "este canal nao recebe por webhook")

    corpo = await request.body()
    cabecalhos = {chave.lower(): valor for chave, valor in request.headers.items()}
    # o token do webhook de e-mail pode vir na URL cadastrada no provedor
    # (SendGrid e Mailgun não deixam escolher cabeçalhos)
    token = request.query_params.get("token")
    if "x-ihchat-token" not in cabecalhos and token:
        cabecalhos["x-ihchat-token"] = token
    if not adaptador.verificar_assinatura(corpo, cabecalhos):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "assinatura invalida")

    tipo_conteudo = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if isinstance(adaptador, AdaptadorEmail) and tipo_conteudo in TIPOS_DE_FORMULARIO:
        # SendGrid Inbound Parse e Mailgun entregam em formulário, não em JSON
        campos, arquivos = await _formulario(request)
        lotes = [(canal, adaptador.analisar_formulario(campos, arquivos), [])]
    else:
        payload = _objeto_do_corpo(corpo)
        lotes = [
            (destino, adaptador_destino.analisar_webhook(parte), adaptador_destino.analisar_status(parte))
            for destino, adaptador_destino, parte in _destinos(sessao, canal, adaptador, payload)
        ]

    novas, conversas, atualizadas = [], {}, []
    for destino, recebidas, recibos in lotes:
        qr = destino.tipo == TipoCanal.WHATSAPP_QR.value
        for recebida in recebidas:
            if qr:
                recebida = ligar_lid(sessao, destino, recebida)
            mensagem = registrar_entrada(sessao, destino, recebida)
            if mensagem is not None:  # None = reentrega do mesmo webhook
                novas.append(mensagem)
                conversas[mensagem.conversa_id] = mensagem.conversa
        atualizadas.extend(aplicar_recibos_em_ordem(sessao, recibos) if qr else aplicar_status_externo(sessao, recibos))

    do_celular = []
    conexao_mudou = False
    if isinstance(adaptador, AdaptadorWhatsAppQR):
        for recebida in adaptador.analisar_do_celular(payload):
            mensagem = registrar_do_celular(sessao, canal, adaptador, recebida)
            if mensagem is not None:
                do_celular.append(mensagem)
                conversas[mensagem.conversa_id] = mensagem.conversa
        conexao = adaptador.analisar_conexao(payload)
        if conexao is not None:
            # dict novo: o SQLAlchemy não percebe mudança dentro do JSON carregado
            credenciais = credenciais_com_conexao(canal.credenciais or {}, *conexao)
            if credenciais is not None:
                antes = conexao_do_canal(canal)
                canal.credenciais = credenciais
                conexao_mudou = conexao_do_canal(canal) != antes
    sessao.commit()
    if conexao_mudou:
        publicar_canal(canal)  # o celular conectou ou caiu: a equipe vê na hora

    for mensagem in [*novas, *do_celular]:
        publicar_mensagem(mensagem)
    for conversa in conversas.values():
        publicar_conversa(conversa)
    for mensagem in atualizadas:
        publicar_mensagem(mensagem, "mensagem.status")

    resposta = {"recebidas": len(novas), "status_atualizados": len(atualizadas)}
    if isinstance(adaptador, AdaptadorWhatsAppQR):
        resposta["enviadas_pelo_celular"] = len(do_celular)
    return resposta

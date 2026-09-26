"""Webchat embutido no site do cliente.

O visitante nao tem login: ele recebe um token de sessao opaco, que amarra o
navegador dele a um contato e a um canal de webchat.

O QUE O VISITANTE ENXERGA. O historico unificado ("um cliente, um historico")
e da equipe; o navegador anonimo so ve o que ele mesmo conversou naquela
sessao (mesma regra de php/app/Widget/Rotas.php):

- cada sessao nova cria o SEU contato. O e-mail digitado nao prova nada (a
  chave publica esta no HTML do site; qualquer um digita o e-mail de um
  cliente), entao ele nao liga a sessao a ficha que ja tem esse endereco, nao
  renomeia ficha nenhuma e nem vai para contatos.email (onde o e-mail real que
  chegasse depois cairia na ficha do estranho): fica nas observacoes, para a
  atendente juntar as fichas se quiser;
- historico, anexos e eventos so trazem mensagens das conversas do webchat da
  sessao, do contato da sessao, criadas depois que ela abriu;
- a sessao acaba (401) se o canal for desativado ou se o contato ganhar outra
  identidade de webchat (fichas juntadas no painel).
"""
from __future__ import annotations

import random
import threading
import time
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, exists, func, select
from sqlalchemy.orm import Session

from ..db import SessaoLocal
from ..dependencias import Sessao
from ..models import (
    Anexo,
    Canal,
    Contato,
    ContatoIdentidade,
    Conversa,
    Direcao,
    Mensagem,
    SessaoWidget,
    StatusMensagem,
    TipoCanal,
    TipoMensagem,
    agora,
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
from ..serializacao import anexo_saida, assinatura_de, json_de
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

# ------------------------------------------------------------------ limites
# A unica porta da API aberta a anonimos: sem freio, um laco de "sessao +
# anexo de 20 MB" enche o disco. Os mesmos numeros do PHP (Widget/Limites.php).
SESSOES_POR_IP_HORA = 120
MENSAGENS_POR_SESSAO_MINUTO = 20
ARQUIVOS_POR_SESSAO_DIA = 40
MB_POR_SESSAO_DIA = 100
MB_POR_IP_DIA = 300
MB_DO_SITE_POR_DIA = 2048
MB = 1024 * 1024
HORAS_FAXINA = 24
CHANCE_FAXINA = 100  # uma faxina de sessoes vazias a cada N sessoes abertas


class ContadorPorIp:
    """Sessoes por hora e bytes por dia de cada IP, em memoria.

    O PHP guarda isto em arquivos (cada requisicao e um processo novo); aqui o
    processo vive, e um reinicio zerar a conta nao faz mal.
    """

    MAX_IPS = 10_000

    def __init__(self) -> None:
        self._trava = threading.Lock()
        self._dados: dict[str, dict[str, int]] = {}

    def _de(self, ip: str) -> dict[str, int]:
        if ip not in self._dados and len(self._dados) >= self.MAX_IPS:
            self._dados.clear()  # um robo com muitos IPs nao faz a memoria crescer sem fim
        return self._dados.setdefault(ip, {"hora": -1, "sessoes": 0, "dia": -1, "bytes": 0})

    def nova_sessao(self, ip: str, maximo: int = SESSOES_POR_IP_HORA) -> bool:
        hora = int(time.time()) // 3600
        with self._trava:
            contador = self._de(ip)
            if contador["hora"] != hora:
                contador.update(hora=hora, sessoes=0)
            if contador["sessoes"] >= maximo:
                return False
            contador["sessoes"] += 1
            return True

    def bytes_hoje(self, ip: str) -> int:
        dia = int(time.time()) // 86400
        with self._trava:
            contador = self._de(ip)
            return contador["bytes"] if contador["dia"] == dia else 0

    def somar_bytes(self, ip: str, quantos: int) -> None:
        dia = int(time.time()) // 86400
        with self._trava:
            contador = self._de(ip)
            if contador["dia"] != dia:
                contador.update(dia=dia, bytes=0)
            contador["bytes"] += quantos


def _contador(request: Request) -> ContadorPorIp:
    estado = request.app.state
    if not hasattr(estado, "contador_widget"):
        estado.contador_widget = ContadorPorIp()
    return estado.contador_widget


def _ip(request: Request) -> str:
    return request.client.host if request.client else ""


def _muitas(frase: str, segundos: int) -> HTTPException:
    return HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, frase, headers={"Retry-After": str(segundos)})


def _conferir_ritmo(sessao: Session, registro: SessaoWidget, maximo: int = MENSAGENS_POR_SESSAO_MINUTO) -> None:
    recentes = sessao.scalar(
        select(func.count(Mensagem.id))
        .join(Mensagem.conversa)
        .where(
            Conversa.contato_id == registro.contato_id,
            Conversa.canal_id == registro.canal_id,
            Mensagem.direcao == Direcao.ENTRADA.value,
            Mensagem.criada_em >= agora() - timedelta(minutes=1),
        )
    )
    if (recentes or 0) >= maximo:
        raise _muitas("muitas mensagens em pouco tempo; aguarde um instante", 60)


def _conferir_arquivo(sessao: Session, registro: SessaoWidget, contador: ContadorPorIp, ip: str, tamanho: int) -> None:
    desde = agora() - timedelta(hours=24)
    quantos, somados = sessao.execute(
        select(func.count(Anexo.id), func.coalesce(func.sum(Anexo.tamanho), 0))
        .join(Anexo.mensagem)
        .join(Mensagem.conversa)
        .where(
            Conversa.contato_id == registro.contato_id,
            Conversa.canal_id == registro.canal_id,
            Mensagem.direcao == Direcao.ENTRADA.value,
            Anexo.criado_em >= desde,
        )
    ).one()
    if quantos >= ARQUIVOS_POR_SESSAO_DIA or somados + tamanho > MB_POR_SESSAO_DIA * MB:
        raise _muitas("limite de arquivos desta conversa atingido; tente de novo amanhã", 3600)
    if contador.bytes_hoje(ip) + tamanho > MB_POR_IP_DIA * MB:
        raise _muitas("limite de arquivos deste endereço atingido; tente de novo amanhã", 3600)
    do_site = sessao.scalar(
        select(func.coalesce(func.sum(Anexo.tamanho), 0))
        .join(Anexo.mensagem)
        .join(Mensagem.conversa)
        .join(Conversa.canal)
        .where(
            Canal.tipo == TipoCanal.WEBCHAT.value,
            Mensagem.direcao == Direcao.ENTRADA.value,
            Anexo.criado_em >= desde,
        )
    )
    if (do_site or 0) + tamanho > MB_DO_SITE_POR_DIA * MB:
        raise HTTPException(
            status.HTTP_507_INSUFFICIENT_STORAGE,
            "o limite diário de arquivos enviados pelo site foi atingido; tente de novo amanhã",
        )


def limpar_sessoes_vazias(sessao: Session, horas: float = HORAS_FAXINA) -> tuple[int, int]:
    """Sessoes que nunca mandaram nada (e os contatos intocados que criaram).

    Mesma regra de php/app/Widget/Faxina.php: passado um dia, a sessao sem
    conversa sai, e o contato dela tambem, se nao tem conversa, outra sessao,
    identidade de outro canal nem dado preenchido pela equipe.
    """
    paradas = sessao.execute(
        select(SessaoWidget.token, SessaoWidget.contato_id)
        .where(
            SessaoWidget.criada_em < agora() - timedelta(hours=horas),
            ~exists().where(Conversa.contato_id == SessaoWidget.contato_id),
        )
        .limit(500)
    ).all()
    sessoes = contatos = 0
    for token, contato_id in paradas:
        sessoes += sessao.execute(delete(SessaoWidget).where(SessaoWidget.token == token)).rowcount or 0
        intocado = sessao.scalar(
            select(func.count(Contato.id)).where(
                Contato.id == contato_id,
                Contato.email.is_(None),
                Contato.telefone.is_(None),
                Contato.documento.is_(None),
                Contato.empresa.is_(None),
                ~exists().where(Conversa.contato_id == Contato.id),
                ~exists().where(SessaoWidget.contato_id == Contato.id),
                ~exists().where(
                    ContatoIdentidade.contato_id == Contato.id,
                    ContatoIdentidade.canal_tipo != TipoCanal.WEBCHAT.value,
                ),
            )
        )
        if intocado:
            sessao.execute(delete(ContatoIdentidade).where(ContatoIdentidade.contato_id == contato_id))
            contatos += sessao.execute(delete(Contato).where(Contato.id == contato_id)).rowcount or 0
    sessao.commit()
    return sessoes, contatos


# ----------------------------------------------------------------- sessao
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


def _visitante(sessao: Session, token: str | None) -> tuple[SessaoWidget, Canal, ContatoIdentidade]:
    """Sessao valida, com o canal e a identidade de webchat do visitante.

    401 "invalida" tambem quando o canal foi desativado (senao desligar o canal
    no meio de um abuso nao deteria quem ja tem sessao) e quando o contato tem
    mais de uma identidade de webchat (fichas juntadas: a sessao nao sabe mais
    qual e a dela).
    """
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "sessao do widget ausente")
    registro = sessao.get(SessaoWidget, token)
    canal = sessao.get(Canal, registro.canal_id) if registro is not None else None
    identidades = (
        sessao.scalars(
            select(ContatoIdentidade)
            .where(
                ContatoIdentidade.contato_id == registro.contato_id,
                ContatoIdentidade.canal_tipo == TipoCanal.WEBCHAT.value,
            )
            .order_by(ContatoIdentidade.id)
            .limit(2)
        ).all()
        if registro is not None
        else []
    )
    if (
        registro is None
        or canal is None
        or canal.tipo != TipoCanal.WEBCHAT.value
        or not canal.ativo
        or len(identidades) != 1
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "sessao do widget invalida")
    return registro, canal, identidades[0]


def _sessao_valida(token: str) -> bool:
    """Para o fluxo SSE aberto: a sessao ainda vale? (sessao de banco propria)"""
    with SessaoLocal() as sessao:
        try:
            _visitante(sessao, token)
        except HTTPException:
            return False
        return True


def _do_visitante(registro: SessaoWidget) -> tuple:
    """O recorte do visitante (Mensagem JOIN Conversa): o contato e o webchat
    da sessao, so depois que ela abriu, sem nota interna e sem resposta que
    nao saiu."""
    return (
        Conversa.contato_id == registro.contato_id,
        Conversa.canal_id == registro.canal_id,
        Mensagem.criada_em >= registro.criada_em,
        Mensagem.tipo != TipoMensagem.NOTA_INTERNA.value,
        Mensagem.status != StatusMensagem.FALHOU.value,
    )


@rotas.get("/saude")
def saude() -> dict:
    """Como o widget recebe as respostas ("stream" aqui, "consulta" no PHP).

    E o "eventos" do /saude numa rota do widget: la no PHP o /saude nao tem
    CORS, e o widget roda no site de terceiros.
    """
    return {"status": "ok", "eventos": "stream"}


@rotas.post("/sessao", response_model=WidgetSessaoSaida, status_code=status.HTTP_201_CREATED)
def abrir_sessao(dados: WidgetSessaoEntrada, sessao: Sessao, request: Request) -> WidgetSessaoSaida:
    canal = _canal_por_chave(sessao, dados.chave_publica)
    if not _contador(request).nova_sessao(_ip(request)):
        raise _muitas("muitas conversas abertas a partir deste endereço; tente de novo mais tarde", 3600)
    if random.randint(1, CHANCE_FAXINA) == 1:
        limpar_sessoes_vazias(sessao)

    nome = dados.nome or "Visitante do site"
    observacoes = f"E-mail informado no site (não confirmado): {dados.email.lower()}" if dados.email else None
    # sempre uma ficha nova (ver o comentario do modulo)
    contato = Contato(nome=nome, observacoes=observacoes)
    sessao.add(contato)
    sessao.flush()
    sessao.add(
        ContatoIdentidade(
            contato_id=contato.id,
            canal_tipo=TipoCanal.WEBCHAT.value,
            identificador=gerar_chave("v_"),
            nome_exibicao=nome,
        )
    )
    token = gerar_chave("ws_")
    sessao.add(SessaoWidget(token=token, canal_id=canal.id, contato_id=contato.id))
    # commit ANTES da resposta: a dependência (escopo "request" do FastAPI) só
    # confirma depois de a resposta sair, e o widget manda a primeira mensagem
    # na hora: sem isto, às vezes ela via "sessao do widget invalida"
    sessao.commit()
    return WidgetSessaoSaida(token=token, contato_id=contato.id, nome=nome)


@rotas.post("/mensagens", response_model=WidgetMensagemSaida, status_code=status.HTTP_201_CREATED)
def enviar(
    dados: MensagemEntrada,
    sessao: Sessao,
    x_sessao: Annotated[str | None, Header()] = None,
) -> WidgetMensagemSaida:
    registro, canal, identidade = _visitante(sessao, x_sessao)
    _conferir_ritmo(sessao, registro)

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
    registro, _canal, _identidade = _visitante(sessao, x_sessao)
    mensagens = sessao.scalars(
        select(Mensagem)
        .join(Mensagem.conversa)
        .where(*_do_visitante(registro))
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


def _para_o_visitante(token: str):
    """Troca os dados de cada evento pela WidgetMensagemSaida (o formato do
    historico), relendo as mensagens com o recorte do visitante. Nunca a
    MensagemSaida do painel (status, erro, ids da equipe, URL do painel);
    evento cuja mensagem nao passa no recorte some. O cursor nao muda."""

    def transformar(eventos: list[dict]) -> list[dict]:
        ids = [e["dados"]["id"] for e in eventos if isinstance(e.get("dados"), dict) and isinstance(e["dados"].get("id"), int)]
        if not ids:
            return []
        with SessaoLocal() as sessao:
            registro = sessao.get(SessaoWidget, token)
            if registro is None:
                return []
            mensagens = sessao.scalars(
                select(Mensagem)
                .join(Mensagem.conversa)
                .where(Mensagem.id.in_(ids), Mensagem.direcao == Direcao.SAIDA.value, *_do_visitante(registro))
            ).all()
            por_id = {m.id: json_de(_saida_widget(m, _autor_para_o_visitante(m))) for m in mensagens}
        saida = []
        for evento in eventos:
            dados = evento.get("dados")
            mensagem_id = dados.get("id") if isinstance(dados, dict) else None
            if mensagem_id in por_id:
                saida.append({"id": evento["id"], "tipo": evento["tipo"], "dados": por_id[mensagem_id]})
        return saida

    return transformar


# ------------------------------------------------------------------ anexos
# Tipos que o widget aceita pelo que os BYTES dizem (o navegador declara o que
# quiser: um HTML chamado "comprovante.png" nao pode virar pagina na origem do
# painel). O resto vira application/octet-stream, que so baixa.
ASSINATURAS_DE_ARQUIVO = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"%PDF-", "application/pdf"),
)


def tipo_pelos_bytes(dados: bytes) -> str:
    for inicio, tipo in ASSINATURAS_DE_ARQUIVO:
        if dados.startswith(inicio):
            return tipo
    if len(dados) >= 12 and dados[:4] == b"RIFF" and dados[8:12] == b"WEBP":
        return "image/webp"
    return "application/octet-stream"


@rotas.post("/anexos", response_model=WidgetMensagemSaida, status_code=status.HTTP_201_CREATED)
async def enviar_arquivo(
    sessao: Sessao,
    request: Request,
    arquivo: Annotated[UploadFile, File()],
    conteudo: Annotated[str, Form()] = "",
    x_sessao: Annotated[str | None, Header()] = None,
) -> WidgetMensagemSaida:
    """O visitante manda um print ou um PDF direto do widget."""
    registro, canal, identidade = _visitante(sessao, x_sessao)
    dados = await arquivo.read()
    if not dados:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "arquivo vazio")
    try:
        svc_anexos.conferir_tamanho(dados)
    except svc_anexos.AnexoGrande as exc:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, str(exc)) from exc
    contador, ip = _contador(request), _ip(request)
    _conferir_ritmo(sessao, registro)
    _conferir_arquivo(sessao, registro, contador, ip, len(dados))

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
                    tipo_conteudo=tipo_pelos_bytes(dados),
                )
            ],
        ),
    )
    if mensagem is None:  # pragma: no cover
        raise HTTPException(status.HTTP_409_CONFLICT, "mensagem duplicada")
    conversa = mensagem.conversa
    sessao.commit()
    contador.somar_bytes(ip, len(dados))
    publicar_mensagem(mensagem)
    publicar_conversa(conversa)
    return _saida_widget(mensagem, identidade.nome_exibicao)


@rotas.get("/anexos/{anexo_id}")
def baixar_anexo(anexo_id: int, sessao: Sessao, token: str = Query(description="token da sessão")):
    """O visitante só alcança arquivo da própria conversa, e nunca de nota interna."""
    registro, _canal, _identidade = _visitante(sessao, token)
    anexo = sessao.scalar(
        select(Anexo)
        .join(Anexo.mensagem)
        .join(Mensagem.conversa)
        .where(Anexo.id == anexo_id, *_do_visitante(registro))
    )
    if anexo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "anexo não encontrado")
    return resposta_de_arquivo(anexo)


# ----------------------------------------------------------------- eventos
@rotas.get("/stream")
def stream(
    sessao: Sessao,
    token: str = Query(description="token da sessao do widget"),
    depois: Depois = None,
    last_event_id: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    registro, _canal, _identidade = _visitante(sessao, token)
    return StreamingResponse(
        fluxo_persistido(
            cursor_inicial(depois, last_event_id),
            do_visitante(registro.contato_id),
            transformar=_para_o_visitante(token),
            validar=lambda: _sessao_valida(token),
        ),
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

    A sessão vem em ?token= (como no stream) ou no cabeçalho X-Sessao; um
    ?token= vazio conta como ausente.
    """
    chave = token or x_sessao
    registro, _canal, _identidade = _visitante(sessao, chave)
    lote = ler_desde(depois, limite, do_visitante(registro.contato_id))
    if lote["eventos"]:
        lote["eventos"] = _para_o_visitante(chave)(lote["eventos"])
    return lote

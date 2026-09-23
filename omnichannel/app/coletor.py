"""Coleta periodica dos canais que buscam as mensagens em vez de recebe-las.

Hoje sao o e-mail via IMAP e o Telegram em modo polling. O coletor passa por
todos os canais ativos e deixa cada adaptador decidir em `coletar()` se ha o
que buscar (a base devolve lista vazia), para nao conhecer provedor nenhum.

Tres extras opcionais do adaptador, lidos com getattr porque a base nao os
declara (quem nao tem, segue o caminho de sempre):
- `chave_coleta`: de onde o canal busca. Dois canais com a mesma chave
  dividiriam as conversas entre si, entao so o de menor id coleta;
- `preparar_entrada(recebida)`: a rede que a mensagem ainda precisa (os
  arquivos), feita antes de abrir a transacao;
- `confirmar_coleta()`: avisa o provedor de que o lote foi gravado. Com falha
  transitoria nao e chamado, e o lote volta inteiro na proxima coleta.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections.abc import Callable, Container, Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import partial
from typing import Any, NamedTuple

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError

from .canais.base import ErroCanal, MensagemRecebida
from .canais.registro import adaptador_para
from .config import obter_config
from .db import SessaoLocal
from .models import Canal, TipoCanal
from .servicos.mensagens import publicar_conversa, publicar_mensagem, registrar_entrada

log = logging.getLogger("omnichannel.coletor")

# IMAP e lento e caro; todo o resto e chat, em que o contato espera ver a
# resposta andar em segundos
TIPOS_LENTOS = frozenset({TipoCanal.EMAIL.value})
# nenhuma configuracao deve transformar o laco numa consulta ao banco sem pausa
PASSO_MINIMO = 1.0
# Falhas do ambiente, nao da mensagem: banco travado ou fora do ar, disco
# cheio. Param o lote sem confirma-lo; nada se perde, ele volta depois.
TRANSITORIAS = (OperationalError, OSError)
# Tempo sem erro ate dizer que o canal voltou. Um 409 de outra copia do bot
# alterna falha e sucesso a cada poucos segundos; sem a janela, o log (e o
# painel) diria "voltou" depois de cada sucesso, como se tivesse acabado.
JANELA_RECUPERACAO = 30.0


class CanalAtivo(NamedTuple):
    id: int
    tipo: str
    nome: str
    # `chave_coleta` do adaptador; None = nao busca ou nao disputa com ninguem
    chave: str | None = None


# ------------------------------------------------------------------ agenda
def intervalo_de(tipo: str, intervalo_polling: float, intervalo_coleta: float) -> float:
    return intervalo_coleta if tipo in TIPOS_LENTOS else intervalo_polling


def repetidos(canais: Iterable[CanalAtivo]) -> dict[int, CanalAtivo]:
    """Canais que buscam no mesmo lugar que outro, cada um apontando o dono.

    O dono e sempre o de menor id: com dois canais buscando o mesmo bot, cada
    getUpdates leva o que chegou desde o do outro, e as mensagens de um mesmo
    cliente se dividem ao acaso em duas conversas.
    """
    donos: dict[str, CanalAtivo] = {}
    bloqueados: dict[int, CanalAtivo] = {}
    for canal in sorted(canais, key=lambda c: c.id):
        if canal.chave is None:
            continue
        dono = donos.setdefault(canal.chave, canal)
        if dono.id != canal.id:
            bloqueados[canal.id] = dono
    return bloqueados


def erro_de_repetido(dono: CanalAtivo) -> ErroCanal:
    return ErroCanal(
        f"o canal '{dono.nome}' já busca as mensagens com estas mesmas credenciais (mesmo "
        "token ou caixa), e só ele recebe: dois canais buscando no mesmo lugar dividiriam as "
        "conversas de um cliente ao acaso. Deixe as credenciais em um canal só: desative este "
        "ou troque o token"
    )


def canais_a_coletar(
    canais: Iterable[CanalAtivo],
    ultima_coleta: Mapping[int, float],
    em_andamento: Container[int],
    agora: float,
    intervalo_polling: float,
    intervalo_coleta: float,
) -> list[CanalAtivo]:
    """Decide quem coletar neste instante, sem relogio nem banco: testavel sem dormir.

    `ultima_coleta` guarda quando cada coleta *comecou*. Canal que nunca foi
    coletado entra ja. Canal com coleta ainda em andamento fica de fora: um
    IMAP lento nao empilha coletas, e dois getUpdates simultaneos do mesmo bot
    fariam o Telegram responder 409. Canal repetido tambem (ver `repetidos`).
    """
    canais = list(canais)
    bloqueados = repetidos(canais)
    devidos = []
    for canal in canais:
        if canal.id in em_andamento or canal.id in bloqueados:
            continue
        anterior = ultima_coleta.get(canal.id)
        intervalo = intervalo_de(canal.tipo, intervalo_polling, intervalo_coleta)
        if anterior is None or agora - anterior >= intervalo:
            devidos.append(canal)
    return devidos


# ---------------------------------------------------------------- situacao
@dataclass
class SituacaoColeta:
    erro: str | None = None
    erro_desde: float | None = None
    ultimo_erro_em: float | None = None
    ultima_coleta_ok: float | None = None


def anotar_resultado(situacao: SituacaoColeta, erro: str | None, agora: float) -> str | None:
    """Atualiza a situacao de um canal e diz o que vale registrar no log.

    Devolve "falhou" (erro novo, ou diferente do anterior), "voltou" ou None.
    Mexe so no objeto recebido, como a agenda: testavel sem relogio.
    """
    if erro is not None:
        situacao.ultimo_erro_em = agora
        if erro == situacao.erro:  # a cada 3 s o mesmo aviso viraria ruido
            return None
        if situacao.erro is None:
            situacao.erro_desde = agora
        situacao.erro = erro
        return "falhou"
    situacao.ultima_coleta_ok = agora
    if situacao.erro is None or agora - (situacao.ultimo_erro_em or 0) < JANELA_RECUPERACAO:
        return None
    situacao.erro = situacao.erro_desde = None
    return "voltou"


_situacoes: dict[int, SituacaoColeta] = {}
_trava_situacoes = threading.Lock()


def _data(instante: float | None) -> datetime | None:
    return datetime.fromtimestamp(instante, timezone.utc) if instante is not None else None


def situacao(canal_id: int) -> dict | None:
    """Como anda a coleta de um canal, para a API e o cartao do canal no painel.

    O "Testar conexão" confere as credenciais, mas nao ve outra copia
    disputando o bot nem a falha que se repete a cada poucos segundos: sem
    isto, o cartao dizia "Conectado" enquanto as mensagens iam para outro
    lugar. None = o coletor ainda nao passou pelo canal (recem-ligado,
    inativo ou coletor desligado). So diz algo util de quem busca as
    mensagens (Telegram em polling, e-mail com IMAP); os demais aparecem
    sempre recebendo.
    """
    with _trava_situacoes:
        atual = _situacoes.get(canal_id)
        if atual is None:
            return None
        return {
            "recebendo": atual.erro is None,
            "erro": atual.erro,
            "erro_desde": _data(atual.erro_desde),
            "ultima_coleta_ok": _data(atual.ultima_coleta_ok),
        }


def esquecer_situacoes() -> None:
    """Zera a situacao de todos os canais (testes; equivale a reiniciar o servidor)."""
    with _trava_situacoes:
        _situacoes.clear()


def _podar_situacoes(ativos: Container[int]) -> None:
    # canal desativado ou removido nao tem mais situacao de coleta a mostrar
    with _trava_situacoes:
        for canal_id in [c for c in _situacoes if c not in ativos]:
            del _situacoes[canal_id]


def _texto_do_erro(erro: BaseException) -> str:
    if isinstance(erro, ErroCanal):
        return str(erro)
    # o texto de um erro do banco traz o SQL e os parametros (conteudo de
    # mensagem): para a tela e para comparar com o anterior, basta o comeco
    primeira = (str(erro).splitlines() or [""])[0][:200]
    return f"falha inesperada na coleta: {primeira or type(erro).__name__}"


def _anotar(canal: CanalAtivo, erro: BaseException | None) -> None:
    texto = None if erro is None else _texto_do_erro(erro)
    with _trava_situacoes:
        atual = _situacoes.setdefault(canal.id, SituacaoColeta())
        evento = anotar_resultado(atual, texto, time.time())
    if evento == "voltou":
        log.info("canal %s voltou a coletar", canal.nome)
    elif evento == "falhou" and isinstance(erro, ErroCanal):
        log.warning("canal %s: %s", canal.nome, erro)
    elif evento == "falhou":
        log.error("canal %s: falha inesperada na coleta", canal.nome, exc_info=erro)


# ------------------------------------------------------------------ coleta
def _chave_de(canal: Canal) -> str | None:
    # Roda na listagem de todos os canais: um canal com credencial estranha
    # que derrubasse isto pararia a coleta de todos. Sem chave ele so nao
    # entra na regra de repetidos; o erro dele aparece na propria coleta.
    try:
        return getattr(adaptador_para(canal), "chave_coleta", None)
    except Exception:
        return None


def canais_ativos() -> list[CanalAtivo]:
    with SessaoLocal() as sessao:
        canais = sessao.scalars(select(Canal).where(Canal.ativo.is_(True)).order_by(Canal.id))
        return [CanalAtivo(c.id, c.tipo, c.nome, _chave_de(c)) for c in canais]


def _gravar_uma_vez(canal_id: int, recebida: MensagemRecebida) -> int:
    with SessaoLocal() as sessao:
        canal = sessao.get(Canal, canal_id)
        if canal is None:  # apagado no meio do lote
            return 0
        mensagem = registrar_entrada(sessao, canal, recebida)
        sessao.commit()
        if mensagem is None:  # repetida
            return 0
        publicar_mensagem(mensagem)
        publicar_conversa(mensagem.conversa)
        return 1


def _gravar(canal_id: int, recebida: MensagemRecebida) -> int:
    """Grava uma mensagem na sua propria transacao. Devolve 1 se entrou, 0 se repetida.

    Uma transacao por mensagem, e nao por lote: a que falhar nao desfaz as dos
    outros clientes, e a trava de escrita do SQLite dura uma mensagem so.
    """
    try:
        return _gravar_uma_vez(canal_id, recebida)
    except IntegrityError:
        # Corrida com outro gravador: o mesmo cliente escrevendo a dois bots
        # ao mesmo tempo cria a identidade dele nas duas threads. Na segunda
        # tentativa a consulta ja enxerga o que a outra gravou.
        return _gravar_uma_vez(canal_id, recebida)


def coletar_canal(canal_id: int) -> int:
    """Busca e grava as mensagens de um canal. Devolve quantas entraram.

    ErroCanal sobe: quem chama decide como registrar (o laco evita repetir o
    mesmo aviso a cada poucos segundos). Falha transitoria ao gravar tambem
    sobe, sem confirmar o lote ao provedor: ele volta na proxima coleta, e o
    que ja tinha entrado morre na deduplicacao pelo id externo.
    """
    with SessaoLocal() as sessao:
        canal = sessao.get(Canal, canal_id)
        if canal is None or not canal.ativo:  # removido ou desligado desde a listagem
            return 0
        adaptador = adaptador_para(canal)
    # A rede fica fora de qualquer transacao: no SQLite quem grava segura o
    # banco inteiro, e os outros canais e o painel esperam so 5 s por ele.
    #
    # Nao se checa `configurado` aqui: aquilo mede as credenciais de ENVIO, e
    # uma caixa pode estar configurada so para leitura. `coletar()` devolve
    # lista vazia quando nao ha o que buscar.
    recebidas = adaptador.coletar()
    preparar = getattr(adaptador, "preparar_entrada", None)
    novas = 0
    for recebida in recebidas:
        try:
            if preparar is not None:
                preparar(recebida)
            novas += _gravar(canal_id, recebida)
        except TRANSITORIAS:
            raise
        except Exception:
            # Uma mensagem que nunca grava (defeito de dado) nao pode travar a
            # fila do canal para sempre: fica no log e o lote segue.
            log.exception("canal %s: mensagem %s descartada", canal.nome, recebida.externo_id)
    confirmar = getattr(adaptador, "confirmar_coleta", None)
    if confirmar is not None:
        confirmar()
    return novas


def coletar_uma_vez() -> int:
    """Coleta todos os canais ativos agora, um depois do outro. Devolve quantas mensagens entraram."""
    total = 0
    canais = canais_ativos()
    _podar_situacoes({c.id for c in canais})
    bloqueados = repetidos(canais)
    for canal in canais:
        if canal.id in bloqueados:
            _anotar(canal, erro_de_repetido(bloqueados[canal.id]))
            continue
        try:
            total += coletar_canal(canal.id)
        except Exception as exc:  # um canal quebrado nao impede os outros
            _anotar(canal, exc)
        else:
            _anotar(canal, None)
    return total


# ------------------------------------------------------------------- laco
def _em_thread(nome: str, funcao: Callable[..., Any], *args: Any) -> asyncio.Future:
    """Roda `funcao` numa thread daemon e devolve um Future deste laco.

    Nao e asyncio.to_thread de proposito: o executor padrao, como qualquer
    ThreadPoolExecutor, e esperado no desligamento, e uma API que aceita a
    conexao e nunca responde segurava o Ctrl+C pelo prazo inteiro do httpx (o
    lancador e o docker desistem em 10 s e matam o processo). Uma thread
    daemon morre com o processo sem prejuizo: a gravacao em curso e uma
    transacao que o banco desfaz, e o lote nao confirmado volta depois.
    """
    laco_atual = asyncio.get_running_loop()
    futuro = laco_atual.create_future()

    def entregar(resultado: Any, erro: BaseException | None) -> None:
        if futuro.done():  # cancelado enquanto a thread trabalhava
            return
        if erro is None:
            futuro.set_result(resultado)
        else:
            futuro.set_exception(erro)

    def rodar() -> None:
        resultado, erro = None, None
        try:
            resultado = funcao(*args)
        except Exception as exc:
            erro = exc
        try:
            laco_atual.call_soon_threadsafe(entregar, resultado, erro)
        except RuntimeError:  # o laco ja fechou: o servidor esta desligando
            pass

    threading.Thread(target=rodar, name=nome, daemon=True).start()
    return futuro


def _ao_terminar(canal: CanalAtivo, em_andamento: dict[int, asyncio.Future], futuro: asyncio.Future) -> None:
    em_andamento.pop(canal.id, None)
    if not futuro.cancelled():
        _anotar(canal, futuro.exception())


async def laco(intervalo_coleta: float | None = None, intervalo_polling: float | None = None) -> None:
    """Dispara a coleta de cada canal no seu ritmo, cada uma na sua thread.

    Coletas separadas fazem o chat continuar rapido enquanto um IMAP demora, e
    a falha de um canal nao derruba os outros nem o laco.
    """
    config = obter_config()
    lento = intervalo_coleta or config.intervalo_coleta
    rapido = intervalo_polling or config.intervalo_polling
    # nenhum canal espera mais que um passo alem do proprio prazo
    passo = max(PASSO_MINIMO, min(lento, rapido))
    ultima_coleta: dict[int, float] = {}
    em_andamento: dict[int, asyncio.Future] = {}
    try:
        while True:
            try:
                canais = await _em_thread("coletor-canais", canais_ativos)
                _podar_situacoes({c.id for c in canais})
                bloqueados = repetidos(canais)
                for canal in canais:
                    if canal.id in bloqueados:
                        _anotar(canal, erro_de_repetido(bloqueados[canal.id]))
                agora = time.monotonic()
                for canal in canais_a_coletar(canais, ultima_coleta, em_andamento, agora, rapido, lento):
                    ultima_coleta[canal.id] = agora
                    futuro = _em_thread(f"coletor-{canal.id}", coletar_canal, canal.id)
                    em_andamento[canal.id] = futuro
                    futuro.add_done_callback(partial(_ao_terminar, canal, em_andamento))
            except Exception:  # ex.: banco indisponivel; tenta de novo no proximo passo
                log.exception("falha ao agendar a coleta")
            await asyncio.sleep(passo)
    finally:
        # Nao espera as threads: sao daemon (ver _em_thread) e nao seguram o
        # desligamento nem com a API do provedor muda.
        for futuro in list(em_andamento.values()):
            futuro.cancel()

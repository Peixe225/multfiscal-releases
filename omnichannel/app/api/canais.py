"""Cadastro de canais de atendimento."""
from __future__ import annotations

import logging
import re

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from ..canais.base import ErroCanal
from ..canais.campos import CAMPOS, campos_de
from ..canais.registro import CanalNaoSuportado, adaptador_para
from ..canais.whatsapp import AdaptadorWhatsApp
from ..dependencias import AdminAtual, AtendenteAtual, Sessao
from ..models import Canal, Conversa, TipoCanal
from ..schemas import (
    CampoCanalSaida,
    CanalAtualizacao,
    CanalEntrada,
    CanalSaida,
    CredenciaisCanalSaida,
    TesteConexaoSaida,
)
from ..security import gerar_chave
from ..serializacao import canal_saida

log = logging.getLogger("omnichannel.canais")

rotas = APIRouter(prefix="/api/canais", tags=["canais"])

# o nome da constante 422 mudou entre versoes do Starlette; o numero, nao
INVALIDO = 422

# chaves fora do contrato de campos.py (gravadas a mao, via curl) que parecem
# senha: na duvida, sao tratadas como secretas e nunca voltam ao navegador
_PARECE_SEGREDO = re.compile(r"senha|segredo|secret|token|password", re.IGNORECASE)

# Para onde vai cada senha guardada: (senhas na ordem em que o adaptador as
# usa, campos que escolhem o servidor). Sem isto, trocar so o host e clicar em
# "Testar" entregava a senha guardada a um servidor qualquer, contornando o
# /credenciais que nunca a devolve. O IMAP entra com a senha do SMTP quando
# nao tem a sua, por isso ela aparece nas duas linhas.
_DESTINOS_DOS_SEGREDOS: dict[str, tuple[tuple[tuple[str, ...], tuple[str, ...]], ...]] = {
    TipoCanal.EMAIL.value: (
        (("smtp_senha",), ("smtp_host", "smtp_porta", "smtp_usuario")),
        (("imap_senha", "smtp_senha"), ("imap_host", "imap_porta", "imap_usuario")),
    ),
}


def segredos_iniciais(tipo: TipoCanal) -> dict:
    """Chave publica e segredo de webhook que o proprio sistema gera no cadastro.

    So o Telegram usa um segredo escolhido por nos: ele vai no secret_token do
    setWebhook e volta em cada entrega. A Meta assina o WhatsApp com o App
    Secret do app dela (o campo `segredo_app`), entao um segredo gerado aqui
    faria recusar com 401 todo webhook real. O e-mail generico nao assina nada.
    """
    return {
        "chave_publica": gerar_chave("wc_") if tipo is TipoCanal.WEBCHAT else None,
        "segredo_webhook": gerar_chave() if tipo is TipoCanal.TELEGRAM else None,
    }


def _e_secreta(tipo: str, chave: str) -> bool:
    for campo in campos_de(tipo):
        if campo.chave == chave:
            return campo.secreto
    return bool(_PARECE_SEGREDO.search(chave))


def _rotulo(tipo: str, chave: str) -> str:
    """Como o formulario chama o campo: e o nome que o admin reconhece no erro."""
    for campo in campos_de(tipo):
        if campo.chave == chave:
            return campo.rotulo
    return chave


def _destinos_de(tipo: str, segredo: str) -> list[str]:
    """Campos que, mudados, exigem digitar `segredo` de novo (vai para /tipos)."""
    return [
        destino
        for segredos, destinos in _DESTINOS_DOS_SEGREDOS.get(tipo, ())
        if segredos[0] == segredo
        for destino in destinos
    ]


def _normalizar(tipo: str, chave: str, valor):
    if isinstance(valor, str):
        valor = valor.strip()  # token colado com espaco ou quebra de linha
    if valor is None or valor == "" or not chave.endswith("_porta"):
        return valor
    # gravada como texto livre, "porta 587" so estourava no envio, como 500 e
    # sem a resposta registrada; aqui o admin ve o erro ao salvar
    try:
        porta = int(str(valor))
    except ValueError:
        porta = 0
    if not 1 <= porta <= 65535:
        padrao = next((c.padrao for c in campos_de(tipo) if c.chave == chave and c.padrao), "")
        exemplo = f" (ex.: {padrao})" if padrao else ""
        raise HTTPException(
            INVALIDO,
            f"{_rotulo(tipo, chave)} precisa ser um número de 1 a 65535{exemplo}",
        )
    return str(porta)


def _exigir_senha_para_servidor_novo(tipo: str, atuais: dict, resultado: dict, enviadas: dict) -> None:
    """Senha guardada so segue para um servidor novo se quem mudou a digitar.

    Mesma regra de Grafana e Jenkins: saber a senha e condicao para escolher
    para onde ela vai. Sem senha guardada nao ha o que vazar, e destino
    apagado nao recebe nada.
    """
    for segredos, destinos in _DESTINOS_DOS_SEGREDOS.get(tipo, ()):
        mudaram = [d for d in destinos if resultado.get(d) and str(resultado[d]) != str(atuais.get(d) or "")]
        usada = next((s for s in segredos if resultado.get(s)), None)
        if not mudaram or usada is None:
            continue
        digitada = enviadas.get(usada)
        if isinstance(digitada, str) and digitada.strip():
            continue
        raise HTTPException(
            INVALIDO,
            f"ao trocar {', '.join(_rotulo(tipo, d) for d in mudaram)}, digite de novo a "
            f"{_rotulo(tipo, segredos[0])}: a senha guardada só vai para outro servidor se você a confirmar",
        )


def _mesclar_credenciais(tipo: str, atuais: dict, enviadas: dict, limpar: list[str] | tuple = ()) -> dict:
    """Aplica sobre as credenciais gravadas so o que a tela mandou.

    Segredo em branco ou ausente = manter: a tela nunca recebe o valor de
    volta, entao nao teria como reenvia-lo, e um formulario salvo sem mexer no
    token nao pode desligar o canal. Por isso apagar um segredo e um pedido
    explicito (`limpar`). Campo comum em branco = limpar, senao nao haveria
    como tirar um servidor IMAP que deixou de existir.
    """
    resultado = {k: v for k, v in atuais.items() if k not in limpar}
    for chave, valor in enviadas.items():
        valor = _normalizar(tipo, chave, valor)
        vazio = valor is None or valor == ""
        if _e_secreta(tipo, chave):
            if not vazio:
                resultado[chave] = valor
        elif vazio:
            resultado.pop(chave, None)
        else:
            resultado[chave] = valor
    _exigir_senha_para_servidor_novo(tipo, atuais, resultado, enviadas)
    return resultado


def _canal(sessao, canal_id: int) -> Canal:
    canal = sessao.get(Canal, canal_id)
    if canal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "canal nao encontrado")
    return canal


@rotas.get("", response_model=list[CanalSaida])
def listar(sessao: Sessao, _: AtendenteAtual) -> list[CanalSaida]:
    canais = sessao.scalars(select(Canal).order_by(Canal.nome))
    return [canal_saida(c) for c in canais]


@rotas.get("/tipos", response_model=dict[str, list[CampoCanalSaida]])
def tipos(_: AtendenteAtual) -> dict:
    """Campos de credencial de cada tipo: a tela de canais monta o formulario daqui."""
    return {
        tipo: [{**campo.como_dict(), "destinos": _destinos_de(tipo, campo.chave)} for campo in campos]
        for tipo, campos in CAMPOS.items()
    }


@rotas.post("", response_model=CanalSaida, status_code=status.HTTP_201_CREATED)
def criar(dados: CanalEntrada, sessao: Sessao, _: AdminAtual) -> CanalSaida:
    canal = Canal(
        nome=dados.nome,
        tipo=dados.tipo.value,
        credenciais=_mesclar_credenciais(dados.tipo.value, {}, dados.credenciais),
        ativo=dados.ativo,
        **segredos_iniciais(dados.tipo),
    )
    sessao.add(canal)
    sessao.flush()
    return canal_saida(canal)


@rotas.get("/{canal_id}/credenciais", response_model=CredenciaisCanalSaida)
def ver_credenciais(canal_id: int, sessao: Sessao, _: AdminAtual) -> CredenciaisCanalSaida:
    canal = _canal(sessao, canal_id)
    atuais = canal.credenciais or {}
    adaptador = adaptador_para(canal)
    return CredenciaisCanalSaida(
        credenciais={k: v for k, v in atuais.items() if not _e_secreta(canal.tipo, k)},
        secretos_definidos=[k for k, v in atuais.items() if v and _e_secreta(canal.tipo, k)],
        # so o do Telegram tem uso fora daqui: vai no secret_token do setWebhook.
        # O de um WhatsApp antigo e legado e nao e o que a Meta usa para assinar
        segredo_webhook=canal.segredo_webhook if canal.tipo == TipoCanal.TELEGRAM.value else None,
        chave_publica=canal.chave_publica,
        campos_obrigatorios=list(adaptador.campos_obrigatorios),
        # o valor do segredo legado nunca sai, mas a tela precisa saber que ele
        # existe: com ele, toda entrega da Meta leva 401
        assinatura=adaptador.origem_assinatura if isinstance(adaptador, AdaptadorWhatsApp) else None,
    )


@rotas.patch("/{canal_id}", response_model=CanalSaida)
def atualizar(canal_id: int, dados: CanalAtualizacao, sessao: Sessao, _: AdminAtual) -> CanalSaida:
    canal = _canal(sessao, canal_id)
    # antes de mexer no canal: uma credencial recusada nao salva o resto pela metade
    if dados.credenciais is not None or dados.limpar:
        # atribuicao de um dict novo: o SQLAlchemy nao percebe mudanca feita
        # dentro do JSON ja carregado
        canal.credenciais = _mesclar_credenciais(
            canal.tipo, canal.credenciais or {}, dados.credenciais or {}, dados.limpar
        )
    if dados.nome is not None:
        canal.nome = dados.nome  # o schema ja aparou e mediu
    if canal.tipo == TipoCanal.WHATSAPP.value and canal.segredo_webhook:
        # O segredo da coluna so conta sem App Secret nas credenciais, e pelo
        # cadastro antigo era aleatorio. Com o App Secret preenchido ele morre
        # aqui: senao voltaria a recusar tudo no dia em que o App Secret saisse
        credenciais = canal.credenciais or {}
        if "segredo_webhook" in dados.limpar or credenciais.get("segredo_app") or credenciais.get("segredo_webhook"):
            canal.segredo_webhook = None
    if dados.ativo is not None:
        canal.ativo = dados.ativo
    sessao.flush()
    return canal_saida(canal)


@rotas.post("/{canal_id}/testar", response_model=TesteConexaoSaida)
def testar(canal_id: int, sessao: Sessao, _: AdminAtual) -> TesteConexaoSaida:
    """Confere no provedor se as credenciais funcionam.

    Sempre 200: credencial errada e o resultado esperado de um teste, nao uma
    falha da requisicao, e o painel mostra a frase como veio.
    """
    canal = _canal(sessao, canal_id)
    try:
        adaptador = adaptador_para(canal)
    except CanalNaoSuportado as exc:
        return TesteConexaoSaida(ok=False, mensagem=str(exc))
    if canal.tipo == TipoCanal.WEBCHAT.value and not canal.ativo:
        # sem provedor, o "teste" do webchat e so o canal estar ligado
        return TesteConexaoSaida(
            ok=False, mensagem="o webchat está desativado: o widget não abre no site até você ativá-lo"
        )
    # com os rotulos do formulario: "preencha: token, id_numero" nao diz nada
    # a quem nunca viu o codigo
    faltando = [_rotulo(canal.tipo, c) for c in adaptador.campos_obrigatorios if not adaptador.credenciais.get(c)]
    if faltando:
        return TesteConexaoSaida(ok=False, mensagem=f"preencha: {', '.join(faltando)}")
    try:
        mensagem = adaptador.verificar_conexao()
    except ErroCanal as exc:
        return TesteConexaoSaida(ok=False, mensagem=str(exc))
    except Exception:
        # um defeito no adaptador nao pode deixar o admin olhando para um 500
        log.exception("verificacao do canal %s terminou com erro inesperado", canal.id)
        return TesteConexaoSaida(
            ok=False, mensagem="erro inesperado ao verificar a conexão; detalhes no log do servidor"
        )
    # o provedor aceitou, mas "Funcionou" em verde esconderia o que ainda
    # impede (ou ameaca) o canal de receber
    alertas = []
    if isinstance(adaptador, AdaptadorWhatsApp) and adaptador.alerta_de_assinatura:
        alertas.append(adaptador.alerta_de_assinatura)
    if not canal.ativo:
        alertas.append("o canal está desativado: não recebe mensagens novas até você ativá-lo")
    return TesteConexaoSaida(ok=True, mensagem=mensagem, alerta="; ".join(alertas) or None)


@rotas.delete("/{canal_id}", status_code=status.HTTP_204_NO_CONTENT)
def remover(canal_id: int, sessao: Sessao, _: AdminAtual) -> None:
    canal = _canal(sessao, canal_id)
    conversas = sessao.scalar(
        select(func.count()).select_from(Conversa).where(Conversa.canal_id == canal.id)
    )
    if conversas:
        # "um cliente, um historico": apagar o canal levaria junto as conversas
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"o canal tem {conversas} conversa(s) no histórico e não pode ser removido; "
            "desative-o para parar de receber sem perder nada",
        )
    sessao.delete(canal)
    # o commit so acontece depois da resposta: sem o flush, uma falha aqui
    # viraria um 204 de um canal que continua cadastrado
    sessao.flush()

"""Cadastro de canais de atendimento."""
from __future__ import annotations

import logging
import re
from urllib.parse import quote, urlsplit

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from ..canais.base import ErroCanal
from ..canais.campos import campos_de, modo_telegram_padrao, todos_os_campos
from ..canais.registro import CanalNaoSuportado, adaptador_para
from ..canais.telegram import AdaptadorTelegram
from ..canais.whatsapp import AdaptadorWhatsApp
from ..canais.whatsapp_qr import (
    CHAVE_WEBHOOK,
    DESCONECTADO,
    ERRO,
    PROVEDOR_PADRAO,
    PROVEDORES,
    AdaptadorWhatsAppQR,
    EstadoConexao,
    credenciais_com_conexao,
)
from ..config import url_publica, url_publica_https
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
from ..serializacao import canal_saida, url_webhook

log = logging.getLogger("ihchat.canais")

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
    # a API key da Evolution vai para o servidor que o admin escreveu; a da
    # Z-API vai sempre para api.z-api.io, então não tem destino a proteger
    TipoCanal.WHATSAPP_QR.value: ((("api_key",), ("url_servidor",)),),
}


# tipos cujo cadastro gera segredo_webhook (Telegram: secret_token do
# setWebhook; e-mail e WhatsApp pelo QR Code: o token que o provedor manda ao
# webhook, na URL cadastrada nele)
TIPOS_COM_SEGREDO = (TipoCanal.TELEGRAM.value, TipoCanal.EMAIL.value, TipoCanal.WHATSAPP_QR.value)


def segredos_iniciais(tipo: TipoCanal) -> dict:
    """Chave publica e segredo de webhook que o proprio sistema gera no cadastro.

    Telegram e e-mail usam um segredo escolhido por nos: o do Telegram vai no
    secret_token do setWebhook e volta em cada entrega; o do e-mail e o token
    que o provedor manda ao webhook (X-IHchat-Token ou ?token=). A Meta assina o
    WhatsApp com o App Secret do app dela (o campo `segredo_app`), entao um
    segredo gerado aqui faria recusar com 401 todo webhook real.
    """
    return {
        "chave_publica": gerar_chave("wc_") if tipo is TipoCanal.WEBCHAT else None,
        "segredo_webhook": gerar_chave() if tipo.value in TIPOS_COM_SEGREDO else None,
    }


def _com_modo_efetivo(tipo: str, credenciais: dict) -> dict:
    """Telegram sem modo_recebimento ganha o modo padrao desta instalacao GRAVADO.

    O painel, o coletor e o outro servidor (PHP, cujo padrao com HTTPS e
    webhook) passam a ver o mesmo modo, em vez de cada um supor o seu.
    """
    modo = credenciais.get("modo_recebimento")
    if tipo == TipoCanal.TELEGRAM.value and not (isinstance(modo, str) and modo.strip()):
        return {**credenciais, "modo_recebimento": modo_telegram_padrao()}
    provedor = credenciais.get("provedor")
    if tipo == TipoCanal.WHATSAPP_QR.value and not (isinstance(provedor, str) and provedor.strip()):
        # o formulário só manda o que mudou: sem isto, "zapi" (o padrão da
        # tela) nunca ficaria gravado e cada lado suporia o seu
        return {**credenciais, "provedor": PROVEDOR_PADRAO}
    return credenciais


def _garantir_segredo(canal: Canal) -> None:
    """Canal de e-mail cadastrado antes do segredo (ou gravado a mao) ganha um
    na primeira vez que o admin o abre: sem segredo o webhook recusa tudo."""
    if canal.tipo in (TipoCanal.EMAIL.value, TipoCanal.WHATSAPP_QR.value) and not canal.segredo_webhook:
        canal.segredo_webhook = gerar_chave()


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
    if tipo == TipoCanal.WHATSAPP_QR.value and valor is not None and valor != "":
        return _normalizar_whatsapp_qr(tipo, chave, valor)
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


def _normalizar_whatsapp_qr(tipo: str, chave: str, valor):
    """Provedor e endereço da Evolution conferidos ao salvar, com a frase na
    tela, em vez de só estourar no primeiro QR Code. Igual ao Credenciais.php."""
    if chave == "provedor":
        provedor = str(valor).lower()
        if provedor not in PROVEDORES:
            raise HTTPException(INVALIDO, f"{_rotulo(tipo, chave)} precisa ser zapi ou evolution")
        return provedor
    if chave == "url_servidor":
        endereco = str(valor).rstrip("/")
        partes = urlsplit(endereco)
        if partes.scheme.lower() not in ("http", "https") or not partes.netloc:
            raise HTTPException(
                INVALIDO, f"{_rotulo(tipo, chave)} precisa começar com https:// (ou http://), ex.: https://evolution.suaempresa.com.br"
            )
        return endereco
    return valor


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
        for tipo, campos in todos_os_campos().items()
    }


@rotas.post("", response_model=CanalSaida, status_code=status.HTTP_201_CREATED)
def criar(dados: CanalEntrada, sessao: Sessao, _: AdminAtual) -> CanalSaida:
    canal = Canal(
        nome=dados.nome,
        tipo=dados.tipo.value,
        credenciais=_com_modo_efetivo(dados.tipo.value, _mesclar_credenciais(dados.tipo.value, {}, dados.credenciais)),
        ativo=dados.ativo,
        **segredos_iniciais(dados.tipo),
    )
    sessao.add(canal)
    sessao.flush()
    return canal_saida(canal)


@rotas.get("/{canal_id}/credenciais", response_model=CredenciaisCanalSaida)
def ver_credenciais(canal_id: int, sessao: Sessao, _: AdminAtual) -> CredenciaisCanalSaida:
    canal = _canal(sessao, canal_id)
    _garantir_segredo(canal)
    # o modo que o servidor usa de fato: sem ele, a tela supunha "polling" num
    # canal que o servidor tratava como webhook
    atuais = _com_modo_efetivo(canal.tipo, canal.credenciais or {})
    adaptador = adaptador_para(canal)
    return CredenciaisCanalSaida(
        credenciais={k: v for k, v in atuais.items() if not _e_secreta(canal.tipo, k)},
        secretos_definidos=[k for k, v in atuais.items() if v and _e_secreta(canal.tipo, k)],
        # Telegram: vai no secret_token do setWebhook. E-mail: o token do
        # webhook de entrada (X-IHchat-Token ou ?token=). O de um WhatsApp antigo
        # e legado e nao e o que a Meta usa para assinar
        segredo_webhook=canal.segredo_webhook if canal.tipo in TIPOS_COM_SEGREDO else None,
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
        canal.credenciais = _com_modo_efetivo(
            canal.tipo,
            _mesclar_credenciais(canal.tipo, canal.credenciais or {}, dados.credenciais or {}, dados.limpar),
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
    if isinstance(adaptador, AdaptadorTelegram) and adaptador.sem_webhook_cadastrado:
        # modo webhook sem setWebhook: o canal nao recebe nada. Com endereco
        # publico HTTPS, o "Salvar e testar" ja deixa o canal recebendo
        if canal.ativo and url_publica_https():
            conexao = _conectar_telegram(sessao, canal)
            if not conexao.ok:
                return TesteConexaoSaida(ok=False, mensagem=f"{mensagem}; ao cadastrar o webhook: {conexao.mensagem}")
            mensagem = re.sub(r", mas o bot ainda não tem webhook cadastrado.*$", "", mensagem) + ". " + conexao.mensagem
        else:
            alertas.append(
                "o bot ainda não tem webhook cadastrado: nenhuma mensagem chega até você usar "
                "'Conectar webhook' (com o endereço público HTTPS) ou trocar para 'polling'"
            )
    if isinstance(adaptador, AdaptadorWhatsAppQR):
        if adaptador.ultimo_estado is not None and adaptador.ultimo_estado.status != ERRO:
            _gravar_conexao(canal, adaptador.ultimo_estado.status, adaptador.ultimo_estado.numero)
        if adaptador.alerta_de_conexao:
            alertas.append(adaptador.alerta_de_conexao)
        if not (canal.credenciais or {}).get(CHAVE_WEBHOOK):
            alertas.append(
                "o webhook ainda não foi conectado: sem ele as mensagens dos clientes não chegam. "
                "Use “Conectar webhook” (precisa do endereço público desta instalação)"
            )
    if not canal.ativo:
        alertas.append("o canal está desativado: não recebe mensagens novas até você ativá-lo")
    return TesteConexaoSaida(ok=True, mensagem=mensagem, alerta="; ".join(alertas) or None)


def _definir_modo(canal: Canal, modo: str) -> None:
    # dict novo: o SQLAlchemy nao percebe mudanca dentro do JSON carregado
    canal.credenciais = {**(canal.credenciais or {}), "modo_recebimento": modo}


def _conectar_telegram(sessao, canal: Canal) -> TesteConexaoSaida:
    """setWebhook do canal Telegram com o segredo dele, e o canal passa ao modo
    webhook. Usado pelo botao "Conectar webhook" e pelo testar."""
    if not url_publica_https():
        return TesteConexaoSaida(
            ok=False,
            mensagem="o endereço público desta instalação (url_publica, com https) não está configurado: "
            "o Telegram só entrega mensagens num endereço HTTPS público. Enquanto isso, use o modo polling",
        )
    adaptador = AdaptadorTelegram(canal)
    if not adaptador.configurado:
        return TesteConexaoSaida(ok=False, mensagem="preencha: Token do bot")
    if not canal.segredo_webhook:
        # canal cadastrado a mao, sem segredo: sem ele qualquer um que
        # soubesse a URL poderia forjar mensagens de clientes
        canal.segredo_webhook = gerar_chave()
    try:
        mensagem = adaptador.conectar_webhook(url_webhook(canal.id), canal.segredo_webhook)
    except ErroCanal as exc:
        return TesteConexaoSaida(ok=False, mensagem=str(exc))
    _definir_modo(canal, "webhook")
    sessao.flush()
    alerta = None if canal.ativo else (
        "o canal está desativado: as entregas do Telegram serão recusadas (409) até você ativá-lo"
    )
    return TesteConexaoSaida(ok=True, mensagem=mensagem, alerta=alerta)


@rotas.post("/{canal_id}/conectar-webhook", response_model=TesteConexaoSaida)
def conectar_webhook(canal_id: int, sessao: Sessao, _: AdminAtual) -> TesteConexaoSaida:
    """Telegram: cadastra no bot o webhook deste canal (url_publica +
    /webhooks/{id}) com o secret_token do canal, e passa o canal para o modo
    webhook. Sempre 200 com {ok, mensagem, alerta}, como o testar. O token do
    bot nunca passa pelo navegador."""
    canal = _canal(sessao, canal_id)
    if canal.tipo == TipoCanal.WHATSAPP_QR.value:
        return _conectar_whatsapp_qr(sessao, canal)
    if canal.tipo != TipoCanal.TELEGRAM.value:
        if canal.tipo == TipoCanal.WHATSAPP.value:
            mensagem = (
                f"no WhatsApp o webhook é cadastrado no painel da Meta: use a URL {url_webhook(canal.id)}"
                " e o token de verificação deste canal"
            )
        else:
            mensagem = "este tipo de canal não tem webhook a conectar"
        return TesteConexaoSaida(ok=False, mensagem=mensagem)
    return _conectar_telegram(sessao, canal)


# ------------------------------------------------ WhatsApp pelo QR Code
def _faltando(canal: Canal, adaptador) -> list[str]:
    """Os campos obrigatórios em branco, com os rótulos do formulário."""
    return [_rotulo(canal.tipo, c) for c in adaptador.campos_obrigatorios if not adaptador.credenciais.get(c)]


def _gravar_conexao(canal: Canal, estado: str, numero: str | None) -> None:
    """estado_conexao (e o número) nas credenciais, só se mudou."""
    novas = credenciais_com_conexao(canal.credenciais or {}, estado, numero)
    if novas is not None:
        canal.credenciais = novas  # dict novo: o SQLAlchemy percebe a mudança


def _sem_segredo_do_canal(canal: Canal, texto: str) -> str:
    """O token do webhook vai na URL cadastrada no provedor: nunca numa frase da tela."""
    return texto.replace(canal.segredo_webhook, "<oculto>") if canal.segredo_webhook else texto


def _adaptador_qr(canal: Canal) -> tuple[AdaptadorWhatsAppQR | None, str | None]:
    """(adaptador, None) ou (None, a frase que explica por que não dá)."""
    if canal.tipo != TipoCanal.WHATSAPP_QR.value:
        return None, "este canal não conecta pelo QR Code: só o tipo WhatsApp (QR Code)"
    adaptador = AdaptadorWhatsAppQR(canal)
    faltando = _faltando(canal, adaptador)
    if faltando:
        return None, f"preencha: {', '.join(faltando)}"
    return adaptador, None


@rotas.get("/{canal_id}/qr")
def qr_code(canal_id: int, sessao: Sessao, _: AdminAtual, so_estado: bool = False) -> dict:
    """Estado da conexão e o QR Code a ler, perguntados ao provedor.

    Sempre 200 {status, qr, numero, mensagem}: "erro" é um resultado que o
    painel mostra, não uma falha da requisição. Token e API key nunca saem;
    o QR é só a imagem. A Evolution cria a instância se ela não existir.

    ?so_estado=1 só confere se conectou (sem gerar QR, "qr" sempre null): é
    o que o painel consulta a cada ~3 s; o QR novo, a cada ~15 s, porque a
    Z-API pede de 10 a 20 s entre um QR e outro.
    """
    canal = _canal(sessao, canal_id)
    adaptador, motivo = _adaptador_qr(canal)
    if adaptador is None:
        return EstadoConexao(ERRO, mensagem=motivo or "").como_dict()
    try:
        estado = adaptador.estado_qr(com_qr=not so_estado)
    except Exception:
        log.exception("QR Code do canal %s terminou com erro inesperado", canal.id)
        estado = EstadoConexao(ERRO, mensagem="erro inesperado ao falar com o provedor; detalhes no log do servidor")
    estado.mensagem = _sem_segredo_do_canal(canal, estado.mensagem)
    if estado.status != ERRO:
        _gravar_conexao(canal, estado.status, estado.numero)
        sessao.flush()
    return estado.como_dict()


@rotas.post("/{canal_id}/desconectar", response_model=TesteConexaoSaida)
def desconectar(canal_id: int, sessao: Sessao, _: AdminAtual) -> TesteConexaoSaida:
    """Desconecta o número no provedor (o celular sai de "Aparelhos conectados")."""
    canal = _canal(sessao, canal_id)
    if canal.tipo != TipoCanal.WHATSAPP_QR.value:
        return TesteConexaoSaida(ok=False, mensagem="este tipo de canal não tem conexão por QR Code a desconectar")
    adaptador, motivo = _adaptador_qr(canal)
    if adaptador is None:
        return TesteConexaoSaida(ok=False, mensagem=motivo or "")
    try:
        mensagem = adaptador.desconectar()
    except ErroCanal as exc:
        return TesteConexaoSaida(ok=False, mensagem=_sem_segredo_do_canal(canal, str(exc)))
    _gravar_conexao(canal, DESCONECTADO, None)
    sessao.flush()
    return TesteConexaoSaida(ok=True, mensagem=mensagem)


def _conectar_whatsapp_qr(sessao, canal: Canal) -> TesteConexaoSaida:
    """Cadastra no provedor url_publica + /webhooks/{id}?token=<segredo do canal>.

    O token vai na URL porque a Z-API não deixa escolher cabeçalhos; a rota
    do webhook o confere em tempo constante. Nenhuma frase devolvida o mostra.
    """
    adaptador, motivo = _adaptador_qr(canal)
    if adaptador is None:
        return TesteConexaoSaida(ok=False, mensagem=motivo or "")
    if not url_publica():
        return TesteConexaoSaida(
            ok=False,
            mensagem="o endereço público desta instalação (url_publica) não está configurado: sem ele o "
            "provedor não tem para onde mandar as mensagens. Configure-o (com https) e tente de novo",
        )
    if adaptador.chave_provedor == "zapi" and not url_publica_https():
        return TesteConexaoSaida(
            ok=False, mensagem="a Z-API só entrega em endereço HTTPS: configure o endereço público (url_publica) com https://"
        )
    if not canal.segredo_webhook:
        canal.segredo_webhook = gerar_chave()
    endereco = url_webhook(canal.id)
    try:
        mensagem = adaptador.conectar_webhook(f"{endereco}?token={quote(canal.segredo_webhook, safe='')}")
    except ErroCanal as exc:
        return TesteConexaoSaida(ok=False, mensagem=_sem_segredo_do_canal(canal, str(exc)))
    canal.credenciais = {**(canal.credenciais or {}), CHAVE_WEBHOOK: endereco}
    sessao.flush()
    alerta = None if canal.ativo else (
        "o canal está desativado: as entregas do provedor serão recusadas (409) até você ativá-lo"
    )
    return TesteConexaoSaida(ok=True, mensagem=mensagem, alerta=alerta)


@rotas.post("/{canal_id}/remover-webhook", response_model=TesteConexaoSaida)
def remover_webhook(canal_id: int, sessao: Sessao, _: AdminAtual) -> TesteConexaoSaida:
    """Telegram: apaga o webhook do bot e volta o canal ao polling."""
    canal = _canal(sessao, canal_id)
    if canal.tipo != TipoCanal.TELEGRAM.value:
        return TesteConexaoSaida(ok=False, mensagem="este tipo de canal não tem webhook a remover")
    try:
        mensagem = AdaptadorTelegram(canal).remover_webhook()
    except ErroCanal as exc:
        return TesteConexaoSaida(ok=False, mensagem=str(exc))
    _definir_modo(canal, "polling")
    sessao.flush()
    return TesteConexaoSaida(ok=True, mensagem=mensagem)


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

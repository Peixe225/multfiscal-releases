"""Envia o pacote do OmniChannel 2 para a Hostinger (public_html/omnichannel2/).

    # 1. gere o pacote (ou use --empacotar)
    ../.venv/bin/python scripts/empacotar_php.py

    # 2. credenciais de upload (hPanel/API "generate upload URL"; expiram): SÓ no ambiente
    export HOSTINGER_UPLOAD_URL='https://...'      # "url" da resposta
    export HOSTINGER_AUTH_KEY='...'                # "auth_key"
    export HOSTINGER_REST_AUTH_KEY='...'           # "rest_auth_key"

    export HOSTINGER_SITE='oprojeto.online'        # o site (domínio) de destino: identifica o
                                                   # alvo no registro do que já foi enviado

    # 3. envie; na primeira vez, crie também o código de instalação
    ../.venv/bin/python scripts/implantar_hostinger.py --criar-codigo
    ../.venv/bin/python scripts/implantar_hostinger.py              # deploys seguintes: só o que mudou
    ../.venv/bin/python scripts/implantar_hostinger.py --simular    # mostra o que iria, sem rede
    ../.venv/bin/python scripts/implantar_hostinger.py --ja-apaguei app/Api/Antiga.php
                                                   # depois de apagar à mão um arquivo que saiu do pacote

    # 4. confira no ar (https forçado, nada interno acessível, painel e widget),
    #    pelo subdomínio E pelo domínio principal (public_html/omnichannel2 fica
    #    dentro do site de oprojeto.online: é por lá que config e dados vazariam)
    ../.venv/bin/python scripts/implantar_hostinger.py --conferir https://atendimento.oprojeto.online
    ../.venv/bin/python scripts/implantar_hostinger.py --conferir https://atendimento.oprojeto.online \
        --conferir-pasta https://oprojeto.online/omnichannel2     # (é o padrão deduzido)

Protocolo (API de arquivos da Hostinger, TUS 1.0.0), arquivo por arquivo:

    POST  {url}/{caminho}?override=true   X-Auth, X-Auth-Rest, Tus-Resumable: 1.0.0,
                                          Upload-Length: <bytes>, Upload-Offset: 0   -> 201
    PATCH {url}/{caminho}?override=true   ... Content-Type: application/offset+octet-stream,
                                          Upload-Offset: <n>, corpo = pedaço        -> 204 + Upload-Offset

O {caminho} é relativo a public_html (ex.: omnichannel2/app/autoload.php).
Falha temporária (rede, 5xx, 409 de offset) é retentada com espera crescente;
no meio de um arquivo, o HEAD diz de onde continuar (se o servidor não souber
responder ao HEAD, o arquivo recomeça do zero). 401/403 param tudo na hora
(credencial errada ou expirada — gere outra URL).

Ordem: a camada de banco (app/Banco/*.php) e as migrações
(app/Banco/Migracoes/) PRIMEIRO; depois o resto do código (app/, cron,
console); o front (web/); por último .htaccess, instalar.php e index.php.
O PHP carrega cada classe do disco a cada requisição, então durante o envio
convivem arquivos novos e velhos: não existe troca atômica pela API de upload.
Mandar a migração antes do código que usa a coluna nova fecha o pior caso
(o código novo gravando numa coluna que ainda não existe: 500 e mensagem de
cliente perdida). Isso vale porque as migrações são aditivas e idempotentes
(tabela, coluna anulável ou com padrão, índice): o código velho ignora a
coluna nova. A janela de "meia versão" fica menor, mas não some; um modo de
manutenção durante o envio é pendência da fundação.

O que NÃO faz: apagar arquivos no servidor (a API de upload não apaga). Se um
arquivo sair do pacote (ex.: uma rota app/Api/X.php removida), ele continua lá
e continua carregado — app/Api/*.php, */Rotas.php, migrações e tarefas são
descobertos sozinhos, e um deles quebrado derruba a API inteira. A lista "no
servidor e fora do pacote" fica guardada no registro e REPETE em todo envio
(também no --simular e no --tudo) até você apagar pelo Gerenciador de
Arquivos e confirmar com --ja-apaguei CAMINHO (ou --limpar-removidos).

Registro do que já foi enviado (dist/implantado.json): por alvo, com o sha256
de cada arquivo. O alvo é o --site (ou HOSTINGER_SITE) mais o --destino; sem
--site, o endereço da URL de upload (esquema, servidor e caminho, sem a query).
Dois sites no mesmo servidor de arquivos não se confundem mais: um alvo sem
registro recebe tudo, e o início da saída diz qual alvo foi reconhecido e
quantos arquivos ele já tem.

Segurança: as chaves só vêm do ambiente, nunca de arquivo versionado, nunca
são impressas. O código de instalação é gerado aqui (secrets), enviado para
omnichannel2/dados/instalacao.codigo (fora do public) e mostrado UMA vez.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]  # omnichannel/
DIST = RAIZ / "dist"
ENV_URL = "HOSTINGER_UPLOAD_URL"
ENV_AUTH = "HOSTINGER_AUTH_KEY"
ENV_AUTH_REST = "HOSTINGER_REST_AUTH_KEY"
ENV_SITE = "HOSTINGER_SITE"
NEGAR_TUDO = "Require all denied\n"


class ErroFatal(Exception):
    """Não adianta tentar de novo (credencial recusada, resposta sem sentido)."""

    def __init__(self, mensagem: str, status: int | None = None):
        super().__init__(mensagem)
        self.status = status


class ErroTemporario(Exception):
    """Rede, 5xx, 409: vale tentar de novo."""


@dataclass
class Resposta:
    status: int
    cabecalhos: dict[str, str]

    def cabecalho(self, nome: str) -> str | None:
        return self.cabecalhos.get(nome.lower())


class ClienteTus:
    """Cliente TUS 1.0.0 mínimo para a API de upload da Hostinger (só biblioteca padrão)."""

    def __init__(
        self,
        url: str,
        auth: str,
        auth_rest: str,
        *,
        tentativas: int = 5,
        espera: float = 1.0,
        pedaco: int = 5 * 1024 * 1024,
        timeout: float = 60.0,
    ):
        if not url.lower().startswith(("https://", "http://")):
            raise ErroFatal("URL de upload inválida (esperado https://...)")
        self.url = url.rstrip("/")
        self._auth = auth
        self._auth_rest = auth_rest
        self.tentativas = max(1, tentativas)
        self.espera = espera
        self.pedaco = max(1, pedaco)
        self.timeout = timeout
        host = (urllib.parse.urlsplit(self.url).hostname or "").lower()
        # servidor local (testes): nada de proxy do ambiente no meio
        manipuladores = [urllib.request.ProxyHandler({})] if host in ("127.0.0.1", "localhost", "::1") else []
        self._abrir = urllib.request.build_opener(*manipuladores).open
        self.requisicoes = 0

    # ------------------------------------------------------------------ HTTP

    def _pedir(self, metodo: str, url: str, cabecalhos: dict[str, str], corpo: bytes | None = None) -> Resposta:
        todos = {"X-Auth": self._auth, "X-Auth-Rest": self._auth_rest, "Tus-Resumable": "1.0.0", **cabecalhos}
        requisicao = urllib.request.Request(url, data=corpo, method=metodo, headers=todos)
        self.requisicoes += 1
        try:
            with self._abrir(requisicao, timeout=self.timeout) as r:
                r.read()
                return Resposta(r.status, {k.lower(): v for k, v in r.headers.items()})
        except urllib.error.HTTPError as erro:
            status = erro.code
            try:
                detalhe = erro.read()[:200].decode("utf-8", "replace")
            except OSError:
                detalhe = ""
            if status in (401, 403):
                raise ErroFatal(
                    f"{metodo} recusado com {status}: credencial errada ou expirada; gere outra URL de upload", status
                ) from None
            if status == 409 or status == 423 or status == 429 or status >= 500:
                raise ErroTemporario(f"{metodo} {status} {detalhe}".strip()) from None
            raise ErroFatal(f"{metodo} {self._sem_segredo(url)} respondeu {status}: {detalhe}", status) from None
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as erro:
            raise ErroTemporario(f"{metodo}: falha de rede ({getattr(erro, 'reason', erro)})") from None

    def _sem_segredo(self, url: str) -> str:
        """URL sem query nem usuário/senha (onde um token poderia estar), mas com a porta."""
        partes = urllib.parse.urlsplit(url)
        porta = f":{partes.port}" if partes.port else ""
        return f"{partes.scheme}://{partes.hostname}{porta}{partes.path}"

    def endereco(self, caminho: str) -> str:
        return f"{self.url}/{urllib.parse.quote(caminho.lstrip('/'), safe='/')}?override=true"

    # ------------------------------------------------------------------ TUS

    def enviar(self, caminho: str, dados: bytes) -> None:
        """Envia um arquivo inteiro (cria e manda os pedaços), com retentativa."""
        ultimo: Exception | None = None
        for tentativa in range(self.tentativas):
            if tentativa:
                time.sleep(self.espera * (2 ** (tentativa - 1)))
            try:
                self._enviar_uma_vez(caminho, dados)
                return
            except ErroTemporario as erro:
                ultimo = erro
        raise ErroFatal(f"{caminho}: desisti depois de {self.tentativas} tentativas ({ultimo})")

    def _enviar_uma_vez(self, caminho: str, dados: bytes) -> None:
        url = self.endereco(caminho)
        criado = self._pedir("POST", url, {"Upload-Length": str(len(dados)), "Upload-Offset": "0"}, b"")
        if criado.status not in (200, 201, 204):
            raise ErroFatal(f"{caminho}: criação respondeu {criado.status}")
        # TUS padrão devolve Location; a Hostinger aceita o mesmo endereço
        local = criado.cabecalho("location")
        destino = urllib.parse.urljoin(url, local) if local else url
        if destino != url and "override=" not in destino:
            destino += ("&" if "?" in destino else "?") + "override=true"
        deslocamento = 0
        falhas_seguidas = 0
        while deslocamento < len(dados):
            pedaco = dados[deslocamento:deslocamento + self.pedaco]
            try:
                r = self._pedir(
                    "PATCH",
                    destino,
                    {"Content-Type": "application/offset+octet-stream", "Upload-Offset": str(deslocamento)},
                    pedaco,
                )
                novo = r.cabecalho("upload-offset")
                deslocamento = int(novo) if novo is not None and novo.isdigit() else deslocamento + len(pedaco)
                falhas_seguidas = 0
            except ErroTemporario:
                falhas_seguidas += 1
                if falhas_seguidas >= self.tentativas:
                    raise
                time.sleep(self.espera * falhas_seguidas)
                # onde o servidor parou? sem resposta útil, recomeça o arquivo
                deslocamento = self._deslocamento(destino)
        if deslocamento != len(dados):
            raise ErroTemporario(f"{caminho}: servidor confirmou {deslocamento} de {len(dados)} bytes")

    def _deslocamento(self, destino: str) -> int:
        """Onde o servidor parou. Sem resposta útil, ErroTemporario: o arquivo recomeça.

        A documentação da Hostinger só fala de POST e PATCH; um HEAD recusado
        (404, 405, 400...) não pode derrubar o deploy por causa de um único 5xx
        num PATCH. Só credencial recusada (401/403) continua fatal.
        """
        try:
            r = self._pedir("HEAD", destino, {})
        except ErroFatal as erro:
            if erro.status in (401, 403):
                raise
            raise ErroTemporario(f"servidor não soube dizer o deslocamento ({erro}); recomeçando o arquivo") from None
        valor = r.cabecalho("upload-offset")
        if valor is None or not valor.isdigit():
            raise ErroTemporario("servidor não informou o deslocamento; recomeçando o arquivo")
        return int(valor)


# ---------------------------------------------------------------- pacote


def prioridade(caminho: str) -> tuple[int, str]:
    """Ordem de envio: esquema antes do código que o usa; front; por último a entrada.

    Sem isso, a ordem alfabética mandaria app/Api e app/Atendimento antes de
    app/Banco/Migracoes: o código novo gravaria numa coluna que ainda não
    existe (500) até a migração chegar. As migrações são aditivas, então o
    esquema novo pode chegar antes do código (o velho ignora a coluna nova);
    a camada de banco (Esquema, Banco) vai antes delas, para uma migração nova
    nunca rodar num Esquema velho.
    """
    if caminho.startswith("app/Banco/Migracoes/"):
        return (-1, caminho)
    if caminho.startswith("app/Banco/") and not caminho.endswith(".htaccess"):
        return (-2, caminho)
    if caminho == "public/index.php":
        return (4, caminho)  # o front controller por último (muda pouco; não é uma trava)
    if caminho == "public/instalar.php":
        return (3, caminho)
    if caminho.endswith(".htaccess"):
        return (2, caminho)
    if caminho.startswith(("public/", "web/")):
        return (1, caminho)
    return (0, caminho)


# descobertos sozinhos pelo sistema: enquanto estiverem no servidor, rodam
_CARREGADOS_SOZINHOS = (
    (re.compile(r"app/Api/[^/]+\.php"), "rota carregada sozinha"),
    (re.compile(r"app/[^/]+/Rotas\.php"), "rota carregada sozinha"),
    (re.compile(r"app/Banco/Migracoes/M[^/]*\.php"), "migração aplicada sozinha"),
    (re.compile(r"app/(?:[^/]+/)?Tarefas/[^/]+\.php"), "tarefa que o cron roda"),
)


def carregado_sozinho(caminho: str) -> str | None:
    """Por que um arquivo esquecido no servidor ainda roda (ou None se só roda quando usado)."""
    for padrao, motivo in _CARREGADOS_SOZINHOS:
        if padrao.fullmatch(caminho):
            return motivo
    return None


def arquivos_do_pacote(pasta: Path) -> dict[str, str]:
    """{caminho relativo: sha256} de tudo no pacote."""
    resultado = {}
    for arquivo in sorted(p for p in pasta.rglob("*") if p.is_file()):
        resultado[arquivo.relative_to(pasta).as_posix()] = hashlib.sha256(arquivo.read_bytes()).hexdigest()
    return resultado


def _ler_registro(arquivo: Path) -> dict:
    try:
        tudo = json.loads(arquivo.read_text())
    except (OSError, ValueError):
        return {}
    return tudo if isinstance(tudo, dict) else {}


def carregar_estado(arquivo: Path, chave: str) -> dict[str, str]:
    valor = _ler_registro(arquivo).get(chave, {})
    return valor if isinstance(valor, dict) else {}


def carregar_removidos(arquivo: Path, chave: str) -> list[str]:
    """Arquivos que saíram do pacote e ainda não foram confirmados como apagados no servidor."""
    removidos = _ler_registro(arquivo).get("removidos", {})
    lista = removidos.get(chave, []) if isinstance(removidos, dict) else []
    return [c for c in lista if isinstance(c, str)]


def outros_alvos(arquivo: Path, chave: str, destino: str) -> int:
    """Quantos OUTROS alvos do registro têm o mesmo destino (ex.: outro site, outra URL)."""
    return sum(
        1 for k, v in _ler_registro(arquivo).items()
        if k != chave and isinstance(v, dict) and v and k.endswith(f":{destino}")
    )


def ultima_chave(arquivo: Path, destino: str) -> str | None:
    """A chave do último envio real para esse destino (para simular sem a URL de upload)."""
    try:
        valor = json.loads(arquivo.read_text()).get("ultimo", {}).get(destino)
    except (OSError, ValueError, AttributeError):
        return None
    return valor if isinstance(valor, str) else None


def gravar_estado(
    arquivo: Path,
    chave: str,
    enviados: dict[str, str],
    destino: str | None = None,
    removidos: list[str] | None = None,
) -> None:
    """Grava o que o alvo tem; `removidos` (se informado) substitui a lista pendente dele."""
    tudo = _ler_registro(arquivo)
    tudo[chave] = enviados
    if removidos is not None:
        todos = tudo.get("removidos") if isinstance(tudo.get("removidos"), dict) else {}
        if removidos:
            todos[chave] = sorted(set(removidos))
        else:
            todos.pop(chave, None)
        tudo["removidos"] = todos
    if destino is not None:
        # lembra qual alvo foi o último: o --simular sem as variáveis de
        # ambiente compara com ele em vez de listar tudo como novo
        ultimos = tudo.get("ultimo") if isinstance(tudo.get("ultimo"), dict) else {}
        ultimos[destino] = chave
        tudo["ultimo"] = ultimos
    temporario = arquivo.with_suffix(".tmp")
    temporario.write_text(json.dumps(tudo, indent=2, sort_keys=True))
    temporario.replace(arquivo)


def chave_do_destino(url: str, destino: str, site: str | None = None) -> str:
    """Identifica o alvo no arquivo de estado sem guardar a URL (pode ter token).

    Com o site (--site/HOSTINGER_SITE), o alvo é ele: a URL de upload expira e
    pode mudar a cada geração sem perder o registro. Sem o site, entra o
    endereço inteiro da URL (esquema, servidor, porta e caminho, sem a query):
    só o servidor faria dois sites do mesmo servidor de arquivos dividirem o
    registro, e o segundo receberia "0 arquivos, tudo sem mudança" e ficaria
    vazio. Se o caminho mudar a cada URL, o pior caso é reenviar tudo.
    """
    if site:
        base = "site|" + site.strip().lower().rstrip("/")
    else:
        partes = urllib.parse.urlsplit(url)
        porta = f":{partes.port}" if partes.port else ""
        base = f"{partes.scheme.lower()}://{(partes.hostname or url).lower()}{porta}{partes.path.rstrip('/')}"
    return hashlib.sha256(f"{base}|{destino}".encode()).hexdigest()[:16] + f":{destino}"


def normalizar_caminho(caminho: str, destino: str) -> str:
    """'public_html/omnichannel2/app/X.php', 'omnichannel2/app/X.php' ou '/app/X.php' -> 'app/X.php'."""
    caminho = caminho.strip().replace("\\", "/").lstrip("/")
    for prefixo in ("public_html/", f"{destino}/"):
        if caminho.startswith(prefixo):
            caminho = caminho[len(prefixo):]
    return caminho


def avisar_removidos(removidos: list[str], destino: str) -> None:
    """A lista que repete em todo envio até o dono confirmar com --ja-apaguei."""
    if not removidos:
        return
    print(f"ATENÇÃO: {len(removidos)} arquivo(s) no servidor e fora do pacote. A API de upload não apaga:")
    print("apague pelo Gerenciador de Arquivos e confirme com --ja-apaguei CAMINHO (ou --limpar-removidos).")
    for caminho in removidos:
        motivo = carregado_sozinho(caminho)
        marca = f"   <- {motivo.upper()}: continua rodando enquanto existir" if motivo else ""
        print(f"  public_html/{destino}/{caminho}{marca}")


# ------------------------------------------------------ conferência no ar


class _SemRedirecionar(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return None


def _buscar(
    url: str,
    timeout: float = 20.0,
    seguir: bool = False,
    metodo: str = "GET",
    cabecalhos: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], bytes]:
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    manipuladores: list = [] if seguir else [_SemRedirecionar()]
    if host in ("127.0.0.1", "localhost", "::1"):
        manipuladores.append(urllib.request.ProxyHandler({}))
    abrir = urllib.request.build_opener(*manipuladores).open
    pedido = urllib.request.Request(
        url, method=metodo, headers={"User-Agent": "omnichannel-conferencia", **(cabecalhos or {})}
    )
    try:
        with abrir(pedido, timeout=timeout) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read(4096)
    except urllib.error.HTTPError as erro:
        return erro.code, {k.lower(): v for k, v in erro.headers.items()}, erro.read(4096)


# Resultado de cada checagem: ("ok" | "FALHA" | "aviso", texto)
Resultado = tuple[str, str]

# Dentro de public_html/omnichannel2/: nada disto pode sair pela web. Pelo
# subdomínio (DocumentRoot = public/) eles nem existem; pelo domínio principal
# (public_html é a raiz de oprojeto.online) só o php/.htaccess os protege.
INTERNOS = (
    "config.php", "config.exemplo.php", "cron.php", "console.php", "VERSAO", ".htaccess",
    "app/", "app/autoload.php", "app/Nucleo/Config.php",
    "dados/", "dados/instalacao.codigo", "dados/instalacao.tentativas", "dados/omnichannel.sqlite",
    "dados/logs/", "dados/anexos/", "web/painel.html", "public/web/painel.html",
)


def dominio_da_pasta(base: str, destino: str = "omnichannel2") -> str | None:
    """https://atendimento.oprojeto.online -> https://oprojeto.online/omnichannel2 (o domínio pai)."""
    partes = urllib.parse.urlsplit(base)
    host = partes.hostname or ""
    rotulos = host.split(".")
    if len(rotulos) < 3 or host.replace(".", "").isdigit() or ":" in host:
        return None
    return f"{partes.scheme}://{'.'.join(rotulos[1:])}/{destino.strip('/')}"


def conferir_pasta(pasta: str, deduzida: bool = False) -> list[Resultado]:
    """Sonda os arquivos internos pelo caminho do domínio principal.

    Qualquer 200 é falha: um .php executado devolve 200 vazio (sinal de que o
    .htaccess não protegeu), e o resto sairia inteiro. 403/404 são o esperado.
    """
    pasta = pasta.rstrip("/")
    resultados: list[Resultado] = []
    for caminho in INTERNOS:
        url = f"{pasta}/{caminho}"
        try:
            status, cab, corpo = _buscar(url, seguir=True)
        except (OSError, ValueError) as erro:
            if deduzida:
                resultados.append(("aviso", f"{url} não verificado ({erro}); informe --conferir-pasta"))
                return resultados
            resultados.append(("FALHA", f"{url} inacessível para conferir: {erro}"))
            continue
        if status == 200:
            pista = ""
            if b"<?php" in corpo or b"chave_secreta" in corpo:
                pista = ", código-fonte à mostra"
            elif corpo.startswith(b"SQLite format"):
                pista = ", banco à mostra"
            elif b"Index of" in corpo:
                pista = ", listagem de pasta"
            elif caminho.endswith(".html") and "frame-ancestors" not in cab.get("content-security-policy", ""):
                pista = ", página sem proteção contra moldura"
            resultados.append(("FALHA", f"{url} ACESSÍVEL (200{pista}): o .htaccess de omnichannel2/ não protegeu"))
        else:
            resultados.append(("ok", f"{url} protegido ({status})"))
    return resultados


def origem_do_site(base: str) -> str:
    """O site que embute o widget: o domínio pai (https://atendimento.x.com -> https://x.com)."""
    pasta = dominio_da_pasta(base)
    if pasta is None:
        return "https://site-do-cliente.example"
    partes = urllib.parse.urlsplit(pasta)
    return f"{partes.scheme}://{partes.netloc}"


def conferir_widget_em_outro_site(base: str, origem: str) -> list[Resultado]:
    """O widget colado em outro site: o navegador só deixa chamar a API com CORS.

    Com a origem bloqueada (ex.: OMNI_ORIGENS_PERMITIDAS=[] na VPS), o balão
    aparece mas não abre sessão nem envia mensagem — e nada no servidor avisa.
    """
    resultados: list[Resultado] = []
    status, cab, _ = _buscar(
        f"{base}/api/widget/sessao",
        metodo="OPTIONS",
        cabecalhos={"Origin": origem, "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type"},
    )
    liberada = cab.get("access-control-allow-origin") in ("*", origem)
    resultados.append((
        "ok" if status in (200, 204) and liberada else "FALHA",
        f"widget em {origem} abre sessão (CORS do /api/widget/sessao: {status}, "
        f"allow-origin={cab.get('access-control-allow-origin')})"
        + ("" if liberada else "; libere a origem: origens_permitidas no config.php, OMNI_ORIGENS_PERMITIDAS na VPS"),
    ))
    # o widget pergunta ao /api/widget/saude se usa stream ou consulta; sem CORS
    # ele cai num modo provisório e, depois de a aba ficar oculta, para de
    # receber respostas
    status, cab, _ = _buscar(f"{base}/api/widget/saude", cabecalhos={"Origin": origem})
    liberada = cab.get("access-control-allow-origin") in ("*", origem)
    resultados.append((
        "ok" if status == 200 and liberada else "FALHA",
        f"/api/widget/saude legível pelo widget em {origem} ({status}, "
        f"allow-origin={cab.get('access-control-allow-origin')})"
        + ("" if liberada else ": em outro site o widget não descobre o modo de tempo real"),
    ))
    return resultados


def conferir_no_ar(base: str, origem: str | None = None) -> list[Resultado]:
    """Checagens HTTP depois do deploy: o sistema responde e nada interno vaza.

    Serve para o que o teste local não cobre: o .htaccess de verdade no
    LiteSpeed (https forçado, código e dados inalcançáveis) e o CORS do widget
    colado no site principal. Os arquivos internos pelo domínio principal
    ficam em conferir_pasta().
    """
    base = base.rstrip("/")
    resultados: list[Resultado] = []

    def anotar(ok: bool, texto: str) -> None:
        resultados.append(("ok" if ok else "FALHA", texto))

    try:
        status, _, corpo = _buscar(f"{base}/saude")
        dados = json.loads(corpo or b"{}") if status == 200 else {}
        anotar(status == 200 and dados.get("status") == "ok", f"/saude responde ({status}, eventos={dados.get('eventos')})")
    except (OSError, ValueError) as erro:
        anotar(False, f"/saude inacessível: {erro}")
        return resultados

    status, cab, _ = _buscar(f"{base}/painel")
    anotar(status == 200 and cab.get("x-content-type-options") == "nosniff"
           and "frame-ancestors" in cab.get("content-security-policy", ""), f"/painel com nosniff e frame-ancestors ({status})")
    # o painel não pode sair também como arquivo estático, sem os cabeçalhos
    for pagina in ("/web/painel.html", "/web/simulador.html", "/web/demo.html"):
        status, cab, _ = _buscar(base + pagina)
        anotar(status != 200 or "frame-ancestors" in cab.get("content-security-policy", ""),
               f"{pagina} não sai direto ({status})")
    status, cab, _ = _buscar(f"{base}/widget.js")
    anotar(status == 200 and "javascript" in cab.get("content-type", ""), f"/widget.js é javascript ({status})")
    resultados += conferir_widget_em_outro_site(base, origem or origem_do_site(base))
    status, cab, _ = _buscar(f"{base}/api/rota-que-nao-existe")
    anotar(status == 404 and cab.get("cache-control") == "no-store", f"/api/* sem cache ({status})")
    status, _, _ = _buscar(f"{base}/instalar")
    anotar(status in (200, 404), "/instalar " + ("aberto: instale agora" if status == 200 else "fechado (já instalado)")
           + f" ({status})")

    # nada interno pode sair: nem código, nem config, nem dados
    for caminho in ("/config.php", "/app/autoload.php", "/app/Nucleo/Config.php", "/cron.php", "/console.php",
                    "/dados/instalacao.codigo", "/dados/omnichannel.sqlite", "/.htaccess", "/public/../config.php",
                    "/config.exemplo.php", "/VERSAO"):
        status, _, corpo = _buscar(base + caminho)
        vazou = status == 200 and (b"<?php" in corpo or b"chave_secreta" in corpo or b"SQLite format" in corpo
                                   or caminho.endswith((".codigo", "VERSAO")))
        anotar(not vazou, f"{caminho} protegido ({status})")

    partes = urllib.parse.urlsplit(base)
    if partes.scheme == "https":
        status, cab, _ = _buscar(f"http://{partes.netloc}/saude")
        anotar(status in (301, 302, 307, 308) and cab.get("location", "").startswith("https://"),
               f"http redireciona para https ({status})")
    return resultados


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Envia dist/omnichannel2 para public_html/omnichannel2 via TUS")
    parser.add_argument("--pasta", type=Path, default=DIST / "omnichannel2", help="pacote gerado pelo empacotar_php.py")
    parser.add_argument("--destino", default="omnichannel2", help="pasta dentro de public_html (padrão: omnichannel2)")
    parser.add_argument(
        "--site", default=os.environ.get(ENV_SITE, ""),
        help=f"site de destino (ex.: oprojeto.online; padrão: ${ENV_SITE}); identifica o alvo no registro do "
             "que já foi enviado, mesmo quando a URL de upload muda",
    )
    parser.add_argument("--empacotar", action="store_true", help="roda o empacotar_php.py antes")
    parser.add_argument("--criar-codigo", action="store_true", help="gera e envia dados/instalacao.codigo (1ª instalação)")
    parser.add_argument("--tudo", action="store_true", help="envia tudo, mesmo o que não mudou desde o último envio")
    parser.add_argument("--simular", action="store_true", help="só lista o que seria enviado (sem rede)")
    parser.add_argument(
        "--ja-apaguei", action="append", default=[], metavar="CAMINHO",
        help="confirma que apagou no servidor um arquivo que saiu do pacote (repita para vários); só atualiza o registro",
    )
    parser.add_argument("--limpar-removidos", action="store_true",
                        help="confirma que apagou TODOS os arquivos da lista 'fora do pacote'; só atualiza o registro")
    parser.add_argument("--tentativas", type=int, default=5)
    parser.add_argument("--espera", type=float, default=1.0, help="segundos da 1ª espera entre tentativas (dobra a cada uma)")
    parser.add_argument("--pedaco-mb", type=float, default=5.0, help="tamanho de cada PATCH")
    parser.add_argument("--estado", type=Path, default=None, help="onde lembrar o que já foi enviado (padrão: ao lado do pacote)")
    parser.add_argument("--conferir", metavar="URL", help="só confere o sistema no ar (ex.: https://atendimento.oprojeto.online)")
    parser.add_argument(
        "--conferir-pasta", metavar="URL",
        help="a pasta pelo domínio principal (ex.: https://oprojeto.online/omnichannel2); "
             "padrão: deduzida do --conferir, tirando o primeiro nome do endereço",
    )
    parser.add_argument(
        "--origem-widget", metavar="URL",
        help="site que embute o widget, para conferir o CORS (padrão: o domínio principal, ex.: https://oprojeto.online)",
    )
    args = parser.parse_args(argv)

    if args.conferir or args.conferir_pasta:
        resultados: list[Resultado] = conferir_no_ar(args.conferir, args.origem_widget) if args.conferir else []
        pasta_url = args.conferir_pasta or (dominio_da_pasta(args.conferir, args.destino) if args.conferir else None)
        if pasta_url:
            print(f"arquivos internos pelo domínio principal: {pasta_url}")
            resultados += conferir_pasta(pasta_url, deduzida=not args.conferir_pasta)
        for estado, texto in resultados:
            print(f"  {estado:<5}  {texto}")
        falhas = sum(1 for estado, _ in resultados if estado == "FALHA")
        oks = sum(1 for estado, _ in resultados if estado == "ok")
        print(f"{oks} ok, {falhas} falha(s)")
        return 1 if falhas else 0

    destino = args.destino.strip("/")
    if not destino or ".." in destino.split("/"):
        print("--destino inválido", file=sys.stderr)
        return 2
    site = args.site.strip()
    url = os.environ.get(ENV_URL, "")
    pasta = args.pasta.resolve()
    estado_arquivo = args.estado or pasta.parent / "implantado.json"
    if site or url:
        chave: str | None = chave_do_destino(url, destino, site or None)
    else:
        # sem site nem URL (típico do --simular) o alvo é o do último envio real
        chave = ultima_chave(estado_arquivo, destino)

    if args.ja_apaguei or args.limpar_removidos:
        return confirmar_apagados(estado_arquivo, chave, destino, args.ja_apaguei, args.limpar_removidos, pasta)

    if args.empacotar:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import empacotar_php  # noqa: PLC0415

        if empacotar_php.main(["--saida", str(args.pasta.resolve().parent), "--silencioso"]) != 0:
            return 1

    if not (pasta / "public" / "index.php").is_file():
        print(f"pacote não encontrado em {pasta}; rode scripts/empacotar_php.py (ou use --empacotar)", file=sys.stderr)
        return 2

    atuais = arquivos_do_pacote(pasta)
    registrados = carregar_estado(estado_arquivo, chave) if chave else {}
    # --tudo reenvia tudo, mas NÃO esquece o que o servidor já tem: é daí que
    # sai a lista do que ficou lá e saiu do pacote
    anteriores = {} if args.tudo else registrados
    pendentes = sorted((c for c, h in atuais.items() if anteriores.get(c) != h), key=prioridade)
    removidos_antes = carregar_removidos(estado_arquivo, chave) if chave else []
    fora_do_pacote = sorted((set(registrados) | set(removidos_antes)) - set(atuais))

    # qual alvo foi reconhecido: um alvo novo por engano (outro site, outra
    # URL) aparece aqui antes de qualquer envio
    if chave:
        origem = f"site {site}" if site else (
            f"URL de upload em {urllib.parse.urlsplit(url).hostname}" if url else "o do último envio")
        print(f"alvo {chave.split(':')[0][:8]} ({origem}) -> public_html/{destino}: "
              f"{len(registrados)} arquivo(s) registrados de envios anteriores")
        if not registrados:
            print("  nenhum envio registrado para este alvo: todos os arquivos vão.")
            if outros_alvos(estado_arquivo, chave, destino):
                print(f"  (o registro tem envios para OUTRO alvo com o mesmo destino; se for o mesmo site com "
                      f"outra URL de upload, informe --site / {ENV_SITE} para manter o histórico)")
    elif args.simular:
        print(f"(sem {ENV_URL}/{ENV_SITE} e sem envio anterior registrado para {destino}: tudo aparece como novo)")

    if args.simular:
        for caminho in pendentes:
            print(f"  enviaria  {destino}/{caminho}")
        if args.criar_codigo:
            print(f"  enviaria  {destino}/dados/instalacao.codigo (+ dados/.htaccess)")
        print(f"{len(pendentes)} de {len(atuais)} arquivos seriam enviados (simulação, nada saiu daqui)")
        avisar_removidos(fora_do_pacote, destino)
        return 0

    auth, auth_rest = os.environ.get(ENV_AUTH, ""), os.environ.get(ENV_AUTH_REST, "")
    faltando = [n for n, v in ((ENV_URL, url), (ENV_AUTH, auth), (ENV_AUTH_REST, auth_rest)) if not v]
    if faltando:
        print("faltam variáveis de ambiente: " + ", ".join(faltando), file=sys.stderr)
        print("(gere a URL de upload no hPanel/API da Hostinger; nunca grave as chaves em arquivo versionado)", file=sys.stderr)
        return 2
    assert chave is not None

    cliente = ClienteTus(
        url, auth, auth_rest, tentativas=args.tentativas, espera=args.espera, pedaco=max(1, int(args.pedaco_mb * 1024 * 1024))
    )
    # a lista do que saiu do pacote é gravada ANTES de enviar: um envio
    # interrompido (ou um --tudo) não a perde. O registro parte do que o
    # servidor já tem (mesmo no --tudo): interrompido, o que não foi reenviado
    # continua valendo com o conteúdo de antes
    enviados = dict(registrados)
    if set(fora_do_pacote) != set(removidos_antes):
        gravar_estado(estado_arquivo, chave, enviados, destino, removidos=fora_do_pacote)
    inicio = time.monotonic()
    total_bytes = 0
    try:
        for n, caminho in enumerate(pendentes, 1):
            dados = (pasta / caminho).read_bytes()
            cliente.enviar(f"{destino}/{caminho}", dados)
            total_bytes += len(dados)
            enviados[caminho] = atuais[caminho]
            # a cada arquivo: um envio interrompido continua de onde parou
            gravar_estado(estado_arquivo, chave, enviados, destino)
            print(f"  [{n}/{len(pendentes)}] {destino}/{caminho} ({len(dados)} bytes)")
        codigo = None
        if args.criar_codigo:
            codigo = secrets.token_urlsafe(24)
            cliente.enviar(f"{destino}/dados/.htaccess", NEGAR_TUDO.encode())
            cliente.enviar(f"{destino}/dados/instalacao.codigo", (codigo + "\n").encode())
    except ErroFatal as erro:
        print(f"envio interrompido: {erro}", file=sys.stderr)
        print("rode de novo: o que já foi confirmado não é reenviado", file=sys.stderr)
        avisar_removidos(fora_do_pacote, destino)
        return 1

    # o registro fica com o que o pacote tem; o que saiu dele vai para a
    # lista de removidos, que repete em todo envio até o --ja-apaguei
    gravar_estado(estado_arquivo, chave, {c: h for c, h in enviados.items() if c in atuais}, destino,
                  removidos=fora_do_pacote)

    duracao = time.monotonic() - inicio
    print(f"{len(pendentes)} arquivo(s), {total_bytes / 1024:.1f} KiB em {duracao:.1f}s ({cliente.requisicoes} requisições); "
          f"{len(atuais) - len(pendentes)} sem mudança")
    avisar_removidos(fora_do_pacote, destino)
    if codigo:
        print()
        print("Código de instalação (anote; ele não fica em lugar nenhum além do servidor):")
        print(f"  {codigo}")
        print("Abra https://<seu subdomínio>/instalar e informe esse código.")
    return 0


def confirmar_apagados(
    estado_arquivo: Path, chave: str | None, destino: str, caminhos: list[str], todos: bool, pasta: Path
) -> int:
    """--ja-apaguei / --limpar-removidos: tira da lista o que o dono já apagou no servidor."""
    if chave is None:
        print(f"não sei qual é o alvo: informe --site (ou {ENV_SITE}) ou as variáveis de upload", file=sys.stderr)
        return 2
    atuais = set(arquivos_do_pacote(pasta)) if (pasta / "public" / "index.php").is_file() else set()
    registrados = carregar_estado(estado_arquivo, chave)
    pendentes = set(carregar_removidos(estado_arquivo, chave))
    if atuais:
        pendentes |= set(registrados) - atuais
    if todos:
        apagados = set(pendentes)
    else:
        apagados = {normalizar_caminho(c, destino) for c in caminhos}
        desconhecidos = sorted(apagados - pendentes)
        if desconhecidos:
            print("não estavam na lista de removidos (nada mudou para eles): " + ", ".join(desconhecidos), file=sys.stderr)
        apagados &= pendentes
    restantes = sorted(pendentes - apagados)
    gravar_estado(
        estado_arquivo, chave, {c: h for c, h in registrados.items() if c not in apagados}, destino, removidos=restantes
    )
    for caminho in sorted(apagados):
        print(f"  apagado (confirmado): public_html/{destino}/{caminho}")
    if restantes:
        avisar_removidos(restantes, destino)
    else:
        print("nenhum arquivo pendente fora do pacote.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

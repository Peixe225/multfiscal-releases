"""Envia o pacote do OmniChannel 2 para a Hostinger (public_html/omnichannel2/).

    # 1. gere o pacote (ou use --empacotar)
    ../.venv/bin/python scripts/empacotar_php.py

    # 2. credenciais de upload (hPanel/API "generate upload URL"; expiram): SÓ no ambiente
    export HOSTINGER_UPLOAD_URL='https://...'      # "url" da resposta
    export HOSTINGER_AUTH_KEY='...'                # "auth_key"
    export HOSTINGER_REST_AUTH_KEY='...'           # "rest_auth_key"

    # 3. envie; na primeira vez, crie também o código de instalação
    ../.venv/bin/python scripts/implantar_hostinger.py --criar-codigo
    ../.venv/bin/python scripts/implantar_hostinger.py              # deploys seguintes: só o que mudou
    ../.venv/bin/python scripts/implantar_hostinger.py --simular    # mostra o que iria, sem rede

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

Ordem: código (app/, cron, console) primeiro; front (web/) depois; por
último .htaccess, instalar.php e index.php. Assim, durante o envio, o front
controller antigo nunca carrega metade de uma versão nova de rota.

O que NÃO faz: apagar arquivos no servidor (a API de upload não apaga). Se um
arquivo sair do pacote (ex.: uma rota app/Api/X.php removida), apague-o pelo
Gerenciador de Arquivos — a lista sai no fim como "no servidor e fora do pacote".

Segurança: as chaves só vêm do ambiente, nunca de arquivo versionado, nunca
são impressas. O código de instalação é gerado aqui (secrets), enviado para
omnichannel2/dados/instalacao.codigo (fora do public) e mostrado UMA vez.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
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
    """Ordem de envio: código, front, e por último o que decide o que roda."""
    if caminho == "public/index.php":
        return (4, caminho)  # o front controller por último: ele decide o que roda
    if caminho == "public/instalar.php":
        return (3, caminho)
    if caminho.endswith(".htaccess"):
        return (2, caminho)
    if caminho.startswith(("public/", "web/")):
        return (1, caminho)
    return (0, caminho)


def arquivos_do_pacote(pasta: Path) -> dict[str, str]:
    """{caminho relativo: sha256} de tudo no pacote."""
    resultado = {}
    for arquivo in sorted(p for p in pasta.rglob("*") if p.is_file()):
        resultado[arquivo.relative_to(pasta).as_posix()] = hashlib.sha256(arquivo.read_bytes()).hexdigest()
    return resultado


def carregar_estado(arquivo: Path, chave: str) -> dict[str, str]:
    try:
        return json.loads(arquivo.read_text()).get(chave, {})
    except (OSError, ValueError, AttributeError):
        return {}


def ultima_chave(arquivo: Path, destino: str) -> str | None:
    """A chave do último envio real para esse destino (para simular sem a URL de upload)."""
    try:
        valor = json.loads(arquivo.read_text()).get("ultimo", {}).get(destino)
    except (OSError, ValueError, AttributeError):
        return None
    return valor if isinstance(valor, str) else None


def gravar_estado(arquivo: Path, chave: str, enviados: dict[str, str], destino: str | None = None) -> None:
    try:
        tudo = json.loads(arquivo.read_text())
    except (OSError, ValueError):
        tudo = {}
    tudo[chave] = enviados
    if destino is not None:
        # lembra qual alvo foi o último: o --simular sem as variáveis de
        # ambiente compara com ele em vez de listar tudo como novo
        ultimos = tudo.get("ultimo") if isinstance(tudo.get("ultimo"), dict) else {}
        ultimos[destino] = chave
        tudo["ultimo"] = ultimos
    temporario = arquivo.with_suffix(".tmp")
    temporario.write_text(json.dumps(tudo, indent=2, sort_keys=True))
    temporario.replace(arquivo)


def chave_do_destino(url: str, destino: str) -> str:
    """Identifica o alvo no arquivo de estado sem guardar a URL (pode ter token)."""
    host = urllib.parse.urlsplit(url).hostname or url
    return hashlib.sha256(f"{host}|{destino}".encode()).hexdigest()[:16] + f":{destino}"


# ------------------------------------------------------ conferência no ar


class _SemRedirecionar(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return None


def _buscar(url: str, timeout: float = 20.0, seguir: bool = False) -> tuple[int, dict[str, str], bytes]:
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    manipuladores: list = [] if seguir else [_SemRedirecionar()]
    if host in ("127.0.0.1", "localhost", "::1"):
        manipuladores.append(urllib.request.ProxyHandler({}))
    abrir = urllib.request.build_opener(*manipuladores).open
    try:
        with abrir(urllib.request.Request(url, headers={"User-Agent": "omnichannel-conferencia"}), timeout=timeout) as r:
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


def conferir_no_ar(base: str) -> list[Resultado]:
    """Checagens HTTP depois do deploy: o sistema responde e nada interno vaza.

    Serve para o que o teste local não cobre: o .htaccess de verdade no
    LiteSpeed (https forçado, código e dados inalcançáveis). Os arquivos
    internos pelo domínio principal ficam em conferir_pasta().
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
    parser.add_argument("--empacotar", action="store_true", help="roda o empacotar_php.py antes")
    parser.add_argument("--criar-codigo", action="store_true", help="gera e envia dados/instalacao.codigo (1ª instalação)")
    parser.add_argument("--tudo", action="store_true", help="envia tudo, mesmo o que não mudou desde o último envio")
    parser.add_argument("--simular", action="store_true", help="só lista o que seria enviado (sem rede)")
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
    args = parser.parse_args(argv)

    if args.conferir or args.conferir_pasta:
        resultados: list[Resultado] = conferir_no_ar(args.conferir) if args.conferir else []
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

    if args.empacotar:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import empacotar_php  # noqa: PLC0415

        if empacotar_php.main(["--saida", str(args.pasta.resolve().parent), "--silencioso"]) != 0:
            return 1

    pasta = args.pasta.resolve()
    if not (pasta / "public" / "index.php").is_file():
        print(f"pacote não encontrado em {pasta}; rode scripts/empacotar_php.py (ou use --empacotar)", file=sys.stderr)
        return 2
    destino = args.destino.strip("/")
    if not destino or ".." in destino.split("/"):
        print("--destino inválido", file=sys.stderr)
        return 2

    atuais = arquivos_do_pacote(pasta)
    url = os.environ.get(ENV_URL, "")
    estado_arquivo = args.estado or pasta.parent / "implantado.json"
    if url:
        chave: str | None = chave_do_destino(url, destino)
    else:
        # sem a URL (típico do --simular) o alvo é o do último envio real
        chave = ultima_chave(estado_arquivo, destino)
        if args.simular:
            if chave:
                print(f"(sem {ENV_URL}: comparando com o último envio para {destino})")
            else:
                print(f"(sem {ENV_URL} e sem envio anterior registrado para {destino}: tudo aparece como novo)")
    anteriores = {} if args.tudo or chave is None else carregar_estado(estado_arquivo, chave)
    pendentes = sorted((c for c, h in atuais.items() if anteriores.get(c) != h), key=prioridade)
    fora_do_pacote = sorted(set(anteriores) - set(atuais))

    if args.simular:
        for caminho in pendentes:
            print(f"  enviaria  {destino}/{caminho}")
        if args.criar_codigo:
            print(f"  enviaria  {destino}/dados/instalacao.codigo (+ dados/.htaccess)")
        print(f"{len(pendentes)} de {len(atuais)} arquivos seriam enviados (simulação, nada saiu daqui)")
        return 0

    auth, auth_rest = os.environ.get(ENV_AUTH, ""), os.environ.get(ENV_AUTH_REST, "")
    faltando = [n for n, v in ((ENV_URL, url), (ENV_AUTH, auth), (ENV_AUTH_REST, auth_rest)) if not v]
    if faltando:
        print("faltam variáveis de ambiente: " + ", ".join(faltando), file=sys.stderr)
        print("(gere a URL de upload no hPanel/API da Hostinger; nunca grave as chaves em arquivo versionado)", file=sys.stderr)
        return 2

    cliente = ClienteTus(
        url, auth, auth_rest, tentativas=args.tentativas, espera=args.espera, pedaco=max(1, int(args.pedaco_mb * 1024 * 1024))
    )
    inicio = time.monotonic()
    enviados = dict(anteriores)
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
        return 1

    # o que saiu do pacote continua no servidor: avisa para apagar à mão
    for caminho in fora_do_pacote:
        enviados.pop(caminho, None)
    gravar_estado(estado_arquivo, chave, {c: h for c, h in enviados.items() if c in atuais}, destino)

    duracao = time.monotonic() - inicio
    print(f"{len(pendentes)} arquivo(s), {total_bytes / 1024:.1f} KiB em {duracao:.1f}s ({cliente.requisicoes} requisições); "
          f"{len(atuais) - len(pendentes)} sem mudança")
    if fora_do_pacote:
        print("no servidor e fora do pacote (apague pelo Gerenciador de Arquivos):")
        for caminho in fora_do_pacote:
            print(f"  public_html/{destino}/{caminho}")
    if codigo:
        print()
        print("Código de instalação (anote; ele não fica em lugar nenhum além do servidor):")
        print(f"  {codigo}")
        print("Abra https://<seu subdomínio>/instalar e informe esse código.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

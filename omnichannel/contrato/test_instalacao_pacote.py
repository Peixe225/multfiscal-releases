"""Pacote de deploy e envio para a Hostinger, ponta a ponta, sem rede.

1. scripts/empacotar_php.py monta dist/omnichannel2 (sem segredo, sem teste);
2. scripts/implantar_hostinger.py manda o pacote para um servidor TUS falso
   (o mesmo protocolo da API de upload da Hostinger), que grava os arquivos
   numa "public_html" temporária;
3. a pasta recebida sobe no php -S, é instalada pelo /instalar com o código
   que o script gerou, e o painel funciona a partir de web/ (fora do public);
4. um "deploy seguinte" com migração nova manda só o que mudou, a migração
   antes do código, e a primeira requisição depois dele atualiza o esquema;
5. um arquivo que sai do pacote fica avisado em TODO envio até o --ja-apaguei.

Não depende do alvo (python/php): testa os scripts e o pacote.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import empacotar_php  # noqa: E402
import implantar_hostinger  # noqa: E402
from test_instalacao import CODIGO, SENHA_FORTE, pedido, subir_sem_config  # noqa: E402

RAIZ = Path(__file__).resolve().parents[1]  # omnichannel/
PYTHON = sys.executable
PHP = os.environ.get("OMNI_CONTRATO_PHP", "php")
AUTH = "chave-auth-de-teste"
AUTH_REST = "chave-rest-de-teste"

precisa_php = pytest.mark.skipif(shutil.which(PHP) is None, reason="php não encontrado")


# ------------------------------------------------------------ TUS falso


class TusFalso:
    """Servidor TUS 1.0.0 mínimo, com as regras da API de upload da Hostinger.

    Confere X-Auth/X-Auth-Rest/Tus-Resumable em tudo, exige override=true,
    Upload-Length no POST e Upload-Offset exato no PATCH; grava o arquivo em
    raiz/public_html/<caminho> quando o último byte chega. `falhas` injeta
    respostas 500 nos PATCHes cujo caminho contenha a chave.
    """

    def __init__(self, raiz: Path):
        self.raiz = raiz / "public_html"
        self.raiz.mkdir(parents=True, exist_ok=True)
        self.uploads: dict[str, dict] = {}
        self.falhas: dict[str, int] = {}
        self.log: list[tuple[str, str]] = []
        self.trava = threading.Lock()
        tus = self

        class Manipulador(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def _responder(self, status: int, cabecalhos: dict | None = None):
                self.send_response(status)
                for k, v in (cabecalhos or {}).items():
                    self.send_header(k, v)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def _caminho(self) -> str | None:
                partes = urlsplit(self.path)
                caminho = unquote(partes.path).lstrip("/")
                if ".." in caminho.split("/") or not caminho:
                    return None
                return caminho

            def _autorizado(self) -> bool:
                return (self.headers.get("X-Auth") == AUTH and self.headers.get("X-Auth-Rest") == AUTH_REST
                        and self.headers.get("Tus-Resumable") == "1.0.0")

            def do_POST(self):
                caminho = self._caminho()
                with tus.trava:
                    tus.log.append(("POST", caminho))
                if not self._autorizado():
                    return self._responder(401)
                if caminho is None or "override=true" not in self.path:
                    return self._responder(400)
                if self.headers.get("Upload-Offset") != "0" or not (self.headers.get("Upload-Length") or "").isdigit():
                    return self._responder(400)
                tamanho = int(self.headers["Upload-Length"])
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                with tus.trava:
                    tus.uploads[caminho] = {"tamanho": tamanho, "dados": bytearray()}
                    if tamanho == 0:
                        tus._gravar(caminho)
                self._responder(201, {"Upload-Offset": "0"})

            def do_PATCH(self):
                caminho = self._caminho()
                corpo = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                with tus.trava:
                    tus.log.append(("PATCH", caminho))
                    if not self._autorizado():
                        return self._responder(401)
                    if self.headers.get("Content-Type") != "application/offset+octet-stream":
                        return self._responder(415)
                    upload = tus.uploads.get(caminho)
                    if upload is None:
                        return self._responder(404)
                    for trecho, restantes in list(tus.falhas.items()):
                        if trecho in caminho and restantes > 0:
                            tus.falhas[trecho] = restantes - 1
                            return self._responder(500)
                    if int(self.headers.get("Upload-Offset", "-1")) != len(upload["dados"]):
                        return self._responder(409, {"Upload-Offset": str(len(upload["dados"]))})
                    upload["dados"] += corpo
                    if len(upload["dados"]) >= upload["tamanho"]:
                        tus._gravar(caminho)
                    self._responder(204, {"Upload-Offset": str(len(upload["dados"]))})

            def do_HEAD(self):
                caminho = self._caminho()
                with tus.trava:
                    tus.log.append(("HEAD", caminho))
                    upload = tus.uploads.get(caminho)
                if not self._autorizado():
                    return self._responder(401)
                if upload is None:
                    return self._responder(404)
                self._responder(200, {"Upload-Offset": str(len(upload["dados"])), "Upload-Length": str(upload["tamanho"])})

        self.servidor = ThreadingHTTPServer(("127.0.0.1", 0), Manipulador)
        self.url = f"http://127.0.0.1:{self.servidor.server_address[1]}/api/upload"
        self.fio = threading.Thread(target=self.servidor.serve_forever, daemon=True)
        self.fio.start()

    def _gravar(self, caminho: str) -> None:
        # o prefixo /api/upload faz o papel do {url} da Hostinger
        relativo = caminho.removeprefix("api/upload/")
        destino = self.raiz / relativo
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(bytes(self.uploads[caminho]["dados"]))

    def contar(self, metodo: str) -> int:
        return sum(1 for m, _ in self.log if m == metodo)

    def parar(self) -> None:
        self.servidor.shutdown()
        self.servidor.server_close()


@pytest.fixture
def pasta():
    caminho = Path(tempfile.mkdtemp(prefix="omni-pacote-"))
    yield caminho
    if os.environ.get("OMNI_CONTRATO_MANTER") != "1":
        shutil.rmtree(caminho, ignore_errors=True)


@pytest.fixture
def tus(pasta):
    servidor = TusFalso(pasta / "hostinger")
    yield servidor
    servidor.parar()


def empacotar(saida: Path, *extra: str) -> subprocess.CompletedProcess:
    resultado = subprocess.run(
        [PYTHON, "scripts/empacotar_php.py", "--saida", str(saida), *extra],
        cwd=RAIZ, capture_output=True, text=True, timeout=300,
    )
    assert resultado.returncode == 0, resultado.stderr + resultado.stdout
    return resultado


def implantar(
    tus: TusFalso, pacote: Path, *extra: str, auth: str = AUTH, url: str | None = None, site: str | None = None
) -> subprocess.CompletedProcess:
    ambiente = {k: v for k, v in os.environ.items() if not k.startswith("HOSTINGER_")}
    ambiente.update({"HOSTINGER_UPLOAD_URL": url or tus.url, "HOSTINGER_AUTH_KEY": auth, "HOSTINGER_REST_AUTH_KEY": AUTH_REST})
    if site:
        ambiente["HOSTINGER_SITE"] = site
    return subprocess.run(
        [PYTHON, "scripts/implantar_hostinger.py", "--pasta", str(pacote), "--espera", "0", *extra],
        cwd=RAIZ, env=ambiente, capture_output=True, text=True, timeout=300,
    )


def pacote_minimo(pasta: Path, arquivos: dict[str, str]) -> Path:
    """Um pacote de mentira (sem PHP): só para testar o registro do envio."""
    pacote = pasta / "omnichannel2"
    for caminho, conteudo in {"public/index.php": "<?php // entrada\n", **arquivos}.items():
        (pacote / caminho).parent.mkdir(parents=True, exist_ok=True)
        (pacote / caminho).write_text(conteudo)
    return pacote


def extrair_como_o_unzip(arquivo_zip: Path, destino: Path) -> None:
    """Extrai gravando a data de cada entrada no disco, como o unzip e o ZipArchive do PHP."""
    with zipfile.ZipFile(arquivo_zip) as z:
        for info in z.infolist():
            alvo = destino / info.filename
            alvo.parent.mkdir(parents=True, exist_ok=True)
            alvo.write_bytes(z.read(info))
            instante = time.mktime(info.date_time + (0, 0, -1))
            os.utime(alvo, (instante, instante))


# ------------------------------------------------------------------ testes


def test_pacote_sem_segredo_sem_teste_e_com_o_front(pasta):
    saida = empacotar(pasta / "dist", "--sem-lint" if shutil.which(PHP) is None else "--silencioso")
    pacote = pasta / "dist" / "omnichannel2"
    manifesto = json.loads((pasta / "dist" / "manifesto.json").read_text())
    caminhos = {a["caminho"] for a in manifesto["arquivos"]}
    assert caminhos == {p.relative_to(pacote).as_posix() for p in pacote.rglob("*") if p.is_file()}

    # o que precisa estar lá
    for obrigatorio in ("public/index.php", "public/instalar.php", "public/.htaccess", "public/.user.ini", ".htaccess",
                        "app/.htaccess", "app/autoload.php", "app/Instalacao/Instalador.php", "cron.php", "console.php",
                        "config.exemplo.php", "VERSAO", "web/.htaccess"):
        assert obrigatorio in caminhos, obrigatorio
    # public/ (o DocumentRoot) só com a entrada, o instalador e os ajustes do
    # servidor; o .user.ini leva os limites de upload dos anexos de 20 MB
    assert {c for c in caminhos if c.startswith("public/")} == {
        "public/index.php", "public/instalar.php", "public/.htaccess", "public/.user.ini",
    }
    user_ini = (pacote / "public" / ".user.ini").read_text()
    assert "upload_max_filesize = 25M" in user_ini and "display_errors = Off" in user_ini
    # o front é cópia fiel de app/web (fonte única), em web/, FORA do public
    for arquivo in (RAIZ / "app" / "web").iterdir():
        if arquivo.is_file():
            assert (pacote / "web" / arquivo.name).read_bytes() == arquivo.read_bytes()
    assert "Require all denied" in (pacote / "web" / ".htaccess").read_text()
    # o modelo de config acha o front sozinho: refeito à mão, o painel não some
    ativas = [linha.strip() for linha in (pacote / "config.exemplo.php").read_text().splitlines()
              if not linha.strip().startswith("//")]
    assert "'pasta_web' => __DIR__ . '/web'," in ativas
    # o que nunca pode ir: config, dados, testes, docs de desenvolvimento
    assert not any(c.startswith(("dados/", "tests/", "public/web")) for c in caminhos)
    assert not any(re.search(r"(^|/)config\.php$|\.sqlite|\.log$|\.codigo$|\.md$|Teste\.php$", c) for c in caminhos)
    assert "Require all denied" in (pacote / "app" / ".htaccess").read_text()

    # zip: mesma lista, com omnichannel2/ na raiz, e a data real de cada arquivo
    zips = list((pasta / "dist").glob("omnichannel2-*.zip"))
    assert len(zips) == 1
    with zipfile.ZipFile(zips[0]) as z:
        assert {n.removeprefix("omnichannel2/") for n in z.namelist()} == caminhos
        for info in z.infolist():
            real = time.localtime((pacote / info.filename.removeprefix("omnichannel2/")).stat().st_mtime)
            assert info.date_time[:5] == tuple(real[:5]), info.filename
    assert "arquivos" in saida.stdout and "manifesto" in saida.stdout


def test_copias_do_config_nunca_entram_no_pacote(pasta, monkeypatch):
    """Mesmo padrão do php/.gitignore (config.*.php) e, na conferência, qualquer
    arquivo com uma chave_secreta de verdade, seja qual for o nome."""
    copia = pasta / "php"
    shutil.copytree(RAIZ / "php", copia, ignore=shutil.ignore_patterns("dados", "tests", "config.php"))
    segredo = "'chave_secreta' => '" + "ab12" * 16 + "',\n'senha' => 'SenhaReal#MySQL2026',"
    for nome in ("config.producao.php", "config.backup.php", "config-antigo.php", "backup.sql", "copia.zip",
                 ".env", "app/config.bak"):
        (copia / nome).write_text("<?php return [" + segredo + "];\n")
    monkeypatch.setattr(empacotar_php, "PHP_DIR", copia)
    pacote, manifesto = empacotar_php.montar(pasta / "dist")
    caminhos = {a["caminho"] for a in manifesto["arquivos"]}
    assert "config.exemplo.php" in caminhos and "app/Nucleo/Config.php" in caminhos
    assert not [c for c in caminhos if re.search(r"(^|/)(config[.\-_].*|backup\.sql|copia\.zip|\.env)$", c)
                and c != "config.exemplo.php"], caminhos
    zip_ = empacotar_php.zipar(pacote, pasta / "dist" / "p.zip")
    assert b"SenhaReal#MySQL2026" not in zip_.read_bytes()
    assert "config.producao.php" not in implantar_hostinger.arquivos_do_pacote(pacote)

    # se algo assim entrar mesmo assim (outro nome, outra pasta), o pacote é recusado
    for nome, conteudo in (("config.velho.php", "<?php return [];"), ("app/Nucleo/copia.txt", segredo),
                           ("app/dump.sql.gz", "x"), ("public/extra.html", "<p>")):
        (pacote / nome).write_text(conteudo)
        with pytest.raises(SystemExit, match=re.escape(nome)):
            empacotar_php._conferir(pacote)
        (pacote / nome).unlink()
    empacotar_php._conferir(pacote)  # limpo de novo: passa


@precisa_php
def test_zip_extraido_por_cima_entrega_o_js_novo(pasta):
    """Caminho B (zip no Gerenciador de Arquivos): uma correção do mesmo tamanho,
    extraída por cima, não pode responder 304 com o JS velho (o ETag do front
    era md5(data-tamanho); hoje vem do conteúdo, e o zip ainda leva a data real)."""
    empacotar(pasta / "dist", "--sem-lint", "--silencioso")
    pacote = pasta / "dist" / "omnichannel2"
    public_html = pasta / "public_html"
    extrair_como_o_unzip(next((pasta / "dist").glob("omnichannel2-*.zip")), public_html)
    recebido = public_html / "omnichannel2"
    (recebido / "dados").mkdir()
    (recebido / "dados" / "instalacao.codigo").write_text(CODIGO + "\n")
    servidor = subir_sem_config(recebido, recebido / "public")
    try:
        with servidor.cliente() as c:
            assert c.post("/instalar", json=pedido(url_publica=servidor.url)).status_code == 201
            antes = c.get("/widget.js")
            assert antes.status_code == 200 and "INTERVALO = 2000" in antes.text

            # correção do mesmo tamanho, novo zip, extraído por cima
            widget = pacote / "web" / "widget.js"
            novo = widget.read_text().replace("INTERVALO = 2000", "INTERVALO = 3000")
            assert len(novo) == len(widget.read_text())
            instante = widget.stat().st_mtime + 120
            widget.write_text(novo)
            os.utime(widget, (instante, instante))
            extrair_como_o_unzip(empacotar_php.zipar(pacote, pasta / "v2.zip"), public_html)

            depois = c.get("/widget.js", headers={"If-None-Match": antes.headers["etag"]})
            assert depois.status_code == 200, "ETag igual: o navegador ficaria com o JS velho"
            assert "INTERVALO = 3000" in depois.text
    finally:
        servidor.processo.terminate()
        servidor.processo.wait(timeout=10)


def test_migracoes_vao_antes_do_codigo_que_as_usa():
    ordem = sorted(
        ["public/index.php", "app/Api/Novo.php", "app/Atendimento/Mensagens.php", "web/painel.js",
         "app/Banco/Migracoes/M20261001_0000_NovaColuna.php", "app/Banco/Esquema.php", "public/.htaccess"],
        key=implantar_hostinger.prioridade,
    )
    assert ordem == [
        "app/Banco/Esquema.php", "app/Banco/Migracoes/M20261001_0000_NovaColuna.php",
        "app/Api/Novo.php", "app/Atendimento/Mensagens.php", "web/painel.js", "public/.htaccess", "public/index.php",
    ]


def test_arquivo_fora_do_pacote_avisado_em_todo_envio_ate_confirmar(pasta, tus):
    pacote = pacote_minimo(pasta, {"app/Api/Antiga.php": "<?php // rota velha\n", "app/Util.php": "<?php\n"})
    assert implantar(tus, pacote).returncode == 0
    (pacote / "app" / "Api" / "Antiga.php").unlink()
    (pacote / "app" / "Util.php").unlink()

    # normal, de novo, --tudo e --simular: a lista repete, com destaque para a rota
    for extra in ((), (), ("--tudo",), ("--simular",)):
        resultado = implantar(tus, pacote, *extra)
        assert resultado.returncode == 0, resultado.stderr
        assert "fora do pacote" in resultado.stdout, extra
        linha = next(l for l in resultado.stdout.splitlines() if "app/Api/Antiga.php" in l)
        assert "ROTA CARREGADA SOZINHA" in linha
        assert "public_html/omnichannel2/app/Util.php" in resultado.stdout
    assert (tus.raiz / "omnichannel2" / "app" / "Api" / "Antiga.php").exists()  # a API de upload não apaga

    # o dono apagou a rota pelo Gerenciador de Arquivos e confirma (qualquer forma do caminho)
    confirmado = implantar(tus, pacote, "--ja-apaguei", "public_html/omnichannel2/app/Api/Antiga.php")
    assert confirmado.returncode == 0 and "apagado (confirmado)" in confirmado.stdout
    seguinte = implantar(tus, pacote)
    assert "Antiga.php" not in seguinte.stdout and "app/Util.php" in seguinte.stdout
    assert implantar(tus, pacote, "--limpar-removidos").returncode == 0
    assert "fora do pacote" not in implantar(tus, pacote).stdout


def test_primeiro_envio_com_tudo_tambem_lembra_o_que_ja_estava_la(pasta, tus):
    pacote = pacote_minimo(pasta, {"app/Api/Antiga.php": "<?php\n"})
    assert implantar(tus, pacote).returncode == 0
    (pacote / "app" / "Api" / "Antiga.php").unlink()
    com_tudo = implantar(tus, pacote, "--tudo")
    assert com_tudo.returncode == 0 and "app/Api/Antiga.php" in com_tudo.stdout
    assert "app/Api/Antiga.php" in implantar(tus, pacote).stdout


def test_dois_sites_no_mesmo_servidor_de_arquivos_nao_dividem_o_registro(pasta, tus):
    pacote = pacote_minimo(pasta, {"app/X.php": "<?php\n", "web/painel.js": "// js\n"})
    site_a = implantar(tus, pacote, url=tus.url + "/siteA")
    assert site_a.returncode == 0 and "3 arquivo(s)" in site_a.stdout
    # mesmo servidor, outro site: tudo vai, e o alvo novo é anunciado
    site_b = implantar(tus, pacote, url=tus.url + "/siteB")
    assert site_b.returncode == 0, site_b.stderr
    assert "nenhum envio registrado para este alvo" in site_b.stdout and "OUTRO alvo" in site_b.stdout
    assert "3 arquivo(s)" in site_b.stdout
    assert (tus.raiz / "siteB" / "omnichannel2" / "app" / "X.php").exists()

    # com o site informado, uma URL de upload nova (expirou) não perde o registro
    assert implantar(tus, pacote, url=tus.url + "/siteA", site="oprojeto.online").returncode == 0
    tus.log.clear()
    outra_url = implantar(tus, pacote, url=tus.url + "/siteA/", site="OProjeto.online")
    assert outra_url.returncode == 0 and "0 arquivo(s)" in outra_url.stdout
    assert "3 arquivo(s) registrados" in outra_url.stdout and tus.contar("POST") == 0


def test_credencial_errada_para_na_hora(pasta, tus):
    empacotar(pasta / "dist", "--sem-zip", "--sem-lint", "--silencioso")
    resultado = implantar(tus, pasta / "dist" / "omnichannel2", auth="chave-errada")
    assert resultado.returncode == 1
    assert "credencial" in resultado.stderr
    assert "chave-errada" not in resultado.stdout + resultado.stderr
    assert tus.contar("POST") == 1  # sem insistir com chave recusada


def test_sem_variaveis_de_ambiente_nao_envia(pasta):
    empacotar(pasta / "dist", "--sem-zip", "--sem-lint", "--silencioso")
    ambiente = {k: v for k, v in os.environ.items() if not k.startswith("HOSTINGER_")}
    resultado = subprocess.run(
        [PYTHON, "scripts/implantar_hostinger.py", "--pasta", str(pasta / "dist" / "omnichannel2")],
        cwd=RAIZ, env=ambiente, capture_output=True, text=True, timeout=60,
    )
    assert resultado.returncode == 2
    assert "HOSTINGER_UPLOAD_URL" in resultado.stderr
    simulado = subprocess.run(
        [PYTHON, "scripts/implantar_hostinger.py", "--pasta", str(pasta / "dist" / "omnichannel2"), "--simular"],
        cwd=RAIZ, env=ambiente, capture_output=True, text=True, timeout=60,
    )
    assert simulado.returncode == 0 and "simulação" in simulado.stdout


@precisa_php
def test_implantar_instalar_e_atualizar_ponta_a_ponta(pasta, tus):
    empacotar(pasta / "dist", "--sem-zip", "--silencioso")
    pacote = pasta / "dist" / "omnichannel2"

    # 1º envio: tudo, em pedaços de 16 KiB, com o servidor falhando no meio
    tus.falhas = {"web/painel.js": 2, "app/Nucleo/Validador.php": 1}
    resultado = implantar(tus, pacote, "--criar-codigo", "--pedaco-mb", str(16 / 1024))
    assert resultado.returncode == 0, resultado.stderr + resultado.stdout
    recebido = tus.raiz / "omnichannel2"
    for arquivo in pacote.rglob("*"):
        if arquivo.is_file():
            assert (recebido / arquivo.relative_to(pacote)).read_bytes() == arquivo.read_bytes(), arquivo
    assert tus.falhas == {"web/painel.js": 0, "app/Nucleo/Validador.php": 0}  # as falhas aconteceram
    assert tus.contar("HEAD") >= 1  # e o envio continuou de onde parou
    # a ordem: camada de banco e migrações primeiro, index.php por último
    posts = [c for m, c in tus.log if m == "POST" and "/dados/" not in c]
    assert posts[0].startswith("api/upload/omnichannel2/app/Banco/")
    primeira_fora_do_banco = next(i for i, c in enumerate(posts) if "/app/Banco/" not in c)
    assert all("/app/Banco/" not in c for c in posts[primeira_fora_do_banco:])
    assert posts[-1].endswith("public/index.php")
    assert (recebido / "public" / ".user.ini").is_file()
    # código de instalação: mostrado uma vez e gravado fora do public
    codigo = re.search(r"Código de instalação.*\n\s+(\S+)", resultado.stdout).group(1)
    assert (recebido / "dados" / "instalacao.codigo").read_text().strip() == codigo
    assert "Require all denied" in (recebido / "dados" / ".htaccess").read_text()
    assert AUTH not in resultado.stdout and AUTH_REST not in resultado.stdout

    # 2º envio sem mudança: nada vai
    tus.log.clear()
    de_novo = implantar(tus, pacote)
    assert de_novo.returncode == 0, de_novo.stderr
    assert tus.contar("POST") == 0

    # a pasta recebida sobe e instala (front servido de web/, fora do public)
    servidor = subir_sem_config(recebido, recebido / "public")
    try:
        with servidor.cliente() as c:
            assert c.post("/instalar", json=pedido(codigo="errado-" + "0" * 20)).status_code == 403
            instalacao = c.post("/instalar", json=pedido(codigo=codigo, url_publica=servidor.url))
            assert instalacao.status_code == 201, instalacao.text
            assert "'pasta_web' => __DIR__ . '/web'" in (recebido / "config.php").read_text()
            assert c.get("/instalar").status_code == 404
            painel = c.get("/painel")
            assert painel.status_code == 200 and "text/html" in painel.headers["content-type"]
            assert c.get("/widget.js").status_code == 200
            login = c.post("/api/auth/login", json={"email": "ian@oprojeto.online", "senha": SENHA_FORTE})
            assert login.status_code == 200
            cabecalho = {"Authorization": f"Bearer {login.json()['token']}"}

            # deploy seguinte com migração nova: só ela vai, e a 1ª requisição aplica
            migracao = pacote / "app" / "Banco" / "Migracoes" / "M29991231_2359_TesteDeploy.php"
            migracao.write_text(
                "<?php\ndeclare(strict_types=1);\nnamespace OmniChannel\\Banco\\Migracoes;\n"
                "use OmniChannel\\Banco\\Esquema;\nuse OmniChannel\\Banco\\Migracao;\n"
                "final class M29991231_2359_TesteDeploy implements Migracao {\n"
                "    public function descricao(): string { return 'teste de deploy'; }\n"
                "    public function aplicar(Esquema $e): void { $e->criarTabela('teste_deploy', 'id {ID}'); }\n}\n"
            )
            # e o código que mudou junto: a migração chega ANTES dele
            mensagens = pacote / "app" / "Atendimento" / "Mensagens.php"
            mensagens.write_text(mensagens.read_text() + "// deploy de teste\n")
            tus.log.clear()
            atualizacao = implantar(tus, pacote)
            assert atualizacao.returncode == 0, atualizacao.stderr
            assert [c for m, c in tus.log if m == "POST"] == [
                "api/upload/omnichannel2/app/Banco/Migracoes/M29991231_2359_TesteDeploy.php",
                "api/upload/omnichannel2/app/Atendimento/Mensagens.php",
            ]
            banco = recebido / "dados" / "omnichannel.sqlite"
            with sqlite3.connect(banco) as con:
                assert not con.execute("SELECT name FROM sqlite_master WHERE name = 'teste_deploy'").fetchall()
            assert c.get("/api/auth/eu", headers=cabecalho).status_code == 200
            with sqlite3.connect(banco) as con:
                assert con.execute("SELECT name FROM sqlite_master WHERE name = 'teste_deploy'").fetchall()
                assert con.execute("SELECT nome FROM migracoes WHERE nome = 'M29991231_2359_TesteDeploy'").fetchall()

            # conferência no ar (a mesma que se roda contra a Hostinger)
            conferencia = subprocess.run(
                [PYTHON, "scripts/implantar_hostinger.py", "--conferir", servidor.url],
                cwd=RAIZ, capture_output=True, text=True, timeout=120,
            )
            assert conferencia.returncode == 0, conferencia.stdout + conferencia.stderr
            assert "FALHA" not in conferencia.stdout and "fechado" in conferencia.stdout
            assert "abre sessão" in conferencia.stdout  # CORS do widget colado em outro site

            # widget bloqueado por CORS (o caso da VPS com OMNI_ORIGENS_PERMITIDAS=[]): a conferência acusa
            config = recebido / "config.php"
            original = config.read_text()
            config.write_text(original.replace("'origens_permitidas' => ['*'],",
                                               "'origens_permitidas' => ['https://outro.example'],"))
            assert "outro.example" in config.read_text()
            bloqueado = subprocess.run(
                [PYTHON, "scripts/implantar_hostinger.py", "--conferir", servidor.url,
                 "--origem-widget", "https://oprojeto.online"],
                cwd=RAIZ, capture_output=True, text=True, timeout=120,
            )
            assert bloqueado.returncode == 1 and "libere a origem" in bloqueado.stdout, bloqueado.stdout
            config.write_text(original)

            # arquivo que saiu do pacote: avisado neste envio e nos seguintes
            migracao.unlink()
            for _ in range(2):
                aviso = implantar(tus, pacote)
                assert "fora do pacote" in aviso.stdout and "M29991231_2359_TesteDeploy.php" in aviso.stdout
                assert "MIGRAÇÃO APLICADA SOZINHA" in aviso.stdout
    finally:
        servidor.processo.terminate()
        servidor.processo.wait(timeout=10)

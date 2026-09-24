"""Pacote de deploy e envio para a Hostinger, ponta a ponta, sem rede.

1. scripts/empacotar_php.py monta dist/omnichannel2 (sem segredo, sem teste);
2. scripts/implantar_hostinger.py manda o pacote para um servidor TUS falso
   (o mesmo protocolo da API de upload da Hostinger), que grava os arquivos
   numa "public_html" temporária;
3. a pasta recebida sobe no php -S, é instalada pelo /instalar com o código
   que o script gerou, e o painel funciona a partir de public/web;
4. um "deploy seguinte" com migração nova manda só o arquivo novo, e a
   primeira requisição depois dele atualiza o esquema.

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
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_instalacao import SENHA_FORTE, pedido, subir_sem_config  # noqa: E402

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


def implantar(tus: TusFalso, pacote: Path, *extra: str, auth: str = AUTH) -> subprocess.CompletedProcess:
    ambiente = {**os.environ, "HOSTINGER_UPLOAD_URL": tus.url, "HOSTINGER_AUTH_KEY": auth, "HOSTINGER_REST_AUTH_KEY": AUTH_REST}
    return subprocess.run(
        [PYTHON, "scripts/implantar_hostinger.py", "--pasta", str(pacote), "--espera", "0", *extra],
        cwd=RAIZ, env=ambiente, capture_output=True, text=True, timeout=300,
    )


# ------------------------------------------------------------------ testes


def test_pacote_sem_segredo_sem_teste_e_com_o_front(pasta):
    saida = empacotar(pasta / "dist", "--sem-lint" if shutil.which(PHP) is None else "--silencioso")
    pacote = pasta / "dist" / "omnichannel2"
    manifesto = json.loads((pasta / "dist" / "manifesto.json").read_text())
    caminhos = {a["caminho"] for a in manifesto["arquivos"]}
    assert caminhos == {p.relative_to(pacote).as_posix() for p in pacote.rglob("*") if p.is_file()}

    # o que precisa estar lá
    for obrigatorio in ("public/index.php", "public/instalar.php", "public/.htaccess", ".htaccess", "app/.htaccess",
                        "app/autoload.php", "app/Instalacao/Instalador.php", "cron.php", "console.php",
                        "config.exemplo.php", "VERSAO"):
        assert obrigatorio in caminhos, obrigatorio
    # o front é cópia fiel de app/web (fonte única)
    for arquivo in (RAIZ / "app" / "web").iterdir():
        if arquivo.is_file():
            assert (pacote / "public" / "web" / arquivo.name).read_bytes() == arquivo.read_bytes()
    # o que nunca pode ir: config, dados, testes, docs de desenvolvimento
    assert not any(c.startswith(("dados/", "tests/")) for c in caminhos)
    assert not any(re.search(r"(^|/)config\.php$|\.sqlite|\.log$|\.codigo$|\.md$|Teste\.php$", c) for c in caminhos)
    assert "Require all denied" in (pacote / "app" / ".htaccess").read_text()

    # zip: mesma lista, com omnichannel2/ na raiz
    zips = list((pasta / "dist").glob("omnichannel2-*.zip"))
    assert len(zips) == 1
    with zipfile.ZipFile(zips[0]) as z:
        assert {n.removeprefix("omnichannel2/") for n in z.namelist()} == caminhos
    assert "arquivos" in saida.stdout and "manifesto" in saida.stdout


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
    tus.falhas = {"public/web/painel.js": 2, "app/Nucleo/Validador.php": 1}
    resultado = implantar(tus, pacote, "--criar-codigo", "--pedaco-mb", str(16 / 1024))
    assert resultado.returncode == 0, resultado.stderr + resultado.stdout
    recebido = tus.raiz / "omnichannel2"
    for arquivo in pacote.rglob("*"):
        if arquivo.is_file():
            assert (recebido / arquivo.relative_to(pacote)).read_bytes() == arquivo.read_bytes(), arquivo
    assert tus.falhas == {"public/web/painel.js": 0, "app/Nucleo/Validador.php": 0}  # as falhas aconteceram
    assert tus.contar("HEAD") >= 1  # e o envio continuou de onde parou
    # a ordem: index.php é o último arquivo do pacote a chegar
    posts = [c for m, c in tus.log if m == "POST" and "/dados/" not in c]
    assert posts[-1].endswith("public/index.php")
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

    # a pasta recebida sobe e instala (front servido de public/web)
    servidor = subir_sem_config(recebido, recebido / "public")
    try:
        with servidor.cliente() as c:
            assert c.post("/instalar", json=pedido(codigo="errado-" + "0" * 20)).status_code == 403
            instalacao = c.post("/instalar", json=pedido(codigo=codigo, url_publica=servidor.url))
            assert instalacao.status_code == 201, instalacao.text
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
            tus.log.clear()
            atualizacao = implantar(tus, pacote)
            assert atualizacao.returncode == 0, atualizacao.stderr
            assert [c for m, c in tus.log if m == "POST"] == [
                "api/upload/omnichannel2/app/Banco/Migracoes/M29991231_2359_TesteDeploy.php"
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

            # arquivo que saiu do pacote: o script avisa para apagar à mão
            migracao.unlink()
            aviso = implantar(tus, pacote)
            assert "fora do pacote" in aviso.stdout and "M29991231_2359_TesteDeploy.php" in aviso.stdout
    finally:
        servidor.processo.terminate()
        servidor.processo.wait(timeout=10)

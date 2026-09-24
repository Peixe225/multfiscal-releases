"""Suíte de contrato: os MESMOS testes contra o app Python e contra o PHP.

Os testes só falam HTTP (httpx), nunca importam código de nenhum dos dois
servidores. É o que garante que o front (app/web) funciona igual nos dois.

Como rodar (de ihchat/):

    ../.venv/bin/python -m pytest contrato -q                           # Python (padrão)
    IHCHAT_CONTRATO_ALVO=php ../.venv/bin/python -m pytest contrato -q    # PHP (php -S + SQLite)

Variáveis:
    IHCHAT_CONTRATO_ALVO      python | php  (padrão python). O conftest sobe o
                            servidor numa porta livre, com banco SQLite novo,
                            sandbox ligado e a base do seed, e o derruba no fim.
    IHCHAT_CONTRATO_URL       usa um servidor JÁ no ar (não sobe nada). Ele
                            precisa ter a base do seed (admin/ana); os testes
                            que dependem da chave secreta são pulados.
    IHCHAT_CONTRATO_MYSQL     só no alvo php: "dsn|usuario|senha" de um banco
                            DESCARTÁVEL (o nome precisa conter "teste" ou
                            "contrato"); as tabelas são apagadas no início.
    IHCHAT_CONTRATO_ESTRITO   1 = rota ainda não implementada no alvo é FALHA,
                            não "skip" (use na validação final do porte).
    IHCHAT_CONTRATO_PHP       binário do PHP (padrão "php").

Provedores falsos (sem rede): os dois servidores leem IHCHAT_TESTE_PROVEDOR,
um arquivo JSON de respostas roteiradas, só com sandbox ligado. Formato em
utilitarios.ProvedorFalso e em php/ARQUITETURA.md; use a fixture `provedor`.
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from utilitarios import (  # noqa: E402
    ADMIN_EMAIL,
    ADMIN_SENHA,
    ATENDENTE_EMAIL,
    ATENDENTE_SENHA,
    CHAVE_SECRETA,
    ProvedorFalso,
    Servidor,
    criar_canal,
    entrar,
)

RAIZ = Path(__file__).resolve().parents[1]  # ihchat/
PYTHON = Path(sys.executable)
PHP = os.environ.get("IHCHAT_CONTRATO_PHP", "php")


def _porta_livre() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _esperar(url: str, processo: subprocess.Popen | None, log: Path, limite: float = 30.0) -> None:
    fim = time.monotonic() + limite
    while time.monotonic() < fim:
        if processo is not None and processo.poll() is not None:
            raise RuntimeError(f"o servidor saiu com código {processo.returncode}:\n{log.read_text()[-3000:]}")
        try:
            if httpx.get(f"{url}/saude", timeout=1.0).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.2)
    raise RuntimeError(f"o servidor não respondeu em {limite}s:\n{log.read_text()[-3000:]}")


def _rodar(comando: list[str], ambiente: dict, log: Path) -> None:
    with log.open("a") as saida:
        resultado = subprocess.run(comando, cwd=RAIZ, env=ambiente, stdout=saida, stderr=subprocess.STDOUT, timeout=120)
    if resultado.returncode != 0:
        raise RuntimeError(f"falhou: {' '.join(comando)}\n{log.read_text()[-3000:]}")


def _subir_python(pasta: Path, porta: int, ambiente: dict, log: Path) -> subprocess.Popen:
    ambiente.update(
        IHCHAT_BANCO_URL=f"sqlite:///{pasta / 'contrato.db'}",
        IHCHAT_CHAVE_SECRETA=CHAVE_SECRETA,
        IHCHAT_MODO_SANDBOX="1",
        IHCHAT_COLETOR_ATIVO="0",
        IHCHAT_PASTA_ANEXOS=str(pasta / "anexos"),
    )
    _rodar([str(PYTHON), "-m", "scripts.seed"], ambiente, log)
    return subprocess.Popen(
        [str(PYTHON), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(porta), "--log-level", "warning"],
        cwd=RAIZ,
        env=ambiente,
        stdout=log.open("a"),
        stderr=subprocess.STDOUT,
    )


def _config_php(pasta: Path) -> dict:
    config = {
        "driver": "sqlite",
        "dsn": f"sqlite:{pasta / 'contrato.sqlite'}",
        "chave_secreta": CHAVE_SECRETA,
        "modo_sandbox": True,
        "pasta_dados": str(pasta / "dados"),
        "pasta_web": str(RAIZ / "app" / "web"),
        "url_publica": "",
    }
    mysql = os.environ.get("IHCHAT_CONTRATO_MYSQL")
    if mysql:
        dsn, usuario, senha = (mysql.split("|") + ["", ""])[:3]
        nome_banco = dsn.split("dbname=")[-1].split(";")[0]
        if "teste" not in nome_banco and "contrato" not in nome_banco:
            raise RuntimeError("IHCHAT_CONTRATO_MYSQL precisa apontar um banco descartável (nome com 'teste' ou 'contrato')")
        config.update(driver="mysql", dsn=dsn, usuario=usuario, senha=senha)
    return config


# apaga as tabelas do banco MySQL descartável (a guarda do nome já passou)
_LIMPAR_MYSQL = r"""
$c = json_decode(file_get_contents($argv[1]), true);
$pdo = new PDO($c['dsn'], $c['usuario'], $c['senha'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
foreach ($pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $t) { $pdo->exec("DROP TABLE `$t`"); }
$pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
"""


def _subir_php(pasta: Path, porta: int, ambiente: dict, log: Path) -> subprocess.Popen:
    config = _config_php(pasta)
    arquivo = pasta / "config.php"
    # JSON dentro de PHP: sem montar código PHP com texto vindo de fora
    (pasta / "config.json").write_text(json.dumps(config))
    arquivo.write_text("<?php return json_decode(file_get_contents(__DIR__ . '/config.json'), true);\n")
    ambiente.update(IHCHAT_CONFIG=str(arquivo), PHP_CLI_SERVER_WORKERS="4")
    if config["driver"] == "mysql":
        _rodar([PHP, "-r", _LIMPAR_MYSQL, str(pasta / "config.json")], ambiente, log)
    _rodar([PHP, "php/console.php", "semear"], ambiente, log)
    return subprocess.Popen(
        [PHP, "-S", f"127.0.0.1:{porta}", "-t", "php/public", "php/public/index.php"],
        cwd=RAIZ,
        env=ambiente,
        stdout=log.open("a"),
        stderr=subprocess.STDOUT,
    )


@pytest.fixture(scope="session")
def servidor():
    """O servidor sob teste: sobe no início da sessão e cai no fim."""
    externo = os.environ.get("IHCHAT_CONTRATO_URL")
    alvo = os.environ.get("IHCHAT_CONTRATO_ALVO", "python").lower()
    pasta = Path(tempfile.mkdtemp(prefix=f"ihchat-contrato-{alvo}-"))
    provedor = ProvedorFalso(pasta / "provedor.json")
    provedor.limpar()

    if externo:
        _esperar(externo.rstrip("/"), None, pasta / "nada.log")
        yield Servidor(url=externo.rstrip("/"), alvo=alvo, chave_secreta=None, provedor=None, pasta=pasta)
        return

    porta = _porta_livre()
    log = pasta / "servidor.log"
    ambiente = {
        **os.environ,
        "IHCHAT_TESTE_PROVEDOR": str(provedor.arquivo),
        "IHCHAT_SENHA_ADMIN": ADMIN_SENHA,
    }
    ambiente.pop("IHCHAT_CONFIG", None)
    if alvo == "python":
        processo = _subir_python(pasta, porta, ambiente, log)
    elif alvo == "php":
        processo = _subir_php(pasta, porta, ambiente, log)
    else:
        raise pytest.UsageError(f"IHCHAT_CONTRATO_ALVO desconhecido: {alvo}")

    url = f"http://127.0.0.1:{porta}"
    try:
        _esperar(url, processo, log)
        yield Servidor(url=url, alvo=alvo, chave_secreta=CHAVE_SECRETA, provedor=provedor, pasta=pasta)
    finally:
        processo.terminate()
        try:
            processo.wait(timeout=10)
        except subprocess.TimeoutExpired:
            processo.kill()
        if os.environ.get("IHCHAT_CONTRATO_MANTER") != "1":
            shutil.rmtree(pasta, ignore_errors=True)


@pytest.fixture
def cliente(servidor):
    with httpx.Client(base_url=servidor.url, timeout=15.0, follow_redirects=False) as c:
        yield c


@pytest.fixture
def provedor(servidor):
    """Roteiro de respostas dos provedores, limpo a cada teste."""
    if servidor.provedor is None:
        pytest.skip("servidor externo: sem controle do provedor falso")
    servidor.provedor.limpar()
    yield servidor.provedor
    servidor.provedor.limpar()


@pytest.fixture(scope="session")
def login_admin(servidor) -> dict:
    """Resposta do login do admin do seed: {"token", "atendente"}."""
    with httpx.Client(base_url=servidor.url, timeout=15.0) as c:
        return entrar(c, ADMIN_EMAIL, ADMIN_SENHA)


@pytest.fixture(scope="session")
def login_atendente(servidor) -> dict:
    with httpx.Client(base_url=servidor.url, timeout=15.0) as c:
        return entrar(c, ATENDENTE_EMAIL, ATENDENTE_SENHA)


@pytest.fixture
def cabecalho_admin(login_admin) -> dict:
    return {"Authorization": f"Bearer {login_admin['token']}"}


@pytest.fixture
def cabecalho_atendente(login_atendente) -> dict:
    return {"Authorization": f"Bearer {login_atendente['token']}"}


# canais novos a cada teste, criados PELA API (nomes únicos: a base é da sessão)
@pytest.fixture
def canal_webchat(cliente, cabecalho_admin) -> dict:
    return criar_canal(cliente, cabecalho_admin, "webchat")


@pytest.fixture
def canal_whatsapp(cliente, cabecalho_admin) -> dict:
    return criar_canal(cliente, cabecalho_admin, "whatsapp")


@pytest.fixture
def canal_telegram(cliente, cabecalho_admin) -> dict:
    return criar_canal(cliente, cabecalho_admin, "telegram")


@pytest.fixture
def canal_email(cliente, cabecalho_admin) -> dict:
    return criar_canal(cliente, cabecalho_admin, "email")

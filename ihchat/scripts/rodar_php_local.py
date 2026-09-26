"""Sobe o backend PHP localmente, com SQLite e dados de exemplo.

    ../.venv/bin/python scripts/rodar_php_local.py              # porta 8601
    ../.venv/bin/python scripts/rodar_php_local.py --porta 9000
    ../.venv/bin/python scripts/rodar_php_local.py --novo       # apaga o banco e recomeça

Equivale ao `uvicorn app.main:app` + `scripts/seed.py --demo` do Python, só
que servido pelo `php -S` com o front controller de php/public. Tudo fica em
php/dados/dev/ (fora do git): config de desenvolvimento, banco, anexos, logs.
O config de produção (php/config.php) nunca é lido nem tocado: o servidor
recebe o caminho do config de desenvolvimento por IHCHAT_CONFIG.

Ctrl+C para parar.
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]  # ihchat/
PHP_DIR = RAIZ / "php"


def _config(pasta: Path, banco: Path) -> Path:
    """Config de desenvolvimento: JSON lido por um config.php de uma linha.

    A chave secreta é gerada uma vez e mantida, para o login no navegador
    sobreviver a reinícios do servidor.
    """
    dados_json = pasta / "config.json"
    atual = json.loads(dados_json.read_text()) if dados_json.exists() else {}
    config = {
        "driver": "sqlite",
        "dsn": f"sqlite:{banco}",
        "chave_secreta": atual.get("chave_secreta") or secrets.token_hex(32),
        "modo_sandbox": True,
        "url_publica": "",
        "pasta_dados": str(pasta),
        "pasta_web": str(RAIZ / "app" / "web"),
    }
    dados_json.write_text(json.dumps(config, indent=2))
    arquivo = pasta / "config.php"
    arquivo.write_text("<?php return json_decode(file_get_contents(__DIR__ . '/config.json'), true);\n")
    return arquivo


def main() -> int:
    parser = argparse.ArgumentParser(description="Sobe o IHchat em PHP com SQLite")
    parser.add_argument("--porta", type=int, default=8601)
    parser.add_argument("--pasta", type=Path, default=PHP_DIR / "dados" / "dev", help="pasta de dados de desenvolvimento")
    parser.add_argument("--novo", action="store_true", help="apaga banco e dados e recomeça")
    parser.add_argument("--sem-demo", action="store_true", help="só a base essencial, sem conversas de exemplo")
    parser.add_argument("--php", default=os.environ.get("IHCHAT_PHP", "php"))
    args = parser.parse_args()

    if shutil.which(args.php) is None:
        print(f"PHP não encontrado ({args.php}); instale o php-cli 8.1+ com pdo_sqlite.", file=sys.stderr)
        return 1

    pasta = args.pasta.resolve()
    if args.novo and pasta.exists():
        shutil.rmtree(pasta)
    pasta.mkdir(parents=True, exist_ok=True)
    banco = pasta / "ihchat.sqlite"
    config = _config(pasta, banco)

    ambiente = {**os.environ, "IHCHAT_CONFIG": str(config), "PHP_CLI_SERVER_WORKERS": "4"}
    semear = [args.php, str(PHP_DIR / "console.php"), "semear"] + ([] if args.sem_demo else ["--demo"])
    resultado = subprocess.run(semear, env=ambiente, cwd=RAIZ)
    if resultado.returncode != 0:
        return resultado.returncode

    # SIGTERM (kill, timeout) também passa pelo finally: o php -S não fica órfão
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))

    base = f"http://127.0.0.1:{args.porta}"
    servidor = subprocess.Popen(
        [args.php, "-S", f"127.0.0.1:{args.porta}", "-t", str(PHP_DIR / "public"), str(PHP_DIR / "public" / "index.php")],
        env=ambiente,
        cwd=RAIZ,
    )
    try:
        for _ in range(50):
            try:
                with urllib.request.urlopen(f"{base}/saude", timeout=1) as resposta:
                    if resposta.status == 200:
                        break
            except OSError:
                time.sleep(0.2)
        print()
        print(f"  IHchat (PHP) no ar: {base}/painel")
        print(f"  simulador de clientes:     {base}/simulador")
        print(f"  widget de demonstração:    {base}/widget/demo")
        print(f"  dados e logs:              {pasta}")
        print("  Ctrl+C para parar.")
        print()
        return servidor.wait()
    except KeyboardInterrupt:
        return 0
    finally:
        if servidor.poll() is None:
            servidor.send_signal(signal.SIGINT)
            try:
                servidor.wait(timeout=5)
            except subprocess.TimeoutExpired:
                servidor.kill()


if __name__ == "__main__":
    sys.exit(main())

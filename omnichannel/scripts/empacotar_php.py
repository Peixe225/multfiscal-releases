"""Monta o pacote de deploy do backend PHP para a Hostinger.

    ../.venv/bin/python scripts/empacotar_php.py            # dist/omnichannel2/ + dist/omnichannel2-<versão>.zip
    ../.venv/bin/python scripts/empacotar_php.py --sem-zip
    ../.venv/bin/python scripts/empacotar_php.py --saida /outra/pasta

O pacote é a pasta que vai inteira para public_html/omnichannel2/:

    omnichannel2/.htaccess        se o subdomínio apontar para cá, reescreve para public/
    omnichannel2/app/             código PHP (+ .htaccess que nega tudo)
    omnichannel2/public/          DocumentRoot: index.php, instalar.php, .htaccess (e nada mais)
    omnichannel2/web/             o front (cópia de app/web, a fonte única), FORA do public:
                                  sai só por /painel, /widget.js e /static/, pelo index.php,
                                  com os cabeçalhos anti-moldura (um public/web deixaria
                                  /web/painel.html ser emoldurado por qualquer site)
    omnichannel2/cron.php, console.php, config.exemplo.php
    omnichannel2/VERSAO           versão, commit e data do pacote

O que NUNCA entra: config.php (senha do banco e chave secreta), dados/
(banco SQLite, anexos, logs, código de instalação), testes, documentação de
desenvolvimento, bancos e logs perdidos. Se algo assim aparecer dentro de
php/ com outro nome, a conferência final recusa o pacote.

Com o PHP instalado localmente, cada .php do pacote passa por `php -l`.
O manifesto (caminho, tamanho, sha256) sai na tela e em dist/manifesto.json,
que o implantar_hostinger.py usa para mandar só o que mudou.
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]  # omnichannel/
PHP_DIR = RAIZ / "php"
WEB_DIR = RAIZ / "app" / "web"
NOME = "omnichannel2"

# relativo a php/: pastas inteiras fora do pacote
PASTAS_EXCLUIDAS = {"tests", "dados", "public/web", "web", "vendor"}
# nomes de arquivo fora do pacote (em qualquer pasta)
ARQUIVOS_EXCLUIDOS = [
    "config.php", "config.json", "config.local.php", ".env", ".env.*", "*.sqlite", "*.sqlite-*", "*.db",
    "*.log", "*.lock", "*.codigo", "*.md", "*.bak", "*.swp", "*~", ".DS_Store", "composer.json", "composer.lock",
    "phpunit.xml", ".gitignore", ".git",
]
# conferência final: se algum destes aparecer no pacote, algo deu errado
PROIBIDOS_NO_PACOTE = ["config.php", "*.sqlite*", "*.db", "*.log", "*.codigo", ".env*", "*Teste.php"]

NEGAR_TUDO = """# Código do OmniChannel 2: nunca servido pela web.
<IfModule mod_authz_core.c>
    Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
    Order allow,deny
    Deny from all
</IfModule>
"""


def _excluido(relativo: Path) -> bool:
    texto = relativo.as_posix()
    if any(texto == p or texto.startswith(p + "/") for p in PASTAS_EXCLUIDAS):
        return True
    if any(parte in ("__pycache__", ".git") for parte in relativo.parts):
        return True
    return any(fnmatch.fnmatch(relativo.name, padrao) for padrao in ARQUIVOS_EXCLUIDOS)


def _versao() -> dict:
    versao = "2.0.0"
    config = PHP_DIR / "app" / "Nucleo" / "Config.php"
    achado = re.search(r"'versao'\] \?\? '([^']+)'", config.read_text(encoding="utf-8")) if config.exists() else None
    if achado:
        versao = achado.group(1)
    commit = ""
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=RAIZ, capture_output=True, text=True, timeout=10
        ).stdout.strip()
        sujo = subprocess.run(
            ["git", "status", "--porcelain", "--", "php", "app/web"], cwd=RAIZ, capture_output=True, text=True, timeout=10
        ).stdout.strip()
        if commit and sujo:
            commit += "+alteracoes"
    except (OSError, subprocess.SubprocessError):
        pass
    return {
        "versao": versao,
        "commit": commit or "desconhecido",
        "gerado_em": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def _copiar(origem: Path, destino: Path) -> None:
    destino.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(origem, destino)


def _sha256(arquivo: Path) -> str:
    h = hashlib.sha256()
    with arquivo.open("rb") as f:
        for bloco in iter(lambda: f.read(1 << 16), b""):
            h.update(bloco)
    return h.hexdigest()


def montar(saida: Path) -> tuple[Path, dict]:
    """Monta saida/omnichannel2 do zero e devolve (pasta, manifesto)."""
    if not (PHP_DIR / "public" / "index.php").exists():
        raise SystemExit(f"php/public/index.php não encontrado em {PHP_DIR}")
    if not (WEB_DIR / "painel.html").exists():
        raise SystemExit(f"front não encontrado em {WEB_DIR}")
    pacote = saida / NOME
    if pacote.exists():
        shutil.rmtree(pacote)
    pacote.mkdir(parents=True)

    for arquivo in sorted(PHP_DIR.rglob("*")):
        relativo = arquivo.relative_to(PHP_DIR)
        # .htaccess é oculto mas é parte do pacote; os demais ocultos não
        if arquivo.is_dir() or _excluido(relativo):
            continue
        if arquivo.name.startswith(".") and arquivo.name != ".htaccess":
            continue
        _copiar(arquivo, pacote / relativo)

    # front: fonte única em app/web, copiada para web/ (fora do public)
    for arquivo in sorted(WEB_DIR.rglob("*")):
        relativo = arquivo.relative_to(WEB_DIR)
        if arquivo.is_dir() or _excluido(relativo) or arquivo.name.startswith("."):
            continue
        _copiar(arquivo, pacote / "web" / relativo)
    (pacote / "web" / ".htaccess").write_text(NEGAR_TUDO, encoding="utf-8")

    # defesa em profundidade: app/ nega tudo mesmo se o subdomínio apontar errado
    (pacote / "app" / ".htaccess").write_text(NEGAR_TUDO, encoding="utf-8")

    info = _versao()
    (pacote / "VERSAO").write_text(
        f"OmniChannel 2 {info['versao']}\ncommit {info['commit']}\ngerado em {info['gerado_em']}\n", encoding="utf-8"
    )

    _conferir(pacote)
    arquivos = []
    for arquivo in sorted(p for p in pacote.rglob("*") if p.is_file()):
        arquivos.append({
            "caminho": arquivo.relative_to(pacote).as_posix(),
            "tamanho": arquivo.stat().st_size,
            "sha256": _sha256(arquivo),
        })
    manifesto = {**info, "nome": NOME, "arquivos": arquivos}
    (saida / "manifesto.json").write_text(json.dumps(manifesto, indent=2, ensure_ascii=False), encoding="utf-8")
    return pacote, manifesto


def _conferir(pacote: Path) -> None:
    """Recusa o pacote se algo sensível ou de teste entrou."""
    problemas = []
    for arquivo in pacote.rglob("*"):
        relativo = arquivo.relative_to(pacote)
        if any(fnmatch.fnmatch(arquivo.name, p) for p in PROIBIDOS_NO_PACOTE) and relativo.as_posix() != "config.exemplo.php":
            problemas.append(relativo.as_posix())
        if relativo.parts and relativo.parts[0] in ("dados", "tests"):
            problemas.append(relativo.as_posix())
    obrigatorios = ["public/index.php", "public/instalar.php", "public/.htaccess", ".htaccess", "app/autoload.php",
                    "cron.php", "web/painel.html", "web/widget.js"]
    problemas += [f"faltando: {o}" for o in obrigatorios if not (pacote / o).is_file()]
    # em public/ só o que o .htaccess deixa sair: nada de página servida sem o PHP
    permitidos_no_public = {"public/index.php", "public/instalar.php", "public/.htaccess"}
    problemas += [
        f"fora do lugar (public/ só tem index.php, instalar.php e .htaccess): {p.relative_to(pacote).as_posix()}"
        for p in (pacote / "public").rglob("*")
        if p.is_file() and p.relative_to(pacote).as_posix() not in permitidos_no_public
    ]
    if problemas:
        raise SystemExit("pacote recusado:\n  " + "\n  ".join(sorted(set(problemas))))


def conferir_sintaxe(pacote: Path, php: str) -> list[str]:
    """`php -l` em cada .php; devolve os que falharam (vazio = tudo certo)."""
    falhas = []
    for arquivo in sorted(pacote.rglob("*.php")):
        resultado = subprocess.run([php, "-l", str(arquivo)], capture_output=True, text=True, timeout=60)
        if resultado.returncode != 0:
            falhas.append(f"{arquivo.relative_to(pacote)}: {resultado.stdout.strip() or resultado.stderr.strip()}")
    return falhas


def zipar(pacote: Path, destino: Path) -> Path:
    """Zip com omnichannel2/ na raiz, em ordem estável (dá para comparar pacotes)."""
    with zipfile.ZipFile(destino, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for arquivo in sorted(p for p in pacote.rglob("*") if p.is_file()):
            nome = f"{NOME}/{arquivo.relative_to(pacote).as_posix()}"
            info = zipfile.ZipInfo(nome, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, arquivo.read_bytes())
    return destino


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Empacota o OmniChannel 2 (PHP) para a Hostinger")
    parser.add_argument("--saida", type=Path, default=RAIZ / "dist", help="pasta de saída (padrão: omnichannel/dist)")
    parser.add_argument("--sem-zip", action="store_true", help="só a pasta, sem o .zip")
    parser.add_argument("--sem-lint", action="store_true", help="não rodar php -l")
    parser.add_argument("--php", default=os.environ.get("OMNI_PHP", "php"))
    parser.add_argument("--silencioso", action="store_true", help="não listar arquivo por arquivo")
    args = parser.parse_args(argv)

    saida = args.saida.resolve()
    saida.mkdir(parents=True, exist_ok=True)
    pacote, manifesto = montar(saida)

    if not args.sem_lint:
        if shutil.which(args.php):
            falhas = conferir_sintaxe(pacote, args.php)
            if falhas:
                print("php -l falhou:\n  " + "\n  ".join(falhas), file=sys.stderr)
                return 1
        else:
            print(f"aviso: {args.php} não encontrado; sintaxe PHP não conferida", file=sys.stderr)

    total = sum(a["tamanho"] for a in manifesto["arquivos"])
    if not args.silencioso:
        print(f"Manifesto de {NOME} {manifesto['versao']} ({manifesto['commit']}):")
        for a in manifesto["arquivos"]:
            print(f"  {a['tamanho']:>9}  {a['sha256'][:12]}  {a['caminho']}")
    print(f"{len(manifesto['arquivos'])} arquivos, {total / 1024:.1f} KiB em {pacote}")
    if not args.sem_zip:
        zip_ = zipar(pacote, saida / f"{NOME}-{manifesto['versao']}.zip")
        print(f"zip: {zip_} ({zip_.stat().st_size / 1024:.1f} KiB)")
    print(f"manifesto: {saida / 'manifesto.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Lançador de um clique (scripts/iniciar.py), iniciar.sh e a receita do Docker.

Nada aqui cria .venv, instala pacote ou sobe servidor de verdade: o .env, a
trava, o log e os dados vão para uma pasta descartável, e o que o lançador
pediria ao servidor é respondido pelo app em processo (TestClient).
"""
from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from scripts import iniciar

RAIZ = Path(__file__).resolve().parents[1]
POSIX = os.name != "nt"
SH = shutil.which("sh")


@pytest.fixture
def pasta(tmp_path, monkeypatch):
    """Uma instalação de mentira: tudo que o lançador grava cai aqui."""
    # subpasta: o tmp_path já tem os anexos do conftest
    raiz = tmp_path / "instalacao"
    raiz.mkdir()
    shutil.copy(RAIZ / ".env.example", raiz / ".env.example")
    monkeypatch.setattr(iniciar, "ARQUIVO_ENV", raiz / ".env")
    monkeypatch.setattr(iniciar, "EXEMPLO_ENV", raiz / ".env.example")
    monkeypatch.setattr(iniciar, "ARQUIVO_TRAVA", raiz / "omnichannel.lock")
    monkeypatch.setattr(iniciar, "ARQUIVO_LOG", raiz / "omnichannel.log")
    monkeypatch.setattr(iniciar, "PASTA_VENV", raiz / ".venv")
    monkeypatch.setattr(iniciar, "DADOS_LOCAIS", (raiz / "omnichannel.db", raiz / "anexos"))
    for nome in ("OMNI_SENHA_ADMIN", "OMNI_CHAVE_SECRETA", "OMNI_ORIGENS_PERMITIDAS"):
        monkeypatch.delenv(nome, raising=False)
    return raiz


def _isolar_main(monkeypatch, registro: list | None = None) -> None:
    # main() mexe no processo inteiro (sinais, umask): no pytest, só registra
    monkeypatch.setattr(iniciar, "instalar_sinais", lambda: None)

    def umask(mascara):
        if registro is not None:
            registro.append(mascara)
        return 0o022

    monkeypatch.setattr(iniciar.os, "umask", umask)


def _valores_do_env(pasta: Path) -> dict[str, str]:
    return iniciar._interpretar_env((pasta / ".env").read_text(encoding="utf-8").splitlines())


def _modo(caminho: Path) -> int:
    return stat.S_IMODE(caminho.stat().st_mode)


def _executavel(caminho: Path, corpo: str) -> None:
    caminho.write_text("#!/bin/sh\n" + corpo, encoding="utf-8")
    caminho.chmod(0o755)


# ------------------------------------------------------------ senha no quadro
def _tentar_pela_api(cliente):
    return lambda email, senha: cliente.post(
        "/api/auth/login", json={"email": email, "senha": senha}
    ).status_code == 200


def test_quadro_nao_mostra_a_senha_do_env_trocada_depois_da_primeira_carga(cliente, monkeypatch, capsys):
    from scripts.seed import semear

    monkeypatch.setenv("OMNI_SENHA_ADMIN", "admin123")
    semear()
    # o dono troca OMNI_SENHA_ADMIN no .env e roda de novo: o seed não mexe
    # numa base que já existe, então quem vale continua sendo a admin123
    monkeypatch.setenv("OMNI_SENHA_ADMIN", "segredo123")
    semear()
    capsys.readouterr()

    logins = iniciar.logins_que_valem(_tentar_pela_api(cliente), "segredo123")
    assert logins == [
        ("admin@multfiscal.com.br", "admin123", "administrador"),
        ("ana@multfiscal.com.br", "ana12345", "atendente"),
    ]
    iniciar.quadro(8000, "", logins, "segredo123", Path("omnichannel.log"))
    saida = capsys.readouterr().out
    assert "segredo123" not in saida
    assert "admin@multfiscal.com.br / admin123" in saida
    assert "só vale na primeira carga" in saida


def test_quadro_nao_mostra_senha_de_exemplo_que_ja_foi_trocada(cliente, monkeypatch, capsys):
    from scripts.seed import semear

    semear()
    token = cliente.post(
        "/api/auth/login", json={"email": "ana@multfiscal.com.br", "senha": "ana12345"}
    ).json()["token"]
    ana = cliente.get("/api/auth/eu", headers={"Authorization": f"Bearer {token}"}).json()
    resposta = cliente.patch(
        f"/api/atendentes/{ana['id']}", json={"senha": "a-nova-da-ana"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resposta.status_code == 200
    capsys.readouterr()

    logins = iniciar.logins_que_valem(_tentar_pela_api(cliente), "admin123")
    assert logins[1] == ("ana@multfiscal.com.br", None, "atendente")
    iniciar.quadro(8000, "", logins, "admin123", Path("omnichannel.log"))
    saida = capsys.readouterr().out
    assert "ana12345" not in saida
    assert iniciar.SENHA_DESCONHECIDA in saida
    # a senha do admin é a padrão e vale: nada a avisar
    assert "Atenção" not in saida


def test_senha_do_admin_vazia_conta_como_ausente(pasta, monkeypatch):
    # vazia, o seed gravaria um administrador que entra sem senha
    (pasta / ".env").write_text("OMNI_SENHA_ADMIN=a-do-env-123\n", encoding="utf-8")
    monkeypatch.setenv("OMNI_SENHA_ADMIN", "")
    assert iniciar.ambiente_dos_processos()["OMNI_SENHA_ADMIN"] == "a-do-env-123"

    (pasta / ".env").write_text("OMNI_SENHA_ADMIN=\n", encoding="utf-8")
    assert "OMNI_SENHA_ADMIN" not in iniciar.ambiente_dos_processos()


# ------------------------------------------------------------------- sinais
@pytest.mark.skipif(not POSIX, reason="SIGHUP e nohup só existem no POSIX")
def test_sighup_ignorado_pelo_nohup_continua_ignorado_ate_no_servidor():
    # roda em outro processo para não mexer nos sinais do pytest; o neto faz o
    # papel do uvicorn, que só sobrevive ao terminal fechado herdando o SIG_IGN
    codigo = (
        "import signal, subprocess, sys\n"
        f"sys.path.insert(0, {str(RAIZ)!r})\n"
        "from scripts import iniciar\n"
        "signal.signal(signal.SIGHUP, signal.SIG_IGN)\n"
        "signal.signal(signal.SIGTERM, signal.SIG_DFL)\n"
        "iniciar.instalar_sinais()\n"
        "print(signal.getsignal(signal.SIGHUP) is signal.SIG_IGN)\n"
        "print(signal.getsignal(signal.SIGTERM) is iniciar._ao_receber_sinal)\n"
        "neto = [sys.executable, '-c', 'import signal; print(signal.getsignal(signal.SIGHUP) is signal.SIG_IGN)']\n"
        "print(subprocess.run(neto, capture_output=True, text=True).stdout.strip())\n"
    )
    resultado = subprocess.run([sys.executable, "-c", codigo], capture_output=True, text=True, timeout=60)
    assert resultado.returncode == 0, resultado.stderr
    assert resultado.stdout.split() == ["True", "True", "True"]


# ------------------------------------------------------------ uma cópia só
def test_segunda_copia_nao_mexe_no_venv_e_aponta_para_a_primeira(pasta, monkeypatch, capsys):
    _isolar_main(monkeypatch)
    monkeypatch.setattr(iniciar, "preparar_venv", lambda: pytest.fail("a segunda cópia mexeu no .venv"))
    abertos = []
    monkeypatch.setattr(iniciar, "abrir_navegador", abertos.append)

    primeira = iniciar.pegar_trava()
    assert primeira is not None
    try:
        # a primeira ainda está criando o ambiente: nada de porta
        assert iniciar.main(["--sem-navegador"]) == 1
        assert "Outra janela já está abrindo o OmniChannel" in capsys.readouterr().out

        # com o servidor dela no ar, a segunda só manda o dono para lá
        iniciar.escrever_trava(primeira, 8765)
        monkeypatch.setattr(iniciar, "_saude_responde", lambda porta: porta == 8765)
        assert iniciar.main([]) == 0
        assert "já está rodando nesta pasta: http://127.0.0.1:8765/painel" in capsys.readouterr().out
        assert abertos == ["http://127.0.0.1:8765/painel"]
    finally:
        iniciar.soltar_trava(primeira)

    # solta a trava (ou morto o lançador), a próxima execução segue normalmente
    seguinte = iniciar.pegar_trava()
    assert seguinte is not None
    iniciar.soltar_trava(seguinte)


def test_venv_que_nao_pode_ser_apagado_vira_mensagem(pasta, monkeypatch):
    (pasta / ".venv").mkdir()
    (pasta / ".venv" / "pyvenv.cfg").write_text("home = /nada\n", encoding="utf-8")

    def travado(caminho, *args, **kwargs):
        # o que o Windows responde com um python.exe do .venv ainda aberto
        raise PermissionError(13, "O arquivo já está sendo usado por outro processo", str(caminho))

    monkeypatch.setattr(iniciar.shutil, "rmtree", travado)
    with pytest.raises(iniciar.ErroLancador, match="Feche os outros programas"):
        iniciar.preparar_venv()


def test_env_criado_por_outro_processo_no_meio_do_caminho_nao_vira_traceback(pasta, monkeypatch):
    ler_de_verdade = iniciar._ler_env
    do_outro = "OMNI_CHAVE_SECRETA=chave-que-o-outro-processo-acabou-de-gravar\n"

    def perder_a_corrida():
        # não acha o .env; logo em seguida o outro processo grava o dele
        monkeypatch.setattr(iniciar, "_ler_env", ler_de_verdade)
        (pasta / ".env").write_text(do_outro, encoding="utf-8")
        return None

    monkeypatch.setattr(iniciar, "_ler_env", perder_a_corrida)
    iniciar.preparar_env()
    assert (pasta / ".env").read_text(encoding="utf-8") == do_outro


# --------------------------------------------------------- chave de exemplo
@pytest.mark.parametrize(
    "conteudo",
    [
        None,  # o `cp .env.example .env` do README
        "OMNI_SENHA_ADMIN=admin123\n",
        "OMNI_CHAVE_SECRETA=\nOMNI_SENHA_ADMIN=admin123\n",
        'OMNI_CHAVE_SECRETA="troque-esta-chave-em-producao"\nOMNI_SENHA_ADMIN=admin123\n',
        # a última definição vence, como no python-dotenv que o app usa
        "OMNI_CHAVE_SECRETA=uma-chave-forte-mas-sobrescrita-123\n"
        "OMNI_SENHA_ADMIN=admin123\n"
        "export OMNI_CHAVE_SECRETA=troque-esta-chave-em-producao  # de exemplo\n",
    ],
)
def test_env_existente_com_chave_publica_ganha_chave_propria(pasta, capsys, conteudo):
    if conteudo is None:
        shutil.copy(pasta / ".env.example", pasta / ".env")
    else:
        (pasta / ".env").write_text(conteudo, encoding="utf-8")
    if POSIX:
        (pasta / ".env").chmod(0o644)

    iniciar.preparar_env()
    valores = _valores_do_env(pasta)
    chave = valores["OMNI_CHAVE_SECRETA"]
    assert chave != iniciar.CHAVE_DE_EXEMPLO and len(chave) >= 40
    # o resto do arquivo fica como o dono deixou
    assert valores["OMNI_SENHA_ADMIN"] == "admin123"
    assert (pasta / ".env").read_text(encoding="utf-8").count("OMNI_CHAVE_SECRETA=") == 1
    assert "chave secreta de exemplo" in capsys.readouterr().out
    if POSIX:
        assert _modo(pasta / ".env") == 0o600

    # da segunda vez não troca de novo: os logins abertos continuam valendo
    iniciar.preparar_env()
    assert _valores_do_env(pasta)["OMNI_CHAVE_SECRETA"] == chave


def test_env_com_chave_propria_fica_intocado(pasta, capsys):
    conteudo = "# meu .env\nOMNI_CHAVE_SECRETA=minha-chave-longa-e-aleatoria-de-verdade\n"
    (pasta / ".env").write_text(conteudo, encoding="utf-8")
    iniciar.preparar_env()
    assert (pasta / ".env").read_text(encoding="utf-8") == conteudo
    assert capsys.readouterr().out == ""


@pytest.mark.parametrize("valor", ["", iniciar.CHAVE_DE_EXEMPLO])
def test_chave_publica_no_ambiente_do_sistema_nao_chega_ao_app(pasta, monkeypatch, valor):
    # a variável do sistema vence o .env dentro do app
    iniciar.preparar_env()
    monkeypatch.setenv("OMNI_CHAVE_SECRETA", valor)
    assert "OMNI_CHAVE_SECRETA" not in iniciar.ambiente_dos_processos()

    monkeypatch.setenv("OMNI_CHAVE_SECRETA", "uma-chave-forte-posta-no-sistema")
    assert iniciar.ambiente_dos_processos()["OMNI_CHAVE_SECRETA"] == "uma-chave-forte-posta-no-sistema"


def test_env_que_existe_mas_nao_abre_nao_e_substituido(pasta):
    # uma pasta no lugar do arquivo faz o papel de um .env de outro dono:
    # existe, mas a leitura falha
    (pasta / ".env").mkdir()
    with pytest.raises(iniciar.ErroLancador, match="Não consegui ler"):
        iniciar.preparar_env()
    assert (pasta / ".env").is_dir()


def test_env_fora_de_utf8_vira_mensagem_e_nao_traceback(pasta, monkeypatch, capsys):
    # o "ANSI" do Bloco de Notas, com os acentos dos comentários do exemplo
    texto = (pasta / ".env.example").read_text(encoding="utf-8")
    (pasta / ".env").write_bytes(texto.encode("cp1252"))
    _isolar_main(monkeypatch)
    monkeypatch.setattr(iniciar, "preparar_venv", lambda: Path(sys.executable))

    assert iniciar.main(["--sem-navegador"]) == 1
    saida = capsys.readouterr().out
    assert "não está em UTF-8" in saida
    assert "Salvar como" in saida


def test_leitura_do_env_concorda_com_o_python_dotenv(pasta):
    from dotenv import dotenv_values

    conteudo = (
        "export A=1\n"
        'B="com # dentro" # comentário\n'
        "C=sem aspas # comentário\n"
        "# D=comentado\n"
        "A=2\n"
    )
    (pasta / ".env").write_text(conteudo, encoding="utf-8")
    assert iniciar._interpretar_env(conteudo.splitlines()) == dict(dotenv_values(pasta / ".env"))


# --------------------------------------------------------------------- CORS
def test_env_novo_nasce_com_cors_fechado(pasta):
    iniciar.preparar_env()
    linhas = (pasta / ".env").read_text(encoding="utf-8").splitlines()
    assert iniciar._interpretar_env(linhas)["OMNI_ORIGENS_PERMITIDAS"] == "[]"
    # uma definição só: a linha comentada do exemplo virou a de verdade
    assert [iniciar._nome_na_linha(linha) for linha in linhas].count("OMNI_ORIGENS_PERMITIDAS") == 1
    assert not any(linha.startswith("# OMNI_ORIGENS_PERMITIDAS=") for linha in linhas)


def test_cors_fica_fechado_sem_atropelar_quem_configurou_o_widget(pasta, monkeypatch):
    chave = "OMNI_CHAVE_SECRETA=chave-forte-de-um-env-de-antes-da-correcao\n"
    (pasta / ".env").write_text(chave, encoding="utf-8")
    assert iniciar.ambiente_dos_processos()["OMNI_ORIGENS_PERMITIDAS"] == "[]"

    # no app a variável de ambiente venceria o .env: quem já liberou o site do
    # widget ali não pode perder a liberação
    (pasta / ".env").write_text(chave + 'OMNI_ORIGENS_PERMITIDAS=["https://www.loja.com.br"]\n', encoding="utf-8")
    assert "OMNI_ORIGENS_PERMITIDAS" not in iniciar.ambiente_dos_processos()

    monkeypatch.setenv("OMNI_ORIGENS_PERMITIDAS", '["https://outra.com.br"]')
    assert iniciar.ambiente_dos_processos()["OMNI_ORIGENS_PERMITIDAS"] == '["https://outra.com.br"]'


def test_cors_fechado_recusa_pagina_de_outra_origem_e_mantem_o_painel(pasta, monkeypatch):
    from app import main as app_main
    from app.config import Configuracao

    monkeypatch.setenv("OMNI_ORIGENS_PERMITIDAS", iniciar.ambiente_dos_processos()["OMNI_ORIGENS_PERMITIDAS"])
    config = Configuracao()
    monkeypatch.setattr(app_main, "obter_config", lambda: config)
    cliente = TestClient(app_main.criar_app())

    preflight = cliente.options(
        "/api/auth/login",
        headers={
            "Origin": "https://site-malicioso.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert "access-control-allow-origin" not in preflight.headers
    # o painel é da mesma origem: o navegador não faz preflight e o pedido passa
    login = cliente.post(
        "/api/auth/login", json={"email": "ninguem@x.com", "senha": "x"},
        headers={"Origin": "http://testserver"},
    )
    assert login.status_code == 401


# ------------------------------------------------ log, base e permissões
def test_servidor_sobe_sem_log_de_acesso(monkeypatch):
    # o log de acesso grava a URL do fluxo SSE, com o token de login na query
    comandos = []
    monkeypatch.setattr(iniciar.subprocess, "Popen", lambda comando, **_: comandos.append(comando))
    iniciar.subir_servidor(Path("python"), 8000, {}, None)
    assert "--no-access-log" in comandos[0]


def test_main_fecha_a_mascara_antes_de_criar_qualquer_arquivo(pasta, monkeypatch):
    registro = []
    _isolar_main(monkeypatch, registro)

    def pegar_trava():
        registro.append("trava")
        return None

    monkeypatch.setattr(iniciar, "pegar_trava", pegar_trava)
    monkeypatch.setattr(iniciar, "avisar_outra_copia", lambda sem_navegador: 0)
    iniciar.main(["--sem-navegador"])
    assert registro == ([0o077] if POSIX else []) + ["trava"]


@pytest.mark.skipif(not POSIX, reason="permissões POSIX")
def test_log_base_e_anexos_de_um_lancador_antigo_ficam_so_do_dono(pasta):
    for arquivo in (pasta / "omnichannel.log", pasta / "omnichannel.db"):
        arquivo.write_bytes(b"x")
        arquivo.chmod(0o644)
    (pasta / "anexos").mkdir(mode=0o755)

    iniciar.proteger_dados_antigos()
    assert _modo(pasta / "omnichannel.db") == 0o600
    assert _modo(pasta / "anexos") == 0o700

    (pasta / "omnichannel.log").chmod(0o644)
    caminho, log = iniciar.abrir_log()
    log.close()
    assert caminho == pasta / "omnichannel.log"
    assert _modo(caminho) == 0o600


# --------------------------------------------------- Python velho no PATH
@pytest.mark.skipif(not POSIX or SH is None, reason="precisa de sh")
def test_iniciar_sh_explica_python_antigo_em_vez_de_syntaxerror(tmp_path):
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    # um python3 3.5: falha no teste de versão e não compila o iniciar.py
    _executavel(
        bin_ / "python3",
        'case "$1" in\n'
        "  -c) exit 1 ;;\n"
        '  --version) echo "Python 3.5.4" ;;\n'
        '  *) echo "SyntaxError: invalid syntax" >&2; exit 1 ;;\n'
        "esac\n",
    )
    (bin_ / "dirname").symlink_to(shutil.which("dirname"))

    resultado = subprocess.run(
        [SH, str(RAIZ / "iniciar.sh")], env={"PATH": str(bin_)}, capture_output=True, text=True, timeout=60
    )
    assert resultado.returncode == 1
    assert "Python 3.10 ou mais novo" in resultado.stderr
    assert "Python 3.5.4" in resultado.stderr
    assert "SyntaxError" not in resultado.stdout + resultado.stderr


# ------------------------------------------------------------------- Docker
def _cmd_do_dockerfile() -> str:
    """A linha CMD em forma de shell, com as continuações juntadas como o Docker faz."""
    linhas = (RAIZ / "Dockerfile").read_text(encoding="utf-8").splitlines()
    inicio = next(i for i, linha in enumerate(linhas) if linha.startswith("CMD "))
    partes = []
    for linha in linhas[inicio:]:
        continua = linha.endswith("\\")
        partes.append(linha[:-1] if continua else linha)
        if not continua:
            break
    return "".join(partes)[len("CMD "):]


@pytest.mark.skipif(not POSIX or SH is None, reason="precisa de sh")
@pytest.mark.parametrize(
    ("recebida", "esperada"),
    [
        (None, "chave-gerada-no-container"),
        ("", "chave-gerada-no-container"),
        # o env_file do compose traz a de exemplo quando o .env veio do .env.example
        (iniciar.CHAVE_DE_EXEMPLO, "chave-gerada-no-container"),
        ("uma-chave-forte-do-dono", "uma-chave-forte-do-dono"),
    ],
)
def test_container_nunca_assina_com_a_chave_de_exemplo(tmp_path, recebida, esperada):
    dados = tmp_path / "dados"
    dados.mkdir()
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    _executavel(bin_ / "python", 'if [ "$1" = -c ]; then echo chave-gerada-no-container; fi\n')
    _executavel(bin_ / "uvicorn", 'echo "assinando com: $OMNI_CHAVE_SECRETA"\n')
    ambiente = {"PATH": f"{bin_}{os.pathsep}/usr/bin{os.pathsep}/bin", "OMNI_DEMO": "0"}
    if recebida is not None:
        ambiente["OMNI_CHAVE_SECRETA"] = recebida

    comando = _cmd_do_dockerfile().replace("/dados", str(dados))
    resultado = subprocess.run([SH, "-c", comando], env=ambiente, capture_output=True, text=True, timeout=60)
    assert resultado.returncode == 0, resultado.stderr
    assert resultado.stdout.strip().splitlines()[-1] == f"assinando com: {esperada}"


@pytest.mark.skipif(not POSIX or SH is None, reason="precisa de sh")
@pytest.mark.parametrize(("recebida", "esperada"), [(None, "ausente"), ("", "ausente"), ("forte-123", "forte-123")])
def test_container_nao_cria_admin_sem_senha(tmp_path, recebida, esperada):
    # o env_file do compose passa um OMNI_SENHA_ADMIN= vazio adiante, e o seed
    # só usa a admin123 quando a variável não existe
    dados = tmp_path / "dados"
    dados.mkdir()
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    _executavel(bin_ / "python", 'if [ "$1" = -m ]; then echo "senha do seed: ${OMNI_SENHA_ADMIN-ausente}"; fi\n')
    _executavel(bin_ / "uvicorn", "true\n")
    ambiente = {"PATH": f"{bin_}{os.pathsep}/usr/bin{os.pathsep}/bin", "OMNI_CHAVE_SECRETA": "uma-chave-forte"}
    if recebida is not None:
        ambiente["OMNI_SENHA_ADMIN"] = recebida

    comando = _cmd_do_dockerfile().replace("/dados", str(dados))
    resultado = subprocess.run([SH, "-c", comando], env=ambiente, capture_output=True, text=True, timeout=60)
    assert resultado.returncode == 0, resultado.stderr
    assert f"senha do seed: {esperada}" in resultado.stdout


def test_imagem_nasce_com_cors_fechado():
    texto = (RAIZ / "Dockerfile").read_text(encoding="utf-8")
    assert re.search(r"^\s+OMNI_ORIGENS_PERMITIDAS=\[\] \\$", texto, re.MULTILINE)


def _regex_do_dockerignore(padrao: str) -> str:
    # mesma leitura do Docker: ** atravessa pastas (inclusive nenhuma), * não
    regex, i = "", 0
    while i < len(padrao):
        if padrao.startswith("**/", i):
            regex, i = regex + "(?:.*/)?", i + 3
        elif padrao.startswith("**", i):
            regex, i = regex + ".*", i + 2
        elif padrao[i] == "*":
            regex, i = regex + "[^/]*", i + 1
        elif padrao[i] == "?":
            regex, i = regex + "[^/]", i + 1
        elif padrao[i] == "[":
            fim = padrao.index("]", i)
            regex, i = regex + padrao[i:fim + 1], fim + 1
        else:
            regex, i = regex + re.escape(padrao[i]), i + 1
    return regex


def _fica_fora_da_imagem(caminho: str, padroes: list[str]) -> bool:
    partes = caminho.split("/")
    # uma pasta ignorada leva junto tudo que está dentro dela
    prefixos = ["/".join(partes[:n]) for n in range(1, len(partes) + 1)]
    return any(re.fullmatch(_regex_do_dockerignore(p), prefixo) for p in padroes for prefixo in prefixos)


def test_dockerignore_deixa_dados_e_segredos_fora_em_qualquer_pasta():
    padroes = [
        linha.strip() for linha in (RAIZ / ".dockerignore").read_text(encoding="utf-8").splitlines()
        if linha.strip() and not linha.startswith("#")
    ]
    # seed rodado de dentro de scripts/ grava a base em scripts/omnichannel.db
    for segredo in (
        ".env", "omnichannel.db", "omnichannel.log", "anexos/1/doc.pdf", "omnichannel.lock",
        "scripts/omnichannel.db", "scripts/omnichannel.db-journal", "scripts/.env",
        "scripts/omni.log", "app/anexos/doc.pdf", "app/__pycache__/main.cpython-311.pyc",
    ):
        assert _fica_fora_da_imagem(segredo, padroes), segredo
    for codigo in ("app/main.py", "scripts/seed.py", "requirements.txt", "app/web/painel.js"):
        assert not _fica_fora_da_imagem(codigo, padroes), codigo


def test_seed_de_producao_nao_cria_a_atendente_de_senha_publica(cliente, monkeypatch, capsys):
    """Na VPS (OMNI_DEMO=0 no container) a base nasce só com o administrador,
    como a do instalador PHP: ana12345 está no repositório."""
    from scripts.seed import semear

    monkeypatch.setenv("OMNI_SENHA_ADMIN", "senha-do-dono-9")
    semear(producao=True)
    saida = capsys.readouterr().out
    assert "ana@" not in saida
    tentar = _tentar_pela_api(cliente)
    assert tentar("admin@multfiscal.com.br", "senha-do-dono-9")
    assert not tentar("ana@multfiscal.com.br", "ana12345")
    token = cliente.post(
        "/api/auth/login", json={"email": "admin@multfiscal.com.br", "senha": "senha-do-dono-9"}
    ).json()["token"]
    equipe = cliente.get("/api/atendentes", headers={"Authorization": f"Bearer {token}"}).json()
    assert [a["email"] for a in equipe] == ["admin@multfiscal.com.br"]
    # os canais e o webchat nascem do mesmo jeito (o e-mail já com o segredo do webhook)
    canais = cliente.get("/api/canais", headers={"Authorization": f"Bearer {token}"}).json()
    assert sorted(c["tipo"] for c in canais) == ["email", "telegram", "webchat", "whatsapp"]

"""Sobe o IHchat com um comando só, sem precisar conhecer venv, pip ou uvicorn.

    python scripts/iniciar.py                  # prepara tudo e abre o painel
    python scripts/iniciar.py --porta 9000     # começa pela 9000 (ocupada: a próxima livre)
    python scripts/iniciar.py --sem-navegador  # não abre o navegador
    python scripts/iniciar.py --sem-demo       # base sem as conversas de exemplo

No Windows é o que o iniciar.bat roda no duplo clique; no Linux e no macOS, o
iniciar.sh. Usa só a biblioteca padrão porque roda *antes* de existir o
ambiente com as dependências: é ele que cria esse ambiente.
"""
import sys

# A checagem vem antes de qualquer outra coisa, e o arquivo evita o que o 3.6
# ainda não entende (nem `from __future__ import annotations`): do 3.6 ao 3.9 o
# usuário vê "instale o 3.10", não um SyntaxError. Um 2.7 ou 3.5 nem compila o
# arquivo (f-strings); esses o iniciar.bat e o iniciar.sh barram antes de
# chamá-lo, com a mesma orientação.
VERSAO_MINIMA = (3, 10)
if sys.version_info < VERSAO_MINIMA:
    sys.stderr.write(
        "\nO IHchat precisa do Python %d.%d ou mais novo; este é o %d.%d (%s).\n"
        "Baixe a versão atual em https://www.python.org/downloads/ e rode de novo.\n"
        "No Windows, marque \"Add python.exe to PATH\" na primeira tela do instalador.\n\n"
        % (VERSAO_MINIMA + tuple(sys.version_info[:2]) + (sys.executable,))
    )
    sys.exit(1)

import argparse  # noqa: E402
import hashlib  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import secrets  # noqa: E402
import shutil  # noqa: E402
import signal  # noqa: E402
import socket  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402
import time  # noqa: E402
import urllib.error  # noqa: E402
import urllib.request  # noqa: E402
import webbrowser  # noqa: E402
from pathlib import Path  # noqa: E402

RAIZ = Path(__file__).resolve().parents[1]
PASTA_VENV = RAIZ / ".venv"
REQUISITOS = RAIZ / "requirements.txt"
# guarda o hash do requirements.txt da última instalação que deu certo: sem
# ele, todo duplo clique pagaria alguns segundos de pip só para confirmar
MARCA_REQUISITOS = PASTA_VENV / ".requisitos-instalados"
ARQUIVO_ENV = RAIZ / ".env"
EXEMPLO_ENV = RAIZ / ".env.example"
ARQUIVO_LOG = RAIZ / "ihchat.log"
# Uma cópia do lançador por pasta. Duas ao mesmo tempo (o segundo duplo clique
# durante a instalação, ou depois de fechar só a aba do navegador) apagavam o
# .venv uma da outra e, com tudo pronto, subiam dois servidores na mesma base,
# cada um com os seus eventos em tempo real, escrevendo no mesmo log.
ARQUIVO_TRAVA = RAIZ / "ihchat.lock"
# no Windows a região travada não pode ser lida por outro processo: travar um
# byte bem depois do fim deixa o conteúdo (pid e porta) legível para a outra cópia
POSICAO_TRAVA_WINDOWS = 1 << 20
# o que um lançador antigo deixou legível por todos antes do umask de main();
# são os caminhos padrão do .env.example
DADOS_LOCAIS = (RAIZ / "ihchat.db", RAIZ / "anexos")

WINDOWS = os.name == "nt"
HOST = "127.0.0.1"
PORTA_PADRAO = 8000
PORTAS_A_TENTAR = 50
# a primeira subida no Windows, com antivírus olhando cada .pyc, passa de 20 s
ESPERA_SUBIDA = 90
# o uvicorn espera as conexões abertas terminarem antes de sair, e o fluxo SSE
# do painel nunca termina sozinho: sem limite, o Ctrl+C ficaria pendurado
FOLGA_DESLIGAMENTO = 3
ESPERA_DESLIGAMENTO = 10
LARGURA_MAXIMA_QUADRO = 78

# a do .env.example e a padrão do config.py: pública, qualquer um que leia o
# repositório assina com ela um token de administrador
CHAVE_DE_EXEMPLO = "troque-esta-chave-em-producao"
# a que o scripts/seed.py usa quando falta IHCHAT_SENHA_ADMIN
SENHA_ADMIN_PADRAO = "admin123"
EMAIL_ADMIN = "admin@multfiscal.com.br"
LOGINS_EXEMPLO = [
    (EMAIL_ADMIN, None, "administrador"),  # senha vem de IHCHAT_SENHA_ADMIN
    ("ana@multfiscal.com.br", "ana12345", "atendente"),
]
SENHA_DESCONHECIDA = "(senha trocada)"

CONSULTA_CHAVE_WEBCHAT = """
from sqlalchemy import select
from app.db import SessaoLocal
from app.models import Canal, TipoCanal
with SessaoLocal() as sessao:
    print(sessao.scalar(
        select(Canal.chave_publica)
        .where(Canal.tipo == TipoCanal.WEBCHAT.value, Canal.ativo.is_(True),
               Canal.chave_publica.is_not(None))
        .order_by(Canal.id).limit(1)
    ) or "")
"""


class ErroLancador(Exception):
    """Falha que o próprio usuário consegue resolver: vira mensagem, não traceback."""


class PedidoDeParada(BaseException):
    """SIGTERM/SIGHUP: sem isto o Python morre na hora e o servidor fica órfão na porta.

    Herda de BaseException, como o KeyboardInterrupt, para nenhum `except
    Exception` no caminho engolir o pedido e deixar o servidor no ar.
    """


def aviso(texto: str = "") -> None:
    # com o terminal já fechado (SIGHUP), escrever falha; parar o servidor
    # importa mais do que a mensagem
    try:
        print(texto, flush=True)
    except OSError:
        pass


def _abridor() -> urllib.request.OpenerDirector:
    # sem proxy: um proxy do sistema (comum em rede de empresa) não alcança o
    # 127.0.0.1 desta máquina e faria toda conversa com o servidor falhar
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


# ------------------------------------------------------------------ uma cópia só
def pegar_trava() -> int | None:
    """Trava da pasta, ou None se outra cópia do lançador já está com ela.

    Trava do sistema operacional, não um arquivo que "existe ou não": se o
    lançador morre de qualquer jeito, o sistema solta a trava junto, e nunca
    sobra uma trava velha impedindo a próxima execução.
    """
    try:
        trava = os.open(ARQUIVO_TRAVA, os.O_RDWR | os.O_CREAT, 0o600)
    except OSError as erro:
        raise ErroLancador(
            f"Não consegui criar {ARQUIVO_TRAVA} ({erro}).\n"
            "A pasta do IHchat precisa aceitar gravação: copie-a para a sua pasta de usuário."
        ) from None
    try:
        if WINDOWS:
            import msvcrt

            os.lseek(trava, POSICAO_TRAVA_WINDOWS, os.SEEK_SET)
            msvcrt.locking(trava, msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(trava, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(trava)
        return None
    escrever_trava(trava, None)
    return trava


def escrever_trava(trava: int, porta: int | None) -> None:
    """Deixa na trava onde o servidor atende, para a segunda cópia só mandar o dono para lá."""
    dados = json.dumps({"pid": os.getpid(), "porta": porta}).encode("utf-8")
    try:
        os.ftruncate(trava, 0)
        os.lseek(trava, 0, os.SEEK_SET)
        os.write(trava, dados)
    except OSError:
        # é só conveniência para uma segunda cópia; a trava em si continua valendo
        pass


def soltar_trava(trava: int) -> None:
    if WINDOWS:
        import msvcrt

        # fechar também solta, mas o Windows promete isso só "quando der"; a
        # próxima cópia, aberta logo em seguida, acharia a pasta ainda travada
        try:
            os.lseek(trava, POSICAO_TRAVA_WINDOWS, os.SEEK_SET)
            msvcrt.locking(trava, msvcrt.LK_UNLCK, 1)
        except OSError:
            pass
    os.close(trava)


def avisar_outra_copia(sem_navegador: bool) -> int:
    try:
        dados = json.loads(ARQUIVO_TRAVA.read_text(encoding="utf-8"))
        porta = dados.get("porta") if isinstance(dados, dict) else None
    except (OSError, ValueError):
        # a outra cópia pode estar no meio da escrita: conta como "ainda subindo"
        porta = None
    if isinstance(porta, int) and _saude_responde(porta):
        endereco = f"http://{HOST}:{porta}/painel"
        aviso(f"O IHchat já está rodando nesta pasta: {endereco}")
        aviso("Para pará-lo, use a janela em que ele foi aberto (Ctrl+C).")
        if not sem_navegador:
            abrir_navegador(endereco)
        return 0
    aviso()
    aviso("Outra janela já está abrindo o IHchat nesta pasta.")
    aviso("Espere por ela: quando terminar, o endereço do painel aparece lá.")
    return 1


# ------------------------------------------------------------------ ambiente
def python_do_venv() -> Path:
    if WINDOWS:
        return PASTA_VENV / "Scripts" / "python.exe"
    return PASTA_VENV / "bin" / "python"


def _venv_utilizavel(python: Path) -> bool:
    """O .venv pode ter sobrado de um Python que foi desinstalado ou de uma criação interrompida."""
    if not python.exists():
        return False
    teste = "import sys, pip; sys.exit(0 if sys.version_info >= (3, 10) else 1)"
    try:
        return subprocess.run([str(python), "-c", teste], capture_output=True, timeout=60).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _dica_venv() -> str:
    dica = "Não consegui criar o ambiente Python em .venv (mensagens acima)."
    if sys.platform.startswith("linux"):
        # Debian e Ubuntu separam o venv/ensurepip do python3
        versao = "%d.%d" % sys.version_info[:2]
        dica += f"\nNo Debian/Ubuntu instale o pacote do venv: sudo apt install python{versao}-venv"
    return dica


def preparar_venv() -> Path:
    python = python_do_venv()
    if PASTA_VENV.exists() and not _venv_utilizavel(python):
        if not (PASTA_VENV / "pyvenv.cfg").exists():
            raise ErroLancador(
                f"A pasta {PASTA_VENV} existe mas não é um ambiente Python.\n"
                "Renomeie ou apague essa pasta e rode de novo."
            )
        aviso("O ambiente em .venv não funciona mais (Python trocado ou instalação interrompida); recriando.")
        try:
            shutil.rmtree(PASTA_VENV)
        except OSError as erro:
            # no Windows, um python.exe do .venv ainda aberto (um servidor
            # órfão de outra execução) segura a pasta
            raise ErroLancador(
                f"Não consegui apagar {PASTA_VENV} ({erro}).\n"
                "Feche os outros programas que usam o IHchat e rode de novo."
            ) from None

    if not PASTA_VENV.exists():
        aviso("Criando o ambiente Python em .venv (só na primeira vez)...")
        resultado = subprocess.run([sys.executable, "-m", "venv", str(PASTA_VENV)])
        if resultado.returncode != 0 or not python.exists():
            # um .venv pela metade seria confundido com um pronto na próxima vez
            shutil.rmtree(PASTA_VENV, ignore_errors=True)
            raise ErroLancador(_dica_venv())

    assinatura = hashlib.sha256(REQUISITOS.read_bytes()).hexdigest()
    try:
        instalada = MARCA_REQUISITOS.read_text(encoding="utf-8").strip()
    except OSError:
        instalada = ""
    if instalada == assinatura:
        aviso("Dependências já instaladas.")
        return python

    aviso("Instalando as dependências (a primeira vez leva alguns minutos)...")
    comando = [str(python), "-m", "pip", "install", "--disable-pip-version-check", "-r", str(REQUISITOS)]
    if subprocess.run(comando, cwd=RAIZ).returncode != 0:
        raise ErroLancador(
            "Não consegui instalar as dependências (mensagens acima).\n"
            "Confira a conexão com a internet (e o proxy da rede, se houver) e rode de novo."
        )
    # só grava depois do sucesso: uma instalação interrompida é refeita
    MARCA_REQUISITOS.write_text(assinatura, encoding="utf-8")
    return python


def _ler_env() -> list[str] | None:
    """Linhas do .env, ou None se ele não existe."""
    try:
        # -sig: o Bloco de Notas às vezes grava a marca de UTF-8 no começo
        return ARQUIVO_ENV.read_text(encoding="utf-8-sig").splitlines()
    except UnicodeDecodeError:
        # o app também lê o .env como UTF-8 e cairia na subida com um
        # traceback; aqui ao menos vira uma instrução
        raise ErroLancador(
            f"O arquivo {ARQUIVO_ENV} não está em UTF-8 (foi salvo como ANSI?).\n"
            "Abra-o no Bloco de Notas, use Arquivo > Salvar como, escolha a codificação UTF-8 e rode de novo."
        ) from None
    except FileNotFoundError:
        return None
    except OSError as erro:
        # existe mas não abre (dono diferente, por exemplo): tratar como
        # ausente faria o lançador gravar outro .env por cima do do dono
        raise ErroLancador(f"Não consegui ler {ARQUIVO_ENV} ({erro}).") from None


def _nome_na_linha(linha: str) -> str | None:
    linha = linha.strip()
    if linha.startswith("export "):
        linha = linha[len("export "):]
    nome, separador, _ = linha.partition("=")
    nome = nome.strip()
    if not separador or not nome or nome.startswith("#"):
        return None
    return nome


def _interpretar_env(linhas: list[str]) -> dict[str, str]:
    """Leitura mínima do .env (NOME=valor), só para o que o app não lê sozinho.

    Segue as regras do python-dotenv, que é quem lê o .env para o app: a última
    definição vence, `export` na frente vale e ` #` fora de aspas é comentário.
    Discordar dele aqui seria conferir uma chave e o app usar outra.
    """
    valores = {}
    for linha in linhas:
        nome = _nome_na_linha(linha)
        if nome is None:
            continue
        valor = linha.split("=", 1)[1].strip()
        if valor[:1] in ("'", '"') and valor.find(valor[0], 1) > 0:
            valor = valor[1:valor.find(valor[0], 1)]
        else:
            valor = re.sub(r"\s+#.*", "", valor).rstrip()
        valores[nome] = valor
    return valores


def _chave_fraca(valor: str | None) -> bool:
    return not valor or valor == CHAVE_DE_EXEMPLO


def _com_chave_nova(linhas: list[str]) -> list[str]:
    """Troca toda definição de IHCHAT_CHAVE_SECRETA por uma só, com chave nova, no lugar da primeira."""
    nova = f"IHCHAT_CHAVE_SECRETA={secrets.token_urlsafe(48)}"
    resultado = []
    for linha in linhas:
        if _nome_na_linha(linha) != "IHCHAT_CHAVE_SECRETA":
            resultado.append(linha)
        elif nova is not None:
            resultado.append(nova)
            nova = None
    if nova is not None:
        resultado.append(nova)
    return resultado


def _com_origens_fechadas(linhas: list[str]) -> list[str]:
    # troca a linha comentada do exemplo em vez de acrescentar outra: com duas
    # definições, descomentar o exemplo depois não teria efeito (a última vence)
    fechada = [
        "# Vazio: só as páginas do próprio IHchat. Exemplo: [\"https://www.seusite.com.br\"]",
        "IHCHAT_ORIGENS_PERMITIDAS=[]",
    ]
    if any(_nome_na_linha(linha) == "IHCHAT_ORIGENS_PERMITIDAS" for linha in linhas):
        return linhas
    for indice, linha in enumerate(linhas):
        if linha.lstrip("# ").startswith("IHCHAT_ORIGENS_PERMITIDAS="):
            return linhas[:indice] + fechada + linhas[indice + 1:]
    return linhas + fechada


def _gravar_env(linhas: list[str], exclusivo: bool) -> None:
    # 0o600: a chave é segredo
    conteudo = "\n".join(linhas) + "\n"
    if exclusivo:
        # O_EXCL: nunca sobrescreve um .env que apareceu no meio do caminho
        descritor = os.open(ARQUIVO_ENV, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descritor, "w", encoding="utf-8", newline="\n") as arquivo:
            arquivo.write(conteudo)
        return
    # grava ao lado e troca de uma vez: interrompido no meio, o .env antigo fica
    # inteiro; e o arquivo novo nasce 0o600 mesmo que o antigo fosse legível
    # por todos (o `cp .env.example .env` do README)
    provisorio = ARQUIVO_ENV.with_name(".env.gravando")
    try:
        descritor = os.open(provisorio, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descritor, "w", encoding="utf-8", newline="\n") as arquivo:
            arquivo.write(conteudo)
        os.replace(provisorio, ARQUIVO_ENV)
    except OSError as erro:
        raise ErroLancador(
            f"Não consegui regravar {ARQUIVO_ENV} ({erro}).\n"
            "Troque a linha IHCHAT_CHAVE_SECRETA=... por IHCHAT_CHAVE_SECRETA=<um texto longo e aleatório> e rode de novo."
        ) from None


def preparar_env() -> None:
    """Garante um .env com chave secreta só desta instalação.

    Com a chave de exemplo, qualquer um que leia o repositório consegue assinar
    um token de administrador válido. Por isso a chave é conferida também num
    .env que já existia: o README ensina a copiar o .env.example.
    """
    linhas = _ler_env()
    if linhas is None:
        modelo = EXEMPLO_ENV.read_text(encoding="utf-8").splitlines() if EXEMPLO_ENV.exists() else []
        try:
            _gravar_env(_com_origens_fechadas(_com_chave_nova(modelo)), exclusivo=True)
        except FileExistsError:
            # outro processo criou o .env entre a leitura e a gravação: vale o dele
            linhas = _ler_env() or []
        else:
            aviso("Criei o .env com uma chave secreta nova.")
            return

    if _chave_fraca(_interpretar_env(linhas).get("IHCHAT_CHAVE_SECRETA")):
        _gravar_env(_com_chave_nova(linhas), exclusivo=False)
        aviso("O .env estava com a chave secreta de exemplo, que é pública: troquei por uma nova.")


def ambiente_dos_processos() -> dict[str, str]:
    ambiente = dict(os.environ)
    valores = _interpretar_env(_ler_env() or [])

    # o app lê o .env sozinho, mas o seed pega a senha do admin direto do
    # ambiente: sem isto, trocar IHCHAT_SENHA_ADMIN no .env não teria efeito.
    # Vazia conta como ausente: o seed gravaria um administrador sem senha.
    if not ambiente.get("IHCHAT_SENHA_ADMIN"):
        ambiente.pop("IHCHAT_SENHA_ADMIN", None)
        if valores.get("IHCHAT_SENHA_ADMIN"):
            ambiente["IHCHAT_SENHA_ADMIN"] = valores["IHCHAT_SENHA_ADMIN"]

    # variável do sistema vence o .env: vazia ou a de exemplo, ela anularia a
    # chave que o preparar_env acabou de garantir
    if "IHCHAT_CHAVE_SECRETA" in ambiente and _chave_fraca(ambiente["IHCHAT_CHAVE_SECRETA"]):
        del ambiente["IHCHAT_CHAVE_SECRETA"]
        aviso("Ignorei a IHCHAT_CHAVE_SECRETA do ambiente do sistema (vazia ou a de exemplo): vale a do .env.")

    # o padrão do app é CORS "*": qualquer página aberta no navegador do dono
    # chamaria a API local, com o admin de exemplo. Painel, simulador e
    # /widget/demo são da mesma origem e não precisam de CORS; o .env de quem
    # já configurou o widget num site continua valendo.
    if "IHCHAT_ORIGENS_PERMITIDAS" not in ambiente and "IHCHAT_ORIGENS_PERMITIDAS" not in valores:
        ambiente["IHCHAT_ORIGENS_PERMITIDAS"] = "[]"

    # no Windows o Python abre arquivos em cp1252 por padrão, e o .env (com
    # acentos) e as mensagens do app são UTF-8
    ambiente.setdefault("PYTHONUTF8", "1")
    return ambiente


def proteger_dados_antigos() -> None:
    """Fecha para os outros usuários o que um lançador antigo criou antes do umask."""
    if WINDOWS:
        return
    for caminho in (ARQUIVO_LOG, *DADOS_LOCAIS):
        try:
            if caminho.exists():
                os.chmod(caminho, 0o700 if caminho.is_dir() else 0o600)
        except OSError:
            # arquivo de outro usuário: não é nosso para mexer
            pass


def rodar_seed(python: Path, demo: bool, ambiente: dict[str, str]) -> None:
    comando = [str(python), "-m", "scripts.seed"] + (["--demo"] if demo else [])
    aviso("Preparando a base de dados...")
    if subprocess.run(comando, cwd=RAIZ, env=ambiente).returncode != 0:
        raise ErroLancador("A carga inicial da base falhou (mensagens acima).")


def chave_do_webchat(python: Path, ambiente: dict[str, str]) -> str:
    """Com a chave na URL, a página de demonstração já abre com o widget carregado.

    O seed só imprime a chave na primeira carga; das outras vezes o dono não
    teria de onde copiá-la.
    """
    try:
        resultado = subprocess.run(
            [str(python), "-c", CONSULTA_CHAVE_WEBCHAT],
            cwd=RAIZ, env=ambiente, capture_output=True, text=True, timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return resultado.stdout.strip() if resultado.returncode == 0 else ""


# ------------------------------------------------------------------ servidor
def porta_livre(porta: int) -> bool:
    # alguém já atendendo nessa porta (em qualquer endereço) conta como ocupada
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sonda:
        sonda.settimeout(0.5)
        if sonda.connect_ex((HOST, porta)) == 0:
            return False
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as teste:
        if not WINDOWS:
            # igual ao uvicorn: porta em TIME_WAIT de uma execução anterior está
            # livre para ele. No Windows a mesma opção deixaria "roubar" uma
            # porta em uso, então lá fica de fora.
            teste.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            teste.bind((HOST, porta))
        except OSError:
            return False
    return True


def escolher_porta(inicial: int) -> int:
    for porta in range(inicial, min(inicial + PORTAS_A_TENTAR, 65536)):
        if porta_livre(porta):
            if porta != inicial:
                aviso(f"A porta {inicial} está ocupada; vou usar a {porta}.")
            return porta
    raise ErroLancador(f"Nenhuma porta livre entre {inicial} e {inicial + PORTAS_A_TENTAR - 1}. Use --porta.")


def abrir_log() -> tuple[Path, object]:
    try:
        log = open(ARQUIVO_LOG, "wb")
    except OSError:
        # um servidor órfão de outra execução, no Windows, pode estar segurando o arquivo
        alternativo = Path(tempfile.gettempdir()) / f"ihchat-{os.getpid()}.log"
        return alternativo, open(alternativo, "wb")
    if not WINDOWS:
        # o umask só vale para arquivo novo; o de um lançador antigo era 0o644
        try:
            os.chmod(ARQUIVO_LOG, 0o600)
        except OSError:
            pass
    return ARQUIVO_LOG, log


def subir_servidor(python: Path, porta: int, ambiente: dict[str, str], log) -> subprocess.Popen:
    comando = [
        str(python), "-m", "uvicorn", "app.main:app",
        "--host", HOST, "--port", str(porta),
        "--timeout-graceful-shutdown", str(FOLGA_DESLIGAMENTO),
        # o log de acesso grava a URL inteira, e o painel manda o token na
        # query do fluxo SSE e dos anexos: seria um login de administrador
        # válido por horas, em texto puro, no ihchat.log
        "--no-access-log",
    ]
    # cwd = raiz do projeto porque é de lá que o app lê o .env e resolve o
    # caminho relativo do SQLite; o log vai para arquivo para o terminal ficar
    # só com o quadro de endereços, e é dele que sai o motivo de uma falha
    return subprocess.Popen(
        comando, cwd=RAIZ, env=ambiente, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT
    )


def _saude_responde(porta: int) -> bool:
    try:
        with _abridor().open(f"http://{HOST}:{porta}/saude", timeout=2) as resposta:
            return json.loads(resposta.read().decode("utf-8")).get("status") == "ok"
    except (urllib.error.URLError, OSError, ValueError, AttributeError):
        return False


def esperar_saude(processo: subprocess.Popen, porta: int) -> bool:
    limite = time.monotonic() + ESPERA_SUBIDA
    while time.monotonic() < limite:
        if processo.poll() is not None:
            return False
        if _saude_responde(porta):
            return True
        time.sleep(0.3)
    return False


def tentar_login(porta: int, email: str, senha: str) -> bool:
    pedido = urllib.request.Request(
        f"http://{HOST}:{porta}/api/auth/login",
        data=json.dumps({"email": email, "senha": senha}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with _abridor().open(pedido, timeout=15) as resposta:
            return resposta.status == 200
    except (urllib.error.URLError, OSError):
        return False


def logins_que_valem(tentar, senha_admin: str) -> list[tuple[str, str | None, str]]:
    """Confere cada login de exemplo no servidor já no ar: (e-mail, senha ou None, papel).

    O seed não mexe numa base que já existe, então o IHCHAT_SENHA_ADMIN do .env
    só vale na primeira carga; e as duas senhas podem ter sido trocadas depois
    pela API. Mostrar a senha sem conferir fazia o dono acreditar numa troca
    que não aconteceu, com a senha de exemplo ainda valendo.
    """
    logins = []
    for email, senha, papel in LOGINS_EXEMPLO:
        # a do admin: a configurada e, para uma base mais velha que ela, a padrão do seed
        candidatas = [senha] if senha else list(dict.fromkeys([senha_admin, SENHA_ADMIN_PADRAO]))
        logins.append((email, next((c for c in candidatas if tentar(email, c)), None), papel))
    return logins


def fim_do_log(caminho: Path, linhas: int = 30) -> None:
    try:
        conteudo = caminho.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return
    aviso(f"--- últimas linhas de {caminho} ---")
    for linha in conteudo[-linhas:]:
        aviso("  " + linha)
    aviso("---")


def encerrar(processo: subprocess.Popen, ja_avisado: bool) -> None:
    """Para o servidor com calma e, se ele não sair, à força.

    No Ctrl+C o terminal já mandou o sinal para o servidor também; mandar outro
    faria o uvicorn pular o desligamento limpo, então primeiro só esperamos.
    """
    if processo.poll() is not None:
        return
    if ja_avisado:
        try:
            processo.wait(timeout=ESPERA_DESLIGAMENTO)
            return
        except subprocess.TimeoutExpired:
            pass
    processo.terminate()
    try:
        processo.wait(timeout=ESPERA_DESLIGAMENTO)
        return
    except subprocess.TimeoutExpired:
        pass
    if WINDOWS:
        # o python.exe do venv é um lançador que roda o Python de verdade como
        # filho; /T derruba a árvore inteira, não só o lançador
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(processo.pid)], capture_output=True)
    processo.kill()
    processo.wait()


def abrir_navegador(endereco: str) -> None:
    if sys.platform.startswith("linux") and not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        # sem interface gráfica o webbrowser cai num navegador de texto (lynx,
        # w3m) que toma conta deste terminal
        aviso("Sem interface gráfica aqui: abra o endereço do painel no navegador.")
        return
    try:
        aberto = webbrowser.open(endereco)
    except Exception:  # noqa: BLE001 - navegador é conveniência; o servidor segue no ar
        aberto = False
    if not aberto:
        aviso("Não consegui abrir o navegador: abra o endereço do painel manualmente.")


def quadro(porta: int, chave_webchat: str, logins, senha_admin: str, log: Path) -> None:
    base = f"http://{HOST}:{porta}"
    widget = f"{base}/widget/demo" + (f"?chave={chave_webchat}" if chave_webchat else "")
    enderecos = [
        ("Painel do atendente", f"{base}/painel"),
        ("Simulador de clientes", f"{base}/simulador"),
        ("Widget de webchat", widget),
        ("Documentação da API", f"{base}/docs"),
    ]
    mostrados = [(email, senha or SENHA_DESCONHECIDA, papel) for email, senha, papel in logins]

    largura_rotulo = max(len(rotulo) for rotulo, _ in enderecos)
    largura_email = max(len(email) for email, _, _ in mostrados)
    largura_senha = max(len(senha) for _, senha, _ in mostrados)
    linhas = ["IHchat no ar", ""]
    linhas += [f"{rotulo.ljust(largura_rotulo)}   {url}" for rotulo, url in enderecos]
    linhas += ["", "Logins de exemplo:"]
    linhas += [
        f"  {email.ljust(largura_email)} / {senha.ljust(largura_senha)}   ({papel})"
        for email, senha, papel in mostrados
    ]
    linhas += ["", f"Log do servidor: {log}", "", "Ctrl+C para parar."]

    # o caminho do log pode ser enorme; a borda acompanha o resto do quadro
    borda = "=" * min(max(len(linha) for linha in linhas) + 4, LARGURA_MAXIMA_QUADRO)
    aviso()
    aviso(borda)
    for linha in linhas:
        aviso(f"  {linha}" if linha else "")
    aviso(borda)
    aviso()

    senha_valida = dict((email, senha) for email, senha, _ in logins).get(EMAIL_ADMIN)
    if senha_admin != SENHA_ADMIN_PADRAO and senha_valida != senha_admin:
        # quem trocou IHCHAT_SENHA_ADMIN depois da primeira carga acha que a
        # senha mudou; o painel ainda não tem tela de troca, só a API
        aviso("Atenção: o IHCHAT_SENHA_ADMIN do .env não é a senha do administrador desta")
        aviso("base. Ele só vale na primeira carga, quando a base é criada.")
        aviso(f"Para trocar a senha: em {base}/docs, faça o POST /api/auth/login e depois o")
        aviso("PATCH /api/atendentes/{id} com {\"senha\": \"...\"}, pondo \"Bearer <token>\" no")
        aviso("campo authorization.")
        aviso()


# ------------------------------------------------------------------ principal
def _porta(texto: str) -> int:
    try:
        numero = int(texto)
    except ValueError:
        raise argparse.ArgumentTypeError(f"porta inválida: {texto!r}") from None
    if not 1 <= numero <= 65535:
        raise argparse.ArgumentTypeError("a porta vai de 1 a 65535")
    return numero


def ler_argumentos(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepara e sobe o IHchat (ambiente, .env, base de exemplo e servidor)."
    )
    parser.add_argument(
        "--porta", type=_porta, default=PORTA_PADRAO,
        help=f"porta inicial (padrão {PORTA_PADRAO}; se ocupada, usa a próxima livre)",
    )
    parser.add_argument("--sem-navegador", action="store_true", help="não abre o navegador")
    parser.add_argument("--sem-demo", action="store_true", help="não cria as conversas de exemplo")
    return parser.parse_args(argv)


def _ao_receber_sinal(numero, _quadro):
    raise PedidoDeParada(numero)


def instalar_sinais() -> None:
    if WINDOWS:
        return
    for numero in (signal.SIGTERM, signal.SIGHUP):
        # sinal que chegou ignorado (nohup) continua ignorado: tratá-lo aqui
        # derrubaria o servidor justamente quando o terminal fecha, e o
        # uvicorn só herda o "ignorar" se ninguém o trocar antes
        if signal.getsignal(numero) is not signal.SIG_IGN:
            signal.signal(numero, _ao_receber_sinal)


def main(argv: list[str] | None = None) -> int:
    args = ler_argumentos(argv)
    if hasattr(sys.stdout, "reconfigure"):
        # um console que não sabe desenhar um acento não pode derrubar o lançador
        sys.stdout.reconfigure(errors="replace")
    if not WINDOWS:
        # .env, banco, anexos e log guardam segredos (chave, hashes de senha,
        # credenciais dos canais, conversas): numa máquina com mais de um
        # usuário nada disso pode nascer legível pelos outros. Os processos
        # filhos (seed, uvicorn) herdam a máscara.
        os.umask(0o077)
    instalar_sinais()

    processo = None
    trava = None
    try:
        trava = pegar_trava()
        if trava is None:
            return avisar_outra_copia(args.sem_navegador)
        proteger_dados_antigos()
        python = preparar_venv()
        preparar_env()
        ambiente = ambiente_dos_processos()
        rodar_seed(python, not args.sem_demo, ambiente)
        porta = escolher_porta(args.porta)

        caminho_log, log = abrir_log()
        with log:
            processo = subir_servidor(python, porta, ambiente, log)
        aviso(f"Subindo o servidor em http://{HOST}:{porta} ...")
        # consulta enquanto o servidor sobe: o tempo de import se sobrepõe
        chave = chave_do_webchat(python, ambiente)
        if not esperar_saude(processo, porta):
            if processo.poll() is None:
                aviso(f"O servidor não respondeu em {ESPERA_SUBIDA} s.")
                encerrar(processo, ja_avisado=False)
            else:
                aviso(f"O servidor parou durante a subida (código {processo.returncode}).")
            fim_do_log(caminho_log)
            return 1
        escrever_trava(trava, porta)

        senha_admin = ambiente.get("IHCHAT_SENHA_ADMIN") or SENHA_ADMIN_PADRAO
        logins = logins_que_valem(lambda email, senha: tentar_login(porta, email, senha), senha_admin)
        quadro(porta, chave, logins, senha_admin, caminho_log)
        if not args.sem_navegador:
            abrir_navegador(f"http://{HOST}:{porta}/painel")

        # sleep em vez de wait(): no Windows um wait() sem prazo não deixa o
        # Ctrl+C chegar até o processo terminar
        while processo.poll() is None:
            time.sleep(0.5)
        aviso(f"O servidor parou sozinho (código {processo.returncode}).")
        fim_do_log(caminho_log)
        return 1

    except ErroLancador as erro:
        aviso()
        aviso(str(erro))
        return 1
    except KeyboardInterrupt:
        aviso()
        aviso("Parando o IHchat...")
        if processo is not None:
            try:
                encerrar(processo, ja_avisado=True)
            except KeyboardInterrupt:
                # segundo Ctrl+C: o usuário não quer esperar
                processo.kill()
        aviso("Parado.")
        return 0
    except PedidoDeParada:
        aviso("Parando o IHchat...")
        if processo is not None:
            encerrar(processo, ja_avisado=False)
        aviso("Parado.")
        return 0
    finally:
        # um erro que ninguém previu também não pode deixar o servidor órfão,
        # segurando a porta sem janela nenhuma aberta para pará-lo
        if processo is not None and processo.poll() is None:
            encerrar(processo, ja_avisado=False)
        # só depois do servidor parado: soltar antes deixaria uma segunda cópia
        # subir outro servidor enquanto este ainda desliga
        if trava is not None:
            soltar_trava(trava)


if __name__ == "__main__":
    sys.exit(main())

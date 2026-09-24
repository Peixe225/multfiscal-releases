"""Instalador web do PHP (/instalar): código de instalação, instalação, recusa depois.

Só existe no alvo PHP (a VPS com o app Python se inicializa por scripts/seed.py),
então aqui cada teste sobe o SEU php -S, numa pasta sem config.php — o estado
de um servidor recém-enviado para a Hostinger. O roteador de teste faz o que o
public/.htaccess faz no LiteSpeed: /instalar vai para instalar.php, o resto
para o front controller.

    IHCHAT_CONTRATO_ALVO=php ../.venv/bin/python -m pytest contrato/test_instalacao.py -q

Com IHCHAT_CONTRATO_MYSQL="dsn|usuario|senha" (banco descartável, nome com
"teste" ou "contrato"), também instala num MySQL/MariaDB de verdade — num
banco PRÓPRIO, "<nome>_instalador" (criado se o usuário puder), ou no de
IHCHAT_CONTRATO_MYSQL_INSTALACAO. Nunca no da suíte: a instalação começa
esvaziando o banco, e o servidor da sessão (conftest) está usando aquele.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import socket
import stat
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import httpx
import pytest

RAIZ = Path(__file__).resolve().parents[1]  # ihchat/
PHP = os.environ.get("IHCHAT_CONTRATO_PHP", "php")
CODIGO = "codigo-de-instalacao-da-suite-0123456789"
SENHA_FORTE = "Atendimento#2026"

pytestmark = pytest.mark.skipif(
    os.environ.get("IHCHAT_CONTRATO_ALVO", "python").lower() != "php" or bool(os.environ.get("IHCHAT_CONTRATO_URL")),
    reason="o instalador web é só do backend PHP (e precisa subir o próprio servidor)",
)

# o que o public/.htaccess faz no LiteSpeed, para o php -S
ROTEADOR = """<?php
$caminho = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
if ($caminho === '/instalar' || $caminho === '/instalar/' || $caminho === '/instalar.php') {
    require %(publico)s . '/instalar.php';
    return true;
}
return require %(publico)s . '/index.php';
"""


def _porta_livre() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@dataclass
class ServidorNovo:
    url: str
    pasta: Path
    processo: subprocess.Popen

    @property
    def config(self) -> Path:
        return self.pasta / "config.php"

    @property
    def codigo(self) -> Path:
        return self.pasta / "dados" / "instalacao.codigo"

    def criar_codigo(self, codigo: str = CODIGO) -> None:
        self.codigo.parent.mkdir(parents=True, exist_ok=True)
        self.codigo.write_text(codigo + "\n")

    def cliente(self) -> httpx.Client:
        return httpx.Client(base_url=self.url, timeout=30.0, follow_redirects=False)


def subir_sem_config(pasta: Path, publico: Path | None = None) -> ServidorNovo:
    """php -S numa pasta onde o config.php ainda não existe (IHCHAT_CONFIG aponta para lá)."""
    publico = (publico or RAIZ / "php" / "public").resolve()
    pasta.mkdir(parents=True, exist_ok=True)
    roteador = pasta / "roteador.php"
    roteador.write_text(ROTEADOR % {"publico": json.dumps(str(publico))})
    porta = _porta_livre()
    ambiente = {**os.environ, "IHCHAT_CONFIG": str(pasta / "config.php"), "PHP_CLI_SERVER_WORKERS": "2"}
    ambiente.pop("IHCHAT_TESTE_PROVEDOR", None)
    log = (pasta / "servidor.log").open("a")
    processo = subprocess.Popen(
        [PHP, "-S", f"127.0.0.1:{porta}", "-t", str(publico), str(roteador)],
        cwd=RAIZ, env=ambiente, stdout=log, stderr=subprocess.STDOUT,
    )
    url = f"http://127.0.0.1:{porta}"
    fim = time.monotonic() + 20
    while time.monotonic() < fim:
        if processo.poll() is not None:
            raise RuntimeError((pasta / "servidor.log").read_text()[-3000:])
        try:
            httpx.get(f"{url}/instalar", timeout=1.0)
            break
        except httpx.HTTPError:
            time.sleep(0.1)
    return ServidorNovo(url=url, pasta=pasta, processo=processo)


@pytest.fixture
def novo():
    """Um servidor recém-enviado: sem config.php, sem código de instalação."""
    pasta = Path(tempfile.mkdtemp(prefix="ihchat-instalacao-"))
    servidor = subir_sem_config(pasta)
    try:
        yield servidor
    finally:
        servidor.processo.terminate()
        try:
            servidor.processo.wait(timeout=10)
        except subprocess.TimeoutExpired:
            servidor.processo.kill()
        if os.environ.get("IHCHAT_CONTRATO_MANTER") != "1":
            shutil.rmtree(pasta, ignore_errors=True)


def pedido(**extra) -> dict:
    corpo = {
        "codigo": CODIGO,
        "banco_tipo": "sqlite",
        "admin_nome": "Ian Dantas",
        "admin_email": "ian@oprojeto.online",
        "admin_senha": SENHA_FORTE,
        "admin_senha_confirmacao": SENHA_FORTE,
        "url_publica": "https://atendimento.oprojeto.online",
    }
    corpo.update(extra)
    return corpo


# --------------------------------------------------------------------- antes


def test_formulario_sem_config_e_seguro(novo):
    with novo.cliente() as c:
        resposta = c.get("/instalar")
        assert resposta.status_code == 200
        assert resposta.headers["content-type"].startswith("text/html")
        assert 'name="codigo"' in resposta.text and 'name="admin_senha"' in resposta.text
        # página sem script, fora de moldura, fora de cache
        csp = resposta.headers["content-security-policy"]
        assert "default-src 'none'" in csp and "frame-ancestors 'none'" in csp
        assert resposta.headers["x-content-type-options"] == "nosniff"
        assert resposta.headers["cache-control"] == "no-store"
        assert resposta.headers["referrer-policy"] == "no-referrer"
        assert "<script" not in resposta.text.lower()
        # sem o arquivo de código, a página explica como criá-lo
        assert "instalacao.codigo" in resposta.text
        # o resto do sistema ainda não está pronto (e não vaza detalhe)
        eu = c.get("/api/auth/eu")
        assert eu.status_code == 503 and "/instalar" in eu.json()["detail"]
        # quem abre o endereço no navegador cai no instalador
        for caminho in ("/", "/painel"):
            raiz = c.get(caminho)
            assert raiz.status_code in (302, 307) and raiz.headers["location"] == "/instalar", caminho


def test_sem_arquivo_de_codigo_nada_instala(novo):
    with novo.cliente() as c:
        resposta = c.post("/instalar", json=pedido())
    assert resposta.status_code == 403
    assert "instalacao.codigo" in resposta.json()["detail"]
    assert not novo.config.exists()


def test_codigo_curto_no_servidor_vale_como_ausente(novo):
    novo.criar_codigo("curto")
    with novo.cliente() as c:
        resposta = c.post("/instalar", json=pedido(codigo="curto"))
    assert resposta.status_code == 403
    assert "bloqueada" in resposta.json()["detail"]
    assert not novo.config.exists()


def test_codigo_errado_e_recusado_sem_criar_nada(novo):
    novo.criar_codigo()
    with novo.cliente() as c:
        resposta = c.post("/instalar", json=pedido(codigo="outro-codigo-qualquer-0000000"))
        assert resposta.status_code == 403
        assert resposta.json() == {"detail": "código de instalação inválido"}
        # o código errado é conferido ANTES de validar o resto: um estranho
        # não descobre nada sobre o formulário nem sobre o banco
        vazio = c.post("/instalar", json={"codigo": "x" * 20})
        assert vazio.status_code == 403
    assert not novo.config.exists()
    assert not (novo.pasta / "dados" / "ihchat.sqlite").exists()
    assert novo.codigo.exists()


def test_muitas_tentativas_bloqueiam_ate_o_codigo_certo(novo):
    novo.criar_codigo()
    with novo.cliente() as c:
        for _ in range(10):
            assert c.post("/instalar", json=pedido(codigo="chute-errado-000000000000")).status_code == 403
        resposta = c.post("/instalar", json=pedido())
    assert resposta.status_code == 429
    assert int(resposta.headers["retry-after"]) > 0
    assert not novo.config.exists()


def test_senha_fraca_e_dados_invalidos_dao_422_com_todos_os_problemas(novo):
    novo.criar_codigo()
    with novo.cliente() as c:
        resposta = c.post(
            "/instalar",
            json=pedido(admin_senha="abc", admin_senha_confirmacao="abc", admin_email="nao-e-email",
                        banco_tipo="mysql", banco_host="127.0.0.1;dbname=outro", url_publica="ftp://x"),
        )
        assert resposta.status_code == 422
        erros = resposta.json()["detail"]
        campos = {e["loc"][-1] for e in erros}
        assert {"admin_senha", "admin_email", "banco_host", "banco_nome", "banco_usuario", "url_publica"} <= campos
        # senha nunca volta na resposta
        assert "abc" not in json.dumps([e for e in erros if "senha" in e["loc"][-1]])

        fraca = c.post("/instalar", json=pedido(admin_senha="aaaaaaaaaaaa", admin_senha_confirmacao="aaaaaaaaaaaa"))
        assert fraca.status_code == 422
        diferente = c.post("/instalar", json=pedido(admin_senha_confirmacao="Outra#Senha2026"))
        assert diferente.status_code == 422
        assert diferente.json()["detail"][0]["loc"][-1] == "admin_senha_confirmacao"
    assert not novo.config.exists()
    assert novo.codigo.exists()


def test_banco_inacessivel_explica_e_nao_grava_config(novo):
    novo.criar_codigo()
    with novo.cliente() as c:
        resposta = c.post(
            "/instalar",
            json=pedido(banco_tipo="mysql", banco_host="127.0.0.1", banco_porta=1, banco_nome="nao_existe",
                        banco_usuario="ninguem", banco_senha="SenhaDoBanco-123"),
        )
    assert resposta.status_code == 400
    detalhe = resposta.json()["detail"]
    assert detalhe.startswith("não foi possível conectar ao banco de dados")
    assert "SenhaDoBanco-123" not in detalhe
    assert not novo.config.exists()
    assert not list(novo.pasta.glob(".config-*"))  # temporário descartado
    assert novo.codigo.exists()


def test_senha_acima_de_72_bytes_e_recusada_e_72_vale_inteira(novo):
    """O bcrypt só usa os primeiros 72 bytes: acima disso a regra olharia uma
    senha e o login conferiria outra (bastaria o começo para entrar)."""
    novo.criar_codigo()
    enchimento = "a" * 72 + "Bc1#x"  # passaria na regra antiga; a senha efetiva seria "a" x 72
    acentos = "é" * 36 + "Ab1#"  # 40 caracteres, 76 bytes
    with novo.cliente() as c:
        for senha in (enchimento, acentos):
            resposta = c.post("/instalar", json=pedido(admin_senha=senha, admin_senha_confirmacao=senha))
            assert resposta.status_code == 422, resposta.text
            erro = [e for e in resposta.json()["detail"] if e["loc"][-1] == "admin_senha"]
            assert erro and "72 bytes" in erro[0]["msg"]
            assert senha not in resposta.text
        assert not novo.config.exists()

        # exatamente 72 bytes: vale, e vale INTEIRA (o último caractere conta)
        senha = "Atendimento#2026-" + "x7Kq" * 13 + "Zw!"
        assert len(senha.encode()) == 72
        instalacao = c.post("/instalar", json=pedido(admin_senha=senha, admin_senha_confirmacao=senha))
        assert instalacao.status_code == 201, instalacao.text
        assert c.post("/api/auth/login", json={"email": "ian@oprojeto.online", "senha": senha}).status_code == 200
        assert c.post("/api/auth/login", json={"email": "ian@oprojeto.online", "senha": senha[:-1] + "?"}).status_code == 401


@pytest.mark.parametrize("controle", ["\u0000", "\n", "\t", "\u007f"])
def test_senha_com_caractere_de_controle_da_422_e_nao_500(novo, controle):
    """O password_hash lança ValueError com o byte nulo; antes virava 500."""
    novo.criar_codigo()
    senha = f"Senha{controle}Forte#2026"
    with novo.cliente() as c:
        resposta = c.post("/instalar", json=pedido(admin_senha=senha, admin_senha_confirmacao=senha))
        assert resposta.status_code == 422, resposta.text
        erro = [e for e in resposta.json()["detail"] if e["loc"][-1] == "admin_senha"]
        assert erro and "controle" in erro[0]["msg"]
        # o formulário HTML (que manda %00) explica em vez de "erro interno"
        pagina = c.post("/instalar", data=pedido(admin_senha=senha, admin_senha_confirmacao=senha))
        assert pagina.status_code == 422
        assert "caracteres de controle" in pagina.text and "erro interno" not in pagina.text
        assert not novo.config.exists()
        assert novo.codigo.exists()
        # nada ficou pela metade: a instalação certa passa em seguida
        assert c.post("/instalar", json=pedido()).status_code == 201


# ------------------------------------------------------------ a instalação


def test_instalacao_completa_e_segunda_instalacao_recusada(novo):
    novo.criar_codigo()
    with novo.cliente() as c:
        resposta = c.post("/instalar", json=pedido())
        assert resposta.status_code == 201, resposta.text
        dados = resposta.json()
        assert dados["instalado"] is True
        assert dados["url_painel"] == "https://atendimento.oprojeto.online/painel"
        assert dados["admin"] == {"nome": "Ian Dantas", "email": "ian@oprojeto.online"}
        assert dados["exemplos"] is False
        assert dados["chave_webchat"].startswith("wc_")

        # config.php: fora do public, só o dono lê, chave aleatória de 64 hex
        assert novo.config.exists()
        assert stat.S_IMODE(novo.config.stat().st_mode) == 0o600
        texto = novo.config.read_text()
        assert re.search(r"'chave_secreta' => '[0-9a-f]{64}'", texto)
        assert "'modo_sandbox' => false" in texto
        assert "__DIR__ . '/dados'" in texto
        assert SENHA_FORTE not in texto
        # o código some; nenhum temporário fica para trás
        assert not novo.codigo.exists()
        assert not list(novo.pasta.glob(".config-*"))

        # o sistema funciona: /saude, login do admin informado
        assert c.get("/saude").json()["status"] == "ok"
        login = c.post("/api/auth/login", json={"email": "ian@oprojeto.online", "senha": SENHA_FORTE})
        assert login.status_code == 200, login.text
        assert login.json()["atendente"]["papel"] == "admin"
        cabecalho = {"Authorization": f"Bearer {login.json()['token']}"}
        # sem usuário de demonstração
        assert c.post("/api/auth/login", json={"email": "ana@multfiscal.com.br", "senha": "ana12345"}).status_code == 401
        assert c.post("/api/auth/login", json={"email": "admin@multfiscal.com.br", "senha": "admin123"}).status_code == 401
        equipe = c.get("/api/atendentes", headers=cabecalho)
        if equipe.status_code == 200:
            assert [a["email"] for a in equipe.json()] == ["ian@oprojeto.online"]
        # o canal de chat do site já existe, com a chave informada
        canais = c.get("/api/canais", headers=cabecalho)
        if canais.status_code == 200:
            webchat = [k for k in canais.json() if k["tipo"] == "webchat"]
            assert [k["chave_publica"] for k in webchat] == [dados["chave_webchat"]]
            assert webchat[0]["url_webhook"].startswith("https://atendimento.oprojeto.online/")

        # instalado: /instalar some, mesmo com um código novo no disco
        novo.criar_codigo()
        assert c.get("/instalar").status_code == 404
        assert c.get("/instalar.php").status_code == 404
        segunda = c.post("/instalar", json=pedido(admin_email="intruso@exemplo.com.br"))
        assert segunda.status_code == 404
        assert segunda.json() == {"detail": "Not Found"}
    assert "intruso" not in novo.config.read_text()


def test_instalacao_pelo_formulario_html(novo):
    novo.criar_codigo()
    formulario = {**pedido(), "exemplos": "1"}
    with novo.cliente() as c:
        # erro no formulário: a página volta com a mensagem e SEM as senhas
        ruim = c.post("/instalar", data={**formulario, "admin_senha_confirmacao": "diferente"})
        assert ruim.status_code == 422
        assert ruim.headers["content-type"].startswith("text/html")
        assert "não confere" in ruim.text
        assert SENHA_FORTE not in ruim.text and CODIGO not in ruim.text
        assert 'value="ian@oprojeto.online"' in ruim.text

        resposta = c.post("/instalar", data=formulario)
        assert resposta.status_code == 200, resposta.text
        assert "Instalação concluída" in resposta.text
        assert "data-chave=&quot;wc_" in resposta.text  # trecho do widget, escapado
        # os avisos da tela de conclusão: Ana desativada, canais de exemplo desativados
        assert "desativada" in resposta.text and "ana12345" in resposta.text
        assert "App Secret" in resposta.text
        conferir_exemplos_desativados(c, "ian@oprojeto.online")
        assert c.post("/api/auth/login", json={"email": "admin@multfiscal.com.br", "senha": SENHA_FORTE}).status_code == 401


def conferir_exemplos_desativados(c: httpx.Client, email_admin: str) -> None:
    """Com exemplos: a base é a de produção, então nada de porta aberta.

    A Ana existe (as conversas de exemplo são dela), mas desativada e com
    senha aleatória: a do Seed (ana12345) é pública. Os canais de exemplo que
    recebem webhook ficam desativados: sem App Secret, o WhatsApp aceitaria um
    POST anônimo em /webhooks/<id> e qualquer um injetaria "clientes" falsos.
    """
    login = c.post("/api/auth/login", json={"email": email_admin, "senha": SENHA_FORTE})
    assert login.status_code == 200, login.text
    cabecalho = {"Authorization": f"Bearer {login.json()['token']}"}
    assert c.post("/api/auth/login", json={"email": "ana@multfiscal.com.br", "senha": "ana12345"}).status_code == 401
    equipe = {a["email"]: a for a in c.get("/api/atendentes", headers=cabecalho).json()}
    assert equipe["ana@multfiscal.com.br"]["ativo"] is False
    assert equipe["ana@multfiscal.com.br"]["disponivel"] is False
    assert equipe[email_admin]["papel"] == "admin" and equipe[email_admin]["ativo"] is True

    canais = {k["tipo"]: k for k in c.get("/api/canais", headers=cabecalho).json()}
    assert {t: k["ativo"] for t, k in canais.items()} == {
        "whatsapp": False, "telegram": False, "email": False, "webchat": True,
    }
    # o ataque do achado: payload da Meta, sem assinatura, no id previsível
    forjado = {"object": "whatsapp_business_account", "entry": [{"id": "1", "changes": [{"field": "messages", "value": {
        "messaging_product": "whatsapp", "metadata": {"display_phone_number": "5511900000000", "phone_number_id": "1"},
        "contacts": [{"profile": {"name": "Banco Oficial"}, "wa_id": "5511999990000"}],
        "messages": [{"from": "5511999990000", "id": "wamid.forjado-1", "timestamp": "1790000000", "type": "text",
                      "text": {"body": "Seu pagamento falhou, informe a senha do painel"}}],
    }}]}]}
    resposta = c.post(f"/webhooks/{canais['whatsapp']['id']}", json=forjado)
    assert resposta.status_code in (401, 404, 409), resposta.text
    conversas = c.get("/api/conversas", headers=cabecalho).json()
    assert "Banco Oficial" not in json.dumps(conversas, ensure_ascii=False)


def test_banco_ja_usado_nao_e_sobrescrito(novo):
    novo.criar_codigo()
    with novo.cliente() as c:
        assert c.post("/instalar", json=pedido()).status_code == 201
        # perdeu o config.php, mas o banco (dados/ihchat.sqlite) continua lá
        novo.config.unlink()
        novo.criar_codigo()
        resposta = c.post("/instalar", json=pedido(admin_email="outro@oprojeto.online"))
    assert resposta.status_code == 409
    assert "já tem atendentes" in resposta.json()["detail"]
    assert not novo.config.exists()
    assert novo.codigo.exists()


def test_metodo_errado_no_instalador(novo):
    with novo.cliente() as c:
        assert c.delete("/instalar").status_code == 405


def _partes_do_dsn(dsn: str) -> dict[str, str]:
    return dict(p.split("=", 1) for p in dsn.split(":", 1)[1].split(";") if "=" in p)


def banco_mysql_do_instalador() -> tuple[str, str, str]:
    """(dsn, usuario, senha) de um banco só deste teste, que ele pode esvaziar.

    O IHCHAT_CONTRATO_MYSQL é o banco do servidor da sessão: esvaziá-lo no meio
    da suíte derrubava todos os testes seguintes (métricas, simulador,
    webhooks, widget). Sem IHCHAT_CONTRATO_MYSQL_INSTALACAO, cria
    "<nome>_instalador" com o mesmo usuário; sem permissão para isso, pula.
    """
    proprio = os.environ.get("IHCHAT_CONTRATO_MYSQL_INSTALACAO")
    if proprio:
        dsn, usuario, senha = (proprio.split("|") + ["", ""])[:3]
        if proprio.split("|")[0] == os.environ.get("IHCHAT_CONTRATO_MYSQL", "").split("|")[0]:
            pytest.skip("IHCHAT_CONTRATO_MYSQL_INSTALACAO não pode ser o banco da suíte")
        return dsn, usuario, senha
    dsn, usuario, senha = (os.environ["IHCHAT_CONTRATO_MYSQL"].split("|") + ["", ""])[:3]
    partes = _partes_do_dsn(dsn)
    nome = partes["dbname"] + "_instalador"
    servidor = f"mysql:host={partes.get('host', '127.0.0.1')};port={partes.get('port', '3306')}"
    criar = (
        "$pdo = new PDO($argv[1], $argv[2], $argv[3], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);"
        "$pdo->exec('CREATE DATABASE IF NOT EXISTS `' . $argv[4] . '` CHARACTER SET utf8mb4');"
    )
    resultado = subprocess.run([PHP, "-r", criar, servidor, usuario, senha, nome], capture_output=True, text=True)
    if resultado.returncode != 0:
        pytest.skip(f"sem permissão para criar {nome}; defina IHCHAT_CONTRATO_MYSQL_INSTALACAO (banco só deste teste)")
    return f"{servidor};dbname={nome}", usuario, senha


@pytest.mark.skipif(
    not (os.environ.get("IHCHAT_CONTRATO_MYSQL") or os.environ.get("IHCHAT_CONTRATO_MYSQL_INSTALACAO")),
    reason="defina IHCHAT_CONTRATO_MYSQL (ou IHCHAT_CONTRATO_MYSQL_INSTALACAO) para instalar num MySQL",
)
@pytest.mark.parametrize("exemplos", [False, True])
def test_instalacao_em_mysql(novo, exemplos):
    dsn, usuario, senha = banco_mysql_do_instalador()
    partes = _partes_do_dsn(dsn)
    nome = partes["dbname"]
    assert "teste" in nome or "contrato" in nome, "use um banco descartável"
    limpar = (
        "$pdo = new PDO($argv[1], $argv[2], $argv[3], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);"
        "$pdo->exec('SET FOREIGN_KEY_CHECKS = 0');"
        "foreach ($pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $t) { $pdo->exec(\"DROP TABLE `$t`\"); }"
    )
    subprocess.run([PHP, "-r", limpar, dsn, usuario, senha], check=True)
    novo.criar_codigo()
    with novo.cliente() as c:
        resposta = c.post(
            "/instalar",
            json=pedido(banco_tipo="mysql", banco_host=partes.get("host", "127.0.0.1"),
                        banco_porta=int(partes.get("port", 3306)), banco_nome=nome, banco_usuario=usuario,
                        banco_senha=senha, exemplos=exemplos),
        )
        assert resposta.status_code == 201, resposta.text
        assert resposta.json()["banco"] == "mysql"
        assert resposta.json()["exemplos"] is exemplos
        # a Ana do Seed (ana12345, senha pública) nunca entra: sem exemplos ela
        # nem existe; com exemplos, fica desativada e com senha aleatória
        ana = c.post("/api/auth/login", json={"email": "ana@multfiscal.com.br", "senha": "ana12345"})
        assert ana.status_code == 401
        texto = novo.config.read_text()
        assert "'driver' => 'mysql'" in texto
        assert c.post("/api/auth/login", json={"email": "ian@oprojeto.online", "senha": SENHA_FORTE}).status_code == 200
        if exemplos:
            conferir_exemplos_desativados(c, "ian@oprojeto.online")
        assert c.get("/instalar").status_code == 404

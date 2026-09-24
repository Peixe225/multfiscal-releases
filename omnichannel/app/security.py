"""Hash de senha e token de sessao dos atendentes, sem dependencias externas."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from datetime import timedelta

from .config import obter_config
from .models import agora

ITERACOES = 200_000


def gerar_hash_senha(senha: str) -> str:
    sal = secrets.token_hex(16)
    derivada = hashlib.pbkdf2_hmac("sha256", senha.encode(), sal.encode(), ITERACOES)
    return f"pbkdf2_sha256${ITERACOES}${sal}${derivada.hex()}"


# prefixos do bcrypt: "$2y$" é o que o password_hash do PHP grava
_PREFIXOS_BCRYPT = ("$2y$", "$2b$", "$2a$")


def conferir_senha(senha: str, armazenado: str) -> bool:
    """Confere a senha contra o hash gravado, no formato deste app ou do PHP.

    A base da hospedagem (PHP, password_hash = bcrypt "$2y$") migra para a VPS
    sem ninguém redefinir senha: os dois formatos valem nos dois servidores.
    """
    armazenado = armazenado or ""
    if armazenado.startswith(_PREFIXOS_BCRYPT):
        return _conferir_bcrypt(senha, armazenado)
    try:
        algoritmo, iteracoes, sal, esperado = armazenado.split("$")
    except ValueError:
        return False
    if algoritmo != "pbkdf2_sha256":
        return False
    derivada = hashlib.pbkdf2_hmac("sha256", senha.encode(), sal.encode(), int(iteracoes))
    return hmac.compare_digest(derivada.hex(), esperado)


def _conferir_bcrypt(senha: str, armazenado: str) -> bool:
    import bcrypt  # só quem migrou uma base do PHP precisa dele

    # o bcrypt do PHP só olha os 72 primeiros bytes da senha; o pacote bcrypt
    # (5.x) recusa com erro o que passa disso. Cortar aqui dá o mesmo
    # resultado que o password_verify daria.
    dados = senha.encode()[:72]
    if b"\x00" in dados:
        return False  # o PHP também não aceita NUL na senha
    try:
        # "$2y$" e "$2b$" são o mesmo algoritmo; o pacote só conhece o "$2b$"
        return bcrypt.checkpw(dados, ("$2b$" + armazenado[4:]).encode())
    except ValueError:
        return False  # hash corrompido


def _b64(dados: bytes) -> str:
    return base64.urlsafe_b64encode(dados).decode().rstrip("=")


def _desb64(texto: str) -> bytes:
    return base64.urlsafe_b64decode(texto + "=" * (-len(texto) % 4))


def criar_token(atendente_id: int) -> str:
    config = obter_config()
    expira = agora() + timedelta(hours=config.horas_token)
    corpo = _b64(json.dumps({"sub": atendente_id, "exp": expira.timestamp()}).encode())
    assinatura = hmac.new(config.chave_secreta.encode(), corpo.encode(), hashlib.sha256).digest()
    return f"{corpo}.{_b64(assinatura)}"


def ler_token(token: str) -> int | None:
    """Devolve o id do atendente, ou None se o token for invalido/expirado."""
    config = obter_config()
    try:
        corpo, assinatura = token.split(".")
        esperada = hmac.new(config.chave_secreta.encode(), corpo.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(_desb64(assinatura), esperada):
            return None
        dados = json.loads(_desb64(corpo))
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
    if agora().timestamp() > float(dados.get("exp", 0)):
        return None
    return int(dados["sub"])


def assinatura_valida(segredo: str, corpo: bytes, cabecalho: str | None) -> bool:
    """Valida a assinatura HMAC-SHA256 dos webhooks (formato da Meta)."""
    if not cabecalho:
        return False
    recebida = cabecalho.split("=", 1)[-1].strip()
    esperada = hmac.new(segredo.encode(), corpo, hashlib.sha256).hexdigest()
    return hmac.compare_digest(recebida, esperada)


def gerar_chave(prefixo: str = "") -> str:
    return f"{prefixo}{secrets.token_urlsafe(24)}"

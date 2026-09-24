"""Utilitários da suíte de contrato (importe nos testes: `from utilitarios import ...`)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import httpx
import pytest

# credenciais da base criada pelo seed (scripts/seed.py e php/app/Instalacao/Seed.php)
ADMIN_EMAIL = "admin@multfiscal.com.br"
ADMIN_SENHA = "admin123"
ATENDENTE_EMAIL = "ana@multfiscal.com.br"
ATENDENTE_SENHA = "ana12345"

# chave dos servidores que o conftest sobe (testes de token forjado dependem dela)
CHAVE_SECRETA = "chave-da-suite-de-contrato-0123456789abcdef"

# campos que TODO atendente tem na saída da API (AtendenteSaida)
CAMPOS_ATENDENTE = {"id", "nome", "email", "papel", "ativo", "disponivel", "setor"}


@dataclass
class Servidor:
    url: str
    alvo: str  # "python" | "php"
    chave_secreta: str | None  # None quando o servidor é externo
    provedor: "ProvedorFalso | None"
    pasta: Path


class ProvedorFalso:
    """Respostas roteiradas para as chamadas que o servidor faria a Meta, Telegram...

    O servidor lê o arquivo a cada chamada; nada sai para a rede. Formato:

        {"respostas": [
            {"metodo": "POST", "url_contem": "graph.facebook.com",
             "status": 200, "json": {...}}          # ou "corpo" / "corpo_base64"
            {"url_contem": "api.telegram.org", "erro_rede": "timeout"}
        ]}

    A primeira regra que casar responde (metodo e url_contem são opcionais).
    Sem regra: 404 {"erro": "sem resposta roteirada ..."}. Cada chamada feita
    fica em "<arquivo>.chamadas.jsonl": {"metodo", "url", "cabecalhos"
    (minúsculas), "corpo" (texto ou null), "corpo_base64"}.
    """

    def __init__(self, arquivo: Path):
        self.arquivo = Path(arquivo)
        self.registro = Path(f"{self.arquivo}.chamadas.jsonl")
        self._respostas: list[dict] = []

    def limpar(self) -> None:
        self._respostas = []
        self._gravar()
        self.registro.unlink(missing_ok=True)

    def roteirar(
        self,
        url_contem: str | None = None,
        *,
        metodo: str | None = None,
        status: int = 200,
        json: object = None,
        corpo: str | None = None,
        corpo_bytes: bytes | None = None,
        cabecalhos: dict | None = None,
        erro_rede: str | None = None,
    ) -> None:
        regra: dict = {"status": status}
        if url_contem is not None:
            regra["url_contem"] = url_contem
        if metodo is not None:
            regra["metodo"] = metodo
        if json is not None:
            regra["json"] = json
        if corpo is not None:
            regra["corpo"] = corpo
        if corpo_bytes is not None:
            regra["corpo_base64"] = base64.b64encode(corpo_bytes).decode()
        if cabecalhos:
            regra["cabecalhos"] = cabecalhos
        if erro_rede is not None:
            regra["erro_rede"] = erro_rede
        self._respostas.append(regra)
        self._gravar()

    def chamadas(self) -> list[dict]:
        if not self.registro.exists():
            return []
        return [json.loads(linha) for linha in self.registro.read_text().splitlines() if linha.strip()]

    def _gravar(self) -> None:
        temporario = self.arquivo.with_suffix(".tmp")
        temporario.write_text(json.dumps({"respostas": self._respostas}, ensure_ascii=False))
        temporario.replace(self.arquivo)  # atômico: o servidor nunca lê metade


def unico(prefixo: str = "") -> str:
    """Texto único por teste (a base é compartilhada pela sessão inteira)."""
    return f"{prefixo}{uuid.uuid4().hex[:10]}"


def estrito() -> bool:
    return os.environ.get("IHCHAT_CONTRATO_ESTRITO") == "1"


def exigir_rota(resposta: httpx.Response, descricao: str) -> httpx.Response:
    """Pula o teste se a rota de que ele DEPENDE ainda não existe no alvo.

    Durante o porte, cada frente entrega suas rotas em momentos diferentes;
    com IHCHAT_CONTRATO_ESTRITO=1 a ausência vira falha (validação final).
    """
    ausente = resposta.status_code in (404, 405) and resposta.headers.get("content-type", "").startswith(
        "application/json"
    ) and resposta.json().get("detail") in ("Not Found", "Method Not Allowed")
    if ausente and not estrito():
        pytest.skip(f"rota ainda não implementada neste alvo: {descricao}")
    return resposta


def entrar(cliente: httpx.Client, email: str, senha: str) -> dict:
    resposta = cliente.post("/api/auth/login", json={"email": email, "senha": senha})
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


def criar_canal(cliente: httpx.Client, cabecalho_admin: dict, tipo: str, nome: str | None = None, **extra) -> dict:
    """Cria um canal pela API (POST /api/canais) e devolve o CanalSaida."""
    corpo = {"nome": nome or unico(f"Canal {tipo} "), "tipo": tipo, **extra}
    resposta = exigir_rota(cliente.post("/api/canais", json=corpo, headers=cabecalho_admin), "POST /api/canais")
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


def _b64(dados: bytes) -> str:
    return base64.urlsafe_b64encode(dados).decode().rstrip("=")


def token_forjado(chave: str, atendente_id: int, expira_em: float | None = None) -> str:
    """Token no formato de app/security.py, assinado aqui (fora do servidor).

    Prova que o formato é o mesmo nos dois lados: um token feito com a chave
    certa vale no Python e no PHP.
    """
    expira = time.time() + 3600 if expira_em is None else expira_em
    corpo = _b64(json.dumps({"sub": atendente_id, "exp": expira}).encode())
    assinatura = hmac.new(chave.encode(), corpo.encode(), hashlib.sha256).digest()
    return f"{corpo}.{_b64(assinatura)}"


def data_com_fuso(texto: str) -> datetime:
    """Confere que a data da API é ISO 8601 COM fuso e a devolve."""
    valor = datetime.fromisoformat(texto.replace("Z", "+00:00"))
    assert valor.tzinfo is not None, f"data sem fuso: {texto}"
    assert valor.utcoffset().total_seconds() == 0, f"data fora de UTC: {texto}"
    return valor

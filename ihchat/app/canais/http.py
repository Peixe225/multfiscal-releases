"""Cliente HTTP compartilhado pelos adaptadores.

O transporte pode ser trocado nos testes, evitando qualquer chamada de rede.

Suíte de contrato: com o modo sandbox ligado e IHCHAT_TESTE_PROVEDOR apontando
um arquivo JSON, as chamadas vão para um provedor FALSO roteirado, no mesmo
formato e com o mesmo registro ".chamadas.jsonl" do PHP
(php/app/Nucleo/Http/TransporteRoteirado.php). É o que deixa os testes de
WhatsApp, Telegram e anexos rodarem iguais nos dois servidores.
"""
from __future__ import annotations

import base64
import contextlib
import fcntl
import json
import logging
import os
import re
from typing import Iterator

import httpx

from ..config import obter_config

_transporte: httpx.BaseTransport | None = None


def definir_transporte(transporte: httpx.BaseTransport | None) -> None:
    global _transporte
    _transporte = transporte


class TransporteRoteirado(httpx.BaseTransport):
    """Responde pelo roteiro do arquivo e registra cada chamada; nada sai para a rede.

    Formato do arquivo (relido a cada chamada, para o teste trocar o roteiro
    no meio da sessão):

        {"respostas": [
            {"metodo": "POST", "url_contem": "graph.facebook.com",
             "status": 200, "json": {...}}          # ou "corpo" / "corpo_base64"
            {"url_contem": "api.telegram.org", "erro_rede": "timeout"}
        ]}

    A primeira regra que casar responde. Sem regra: 404 {"erro": "sem resposta
    roteirada para <METODO> <url>"}.
    """

    def __init__(self, arquivo: str):
        self.arquivo = arquivo

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        corpo = request.read()
        metodo = request.method.upper()
        url = str(request.url)
        self._registrar(request, metodo, url, corpo)
        for regra in self._roteiro():
            if not isinstance(regra, dict):
                continue
            if "metodo" in regra and str(regra["metodo"]).upper() != metodo:
                continue
            if "url_contem" in regra and str(regra["url_contem"]) not in url:
                continue
            if "erro_rede" in regra:
                # o adaptador trata falha de rede como ConnectError/Timeout do httpx
                raise httpx.ConnectError(str(regra["erro_rede"]), request=request)
            cabecalhos = {str(k): str(v) for k, v in (regra.get("cabecalhos") or {}).items()}
            if "json" in regra:
                conteudo = json.dumps(regra["json"], ensure_ascii=False).encode()
                if not any(k.lower() == "content-type" for k in cabecalhos):
                    cabecalhos["Content-Type"] = "application/json"
            elif "corpo_base64" in regra:
                conteudo = base64.b64decode(str(regra["corpo_base64"]))
            else:
                conteudo = str(regra.get("corpo") or "").encode()
            return httpx.Response(int(regra.get("status", 200)), headers=cabecalhos, content=conteudo, request=request)
        return httpx.Response(
            404, json={"erro": f"sem resposta roteirada para {metodo} {url}"}, request=request
        )

    def _roteiro(self) -> list:
        try:
            with open(self.arquivo, encoding="utf-8") as arquivo:
                dados = json.load(arquivo)
        except (OSError, ValueError):
            return []
        respostas = dados.get("respostas") if isinstance(dados, dict) else None
        return respostas if isinstance(respostas, list) else []

    def _registrar(self, request: httpx.Request, metodo: str, url: str, corpo: bytes) -> None:
        try:
            texto: str | None = corpo.decode("utf-8")
        except UnicodeDecodeError:
            texto = None
        linha = json.dumps(
            {
                "metodo": metodo,
                "url": url,
                "cabecalhos": {k.lower(): v for k, v in request.headers.items()},
                "corpo": texto,
                "corpo_base64": base64.b64encode(corpo).decode(),
            },
            ensure_ascii=False,
        )
        # trava como o LOCK_EX do PHP: dois workers não intercalam linhas
        with open(f"{self.arquivo}.chamadas.jsonl", "a", encoding="utf-8") as registro:
            fcntl.flock(registro, fcntl.LOCK_EX)
            try:
                registro.write(linha + "\n")
            finally:
                fcntl.flock(registro, fcntl.LOCK_UN)


def _transporte_do_ambiente() -> httpx.BaseTransport | None:
    """O provedor falso, só em teste: fora do sandbox a variável é ignorada.

    Assim um ambiente de produção mal configurado nunca "finge" que enviou.
    """
    roteiro = os.environ.get("IHCHAT_TESTE_PROVEDOR", "").strip()
    if roteiro and obter_config().modo_sandbox:
        return TransporteRoteirado(roteiro)
    return None


def usa_provedor_falso() -> bool:
    """As chamadas vão para um transporte trocado (teste), não para a rede."""
    return _transporte is not None or _transporte_do_ambiente() is not None


# ------------------------------------------------------ segredos fora do log
# O httpx registra cada requisição em INFO com a URL inteira, e a Z-API põe o
# token da instância no caminho (/instances/{id}/token/{token}/...): com o
# diálogo do QR consultando a cada 3 s, o token iria para o log do servidor
# milhares de vezes, e quem o lê poderia mandar mensagens como o número. O
# log de acesso do uvicorn (quando ligado) grava "POST /webhooks/5?token=..."
# a cada entrega, e esse token forja mensagens de clientes. O PHP não
# registra URLs. (O token do bot do Telegram tem o filtro dele em telegram.py.)
_SEGREDOS_NA_URL = (
    (re.compile(r"/token/[^/\s\"?#]+"), "/token/<oculto>"),
    (re.compile(r"([?&](?:token|apikey|api_key)=)[^&\s\"#]+", re.IGNORECASE), r"\1<oculto>"),
)


def sem_segredos_na_url(texto: str) -> str:
    for padrao, troca in _SEGREDOS_NA_URL:
        texto = padrao.sub(troca, texto)
    return texto


class FiltroSegredosNaUrl(logging.Filter):
    def filter(self, registro: logging.LogRecord) -> bool:
        try:
            texto = registro.getMessage()
        except Exception:  # registro malformado: deixa o logging reclamar dele
            return True
        limpo = sem_segredos_na_url(texto)
        if limpo != texto:
            registro.msg, registro.args = limpo, None
        return True


_FILTRO_DE_SEGREDOS = FiltroSegredosNaUrl()
for _nome in ("httpx", "uvicorn.access"):
    logging.getLogger(_nome).addFilter(_FILTRO_DE_SEGREDOS)


@contextlib.contextmanager
def cliente() -> Iterator[httpx.Client]:
    transporte = _transporte if _transporte is not None else _transporte_do_ambiente()
    with httpx.Client(timeout=obter_config().timeout_http, transport=transporte) as c:
        yield c

"""Onde os arquivos das conversas ficam guardados.

O acesso é sempre pela API (`/api/anexos/{id}`), nunca por caminho estático:
é assim que a permissão do atendente e a sessão do visitante continuam valendo
para o arquivo, e não só para a mensagem.
"""
from __future__ import annotations

import mimetypes
import re
import unicodedata
import uuid
from abc import ABC, abstractmethod
from pathlib import Path

from .config import obter_config

TIPO_PADRAO = "application/octet-stream"
# tipos que o painel e o widget exibem embutidos; o resto vira link de download
TIPOS_IMAGEM = {"image/png", "image/jpeg", "image/gif", "image/webp"}


class ErroArmazenamento(Exception):
    pass


def nome_seguro(nome: str) -> str:
    """Remove acentos, caminhos e caracteres que não deveriam virar arquivo."""
    nome = Path(nome or "arquivo").name
    nome = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode()
    nome = re.sub(r"[^A-Za-z0-9._-]+", "_", nome).strip("._-")
    return nome[:120] or "arquivo"


def adivinhar_tipo(nome: str, informado: str | None = None) -> str:
    if informado and "/" in informado:
        return informado.split(";")[0].strip().lower()
    return (mimetypes.guess_type(nome)[0] or TIPO_PADRAO).lower()


class Armazenamento(ABC):
    @abstractmethod
    def salvar(self, dados: bytes, nome: str) -> str:
        """Grava e devolve a chave usada para recuperar depois."""

    @abstractmethod
    def ler(self, chave: str) -> bytes: ...

    @abstractmethod
    def remover(self, chave: str) -> None: ...


class ArmazenamentoLocal(Armazenamento):
    """Disco local. Simples de operar e suficiente para uma instalação só.

    A chave é gerada aqui (uuid + nome higienizado) e nunca vem do usuário,
    então não há como um nome de arquivo escapar da pasta.
    """

    def __init__(self, pasta: str | Path | None = None):
        self.pasta = Path(pasta or obter_config().pasta_anexos)
        self.pasta.mkdir(parents=True, exist_ok=True)

    def _caminho(self, chave: str) -> Path:
        alvo = (self.pasta / chave).resolve()
        if not str(alvo).startswith(str(self.pasta.resolve())):
            raise ErroArmazenamento("chave de anexo inválida")
        return alvo

    def salvar(self, dados: bytes, nome: str) -> str:
        chave = f"{uuid.uuid4().hex}-{nome_seguro(nome)}"
        self._caminho(chave).write_bytes(dados)
        return chave

    def ler(self, chave: str) -> bytes:
        caminho = self._caminho(chave)
        if not caminho.is_file():
            raise ErroArmazenamento("arquivo não encontrado")
        return caminho.read_bytes()

    def remover(self, chave: str) -> None:
        self._caminho(chave).unlink(missing_ok=True)


_armazenamento: Armazenamento | None = None


def armazenamento() -> Armazenamento:
    global _armazenamento
    if _armazenamento is None:
        _armazenamento = ArmazenamentoLocal()
    return _armazenamento


def definir_armazenamento(novo: Armazenamento | None) -> None:
    """Usado nos testes para não escrever na pasta real."""
    global _armazenamento
    _armazenamento = novo

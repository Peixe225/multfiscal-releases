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
from urllib.parse import quote

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
    """O tipo informado (navegador, provedor) ou o da extensão — CRU, sem
    filtro. Para gravar, use tipo_seguro(): o informado vem de fora (o
    remetente de um e-mail escolhe "text/xsl" e o Chromium o executaria)."""
    if informado and "/" in informado:
        return informado.split(";")[0].strip().lower()
    return (mimetypes.guess_type(nome)[0] or TIPO_PADRAO).lower()


# ------------------------------------------------------------ tipos seguros
# Mesmas regras de php/app/Atendimento/Anexos.php e php/app/Anexos/Rotas.php.
#
# Tipos que podem ficar gravados como estão: o navegador mostra ou baixa, mas
# nunca executa script. Qualquer outro vira application/octet-stream — ou, se
# for de família executável (HTML, XML, XSL, SVG, JS), o tipo canônico dessa
# família, que a entrega sempre serve como download isolado.
TIPOS_SEGUROS = frozenset({
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/tiff", "image/heic",
    "image/vnd.microsoft.icon", "image/x-icon",
    "application/pdf", "text/plain", "text/csv", "application/json", "application/rtf", "application/x-ofx",
    "application/zip", "application/gzip", "application/x-gzip", "application/vnd.rar", "application/x-rar",
    "application/x-7z-compressed", "application/x-tar",
    "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.spreadsheet",
    TIPO_PADRAO,
})
PREFIXOS_SEGUROS = ("audio/", "video/")
# famílias que o navegador EXECUTA se abrir como documento
_EXECUTAVEL = re.compile(r"html|xml|xsl|svg|javascript|ecmascript", re.IGNORECASE)

# Os ÚNICOS tipos servidos inline (com o próprio Content-Type): imagens que o
# painel mostra, PDF e texto puro, mais áudio e vídeo. Nenhum roda script.
# Todo o resto sai como download, application/octet-stream e CSP sandbox: uma
# lista negra (html|xml|svg...) deixava passar text/xsl, que o Chromium abre
# como documento XML e em que executa o script de um elemento XHTML, na origem
# do painel, com o ?token= do atendente na URL.
TIPOS_INLINE = frozenset({"image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain"})
_ATIVO = re.compile(r"html|xml|xsl|svg|javascript|ecmascript|script|x-shockwave|x-msdownload", re.IGNORECASE)

# assinaturas binárias que bastam para dizer o tipo
_ASSINATURAS = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"%PDF-", "application/pdf"),
    (b"PK\x03\x04", "application/zip"),
    (b"\x1f\x8b", "application/gzip"),
    (b"OggS", "audio/ogg"),
    (b"ID3", "audio/mpeg"),
)


def _base(tipo: str | None) -> str:
    return (tipo or "").split(";")[0].strip().lower()


def seguro(tipo: str) -> bool:
    tipo = _base(tipo)
    return tipo in TIPOS_SEGUROS or tipo.startswith(PREFIXOS_SEGUROS)


def executavel(tipo: str) -> bool:
    """Fora da lista segura e com cara de HTML/XML/SVG/JS ("openxmlformats" é seguro)."""
    return not seguro(tipo) and bool(_EXECUTAVEL.search(_base(tipo)))


def _neutralizar(tipo: str) -> str:
    """O canônico da família: sempre servido como download isolado."""
    tipo = _base(tipo)
    if "svg" in tipo:
        return "image/svg+xml"
    if "html" in tipo:
        return "text/html"
    if "javascript" in tipo or "ecmascript" in tipo:
        return "text/javascript"
    return "application/xml"


def detectar_tipo(dados: bytes | None) -> str | None:
    """O tipo pelos BYTES (o equivalente enxuto do fileinfo do PHP).

    Só o que importa para a segurança e para a exibição: as imagens e
    documentos comuns pela assinatura, e texto que o navegador interpretaria
    como página (HTML, SVG, XML/XSL). Texto comum vira text/plain; binário
    desconhecido, None (quem chama decide pelo informado).
    """
    if not dados:
        return None
    for inicio, tipo in _ASSINATURAS:
        if dados.startswith(inicio):
            return tipo
    if len(dados) >= 12 and dados[:4] == b"RIFF" and dados[8:12] == b"WEBP":
        return "image/webp"
    if len(dados) >= 12 and dados[4:8] == b"ftyp":
        return "video/mp4"
    amostra = dados[:4096]
    if b"\x00" in amostra:
        return None
    try:
        texto = amostra.decode("utf-8")
    except UnicodeDecodeError:
        try:
            texto = amostra.decode("latin-1")
        except UnicodeDecodeError:  # pragma: no cover - latin-1 decodifica tudo
            return None
    inicio = texto.lstrip("\ufeff \t\r\n").lower()
    if inicio.startswith(("<!doctype html", "<html", "<head", "<body", "<script", "<iframe")) or "<script" in inicio[:1024]:
        return "text/html"
    if inicio.startswith("<svg") or (inicio.startswith("<") and "<svg" in inicio[:1024]):
        return "image/svg+xml"
    if inicio.startswith("<"):
        return "application/xml"
    return "text/plain"


def tipo_seguro(nome: str, informado: str | None, dados: bytes | None = None) -> str:
    """O tipo que fica gravado: confere o anunciado com os BYTES e só deixa
    passar os TIPOS_SEGUROS.

    - bytes ou anúncio de família executável: o tipo canônico da família
      (servido só como download isolado);
    - anúncio seguro: fica o anunciado (imagem, PDF, planilha...);
    - anúncio desconhecido: o detectado, se for seguro;
    - o resto: application/octet-stream.
    """
    anunciado = adivinhar_tipo(nome, informado)
    if anunciado == TIPO_PADRAO:
        anunciado = adivinhar_tipo(nome)  # "octet-stream" não diz nada: vale a extensão
    detectado = detectar_tipo(dados)
    if detectado is not None and executavel(detectado):
        return _neutralizar(detectado)
    if executavel(anunciado):
        return _neutralizar(anunciado)
    if seguro(anunciado) and anunciado != TIPO_PADRAO:
        return anunciado
    if detectado is not None and seguro(detectado):
        return detectado
    return TIPO_PADRAO


def exibivel(tipo: str | None) -> bool:
    """Pode abrir no navegador com o próprio tipo (TIPOS_INLINE, áudio, vídeo)?"""
    tipo = _base(tipo)
    if tipo in TIPOS_INLINE:
        return True
    return tipo.startswith(PREFIXOS_SEGUROS) and not _ATIVO.search(tipo)


def disposicao(modo: str, nome: str) -> str:
    """Content-Disposition com o nome em UTF-8 (RFC 5987) e um reserva ASCII.

    Aspas ou quebra de linha no nome não escapam do cabeçalho, e um nome com
    acento não derruba a resposta (o cabeçalho HTTP é latin-1).
    """
    ascii_ = re.sub(r"[^A-Za-z0-9._ -]", "_", nome or "") or "arquivo"
    return f"{modo}; filename=\"{ascii_}\"; filename*=UTF-8''{quote(nome or 'arquivo', safe='')}"


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

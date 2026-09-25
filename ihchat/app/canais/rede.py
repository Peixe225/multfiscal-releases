"""Download de mídia por URL que veio de fora (webhook), sem abrir a rede interna.

A URL da mídia chega na entrega do provedor, e quem tiver o token do webhook
pode forjar uma entrega com "http://169.254.169.254/..." ou
"http://127.0.0.1:3306/": o IHchat buscaria o endereço interno e guardaria a
resposta como anexo, que qualquer atendente baixa. Por isso:

  - o host é resolvido AQUI e todo endereço precisa ser público (nada de
    loopback, rede privada, link-local, reservado ou multicast);
  - a conexão vai ao IP conferido (com o nome no Host e no SNI do TLS): um DNS
    que responda outra coisa na segunda consulta não muda o destino;
  - o corpo é lido aos pedaços e o download para ao passar do limite de
    anexos, em vez de pôr um arquivo gigante inteiro na memória;
  - redirecionamento não é seguido (o cliente HTTP já não segue).

Com o provedor falso dos testes (sandbox + IHCHAT_TESTE_PROVEDOR) nada sai
para a rede: um host de teste que não resolve passa, mas IP interno e
"localhost" continuam barrados. Mesmo comportamento do PHP em
php/app/Canais/WhatsAppQr/RedeExterna.php.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit, urlunsplit

import httpx

from .base import ErroCanal
from .http import cliente, usa_provedor_falso


def endereco_publico(ip: str) -> bool:
    """IP que a internet alcança (o IPv4 dentro de "::ffff:a.b.c.d" também conta)."""
    try:
        endereco = ipaddress.ip_address(ip.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(endereco, ipaddress.IPv6Address) and endereco.ipv4_mapped is not None:
        endereco = endereco.ipv4_mapped
    return endereco.is_global and not endereco.is_multicast


def _resolver(host: str, porta: int) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, porta, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError):
        return []
    return list(dict.fromkeys(info[4][0] for info in infos))


def destino_conferido(url: str) -> tuple[str, str, int, str | None]:
    """(url, host, porta, ip a usar) — ou ErroCanal se o destino não é público.

    ip None = não precisa fixar (provedor falso, host de teste que não resolve).
    """
    partes = urlsplit(url)
    esquema = partes.scheme.lower()
    host = (partes.hostname or "").rstrip(".")
    if esquema not in ("http", "https") or not host:
        raise ErroCanal("endereço de mídia inválido")
    try:
        porta = partes.port or (443 if esquema == "https" else 80)
    except ValueError as exc:
        raise ErroCanal("endereço de mídia inválido") from exc
    falso = usa_provedor_falso()
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    enderecos = [str(literal)] if literal is not None else _resolver(host, porta)
    if not enderecos:
        if falso:
            return url, host, porta, None  # host de teste: o provedor falso responde
        raise ErroCanal("não foi possível localizar o servidor da mídia")
    if not all(endereco_publico(ip) for ip in enderecos):
        raise ErroCanal("endereço de mídia recusado: aponta para a rede interna")
    return url, host, porta, None if falso else enderecos[0]


def baixar_publico(url: str, limite: int, cabecalhos: dict | None = None) -> bytes:
    """GET da URL (só endereço público), até `limite` bytes."""
    url, host, porta, ip = destino_conferido(url)
    pedido_url = url
    extensoes: dict = {}
    cabecalhos = dict(cabecalhos or {})
    if ip is not None:
        partes = urlsplit(url)
        padrao = 443 if partes.scheme.lower() == "https" else 80
        no_ip = f"[{ip}]" if ":" in ip else ip
        pedido_url = urlunsplit((partes.scheme, f"{no_ip}:{porta}", partes.path or "/", partes.query, ""))
        cabecalhos["Host"] = host if porta == padrao else f"{host}:{porta}"
        if partes.scheme.lower() == "https":
            extensoes["sni_hostname"] = host  # o certificado é conferido contra o nome
    megas = max(1, limite // (1024 * 1024))
    with cliente() as http:
        try:
            with http.stream("GET", pedido_url, headers=cabecalhos, extensions=extensoes) as resposta:
                if resposta.status_code >= 400:
                    raise ErroCanal(f"download da mídia falhou ({resposta.status_code})")
                declarado = resposta.headers.get("content-length", "")
                if declarado.isdigit() and int(declarado) > limite:
                    raise ErroCanal(f"a mídia passa do limite de {megas} MB")
                partes_lidas: list[bytes] = []
                total = 0
                for pedaco in resposta.iter_bytes():
                    total += len(pedaco)
                    if total > limite:
                        raise ErroCanal(f"a mídia passa do limite de {megas} MB")
                    partes_lidas.append(pedaco)
                return b"".join(partes_lidas)
        except httpx.HTTPError as exc:
            raise ErroCanal(f"falha de rede ao baixar a mídia: {exc}") from exc

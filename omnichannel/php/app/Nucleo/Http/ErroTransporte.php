<?php
declare(strict_types=1);

namespace OmniChannel\Nucleo\Http;

/** Falha de rede ao falar com um provedor (o httpx.TransportError do Python). */
final class ErroTransporte extends \RuntimeException
{
}

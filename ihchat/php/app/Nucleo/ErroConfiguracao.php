<?php
declare(strict_types=1);

namespace IHchat\Nucleo;

/** Configuração ausente ou insegura: o servidor responde 503 sem detalhes internos. */
final class ErroConfiguracao extends \RuntimeException
{
}

<?php
declare(strict_types=1);

namespace OmniChannel\Canais\Email;

/** O servidor SMTP respondeu com um código de erro (ex.: 535 no login). */
final class ErroSmtp extends \RuntimeException
{
    public function __construct(public readonly int $codigo, public readonly string $texto)
    {
        parent::__construct(trim(($codigo > 0 ? $codigo . ' ' : '') . $texto));
    }
}

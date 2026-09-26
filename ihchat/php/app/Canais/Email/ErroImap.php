<?php
declare(strict_types=1);

namespace IHchat\Canais\Email;

/** O servidor IMAP respondeu NO/BAD (ex.: senha recusada no LOGIN). */
final class ErroImap extends \RuntimeException
{
}

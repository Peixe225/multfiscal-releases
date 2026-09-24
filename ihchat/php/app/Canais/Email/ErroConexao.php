<?php
declare(strict_types=1);

namespace IHchat\Canais\Email;

/**
 * Falha de rede ou de TLS com o servidor de e-mail.
 *
 * `certificado` separa o caso em que o servidor apresentou um certificado
 * inválido: a mensagem para o admin é outra (a senha nem foi enviada).
 */
final class ErroConexao extends \RuntimeException
{
    public function __construct(string $mensagem, public readonly bool $certificado = false, public readonly string $motivoCertificado = '')
    {
        parent::__construct($mensagem);
    }
}

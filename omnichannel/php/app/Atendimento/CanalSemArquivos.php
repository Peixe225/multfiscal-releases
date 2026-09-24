<?php
declare(strict_types=1);

namespace OmniChannel\Atendimento;

/** O canal da conversa não transporta arquivos (as rotas respondem 409 com a mensagem). */
final class CanalSemArquivos extends \RuntimeException
{
}

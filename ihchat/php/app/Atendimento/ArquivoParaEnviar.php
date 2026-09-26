<?php
declare(strict_types=1);

namespace IHchat\Atendimento;

/** Arquivo que o atendente manda ao contato (ArquivoParaEnviar de app/canais/base.py). */
final class ArquivoParaEnviar
{
    public function __construct(
        public readonly string $nome,
        public readonly string $tipo_conteudo,
        public readonly string $dados,
    ) {
    }
}

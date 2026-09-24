<?php
declare(strict_types=1);

namespace OmniChannel\Nucleo;

/**
 * 422 no formato da validação do FastAPI:
 * {"detail": [{"type": "...", "loc": ["body", "campo"], "msg": "...", "input": ...}]}
 *
 * O painel junta os "msg" com "; " e mostra ao usuário, por isso as mensagens
 * são frases em português prontas para a tela.
 */
final class ErroValidacao extends ErroHttp
{
    /** @param list<array{type: string, loc: list<string|int>, msg: string, input?: mixed}> $erros */
    public function __construct(public readonly array $erros)
    {
        parent::__construct(422, $erros);
    }

    /** @param list<string|int> $loc */
    public static function um(string $tipo, array $loc, string $msg, mixed $entrada = null): self
    {
        $erro = ['type' => $tipo, 'loc' => $loc, 'msg' => $msg];
        if ($entrada !== null) {
            $erro['input'] = $entrada;
        }
        return new self([$erro]);
    }
}

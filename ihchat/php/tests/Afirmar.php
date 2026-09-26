<?php
declare(strict_types=1);

/** Afirmações mínimas para os testes de unidade (sem PHPUnit na hospedagem). */
final class Afirmar
{
    public static function igual(mixed $esperado, mixed $obtido, string $contexto = ''): void
    {
        if ($esperado !== $obtido) {
            throw new RuntimeException(sprintf(
                '%sesperado %s, obtido %s',
                $contexto !== '' ? "{$contexto}: " : '',
                var_export($esperado, true),
                var_export($obtido, true)
            ));
        }
    }

    public static function verdade(bool $condicao, string $mensagem = 'condição falsa'): void
    {
        if (!$condicao) {
            throw new RuntimeException($mensagem);
        }
    }

    /** @param callable(): mixed $acao */
    public static function lanca(string $classe, callable $acao, ?callable $conferir = null): void
    {
        try {
            $acao();
        } catch (Throwable $erro) {
            if (!$erro instanceof $classe) {
                throw new RuntimeException('esperava ' . $classe . ', veio ' . get_class($erro) . ': ' . $erro->getMessage());
            }
            if ($conferir !== null) {
                $conferir($erro);
            }
            return;
        }
        throw new RuntimeException("esperava {$classe}, nada foi lançado");
    }
}

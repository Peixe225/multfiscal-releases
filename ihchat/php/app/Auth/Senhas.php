<?php
declare(strict_types=1);

namespace IHchat\Auth;

/**
 * Hash de senha.
 *
 * Novas senhas: password_hash (bcrypt hoje; o PHP escolhe o melhor padrão).
 * Também confere o formato do Python, "pbkdf2_sha256$<iter>$<sal>$<hex>",
 * para que uma base vinda do app Python funcione aqui sem pedir senha nova.
 */
final class Senhas
{
    public static function gerarHash(#[\SensitiveParameter] string $senha): string
    {
        return password_hash($senha, PASSWORD_DEFAULT);
    }

    public static function conferir(#[\SensitiveParameter] string $senha, string $armazenado): bool
    {
        if (str_starts_with($armazenado, 'pbkdf2_sha256$')) {
            return self::conferirPbkdf2($senha, $armazenado);
        }
        return password_verify($senha, $armazenado);
    }

    /**
     * Gasta o mesmo tempo de uma conferência real. Usado quando o e-mail não
     * existe: sem isto, a demora da resposta revelaria quem tem conta.
     */
    public static function conferirFalso(#[\SensitiveParameter] string $senha): void
    {
        static $modelo = null;
        $modelo ??= password_hash('senha-que-nao-existe', PASSWORD_DEFAULT);
        password_verify($senha, $modelo);
    }

    private static function conferirPbkdf2(string $senha, string $armazenado): bool
    {
        $partes = explode('$', $armazenado);
        if (count($partes) !== 4) {
            return false;
        }
        [, $iteracoes, $sal, $esperado] = $partes;
        if (!ctype_digit($iteracoes) || (int) $iteracoes < 1 || (int) $iteracoes > 5_000_000) {
            return false;
        }
        // o Python usa o texto do sal (hex) como bytes do sal, não o sal decodificado
        $derivada = hash_pbkdf2('sha256', $senha, $sal, (int) $iteracoes, 0, false);
        return hash_equals($esperado, $derivada);
    }
}

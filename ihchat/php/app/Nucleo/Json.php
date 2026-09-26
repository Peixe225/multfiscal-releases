<?php
declare(strict_types=1);

namespace IHchat\Nucleo;

/**
 * JSON com as mesmas escolhas do FastAPI: UTF-8 cru (sem ç), barras sem
 * escape e 1.0 continua 1.0.
 *
 * Armadilha do PHP: array vazio vira [] mesmo quando o contrato diz objeto
 * ({} em credenciais, metadados, por_canal). Use Json::objeto() nesses campos.
 */
final class Json
{
    private const OPCOES = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION
        | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR;

    public static function codificar(mixed $valor): string
    {
        return json_encode($valor, self::OPCOES);
    }

    /**
     * Decodifica para arrays associativos. Lança \JsonException se inválido.
     */
    public static function decodificar(string $texto): mixed
    {
        return json_decode($texto, true, 512, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
    }

    /** Decodifica sem lançar: devolve $padrao se vazio ou inválido (colunas JSON do banco). */
    public static function ler(?string $texto, mixed $padrao = []): mixed
    {
        if ($texto === null || $texto === '') {
            return $padrao;
        }
        try {
            return self::decodificar($texto);
        } catch (\JsonException) {
            return $padrao;
        }
    }

    /**
     * Garante que o valor sai como objeto JSON ({}), mesmo vazio.
     *
     * @param array<string, mixed>|null $valor
     */
    public static function objeto(?array $valor): object
    {
        return (object) ($valor ?? []);
    }
}

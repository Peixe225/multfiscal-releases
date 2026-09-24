<?php
declare(strict_types=1);

namespace OmniChannel\Nucleo;

/** Utilidades pequenas de texto, as mesmas de app/util.py e app/security.py. */
final class Texto
{
    /** Resume numa linha só, cortando com reticências (prévia da conversa). */
    public static function resumir(?string $texto, int $limite = 160): string
    {
        $texto = trim((string) preg_replace('/\s+/u', ' ', (string) $texto));
        if (mb_strlen($texto) <= $limite) {
            return $texto;
        }
        return mb_substr($texto, 0, $limite - 1) . '…';
    }

    /** Só dígitos: é assim que o WhatsApp identifica o contato. */
    public static function normalizarTelefone(?string $numero): string
    {
        return (string) preg_replace('/\D/', '', (string) $numero);
    }

    /**
     * Chave aleatória com prefixo, igual a gerar_chave() do Python
     * (secrets.token_urlsafe(24): 32 caracteres base64url).
     */
    public static function gerarChave(string $prefixo = ''): string
    {
        return $prefixo . self::base64Url(random_bytes(24));
    }

    public static function base64Url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    /** Decodifica base64url com ou sem "="; null se não for base64 válido. */
    public static function deBase64Url(string $texto): ?string
    {
        if (preg_match('/^[A-Za-z0-9_-]*={0,2}$/', $texto) !== 1) {
            return null;
        }
        $texto = rtrim($texto, '=');
        $resto = strlen($texto) % 4;
        if ($resto === 1) {
            return null;
        }
        $bytes = base64_decode(strtr($texto, '-_', '+/') . str_repeat('=', (4 - $resto) % 4), true);
        return $bytes === false ? null : $bytes;
    }
}

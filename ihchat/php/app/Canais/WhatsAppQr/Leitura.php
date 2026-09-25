<?php
declare(strict_types=1);

namespace IHchat\Canais\WhatsAppQr;

use IHchat\Nucleo\Texto;

/**
 * Leitura defensiva das entregas dos provedores (app/canais/whatsapp_qr.py).
 *
 * A entrega vem de fora: qualquer campo pode ter o tipo errado, e um 500 faz
 * o provedor reenviar sem parar.
 */
final class Leitura
{
    /** O que vai como imagem ou vídeo; o resto segue como documento, com o nome. */
    public const TIPOS_DE_IMAGEM = ['image/jpeg', 'image/png'];
    public const TIPOS_DE_VIDEO = ['video/mp4', 'video/3gpp'];

    /** @return array<string, mixed> */
    public static function objeto(mixed $valor): array
    {
        return is_array($valor) && ($valor === [] || !array_is_list($valor)) ? $valor : [];
    }

    /** @return list<array<string, mixed>> */
    public static function lista(mixed $valor): array
    {
        if (!is_array($valor) || !array_is_list($valor)) {
            return [];
        }
        return array_values(array_filter($valor, static fn (mixed $v): bool => is_array($v) && ($v === [] || !array_is_list($v))));
    }

    public static function texto(mixed $valor): ?string
    {
        if (is_string($valor)) {
            return $valor === '' ? null : $valor;
        }
        if (is_int($valor) || is_float($valor)) {
            return (string) $valor;
        }
        return null;
    }

    public static function verdade(mixed $valor): bool
    {
        return $valor === true || (is_string($valor) && strtolower($valor) === 'true');
    }

    /** Número como o Python o escreveria (None quando ausente; 23.0 fica 23.0). */
    public static function numero(mixed $valor): string
    {
        if ($valor === null || is_bool($valor)) {
            return 'None';
        }
        if (is_float($valor)) {
            $texto = (string) $valor;
            return str_contains($texto, '.') || str_contains($texto, 'E') || str_contains($texto, 'e') ? $texto : $texto . '.0';
        }
        return is_scalar($valor) ? (string) $valor : 'None';
    }

    public static function mimeLimpo(?string $tipo): string
    {
        return strtolower(trim(explode(';', (string) $tipo)[0]));
    }

    public static function extensao(?string $tipo, string $padrao = 'bin'): string
    {
        $mime = self::mimeLimpo($tipo);
        if (!str_contains($mime, '/')) {
            return $padrao;
        }
        $fim = substr($mime, strrpos($mime, '/') + 1);
        return $fim === '' ? $padrao : $fim;
    }

    public static function especieDeEnvio(string $tipoConteudo): string
    {
        $mime = self::mimeLimpo($tipoConteudo);
        if (in_array($mime, self::TIPOS_DE_IMAGEM, true)) {
            return 'image';
        }
        return in_array($mime, self::TIPOS_DE_VIDEO, true) ? 'video' : 'document';
    }

    /**
     * O número (só dígitos) de "5511...", "5511...@s.whatsapp.net" ou
     * "5511...@c.us". Um "@lid" (id oculto do WhatsApp, sem telefone) fica
     * inteiro: é para ele que a resposta volta.
     */
    public static function identificadorDoContato(?string $valor): ?string
    {
        $bruto = trim((string) $valor);
        if ($bruto === '') {
            return null;
        }
        if (str_contains($bruto, '@')) {
            [$usuario, $servidor] = explode('@', $bruto, 2);
            if ($servidor === 'lid') {
                return $usuario === '' ? null : $bruto;
            }
            $bruto = explode(':', $usuario)[0];
        }
        $digitos = Texto::normalizarTelefone($bruto);
        return $digitos === '' ? null : $digitos;
    }

    /** Grupo, lista de transmissão, status e canal (newsletter) ficam de fora. */
    public static function eConversaPrivada(?string $jid): bool
    {
        $valor = strtolower(trim((string) $jid));
        if ($valor === '') {
            return false;
        }
        return !(str_ends_with($valor, '@g.us') || str_ends_with($valor, '-group') || str_ends_with($valor, '@broadcast')
            || str_ends_with($valor, '@newsletter') || $valor === 'status@broadcast');
    }

    /** Só baixa de http(s): nenhuma outra URL chega ao cliente HTTP. */
    public static function urlDeMidia(mixed $valor): ?string
    {
        $endereco = self::texto($valor);
        if ($endereco === null) {
            return null;
        }
        $esquema = strtolower((string) parse_url($endereco, PHP_URL_SCHEME));
        return in_array($esquema, ['http', 'https'], true) ? $endereco : null;
    }

    /** "data:image/png;base64,..." (o provedor às vezes manda só o base64). */
    public static function qrComoImagem(?string $valor): ?string
    {
        if ($valor === null || $valor === '') {
            return null;
        }
        return str_starts_with($valor, 'data:image/') ? $valor : 'data:image/png;base64,' . $valor;
    }

    public static function base64OuNada(mixed $valor): ?string
    {
        $bruto = self::texto($valor);
        if ($bruto === null) {
            return null;
        }
        if (str_starts_with($bruto, 'data:') && str_contains($bruto, ',')) {
            $bruto = substr($bruto, strpos($bruto, ',') + 1);
        }
        $bytes = base64_decode((string) preg_replace('/\s+/', '', $bruto), true);
        return $bytes === false ? null : $bytes;
    }
}

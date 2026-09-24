<?php
declare(strict_types=1);

namespace OmniChannel\Auth;

use OmniChannel\Nucleo\Config;
use OmniChannel\Nucleo\Datas;
use OmniChannel\Nucleo\Texto;

/**
 * Token de sessão do atendente, no MESMO formato de app/security.py:
 *
 *   base64url(json {"sub": <id>, "exp": <timestamp float>}) + "." +
 *   base64url(HMAC-SHA256(chave_secreta, parte1))       (sem "=")
 *
 * Com a mesma chave_secreta, um token emitido pelo PHP vale no Python e
 * vice-versa: a troca de servidor (hospedagem -> VPS) não desloga ninguém.
 */
final class Token
{
    public static function criar(int $atendenteId, ?Config $config = null): string
    {
        $config ??= Config::obter();
        $expira = (float) Datas::agora()->format('U.u') + $config->horas_token * 3600;
        // mesmo texto que json.dumps produz no Python (com espaço após ":" e ",")
        $json = sprintf('{"sub": %d, "exp": %s}', $atendenteId, self::numero($expira));
        $corpo = Texto::base64Url($json);
        $assinatura = hash_hmac('sha256', $corpo, $config->chave_secreta, true);
        return $corpo . '.' . Texto::base64Url($assinatura);
    }

    /** Id do atendente, ou null se o token for inválido, adulterado ou vencido. */
    public static function ler(string $token, ?Config $config = null): ?int
    {
        $config ??= Config::obter();
        $partes = explode('.', $token);
        if (count($partes) !== 2) {
            return null;
        }
        [$corpo, $assinatura] = $partes;
        $recebida = Texto::deBase64Url($assinatura);
        if ($recebida === null) {
            return null;
        }
        $esperada = hash_hmac('sha256', $corpo, $config->chave_secreta, true);
        // tempo constante: comparar com === vazaria a assinatura byte a byte
        if (!hash_equals($esperada, $recebida)) {
            return null;
        }
        $json = Texto::deBase64Url($corpo);
        if ($json === null) {
            return null;
        }
        $dados = json_decode($json, true);
        if (!is_array($dados) || !isset($dados['sub']) || !is_numeric($dados['sub'])) {
            return null;
        }
        $expira = $dados['exp'] ?? 0;
        if (!is_numeric($expira) || (float) Datas::agora()->format('U.u') > (float) $expira) {
            return null;
        }
        return (int) $dados['sub'];
    }

    /** Float como o repr() do Python: sempre com parte decimal. */
    private static function numero(float $valor): string
    {
        $texto = json_encode($valor, JSON_PRESERVE_ZERO_FRACTION);
        return is_string($texto) ? $texto : sprintf('%.6F', $valor);
    }
}

<?php
declare(strict_types=1);

namespace IHchat\Canais\WhatsAppQr;

use IHchat\Canais\ErroCanal;
use IHchat\Nucleo\Config;
use IHchat\Nucleo\Http\Cliente;
use IHchat\Nucleo\Http\ErroTransporte;
use IHchat\Nucleo\Http\TransporteCurl;

/**
 * Download de mídia por URL que veio de fora (webhook), sem abrir a rede
 * interna (app/canais/rede.py).
 *
 * A URL da mídia chega na entrega do provedor, e quem tiver o token do
 * webhook pode forjar uma entrega com "http://169.254.169.254/..." ou
 * "http://127.0.0.1:3306/": o IHchat buscaria o endereço interno e guardaria
 * a resposta como anexo, que qualquer atendente baixa. Por isso:
 *
 *  - o host é resolvido AQUI e todo endereço precisa ser público (nada de
 *    loopback, rede privada, link-local, reservado ou multicast);
 *  - o curl conecta no IP conferido (CURLOPT_RESOLVE), com o nome no Host e no
 *    TLS: um DNS que responda outra coisa na segunda consulta não muda o destino;
 *  - o corpo é lido aos pedaços e o download para ao passar do limite de
 *    anexos, em vez de pôr um arquivo gigante inteiro na memória;
 *  - redirecionamento não é seguido.
 *
 * Com o transporte falso dos testes nada sai para a rede: um host de teste que
 * não resolve passa, mas IP interno e "localhost" continuam barrados.
 */
final class RedeExterna
{
    /** IP que a internet alcança (o IPv4 dentro de "::ffff:a.b.c.d" também conta). */
    public static function enderecoPublico(string $ip): bool
    {
        $ip = explode('%', $ip, 2)[0];
        $binario = @inet_pton($ip);
        if ($binario === false) {
            return false;
        }
        if (strlen($binario) === 16 && str_starts_with($binario, str_repeat("\0", 10) . "\xff\xff")) {
            $ip = (string) inet_ntop(substr($binario, 12)); // IPv4 mapeado em IPv6
            $binario = substr($binario, 12);
        }
        if (strlen($binario) === 16 && ord($binario[0]) === 0xff) {
            return false; // multicast IPv6
        }
        if (strlen($binario) === 4 && ord($binario[0]) >= 224) {
            return false; // multicast e reservado IPv4
        }
        $filtros = defined('FILTER_FLAG_GLOBAL_RANGE')
            ? FILTER_FLAG_GLOBAL_RANGE
            : FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE;
        if (filter_var($ip, FILTER_VALIDATE_IP, $filtros | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
            return false;
        }
        // o que o filtro do PHP 8.1 deixa passar e o is_global do Python não
        if (strlen($binario) === 4) {
            $n = unpack('N', $binario)[1];
            foreach ([['100.64.0.0', 10], ['192.0.0.0', 24], ['198.18.0.0', 15], ['192.0.2.0', 24], ['198.51.100.0', 24], ['203.0.113.0', 24]] as [$rede, $bits]) {
                $mascara = $bits === 0 ? 0 : (~0 << (32 - $bits)) & 0xFFFFFFFF;
                if (($n & $mascara) === (unpack('N', (string) inet_pton($rede))[1] & $mascara)) {
                    return false;
                }
            }
        }
        return true;
    }

    /** @return list<string> */
    private static function resolver(string $host): array
    {
        $enderecos = [];
        $v4 = @gethostbynamel($host);
        if (is_array($v4)) {
            $enderecos = $v4;
        }
        $v6 = @dns_get_record($host, DNS_AAAA);
        if (is_array($v6)) {
            foreach ($v6 as $registro) {
                if (isset($registro['ipv6'])) {
                    $enderecos[] = (string) $registro['ipv6'];
                }
            }
        }
        return array_values(array_unique($enderecos));
    }

    private static function transporteFalso(): bool
    {
        return !Cliente::transporte() instanceof TransporteCurl;
    }

    /**
     * [host, porta, ip a usar] — ou ErroCanal se o destino não é público.
     * ip null = não precisa fixar (transporte falso, host de teste que não resolve).
     *
     * @return array{0: string, 1: int, 2: ?string}
     */
    public static function destinoConferido(string $url): array
    {
        $esquema = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        $host = rtrim(trim((string) parse_url($url, PHP_URL_HOST), '[]'), '.');
        if (!in_array($esquema, ['http', 'https'], true) || $host === '') {
            throw new ErroCanal('endereço de mídia inválido');
        }
        $porta = (int) (parse_url($url, PHP_URL_PORT) ?? ($esquema === 'https' ? 443 : 80));
        $falso = self::transporteFalso();
        $enderecos = filter_var($host, FILTER_VALIDATE_IP) !== false ? [$host] : self::resolver($host);
        if ($enderecos === []) {
            if ($falso) {
                return [$host, $porta, null]; // host de teste: o provedor falso responde
            }
            throw new ErroCanal('não foi possível localizar o servidor da mídia');
        }
        foreach ($enderecos as $ip) {
            if (!self::enderecoPublico($ip)) {
                throw new ErroCanal('endereço de mídia recusado: aponta para a rede interna');
            }
        }
        return [$host, $porta, $falso ? null : $enderecos[0]];
    }

    /** GET da URL (só endereço público), até $limite bytes. */
    public static function baixar(string $url, int $limite): string
    {
        [$host, $porta, $ip] = self::destinoConferido($url);
        $megas = max(1, intdiv($limite, 1024 * 1024));
        if ($ip === null) {
            // transporte falso (teste): o registro de chamadas mostra a URL pedida
            try {
                $resposta = Cliente::pedir('GET', $url);
            } catch (ErroTransporte $erro) {
                throw new ErroCanal('falha de rede ao baixar a mídia: ' . $erro->getMessage());
            }
            if ($resposta->status >= 400) {
                throw new ErroCanal("download da mídia falhou ({$resposta->status})");
            }
            if (strlen($resposta->corpo) > $limite) {
                throw new ErroCanal("a mídia passa do limite de {$megas} MB");
            }
            return $resposta->corpo;
        }
        return self::baixarComCurl($url, $host, $porta, $ip, $limite, $megas);
    }

    private static function baixarComCurl(string $url, string $host, int $porta, string $ip, int $limite, int $megas): string
    {
        $curl = curl_init($url);
        if ($curl === false) {
            throw new ErroCanal('não foi possível iniciar o download da mídia');
        }
        $corpo = '';
        $passou = false;
        try {
            $timeout = Config::obter()->timeout_http;
        } catch (\Throwable) {
            $timeout = 15.0;
        }
        curl_setopt_array($curl, [
            CURLOPT_HTTPGET => true,
            // o IP já conferido: o curl não resolve o nome de novo
            CURLOPT_RESOLVE => ["{$host}:{$porta}:" . (str_contains($ip, ':') ? "[{$ip}]" : $ip)],
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_TIMEOUT_MS => (int) ($timeout * 1000 * 4), // mídia é maior que uma chamada de API
            CURLOPT_CONNECTTIMEOUT_MS => (int) (min($timeout, 10.0) * 1000),
            CURLOPT_HTTPHEADER => ['User-Agent: IHchat'],
            CURLOPT_WRITEFUNCTION => static function ($_curl, string $pedaco) use (&$corpo, &$passou, $limite): int {
                if (strlen($corpo) + strlen($pedaco) > $limite) {
                    $passou = true;
                    return 0; // o curl aborta a transferência
                }
                $corpo .= $pedaco;
                return strlen($pedaco);
            },
        ]);
        $ok = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $erro = curl_error($curl);
        if ($passou) {
            throw new ErroCanal("a mídia passa do limite de {$megas} MB");
        }
        if ($ok === false) {
            throw new ErroCanal('falha de rede ao baixar a mídia: ' . ($erro !== '' ? $erro : 'sem resposta'));
        }
        if ($status >= 400) {
            throw new ErroCanal("download da mídia falhou ({$status})");
        }
        return $corpo;
    }
}

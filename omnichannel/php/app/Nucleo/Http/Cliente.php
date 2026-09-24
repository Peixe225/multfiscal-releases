<?php
declare(strict_types=1);

namespace OmniChannel\Nucleo\Http;

use OmniChannel\Nucleo\Config;
use OmniChannel\Nucleo\Json;

/**
 * Cliente HTTP dos adaptadores de canal (o app/canais/http.py do Python).
 *
 *     $r = Cliente::pedir('POST', "https://api.telegram.org/bot{$token}/sendMessage",
 *                         ['json' => ['chat_id' => 1, 'text' => 'oi']]);
 *     if (!$r->ok()) { ... $r->json() ... }
 *
 * Opções: json | form (array) | multipart (lista de partes) | corpo (texto cru),
 * cabecalhos, query (array), timeout (s), auth ([usuario, senha] -> Basic).
 * Parte multipart: ['nome' => 'document', 'valor' => '...']  ou
 *                  ['nome' => 'document', 'arquivo' => 'a.pdf', 'dados' => $bytes, 'tipo' => 'application/pdf']
 *
 * O corpo é montado aqui (inclusive o multipart), não no curl: assim o
 * transporte falso registra exatamente os bytes que iriam para o provedor.
 * Falha de rede lança ErroTransporte; status de erro NÃO lança (confira ok()).
 */
final class Cliente
{
    private static ?Transporte $transporte = null;

    /** Troca o transporte (testes de unidade). null volta ao automático. */
    public static function definirTransporte(?Transporte $transporte): void
    {
        self::$transporte = $transporte;
    }

    public static function transporte(): Transporte
    {
        if (self::$transporte !== null) {
            return self::$transporte;
        }
        $roteiro = getenv('OMNI_TESTE_PROVEDOR');
        if (is_string($roteiro) && $roteiro !== '') {
            // só em teste: fora do sandbox a variável é ignorada, para um
            // ambiente de produção mal configurado nunca "fingir" que enviou
            try {
                if (Config::obter()->modo_sandbox) {
                    return self::$transporte = new TransporteRoteirado($roteiro);
                }
            } catch (\Throwable) {
            }
        }
        return self::$transporte = new TransporteCurl();
    }

    /** @param array<string, mixed> $opcoes */
    public static function pedir(string $metodo, string $url, array $opcoes = []): RespostaHttp
    {
        $cabecalhos = [];
        foreach ((array) ($opcoes['cabecalhos'] ?? []) as $nome => $valor) {
            $cabecalhos[(string) $nome] = (string) $valor;
        }
        if (!empty($opcoes['query'])) {
            $url .= (str_contains($url, '?') ? '&' : '?') . http_build_query((array) $opcoes['query'], '', '&', PHP_QUERY_RFC3986);
        }
        $corpo = '';
        if (array_key_exists('json', $opcoes)) {
            $corpo = Json::codificar($opcoes['json']);
            $cabecalhos += ['Content-Type' => 'application/json'];
        } elseif (isset($opcoes['form'])) {
            $corpo = http_build_query((array) $opcoes['form'], '', '&');
            $cabecalhos += ['Content-Type' => 'application/x-www-form-urlencoded'];
        } elseif (isset($opcoes['multipart'])) {
            $fronteira = 'omni' . bin2hex(random_bytes(12));
            $corpo = self::multipart((array) $opcoes['multipart'], $fronteira);
            $cabecalhos['Content-Type'] = 'multipart/form-data; boundary=' . $fronteira;
        } elseif (isset($opcoes['corpo'])) {
            $corpo = (string) $opcoes['corpo'];
        }
        if (isset($opcoes['auth']) && is_array($opcoes['auth'])) {
            [$usuario, $senha] = array_values($opcoes['auth']) + ['', ''];
            $cabecalhos['Authorization'] = 'Basic ' . base64_encode($usuario . ':' . $senha);
        }
        $cabecalhos += ['User-Agent' => 'OmniChannel2'];
        $timeout = (float) ($opcoes['timeout'] ?? self::timeoutPadrao());
        return self::transporte()->enviar(strtoupper($metodo), $url, $cabecalhos, $corpo, $timeout);
    }

    /** @param list<array<string, mixed>> $partes */
    private static function multipart(array $partes, string $fronteira): string
    {
        $corpo = '';
        foreach ($partes as $parte) {
            $nome = str_replace(['"', "\r", "\n"], '', (string) ($parte['nome'] ?? 'campo'));
            $corpo .= "--{$fronteira}\r\n";
            if (isset($parte['arquivo'])) {
                $arquivo = str_replace(['"', "\r", "\n"], '', (string) $parte['arquivo']);
                $tipo = (string) ($parte['tipo'] ?? 'application/octet-stream');
                $corpo .= "Content-Disposition: form-data; name=\"{$nome}\"; filename=\"{$arquivo}\"\r\n";
                $corpo .= "Content-Type: {$tipo}\r\n\r\n";
                $corpo .= (string) ($parte['dados'] ?? '') . "\r\n";
            } else {
                $corpo .= "Content-Disposition: form-data; name=\"{$nome}\"\r\n\r\n";
                $corpo .= (string) ($parte['valor'] ?? '') . "\r\n";
            }
        }
        return $corpo . "--{$fronteira}--\r\n";
    }

    private static function timeoutPadrao(): float
    {
        try {
            return Config::obter()->timeout_http;
        } catch (\Throwable) {
            return 15.0;
        }
    }
}

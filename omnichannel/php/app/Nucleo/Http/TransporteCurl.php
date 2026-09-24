<?php
declare(strict_types=1);

namespace OmniChannel\Nucleo\Http;

/** Transporte real, com a extensão curl (disponível na Hostinger). */
final class TransporteCurl implements Transporte
{
    public function enviar(string $metodo, string $url, array $cabecalhos, string $corpo, float $timeout): RespostaHttp
    {
        if (!preg_match('#^https?://#i', $url)) {
            throw new ErroTransporte('URL precisa começar com http:// ou https://');
        }
        $curl = curl_init($url);
        if ($curl === false) {
            throw new ErroTransporte('não foi possível iniciar o curl');
        }
        $linhas = [];
        foreach ($cabecalhos as $nome => $valor) {
            $linhas[] = $nome . ': ' . $valor;
        }
        $recebidos = [];
        curl_setopt_array($curl, [
            CURLOPT_CUSTOMREQUEST => strtoupper($metodo),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $linhas,
            CURLOPT_TIMEOUT_MS => (int) ($timeout * 1000),
            CURLOPT_CONNECTTIMEOUT_MS => (int) (min($timeout, 10.0) * 1000),
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HEADERFUNCTION => static function ($_curl, string $linha) use (&$recebidos): int {
                $partes = explode(':', $linha, 2);
                if (count($partes) === 2) {
                    $recebidos[strtolower(trim($partes[0]))] = trim($partes[1]);
                }
                return strlen($linha);
            },
        ]);
        if ($corpo !== '' || in_array(strtoupper($metodo), ['POST', 'PUT', 'PATCH'], true)) {
            curl_setopt($curl, CURLOPT_POSTFIELDS, $corpo);
        }
        $resposta = curl_exec($curl);
        if ($resposta === false) {
            throw new ErroTransporte(curl_error($curl) ?: 'falha de rede');
        }
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        return new RespostaHttp($status, (string) $resposta, $recebidos);
    }
}

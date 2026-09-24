<?php
declare(strict_types=1);

namespace OmniChannel\Nucleo\Http;

use OmniChannel\Nucleo\Json;

/**
 * Transporte FALSO para a suíte de contrato: nenhuma chamada sai para a rede.
 *
 * Ativo só quando a variável OMNI_TESTE_PROVEDOR aponta um arquivo JSON E o
 * modo sandbox está ligado (ver Cliente::transporte()). Formato do arquivo:
 *
 *   {"respostas": [
 *      {"metodo": "POST",                    // opcional; ausente = qualquer
 *       "url_contem": "api.telegram.org",    // substring da URL; ausente = qualquer
 *       "status": 200,                       // padrão 200
 *       "json": {"ok": true},                // corpo JSON, OU
 *       "corpo": "texto",                    // corpo texto, OU
 *       "corpo_base64": "...",               // corpo binário (download de mídia)
 *       "cabecalhos": {"Content-Type": "image/png"},
 *       "erro_rede": "timeout"}              // em vez de resposta: falha de rede
 *   ]}
 *
 * A primeira regra que casar responde. Sem regra: 404 {"erro": "sem resposta
 * roteirada..."}. O arquivo é relido a cada chamada, então o teste pode trocar
 * o roteiro no meio da sessão. Cada chamada é registrada em
 * "<arquivo>.chamadas.jsonl", uma linha JSON por chamada:
 *   {"metodo", "url", "cabecalhos": {minúsculas}, "corpo": texto|null, "corpo_base64"}
 */
final class TransporteRoteirado implements Transporte
{
    public function __construct(private readonly string $arquivo)
    {
    }

    public function enviar(string $metodo, string $url, array $cabecalhos, string $corpo, float $timeout): RespostaHttp
    {
        $this->registrar($metodo, $url, $cabecalhos, $corpo);
        $roteiro = Json::ler(is_file($this->arquivo) ? (string) file_get_contents($this->arquivo) : null, []);
        foreach ((array) ($roteiro['respostas'] ?? []) as $regra) {
            if (!is_array($regra)) {
                continue;
            }
            if (isset($regra['metodo']) && strcasecmp((string) $regra['metodo'], $metodo) !== 0) {
                continue;
            }
            if (isset($regra['url_contem']) && !str_contains($url, (string) $regra['url_contem'])) {
                continue;
            }
            if (isset($regra['erro_rede'])) {
                throw new ErroTransporte((string) $regra['erro_rede']);
            }
            $saida = (array) ($regra['cabecalhos'] ?? []);
            if (array_key_exists('json', $regra)) {
                $corpoResposta = Json::codificar($regra['json']);
                $saida += ['Content-Type' => 'application/json'];
            } elseif (isset($regra['corpo_base64'])) {
                $corpoResposta = (string) base64_decode((string) $regra['corpo_base64']);
            } else {
                $corpoResposta = (string) ($regra['corpo'] ?? '');
            }
            return new RespostaHttp((int) ($regra['status'] ?? 200), $corpoResposta, $saida);
        }
        return new RespostaHttp(
            404,
            Json::codificar(['erro' => "sem resposta roteirada para {$metodo} {$url}"]),
            ['Content-Type' => 'application/json']
        );
    }

    /** @param array<string, string> $cabecalhos */
    private function registrar(string $metodo, string $url, array $cabecalhos, string $corpo): void
    {
        $minusculos = [];
        foreach ($cabecalhos as $nome => $valor) {
            $minusculos[strtolower($nome)] = $valor;
        }
        $texto = mb_check_encoding($corpo, 'UTF-8') ? $corpo : null;
        $linha = Json::codificar([
            'metodo' => strtoupper($metodo),
            'url' => $url,
            'cabecalhos' => (object) $minusculos,
            'corpo' => $texto,
            'corpo_base64' => base64_encode($corpo),
        ]);
        file_put_contents($this->arquivo . '.chamadas.jsonl', $linha . "\n", FILE_APPEND | LOCK_EX);
    }
}

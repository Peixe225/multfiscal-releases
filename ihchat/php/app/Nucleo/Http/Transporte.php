<?php
declare(strict_types=1);

namespace IHchat\Nucleo\Http;

/** Quem de fato leva o pedido ao provedor (curl em produção, roteiro nos testes). */
interface Transporte
{
    /**
     * @param array<string, string> $cabecalhos
     * @throws ErroTransporte falha de rede (DNS, conexão, tempo esgotado)
     */
    public function enviar(string $metodo, string $url, array $cabecalhos, string $corpo, float $timeout): RespostaHttp;
}

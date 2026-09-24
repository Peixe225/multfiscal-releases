<?php
declare(strict_types=1);

namespace OmniChannel\Atendimento;

/**
 * O que o adaptador devolve ao enviar (ResultadoEnvio de app/canais/base.py).
 *
 * status: 'enviada' | 'simulada' | 'falhou' (e, em recibos, 'entregue'/'lida').
 * externo_id: id da mensagem no provedor, JÁ PREFIXADO pelo canal
 * ("telegram:123"), para casar depois com os recibos de entrega.
 */
final class ResultadoEnvio
{
    public const ENVIADA = 'enviada';
    public const SIMULADA = 'simulada';
    public const FALHOU = 'falhou';

    public function __construct(
        public readonly string $status,
        public readonly ?string $externo_id = null,
        public readonly ?string $erro = null,
    ) {
    }

    public static function falhou(string $erro): self
    {
        return new self(self::FALHOU, null, $erro);
    }

    /**
     * Aceita o resultado de um adaptador que não use esta classe (array ou
     * objeto com status/externo_id/erro).
     *
     * @param self|array<string, mixed>|object $valor
     */
    public static function de(array|object $valor): self
    {
        if ($valor instanceof self) {
            return $valor;
        }
        $d = is_array($valor) ? $valor : get_object_vars($valor);
        $status = $d['status'] ?? self::FALHOU;
        if ($status instanceof \BackedEnum) {
            $status = $status->value;
        }
        $externo = $d['externo_id'] ?? ($d['externoId'] ?? null);
        $erro = $d['erro'] ?? null;
        return new self((string) $status, $externo === null ? null : (string) $externo, $erro === null ? null : (string) $erro);
    }
}

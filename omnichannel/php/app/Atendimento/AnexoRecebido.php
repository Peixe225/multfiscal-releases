<?php
declare(strict_types=1);

namespace OmniChannel\Atendimento;

/**
 * Um arquivo anunciado pelo provedor (AnexoRecebido de app/canais/base.py).
 *
 * `referencia` é o id da mídia no provedor (o adaptador baixa com
 * AdaptadorDeCanal::baixarAnexo); `dados` já vem preenchido quando o próprio
 * webhook trouxe o conteúdo (e-mail, widget). Um dos dois sempre existe.
 */
final class AnexoRecebido
{
    public function __construct(
        public readonly string $nome,
        public readonly ?string $referencia = null,
        public readonly ?string $dados = null,
        public readonly ?string $tipo_conteudo = null,
    ) {
    }

    /** @param self|array<string, mixed>|object $valor */
    public static function de(array|object $valor): self
    {
        if ($valor instanceof self) {
            return $valor;
        }
        $d = is_array($valor) ? $valor : get_object_vars($valor);
        $texto = static fn (mixed $v): ?string => $v === null ? null : (string) $v;
        return new self(
            nome: (string) ($d['nome'] ?? 'arquivo'),
            referencia: $texto($d['referencia'] ?? null),
            dados: $texto($d['dados'] ?? null),
            tipo_conteudo: $texto($d['tipo_conteudo'] ?? ($d['tipoConteudo'] ?? null)),
        );
    }
}

<?php
declare(strict_types=1);

namespace IHchat\Nucleo\Http;

/** Resposta de um provedor externo. */
final class RespostaHttp
{
    /** @var array<string, string> cabeçalhos com nome em minúsculas */
    public readonly array $cabecalhos;

    /** @param array<string, string> $cabecalhos */
    public function __construct(public readonly int $status, public readonly string $corpo, array $cabecalhos = [])
    {
        $normalizados = [];
        foreach ($cabecalhos as $nome => $valor) {
            $normalizados[strtolower((string) $nome)] = (string) $valor;
        }
        $this->cabecalhos = $normalizados;
    }

    public function ok(): bool
    {
        return $this->status >= 200 && $this->status < 300;
    }

    public function cabecalho(string $nome): ?string
    {
        return $this->cabecalhos[strtolower($nome)] ?? null;
    }

    /** Corpo como JSON (arrays associativos); null se não for JSON. */
    public function json(): mixed
    {
        $dados = json_decode($this->corpo, true);
        return json_last_error() === JSON_ERROR_NONE ? $dados : null;
    }
}

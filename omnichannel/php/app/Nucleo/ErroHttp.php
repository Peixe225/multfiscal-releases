<?php
declare(strict_types=1);

namespace OmniChannel\Nucleo;

/**
 * Equivalente ao HTTPException do FastAPI: vira {"detail": ...} com o status.
 *
 * Lançar em qualquer camada (serviço, guarda de autenticação, rota) é o jeito
 * de encerrar a requisição com erro; o front controller faz o resto, inclusive
 * desfazer a transação aberta.
 */
class ErroHttp extends \RuntimeException
{
    /**
     * @param string|array<mixed> $detalhe texto em português (ou lista, no 422)
     * @param array<string, string> $cabecalhos
     */
    public function __construct(
        public readonly int $status,
        public readonly string|array $detalhe,
        public readonly array $cabecalhos = [],
    ) {
        parent::__construct(is_string($detalhe) ? $detalhe : 'erro de validação', $status);
    }

    public static function requisicaoInvalida(string $detalhe): self
    {
        return new self(400, $detalhe);
    }

    public static function naoAutorizado(string $detalhe): self
    {
        return new self(401, $detalhe);
    }

    public static function proibido(string $detalhe): self
    {
        return new self(403, $detalhe);
    }

    public static function naoEncontrado(string $detalhe): self
    {
        return new self(404, $detalhe);
    }

    public static function conflito(string $detalhe): self
    {
        return new self(409, $detalhe);
    }

    public static function grandeDemais(string $detalhe): self
    {
        return new self(413, $detalhe);
    }

    /** 422 com frase simples (o FastAPI faz o mesmo com HTTPException(422, "...")). */
    public static function invalido(string $detalhe): self
    {
        return new self(422, $detalhe);
    }

    public static function indisponivel(string $detalhe): self
    {
        return new self(503, $detalhe);
    }
}

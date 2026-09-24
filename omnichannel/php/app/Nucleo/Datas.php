<?php
declare(strict_types=1);

namespace OmniChannel\Nucleo;

/**
 * Datas sempre em UTC.
 *
 * No banco: texto "2026-09-23 15:44:48.123456" (o mesmo formato que o
 * SQLAlchemy grava no SQLite, e que o DATETIME(6) do MySQL aceita e devolve),
 * de modo que comparar como texto ou como data dá o mesmo resultado.
 *
 * Na API: ISO 8601 com fuso, idêntico ao que o pydantic produz no app Python
 * ("2026-09-23T15:44:48.123456Z"; sem fração quando os microssegundos são zero).
 * Sem o fuso, o navegador no horário de Brasília mostraria a hora UTC como se
 * fosse local, três horas adiantada.
 */
final class Datas
{
    public const FORMATO_BANCO = 'Y-m-d H:i:s.u';

    private static ?\DateTimeZone $utc = null;

    /** Relógio substituível nos testes de unidade. */
    private static ?\DateTimeImmutable $congelado = null;

    public static function utc(): \DateTimeZone
    {
        return self::$utc ??= new \DateTimeZone('UTC');
    }

    public static function agora(): \DateTimeImmutable
    {
        return self::$congelado ?? new \DateTimeImmutable('now', self::utc());
    }

    public static function congelar(?\DateTimeImmutable $momento): void
    {
        self::$congelado = $momento?->setTimezone(self::utc());
    }

    /** Agora, no formato do banco. */
    public static function agoraBanco(): string
    {
        return self::paraBanco(self::agora());
    }

    public static function paraBanco(\DateTimeInterface $data): string
    {
        return \DateTimeImmutable::createFromInterface($data)->setTimezone(self::utc())->format(self::FORMATO_BANCO);
    }

    /**
     * Lê um valor do banco (ou um ISO qualquer). Sem fuso, assume UTC — é o
     * mesmo que garantir_utc() faz no Python.
     */
    public static function doBanco(?string $valor): ?\DateTimeImmutable
    {
        if ($valor === null || $valor === '') {
            return null;
        }
        try {
            $data = new \DateTimeImmutable($valor, self::utc());
        } catch (\Exception) {
            return null;
        }
        return $data->setTimezone(self::utc());
    }

    /** Valor do banco -> texto da API. null continua null. */
    public static function iso(\DateTimeInterface|string|null $valor): ?string
    {
        if ($valor === null) {
            return null;
        }
        $data = is_string($valor) ? self::doBanco($valor) : \DateTimeImmutable::createFromInterface($valor);
        if ($data === null) {
            return null;
        }
        $data = $data->setTimezone(self::utc());
        $micro = (int) $data->format('u');
        $base = $data->format('Y-m-d\TH:i:s');
        return $micro === 0 ? $base . 'Z' : $base . '.' . $data->format('u') . 'Z';
    }

    /** Agora menos N horas, no formato do banco (janelas de reabertura, poda). */
    public static function haHoras(float $horas): string
    {
        $segundos = (int) round($horas * 3600);
        return self::paraBanco(self::agora()->modify("-{$segundos} seconds"));
    }
}

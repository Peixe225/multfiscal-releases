<?php
declare(strict_types=1);

namespace OmniChannel\Nucleo;

/**
 * Log em arquivo diário dentro de pasta_dados/logs.
 *
 * Na hospedagem compartilhada não há journald nem stdout visível: um arquivo
 * por dia, fora do public, é o que o dono consegue abrir pelo gerenciador.
 * Nunca registre senha, token ou segredo aqui.
 */
final class Log
{
    /** @param array<string, mixed> $contexto */
    public static function info(string $mensagem, array $contexto = []): void
    {
        self::escrever('INFO', $mensagem, $contexto);
    }

    /** @param array<string, mixed> $contexto */
    public static function aviso(string $mensagem, array $contexto = []): void
    {
        self::escrever('AVISO', $mensagem, $contexto);
    }

    /** @param array<string, mixed> $contexto */
    public static function erro(string $mensagem, array $contexto = []): void
    {
        self::escrever('ERRO', $mensagem, $contexto);
    }

    public static function excecao(\Throwable $erro, string $onde = ''): void
    {
        self::escrever('ERRO', ($onde !== '' ? "{$onde}: " : '') . get_class($erro) . ': ' . $erro->getMessage(), [
            'arquivo' => $erro->getFile() . ':' . $erro->getLine(),
            'pilha' => $erro->getTraceAsString(),
        ]);
    }

    /** @param array<string, mixed> $contexto */
    private static function escrever(string $nivel, string $mensagem, array $contexto): void
    {
        $linha = sprintf(
            "%s %s %s%s\n",
            Datas::agora()->format('Y-m-d\TH:i:s.v\Z'),
            $nivel,
            $mensagem,
            $contexto ? ' ' . Json::codificar($contexto) : ''
        );
        try {
            $pasta = Config::obter()->pasta('logs');
            @file_put_contents($pasta . '/omnichannel-' . Datas::agora()->format('Y-m-d') . '.log', $linha, FILE_APPEND | LOCK_EX);
        } catch (\Throwable) {
            // sem config não há pasta: o log do próprio PHP é o que resta
        }
        if (PHP_SAPI === 'cli' || PHP_SAPI === 'cli-server') {
            error_log(rtrim($linha));
        }
    }
}

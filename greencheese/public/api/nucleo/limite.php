<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Limite de tentativas. A chave é um hash com o sal do servidor (IP, IP + login…): nada guardado em claro.
// A tentativa é registrada ANTES de rodar (dentro da trava), então 30 pedidos juntos não passam do limite.

/** Chave do limite a partir das partes (ex.: gc_chave_limite(gc_ip(), $login)). */
function gc_chave_limite(string ...$partes): string
{
    return hash_hmac('sha256', implode("\x1f", $partes), gc_sal());
}

/**
 * Registra uma tentativa; se já bateu o limite na janela, recusa com 429 sem registrar.
 * Devolve o id da tentativa (para apagar se der certo, no caso do login).
 */
function gc_limite(string $tipo, string $chave, int $maximo, int $janela, string $mensagem = 'Muita tentativa seguida. Espera um pouco e tenta de novo.'): int
{
    return gc_transacao(static function () use ($tipo, $chave, $maximo, $janela, $mensagem): int {
        $agora = gc_agora();
        if (random_int(1, 50) === 1) {
            gc_sql('DELETE FROM tentativas WHERE em < ?', [$agora - 86400]);
        }
        $l = gc_um('SELECT COUNT(*) AS n, MIN(em) AS primeira FROM tentativas WHERE tipo = ? AND chave = ? AND em > ?', [$tipo, $chave, $agora - $janela]);
        if ((int) ($l['n'] ?? 0) >= $maximo) {
            $espera = max(1, (int) $l['primeira'] + $janela - $agora);
            throw new ErroApi('muitas-tentativas', $mensagem, 429, ['esperaSegundos' => $espera]);
        }
        return gc_inserir('INSERT INTO tentativas (tipo, chave, em) VALUES (?, ?, ?)', [$tipo, $chave, $agora]);
    });
}

/** Confere sem registrar (ex.: o limite por IP do login, que só conta erro). */
function gc_limite_conferir(string $tipo, string $chave, int $maximo, int $janela, string $mensagem): void
{
    $agora = gc_agora();
    $l = gc_um('SELECT COUNT(*) AS n, MIN(em) AS primeira FROM tentativas WHERE tipo = ? AND chave = ? AND em > ?', [$tipo, $chave, $agora - $janela]);
    if ((int) ($l['n'] ?? 0) >= $maximo) {
        $espera = max(1, (int) $l['primeira'] + $janela - $agora);
        throw new ErroApi('muitas-tentativas', $mensagem, 429, ['esperaSegundos' => $espera]);
    }
}

function gc_limite_registrar(string $tipo, string $chave): void
{
    gc_sql('INSERT INTO tentativas (tipo, chave, em) VALUES (?, ?, ?)', [$tipo, $chave, gc_agora()]);
}

function gc_limite_apagar(int $id): void
{
    gc_sql('DELETE FROM tentativas WHERE id = ?', [$id]);
}

function gc_limite_zerar(string $tipo, string $chave): void
{
    gc_sql('DELETE FROM tentativas WHERE tipo = ? AND chave = ?', [$tipo, $chave]);
}

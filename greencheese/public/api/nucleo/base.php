<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Base da API: caminhos, relógio, entrada, respostas em JSON e erros.
// Erro nunca vaza detalhe pro cliente: a mensagem é sempre curta e o detalhe vai pro log, no privado.

/** Erro esperado: vira {"ok": false, "erro", "mensagem", ...extra} com o status HTTP. */
final class ErroApi extends Exception
{
    /** @param array<string, mixed> $extra */
    public function __construct(
        public readonly string $codigo,
        string $mensagem,
        public readonly int $status = 400,
        public readonly array $extra = [],
    ) {
        parent::__construct($mensagem);
    }
}

const GC_MSG_INTERNO = 'Deu ruim do nosso lado. Tenta de novo daqui a pouco.';

/** Modo de teste (scripts/testar-api.mjs): libera o relógio e o IP de mentira. Nunca ligado no ar. */
function gc_teste(): bool
{
    return getenv('GC_TESTE') === '1';
}

/** Desenvolvimento e testes: a pasta de dados vem de GC_DADOS (no ar ela é api/privado/). */
function gc_desenvolvimento(): bool
{
    $d = getenv('GC_DADOS');
    return is_string($d) && $d !== '';
}

/** Hora unix do pedido (a mesma do começo ao fim). Em teste, X-GC-Agora ou GC_AGORA trocam o relógio. */
function gc_agora(): int
{
    static $agora = null;
    if ($agora === null) {
        $agora = time();
        if (gc_teste()) {
            $t = $_SERVER['HTTP_X_GC_AGORA'] ?? getenv('GC_AGORA');
            if (is_string($t) && preg_match('/^\d{9,11}$/', $t)) {
                $agora = (int) $t;
            }
        }
    }
    return $agora;
}

function gc_pasta_dados(): string
{
    $p = getenv('GC_DADOS');
    return rtrim(is_string($p) && $p !== '' ? $p : dirname(__DIR__) . '/privado', '/\\');
}

/** Pasta dos envios do painel: <site>/uploads (a URL pública é "uploads/<nome>"). */
function gc_pasta_uploads(): string
{
    $p = getenv('GC_UPLOADS');
    return rtrim(is_string($p) && $p !== '' ? $p : dirname(__DIR__, 2) . '/uploads', '/\\');
}

/** Log de erros no privado, uma linha por erro; passou de 1 MB, vira erros.log.1 e começa outro. */
function gc_log(string $msg): void
{
    try {
        $dir = gc_pasta_dados();
        if (!is_dir($dir)) {
            @mkdir($dir, 0750, true);
        }
        $arq = $dir . '/erros.log';
        clearstatcache(true, $arq);
        if (is_file($arq) && (int) @filesize($arq) > 1048576) {
            @rename($arq, $arq . '.1');
        }
        $linha = gmdate('Y-m-d\TH:i:s\Z') . ' ' . preg_replace('/[\r\n\t]+/', ' ', $msg) . "\n";
        @file_put_contents($arq, $linha, FILE_APPEND | LOCK_EX);
    } catch (Throwable) {
        // sem log não tem o que fazer
    }
}

function gc_cabecalhos(string $tipo = 'application/json; charset=utf-8'): void
{
    if (headers_sent()) {
        return;
    }
    header_remove('X-Powered-By');
    header('Content-Type: ' . $tipo);
    header('Cache-Control: no-store, max-age=0');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    header('X-Frame-Options: DENY');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    header('X-Robots-Tag: noindex, nofollow');
}

/** @param array<string, mixed> $dados */
function gc_enviar_json(array $dados, int $status): void
{
    if (!headers_sent()) {
        http_response_code($status);
        gc_cabecalhos();
    }
    echo json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
}

function gc_metodo(): string
{
    return strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
}

/**
 * Corpo do POST em JSON (até 64 KB), como objeto. $campo vai no erro (a rota diz qual campo culpar).
 * @return array<string, mixed>
 */
function gc_corpo(?string $campo = null): array
{
    static $corpo = null;
    if (is_array($corpo)) {
        return $corpo;
    }
    $extra = $campo === null ? [] : ['campo' => $campo];
    $tipo = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
    if (!str_starts_with($tipo, 'application/json')) {
        throw new ErroApi('invalido', 'Mande os dados em JSON.', 415, $extra);
    }
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 65536) {
        throw new ErroApi('invalido', 'Dados grandes demais.', 413, $extra);
    }
    $bruto = (string) file_get_contents('php://input', false, null, 0, 65537);
    if (strlen($bruto) > 65536) {
        throw new ErroApi('invalido', 'Dados grandes demais.', 413, $extra);
    }
    try {
        $dados = json_decode($bruto, true, 16, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new ErroApi('invalido', 'Dados quebrados. Recarrega a página e tenta de novo.', 400, $extra);
    }
    if (!is_array($dados) || ($dados !== [] && array_is_list($dados))) {
        throw new ErroApi('invalido', 'Dados quebrados. Recarrega a página e tenta de novo.', 400, $extra);
    }
    $corpo = $dados;
    return $corpo;
}

/** Chegou por HTTPS (direto ou atrás do proxy da hospedagem). Só decide o Secure do cookie. */
function gc_https(): bool
{
    $h = strtolower((string) ($_SERVER['HTTPS'] ?? ''));
    if ($h !== '' && $h !== 'off') {
        return true;
    }
    if ((string) ($_SERVER['SERVER_PORT'] ?? '') === '443') {
        return true;
    }
    return strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

/** Host do pedido, minúsculo e sem a porta padrão. */
function gc_host(): string
{
    $h = strtolower(trim((string) ($_SERVER['HTTP_HOST'] ?? '')));
    if (!preg_match('/^[a-z0-9.\-]+(:\d{1,5})?$|^\[[0-9a-f:.]+\](:\d{1,5})?$/', $h)) {
        return '';
    }
    return preg_replace('/:(80|443)$/', '', $h) ?? '';
}

/**
 * Endereço de quem pediu, para o limite de tentativas. IPv6 conta pelo /64 (cada casa ganha um /64 inteiro).
 * Em teste, X-GC-IP finge outro aparelho.
 */
function gc_ip(): string
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    if (gc_teste() && isset($_SERVER['HTTP_X_GC_IP'])) {
        return substr((string) $_SERVER['HTTP_X_GC_IP'], 0, 64);
    }
    $bin = @inet_pton($ip);
    if (is_string($bin) && strlen($bin) === 16) {
        if (str_starts_with($bin, str_repeat("\0", 10) . "\xff\xff")) {
            return (string) inet_ntop(substr($bin, 12));
        }
        return bin2hex(substr($bin, 0, 8)) . '::/64';
    }
    return $ip;
}

/**
 * Todo POST vem da própria página (Origin, ou Referer quando o navegador não manda Origin).
 * Junto com o JSON obrigatório e o cookie SameSite=Strict, fecha a porta para formulário de outro site.
 */
function gc_conferir_origem(): void
{
    $host = gc_host();
    $site = strtolower((string) ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? ''));
    if ($site === 'cross-site') {
        throw new ErroApi('origem', 'Pedido de fora do site.', 403);
    }
    $origem = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
    $url = $origem !== '' && $origem !== 'null' ? $origem : (string) ($_SERVER['HTTP_REFERER'] ?? '');
    $p = $url === '' ? false : parse_url($url);
    if ($host === '' || !is_array($p) || !isset($p['host'])) {
        throw new ErroApi('origem', 'Pedido de fora do site.', 403);
    }
    $de = strtolower($p['host']) . (isset($p['port']) ? ':' . $p['port'] : '');
    if (preg_replace('/:(80|443)$/', '', $de) !== $host) {
        throw new ErroApi('origem', 'Pedido de fora do site.', 403);
    }
}

/** Data ISO 8601 em UTC ("2026-10-08T03:05:00Z"); null fica null. */
function gc_iso(?int $t): ?string
{
    return $t === null ? null : gmdate('Y-m-d\TH:i:s\Z', $t);
}

/** Banco ocupado demais (muita escrita ao mesmo tempo, passou do busy_timeout). */
function gc_banco_ocupado(Throwable $e): bool
{
    if (!$e instanceof PDOException) {
        return false;
    }
    $codigo = is_array($e->errorInfo ?? null) ? (int) ($e->errorInfo[1] ?? 0) : 0;
    return $codigo === 5 || $codigo === 6 || str_contains($e->getMessage(), 'database is locked');
}

/**
 * Atende o pedido: confere rota e método, chama a função e devolve o JSON.
 * A função devolve o corpo do sucesso (sem o "ok"); '_status' troca o 200 (ex.: 201).
 * @param array<string, array{0: string, 1: callable}> $rotas
 */
function gc_atender(array $rotas): void
{
    ini_set('display_errors', '0');
    error_reporting(E_ALL);
    set_error_handler(static function (int $n, string $msg, string $arq, int $linha): bool {
        if (!(error_reporting() & $n)) {
            return false;
        }
        throw new ErrorException($msg, 0, $n, $arq, $linha);
    });
    $rota = $_GET['r'] ?? '';
    $rota = is_string($rota) ? $rota : '';
    register_shutdown_function(static function () use ($rota): void {
        $e = error_get_last();
        if ($e !== null && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
            gc_log("[$rota] fatal: {$e['message']} em " . basename($e['file']) . ":{$e['line']}");
            if (!headers_sent()) {
                gc_enviar_json(['ok' => false, 'erro' => 'erro-interno', 'mensagem' => GC_MSG_INTERNO], 500);
            }
        }
    });

    try {
        if (!isset($rotas[$rota])) {
            throw new ErroApi('rota-desconhecida', 'Rota desconhecida.', 404);
        }
        [$metodo, $funcao] = $rotas[$rota];
        if (gc_metodo() !== $metodo) {
            header('Allow: ' . $metodo);
            throw new ErroApi('metodo', 'Método não aceito.', 405);
        }
        $res = $funcao();
        $status = (int) ($res['_status'] ?? 200);
        unset($res['_status']);
        gc_enviar_json(['ok' => true] + $res, $status);
    } catch (ErroApi $e) {
        if (isset($e->extra['esperaSegundos']) && !headers_sent()) {
            header('Retry-After: ' . (int) $e->extra['esperaSegundos']);
        }
        gc_enviar_json(['ok' => false, 'erro' => $e->codigo, 'mensagem' => $e->getMessage()] + $e->extra, $e->status);
    } catch (Throwable $e) {
        if (gc_banco_ocupado($e)) {
            gc_log("[$rota] banco ocupado: " . $e->getMessage());
            if (!headers_sent()) {
                header('Retry-After: 2');
            }
            gc_enviar_json(['ok' => false, 'erro' => 'ocupado', 'mensagem' => 'Muita gente ao mesmo tempo. Tenta de novo.'], 503);
            return;
        }
        gc_log("[$rota] " . get_class($e) . ': ' . $e->getMessage() . ' em ' . basename($e->getFile()) . ':' . $e->getLine());
        gc_enviar_json(['ok' => false, 'erro' => 'erro-interno', 'mensagem' => GC_MSG_INTERNO], 500);
    }
}

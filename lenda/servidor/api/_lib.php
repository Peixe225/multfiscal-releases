<?php
/**
 * LENDA · biblioteca comum das rotas da API: config, PDO, JSON, origem, limites, sessão do jogador,
 * e-mail. Nunca é servido (o .htaccess nega _*.php e, se ele falhar, a linha abaixo responde 404).
 * Contrato: servidor/CONTRATO.md.
 */
declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

// Nada de aviso do PHP na resposta: tudo vai para o log do servidor.
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
ini_set('log_errors', '1');
ini_set('html_errors', '0');
ini_set('zend.exception_ignore_args', '1');
error_reporting(E_ALL);
date_default_timezone_set('UTC');

const LENDA_COOKIE_SESSAO = 'lenda_sessao';
const LENDA_COOKIE_PAINEL = 'lenda_painel';
const LENDA_CAMINHO_COOKIE = '/lenda/';
const LENDA_SESSAO_S = 180 * 86400;
const LENDA_RENOVA_S = 7 * 86400;
const LENDA_JANELA_S = 600;
const LENDA_FUSO_H = 3; // America/Sao_Paulo = UTC-3 fixo (sem horário de verão desde 2019)
const LENDA_UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR',
    'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO', 'EX'];
/** Versão da fórmula da Nota de Legado (LEGACY_VERSION em src/engine/legacy/score.ts). Subiu lá? Suba aqui. */
const LENDA_NOTA_VERSAO = 2;
const LENDA_HALL_POR_CONTA = 3;       // carreiras de cada conta no Hall público
/** Conta valendo agora (status ativo, ou suspensão com data já vencida). Usa o apelido `u` para usuarios. */
const LENDA_SQL_ATIVO = "(u.status = 'ativo' OR (u.suspenso_ate IS NOT NULL AND u.suspenso_ate <= UTC_TIMESTAMP()))";
const LENDA_CONVITE_LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I, O, 0 e 1 (que se confundem)

ob_start();

set_error_handler(static function (int $nivel, string $msg, string $arq = '', int $linha = 0): bool {
    if (!(error_reporting() & $nivel)) {
        return false; // silenciado com @
    }
    if ($nivel & (E_DEPRECATED | E_USER_DEPRECATED)) {
        error_log('LENDA aviso: ' . $msg . ' em ' . basename($arq) . ':' . $linha);
        return true; // aviso de versão nova do PHP não derruba a rota
    }
    throw new ErrorException($msg, 0, $nivel, $arq, $linha); // qualquer outro aviso vira erro 500 em JSON
});

set_exception_handler(static function (Throwable $e): void {
    error_log('LENDA ' . get_class($e) . ': ' . $e->getMessage() . ' em ' . basename($e->getFile()) . ':' . $e->getLine());
    erro(500, 'interno', 'Algo deu errado no servidor. Tente de novo daqui a pouco.');
});

register_shutdown_function(static function (): void {
    $e = error_get_last();
    if (!$e || !in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
        return;
    }
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    if (!headers_sent()) {
        header_remove('Set-Cookie');
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
    }
    echo '{"erro":"interno","mensagem":"Algo deu errado no servidor. Tente de novo daqui a pouco."}';
});

// ── respostas ────────────────────────────────────────────────────────────────────────────────────

/** Cabeçalhos de toda resposta da API. */
function cabecalhos(): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    header('X-Robots-Tag: noindex');
    header('X-LiteSpeed-Cache-Control: no-cache');
}

function json(mixed $dados): string
{
    return json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
        | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR);
}

function responder(int $status, mixed $dados): never
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    http_response_code($status);
    echo json($dados);
    exit;
}

/** Resposta já em JSON (ex.: a carreira guardada, sem decodificar de novo). */
function responderBruto(int $status, string $corpoJson): never
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    http_response_code($status);
    echo $corpoJson;
    exit;
}

function semCorpo(): never
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    http_response_code(204);
    header_remove('Content-Type');
    exit;
}

function erro(int $status, string $codigo, string $mensagem): never
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    if (!headers_sent()) {
        header_remove('Set-Cookie'); // erro nunca cria sessão
        cabecalhos();
        if ($status === 405) {
            header('Allow: GET, POST');
        }
    }
    http_response_code($status);
    echo json(['erro' => $codigo, 'mensagem' => $mensagem]);
    exit;
}

function erroMetodo(): never
{
    erro(405, 'metodo', 'Método não permitido.');
}

function erroLimite(): never
{
    erro(429, 'limite', 'Muitas tentativas. Espere alguns minutos e tente de novo.');
}

// ── config e banco ───────────────────────────────────────────────────────────────────────────────

function config(): array
{
    static $c = null;
    if ($c !== null) {
        return $c;
    }
    $caminhos = [];
    $env = getenv('LENDA_CONFIG');
    if (is_string($env) && $env !== '') {
        $caminhos[] = $env;
    }
    $caminhos[] = dirname(__DIR__, 3) . '/lenda-config.php';
    $caminhos[] = dirname(__DIR__, 2) . '/lenda-config.php';
    $caminhos[] = __DIR__ . '/_config.php';
    foreach ($caminhos as $p) {
        if (!@is_file($p) || !@is_readable($p)) {
            continue; // @: open_basedir pode negar a pasta de cima
        }
        $v = require $p;
        if (!is_array($v)) {
            continue;
        }
        $padrao = [
            'origens' => [],
            'regras' => ['apos_partidas' => 5, 'obrigatorio' => false, 'lembrar_a_cada' => 3],
            'email_remetente' => 'contato@oprojeto.online',
            'email_modo' => 'mail',
            'email_pasta' => sys_get_temp_dir() . '/lenda-emails',
            'cookie_seguro' => true,
            'ip_cabecalho' => '',
            'ip_proxies' => [],
            'limpeza_a_cada' => 100,
        ];
        $v['regras'] = (is_array($v['regras'] ?? null) ? $v['regras'] : []) + $padrao['regras'];
        $c = $v + $padrao;
        $seg = $c['segredo'] ?? '';
        if (!is_string($seg) || strlen($seg) < 32 || !is_array($c['db'] ?? null)) {
            error_log('LENDA: config sem segredo (>= 32) ou sem db');
            erro(500, 'config', 'Servidor sem configuração.');
        }
        return $c;
    }
    error_log('LENDA: config não encontrada');
    erro(500, 'config', 'Servidor sem configuração.');
}

function segredo(): string
{
    return (string) config()['segredo'];
}

function bd(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $c = config()['db'];
    try {
        $pdo = new PDO((string) ($c['dsn'] ?? ''), (string) ($c['user'] ?? ''), (string) ($c['pass'] ?? ''), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_STRINGIFY_FETCHES => false,
            PDO::ATTR_TIMEOUT => 5,
        ]);
        $pdo->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci, time_zone = '+00:00'");
    } catch (PDOException $e) {
        error_log('LENDA banco: ' . $e->getMessage());
        erro(500, 'banco', 'Servidor indisponível. Tente de novo daqui a pouco.');
    }
    return $pdo;
}

/** Uma consulta preparada (sempre com parâmetros, nunca com texto colado). */
function sql(string $consulta, array $params = []): PDOStatement
{
    $st = bd()->prepare($consulta);
    $st->execute($params);
    return $st;
}

function umValor(string $consulta, array $params = []): mixed
{
    $v = sql($consulta, $params)->fetchColumn();
    return $v === false ? null : $v;
}

function umaLinha(string $consulta, array $params = []): ?array
{
    $l = sql($consulta, $params)->fetch();
    return $l === false ? null : $l;
}

/** Roda $f numa transação; desfaz se der erro e tenta de novo (até 3 vezes) em deadlock. */
function transacao(callable $f): mixed
{
    $pdo = bd();
    for ($tentativa = 1; ; $tentativa++) {
        $pdo->beginTransaction();
        try {
            $r = $f($pdo);
            $pdo->commit();
            return $r;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            $deadlock = $e instanceof PDOException && in_array($e->errorInfo[1] ?? null, [1213, 1205], true);
            if (!$deadlock || $tentativa >= 3) {
                throw $e;
            }
            usleep(20000 * $tentativa);
        }
    }
}

function eChaveDuplicada(PDOException $e): bool
{
    return ($e->errorInfo[1] ?? null) === 1062 || (string) $e->getCode() === '23000';
}

// ── datas ────────────────────────────────────────────────────────────────────────────────────────

function dt(int $t): string
{
    return gmdate('Y-m-d H:i:s', $t);
}

function paraTempo(?string $dt): ?int
{
    if ($dt === null || $dt === '') {
        return null;
    }
    $t = strtotime($dt . ' UTC');
    return $t === false ? null : $t;
}

/** DATETIME (UTC) → "2026-10-14T12:00:00Z". */
function iso(?string $dt): ?string
{
    $t = paraTempo($dt);
    return $t === null ? null : gmdate('Y-m-d\TH:i:s\Z', $t);
}

// ── pedido ───────────────────────────────────────────────────────────────────────────────────────

function metodo(): string
{
    return strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
}

function origemPermitida(): bool
{
    $permitidas = [];
    foreach ((array) config()['origens'] as $o) {
        if (is_string($o) && $o !== '') {
            $permitidas[] = rtrim(strtolower($o), '/');
        }
    }
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (is_string($origin) && $origin !== '') {
        return in_array(strtolower($origin), $permitidas, true);
    }
    $ref = $_SERVER['HTTP_REFERER'] ?? '';
    if (!is_string($ref) || $ref === '' || strlen($ref) > 2048) {
        return false;
    }
    $p = parse_url($ref);
    if (!is_array($p) || empty($p['scheme']) || empty($p['host'])) {
        return false;
    }
    $o = strtolower($p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : ''));
    return in_array($o, $permitidas, true);
}

/** POST só com JSON (ou text/plain, no e.php) e vindo do próprio site. */
function exigirEscrita(bool $aceitaTexto = false): void
{
    $ct = (string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '');
    $ct = strtolower(trim(explode(';', $ct, 2)[0]));
    $tipoOk = $ct === 'application/json' || ($aceitaTexto && $ct === 'text/plain');
    if (!$tipoOk || !origemPermitida()) {
        erro(403, 'origem', 'Pedido recusado.');
    }
}

function lerCorpo(int $limite): string
{
    $len = $_SERVER['CONTENT_LENGTH'] ?? '';
    if (is_string($len) && $len !== '' && ctype_digit($len) && (int) $len > $limite) {
        erro(413, 'grande', 'Dados grandes demais.');
    }
    $in = fopen('php://input', 'rb');
    $dados = $in === false ? '' : stream_get_contents($in, $limite + 1);
    if ($in !== false) {
        fclose($in);
    }
    if (!is_string($dados)) {
        $dados = '';
    }
    if (strlen($dados) > $limite) {
        erro(413, 'grande', 'Dados grandes demais.');
    }
    return $dados;
}

/** Corpo JSON que tem de ser um objeto. $assoc=false mantém {} como objeto (carreiras). */
function lerJson(int $limite, bool $assoc = true, int $profundidade = 64): array|stdClass
{
    $txt = lerCorpo($limite);
    try {
        $j = json_decode($txt, $assoc, $profundidade, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
    } catch (JsonException) {
        erro(400, 'json', 'Pedido inválido.');
    }
    if ($assoc ? (!is_array($j) || ($j !== [] && array_is_list($j))) : !($j instanceof stdClass)) {
        erro(400, 'json', 'Pedido inválido.');
    }
    return $j;
}

/** $ip está em $faixa ("1.2.3.4", "10.0.0.0/8", "2a02:4780::/32")? */
function ipNaFaixa(string $ip, string $faixa): bool
{
    [$rede, $bits] = array_pad(explode('/', trim($faixa), 2), 2, null);
    $a = @inet_pton($ip);
    $b = @inet_pton((string) $rede);
    if ($a === false || $b === false || strlen($a) !== strlen($b)) {
        return false;
    }
    $max = strlen($a) * 8;
    $n = $bits === null ? $max : (ctype_digit((string) $bits) ? min($max, (int) $bits) : -1);
    if ($n < 0) {
        return false;
    }
    $bytes = intdiv($n, 8);
    if (substr($a, 0, $bytes) !== substr($b, 0, $bytes)) {
        return false;
    }
    $resto = $n % 8;
    if ($resto === 0) {
        return true;
    }
    $mascara = (0xff << (8 - $resto)) & 0xff;
    return (ord($a[$bytes]) & $mascara) === (ord($b[$bytes]) & $mascara);
}

/**
 * IP do visitante. Com `ip_cabecalho` (CDN/proxy na frente), lê o ÚLTIMO item válido do cabeçalho: é o que o
 * proxy acrescentou (os da frente o cliente pode inventar). Com `ip_proxies`, só confia no cabeçalho quando o
 * pedido veio de um desses IPs/faixas.
 */
function ipCliente(): string
{
    $c = config();
    $remoto = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    $cab = (string) ($c['ip_cabecalho'] ?? '');
    if ($cab === '' || empty($_SERVER[$cab]) || !is_string($_SERVER[$cab])) {
        return $remoto;
    }
    $proxies = array_values(array_filter((array) ($c['ip_proxies'] ?? []), 'is_string'));
    if ($proxies) {
        $confia = false;
        foreach ($proxies as $p) {
            if (ipNaFaixa($remoto, $p)) {
                $confia = true;
                break;
            }
        }
        if (!$confia) {
            return $remoto;
        }
    }
    foreach (array_reverse(explode(',', $_SERVER[$cab])) as $item) {
        $ip = trim($item);
        if (filter_var($ip, FILTER_VALIDATE_IP)) {
            return $ip;
        }
    }
    return $remoto;
}

/** IP como vale para os limites: IPv6 vira o /64 (quem tem um /64 troca de endereço à vontade). */
function ipParaLimite(string $ip): string
{
    $b = @inet_pton($ip);
    if ($b === false || strlen($b) !== 16) {
        return $ip;
    }
    if (substr($b, 0, 12) === str_repeat("\0", 10) . "\xff\xff") {
        return (string) inet_ntop(substr($b, 12)); // IPv4 escrito como IPv6 (::ffff:1.2.3.4)
    }
    return (string) inet_ntop(substr($b, 0, 8) . str_repeat("\0", 8));
}

/** Texto limpo: sem caracteres de controle, espaços juntados, cortado em $max caracteres. */
function texto(mixed $v, int $max): ?string
{
    if (!is_string($v) && !is_int($v) && !is_float($v)) {
        return null;
    }
    $s = preg_replace('/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/u', ' ', (string) $v);
    if (!is_string($s)) {
        return null;
    }
    $s = trim((string) preg_replace('/\s+/u', ' ', $s));
    if ($s === '') {
        return null;
    }
    return mb_substr($s, 0, $max, 'UTF-8');
}

function uuid(mixed $v): ?string
{
    if (!is_string($v) || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $v)) {
        return null;
    }
    return strtolower($v);
}

/** UUID v4 aleatório. */
function uuidNovo(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    $h = bin2hex($b);
    return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-' . substr($h, 12, 4) . '-' . substr($h, 16, 4) . '-' . substr($h, 20);
}

// ── limites de tentativas ────────────────────────────────────────────────────────────────────────

/** Quem: o IP nunca é gravado, só este HMAC (que muda a cada dia). IPv6 conta pelo /64. */
function quemIp(): string
{
    return hash_hmac('sha256', ipParaLimite(ipCliente()) . date('Y-m-d'), segredo());
}

function quemEmail(string $email): string
{
    return hash_hmac('sha256', 'email|' . $email, segredo());
}

/**
 * Soma $n na janela de ($acao, $quem) e devolve o total da janela. A janela é contada em unidades de 10 min:
 * com $janelaS = 86400 ela é o começo do dia (UTC). Chaves de janela diária começam com "dia-" (a limpeza
 * curta as poupa).
 */
function somarLimite(string $acao, string $quem, int $n = 1, int $janelaS = LENDA_JANELA_S): int
{
    $janelaS = max(LENDA_JANELA_S, $janelaS);
    if ($janelaS > LENDA_JANELA_S && !str_starts_with($acao, 'dia-')) {
        $acao = 'dia-' . $acao;
    }
    $chave = substr($acao . ':' . $quem, 0, 100);
    $janela = intdiv(time(), $janelaS) * intdiv($janelaS, LENDA_JANELA_S);
    sql('INSERT INTO tentativas (chave, janela, n) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE n = n + VALUES(n)',
        [$chave, $janela, $n]);
    // Uma vez por janela de 10 min (o primeiro pedido dela), mesmo com pouco tráfego: a política promete ~20 min.
    $atual = intdiv(time(), LENDA_JANELA_S);
    if (!bd()->inTransaction() && sql('INSERT IGNORE INTO tentativas (chave, janela, n) VALUES (?, ?, 1)', ['limpeza:janela', $atual])->rowCount() === 1) {
        try {
            limparTentativasCurtas();
        } catch (PDOException) {
            // só uma limpeza: a próxima janela tenta de novo
        }
    }
    return (int) umValor('SELECT n FROM tentativas WHERE chave = ? AND janela = ?', [$chave, $janela]);
}

/** Soma $n na janela (10 min, ou $janelaS) de ($acao, $quem); estourou $max → 429. */
function limitar(string $acao, string $quem, int $max, int $n = 1, int $janelaS = LENDA_JANELA_S): void
{
    if (somarLimite($acao, $quem, $n, $janelaS) > $max) {
        erroLimite();
    }
}

/** Janelas de 10 min já encerradas não servem para nada: saem (o código do IP fica no máximo ~20 min). */
function limparTentativasCurtas(): void
{
    sql("DELETE FROM tentativas WHERE janela < ? AND chave NOT LIKE 'dia-%'", [intdiv(time(), LENDA_JANELA_S) - 1]);
}

/** Limpeza leve, em ~1% dos pedidos: tentativas velhas, sessões vencidas, códigos vencidos e medição > 13 meses. */
function limpezaTalvez(): void
{
    $a = (int) (config()['limpeza_a_cada'] ?? 100);
    if ($a < 1 || random_int(1, $a) !== 1) {
        return;
    }
    try {
        $t = time();
        limparTentativasCurtas();
        sql('DELETE FROM tentativas WHERE janela < ?', [intdiv($t - 86400, LENDA_JANELA_S)]);
        sql('DELETE FROM sessoes_login WHERE expira_em < ?', [dt($t)]);
        sql('DELETE FROM redefinicoes WHERE expira_em < ?', [dt($t)]);
        $velho = dt($t - 396 * 86400);
        sql('DELETE FROM eventos WHERE em < ? LIMIT 5000', [$velho]);
        sql('DELETE FROM visitas WHERE inicio < ? LIMIT 5000', [$velho]);
    } catch (Throwable $e) {
        error_log('LENDA limpeza: ' . $e->getMessage());
    }
}

// ── cookies e sessão do jogador ──────────────────────────────────────────────────────────────────

function definirCookie(string $nome, string $valor, int $expira, string $sameSite = 'Lax'): void
{
    setcookie($nome, $valor, [
        'expires' => $expira,
        'path' => LENDA_CAMINHO_COOKIE,
        'secure' => (bool) config()['cookie_seguro'],
        'httponly' => true,
        'samesite' => $sameSite,
    ]);
}

function apagarCookie(string $nome, string $sameSite = 'Lax'): void
{
    definirCookie($nome, '', time() - 86400 * 365, $sameSite);
}

function tokenDoCookie(): ?string
{
    $v = $_COOKIE[LENDA_COOKIE_SESSAO] ?? null;
    return is_string($v) && preg_match('/^[A-Za-z0-9_-]{43}$/', $v) ? $v : null;
}

/** Nova sessão: 32 bytes aleatórios no cookie, só o sha256 no banco. */
function criarSessao(int $uid): void
{
    $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    $t = time();
    sql('INSERT INTO sessoes_login (token_sha256, usuario_id, criada_em, expira_em, renovada_em) VALUES (?, ?, ?, ?, ?)',
        [hash('sha256', $token), $uid, dt($t), dt($t + LENDA_SESSAO_S), dt($t)]);
    definirCookie(LENDA_COOKIE_SESSAO, $token, $t + LENDA_SESSAO_S);
}

/** Apaga a sessão do cookie atual (no banco); não mexe no cookie. */
function encerrarSessaoAtual(): void
{
    $tok = tokenDoCookie();
    if ($tok !== null) {
        sql('DELETE FROM sessoes_login WHERE token_sha256 = ?', [hash('sha256', $tok)]);
    }
}

/** A conta está suspensa agora? (suspensão com data vencida não vale mais) */
function contaSuspensa(array $u): bool
{
    if (($u['status'] ?? 'ativo') !== 'suspenso') {
        return false;
    }
    $ate = paraTempo($u['suspenso_ate'] ?? null);
    return $ate === null || $ate > time();
}

/** Mensagem para quem tem a conta suspensa (com a data, em Brasília, e o motivo, se houver). */
function mensagemSuspenso(array $u): string
{
    $ate = paraTempo($u['suspenso_ate'] ?? null);
    $msg = 'Sua conta está suspensa' . ($ate !== null ? ' até ' . gmdate('d/m/Y', $ate - LENDA_FUSO_H * 3600) : '') . '.';
    $motivo = texto($u['motivo_suspensao'] ?? null, 200);
    return $msg . ($motivo !== null ? ' Motivo: ' . $motivo . '.' : '') . ' Fale com contato@oprojeto.online se achar que é um engano.';
}

/** Linha da conta suspensa que mandou o cookie neste pedido (para exigirUsuario responder 403 em vez de 401). */
function sessaoSuspensa(?array $l = null, bool $definir = false): ?array
{
    static $s = null;
    if ($definir) {
        $s = $l;
    }
    return $s;
}

/**
 * Usuário do cookie (linha de `usuarios`) ou null. Renova a sessão depois de 7 dias. Conta suspensa: null
 * (e exigirUsuario responde 403 suspenso).
 */
function usuarioLogado(bool $recarregar = false): ?array
{
    static $feito = false, $u = null;
    if ($feito && !$recarregar) {
        return $u;
    }
    $feito = true;
    $u = null;
    sessaoSuspensa(null, true);
    $tok = tokenDoCookie();
    if ($tok === null) {
        return null;
    }
    $hash = hash('sha256', $tok);
    $t = time();
    $l = umaLinha('SELECT s.renovada_em AS s_renovada, u.* FROM sessoes_login s JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.token_sha256 = ? AND s.expira_em > ?', [$hash, dt($t)]);
    if ($l === null) {
        return null;
    }
    if (contaSuspensa($l)) {
        unset($l['s_renovada']);
        sessaoSuspensa($l, true);
        return null;
    }
    if ((paraTempo($l['s_renovada']) ?? 0) < $t - LENDA_RENOVA_S) {
        sql('UPDATE sessoes_login SET expira_em = ?, renovada_em = ? WHERE token_sha256 = ?',
            [dt($t + LENDA_SESSAO_S), dt($t), $hash]);
        definirCookie(LENDA_COOKIE_SESSAO, $tok, $t + LENDA_SESSAO_S);
    }
    if ((paraTempo($l['ultimo_acesso']) ?? 0) < $t - 300) {
        sql('UPDATE usuarios SET ultimo_acesso = ? WHERE id = ?', [dt($t), (int) $l['id']]);
        $l['ultimo_acesso'] = dt($t);
    }
    unset($l['s_renovada']);
    $u = $l;
    return $u;
}

function exigirUsuario(): array
{
    $u = usuarioLogado();
    if ($u === null) {
        $s = sessaoSuspensa();
        if ($s !== null) {
            erro(403, 'suspenso', mensagemSuspenso($s));
        }
        erro(401, 'nao_logado', 'Entre na sua conta para continuar.');
    }
    return $u;
}

// ── administrador (painel e instalar) ────────────────────────────────────────────────────────────

function cabecalhoAutorizacao(): string
{
    foreach (['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $k) {
        if (!empty($_SERVER[$k]) && is_string($_SERVER[$k])) {
            return $_SERVER[$k];
        }
    }
    if (function_exists('getallheaders')) {
        foreach ((array) getallheaders() as $k => $v) {
            if (is_string($k) && strcasecmp($k, 'Authorization') === 0 && is_string($v)) {
                return $v;
            }
        }
    }
    return '';
}

function tokenAdminValido(): bool
{
    $esperado = strtolower((string) (config()['admin_token_sha256'] ?? ''));
    if (!preg_match('/^[0-9a-f]{64}$/', $esperado)) {
        return false;
    }
    if (!preg_match('/^Bearer\s+(\S{16,256})$/i', trim(cabecalhoAutorizacao()), $m)) {
        return false;
    }
    return hash_equals($esperado, hash('sha256', $m[1]));
}

/** HMAC do exp; a chave leva o hash da senha do painel: trocar a senha derruba todos os cookies emitidos. */
function assinaturaPainel(string $exp): string
{
    return hash_hmac('sha256', 'painel|' . $exp, segredo() . '|' . (string) (config()['admin_senha_hash'] ?? ''));
}

function cookiePainelValido(): bool
{
    $v = $_COOKIE[LENDA_COOKIE_PAINEL] ?? null;
    if (!is_string($v) || !preg_match('/^(\d{9,11})\.([0-9a-f]{64})$/', $v, $m)) {
        return false;
    }
    if ((int) $m[1] < time()) {
        return false;
    }
    return hash_equals(assinaturaPainel($m[1]), $m[2]);
}

// ── origem da visita ─────────────────────────────────────────────────────────────────────────────

/** Domínio (ou utm) → tiktok, youtube, instagram, google, direto, ou o próprio domínio. */
function normalizarOrigem(?string $utmSource, ?string $ref): string
{
    $mapear = static function (string $h): string {
        $h = strtolower(trim($h));
        $h = (string) preg_replace('/^www\d*\./', '', $h);
        if ($h === '') {
            return '';
        }
        if ($h === 'tiktok' || $h === 'tiktok.com' || str_ends_with($h, '.tiktok.com')) {
            return 'tiktok';
        }
        if ($h === 'youtube' || $h === 'youtube.com' || str_ends_with($h, '.youtube.com') || $h === 'youtu.be') {
            return 'youtube';
        }
        if ($h === 'instagram' || $h === 'instagram.com' || str_ends_with($h, '.instagram.com')) {
            return 'instagram';
        }
        if ($h === 'google' || preg_match('/(^|\.)google\.[a-z.]{2,12}$/', $h)) {
            return 'google';
        }
        $h = (string) preg_replace('/[^a-z0-9._-]/', '', $h);
        return substr($h, 0, 64);
    };
    if ($utmSource !== null && trim($utmSource) !== '') {
        $o = $mapear($utmSource);
        if ($o !== '') {
            return $o;
        }
    }
    $ref = trim((string) $ref);
    if ($ref === '') {
        return 'direto';
    }
    if (str_contains($ref, '://')) {
        $host = parse_url($ref, PHP_URL_HOST);
        $host = is_string($host) ? $host : '';
    } else {
        $host = (string) preg_split('#[/?:\#]#', $ref, 2)[0];
    }
    $o = $mapear($host);
    return $o === '' ? 'direto' : $o;
}

// ── e-mail ───────────────────────────────────────────────────────────────────────────────────────

/** Envia (mail()) ou grava num arquivo (email_modo = 'arquivo', para teste). */
function enviarEmail(string $para, string $assunto, string $corpo): bool
{
    $c = config();
    $rem = (string) $c['email_remetente'];
    if (!filter_var($rem, FILTER_VALIDATE_EMAIL) || !filter_var($para, FILTER_VALIDATE_EMAIL)) {
        return false;
    }
    $cab = [
        'From' => 'LENDA <' . $rem . '>',
        'Reply-To' => $rem,
        'MIME-Version' => '1.0',
        'Content-Type' => 'text/plain; charset=UTF-8',
        'Content-Transfer-Encoding' => '8bit',
        'X-Mailer' => 'LENDA',
    ];
    $assuntoMime = '=?UTF-8?B?' . base64_encode($assunto) . '?=';
    try {
        if (($c['email_modo'] ?? 'mail') === 'arquivo') {
            $dir = (string) $c['email_pasta'];
            if (!is_dir($dir)) {
                mkdir($dir, 0700, true);
            }
            $linhas = ['To: ' . $para, 'Subject: ' . $assuntoMime];
            foreach ($cab as $k => $v) {
                $linhas[] = $k . ': ' . $v;
            }
            $nome = $dir . '/' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(6)) . '.eml';
            return file_put_contents($nome, implode("\r\n", $linhas) . "\r\n\r\n" . $corpo, LOCK_EX) !== false;
        }
        return mail($para, $assuntoMime, $corpo, $cab, '-f' . $rem);
    } catch (Throwable $e) {
        error_log('LENDA e-mail: ' . $e->getMessage());
        return false;
    }
}

/** Responde já e continua o trabalho depois (FPM/LiteSpeed); sem suporte, só segue. */
function terminarResposta(int $status, mixed $dados): void
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    http_response_code($status);
    $corpo = json($dados);
    header('Content-Length: ' . strlen($corpo));
    echo $corpo;
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } elseif (function_exists('litespeed_finish_request')) {
        litespeed_finish_request();
    } else {
        flush();
    }
}

// ── utilidades v3 ────────────────────────────────────────────────────────────────────────────────

/** "?, ?, ?" para um IN (...) com $n itens. */
function marcas(int $n): string
{
    return implode(', ', array_fill(0, max(1, $n), '?'));
}

/** Data de hoje em Brasília (YYYY-MM-DD), para "1 por dia". */
function diaBrasilia(?int $t = null): string
{
    return gmdate('Y-m-d', ($t ?? time()) - LENDA_FUSO_H * 3600);
}

/** Inteiro de um valor JSON (aceita 5.0); fora da faixa ou de outro tipo: null. */
function inteiroOuNulo(mixed $v, int $min, int $max): ?int
{
    if (is_float($v) && is_finite($v) && floor($v) === $v && abs($v) < 1e15) {
        $v = (int) $v;
    }
    return is_int($v) && $v >= $min && $v <= $max ? $v : null;
}

/** Página pedida (?pagina=N), de 1 a 10.000. */
function paginaPedida(): int
{
    $p = $_GET['pagina'] ?? '1';
    return is_string($p) && ctype_digit($p) && (int) $p >= 1 ? min(10000, (int) $p) : 1;
}

/** Trava do MySQL (GET_LOCK) com o nome do banco junto (o servidor de banco é dividido com outros sites/bancos). */
function nomeTrava(string $nome): string
{
    static $banco = null;
    $banco ??= (string) umValor('SELECT DATABASE()');
    return substr($nome . ':' . $banco, 0, 64);
}

function pegarTrava(string $nome, int $esperaS = 0): bool
{
    return (int) umValor('SELECT GET_LOCK(?, ?)', [nomeTrava($nome), $esperaS]) === 1;
}

function soltarTrava(string $nome): void
{
    umValor('SELECT RELEASE_LOCK(?)', [nomeTrava($nome)]);
}

/** Erro com campos a mais (ex.: qual chave da config está errada). */
function erroCom(int $status, string $codigo, string $mensagem, array $extra): never
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    if (!headers_sent()) {
        header_remove('Set-Cookie');
        cabecalhos();
    }
    http_response_code($status);
    echo json(['erro' => $codigo, 'mensagem' => $mensagem] + $extra);
    exit;
}

// ── filtro de palavrões, ofensas e nomes reservados ──────────────────────────────────────────────

/** Minúsculo, sem acento, leetspeak simples desfeito, só letras a-z separadas por um espaço. */
function normalizarFiltro(string $s): string
{
    $s = mb_strtolower($s, 'UTF-8');
    if (class_exists('Normalizer')) {
        $d = Normalizer::normalize($s, Normalizer::FORM_D);
        if (is_string($d)) {
            $s = $d;
        }
    }
    $s = (string) preg_replace('/\p{M}+/u', '', $s); // acentos soltos (decompostos)
    $s = strtr($s, ['á' => 'a', 'à' => 'a', 'â' => 'a', 'ã' => 'a', 'ä' => 'a', 'å' => 'a', 'é' => 'e', 'è' => 'e', 'ê' => 'e',
        'ë' => 'e', 'í' => 'i', 'ì' => 'i', 'î' => 'i', 'ï' => 'i', 'ó' => 'o', 'ò' => 'o', 'ô' => 'o', 'õ' => 'o', 'ö' => 'o',
        'ú' => 'u', 'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'ç' => 'c', 'ñ' => 'n', 'ý' => 'y', 'ÿ' => 'y', 'ß' => 'ss']);
    $s = strtr($s, ['4' => 'a', '@' => 'a', '3' => 'e', '1' => 'i', '!' => 'i', '0' => 'o', '5' => 's', '$' => 's', '7' => 't']);
    return trim((string) preg_replace('/[^a-z]+/', ' ', $s));
}

/** "caaaraaalho" → "caralho" (letras repetidas viram uma). */
function juntarRepetidas(string $s): string
{
    return (string) preg_replace('/(.)\1+/', '$1', $s);
}

/**
 * O texto tem palavrão/ofensa ('palavrao') ou nome reservado ('reservado')? null = pode. Confere cada palavra
 * inteira (e sem o "s" do fim), o texto inteiro sem espaços ("p u t a") e, das palavras fortes, qualquer pedaço
 * do texto colado ("filhodaputa"). Lista em _palavras.php.
 */
function textoProibido(string $s, bool $reservados = true): ?string
{
    static $listas = null;
    if ($listas === null) {
        $bruto = require __DIR__ . '/_palavras.php';
        $listas = [];
        foreach (['inteiras', 'reservadas_inteiras'] as $k) {
            $listas[$k] = [];
            foreach ($bruto[$k] as $p) {
                $listas[$k][$p] = true;
                $listas[$k][juntarRepetidas($p)] = true;
            }
        }
        foreach (['coladas', 'reservadas_coladas'] as $k) {
            $listas[$k] = [];
            foreach ($bruto[$k] as $p) {
                $listas[$k][$p] = juntarRepetidas($p);
            }
        }
    }
    $n = normalizarFiltro($s);
    if ($n === '') {
        return null;
    }
    $colado = str_replace(' ', '', $n);
    $coladoJ = juntarRepetidas($colado);
    $inteira = static function (string $t, array $lista): bool {
        foreach ([$t, juntarRepetidas($t)] as $x) {
            if (isset($lista[$x]) || (strlen($x) >= 3 && str_ends_with($x, 's') && isset($lista[substr($x, 0, -1)]))) {
                return true;
            }
        }
        return false;
    };
    $grupos = [['inteiras', 'coladas', 'palavrao']];
    if ($reservados) {
        $grupos[] = ['reservadas_inteiras', 'reservadas_coladas', 'reservado'];
    }
    foreach ($grupos as [$ki, $kc, $motivo]) {
        foreach (array_merge(explode(' ', $n), [$colado]) as $t) {
            if ($inteira($t, $listas[$ki])) {
                return $motivo;
            }
        }
        foreach ($listas[$kc] as $c => $cj) {
            if (str_contains($colado, $c) || str_contains($coladoJ, $cj)) {
                return $motivo;
            }
        }
    }
    return null;
}

/**
 * Apelido: 2 a 20 caracteres, letras latinas (com acento), números, espaço, _ . -; sem espaço nas pontas nem
 * duplo; sem palavrão/ofensa e (com $reservados) sem nome reservado. Só letras latinas: letra de outro alfabeto
 * que parece latina ("а" cirílico) passaria pelo filtro.
 */
function lerApelido(mixed $v, bool $reservados = true): string
{
    $a = is_string($v) ? trim($v) : '';
    $n = mb_strlen($a, 'UTF-8');
    if ($n < 2 || $n > 20 || !preg_match('/^[\p{Latin}\p{M}\p{N}_.\- ]+$/u', $a) || preg_match('/\s{2,}/u', $a)) {
        erro(400, 'apelido_invalido', 'O apelido precisa ter de 2 a 20 caracteres: letras, números, espaço, _ . ou -.');
    }
    if (textoProibido($a, $reservados) !== null) {
        erro(400, 'apelido_proibido', 'Esse apelido não é permitido. Escolha outro.');
    }
    return $a;
}

// ── configuração do site (tabela site_config; o banco manda, o arquivo de config dá o padrão) ───

const LENDA_CONFIG_CHAVES = ['regras', 'imersivo_publico', 'live_publica', 'aviso', 'manutencao', 'bonus', 'hall_intervalo_min',
    'cadastro_aberto'];

/** Padrões de cada chave (o `regras` vem do arquivo de config). */
function configPadrao(): array
{
    $r = config()['regras'];
    return [
        'regras' => ['aposPartidas' => (int) $r['apos_partidas'], 'obrigatorio' => (bool) $r['obrigatorio'],
            'lembrarACada' => (int) $r['lembrar_a_cada']],
        'imersivo_publico' => false,
        'live_publica' => false,
        'aviso' => null,
        'manutencao' => false,
        'bonus' => ['indicacao' => [2, 3, 5], 'compartilhar' => 2, 'liberaAposPartidas' => 3, 'maxIndicacoes' => 3],
        'hall_intervalo_min' => 60,
        'cadastro_aberto' => true,
    ];
}

/**
 * Confere e normaliza o valor de uma chave da config. Inválido: InvalidArgumentException com a mensagem
 * (pt-BR) para o painel mostrar.
 */
function normalizarConfig(string $chave, mixed $v): mixed
{
    $ruim = static fn(string $m): never => throw new InvalidArgumentException($m);
    $int = static fn(mixed $x, int $a, int $b): ?int => inteiroOuNulo($x, $a, $b);
    switch ($chave) {
        case 'regras':
            if (!is_array($v)) {
                $ruim('Regras do convite de conta: informe aposPartidas, obrigatorio e lembrarACada.');
            }
            $a = $int($v['aposPartidas'] ?? null, 1, 100);
            $l = $int($v['lembrarACada'] ?? null, 1, 100);
            $o = $v['obrigatorio'] ?? null;
            if ($a === null || $l === null || !is_bool($o)) {
                $ruim('Regras do convite de conta: aposPartidas e lembrarACada de 1 a 100, obrigatorio sim ou não.');
            }
            return ['aposPartidas' => $a, 'obrigatorio' => $o, 'lembrarACada' => $l];
        case 'imersivo_publico':
        case 'live_publica':
        case 'manutencao':
        case 'cadastro_aberto':
            if (!is_bool($v)) {
                $ruim("“{$chave}” tem de ser sim ou não.");
            }
            return $v;
        case 'aviso':
            if ($v === null || $v === '' || $v === false) {
                return null;
            }
            if (!is_array($v)) {
                $ruim('Aviso: informe o texto (até 200 caracteres) e o tipo (info ou alerta), ou deixe vazio.');
            }
            $txt = texto($v['texto'] ?? null, 400);
            $tipo = $v['tipo'] ?? 'info';
            if ($txt === null || mb_strlen($txt, 'UTF-8') > 200 || !in_array($tipo, ['info', 'alerta'], true)) {
                $ruim('Aviso: o texto precisa ter de 1 a 200 caracteres e o tipo ser info ou alerta.');
            }
            return ['texto' => $txt, 'tipo' => $tipo];
        case 'bonus':
            if (!is_array($v) || !is_array($v['indicacao'] ?? null) || !array_is_list($v['indicacao'])
                || count($v['indicacao']) < 1 || count($v['indicacao']) > 10) {
                $ruim('Bônus: “indicacao” é uma lista de 1 a 10 valores (ex.: 2, 3, 5).');
            }
            $ind = [];
            foreach ($v['indicacao'] as $x) {
                $x = $int($x, 0, 10);
                if ($x === null) {
                    $ruim('Bônus: cada valor de indicação vai de 0 a 10.');
                }
                $ind[] = $x;
            }
            $c = $int($v['compartilhar'] ?? null, 0, 10);
            $lib = $int($v['liberaAposPartidas'] ?? null, 0, 50);
            $max = $int($v['maxIndicacoes'] ?? null, 0, 10);
            if ($c === null || $lib === null || $max === null) {
                $ruim('Bônus: compartilhar de 0 a 10, liberaAposPartidas de 0 a 50 e maxIndicacoes de 0 a 10.');
            }
            return ['indicacao' => $ind, 'compartilhar' => $c, 'liberaAposPartidas' => $lib, 'maxIndicacoes' => $max];
        case 'hall_intervalo_min':
            $m = $int($v, 60, 180);
            if ($m === null) {
                $ruim('O Hall público é recalculado a cada 60 a 180 minutos.');
            }
            return $m;
    }
    $ruim('Chave de configuração desconhecida: ' . mb_substr($chave, 0, 40) . '.');
}

/** Valores em vigor (padrão + o que está no banco), com cache curto (APCu, se houver). */
function siteConfig(bool $recarregar = false): array
{
    static $c = null;
    if ($c !== null && !$recarregar) {
        return $c;
    }
    $apcu = function_exists('apcu_fetch') && filter_var(ini_get('apc.enabled'), FILTER_VALIDATE_BOOL) && PHP_SAPI !== 'cli';
    $chaveApcu = 'lenda:site:' . md5((string) (config()['db']['dsn'] ?? ''));
    if ($apcu && !$recarregar) {
        $v = apcu_fetch($chaveApcu, $ok);
        if ($ok && is_array($v)) {
            return $c = $v;
        }
    }
    $c = configPadrao();
    try {
        $linhas = sql('SELECT chave, valor FROM site_config WHERE chave IN (' . marcas(count(LENDA_CONFIG_CHAVES)) . ')',
            LENDA_CONFIG_CHAVES)->fetchAll();
    } catch (PDOException $e) {
        error_log('LENDA site_config: ' . $e->getMessage()); // tabela ainda não criada (rode o instalar.php)
        $linhas = [];
    }
    foreach ($linhas as $l) {
        try {
            $c[$l['chave']] = normalizarConfig((string) $l['chave'], json_decode((string) $l['valor'], true, 16, JSON_THROW_ON_ERROR));
        } catch (Throwable) {
            // valor estragado no banco: fica o padrão
        }
    }
    if ($apcu) {
        apcu_store($chaveApcu, $c, 10);
    }
    return $c;
}

function esquecerSiteConfig(): void
{
    if (function_exists('apcu_delete')) {
        @apcu_delete('lenda:site:' . md5((string) (config()['db']['dsn'] ?? '')));
    }
    siteConfig(true);
}

/** Grava uma linha de site_config (config ou estado interno, chave com _). */
function gravarSiteConfig(string $chave, mixed $valor, ?string $por): void
{
    sql('INSERT INTO site_config (chave, valor, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE valor = VALUES(valor), atualizado_em = VALUES(atualizado_em), atualizado_por = VALUES(atualizado_por)',
        [$chave, json($valor), dt(time()), $por]);
}

/** Estado interno guardado em site_config (chave começando com _): array ou null. */
function lerEstado(string $chave): ?array
{
    try {
        $v = umValor('SELECT valor FROM site_config WHERE chave = ?', [$chave]);
    } catch (PDOException) {
        return null;
    }
    $a = is_string($v) ? json_decode($v, true) : null;
    return is_array($a) ? $a : null;
}

/** Regras do convite de conta no formato do GET conta.php. */
function regrasPublicas(): array
{
    return siteConfig()['regras'];
}

/** O que o jogo precisa saber do site (sem nada secreto). */
function sitePublico(): array
{
    $c = siteConfig();
    return [
        'imersivoPublico' => $c['imersivo_publico'],
        'livePublica' => $c['live_publica'],
        'aviso' => $c['aviso'],
        'manutencao' => $c['manutencao'],
        'cadastroAberto' => $c['cadastro_aberto'],
        'bonus' => $c['bonus'],
    ];
}

// ── administrador: quem é e registro do que fez ──────────────────────────────────────────────────

/** 'painel' (cookie lenda_painel), 'token' (Authorization: Bearer) ou null. */
function adminLogado(): ?string
{
    if (cookiePainelValido()) {
        return 'painel';
    }
    return tokenAdminValido() ? 'token' : null;
}

function exigirAdmin(): string
{
    $a = adminLogado();
    if ($a === null) {
        erro(401, 'nao_logado', 'Entre com a senha do painel.');
    }
    return $a;
}

/** Escrita do admin: JSON sempre; Origin do site quando vem do painel (cookie). Com o Bearer não há CSRF. */
function exigirEscritaAdmin(string $via): void
{
    if ($via !== 'token') {
        exigirEscrita();
        return;
    }
    $ct = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? ''), 2)[0]));
    if ($ct !== 'application/json') {
        erro(403, 'origem', 'Pedido recusado.');
    }
}

/** Uma linha em admin_log (detalhes curtos: textos longos são cortados). */
function registrarAdmin(string $acao, ?string $alvo, array $detalhes = []): void
{
    $cortar = static function (mixed $v) use (&$cortar): mixed {
        if (is_string($v)) {
            return mb_substr($v, 0, 300, 'UTF-8');
        }
        if (is_array($v)) {
            return array_map($cortar, array_slice($v, 0, 40, true));
        }
        return $v;
    };
    $detalhes = ['via' => adminLogado() ?? 'sistema'] + $cortar($detalhes);
    $txt = json($detalhes);
    if (strlen($txt) > 8000) {
        $txt = json(['via' => $detalhes['via'], 'cortado' => true]);
    }
    sql('INSERT INTO admin_log (em, acao, alvo, detalhes) VALUES (?, ?, ?, ?)',
        [dt(time()), substr($acao, 0, 40), $alvo !== null ? mb_substr($alvo, 0, 80, 'UTF-8') : null, $txt]);
}

// ── código de convite ────────────────────────────────────────────────────────────────────────────

function codigoConviteNovo(): string
{
    $c = '';
    for ($i = 0; $i < 8; $i++) {
        $c .= LENDA_CONVITE_LETRAS[random_int(0, strlen(LENDA_CONVITE_LETRAS) - 1)];
    }
    return $c;
}

/** Código no formato certo (maiúsculo) ou null. */
function lerCodigoConvite(mixed $v): ?string
{
    if (!is_string($v)) {
        return null;
    }
    $c = strtoupper(trim($v));
    return preg_match('/^[' . LENDA_CONVITE_LETRAS . ']{8}$/', $c) ? $c : null;
}

/** O código da conta; cria um (único) se ela ainda não tem (conta de antes da v3). */
function garantirCodigoConvite(int $uid, ?string $atual): string
{
    if (is_string($atual) && $atual !== '') {
        return $atual;
    }
    for ($i = 0; $i < 10; $i++) {
        try {
            $n = sql('UPDATE usuarios SET codigo_convite = ? WHERE id = ? AND codigo_convite IS NULL', [codigoConviteNovo(), $uid])->rowCount();
        } catch (PDOException $e) {
            if (eChaveDuplicada($e)) {
                continue; // outro já tem esse código: sorteia outro
            }
            throw $e;
        }
        $c = umValor('SELECT codigo_convite FROM usuarios WHERE id = ?', [$uid]);
        if (is_string($c) && $c !== '') {
            return $c;
        }
        if ($n === 0) {
            break; // a conta não existe mais
        }
    }
    throw new RuntimeException('não consegui criar o código de convite');
}

/** Link de convite: a primeira origem da config + /lenda/?c=CODIGO. */
function linkConvite(string $codigo): string
{
    $o = '';
    foreach ((array) config()['origens'] as $x) {
        if (is_string($x) && $x !== '') {
            $o = rtrim($x, '/');
            break;
        }
    }
    return ($o !== '' ? $o : 'https://oprojeto.online') . LENDA_CAMINHO_COOKIE . '?c=' . $codigo;
}

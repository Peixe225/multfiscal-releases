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

/** Usuário do cookie (linha de `usuarios`) ou null. Renova a sessão depois de 7 dias. */
function usuarioLogado(bool $recarregar = false): ?array
{
    static $feito = false, $u = null;
    if ($feito && !$recarregar) {
        return $u;
    }
    $feito = true;
    $u = null;
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

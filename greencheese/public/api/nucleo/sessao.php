<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Sessão do painel: token aleatório de 32 bytes no cookie gc_painel (HttpOnly, SameSite=Strict, Secure no HTTPS,
// Path = pasta do site), guardado só com hash; 30 dias deslizando; no máximo 10 por usuário.
// CSRF: token por sessão (devolvido pelo admin-sessao), obrigatório no cabeçalho X-CSRF de todo POST do painel.

const GC_COOKIE = 'gc_painel';
const GC_SESSAO_DURA = 30 * 86400;
const GC_SESSOES_POR_USUARIO = 10;

/** Pasta do site a partir do SCRIPT_NAME ('/greencheese/api/index.php' → '/greencheese/'). */
function gc_caminho_site(): string
{
    $script = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_NAME'] ?? '/api/index.php'));
    $pasta = rtrim(dirname($script, 2), '/');
    return preg_match('#^[A-Za-z0-9_./~-]*$#', $pasta) ? $pasta . '/' : '/';
}

function gc_cookie(string $valor, int $expira): void
{
    if (headers_sent()) {
        return;
    }
    setcookie(GC_COOKIE, $valor, [
        'expires' => $expira,
        'path' => gc_caminho_site(),
        'secure' => gc_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function gc_cookie_apagar(): void
{
    gc_cookie('', time() - 86400);
}

/** Usuário da sessão deste pedido (preenchido por gc_sessao_atual). @return array<string, mixed>|null */
function gc_usuario_atual(?array $definir = null, bool $limpar = false): ?array
{
    static $u = null;
    if ($limpar) {
        $u = null;
    } elseif ($definir !== null) {
        $u = $definir;
    }
    return $u;
}

/**
 * Sessão válida do cookie (ou null). Desliza o prazo (no máximo uma escrita a cada 10 min).
 * @return array<string, mixed>|null
 */
function gc_sessao_atual(): ?array
{
    static $lida = false;
    static $sessao = null;
    if ($lida) {
        return $sessao;
    }
    $lida = true;
    $token = $_COOKIE[GC_COOKIE] ?? '';
    if (!is_string($token) || !preg_match('/^[0-9a-f]{64}$/', $token)) {
        if ($token !== '') {
            gc_cookie_apagar();
        }
        return null;
    }
    $agora = gc_agora();
    $s = gc_um(
        'SELECT s.id, s.usuario_id, s.csrf, s.visto_em, s.expira_em, u.login, u.nome, u.papel
           FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
          WHERE s.token_hash = ? AND s.expira_em > ?',
        [hash('sha256', $token), $agora],
    );
    if ($s === null) {
        gc_cookie_apagar();
        return null;
    }
    if ($agora - (int) $s['visto_em'] > 600) {
        gc_sql('UPDATE sessoes SET visto_em = ?, expira_em = ? WHERE id = ?', [$agora, $agora + GC_SESSAO_DURA, $s['id']]);
        gc_cookie($token, time() + GC_SESSAO_DURA);
    }
    $sessao = $s;
    gc_usuario_atual(['id' => (int) $s['usuario_id'], 'login' => (string) $s['login'], 'nome' => (string) $s['nome'], 'papel' => (string) $s['papel']]);
    return $sessao;
}

/**
 * Sessão nova (login, instalação, recuperação): token novo sempre — o de antes, se tinha, é apagado.
 * @return array{csrf: string}
 */
function gc_sessao_criar(int $usuarioId): array
{
    $agora = gc_agora();
    $antigo = $_COOKIE[GC_COOKIE] ?? '';
    if (is_string($antigo) && preg_match('/^[0-9a-f]{64}$/', $antigo)) {
        gc_sql('DELETE FROM sessoes WHERE token_hash = ?', [hash('sha256', $antigo)]);
    }
    $token = bin2hex(random_bytes(32));
    $csrf = bin2hex(random_bytes(32));
    $agente = substr(gc_texto($_SERVER['HTTP_USER_AGENT'] ?? '') ?? '', 0, 200);
    gc_sql(
        'INSERT INTO sessoes (usuario_id, token_hash, csrf, criado_em, visto_em, expira_em, agente) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$usuarioId, hash('sha256', $token), $csrf, $agora, $agora, $agora + GC_SESSAO_DURA, $agente],
    );
    // no máximo 10 por usuário: sai a menos usada
    gc_sql(
        'DELETE FROM sessoes WHERE usuario_id = ? AND id NOT IN (SELECT id FROM sessoes WHERE usuario_id = ? ORDER BY visto_em DESC, id DESC LIMIT ' . GC_SESSOES_POR_USUARIO . ')',
        [$usuarioId, $usuarioId],
    );
    gc_sql('DELETE FROM sessoes WHERE expira_em <= ?', [$agora]);
    gc_sql('UPDATE usuarios SET acesso_em = ? WHERE id = ?', [$agora, $usuarioId]);
    gc_cookie($token, time() + GC_SESSAO_DURA);
    $u = gc_um('SELECT id, login, nome, papel FROM usuarios WHERE id = ?', [$usuarioId]);
    gc_usuario_atual(['id' => (int) $u['id'], 'login' => (string) $u['login'], 'nome' => (string) $u['nome'], 'papel' => (string) $u['papel']]);
    return ['csrf' => $csrf];
}

/**
 * Exige o dono logado. Em POST, também a origem e o X-CSRF da sessão.
 * @return array<string, mixed> a sessão
 */
function gc_exigir_dono(): array
{
    $post = gc_metodo() === 'POST';
    if ($post) {
        gc_conferir_origem();
    }
    $s = gc_sessao_atual();
    if ($s === null) {
        throw new ErroApi('sem-sessao', 'Tua sessão acabou. Entra de novo.', 401);
    }
    if ($post) {
        $csrf = $_SERVER['HTTP_X_CSRF'] ?? '';
        if (!is_string($csrf) || !hash_equals((string) $s['csrf'], $csrf)) {
            throw new ErroApi('csrf', 'Recarrega a página e tenta de novo.', 403);
        }
    }
    return $s;
}

/** Usuário pra resposta. @return array{login: string, nome: string, papel: string} */
function gc_usuario_publico(): array
{
    $u = gc_usuario_atual() ?? [];
    return ['login' => (string) ($u['login'] ?? ''), 'nome' => (string) ($u['nome'] ?? ''), 'papel' => (string) ($u['papel'] ?? 'dono')];
}

function gc_instalado(): bool
{
    return gc_valor('SELECT 1 FROM usuarios LIMIT 1') !== null;
}

function gc_arquivo_instalacao(): string
{
    // em teste, outro arquivo (pra conferir a recuperação com um código novo sem mexer no do projeto)
    $teste = gc_teste() ? getenv('GC_INSTALACAO') : false;
    return is_string($teste) && $teste !== '' ? $teste : dirname(__DIR__) . '/instalacao.php';
}

/**
 * Hash do código de instalação (só o hash fica no instalacao.php). Lido como texto, sem executar: com o OPcache, um
 * instalacao.php recém-publicado podia continuar valendo o de antes por alguns segundos.
 */
function gc_hash_instalacao(): string
{
    $txt = (string) @file_get_contents(gc_arquivo_instalacao());
    return preg_match('/^return \'(\$2[aby]\$\d{2}\$[.\/A-Za-z0-9]{53})\';/m', $txt, $m) === 1 ? $m[1] : '';
}

/** O instalacao.php ainda é o de desenvolvimento (marcador // DEV)? */
function gc_instalacao_dev(): bool
{
    $txt = (string) @file_get_contents(gc_arquivo_instalacao());
    return preg_match('#^// DEV#m', $txt) === 1;
}

/** Código como a pessoa digitou → só letras e números minúsculos ("K7M2P-X9Q4R…" = "k7m2px9q4r…"). */
function gc_normalizar_codigo(mixed $v): string
{
    return is_string($v) ? (string) preg_replace('/[^a-z0-9]/', '', strtolower(substr($v, 0, 200))) : '';
}

/**
 * Confere o código de instalação. No ar, o código de desenvolvimento nunca vale (mesmo que alguém publique o
 * instalacao.php errado à mão).
 */
function gc_conferir_codigo(mixed $codigo): string
{
    gc_limite('codigo', gc_chave_limite('ip', gc_ip()), 10, 3600);
    $hash = gc_hash_instalacao();
    if (gc_instalacao_dev() && !gc_desenvolvimento()) {
        throw new ErroApi('codigo-de-desenvolvimento', 'Esse servidor tá com o código de desenvolvimento. Gere o código de instalação e publique de novo.', 403);
    }
    $c = gc_normalizar_codigo($codigo);
    if ($hash === '' || $c === '' || !password_verify($c, $hash)) {
        throw new ErroApi('codigo-invalido', 'Código de instalação não confere.', 403);
    }
    return $hash;
}

function gc_login(mixed $v): ?string
{
    if (!is_string($v)) {
        return null;
    }
    $l = strtolower(trim($v));
    return preg_match('/^[a-z0-9][a-z0-9._-]{2,31}$/', $l) ? $l : null;
}

function gc_senha_nova(mixed $v, string $campo = 'senha'): string
{
    if (!is_string($v) || !mb_check_encoding($v, 'UTF-8') || gc_tamanho($v) < 10) {
        throw gc_invalido($campo, 'Senha com pelo menos 10 caracteres.');
    }
    if (strlen($v) > 72) {
        throw gc_invalido($campo, 'Senha até 72 caracteres.');
    }
    return $v;
}

function gc_hash_senha(string $senha): string
{
    return password_hash($senha, PASSWORD_DEFAULT, ['cost' => 11]);
}

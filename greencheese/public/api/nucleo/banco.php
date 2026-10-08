<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Banco: SQLite num arquivo do privado (loja.sqlite), por PDO. Tudo que é específico do SQLite fica aqui
// (conexão, PRAGMA, BEGIN IMMEDIATE, INSERT OR IGNORE): para ir pro MySQL, troca este arquivo e as migrações.
// Hora em unix UTC (INTEGER); dinheiro em centavos (INTEGER).

/** .htaccess das pastas que a web nunca lê (privado/ e nucleo/). */
const GC_HTACCESS_NEGAR = <<<'HT'
# Nada desta pasta é servido pela web (banco, log, módulos).
Options -Indexes
<IfModule mod_authz_core.c>
  Require all denied
  <FilesMatch ".*">
    Require all denied
  </FilesMatch>
</IfModule>
<IfModule !mod_authz_core.c>
  Order allow,deny
  Deny from all
  <FilesMatch ".*">
    Order allow,deny
    Deny from all
  </FilesMatch>
</IfModule>

HT;

/** Cria a pasta (se faltar) e repõe o .htaccess (e o index.html vazio) dela, se alguém apagou. */
function gc_preparar_pasta(string $dir, string $htaccess, bool $indice = true): void
{
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
        throw new RuntimeException('não deu pra criar a pasta ' . basename($dir));
    }
    if (!is_file($dir . '/.htaccess')) {
        @file_put_contents($dir . '/.htaccess', $htaccess);
    }
    if ($indice && !is_file($dir . '/index.html')) {
        @file_put_contents($dir . '/index.html', "<!doctype html><meta charset=\"utf-8\"><title></title>\n");
    }
}

function gc_db(): PDO
{
    static $db = null;
    if ($db instanceof PDO) {
        return $db;
    }
    $dir = gc_pasta_dados();
    gc_preparar_pasta($dir, GC_HTACCESS_NEGAR);
    $novo = new PDO('sqlite:' . $dir . '/loja.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT => 5,
    ]);
    $novo->exec('PRAGMA busy_timeout = 5000');
    $novo->exec('PRAGMA journal_mode = WAL');
    $novo->exec('PRAGMA synchronous = NORMAL');
    $novo->exec('PRAGMA foreign_keys = ON');
    gc_migrar($novo);
    $db = $novo;
    return $db;
}

/**
 * Migrações em ordem; a posição + 1 é o PRAGMA user_version depois dela. Nunca edite uma que já foi pro ar:
 * acrescente outra no fim.
 * @return list<string>
 */
function gc_migracoes(): array
{
    return [
        <<<'SQL'
        CREATE TABLE ajustes (
          chave TEXT PRIMARY KEY,
          valor TEXT NOT NULL,
          atualizado_em INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE usuarios (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          login TEXT NOT NULL UNIQUE,
          nome TEXT NOT NULL,
          senha_hash TEXT NOT NULL,
          papel TEXT NOT NULL DEFAULT 'dono',
          criado_em INTEGER NOT NULL,
          senha_em INTEGER NOT NULL,
          acesso_em INTEGER
        );
        CREATE TABLE sessoes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          csrf TEXT NOT NULL,
          criado_em INTEGER NOT NULL,
          visto_em INTEGER NOT NULL,
          expira_em INTEGER NOT NULL,
          agente TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX sessoes_usuario ON sessoes(usuario_id, visto_em);
        CREATE TABLE tentativas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tipo TEXT NOT NULL,
          chave TEXT NOT NULL,
          em INTEGER NOT NULL
        );
        CREATE INDEX tentativas_busca ON tentativas(tipo, chave, em);
        CREATE INDEX tentativas_em ON tentativas(em);
        CREATE TABLE eventos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          em INTEGER NOT NULL,
          usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
          origem TEXT NOT NULL,
          acao TEXT NOT NULL,
          alvo TEXT NOT NULL DEFAULT '',
          detalhe TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX eventos_em ON eventos(em);
        CREATE TABLE rateios (
          id TEXT PRIMARY KEY,
          titulo TEXT NOT NULL,
          descricao TEXT NOT NULL DEFAULT '',
          produto_id TEXT,
          imagem TEXT,
          preco_rateio INTEGER NOT NULL CHECK (preco_rateio > 0),
          preco_depois INTEGER CHECK (preco_depois IS NULL OR preco_depois > 0),
          vagas INTEGER NOT NULL CHECK (vagas > 0),
          limite_por_pessoa INTEGER NOT NULL DEFAULT 1 CHECK (limite_por_pessoa > 0),
          ufs TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('rascunho','aberto','fechado','pedido','caminho','chegou','encerrado','cancelado')),
          previsao_min INTEGER NOT NULL DEFAULT 6,
          previsao_max INTEGER NOT NULL DEFAULT 10,
          fecha_em INTEGER,
          reserva_horas INTEGER NOT NULL DEFAULT 24,
          demo INTEGER NOT NULL DEFAULT 0,
          criado_em INTEGER NOT NULL,
          atualizado_em INTEGER NOT NULL,
          aberto_em INTEGER,
          fechado_em INTEGER,
          pedido_em INTEGER,
          caminho_em INTEGER,
          chegou_em INTEGER,
          encerrado_em INTEGER,
          cancelado_em INTEGER
        );
        CREATE INDEX rateios_status ON rateios(status);
        CREATE TABLE participacoes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rateio_id TEXT NOT NULL REFERENCES rateios(id) ON DELETE CASCADE,
          codigo TEXT NOT NULL UNIQUE,
          token_hash TEXT NOT NULL UNIQUE,
          nome TEXT NOT NULL,
          whatsapp TEXT NOT NULL,
          uf TEXT NOT NULL,
          cidade TEXT NOT NULL DEFAULT '',
          quantidade INTEGER NOT NULL CHECK (quantidade > 0),
          preco_unit INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('reservado','confirmado','expirado','cancelado','entregue')),
          origem TEXT NOT NULL,
          observacao TEXT NOT NULL DEFAULT '',
          criado_em INTEGER NOT NULL,
          atualizado_em INTEGER NOT NULL,
          expira_em INTEGER,
          confirmado_em INTEGER,
          confirmado_por TEXT,
          cancelado_em INTEGER,
          entregue_em INTEGER,
          expirado_em INTEGER
        );
        CREATE INDEX participacoes_rateio ON participacoes(rateio_id, status);
        CREATE INDEX participacoes_whatsapp ON participacoes(rateio_id, whatsapp);
        CREATE INDEX participacoes_reserva ON participacoes(status, expira_em);
        SQL,
    ];
}

function gc_migrar(PDO $db): void
{
    $migracoes = gc_migracoes();
    $total = count($migracoes);
    if ((int) $db->query('PRAGMA user_version')->fetchColumn() >= $total) {
        return;
    }
    $db->exec('BEGIN IMMEDIATE');
    try {
        // de novo, já com a trava: outro pedido pode ter migrado enquanto este esperava
        $versao = (int) $db->query('PRAGMA user_version')->fetchColumn();
        for ($i = $versao; $i < $total; $i++) {
            $db->exec($migracoes[$i]);
        }
        $db->exec('PRAGMA user_version = ' . $total);
        $db->exec('COMMIT');
    } catch (Throwable $e) {
        $db->exec('ROLLBACK');
        throw $e;
    }
}

/**
 * Transação de escrita com a trava pega no começo (BEGIN IMMEDIATE): quem chega depois espera a vez
 * (busy_timeout) em vez de ler um contador velho. Chamada dentro de outra, só roda a função.
 * @template T
 * @param callable(PDO): T $f
 * @return T
 */
function gc_transacao(callable $f): mixed
{
    static $nivel = 0;
    $db = gc_db();
    if ($nivel > 0) {
        return $f($db);
    }
    $db->exec('BEGIN IMMEDIATE');
    $nivel++;
    try {
        $r = $f($db);
        $db->exec('COMMIT');
        return $r;
    } catch (Throwable $e) {
        try {
            $db->exec('ROLLBACK');
        } catch (Throwable) {
            // a transação já caiu
        }
        throw $e;
    } finally {
        $nivel--;
    }
}

/** @param array<int|string, mixed> $p */
function gc_sql(string $sql, array $p = []): PDOStatement
{
    $st = gc_db()->prepare($sql);
    $st->execute($p);
    return $st;
}

/**
 * @param array<int|string, mixed> $p
 * @return array<string, mixed>|null
 */
function gc_um(string $sql, array $p = []): ?array
{
    $l = gc_sql($sql, $p)->fetch();
    return is_array($l) ? $l : null;
}

/**
 * @param array<int|string, mixed> $p
 * @return list<array<string, mixed>>
 */
function gc_todos(string $sql, array $p = []): array
{
    return gc_sql($sql, $p)->fetchAll();
}

/** @param array<int|string, mixed> $p */
function gc_valor(string $sql, array $p = []): mixed
{
    $v = gc_sql($sql, $p)->fetchColumn();
    return $v === false ? null : $v;
}

/** @param array<int|string, mixed> $p */
function gc_inserir(string $sql, array $p = []): int
{
    gc_sql($sql, $p);
    return (int) gc_db()->lastInsertId();
}

function gc_ajuste(string $chave): ?string
{
    $v = gc_valor('SELECT valor FROM ajustes WHERE chave = ?', [$chave]);
    return $v === null ? null : (string) $v;
}

function gc_ajuste_definir(string $chave, string $valor): void
{
    gc_sql(
        'INSERT INTO ajustes (chave, valor, atualizado_em) VALUES (?, ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em',
        [$chave, $valor, gc_agora()],
    );
}

/** Sal do servidor (nasce no primeiro acesso): o IP só vira chave de limite com ele, nunca guardado puro. */
function gc_sal(): string
{
    static $sal = null;
    if (is_string($sal)) {
        return $sal;
    }
    $v = gc_ajuste('sal');
    if ($v === null) {
        gc_sql('INSERT OR IGNORE INTO ajustes (chave, valor, atualizado_em) VALUES (?, ?, ?)', ['sal', bin2hex(random_bytes(32)), gc_agora()]);
        $v = (string) gc_ajuste('sal');
    }
    $sal = $v;
    return $sal;
}

/**
 * Auditoria: quem fez o quê. Origem: 'painel' (o dono), 'site' (cliente), 'pix' (webhook) ou 'sistema'.
 * @param array<string, mixed> $detalhe
 */
function gc_evento(string $origem, string $acao, string $alvo = '', array $detalhe = [], ?int $usuarioId = null): void
{
    if ($usuarioId === null && $origem === 'painel') {
        $usuarioId = gc_usuario_atual()['id'] ?? null;
    }
    gc_sql(
        'INSERT INTO eventos (em, usuario_id, origem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?, ?)',
        [gc_agora(), $usuarioId, $origem, $acao, $alvo, json_encode($detalhe, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE)],
    );
}

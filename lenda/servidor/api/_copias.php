<?php
/**
 * LENDA · backup (P1-15) e cópias no servidor com restauração (O3/O4). CONTRATO-v32 §B. Usado pelo equipe.php e pelo
 * painel.php (a cópia diária). Nunca é servido (o .htaccess nega _*.php).
 *
 * Formato (o mesmo no download e nas cópias): JSON comprimido em gzip, escrito em pedaços (cada pedaço é um membro
 * gzip; membros concatenados são um gzip válido), com uma linha por registro para a restauração ler sem carregar
 * tudo na memória:
 *   {"versao":1,"geradoEm":"…","medicao":false,"binarios":{"carreiras":["dados"]},"tabelas":{
 *   "usuarios":[
 *   {…},
 *   {…}
 *   ],
 *   "carreiras":[
 *   …
 *   ]
 *   },"contagem":{"usuarios":2,…}}
 * Entra: contas, carreiras (dados em base64), conquistas, indicações, bônus, denúncias, decisões de moderação,
 * partidas por aparelho, vínculo aparelho-conta, a config do site (sem o estado interno), a lixeira (com a cópia, em
 * base64, desde a rev3; os backups de antes vêm sem ela), as marcas das contas excluídas, o registro do admin (90 dias),
 * a equipe (sem senha nem PIN), os papéis e os recados; com medicao=1, as visitas e os eventos dos últimos 30 dias. Fica
 * de fora: sessões, códigos de troca de senha, tentativas e o arquivo de config.
 *
 * Cópias no servidor: numa pasta FORA do public_html, ao lado do arquivo de config (lenda-copias/) ou em backup_pasta
 * (config). No máximo 10; uma diária (a primeira carga do painel no dia). Restaurar: só um arquivo dessa pasta (o nome
 * conferido contra a listagem, nunca um caminho vindo do pedido), sempre depois de guardar uma cópia
 * "antes-de-restaurar" do estado atual, numa transação, e as contas da equipe nunca voltam com senha.
 */
declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

const COPIAS_MAX = 10;
const BACKUP_VERSAO = 1;
const COPIA_NOME_RE = '/^[a-z0-9][a-z0-9._-]{0,120}\.json\.gz$/';
const COPIA_MAX_BYTES = 1024 * 1024 * 1024;   // 1 GB comprimido
const COPIA_MAX_LINHA = 32 * 1024 * 1024;     // um registro (carreira em base64) cabe com folga
const COPIA_PEDACO = 256 * 1024;              // cada membro gzip
/** Tabelas que a restauração "substituir" apaga e regrava (as outras só completam o que falta). */
const COPIA_SUBSTITUIVEIS = ['usuarios', 'carreiras', 'conquistas_usuario', 'indicacoes', 'bonus', 'denuncias', 'carreiras_moderacao',
    'partidas_vid', 'visitantes_usuarios', 'site_config', 'lixeira_carreiras', 'admin_papeis', 'admin_recados'];
const COPIA_SO_COMPLETAR = ['admin_log', 'admin_contas', 'visitas', 'eventos', 'contas_excluidas'];
/** Colunas binárias que vão em base64 (as únicas aceitas no "binarios" do arquivo). */
const COPIA_BINARIOS = ['carreiras' => ['dados'], 'lixeira_carreiras' => ['dados']];

/** Quantas cópias ficam na pasta (config copias_max, 1 a 30; padrão 10). */
function copiasMax(): int
{
    $n = config()['copias_max'] ?? COPIAS_MAX;
    return is_int($n) ? max(1, min(30, $n)) : COPIAS_MAX;
}

/**
 * O que entra no backup, na ordem: [tabela, chave (colunas, para ler em lotes), condição extra|null, colunas que
 * ficam de fora, tamanho do lote].
 */
function backupTabelas(bool $medicao): array
{
    $t = time();
    $l = [
        ['usuarios', ['id'], null, [], 1000],
        ['carreiras', ['id'], null, [], 100],
        ['conquistas_usuario', ['usuario_id', 'conquista_id'], null, [], 1000],
        ['indicacoes', ['id'], null, [], 1000],
        ['bonus', ['id'], null, [], 1000],
        ['denuncias', ['id'], null, [], 1000],
        ['carreiras_moderacao', ['usuario_id', 'carreira_id'], null, [], 1000],
        ['partidas_vid', ['vid'], null, [], 1000],
        ['visitantes_usuarios', ['vid'], null, [], 1000],
        ['site_config', ['chave'], ["LEFT(chave, 1) <> '_'", []], [], 200],
        // rev3: com a cópia (dados, em base64): o "substituir" de um backup recente não perde as carreiras restauráveis
        ['lixeira_carreiras', ['id'], null, [], 100],
        ['contas_excluidas', ['usuario_id'], null, [], 1000],
        ['admin_log', ['id'], ['em >= ?', [dt($t - 90 * 86400)]], [], 1000],
        ['admin_contas', ['id'], null, ['senha_hash', 'pin_hash'], 1000],
        ['admin_papeis', ['chave'], null, [], 1000],
        ['admin_recados', ['id'], null, [], 1000],
    ];
    if ($medicao) {
        $l[] = ['visitas', ['sid'], ['inicio >= ?', [dt($t - 30 * 86400)]], [], 1000];
        $l[] = ['eventos', ['id'], ['em >= ?', [dt($t - 30 * 86400)]], [], 1000];
    }
    return $l;
}

/** Tabelas que existem no banco agora. */
function tabelasDoBanco(): array
{
    return array_map('strval', bd()->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
}

/** Colunas de uma tabela (nomes vindos do próprio banco). */
function colunasDaTabela(string $tabela): array
{
    return array_map('strval', bd()->query('SHOW COLUMNS FROM `' . str_replace('`', '', $tabela) . '`')->fetchAll(PDO::FETCH_COLUMN));
}

/**
 * Escreve o backup em pedaços de texto ($saida recebe cada pedaço; quem chama comprime). Devolve a contagem por tabela.
 */
function escreverBackup(callable $saida, bool $medicao): array
{
    // uma fotografia só do banco inteiro (leitura consistente do InnoDB, sem travar quem escreve)
    $snapshot = !bd()->inTransaction();
    if ($snapshot) {
        bd()->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    }
    try {
        return escreverBackupDentro($saida, $medicao);
    } finally {
        if ($snapshot) {
            bd()->exec('COMMIT');
        }
    }
}

/**
 * "Depois desta chave" para ler em lotes: [sql, params]. Chave composta na forma expandida (a > ? OR (a = ? AND b > ?)),
 * que o MariaDB e o MySQL leem como uma faixa do índice; a comparação de linha (a, b) > (?, ?) lia o índice desde o
 * começo a cada lote (backup quadrático: 1 milhão de conquistas levava ~75 s).
 */
function depoisDaChave(array $chave, array $ultimo): array
{
    $ou = [];
    $params = [];
    foreach (array_values($chave) as $i => $c) {
        $e = [];
        for ($k = 0; $k < $i; $k++) {
            $e[] = '`' . $chave[$k] . '` = ?';
            $params[] = $ultimo[$k];
        }
        $e[] = '`' . $c . '` > ?';
        $params[] = $ultimo[$i];
        $ou[] = count($e) === 1 ? $e[0] : '(' . implode(' AND ', $e) . ')';
    }
    return [count($ou) === 1 ? $ou[0] : '(' . implode(' OR ', $ou) . ')', $params];
}

function escreverBackupDentro(callable $saida, bool $medicao): array
{
    $existem = tabelasDoBanco();
    $specs = array_values(array_filter(backupTabelas($medicao), static fn(array $s): bool => in_array($s[0], $existem, true)));
    $binarios = [];
    foreach ($specs as $s) {
        foreach (COPIA_BINARIOS[$s[0]] ?? [] as $b) {
            if (!in_array($b, $s[3], true)) {
                $binarios[$s[0]][] = $b;
            }
        }
    }
    $buf = json(['versao' => BACKUP_VERSAO, 'geradoEm' => gmdate('Y-m-d\TH:i:s\Z'), 'medicao' => $medicao,
        'binarios' => (object) $binarios]);
    $buf = substr($buf, 0, -1) . ',"tabelas":{' . "\n";
    $contagem = [];
    foreach ($specs as $i => [$tabela, $chave, $cond, $fora, $lote]) {
        $cols = array_values(array_diff(colunasDaTabela($tabela), $fora));
        $bin = $binarios[$tabela] ?? [];
        $lista = implode(', ', array_map(static fn(string $c): string => '`' . $c . '`', $cols));
        $chaveSql = implode(', ', array_map(static fn(string $c): string => '`' . $c . '`', $chave));
        $buf .= json($tabela) . ":[\n";
        $n = 0;
        $pendente = null;
        $ultimo = null;
        while (true) {
            $onde = [];
            $params = [];
            if ($cond !== null) {
                $onde[] = $cond[0];
                array_push($params, ...$cond[1]);
            }
            if ($ultimo !== null) {
                [$depois, $pDepois] = depoisDaChave($chave, $ultimo);
                $onde[] = $depois;
                array_push($params, ...$pDepois);
            }
            $w = $onde ? ' WHERE ' . implode(' AND ', $onde) : '';
            $linhas = sql("SELECT $lista FROM `$tabela`$w ORDER BY $chaveSql LIMIT " . (int) $lote, $params)->fetchAll();
            foreach ($linhas as $l) {
                foreach ($bin as $b) {
                    if (isset($l[$b]) && is_string($l[$b])) {
                        $l[$b] = base64_encode($l[$b]);
                    }
                }
                if ($pendente !== null) {
                    $buf .= $pendente . ",\n";
                }
                $pendente = json($l);
                $n++;
                $ultimo = array_map(static fn(string $c) => $l[$c], $chave);
                if (strlen($buf) >= COPIA_PEDACO) {
                    $saida($buf);
                    $buf = '';
                }
            }
            if (count($linhas) < $lote) {
                break;
            }
        }
        if ($pendente !== null) {
            $buf .= $pendente . "\n";
        }
        $buf .= ($i === count($specs) - 1 ? ']' : '],') . "\n";
        $contagem[$tabela] = $n;
    }
    $buf .= '},"contagem":' . json((object) $contagem) . "}\n";
    $saida($buf);
    return $contagem;
}

/**
 * Lê um arquivo de backup linha a linha, conferindo tudo (versão, tabelas, cada registro, a contagem do fim). Com
 * $porRegistro, chama $porRegistro($tabela, $registro) a cada um (os binários já decodificados). Estragado:
 * RuntimeException com o motivo (pt-BR). Devolve ['cabecalho' => …, 'contagem' => [tabela => n]].
 */
function lerBackup(string $arquivo, ?callable $porRegistro = null): array
{
    $gz = null;
    $falhar = static function (string $m): never {
        throw new RuntimeException($m);
    };
    try {
        $gz = gzopen($arquivo, 'rb');
        if ($gz === false) {
            $falhar('não abre como gzip');
        }
        $estado = 'cabecalho';
        $cab = null;
        $tabela = null;
        $lidos = [];
        $contagem = null;
        $nLinha = 0;
        $binarios = [];
        while (true) {
            $l = gzgets($gz, COPIA_MAX_LINHA);
            if ($l === false) {
                break;
            }
            $nLinha++;
            if (!str_ends_with($l, "\n")) {
                if (strlen($l) >= COPIA_MAX_LINHA - 1) {
                    $falhar("linha $nLinha grande demais");
                }
            }
            $l = rtrim($l, "\r\n");
            if ($estado === 'fim') {
                if ($l !== '') {
                    $falhar("texto depois do fim (linha $nLinha)");
                }
                continue;
            }
            if ($estado === 'cabecalho') {
                if (!str_starts_with($l, '{"versao":') || !str_ends_with($l, ',"tabelas":{')) {
                    $falhar('o começo do arquivo não é de um backup do LENDA');
                }
                $cab = json_decode(substr($l, 0, -strlen(',"tabelas":{')) . '}', true);
                if (!is_array($cab) || ($cab['versao'] ?? null) !== BACKUP_VERSAO || !is_string($cab['geradoEm'] ?? null)) {
                    $falhar('versão do backup desconhecida');
                }
                foreach ((array) ($cab['binarios'] ?? []) as $t => $cols) {
                    if (!is_string($t) || !is_array($cols)) {
                        $falhar('lista de colunas binárias estragada');
                    }
                    foreach ($cols as $c) {
                        if (!in_array($c, COPIA_BINARIOS[$t] ?? [], true)) {
                            $falhar('coluna binária desconhecida');
                        }
                    }
                    $binarios[$t] = $cols;
                }
                $estado = 'tabelas';
                continue;
            }
            if ($estado === 'tabelas') {
                if (preg_match('/^"([a-z_]{1,40})":\[$/', $l, $m)) {
                    $tabela = $m[1];
                    if (isset($lidos[$tabela])) {
                        $falhar("tabela $tabela repetida");
                    }
                    $lidos[$tabela] = 0;
                    $estado = 'registros';
                    continue;
                }
                if (preg_match('/^\},"contagem":(\{.*\})\}$/', $l, $m)) {
                    $contagem = json_decode($m[1], true);
                    if (!is_array($contagem)) {
                        $falhar('contagem do fim estragada');
                    }
                    $estado = 'fim';
                    continue;
                }
                $falhar("linha $nLinha inesperada");
            }
            // registros de $tabela
            if ($l === ']' || $l === '],') {
                $estado = 'tabelas';
                $tabela = null;
                continue;
            }
            if (!str_starts_with($l, '{')) {
                $falhar("registro estragado na linha $nLinha");
            }
            $r = json_decode(rtrim($l, ','), true);
            if (!is_array($r) || ($r !== [] && array_is_list($r))) {
                $falhar("registro estragado na linha $nLinha");
            }
            foreach ($binarios[$tabela] ?? [] as $b) {
                if (isset($r[$b])) {
                    $dec = is_string($r[$b]) ? base64_decode($r[$b], true) : false;
                    if ($dec === false) {
                        $falhar("binário estragado na linha $nLinha");
                    }
                    $r[$b] = $dec;
                }
            }
            $lidos[$tabela]++;
            if ($porRegistro !== null) {
                $porRegistro($tabela, $r);
            }
        }
        if ($estado !== 'fim') {
            $falhar('o arquivo está cortado (falta o fim)');
        }
        foreach ($lidos as $t => $n) {
            if ((int) ($contagem[$t] ?? -1) !== $n) {
                $falhar("a contagem de $t não confere");
            }
        }
        if (count($contagem) !== count($lidos)) {
            $falhar('a contagem do fim não confere com as tabelas');
        }
        return ['cabecalho' => $cab, 'contagem' => $lidos];
    } catch (RuntimeException $e) {
        throw $e;
    } catch (Throwable $e) {
        throw new RuntimeException('não abre como gzip (' . mb_substr($e->getMessage(), 0, 80) . ')');
    } finally {
        if (is_resource($gz)) {
            @gzclose($gz);
        }
    }
}

// ── a pasta das cópias ───────────────────────────────────────────────────────────────────────────

/** O arquivo de config em uso (a mesma ordem de busca do config()), ou null. */
function arquivoConfigEmUso(): ?string
{
    $caminhos = [];
    $env = getenv('LENDA_CONFIG');
    if (is_string($env) && $env !== '') {
        $caminhos[] = $env;
    }
    $caminhos[] = dirname(__DIR__, 3) . '/lenda-config.php';
    $caminhos[] = dirname(__DIR__, 2) . '/lenda-config.php';
    $caminhos[] = __DIR__ . '/_config.php';
    foreach ($caminhos as $p) {
        if (@is_file($p) && @is_readable($p)) {
            return $p;
        }
    }
    return null;
}

/** O caminho fica dentro de uma pasta servida pela web? */
function dentroDaWeb(string $caminho): bool
{
    $raizes = [dirname(__DIR__)];
    $doc = $_SERVER['DOCUMENT_ROOT'] ?? '';
    if (is_string($doc) && $doc !== '') {
        $raizes[] = $doc;
    } else {
        $raizes[] = dirname(__DIR__, 2);
    }
    foreach ($raizes as $r) {
        $r = @realpath($r);
        if ($r !== false && ($caminho === $r || str_starts_with($caminho, rtrim($r, '/') . '/'))) {
            return true;
        }
    }
    return false;
}

/**
 * A pasta das cópias: ['ok' => bool, 'pasta' => ?string, 'motivo' => ?string]. Cria se não existe (0700, com um
 * .htaccess que nega tudo, por garantia). Nunca dentro do public_html.
 */
function pastaCopias(): array
{
    static $r = null;
    if ($r !== null) {
        return $r;
    }
    $cfg = config()['backup_pasta'] ?? null;
    if (is_string($cfg) && $cfg !== '') {
        if (!str_starts_with($cfg, '/') || str_contains($cfg, '..') || str_contains($cfg, "\0")) {
            return $r = ['ok' => false, 'pasta' => null, 'motivo' => 'backup_pasta da config tem de ser um caminho absoluto, sem "..".'];
        }
        $pasta = rtrim($cfg, '/');
    } else {
        $arq = arquivoConfigEmUso();
        if ($arq === null) {
            return $r = ['ok' => false, 'pasta' => null, 'motivo' => 'Arquivo de config não encontrado.'];
        }
        $pasta = dirname((string) realpath($arq)) . '/lenda-copias';
    }
    $pai = @realpath(dirname($pasta));
    if ($pai === false) {
        return $r = ['ok' => false, 'pasta' => null, 'motivo' => 'A pasta de cima das cópias não existe.'];
    }
    $pasta = $pai . '/' . basename($pasta);
    if (dentroDaWeb($pasta)) {
        return $r = ['ok' => false, 'pasta' => null,
            'motivo' => 'As cópias precisam de uma pasta fora do public_html: ponha o arquivo de config fora dele (LEIAME §3) ou defina backup_pasta.'];
    }
    if (!is_dir($pasta) && !@mkdir($pasta, 0700, true) && !is_dir($pasta)) {
        return $r = ['ok' => false, 'pasta' => null, 'motivo' => 'Não consegui criar a pasta das cópias (permissão).'];
    }
    if (is_link($pasta) || !is_writable($pasta)) {
        return $r = ['ok' => false, 'pasta' => null, 'motivo' => 'A pasta das cópias não aceita gravação (permissão).'];
    }
    if (!is_file($pasta . '/.htaccess')) {
        @file_put_contents($pasta . '/.htaccess', "Require all denied\nDeny from all\n");
    }
    if (!is_file($pasta . '/index.html')) {
        @file_put_contents($pasta . '/index.html', '');
    }
    return $r = ['ok' => true, 'pasta' => $pasta, 'motivo' => null];
}

/** Tipo da cópia pelo nome (diaria, manual, antes = antes de restaurar; outro = arquivo posto na pasta à mão). */
function tipoDaCopia(string $nome): string
{
    return preg_match('/-(diaria|manual|antes)-[0-9a-f]{8}\.json\.gz$/', $nome, $m) ? $m[1] : 'outro';
}

/** Cópias na pasta: [{arquivo, tipo, em, bytes}], da mais nova para a mais velha. */
function listarCopias(): array
{
    $p = pastaCopias();
    if (!$p['ok']) {
        return [];
    }
    $itens = [];
    foreach (scandir($p['pasta']) ?: [] as $nome) {
        $c = $p['pasta'] . '/' . $nome;
        if (!preg_match(COPIA_NOME_RE, $nome) || is_link($c) || !is_file($c)) {
            continue;
        }
        $itens[] = ['arquivo' => $nome, 'tipo' => tipoDaCopia($nome), 'em' => gmdate('Y-m-d\TH:i:s\Z', (int) filemtime($c)),
            'bytes' => (int) filesize($c), '_t' => (int) filemtime($c)];
    }
    usort($itens, static fn(array $a, array $b): int => [$b['_t'], $b['arquivo']] <=> [$a['_t'], $a['arquivo']]);
    return array_map(static function (array $i): array {
        unset($i['_t']);
        return $i;
    }, $itens);
}

/** Caminho de uma cópia pelo nome, só se ele está na listagem da pasta (nunca um caminho vindo do pedido). */
function resolverCopia(mixed $nome): ?string
{
    if (!is_string($nome) || !preg_match(COPIA_NOME_RE, $nome)) {
        return null;
    }
    $p = pastaCopias();
    if (!$p['ok'] || !in_array($nome, array_column(listarCopias(), 'arquivo'), true)) {
        return null;
    }
    $c = $p['pasta'] . '/' . $nome;
    $real = @realpath($c);
    if ($real === false || $real !== $c || is_link($c) || !is_file($c)) {
        return null;
    }
    return $c;
}

/**
 * Guarda uma cópia na pasta (gravada num temporário e renomeada) e deixa só as 10 mais novas (copias_max). $proteger:
 * o nome de uma cópia que não pode sair na rotação (a que está sendo restaurada).
 */
function guardarCopia(string $tipo, bool $medicao = false, ?string $proteger = null): array
{
    $p = pastaCopias();
    if (!$p['ok']) {
        throw new RuntimeException((string) $p['motivo']);
    }
    @set_time_limit(300);
    // data e hora de Brasília com os microssegundos: na mesma hora, o nome continua em ordem (a rotação depende disso)
    $agora = microtime(true);
    $nome = 'lenda-copia-' . gmdate('Ymd-His', (int) $agora - LENDA_FUSO_H * 3600) . '-' . sprintf('%06d', (int) (($agora - floor($agora)) * 1e6))
        . '-' . $tipo . '-' . bin2hex(random_bytes(4)) . '.json.gz';
    $tmp = $p['pasta'] . '/.tmp-' . bin2hex(random_bytes(8));
    $fh = @fopen($tmp, 'xb');
    if ($fh === false) {
        throw new RuntimeException('Não consegui gravar na pasta das cópias.');
    }
    try {
        @chmod($tmp, 0600);
        $contagem = escreverBackup(static function (string $pedaco) use ($fh): void {
            if (fwrite($fh, (string) gzencode($pedaco, 6)) === false) {
                throw new RuntimeException('Não consegui gravar a cópia (disco cheio?).');
            }
        }, $medicao);
        fclose($fh);
        $fh = null;
        if (!@rename($tmp, $p['pasta'] . '/' . $nome)) {
            throw new RuntimeException('Não consegui gravar a cópia.');
        }
    } catch (Throwable $e) {
        if (is_resource($fh)) {
            fclose($fh);
        }
        @unlink($tmp);
        throw $e instanceof RuntimeException ? $e : new RuntimeException('Não consegui gravar a cópia.');
    }
    $todas = array_values(array_filter(listarCopias(), static fn(array $c): bool => $c['arquivo'] !== $proteger));
    foreach (array_slice($todas, max(0, copiasMax() - ($proteger !== null ? 1 : 0))) as $velha) {
        @unlink($p['pasta'] . '/' . $velha['arquivo']);
    }
    return ['arquivo' => $nome, 'bytes' => (int) filesize($p['pasta'] . '/' . $nome), 'linhas' => array_sum($contagem), 'contagem' => $contagem];
}

/** A cópia diária, na primeira carga do painel no dia (Brasília). Silenciosa: falha só vai para o log. */
function copiaDiariaTalvez(): void
{
    $hoje = diaBrasilia();
    if ((config()['copias_diaria'] ?? true) === false) {
        return; // desligada na config
    }
    if ((lerEstado('_copia_diaria')['dia'] ?? '') === $hoje || !pegarTrava('lenda_copia', 0)) {
        return;
    }
    try {
        if ((lerEstado('_copia_diaria')['dia'] ?? '') === $hoje) {
            return;
        }
        $estado = ['dia' => $hoje, 'em' => gmdate('Y-m-d\TH:i:s\Z'), 'ok' => false];
        gravarSiteConfig('_copia_diaria', $estado, 'sistema');
        $p = pastaCopias();
        if (!$p['ok']) {
            gravarSiteConfig('_copia_diaria', $estado + ['motivo' => $p['motivo']], 'sistema');
            return;
        }
        $r = guardarCopia('diaria');
        gravarSiteConfig('_copia_diaria', ['ok' => true, 'arquivo' => $r['arquivo']] + $estado, 'sistema');
        registrarAdmin('backup_guardar', 'copia', ['tipo' => 'diaria', 'arquivo' => $r['arquivo'], 'linhas' => $r['linhas']], 'sistema');
    } catch (Throwable $e) {
        error_log('LENDA cópia diária: ' . $e->getMessage());
    } finally {
        soltarTrava('lenda_copia');
    }
}

// ── restaurar ────────────────────────────────────────────────────────────────────────────────────

/**
 * Restaura uma cópia da pasta. $modo: "completar" (só acrescenta o que falta, nada é apagado) ou "substituir" (as
 * tabelas de dados do arquivo voltam a ser exatamente as dele; o registro do admin, a equipe e a medição só
 * completam). Antes: confere o arquivo inteiro e guarda uma cópia "antes" do estado atual. Tudo numa transação.
 * Contas da equipe voltam desativadas e sem senha (quem cuida da equipe dá uma senha provisória). Contas de jogador
 * excluídas pelo admin depois da cópia não voltam.
 */
function restaurarCopia(string $caminho, string $modo): array
{
    @set_time_limit(600);
    $conf = lerBackup($caminho); // 1ª passada: só confere (estragado → RuntimeException, nada mudou)
    $antes = guardarCopia('antes', false, basename($caminho));
    $existem = tabelasDoBanco();
    $colunas = [];
    foreach (array_keys($conf['contagem']) as $t) {
        if (in_array($t, $existem, true) && (in_array($t, COPIA_SUBSTITUIVEIS, true) || in_array($t, COPIA_SO_COMPLETAR, true))) {
            $colunas[$t] = colunasDaTabela($t);
        }
    }
    // contas de jogador excluídas (LGPD), pelo próprio jogador ou pelo admin: ficam de fora, com tudo o que é delas. A
    // marca vem de contas_excluidas (rev3) e, para as de antes dela, do registro do admin (excluir_usuario).
    $excluidas = [];
    foreach (sql("SELECT alvo FROM admin_log WHERE acao = 'excluir_usuario' AND alvo LIKE 'usuario:%'")->fetchAll(PDO::FETCH_COLUMN) as $a) {
        if (preg_match('/^usuario:(\d+)$/', (string) $a, $m)) {
            $excluidas[(int) $m[1]] = true;
        }
    }
    if (in_array('contas_excluidas', $existem, true)) {
        foreach (sql('SELECT usuario_id FROM contas_excluidas')->fetchAll(PDO::FETCH_COLUMN) as $id) {
            $excluidas[(int) $id] = true;
        }
    }
    $gravadas = [];
    $puladas = 0;
    transacao(static function () use ($caminho, $modo, $colunas, $excluidas, &$gravadas, &$puladas): void {
        $gravadas = [];
        $puladas = 0;
        if ($modo === 'substituir') {
            foreach (array_keys($colunas) as $t) {
                if ($t === 'site_config') {
                    sql("DELETE FROM site_config WHERE LEFT(chave, 1) <> '_'");
                } elseif ($t === 'lixeira_carreiras') {
                    continue; // rev3: regravada linha a linha (abaixo), sem perder a cópia que o arquivo não tem
                } elseif (in_array($t, COPIA_SUBSTITUIVEIS, true)) {
                    sql("DELETE FROM `$t`");
                }
            }
            sql('DELETE FROM hall_foto_clubes');
            sql('DELETE FROM hall_foto');
        }
        $lote = [];
        $loteTabela = null;
        $loteCols = null;
        $lixeiraVistas = [];
        $descarregar = static function () use (&$lote, &$loteTabela, &$loteCols, $modo, &$gravadas, &$lixeiraVistas): void {
            if (!$lote) {
                return;
            }
            $ignorar = $modo === 'completar' || in_array($loteTabela, COPIA_SO_COMPLETAR, true);
            $lista = implode(', ', array_map(static fn(string $c): string => '`' . $c . '`', $loteCols));
            $params = [];
            foreach ($lote as $r) {
                array_push($params, ...$r);
            }
            $valores = implode(', ', array_fill(0, count($lote), '(' . marcas(count($loteCols)) . ')'));
            if (!$ignorar && $loteTabela === 'lixeira_carreiras' && !array_diff(['id', 'usuario_id', 'carreira_id'], $loteCols)) {
                // rev3 · substituir a lixeira sem apagar a tabela: as linhas do arquivo voltam como estavam, e a cópia
                // restaurável (dados) que o banco tem fica quando o arquivo não a traz (backup de antes da rev3) e a linha
                // é a mesma (mesmo id, conta e carreira). A linha do banco com a mesma carreira e outro id sai antes.
                $pos = array_flip($loteCols);
                $mesma = [];
                $pMesma = [];
                foreach ($lote as $r) {
                    $mesma[] = '(usuario_id = ? AND carreira_id = ? AND id <> ?)';
                    array_push($pMesma, $r[$pos['usuario_id']], $r[$pos['carreira_id']], $r[$pos['id']]);
                    $lixeiraVistas[(int) $r[$pos['id']]] = true;
                }
                sql('DELETE FROM lixeira_carreiras WHERE ' . implode(' OR ', $mesma), $pMesma);
                $sets = in_array('dados', $loteCols, true) ? []
                    : ['`dados` = IF(`id` <=> VALUES(`id`) AND `usuario_id` <=> VALUES(`usuario_id`) AND `carreira_id` <=> VALUES(`carreira_id`), `dados`, NULL)'];
                foreach ($loteCols as $c) {
                    if ($c !== 'id') {
                        $sets[] = '`' . $c . '` = VALUES(`' . $c . '`)';
                    }
                }
                sql("INSERT INTO `lixeira_carreiras` ($lista) VALUES $valores ON DUPLICATE KEY UPDATE " . implode(', ', $sets), $params);
                $gravadas[$loteTabela] = ($gravadas[$loteTabela] ?? 0) + count($lote);
                $lote = [];
                return;
            }
            $n = sql(($ignorar ? 'INSERT IGNORE' : 'INSERT') . " INTO `$loteTabela` ($lista) VALUES $valores", $params)->rowCount();
            $gravadas[$loteTabela] = ($gravadas[$loteTabela] ?? 0) + $n;
            $lote = [];
        };
        lerBackup($caminho, static function (string $t, array $r) use ($colunas, $excluidas, &$lote, &$loteTabela, &$loteCols, $descarregar, &$puladas): void {
            if (!isset($colunas[$t])) {
                return; // tabela que não se restaura (ou que este banco não tem)
            }
            foreach (['usuario_id', 'indicador_id', 'indicado_id'] as $c) {
                if ($t !== 'admin_log' && $t !== 'contas_excluidas' && isset($r[$c]) && isset($excluidas[(int) $r[$c]])) {
                    $puladas++;
                    return;
                }
            }
            if ($t === 'usuarios' && isset($excluidas[(int) ($r['id'] ?? 0)])) {
                $puladas++;
                return;
            }
            if ($t === 'site_config' && str_starts_with((string) ($r['chave'] ?? '_'), '_')) {
                return;
            }
            if ($t === 'admin_contas') {
                if ((int) ($r['da_config'] ?? 0) === 1) {
                    return; // a conta da senha do arquivo se recria sozinha
                }
                $r['senha_hash'] = '';
                $r['pin_hash'] = null;
                $r['ativo'] = 0;
                $r['trocar_senha'] = 1;
            }
            $r = array_intersect_key($r, array_flip($colunas[$t]));
            if ($r === []) {
                return;
            }
            $cols = array_keys($r);
            // carreiras levam o HallEntry (até 128 KB): lotes pequenos para caber no max_allowed_packet do banco
            $max = isset(COPIA_BINARIOS[$t]) ? 10 : 200;
            if ($loteTabela !== $t || $loteCols !== $cols || count($lote) >= $max) {
                $descarregar();
                $loteTabela = $t;
                $loteCols = $cols;
            }
            $lote[] = array_values($r);
        });
        $descarregar();
        if ($modo === 'substituir') {
            sql('DELETE FROM sessoes_login WHERE usuario_id NOT IN (SELECT id FROM usuarios)');
            if (isset($colunas['lixeira_carreiras'])) {
                // a lixeira volta a ser a do arquivo: o que entrou nela depois da cópia sai
                $fora = array_values(array_diff(array_map('intval', sql('SELECT id FROM lixeira_carreiras')->fetchAll(PDO::FETCH_COLUMN)),
                    array_keys($lixeiraVistas)));
                foreach (array_chunk($fora, 500) as $l) {
                    sql('DELETE FROM lixeira_carreiras WHERE id IN (' . marcas(count($l)) . ')', $l);
                }
            }
        }
        sql("DELETE FROM site_config WHERE chave IN ('_hall_foto', '_raridade', '_atencao', '_multicontas') OR LEFT(chave, 7) = '_painel'");
    });
    esquecerSiteConfig();
    return ['antes' => $antes['arquivo'], 'contagem' => $conf['contagem'], 'gravadas' => $gravadas, 'puladas' => $puladas,
        'geradoEm' => $conf['cabecalho']['geradoEm']];
}

<?php
/**
 * LENDA · Saúde do servidor (P1-14, CONTRATO-v32 §B): PHP, banco, o que falta do _schema.sql (o mesmo leitor que o
 * instalar.php usa, em modo de só conferir), a config (só sim/não e contagens, nunca valores), Hall, medição,
 * e-mails, cópias e os números da base, com a lista de problemas e como resolver cada um. Nada de segredo, caminho de
 * arquivo ou valor da config na resposta. Usado pelo equipe.php. Nunca é servido (o .htaccess nega _*.php).
 */
declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/_hall.php';
require_once __DIR__ . '/_copias.php';

/**
 * O _schema.sql lido como o instalar.php lê: [tabela => ['colunas' => [nomes], 'indices' => [nomes]]]. Só
 * CREATE TABLE IF NOT EXISTS, uma coluna ou índice por linha (o PRIMARY KEY não conta).
 */
function saudeLerSchema(?string $arquivo = null): array
{
    $sql = @file_get_contents($arquivo ?? __DIR__ . '/_schema.sql');
    if (!is_string($sql) || $sql === '') {
        throw new RuntimeException('Arquivo de tabelas não encontrado.');
    }
    $sql = (string) preg_replace('/^\s*--.*$/m', '', $sql);
    $tabelas = [];
    foreach (array_filter(array_map('trim', explode(';', $sql)), static fn(string $c): bool => $c !== '') as $c) {
        if (!preg_match('/^CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\((.*)\)[^)]*$/is', $c, $p)) {
            throw new RuntimeException('O arquivo de tabelas só pode ter CREATE TABLE IF NOT EXISTS.');
        }
        $t = ['colunas' => [], 'indices' => []];
        foreach (preg_split('/\R/', $p[2]) ?: [] as $linha) {
            $def = rtrim(trim($linha), ',');
            if ($def === '' || preg_match('/^PRIMARY\s+KEY/i', $def)) {
                continue;
            }
            if (preg_match('/^(UNIQUE\s+)?KEY\s+(\w+)\s*\(/i', $def, $k)) {
                $t['indices'][] = strtolower($k[2]);
            } elseif (preg_match('/^(\w+)\s+\w/', $def, $k)) {
                $t['colunas'][] = strtolower($k[1]);
            }
        }
        $nome = strtolower($p[1]);
        $tabelas[$nome] = isset($tabelas[$nome])
            ? ['colunas' => array_values(array_unique([...$tabelas[$nome]['colunas'], ...$t['colunas']])),
                'indices' => array_values(array_unique([...$tabelas[$nome]['indices'], ...$t['indices']]))]
            : $t;
    }
    return $tabelas;
}

/** O que o _schema.sql pede e o banco ainda não tem: [{tabela}] (tabela inteira) ou [{tabela, coluna}] / [{tabela, indice}]. */
function saudeSchemaFaltando(): array
{
    $pdo = bd();
    $existem = array_map('strtolower', $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
    $faltam = [];
    foreach (saudeLerSchema() as $tabela => $def) {
        if (!in_array($tabela, $existem, true)) {
            $faltam[] = ['tabela' => $tabela];
            continue;
        }
        $cols = array_map('strtolower', $pdo->query("SHOW COLUMNS FROM `$tabela`")->fetchAll(PDO::FETCH_COLUMN));
        $ixs = array_map('strtolower', array_column($pdo->query("SHOW INDEX FROM `$tabela`")->fetchAll(), 'Key_name'));
        foreach ($def['colunas'] as $c) {
            if (!in_array($c, $cols, true)) {
                $faltam[] = ['tabela' => $tabela, 'coluna' => $c];
            }
        }
        foreach ($def['indices'] as $i) {
            if (!in_array($i, $ixs, true)) {
                $faltam[] = ['tabela' => $tabela, 'indice' => $i];
            }
        }
    }
    return $faltam;
}

/** Um número, ou null se a tabela/coluna ainda não existe. */
function saudeValor(string $consulta, array $params = []): ?int
{
    try {
        $v = umValor($consulta, $params);
        return $v === null ? null : (int) $v;
    } catch (PDOException $e) {
        if (eFaltaDeSchema($e)) {
            return null;
        }
        throw $e;
    }
}

/** GET equipe.php?r=saude. */
function respostaSaude(): array
{
    $t = time();
    $c = config();
    $problemas = [];
    $prob = static function (string $codigo, bool $grave, string $texto, string $resolver) use (&$problemas): void {
        $problemas[] = ['codigo' => $codigo, 'grave' => $grave, 'texto' => $texto, 'resolver' => $resolver];
    };

    $ext = [
        'pdo_mysql' => extension_loaded('pdo_mysql'),
        'mbstring' => extension_loaded('mbstring'),
        'intl' => extension_loaded('intl'),
        'zlib' => extension_loaded('zlib'),
        'apcu' => function_exists('apcu_fetch') && filter_var(ini_get('apc.enabled'), FILTER_VALIDATE_BOOL),
    ];
    foreach (['mbstring', 'zlib'] as $e) {
        if (!$ext[$e]) {
            $prob('ext_' . $e, true, "O PHP está sem a extensão $e.", 'Ligue a extensão no hPanel (Avançado → Configuração do PHP → Extensões).');
        }
    }
    if (!$ext['intl']) {
        $prob('ext_intl', false, 'O PHP está sem a extensão intl: o filtro de apelido fica menos preciso.', 'Ligue a extensão intl no hPanel (Configuração do PHP → Extensões).');
    }
    if (!$ext['apcu']) {
        $prob('ext_apcu', false, 'Sem o cache curto (APCu): tudo funciona, só com um pouco mais de consultas ao banco.', 'Se o plano tiver, ligue a extensão apcu.');
    }

    $banco = ['ok' => false, 'versao' => null, 'fuso' => null];
    try {
        $b = umaLinha('SELECT VERSION() AS v, @@session.time_zone AS fuso');
        $banco = ['ok' => true, 'versao' => (string) $b['v'], 'fuso' => (string) $b['fuso']];
    } catch (Throwable $e) {
        error_log('LENDA saúde banco: ' . $e->getMessage());
        $prob('banco', true, 'O banco não respondeu.', 'Confira o banco no hPanel e os dados do banco no arquivo de config.');
    }

    $faltam = [];
    try {
        $faltam = saudeSchemaFaltando();
    } catch (Throwable $e) {
        error_log('LENDA saúde schema: ' . $e->getMessage());
        $prob('schema_arquivo', true, 'Não consegui ler o _schema.sql.', 'Suba a pasta api/ inteira de novo.');
    }
    if ($faltam) {
        $prob('schema', true, count($faltam) === 1 ? 'Falta 1 tabela, coluna ou índice no banco.' : 'Faltam ' . count($faltam) . ' tabelas, colunas ou índices no banco.',
            'Rode o instalar.php de novo, como no LEIAME §5, até a resposta dizer "faltam": 0.');
    }

    $origens = count(array_filter((array) ($c['origens'] ?? []), static fn($o): bool => is_string($o) && $o !== ''));
    $modo = (string) ($c['email_modo'] ?? 'mail');
    $tokenOk = preg_match('/^[0-9a-f]{64}$/', strtolower((string) ($c['admin_token_sha256'] ?? ''))) === 1;
    $contasPainel = saudeValor("SELECT COUNT(*) FROM admin_contas WHERE da_config = 0 AND ativo = 1 AND senha_hash <> ''");
    $cfg = [
        'segredo' => is_string($c['segredo'] ?? null) && strlen((string) $c['segredo']) >= 32,
        'senhaPainel' => senhaConfigHash() !== '',
        'token' => $tokenOk,
        'origens' => $origens,
        'emailRemetente' => (bool) filter_var((string) ($c['email_remetente'] ?? ''), FILTER_VALIDATE_EMAIL),
        'emailModo' => in_array($modo, ['mail', 'arquivo', 'smtp'], true) ? $modo : 'outro',
        'cookieSeguro' => (bool) ($c['cookie_seguro'] ?? true),
        'ipCabecalho' => is_string($c['ip_cabecalho'] ?? null) && $c['ip_cabecalho'] !== '',
        'contasPainel' => $contasPainel ?? 0,
    ];
    if (!$cfg['token']) {
        $prob('token', false, 'Sem token de script (admin_token_sha256): o instalar.php não roda e não há entrada de emergência.', 'Gere um token como no LEIAME §2 e ponha o sha256 na config.');
    }
    if ($origens === 0) {
        $prob('origens', true, 'A config não tem "origens": todo POST do site é recusado.', "Ponha 'origens' => ['https://oprojeto.online', 'https://www.oprojeto.online'] na config.");
    }
    if (!$cfg['emailRemetente']) {
        $prob('email_remetente', true, 'O e-mail remetente da config não é válido: nenhum e-mail sai.', 'Corrija email_remetente na config (a caixa precisa existir no hPanel).');
    }
    if ($modo === 'arquivo') {
        $prob('email_arquivo', false, 'Os e-mails estão sendo gravados em arquivo (modo de teste): nenhum chega aos jogadores.', "Tire 'email_modo' => 'arquivo' da config.");
    }
    if ($modo === 'smtp') {
        // O7: só sim/não (nunca o host, o usuário ou a senha)
        $s = is_array($c['smtp'] ?? null) ? $c['smtp'] : [];
        $completo = is_string($s['host'] ?? null) && trim($s['host']) !== '' && is_string($s['usuario'] ?? null) && $s['usuario'] !== ''
            && is_string($s['senha'] ?? null) && $s['senha'] !== '';
        if (!$completo) {
            $prob('smtp_config', true, "O envio está em 'smtp', mas falta host, usuário ou senha da caixa na config: nenhum e-mail sai.",
                "Complete 'smtp' => ['host' => 'smtp.hostinger.com', 'porta' => 587, 'usuario' => <a caixa>, 'senha' => <a senha da caixa>] na config (LEIAME §2).");
        }
        if (!extension_loaded('openssl')) {
            $prob('smtp_openssl', true, 'O PHP está sem a extensão openssl: o SMTP não abre a conexão segura e nenhum e-mail sai.', 'Ligue a extensão openssl no hPanel (Avançado → Configuração do PHP → Extensões).');
        }
    }
    if (!$cfg['cookieSeguro']) {
        $prob('cookie_seguro', true, 'Os cookies saem sem Secure (cookie_seguro desligado).', "Ponha 'cookie_seguro' => true na config (o site é https).");
    }
    if (!$cfg['senhaPainel'] && ($contasPainel ?? 0) === 0) {
        $prob('painel_desligado', false, 'O painel está desligado: não há senha no arquivo de config nem conta pessoal.', 'Gere a senha do painel como no LEIAME §2.');
    }

    $hall = null;
    $e = hallEstado();
    if ($e !== null) {
        $em = paraTempo(str_replace(['T', 'Z'], [' ', ''], (string) ($e['em'] ?? '')));
        $atrasado = $em === null || $em < $t - 2 * hallIntervaloS();
        $hall = ['em' => $em !== null ? gmdate('Y-m-d\TH:i:s\Z', $em) : null, 'total' => (int) ($e['total'] ?? 0), 'ms' => (int) ($e['ms'] ?? 0),
            'atrasado' => $atrasado];
        if ($atrasado && (int) ($e['total'] ?? 0) > 0) {
            $prob('hall_atrasado', false, 'A fotografia do Hall público está atrasada.', 'No Hall público, clique em "Atualizar Hall agora".');
        }
    }

    $ultima = umValor('SELECT MAX(ultimo) FROM visitas');
    $medicao = ['ultimaVisita' => iso(is_string($ultima) ? $ultima : null),
        'visitas1h' => (int) umValor('SELECT COUNT(*) FROM visitas WHERE ultimo >= ?', [dt($t - 3600)])];
    $ultimaT = is_string($ultima) ? paraTempo($ultima) : null;
    if ($ultimaT !== null && $ultimaT < $t - 2 * 3600) {
        $prob('medicao_parada', false, 'Nenhuma visita há mais de 2 horas: medição parada ou site fora do ar?', 'Abra o jogo no celular e confira se o número "Online agora" sobe.');
    }

    $falhas = saudeValor('SELECT COUNT(*) FROM email_log WHERE ok = 0 AND em >= ?', [dt($t - 86400)]);
    if (($falhas ?? 0) >= 5) {
        $prob('emails_falhando', true, "$falhas e-mails falharam nas últimas 24 h.", 'Confira a caixa do remetente no hPanel (E-mails) e o registro de e-mails.');
    }

    $p = pastaCopias();
    $copias = listarCopias();
    $copia = ['ok' => $p['ok'], 'motivo' => $p['motivo'], 'quantas' => count($copias), 'ultima' => $copias[0] ?? null,
        'ultimaDiaria' => lerEstado('_copia_diaria')['dia'] ?? null];
    if (!$p['ok']) {
        $prob('copias', false, 'As cópias no servidor estão desligadas: ' . $p['motivo'], 'O backup para baixar continua funcionando; para as cópias, veja o LEIAME (cópias no servidor).');
    } elseif ($copias && (paraTempo(str_replace(['T', 'Z'], [' ', ''], (string) $copias[0]['em'])) ?? 0) < $t - 2 * 86400) {
        $prob('copia_velha', false, 'A cópia mais nova no servidor tem mais de 2 dias.', 'Abra o painel (a cópia diária sai na primeira carga do dia) ou clique em "Guardar cópia agora".');
    }

    return [
        'php' => ['versao' => PHP_VERSION, 'extensoes' => $ext],
        'banco' => $banco,
        'schema' => ['faltam' => $faltam],
        'config' => $cfg,
        'hall' => $hall,
        'medicao' => $medicao,
        'email' => ['falhas24h' => $falhas],
        'copias' => $copia,
        'dados' => [
            'contas' => (int) umValor('SELECT COUNT(*) FROM usuarios'),
            'carreiras' => (int) umValor('SELECT COUNT(*) FROM carreiras'),
            'noHall' => (int) umValor('SELECT COUNT(*) FROM hall_foto'),
            'denunciasAbertas' => (int) umValor("SELECT COUNT(*) FROM denuncias WHERE status = 'aberta'"),
        ],
        'problemas' => $problemas,
        'tudoCerto' => !array_filter($problemas, static fn(array $x): bool => $x['grave']),
        'horaServidor' => gmdate('Y-m-d\TH:i:s\Z', $t),
    ];
}

<?php
/**
 * LENDA · análise para o painel (v3.2): relatórios prontos com CSV (P1-11), tempo de jogo (A11), o que os jogadores
 * fizeram (A14) e o CSV seguro (BOM, ";", anti-fórmula, datas em Brasília). Usado por
 * admin.php e painel.php. Nunca é servido. Contrato: servidor/CONTRATO-v32.md §A.
 */
declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

const TIPOS_CONTA = ['jogador', 'tester', 'criador', 'oficial', 'teste'];
const RELATORIO_POR_PAGINA = 100;
/** chave → [título, por quê (a régua, escrita na tela)]. */
const RELATORIOS = [
    'nunca_jogaram' => ['Nunca jogaram com a conta', 'Contas sem nenhuma partida: nem com a conta, nem no aparelho antes do cadastro.'],
    'sumidos30' => ['Sumidos há 30 dias', 'O último acesso com a conta foi há mais de 30 dias.'],
    'engajados' => ['Mais engajados', 'As que mais terminaram partidas (o maior entre o contador do aparelho e as partidas com a conta).'],
    'sem_carreira' => ['Sem carreira salva', 'Contas que nunca salvaram uma carreira.'],
    'nunca_no_hall' => ['Nunca no Hall', 'Têm carreira salva, mas nenhuma está no Hall público agora (fotografia atual).'],
    'suspensos' => ['Suspensos', 'Contas suspensas agora (as de data vencida já contam como ativas).'],
    'indicadores' => ['Quem mais indicou', 'Contas com indicações válidas, da que mais indicou para a que menos.'],
    'bonus_parado' => ['Bônus parado', 'Têm bônus de OVR que não foi usado e foi criado há 14 dias ou mais.'],
    'testers' => ['Testers', 'Contas do tipo tester (abrem o Imersivo e a Live para testar).'],
    'base' => ['Base inteira', 'Todas as contas, das mais novas para as mais antigas.'],
];

// ── CSV ──────────────────────────────────────────────────────────────────────────────────────────

function celulaCsv(mixed $v): string
{
    if ($v === null) {
        return '';
    }
    if (is_int($v)) {
        return (string) $v;
    }
    $s = (string) $v;
    // Planilha não pode ver fórmula: célula que começa com = + - @ (ou tab/CR) ganha um ' na frente.
    if ($s !== '' && strpbrk($s[0], "=+-@\t\r") !== false) {
        $s = "'" . $s;
    }
    return '"' . str_replace('"', '""', $s) . '"';
}

function dataBrasilia(?string $dt): ?string
{
    $t = paraTempo($dt);
    return $t === null ? null : gmdate('Y-m-d H:i', $t - LENDA_FUSO_H * 3600);
}

/** Começa a resposta CSV (UTF-8 com BOM) com o cabeçalho. */
function comecarCsv(string $arquivo, array $cabecalho): void
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $arquivo . '"');
    header('Cache-Control: no-store');
    echo "\xEF\xBB\xBF", implode(';', $cabecalho), "\r\n"; // cabeçalho fixo do servidor (sem aspas, como na v3)
}

function linhaCsv(array $celulas): void
{
    echo implode(';', array_map('celulaCsv', $celulas)), "\r\n";
}

// ── relatórios prontos (P1-11) ───────────────────────────────────────────────────────────────────

/** [onde, ordem, join] de um relatório (apelido u = usuarios). */
function sqlRelatorio(string $tipo): array
{
    $t = time();
    return match ($tipo) {
        'nunca_jogaram' => ['u.partidas_conta = 0 AND u.partidas = 0', 'u.criado_em DESC, u.id DESC', '', []],
        'sumidos30' => ['(u.ultimo_acesso < ? OR (u.ultimo_acesso IS NULL AND u.criado_em < ?))', 'u.ultimo_acesso DESC, u.id DESC', '',
            [dt($t - 30 * 86400), dt($t - 30 * 86400)]],
        'engajados' => ['GREATEST(u.partidas, u.partidas_conta) > 0', 'GREATEST(u.partidas, u.partidas_conta) DESC, u.id DESC', '', []],
        'sem_carreira' => ['NOT EXISTS (SELECT 1 FROM carreiras c WHERE c.usuario_id = u.id)', 'u.criado_em DESC, u.id DESC', '', []],
        'nunca_no_hall' => ['EXISTS (SELECT 1 FROM carreiras c WHERE c.usuario_id = u.id) AND NOT EXISTS (SELECT 1 FROM hall_foto f WHERE f.usuario_id = u.id)',
            'u.criado_em DESC, u.id DESC', '', []],
        'suspensos' => ['NOT ' . LENDA_SQL_ATIVO, 'u.criado_em DESC, u.id DESC', '', []],
        'indicadores' => ['iv.n > 0', 'iv.n DESC, u.id DESC',
            " JOIN (SELECT indicador_id, COUNT(*) AS n FROM indicacoes WHERE status = 'valida' GROUP BY indicador_id) iv ON iv.indicador_id = u.id", []],
        'bonus_parado' => ['EXISTS (SELECT 1 FROM bonus b WHERE b.usuario_id = u.id AND b.usado_em IS NULL AND b.criado_em < ?)', 'u.criado_em DESC, u.id DESC', '',
            [dt($t - 14 * 86400)]],
        'testers' => ["u.tipo = 'tester'", 'u.criado_em DESC, u.id DESC', '', []],
        default => ['1 = 1', 'u.criado_em DESC, u.id DESC', '', []],
    };
}

/** Números das contas de uma página/lote, em consultas agrupadas: [id => {carreiras, indicacoesValidas, bonusAbertos}]. */
function numerosContas(array $ids): array
{
    $out = [];
    foreach ($ids as $id) {
        $out[$id] = ['carreiras' => 0, 'indicacoesValidas' => 0, 'bonusAbertos' => 0];
    }
    if (!$ids) {
        return $out;
    }
    $mk = marcas(count($ids));
    foreach (sql("SELECT usuario_id, COUNT(*) AS n FROM carreiras WHERE usuario_id IN ($mk) GROUP BY usuario_id", $ids) as $l) {
        $out[(int) $l['usuario_id']]['carreiras'] = (int) $l['n'];
    }
    foreach (sql("SELECT indicador_id, COUNT(*) AS n FROM indicacoes WHERE status = 'valida' AND indicador_id IN ($mk) GROUP BY indicador_id", $ids) as $l) {
        $out[(int) $l['indicador_id']]['indicacoesValidas'] = (int) $l['n'];
    }
    foreach (sql("SELECT usuario_id, COUNT(*) AS n FROM bonus WHERE usado_em IS NULL AND usuario_id IN ($mk) GROUP BY usuario_id", $ids) as $l) {
        $out[(int) $l['usuario_id']]['bonusAbertos'] = (int) $l['n'];
    }
    return $out;
}

function itemRelatorio(array $l, array $num): array
{
    $acesso = $l['ultimo_acesso'] ?? $l['ultimo_login'] ?? $l['criado_em'];
    $t = paraTempo($acesso);
    return [
        'id' => (int) $l['id'],
        'apelido' => (string) $l['apelido'],
        'email' => (string) $l['email'],
        'tipo' => (string) ($l['tipo'] ?? 'jogador'),
        'status' => contaSuspensa($l) ? 'suspenso' : 'ativo',
        'criadoEm' => iso($l['criado_em']),
        'ultimoAcesso' => iso($acesso),
        'diasSemAcesso' => $t === null ? null : intdiv(max(0, time() - $t), 86400),
        'partidas' => max((int) $l['partidas'], (int) $l['partidas_conta']),
        'carreiras' => $num['carreiras'],
        'indicacoesValidas' => $num['indicacoesValidas'],
        'bonusAbertos' => $num['bonusAbertos'],
    ];
}

/**
 * GET ?r=relatorio&tipo=&conta=&pagina= → {tipo, titulo, porque, total, base, porTipo, pagina, porPagina, itens}; com
 * $csv, responde o arquivo (todas as linhas, em lotes de 1000) e registra.
 */
function relatorio(string $tipo, string $conta, int $pagina, bool $csv): array
{
    [$onde, $ordem, $join, $params] = sqlRelatorio($tipo);
    $w = $onde;
    $p = $params;
    if ($conta !== '') {
        $w .= ' AND u.tipo = ?';
        $p[] = $conta;
    }
    $total = (int) umValor("SELECT COUNT(*) FROM usuarios u$join WHERE $w", $p);
    // a página pela ordem do índice (sem filesort); com o tipo de conta, o ix_usuarios_tipo (tipo, criado_em) já serve
    $forcar = $ordem === 'u.criado_em DESC, u.id DESC' && $conta === '' ? ' FORCE INDEX FOR ORDER BY (ix_usuarios_criado)' : '';
    if ($csv) {
        registrarAdmin('exportar', 'relatorio:' . $tipo, ['tipo' => 'relatorio:' . $tipo, 'conta' => $conta !== '' ? $conta : null, 'linhas' => $total]);
        comecarCsv('lenda-' . str_replace('_', '-', $tipo) . '-' . diaBrasilia() . '.csv', ['id', 'apelido', 'e-mail', 'tipo', 'status', 'criado',
            'último acesso', 'dias sem acesso', 'partidas', 'carreiras', 'indicações válidas', 'bônus abertos']);
        for ($off = 0; ; $off += 1000) {
            $lote = sql("SELECT u.* FROM usuarios u$join WHERE $w ORDER BY $ordem LIMIT 1000 OFFSET $off", $p)->fetchAll();
            $num = numerosContas(array_map(static fn(array $l): int => (int) $l['id'], $lote));
            foreach ($lote as $l) {
                $it = itemRelatorio($l, $num[(int) $l['id']]);
                linhaCsv([$it['id'], $it['apelido'], $it['email'], $it['tipo'], $it['status'], dataBrasilia($l['criado_em']),
                    dataBrasilia($l['ultimo_acesso'] ?? $l['ultimo_login'] ?? $l['criado_em']), $it['diasSemAcesso'], $it['partidas'], $it['carreiras'],
                    $it['indicacoesValidas'], $it['bonusAbertos']]);
            }
            flush();
            if (count($lote) < 1000) {
                break;
            }
        }
        exit;
    }
    $off = ($pagina - 1) * RELATORIO_POR_PAGINA;
    $linhas = sql("SELECT u.* FROM usuarios u$forcar$join WHERE $w ORDER BY $ordem LIMIT " . RELATORIO_POR_PAGINA . " OFFSET $off", $p)->fetchAll();
    $num = numerosContas(array_map(static fn(array $l): int => (int) $l['id'], $linhas));
    $porTipo = array_fill_keys(TIPOS_CONTA, 0);
    foreach (sql("SELECT u.tipo, COUNT(*) AS n FROM usuarios u$join WHERE $onde GROUP BY u.tipo", $params) as $l) {
        $porTipo[(string) $l['tipo']] = (int) $l['n'];
    }
    return [
        'tipo' => $tipo,
        'titulo' => RELATORIOS[$tipo][0],
        'porque' => RELATORIOS[$tipo][1],
        'total' => $total,
        'base' => (int) umValor('SELECT COUNT(*) FROM usuarios u' . ($conta !== '' ? ' WHERE u.tipo = ?' : ''), $conta !== '' ? [$conta] : []),
        'porTipo' => $porTipo,
        'pagina' => $pagina,
        'porPagina' => RELATORIO_POR_PAGINA,
        'itens' => array_map(static fn(array $l): array => itemRelatorio($l, $num[(int) $l['id']]), $linhas),
    ];
}

// ── tempo de jogo (A11) ──────────────────────────────────────────────────────────────────────────

/** Segunda-feira 00:00 (Brasília) desta semana, em timestamp. */
function inicioSemanaBrasilia(?int $t = null): int
{
    $t ??= time();
    $local = $t - LENDA_FUSO_H * 3600;
    $dia = (int) strtotime(gmdate('Y-m-d', $local) . ' 00:00:00 UTC');
    $dow = (int) gmdate('N', $local); // 1 = segunda
    return $dia - ($dow - 1) * 86400 + LENDA_FUSO_H * 3600;
}

/** [de, ate) em timestamp para a janela do Tempo de jogo; de = null em "tudo". */
function janelaTempo(string $jan): array
{
    $t = time();
    $seg = inicioSemanaBrasilia($t);
    return match ($jan) {
        'passada' => [$seg - 7 * 86400, $seg],
        'mes' => [(int) strtotime(gmdate('Y-m-01', $t - LENDA_FUSO_H * 3600) . ' 00:00:00 UTC') + LENDA_FUSO_H * 3600, $t + 1],
        'd30' => [$t - 30 * 86400, $t + 1],
        'tudo' => [null, $t + 1],
        default => [$seg, $t + 1],
    };
}

/** Contas que não entram como "jogadores" no Tempo de jogo: teste, oficial e tester (até 1000). */
function idsContasDeTeste(): array
{
    return array_map('intval', sql("SELECT id FROM usuarios WHERE tipo IN ('teste', 'oficial', 'tester') ORDER BY id LIMIT 1000")->fetchAll(PDO::FETCH_COLUMN));
}

/**
 * GET ?r=tempo&jan=semana|passada|mes|d30|tudo&grupo=jogadores|todos|testes[&usuario=id][&csv=1]. Régua: o tempo conta
 * só com a aba do jogo visível (batimento a cada 15 s); "jogando" = com uma partida em andamento. Robôs nunca entram.
 */
function tempoDeJogo(string $jan, string $grupo, ?int $usuario, bool $csv): array
{
    [$de, $ate] = janelaTempo($jan);
    $onde = ['v.bot = 0', 'v.inicio < ?'];
    $p = [dt($ate)];
    if ($de !== null) {
        $onde[] = 'v.inicio >= ?';
        $p[] = dt($de);
    }
    $teste = $grupo === 'todos' ? [] : idsContasDeTeste();
    if ($grupo === 'testes') {
        $onde[] = $teste ? 'v.usuario_id IN (' . marcas(count($teste)) . ')' : '1 = 0';
        array_push($p, ...$teste);
    } elseif ($grupo === 'jogadores' && $teste) {
        $onde[] = '(v.usuario_id IS NULL OR v.usuario_id NOT IN (' . marcas(count($teste)) . '))';
        array_push($p, ...$teste);
    }
    if ($usuario !== null) {
        $onde[] = 'v.usuario_id = ?';
        $p[] = $usuario;
    }
    $w = implode(' AND ', $onde);
    $fuso = ' - INTERVAL ' . LENDA_FUSO_H . ' HOUR';
    if ($csv) {
        registrarAdmin('exportar', 'tempo', ['tipo' => 'tempo', 'jan' => $jan, 'grupo' => $grupo]);
        comecarCsv('lenda-tempo-' . $jan . '-' . diaBrasilia() . '.csv', ['id', 'apelido', 'tipo', 'tempo ativo (min)', 'tempo jogando (min)', 'sessões']);
        foreach (sql("SELECT v.usuario_id, u.apelido, u.tipo, SUM(v.ativo_s) AS s, SUM(v.jogando_s) AS j, COUNT(*) AS n FROM visitas v
            JOIN usuarios u ON u.id = v.usuario_id WHERE $w AND v.usuario_id IS NOT NULL GROUP BY v.usuario_id, u.apelido, u.tipo ORDER BY s DESC LIMIT 100000", $p) as $l) {
            linhaCsv([(int) $l['usuario_id'], (string) $l['apelido'], (string) $l['tipo'], intdiv((int) $l['s'], 60), intdiv((int) $l['j'], 60), (int) $l['n']]);
        }
        exit;
    }
    // rev3: as janelas longas (tudo, mês, 30 dias) leem muitas visitas: a resposta fica guardada alguns minutos (como o
    // período do painel.php) e só um pedido recalcula de cada vez; o total, o por dia e o por modo saem em 2 passadas
    $cacheS = $usuario === null ? tempoCacheS($jan) : 0;
    $chaveCache = '_tempo:' . $jan . ':' . $grupo;
    $travou = false;
    if ($cacheS > 0) {
        $g = lerEstado($chaveCache);
        $fresco = static fn(?array $x): bool => is_array($x) && is_int($x['em'] ?? null) && is_array($x['dados'] ?? null) && $x['em'] > time() - $cacheS;
        if ($fresco($g)) {
            return $g['dados'];
        }
        $travou = pegarTrava('lenda_tempo', 0);
        if (!$travou && is_array($g['dados'] ?? null)) {
            return $g['dados']; // outro pedido está recalculando: a de antes serve
        }
        if (!$travou) {
            $travou = pegarTrava('lenda_tempo', 25);
            $g = lerEstado($chaveCache);
            if ($fresco($g)) {
                if ($travou) {
                    soltarTrava('lenda_tempo');
                }
                return $g['dados'];
            }
        }
    }
    try {
        $r = tempoDeJogoCalculado($jan, $grupo, $usuario, $de, $ate, $w, $p, $fuso);
        if ($cacheS > 0) {
            gravarSiteConfig($chaveCache, ['em' => time(), 'dados' => $r], 'painel');
        }
        return $r;
    } finally {
        if ($travou) {
            soltarTrava('lenda_tempo');
        }
    }
}

/** Por quanto tempo a resposta do Tempo de jogo fica guardada (0 = sempre na hora; painel_cache_s 0 desliga). */
function tempoCacheS(string $jan): int
{
    $base = max(0, (int) (config()['painel_cache_s'] ?? 90));
    if ($base === 0) {
        return 0;
    }
    return match ($jan) {
        'tudo' => max(600, 4 * $base),
        'mes', 'd30' => max(180, 2 * $base),
        default => 0, // semana e semana passada leem pouco
    };
}

/** SQL do tempo jogando de um modo numa visita (as colunas por modo da rev3; nas de antes, o modo_atual leva tudo). */
function sqlJogandoModo(string $m): string
{
    $soma = 'v.jogando_classico_s + v.jogando_imersivo_s + v.jogando_live_s';
    return "CASE WHEN $soma > 0 THEN v.jogando_{$m}_s WHEN v.modo_atual = '$m' THEN v.jogando_s ELSE 0 END";
}

function tempoDeJogoCalculado(string $jan, string $grupo, ?int $usuario, ?int $de, int $ate, string $w, array $p, string $fuso): array
{
    $tot = umaLinha("SELECT COALESCE(SUM(v.ativo_s), 0) AS s, COALESCE(SUM(v.jogando_s), 0) AS j, COALESCE(SUM(v.ativo_s >= 30), 0) AS n30,
        COALESCE(SUM(CASE WHEN v.ativo_s >= 30 THEN v.ativo_s END), 0) AS s30, COUNT(DISTINCT v.usuario_id) AS contas, COUNT(DISTINCT v.vid) AS aparelhos
        FROM visitas v WHERE $w", $p);
    $modos = ['classico', 'imersivo', 'live'];
    $colsModo = '';
    foreach ($modos as $m) {
        $colsModo .= ', COALESCE(SUM(' . sqlJogandoModo($m) . "), 0) AS j_$m, COALESCE(SUM((" . sqlJogandoModo($m) . ") > 0), 0) AS n_$m";
    }
    $porDia = [];
    $porModoS = ['classico' => 0, 'imersivo' => 0, 'live' => 0, 'outro' => 0];
    $porModoN = $porModoS;
    foreach (sql("SELECT DATE(v.inicio$fuso) AS dia, SUM(v.ativo_s) AS s, SUM(v.jogando_s) AS j, COALESCE(SUM(v.ativo_s >= 30), 0) AS n$colsModo,
        COALESCE(SUM(v.jogando_s > (" . implode(') + (', array_map('sqlJogandoModo', $modos)) . ")), 0) AS n_outro
        FROM visitas v WHERE $w GROUP BY dia ORDER BY dia", $p) as $l) {
        $porDia[] = ['dia' => (string) $l['dia'], 'ativoS' => (int) $l['s'], 'jogandoS' => (int) $l['j'], 'sessoes' => (int) $l['n']];
        $somaModos = 0;
        foreach ($modos as $m) {
            $porModoS[$m] += (int) $l["j_$m"];
            $porModoN[$m] += (int) $l["n_$m"];
            $somaModos += (int) $l["j_$m"];
        }
        $porModoS['outro'] += max(0, (int) $l['j'] - $somaModos);
        $porModoN['outro'] += (int) $l['n_outro'];
    }
    $porModo = [];
    foreach ($porModoS as $m => $js) {
        if ($js > 0) {
            $porModo[] = ['modo' => $m, 'jogandoS' => $js, 'sessoes' => $porModoN[$m]];
        }
    }
    usort($porModo, static fn(array $a, array $b): int => [$b['jogandoS'], $a['modo']] <=> [$a['jogandoS'], $b['modo']]);
    $ranking = array_map(static fn(array $l): array => ['id' => (int) $l['usuario_id'], 'apelido' => (string) $l['apelido'], 'tipo' => (string) $l['tipo'],
        'ativoS' => (int) $l['s'], 'jogandoS' => (int) $l['j'], 'sessoes' => (int) $l['n']],
        sql("SELECT v.usuario_id, u.apelido, u.tipo, SUM(v.ativo_s) AS s, SUM(v.jogando_s) AS j, COUNT(*) AS n FROM visitas v
            JOIN usuarios u ON u.id = v.usuario_id WHERE $w AND v.usuario_id IS NOT NULL GROUP BY v.usuario_id, u.apelido, u.tipo
            ORDER BY s DESC, v.usuario_id LIMIT 50", $p)->fetchAll());
    $r = [
        'jan' => $jan,
        'grupo' => $grupo,
        'de' => $de !== null ? gmdate('Y-m-d\TH:i:s\Z', $de) : null,
        'ate' => gmdate('Y-m-d\TH:i:s\Z', min($ate, time())),
        'regua' => 'Conta só com a aba do jogo visível (batimento a cada 15 s); "jogando" é com uma partida em andamento. Média das sessões de 30 s ou mais. Robôs ficam de fora.',
        'total' => ['ativoS' => (int) $tot['s'], 'jogandoS' => (int) $tot['j'], 'sessoes' => (int) $tot['n30'], 'jogadores' => (int) $tot['contas'],
            'aparelhos' => (int) $tot['aparelhos'], 'mediaS' => (int) $tot['n30'] > 0 ? (int) round((int) $tot['s30'] / (int) $tot['n30']) : 0],
        'porDia' => $porDia,
        'porModo' => $porModo,
        'ranking' => $ranking,
        'geradoEm' => gmdate('Y-m-d\TH:i:s\Z'),
    ];
    if ($usuario !== null) {
        $r['sessoes'] = array_map(static fn(array $l): array => ['inicio' => iso($l['inicio']), 'ultimo' => iso($l['ultimo']), 'ativoS' => (int) $l['ativo_s'],
            'jogandoS' => (int) $l['jogando_s'], 'modo' => $l['modo_atual'], 'aparelho' => $l['dispositivo'], 'origem' => (string) $l['origem']],
            sql("SELECT v.inicio, v.ultimo, v.ativo_s, v.jogando_s, v.modo_atual, v.dispositivo, v.origem FROM visitas v WHERE $w
                ORDER BY v.inicio DESC LIMIT 100", $p)->fetchAll());
    }
    return $r;
}

// ── o que os jogadores fizeram (A14) ─────────────────────────────────────────────────────────────

const TIPOS_FEED = ['cadastro', 'login', 'jogo_fim', 'compartilhar'];

/** GET ?r=eventos&tipo=&dias=30&pagina= → paginado de 50: {id, em, tipo, modo, dados, conta: {id, apelido}|null, aparelho}. */
function feedEventos(string $tipo, int $dias, int $pagina): array
{
    $tipos = in_array($tipo, TIPOS_FEED, true) ? [$tipo] : TIPOS_FEED;
    $p = array_merge([dt(time() - $dias * 86400)], $tipos);
    $w = 'e.em >= ? AND e.tipo IN (' . marcas(count($tipos)) . ')';
    $total = (int) umValor("SELECT COUNT(*) FROM eventos e WHERE $w", $p);
    $off = ($pagina - 1) * 50;
    $itens = array_map(static function (array $l): array {
        $d = is_string($l['dados']) ? json_decode($l['dados'], true) : null;
        return ['id' => (int) $l['id'], 'em' => iso($l['em']), 'tipo' => (string) $l['tipo'], 'modo' => $l['modo'], 'dados' => is_array($d) ? $d : null,
            'conta' => $l['apelido'] !== null ? ['id' => (int) $l['usuario_id'], 'apelido' => (string) $l['apelido']] : null,
            'aparelho' => substr((string) $l['vid'], 0, 8)];
    }, sql("SELECT e.id, e.em, e.tipo, e.modo, e.dados, e.vid, v.usuario_id, u.apelido FROM eventos e FORCE INDEX (ix_eventos_em_tipo)
        LEFT JOIN visitas v ON v.sid = e.sid LEFT JOIN usuarios u ON u.id = v.usuario_id
        WHERE $w ORDER BY e.em DESC LIMIT 50 OFFSET $off", $p)->fetchAll());
    return ['total' => $total, 'pagina' => $pagina, 'porPagina' => 50, 'tipo' => count($tipos) === 1 ? $tipos[0] : null, 'dias' => $dias, 'itens' => $itens];
}

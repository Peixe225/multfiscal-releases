<?php
/**
 * LENDA · números do painel (só administrador).
 *   POST {"acao":"entrar","senha":"…"} → cookie lenda_painel (12 h)     POST {"acao":"sair"} → apaga
 *   GET  ?de=YYYY-MM-DD&ate=YYYY-MM-DD&bots=0   (cookie ou Authorization: Bearer <token>)
 *   GET  ?so=agora                              → só {agora} (o painel atualiza isso a cada 15 s)
 *   GET  ?so=eu                                 → {admin: true} ou 401 (o jogo libera o que é só do admin)
 * Dias no fuso America/Sao_Paulo (UTC-3 fixo): o período vira [de 03:00 UTC, ate+1 03:00 UTC). A resposta do
 * período fica guardada por painel_cache_s (90 s; "geradoEm" diz de quando é); o "agora" é sempre na hora.
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';

cabecalhos();

$m = metodo();
if ($m === 'POST') {
    exigirEscrita();
    $j = lerJson(16 * 1024);
    $acao = is_string($j['acao'] ?? null) ? $j['acao'] : '';
    if ($acao === 'entrar') {
        $ip = quemIp();
        limitar('painel', $ip, 10);
        // Teto do site inteiro contra força bruta de muitos IPs: soma só as senhas erradas e, estourado, barra só os IPs
        // que já erraram nesta janela — o dono, de um IP limpo e com a senha certa, entra mesmo no meio de um ataque
        // (a senha do painel deve ser longa e aleatória: com o bcrypt e 10 por IP, chutar não dá em nada).
        if (lerLimite('painel-todos', 'todos') >= 50 && lerLimite('painel-erro', $ip) > 0) {
            erroLimite();
        }
        $senha = is_string($j['senha'] ?? null) ? $j['senha'] : '';
        $hash = (string) (config()['admin_senha_hash'] ?? '');
        if ($senha === '' || strlen($senha) > 256 || str_contains($senha, "\0") || $hash === '' || !password_verify($senha, $hash)) {
            somarLimite('painel-erro', $ip);
            somarLimite('painel-todos', 'todos');
            erro(401, 'credenciais', 'Senha incorreta.');
        }
        $exp = (string) (time() + 12 * 3600);
        definirCookie(LENDA_COOKIE_PAINEL, $exp . '.' . assinaturaPainel($exp), (int) $exp, 'Strict');
        responder(200, ['ok' => true]);
    }
    if ($acao === 'sair') {
        apagarCookie(LENDA_COOKIE_PAINEL, 'Strict');
        responder(200, ['ok' => true]);
    }
    erro(400, 'acao', 'Ação desconhecida.');
}
if ($m !== 'GET') {
    erroMetodo();
}
if (!cookiePainelValido() && !tokenAdminValido()) {
    erro(401, 'nao_logado', 'Entre com a senha do painel.');
}
if (($_GET['so'] ?? '') === 'eu') {
    responder(200, ['admin' => true]); // sem banco: só o cookie (ou o Bearer)
}

// ── agora ────────────────────────────────────────────────────────────────────────────────────────

$t = time();
$ag = umaLinha('SELECT COUNT(*) AS online, COALESCE(SUM(jogando_ate > ?), 0) AS jogando
    FROM visitas WHERE ultimo >= ? AND bot = 0', [dt($t), dt($t - 60)]);
$agora = ['online' => (int) $ag['online'], 'jogando' => (int) $ag['jogando'], 'atualizadoEm' => gmdate('Y-m-d\TH:i:s\Z', $t)];
if (($_GET['so'] ?? '') === 'agora') {
    responder(200, ['agora' => $agora]);
}

// ── período ──────────────────────────────────────────────────────────────────────────────────────

function lerDia(mixed $v): ?string
{
    if (!is_string($v) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $p) || !checkdate((int) $p[2], (int) $p[3], (int) $p[1])) {
        return null;
    }
    return $v;
}

function diaUtc(string $dia): int
{
    return (int) strtotime($dia . ' 00:00:00 UTC');
}

$hoje = gmdate('Y-m-d', $t - LENDA_FUSO_H * 3600);
$ate = lerDia($_GET['ate'] ?? null) ?? $hoje;
$de = lerDia($_GET['de'] ?? null) ?? gmdate('Y-m-d', diaUtc($ate) - 6 * 86400);
if ($de > $ate) {
    [$de, $ate] = [$ate, $de];
}
if (diaUtc($ate) - diaUtc($de) > 400 * 86400) {
    $de = gmdate('Y-m-d', diaUtc($ate) - 400 * 86400);
}
$a = dt(diaUtc($de) + LENDA_FUSO_H * 3600);
$b = dt(diaUtc($ate) + 86400 + LENDA_FUSO_H * 3600);
$bots = ($_GET['bots'] ?? '0') === '1';

// O resto pesa (eventos de 13 meses): a resposta fica guardada por painel_cache_s (90 s) por período, e só um pedido
// recalcula de cada vez (os outros recebem a guardada, mesmo um pouco velha). O "agora" é sempre na hora.
$cacheS = max(0, (int) (config()['painel_cache_s'] ?? 90));
$chaveCache = '_painel:' . $de . ':' . $ate . ':' . ($bots ? '1' : '0');
$travou = false;
if ($cacheS > 0) {
    $guardado = lerEstado($chaveCache);
    $fresco = is_array($guardado) && is_int($guardado['em'] ?? null) && is_array($guardado['dados'] ?? null);
    if ($fresco && $guardado['em'] > $t - $cacheS) {
        responder(200, ['agora' => $agora] + $guardado['dados']);
    }
    $travou = pegarTrava('lenda_painel', 0);
    if (!$travou && $fresco) {
        responder(200, ['agora' => $agora] + $guardado['dados']); // outro está recalculando: a de antes serve
    }
    if (!$travou) {
        $travou = pegarTrava('lenda_painel', 10);
        $guardado = lerEstado($chaveCache);
        if (is_array($guardado) && is_int($guardado['em'] ?? null) && is_array($guardado['dados'] ?? null) && $guardado['em'] > $t - $cacheS) {
            if ($travou) {
                soltarTrava('lenda_painel');
            }
            responder(200, ['agora' => $agora] + $guardado['dados']);
        }
    }
}

// Filtros fixos (nada do pedido entra no texto do SQL). Robôs: as visitas pela coluna bot; os eventos pela
// lista (pequena, com índice) das sessões-robô do período, em vez de um JOIN por evento.
$a1 = dt(diaUtc($de) + LENDA_FUSO_H * 3600 - 86400); // sessão-robô que começou até 1 dia antes
$fv = $bots ? '' : ' AND v.bot = 0';
$fw = $bots ? '' : ' AND w.bot = 0';
$nbE = $bots ? '' : ' AND e.sid NOT IN (SELECT sid FROM visitas WHERE bot = 1 AND inicio >= ? AND inicio < ?)';
$nbC = $bots ? '' : ' AND c.sid NOT IN (SELECT sid FROM visitas WHERE bot = 1 AND inicio >= ? AND inicio < ?)';
$ab = [$a, $b];
$abE = $bots ? $ab : [$a, $b, $a1, $b];
$lv = 'v.inicio >= ? AND v.inicio < ?';
$le = 'e.em >= ? AND e.em < ?';
$porInicio = ' FORCE INDEX (ix_visitas_inicio)';
$fuso = ' - INTERVAL ' . LENDA_FUSO_H . ' HOUR';

$pv = umaLinha("SELECT COUNT(*) AS sessoes, COUNT(DISTINCT v.vid) AS visitantes, COALESCE(SUM(v.ativo_s), 0) AS total
    FROM visitas v$porInicio WHERE $lv$fv", $ab);
$sessoes = (int) $pv['sessoes'];
$visitantes = (int) $pv['visitantes'];
$total = (int) $pv['total'];
$novos = (int) umValor("SELECT COUNT(DISTINCT v.vid) FROM visitas v$porInicio WHERE $lv$fv
    AND NOT EXISTS (SELECT 1 FROM visitas w WHERE w.vid = v.vid AND w.inicio < ?)", [$a, $b, $a]);

// Eventos do período por tipo e modo (contagens) e por tipo (pessoas).
$inicios = ['classico' => 0, 'imersivo' => 0, 'live' => 0];
$fins = $inicios;
$contagem = [];
foreach (sql("SELECT e.tipo, e.modo, COUNT(*) AS n FROM eventos e
    WHERE e.tipo IN ('jogo_inicio', 'jogo_fim', 'partida_fim', 'gate_ver', 'gate_fechar', 'cadastro', 'login')
      AND $le$nbE GROUP BY e.tipo, e.modo", $abE) as $l) {
    $contagem[$l['tipo']] = ($contagem[$l['tipo']] ?? 0) + (int) $l['n'];
    if ($l['modo'] !== null && isset($inicios[$l['modo']])) {
        if ($l['tipo'] === 'jogo_inicio') {
            $inicios[$l['modo']] += (int) $l['n'];
        } elseif ($l['tipo'] === 'jogo_fim') {
            $fins[$l['modo']] += (int) $l['n'];
        }
    }
}
$pessoas = [];
foreach (sql("SELECT e.tipo, COUNT(DISTINCT e.vid) AS p FROM eventos e
    WHERE e.tipo IN ('jogo_inicio', 'jogo_fim', 'gate_ver', 'gate_fechar') AND $le$nbE GROUP BY e.tipo", $abE) as $l) {
    $pessoas[$l['tipo']] = (int) $l['p'];
}
$cadastrosDepois = (int) umValor("SELECT COUNT(DISTINCT c.vid) FROM eventos c
    WHERE c.tipo = 'cadastro' AND c.em >= ? AND c.em < ?$nbC
      AND EXISTS (SELECT 1 FROM eventos g WHERE g.vid = c.vid AND g.tipo = 'gate_ver' AND g.em <= c.em)", $abE);
$cadastros = (int) umValor('SELECT COUNT(*) FROM usuarios WHERE criado_em >= ? AND criado_em < ?', $ab);

// 5 partidas: visitantes do período com 5 ou mais (jogo_fim clássico/imersivo + partida_fim) na vida toda — a soma
// por aparelho fica em partidas_vid (o e.php soma), em vez de agrupar a tabela eventos inteira.
$cinco = (int) umValor("SELECT COUNT(*) FROM partidas_vid p
    WHERE p.n >= 5 AND EXISTS (SELECT 1 FROM visitas w FORCE INDEX (ix_visitas_vid)
        WHERE w.vid = p.vid AND w.inicio >= ? AND w.inicio < ?$fw)", $ab);

// a nota do jogo_fim fica na coluna eventos.nota (o e.php grava); as linhas de antes dela, no JSON de dados
$notas = umaLinha('SELECT ROUND(AVG(x)) AS media, MAX(x) AS melhor FROM (
        SELECT COALESCE(e.nota, CASE WHEN JSON_TYPE(JSON_EXTRACT(e.dados, \'$.nota\')) IN (\'INTEGER\', \'UNSIGNED INTEGER\', \'DOUBLE\', \'DECIMAL\')
                AND JSON_EXTRACT(e.dados, \'$.nota\') + 0 BETWEEN -999 AND 999 THEN JSON_EXTRACT(e.dados, \'$.nota\') + 0 END) AS x
        FROM eventos e
        WHERE e.tipo = \'jogo_fim\' AND e.modo IN (\'classico\', \'imersivo\') AND ' . $le . $nbE . '
          AND (e.nota IS NOT NULL OR e.dados IS NOT NULL)
    ) t WHERE x IS NOT NULL', $abE);

// ── por dia, hora, origem e aparelho ─────────────────────────────────────────────────────────────

$dias = [];
for ($d = diaUtc($de); $d <= diaUtc($ate); $d += 86400) {
    $k = gmdate('Y-m-d', $d);
    $dias[$k] = ['dia' => $k, 'visitantes' => 0, 'sessoes' => 0, 'jogaram' => 0, 'fins' => 0, 'cadastros' => 0, 'tempoMedioS' => 0];
}
foreach (sql("SELECT DATE(v.inicio$fuso) AS dia, COUNT(*) AS sessoes, COUNT(DISTINCT v.vid) AS visitantes,
    COALESCE(SUM(v.ativo_s), 0) AS total FROM visitas v$porInicio WHERE $lv$fv GROUP BY dia", $ab) as $l) {
    if (isset($dias[$l['dia']])) {
        $dias[$l['dia']]['visitantes'] = (int) $l['visitantes'];
        $dias[$l['dia']]['sessoes'] = (int) $l['sessoes'];
        $dias[$l['dia']]['tempoMedioS'] = (int) $l['sessoes'] > 0 ? (int) round((int) $l['total'] / (int) $l['sessoes']) : 0;
    }
}
foreach (sql("SELECT DATE(e.em$fuso) AS dia, e.tipo, COUNT(*) AS n, COUNT(DISTINCT e.vid) AS p FROM eventos e
    WHERE e.tipo IN ('jogo_inicio', 'jogo_fim') AND $le$nbE GROUP BY dia, e.tipo", $abE) as $l) {
    if (isset($dias[$l['dia']])) {
        if ($l['tipo'] === 'jogo_inicio') {
            $dias[$l['dia']]['jogaram'] = (int) $l['p'];
        } else {
            $dias[$l['dia']]['fins'] = (int) $l['n'];
        }
    }
}
foreach (sql("SELECT DATE(criado_em$fuso) AS dia, COUNT(*) AS n FROM usuarios WHERE criado_em >= ? AND criado_em < ?
    GROUP BY dia", $ab) as $l) {
    if (isset($dias[$l['dia']])) {
        $dias[$l['dia']]['cadastros'] = (int) $l['n'];
    }
}

// Uma passada só para hora, origem e aparelho (no máximo 24 × origens × aparelhos linhas).
$horas = [];
for ($h = 0; $h < 24; $h++) {
    $horas[$h] = ['hora' => $h, 'sessoes' => 0];
}
$porOrigem = [];
$porAparelho = [];
foreach (sql("SELECT HOUR(v.inicio$fuso) AS h, v.origem, COALESCE(v.dispositivo, 'outro') AS disp, COUNT(*) AS n
    FROM visitas v$porInicio WHERE $lv$fv GROUP BY h, v.origem, disp", $ab) as $l) {
    $n = (int) $l['n'];
    $horas[(int) $l['h']]['sessoes'] += $n;
    $porOrigem[(string) $l['origem']] = ($porOrigem[(string) $l['origem']] ?? 0) + $n;
    $porAparelho[(string) $l['disp']] = ($porAparelho[(string) $l['disp']] ?? 0) + $n;
}
$ordenar = static function (array $m, string $campo): array {
    uksort($m, static fn($x, $y) => [$m[$y], (string) $x] <=> [$m[$x], (string) $y]);
    $out = [];
    foreach (array_slice($m, 0, 20, true) as $k => $n) {
        $out[] = [$campo => (string) $k, 'sessoes' => $n];
    }
    return $out;
};
$origens = $ordenar($porOrigem, 'origem');
$dispositivos = $ordenar($porAparelho, 'dispositivo');

// ── contas ───────────────────────────────────────────────────────────────────────────────────────

$ultimos = array_map(static fn(array $l): array => [
    'apelido' => (string) $l['apelido'], 'em' => iso($l['criado_em']), 'origem' => (string) $l['origem'],
], sql('SELECT apelido, criado_em, origem FROM usuarios ORDER BY criado_em DESC, id DESC LIMIT 10')->fetchAll());

$ct = umaLinha('SELECT COUNT(*) AS total, COALESCE(SUM(criado_em >= ? AND criado_em < ?), 0) AS novas FROM usuarios', $ab);
$salvas = ['auto' => 0, 'manual' => 0, 'total' => 0, 'noPeriodo' => ['auto' => 0, 'manual' => 0]];
foreach (sql('SELECT como, COUNT(*) AS n, COALESCE(SUM(salva_em >= ? AND salva_em < ?), 0) AS p FROM carreiras GROUP BY como', $ab) as $l) {
    $k = $l['como'] === 'auto' ? 'auto' : 'manual';
    $salvas[$k] += (int) $l['n'];
    $salvas['noPeriodo'][$k] += (int) $l['p'];
    $salvas['total'] += (int) $l['n'];
}
$comCarreira = (int) umValor('SELECT COUNT(DISTINCT usuario_id) FROM carreiras');
$melhores = array_map(static fn(array $l): array => [
    'apelido' => (string) $l['apelido'], 'jogador' => (string) $l['jogador'], 'nota' => (int) $l['nota'],
    'picoOvr' => (int) $l['pico_ovr'], 'modo' => (string) $l['modo'], 'como' => (string) $l['como'], 'salvaEm' => iso($l['salva_em']),
], sql('SELECT u.apelido, c.jogador, c.nota, c.pico_ovr, c.modo, c.como, c.salva_em FROM carreiras c
    JOIN usuarios u ON u.id = c.usuario_id ORDER BY c.nota DESC, c.pico_ovr DESC, c.salva_em ASC LIMIT 10')->fetchAll());

limpezaTalvez();

$jogaram = $pessoas['jogo_inicio'] ?? 0;
$dados = [
    'periodo' => [
        'de' => $de,
        'ate' => $ate,
        'visitantes' => $visitantes,
        'novos' => $novos,
        'sessoes' => $sessoes,
        'tempoMedioS' => $sessoes > 0 ? (int) round($total / $sessoes) : 0,
        'tempoTotalH' => round($total / 3600, 1),
        'jogaram' => $jogaram,
        'inicios' => $inicios,
        'fins' => $fins,
        'partidasImersivo' => $contagem['partida_fim'] ?? 0,
        'cadastros' => $cadastros,
        'logins' => $contagem['login'] ?? 0,
        'gate' => [
            'vistos' => $pessoas['gate_ver'] ?? 0,
            'fechados' => $pessoas['gate_fechar'] ?? 0,
            'cadastrosDepois' => $cadastrosDepois,
        ],
    ],
    'dias' => array_values($dias),
    'horas' => array_values($horas),
    'origens' => $origens,
    'dispositivos' => $dispositivos,
    'funil' => [
        ['etapa' => 'Visitaram', 'n' => $visitantes],
        ['etapa' => 'Começaram um jogo', 'n' => $jogaram],
        ['etapa' => 'Terminaram um jogo', 'n' => $pessoas['jogo_fim'] ?? 0],
        ['etapa' => '5 partidas', 'n' => $cinco],
        ['etapa' => 'Criaram conta', 'n' => $cadastros],
    ],
    'notas' => [
        'media' => $notas['media'] !== null ? (int) $notas['media'] : null,
        'melhor' => $notas['melhor'] !== null ? (int) round((float) $notas['melhor']) : null,
    ],
    'ultimosCadastros' => $ultimos,
    'contas' => [
        'total' => (int) $ct['total'],
        'novas' => (int) $ct['novas'],
        'comCarreira' => $comCarreira,
        'carreiras' => $salvas,
        'melhores' => $melhores,
    ],
    'fuso' => 'America/Sao_Paulo',
    'bots' => $bots,
    'geradoEm' => gmdate('Y-m-d\TH:i:s\Z', $t),
];
if ($cacheS > 0) {
    try {
        gravarSiteConfig($chaveCache, ['em' => $t, 'dados' => $dados], 'painel');
        // os períodos que ninguém pede há mais de 1 dia saem
        sql("DELETE FROM site_config WHERE chave LIKE '\\_painel:%' AND atualizado_em < ?", [dt($t - 86400)]);
    } finally {
        if ($travou) {
            soltarTrava('lenda_painel');
        }
    }
}
responder(200, ['agora' => $agora] + $dados);

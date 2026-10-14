<?php
/**
 * LENDA · medição. POST (JSON ou text/plain, por causa do sendBeacon), até 16 KB:
 *   {"v": uuid do visitante, "s": uuid da sessão, "bot": 0|1, "ctx": {...}, "ev": [{"t": tipo, "m": modo, "d": {...}}]}
 * "hb" (batimento) só atualiza a visita; os outros tipos viram linhas em `eventos`, com `d` só nas chaves
 * conhecidas do tipo (CAMPOS_D). Tetos de linhas: 1.500 por IP a cada 10 min e 3.000 por sessão na vida
 * toda (o que passa é descartado em silêncio). Resposta: 204.
 * Com a conta ligada (cookie), cada partida terminada gravada (jogo_fim do Clássico/Imersivo ou partida_fim)
 * soma em usuarios.partidas_conta (libera os bônus) e um jogo_fim do Clássico valida a indicação pendente:
 * um UPDATE e, no máximo, uma consulta por envio que tem fim de partida (os batimentos não pagam nada disso).
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';
require __DIR__ . '/_bonus.php';

cabecalhos();

const TIPOS_EVENTO = ['view', 'hb', 'jogo_inicio', 'jogo_fim', 'partida_fim', 'gate_ver', 'gate_fechar', 'cadastro',
    'login', 'logout', 'compartilhar'];
const MODOS = ['classico', 'imersivo', 'live'];
const MAX_EVENTOS_PEDIDO = 100;
const MAX_SESSOES_NOVAS_IP = 300;
const MAX_LINHAS_IP = 1500;       // linhas em `eventos` por IP a cada 10 min (os hb não contam)
const MAX_LINHAS_SESSAO = 3000;   // linhas em `eventos` por sessão, na vida toda (visitas.eventos)
const DADOS_MAX_BYTES = 256;
const ROBO_UA = '/bot|crawl|spider|preview|headless|facebookexternalhit|slurp|curl|wget|python/i';
/** Chaves aceitas em `d`, por tipo: t = texto (até 64), n = nota/temporadas/pico (-999 a 999), q = contagem (0 a 10^7). */
const CAMPOS_D = [
    'view' => ['rota' => 't'],
    'jogo_inicio' => ['ritmo' => 't'],
    'jogo_fim' => ['nota' => 'n', 'temporadas' => 'n', 'pico' => 'n'],
    'partida_fim' => ['resultado' => 't', 'placar' => 't', 'gols' => 'q'],
    'gate_ver' => ['partidas' => 'q', 'rota' => 't'],
    'gate_fechar' => ['partidas' => 'q'],
    'compartilhar' => ['acao' => 't', 'rota' => 't'],
];

/** Número finito dentro da faixa (decimal é arredondado); fora disso, null. */
function numeroEmFaixa(mixed $v, int $min, int $max): ?int
{
    if (is_float($v)) {
        if (!is_finite($v) || $v < $min || $v > $max) {
            return null;
        }
        return (int) round($v);
    }
    return is_int($v) && $v >= $min && $v <= $max ? $v : null;
}

/** `d` só com as chaves conhecidas do tipo, valores conferidos, em JSON de até 256 bytes (ou null). */
function dadosLimpos(string $tipo, mixed $d): ?string
{
    $campos = CAMPOS_D[$tipo] ?? null;
    if ($campos === null || !is_array($d) || $d === [] || array_is_list($d)) {
        return null;
    }
    $limpo = [];
    foreach ($campos as $k => $tipoCampo) {
        if (!array_key_exists($k, $d)) {
            continue;
        }
        $x = match ($tipoCampo) {
            't' => texto($d[$k], 64),
            'n' => numeroEmFaixa($d[$k], -999, 999),
            default => numeroEmFaixa($d[$k], 0, 10_000_000),
        };
        if ($x !== null) {
            $limpo[$k] = $x;
        }
    }
    if (!$limpo) {
        return null;
    }
    $txt = json_encode($limpo, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    return is_string($txt) && strlen($txt) <= DADOS_MAX_BYTES ? $txt : null;
}

if (metodo() !== 'POST') {
    erroMetodo();
}
exigirEscrita(true);
$j = lerJson(16 * 1024, true, 16);

$vid = uuid($j['v'] ?? null);
$sid = uuid($j['s'] ?? null);
if ($vid === null || $sid === null) {
    erro(400, 'uuid', 'Identificador inválido.');
}
$lista = is_array($j['ev'] ?? null) && array_is_list($j['ev']) ? array_slice($j['ev'], 0, MAX_EVENTOS_PEDIDO) : [];

limitar('e', $sid, 240, max(1, count($lista)));
// Sessão nova: no máximo 300 por IP a cada 10 min (folgado para muita gente atrás do mesmo IP de operadora).
if (umValor('SELECT 1 FROM visitas WHERE sid = ?', [$sid]) === null) {
    limitar('e-nova', quemIp(), MAX_SESSOES_NOVAS_IP);
}

$ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
$sim = [1, true, '1'];
$bot = in_array($j['bot'] ?? 0, $sim, true) || trim($ua) === '' || preg_match(ROBO_UA, $ua) === 1;

// Eventos válidos (o resto é ignorado em silêncio).
$t = time();
$agora = dt($t);
$batimentos = 0;
$jogando = false;
$linhas = [];
foreach ($lista as $e) {
    if (!is_array($e) || !is_string($e['t'] ?? null) || !in_array($e['t'], TIPOS_EVENTO, true)) {
        continue;
    }
    if ($e['t'] === 'hb') {
        $batimentos++;
        if (in_array($e['p'] ?? 0, $sim, true)) {
            $jogando = true;
        }
        continue;
    }
    $modo = is_string($e['m'] ?? null) && in_array($e['m'], MODOS, true) ? $e['m'] : null;
    $linhas[] = [$e['t'], $modo, dadosLimpos($e['t'], $e['d'] ?? null)];
}

// Teto por IP das linhas gravadas (sem contar os hb): o que passar é descartado em silêncio; os batimentos
// do mesmo envio continuam valendo (online/jogando não somem para quem divide o IP da operadora).
if ($linhas) {
    $total = somarLimite('e-ip', quemIp(), count($linhas));
    $cabem = MAX_LINHAS_IP - ($total - count($linhas));
    if ($cabem < count($linhas)) {
        $linhas = array_slice($linhas, 0, max(0, $cabem));
    }
}

$usuario = usuarioLogado();
$uid = $usuario !== null ? (int) $usuario['id'] : null;

[$linhas, $vidSessao] = transacao(static function () use ($sid, $vid, $j, $ua, $bot, $uid, $t, $agora, $batimentos, $jogando, $linhas): array {
    $v = umaLinha('SELECT vid, ultimo, usuario_id, bot, eventos FROM visitas WHERE sid = ? FOR UPDATE', [$sid]);
    // teto da sessão na vida toda: passou de 3.000 linhas, o resto é descartado em silêncio
    $linhas = array_slice($linhas, 0, max(0, MAX_LINHAS_SESSAO - ($v === null ? 0 : (int) $v['eventos'])));
    if ($v === null) {
        // Sessão nova: o ctx só é lido aqui.
        $ctx = is_array($j['ctx'] ?? null) ? $j['ctx'] : [];
        $utm = is_array($ctx['utm'] ?? null) ? $ctx['utm'] : [];
        $us = texto($utm['source'] ?? null, 64);
        $dev = is_string($ctx['dev'] ?? null) && in_array($ctx['dev'], ['mobile', 'tablet', 'desktop'], true)
            ? $ctx['dev']
            : (preg_match('/ipad|tablet/i', $ua) ? 'tablet' : (preg_match('/mobi|android|iphone/i', $ua) ? 'mobile' : 'desktop'));
        $lang = is_string($ctx['lang'] ?? null) && preg_match('/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,2}$/', $ctx['lang'])
            ? substr($ctx['lang'], 0, 16) : null;
        $tela = is_string($ctx['tela'] ?? null) && preg_match('/^\d{2,5}x\d{2,5}$/', $ctx['tela']) ? $ctx['tela'] : null;
        sql('INSERT IGNORE INTO visitas (sid, vid, usuario_id, inicio, ultimo, ativo_s, jogando_ate, origem, utm_source,
                utm_medium, utm_campaign, dispositivo, idioma, tela, bot, eventos)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
            $sid, $vid, $uid, $agora, $agora, $jogando ? dt($t + 45) : null,
            normalizarOrigem($us, is_string($ctx['ref'] ?? null) ? $ctx['ref'] : null),
            $us, texto($utm['medium'] ?? null, 64), texto($utm['campaign'] ?? null, 100), $dev, $lang, $tela, $bot ? 1 : 0,
            count($linhas),
        ]);
    } else {
        $vid = (string) $v['vid']; // a sessão é de quem a criou
        $sets = [];
        $params = [];
        if ($batimentos > 0) {
            // Até 15 s por batimento, nunca mais que o tempo real desde o último.
            $desde = max(0, $t - (paraTempo($v['ultimo']) ?? $t));
            $sets[] = 'ativo_s = ativo_s + ?';
            $params[] = min(15 * $batimentos, $desde);
            $sets[] = 'ultimo = ?';
            $params[] = $agora;
            if ($jogando) {
                $sets[] = 'jogando_ate = ?';
                $params[] = dt($t + 45);
            }
        }
        if ($uid !== null && $v['usuario_id'] === null) {
            $sets[] = 'usuario_id = ?';
            $params[] = $uid;
        }
        if ($bot && (int) $v['bot'] === 0) {
            $sets[] = 'bot = 1';
        }
        if ($linhas) {
            $sets[] = 'eventos = eventos + ?';
            $params[] = count($linhas);
        }
        if ($sets) {
            $params[] = $sid;
            sql('UPDATE visitas SET ' . implode(', ', $sets) . ' WHERE sid = ?', $params);
        }
    }
    if ($linhas) {
        $marcas = [];
        $params = [];
        foreach ($linhas as [$tipo, $modo, $dados]) {
            $marcas[] = '(?, ?, ?, ?, ?, ?)';
            array_push($params, $sid, $vid, $tipo, $modo, $dados, $agora);
        }
        sql('INSERT INTO eventos (sid, vid, tipo, modo, dados, em) VALUES ' . implode(', ', $marcas), $params);
    }
    return [$linhas, $vid];
});

if ($uid !== null && $linhas) {
    $partidas = 0;
    $classico = false;
    foreach ($linhas as [$tipo, $modo]) {
        if ($tipo === 'partida_fim' || ($tipo === 'jogo_fim' && ($modo === 'classico' || $modo === 'imersivo'))) {
            $partidas++;
            $classico = $classico || ($tipo === 'jogo_fim' && $modo === 'classico');
        }
    }
    if ($partidas > 0) {
        registrarPartidas($uid, $partidas, $classico, $vidSessao);
    }
}

limpezaTalvez();
semCorpo();

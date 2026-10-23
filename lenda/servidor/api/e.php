<?php
/**
 * LENDA · medição. POST (JSON ou text/plain, por causa do sendBeacon), até 16 KB:
 *   {"v": uuid do visitante, "s": uuid da sessão, "bot": 0|1, "ctx": {...}, "ev": [{"t": tipo, "m": modo, "d": {...}}]}
 * "hb" (batimento) só atualiza a visita; os outros tipos viram linhas em `eventos`, com `d` só nas chaves
 * conhecidas do tipo (CAMPOS_D). Resposta: 204.
 *
 * Tetos (o que passa é descartado em silêncio):
 * - view, gate_*, compartilhar e logout: 1.500 linhas por IP a cada 10 min e 3.000 por sessão na vida toda;
 * - os eventos que importam para a conta (jogo_inicio, jogo_fim, partida_fim, cadastro, login) ficam fora desses dois
 *   (atrás de um IP de 4G cheio o jogador ainda libera os bônus) e têm um teto próprio: 20 por sessão a cada 10 min.
 * - Sessão nova: 300 por IP a cada 10 min; passou disso, só entra (sem ctx) o envio que traz início/fim de partida.
 *
 * Partida "com a conta" (usuarios.partidas_conta, que libera os bônus): um jogo_fim do Clássico só conta se o mesmo
 * aparelho (vid) mandou um jogo_inicio do Clássico pelo menos 20 s antes (nos últimos 30 dias) e nenhum fim veio
 * depois desse início (1 fim por início), e no máximo 1 partida por aparelho a cada 20 s. Com o Imersivo aberto ao público, também o
 * jogo_fim e a partida_fim dele (a partida_fim precisa de um jogo_inicio do Imersivo antes). Um jogo_fim do Clássico
 * que conta confere a indicação pendente. Tudo isso só no envio que tem fim de partida (os batimentos não pagam).
 *
 * v3.2 (CONTRATO-v32 §A): a última tela (view com d.rota em ^/[a-z0-9/_-]{0,23}$) vai para visitas.rota, o modo do
 * último batimento (hb.m; sem modo = NULL, rev3) para visitas.modo_atual e o tempo dos batimentos "jogando" para
 * visitas.jogando_s e, por modo, para jogando_classico_s / jogando_imersivo_s / jogando_live_s (rev3) ("Na área" e
 * "Tempo de jogo" do painel). Sem essas colunas (instalar.php pendente) a visita é gravada sem elas.
 *
 * v3.3 (CONTRATO-v33 §A): a partida contada entra em partidas_dia (dia de Brasília); passou de partidas_dia_max no dia, ela
 * não soma em partidas_conta. A que soma confere os desafios da conta (o mínimo de partidas pode ser o que faltava).
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';
require __DIR__ . '/_bonus.php';
require __DIR__ . '/_celular.php';
require __DIR__ . '/_desafios.php';

cabecalhos();

// v3.5: "erro" = um diálogo do site caiu por erro de JS no aparelho (d.onde = qual diálogo, d.msg = o começo da mensagem do
// navegador); conta no teto comum, como o view
const TIPOS_EVENTO = ['view', 'hb', 'jogo_inicio', 'jogo_fim', 'partida_fim', 'gate_ver', 'gate_fechar', 'cadastro',
    'login', 'logout', 'compartilhar', 'erro'];
const MODOS = ['classico', 'imersivo', 'live'];
const MAX_EVENTOS_PEDIDO = 100;
const MAX_SESSOES_NOVAS_IP = 300;
const MAX_LINHAS_IP = 1500;       // linhas em `eventos` por IP a cada 10 min (os hb não contam)
const MAX_LINHAS_SESSAO = 3000;   // linhas em `eventos` por sessão, na vida toda (visitas.eventos)
/** Os que importam para a conta: fora dos dois tetos acima, com o teto próprio por sessão. */
const ESSENCIAIS = ['jogo_inicio', 'jogo_fim', 'partida_fim', 'cadastro', 'login'];
const MAX_ESSENCIAIS_SESSAO = 20; // por sessão a cada 10 min
const DE_PARTIDA = ['jogo_inicio', 'jogo_fim', 'partida_fim'];
const PARTIDA_MIN_S = 20;         // início → fim, e entre duas partidas contadas do mesmo aparelho
const PARTIDA_JANELA_S = 30 * 86400;          // o início de uma carreira do Clássico vale por 30 dias
const PARTIDA_JANELA_IMERSIVO_S = 180 * 86400; // o de uma carreira do Imersivo (partida a partida), por 180
const DADOS_MAX_BYTES = 256;
/**
 * Robô pelo user agent. v3.5: lighthouse (PageSpeed Insights), inspectiontool e googleother (os rastreadores novos do Google,
 * que rodam JavaScript) e o buscador da prévia de link do WhatsApp ("WhatsApp/2.23.20.0 A"; o WhatsApp não tem navegador
 * próprio: quem toca no link abre o Chrome ou o Safari). O "bot" vale em qualquer lugar do UA, MENOS no nome do aparelho:
 * ver uaDeRobo.
 */
const ROBO_UA = '/bot|crawl|spider|preview|headless|lighthouse|inspectiontool|googleother|facebookexternalhit|^whatsapp\\/|slurp|curl|wget|python/i';
/** v3.5: marcas de celular com "bot" no nome (CUBOT X30, KingKong…), onde quer que apareçam (o Instagram e o Facebook repetem). */
const APARELHOS_COM_BOT = '/\\b(?:cubot)\\b/i';
/** Chaves aceitas em `d`, por tipo: t = texto (até 64), n = nota/temporadas/pico (-999 a 999), q = contagem (0 a 10^7). */
const CAMPOS_D = [
    'view' => ['rota' => 't'],
    'jogo_inicio' => ['ritmo' => 't'],
    'jogo_fim' => ['nota' => 'n', 'temporadas' => 'n', 'pico' => 'n'],
    'partida_fim' => ['resultado' => 't', 'placar' => 't', 'gols' => 'q'],
    'gate_ver' => ['partidas' => 'q', 'rota' => 't'],
    'gate_fechar' => ['partidas' => 'q'],
    'compartilhar' => ['acao' => 't', 'rota' => 't'],
    'erro' => ['onde' => 't', 'msg' => 't'],
];

/**
 * O user agent é de robô? Vazio conta como robô. v3.5: antes do ROBO_UA sai o modelo do aparelho do Android (o que vem
 * depois de "Android N;" até o ";" ou o ")": "CUBOT X30 Build/QP1A…") e as marcas de APARELHOS_COM_BOT — a visita de quem
 * tem um celular com "bot" no nome virava bot=1 e sumia do painel (bots=0). Os navegadores de dentro do TikTok
 * (BytedanceWebview), do Instagram e do WhatsApp (Custom Tab do Chrome) nunca casam.
 */
function uaDeRobo(string $ua): bool
{
    if (trim($ua) === '') {
        return true;
    }
    $semAparelho = (string) preg_replace(['/(\\bAndroid [0-9.]+;\\s*)[^;)]*/i', APARELHOS_COM_BOT], ['$1', ''], $ua);
    return preg_match(ROBO_UA, $semAparelho) === 1;
}

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

$ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
$sim = [1, true, '1'];
$bot = in_array($j['bot'] ?? 0, $sim, true) || uaDeRobo($ua);

// Eventos válidos (o resto é ignorado em silêncio), separados em essenciais e o resto.
$t = time();
$agora = dt($t);
$batimentos = 0;
$batimentosJogando = 0;
$jogando = false;
$modoAtual = null;   // v3.2: o modo do último batimento (visitas.modo_atual, "Na área"); rev3: sem modo = NULL (Menu)
$jogandoPorModo = []; // rev3: batimentos "jogando" de cada modo (visitas.jogando_<modo>_s, o "Tempo de jogo · por modo")
$mudouModo = false;   // rev3: algum batimento disse o modo (ou que não há modo): modo_atual é gravado
$rotaAtual = null;   // v3.2: a tela da última view (visitas.rota)
$essenciais = [];
$outras = [];
foreach ($lista as $e) {
    if (!is_array($e) || !is_string($e['t'] ?? null) || !in_array($e['t'], TIPOS_EVENTO, true)) {
        continue;
    }
    if ($e['t'] === 'hb') {
        $batimentos++;
        $modoHb = is_string($e['m'] ?? null) && in_array($e['m'], MODOS, true) ? $e['m'] : null;
        if (in_array($e['p'] ?? 0, $sim, true)) {
            $jogando = true;
            $batimentosJogando++;
            if ($modoHb !== null) {
                $jogandoPorModo[$modoHb] = ($jogandoPorModo[$modoHb] ?? 0) + 1;
            }
        }
        // rev3: o modo é o do último batimento; o que chega sem modo (m null ou ausente: o jogo no Menu) limpa o selo da
        // "Na área"; um modo desconhecido (texto fora da lista) é ignorado e deixa o de antes
        if ($modoHb !== null || ($e['m'] ?? null) === null) {
            $modoAtual = $modoHb;
            $mudouModo = true;
        }
        continue;
    }
    if ($e['t'] === 'view' && is_array($e['d'] ?? null) && is_string($e['d']['rota'] ?? null)
        && preg_match('#^/[a-z0-9/_-]{0,23}$#', $e['d']['rota'])) {
        $rotaAtual = $e['d']['rota'];
    }
    $modo = is_string($e['m'] ?? null) && in_array($e['m'], MODOS, true) ? $e['m'] : null;
    $dados = dadosLimpos($e['t'], $e['d'] ?? null);
    $nota = null;
    if ($e['t'] === 'jogo_fim' && is_array($e['d'] ?? null) && array_key_exists('nota', $e['d'])) {
        $nota = numeroEmFaixa($e['d']['nota'], -999, 999);
    }
    $linha = [$e['t'], $modo, $dados, $nota, count($essenciais) + count($outras)];
    if (in_array($e['t'], ESSENCIAIS, true)) {
        $essenciais[] = $linha;
    } else {
        $outras[] = $linha;
    }
}

// Sessão nova: no máximo 300 por IP a cada 10 min (folgado para muita gente atrás do mesmo IP de operadora). Passou:
// o envio com início/fim de partida ainda entra (sem ctx e só com esses eventos), o resto recebe 429.
$semCtx = false;
if (umValor('SELECT 1 FROM visitas WHERE sid = ?', [$sid]) === null && somarLimite('e-nova', quemIp()) > MAX_SESSOES_NOVAS_IP) {
    $essenciais = array_values(array_filter($essenciais, static fn(array $l): bool => in_array($l[0], DE_PARTIDA, true)));
    if (!$essenciais) {
        erroLimite();
    }
    $semCtx = true;
    $outras = [];
}

// Teto por IP das linhas comuns (sem contar os hb nem os essenciais): o que passar é descartado em silêncio; os
// batimentos do mesmo envio continuam valendo (online/jogando não somem para quem divide o IP da operadora).
if ($outras) {
    $total = somarLimite('e-ip', quemIp(), count($outras));
    $cabem = MAX_LINHAS_IP - ($total - count($outras));
    if ($cabem < count($outras)) {
        $outras = array_slice($outras, 0, max(0, $cabem));
    }
}
// Teto próprio dos essenciais, por sessão.
if ($essenciais) {
    $total = somarLimite('e-fim', $sid, count($essenciais));
    $cabem = MAX_ESSENCIAIS_SESSAO - ($total - count($essenciais));
    if ($cabem < count($essenciais)) {
        $essenciais = array_slice($essenciais, 0, max(0, $cabem));
    }
}

$usuario = usuarioLogado();
$uid = $usuario !== null ? (int) $usuario['id'] : null;

/**
 * Esta leva de eventos traz uma partida que conta para a conta? Devolve o modo ('classico' | 'imersivo') ou null.
 * Roda ANTES de gravar a leva (o que olha é o que já estava no banco). Um jogo_fim se junta ao último jogo_inicio do
 * mesmo aparelho e modo de pelo menos 20 s antes, e só se nenhum outro fim já se juntou a ele (1 fim por início): um
 * início perdido ou um fim inventado lá atrás não atrapalham as partidas seguintes.
 */
function partidaPareada(string $vid, array $linhas, int $t): ?string
{
    $imersivoPublico = (bool) siteConfig()['imersivo_publico'];
    $candidatas = [];
    foreach ($linhas as [$tipo, $modo]) {
        if ($tipo === 'jogo_fim' && ($modo === 'classico' || ($modo === 'imersivo' && $imersivoPublico))) {
            $candidatas[] = [$tipo, $modo];
        } elseif ($tipo === 'partida_fim' && $imersivoPublico && ($modo === 'imersivo' || $modo === null)) {
            $candidatas[] = [$tipo, 'imersivo'];
        }
    }
    if (!$candidatas) {
        return null;
    }
    // no máximo 1 partida por aparelho a cada 20 s (nenhum fim deste aparelho nos últimos 20 s)
    if (umValor("SELECT 1 FROM eventos WHERE vid = ? AND tipo IN ('jogo_fim', 'partida_fim') AND em > ? LIMIT 1", [$vid, dt($t - PARTIDA_MIN_S)]) !== null) {
        return null;
    }
    $ate = dt($t - PARTIDA_MIN_S);
    foreach ($candidatas as [$tipo, $modo]) {
        // a carreira do Imersivo dura muito mais (uma partida por vez): o início dela pode ser bem antigo
        $desde = dt($t - ($tipo === 'partida_fim' ? PARTIDA_JANELA_IMERSIVO_S : PARTIDA_JANELA_S));
        $inicio = umValor("SELECT MAX(em) FROM eventos WHERE vid = ? AND tipo = 'jogo_inicio' AND modo = ? AND em >= ? AND em <= ?",
            [$vid, $modo, $desde, $ate]);
        if (!is_string($inicio)) {
            continue;
        }
        if ($tipo === 'partida_fim') {
            return $modo;
        }
        if (umValor("SELECT 1 FROM eventos WHERE vid = ? AND tipo = 'jogo_fim' AND modo = ? AND em > ? LIMIT 1", [$vid, $modo, $inicio]) === null) {
            return $modo;
        }
    }
    return null;
}

/**
 * Roda a consulta com as colunas da v3.2 (rota, modo_atual, jogando_s) e, se o banco ainda não as tem (o instalar.php
 * não rodou depois de subir os arquivos), a mesma sem elas: a medição não para.
 */
function sqlComV32(string $com, array $pCom, string $sem, array $pSem): void
{
    try {
        sql($com, $pCom);
    } catch (PDOException $e) {
        if (($e->errorInfo[1] ?? null) !== 1054) {
            throw $e;
        }
        sql($sem, $pSem);
    }
}

[$linhas, $vidSessao, $contou, $cruzouMinuto, $somou] = transacao(static function () use ($sid, $vid, $j, $ua, $bot, $uid, $t, $agora, $batimentos, $batimentosJogando, $jogando, $jogandoPorModo, $mudouModo, $modoAtual, $rotaAtual, $outras, $essenciais, $semCtx): array {
    $v = umaLinha('SELECT vid, ultimo, usuario_id, bot, eventos, ativo_s FROM visitas WHERE sid = ? FOR UPDATE', [$sid]);
    // teto da sessão na vida toda (só as linhas comuns): passou de 3.000, o resto é descartado em silêncio
    $outras = array_slice($outras, 0, max(0, MAX_LINHAS_SESSAO - ($v === null ? 0 : (int) $v['eventos'])));
    $linhas = array_merge($outras, $essenciais);
    usort($linhas, static fn(array $a, array $b): int => $a[4] <=> $b[4]); // na ordem em que vieram
    $cruzouMinuto = false;
    if ($v === null) {
        // Sessão nova: o ctx só é lido aqui (e não é lido quando o IP passou do teto de sessões novas).
        $ctx = !$semCtx && is_array($j['ctx'] ?? null) ? $j['ctx'] : [];
        $utm = is_array($ctx['utm'] ?? null) ? $ctx['utm'] : [];
        $us = texto($utm['source'] ?? null, 64);
        $dev = is_string($ctx['dev'] ?? null) && in_array($ctx['dev'], ['mobile', 'tablet', 'desktop'], true)
            ? $ctx['dev']
            : (preg_match('/ipad|tablet/i', $ua) ? 'tablet' : (preg_match('/mobi|android|iphone/i', $ua) ? 'mobile' : 'desktop'));
        $lang = is_string($ctx['lang'] ?? null) && preg_match('/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,2}$/', $ctx['lang'])
            ? substr($ctx['lang'], 0, 16) : null;
        $tela = is_string($ctx['tela'] ?? null) && preg_match('/^\d{2,5}x\d{2,5}$/', $ctx['tela']) ? $ctx['tela'] : null;
        $pNova = [
            $sid, $vid, $uid, $agora, $agora, $jogando ? dt($t + 45) : null,
            normalizarOrigem($us, is_string($ctx['ref'] ?? null) ? $ctx['ref'] : null),
            $us, texto($utm['medium'] ?? null, 64), texto($utm['campaign'] ?? null, 100), $dev, $lang, $tela, $bot ? 1 : 0,
            count($linhas),
        ];
        sqlComV32('INSERT IGNORE INTO visitas (sid, vid, usuario_id, inicio, ultimo, ativo_s, jogando_ate, origem, utm_source,
                utm_medium, utm_campaign, dispositivo, idioma, tela, bot, eventos, rota, modo_atual)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', array_merge($pNova, [$rotaAtual, $modoAtual]),
            'INSERT IGNORE INTO visitas (sid, vid, usuario_id, inicio, ultimo, ativo_s, jogando_ate, origem, utm_source,
                utm_medium, utm_campaign, dispositivo, idioma, tela, bot, eventos)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', $pNova);
    } else {
        $vid = (string) $v['vid']; // a sessão é de quem a criou
        $sets = [];
        $params = [];
        $setsV32 = [];   // colunas da v3.2 (ficam de fora se o banco ainda não as tem)
        $paramsV32 = [];
        if ($batimentos > 0) {
            // Até 15 s por batimento, nunca mais que o tempo real desde o último.
            $desde = max(0, $t - (paraTempo($v['ultimo']) ?? $t));
            $somar = min(15 * $batimentos, $desde);
            $sets[] = 'ativo_s = ativo_s + ?';
            $params[] = $somar;
            $sets[] = 'ultimo = ?';
            $params[] = $agora;
            if ($jogando) {
                $sets[] = 'jogando_ate = ?';
                $params[] = dt($t + 45);
                // tempo jogando (Tempo de jogo do painel): a parte do tempo somado em que o batimento disse "jogando"
                $jogandoS = min(15 * $batimentosJogando, $somar);
                $setsV32[] = 'jogando_s = jogando_s + ?';
                $paramsV32[] = $jogandoS;
                // rev3: e de cada modo, na proporção dos batimentos de cada um (Clássico e depois Imersivo na mesma sessão
                // não põe mais tudo no último); batimento "jogando" sem modo fica só no total
                $resto = intdiv($jogandoS * array_sum($jogandoPorModo), max(1, $batimentosJogando));
                $nModos = count($jogandoPorModo);
                foreach ($jogandoPorModo as $mj => $nb) {
                    $parte = --$nModos === 0 ? $resto : intdiv($jogandoS * $nb, $batimentosJogando);
                    $resto -= $parte;
                    if ($parte > 0) {
                        $setsV32[] = 'jogando_' . $mj . '_s = jogando_' . $mj . '_s + ?';
                        $paramsV32[] = $parte;
                    }
                }
            }
            // passou de mais um minuto jogado nesta sessão: a indicação pendente (que pede tempo de jogo) é conferida
            $cruzouMinuto = $uid !== null && $somar > 0 && intdiv((int) $v['ativo_s'], 60) !== intdiv((int) $v['ativo_s'] + $somar, 60);
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
        if ($mudouModo) {
            $setsV32[] = 'modo_atual = ?';
            $paramsV32[] = $modoAtual;
        }
        if ($rotaAtual !== null) {
            $setsV32[] = 'rota = ?';
            $paramsV32[] = $rotaAtual;
        }
        if ($setsV32) {
            sqlComV32('UPDATE visitas SET ' . implode(', ', array_merge($sets, $setsV32)) . ' WHERE sid = ?', array_merge($params, $paramsV32, [$sid]),
                'UPDATE visitas SET ' . implode(', ', $sets ?: ['ultimo = ultimo']) . ' WHERE sid = ?', array_merge($params, [$sid]));
        } elseif ($sets) {
            $params[] = $sid;
            sql('UPDATE visitas SET ' . implode(', ', $sets) . ' WHERE sid = ?', $params);
        }
    }
    // partida com a conta: conferida antes de gravar a leva, somada na mesma transação (nada se perde no meio)
    $contou = $uid !== null && $essenciais ? partidaPareada($vid, $essenciais, $t) : null;
    // v3.3: no dia (Brasília), só até partidas_dia_max somam na conta
    $somou = $contou !== null && (!esquemaV33() || contarPartidaDia($uid, $t));
    if ($somou) {
        sql('UPDATE usuarios SET partidas_conta = partidas_conta + 1 WHERE id = ?', [$uid]);
    }
    if ($linhas) {
        $marcas = [];
        $params = [];
        $fins = 0;
        foreach ($linhas as [$tipo, $modo, $dados, $nota]) {
            $marcas[] = '(?, ?, ?, ?, ?, ?, ?)';
            array_push($params, $sid, $vid, $tipo, $modo, $dados, $nota, $agora);
            if ($tipo === 'partida_fim' || ($tipo === 'jogo_fim' && ($modo === 'classico' || $modo === 'imersivo'))) {
                $fins++;
            }
        }
        sql('INSERT INTO eventos (sid, vid, tipo, modo, dados, nota, em) VALUES ' . implode(', ', $marcas), $params);
        if ($fins > 0) {
            // partidas por aparelho (o funil "5 partidas" do painel)
            sql('INSERT INTO partidas_vid (vid, n, atualizado_em) VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE n = n + VALUES(n), atualizado_em = VALUES(atualizado_em)', [$vid, $fins, $agora]);
        }
    }
    return [$linhas, $vid, $contou, $cruzouMinuto, $somou];
});

if ($uid !== null && $contou === 'classico') {
    conferirIndicacao($uid, $vidSessao, true);
} elseif ($uid !== null && $cruzouMinuto) {
    conferirIndicacao($uid, null, false); // só faz algo se houver uma indicação pendente (um SELECT pela chave única)
}
// v3.3: a partida que somou pode completar o mínimo de partidas de um desafio (só com desafio valendo)
if ($uid !== null && $somou) {
    avaliarDesafiosConta($uid);
}
// v3.2 (O6): aviso de pico de gente online, no máximo uma conferência a cada 10 min (só com o aviso ligado)
avisarPicoTalvez();

limpezaTalvez();
semCorpo();

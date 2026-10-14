<?php
/**
 * LENDA · o que as rotas sabem das carreiras salvas: campos tirados do HallEntry, conferência de
 * plausibilidade, o objeto C da lista e quais carreiras de uma conta entram no Hall público. Usado por
 * carreiras.php, conta.php, admin.php, hall.php e instalar.php. Nunca é servido (o .htaccess nega _*.php).
 * Contrato: servidor/CONTRATO.md e servidor/CONTRATO-v3.md.
 */
declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

const CAMPOS_C = 'id, carreira_id, modo, jogador, numero, pais, posicao, nota, nota_v, pico_ovr, temporadas, gols, titulos,
    bolas_ouro, headline, como, salva_em, terminou_em, publica, oculta, suspeita, bonus_ovr, copas';
/** Ordem do Hall (dentro da conta e no geral): nota, pico, Bolas de Ouro, títulos, gols, e a mais antiga. */
const ORDEM_HALL = 'nota DESC, pico_ovr DESC, bolas_ouro DESC, titulos DESC, gols DESC, id ASC';
const BONUS_OVR_MAX = 20;

/** Linha do banco → C (item da lista). $noHall = ids (carreiras.id) que entram no Hall público. */
function carreiraC(array $l, array $noHall = []): array
{
    return [
        'id' => (string) $l['carreira_id'],
        'modo' => (string) $l['modo'],
        'jogador' => (string) $l['jogador'],
        'numero' => (int) $l['numero'],
        'pais' => (string) $l['pais'],
        'posicao' => (string) $l['posicao'],
        'nota' => (int) $l['nota'],
        'notaV' => $l['nota_v'] === null ? null : (int) $l['nota_v'],
        'picoOvr' => (int) $l['pico_ovr'],
        'temporadas' => (int) $l['temporadas'],
        'gols' => (int) $l['gols'],
        'titulos' => (int) $l['titulos'],
        'bolasOuro' => (int) $l['bolas_ouro'],
        'headline' => (string) $l['headline'],
        'como' => (string) $l['como'],
        'salvaEm' => iso($l['salva_em']),
        'terminouEm' => iso($l['terminou_em']),
        'publica' => (int) ($l['publica'] ?? 0) === 1,
        'noHall' => in_array((int) $l['id'], $noHall, true),
        'bonusOvr' => (int) ($l['bonus_ovr'] ?? 0),
    ];
}

function inteiro(mixed $v, int $min, int $max): int
{
    if (is_float($v) && is_finite($v)) {
        $v = (int) round(max(-1e12, min(1e12, $v)));
    }
    if (!is_int($v)) {
        return $min > 0 ? $min : 0;
    }
    return max($min, min($max, $v));
}

function campo(?stdClass $o, string $k): mixed
{
    return $o !== null && property_exists($o, $k) ? $o->{$k} : null;
}

/** Os campos da lista e do Hall, tirados do próprio HallEntry. */
function extrairCampos(stdClass $h): array
{
    $id = campo($h, 'identity') instanceof stdClass ? $h->identity : null;
    $s = campo($h, 'summary') instanceof stdClass ? $h->summary : null;
    $legacy = campo($h, 'legacy') instanceof stdClass ? $h->legacy : null;
    $totals = campo($s, 'totals') instanceof stdClass ? $s->totals : null;
    $career = campo($h, 'career') instanceof stdClass ? $h->career : null;

    $titulos = 0;
    $copas = 0;
    foreach ((array) (is_array(campo($s, 'trophies')) ? $s->trophies : []) as $t) {
        if ($t instanceof stdClass) {
            $n = inteiro(campo($t, 'count'), 0, 10000);
            $titulos += $n;
            if (campo($t, 'trophyId') === 'world-cup') {
                $copas += $n;
            }
        }
    }
    $bolas = 0;
    foreach ((array) (is_array(campo($s, 'awards')) ? $s->awards : []) as $a) {
        if ($a instanceof stdClass && campo($a, 'award') === 'ballon_dor') {
            $bolas += inteiro(campo($a, 'count'), 0, 1000);
        }
    }
    // clubes por onde passou (clubId do jogo, sem repetir, na ordem da carreira)
    $clubes = [];
    foreach ((array) (is_array(campo($s, 'clubs')) ? $s->clubs : []) as $c) {
        $cid = $c instanceof stdClass ? campo($c, 'clubId') : null;
        if (is_string($cid) && preg_match('/^[A-Za-z0-9_-]{1,16}$/', $cid) && !in_array($cid, $clubes, true) && count($clubes) < 40) {
            $clubes[] = $cid;
        }
    }
    $nota = campo($legacy, 'score');
    if (!is_int($nota) && !is_float($nota)) {
        $nota = campo($s, 'legacyScore');
    }
    $modo = campo($h, 'mode');
    $modo = $modo === 'immersive' || $modo === 'imersivo' ? 'imersivo' : 'classico';

    $terminou = null;
    $fin = campo($h, 'finishedAt');
    if (is_string($fin) && strlen($fin) <= 40) {
        $t = strtotime($fin);
        if ($t !== false && $t > 0 && $t < 32503680000) {
            $terminou = dt($t);
        }
    }
    $idade = campo($career, 'age');
    $bonus = campo($career, 'bonusOvr');
    return [
        'modo' => $modo,
        'jogador' => texto(campo($id, 'surname'), 40) ?? '',
        'numero' => inteiro(campo($id, 'number'), 0, 999),
        'pais' => texto(campo($id, 'nationality'), 8) ?? '',
        'posicao' => texto(campo($id, 'position'), 8) ?? '',
        'nota' => inteiro($nota, -999, 999),
        // versão dos pesos da Nota de Legado (LEGACY_VERSION do jogo); sem `v` = gravada antes da v2
        'nota_v' => is_int(campo($legacy, 'v')) ? inteiro($legacy->v, 0, 999) : null,
        'pico_ovr' => inteiro(campo($s, 'peakOvr'), 0, 999),
        'temporadas' => inteiro(campo($s, 'seasons'), 0, 999),
        'gols' => inteiro(campo($totals, 'goals'), 0, 1000000),
        'titulos' => $titulos,
        'bolas_ouro' => $bolas,
        'headline' => texto(campo($s, 'headline'), 120) ?? '',
        'terminou_em' => $terminou,
        'clubes' => json($clubes),
        'copas' => min($copas, 65535),
        'bonus_ovr' => is_int($bonus) || is_float($bonus) ? inteiro($bonus, 0, BONUS_OVR_MAX) : 0,
        'idade' => is_int($idade) || is_float($idade) ? inteiro($idade, 0, 999) : null,
    ];
}

/**
 * Plausibilidade (CONTRATO-v3 §4): null = ok; senão os motivos ("gols,bolas"). Carreira suspeita fica fora do
 * Hall público até o admin liberar. A versão da nota (legacy.v) não entra aqui: nota de outra versão só fica
 * fora do Hall (coluna nota_v), sem virar suspeita.
 */
function plausibilidade(array $f, int $uid, string $carreiraId): ?string
{
    $m = [];
    $t = $f['temporadas'];
    if ($t < 1 || $t > 30) {
        $m[] = 'temporadas';
    }
    if ($f['pico_ovr'] < 40 || $f['pico_ovr'] > 99) {
        $m[] = 'pico';
    }
    if ($f['nota'] < 0 || $f['nota'] > 100) {
        $m[] = 'nota';
    }
    if ($f['gols'] > 90 * max(1, $t)) {
        $m[] = 'gols';
    }
    if ($f['bolas_ouro'] > $t) {
        $m[] = 'bolas';
    }
    if ($f['titulos'] > 15 * max(1, $t)) {
        $m[] = 'titulos';
    }
    if ($f['idade'] !== null && $f['idade'] > 45) {
        $m[] = 'idade';
    }
    if ($f['bonus_ovr'] > 0) {
        // bônus de OVR só vale se foi usado nesta carreira (bonus.php usar), com o mesmo valor
        $usado = umValor('SELECT valor FROM bonus WHERE usuario_id = ? AND carreira_id = ? AND usado_em IS NOT NULL LIMIT 1', [$uid, $carreiraId]);
        if ($usado === null || (int) $usado !== $f['bonus_ovr']) {
            $m[] = 'bonus';
        }
    }
    if ($f['jogador'] !== '' && textoProibido($f['jogador'], false) !== null) {
        $m[] = 'nome';
    }
    return $m ? implode(',', $m) : null;
}

/** Os números que a plausibilidade olha mudaram? (sem mudança, fica a decisão anterior, inclusive a do admin) */
function numerosMudaram(array $antes, array $f): bool
{
    foreach (['temporadas', 'pico_ovr', 'nota', 'gols', 'bolas_ouro', 'titulos', 'bonus_ovr', 'jogador'] as $k) {
        if ((string) $antes[$k] !== (string) $f[$k]) {
            return true;
        }
    }
    return false;
}

/** Condição SQL (apelido `c`) de carreira que pode aparecer no Hall público. */
function sqlCarreiraVisivel(): string
{
    $modo = siteConfig()['imersivo_publico'] ? '' : " AND c.modo = 'classico'";
    return 'c.oculta = 0 AND c.suspeita IS NULL AND c.nota_v = ' . LENDA_NOTA_VERSAO . $modo;
}

/**
 * Quais carreiras (carreiras.id) da conta entram no Hall público agora: auto = as 3 de maior nota; manual = as
 * marcadas (até 3); nao = nenhuma. Só entre as visíveis (não ocultas, não suspeitas, nota da versão atual).
 */
function idsNoHall(int $uid, string $modoHall): array
{
    if ($modoHall === 'nao') {
        return [];
    }
    $manual = $modoHall === 'manual' ? ' AND c.publica = 1' : '';
    return array_map('intval', sql('SELECT c.id FROM carreiras c WHERE c.usuario_id = ? AND ' . sqlCarreiraVisivel() . $manual
        . ' ORDER BY c.' . str_replace(', ', ', c.', ORDEM_HALL) . ' LIMIT ' . LENDA_HALL_POR_CONTA, [$uid])->fetchAll(PDO::FETCH_COLUMN));
}

/** As 3 que o modo auto mostraria (para passar de auto a manual sem tirar nada do Hall). */
function idsAutoNoHall(int $uid): array
{
    return idsNoHall($uid, 'auto');
}

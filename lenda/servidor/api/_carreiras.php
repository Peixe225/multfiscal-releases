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
    $cid = campo($career, 'identity') instanceof stdClass ? $career->identity : null;
    $nome = is_string(campo($id, 'surname')) ? $id->surname : '';
    $nomeCareer = is_string(campo($cid, 'surname')) ? $cid->surname : '';
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
        // o que o jogo mostra como texto no resumo da carreira de outra pessoa (para o filtro de palavrões)
        'textos' => textosDoHallEntry($h),
        'nomes' => [$nome, $nomeCareer],
        // o resumo lê o nome e o país de career.identity: têm de ser os mesmos do identity (o jogo grava o mesmo objeto)
        'dados_ok' => $cid !== null && $nomeCareer === $nome
            && (string) (campo($cid, 'nationality') ?? '') === (string) (campo($id, 'nationality') ?? ''),
        // a mesma carreira com outro id (cópia, ou salva de novo para fugir da moderação) tem o mesmo resumo
        'resumo_hash' => $s !== null ? sha1(json($s)) : null,
    ];
}

/**
 * Os textos de um HallEntry que o resumo mostra para outra pessoa: nomes, título (headline), comparações, motivo
 * da aposentadoria, fase alcançada nos torneios da seleção, os 3 primeiros da Bola de Ouro de cada ano e os ids que
 * aparecem como texto quando o jogo não os conhece (troféu, clube, competição). No máximo 800 textos de 200 letras.
 */
function textosDoHallEntry(stdClass $h): array
{
    $out = [];
    $por = static function (mixed $v) use (&$out): void {
        if (is_string($v) && $v !== '' && count($out) < 800) {
            $out[] = mb_substr($v, 0, 200, 'UTF-8');
        }
    };
    $porId = static function (mixed $v) use ($por): void {
        if (is_string($v)) {
            $por(str_replace(['_', '-', '.', ':'], ' ', $v));
        }
    };
    $lista = static fn(mixed $v): array => is_array($v) ? $v : [];
    $id = campo($h, 'identity') instanceof stdClass ? $h->identity : null;
    $s = campo($h, 'summary') instanceof stdClass ? $h->summary : null;
    $career = campo($h, 'career') instanceof stdClass ? $h->career : null;
    $cid = campo($career, 'identity') instanceof stdClass ? $career->identity : null;
    $por(campo($id, 'surname'));
    $por(campo($cid, 'surname'));
    $por(campo($s, 'headline'));
    $por(campo($h, 'retiredReason'));
    $por(campo($career, 'retiredReason'));
    foreach ($lista(campo($s, 'comparisons')) as $c) {
        $por($c);
    }
    foreach ($lista(campo($s, 'trophies')) as $t) {
        $porId($t instanceof stdClass ? campo($t, 'trophyId') : null);
    }
    foreach ($lista(campo($s, 'clubs')) as $c) {
        $porId($c instanceof stdClass ? campo($c, 'clubId') : null);
    }
    $nat = campo($s, 'national') instanceof stdClass ? $s->national : null;
    foreach ($lista(campo($nat, 'tournaments')) as $t) {
        if ($t instanceof stdClass) {
            $por(campo($t, 'reached'));
            $porId(campo($t, 'competitionId'));
        }
    }
    foreach ($lista(campo($nat, 'trophies')) as $t) {
        if ($t instanceof stdClass) {
            $porId(campo($t, 'trophyId'));
            $porId(campo($t, 'competitionId'));
        }
    }
    $mundo = campo($career, 'world') instanceof stdClass ? $career->world : null;
    $temporadas = campo($mundo, 'seasons');
    foreach ($temporadas instanceof stdClass || is_array($temporadas) ? (array) $temporadas : [] as $ts) {
        foreach ($ts instanceof stdClass ? $lista(campo($ts, 'awards')) : [] as $a) {
            if (!($a instanceof stdClass) || campo($a, 'award') !== 'ballon_dor') {
                continue;
            }
            foreach (array_slice($lista(campo($a, 'ranking')), 0, 3) as $e) {
                if ($e instanceof stdClass && campo($e, 'isUser') !== true) {
                    $por(campo($e, 'name'));
                }
            }
        }
    }
    return $out;
}

/** Nota a partir da qual a carreira espera a revisão do admin para entrar no Hall (config hall_revisao_nota). */
function notaRevisao(): int
{
    $n = config()['hall_revisao_nota'] ?? 90;
    return is_int($n) && $n >= 1 ? $n : 90;
}

/**
 * Plausibilidade (CONTRATO-v3 §4 e §12): null = ok; senão os motivos ("gols,bolas"). Carreira suspeita fica fora do
 * Hall público até o admin liberar. A versão da nota (legacy.v) não entra aqui: nota de outra versão só fica fora do
 * Hall (coluna nota_v), sem virar suspeita. $pk = a própria linha (instalar.php, carreira já gravada): para a cópia,
 * só conta a de outra conta gravada antes dela; null = carreira nova (qualquer outra conta com ela conta).
 * Motivos: temporadas, pico, nota, gols, bolas, titulos, copas, idade, bonus, nome, dados, copia e, sozinho (só quando
 * não há outro), revisao = nota extraordinária, entra depois que o admin olhar.
 */
function plausibilidade(array $f, int $uid, string $carreiraId, ?int $pk = null): ?string
{
    $m = [];
    $t = $f['temporadas'];
    if ($t < 1 || $t > 30) {
        $m[] = 'temporadas';
    }
    if ($f['pico_ovr'] < 40 || $f['pico_ovr'] > 99) {
        $m[] = 'pico';
    }
    // nota alta pede pico alto (nas carreiras reais, toda nota 77+ tem pico 91+)
    if ($f['nota'] < 0 || $f['nota'] > 100 || ($f['nota'] >= 80 && $f['pico_ovr'] < 85)) {
        $m[] = 'nota';
    }
    if ($f['gols'] > 90 * max(1, $t)) {
        $m[] = 'gols';
    }
    // Bola de Ouro: nunca na 1ª temporada (todo mundo começa com OVR 50)
    if ($f['bolas_ouro'] > max(0, $t - 1)) {
        $m[] = 'bolas';
    }
    if ($f['titulos'] > 15 * max(1, $t)) {
        $m[] = 'titulos';
    }
    // uma Copa do Mundo a cada 4 anos (e uma de folga)
    if ($f['copas'] > intdiv(max(0, $t) + 3, 4) + 1) {
        $m[] = 'copas';
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
    $nomeRuim = false;
    foreach ($f['nomes'] ?? [] as $n) {
        $nomeRuim = $nomeRuim || !nomeJogadorSeguro((string) $n);
    }
    foreach ($f['textos'] ?? [] as $x) {
        if ($nomeRuim) {
            break;
        }
        $nomeRuim = textoProibido((string) $x, false) !== null;
    }
    if ($nomeRuim) {
        $m[] = 'nome';
    }
    if (($f['dados_ok'] ?? true) !== true) {
        $m[] = 'dados';
    }
    // a mesma carreira (mesmo id ou mesmo resumo) já salva por outra conta: fica a primeira dona
    $antes = $pk !== null ? ' AND id < ?' : '';
    $p = $pk !== null ? [$pk] : [];
    $copia = umValor('SELECT 1 FROM carreiras WHERE carreira_id = ? AND usuario_id <> ?' . $antes . ' LIMIT 1', array_merge([$carreiraId, $uid], $p)) !== null
        || (is_string($f['resumo_hash'] ?? null)
            && umValor('SELECT 1 FROM carreiras WHERE resumo_hash = ? AND usuario_id <> ?' . $antes . ' LIMIT 1', array_merge([$f['resumo_hash'], $uid], $p)) !== null);
    if ($copia) {
        $m[] = 'copia';
    }
    if (!$m && $f['nota'] >= notaRevisao()) {
        $m[] = 'revisao';
    }
    return $m ? substr(implode(',', $m), 0, 64) : null;
}

/** Condição SQL (apelido `c`, ou $a) de carreira que pode aparecer no Hall público. */
function sqlCarreiraVisivel(string $a = 'c'): string
{
    $modo = siteConfig()['imersivo_publico'] ? '' : " AND $a.modo = 'classico'";
    return "$a.oculta = 0 AND $a.suspeita IS NULL AND $a.nota_v = " . LENDA_NOTA_VERSAO . $modo;
}

/**
 * Condição SQL (apelidos `c` e `u`): esta carreira não é a cópia de uma que outra conta salvou antes e que pode
 * aparecer no Hall. Cada HallEntry.id aparece uma vez só no Hall, o da primeira dona.
 */
function sqlNaoECopia(): string
{
    return 'NOT EXISTS (SELECT 1 FROM carreiras c2 JOIN usuarios u2 ON u2.id = c2.usuario_id
        WHERE c2.carreira_id = c.carreira_id AND c2.id < c.id AND c2.usuario_id <> c.usuario_id AND ' . sqlCarreiraVisivel('c2') . '
          AND ' . str_replace('u.', 'u2.', LENDA_SQL_ATIVO) . " AND u2.hall_publico <> 'nao')";
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
        . ' AND ' . sqlNaoECopia() . ' ORDER BY c.' . str_replace(', ', ', c.', ORDEM_HALL) . ' LIMIT ' . LENDA_HALL_POR_CONTA, [$uid])->fetchAll(PDO::FETCH_COLUMN));
}

/** As 3 que o modo auto mostraria (para passar de auto a manual sem tirar nada do Hall). */
function idsAutoNoHall(int $uid): array
{
    return idsNoHall($uid, 'auto');
}

// ── moderação que sobrevive ao "apagar" do dono (carreiras_moderacao) ───────────────────────────

/**
 * Guarda a decisão de esconder a carreira (oculta 1 = admin, 2 = denúncias) fora da linha dela: se o dono apagar e
 * salvar de novo o mesmo HallEntry (ou o mesmo resumo com outro id), ela volta escondida.
 */
function gravarModeracao(int $pk, int $oculta): void
{
    $c = umaLinha('SELECT usuario_id, carreira_id, resumo_hash FROM carreiras WHERE id = ?', [$pk]);
    if ($c === null) {
        return;
    }
    sql('INSERT INTO carreiras_moderacao (usuario_id, carreira_id, resumo_hash, oculta, em) VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE resumo_hash = VALUES(resumo_hash), oculta = VALUES(oculta), em = VALUES(em)',
        [(int) $c['usuario_id'], (string) $c['carreira_id'], $c['resumo_hash'], $oculta, dt(time())]);
}

/** O admin devolveu a carreira ao Hall: a decisão guardada sai. */
function apagarModeracao(int $pk): void
{
    $c = umaLinha('SELECT usuario_id, carreira_id, resumo_hash FROM carreiras WHERE id = ?', [$pk]);
    if ($c === null) {
        return;
    }
    sql('DELETE FROM carreiras_moderacao WHERE usuario_id = ? AND (carreira_id = ? OR (resumo_hash IS NOT NULL AND resumo_hash = ?))',
        [(int) $c['usuario_id'], (string) $c['carreira_id'], (string) ($c['resumo_hash'] ?? '')]);
}

/** A carreira que entra agora na conta já tinha sido escondida antes (mesmo id ou mesmo resumo)? 0, 1 ou 2. */
function moderacaoHerdada(int $uid, string $carreiraId, ?string $resumoHash): int
{
    return (int) umValor('SELECT COALESCE(MAX(oculta), 0) FROM carreiras_moderacao WHERE usuario_id = ? AND (carreira_id = ? OR resumo_hash = ?)',
        [$uid, $carreiraId, $resumoHash ?? '']);
}

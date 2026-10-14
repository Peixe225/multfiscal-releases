<?php
/**
 * LENDA · carreiras salvas na conta (cada uma é um HallEntry inteiro do jogo, guardado com gzip).
 *   GET  carreiras.php            → {carreiras: [C…], limite: 200}
 *   GET  carreiras.php?id=<id>    → {carreira: HallEntry}
 *   POST {"acao":"salvar","carreira": HallEntry, "como":"auto"|"manual"} → {carreira: C}
 *   POST {"acao":"apagar","id": "<id>"}                                  → {ok: true}
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';

cabecalhos();

const LIMITE_CARREIRAS = 200;
const MAX_CARREIRA_BYTES = 600 * 1024;
const MAX_CARREIRA_GZ = 128 * 1024;          // já comprimida (uma real fica abaixo de 10 KB)
const COTA_CONTA_BYTES = 20 * 1024 * 1024;   // soma de `tamanho` (JSON) das carreiras de uma conta
const SALVAR_KB_CONTA = 2048;                // KB comprimidos por conta a cada 10 min
const SALVAR_KB_IP = 4096;                   // KB comprimidos por IP a cada 10 min
const CAMPOS_C = 'carreira_id, modo, jogador, numero, pais, posicao, nota, pico_ovr, temporadas, gols, titulos,
    bolas_ouro, headline, como, salva_em, terminou_em';

/** Linha do banco → C (item da lista). */
function carreiraC(array $l): array
{
    return [
        'id' => (string) $l['carreira_id'],
        'modo' => (string) $l['modo'],
        'jogador' => (string) $l['jogador'],
        'numero' => (int) $l['numero'],
        'pais' => (string) $l['pais'],
        'posicao' => (string) $l['posicao'],
        'nota' => (int) $l['nota'],
        'picoOvr' => (int) $l['pico_ovr'],
        'temporadas' => (int) $l['temporadas'],
        'gols' => (int) $l['gols'],
        'titulos' => (int) $l['titulos'],
        'bolasOuro' => (int) $l['bolas_ouro'],
        'headline' => (string) $l['headline'],
        'como' => (string) $l['como'],
        'salvaEm' => iso($l['salva_em']),
        'terminouEm' => iso($l['terminou_em']),
    ];
}

function inteiro(mixed $v, int $min, int $max): int
{
    if (is_float($v) && is_finite($v)) {
        $v = (int) round($v);
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

/** Os campos da lista, tirados do próprio HallEntry. */
function extrairCampos(stdClass $h): array
{
    $id = $h->identity instanceof stdClass ? $h->identity : null;
    $s = $h->summary instanceof stdClass ? $h->summary : null;
    $legacy = campo($h, 'legacy') instanceof stdClass ? $h->legacy : null;
    $totals = campo($s, 'totals') instanceof stdClass ? $s->totals : null;

    $titulos = 0;
    foreach ((array) (is_array(campo($s, 'trophies')) ? $s->trophies : []) as $t) {
        if ($t instanceof stdClass) {
            $titulos += inteiro(campo($t, 'count'), 0, 10000);
        }
    }
    $bolas = 0;
    foreach ((array) (is_array(campo($s, 'awards')) ? $s->awards : []) as $a) {
        if ($a instanceof stdClass && campo($a, 'award') === 'ballon_dor') {
            $bolas += inteiro(campo($a, 'count'), 0, 1000);
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
        if ($t !== false && $t > 0) {
            $terminou = dt($t);
        }
    }
    return [
        'modo' => $modo,
        'jogador' => texto(campo($id, 'surname'), 40) ?? '',
        'numero' => inteiro(campo($id, 'number'), 0, 999),
        'pais' => texto(campo($id, 'nationality'), 8) ?? '',
        'posicao' => texto(campo($id, 'position'), 8) ?? '',
        'nota' => inteiro($nota, -999, 999),
        'pico_ovr' => inteiro(campo($s, 'peakOvr'), 0, 999),
        'temporadas' => inteiro(campo($s, 'seasons'), 0, 999),
        'gols' => inteiro(campo($totals, 'goals'), 0, 1000000),
        'titulos' => $titulos,
        'bolas_ouro' => $bolas,
        'headline' => texto(campo($s, 'headline'), 120) ?? '',
        'terminou_em' => $terminou,
    ];
}

function lerId(mixed $v): string
{
    if (!is_string($v) || $v === '' || mb_strlen($v, 'UTF-8') > 64 || preg_match('/[\p{Cc}]/u', $v)) {
        erro(400, 'id', 'Carreira inválida.');
    }
    return $v;
}

// ── rotas ────────────────────────────────────────────────────────────────────────────────────────

$m = metodo();
if ($m !== 'GET' && $m !== 'POST') {
    erroMetodo();
}
if ($m === 'POST') {
    exigirEscrita();
    $corpo = lerJson(MAX_CARREIRA_BYTES, false, 512);
}
$u = exigirUsuario();
$uid = (int) $u['id'];
limpezaTalvez();

if ($m === 'GET') {
    if (isset($_GET['id'])) {
        $id = lerId($_GET['id']);
        $dados = umValor('SELECT dados FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uid, $id]);
        $json = is_string($dados) ? @gzdecode($dados) : false;
        if (!is_string($json) || $json === '') {
            erro(404, 'nao_encontrada', 'Carreira não encontrada.');
        }
        responderBruto(200, '{"carreira":' . $json . '}');
    }
    $lista = sql('SELECT ' . CAMPOS_C . ' FROM carreiras WHERE usuario_id = ? ORDER BY salva_em DESC, id DESC', [$uid])->fetchAll();
    responder(200, ['carreiras' => array_map('carreiraC', $lista), 'limite' => LIMITE_CARREIRAS]);
}

$acao = is_string($corpo->acao ?? null) ? $corpo->acao : '';

if ($acao === 'salvar') {
    $h = $corpo->carreira ?? null;
    if (!($h instanceof stdClass) || !($h->identity ?? null) instanceof stdClass || !($h->summary ?? null) instanceof stdClass) {
        erro(400, 'carreira_invalida', 'Carreira inválida.');
    }
    $id = $h->id ?? null;
    if (!is_string($id) || $id === '' || mb_strlen($id, 'UTF-8') > 64 || preg_match('/[\p{Cc}]/u', $id)) {
        erro(400, 'carreira_invalida', 'Carreira inválida.');
    }
    $como = $corpo->como ?? 'manual';
    if ($como !== 'auto' && $como !== 'manual') {
        erro(400, 'como', 'Modo de salvar inválido.');
    }
    $json = json($h);
    if (strlen($json) > MAX_CARREIRA_BYTES) {
        erro(413, 'grande', 'Carreira grande demais para salvar.');
    }
    $f = extrairCampos($h);
    $gz = gzencode($json, 6);
    if (strlen($gz) > MAX_CARREIRA_GZ) {
        erro(413, 'grande', 'Carreira grande demais para salvar.'); // dado que não comprime: não é uma carreira de verdade
    }
    // Limite em bytes (não em pedidos): ao entrar, o jogo sobe de uma vez até 100 carreiras 90+ do aparelho.
    $kb = intdiv(strlen($gz), 1024) + 1;
    limitar('salvar-kb', 'u' . $uid, SALVAR_KB_CONTA, $kb);
    limitar('salvar-ip-kb', quemIp(), SALVAR_KB_IP, $kb);
    $agora = dt(time());
    $linha = transacao(static function () use ($uid, $id, $como, $json, $f, $gz, $agora): array {
        sql('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', [$uid]); // uma gravação por conta de cada vez
        $existe = umValor('SELECT id FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uid, $id]);
        if ($existe === null && (int) umValor('SELECT COUNT(*) FROM carreiras WHERE usuario_id = ?', [$uid]) >= LIMITE_CARREIRAS) {
            erro(409, 'cheio', 'Sua conta já tem ' . LIMITE_CARREIRAS . ' carreiras salvas. Apague alguma para salvar esta.');
        }
        $usado = (int) umValor('SELECT COALESCE(SUM(tamanho), 0) FROM carreiras WHERE usuario_id = ? AND carreira_id <> ?', [$uid, $id]);
        if ($usado + strlen($json) > COTA_CONTA_BYTES) {
            erro(409, 'cheio', 'Sua conta está cheia. Apague alguma carreira para salvar esta.');
        }
        sql('INSERT INTO carreiras (usuario_id, carreira_id, modo, jogador, numero, pais, posicao, nota, pico_ovr, temporadas,
                gols, titulos, bolas_ouro, headline, como, dados, tamanho, terminou_em, salva_em)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE modo = VALUES(modo), jogador = VALUES(jogador), numero = VALUES(numero),
                pais = VALUES(pais), posicao = VALUES(posicao), nota = VALUES(nota), pico_ovr = VALUES(pico_ovr),
                temporadas = VALUES(temporadas), gols = VALUES(gols), titulos = VALUES(titulos),
                bolas_ouro = VALUES(bolas_ouro), headline = VALUES(headline),
                como = IF(como = \'manual\', \'manual\', VALUES(como)),
                dados = VALUES(dados), tamanho = VALUES(tamanho), terminou_em = VALUES(terminou_em), salva_em = VALUES(salva_em)',
            [$uid, $id, $f['modo'], $f['jogador'], $f['numero'], $f['pais'], $f['posicao'], $f['nota'], $f['pico_ovr'],
                $f['temporadas'], $f['gols'], $f['titulos'], $f['bolas_ouro'], $f['headline'], $como, $gz, strlen($json),
                $f['terminou_em'], $agora]);
        return umaLinha('SELECT ' . CAMPOS_C . ' FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uid, $id]);
    });
    responder(200, ['carreira' => carreiraC($linha)]);
}

if ($acao === 'apagar') {
    $id = lerId($corpo->id ?? null);
    sql('DELETE FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uid, $id]);
    responder(200, ['ok' => true]);
}

erro(400, 'acao', 'Ação desconhecida.');

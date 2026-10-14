<?php
/**
 * LENDA · Hall público: as melhores carreiras dos jogadores (até 3 por conta), servidas da fotografia
 * (hall_foto), que é refeita no máximo a cada hall_intervalo_min. Público, sem login, com cache de 5 min.
 *   GET  hall.php?pais=BOL&clube=<clubId>&pagina=1 → {atualizadoEm, proximaEm, total, pagina, porPagina, itens}
 *   GET  hall.php?id=<HallEntry.id>                → {carreira: HallEntry, apelido, posicao} (só se está na foto)
 *   POST hall.php {"acao":"denunciar","id","motivo":"nome"|"trapaca"|"outro","texto"?} → {ok: true} (logado)
 * Contrato: servidor/CONTRATO-v3.md §4.
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';
require __DIR__ . '/_hall.php';

cabecalhos();

const HALL_POR_PAGINA = 50;
const DENUNCIAS_PARA_OCULTAR = 5;   // contas diferentes
const DENUNCIAS_DIA_CONTA = 10;

/** Resposta pública: navegador e CDN guardam por 5 min (a fotografia muda no máximo de hora em hora). */
function cachePublico(): void
{
    header('Cache-Control: public, max-age=300');
    header('Vary: Accept-Encoding');
}

function lerIdHall(mixed $v): string
{
    if (!is_string($v) || $v === '' || mb_strlen($v, 'UTF-8') > 64 || preg_match('/[\p{Cc}]/u', $v)) {
        erro(400, 'id', 'Carreira inválida.');
    }
    return $v;
}

$m = metodo();

if ($m === 'GET') {
    $e = hallTalvez();
    if (isset($_GET['id'])) {
        $id = lerIdHall($_GET['id']);
        $l = umaLinha('SELECT f.id AS posicao, f.apelido, c.dados FROM hall_foto f
            JOIN carreiras c ON c.id = f.carreira_pk JOIN usuarios u ON u.id = c.usuario_id
            WHERE f.carreira_id = ? AND ' . sqlCarreiraVisivel() . ' AND ' . LENDA_SQL_ATIVO . " AND u.hall_publico <> 'nao'", [$id]);
        $json = $l !== null && is_string($l['dados']) ? @gzdecode($l['dados']) : false;
        if (!is_string($json) || $json === '') {
            erro(404, 'nao_encontrada', 'Essa carreira não está no Hall público.');
        }
        cachePublico();
        responderBruto(200, '{"carreira":' . $json . ',"apelido":' . json((string) $l['apelido']) . ',"posicao":' . (int) $l['posicao'] . '}');
    }

    $pais = $_GET['pais'] ?? '';
    $clube = $_GET['clube'] ?? '';
    if (!is_string($pais) || ($pais !== '' && !preg_match('/^[A-Za-z]{2,4}$/', $pais))
        || !is_string($clube) || ($clube !== '' && !preg_match('/^[A-Za-z0-9_-]{1,16}$/', $clube))) {
        erro(400, 'filtro', 'Filtro inválido.');
    }
    $pais = strtoupper($pais);
    $pagina = paginaPedida();
    $offset = ($pagina - 1) * HALL_POR_PAGINA;
    $onde = [];
    $params = [];
    if ($clube !== '') {
        $de = 'hall_foto_clubes hc JOIN hall_foto f ON f.id = hc.foto_id';
        $onde[] = 'hc.club_id = ?';
        $params[] = $clube;
        $ordem = 'hc.foto_id';
    } else {
        $de = 'hall_foto f';
        $ordem = 'f.id';
    }
    if ($pais !== '') {
        $onde[] = 'f.pais = ?';
        $params[] = $pais;
    }
    $w = $onde ? ' WHERE ' . implode(' AND ', $onde) : '';
    $total = $onde ? (int) umValor("SELECT COUNT(*) FROM $de$w", $params) : (int) umValor('SELECT COUNT(*) FROM hall_foto');
    $linhas = sql("SELECT f.* FROM $de$w ORDER BY $ordem LIMIT " . HALL_POR_PAGINA . ' OFFSET ' . $offset, $params)->fetchAll();
    $itens = [];
    foreach ($linhas as $i => $l) {
        $itens[] = itemHall($l, $offset + $i + 1);
    }
    $em = $e !== null ? (string) ($e['em'] ?? '') : '';
    $t = $em !== '' ? strtotime($em) : false;
    cachePublico();
    responder(200, [
        'atualizadoEm' => $t !== false && $em !== '' ? gmdate('Y-m-d\TH:i:s\Z', $t) : null,
        'proximaEm' => $t !== false && $em !== '' ? gmdate('Y-m-d\TH:i:s\Z', $t + hallIntervaloS()) : null,
        'total' => $total,
        'pagina' => $pagina,
        'porPagina' => HALL_POR_PAGINA,
        'filtro' => ['pais' => $pais !== '' ? $pais : null, 'clube' => $clube !== '' ? $clube : null],
        'itens' => $itens,
    ]);
}

if ($m !== 'POST') {
    erroMetodo();
}

exigirEscrita();
$j = lerJson(16 * 1024);
$u = exigirUsuario();
$uid = (int) $u['id'];
$acao = is_string($j['acao'] ?? null) ? $j['acao'] : '';
if ($acao !== 'denunciar') {
    erro(400, 'acao', 'Ação desconhecida.');
}
$id = lerIdHall($j['id'] ?? null);
$motivo = $j['motivo'] ?? null;
if (!in_array($motivo, ['nome', 'trapaca', 'outro'], true)) {
    erro(400, 'motivo', 'Escolha o motivo: nome ofensivo, trapaça ou outro.');
}
$texto = array_key_exists('texto', $j) && $j['texto'] !== null ? texto($j['texto'], 300) : null;
limitar('dia-denunciar', 'u' . $uid, DENUNCIAS_DIA_CONTA, 1, 86400);
$f = umaLinha('SELECT carreira_pk, usuario_id FROM hall_foto WHERE carreira_id = ?', [$id]);
if ($f === null) {
    erro(404, 'nao_encontrada', 'Essa carreira não está no Hall público.');
}
$pk = (int) $f['carreira_pk'];
if ((int) $f['usuario_id'] === $uid) {
    erro(400, 'propria', 'Não dá para denunciar a própria carreira.');
}
$ocultou = transacao(static function () use ($pk, $uid, $motivo, $texto): bool {
    sql('INSERT IGNORE INTO denuncias (carreira_pk, usuario_id, motivo, texto, criada_em, status) VALUES (?, ?, ?, ?, ?, \'aberta\')',
        [$pk, $uid, $motivo, $texto, dt(time())]);
    $abertas = (int) umValor("SELECT COUNT(*) FROM denuncias WHERE carreira_pk = ? AND status = 'aberta'", [$pk]);
    if ($abertas >= DENUNCIAS_PARA_OCULTAR) {
        // 5 contas diferentes: some do Hall até o admin decidir (oculta = 2, pelas denúncias)
        return sql('UPDATE carreiras SET oculta = 2 WHERE id = ? AND oculta = 0', [$pk])->rowCount() === 1;
    }
    return false;
});
if ($ocultou) {
    tirarDoHall($pk);
}
responder(200, ['ok' => true]);

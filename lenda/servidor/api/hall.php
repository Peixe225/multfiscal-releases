<?php
/**
 * LENDA · Hall público: as melhores carreiras dos jogadores (até 3 por conta), servidas da fotografia
 * (hall_foto), que é refeita no máximo a cada hall_intervalo_min (o primeiro pedido depois do prazo responde
 * com a anterior e refaz logo em seguida). Público, sem login; navegador e CDN guardam 5 min.
 *   GET  hall.php?pais=BOL&clube=<clubId>&pagina=1 → {atualizadoEm, proximaEm, total, pagina, porPagina, itens}
 *   GET  hall.php?id=<HallEntry.id>                → {carreira: HallEntry, apelido, posicao, destaque, perfil} (só se está na foto)
 * v3.3: cada item (e o ?id=) leva `perfil` = o código de convite da conta (o link #/jogador/CODIGO do perfil público).
 *   POST hall.php {"acao":"denunciar","id","motivo":"nome"|"trapaca"|"outro","texto"?} → {ok: true} (logado)
 * Contrato: servidor/CONTRATO-v3.md §4.
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';
require __DIR__ . '/_hall.php';
require __DIR__ . '/_celular.php';

cabecalhos();

const HALL_POR_PAGINA = 50;
const DENUNCIAS_PARA_OCULTAR = 5;   // contas diferentes, que valem (abaixo)
const DENUNCIAS_DIA_CONTA = 10;
const DENUNCIAS_IP = 5;             // por IP a cada 10 min (o código do IP some em ~20 min, como os outros limites)
/** Para a denúncia esconder sozinha: conta com mais de 24 h e pelo menos 3 partidas terminadas com ela. */
const DENUNCIANTE_IDADE_S = 86400;
const DENUNCIANTE_PARTIDAS = 3;
/** As 10 primeiras do Hall geral nunca saem só pelas denúncias: quem decide é o admin (a fila do painel mostra). */
const DENUNCIA_TOPO_PROTEGIDO = 10;

function lerIdHall(mixed $v): string
{
    if (!is_string($v) || $v === '' || mb_strlen($v, 'UTF-8') > 64 || preg_match('/[\p{Cc}]/u', $v)) {
        erro(400, 'id', 'Carreira inválida.');
    }
    return $v;
}

/**
 * Manda a resposta pública e, se a fotografia venceu, refaz depois de responder (no LiteSpeed/FPM o visitante
 * não espera; sem isso, só o pedido que refaz demora um pouco). Os outros pedidos leem a anterior enquanto isso.
 */
function responderHall(string $corpo, bool $refazer): never
{
    header('Cache-Control: public, max-age=300');
    header('Vary: Accept-Encoding');
    terminarRespostaBruta(200, $corpo);
    if ($refazer) {
        try {
            refazerFoto(false, 0);
        } catch (Throwable $e) {
            error_log('LENDA hall (refazer depois da resposta): ' . $e->getMessage());
        }
    }
    exit;
}

$m = metodo();

if ($m === 'GET') {
    [$e, $refazer] = hallTalvez();
    if (isset($_GET['id'])) {
        $id = lerIdHall($_GET['id']);
        // v3.2 (H12): o selo "Destaque" também no resumo aberto pelo link (só com o banco da v3.2, S22)
        $l = umaLinha('SELECT f.id AS posicao, f.apelido, u.codigo_convite, ' . (esquemaV32() ? 'f.destaque' : '0 AS destaque') . ', c.dados FROM hall_foto f
            JOIN carreiras c ON c.id = f.carreira_pk JOIN usuarios u ON u.id = c.usuario_id
            WHERE f.carreira_id = ? AND ' . sqlCarreiraVisivel() . ' AND ' . LENDA_SQL_ATIVO . ' AND ' . sqlContaNoHall() . "
              AND (u.hall_publico = 'auto' OR (u.hall_publico = 'manual' AND c.publica = 1))", [$id]);
        $json = $l !== null && is_string($l['dados']) ? @gzdecode($l['dados']) : false;
        if (!is_string($json) || $json === '') {
            erro(404, 'nao_encontrada', 'Essa carreira não está no Hall público.');
        }
        responderHall('{"carreira":' . $json . ',"apelido":' . json((string) $l['apelido']) . ',"posicao":' . (int) $l['posicao']
            . ',"destaque":' . ((int) $l['destaque'] === 1 ? 'true' : 'false') . ',"perfil":' . json($l['codigo_convite'] !== null ? (string) $l['codigo_convite'] : null)
            . '}', $refazer);
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
    $linhas = sql("SELECT f.*, u.codigo_convite AS perfil_codigo FROM $de LEFT JOIN usuarios u ON u.id = f.usuario_id$w ORDER BY $ordem LIMIT "
        . HALL_POR_PAGINA . ' OFFSET ' . $offset, $params)->fetchAll();
    $itens = [];
    foreach ($linhas as $i => $l) {
        $itens[] = itemHall($l, $offset + $i + 1);
    }
    $em = $e !== null ? (string) ($e['em'] ?? '') : '';
    $t = $em !== '' ? strtotime($em) : false;
    responderHall(json([
        'atualizadoEm' => $t !== false && $em !== '' ? gmdate('Y-m-d\TH:i:s\Z', $t) : null,
        'proximaEm' => $t !== false && $em !== '' ? gmdate('Y-m-d\TH:i:s\Z', $t + hallIntervaloS()) : null,
        'total' => $total,
        'pagina' => $pagina,
        'porPagina' => HALL_POR_PAGINA,
        'filtro' => ['pais' => $pais !== '' ? $pais : null, 'clube' => $clube !== '' ? $clube : null],
        'itens' => $itens,
    ]), $refazer);
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
$f = umaLinha('SELECT id, carreira_pk, usuario_id FROM hall_foto WHERE carreira_id = ?', [$id]);
if ($f === null) {
    erro(404, 'nao_encontrada', 'Essa carreira não está no Hall público.');
}
$pk = (int) $f['carreira_pk'];
if ((int) $f['usuario_id'] === $uid) {
    erro(400, 'propria', 'Não dá para denunciar a própria carreira.');
}
// repetir na mesma carreira: ok, sem contar de novo (nem gastar o limite do dia)
if (umValor('SELECT 1 FROM denuncias WHERE carreira_pk = ? AND usuario_id = ?', [$pk, $uid]) !== null) {
    responder(200, ['ok' => true]);
}
limitar('dia-denunciar', 'u' . $uid, DENUNCIAS_DIA_CONTA, 1, 86400);
limitar('denunciar-ip', quemIp(), DENUNCIAS_IP);
$protegida = (int) $f['id'] <= DENUNCIA_TOPO_PROTEGIDO;
$ocultou = transacao(static function () use ($pk, $uid, $motivo, $texto, $protegida): bool {
    // uma denúncia da mesma carreira de cada vez: a contagem abaixo vê as que acabaram de entrar
    if (umValor('SELECT id FROM carreiras WHERE id = ? FOR UPDATE', [$pk]) === null) {
        return false; // a carreira foi apagada agora há pouco
    }
    sql('INSERT IGNORE INTO denuncias (carreira_pk, usuario_id, motivo, texto, criada_em, status) VALUES (?, ?, ?, ?, ?, \'aberta\')',
        [$pk, $uid, $motivo, $texto, dt(time())]);
    if ($protegida) {
        return false; // topo do Hall: só sinaliza na fila do painel
    }
    // só contam as de contas com mais de 24 h e algumas partidas: contas criadas na hora não escondem ninguém
    $validas = (int) umValor("SELECT COUNT(*) FROM denuncias d JOIN usuarios u ON u.id = d.usuario_id
        WHERE d.carreira_pk = ? AND d.status = 'aberta' AND u.criado_em <= ? AND u.partidas_conta >= ?",
        [$pk, dt(time() - DENUNCIANTE_IDADE_S), DENUNCIANTE_PARTIDAS]);
    if ($validas >= DENUNCIAS_PARA_OCULTAR) {
        // 5 contas diferentes que valem: some do Hall até o admin decidir (oculta = 2, pelas denúncias)
        if (sql('UPDATE carreiras SET oculta = 2 WHERE id = ? AND oculta = 0', [$pk])->rowCount() === 1) {
            gravarModeracao($pk, 2);
            return true;
        }
    }
    return false;
});
if ($ocultou) {
    tirarDoHall($pk);
}
// v3.2 (O6): aviso no celular do admin, se ligado — depois de responder, sem o jogador esperar
terminarResposta(200, ['ok' => true]);
try {
    avisarDenunciaNova($ocultou);
} catch (Throwable $e) {
    error_log('LENDA aviso no celular: ' . $e->getMessage());
}
exit;

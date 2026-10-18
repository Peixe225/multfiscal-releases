<?php
/**
 * LENDA · conquistas na conta (CONTRATO-v3 §5).
 *   GET  conquistas.php              → {conquistas: [{id, em}]}                       (logado)
 *   POST {"acao":"sincronizar","conquistas":[{id, em}]} → a união, com a data mais antiga (logado)
 *   GET  conquistas.php?raridade=1   → {jogadores, porConquista: {id: n}, atualizadoEm} (público, cache de 1 h)
 * v3.3: depois de sincronizar, confere os desafios da conta (o de todas as conquistas, CONTRATO-v33 §A).
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';
require __DIR__ . '/_desafios.php';

cabecalhos();

const MAX_POR_ENVIO = 500;
const MAX_POR_CONTA = 500;
const RARIDADE_ESTADO = '_raridade';
const RARIDADE_TTL_S = 3600;
const RARIDADE_MAX_IDS = 1500;
const DATA_MINIMA = 1735689600; // 2025-01-01: data mais velha que isso é inventada

/** Lista de conquistas da conta, a mais antiga primeiro. */
function conquistasDe(int $uid): array
{
    return array_map(static fn(array $l): array => ['id' => (string) $l['conquista_id'], 'em' => iso($l['em'])],
        sql('SELECT conquista_id, em FROM conquistas_usuario WHERE usuario_id = ? ORDER BY em, conquista_id', [$uid])->fetchAll());
}

/** Conta quantas contas ativas têm cada conquista (só ids que passam pelo filtro de palavras). */
function calcularRaridade(): array
{
    $jogadores = (int) umValor('SELECT COUNT(DISTINCT cu.usuario_id) FROM conquistas_usuario cu JOIN usuarios u ON u.id = cu.usuario_id
        WHERE ' . LENDA_SQL_ATIVO);
    $por = [];
    foreach (sql('SELECT cu.conquista_id, COUNT(*) AS n FROM conquistas_usuario cu JOIN usuarios u ON u.id = cu.usuario_id
        WHERE ' . LENDA_SQL_ATIVO . ' GROUP BY cu.conquista_id ORDER BY n DESC, cu.conquista_id LIMIT ' . RARIDADE_MAX_IDS) as $l) {
        $cid = (string) $l['conquista_id'];
        if (textoProibido(str_replace(['_', '.', ':', '-'], ' ', $cid), false) === null) {
            $por[$cid] = (int) $l['n'];
        }
    }
    return ['jogadores' => $jogadores, 'porConquista' => (object) $por, 'atualizadoEm' => gmdate('Y-m-d\TH:i:s\Z')];
}

$m = metodo();

if ($m === 'GET' && ($_GET['raridade'] ?? '') === '1') {
    $r = lerEstado(RARIDADE_ESTADO);
    $t = is_array($r) ? strtotime((string) ($r['atualizadoEm'] ?? '')) : false;
    if (!is_array($r) || $t === false || $t + RARIDADE_TTL_S <= time()) {
        // vencido: um pedido recalcula (trava); os outros respondem o anterior, se houver
        if (pegarTrava('lenda_raridade', $r === null ? 5 : 0)) {
            try {
                $r = calcularRaridade();
                gravarSiteConfig(RARIDADE_ESTADO, $r, 'auto');
            } finally {
                soltarTrava('lenda_raridade');
            }
        } elseif ($r === null) {
            $r = calcularRaridade();
        }
    }
    header('Cache-Control: public, max-age=3600');
    responder(200, ['jogadores' => (int) ($r['jogadores'] ?? 0), 'porConquista' => (object) ($r['porConquista'] ?? []),
        'atualizadoEm' => $r['atualizadoEm'] ?? null]);
}

if ($m !== 'GET' && $m !== 'POST') {
    erroMetodo();
}
if ($m === 'POST') {
    exigirEscrita();
    $j = lerJson(64 * 1024);
}
$u = exigirUsuario();
$uid = (int) $u['id'];

if ($m === 'GET') {
    responder(200, ['conquistas' => conquistasDe($uid)]);
}

$acao = is_string($j['acao'] ?? null) ? $j['acao'] : '';
if ($acao !== 'sincronizar') {
    erro(400, 'acao', 'Ação desconhecida.');
}
$lista = $j['conquistas'] ?? null;
if (!is_array($lista) || ($lista !== [] && !array_is_list($lista))) {
    erro(400, 'dados', 'Lista de conquistas inválida.');
}
if (count($lista) > MAX_POR_ENVIO) {
    erro(400, 'dados', 'Mande no máximo ' . MAX_POR_ENVIO . ' conquistas por vez.');
}
limitar('conquistas', 'u' . $uid, 60);
$agora = time();
$novas = [];
foreach ($lista as $c) {
    $cid = is_array($c) ? ($c['id'] ?? null) : null;
    if (!is_string($cid) || !preg_match('/^[a-z0-9_.:-]{1,64}$/', $cid)) {
        continue; // id fora do formato: ignora (as outras entram)
    }
    $em = is_array($c) && is_string($c['em'] ?? null) && strlen($c['em']) <= 40 ? strtotime($c['em']) : false;
    if ($em === false || $em > $agora) {
        $em = $agora; // sem data, data ruim ou no futuro: agora
    }
    $em = max(DATA_MINIMA, $em);
    if (!isset($novas[$cid]) || $em < $novas[$cid]) {
        $novas[$cid] = $em;
    }
}
if ($novas) {
    transacao(static function () use ($uid, $novas): void {
        sql('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', [$uid]);
        $tem = array_flip(sql('SELECT conquista_id FROM conquistas_usuario WHERE usuario_id = ?', [$uid])->fetchAll(PDO::FETCH_COLUMN));
        $cabem = MAX_POR_CONTA - count($tem);
        $vals = [];
        $params = [];
        foreach ($novas as $cid => $em) {
            if (!isset($tem[$cid])) {
                if ($cabem <= 0) {
                    continue; // conta no teto: só atualiza as que já tem
                }
                $cabem--;
            }
            $vals[] = '(?, ?, ?)';
            array_push($params, $uid, (string) $cid, dt($em));
        }
        if ($vals) {
            sql('INSERT INTO conquistas_usuario (usuario_id, conquista_id, em) VALUES ' . implode(', ', $vals)
                . ' ON DUPLICATE KEY UPDATE em = LEAST(em, VALUES(em))', $params);
        }
    });
    avaliarDesafiosConta($uid);
}
responder(200, ['conquistas' => conquistasDe($uid)]);

<?php
/**
 * LENDA · bônus de OVR para a próxima carreira (CONTRATO-v3 §6). Tudo logado.
 *   GET  bonus.php                                   → {liberado, faltamPartidas, disponiveis, guardados, usados,
 *                                                       indicacoes, compartilharHoje, compartilharValor, codigoConvite, linkConvite}
 *   POST {"acao":"usar","carreiraId"}                → {valor, origem?}  (idempotente por carreira)
 *   POST {"acao":"compartilhei","carreiraId"}        → {ganhou: 0|N, motivo?: "ja_hoje"|"bloqueado"}
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';
require __DIR__ . '/_bonus.php';

cabecalhos();

$m = metodo();
if ($m !== 'GET' && $m !== 'POST') {
    erroMetodo();
}
if ($m === 'POST') {
    exigirEscrita();
    $j = lerJson(16 * 1024);
}
$u = exigirUsuario();
$uid = (int) $u['id'];

if ($m === 'GET') {
    responder(200, resumoBonus($u));
}

$acao = is_string($j['acao'] ?? null) ? $j['acao'] : '';
$cid = $j['carreiraId'] ?? null;
if (!is_string($cid) || $cid === '' || mb_strlen($cid, 'UTF-8') > 64 || preg_match('/[\p{Cc}]/u', $cid)) {
    erro(400, 'id', 'Carreira inválida.');
}
limitar('bonus', 'u' . $uid, 60);

if ($acao === 'usar') {
    responder(200, usarBonus($uid, $cid));
}
if ($acao === 'compartilhei') {
    responder(200, compartilhouCarreira($uid));
}
erro(400, 'acao', 'Ação desconhecida.');

<?php
/**
 * LENDA · perfil público de um jogador (CONTRATO-v33 §A), pelo código de convite da conta (o mesmo do convite: o link é
 * oprojeto.online/lenda/?c=CODIGO#/jogador/CODIGO, e quem abre também chega como convidado).
 *   GET perfil.php?c=CODIGO → {codigo, apelido, desde, conquistas, carreiras: [até 3, os itens do hall.php], desafiosVencidos:
 *                             [slug], link} (público, cache de 120 s)
 * Conta que escolheu não aparecer no Hall ("nao"), suspensa ou código que não existe: 404. As carreiras são as dela que
 * estão na fotografia do Hall público agora (conta tirada do Hall pelo admin: nenhuma).
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';
require __DIR__ . '/_desafios.php';

cabecalhos();

if (metodo() !== 'GET') {
    erroMetodo();
}
limitar('perfil-ip', quemIp(), 300);
$codigo = lerCodigoConvite($_GET['c'] ?? null);
$u = $codigo !== null ? umaLinha('SELECT * FROM usuarios WHERE codigo_convite = ?', [$codigo]) : null;
if ($u === null || ($u['hall_publico'] ?? 'auto') === 'nao' || contaSuspensa($u)) {
    erro(404, 'nao_encontrado', 'Esse perfil não existe ou não é público.');
}
$uid = (int) $u['id'];
$carreiras = [];
foreach (sql('SELECT f.*, ? AS perfil_codigo FROM hall_foto f WHERE f.usuario_id = ? ORDER BY f.id LIMIT ' . LENDA_HALL_POR_CONTA, [$codigo, $uid])->fetchAll() as $l) {
    $carreiras[] = itemHall($l, (int) $l['id']);
}
$vencidos = esquemaV33() ? array_map('strval', sql('SELECT slug FROM desafios WHERE vencedor_usuario_id = ? AND vencido_em IS NOT NULL ORDER BY vencido_em',
    [$uid])->fetchAll(PDO::FETCH_COLUMN)) : [];
header('Cache-Control: public, max-age=120');
responder(200, [
    'codigo' => $codigo,
    'apelido' => (string) $u['apelido'],
    'desde' => iso($u['criado_em']),
    'conquistas' => (int) umValor('SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id = ?', [$uid]),
    'carreiras' => $carreiras,
    'desafiosVencidos' => $vencidos,
    'link' => linkConvite($codigo) . '#/jogador/' . $codigo,
]);

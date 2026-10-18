<?php
/**
 * LENDA · desafios com prêmio (As Taças do Rei, CONTRATO-v33 §A).
 *   GET desafios.php      → {desafios: [{slug, titulo, descricao, regulamento, premio, criterio, requisitos, ativo, inicio, fim,
 *                           encerrado, vencedor: {apelido, jogador, carreiraId, perfil, em, declaradoEm}|null, pendentes}]}
 *                           (público, cache de 60 s; só os ativos e os que já têm vencedor)
 *   GET desafios.php?eu=1 → a mesma lista, cada desafio com `eu` (o checklist da conta logada e o candidato dela); sem
 *                           sessão, 401. no-store.
 * O prêmio é o texto que o admin escreveu (premio).
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';
require __DIR__ . '/_desafios.php';

cabecalhos();

if (metodo() !== 'GET') {
    erroMetodo();
}
$eu = ($_GET['eu'] ?? '') === '1';
if (!$eu) {
    // público como o hall.php: sem escrita no banco (o navegador e a CDN guardam 60 s)
    header('Cache-Control: public, max-age=60');
    responder(200, ['desafios' => desafiosPublicos()]);
}
$u = exigirUsuario();
limitar('desafios-eu', 'u' . $u['id'], 120);
$lista = desafiosPublicos();
if ($lista) {
    $porSlug = [];
    foreach (sql('SELECT * FROM desafios WHERE ativo = 1 OR vencido_em IS NOT NULL')->fetchAll() as $d) {
        $porSlug[(string) $d['slug']] = $d;
    }
    $hall = null;
    foreach ($lista as &$item) {
        $d = $porSlug[$item['slug']] ?? null;
        $item['eu'] = $d !== null ? euNoDesafio($d, $u, $hall) : null;
    }
    unset($item);
}
responder(200, ['desafios' => $lista]);

<?php
/**
 * LENDA · prévia de link para compartilhar (CONTRATO-v34 §A). Público, HTML (não é JSON), sem login e sem escrita no banco
 * (salvo o teto de imagens desenhadas). Quem abre vai direto para o jogo (meta refresh); quem só lê as meta tags (WhatsApp,
 * Facebook, X, Telegram, Discord…) vê o cartão da carreira ou do perfil.
 *   GET v.php?id=<HallEntry.id>[&c=<código de quem compartilha>] → a carreira do Hall público; leva a
 *       /lenda/?c=<código>#/resumo?id=<id>&de=comunidade
 *   GET v.php?c=<código>                                        → o perfil público; leva a /lenda/?c=<código>#/jogador/<código>
 *   GET v.php?…&png=1                                           → a imagem 1200×630 (PNG), guardada fora do public_html
 * Carreira fora do Hall (oculta, suspeita, privada, apagada), perfil fechado, código ou id que não existe: a prévia genérica
 * do LENDA (200), sem dado nenhum de ninguém. Cache: a página 5 min, a imagem 1 dia (o link da imagem muda quando ela muda).
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';
require __DIR__ . '/_hall.php';
require __DIR__ . '/_desafios.php';
require __DIR__ . '/_previa.php';

/** Os cabeçalhos da prévia (os do cabecalhos() são de JSON). */
function cabecalhosPrevia(string $tipo, int $maxAge): void
{
    header('Content-Type: ' . $tipo);
    header('Cache-Control: public, max-age=' . $maxAge);
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('X-Robots-Tag: noindex');
    header('X-LiteSpeed-Cache-Control: no-cache');
}

$m = metodo();
if ($m !== 'GET' && $m !== 'HEAD') {
    cabecalhos();
    erroMetodo();
}
$id = $_GET['id'] ?? null;
// §E: id com espaço nas pontas não é de carreira nenhuma (o jogo nunca gera): a genérica. Sem isso, "id + espaços" achava a
// mesma carreira no banco (PAD SPACE) e cada variação desenhava e guardava uma imagem nova
$id = is_string($id) && $id !== '' && $id === trim($id) && mb_strlen($id, 'UTF-8') <= 64 && !preg_match('/[\p{Cc}]/u', $id) ? $id : null;
$codigo = lerCodigoConvite($_GET['c'] ?? null);
$png = ($_GET['png'] ?? '') === '1';
$pediu = $id !== null || $codigo !== null || isset($_GET['id']);
try {
    $p = $id !== null ? previaCarreira($id, $codigo) : ($codigo !== null ? previaPerfil($codigo) : null);
} catch (Throwable $e) {
    error_log('LENDA prévia: ' . $e->getMessage());
    $p = null; // banco fora do ar: a prévia genérica, nunca um erro para quem só quer abrir o jogo
}
// §E: pediu uma carreira ou um perfil e veio a genérica (fora do Hall agora, perfil fechado, banco fora do ar, teto de desenhos):
// cache curto, para os robôs das redes (que guardam a prévia pela URL) pedirem de novo logo
$curto = $p === null && $pediu;
$p ??= previaGenerica($codigo);

if ($png) {
    try {
        $generica = false;
        $img = pngPrevia($p, $generica);
        $curto = $curto || $generica;
    } catch (Throwable $e) {
        error_log('LENDA prévia (imagem): ' . $e->getMessage());
        $img = null;
    }
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    if ($img === null) {
        header_remove('Set-Cookie');
        http_response_code(404);
        cabecalhosPrevia('text/plain; charset=utf-8', 300);
        echo 'Imagem indisponível.';
        exit;
    }
    http_response_code(200);
    cabecalhosPrevia('image/png', $curto ? PREVIA_CACHE_CURTO : 86400);
    header('Content-Length: ' . strlen($img));
    echo $m === 'HEAD' ? '' : $img;
    exit;
}

while (ob_get_level() > 0) {
    ob_end_clean();
}
http_response_code(200);
cabecalhosPrevia('text/html; charset=utf-8', $curto ? PREVIA_CACHE_CURTO : 300);
echo $m === 'HEAD' ? '' : htmlPrevia($p);

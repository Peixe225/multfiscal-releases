<?php
/**
 * LENDA · prévia de link (CONTRATO-v34 §A): os dados públicos de uma carreira do Hall ou de um perfil, os textos das meta tags
 * (Open Graph e Twitter) e a imagem 1200×630 desenhada com o GD (fontes Barlow Condensed em _fonte-*.ttf, licença OFL em
 * _fonte-OFL.txt), guardada em disco FORA do public_html (ao lado do arquivo de config, lenda-cache/previas/, ou em
 * cache_pasta da config). Só o que já é público: o apelido, o jogador e os números da carreira que está no Hall público
 * agora; carreira oculta, suspeita, fora do Hall, de conta suspensa ou que fechou o perfil: a prévia genérica do LENDA.
 * Usado só pelo v.php. Nunca é servido (o .htaccess nega _*.php).
 */
declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/_copias.php'; // arquivoConfigEmUso, dentroDaWeb

const PREVIA_L = 1200;
const PREVIA_A = 630;
/** Mudou o desenho? Suba: as imagens guardadas deixam de valer (o nome do arquivo leva a versão). */
const PREVIA_VERSAO = 1;
const PREVIA_GERAR_MAX = 600;       // imagens novas desenhadas a cada 10 min no site (o resto recebe a genérica)
const PREVIA_GERAR_IP = 60;         // §E: e por quem pede (o código do IP, que some em ~20 min), para um só não gastar o do site
const PREVIA_ARQUIVOS_MAX = 5000;   // na pasta; passou, as mais velhas saem
const PREVIA_CACHE_CURTO = 60;      // §E: s de cache da genérica que veio no lugar de uma carreira ou de um perfil
const PREVIA_DIAS = 30;

// ── textos ───────────────────────────────────────────────────────────────────────────────────────

function pluralPrevia(int $n, string $um, string $varios): string
{
    return number_format($n, 0, ',', '.') . ' ' . ($n === 1 ? $um : $varios);
}

/** "a, b e c". */
function previaJuntar(array $partes): string
{
    $partes = array_values(array_filter($partes, static fn($x): bool => is_string($x) && $x !== ''));
    if (count($partes) <= 1) {
        return $partes[0] ?? '';
    }
    return implode(', ', array_slice($partes, 0, -1)) . ' e ' . end($partes);
}

/** A origem do site (a primeira da config) + /lenda/. */
function previaUrlSite(): string
{
    $o = '';
    foreach ((array) config()['origens'] as $x) {
        if (is_string($x) && $x !== '') {
            $o = rtrim($x, '/');
            break;
        }
    }
    return ($o !== '' ? $o : 'https://oprojeto.online') . LENDA_CAMINHO_COOKIE;
}

/** A prévia genérica (link sem carreira, carreira fora do Hall, perfil fechado). */
function previaGenerica(?string $convite): array
{
    return [
        'tipo' => 'geral',
        'titulo' => 'LENDA · jogo de carreira de futebol online grátis',
        'descricao' => 'Crie seu jogador e viva a carreira dos 16 aos 40 anos: decisões, títulos, Bolas de Ouro e Copas do Mundo, com as tabelas reais de hoje. Grátis, no navegador.',
        'destino' => LENDA_CAMINHO_COOKIE . ($convite !== null ? '?c=' . $convite : ''),
        'chave' => 'geral',
        'img' => ['tipo' => 'geral'],
        'q' => $convite !== null ? ['c' => $convite] : [],
    ];
}

/**
 * A carreira do Hall público (o mesmo filtro do hall.php?id=: na fotografia agora, visível, conta ativa no Hall), ou null.
 * $convite = o código de quem compartilhou (vai para o link do jogo).
 */
function previaCarreira(string $id, ?string $convite): ?array
{
    $l = umaLinha('SELECT f.id AS posicao, f.carreira_id, f.apelido, f.usuario_id, f.jogador, f.pais, f.posicao_campo, f.nota, f.temporadas, f.gols, f.titulos,
            f.bolas_ouro, f.copas, f.headline FROM hall_foto f JOIN carreiras c ON c.id = f.carreira_pk JOIN usuarios u ON u.id = c.usuario_id
        WHERE f.carreira_id = ? AND ' . sqlCarreiraVisivel() . ' AND ' . LENDA_SQL_ATIVO . ' AND ' . sqlContaNoHall() . "
          AND (u.hall_publico = 'auto' OR (u.hall_publico = 'manual' AND c.publica = 1))", [$id]);
    if ($l === null) {
        return null;
    }
    // §E: daqui em diante, o id como o banco guarda. A comparação do banco ignora espaços no fim (PAD SPACE): com o id da URL, cada
    // "id + espaços" virava uma chave (um PNG novo no disco e um desenho a mais no teto do site) para a mesma carreira
    $id = (string) $l['carreira_id'];
    $jog = trim((string) $l['jogador']) !== '' ? (string) $l['jogador'] : 'Jogador';
    $nota = (int) $l['nota'];
    $bolas = (int) $l['bolas_ouro'];
    $copas = (int) $l['copas'];
    $tit = (int) $l['titulos'];
    $temp = (int) $l['temporadas'];
    $numeros = previaJuntar([$bolas > 0 ? pluralPrevia($bolas, 'Bola de Ouro', 'Bolas de Ouro') : '', $copas > 0 ? pluralPrevia($copas, 'Copa do Mundo', 'Copas do Mundo') : '',
        pluralPrevia($tit, 'título', 'títulos')]);
    $headline = trim((string) $l['headline']);
    $desc = ($headline !== '' ? rtrim($headline, '.!') . '. ' : '') . ucfirst($numeros) . ' em ' . pluralPrevia($temp, 'temporada', 'temporadas')
        . '. Carreira de ' . $l['apelido'] . ', a ' . (int) $l['posicao'] . 'ª do Hall das Lendas. Jogue grátis e monte a sua.';
    $q = ['id' => $id] + ($convite !== null ? ['c' => $convite] : []);
    return [
        'tipo' => 'carreira',
        'titulo' => $jog . ' · Nota de Legado ' . $nota . ' · LENDA',
        'descricao' => $desc,
        'destino' => LENDA_CAMINHO_COOKIE . ($convite !== null ? '?c=' . $convite : '') . '#/resumo?id=' . rawurlencode($id) . '&de=comunidade',
        // o que muda a imagem (ela é refeita quando a carreira ou a posição mudam)
        // o número da conta no nome do arquivo: excluir a conta apaga as imagens dela (apagarPreviasDaConta)
        'chave' => 'c' . (int) $l['usuario_id'] . '-' . sha1(json([$id, $l['apelido'], $jog, $l['pais'], $l['posicao_campo'], $nota, $temp, (int) $l['gols'], $tit,
            $bolas, $copas, (int) $l['posicao']])),
        'img' => ['tipo' => 'carreira', 'jogador' => $jog, 'apelido' => (string) $l['apelido'], 'pais' => (string) $l['pais'], 'posicaoCampo' => (string) $l['posicao_campo'],
            'nota' => $nota, 'temporadas' => $temp, 'gols' => (int) $l['gols'], 'titulos' => $tit, 'bolas' => $bolas, 'copas' => $copas, 'posicao' => (int) $l['posicao']],
        'q' => $q,
    ];
}

/** O perfil público pelo código de convite (as mesmas regras do perfil.php), ou null. */
function previaPerfil(string $codigo): ?array
{
    $u = umaLinha('SELECT * FROM usuarios WHERE codigo_convite = ?', [$codigo]);
    if ($u === null || ($u['hall_publico'] ?? 'auto') === 'nao' || contaSuspensa($u)) {
        return null;
    }
    $uid = (int) $u['id'];
    $h = umaLinha('SELECT COUNT(*) AS n, MAX(nota) AS melhor FROM hall_foto WHERE usuario_id = ?', [$uid]) ?? ['n' => 0, 'melhor' => null];
    $conq = (int) umValor('SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id = ? AND conquista_id IN (' . marcas(CONQUISTAS_TOTAL) . ')',
        array_merge([$uid], CONQUISTAS_IDS));
    $prov = esquemaV34() ? conquistasProvadas($uid) : 0;
    $emb = esquemaV34() ? (emblemasDasContas([$uid])[$uid] ?? []) : [];
    $n = (int) $h['n'];
    $melhor = $h['melhor'] !== null ? (int) $h['melhor'] : null;
    $partes = [$n > 0 ? pluralPrevia($n, 'carreira no Hall das Lendas', 'carreiras no Hall das Lendas') : '',
        pluralPrevia($conq, 'conquista', 'conquistas') . ($prov > 0 ? ' (' . pluralPrevia($prov, 'provada', 'provadas') . ')' : ''),
        $emb ? pluralPrevia(count($emb), 'emblema', 'emblemas') : ''];
    $apelido = (string) $u['apelido'];
    return [
        'tipo' => 'perfil',
        'titulo' => $apelido . ' no LENDA' . ($melhor !== null ? ' · melhor nota ' . $melhor : ''),
        'descricao' => ucfirst(previaJuntar($partes)) . '. Veja o perfil e jogue grátis o simulador de carreira de futebol.',
        'destino' => LENDA_CAMINHO_COOKIE . '?c=' . $codigo . '#/jogador/' . $codigo,
        'chave' => 'p' . $uid . '-' . sha1(json([$codigo, $apelido, $n, $melhor, $conq, $prov, array_column($emb, 'slug')])),
        'img' => ['tipo' => 'perfil', 'apelido' => $apelido, 'carreiras' => $n, 'melhor' => $melhor, 'conquistas' => $conq, 'provadas' => $prov,
            'emblemas' => array_slice(array_column($emb, 'titulo'), 0, 3), 'emblemasN' => count($emb)],
        'q' => ['c' => $codigo],
    ];
}

/** O HTML da prévia: meta tags e o refresh para o jogo (sem script: o CSP do site não precisa mudar). */
function htmlPrevia(array $p): string
{
    $e = static fn(string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
    $site = previaUrlSite();
    $base = rtrim($site, '/');
    $origem = substr($base, 0, -strlen(rtrim(LENDA_CAMINHO_COOKIE, '/')));
    $esta = $site . 'api/v.php' . ($p['q'] ? '?' . http_build_query($p['q'], '', '&', PHP_QUERY_RFC3986) : '');
    $img = $site . 'api/v.php?' . http_build_query($p['q'] + ['png' => '1', 'h' => substr(sha1($p['chave'] . '|' . PREVIA_VERSAO), 0, 12)], '', '&', PHP_QUERY_RFC3986);
    $destino = $origem . $p['destino'];
    $alt = $p['tipo'] === 'carreira' ? 'Cartão da carreira: ' . $p['titulo'] : ($p['tipo'] === 'perfil' ? 'Cartão do perfil: ' . $p['titulo'] : 'LENDA, jogo de carreira de futebol');
    $m = [
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="LENDA">',
        '<meta property="og:locale" content="pt_BR">',
        '<meta property="og:title" content="' . $e($p['titulo']) . '">',
        '<meta property="og:description" content="' . $e($p['descricao']) . '">',
        '<meta property="og:url" content="' . $e($esta) . '">',
        '<meta property="og:image" content="' . $e($img) . '">',
        '<meta property="og:image:type" content="image/png">',
        '<meta property="og:image:width" content="' . PREVIA_L . '">',
        '<meta property="og:image:height" content="' . PREVIA_A . '">',
        '<meta property="og:image:alt" content="' . $e($alt) . '">',
        '<meta name="twitter:card" content="summary_large_image">',
        '<meta name="twitter:title" content="' . $e($p['titulo']) . '">',
        '<meta name="twitter:description" content="' . $e($p['descricao']) . '">',
        '<meta name="twitter:image" content="' . $e($img) . '">',
        '<meta name="twitter:image:alt" content="' . $e($alt) . '">',
    ];
    return "<!doctype html>\n<html lang=\"pt-BR\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        . '<title>' . $e($p['titulo']) . "</title>\n<meta name=\"description\" content=\"" . $e($p['descricao']) . "\">\n"
        . "<meta name=\"robots\" content=\"noindex, follow\">\n<link rel=\"canonical\" href=\"" . $e($esta) . "\">\n"
        // integração v3.4: o ícone do LENDA (sem ele o navegador pede o /favicon.ico da raiz do domínio, que é de outro site)
        . '<link rel="icon" type="image/svg+xml" href="' . $e($site . 'favicon.svg') . "\">\n"
        . implode("\n", $m) . "\n<meta http-equiv=\"refresh\" content=\"0; url=" . $e($destino) . "\">\n</head>\n<body>\n"
        . '<h1>' . $e($p['titulo']) . "</h1>\n<p>" . $e($p['descricao']) . "</p>\n<p><a href=\"" . $e($destino) . "\">Abrir no LENDA</a></p>\n</body>\n</html>\n";
}

// ── imagem ───────────────────────────────────────────────────────────────────────────────────────

/** A pasta das imagens: fora do public_html (ao lado da config) ou cache_pasta; null = sem cache (desenha toda vez). */
function pastaPrevias(): ?string
{
    static $r = false;
    if ($r !== false) {
        return $r;
    }
    $cfg = config()['cache_pasta'] ?? null;
    if (is_string($cfg) && $cfg !== '' && str_starts_with($cfg, '/') && !str_contains($cfg, '..') && !str_contains($cfg, "\0")) {
        $pasta = rtrim($cfg, '/') . '/previas';
    } else {
        $arq = arquivoConfigEmUso();
        if ($arq === null || basename($arq) === '_config.php') {
            return $r = null; // a config dentro da api/: não há pasta fora da web para guardar
        }
        $pasta = dirname((string) realpath($arq)) . '/lenda-cache/previas';
    }
    if (dentroDaWeb($pasta)) {
        return $r = null;
    }
    if (!is_dir($pasta) && !@mkdir($pasta, 0700, true) && !is_dir($pasta)) {
        return $r = null;
    }
    if (is_link($pasta) || !is_writable($pasta)) {
        return $r = null;
    }
    if (!is_file(dirname($pasta) . '/.htaccess')) {
        @file_put_contents(dirname($pasta) . '/.htaccess', "Require all denied\nDeny from all\n");
    }
    return $r = $pasta;
}

/** O texto só com o que a fonte desenha (latim, números e pontuação comum); o resto sai. */
function previaTexto(string $s, int $max = 40): string
{
    $s = (string) preg_replace('/[^\x{20}-\x{7E}\x{A0}-\x{17F}\x{2013}\x{2014}\x{2019}\x{00B7}]/u', '', $s);
    $s = trim((string) preg_replace('/\s+/u', ' ', $s));
    return mb_substr($s, 0, $max, 'UTF-8');
}

function previaCor(GdImage $im, string $hex, int $alfa = 0): int
{
    $hex = ltrim($hex, '#');
    return (int) imagecolorallocatealpha($im, (int) hexdec(substr($hex, 0, 2)), (int) hexdec(substr($hex, 2, 2)), (int) hexdec(substr($hex, 4, 2)), $alfa);
}

/** Largura do texto em px. */
function previaLargura(string $fonte, float $tam, string $txt): int
{
    $b = imagettfbbox($tam, 0, $fonte, $txt);
    return $b === false ? 0 : (int) abs($b[2] - $b[0]);
}

/** O maior tamanho (até $tam) em que o texto cabe em $max px. */
function previaTamanho(string $fonte, float $tam, string $txt, int $max, float $minimo = 18): float
{
    while ($tam > $minimo && previaLargura($fonte, $tam, $txt) > $max) {
        $tam -= 2;
    }
    return $tam;
}

/** Escreve; $x é a esquerda (ou a direita, com $alinhar = 'dir'; o centro, com 'meio'); $y é a linha de base. */
function previaEscrever(GdImage $im, string $fonte, float $tam, int $x, int $y, int $cor, string $txt, string $alinhar = 'esq'): void
{
    if ($txt === '') {
        return;
    }
    $w = previaLargura($fonte, $tam, $txt);
    $x0 = $alinhar === 'dir' ? $x - $w : ($alinhar === 'meio' ? $x - intdiv($w, 2) : $x);
    imagettftext($im, $tam, 0, $x0, $y, $cor, $fonte, $txt);
}

/** Desenha a prévia (1200×630) e devolve o PNG, ou null sem o GD/FreeType ou sem as fontes. */
function desenharPrevia(array $d): ?string
{
    $negrito = __DIR__ . '/_fonte-barlow-condensed-700.ttf';
    $medio = __DIR__ . '/_fonte-barlow-condensed-500.ttf';
    if (!function_exists('imagecreatetruecolor') || !function_exists('imagettftext') || !is_file($negrito) || !is_file($medio)) {
        return null;
    }
    $im = imagecreatetruecolor(PREVIA_L, PREVIA_A);
    if ($im === false) {
        return null;
    }
    imagealphablending($im, true);
    // fundo: do grafite ao quase preto, com uma faixa de luz dourada bem fraca na diagonal
    for ($y = 0; $y < PREVIA_A; $y++) {
        $t = $y / PREVIA_A;
        $c = imagecolorallocate($im, (int) (16 - 9 * $t), (int) (19 - 11 * $t), (int) (29 - 17 * $t));
        imageline($im, 0, $y, PREVIA_L, $y, (int) $c);
    }
    imagefilledpolygon($im, [760, 0, 1000, 0, 640, PREVIA_A, 400, PREVIA_A], previaCor($im, '#f2c75a', 122));
    $ouro = previaCor($im, '#f2c75a');
    $branco = previaCor($im, '#f4f5f8');
    $cinza = previaCor($im, '#9aa3b2');
    $linha = previaCor($im, '#2a2f3d');
    imagefilledrectangle($im, 0, 0, 13, PREVIA_A, $ouro);
    previaEscrever($im, $negrito, 46, 64, 96, $ouro, 'LENDA');
    previaEscrever($im, $medio, 22, 64 + previaLargura($negrito, 46, 'LENDA') + 18, 94, $cinza, 'SIMULADOR DE CARREIRA DE FUTEBOL');
    $rodapeDir = 'oprojeto.online/lenda · jogue grátis';
    $tipo = (string) ($d['tipo'] ?? 'geral');
    if ($tipo === 'geral') {
        previaEscrever($im, $negrito, 120, 64, 330, $branco, 'Seja uma lenda');
        previaEscrever($im, $medio, 40, 66, 400, $cinza, 'Dos 16 aos 40 anos: decisões, títulos, Bolas de Ouro');
        previaEscrever($im, $medio, 40, 66, 452, $cinza, 'e Copas do Mundo, com as tabelas reais de hoje.');
        imageline($im, 64, 540, PREVIA_L - 64, 540, $linha);
        previaEscrever($im, $negrito, 30, 64, 588, $ouro, 'Grátis, no navegador');
        previaEscrever($im, $medio, 28, PREVIA_L - 64, 588, $cinza, $rodapeDir, 'dir');
    } else {
        $carreira = $tipo === 'carreira';
        $nome = previaTexto((string) ($carreira ? ($d['jogador'] ?? '') : ($d['apelido'] ?? '')), 28);
        $nome = $nome !== '' ? $nome : ($carreira ? 'Jogador' : 'Jogador do LENDA');
        $tam = previaTamanho($negrito, 112, mb_strtoupper($nome, 'UTF-8'), 720, 44);
        previaEscrever($im, $negrito, $tam, 64, 250, $branco, mb_strtoupper($nome, 'UTF-8'));
        if ($carreira) {
            $sub = implode(' · ', array_filter([previaTexto((string) ($d['pais'] ?? ''), 8), previaTexto((string) ($d['posicaoCampo'] ?? ''), 8),
                pluralPrevia((int) ($d['temporadas'] ?? 0), 'temporada', 'temporadas'), ((int) ($d['posicao'] ?? 0)) . 'ª do Hall das Lendas'], static fn(string $x): bool => $x !== ''));
        } else {
            $sub = 'Perfil no LENDA' . (((int) ($d['carreiras'] ?? 0)) > 0 ? ' · ' . pluralPrevia((int) $d['carreiras'], 'carreira no Hall', 'carreiras no Hall') : '');
        }
        previaEscrever($im, $medio, 34, 66, 310, $cinza, $sub);
        // a nota, num anel dourado à direita
        $nota = $carreira ? (int) ($d['nota'] ?? 0) : ($d['melhor'] ?? null);
        $cx = 1020;
        $cy = 230;
        // o anel em traços finos com antialias (o imagesetthickness do GD serrilha)
        imageantialias($im, true);
        for ($dd = 240; $dd <= 252; $dd++) {
            imageellipse($im, $cx, $cy, $dd, $dd, $ouro);
        }
        imageantialias($im, false);
        previaEscrever($im, $negrito, 104, $cx, $cy + 36, $ouro, $nota !== null ? (string) $nota : '—', 'meio');
        previaEscrever($im, $medio, 20, $cx, $cy + 76, $cinza, $carreira ? 'NOTA DE LEGADO' : 'MELHOR NOTA', 'meio');
        // os quatro números
        $cartoes = $carreira
            ? [[(int) ($d['bolas'] ?? 0), 'Bola de Ouro', 'Bolas de Ouro'], [(int) ($d['copas'] ?? 0), 'Copa do Mundo', 'Copas do Mundo'],
                [(int) ($d['titulos'] ?? 0), 'Título', 'Títulos'], [(int) ($d['gols'] ?? 0), 'Gol', 'Gols']]
            : [[(int) ($d['carreiras'] ?? 0), 'No Hall', 'No Hall'], [(int) ($d['conquistas'] ?? 0), 'Conquista', 'Conquistas'],
                [(int) ($d['provadas'] ?? 0), 'Provada', 'Provadas'], [(int) ($d['emblemasN'] ?? 0), 'Emblema', 'Emblemas']];
        $x = 64;
        $w = 250;
        foreach ($cartoes as [$v, $um, $varios]) {
            $rot = $v === 1 ? $um : $varios;
            imagefilledrectangle($im, $x, 372, $x + $w - 24, 508, previaCor($im, '#ffffff', 118));
            imagerectangle($im, $x, 372, $x + $w - 24, 508, $linha);
            previaEscrever($im, $negrito, 58, $x + 22, 448, $branco, number_format($v, 0, ',', '.'));
            previaEscrever($im, $medio, 24, $x + 22, 488, $cinza, $rot);
            $x += $w;
        }
        imageline($im, 64, 540, PREVIA_L - 64, 540, $linha);
        $rodape = $carreira ? 'Carreira de ' . previaTexto((string) ($d['apelido'] ?? ''), 32)
            : ((array) ($d['emblemas'] ?? []) ? 'Emblemas: ' . previaTexto(implode(', ', (array) $d['emblemas']), 48) : 'Jogue e monte a sua carreira');
        previaEscrever($im, $negrito, previaTamanho($negrito, 30, $rodape, 560, 18), 64, 588, $ouro, $rodape);
        previaEscrever($im, $medio, 28, PREVIA_L - 64, 588, $cinza, $rodapeDir, 'dir');
    }
    ob_start();
    imagepng($im, null, 6);
    $png = (string) ob_get_clean();
    imagedestroy($im);
    return $png !== '' ? $png : null;
}

/**
 * O PNG da prévia: o guardado (pela chave + versão do desenho) ou desenhado agora e guardado. Teto de desenhos novos por 10
 * min no site (PREVIA_GERAR_MAX) e, §E, por quem pede (PREVIA_GERAR_IP, pelo código do IP de sempre, que some em ~20 min:
 * o IP nunca é gravado): passou, vai a genérica, e $generica = true (o v.php manda com cache curto, para os robôs não
 * guardarem por um dia o cartão errado). null = sem GD (o v.php manda o 404).
 */
function pngPrevia(array $p, bool &$generica = false): ?string
{
    $pasta = pastaPrevias();
    $nome = preg_replace('/[^a-z0-9-]/', '', (string) $p['chave']) . '-v' . PREVIA_VERSAO . '.png';
    if ($pasta !== null && is_file($pasta . '/' . $nome)) {
        $png = @file_get_contents($pasta . '/' . $nome);
        if (is_string($png) && $png !== '') {
            return $png;
        }
    }
    if ($p['chave'] !== 'geral' && (somarLimite('previa-gerar-ip', quemIp(), 1) > PREVIA_GERAR_IP || somarLimite('previa-gerar', 'site', 1) > PREVIA_GERAR_MAX)) {
        $generica = true;
        return pngPrevia(previaGenerica(null));
    }
    $png = desenharPrevia($p['img']);
    if ($png === null) {
        return null;
    }
    if ($pasta !== null) {
        $tmp = $pasta . '/.' . $nome . '.' . bin2hex(random_bytes(4));
        if (@file_put_contents($tmp, $png) !== false) {
            @rename($tmp, $pasta . '/' . $nome);
        }
        limparPreviasTalvez($pasta);
    }
    return $png;
}

/** LGPD: excluir a conta apaga as imagens das prévias dela (carreiras e perfil). Devolve quantas. */
function apagarPreviasDaConta(int $uid): int
{
    $pasta = pastaPrevias();
    if ($pasta === null) {
        return 0;
    }
    $n = 0;
    foreach (array_merge(glob($pasta . '/c' . $uid . '-*.png') ?: [], glob($pasta . '/p' . $uid . '-*.png') ?: []) as $a) {
        $n += @unlink($a) ? 1 : 0;
    }
    return $n;
}

/** Em ~2% dos desenhos: as imagens com mais de 30 dias saem, e as mais velhas também se a pasta passar do teto. */
function limparPreviasTalvez(string $pasta): void
{
    if (random_int(1, 50) !== 1) {
        return;
    }
    $arqs = glob($pasta . '/*.png') ?: [];
    $velho = time() - PREVIA_DIAS * 86400;
    $vivos = [];
    foreach ($arqs as $a) {
        $t = (int) @filemtime($a);
        if ($t < $velho) {
            @unlink($a);
        } else {
            $vivos[$a] = $t;
        }
    }
    if (count($vivos) > PREVIA_ARQUIVOS_MAX) {
        asort($vivos);
        foreach (array_slice(array_keys($vivos), 0, count($vivos) - PREVIA_ARQUIVOS_MAX) as $a) {
            @unlink($a);
        }
    }
}

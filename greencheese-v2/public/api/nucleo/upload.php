<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Envio de imagem do painel → <site>/uploads/. Só JPEG, PNG e WebP de verdade (finfo + getimagesize), até 8 MB
// (ou menos, se o PHP da hospedagem deixar menos). Nome aleatório. Com GD + WebP, recodifica em WebP com o lado
// maior até 1600 px (some qualquer coisa escondida no arquivo e a foto do celular fica leve); sem WebP, recodifica
// no formato original; sem GD, guarda o original já conferido.
// Envio de vídeo (a thumb animada do produto, já tratada no painel) → uploads/<nome>.mp4|webm: até 6 MB, conferido
// pelos bytes (MP4: caixas do começo ao fim, a primeira 'ftyp' com marca conhecida; WebM: cabeçalho EBML com DocType
// webm e o Segment), sem nada de página ou script dentro. A hospedagem não tem ffmpeg: o vídeo não é recodificado,
// então a conferência é estrita e ele só é servido como vídeo (o .htaccess de uploads/).
// Arquivo trocado ou de produto apagado sai da pasta quando ninguém mais cita (gc_uploads_soltos).

const GC_ENVIO_MAXIMO = 8 * 1048576;
const GC_LADO_MAXIMO = 1600;
const GC_MEGAPIXELS_MAXIMO = 40;
const GC_TIPOS_IMAGEM = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
const GC_VIDEO_MAXIMO = 6 * 1048576;
/** O painel corta em até 6 s; com a duração escrita no arquivo, o servidor aceita até 10 (folga do arredondamento). */
const GC_VIDEO_SEGUNDOS = 10;
const GC_TIPOS_VIDEO = ['video/mp4' => 'mp4', 'video/webm' => 'webm'];
/** Marcas da caixa ftyp que valem (MP4, a do celular e a do QuickTime do iPhone, que o navegador toca como MP4). */
const GC_MARCAS_MP4 = [
    'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9', 'mp41', 'mp42', 'mp71', 'avc1', 'av01', 'hvc1', 'M4V ', 'M4VH', 'M4VP',
    'dash', 'cmfc', 'msnv', 'MSNV', '3gp4', '3gp5', '3gp6', '3gp7', '3g2a', '3g2b', '3g2c', 'qt  ', 'f4v ',
];

/** .htaccess de uploads/ (o mesmo de public/uploads/.htaccess): serve imagem e o vídeo do produto, nada mais. */
const GC_HTACCESS_UPLOADS = <<<'HT'
# Envios do painel: só imagem e o vídeo curto do produto (nome gerado pelo servidor). Nada aqui roda nem vira página.
Options -Indexes -ExecCGI
<IfModule mod_php.c>
  php_flag engine off
</IfModule>
<IfModule mod_php7.c>
  php_flag engine off
</IfModule>
<IfModule mod_mime.c>
  RemoveHandler .php .phtml .php3 .php4 .php5 .php7 .php8 .phar .phps .pht .shtml .cgi .pl .py .asp .aspx .jsp
  RemoveType .php .phtml .php3 .php4 .php5 .php7 .php8 .phar .phps .pht .shtml .cgi .pl .py .asp .aspx .jsp
  AddType image/webp .webp
  AddType image/jpeg .jpg .jpeg
  AddType image/png .png
  AddType video/mp4 .mp4
  AddType video/webm .webm
</IfModule>
<IfModule mod_authz_core.c>
  Require all denied
  <FilesMatch "^[a-z0-9]{8,64}\.(webp|jpe?g|png|mp4|webm)$">
    Require all granted
  </FilesMatch>
</IfModule>
<IfModule !mod_authz_core.c>
  Order allow,deny
  Deny from all
  <FilesMatch "^[a-z0-9]{8,64}\.(webp|jpe?g|png|mp4|webm)$">
    Order deny,allow
    Allow from all
  </FilesMatch>
</IfModule>
<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set Content-Security-Policy "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox"
  Header set Cache-Control "public, max-age=31536000, immutable"
</IfModule>

HT;

/** "8M", "512K", "1G" em bytes (0 = sem limite). */
function gc_ini_bytes(string $chave): int
{
    $v = trim((string) ini_get($chave));
    if ($v === '' || $v === '-1') {
        return 0;
    }
    $n = (int) $v;
    return match (strtolower(substr($v, -1))) {
        'g' => $n * 1073741824,
        'm' => $n * 1048576,
        'k' => $n * 1024,
        default => $n,
    };
}

/** O maior envio que passa: 8 MB, ou o limite do PHP se for menor. */
function gc_envio_maximo(): int
{
    $limites = array_filter([GC_ENVIO_MAXIMO, gc_ini_bytes('upload_max_filesize'), gc_ini_bytes('post_max_size')]);
    return (int) min($limites);
}

function gc_mb(int $bytes): string
{
    return rtrim(rtrim(number_format($bytes / 1048576, 1, ',', ''), '0'), ',') . ' MB';
}

/** GD com suporte a WebP para gravar? */
function gc_gd_webp(): bool
{
    return extension_loaded('gd') && function_exists('imagewebp') && (imagetypes() & IMG_WEBP) !== 0;
}

/** O GD consegue abrir esse tipo? */
function gc_gd_le(string $mime): bool
{
    if (!extension_loaded('gd')) {
        return false;
    }
    $bit = match ($mime) {
        'image/jpeg' => IMG_JPG,
        'image/png' => IMG_PNG,
        'image/webp' => IMG_WEBP,
        default => 0,
    };
    return $bit !== 0 && (imagetypes() & $bit) !== 0;
}

/** Endireita a foto do celular pela orientação do EXIF (sem isso, ela aparece deitada). */
function gc_orientar(GdImage $img, string $arquivo): GdImage
{
    if (!function_exists('exif_read_data')) {
        return $img;
    }
    $exif = @exif_read_data($arquivo);
    $o = is_array($exif) ? (int) ($exif['Orientation'] ?? 1) : 1;
    if ($o < 2 || $o > 8) {
        return $img;
    }
    if (in_array($o, [2, 4, 5, 7], true)) {
        imageflip($img, $o === 4 ? IMG_FLIP_VERTICAL : IMG_FLIP_HORIZONTAL);
    }
    $angulo = match ($o) {
        3, 4 => 180,
        5, 6 => -90,
        7, 8 => 90,
        default => 0,
    };
    if ($angulo !== 0) {
        $girada = imagerotate($img, $angulo, 0);
        if ($girada instanceof GdImage) {
            $img = $girada; // a de antes se solta sozinha (imagedestroy é obsoleto no PHP 8.5)
        }
    }
    return $img;
}

/** Memória pra abrir a imagem no GD (≈ 5 bytes por pixel + folga); sobe o limite se der. */
function gc_memoria_para(int $w, int $h): bool
{
    $precisa = $w * $h * 5 + 32 * 1048576 + memory_get_usage();
    $limite = gc_ini_bytes('memory_limit');
    if ($limite === 0 || $limite >= $precisa) {
        return true;
    }
    @ini_set('memory_limit', (string) min(max($precisa, 256 * 1048576), 768 * 1048576));
    $limite = gc_ini_bytes('memory_limit');
    return $limite === 0 || $limite >= $precisa;
}

/** POST admin-upload (multipart, campo "imagem") → { imagem: 'uploads/<nome>', largura, altura, bytes, tipo }. */
function gc_rota_admin_upload(): array
{
    gc_exigir_dono();
    $maximo = gc_envio_maximo();
    $grande = static fn (): ErroApi => new ErroApi('grande-demais', 'Imagem grande demais: até ' . gc_mb($maximo) . '.', 413, ['limite' => $maximo]);
    $post = gc_ini_bytes('post_max_size');
    if ($post > 0 && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $post) {
        throw $grande();
    }
    $f = $_FILES['imagem'] ?? null;
    if (!is_array($f) || is_array($f['error'] ?? null)) {
        throw gc_invalido('imagem', 'Manda uma imagem (JPG, PNG ou WebP).');
    }
    $erro = (int) $f['error'];
    if ($erro === UPLOAD_ERR_INI_SIZE || $erro === UPLOAD_ERR_FORM_SIZE) {
        throw $grande();
    }
    if ($erro === UPLOAD_ERR_NO_FILE) {
        throw gc_invalido('imagem', 'Manda uma imagem (JPG, PNG ou WebP).');
    }
    if ($erro !== UPLOAD_ERR_OK) {
        gc_log('upload: erro do PHP ' . $erro);
        throw new ErroApi('envio-falhou', 'O envio falhou. Tenta de novo.', 500);
    }
    $tmp = (string) $f['tmp_name'];
    if (!is_uploaded_file($tmp)) {
        throw gc_invalido('imagem', 'Manda uma imagem (JPG, PNG ou WebP).');
    }
    $bytes = (int) filesize($tmp);
    if ($bytes > $maximo) {
        throw $grande();
    }
    if ($bytes < 16) {
        throw new ErroApi('tipo-invalido', 'Isso não é uma imagem JPG, PNG ou WebP.', 415);
    }

    // o tipo de verdade, pelo conteúdo (o nome e o tipo que o navegador mandou não valem nada)
    $mime = function_exists('finfo_open') ? (string) (new finfo(FILEINFO_MIME_TYPE))->file($tmp) : '';
    $info = @getimagesize($tmp);
    $tipoInfo = is_array($info) ? (string) ($info['mime'] ?? '') : '';
    if ($mime === '') {
        $mime = $tipoInfo;
    }
    if (!isset(GC_TIPOS_IMAGEM[$mime]) || $tipoInfo !== $mime) {
        throw new ErroApi('tipo-invalido', 'Isso não é uma imagem JPG, PNG ou WebP.', 415);
    }
    [$w, $h] = [(int) $info[0], (int) $info[1]];
    if ($w < 1 || $h < 1 || $w > 12000 || $h > 12000) {
        throw new ErroApi('tipo-invalido', 'Isso não é uma imagem JPG, PNG ou WebP.', 415);
    }
    if ($w * $h > GC_MEGAPIXELS_MAXIMO * 1000000) {
        throw new ErroApi('imagem-grande', 'Foto com pixel demais (até ' . GC_MEGAPIXELS_MAXIMO . ' megapixels). Manda uma menor.', 413);
    }

    $recodificar = gc_gd_le($mime);
    if ($recodificar && !gc_memoria_para($w, $h)) {
        throw new ErroApi('imagem-grande', 'Foto com pixel demais pra ajustar aqui. Manda uma menor (até uns 4000 px).', 413);
    }

    $dir = gc_pasta_uploads();
    gc_preparar_pasta($dir, GC_HTACCESS_UPLOADS, false);
    $nome = bin2hex(random_bytes(12));
    $temp = $dir . '/.envio-' . $nome;
    $saida = $mime;

    try {
        if ($recodificar) {
            $img = @imagecreatefromstring((string) file_get_contents($tmp));
            if (!$img instanceof GdImage) {
                throw new ErroApi('tipo-invalido', 'Essa imagem tá corrompida. Manda outra.', 415);
            }
            if ($mime === 'image/jpeg') {
                $img = gc_orientar($img, $tmp);
            }
            if (!imageistruecolor($img)) {
                imagepalettetotruecolor($img);
            }
            [$w, $h] = [imagesx($img), imagesy($img)];
            $escala = min(1, GC_LADO_MAXIMO / max($w, $h));
            if ($escala < 1) {
                $nw = max(1, (int) round($w * $escala));
                $nh = max(1, (int) round($h * $escala));
                $menor = imagecreatetruecolor($nw, $nh);
                imagealphablending($menor, false);
                imagesavealpha($menor, true);
                imagefill($menor, 0, 0, imagecolorallocatealpha($menor, 0, 0, 0, 127));
                imagecopyresampled($menor, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);
                $img = $menor;
                [$w, $h] = [$nw, $nh];
            }
            imagealphablending($img, false);
            imagesavealpha($img, true);
            $ok = false;
            if (gc_gd_webp()) {
                $saida = 'image/webp';
                $ok = imagewebp($img, $temp, 82);
            } elseif ($mime === 'image/jpeg') {
                $ok = imagejpeg($img, $temp, 85);
            } elseif ($mime === 'image/png') {
                $ok = imagepng($img, $temp, 6);
            }
            unset($img);
            if (!$ok) {
                throw new RuntimeException('GD não gravou a imagem');
            }
        } else {
            if (!move_uploaded_file($tmp, $temp)) {
                throw new RuntimeException('não deu pra mover o envio');
            }
        }
        // confere o que foi gravado antes de pôr no lugar
        $final = @getimagesize($temp);
        if (!is_array($final) || ($final['mime'] ?? '') !== $saida) {
            throw new RuntimeException('imagem gravada não confere');
        }
        $arquivo = $nome . '.' . GC_TIPOS_IMAGEM[$saida];
        if (!rename($temp, $dir . '/' . $arquivo)) {
            throw new RuntimeException('não deu pra pôr a imagem no lugar');
        }
        @chmod($dir . '/' . $arquivo, 0644);
    } finally {
        if (is_file($temp)) {
            @unlink($temp);
        }
    }

    $tam = (int) filesize($dir . '/' . $arquivo);
    gc_evento('painel', 'imagem-enviada', 'imagem:' . $arquivo, ['bytes' => $tam, 'largura' => $w, 'altura' => $h]);
    return ['_status' => 201, 'imagem' => 'uploads/' . $arquivo, 'largura' => $w, 'altura' => $h, 'bytes' => $tam, 'tipo' => $saida];
}

// ─── vídeo do produto (a thumb animada) ─────────────────────────────────────────────────────────────────────────

/** O maior vídeo que passa: 6 MB, ou o limite do PHP se for menor. */
function gc_video_maximo(): int
{
    $limites = array_filter([GC_VIDEO_MAXIMO, gc_ini_bytes('upload_max_filesize'), gc_ini_bytes('post_max_size')]);
    return (int) min($limites);
}

/** Inteiro sem sinal, big-endian, de $n bytes (até 8) a partir de $p. */
function gc_be(string $b, int $p, int $n): int
{
    $v = 0;
    for ($i = 0; $i < $n; $i++) {
        $v = ($v << 8) | ord($b[$p + $i]);
    }
    return $v;
}

/**
 * MP4 de verdade: o arquivo inteiro é uma fila de caixas bem formadas (tamanho de 32 ou 64 bits, nome de 4 letras
 * legíveis, nenhuma passa do fim), a primeira é 'ftyp' com uma marca conhecida (a principal ou uma das compatíveis), e
 * tem 'moov' e 'mdat'. Devolve a duração em segundos quando o mvhd diz (0 = não diz: o MP4 em pedaços do navegador)
 * ou null se não for MP4.
 */
function gc_video_mp4(string $b): ?float
{
    $n = strlen($b);
    if ($n < 32 || substr($b, 4, 4) !== 'ftyp') {
        return null;
    }
    $p = 0;
    $tem = [];
    $segundos = 0.0;
    while ($p < $n) {
        if ($n - $p < 8) {
            return null;
        }
        $tam = gc_be($b, $p, 4);
        $tipo = substr($b, $p + 4, 4);
        $cab = 8;
        if ($tam === 1) {
            if ($n - $p < 16) {
                return null;
            }
            $tam = gc_be($b, $p + 8, 8);
            $cab = 16;
        } elseif ($tam === 0) {
            $tam = $n - $p; // a última caixa vai até o fim do arquivo
        }
        if ($tam < $cab || $tam > $n - $p || preg_match('/^[A-Za-z0-9 ]{4}$/', $tipo) !== 1) {
            return null;
        }
        if ($p === 0) {
            // ftyp: marca principal (4) + versão (4) + compatíveis (4 cada)
            if ($tipo !== 'ftyp' || $tam < 16) {
                return null;
            }
            $marcas = [substr($b, 8, 4)];
            for ($q = 16; $q + 4 <= $tam; $q += 4) {
                $marcas[] = substr($b, $q, 4);
            }
            if (array_intersect($marcas, GC_MARCAS_MP4) === []) {
                return null;
            }
        } elseif ($tipo === 'ftyp') {
            return null;
        }
        if ($tipo === 'moov') {
            // mvhd: a primeira caixa dentro do moov, quase sempre
            $m = $p + $cab;
            if ($m + 32 <= $p + $tam && substr($b, $m + 4, 4) === 'mvhd') {
                $versao = ord($b[$m + 8]);
                [$escala, $duracao] = $versao === 1 ? [gc_be($b, $m + 28, 4), gc_be($b, $m + 32, 8)] : [gc_be($b, $m + 20, 4), gc_be($b, $m + 24, 4)];
                if ($escala > 0 && $duracao > 0 && $duracao !== 0xFFFFFFFF) {
                    $segundos = $duracao / $escala;
                }
            }
        }
        $tem[$tipo] = true;
        $p += $tam;
    }
    return isset($tem['moov'], $tem['mdat']) ? $segundos : null;
}

/** Número de tamanho variável do EBML (o tamanho de um elemento): [valor, bytes, desconhecido]. null = torto. */
function gc_ebml_vint(string $b, int $p): ?array
{
    if ($p >= strlen($b)) {
        return null;
    }
    $primeiro = ord($b[$p]);
    $len = 1;
    while ($len <= 8 && !($primeiro & (0x80 >> ($len - 1)))) {
        $len++;
    }
    if ($len > 8 || $p + $len > strlen($b)) {
        return null;
    }
    $marca = 0x80 >> ($len - 1);
    $v = $primeiro & ($marca - 1);
    $todos = $v === $marca - 1;
    for ($i = 1; $i < $len; $i++) {
        $byte = ord($b[$p + $i]);
        $todos = $todos && $byte === 0xFF;
        $v = ($v << 8) | $byte;
    }
    return [$v, $len, $todos];
}

/**
 * WebM de verdade: começa no cabeçalho EBML (1A45DFA3) com DocType "webm", logo depois vem o Segment (18538067),
 * que vai até o fim do arquivo (tamanho conhecido batendo, ou "desconhecido", como o navegador grava), com as faixas
 * (Tracks) no começo e pelo menos um Cluster. Devolve a duração em segundos quando o arquivo diz (0 = não diz) ou null.
 */
function gc_video_webm(string $b): ?float
{
    $n = strlen($b);
    if ($n < 64 || substr($b, 0, 4) !== "\x1A\x45\xDF\xA3") {
        return null;
    }
    $t = gc_ebml_vint($b, 4);
    if ($t === null || $t[2] || $t[0] > 256 || 4 + $t[1] + $t[0] > $n) {
        return null;
    }
    $cab = substr($b, 4 + $t[1], $t[0]);
    $fim = 4 + $t[1] + $t[0];
    // os elementos do cabeçalho, um atrás do outro, sem sobrar byte; o DocType (42 82) tem de ser "webm"
    $doc = null;
    $q = 0;
    while ($q < strlen($cab)) {
        if ($q + 2 > strlen($cab)) {
            return null;
        }
        $id = gc_be($cab, $q, 2);
        $s = gc_ebml_vint($cab, $q + 2);
        if ($s === null || $s[2] || $q + 2 + $s[1] + $s[0] > strlen($cab)) {
            return null;
        }
        if ($id === 0x4282) {
            $doc = substr($cab, $q + 2 + $s[1], $s[0]);
        }
        $q += 2 + $s[1] + $s[0];
    }
    if ($doc !== 'webm' || substr($b, $fim, 4) !== "\x18\x53\x80\x67") {
        return null;
    }
    $s = gc_ebml_vint($b, $fim + 4);
    if ($s === null || (!$s[2] && $fim + 4 + $s[1] + $s[0] !== $n)) {
        return null;
    }
    $corpo = substr($b, $fim + 4 + $s[1], 65536);
    if (!str_contains($corpo, "\x16\x54\xAE\x6B") || !str_contains($b, "\x1F\x43\xB6\x75")) {
        return null; // sem Tracks no começo ou sem nenhum Cluster
    }
    // Duration (44 89, float de 4 ou 8 bytes) do Info, em TimecodeScale (padrão 1 ms)
    $segundos = 0.0;
    $i = strpos($corpo, "\x44\x89");
    if ($i !== false) {
        $d = gc_ebml_vint($corpo, $i + 2);
        if ($d !== null && in_array($d[0], [4, 8], true) && $i + 2 + $d[1] + $d[0] <= strlen($corpo)) {
            $cru = substr($corpo, $i + 2 + $d[1], $d[0]);
            $f = $d[0] === 4 ? unpack('G', $cru)[1] : unpack('E', $cru)[1];
            if (is_float($f) && is_finite($f) && $f > 0) {
                $segundos = $f / 1000;
            }
        }
    }
    return $segundos;
}

/**
 * Página, script ou PHP escondido no meio do vídeo (o poliglota): recusa. Os padrões são longos (com o espaço ou o ">"
 * depois), que um vídeo de verdade não tem por acaso.
 */
function gc_video_suspeito(string $b): bool
{
    return preg_match('/<\?php\s|<script[\s>\/]|<html[\s>]|<!doctype\s|<iframe[\s>\/]|<body[\s>]/i', $b) === 1;
}

/** POST admin-video-upload (multipart, campo "video") → { video: 'uploads/<nome>.mp4|webm', tipo, bytes, segundos }. */
function gc_rota_admin_video_upload(): array
{
    gc_exigir_dono();
    $maximo = gc_video_maximo();
    $grande = static fn (): ErroApi => new ErroApi('grande-demais', 'Vídeo grande demais: até ' . gc_mb($maximo) . '.', 413, ['limite' => $maximo]);
    $post = gc_ini_bytes('post_max_size');
    if ($post > 0 && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $post) {
        throw $grande();
    }
    $f = $_FILES['video'] ?? null;
    if (!is_array($f) || is_array($f['error'] ?? null)) {
        throw gc_invalido('video', 'Manda um vídeo (MP4 ou WebM).');
    }
    $erro = (int) $f['error'];
    if ($erro === UPLOAD_ERR_INI_SIZE || $erro === UPLOAD_ERR_FORM_SIZE) {
        throw $grande();
    }
    if ($erro === UPLOAD_ERR_NO_FILE) {
        throw gc_invalido('video', 'Manda um vídeo (MP4 ou WebM).');
    }
    if ($erro !== UPLOAD_ERR_OK) {
        gc_log('upload de vídeo: erro do PHP ' . $erro);
        throw new ErroApi('envio-falhou', 'O envio falhou. Tenta de novo.', 500);
    }
    $tmp = (string) $f['tmp_name'];
    if (!is_uploaded_file($tmp)) {
        throw gc_invalido('video', 'Manda um vídeo (MP4 ou WebM).');
    }
    if ((int) filesize($tmp) > $maximo) {
        throw $grande();
    }
    $conteudo = (string) file_get_contents($tmp);
    // o tipo de verdade, pelos bytes (o nome e o tipo que o navegador mandou não valem nada)
    $tipo = null;
    $segundos = gc_video_mp4($conteudo);
    if ($segundos !== null) {
        $tipo = 'video/mp4';
    } else {
        $segundos = gc_video_webm($conteudo);
        $tipo = $segundos === null ? null : 'video/webm';
    }
    if ($tipo === null) {
        throw new ErroApi('tipo-invalido', 'Isso não é um vídeo MP4 ou WebM.', 415);
    }
    if (gc_video_suspeito($conteudo)) {
        gc_log('upload de vídeo: recusado (página ou script dentro do arquivo)');
        throw new ErroApi('tipo-invalido', 'Esse vídeo tem coisa estranha dentro. Grava de novo pelo painel.', 415);
    }
    unset($conteudo);
    if ($segundos > GC_VIDEO_SEGUNDOS) {
        throw new ErroApi('video-longo', 'Vídeo longo demais: a thumb animada tem até 6 segundos.', 413, ['segundos' => round($segundos, 1)]);
    }

    $dir = gc_pasta_uploads();
    gc_preparar_pasta($dir, GC_HTACCESS_UPLOADS, false);
    $nome = bin2hex(random_bytes(12));
    $temp = $dir . '/.envio-' . $nome;
    $arquivo = $nome . '.' . GC_TIPOS_VIDEO[$tipo];
    try {
        if (!move_uploaded_file($tmp, $temp)) {
            throw new RuntimeException('não deu pra mover o vídeo');
        }
        @chmod($temp, 0644);
        if (!rename($temp, $dir . '/' . $arquivo)) {
            throw new RuntimeException('não deu pra pôr o vídeo no lugar');
        }
    } finally {
        if (is_file($temp)) {
            @unlink($temp);
        }
    }
    $tam = (int) filesize($dir . '/' . $arquivo);
    gc_evento('painel', 'video-enviado', 'video:' . $arquivo, ['bytes' => $tam, 'tipo' => $tipo]);
    return ['_status' => 201, 'video' => 'uploads/' . $arquivo, 'tipo' => $tipo, 'bytes' => $tam, 'segundos' => round((float) $segundos, 2)];
}

// ─── limpeza ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Tira de uploads/ os arquivos que saíram de uso (a foto, o vídeo ou a capa trocados, o produto apagado): só os que
 * ninguém mais cita (produto nenhum, rateio nenhum). Roda depois da transação gravar; falha aqui não desfaz nada.
 * @param list<mixed> $caminhos 'uploads/<nome>' que podem ter saído de uso
 */
function gc_uploads_soltos(array $caminhos): void
{
    foreach (array_unique(array_filter($caminhos, 'is_string')) as $c) {
        if (preg_match('#^uploads/([a-z0-9]{8,64}\.(?:webp|jpe?g|png|mp4|webm))$#', $c, $m) !== 1) {
            continue;
        }
        try {
            $usado = gc_valor('SELECT 1 FROM loja_produtos WHERE foto = ? OR video = ? OR capa = ? UNION ALL SELECT 1 FROM rateios WHERE imagem = ? LIMIT 1', [$c, $c, $c, $c]);
            if ($usado !== null && $usado !== false) {
                continue;
            }
            $arq = gc_pasta_uploads() . '/' . $m[1];
            if (is_file($arq) && !@unlink($arq)) {
                gc_log('limpeza: não deu pra apagar ' . $m[1]);
            }
        } catch (Throwable $e) {
            gc_log('limpeza de uploads: ' . $e->getMessage());
        }
    }
}

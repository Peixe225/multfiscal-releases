<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Envio de imagem do painel → <site>/uploads/. Só JPEG, PNG e WebP de verdade (finfo + getimagesize), até 8 MB
// (ou menos, se o PHP da hospedagem deixar menos). Nome aleatório. Com GD + WebP, recodifica em WebP com o lado
// maior até 1600 px (some qualquer coisa escondida no arquivo e a foto do celular fica leve); sem WebP, recodifica
// no formato original; sem GD, guarda o original já conferido.

const GC_ENVIO_MAXIMO = 8 * 1048576;
const GC_LADO_MAXIMO = 1600;
const GC_MEGAPIXELS_MAXIMO = 40;
const GC_TIPOS_IMAGEM = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];

/** .htaccess de uploads/ (o mesmo de public/uploads/.htaccess): serve imagem e nada mais. */
const GC_HTACCESS_UPLOADS = <<<'HT'
# Envios do painel: só imagem (nome gerado pelo servidor). Nada aqui roda nem vira página.
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
</IfModule>
<IfModule mod_authz_core.c>
  Require all denied
  <FilesMatch "^[a-z0-9]{8,64}\.(webp|jpe?g|png)$">
    Require all granted
  </FilesMatch>
</IfModule>
<IfModule !mod_authz_core.c>
  Order allow,deny
  Deny from all
  <FilesMatch "^[a-z0-9]{8,64}\.(webp|jpe?g|png)$">
    Order deny,allow
    Allow from all
  </FilesMatch>
</IfModule>
<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set Content-Security-Policy "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
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
            imagedestroy($img);
            $img = $girada;
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
                imagedestroy($img);
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
            imagedestroy($img);
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

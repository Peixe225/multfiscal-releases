<?php
// Roteador do "php -S" no desenvolvimento (npm run api) e nos testes (scripts/testar-api.mjs).
// Imita o .htaccess do ar: na API só o index.php responde (privado/, nucleo/, instalacao.php e o resto: 403);
// /uploads/ serve só imagem e o vídeo do produto com nome gerado pelo servidor (com Range, como o Apache; qualquer .php
// ali: 403, nunca executa).
// Dados em greencheese/.dados-dev/ (fora do public/, nunca vão pro build), trocáveis por GC_DADOS e GC_UPLOADS.
declare(strict_types=1);

$raiz = dirname(__DIR__);
foreach (['GC_DADOS' => $raiz . '/.dados-dev', 'GC_UPLOADS' => $raiz . '/.dados-dev/uploads'] as $chave => $padrao) {
    $v = getenv($chave);
    if (!is_string($v) || $v === '') {
        putenv("$chave=$padrao");
    }
}

$caminho = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$caminho = is_string($caminho) ? rawurldecode($caminho) : '/';

function negar(int $status, string $texto): bool
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo $texto, "\n";
    return true;
}

if (str_contains($caminho, "\0") || str_contains($caminho, '..')) {
    return negar(400, 'caminho inválido');
}

if ($caminho === '/api' || $caminho === '/api/' || $caminho === '/api/index.php') {
    $_SERVER['SCRIPT_NAME'] = '/api/index.php';
    $_SERVER['PHP_SELF'] = '/api/index.php';
    $_SERVER['SCRIPT_FILENAME'] = $raiz . '/public/api/index.php';
    chdir($raiz . '/public/api');
    require $raiz . '/public/api/index.php';
    return true;
}

if (str_starts_with($caminho, '/api/')) {
    return negar(403, 'proibido');
}

if (str_starts_with($caminho, '/uploads/')) {
    $nome = substr($caminho, strlen('/uploads/'));
    $pasta = (string) getenv('GC_UPLOADS');
    if (preg_match('/^[a-z0-9]{8,64}\.(webp|jpe?g|png|mp4|webm)$/', $nome, $m) !== 1) {
        return negar(403, 'proibido');
    }
    $arquivo = $pasta . '/' . $nome;
    if (!is_file($arquivo)) {
        return negar(404, 'não encontrado');
    }
    $tam = (int) filesize($arquivo);
    header('Content-Type: ' . ['webp' => 'image/webp', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'mp4' => 'video/mp4', 'webm' => 'video/webm'][$m[1]]);
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    header('Cache-Control: public, max-age=31536000, immutable');
    header('Accept-Ranges: bytes');
    // pedaço do arquivo (Range: bytes=a-b), como o Apache faz: o <video> pede assim
    $faixa = (string) ($_SERVER['HTTP_RANGE'] ?? '');
    if ($faixa !== '' && preg_match('/^bytes=(\d*)-(\d*)$/', $faixa, $r) === 1 && ($r[1] !== '' || $r[2] !== '')) {
        [$ini, $fim] = $r[1] === '' ? [max(0, $tam - (int) $r[2]), $tam - 1] : [(int) $r[1], $r[2] === '' ? $tam - 1 : min((int) $r[2], $tam - 1)];
        if ($ini > $fim || $ini >= $tam) {
            http_response_code(416);
            header("Content-Range: bytes */$tam");
            return true;
        }
        http_response_code(206);
        header("Content-Range: bytes $ini-$fim/$tam");
        header('Content-Length: ' . ($fim - $ini + 1));
        $f = fopen($arquivo, 'rb');
        fseek($f, $ini);
        echo fread($f, $fim - $ini + 1);
        fclose($f);
        return true;
    }
    header('Content-Length: ' . $tam);
    readfile($arquivo);
    return true;
}

return negar(404, 'API de desenvolvimento da Green Cheese: aqui só tem /api/index.php e /uploads/. O site roda no Vite (npm run dev).');

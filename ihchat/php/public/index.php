<?php
/**
 * Front controller: TODA requisição que não é arquivo real cai aqui
 * (public/.htaccess no LiteSpeed/Apache; roteador do `php -S` no desenvolvimento).
 */
declare(strict_types=1);

if (PHP_SAPI === 'cli-server') {
    // php -S (desenvolvimento): o mesmo que o public/.htaccess faz no
    // LiteSpeed. /instalar vai para o instalador; public/web (sobra de pacote
    // antigo) não sai direto; os demais arquivos reais de public/ saem, menos
    // arquivos ocultos e o próprio PHP
    $caminho = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
    if ($caminho === '/instalar' || $caminho === '/instalar/') {
        require __DIR__ . '/instalar.php';
        return true;
    }
    $arquivo = realpath(__DIR__ . rawurldecode($caminho));
    if ($arquivo !== false && is_file($arquivo) && str_starts_with($arquivo, __DIR__ . DIRECTORY_SEPARATOR)
        && !str_contains($caminho, '/.') && !str_ends_with($arquivo, '.php')
        && !str_starts_with($arquivo, __DIR__ . DIRECTORY_SEPARATOR . 'web' . DIRECTORY_SEPARATOR)) {
        return false;
    }
}

require dirname(__DIR__) . '/app/autoload.php';

IHchat\Nucleo\Aplicacao::executar();

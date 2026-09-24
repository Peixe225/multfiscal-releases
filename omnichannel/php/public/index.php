<?php
/**
 * Front controller: TODA requisição que não é arquivo real cai aqui
 * (public/.htaccess no LiteSpeed/Apache; roteador do `php -S` no desenvolvimento).
 */
declare(strict_types=1);

if (PHP_SAPI === 'cli-server') {
    // php -S: arquivos reais de public/ (ex.: public/web/ no pacote) saem
    // direto, menos arquivos ocultos e o próprio PHP
    $caminho = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
    $arquivo = realpath(__DIR__ . rawurldecode($caminho));
    if ($arquivo !== false && is_file($arquivo) && str_starts_with($arquivo, __DIR__ . DIRECTORY_SEPARATOR)
        && !str_contains($caminho, '/.') && !str_ends_with($arquivo, '.php')) {
        return false;
    }
}

require dirname(__DIR__) . '/app/autoload.php';

OmniChannel\Nucleo\Aplicacao::executar();

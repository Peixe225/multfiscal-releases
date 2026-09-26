<?php
/**
 * Autoload PSR-4 próprio: IHchat\Nucleo\Roteador -> app/Nucleo/Roteador.php.
 *
 * A hospedagem não roda composer, então tudo o que vai para produção precisa
 * carregar sem ele. Uma função de dez linhas resolve e não esconde nada.
 */
declare(strict_types=1);

spl_autoload_register(static function (string $classe): void {
    $prefixo = 'IHchat\\';
    if (strncmp($classe, $prefixo, strlen($prefixo)) !== 0) {
        return;
    }
    $relativo = str_replace('\\', '/', substr($classe, strlen($prefixo)));
    $arquivo = __DIR__ . '/' . $relativo . '.php';
    if (is_file($arquivo)) {
        require $arquivo;
    }
});

<?php
/**
 * Instalador web: https://<endereço>/instalar (o .htaccess reescreve para cá).
 *
 * Só funciona enquanto não existe config.php e só com o código de
 * dados/instalacao.codigo; depois da instalação responde 404. Toda a lógica
 * está em app/Instalacao/Instalador.php.
 */
declare(strict_types=1);

require dirname(__DIR__) . '/app/autoload.php';

IHchat\Instalacao\Instalador::executar();

<?php
// Uso: php scripts/testar-obsoleto.php public/api/nucleo/base.php (com GC_DADOS numa pasta temporária)
// Simula o PHP novo da Hostinger: uma rota que esbarra num aviso de "obsoleto" (o E_USER_DEPRECATED faz o papel do
// E_DEPRECATED que o PHP 8.5 dá no imagedestroy(), no curl_close() e no $http_response_header). A rota tem de seguir
// com {"ok":true} e o aviso tem de ir pro log (antes de 14/10 virava "erro-interno" e derrubava o envio de foto).
declare(strict_types=1);
define('GC_API', 'teste');
require $argv[1];
$_GET['r'] = 'teste-obsoleto';
$_SERVER['REQUEST_METHOD'] = 'GET';
gc_atender(['teste-obsoleto' => ['GET', static function (): array {
    for ($i = 0; $i < 3; $i++) {
        trigger_error('imagedestroy() is deprecated', E_USER_DEPRECATED); // o mesmo lugar 3 vezes: 1 linha no log
    }
    return ['passou' => true];
}]]);

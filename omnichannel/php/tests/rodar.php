<?php
/**
 * Testes de unidade do PHP (só rodam localmente; nunca vão para produção).
 *
 *   php php/tests/rodar.php            todos
 *   php php/tests/rodar.php Token      só os arquivos cujo nome contém "Token"
 *
 * Cada arquivo *Teste.php devolve um array nome => closure. Uma closure que
 * termina sem exceção passou. Antes de cada teste o ambiente é recriado:
 * config de sandbox e SQLite em memória com o esquema aplicado.
 */
declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '1');
set_error_handler(static function (int $nivel, string $mensagem, string $arquivo, int $linha): bool {
    // nos testes, aviso e depreciação são falha: o PHP 8.5 da hospedagem é mais novo que o daqui
    if ((error_reporting() & $nivel) === 0) {
        return true;
    }
    throw new ErrorException($mensagem, 0, $nivel, $arquivo, $linha);
});

require dirname(__DIR__) . '/app/autoload.php';
require __DIR__ . '/Afirmar.php';

use OmniChannel\Banco\Banco;
use OmniChannel\Banco\Esquema;
use OmniChannel\Nucleo\Aplicacao;
use OmniChannel\Nucleo\Config;
use OmniChannel\Nucleo\Datas;
use OmniChannel\Nucleo\Http\Cliente;

function preparar_ambiente(array $extra = []): void
{
    $pasta = sys_get_temp_dir() . '/omni-testes-php-' . getmypid();
    Config::definir(Config::deArray($extra + [
        'driver' => 'sqlite',
        'dsn' => 'sqlite::memory:',
        'chave_secreta' => 'chave-de-teste',
        'modo_sandbox' => true,
        'pasta_dados' => $pasta,
        'pasta_web' => dirname(__DIR__, 2) . '/app/web',
    ]));
    $pdo = Banco::abrir(Config::obter());
    Banco::definir($pdo);
    Esquema::aplicar($pdo);
    Datas::congelar(null);
    Cliente::definirTransporte(null);
    // um teste que troca a fábrica de adaptadores não pode vazar para o próximo
    \OmniChannel\Atendimento\Adaptadores::definir(null);
    Aplicacao::reiniciar();
}

$filtro = $argv[1] ?? '';
$total = 0;
$falhas = [];
foreach (glob(__DIR__ . '/*Teste.php') ?: [] as $arquivo) {
    if ($filtro !== '' && !str_contains(basename($arquivo), $filtro)) {
        continue;
    }
    $casos = require $arquivo;
    foreach ($casos as $nome => $caso) {
        $total++;
        $rotulo = basename($arquivo, '.php') . ' :: ' . $nome;
        try {
            preparar_ambiente();
            $caso();
            echo '.';
        } catch (Throwable $erro) {
            echo 'F';
            $falhas[] = "{$rotulo}\n    " . get_class($erro) . ': ' . $erro->getMessage() . "\n    em " . $erro->getFile() . ':' . $erro->getLine();
        }
    }
}
echo PHP_EOL;
foreach ($falhas as $falha) {
    echo "FALHOU {$falha}\n";
}
printf("%d testes, %d falhas\n", $total, count($falhas));
exit($falhas === [] ? 0 : 1);

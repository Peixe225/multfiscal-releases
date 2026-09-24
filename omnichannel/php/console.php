<?php
/**
 * Utilitários de linha de comando (SSH, cron ou o "Terminal" da hospedagem).
 *
 *   php console.php esquema              cria/atualiza as tabelas
 *   php console.php semear [--demo]      base inicial (só em base vazia)
 *   php console.php hash-senha           lê uma senha da entrada e imprime o hash
 *   php console.php rotas                lista as rotas registradas
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/app/autoload.php';

use OmniChannel\Auth\Senhas;
use OmniChannel\Banco\Esquema;
use OmniChannel\Instalacao\Seed;
use OmniChannel\Nucleo\Aplicacao;

$comando = $argv[1] ?? '';
$opcoes = array_slice($argv, 2);

try {
    switch ($comando) {
        case 'esquema':
            $aplicadas = Esquema::aplicar();
            echo $aplicadas ? 'Migrações aplicadas: ' . implode(', ', $aplicadas) . PHP_EOL : 'Esquema já em dia.' . PHP_EOL;
            break;
        case 'semear':
            $resultado = Seed::semear(in_array('--demo', $opcoes, true));
            echo $resultado['mensagem'] . PHP_EOL;
            break;
        case 'hash-senha':
            $senha = rtrim((string) fgets(STDIN), "\r\n");
            echo Senhas::gerarHash($senha) . PHP_EOL;
            break;
        case 'rotas':
            foreach (Aplicacao::roteador()->listar() as $rota) {
                printf("%-7s %s\n", implode(',', $rota['metodos']), $rota['padrao']);
            }
            break;
        default:
            fwrite(STDERR, "uso: php console.php esquema | semear [--demo] | hash-senha | rotas\n");
            exit(2);
    }
} catch (Throwable $erro) {
    fwrite(STDERR, 'erro: ' . $erro->getMessage() . PHP_EOL);
    exit(1);
}

<?php
/**
 * Tarefas periódicas. Na Hostinger (hPanel -> Avançado -> Cron Jobs), comando
 * personalizado, a cada minuto (* * * * *):
 *
 *   /usr/bin/php /home/<usuario>/domains/<dominio>/public_html/omnichannel2/cron.php
 *
 * (o caminho exato aparece no Gerenciador de Arquivos; o cron.php fica na raiz
 * de omnichannel2/, FORA do public/, e recusa ser chamado pela web).
 *
 * O que roda hoje: ColetarCanais (e-mail por IMAP e Telegram em polling, a
 * cada minuto) e PodarEventos (fila de tempo real, de hora em hora).
 * `php cron.php ColetarCanais` roda uma tarefa na hora, ignorando o intervalo.
 *
 * Cada tarefa é uma classe em app/Tarefas/ (ou app/<Modulo>/Tarefas/) com:
 *   public const INTERVALO = <segundos>;          // de quanto em quanto tempo
 *   public static function executar(): string;    // resumo para o log
 * Uma trava por tarefa impede que duas execuções se sobreponham, e a última
 * execução fica anotada em dados/tarefas/, para respeitar o INTERVALO mesmo
 * com o cron chamando a cada minuto.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/app/autoload.php';

use OmniChannel\Banco\Esquema;
use OmniChannel\Nucleo\Config;
use OmniChannel\Nucleo\Log;

$somente = $argv[1] ?? null;

/**
 * Memória do cron: a coleta lê um e-mail por vez e pula os maiores que o
 * limite de anexo (AdaptadorEmail::tamanhoMaximoColeta), mas decodificar um
 * anexo de 20 MB ainda pede algumas vezes isso. Sobe para 512 MB quando o PHP
 * CLI vem com menos (128 MB é comum); nunca baixa um limite maior já definido.
 */
function omni_bytes_do_ini(string $valor): int
{
    $valor = trim($valor);
    if ($valor === '' || $valor === '-1') {
        return -1;
    }
    $numero = (int) $valor;
    return match (strtolower(substr($valor, -1))) {
        'g' => $numero * 1024 ** 3,
        'm' => $numero * 1024 ** 2,
        'k' => $numero * 1024,
        default => $numero,
    };
}
$limiteAtual = omni_bytes_do_ini((string) ini_get('memory_limit'));
if ($limiteAtual !== -1 && $limiteAtual < 512 * 1024 ** 2) {
    ini_set('memory_limit', '512M');
}

// erro fatal (memória, tempo) não passa por catch: sem isto, o cron morria
// calado e a mesma causa se repetia a cada minuto sem ninguém saber
register_shutdown_function(static function (): void {
    $erro = error_get_last();
    if ($erro !== null && in_array($erro['type'], [E_ERROR, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
        $texto = "cron: erro fatal: {$erro['message']} em {$erro['file']}:{$erro['line']}";
        fwrite(STDERR, $texto . PHP_EOL);
        try {
            Log::erro($texto);
        } catch (Throwable) {
            // sem log gravável, o STDERR (e o e-mail do cron) é o que resta
        }
    }
});

try {
    $config = Config::obter();
    Esquema::garantir();
} catch (Throwable $erro) {
    fwrite(STDERR, 'cron: ' . $erro->getMessage() . PHP_EOL);
    exit(1);
}

$pasta = $config->pasta('tarefas');
// app/Tarefas/X.php -> OmniChannel\Tarefas\X; app/Canais/Tarefas/X.php -> OmniChannel\Canais\Tarefas\X
$tarefas = [];
foreach (array_merge(glob(__DIR__ . '/app/Tarefas/*.php') ?: [], glob(__DIR__ . '/app/*/Tarefas/*.php') ?: []) as $arquivo) {
    $relativo = substr(dirname($arquivo), strlen(__DIR__ . '/app/'));
    $tarefas[basename($arquivo, '.php')] = 'OmniChannel\\' . str_replace('/', '\\', $relativo) . '\\' . basename($arquivo, '.php');
}
ksort($tarefas);
foreach ($tarefas as $nome => $classe) {
    if ($somente !== null && $somente !== $nome) {
        continue;
    }
    if (!class_exists($classe) || !method_exists($classe, 'executar')) {
        continue;
    }
    $intervalo = defined("{$classe}::INTERVALO") ? (int) constant("{$classe}::INTERVALO") : 60;
    $marca = "{$pasta}/{$nome}.ultima";
    if ($somente === null && is_file($marca) && time() - (int) file_get_contents($marca) < $intervalo - 5) {
        continue;
    }
    $trava = fopen("{$pasta}/{$nome}.lock", 'c');
    if ($trava === false || !flock($trava, LOCK_EX | LOCK_NB)) {
        continue; // a execução anterior ainda está rodando
    }
    try {
        file_put_contents($marca, (string) time());
        $resumo = $classe::executar();
        if ($resumo !== '') {
            Log::info("tarefa {$nome}: {$resumo}");
        }
    } catch (Throwable $erro) {
        Log::excecao($erro, "tarefa {$nome}");
    } finally {
        flock($trava, LOCK_UN);
        fclose($trava);
    }
}

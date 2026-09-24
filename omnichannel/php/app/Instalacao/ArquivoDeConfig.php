<?php
declare(strict_types=1);

namespace OmniChannel\Instalacao;

use OmniChannel\Nucleo\Datas;

/**
 * Escreve o config.php da instalação.
 *
 * O arquivo guarda a senha do banco e a chave que assina os tokens, então:
 *  - fica FORA do public/ (php/config.php) e com permissão 0600;
 *  - todo valor entra por var_export (nada digitado no formulário vira código
 *    PHP: uma senha com aspas ou "?>" continua sendo só texto);
 *  - a gravação é em duas etapas: um temporário é criado ANTES de mexer no
 *    banco (se a pasta não aceita escrita, a instalação para sem deixar base
 *    pela metade) e só é renomeado para config.php no fim, de uma vez.
 */
final class ArquivoDeConfig
{
    private ?string $temporario = null;

    public function __construct(private readonly string $destino)
    {
    }

    /**
     * Grava o conteúdo num temporário ao lado do destino.
     *
     * @param array<string, mixed> $valores chaves do config (ver config.exemplo.php)
     * @param list<string> $relativasAoConfig chaves cujo valor é um caminho
     *        relativo à pasta do config (viram `__DIR__ . '/...'`, para o
     *        arquivo continuar valendo se a pasta mudar de lugar)
     */
    public function preparar(array $valores, array $relativasAoConfig = []): void
    {
        $pasta = dirname($this->destino);
        if (!is_dir($pasta) || !is_writable($pasta)) {
            throw new \RuntimeException("sem permissão de escrita na pasta do config: {$pasta}");
        }
        $temporario = $pasta . '/.config-' . bin2hex(random_bytes(6)) . '.tmp';
        // cria já restrito: não existe instante em que o segredo fique legível por outros
        $antiga = umask(0077);
        try {
            $ok = file_put_contents($temporario, $this->conteudo($valores, $relativasAoConfig), LOCK_EX);
        } finally {
            umask($antiga);
        }
        if ($ok === false) {
            throw new \RuntimeException("não foi possível gravar o config em {$pasta}");
        }
        @chmod($temporario, 0600);
        $this->temporario = $temporario;
    }

    /** Coloca o config no lugar (rename é atômico na mesma pasta). */
    public function efetivar(): void
    {
        if ($this->temporario === null) {
            throw new \LogicException('preparar() antes de efetivar()');
        }
        if (!@rename($this->temporario, $this->destino)) {
            throw new \RuntimeException('não foi possível colocar o config.php no lugar');
        }
        @chmod($this->destino, 0600);
        $this->temporario = null;
    }

    /** Desiste (erro no meio da instalação): o temporário não pode ficar para trás. */
    public function descartar(): void
    {
        if ($this->temporario !== null) {
            @unlink($this->temporario);
            $this->temporario = null;
        }
    }

    /**
     * @param array<string, mixed> $valores
     * @param list<string> $relativasAoConfig
     */
    public function conteudo(array $valores, array $relativasAoConfig = []): string
    {
        $linhas = [];
        foreach ($valores as $chave => $valor) {
            if (in_array($chave, $relativasAoConfig, true) && is_string($valor)) {
                $expressao = "__DIR__ . " . var_export('/' . ltrim($valor, '/'), true);
                if (str_starts_with((string) $chave, 'dsn')) {
                    // dsn do SQLite: "sqlite:" + caminho relativo ao config
                    $expressao = "'sqlite:' . __DIR__ . " . var_export('/' . ltrim($valor, '/'), true);
                }
            } else {
                $expressao = $this->exportar($valor);
            }
            $linhas[] = '    ' . var_export((string) $chave, true) . ' => ' . $expressao . ',';
        }
        $quando = Datas::agora()->format('Y-m-d H:i:s') . ' UTC';
        return "<?php\n"
            . "/**\n"
            . " * Configuração do OmniChannel 2, gerada pelo instalador em {$quando}.\n"
            . " *\n"
            . " * Contém a senha do banco e a chave que assina os logins: NUNCA publique,\n"
            . " * versione ou envie este arquivo. Modelo comentado: config.exemplo.php.\n"
            . " * Para migrar para a VPS (app Python), use a mesma chave_secreta em\n"
            . " * OMNI_CHAVE_SECRETA e ninguém precisa entrar de novo.\n"
            . " */\n"
            . "return [\n" . implode("\n", $linhas) . "\n];\n";
    }

    private function exportar(mixed $valor): string
    {
        if (is_array($valor)) {
            $itens = [];
            $lista = array_is_list($valor);
            foreach ($valor as $k => $v) {
                $itens[] = ($lista ? '' : var_export($k, true) . ' => ') . $this->exportar($v);
            }
            return '[' . implode(', ', $itens) . ']';
        }
        if ($valor === null) {
            return 'null';
        }
        return var_export($valor, true);
    }
}

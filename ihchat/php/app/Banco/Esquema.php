<?php
declare(strict_types=1);

namespace IHchat\Banco;

use IHchat\Nucleo\Config;
use IHchat\Nucleo\Datas;
use PDO;

/**
 * Criação e evolução do esquema, idempotente e versionada.
 *
 * O DDL é escrito uma vez com marcadores que viram o tipo certo em cada banco:
 *
 *   {ID}     chave primária autoincremento (INT no MySQL)
 *   {ID64}   idem, BIGINT no MySQL (fila de eventos)
 *   {DATA}   data/hora UTC: TEXT no SQLite, DATETIME(6) no MySQL
 *   {BOOL}   INTEGER / TINYINT(1)
 *   {TEXTO}  texto longo: TEXT / LONGTEXT
 *   {JSON}   JSON guardado como texto (mesmos tipos de {TEXTO})
 *   {BIN}    comparação sensível a maiúsculas no MySQL (ids externos, tokens);
 *            o padrão utf8mb4_unicode_ci acharia "AbC" igual a "abc"
 */
final class Esquema
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function driver(): string
    {
        return (string) $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
    }

    public function mysql(): bool
    {
        return $this->driver() === 'mysql';
    }

    /** Expande os marcadores de tipo para o banco em uso. */
    public function sql(string $modelo): string
    {
        $mysql = $this->mysql();
        return strtr($modelo, [
            '{ID}' => $mysql ? 'INT NOT NULL AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT',
            '{ID64}' => $mysql ? 'BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT',
            '{DATA}' => $mysql ? 'DATETIME(6)' : 'TEXT',
            '{BOOL}' => $mysql ? 'TINYINT(1)' : 'INTEGER',
            '{TEXTO}' => $mysql ? 'LONGTEXT' : 'TEXT',
            '{JSON}' => $mysql ? 'LONGTEXT' : 'TEXT',
            '{BIN}' => $mysql ? ' COLLATE utf8mb4_bin' : '',
        ]);
    }

    /** CREATE TABLE IF NOT EXISTS com o corpo em DDL com marcadores. */
    public function criarTabela(string $tabela, string $corpo): void
    {
        $sufixo = $this->mysql() ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
        $this->pdo->exec($this->sql("CREATE TABLE IF NOT EXISTS {$tabela} (\n{$corpo}\n){$sufixo}"));
    }

    /** @param list<string> $colunas */
    public function criarIndice(string $tabela, string $nome, array $colunas, bool $unico = false): void
    {
        if ($this->existeIndice($tabela, $nome)) {
            return;
        }
        $this->pdo->exec(sprintf(
            'CREATE %sINDEX %s ON %s (%s)',
            $unico ? 'UNIQUE ' : '',
            $nome,
            $tabela,
            implode(', ', $colunas)
        ));
    }

    /** ALTER TABLE ADD COLUMN só se ainda não existir. $definicao aceita marcadores. */
    public function adicionarColuna(string $tabela, string $coluna, string $definicao): void
    {
        if ($this->existeColuna($tabela, $coluna)) {
            return;
        }
        $this->pdo->exec($this->sql("ALTER TABLE {$tabela} ADD COLUMN {$coluna} {$definicao}"));
    }

    public function executar(string $sql): void
    {
        $this->pdo->exec($this->sql($sql));
    }

    public function existeTabela(string $tabela): bool
    {
        if ($this->mysql()) {
            $sql = 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?';
        } else {
            $sql = "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?";
        }
        $comando = $this->pdo->prepare($sql);
        $comando->execute([$tabela]);
        return (int) $comando->fetchColumn() > 0;
    }

    public function existeColuna(string $tabela, string $coluna): bool
    {
        if ($this->mysql()) {
            $comando = $this->pdo->prepare(
                'SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?'
            );
            $comando->execute([$tabela, $coluna]);
            return (int) $comando->fetchColumn() > 0;
        }
        foreach ($this->pdo->query('PRAGMA table_info(' . $this->nomeSeguro($tabela) . ')')->fetchAll(PDO::FETCH_ASSOC) as $linha) {
            if ($linha['name'] === $coluna) {
                return true;
            }
        }
        return false;
    }

    public function existeIndice(string $tabela, string $nome): bool
    {
        if ($this->mysql()) {
            $comando = $this->pdo->prepare(
                'SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?'
            );
            $comando->execute([$tabela, $nome]);
        } else {
            $comando = $this->pdo->prepare("SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?");
            $comando->execute([$nome]);
        }
        return (int) $comando->fetchColumn() > 0;
    }

    private function nomeSeguro(string $nome): string
    {
        if (preg_match('/^[a-z_][a-z0-9_]*$/', $nome) !== 1) {
            throw new \InvalidArgumentException("nome inválido: {$nome}");
        }
        return $nome;
    }

    // ------------------------------------------------------------ migrações

    /** @return list<string> nomes das classes de migração, em ordem */
    public static function descobrir(): array
    {
        $nomes = [];
        foreach (glob(__DIR__ . '/Migracoes/M*.php') ?: [] as $arquivo) {
            $nomes[] = basename($arquivo, '.php');
        }
        sort($nomes, SORT_STRING);
        return $nomes;
    }

    /**
     * Aplica as migrações pendentes. Devolve os nomes aplicados agora.
     *
     * @return list<string>
     */
    public static function aplicar(?PDO $pdo = null): array
    {
        $pdo ??= Banco::conexao();
        $esquema = new self($pdo);
        $esquema->criarTabela('migracoes', <<<SQL
            nome VARCHAR(120) NOT NULL PRIMARY KEY,
            descricao VARCHAR(255) NOT NULL,
            aplicada_em {DATA} NOT NULL
            SQL);

        $feitas = array_column($pdo->query('SELECT nome FROM migracoes')->fetchAll(PDO::FETCH_ASSOC), 'nome');
        $aplicadas = [];
        foreach (self::descobrir() as $nome) {
            if (in_array($nome, $feitas, true)) {
                continue;
            }
            $classe = __NAMESPACE__ . '\\Migracoes\\' . $nome;
            /** @var Migracao $migracao */
            $migracao = new $classe();
            $migracao->aplicar($esquema);
            $comando = $pdo->prepare('INSERT INTO migracoes (nome, descricao, aplicada_em) VALUES (?, ?, ?)');
            $comando->execute([$nome, mb_substr($migracao->descricao(), 0, 255), Datas::agoraBanco()]);
            $aplicadas[] = $nome;
        }
        return $aplicadas;
    }

    /**
     * Garante o esquema em dia, barato o bastante para rodar a cada requisição:
     * uma marca em pasta_dados guarda a lista de migrações já conferida, e só
     * quando ela muda (deploy com migração nova) o banco é consultado — sob
     * trava de arquivo, para duas requisições simultâneas não migrarem juntas.
     */
    public static function garantir(): void
    {
        $config = Config::obter();
        $assinatura = hash('sha256', $config->dsn . '|' . implode(',', self::descobrir()));
        $marca = $config->pasta() . '/esquema.ok';
        $bancoExiste = true;
        if ($config->driver === 'sqlite') {
            $arquivo = substr($config->dsn, strlen('sqlite:'));
            // banco em memória nasce vazio a cada conexão: a marca não vale
            $bancoExiste = $arquivo !== ':memory:' && is_file($arquivo) && filesize($arquivo) > 0;
        }
        if ($bancoExiste && is_file($marca) && trim((string) @file_get_contents($marca)) === $assinatura) {
            return;
        }
        $trava = fopen($config->pasta() . '/esquema.lock', 'c');
        if ($trava !== false) {
            flock($trava, LOCK_EX);
        }
        try {
            self::aplicar();
            @file_put_contents($marca, $assinatura);
        } finally {
            if ($trava !== false) {
                flock($trava, LOCK_UN);
                fclose($trava);
            }
        }
    }
}

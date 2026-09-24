<?php
declare(strict_types=1);

namespace OmniChannel\Banco;

use OmniChannel\Nucleo\Config;
use PDO;
use PDOException;
use PDOStatement;

/**
 * Acesso ao banco: uma conexão PDO por requisição, MySQL/MariaDB em produção
 * e SQLite em desenvolvimento e testes.
 *
 * Regras (valem para todo o código PHP do projeto):
 *  - SEMPRE parâmetros (? ou :nome). Nome de tabela/coluna nunca vem do usuário;
 *    inserir()/atualizar() conferem os nomes por lista branca de caracteres.
 *  - SQL portável: nada de INSERT OR IGNORE, ON DUPLICATE KEY, RETURNING,
 *    ILIKE, funções de data do banco. Datas são calculadas no PHP (Datas) e
 *    comparadas como texto no formato do banco.
 *  - Unicidade violada: capture PDOException e pergunte eUnicidade($e).
 *  - Valores lidos podem vir como int ou string conforme o driver: converta
 *    sempre ((int), (bool)) ao montar a saída da API.
 */
final class Banco
{
    private static ?PDO $conexao = null;

    /** A conexão da requisição (aberta na primeira chamada). */
    public static function conexao(): PDO
    {
        if (self::$conexao === null) {
            self::$conexao = self::abrir(Config::obter());
        }
        return self::$conexao;
    }

    /** Troca a conexão (testes de unidade) ou fecha (null). */
    public static function definir(?PDO $conexao): void
    {
        self::$conexao = $conexao;
    }

    public static function abrir(Config $config): PDO
    {
        $opcoes = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // prepared statements de verdade: tipos nativos na volta e LIMIT ? funciona
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_STRINGIFY_FETCHES => false,
        ];
        if ($config->driver === 'sqlite') {
            $arquivo = substr($config->dsn, strlen('sqlite:'));
            if ($arquivo !== '' && $arquivo !== ':memory:' && !is_dir(dirname($arquivo))) {
                @mkdir(dirname($arquivo), 0775, true);
            }
        }
        $pdo = new PDO($config->dsn, $config->usuario, $config->senha, $opcoes);
        if ($config->driver === 'sqlite') {
            // sem isto o SQLite ignora ON DELETE CASCADE; WAL deixa leitores
            // e o gravador trabalharem juntos (painel consultando eventos)
            $pdo->exec('PRAGMA foreign_keys = ON');
            $pdo->exec('PRAGMA busy_timeout = 5000');
            if ($arquivo !== ':memory:') {
                $pdo->exec('PRAGMA journal_mode = WAL');
            }
        } else {
            // utf8mb4 para emoji; UTC para nunca depender do fuso do servidor;
            // modo estrito para o MySQL recusar em vez de truncar calado
            $pdo->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
            $pdo->exec("SET time_zone = '+00:00'");
            $pdo->exec("SET SESSION sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
        }
        return $pdo;
    }

    public static function driver(): string
    {
        return (string) self::conexao()->getAttribute(PDO::ATTR_DRIVER_NAME);
    }

    /**
     * Prepara e executa com tipos corretos (int como int: LIMIT ? exige).
     *
     * @param array<int|string, mixed> $parametros
     */
    public static function executarConsulta(string $sql, array $parametros = []): PDOStatement
    {
        $comando = self::conexao()->prepare($sql);
        foreach ($parametros as $chave => $valor) {
            $nome = is_int($chave) ? $chave + 1 : (str_starts_with($chave, ':') ? $chave : ':' . $chave);
            [$valor, $tipo] = self::tipoDe($valor);
            $comando->bindValue($nome, $valor, $tipo);
        }
        $comando->execute();
        return $comando;
    }

    /**
     * @param array<int|string, mixed> $parametros
     * @return array<string, mixed>|null a primeira linha
     */
    public static function um(string $sql, array $parametros = []): ?array
    {
        $linha = self::executarConsulta($sql, $parametros)->fetch();
        return $linha === false ? null : $linha;
    }

    /**
     * @param array<int|string, mixed> $parametros
     * @return list<array<string, mixed>>
     */
    public static function todos(string $sql, array $parametros = []): array
    {
        return self::executarConsulta($sql, $parametros)->fetchAll();
    }

    /**
     * Primeira coluna da primeira linha (COUNT, MAX...), ou null.
     *
     * @param array<int|string, mixed> $parametros
     */
    public static function valor(string $sql, array $parametros = []): mixed
    {
        $valor = self::executarConsulta($sql, $parametros)->fetchColumn();
        return $valor === false ? null : $valor;
    }

    /**
     * UPDATE/DELETE/DDL. Devolve as linhas afetadas.
     *
     * @param array<int|string, mixed> $parametros
     */
    public static function executar(string $sql, array $parametros = []): int
    {
        return self::executarConsulta($sql, $parametros)->rowCount();
    }

    /**
     * INSERT a partir de um array coluna => valor. Devolve o id gerado.
     * Arrays e objetos viram JSON (colunas credenciais, metadados...).
     *
     * @param array<string, mixed> $dados
     */
    public static function inserir(string $tabela, array $dados): int
    {
        self::conferirNome($tabela);
        $colunas = array_keys($dados);
        array_map([self::class, 'conferirNome'], $colunas);
        $sql = sprintf(
            'INSERT INTO %s (%s) VALUES (%s)',
            $tabela,
            implode(', ', $colunas),
            implode(', ', array_fill(0, count($colunas), '?'))
        );
        self::executarConsulta($sql, array_values(array_map([self::class, 'paraColuna'], $dados)));
        return (int) self::conexao()->lastInsertId();
    }

    /**
     * UPDATE tabela SET ... WHERE $onde. Devolve as linhas afetadas.
     *
     * @param array<string, mixed> $dados
     * @param list<mixed> $parametrosOnde parâmetros posicionais de $onde
     */
    public static function atualizar(string $tabela, array $dados, string $onde, array $parametrosOnde = []): int
    {
        if ($dados === []) {
            return 0;
        }
        self::conferirNome($tabela);
        $sets = [];
        foreach (array_keys($dados) as $coluna) {
            self::conferirNome($coluna);
            $sets[] = "{$coluna} = ?";
        }
        $sql = sprintf('UPDATE %s SET %s WHERE %s', $tabela, implode(', ', $sets), $onde);
        $valores = array_values(array_map([self::class, 'paraColuna'], $dados));
        return self::executar($sql, [...$valores, ...array_values($parametrosOnde)]);
    }

    /**
     * Executa $acao numa transação: commit no fim, rollback em qualquer erro.
     * Aninhar é seguro (a interna só participa da externa).
     *
     * @template T
     * @param callable(): T $acao
     * @return T
     */
    public static function transacao(callable $acao): mixed
    {
        $pdo = self::conexao();
        if ($pdo->inTransaction()) {
            return $acao();
        }
        $pdo->beginTransaction();
        try {
            $resultado = $acao();
            $pdo->commit();
            return $resultado;
        } catch (\Throwable $erro) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $erro;
        }
    }

    /** Desfaz transação esquecida aberta (o front controller chama em erro). */
    public static function desfazerPendente(): void
    {
        if (self::$conexao !== null && self::$conexao->inTransaction()) {
            self::$conexao->rollBack();
        }
    }

    /** A exceção é de UNIQUE violado (MySQL 1062, SQLite "UNIQUE constraint failed")? */
    public static function eUnicidade(PDOException $erro): bool
    {
        $info = $erro->errorInfo ?? [];
        if (($info[1] ?? null) === 1062) {
            return true;
        }
        return str_contains($erro->getMessage(), 'UNIQUE constraint failed')
            || str_contains($erro->getMessage(), 'Duplicate entry');
    }

    /** Valor PHP -> valor gravável (bool vira 0/1; array/objeto vira JSON). */
    public static function paraColuna(mixed $valor): mixed
    {
        if (is_bool($valor)) {
            return $valor ? 1 : 0;
        }
        if (is_array($valor) || is_object($valor)) {
            if ($valor instanceof \DateTimeInterface) {
                return \OmniChannel\Nucleo\Datas::paraBanco($valor);
            }
            return \OmniChannel\Nucleo\Json::codificar($valor);
        }
        return $valor;
    }

    /** @return array{0: mixed, 1: int} */
    private static function tipoDe(mixed $valor): array
    {
        $valor = self::paraColuna($valor);
        return match (true) {
            $valor === null => [null, PDO::PARAM_NULL],
            is_int($valor) => [$valor, PDO::PARAM_INT],
            is_float($valor) => [(string) $valor, PDO::PARAM_STR],
            default => [(string) $valor, PDO::PARAM_STR],
        };
    }

    private static function conferirNome(string $nome): void
    {
        if (preg_match('/^[a-z_][a-z0-9_]*$/', $nome) !== 1) {
            throw new \InvalidArgumentException("nome de tabela/coluna inválido: {$nome}");
        }
    }
}

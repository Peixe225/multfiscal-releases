<?php
declare(strict_types=1);

namespace OmniChannel\Atendimento;

use OmniChannel\Banco\Banco;
use PDO;
use PDOException;

/**
 * Gravação segura quando várias requisições mexem no mesmo cliente ao mesmo
 * tempo — o caso comum do WhatsApp: o cliente manda cinco mensagens em
 * rajada e a Meta entrega cinco webhooks simultâneos.
 *
 * No InnoDB (MySQL/MariaDB da hospedagem, REPEATABLE READ por padrão) uma
 * leitura comum dentro da transação vê a "foto" tirada na primeira leitura,
 * não o que outra requisição acabou de confirmar. Por isso:
 *
 *  - transacao() pede READ COMMITTED para a transação (cada leitura vê o que
 *    já foi confirmado, e buscas não travam intervalos do índice) e repete a
 *    transação inteira quando o banco escolhe ela como vítima de deadlock
 *    (40001/1213), de espera de trava (1205) ou, no SQLite, de banco ocupado;
 *  - travando() acrescenta FOR UPDATE nas releituras que PRECISAM do dado
 *    confirmado mais novo, mesmo que o isolamento não tenha mudado.
 *
 * O SQLite (desenvolvimento e testes) serializa as gravações sozinho: lá os
 * dois recursos viram nada, e só a repetição em "database is locked" age.
 */
final class Concorrencia
{
    public const TENTATIVAS = 4;

    /** @var \WeakMap<PDO, bool>|null conexão MySQL -> pode usar READ COMMITTED */
    private static ?\WeakMap $leituraConfirmada = null;

    /**
     * Banco::transacao com READ COMMITTED no MySQL e repetição em conflito.
     *
     * Só a transação de FORA repete: dentro de outra, um erro precisa subir
     * para quem abriu (o rollback é dela). Por isso $acao não pode ter efeito
     * fora do banco (rede, disco) — faça isso antes ou depois.
     *
     * @template T
     * @param callable(): T $acao
     * @return T
     */
    public static function transacao(callable $acao): mixed
    {
        $pdo = Banco::conexao();
        if ($pdo->inTransaction()) {
            return $acao();
        }
        for ($tentativa = 1; ; $tentativa++) {
            self::lerConfirmadoNaProxima($pdo);
            try {
                return Banco::transacao($acao);
            } catch (PDOException $erro) {
                if ($tentativa >= self::TENTATIVAS || !self::eConflito($erro)) {
                    throw $erro;
                }
                // espera curta e aleatória: as duas vítimas não voltam juntas
                usleep(random_int(5_000, 30_000) * $tentativa);
            }
        }
    }

    /** O banco desfez a transação por disputa de trava (vale repetir)? */
    public static function eConflito(PDOException $erro): bool
    {
        $info = $erro->errorInfo ?? [];
        $estado = (string) ($info[0] ?? '');
        $codigo = $info[1] ?? null;
        if ($estado === '40001' || in_array($codigo, [1213, 1205], true)) {
            return true;
        }
        $mensagem = $erro->getMessage();
        return str_contains($mensagem, 'database is locked') || str_contains($mensagem, 'database table is locked');
    }

    /** " FOR UPDATE" no MySQL (leitura travada vê o dado confirmado mais novo); nada no SQLite. */
    public static function travando(): string
    {
        return Banco::driver() === 'mysql' ? ' FOR UPDATE' : '';
    }

    /**
     * SET TRANSACTION vale só para a próxima transação da conexão. Com binlog
     * em formato STATEMENT o MySQL recusa gravar em READ COMMITTED; nesse caso
     * fica o isolamento padrão e valem o travando() e a repetição.
     */
    private static function lerConfirmadoNaProxima(PDO $pdo): void
    {
        if (Banco::driver() !== 'mysql') {
            return;
        }
        self::$leituraConfirmada ??= new \WeakMap();
        if (!isset(self::$leituraConfirmada[$pdo])) {
            try {
                $formato = strtoupper((string) $pdo->query('SELECT @@SESSION.binlog_format')->fetchColumn());
                self::$leituraConfirmada[$pdo] = $formato !== 'STATEMENT';
            } catch (PDOException) {
                self::$leituraConfirmada[$pdo] = false;
            }
        }
        if (self::$leituraConfirmada[$pdo]) {
            $pdo->exec('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
        }
    }
}

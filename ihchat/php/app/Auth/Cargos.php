<?php
declare(strict_types=1);

namespace IHchat\Auth;

use IHchat\Banco\Banco;
use IHchat\Nucleo\Json;
use PDO;

/**
 * Leitura dos cargos e o formato CargoSaida.
 *
 * A tabela é pequena e lida em quase toda requisição (as permissões de quem
 * pede, o cargo de cada atendente na saída): fica em memória durante a
 * requisição, presa à conexão (WeakMap), e é esquecida a cada gravação.
 *
 * CargoSaida {id, nome, nivel, permissoes, sistema, total_pessoas}
 */
final class Cargos
{
    public const ADMINISTRADOR = 'administrador';
    public const GERENTE = 'gerente';
    public const LIDER = 'lider';
    public const CONFERENTE = 'conferente';
    public const COLABORADOR = 'colaborador';

    public const MAX_NOME = 60;

    /** @var \WeakMap<PDO, array<int, array<string, mixed>>>|null */
    private static ?\WeakMap $cache = null;

    /** @return array<int, array<string, mixed>> id => cargo tipado, do nível mais alto ao mais baixo */
    public static function todos(): array
    {
        $pdo = Banco::conexao();
        self::$cache ??= new \WeakMap();
        if (!isset(self::$cache[$pdo])) {
            $cargos = [];
            foreach (Banco::todos('SELECT * FROM cargos ORDER BY nivel DESC, nome, id') as $linha) {
                $cargo = self::tipar($linha);
                $cargos[$cargo['id']] = $cargo;
            }
            self::$cache[$pdo] = $cargos;
        }
        return self::$cache[$pdo];
    }

    /** Depois de gravar em `cargos`: a próxima leitura vai ao banco. */
    public static function esquecer(): void
    {
        self::$cache = null;
    }

    /** @return array<string, mixed>|null */
    public static function porId(int $id): ?array
    {
        return self::todos()[$id] ?? null;
    }

    /** @return array<string, mixed>|null */
    public static function porChave(string $chave): ?array
    {
        foreach (self::todos() as $cargo) {
            if ($cargo['chave'] === $chave) {
                return $cargo;
            }
        }
        return null;
    }

    /** O cargo de fábrica pela chave (a migração garante que existe). @return array<string, mixed> */
    public static function deFabrica(string $chave): array
    {
        return self::porChave($chave) ?? throw new \RuntimeException("cargo de fábrica ausente: {$chave}");
    }

    /**
     * Cargo que não está no banco (base sem a migração aplicada): o
     * Administrador continua com tudo, qualquer outro fica sem nada.
     *
     * @return array<string, mixed>
     */
    public static function vazio(string $chave): array
    {
        $admin = $chave === self::ADMINISTRADOR;
        return [
            'id' => 0,
            'chave' => $chave,
            'nome' => $admin ? 'Administrador' : 'Colaborador',
            'nivel' => $admin ? Permissoes::NIVEL_ADMINISTRADOR : 0,
            'sistema' => true,
            'permissoes' => $admin ? Permissoes::todas() : [],
        ];
    }

    /**
     * @param array<string, mixed> $linha
     * @return array<string, mixed>
     */
    public static function tipar(array $linha): array
    {
        $chave = isset($linha['chave']) && $linha['chave'] !== '' ? (string) $linha['chave'] : null;
        $lista = Json::ler(isset($linha['permissoes']) ? (string) $linha['permissoes'] : null, []);
        return [
            'id' => (int) $linha['id'],
            'chave' => $chave,
            'nome' => (string) $linha['nome'],
            'nivel' => (int) $linha['nivel'],
            'sistema' => (bool) $linha['sistema'],
            // o Administrador tem todas, sempre: não depende do que está gravado
            'permissoes' => $chave === self::ADMINISTRADOR
                ? Permissoes::todas()
                : Permissoes::ordenar(is_array($lista) ? $lista : []),
        ];
    }

    /** @param array<string, mixed> $cargo */
    public static function eAdministrador(array $cargo): bool
    {
        return $cargo['chave'] === self::ADMINISTRADOR;
    }

    /**
     * {id, nome, nivel}: o que vai dentro do atendente.
     *
     * @param array<string, mixed> $cargo
     * @return array{id: int, nome: string, nivel: int}
     */
    public static function resumo(array $cargo): array
    {
        return ['id' => (int) $cargo['id'], 'nome' => (string) $cargo['nome'], 'nivel' => (int) $cargo['nivel']];
    }

    /** @return array<int, int> cargo_id => pessoas (ativas ou não) */
    public static function pessoasPorCargo(): array
    {
        $saida = [];
        foreach (Banco::todos('SELECT cargo_id, COUNT(id) AS n FROM atendentes WHERE cargo_id IS NOT NULL GROUP BY cargo_id') as $l) {
            $saida[(int) $l['cargo_id']] = (int) $l['n'];
        }
        return $saida;
    }

    /**
     * @param array<string, mixed> $cargo
     * @return array<string, mixed> CargoSaida
     */
    public static function saida(array $cargo, ?int $totalPessoas = null): array
    {
        return [
            'id' => (int) $cargo['id'],
            'nome' => (string) $cargo['nome'],
            'nivel' => (int) $cargo['nivel'],
            'permissoes' => $cargo['permissoes'],
            'sistema' => (bool) $cargo['sistema'],
            'total_pessoas' => $totalPessoas ?? (self::pessoasPorCargo()[(int) $cargo['id']] ?? 0),
        ];
    }
}

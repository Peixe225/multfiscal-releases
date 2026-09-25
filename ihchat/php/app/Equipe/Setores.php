<?php
declare(strict_types=1);

namespace IHchat\Equipe;

use IHchat\Banco\Banco;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\ErroHttp;

/**
 * Setores (departamentos) como cadastro.
 *
 * O nome é único sem diferença de maiúsculas e espaços repetidos ("  Suporte
 * técnico" e "suporte TÉCNICO" são o mesmo setor), a mesma regra que as salas
 * do chat usavam para o texto livre. A comparação é feita aqui, no PHP: o
 * LOWER do SQLite não baixa letra acentuada, e a coluna é binária no MySQL.
 *
 * O nome do setor também fica gravado em atendentes.setor (é o que vai na
 * assinatura das mensagens e no JSON antigo): renomear o setor atualiza as
 * pessoas dele.
 *
 * SetorSaida {id, nome, descricao, ativo, total_pessoas}
 */
final class Setores
{
    public const MAX_NOME = 60;
    public const MAX_DESCRICAO = 255;

    public static function normalizar(?string $nome): string
    {
        return mb_strtolower(self::espacos((string) $nome));
    }

    public static function espacos(string $texto): string
    {
        return trim((string) preg_replace('/\s+/u', ' ', $texto));
    }

    /**
     * @param array<string, mixed> $linha
     * @return array<string, mixed>
     */
    public static function tipar(array $linha): array
    {
        return [
            'id' => (int) $linha['id'],
            'nome' => (string) $linha['nome'],
            'descricao' => isset($linha['descricao']) && $linha['descricao'] !== '' ? (string) $linha['descricao'] : null,
            'ativo' => (bool) $linha['ativo'],
        ];
    }

    /** @return array<string, mixed>|null */
    public static function porId(int $id): ?array
    {
        $linha = Banco::um('SELECT * FROM setores WHERE id = ?', [$id]);
        return $linha === null ? null : self::tipar($linha);
    }

    /** @return list<array<string, mixed>> por nome */
    public static function todos(): array
    {
        $lista = array_map([self::class, 'tipar'], Banco::todos('SELECT * FROM setores ORDER BY nome, id'));
        usort($lista, static fn (array $a, array $b): int => [self::normalizar($a['nome']), $a['id']] <=> [self::normalizar($b['nome']), $b['id']]);
        return $lista;
    }

    /** O setor com esse nome (sem diferença de maiúsculas/espaços), ou null. @return array<string, mixed>|null */
    public static function porNome(string $nome, ?int $exceto = null): ?array
    {
        $alvo = self::normalizar($nome);
        if ($alvo === '') {
            return null;
        }
        foreach (Banco::todos('SELECT * FROM setores') as $linha) {
            if ((int) $linha['id'] !== $exceto && self::normalizar((string) $linha['nome']) === $alvo) {
                return self::tipar($linha);
            }
        }
        return null;
    }

    /** Cria o setor (409 se o nome já existe). @return array<string, mixed> */
    public static function criar(string $nome, ?string $descricao = null): array
    {
        $nome = self::espacos($nome);
        if (self::porNome($nome) !== null) {
            throw ErroHttp::conflito('ja existe um setor com esse nome');
        }
        try {
            $id = Banco::inserir('setores', [
                'nome' => $nome,
                'descricao' => $descricao === null || trim($descricao) === '' ? null : trim($descricao),
                'ativo' => true,
                'criado_em' => Datas::agoraBanco(),
            ]);
        } catch (\PDOException $erro) {
            if (Banco::eUnicidade($erro)) {
                throw ErroHttp::conflito('ja existe um setor com esse nome');
            }
            throw $erro;
        }
        return self::porId($id) ?? throw new \RuntimeException('setor sumiu');
    }

    /** @return array<int, int> setor_id => pessoas ATIVAS nele */
    public static function pessoasAtivasPorSetor(): array
    {
        $saida = [];
        foreach (Banco::todos('SELECT setor_id, COUNT(id) AS n FROM atendentes WHERE ativo = 1 AND setor_id IS NOT NULL GROUP BY setor_id') as $l) {
            $saida[(int) $l['setor_id']] = (int) $l['n'];
        }
        return $saida;
    }

    /**
     * @param array<string, mixed> $setor
     * @return array<string, mixed> SetorSaida
     */
    public static function saida(array $setor, ?int $totalPessoas = null): array
    {
        return [
            'id' => (int) $setor['id'],
            'nome' => (string) $setor['nome'],
            'descricao' => $setor['descricao'],
            'ativo' => (bool) $setor['ativo'],
            'total_pessoas' => $totalPessoas ?? (self::pessoasAtivasPorSetor()[(int) $setor['id']] ?? 0),
        ];
    }
}

<?php
declare(strict_types=1);

namespace IHchat\Atendimento;

use IHchat\Auth\Permissoes;
use IHchat\Banco\Banco;
use IHchat\Nucleo\ErroHttp;

/**
 * Quem vê qual conversa (a mesma regra de app/servicos/visibilidade.py).
 *
 *  - conversas.ver_todas: todas;
 *  - todo mundo: as atribuídas a si e as da fila (sem atendente) do próprio
 *    setor ou da fila geral (conversa sem setor);
 *  - conversas.ver_setor: também as do próprio setor, que são as que estão
 *    na fila do setor (conversas.setor_id) ou com alguém do setor.
 *
 * Quem não vê a conversa recebe 404 nela (lista, detalhe, ações, anexos) e
 * não recebe os eventos dela: para essa pessoa a conversa não existe.
 */
final class Visibilidade
{
    /**
     * Condição SQL (com os parâmetros) das conversas que $eu vê, sobre o
     * alias $c da tabela conversas. null = vê todas.
     *
     * $comoSetor: o recorte "do setor" mesmo sem conversas.ver_setor (as
     * métricas do setor usam).
     *
     * @param array<string, mixed> $eu
     * @return array{0: string, 1: list<mixed>}|null
     */
    public static function condicao(array $eu, string $c = 'c', bool $comoSetor = false): ?array
    {
        if (!$comoSetor && Permissoes::tem($eu, 'conversas.ver_todas')) {
            return null;
        }
        $setor = isset($eu['setor_id']) && $eu['setor_id'] !== null ? (int) $eu['setor_id'] : null;
        $partes = ["{$c}.atendente_id = ?"];
        $parametros = [(int) $eu['id']];
        if ($setor === null) {
            $partes[] = "({$c}.atendente_id IS NULL AND {$c}.setor_id IS NULL)";
        } else {
            $partes[] = "({$c}.atendente_id IS NULL AND ({$c}.setor_id IS NULL OR {$c}.setor_id = ?))";
            $parametros[] = $setor;
            if ($comoSetor || Permissoes::tem($eu, 'conversas.ver_setor')) {
                $partes[] = "{$c}.setor_id = ?";
                $partes[] = "{$c}.atendente_id IN (SELECT va.id FROM atendentes va WHERE va.setor_id = ?)";
                array_push($parametros, $setor, $setor);
            }
        }
        return ['(' . implode(' OR ', $partes) . ')', $parametros];
    }

    /** @param array<string, mixed> $eu */
    public static function podeVerId(array $eu, int $conversaId): bool
    {
        $condicao = self::condicao($eu);
        if ($condicao === null) {
            return Banco::valor('SELECT id FROM conversas WHERE id = ?', [$conversaId]) !== null;
        }
        [$onde, $parametros] = $condicao;
        return Banco::valor("SELECT c.id FROM conversas c WHERE c.id = ? AND {$onde}", [$conversaId, ...$parametros]) !== null;
    }

    /**
     * A conversa, ou 404 "conversa nao encontrada" também para quem não a vê
     * (não revela que o id existe).
     *
     * @param array<string, mixed> $eu
     * @return array<string, mixed>
     */
    public static function exigir(array $eu, int $conversaId): array
    {
        $conversa = Conversas::porId($conversaId);
        if ($conversa === null || !self::podeVerId($eu, $conversaId)) {
            throw ErroHttp::naoEncontrado('conversa nao encontrada');
        }
        return $conversa;
    }

    /**
     * Filtro dos eventos de conversa para o painel de $eu: memoriza a resposta
     * por conversa durante UMA consulta (o estado de agora vale para o lote).
     *
     * @param array<string, mixed> $eu
     * @return callable(int): bool
     */
    public static function filtro(array $eu): callable
    {
        if (Permissoes::tem($eu, 'conversas.ver_todas')) {
            return static fn (int $id): bool => true;
        }
        $vistas = [];
        return static function (int $id) use ($eu, &$vistas): bool {
            return $vistas[$id] ??= self::podeVerId($eu, $id);
        };
    }
}

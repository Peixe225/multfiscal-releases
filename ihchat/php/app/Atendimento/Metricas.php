<?php
declare(strict_types=1);

namespace IHchat\Atendimento;

use IHchat\Banco\Banco;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\Json;

/** Números do atendimento para o topo do painel (app/api/metricas.py). */
final class Metricas
{
    /**
     * MetricasSaida: {abertas, pendentes, resolvidas_hoje, sem_atendente,
     * mensagens_hoje, por_canal: {nome: total}, tempo_medio_primeira_resposta_seg}
     *
     * "Hoje" é o dia UTC, como no Python.
     *
     * $recorte: condição SQL sobre o alias "c" de conversas (com parâmetros)
     * que limita os números às conversas de um setor (Visibilidade); null =
     * o atendimento inteiro.
     *
     * @param array{0: string, 1: list<mixed>}|null $recorte
     * @return array<string, mixed>
     */
    public static function resumo(?array $recorte = null): array
    {
        $inicio = Datas::paraBanco(Datas::agora()->setTime(0, 0));
        [$dentro, $pr] = $recorte ?? ['1 = 1', []];
        $contar = static fn (string $onde, array $p = []): int
            => (int) Banco::valor("SELECT COUNT(c.id) FROM conversas c WHERE {$onde} AND {$dentro}", [...$p, ...$pr]);

        $porCanal = [];
        foreach (Banco::todos(
            "SELECT ca.nome, COUNT(c.id) AS total FROM canais ca JOIN conversas c ON c.canal_id = ca.id
             WHERE c.status <> 'resolvida' AND {$dentro} GROUP BY ca.nome ORDER BY ca.nome",
            $pr
        ) as $linha) {
            $porCanal[(string) $linha['nome']] = (int) $linha['total'];
        }

        // tempo até a primeira resposta, só das conversas já respondidas
        $soma = 0.0;
        $quantas = 0;
        foreach (Banco::todos(
            "SELECT c.criada_em, c.primeira_resposta_em FROM conversas c WHERE c.primeira_resposta_em IS NOT NULL AND {$dentro}",
            $pr
        ) as $linha) {
            $criada = Datas::doBanco((string) $linha['criada_em']);
            $resposta = Datas::doBanco((string) $linha['primeira_resposta_em']);
            if ($criada === null || $resposta === null) {
                continue;
            }
            $soma += ((float) $resposta->format('U.u')) - ((float) $criada->format('U.u'));
            $quantas++;
        }

        return [
            'abertas' => $contar("c.status = 'aberta'"),
            'pendentes' => $contar("c.status = 'pendente'"),
            'resolvidas_hoje' => $contar("c.status = 'resolvida' AND c.resolvida_em >= ?", [$inicio]),
            'sem_atendente' => $contar("c.atendente_id IS NULL AND c.status <> 'resolvida'"),
            'mensagens_hoje' => $recorte === null
                ? (int) Banco::valor('SELECT COUNT(id) FROM mensagens WHERE criada_em >= ?', [$inicio])
                : (int) Banco::valor(
                    "SELECT COUNT(m.id) FROM mensagens m JOIN conversas c ON c.id = m.conversa_id WHERE m.criada_em >= ? AND {$dentro}",
                    [$inicio, ...$pr]
                ),
            'por_canal' => Json::objeto($porCanal),
            'tempo_medio_primeira_resposta_seg' => $quantas === 0 ? null : round($soma / $quantas, 1),
        ];
    }
}

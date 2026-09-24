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
     * @return array<string, mixed>
     */
    public static function resumo(): array
    {
        $inicio = Datas::paraBanco(Datas::agora()->setTime(0, 0));
        $contar = static fn (string $onde, array $p = []): int => (int) Banco::valor("SELECT COUNT(id) FROM conversas WHERE {$onde}", $p);

        $porCanal = [];
        foreach (Banco::todos(
            "SELECT ca.nome, COUNT(c.id) AS total FROM canais ca JOIN conversas c ON c.canal_id = ca.id
             WHERE c.status <> 'resolvida' GROUP BY ca.nome ORDER BY ca.nome"
        ) as $linha) {
            $porCanal[(string) $linha['nome']] = (int) $linha['total'];
        }

        // tempo até a primeira resposta, só das conversas já respondidas
        $soma = 0.0;
        $quantas = 0;
        foreach (Banco::todos('SELECT criada_em, primeira_resposta_em FROM conversas WHERE primeira_resposta_em IS NOT NULL') as $linha) {
            $criada = Datas::doBanco((string) $linha['criada_em']);
            $resposta = Datas::doBanco((string) $linha['primeira_resposta_em']);
            if ($criada === null || $resposta === null) {
                continue;
            }
            $soma += ((float) $resposta->format('U.u')) - ((float) $criada->format('U.u'));
            $quantas++;
        }

        return [
            'abertas' => $contar("status = 'aberta'"),
            'pendentes' => $contar("status = 'pendente'"),
            'resolvidas_hoje' => $contar("status = 'resolvida' AND resolvida_em >= ?", [$inicio]),
            'sem_atendente' => $contar("atendente_id IS NULL AND status <> 'resolvida'"),
            'mensagens_hoje' => (int) Banco::valor('SELECT COUNT(id) FROM mensagens WHERE criada_em >= ?', [$inicio]),
            'por_canal' => Json::objeto($porCanal),
            'tempo_medio_primeira_resposta_seg' => $quantas === 0 ? null : round($soma / $quantas, 1),
        ];
    }
}

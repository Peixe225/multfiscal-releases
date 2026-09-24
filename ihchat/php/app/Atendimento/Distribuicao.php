<?php
declare(strict_types=1);

namespace IHchat\Atendimento;

use IHchat\Auth\Atendentes;
use IHchat\Banco\Banco;

/** Distribuição de conversas entre os atendentes (app/servicos/distribuicao.py). */
final class Distribuicao
{
    /**
     * Menor fila primeiro: entrega a quem tem menos conversas em andamento.
     * Empate desfeito pelo id, o que faz a distribuição circular entre
     * atendentes com a mesma carga.
     *
     * @return array<string, mixed>|null o atendente (tipado) ou null se ninguém está disponível
     */
    public static function proximoAtendente(): ?array
    {
        $linha = Banco::um(
            "SELECT a.* FROM atendentes a
             LEFT JOIN (SELECT atendente_id, COUNT(id) AS total FROM conversas
                        WHERE status <> 'resolvida' AND atendente_id IS NOT NULL
                        GROUP BY atendente_id) carga ON carga.atendente_id = a.id
             WHERE a.ativo = 1 AND a.disponivel = 1
             ORDER BY COALESCE(carga.total, 0) ASC, a.id ASC
             LIMIT 1"
        );
        return $linha === null ? null : Atendentes::tipar($linha);
    }
}

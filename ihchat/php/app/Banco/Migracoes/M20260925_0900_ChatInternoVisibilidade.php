<?php
declare(strict_types=1);

namespace IHchat\Banco\Migracoes;

use IHchat\Banco\Esquema;
use IHchat\Banco\Migracao;

/**
 * Chat interno: interno_membros.visivel_desde (a mesma coluna de
 * app/models.py MembroSala, acrescentada no Python por app/db.py).
 *
 * O membro só vê mensagens com id maior que este número. Na sala de setor é
 * a última mensagem de quando a pessoa entrou: o setor é editável no próprio
 * perfil, e trocá-lo não pode abrir o histórico (nem os eventos guardados)
 * da sala de outro setor. 0 = vê tudo, que é o que as linhas antigas ganham:
 * quem já era membro continua vendo o que via.
 */
final class M20260925_0900_ChatInternoVisibilidade implements Migracao
{
    public function descricao(): string
    {
        return 'chat interno: histórico visível a partir da entrada na sala (visivel_desde)';
    }

    public function aplicar(Esquema $e): void
    {
        $e->adicionarColuna('interno_membros', 'visivel_desde', 'INT NOT NULL DEFAULT 0');
    }
}

<?php
declare(strict_types=1);

namespace IHchat\Banco\Migracoes;

use IHchat\Banco\Esquema;
use IHchat\Banco\Migracao;

/**
 * Chat interno da equipe: salas, membros (com o cursor de leitura de cada
 * um) e mensagens. As mesmas tabelas, colunas e nomes de índice de
 * app/models.py (SalaInterna, MembroSala, MensagemInterna): uma base criada
 * aqui abre no Python e vice-versa.
 *
 *  - interno_salas.chave: única; "geral", "setor:<hash>" e "direta:<a>:<b>"
 *    (uma direta por par). Grupo fica com NULL, que pode repetir. Binária no
 *    MySQL: a colação *_ci trataria chaves diferentes como iguais.
 *  - interno_membros.lida_ate: id da última mensagem lida (não lidas = de
 *    outras pessoas com id maior).
 *  - interno_mensagens.mencoes: lista JSON de ids; conversa_id aponta a
 *    conversa de cliente compartilhada (SET NULL se ela for apagada).
 */
final class M20260924_1200_ChatInterno implements Migracao
{
    public function descricao(): string
    {
        return 'chat interno da equipe (salas, membros e mensagens)';
    }

    public function aplicar(Esquema $e): void
    {
        $e->criarTabela('interno_salas', <<<'SQL'
            id {ID},
            tipo VARCHAR(10) NOT NULL,
            nome VARCHAR(120) NULL,
            setor VARCHAR(80) NULL,
            chave VARCHAR(120){BIN} NULL,
            criada_por INT NULL,
            criada_em {DATA} NOT NULL,
            atualizada_em {DATA} NOT NULL,
            FOREIGN KEY (criada_por) REFERENCES atendentes (id) ON DELETE SET NULL
            SQL);
        $e->criarIndice('interno_salas', 'uq_interno_salas_chave', ['chave'], unico: true);
        $e->criarIndice('interno_salas', 'ix_interno_salas_tipo', ['tipo']);

        $e->criarTabela('interno_membros', <<<'SQL'
            sala_id INT NOT NULL,
            atendente_id INT NOT NULL,
            lida_ate INT NOT NULL DEFAULT 0,
            silenciada {BOOL} NOT NULL DEFAULT 0,
            entrou_em {DATA} NOT NULL,
            PRIMARY KEY (sala_id, atendente_id),
            FOREIGN KEY (sala_id) REFERENCES interno_salas (id) ON DELETE CASCADE,
            FOREIGN KEY (atendente_id) REFERENCES atendentes (id) ON DELETE CASCADE
            SQL);
        $e->criarIndice('interno_membros', 'ix_interno_membros_atendente', ['atendente_id']);

        $e->criarTabela('interno_mensagens', <<<'SQL'
            id {ID},
            sala_id INT NOT NULL,
            autor_id INT NULL,
            conteudo {TEXTO} NOT NULL,
            mencoes {JSON} NOT NULL,
            conversa_id INT NULL,
            criada_em {DATA} NOT NULL,
            editada_em {DATA} NULL,
            apagada {BOOL} NOT NULL DEFAULT 0,
            FOREIGN KEY (sala_id) REFERENCES interno_salas (id) ON DELETE CASCADE,
            FOREIGN KEY (autor_id) REFERENCES atendentes (id) ON DELETE SET NULL,
            FOREIGN KEY (conversa_id) REFERENCES conversas (id) ON DELETE SET NULL
            SQL);
        $e->criarIndice('interno_mensagens', 'ix_interno_mensagens_sala', ['sala_id', 'id']);
    }
}

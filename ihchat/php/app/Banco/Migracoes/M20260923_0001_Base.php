<?php
declare(strict_types=1);

namespace IHchat\Banco\Migracoes;

use IHchat\Banco\Esquema;
use IHchat\Banco\Migracao;

/**
 * Esquema inicial: as mesmas tabelas, colunas, índices e unicidades de
 * app/models.py (SQLAlchemy), mais:
 *
 *  - atendentes.setor: o setor mostrado ao cliente junto com o nome de quem
 *    atende ("Ana — Suporte técnico");
 *  - mensagens.assinatura: JSON {"nome": ..., "setor": ...} gravado NO ENVIO.
 *    Se o atendente mudar de setor ou de nome, o histórico continua dizendo
 *    quem respondeu e de onde, como o cliente viu na hora;
 *  - fila_eventos: o "tempo real por consulta" da hospedagem compartilhada
 *    (a tabela `eventos` já existe no Python e é a trilha de auditoria).
 *
 * Nomes iguais aos do Python de propósito: um SQLite criado aqui abre no app
 * Python e vice-versa (datas no mesmo formato texto, JSON como texto).
 */
final class M20260923_0001_Base implements Migracao
{
    public function descricao(): string
    {
        return 'esquema inicial (tabelas do app Python + setor, assinatura e fila de eventos)';
    }

    public function aplicar(Esquema $e): void
    {
        $e->criarTabela('atendentes', <<<'SQL'
            id {ID},
            nome VARCHAR(120) NOT NULL,
            email VARCHAR(160) NOT NULL,
            senha_hash VARCHAR(255) NOT NULL,
            papel VARCHAR(20) NOT NULL DEFAULT 'atendente',
            ativo {BOOL} NOT NULL DEFAULT 1,
            disponivel {BOOL} NOT NULL DEFAULT 1,
            setor VARCHAR(80) NULL,
            criado_em {DATA} NOT NULL
            SQL);
        $e->criarIndice('atendentes', 'ix_atendentes_email', ['email'], unico: true);

        $e->criarTabela('canais', <<<'SQL'
            id {ID},
            nome VARCHAR(120) NOT NULL,
            tipo VARCHAR(20) NOT NULL,
            ativo {BOOL} NOT NULL DEFAULT 1,
            credenciais {JSON} NOT NULL,
            chave_publica VARCHAR(64){BIN} NULL,
            segredo_webhook VARCHAR(120) NULL,
            criado_em {DATA} NOT NULL
            SQL);
        $e->criarIndice('canais', 'ix_canais_tipo', ['tipo']);
        $e->criarIndice('canais', 'uq_canais_chave_publica', ['chave_publica'], unico: true);

        $e->criarTabela('contatos', <<<'SQL'
            id {ID},
            nome VARCHAR(160) NOT NULL,
            empresa VARCHAR(160) NULL,
            documento VARCHAR(32) NULL,
            email VARCHAR(160) NULL,
            telefone VARCHAR(32) NULL,
            observacoes {TEXTO} NULL,
            criado_em {DATA} NOT NULL,
            atualizado_em {DATA} NOT NULL
            SQL);
        $e->criarIndice('contatos', 'ix_contatos_email', ['email']);
        $e->criarIndice('contatos', 'ix_contatos_telefone', ['telefone']);

        $e->criarTabela('contato_identidades', <<<'SQL'
            id {ID},
            contato_id INT NOT NULL,
            canal_tipo VARCHAR(20) NOT NULL,
            identificador VARCHAR(200){BIN} NOT NULL,
            nome_exibicao VARCHAR(160) NULL,
            criado_em {DATA} NOT NULL,
            FOREIGN KEY (contato_id) REFERENCES contatos (id) ON DELETE CASCADE
            SQL);
        $e->criarIndice('contato_identidades', 'uq_identidade_canal', ['canal_tipo', 'identificador'], unico: true);
        $e->criarIndice('contato_identidades', 'ix_contato_identidades_contato_id', ['contato_id']);

        $e->criarTabela('etiquetas', <<<'SQL'
            id {ID},
            nome VARCHAR(60) NOT NULL,
            cor VARCHAR(9) NOT NULL DEFAULT '#6b7cff'
            SQL);
        $e->criarIndice('etiquetas', 'uq_etiquetas_nome', ['nome'], unico: true);

        $e->criarTabela('conversas', <<<'SQL'
            id {ID},
            contato_id INT NOT NULL,
            canal_id INT NOT NULL,
            atendente_id INT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'aberta',
            prioridade VARCHAR(10) NOT NULL DEFAULT 'normal',
            assunto VARCHAR(200) NULL,
            previa VARCHAR(200) NULL,
            nao_lidas INT NOT NULL DEFAULT 0,
            criada_em {DATA} NOT NULL,
            atualizada_em {DATA} NOT NULL,
            ultima_mensagem_em {DATA} NOT NULL,
            primeira_resposta_em {DATA} NULL,
            resolvida_em {DATA} NULL,
            FOREIGN KEY (contato_id) REFERENCES contatos (id) ON DELETE CASCADE,
            FOREIGN KEY (canal_id) REFERENCES canais (id) ON DELETE CASCADE,
            FOREIGN KEY (atendente_id) REFERENCES atendentes (id) ON DELETE SET NULL
            SQL);
        $e->criarIndice('conversas', 'ix_conversas_contato_id', ['contato_id']);
        $e->criarIndice('conversas', 'ix_conversas_canal_id', ['canal_id']);
        $e->criarIndice('conversas', 'ix_conversas_atendente_id', ['atendente_id']);
        $e->criarIndice('conversas', 'ix_conversas_status', ['status']);
        $e->criarIndice('conversas', 'ix_conversas_ultima_mensagem_em', ['ultima_mensagem_em']);

        $e->criarTabela('conversa_etiqueta', <<<'SQL'
            conversa_id INT NOT NULL,
            etiqueta_id INT NOT NULL,
            PRIMARY KEY (conversa_id, etiqueta_id),
            FOREIGN KEY (conversa_id) REFERENCES conversas (id) ON DELETE CASCADE,
            FOREIGN KEY (etiqueta_id) REFERENCES etiquetas (id) ON DELETE CASCADE
            SQL);

        $e->criarTabela('mensagens', <<<'SQL'
            id {ID},
            conversa_id INT NOT NULL,
            direcao VARCHAR(10) NOT NULL,
            tipo VARCHAR(20) NOT NULL DEFAULT 'texto',
            conteudo {TEXTO} NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'recebida',
            atendente_id INT NULL,
            externo_id VARCHAR(200){BIN} NULL,
            erro {TEXTO} NULL,
            metadados {JSON} NOT NULL,
            assinatura VARCHAR(255) NULL,
            criada_em {DATA} NOT NULL,
            FOREIGN KEY (conversa_id) REFERENCES conversas (id) ON DELETE CASCADE,
            FOREIGN KEY (atendente_id) REFERENCES atendentes (id) ON DELETE SET NULL
            SQL);
        // o id externo chega prefixado pelo canal ("whatsapp:wamid.XX"): é o
        // que torna idempotente a reentrega de webhook
        $e->criarIndice('mensagens', 'uq_mensagem_externo', ['externo_id'], unico: true);
        $e->criarIndice('mensagens', 'ix_mensagens_conversa_id', ['conversa_id']);
        $e->criarIndice('mensagens', 'ix_mensagens_criada_em', ['criada_em']);

        $e->criarTabela('anexos', <<<'SQL'
            id {ID},
            mensagem_id INT NOT NULL,
            nome VARCHAR(160) NOT NULL,
            tipo_conteudo VARCHAR(120) NOT NULL DEFAULT 'application/octet-stream',
            tamanho INT NOT NULL DEFAULT 0,
            chave VARCHAR(200) NULL,
            externo_id VARCHAR(200) NULL,
            erro {TEXTO} NULL,
            criado_em {DATA} NOT NULL,
            FOREIGN KEY (mensagem_id) REFERENCES mensagens (id) ON DELETE CASCADE
            SQL);
        $e->criarIndice('anexos', 'ix_anexos_mensagem_id', ['mensagem_id']);

        $e->criarTabela('respostas_rapidas', <<<'SQL'
            id {ID},
            atalho VARCHAR(40) NOT NULL,
            titulo VARCHAR(120) NOT NULL,
            conteudo {TEXTO} NOT NULL,
            criada_em {DATA} NOT NULL
            SQL);
        $e->criarIndice('respostas_rapidas', 'uq_respostas_rapidas_atalho', ['atalho'], unico: true);

        // trilha de auditoria (quem atribuiu, resolveu, reabriu...)
        $e->criarTabela('eventos', <<<'SQL'
            id {ID},
            conversa_id INT NULL,
            atendente_id INT NULL,
            tipo VARCHAR(40) NOT NULL,
            descricao VARCHAR(300) NOT NULL,
            criado_em {DATA} NOT NULL,
            FOREIGN KEY (conversa_id) REFERENCES conversas (id) ON DELETE CASCADE,
            FOREIGN KEY (atendente_id) REFERENCES atendentes (id) ON DELETE SET NULL
            SQL);
        $e->criarIndice('eventos', 'ix_eventos_conversa_id', ['conversa_id']);

        $e->criarTabela('sessoes_widget', <<<'SQL'
            token VARCHAR(64){BIN} NOT NULL PRIMARY KEY,
            canal_id INT NOT NULL,
            contato_id INT NOT NULL,
            criada_em {DATA} NOT NULL,
            FOREIGN KEY (canal_id) REFERENCES canais (id) ON DELETE CASCADE,
            FOREIGN KEY (contato_id) REFERENCES contatos (id) ON DELETE CASCADE
            SQL);

        // tempo real por consulta: o painel e o widget pedem "o que há depois
        // do id N". AUTOINCREMENT no SQLite garante id nunca reaproveitado,
        // senão um cursor antigo pularia eventos novos
        $e->criarTabela('fila_eventos', <<<'SQL'
            id {ID64},
            tipo VARCHAR(60) NOT NULL,
            dados {JSON} NOT NULL,
            contato_id INT NULL,
            criado_em {DATA} NOT NULL
            SQL);
        $e->criarIndice('fila_eventos', 'ix_fila_eventos_contato', ['contato_id', 'id']);
        $e->criarIndice('fila_eventos', 'ix_fila_eventos_criado_em', ['criado_em']);
    }
}

<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Migrações da loja, na faixa 100–199 do registro de banco.php: as tabelas (100) e a semente nos bancos que já
// estavam instalados antes da loja ir pro servidor (101). Banco novo é semeado na instalação do painel.
// Dinheiro em centavos; listas e objetos pequenos (combos, cidades, horário…) em JSON; hora em unix UTC.

/** @return array<int, string|callable(PDO): void> */
function gc_migracoes_loja(): array
{
    return [
        100 => <<<'SQL'
        CREATE TABLE loja_categorias (
          id TEXT PRIMARY KEY,
          nome TEXT NOT NULL,
          curto TEXT NOT NULL,
          icone TEXT NOT NULL,
          bebida INTEGER NOT NULL DEFAULT 1,
          ordem INTEGER NOT NULL DEFAULT 0,
          criado_em INTEGER NOT NULL,
          atualizado_em INTEGER NOT NULL
        );
        CREATE TABLE loja_produtos (
          id TEXT PRIMARY KEY,
          nome TEXT NOT NULL,
          tamanho TEXT NOT NULL DEFAULT '',
          detalhe TEXT NOT NULL DEFAULT '',
          descricao TEXT NOT NULL DEFAULT '',
          categoria_id TEXT NOT NULL REFERENCES loja_categorias(id),
          preco INTEGER CHECK (preco IS NULL OR preco >= 0),
          combos TEXT NOT NULL DEFAULT '[]',
          variacoes TEXT NOT NULL DEFAULT '[]',
          combina_com TEXT NOT NULL DEFAULT '[]',
          foto TEXT,
          cor TEXT NOT NULL DEFAULT '#a8a8a8',
          arte TEXT NOT NULL DEFAULT '{}',
          obs TEXT NOT NULL DEFAULT '',
          ativo INTEGER NOT NULL DEFAULT 1,
          demo INTEGER NOT NULL DEFAULT 0,
          ordem INTEGER NOT NULL DEFAULT 0,
          criado_em INTEGER NOT NULL,
          atualizado_em INTEGER NOT NULL
        );
        CREATE INDEX loja_produtos_categoria ON loja_produtos(categoria_id);
        CREATE TABLE loja_produto_estados (
          produto_id TEXT NOT NULL REFERENCES loja_produtos(id) ON DELETE CASCADE,
          uf TEXT NOT NULL,
          disponivel INTEGER NOT NULL DEFAULT 0,
          estoque INTEGER CHECK (estoque IS NULL OR estoque >= 0),
          atualizado_em INTEGER NOT NULL,
          PRIMARY KEY (produto_id, uf)
        );
        CREATE TABLE loja_estados (
          uf TEXT PRIMARY KEY,
          ativo INTEGER NOT NULL DEFAULT 1,
          destaque TEXT NOT NULL,
          nome_perfil TEXT,
          instagram TEXT NOT NULL,
          whatsapp TEXT,
          cidades TEXT NOT NULL DEFAULT '[]',
          horario TEXT NOT NULL,
          horario_demo INTEGER NOT NULL DEFAULT 0,
          taxa INTEGER CHECK (taxa IS NULL OR taxa >= 0),
          taxa_demo INTEGER NOT NULL DEFAULT 0,
          entrega_gratis TEXT,
          entrega_gratis_demo INTEGER NOT NULL DEFAULT 0,
          pagamentos TEXT NOT NULL,
          pagamentos_demo INTEGER NOT NULL DEFAULT 0,
          emblema TEXT NOT NULL DEFAULT 'generico',
          ordem INTEGER NOT NULL DEFAULT 0,
          criado_em INTEGER NOT NULL,
          atualizado_em INTEGER NOT NULL
        );
        CREATE TABLE loja_stories (
          uf TEXT NOT NULL,
          produto_id TEXT NOT NULL REFERENCES loja_produtos(id) ON DELETE CASCADE,
          posicao INTEGER NOT NULL,
          PRIMARY KEY (uf, produto_id)
        );
        CREATE TABLE loja_premios (
          id TEXT PRIMARY KEY,
          tipo TEXT NOT NULL CHECK (tipo IN ('desconto-percentual','leve-x-pague-y','brinde')),
          valor TEXT NOT NULL,
          titulo TEXT NOT NULL,
          descricao TEXT NOT NULL,
          regra TEXT NOT NULL,
          aplica_a TEXT NOT NULL,
          como_usar TEXT NOT NULL DEFAULT '',
          peso INTEGER NOT NULL CHECK (peso > 0),
          validade_dias INTEGER NOT NULL CHECK (validade_dias BETWEEN 1 AND 30),
          ativo INTEGER NOT NULL DEFAULT 1,
          demo INTEGER NOT NULL DEFAULT 0,
          ordem INTEGER NOT NULL DEFAULT 0,
          criado_em INTEGER NOT NULL,
          atualizado_em INTEGER NOT NULL
        );
        SQL,
        // painel instalado antes da loja ir pro servidor: a loja nasce da semente (a mesma do site de agora)
        101 => static function (PDO $db): void {
            if ($db->query('SELECT 1 FROM usuarios LIMIT 1')->fetchColumn() !== false) {
                gc_loja_semear($db, gc_loja_semente());
            }
        },
    ];
}

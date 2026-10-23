<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Migrações dos pedidos, dos avisos no WhatsApp e das falas do pedido guiado (faixa 200–299; o registro e as regras
// ficam em banco.php). Nunca edite uma que já foi pro ar: acrescente outra com o próximo número livre da faixa.
// Hora em unix UTC; dinheiro em centavos.

/** @return array<int, string> */
function gc_migracoes_pedidos(): array
{
    return [
        // 200: o pedido do site como a pessoa viu (itens em JSON, dinheiro em centavos) e a mensagem exata do WhatsApp.
        // O código (GC-XXXXX) nasce no aparelho junto com um token; a chave é o token (o código pode repetir entre
        // aparelhos, o token não). substitui_id/substituido_por_id: o pedido que o mesmo aparelho mandou de novo, mudado.
        200 => <<<'SQL'
        CREATE TABLE pedidos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          codigo TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          tipo TEXT NOT NULL CHECK (tipo IN ('pedido','encomenda')),
          status TEXT NOT NULL CHECK (status IN ('novo','confirmado','saiu','entregue','cancelado')),
          uf TEXT NOT NULL,
          cidade TEXT NOT NULL DEFAULT '',
          nome TEXT NOT NULL,
          whatsapp TEXT NOT NULL DEFAULT '',
          itens TEXT NOT NULL DEFAULT '[]',
          subtotal INTEGER,
          subtotal_texto TEXT NOT NULL DEFAULT '',
          cupom TEXT,
          endereco TEXT NOT NULL DEFAULT '',
          rua TEXT NOT NULL DEFAULT '',
          numero TEXT NOT NULL DEFAULT '',
          bairro TEXT NOT NULL DEFAULT '',
          cep TEXT NOT NULL DEFAULT '',
          cidade_entrega TEXT NOT NULL DEFAULT '',
          uf_entrega TEXT NOT NULL DEFAULT '',
          pagamento TEXT,
          troco INTEGER,
          observacao TEXT NOT NULL DEFAULT '',
          encomenda TEXT,
          mensagem TEXT NOT NULL,
          substitui_id INTEGER REFERENCES pedidos(id) ON DELETE SET NULL,
          substituido_por_id INTEGER REFERENCES pedidos(id) ON DELETE SET NULL,
          nota TEXT NOT NULL DEFAULT '',
          criado_em INTEGER NOT NULL,
          atualizado_em INTEGER NOT NULL,
          confirmado_em INTEGER,
          saiu_em INTEGER,
          entregue_em INTEGER,
          cancelado_em INTEGER,
          status_por TEXT,
          dados_apagados_em INTEGER,
          busca TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX pedidos_codigo ON pedidos(codigo);
        CREATE INDEX pedidos_lista ON pedidos(status, id);
        CREATE INDEX pedidos_uf ON pedidos(uf, id);
        SQL,
        // 201: avisos no WhatsApp: cada mensagem e cada tentativa de envio. para = '' (o destino do painel, o grupo da
        // loja), 'numero:5533…' ou 'grupo:<id>'. reenvia = 0 quando o texto guardado não é a mensagem que saiu (ex.: o
        // código de login das contas, que nunca fica guardado): o painel não manda de novo.
        201 => <<<'SQL'
        CREATE TABLE avisos_envios (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tipo TEXT NOT NULL,
          alvo TEXT NOT NULL DEFAULT '',
          para TEXT NOT NULL DEFAULT '',
          texto TEXT NOT NULL,
          dados TEXT NOT NULL DEFAULT '{}',
          reenvia INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL CHECK (status IN ('pendente','enviando','enviado','falhou')),
          motor TEXT NOT NULL DEFAULT '',
          tentativas INTEGER NOT NULL DEFAULT 0,
          erro TEXT NOT NULL DEFAULT '',
          criado_em INTEGER NOT NULL,
          atualizado_em INTEGER NOT NULL,
          tentar_em INTEGER,
          enviado_em INTEGER
        );
        CREATE INDEX avisos_envios_fila ON avisos_envios(status, tentar_em);
        CREATE INDEX avisos_envios_alvo ON avisos_envios(alvo);
        CREATE TABLE avisos_tentativas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          envio_id INTEGER NOT NULL REFERENCES avisos_envios(id) ON DELETE CASCADE,
          em INTEGER NOT NULL,
          motor TEXT NOT NULL,
          ok INTEGER NOT NULL,
          http INTEGER NOT NULL DEFAULT 0,
          ms INTEGER NOT NULL DEFAULT 0,
          erro TEXT NOT NULL DEFAULT '',
          por TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX avisos_tentativas_envio ON avisos_tentativas(envio_id);
        SQL,
        // 202: as falas do pedido guiado que o dono trocou (sem linha = o padrão do site).
        202 => <<<'SQL'
        CREATE TABLE textos_pedido (
          chave TEXT PRIMARY KEY,
          texto TEXT NOT NULL,
          atualizado_em INTEGER NOT NULL,
          por TEXT NOT NULL DEFAULT ''
        );
        SQL,
        // 208: o pedido mudado guarda qual ele substitui (o código e o hash do token do de antes) mesmo quando o de antes
        // ainda não chegou (o envio dele falhou): quando ele chegar depois, entra já trocado e ligado, sem aviso.
        208 => <<<'SQL'
        ALTER TABLE pedidos ADD COLUMN substitui_codigo TEXT NOT NULL DEFAULT '';
        ALTER TABLE pedidos ADD COLUMN substitui_token_hash TEXT NOT NULL DEFAULT '';
        CREATE INDEX pedidos_substitui_token ON pedidos(substitui_token_hash);
        SQL,
    ];
}

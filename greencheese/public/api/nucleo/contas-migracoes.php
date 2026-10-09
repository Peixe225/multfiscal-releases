<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Migrações das contas (equipe do painel e clientes do site), na faixa 200–299 da cadeia dos pedidos (o registro e as
// regras ficam em banco.php). Nunca edite uma que já foi pro ar: acrescente outra com o próximo número livre da faixa.
// Hora em unix UTC; WhatsApp como 55 + DDD + 9 dígitos.

/** @return array<int, string> */
function gc_migracoes_contas(): array
{
    return [
        // 203: equipe. papel 'dono' | 'gerente' | 'atendente'; ufs = estados de quem não é dono ('mg,rj'; '' = todos);
        // trocar_senha = senha provisória (o dono criou ou redefiniu): só entra no painel depois de trocar.
        203 => <<<'SQL'
        ALTER TABLE usuarios ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE usuarios ADD COLUMN ufs TEXT NOT NULL DEFAULT '';
        ALTER TABLE usuarios ADD COLUMN trocar_senha INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE usuarios ADD COLUMN criado_por TEXT NOT NULL DEFAULT '';
        ALTER TABLE usuarios ADD COLUMN desativado_em INTEGER;
        CREATE INDEX eventos_usuario ON eventos(usuario_id, id);
        SQL,
        // 204: clientes do site. Entram com o WhatsApp + um código de 6 dígitos que o WhatsApp da loja manda (só o
        // hash do código fica, com o sal do servidor); sessão própria (cookie gc_cliente, só o hash do token);
        // endereços usados nos pedidos.
        204 => <<<'SQL'
        CREATE TABLE clientes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          whatsapp TEXT NOT NULL UNIQUE,
          nome TEXT NOT NULL,
          aceita_promo INTEGER NOT NULL DEFAULT 0,
          aceita_promo_em INTEGER,
          confirmou18_em INTEGER NOT NULL,
          uf TEXT NOT NULL DEFAULT '',
          origem TEXT NOT NULL DEFAULT 'site',
          criado_em INTEGER NOT NULL,
          atualizado_em INTEGER NOT NULL,
          acesso_em INTEGER,
          busca TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX clientes_promo ON clientes(aceita_promo, id);
        CREATE TABLE clientes_codigos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          whatsapp TEXT NOT NULL,
          codigo_hash TEXT NOT NULL,
          motivo TEXT NOT NULL DEFAULT 'entrar',
          cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
          criado_em INTEGER NOT NULL,
          expira_em INTEGER NOT NULL,
          tentativas INTEGER NOT NULL DEFAULT 0,
          usado_em INTEGER
        );
        CREATE INDEX clientes_codigos_whatsapp ON clientes_codigos(whatsapp, id);
        CREATE TABLE clientes_sessoes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          criado_em INTEGER NOT NULL,
          visto_em INTEGER NOT NULL,
          expira_em INTEGER NOT NULL,
          agente TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX clientes_sessoes_cliente ON clientes_sessoes(cliente_id, visto_em);
        CREATE TABLE clientes_enderecos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
          apelido TEXT NOT NULL DEFAULT '',
          cep TEXT NOT NULL DEFAULT '',
          rua TEXT NOT NULL DEFAULT '',
          numero TEXT NOT NULL DEFAULT '',
          bairro TEXT NOT NULL DEFAULT '',
          cidade TEXT NOT NULL DEFAULT '',
          uf TEXT NOT NULL DEFAULT '',
          livre TEXT NOT NULL DEFAULT '',
          criado_em INTEGER NOT NULL,
          usado_em INTEGER NOT NULL
        );
        CREATE INDEX clientes_enderecos_cliente ON clientes_enderecos(cliente_id, usado_em);
        SQL,
        // 205: Teste minha sorte no servidor. cupons = o que a pessoa ganhou (o retrato do prêmio congelado no dia);
        // giros = cada giro (o limite conta por conta, por WhatsApp e por aparelho, sempre por hash com o sal); giro sem
        // conta deixa o prêmio reservado pro aparelho (reserva_expira) até a pessoa guardar.
        205 => <<<'SQL'
        CREATE TABLE cupons (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          codigo TEXT NOT NULL UNIQUE,
          cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
          interativo TEXT NOT NULL,
          premio_id TEXT NOT NULL,
          retrato TEXT NOT NULL,
          demo INTEGER NOT NULL DEFAULT 0,
          origem TEXT NOT NULL DEFAULT 'giro',
          ganho_em INTEGER NOT NULL,
          valido_ate INTEGER NOT NULL,
          usado_em INTEGER,
          usado_por TEXT
        );
        CREATE INDEX cupons_cliente ON cupons(cliente_id, id);
        CREATE TABLE giros (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          interativo TEXT NOT NULL,
          dia TEXT NOT NULL,
          em INTEGER NOT NULL,
          cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
          whatsapp_hash TEXT NOT NULL DEFAULT '',
          aparelho_hash TEXT NOT NULL DEFAULT '',
          premio_id TEXT NOT NULL DEFAULT '',
          uf TEXT NOT NULL DEFAULT '',
          origem TEXT NOT NULL DEFAULT 'servidor',
          reserva_expira INTEGER,
          cupom_id INTEGER REFERENCES cupons(id) ON DELETE SET NULL
        );
        CREATE INDEX giros_aparelho ON giros(aparelho_hash, interativo, dia);
        CREATE INDEX giros_cliente ON giros(cliente_id, interativo, dia);
        CREATE INDEX giros_whatsapp ON giros(whatsapp_hash, interativo, dia);
        SQL,
        // 206: o pedido do site ligado à conta de quem estava logado (Meus pedidos); vagas e pedidos achados também
        // pelo WhatsApp da conta.
        206 => <<<'SQL'
        ALTER TABLE pedidos ADD COLUMN cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL;
        CREATE INDEX pedidos_cliente ON pedidos(cliente_id, id);
        CREATE INDEX pedidos_whatsapp ON pedidos(whatsapp, id);
        CREATE INDEX participacoes_whatsapp_todas ON participacoes(whatsapp, id);
        SQL,
    ];
}

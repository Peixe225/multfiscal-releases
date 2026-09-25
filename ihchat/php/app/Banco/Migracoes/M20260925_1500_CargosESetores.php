<?php
declare(strict_types=1);

namespace IHchat\Banco\Migracoes;

use IHchat\Banco\Esquema;
use IHchat\Banco\Migracao;
use PDO;

/**
 * Cargos, permissões e setores (as mesmas tabelas e colunas de app/models.py).
 *
 *  - cargos: nome, nível (hierarquia: quem tem nível maior gerencia quem tem
 *    menor) e a lista de permissões em JSON. `chave` identifica os cargos de
 *    fábrica ("administrador", "gerente", "lider", "conferente",
 *    "colaborador"); cargo criado pelo admin tem chave NULL. `sistema` = de
 *    fábrica: não pode ser apagado.
 *  - setores: o texto livre atendentes.setor vira cadastro. O nome é binário
 *    no MySQL: a colação *_ci acharia "Implantação" igual a "Implantacao", e
 *    eles eram setores diferentes no texto livre (e no chat). Nome repetido
 *    sem diferença de maiúscula é barrado no código.
 *  - atendentes.cargo_id/setor_id, canais.setor_padrao_id (conversa nova do
 *    canal entra na fila do setor), conversas.setor_id e
 *    interno_salas.setor_id (a sala de setor passa a seguir o cadastro).
 *    Sem chave estrangeira: o SQLite não acrescenta FK com ALTER TABLE, e
 *    apagar cargo ou setor em uso é recusado pela API.
 *
 * Dados existentes: papel "admin" vira Administrador e o resto Colaborador; o
 * texto de setor vira um setor por nome (sem diferença de maiúsculas e
 * espaços repetidos, a mesma regra das salas do chat), e a sala de setor do
 * chat passa a apontar para ele, com os membros e o histórico. As colunas
 * papel e setor continuam gravadas (papel derivado do cargo; setor = nome do
 * setor): o JSON antigo e a assinatura das mensagens seguem iguais.
 *
 * Os cargos de fábrica estão congelados AQUI, como eram nesta versão: mudar
 * o conjunto de fábrica depois pede outra migração, não editar esta.
 */
final class M20260925_1500_CargosESetores implements Migracao
{
    private const TODAS = [
        'equipe.ver', 'equipe.gerenciar', 'equipe.definir_cargo', 'equipe.definir_setor',
        'cargos.gerenciar', 'setores.gerenciar', 'canais.ver', 'canais.gerenciar',
        'conversas.ver_todas', 'conversas.ver_setor', 'conversas.transferir', 'conversas.resolver',
        'conversas.reabrir', 'contatos.editar', 'contatos.mesclar', 'respostas.gerenciar',
        'etiquetas.gerenciar', 'metricas.ver_todas', 'metricas.ver_setor', 'chat.criar_grupo',
        'chat.moderar', 'simulador.usar',
    ];

    /** chave => [nome, nível, permissões] (do mais alto ao mais baixo) */
    private const FABRICA = [
        'administrador' => ['Administrador', 100, self::TODAS],
        'gerente' => ['Gerente', 80, [
            'equipe.ver', 'equipe.gerenciar', 'equipe.definir_cargo', 'equipe.definir_setor',
            'setores.gerenciar', 'canais.ver', 'conversas.ver_todas', 'conversas.ver_setor',
            'conversas.transferir', 'conversas.resolver', 'conversas.reabrir', 'contatos.editar',
            'contatos.mesclar', 'respostas.gerenciar', 'etiquetas.gerenciar', 'metricas.ver_todas',
            'metricas.ver_setor', 'chat.criar_grupo', 'chat.moderar', 'simulador.usar',
        ]],
        'lider' => ['Líder', 60, [
            'equipe.ver', 'equipe.gerenciar', 'equipe.definir_cargo', 'canais.ver',
            'conversas.ver_setor', 'conversas.transferir', 'conversas.resolver', 'conversas.reabrir',
            'contatos.editar', 'contatos.mesclar', 'respostas.gerenciar', 'etiquetas.gerenciar',
            'metricas.ver_setor', 'chat.criar_grupo', 'simulador.usar',
        ]],
        'conferente' => ['Conferente', 40, [
            'equipe.ver', 'canais.ver', 'conversas.ver_setor', 'conversas.resolver', 'conversas.reabrir',
            'contatos.editar', 'metricas.ver_setor', 'chat.criar_grupo',
        ]],
        'colaborador' => ['Colaborador', 20, [
            'equipe.ver', 'canais.ver', 'conversas.resolver', 'contatos.editar', 'chat.criar_grupo',
        ]],
    ];

    public function descricao(): string
    {
        return 'cargos, permissões e setores (papel vira cargo; texto de setor vira setor)';
    }

    public function aplicar(Esquema $e): void
    {
        $e->criarTabela('cargos', <<<'SQL'
            id {ID},
            chave VARCHAR(20){BIN} NULL,
            nome VARCHAR(60){BIN} NOT NULL,
            nivel INT NOT NULL,
            permissoes {JSON} NOT NULL,
            sistema {BOOL} NOT NULL DEFAULT 0,
            criado_em {DATA} NOT NULL
            SQL);
        $e->criarIndice('cargos', 'uq_cargos_chave', ['chave'], unico: true);
        $e->criarIndice('cargos', 'uq_cargos_nome', ['nome'], unico: true);

        $e->criarTabela('setores', <<<'SQL'
            id {ID},
            nome VARCHAR(60){BIN} NOT NULL,
            descricao VARCHAR(255) NULL,
            ativo {BOOL} NOT NULL DEFAULT 1,
            criado_em {DATA} NOT NULL
            SQL);
        $e->criarIndice('setores', 'uq_setores_nome', ['nome'], unico: true);

        $e->adicionarColuna('atendentes', 'cargo_id', 'INT NULL');
        $e->adicionarColuna('atendentes', 'setor_id', 'INT NULL');
        $e->adicionarColuna('canais', 'setor_padrao_id', 'INT NULL');
        $e->adicionarColuna('conversas', 'setor_id', 'INT NULL');
        $e->adicionarColuna('interno_salas', 'setor_id', 'INT NULL');
        $e->criarIndice('atendentes', 'ix_atendentes_cargo_id', ['cargo_id']);
        $e->criarIndice('atendentes', 'ix_atendentes_setor_id', ['setor_id']);
        $e->criarIndice('conversas', 'ix_conversas_setor_id', ['setor_id']);

        // os dados numa transação só (o DDL acima já confirmou sozinho no
        // MySQL); tudo idempotente, então uma falha aqui é refeita inteira
        $pdo = $e->pdo();
        $propria = !$pdo->inTransaction();
        if ($propria) {
            $pdo->beginTransaction();
        }
        try {
            $agora = (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d H:i:s.u');
            $cargos = $this->criarCargosDeFabrica($pdo, $agora);
            $this->migrarPapeis($pdo, $cargos);
            $this->migrarSetores($pdo, $agora);
            if ($propria) {
                $pdo->commit();
            }
        } catch (\Throwable $erro) {
            if ($propria && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $erro;
        }
    }

    /** @return array<string, int> chave => id */
    private function criarCargosDeFabrica(PDO $pdo, string $agora): array
    {
        $ids = [];
        $buscar = $pdo->prepare('SELECT id FROM cargos WHERE chave = ?');
        $inserir = $pdo->prepare(
            'INSERT INTO cargos (chave, nome, nivel, permissoes, sistema, criado_em) VALUES (?, ?, ?, ?, 1, ?)'
        );
        foreach (self::FABRICA as $chave => [$nome, $nivel, $permissoes]) {
            $buscar->execute([$chave]);
            $id = $buscar->fetchColumn();
            if ($id === false) {
                $inserir->execute([$chave, $nome, $nivel, json_encode($permissoes), $agora]);
                $id = $pdo->lastInsertId();
            }
            $ids[$chave] = (int) $id;
        }
        return $ids;
    }

    /** @param array<string, int> $cargos */
    private function migrarPapeis(PDO $pdo, array $cargos): void
    {
        $pdo->prepare("UPDATE atendentes SET cargo_id = ? WHERE cargo_id IS NULL AND papel = 'admin'")
            ->execute([$cargos['administrador']]);
        $pdo->prepare("UPDATE atendentes SET cargo_id = ?, papel = 'atendente' WHERE cargo_id IS NULL")
            ->execute([$cargos['colaborador']]);
    }

    private function migrarSetores(PDO $pdo, string $agora): void
    {
        $existentes = [];
        foreach ($pdo->query('SELECT id, nome FROM setores')->fetchAll(PDO::FETCH_ASSOC) as $linha) {
            $existentes[self::normal((string) $linha['nome'])] = (int) $linha['id'];
        }
        $pessoas = $pdo->query(
            "SELECT id, setor FROM atendentes WHERE setor_id IS NULL AND setor IS NOT NULL AND setor <> '' ORDER BY id"
        )->fetchAll(PDO::FETCH_ASSOC);
        $inserir = $pdo->prepare('INSERT INTO setores (nome, descricao, ativo, criado_em) VALUES (?, NULL, 1, ?)');
        $nomeDe = $pdo->prepare('SELECT nome FROM setores WHERE id = ?');
        $vincular = $pdo->prepare('UPDATE atendentes SET setor_id = ?, setor = ? WHERE id = ?');
        $salas = []; // chave antiga da sala de setor => [setor_id, nome]
        foreach ($pessoas as $pessoa) {
            $texto = self::espacos((string) $pessoa['setor']);
            if ($texto === '') {
                continue;
            }
            // o primeiro atendente (menor id) dá o nome, como a sala do chat fazia
            $nome = mb_substr($texto, 0, 60);
            $chave = self::normal($nome);
            if (!isset($existentes[$chave])) {
                $inserir->execute([$nome, $agora]);
                $existentes[$chave] = (int) $pdo->lastInsertId();
            }
            $setorId = $existentes[$chave];
            $nomeDe->execute([$setorId]);
            $nomeOficial = (string) $nomeDe->fetchColumn();
            $vincular->execute([$setorId, $nomeOficial, (int) $pessoa['id']]);
            // a chave antiga era o hash do texto normalizado inteiro (Salas::chaveSetor)
            $antiga = 'setor:' . substr(hash('sha256', mb_strtolower($texto)), 0, 40);
            $salas[$antiga] ??= [$setorId, $nomeOficial];
        }

        // a sala de setor passa a ser do cadastro: mesmos membros e histórico
        $jaTem = $pdo->prepare('SELECT id FROM interno_salas WHERE chave = ?');
        $mover = $pdo->prepare(
            "UPDATE interno_salas SET setor_id = ?, chave = ?, nome = ?, setor = ? WHERE chave = ? AND tipo = 'setor'"
        );
        foreach ($salas as $antiga => [$setorId, $nome]) {
            $nova = 'setor:id:' . $setorId;
            $jaTem->execute([$nova]);
            if ($jaTem->fetchColumn() !== false) {
                continue;
            }
            $mover->execute([$setorId, $nova, $nome, $nome, $antiga]);
        }
    }

    private static function espacos(string $texto): string
    {
        return trim((string) preg_replace('/\s+/u', ' ', $texto));
    }

    private static function normal(string $texto): string
    {
        return mb_strtolower(self::espacos($texto));
    }
}

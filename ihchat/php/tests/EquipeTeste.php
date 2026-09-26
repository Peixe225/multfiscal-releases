<?php
declare(strict_types=1);

use IHchat\Auth\Atendentes;
use IHchat\Auth\Cargos;
use IHchat\Auth\Permissoes;
use IHchat\Banco\Banco;
use IHchat\Banco\Esquema;
use IHchat\Banco\Migracoes\M20260925_1500_CargosESetores;
use IHchat\ChatInterno\Salas;
use IHchat\Nucleo\Datas;

/**
 * Cargos e setores: a migração dos dados antigos (papel e texto de setor).
 * As regras das rotas (hierarquia, visibilidade, eventos) estão na suíte de
 * contrato, que roda igual nos dois servidores (contrato/test_cargos_*.py).
 */

/** Banco novo com todas as migrações ANTES da de cargos: é a base de produção de hoje. */
function equipe_base_antiga(): PDO
{
    $pdo = new PDO('sqlite::memory:', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $esquema = new Esquema($pdo);
    foreach (Esquema::descobrir() as $nome) {
        if (strcmp($nome, 'M20260925_1500_CargosESetores') >= 0) {
            break;
        }
        $classe = 'IHchat\\Banco\\Migracoes\\' . $nome;
        (new $classe())->aplicar($esquema);
    }
    return $pdo;
}

function equipe_pessoa(PDO $pdo, string $nome, string $papel, ?string $setor): int
{
    $pdo->prepare(
        'INSERT INTO atendentes (nome, email, senha_hash, papel, ativo, disponivel, setor, criado_em) VALUES (?, ?, ?, ?, 1, 1, ?, ?)'
    )->execute([$nome, strtolower($nome) . '@empresa.com.br', 'x', $papel, $setor, Datas::agoraBanco()]);
    return (int) $pdo->lastInsertId();
}

return [
    'migracao: papel vira cargo e texto de setor vira setor, com a sala do chat' => function (): void {
        $pdo = equipe_base_antiga();
        $admin = equipe_pessoa($pdo, 'Chefe', 'admin', null);
        $ana = equipe_pessoa($pdo, 'Ana', 'atendente', '  Suporte   Técnico ');
        $bia = equipe_pessoa($pdo, 'Bia', 'atendente', 'suporte técnico');
        $caio = equipe_pessoa($pdo, 'Caio', 'atendente', 'Financeiro');
        $davi = equipe_pessoa($pdo, 'Davi', 'atendente', null);
        // a sala de setor do tempo do texto livre, com membros e uma mensagem
        $agora = Datas::agoraBanco();
        $chaveAntiga = Salas::chaveSetor('Suporte Técnico');
        $pdo->prepare("INSERT INTO interno_salas (tipo, nome, setor, chave, criada_em, atualizada_em) VALUES ('setor', ?, ?, ?, ?, ?)")
            ->execute(['Suporte Técnico', 'Suporte Técnico', $chaveAntiga, $agora, $agora]);
        $sala = (int) $pdo->lastInsertId();
        foreach ([$ana, $bia] as $membro) {
            $pdo->prepare('INSERT INTO interno_membros (sala_id, atendente_id, lida_ate, silenciada, entrou_em, visivel_desde) VALUES (?, ?, 0, 0, ?, 0)')
                ->execute([$sala, $membro, $agora]);
        }
        $pdo->prepare("INSERT INTO interno_mensagens (sala_id, autor_id, conteudo, mencoes, criada_em, apagada) VALUES (?, ?, 'oi, setor', '[]', ?, 0)")
            ->execute([$sala, $ana, $agora]);

        (new M20260925_1500_CargosESetores())->aplicar(new Esquema($pdo));
        // de novo: nada muda (idempotente, como toda migração)
        (new M20260925_1500_CargosESetores())->aplicar(new Esquema($pdo));
        Banco::definir($pdo);
        Cargos::esquecer();

        Afirmar::igual(
            ['administrador' => 100, 'gerente' => 80, 'lider' => 60, 'conferente' => 40, 'colaborador' => 20],
            array_column(array_values(Cargos::todos()), 'nivel', 'chave')
        );
        Afirmar::igual(Permissoes::todas(), Cargos::deFabrica(Cargos::ADMINISTRADOR)['permissoes']);
        foreach ([[$admin, 'Administrador', 'admin'], [$ana, 'Colaborador', 'atendente'], [$davi, 'Colaborador', 'atendente']] as [$id, $cargo, $papel]) {
            $saida = Atendentes::saida(Atendentes::porId($id));
            Afirmar::igual([$cargo, $papel], [$saida['cargo']['nome'], $saida['papel']]);
        }
        $setores = Banco::todos('SELECT id, nome FROM setores ORDER BY id');
        Afirmar::igual(['Suporte Técnico', 'Financeiro'], array_column($setores, 'nome'));
        $suporte = (int) $setores[0]['id'];
        foreach ([$ana, $bia] as $id) {
            $pessoa = Atendentes::porId($id);
            Afirmar::igual([$suporte, 'Suporte Técnico'], [$pessoa['setor_id'], $pessoa['setor']]);
        }
        Afirmar::igual((int) $setores[1]['id'], Atendentes::porId($caio)['setor_id']);
        Afirmar::igual(null, Atendentes::porId($davi)['setor_id']);

        // a sala antiga agora é a do setor: mesmos membros e mesmo histórico
        $linha = Banco::um('SELECT * FROM interno_salas WHERE id = ?', [$sala]);
        Afirmar::igual(['setor:id:' . $suporte, $suporte], [$linha['chave'], (int) $linha['setor_id']]);
        Salas::sincronizar();
        Afirmar::igual(1, (int) Banco::valor("SELECT COUNT(*) FROM interno_salas WHERE tipo = 'setor' AND setor_id = ?", [$suporte]));
        $membros = array_map('intval', array_column(Banco::todos('SELECT atendente_id FROM interno_membros WHERE sala_id = ? ORDER BY atendente_id', [$sala]), 'atendente_id'));
        Afirmar::igual([$ana, $bia], $membros);
        Afirmar::igual(1, (int) Banco::valor('SELECT COUNT(*) FROM interno_mensagens WHERE sala_id = ?', [$sala]));
    },
    'sem cargo_id (linha antiga) vale o papel' => function (): void {
        $admin = ['id' => 1, 'papel' => 'admin', 'ativo' => true, 'cargo_id' => null];
        $comum = ['id' => 2, 'papel' => 'atendente', 'ativo' => true, 'cargo_id' => null];
        Afirmar::verdade(Permissoes::eAdministrador($admin), 'admin sem cargo_id');
        Afirmar::igual(Permissoes::todas(), Permissoes::de($admin));
        Afirmar::igual(Cargos::deFabrica(Cargos::COLABORADOR)['permissoes'], Permissoes::de($comum));
        Afirmar::igual([], Permissoes::de(['ativo' => false] + $admin));
    },
    'cargos de fabrica: conjuntos decrescentes' => function (): void {
        $ordem = [Cargos::ADMINISTRADOR, Cargos::GERENTE, Cargos::LIDER, Cargos::CONFERENTE, Cargos::COLABORADOR];
        for ($i = 1; $i < count($ordem); $i++) {
            $maior = Cargos::deFabrica($ordem[$i - 1]);
            $menor = Cargos::deFabrica($ordem[$i]);
            Afirmar::verdade($maior['nivel'] > $menor['nivel'], "nível de {$ordem[$i]}");
            Afirmar::igual([], array_values(array_diff($menor['permissoes'], $maior['permissoes'])));
            Afirmar::verdade(count($menor['permissoes']) < count($maior['permissoes']), "permissões de {$ordem[$i]}");
        }
    },
];

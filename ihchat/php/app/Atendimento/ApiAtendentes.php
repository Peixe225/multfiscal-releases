<?php
declare(strict_types=1);

namespace IHchat\Atendimento;

use IHchat\Auth\Atendentes;
use IHchat\Auth\Auth;
use IHchat\Auth\Cargos;
use IHchat\Auth\Permissoes;
use IHchat\Auth\Senhas;
use IHchat\Banco\Banco;
use IHchat\ChatInterno\Salas;
use IHchat\Equipe\Hierarquia;
use IHchat\Equipe\Setores;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\ErroHttp;
use IHchat\Nucleo\Requisicao;
use IHchat\Nucleo\Validador;

/**
 * Cadastro da equipe (app/api/atendentes.py), com cargos e setores.
 *
 *   GET   /api/atendentes         equipe.ver
 *   POST  /api/atendentes         equipe.gerenciar (+ definir_cargo / definir_setor)
 *   PATCH /api/atendentes/{id}    a própria senha e disponibilidade: qualquer um;
 *                                 o resto, só quem gerencia (Equipe\Hierarquia)
 *
 * Entrada: cargo_id e setor_id (o jeito novo) ou, por compatibilidade, papel
 * ("admin" = Administrador, "atendente" = Colaborador) e setor (o nome; quem
 * pode gerenciar setores cria na hora o que não existir).
 */
final class ApiAtendentes
{
    public const MAX_SETOR = 60;
    /**
     * O bcrypt do password_hash só olha os 72 primeiros BYTES: uma senha maior
     * seria cortada em silêncio (quem digitasse só o começo entraria), e um
     * caractere nulo faz o password_hash lançar erro. Mesma regra no Python.
     */
    public const SENHA_MAX_BYTES = 72;

    /** @return list<array<string, mixed>> */
    public static function listar(Requisicao $req): array
    {
        Auth::exigir($req, 'equipe.ver');
        return array_map(
            static fn (array $l): array => Atendentes::saida(Atendentes::tipar($l)),
            Banco::todos('SELECT * FROM atendentes ORDER BY nome, id')
        );
    }

    /** @return array<string, mixed> */
    public static function criar(Requisicao $req): array
    {
        $eu = Auth::exigir($req, 'equipe.gerenciar');
        $v = Validador::corpo($req);
        $nome = $v->texto('nome', min: 2, max: 120);
        $email = $v->email('email');
        $senha = $v->texto('senha', min: 6, max: 128);
        $papel = $v->opcao('papel', Atendentes::PAPEIS, obrigatorio: false);
        $cargoId = $v->inteiro('cargo_id', obrigatorio: false, minimo: 1);
        $disponivel = $v->booleano('disponivel', obrigatorio: false, padrao: true, anulavel: false);
        $setorId = $v->inteiro('setor_id', obrigatorio: false, minimo: 1);
        $setorTexto = $v->texto('setor', max: self::MAX_SETOR, obrigatorio: false, aparar: true);
        self::conferirSenha($v, $senha);
        $v->validar();

        // cargo: sem escolha, o Colaborador; escolher outro é definir cargo
        $colaborador = Cargos::deFabrica(Cargos::COLABORADOR);
        $cargo = self::cargoPedido($cargoId, $papel, null) ?? $colaborador;
        if ($cargo['id'] !== $colaborador['id']) {
            Hierarquia::exigirConceder($eu, $cargo);
        } else {
            Hierarquia::exigirNivelAbaixo($eu, $cargo);
        }

        // setor: quem não define setor cadastra no PRÓPRIO (é o líder da equipe)
        $pedido = self::setorPedido($v, $setorId, $setorTexto);
        if (Permissoes::tem($eu, 'equipe.definir_setor')) {
            $setor = $pedido === null ? null : self::confirmarSetor($eu, $pedido, null);
        } else {
            $meu = $eu['setor_id'] ?? null;
            if ($pedido !== null && self::idDoPedido($pedido) !== $meu) {
                throw ErroHttp::proibido(Permissoes::mensagem('equipe.definir_setor'));
            }
            $setor = $meu === null ? null : Setores::porId((int) $meu);
        }

        $email = mb_strtolower((string) $email);
        if (Banco::valor('SELECT id FROM atendentes WHERE LOWER(email) = ?', [$email]) !== null) {
            throw ErroHttp::conflito('ja existe um atendente com esse e-mail');
        }
        try {
            $id = Banco::inserir('atendentes', [
                'nome' => $nome,
                'email' => $email,
                'senha_hash' => Senhas::gerarHash((string) $senha),
                'papel' => Atendentes::papelDoCargo($cargo),
                'cargo_id' => $cargo['id'],
                'ativo' => true,
                'disponivel' => (bool) $disponivel,
                'setor_id' => $setor['id'] ?? null,
                'setor' => $setor['nome'] ?? null,
                'criado_em' => Datas::agoraBanco(),
            ]);
        } catch (\PDOException $erro) {
            if (Banco::eUnicidade($erro)) {
                throw ErroHttp::conflito('ja existe um atendente com esse e-mail');
            }
            throw $erro;
        }
        Salas::sincronizarSemFalhar();
        return Atendentes::saida(Atendentes::porId($id) ?? []);
    }

    /**
     * Só o que mudou de verdade conta: mandar o nome igual ao atual (um
     * formulário que reenvia tudo) não exige permissão de gerenciar. As
     * permissões são conferidas ANTES de procurar o cargo ou o setor pedido:
     * quem não pode mexer recebe 403, não descobre o que existe.
     *
     * @param array{atendente_id: int} $p
     * @return array<string, mixed>
     */
    public static function atualizar(Requisicao $req, array $p): array
    {
        $eu = Auth::atendente($req);
        $v = Validador::corpo($req);
        $nome = $v->texto('nome', min: 2, max: 120, obrigatorio: false);
        $senha = $v->texto('senha', min: 6, max: 128, obrigatorio: false);
        $papel = $v->opcao('papel', Atendentes::PAPEIS, obrigatorio: false);
        $cargoId = $v->inteiro('cargo_id', obrigatorio: false, anulavel: false, minimo: 1);
        $ativo = $v->booleano('ativo', obrigatorio: false);
        $disponivel = $v->booleano('disponivel', obrigatorio: false);
        $setorId = $v->inteiro('setor_id', obrigatorio: false, minimo: 1);
        $setorTexto = $v->texto('setor', max: self::MAX_SETOR, obrigatorio: false, aparar: true);
        self::conferirSenha($v, $senha);
        $v->validar();

        $alvo = Atendentes::porId($p['atendente_id']);
        if ($alvo === null) {
            throw ErroHttp::naoEncontrado('atendente nao encontrado');
        }
        $cargoAtual = Permissoes::cargoDe($alvo);

        $mudaNome = $nome !== null && $nome !== $alvo['nome'];
        $mudaAtivo = $ativo !== null && $ativo !== $alvo['ativo'];
        // cargo_id inexistente conta como mudança: 403 antes do 404
        $cargo = $cargoId !== null ? Cargos::porId($cargoId) : self::cargoPedido(null, $papel, $cargoAtual);
        $mudaCargo = $cargoId !== null ? ($cargo === null || $cargo['id'] !== $cargoAtual['id'])
            : ($cargo !== null && $cargo['id'] !== $cargoAtual['id']);
        $pedidoSetor = self::setorPedido($v, $setorId, $setorTexto);
        $mudaSetor = $pedidoSetor !== null && self::idDoPedido($pedidoSetor) !== $alvo['setor_id'];

        $proprio = $alvo['id'] === $eu['id'];
        if ($mudaNome || $mudaAtivo || $mudaCargo || $mudaSetor) {
            if ($proprio) {
                // nome, setor, cargo e acesso são de quem gerencia; o
                // Administrador é o único que se gerencia
                if (!Permissoes::eAdministrador($eu)) {
                    throw ErroHttp::proibido(Hierarquia::PROPRIO_PERFIL);
                }
            } else {
                Hierarquia::exigirGerenciar($eu, $alvo);
            }
        } elseif (!$proprio && ($senha !== null || $disponivel !== null)) {
            // senha e disponibilidade de OUTRA pessoa também são gestão
            Hierarquia::exigirGerenciar($eu, $alvo);
        }
        if ($mudaCargo) {
            $cargo ??= throw ErroHttp::naoEncontrado('cargo nao encontrado');
            Hierarquia::exigirConceder($eu, $cargo);
        }
        $setor = null;
        if ($mudaSetor) {
            Permissoes::exigir($eu, 'equipe.definir_setor');
            $setor = self::confirmarSetor($eu, $pedidoSetor, $alvo['setor_id']);
        }

        $mudancas = [];
        if ($mudaNome) {
            $mudancas['nome'] = $nome;
        }
        if ($senha !== null) {
            $mudancas['senha_hash'] = Senhas::gerarHash($senha);
        }
        if ($mudaCargo) {
            $mudancas['cargo_id'] = $cargo['id'];
            $mudancas['papel'] = Atendentes::papelDoCargo($cargo);
        }
        if ($mudaAtivo) {
            $mudancas['ativo'] = $ativo;
        }
        if ($disponivel !== null) {
            $mudancas['disponivel'] = $disponivel;
        }
        if ($mudaSetor) {
            $mudancas['setor_id'] = $setor['id'] ?? null;
            $mudancas['setor'] = $setor['nome'] ?? null;
        }
        // perder o último Administrador ativo trancaria o sistema: a conferência
        // e a gravação vão juntas, travando os administradores (Hierarquia)
        $deixaDeSerAdmin = Cargos::eAdministrador($cargoAtual) && $alvo['ativo']
            && (($mudaAtivo && $ativo === false) || ($mudaCargo && !Cargos::eAdministrador($cargo)));
        Concorrencia::transacao(static function () use ($alvo, $mudancas, $deixaDeSerAdmin): void {
            if ($deixaDeSerAdmin) {
                Hierarquia::exigirOutroAdministrador($alvo['id']);
            }
            Banco::atualizar('atendentes', $mudancas, 'id = ?', [$alvo['id']]);
        });
        if ($mudaAtivo || $mudaSetor || $mudaCargo) {
            Salas::sincronizarSemFalhar();
        }
        return Atendentes::saida(Atendentes::porId($alvo['id']) ?? $alvo);
    }

    /**
     * O cargo pedido: cargo_id (404 se não existe) ou o papel antigo. "admin"
     * é o Administrador; "atendente" é "não Administrador": quem já não é
     * admin continua no cargo que tem, e o admin passa a Colaborador.
     *
     * @param array<string, mixed>|null $atual cargo atual (null no cadastro)
     * @return array<string, mixed>|null null = não pediu cargo
     */
    private static function cargoPedido(?int $cargoId, ?string $papel, ?array $atual): ?array
    {
        if ($cargoId !== null) {
            return Cargos::porId($cargoId) ?? throw ErroHttp::naoEncontrado('cargo nao encontrado');
        }
        if ($papel === Atendentes::PAPEL_ADMIN) {
            return Cargos::deFabrica(Cargos::ADMINISTRADOR);
        }
        if ($papel === Atendentes::PAPEL_ATENDENTE) {
            if ($atual !== null && !Cargos::eAdministrador($atual)) {
                return $atual;
            }
            return Cargos::deFabrica(Cargos::COLABORADOR);
        }
        return null;
    }

    /**
     * O setor pedido, SEM lançar erro (as permissões vêm antes): null = não
     * pediu; {vazio} = sem setor; {setor} = um que existe; {novo: nome} =
     * nome que não existe; {inexistente} = setor_id que não existe. Aceita
     * setor_id ou o nome (texto antigo, sem diferença de maiúsculas).
     *
     * @return array<string, mixed>|null
     */
    private static function setorPedido(Validador $v, ?int $setorId, ?string $texto): ?array
    {
        if ($v->tem('setor_id')) {
            if ($setorId === null) {
                return ['vazio' => true];
            }
            $setor = Setores::porId($setorId);
            return $setor === null ? ['inexistente' => true] : ['setor' => $setor];
        }
        if (!$v->tem('setor')) {
            return null;
        }
        $texto = Setores::espacos((string) $texto);
        if ($texto === '') {
            return ['vazio' => true];
        }
        $setor = Setores::porNome($texto);
        return $setor === null ? ['novo' => mb_substr($texto, 0, Setores::MAX_NOME)] : ['setor' => $setor];
    }

    /** O id que o pedido deixaria na pessoa (false = um setor que ainda não existe). @param array<string, mixed> $pedido */
    private static function idDoPedido(array $pedido): int|false|null
    {
        if (isset($pedido['setor'])) {
            return (int) $pedido['setor']['id'];
        }
        return isset($pedido['vazio']) ? null : false;
    }

    /**
     * Depois das permissões: o setor de verdade. setor_id inexistente é 404;
     * nome novo vira setor só para quem gerencia setores (os outros, 404);
     * setor inativo não recebe ninguém novo (422), mas quem já está nele fica.
     *
     * @param array<string, mixed> $eu
     * @param array<string, mixed> $pedido
     * @return array<string, mixed>|null
     */
    private static function confirmarSetor(array $eu, array $pedido, ?int $atual): ?array
    {
        if (isset($pedido['vazio'])) {
            return null;
        }
        if (isset($pedido['novo'])) {
            if (!Permissoes::tem($eu, 'setores.gerenciar')) {
                throw ErroHttp::naoEncontrado('setor nao encontrado');
            }
            return Setores::criar((string) $pedido['novo']);
        }
        $setor = $pedido['setor'] ?? throw ErroHttp::naoEncontrado('setor nao encontrado');
        if (!$setor['ativo'] && $setor['id'] !== $atual) {
            throw ErroHttp::invalido('setor inativo: reative-o ou escolha outro');
        }
        return $setor;
    }

    /** Limite em bytes e sem caractere de controle (ver SENHA_MAX_BYTES). */
    private static function conferirSenha(Validador $v, #[\SensitiveParameter] ?string $senha): void
    {
        if ($senha === null) {
            return;
        }
        if (preg_match('/[\x00-\x1F\x7F]/', $senha) === 1) {
            $v->falhar('senha', 'senha: não pode ter caracteres de controle (tabulação, quebra de linha, caractere nulo)');
        } elseif (strlen($senha) > self::SENHA_MAX_BYTES) {
            $v->falhar('senha', 'senha: pode ter no máximo ' . self::SENHA_MAX_BYTES . ' bytes (letra com acento conta 2)');
        }
    }
}

<?php
declare(strict_types=1);

namespace IHchat\Atendimento;

use IHchat\Auth\Atendentes;
use IHchat\Auth\Auth;
use IHchat\Auth\Senhas;
use IHchat\Banco\Banco;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\ErroHttp;
use IHchat\Nucleo\Requisicao;
use IHchat\Nucleo\Validador;

/**
 * Cadastro de atendentes (app/api/atendentes.py) + o campo novo `setor`: o
 * setor aparece para o cliente junto com o nome de quem responde
 * ("Ana · Suporte técnico"), então cada atendente pode ajustar o seu.
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
        Auth::atendente($req);
        return array_map(
            static fn (array $l): array => Atendentes::saida(Atendentes::tipar($l)),
            Banco::todos('SELECT * FROM atendentes ORDER BY nome, id')
        );
    }

    /** @return array<string, mixed> */
    public static function criar(Requisicao $req): array
    {
        Auth::admin($req);
        $v = Validador::corpo($req);
        $nome = $v->texto('nome', min: 2, max: 120);
        $email = $v->email('email');
        $senha = $v->texto('senha', min: 6, max: 128);
        $papel = $v->opcao('papel', Atendentes::PAPEIS, obrigatorio: false, padrao: Atendentes::PAPEL_ATENDENTE);
        $setor = $v->texto('setor', max: self::MAX_SETOR, obrigatorio: false, aparar: true);
        self::conferirSenha($v, $senha);
        $v->validar();

        $email = mb_strtolower((string) $email);
        if (Banco::valor('SELECT id FROM atendentes WHERE LOWER(email) = ?', [$email]) !== null) {
            throw ErroHttp::conflito('ja existe um atendente com esse e-mail');
        }
        try {
            $id = Banco::inserir('atendentes', [
                'nome' => $nome,
                'email' => $email,
                'senha_hash' => Senhas::gerarHash((string) $senha),
                'papel' => $papel ?? Atendentes::PAPEL_ATENDENTE,
                'ativo' => true,
                'disponivel' => true,
                'setor' => $setor === null || $setor === '' ? null : $setor,
                'criado_em' => Datas::agoraBanco(),
            ]);
        } catch (\PDOException $erro) {
            if (Banco::eUnicidade($erro)) {
                throw ErroHttp::conflito('ja existe um atendente com esse e-mail');
            }
            throw $erro;
        }
        return Atendentes::saida(Atendentes::porId($id) ?? []);
    }

    /**
     * @param array{atendente_id: int} $p
     * @return array<string, mixed>
     */
    public static function atualizar(Requisicao $req, array $p): array
    {
        $atual = Auth::atendente($req);
        $v = Validador::corpo($req);
        $nome = $v->texto('nome', min: 2, max: 120, obrigatorio: false);
        $senha = $v->texto('senha', min: 6, max: 128, obrigatorio: false);
        $papel = $v->opcao('papel', Atendentes::PAPEIS, obrigatorio: false);
        $ativo = $v->booleano('ativo', obrigatorio: false);
        $disponivel = $v->booleano('disponivel', obrigatorio: false);
        $setor = $v->texto('setor', max: self::MAX_SETOR, obrigatorio: false, aparar: true);
        self::conferirSenha($v, $senha);
        $v->validar();

        $alvo = Atendentes::porId($p['atendente_id']);
        if ($alvo === null) {
            throw ErroHttp::naoEncontrado('atendente nao encontrado');
        }
        // cada um cuida do próprio perfil; mexer nos outros é coisa de admin
        $admin = Atendentes::eAdmin($atual);
        if ($alvo['id'] !== $atual['id'] && !$admin) {
            throw ErroHttp::proibido('acao restrita a administradores');
        }
        if (($papel !== null || $ativo !== null) && !$admin) {
            throw ErroHttp::proibido('somente admin altera papel ou acesso');
        }

        $mudancas = [];
        if ($nome !== null) {
            $mudancas['nome'] = $nome;
        }
        if ($senha !== null) {
            $mudancas['senha_hash'] = Senhas::gerarHash($senha);
        }
        if ($papel !== null) {
            $mudancas['papel'] = $papel;
        }
        if ($ativo !== null) {
            $mudancas['ativo'] = $ativo;
        }
        if ($disponivel !== null) {
            $mudancas['disponivel'] = $disponivel;
        }
        if ($v->tem('setor')) {
            // null ou vazio limpa: o cliente passa a ver só o nome
            $mudancas['setor'] = $setor === null || $setor === '' ? null : $setor;
        }
        Banco::atualizar('atendentes', $mudancas, 'id = ?', [$alvo['id']]);
        return Atendentes::saida(Atendentes::porId($alvo['id']) ?? $alvo);
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

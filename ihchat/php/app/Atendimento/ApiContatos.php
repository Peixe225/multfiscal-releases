<?php
declare(strict_types=1);

namespace IHchat\Atendimento;

use IHchat\Auth\Auth;
use IHchat\Banco\Banco;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\ErroHttp;
use IHchat\Nucleo\Requisicao;
use IHchat\Nucleo\Texto;
use IHchat\Nucleo\Validador;

/** Consulta e edição da ficha do contato (app/api/contatos.py). */
final class ApiContatos
{
    /** Tamanho da coluna contatos.telefone. */
    public const MAX_DIGITOS_TELEFONE = 32;

    /** @return list<array<string, mixed>> */
    public static function listar(Requisicao $req): array
    {
        Auth::atendente($req);
        $v = Validador::consulta($req);
        $q = $v->texto('q', obrigatorio: false);
        $limite = $v->inteiro('limite', obrigatorio: false, padrao: 50, maximo: 200);
        $v->validar();

        $onde = '';
        $p = [];
        if ($q !== null && $q !== '') {
            // busca por nome, e-mail, telefone, empresa ou documento; LOWER dos
            // dois lados, no banco, como o ilike do Python (ver Conversas::listar)
            $alvo = '%' . trim($q) . '%';
            $onde = ' WHERE LOWER(nome) LIKE LOWER(?) OR LOWER(email) LIKE LOWER(?) OR LOWER(telefone) LIKE LOWER(?)'
                . ' OR LOWER(empresa) LIKE LOWER(?) OR LOWER(documento) LIKE LOWER(?)';
            $p = [$alvo, $alvo, $alvo, $alvo, $alvo];
        }
        $p[] = max(0, (int) $limite);
        $linhas = Banco::todos('SELECT * FROM contatos' . $onde . ' ORDER BY nome, id LIMIT ?', $p);
        return array_values(Saidas::montarContatos($linhas));
    }

    /**
     * @param array{contato_id: int} $p
     * @return array<string, mixed>
     */
    public static function obter(Requisicao $req, array $p): array
    {
        Auth::atendente($req);
        return Saidas::contatoPorId($p['contato_id']) ?? throw ErroHttp::naoEncontrado('contato nao encontrado');
    }

    /**
     * Só os campos enviados mudam; null limpa (menos o nome, que é obrigatório).
     *
     * @param array{contato_id: int} $p
     * @return array<string, mixed>
     */
    public static function atualizar(Requisicao $req, array $p): array
    {
        Auth::atendente($req);
        $v = Validador::corpo($req);
        $campos = [
            'nome' => $v->texto('nome', min: 1, max: 160, obrigatorio: false, anulavel: false),
            'empresa' => $v->texto('empresa', max: 160, obrigatorio: false),
            'documento' => $v->texto('documento', max: 32, obrigatorio: false),
            'email' => $v->email('email', obrigatorio: false),
            'telefone' => $v->texto('telefone', max: 40, obrigatorio: false),
            'observacoes' => $v->texto('observacoes', max: 10000, obrigatorio: false),
        ];
        if ($campos['email'] !== null && mb_strlen($campos['email']) > 160) {
            $v->falhar('email', 'email: pode ter no máximo 160 caracteres');
        }
        // o telefone é gravado só com dígitos numa coluna de 32: o limite vale
        // DEPOIS de tirar a formatação (o MySQL estrito recusaria com 500)
        if ($campos['telefone'] !== null && strlen(Texto::normalizarTelefone($campos['telefone'])) > self::MAX_DIGITOS_TELEFONE) {
            $v->falhar('telefone', 'telefone: pode ter no máximo ' . self::MAX_DIGITOS_TELEFONE . ' dígitos');
        }
        $v->validar();

        if (Banco::valor('SELECT id FROM contatos WHERE id = ?', [$p['contato_id']]) === null) {
            throw ErroHttp::naoEncontrado('contato nao encontrado');
        }
        $mudancas = [];
        foreach ($campos as $campo => $valor) {
            if (!$v->tem($campo)) {
                continue;
            }
            if ($campo === 'telefone' && $valor !== null && $valor !== '') {
                $valor = Texto::normalizarTelefone($valor); // guardado só com dígitos
            }
            if ($campo === 'email' && $valor !== null && $valor !== '') {
                $valor = mb_strtolower($valor);
            }
            $mudancas[$campo] = $valor;
        }
        if ($mudancas !== []) {
            $mudancas['atualizado_em'] = Datas::agoraBanco();
            Banco::atualizar('contatos', $mudancas, 'id = ?', [$p['contato_id']]);
        }
        return Saidas::contatoPorId($p['contato_id']) ?? throw ErroHttp::naoEncontrado('contato nao encontrado');
    }

    /**
     * Junta duas fichas do mesmo cliente que chegaram por canais diferentes.
     *
     * @param array{contato_id: int, outro_id: int} $p
     * @return array<string, mixed>
     */
    public static function mesclar(Requisicao $req, array $p): array
    {
        Auth::atendente($req);
        if (Contatos::porId($p['contato_id']) === null || Contatos::porId($p['outro_id']) === null) {
            throw ErroHttp::naoEncontrado('contato nao encontrado');
        }
        $id = Contatos::mesclar($p['contato_id'], $p['outro_id']);
        return Saidas::contatoPorId($id) ?? throw ErroHttp::naoEncontrado('contato nao encontrado');
    }
}

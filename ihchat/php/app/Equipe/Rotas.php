<?php
declare(strict_types=1);

namespace IHchat\Equipe;

use IHchat\Atendimento\Concorrencia;
use IHchat\Auth\Auth;
use IHchat\Auth\Cargos;
use IHchat\Auth\Permissoes;
use IHchat\Banco\Banco;
use IHchat\ChatInterno\Salas;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\ErroHttp;
use IHchat\Nucleo\Requisicao;
use IHchat\Nucleo\Roteador;
use IHchat\Nucleo\Validador;

/**
 * Cargos, setores e o catálogo de permissões (mesmo contrato de
 * app/api/equipe.py):
 *
 *   GET    /api/permissoes              catálogo [{chave, rotulo, grupo}]
 *   GET    /api/cargos                  [CargoSaida] do nível mais alto ao mais baixo
 *   POST   /api/cargos                  {nome, nivel, permissoes} -> 201       (cargos.gerenciar)
 *   PATCH  /api/cargos/{id}             {nome?, nivel?, permissoes?}           (cargos.gerenciar)
 *   DELETE /api/cargos/{id}             só cargo criado pelo admin e sem ninguém (204)
 *   GET    /api/setores                 [SetorSaida] (ativos e inativos)
 *   POST   /api/setores                 {nome, descricao?} -> 201              (setores.gerenciar)
 *   PATCH  /api/setores/{id}            {nome?, descricao?, ativo?}            (setores.gerenciar)
 *   DELETE /api/setores/{id}            só setor que nunca foi usado (204)
 *
 * Ler é para qualquer atendente logado: o painel monta os seletores daqui.
 */
final class Rotas
{
    public const MAX_NOME_CARGO = 60;

    public static function registrar(Roteador $r): void
    {
        $r->get('/api/permissoes', [self::class, 'permissoes']);
        $r->get('/api/cargos', [self::class, 'listarCargos']);
        $r->post('/api/cargos', [self::class, 'criarCargo'], status: 201);
        $r->patch('/api/cargos/{cargo_id:int}', [self::class, 'atualizarCargo']);
        $r->delete('/api/cargos/{cargo_id:int}', [self::class, 'apagarCargo'], status: 204);
        $r->get('/api/setores', [self::class, 'listarSetores']);
        $r->post('/api/setores', [self::class, 'criarSetor'], status: 201);
        $r->patch('/api/setores/{setor_id:int}', [self::class, 'atualizarSetor']);
        $r->delete('/api/setores/{setor_id:int}', [self::class, 'apagarSetor'], status: 204);
    }

    /** @return list<array<string, string>> */
    public static function permissoes(Requisicao $req): array
    {
        Auth::atendente($req);
        return Permissoes::catalogo();
    }

    // ------------------------------------------------------------------ cargos

    /** @return list<array<string, mixed>> */
    public static function listarCargos(Requisicao $req): array
    {
        Auth::atendente($req);
        $pessoas = Cargos::pessoasPorCargo();
        return array_values(array_map(
            static fn (array $c): array => Cargos::saida($c, $pessoas[$c['id']] ?? 0),
            Cargos::todos()
        ));
    }

    /** @return array<string, mixed> */
    public static function criarCargo(Requisicao $req): array
    {
        $eu = Auth::exigir($req, 'cargos.gerenciar');
        $v = Validador::corpo($req);
        $nome = self::nomeDeCargo($v, obrigatorio: true);
        $nivel = $v->inteiro('nivel', minimo: 1, maximo: Permissoes::NIVEL_MAXIMO_OUTROS);
        $permissoes = self::listaDePermissoes($v, obrigatorio: true);
        $v->validar();
        Hierarquia::exigirNivelDeCargo($eu, (int) $nivel);
        Hierarquia::exigirPermissoesQueTem($eu, $permissoes ?? []);
        self::exigirNomeLivre((string) $nome);
        try {
            $id = Banco::inserir('cargos', [
                'chave' => null,
                'nome' => $nome,
                'nivel' => $nivel,
                'permissoes' => $permissoes ?? [],
                'sistema' => false,
                'criado_em' => Datas::agoraBanco(),
            ]);
        } catch (\PDOException $erro) {
            if (Banco::eUnicidade($erro)) {
                throw ErroHttp::conflito('ja existe um cargo com esse nome');
            }
            throw $erro;
        }
        Cargos::esquecer();
        return Cargos::saida(Cargos::porId($id) ?? throw new \RuntimeException('cargo sumiu'), 0);
    }

    /**
     * @param array{cargo_id: int} $p
     * @return array<string, mixed>
     */
    public static function atualizarCargo(Requisicao $req, array $p): array
    {
        $eu = Auth::exigir($req, 'cargos.gerenciar');
        $v = Validador::corpo($req);
        $nome = self::nomeDeCargo($v, obrigatorio: false);
        $nivel = $v->inteiro('nivel', obrigatorio: false, anulavel: false, minimo: 1, maximo: Permissoes::NIVEL_MAXIMO_OUTROS);
        $permissoes = self::listaDePermissoes($v, obrigatorio: false);
        $v->validar();
        $cargo = Cargos::porId($p['cargo_id']) ?? throw ErroHttp::naoEncontrado('cargo nao encontrado');
        Hierarquia::exigirGerenciarCargo($eu, $cargo);
        $mudancas = [];
        if ($nome !== null && $nome !== $cargo['nome']) {
            self::exigirNomeLivre($nome, $cargo['id']);
            $mudancas['nome'] = $nome;
        }
        if ($nivel !== null && $nivel !== $cargo['nivel']) {
            Hierarquia::exigirNivelDeCargo($eu, $nivel);
            $mudancas['nivel'] = $nivel;
        }
        if ($permissoes !== null) {
            // o que o cargo GANHA precisa ser de quem edita; tirar é sempre possível
            Hierarquia::exigirPermissoesQueTem($eu, array_values(array_diff($permissoes, $cargo['permissoes'])));
            $mudancas['permissoes'] = $permissoes;
        }
        if ($mudancas !== []) {
            try {
                Banco::atualizar('cargos', $mudancas, 'id = ?', [$cargo['id']]);
            } catch (\PDOException $erro) {
                if (Banco::eUnicidade($erro)) {
                    throw ErroHttp::conflito('ja existe um cargo com esse nome');
                }
                throw $erro;
            }
            Cargos::esquecer();
        }
        return Cargos::saida(Cargos::porId($cargo['id']) ?? $cargo);
    }

    /** @param array{cargo_id: int} $p */
    public static function apagarCargo(Requisicao $req, array $p): void
    {
        $eu = Auth::exigir($req, 'cargos.gerenciar');
        $cargo = Cargos::porId($p['cargo_id']) ?? throw ErroHttp::naoEncontrado('cargo nao encontrado');
        Hierarquia::exigirGerenciarCargo($eu, $cargo);
        if ($cargo['sistema']) {
            throw ErroHttp::proibido(Hierarquia::CARGO_DE_FABRICA);
        }
        Concorrencia::transacao(static function () use ($cargo): void {
            $total = (int) Banco::valor('SELECT COUNT(id) FROM atendentes WHERE cargo_id = ?' . Concorrencia::travando(), [$cargo['id']]);
            if ($total > 0) {
                throw ErroHttp::conflito(sprintf(
                    'cargo em uso por %d %s: mude o cargo antes de apagá-lo',
                    $total,
                    $total === 1 ? 'pessoa' : 'pessoas'
                ));
            }
            Banco::executar('DELETE FROM cargos WHERE id = ?', [$cargo['id']]);
        });
        Cargos::esquecer();
    }

    private static function nomeDeCargo(Validador $v, bool $obrigatorio): ?string
    {
        $nome = $v->texto('nome', min: 2, max: self::MAX_NOME_CARGO, obrigatorio: $obrigatorio, anulavel: false, aparar: true);
        return $nome === null ? null : Setores::espacos($nome);
    }

    private static function exigirNomeLivre(string $nome, ?int $exceto = null): void
    {
        $alvo = Setores::normalizar($nome);
        foreach (Cargos::todos() as $cargo) {
            if ($cargo['id'] !== $exceto && Setores::normalizar($cargo['nome']) === $alvo) {
                throw ErroHttp::conflito('ja existe um cargo com esse nome');
            }
        }
    }

    /**
     * Lista de chaves do catálogo (422 com a desconhecida). Sem repetição e
     * na ordem do catálogo.
     *
     * @return list<string>|null
     */
    private static function listaDePermissoes(Validador $v, bool $obrigatorio): ?array
    {
        $lista = $v->lista('permissoes', obrigatorio: $obrigatorio, padrao: null, anulavel: false, deTexto: true);
        if ($lista === null) {
            return null;
        }
        $desconhecidas = array_values(array_filter($lista, static fn (string $c): bool => !Permissoes::existe($c)));
        if ($desconhecidas !== []) {
            $v->falhar('permissoes', 'permissoes: permissão desconhecida: ' . implode(', ', array_slice($desconhecidas, 0, 5)));
            return null;
        }
        return Permissoes::ordenar($lista);
    }

    // ----------------------------------------------------------------- setores

    /** @return list<array<string, mixed>> */
    public static function listarSetores(Requisicao $req): array
    {
        Auth::atendente($req);
        $pessoas = Setores::pessoasAtivasPorSetor();
        return array_map(static fn (array $s): array => Setores::saida($s, $pessoas[$s['id']] ?? 0), Setores::todos());
    }

    /** @return array<string, mixed> */
    public static function criarSetor(Requisicao $req): array
    {
        Auth::exigir($req, 'setores.gerenciar');
        $v = Validador::corpo($req);
        $nome = $v->texto('nome', min: 2, max: Setores::MAX_NOME, aparar: true);
        $descricao = $v->texto('descricao', max: Setores::MAX_DESCRICAO, obrigatorio: false, aparar: true);
        $v->validar();
        return Setores::saida(Setores::criar((string) $nome, $descricao), 0);
    }

    /**
     * Renomear leva o nome novo às pessoas do setor (assinatura das próximas
     * mensagens) e à sala do chat. Desativar exige o setor sem ninguém ativo
     * e tira o setor padrão dos canais que o usavam (a conversa nova volta
     * para a fila geral em vez de cair numa fila que ninguém vê).
     *
     * @param array{setor_id: int} $p
     * @return array<string, mixed>
     */
    public static function atualizarSetor(Requisicao $req, array $p): array
    {
        Auth::exigir($req, 'setores.gerenciar');
        $v = Validador::corpo($req);
        $nome = $v->texto('nome', min: 2, max: Setores::MAX_NOME, obrigatorio: false, anulavel: false, aparar: true);
        $descricao = $v->texto('descricao', max: Setores::MAX_DESCRICAO, obrigatorio: false, aparar: true);
        $ativo = $v->booleano('ativo', obrigatorio: false, anulavel: false);
        $v->validar();
        $setor = Setores::porId($p['setor_id']) ?? throw ErroHttp::naoEncontrado('setor nao encontrado');
        $nome = $nome === null ? null : Setores::espacos($nome);

        Concorrencia::transacao(static function () use ($setor, $nome, $descricao, $ativo, $v): void {
            $mudancas = [];
            if ($nome !== null && $nome !== $setor['nome']) {
                if (Setores::porNome($nome, $setor['id']) !== null) {
                    throw ErroHttp::conflito('ja existe um setor com esse nome');
                }
                $mudancas['nome'] = $nome;
            }
            if ($v->tem('descricao')) {
                $mudancas['descricao'] = $descricao === null || $descricao === '' ? null : $descricao;
            }
            if ($ativo !== null && $ativo !== $setor['ativo']) {
                if (!$ativo) {
                    $pessoas = (int) Banco::valor(
                        'SELECT COUNT(id) FROM atendentes WHERE ativo = 1 AND setor_id = ?' . Concorrencia::travando(),
                        [$setor['id']]
                    );
                    if ($pessoas > 0) {
                        throw ErroHttp::conflito('setor com pessoas ativas: mova-as para outro setor antes de desativá-lo');
                    }
                    Banco::executar('UPDATE canais SET setor_padrao_id = NULL WHERE setor_padrao_id = ?', [$setor['id']]);
                }
                $mudancas['ativo'] = $ativo;
            }
            if ($mudancas === []) {
                return;
            }
            try {
                Banco::atualizar('setores', $mudancas, 'id = ?', [$setor['id']]);
            } catch (\PDOException $erro) {
                if (Banco::eUnicidade($erro)) {
                    throw ErroHttp::conflito('ja existe um setor com esse nome');
                }
                throw $erro;
            }
            if (isset($mudancas['nome'])) {
                Banco::executar('UPDATE atendentes SET setor = ? WHERE setor_id = ?', [$mudancas['nome'], $setor['id']]);
            }
        });
        Salas::sincronizarSemFalhar(); // a sala do setor acompanha o nome novo
        return Setores::saida(Setores::porId($setor['id']) ?? $setor);
    }

    /**
     * Só apaga o setor que ninguém usa (pessoa, mesmo inativa, conversa ou
     * canal): o que já foi usado é desativado, e o histórico continua
     * apontando para ele.
     *
     * @param array{setor_id: int} $p
     */
    public static function apagarSetor(Requisicao $req, array $p): void
    {
        Auth::exigir($req, 'setores.gerenciar');
        $setor = Setores::porId($p['setor_id']) ?? throw ErroHttp::naoEncontrado('setor nao encontrado');
        Concorrencia::transacao(static function () use ($setor): void {
            $travando = Concorrencia::travando();
            $usos = (int) Banco::valor('SELECT COUNT(id) FROM atendentes WHERE setor_id = ?' . $travando, [$setor['id']])
                + (int) Banco::valor('SELECT COUNT(id) FROM conversas WHERE setor_id = ?', [$setor['id']])
                + (int) Banco::valor('SELECT COUNT(id) FROM canais WHERE setor_padrao_id = ?', [$setor['id']]);
            if ($usos > 0) {
                throw ErroHttp::conflito('setor em uso: desative-o em vez de apagar');
            }
            // a sala antiga do setor (sem membros: ninguém tem o setor) fica
            // como histórico, desligada do id que deixa de existir
            Banco::executar(
                "UPDATE interno_salas SET setor_id = NULL, chave = ? WHERE tipo = 'setor' AND setor_id = ?",
                ['setor:apagado:' . $setor['id'], $setor['id']]
            );
            Banco::executar('DELETE FROM setores WHERE id = ?', [$setor['id']]);
        });
    }
}

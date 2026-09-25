<?php
declare(strict_types=1);

namespace IHchat\ChatInterno;

use IHchat\Auth\Auth;
use IHchat\Nucleo\Requisicao;
use IHchat\Nucleo\Roteador;
use IHchat\Nucleo\Validador;

/**
 * Chat interno da equipe: /api/interno/... (mesmo contrato de app/api/chat_interno.py).
 *
 *   GET    /api/interno/salas                       salas de quem pede (não lidas, última mensagem)
 *   GET    /api/interno/salas/{id}                  detalhe com os membros
 *   PATCH  /api/interno/salas/{id}                  silenciada; no grupo, nome/adicionar/remover
 *   POST   /api/interno/salas/{id}/sair             sai do grupo (204)
 *   GET    /api/interno/salas/{id}/mensagens        ?antes=<id>&limite=<n>
 *   POST   /api/interno/salas/{id}/mensagens        {conteudo, conversa_id?} -> 201
 *   POST   /api/interno/salas/{id}/lida             {ate?}
 *   PATCH  /api/interno/mensagens/{id}              {conteudo} (só quem escreveu)
 *   DELETE /api/interno/mensagens/{id}              vira "mensagem apagada"
 *   POST   /api/interno/grupos                      {nome, membros} -> 201
 *   POST   /api/interno/diretas                     {atendente_id}
 *
 * Toda rota confere o login, depois sincroniza Geral e setores (Salas::sincronizar)
 * e só então olha a sala: quem não é membro recebe 404.
 */
final class Rotas
{
    /** O teto de id do Python (18 dígitos): maior que isso é 422 nos dois. */
    private const MAIOR_ID = 999999999999999999;

    public static function registrar(Roteador $r): void
    {
        $r->get('/api/interno/salas', [self::class, 'listarSalas']);
        $r->get('/api/interno/salas/{sala_id:int}', [self::class, 'obterSala']);
        $r->patch('/api/interno/salas/{sala_id:int}', [self::class, 'alterarSala']);
        $r->post('/api/interno/salas/{sala_id:int}/sair', [self::class, 'sair'], status: 204);
        $r->get('/api/interno/salas/{sala_id:int}/mensagens', [self::class, 'listarMensagens']);
        $r->post('/api/interno/salas/{sala_id:int}/mensagens', [self::class, 'enviar'], status: 201);
        $r->post('/api/interno/salas/{sala_id:int}/lida', [self::class, 'marcarLida']);
        $r->patch('/api/interno/mensagens/{mensagem_id:int}', [self::class, 'editar']);
        $r->delete('/api/interno/mensagens/{mensagem_id:int}', [self::class, 'apagar']);
        $r->post('/api/interno/grupos', [self::class, 'criarGrupo'], status: 201);
        $r->post('/api/interno/diretas', [self::class, 'abrirDireta']);
    }

    /** @return array<string, mixed> o atendente, com Geral e setores já em dia */
    private static function entrar(Requisicao $req): array
    {
        $eu = Auth::atendente($req);
        Salas::sincronizar();
        return $eu;
    }

    /** @return list<array<string, mixed>> */
    public static function listarSalas(Requisicao $req): array
    {
        return Salas::listar(self::entrar($req));
    }

    /**
     * @param array{sala_id: int} $p
     * @return array<string, mixed>
     */
    public static function obterSala(Requisicao $req, array $p): array
    {
        $eu = self::entrar($req);
        return Salas::detalhe(Salas::exigir($p['sala_id'], $eu), $eu);
    }

    /**
     * @param array{sala_id: int} $p
     * @return array<string, mixed>
     */
    public static function alterarSala(Requisicao $req, array $p): array
    {
        $eu = self::entrar($req);
        $v = Validador::corpo($req);
        $silenciada = $v->booleano('silenciada', obrigatorio: false);
        $nome = $v->texto('nome', max: 200, obrigatorio: false);
        $adicionar = self::listaDeIds($v, 'adicionar');
        $remover = self::listaDeIds($v, 'remover');
        $v->validar();
        $sala = Salas::exigir($p['sala_id'], $eu);
        return Salas::alterar($sala, $eu, [
            'silenciada' => $silenciada,
            'nome' => $nome,
            'adicionar' => $adicionar,
            'remover' => $remover,
        ]);
    }

    /** @param array{sala_id: int} $p */
    public static function sair(Requisicao $req, array $p): void
    {
        $eu = self::entrar($req);
        Salas::sair(Salas::exigir($p['sala_id'], $eu), $eu);
    }

    /**
     * @param array{sala_id: int} $p
     * @return array{mensagens: list<array<string, mixed>>, tem_mais: bool}
     */
    public static function listarMensagens(Requisicao $req, array $p): array
    {
        $eu = self::entrar($req);
        $q = Validador::consulta($req);
        $antes = $q->inteiro('antes', obrigatorio: false, minimo: 1, maximo: self::MAIOR_ID);
        $limite = $q->inteiro('limite', obrigatorio: false, padrao: Mensagens::LIMITE_PADRAO, minimo: 1, maximo: Mensagens::LIMITE_MAXIMO);
        $q->validar();
        $sala = Salas::exigir($p['sala_id'], $eu);
        return Mensagens::pagina((int) $sala['id'], $antes, (int) $limite);
    }

    /**
     * @param array{sala_id: int} $p
     * @return array<string, mixed>
     */
    public static function enviar(Requisicao $req, array $p): array
    {
        $eu = self::entrar($req);
        $v = Validador::corpo($req);
        $conteudo = $v->texto('conteudo', max: Mensagens::MAX_CONTEUDO, obrigatorio: false, padrao: '', anulavel: false);
        $conversaId = $v->inteiro('conversa_id', obrigatorio: false, minimo: 1, maximo: self::MAIOR_ID);
        $v->validar();
        $sala = Salas::exigir($p['sala_id'], $eu);
        return Mensagens::enviar($sala, $eu, $conteudo, $conversaId);
    }

    /**
     * @param array{sala_id: int} $p
     * @return array{sala_id: int, lida_ate: int, nao_lidas: int}
     */
    public static function marcarLida(Requisicao $req, array $p): array
    {
        $eu = self::entrar($req);
        $v = Validador::corpo($req, obrigatorio: false);
        $ate = $v->inteiro('ate', obrigatorio: false, minimo: 0, maximo: self::MAIOR_ID);
        $v->validar();
        $sala = Salas::exigir($p['sala_id'], $eu);
        return Mensagens::marcarLida($sala, $eu, $ate);
    }

    /**
     * @param array{mensagem_id: int} $p
     * @return array<string, mixed>
     */
    public static function editar(Requisicao $req, array $p): array
    {
        $eu = self::entrar($req);
        $v = Validador::corpo($req);
        $conteudo = $v->texto('conteudo', max: Mensagens::MAX_CONTEUDO);
        $v->validar();
        [$mensagem] = Mensagens::exigir($p['mensagem_id'], $eu);
        return Mensagens::editar($mensagem, $eu, (string) $conteudo);
    }

    /**
     * @param array{mensagem_id: int} $p
     * @return array<string, mixed>
     */
    public static function apagar(Requisicao $req, array $p): array
    {
        $eu = self::entrar($req);
        [$mensagem] = Mensagens::exigir($p['mensagem_id'], $eu);
        return Mensagens::apagar($mensagem, $eu);
    }

    /** @return array<string, mixed> */
    public static function criarGrupo(Requisicao $req): array
    {
        $eu = self::entrar($req);
        $v = Validador::corpo($req);
        $nome = $v->texto('nome', max: 200);
        $membros = self::listaDeIds($v, 'membros') ?? [];
        $v->validar();
        return Salas::criarGrupo($eu, (string) $nome, $membros);
    }

    /** @return array<string, mixed> */
    public static function abrirDireta(Requisicao $req): array
    {
        $eu = self::entrar($req);
        $v = Validador::corpo($req);
        $outro = $v->inteiro('atendente_id', minimo: 1, maximo: self::MAIOR_ID);
        $v->validar();
        return Salas::abrirDireta($eu, (int) $outro);
    }

    /**
     * Lista de ids de atendente (como list[int] do pydantic: aceita 5, 5.0 e
     * "5"); ausente ou null devolve null. No máximo Salas::MAX_MEMBROS.
     *
     * @return list<int>|null
     */
    private static function listaDeIds(Validador $v, string $campo): ?array
    {
        $lista = $v->lista($campo, obrigatorio: false, padrao: null);
        if ($lista === null) {
            return null;
        }
        if (count($lista) > Salas::MAX_MEMBROS) {
            $v->falhar($campo, "{$campo}: no máximo " . Salas::MAX_MEMBROS . ' atendentes', 'too_long');
            return null;
        }
        $ids = [];
        foreach ($lista as $item) {
            $numero = null;
            if (is_int($item)) {
                $numero = $item;
            } elseif (is_float($item) && floor($item) === $item && abs($item) < PHP_INT_MAX) {
                $numero = (int) $item;
            } elseif (is_string($item) && preg_match('/^\s*\+?\d{1,18}\s*$/', $item) === 1) {
                $numero = (int) trim($item);
            }
            if ($numero === null || $numero < 1 || $numero > self::MAIOR_ID) {
                $v->falhar($campo, "{$campo}: cada item precisa ser o id (número inteiro positivo) de um atendente");
                return null;
            }
            $ids[] = $numero;
        }
        return $ids;
    }
}

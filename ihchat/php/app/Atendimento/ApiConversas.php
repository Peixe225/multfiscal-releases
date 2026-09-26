<?php
declare(strict_types=1);

namespace IHchat\Atendimento;

use IHchat\Auth\Atendentes;
use IHchat\Auth\Auth;
use IHchat\Auth\Permissoes;
use IHchat\Banco\Banco;
use IHchat\Equipe\Setores;
use IHchat\Nucleo\ErroHttp;
use IHchat\Nucleo\Requisicao;
use IHchat\Nucleo\Validador;

/**
 * Caixa de entrada unificada: listagem, leitura e resposta (app/api/conversas.py).
 *
 * O token é conferido ANTES de procurar a conversa, e a conversa que a pessoa
 * não pode ver (Visibilidade) responde o mesmo 404 da inexistente: ninguém
 * enumera ids nem descobre conversas de outro setor. Por cima disso, cada
 * ação pede a sua permissão: transferir (conversas.transferir), resolver
 * (conversas.resolver) e reabrir (conversas.reabrir).
 */
final class ApiConversas
{
    /** @return list<array<string, mixed>> */
    public static function listar(Requisicao $req): array
    {
        $eu = Auth::atendente($req);
        $v = Validador::consulta($req);
        $filtros = [
            'status' => $v->opcao('status', Conversas::STATUS, obrigatorio: false),
            'atendente' => $v->texto('atendente', obrigatorio: false),
            'canal_id' => $v->inteiro('canal_id', obrigatorio: false),
            'setor_id' => $v->inteiro('setor_id', obrigatorio: false),
            'etiqueta_id' => $v->inteiro('etiqueta_id', obrigatorio: false),
            'q' => $v->texto('q', obrigatorio: false),
            'limite' => $v->inteiro('limite', obrigatorio: false, padrao: 50, maximo: 200),
            'deslocamento' => $v->inteiro('deslocamento', obrigatorio: false, padrao: 0, minimo: 0),
        ];
        $v->validar();
        return Conversas::listar($filtros, $eu);
    }

    /**
     * Abrir a conversa zera as não lidas.
     *
     * @param array{conversa_id: int} $p
     * @return array<string, mixed> ConversaDetalhe
     */
    public static function obter(Requisicao $req, array $p): array
    {
        $eu = Auth::atendente($req);
        Visibilidade::exigir($eu, $p['conversa_id']);
        Conversas::marcarLida($p['conversa_id']);
        return Saidas::conversaDetalhe($p['conversa_id']) ?? throw ErroHttp::naoEncontrado('conversa nao encontrada');
    }

    /**
     * @param array{conversa_id: int} $p
     * @return array<string, mixed> MensagemSaida
     */
    public static function responder(Requisicao $req, array $p): array
    {
        $eu = Auth::atendente($req);
        Visibilidade::exigir($eu, $p['conversa_id']);
        $conteudo = self::conteudo($req);
        return Mensagens::enviarMensagem($p['conversa_id'], $conteudo, $eu);
    }

    /**
     * @param array{conversa_id: int} $p
     * @return array<string, mixed> MensagemSaida
     */
    public static function anotar(Requisicao $req, array $p): array
    {
        $eu = Auth::atendente($req);
        Visibilidade::exigir($eu, $p['conversa_id']);
        $conteudo = self::conteudo($req);
        return Mensagens::registrarNota($p['conversa_id'], $conteudo, $eu);
    }

    /**
     * @param array{conversa_id: int} $p
     * @return array<string, mixed> ConversaSaida
     */
    /**
     * {atendente_id?, setor_id?}: atribui a uma pessoa e/ou transfere para a
     * fila de um setor. Sem setor_id, a conversa acompanha a pessoa escolhida
     * (vai para o setor dela). Com os dois, a pessoa precisa ser do setor.
     *
     * Sem conversas.transferir, só dá para PEGAR da fila para si (a conversa
     * sem ninguém que a pessoa vê) e DEVOLVER a sua à fila; o resto é 403.
     *
     * @param array{conversa_id: int} $p
     * @return array<string, mixed> ConversaSaida
     */
    public static function atribuir(Requisicao $req, array $p): array
    {
        $eu = Auth::atendente($req);
        $conversa = Visibilidade::exigir($eu, $p['conversa_id']);
        $v = Validador::corpo($req);
        $destinoId = $v->inteiro('atendente_id', obrigatorio: false);
        $setorId = $v->inteiro('setor_id', obrigatorio: false, minimo: 1);
        $v->validar();
        $setorAtual = Saidas::inteiroOuNulo($conversa['setor_id'] ?? null);
        $setorExplicito = $v->tem('setor_id');
        // a permissão vem antes de procurar pessoa e setor: quem não pode
        // transferir recebe 403, não descobre quem ou o que existe
        if (!Permissoes::tem($eu, 'conversas.transferir')) {
            $euId = (int) $eu['id'];
            $atual = Saidas::inteiroOuNulo($conversa['atendente_id'] ?? null);
            $pegar = $destinoId === $euId && ($atual === null || $atual === $euId);
            $devolver = $destinoId === null && $atual === $euId;
            if (!($pegar || $devolver) || ($setorExplicito && $setorId !== $setorAtual)) {
                throw ErroHttp::proibido(Permissoes::mensagem('conversas.transferir'));
            }
        }
        $destino = null;
        if ($destinoId !== null) {
            $destino = Atendentes::porId($destinoId) ?? throw ErroHttp::naoEncontrado('atendente nao encontrado');
            if (!$destino['ativo']) {
                throw ErroHttp::invalido('pessoa desativada não recebe conversas');
            }
        }
        $setorNovo = null;
        $mudaSetor = false;
        if ($setorExplicito) {
            if ($setorId !== null) {
                $setorNovo = Setores::porId($setorId) ?? throw ErroHttp::naoEncontrado('setor nao encontrado');
                if (!$setorNovo['ativo'] && $setorNovo['id'] !== $setorAtual) {
                    throw ErroHttp::invalido('setor inativo: reative-o ou escolha outro');
                }
            }
            $mudaSetor = ($setorNovo['id'] ?? null) !== $setorAtual;
            if ($destino !== null && $setorNovo !== null && $destino['setor_id'] !== $setorNovo['id']) {
                throw ErroHttp::invalido('a pessoa escolhida não é do setor escolhido');
            }
        } elseif ($destino !== null && $destino['setor_id'] !== null && $destino['setor_id'] !== $setorAtual) {
            // a conversa acompanha a pessoa: entra no setor dela
            $setorNovo = Setores::porId($destino['setor_id']);
            $mudaSetor = $setorNovo !== null;
        }

        return Banco::transacao(static function () use ($p, $destino, $eu, $setorNovo, $mudaSetor): array {
            Conversas::atribuir($p['conversa_id'], $destino, $eu, $setorNovo, $mudaSetor);
            return Conversas::publicar($p['conversa_id']) ?? [];
        });
    }

    /**
     * @param array{conversa_id: int} $p
     * @return array<string, mixed> ConversaSaida
     */
    public static function mudarStatus(Requisicao $req, array $p): array
    {
        $eu = Auth::atendente($req);
        $conversa = Visibilidade::exigir($eu, $p['conversa_id']);
        $v = Validador::corpo($req);
        $status = (string) $v->opcao('status', Conversas::STATUS);
        $v->validar();
        // aberta <-> pendente é trabalho do dia a dia; fechar e reabrir pedem permissão
        if ($status === 'resolvida') {
            Permissoes::exigir($eu, 'conversas.resolver');
        } elseif ($conversa['status'] === 'resolvida') {
            Permissoes::exigir($eu, 'conversas.reabrir');
        }
        return Banco::transacao(static function () use ($p, $status, $eu): array {
            Conversas::mudarStatus($p['conversa_id'], $status, $eu);
            return Conversas::publicar($p['conversa_id']) ?? [];
        });
    }

    /**
     * @param array{conversa_id: int} $p
     * @return array<string, mixed> ConversaSaida
     */
    public static function mudarPrioridade(Requisicao $req, array $p): array
    {
        $eu = Auth::atendente($req);
        Visibilidade::exigir($eu, $p['conversa_id']);
        $v = Validador::corpo($req);
        $prioridade = (string) $v->opcao('prioridade', Conversas::PRIORIDADES);
        $v->validar();
        return Banco::transacao(static function () use ($p, $prioridade): array {
            Conversas::mudarPrioridade($p['conversa_id'], $prioridade);
            return Conversas::publicar($p['conversa_id']) ?? [];
        });
    }

    /**
     * @param array{conversa_id: int} $p
     * @return array<string, mixed> ConversaSaida
     */
    public static function marcarEtiqueta(Requisicao $req, array $p): array
    {
        $eu = Auth::atendente($req);
        Visibilidade::exigir($eu, $p['conversa_id']);
        $v = Validador::corpo($req);
        $etiquetaId = (int) $v->inteiro('etiqueta_id');
        $v->validar();
        if (Banco::valor('SELECT id FROM etiquetas WHERE id = ?', [$etiquetaId]) === null) {
            throw ErroHttp::naoEncontrado('etiqueta nao encontrada');
        }
        return Banco::transacao(static function () use ($p, $etiquetaId): array {
            Conversas::etiquetar($p['conversa_id'], $etiquetaId);
            return Conversas::publicar($p['conversa_id']) ?? [];
        });
    }

    /**
     * @param array{conversa_id: int, etiqueta_id: int} $p
     * @return array<string, mixed> ConversaSaida
     */
    public static function desmarcarEtiqueta(Requisicao $req, array $p): array
    {
        $eu = Auth::atendente($req);
        Visibilidade::exigir($eu, $p['conversa_id']);
        return Banco::transacao(static function () use ($p): array {
            Conversas::desetiquetar($p['conversa_id'], $p['etiqueta_id']);
            return Conversas::publicar($p['conversa_id']) ?? [];
        });
    }

    /**
     * @param array{conversa_id: int} $p
     * @return array<string, mixed> ConversaSaida
     */
    public static function ler(Requisicao $req, array $p): array
    {
        $eu = Auth::atendente($req);
        Visibilidade::exigir($eu, $p['conversa_id']);
        return Banco::transacao(static function () use ($p): array {
            Conversas::marcarLida($p['conversa_id']);
            return Conversas::publicar($p['conversa_id']) ?? [];
        });
    }

    /**
     * MensagemEntrada: conteudo de 1 a 8000 caracteres, gravado sem espaços
     * nas pontas. Só espaços é recusado (seria uma mensagem vazia ao
     * provedor, que a recusa); o Python mede do mesmo jeito (TextoDeMensagem).
     */
    private static function conteudo(Requisicao $req): string
    {
        $v = Validador::corpo($req);
        $conteudo = $v->texto('conteudo', min: 1, max: 8000, aparar: true);
        $v->validar();
        return trim((string) $conteudo);
    }
}

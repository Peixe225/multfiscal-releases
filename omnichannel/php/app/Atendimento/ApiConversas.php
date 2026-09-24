<?php
declare(strict_types=1);

namespace OmniChannel\Atendimento;

use OmniChannel\Auth\Atendentes;
use OmniChannel\Auth\Auth;
use OmniChannel\Banco\Banco;
use OmniChannel\Nucleo\ErroHttp;
use OmniChannel\Nucleo\Requisicao;
use OmniChannel\Nucleo\Validador;

/**
 * Caixa de entrada unificada: listagem, leitura e resposta (app/api/conversas.py).
 *
 * Diferença deliberada do Python: o token é conferido ANTES de procurar a
 * conversa (o FastAPI resolve a conversa primeiro e responde 404 a quem nem
 * mandou token, o que revela quais ids existem).
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
            'etiqueta_id' => $v->inteiro('etiqueta_id', obrigatorio: false),
            'q' => $v->texto('q', obrigatorio: false),
            'limite' => $v->inteiro('limite', obrigatorio: false, padrao: 50, maximo: 200),
            'deslocamento' => $v->inteiro('deslocamento', obrigatorio: false, padrao: 0, minimo: 0),
        ];
        $v->validar();
        return Conversas::listar($filtros, (int) $eu['id']);
    }

    /**
     * Abrir a conversa zera as não lidas.
     *
     * @param array{conversa_id: int} $p
     * @return array<string, mixed> ConversaDetalhe
     */
    public static function obter(Requisicao $req, array $p): array
    {
        Auth::atendente($req);
        Conversas::exigir($p['conversa_id']);
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
        Conversas::exigir($p['conversa_id']);
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
        Conversas::exigir($p['conversa_id']);
        $conteudo = self::conteudo($req);
        return Mensagens::registrarNota($p['conversa_id'], $conteudo, $eu);
    }

    /**
     * @param array{conversa_id: int} $p
     * @return array<string, mixed> ConversaSaida
     */
    public static function atribuir(Requisicao $req, array $p): array
    {
        $eu = Auth::atendente($req);
        Conversas::exigir($p['conversa_id']);
        $v = Validador::corpo($req);
        $destinoId = $v->inteiro('atendente_id', obrigatorio: false);
        $v->validar();
        $destino = null;
        if ($destinoId !== null) {
            $destino = Atendentes::porId($destinoId) ?? throw ErroHttp::naoEncontrado('atendente nao encontrado');
        }
        return Banco::transacao(static function () use ($p, $destino, $eu): array {
            Conversas::atribuir($p['conversa_id'], $destino, $eu);
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
        Conversas::exigir($p['conversa_id']);
        $v = Validador::corpo($req);
        $status = (string) $v->opcao('status', Conversas::STATUS);
        $v->validar();
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
        Auth::atendente($req);
        Conversas::exigir($p['conversa_id']);
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
        Auth::atendente($req);
        Conversas::exigir($p['conversa_id']);
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
        Auth::atendente($req);
        Conversas::exigir($p['conversa_id']);
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
        Auth::atendente($req);
        Conversas::exigir($p['conversa_id']);
        return Banco::transacao(static function () use ($p): array {
            Conversas::marcarLida($p['conversa_id']);
            return Conversas::publicar($p['conversa_id']) ?? [];
        });
    }

    /**
     * MensagemEntrada: conteudo de 1 a 8000 caracteres, gravado sem espaços
     * nas pontas. Só espaços é recusado (o Python aceitaria e mandaria uma
     * mensagem vazia ao provedor, que a recusa).
     */
    private static function conteudo(Requisicao $req): string
    {
        $v = Validador::corpo($req);
        $conteudo = $v->texto('conteudo', min: 1, max: 8000, aparar: true);
        $v->validar();
        return trim((string) $conteudo);
    }
}

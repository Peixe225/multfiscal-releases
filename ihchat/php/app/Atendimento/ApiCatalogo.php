<?php
declare(strict_types=1);

namespace IHchat\Atendimento;

use IHchat\Auth\Auth;
use IHchat\Banco\Banco;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\ErroHttp;
use IHchat\Nucleo\Requisicao;
use IHchat\Nucleo\Validador;

/** Etiquetas e respostas rápidas (app/api/catalogo.py). */
final class ApiCatalogo
{
    /** @return list<array<string, mixed>> */
    public static function listarEtiquetas(Requisicao $req): array
    {
        Auth::atendente($req);
        return array_map([Saidas::class, 'etiqueta'], Banco::todos('SELECT * FROM etiquetas ORDER BY nome, id'));
    }

    /** @return array<string, mixed> */
    public static function criarEtiqueta(Requisicao $req): array
    {
        Auth::atendente($req);
        $v = Validador::corpo($req);
        $nome = (string) $v->texto('nome', min: 1, max: 60);
        $cor = $v->texto('cor', max: 9, obrigatorio: false, padrao: '#6b7cff', anulavel: false);
        $v->validar();
        if (Banco::valor('SELECT id FROM etiquetas WHERE LOWER(nome) = ?', [mb_strtolower($nome)]) !== null) {
            throw ErroHttp::conflito('ja existe uma etiqueta com esse nome');
        }
        try {
            $id = Banco::inserir('etiquetas', ['nome' => $nome, 'cor' => $cor]);
        } catch (\PDOException $erro) {
            if (Banco::eUnicidade($erro)) {
                throw ErroHttp::conflito('ja existe uma etiqueta com esse nome');
            }
            throw $erro;
        }
        return ['id' => $id, 'nome' => $nome, 'cor' => (string) $cor];
    }

    /** @param array{etiqueta_id: int} $p */
    public static function removerEtiqueta(Requisicao $req, array $p): void
    {
        Auth::atendente($req);
        Banco::transacao(static function () use ($p): void {
            if (Banco::executar('DELETE FROM etiquetas WHERE id = ?', [$p['etiqueta_id']]) === 0) {
                throw ErroHttp::naoEncontrado('etiqueta nao encontrada');
            }
            // o ON DELETE CASCADE já tira a etiqueta das conversas; esta linha
            // só garante o mesmo num MySQL sem chaves estrangeiras (MyISAM)
            Banco::executar('DELETE FROM conversa_etiqueta WHERE etiqueta_id = ?', [$p['etiqueta_id']]);
        });
    }

    /** @return list<array<string, mixed>> */
    public static function listarRespostas(Requisicao $req): array
    {
        Auth::atendente($req);
        return array_map([Saidas::class, 'respostaRapida'], Banco::todos('SELECT * FROM respostas_rapidas ORDER BY atalho, id'));
    }

    /** @return array<string, mixed> */
    public static function criarResposta(Requisicao $req): array
    {
        Auth::atendente($req);
        $v = Validador::corpo($req);
        $atalho = $v->texto('atalho', min: 1, max: 40);
        $titulo = $v->texto('titulo', min: 1, max: 120);
        $conteudo = $v->texto('conteudo', min: 1, max: 4000);
        // o painel digita "/bomdia"; guardamos "bomdia"
        $atalho = $atalho === null ? null : ltrim(trim($atalho), '/');
        if ($atalho === '') {
            $v->falhar('atalho', 'atalho: não pode ficar vazio');
        }
        $v->validar();
        if (Banco::valor('SELECT id FROM respostas_rapidas WHERE atalho = ?', [$atalho]) !== null) {
            throw ErroHttp::conflito('ja existe uma resposta com esse atalho');
        }
        try {
            $id = Banco::inserir('respostas_rapidas', [
                'atalho' => $atalho, 'titulo' => $titulo, 'conteudo' => $conteudo, 'criada_em' => Datas::agoraBanco(),
            ]);
        } catch (\PDOException $erro) {
            if (Banco::eUnicidade($erro)) {
                throw ErroHttp::conflito('ja existe uma resposta com esse atalho');
            }
            throw $erro;
        }
        return ['id' => $id, 'atalho' => (string) $atalho, 'titulo' => (string) $titulo, 'conteudo' => (string) $conteudo];
    }

    /** @param array{resposta_id: int} $p */
    public static function removerResposta(Requisicao $req, array $p): void
    {
        Auth::atendente($req);
        if (Banco::executar('DELETE FROM respostas_rapidas WHERE id = ?', [$p['resposta_id']]) === 0) {
            throw ErroHttp::naoEncontrado('resposta nao encontrada');
        }
    }

    /** @return array<string, mixed> MetricasSaida */
    public static function metricas(Requisicao $req): array
    {
        Auth::atendente($req);
        return Metricas::resumo();
    }
}

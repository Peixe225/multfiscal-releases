<?php
declare(strict_types=1);

namespace IHchat\Widget;

use IHchat\Banco\Banco;
use IHchat\Nucleo\Datas;

/**
 * Sessões do widget que nunca mandaram nada.
 *
 * Cada "Começar conversa" cria um contato, uma identidade e uma sessão. Quem
 * abriu e desistiu (ou um robô abrindo sessões em laço) deixaria o painel
 * cheio de "Visitante do site" sem conversa nenhuma. Passado um dia, a
 * sessão sem mensagem sai, e o contato que ela criou também, se continua
 * intocado: sem conversa, sem outra sessão, sem identidade de outro canal e
 * sem dado que a equipe tenha preenchido.
 *
 * Roda de vez em quando ao abrir sessão (Rotas::abrirSessao) e pode rodar
 * pelo cron (executar()).
 */
final class Faxina
{
    public const HORAS = 24;
    private const LOTE = 500;

    /** Para o cron: devolve o resumo do que fez. */
    public static function executar(): string
    {
        [$sessoes, $contatos] = self::limpar();
        return "sessões do widget sem mensagem removidas: {$sessoes}; contatos vazios removidos: {$contatos}";
    }

    /** @return array{0: int, 1: int} sessões e contatos removidos */
    public static function limpar(float $horas = self::HORAS): array
    {
        $paradas = Banco::todos(
            'SELECT s.token, s.contato_id FROM sessoes_widget s
             WHERE s.criada_em < ?
               AND NOT EXISTS (SELECT 1 FROM conversas c WHERE c.contato_id = s.contato_id)
             ORDER BY s.criada_em LIMIT ' . self::LOTE,
            [Datas::haHoras($horas)]
        );
        $sessoes = 0;
        $contatos = 0;
        foreach ($paradas as $sessao) {
            [$s, $c] = Banco::transacao(static function () use ($sessao): array {
                $s = Banco::executar('DELETE FROM sessoes_widget WHERE token = ?', [(string) $sessao['token']]);
                $contatoId = (int) $sessao['contato_id'];
                $intocado = Banco::valor(
                    "SELECT COUNT(*) FROM contatos k
                     WHERE k.id = ?
                       AND k.email IS NULL AND k.telefone IS NULL AND k.documento IS NULL AND k.empresa IS NULL
                       AND NOT EXISTS (SELECT 1 FROM conversas c WHERE c.contato_id = k.id)
                       AND NOT EXISTS (SELECT 1 FROM sessoes_widget w WHERE w.contato_id = k.id)
                       AND NOT EXISTS (SELECT 1 FROM contato_identidades i WHERE i.contato_id = k.id AND i.canal_tipo <> 'webchat')",
                    [$contatoId]
                );
                $c = 0;
                if ((int) $intocado === 1) {
                    Banco::executar('DELETE FROM contato_identidades WHERE contato_id = ?', [$contatoId]);
                    $c = Banco::executar('DELETE FROM contatos WHERE id = ?', [$contatoId]);
                }
                return [$s, $c];
            });
            $sessoes += $s;
            $contatos += $c;
        }
        return [$sessoes, $contatos];
    }
}

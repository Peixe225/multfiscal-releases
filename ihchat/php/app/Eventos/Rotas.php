<?php
declare(strict_types=1);

namespace IHchat\Eventos;

use IHchat\Auth\Auth;
use IHchat\Nucleo\Requisicao;
use IHchat\Nucleo\Roteador;
use IHchat\Nucleo\Validador;

/**
 * GET /api/eventos/desde?depois=<id>&limite=<n>
 *
 * Token pelo cabeçalho Authorization OU por ?token= (mesma regra dos arquivos).
 * Sem "depois": devolve só o cursor atual, para a tela começar "de agora".
 * Resposta: {"eventos": [{"id", "tipo", "dados"}], "ultimo": <id>}; o cliente
 * manda de volta "ultimo" como "depois" na próxima consulta. Os eventos do
 * chat interno só chegam a membros da sala (Eventos::doMembro).
 */
final class Rotas
{
    public static function registrar(Roteador $r): void
    {
        $r->get('/api/eventos/desde', [self::class, 'desde']);
    }

    /** @return array{eventos: list<array<string, mixed>>, ultimo: int} */
    public static function desde(Requisicao $req): array
    {
        $eu = Auth::atendenteDeArquivo($req);
        [$depois, $limite] = self::cursor($req);
        // o chat interno ("interno.*") só sai para membros da sala
        return Eventos::desde($depois, $limite, (int) $eu['id']);
    }

    /**
     * Lê depois/limite da query (reusado pela rota do widget).
     *
     * @return array{0: ?int, 1: int}
     */
    public static function cursor(Requisicao $req): array
    {
        $q = Validador::consulta($req);
        $depois = $q->inteiro('depois', obrigatorio: false, minimo: 0);
        $limite = $q->inteiro('limite', obrigatorio: false, padrao: Eventos::LIMITE_PADRAO, minimo: 1, maximo: Eventos::LIMITE_MAXIMO);
        $q->validar();
        return [$depois, (int) $limite];
    }
}

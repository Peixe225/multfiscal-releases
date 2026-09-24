<?php
declare(strict_types=1);

namespace IHchat\Nucleo;

/**
 * CORS só onde um site de terceiros precisa: o widget (widget.js,
 * /api/widget/* e o /saude, que diz ao widget se o tempo real é por consulta
 * ou por fluxo). O painel é servido na mesma origem da API e não precisa;
 * liberar CORS nele só aumentaria a superfície de ataque.
 *
 * Mesmo comportamento do CORSMiddleware do Starlette (allow_credentials=False):
 * origem "*" quando configurado, preflight 200 com métodos e cabeçalhos.
 */
final class Cors
{
    private const METODOS = 'DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT';

    public static function aplica(string $caminho): bool
    {
        // sem o /saude, o widget colado em outro site não descobria o modo de
        // tempo real e parava de receber respostas ao voltar de outra aba
        return $caminho === '/widget.js' || $caminho === '/saude' || str_starts_with($caminho, '/api/widget/');
    }

    public static function ePreflight(Requisicao $req): bool
    {
        return $req->metodo === 'OPTIONS'
            && $req->origem() !== null
            && $req->cabecalho('access-control-request-method') !== null;
    }

    public static function preflight(Requisicao $req): Resposta
    {
        $origem = self::origemPermitida($req->origem());
        if ($origem === null) {
            return Resposta::texto('Disallowed CORS origin', 400);
        }
        $resposta = Resposta::texto('OK', 200);
        $resposta->cabecalho('Access-Control-Allow-Origin', $origem);
        $resposta->cabecalho('Access-Control-Allow-Methods', self::METODOS);
        $pedidos = $req->cabecalho('access-control-request-headers');
        if ($pedidos !== null && $pedidos !== '') {
            $resposta->cabecalho('Access-Control-Allow-Headers', $pedidos);
        }
        $resposta->cabecalho('Access-Control-Max-Age', '600');
        if ($origem !== '*') {
            $resposta->cabecalho('Vary', 'Origin');
        }
        return $resposta;
    }

    /** Acrescenta os cabeçalhos numa resposta comum (inclusive de erro). */
    public static function decorar(Requisicao $req, Resposta $resposta): void
    {
        $origem = self::origemPermitida($req->origem());
        if ($origem === null) {
            return;
        }
        $resposta->cabecalho('Access-Control-Allow-Origin', $origem);
        if ($origem !== '*') {
            $resposta->cabecalho('Vary', 'Origin');
        }
    }

    private static function origemPermitida(?string $origem): ?string
    {
        try {
            $permitidas = Config::obter()->origens_permitidas;
        } catch (\Throwable) {
            $permitidas = ['*'];
        }
        if (in_array('*', $permitidas, true)) {
            return '*';
        }
        if ($origem !== null && in_array($origem, $permitidas, true)) {
            return $origem;
        }
        return null;
    }
}

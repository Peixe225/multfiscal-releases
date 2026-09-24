<?php
declare(strict_types=1);

namespace OmniChannel\Auth;

use OmniChannel\Nucleo\ErroHttp;
use OmniChannel\Nucleo\Requisicao;

/**
 * Guardas de autenticação, equivalentes às dependências de app/dependencias.py.
 *
 *     $eu = Auth::atendente($req);          // Authorization: Bearer <token>
 *     $eu = Auth::admin($req);              // idem, e papel admin (senão 403)
 *     $eu = Auth::atendenteDeArquivo($req); // cabeçalho OU ?token= (img, download, eventos)
 *
 * Devolvem a linha do atendente já tipada (Atendentes::tipar) e a guardam em
 * $req->atendente. As mensagens de erro são as mesmas do Python.
 */
final class Auth
{
    /** @return array<string, mixed> */
    public static function atendente(Requisicao $req): array
    {
        return self::doToken($req, $req->tokenBearer());
    }

    /**
     * `<img src>`, `<a download>` e o EventSource não mandam cabeçalho: o token
     * pode vir na query string.
     *
     * @return array<string, mixed>
     */
    public static function atendenteDeArquivo(Requisicao $req): array
    {
        return self::doToken($req, $req->tokenBearer() ?? $req->consulta('token'));
    }

    /** @return array<string, mixed> */
    public static function admin(Requisicao $req): array
    {
        $atendente = self::atendente($req);
        if (!Atendentes::eAdmin($atendente)) {
            throw ErroHttp::proibido('acao restrita a administradores');
        }
        return $atendente;
    }

    /** @return array<string, mixed> */
    private static function doToken(Requisicao $req, ?string $token): array
    {
        if ($token === null || $token === '') {
            throw ErroHttp::naoAutorizado('informe o token de acesso');
        }
        $id = Token::ler($token);
        if ($id === null) {
            throw ErroHttp::naoAutorizado('token invalido ou expirado');
        }
        $atendente = Atendentes::porId($id);
        if ($atendente === null || !$atendente['ativo']) {
            throw ErroHttp::naoAutorizado('atendente sem acesso');
        }
        $req->atendente = $atendente;
        return $atendente;
    }
}

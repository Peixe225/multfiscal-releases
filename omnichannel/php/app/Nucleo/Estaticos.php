<?php
declare(strict_types=1);

namespace OmniChannel\Nucleo;

/**
 * Páginas e arquivos do front (app/web é a fonte única; no deploy vira
 * public/web). Mesmos endereços do FastAPI: /painel, /simulador, /widget.js,
 * /widget/demo e /static/<arquivo>.
 */
final class Estaticos
{
    private const PAGINAS = [
        '/painel' => 'painel.html',
        '/simulador' => 'simulador.html',
        '/widget/demo' => 'demo.html',
        '/widget.js' => 'widget.js',
    ];

    private const TIPOS = [
        'html' => 'text/html; charset=utf-8',
        'css' => 'text/css; charset=utf-8',
        'js' => 'application/javascript; charset=utf-8',
        'mjs' => 'application/javascript; charset=utf-8',
        'json' => 'application/json',
        'map' => 'application/json',
        'svg' => 'image/svg+xml',
        'png' => 'image/png',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'gif' => 'image/gif',
        'webp' => 'image/webp',
        'ico' => 'image/x-icon',
        'woff' => 'font/woff',
        'woff2' => 'font/woff2',
        'txt' => 'text/plain; charset=utf-8',
    ];

    /** O caminho é do front? (decide antes de tocar no banco) */
    public static function eDoFront(string $caminho): bool
    {
        return $caminho === '/' || isset(self::PAGINAS[$caminho]) || str_starts_with($caminho, '/static/');
    }

    public static function atender(Requisicao $req): Resposta
    {
        if ($req->metodo !== 'GET' && $req->metodo !== 'HEAD') {
            throw new ErroHttp(405, 'Method Not Allowed', ['Allow' => 'GET']);
        }
        if ($req->caminho === '/') {
            return Resposta::redirecionar('/painel');
        }
        $pasta = Config::obter()->pasta_web;
        $relativo = self::PAGINAS[$req->caminho] ?? substr($req->caminho, strlen('/static/'));
        $arquivo = self::resolver($pasta, $relativo);
        if ($arquivo === null) {
            throw new ErroHttp(404, 'Not Found');
        }
        $extensao = strtolower(pathinfo($arquivo, PATHINFO_EXTENSION));
        $resposta = Resposta::arquivo($arquivo, self::TIPOS[$extensao] ?? 'application/octet-stream', confiavel: true);
        // front muda a cada deploy: revalida sempre, mas 304 barato pelo ETag.
        // Pelo CONTEÚDO, não por data e tamanho: o envio pela API de upload
        // pode gravar a data do envio (ou manter a antiga) e uma troca de
        // mesmo tamanho passaria como igual. Os arquivos do front são pequenos
        $etag = '"' . (hash_file('sha256', $arquivo) ?: md5(filemtime($arquivo) . '-' . filesize($arquivo))) . '"';
        $resposta->cabecalho('ETag', $etag);
        $resposta->cabecalho('Last-Modified', gmdate('D, d M Y H:i:s', (int) filemtime($arquivo)) . ' GMT');
        $resposta->cabecalho('Cache-Control', 'no-cache');
        $pedido = $req->cabecalho('if-none-match');
        if ($pedido !== null && trim($pedido) === $etag) {
            $naoMudou = Resposta::vazia(304);
            $naoMudou->cabecalho('ETag', $etag);
            $naoMudou->cabecalho('Cache-Control', 'no-cache');
            return $naoMudou;
        }
        if ($extensao === 'html') {
            // o painel nunca pode ser emoldurado por outro site (clickjacking)
            $resposta->cabecalho('Content-Security-Policy', "frame-ancestors 'self'");
            $resposta->cabecalho('X-Frame-Options', 'SAMEORIGIN');
        }
        return $resposta;
    }

    /** Caminho real dentro da pasta, ou null (sem "..", sem arquivo oculto). */
    private static function resolver(string $pasta, string $relativo): ?string
    {
        if ($relativo === '' || str_contains($relativo, "\0")) {
            return null;
        }
        foreach (explode('/', $relativo) as $parte) {
            if ($parte === '' || $parte === '..' || str_starts_with($parte, '.')) {
                return null;
            }
        }
        $raiz = realpath($pasta);
        $alvo = realpath($pasta . '/' . $relativo);
        if ($raiz === false || $alvo === false || !is_file($alvo)) {
            return null;
        }
        if (!str_starts_with($alvo, $raiz . DIRECTORY_SEPARATOR)) {
            return null;
        }
        return $alvo;
    }
}

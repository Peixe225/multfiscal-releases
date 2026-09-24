<?php
declare(strict_types=1);

use OmniChannel\Auth\Senhas;
use OmniChannel\Auth\Token;
use OmniChannel\Banco\Banco;
use OmniChannel\Instalacao\Seed;
use OmniChannel\Nucleo\Aplicacao;
use OmniChannel\Nucleo\Datas;
use OmniChannel\Nucleo\Json;
use OmniChannel\Nucleo\Requisicao;

function pedir(string $metodo, string $caminho, array $cabecalhos = [], string $corpo = '', array $consulta = []): array
{
    $resposta = Aplicacao::atender(new Requisicao($metodo, $caminho, $consulta, $cabecalhos, $corpo));
    return [$resposta->status, $resposta->conteudo(), $resposta];
}

return [
    'saude anuncia consulta' => function (): void {
        [$status, $corpo] = pedir('GET', '/saude');
        Afirmar::igual(200, $status);
        Afirmar::igual('consulta', Json::decodificar($corpo)['eventos']);
    },
    'login e eu com o seed' => function (): void {
        Seed::semear(true);
        [$status, $corpo] = pedir('POST', '/api/auth/login', ['Content-Type' => 'application/json'], '{"email":"Ana@MultFiscal.com.br","senha":"ana12345"}');
        Afirmar::igual(200, $status, $corpo);
        $dados = Json::decodificar($corpo);
        Afirmar::igual('Suporte técnico', $dados['atendente']['setor']);
        [$status, $corpo] = pedir('GET', '/api/auth/eu', ['Authorization' => 'Bearer ' . $dados['token']]);
        Afirmar::igual(200, $status);
        Afirmar::verdade(!str_contains($corpo, 'senha'), 'senha_hash vazou');
    },
    'login errado e inativo dao 401 igual' => function (): void {
        Seed::semear();
        [$s1, $c1] = pedir('POST', '/api/auth/login', ['Content-Type' => 'application/json'], '{"email":"ana@multfiscal.com.br","senha":"x"}');
        [$s2, $c2] = pedir('POST', '/api/auth/login', ['Content-Type' => 'application/json'], '{"email":"ninguem@x.com","senha":"x"}');
        Banco::executar('UPDATE atendentes SET ativo = 0 WHERE email = ?', ['ana@multfiscal.com.br']);
        [$s3, $c3] = pedir('POST', '/api/auth/login', ['Content-Type' => 'application/json'], '{"email":"ana@multfiscal.com.br","senha":"ana12345"}');
        Afirmar::igual([401, 401, 401], [$s1, $s2, $s3]);
        Afirmar::igual($c1, $c2);
        Afirmar::igual($c1, $c3);
    },
    'atendente desativado perde o token' => function (): void {
        $id = Banco::inserir('atendentes', ['nome' => 'X', 'email' => 'x@x.com', 'senha_hash' => Senhas::gerarHash('123456'),
            'papel' => 'atendente', 'ativo' => true, 'disponivel' => true, 'criado_em' => Datas::agoraBanco()]);
        $token = Token::criar($id);
        Afirmar::igual(200, pedir('GET', '/api/eventos/desde', [], '', ['token' => $token])[0]);
        Banco::executar('UPDATE atendentes SET ativo = 0 WHERE id = ?', [$id]);
        [$status, $corpo] = pedir('GET', '/api/eventos/desde', ['Authorization' => "Bearer {$token}"]);
        Afirmar::igual(401, $status);
        Afirmar::igual('{"detail":"atendente sem acesso"}', $corpo);
    },
    'cors so no widget' => function (): void {
        [, , $widget] = pedir('GET', '/api/widget/qualquer', ['Origin' => 'https://site.com']);
        Afirmar::igual('*', $widget->obterCabecalho('Access-Control-Allow-Origin'));
        [, , $api] = pedir('GET', '/api/auth/eu', ['Origin' => 'https://site.com']);
        Afirmar::igual(null, $api->obterCabecalho('Access-Control-Allow-Origin'));
        [$status, , $pre] = pedir('OPTIONS', '/api/widget/sessao', ['Origin' => 'https://site.com', 'Access-Control-Request-Method' => 'POST', 'Access-Control-Request-Headers' => 'x-sessao']);
        Afirmar::igual(200, $status);
        Afirmar::igual('x-sessao', $pre->obterCabecalho('Access-Control-Allow-Headers'));
        [$status] = pedir('OPTIONS', '/api/auth/login', ['Origin' => 'https://site.com', 'Access-Control-Request-Method' => 'POST']);
        Afirmar::igual(405, $status);
    },
    'front estatico protegido' => function (): void {
        [$status, , $painel] = pedir('GET', '/painel');
        Afirmar::igual(200, $status);
        Afirmar::igual("frame-ancestors 'self'", $painel->obterCabecalho('Content-Security-Policy'));
        Afirmar::igual('nosniff', $painel->obterCabecalho('X-Content-Type-Options'));
        Afirmar::igual(404, pedir('GET', '/static/../main.py')[0]);
        Afirmar::igual(404, pedir('GET', '/static/.oculto')[0]);
        Afirmar::igual(200, pedir('GET', '/static/painel.css')[0]);
        [$status, , $js] = pedir('GET', '/widget.js', ['Origin' => 'https://site.com']);
        Afirmar::igual(200, $status);
        Afirmar::igual('*', $js->obterCabecalho('Access-Control-Allow-Origin'));
        Afirmar::igual(307, pedir('GET', '/')[0]);
    },
    'erro inesperado vira 500 sem detalhe' => function (): void {
        $r = Aplicacao::roteador();
        $r->get('/api/explode', function (): never {
            throw new LogicException('segredo interno');
        });
        [$status, $corpo] = pedir('GET', '/api/explode');
        Afirmar::igual(500, $status);
        Afirmar::igual('{"detail":"erro interno do servidor"}', $corpo);
    },
];

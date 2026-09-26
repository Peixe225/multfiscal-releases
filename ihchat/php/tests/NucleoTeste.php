<?php
declare(strict_types=1);

use IHchat\Nucleo\Datas;
use IHchat\Nucleo\ErroHttp;
use IHchat\Nucleo\ErroValidacao;
use IHchat\Nucleo\Json;
use IHchat\Nucleo\Requisicao;
use IHchat\Nucleo\Resposta;
use IHchat\Nucleo\Roteador;
use IHchat\Nucleo\Texto;
use IHchat\Nucleo\Validador;

return [
    'datas saem como o pydantic' => function (): void {
        Afirmar::igual('2026-09-23T15:44:48Z', Datas::iso('2026-09-23 15:44:48.000000'));
        Afirmar::igual('2026-09-23T15:44:48.123456Z', Datas::iso('2026-09-23 15:44:48.123456'));
        Afirmar::igual('2026-09-23T15:44:48Z', Datas::iso('2026-09-23T12:44:48-03:00'));
        Afirmar::igual(null, Datas::iso(null));
        Afirmar::igual('2026-09-23 15:44:48.000000', Datas::paraBanco(new DateTimeImmutable('2026-09-23T12:44:48-03:00')));
    },
    'json mantem utf8 e objeto vazio' => function (): void {
        Afirmar::igual('{"a":"ação","b":{},"c":[],"d":1.0,"e":"/x"}', Json::codificar(['a' => 'ação', 'b' => Json::objeto([]), 'c' => [], 'd' => 1.0, 'e' => '/x']));
    },
    'texto resume e gera chave' => function (): void {
        Afirmar::igual('abc…', Texto::resumir("abc\n  defgh", 4));
        Afirmar::igual('5511999', Texto::normalizarTelefone('+55 (11) 999'));
        $chave = Texto::gerarChave('wc_');
        Afirmar::verdade((bool) preg_match('/^wc_[A-Za-z0-9_-]{32}$/', $chave), $chave);
    },
    'validador junta todos os erros' => function (): void {
        $v = new Validador(['nome' => 'a', 'papel' => 'chefe', 'idade' => 'x']);
        $v->texto('nome', min: 2);
        $v->email('email');
        $v->opcao('papel', ['admin', 'atendente']);
        $v->inteiro('idade');
        Afirmar::lanca(ErroValidacao::class, fn () => $v->validar(), function (ErroValidacao $e): void {
            Afirmar::igual(422, $e->status);
            Afirmar::igual(['string_too_short', 'missing', 'enum', 'int_parsing'], array_column($e->erros, 'type'));
            Afirmar::igual(['body', 'nome'], $e->erros[0]['loc']);
        });
    },
    'validador converte e respeita opcionais' => function (): void {
        $v = new Validador(['n' => '12', 'b' => 'false', 'nulo' => null, 'e' => 'Ana <Ana@Exemplo.COM.br>']);
        Afirmar::igual(12, $v->inteiro('n'));
        Afirmar::igual(false, $v->booleano('b'));
        Afirmar::igual(null, $v->texto('nulo', obrigatorio: false));
        Afirmar::igual('x', $v->texto('ausente', obrigatorio: false, padrao: 'x'));
        Afirmar::igual('Ana@exemplo.com.br', $v->email('e'));
        Afirmar::verdade($v->tem('nulo') && !$v->tem('ausente'));
        $v->validar();
    },
    'email segue o email-validator' => function (): void {
        Afirmar::igual(null, Validador::normalizarEmail('x@y.local'));
        Afirmar::igual(null, Validador::normalizarEmail('a@b'));
        Afirmar::igual(null, Validador::normalizarEmail('a b@c.com'));
        Afirmar::igual('x@loja.example', Validador::normalizarEmail('x@loja.example'));
    },
    'senha nunca volta no erro' => function (): void {
        $v = new Validador(['senha' => '123']);
        $v->texto('senha', min: 6);
        Afirmar::verdade(!array_key_exists('input', $v->erros()[0]));
    },
    'roteador prefere literal e converte int' => function (): void {
        $r = new Roteador();
        $r->get('/api/canais/{canal_id:int}', fn ($req, $p) => ['id' => $p['canal_id']]);
        $r->get('/api/canais/tipos', fn () => ['tipos' => true]);
        $r->post('/api/canais', fn () => ['criado' => true], status: 201);
        $r->get('/static/{arquivo:caminho}', fn ($req, $p) => ['arquivo' => $p['arquivo']]);
        Afirmar::igual('{"tipos":true}', $r->despachar(new Requisicao('GET', '/api/canais/tipos'))->corpo);
        Afirmar::igual('{"id":5}', $r->despachar(new Requisicao('GET', '/api/canais/5'))->corpo);
        Afirmar::igual('{"arquivo":"a/b.css"}', $r->despachar(new Requisicao('GET', '/static/a/b.css'))->corpo);
        $criado = $r->despachar(new Requisicao('POST', '/api/canais'));
        Afirmar::igual(201, $criado->status);
        Afirmar::lanca(ErroValidacao::class, fn () => $r->despachar(new Requisicao('GET', '/api/canais/abc')));
        Afirmar::lanca(ErroHttp::class, fn () => $r->despachar(new Requisicao('DELETE', '/api/canais/5')), function (ErroHttp $e): void {
            Afirmar::igual(405, $e->status);
            Afirmar::igual('GET', $e->cabecalhos['Allow']);
        });
        Afirmar::lanca(ErroHttp::class, fn () => $r->despachar(new Requisicao('GET', '/api/outra')), fn (ErroHttp $e) => Afirmar::igual(404, $e->status));
        $barra = $r->despachar(new Requisicao('POST', '/api/canais/', ['x' => '1']));
        Afirmar::igual(307, $barra->status);
        Afirmar::igual('/api/canais?x=1', $barra->obterCabecalho('Location'));
    },
    'requisicao le json, bearer e query crua' => function (): void {
        [$consulta] = Requisicao::lerConsulta('a.b=1&c=%C3%A7&c=2&vazio');
        Afirmar::igual(['a.b' => '1', 'c' => '2', 'vazio' => ''], $consulta);
        $req = new Requisicao('POST', '/x', [], ['Authorization' => 'Bearer abc', 'Content-Type' => 'application/json'], '{"a":1}');
        Afirmar::igual('abc', $req->tokenBearer());
        Afirmar::igual(['a' => 1], $req->jsonObjeto());
        $lista = new Requisicao('POST', '/x', [], ['Content-Type' => 'application/json'], '[1]');
        Afirmar::lanca(ErroValidacao::class, fn () => $lista->jsonObjeto());
        $vazio = new Requisicao('POST', '/x');
        Afirmar::lanca(ErroValidacao::class, fn () => $vazio->jsonObjeto(), fn (ErroValidacao $e) => Afirmar::igual('missing', $e->erros[0]['type']));
    },
    'arquivo perigoso vai como download com sandbox' => function (): void {
        $tmp = tempnam(sys_get_temp_dir(), 'ihchat');
        file_put_contents($tmp, '<script>alert(1)</script>');
        $r = Resposta::arquivo($tmp, 'text/html', 'x.html');
        Afirmar::verdade(str_starts_with((string) $r->obterCabecalho('Content-Disposition'), 'attachment;'));
        Afirmar::igual('sandbox', $r->obterCabecalho('Content-Security-Policy'));
        $img = Resposta::arquivo($tmp, 'image/png', 'foto ç.png');
        Afirmar::verdade(str_contains((string) $img->obterCabecalho('Content-Disposition'), "filename*=UTF-8''foto%20%C3%A7.png"));
        unlink($tmp);
    },
];

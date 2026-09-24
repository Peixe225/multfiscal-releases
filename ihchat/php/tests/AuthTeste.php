<?php
declare(strict_types=1);

use IHchat\Auth\Senhas;
use IHchat\Auth\Token;
use IHchat\Nucleo\Config;
use IHchat\Nucleo\Datas;

// vetores gerados pelo app Python (app/security.py) com a chave "chave-vetor"
const TOKEN_DO_PYTHON = 'eyJzdWIiOiA3LCAiZXhwIjogNDEwMjQ0NDgwMC41fQ.i6_FQFk4WO3hrVJZLuyxcCAke-UgdBhFs-I5gEo28JY';
const HASH_DO_PYTHON = 'pbkdf2_sha256$200000$04d1a218afcb3a469ecaa186caf38ef6$39ecfacf2f4b882ae5c6d5a088956cac21d51075221a8d67fb40aa44e25ce11d';

function config_vetor(): Config
{
    return Config::deArray(['chave_secreta' => 'chave-vetor', 'modo_sandbox' => true]);
}

return [
    'token do python vale aqui' => function (): void {
        Afirmar::igual(7, Token::ler(TOKEN_DO_PYTHON, config_vetor()));
    },
    'token com outra chave e recusado' => function (): void {
        Afirmar::igual(null, Token::ler(TOKEN_DO_PYTHON, Config::deArray(['chave_secreta' => 'outra', 'modo_sandbox' => true])));
    },
    'token adulterado e recusado' => function (): void {
        [$corpo, $assinatura] = explode('.', TOKEN_DO_PYTHON);
        $outroCorpo = rtrim(strtr(base64_encode('{"sub": 1, "exp": 4102444800.5}'), '+/', '-_'), '=');
        Afirmar::igual(null, Token::ler("{$outroCorpo}.{$assinatura}", config_vetor()));
        Afirmar::igual(null, Token::ler("{$corpo}.xx{$assinatura}", config_vetor()));
        Afirmar::igual(null, Token::ler('lixo', config_vetor()));
        Afirmar::igual(null, Token::ler('a.b.c', config_vetor()));
        Afirmar::igual(null, Token::ler('', config_vetor()));
    },
    'token do php tem o formato do python e vence' => function (): void {
        $token = Token::criar(42);
        [$corpo] = explode('.', $token);
        $json = base64_decode(strtr($corpo, '-_', '+/'));
        Afirmar::verdade((bool) preg_match('/^\{"sub": 42, "exp": \d+\.\d+\}$/', (string) $json), "json: {$json}");
        Afirmar::igual(42, Token::ler($token));
        Datas::congelar(Datas::agora()->modify('+13 hours'));
        Afirmar::igual(null, Token::ler($token));
    },
    'senha pbkdf2 do python confere' => function (): void {
        Afirmar::verdade(Senhas::conferir('senha-vetor', HASH_DO_PYTHON));
        Afirmar::verdade(!Senhas::conferir('senha-errada', HASH_DO_PYTHON));
        Afirmar::verdade(!Senhas::conferir('senha-vetor', 'pbkdf2_sha256$abc$sal$hex'));
    },
    'senha nova usa password_hash' => function (): void {
        $hash = Senhas::gerarHash('segredo123');
        Afirmar::verdade(str_starts_with($hash, '$2y$') || str_starts_with($hash, '$argon'), $hash);
        Afirmar::verdade(Senhas::conferir('segredo123', $hash));
        Afirmar::verdade(!Senhas::conferir('segredo124', $hash));
    },
    'config recusa chave padrao fora do sandbox' => function (): void {
        Afirmar::lanca(\IHchat\Nucleo\ErroConfiguracao::class, fn () => Config::deArray(['modo_sandbox' => false]));
        Afirmar::lanca(\IHchat\Nucleo\ErroConfiguracao::class, fn () => Config::deArray(['modo_sandbox' => false, 'chave_secreta' => 'curta']));
        Config::deArray(['modo_sandbox' => false, 'chave_secreta' => str_repeat('k', 32)]);
        Config::deArray(['modo_sandbox' => true]);
    },
];

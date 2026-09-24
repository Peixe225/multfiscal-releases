<?php
declare(strict_types=1);

namespace OmniChannel\Auth;

use OmniChannel\Nucleo\ErroHttp;
use OmniChannel\Nucleo\Requisicao;
use OmniChannel\Nucleo\Roteador;
use OmniChannel\Nucleo\Validador;

/** Login dos atendentes (app/api/auth.py). */
final class Rotas
{
    public static function registrar(Roteador $r): void
    {
        $r->post('/api/auth/login', [self::class, 'login']);
        $r->get('/api/auth/eu', [self::class, 'eu']);
    }

    /** @return array{token: string, atendente: array<string, mixed>} */
    public static function login(Requisicao $req): array
    {
        $v = Validador::corpo($req);
        // no login o e-mail é só chave de busca: validar formato aqui
        // atrapalharia instalações internas (domínios .local, por exemplo)
        $email = $v->texto('email', rotulo: 'e-mail');
        $senha = $v->texto('senha', rotulo: 'senha');
        $v->validar();

        $atendente = Atendentes::porEmail((string) $email);
        if ($atendente === null) {
            Senhas::conferirFalso((string) $senha);
        }
        if ($atendente === null || !Senhas::conferir((string) $senha, (string) $atendente['senha_hash']) || !$atendente['ativo']) {
            // mesma resposta para usuário inexistente e senha errada
            throw ErroHttp::naoAutorizado('e-mail ou senha invalidos');
        }
        return ['token' => Token::criar($atendente['id']), 'atendente' => Atendentes::saida($atendente)];
    }

    /** @return array<string, mixed> */
    public static function eu(Requisicao $req): array
    {
        return Atendentes::saida(Auth::atendente($req));
    }
}

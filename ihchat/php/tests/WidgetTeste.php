<?php
declare(strict_types=1);

use IHchat\Banco\Banco;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\ErroHttp;
use IHchat\Widget\Faxina;
use IHchat\Widget\Limites;

/** Pasta de contadores descartável para cada teste. */
function pasta_limites(): string
{
    $pasta = sys_get_temp_dir() . '/ihchat-limites-' . bin2hex(random_bytes(4));
    register_shutdown_function(static function () use ($pasta): void {
        array_map('unlink', glob($pasta . '/*.json') ?: []);
        @rmdir($pasta);
    });
    return $pasta;
}

/** Canal de webchat, contato e sessão; devolve a linha da sessão. */
function sessao_de_teste(string $token = 'ws_teste', ?string $email = null): array
{
    $agora = Datas::agoraBanco();
    $canal = (int) (Banco::valor("SELECT id FROM canais WHERE tipo = 'webchat'") ?? Banco::inserir('canais', [
        'nome' => 'Site', 'tipo' => 'webchat', 'ativo' => true, 'credenciais' => '{}',
        'chave_publica' => 'wc_' . bin2hex(random_bytes(6)), 'criado_em' => $agora,
    ]));
    $contato = Banco::inserir('contatos', ['nome' => 'Visitante', 'email' => $email, 'criado_em' => $agora, 'atualizado_em' => $agora]);
    Banco::inserir('contato_identidades', [
        'contato_id' => $contato, 'canal_tipo' => 'webchat', 'identificador' => 'v_' . $token, 'criado_em' => $agora,
    ]);
    Banco::inserir('sessoes_widget', ['token' => $token, 'canal_id' => $canal, 'contato_id' => $contato, 'criada_em' => $agora]);
    return Banco::um('SELECT * FROM sessoes_widget WHERE token = ?', [$token]);
}

/** Uma entrada do visitante com um anexo de $bytes. */
function arquivo_de_teste(array $sessao, int $bytes): void
{
    $agora = Datas::agoraBanco();
    $conversa = (int) (Banco::valor('SELECT id FROM conversas WHERE contato_id = ?', [(int) $sessao['contato_id']]) ?? Banco::inserir('conversas', [
        'contato_id' => (int) $sessao['contato_id'], 'canal_id' => (int) $sessao['canal_id'], 'criada_em' => $agora,
        'atualizada_em' => $agora, 'ultima_mensagem_em' => $agora,
    ]));
    $mensagem = Banco::inserir('mensagens', [
        'conversa_id' => $conversa, 'direcao' => 'entrada', 'conteudo' => '', 'metadados' => '{}', 'criada_em' => $agora,
    ]);
    Banco::inserir('anexos', ['mensagem_id' => $mensagem, 'nome' => 'a.png', 'tamanho' => $bytes, 'criado_em' => $agora]);
}

function status_de(callable $acao): ?int
{
    try {
        $acao();
        return null;
    } catch (ErroHttp $erro) {
        return $erro->status;
    }
}

return [
    'sessoes por ip param no limite da hora e nao afetam outro ip' => function (): void {
        $pasta = pasta_limites();
        Limites::novaSessao('203.0.113.7', 2, $pasta);
        Limites::novaSessao('203.0.113.7', 2, $pasta);
        Afirmar::igual(429, status_de(fn () => Limites::novaSessao('203.0.113.7', 2, $pasta)));
        Limites::novaSessao('198.51.100.1', 2, $pasta);
        // o endereço não vai para o disco, só o hash
        foreach (glob($pasta . '/*.json') ?: [] as $arquivo) {
            Afirmar::verdade(!str_contains((string) file_get_contents($arquivo) . $arquivo, '203.0.113.7'), 'IP em claro no disco');
        }
    },
    'arquivos: cota da sessao, do ip e do site' => function (): void {
        $pasta = pasta_limites();
        $mb = 1024 * 1024;
        $sessao = sessao_de_teste('ws_um');
        arquivo_de_teste($sessao, 3 * $mb);
        Limites::arquivo($sessao, '203.0.113.9', $mb, ['mb_sessao' => 5], $pasta);
        Afirmar::igual(429, status_de(fn () => Limites::arquivo($sessao, '203.0.113.9', 3 * $mb, ['mb_sessao' => 5], $pasta)), 'bytes da sessão');
        Afirmar::igual(429, status_de(fn () => Limites::arquivo($sessao, '203.0.113.9', 1, ['arquivos' => 1], $pasta)), 'quantidade da sessão');

        Limites::registrarArquivo('203.0.113.9', 4 * $mb, $pasta);
        $outra = sessao_de_teste('ws_dois');
        Afirmar::igual(429, status_de(fn () => Limites::arquivo($outra, '203.0.113.9', 2 * $mb, ['mb_ip' => 5], $pasta)), 'bytes do IP');
        Afirmar::igual(null, status_de(fn () => Limites::arquivo($outra, '198.51.100.2', 2 * $mb, ['mb_ip' => 5], $pasta)));

        // o site todo (todas as sessões de webchat) tem teto: 507
        Afirmar::igual(507, status_de(fn () => Limites::arquivo($outra, '198.51.100.2', 2 * $mb, ['mb_site' => 4], $pasta)));
    },
    'ritmo de mensagens por sessao' => function (): void {
        $sessao = sessao_de_teste();
        foreach (range(1, 3) as $_) {
            arquivo_de_teste($sessao, 1);
        }
        Afirmar::igual(null, status_de(fn () => Limites::mensagem($sessao, 4)));
        Afirmar::igual(429, status_de(fn () => Limites::mensagem($sessao, 3)));
        // passado o minuto, libera
        Datas::congelar(Datas::agora()->modify('+61 seconds'));
        Afirmar::igual(null, status_de(fn () => Limites::mensagem($sessao, 3)));
    },
    'faxina apaga sessao vazia antiga e o contato intocado que ela criou' => function (): void {
        Datas::congelar(new DateTimeImmutable('2026-01-01T00:00:00Z'));
        $vazia = sessao_de_teste('ws_vazia');
        $conversou = sessao_de_teste('ws_conversou');
        arquivo_de_teste($conversou, 1);
        $comEmail = sessao_de_teste('ws_email', 'equipe-preencheu@cliente.example');
        Datas::congelar(new DateTimeImmutable('2026-01-01T12:00:00Z'));
        $recente = sessao_de_teste('ws_recente');
        Datas::congelar(new DateTimeImmutable('2026-01-02T06:00:00Z'));

        Afirmar::igual([2, 1], Faxina::limpar());
        $restantes = array_column(Banco::todos('SELECT token FROM sessoes_widget ORDER BY token'), 'token');
        Afirmar::igual(['ws_conversou', 'ws_recente'], $restantes);
        Afirmar::igual(null, Banco::um('SELECT id FROM contatos WHERE id = ?', [(int) $vazia['contato_id']]));
        Afirmar::verdade(Banco::um('SELECT id FROM contatos WHERE id = ?', [(int) $comEmail['contato_id']]) !== null, 'ficha com dado da equipe fica');
        Afirmar::verdade(Banco::um('SELECT id FROM contatos WHERE id = ?', [(int) $recente['contato_id']]) !== null);
    },
    'faxina do widget roda pelo cron de hora em hora' => function (): void {
        Afirmar::igual(3600, \IHchat\Tarefas\FaxinaWidget::INTERVALO);
        Datas::congelar(new DateTimeImmutable('2026-01-01T00:00:00Z'));
        sessao_de_teste('ws_parada');
        Datas::congelar(new DateTimeImmutable('2026-01-03T00:00:00Z'));
        Afirmar::igual(
            'sessões do widget sem mensagem removidas: 1; contatos vazios removidos: 1',
            \IHchat\Tarefas\FaxinaWidget::executar()
        );
        // nada a fazer: saída vazia, o cron não enche o log
        Afirmar::igual('', \IHchat\Tarefas\FaxinaWidget::executar());
    },
];

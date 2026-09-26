<?php
declare(strict_types=1);

use IHchat\Auth\Token;
use IHchat\Banco\Banco;
use IHchat\Canais\AdaptadorWhatsApp;
use IHchat\Canais\Campos;
use IHchat\Canais\Canais;
use IHchat\Canais\Coletor;
use IHchat\Instalacao\Seed;
use IHchat\Nucleo\Aplicacao;
use IHchat\Nucleo\Config;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\Http\Cliente;
use IHchat\Nucleo\Http\RespostaHttp;
use IHchat\Nucleo\Http\Transporte;
use IHchat\Nucleo\Json;
use IHchat\Nucleo\Requisicao;

/** Provedor de mentira: responde com a função dada e anota cada chamada. */
final class ProvedorDeTeste implements Transporte
{
    /** @var list<array{metodo: string, url: string, corpo: string}> */
    public array $chamadas = [];

    /** @param callable(string, string, string): RespostaHttp $responder */
    public function __construct(private $responder)
    {
    }

    public function enviar(string $metodo, string $url, array $cabecalhos, string $corpo, float $timeout): RespostaHttp
    {
        $this->chamadas[] = ['metodo' => $metodo, 'url' => $url, 'corpo' => $corpo];
        return ($this->responder)($metodo, $url, $corpo);
    }
}

function provedor_de_teste(callable $responder): ProvedorDeTeste
{
    // a pasta de dados é a mesma em toda a rodada: offset e situação de um
    // teste não podem vazar para o próximo (o banco em memória recomeça os ids)
    foreach (glob(Config::obter()->pasta('coleta') . '/*') ?: [] as $arquivo) {
        unlink($arquivo);
    }
    $provedor = new ProvedorDeTeste($responder);
    Cliente::definirTransporte($provedor);
    return $provedor;
}

function json_ok(mixed $resultado): RespostaHttp
{
    return new RespostaHttp(200, Json::codificar(['ok' => true, 'result' => $resultado]), ['Content-Type' => 'application/json']);
}

/** @param array<string, mixed> $credenciais */
function canal_de_teste(string $tipo, array $credenciais = [], ?string $segredo = null, string $nome = 'Canal'): int
{
    return Banco::inserir('canais', [
        'nome' => $nome, 'tipo' => $tipo, 'ativo' => true, 'credenciais' => Json::objeto($credenciais),
        'chave_publica' => null, 'segredo_webhook' => $segredo, 'criado_em' => Datas::agoraBanco(),
    ]);
}

function config_com_url_publica(string $url): void
{
    $atual = Config::obter();
    Config::definir(Config::deArray([
        'driver' => $atual->driver, 'dsn' => $atual->dsn, 'chave_secreta' => $atual->chave_secreta,
        'modo_sandbox' => true, 'pasta_dados' => $atual->pasta_dados, 'pasta_web' => $atual->pasta_web,
        'url_publica' => $url,
    ]));
}

function pedir_canais(string $metodo, string $caminho, string $token, string $corpo = ''): array
{
    $cabecalhos = ['Authorization' => "Bearer {$token}"] + ($corpo !== '' ? ['Content-Type' => 'application/json'] : []);
    $resposta = Aplicacao::atender(new Requisicao($metodo, $caminho, [], $cabecalhos, $corpo));
    return [$resposta->status, Json::ler($resposta->conteudo(), null)];
}

/** @return list<array<string, mixed>> */
function updates_telegram(int ...$ids): array
{
    return array_map(static fn (int $id): array => [
        'update_id' => $id,
        'message' => ['message_id' => $id, 'chat' => ['id' => 884412], 'from' => ['first_name' => 'Marcos'], 'text' => "mensagem {$id}"],
    ], $ids);
}

return [
    'telegram em polling: o cron grava e so entao avanca o offset' => function (): void {
        $id = canal_de_teste('telegram', ['token' => '123:abc', 'modo_recebimento' => 'polling']);
        $lotes = [updates_telegram(10, 11), []];
        $provedor = provedor_de_teste(static function (string $m, string $url) use (&$lotes): RespostaHttp {
            return json_ok(array_shift($lotes) ?? []);
        });
        $r = Coletor::coletarTodos();
        Afirmar::igual(['novas' => 2, 'canais' => 1, 'erros' => 0], $r);
        Afirmar::igual(2, (int) Banco::valor("SELECT COUNT(*) FROM mensagens WHERE direcao = 'entrada'"));
        Afirmar::verdade(str_ends_with($provedor->chamadas[0]['url'], '/bot123:abc/getUpdates'), $provedor->chamadas[0]['url']);
        Afirmar::igual(['timeout' => 0, 'allowed_updates' => ['message', 'edited_message', 'channel_post']],
            Json::decodificar($provedor->chamadas[0]['corpo']));

        Coletor::coletarTodos();
        Afirmar::igual(12, Json::decodificar($provedor->chamadas[1]['corpo'])['offset'], 'o offset confirma o lote gravado');
        Afirmar::igual(['recebendo' => true, 'erro' => null], array_slice((array) Coletor::situacao($id), 0, 2));
    },
    'telegram em polling: reentrega do mesmo lote nao duplica' => function (): void {
        canal_de_teste('telegram', ['token' => '123:abc', 'modo_recebimento' => 'polling']);
        provedor_de_teste(static fn (): RespostaHttp => json_ok(updates_telegram(5)));
        Afirmar::igual(1, Coletor::coletarTodos()['novas']);
        // o arquivo de offset sumiu (reinstalação): o lote volta e morre na deduplicação
        array_map('unlink', glob(Config::obter()->pasta('coleta') . '/telegram-*.offset') ?: []);
        Afirmar::igual(0, Coletor::coletarTodos()['novas']);
        Afirmar::igual(1, (int) Banco::valor('SELECT COUNT(*) FROM mensagens'));
    },
    'dois canais com o mesmo bot: so o de menor id busca' => function (): void {
        $primeiro = canal_de_teste('telegram', ['token' => '123:abc', 'modo_recebimento' => 'polling'], nome: 'Bot A');
        $segundo = canal_de_teste('telegram', ['token' => '123:abc', 'modo_recebimento' => 'polling'], nome: 'Bot B');
        $provedor = provedor_de_teste(static fn (): RespostaHttp => json_ok([]));
        $r = Coletor::coletarTodos();
        Afirmar::igual(1, count($provedor->chamadas));
        Afirmar::igual(1, $r['erros']);
        Afirmar::igual(true, Coletor::situacao($primeiro)['recebendo']);
        Afirmar::verdade(str_contains((string) Coletor::situacao($segundo)['erro'], "o canal 'Bot A' já busca"), 'aviso do repetido');
    },
    'telegram em modo webhook e canal desativado ficam fora do cron' => function (): void {
        canal_de_teste('telegram', ['token' => '1:a', 'modo_recebimento' => 'webhook']);
        $inativo = canal_de_teste('telegram', ['token' => '2:b', 'modo_recebimento' => 'polling']);
        Banco::atualizar('canais', ['ativo' => false], 'id = ?', [$inativo]);
        $provedor = provedor_de_teste(static fn (): RespostaHttp => json_ok([]));
        Afirmar::igual(['novas' => 0, 'canais' => 0, 'erros' => 0], Coletor::coletarTodos());
        Afirmar::igual([], $provedor->chamadas);
    },
    'falha do telegram vira situacao do canal, sem derrubar os outros' => function (): void {
        $quebrado = canal_de_teste('telegram', ['token' => '1:a', 'modo_recebimento' => 'polling']);
        canal_de_teste('telegram', ['token' => '2:b', 'modo_recebimento' => 'polling']);
        provedor_de_teste(static fn (string $m, string $url): RespostaHttp => str_contains($url, '/bot1:a/')
            ? new RespostaHttp(409, '{"ok":false,"description":"Conflict: can\'t use getUpdates method while webhook is active"}')
            : json_ok(updates_telegram(1)));
        $r = Coletor::coletarTodos();
        Afirmar::igual(['novas' => 1, 'canais' => 2, 'erros' => 1], $r);
        Afirmar::verdade(str_contains((string) Coletor::situacao($quebrado)['erro'], 'webhook ativo'), 'explica o 409');
    },
    'sem url publica o telegram fica em polling e a url do webhook e relativa' => function (): void {
        Afirmar::igual('polling', Campos::modoTelegramPadrao());
        $id = canal_de_teste('telegram');
        Afirmar::igual("/webhooks/{$id}", Canais::saida((array) Canais::porId($id))['url_webhook']);
    },
    'com url publica https: webhook por padrao, url absoluta e conectar pelo servidor' => function (): void {
        config_com_url_publica('https://atendimento.example');
        Seed::semear();
        $admin = (int) Banco::valor("SELECT id FROM atendentes WHERE papel = 'admin'");
        $canal = (int) Banco::valor("SELECT id FROM canais WHERE tipo = 'telegram'");
        $segredo = (string) Banco::valor('SELECT segredo_webhook FROM canais WHERE id = ?', [$canal]);
        Banco::atualizar('canais', ['credenciais' => Json::objeto(['token' => '123:abc'])], 'id = ?', [$canal]);
        Afirmar::igual('webhook', Campos::modoTelegramPadrao());
        Afirmar::igual("https://atendimento.example/webhooks/{$canal}", Canais::saida((array) Canais::porId($canal))['url_webhook']);

        $provedor = provedor_de_teste(static fn (): RespostaHttp => json_ok(true));
        [$status, $corpo] = pedir_canais('POST', "/api/canais/{$canal}/conectar-webhook", Token::criar($admin));
        Afirmar::igual(200, $status);
        Afirmar::igual(true, $corpo['ok'], (string) $corpo['mensagem']);
        Afirmar::verdade(str_ends_with($provedor->chamadas[0]['url'], '/bot123:abc/setWebhook'), 'setWebhook');
        Afirmar::igual([
            'url' => "https://atendimento.example/webhooks/{$canal}",
            'secret_token' => $segredo,
            'allowed_updates' => ['message', 'edited_message', 'channel_post'],
            'drop_pending_updates' => false,
        ], Json::decodificar($provedor->chamadas[0]['corpo']));
        Afirmar::igual('webhook', Canais::porId($canal)['credenciais']['modo_recebimento']);
        Afirmar::verdade(!str_contains(Json::codificar($corpo), '123:abc'), 'o token nunca volta');
    },
    'com url publica https: telegram sem modo grava webhook e o testar ja conecta' => function (): void {
        config_com_url_publica('https://atendimento.example');
        Seed::semear();
        $admin = Token::criar((int) Banco::valor("SELECT id FROM atendentes WHERE papel = 'admin'"));
        // o do seed nasce com credenciais {}; o painel manda só o token (o modo não "mudou")
        $semeado = (int) Banco::valor("SELECT id FROM canais WHERE tipo = 'telegram'");
        [$status] = pedir_canais('PATCH', "/api/canais/{$semeado}", $admin, Json::codificar(['credenciais' => ['token' => '123:abc']]));
        Afirmar::igual(200, $status);
        Afirmar::igual('webhook', Canais::porId($semeado)['credenciais']['modo_recebimento'], 'gravado no PATCH');
        [, $criado] = pedir_canais('POST', '/api/canais', $admin, Json::codificar(['nome' => 'Bot novo', 'tipo' => 'telegram']));
        [, $credenciais] = pedir_canais('GET', "/api/canais/{$criado['id']}/credenciais", $admin);
        Afirmar::igual('webhook', $credenciais['credenciais']['modo_recebimento'], 'gravado ao criar');

        // "Salvar e testar": bot sem webhook cadastrado -> o servidor faz o setWebhook
        $provedor = provedor_de_teste(static fn (string $m, string $url): RespostaHttp => match (true) {
            str_ends_with($url, '/getMe') => json_ok(['username' => 'bot_rev']),
            str_ends_with($url, '/getWebhookInfo') => json_ok(['url' => '', 'pending_update_count' => 0]),
            default => json_ok(true),
        });
        [$status, $teste] = pedir_canais('POST', "/api/canais/{$semeado}/testar", $admin);
        Afirmar::igual(200, $status);
        Afirmar::igual(true, $teste['ok'], (string) $teste['mensagem']);
        Afirmar::verdade(str_contains($teste['mensagem'], 'Conectado como @bot_rev') && str_contains($teste['mensagem'], 'Webhook conectado'), $teste['mensagem']);
        Afirmar::verdade(str_ends_with($provedor->chamadas[2]['url'], '/setWebhook'), 'setWebhook feito no teste');
        Afirmar::igual("https://atendimento.example/webhooks/{$semeado}", Json::decodificar($provedor->chamadas[2]['corpo'])['url']);
    },
    'sem url publica https o testar avisa que o webhook falta, sem ficar verde calado' => function (): void {
        Seed::semear();
        $admin = Token::criar((int) Banco::valor("SELECT id FROM atendentes WHERE papel = 'admin'"));
        $canal = canal_de_teste('telegram', ['token' => '5:x', 'modo_recebimento' => 'webhook']);
        $provedor = provedor_de_teste(static fn (string $m, string $url): RespostaHttp => str_ends_with($url, '/getMe')
            ? json_ok(['username' => 'bot_rev']) : json_ok(['url' => '']));
        [, $teste] = pedir_canais('POST', "/api/canais/{$canal}/testar", $admin);
        Afirmar::igual(true, $teste['ok']);
        Afirmar::verdade(str_contains((string) $teste['alerta'], 'Conectar webhook'), (string) $teste['alerta']);
        Afirmar::igual(2, count($provedor->chamadas), 'nenhum setWebhook sem https');
    },
    'conectar webhook em canal sem segredo gera um' => function (): void {
        config_com_url_publica('https://atendimento.example');
        Seed::semear();
        $admin = (int) Banco::valor("SELECT id FROM atendentes WHERE papel = 'admin'");
        $canal = canal_de_teste('telegram', ['token' => '9:z']);
        $provedor = provedor_de_teste(static fn (): RespostaHttp => json_ok(true));
        [, $corpo] = pedir_canais('POST', "/api/canais/{$canal}/conectar-webhook", Token::criar($admin));
        Afirmar::igual(true, $corpo['ok']);
        $segredo = (string) Canais::porId($canal)['segredo_webhook'];
        Afirmar::igual(32, strlen($segredo));
        Afirmar::igual($segredo, Json::decodificar($provedor->chamadas[0]['corpo'])['secret_token']);
    },
    'whatsapp ignora o que nao e mensagem e aceita localizacao e botoes' => function (): void {
        $a = new AdaptadorWhatsApp(['id' => 1, 'nome' => 'WA', 'tipo' => 'whatsapp', 'credenciais' => []]);
        $valor = static fn (array $mensagens): array => ['entry' => [['changes' => [['value' => [
            'contacts' => [['wa_id' => '55 (11) 99999-0000', 'profile' => ['name' => 'Zé']]],
            'messages' => $mensagens,
        ]]]]]];
        $recebidas = $a->analisarWebhook($valor([
            ['from' => '5511999990000', 'id' => 'w1', 'type' => 'location', 'location' => ['latitude' => -23.5, 'longitude' => -46.6]],
            ['from' => '5511999990000', 'id' => 'w2', 'type' => 'interactive', 'interactive' => ['list_reply' => ['title' => 'Financeiro']]],
            ['from' => '5511999990000', 'id' => 'w3', 'type' => 'reaction', 'reaction' => ['emoji' => 'x']],
            ['from' => '5511999990000', 'id' => 'w4', 'type' => 'text', 'text' => ['body' => '']],
            'lixo',
        ]));
        Afirmar::igual(['[localizacao] -23.5,-46.6', 'Financeiro'], array_map(static fn ($r) => $r->conteudo, $recebidas));
        Afirmar::igual('Zé', $recebidas[0]->nome_exibicao, 'o número do perfil é normalizado nos dois lados');
        Afirmar::igual('whatsapp:w2', $recebidas[1]->externo_id);
        Afirmar::igual([], $a->analisarWebhook(['entry' => 'x']));
        Afirmar::igual([['externo_id' => 'whatsapp:w9', 'status' => 'lida']], $a->analisarStatus(
            ['entry' => [['changes' => [['value' => ['statuses' => [['id' => 'w9', 'status' => 'read'], ['id' => 'w8', 'status' => '?']]]]]]]]
        ));
    },
    'assinatura da meta confere o corpo cru em tempo constante' => function (): void {
        $corpo = '{"entry":[]}';
        $assinatura = 'sha256=' . hash_hmac('sha256', $corpo, 'segredo');
        Afirmar::verdade(AdaptadorWhatsApp::assinaturaValida('segredo', $corpo, $assinatura), 'válida');
        Afirmar::verdade(!AdaptadorWhatsApp::assinaturaValida('segredo', $corpo . ' ', $assinatura), 'corpo mudou');
        Afirmar::verdade(!AdaptadorWhatsApp::assinaturaValida('segredo', $corpo, null), 'sem cabeçalho');
    },
];

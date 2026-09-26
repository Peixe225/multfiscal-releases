<?php
declare(strict_types=1);

/*
 * WhatsApp pelo QR Code (Canais\AdaptadorWhatsAppQr e WhatsAppQr\*).
 *
 * O fluxo HTTP inteiro roda nos dois servidores em contrato/test_whatsapp_qr*.py;
 * aqui ficam os detalhes que não passam por lá (os mesmos de
 * tests/test_whatsapp_qr.py no Python): tradução de casos raros, assinatura
 * sem duplicar, segredo fora das frases de erro e a resposta pelo celular
 * numa conversa resolvida.
 */

use IHchat\Atendimento\AnexoRecebido;
use IHchat\Atendimento\Assinaturas;
use IHchat\Auth\Token;
use IHchat\Banco\Banco;
use IHchat\Canais\AdaptadorWhatsApp;
use IHchat\Canais\AdaptadorWhatsAppQr;
use IHchat\Canais\ErroCanal;
use IHchat\Canais\WhatsAppQr\Leitura;
use IHchat\Canais\WhatsAppQr\RedeExterna;
use IHchat\Nucleo\Config;
use IHchat\Instalacao\Seed;
use IHchat\Nucleo\Aplicacao;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\Http\Cliente;
use IHchat\Nucleo\Http\ErroTransporte;
use IHchat\Nucleo\Http\RespostaHttp;
use IHchat\Nucleo\Http\Transporte;
use IHchat\Nucleo\Json;
use IHchat\Nucleo\Requisicao;

/** Provedor de mentira do QR Code: responde com a função dada e guarda cada pedido. */
final class ProvedorQrDeTeste implements Transporte
{
    /** @var list<array{metodo: string, url: string, cabecalhos: array<string, string>, corpo: string}> */
    public array $pedidos = [];

    /** @param callable(string, string): RespostaHttp $responder */
    public function __construct(private $responder)
    {
    }

    public function enviar(string $metodo, string $url, array $cabecalhos, string $corpo, float $timeout): RespostaHttp
    {
        $this->pedidos[] = ['metodo' => $metodo, 'url' => $url, 'cabecalhos' => array_change_key_case($cabecalhos), 'corpo' => $corpo];
        return ($this->responder)($metodo, $url);
    }
}

const QR_ZAPI = ['provedor' => 'zapi', 'instancia_id' => 'I1', 'instancia_token' => 'token-secreto-zapi', 'client_token' => 'ct-secreto'];
const QR_EVOLUTION = ['provedor' => 'evolution', 'url_servidor' => 'https://evo.teste', 'api_key' => 'chave-secreta-evo', 'nome_instancia' => 'loja'];

/** @param array<string, mixed> $credenciais */
function adaptador_qr(array $credenciais, ?string $segredo = 's3gredo'): AdaptadorWhatsAppQr
{
    return new AdaptadorWhatsAppQr(['id' => 7, 'nome' => 'QR', 'tipo' => 'whatsapp_qr', 'credenciais' => $credenciais, 'segredo_webhook' => $segredo]);
}

function provedor_qr(callable $responder): ProvedorQrDeTeste
{
    $provedor = new ProvedorQrDeTeste($responder);
    Cliente::definirTransporte($provedor);
    return $provedor;
}

/** @param array<string, string> $cabecalhos */
function pedir_qr(string $metodo, string $caminho, array $cabecalhos = [], string $corpo = '', array $consulta = []): array
{
    $cabecalhos += $corpo !== '' ? ['Content-Type' => 'application/json'] : [];
    $resposta = Aplicacao::atender(new Requisicao($metodo, $caminho, $consulta, $cabecalhos, $corpo));
    return [$resposta->status, Json::ler($resposta->conteudo(), null)];
}

return [
    'identificador do contato: numero, jid e lid' => function (): void {
        $casos = [
            '5511988887777' => '5511988887777',
            '+55 (11) 98888-7777' => '5511988887777',
            '5511988887777@s.whatsapp.net' => '5511988887777',
            '5511988887777:12@s.whatsapp.net' => '5511988887777',
            '5511988887777@c.us' => '5511988887777',
            '123456789012345@lid' => '123456789012345@lid',
            '@lid' => null,
            '' => null,
        ];
        foreach ($casos as $bruto => $esperado) {
            Afirmar::igual($esperado, Leitura::identificadorDoContato((string) $bruto), (string) $bruto);
        }
        Afirmar::verdade(Leitura::eConversaPrivada('5511@s.whatsapp.net'));
        foreach (['120363@g.us', '1203-group', 'status@broadcast', '1@broadcast', '1@newsletter', ''] as $jid) {
            Afirmar::verdade(!Leitura::eConversaPrivada($jid), $jid);
        }
        foreach (['file:///etc/passwd', 'gopher://x', 'javascript:alert(1)', 5] as $url) {
            Afirmar::igual(null, Leitura::urlDeMidia($url));
        }
    },
    'estado da conexao so grava o que mudou' => function (): void {
        Afirmar::igual(null, AdaptadorWhatsAppQr::credenciaisComConexao(['estado_conexao' => 'conectado', 'numero_conectado' => '55'], 'conectado', '55'));
        Afirmar::igual(['x' => 1, 'estado_conexao' => 'conectado', 'numero_conectado' => '5511'], AdaptadorWhatsAppQr::credenciaisComConexao(['x' => 1], 'conectado', '5511'));
        Afirmar::igual(['estado_conexao' => 'desconectado'], AdaptadorWhatsAppQr::credenciaisComConexao(['estado_conexao' => 'conectado', 'numero_conectado' => '55'], 'desconectado', null));
        Afirmar::igual(null, AdaptadorWhatsAppQr::credenciaisComConexao([], 'erro', null));
    },
    'campos obrigatorios seguem o provedor' => function (): void {
        Afirmar::igual(['instancia_id', 'instancia_token'], adaptador_qr([])->camposObrigatorios());
        Afirmar::igual(['url_servidor', 'api_key', 'nome_instancia'], adaptador_qr(['provedor' => 'evolution'])->camposObrigatorios());
        Afirmar::igual(['provedor'], adaptador_qr(['provedor' => '???'])->camposObrigatorios());
        Afirmar::verdade(adaptador_qr(QR_ZAPI)->configurado());
        Afirmar::verdade(!adaptador_qr(['provedor' => 'zapi', 'instancia_id' => 'x'])->configurado());
    },
    'token do webhook confere com hash_equals' => function (): void {
        $qr = adaptador_qr(QR_ZAPI);
        Afirmar::verdade($qr->verificarAssinatura('{}', ['x-ihchat-token' => 's3gredo']));
        Afirmar::verdade(!$qr->verificarAssinatura('{}', ['x-ihchat-token' => 's3gredO']));
        Afirmar::verdade(!$qr->verificarAssinatura('{}', []));
        Afirmar::verdade(!adaptador_qr(QR_ZAPI, null)->verificarAssinatura('{}', ['x-ihchat-token' => '']));
    },
    'zapi traduz localizacao, contato, botoes e recibos' => function (): void {
        $qr = adaptador_qr(QR_ZAPI);
        $base = ['type' => 'ReceivedCallback', 'phone' => '5511999990000', 'fromMe' => false, 'senderName' => 'Zé'];
        $extras = [
            // precisão de GPS de celular: o (string) do PHP (precision=14) cortava os últimos dígitos
            ['location' => ['latitude' => -23.561414213562372, 'longitude' => -46.65588379999999]],
            ['contact' => ['displayName' => 'Maria']],
            ['buttonsResponseMessage' => ['buttonId' => '1', 'message' => 'Sim']],
            ['listResponseMessage' => ['title' => 'Financeiro', 'message' => 'Financeiro']],
            ['reaction' => ['value' => 'x']],
            ['text' => ['message' => '']],
        ];
        $recebidas = [];
        foreach ($extras as $i => $extra) {
            array_push($recebidas, ...$qr->analisarWebhook($base + ['messageId' => "m{$i}"] + $extra));
        }
        Afirmar::igual(['[localizacao] -23.561414213562372,-46.65588379999999', '[contato] Maria', 'Sim', 'Financeiro'], array_map(static fn ($r) => $r->conteudo, $recebidas));
        Afirmar::igual('whatsapp_qr:7:m0', $recebidas[0]->externo_id);
        Afirmar::igual('Zé', $recebidas[0]->nome_exibicao);
        Afirmar::igual([], $qr->analisarStatus(['type' => 'MessageStatusCallback', 'status' => 'READ_BY_ME', 'ids' => ['a']]));
        Afirmar::igual([['externo_id' => 'whatsapp_qr:7:b', 'status' => 'falhou']],
            $qr->analisarStatus(['type' => 'DeliveryCallback', 'messageId' => 'b', 'error' => 'number not exists']));
    },
    'zapi: erro de rede nunca leva o token' => function (): void {
        provedor_qr(static function (string $metodo, string $url): RespostaHttp {
            throw new ErroTransporte("sem rota para {$url}");
        });
        $estado = adaptador_qr(QR_ZAPI)->estadoQr();
        Afirmar::igual('erro', $estado->status);
        Afirmar::verdade(!str_contains($estado->mensagem, 'token-secreto-zapi') && str_contains($estado->mensagem, '<oculto>'), $estado->mensagem);
    },
    'zapi: midia baixada sem as credenciais' => function (): void {
        $provedor = provedor_qr(static fn (): RespostaHttp => new RespostaHttp(200, 'bytes'));
        Afirmar::igual('bytes', adaptador_qr(QR_ZAPI)->baixarAnexo(new AnexoRecebido('a.png', 'https://storage.z-api.io/x/a.png')));
        Afirmar::verdade(!isset($provedor->pedidos[0]['cabecalhos']['client-token']), 'a URL da mídia não recebe o Client-Token');
        Afirmar::lanca(ErroCanal::class, static fn () => adaptador_qr(QR_ZAPI)->baixarAnexo(new AnexoRecebido('a', 'file:///etc/passwd')));
    },
    'evolution: numero de verdade do lid, ou responde ao lid' => function (): void {
        $entrega = ['event' => 'messages.upsert', 'instance' => 'loja', 'data' => [
            'key' => ['remoteJid' => '987654321@lid', 'remoteJidAlt' => '5521911112222@s.whatsapp.net', 'fromMe' => false, 'id' => 'L1'],
            'pushName' => 'Ana', 'messageType' => 'conversation', 'message' => ['conversation' => 'oi'],
        ]];
        Afirmar::igual('5521911112222', adaptador_qr(QR_EVOLUTION)->analisarWebhook($entrega)[0]->identificador);
        unset($entrega['data']['key']['remoteJidAlt']);
        $entrega['data']['key']['id'] = 'L2';
        Afirmar::igual('987654321@lid', adaptador_qr(QR_EVOLUTION)->analisarWebhook($entrega)[0]->identificador);

        $provedor = provedor_qr(static fn (): RespostaHttp => new RespostaHttp(201, '{"key":{"id":"S1"}}', ['Content-Type' => 'application/json']));
        $resultado = adaptador_qr(QR_EVOLUTION)->enviar('987654321@lid', 'resposta', []);
        Afirmar::igual('enviada', $resultado->status);
        Afirmar::igual('whatsapp_qr:7:S1', $resultado->externo_id);
        Afirmar::igual('987654321@lid', Json::decodificar($provedor->pedidos[0]['corpo'])['number']);
    },
    'evolution: endereco sem esquema e recibo de mensagem recebida' => function (): void {
        $estado = adaptador_qr(['url_servidor' => 'evo.teste'] + QR_EVOLUTION)->estadoQr();
        Afirmar::igual('erro', $estado->status);
        Afirmar::verdade(str_contains($estado->mensagem, 'https://'), $estado->mensagem);
        $recibos = adaptador_qr(QR_EVOLUTION)->analisarStatus(['event' => 'MESSAGES_UPDATE', 'instance' => 'loja', 'data' => [
            ['keyId' => 'a', 'fromMe' => false, 'status' => 'READ', 'remoteJid' => '5511@s.whatsapp.net'],
            ['keyId' => 'b', 'fromMe' => true, 'status' => 'PLAYED', 'remoteJid' => '5511@s.whatsapp.net'],
        ]]);
        Afirmar::igual([['externo_id' => 'whatsapp_qr:7:b', 'status' => 'lida']], $recibos);
    },
    'assinatura na primeira linha pelo nucleo' => function (): void {
        // o núcleo assina o QR como o WhatsApp oficial; o adaptador não assina de novo
        $assinatura = ['nome' => 'Ana', 'setor' => 'Suporte'];
        Afirmar::igual("*Ana · Suporte*\nOi", Assinaturas::aplicar('whatsapp_qr', 'Oi', $assinatura));
        Afirmar::igual(Assinaturas::aplicar('whatsapp', 'Oi', $assinatura), Assinaturas::aplicar('whatsapp_qr', 'Oi', $assinatura));
        Afirmar::igual('*Ana · Suporte*', Assinaturas::aplicar('whatsapp_qr', '', $assinatura));
        Afirmar::igual('Oi', Assinaturas::aplicar('whatsapp_qr', 'Oi', null));
        Afirmar::verdade(!method_exists(AdaptadorWhatsAppQr::class, 'comAssinatura'), 'o adaptador não deve assinar de novo');
    },
    'api oficial da meta na versao vigente' => function (): void {
        Afirmar::igual('v26.0', AdaptadorWhatsApp::VERSAO_API);
        Afirmar::igual('https://graph.facebook.com/v26.0', AdaptadorWhatsApp::BASE);
    },
    'resposta pelo celular nao reabre conversa resolvida' => function (): void {
        Seed::semear();
        $admin = Token::criar((int) Banco::valor("SELECT id FROM atendentes WHERE papel = 'admin'"));
        $canal = Banco::inserir('canais', [
            'nome' => 'QR', 'tipo' => 'whatsapp_qr', 'ativo' => true, 'credenciais' => Json::objeto(QR_ZAPI),
            'chave_publica' => null, 'segredo_webhook' => 'segredo-do-canal', 'criado_em' => Datas::agoraBanco(),
        ]);
        $entrega = ['type' => 'ReceivedCallback', 'phone' => '5511933334444', 'fromMe' => false, 'messageId' => 'E1', 'text' => ['message' => 'obrigado!']];
        [$status, $corpo] = pedir_qr('POST', "/webhooks/{$canal}", [], Json::codificar($entrega), ['token' => 'segredo-do-canal']);
        Afirmar::igual(200, $status);
        Afirmar::igual(1, $corpo['recebidas']);
        $conversa = (int) Banco::valor('SELECT id FROM conversas WHERE canal_id = ?', [$canal]);
        Banco::executar("UPDATE conversas SET status = 'resolvida' WHERE id = ?", [$conversa]);

        $doCelular = ['messageId' => 'C1', 'fromMe' => true, 'text' => ['message' => 'de nada 🙂']] + $entrega;
        [, $corpo] = pedir_qr('POST', "/webhooks/{$canal}", ['X-IHchat-Token' => 'segredo-do-canal'], Json::codificar($doCelular));
        Afirmar::igual(['recebidas' => 0, 'status_atualizados' => 0, 'enviadas_pelo_celular' => 1], $corpo);
        [, $detalhe] = pedir_qr('GET', "/api/conversas/{$conversa}", ['Authorization' => "Bearer {$admin}"]);
        Afirmar::igual('resolvida', $detalhe['status'], 'a resposta do dono não cria trabalho para a equipe');
        Afirmar::igual([$detalhe['contato']['nome'], 'Enviada pelo celular'], array_map(static fn (array $m) => $m['autor'], $detalhe['mensagens']));
        [$status] = pedir_qr('POST', "/webhooks/{$canal}", [], Json::codificar($entrega), ['token' => 'errado']);
        Afirmar::igual(401, $status);
    },
    'numero como o python o escreve' => function (): void {
        $casos = [
            [-23.561414213562372, '-23.561414213562372'], [-46.65588379999999, '-46.65588379999999'],
            [23.0, '23.0'], [-100.0, '-100.0'], [0.1, '0.1'], [1e-05, '1e-05'], [0.0001, '0.0001'],
            [1.5e16, '1.5e+16'], [1e16, '1e+16'], [9999999999999998.0, '9999999999999998.0'],
            [-0.0, '-0.0'], [5e-324, '5e-324'], [1.7976931348623157e308, '1.7976931348623157e+308'],
            [7, '7'], [null, 'None'], [true, 'None'],
        ];
        foreach ($casos as [$valor, $esperado]) {
            Afirmar::igual($esperado, Leitura::numero($valor), var_export($valor, true));
        }
    },
    'numero legivel e lid' => function (): void {
        Afirmar::igual('+55 (11) 98888-7777', Leitura::numeroLegivel('5511988887777'));
        Afirmar::igual('+14155550100', Leitura::numeroLegivel('14155550100'));
        Afirmar::verdade(Leitura::eLid('81896604192873@lid'));
        Afirmar::verdade(!Leitura::eLid('5511988887777') && !Leitura::eLid('@lid') && !Leitura::eLid(null));
    },
    'trocar a instancia apaga webhook, estado e numero' => function (): void {
        $atuais = QR_ZAPI + ['webhook_url' => 'https://x/webhooks/1', 'estado_conexao' => 'conectado', 'numero_conectado' => '5511'];
        Afirmar::igual($atuais, AdaptadorWhatsAppQr::semDadosDeOutraInstancia($atuais, $atuais + ['client_token' => 'outro']));
        $nova = ['instancia_id' => 'NOVA'] + $atuais;
        Afirmar::igual(array_diff_key($nova, array_flip(AdaptadorWhatsAppQr::CHAVES_DA_INSTANCIA)),
            AdaptadorWhatsAppQr::semDadosDeOutraInstancia($atuais, $nova));
        $evolucao = ['provedor' => 'evolution', 'url_servidor' => 'https://evo', 'nome_instancia' => 'a', 'webhook_url' => 'w'];
        // a mesma instância escrita com barra no fim continua sendo a mesma
        Afirmar::igual('w', AdaptadorWhatsAppQr::semDadosDeOutraInstancia($evolucao, ['url_servidor' => 'https://evo/'] + $evolucao)['webhook_url'] ?? null);
        Afirmar::verdade(!isset(AdaptadorWhatsAppQr::semDadosDeOutraInstancia($evolucao, ['nome_instancia' => 'b'] + $evolucao)['webhook_url']));
    },
    'endereco da evolution: https fora do sandbox, http so em localhost' => function (): void {
        Afirmar::igual(null, AdaptadorWhatsAppQr::problemaNoEnderecoEvolution('http://evo.exemplo.com'), 'no sandbox http passa');
        preparar_ambiente(['modo_sandbox' => false, 'chave_secreta' => str_repeat('k', 40)]);
        Afirmar::verdade(str_contains((string) AdaptadorWhatsAppQr::problemaNoEnderecoEvolution('http://evo.exemplo.com'), 'https://'));
        foreach (['http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080', 'https://evo.exemplo.com'] as $bom) {
            Afirmar::igual(null, AdaptadorWhatsAppQr::problemaNoEnderecoEvolution($bom), $bom);
        }
        Afirmar::verdade(str_starts_with((string) AdaptadorWhatsAppQr::problemaNoEnderecoEvolution('evo.exemplo.com'), 'precisa começar com https://'));
    },
    'midia: so endereco publico' => function (): void {
        $casos = [
            '93.184.216.34' => true, '2606:2800:220:1:248:1893:25c8:1946' => true,
            '127.0.0.1' => false, '10.1.2.3' => false, '172.16.0.1' => false, '192.168.0.10' => false,
            '169.254.169.254' => false, '100.64.0.1' => false, '0.0.0.0' => false, '224.0.0.1' => false,
            '::1' => false, 'fe80::1' => false, 'fd00::1' => false, '::ffff:127.0.0.1' => false, '::ffff:10.0.0.1' => false,
        ];
        foreach ($casos as $ip => $publico) {
            Afirmar::igual($publico, RedeExterna::enderecoPublico((string) $ip), (string) $ip);
        }
        Afirmar::lanca(ErroCanal::class, static fn () => RedeExterna::destinoConferido('http://127.0.0.1:3306/'),
            static fn (ErroCanal $e) => Afirmar::verdade(str_contains($e->getMessage(), 'rede interna')));
        Afirmar::lanca(ErroCanal::class, static fn () => RedeExterna::destinoConferido('http://localhost/x'));
    },
    'midia acima do limite de anexos para' => function (): void {
        preparar_ambiente(['tamanho_max_anexo_mb' => 1]);
        provedor_qr(static fn (string $metodo, string $url): RespostaHttp => new RespostaHttp(200, str_repeat('x', 1024 * 1024 + 1)));
        Afirmar::lanca(ErroCanal::class, static fn () => RedeExterna::baixar('https://storage.z-api.teste/v.mp4', 1024 * 1024),
            static fn (ErroCanal $e) => Afirmar::verdade(str_contains($e->getMessage(), 'limite de 1 MB')));
    },
];

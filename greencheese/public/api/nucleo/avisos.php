<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Avisos no WhatsApp: um número da loja (conectado num gateway) manda a mensagem num grupo privado com o celular que
// recebe e notifica. Motores trocáveis no painel:
// - 'zapi':      POST https://api.z-api.io/instances/{instancia}/token/{token}/send-text, cabeçalho Client-Token,
//                corpo {"phone": "<id-do-grupo>-group" | "<número>", "message": "..."};
// - 'evolution': POST {url}/message/sendText/{instancia}, cabeçalho apikey, corpo {"number": "<id>@g.us" | "<número>", "text": "..."};
// - 'webhook':   POST {url} com {"tipo", "texto", "dados"} e X-GC-Assinatura = HMAC-SHA256 do corpo (hex) com o segredo
//                (n8n, robô próprio);
// - 'nenhum':    desligado (nada entra na fila).
// Segredos (token, Client-Token, apikey, segredo do webhook) só no servidor: o painel recebe o final (•••1234).
// Cada aviso entra na fila (avisos_envios) junto com o que aconteceu (mesma transação) e sai DEPOIS da resposta
// (gc_depois): quem pediu não espera o gateway. Cada tentativa fica registrada (avisos_tentativas); falhou, tenta de
// novo sozinho em 1 min e em 5 min (quando o painel ou o site passam por aqui) e depois só pelo "Reenviar" do painel.
// Portas de saída pra qualquer mensagem: gc_whatsapp_enviar() (manda já, sem registro), gc_whatsapp_mandar() (manda já
// pra um número ou grupo e registra no histórico, sem guardar o texto se ele for segredo: o código de login das contas)
// e gc_aviso_enfileirar() (fila, com novas tentativas).

const GC_AVISO_MOTORES = ['nenhum', 'zapi', 'evolution', 'webhook'];
const GC_AVISO_NOME_MOTOR = ['nenhum' => 'Desligado', 'zapi' => 'Z-API', 'evolution' => 'Evolution API', 'webhook' => 'Webhook'];
/** O que pode avisar no grupo (o dono liga e desliga cada um). */
const GC_AVISO_EVENTOS = ['pedido', 'encomenda', 'rateio-reserva', 'rateio-pago'];
/** Novas tentativas sozinhas depois de uma falha (segundos); passou disso, só pelo painel. */
const GC_AVISO_ESPERAS = [60, 300];
const GC_DIAS_CURTOS = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];

// ─── ajustes ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Ajustes dos avisos com os segredos (só o servidor lê; nunca vai inteiro pro navegador). @return array<string, mixed> */
function gc_avisos_config(): array
{
    $padrao = [
        'motor' => 'nenhum',
        'destino' => ['tipo' => 'grupo', 'valor' => ''],
        'zapi' => ['instancia' => '', 'token' => '', 'clientToken' => ''],
        'evolution' => ['url' => '', 'instancia' => '', 'apikey' => ''],
        'webhook' => ['url' => '', 'segredo' => ''],
        'eventos' => array_fill_keys(GC_AVISO_EVENTOS, true),
        // endereço do painel pros links das mensagens: guardado quando o dono salva (o Host de um pedido do site quem
        // escreve é o aparelho; o do painel passou pela sessão e pelo Origin)
        'painel' => '',
        'atualizadoEm' => null,
    ];
    $bruto = gc_ajuste('avisos');
    $salvo = $bruto === null ? null : json_decode($bruto, true);
    $cfg = array_replace_recursive($padrao, is_array($salvo) ? $salvo : []);
    $cfg['motor'] = in_array($cfg['motor'], GC_AVISO_MOTORES, true) ? $cfg['motor'] : 'nenhum';
    return $cfg;
}

/** Só o final de um segredo ('1234'), ou null quando não tem. Curto demais pra mostrar o final: ''. */
function gc_final_segredo(string $s): ?string
{
    if ($s === '') {
        return null;
    }
    return strlen($s) >= 10 ? substr($s, -4) : '';
}

/** Endereço do webhook sem o caminho (que costuma ser o segredo do n8n): 'https://n8n.loja.com/•••a1b2'. */
function gc_url_mascarada(string $url): string
{
    $p = parse_url($url);
    if (!is_array($p) || !isset($p['host'])) {
        return '';
    }
    $base = $p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
    $resto = substr($url, strlen($base));
    return $resto === '' || $resto === '/' ? $base . $resto : $base . '/•••' . substr($resto, -4);
}

/** O que o painel vê: os segredos só com o final. @param array<string, mixed> $cfg */
function gc_avisos_config_publica(array $cfg): array
{
    return [
        'motor' => $cfg['motor'],
        'destino' => ['tipo' => (string) $cfg['destino']['tipo'], 'valor' => (string) $cfg['destino']['valor']],
        'zapi' => [
            'instancia' => (string) $cfg['zapi']['instancia'],
            'token' => gc_final_segredo((string) $cfg['zapi']['token']),
            'clientToken' => gc_final_segredo((string) $cfg['zapi']['clientToken']),
        ],
        'evolution' => [
            'url' => (string) $cfg['evolution']['url'],
            'instancia' => (string) $cfg['evolution']['instancia'],
            'apikey' => gc_final_segredo((string) $cfg['evolution']['apikey']),
        ],
        'webhook' => [
            'url' => gc_url_mascarada((string) $cfg['webhook']['url']),
            'temUrl' => (string) $cfg['webhook']['url'] !== '',
            'segredo' => gc_final_segredo((string) $cfg['webhook']['segredo']),
        ],
        'eventos' => array_map('boolval', array_intersect_key((array) $cfg['eventos'], array_flip(GC_AVISO_EVENTOS))),
        'atualizadoEm' => $cfg['atualizadoEm'] === null ? null : gc_iso((int) $cfg['atualizadoEm']),
    ];
}

/**
 * Destino do grupo ou número, do jeito que o gateway pede: grupo = só o ID (o que vem antes de "-group" ou "@g.us",
 * colado do Z-API, da Evolution ou do WhatsApp Web); número = 55 + DDD + 9 dígitos. null = não serve.
 */
function gc_destino_valor(string $tipo, mixed $v): ?string
{
    if (!is_string($v) && !is_int($v)) {
        return null;
    }
    $v = trim((string) $v);
    if ($tipo === 'numero') {
        return gc_whatsapp($v);
    }
    $v = (string) preg_replace('/(@g\.us|-group)$/i', '', $v);
    return preg_match('/^\d{10,25}(-\d{6,12})?$/', $v) === 1 ? $v : null;
}

/**
 * Destino da fila (coluna para): '' = o do painel; senão 'numero:5533…' ou 'grupo:<id>'. null = não serve.
 * @param array<string, mixed>|null $para
 */
function gc_para_guardar(?array $para): ?string
{
    if ($para === null) {
        return '';
    }
    $tipo = ($para['tipo'] ?? '') === 'numero' ? 'numero' : (($para['tipo'] ?? '') === 'grupo' ? 'grupo' : null);
    $valor = $tipo === null ? null : gc_destino_valor($tipo, $para['valor'] ?? '');
    return $valor === null ? null : "$tipo:$valor";
}

/** O destino guardado de volta no formato do gc_whatsapp_enviar (null = o do painel). @return array{tipo: string, valor: string}|null */
function gc_para_lido(string $guardado): ?array
{
    if (preg_match('/^(numero|grupo):(.+)$/', $guardado, $m) !== 1) {
        return null;
    }
    return ['tipo' => $m[1], 'valor' => $m[2]];
}

/** Envio pra endereço local (127.0.0.1, rede interna) e por http só no desenvolvimento e nos testes. */
function gc_envio_local_ok(): bool
{
    return gc_teste() || gc_desenvolvimento();
}

/** URL do gateway (Evolution, webhook): https, sem usuário/senha nem âncora. '' = apagar. null = não serve. */
function gc_url_envio(mixed $v, bool $comBusca): ?string
{
    if (!is_string($v)) {
        return null;
    }
    $v = trim($v);
    if ($v === '') {
        return '';
    }
    $p = parse_url($v);
    if (strlen($v) > 300 || !is_array($p) || !isset($p['scheme'], $p['host']) || isset($p['user']) || isset($p['pass']) || isset($p['fragment'])) {
        return null;
    }
    $esquema = strtolower($p['scheme']);
    if ($esquema !== 'https' && !($esquema === 'http' && gc_envio_local_ok())) {
        return null;
    }
    if (isset($p['query']) && !$comBusca) {
        return null;
    }
    return preg_match('/^[\x21-\x7E]+$/', $v) === 1 ? rtrim($v, '/') : null;
}

/** Faixas que nunca recebem envio (rede interna, loopback, link-local, CGNAT, multicast…), além das do filter_var. */
const GC_FAIXAS_INTERNAS = [
    '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24',
    '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4', '::/128', '::1/128', 'fc00::/7', 'fe80::/10', 'ff00::/8',
];

/** IP de rede interna, reservado ou de loopback? (o envio nunca vai pra dentro da hospedagem) */
function gc_ip_interno(string $ip): bool
{
    // '::ffff:10.0.0.1' conta como o IPv4 de dentro dele
    $ip = gc_ip_limpo($ip) ?? $ip;
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
        return true;
    }
    foreach (GC_FAIXAS_INTERNAS as $faixa) {
        if (gc_ip_na_faixa($ip, $faixa)) {
            return true;
        }
    }
    return false;
}

/**
 * Antes de pedir uma URL que o dono escreveu: o host tem que resolver só pra IP público (sem isso, um painel invadido
 * faria o servidor pedir coisa da rede de dentro). Devolve o IP pra fixar a conexão nele (o DNS não troca no meio), ou
 * lança. No desenvolvimento e nos testes vale tudo (os servidores falsos moram no 127.0.0.1).
 */
function gc_ip_do_envio(string $host): ?string
{
    if (gc_envio_local_ok()) {
        return null;
    }
    $host = trim($host, '[]');
    if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
        if (gc_ip_interno($host)) {
            throw new RuntimeException('endereço interno');
        }
        return $host;
    }
    $ips = @gethostbynamel($host) ?: [];
    if ($ips === [] && function_exists('dns_get_record')) {
        foreach (@dns_get_record($host, DNS_AAAA) ?: [] as $r) {
            if (isset($r['ipv6'])) {
                $ips[] = (string) $r['ipv6'];
            }
        }
    }
    if ($ips === []) {
        throw new RuntimeException('sem dns');
    }
    foreach ($ips as $ip) {
        if (gc_ip_interno($ip)) {
            throw new RuntimeException('endereço interno');
        }
    }
    return $ips[0];
}

// ─── saída ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * POST com tempo limite, sem seguir redirecionamento e lendo no máximo 8 KB da resposta.
 * @param list<string> $cabecalhos
 * @return array{status: int, corpo: string, erro: string, ms: int}
 */
function gc_http_post(string $url, array $cabecalhos, string $corpo, int $conexao, int $total, ?string $ipFixo = null): array
{
    $inicio = hrtime(true);
    if (function_exists('curl_init')) {
        $resposta = '';
        $c = curl_init($url);
        curl_setopt_array($c, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $corpo,
            CURLOPT_HTTPHEADER => $cabecalhos,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_CONNECTTIMEOUT => $conexao,
            CURLOPT_TIMEOUT => $total,
            CURLOPT_NOSIGNAL => true,
            CURLOPT_USERAGENT => 'GreenCheese-avisos',
            CURLOPT_WRITEFUNCTION => static function ($alca, string $pedaco) use (&$resposta): int {
                if (strlen($resposta) < 8192) {
                    $resposta .= substr($pedaco, 0, 8192 - strlen($resposta));
                }
                return strlen($pedaco);
            },
        ]);
        if ($ipFixo !== null) {
            $p = parse_url($url);
            $porta = $p['port'] ?? (strtolower((string) $p['scheme']) === 'https' ? 443 : 80);
            curl_setopt($c, CURLOPT_RESOLVE, [$p['host'] . ':' . $porta . ':' . (str_contains($ipFixo, ':') ? "[$ipFixo]" : $ipFixo)]);
        }
        curl_exec($c);
        $numero = curl_errno($c);
        $status = (int) curl_getinfo($c, CURLINFO_RESPONSE_CODE);
        // sem curl_close: desde o PHP 8 a alça fecha sozinha (no 8.5 a função fica obsoleta e daria aviso)
        $erro = $numero === 0 ? '' : ($numero === 28 ? 'tempo' : 'conexao');
        return ['status' => $numero === 0 ? $status : 0, 'corpo' => $resposta, 'erro' => $erro, 'ms' => (int) ((hrtime(true) - $inicio) / 1e6)];
    }
    // sem curl: o fopen do PHP (a Hostinger tem curl; aqui é só reserva)
    $ctx = stream_context_create([
        'http' => [
            'method' => 'POST', 'header' => implode("\r\n", $cabecalhos), 'content' => $corpo, 'timeout' => $total,
            'ignore_errors' => true, 'follow_location' => 0, 'user_agent' => 'GreenCheese-avisos',
        ],
    ]);
    $r = @file_get_contents($url, false, $ctx, 0, 8192);
    $cab = $http_response_header ?? [];
    $status = preg_match('#^HTTP/\S+\s+(\d{3})#', (string) ($cab[0] ?? ''), $m) === 1 ? (int) $m[1] : 0;
    $ms = (int) ((hrtime(true) - $inicio) / 1e6);
    return ['status' => $status, 'corpo' => is_string($r) ? $r : '', 'erro' => $status === 0 ? ($ms >= $total * 1000 - 50 ? 'tempo' : 'conexao') : '', 'ms' => $ms];
}

/**
 * Frase curta, em português, do que deu errado (pro painel). Nunca leva a URL (o token do Z-API mora nela) e tira os
 * segredos de qualquer texto que o gateway devolveu.
 * @param array{status: int, corpo: string, erro: string, ms: int} $r
 * @param list<string> $segredos
 */
function gc_aviso_erro(string $motor, array $r, array $segredos): string
{
    if ($r['erro'] === 'tempo') {
        return 'O ' . GC_AVISO_NOME_MOTOR[$motor] . ' não respondeu a tempo.';
    }
    if ($r['erro'] !== '' || $r['status'] === 0) {
        return 'Não deu pra conectar no ' . GC_AVISO_NOME_MOTOR[$motor] . '. Confere o endereço e a internet do servidor.';
    }
    $j = json_decode($r['corpo'], true);
    $dele = '';
    if (is_array($j)) {
        foreach (['message', 'error', 'erro', 'mensagem'] as $k) {
            $v = $j[$k] ?? ($j['response']['message'] ?? null);
            if (is_array($v)) {
                $v = implode(' ', array_filter($v, 'is_string'));
            }
            if (is_string($v) && trim($v) !== '') {
                $dele = trim($v);
                break;
            }
        }
    }
    foreach ($segredos as $s) {
        if (strlen($s) >= 4) {
            $dele = str_replace($s, '•••', $dele);
        }
    }
    $dele = gc_texto_curto($dele, 120);
    $junto = $dele === '' ? '' : " ($dele)";
    return match (true) {
        $r['status'] === 401 || $r['status'] === 403 => 'O ' . GC_AVISO_NOME_MOTOR[$motor] . ' recusou a chave: confere o token.' . $junto,
        $r['status'] === 404 => 'O ' . GC_AVISO_NOME_MOTOR[$motor] . ' não achou a instância (ou o endereço).' . $junto,
        $r['status'] >= 500 => 'O ' . GC_AVISO_NOME_MOTOR[$motor] . ' deu erro (HTTP ' . $r['status'] . '). Tenta de novo daqui a pouco.' . $junto,
        $r['status'] >= 200 && $r['status'] < 300 => 'O ' . GC_AVISO_NOME_MOTOR[$motor] . ' respondeu, mas não confirmou o envio.' . $junto,
        default => 'O ' . GC_AVISO_NOME_MOTOR[$motor] . ' recusou a mensagem (HTTP ' . $r['status'] . ').' . $junto,
    };
}

/**
 * Manda uma mensagem pelo motor configurado, NA HORA (sem fila), pro grupo da loja ou pra outro número/grupo.
 * $para: ['tipo' => 'grupo'|'numero', 'valor' => '<id do grupo>'|'5533991139036']; null = o destino do painel.
 * $tipo e $dados vão no webhook ({tipo, texto, dados}); nos outros motores só o texto sai. $curto = tempo limite curto
 * (o cliente ainda está esperando a resposta). É a mesma porta pro código de login das contas.
 * @param array<string, mixed>|null $para
 * @param array<string, mixed> $dados
 * @param array<string, mixed>|null $cfg ajustes (null = os salvos)
 * @return array{ok: bool, motor: string, http: int, ms: int, erro: string}
 */
function gc_whatsapp_enviar(string $texto, ?array $para = null, string $tipo = 'mensagem', array $dados = [], bool $curto = false, ?array $cfg = null): array
{
    $cfg ??= gc_avisos_config();
    $motor = (string) $cfg['motor'];
    $falha = static fn (string $erro): array => ['ok' => false, 'motor' => $motor, 'http' => 0, 'ms' => 0, 'erro' => $erro];
    if ($motor === 'nenhum') {
        return $falha('Os avisos tão desligados.');
    }
    $destino = $para ?? $cfg['destino'];
    $tipoDestino = ($destino['tipo'] ?? '') === 'numero' ? 'numero' : 'grupo';
    $valor = gc_destino_valor($tipoDestino, $destino['valor'] ?? '');
    if ($valor === null && $motor !== 'webhook') {
        return $falha('Falta o destino: o ID do grupo (ou o número) que recebe.');
    }
    [$conexao, $total] = $curto ? [2, 4] : [4, 10];
    $json = static fn (array $x): string => (string) json_encode($x, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    $ipFixo = null;
    $segredos = [];
    if ($motor === 'zapi') {
        $z = $cfg['zapi'];
        if ($z['instancia'] === '' || $z['token'] === '') {
            return $falha('Falta a instância ou o token do Z-API.');
        }
        $base = gc_teste() && is_string(getenv('GC_ZAPI_BASE')) && getenv('GC_ZAPI_BASE') !== '' ? rtrim((string) getenv('GC_ZAPI_BASE'), '/') : 'https://api.z-api.io';
        $url = $base . '/instances/' . rawurlencode((string) $z['instancia']) . '/token/' . rawurlencode((string) $z['token']) . '/send-text';
        $cab = ['Content-Type: application/json', 'Accept: application/json'];
        if ($z['clientToken'] !== '') {
            $cab[] = 'Client-Token: ' . $z['clientToken'];
        }
        $corpo = $json(['phone' => $tipoDestino === 'grupo' ? $valor . '-group' : $valor, 'message' => $texto]);
        $segredos = [(string) $z['token'], (string) $z['clientToken'], (string) $z['instancia']];
    } elseif ($motor === 'evolution') {
        $e = $cfg['evolution'];
        if ($e['url'] === '' || $e['instancia'] === '' || $e['apikey'] === '') {
            return $falha('Falta o endereço, a instância ou a apikey da Evolution.');
        }
        $url = $e['url'] . '/message/sendText/' . rawurlencode((string) $e['instancia']);
        $cab = ['Content-Type: application/json', 'Accept: application/json', 'apikey: ' . $e['apikey']];
        $corpo = $json(['number' => $tipoDestino === 'grupo' ? $valor . '@g.us' : $valor, 'text' => $texto]);
        $segredos = [(string) $e['apikey']];
    } else {
        $w = $cfg['webhook'];
        if ($w['url'] === '' || $w['segredo'] === '') {
            return $falha('Falta o endereço ou o segredo do webhook.');
        }
        $url = (string) $w['url'];
        if ($para !== null) {
            $dados = ['para' => ['tipo' => $tipoDestino, 'valor' => $valor]] + $dados;
        }
        $corpo = $json(['tipo' => $tipo, 'texto' => $texto, 'dados' => (object) $dados]);
        $cab = ['Content-Type: application/json', 'Accept: application/json', 'X-GC-Assinatura: ' . hash_hmac('sha256', $corpo, (string) $w['segredo'])];
        $segredos = [(string) $w['segredo']];
    }
    if ($motor !== 'zapi') {
        try {
            $ipFixo = gc_ip_do_envio((string) parse_url($url, PHP_URL_HOST));
        } catch (RuntimeException $e) {
            return $falha($e->getMessage() === 'sem dns' ? 'Não achei esse endereço na internet. Confere a URL.' : 'Esse endereço é da rede interna: não vale pra envio.');
        }
    }
    $r = gc_http_post($url, $cab, $corpo, $conexao, $total, $ipFixo);
    $ok = $r['erro'] === '' && $r['status'] >= 200 && $r['status'] < 300;
    if ($ok && $motor === 'zapi') {
        // o Z-API às vezes responde 200 com {"error": …} (instância desconectada)
        $j = json_decode($r['corpo'], true);
        $ok = !(is_array($j) && (isset($j['error']) || (isset($j['value']) && $j['value'] === false)));
    }
    return ['ok' => $ok, 'motor' => $motor, 'http' => $r['status'], 'ms' => $r['ms'], 'erro' => $ok ? '' : gc_aviso_erro($motor, $r, $segredos)];
}

/**
 * Manda AGORA (tempo limite curto) pra um número ou grupo e registra a tentativa no histórico dos avisos, sem fila nem
 * nova tentativa: pra quem precisa saber na hora se saiu (o código de login das contas). $registro é o que o histórico
 * do painel mostra no lugar do texto (ex.: "Código de login pra (33) 9••••-4567"): com ele, o texto de verdade nunca
 * fica guardado e o painel não reenvia. Chame FORA de transação (a espera do gateway não pode segurar o banco).
 * @param array{tipo: string, valor: string} $para
 * @param array<string, mixed> $dados vão no webhook ({tipo, texto, dados}); com $registro, não ficam guardados
 * @return array{ok: bool, motor: string, http: int, ms: int, erro: string, envio: int|null}
 */
function gc_whatsapp_mandar(string $texto, array $para, string $tipo, string $alvo = '', ?string $registro = null, array $dados = []): array
{
    $guardado = gc_para_guardar($para);
    if ($guardado === null || $guardado === '') {
        return ['ok' => false, 'motor' => (string) gc_avisos_config()['motor'], 'http' => 0, 'ms' => 0, 'erro' => 'Esse número (ou grupo) não serve.', 'envio' => null];
    }
    $agora = gc_agora();
    $id = gc_inserir(
        "INSERT INTO avisos_envios (tipo, alvo, para, texto, dados, reenvia, status, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, 'enviando', ?, ?)",
        [
            $tipo, $alvo, $guardado, $registro ?? $texto,
            $registro === null ? json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE) : '{}',
            $registro === null ? 1 : 0, $agora, $agora,
        ],
    );
    $r = gc_whatsapp_enviar($texto, gc_para_lido($guardado), $tipo, $dados, true);
    gc_aviso_registrar($id, $r, 1, null, 'sistema');
    return $r + ['envio' => $id];
}

/**
 * Grava uma tentativa e o resultado no aviso (enviado, ou falhou com a próxima tentativa sozinha).
 * @param array{ok: bool, motor: string, http: int, ms: int, erro: string} $r
 */
function gc_aviso_registrar(int $id, array $r, int $n, ?int $proxima, string $por): void
{
    $agora = gc_agora();
    gc_transacao(static function () use ($id, $agora, $r, $n, $proxima, $por): void {
        gc_sql(
            'INSERT INTO avisos_tentativas (envio_id, em, motor, ok, http, ms, erro, por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, $agora, $r['motor'], $r['ok'] ? 1 : 0, $r['http'], $r['ms'], $r['erro'], $por],
        );
        gc_sql(
            'UPDATE avisos_envios SET status = ?, motor = ?, tentativas = ?, erro = ?, atualizado_em = ?, tentar_em = ?, enviado_em = COALESCE(?, enviado_em) WHERE id = ?',
            [$r['ok'] ? 'enviado' : 'falhou', $r['motor'], $n, $r['erro'], $agora, $proxima, $r['ok'] ? $agora : null, $id],
        );
        // o registro não cresce sem fim: ficam as 20 últimas tentativas de cada aviso
        gc_sql('DELETE FROM avisos_tentativas WHERE envio_id = ? AND id NOT IN (SELECT id FROM avisos_tentativas WHERE envio_id = ? ORDER BY id DESC LIMIT 20)', [$id, $id]);
    });
}

// ─── fila ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Põe um aviso na fila (dentro da transação de quem chamou: se ela desfizer, o aviso some junto) e marca o envio pra
 * depois da resposta. Motor desligado, ou o evento desligado no painel: nada entra. $evento '' = sem chave no painel
 * (só depende do motor). $para null = o destino do painel (o grupo da loja); ou ['tipo' => 'numero'|'grupo', 'valor'].
 * @param array<string, mixed> $dados
 * @param array<string, mixed>|null $para
 */
function gc_aviso_enfileirar(string $evento, string $tipo, string $alvo, string $texto, array $dados = [], ?array $para = null): ?int
{
    $cfg = gc_avisos_config();
    $guardado = gc_para_guardar($para);
    if ($cfg['motor'] === 'nenhum' || ($evento !== '' && empty($cfg['eventos'][$evento])) || $guardado === null) {
        return null;
    }
    $agora = gc_agora();
    $id = gc_inserir(
        "INSERT INTO avisos_envios (tipo, alvo, para, texto, dados, status, criado_em, atualizado_em, tentar_em) VALUES (?, ?, ?, ?, ?, 'pendente', ?, ?, ?)",
        [$tipo, $alvo, $guardado, $texto, json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE), $agora, $agora, $agora],
    );
    gc_avisos_depois([$id]);
    return $id;
}

/**
 * Marca o envio dos avisos pra depois da resposta: os $ids deste pedido e os que estão esperando nova tentativa.
 * Sem nada pra mandar, não marca nada (as rotas do painel chamam a cada leitura).
 * @param list<int> $ids
 */
function gc_avisos_depois(array $ids): void
{
    static $fila = null;
    if ($fila === null) {
        $agora = gc_agora();
        $devido = gc_valor(
            "SELECT 1 FROM avisos_envios WHERE (status IN ('pendente','falhou') AND tentar_em IS NOT NULL AND tentar_em <= ?)
                OR (status = 'enviando' AND atualizado_em <= ?) LIMIT 1",
            [$agora, $agora - 120],
        );
        if ($ids === [] && $devido === null) {
            return;
        }
        $fila = [];
        gc_depois(static function (bool $solto) use (&$fila): void {
            gc_avisos_processar($fila, $solto);
        });
    }
    foreach ($ids as $id) {
        $fila[] = $id;
    }
}

/** Manda os avisos desta resposta e até 3 que estavam esperando nova tentativa. @param list<int> $ids */
function gc_avisos_processar(array $ids, bool $solto): void
{
    $agora = gc_agora();
    $devidos = gc_todos(
        "SELECT id FROM avisos_envios WHERE (status IN ('pendente','falhou') AND tentar_em IS NOT NULL AND tentar_em <= ?)
            OR (status = 'enviando' AND atualizado_em <= ?) ORDER BY id LIMIT 3",
        [$agora, $agora - 120],
    );
    foreach (array_unique([...$ids, ...array_map('intval', array_column($devidos, 'id'))]) as $id) {
        gc_aviso_tentar((int) $id, !$solto, 'sistema');
    }
}

/**
 * Uma tentativa de um aviso da fila. Pega o aviso com a trava (dois processos juntos não mandam em dobro), manda,
 * registra a tentativa e marca enviado ou falhou (com a próxima tentativa sozinha, se ainda tem). $forcar = o
 * "Reenviar" do painel, que manda até o que já foi.
 * @return array<string, mixed>|null o aviso como o painel vê (null = não existe)
 */
function gc_aviso_tentar(int $id, bool $curto, string $por, bool $forcar = false): ?array
{
    $agora = gc_agora();
    $l = gc_transacao(static function () use ($id, $agora, $forcar): ?array {
        $l = gc_um('SELECT * FROM avisos_envios WHERE id = ?', [$id]);
        if ($l === null) {
            return null;
        }
        $ocupado = $l['status'] === 'enviando' && (int) $l['atualizado_em'] > $agora - 120;
        if ($ocupado || ($l['status'] === 'enviado' && !$forcar) || !(bool) $l['reenvia']) {
            return ['_pular' => true];
        }
        gc_sql("UPDATE avisos_envios SET status = 'enviando', atualizado_em = ? WHERE id = ?", [$agora, $id]);
        return $l;
    });
    if ($l === null) {
        return null;
    }
    if (isset($l['_pular'])) {
        return gc_aviso_publico((array) gc_um('SELECT * FROM avisos_envios WHERE id = ?', [$id]));
    }
    $dados = json_decode((string) $l['dados'], true);
    $r = gc_whatsapp_enviar((string) $l['texto'], gc_para_lido((string) $l['para']), (string) $l['tipo'], is_array($dados) ? $dados : [], $curto);
    $n = (int) $l['tentativas'] + 1;
    $proxima = !$r['ok'] && $por === 'sistema' && isset(GC_AVISO_ESPERAS[$n - 1]) ? $agora + GC_AVISO_ESPERAS[$n - 1] : null;
    gc_aviso_registrar($id, $r, $n, $proxima, $por);
    return gc_aviso_publico((array) gc_um('SELECT * FROM avisos_envios WHERE id = ?', [$id]));
}

/**
 * Um aviso como o painel vê (com as últimas tentativas).
 * @param array<string, mixed> $l
 * @param array<int, list<array<string, mixed>>>|null $tentativas já buscadas (lista do painel)
 */
function gc_aviso_publico(array $l, ?array $tentativas = null): array
{
    $id = (int) $l['id'];
    $t = $tentativas[$id] ?? ($tentativas === null ? gc_todos('SELECT * FROM avisos_tentativas WHERE envio_id = ? ORDER BY id DESC LIMIT 5', [$id]) : []);
    return [
        'id' => $id,
        'tipo' => (string) $l['tipo'],
        'alvo' => (string) $l['alvo'],
        'para' => gc_para_lido((string) $l['para']),
        'reenvia' => (bool) $l['reenvia'],
        'texto' => (string) $l['texto'],
        'status' => (string) $l['status'],
        'motor' => (string) $l['motor'],
        'tentativas' => (int) $l['tentativas'],
        'erro' => (string) $l['erro'],
        'criadoEm' => gc_iso((int) $l['criado_em']),
        'atualizadoEm' => gc_iso((int) $l['atualizado_em']),
        'enviadoEm' => gc_iso(gc_int_ou_nulo($l['enviado_em'])),
        'tentarEm' => gc_iso(gc_int_ou_nulo($l['tentar_em'])),
        'ultimas' => array_map(static fn (array $x): array => [
            'em' => gc_iso((int) $x['em']), 'ok' => (bool) $x['ok'], 'motor' => (string) $x['motor'], 'http' => (int) $x['http'],
            'ms' => (int) $x['ms'], 'erro' => (string) $x['erro'], 'por' => (string) $x['por'],
        ], array_slice($t, 0, 5)),
    ];
}

/**
 * Pedido de exclusão (LGPD): os avisos de um alvo ('pedido:12', 'participacao:RAT-K8EA') perdem o texto e os dados
 * (nome, WhatsApp, endereço…), e o que ainda esperava nova tentativa para: nada mais sai deles.
 */
function gc_avisos_apagar_dados(string $alvo): void
{
    gc_sql(
        "UPDATE avisos_envios SET texto = 'Dados apagados (LGPD).', dados = '{}', reenvia = 0, tentar_em = NULL,
           status = CASE WHEN status = 'enviado' THEN 'enviado' ELSE 'falhou' END WHERE alvo = ?",
        [$alvo],
    );
}

/** Situação dos avisos pro Resumo e pra tela: ligado?, quantos falharam (7 dias), na fila e o último que chegou. */
function gc_avisos_situacao(): array
{
    $cfg = gc_avisos_config();
    $agora = gc_agora();
    return [
        'motor' => (string) $cfg['motor'],
        'ligado' => $cfg['motor'] !== 'nenhum',
        'falhas' => (int) gc_valor("SELECT COUNT(*) FROM avisos_envios WHERE status = 'falhou' AND criado_em > ?", [$agora - 7 * 86400]),
        'naFila' => (int) gc_valor("SELECT COUNT(*) FROM avisos_envios WHERE status IN ('pendente','enviando')"),
        'ultimoEnviado' => gc_iso(gc_int_ou_nulo(gc_valor("SELECT MAX(enviado_em) FROM avisos_envios WHERE status = 'enviado'"))),
    ];
}

// ─── as mensagens do grupo ──────────────────────────────────────────────────────────────────────────────────────

/** 'R$ 1.234,56' */
function gc_brl(int $centavos): string
{
    return 'R$ ' . number_format($centavos / 100, 2, ',', '.');
}

/** 'qua., 08/10 às 22:41' no horário de Brasília. */
function gc_quando_sp(int $t): string
{
    $d = (new DateTimeImmutable('@' . $t))->setTimezone(new DateTimeZone('America/Sao_Paulo'));
    return GC_DIAS_CURTOS[(int) $d->format('w')] . ', ' . $d->format('d/m') . ' às ' . $d->format('H:i');
}

/** Link de uma tela do painel ('#/pedido/12') no endereço que o dono usou ao salvar os avisos ('' sem ele). */
function gc_link_painel(string $tela): string
{
    $base = (string) (gc_avisos_config()['painel'] ?? '');
    return $base === '' ? '' : $base . $tela;
}

/** Endereço do painel de quem está pedindo agora (só numa rota do painel, que já conferiu sessão e Origin). */
function gc_endereco_painel(): string
{
    $host = gc_host();
    return $host === '' ? '' : (gc_https() ? 'https' : 'http') . '://' . $host . gc_caminho_site() . 'painel/';
}

/** "Rua X, 120, apto 201 — Centro · CEP 39800-000" (sem CEP: o que a pessoa digitou). @param array<string, mixed> $p */
function gc_aviso_endereco(array $p): string
{
    if ((string) $p['rua'] !== '') {
        $s = $p['rua'] . ((string) $p['numero'] !== '' ? ', ' . $p['numero'] : '') . ((string) $p['bairro'] !== '' ? ' — ' . $p['bairro'] : '');
        if ((string) $p['cep'] !== '') {
            $s .= ' · CEP ' . substr((string) $p['cep'], 0, 5) . '-' . substr((string) $p['cep'], 5);
        }
        if ((string) $p['cidade_entrega'] !== '' && gc_sem_acento((string) $p['cidade_entrega']) !== gc_sem_acento((string) $p['cidade'])) {
            $s .= ' · ' . $p['cidade_entrega'] . ((string) $p['uf_entrega'] !== '' ? '/' . strtoupper((string) $p['uf_entrega']) : '');
        }
        return $s;
    }
    return (string) $p['endereco'] !== '' ? (string) $p['endereco'] : 'a combinar';
}

/**
 * A mensagem do pedido no grupo: o cabeçalho com o código, de onde e quando; os itens (com o combo), o subtotal e o
 * cupom; entrega, pagamento, cliente e obs.; e o link do painel. Negrito/itálico do WhatsApp, sem emoji.
 * @param array<string, mixed> $p
 * @param array{codigo: string, trocou: bool, status: string}|null $antes o pedido de antes do mesmo aparelho
 */
function gc_aviso_texto_pedido(array $p, ?array $antes): string
{
    $enc = $p['tipo'] === 'encomenda';
    $atualizado = $antes !== null && $antes['trocou'];
    $titulo = $enc ? ($atualizado ? 'ENCOMENDA ATUALIZADA' : 'NOVA ENCOMENDA') : ($atualizado ? 'PEDIDO ATUALIZADO' : 'NOVO PEDIDO');
    $l = ["*$titulo* · #{$p['codigo']}", strtoupper((string) $p['uf']) . ((string) $p['cidade'] !== '' ? ' / ' . $p['cidade'] : '') . ' · ' . gc_quando_sp((int) $p['criado_em'])];
    if ($antes !== null) {
        $l[] = $atualizado
            ? "_Entra no lugar do #{$antes['codigo']}, que saiu da lista._"
            : "_O cliente mandou de novo depois do #{$antes['codigo']} (" . (GC_PEDIDO_ROTULO[$antes['status']] ?? $antes['status']) . '): confere os dois._';
    }
    $l[] = '';
    if ($enc) {
        $e = json_decode((string) $p['encomenda'], true);
        $e = is_array($e) ? $e : [];
        $l[] = '*Produto:* ' . ($e['produto'] ?? '');
        $l[] = '*Quantidade:* ' . ($e['quantidade'] ?? '');
        if (($e['referencia'] ?? '') !== '') {
            $l[] = '*Link/descrição:* ' . $e['referencia'];
        }
    } else {
        $l[] = '*Itens*';
        $consultar = false;
        foreach (gc_pedido_itens($p) as $i) {
            $consultar = $consultar || !isset($i['total']);
            $l[] = $i['qtd'] . 'x ' . $i['nome'] . ' — ' . (isset($i['total']) ? gc_brl((int) $i['total']) : 'preço a consultar') . (($i['combo'] ?? null) ? ' _(combo ' . $i['combo'] . ')_' : '');
        }
        $sub = $p['subtotal'] === null ? 'a consultar' : gc_brl((int) $p['subtotal']) . ($consultar ? ' + itens a consultar' : '');
        $l[] = "Subtotal: *$sub*";
        $cupom = $p['cupom'] === null ? null : json_decode((string) $p['cupom'], true);
        if (is_array($cupom)) {
            $l[] = 'Cupom: ' . $cupom['codigo'] . (($cupom['regra'] ?? '') !== '' ? ' — ' . $cupom['regra'] : '') . ' _(a loja confirma)_';
        }
        $l[] = '';
        $l[] = '*Entrega:* ' . gc_aviso_endereco($p) . ' _(taxa a confirmar)_';
        $pag = $p['pagamento'] === null ? 'a combinar' : GC_NOME_PAGAMENTO[(string) $p['pagamento']] ?? (string) $p['pagamento'];
        if ($p['pagamento'] === 'dinheiro') {
            $pag .= $p['troco'] === null ? ' (sem troco)' : ' (troco pra ' . gc_brl((int) $p['troco']) . ')';
        }
        $l[] = '*Pagamento:* ' . $pag;
    }
    $l[] = '*Cliente:* ' . $p['nome'] . ((string) $p['whatsapp'] !== '' ? ' · wa.me/' . $p['whatsapp'] : '');
    if ((string) $p['observacao'] !== '') {
        $l[] = '*Obs.:* ' . $p['observacao'];
    }
    $link = gc_link_painel('#/pedido/' . $p['id']);
    if ($link !== '') {
        $l[] = '';
        $l[] = 'Painel: ' . $link;
    }
    return implode("\n", $l);
}

/** Aviso de pedido ou encomenda nova (chamado dentro da transação que gravou o pedido). */
function gc_aviso_pedido(array $p, ?array $antes): void
{
    $enc = $p['tipo'] === 'encomenda';
    $tipo = ($enc ? 'encomenda' : 'pedido') . ($antes !== null && $antes['trocou'] ? '-atualizado' : '');
    gc_aviso_enfileirar($enc ? 'encomenda' : 'pedido', $tipo, 'pedido:' . $p['id'], gc_aviso_texto_pedido($p, $antes), ['pedido' => gc_pedido_admin($p)]);
}

/** "16/24 pagas · +5 reservadas" */
function gc_aviso_placar(string $rid, array $r): string
{
    $c = gc_contagem($rid);
    return $c['confirmadas'] . '/' . $r['vagas'] . ' pagas' . ($c['reservadas'] > 0 ? ' · +' . $c['reservadas'] . ($c['reservadas'] === 1 ? ' reservada' : ' reservadas') : '');
}

/** Alguém entrou num rateio pelo site (vaga reservada, esperando o pagamento). */
function gc_aviso_rateio_reserva(array $p, array $r): void
{
    $q = (int) $p['quantidade'];
    $l = [
        '*RATEIO · NOVA RESERVA* · ' . $p['codigo'],
        (string) $r['titulo'],
        $q . ($q === 1 ? ' vaga' : ' vagas') . ' × ' . gc_brl((int) $p['preco_unit']) . ' = *' . gc_brl($q * (int) $p['preco_unit']) . '*',
        '',
        '*Cliente:* ' . $p['nome'] . ' · wa.me/' . $p['whatsapp'],
        '*De:* ' . strtoupper((string) $p['uf']) . ((string) $p['cidade'] !== '' ? ' / ' . $p['cidade'] : ''),
        '*Guardada até:* ' . gc_quando_sp((int) $p['expira_em']) . ' _(esperando o pagamento)_',
        '*Placar:* ' . gc_aviso_placar((string) $r['id'], $r),
    ];
    $link = gc_link_painel('#/rateio/' . $r['id']);
    if ($link !== '') {
        array_push($l, '', 'Painel: ' . $link);
    }
    gc_aviso_enfileirar('rateio-reserva', 'rateio-reserva', 'participacao:' . $p['codigo'], implode("\n", $l), [
        'participante' => gc_participante_admin($p), 'rateio' => gc_rateio_publico($r, gc_contagem((string) $r['id'])),
    ]);
}

/** Pagamento de rateio confirmado (painel agora, Pix depois): o placar subiu. */
function gc_aviso_rateio_pago(array $p, array $r, bool $fechou, string $por): void
{
    $q = (int) $p['quantidade'];
    $quem = $por === 'pix' ? 'pelo Pix' : 'no painel' . (str_starts_with($por, 'painel:') ? ' (' . substr($por, 7) . ')' : '');
    $l = [
        '*RATEIO · PAGAMENTO CONFIRMADO* ✅ · ' . $p['codigo'],
        (string) $r['titulo'],
        $q . ($q === 1 ? ' vaga' : ' vagas') . ' · *' . gc_brl($q * (int) $p['preco_unit']) . '*',
        '',
        '*Cliente:* ' . $p['nome'],
        '*Placar:* ' . gc_aviso_placar((string) $r['id'], $r),
    ];
    if ($fechou) {
        $l[] = '*Lotou: o rateio fechou.* Hora de fazer o pedido.';
    }
    $l[] = "_Confirmado $quem._";
    $link = gc_link_painel('#/rateio/' . $r['id']);
    if ($link !== '') {
        array_push($l, '', 'Painel: ' . $link);
    }
    gc_aviso_enfileirar('rateio-pago', 'rateio-pago', 'participacao:' . $p['codigo'], implode("\n", $l), [
        'participante' => gc_participante_admin($p), 'rateio' => gc_rateio_publico($r, gc_contagem((string) $r['id'])), 'fechou' => $fechou,
    ]);
}

// ─── painel ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** GET admin-avisos: os ajustes (segredos só com o final), a situação e os últimos 50 avisos com as tentativas. */
function gc_rota_admin_avisos(): array
{
    gc_exigir_dono();
    gc_avisos_depois([]);
    $linhas = gc_todos('SELECT * FROM avisos_envios ORDER BY id DESC LIMIT 50');
    $tentativas = [];
    if ($linhas !== []) {
        $ids = array_column($linhas, 'id');
        $marcas = implode(',', array_fill(0, count($ids), '?'));
        foreach (gc_todos("SELECT * FROM avisos_tentativas WHERE envio_id IN ($marcas) ORDER BY id DESC", $ids) as $t) {
            $tentativas[(int) $t['envio_id']][] = $t;
        }
    }
    return [
        'agora' => gc_iso(gc_agora()),
        'config' => gc_avisos_config_publica(gc_avisos_config()),
        'situacao' => gc_avisos_situacao(),
        'envios' => array_map(static fn (array $l): array => gc_aviso_publico($l, $tentativas), $linhas),
    ];
}

/**
 * Lê um segredo do corpo: ausente ou '' = fica o de antes; null = apaga; texto = troca (conferido pelo padrão).
 * @param array<string, mixed> $bloco
 */
function gc_ler_segredo(array $bloco, string $chave, string $atual, string $padrao, string $campo, string $msg): string
{
    if (!array_key_exists($chave, $bloco) || $bloco[$chave] === '') {
        return $atual;
    }
    if ($bloco[$chave] === null) {
        return '';
    }
    $v = is_string($bloco[$chave]) ? trim($bloco[$chave]) : null;
    if ($v === null || preg_match($padrao, $v) !== 1) {
        throw gc_invalido($campo, $msg);
    }
    return $v;
}

/**
 * POST admin-avisos-salvar { motor, destino?, zapi?, evolution?, webhook?, eventos? }: campo ausente fica como está;
 * segredo vazio também (o painel nunca tem o de antes); null apaga. O motor escolhido tem que estar completo.
 */
function gc_rota_admin_avisos_salvar(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    return gc_transacao(static function () use ($c): array {
        $cfg = gc_avisos_config();
        $motor = $c['motor'] ?? $cfg['motor'];
        if (!is_string($motor) || !in_array($motor, GC_AVISO_MOTORES, true)) {
            throw gc_invalido('motor', 'Escolhe por onde os avisos saem.');
        }
        $cfg['motor'] = $motor;

        if (array_key_exists('destino', $c)) {
            $d = is_array($c['destino']) ? $c['destino'] : [];
            $tipo = $d['tipo'] ?? 'grupo';
            if ($tipo !== 'grupo' && $tipo !== 'numero') {
                throw gc_invalido('destino', 'O destino é um grupo ou um número.');
            }
            $bruto = $d['valor'] ?? '';
            $valor = $bruto === '' || $bruto === null ? '' : gc_destino_valor($tipo, $bruto);
            if ($valor === null) {
                throw gc_invalido('destino', $tipo === 'grupo' ? 'ID do grupo só com números (o que vem antes de "@g.us" ou "-group").' : 'Esse WhatsApp não fecha. Põe DDD + 9 dígitos.');
            }
            $cfg['destino'] = ['tipo' => $tipo, 'valor' => $valor];
        }

        if (is_array($c['zapi'] ?? null)) {
            $z = $c['zapi'];
            if (array_key_exists('instancia', $z)) {
                $v = is_string($z['instancia']) ? trim($z['instancia']) : null;
                if ($v === null || ($v !== '' && preg_match('/^[A-Za-z0-9]{6,64}$/', $v) !== 1)) {
                    throw gc_invalido('zapi.instancia', 'O ID da instância do Z-API é só letra e número (tá no painel do Z-API).');
                }
                $cfg['zapi']['instancia'] = $v;
            }
            $cfg['zapi']['token'] = gc_ler_segredo($z, 'token', (string) $cfg['zapi']['token'], '/^[A-Za-z0-9]{6,64}$/', 'zapi.token', 'O token da instância é só letra e número.');
            $cfg['zapi']['clientToken'] = gc_ler_segredo($z, 'clientToken', (string) $cfg['zapi']['clientToken'], '/^[A-Za-z0-9_\-]{6,128}$/', 'zapi.clientToken', 'O Client-Token (token de segurança da conta) é só letra, número e traço.');
        }

        if (is_array($c['evolution'] ?? null)) {
            $e = $c['evolution'];
            if (array_key_exists('url', $e)) {
                $cfg['evolution']['url'] = gc_url_envio($e['url'], false) ?? throw gc_invalido('evolution.url', 'Põe o endereço do servidor da Evolution com https:// (sem nada depois do domínio, a não ser a pasta).');
            }
            if (array_key_exists('instancia', $e)) {
                $v = is_string($e['instancia']) ? trim($e['instancia']) : null;
                if ($v === null || ($v !== '' && preg_match('/^[A-Za-z0-9_.@\- ]{1,64}$/', $v) !== 1)) {
                    throw gc_invalido('evolution.instancia', 'Nome da instância da Evolution: letra, número, ponto, traço (até 64).');
                }
                $cfg['evolution']['instancia'] = $v;
            }
            $cfg['evolution']['apikey'] = gc_ler_segredo($e, 'apikey', (string) $cfg['evolution']['apikey'], '/^[\x21-\x7E]{6,200}$/', 'evolution.apikey', 'A apikey vai sem espaço (de 6 a 200 caracteres).');
        }

        if (is_array($c['webhook'] ?? null)) {
            $w = $c['webhook'];
            // o endereço do webhook volta pro painel mascarado (o caminho costuma ser o segredo): vazio fica o de antes
            if (array_key_exists('url', $w) && $w['url'] !== '') {
                $cfg['webhook']['url'] = $w['url'] === null ? '' : (gc_url_envio($w['url'], true) ?? throw gc_invalido('webhook.url', 'Põe o endereço do webhook com https://.'));
            }
            $cfg['webhook']['segredo'] = gc_ler_segredo($w, 'segredo', (string) $cfg['webhook']['segredo'], '/^[\x21-\x7E]{16,200}$/', 'webhook.segredo', 'O segredo vai sem espaço, com 16 caracteres ou mais.');
        }

        if (is_array($c['eventos'] ?? null)) {
            foreach (GC_AVISO_EVENTOS as $ev) {
                if (array_key_exists($ev, $c['eventos'])) {
                    if (!is_bool($c['eventos'][$ev])) {
                        throw gc_invalido('eventos', 'Cada aviso é ligado ou desligado.');
                    }
                    $cfg['eventos'][$ev] = $c['eventos'][$ev];
                }
            }
        }

        // o motor escolhido tem que conseguir mandar
        $falta = match ($motor) {
            'zapi' => $cfg['zapi']['instancia'] === '' ? ['zapi.instancia', 'Falta o ID da instância do Z-API.'] : ($cfg['zapi']['token'] === '' ? ['zapi.token', 'Falta o token da instância do Z-API.'] : null),
            'evolution' => $cfg['evolution']['url'] === '' ? ['evolution.url', 'Falta o endereço da Evolution.'] : ($cfg['evolution']['instancia'] === '' ? ['evolution.instancia', 'Falta o nome da instância.'] : ($cfg['evolution']['apikey'] === '' ? ['evolution.apikey', 'Falta a apikey.'] : null)),
            'webhook' => $cfg['webhook']['url'] === '' ? ['webhook.url', 'Falta o endereço do webhook.'] : ($cfg['webhook']['segredo'] === '' ? ['webhook.segredo', 'Falta o segredo do webhook.'] : null),
            default => null,
        };
        if ($falta === null && ($motor === 'zapi' || $motor === 'evolution') && $cfg['destino']['valor'] === '') {
            $falta = ['destino', 'Falta o grupo (ou o número) que recebe os avisos.'];
        }
        if ($falta !== null) {
            throw gc_invalido($falta[0], $falta[1]);
        }
        $cfg['painel'] = gc_endereco_painel();
        $cfg['atualizadoEm'] = gc_agora();
        gc_ajuste_definir('avisos', (string) json_encode($cfg, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        gc_evento('painel', 'avisos-ajustados', 'avisos', ['motor' => $motor]);
        return ['config' => gc_avisos_config_publica($cfg), 'situacao' => gc_avisos_situacao()];
    });
}

/** POST admin-avisos-testar {}: manda uma mensagem de teste agora, com os ajustes salvos, e devolve o resultado. */
function gc_rota_admin_avisos_testar(): array
{
    $s = gc_exigir_dono();
    gc_corpo();
    gc_limite('avisos-teste', gc_chave_limite('usuario', (string) $s['usuario_id']), 20, 600, 'Muito teste seguido. Espera uns minutos.');
    $cfg = gc_avisos_config();
    if ($cfg['motor'] === 'nenhum') {
        throw new ErroApi('avisos-desligados', 'Os avisos tão desligados: escolhe Z-API, Evolution ou webhook e salva antes.', 409);
    }
    $texto = implode("\n", [
        '*TESTE DE AVISO* · Green Cheese',
        'Se chegou aqui, os avisos tão funcionando ✅',
        '_' . GC_AVISO_NOME_MOTOR[$cfg['motor']] . ' · ' . gc_quando_sp(gc_agora()) . '_',
    ]);
    $agora = gc_agora();
    $id = gc_inserir(
        "INSERT INTO avisos_envios (tipo, alvo, texto, dados, status, criado_em, atualizado_em) VALUES ('teste', 'avisos', ?, '{}', 'pendente', ?, ?)",
        [$texto, $agora, $agora],
    );
    return ['envio' => gc_aviso_tentar($id, false, 'painel:' . $s['login'])];
}

/** POST admin-aviso-reenviar { id }: manda de novo agora (até o que já foi), com os ajustes de agora. */
function gc_rota_admin_aviso_reenviar(): array
{
    $s = gc_exigir_dono();
    $c = gc_corpo();
    gc_limite('avisos-teste', gc_chave_limite('usuario', (string) $s['usuario_id']), 20, 600, 'Muito envio seguido. Espera uns minutos.');
    $n = gc_inteiro($c['id'] ?? null, 1, PHP_INT_MAX >> 1);
    $l = $n === null ? null : gc_um('SELECT id, reenvia FROM avisos_envios WHERE id = ?', [$n]);
    if ($l === null) {
        throw new ErroApi('nao-encontrado', 'Aviso não encontrado.', 404);
    }
    if (!(bool) $l['reenvia']) {
        throw new ErroApi('nao-reenvia', 'Esse aviso não dá pra mandar de novo daqui (o texto dele não fica guardado).', 409);
    }
    if (gc_avisos_config()['motor'] === 'nenhum') {
        throw new ErroApi('avisos-desligados', 'Os avisos tão desligados: escolhe Z-API, Evolution ou webhook e salva antes.', 409);
    }
    return ['envio' => gc_aviso_tentar($n, false, 'painel:' . $s['login'], true)];
}

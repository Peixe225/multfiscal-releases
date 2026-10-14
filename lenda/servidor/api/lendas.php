<?php
/**
 * LENDA · GET /lenda/api/lendas.php — números atualizados de Messi e Cristiano Ronaldo.
 *
 * Arquivo independente (não usa _lib.php; contrato em servidor/CONTRATO.md). Busca no servidor, no máximo
 * a cada 6 h, o arquivo de dados público do MessivsRonaldo.app (gerado pelo Gatsby):
 *   https://www.messivsronaldo.app/page-data/index/page-data.json
 *     result.data.allSheetMessiAllTimeStats.edges[].node    linhas por competição (apps, goals, assists…)
 *     result.data.allSheetRonaldoAllTimeStats.edges[].node  idem
 *     result.data.allSheetHonours.edges[].node              tabela de honras: honour, mcount/myears, rcount/ryears
 * converte para o formato do jogo e guarda em dirname(__DIR__, 3)/lenda-cache/lendas.json (fora do
 * public_html). Se a busca falhar, responde o último cache com "desatualizado": true; sem cache, 503.
 * Nenhum dado de usuário passa por aqui (nem cookie, nem IP).
 *
 * PHP 8.1+. Teste local: php -S 127.0.0.1:8790 -t <pasta com lenda/api/lendas.php>
 */
declare(strict_types=1);

const LENDAS_FONTE_URL = 'https://www.messivsronaldo.app/page-data/index/page-data.json';
const LENDAS_SITE_URL = 'https://www.messivsronaldo.app/';
const LENDAS_UA = 'LENDA/1.0 (+https://oprojeto.online/lenda/)';
const LENDAS_TTL_S = 6 * 3600;        // busca nova no máximo a cada 6 h
const LENDAS_RETRY_S = 10 * 60;       // depois de uma falha, só tenta de novo em 10 min (cada tentativa espera até 8 s)
const LENDAS_TIMEOUT_S = 8;
const LENDAS_MAX_BYTES = 4 * 1024 * 1024;

/** Linhas coletivas da tabela de honras (a soma é o "Total Trophies" do site). */
const LENDAS_COLETIVOS = [
    'League Titles', 'Domestic Cup', 'Domestic Super Cup', 'UEFA Super Cup', 'Club World Cup', 'Champions League',
    'Other Official Club Titles', 'Full Senior International', 'Other Official International',
];

function lendas_responder(int $status, array $corpo, string $cache = 'no-store'): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: ' . $cache);
    header('X-Content-Type-Options: nosniff');
    echo json_encode($corpo, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function lendas_pasta(): string
{
    return dirname(__DIR__, 3) . '/lenda-cache';
}

/** Lê o cache convertido (ou null). */
function lendas_ler_cache(string $arquivo): ?array
{
    if (!is_file($arquivo)) return null;
    $txt = @file_get_contents($arquivo);
    if ($txt === false) return null;
    $j = json_decode($txt, true);
    return is_array($j) && isset($j['lendas']['messi'], $j['lendas']['cristiano-ronaldo']) ? $j : null;
}

/** GET com timeout de 8 s (curl quando houver; senão, stream do PHP). Devolve o corpo ou null. */
function lendas_baixar(string $url): ?string
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_CONNECTTIMEOUT => LENDAS_TIMEOUT_S,
            CURLOPT_TIMEOUT => LENDAS_TIMEOUT_S,
            CURLOPT_USERAGENT => LENDAS_UA,
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_ENCODING => '',
        ]);
        $corpo = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return is_string($corpo) && $status === 200 && strlen($corpo) <= LENDAS_MAX_BYTES ? $corpo : null;
    }
    $ctx = stream_context_create(['http' => [
        'method' => 'GET',
        'timeout' => LENDAS_TIMEOUT_S,
        'header' => "User-Agent: " . LENDAS_UA . "\r\nAccept: application/json\r\n",
        'ignore_errors' => true,
    ]]);
    $corpo = @file_get_contents($url, false, $ctx, 0, LENDAS_MAX_BYTES + 1);
    $linha = $http_response_header[0] ?? '';
    return is_string($corpo) && preg_match('#^HTTP/\S+\s+200\b#', $linha) && strlen($corpo) <= LENDAS_MAX_BYTES ? $corpo : null;
}

/** "1.179" / "1179" / 1179 / "-" → inteiro (o "-" da tabela é "não se aplica" = 0). */
function lendas_int(mixed $v): int
{
    if (is_int($v)) return max(0, $v);
    if (is_float($v)) return max(0, (int) round($v));
    $s = preg_replace('/[^0-9]/', '', (string) $v);
    return $s === '' ? 0 : (int) $s;
}

/** Converte o page-data do Gatsby no formato do jogo. Lança se o arquivo não tiver a forma esperada. */
function lendas_converter(string $json): array
{
    $d = json_decode($json, true, 64);
    $data = is_array($d) ? ($d['result']['data'] ?? null) : null;
    if (!is_array($data)) throw new RuntimeException('formato');
    $linhas = function (string $chave) use ($data): array {
        $out = [];
        foreach (($data[$chave]['edges'] ?? []) as $e) {
            $n = $e['node'] ?? null;
            if (is_array($n) && isset($n['competition'])) $out[(string) $n['competition']] = $n;
        }
        return $out;
    };
    $honras = [];
    foreach (($data['allSheetHonours']['edges'] ?? []) as $e) {
        $n = $e['node'] ?? null;
        if (is_array($n) && isset($n['honour'])) $honras[] = $n;
    }
    if (!$honras) throw new RuntimeException('honras');

    $jogador = function (string $statsChave, string $c, string $a) use ($linhas, $honras): array {
        $st = $linhas($statsChave);
        $car = $st['All Time Career'] ?? null;
        if (!$car) throw new RuntimeException('carreira');
        $premios = [];
        $titulos = 0;
        $bolas = 0;
        foreach ($honras as $h) {
            $nome = trim((string) $h['honour']);
            $n = lendas_int($h[$c] ?? 0);
            $anos = isset($h[$a]) && $h[$a] !== null ? trim((string) $h[$a]) : '';
            $premios[] = ['nome' => $nome, 'n' => $n, 'anos' => $anos];
            if (in_array($nome, LENDAS_COLETIVOS, true)) $titulos += $n;
            if ($nome === "Ballon d'Or") $bolas = $n;
        }
        $nat = $st['All Time Internationals'] ?? [];
        return [
            'jogos' => lendas_int($car['apps'] ?? 0),
            'gols' => lendas_int($car['goals'] ?? 0),
            'assistencias' => lendas_int($car['assists'] ?? 0),
            'golsSelecao' => lendas_int($nat['goals'] ?? 0),
            'jogosSelecao' => lendas_int($nat['apps'] ?? 0),
            'golsChampions' => lendas_int(($st['All Time Champions League'] ?? [])['goals'] ?? 0),
            'golsCopa' => lendas_int(($st['World Cup'] ?? [])['goals'] ?? 0),
            'titulos' => $titulos,
            'bolasOuro' => $bolas,
            'premios' => $premios,
        ];
    };
    $messi = $jogador('allSheetMessiAllTimeStats', 'mcount', 'myears');
    $cr7 = $jogador('allSheetRonaldoAllTimeStats', 'rcount', 'ryears');
    // conferência mínima: números de carreira plausíveis (um arquivo quebrado não vira "verdade" no Hall)
    foreach ([$messi, $cr7] as $j) {
        if ($j['jogos'] < 1000 || $j['gols'] < 800 || $j['gols'] > $j['jogos'] || $j['titulos'] < 20) throw new RuntimeException('valores');
    }
    return [
        'fonte' => 'MessivsRonaldo.app',
        'url' => LENDAS_SITE_URL,
        'buscadoEm' => gmdate('Y-m-d\TH:i:s\Z'),
        'lendas' => ['messi' => $messi, 'cristiano-ronaldo' => $cr7],
    ];
}

/** Grava sem deixar arquivo pela metade (temporário + rename). */
function lendas_gravar(string $arquivo, string $conteudo): bool
{
    $tmp = $arquivo . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (@file_put_contents($tmp, $conteudo, LOCK_EX) === false) return false;
    if (!@rename($tmp, $arquivo)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

// ── rota ──
$metodo = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($metodo !== 'GET' && $metodo !== 'HEAD') {
    header('Allow: GET, HEAD');
    lendas_responder(405, ['erro' => 'metodo', 'mensagem' => 'Use GET.']);
}

$pasta = lendas_pasta();
$arquivo = $pasta . '/lendas.json';
$falha = $pasta . '/lendas.falha';
if (!is_dir($pasta)) @mkdir($pasta, 0755, true);

$cache = lendas_ler_cache($arquivo);
$idade = $cache ? time() - (int) @filemtime($arquivo) : PHP_INT_MAX;
$falhouHa = is_file($falha) ? time() - (int) @filemtime($falha) : PHP_INT_MAX;
$publico = 'public, max-age=3600';

if ($cache && $idade < LENDAS_TTL_S) lendas_responder(200, $cache, $publico);

// uma busca por vez: quem não pega a trava serve o que tiver
$trava = @fopen($pasta . '/lendas.lock', 'c');
$comTrava = $trava && flock($trava, LOCK_EX | LOCK_NB);
if ($comTrava && $falhouHa >= LENDAS_RETRY_S) {
    $novo = null;
    // LENDA_LENDAS_FONTE: só para o teste local (simular falha da fonte); em produção não existe
    $fonte = getenv('LENDA_LENDAS_FONTE') ?: LENDAS_FONTE_URL;
    $corpo = lendas_baixar($fonte);
    if ($corpo !== null) {
        try {
            $novo = lendas_converter($corpo);
        } catch (Throwable) {
            $novo = null;
        }
    }
    if ($novo) {
        lendas_gravar($arquivo, json_encode($novo, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        if (is_file($falha)) @unlink($falha);
        flock($trava, LOCK_UN);
        lendas_responder(200, $novo, $publico);
    }
    @touch($falha);
}
if ($comTrava) flock($trava, LOCK_UN);

if ($cache) {
    $cache['desatualizado'] = $idade >= LENDAS_TTL_S;
    lendas_responder(200, $cache, $cache['desatualizado'] ? 'public, max-age=600' : $publico);
}
lendas_responder(503, ['erro' => 'indisponivel', 'mensagem' => 'Os números atualizados não estão disponíveis agora.'], 'no-store');

<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Diagnóstico do servidor (painel): PHP, extensões, pastas, limites de envio e — com curl — se a web enxerga o que
// não devia (o banco, o log, os módulos, o instalacao.php e um .php dentro de uploads/). É a prova de que o
// .htaccess funciona na hospedagem de verdade, depois de publicado.

/** Pede várias URLs de uma vez (até 4 KB de cada). @param array<string, string> $urls @return array<string, array{status: int, corpo: string, erro: string}> */
function gc_buscar_varias(array $urls): array
{
    $multi = curl_multi_init();
    $alcas = [];
    $corpos = [];
    foreach ($urls as $k => $url) {
        $corpos[$k] = '';
        $c = curl_init($url);
        curl_setopt_array($c, [
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_TIMEOUT => 6,
            CURLOPT_USERAGENT => 'GreenCheese-diagnostico',
            CURLOPT_HTTPHEADER => ['Cache-Control: no-cache'],
            CURLOPT_WRITEFUNCTION => static function ($c, string $pedaco) use (&$corpos, $k): int {
                if (strlen($corpos[$k]) < 4096) {
                    $corpos[$k] .= substr($pedaco, 0, 4096 - strlen($corpos[$k]));
                    return strlen($pedaco);
                }
                return 0; // já basta: corta o resto
            },
        ]);
        curl_multi_add_handle($multi, $c);
        $alcas[$k] = $c;
    }
    $rodando = 0;
    do {
        $st = curl_multi_exec($multi, $rodando);
        if ($rodando > 0) {
            curl_multi_select($multi, 0.5);
        }
    } while ($rodando > 0 && $st === CURLM_OK);
    $out = [];
    foreach ($alcas as $k => $c) {
        $status = (int) curl_getinfo($c, CURLINFO_RESPONSE_CODE);
        $erro = curl_errno($c) === 23 ? '' : curl_error($c);
        $out[$k] = ['status' => $status, 'corpo' => $corpos[$k], 'erro' => $erro];
        curl_multi_remove_handle($multi, $c);
        curl_close($c);
    }
    curl_multi_close($multi);
    return $out;
}

/** GET admin-diagnostico */
function gc_rota_admin_diagnostico(): array
{
    gc_exigir_dono();
    $avisos = [];
    $phpOk = version_compare(PHP_VERSION, '8.1.0', '>=');
    if (!$phpOk) {
        $avisos[] = 'PHP abaixo do 8.1: troca a versão no hPanel.';
    }
    $gd = extension_loaded('gd');
    $webp = gc_gd_webp();
    if (!$gd) {
        $avisos[] = 'Sem GD: as imagens sobem do jeito que vieram (sem ajustar tamanho).';
    } elseif (!$webp) {
        $avisos[] = 'GD sem WebP: as imagens ficam em JPG/PNG.';
    }

    $dados = gc_pasta_dados();
    $banco = $dados . '/loja.sqlite';
    $modo = (string) gc_db()->query('PRAGMA journal_mode')->fetchColumn();
    $uploads = gc_pasta_uploads();
    try {
        // a pasta nasce aqui se ainda não existe (com o .htaccess dela), pra sonda do .php rodar
        gc_preparar_pasta($uploads, GC_HTACCESS_UPLOADS, false);
    } catch (Throwable) {
        // sem escrita: o aviso sai logo abaixo
    }
    // sem GLOB_BRACE: não existe em todo sistema (musl, Alpine)
    $arquivos = [];
    foreach (is_dir($uploads) ? (scandir($uploads) ?: []) : [] as $n) {
        if (preg_match('/^[a-z0-9]{8,64}\.(webp|jpe?g|png)$/', $n)) {
            $arquivos[] = $uploads . '/' . $n;
        }
    }
    if (!is_writable($dados)) {
        $avisos[] = 'A pasta de dados não aceita escrita.';
    }
    if (is_dir($uploads) ? !is_writable($uploads) : !is_writable(dirname($uploads))) {
        $avisos[] = 'A pasta uploads/ não aceita escrita: o envio de imagem não vai funcionar.';
    }

    $web = gc_diagnostico_web($uploads);
    foreach ($web['itens'] as $i) {
        if ($i['ok'] === false) {
            $avisos[] = $i['nome'] === 'api' ? 'A API não respondeu pelo próprio endereço.' : "A web tá enxergando {$i['nome']}: confere o .htaccess dessa pasta.";
        }
    }
    if (!$web['testado']) {
        $avisos[] = 'Não deu pra testar pela web (' . $web['motivo'] . ').';
    } elseif (!in_array('php em uploads/', array_column($web['itens'], 'nome'), true)) {
        $avisos[] = 'Não deu pra testar se um .php roda em uploads/ (a pasta não aceita escrita).';
    }
    if (!gc_https() && !gc_desenvolvimento()) {
        $avisos[] = 'O painel tá abrindo sem HTTPS.';
    }
    $rede = gc_rede_diagnostico();
    if (!$rede['certo']) {
        $avisos[] = "O servidor vê o IP da CDN ({$rede['remoto']}) e não o de quem acessa: os limites de tentativa (entrar no rateio, senha do painel) ficam valendo pra todo mundo junto. Avisa quem cuida do site (PENDÊNCIAS, “IP do cliente”).";
    } elseif (!$rede['proxyNaFrente'] && $rede['site24h']['pedidos'] >= 20 && $rede['site24h']['ips'] === 1) {
        $avisos[] = "Os {$rede['site24h']['pedidos']} pedidos do site nas últimas 24 h vieram todos do mesmo IP: se não foi uma pessoa só testando, o servidor tá vendo o IP da CDN e os limites de tentativa ficam valendo pra todo mundo junto.";
    }

    $maximo = gc_envio_maximo();
    return [
        'versaoApi' => GC_API,
        'agora' => gc_iso(gc_agora()),
        'php' => ['versao' => PHP_VERSION, 'ok' => $phpOk, 'sapi' => PHP_SAPI],
        'extensoes' => [
            'pdo_sqlite' => extension_loaded('pdo_sqlite'),
            'sqlite' => (string) gc_db()->query('SELECT sqlite_version()')->fetchColumn(),
            'gd' => $gd,
            'webp' => $webp,
            'exif' => function_exists('exif_read_data'),
            'fileinfo' => extension_loaded('fileinfo'),
            'mbstring' => extension_loaded('mbstring'),
            'openssl' => extension_loaded('openssl'),
            'curl' => extension_loaded('curl'),
        ],
        'dados' => [
            'gravavel' => is_writable($dados),
            'bancoBytes' => is_file($banco) ? (int) filesize($banco) : 0,
            'diario' => $modo,
            'versaoBanco' => (int) gc_db()->query('PRAGMA user_version')->fetchColumn(),
        ],
        'uploads' => [
            'existe' => is_dir($uploads),
            'gravavel' => is_dir($uploads) ? is_writable($uploads) : is_writable(dirname($uploads)),
            'arquivos' => count($arquivos),
            'bytes' => array_sum(array_map(static fn (string $a): int => (int) filesize($a), $arquivos)),
        ],
        'limites' => [
            'upload_max_filesize' => (string) ini_get('upload_max_filesize'),
            'post_max_size' => (string) ini_get('post_max_size'),
            'memory_limit' => (string) ini_get('memory_limit'),
            'max_execution_time' => (string) ini_get('max_execution_time'),
            'envioMaximo' => $maximo,
            'envioMaximoTexto' => gc_mb($maximo),
        ],
        'https' => gc_https(),
        'rede' => $rede,
        'instalacao' => ['codigoDev' => gc_instalacao_dev()],
        'web' => $web,
        'avisos' => $avisos,
    ];
}

/** IP pra mostrar sem ele inteiro: '177.38.12.x' · '2804:14c:5b2a:…'. */
function gc_ip_mascarado(string $ip): string
{
    $bin = @inet_pton(trim($ip));
    if (!is_string($bin)) {
        return trim($ip) === '' ? '' : '?';
    }
    if (strlen($bin) === 16 && str_starts_with($bin, str_repeat("\0", 10) . "\xff\xff")) {
        $bin = substr($bin, 12);
    }
    if (strlen($bin) === 4) {
        $p = explode('.', (string) inet_ntop($bin));
        return "{$p[0]}.{$p[1]}.{$p[2]}.x";
    }
    $grupos = array_map(static fn (string $g): string => ltrim($g, '0') ?: '0', str_split(bin2hex($bin), 4));
    return implode(':', array_slice($grupos, 0, 3)) . ':…';
}

/**
 * Que IP o servidor usa nos limites de tentativa e se tem CDN ou proxy na frente. O pedido do Diagnóstico vem do
 * aparelho do dono: chegou cabeçalho de encaminhamento sem o REMOTE_ADDR dentro, o REMOTE_ADDR é de quem repassou (a
 * CDN). Sem segredo na resposta: IP de gente sai mascarado; o da CDN sai inteiro (é ele que vai pro GC_PROXIES).
 * Também: de quantos IPs diferentes (pelo hash do limite, nada em claro) vieram os pedidos do site nas últimas 24 h.
 * @return array{remoto: string, proxyNaFrente: bool, confiavel: bool, usado: string, certo: bool, cabecalhos: list<array{nome: string, ips: list<string>}>, site24h: array{pedidos: int, ips: int}}
 */
function gc_rede_diagnostico(): array
{
    $remoto = gc_ip_limpo((string) ($_SERVER['REMOTE_ADDR'] ?? '')) ?? '';
    $nomes = [
        'X-Forwarded-For' => 'HTTP_X_FORWARDED_FOR', 'X-Real-IP' => 'HTTP_X_REAL_IP', 'Forwarded' => 'HTTP_FORWARDED',
        'CF-Connecting-IP' => 'HTTP_CF_CONNECTING_IP', 'True-Client-IP' => 'HTTP_TRUE_CLIENT_IP', 'X-Client-IP' => 'HTTP_X_CLIENT_IP',
    ];
    $cabecalhos = [];
    $todos = [];
    foreach ($nomes as $nome => $chave) {
        $v = $_SERVER[$chave] ?? null;
        if (!is_string($v) || trim($v) === '') {
            continue;
        }
        // Forwarded (RFC 7239): os "for=" de cada salto; os outros: lista separada por vírgula
        $itens = $nome === 'Forwarded' ? (preg_match_all('/for=("[^"]*"|[^;,\s]+)/i', $v, $m) > 0 ? $m[1] : []) : explode(',', $v);
        $ips = [];
        foreach (array_slice($itens, 0, 8) as $item) {
            $ip = gc_ip_limpo($item);
            if ($ip !== null) {
                $ips[] = $ip;
                $todos[] = $ip;
            }
        }
        $cabecalhos[] = ['nome' => $nome, 'ips' => array_map('gc_ip_mascarado', $ips)];
    }
    $confiavel = $remoto !== '' && gc_proxy_confiavel($remoto);
    $proxy = $confiavel || ($todos !== [] && $remoto !== '' && !in_array($remoto, $todos, true));
    $usado = gc_ip_cliente();
    $l = gc_um(
        "SELECT COUNT(*) AS n, COUNT(DISTINCT chave) AS ips FROM tentativas WHERE tipo IN ('rateio-entrar', 'minhas-vagas') AND em > ?",
        [gc_agora() - 86400],
    );
    return [
        'remoto' => $proxy ? $remoto : gc_ip_mascarado($remoto),
        'proxyNaFrente' => $proxy,
        'confiavel' => $confiavel,
        'usado' => gc_ip_mascarado($usado),
        // os limites contam por pessoa: sem proxy na frente, ou com a CDN de confiança repassando o IP de quem acessa
        'certo' => !$proxy || ($confiavel && $usado !== $remoto),
        'cabecalhos' => $cabecalhos,
        'site24h' => ['pedidos' => (int) ($l['n'] ?? 0), 'ips' => (int) ($l['ips'] ?? 0)],
    ];
}

/**
 * Pede pela web o que tem que ficar fechado. ok = true (bloqueado, como deve), false (aberto!) ou null (não deu).
 * @return array{testado: bool, motivo: string, base: string, itens: list<array<string, mixed>>}
 */
function gc_diagnostico_web(string $uploads): array
{
    $host = gc_host();
    if (!function_exists('curl_multi_init') || $host === '') {
        return ['testado' => false, 'motivo' => $host === '' ? 'sem o endereço do site' : 'sem curl', 'base' => '', 'itens' => []];
    }
    $pasta = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/api/index.php'))), '/');
    $base = (gc_https() ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? $host) . $pasta . '/';

    // um .php de mentira em uploads/: se a web executar, o corpo volta com a marca montada
    $sonda = null;
    $marca = 'gc-sonda-' . bin2hex(random_bytes(6));
    if (is_dir($uploads) && is_writable($uploads)) {
        $sonda = $uploads . '/gc-sonda-' . bin2hex(random_bytes(8)) . '.php';
        if (@file_put_contents($sonda, "<?php echo 'gc-sonda-' . '" . substr($marca, 9) . "';") === false) {
            $sonda = null;
        }
    }
    $urls = [
        'api' => $base . 'index.php?r=rateios',
        'privado/loja.sqlite' => $base . 'privado/loja.sqlite',
        'privado/erros.log' => $base . 'privado/erros.log',
        'nucleo/base.php' => $base . 'nucleo/base.php',
        'instalacao.php' => $base . 'instalacao.php',
        '.htaccess' => $base . '.htaccess',
    ];
    if ($sonda !== null) {
        $urls['php em uploads/'] = $base . '../uploads/' . basename($sonda);
    }
    try {
        $res = gc_buscar_varias($urls);
    } finally {
        if ($sonda !== null) {
            @unlink($sonda);
        }
    }

    if (($res['api']['status'] ?? 0) !== 200) {
        $erro = $res['api']['erro'] ?? '';
        return ['testado' => false, 'motivo' => 'o servidor não alcança o próprio endereço' . ($erro !== '' ? ": $erro" : ''), 'base' => $base, 'itens' => []];
    }
    $itens = [];
    foreach ($res as $nome => $r) {
        $status = $r['status'];
        if ($nome === 'api') {
            $ok = true;
        } elseif ($status === 0) {
            $ok = null;
        } elseif ($nome === 'php em uploads/') {
            $ok = !str_contains($r['corpo'], $marca);
        } elseif ($nome === 'nucleo/base.php' || $nome === 'instalacao.php') {
            // 403/404 é o certo; um 200 vazio quer dizer que o .htaccess falhou e só a guarda do PHP segurou
            $ok = $status !== 200 && !str_contains($r['corpo'], '$2y$') && !str_contains($r['corpo'], '<?php');
        } else {
            $ok = $status !== 200;
        }
        $itens[] = ['nome' => $nome, 'status' => $status, 'ok' => $ok];
    }
    return ['testado' => true, 'motivo' => '', 'base' => $base, 'itens' => $itens];
}

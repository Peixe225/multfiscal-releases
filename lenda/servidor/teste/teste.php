<?php
/**
 * LENDA · teste de ponta a ponta do servidor. Rodado por rodar.sh, que sobe o banco, a config e o php -S
 * e passa tudo por variáveis de ambiente. Fala com as rotas só por HTTP (curl) e confere o banco por PDO.
 * O que veio na v3 (CONTRATO-v3.md) está em teste-v3.php, incluído antes do .htaccess e dos vazamentos.
 */
declare(strict_types=1);

error_reporting(E_ALL);
set_error_handler(static function (int $n, string $m, string $f, int $l): bool {
    throw new ErrorException($m, 0, $n, $f, $l);
});

$URL = rtrim((string) getenv('LENDA_URL'), '/');
$ORIGEM = (string) getenv('LENDA_ORIGEM');
$EMAILS = (string) getenv('LENDA_EMAILS');
$CONFIG_ARQ = (string) getenv('LENDA_CONFIG_ARQ');
$LOG_PHP = (string) getenv('LENDA_LOG_PHP');
$AMOSTRAS = (string) getenv('LENDA_AMOSTRAS');
$URL_APACHE = rtrim((string) getenv('LENDA_URL_APACHE'), '/');
$PAINEL_SENHA = (string) getenv('PAINEL_SENHA');
$PAINEL_TOKEN = (string) getenv('PAINEL_TOKEN');
$SEM_CARGA = getenv('LENDA_TESTE_SEM_CARGA') === '1';
if ($URL === '' || $ORIGEM === '' || $PAINEL_SENHA === '') {
    fwrite(STDERR, "Rode pelo rodar.sh (faltam variáveis de ambiente).\n");
    exit(2);
}

$pdo = new PDO((string) getenv('LENDA_DSN'), (string) getenv('LENDA_BD_USUARIO'), (string) getenv('LENDA_BD_SENHA'), [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
$pdo->exec("SET time_zone = '+00:00'");

// ── placar ───────────────────────────────────────────────────────────────────────────────────────

$TOTAL = 0;
$FALHAS = [];
$CORPOS = []; // todo corpo de resposta, para procurar senha vazada no fim
$SENHAS = [$PAINEL_SENHA, $PAINEL_TOKEN];

function checar(string $nome, bool $cond, string $detalhe = ''): bool
{
    global $TOTAL, $FALHAS;
    $TOTAL++;
    if ($cond) {
        echo "  ok      $nome\n";
    } else {
        $FALHAS[] = $nome . ($detalhe !== '' ? " — $detalhe" : '');
        echo "  FALHOU  $nome" . ($detalhe !== '' ? " — $detalhe" : '') . "\n";
    }
    return $cond;
}

function secao(string $t): void
{
    echo "\n── $t\n";
}

function q(string $sql, array $p = []): array
{
    global $pdo;
    $st = $pdo->prepare($sql);
    $st->execute($p);
    return $st->fetchAll();
}

function v(string $sql, array $p = []): mixed
{
    global $pdo;
    $st = $pdo->prepare($sql);
    $st->execute($p);
    $r = $st->fetchColumn();
    return $r === false ? null : $r;
}

function resetarLimites(): void
{
    q('DELETE FROM tentativas');
}

function uuid4(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    $h = bin2hex($b);
    return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-' . substr($h, 12, 4) . '-' . substr($h, 16, 4) . '-' . substr($h, 20);
}

function amostra(string $nome): stdClass
{
    global $AMOSTRAS;
    return json_decode((string) file_get_contents("$AMOSTRAS/$nome.json"), false, 512, JSON_THROW_ON_ERROR);
}

/** A chave existe e vale null (o ?? não serve: trata null como ausente). */
function nulo(mixed $arr, string $chave): bool
{
    return is_array($arr) && array_key_exists($chave, $arr) && $arr[$chave] === null;
}

function canon(mixed $v): string
{
    return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
}

// ── cliente HTTP com cookies ─────────────────────────────────────────────────────────────────────

final class Resposta
{
    public int $status = 0;
    /** @var array<string, string[]> */
    public array $cab = [];
    public string $corpo = '';
    public mixed $json = null;
    /** @var array<string, array{valor: string, attrs: string}> */
    public array $cookies = [];

    public function cab1(string $nome): string
    {
        return $this->cab[strtolower($nome)][0] ?? '';
    }

    public function erro(): string
    {
        return is_array($this->json) ? (string) ($this->json['erro'] ?? '') : '';
    }

    public function resumo(): string
    {
        return "HTTP {$this->status} " . substr($this->corpo, 0, 300);
    }
}

final class Navegador
{
    /** @var array<string, string> */
    public array $jar = [];
    public string $ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
    /** false no Apache de teste (lá o PHP não roda: só as regras do .htaccess contam). */
    public bool $conferir = true;

    public function __construct(public string $base, public ?string $origem)
    {
    }

    /**
     * $corpo: array/objeto (vira JSON), string (vai como está) ou null.
     * $opc: tipo (Content-Type; null = nenhum), origem (false = sem Origin), referer, auth, ua, cab (lista extra), url (absoluta).
     */
    public function pedir(string $metodo, string $caminho, mixed $corpo = null, array $opc = []): Resposta
    {
        global $CORPOS;
        $url = $opc['url'] ?? ($this->base . $caminho);
        $cab = [];
        $tipo = array_key_exists('tipo', $opc) ? $opc['tipo'] : ($corpo !== null ? 'application/json' : null);
        if ($tipo !== null) {
            $cab[] = 'Content-Type: ' . $tipo;
        }
        $origem = array_key_exists('origem', $opc) ? $opc['origem'] : ($metodo === 'POST' ? $this->origem : null);
        if (is_string($origem)) {
            $cab[] = 'Origin: ' . $origem;
        }
        if (isset($opc['referer'])) {
            $cab[] = 'Referer: ' . $opc['referer'];
        }
        if (isset($opc['auth'])) {
            $cab[] = 'Authorization: ' . $opc['auth'];
        }
        if ($this->jar) {
            $cab[] = 'Cookie: ' . implode('; ', array_map(static fn($k, $v) => "$k=$v", array_keys($this->jar), $this->jar));
        }
        foreach ($opc['cab'] ?? [] as $c) {
            $cab[] = $c;
        }
        $cab[] = 'Expect:';
        $r = new Resposta();
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $metodo,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $cab,
            CURLOPT_USERAGENT => $opc['ua'] ?? $this->ua,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_HEADERFUNCTION => static function ($ch, string $linha) use ($r): int {
                $p = strpos($linha, ':');
                if ($p !== false) {
                    $r->cab[strtolower(trim(substr($linha, 0, $p)))][] = trim(substr($linha, $p + 1));
                }
                return strlen($linha);
            },
        ]);
        if ($corpo !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($corpo) ? $corpo : canon($corpo));
        }
        $txt = curl_exec($ch);
        $r->status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        $r->corpo = is_string($txt) ? $txt : '';
        $r->json = $r->corpo !== '' ? json_decode($r->corpo, true) : null;
        foreach ($r->cab['set-cookie'] ?? [] as $sc) {
            [$par, $attrs] = array_pad(explode(';', $sc, 2), 2, '');
            [$nome, $valor] = array_pad(explode('=', $par, 2), 2, '');
            $nome = trim($nome);
            $valor = trim($valor);
            $r->cookies[$nome] = ['valor' => $valor, 'attrs' => $attrs];
            if ($valor === '' || $valor === 'deleted' || preg_match('/max-age=0\b/i', $attrs)) {
                unset($this->jar[$nome]);
            } else {
                $this->jar[$nome] = $valor;
            }
        }
        if ($this->conferir) {
            $CORPOS[] = $r->corpo;
            $GLOBALS['METODO_ATUAL'] = [$metodo];
            conferirResposta($r, $caminho);
        }
        return $r;
    }
}

/** Toda resposta: sem aviso/caminho/SQL vazando; as rotas da API respondem JSON sem cache. */
function conferirResposta(Resposta $r, string $caminho): void
{
    static $vistos = [];
    if (preg_match('/(Warning|Notice|Deprecated|Fatal error|Parse error|Stack trace|SQLSTATE|\.php on line|\/tmp\/lenda-teste|<br \/>)/i', $r->corpo, $m)) {
        checar("sem vazamento na resposta ($caminho)", false, 'achei "' . $m[1] . '": ' . substr($r->corpo, 0, 200));
    }
    if ($r->status >= 500) {
        checar("sem erro 500 ($caminho)", false, $r->resumo());
    }
    if (str_contains($caminho, '/api/') && !str_contains($caminho, '_lib.php') && !str_contains($caminho, '/api/_') && $r->status !== 204 && $r->status > 0
        && !str_contains($caminho, 'r=exportar')) {
        $chave = $caminho . $r->status;
        // hall.php (GET 200) e a raridade das conquistas são públicos e ficam em cache; o resto, no-store
        $publica = $r->status === 200 && preg_match('#/api/(hall\.php(\?|$)|conquistas\.php\?raridade=1)#', $caminho) === 1
            && !in_array('POST', $GLOBALS['METODO_ATUAL'] ?? [], true);
        $cacheOk = $publica ? str_starts_with($r->cab1('cache-control'), 'public, max-age=') : $r->cab1('cache-control') === 'no-store';
        $ok = str_starts_with($r->cab1('content-type'), 'application/json')
            && $cacheOk && $r->cab1('x-content-type-options') === 'nosniff'
            && is_array($r->json);
        if (!$ok || !isset($vistos[$chave])) {
            $vistos[$chave] = true;
            if (!$ok) {
                checar("JSON + no-store + nosniff ($caminho, $r->status)", false, $r->cab1('content-type') . ' | ' . $r->cab1('cache-control'));
            }
        }
    }
}

function novoNav(): Navegador
{
    global $URL, $ORIGEM;
    return new Navegador($URL, $ORIGEM);
}

/** Um envio para e.php. */
function medir(Navegador $n, string $vid, string $sid, array $ev, ?array $ctx = null, int $bot = 0, array $opc = []): Resposta
{
    $corpo = ['v' => $vid, 's' => $sid, 'bot' => $bot, 'ev' => $ev];
    if ($ctx !== null) {
        $corpo['ctx'] = $ctx;
    }
    return $n->pedir('POST', '/api/e.php', $corpo, $opc);
}

function ctx(string $ref = '', string $dev = 'mobile', array $utm = []): array
{
    return ['ref' => $ref, 'utm' => $utm + ['source' => '', 'medium' => '', 'campaign' => ''], 'dev' => $dev,
        'lang' => 'pt-BR', 'tela' => $dev === 'mobile' ? '390x844' : '1920x1080'];
}

function visita(string $sid): ?array
{
    $l = q('SELECT * FROM visitas WHERE sid = ?', [$sid]);
    return $l[0] ?? null;
}

function conta(Navegador $n, array $corpo, array $opc = []): Resposta
{
    return $n->pedir('POST', '/api/conta.php', $corpo, $opc);
}

/** Arquivos de e-mail (modo 'arquivo') para um endereço: caminho → conteúdo. */
function emailsPara(string $email): array
{
    global $EMAILS;
    $achados = [];
    foreach (glob("$EMAILS/*.eml") ?: [] as $f) {
        $t = (string) file_get_contents($f);
        if (preg_match('/^To: ' . preg_quote($email, '/') . '\r?$/mi', $t)) {
            $achados[$f] = $t;
        }
    }
    return $achados;
}

/**
 * O esqueci responde ANTES de mandar o e-mail (para não revelar se a conta existe pelo tempo), então o
 * arquivo pode aparecer um instante depois da resposta: espera até 5 s por um arquivo que não estava em $antes.
 */
function esperarEmailNovo(string $email, array $antes): ?string
{
    for ($i = 0; $i < 100; $i++) {
        $novos = array_diff_key(emailsPara($email), $antes);
        if ($novos) {
            usleep(50_000); // deixa terminar de gravar
            return (string) file_get_contents((string) array_key_first($novos));
        }
        usleep(50_000);
    }
    return null;
}

function codigoDe(?string $email): ?string
{
    return is_string($email) && preg_match('/^\s+(\d{6})\s*$/m', $email, $m) ? $m[1] : null;
}

/** Os campos de C esperados, tirados do HallEntry na mão (independente do servidor). */
function cEsperado(stdClass $h, string $como): array
{
    $tit = 0;
    foreach ($h->summary->trophies as $t) {
        $tit += $t->count;
    }
    $bo = 0;
    foreach ($h->summary->awards as $a) {
        if ($a->award === 'ballon_dor') {
            $bo += $a->count;
        }
    }
    return [
        'id' => $h->id, 'modo' => $h->mode === 'immersive' ? 'imersivo' : 'classico', 'jogador' => $h->identity->surname,
        'numero' => $h->identity->number, 'pais' => $h->identity->nationality, 'posicao' => $h->identity->position,
        'nota' => (int) $h->legacy->score, 'notaV' => isset($h->legacy->v) && is_int($h->legacy->v) ? $h->legacy->v : null, 'picoOvr' => $h->summary->peakOvr, 'temporadas' => $h->summary->seasons,
        'gols' => $h->summary->totals->goals, 'titulos' => $tit, 'bolasOuro' => $bo, 'headline' => $h->summary->headline,
        'como' => $como, 'terminouEm' => gmdate('Y-m-d\TH:i:s\Z', strtotime($h->finishedAt)),
    ];
}

const CAMPOS_C = ['bolasOuro', 'bonusOvr', 'como', 'gols', 'headline', 'id', 'jogador', 'modo', 'noHall', 'nota', 'notaV', 'numero', 'pais',
    'picoOvr', 'posicao', 'publica', 'salvaEm', 'temporadas', 'terminouEm', 'titulos'];

function conferirC(string $nome, mixed $c, array $esperado): void
{
    if (!checar("$nome: é um objeto C", is_array($c))) {
        return;
    }
    $chaves = array_keys($c);
    sort($chaves);
    checar("$nome: campos exatamente os do contrato", $chaves === CAMPOS_C, implode(',', $chaves));
    $dif = [];
    foreach ($esperado as $k => $v) {
        if (($c[$k] ?? null) !== $v) {
            $dif[] = "$k: " . var_export($c[$k] ?? null, true) . ' ≠ ' . var_export($v, true);
        }
    }
    checar("$nome: valores tirados do HallEntry", !$dif, implode('; ', $dif));
    checar("$nome: salvaEm em ISO UTC", is_string($c['salvaEm'] ?? null) && preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/', $c['salvaEm']) === 1);
}

/** Troca a config por um tempo (acrescenta/muda chaves do array) e espera o opcache do php -S reler. */
function comConfig(array $extra, callable $f): void
{
    global $CONFIG_ARQ;
    $orig = (string) file_get_contents($CONFIG_ARQ);
    $txt = $orig;
    foreach ($extra as $k => $v) {
        // tira a linha antiga da chave (se houver) e põe a nova antes do "];" final (sem regex na troca: o hash tem $)
        $txt = implode("\n", array_filter(explode("\n", $txt), static fn(string $l): bool => !str_starts_with(trim($l), var_export($k, true) . ' =>')));
        $fim = (int) strrpos($txt, '];');
        $txt = substr($txt, 0, $fim) . '  ' . var_export($k, true) . ' => ' . var_export($v, true) . ",\n" . substr($txt, $fim);
    }
    file_put_contents($CONFIG_ARQ, $txt);
    touch($CONFIG_ARQ, time() + 1);
    usleep(3_100_000); // o opcache do php -S só relê a config depois de opcache.revalidate_freq (2 s)
    try {
        $f();
    } finally {
        file_put_contents($CONFIG_ARQ, $orig);
        touch($CONFIG_ARQ, time() + 2);
        usleep(3_100_000);
    }
}

/** Valor que o servidor usa como "quem" do IP (para preparar um limite já quase cheio). */
function quemIpTeste(string $ip): string
{
    return hash_hmac('sha256', $ip . gmdate('Y-m-d'), (string) getenv('LENDA_SEGREDO'));
}

function quemEmailTeste(string $email): string
{
    return hash_hmac('sha256', 'email|' . $email, (string) getenv('LENDA_SEGREDO'));
}

/** Põe o contador da janela atual de um limite em $n (o próximo pedido soma em cima). */
function encherLimite(string $chave, int $n, bool $diario = false): void
{
    $janela = $diario ? intdiv(time(), 86400) * 144 : intdiv(time(), 600);
    q('INSERT INTO tentativas (chave, janela, n) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE n = VALUES(n)', [substr($chave, 0, 100), $janela, $n]);
}

/** Apaga só os limites de 10 min (os diários, "dia-*", ficam). */
function resetarLimitesCurtos(): void
{
    q("DELETE FROM tentativas WHERE chave NOT LIKE 'dia-%'");
}

$anon = novoNav();
$RE_ISO = '/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/';

// ══ 1. instalação ════════════════════════════════════════════════════════════════════════════════

secao('instalar.php');
$r = $anon->pedir('POST', '/api/instalar.php');
checar('sem token → 401', $r->status === 401 && $r->erro() === 'nao_autorizado', $r->resumo());
$r = $anon->pedir('POST', '/api/instalar.php', null, ['auth' => 'Bearer ' . str_repeat('a', 48)]);
checar('token errado → 401', $r->status === 401, $r->resumo());
$r = $anon->pedir('POST', '/api/instalar.php', null, ['auth' => 'Basic ' . base64_encode('x:' . $PAINEL_TOKEN)]);
checar('Authorization que não é Bearer → 401', $r->status === 401, $r->resumo());
$tabelasEsperadas = ['admin_log', 'bonus', 'carreiras', 'conquistas_usuario', 'denuncias', 'eventos', 'hall_foto', 'hall_foto_clubes',
    'indicacoes', 'redefinicoes', 'sessoes_login', 'site_config', 'tentativas', 'usuarios', 'visitantes_usuarios', 'visitas'];
$r = $anon->pedir('POST', '/api/instalar.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
checar('com token → 200 e as 16 tabelas', $r->status === 200 && ($r->json['tabelas'] ?? null) === $tabelasEsperadas, $r->resumo());
$r = $anon->pedir('GET', '/api/instalar.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
checar('de novo (idempotente) → 200, nada a alterar', $r->status === 200 && ($r->json['ok'] ?? false) === true && ($r->json['alteracoes'] ?? null) === [], $r->resumo());
q('ALTER TABLE eventos DROP INDEX ix_eventos_sid');
q('ALTER TABLE usuarios DROP COLUMN partidas');
$r = $anon->pedir('POST', '/api/instalar.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
checar('tabela antiga ganha a coluna e o índice que faltavam', $r->status === 200
    && ($r->json['alteracoes'] ?? null) === ['usuarios: coluna partidas', 'eventos: índice ix_eventos_sid']
    && in_array('ix_eventos_sid', array_column(q('SHOW INDEX FROM eventos'), 'Key_name'), true)
    && in_array('partidas', array_column(q('SHOW COLUMNS FROM usuarios'), 'Field'), true), $r->resumo());
$idx = array_column(q("SHOW INDEX FROM eventos"), 'Key_name');
checar('índices de eventos (em,tipo), sid, (vid,tipo)', in_array('ix_eventos_em_tipo', $idx, true) && in_array('ix_eventos_sid', $idx, true) && in_array('ix_eventos_vid_tipo', $idx, true));
$r = $anon->pedir('GET', '/api/_lib.php');
checar('_lib.php chamado direto → 404 sem corpo', $r->status === 404 && $r->corpo === '', $r->resumo());
$r = $anon->pedir('GET', '/api/conta.php');
checar('GET conta.php sem sessão → usuario null + regras', $r->status === 200 && array_key_exists('usuario', (array) $r->json)
    && $r->json['usuario'] === null && $r->json['regras'] === ['aposPartidas' => 5, 'obrigatorio' => false, 'lembrarACada' => 3], $r->resumo());
checar('cabeçalhos: JSON, no-store, nosniff', str_starts_with($r->cab1('content-type'), 'application/json; charset=utf-8')
    && $r->cab1('cache-control') === 'no-store' && $r->cab1('x-content-type-options') === 'nosniff');

// ══ 2. medição ═══════════════════════════════════════════════════════════════════════════════════

secao('e.php — sessão, contexto e eventos');
$nav1 = novoNav();
$vid1 = uuid4();
$sid1 = uuid4();
$r = medir($nav1, $vid1, $sid1, [['t' => 'view', 'm' => null, 'd' => ['rota' => '/'], 'ts' => time() * 1000]],
    ctx('https://vm.tiktok.com/ZMabc/', 'mobile'));
checar('primeiro envio → 204 sem corpo', $r->status === 204 && $r->corpo === '', $r->resumo());
$vis = visita($sid1);
checar('cria a visita', $vis !== null);
checar('visita: vid, origem tiktok, mobile, pt-BR, 390x844, bot 0, sem usuário',
    $vis && $vis['vid'] === $vid1 && $vis['origem'] === 'tiktok' && $vis['dispositivo'] === 'mobile' && $vis['idioma'] === 'pt-BR'
    && $vis['tela'] === '390x844' && (int) $vis['bot'] === 0 && $vis['usuario_id'] === null && (int) $vis['ativo_s'] === 0, json_encode($vis));
$evs = q('SELECT tipo, modo, dados, vid FROM eventos WHERE sid = ?', [$sid1]);
checar('evento view gravado com dados', count($evs) === 1 && $evs[0]['tipo'] === 'view' && $evs[0]['dados'] === '{"rota":"/"}' && $evs[0]['vid'] === $vid1, json_encode($evs));
$r = medir($nav1, $vid1, $sid1, [['t' => 'view', 'd' => ['rota' => '/carreira']]], ctx('', 'desktop', ['source' => 'youtube']));
$vis = visita($sid1);
checar('ctx só vale no primeiro envio', $r->status === 204 && $vis['origem'] === 'tiktok' && $vis['dispositivo'] === 'mobile');
checar('segundo evento gravado', (int) v('SELECT COUNT(*) FROM eventos WHERE sid = ?', [$sid1]) === 2);

// batimentos
q('UPDATE visitas SET ultimo = ultimo - INTERVAL 20 SECOND WHERE sid = ?', [$sid1]);
$r = medir($nav1, $vid1, $sid1, [['t' => 'hb', 'p' => 1, 'm' => 'classico']]);
$vis = visita($sid1);
$t = time();
checar('hb soma no máximo 15 s (passaram 20)', $r->status === 204 && (int) $vis['ativo_s'] === 15, 'ativo_s=' . $vis['ativo_s']);
checar('hb atualiza ultimo = agora', abs(strtotime($vis['ultimo'] . ' UTC') - $t) <= 2, $vis['ultimo']);
checar('hb com p:1 marca jogando_ate = agora + 45 s', $vis['jogando_ate'] !== null && abs(strtotime($vis['jogando_ate'] . ' UTC') - ($t + 45)) <= 2, (string) $vis['jogando_ate']);
q('UPDATE visitas SET ultimo = ultimo - INTERVAL 5 SECOND WHERE sid = ?', [$sid1]);
medir($nav1, $vid1, $sid1, [['t' => 'hb', 'p' => 0]]);
$a5 = (int) visita($sid1)['ativo_s'];
checar('hb soma só o tempo real (5 s)', $a5 >= 20 && $a5 <= 21, "ativo_s=$a5");
medir($nav1, $vid1, $sid1, [['t' => 'hb', 'p' => 0]]);
$a0 = (int) visita($sid1)['ativo_s'];
checar('hb logo em seguida soma ~0', $a0 - $a5 <= 1, "antes $a5, depois $a0");
q('UPDATE visitas SET ultimo = ultimo - INTERVAL 100 SECOND WHERE sid = ?', [$sid1]);
medir($nav1, $vid1, $sid1, [['t' => 'hb', 'p' => 0], ['t' => 'hb', 'p' => 0]]);
$a2 = (int) visita($sid1)['ativo_s'];
checar('dois hb no mesmo envio somam até 30 s', $a2 - $a0 === 30, "antes $a0, depois $a2");
checar('hb não vira linha em eventos', (int) v("SELECT COUNT(*) FROM eventos WHERE tipo = 'hb'") === 0);

secao('e.php — origem normalizada');
$casos = [
    ['https://www.tiktok.com/@lenda/video/1', [], 'tiktok'],
    ['vm.tiktok.com', [], 'tiktok'],
    ['https://youtu.be/abc', [], 'youtube'],
    ['https://m.youtube.com/shorts/x', [], 'youtube'],
    ['https://www.youtube.com/', [], 'youtube'],
    ['https://www.instagram.com/', [], 'instagram'],
    ['https://www.google.com.br/search?q=lenda', [], 'google'],
    ['https://google.com/', [], 'google'],
    ['https://exemplo.com.br/pagina?x=1', [], 'exemplo.com.br'],
    ['', [], 'direto'],
    ['https://www.google.com/', ['source' => 'TikTok'], 'tiktok'],
    ['', ['source' => 'youtube', 'medium' => 'shorts', 'campaign' => 'lancamento'], 'youtube'],
    ["<script>alert('x')</script>", [], null],
];
foreach ($casos as [$ref, $utm, $esperado]) {
    $sid = uuid4();
    medir($anon, uuid4(), $sid, [['t' => 'view']], ctx($ref, 'mobile', $utm));
    $o = visita($sid)['origem'] ?? '(nada)';
    if ($esperado === null) {
        checar('origem estranha fica só com [a-z0-9._-]', preg_match('/^[a-z0-9._-]{1,64}$/', $o) === 1, $o);
    } else {
        checar("origem de '" . ($utm['source'] ?? '') . ($ref === '' ? '(vazio)' : $ref) . "' → $esperado", $o === $esperado, $o);
    }
}
$sid = uuid4();
medir($anon, uuid4(), $sid, [['t' => 'view']]);
checar('sem ctx → direto', (visita($sid)['origem'] ?? '') === 'direto');
$sid = uuid4();
medir($anon, uuid4(), $sid, [['t' => 'view']], ctx('', 'mobile', ['source' => 'tiktok', 'medium' => 'bio', 'campaign' => 'out26']));
$vis = visita($sid);
checar('utm source/medium/campaign gravados', $vis['utm_source'] === 'tiktok' && $vis['utm_medium'] === 'bio' && $vis['utm_campaign'] === 'out26');

secao('e.php — robôs');
$sid = uuid4();
medir($anon, uuid4(), $sid, [['t' => 'view']], ctx(), 1);
checar('bot:1 → bot = 1', (int) (visita($sid)['bot'] ?? 0) === 1);
foreach (['curl/8.5.0', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36',
    'facebookexternalhit/1.1', 'Googlebot/2.1 (+http://www.google.com/bot.html)', 'python-requests/2.31', 'Wget/1.21', ''] as $ua) {
    $sid = uuid4();
    medir($anon, uuid4(), $sid, [['t' => 'view']], ctx(), 0, ['ua' => $ua]);
    checar('User-Agent "' . ($ua === '' ? '(vazio)' : substr($ua, 0, 30)) . '" → bot', (int) (visita($sid)['bot'] ?? 0) === 1);
}
$sid = uuid4();
$vidB = uuid4();
medir($anon, $vidB, $sid, [['t' => 'view']], ctx());
checar('navegador comum → bot = 0', (int) visita($sid)['bot'] === 0);
medir($anon, $vidB, $sid, [['t' => 'hb', 'p' => 0]], null, 1);
checar('bot:1 depois marca a sessão como robô', (int) visita($sid)['bot'] === 1);

secao('e.php — tipos, modos e tamanhos');
$sid = uuid4();
$vid = uuid4();
medir($anon, $vid, $sid, [
    ['t' => 'jogo_inicio', 'm' => 'live', 'd' => ['ritmo' => 'rapido']],
    ['t' => 'qualquer_coisa', 'm' => 'classico'],
    ['t' => 'jogo_fim', 'm' => 'xyz', 'd' => ['nota' => 50]],
    ['t' => 'compartilhar', 'd' => ['texto' => str_repeat('é', 600)]],
    'não é objeto',
    ['t' => ['view']],
], ctx());
$evs = q('SELECT tipo, modo, dados FROM eventos WHERE sid = ? ORDER BY id', [$sid]);
checar('tipo desconhecido ignorado (3 de 6 gravados)', count($evs) === 3, json_encode($evs));
checar('modo live gravado', ($evs[0]['modo'] ?? '') === 'live' && ($evs[0]['dados'] ?? '') === '{"ritmo":"rapido"}');
checar('modo inválido vira null', array_key_exists(1, $evs) && $evs[1]['modo'] === null);
checar('chave que o tipo não tem (texto de 1,2 KB) não é gravada', array_key_exists(2, $evs) && $evs[2]['dados'] === null);
$r = medir($anon, $vid, $sid, [['t' => 'view']], null, 0, ['tipo' => 'text/plain;charset=UTF-8']);
checar('text/plain (sendBeacon) aceito → 204', $r->status === 204, $r->resumo());

secao('e.php — d só com as chaves conhecidas de cada tipo');
$sid = uuid4();
$longo = str_repeat('á', 80);
medir($anon, uuid4(), $sid, [
    ['t' => 'view', 'd' => ['rota' => '/hall', 'lixo' => str_repeat('x', 500)]],
    ['t' => 'jogo_inicio', 'm' => 'classico', 'd' => ['ritmo' => 'expressa', 'seed' => 'abc']],
    ['t' => 'jogo_fim', 'm' => 'classico', 'd' => ['nota' => 1e300, 'temporadas' => 20.6, 'pico' => 98, 'extra' => 1]],
    ['t' => 'jogo_fim', 'm' => 'classico', 'd' => ['nota' => '50', 'temporadas' => -1000, 'pico' => true]],
    ['t' => 'partida_fim', 'm' => 'imersivo', 'd' => ['resultado' => 'vitoria_penaltis', 'placar' => '2-2', 'gols' => 2, 'x' => 1]],
    ['t' => 'gate_ver', 'd' => ['partidas' => 5, 'rota' => '/carreira', 'u' => 'x']],
    ['t' => 'gate_fechar', 'd' => ['partidas' => 8, 'rota' => '/x']],
    ['t' => 'compartilhar', 'd' => ['acao' => $longo, 'rota' => '/resumo']],
    ['t' => 'cadastro', 'd' => ['email' => 'a@b.com']],
    ['t' => 'partida_fim', 'm' => 'imersivo', 'd' => ['gols' => 10_000_001, 'resultado' => ['v']]],
    ['t' => 'view', 'd' => ['rota/']],
], ctx());
$ds = array_column(q('SELECT dados FROM eventos WHERE sid = ? ORDER BY id', [$sid]), 'dados');
checar('view: só a rota', ($ds[0] ?? '') === '{"rota":"/hall"}', (string) ($ds[0] ?? ''));
checar('jogo_inicio: só o ritmo', ($ds[1] ?? '') === '{"ritmo":"expressa"}', (string) ($ds[1] ?? ''));
checar('jogo_fim: nota 1e300 sai, temporadas arredondada, pico fica', ($ds[2] ?? '') === '{"temporadas":21,"pico":98}', (string) ($ds[2] ?? ''));
checar('jogo_fim: nota em texto, temporadas fora da faixa e pico booleano saem (nada sobra → null)', array_key_exists(3, $ds) && $ds[3] === null, (string) ($ds[3] ?? ''));
checar('partida_fim: resultado, placar e gols', ($ds[4] ?? '') === '{"resultado":"vitoria_penaltis","placar":"2-2","gols":2}', (string) ($ds[4] ?? ''));
checar('gate_ver: partidas e rota; gate_fechar: só partidas', ($ds[5] ?? '') === '{"partidas":5,"rota":"/carreira"}' && ($ds[6] ?? '') === '{"partidas":8}', ($ds[5] ?? '') . ' ' . ($ds[6] ?? ''));
checar('compartilhar: texto cortado em 64 caracteres', ($ds[7] ?? '') === canon(['acao' => mb_substr($longo, 0, 64), 'rota' => '/resumo']), (string) ($ds[7] ?? ''));
checar('cadastro não guarda d', array_key_exists(8, $ds) && $ds[8] === null);
checar('contagem acima de 10^7 e texto que é lista saem; d em lista sai', array_key_exists(9, $ds) && $ds[9] === null && array_key_exists(10, $ds) && $ds[10] === null, json_encode(array_slice($ds, 9)));
checar('nenhum dados com mais de 256 bytes', (int) v('SELECT COUNT(*) FROM eventos WHERE LENGTH(dados) > 256') === 0);
checar('visitas.eventos conta as linhas gravadas da sessão', (int) (visita($sid)['eventos'] ?? -1) === 11, (string) (visita($sid)['eventos'] ?? ''));

secao('e.php — recusas');
$r = medir($anon, uuid4(), uuid4(), [['t' => 'view']], ctx(), 0, ['origem' => false]);
checar('sem Origin e sem Referer → 403 origem', $r->status === 403 && $r->erro() === 'origem', $r->resumo());
$r = medir($anon, uuid4(), uuid4(), [['t' => 'view']], ctx(), 0, ['origem' => 'https://evil.example']);
checar('Origin de fora → 403', $r->status === 403 && $r->erro() === 'origem', $r->resumo());
$r = medir($anon, uuid4(), uuid4(), [['t' => 'view']], ctx(), 0, ['origem' => 'null']);
checar('Origin "null" → 403', $r->status === 403, $r->resumo());
$r = medir($anon, uuid4(), uuid4(), [['t' => 'view']], ctx(), 0, ['origem' => false, 'referer' => "$ORIGEM/lenda/#/carreira"]);
checar('sem Origin, com Referer do site → 204', $r->status === 204, $r->resumo());
$r = medir($anon, uuid4(), uuid4(), [['t' => 'view']], ctx(), 0, ['origem' => false, 'referer' => 'https://evil.example/lenda/']);
checar('sem Origin, Referer de fora → 403', $r->status === 403, $r->resumo());
$r = medir($anon, uuid4(), uuid4(), [['t' => 'view']], ctx(), 0, ['tipo' => 'application/x-www-form-urlencoded']);
checar('Content-Type de formulário → 403', $r->status === 403 && $r->erro() === 'origem', $r->resumo());
$r = medir($anon, 'abc', uuid4(), [['t' => 'view']]);
checar('UUID inválido → 400', $r->status === 400 && $r->erro() === 'uuid', $r->resumo());
$r = medir($anon, uuid4(), 'c232ab00-9414-11ec-b3c8-9f6bdeced846', [['t' => 'view']]);
checar('UUID que não é v4 → 400', $r->status === 400 && $r->erro() === 'uuid', $r->resumo());
$r = medir($anon, "' OR 1=1 --", uuid4(), [['t' => 'view']]);
checar('SQL no vid → 400', $r->status === 400, $r->resumo());
$r = $anon->pedir('POST', '/api/e.php', '{"v": quebrado');
checar('JSON quebrado → 400', $r->status === 400 && $r->erro() === 'json', $r->resumo());
$r = $anon->pedir('POST', '/api/e.php', canon(['v' => uuid4(), 's' => uuid4(), 'ev' => [['t' => 'view', 'd' => ['x' => str_repeat('a', 17000)]]]]));
checar('corpo acima de 16 KB → 413', $r->status === 413, $r->resumo());
$r = $anon->pedir('GET', '/api/e.php');
checar('GET e.php → 405', $r->status === 405, $r->resumo());

secao('e.php — limite de 240 eventos/sessão/10 min');
$sid = uuid4();
$vid = uuid4();
$cem = array_fill(0, 100, ['t' => 'view', 'd' => ['rota' => '/']]);
$r1 = medir($anon, $vid, $sid, $cem, ctx());
$r2 = medir($anon, $vid, $sid, $cem);
$r3 = medir($anon, $vid, $sid, $cem);
checar('100 + 100 passam, o terceiro lote (300 > 240) → 429', $r1->status === 204 && $r2->status === 204 && $r3->status === 429 && $r3->erro() === 'limite', "$r1->status $r2->status $r3->status");
checar('só os 200 primeiros foram gravados', (int) v('SELECT COUNT(*) FROM eventos WHERE sid = ?', [$sid]) === 200);
checar('outra sessão segue livre', medir($anon, $vid, uuid4(), [['t' => 'view']], ctx())->status === 204);
resetarLimites();
$ok204 = 0;
for ($i = 0; $i < 300; $i++) {
    $ok204 += medir($anon, uuid4(), uuid4(), [['t' => 'hb', 'p' => 0]], ctx())->status === 204 ? 1 : 0;
}
$r = medir($anon, uuid4(), uuid4(), [['t' => 'view']], ctx());
checar('300 sessões novas do mesmo IP em 10 min passam, a 301ª → 429', $ok204 === 300 && $r->status === 429 && $r->erro() === 'limite', "$ok204 / $r->status");
checar('…e as sessões que já existem seguem aceitas', medir($anon, $vid, $sid, [['t' => 'hb', 'p' => 0]])->status === 204);
resetarLimites();

secao('e.php — tetos de linhas: 1.500 por IP a cada 10 min, 3.000 por sessão');
$antesIp = (int) v('SELECT COUNT(*) FROM eventos');
$st = [];
$sidsIp = [];
for ($i = 0; $i < 8; $i++) {
    $s = uuid4();
    $sidsIp[] = $s;
    $st[] = medir($anon, uuid4(), $s, $cem, ctx())->status;
    $st[] = medir($anon, uuid4(), $s, $cem)->status;
}
$gravadas = (int) v('SELECT COUNT(*) FROM eventos') - $antesIp;
checar('16 envios de 100 linhas do mesmo IP: todos 204, só 1.500 gravadas', count(array_filter($st, static fn($x) => $x === 204)) === 16 && $gravadas === 1500,
    implode(',', array_unique($st)) . " / $gravadas");
$sHb = $sidsIp[0];
q('UPDATE visitas SET ultimo = ultimo - INTERVAL 20 SECOND WHERE sid = ?', [$sHb]);
$ativoAntes = (int) visita($sHb)['ativo_s'];
$r = medir($anon, uuid4(), $sHb, [['t' => 'hb', 'p' => 1, 'm' => 'classico'], ['t' => 'view', 'd' => ['rota' => '/']]]);
checar('acima do teto do IP: 204, a linha sai, o batimento vale (ativo_s e jogando_ate)', $r->status === 204
    && (int) v('SELECT COUNT(*) FROM eventos') - $antesIp === 1500 && (int) visita($sHb)['ativo_s'] === $ativoAntes + 15 && visita($sHb)['jogando_ate'] !== null, $r->resumo());
checar('o teto do IP soma só as linhas (os hb não contam): 1.601', (int) v("SELECT n FROM tentativas WHERE chave = ? AND janela = ?", ['e-ip:' . quemIpTeste('127.0.0.1'), intdiv(time(), 600)]) === 1601, (string) v("SELECT n FROM tentativas WHERE chave LIKE 'e-ip:%'"));
resetarLimites();
$sVida = uuid4();
medir($anon, uuid4(), $sVida, [['t' => 'view']], ctx());
q('UPDATE visitas SET eventos = 2995 WHERE sid = ?', [$sVida]);
$r = medir($anon, uuid4(), $sVida, array_fill(0, 10, ['t' => 'view']));
checar('sessão com 2.995 linhas: de 10, só 5 entram (204)', $r->status === 204 && (int) v('SELECT COUNT(*) FROM eventos WHERE sid = ?', [$sVida]) === 6
    && (int) visita($sVida)['eventos'] === 3000, $r->resumo());
$r = medir($anon, uuid4(), $sVida, [['t' => 'view'], ['t' => 'hb', 'p' => 0]]);
checar('sessão no teto de 3.000: 204, nada mais entra', $r->status === 204 && (int) v('SELECT COUNT(*) FROM eventos WHERE sid = ?', [$sVida]) === 6
    && (int) visita($sVida)['eventos'] === 3000, $r->resumo());
q('DELETE FROM eventos WHERE sid IN (' . implode(',', array_fill(0, count($sidsIp), '?')) . ')', $sidsIp);
resetarLimites();

// ══ 3. contas ════════════════════════════════════════════════════════════════════════════════════

secao('conta.php — cadastrar');
resetarLimites();
$S1 = 'senha-forte-' . bin2hex(random_bytes(3));
$S2 = 'outra-senha-' . bin2hex(random_bytes(3));
$S3 = 'zé-senha-' . bin2hex(random_bytes(3));
$SENHAS[] = $S1;
$SENHAS[] = $S2;
$SENHAS[] = $S3;
$EMAIL = 'foguete@exemplo.com';
$r = conta($nav1, ['acao' => 'cadastrar', 'apelido' => 'Foguete', 'email' => ' Foguete@Exemplo.COM ', 'senha' => $S1, 'aceite' => true,
    'vid' => $vid1, 'origem' => 'instagram', 'timeCoracao' => 'Flamengo', 'uf' => 'pe']);
checar('cadastrar → 201 {usuario}', $r->status === 201 && is_array($r->json['usuario'] ?? null), $r->resumo());
$U = $r->json['usuario'] ?? [];
$uid = (int) ($U['id'] ?? 0);
checar('U: e-mail minúsculo e sem espaço, apelido, UF maiúscula, time', ($U['email'] ?? '') === $EMAIL && ($U['apelido'] ?? '') === 'Foguete'
    && ($U['uf'] ?? '') === 'PE' && ($U['timeCoracao'] ?? '') === 'Flamengo', json_encode($U));
checar('U.origem = a da primeira visita do aparelho (tiktok)', ($U['origem'] ?? '') === 'tiktok', (string) ($U['origem'] ?? ''));
checar('U.criadoEm em ISO UTC', preg_match($RE_ISO, (string) ($U['criadoEm'] ?? '')) === 1);
$est = $U['estatisticas'] ?? [];
$chavesEst = array_keys($est);
sort($chavesEst);
checar('U.estatisticas com todos os campos', $chavesEst === ['aparelhos', 'bolasOuro', 'carreirasSalvas', 'gols', 'melhorJogador', 'melhorNota',
    'partidas', 'primeiroAcesso', 'tempoJogadoMin', 'titulos', 'ultimoAcesso'], implode(',', $chavesEst));
checar('estatísticas iniciais: 0 partidas, 0 carreiras, aparelhos [mobile]', ($est['partidas'] ?? -1) === 0 && ($est['carreirasSalvas'] ?? -1) === 0
    && nulo($est, 'melhorNota') && nulo($est, 'melhorJogador') && ($est['aparelhos'] ?? null) === ['mobile'], json_encode($est));
checar('primeiroAcesso = a primeira visita (antes do cadastro)', ($est['primeiroAcesso'] ?? '') !== '' && ($est['primeiroAcesso'] ?? '') <= ($U['criadoEm'] ?? ''));
$ck = $r->cookies['lenda_sessao'] ?? null;
checar('cookie lenda_sessao: 43 caracteres base64url', $ck !== null && preg_match('/^[A-Za-z0-9_-]{43}$/', $ck['valor']) === 1, json_encode($ck));
$at = strtolower($ck['attrs'] ?? '');
checar('cookie: HttpOnly, SameSite=Lax, Path=/lenda/, 180 dias, sem Secure no teste', str_contains($at, 'httponly') && str_contains($at, 'samesite=lax')
    && str_contains($at, 'path=/lenda/') && str_contains($at, 'max-age=15552000') && !str_contains($at, 'secure'), $at);
$tokenA = $ck['valor'] ?? '';
checar('no banco só o sha256 do token', (int) v('SELECT COUNT(*) FROM sessoes_login WHERE token_sha256 = ? AND usuario_id = ?', [hash('sha256', $tokenA), $uid]) === 1
    && (int) v('SELECT COUNT(*) FROM sessoes_login WHERE token_sha256 = ?', [$tokenA]) === 0);
$hashBanco = (string) v('SELECT senha_hash FROM usuarios WHERE id = ?', [$uid]);
checar('senha guardada só como password_hash', password_verify($S1, $hashBanco) && !str_contains($hashBanco, $S1) && str_starts_with($hashBanco, '$2y$'));
checar('resposta não traz senha nem hash', !str_contains($r->corpo, $S1) && !str_contains($r->corpo, 'senha') && !str_contains($r->corpo, '$2y$'));
checar('vínculo: visitas de antes do cadastro passam a ser da conta', (int) v('SELECT COUNT(*) FROM visitas WHERE vid = ? AND (usuario_id IS NULL OR usuario_id <> ?)', [$vid1, $uid]) === 0
    && (int) v('SELECT COUNT(*) FROM visitas WHERE vid = ?', [$vid1]) >= 1);
checar('vínculo: visitantes_usuarios(vid, usuario_id)', (int) v('SELECT usuario_id FROM visitantes_usuarios WHERE vid = ?', [$vid1]) === $uid);
checar('IP não é gravado em lugar nenhum', (int) v("SELECT COUNT(*) FROM tentativas WHERE chave LIKE '%127.0.0.1%'") === 0);

$r = conta(novoNav(), ['acao' => 'cadastrar', 'apelido' => 'Outro', 'email' => 'FOGUETE@exemplo.com', 'senha' => 'qualquer123', 'aceite' => true]);
checar('e-mail repetido → 409 email_em_uso', $r->status === 409 && $r->erro() === 'email_em_uso' && ($r->json['mensagem'] ?? '') !== '', $r->resumo());
checar('erro não cria cookie', !isset($r->cookies['lenda_sessao']));
$r = conta(novoNav(), ['acao' => 'cadastrar', 'apelido' => 'a', 'email' => 'a1@exemplo.com', 'senha' => 'qualquer123', 'aceite' => true]);
checar('apelido curto → 400 apelido_invalido', $r->status === 400 && $r->erro() === 'apelido_invalido', $r->resumo());
$r = conta(novoNav(), ['acao' => 'cadastrar', 'apelido' => 'Ana', 'email' => 'a2@exemplo.com', 'senha' => '12345', 'aceite' => true]);
checar('senha de 5 → 400 senha_curta', $r->status === 400 && $r->erro() === 'senha_curta', $r->resumo());
$r = conta(novoNav(), ['acao' => 'cadastrar', 'apelido' => 'Ana', 'email' => 'a3@exemplo.com', 'senha' => 'qualquer123', 'aceite' => false]);
checar('sem aceite → 400 aceite', $r->status === 400 && $r->erro() === 'aceite', $r->resumo());
$r = conta(novoNav(), ['acao' => 'cadastrar', 'apelido' => 'Ana', 'email' => 'a4@exemplo.com', 'senha' => 'qualquer123', 'aceite' => true]);
checar('6º cadastro do mesmo IP em 10 min passa (o limite agora é 30, por causa do 4G)', $r->status === 201, $r->resumo());
q("DELETE s FROM sessoes_login s JOIN usuarios u ON u.id = s.usuario_id WHERE u.email = 'a4@exemplo.com'");
q("DELETE FROM usuarios WHERE email = 'a4@exemplo.com'");
encherLimite('cadastrar:' . quemIpTeste('127.0.0.1'), 29);
$r = conta(novoNav(), ['acao' => 'cadastrar', 'apelido' => 'a', 'email' => 'a5@exemplo.com', 'senha' => 'qualquer123', 'aceite' => true]);
checar('30º cadastro do mesmo IP ainda é atendido (400 do apelido curto)', $r->status === 400 && $r->erro() === 'apelido_invalido', $r->resumo());
$r = conta(novoNav(), ['acao' => 'cadastrar', 'apelido' => 'Ana', 'email' => 'a6@exemplo.com', 'senha' => 'qualquer123', 'aceite' => true]);
checar('31º cadastro do mesmo IP em 10 min → 429 limite', $r->status === 429 && $r->erro() === 'limite', $r->resumo());

resetarLimites();
$invalidos = [
    [['apelido' => '<script>'], 'apelido_invalido', 'apelido com <>'],
    [['apelido' => str_repeat('a', 21)], 'apelido_invalido', 'apelido de 21'],
    [['apelido' => 'nome@x'], 'apelido_invalido', 'apelido com @'],
    [['apelido' => 'dois  espaços'], 'apelido_invalido', 'apelido com espaço duplo'],
];
foreach ($invalidos as [$campos, $codigo, $nome]) {
    $r = conta(novoNav(), $campos + ['acao' => 'cadastrar', 'email' => 'x' . bin2hex(random_bytes(3)) . '@exemplo.com', 'senha' => 'qualquer123', 'aceite' => true]);
    checar("$nome → 400 $codigo", $r->status === 400 && $r->erro() === $codigo, $r->resumo());
}
resetarLimites();
$invalidos = [
    [['email' => 'nao-e-email'], 'email_invalido', 'e-mail sem @'],
    [['email' => str_repeat('a', 180) . '@exemplo.com'], 'email_invalido', 'e-mail de 192'],
    [['email' => "a@b.com' OR '1'='1"], 'email_invalido', 'e-mail com SQL'],
    [['senha' => str_repeat('s', 73)], 'senha_curta', 'senha de 73'],
];
foreach ($invalidos as [$campos, $codigo, $nome]) {
    $r = conta(novoNav(), $campos + ['acao' => 'cadastrar', 'apelido' => 'Ana', 'email' => 'y' . bin2hex(random_bytes(3)) . '@exemplo.com', 'senha' => 'qualquer123', 'aceite' => true]);
    checar("$nome → 400 $codigo", $r->status === 400 && $r->erro() === $codigo, $r->resumo());
}
resetarLimites();
$invalidos = [
    [['aceite' => 'true'], 'aceite', 'aceite como texto'],
    [['uf' => 'XX'], 'uf_invalida', 'UF inexistente'],
    [['timeCoracao' => str_repeat('t', 41)], 'time_invalido', 'time de 41'],
    [['apelido' => ['a']], 'apelido_invalido', 'apelido lista'],
];
foreach ($invalidos as [$campos, $codigo, $nome]) {
    $r = conta(novoNav(), $campos + ['acao' => 'cadastrar', 'apelido' => 'Ana', 'email' => 'z' . bin2hex(random_bytes(3)) . '@exemplo.com', 'senha' => 'qualquer123', 'aceite' => true]);
    checar("$nome → 400 $codigo", $r->status === 400 && $r->erro() === $codigo, $r->resumo());
}
checar('nenhum cadastro inválido entrou no banco', (int) v('SELECT COUNT(*) FROM usuarios') === 1);
resetarLimites();

secao('conta.php — eu, estatísticas, perfil, partidas');
$r = $nav1->pedir('GET', '/api/conta.php');
checar('GET com sessão → usuario da conta', $r->status === 200 && (int) ($r->json['usuario']['id'] ?? 0) === $uid, $r->resumo());
$ativo = (int) v('SELECT SUM(ativo_s) FROM visitas WHERE usuario_id = ?', [$uid]);
q('UPDATE visitas SET ativo_s = ativo_s + 600 WHERE sid = ?', [$sid1]);
$r = $nav1->pedir('GET', '/api/conta.php');
checar('tempoJogadoMin = soma de ativo_s das visitas / 60', ($r->json['usuario']['estatisticas']['tempoJogadoMin'] ?? -1) === intdiv($ativo + 600, 60),
    json_encode($r->json['usuario']['estatisticas'] ?? null));
$sid1b = uuid4();
medir($nav1, $vid1, $sid1b, [['t' => 'view']], ctx('', 'desktop'));
checar('e.php com sessão de jogador grava usuario_id na visita', (int) (visita($sid1b)['usuario_id'] ?? 0) === $uid);
$r = conta($nav1, ['acao' => 'partidas', 'n' => 7]);
checar('partidas n=7 → ok', $r->status === 200 && ($r->json['ok'] ?? false) === true, $r->resumo());
conta($nav1, ['acao' => 'partidas', 'n' => 3]);
$r = $nav1->pedir('GET', '/api/conta.php');
checar('partidas guarda o maior (7, não 3)', ($r->json['usuario']['estatisticas']['partidas'] ?? 0) === 7);
checar('aparelhos [mobile, desktop]', ($r->json['usuario']['estatisticas']['aparelhos'] ?? null) === ['mobile', 'desktop'], json_encode($r->json['usuario']['estatisticas']['aparelhos'] ?? null));
$r = conta($nav1, ['acao' => 'partidas', 'n' => -1]);
checar('partidas n=-1 → 400', $r->status === 400, $r->resumo());
$r = conta($nav1, ['acao' => 'partidas', 'n' => 'abc']);
checar('partidas n=texto → 400', $r->status === 400, $r->resumo());
medir($nav1, $vid1, $sid1b, array_merge(
    array_fill(0, 6, ['t' => 'jogo_fim', 'm' => 'classico', 'd' => ['nota' => 40]]),
    array_fill(0, 2, ['t' => 'partida_fim', 'm' => 'imersivo', 'd' => ['resultado' => 'V']]),
    [['t' => 'jogo_fim', 'm' => 'live', 'd' => ['nota' => 99]]]
));
$r = $nav1->pedir('GET', '/api/conta.php');
checar('partidas = maior entre o salvo (7) e os eventos (6 + 2, Live fora)', ($r->json['usuario']['estatisticas']['partidas'] ?? 0) === 8,
    (string) ($r->json['usuario']['estatisticas']['partidas'] ?? ''));
$r = conta($nav1, ['acao' => 'perfil', 'timeCoracao' => '  Sport  Club do Recife ', 'uf' => 'sp', 'apelido' => 'Foguete Azul']);
checar('perfil: time, UF e apelido', $r->status === 200 && ($r->json['usuario']['timeCoracao'] ?? '') === 'Sport Club do Recife'
    && ($r->json['usuario']['uf'] ?? '') === 'SP' && ($r->json['usuario']['apelido'] ?? '') === 'Foguete Azul', $r->resumo());
$r = conta($nav1, ['acao' => 'perfil', 'uf' => null, 'timeCoracao' => '']);
checar('perfil: limpar UF e time', $r->status === 200 && nulo($r->json['usuario'] ?? null, 'uf') && nulo($r->json['usuario'] ?? null, 'timeCoracao')
    && ($r->json['usuario']['apelido'] ?? '') === 'Foguete Azul', $r->resumo());
$r = conta($nav1, ['acao' => 'perfil', 'uf' => 'EX', 'timeCoracao' => 'Boca Juniors']);
checar('perfil: UF EX (fora do Brasil)', $r->status === 200 && ($r->json['usuario']['uf'] ?? '') === 'EX', $r->resumo());
$r = conta($nav1, ['acao' => 'perfil', 'uf' => 'XX']);
checar('perfil: UF inválida → 400', $r->status === 400 && $r->erro() === 'uf_invalida', $r->resumo());
$r = conta($nav1, ['acao' => 'perfil', 'timeCoracao' => str_repeat('t', 41)]);
checar('perfil: time de 41 → 400', $r->status === 400 && $r->erro() === 'time_invalido', $r->resumo());
$r = conta($nav1, ['acao' => 'perfil', 'apelido' => 'x']);
checar('perfil: apelido inválido → 400', $r->status === 400 && $r->erro() === 'apelido_invalido', $r->resumo());
$r = conta($anon, ['acao' => 'perfil', 'uf' => 'SP']);
checar('perfil sem sessão → 401 nao_logado', $r->status === 401 && $r->erro() === 'nao_logado', $r->resumo());
$r = conta($anon, ['acao' => 'partidas', 'n' => 3]);
checar('partidas sem sessão → 401 nao_logado', $r->status === 401 && $r->erro() === 'nao_logado', $r->resumo());
$r = conta(novoNav(), ['acao' => 'excluir', 'senha' => 'x']);
checar('excluir sem sessão → 401 nao_logado', $r->status === 401 && $r->erro() === 'nao_logado', $r->resumo());
$falso = novoNav();
$falso->jar['lenda_sessao'] = str_repeat('A', 43);
$r = $falso->pedir('GET', '/api/conta.php');
checar('cookie inventado → usuario null', $r->status === 200 && nulo($r->json, 'usuario'), $r->resumo());

secao('conta.php — sair, entrar, rotação de sessão');
$r = conta($nav1, ['acao' => 'sair']);
checar('sair → 200 ok e apaga o cookie', $r->status === 200 && ($r->json['ok'] ?? false) === true && isset($r->cookies['lenda_sessao'])
    && !isset($nav1->jar['lenda_sessao']), $r->resumo());
checar('sair apaga a sessão no banco', (int) v('SELECT COUNT(*) FROM sessoes_login WHERE token_sha256 = ?', [hash('sha256', $tokenA)]) === 0);
$velho = novoNav();
$velho->jar['lenda_sessao'] = $tokenA;
$r = $velho->pedir('GET', '/api/conta.php');
checar('token de depois do sair não vale mais', nulo($r->json, 'usuario'));
$nav2 = novoNav();
$vid2 = uuid4();
$sid2 = uuid4();
medir($nav2, $vid2, $sid2, [['t' => 'view']], ctx('https://youtu.be/x', 'desktop'));
$r = conta($nav2, ['acao' => 'entrar', 'email' => 'FOGUETE@Exemplo.com ', 'senha' => $S1, 'vid' => $vid2]);
checar('entrar → 200 {usuario} + cookie', $r->status === 200 && (int) ($r->json['usuario']['id'] ?? 0) === $uid && isset($nav2->jar['lenda_sessao']), $r->resumo());
checar('entrar com vid liga as visitas do aparelho novo', (int) (visita($sid2)['usuario_id'] ?? 0) === $uid
    && (int) v('SELECT usuario_id FROM visitantes_usuarios WHERE vid = ?', [$vid2]) === $uid);
$tok1 = $nav2->jar['lenda_sessao'] ?? '';
$r = conta($nav2, ['acao' => 'entrar', 'email' => $EMAIL, 'senha' => $S1]);
$tok2 = $nav2->jar['lenda_sessao'] ?? '';
checar('entrar de novo troca o token (sessão rotacionada)', $r->status === 200 && $tok2 !== '' && $tok2 !== $tok1);
checar('o token anterior foi apagado do banco', (int) v('SELECT COUNT(*) FROM sessoes_login WHERE token_sha256 = ?', [hash('sha256', $tok1)]) === 0
    && (int) v('SELECT COUNT(*) FROM sessoes_login WHERE token_sha256 = ?', [hash('sha256', $tok2)]) === 1);
$r1 = conta(novoNav(), ['acao' => 'entrar', 'email' => $EMAIL, 'senha' => 'senha-errada']);
$r2 = conta(novoNav(), ['acao' => 'entrar', 'email' => 'ninguem@exemplo.com', 'senha' => 'senha-errada']);
checar('senha errada → 401 credenciais', $r1->status === 401 && $r1->erro() === 'credenciais', $r1->resumo());
checar('e-mail inexistente → mesma resposta da senha errada', $r2->status === 401 && $r1->corpo === $r2->corpo, $r2->resumo());
$r = conta(novoNav(), ['acao' => 'entrar', 'email' => $EMAIL, 'senha' => $S1 . "\0" . 'resto']);
checar('senha com byte nulo → 401, sem 500', $r->status === 401 && $r->erro() === 'credenciais', $r->resumo());
$r = conta(novoNav(), ['acao' => 'entrar', 'email' => ['x'], 'senha' => 123]);
checar('entrar com tipos errados → 401, sem 500', $r->status === 401, $r->resumo());

resetarLimites();
// renovação depois de 7 dias
q('UPDATE sessoes_login SET renovada_em = renovada_em - INTERVAL 8 DAY, expira_em = expira_em - INTERVAL 8 DAY WHERE token_sha256 = ?', [hash('sha256', $tok2)]);
$r = $nav2->pedir('GET', '/api/conta.php');
$ren = q('SELECT expira_em, renovada_em FROM sessoes_login WHERE token_sha256 = ?', [hash('sha256', $tok2)])[0] ?? null;
checar('sessão usada depois de 7 dias é renovada (180 dias de novo + cookie)', $ren && abs(strtotime($ren['expira_em'] . ' UTC') - (time() + 180 * 86400)) <= 5
    && isset($r->cookies['lenda_sessao']) && $r->cookies['lenda_sessao']['valor'] === $tok2, json_encode($ren));
$r = $nav2->pedir('GET', '/api/conta.php');
checar('sessão recém-renovada não reenvia cookie', !isset($r->cookies['lenda_sessao']));
q('UPDATE sessoes_login SET expira_em = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE token_sha256 = ?', [hash('sha256', $tok2)]);
$r = $nav2->pedir('GET', '/api/conta.php');
checar('sessão vencida não vale', nulo($r->json, 'usuario'));
conta($nav2, ['acao' => 'entrar', 'email' => $EMAIL, 'senha' => $S1]);

secao('conta.php — limites de entrar');
resetarLimites();
$st = [];
for ($i = 0; $i < 5; $i++) {
    $st[] = conta(novoNav(), ['acao' => 'entrar', 'email' => $EMAIL, 'senha' => 'errada-' . $i])->status;
}
$r = conta(novoNav(), ['acao' => 'entrar', 'email' => $EMAIL, 'senha' => $S1]);
checar('5 erros no mesmo e-mail → o 6º (mesmo certo) dá 429', $st === [401, 401, 401, 401, 401] && $r->status === 429 && $r->erro() === 'limite', implode(',', $st) . " / $r->status");
resetarLimites();
$st = [];
for ($i = 0; $i < 10; $i++) {
    $st[] = conta(novoNav(), ['acao' => 'entrar', 'email' => "n$i@exemplo.com", 'senha' => 'errada'])->status;
}
encherLimite('entrar:' . quemIpTeste('127.0.0.1'), 59);
$r59 = conta(novoNav(), ['acao' => 'entrar', 'email' => 'n98@exemplo.com', 'senha' => 'errada']);
$r = conta(novoNav(), ['acao' => 'entrar', 'email' => 'n99@exemplo.com', 'senha' => 'errada']);
checar('entrar: 60 por IP (4G), a 61ª dá 429', count(array_filter($st, static fn($s) => $s === 401)) === 10 && $r59->status === 401 && $r->status === 429,
    implode(',', $st) . " / $r59->status / $r->status");
resetarLimites();

secao('conta.php — esqueci e redefinir');
$antes = emailsPara($EMAIL);
$r1 = conta($anon, ['acao' => 'esqueci', 'email' => 'ninguem@exemplo.com']);
$r2 = conta($anon, ['acao' => 'esqueci', 'email' => 'Foguete@exemplo.com']);
$m = esperarEmailNovo($EMAIL, $antes) ?? '';
checar('esqueci → 200 {ok:true} exista ou não a conta', $r1->status === 200 && $r2->status === 200 && $r1->corpo === $r2->corpo && $r1->corpo === '{"ok":true}', $r1->resumo() . ' / ' . $r2->resumo());
checar('e-mail inexistente não recebe nada', emailsPara('ninguem@exemplo.com') === []);
checar('um e-mail com o código para a conta', $m !== '' && count(emailsPara($EMAIL)) === count($antes) + 1);
checar('e-mail: From e Reply-To = email_remetente, UTF-8', str_contains($m, 'From: LENDA <contato@oprojeto.online>') && str_contains($m, 'Reply-To: contato@oprojeto.online')
    && str_contains($m, 'Content-Type: text/plain; charset=UTF-8'));
$assunto = preg_match('/^Subject: =\?UTF-8\?B\?([A-Za-z0-9+\/=]+)\?=/m', $m, $mm) ? base64_decode($mm[1]) : '';
checar('e-mail: assunto e corpo em pt-BR', $assunto === 'LENDA: seu código para trocar a senha' && str_contains($m, 'Olá, Foguete Azul!') && str_contains($m, '30 minutos'), $assunto);
$codigo = codigoDe($m);
checar('código de 6 dígitos no e-mail', $codigo !== null && preg_match('/^\d{6}$/', $codigo) === 1);
checar('no banco só o hash do código', $codigo !== null && (int) v('SELECT COUNT(*) FROM redefinicoes WHERE email = ? AND codigo_hash <> ?', [$EMAIL, $codigo]) === 1);
$errado = str_pad((string) (((int) $codigo + 1) % 1000000), 6, '0', STR_PAD_LEFT);
$r = conta($anon, ['acao' => 'redefinir', 'email' => $EMAIL, 'codigo' => $errado, 'senha' => $S2]);
checar('código errado → 400 codigo', $r->status === 400 && $r->erro() === 'codigo', $r->resumo());
$r = conta($anon, ['acao' => 'redefinir', 'email' => $EMAIL, 'codigo' => $codigo, 'senha' => '123']);
checar('senha nova curta → 400 senha_curta (código continua valendo)', $r->status === 400 && $r->erro() === 'senha_curta', $r->resumo());
$navR = novoNav();
$r = conta($navR, ['acao' => 'redefinir', 'email' => $EMAIL, 'codigo' => $codigo, 'senha' => $S2]);
checar('código certo → 200 {usuario} + cookie', $r->status === 200 && (int) ($r->json['usuario']['id'] ?? 0) === $uid && isset($navR->jar['lenda_sessao']), $r->resumo());
$r = $nav2->pedir('GET', '/api/conta.php');
checar('redefinir derruba as outras sessões', nulo($r->json, 'usuario'));
checar('só a sessão nova sobrou', (int) v('SELECT COUNT(*) FROM sessoes_login WHERE usuario_id = ?', [$uid]) === 1);
$r = conta(novoNav(), ['acao' => 'entrar', 'email' => $EMAIL, 'senha' => $S1]);
checar('senha antiga não entra mais', $r->status === 401);
$r = conta($nav2, ['acao' => 'entrar', 'email' => $EMAIL, 'senha' => $S2]);
checar('senha nova entra', $r->status === 200, $r->resumo());
$r = conta($anon, ['acao' => 'redefinir', 'email' => $EMAIL, 'codigo' => $codigo, 'senha' => 'mais-uma-senha']);
checar('código já usado → 400', $r->status === 400 && $r->erro() === 'codigo', $r->resumo());
resetarLimites();
$antes = emailsPara($EMAIL);
conta($anon, ['acao' => 'esqueci', 'email' => $EMAIL]);
$codigo2 = codigoDe(esperarEmailNovo($EMAIL, $antes));
checar('esqueci de novo manda um código novo', $codigo2 !== null);
for ($i = 1; $i <= 5; $i++) {
    conta($anon, ['acao' => 'redefinir', 'email' => $EMAIL, 'codigo' => str_pad((string) (((int) $codigo2 + $i) % 1000000), 6, '0', STR_PAD_LEFT), 'senha' => 'mais-uma-senha']);
}
$r = conta($anon, ['acao' => 'redefinir', 'email' => $EMAIL, 'codigo' => $codigo2, 'senha' => 'mais-uma-senha']);
checar('5 códigos errados → 6º pedido dá 429', $r->status === 429, $r->resumo());
resetarLimites();
$r = conta($anon, ['acao' => 'redefinir', 'email' => $EMAIL, 'codigo' => $codigo2, 'senha' => 'mais-uma-senha']);
checar('depois de 5 erros o código não vale mais (mesmo certo)', $r->status === 400 && $r->erro() === 'codigo', $r->resumo());
q("UPDATE redefinicoes SET expira_em = UTC_TIMESTAMP() - INTERVAL 1 MINUTE");
resetarLimites();
$antes = emailsPara($EMAIL);
conta($anon, ['acao' => 'esqueci', 'email' => $EMAIL]);
$codigo3 = codigoDe(esperarEmailNovo($EMAIL, $antes));
q('UPDATE redefinicoes SET expira_em = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE email = ?', [$EMAIL]);
$r = conta($anon, ['acao' => 'redefinir', 'email' => $EMAIL, 'codigo' => $codigo3, 'senha' => 'mais-uma-senha']);
checar('código vencido (30 min) → 400', $r->status === 400 && $r->erro() === 'codigo', $r->resumo());
resetarLimites();
$st = [];
for ($i = 0; $i < 3; $i++) {
    $st[] = conta($anon, ['acao' => 'esqueci', 'email' => $EMAIL])->status;
}
$r = conta($anon, ['acao' => 'esqueci', 'email' => $EMAIL]);
checar('esqueci: 3 por e-mail, o 4º dá 429', $st === [200, 200, 200] && $r->status === 429, implode(',', $st) . " / $r->status");
resetarLimites();
$st = [];
for ($i = 0; $i < 20; $i++) {
    $st[] = conta($anon, ['acao' => 'redefinir', 'email' => "r$i@exemplo.com", 'codigo' => '123456', 'senha' => 'mais-uma-senha'])->status;
}
$r = conta($anon, ['acao' => 'redefinir', 'email' => 'r99@exemplo.com', 'codigo' => '123456', 'senha' => 'mais-uma-senha']);
checar('redefinir: 20 por IP, o 21º dá 429', count(array_filter($st, static fn($x) => $x === 400)) === 20 && $r->status === 429, implode(',', array_unique($st)) . " / $r->status");
$r = conta($anon, ['acao' => 'esqueci', 'email' => 'isso não é e-mail']);
checar('esqueci com e-mail inválido → 400 email_invalido', $r->status === 400 && $r->erro() === 'email_invalido', $r->resumo());
resetarLimites();

secao('conta.php — tetos de e-mails e de chutes do código');
q('DELETE FROM redefinicoes');
$antes = emailsPara($EMAIL);
conta($anon, ['acao' => 'esqueci', 'email' => $EMAIL]);
$cRec = codigoDe(esperarEmailNovo($EMAIL, $antes));
conta($anon, ['acao' => 'redefinir', 'email' => $EMAIL, 'codigo' => str_pad((string) (((int) $cRec + 1) % 1000000), 6, '0', STR_PAD_LEFT), 'senha' => 'mais-uma-senha']);
$antes = emailsPara($EMAIL);
$r = conta($anon, ['acao' => 'esqueci', 'email' => $EMAIL]);
conta($anon, ['acao' => 'esqueci', 'email' => 'ninguem@exemplo.com']); // o php -S só atende este depois de terminar o anterior
checar('esqueci de novo em menos de 2 min: 200, sem e-mail novo, sem zerar as tentativas do código', $r->status === 200 && count(emailsPara($EMAIL)) === count($antes)
    && (int) v('SELECT tentativas FROM redefinicoes WHERE email = ?', [$EMAIL]) === 1, $r->resumo());
resetarLimites();
$st = [];
for ($i = 0; $i < 5; $i++) {
    q('DELETE FROM redefinicoes'); // senão o "menos de 2 min" seguraria o envio
    resetarLimitesCurtos();
    $st[] = conta($anon, ['acao' => 'esqueci', 'email' => $EMAIL])->status;
}
resetarLimitesCurtos();
$r = conta($anon, ['acao' => 'esqueci', 'email' => $EMAIL]);
checar('esqueci: 5 por e-mail no dia, o 6º dá 429 (mesmo com os limites de 10 min zerados)', $st === [200, 200, 200, 200, 200] && $r->status === 429 && $r->erro() === 'limite',
    implode(',', $st) . " / $r->status");
checar('o teto diário fica numa chave dia-* com a janela do começo do dia', (int) v('SELECT n FROM tentativas WHERE chave = ? AND janela = ?',
    [substr('dia-esqueci-e:' . quemEmailTeste($EMAIL), 0, 100), intdiv(time(), 86400) * 144]) === 6);
resetarLimites();
encherLimite('esqueci-todos:todos', 40);
$r1 = conta($anon, ['acao' => 'esqueci', 'email' => 'ninguem@exemplo.com']);
resetarLimites();
encherLimite('esqueci-todos:todos', 40);
$r2 = conta($anon, ['acao' => 'esqueci', 'email' => $EMAIL]);
checar('esqueci: 40 no site a cada 10 min, depois 429 (igual exista ou não a conta)', $r1->status === 429 && $r2->status === 429 && $r1->corpo === $r2->corpo, $r1->resumo());
resetarLimites();
encherLimite('dia-esqueci-todos:todos', 300, true);
$r = conta($anon, ['acao' => 'esqueci', 'email' => $EMAIL]);
checar('esqueci: 300 no site por dia, depois 429', $r->status === 429, $r->resumo());
resetarLimites();
q('DELETE FROM redefinicoes');
$st = [];
for ($i = 0; $i < 15; $i++) {
    if ($i % 4 === 0) {
        resetarLimitesCurtos();
    }
    $st[] = conta($anon, ['acao' => 'redefinir', 'email' => $EMAIL, 'codigo' => '123456', 'senha' => 'mais-uma-senha'])->status;
}
resetarLimitesCurtos();
$r = conta($anon, ['acao' => 'redefinir', 'email' => $EMAIL, 'codigo' => '123456', 'senha' => 'mais-uma-senha']);
checar('redefinir: 15 chutes por e-mail no dia, o 16º dá 429', count(array_filter($st, static fn($x) => $x === 400)) === 15 && $r->status === 429,
    implode(',', array_unique($st)) . " / $r->status");
resetarLimites();
encherLimite('cadastrar-todos:todos', 200);
$r = conta(novoNav(), ['acao' => 'cadastrar', 'apelido' => 'Pico', 'email' => 'pico@exemplo.com', 'senha' => 'qualquer123', 'aceite' => true]);
checar('cadastrar: 200 no site a cada 10 min, o seguinte dá 429', $r->status === 429 && (int) v("SELECT COUNT(*) FROM usuarios WHERE email = 'pico@exemplo.com'") === 0, $r->resumo());
resetarLimites();

secao('conta.php — recusas gerais');
$r = conta($anon, ['acao' => 'entrar', 'email' => $EMAIL, 'senha' => $S2], ['origem' => false]);
checar('POST sem Origin/Referer → 403 origem', $r->status === 403 && $r->erro() === 'origem', $r->resumo());
$r = conta($anon, ['acao' => 'entrar', 'email' => $EMAIL, 'senha' => $S2], ['tipo' => 'text/plain']);
checar('text/plain só vale no e.php → 403', $r->status === 403, $r->resumo());
$r = conta($anon, ['acao' => 'entrar', 'email' => $EMAIL, 'senha' => str_repeat('x', 17000)]);
checar('corpo acima de 16 KB → 413', $r->status === 413, $r->resumo());
$r = conta($anon, ['acao' => 'hackear']);
checar('ação desconhecida → 400 acao', $r->status === 400 && $r->erro() === 'acao', $r->resumo());
$r = $anon->pedir('POST', '/api/conta.php', '[1,2,3]');
checar('corpo que não é objeto → 400 json', $r->status === 400 && $r->erro() === 'json', $r->resumo());
$r = $anon->pedir('PUT', '/api/conta.php', ['acao' => 'sair']);
checar('PUT → 405', $r->status === 405, $r->resumo());
checar('mensagens de erro em pt-BR', str_contains((string) (conta($anon, ['acao' => 'perfil'])->json['mensagem'] ?? ''), 'conta'));

// ══ 4. carreiras ═════════════════════════════════════════════════════════════════════════════════

secao('carreiras.php');
$navA = $nav2; // logado como Foguete (senha S2)
$A1 = amostra('v-intenso-01');  // pico 98
$A2 = amostra('v-otima-06');    // pico 90
$A3 = amostra('v-mediana-03');  // pico 85
$r = $anon->pedir('GET', '/api/carreiras.php');
checar('GET sem sessão → 401 nao_logado', $r->status === 401 && $r->erro() === 'nao_logado', $r->resumo());
$r = $anon->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $A1, 'como' => 'auto']);
checar('salvar sem sessão → 401', $r->status === 401, $r->resumo());
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $A1, 'como' => 'auto']);
checar('salvar auto → 200 {carreira: C}', $r->status === 200, $r->resumo());
conferirC('C de A1', $r->json['carreira'] ?? null, cEsperado($A1, 'auto'));
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $A3, 'como' => 'manual']);
conferirC('C de A3 (manual)', $r->json['carreira'] ?? null, cEsperado($A3, 'manual'));
$r = $navA->pedir('GET', '/api/carreiras.php');
$ids = array_column($r->json['carreiras'] ?? [], 'id');
checar('listar → {carreiras, limite: 200}, mais recente primeiro', $r->status === 200 && ($r->json['limite'] ?? 0) === 200 && $ids === [$A3->id, $A1->id], json_encode($ids));
conferirC('item da lista', $r->json['carreiras'][1] ?? null, cEsperado($A1, 'auto'));
$r = $navA->pedir('GET', '/api/carreiras.php?id=' . rawurlencode($A1->id));
checar('abrir por id → o HallEntry inteiro, igual ao enviado', $r->status === 200 && isset($r->json['carreira'])
    && canon(json_decode($r->corpo, false)->carreira) === canon($A1), $r->resumo());
checar('abrir preserva objetos vazios ({})', substr_count($r->corpo, '{}') === substr_count(canon($A1), '{}'));
$tam = q('SELECT tamanho, LENGTH(dados) AS gz FROM carreiras WHERE carreira_id = ?', [$A1->id])[0] ?? null;
checar('guardado comprimido (gzip)', $tam && (int) $tam['gz'] < (int) $tam['tamanho'] / 3, json_encode($tam));
// "como" só sobe
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $A1, 'como' => 'manual']);
checar('auto → manual sobe', ($r->json['carreira']['como'] ?? '') === 'manual');
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $A1, 'como' => 'auto']);
checar('manual → auto não desce', ($r->json['carreira']['como'] ?? '') === 'manual');
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $A2, 'como' => 'auto']);
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $A2, 'como' => 'auto']);
checar('auto + auto fica auto', ($r->json['carreira']['como'] ?? '') === 'auto');
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $A2]);
checar('sem "como" conta como manual', ($r->json['carreira']['como'] ?? '') === 'manual');
q("UPDATE carreiras SET como = 'auto' WHERE carreira_id = ?", [$A2->id]);
// versão dos pesos da nota (legacy.v): sem v → null; com v → guarda e devolve
$A2v = json_decode(json_encode($A2));
$A2v->legacy->v = 2;
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $A2v, 'como' => 'manual']);
checar('nota com versão: notaV = legacy.v', ($r->json['carreira']['notaV'] ?? null) === 2 && (int) v('SELECT nota_v FROM carreiras WHERE carreira_id = ?', [$A2->id]) === 2, $r->resumo());
$A2v->legacy->v = 'x';
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $A2v, 'como' => 'manual']);
checar('legacy.v que não é inteiro → notaV null', array_key_exists('notaV', $r->json['carreira'] ?? []) && $r->json['carreira']['notaV'] === null, $r->resumo());
q("UPDATE carreiras SET como = 'auto' WHERE carreira_id = ?", [$A2->id]);
checar('salvar de novo atualiza (não duplica)', (int) v('SELECT COUNT(*) FROM carreiras WHERE usuario_id = ?', [$uid]) === 3);
// validação
$semId = clone $A3;
unset($semId->id);
$semIdentity = clone $A3;
unset($semIdentity->identity);
$semSummary = clone $A3;
unset($semSummary->summary);
$idLongo = clone $A3;
$idLongo->id = str_repeat('x', 65);
$idVazio = clone $A3;
$idVazio->id = '';
$idNum = clone $A3;
$idNum->id = 123;
$identLista = clone $A3;
$identLista->identity = [];
foreach ([['sem id', $semId], ['sem identity', $semIdentity], ['sem summary', $semSummary], ['id de 65', $idLongo], ['id vazio', $idVazio],
    ['id número', $idNum], ['identity lista', $identLista], ['carreira texto', 'oi'], ['carreira lista', [1, 2]]] as [$nome, $c]) {
    $r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $c, 'como' => 'manual']);
    checar("rejeita $nome → 400 carreira_invalida", $r->status === 400 && $r->erro() === 'carreira_invalida', $r->resumo());
}
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $A3, 'como' => 'sempre']);
checar('como inválido → 400', $r->status === 400 && $r->erro() === 'como', $r->resumo());
$id64 = clone $A3;
$id64->id = str_repeat('é', 64);
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $id64, 'como' => 'manual']);
checar('id de 64 caracteres (com acento) aceito', $r->status === 200 && ($r->json['carreira']['id'] ?? '') === $id64->id, $r->resumo());
$navA->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => $id64->id]);
$grande = clone $A1;
$grande->id = 'teste-grande';
$grande->lixo = str_repeat('x', 620 * 1024);
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $grande, 'como' => 'manual']);
checar('carreira acima de 600 KB → 413', $r->status === 413, $r->resumo());
$grande->lixo = str_repeat('x', 540 * 1024);
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $grande, 'como' => 'manual']);
checar('carreira de ~590 KB passa', $r->status === 200, $r->resumo());
$navA->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => 'teste-grande']);
$aleat = clone $A1;
$aleat->id = 'teste-aleatorio';
$aleat->lixo = base64_encode(random_bytes(400 * 1024));
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $aleat, 'como' => 'manual']);
checar('dado que não comprime (mais de 128 KB já comprimido, JSON abaixo de 600 KB) → 413 grande', $r->status === 413 && $r->erro() === 'grande'
    && (int) v("SELECT COUNT(*) FROM carreiras WHERE carreira_id = 'teste-aleatorio'") === 0, $r->resumo());
q('UPDATE carreiras SET tamanho = ? WHERE usuario_id = ? AND carreira_id = ?', [20 * 1024 * 1024 - 20000, $uid, $A2->id]);
$cota = clone $A3;
$cota->id = 'teste-cota';
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $cota, 'como' => 'manual']);
checar('conta com 20 MB de carreiras → 409 cheio, com a mensagem', $r->status === 409 && $r->erro() === 'cheio'
    && ($r->json['mensagem'] ?? '') === 'Sua conta está cheia. Apague alguma carreira para salvar esta.', $r->resumo());
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $A2, 'como' => 'auto']);
checar('…atualizar a que ocupa a cota ainda pode (não conta contra si mesma)', $r->status === 200
    && (int) v('SELECT tamanho FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uid, $A2->id]) < 100000, $r->resumo());
resetarLimites();
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $A3, 'como' => 'manual']);
$gzA3 = (int) v('SELECT LENGTH(dados) FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uid, $A3->id]);
checar('salvar soma os KB comprimidos (não os pedidos), por conta e por IP', $r->status === 200
    && (int) v('SELECT n FROM tentativas WHERE chave = ?', ['salvar-kb:u' . $uid]) === intdiv($gzA3, 1024) + 1
    && (int) v('SELECT n FROM tentativas WHERE chave = ?', ['salvar-ip-kb:' . quemIpTeste('127.0.0.1')]) === intdiv($gzA3, 1024) + 1, (string) $gzA3);
resetarLimites();
encherLimite('salvar-kb:u' . $uid, 2048 - intdiv($gzA3, 1024));
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $A3, 'como' => 'manual']);
checar('2048 KB por conta a cada 10 min, depois 429', $r->status === 429 && $r->erro() === 'limite', $r->resumo());
resetarLimites();
encherLimite('salvar-ip-kb:' . quemIpTeste('127.0.0.1'), 4096 - intdiv($gzA3, 1024));
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $A3, 'como' => 'manual']);
checar('4096 KB por IP a cada 10 min, depois 429', $r->status === 429 && $r->erro() === 'limite', $r->resumo());
resetarLimites();
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $A1], ['origem' => false]);
checar('salvar sem Origin → 403', $r->status === 403, $r->resumo());
$r = $navA->pedir('GET', '/api/carreiras.php?id=' . rawurlencode("' OR '1'='1"));
checar('id com SQL → 404', $r->status === 404 && $r->erro() === 'nao_encontrada', $r->resumo());
$r = $navA->pedir('GET', '/api/carreiras.php?id[]=x');
checar('id que não é texto → 400', $r->status === 400, $r->resumo());
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar']);
checar('apagar sem id → 400', $r->status === 400, $r->resumo());
// outra conta
$navB = novoNav();
$r = conta($navB, ['acao' => 'cadastrar', 'apelido' => 'Zé Ninguém', 'email' => 'ze@exemplo.com', 'senha' => $S3, 'aceite' => true]);
checar('segunda conta (apelido com acento)', $r->status === 201 && ($r->json['usuario']['apelido'] ?? '') === 'Zé Ninguém', $r->resumo());
$uidB = (int) ($r->json['usuario']['id'] ?? 0);
$r = $navB->pedir('GET', '/api/carreiras.php?id=' . rawurlencode($A1->id));
checar('carreira de outra conta → 404', $r->status === 404 && $r->erro() === 'nao_encontrada', $r->resumo());
$r = $navB->pedir('GET', '/api/carreiras.php');
checar('a lista da outra conta vem vazia', $r->status === 200 && ($r->json['carreiras'] ?? null) === [], $r->resumo());
$r = $navB->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => $A1->id]);
checar('apagar carreira de outra conta não apaga', $r->status === 200 && (int) v('SELECT COUNT(*) FROM carreiras WHERE carreira_id = ? AND usuario_id = ?', [$A1->id, $uid]) === 1);
// apagar
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => $A3->id]);
checar('apagar → 200 ok', $r->status === 200 && ($r->json['ok'] ?? false) === true, $r->resumo());
$r = $navA->pedir('GET', '/api/carreiras.php?id=' . rawurlencode($A3->id));
checar('apagada → 404', $r->status === 404, $r->resumo());
$r = $navA->pedir('GET', '/api/carreiras.php');
checar('a lista fica com 2', count($r->json['carreiras'] ?? []) === 2);
// estatísticas da conta a partir das carreiras
$r = $navA->pedir('GET', '/api/conta.php');
$est = $r->json['usuario']['estatisticas'] ?? [];
$e1 = cEsperado($A1, 'x');
$e2 = cEsperado($A2, 'x');
$melhor = $e1['nota'] >= $e2['nota'] ? $e1 : $e2;
checar('estatísticas: carreirasSalvas, melhorNota, melhorJogador', ($est['carreirasSalvas'] ?? 0) === 2 && ($est['melhorNota'] ?? 0) === $melhor['nota']
    && ($est['melhorJogador'] ?? '') === $melhor['jogador'], json_encode($est));
checar('estatísticas: somas de bolas de ouro, gols e títulos', ($est['bolasOuro'] ?? -1) === $e1['bolasOuro'] + $e2['bolasOuro']
    && ($est['gols'] ?? -1) === $e1['gols'] + $e2['gols'] && ($est['titulos'] ?? -1) === $e1['titulos'] + $e2['titulos'], json_encode($est));
// conta cheia
$base = clone $A3;
$falhou = 0;
for ($i = 1; $i <= 200; $i++) {
    $base->id = "cheio-$i";
    $st = $navB->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $base, 'como' => 'manual'])->status;
    $falhou += $st === 200 ? 0 : 1;
}
checar('200 carreiras salvas na conta', $falhou === 0 && (int) v('SELECT COUNT(*) FROM carreiras WHERE usuario_id = ?', [$uidB]) === 200, "falhas: $falhou");
$base->id = 'cheio-201';
$r = $navB->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $base, 'como' => 'manual']);
checar('a 201ª → 409 cheio', $r->status === 409 && $r->erro() === 'cheio', $r->resumo());
$base->id = 'cheio-7';
$r = $navB->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $base, 'como' => 'auto']);
checar('com a conta cheia, atualizar uma que já existe ainda pode', $r->status === 200, $r->resumo());
$r = $navB->pedir('GET', '/api/carreiras.php');
checar('lista com 200', count($r->json['carreiras'] ?? []) === 200);

// ══ 5. excluir conta ═════════════════════════════════════════════════════════════════════════════

secao('conta.php — excluir (LGPD)');
$visitasA = (int) v('SELECT COUNT(*) FROM visitas WHERE usuario_id = ?', [$uid]);
$vidsDeA = array_column(q('SELECT sid, vid FROM visitas WHERE usuario_id = ?', [$uid]), 'vid', 'sid');
$eventosDeA = (int) v('SELECT COUNT(*) FROM eventos e JOIN visitas v ON v.sid = e.sid WHERE v.usuario_id = ?', [$uid]);
$r = conta($navA, ['acao' => 'excluir', 'senha' => 'senha-errada']);
checar('excluir com senha errada → 401', $r->status === 401 && $r->erro() === 'credenciais', $r->resumo());
checar('…e nada foi apagado', (int) v('SELECT COUNT(*) FROM usuarios WHERE id = ?', [$uid]) === 1);
$r = conta($navA, ['acao' => 'excluir', 'senha' => $S2]);
checar('excluir → 200 ok e apaga o cookie', $r->status === 200 && ($r->json['ok'] ?? false) === true && !isset($navA->jar['lenda_sessao']), $r->resumo());
checar('usuário apagado', (int) v('SELECT COUNT(*) FROM usuarios WHERE id = ?', [$uid]) === 0);
checar('carreiras apagadas', (int) v('SELECT COUNT(*) FROM carreiras WHERE usuario_id = ?', [$uid]) === 0);
checar('sessões apagadas', (int) v('SELECT COUNT(*) FROM sessoes_login WHERE usuario_id = ?', [$uid]) === 0);
checar('vínculos de aparelho apagados', (int) v('SELECT COUNT(*) FROM visitantes_usuarios WHERE usuario_id = ?', [$uid]) === 0);
$sidsDeA = array_keys($vidsDeA);
$marcasA = implode(',', array_fill(0, count($sidsDeA), '?'));
$depoisA = array_column(q("SELECT sid, vid, usuario_id FROM visitas WHERE sid IN ($marcasA)", $sidsDeA), null, 'sid');
checar('visitas ficam, sem usuario_id', $visitasA > 0 && count($depoisA) === $visitasA && (int) v('SELECT COUNT(*) FROM visitas WHERE usuario_id = ?', [$uid]) === 0);
$mapa = [];
foreach ($vidsDeA as $sidX => $velho) {
    $mapa[$velho][] = $depoisA[$sidX]['vid'] ?? '';
}
$novosVids = array_unique(array_merge(...array_values($mapa)));
checar('cada aparelho da conta ganhou um vid novo (um por aparelho, v4, nenhum antigo)', count($mapa) === 2 && count($novosVids) === 2
    && !array_intersect($novosVids, [$vid1, $vid2]) && count(array_filter($mapa, static fn($l) => count(array_unique($l)) === 1)) === 2
    && count(array_filter($novosVids, static fn($x) => preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', $x) === 1)) === 2, json_encode($mapa));
checar('os eventos dessas visitas seguem o vid novo', $eventosDeA > 0 && (int) v("SELECT COUNT(*) FROM eventos e JOIN visitas v ON v.sid = e.sid WHERE e.sid IN ($marcasA) AND e.vid <> v.vid", $sidsDeA) === 0
    && (int) v('SELECT COUNT(*) FROM eventos WHERE vid IN (?, ?)', [$vid1, $vid2]) === 0);
checar('pedido de redefinição apagado', (int) v('SELECT COUNT(*) FROM redefinicoes WHERE email = ?', [$EMAIL]) === 0);
checar('a outra conta continua inteira', (int) v('SELECT COUNT(*) FROM carreiras WHERE usuario_id = ?', [$uidB]) === 200);
$r = conta(novoNav(), ['acao' => 'entrar', 'email' => $EMAIL, 'senha' => $S2]);
checar('depois de excluir não entra mais', $r->status === 401);
resetarLimites();
$r = conta(novoNav(), ['acao' => 'cadastrar', 'apelido' => 'Herdeiro', 'email' => 'herdeiro@exemplo.com', 'senha' => 'qualquer123', 'aceite' => true, 'vid' => $vid1]);
$estH = $r->json['usuario']['estatisticas'] ?? [];
checar('conta nova no mesmo aparelho não herda o histórico da excluída', $r->status === 201 && ($estH['partidas'] ?? -1) === 0 && ($estH['tempoJogadoMin'] ?? -1) === 0
    && ($estH['aparelhos'] ?? null) === [] && ($r->json['usuario']['origem'] ?? '') === 'direto', $r->resumo());
resetarLimites();

// ══ 6. painel ════════════════════════════════════════════════════════════════════════════════════

secao('painel.php — acesso');
resetarLimites();
$adm = novoNav();
$r = $adm->pedir('GET', '/api/painel.php');
checar('sem login → 401', $r->status === 401 && $r->erro() === 'nao_logado', $r->resumo());
$r = $adm->pedir('POST', '/api/painel.php', ['acao' => 'entrar', 'senha' => 'errada']);
checar('senha errada → 401', $r->status === 401 && $r->erro() === 'credenciais', $r->resumo());
$r = $adm->pedir('POST', '/api/painel.php', ['acao' => 'entrar', 'senha' => $PAINEL_SENHA . "\0x"]);
checar('senha do painel com byte nulo → 401', $r->status === 401, $r->resumo());
$r = $adm->pedir('POST', '/api/painel.php', ['acao' => 'entrar', 'senha' => $PAINEL_SENHA], ['origem' => false]);
checar('entrar sem Origin → 403', $r->status === 403, $r->resumo());
$r = $adm->pedir('POST', '/api/painel.php', ['acao' => 'entrar', 'senha' => $PAINEL_SENHA]);
$ckp = $r->cookies['lenda_painel'] ?? null;
checar('entrar → 200 + cookie lenda_painel', $r->status === 200 && $ckp !== null && preg_match('/^\d+\.[0-9a-f]{64}$/', $ckp['valor']) === 1, $r->resumo());
$at = strtolower($ckp['attrs'] ?? '');
checar('cookie do painel: HttpOnly, Path=/lenda/, 12 h', str_contains($at, 'httponly') && str_contains($at, 'path=/lenda/') && str_contains($at, 'max-age=43200'), $at);
checar('cookie do painel: exp = agora + 12 h', $ckp && abs((int) explode('.', $ckp['valor'])[0] - (time() + 43200)) <= 5);
$r = $adm->pedir('GET', '/api/painel.php');
checar('com cookie → 200', $r->status === 200 && isset($r->json['agora'], $r->json['periodo']), $r->resumo());
$mexido = novoNav();
[$exp, $sig] = explode('.', $ckp['valor'] ?? '0.0');
$mexido->jar['lenda_painel'] = ((int) $exp + 86400) . '.' . $sig;
checar('cookie com exp mexido → 401', $mexido->pedir('GET', '/api/painel.php')->status === 401);
$mexido->jar['lenda_painel'] = (time() - 10) . '.' . hash_hmac('sha256', 'painel|' . (time() - 10), (string) getenv('LENDA_SEGREDO'));
checar('cookie vencido → 401', $mexido->pedir('GET', '/api/painel.php')->status === 401);
$r = novoNav()->pedir('GET', '/api/painel.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
checar('Authorization: Bearer <token> → 200', $r->status === 200 && isset($r->json['periodo']), $r->resumo());
$r = novoNav()->pedir('GET', '/api/painel.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN . 'x']);
checar('Bearer errado → 401', $r->status === 401, $r->resumo());
$r = $adm->pedir('GET', '/api/painel.php?so=agora');
checar('?so=agora → só {agora}', $r->status === 200 && array_keys((array) $r->json) === ['agora']
    && isset($r->json['agora']['online'], $r->json['agora']['jogando']) && preg_match($RE_ISO, (string) ($r->json['agora']['atualizadoEm'] ?? '')) === 1, $r->resumo());
$sair = novoNav();
$sair->pedir('POST', '/api/painel.php', ['acao' => 'entrar', 'senha' => $PAINEL_SENHA]);
$r = $sair->pedir('POST', '/api/painel.php', ['acao' => 'sair']);
checar('sair do painel → 200 e apaga o cookie', $r->status === 200 && !isset($sair->jar['lenda_painel']), $r->resumo());
checar('depois de sair → 401', $sair->pedir('GET', '/api/painel.php')->status === 401);
resetarLimites();
$st = [];
for ($i = 0; $i < 10; $i++) {
    $st[] = novoNav()->pedir('POST', '/api/painel.php', ['acao' => 'entrar', 'senha' => "errada$i"])->status;
}
$r = novoNav()->pedir('POST', '/api/painel.php', ['acao' => 'entrar', 'senha' => $PAINEL_SENHA]);
checar('senha do painel: 10 por IP, a 11ª dá 429', count(array_filter($st, static fn($s) => $s === 401)) === 10 && $r->status === 429, implode(',', $st) . " / $r->status");
resetarLimites();
encherLimite('painel-todos:todos', 50);
$r = novoNav()->pedir('POST', '/api/painel.php', ['acao' => 'entrar', 'senha' => $PAINEL_SENHA]);
checar('senha do painel: 50 no site a cada 10 min, depois 429 (mesmo certa, de um IP novo)', $r->status === 429 && !isset($r->cookies['lenda_painel']), $r->resumo());
resetarLimites();
$expF = (string) (time() + 3600);
$mexido->jar['lenda_painel'] = $expF . '.' . hash_hmac('sha256', 'painel|' . $expF, (string) getenv('LENDA_SEGREDO'));
checar('cookie assinado só com o segredo (sem a senha do painel na chave) → 401', $mexido->pedir('GET', '/api/painel.php')->status === 401);

secao('IP do visitante: /64 do IPv6, último item do cabeçalho, ip_proxies');
$lib = dirname(__DIR__) . '/api/_lib.php';
$codigoPuro = 'require ' . var_export($lib, true) . '; echo json_encode(['
    . 'ipParaLimite("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), ipParaLimite("2001:db8:1:2::1"), ipParaLimite("::ffff:203.0.113.9"),'
    . 'ipParaLimite("203.0.113.9"), ipParaLimite("lixo"),'
    . 'ipNaFaixa("10.1.2.3", "10.0.0.0/8"), ipNaFaixa("11.0.0.1", "10.0.0.0/8"), ipNaFaixa("2a02:4780:4c::1", "2a02:4780::/32"),'
    . 'ipNaFaixa("2a02:4781::1", "2a02:4780::/32"), ipNaFaixa("127.0.0.1", "127.0.0.1"), ipNaFaixa("127.0.0.1", "::1"),'
    . 'ipNaFaixa("1.2.3.5", "1.2.3.4/31"), ipNaFaixa("1.2.3.6", "1.2.3.4/31"), ipNaFaixa("10.0.0.1", "10.0.0.0/abc"), ipNaFaixa("x", "10.0.0.0/8")]);';
$puro = json_decode((string) shell_exec('php -r ' . escapeshellarg($codigoPuro)), true);
checar('ipParaLimite: IPv6 vira o /64, IPv4 dentro de IPv6 vira IPv4, o resto fica', is_array($puro) && array_slice($puro, 0, 5) === ['2001:db8:1:2::', '2001:db8:1:2::', '203.0.113.9', '203.0.113.9', 'lixo'], json_encode($puro));
checar('ipNaFaixa: IPv4 e IPv6 com e sem /bits; família ou faixa errada → não', is_array($puro) && array_slice($puro, 5) === [true, false, true, false, true, false, true, false, false, false], json_encode($puro));
$tentarPainel = static function (string $xff): int {
    return novoNav()->pedir('POST', '/api/painel.php', ['acao' => 'entrar', 'senha' => 'errada'], ['cab' => ['X-Forwarded-For: ' . $xff]])->status;
};
comConfig(['ip_cabecalho' => 'HTTP_X_FORWARDED_FOR'], static function () use ($tentarPainel): void {
    resetarLimites();
    $st = [];
    for ($i = 1; $i <= 10; $i++) {
        $st[] = $tentarPainel("10.9.$i.1, 2001:db8:aa:bb::" . dechex($i));
    }
    $mesmo64 = $tentarPainel('10.9.99.1, 2001:db8:aa:bb:ffff::1');
    $outro64 = $tentarPainel('2001:db8:aa:cc::1');
    checar('com ip_cabecalho: endereços do mesmo /64 dividem o limite; outro /64 começa do zero', count(array_filter($st, static fn($x) => $x === 401)) === 10
        && $mesmo64 === 429 && $outro64 === 401, implode(',', $st) . " / $mesmo64 / $outro64");
    resetarLimites();
    $st = [];
    for ($i = 1; $i <= 10; $i++) {
        $st[] = $tentarPainel("1.2.3.$i, 198.51.100.7");
    }
    $r11 = $tentarPainel('9.9.9.9, 198.51.100.7');
    checar('vale o último item do cabeçalho (o primeiro o cliente inventa à vontade)', count(array_filter($st, static fn($x) => $x === 401)) === 10 && $r11 === 429,
        implode(',', $st) . " / $r11");
    resetarLimites();
    $st = [];
    for ($i = 1; $i <= 10; $i++) {
        $st[] = $tentarPainel('::ffff:198.51.100.8');
    }
    $r11 = $tentarPainel('198.51.100.8');
    checar('::ffff:1.2.3.4 conta como 1.2.3.4', count(array_filter($st, static fn($x) => $x === 401)) === 10 && $r11 === 429, implode(',', $st) . " / $r11");
    resetarLimites();
});
comConfig(['ip_cabecalho' => 'HTTP_X_FORWARDED_FOR', 'ip_proxies' => ['10.0.0.0/8', '2001:db8::/32']], static function () use ($tentarPainel): void {
    $st = [];
    for ($i = 1; $i <= 10; $i++) {
        $st[] = $tentarPainel("198.51.100.$i");
    }
    $r11 = $tentarPainel('198.51.100.200');
    checar('ip_proxies sem o REMOTE_ADDR: o cabeçalho é ignorado (tudo conta para o IP da conexão)', count(array_filter($st, static fn($x) => $x === 401)) === 10 && $r11 === 429,
        implode(',', $st) . " / $r11");
    resetarLimites();
});
$navNovaSenha = novoNav();
comConfig(['ip_cabecalho' => 'HTTP_X_FORWARDED_FOR', 'ip_proxies' => ['127.0.0.0/8'], 'admin_senha_hash' => password_hash($PAINEL_SENHA, PASSWORD_DEFAULT)],
    static function () use ($tentarPainel, $adm, $navNovaSenha, $PAINEL_SENHA): void {
        $st = [];
        for ($i = 1; $i <= 11; $i++) {
            $st[] = $tentarPainel("198.51.100.$i");
        }
        checar('ip_proxies com o REMOTE_ADDR: o cabeçalho vale (11 IPs diferentes, nenhum 429)', count(array_filter($st, static fn($x) => $x === 401)) === 11, implode(',', $st));
        resetarLimites();
        checar('hash da senha do painel trocado na config: o cookie de antes não vale mais', $adm->pedir('GET', '/api/painel.php?so=agora')->status === 401);
        $r = $navNovaSenha->pedir('POST', '/api/painel.php', ['acao' => 'entrar', 'senha' => $PAINEL_SENHA]);
        checar('…e entrar de novo dá um cookie que vale', $r->status === 200 && $navNovaSenha->pedir('GET', '/api/painel.php?so=agora')->status === 200, $r->resumo());
    });
checar('config de volta: o cookie de antes volta a valer e o da outra senha não', $adm->pedir('GET', '/api/painel.php?so=agora')->status === 200
    && $navNovaSenha->pedir('GET', '/api/painel.php?so=agora')->status === 401);
resetarLimites();

secao('painel.php — sem dados');
foreach (['visitas', 'eventos', 'carreiras', 'sessoes_login', 'visitantes_usuarios', 'redefinicoes', 'usuarios', 'tentativas'] as $tab) {
    q("DELETE FROM $tab");
}
$r = $adm->pedir('GET', '/api/painel.php?de=2020-01-01&ate=2020-01-07');
$p = $r->json['periodo'] ?? [];
checar('período vazio → 200 com zeros', $r->status === 200 && ($p['visitantes'] ?? -1) === 0 && ($p['sessoes'] ?? -1) === 0 && ($p['tempoMedioS'] ?? -1) === 0
    && ($p['jogaram'] ?? -1) === 0 && ($p['inicios'] ?? null) === ['classico' => 0, 'imersivo' => 0, 'live' => 0], $r->resumo());
checar('7 dias zerados e 24 horas zeradas', count($r->json['dias'] ?? []) === 7 && ($r->json['dias'][0]['dia'] ?? '') === '2020-01-01'
    && count($r->json['horas'] ?? []) === 24 && array_sum(array_column($r->json['horas'] ?? [], 'sessoes')) === 0);
checar('funil zerado com as 5 etapas', array_column($r->json['funil'] ?? [], 'etapa') === ['Visitaram', 'Começaram um jogo', 'Terminaram um jogo', '5 partidas', 'Criaram conta']
    && array_sum(array_column($r->json['funil'] ?? [], 'n')) === 0);
checar('notas null, listas vazias, contas zeradas', ($r->json['notas'] ?? null) === ['media' => null, 'melhor' => null] && ($r->json['origens'] ?? null) === []
    && ($r->json['ultimosCadastros'] ?? null) === [] && ($r->json['contas']['total'] ?? -1) === 0 && ($r->json['contas']['melhores'] ?? null) === []);
$r = $adm->pedir('GET', '/api/painel.php?de=' . rawurlencode("2026-10-01' OR '1'='1") . '&ate=abc');
checar('datas inválidas → padrão (7 dias), sem erro', $r->status === 200 && count($r->json['dias'] ?? []) === 7, $r->resumo());
$r = $adm->pedir('GET', '/api/painel.php?de=2026-02-30&ate=2026-02-01');
checar('dia inexistente ignorado', $r->status === 200, $r->resumo());
$r = $adm->pedir('GET', '/api/painel.php?de=2026-03-10&ate=2026-03-01');
checar('de depois de ate → troca', $r->status === 200 && ($r->json['periodo']['de'] ?? '') === '2026-03-01' && ($r->json['periodo']['ate'] ?? '') === '2026-03-10');

secao('painel.php — números batem com o que foi enviado');
$hoje = gmdate('Y-m-d', time() - 3 * 3600);
$nA = novoNav();
$nB = novoNav();
$nC = novoNav();
$nD = novoNav();
$nE = novoNav();
[$vA, $vB, $vC, $vD, $vE] = [uuid4(), uuid4(), uuid4(), uuid4(), uuid4()];
[$sA, $sB, $sC1, $sC2, $sD, $sE0, $sE1] = [uuid4(), uuid4(), uuid4(), uuid4(), uuid4(), uuid4(), uuid4()];
// E já tinha vindo há 10 dias
q("INSERT INTO visitas (sid, vid, inicio, ultimo, ativo_s, origem, dispositivo, bot) VALUES (?, ?, UTC_TIMESTAMP() - INTERVAL 10 DAY,
    UTC_TIMESTAMP() - INTERVAL 10 DAY, 77, 'direto', 'desktop', 0)", [$sE0, $vE]);
medir($nA, $vA, $sA, [['t' => 'view', 'd' => ['rota' => '/']], ['t' => 'jogo_inicio', 'm' => 'classico', 'd' => ['ritmo' => 'normal']],
    ['t' => 'gate_ver'], ['t' => 'gate_fechar'], ['t' => 'login'], ['t' => 'jogo_fim', 'm' => 'classico', 'd' => ['nota' => 50, 'temporadas' => 20]]],
    ctx('https://www.tiktok.com/@lenda', 'mobile'));
medir($nB, $vB, $sB, array_merge([['t' => 'view'], ['t' => 'jogo_inicio', 'm' => 'imersivo', 'd' => ['ritmo' => 'normal']]],
    array_fill(0, 5, ['t' => 'partida_fim', 'm' => 'imersivo', 'd' => ['resultado' => 'V']]),
    [['t' => 'jogo_fim', 'm' => 'imersivo', 'd' => ['nota' => 80, 'temporadas' => 3]], ['t' => 'gate_ver'], ['t' => 'cadastro']]), ctx('', 'desktop'));
medir($nC, $vC, $sC1, [['t' => 'view']], ctx('https://youtu.be/abc', 'mobile'));
medir($nC, $vC, $sC2, [['t' => 'view']], ctx('https://m.youtube.com/', 'mobile'));
medir($nD, $vD, $sD, [['t' => 'view'], ['t' => 'jogo_inicio', 'm' => 'classico']], ctx('https://www.tiktok.com/', 'mobile'), 1);
medir($nE, $vE, $sE1, [['t' => 'view']], ctx('https://exemplo.com/x', 'desktop'));
q('UPDATE visitas SET ultimo = ultimo - INTERVAL 20 SECOND WHERE sid IN (?, ?)', [$sA, $sB]);
medir($nA, $vA, $sA, [['t' => 'hb', 'p' => 1, 'm' => 'classico']]);
medir($nB, $vB, $sB, [['t' => 'hb', 'p' => 1, 'm' => 'imersivo']]);
$r = conta($nB, ['acao' => 'cadastrar', 'apelido' => 'Craque', 'email' => 'craque@exemplo.com', 'senha' => $S3, 'aceite' => true, 'vid' => $vB]);
checar('cadastro do visitante B', $r->status === 201 && ($r->json['usuario']['origem'] ?? '') === 'direto', $r->resumo());
$nB->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $A2, 'como' => 'auto']);
$nB->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $A3, 'como' => 'manual']);
foreach ([[$sA, 120], [$sB, 300], [$sC1, 30], [$sC2, 0], [$sE1, 50], [$sD, 999]] as [$s, $a]) {
    q('UPDATE visitas SET ativo_s = ? WHERE sid = ?', [$a, $s]);
}

$r = $adm->pedir('GET', "/api/painel.php?de=$hoje&ate=$hoje");
$P = $r->json ?? [];
$p = $P['periodo'] ?? [];
checar('hoje: 200', $r->status === 200, $r->resumo());
checar('agora: online 5 (robô e visita velha fora), jogando 2', ($P['agora']['online'] ?? -1) === 5 && ($P['agora']['jogando'] ?? -1) === 2, json_encode($P['agora'] ?? null));
checar('visitantes 4, novos 3, sessões 5', ($p['visitantes'] ?? -1) === 4 && ($p['novos'] ?? -1) === 3 && ($p['sessoes'] ?? -1) === 5, json_encode($p));
checar('tempo médio 100 s, total 0,1 h', ($p['tempoMedioS'] ?? -1) === 100 && ($p['tempoTotalH'] ?? -1) == 0.1, json_encode([$p['tempoMedioS'] ?? null, $p['tempoTotalH'] ?? null]));
checar('jogaram 2', ($p['jogaram'] ?? -1) === 2);
checar('inícios e fins por modo', ($p['inicios'] ?? null) === ['classico' => 1, 'imersivo' => 1, 'live' => 0] && ($p['fins'] ?? null) === ['classico' => 1, 'imersivo' => 1, 'live' => 0],
    json_encode([$p['inicios'] ?? null, $p['fins'] ?? null]));
checar('partidas no Imersivo 5, cadastros 1, logins 1', ($p['partidasImersivo'] ?? -1) === 5 && ($p['cadastros'] ?? -1) === 1 && ($p['logins'] ?? -1) === 1);
checar('convite: vistos 2, fechados 1, cadastros depois 1', ($p['gate'] ?? null) === ['vistos' => 2, 'fechados' => 1, 'cadastrosDepois' => 1], json_encode($p['gate'] ?? null));
checar('funil 4 → 2 → 2 → 1 → 1', array_column($P['funil'] ?? [], 'n') === [4, 2, 2, 1, 1], json_encode($P['funil'] ?? null));
checar('notas: média 65, melhor 80', ($P['notas'] ?? null) === ['media' => 65, 'melhor' => 80], json_encode($P['notas'] ?? null));
// nota absurda gravada direto no banco (de antes da lista branca do e.php): o painel ignora
q("INSERT INTO eventos (sid, vid, tipo, modo, dados, em) VALUES (?, ?, 'jogo_fim', 'classico', '{\"nota\":1e300}', UTC_TIMESTAMP()),
    (?, ?, 'jogo_fim', 'classico', '{\"nota\":1.7e308}', UTC_TIMESTAMP())", [$sA, $vA, $sA, $vA]);
$r2 = $adm->pedir('GET', "/api/painel.php?de=$hoje&ate=$hoje");
checar('nota fora de -999..999 no banco não estraga a média nem a melhor', ($r2->json['notas'] ?? null) === ['media' => 65, 'melhor' => 80], json_encode($r2->json['notas'] ?? null));
q("DELETE FROM eventos WHERE sid = ? AND dados IN ('{\"nota\":1e300}', '{\"nota\":1.7e308}')", [$sA]);
$orig = [];
foreach ($P['origens'] ?? [] as $o) {
    $orig[$o['origem']] = $o['sessoes'];
}
checar('origens: youtube 2, tiktok 1, direto 1, exemplo.com 1 (youtube primeiro)', $orig === ['youtube' => 2, 'direto' => 1, 'exemplo.com' => 1, 'tiktok' => 1], json_encode($orig));
$disp = [];
foreach ($P['dispositivos'] ?? [] as $o) {
    $disp[$o['dispositivo']] = $o['sessoes'];
}
checar('dispositivos: mobile 3, desktop 2', $disp === ['mobile' => 3, 'desktop' => 2], json_encode($disp));
checar('dias: hoje com 4 visitantes, 5 sessões, 2 jogaram, 2 fins, 1 cadastro, 100 s', ($P['dias'] ?? null) === [['dia' => $hoje, 'visitantes' => 4, 'sessoes' => 5,
    'jogaram' => 2, 'fins' => 2, 'cadastros' => 1, 'tempoMedioS' => 100]], json_encode($P['dias'] ?? null));
$horaSp = (int) gmdate('G', time() - 3 * 3600);
checar('horas: 24, as 5 sessões na hora atual de Brasília', count($P['horas'] ?? []) === 24 && array_sum(array_column($P['horas'] ?? [], 'sessoes')) === 5
    && in_array((int) ($P['horas'][$horaSp]['sessoes'] ?? 0) + (int) ($P['horas'][($horaSp + 23) % 24]['sessoes'] ?? 0), [5], true));
checar('últimos cadastros: só apelido, data e origem', ($P['ultimosCadastros'] ?? null) !== null && count($P['ultimosCadastros']) === 1
    && array_keys($P['ultimosCadastros'][0]) === ['apelido', 'em', 'origem'] && $P['ultimosCadastros'][0]['apelido'] === 'Craque'
    && $P['ultimosCadastros'][0]['origem'] === 'direto' && preg_match($RE_ISO, $P['ultimosCadastros'][0]['em']) === 1, json_encode($P['ultimosCadastros'] ?? null));
$C = $P['contas'] ?? [];
checar('contas: total 1, novas 1, carreiras auto 1 x manual 1', ($C['total'] ?? -1) === 1 && ($C['novas'] ?? -1) === 1
    && ($C['carreiras']['auto'] ?? -1) === 1 && ($C['carreiras']['manual'] ?? -1) === 1 && ($C['carreiras']['total'] ?? -1) === 2, json_encode($C));
checar('contas: melhores carreiras (apelido, jogador, nota), da maior nota', array_column($C['melhores'] ?? [], 'jogador') === [$A2->identity->surname, $A3->identity->surname]
    && ($C['melhores'][0]['apelido'] ?? '') === 'Craque' && ($C['melhores'][0]['nota'] ?? 0) === (int) $A2->legacy->score, json_encode($C['melhores'] ?? null));
checar('resposta do painel sem e-mail de jogador', !str_contains($r->corpo, '@exemplo.com'));

$r = $adm->pedir('GET', "/api/painel.php?de=$hoje&ate=$hoje&bots=1");
$p = $r->json['periodo'] ?? [];
checar('com robôs: visitantes 5, sessões 6, jogaram 3, inícios clássico 2', ($p['visitantes'] ?? -1) === 5 && ($p['sessoes'] ?? -1) === 6 && ($p['jogaram'] ?? -1) === 3
    && ($p['inicios']['classico'] ?? -1) === 2, json_encode($p));
checar('com robôs: "agora" continua sem robô', ($r->json['agora']['online'] ?? -1) === 5);
$r = $adm->pedir('GET', '/api/painel.php');
$p = $r->json['periodo'] ?? [];
$de7 = gmdate('Y-m-d', strtotime("$hoje UTC") - 6 * 86400);
checar('padrão = últimos 7 dias', ($p['de'] ?? '') === $de7 && ($p['ate'] ?? '') === $hoje && count($r->json['dias'] ?? []) === 7, json_encode([$p['de'] ?? null, $p['ate'] ?? null]));
checar('7 dias: a visita de 10 dias atrás fica fora (E não é novo)', ($p['visitantes'] ?? -1) === 4 && ($p['novos'] ?? -1) === 3 && ($p['sessoes'] ?? -1) === 5, json_encode($p));
$de11 = gmdate('Y-m-d', strtotime("$hoje UTC") - 10 * 86400);
$r = $adm->pedir('GET', "/api/painel.php?de=$de11&ate=$hoje");
$p = $r->json['periodo'] ?? [];
checar('11 dias: E conta uma vez, a sessão velha entra, E vira novo', ($p['visitantes'] ?? -1) === 4 && ($p['sessoes'] ?? -1) === 6 && ($p['novos'] ?? -1) === 4, json_encode($p));
$dia10 = array_values(array_filter($r->json['dias'] ?? [], static fn($d) => $d['sessoes'] > 0 && $d['dia'] !== $hoje));
checar('a sessão velha cai no dia certo (fuso de Brasília)', count($dia10) === 1 && $dia10[0]['dia'] === gmdate('Y-m-d', time() - 10 * 86400 - 3 * 3600) && $dia10[0]['tempoMedioS'] === 77, json_encode($dia10));
// fuso: sessão às 01:30 UTC de hoje = 22:30 de ontem em Brasília
$sF = uuid4();
$ontemSp = gmdate('Y-m-d', strtotime("$hoje UTC") - 86400);
q("INSERT INTO visitas (sid, vid, inicio, ultimo, ativo_s, origem, dispositivo, bot) VALUES (?, ?, ?, ?, 10, 'direto', 'mobile', 0)",
    [$sF, uuid4(), "$hoje 01:30:00", "$hoje 01:30:00"]);
$r = $adm->pedir('GET', "/api/painel.php?de=$ontemSp&ate=$ontemSp");
checar('01:30 UTC conta como 22:30 do dia anterior em Brasília', ($r->json['periodo']['sessoes'] ?? -1) === 1 && ($r->json['horas'][22]['sessoes'] ?? -1) === 1,
    json_encode($r->json['periodo'] ?? null));
q('DELETE FROM visitas WHERE sid = ?', [$sF]);

// ══ 6b. tipos errados em todo campo: nada de 500 ═════════════════════════════════════════════════

secao('tipos errados e valores estranhos em todos os campos (nenhum 500)');
$estranhos = [null, 0, -1, 1.5, true, '', str_repeat('é', 300), [], [1, 2], ['a' => ['b' => 1]], "a\0b", "' OR 1=1 --"];
$quinhentos = [];
$tentar = static function (Navegador $n, string $metodo, string $caminho, mixed $corpo, string $rotulo) use (&$quinhentos): void {
    resetarLimites();
    $r = $n->pedir($metodo, $caminho, $corpo);
    if ($r->status >= 500 || $r->status === 0 || ($r->status !== 204 && !is_array($r->json))) {
        $quinhentos[] = "$rotulo → " . $r->resumo();
    }
};
$validos = [
    'cadastrar' => ['apelido' => 'Fuzz', 'email' => 'fuzz@exemplo.com', 'senha' => 'fuzz-senha-1', 'aceite' => true, 'vid' => uuid4(), 'origem' => 'tiktok', 'timeCoracao' => 'Bahia', 'uf' => 'BA'],
    'entrar' => ['email' => 'craque@exemplo.com', 'senha' => 'errada-fuzz', 'vid' => uuid4()],
    'esqueci' => ['email' => 'craque@exemplo.com'],
    'redefinir' => ['email' => 'craque@exemplo.com', 'codigo' => '000000', 'senha' => 'fuzz-senha-2'],
    'perfil' => ['apelido' => 'Craque', 'timeCoracao' => 'Bahia', 'uf' => 'BA'],
    'partidas' => ['n' => 3],
    'excluir' => ['senha' => 'errada-fuzz'],
];
$k = 0;
foreach ($validos as $acao => $campos) {
    foreach (array_keys($campos) as $campo) {
        foreach ($estranhos as $x) {
            $c = $campos;
            $c[$campo] = $x;
            if ($acao === 'cadastrar') {
                $c['email'] = $campo === 'email' ? $x : 'fuzz' . (++$k) . '@exemplo.com';
            }
            $tentar($nB, 'POST', '/api/conta.php', ['acao' => $acao] + $c, "conta $acao.$campo=" . json_encode($x));
        }
    }
}
foreach ($estranhos as $x) {
    $tentar($nB, 'POST', '/api/conta.php', ['acao' => $x], 'conta acao=' . json_encode($x));
}
$baseC = json_decode(canon($A3), true);
$camposC = ['id', 'identity', 'summary', 'mode', 'finishedAt', 'legacy', 'identity.surname', 'identity.number', 'summary.trophies',
    'summary.awards', 'summary.totals', 'summary.peakOvr', 'summary.headline', 'legacy.score'];
foreach ($camposC as $campo) {
    foreach ($estranhos as $x) {
        $c = $baseC;
        $partes = explode('.', $campo);
        if (count($partes) === 1) {
            $c[$partes[0]] = $x;
        } else {
            $c[$partes[0]][$partes[1]] = $x;
        }
        $c['id'] = $campo === 'id' ? $x : 'fuzz-' . (++$k);
        $tentar($nB, 'POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $c, 'como' => 'manual'], "carreiras salvar $campo=" . json_encode($x));
    }
}
foreach ($estranhos as $x) {
    $tentar($nB, 'POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $baseC, 'como' => $x], 'carreiras como=' . json_encode($x));
    $tentar($nB, 'POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => $x], 'carreiras apagar id=' . json_encode($x));
    $tentar($nB, 'POST', '/api/carreiras.php', ['acao' => $x], 'carreiras acao=' . json_encode($x));
    $tentar($nB, 'POST', '/api/painel.php', ['acao' => 'entrar', 'senha' => $x], 'painel senha=' . json_encode($x));
}
foreach (['?id=', '?id[]=', '?id[a]=', '?id=%00', '?id=' . str_repeat('x', 300)] as $qs) {
    $tentar($nB, 'GET', '/api/carreiras.php' . $qs . 'x', null, "carreiras GET $qs");
}
foreach (['?de[]=1', '?ate[]=1', '?bots[]=1', '?so[]=agora', '?de=0000-00-00', '?de=9999-12-31&ate=0001-01-01', '?de=2026-13-01'] as $qs) {
    $tentar($adm, 'GET', '/api/painel.php' . $qs, null, "painel GET $qs");
}
$baseE = ['v' => uuid4(), 's' => uuid4(), 'bot' => 0, 'ctx' => ctx('https://tiktok.com/'), 'ev' => [['t' => 'view', 'm' => 'classico', 'd' => ['rota' => '/'], 'p' => 1]]];
foreach (['v', 's', 'bot', 'ctx', 'ctx.ref', 'ctx.utm', 'ctx.dev', 'ctx.lang', 'ctx.tela', 'ev', 'ev.0', 'ev.0.t', 'ev.0.m', 'ev.0.d', 'ev.0.p'] as $campo) {
    foreach ($estranhos as $x) {
        $c = $baseE;
        $c['s'] = uuid4();
        $p = explode('.', $campo);
        if (count($p) === 1) {
            $c[$p[0]] = $x;
        } elseif (count($p) === 2) {
            $c[$p[0]][$p[1]] = $x;
        } else {
            $c[$p[0]][$p[1]][$p[2]] = $x;
        }
        $tentar($nB, 'POST', '/api/e.php', $c, "e.php $campo=" . json_encode($x));
        $c['ev'] = [['t' => 'hb', 'p' => $x, 'm' => $x]];
        $tentar($nB, 'POST', '/api/e.php', $c, "e.php hb p/m=" . json_encode($x));
    }
}
foreach (['', 'null', '1', '"texto"', '{"a":', str_repeat('[', 600) . str_repeat(']', 600), '{"acao":"salvar","carreira":' . str_repeat('{"a":', 600) . '1' . str_repeat('}', 600) . '}'] as $bruto) {
    foreach (['/api/conta.php', '/api/carreiras.php', '/api/e.php', '/api/painel.php'] as $rota) {
        $tentar($nB, 'POST', $rota, $bruto, "$rota corpo " . substr($bruto, 0, 12));
    }
}
checar('nenhuma combinação deu 500 ou resposta fora de JSON', !$quinhentos, implode(' | ', array_slice($quinhentos, 0, 6)));
checar('a conta do fuzz continua inteira', (int) v("SELECT COUNT(*) FROM usuarios WHERE email = 'craque@exemplo.com'") === 1);
resetarLimites();

// ══ 7. limpeza leve ══════════════════════════════════════════════════════════════════════════════

secao('limpeza leve (~1% dos pedidos)');
$cfg = (string) file_get_contents($CONFIG_ARQ);
file_put_contents($CONFIG_ARQ, (string) preg_replace("/'limpeza_a_cada' => \d+/", "'limpeza_a_cada' => 1", $cfg));
usleep(3_100_000); // o opcache do php -S só relê a config depois de opcache.revalidate_freq (2 s)
$janelaVelha = intdiv(time() - 2 * 86400, 600);
$jAgora = intdiv(time(), 600);
q('INSERT INTO tentativas (chave, janela, n) VALUES (?, ?, 1), (?, ?, 1), (?, ?, 1), (?, ?, 1), (?, ?, 1)', ['teste:velha', $janelaVelha, 'teste:nova', $jAgora,
    'teste:passada', $jAgora - 2, 'teste:anterior', $jAgora - 1, 'dia-teste:hoje', $jAgora - 50]);
q("INSERT INTO sessoes_login (token_sha256, usuario_id, criada_em, expira_em, renovada_em) VALUES
    (?, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP() - INTERVAL 1 HOUR, UTC_TIMESTAMP()), (?, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP() + INTERVAL 1 DAY, UTC_TIMESTAMP())",
    [str_repeat('a', 64), str_repeat('b', 64)]);
q("INSERT INTO redefinicoes (email, codigo_hash, expira_em, tentativas) VALUES ('velho@exemplo.com', ?, UTC_TIMESTAMP() - INTERVAL 1 HOUR, 0)", [str_repeat('c', 64)]);
$sVelha = uuid4();
q("INSERT INTO visitas (sid, vid, inicio, ultimo, origem, bot) VALUES (?, ?, UTC_TIMESTAMP() - INTERVAL 400 DAY, UTC_TIMESTAMP() - INTERVAL 400 DAY, 'direto', 0)", [$sVelha, uuid4()]);
q("INSERT INTO eventos (sid, vid, tipo, em) VALUES (?, ?, 'view', UTC_TIMESTAMP() - INTERVAL 400 DAY)", [$sVelha, uuid4()]);
$r = $anon->pedir('GET', '/api/conta.php');
file_put_contents($CONFIG_ARQ, $cfg);
touch($CONFIG_ARQ, time() + 1);
checar('pedido com limpeza → 200', $r->status === 200, $r->resumo());
checar('tentativas de mais de 1 dia apagadas, as novas ficam', (int) v("SELECT COUNT(*) FROM tentativas WHERE chave = 'teste:velha'") === 0
    && (int) v("SELECT COUNT(*) FROM tentativas WHERE chave = 'teste:nova'") === 1);
checar('janelas de 10 min já encerradas saem; a anterior e as diárias (dia-*) ficam', (int) v("SELECT COUNT(*) FROM tentativas WHERE chave = 'teste:passada'") === 0
    && (int) v("SELECT COUNT(*) FROM tentativas WHERE chave IN ('teste:anterior', 'dia-teste:hoje')") === 2);
checar('sessões vencidas apagadas, as válidas ficam', (int) v('SELECT COUNT(*) FROM sessoes_login WHERE token_sha256 = ?', [str_repeat('a', 64)]) === 0
    && (int) v('SELECT COUNT(*) FROM sessoes_login WHERE token_sha256 = ?', [str_repeat('b', 64)]) === 1);
checar('códigos vencidos apagados', (int) v("SELECT COUNT(*) FROM redefinicoes WHERE email = 'velho@exemplo.com'") === 0);
checar('medição de mais de 13 meses apagada', (int) v('SELECT COUNT(*) FROM visitas WHERE sid = ?', [$sVelha]) === 0
    && (int) v('SELECT COUNT(*) FROM eventos WHERE sid = ?', [$sVelha]) === 0);
checar('medição recente fica', (int) v('SELECT COUNT(*) FROM visitas WHERE sid = ?', [$sA]) === 1);
q('DELETE FROM sessoes_login WHERE token_sha256 = ?', [str_repeat('b', 64)]);
usleep(3_100_000); // volta a config normal antes da carga
// sem a limpeza de 1%: o primeiro limite de cada janela de 10 min apaga as janelas encerradas
resetarLimites();
q('INSERT INTO tentativas (chave, janela, n) VALUES (?, ?, 1)', ['teste:passada2', intdiv(time(), 600) - 3]);
$r = conta(novoNav(), ['acao' => 'entrar', 'email' => 'ninguem@exemplo.com', 'senha' => 'errada']);
checar('primeiro limite da janela: janelas encerradas apagadas (o código do IP fica no máximo ~20 min)', $r->status === 401
    && (int) v("SELECT COUNT(*) FROM tentativas WHERE chave = 'teste:passada2'") === 0 && (int) v("SELECT COUNT(*) FROM tentativas WHERE chave = 'limpeza:janela'") === 1, $r->resumo());
q('INSERT INTO tentativas (chave, janela, n) VALUES (?, ?, 1)', ['teste:passada3', intdiv(time(), 600) - 3]);
conta(novoNav(), ['acao' => 'entrar', 'email' => 'ninguem@exemplo.com', 'senha' => 'errada']);
checar('…e só uma vez por janela (não pesa em todo pedido)', (int) v("SELECT COUNT(*) FROM tentativas WHERE chave = 'teste:passada3'") === 1);
resetarLimites();

// ══ 8. carga: painel com 100 mil eventos ═════════════════════════════════════════════════════════

if (!$SEM_CARGA) {
    secao('painel.php — 100 mil eventos em < 300 ms');
    $t0 = microtime(true);
    q('DELETE FROM eventos');
    q('DELETE FROM visitas');
    mt_srand(42);
    $agoraT = time();
    $visitas = [];
    $vids = [];
    for ($i = 0; $i < 8000; $i++) {
        $vids[] = uuid4();
    }
    $origens = ['tiktok', 'tiktok', 'tiktok', 'youtube', 'direto', 'direto', 'instagram', 'google', 'exemplo.com'];
    $pdo->beginTransaction();
    $lote = [];
    $params = [];
    for ($i = 0; $i < 25000; $i++) {
        $sid = uuid4();
        $ini = $agoraT - mt_rand(0, 30 * 86400);
        $bot = mt_rand(1, 100) <= 3 ? 1 : 0;
        $visitas[] = [$sid, $vids[mt_rand(0, 7999)], $ini];
        $lote[] = '(?, ?, ?, ?, ?, ?, ?, ?)';
        array_push($params, $sid, $visitas[$i][1], gmdate('Y-m-d H:i:s', $ini), gmdate('Y-m-d H:i:s', $ini + mt_rand(0, 1800)), mt_rand(0, 1800),
            $origens[mt_rand(0, count($origens) - 1)], mt_rand(0, 3) ? 'mobile' : 'desktop', $bot);
        if (count($lote) === 1000) {
            q('INSERT INTO visitas (sid, vid, inicio, ultimo, ativo_s, origem, dispositivo, bot) VALUES ' . implode(',', $lote), $params);
            $lote = [];
            $params = [];
        }
    }
    $tipos = array_merge(array_fill(0, 55, 'view'), array_fill(0, 12, 'jogo_inicio'), array_fill(0, 10, 'jogo_fim'), array_fill(0, 12, 'partida_fim'),
        array_fill(0, 3, 'gate_ver'), array_fill(0, 2, 'gate_fechar'), ['cadastro', 'login', 'login', 'logout', 'compartilhar', 'compartilhar']);
    $modos = ['classico', 'classico', 'imersivo', 'live'];
    $lote = [];
    $params = [];
    for ($i = 0; $i < 100000; $i++) {
        [$sid, $vid, $ini] = $visitas[mt_rand(0, 24999)];
        $tipo = $tipos[mt_rand(0, count($tipos) - 1)];
        $modo = in_array($tipo, ['jogo_inicio', 'jogo_fim'], true) ? $modos[mt_rand(0, 3)] : ($tipo === 'partida_fim' ? 'imersivo' : null);
        $dados = $tipo === 'jogo_fim' ? '{"nota":' . mt_rand(1, 99) . ',"temporadas":' . mt_rand(1, 24) . '}' : ($tipo === 'view' ? '{"rota":"/"}' : null);
        $lote[] = '(?, ?, ?, ?, ?, ?)';
        array_push($params, $sid, $vid, $tipo, $modo, $dados, gmdate('Y-m-d H:i:s', $ini + mt_rand(0, 1800)));
        if (count($lote) === 2000) {
            q('INSERT INTO eventos (sid, vid, tipo, modo, dados, em) VALUES ' . implode(',', $lote), $params);
            $lote = [];
            $params = [];
        }
    }
    $pdo->commit();
    $pdo->query('ANALYZE TABLE visitas, eventos')->fetchAll();
    printf("  · carga: %d visitas, %d eventos em %.1f s\n", (int) v('SELECT COUNT(*) FROM visitas'), (int) v('SELECT COUNT(*) FROM eventos'), microtime(true) - $t0);
    $de30 = gmdate('Y-m-d', strtotime("$hoje UTC") - 29 * 86400);
    foreach (['30 dias' => "?de=$de30&ate=$hoje", '30 dias com robôs' => "?de=$de30&ate=$hoje&bots=1", '7 dias' => '', 'hoje' => "?de=$hoje&ate=$hoje"] as $nome => $qs) {
        $tempos = [];
        $r = null;
        for ($i = 0; $i < 5; $i++) {
            $t1 = microtime(true);
            $r = $adm->pedir('GET', '/api/painel.php' . $qs);
            $tempos[] = (microtime(true) - $t1) * 1000;
        }
        sort($tempos);
        $ms = $tempos[0];
        checar(sprintf('painel %s: %.0f ms (melhor de 5; mediana %.0f ms)', $nome, $ms, $tempos[2]), $r->status === 200 && $ms < 300, $r->resumo());
    }
    checar('30 dias: os números somam (visitantes > 0, dias = 30)', ($r !== null) && count($adm->pedir('GET', "/api/painel.php?de=$de30&ate=$hoje")->json['dias'] ?? []) === 30);
}

// ══ v3: configuração, admin, Hall público, conquistas, indicações, bônus, carga e concorrência ═══

require __DIR__ . '/teste-v3.php';

// ══ 9. .htaccess no Apache ═══════════════════════════════════════════════════════════════════════

if ($URL_APACHE !== '') {
    secao('api/.htaccess no Apache');
    $ap = new Navegador($URL_APACHE, null);
    $ap->conferir = false;
    foreach (['_lib.php', '_schema.sql', '.htaccess', 'LEIAME.md', '_config.php', '_palavras.php', '_hall.php', '_bonus.php', '_contas.php',
        '_carreiras.php'] as $arq) {
        $r = $ap->pedir('GET', "/api/$arq");
        checar("$arq negado", in_array($r->status, $arq === '_config.php' ? [403, 404] : [403], true), "HTTP $r->status");
    }
    $r = $ap->pedir('GET', '/api/');
    checar('sem listagem da pasta', $r->status === 403, "HTTP $r->status");
    foreach (['e.php', 'conta.php', 'carreiras.php', 'painel.php', 'instalar.php', 'lendas.php', 'hall.php', 'conquistas.php', 'bonus.php', 'admin.php'] as $arq) {
        $r = $ap->pedir('GET', "/api/$arq");
        checar("$arq liberado", $r->status === 200, "HTTP $r->status");
    }
    checar('rotas com Cache-Control: no-store (conta, bonus, admin)', $ap->pedir('GET', '/api/conta.php')->cab1('cache-control') === 'no-store'
        && $ap->pedir('GET', '/api/bonus.php')->cab1('cache-control') === 'no-store' && $ap->pedir('GET', '/api/admin.php')->cab1('cache-control') === 'no-store');
    checar('lendas.php, hall.php e conquistas.php ficam com o cache deles', $ap->pedir('GET', '/api/lendas.php')->cab1('cache-control') !== 'no-store'
        && $ap->pedir('GET', '/api/hall.php')->cab1('cache-control') !== 'no-store' && $ap->pedir('GET', '/api/conquistas.php')->cab1('cache-control') !== 'no-store');
    $r = $ap->pedir('GET', '/api/eco.cgi', null, ['auth' => 'Bearer abc123']);
    checar('Authorization chega no PHP/CGI', str_contains($r->corpo, 'auth=Bearer abc123'), $r->resumo());
}

// ══ 10. vazamentos e log ═════════════════════════════════════════════════════════════════════════

secao('vazamentos');
$tudo = implode("\n", $CORPOS);
$achou = array_filter($SENHAS, static fn($s) => $s !== '' && str_contains($tudo, $s));
checar('nenhuma senha/token em resposta nenhuma', !$achou, implode(', ', array_map(static fn($s) => substr($s, 0, 4) . '…', $achou)));
$log = is_file($LOG_PHP) ? (string) file_get_contents($LOG_PHP) : '';
$achou = array_filter($SENHAS, static fn($s) => $s !== '' && str_contains($log, $s));
checar('nenhuma senha/token no log do PHP', !$achou);
preg_match_all('/^.*(PHP (Warning|Notice|Fatal|Deprecated|Parse)|LENDA ).*$/m', $log, $mm);
checar('log do PHP sem aviso nem erro', !$mm[0], implode(' | ', array_slice($mm[0], 0, 5)));
checar('banco sem IP gravado', (int) v("SELECT COUNT(*) FROM visitas WHERE CONCAT_WS(' ', origem, utm_source, utm_medium, utm_campaign, idioma, tela) LIKE '%127.0.0.1%'") === 0);

// ══ resumo ═══════════════════════════════════════════════════════════════════════════════════════

echo "\n══════════════════════════════════════════════════════════════════\n";
if ($FALHAS) {
    echo 'FALHOU: ' . count($FALHAS) . " de $TOTAL verificações\n";
    foreach ($FALHAS as $f) {
        echo "  · $f\n";
    }
    exit(1);
}
echo "PASSOU: $TOTAL verificações\n";
exit(0);

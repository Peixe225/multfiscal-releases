<?php
/**
 * LENDA · teste de atualização (chamado pelo atualizar.sh). Duas fases:
 *   php atualizar.php antes   — com o servidor de antes no ar: cria dados de verdade pela API dele e guarda cada linha de
 *                               cada tabela em $LENDA_ESTADO (os binários em base64).
 *   php atualizar.php depois  — com os arquivos novos e o instalar.php já rodado duas vezes: confere que nenhuma linha
 *                               sumiu nem mudou nas colunas que já existiam, que a 2ª instalação não mudou nada e que o
 *                               jogo e o painel novos respondem com os dados de antes.
 */
declare(strict_types=1);

$URL = (string) getenv('LENDA_URL');
$ORIGEM = (string) getenv('LENDA_ORIGEM');
$ESTADO = (string) getenv('LENDA_ESTADO');
$AMOSTRAS = (string) getenv('LENDA_AMOSTRAS');
$TOKEN = (string) getenv('PAINEL_TOKEN');
$SENHA = (string) getenv('PAINEL_SENHA');
$pdo = new PDO((string) getenv('LENDA_DSN'), 'lenda', 'lenda', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec("SET time_zone = '+00:00'");
$falhas = 0;
$total = 0;
function checar(string $m, bool $c, string $d = ''): bool
{
    global $falhas, $total;
    $total++;
    echo ($c ? '  ok      ' : '  FALHOU  ') . $m . ($c || $d === '' ? '' : " — $d") . "\n";
    if (!$c) {
        $falhas++;
    }
    return $c;
}
/** [status, json, corpo, cookies]. $cookie: "nome=valor; ...". */
function pedir(string $metodo, string $caminho, mixed $corpo = null, string $cookie = '', array $cab = []): array
{
    global $URL, $ORIGEM;
    $h = array_merge(['Expect:'], $cab);
    if ($corpo !== null) {
        $h[] = 'Content-Type: ' . (is_string($corpo) ? 'text/plain' : 'application/json');
        $h[] = 'Origin: ' . $ORIGEM;
    }
    if ($cookie !== '') {
        $h[] = 'Cookie: ' . $cookie;
    }
    $ch = curl_init($URL . $caminho);
    $cookies = [];
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $metodo, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $h, CURLOPT_TIMEOUT => 60,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
        CURLOPT_HEADERFUNCTION => static function ($ch, string $l) use (&$cookies): int {
            if (stripos($l, 'set-cookie:') === 0) {
                $par = trim(explode(';', substr($l, 11), 2)[0]);
                $cookies[] = $par;
            }
            return strlen($l);
        }]);
    if ($corpo !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($corpo) ? $corpo : json_encode($corpo, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }
    $txt = (string) curl_exec($ch);
    $st = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return [$st, json_decode($txt, true), $txt, implode('; ', $cookies)];
}
function adm(string $metodo, string $caminho, ?array $corpo = null): array
{
    global $TOKEN;
    return pedir($metodo, $caminho, $corpo, '', ['Authorization: Bearer ' . $TOKEN]);
}
function uuid(): string
{
    $h = bin2hex(random_bytes(16));
    return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-4' . substr($h, 13, 3) . '-a' . substr($h, 17, 3) . '-' . substr($h, 20, 12);
}
function amostra(string $nome, string $id, array $muda = []): array
{
    global $AMOSTRAS;
    $j = json_decode((string) file_get_contents("$AMOSTRAS/$nome.json"), true);
    $h = $j['hall'][0] ?? $j;
    $h['id'] = $id;
    $h['career']['id'] = $id;
    $h['summary']['atualizar'] = $id;
    $h['legacy'] = ($muda['legacy'] ?? []) + ($h['legacy'] ?? []) + ['v' => 2];
    $h['legacy']['v'] = 2;
    return $h;
}
/** Cada linha de cada tabela (binários em base64), na ordem da chave primária. */
function fotografia(PDO $pdo): array
{
    $out = [];
    foreach ($pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $t) {
        $pk = array_column(array_filter($pdo->query("SHOW KEYS FROM `$t`")->fetchAll(), static fn($k) => $k['Key_name'] === 'PRIMARY'), 'Column_name');
        $ordem = $pk ? implode(', ', array_map(static fn($c) => "`$c`", $pk)) : '1';
        $linhas = [];
        foreach ($pdo->query("SELECT * FROM `$t` ORDER BY $ordem") as $l) {
            foreach ($l as $k => $v) {
                if (is_string($v) && !mb_check_encoding($v, 'UTF-8')) {
                    $l[$k] = 'b64:' . base64_encode($v);
                }
            }
            $linhas[] = $l;
        }
        $out[$t] = ['pk' => $pk, 'linhas' => $linhas];
    }
    return $out;
}

$fase = $argv[1] ?? '';
if ($fase === 'antes') {
    echo "── antes: dados de verdade pela API da versão no ar\n";
    $vids = [];
    $contas = [];
    foreach (['Antiga Um' => 'antiga1@exemplo.com', 'Antiga Dois' => 'antiga2@exemplo.com', 'Antiga Tres' => 'antiga3@exemplo.com'] as $ap => $email) {
        $vid = uuid();
        $corpo = ['acao' => 'cadastrar', 'apelido' => $ap, 'email' => $email, 'senha' => 'senha-antiga-123', 'aceite' => true, 'vid' => $vid];
        if ($contas) {
            [, $j] = pedir('GET', '/api/conta.php', null, $contas['Antiga Um']['cookie']);
            $corpo['convite'] = $j['usuario']['codigoConvite'] ?? null;
        }
        [$st, $j, $txt, $ck] = pedir('POST', '/api/conta.php', $corpo, '', ['X-Forwarded-For: 10.61.0.' . (count($contas) + 1)]);
        checar("cadastro de $ap na versão de antes", $st === 201, "$st " . substr($txt, 0, 200));
        $contas[$ap] = ['id' => (int) ($j['usuario']['id'] ?? 0), 'cookie' => $ck, 'vid' => $vid, 'email' => $email];
        $sid = uuid();
        $stE = [];
        foreach ([[['t' => 'view', 'm' => null, 'd' => ['rota' => '/']], ['t' => 'hb', 'p' => 0]], [['t' => 'jogo_inicio', 'm' => 'classico', 'd' => ['ritmo' => 'expressa']], ['t' => 'hb', 'p' => 1]],
            [['t' => 'jogo_fim', 'm' => 'classico', 'd' => ['nota' => 61, 'temporadas' => 18, 'pico' => 88]], ['t' => 'hb', 'p' => 1]]] as $ev) {
            $stE[] = pedir('POST', '/api/e.php', json_encode(['v' => $vid, 's' => $sid, 'bot' => 0, 'ctx' => ['dev' => 'mobile', 'lang' => 'pt-BR', 'ref' => 'tiktok.com'], 'ev' => $ev]), $ck)[0];
        }
        checar("medição de $ap (view, jogo_inicio, jogo_fim) na versão de antes", !array_diff($stE, [204, 200]), implode(',', $stE));
    }
    $a = $contas['Antiga Um'];
    $b = $contas['Antiga Dois'];
    $c = $contas['Antiga Tres'];
    [$st] = pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => amostra('v-intenso-01', 'career-antiga-a1'), 'como' => 'auto'], $a['cookie']);
    [$st2] = pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => amostra('v-otima-06', 'career-antiga-a2'), 'como' => 'manual'], $a['cookie']);
    [$st3] = pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => amostra('v-mediana-03', 'career-antiga-b1'), 'como' => 'manual'], $b['cookie']);
    checar('carreiras salvas na versão de antes (3)', $st === 200 && $st2 === 200 && $st3 === 200, "$st $st2 $st3");
    [$st] = pedir('POST', '/api/conquistas.php', ['acao' => 'sincronizar', 'conquistas' => [['id' => 'first_goal', 'em' => '2026-10-01T12:00:00Z'], ['id' => 'golden_ball', 'em' => '2026-10-02T12:00:00Z']]], $a['cookie']);
    checar('conquistas na conta (versão de antes)', $st === 200);
    [$st] = adm('POST', '/api/admin.php', ['acao' => 'atualizar_hall']);
    [$st4, $j] = pedir('POST', '/api/hall.php', ['acao' => 'denunciar', 'id' => 'career-antiga-b1', 'motivo' => 'trapaca', 'texto' => 'Denúncia de antes'], $c['cookie']);
    checar('Hall refeito e uma denúncia aberta (versão de antes)', $st === 200 && $st4 === 200, "$st $st4 " . json_encode($j));
    $pkA2 = (int) $pdo->query("SELECT id FROM carreiras WHERE carreira_id = 'career-antiga-a2'")->fetchColumn();
    [$st] = adm('POST', '/api/admin.php', ['acao' => 'ocultar_carreira', 'id' => $pkA2]);
    [$st2] = adm('POST', '/api/admin.php', ['acao' => 'dar_bonus', 'id' => $a['id'], 'valor' => 2, 'motivo' => 'Presente de antes']);
    [$st3] = adm('POST', '/api/admin.php', ['acao' => 'config', 'valores' => ['aviso' => ['texto' => 'Aviso de antes', 'tipo' => 'info']]]);
    checar('admin na versão de antes: ocultar, bônus e aviso', $st === 200 && $st2 === 200 && $st3 === 200, "$st $st2 $st3");
    [$st, , , $ckPainel] = pedir('POST', '/api/painel.php', ['acao' => 'entrar', 'senha' => $SENHA]);
    checar('painel de antes: entrou com a senha (cookie da v3)', $st === 200 && str_contains($ckPainel, 'lenda_painel='), "$st");
    $foto = fotografia($pdo);
    file_put_contents($ESTADO, json_encode(['contas' => $contas, 'painel' => $ckPainel, 'pkA2' => $pkA2, 'foto' => $foto], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    echo '· guardadas ' . array_sum(array_map(static fn($t) => count($t['linhas']), $foto)) . ' linhas de ' . count($foto) . " tabelas\n";
    exit($falhas ? 1 : 0);
}

if ($fase !== 'depois') {
    fwrite(STDERR, "uso: php atualizar.php antes|depois\n");
    exit(2);
}
echo "── depois: os arquivos novos e o instalar.php duas vezes\n";
$E = json_decode((string) file_get_contents($ESTADO), true);
$base = dirname($ESTADO);
$r1 = json_decode((string) file_get_contents("$base/instalar-1.json"), true);
$r2 = json_decode((string) file_get_contents("$base/instalar-2.json"), true);
checar('instalar.php novo (1ª vez): ok, acrescentou colunas/tabelas e não falta nada', ($r1['ok'] ?? false) === true && count($r1['alteracoes'] ?? []) > 0
    && (int) ($r1['preenchidas']['faltam'] ?? $r1['faltam'] ?? -1) === 0, substr((string) json_encode($r1), 0, 400));
checar('instalar.php novo (2ª vez): nada a mudar (idempotente)', ($r2['ok'] ?? false) === true && ($r2['alteracoes'] ?? null) === [], substr((string) json_encode($r2['alteracoes'] ?? null), 0, 300));
$alt = implode(' ', array_map('strval', (array) ($r1['alteracoes'] ?? [])));
checar('nenhuma alteração apaga ou troca coluna (só ADD e CREATE)', !preg_match('/\b(DROP|MODIFY|CHANGE|RENAME)\b/i', $alt), $alt);
checar('site_config._esquema = 32 gravado no fim', (string) $pdo->query("SELECT valor FROM site_config WHERE chave = '_esquema'")->fetchColumn() === '32');

// cada linha de antes continua lá, igual, nas colunas que já existiam
$agora = fotografia($pdo);
$volateis = ['tentativas']; // os limites mudam a cada pedido
$problemas = [];
$linhasConferidas = 0;
foreach ($E['foto'] as $t => $dados) {
    if (in_array($t, $volateis, true)) {
        continue;
    }
    if (!isset($agora[$t])) {
        $problemas[] = "tabela $t sumiu";
        continue;
    }
    $chave = static fn(array $l, array $pk): string => $pk ? implode('|', array_map(static fn($c) => (string) $l[$c], $pk)) : md5(json_encode($l));
    $depois = [];
    foreach ($agora[$t]['linhas'] as $l) {
        $depois[$chave($l, $dados['pk'])] = $l;
    }
    foreach ($dados['linhas'] as $l) {
        $k = $chave($l, $dados['pk']);
        if (!isset($depois[$k])) {
            $problemas[] = "$t: a linha $k sumiu";
            continue;
        }
        foreach ($l as $col => $v) {
            if (!array_key_exists($col, $depois[$k])) {
                $problemas[] = "$t: a coluna $col sumiu";
            } elseif ($depois[$k][$col] !== $v) {
                $problemas[] = "$t[$k].$col: " . substr(var_export($v, true), 0, 40) . ' → ' . substr(var_export($depois[$k][$col], true), 0, 40);
            }
        }
        $linhasConferidas++;
    }
}
checar("nenhuma linha de antes sumiu nem mudou ($linhasConferidas linhas conferidas, colunas antigas)", !$problemas, implode(' | ', array_slice($problemas, 0, 8)));

// o jogo novo com os dados de antes
$a = $E['contas']['Antiga Um'];
[$st, $j] = pedir('GET', '/api/conta.php', null, $a['cookie']);
checar('a sessão do jogador de antes continua valendo (conta.php com os campos novos)', $st === 200 && ($j['usuario']['apelido'] ?? '') === 'Antiga Um'
    && ($j['usuario']['tester'] ?? null) === false && array_key_exists('aviso', $j['usuario'] ?? []) && is_array($j['site']['avisos'] ?? null), "$st " . substr(json_encode($j), 0, 200));
[$st, $j] = pedir('GET', '/api/carreiras.php', null, $a['cookie']);
$porId = array_column($j['carreiras'] ?? [], null, 'id');
checar('carreiras.php: as de antes com o selo do Hall (a oculta pela moderação → oculta; a de nota 93 → revisão)',
    $st === 200 && ($porId['career-antiga-a2']['hall']['estado'] ?? '') === 'oculta' && ($porId['career-antiga-a1']['hall']['estado'] ?? '') === 'revisao', json_encode(array_map(static fn($c) => $c['hall'] ?? null, $porId)));
[$st, $j] = pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => amostra('v-otima-06', 'career-depois-a3', ['legacy' => ['score' => 62]]), 'como' => 'manual'], $a['cookie']);
checar('salvar uma carreira nova depois da atualização (C com hall)', $st === 200 && isset($j['carreira']['hall']['estado']), "$st " . substr(json_encode($j), 0, 200));
[$st] = pedir('POST', '/api/e.php', json_encode(['v' => $a['vid'], 's' => uuid(), 'bot' => 0, 'ctx' => ['dev' => 'mobile', 'lang' => 'pt-BR'], 'ev' => [['t' => 'view', 'm' => null, 'd' => ['rota' => '/hall']], ['t' => 'hb', 'p' => 0]]]), $a['cookie']);
checar('e.php do cliente de antes continua aceito', $st === 204 || $st === 200, (string) $st);
[$st, $j] = pedir('GET', '/api/hall.php');
checar('hall.php responde com a fotografia de antes', $st === 200 && is_array($j['itens'] ?? null), (string) $st);

// o painel novo
[$st] = pedir('GET', '/api/admin.php?r=resumo', null, (string) $E['painel']);
checar('o cookie do painel de antes deixa de valer (formato novo, sessões no servidor): 401', $st === 401, (string) $st);
[$st, $j, , $ck] = pedir('POST', '/api/painel.php', ['acao' => 'entrar', 'senha' => $SENHA]);
checar('painel novo: a senha de sempre entra (cria a conta Dono)', $st === 200 && ($j['etapa'] ?? '') === 'pronto' && str_contains($ck, 'lenda_painel='), "$st " . json_encode($j));
[$st, $j] = pedir('GET', '/api/admin.php?r=resumo', null, $ck);
checar('painel novo: resumo com as 3 contas, a denúncia e a oculta de antes', $st === 200 && ($j['usuarios']['total'] ?? 0) === 3 && ($j['denunciasAbertas'] ?? 0) === 1
    && ($j['carreiras']['ocultas'] ?? 0) === 1, "$st " . substr(json_encode($j), 0, 300));
[$st, $j] = pedir('GET', '/api/admin.php?r=atencao&atualizar=1', null, $ck);
$chaves = array_column($j['alertas'] ?? [], 'chave');
checar('painel novo: "Precisa de atenção" com a denúncia de antes', $st === 200 && in_array('denuncias_abertas', $chaves, true), "$st " . implode(',', $chaves));
[$st, $j] = pedir('GET', '/api/admin.php?r=usuario&id=' . $a['id'], null, $ck);
checar('painel novo: ficha da conta de antes (bônus, carreiras, conquistas)', $st === 200 && count($j['usuario']['bonus'] ?? []) === 1 && count($j['usuario']['carreiras'] ?? []) === 3
    && count($j['usuario']['conquistas'] ?? []) === 2 && ($j['usuario']['tipo'] ?? '') === 'jogador', "$st");
[$st, $j] = pedir('GET', '/api/equipe.php?r=saude', null, $ck);
checar('Saúde: nenhuma tabela, coluna ou índice faltando', $st === 200 && ($j['schema']['faltam'] ?? null) === [], "$st " . substr(json_encode($j['schema'] ?? null), 0, 300));
[$st, $j] = pedir('GET', '/api/admin.php?r=log', null, $ck);
$acoes = array_column($j['itens'] ?? [], 'acao');
checar('o registro de antes continua no Registro (ocultar, bônus, config, Hall)', $st === 200 && !array_diff(['ocultar_carreira', 'dar_bonus', 'config', 'atualizar_hall'], $acoes), implode(',', $acoes));
$log = is_file("$base/php-erros.log") ? trim((string) file_get_contents("$base/php-erros.log")) : '';
checar('log de erros do PHP vazio (antes e depois)', $log === '', substr($log, 0, 600));
echo "\n" . ($falhas ? "FALHOU: $falhas de $total" : "PASSOU: $total verificações") . "\n";
exit($falhas ? 1 : 0);

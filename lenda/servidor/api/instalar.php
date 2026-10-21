<?php
/**
 * LENDA · cria/atualiza as tabelas (roda _schema.sql). Só com Authorization: Bearer <token do administrador>.
 * Idempotente: CREATE TABLE IF NOT EXISTS e, em tabela que já existia, acrescenta a coluna ou o índice do
 * _schema.sql que faltar (nunca apaga nem muda o que já existe). Depois preenche o que a v3 trouxe para os
 * dados antigos: código de convite das contas e, das carreiras salvas antes, os clubes, as Copas, o bônus, o hash
 * do resumo e a plausibilidade (lidos do HallEntry guardado); a decisão de moderação das carreiras já escondidas
 * (carreiras_moderacao) e, na primeira vez, as partidas por aparelho (partidas_vid, a partir dos eventos). No fim, grava
 * site_config._esquema = 33 (v3.3): até lá, as rotas do jogo não usam as colunas e tabelas novas (subir os arquivos antes
 * de rodar isto não quebra o jogo; o painel responde 503 instalar nas telas novas).
 * v3.3 (CONTRATO-v33 §A): preenche carreiras.libertadores das carreiras antigas (do HallEntry guardado) e semeia os três
 * desafios (As Taças do Rei, só as Copas e todas as conquistas) DESATIVADOS e sem prêmio; semente que já existe (pelo
 * slug) nunca é mexida. O que preencheu vem em "v33": {libertadores, desafios}.
 * v3.4 (CONTRATO-v34 §A): preenche nas carreiras guardadas os números dos critérios novos (champions, clubes, temporadas no
 * mesmo clube, Copas pela seleção, a seleção da criação) e, na carreira-prova (Clássico, replay, semente do servidor), a lista
 * de conquistas do motor; refaz uma vez as provas de cada conta (o que dá para provar fica provado; o resto continua lá, não
 * provado: nada some); semeia uma vez os 10 desafios de emblema ATIVOS e dá os emblemas a quem já cumpre. O que fez vem em
 * "v34": {carreiras, desafios, contas, provas, emblemas}. Até ele rodar (_esquema 33), nada disso é usado.
 * Responde a lista de tabelas do banco e o que preencheu; se a resposta disser "faltam" > 0, rode de novo.
 *   curl -X POST -H "Authorization: Bearer $TOKEN" https://oprojeto.online/lenda/api/instalar.php
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';
require __DIR__ . '/_carreiras.php';
require __DIR__ . '/_desafios.php';

cabecalhos();

$m = metodo();
if ($m !== 'GET' && $m !== 'POST') {
    erroMetodo();
}
if (!tokenAdminValido()) {
    erro(401, 'nao_autorizado', 'Token de administrador ausente ou inválido.');
}

$sql = file_get_contents(__DIR__ . '/_schema.sql');
if (!is_string($sql) || $sql === '') {
    erro(500, 'schema', 'Arquivo de tabelas não encontrado.');
}
$sql = (string) preg_replace('/^\s*--.*$/m', '', $sql);
$comandos = array_values(array_filter(array_map('trim', explode(';', $sql)), static fn(string $c): bool => $c !== ''));

$pdo = bd();
$antes = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
$alteracoes = [];
foreach ($comandos as $c) {
    if (!preg_match('/^CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\((.*)\)[^)]*$/is', $c, $p)) {
        erro(500, 'schema', 'O arquivo de tabelas só pode ter CREATE TABLE IF NOT EXISTS.');
    }
    $tabela = $p[1];
    $pdo->exec($c);
    if (!in_array($tabela, $antes, true)) {
        continue;
    }
    // Tabela antiga: acrescenta o que faltar (uma definição por linha no _schema.sql).
    $colunas = array_map('strtolower', $pdo->query("SHOW COLUMNS FROM `$tabela`")->fetchAll(PDO::FETCH_COLUMN));
    $indices = array_map('strtolower', array_column($pdo->query("SHOW INDEX FROM `$tabela`")->fetchAll(), 'Key_name'));
    foreach (preg_split('/\R/', $p[2]) ?: [] as $linha) {
        $def = rtrim(trim($linha), ',');
        if ($def === '' || preg_match('/^PRIMARY\s+KEY/i', $def)) {
            continue;
        }
        if (preg_match('/^(UNIQUE\s+)?KEY\s+(\w+)\s*\(/i', $def, $k)) {
            if (!in_array(strtolower($k[2]), $indices, true)) {
                $pdo->exec("ALTER TABLE `$tabela` ADD $def");
                $alteracoes[] = "$tabela: índice {$k[2]}";
            }
        } elseif (preg_match('/^(\w+)\s+\w/', $def, $k) && !in_array(strtolower($k[1]), $colunas, true)) {
            $pdo->exec("ALTER TABLE `$tabela` ADD COLUMN $def");
            $alteracoes[] = "$tabela: coluna {$k[1]}";
        }
    }
}
$tabelas = array_values(array_map('strval', $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN)));
sort($tabelas);

// ── dados antigos (v2 → v3) ──────────────────────────────────────────────────────────────────────

$fim = microtime(true) + 20; // por pedido; o que faltar fica para a próxima vez
$convites = 0;
foreach (sql('SELECT id FROM usuarios WHERE codigo_convite IS NULL LIMIT 20000')->fetchAll(PDO::FETCH_COLUMN) as $uid) {
    garantirCodigoConvite((int) $uid, null);
    $convites++;
    if (microtime(true) > $fim) {
        break;
    }
}
$carreiras = 0;
while (microtime(true) < $fim) {
    $lote = sql('SELECT id, usuario_id, carreira_id, dados FROM carreiras WHERE clubes IS NULL ORDER BY id LIMIT 200')->fetchAll();
    if (!$lote) {
        break;
    }
    foreach ($lote as $l) {
        $json = is_string($l['dados']) ? @gzdecode($l['dados']) : false;
        $h = is_string($json) ? json_decode($json, false, 512) : null;
        if (!($h instanceof stdClass)) {
            sql("UPDATE carreiras SET clubes = '[]', suspeita = 'dados' WHERE id = ?", [(int) $l['id']]); // não abre: fora do Hall
        } else {
            $f = extrairCampos($h);
            sql('UPDATE carreiras SET clubes = ?, copas = ?, bonus_ovr = ?, resumo_hash = ?, suspeita = ? WHERE id = ?',
                [$f['clubes'], $f['copas'], $f['bonus_ovr'], $f['resumo_hash'],
                    plausibilidade($f, (int) $l['usuario_id'], (string) $l['carreira_id'], (int) $l['id']), (int) $l['id']]);
        }
        $carreiras++;
    }
}
// v3.1: o hash do resumo das carreiras da v3 (a cópia com outro id e a moderação usam)
$resumos = 0;
while (microtime(true) < $fim) {
    $lote = sql('SELECT id, dados FROM carreiras WHERE resumo_hash IS NULL AND clubes IS NOT NULL ORDER BY id LIMIT 200')->fetchAll();
    if (!$lote) {
        break;
    }
    foreach ($lote as $l) {
        $json = is_string($l['dados']) ? @gzdecode($l['dados']) : false;
        $h = is_string($json) ? json_decode($json, false, 512) : null;
        $hash = $h instanceof stdClass ? extrairCampos($h)['resumo_hash'] : null;
        sql('UPDATE carreiras SET resumo_hash = ? WHERE id = ?', [$hash ?? '', (int) $l['id']]);
        $resumos++;
    }
}
// rev3: o hash do resumo das carreiras que já estavam na lixeira, tirado da linha guardada (a mesma carreira salva por
// outra conta vira "cópia"); sem hash, '' (não fica voltando aqui). Conta junto com os resumos.
if (in_array('lixeira_carreiras', $tabelas, true)) {
    while (microtime(true) < $fim) {
        $lote = sql('SELECT id, linha FROM lixeira_carreiras WHERE resumo_hash IS NULL ORDER BY id LIMIT 500')->fetchAll();
        if (!$lote) {
            break;
        }
        foreach ($lote as $l) {
            $d = is_string($l['linha']) ? json_decode($l['linha'], true) : null;
            $hash = is_array($d) && is_string($d['resumo_hash'] ?? null) && preg_match('/^[0-9a-f]{40}$/', $d['resumo_hash']) ? $d['resumo_hash'] : '';
            sql('UPDATE lixeira_carreiras SET resumo_hash = ? WHERE id = ?', [$hash, (int) $l['id']]);
            $resumos++;
        }
    }
}
// v3.1: as carreiras já escondidas (admin ou denúncias) guardam a decisão fora da linha (sobrevive ao "apagar")
$moderacao = sql('INSERT IGNORE INTO carreiras_moderacao (usuario_id, carreira_id, resumo_hash, oculta, em)
    SELECT usuario_id, carreira_id, resumo_hash, oculta, UTC_TIMESTAMP() FROM carreiras WHERE oculta > 0')->rowCount();
// v3.1: partidas por aparelho (o funil "5 partidas" do painel), a partir dos eventos, uma vez só (tabela nova)
$partidasVid = 0;
if (!in_array('partidas_vid', $antes, true)) {
    $partidasVid = sql("INSERT INTO partidas_vid (vid, n, atualizado_em)
        SELECT e.vid, COUNT(*), UTC_TIMESTAMP() FROM eventos e
        WHERE e.tipo IN ('jogo_fim', 'partida_fim') AND (e.tipo = 'partida_fim' OR e.modo IN ('classico', 'imersivo'))
        GROUP BY e.vid
        ON DUPLICATE KEY UPDATE n = GREATEST(n, VALUES(n))")->rowCount();
}
// v3.3: as Libertadores das carreiras antigas (as novas já entram com elas), lidas do HallEntry guardado; sem dados, 0
$libertadores = 0;
while (microtime(true) < $fim) {
    $lote = sql('SELECT id, dados FROM carreiras WHERE libertadores IS NULL ORDER BY id LIMIT 200')->fetchAll();
    if (!$lote) {
        break;
    }
    foreach ($lote as $l) {
        $json = is_string($l['dados']) ? @gzdecode($l['dados']) : false;
        $h = is_string($json) ? json_decode($json, false, 512) : null;
        sql('UPDATE carreiras SET libertadores = ? WHERE id = ?', [$h instanceof stdClass ? extrairCampos($h)['libertadores'] : 0, (int) $l['id']]);
        $libertadores++;
    }
}
// v3.3: os desafios de fábrica, desativados e sem prêmio (o admin escreve o prêmio e ativa no painel)
$desafios = semearDesafios();
// v3.3: o banco tem tudo do _schema.sql; as rotas passam a usar as colunas e tabelas novas (esquemaV32/V33() no _lib.php)
gravarSiteConfig('_esquema', LENDA_ESQUEMA, 'instalar');
esquecerSiteConfig();

// ── v3.4: critérios novos, conquistas provadas e desafios de emblema ─────────────────────────────

$v34 = ['carreiras' => 0, 'desafios' => 0, 'contas' => 0, 'provas' => 0, 'emblemas' => 0];
// os números dos critérios novos das carreiras guardadas (lidos do HallEntry) e a lista de conquistas da carreira-prova
while (microtime(true) < $fim) {
    $lote = sql('SELECT id, dados FROM carreiras WHERE champions IS NULL ORDER BY id LIMIT 200')->fetchAll();
    if (!$lote) {
        break;
    }
    foreach ($lote as $l) {
        $json = is_string($l['dados']) ? @gzdecode($l['dados']) : false;
        $h = is_string($json) ? json_decode($json, false, 512) : null;
        $f = $h instanceof stdClass ? extrairCampos($h) : ['champions' => 0, 'n_clubes' => 0, 'mesmo_clube' => 0, 'copas_selecao' => 0, 'pais_inicio' => null,
            'conquistas' => [], 'conquistas_v' => 1];
        sql("UPDATE carreiras SET champions = ?, n_clubes = ?, mesmo_clube = ?, copas_selecao = ?, pais_inicio = ?,
            conquistas = IF(tem_replay = 1 AND modo = 'classico' AND semente_em IS NOT NULL, ?, NULL),
            conquistas_v = IF(tem_replay = 1 AND modo = 'classico' AND semente_em IS NOT NULL, ?, NULL) WHERE id = ?",
            [$f['champions'], $f['n_clubes'], $f['mesmo_clube'], $f['copas_selecao'], $f['pais_inicio'], json($f['conquistas']), $f['conquistas_v'], (int) $l['id']]);
        $v34['carreiras']++;
    }
}
$semColunas = (int) umValor('SELECT COUNT(*) FROM carreiras WHERE champions IS NULL');
// os desafios de emblema de fábrica, ativos, uma vez só
$v34['desafios'] = semearEmblemas();
// as provas de cada conta, uma vez (depois, salvar, apagar e a moderação mantêm): retoma de onde parou se o tempo acabar
$rec = lerEstado('_v34_recalculo') ?? ['ultimo' => 0, 'feito' => false];
if (($rec['feito'] ?? false) !== true && $semColunas === 0) {
    $ultimo = (int) ($rec['ultimo'] ?? 0);
    $acabou = true;
    foreach (sql('SELECT DISTINCT usuario_id FROM carreiras WHERE conquistas IS NOT NULL AND usuario_id > ? ORDER BY usuario_id LIMIT 20000', [$ultimo])
        ->fetchAll(PDO::FETCH_COLUMN) as $uid) {
        if (microtime(true) > $fim) {
            $acabou = false;
            break;
        }
        $r = recalcularProvas((int) $uid);
        $v34['contas']++;
        $v34['provas'] += $r['mudou'];
        $ultimo = (int) $uid;
    }
    $rec = ['ultimo' => $ultimo, 'feito' => $acabou, 'em' => gmdate('Y-m-d\TH:i:s\Z')];
    gravarSiteConfig('_v34_recalculo', $rec, 'instalar');
}
// os emblemas de quem já cumpre (o lote de cada desafio de emblema valendo), uma vez, depois das provas
$lot = lerEstado('_v34_emblemas_lote');
if ($lot === null && ($rec['feito'] ?? false) === true) {
    $acabou = true;
    foreach (desafiosValendo(true) as $d) {
        if (microtime(true) > $fim) {
            $acabou = false;
            break;
        }
        if (eEmblema($d)) {
            $v34['emblemas'] += avaliarDesafioTodos($d);
        }
    }
    if ($acabou) {
        gravarSiteConfig('_v34_emblemas_lote', ['em' => gmdate('Y-m-d\TH:i:s\Z'), 'emblemas' => $v34['emblemas']], 'instalar');
    }
}

$faltam = (int) umValor('SELECT COUNT(*) FROM carreiras WHERE clubes IS NULL OR resumo_hash IS NULL OR libertadores IS NULL OR champions IS NULL')
    + (int) umValor('SELECT COUNT(*) FROM usuarios WHERE codigo_convite IS NULL')
    + (($rec['feito'] ?? false) === true ? 0 : 1) + (lerEstado('_v34_emblemas_lote') !== null ? 0 : 1);
responder(200, ['ok' => true, 'comandos' => count($comandos), 'alteracoes' => $alteracoes, 'tabelas' => $tabelas,
    'preenchidas' => ['convites' => $convites, 'carreiras' => $carreiras, 'resumos' => $resumos, 'moderacao' => $moderacao,
        'partidasVid' => $partidasVid, 'faltam' => $faltam],
    'v33' => ['libertadores' => $libertadores, 'desafios' => $desafios], 'v34' => $v34]);

<?php
/**
 * LENDA · cria/atualiza as tabelas (roda _schema.sql). Só com Authorization: Bearer <token do administrador>.
 * Idempotente: CREATE TABLE IF NOT EXISTS e, em tabela que já existia, acrescenta a coluna ou o índice do
 * _schema.sql que faltar (nunca apaga nem muda o que já existe). Depois preenche o que a v3 trouxe para os
 * dados antigos: código de convite das contas e, das carreiras salvas antes, os clubes, as Copas, o bônus e a
 * plausibilidade (lidos do HallEntry guardado). Responde a lista de tabelas do banco e o que preencheu; se a
 * resposta disser "faltam" > 0, rode de novo.
 *   curl -X POST -H "Authorization: Bearer $TOKEN" https://oprojeto.online/lenda/api/instalar.php
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';
require __DIR__ . '/_carreiras.php';

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
            sql('UPDATE carreiras SET clubes = ?, copas = ?, bonus_ovr = ?, suspeita = ? WHERE id = ?',
                [$f['clubes'], $f['copas'], $f['bonus_ovr'], plausibilidade($f, (int) $l['usuario_id'], (string) $l['carreira_id']), (int) $l['id']]);
        }
        $carreiras++;
    }
}
$faltam = (int) umValor('SELECT COUNT(*) FROM carreiras WHERE clubes IS NULL') + (int) umValor('SELECT COUNT(*) FROM usuarios WHERE codigo_convite IS NULL');
responder(200, ['ok' => true, 'comandos' => count($comandos), 'alteracoes' => $alteracoes, 'tabelas' => $tabelas,
    'preenchidas' => ['convites' => $convites, 'carreiras' => $carreiras, 'faltam' => $faltam]]);

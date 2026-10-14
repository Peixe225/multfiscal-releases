<?php
/**
 * LENDA · cria/atualiza as tabelas (roda _schema.sql). Só com Authorization: Bearer <token do administrador>.
 * Idempotente: CREATE TABLE IF NOT EXISTS e, em tabela que já existia, acrescenta a coluna ou o índice do
 * _schema.sql que faltar (nunca apaga nem muda o que já existe). Responde a lista de tabelas do banco.
 *   curl -X POST -H "Authorization: Bearer $TOKEN" https://oprojeto.online/lenda/api/instalar.php
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';

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
responder(200, ['ok' => true, 'comandos' => count($comandos), 'alteracoes' => $alteracoes, 'tabelas' => $tabelas]);

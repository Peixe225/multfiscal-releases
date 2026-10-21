<?php
/**
 * LENDA · conquistas provadas (CONTRATO-v34 §A). Uma carreira é PROVA quando é do Clássico, tem replay, começou com uma
 * semente que o servidor sorteou para a conta (semente_em), não foi salva num dia acima do limite (fora_desafio), não está
 * suspeita (a revisão da nota alta vale) e não "não bateu" na verificação por replay (prova_ok = 0). Dela o servidor guarda a
 * lista de conquistas que o motor gravou (HallEntry.career.achievements → carreiras.conquistas, só os 87 ids do jogo).
 * Provadas da conta = a união das carreiras-prova; o resto que veio do aparelho continua lá como "não provada" (nada some).
 * conquistas_usuario.prova_pk aponta a carreira que prova (a verificada, senão a que entrou primeiro na conta).
 * A verificação (o admin refaz a carreira no jogo, #/verificar, que agora compara também a lista) grava prova_ok; com as 87
 * provadas por carreiras verificadas, o desafio de todas as conquistas pode ter vencedor.
 * Usado por _desafios.php (e por ele, por todas as rotas que avaliam desafios), carreiras.php, conquistas.php, admin.php e
 * instalar.php. Nunca é servido (o .htaccess nega _*.php).
 */
declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

const PROVA_LOTE_MAX = 50;          // carreiras por prova_verificar
const PROVA_DATA_MINIMA = 1735689600; // 2025-01-01 (como no conquistas.php)
/** §E: a versão do conteúdo da carreira (meta.versao do ?r=carreira, o `versao` do prova_verificar): sha1 do HallEntry guardado. */
const PROVA_VERSAO_RE = '/^[0-9a-f]{40}$/';

/** §E: a versão do conteúdo guardado (o JSON do HallEntry): muda a cada salvar com outro conteúdo. */
function versaoConteudo(string $json): string
{
    return sha1($json);
}

/**
 * §E: guarda (verificação = o JSON do "não bateu") ou tira (null = bateu) o "não bateu" da semente da conta. Banco sem a
 * tabela (o instalar desta versão não rodou): não guarda, como antes.
 */
function guardarNaoBateu(int $uid, string $semente, string $carreiraId, ?string $verificacao): void
{
    try {
        if ($verificacao === null) {
            sql('DELETE FROM provas_nao_bateu WHERE usuario_id = ? AND semente = ?', [$uid, $semente]);
            return;
        }
        sql('INSERT INTO provas_nao_bateu (usuario_id, semente, carreira_id, em, verificacao) VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE carreira_id = VALUES(carreira_id), em = VALUES(em), verificacao = VALUES(verificacao)',
            [$uid, $semente, mb_substr($carreiraId, 0, 64, 'UTF-8'), dt(time()), $verificacao]);
    } catch (PDOException $e) {
        if (!eFaltaDeSchema($e)) {
            throw $e;
        }
    }
}

/**
 * §E: o "não bateu" guardado para a semente da carreira (o JSON da verificação do admin), ou null. A carreira salva com essa
 * semente (a mesma de novo, outra com o mesmo replay ou outro id, ou depois de apagar) nasce "não bateu" (prova_ok = 0).
 */
function naoBateuDaSemente(int $uid, ?string $semente): ?string
{
    if ($semente === null || !esquemaV34()) {
        return null;
    }
    try {
        $l = umaLinha('SELECT verificacao FROM provas_nao_bateu WHERE usuario_id = ? AND semente = ?', [$uid, $semente]);
    } catch (PDOException $e) {
        if (!eFaltaDeSchema($e)) {
            throw $e;
        }
        return null;
    }
    if ($l === null) {
        return null;
    }
    return is_string($l['verificacao']) && $l['verificacao'] !== '' ? $l['verificacao']
        : json(['ok' => false, 'detalhes' => null, 'motivo' => 'Não bateu na verificação por replay.', 'em' => null, 'quem' => null]);
}

/** Condição SQL (apelido $a de carreiras) da carreira que vale como prova (sem olhar a lista). */
function sqlCarreiraProva(string $a = 'c'): string
{
    return "$a.modo = 'classico' AND $a.tem_replay = 1 AND $a.semente_em IS NOT NULL AND $a.fora_desafio IS NULL
        AND ($a.suspeita IS NULL OR $a.suspeita = 'revisao') AND ($a.prova_ok IS NULL OR $a.prova_ok = 1)";
}

/**
 * Por que a carreira (linha com modo, tem_replay, semente_em, fora_desafio, suspeita e, se houver, prova_ok) não vale como
 * prova, ou null. Os motivos são os de DESAFIO_MOTIVOS (o jogo mostra a frase).
 */
function motivoProva(array $c): ?string
{
    if (($c['modo'] ?? 'classico') !== 'classico') {
        return 'imersivo';
    }
    if ((int) ($c['tem_replay'] ?? 0) !== 1) {
        return 'sem_replay';
    }
    if (($c['semente_em'] ?? null) === null) {
        return 'sem_semente';
    }
    if (($c['fora_desafio'] ?? null) !== null) {
        return 'limite_diario';
    }
    $s = $c['suspeita'] ?? null;
    if ($s !== null && $s !== 'revisao') {
        return 'suspeita';
    }
    if (array_key_exists('prova_ok', $c) && $c['prova_ok'] !== null && (int) $c['prova_ok'] === 0) {
        return 'nao_bateu';
    }
    return null;
}

/** A lista guardada (JSON) → ids das 87, sem repetir; estragada = []. */
function listaConquistas(mixed $json): array
{
    $l = is_string($json) ? json_decode($json, true) : null;
    if (!is_array($l)) {
        return [];
    }
    $validas = array_flip(CONQUISTAS_IDS);
    $out = [];
    foreach ($l as $id) {
        if (is_string($id) && isset($validas[$id]) && !in_array($id, $out, true)) {
            $out[] = $id;
        }
    }
    return $out;
}

/**
 * As carreiras-prova da conta, a que entrou primeiro antes: [{id, carreira_id, jogador, primeira_em, salva_em, terminou_em,
 * prova_ok, lista}].
 */
function carreirasProva(int $uid): array
{
    $out = [];
    foreach (sql('SELECT c.id, c.carreira_id, c.jogador, c.primeira_em, c.salva_em, c.terminou_em, c.prova_ok, c.conquistas FROM carreiras c
        WHERE c.usuario_id = ? AND c.conquistas IS NOT NULL AND ' . sqlCarreiraProva() . ' ORDER BY COALESCE(c.primeira_em, c.salva_em), c.id LIMIT 500',
        [$uid])->fetchAll() as $c) {
        $c['lista'] = listaConquistas($c['conquistas']);
        unset($c['conquistas']);
        $out[] = $c;
    }
    return $out;
}

/**
 * Para cada conquista provada: a carreira que prova (a verificada, senão a que entrou primeiro), se está verificada, quando a
 * primeira prova entrou na conta e quando ela foi conseguida (o fim da carreira). @return array<string, array>
 */
function mapaProvas(array $carreiras): array
{
    $mapa = [];
    foreach ($carreiras as $c) {
        $ok = $c['prova_ok'] !== null && (int) $c['prova_ok'] === 1;
        foreach ($c['lista'] as $id) {
            if (!isset($mapa[$id])) {
                $mapa[$id] = ['pk' => (int) $c['id'], 'verificada' => $ok, 'provadaEm' => (string) ($c['primeira_em'] ?? $c['salva_em']),
                    'em' => (string) ($c['terminou_em'] ?? $c['primeira_em'] ?? $c['salva_em'])];
            } elseif (!$mapa[$id]['verificada'] && $ok) {
                $mapa[$id]['pk'] = (int) $c['id'];
                $mapa[$id]['verificada'] = true;
            }
        }
    }
    return $mapa;
}

/**
 * Refaz as provas da conta em conquistas_usuario (prova_pk, provada_em; a provada que o aparelho nunca mandou entra com origem
 * carreira). Nada é apagado: a conquista que perde a prova fica, sem prova. Chamada quando uma carreira da conta muda
 * (salvar, apagar, moderação, verificação) e pelo instalar. Devolve ['novas' => ids que passaram a ter prova, 'perdidas' =>
 * ids que perderam, 'mudou' => linhas mexidas].
 */
function recalcularProvas(int $uid): array
{
    if (!esquemaV34()) {
        return ['novas' => [], 'perdidas' => [], 'mudou' => 0];
    }
    $mapa = mapaProvas(carreirasProva($uid));
    return transacao(static function () use ($uid, $mapa): array {
        sql('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', [$uid]); // como o sincronizar: uma escrita por conta de cada vez
        $tem = [];
        foreach (sql('SELECT conquista_id, prova_pk, provada_em FROM conquistas_usuario WHERE usuario_id = ?', [$uid])->fetchAll() as $l) {
            $tem[(string) $l['conquista_id']] = $l;
        }
        $novas = [];
        $perdidas = [];
        $mudou = 0;
        foreach ($tem as $id => $l) {
            if ($l['prova_pk'] !== null && !isset($mapa[$id])) {
                $mudou += sql('UPDATE conquistas_usuario SET prova_pk = NULL, provada_em = NULL WHERE usuario_id = ? AND conquista_id = ?', [$uid, $id])->rowCount();
                $perdidas[] = $id;
            }
        }
        $agora = time();
        foreach ($mapa as $id => $p) {
            $l = $tem[$id] ?? null;
            if ($l === null) {
                $t = paraTempo(substr($p['em'], 0, 19)) ?? $agora;
                $mudou += sql("INSERT INTO conquistas_usuario (usuario_id, conquista_id, em, prova_pk, provada_em, origem) VALUES (?, ?, ?, ?, ?, 'carreira')
                    ON DUPLICATE KEY UPDATE prova_pk = VALUES(prova_pk), provada_em = VALUES(provada_em)",
                    [$uid, $id, dt(max(PROVA_DATA_MINIMA, min($agora, $t))), $p['pk'], substr($p['provadaEm'], 0, 19)])->rowCount() > 0 ? 1 : 0;
                $novas[] = $id;
                continue;
            }
            if ($l['prova_pk'] === null) {
                $novas[] = $id;
            }
            if ($l['prova_pk'] === null || (int) $l['prova_pk'] !== $p['pk'] || (string) $l['provada_em'] !== substr($p['provadaEm'], 0, 19)) {
                $mudou += sql('UPDATE conquistas_usuario SET prova_pk = ?, provada_em = ? WHERE usuario_id = ? AND conquista_id = ?',
                    [$p['pk'], substr($p['provadaEm'], 0, 19), $uid, $id])->rowCount();
            }
        }
        return ['novas' => $novas, 'perdidas' => $perdidas, 'mudou' => $mudou];
    });
}

/** {provadas, verificadas, naoProvadas, total: 87} da conta (só as 87 do jogo contam). */
function resumoProvas(int $uid): array
{
    if (!esquemaV34()) {
        return ['provadas' => 0, 'verificadas' => 0, 'naoProvadas' => conquistasValidas($uid), 'total' => CONQUISTAS_TOTAL];
    }
    $l = umaLinha('SELECT COUNT(*) AS n, COALESCE(SUM(cu.prova_pk IS NOT NULL), 0) AS p, COALESCE(SUM(c.prova_ok = 1), 0) AS v
        FROM conquistas_usuario cu LEFT JOIN carreiras c ON c.id = cu.prova_pk
        WHERE cu.usuario_id = ? AND cu.conquista_id IN (' . marcas(CONQUISTAS_TOTAL) . ')', array_merge([$uid], CONQUISTAS_IDS)) ?? ['n' => 0, 'p' => 0, 'v' => 0];
    return ['provadas' => (int) $l['p'], 'verificadas' => (int) $l['v'], 'naoProvadas' => (int) $l['n'] - (int) $l['p'], 'total' => CONQUISTAS_TOTAL];
}

/** Quantas das 87 a conta tem provadas ($verificadas: provadas por carreira verificada no replay). */
function conquistasProvadas(int $uid, bool $verificadas = false): int
{
    $r = resumoProvas($uid);
    return $verificadas ? $r['verificadas'] : $r['provadas'];
}

/** Das 87: as que a conta não tem provadas e as que não têm prova verificada (para o 409 sem_prova e o ?r=provas). */
function faltasProvas(int $uid): array
{
    $prov = [];
    $verif = [];
    if (esquemaV34()) {
        foreach (sql('SELECT cu.conquista_id, c.prova_ok FROM conquistas_usuario cu JOIN carreiras c ON c.id = cu.prova_pk WHERE cu.usuario_id = ?', [$uid]) as $l) {
            $prov[(string) $l['conquista_id']] = true;
            if ((int) $l['prova_ok'] === 1) {
                $verif[(string) $l['conquista_id']] = true;
            }
        }
    }
    return ['faltamProvar' => array_values(array_filter(CONQUISTAS_IDS, static fn(string $id): bool => !isset($prov[$id]))),
        'faltamVerificar' => array_values(array_filter(CONQUISTAS_IDS, static fn(string $id): bool => !isset($verif[$id])))];
}

/**
 * A hora em que a conta passou a ter as 87 provadas (a maior das horas em que a primeira prova de cada uma entrou), ou null
 * se ainda não tem. É o `em` real do candidato ao desafio de todas as conquistas no lote (ativar com contas que já cumpriam).
 */
function emTodasProvadas(int $uid): ?string
{
    $l = umaLinha('SELECT COUNT(*) AS n, MAX(provada_em) AS t FROM conquistas_usuario WHERE usuario_id = ? AND prova_pk IS NOT NULL
        AND conquista_id IN (' . marcas(CONQUISTAS_TOTAL) . ')', array_merge([$uid], CONQUISTAS_IDS));
    return $l !== null && (int) $l['n'] >= CONQUISTAS_TOTAL && $l['t'] !== null ? (string) $l['t'] : null;
}

/** As conquistas da conta para o jogo (conquistas.php): [{id, em, provada, verificada, carreira: HallEntry.id | null}]. */
function conquistasComProva(int $uid): array
{
    if (!esquemaV34()) {
        return array_map(static fn(array $l): array => ['id' => (string) $l['conquista_id'], 'em' => iso($l['em'])],
            sql('SELECT conquista_id, em FROM conquistas_usuario WHERE usuario_id = ? ORDER BY em, conquista_id', [$uid])->fetchAll());
    }
    return array_map(static fn(array $l): array => ['id' => (string) $l['conquista_id'], 'em' => iso($l['em']), 'provada' => $l['prova_pk'] !== null,
        'verificada' => $l['prova_pk'] !== null && (int) ($l['prova_ok'] ?? 0) === 1, 'carreira' => $l['prova_pk'] !== null ? $l['carreira_id'] : null],
        sql('SELECT cu.conquista_id, cu.em, cu.prova_pk, c.carreira_id, c.prova_ok FROM conquistas_usuario cu LEFT JOIN carreiras c ON c.id = cu.prova_pk
            WHERE cu.usuario_id = ? ORDER BY cu.em, cu.conquista_id', [$uid])->fetchAll());
}

/**
 * Para a lista de carreiras da conta (C.prova): pk → {conquistas, unicas, verificada: true | null} das carreiras-prova
 * (unicas = quantas da conta só ela prova: apagar a carreira tira a prova delas).
 */
function provasPorCarreira(int $uid): array
{
    if (!esquemaV34()) {
        return [];
    }
    $cs = carreirasProva($uid);
    $quantas = [];
    foreach ($cs as $c) {
        foreach ($c['lista'] as $id) {
            $quantas[$id] = ($quantas[$id] ?? 0) + 1;
        }
    }
    $out = [];
    foreach ($cs as $c) {
        $out[(int) $c['id']] = ['conquistas' => count($c['lista']), 'unicas' => count(array_filter($c['lista'], static fn(string $id): bool => $quantas[$id] === 1)),
            'verificada' => $c['prova_ok'] !== null && (int) $c['prova_ok'] === 1 ? true : null];
    }
    return $out;
}

/**
 * Um conjunto pequeno de carreiras que cobre todas as conquistas provadas (guloso: a que cobre mais das que faltam, a
 * verificada e a mais antiga no empate). O lote do #/verificar pode refazer só essas. pk => lista → [pk].
 */
function coberturaProvas(array $listas, array $verificadas = []): array
{
    $falta = [];
    foreach ($listas as $l) {
        foreach ($l as $id) {
            $falta[$id] = true;
        }
    }
    $escolhidas = [];
    while ($falta) {
        $melhor = null;
        $mais = 0;
        foreach ($listas as $pk => $l) {
            if (in_array($pk, $escolhidas, true)) {
                continue;
            }
            $n = count(array_filter($l, static fn(string $id): bool => isset($falta[$id])));
            if ($n > $mais || ($n === $mais && $n > 0 && isset($verificadas[$pk]) && !isset($verificadas[$melhor]))) {
                $melhor = $pk;
                $mais = $n;
            }
        }
        if ($melhor === null || $mais === 0) {
            break;
        }
        $escolhidas[] = $melhor;
        foreach ($listas[$melhor] as $id) {
            unset($falta[$id]);
        }
    }
    return $escolhidas;
}

/** GET admin.php?r=provas&usuario=<id>: as carreiras-prova da conta, o que cada uma prova e o que falta (para o lote). */
function rotaGetProvas(): never
{
    if (!esquemaV34()) {
        erroInstalar();
    }
    $uid = lerIdNumero($_GET['usuario'] ?? ($_GET['id'] ?? null), 'Conta');
    $u = usuarioOu404($uid);
    $linhas = sql('SELECT c.id, c.carreira_id, c.jogador, c.modo, c.tem_replay, c.semente_em, c.fora_desafio, c.suspeita, c.prova_ok, c.prova_verificacao,
            c.primeira_em, c.salva_em, c.conquistas, c.conquistas_v FROM carreiras c
        WHERE c.usuario_id = ? AND c.conquistas IS NOT NULL ORDER BY COALESCE(c.primeira_em, c.salva_em), c.id LIMIT 500', [$uid])->fetchAll();
    $validas = [];
    $verificadas = [];
    foreach ($linhas as $l) {
        if (motivoProva($l) === null) {
            $validas[(int) $l['id']] = listaConquistas($l['conquistas']);
            if ((int) ($l['prova_ok'] ?? 0) === 1) {
                $verificadas[(int) $l['id']] = true;
            }
        }
    }
    $quantas = [];
    foreach ($validas as $lista) {
        foreach ($lista as $id) {
            $quantas[$id] = ($quantas[$id] ?? 0) + 1;
        }
    }
    $essenciais = array_flip(coberturaProvas($validas, $verificadas));
    $itens = [];
    foreach ($linhas as $l) {
        $pk = (int) $l['id'];
        $lista = listaConquistas($l['conquistas']);
        $motivo = motivoProva($l);
        $v = is_string($l['prova_verificacao'] ?? null) ? json_decode((string) $l['prova_verificacao'], true) : null;
        $itens[] = ['pk' => $pk, 'carreiraId' => (string) $l['carreira_id'], 'jogador' => (string) $l['jogador'], 'primeiraEm' => iso($l['primeira_em'] ?? $l['salva_em']),
            'conquistas' => $lista, 'conquistasV' => $l['conquistas_v'] !== null ? (int) $l['conquistas_v'] : null, 'unicas' => $motivo === null ? array_values(array_filter($lista, static fn(string $id): bool => ($quantas[$id] ?? 0) === 1)) : [],
            'essencial' => isset($essenciais[$pk]), 'vale' => $motivo === null, 'motivo' => $motivo,
            'motivoTexto' => $motivo !== null ? (DESAFIO_MOTIVOS[$motivo] ?? null) : null,
            'provaOk' => $l['prova_ok'] === null ? null : (int) $l['prova_ok'] === 1, 'verificacao' => is_array($v) ? $v : null,
            'links' => ['resumo' => LENDA_CAMINHO_COOKIE . '#/resumo?id=' . $pk . '&de=admin', 'verificar' => LENDA_CAMINHO_COOKIE . '#/verificar?id=' . $pk . '&prova=1']];
    }
    responder(200, ['usuario' => ['id' => $uid, 'apelido' => (string) $u['apelido'], 'status' => contaSuspensa($u) ? 'suspenso' : 'ativo'],
        'conquistas' => resumoProvas($uid) + faltasProvas($uid), 'carreiras' => $itens,
        'links' => ['lote' => LENDA_CAMINHO_COOKIE . '#/verificar?conta=' . $uid]]);
}

/**
 * POST admin.php {acao: "prova_verificar", resultados: [{carreira, ok, detalhes?, versao?}]}: grava a verificação de cada
 * carreira-prova (prova_ok e prova_verificacao). ok = false tira a carreira das provas e os emblemas que ela deu (passam para
 * outra carreira-prova da conta que cumpra, ou saem pelo sistema). Depois refaz as provas das contas e, com as 87
 * verificadas, o candidato pendente ao desafio de todas as conquistas vira verificado.
 * §E: `versao` = a meta.versao do ?r=carreira que o admin refez; se o dono salvou outro conteúdo depois, a carreira vai para
 * `pulados` com o motivo `mudou` e nada é gravado (o jogo manda sempre; sem ela, vale o conteúdo de agora, como antes). O "não
 * bateu" fica guardado pela semente da carreira (provas_nao_bateu); o "bateu" da mesma semente tira de lá.
 */
function acaoProvaVerificar(array $j): never
{
    if (!esquemaV34()) {
        erroInstalar();
    }
    $res = $j['resultados'] ?? null;
    if (!is_array($res) || $res === [] || !array_is_list($res) || count($res) > PROVA_LOTE_MAX) {
        erro(400, 'resultados', 'Mande os resultados: [{"carreira": id, "ok": sim ou não, "detalhes": {…}}] (de 1 a ' . PROVA_LOTE_MAX . ').');
    }
    $lidos = [];
    foreach ($res as $x) {
        $pk = is_array($x) ? inteiroOuNulo(is_string($x['carreira'] ?? null) && ctype_digit($x['carreira']) ? (int) $x['carreira'] : ($x['carreira'] ?? null), 1, 4294967295) : null;
        $det = is_array($x) ? ($x['detalhes'] ?? null) : null;
        $versao = is_array($x) ? ($x['versao'] ?? null) : null;
        if ($pk === null || !is_bool($x['ok'] ?? null) || ($det !== null && (!is_array($det) || strlen(json($det)) > DESAFIO_VERIFICACAO_MAX))
            || ($versao !== null && (!is_string($versao) || !preg_match(PROVA_VERSAO_RE, $versao)))) {
            erro(400, 'resultados', 'Cada resultado: {"carreira": id, "ok": sim ou não, "detalhes": objeto de até 8 KB, "versao": a meta.versao do ?r=carreira}.');
        }
        $lidos[$pk] = ['ok' => $x['ok'], 'detalhes' => $det, 'versao' => $versao];
    }
    $quem = admQuem();
    $feitos = [];
    $pulados = [];
    $contas = [];
    foreach ($lidos as $pk => $x) {
        // §E: lê, confere e grava com a linha da carreira travada (o salvar do dono espera): o resultado vale para o conteúdo
        // que o admin refez (a `versao` do ?r=carreira), nunca para um que o dono salvou depois
        $r = transacao(static function () use ($pk, $x, $quem): array {
            $c = umaLinha('SELECT id, usuario_id, carreira_id, conquistas, tem_replay, dados FROM carreiras WHERE id = ? FOR UPDATE', [$pk]);
            if ($c === null) {
                return ['pulado' => 'nao_encontrada'];
            }
            if ($c['conquistas'] === null || (int) $c['tem_replay'] !== 1) {
                return ['pulado' => 'sem_prova'];
            }
            $json = is_string($c['dados']) ? @gzdecode($c['dados']) : false;
            $json = is_string($json) ? $json : '';
            if ($x['versao'] !== null && !hash_equals(versaoConteudo($json), $x['versao'])) {
                return ['pulado' => 'mudou'];
            }
            $motivo = $x['ok'] ? null : (texto(is_array($x['detalhes']) ? ($x['detalhes']['motivo'] ?? null) : null, 200) ?? 'Não bateu na verificação por replay.');
            $verif = json(['ok' => $x['ok'], 'detalhes' => $x['detalhes'], 'motivo' => $motivo, 'em' => gmdate('Y-m-d\TH:i:s\Z'), 'quem' => $quem]);
            sql('UPDATE carreiras SET prova_ok = ?, prova_verificacao = ? WHERE id = ?', [$x['ok'] ? 1 : 0, $verif, $pk]);
            // §E: o "não bateu" fica guardado pela semente (salvar de novo, com outro id ou depois de apagar não desfaz); o "bateu"
            // da mesma semente libera
            $h = $json !== '' ? json_decode($json, false, 512) : null;
            $semente = $h instanceof stdClass ? sementeDoReplay($h) : null;
            if ($semente !== null) {
                guardarNaoBateu((int) $c['usuario_id'], $semente, (string) $c['carreira_id'], $x['ok'] ? null : $verif);
            }
            return ['uid' => (int) $c['usuario_id'], 'motivo' => $motivo];
        });
        if (isset($r['pulado'])) {
            $pulados[] = ['carreira' => $pk, 'motivo' => $r['pulado']];
            continue;
        }
        if (!$x['ok']) {
            retirarEmblemasDaCarreira($pk, (string) $r['motivo']);
        }
        $contas[$r['uid']] = true;
        $feitos[] = ['pk' => $pk, 'provaOk' => $x['ok']];
    }
    $resumo = [];
    foreach (array_keys($contas) as $uid) {
        recalcularProvas($uid);
        avaliarDesafiosConta($uid);
        promoverCandidatosConquistas($uid, $quem);
        $r = resumoProvas($uid);
        $resumo[(string) $uid] = ['provadas' => $r['provadas'], 'verificadas' => $r['verificadas'], 'total' => $r['total']];
    }
    $alvo = count($contas) === 1 ? 'usuario:' . array_key_first($contas) : 'provas';
    registrarAdmin('prova_verificar', $alvo, ['usuario' => count($contas) === 1 ? array_key_first($contas) : null,
        'carreiras' => array_column($feitos, 'pk'), 'ok' => count(array_filter($feitos, static fn(array $f): bool => $f['provaOk'])),
        'naoBateu' => count(array_filter($feitos, static fn(array $f): bool => !$f['provaOk'])), 'pulados' => count($pulados)]);
    responder(200, ['ok' => true, 'carreiras' => $feitos, 'pulados' => $pulados, 'contas' => (object) $resumo]);
}

/**
 * Com as 87 provadas por carreiras verificadas, o candidato pendente da conta ao desafio de todas as conquistas (sem vencedor)
 * vira verificado (a verificação é a das carreiras). Devolve quantos mudaram.
 */
function promoverCandidatosConquistas(int $uid, ?string $quem): int
{
    if (!esquemaV34() || conquistasProvadas($uid, true) < CONQUISTAS_TOTAL) {
        return 0;
    }
    $pks = array_values(array_unique(array_map('intval', sql('SELECT prova_pk FROM conquistas_usuario WHERE usuario_id = ? AND prova_pk IS NOT NULL
        AND conquista_id IN (' . marcas(CONQUISTAS_TOTAL) . ')', array_merge([$uid], CONQUISTAS_IDS))->fetchAll(PDO::FETCH_COLUMN))));
    $n = 0;
    foreach (sql("SELECT k.id, k.desafio_id FROM desafio_candidatos k JOIN desafios d ON d.id = k.desafio_id WHERE k.usuario_id = ? AND k.estado = 'pendente'
        AND k.carreira_pk IS NULL AND d.vencido_em IS NULL", [$uid])->fetchAll() as $k) {
        $d = umaLinha('SELECT * FROM desafios WHERE id = ?', [(int) $k['desafio_id']]);
        if ($d === null || !eDeConquistas(criterioDe($d))) {
            continue;
        }
        $n += sql("UPDATE desafio_candidatos SET estado = 'verificada', verificacao = ?, motivo = NULL, decidido_em = ?, quem = ? WHERE id = ? AND estado = 'pendente'",
            [json(['ok' => true, 'detalhes' => ['v' => 1, 'provas' => true, 'carreiras' => $pks], 'em' => gmdate('Y-m-d\TH:i:s\Z'), 'quem' => $quem]),
                dt(time()), $quem, (int) $k['id']])->rowCount();
    }
    return $n;
}

/** A carreira mudou (salvar, apagar, moderação): as provas da conta são refeitas e os desafios avaliados. Devolve recalcularProvas. */
function contaMudouProvas(int $uid): array
{
    $r = recalcularProvas($uid);
    avaliarDesafiosConta($uid);
    return $r;
}

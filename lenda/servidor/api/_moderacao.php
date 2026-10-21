<?php
/**
 * LENDA · moderação pelo admin (v3.2): motivo obrigatório e guardado na carreira, decisões em lote (cada item na sua
 * transação), sinais automáticos nas filas do Hall, das denúncias e das indicações, lixeira das carreiras apagadas
 * (com bloqueio do reenvio), aviso ao autor e bônus em lote. Usado por admin.php. Nunca é servido (o .htaccess nega
 * _*.php). Contrato: servidor/CONTRATO-v32.md §A.
 */
declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/_hall.php';

const LOTE_MAX = 100;
const LIXEIRA_DIAS = 30;
/** Os motivos de carreiras.suspeita em texto (sinais do P0-3). `revisao` é o único leve. */
const TEXTO_SUSPEITA = [
    'temporadas' => 'Temporadas fora de 1–30',
    'pico' => 'Pico de OVR fora de 40–99',
    'nota' => 'Nota fora de 0–100 ou alta demais para o pico',
    'gols' => 'Gols demais para as temporadas',
    'bolas' => 'Mais Bolas de Ouro que temporadas',
    'titulos' => 'Títulos demais',
    'copas' => 'Copas do Mundo demais para as temporadas',
    'idade' => 'Idade final acima de 45',
    'bonus' => 'Bônus de OVR sem bônus usado',
    'nome' => 'Nome do jogador ofensivo',
    'dados' => 'Os dados não abrem',
    'copia' => 'A mesma carreira já foi salva por outra conta',
    'revisao' => 'Nota extraordinária: confira antes de liberar',
];
/** Motivo do aviso ao autor (H11): texto padrão, que não ensina a burlar. */
const AVISO_CATEGORIAS = [
    'nome' => 'nome ofensivo',
    'trapaca' => 'números impossíveis',
    'repetida' => 'carreira repetida',
    'pedido' => 'pedido seu',
    'outro' => 'não seguir as regras do Hall',
];
const MOTIVOS_EXCLUIR = ['pedido_titular', 'abuso', 'teste', 'outro'];

// ── quem e o quê ─────────────────────────────────────────────────────────────────────────────────

/** "a<id>", "token" ou "senha" (para guardar em colunas *_por); sem o _admin.php novo, o 'painel'|'token' antigo. */
function admQuem(): string
{
    if (function_exists('adminAtual')) {
        $a = adminAtual();
        if (is_array($a) && is_string($a['quem'] ?? null) && $a['quem'] !== '') {
            return substr($a['quem'], 0, 20);
        }
    }
    return function_exists('adminLogado') ? (string) (adminLogado() ?? 'sistema') : 'sistema';
}

/** Nome para mostrar de quem está no painel (a conta do painel ou "Token"). */
function admNome(): string
{
    if (function_exists('adminAtual')) {
        $a = adminAtual();
        if (is_array($a) && is_string($a['nome'] ?? null) && $a['nome'] !== '') {
            return mb_substr($a['nome'], 0, 60, 'UTF-8');
        }
    }
    return admQuem() === 'token' ? 'Token' : 'Admin';
}

/** "a12" → o nome da conta do painel (null se não achar); "token"/"senha"/"painel" → um rótulo. */
function nomeDeQuem(?string $quem): ?string
{
    if ($quem === null || $quem === '') {
        return null;
    }
    if (preg_match('/^a(\d{1,10})$/', $quem, $m)) {
        static $cache = [];
        if (!array_key_exists($quem, $cache)) {
            try {
                $n = umValor('SELECT nome FROM admin_contas WHERE id = ?', [(int) $m[1]]);
                $cache[$quem] = is_string($n) ? $n : null;
            } catch (PDOException) {
                $cache[$quem] = null;
            }
        }
        return $cache[$quem];
    }
    return match ($quem) {
        'token' => 'Token (script)',
        'senha', 'painel' => 'Senha do painel',
        default => null,
    };
}

/**
 * Motivo de uma decisão (1–200 caracteres). Obrigatório → 400 motivo. Até 200 depois de limpo (texto()); maior que isso
 * também é 400 (nada de cortar o porquê sem avisar).
 */
function lerMotivo(mixed $v, bool $obrigatorio, string $msg = 'Escreva o motivo: ele fica no registro.'): ?string
{
    if ($v !== null && !is_string($v)) {
        erro(400, 'motivo', 'O motivo é um texto de até 200 caracteres.');
    }
    $m = $v === null ? null : texto($v, 1000);
    if ($m !== null && mb_strlen($m, 'UTF-8') > 200) {
        erro(400, 'motivo', 'O motivo pode ter até 200 caracteres.');
    }
    if ($m === null && $obrigatorio) {
        erro(400, 'motivo', $msg);
    }
    return $m;
}

/** ids de um lote: lista de 1 a 100 inteiros positivos (repetidos saem). Senão 400 ids. */
function lerIdsLote(mixed $v): array
{
    if (!is_array($v) || !array_is_list($v) || count($v) < 1 || count($v) > LOTE_MAX) {
        erro(400, 'ids', 'Mande de 1 a ' . LOTE_MAX . ' itens em "ids".');
    }
    $ids = [];
    foreach ($v as $x) {
        $n = inteiroOuNulo($x, 1, 4294967295);
        if ($n === null) {
            erro(400, 'ids', 'Cada item de "ids" é um número.');
        }
        $ids[$n] = true;
    }
    return array_keys($ids);
}

/** carreiras.moderada_em/motivo_admin → {em, motivo} | null. */
function moderacaoJson(array $l): ?array
{
    if (($l['moderada_em'] ?? null) === null) {
        return null;
    }
    return ['em' => iso($l['moderada_em']), 'motivo' => $l['motivo_admin'] !== null ? (string) $l['motivo_admin'] : null];
}

/** Fecha as denúncias abertas de uma carreira com o resultado. */
function fecharDenuncias(int $pk, string $resultado): int
{
    return sql("UPDATE denuncias SET status = ?, resolvida_em = ? WHERE carreira_pk = ? AND status = 'aberta'",
        [$resultado, dt(time()), $pk])->rowCount();
}

// ── aviso ao autor (H11) ─────────────────────────────────────────────────────────────────────────

/** Categoria do aviso ao autor (null = não avisar). Fora da lista → 400 avisoMotivo. */
function lerAviso(array $j): ?string
{
    if (($j['avisar'] ?? false) !== true) {
        return null;
    }
    $c = $j['avisoMotivo'] ?? 'outro';
    if (!is_string($c) || !isset(AVISO_CATEGORIAS[$c])) {
        erro(400, 'aviso', 'avisoMotivo: nome, trapaca, repetida, pedido ou outro.');
    }
    return $c;
}

/** Grava em usuarios.aviso_conta o texto padrão (o jogo mostra uma vez em Minha conta; conta.php aviso_lido apaga). */
function avisarAutor(int $uid, string $jogador, string $categoria): void
{
    $nome = $jogador !== '' ? ' (' . mb_substr($jogador, 0, 40, 'UTF-8') . ')' : '';
    $txt = 'Uma carreira sua' . $nome . ' saiu do Hall público por: ' . (AVISO_CATEGORIAS[$categoria] ?? AVISO_CATEGORIAS['outro'])
        . '. Se achar que foi engano, escreva para ' . emailResposta() . '.';
    sql('UPDATE usuarios SET aviso_conta = ?, aviso_conta_em = ? WHERE id = ?', [mb_substr($txt, 0, 300, 'UTF-8'), dt(time()), $uid]);
}

// ── decisões sobre uma carreira (cada uma numa transação; quem chama tira da fotografia) ─────────

/**
 * Esconde (oculta = 1), grava o motivo e a hora, guarda a decisão (carreiras_moderacao) e fecha as denúncias abertas
 * como "ocultar". $pularSeJa (lote): já escondida pelo admin → ['pulado' => 'ja_estava'].
 * @return array{pulado?: string, carreira?: array, fechadas?: int}
 */
function ocultarCarreira(int $pk, string $motivo, bool $pularSeJa): array
{
    return transacao(static function () use ($pk, $motivo, $pularSeJa): array {
        $c = umaLinha('SELECT id, usuario_id, jogador, oculta, suspeita FROM carreiras WHERE id = ? FOR UPDATE', [$pk]);
        if ($c === null) {
            return ['pulado' => 'nao_encontrada'];
        }
        if ($pularSeJa && (int) $c['oculta'] === 1) {
            return ['pulado' => 'ja_estava'];
        }
        sql('UPDATE carreiras SET oculta = 1, motivo_admin = ?, moderada_em = ? WHERE id = ?', [$motivo, dt(time()), $pk]);
        gravarModeracao($pk, 1); // vale também se o dono apagar e salvar de novo
        return ['carreira' => $c, 'fechadas' => fecharDenuncias($pk, 'ocultar')];
    });
}

/**
 * Libera: oculta = 0 e suspeita = NULL, grava a hora (e o motivo, se veio; sem motivo fica NULL), apaga a decisão
 * guardada e fecha as denúncias abertas como "ok". $pularSeJa: já visível e sem suspeita → ja_estava.
 */
function mostrarCarreira(int $pk, ?string $motivo, bool $pularSeJa): array
{
    return transacao(static function () use ($pk, $motivo, $pularSeJa): array {
        $c = umaLinha('SELECT id, usuario_id, jogador, oculta, suspeita FROM carreiras WHERE id = ? FOR UPDATE', [$pk]);
        if ($c === null) {
            return ['pulado' => 'nao_encontrada'];
        }
        if ($pularSeJa && (int) $c['oculta'] === 0 && $c['suspeita'] === null) {
            return ['pulado' => 'ja_estava'];
        }
        sql('UPDATE carreiras SET oculta = 0, suspeita = NULL, motivo_admin = ?, moderada_em = ? WHERE id = ?', [$motivo, dt(time()), $pk]);
        apagarModeracao($pk);
        return ['carreira' => $c, 'fechadas' => fecharDenuncias($pk, 'ok')];
    });
}

/**
 * Apaga a carreira (admin): primeiro a cópia vai para a lixeira (30 dias, restaurável; depois fica só a marca que
 * impede o mesmo HallEntry de ser salvo de novo na conta), depois apaga a linha e as denúncias dela.
 * @return array{pulado?: string, carreira?: array, fechadas?: int, lixeiraId?: int}
 */
function apagarCarreiraAdmin(int $pk, string $motivo): array
{
    return transacao(static function () use ($pk, $motivo): array {
        $c = umaLinha('SELECT * FROM carreiras WHERE id = ? FOR UPDATE', [$pk]);
        if ($c === null) {
            return ['pulado' => 'nao_encontrada'];
        }
        $dados = $c['dados'];
        unset($c['dados']);
        $t = time();
        // resumo_hash (rev3): a mesma carreira salva por OUTRA conta depois de apagada vira "cópia" (plausibilidade)
        sql('INSERT INTO lixeira_carreiras (carreira_pk, usuario_id, carreira_id, jogador, nota, linha, dados, motivo, apagada_em, apagada_por, expira_em,
                resumo_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), carreira_pk = VALUES(carreira_pk), jogador = VALUES(jogador), nota = VALUES(nota),
                linha = VALUES(linha), dados = VALUES(dados), motivo = VALUES(motivo), apagada_em = VALUES(apagada_em),
                apagada_por = VALUES(apagada_por), expira_em = VALUES(expira_em), resumo_hash = VALUES(resumo_hash)',
            [$pk, (int) $c['usuario_id'], (string) $c['carreira_id'], (string) $c['jogador'], (int) $c['nota'], json($c), $dados, $motivo,
                dt($t), admQuem(), dt($t + LIXEIRA_DIAS * 86400), $c['resumo_hash'] ?? null]);
        $lix = (int) bd()->lastInsertId();
        gravarModeracao($pk, 1); // se a marca da lixeira for liberada, a carreira volta escondida (o admin decide)
        $n = sql('DELETE FROM denuncias WHERE carreira_pk = ?', [$pk])->rowCount();
        sql('DELETE FROM carreiras WHERE id = ?', [$pk]);
        return ['carreira' => $c, 'fechadas' => $n, 'lixeiraId' => $lix];
    });
}

/**
 * Decide as denúncias abertas de uma carreira: ocultar (oculta = 1, motivo, decisão guardada) ou ok (a escondida pelas
 * denúncias volta: oculta 2 → 0; a escondida pelo admin continua, com o motivo de quem a escondeu). $exigirAbertas
 * (lote): sem nenhuma aberta → sem_abertas, menos a escondida pelas denúncias (oculta = 2), que se decide do mesmo jeito.
 * $denunciaId (uma por vez): se ela já foi fechada e não há outra aberta → ['ja_decidida' => {oculta, resultado, em}].
 */
function resolverDenunciasCarreira(int $pk, string $resultado, ?string $motivo, bool $exigirAbertas, ?int $denunciaId = null): array
{
    return transacao(static function () use ($pk, $resultado, $motivo, $exigirAbertas, $denunciaId): array {
        $c = umaLinha('SELECT id, usuario_id, jogador, oculta, suspeita, motivo_admin, moderada_em FROM carreiras WHERE id = ? FOR UPDATE', [$pk]);
        if ($c === null) {
            return ['pulado' => 'nao_encontrada'];
        }
        $abertas = umValor("SELECT 1 FROM denuncias WHERE carreira_pk = ? AND status = 'aberta' LIMIT 1", [$pk]) !== null;
        // rev3: a escondida pelas denúncias (oculta = 2) que voltou sem nenhuma aberta (o dono apagou e salvou de novo:
        // as denúncias foram junto) também se decide no lote; sem isso ficava esperando uma decisão que a tela não dava
        if ($exigirAbertas && !$abertas && (int) $c['oculta'] !== 2) {
            return ['pulado' => 'sem_abertas'];
        }
        // rev3: decidir pela denúncia (uma por vez) com a tela velha: se ela já foi fechada (outra pessoa ou outra aba
        // decidiu) e não há mais nenhuma aberta, nada muda (nem o motivo guardado de quem decidiu antes)
        if ($denunciaId !== null && !$abertas
            && umValor("SELECT 1 FROM denuncias WHERE id = ? AND carreira_pk = ? AND status = 'aberta'", [$denunciaId, $pk]) === null) {
            $d = umaLinha('SELECT status, resolvida_em FROM denuncias WHERE id = ?', [$denunciaId]);
            return ['ja_decidida' => ['oculta' => (int) $c['oculta'], 'resultado' => $d['status'] ?? null, 'em' => iso($d['resolvida_em'] ?? $c['moderada_em'])]];
        }
        $t = dt(time());
        if ($resultado === 'ocultar') {
            sql('UPDATE carreiras SET oculta = 1, motivo_admin = ?, moderada_em = ? WHERE id = ?', [$motivo, $t, $pk]);
            gravarModeracao($pk, 1);
        } elseif ((int) $c['oculta'] === 1) {
            // escondida pelo admin: a denúncia "improcedente" fecha, mas a decisão (e o motivo) de quem escondeu fica
        } else {
            if (sql('UPDATE carreiras SET oculta = 0 WHERE id = ? AND oculta = 2', [$pk])->rowCount() === 1) {
                apagarModeracao($pk); // a que as denúncias esconderam volta
            }
            sql('UPDATE carreiras SET moderada_em = ?, motivo_admin = COALESCE(?, motivo_admin) WHERE id = ?', [$t, $motivo, $pk]);
        }
        return ['carreira' => $c, 'fechadas' => fecharDenuncias($pk, $resultado)];
    });
}

// ── lixeira (P1-8) ───────────────────────────────────────────────────────────────────────────────

const COLUNAS_RESTAURAR = ['usuario_id', 'carreira_id', 'modo', 'jogador', 'numero', 'pais', 'posicao', 'nota', 'nota_v', 'pico_ovr', 'temporadas',
    'gols', 'titulos', 'bolas_ouro', 'headline', 'como', 'tamanho', 'terminou_em', 'salva_em', 'publica', 'suspeita', 'clubes', 'copas',
    'bonus_ovr', 'resumo_hash'];
/**
 * Integração v3.4: as colunas da v3.3 (o replay, as Libertadores, a hora de entrada e a da semente do servidor) e da v3.4
 * (os números dos critérios novos, a lista de conquistas e a verificação) também voltam da linha guardada: sem elas a
 * carreira restaurada deixava de valer para desafio e de provar as conquistas da conta (o restaurar_carreira refaz as
 * provas logo depois). Só entram com o banco da versão e quando a linha guardada as tem.
 */
const COLUNAS_RESTAURAR_V33 = ['tem_replay', 'libertadores', 'primeira_em', 'fora_desafio', 'semente_em'];
const COLUNAS_RESTAURAR_V34 = ['champions', 'n_clubes', 'mesmo_clube', 'copas_selecao', 'pais_inicio', 'conquistas', 'conquistas_v', 'prova_ok',
    'prova_verificacao'];

const CAMPOS_LIXEIRA = 'l.id, l.carreira_pk, l.usuario_id, l.carreira_id, l.jogador, l.nota, l.motivo, l.apagada_em, l.apagada_por, l.expira_em,
    (l.dados IS NOT NULL) AS tem_copia';

/** Itens do ?r=lixeira (o apelido do dono numa consulta só). */
function itensLixeira(array $linhas): array
{
    $nomes = $linhas ? apelidosLixeira(array_column($linhas, 'usuario_id')) : [];
    return array_map(static fn(array $l): array => itemLixeira($l + ['apelido' => $nomes[(int) $l['usuario_id']] ?? null]), $linhas);
}

/** [id => apelido]. */
function apelidosLixeira(array $ids): array
{
    $ids = array_values(array_unique(array_map('intval', $ids)));
    $out = [];
    foreach (sql('SELECT id, apelido FROM usuarios WHERE id IN (' . marcas(count($ids)) . ')', $ids) as $l) {
        $out[(int) $l['id']] = (string) $l['apelido'];
    }
    return $out;
}

/** Item do ?r=lixeira. */
function itemLixeira(array $l): array
{
    return [
        'id' => (int) $l['id'],
        'carreiraPk' => (int) $l['carreira_pk'],
        'carreiraId' => (string) $l['carreira_id'],
        'usuario' => $l['apelido'] !== null ? ['id' => (int) $l['usuario_id'], 'apelido' => (string) $l['apelido']] : null,
        'jogador' => (string) $l['jogador'],
        'nota' => (int) $l['nota'],
        'motivo' => $l['motivo'],
        'apagadaEm' => iso($l['apagada_em']),
        'apagadaPor' => $l['apagada_por'],
        'apagadaPorNome' => nomeDeQuem($l['apagada_por']),
        'expiraEm' => iso($l['expira_em']),
        'temCopia' => (int) $l['tem_copia'] === 1,
    ];
}

/**
 * Restaura a carreira da lixeira como oculta = 1 (o admin decide depois com "Mostrar"), com o mesmo carreiras.id de
 * antes. 404 / 409 sem_copia (a cópia venceu) / 409 ja_existe (a conta já tem essa carreira de novo). → pk.
 */
function restaurarCarreira(int $lixId): int
{
    $r = transacao(static function () use ($lixId): array {
        $l = umaLinha('SELECT * FROM lixeira_carreiras WHERE id = ? FOR UPDATE', [$lixId]);
        if ($l === null) {
            return ['erro' => [404, 'nao_encontrada', 'Essa carreira não está na lixeira.']];
        }
        if ($l['dados'] === null || $l['linha'] === null) {
            // rev3: a cópia some porque venceu (30 dias) ou porque a lixeira voltou de um backup sem ela (os de antes da rev3)
            $venceu = (paraTempo((string) $l['expira_em']) ?? 0) <= time();
            return ['erro' => [409, 'sem_copia', $venceu ? 'A cópia venceu (30 dias): sobrou só a marca que impede o reenvio.'
                : 'A cópia não veio na restauração do backup (backup sem as cópias da lixeira): sobrou só a marca que impede o reenvio.']];
        }
        if (umValor('SELECT 1 FROM usuarios WHERE id = ? FOR UPDATE', [(int) $l['usuario_id']]) === null) {
            return ['erro' => [404, 'nao_encontrado', 'A conta dona da carreira não existe mais.']];
        }
        if (umValor('SELECT id FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [(int) $l['usuario_id'], (string) $l['carreira_id']]) !== null) {
            return ['erro' => [409, 'ja_existe', 'A conta já tem essa carreira de novo.']];
        }
        $linha = json_decode((string) $l['linha'], true);
        if (!is_array($linha)) {
            return ['erro' => [409, 'sem_copia', 'A cópia está estragada e não dá para restaurar.']];
        }
        $cols = [];
        $vals = [];
        foreach (array_merge(COLUNAS_RESTAURAR, esquemaV33() ? COLUNAS_RESTAURAR_V33 : [], esquemaV34() ? COLUNAS_RESTAURAR_V34 : []) as $k) {
            if (array_key_exists($k, $linha)) {
                $cols[] = $k;
                $vals[] = $linha[$k];
            }
        }
        $t = dt(time());
        $pkLivre = umValor('SELECT 1 FROM carreiras WHERE id = ?', [(int) $l['carreira_pk']]) === null;
        array_push($cols, 'dados', 'oculta', 'motivo_admin', 'moderada_em');
        array_push($vals, $l['dados'], 1, $l['motivo'], $t);
        if ($pkLivre) {
            array_unshift($cols, 'id');
            array_unshift($vals, (int) $l['carreira_pk']);
        }
        sql('INSERT INTO carreiras (' . implode(', ', $cols) . ') VALUES (' . marcas(count($vals)) . ')', $vals);
        $pk = $pkLivre ? (int) $l['carreira_pk'] : (int) bd()->lastInsertId();
        gravarModeracao($pk, 1);
        sql('DELETE FROM lixeira_carreiras WHERE id = ?', [$lixId]);
        return ['pk' => $pk, 'usuario' => (int) $l['usuario_id'], 'jogador' => (string) $l['jogador']];
    });
    if (isset($r['erro'])) {
        erro(...$r['erro']);
    }
    return $r['pk'];
}

/**
 * Apaga a marca da lixeira (e a cópia, se ainda houver) e a decisão guardada daquela carreira: o jogador pode salvar
 * de novo e ela volta como uma carreira qualquer (passando pela conferência de sempre).
 */
function liberarReenvio(int $lixId): array
{
    $l = transacao(static function () use ($lixId): ?array {
        $l = umaLinha('SELECT id, usuario_id, carreira_id, jogador FROM lixeira_carreiras WHERE id = ? FOR UPDATE', [$lixId]);
        if ($l === null) {
            return null;
        }
        sql('DELETE FROM lixeira_carreiras WHERE id = ?', [$lixId]);
        sql('DELETE FROM carreiras_moderacao WHERE usuario_id = ? AND carreira_id = ?', [(int) $l['usuario_id'], (string) $l['carreira_id']]);
        return $l;
    });
    if ($l === null) {
        erro(404, 'nao_encontrada', 'Essa carreira não está na lixeira.');
    }
    return $l;
}

/** A conta tem a marca da lixeira para esta carreira? (carreiras.php salvar → 409 apagada). */
function carreiraNaLixeira(int $uid, string $carreiraId): bool
{
    if (!esquemaV32()) {
        return false;
    }
    return umValor('SELECT 1 FROM lixeira_carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uid, $carreiraId]) !== null;
}

// ── sinais automáticos (P0-3) ────────────────────────────────────────────────────────────────────

function sinal(string $nivel, string $codigo, string $texto): array
{
    return ['nivel' => $nivel, 'codigo' => $codigo, 'texto' => $texto];
}

/** Ordena graves primeiro e diz se é seguro (nenhum grave). */
function comSinais(array $sinais): array
{
    usort($sinais, static fn(array $a, array $b): int => ($a['nivel'] === 'grave' ? 0 : 1) <=> ($b['nivel'] === 'grave' ? 0 : 1));
    $seguro = true;
    foreach ($sinais as $s) {
        $seguro = $seguro && $s['nivel'] !== 'grave';
    }
    return ['sinais' => $sinais, 'seguro' => $seguro];
}

/**
 * Sinais das carreiras de uma página (consultas agrupadas, nada por item). $linhas: id, usuario_id, suspeita, oculta,
 * foto_id (posição no Hall), u_criado_em, u_status, u_suspenso_ate. → [pk => [sinal…]].
 */
function sinaisCarreiras(array $linhas): array
{
    if (!$linhas) {
        return [];
    }
    $pks = array_values(array_unique(array_map(static fn(array $l): int => (int) $l['id'], $linhas)));
    $uids = array_values(array_unique(array_map(static fn(array $l): int => (int) $l['usuario_id'], $linhas)));
    $den = [];
    foreach (sql("SELECT carreira_pk, COUNT(*) AS n, COALESCE(SUM(motivo = 'trapaca'), 0) AS t FROM denuncias WHERE status = 'aberta'
        AND carreira_pk IN (" . marcas(count($pks)) . ') GROUP BY carreira_pk', $pks) as $l) {
        $den[(int) $l['carreira_pk']] = ['n' => (int) $l['n'], 't' => (int) $l['t']];
    }
    $ocultasDono = [];
    foreach (sql('SELECT usuario_id, COUNT(*) AS n FROM carreiras WHERE oculta = 1 AND usuario_id IN (' . marcas(count($uids)) . ') GROUP BY usuario_id', $uids) as $l) {
        $ocultasDono[(int) $l['usuario_id']] = (int) $l['n'];
    }
    $suspensos = [];
    $alvos = array_map(static fn(int $u): string => 'usuario:' . $u, $uids);
    foreach (sql("SELECT DISTINCT alvo FROM admin_log WHERE acao = 'suspender' AND alvo IN (" . marcas(count($alvos)) . ')', $alvos) as $l) {
        $suspensos[(int) substr((string) $l['alvo'], 8)] = true;
    }
    $agora = time();
    $out = [];
    foreach ($linhas as $l) {
        $pk = (int) $l['id'];
        $uid = (int) $l['usuario_id'];
        $s = [];
        $motivos = $l['suspeita'] !== null && $l['suspeita'] !== '' ? explode(',', (string) $l['suspeita']) : [];
        foreach ($motivos as $m) {
            $s[] = sinal($m === 'revisao' ? 'leve' : 'grave', 'suspeita:' . $m, TEXTO_SUSPEITA[$m] ?? ('Suspeita: ' . $m));
        }
        $d = $den[$pk] ?? ['n' => 0, 't' => 0];
        if ($d['n'] >= 3) {
            $s[] = sinal('grave', 'muitas_denuncias', $d['n'] . ' denúncias abertas de contas diferentes');
        }
        $outras = ($ocultasDono[$uid] ?? 0) - ((int) ($l['oculta'] ?? 0) === 1 ? 1 : 0);
        $suspAgora = contaSuspensa(['status' => $l['u_status'] ?? 'ativo', 'suspenso_ate' => $l['u_suspenso_ate'] ?? null]);
        if ($outras > 0 || isset($suspensos[$uid]) || $suspAgora) {
            $s[] = sinal('grave', 'reincidente', $outras > 0 ? 'O dono tem outra carreira oculta pela moderação' : 'O dono já foi suspenso');
        }
        if (isset($l['foto_id']) && $l['foto_id'] !== null && (int) $l['foto_id'] <= 20) {
            $s[] = sinal('grave', 'topo_hall', 'Entre as 20 primeiras do Hall (' . (int) $l['foto_id'] . 'ª): a mais vista');
        }
        $criado = paraTempo($l['u_criado_em'] ?? null);
        if ($criado !== null && $criado > $agora - 86400) {
            $s[] = sinal('leve', 'conta_nova', 'Conta criada há menos de 24 h');
        }
        if ($d['t'] > 0 && !$motivos) {
            $s[] = sinal('leve', 'trapaca_plausivel', 'Denunciada por trapaça, mas os números passam na conferência');
        }
        $out[$pk] = $s;
    }
    return $out;
}

/** [usuario_id => n] de denúncias feitas nas últimas 24 h por estas contas (denunciante em massa, 5+). */
function denunciasRecentesDe(array $uids): array
{
    $uids = array_values(array_unique(array_filter($uids)));
    if (!$uids) {
        return [];
    }
    $out = [];
    foreach (sql('SELECT usuario_id, COUNT(*) AS n FROM denuncias WHERE usuario_id IN (' . marcas(count($uids)) . ') AND criada_em >= ? GROUP BY usuario_id',
        array_merge($uids, [dt(time() - 86400)])) as $l) {
        $out[(int) $l['usuario_id']] = (int) $l['n'];
    }
    return $out;
}

/**
 * Sinais das indicações de uma página (P1-9): grave mesmo aparelho (vid em comum nas visitas) e indicador com 5+ em
 * 24 h; leve indicado sem partida há 7+ dias e indicado criado há menos de 10 min. $linhas: id, indicador_id,
 * indicado_id, b_criado_em, b_partidas_conta, b_partidas. → [id => [sinal…]].
 */
function sinaisIndicacoes(array $linhas): array
{
    if (!$linhas) {
        return [];
    }
    $indicadores = array_values(array_unique(array_map(static fn(array $l): int => (int) $l['indicador_id'], $linhas)));
    $indicados = array_values(array_unique(array_filter(array_map(static fn(array $l): int => (int) ($l['indicado_id'] ?? 0), $linhas))));
    $pares = [];
    if ($indicados) {
        foreach (sql('SELECT DISTINCT a.usuario_id AS x, b.usuario_id AS y FROM visitas a JOIN visitas b ON b.vid = a.vid
            WHERE a.usuario_id IN (' . marcas(count($indicadores)) . ') AND b.usuario_id IN (' . marcas(count($indicados)) . ')',
            array_merge($indicadores, $indicados)) as $l) {
            $pares[(int) $l['x'] . ':' . (int) $l['y']] = true;
        }
    }
    $serie = [];
    foreach (sql('SELECT indicador_id, COUNT(*) AS n FROM indicacoes WHERE indicador_id IN (' . marcas(count($indicadores)) . ') AND criada_em >= ?
        GROUP BY indicador_id', array_merge($indicadores, [dt(time() - 86400)])) as $l) {
        $serie[(int) $l['indicador_id']] = (int) $l['n'];
    }
    $agora = time();
    $out = [];
    foreach ($linhas as $l) {
        $s = [];
        $a = (int) $l['indicador_id'];
        $b = (int) ($l['indicado_id'] ?? 0);
        if ($b > 0 && isset($pares["$a:$b"])) {
            $s[] = sinal('grave', 'mesmo_aparelho', 'Indicador e indicado no mesmo aparelho');
        }
        if (($serie[$a] ?? 0) >= 5) {
            $s[] = sinal('grave', 'serie_24h', 'O indicador fez ' . $serie[$a] . ' indicações em 24 h');
        }
        $criado = paraTempo($l['b_criado_em'] ?? null);
        if ($b > 0 && $criado !== null) {
            if ($criado < $agora - 7 * 86400 && (int) ($l['b_partidas_conta'] ?? 0) === 0) {
                $s[] = sinal('leve', 'sem_partida', 'O indicado não terminou nenhuma partida em 7+ dias');
            }
            if ($criado > $agora - 600) {
                $s[] = sinal('leve', 'conta_recente', 'O indicado foi criado há menos de 10 min');
            }
        }
        $out[(int) $l['id']] = $s;
    }
    return $out;
}

// ── indicações e bônus (um item por transação; o lote chama o mesmo) ─────────────────────────────

/**
 * Recusa a indicação e tira o bônus dela se ainda não foi usado. No lote ($lote): já recusada → ja_recusada; bônus já
 * usado → bonus_usado (fica como está). Sem lote, recusa mesmo com o bônus usado (que fica).
 * @return array{pulado?: string, indicacao?: array, bonusTirado?: bool}
 */
function recusarIndicacao(int $iid, bool $lote): array
{
    $ind = umaLinha('SELECT indicador_id FROM indicacoes WHERE id = ?', [$iid]);
    if ($ind === null) {
        return ['pulado' => 'nao_encontrada'];
    }
    return transacao(static function () use ($iid, $ind, $lote): array {
        sql('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', [(int) $ind['indicador_id']]);
        $i = umaLinha('SELECT * FROM indicacoes WHERE id = ? FOR UPDATE', [$iid]);
        if ($i === null) {
            return ['pulado' => 'nao_encontrada'];
        }
        if ($lote && $i['status'] === 'recusada') {
            return ['pulado' => 'ja_recusada'];
        }
        $ref = 'indicacao:' . $iid;
        if ($lote && umValor("SELECT 1 FROM bonus WHERE usuario_id = ? AND origem = 'indicacao' AND ref = ? AND usado_em IS NOT NULL LIMIT 1",
            [(int) $i['indicador_id'], $ref]) !== null) {
            return ['pulado' => 'bonus_usado'];
        }
        sql("UPDATE indicacoes SET status = 'recusada', motivo = 'admin' WHERE id = ?", [$iid]);
        $n = sql("DELETE FROM bonus WHERE usuario_id = ? AND origem = 'indicacao' AND ref = ? AND usado_em IS NULL", [(int) $i['indicador_id'], $ref])->rowCount();
        return ['indicacao' => $i, 'bonusTirado' => $n > 0];
    });
}

/**
 * Tira um bônus ainda não usado (o de uma indicação recusa a indicação, senão ela contaria de novo).
 * @return array{pulado?: string, bonus?: array}
 */
function tirarBonus(int $bid): array
{
    $b0 = umaLinha('SELECT usuario_id FROM bonus WHERE id = ?', [$bid]);
    if ($b0 === null) {
        return ['pulado' => 'nao_encontrado'];
    }
    return transacao(static function () use ($bid, $b0): array {
        sql('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', [(int) $b0['usuario_id']]);
        $b = umaLinha('SELECT * FROM bonus WHERE id = ? FOR UPDATE', [$bid]);
        if ($b === null) {
            return ['pulado' => 'nao_encontrado'];
        }
        if ($b['usado_em'] !== null) {
            return ['pulado' => 'usado'];
        }
        sql('DELETE FROM bonus WHERE id = ? AND usado_em IS NULL', [$bid]);
        if ($b['origem'] === 'indicacao' && preg_match('/^indicacao:(\d+)$/', (string) $b['ref'], $mm)) {
            sql("UPDATE indicacoes SET status = 'recusada', motivo = 'admin' WHERE id = ?", [(int) $mm[1]]);
        }
        return ['bonus' => $b];
    });
}

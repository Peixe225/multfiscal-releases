<?php
/**
 * LENDA · indicações e bônus de OVR (CONTRATO-v3 §6). Usado por conta.php (cadastro com convite, partidas),
 * e.php (partida terminada), bonus.php e admin.php. Nunca é servido (o .htaccess nega _*.php).
 *
 * - Cada partida terminada com a conta ligada que o e.php aceita como de verdade (jogo_fim pareado com um
 *   jogo_inicio do mesmo aparelho pelo menos 20 s antes — ver e.php) soma 1 em usuarios.partidas_conta. Os bônus de
 *   indicar e de compartilhar só valem (liberado) depois de bonus.liberaAposPartidas partidas assim.
 * - Indicação: nasce 'pendente' no cadastro com código; vale ('valida') quando o indicado termina uma partida do
 *   Clássico que conta, depois do cadastro, num aparelho que não é do indicador, e já jogou pelo menos 3 min no site
 *   (soma de ativo_s). Ao validar, o bônus do indicador (+2, +3, +5…) é criado na hora; ele só fica disponível quando
 *   o indicador estiver liberado ("guardado" até lá).
 * - Toda escrita de bônus de uma conta trava a linha dela em usuarios (FOR UPDATE): sem corrida entre pedidos.
 */
declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

function bonusCfg(): array
{
    return siteConfig()['bonus'];
}

/** Partidas terminadas com a conta que ainda faltam para liberar os bônus de indicar/compartilhar. */
function faltamPartidas(array $u): int
{
    return max(0, (int) bonusCfg()['liberaAposPartidas'] - (int) ($u['partidas_conta'] ?? 0));
}

function bonusLiberado(array $u): bool
{
    return faltamPartidas($u) === 0;
}

/** Condição SQL (sem apelido) do bônus que dá para usar agora. Os do admin valem sempre. */
function sqlBonusDisponivel(bool $liberado): string
{
    return 'usado_em IS NULL' . ($liberado ? '' : " AND origem = 'admin'");
}

/** Valor do bônus da próxima indicação válida do indicador (0 = já chegou no limite). */
function valorProximaIndicacao(int $indicadorId): int
{
    $cfg = bonusCfg();
    $k = (int) umValor("SELECT COUNT(*) FROM indicacoes WHERE indicador_id = ? AND status = 'valida'", [$indicadorId]);
    if ($k >= (int) $cfg['maxIndicacoes']) {
        return 0;
    }
    $lista = $cfg['indicacao'];
    return (int) $lista[min($k, count($lista) - 1)];
}

/** O aparelho ($vid) já foi usado pela conta $uid? (visitas antigas ou o vínculo atual) */
function aparelhoDaConta(string $vid, int $uid): bool
{
    return umValor('SELECT 1 FROM visitantes_usuarios WHERE vid = ? AND usuario_id = ?', [$vid, $uid]) !== null
        || umValor('SELECT 1 FROM visitas WHERE vid = ? AND usuario_id = ? LIMIT 1', [$vid, $uid]) !== null;
}

/**
 * No cadastro com código de convite (dentro da transação do cadastro, ANTES de ligar o aparelho à conta nova).
 * Código que não existe: ignora. Recusa: a própria conta, aparelho do indicador, indicador suspenso ou no limite.
 */
function registrarIndicacao(int $uid, ?string $codigo, ?string $vid): void
{
    if ($codigo === null) {
        return;
    }
    $ind = umaLinha('SELECT * FROM usuarios WHERE codigo_convite = ?', [$codigo]);
    if ($ind === null) {
        return;
    }
    $iid = (int) $ind['id'];
    $motivo = null;
    if ($iid === $uid) {
        $motivo = 'propria_conta';
    } elseif ($vid !== null && aparelhoDaConta($vid, $iid)) {
        $motivo = 'mesmo_aparelho';
    } elseif (contaSuspensa($ind)) {
        $motivo = 'suspenso';
    } elseif (valorProximaIndicacao($iid) === 0) {
        $motivo = 'limite';
    }
    sql('INSERT IGNORE INTO indicacoes (indicador_id, indicado_id, criada_em, status, motivo) VALUES (?, ?, ?, ?, ?)',
        [$iid, $uid, dt(time()), $motivo === null ? 'pendente' : 'recusada', $motivo]);
}

/** Tempo de jogo (soma de ativo_s das visitas) que o indicado precisa ter para a indicação valer. */
const INDICADO_ATIVO_MIN_S = 180;

/**
 * Valida a indicação pendente da conta $uid (o indicado), se houver. $porEvento = chamado pelo e.php logo depois de
 * contar uma partida do Clássico, com $vidPartida = o aparelho dela; senão (conta.php partidas, minuto a mais de jogo)
 * precisa de uma partida contada (partidas_conta ≥ 1) e usa o aparelho do último jogo_fim do Clássico depois do
 * cadastro. Ainda sem 3 min de jogo: continua pendente (vale numa próxima vez). Aparelho do indicador: recusa.
 */
function conferirIndicacao(int $uid, ?string $vidPartida, bool $porEvento): void
{
    $ind = umaLinha("SELECT i.id, i.indicador_id, u.criado_em, u.partidas_conta FROM indicacoes i JOIN usuarios u ON u.id = i.indicado_id
        WHERE i.indicado_id = ? AND i.status = 'pendente'", [$uid]);
    if ($ind === null) {
        return;
    }
    if ((int) umValor('SELECT COALESCE(SUM(ativo_s), 0) FROM visitas WHERE usuario_id = ?', [$uid]) < INDICADO_ATIVO_MIN_S) {
        return;
    }
    if (!$porEvento) {
        if ((int) $ind['partidas_conta'] < 1) {
            return;
        }
        $vidPartida = umValor("SELECT e.vid FROM visitas v JOIN eventos e ON e.sid = v.sid
            WHERE v.usuario_id = ? AND e.tipo = 'jogo_fim' AND e.modo = 'classico' AND e.em >= ? ORDER BY e.em DESC, e.id DESC LIMIT 1",
            [$uid, $ind['criado_em']]);
        if (!is_string($vidPartida)) {
            return;
        }
    }
    $iid = (int) $ind['indicador_id'];
    $id = (int) $ind['id'];
    transacao(static function () use ($iid, $id, $vidPartida): void {
        sql('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', [$iid]); // um bônus do indicador de cada vez
        if (umValor("SELECT status FROM indicacoes WHERE id = ? FOR UPDATE", [$id]) !== 'pendente') {
            return;
        }
        $t = dt(time());
        if ($vidPartida !== null && aparelhoDaConta($vidPartida, $iid)) {
            sql("UPDATE indicacoes SET status = 'recusada', motivo = 'mesmo_aparelho', validada_em = ? WHERE id = ?", [$t, $id]);
            return;
        }
        $valor = valorProximaIndicacao($iid);
        if ($valor <= 0) {
            sql("UPDATE indicacoes SET status = 'recusada', motivo = 'limite', validada_em = ? WHERE id = ?", [$t, $id]);
            return;
        }
        sql("UPDATE indicacoes SET status = 'valida', motivo = NULL, validada_em = ? WHERE id = ?", [$t, $id]);
        sql("INSERT INTO bonus (usuario_id, valor, origem, ref, criado_em) VALUES (?, ?, 'indicacao', ?, ?)", [$iid, $valor, 'indicacao:' . $id, $t]);
    });
}

/**
 * conta.php partidas: confere a indicação pendente. As partidas desde o cadastro (partidas_conta) são só as que o
 * e.php contou (pareadas): contar de novo pelos eventos deixaria um jogo_fim inventado liberar os bônus.
 */
function acertarPartidasConta(array $u): void
{
    conferirIndicacao((int) $u['id'], null, false);
}

/** bonus.php usar: o disponível mais antigo vai para a carreira; repetir com a mesma carreira devolve o mesmo. */
function usarBonus(int $uid, string $carreiraId): array
{
    return transacao(static function () use ($uid, $carreiraId): array {
        $u = umaLinha('SELECT * FROM usuarios WHERE id = ? FOR UPDATE', [$uid]);
        $ja = umaLinha('SELECT valor, origem FROM bonus WHERE usuario_id = ? AND carreira_id = ? LIMIT 1', [$uid, $carreiraId]);
        if ($ja !== null) {
            return ['valor' => (int) $ja['valor'], 'origem' => (string) $ja['origem']];
        }
        $b = umaLinha('SELECT id, valor, origem FROM bonus WHERE usuario_id = ? AND ' . sqlBonusDisponivel($u !== null && bonusLiberado($u))
            . ' ORDER BY criado_em, id LIMIT 1 FOR UPDATE', [$uid]);
        if ($b === null) {
            return ['valor' => 0];
        }
        sql('UPDATE bonus SET usado_em = ?, carreira_id = ? WHERE id = ?', [dt(time()), $carreiraId, (int) $b['id']]);
        return ['valor' => (int) $b['valor'], 'origem' => (string) $b['origem']];
    });
}

/** bonus.php compartilhei: +N uma vez por dia (Brasília), só depois de liberado. */
function compartilhouCarreira(int $uid): array
{
    return transacao(static function () use ($uid): array {
        $u = umaLinha('SELECT * FROM usuarios WHERE id = ? FOR UPDATE', [$uid]);
        $valor = (int) bonusCfg()['compartilhar'];
        if ($u === null || !bonusLiberado($u) || $valor <= 0) {
            return ['ganhou' => 0, 'motivo' => 'bloqueado'];
        }
        $ref = 'dia:' . diaBrasilia();
        if (umValor("SELECT 1 FROM bonus WHERE usuario_id = ? AND origem = 'compartilhar' AND ref = ? LIMIT 1", [$uid, $ref]) !== null) {
            return ['ganhou' => 0, 'motivo' => 'ja_hoje'];
        }
        sql("INSERT INTO bonus (usuario_id, valor, origem, ref, criado_em) VALUES (?, ?, 'compartilhar', ?, ?)", [$uid, $valor, $ref, dt(time())]);
        return ['ganhou' => $valor];
    });
}

/** Linha de bonus → JSON. */
function bonusJson(array $b): array
{
    return ['id' => (int) $b['id'], 'valor' => (int) $b['valor'], 'origem' => (string) $b['origem'], 'criadoEm' => iso($b['criado_em'])];
}

/** GET bonus.php. */
function resumoBonus(array $u): array
{
    $uid = (int) $u['id'];
    $lib = bonusLiberado($u);
    $disp = [];
    $guardados = [];
    $usados = 0;
    foreach (sql('SELECT id, valor, origem, criado_em, usado_em FROM bonus WHERE usuario_id = ? ORDER BY criado_em, id', [$uid]) as $b) {
        if ($b['usado_em'] !== null) {
            $usados++;
        } elseif ($lib || $b['origem'] === 'admin') {
            $disp[] = bonusJson($b);
        } else {
            $guardados[] = bonusJson($b);
        }
    }
    $ind = ['valida' => 0, 'pendente' => 0];
    foreach (sql('SELECT status, COUNT(*) AS n FROM indicacoes WHERE indicador_id = ? GROUP BY status', [$uid]) as $l) {
        $ind[$l['status']] = (int) $l['n'];
    }
    $codigo = garantirCodigoConvite($uid, $u['codigo_convite'] ?? null);
    $cfg = bonusCfg();
    $jaHoje = umValor("SELECT 1 FROM bonus WHERE usuario_id = ? AND origem = 'compartilhar' AND ref = ? LIMIT 1", [$uid, 'dia:' . diaBrasilia()]) !== null;
    return [
        'liberado' => $lib,
        'faltamPartidas' => faltamPartidas($u),
        'disponiveis' => $disp,
        'guardados' => $guardados,
        'usados' => $usados,
        'indicacoes' => [
            'validas' => $ind['valida'],
            'pendentes' => $ind['pendente'],
            'limite' => (int) $cfg['maxIndicacoes'],
            'proximoValor' => valorProximaIndicacao($uid),
        ],
        'compartilharHoje' => $lib && !$jaHoje && (int) $cfg['compartilhar'] > 0,
        'compartilharValor' => (int) $cfg['compartilhar'],
        'codigoConvite' => $codigo,
        'linkConvite' => linkConvite($codigo),
    ];
}

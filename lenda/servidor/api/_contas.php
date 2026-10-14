<?php
/**
 * LENDA · contas: o objeto U, o vínculo do aparelho e a exclusão (LGPD). Usado por conta.php e admin.php.
 * Nunca é servido (o .htaccess nega _*.php). Contrato: servidor/CONTRATO.md e CONTRATO-v3.md §3.
 */
declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/_hall.php';

/** Objeto U do contrato, com as estatísticas tiradas do banco. */
function usuarioJson(array $u): array
{
    $id = (int) $u['id'];
    $c = umaLinha('SELECT COUNT(*) AS n, MAX(nota) AS melhor, COALESCE(SUM(bolas_ouro), 0) AS bo,
        COALESCE(SUM(gols), 0) AS gols, COALESCE(SUM(titulos), 0) AS tit FROM carreiras WHERE usuario_id = ?', [$id]);
    $melhorJogador = $c && (int) $c['n'] > 0
        ? umValor('SELECT jogador FROM carreiras WHERE usuario_id = ? ORDER BY nota DESC, pico_ovr DESC, salva_em ASC LIMIT 1', [$id])
        : null;
    $v = umaLinha('SELECT COALESCE(SUM(ativo_s), 0) AS s, MIN(inicio) AS p, MAX(ultimo) AS u FROM visitas WHERE usuario_id = ?', [$id]);
    $aparelhos = sql('SELECT dispositivo FROM visitas WHERE usuario_id = ? AND dispositivo IS NOT NULL
        GROUP BY dispositivo ORDER BY MIN(inicio)', [$id])->fetchAll(PDO::FETCH_COLUMN);

    $primeiro = $u['criado_em'];
    if (!empty($v['p']) && $v['p'] < $primeiro) {
        $primeiro = $v['p'];
    }
    $ultimo = $u['criado_em'];
    foreach ([$u['ultimo_acesso'] ?? null, $u['ultimo_login'] ?? null, $v['u'] ?? null] as $x) {
        if (!empty($x) && $x > $ultimo) {
            $ultimo = $x;
        }
    }
    $codigo = garantirCodigoConvite($id, $u['codigo_convite'] ?? null);
    return [
        'id' => $id,
        'apelido' => (string) $u['apelido'],
        'email' => (string) $u['email'],
        'criadoEm' => iso($u['criado_em']),
        'timeCoracao' => $u['time_coracao'] !== null ? (string) $u['time_coracao'] : null,
        'uf' => $u['uf'] !== null ? (string) $u['uf'] : null,
        'origem' => (string) $u['origem'],
        'hallPublico' => (string) ($u['hall_publico'] ?? 'auto'),
        'codigoConvite' => $codigo,
        'estatisticas' => [
            // o contador do aparelho (inclui as de antes do cadastro) ou as contadas com a conta: nada de contar os
            // eventos da vida inteira a cada abertura do jogo
            'partidas' => max((int) $u['partidas'], (int) ($u['partidas_conta'] ?? 0)),
            'carreirasSalvas' => (int) ($c['n'] ?? 0),
            'melhorNota' => isset($c['melhor']) ? (int) $c['melhor'] : null,
            'melhorJogador' => $melhorJogador !== null ? (string) $melhorJogador : null,
            'bolasOuro' => (int) ($c['bo'] ?? 0),
            'gols' => (int) ($c['gols'] ?? 0),
            'titulos' => (int) ($c['tit'] ?? 0),
            'tempoJogadoMin' => intdiv((int) ($v['s'] ?? 0), 60),
            'primeiroAcesso' => iso($primeiro),
            'ultimoAcesso' => iso($ultimo),
            'aparelhos' => array_values(array_map('strval', $aparelhos)),
        ],
    ];
}

function buscarUsuario(int $id): array
{
    $u = umaLinha('SELECT * FROM usuarios WHERE id = ?', [$id]);
    if ($u === null) {
        erro(401, 'nao_logado', 'Entre na sua conta para continuar.');
    }
    return $u;
}

/** Liga o visitante (aparelho) à conta e passa para ela as visitas sem dono desse aparelho. */
function ligarVisitante(?string $vid, int $uid): void
{
    if ($vid === null) {
        return;
    }
    $t = dt(time());
    sql('INSERT INTO visitantes_usuarios (vid, usuario_id, ligado_em) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE usuario_id = VALUES(usuario_id), ligado_em = VALUES(ligado_em)', [$vid, $uid, $t]);
    sql('UPDATE visitas SET usuario_id = ? WHERE vid = ? AND usuario_id IS NULL', [$uid, $vid]);
}

/**
 * Exclui a conta (LGPD): usuário, sessões, carreiras (e o lugar delas no Hall público, as denúncias contra
 * elas e a decisão de moderação guardada), conquistas, bônus, indicações que ela fez, denúncias que ela fez; a
 * indicação que ela recebeu fica sem o indicado (o bônus do amigo continua dele). As visitas ficam só como
 * estatística anônima, com um vid novo por aparelho. No registro do admin, as linhas da conta e das carreiras dela
 * ficam só com a ação, a data e o id. Sem senha: quem chama confere (conta.php pede a senha; admin.php exige o admin).
 */
function excluirUsuario(int $uid): void
{
    transacao(static function () use ($uid): void {
        $u = umaLinha('SELECT id, email FROM usuarios WHERE id = ? FOR UPDATE', [$uid]);
        if ($u === null) {
            return;
        }
        tirarDoHall(null, $uid);
        $pks = array_map('intval', sql('SELECT id FROM carreiras WHERE usuario_id = ?', [$uid])->fetchAll(PDO::FETCH_COLUMN));
        foreach (array_chunk($pks, 500) as $lote) {
            sql('DELETE FROM denuncias WHERE carreira_pk IN (' . marcas(count($lote)) . ')', $lote);
        }
        // registro do admin: fica que a ação aconteceu (e quando), sem o apelido nem os motivos escritos (LGPD)
        $alvos = array_merge(['usuario:' . $uid], array_map(static fn(int $pk): string => 'carreira:' . $pk, $pks));
        foreach (array_chunk($alvos, 500) as $lote) {
            foreach (sql('SELECT id, detalhes FROM admin_log WHERE alvo IN (' . marcas(count($lote)) . ')', $lote)->fetchAll() as $l) {
                $d = is_string($l['detalhes']) ? json_decode($l['detalhes'], true) : null;
                sql('UPDATE admin_log SET detalhes = ? WHERE id = ?', [json(['via' => is_array($d) && is_string($d['via'] ?? null) ? $d['via'] : 'sistema',
                    'excluido' => true]), (int) $l['id']]);
            }
        }
        sql('DELETE FROM carreiras_moderacao WHERE usuario_id = ?', [$uid]);
        sql('DELETE FROM carreiras WHERE usuario_id = ?', [$uid]);
        sql('DELETE FROM sessoes_login WHERE usuario_id = ?', [$uid]);
        sql('DELETE FROM visitantes_usuarios WHERE usuario_id = ?', [$uid]);
        sql('DELETE FROM conquistas_usuario WHERE usuario_id = ?', [$uid]);
        sql('DELETE FROM bonus WHERE usuario_id = ?', [$uid]);
        sql('DELETE FROM indicacoes WHERE indicador_id = ?', [$uid]);
        sql('UPDATE indicacoes SET indicado_id = NULL WHERE indicado_id = ?', [$uid]);
        sql('DELETE FROM denuncias WHERE usuario_id = ?', [$uid]);
        // As visitas ficam só como estatística anônima: cada aparelho da conta ganha um vid novo, senão a
        // próxima conta criada nele herdaria esse histórico (ligarVisitante liga as visitas sem dono do vid).
        $vids = sql('SELECT DISTINCT vid FROM visitas WHERE usuario_id = ?', [$uid])->fetchAll(PDO::FETCH_COLUMN);
        foreach ($vids as $velho) {
            $novo = uuidNovo();
            sql('UPDATE eventos e JOIN visitas v ON v.sid = e.sid SET e.vid = ? WHERE v.usuario_id = ? AND v.vid = ?', [$novo, $uid, $velho]);
            sql('UPDATE visitas SET vid = ?, usuario_id = NULL WHERE usuario_id = ? AND vid = ?', [$novo, $uid, $velho]);
            sql('UPDATE partidas_vid SET vid = ? WHERE vid = ?', [$novo, $velho]);
        }
        sql('UPDATE visitas SET usuario_id = NULL WHERE usuario_id = ?', [$uid]);
        sql('DELETE FROM redefinicoes WHERE email = ?', [(string) $u['email']]);
        sql('DELETE FROM usuarios WHERE id = ?', [$uid]);
    });
}

/** Status em vigor ('ativo' | 'suspenso'): suspensão com data vencida conta como ativo. */
function statusConta(array $u): string
{
    return contaSuspensa($u) ? 'suspenso' : 'ativo';
}

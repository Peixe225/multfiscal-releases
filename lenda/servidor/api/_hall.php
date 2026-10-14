<?php
/**
 * LENDA · fotografia do Hall público (hall_foto + hall_foto_clubes). O hall.php lê só a fotografia; ela é
 * refeita no máximo a cada hall_intervalo_min (preguiçosa: o primeiro pedido depois do prazo responde com a
 * anterior e refaz logo depois da resposta, com GET_LOCK para só um refazer; os outros leem a anterior) ou na
 * hora pelo admin. Tirar do Hall (carreira
 * oculta, conta suspensa, "não aparecer") é na hora; entrar no Hall é na próxima fotografia.
 * Nunca é servido (o .htaccess nega _*.php). Contrato: servidor/CONTRATO-v3.md §4.
 */
declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/_carreiras.php';

const HALL_TRAVA = 'lenda_hall';
const HALL_ESTADO = '_hall_foto';
const HALL_LOTE = 500;

/** {em, total, ms, por} da última fotografia, ou null se nunca foi feita. */
function hallEstado(): ?array
{
    return lerEstado(HALL_ESTADO);
}

function hallIntervaloS(): int
{
    return 60 * (int) siteConfig()['hall_intervalo_min'];
}

/** A fotografia passou do prazo (ou nunca foi feita)? */
function hallVencido(?array $e): bool
{
    $em = is_array($e) ? paraTempo(str_replace(['T', 'Z'], [' ', ''], (string) ($e['em'] ?? ''))) : null;
    return $em === null || $em + hallIntervaloS() <= time();
}

/**
 * Para o hall.php: a fotografia em vigor e se ela deve ser refeita DEPOIS da resposta (venceu). Sem fotografia
 * nenhuma (a primeira vez), faz agora (esperando até 5 s se outro pedido já estiver fazendo).
 * @return array{0: ?array, 1: bool}
 */
function hallTalvez(): array
{
    $e = hallEstado();
    if ($e === null) {
        $novo = refazerFoto(false, 5);
        return [$novo ?? hallEstado(), false];
    }
    return [$e, hallVencido($e)];
}

/**
 * Refaz a fotografia. $forcar = refaz mesmo dentro do prazo (admin). $esperaS = quanto esperar pela trava.
 * Devolve o estado novo (ou o de quem acabou de refazer), ou null se outro está refazendo agora.
 */
function refazerFoto(bool $forcar, int $esperaS, string $por = 'auto'): ?array
{
    if (!pegarTrava(HALL_TRAVA, $esperaS)) {
        return null;
    }
    try {
        $e = hallEstado();
        if (!$forcar && !hallVencido($e)) {
            return $e; // outro pedido acabou de refazer
        }
        $t0 = microtime(true);
        // 1) leitura sem trava de linha (leitura consistente): quem salva carreira agora não espera.
        $ordemC = 'c.' . str_replace(', ', ', c.', ORDEM_HALL);
        $ordemS = 's.' . str_replace(', ', ', s.', ORDEM_HALL);
        $linhas = sql('SELECT t.id, t.usuario_id, t.carreira_id, t.apelido, t.jogador, t.numero, t.pais, t.posicao, t.nota,
                t.pico_ovr, t.temporadas, t.gols, t.titulos, t.bolas_ouro, t.copas, t.headline, t.clubes, t.bonus_ovr, t.terminou_em
            FROM (
                SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.carreira_id ORDER BY ' . $ordemS . ') AS rd
                FROM (
                    SELECT c.id, c.usuario_id, c.carreira_id, u.apelido, c.jogador, c.numero, c.pais, c.posicao, c.nota,
                        c.pico_ovr, c.temporadas, c.gols, c.titulos, c.bolas_ouro, c.copas, c.headline, c.clubes, c.bonus_ovr,
                        c.terminou_em, ROW_NUMBER() OVER (PARTITION BY c.usuario_id ORDER BY ' . $ordemC . ') AS rn
                    FROM carreiras c JOIN usuarios u ON u.id = c.usuario_id
                    WHERE ' . sqlCarreiraVisivel() . ' AND ' . LENDA_SQL_ATIVO . "
                      AND (u.hall_publico = 'auto' OR (u.hall_publico = 'manual' AND c.publica = 1))
                ) s WHERE s.rn <= " . LENDA_HALL_POR_CONTA . '
            ) t WHERE t.rd = 1
            ORDER BY t.' . str_replace(', ', ', t.', ORDEM_HALL))->fetchAll();
        $tLido = microtime(true);

        // 2) troca a fotografia inteira numa transação (quem lê agora vê a anterior até o fim).
        transacao(static function () use ($linhas): void {
            sql('DELETE FROM hall_foto_clubes');
            sql('DELETE FROM hall_foto');
            $pos = 0;
            foreach (array_chunk($linhas, HALL_LOTE) as $lote) {
                $vals = [];
                $params = [];
                $cvals = [];
                $cparams = [];
                foreach ($lote as $l) {
                    $pos++;
                    $vals[] = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
                    array_push($params, $pos, (int) $l['id'], (string) $l['carreira_id'], (int) $l['usuario_id'], (string) $l['apelido'],
                        (string) $l['jogador'], (int) $l['numero'], (string) $l['pais'], (string) $l['posicao'], (int) $l['nota'],
                        (int) $l['pico_ovr'], (int) $l['temporadas'], (int) $l['gols'], (int) $l['titulos'], (int) $l['bolas_ouro'],
                        (int) $l['copas'], (string) $l['headline'], $l['clubes'] ?? '[]', (int) $l['bonus_ovr'], $l['terminou_em']);
                    $clubes = json_decode((string) ($l['clubes'] ?? '[]'), true);
                    foreach (is_array($clubes) ? array_unique(array_filter($clubes, 'is_string')) : [] as $cid) {
                        if (preg_match('/^[A-Za-z0-9_-]{1,16}$/', $cid)) {
                            $cvals[] = '(?, ?)';
                            array_push($cparams, $pos, $cid);
                        }
                    }
                }
                sql('INSERT INTO hall_foto (id, carreira_pk, carreira_id, usuario_id, apelido, jogador, numero, pais, posicao_campo, nota,
                    pico_ovr, temporadas, gols, titulos, bolas_ouro, copas, headline, clubes, bonus_ovr, terminou_em) VALUES '
                    . implode(', ', $vals), $params);
                foreach (array_chunk($cvals, 2000) as $i => $pedaco) {
                    sql('INSERT INTO hall_foto_clubes (foto_id, club_id) VALUES ' . implode(', ', $pedaco),
                        array_slice($cparams, $i * 4000, count($pedaco) * 2));
                }
            }
        });
        // 3) o que saiu do Hall enquanto a leitura rodava (moderação no meio do caminho) sai de novo
        limparFotoMudancas();
        $estado = [
            'em' => gmdate('Y-m-d\TH:i:s\Z'),
            'total' => (int) umValor('SELECT COUNT(*) FROM hall_foto'),
            'ms' => (int) round((microtime(true) - $t0) * 1000),
            'msLeitura' => (int) round(($tLido - $t0) * 1000),
            'por' => $por,
        ];
        gravarSiteConfig(HALL_ESTADO, $estado, $por);
        return $estado;
    } finally {
        soltarTrava(HALL_TRAVA);
    }
}

/** Tira da fotografia o que não pode mais estar lá (carreira apagada/oculta/suspeita, conta suspensa ou fora). */
function limparFotoMudancas(): void
{
    $ids = sql('SELECT f.id FROM hall_foto f LEFT JOIN carreiras c ON c.id = f.carreira_pk LEFT JOIN usuarios u ON u.id = f.usuario_id
        WHERE c.id IS NULL OR u.id IS NULL OR c.oculta <> 0 OR c.suspeita IS NOT NULL OR u.hall_publico = \'nao\'
           OR NOT ' . LENDA_SQL_ATIVO)->fetchAll(PDO::FETCH_COLUMN);
    if ($ids) {
        tirarDoHallIds(array_map('intval', $ids));
    }
}

/** Tira da fotografia na hora (sem refazer): por carreira (carreiras.id) ou por conta. */
function tirarDoHall(?int $carreiraPk = null, ?int $uid = null): void
{
    if ($carreiraPk !== null) {
        $ids = sql('SELECT id FROM hall_foto WHERE carreira_pk = ?', [$carreiraPk])->fetchAll(PDO::FETCH_COLUMN);
    } elseif ($uid !== null) {
        $ids = sql('SELECT id FROM hall_foto WHERE usuario_id = ?', [$uid])->fetchAll(PDO::FETCH_COLUMN);
    } else {
        return;
    }
    if ($ids) {
        tirarDoHallIds(array_map('intval', $ids));
    }
}

function tirarDoHallIds(array $ids): void
{
    foreach (array_chunk($ids, 500) as $lote) {
        sql('DELETE FROM hall_foto_clubes WHERE foto_id IN (' . marcas(count($lote)) . ')', $lote);
        sql('DELETE FROM hall_foto WHERE id IN (' . marcas(count($lote)) . ')', $lote);
    }
}

/** Linha de hall_foto → item do hall.php. $posicao = posição dentro do filtro (sem filtro, a geral). */
function itemHall(array $l, int $posicao): array
{
    $clubes = json_decode((string) ($l['clubes'] ?? '[]'), true);
    return [
        'id' => (string) $l['carreira_id'],
        'posicao' => $posicao,
        'posicaoGeral' => (int) $l['id'],
        'apelido' => (string) $l['apelido'],
        'jogador' => (string) $l['jogador'],
        'numero' => (int) $l['numero'],
        'pais' => (string) $l['pais'],
        'posicaoCampo' => (string) $l['posicao_campo'],
        'nota' => (int) $l['nota'],
        'picoOvr' => (int) $l['pico_ovr'],
        'temporadas' => (int) $l['temporadas'],
        'gols' => (int) $l['gols'],
        'titulos' => (int) $l['titulos'],
        'bolasOuro' => (int) $l['bolas_ouro'],
        'copas' => (int) $l['copas'],
        'headline' => (string) $l['headline'],
        'clubes' => is_array($clubes) ? array_values(array_filter($clubes, 'is_string')) : [],
        'bonusOvr' => (int) $l['bonus_ovr'],
        'terminouEm' => iso($l['terminou_em']),
    ];
}

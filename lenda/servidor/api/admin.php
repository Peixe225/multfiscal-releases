<?php
/**
 * LENDA · administração (só admin: cookie lenda_painel ou Authorization: Bearer). Toda escrita vai para
 * admin_log. Contrato: servidor/CONTRATO-v3.md §2 (rotas, campos e erros).
 *   GET  ?r=resumo | usuarios | usuario | hall | carreira | denuncias | config | indicacoes | conquistas | log | exportar
 *   POST {"acao": "suspender" | "reativar" | "deslogar" | "renomear" | "excluir_usuario" | "dar_bonus" | "tirar_bonus"
 *        | "ocultar_carreira" | "mostrar_carreira" | "apagar_carreira" | "atualizar_hall" | "resolver_denuncia"
 *        | "recusar_indicacao" | "config", ...}
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';
require __DIR__ . '/_contas.php';
require __DIR__ . '/_bonus.php';

cabecalhos();

const POR_PAGINA = 50;

$via = exigirAdmin();

// ── ajudantes ────────────────────────────────────────────────────────────────────────────────────

function lerIdNumero(mixed $v, string $oque = 'Identificador'): int
{
    if (is_string($v) && ctype_digit($v)) {
        $v = (int) $v;
    }
    $n = inteiroOuNulo($v, 1, 4294967295);
    if ($n === null) {
        erro(400, 'id', $oque . ' inválido.');
    }
    return $n;
}

function usuarioOu404(int $id): array
{
    $u = umaLinha('SELECT * FROM usuarios WHERE id = ?', [$id]);
    if ($u === null) {
        erro(404, 'nao_encontrado', 'Usuário não encontrado.');
    }
    return $u;
}

function carreiraOu404(int $id): array
{
    $c = umaLinha('SELECT id, usuario_id, carreira_id, jogador, oculta, suspeita FROM carreiras WHERE id = ?', [$id]);
    if ($c === null) {
        erro(404, 'nao_encontrada', 'Carreira não encontrada.');
    }
    return $c;
}

/** {total, pagina, porPagina, itens}. */
function paginado(int $total, int $pagina, array $itens): array
{
    return ['total' => $total, 'pagina' => $pagina, 'porPagina' => POR_PAGINA, 'itens' => $itens];
}

/** Texto do LIKE com % e _ escapados. */
function like(string $q): string
{
    return '%' . addcslashes($q, '%_\\') . '%';
}

/** Carreira para as telas do admin (sem os dados do HallEntry). */
function itemCarreiraAdmin(array $l): array
{
    return [
        'id' => (int) $l['id'],
        'carreiraId' => (string) $l['carreira_id'],
        'usuario' => ['id' => (int) $l['usuario_id'], 'apelido' => (string) ($l['apelido'] ?? ''),
            'status' => contaSuspensa($l + ['status' => $l['u_status'] ?? 'ativo', 'suspenso_ate' => $l['u_suspenso_ate'] ?? null]) ? 'suspenso' : 'ativo'],
        'modo' => (string) $l['modo'],
        'jogador' => (string) $l['jogador'],
        'numero' => (int) $l['numero'],
        'pais' => (string) $l['pais'],
        'posicao' => (string) $l['posicao'],
        'nota' => (int) $l['nota'],
        'notaV' => $l['nota_v'] === null ? null : (int) $l['nota_v'],
        'picoOvr' => (int) $l['pico_ovr'],
        'temporadas' => (int) $l['temporadas'],
        'gols' => (int) $l['gols'],
        'titulos' => (int) $l['titulos'],
        'bolasOuro' => (int) $l['bolas_ouro'],
        'copas' => (int) $l['copas'],
        'bonusOvr' => (int) $l['bonus_ovr'],
        'headline' => (string) $l['headline'],
        'como' => (string) $l['como'],
        'publica' => (int) $l['publica'] === 1,
        'oculta' => (int) $l['oculta'],
        'suspeita' => $l['suspeita'] !== null ? (string) $l['suspeita'] : null,
        'denuncias' => (int) ($l['denuncias'] ?? 0),
        'posicaoHall' => isset($l['foto_id']) ? (int) $l['foto_id'] : null,
        'salvaEm' => iso($l['salva_em']),
        'terminouEm' => iso($l['terminou_em']),
    ];
}

const SQL_CARREIRA_ADMIN = 'SELECT c.id, c.usuario_id, c.carreira_id, c.modo, c.jogador, c.numero, c.pais, c.posicao, c.nota, c.nota_v,
    c.pico_ovr, c.temporadas, c.gols, c.titulos, c.bolas_ouro, c.copas, c.bonus_ovr, c.headline, c.como, c.publica, c.oculta,
    c.suspeita, c.salva_em, c.terminou_em, u.apelido, u.status AS u_status, u.suspenso_ate AS u_suspenso_ate, f.id AS foto_id,
    COALESCE(d.n, 0) AS denuncias';
const SQL_CARREIRA_ADMIN_DE = " FROM carreiras c JOIN usuarios u ON u.id = c.usuario_id
    LEFT JOIN hall_foto f ON f.carreira_pk = c.id
    LEFT JOIN (SELECT carreira_pk, COUNT(*) AS n FROM denuncias WHERE status = 'aberta' GROUP BY carreira_pk) d ON d.carreira_pk = c.id";

/** Fecha as denúncias abertas de uma carreira com o resultado. */
function fecharDenuncias(int $pk, string $resultado): int
{
    return sql("UPDATE denuncias SET status = ?, resolvida_em = ? WHERE carreira_pk = ? AND status = 'aberta'",
        [$resultado, dt(time()), $pk])->rowCount();
}

/** Status da conta, com as datas, para as telas. */
function statusAdmin(array $u): array
{
    $s = statusConta($u);
    return [
        'status' => $s,
        'suspensoAte' => $s === 'suspenso' ? iso($u['suspenso_ate'] ?? null) : null,
        'motivo' => $s === 'suspenso' && $u['motivo_suspensao'] !== null ? (string) $u['motivo_suspensao'] : null,
    ];
}

function celulaCsv(mixed $v): string
{
    if ($v === null) {
        return '';
    }
    if (is_int($v)) {
        return (string) $v;
    }
    $s = (string) $v;
    // Planilha não pode ver fórmula: célula que começa com = + - @ (ou tab/CR) ganha um ' na frente.
    if ($s !== '' && strpbrk($s[0], "=+-@\t\r") !== false) {
        $s = "'" . $s;
    }
    return '"' . str_replace('"', '""', $s) . '"';
}

function dataBrasilia(?string $dt): ?string
{
    $t = paraTempo($dt);
    return $t === null ? null : gmdate('Y-m-d H:i', $t - LENDA_FUSO_H * 3600);
}

// ── GET ──────────────────────────────────────────────────────────────────────────────────────────

if (metodo() === 'GET') {
    $r = is_string($_GET['r'] ?? null) ? $_GET['r'] : '';
    $pagina = paginaPedida();
    $off = ($pagina - 1) * POR_PAGINA;

    switch ($r) {
        case 'resumo':
            $hoje = diaBrasilia();
            $iniHoje = dt((int) strtotime($hoje . ' 00:00:00 UTC') + LENDA_FUSO_H * 3600);
            $u = umaLinha('SELECT COUNT(*) AS total, COALESCE(SUM(NOT ' . LENDA_SQL_ATIVO . '), 0) AS suspensos,
                COALESCE(SUM(criado_em >= ?), 0) AS hoje, COALESCE(SUM(criado_em >= ?), 0) AS semana FROM usuarios u',
                [$iniHoje, dt(time() - 7 * 86400)]);
            $c = umaLinha('SELECT COUNT(*) AS total, COALESCE(SUM(suspeita IS NOT NULL), 0) AS suspeitas, COALESCE(SUM(oculta = 1), 0) AS ocultas,
                COALESCE(SUM(oculta = 2), 0) AS denunciadas FROM carreiras');
            $ind = ['pendente' => 0, 'valida' => 0, 'recusada' => 0];
            foreach (sql('SELECT status, COUNT(*) AS n FROM indicacoes GROUP BY status') as $l) {
                $ind[$l['status']] = (int) $l['n'];
            }
            $b = umaLinha('SELECT COALESCE(SUM(usado_em IS NULL), 0) AS abertos, COALESCE(SUM(usado_em IS NOT NULL), 0) AS usados FROM bonus');
            $e = hallEstado();
            $em = $e !== null ? strtotime((string) ($e['em'] ?? '')) : false;
            responder(200, [
                'usuarios' => ['total' => (int) $u['total'], 'ativos' => (int) $u['total'] - (int) $u['suspensos'],
                    'suspensos' => (int) $u['suspensos'], 'novosHoje' => (int) $u['hoje'], 'novos7Dias' => (int) $u['semana']],
                'carreiras' => ['total' => (int) $c['total'], 'noHall' => (int) umValor('SELECT COUNT(*) FROM hall_foto'),
                    'suspeitas' => (int) $c['suspeitas'], 'ocultas' => (int) $c['ocultas'], 'ocultasPorDenuncia' => (int) $c['denunciadas']],
                'denunciasAbertas' => (int) umValor("SELECT COUNT(*) FROM denuncias WHERE status = 'aberta'"),
                'indicacoes' => ['pendentes' => $ind['pendente'], 'validas' => $ind['valida'], 'recusadas' => $ind['recusada']],
                'bonus' => ['naoUsados' => (int) $b['abertos'], 'usados' => (int) $b['usados']],
                'hall' => ['atualizadoEm' => $em !== false && $em ? gmdate('Y-m-d\TH:i:s\Z', $em) : null,
                    'proximaEm' => $em !== false && $em ? gmdate('Y-m-d\TH:i:s\Z', $em + hallIntervaloS()) : null,
                    'total' => (int) ($e['total'] ?? 0), 'ms' => (int) ($e['ms'] ?? 0)],
                'site' => sitePublico(),
            ]);

        case 'usuarios':
            $q = is_string($_GET['q'] ?? null) ? trim(mb_substr($_GET['q'], 0, 100, 'UTF-8')) : '';
            $status = $_GET['status'] ?? '';
            $ordem = $_GET['ordem'] ?? 'recentes';
            $onde = [];
            $params = [];
            if ($q !== '') {
                $o = '(u.apelido LIKE ? OR u.email LIKE ?';
                array_push($params, like($q), like(strtolower($q)));
                if (ctype_digit($q)) {
                    $o .= ' OR u.id = ?';
                    $params[] = (int) $q;
                }
                if (lerCodigoConvite($q) !== null) {
                    $o .= ' OR u.codigo_convite = ?';
                    $params[] = lerCodigoConvite($q);
                }
                $onde[] = $o . ')';
            }
            if ($status === 'ativo') {
                $onde[] = LENDA_SQL_ATIVO;
            } elseif ($status === 'suspenso') {
                $onde[] = 'NOT ' . LENDA_SQL_ATIVO;
            }
            $w = $onde ? ' WHERE ' . implode(' AND ', $onde) : '';
            $total = (int) umValor("SELECT COUNT(*) FROM usuarios u$w", $params);
            $comTempo = $ordem === 'tempo';
            $comNota = $ordem === 'nota';
            $ordemSql = match ($ordem) {
                'partidas' => 'GREATEST(u.partidas, u.partidas_conta) DESC, u.id DESC',
                'nota' => 'cm.melhor IS NULL, cm.melhor DESC, u.id DESC',
                'tempo' => 'COALESCE(tv.s, 0) DESC, u.id DESC',
                'acesso' => 'u.ultimo_acesso IS NULL, u.ultimo_acesso DESC, u.id DESC',
                default => 'u.criado_em DESC, u.id DESC',
            };
            $joins = ($comNota ? ' LEFT JOIN (SELECT usuario_id, MAX(nota) AS melhor FROM carreiras GROUP BY usuario_id) cm ON cm.usuario_id = u.id' : '')
                . ($comTempo ? ' LEFT JOIN (SELECT usuario_id, SUM(ativo_s) AS s FROM visitas WHERE usuario_id IS NOT NULL GROUP BY usuario_id) tv ON tv.usuario_id = u.id' : '');
            $linhas = sql("SELECT u.* FROM usuarios u$joins$w ORDER BY $ordemSql LIMIT " . POR_PAGINA . " OFFSET $off", $params)->fetchAll();
            $ids = array_map(static fn(array $l): int => (int) $l['id'], $linhas);
            // números da página em poucas consultas agrupadas (nada de uma por usuário)
            $car = $tempo = $indic = $bon = [];
            if ($ids) {
                $mk = marcas(count($ids));
                foreach (sql("SELECT usuario_id, COUNT(*) AS n, MAX(nota) AS melhor FROM carreiras WHERE usuario_id IN ($mk) GROUP BY usuario_id", $ids) as $l) {
                    $car[(int) $l['usuario_id']] = $l;
                }
                foreach (sql("SELECT usuario_id, SUM(ativo_s) AS s FROM visitas WHERE usuario_id IN ($mk) GROUP BY usuario_id", $ids) as $l) {
                    $tempo[(int) $l['usuario_id']] = (int) $l['s'];
                }
                foreach (sql("SELECT indicador_id, COUNT(*) AS n FROM indicacoes WHERE status = 'valida' AND indicador_id IN ($mk) GROUP BY indicador_id", $ids) as $l) {
                    $indic[(int) $l['indicador_id']] = (int) $l['n'];
                }
                foreach (sql("SELECT usuario_id, origem, COUNT(*) AS n FROM bonus WHERE usado_em IS NULL AND usuario_id IN ($mk) GROUP BY usuario_id, origem", $ids) as $l) {
                    $bon[(int) $l['usuario_id']][(string) $l['origem']] = (int) $l['n'];
                }
            }
            $itens = [];
            foreach ($linhas as $l) {
                $id = (int) $l['id'];
                $b = $bon[$id] ?? [];
                $itens[] = [
                    'id' => $id,
                    'apelido' => (string) $l['apelido'],
                    'email' => (string) $l['email'],
                    'criadoEm' => iso($l['criado_em']),
                    'ultimoAcesso' => iso($l['ultimo_acesso'] ?? $l['ultimo_login'] ?? $l['criado_em']),
                    'status' => statusConta($l),
                    'partidas' => max((int) $l['partidas'], (int) $l['partidas_conta']),
                    'carreiras' => (int) ($car[$id]['n'] ?? 0),
                    'melhorNota' => isset($car[$id]) && $car[$id]['melhor'] !== null ? (int) $car[$id]['melhor'] : null,
                    'tempoJogadoMin' => intdiv($tempo[$id] ?? 0, 60),
                    'origem' => (string) $l['origem'],
                    'indicacoes' => $indic[$id] ?? 0,
                    'bonusDisponiveis' => bonusLiberado($l) ? array_sum($b) : ($b['admin'] ?? 0),
                ];
            }
            responder(200, paginado($total, $pagina, $itens));

        case 'usuario':
            $u = usuarioOu404(lerIdNumero($_GET['id'] ?? null));
            $uid = (int) $u['id'];
            $base = usuarioJson($u);
            $noHall = idsNoHall($uid, (string) $u['hall_publico']);
            $carreiras = array_map(static function (array $l) use ($noHall): array {
                return carreiraC($l, $noHall) + ['pk' => (int) $l['id'], 'oculta' => (int) $l['oculta'],
                    'suspeita' => $l['suspeita'] !== null ? (string) $l['suspeita'] : null, 'copas' => (int) $l['copas']];
            }, sql('SELECT ' . CAMPOS_C . ' FROM carreiras WHERE usuario_id = ? ORDER BY salva_em DESC, id DESC', [$uid])->fetchAll());
            $conq = array_map(static fn(array $l): array => ['id' => (string) $l['conquista_id'], 'em' => iso($l['em'])],
                sql('SELECT conquista_id, em FROM conquistas_usuario WHERE usuario_id = ? ORDER BY em', [$uid])->fetchAll());
            $feitas = array_map(static fn(array $l): array => [
                'id' => (int) $l['id'], 'indicado' => $l['indicado_id'] !== null ? ['id' => (int) $l['indicado_id'], 'apelido' => (string) ($l['apelido'] ?? '')] : null,
                'status' => (string) $l['status'], 'motivo' => $l['motivo'], 'criadaEm' => iso($l['criada_em']), 'validadaEm' => iso($l['validada_em']),
            ], sql('SELECT i.*, x.apelido FROM indicacoes i LEFT JOIN usuarios x ON x.id = i.indicado_id WHERE i.indicador_id = ? ORDER BY i.id', [$uid])->fetchAll());
            $rec = umaLinha('SELECT i.*, x.apelido FROM indicacoes i LEFT JOIN usuarios x ON x.id = i.indicador_id WHERE i.indicado_id = ?', [$uid]);
            $lib = bonusLiberado($u);
            $bonus = array_map(static fn(array $b): array => [
                'id' => (int) $b['id'], 'valor' => (int) $b['valor'], 'origem' => (string) $b['origem'], 'ref' => $b['ref'],
                'criadoEm' => iso($b['criado_em']), 'usadoEm' => iso($b['usado_em']), 'carreiraId' => $b['carreira_id'],
                'disponivel' => $b['usado_em'] === null && ($lib || $b['origem'] === 'admin'),
            ], sql('SELECT * FROM bonus WHERE usuario_id = ? ORDER BY criado_em, id', [$uid])->fetchAll());
            $sessoes = array_map(static fn(array $s): array => ['criadaEm' => iso($s['criada_em']), 'expiraEm' => iso($s['expira_em']),
                'renovadaEm' => iso($s['renovada_em'])],
                sql('SELECT criada_em, expira_em, renovada_em FROM sessoes_login WHERE usuario_id = ? AND expira_em > ? ORDER BY criada_em DESC',
                    [$uid, dt(time())])->fetchAll());
            $visitas = array_map(static fn(array $v): array => ['inicio' => iso($v['inicio']), 'tempoS' => (int) $v['ativo_s'],
                'origem' => (string) $v['origem'], 'aparelho' => $v['dispositivo'], 'bot' => (int) $v['bot'] === 1],
                sql('SELECT inicio, ativo_s, origem, dispositivo, bot FROM visitas WHERE usuario_id = ? ORDER BY inicio DESC LIMIT 50', [$uid])->fetchAll());
            $eventos = array_map(static function (array $e): array {
                $d = is_string($e['dados']) ? json_decode($e['dados'], true) : null;
                return ['em' => iso($e['em']), 'tipo' => (string) $e['tipo'], 'modo' => $e['modo'], 'dados' => is_array($d) ? $d : null];
            }, sql('SELECT e.em, e.tipo, e.modo, e.dados FROM visitas v JOIN eventos e ON e.sid = v.sid WHERE v.usuario_id = ?
                ORDER BY e.em DESC, e.id DESC LIMIT 100', [$uid])->fetchAll());
            responder(200, ['usuario' => $base + statusAdmin($u) + [
                'partidasConta' => (int) $u['partidas_conta'],
                'bonusLiberado' => $lib,
                'carreiras' => $carreiras,
                'conquistas' => $conq,
                'indicacoes' => ['feitas' => $feitas, 'recebida' => $rec === null ? null : [
                    'id' => (int) $rec['id'], 'indicador' => ['id' => (int) $rec['indicador_id'], 'apelido' => (string) ($rec['apelido'] ?? '')],
                    'status' => (string) $rec['status'], 'motivo' => $rec['motivo'], 'criadaEm' => iso($rec['criada_em']), 'validadaEm' => iso($rec['validada_em']),
                ]],
                'bonus' => $bonus,
                'sessoes' => $sessoes,
                'visitas' => $visitas,
                'eventos' => $eventos,
                'denuncias' => ['feitas' => (int) umValor('SELECT COUNT(*) FROM denuncias WHERE usuario_id = ?', [$uid]),
                    'recebidas' => (int) umValor('SELECT COUNT(*) FROM denuncias d JOIN carreiras c ON c.id = d.carreira_pk WHERE c.usuario_id = ?', [$uid])],
            ]]);

        case 'hall':
            $filtro = $_GET['filtro'] ?? 'publicas';
            $q = is_string($_GET['q'] ?? null) ? trim(mb_substr($_GET['q'], 0, 64, 'UTF-8')) : '';
            [$onde, $ordem] = match ($filtro) {
                'ocultas' => ['c.oculta > 0', 'c.salva_em DESC, c.id DESC'],
                'suspeitas' => ['c.suspeita IS NOT NULL', 'c.salva_em DESC, c.id DESC'],
                'denunciadas' => ['d.n > 0', 'd.n DESC, c.id DESC'],
                'todas' => ['1 = 1', 'c.salva_em DESC, c.id DESC'],
                default => ['f.id IS NOT NULL', 'f.id ASC'],
            };
            $params = [];
            if ($q !== '') {
                $onde .= ' AND (c.jogador LIKE ? OR u.apelido LIKE ? OR c.carreira_id = ?)';
                array_push($params, like($q), like($q), $q);
            }
            $total = (int) umValor('SELECT COUNT(*)' . SQL_CARREIRA_ADMIN_DE . " WHERE $onde", $params);
            $itens = array_map('itemCarreiraAdmin', sql(SQL_CARREIRA_ADMIN . SQL_CARREIRA_ADMIN_DE . " WHERE $onde ORDER BY $ordem LIMIT "
                . POR_PAGINA . " OFFSET $off", $params)->fetchAll());
            $e = hallEstado();
            responder(200, paginado($total, $pagina, $itens) + ['filtro' => in_array($filtro, ['ocultas', 'suspeitas', 'denunciadas', 'todas'], true)
                ? $filtro : 'publicas', 'atualizadoEm' => $e['em'] ?? null]);

        case 'carreira':
            $id = lerIdNumero($_GET['id'] ?? null, 'Carreira');
            $l = umaLinha(SQL_CARREIRA_ADMIN . ', c.dados' . SQL_CARREIRA_ADMIN_DE . ' WHERE c.id = ?', [$id]);
            $json = $l !== null && is_string($l['dados']) ? @gzdecode($l['dados']) : false;
            if (!is_string($json) || $json === '') {
                erro(404, 'nao_encontrada', 'Carreira não encontrada.');
            }
            unset($l['dados']);
            $den = array_map(static fn(array $d): array => ['id' => (int) $d['id'], 'motivo' => (string) $d['motivo'], 'texto' => $d['texto'],
                'criadaEm' => iso($d['criada_em']), 'status' => (string) $d['status'], 'denunciante' => ['id' => (int) $d['usuario_id'],
                'apelido' => (string) ($d['apelido'] ?? '')]],
                sql('SELECT d.*, u.apelido FROM denuncias d LEFT JOIN usuarios u ON u.id = d.usuario_id WHERE d.carreira_pk = ? ORDER BY d.id DESC LIMIT 100', [$id])->fetchAll());
            responderBruto(200, '{"meta":' . json(itemCarreiraAdmin($l)) . ',"denuncias":' . json($den) . ',"carreira":' . $json . '}');

        case 'denuncias':
            $st = $_GET['status'] ?? 'abertas';
            $onde = $st === 'todas' ? '1 = 1' : "d.status = 'aberta'";
            $total = (int) umValor("SELECT COUNT(*) FROM denuncias d WHERE $onde");
            $linhas = sql("SELECT d.id, d.carreira_pk, d.usuario_id, d.motivo, d.texto, d.criada_em, d.status, d.resolvida_em,
                    x.apelido AS denunciante, c.carreira_id, c.jogador, c.nota, c.oculta, c.suspeita, c.usuario_id AS dono_id, o.apelido AS dono,
                    (SELECT COUNT(*) FROM denuncias z WHERE z.carreira_pk = d.carreira_pk AND z.status = 'aberta') AS abertas
                FROM denuncias d LEFT JOIN usuarios x ON x.id = d.usuario_id LEFT JOIN carreiras c ON c.id = d.carreira_pk
                LEFT JOIN usuarios o ON o.id = c.usuario_id WHERE $onde ORDER BY d.id DESC LIMIT " . POR_PAGINA . " OFFSET $off")->fetchAll();
            $itens = array_map(static fn(array $l): array => [
                'id' => (int) $l['id'],
                'motivo' => (string) $l['motivo'],
                'texto' => $l['texto'],
                'criadaEm' => iso($l['criada_em']),
                'status' => (string) $l['status'],
                'resolvidaEm' => iso($l['resolvida_em']),
                'denunciante' => ['id' => (int) $l['usuario_id'], 'apelido' => (string) ($l['denunciante'] ?? '')],
                'carreira' => $l['carreira_id'] === null ? null : [
                    'id' => (int) $l['carreira_pk'], 'carreiraId' => (string) $l['carreira_id'], 'jogador' => (string) $l['jogador'],
                    'nota' => (int) $l['nota'], 'oculta' => (int) $l['oculta'], 'suspeita' => $l['suspeita'],
                    'dono' => ['id' => (int) $l['dono_id'], 'apelido' => (string) ($l['dono'] ?? '')],
                ],
                'abertasNaCarreira' => (int) $l['abertas'],
            ], $linhas);
            responder(200, paginado($total, $pagina, $itens));

        case 'config':
            $atual = [];
            try {
                foreach (sql('SELECT chave, atualizado_em, atualizado_por FROM site_config WHERE chave IN (' . marcas(count(LENDA_CONFIG_CHAVES)) . ')',
                    LENDA_CONFIG_CHAVES) as $l) {
                    $atual[$l['chave']] = ['em' => iso($l['atualizado_em']), 'por' => $l['atualizado_por']];
                }
            } catch (PDOException) {
                // sem a tabela ainda
            }
            responder(200, ['valores' => siteConfig(true), 'padroes' => configPadrao(), 'atualizados' => (object) $atual]);

        case 'indicacoes':
            $st = $_GET['status'] ?? '';
            $onde = in_array($st, ['pendente', 'valida', 'recusada'], true) ? 'i.status = ?' : '1 = 1';
            $params = $onde === '1 = 1' ? [] : [$st];
            $total = (int) umValor("SELECT COUNT(*) FROM indicacoes i WHERE $onde", $params);
            $linhas = sql("SELECT i.*, a.apelido AS a_apelido, b.apelido AS b_apelido, bo.valor AS bonus_valor, bo.usado_em AS bonus_usado
                FROM indicacoes i LEFT JOIN usuarios a ON a.id = i.indicador_id LEFT JOIN usuarios b ON b.id = i.indicado_id
                LEFT JOIN bonus bo ON bo.usuario_id = i.indicador_id AND bo.origem = 'indicacao' AND bo.ref = CONCAT('indicacao:', i.id)
                WHERE $onde ORDER BY i.id DESC LIMIT " . POR_PAGINA . " OFFSET $off", $params)->fetchAll();
            $itens = array_map(static fn(array $l): array => [
                'id' => (int) $l['id'],
                'indicador' => ['id' => (int) $l['indicador_id'], 'apelido' => (string) ($l['a_apelido'] ?? '')],
                'indicado' => $l['indicado_id'] !== null ? ['id' => (int) $l['indicado_id'], 'apelido' => (string) ($l['b_apelido'] ?? '')] : null,
                'status' => (string) $l['status'],
                'motivo' => $l['motivo'],
                'criadaEm' => iso($l['criada_em']),
                'validadaEm' => iso($l['validada_em']),
                'bonus' => $l['bonus_valor'] !== null ? ['valor' => (int) $l['bonus_valor'], 'usado' => $l['bonus_usado'] !== null] : null,
            ], $linhas);
            responder(200, paginado($total, $pagina, $itens));

        case 'conquistas':
            $jog = (int) umValor('SELECT COUNT(DISTINCT cu.usuario_id) FROM conquistas_usuario cu JOIN usuarios u ON u.id = cu.usuario_id WHERE ' . LENDA_SQL_ATIVO);
            $itens = array_map(static fn(array $l): array => ['id' => (string) $l['conquista_id'], 'jogadores' => (int) $l['n'],
                'pct' => $jog > 0 ? round(100 * (int) $l['n'] / $jog, 1) : 0.0, 'primeiraEm' => iso($l['p'])],
                sql('SELECT cu.conquista_id, COUNT(*) AS n, MIN(cu.em) AS p FROM conquistas_usuario cu JOIN usuarios u ON u.id = cu.usuario_id
                    WHERE ' . LENDA_SQL_ATIVO . ' GROUP BY cu.conquista_id ORDER BY n DESC, cu.conquista_id LIMIT 2000')->fetchAll());
            responder(200, ['jogadores' => $jog, 'itens' => $itens]);

        case 'log':
            $acao = is_string($_GET['acao'] ?? null) && preg_match('/^[a-z_]{1,40}$/', $_GET['acao']) ? $_GET['acao'] : '';
            $alvo = is_string($_GET['alvo'] ?? null) ? mb_substr($_GET['alvo'], 0, 80, 'UTF-8') : '';
            $onde = [];
            $params = [];
            if ($acao !== '') {
                $onde[] = 'acao = ?';
                $params[] = $acao;
            }
            if ($alvo !== '') {
                $onde[] = 'alvo = ?';
                $params[] = $alvo;
            }
            $w = $onde ? ' WHERE ' . implode(' AND ', $onde) : '';
            $total = (int) umValor("SELECT COUNT(*) FROM admin_log$w", $params);
            $itens = array_map(static function (array $l): array {
                $d = is_string($l['detalhes']) ? json_decode($l['detalhes'], true) : null;
                return ['id' => (int) $l['id'], 'em' => iso($l['em']), 'acao' => (string) $l['acao'], 'alvo' => $l['alvo'], 'detalhes' => is_array($d) ? $d : null];
            }, sql("SELECT * FROM admin_log$w ORDER BY id DESC LIMIT " . POR_PAGINA . " OFFSET $off", $params)->fetchAll());
            responder(200, paginado($total, $pagina, $itens));

        case 'exportar':
            if (($_GET['tipo'] ?? '') !== 'usuarios') {
                erro(400, 'tipo', 'Exportação desconhecida.');
            }
            $n = (int) umValor('SELECT COUNT(*) FROM usuarios');
            registrarAdmin('exportar', 'usuarios', ['linhas' => $n]);
            while (ob_get_level() > 0) {
                ob_end_clean();
            }
            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename="lenda-usuarios-' . diaBrasilia() . '.csv"');
            header('Cache-Control: no-store');
            echo "\xEF\xBB\xBF", implode(';', ['id', 'apelido', 'e-mail', 'criado', 'último acesso', 'status', 'partidas', 'carreiras', 'origem']), "\r\n";
            $ultimo = 0;
            do {
                $lote = sql('SELECT u.id, u.apelido, u.email, u.criado_em, u.ultimo_acesso, u.ultimo_login, u.status, u.suspenso_ate,
                        GREATEST(u.partidas, u.partidas_conta) AS partidas, u.origem,
                        (SELECT COUNT(*) FROM carreiras c WHERE c.usuario_id = u.id) AS carreiras
                    FROM usuarios u WHERE u.id > ? ORDER BY u.id LIMIT 1000', [$ultimo])->fetchAll();
                foreach ($lote as $l) {
                    $ultimo = (int) $l['id'];
                    echo implode(';', array_map('celulaCsv', [(int) $l['id'], (string) $l['apelido'], (string) $l['email'],
                        dataBrasilia($l['criado_em']), dataBrasilia($l['ultimo_acesso'] ?? $l['ultimo_login']), statusConta($l),
                        (int) $l['partidas'], (int) $l['carreiras'], (string) $l['origem']])), "\r\n";
                }
                flush();
            } while (count($lote) === 1000);
            exit;
    }
    erro(400, 'rota', 'Rota desconhecida.');
}

if (metodo() !== 'POST') {
    erroMetodo();
}

// ── POST ─────────────────────────────────────────────────────────────────────────────────────────

exigirEscritaAdmin($via);
$j = lerJson(64 * 1024);
$acao = is_string($j['acao'] ?? null) ? $j['acao'] : '';

switch ($acao) {
    case 'suspender':
        $u = usuarioOu404(lerIdNumero($j['id'] ?? null));
        $uid = (int) $u['id'];
        $dias = array_key_exists('dias', $j) && $j['dias'] !== null ? inteiroOuNulo($j['dias'], 1, 3650) : null;
        if (array_key_exists('dias', $j) && $j['dias'] !== null && $dias === null) {
            erro(400, 'dias', 'Dias de suspensão: de 1 a 3650 (ou vazio para até reativar).');
        }
        $motivo = array_key_exists('motivo', $j) && $j['motivo'] !== null ? texto($j['motivo'], 200) : null;
        $ate = $dias !== null ? dt(time() + $dias * 86400) : null;
        $sessoes = transacao(static function () use ($uid, $ate, $motivo): int {
            sql("UPDATE usuarios SET status = 'suspenso', suspenso_ate = ?, motivo_suspensao = ? WHERE id = ?", [$ate, $motivo, $uid]);
            return sql('DELETE FROM sessoes_login WHERE usuario_id = ?', [$uid])->rowCount();
        });
        tirarDoHall(null, $uid);
        registrarAdmin('suspender', 'usuario:' . $uid, ['apelido' => (string) $u['apelido'], 'dias' => $dias, 'motivo' => $motivo, 'sessoes' => $sessoes]);
        responder(200, ['ok' => true, 'sessoesEncerradas' => $sessoes] + statusAdmin(usuarioOu404($uid)));

    case 'reativar':
        $u = usuarioOu404(lerIdNumero($j['id'] ?? null));
        sql("UPDATE usuarios SET status = 'ativo', suspenso_ate = NULL, motivo_suspensao = NULL WHERE id = ?", [(int) $u['id']]);
        registrarAdmin('reativar', 'usuario:' . $u['id'], ['apelido' => (string) $u['apelido']]);
        responder(200, ['ok' => true] + statusAdmin(usuarioOu404((int) $u['id'])));

    case 'deslogar':
        $u = usuarioOu404(lerIdNumero($j['id'] ?? null));
        $n = sql('DELETE FROM sessoes_login WHERE usuario_id = ?', [(int) $u['id']])->rowCount();
        registrarAdmin('deslogar', 'usuario:' . $u['id'], ['apelido' => (string) $u['apelido'], 'sessoes' => $n]);
        responder(200, ['ok' => true, 'sessoesEncerradas' => $n]);

    case 'renomear':
        $u = usuarioOu404(lerIdNumero($j['id'] ?? null));
        $novo = lerApelido($j['apelido'] ?? null, false); // o admin pode usar nome reservado (ex.: a conta oficial)
        transacao(static function () use ($u, $novo): void {
            sql('UPDATE usuarios SET apelido = ? WHERE id = ?', [$novo, (int) $u['id']]);
            sql('UPDATE hall_foto SET apelido = ? WHERE usuario_id = ?', [$novo, (int) $u['id']]);
        });
        registrarAdmin('renomear', 'usuario:' . $u['id'], ['de' => (string) $u['apelido'], 'para' => $novo]);
        responder(200, ['ok' => true, 'apelido' => $novo]);

    case 'excluir_usuario':
        $u = usuarioOu404(lerIdNumero($j['id'] ?? null));
        excluirUsuario((int) $u['id']);
        registrarAdmin('excluir_usuario', 'usuario:' . $u['id'], []); // LGPD: nada pessoal no registro
        responder(200, ['ok' => true]);

    case 'dar_bonus':
        $u = usuarioOu404(lerIdNumero($j['id'] ?? null));
        $valor = inteiroOuNulo($j['valor'] ?? null, 1, 5);
        if ($valor === null) {
            erro(400, 'valor', 'O bônus vai de +1 a +5.');
        }
        $motivo = texto($j['motivo'] ?? null, 100);
        if ($motivo === null) {
            erro(400, 'motivo', 'Escreva o motivo do bônus.');
        }
        $bid = transacao(static function () use ($u, $valor, $motivo): int {
            sql('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', [(int) $u['id']]);
            sql("INSERT INTO bonus (usuario_id, valor, origem, ref, criado_em) VALUES (?, ?, 'admin', ?, ?)", [(int) $u['id'], $valor, $motivo, dt(time())]);
            return (int) bd()->lastInsertId();
        });
        registrarAdmin('dar_bonus', 'usuario:' . $u['id'], ['apelido' => (string) $u['apelido'], 'valor' => $valor, 'motivo' => $motivo, 'bonusId' => $bid]);
        responder(200, ['ok' => true, 'bonusId' => $bid]);

    case 'tirar_bonus':
        $bidT = lerIdNumero($j['bonusId'] ?? null, 'Bônus');
        $b = umaLinha('SELECT * FROM bonus WHERE id = ?', [$bidT]);
        if ($b === null) {
            erro(404, 'nao_encontrado', 'Bônus não encontrado.');
        }
        if ($b['usado_em'] !== null) {
            erro(409, 'usado', 'Esse bônus já foi usado numa carreira e não dá para tirar.');
        }
        transacao(static function () use ($b): void {
            sql('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', [(int) $b['usuario_id']]);
            sql('DELETE FROM bonus WHERE id = ? AND usado_em IS NULL', [(int) $b['id']]);
            if ($b['origem'] === 'indicacao' && preg_match('/^indicacao:(\d+)$/', (string) $b['ref'], $mm)) {
                // tirar o bônus de uma indicação = recusar a indicação (senão ela contaria de novo)
                sql("UPDATE indicacoes SET status = 'recusada', motivo = 'admin' WHERE id = ?", [(int) $mm[1]]);
            }
        });
        registrarAdmin('tirar_bonus', 'usuario:' . $b['usuario_id'], ['bonusId' => (int) $b['id'], 'valor' => (int) $b['valor'], 'origem' => (string) $b['origem']]);
        responder(200, ['ok' => true]);

    case 'recusar_indicacao':
        $iid = lerIdNumero($j['id'] ?? null, 'Indicação');
        $ind = umaLinha('SELECT * FROM indicacoes WHERE id = ?', [$iid]);
        if ($ind === null) {
            erro(404, 'nao_encontrada', 'Indicação não encontrada.');
        }
        $tirou = transacao(static function () use ($ind): int {
            sql('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', [(int) $ind['indicador_id']]);
            sql("UPDATE indicacoes SET status = 'recusada', motivo = 'admin' WHERE id = ?", [(int) $ind['id']]);
            return sql("DELETE FROM bonus WHERE usuario_id = ? AND origem = 'indicacao' AND ref = ? AND usado_em IS NULL",
                [(int) $ind['indicador_id'], 'indicacao:' . $ind['id']])->rowCount();
        });
        registrarAdmin('recusar_indicacao', 'indicacao:' . $iid, ['indicador' => (int) $ind['indicador_id'], 'bonusTirado' => $tirou > 0]);
        responder(200, ['ok' => true, 'bonusTirado' => $tirou > 0]);

    case 'ocultar_carreira':
    case 'mostrar_carreira':
    case 'apagar_carreira':
        $c = carreiraOu404(lerIdNumero($j['id'] ?? null, 'Carreira'));
        $pk = (int) $c['id'];
        $fechadas = transacao(static function () use ($acao, $pk): int {
            if ($acao === 'ocultar_carreira') {
                sql('UPDATE carreiras SET oculta = 1 WHERE id = ?', [$pk]);
                return fecharDenuncias($pk, 'ocultar');
            }
            if ($acao === 'mostrar_carreira') {
                sql('UPDATE carreiras SET oculta = 0, suspeita = NULL WHERE id = ?', [$pk]); // libera também a suspeita
                return fecharDenuncias($pk, 'ok');
            }
            $n = sql('DELETE FROM denuncias WHERE carreira_pk = ?', [$pk])->rowCount();
            sql('DELETE FROM carreiras WHERE id = ?', [$pk]);
            return $n;
        });
        if ($acao !== 'mostrar_carreira') {
            tirarDoHall($pk);
        }
        registrarAdmin($acao, 'carreira:' . $pk, ['usuario' => (int) $c['usuario_id'], 'jogador' => (string) $c['jogador'],
            'antes' => ['oculta' => (int) $c['oculta'], 'suspeita' => $c['suspeita']], 'denunciasFechadas' => $fechadas]);
        responder(200, ['ok' => true, 'denunciasFechadas' => $fechadas]);

    case 'atualizar_hall':
        $e = refazerFoto(true, 10, 'admin');
        if ($e === null) {
            erro(409, 'ocupado', 'O Hall já está sendo atualizado. Tente de novo em alguns segundos.');
        }
        registrarAdmin('atualizar_hall', 'hall', ['total' => (int) $e['total'], 'ms' => (int) $e['ms']]);
        responder(200, ['ok' => true, 'hall' => $e + ['proximaEm' => gmdate('Y-m-d\TH:i:s\Z', (int) strtotime((string) $e['em']) + hallIntervaloS())]]);

    case 'resolver_denuncia':
        $did = lerIdNumero($j['id'] ?? null, 'Denúncia');
        $resultado = $j['resultado'] ?? null;
        if ($resultado !== 'ok' && $resultado !== 'ocultar') {
            erro(400, 'resultado', 'Resultado: ok (a carreira fica) ou ocultar.');
        }
        $d = umaLinha('SELECT id, carreira_pk FROM denuncias WHERE id = ?', [$did]);
        if ($d === null) {
            erro(404, 'nao_encontrada', 'Denúncia não encontrada.');
        }
        $pk = (int) $d['carreira_pk'];
        $fechadas = transacao(static function () use ($pk, $did, $resultado): int {
            if ($resultado === 'ocultar') {
                sql('UPDATE carreiras SET oculta = 1 WHERE id = ?', [$pk]);
            } else {
                sql('UPDATE carreiras SET oculta = 0 WHERE id = ? AND oculta = 2', [$pk]); // a que as denúncias esconderam volta
            }
            $n = fecharDenuncias($pk, $resultado);
            // a própria denúncia, mesmo se já estava fechada, fica com o resultado de agora
            sql('UPDATE denuncias SET status = ?, resolvida_em = COALESCE(resolvida_em, ?) WHERE id = ?', [$resultado, dt(time()), $did]);
            return $n;
        });
        if ($resultado === 'ocultar') {
            tirarDoHall($pk);
        }
        registrarAdmin('resolver_denuncia', 'carreira:' . $pk, ['denuncia' => $did, 'resultado' => $resultado, 'fechadas' => $fechadas]);
        responder(200, ['ok' => true, 'denunciasFechadas' => $fechadas]);

    case 'config':
        $valores = $j['valores'] ?? null;
        if (!is_array($valores) || $valores === [] || array_is_list($valores)) {
            erro(400, 'config_invalida', 'Mande os valores a gravar: {"valores": {"chave": valor}}.');
        }
        $limpos = [];
        foreach ($valores as $chave => $v) {
            $chave = (string) $chave;
            if (!in_array($chave, LENDA_CONFIG_CHAVES, true)) {
                erroCom(400, 'config_invalida', 'Chave de configuração desconhecida: ' . mb_substr($chave, 0, 40, 'UTF-8') . '.', ['chave' => mb_substr($chave, 0, 40, 'UTF-8')]);
            }
            try {
                $limpos[$chave] = normalizarConfig($chave, $v);
            } catch (InvalidArgumentException $e) {
                erroCom(400, 'config_invalida', $e->getMessage(), ['chave' => $chave]);
            }
        }
        $antes = siteConfig(true);
        transacao(static function () use ($limpos, $via): void {
            foreach ($limpos as $chave => $v) {
                gravarSiteConfig($chave, $v, $via);
            }
        });
        esquecerSiteConfig();
        $mudou = [];
        foreach ($limpos as $chave => $v) {
            $mudou[$chave] = ['de' => $antes[$chave] ?? null, 'para' => $v];
        }
        registrarAdmin('config', 'config', $mudou);
        responder(200, ['ok' => true, 'valores' => siteConfig(true)]);
}

erro(400, 'acao', 'Ação desconhecida.');

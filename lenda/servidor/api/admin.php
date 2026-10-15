<?php
/**
 * LENDA · administração (só admin: sessão do painel ou Authorization: Bearer). Toda escrita vai para admin_log.
 * Contrato: servidor/CONTRATO-v3.md §2/§8.7 e CONTRATO-v32.md §A (rotas, campos e erros da v3.2).
 *   GET  ?r=resumo | usuarios | usuario | hall | carreira | denuncias | config | indicacoes | conquistas | log | exportar
 *        | atencao | agora | lixeira | multicontas | emails | relatorio | tempo | eventos | bonus | seguranca
 *   POST {"acao": "suspender" | "reativar" | "deslogar" | "renomear" | "excluir_usuario" | "dar_bonus" | "tirar_bonus"
 *        | "tirar_bonus_lote" | "ocultar_carreira" | "mostrar_carreira" | "apagar_carreira" | "atualizar_hall"
 *        | "resolver_denuncia" | "recusar_indicacao" | "config" | "alerta_dispensar" | "alerta_reabrir" | "carreiras_lote"
 *        | "resolver_denuncias_lote" | "indicacoes_lote" | "nota" | "mudar_tipo" | "bloquear_hall" | "restaurar_carreira"
 *        | "liberar_reenvio" | "enviar_redefinicao" | "destacar_carreira" | "testar_aviso", ...}
 * Poderes: GET pede "ver" (exportar, relatório/tempo em CSV e segurança pedem o do mapa PODERES_ACAO do _admin.php);
 * cada POST pede o poder da ação no mesmo mapa (exigirAdminAcao). Tabela/coluna nova que ainda não existe (subiu os
 * arquivos e não rodou o instalar.php): 503 instalar.
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';
require __DIR__ . '/_contas.php';
require __DIR__ . '/_bonus.php';
require __DIR__ . '/_moderacao.php';
require __DIR__ . '/_atencao.php';
require __DIR__ . '/_relatorios.php';
require __DIR__ . '/_celular.php';

cabecalhos();

const POR_PAGINA = 50;

// ── ajudantes ────────────────────────────────────────────────────────────────────────────────────

/** Admin do pedido, com o poder (o _admin.php da v3.2 devolve o array; o da v3, 'painel'|'token'). */
function admin(?string $poder = null): array
{
    $a = exigirAdmin($poder);
    return is_array($a) ? $a : ['via' => $a === 'token' ? 'token' : 'painel', 'quem' => $a];
}

/** O poder que o mapa único pede para a ação (403 sem_poder, registrado como "negado"). */
function poder(string $acao): void
{
    if (function_exists('exigirAdminAcao')) {
        exigirAdminAcao($acao);
    }
}

function lerIdNumero(mixed $v, string $oque = 'Identificador'): int
{
    if (is_string($v) && ctype_digit($v) && strlen($v) <= 10) {
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

/** Texto curto de um parâmetro GET (ou ''). */
function qs(string $k, int $max = 100): string
{
    $v = $_GET[$k] ?? '';
    return is_string($v) ? trim(mb_substr($v, 0, $max, 'UTF-8')) : '';
}

/** Carreira para as telas do admin (sem os dados do HallEntry). */
function itemCarreiraAdmin(array $l): array
{
    return [
        'id' => (int) $l['id'],
        'carreiraId' => (string) $l['carreira_id'],
        'usuario' => ['id' => (int) $l['usuario_id'], 'apelido' => (string) ($l['apelido'] ?? ''),
            'status' => contaSuspensa(['status' => $l['u_status'] ?? 'ativo', 'suspenso_ate' => $l['u_suspenso_ate'] ?? null]) ? 'suspenso' : 'ativo',
            'hallBloqueado' => (int) ($l['u_hall_bloqueado'] ?? 0) === 1],
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
        'destaque' => (int) ($l['destaque'] ?? 0) === 1,
        'moderacao' => moderacaoJson($l),
    ];
}

const SQL_CARREIRA_ADMIN = 'SELECT c.id, c.usuario_id, c.carreira_id, c.modo, c.jogador, c.numero, c.pais, c.posicao, c.nota, c.nota_v,
    c.pico_ovr, c.temporadas, c.gols, c.titulos, c.bolas_ouro, c.copas, c.bonus_ovr, c.headline, c.como, c.publica, c.oculta,
    c.suspeita, c.salva_em, c.terminou_em, c.destaque, c.motivo_admin, c.moderada_em, u.apelido, u.status AS u_status,
    u.suspenso_ate AS u_suspenso_ate, u.criado_em AS u_criado_em, u.hall_bloqueado AS u_hall_bloqueado, f.id AS foto_id,
    COALESCE(d.n, 0) AS denuncias';
const SQL_CARREIRA_ADMIN_DE = " FROM carreiras c JOIN usuarios u ON u.id = c.usuario_id
    LEFT JOIN hall_foto f ON f.carreira_pk = c.id
    LEFT JOIN (SELECT carreira_pk, COUNT(*) AS n FROM denuncias WHERE status = 'aberta' GROUP BY carreira_pk) d ON d.carreira_pk = c.id";

/** Itens de carreira com os sinais (P0-3): + {sinais, seguro}. */
function itensComSinais(array $linhas): array
{
    $sinais = sinaisCarreiras($linhas);
    return array_map(static fn(array $l): array => itemCarreiraAdmin($l) + comSinais($sinais[(int) $l['id']] ?? []), $linhas);
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

/** Anotação interna: até 500 caracteres e 10 linhas, sem caracteres de controle (a quebra de linha fica). */
function lerNota(mixed $v): ?string
{
    if ($v === null) {
        return null;
    }
    if (!is_string($v)) {
        erro(400, 'texto', 'A anotação é um texto de até 500 caracteres.');
    }
    $s = str_replace(["\r\n", "\r"], "\n", $v);
    $s = (string) preg_replace('/[^\P{C}\n]+/u', ' ', $s); // controle/formatação (menos a quebra de linha) vira espaço
    $linhas = array_map(static fn(string $l): string => trim((string) preg_replace('/[^\S\n]+/u', ' ', $l)), explode("\n", $s));
    while ($linhas && end($linhas) === '') {
        array_pop($linhas);
    }
    while ($linhas && $linhas[0] === '') {
        array_shift($linhas);
    }
    $s = implode("\n", $linhas);
    if ($s === '') {
        return null;
    }
    if (mb_strlen($s, 'UTF-8') > 500 || count($linhas) > 10) {
        erro(400, 'texto', 'A anotação pode ter até 500 caracteres e 10 linhas.');
    }
    return $s;
}

function notaJson(array $u): ?array
{
    if (($u['nota_admin'] ?? null) === null) {
        return null;
    }
    $por = $u['nota_admin_por'] ?? null;
    return ['texto' => (string) $u['nota_admin'], 'em' => iso($u['nota_admin_em'] ?? null), 'por' => $por, 'porNome' => nomeDeQuem($por)];
}

/** Contagens dos filtros da lista de contas (P1-12), com cache de 60 s (APCu). */
function contagensUsuarios(): array
{
    return cacheCurto('contagens_usuarios', 60, static function (): array {
        $t = time();
        $l = umaLinha('SELECT COALESCE(SUM(' . LENDA_SQL_ATIVO . '), 0) AS ativo, COALESCE(SUM(NOT ' . LENDA_SQL_ATIVO . "), 0) AS suspenso,
            COALESCE(SUM(u.hall_bloqueado = 1), 0) AS bloqueado, COALESCE(SUM(u.hall_publico = 'nao'), 0) AS nao,
            COALESCE(SUM(u.hall_publico <> 'nao' AND u.hall_bloqueado = 0), 0) AS publico,
            COALESCE(SUM(u.nota_admin IS NOT NULL), 0) AS nota, COALESCE(SUM(u.time_coracao IS NULL), 0) AS sem_time,
            COALESCE(SUM(u.uf IS NULL), 0) AS sem_uf,
            COALESCE(SUM(u.ultimo_acesso < ? OR (u.ultimo_acesso IS NULL AND u.criado_em < ?)), 0) AS sumido FROM usuarios u",
            [dt($t - 30 * 86400), dt($t - 30 * 86400)]);
        $tipo = array_fill_keys(TIPOS_CONTA, 0);
        foreach (sql('SELECT tipo, COUNT(*) AS n FROM usuarios GROUP BY tipo') as $x) {
            $tipo[(string) $x['tipo']] = (int) $x['n'];
        }
        return [
            'status' => ['ativo' => (int) $l['ativo'], 'suspenso' => (int) $l['suspenso']],
            'tipo' => $tipo,
            'hall' => ['bloqueado' => (int) $l['bloqueado'], 'nao' => (int) $l['nao'], 'publico' => (int) $l['publico']],
            'convite' => (int) umValor('SELECT COUNT(*) FROM indicacoes WHERE indicado_id IS NOT NULL'),
            'denunciado' => (int) umValor("SELECT COUNT(DISTINCT c.usuario_id) FROM denuncias d JOIN carreiras c ON c.id = d.carreira_pk WHERE d.status = 'aberta'"),
            'sumido' => (int) $l['sumido'],
            'nota' => (int) $l['nota'],
            'sem' => ['time' => (int) $l['sem_time'], 'uf' => (int) $l['sem_uf']],
        ];
    });
}

/** Tempo de espera e de decisão (H14/A8): {esperaMaisAntigaH, mediaH, medianaH, decididas30d}. */
function temposDecisao(?string $maisAntiga, array $duracoesS): array
{
    sort($duracoesS);
    $n = count($duracoesS);
    $mediana = $n === 0 ? null : ($n % 2 === 1 ? $duracoesS[intdiv($n, 2)] : ($duracoesS[$n / 2 - 1] + $duracoesS[$n / 2]) / 2);
    $t = paraTempo($maisAntiga);
    return [
        'esperaMaisAntigaH' => $t === null ? null : round((time() - $t) / 3600, 1),
        'mediaH' => $n === 0 ? null : round(array_sum($duracoesS) / $n / 3600, 1),
        'medianaH' => $mediana === null ? null : round($mediana / 3600, 1),
        'decididas30d' => $n,
    ];
}

// ── GET ──────────────────────────────────────────────────────────────────────────────────────────

/** As rotas GET. Cada uma responde e termina. */
function rotasGet(): never
{
    $r = is_string($_GET['r'] ?? null) ? $_GET['r'] : '';
    $pagina = paginaPedida();
    $off = ($pagina - 1) * POR_PAGINA;

    switch ($r) {
        case 'resumo':
            $t = time();
            $iniHoje = inicioHojeUtc();
            $u = umaLinha('SELECT COUNT(*) AS total, COALESCE(SUM(NOT ' . LENDA_SQL_ATIVO . '), 0) AS suspensos,
                COALESCE(SUM(criado_em >= ?), 0) AS hoje, COALESCE(SUM(criado_em >= ?), 0) AS semana,
                COALESCE(SUM(ultimo_acesso >= ?), 0) AS ativos7, COALESCE(SUM(ultimo_acesso >= ?), 0) AS ativos30,
                COALESCE(SUM(partidas_conta = 0 AND partidas = 0), 0) AS nunca, COALESCE(SUM(hall_bloqueado = 1), 0) AS bloq,
                COALESCE(SUM(hall_publico = \'nao\'), 0) AS nao, COALESCE(SUM(time_coracao IS NULL), 0) AS sem_time,
                COALESCE(SUM(uf IS NULL), 0) AS sem_uf, COALESCE(SUM(nota_admin IS NOT NULL), 0) AS com_nota FROM usuarios u',
                [$iniHoje, dt($t - 7 * 86400), dt($t - 7 * 86400), dt($t - 30 * 86400)]);
            $porTipo = array_fill_keys(TIPOS_CONTA, 0);
            foreach (sql('SELECT tipo, COUNT(*) AS n FROM usuarios GROUP BY tipo') as $l) {
                $porTipo[(string) $l['tipo']] = (int) $l['n'];
            }
            // rev3: "suspeitas" = o mesmo do pulso e do filtro do Hall (as já escondidas pelo admin contam em "ocultas")
            $c = umaLinha("SELECT COUNT(*) AS total, COALESCE(SUM(suspeita IS NOT NULL AND oculta = 0), 0) AS suspeitas, COALESCE(SUM(oculta = 1), 0) AS ocultas,
                COALESCE(SUM(oculta = 2), 0) AS denunciadas, COALESCE(SUM(suspeita = 'revisao'), 0) AS revisao,
                COALESCE(SUM(destaque = 1), 0) AS destaques FROM carreiras");
            $ind = ['pendente' => 0, 'valida' => 0, 'recusada' => 0];
            foreach (sql('SELECT status, COUNT(*) AS n FROM indicacoes GROUP BY status') as $l) {
                $ind[$l['status']] = (int) $l['n'];
            }
            $b = umaLinha('SELECT COALESCE(SUM(usado_em IS NULL), 0) AS abertos, COALESCE(SUM(usado_em IS NOT NULL), 0) AS usados FROM bonus');
            $e = hallEstado();
            $em = $e !== null ? strtotime((string) ($e['em'] ?? '')) : false;
            $mes = dt($t - 30 * 86400);
            $durDen = array_map('intval', sql("SELECT TIMESTAMPDIFF(SECOND, criada_em, resolvida_em) FROM denuncias
                WHERE status <> 'aberta' AND resolvida_em >= ? AND resolvida_em >= criada_em LIMIT 5000", [$mes])->fetchAll(PDO::FETCH_COLUMN));
            $durInd = array_map('intval', sql("SELECT TIMESTAMPDIFF(SECOND, criada_em, validada_em) FROM indicacoes
                WHERE status <> 'pendente' AND validada_em >= ? AND validada_em >= criada_em LIMIT 5000", [$mes])->fetchAll(PDO::FETCH_COLUMN));
            $multi = lerEstado(MULTICONTAS_ESTADO);
            responder(200, [
                'usuarios' => ['total' => (int) $u['total'], 'ativos' => (int) $u['total'] - (int) $u['suspensos'],
                    'suspensos' => (int) $u['suspensos'], 'novosHoje' => (int) $u['hoje'], 'novos7Dias' => (int) $u['semana'],
                    'ativos7' => (int) $u['ativos7'], 'ativos30' => (int) $u['ativos30'], 'nuncaJogaram' => (int) $u['nunca'], 'porTipo' => $porTipo],
                'carreiras' => ['total' => (int) $c['total'], 'noHall' => (int) umValor('SELECT COUNT(*) FROM hall_foto'),
                    'suspeitas' => (int) $c['suspeitas'], 'ocultas' => (int) $c['ocultas'], 'ocultasPorDenuncia' => (int) $c['denunciadas'],
                    'emRevisao' => (int) $c['revisao'], 'revisaoNota' => notaRevisao(), 'destaques' => (int) $c['destaques'],
                    'lixeira' => (int) umValor('SELECT COUNT(*) FROM lixeira_carreiras')],
                'denunciasAbertas' => (int) umValor("SELECT COUNT(*) FROM denuncias WHERE status = 'aberta'"),
                'indicacoes' => ['pendentes' => $ind['pendente'], 'validas' => $ind['valida'], 'recusadas' => $ind['recusada']],
                'bonus' => ['naoUsados' => (int) $b['abertos'], 'usados' => (int) $b['usados']],
                'hall' => ['atualizadoEm' => $em !== false && $em ? gmdate('Y-m-d\TH:i:s\Z', $em) : null,
                    'proximaEm' => $em !== false && $em ? gmdate('Y-m-d\TH:i:s\Z', $em + hallIntervaloS()) : null,
                    'total' => (int) ($e['total'] ?? 0), 'ms' => (int) ($e['ms'] ?? 0)],
                'site' => sitePublico(),
                // e-mails de troca de senha que o teto do site (40 a cada 10 min, 300 por dia) não deixou sair
                'emailsBarrados' => ['total' => (int) (lerEstado('_esqueci_teto')['n'] ?? 0), 'ultimoEm' => lerEstado('_esqueci_teto')['em'] ?? null],
                // H14/A8: quanto a fila espera e quanto demora para decidir (últimos 30 dias)
                'moderacao' => temposDecisao((string) umValor("SELECT MIN(criada_em) FROM denuncias WHERE status = 'aberta'"), $durDen),
                'moderacaoIndicacoes' => temposDecisao((string) umValor("SELECT MIN(criada_em) FROM indicacoes WHERE status = 'pendente'"), $durInd),
                // A10: saúde da base (cada número abre a lista filtrada)
                'base' => ['suspensas' => (int) $u['suspensos'], 'foraDoHall' => (int) $u['bloq'], 'naoAparecem' => (int) $u['nao'],
                    'multicontas' => is_array($multi['grupos'] ?? null) ? count($multi['grupos']) : null,
                    'multicontasEm' => is_int($multi['em'] ?? null) ? gmdate('Y-m-d\TH:i:s\Z', $multi['em']) : null,
                    'semTime' => (int) $u['sem_time'], 'semUf' => (int) $u['sem_uf'], 'comNota' => (int) $u['com_nota'],
                    'testers' => $porTipo['tester'] ?? 0],
            ]);

        case 'usuarios':
            $q = qs('q');
            $status = qs('status', 10);
            $ordem = qs('ordem', 10) ?: 'recentes';
            $tipo = qs('tipo', 10);
            $hall = qs('hall', 10);
            $onde = [];
            $params = [];
            if ($q !== '') {
                $o = '(u.apelido LIKE ? OR u.email LIKE ?';
                array_push($params, like($q), like(strtolower($q)));
                if (ctype_digit(ltrim($q, '#')) && strlen(ltrim($q, '#')) <= 10) {
                    $o .= ' OR u.id = ?';
                    $params[] = (int) ltrim($q, '#');
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
            if (in_array($tipo, TIPOS_CONTA, true)) {
                $onde[] = 'u.tipo = ?';
                $params[] = $tipo;
            }
            if ($hall === 'bloqueado') {
                $onde[] = 'u.hall_bloqueado = 1';
            } elseif ($hall === 'nao') {
                $onde[] = "u.hall_publico = 'nao'";
            } elseif ($hall === 'publico') {
                $onde[] = "u.hall_publico <> 'nao' AND u.hall_bloqueado = 0";
            }
            if (($_GET['convite'] ?? '') === '1') {
                $onde[] = 'EXISTS (SELECT 1 FROM indicacoes i WHERE i.indicado_id = u.id)';
            }
            if (($_GET['denunciado'] ?? '') === '1') {
                $onde[] = "EXISTS (SELECT 1 FROM denuncias d JOIN carreiras c ON c.id = d.carreira_pk WHERE c.usuario_id = u.id AND d.status = 'aberta')";
            }
            $sumido = qs('sumido', 4);
            if ($sumido !== '' && ctype_digit($sumido) && (int) $sumido >= 1 && (int) $sumido <= 3650) {
                $limite = dt(time() - (int) $sumido * 86400);
                $onde[] = '(u.ultimo_acesso < ? OR (u.ultimo_acesso IS NULL AND u.criado_em < ?))';
                array_push($params, $limite, $limite);
            }
            if (($_GET['nota'] ?? '') === '1') {
                $onde[] = 'u.nota_admin IS NOT NULL';
            }
            $sem = qs('sem', 6);
            if ($sem === 'time') {
                $onde[] = 'u.time_coracao IS NULL';
            } elseif ($sem === 'uf') {
                $onde[] = 'u.uf IS NULL';
            }
            $w = $onde ? ' WHERE ' . implode(' AND ', $onde) : '';
            $total = (int) umValor("SELECT COUNT(*) FROM usuarios u$w", $params);
            $comTempo = $ordem === 'tempo';
            $comNota = $ordem === 'nota';
            $ordemSql = match ($ordem) {
                'partidas' => 'GREATEST(u.partidas, u.partidas_conta) DESC, u.id DESC',
                'nota' => 'cm.melhor IS NULL, cm.melhor DESC, u.id DESC',
                'tempo' => 'COALESCE(tv.s, 0) DESC, u.id DESC',
                // DESC já põe as contas sem acesso (NULL) no fim e deixa o índice ix_usuarios_acesso servir
                'acesso' => 'u.ultimo_acesso DESC, u.id DESC',
                default => 'u.criado_em DESC, u.id DESC',
            };
            // lista sem filtro: o índice da ordem (sem filesort mesmo com poucas contas; com muitas o MySQL já escolheria)
            $forcar = $w === '' ? match ($ordem) {
                'acesso' => ' FORCE INDEX FOR ORDER BY (ix_usuarios_acesso)',
                'recentes' => ' FORCE INDEX FOR ORDER BY (ix_usuarios_criado)',
                default => '',
            } : '';
            $joins = $forcar . ($comNota ? ' LEFT JOIN (SELECT usuario_id, MAX(nota) AS melhor FROM carreiras GROUP BY usuario_id) cm ON cm.usuario_id = u.id' : '')
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
                    'tipo' => (string) ($l['tipo'] ?? 'jogador'),
                    'tipoEm' => iso($l['tipo_em'] ?? null),
                    'hallBloqueado' => (int) ($l['hall_bloqueado'] ?? 0) === 1,
                    'temNota' => ($l['nota_admin'] ?? null) !== null,
                ];
            }
            responder(200, paginado($total, $pagina, $itens) + ['contagens' => contagensUsuarios()]);

        case 'usuario':
            $u = usuarioOu404(lerIdNumero($_GET['id'] ?? null));
            $uid = (int) $u['id'];
            $base = usuarioJson($u);
            $noHall = idsNoHall($uid, (string) $u['hall_publico']);
            $carreiras = array_map(static function (array $l) use ($noHall, $u): array {
                return carreiraC($l, $noHall, $u) + ['pk' => (int) $l['id'], 'oculta' => (int) $l['oculta'],
                    'suspeita' => $l['suspeita'] !== null ? (string) $l['suspeita'] : null, 'copas' => (int) $l['copas'],
                    'destaque' => (int) $l['destaque'] === 1, 'moderacao' => moderacaoJson($l)];
            }, sql('SELECT ' . CAMPOS_C . ', destaque, motivo_admin, moderada_em FROM carreiras WHERE usuario_id = ? ORDER BY salva_em DESC, id DESC', [$uid])->fetchAll());
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
            // P1-9: outras contas que usaram o mesmo aparelho
            $mesmo = array_map(static fn(array $l): array => ['id' => (int) $l['id'], 'apelido' => (string) $l['apelido']],
                sql('SELECT DISTINCT x.id, x.apelido FROM visitas a JOIN visitas b ON b.vid = a.vid JOIN usuarios x ON x.id = b.usuario_id
                    WHERE a.usuario_id = ? AND b.usuario_id <> ? ORDER BY x.id LIMIT 20', [$uid, $uid])->fetchAll());
            // U9: tempo desta semana (desde segunda, Brasília), da semana passada e total; tempo jogando por modo
            $seg = inicioSemanaBrasilia();
            $tp = umaLinha('SELECT COALESCE(SUM(ativo_s), 0) AS total, COALESCE(SUM(CASE WHEN inicio >= ? THEN ativo_s END), 0) AS semana,
                COALESCE(SUM(CASE WHEN inicio >= ? AND inicio < ? THEN ativo_s END), 0) AS passada FROM visitas WHERE usuario_id = ?',
                [dt($seg), dt($seg - 7 * 86400), dt($seg), $uid]);
            // rev3: por modo pelas colunas jogando_<modo>_s (uma sessão com Clássico e Imersivo divide o tempo)
            $pm = umaLinha('SELECT COALESCE(SUM(v.jogando_s), 0) AS j, COALESCE(SUM(' . sqlJogandoModo('classico') . '), 0) AS classico,
                COALESCE(SUM(' . sqlJogandoModo('imersivo') . '), 0) AS imersivo, COALESCE(SUM(' . sqlJogandoModo('live') . '), 0) AS live
                FROM visitas v WHERE v.usuario_id = ?', [$uid]);
            $porModo = [];
            foreach (['classico', 'imersivo', 'live'] as $mm) {
                if ((int) $pm[$mm] > 0) {
                    $porModo[$mm] = (int) $pm[$mm];
                }
            }
            $outroS = (int) $pm['j'] - (int) $pm['classico'] - (int) $pm['imersivo'] - (int) $pm['live'];
            if ($outroS > 0) {
                $porModo['outro'] = $outroS;
            }
            // U15: por que esta conta não entra? (nunca pede nem testa a senha do jogador)
            $tentativas = lerLimite('entrar-e', quemEmail((string) $u['email']));
            $redef = umaLinha('SELECT expira_em, tentativas FROM redefinicoes WHERE email = ? AND expira_em > ?', [(string) $u['email'], dt(time())]);
            $lixeira = itensLixeira(sql('SELECT ' . CAMPOS_LIXEIRA . ' FROM lixeira_carreiras l
                WHERE l.usuario_id = ? ORDER BY l.expira_em DESC, l.id DESC LIMIT 50', [$uid])->fetchAll());
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
                'tipo' => (string) ($u['tipo'] ?? 'jogador'),
                'tipoEm' => iso($u['tipo_em']),
                'hallBloqueado' => (int) $u['hall_bloqueado'] === 1,
                'notaAdmin' => notaJson($u),
                'avisoPendente' => $u['aviso_conta'] !== null ? ['texto' => (string) $u['aviso_conta'], 'em' => iso($u['aviso_conta_em'])] : null,
                'mesmoAparelho' => $mesmo,
                'tempo' => ['semana' => (int) $tp['semana'], 'semanaPassada' => (int) $tp['passada'], 'total' => (int) $tp['total'], 'porModo' => (object) $porModo],
                'acesso' => [
                    'status' => statusConta($u),
                    'suspensoAte' => statusConta($u) === 'suspenso' ? iso($u['suspenso_ate']) : null,
                    'sessoes' => count($sessoes),
                    'ultimoLogin' => iso($u['ultimo_login']),
                    'bloqueioEntrar' => ['tentativas' => $tentativas, 'limite' => 5, 'bloqueado' => $tentativas >= 5],
                    'redefinicaoPendente' => $redef === null ? null : ['expiraEm' => iso($redef['expira_em']), 'tentativas' => (int) $redef['tentativas']],
                ],
                'lixeira' => $lixeira,
            ]]);

        case 'hall':
            $filtro = qs('filtro', 12) ?: 'publicas';
            $q = qs('q', 64);
            [$onde, $ordem] = match ($filtro) {
                'ocultas' => ['c.oculta > 0', 'c.salva_em DESC, c.id DESC'],
                // rev3: a mesma condição do pulso, do alerta e da marca da fila (as já escondidas ficam em "ocultas")
                'suspeitas' => ['c.suspeita IS NOT NULL AND c.oculta = 0', 'c.salva_em DESC, c.id DESC'],
                'revisao' => ["c.suspeita = 'revisao'", 'c.nota DESC, c.id ASC'],
                'denunciadas' => ['(d.n > 0 OR c.oculta = 2)', 'd.n DESC, c.id DESC'],
                'destaques' => ['c.destaque = 1', 'c.nota DESC, c.id ASC'],
                'todas' => ['1 = 1', 'c.salva_em DESC, c.id DESC'],
                default => ['f.id IS NOT NULL', 'f.id ASC'],
            };
            $params = [];
            if ($q !== '') {
                $onde .= ' AND (c.jogador LIKE ? OR u.apelido LIKE ? OR c.carreira_id = ?)';
                array_push($params, like($q), like($q), $q);
            }
            $total = (int) umValor('SELECT COUNT(*)' . SQL_CARREIRA_ADMIN_DE . " WHERE $onde", $params);
            $linhas = sql(SQL_CARREIRA_ADMIN . SQL_CARREIRA_ADMIN_DE . " WHERE $onde ORDER BY $ordem LIMIT " . POR_PAGINA . " OFFSET $off", $params)->fetchAll();
            $e = hallEstado();
            responder(200, paginado($total, $pagina, itensComSinais($linhas)) + ['filtro' => in_array($filtro,
                ['ocultas', 'suspeitas', 'revisao', 'denunciadas', 'destaques', 'todas'], true) ? $filtro : 'publicas', 'atualizadoEm' => $e['em'] ?? null]);

        case 'carreira':
            // X4: o admin abre qualquer carreira no jogo (#/resumo?id=<carreiras.id>&de=admin), também pelo HallEntry.id
            if (isset($_GET['carreiraId'])) {
                $cid = qs('carreiraId', 64);
                $id = (int) umValor('SELECT id FROM carreiras WHERE carreira_id = ? ORDER BY id LIMIT 1', [$cid]);
                if ($id === 0) {
                    erro(404, 'nao_encontrada', 'Carreira não encontrada.');
                }
            } else {
                $id = lerIdNumero($_GET['id'] ?? null, 'Carreira');
            }
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
            responderBruto(200, '{"meta":' . json(itensComSinais([$l])[0]) . ',"denuncias":' . json($den) . ',"carreira":' . $json . '}');

        case 'denuncias':
            $st = qs('status', 10) ?: 'abertas';
            $onde = $st === 'todas' ? '1 = 1' : "d.status = 'aberta'";
            // as abertas pela ordem do ix_denuncias_status (status, criada_em); todas, pela chave (mesma ordem de chegada)
            [$deD, $ordemD] = $st === 'todas' ? ['denuncias d', 'd.id DESC'] : ['denuncias d FORCE INDEX (ix_denuncias_status)', 'd.criada_em DESC, d.id DESC'];
            $total = (int) umValor("SELECT COUNT(*) FROM denuncias d WHERE $onde");
            $linhas = sql("SELECT d.id, d.carreira_pk, d.usuario_id, d.motivo, d.texto, d.criada_em, d.status, d.resolvida_em,
                    x.apelido AS denunciante, c.carreira_id, c.jogador, c.nota, c.oculta, c.suspeita, c.usuario_id AS dono_id, o.apelido AS dono,
                    o.criado_em AS u_criado_em, o.status AS u_status, o.suspenso_ate AS u_suspenso_ate, f.id AS foto_id,
                    (SELECT COUNT(*) FROM denuncias z WHERE z.carreira_pk = d.carreira_pk AND z.status = 'aberta') AS abertas
                FROM $deD LEFT JOIN usuarios x ON x.id = d.usuario_id LEFT JOIN carreiras c ON c.id = d.carreira_pk
                LEFT JOIN usuarios o ON o.id = c.usuario_id LEFT JOIN hall_foto f ON f.carreira_pk = c.id
                WHERE $onde ORDER BY $ordemD LIMIT " . POR_PAGINA . " OFFSET $off")->fetchAll();
            $comCarreira = array_values(array_filter(array_map(static fn(array $l): ?array => $l['carreira_id'] === null ? null
                : ['id' => (int) $l['carreira_pk'], 'usuario_id' => (int) $l['dono_id']] + $l, $linhas)));
            $sinais = sinaisCarreiras($comCarreira);
            $massa = denunciasRecentesDe(array_map(static fn(array $l): int => (int) $l['usuario_id'], $linhas));
            $itens = array_map(static function (array $l) use ($sinais, $massa): array {
                $s = $l['carreira_id'] === null ? [] : ($sinais[(int) $l['carreira_pk']] ?? []);
                if (($massa[(int) $l['usuario_id']] ?? 0) >= 5) {
                    $s[] = sinal('leve', 'denunciante_em_massa', 'Quem denunciou fez ' . $massa[(int) $l['usuario_id']] . ' denúncias em 24 h');
                }
                return [
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
                        'posicaoHall' => $l['foto_id'] !== null ? (int) $l['foto_id'] : null,
                    ],
                    'abertasNaCarreira' => (int) $l['abertas'],
                ] + comSinais($s);
            }, $linhas);
            responder(200, paginado($total, $pagina, $itens));

        case 'config':
            $atual = [];
            try {
                foreach (sql('SELECT chave, atualizado_em, atualizado_por FROM site_config WHERE chave IN (' . marcas(count(LENDA_CONFIG_CHAVES)) . ')',
                    LENDA_CONFIG_CHAVES) as $l) {
                    $atual[$l['chave']] = ['em' => iso($l['atualizado_em']), 'por' => $l['atualizado_por'], 'porNome' => nomeDeQuem($l['atualizado_por'])];
                }
            } catch (PDOException) {
                // sem a tabela ainda
            }
            $can = canaisCelular();
            responder(200, ['valores' => siteConfigPainel(true), 'padroes' => configPadrao(), 'atualizados' => (object) $atual,
                // O6: só se o canal está configurado no arquivo de config (nunca o destino)
                'celular' => ['ntfy' => $can['ntfy'] !== null, 'telegram' => $can['telegram'] !== null]]);

        case 'indicacoes':
            $st = qs('status', 10);
            $onde = ['1 = 1'];
            $params = [];
            if (in_array($st, ['pendente', 'valida', 'recusada'], true)) {
                $onde[] = 'i.status = ?';
                $params[] = $st;
            } elseif ($st === 'suspeitas') {
                // com sinal grave: indicador e indicado no mesmo aparelho, ou indicador com 5+ indicações em 24 h
                $onde[] = "i.status <> 'recusada' AND (EXISTS (SELECT 1 FROM visitas va JOIN visitas vb ON vb.vid = va.vid
                    WHERE va.usuario_id = i.indicador_id AND vb.usuario_id = i.indicado_id)
                    OR (SELECT COUNT(*) FROM indicacoes j WHERE j.indicador_id = i.indicador_id AND j.criada_em >= ?) >= 5)";
                $params[] = dt(time() - 86400);
            }
            $indicador = qs('indicador', 10);
            if ($indicador !== '' && ctype_digit($indicador)) {
                $onde[] = 'i.indicador_id = ?';
                $params[] = (int) $indicador;
            }
            $w = implode(' AND ', $onde);
            $total = (int) umValor("SELECT COUNT(*) FROM indicacoes i WHERE $w", $params);
            $linhas = sql("SELECT i.*, a.apelido AS a_apelido, b.apelido AS b_apelido, b.criado_em AS b_criado_em, b.partidas_conta AS b_partidas_conta,
                    bo.valor AS bonus_valor, bo.usado_em AS bonus_usado
                FROM indicacoes i LEFT JOIN usuarios a ON a.id = i.indicador_id LEFT JOIN usuarios b ON b.id = i.indicado_id
                LEFT JOIN bonus bo ON bo.usuario_id = i.indicador_id AND bo.origem = 'indicacao' AND bo.ref = CONCAT('indicacao:', i.id)
                WHERE $w ORDER BY i.criada_em DESC, i.id DESC LIMIT " . POR_PAGINA . " OFFSET $off", $params)->fetchAll();
            $sinais = sinaisIndicacoes($linhas);
            $itens = array_map(static fn(array $l): array => [
                'id' => (int) $l['id'],
                'indicador' => ['id' => (int) $l['indicador_id'], 'apelido' => (string) ($l['a_apelido'] ?? '')],
                'indicado' => $l['indicado_id'] !== null ? ['id' => (int) $l['indicado_id'], 'apelido' => (string) ($l['b_apelido'] ?? '')] : null,
                'status' => (string) $l['status'],
                'motivo' => $l['motivo'],
                'criadaEm' => iso($l['criada_em']),
                'validadaEm' => iso($l['validada_em']),
                'bonus' => $l['bonus_valor'] !== null ? ['valor' => (int) $l['bonus_valor'], 'usado' => $l['bonus_usado'] !== null] : null,
            ] + comSinais($sinais[(int) $l['id']] ?? []), $linhas);
            responder(200, paginado($total, $pagina, $itens) + ['status' => $st !== '' ? $st : null]);

        case 'conquistas':
            $jog = (int) umValor('SELECT COUNT(DISTINCT cu.usuario_id) FROM conquistas_usuario cu JOIN usuarios u ON u.id = cu.usuario_id WHERE ' . LENDA_SQL_ATIVO);
            $itens = array_map(static fn(array $l): array => ['id' => (string) $l['conquista_id'], 'jogadores' => (int) $l['n'],
                'pct' => $jog > 0 ? round(100 * (int) $l['n'] / $jog, 1) : 0.0, 'primeiraEm' => iso($l['p'])],
                sql('SELECT cu.conquista_id, COUNT(*) AS n, MIN(cu.em) AS p FROM conquistas_usuario cu JOIN usuarios u ON u.id = cu.usuario_id
                    WHERE ' . LENDA_SQL_ATIVO . ' GROUP BY cu.conquista_id ORDER BY n DESC, cu.conquista_id LIMIT 2000')->fetchAll());
            responder(200, ['jogadores' => $jog, 'itens' => $itens]);

        case 'log':
            $acao = is_string($_GET['acao'] ?? null) && preg_match('/^[a-z_]{1,40}$/', $_GET['acao']) ? $_GET['acao'] : '';
            $alvo = qs('alvo', 80);
            $quem = qs('quem', 20);
            $q = qs('q', 60);
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
            if ($quem !== '') {
                $onde[] = 'quem = ?';
                $params[] = $quem;
            }
            if ($q !== '') {
                $onde[] = 'detalhes LIKE ?';
                $params[] = like($q);
            }
            foreach (['de' => '>=', 'ate' => '<'] as $k => $op) {
                $d = qs($k, 10);
                if ($d !== '' && preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $d, $p) && checkdate((int) $p[2], (int) $p[3], (int) $p[1])) {
                    $onde[] = "em $op ?";
                    $params[] = dt((int) strtotime($d . ' 00:00:00 UTC') + LENDA_FUSO_H * 3600 + ($k === 'ate' ? 86400 : 0));
                }
            }
            $w = $onde ? ' WHERE ' . implode(' AND ', $onde) : '';
            $total = (int) umValor("SELECT COUNT(*) FROM admin_log$w", $params);
            $forcar = $w === '' ? ' FORCE INDEX FOR ORDER BY (ix_admin_log_em)' : '';
            $linhas = sql("SELECT * FROM admin_log$forcar$w ORDER BY em DESC, id DESC LIMIT " . POR_PAGINA . " OFFSET $off", $params)->fetchAll();
            $nomes = function_exists('nomesQuem') ? nomesQuem(array_values(array_unique(array_filter(array_column($linhas, 'quem'), 'is_string')))) : [];
            $itens = array_map(static function (array $l) use ($nomes): array {
                if (function_exists('itemRegistroAdmin')) {
                    return itemRegistroAdmin($l, $nomes);
                }
                $d = is_string($l['detalhes']) ? json_decode($l['detalhes'], true) : null;
                return ['id' => (int) $l['id'], 'em' => iso($l['em']), 'acao' => (string) $l['acao'], 'alvo' => $l['alvo'],
                    'quem' => isset($l['quem']) ? ['codigo' => $l['quem'], 'nome' => nomeDeQuem($l['quem'])] : null,
                    'ipDia' => isset($l['ip_dia']) ? substr((string) $l['ip_dia'], 0, 6) : null, 'grave' => false, 'detalhes' => is_array($d) ? $d : null];
            }, $linhas);
            $resp = paginado($total, $pagina, $itens);
            $porDia = qs('porDia', 3);
            if ($porDia !== '' && ctype_digit($porDia) && (int) $porDia >= 1 && (int) $porDia <= 90) {
                // A9: ações do admin por dia (Brasília), sem as de entrar/sair do painel
                $n = (int) $porDia;
                $hoje = (int) strtotime(diaBrasilia() . ' 00:00:00 UTC');
                $dias = [];
                for ($i = $n - 1; $i >= 0; $i--) {
                    $dias[gmdate('Y-m-d', $hoje - $i * 86400)] = 0;
                }
                $seg = function_exists('nomesQuem') ? LENDA_ACOES_SEGURANCA : ['painel_entrar', 'painel_sair', 'painel_falha', 'painel_limite', 'negado'];
                foreach (sql('SELECT DATE(em - INTERVAL ' . LENDA_FUSO_H . ' HOUR) AS d, COUNT(*) AS n FROM admin_log WHERE em >= ? AND acao NOT IN ('
                    . marcas(count($seg)) . ') GROUP BY d', array_merge([dt($hoje - ($n - 1) * 86400 + LENDA_FUSO_H * 3600)], $seg)) as $l) {
                    if (isset($dias[$l['d']])) {
                        $dias[$l['d']] = (int) $l['n'];
                    }
                }
                $resp['porDia'] = array_map(static fn(string $d, int $v): array => ['dia' => $d, 'n' => $v], array_keys($dias), $dias);
            }
            responder(200, $resp);

        case 'exportar':
            poder('exportar');
            if (($_GET['tipo'] ?? '') !== 'usuarios') {
                erro(400, 'tipo', 'Exportação desconhecida.');
            }
            $n = (int) umValor('SELECT COUNT(*) FROM usuarios');
            registrarAdmin('exportar', 'usuarios', ['linhas' => $n]);
            comecarCsv('lenda-usuarios-' . diaBrasilia() . '.csv', ['id', 'apelido', 'e-mail', 'criado', 'último acesso', 'status', 'partidas', 'carreiras', 'origem']);
            $ultimo = 0;
            do {
                $lote = sql('SELECT u.id, u.apelido, u.email, u.criado_em, u.ultimo_acesso, u.ultimo_login, u.status, u.suspenso_ate,
                        GREATEST(u.partidas, u.partidas_conta) AS partidas, u.origem,
                        (SELECT COUNT(*) FROM carreiras c WHERE c.usuario_id = u.id) AS carreiras
                    FROM usuarios u WHERE u.id > ? ORDER BY u.id LIMIT 1000', [$ultimo])->fetchAll();
                foreach ($lote as $l) {
                    $ultimo = (int) $l['id'];
                    linhaCsv([(int) $l['id'], (string) $l['apelido'], (string) $l['email'], dataBrasilia($l['criado_em']),
                        dataBrasilia($l['ultimo_acesso'] ?? $l['ultimo_login']), statusConta($l), (int) $l['partidas'], (int) $l['carreiras'], (string) $l['origem']]);
                }
                flush();
            } while (count($lote) === 1000);
            exit;

        case 'atencao':
            responder(200, atencao(($_GET['atualizar'] ?? '') === '1'));

        case 'agora':
            // P1-4: quem está com o jogo aberto agora (último batimento há até 60 s). Nunca o IP.
            $t = time();
            $bots = ($_GET['bots'] ?? '') === '1';
            $w = 'v.ultimo >= ?' . ($bots ? '' : ' AND v.bot = 0');
            $p = [dt($t - 60)];
            $tot = umaLinha("SELECT COUNT(*) AS n, COUNT(v.usuario_id) AS conta, COALESCE(SUM(v.jogando_ate > ?), 0) AS jog FROM visitas v WHERE $w",
                array_merge([dt($t)], $p));
            $onde = ['/' => 'Menu', '/carreira' => 'Clássico', '/imersivo' => 'Imersivo', '/identidade' => 'Criando o jogador',
                '/hall' => 'Hall das Lendas', '/resumo' => 'Resumo de carreira', '/conquistas' => 'Conquistas', '/conta' => 'Minha conta', '/live' => 'Live'];
            $itens = array_map(static function (array $l) use ($onde, $t): array {
                $rota = $l['rota'] !== null ? (string) $l['rota'] : null;
                $raiz = $rota === null ? null : ('/' . explode('/', ltrim($rota, '/'))[0]);
                return [
                    'sessao' => substr((string) $l['sid'], 0, 8),
                    'conta' => $l['usuario_id'] !== null ? ['id' => (int) $l['usuario_id'], 'apelido' => (string) ($l['apelido'] ?? '')] : null,
                    'rota' => $rota,
                    'onde' => $rota === null ? 'Outra tela' : ($onde[$rota] ?? $onde[$raiz] ?? 'Outra tela'),
                    'modo' => $l['modo_atual'],
                    'jogando' => (paraTempo($l['jogando_ate']) ?? 0) > $t,
                    'entrouEm' => iso($l['inicio']),
                    'vistoEm' => iso($l['ultimo']),
                    'tempoS' => (int) $l['ativo_s'],
                    'aparelho' => $l['dispositivo'],
                    'origem' => (string) $l['origem'],
                    'bot' => (int) $l['bot'] === 1,
                ];
            }, sql("SELECT v.sid, v.usuario_id, v.rota, v.modo_atual, v.jogando_ate, v.inicio, v.ultimo, v.ativo_s, v.dispositivo, v.origem, v.bot, u.apelido
                FROM visitas v LEFT JOIN usuarios u ON u.id = v.usuario_id WHERE $w ORDER BY (v.usuario_id IS NULL), v.ultimo DESC LIMIT 200", $p)->fetchAll());
            responder(200, ['total' => (int) $tot['n'], 'comConta' => (int) $tot['conta'], 'jogando' => (int) $tot['jog'],
                'atualizadoEm' => gmdate('Y-m-d\TH:i:s\Z', $t), 'itens' => $itens]);

        case 'lixeira':
            $total = (int) umValor('SELECT COUNT(*) FROM lixeira_carreiras');
            // sem JOIN (o apelido vem depois, numa consulta só): a página sai na ordem do ix_lixeira_expira, sem filesort
            $itens = itensLixeira(sql('SELECT ' . CAMPOS_LIXEIRA . ' FROM lixeira_carreiras l FORCE INDEX FOR ORDER BY (ix_lixeira_expira)
                ORDER BY l.expira_em DESC, l.id DESC LIMIT ' . POR_PAGINA . " OFFSET $off")->fetchAll());
            responder(200, paginado($total, $pagina, $itens));

        case 'multicontas':
            $grupos = gruposMulticontas(($_GET['atualizar'] ?? '') === '1');
            $pag = array_slice($grupos, $off, POR_PAGINA);
            $ids = array_merge([], ...array_map(static fn(array $g): array => $g['ids'], $pag));
            $contas = [];
            foreach (array_chunk(array_values(array_unique($ids)), 1000) as $lote) {
                foreach (sql('SELECT id, apelido, criado_em, status, suspenso_ate, partidas, partidas_conta FROM usuarios WHERE id IN (' . marcas(count($lote)) . ')', $lote) as $l) {
                    $contas[(int) $l['id']] = ['id' => (int) $l['id'], 'apelido' => (string) $l['apelido'], 'criadoEm' => iso($l['criado_em']),
                        'status' => statusConta($l), 'partidas' => max((int) $l['partidas'], (int) $l['partidas_conta'])];
                }
            }
            $lidos = alertasLidos();
            $itens = array_map(static fn(array $g): array => [
                'chave' => $g['chave'],
                'aparelho' => $g['aparelho'],
                'aparelhos' => $g['aparelhos'],
                'contas' => array_values(array_filter(array_map(static fn(int $i): ?array => $contas[$i] ?? null, $g['ids']))),
                'seIndicaram' => $g['seIndicaram'],
                'ultimaVisita' => $g['ultima'],
                'dispensado' => isset($lidos[$g['chave']]),
            ], $pag);
            $e = lerEstado(MULTICONTAS_ESTADO);
            responder(200, paginado(count($grupos), $pagina, $itens) + ['calculadoEm' => is_int($e['em'] ?? null) ? gmdate('Y-m-d\TH:i:s\Z', $e['em']) : null]);

        case 'emails':
            // P1-10/A15: o registro dos envios (90 dias); a busca por e-mail exato vira o HMAC (o endereço não é guardado de novo)
            $email = strtolower(qs('email', 190));
            $w = '';
            $p = [];
            if ($email !== '') {
                $w = ' WHERE para_hash = ?';
                $p[] = quemEmail($email);
            }
            $dia = dt(time() - 86400);
            $res = umaLinha('SELECT COUNT(*) AS n, COALESCE(SUM(ok = 0), 0) AS f FROM email_log WHERE em >= ?', [$dia]);
            $total = (int) umValor("SELECT COUNT(*) FROM email_log$w", $p);
            $itens = array_map(static fn(array $l): array => ['id' => (int) $l['id'], 'em' => iso($l['em']), 'para' => (string) $l['para_mask'],
                'tipo' => (string) $l['tipo'], 'via' => (string) $l['via'], 'ok' => (int) $l['ok'] === 1,
                // as linhas gravadas antes da rev3 podem ter o endereço inteiro na resposta do servidor de e-mail
                'detalhe' => is_string($l['detalhe']) ? semEmails($l['detalhe']) : null],
                sql('SELECT * FROM email_log' . ($w === '' ? ' FORCE INDEX FOR ORDER BY (ix_email_log_em)' : '') . "$w ORDER BY em DESC, id DESC LIMIT "
                    . POR_PAGINA . " OFFSET $off", $p)->fetchAll());
            responder(200, paginado($total, $pagina, $itens) + ['resumo' => ['envios24h' => (int) $res['n'], 'falhas24h' => (int) $res['f'],
                'via' => match ((string) (config()['email_modo'] ?? 'mail')) { 'arquivo' => 'arquivo', 'smtp' => 'smtp', default => 'mail' },
                'ultimoOkEm' => iso((string) umValor('SELECT MAX(em) FROM email_log WHERE ok = 1') ?: null)]]);

        case 'relatorio':
            $tipo = qs('tipo', 20);
            if (!isset(RELATORIOS[$tipo])) {
                erroCom(400, 'tipo', 'Relatório desconhecido.', ['tipos' => array_keys(RELATORIOS)]);
            }
            $conta = qs('conta', 10);
            if ($conta !== '' && !in_array($conta, TIPOS_CONTA, true)) {
                erro(400, 'conta', 'Tipo de conta: jogador, tester, criador, oficial ou teste.');
            }
            $csv = ($_GET['csv'] ?? '') === '1';
            if ($csv) {
                poder('relatorio_csv');
            }
            responder(200, relatorio($tipo, $conta, $pagina, $csv));

        case 'tempo':
            $jan = qs('jan', 10) ?: 'semana';
            $grupo = qs('grupo', 10) ?: 'jogadores';
            if (!in_array($jan, ['semana', 'passada', 'mes', 'd30', 'tudo'], true) || !in_array($grupo, ['jogadores', 'todos', 'testes'], true)) {
                erro(400, 'filtro', 'Janela: semana, passada, mes, d30 ou tudo; grupo: jogadores, todos ou testes.');
            }
            $usuario = isset($_GET['usuario']) ? lerIdNumero($_GET['usuario'], 'Usuário') : null;
            $csv = ($_GET['csv'] ?? '') === '1';
            if ($csv) {
                poder('tempo_csv');
            }
            responder(200, tempoDeJogo($jan, $grupo, $usuario, $csv));

        case 'eventos':
            $tipo = qs('tipo', 16);
            if ($tipo !== '' && !in_array($tipo, TIPOS_FEED, true)) {
                erro(400, 'tipo', 'Tipo: cadastro, login, jogo_fim ou compartilhar.');
            }
            $dias = qs('dias', 3);
            $dias = $dias !== '' && ctype_digit($dias) ? max(1, min(90, (int) $dias)) : 30;
            responder(200, feedEventos($tipo, $dias, $pagina));

        case 'bonus':
            // X5: todos os bônus, com filtro por estado e origem
            $estado = qs('estado', 10) ?: 'todos';
            $origem = qs('origem', 12);
            $onde = [];
            $params = [];
            if ($estado === 'abertos') {
                $onde[] = 'b.usado_em IS NULL';
            } elseif ($estado === 'usados') {
                $onde[] = 'b.usado_em IS NOT NULL';
            } elseif ($estado !== 'todos') {
                erro(400, 'filtro', 'Estado: abertos, usados ou todos.');
            }
            if ($origem !== '') {
                if (!in_array($origem, ['indicacao', 'compartilhar', 'admin'], true)) {
                    erro(400, 'filtro', 'Origem: indicacao, compartilhar ou admin.');
                }
                $onde[] = 'b.origem = ?';
                $params[] = $origem;
            }
            $usuario = qs('usuario', 10);
            if ($usuario !== '' && ctype_digit($usuario)) {
                $onde[] = 'b.usuario_id = ?';
                $params[] = (int) $usuario;
            }
            $w = $onde ? ' WHERE ' . implode(' AND ', $onde) : '';
            $total = (int) umValor("SELECT COUNT(*) FROM bonus b$w", $params);
            $soma = umaLinha("SELECT COALESCE(SUM(b.valor), 0) AS v, COALESCE(SUM(b.usado_em IS NULL), 0) AS abertos FROM bonus b$w", $params);
            $itens = array_map(static fn(array $l): array => [
                'id' => (int) $l['id'], 'usuario' => $l['apelido'] !== null ? ['id' => (int) $l['usuario_id'], 'apelido' => (string) $l['apelido']] : null,
                'valor' => (int) $l['valor'], 'origem' => (string) $l['origem'], 'ref' => $l['ref'], 'criadoEm' => iso($l['criado_em']),
                'usadoEm' => iso($l['usado_em']), 'carreiraId' => $l['carreira_id'],
                'disponivel' => $l['usado_em'] === null && ($l['origem'] === 'admin' || (int) $l['partidas_conta'] >= (int) bonusCfg()['liberaAposPartidas']),
            ], sql("SELECT b.*, u.apelido, u.partidas_conta FROM bonus b LEFT JOIN usuarios u ON u.id = b.usuario_id$w ORDER BY b.id DESC LIMIT "
                . POR_PAGINA . " OFFSET $off", $params)->fetchAll());
            responder(200, paginado($total, $pagina, $itens) + ['resumo' => ['valor' => (int) $soma['v'], 'abertos' => (int) $soma['abertos']]]);

        case 'seguranca':
            // P1-3: o bloco Segurança é do servidor de acesso (respostaSeguranca do _admin.php); aqui só o mesmo endereço
            poder('seguranca');
            if (!function_exists('respostaSeguranca')) {
                erro(503, 'instalar', 'O bloco Segurança ainda não foi instalado.');
            }
            responder(200, respostaSeguranca($pagina, qs('acao', 40) ?: null));
    }
    erro(400, 'rota', 'Rota desconhecida.');
}

// ── POST ─────────────────────────────────────────────────────────────────────────────────────────

/** Resumo do lote para o toast: "7 ocultadas · 2 puladas (já estavam)". */
function rotuloPulados(array $pulados): array
{
    $por = [];
    foreach ($pulados as $p) {
        $por[$p['motivo']] = ($por[$p['motivo']] ?? 0) + 1;
    }
    return $por;
}

function rotasPost(array $ADM, string $via): never
{
    exigirEscritaAdmin($via);
    $j = lerJson(64 * 1024);
    $acao = is_string($j['acao'] ?? null) ? $j['acao'] : '';
    if ($acao !== '' && preg_match('/^[a-z_]{1,40}$/', $acao)) {
        poder($acao);
    }

    switch ($acao) {
        case 'suspender':
            $u = usuarioOu404(lerIdNumero($j['id'] ?? null));
            $uid = (int) $u['id'];
            $dias = array_key_exists('dias', $j) && $j['dias'] !== null ? inteiroOuNulo($j['dias'], 1, 3650) : null;
            if (array_key_exists('dias', $j) && $j['dias'] !== null && $dias === null) {
                erro(400, 'dias', 'Dias de suspensão: de 1 a 3650 (ou vazio para até reativar).');
            }
            $motivo = lerMotivo($j['motivo'] ?? null, true, 'Escreva o motivo da suspensão: ele fica no registro e o jogador vê ao tentar entrar.');
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
            registrarAdmin('reativar', 'usuario:' . $u['id'], ['apelido' => (string) $u['apelido'], 'motivo' => lerMotivo($j['motivo'] ?? null, false)]);
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
            $conf = is_string($j['confirma'] ?? null) ? mb_strtolower(trim($j['confirma']), 'UTF-8') : '';
            if ($conf === '' || $conf !== mb_strtolower(trim((string) $u['apelido']), 'UTF-8')) {
                erro(400, 'confirma', 'Digite o apelido da conta para confirmar.');
            }
            $motivoEx = $j['motivo'] ?? null;
            if ($motivoEx !== null && !in_array($motivoEx, MOTIVOS_EXCLUIR, true)) {
                erro(400, 'motivo', 'Motivo: pedido_titular, abuso, teste ou outro.');
            }
            excluirUsuario((int) $u['id']);
            registrarAdmin('excluir_usuario', 'usuario:' . $u['id'], ['motivo' => $motivoEx ?? 'outro']); // LGPD: nada pessoal no registro
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
            $motivo = lerMotivo($j['motivo'] ?? null, true);
            $r = tirarBonus($bidT);
            if (($r['pulado'] ?? '') === 'nao_encontrado') {
                erro(404, 'nao_encontrado', 'Bônus não encontrado.');
            }
            if (($r['pulado'] ?? '') === 'usado') {
                erro(409, 'usado', 'Esse bônus já foi usado numa carreira e não dá para tirar.');
            }
            $b = $r['bonus'];
            registrarAdmin('tirar_bonus', 'usuario:' . $b['usuario_id'], ['bonusId' => (int) $b['id'], 'valor' => (int) $b['valor'],
                'origem' => (string) $b['origem'], 'motivo' => $motivo]);
            responder(200, ['ok' => true]);

        case 'tirar_bonus_lote':
            $ids = lerIdsLote($j['ids'] ?? null);
            $motivo = lerMotivo($j['motivo'] ?? null, true);
            $feitos = [];
            $pulados = [];
            foreach ($ids as $bid) {
                $r = tirarBonus($bid);
                if (isset($r['pulado'])) {
                    $pulados[] = ['id' => $bid, 'motivo' => $r['pulado']];
                    continue;
                }
                $feitos[] = $bid;
                registrarAdmin('tirar_bonus', 'usuario:' . $r['bonus']['usuario_id'], ['bonusId' => $bid, 'valor' => (int) $r['bonus']['valor'],
                    'origem' => (string) $r['bonus']['origem'], 'motivo' => $motivo, 'lote' => true]);
            }
            registrarAdmin('tirar_bonus_lote', 'bonus', ['feitos' => count($feitos), 'pulados' => rotuloPulados($pulados), 'motivo' => $motivo]);
            responder(200, ['ok' => true, 'feitos' => $feitos, 'pulados' => $pulados]);

        case 'recusar_indicacao':
            $iid = lerIdNumero($j['id'] ?? null, 'Indicação');
            $motivo = lerMotivo($j['motivo'] ?? null, true);
            $r = recusarIndicacao($iid, false);
            if (isset($r['pulado'])) {
                erro(404, 'nao_encontrada', 'Indicação não encontrada.');
            }
            registrarAdmin('recusar_indicacao', 'indicacao:' . $iid, ['indicador' => (int) $r['indicacao']['indicador_id'], 'bonusTirado' => $r['bonusTirado'],
                'motivo' => $motivo]);
            responder(200, ['ok' => true, 'bonusTirado' => $r['bonusTirado']]);

        case 'indicacoes_lote':
            $ids = lerIdsLote($j['ids'] ?? null);
            if (($j['operacao'] ?? null) !== 'recusar') {
                erro(400, 'operacao', 'Operação: recusar.');
            }
            $motivo = lerMotivo($j['motivo'] ?? null, true);
            $feitas = [];
            $tirados = 0;
            $pulados = [];
            foreach ($ids as $iid) {
                $r = recusarIndicacao($iid, true);
                if (isset($r['pulado'])) {
                    $pulados[] = ['id' => $iid, 'motivo' => $r['pulado']];
                    continue;
                }
                $feitas[] = $iid;
                $tirados += $r['bonusTirado'] ? 1 : 0;
                registrarAdmin('recusar_indicacao', 'indicacao:' . $iid, ['indicador' => (int) $r['indicacao']['indicador_id'],
                    'bonusTirado' => $r['bonusTirado'], 'motivo' => $motivo, 'lote' => true]);
            }
            registrarAdmin('indicacoes_lote', 'indicacoes', ['recusadas' => count($feitas), 'bonusTirados' => $tirados, 'pulados' => rotuloPulados($pulados),
                'motivo' => $motivo]);
            responder(200, ['ok' => true, 'recusadas' => $feitas, 'bonusTirados' => $tirados, 'pulados' => $pulados]);

        case 'ocultar_carreira':
        case 'mostrar_carreira':
        case 'apagar_carreira':
            $pk = lerIdNumero($j['id'] ?? null, 'Carreira');
            $motivo = lerMotivo($j['motivo'] ?? null, $acao !== 'mostrar_carreira');
            $aviso = $acao !== 'mostrar_carreira' ? lerAviso($j) : null;
            $r = match ($acao) {
                'ocultar_carreira' => ocultarCarreira($pk, (string) $motivo, false),
                'mostrar_carreira' => mostrarCarreira($pk, $motivo, false),
                default => apagarCarreiraAdmin($pk, (string) $motivo),
            };
            if (isset($r['pulado'])) {
                erro(404, 'nao_encontrada', 'Carreira não encontrada.');
            }
            $c = $r['carreira'];
            if ($acao !== 'mostrar_carreira') {
                tirarDoHall($pk);
            }
            if ($aviso !== null) {
                avisarAutor((int) $c['usuario_id'], (string) $c['jogador'], $aviso);
            }
            registrarAdmin($acao, 'carreira:' . $pk, ['usuario' => (int) $c['usuario_id'], 'jogador' => (string) $c['jogador'],
                'antes' => ['oculta' => (int) $c['oculta'], 'suspeita' => $c['suspeita']], 'denunciasFechadas' => $r['fechadas'], 'motivo' => $motivo,
                'avisou' => $aviso !== null] + (isset($r['lixeiraId']) ? ['lixeiraId' => $r['lixeiraId']] : []));
            responder(200, ['ok' => true, 'denunciasFechadas' => $r['fechadas']] + (isset($r['lixeiraId']) ? ['lixeiraId' => $r['lixeiraId']] : []));

        case 'carreiras_lote':
            $ids = lerIdsLote($j['ids'] ?? null);
            $op = $j['operacao'] ?? null;
            if ($op !== 'ocultar' && $op !== 'mostrar') {
                erro(400, 'operacao', 'Operação: ocultar ou mostrar (apagar não existe em lote).');
            }
            $motivo = lerMotivo($j['motivo'] ?? null, $op === 'ocultar');
            $aviso = $op === 'ocultar' ? lerAviso($j) : null;
            $feitos = [];
            $pulados = [];
            $fechadas = 0;
            foreach ($ids as $pk) {
                $r = $op === 'ocultar' ? ocultarCarreira($pk, (string) $motivo, true) : mostrarCarreira($pk, $motivo, true);
                if (isset($r['pulado'])) {
                    $pulados[] = ['id' => $pk, 'motivo' => $r['pulado']];
                    continue;
                }
                $feitos[] = $pk;
                $fechadas += $r['fechadas'];
                $c = $r['carreira'];
                if ($aviso !== null) {
                    avisarAutor((int) $c['usuario_id'], (string) $c['jogador'], $aviso);
                }
                registrarAdmin($op === 'ocultar' ? 'ocultar_carreira' : 'mostrar_carreira', 'carreira:' . $pk, ['usuario' => (int) $c['usuario_id'],
                    'jogador' => (string) $c['jogador'], 'antes' => ['oculta' => (int) $c['oculta'], 'suspeita' => $c['suspeita']],
                    'denunciasFechadas' => $r['fechadas'], 'motivo' => $motivo, 'lote' => true, 'avisou' => $aviso !== null]);
            }
            if ($op === 'ocultar' && $feitos) {
                $fotos = array_map('intval', sql('SELECT id FROM hall_foto WHERE carreira_pk IN (' . marcas(count($feitos)) . ')', $feitos)->fetchAll(PDO::FETCH_COLUMN));
                if ($fotos) {
                    tirarDoHallIds($fotos);
                }
            }
            registrarAdmin('carreiras_lote', 'hall', ['operacao' => $op, 'feitos' => count($feitos), 'pulados' => rotuloPulados($pulados),
                'denunciasFechadas' => $fechadas, 'motivo' => $motivo]);
            responder(200, ['ok' => true, 'feitos' => $feitos, 'pulados' => $pulados, 'denunciasFechadas' => $fechadas]);

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
            $motivo = lerMotivo($j['motivo'] ?? null, $resultado === 'ocultar');
            $aviso = $resultado === 'ocultar' ? lerAviso($j) : null;
            $d = umaLinha('SELECT id, carreira_pk FROM denuncias WHERE id = ?', [$did]);
            if ($d === null) {
                erro(404, 'nao_encontrada', 'Denúncia não encontrada.');
            }
            $pk = (int) $d['carreira_pk'];
            $r = resolverDenunciasCarreira($pk, $resultado, $motivo, false, $did);
            if (isset($r['pulado'])) {
                erro(404, 'nao_encontrada', 'Carreira não encontrada.');
            }
            if (isset($r['ja_decidida'])) {
                // rev3: outra pessoa (ou outra aba) decidiu antes; nada muda (nem a denúncia, nem o motivo guardado)
                $jd = $r['ja_decidida'];
                erroCom(409, 'ja_decidida', 'Essa denúncia já foi decidida' . ($jd['resultado'] === 'ocultar' ? ' (a carreira foi ocultada)'
                    : ($jd['resultado'] === 'ok' ? ' (a carreira ficou)' : '')) . '. Atualize a lista para ver a decisão.', ['estado' => $jd]);
            }
            if ($resultado === 'ocultar') {
                tirarDoHall($pk);
                if ($aviso !== null) {
                    avisarAutor((int) $r['carreira']['usuario_id'], (string) $r['carreira']['jogador'], $aviso);
                }
            }
            registrarAdmin('resolver_denuncia', 'carreira:' . $pk, ['denuncia' => $did, 'resultado' => $resultado, 'fechadas' => $r['fechadas'], 'motivo' => $motivo]);
            responder(200, ['ok' => true, 'denunciasFechadas' => $r['fechadas']]);

        case 'resolver_denuncias_lote':
            $ids = lerIdsLote($j['carreiras'] ?? null);
            $resultado = $j['resultado'] ?? null;
            if ($resultado !== 'ok' && $resultado !== 'ocultar') {
                erro(400, 'resultado', 'Resultado: ok (a carreira fica) ou ocultar.');
            }
            $motivo = lerMotivo($j['motivo'] ?? null, $resultado === 'ocultar');
            $aviso = $resultado === 'ocultar' ? lerAviso($j) : null;
            $feitas = [];
            $pulados = [];
            $fechadas = 0;
            foreach ($ids as $pk) {
                $r = resolverDenunciasCarreira($pk, $resultado, $motivo, true);
                if (isset($r['pulado'])) {
                    $pulados[] = ['id' => $pk, 'motivo' => $r['pulado'] === 'nao_encontrada' ? 'sem_abertas' : $r['pulado']];
                    continue;
                }
                $feitas[] = $pk;
                $fechadas += $r['fechadas'];
                if ($aviso !== null) {
                    avisarAutor((int) $r['carreira']['usuario_id'], (string) $r['carreira']['jogador'], $aviso);
                }
                registrarAdmin('resolver_denuncia', 'carreira:' . $pk, ['resultado' => $resultado, 'fechadas' => $r['fechadas'], 'motivo' => $motivo, 'lote' => true]);
            }
            if ($resultado === 'ocultar' && $feitas) {
                $fotos = array_map('intval', sql('SELECT id FROM hall_foto WHERE carreira_pk IN (' . marcas(count($feitas)) . ')', $feitas)->fetchAll(PDO::FETCH_COLUMN));
                if ($fotos) {
                    tirarDoHallIds($fotos);
                }
            }
            registrarAdmin('resolver_denuncias_lote', 'hall', ['resultado' => $resultado, 'carreiras' => count($feitas), 'denunciasFechadas' => $fechadas,
                'pulados' => rotuloPulados($pulados), 'motivo' => $motivo]);
            responder(200, ['ok' => true, 'carreiras' => $feitas, 'denunciasFechadas' => $fechadas, 'pulados' => $pulados]);

        case 'destacar_carreira':
            $pk = lerIdNumero($j['id'] ?? null, 'Carreira');
            $sim = $j['sim'] ?? null;
            if (!is_bool($sim)) {
                erro(400, 'dados', 'Diga se a carreira fica em destaque (sim) ou não.');
            }
            $c = umaLinha('SELECT id, usuario_id, jogador, destaque FROM carreiras WHERE id = ?', [$pk]);
            if ($c === null) {
                erro(404, 'nao_encontrada', 'Carreira não encontrada.');
            }
            transacao(static function () use ($pk, $sim): void {
                sql('UPDATE carreiras SET destaque = ? WHERE id = ?', [$sim ? 1 : 0, $pk]);
                sql('UPDATE hall_foto SET destaque = ? WHERE carreira_pk = ?', [$sim ? 1 : 0, $pk]); // o selo muda na hora
            });
            registrarAdmin('destacar_carreira', 'carreira:' . $pk, ['usuario' => (int) $c['usuario_id'], 'jogador' => (string) $c['jogador'], 'sim' => $sim]);
            responder(200, ['ok' => true, 'destaque' => $sim]);

        case 'restaurar_carreira':
            $lix = lerIdNumero($j['id'] ?? null, 'Item da lixeira');
            $pk = restaurarCarreira($lix);
            registrarAdmin('restaurar_carreira', 'carreira:' . $pk, ['lixeiraId' => $lix]);
            responder(200, ['ok' => true, 'pk' => $pk]);

        case 'liberar_reenvio':
            $lix = lerIdNumero($j['id'] ?? null, 'Item da lixeira');
            $l = liberarReenvio($lix);
            registrarAdmin('liberar_reenvio', 'usuario:' . $l['usuario_id'], ['lixeiraId' => $lix, 'jogador' => (string) $l['jogador']]);
            responder(200, ['ok' => true]);

        case 'bloquear_hall':
            $u = usuarioOu404(lerIdNumero($j['id'] ?? null));
            $sim = $j['sim'] ?? null;
            if (!is_bool($sim)) {
                erro(400, 'dados', 'Diga se a conta sai do Hall público (sim) ou volta (não).');
            }
            $motivo = lerMotivo($j['motivo'] ?? null, $sim);
            sql('UPDATE usuarios SET hall_bloqueado = ? WHERE id = ?', [$sim ? 1 : 0, (int) $u['id']]);
            if ($sim) {
                tirarDoHall(null, (int) $u['id']); // sai na hora; voltar é na próxima fotografia
            }
            registrarAdmin('bloquear_hall', 'usuario:' . $u['id'], ['apelido' => (string) $u['apelido'], 'sim' => $sim, 'motivo' => $motivo]);
            responder(200, ['ok' => true, 'hallBloqueado' => $sim]);

        case 'nota':
            $u = usuarioOu404(lerIdNumero($j['id'] ?? null));
            $txt = lerNota($j['texto'] ?? null);
            $quem = admQuem();
            sql('UPDATE usuarios SET nota_admin = ?, nota_admin_em = ?, nota_admin_por = ? WHERE id = ?',
                [$txt, $txt === null ? null : dt(time()), $txt === null ? null : $quem, (int) $u['id']]);
            // o texto pode ter dado pessoal: no registro só o tamanho
            registrarAdmin($txt === null ? 'nota_apagada' : 'nota', 'usuario:' . $u['id'], ['tamanho' => $txt === null ? 0 : mb_strlen($txt, 'UTF-8')]);
            responder(200, ['ok' => true, 'nota' => notaJson(usuarioOu404((int) $u['id']))]);

        case 'mudar_tipo':
            $u = usuarioOu404(lerIdNumero($j['id'] ?? null));
            $tipo = $j['tipo'] ?? null;
            if (!is_string($tipo) || !in_array($tipo, TIPOS_CONTA, true)) {
                erro(400, 'tipo', 'Tipo de conta: jogador, tester, criador, oficial ou teste.');
            }
            $motivo = lerMotivo($j['motivo'] ?? null, false);
            $antes = (string) $u['tipo'];
            if ($antes !== $tipo) {
                sql('UPDATE usuarios SET tipo = ?, tipo_em = ? WHERE id = ?', [$tipo, dt(time()), (int) $u['id']]);
            }
            registrarAdmin('mudar_tipo', 'usuario:' . $u['id'], ['de' => $antes, 'para' => $tipo, 'motivo' => $motivo]);
            responder(200, ['ok' => true, 'tipo' => $tipo, 'antes' => $antes]);

        case 'enviar_redefinicao':
            $u = usuarioOu404(lerIdNumero($j['id'] ?? null));
            if (contaSuspensa($u)) {
                erro(409, 'suspensa', 'A conta está suspensa: reative antes de mandar o código.');
            }
            limitar('adm-redef', 'u' . $u['id'], 3);
            $codigo = gravarCodigoRedefinicao((string) $u['email']);
            // o código nunca vem na resposta nem vai para o registro (S18: quem dispara não vê)
            $enviado = enviarEmail((string) $u['email'], 'LENDA: seu código para trocar a senha', corpoEmailRedefinicao((string) $u['apelido'], $codigo, true),
                'admin_redef');
            registrarAdmin('enviar_redefinicao', 'usuario:' . $u['id'], ['enviado' => $enviado]);
            responder(200, ['ok' => true, 'enviado' => $enviado, 'para' => mascararEmail((string) $u['email'])]);

        case 'alerta_dispensar':
        case 'alerta_reabrir':
            $chave = $j['chave'] ?? null;
            if (!is_string($chave) || !preg_match(ALERTA_CHAVE_RE, $chave)) {
                erro(400, 'chave', 'Aviso inválido.');
            }
            if ($acao === 'alerta_dispensar') {
                $al = dispensarAlerta($chave);
                registrarAdmin('alerta_dispensar', 'alerta:' . $chave, ['nivel' => (string) $al['nivel']]); // sem o texto (pode ter apelido)
            } else {
                $existia = reabrirAlerta($chave);
                registrarAdmin('alerta_reabrir', 'alerta:' . $chave, ['existia' => $existia]);
            }
            responder(200, ['ok' => true]);

        case 'testar_aviso':
            if (!celularConfigurado()) {
                erro(409, 'sem_aviso', 'Nenhum canal configurado: ponha aviso_ntfy ou aviso_telegram no arquivo de config (LEIAME).');
            }
            $r = avisarCelular('LENDA · teste', 'Aviso de teste mandado pelo painel. Se chegou, está tudo certo.');
            $ok = in_array(true, $r, true);
            registrarAdmin('testar_aviso', 'config', ['canais' => $r]);
            responder(200, ['ok' => true, 'enviado' => $ok, 'canais' => $r]);

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
            $por = substr(admQuem(), 0, 20);
            transacao(static function () use ($limpos, $por): void {
                foreach ($limpos as $chave => $v) {
                    gravarSiteConfig($chave, $v, $por);
                }
            });
            esquecerSiteConfig();
            $mudou = [];
            foreach ($limpos as $chave => $v) {
                $mudou[$chave] = ['de' => $antes[$chave] ?? null, 'para' => $v];
            }
            if (($antes['imersivo_publico'] ?? false) === true && ($limpos['imersivo_publico'] ?? true) === false) {
                // o Imersivo voltou a ser só do admin: as carreiras dele saem do Hall público na hora
                limparFotoMudancas();
                if (refazerFoto(true, 10, 'admin') !== null) {
                    $mudou['hall'] = 'refeito';
                }
            }
            registrarAdmin('config', 'config', $mudou);
            responder(200, ['ok' => true, 'valores' => siteConfigPainel(true)]);
    }
    erro(400, 'acao', 'Ação desconhecida.');
}

// ── despacho ─────────────────────────────────────────────────────────────────────────────────────

$m = metodo();
if ($m !== 'GET' && $m !== 'POST') {
    admin();
    erroMetodo();
}
$ADM = admin($m === 'GET' ? 'ver' : null);
$via = ($ADM['via'] ?? '') === 'token' ? 'token' : 'painel';
try {
    if ($m === 'GET') {
        rotasGet();
    }
    rotasPost($ADM, $via);
} catch (PDOException $e) {
    // S22: subiu os arquivos e não rodou o instalar.php (tabela ou coluna nova que ainda não existe)
    if (in_array($e->errorInfo[1] ?? null, [1146, 1054], true)) {
        if (function_exists('erroInstalar')) {
            erroInstalar();
        }
        erro(503, 'instalar', 'Falta atualizar o banco: rode o instalar.php (LEIAME §5) e tente de novo.');
    }
    throw $e;
}

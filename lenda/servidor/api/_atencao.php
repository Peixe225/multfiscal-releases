<?php
/**
 * LENDA · "Precisa de atenção" e o pulso do painel (v3.2, P0-1, P0-2, P1-9, P1-13, S17, N12 do mapa).
 * - atencao(): os alertas automáticos (graves primeiro), recalculados no máximo a cada 60 s (site_config._atencao);
 *   a dispensa (site_config._alertas_lidos) vale até a situação mudar: a chave dos dispensáveis muda junto com ela.
 * - pulsoAdmin(): os números de ação ao vivo, os alertas (do cache, nunca recalcula) e o hash das filas, para o
 *   painel.php?so=agora (cache de 5 s em APCu, se houver).
 * - gruposMulticontas(): várias contas no mesmo aparelho (visitas.vid), cache de 10 min em site_config._multicontas.
 * Usado por admin.php e painel.php. Nunca é servido. Contrato: servidor/CONTRATO-v32.md §A.
 */
declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/_hall.php';
require_once __DIR__ . '/_contas.php'; // §E: a cota dos e-mails de confirmação (cotaEmailsVerif)

const ATENCAO_ESTADO = '_atencao';
const ATENCAO_TTL_S = 60;
const ATENCAO_PULSO_MAX_S = 300;      // o pulso só usa um cálculo de até 5 min
const ALERTAS_LIDOS = '_alertas_lidos';
const ALERTAS_LIDOS_MAX = 500;
const MULTICONTAS_ESTADO = '_multicontas';
const MULTICONTAS_TTL_S = 600;
const MULTICONTAS_MAX = 2000;         // os 2.000 aparelhos com mais contas (e os mais recentes) entram na lista
const ALERTA_CHAVE_RE = '/^[a-z_]{2,20}(:[0-9a-f]{8,40})?$/';

// ── cache curto (APCu; sem APCu, calcula sempre) ─────────────────────────────────────────────────

function apcuLigado(): bool
{
    static $ok = null;
    return $ok ??= function_exists('apcu_fetch') && filter_var(ini_get('apc.enabled'), FILTER_VALIDATE_BOOL) && PHP_SAPI !== 'cli';
}

function chaveCacheAdmin(string $nome): string
{
    return 'lenda:adm:' . $nome . ':' . md5((string) (config()['db']['dsn'] ?? ''));
}

/** Valor guardado por $ttl s (APCu) ou calculado agora. */
function cacheCurto(string $nome, int $ttl, callable $calc): mixed
{
    if (apcuLigado()) {
        $v = apcu_fetch(chaveCacheAdmin($nome), $ok);
        if ($ok) {
            return $v;
        }
    }
    $v = $calc();
    if (apcuLigado()) {
        apcu_store(chaveCacheAdmin($nome), $v, $ttl);
    }
    return $v;
}

/** Depois de qualquer escrita do admin: os números e os alertas são refeitos no próximo pedido (N12). */
function esquecerCachesAdmin(bool $atencaoTambem = true): void
{
    if (apcuLigado()) {
        foreach (['pulso', 'pulso33', 'contagens_usuarios'] as $n) {
            @apcu_delete(chaveCacheAdmin($n));
        }
    }
    if ($atencaoTambem) {
        try {
            sql('DELETE FROM site_config WHERE chave = ?', [ATENCAO_ESTADO]);
        } catch (PDOException) {
            // sem a tabela: nada a esquecer
        }
    }
}

// ── textos ───────────────────────────────────────────────────────────────────────────────────────

function plural(int $n, string $um, string $varios): string
{
    return number_format($n, 0, ',', '.') . ' ' . ($n === 1 ? $um : $varios);
}

/** 90 → "2 min"; 7200 → "2 h"; 3 dias → "3 dias". */
function duracaoCurta(int $s): string
{
    $s = max(0, $s);
    if ($s < 3600) {
        return max(1, intdiv($s, 60)) . ' min';
    }
    if ($s < 48 * 3600) {
        return intdiv($s, 3600) . ' h';
    }
    return intdiv($s, 86400) . ' dias';
}

function dataHoraBrasilia(?string $dt): string
{
    $t = paraTempo($dt);
    return $t === null ? '?' : gmdate('d/m H:i', $t - LENDA_FUSO_H * 3600);
}

function alerta(string $chave, string $nivel, string $texto, int $n, ?string $desde, array $link, bool $dispensavel): array
{
    return ['chave' => $chave, 'nivel' => $nivel, 'texto' => $texto, 'n' => $n, 'desde' => $desde, 'link' => $link, 'dispensavel' => $dispensavel];
}

// ── várias contas no mesmo aparelho (P1-9) ───────────────────────────────────────────────────────

/**
 * Grupos de contas que usaram o mesmo aparelho (vid), da maior para a menor, os mais recentes primeiro. Cada grupo:
 * {chave: "multi:<sha1 dos ids>", aparelho (8 primeiros do vid), aparelhos (quantos vids com o mesmo grupo), ids,
 * ultima (ISO), seIndicaram}. Conta nova no grupo = chave nova (a dispensa não vale mais).
 */
function gruposMulticontas(bool $forcar = false): array
{
    $e = lerEstado(MULTICONTAS_ESTADO);
    if (!$forcar && is_array($e) && is_int($e['em'] ?? null) && $e['em'] > time() - MULTICONTAS_TTL_S && is_array($e['grupos'] ?? null)) {
        return $e['grupos'];
    }
    $linhas = sql('SELECT vid, GROUP_CONCAT(DISTINCT usuario_id ORDER BY usuario_id) AS ids, COUNT(DISTINCT usuario_id) AS n, MAX(ultimo) AS u
        FROM visitas WHERE usuario_id IS NOT NULL GROUP BY vid HAVING n >= 2 ORDER BY n DESC, u DESC LIMIT ' . MULTICONTAS_MAX)->fetchAll();
    $grupos = [];
    $todos = [];
    foreach ($linhas as $l) {
        $ids = array_values(array_unique(array_map('intval', explode(',', (string) $l['ids']))));
        if (count($ids) !== (int) $l['n'] || strlen((string) $l['ids']) >= 1013) {
            // a lista pode ter vindo cortada (group_concat_max_len, 1024 no MySQL 8 se o SET da conexão não valer): o último
            // id podia sair pela metade e virar outra conta. Grupo grande (100+ contas) ou contagem diferente: lê de novo.
            $ids = array_map('intval', sql('SELECT DISTINCT usuario_id FROM visitas WHERE vid = ? AND usuario_id IS NOT NULL', [(string) $l['vid']])
                ->fetchAll(PDO::FETCH_COLUMN));
        }
        sort($ids);
        $chave = 'multi:' . sha1(implode(',', $ids));
        if (isset($grupos[$chave])) {
            $grupos[$chave]['aparelhos']++;
            continue;
        }
        $grupos[$chave] = ['chave' => $chave, 'aparelho' => substr((string) $l['vid'], 0, 8), 'aparelhos' => 1, 'ids' => $ids,
            'ultima' => iso($l['u']), 'seIndicaram' => false];
        foreach ($ids as $i) {
            $todos[$i] = true;
        }
    }
    if ($todos) {
        $ids = array_keys($todos);
        $pares = [];
        foreach (array_chunk($ids, 1000) as $lote) {
            foreach (sql('SELECT indicador_id, indicado_id FROM indicacoes WHERE indicado_id IN (' . marcas(count($lote)) . ')', $lote) as $p) {
                $pares[] = [(int) $p['indicador_id'], (int) $p['indicado_id']];
            }
        }
        foreach ($grupos as &$g) {
            $no = array_flip($g['ids']);
            foreach ($pares as [$a, $b]) {
                if (isset($no[$a], $no[$b])) {
                    $g['seIndicaram'] = true;
                    break;
                }
            }
        }
        unset($g);
    }
    $lista = array_values($grupos);
    try {
        gravarSiteConfig(MULTICONTAS_ESTADO, ['em' => time(), 'grupos' => $lista], 'auto');
    } catch (PDOException) {
        // sem gravar o cache: calcula de novo da próxima vez
    }
    return $lista;
}

/** [id => apelido] das contas. */
function apelidosDe(array $ids): array
{
    $ids = array_values(array_unique(array_map('intval', $ids)));
    $out = [];
    foreach (array_chunk($ids, 1000) as $lote) {
        foreach (sql('SELECT id, apelido FROM usuarios WHERE id IN (' . marcas(count($lote)) . ')', $lote) as $l) {
            $out[(int) $l['id']] = (string) $l['apelido'];
        }
    }
    return $out;
}

// ── os alertas (P0-1) ────────────────────────────────────────────────────────────────────────────

/** Uma regra que quebra (tabela que ainda não existe: rode o instalar.php) não derruba as outras. */
function regraAlerta(array &$alertas, callable $regra): void
{
    try {
        foreach ($regra() as $a) {
            $alertas[] = $a;
        }
    } catch (PDOException $e) {
        // tabela/coluna nova ainda não criada: a regra fica de fora até o instalar.php rodar
    }
}

/** Todos os alertas de agora (sem olhar as dispensas), graves primeiro. */
function calcularAlertas(): array
{
    $t = time();
    $dia = dt($t - 86400);
    $a = [];
    regraAlerta($a, static function () use ($t): array {
        $d = umaLinha("SELECT COUNT(*) AS n, MIN(criada_em) AS m FROM denuncias WHERE status = 'aberta'");
        $n = (int) ($d['n'] ?? 0);
        if ($n === 0) {
            return [];
        }
        $idade = $t - (paraTempo($d['m']) ?? $t);
        return [alerta('denuncias_abertas', $idade > 48 * 3600 ? 'grave' : 'acao', plural($n, 'denúncia aberta', 'denúncias abertas')
            . ' (a mais antiga há ' . duracaoCurta($idade) . ')', $n, iso($d['m']), ['aba' => 'hall', 'filtro' => 'denunciadas'], false)];
    });
    regraAlerta($a, static function (): array {
        $n = (int) umValor('SELECT COUNT(*) FROM carreiras WHERE oculta = 2');
        return $n === 0 ? [] : [alerta('ocultas_denuncia', 'grave', plural($n, 'carreira escondida', 'carreiras escondidas')
            . ' por denúncias esperando a sua decisão', $n, null, ['aba' => 'hall', 'filtro' => 'denunciadas'], false)];
    });
    regraAlerta($a, static function (): array {
        // a carreira que só espera a revisão da nota alta (X1) tem a linha dela (abaixo): aqui, as suspeitas de verdade
        $d = umaLinha("SELECT COUNT(*) AS n, MIN(salva_em) AS m FROM carreiras WHERE suspeita IS NOT NULL AND suspeita <> 'revisao' AND oculta = 0");
        $n = (int) ($d['n'] ?? 0);
        return $n === 0 ? [] : [alerta('suspeitas', 'acao', plural($n, 'carreira suspeita', 'carreiras suspeitas') . ' fora do Hall (libere ou oculte)',
            $n, iso($d['m']), ['aba' => 'hall', 'filtro' => 'suspeitas'], false)];
    });
    regraAlerta($a, static function (): array {
        $d = umaLinha("SELECT COUNT(*) AS n, MIN(salva_em) AS m FROM carreiras WHERE suspeita = 'revisao' AND oculta = 0");
        $n = (int) ($d['n'] ?? 0);
        return $n === 0 ? [] : [alerta('revisao', 'acao', plural($n, 'carreira de nota alta espera', 'carreiras de nota alta esperam')
            . ' a sua revisão para entrar no Hall', $n, iso($d['m']), ['aba' => 'hall', 'filtro' => 'revisao'], false)];
    });
    regraAlerta($a, static function () use ($dia): array {
        $linhas = sql('SELECT indicador_id, COUNT(*) AS n, MIN(criada_em) AS m FROM indicacoes WHERE criada_em >= ? GROUP BY indicador_id
            HAVING COUNT(*) >= 5 ORDER BY n DESC LIMIT 10', [$dia])->fetchAll();
        if (!$linhas) {
            return [];
        }
        $nomes = apelidosDe(array_column($linhas, 'indicador_id'));
        $out = [];
        foreach ($linhas as $l) {
            $id = (int) $l['indicador_id'];
            $out[] = alerta('serie:' . sha1($id . ',' . diaBrasilia()), 'grave', '@' . ($nomes[$id] ?? ('#' . $id)) . ' indicou '
                . plural((int) $l['n'], 'conta', 'contas') . ' em 24 h', (int) $l['n'], iso($l['m']), ['aba' => 'indicacoes', 'filtro' => 'indicador', 'id' => $id], true);
        }
        return $out;
    });
    regraAlerta($a, static function () use ($t): array {
        $semana = dt($t - 7 * 86400);
        $n = (int) umValor("SELECT COUNT(*) FROM indicacoes WHERE status = 'recusada' AND motivo = 'mesmo_aparelho' AND (criada_em >= ? OR validada_em >= ?)",
            [$semana, $semana]);
        return $n < 3 ? [] : [alerta('mesmo_aparelho', 'leve', plural($n, 'indicação recusada', 'indicações recusadas') . ' por mesmo aparelho em 7 dias',
            $n, null, ['aba' => 'indicacoes', 'filtro' => 'recusada'], false)];
    });
    regraAlerta($a, static function (): array {
        $grupos = array_slice(array_values(array_filter(gruposMulticontas(), static fn(array $g): bool => count($g['ids']) >= 3)), 0, 10);
        if (!$grupos) {
            return [];
        }
        $nomes = apelidosDe(array_merge(...array_map(static fn(array $g): array => array_slice($g['ids'], 0, 3), $grupos)));
        $out = [];
        foreach ($grupos as $g) {
            $mostrar = array_map(static fn(int $i): string => '@' . ($nomes[$i] ?? ('#' . $i)), array_slice($g['ids'], 0, 3));
            $out[] = alerta($g['chave'], $g['seIndicaram'] ? 'grave' : 'leve', count($g['ids']) . ' contas no mesmo aparelho (' . implode(', ', $mostrar)
                . (count($g['ids']) > 3 ? ', …' : '') . ')' . ($g['seIndicaram'] ? ' que se indicaram' : ''), count($g['ids']), $g['ultima'],
                ['aba' => 'indicacoes', 'filtro' => 'aparelho'], true);
        }
        return $out;
    });
    regraAlerta($a, static function () use ($t): array {
        $n = (int) umValor('SELECT COALESCE(SUM(n), 0) FROM tentativas WHERE chave = ? AND janela = ?', ['painel-todos:todos', intdiv($t, LENDA_JANELA_S)]);
        return $n < 30 ? [] : [alerta('painel_tentativas', 'grave', plural($n, 'tentativa', 'tentativas') . ' de entrar no painel nos últimos 10 min',
            $n, null, ['aba' => 'registro', 'filtro' => 'seguranca'], false)];
    });
    regraAlerta($a, static function () use ($dia): array {
        $n = (int) umValor("SELECT COUNT(*) FROM admin_log WHERE acao = 'dar_bonus' AND em >= ?", [$dia]);
        return $n < 10 ? [] : [alerta('bonus_admin', 'acao', plural($n, 'bônus dado', 'bônus dados') . ' à mão em 24 h — confira', $n, null,
            ['aba' => 'registro', 'filtro' => 'dar_bonus'], false)];
    });
    regraAlerta($a, static function () use ($dia): array {
        // S17: muitas ações destrutivas da mesma pessoa do painel em 24 h (conta do painel roubada?)
        $out = [];
        foreach (sql("SELECT COALESCE(quem, '?') AS q, COUNT(*) AS n FROM admin_log WHERE acao IN ('excluir_usuario', 'apagar_carreira') AND em >= ?
            GROUP BY q HAVING COUNT(*) >= 10", [$dia]) as $l) {
            $q = (string) $l['q'];
            $nome = nomeDeQuemAtencao($q);
            $out[] = alerta('abuso:' . sha1($q . ',' . diaBrasilia()), 'grave', plural((int) $l['n'], 'conta excluída ou carreira apagada',
                'contas excluídas ou carreiras apagadas') . ' em 24 h por ' . $nome . ' — confira', (int) $l['n'], null,
                ['aba' => 'registro', 'filtro' => 'quem', 'id' => $q], true);
        }
        return $out;
    });
    regraAlerta($a, static function () use ($t): array {
        $e = hallEstado();
        $em = is_array($e) ? paraTempo(str_replace(['T', 'Z'], [' ', ''], (string) ($e['em'] ?? ''))) : null;
        if ($em !== null && $em >= $t - 2 * hallIntervaloS()) {
            return [];
        }
        if (umValor('SELECT 1 FROM carreiras c WHERE ' . sqlCarreiraVisivel() . ' LIMIT 1') === null) {
            return [];
        }
        return [alerta('hall_atrasado', 'leve', $em === null ? 'O Hall público ainda não foi montado' : 'A fotografia do Hall tem ' . duracaoCurta($t - $em),
            0, $em !== null ? gmdate('Y-m-d\TH:i:s\Z', $em) : null, ['aba' => 'hall', 'filtro' => 'atualizar'], false)];
    });
    regraAlerta($a, static function () use ($t): array {
        $u = paraTempo((string) umValor('SELECT MAX(ultimo) FROM visitas'));
        return $u === null || $u >= $t - 7200 ? [] : [alerta('medicao_parada', 'leve', 'Nenhuma visita há ' . duracaoCurta($t - $u)
            . ': medição parada ou site fora do ar?', 0, gmdate('Y-m-d\TH:i:s\Z', $u), ['aba' => 'saude'], false)];
    });
    regraAlerta($a, static function () use ($t): array {
        $c = siteConfig();
        $em = [];
        foreach (sql("SELECT chave, atualizado_em FROM site_config WHERE chave IN ('manutencao', 'cadastro_aberto', 'aviso', 'avisos')") as $l) {
            $em[$l['chave']] = $l['atualizado_em'];
        }
        $out = [];
        if ($c['manutencao']) {
            $out[] = alerta('manutencao', 'acao', 'Manutenção ligada desde ' . dataHoraBrasilia($em['manutencao'] ?? null), 0, iso($em['manutencao'] ?? null),
                ['aba' => 'config'], false);
        }
        if (!$c['cadastro_aberto']) {
            $out[] = alerta('cadastro_fechado', 'acao', 'Cadastro fechado desde ' . dataHoraBrasilia($em['cadastro_aberto'] ?? null), 0,
                iso($em['cadastro_aberto'] ?? null), ['aba' => 'config'], false);
        }
        $velho = null;
        if ($c['aviso'] !== null && ($x = paraTempo($em['aviso'] ?? null)) !== null && $x < $t - 3 * 86400) {
            $velho = $x;
        }
        foreach ((array) $c['avisos'] as $av) {
            if (($av['ate'] ?? null) === null && ($x = paraTempo($em['avisos'] ?? null)) !== null && $x < $t - 3 * 86400) {
                $velho = $velho === null ? $x : min($velho, $x);
            }
        }
        if ($velho !== null) {
            $out[] = alerta('aviso_velho', 'leve', 'Aviso no ar há ' . intdiv($t - $velho, 86400) . ' dias', 0, gmdate('Y-m-d\TH:i:s\Z', $velho), ['aba' => 'config'], false);
        }
        return $out;
    });
    regraAlerta($a, static function (): array {
        // só a conta de emergência (a senha do arquivo de config) ou nenhuma: falta a conta pessoal do dono
        try {
            $n = (int) umValor('SELECT COUNT(*) FROM admin_contas WHERE ativo = 1 AND da_config = 0');
        } catch (PDOException) {
            $n = (int) umValor('SELECT COUNT(*) FROM admin_contas WHERE ativo = 1');
        }
        return $n > 0 ? [] : [alerta('sem_conta_admin', 'leve', 'Você entra com a senha única. Crie a sua conta.', 0, null, ['aba' => 'config', 'filtro' => 'conta'], false)];
    });
    regraAlerta($a, static function () use ($t): array {
        if ((int) umValor('SELECT COUNT(*) FROM usuarios') === 0) {
            return [];
        }
        $u = paraTempo((string) umValor("SELECT MAX(em) FROM admin_log WHERE acao IN ('backup', 'backup_guardar')"));
        if ($u !== null && $u >= $t - 7 * 86400) {
            return [];
        }
        return [alerta('backup_velho', 'leve', $u === null ? 'Nenhum backup baixado ainda' : 'Último backup há ' . intdiv($t - $u, 86400) . ' dias', 0,
            $u !== null ? gmdate('Y-m-d\TH:i:s\Z', $u) : null, ['aba' => 'config', 'filtro' => 'backup'], false)];
    });
    regraAlerta($a, static function () use ($dia): array {
        if (!esquemaV32()) {
            return [];
        }
        $n = (int) umValor('SELECT COUNT(*) FROM email_log WHERE ok = 0 AND em >= ?', [$dia]);
        return $n < 5 ? [] : [alerta('emails_falhando', 'grave', plural($n, 'e-mail falhou', 'e-mails falharam') . ' em 24 h', $n, null,
            ['aba' => 'registro', 'filtro' => 'emails'], false)];
    });
    regraAlerta($a, static function (): array {
        // §E: a cota dos e-mails de confirmação perto do fim (um balde com 80% ou mais): cheio, quem cadastra fica sem o código
        if (!esquemaV33()) {
            return [];
        }
        $c = cotaEmailsVerif();
        if (!$c) {
            return [];
        }
        $nomes = ['cadastro' => 'do cadastro', 'pedido' => 'do “Reenviar código”', 'jogador' => 'do “Reenviar código” de quem já jogou'];
        $cheio = array_values(array_filter($c, static fn(array $b): bool => $b['cheio']));
        $txt = 'Cota de e-mails de confirmação ' . ($cheio ? 'esgotada' : 'quase no fim') . ': ' . implode(', ', array_map(static fn(array $b): string =>
            ($nomes[$b['tipo']] ?? $b['tipo']) . ' (' . $b['n10'] . ' de ' . $b['max10'] . ' em 10 min, ' . $b['nDia'] . ' de ' . $b['maxDia'] . ' hoje)', $c));
        return [alerta('emails_cota', $cheio ? 'grave' : 'acao', $txt, count($c), null, ['aba' => 'registro', 'filtro' => 'emails'], false)];
    });
    regraAlerta($a, static function () use ($dia): array {
        // v3.3: mensagens do Fale conosco ainda novas (ninguém leu) há mais de 24 h
        if (!esquemaV33()) {
            return [];
        }
        $d = umaLinha("SELECT COUNT(*) AS n, MIN(criado_em) AS m FROM mensagens_suporte WHERE status = 'nova' AND criado_em < ?", [$dia]);
        $n = (int) ($d['n'] ?? 0);
        return $n === 0 ? [] : [alerta('suporte_parado', 'acao', plural($n, 'mensagem nova', 'mensagens novas') . ' no Fale conosco há mais de 24 h',
            $n, iso($d['m']), ['aba' => 'mensagens', 'filtro' => 'nova'], false)];
    });
    regraAlerta($a, static function (): array {
        // v3.3: candidatos a desafio esperando a conferência no jogo (ou o vencedor)
        if (!esquemaV33()) {
            return [];
        }
        $d = umaLinha("SELECT COUNT(*) AS n, MIN(em) AS m FROM desafio_candidatos WHERE estado IN ('pendente', 'verificada')");
        $n = (int) ($d['n'] ?? 0);
        return $n === 0 ? [] : [alerta('candidatos', 'acao', plural($n, 'candidato a desafio espera', 'candidatos a desafio esperam') . ' a sua decisão',
            $n, iso(substr((string) $d['m'], 0, 19) ?: null), ['aba' => 'desafios'], false)];
    });
    $ordem = ['grave' => 0, 'acao' => 1, 'leve' => 2];
    usort($a, static fn(array $x, array $y): int => $ordem[$x['nivel']] <=> $ordem[$y['nivel']]);
    return $a;
}

/** Nome de quem fez (a<id> → conta do painel), para o texto do alerta. */
function nomeDeQuemAtencao(string $q): string
{
    if (function_exists('nomeDeQuem')) {
        $n = nomeDeQuem($q);
        if ($n !== null) {
            return $n;
        }
    }
    return $q === '?' ? 'quem não ficou registrado' : $q;
}

/** {chave: {em, por}} das dispensas. */
function alertasLidos(): array
{
    return lerEstado(ALERTAS_LIDOS) ?? [];
}

/** O último cálculo (o de até 60 s, ou um novo). */
function atencaoCalculada(bool $forcar): array
{
    $e = lerEstado(ATENCAO_ESTADO);
    if ($forcar || !is_array($e) || !is_int($e['em'] ?? null) || $e['em'] <= time() - ATENCAO_TTL_S || !is_array($e['alertas'] ?? null)) {
        $e = ['em' => time(), 'geradoEm' => gmdate('Y-m-d\TH:i:s\Z'), 'alertas' => calcularAlertas()];
        try {
            gravarSiteConfig(ATENCAO_ESTADO, $e, 'auto');
        } catch (PDOException) {
            // sem gravar o cache: recalcula da próxima vez
        }
    }
    return $e;
}

/** GET admin.php?r=atencao → {geradoEm, alertas (sem os dispensados), dispensados: [{chave, texto, em, por}]}. */
function atencao(bool $forcar): array
{
    $e = atencaoCalculada($forcar);
    $lidos = alertasLidos();
    $ativos = [];
    $dispensados = [];
    foreach ($e['alertas'] as $al) {
        if ($al['dispensavel'] && isset($lidos[$al['chave']])) {
            $dispensados[] = ['chave' => $al['chave'], 'texto' => $al['texto'], 'em' => $lidos[$al['chave']]['em'] ?? null,
                'por' => $lidos[$al['chave']]['por'] ?? null];
        } else {
            $ativos[] = $al;
        }
    }
    return ['geradoEm' => $e['geradoEm'], 'alertas' => $ativos, 'dispensados' => $dispensados];
}

/**
 * alerta_dispensar: a chave tem de estar no último cálculo e ser dispensável. Gravado com trava de linha (duas
 * dispensas ao mesmo tempo não se perdem); no máximo 500 chaves (sai a mais antiga).
 */
function dispensarAlerta(string $chave): array
{
    $e = atencaoCalculada(false);
    $achado = null;
    foreach ($e['alertas'] as $al) {
        if ($al['chave'] === $chave) {
            $achado = $al;
            break;
        }
    }
    if ($achado === null && str_starts_with($chave, 'multi:')) {
        // "Está tudo certo" num cartão de Indicações → Mesmo aparelho: vale para todo grupo da lista (o de 2 contas e os
        // que passam dos 10 do "Precisa de atenção" também), não só para os que viraram alerta
        foreach (gruposMulticontas() as $g) {
            if ($g['chave'] === $chave) {
                $achado = alerta($chave, $g['seIndicaram'] ? 'grave' : 'leve', count($g['ids']) . ' contas no mesmo aparelho', count($g['ids']),
                    $g['ultima'], ['aba' => 'indicacoes', 'filtro' => 'aparelho'], true);
                break;
            }
        }
    }
    if ($achado === null) {
        erro(400, 'chave', 'Esse aviso não está mais na lista (a situação mudou). Atualize a página.');
    }
    if (!$achado['dispensavel']) {
        erro(400, 'nao_dispensavel', 'Esse aviso some sozinho quando a situação for resolvida.');
    }
    $quem = function_exists('admNome') ? admNome() : 'Admin';
    mexerLidos(static function (array $lidos) use ($chave, $achado, $quem): array {
        // só a hora e quem (o texto pode ter apelido: na lista ele vem do cálculo de agora)
        $lidos[$chave] = ['em' => gmdate('Y-m-d\TH:i:s\Z'), 'por' => $quem];
        if (count($lidos) > ALERTAS_LIDOS_MAX) {
            uasort($lidos, static fn(array $x, array $y): int => strcmp((string) ($y['em'] ?? ''), (string) ($x['em'] ?? '')));
            $lidos = array_slice($lidos, 0, ALERTAS_LIDOS_MAX, true);
        }
        return $lidos;
    });
    return $achado;
}

/** alerta_reabrir: tira a dispensa (idempotente). Devolve se ela existia. */
function reabrirAlerta(string $chave): bool
{
    $existia = false;
    mexerLidos(static function (array $lidos) use ($chave, &$existia): array {
        $existia = isset($lidos[$chave]);
        unset($lidos[$chave]);
        return $lidos;
    });
    return $existia;
}

function mexerLidos(callable $f): void
{
    transacao(static function () use ($f): void {
        sql('INSERT IGNORE INTO site_config (chave, valor, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?)', [ALERTAS_LIDOS, '{}', dt(time()), 'auto']);
        $v = umValor('SELECT valor FROM site_config WHERE chave = ? FOR UPDATE', [ALERTAS_LIDOS]);
        $lidos = is_string($v) ? json_decode($v, true) : null;
        $novo = $f(is_array($lidos) ? $lidos : []);
        gravarSiteConfig(ALERTAS_LIDOS, (object) $novo, function_exists('admQuem') ? admQuem() : 'admin');
    });
}

// ── pulso (P0-2, P1-13) ──────────────────────────────────────────────────────────────────────────

/** Começo de hoje (00:00 em Brasília) em DATETIME UTC. */
function inicioHojeUtc(): string
{
    return dt((int) strtotime(diaBrasilia() . ' 00:00:00 UTC') + LENDA_FUSO_H * 3600);
}

/** {grave, acao} dos alertas não dispensados do último cálculo, ou null se ele tem mais de 5 min. */
function alertasDoCache(): ?array
{
    $e = lerEstado(ATENCAO_ESTADO);
    if (!is_array($e) || !is_int($e['em'] ?? null) || $e['em'] <= time() - ATENCAO_PULSO_MAX_S || !is_array($e['alertas'] ?? null)) {
        return null;
    }
    $lidos = alertasLidos();
    $n = ['grave' => 0, 'acao' => 0];
    foreach ($e['alertas'] as $al) {
        if (($al['dispensavel'] ?? false) && isset($lidos[$al['chave'] ?? ''])) {
            continue;
        }
        if (isset($n[$al['nivel'] ?? ''])) {
            $n[$al['nivel']]++;
        }
    }
    return $n;
}

/**
 * Campos que o painel.php?so=agora acrescenta: {acao: {denunciasAbertas, ocultasPorDenuncia, suspeitas,
 * indicacoesPendentes, contasHoje}, alertas: {grave, acao}|null, filas: {denuncias, suspeitas, indicacoes}} (filas =
 * md5 dos ids dos 100 mais antigos de cada fila: mudou o hash, a lista aberta no painel mudou).
 */
function pulsoAdmin(): array
{
    $p = cacheCurto('pulso', 5, static function (): array {
        $l = umaLinha("SELECT (SELECT COUNT(*) FROM denuncias WHERE status = 'aberta') AS den,
               (SELECT COUNT(*) FROM carreiras WHERE oculta = 2) AS ocd,
               (SELECT COUNT(*) FROM carreiras WHERE suspeita IS NOT NULL AND oculta = 0) AS susp,
               (SELECT COUNT(*) FROM indicacoes WHERE status = 'pendente') AS indp,
               (SELECT COUNT(*) FROM usuarios WHERE criado_em >= ?) AS hoje", [inicioHojeUtc()]);
        $fila = static fn(string $q): string => md5(implode(',', sql($q)->fetchAll(PDO::FETCH_COLUMN)));
        return [
            'acao' => ['denunciasAbertas' => (int) $l['den'], 'ocultasPorDenuncia' => (int) $l['ocd'], 'suspeitas' => (int) $l['susp'],
                'indicacoesPendentes' => (int) $l['indp'], 'contasHoje' => (int) $l['hoje']],
            'filas' => [
                'denuncias' => $fila("SELECT carreira_pk FROM denuncias WHERE status = 'aberta' GROUP BY carreira_pk ORDER BY MIN(criada_em), carreira_pk LIMIT 100"),
                'suspeitas' => $fila('SELECT id FROM carreiras WHERE suspeita IS NOT NULL AND oculta = 0 ORDER BY id LIMIT 100'),
                'indicacoes' => $fila("SELECT id FROM indicacoes WHERE status = 'pendente' ORDER BY criada_em, id LIMIT 100"),
            ],
        ];
    });
    $v33 = cacheCurto('pulso33', 5, static function (): array {
        // v3.3: mensagens novas do Fale conosco e candidatos a desafio esperando decisão (0 sem o instalar.php da v3.3)
        if (!esquemaV33()) {
            return ['acao' => ['mensagensNovas' => 0, 'candidatosPendentes' => 0], 'filas' => ['mensagens' => md5('')]];
        }
        $l = umaLinha("SELECT (SELECT COUNT(*) FROM mensagens_suporte WHERE status = 'nova') AS msg,
            (SELECT COUNT(*) FROM desafio_candidatos WHERE estado IN ('pendente', 'verificada')) AS cand");
        return ['acao' => ['mensagensNovas' => (int) $l['msg'], 'candidatosPendentes' => (int) $l['cand']],
            'filas' => ['mensagens' => md5(implode(',', sql("SELECT id FROM mensagens_suporte WHERE status = 'nova' ORDER BY id DESC LIMIT 100")->fetchAll(PDO::FETCH_COLUMN)))]];
    });
    return ['acao' => $p['acao'] + $v33['acao'], 'alertas' => alertasDoCache(), 'filas' => $p['filas'] + $v33['filas']];
}

/** Contas `teste` e `oficial` (até 500): os números do painel sem "incluir robôs/testes" deixam as visitas delas de fora. */
function idsContasTeste(): array
{
    if (!esquemaV32()) {
        return [];
    }
    return array_map('intval', sql("SELECT id FROM usuarios WHERE tipo IN ('teste', 'oficial') ORDER BY id LIMIT 500")->fetchAll(PDO::FETCH_COLUMN));
}

/**
 * Chamado pelo registrarAdmin() (_admin.php) a cada linha nova do registro: os números do pulso, as contagens das listas
 * e os alertas são refeitos no próximo pedido (uma vez por pedido basta).
 */
function aoRegistrarAdmin(string $acao): void
{
    static $feito = false;
    if ($feito || $acao === 'exportar' || str_starts_with($acao, 'painel_') || $acao === 'negado') {
        return;
    }
    $feito = true;
    esquecerCachesAdmin(true);
}

<?php
/**
 * LENDA · testes da v3 (CONTRATO-v3.md): configuração do site, admin, suspensão, filtro de apelidos, Hall
 * público (publicar, plausibilidade, fotografia, filtros, denúncias), conquistas, indicações, bônus, carga
 * (2.000 contas, 6.000 carreiras no Hall) e concorrência. Incluído pelo teste.php (usa os ajudantes dele).
 */
declare(strict_types=1);

$URL_PAR = rtrim((string) getenv('LENDA_URL_PAR'), '/');
$ORIGEM_PAR = (string) getenv('LENDA_ORIGEM_PAR');
$SRC = (string) getenv('LENDA_SRC');

// ── ajudantes da v3 ──────────────────────────────────────────────────────────────────────────────

/** Apaga tudo o que é de conta (começa cada bloco de um estado conhecido). */
function limparContas(): void
{
    foreach (['hall_foto_clubes', 'hall_foto', 'denuncias', 'conquistas_usuario', 'indicacoes', 'bonus', 'carreiras', 'sessoes_login',
        'visitantes_usuarios', 'redefinicoes', 'usuarios', 'tentativas', 'admin_log'] as $t) {
        q("DELETE FROM $t");
    }
    q("DELETE FROM site_config WHERE chave IN ('_hall_foto', '_raridade')");
}

function entrarAdmin(): Navegador
{
    global $PAINEL_SENHA;
    resetarLimitesCurtos();
    $n = novoNav();
    $n->pedir('POST', '/api/painel.php', ['acao' => 'entrar', 'senha' => $PAINEL_SENHA]);
    return $n;
}

function admGet(string $qs): Resposta
{
    global $ADM;
    return $ADM->pedir('GET', '/api/admin.php?' . $qs);
}

function admPost(array $corpo): Resposta
{
    global $ADM;
    return $ADM->pedir('POST', '/api/admin.php', $corpo);
}

$CONTAS_N = 0;
/** Cria uma conta pelo cadastrar (limites curtos zerados antes). Devolve [navegador, id, U, vid]. */
function novaConta(string $apelido, array $extra = []): array
{
    global $CONTAS_N;
    resetarLimitesCurtos();
    $n = novoNav();
    $vid = $extra['vid'] ?? uuid4();
    $email = $extra['email'] ?? ('v3-' . (++$CONTAS_N) . '-' . bin2hex(random_bytes(3)) . '@exemplo.com');
    unset($extra['email']);
    $r = conta($n, ['acao' => 'cadastrar', 'apelido' => $apelido, 'email' => $email, 'senha' => 'senha-v3-' . $CONTAS_N, 'aceite' => true,
        'vid' => $vid] + $extra);
    if ($r->status !== 201) {
        checar("cadastro de $apelido para o teste", false, $r->resumo());
    }
    return [$n, (int) ($r->json['usuario']['id'] ?? 0), $r->json['usuario'] ?? [], $vid, $email];
}

$BASE_HALL = json_decode(canon(amostra('v-intenso-01')), false); // pico 98, nota 93, 24 temporadas, 1 Copa, 11 clubes

/**
 * Um HallEntry real (v-intenso-01) com o id e o que mudar: nota, pais, clubes (lista de clubId), jogador,
 * temporadas, gols, bolas, titulosExtra, pico, idade, bonus, modo, v (null = sem legacy.v).
 */
function hallEntry(string $id, array $m = []): stdClass
{
    global $BASE_HALL;
    $h = json_decode(canon($BASE_HALL), false);
    $h->id = $id;
    $h->career->id = $id;
    $h->legacy->v = 2;
    foreach ($m as $k => $v) {
        switch ($k) {
            case 'nota': $h->legacy->score = $v; break;
            case 'pais': $h->identity->nationality = $v; break;
            case 'jogador': $h->identity->surname = $v; break;
            case 'temporadas': $h->summary->seasons = $v; break;
            case 'gols': $h->summary->totals->goals = $v; break;
            case 'pico': $h->summary->peakOvr = $v; break;
            case 'idade': $h->career->age = $v; break;
            case 'bonus': $h->career->bonusOvr = $v; break;
            case 'modo': $h->mode = $v; break;
            case 'v':
                if ($v === null) {
                    unset($h->legacy->v);
                } else {
                    $h->legacy->v = $v;
                }
                break;
            case 'bolas':
                foreach ($h->summary->awards as $a) {
                    if ($a->award === 'ballon_dor') {
                        $a->count = $v;
                    }
                }
                break;
            case 'titulosExtra':
                $h->summary->trophies[] = (object) ['trophyId' => 'teste-copa', 'count' => $v, 'seasons' => []];
                break;
            case 'clubes':
                $h->summary->clubs = array_map(static fn(string $c): stdClass => (object) ['clubId' => $c, 'seasons' => 1, 'apps' => 10,
                    'goals' => 1, 'assists' => 0, 'trophies' => 0, 'loan' => false], $v);
                break;
        }
    }
    return $h;
}

function salvarC(Navegador $n, stdClass $h, string $como = 'manual'): Resposta
{
    resetarLimitesCurtos();
    return $n->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $h, 'como' => $como]);
}

function hallGet(string $qs = ''): Resposta
{
    global $anon;
    return $anon->pedir('GET', '/api/hall.php' . ($qs !== '' ? '?' . $qs : ''));
}

/** Põe a fotografia como feita há $min minutos (para testar o prazo sem esperar). */
function envelhecerFoto(int $min): void
{
    $e = json_decode((string) v("SELECT valor FROM site_config WHERE chave = '_hall_foto'"), true);
    if (is_array($e)) {
        $e['em'] = gmdate('Y-m-d\TH:i:s\Z', time() - $min * 60);
        q("UPDATE site_config SET valor = ? WHERE chave = '_hall_foto'", [json_encode($e)]);
    }
}

function idsHall(Resposta $r): array
{
    return array_column($r->json['itens'] ?? [], 'id');
}

function pkCarreira(string $carreiraId, int $uid): int
{
    return (int) v('SELECT id FROM carreiras WHERE carreira_id = ? AND usuario_id = ?', [$carreiraId, $uid]);
}

/** Roda código PHP com o _lib.php do servidor carregado e a config do teste (para as funções puras). */
function phpComLib(string $codigo): mixed
{
    global $CONFIG_ARQ;
    $api = dirname(__DIR__) . '/api';
    $pre = 'putenv(' . var_export('LENDA_CONFIG=' . $CONFIG_ARQ, true) . '); require ' . var_export("$api/_lib.php", true) . '; ';
    $saida = shell_exec('php -r ' . escapeshellarg($pre . $codigo) . ' 2>&1');
    $j = json_decode((string) $saida, true);
    if ($j === null) {
        checar('php -r com o _lib.php', false, substr((string) $saida, 0, 300));
    }
    return $j;
}

const CAMPOS_ITEM_HALL = ['apelido', 'bolasOuro', 'bonusOvr', 'clubes', 'copas', 'gols', 'headline', 'id', 'jogador', 'nota', 'numero', 'pais',
    'picoOvr', 'posicao', 'posicaoCampo', 'posicaoGeral', 'temporadas', 'terminouEm', 'titulos'];

// ══ v3.1 instalar.php num banco da v2 ════════════════════════════════════════════════════════════

secao('v3 · instalar.php num banco da v2 (acrescenta e preenche, sem apagar)');
limparContas();
q('DELETE FROM site_config');
foreach (['site_config', 'admin_log', 'hall_foto', 'hall_foto_clubes', 'denuncias', 'conquistas_usuario', 'indicacoes', 'bonus'] as $t) {
    q("DROP TABLE $t");
}
q('ALTER TABLE usuarios DROP COLUMN status, DROP COLUMN suspenso_ate, DROP COLUMN motivo_suspensao, DROP COLUMN codigo_convite,
    DROP COLUMN hall_publico, DROP COLUMN partidas_conta');
q('ALTER TABLE carreiras DROP COLUMN publica, DROP COLUMN oculta, DROP COLUMN suspeita, DROP COLUMN clubes, DROP COLUMN copas,
    DROP COLUMN bonus_ovr, DROP INDEX ix_carreiras_usuario_nota');
q("INSERT INTO usuarios (email, apelido, senha_hash, criado_em, origem, aceite_em, partidas) VALUES ('antiga@exemplo.com', 'Antiga', ?, UTC_TIMESTAMP(),
    'tiktok', UTC_TIMESTAMP(), 7)", [password_hash('senha-antiga', PASSWORD_DEFAULT)]);
$uidV2 = (int) v("SELECT id FROM usuarios WHERE email = 'antiga@exemplo.com'");
$hOk = hallEntry('v2-boa');
$hRuim = hallEntry('v2-ruim', ['gols' => 99999]);
foreach ([$hOk, $hRuim] as $h) {
    $js = canon($h);
    q("INSERT INTO carreiras (usuario_id, carreira_id, modo, jogador, nota, nota_v, pico_ovr, temporadas, gols, como, dados, tamanho, salva_em)
        VALUES (?, ?, 'classico', ?, ?, 2, ?, ?, ?, 'auto', ?, ?, UTC_TIMESTAMP())",
        [$uidV2, $h->id, $h->identity->surname, $h->legacy->score, $h->summary->peakOvr, $h->summary->seasons, $h->summary->totals->goals, gzencode($js), strlen($js)]);
}
$r = $anon->pedir('POST', '/api/instalar.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
$alt = $r->json['alteracoes'] ?? [];
checar('instalar na v2: 200 e as 16 tabelas', $r->status === 200 && ($r->json['tabelas'] ?? null) === $tabelasEsperadas, $r->resumo());
checar('instalar na v2: as colunas novas de usuarios e carreiras e o índice (usuario_id, nota)', count(array_intersect([
    'usuarios: coluna status', 'usuarios: coluna codigo_convite', 'usuarios: coluna hall_publico', 'usuarios: coluna partidas_conta',
    'usuarios: índice uq_usuarios_convite', 'carreiras: coluna publica', 'carreiras: coluna suspeita', 'carreiras: coluna clubes',
    'carreiras: coluna bonus_ovr', 'carreiras: índice ix_carreiras_usuario_nota'], $alt)) === 10, json_encode($alt));
checar('instalar na v2: preencheu o código de convite e as 2 carreiras antigas', ($r->json['preenchidas'] ?? null) === ['convites' => 1, 'carreiras' => 2, 'faltam' => 0],
    json_encode($r->json['preenchidas'] ?? null));
$cv = q('SELECT carreira_id, clubes, copas, suspeita, bonus_ovr, publica, oculta FROM carreiras WHERE usuario_id = ? ORDER BY carreira_id', [$uidV2]);
$clubesA1 = array_values(array_unique(array_map(static fn($c) => $c->clubId, $BASE_HALL->summary->clubs)));
checar('carreira antiga: clubes tirados do HallEntry, 1 Copa, sem suspeita, sem bônus, visível', ($cv[0]['carreira_id'] ?? '') === 'v2-boa'
    && ($cv[0]['clubes'] ?? '') === json_encode($clubesA1) && (int) $cv[0]['copas'] === 1 && $cv[0]['suspeita'] === null
    && (int) $cv[0]['bonus_ovr'] === 0 && (int) $cv[0]['publica'] === 0 && (int) $cv[0]['oculta'] === 0, json_encode($cv));
checar('carreira antiga com 99.999 gols vira suspeita (gols)', ($cv[1]['suspeita'] ?? '') === 'gols', json_encode($cv[1] ?? null));
$u2 = q('SELECT status, codigo_convite, hall_publico, partidas, partidas_conta FROM usuarios WHERE id = ?', [$uidV2])[0] ?? [];
checar('conta antiga: ativa, auto, código de 8 sem letras ambíguas, partidas preservadas', ($u2['status'] ?? '') === 'ativo' && ($u2['hall_publico'] ?? '') === 'auto'
    && preg_match('/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/', (string) ($u2['codigo_convite'] ?? '')) === 1 && (int) $u2['partidas'] === 7
    && (int) $u2['partidas_conta'] === 0, json_encode($u2));
$r = $anon->pedir('POST', '/api/instalar.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
checar('instalar de novo: nada a alterar nem a preencher', $r->status === 200 && ($r->json['alteracoes'] ?? null) === []
    && ($r->json['preenchidas'] ?? null) === ['convites' => 0, 'carreiras' => 0, 'faltam' => 0], $r->resumo());
$r = conta(novoNav(), ['acao' => 'entrar', 'email' => 'antiga@exemplo.com', 'senha' => 'senha-antiga']);
checar('a conta antiga entra e ganha hallPublico e codigoConvite no U', $r->status === 200 && ($r->json['usuario']['hallPublico'] ?? '') === 'auto'
    && ($r->json['usuario']['codigoConvite'] ?? '') === $u2['codigo_convite'], $r->resumo());

// ══ v3.2 configuração do site ════════════════════════════════════════════════════════════════════

secao('v3 · configuração do site (padrões, gravar pelo admin, validação)');
limparContas();
$ADM = entrarAdmin();
$r = $anon->pedir('GET', '/api/conta.php');
$padraoSite = ['imersivoPublico' => false, 'livePublica' => false, 'aviso' => null, 'manutencao' => false, 'cadastroAberto' => true,
    'bonus' => ['indicacao' => [2, 3, 5], 'compartilhar' => 2, 'liberaAposPartidas' => 3, 'maxIndicacoes' => 3]];
checar('GET conta.php: site com os padrões (Imersivo e Live fechados ao público)', $r->status === 200 && ($r->json['site'] ?? null) === $padraoSite, $r->resumo());
checar('GET conta.php: regras = padrão do arquivo de config', ($r->json['regras'] ?? null) === ['aposPartidas' => 5, 'obrigatorio' => false, 'lembrarACada' => 3]);
checar('site sem nada secreto (só as chaves do contrato)', array_keys($r->json['site'] ?? []) === array_keys($padraoSite));
$r = $anon->pedir('GET', '/api/admin.php?r=config');
checar('admin config sem admin → 401', $r->status === 401 && $r->erro() === 'nao_logado', $r->resumo());
$r = admGet('r=config');
checar('admin config: valores = padrões, nada gravado ainda', $r->status === 200 && ($r->json['valores'] ?? null) === ($r->json['padroes'] ?? 1)
    && ($r->json['valores']['hall_intervalo_min'] ?? 0) === 60 && ($r->json['atualizados'] ?? null) === [], $r->resumo());
$ruins = [
    [['hall_intervalo_min' => 59], 'hall_intervalo_min'],
    [['hall_intervalo_min' => 181], 'hall_intervalo_min'],
    [['hall_intervalo_min' => '60'], 'hall_intervalo_min'],
    [['bonus' => ['indicacao' => [], 'compartilhar' => 2, 'liberaAposPartidas' => 3, 'maxIndicacoes' => 3]], 'bonus'],
    [['bonus' => ['indicacao' => [2, 11], 'compartilhar' => 2, 'liberaAposPartidas' => 3, 'maxIndicacoes' => 3]], 'bonus'],
    [['bonus' => ['indicacao' => [2], 'compartilhar' => 2, 'liberaAposPartidas' => 51, 'maxIndicacoes' => 3]], 'bonus'],
    [['bonus' => ['indicacao' => [2], 'compartilhar' => 2]], 'bonus'],
    [['aviso' => ['texto' => '', 'tipo' => 'info']], 'aviso'],
    [['aviso' => ['texto' => str_repeat('a', 201), 'tipo' => 'info']], 'aviso'],
    [['aviso' => ['texto' => 'Oi', 'tipo' => 'urgente']], 'aviso'],
    [['regras' => ['aposPartidas' => 0, 'obrigatorio' => false, 'lembrarACada' => 3]], 'regras'],
    [['regras' => ['aposPartidas' => 5, 'obrigatorio' => 'nao', 'lembrarACada' => 3]], 'regras'],
    [['manutencao' => 'sim'], 'manutencao'],
    [['imersivo_publico' => 1], 'imersivo_publico'],
    [['segredo' => 'x'], 'segredo'],
    [['live_publica' => true, 'cadastro_aberto' => null], 'cadastro_aberto'],
];
foreach ($ruins as [$valores, $chave]) {
    $r = admPost(['acao' => 'config', 'valores' => $valores]);
    checar('config inválida (' . json_encode($valores, JSON_UNESCAPED_UNICODE) . ') → 400 config_invalida com a chave',
        $r->status === 400 && $r->erro() === 'config_invalida' && ($r->json['chave'] ?? '') === $chave && ($r->json['mensagem'] ?? '') !== '', $r->resumo());
}
foreach ([['acao' => 'config'], ['acao' => 'config', 'valores' => []], ['acao' => 'config', 'valores' => [1, 2]]] as $c) {
    $r = admPost($c);
    checar('config sem valores → 400', $r->status === 400 && $r->erro() === 'config_invalida', $r->resumo());
}
checar('nada inválido foi gravado (nem a live_publica que vinha junto)', (int) v("SELECT COUNT(*) FROM site_config WHERE chave NOT LIKE '\\_%'") === 0);
$novos = ['imersivo_publico' => true, 'aviso' => ['texto' => '  Manutenção hoje às 22h  ', 'tipo' => 'alerta'], 'hall_intervalo_min' => 90,
    'regras' => ['aposPartidas' => 4, 'obrigatorio' => true, 'lembrarACada' => 2], 'manutencao' => true,
    'bonus' => ['indicacao' => [1, 2], 'compartilhar' => 3, 'liberaAposPartidas' => 5, 'maxIndicacoes' => 4], 'cadastro_aberto' => true, 'live_publica' => true];
$r = admPost(['acao' => 'config', 'valores' => $novos]);
checar('config válida → 200 com os valores em vigor (texto do aviso limpo)', $r->status === 200 && ($r->json['valores']['aviso'] ?? null) === ['texto' => 'Manutenção hoje às 22h', 'tipo' => 'alerta']
    && ($r->json['valores']['hall_intervalo_min'] ?? 0) === 90 && ($r->json['valores']['bonus']['indicacao'] ?? null) === [1, 2], $r->resumo());
$r = $anon->pedir('GET', '/api/conta.php');
checar('GET conta.php reflete na hora: site e regras novos', ($r->json['site'] ?? null) === ['imersivoPublico' => true, 'livePublica' => true,
    'aviso' => ['texto' => 'Manutenção hoje às 22h', 'tipo' => 'alerta'], 'manutencao' => true, 'cadastroAberto' => true,
    'bonus' => ['indicacao' => [1, 2], 'compartilhar' => 3, 'liberaAposPartidas' => 5, 'maxIndicacoes' => 4]]
    && ($r->json['regras'] ?? null) === ['aposPartidas' => 4, 'obrigatorio' => true, 'lembrarACada' => 2], $r->resumo());
$log = q("SELECT acao, alvo, detalhes FROM admin_log WHERE acao = 'config'");
$det = json_decode((string) ($log[0]['detalhes'] ?? ''), true);
checar('config gravada vai para o admin_log (de → para, via painel)', count($log) === 1 && ($log[0]['alvo'] ?? '') === 'config'
    && ($det['via'] ?? '') === 'painel' && ($det['hall_intervalo_min'] ?? null) === ['de' => 60, 'para' => 90], (string) ($log[0]['detalhes'] ?? ''));
$r = admGet('r=config');
checar('admin config: atualizados com data e quem', ($r->json['atualizados']['bonus']['por'] ?? '') === 'painel'
    && preg_match($RE_ISO, (string) ($r->json['atualizados']['bonus']['em'] ?? '')) === 1, $r->resumo());
$r = $ADM->pedir('POST', '/api/admin.php', ['acao' => 'config', 'valores' => ['manutencao' => false]], ['origem' => false]);
checar('admin POST com o cookie e sem Origin → 403 (CSRF)', $r->status === 403 && $r->erro() === 'origem', $r->resumo());
$r = novoNav()->pedir('POST', '/api/admin.php', ['acao' => 'config', 'valores' => ['manutencao' => false]], ['origem' => false, 'auth' => 'Bearer ' . $PAINEL_TOKEN]);
checar('admin POST com o Bearer e sem Origin → 200 (script)', $r->status === 200 && ($r->json['valores']['manutencao'] ?? null) === false, $r->resumo());
checar('…e o log diz via token', str_contains((string) v("SELECT detalhes FROM admin_log ORDER BY id DESC LIMIT 1"), '"via":"token"'));
$r = novoNav()->pedir('POST', '/api/admin.php', 'acao=config', ['origem' => false, 'auth' => 'Bearer ' . $PAINEL_TOKEN, 'tipo' => 'application/x-www-form-urlencoded']);
checar('admin POST com o Bearer em formulário → 403', $r->status === 403, $r->resumo());
q("UPDATE site_config SET valor = '{\"quebrado' WHERE chave = 'bonus'");
q("UPDATE site_config SET valor = '999' WHERE chave = 'hall_intervalo_min'");
$r = $anon->pedir('GET', '/api/conta.php');
checar('valor estragado no banco: vale o padrão (sem 500)', $r->status === 200 && ($r->json['site']['bonus'] ?? null) === $padraoSite['bonus'], $r->resumo());
$r = admPost(['acao' => 'config', 'valores' => ['cadastro_aberto' => false]]);
[$navX] = [novoNav()];
resetarLimitesCurtos();
$r = conta($navX, ['acao' => 'cadastrar', 'apelido' => 'Fechado', 'email' => 'fechado@exemplo.com', 'senha' => 'qualquer123', 'aceite' => true]);
checar('cadastro_aberto = false → cadastrar dá 403 cadastro_fechado', $r->status === 403 && $r->erro() === 'cadastro_fechado' && !isset($navX->jar['lenda_sessao']), $r->resumo());
q("INSERT INTO usuarios (email, apelido, senha_hash, criado_em, origem, aceite_em) VALUES ('ja@exemplo.com', 'JaTinha', ?, UTC_TIMESTAMP(), 'direto', UTC_TIMESTAMP())",
    [password_hash('senha-ja-tinha', PASSWORD_DEFAULT)]);
$r = conta(novoNav(), ['acao' => 'entrar', 'email' => 'ja@exemplo.com', 'senha' => 'senha-ja-tinha']);
checar('…e entrar continua', $r->status === 200, $r->resumo());
// volta tudo ao padrão para os próximos blocos
$r = admPost(['acao' => 'config', 'valores' => configPadraoTeste()]);
checar('config de volta ao padrão', $r->status === 200 && ($r->json['valores']['hall_intervalo_min'] ?? 0) === 60 && ($r->json['valores']['imersivo_publico'] ?? true) === false, $r->resumo());

function configPadraoTeste(): array
{
    return ['regras' => ['aposPartidas' => 5, 'obrigatorio' => false, 'lembrarACada' => 3], 'imersivo_publico' => false, 'live_publica' => false,
        'aviso' => null, 'manutencao' => false, 'bonus' => ['indicacao' => [2, 3, 5], 'compartilhar' => 2, 'liberaAposPartidas' => 3, 'maxIndicacoes' => 3],
        'hall_intervalo_min' => 60, 'cadastro_aberto' => true];
}

// ══ v3.3 painel.php?so=eu e admin sem admin ══════════════════════════════════════════════════════

secao('v3 · painel.php?so=eu e admin.php sem admin');
$r = $anon->pedir('GET', '/api/painel.php?so=eu');
checar('so=eu sem admin → 401', $r->status === 401 && $r->erro() === 'nao_logado', $r->resumo());
$r = $ADM->pedir('GET', '/api/painel.php?so=eu');
checar('so=eu com o cookie do painel → {admin: true}', $r->status === 200 && $r->json === ['admin' => true], $r->resumo());
$r = novoNav()->pedir('GET', '/api/painel.php?so=eu', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
checar('so=eu com o Bearer → {admin: true}', $r->status === 200 && $r->json === ['admin' => true], $r->resumo());
[$navJog] = novaConta('Jogador Comum');
$r = $navJog->pedir('GET', '/api/painel.php?so=eu');
checar('so=eu com sessão de jogador (sem painel) → 401', $r->status === 401, $r->resumo());
$semAdmin = [];
foreach (['resumo', 'usuarios', 'usuario&id=1', 'hall', 'carreira&id=1', 'denuncias', 'config', 'indicacoes', 'conquistas', 'log', 'exportar&tipo=usuarios', 'xyz'] as $rota) {
    foreach ([$anon, $navJog] as $nv) {
        $r = $nv->pedir('GET', '/api/admin.php?r=' . $rota);
        if ($r->status !== 401) {
            $semAdmin[] = "GET $rota → $r->status";
        }
    }
}
foreach (['suspender', 'reativar', 'deslogar', 'renomear', 'excluir_usuario', 'dar_bonus', 'tirar_bonus', 'recusar_indicacao', 'ocultar_carreira',
    'mostrar_carreira', 'apagar_carreira', 'atualizar_hall', 'resolver_denuncia', 'config', 'xyz'] as $ac) {
    foreach ([$anon, $navJog] as $nv) {
        $r = $nv->pedir('POST', '/api/admin.php', ['acao' => $ac, 'id' => 1, 'bonusId' => 1, 'valores' => ['manutencao' => true]]);
        if ($r->status !== 401) {
            $semAdmin[] = "POST $ac → $r->status";
        }
    }
}
checar('admin.php: todas as rotas e ações sem admin (anônimo e jogador logado) → 401', !$semAdmin, implode(', ', $semAdmin));
$r = novoNav()->pedir('GET', '/api/admin.php?r=resumo', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN . 'x']);
checar('admin com Bearer errado → 401', $r->status === 401, $r->resumo());
checar('nenhuma tentativa sem admin mudou a config', (int) v("SELECT COUNT(*) FROM site_config WHERE chave = 'manutencao' AND valor = 'true'") === 0);
$r = admGet('r=xyz');
checar('rota desconhecida → 400 rota', $r->status === 400 && $r->erro() === 'rota', $r->resumo());
$r = admPost(['acao' => 'xyz']);
checar('ação desconhecida → 400 acao', $r->status === 400 && $r->erro() === 'acao', $r->resumo());
$r = $ADM->pedir('PUT', '/api/admin.php', ['acao' => 'config']);
checar('PUT no admin → 405', $r->status === 405, $r->resumo());

// ══ v3.4 filtro de apelidos ══════════════════════════════════════════════════════════════════════

secao('v3 · filtro de apelidos (palavrões, ofensas, nomes reservados)');
$proibidos = ['P0rr4', 'filho da puta', 'FilhoDaPuta', 'v1ad0', 'Macaco', 'MacacoLoko', 'Admin', 'Moderador123', 'LENDA', 'Suporte Oficial', 'caaaralho',
    'p.u.t.a', 'Hitler88', 'Viadinho', 'Sapatão', 'Crioulo', 'Fdp', 'Arrombado', 'Buc3t4', 'vai tomar no cu', 'VaiTomarNoCu', 'Nazista', 'Bichas',
    'm e r d a', 'Pu Ta', 'adm', 'OFICIAL', 'Fuck You', 'Estuprador', 'Retardado', 'Cuzão', 'P1R0C4', 'NIGGA'];
$permitidos = ['Cuiabá', 'Disputa', 'Computador', 'Controla', 'Bichano', 'Picanha', 'Pau Torres', 'Cucurella', 'Paulinho', 'Rolando', 'Macacão',
    'Lendário', 'Sport Recife', 'Vasco da Gama', 'Fogão', 'Craque10', 'Zé Ninguém', 'Foguete Azul', 'Deputado', 'Reputação', 'Enviado', 'Notário',
    'Pinto', 'Fodé', 'Corneta', 'Kun Agüero', 'Mac Allister', 'Bota Fogo', 'Peixe', 'Cristiano', 'Vini Jr', 'Marta', 'Rafaela', 'Escolinha', 'Picasso',
    'Coritiba', 'Bahia', 'Ceará', 'Grêmio', 'Cruzeiro', 'Bolívia', 'Bolivar', 'Pacaembu', 'Cucuta', 'Mosquito', 'Putz', 'Kaká', 'Tite'];
$res = phpComLib('echo json_encode([array_map(fn($a) => textoProibido($a), ' . var_export($proibidos, true) . '), array_map(fn($a) => textoProibido($a), '
    . var_export($permitidos, true) . ')]);');
$falsosNeg = array_values(array_filter(array_map(static fn($a, $x) => $x === null ? $a : null, $proibidos, $res[0] ?? []), 'is_string'));
$falsosPos = array_values(array_filter(array_map(static fn($a, $x) => $x !== null ? "$a ($x)" : null, $permitidos, $res[1] ?? []), 'is_string'));
checar('filtro barra ' . count($proibidos) . ' apelidos ofensivos/reservados (leet, acento, colado, soletrado, plural)', is_array($res) && !$falsosNeg, implode(', ', $falsosNeg));
checar('filtro deixa passar ' . count($permitidos) . ' apelidos comuns (clubes, jogadores, palavras com pedaço parecido)', is_array($res) && !$falsosPos, implode(', ', $falsosPos));
$res = phpComLib('echo json_encode([textoProibido("Admin Oficial", false), textoProibido("Porra", false), textoProibido("Admin"), textoProibido("Porra")]);');
checar('motivo: palavrao x reservado; sem reservados (admin), nome reservado passa', $res === [null, 'palavrao', 'reservado', 'palavrao'], json_encode($res));
$idsConquistas = [];
foreach (glob("$SRC/engine/career/achievements.ts") ?: [] as $arq) {
    preg_match_all("/\\bid: '([a-z0-9_.:-]+)'/", (string) file_get_contents($arq), $mm);
    $idsConquistas = array_merge($idsConquistas, $mm[1]);
}
$res = $idsConquistas ? phpComLib('echo json_encode(array_values(array_filter(' . var_export(array_values(array_unique($idsConquistas)), true)
    . ', fn($c) => textoProibido(str_replace(["_", ".", ":", "-"], " ", $c), false) !== null)));') : [];
checar('nenhuma conquista do jogo (' . count($idsConquistas) . ') é barrada pelo filtro da raridade', count($idsConquistas) > 50 && $res === [], json_encode($res));
foreach (['P0rr4', 'filho da puta', 'Admin', 'LENDA', 'Macaco'] as $ap) {
    resetarLimitesCurtos();
    $r = conta(novoNav(), ['acao' => 'cadastrar', 'apelido' => $ap, 'email' => 'f' . bin2hex(random_bytes(4)) . '@exemplo.com', 'senha' => 'qualquer123', 'aceite' => true]);
    checar("cadastrar com apelido \"$ap\" → 400 apelido_proibido", $r->status === 400 && $r->erro() === 'apelido_proibido' && ($r->json['mensagem'] ?? '') !== '', $r->resumo());
}
resetarLimitesCurtos();
$r = conta(novoNav(), ['acao' => 'cadastrar', 'apelido' => "Pu\u{0442}a", 'email' => 'cirilico@exemplo.com', 'senha' => 'qualquer123', 'aceite' => true]);
checar('apelido com letra cirílica parecida com latina → 400 apelido_invalido', $r->status === 400 && $r->erro() === 'apelido_invalido', $r->resumo());
$r = conta($navJog, ['acao' => 'perfil', 'apelido' => 'Merda Total']);
checar('perfil com apelido proibido → 400 apelido_proibido (o antigo fica)', $r->status === 400 && $r->erro() === 'apelido_proibido'
    && v("SELECT apelido FROM usuarios WHERE apelido = 'Jogador Comum'") === 'Jogador Comum', $r->resumo());
checar('nenhum apelido proibido entrou no banco', (int) v("SELECT COUNT(*) FROM usuarios WHERE apelido IN ('P0rr4', 'Admin', 'LENDA', 'Macaco', 'filho da puta')") === 0);

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
    foreach (['hall_foto_clubes', 'hall_foto', 'denuncias', 'conquistas_usuario', 'indicacoes', 'bonus', 'carreiras', 'carreiras_moderacao',
        'sessoes_login', 'visitantes_usuarios', 'redefinicoes', 'usuarios', 'tentativas', 'admin_log'] as $t) {
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
 * temporadas, gols, bolas, titulosExtra, copas (Copas do Mundo), pico, idade, bonus, modo, v (null = sem legacy.v),
 * headline, comparacao (mais uma frase), careerNome / careerPais (só o career.identity, como um HallEntry forjado).
 * Como no jogo, identity e career.identity andam juntos (jogador e pais mudam os dois).
 */
function hallEntry(string $id, array $m = []): stdClass
{
    global $BASE_HALL;
    $h = json_decode(canon($BASE_HALL), false);
    $h->id = $id;
    $h->career->id = $id;
    $h->legacy->v = 2;
    // cada carreira de teste com um resumo só dela (duas carreiras de verdade nunca têm o mesmo resumo; o servidor
    // trata o mesmo resumo em outra conta como cópia)
    $h->summary->testeId = $id;
    foreach ($m as $k => $v) {
        switch ($k) {
            case 'nota': $h->legacy->score = $v; break;
            case 'pais': $h->identity->nationality = $v; $h->career->identity->nationality = $v; break;
            case 'jogador': $h->identity->surname = $v; $h->career->identity->surname = $v; break;
            case 'careerNome': $h->career->identity->surname = $v; break;
            case 'careerPais': $h->career->identity->nationality = $v; break;
            case 'headline': $h->summary->headline = $v; break;
            case 'comparacao': $h->summary->comparisons[] = $v; break;
            case 'copas': $h->summary->trophies[] = (object) ['trophyId' => 'world-cup', 'count' => $v - 1, 'seasons' => []]; break;
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

/**
 * Salva na conta. Carreira de nota extraordinária (90+) fica esperando a revisão do admin (suspeita "revisao"):
 * com $liberar, o teste faz o papel do admin e libera logo depois (como o mostrar_carreira). A resposta é a do
 * salvar (de antes da liberação).
 */
function salvarC(Navegador $n, stdClass $h, string $como = 'manual', bool $liberar = true): Resposta
{
    resetarLimitesCurtos();
    if (function_exists('v33AntesDeSalvar')) {
        v33AntesDeSalvar($n, $h); // v3.3 §E (teste-v33.php): a semente do replay como sorteada pelo servidor para a conta
    }
    $r = $n->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $h, 'como' => $como]);
    if ($liberar && $r->status === 200) {
        q("UPDATE carreiras SET suspeita = NULL WHERE carreira_id = ? AND suspeita = 'revisao'", [(string) $h->id]);
    }
    return $r;
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

// v3.4: + emblemas e emblemasTotal (CONTRATO-v34 §A)
const CAMPOS_ITEM_HALL = ['apelido', 'bolasOuro', 'bonusOvr', 'clubes', 'copas', 'destaque', 'emblemas', 'emblemasTotal', 'gols', 'headline', 'id', 'jogador', 'nota',
    'numero', 'pais', 'perfil', 'picoOvr', 'posicao', 'posicaoCampo', 'posicaoGeral', 'temporadas', 'terminouEm', 'titulos'];

// ══ v3.1 instalar.php num banco da v2 ════════════════════════════════════════════════════════════

secao('v3 · instalar.php num banco da v2 (acrescenta e preenche, sem apagar)');
limparContas();
q('DELETE FROM site_config');
foreach (['site_config', 'admin_log', 'hall_foto', 'hall_foto_clubes', 'denuncias', 'conquistas_usuario', 'indicacoes', 'bonus', 'carreiras_moderacao',
    'partidas_vid'] as $t) {
    q("DROP TABLE $t");
}
q('ALTER TABLE eventos DROP COLUMN nota');
q('ALTER TABLE usuarios DROP COLUMN status, DROP COLUMN suspenso_ate, DROP COLUMN motivo_suspensao, DROP COLUMN codigo_convite,
    DROP COLUMN hall_publico, DROP COLUMN partidas_conta');
q('ALTER TABLE carreiras DROP COLUMN publica, DROP COLUMN oculta, DROP COLUMN suspeita, DROP COLUMN clubes, DROP COLUMN copas,
    DROP COLUMN bonus_ovr, DROP COLUMN resumo_hash, DROP INDEX ix_carreiras_usuario_nota, DROP INDEX ix_carreiras_carreira');
q("INSERT INTO usuarios (email, apelido, senha_hash, criado_em, origem, aceite_em, partidas) VALUES ('antiga@exemplo.com', 'Antiga', ?, UTC_TIMESTAMP(),
    'tiktok', UTC_TIMESTAMP(), 7)", [password_hash('senha-antiga', PASSWORD_DEFAULT)]);
$uidV2 = (int) v("SELECT id FROM usuarios WHERE email = 'antiga@exemplo.com'");
$hOk = hallEntry('v2-boa', ['nota' => 89]);
$hRuim = hallEntry('v2-ruim', ['gols' => 99999]);
$hTop = hallEntry('v2-top'); // nota 93: extraordinária, espera a revisão do admin
foreach ([$hOk, $hRuim, $hTop] as $h) {
    $js = canon($h);
    q("INSERT INTO carreiras (usuario_id, carreira_id, modo, jogador, nota, nota_v, pico_ovr, temporadas, gols, como, dados, tamanho, salva_em)
        VALUES (?, ?, 'classico', ?, ?, 2, ?, ?, ?, 'auto', ?, ?, UTC_TIMESTAMP())",
        [$uidV2, $h->id, $h->identity->surname, $h->legacy->score, $h->summary->peakOvr, $h->summary->seasons, $h->summary->totals->goals, gzencode($js), strlen($js)]);
}
$r = $anon->pedir('POST', '/api/instalar.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
$alt = $r->json['alteracoes'] ?? [];
checar('instalar na v2: 200 e as 16 tabelas', $r->status === 200 && ($r->json['tabelas'] ?? null) === $tabelasEsperadas, $r->resumo());
checar('instalar na v2: as colunas novas de usuarios, carreiras e eventos e os índices', count(array_intersect([
    'usuarios: coluna status', 'usuarios: coluna codigo_convite', 'usuarios: coluna hall_publico', 'usuarios: coluna partidas_conta',
    'usuarios: índice uq_usuarios_convite', 'carreiras: coluna publica', 'carreiras: coluna suspeita', 'carreiras: coluna clubes',
    'carreiras: coluna bonus_ovr', 'carreiras: índice ix_carreiras_usuario_nota', 'carreiras: coluna resumo_hash', 'carreiras: índice ix_carreiras_carreira',
    'eventos: coluna nota'], $alt)) === 13, json_encode($alt));
$pre = $r->json['preenchidas'] ?? [];
checar('instalar na v2: preencheu o código de convite e as 3 carreiras antigas (com o hash do resumo); partidas por aparelho a partir dos eventos',
    ($pre['convites'] ?? -1) === 1 && ($pre['carreiras'] ?? -1) === 3 && ($pre['resumos'] ?? -1) === 0 && ($pre['moderacao'] ?? -1) === 0
    && is_int($pre['partidasVid'] ?? null) && ($pre['faltam'] ?? -1) === 0 && (int) v('SELECT COUNT(*) FROM carreiras WHERE resumo_hash IS NULL') === 0,
    json_encode($pre));
$cv = q('SELECT carreira_id, clubes, copas, suspeita, bonus_ovr, publica, oculta, resumo_hash FROM carreiras WHERE usuario_id = ? ORDER BY carreira_id', [$uidV2]);
$clubesA1 = array_values(array_unique(array_map(static fn($c) => $c->clubId, $BASE_HALL->summary->clubs)));
checar('carreira antiga: clubes tirados do HallEntry, 1 Copa, sem suspeita, sem bônus, visível', ($cv[0]['carreira_id'] ?? '') === 'v2-boa'
    && ($cv[0]['clubes'] ?? '') === json_encode($clubesA1) && (int) $cv[0]['copas'] === 1 && $cv[0]['suspeita'] === null
    && (int) $cv[0]['bonus_ovr'] === 0 && (int) $cv[0]['publica'] === 0 && (int) $cv[0]['oculta'] === 0 && strlen((string) $cv[0]['resumo_hash']) === 40, json_encode($cv));
checar('carreira antiga com 99.999 gols vira suspeita (gols)', ($cv[1]['suspeita'] ?? '') === 'gols', json_encode($cv[1] ?? null));
checar('carreira antiga de nota 93 espera a revisão do admin (revisao)', ($cv[2]['suspeita'] ?? '') === 'revisao', json_encode($cv[2] ?? null));
$u2 = q('SELECT status, codigo_convite, hall_publico, partidas, partidas_conta FROM usuarios WHERE id = ?', [$uidV2])[0] ?? [];
checar('conta antiga: ativa, auto, código de 8 sem letras ambíguas, partidas preservadas', ($u2['status'] ?? '') === 'ativo' && ($u2['hall_publico'] ?? '') === 'auto'
    && preg_match('/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/', (string) ($u2['codigo_convite'] ?? '')) === 1 && (int) $u2['partidas'] === 7
    && (int) $u2['partidas_conta'] === 0, json_encode($u2));
$r = $anon->pedir('POST', '/api/instalar.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
checar('instalar de novo: nada a alterar nem a preencher', $r->status === 200 && ($r->json['alteracoes'] ?? null) === []
    && ($r->json['preenchidas'] ?? null) === ['convites' => 0, 'carreiras' => 0, 'resumos' => 0, 'moderacao' => 0, 'partidasVid' => 0, 'faltam' => 0], $r->resumo());
$r = conta(novoNav(), ['acao' => 'entrar', 'email' => 'antiga@exemplo.com', 'senha' => 'senha-antiga']);
checar('a conta antiga entra e ganha hallPublico e codigoConvite no U', $r->status === 200 && ($r->json['usuario']['hallPublico'] ?? '') === 'auto'
    && ($r->json['usuario']['codigoConvite'] ?? '') === $u2['codigo_convite'], $r->resumo());

// ══ v3.2 configuração do site ════════════════════════════════════════════════════════════════════

secao('v3 · configuração do site (padrões, gravar pelo admin, validação)');
limparContas();
$ADM = entrarAdmin();
$r = $anon->pedir('GET', '/api/conta.php');
$padraoSite = ['imersivoPublico' => false, 'livePublica' => false, 'aviso' => null, 'manutencao' => false, 'cadastroAberto' => true,
    'bonus' => ['indicacao' => [2, 3, 5], 'compartilhar' => 2, 'liberaAposPartidas' => 3, 'maxIndicacoes' => 3], 'avisos' => []]; // v3.2: avisos
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
    'bonus' => ['indicacao' => [1, 2], 'compartilhar' => 3, 'liberaAposPartidas' => 5, 'maxIndicacoes' => 4], 'avisos' => []]
    && ($r->json['regras'] ?? null) === ['aposPartidas' => 4, 'obrigatorio' => true, 'lembrarACada' => 2], $r->resumo());
$log = q("SELECT acao, alvo, detalhes FROM admin_log WHERE acao = 'config'");
$det = json_decode((string) ($log[0]['detalhes'] ?? ''), true);
checar('config gravada vai para o admin_log (de → para, via painel)', count($log) === 1 && ($log[0]['alvo'] ?? '') === 'config'
    && ($det['via'] ?? '') === 'painel' && ($det['hall_intervalo_min'] ?? null) === ['de' => 60, 'para' => 90], (string) ($log[0]['detalhes'] ?? ''));
$r = admGet('r=config');
// v3.2: "por" = quem gravou (a<id> da conta do painel; na v3 era só "painel")
checar('admin config: atualizados com data e quem', preg_match('/^(painel|a\d+)$/', (string) ($r->json['atualizados']['bonus']['por'] ?? '')) === 1
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
// letras "disfarçadas" (largura total, versalete, ø, ı, IPA) e o l no lugar do I: não passam
foreach (["\u{FF50}\u{FF55}\u{FF54}\u{FF41}", "\u{1D18}\u{1D1C}\u{1D1B}\u{1D00}", "\u{FF2D}\u{FF45}\u{FF52}\u{FF44}\u{FF41}", "viad\u{F8}", "p\u{131}roca",
    "put\u{251}", "k\u{280}\u{29F}", 'ADMlN', 'Oflcial', "Pu\u{0442}a10"] as $ap) {
    resetarLimitesCurtos();
    $r = conta(novoNav(), ['acao' => 'cadastrar', 'apelido' => $ap, 'email' => 'u' . bin2hex(random_bytes(4)) . '@exemplo.com', 'senha' => 'qualquer123', 'aceite' => true]);
    checar('cadastrar com apelido disfarçado ' . json_encode($ap) . ' → 400', $r->status === 400 && in_array($r->erro(), ['apelido_invalido', 'apelido_proibido'], true), $r->resumo());
}
$res = phpComLib('echo json_encode(array_map(fn($a) => [$a, normalizarFiltro($a), textoProibido($a)], ["\u{FF50}\u{FF55}\u{FF54}\u{FF41}", "\u{1D18}\u{1D1C}\u{1D1B}\u{1D00}", "viad\u{F8}", "p\u{131}roca", "k\u{280}\u{29F}", "ADMlN"]));');
checar('o filtro transforma as letras disfarçadas em a-z (puta, puta, viado, piroca, krl) e pega o ADMlN', is_array($res)
    && array_column($res, 1) === ['puta', 'puta', 'viado', 'piroca', 'krl', 'admln'] && !in_array(null, array_column($res, 2), true), json_encode($res, JSON_UNESCAPED_UNICODE));
resetarLimitesCurtos();
$r = conta(novoNav(), ['acao' => 'cadastrar', 'apelido' => "Ze\u{301} Nu\u{301}n\u{303}ez", 'email' => 'nfd@exemplo.com', 'senha' => 'qualquer123', 'aceite' => true]);
checar('apelido com acento decomposto (NFD) passa e é guardado composto (NFC)', $r->status === 201 && ($r->json['usuario']['apelido'] ?? '') === "Z\u{E9} N\u{FA}\u{F1}ez", $r->resumo());
$res = phpComLib('$d = json_decode(file_get_contents(' . var_export("$SRC/data/generated/game-data.json", true) . '), true); $n = 0; $ruins = [];'
    . ' foreach ($d["clubs"] as $c) { foreach (array_unique(array_filter([$c["shortName"] ?? null, $c["name"] ?? null])) as $nm) {'
    . ' foreach (["Lenda do $nm", "Lenda da $nm", "Ídolo do $nm", "Ídolo da $nm"] as $hl) { $n++; if (textoProibido($hl, false) !== null) $ruins[] = $hl; } } }'
    . ' echo json_encode([$n, $ruins]);');
checar('nenhum título de carreira com nome de clube do jogo ("Lenda do …", "Ídolo da …") é barrado pelo filtro (' . (int) ($res[0] ?? 0) . ')',
    is_array($res) && ($res[0] ?? 0) > 2000 && ($res[1] ?? null) === [], json_encode(array_slice($res[1] ?? [], 0, 10), JSON_UNESCAPED_UNICODE));
$res = phpComLib('require ' . var_export(dirname(__DIR__) . '/api/_carreiras.php', true) . '; $out = [];'
    . ' foreach (glob(' . var_export("$AMOSTRAS/*.json", true) . ') as $f) { $h = json_decode(file_get_contents($f), false); $x = extrairCampos($h);'
    . ' $ruins = array_values(array_filter($x["textos"], fn($t) => textoProibido($t, false) !== null));'
    . ' $out[basename($f)] = [count($x["textos"]), $ruins, nomeJogadorSeguro($x["nomes"][0]) && nomeJogadorSeguro($x["nomes"][1]), $x["dados_ok"], strlen((string) $x["resumo_hash"])]; }'
    . ' echo json_encode($out);');
checar('carreiras reais: os textos do resumo (nome, título, comparações, torneios) passam no filtro, nomes seguros, identity = career.identity',
    is_array($res) && count($res) === 3 && !array_filter($res, static fn($x) => $x[0] < 5 || $x[1] !== [] || $x[2] !== true || $x[3] !== true || $x[4] !== 40),
    json_encode($res, JSON_UNESCAPED_UNICODE));
$r = conta($navJog, ['acao' => 'perfil', 'apelido' => 'Merda Total']);
checar('perfil com apelido proibido → 400 apelido_proibido (o antigo fica)', $r->status === 400 && $r->erro() === 'apelido_proibido'
    && v("SELECT apelido FROM usuarios WHERE apelido = 'Jogador Comum'") === 'Jogador Comum', $r->resumo());
checar('nenhum apelido proibido entrou no banco', (int) v("SELECT COUNT(*) FROM usuarios WHERE apelido IN ('P0rr4', 'Admin', 'LENDA', 'Macaco', 'filho da puta')") === 0);

// ══ v3.5 carreiras: C novo, plausibilidade, publicar ═════════════════════════════════════════════

secao('v3 · carreiras: noHall, plausibilidade (suspeita fica fora), colunas novas');
limparContas();
$ADM = entrarAdmin();
[$navP, $uidP] = novaConta('Publicador');
$r = salvarC($navP, hallEntry('p-93', ['nota' => 93]), 'auto', false);
$c = $r->json['carreira'] ?? [];
checar('salvar (v=2, plausível, nota 93) → C com publica false, bonusOvr 0 e fora do Hall: nota extraordinária espera a revisão', $r->status === 200
    && ($c['publica'] ?? null) === false && ($c['noHall'] ?? null) === false && ($c['bonusOvr'] ?? null) === 0 && ($c['notaV'] ?? null) === 2, $r->resumo());
$row = q('SELECT clubes, copas, suspeita, bonus_ovr, publica, oculta, resumo_hash FROM carreiras WHERE carreira_id = ?', ['p-93'])[0] ?? [];
checar('colunas novas: clubes (JSON dos clubId, sem repetir), copas 1, suspeita revisao, hash do resumo', ($row['clubes'] ?? '') === json_encode($clubesA1)
    && (int) $row['copas'] === 1 && $row['suspeita'] === 'revisao' && (int) $row['oculta'] === 0 && strlen((string) $row['resumo_hash']) === 40, json_encode($row));
$r = admGet('r=hall&filtro=revisao');
checar('admin hall filtro=revisao: a de nota 93 está na fila; o resumo conta 1 esperando revisão', $r->status === 200 && ($r->json['filtro'] ?? '') === 'revisao'
    && array_column($r->json['itens'] ?? [], 'carreiraId') === ['p-93'] && (admGet('r=resumo')->json['carreiras']['emRevisao'] ?? 0) === 1, $r->resumo());
admPost(['acao' => 'mostrar_carreira', 'id' => pkCarreira('p-93', $uidP)]);
$r = $navP->pedir('GET', '/api/carreiras.php');
checar('o admin libera (mostrar_carreira) → entra no Hall (noHall true)', (array_column($r->json['carreiras'] ?? [], 'noHall', 'id')['p-93'] ?? null) === true, $r->resumo());
$r = salvarC($navP, hallEntry('p-93', ['nota' => 93]), 'auto', false);
checar('salvar de novo a mesma carreira (igual): continua liberada', ($r->json['carreira']['noHall'] ?? null) === true
    && v("SELECT suspeita FROM carreiras WHERE carreira_id = 'p-93'") === null, $r->resumo());
foreach ([80, 70, 60] as $n) {
    salvarC($navP, hallEntry("p-$n", ['nota' => $n]));
}
salvarC($navP, hallEntry('p-semv', ['nota' => 99, 'v' => null]));
salvarC($navP, hallEntry('p-v1', ['nota' => 98, 'v' => 1]));
$r = $navP->pedir('GET', '/api/carreiras.php');
$noHall = [];
foreach ($r->json['carreiras'] ?? [] as $x) {
    $noHall[$x['id']] = $x['noHall'];
}
ksort($noHall);
checar('lista: hallPublico auto, hallMax 3', ($r->json['hallPublico'] ?? '') === 'auto' && ($r->json['hallMax'] ?? 0) === 3, $r->resumo());
checar('auto: as 3 de maior nota (versão atual) entram; a 4ª e as de outra versão (sem v, v=1) não', $noHall === ['p-60' => false, 'p-70' => true,
    'p-80' => true, 'p-93' => true, 'p-semv' => false, 'p-v1' => false], json_encode($noHall));
checar('nota de outra versão não vira suspeita (só fica fora pelo nota_v)', (int) v("SELECT COUNT(*) FROM carreiras WHERE carreira_id IN ('p-semv', 'p-v1') AND suspeita IS NULL") === 2);

$suspeitas = [
    ['s-temporadas', ['temporadas' => 31], 'temporadas'],
    ['s-temporadas0', ['temporadas' => 0], 'temporadas,gols,bolas,titulos'],
    ['s-pico', ['pico' => 100], 'pico'],
    ['s-pico-baixo', ['pico' => 39], 'pico,nota'],
    ['s-nota', ['nota' => 101], 'nota'],
    ['s-nota-neg', ['nota' => -1], 'nota'],
    ['s-gols', ['gols' => 90 * 24 + 1], 'gols'],
    ['s-gols-ok', ['gols' => 90 * 24], null],
    ['s-bolas', ['bolas' => 25], 'bolas'],
    ['s-titulos', ['titulosExtra' => 15 * 24 - 37 + 1], 'titulos'],
    ['s-titulos-ok', ['titulosExtra' => 15 * 24 - 37], null],
    ['s-idade', ['idade' => 46], 'idade'],
    ['s-idade-ok', ['idade' => 45], null],
    ['s-bonus', ['bonus' => 3], 'bonus'],
    ['s-nome', ['jogador' => 'PORRA'], 'nome'],
    ['s-nome-leet', ['jogador' => 'V1AD0'], 'nome'],
    ['s-dois', ['gols' => 99999, 'bolas' => 30], 'gols,bolas'],
    ['s-bolas-todas', ['bolas' => 24], 'bolas'],
    ['s-bolas-ok', ['bolas' => 23], null],
    ['s-copas', ['copas' => 8], 'copas'],
    ['s-copas-ok', ['copas' => 7], null],
    ['s-nota-pico', ['nota' => 85, 'pico' => 84], 'nota'],
    ['s-forjada', ['nota' => 100, 'pico' => 62, 'temporadas' => 12, 'gols' => 10, 'bolas' => 0], 'nota'],
    ['s-headline', ['headline' => 'Lenda do Flamengo, filho da puta'], 'nome'],
    ['s-comparacao', ['comparacao' => 'Mais gols que Pelé, seu merda'], 'nome'],
    ['s-career-nome', ['careerNome' => 'FILHO DA PUTA'], 'nome,dados'],
    ['s-career-pais', ['careerPais' => 'BOL'], 'dados'],
    ['s-unicode', ['jogador' => "\u{1D18}\u{1D1C}\u{1D1B}\u{1D00}"], 'nome'],
    ['s-alfa', ['jogador' => "PUT\u{251}"], 'nome'],
    ['s-cirilico', ['jogador' => "SIL\u{0412}A"], 'nome'],
    ['s-polones', ['jogador' => "\u{141}UKASZEWSKI"], null],
    ['s-apostrofo', ['jogador' => "O'NEIL-SØRENSEN"], null],
];
foreach ($suspeitas as [$id, $mut, $esperado]) {
    $r = salvarC($navP, hallEntry($id, $mut + ['nota' => 89]));
    $s = v('SELECT suspeita FROM carreiras WHERE carreira_id = ? AND usuario_id = ?', [$id, $uidP]);
    checar("plausibilidade $id → " . ($esperado ?? 'ok'), $r->status === 200 && $s === $esperado && ($r->json['carreira']['noHall'] ?? null) === ($esperado === null),
        var_export($s, true) . ' ' . $r->resumo());
    if ($esperado === null) {
        $navP->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => $id]); // não toma o lugar das 3 melhores
    }
}
// limpa as plausíveis de nota 89 (senão tomam o lugar das 3 melhores)
foreach (['s-gols-ok', 's-titulos-ok', 's-idade-ok', 's-bolas-ok', 's-copas-ok', 's-polones', 's-apostrofo'] as $id) {
    $navP->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => $id]);
}
$r = salvarC($navP, hallEntry('s-revisao', ['nota' => 95]), 'manual', false);
checar('plausibilidade s-revisao (nota 95, tudo certo) → revisao (só ela, fora do Hall)', v("SELECT suspeita FROM carreiras WHERE carreira_id = 's-revisao'") === 'revisao'
    && ($r->json['carreira']['noHall'] ?? null) === false, $r->resumo());
$r = salvarC($navP, hallEntry('s-revisao-gols', ['nota' => 95, 'gols' => 99999]), 'manual', false);
checar('nota 95 com outro motivo → só o outro motivo (gols)', v("SELECT suspeita FROM carreiras WHERE carreira_id = 's-revisao-gols'") === 'gols', $r->resumo());
$navP->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => 's-revisao-gols']);
// admin libera uma suspeita; salvar de novo com os mesmos números não volta a suspeitar; mudar os números, sim
$pkGols = pkCarreira('s-gols', $uidP);
$r = admPost(['acao' => 'mostrar_carreira', 'id' => $pkGols]);
checar('admin mostrar_carreira libera a suspeita', $r->status === 200 && v('SELECT suspeita FROM carreiras WHERE id = ?', [$pkGols]) === null, $r->resumo());
salvarC($navP, hallEntry('s-gols', ['gols' => 90 * 24 + 1, 'nota' => 89]));
checar('salvar de novo a mesma carreira: continua liberada', v('SELECT suspeita FROM carreiras WHERE id = ?', [$pkGols]) === null);
salvarC($navP, hallEntry('s-gols', ['gols' => 90 * 24 + 5, 'nota' => 89]));
checar('salvar com os números mudados: volta a suspeita', v('SELECT suspeita FROM carreiras WHERE id = ?', [$pkGols]) === 'gols');
$pkHl = pkCarreira('s-headline', $uidP);
admPost(['acao' => 'mostrar_carreira', 'id' => $pkHl]);
salvarC($navP, hallEntry('s-headline', ['headline' => 'Lenda do Flamengo, filho da puta', 'nota' => 89]));
checar('liberada pelo admin e salva igual: continua liberada', v('SELECT suspeita FROM carreiras WHERE id = ?', [$pkHl]) === null);
salvarC($navP, hallEntry('s-headline', ['headline' => 'Lenda do Flamengo, seu bosta', 'nota' => 89]));
checar('mesmos números, mas um texto novo (o título): volta a ser conferida (nome)', v('SELECT suspeita FROM carreiras WHERE id = ?', [$pkHl]) === 'nome');
$r = $navP->pedir('GET', '/api/carreiras.php');
$noHall = array_keys(array_filter(array_column($r->json['carreiras'] ?? [], 'noHall', 'id')));
sort($noHall);
checar('suspeitas não tomam o lugar no Hall: continuam as 3 (93, 80, 70)', $noHall === ['p-70', 'p-80', 'p-93'], json_encode($noHall));

secao('v3 · publicar (auto → manual com as 3, limite de 3, nao)');
$hallModo = static fn(): string => (string) v('SELECT hall_publico FROM usuarios WHERE id = ?', [$uidP]);
$publicas = static fn(): array => array_map('strval', array_column(q('SELECT carreira_id FROM carreiras WHERE usuario_id = ? AND publica = 1 ORDER BY carreira_id', [$uidP]), 'carreira_id'));
$r = $navP->pedir('POST', '/api/carreiras.php', ['acao' => 'publicar', 'id' => 'p-60', 'sim' => true]);
checar('auto + publicar a 4ª → 409 limite_hall (já são as 3 do automático)', $r->status === 409 && $r->erro() === 'limite_hall', $r->resumo());
checar('…e nada mudou (continua auto, nenhuma marcada)', $hallModo() === 'auto' && $publicas() === []);
$r = $navP->pedir('POST', '/api/carreiras.php', ['acao' => 'publicar', 'id' => 'p-93', 'sim' => false]);
checar('auto + tirar a melhor → manual com as outras 2', $r->status === 200 && ($r->json['hallPublico'] ?? '') === 'manual' && ($r->json['carreira']['noHall'] ?? null) === false
    && ($r->json['carreira']['publica'] ?? null) === false && $hallModo() === 'manual' && $publicas() === ['p-70', 'p-80'], $r->resumo() . json_encode($publicas()));
$r = $navP->pedir('POST', '/api/carreiras.php', ['acao' => 'publicar', 'id' => 'p-60', 'sim' => true]);
checar('manual + pôr a de nota 60 → ok (3 marcadas)', $r->status === 200 && ($r->json['carreira']['publica'] ?? null) === true
    && ($r->json['carreira']['noHall'] ?? null) === true && $publicas() === ['p-60', 'p-70', 'p-80'], $r->resumo());
$r = $navP->pedir('POST', '/api/carreiras.php', ['acao' => 'publicar', 'id' => 'p-93', 'sim' => true]);
checar('manual com 3 + pôr outra → 409 limite_hall', $r->status === 409 && $r->erro() === 'limite_hall' && $publicas() === ['p-60', 'p-70', 'p-80'], $r->resumo());
$r = $navP->pedir('POST', '/api/carreiras.php', ['acao' => 'publicar', 'id' => 'p-70', 'sim' => true]);
checar('marcar de novo uma que já está → ok (não conta duas vezes)', $r->status === 200 && $publicas() === ['p-60', 'p-70', 'p-80'], $r->resumo());
$r = $navP->pedir('POST', '/api/carreiras.php', ['acao' => 'publicar', 'id' => 's-nome', 'sim' => false]);
checar('desmarcar uma que não estava → ok', $r->status === 200 && $publicas() === ['p-60', 'p-70', 'p-80'], $r->resumo());
$r = $navP->pedir('POST', '/api/carreiras.php', ['acao' => 'publicar', 'id' => 'nao-existe', 'sim' => true]);
checar('publicar carreira que não é da conta → 404', $r->status === 404, $r->resumo());
foreach ([['sim' => 'sim'], ['sim' => 1], []] as $x) {
    $r = $navP->pedir('POST', '/api/carreiras.php', ['acao' => 'publicar', 'id' => 'p-60'] + $x);
    checar('publicar com sim ' . json_encode($x) . ' → 400', $r->status === 400, $r->resumo());
}
$r = $anon->pedir('POST', '/api/carreiras.php', ['acao' => 'publicar', 'id' => 'p-60', 'sim' => true]);
checar('publicar sem sessão → 401', $r->status === 401, $r->resumo());
$r = conta($navP, ['acao' => 'perfil', 'hallPublico' => 'nao']);
checar('perfil hallPublico nao → U.hallPublico nao', $r->status === 200 && ($r->json['usuario']['hallPublico'] ?? '') === 'nao', $r->resumo());
$r = $navP->pedir('GET', '/api/carreiras.php');
checar('em "nao", nenhuma carreira noHall', $r->status === 200 && !array_filter(array_column($r->json['carreiras'] ?? [], 'noHall')), $r->resumo());
$r = $navP->pedir('POST', '/api/carreiras.php', ['acao' => 'publicar', 'id' => 'p-80', 'sim' => false]);
checar('em "nao", tirar não muda nada', $r->status === 200 && ($r->json['hallPublico'] ?? '') === 'nao' && $hallModo() === 'nao', $r->resumo());
$r = $navP->pedir('POST', '/api/carreiras.php', ['acao' => 'publicar', 'id' => 'p-93', 'sim' => true]);
checar('em "nao", publicar uma → manual só com ela', $r->status === 200 && $hallModo() === 'manual' && $publicas() === ['p-93'], $r->resumo());
$r = conta($navP, ['acao' => 'perfil', 'hallPublico' => 'auto']);
checar('perfil hallPublico auto', $r->status === 200 && $hallModo() === 'auto', $r->resumo());
q('UPDATE carreiras SET publica = 0 WHERE usuario_id = ?', [$uidP]);
$r = conta($navP, ['acao' => 'perfil', 'hallPublico' => 'manual']);
checar('perfil auto → manual sem nenhuma marcada: marca as 3 que estavam no Hall', $r->status === 200 && $publicas() === ['p-70', 'p-80', 'p-93'], json_encode($publicas()));
foreach (['xx', null, 1, ['auto']] as $x) {
    $r = conta($navP, ['acao' => 'perfil', 'hallPublico' => $x]);
    checar('perfil hallPublico ' . json_encode($x) . ' → 400 hall_invalido', $r->status === 400 && $r->erro() === 'hall_invalido', $r->resumo());
}
conta($navP, ['acao' => 'perfil', 'hallPublico' => 'auto']);
q('UPDATE carreiras SET publica = 0 WHERE usuario_id = ?', [$uidP]);
resetarLimites();
encherLimite('publicar:u' . $uidP, 60);
$r = $navP->pedir('POST', '/api/carreiras.php', ['acao' => 'publicar', 'id' => 'p-93', 'sim' => true]);
checar('publicar: 60 por conta a cada 10 min, depois 429', $r->status === 429, $r->resumo());
resetarLimites();

// ══ v3.6 fotografia do Hall ══════════════════════════════════════════════════════════════════════

secao('v3 · Hall público: fotografia, ordem, campos, cache');
limparContas();
$ADM = entrarAdmin();
// Cinco jogadores: Bolívia/Cruzeiro, Brasil, Argentina…
[$navB1, $uidB1] = novaConta('Boliviano');
[$navB2, $uidB2] = novaConta('Mineiro');
[$navB3, $uidB3] = novaConta('Hermano');
[$navB4, $uidB4] = novaConta('Quatro Carreiras');
[$navB5, $uidB5] = novaConta('Escondido');
$CRUZEIRO = 'e609';
$FLAMENGO = 'e614';
$BOCA = 'e189';
salvarC($navB1, hallEntry('b1-a', ['nota' => 95, 'pais' => 'BOL', 'clubes' => [$CRUZEIRO, $BOCA], 'jogador' => 'SALDANHA']));
salvarC($navB1, hallEntry('b1-b', ['nota' => 70, 'pais' => 'BOL', 'clubes' => [$FLAMENGO]]));
salvarC($navB2, hallEntry('b2-a', ['nota' => 90, 'pais' => 'BRA', 'clubes' => [$CRUZEIRO, $FLAMENGO, $CRUZEIRO]]));
salvarC($navB3, hallEntry('b3-a', ['nota' => 85, 'pais' => 'ARG', 'clubes' => [$BOCA]]));
foreach ([88, 87, 86, 84] as $i => $n) {
    salvarC($navB4, hallEntry("b4-$i", ['nota' => $n, 'pais' => $i === 0 ? 'BOL' : 'URU', 'clubes' => [$CRUZEIRO]]));
}
salvarC($navB5, hallEntry('b5-a', ['nota' => 99, 'pais' => 'BOL', 'clubes' => [$CRUZEIRO]]));
conta($navB5, ['acao' => 'perfil', 'hallPublico' => 'nao']);
salvarC($navB1, hallEntry('b1-suspeita', ['nota' => 100, 'pais' => 'BOL', 'clubes' => [$CRUZEIRO], 'gols' => 99999]));
salvarC($navB1, hallEntry('b1-imersivo', ['nota' => 98, 'pais' => 'BOL', 'clubes' => [$CRUZEIRO], 'modo' => 'immersive']));
checar('ainda não há fotografia', v("SELECT valor FROM site_config WHERE chave = '_hall_foto'") === null);
$r = hallGet();
$H = $r->json ?? [];
checar('GET hall.php (público, sem login) → 200 e faz a primeira fotografia', $r->status === 200 && preg_match($RE_ISO, (string) ($H['atualizadoEm'] ?? '')) === 1, $r->resumo());
checar('proximaEm = atualizadoEm + 60 min', strtotime((string) ($H['proximaEm'] ?? '')) - strtotime((string) ($H['atualizadoEm'] ?? '')) === 3600);
checar('Cache-Control: public, max-age=300 (CDN e navegador guardam 5 min)', $r->cab1('cache-control') === 'public, max-age=300', $r->cab1('cache-control'));
checar('ordem pela nota; até 3 por conta; sem suspeita, sem Imersivo (fechado), sem quem pediu "não aparecer"', idsHall($r) === ['b1-a', 'b2-a', 'b4-0', 'b4-1', 'b4-2', 'b3-a', 'b1-b'],
    json_encode(idsHall($r)));
checar('total 7, porPagina 50, pagina 1, filtro vazio', ($H['total'] ?? 0) === 7 && ($H['porPagina'] ?? 0) === 50 && ($H['pagina'] ?? 0) === 1
    && ($H['filtro'] ?? null) === ['pais' => null, 'clube' => null], json_encode(array_diff_key($H, ['itens' => 1])));
$it = $H['itens'][0] ?? [];
$chavesIt = array_keys($it);
sort($chavesIt);
checar('item: exatamente os campos do contrato', $chavesIt === CAMPOS_ITEM_HALL, implode(',', $chavesIt));
checar('item: valores da carreira (apelido, jogador, país, posição, nota, pico, temporadas, gols, títulos, bolas, Copas, clubes, bônus)',
    ($it['apelido'] ?? '') === 'Boliviano' && ($it['jogador'] ?? '') === 'SALDANHA' && ($it['pais'] ?? '') === 'BOL' && ($it['posicaoCampo'] ?? '') === 'PE'
    && ($it['nota'] ?? 0) === 95 && ($it['picoOvr'] ?? 0) === 98 && ($it['temporadas'] ?? 0) === 24 && ($it['gols'] ?? 0) === 794 && ($it['titulos'] ?? 0) === 37
    && ($it['bolasOuro'] ?? 0) === 12 && ($it['copas'] ?? 0) === 1 && ($it['clubes'] ?? null) === [$CRUZEIRO, $BOCA] && ($it['bonusOvr'] ?? -1) === 0
    && ($it['posicao'] ?? 0) === 1 && ($it['posicaoGeral'] ?? 0) === 1 && preg_match($RE_ISO, (string) ($it['terminouEm'] ?? '')) === 1, json_encode($it));
checar('clube repetido no HallEntry aparece uma vez só', ($H['itens'][1]['clubes'] ?? null) === [$CRUZEIRO, $FLAMENGO], json_encode($H['itens'][1]['clubes'] ?? null));
checar('resposta pública sem e-mail, id de conta ou dado interno', !preg_match('/@exemplo|usuario|carreira_pk|"email"|senha/', $r->corpo), substr($r->corpo, 0, 200));
checar('fotografia em hall_foto (7) e hall_foto_clubes (um por clube)', (int) v('SELECT COUNT(*) FROM hall_foto') === 7
    && (int) v('SELECT COUNT(*) FROM hall_foto_clubes') === 2 + 1 + 2 + 1 + 3 && (int) v('SELECT MIN(id) FROM hall_foto') === 1 && (int) v('SELECT MAX(id) FROM hall_foto') === 7);

secao('v3 · Hall público: filtros por país e por clube');
$r = hallGet('pais=BOL');
checar('pais=BOL → só bolivianos, posição dentro do filtro e a geral', $r->status === 200 && idsHall($r) === ['b1-a', 'b4-0', 'b1-b']
    && array_column($r->json['itens'] ?? [], 'posicao') === [1, 2, 3] && array_column($r->json['itens'] ?? [], 'posicaoGeral') === [1, 3, 7]
    && ($r->json['total'] ?? 0) === 3 && ($r->json['filtro'] ?? null) === ['pais' => 'BOL', 'clube' => null], $r->resumo());
$r = hallGet('pais=bol');
checar('pais em minúsculo vale', idsHall($r) === ['b1-a', 'b4-0', 'b1-b'], $r->resumo());
$r = hallGet('clube=' . $CRUZEIRO);
checar('clube=Cruzeiro → quem passou pelo Cruzeiro, na ordem geral', idsHall($r) === ['b1-a', 'b2-a', 'b4-0', 'b4-1', 'b4-2'] && ($r->json['total'] ?? 0) === 5
    && array_column($r->json['itens'] ?? [], 'posicao') === [1, 2, 3, 4, 5], $r->resumo());
$r = hallGet('pais=BOL&clube=' . $CRUZEIRO);
checar('Bolívia + Cruzeiro → a carreira do exemplo do dono (lenda do Cruzeiro e da Bolívia) e a outra', idsHall($r) === ['b1-a', 'b4-0'] && ($r->json['total'] ?? 0) === 2, $r->resumo());
$r = hallGet('clube=' . $BOCA . '&pais=ARG');
checar('Argentina + Boca', idsHall($r) === ['b3-a'], $r->resumo());
$r = hallGet('pais=JPN');
checar('país sem ninguém → lista vazia, total 0', $r->status === 200 && ($r->json['itens'] ?? null) === [] && ($r->json['total'] ?? -1) === 0, $r->resumo());
$r = hallGet('pagina=2');
checar('página 2 (só 7 itens) → vazia, total 7', $r->status === 200 && ($r->json['itens'] ?? null) === [] && ($r->json['total'] ?? 0) === 7 && ($r->json['pagina'] ?? 0) === 2, $r->resumo());
foreach (['pais=1!', 'pais=BRASIL', 'clube=' . rawurlencode('e 1'), 'clube=' . str_repeat('x', 17), 'pais[]=BOL', 'clube[]=x', 'pais=' . rawurlencode("' OR 1=1")] as $qs) {
    $r = hallGet($qs);
    checar("filtro inválido ($qs) → 400 filtro, sem cache", $r->status === 400 && $r->erro() === 'filtro' && $r->cab1('cache-control') === 'no-store', $r->resumo());
}
$r = hallGet('pagina=abc');
checar('pagina inválida vira 1', $r->status === 200 && ($r->json['pagina'] ?? 0) === 1, $r->resumo());

secao('v3 · Hall público: abrir por id, prazo da fotografia, atualizar_hall');
$r = hallGet('id=b1-a');
$hb1 = hallEntry('b1-a', ['nota' => 95, 'pais' => 'BOL', 'clubes' => [$CRUZEIRO, $BOCA], 'jogador' => 'SALDANHA']);
checar('?id= de carreira pública → o HallEntry inteiro + apelido + posição', $r->status === 200 && canon(json_decode($r->corpo, false)->carreira ?? null) === canon($hb1)
    && ($r->json['apelido'] ?? '') === 'Boliviano' && ($r->json['posicao'] ?? 0) === 1 && $r->cab1('cache-control') === 'public, max-age=300', $r->resumo());
foreach (['b4-3' => '4ª carreira da conta (auto mostra 3)', 'b5-a' => 'conta com "não aparecer"', 'b1-suspeita' => 'suspeita', 'b1-imersivo' => 'Imersivo',
    'nao-existe' => 'inexistente'] as $id => $nome) {
    $r = hallGet('id=' . rawurlencode($id));
    checar("?id= de $nome → 404", $r->status === 404 && $r->erro() === 'nao_encontrada', $r->resumo());
}
$r = hallGet('id[]=x');
checar('?id= que não é texto → 400', $r->status === 400, $r->resumo());
// prazo: carreira nova não entra antes do intervalo
salvarC($navB3, hallEntry('b3-b', ['nota' => 89, 'pais' => 'ARG', 'clubes' => [$BOCA]]));
$antesEm = $H['atualizadoEm'];
$r = hallGet();
checar('carreira nova dentro do prazo: a fotografia não é refeita', ($r->json['atualizadoEm'] ?? '') === $antesEm && !in_array('b3-b', idsHall($r), true), $r->resumo());
envelhecerFoto(59);
$r = hallGet();
checar('59 min depois: ainda não', !in_array('b3-b', idsHall($r), true));
envelhecerFoto(61);
$emVelho = (string) json_decode((string) v("SELECT valor FROM site_config WHERE chave = '_hall_foto'"), true)['em'];
$r1 = hallGet();
$r = hallGet();
checar('61 min depois (intervalo 60): o primeiro pedido responde na hora com a anterior e refaz logo depois',
    !in_array('b3-b', idsHall($r1), true) && ($r1->json['atualizadoEm'] ?? '') === $emVelho, $r1->resumo());
checar('…o pedido seguinte já vê a nova, com a carreira nova na ordem', in_array('b3-b', idsHall($r), true) && ($r->json['atualizadoEm'] ?? '') !== $emVelho
    && array_search('b3-b', idsHall($r), true) === 2, json_encode(idsHall($r)));
admPost(['acao' => 'config', 'valores' => ['hall_intervalo_min' => 120]]);
salvarC($navB2, hallEntry('b2-b', ['nota' => 50, 'pais' => 'BRA']));
envelhecerFoto(119);
checar('intervalo 120: com 119 min não refaz', !in_array('b2-b', idsHall(hallGet()), true));
envelhecerFoto(121);
hallGet();
$r = hallGet();
checar('intervalo 120: com 121 min refaz; proximaEm = +120 min', in_array('b2-b', idsHall($r), true)
    && strtotime((string) $r->json['proximaEm']) - strtotime((string) $r->json['atualizadoEm']) === 7200, $r->resumo());
admPost(['acao' => 'config', 'valores' => ['hall_intervalo_min' => 60]]);
salvarC($navB2, hallEntry('b2-c', ['nota' => 49, 'pais' => 'BRA']));
$r = admPost(['acao' => 'atualizar_hall']);
checar('admin atualizar_hall → refaz na hora (dentro do prazo), com total e ms', $r->status === 200 && ($r->json['hall']['total'] ?? 0) === 10
    && ($r->json['hall']['por'] ?? '') === 'admin' && is_int($r->json['hall']['ms'] ?? null), $r->resumo());
checar('…a carreira nova já aparece', in_array('b2-c', idsHall(hallGet()), true));
checar('atualizar_hall no admin_log', (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'atualizar_hall' AND alvo = 'hall'") === 1);
// a trava: outro pedido refazendo → quem chega lê a anterior, sem esperar
envelhecerFoto(61);
$emAntes = (string) json_decode((string) v("SELECT valor FROM site_config WHERE chave = '_hall_foto'"), true)['em'];
$nomeTrava = substr('lenda_hall:' . (string) v('SELECT DATABASE()'), 0, 64);
checar('a trava da fotografia tem o nome do banco junto', (int) v('SELECT GET_LOCK(?, 0)', [$nomeTrava]) === 1);
$t0 = microtime(true);
$r = hallGet();
$ms = (microtime(true) - $t0) * 1000;
checar('com outro refazendo (trava presa): responde a fotografia anterior, sem esperar', $r->status === 200 && ($r->json['atualizadoEm'] ?? '') === $emAntes && $ms < 1500,
    sprintf('%.0f ms', $ms));
$t0 = microtime(true);
$r = admPost(['acao' => 'atualizar_hall']);
checar('admin atualizar_hall com a trava presa → 409 ocupado (depois de esperar até 10 s)', $r->status === 409 && $r->erro() === 'ocupado'
    && microtime(true) - $t0 >= 9, $r->resumo());
v('SELECT RELEASE_LOCK(?)', [$nomeTrava]);
hallGet();
$r = hallGet();
checar('trava solta: o próximo pedido refaz', ($r->json['atualizadoEm'] ?? '') !== $emAntes, $r->resumo());

secao('v3 · Hall público: o que sai na hora (oculta, suspensa, conta suspensa, "não aparecer", apagada, excluída)');
$naFoto = static fn(string $id): bool => (int) v('SELECT COUNT(*) FROM hall_foto WHERE carreira_id = ?', [$id]) === 1;
$pkB3a = pkCarreira('b3-a', $uidB3);
$r = admPost(['acao' => 'ocultar_carreira', 'id' => $pkB3a, 'motivo' => 'teste']); // v3.2: motivo obrigatório
checar('admin ocultar_carreira → sai da fotografia na hora; ?id= 404', $r->status === 200 && !$naFoto('b3-a') && hallGet('id=b3-a')->status === 404
    && (int) v('SELECT oculta FROM carreiras WHERE id = ?', [$pkB3a]) === 1, $r->resumo());
admPost(['acao' => 'atualizar_hall']);
checar('…e não volta ao refazer', !$naFoto('b3-a') && !in_array('b3-a', idsHall(hallGet('pais=ARG')), true));
admPost(['acao' => 'mostrar_carreira', 'id' => $pkB3a]);
checar('mostrar_carreira: volta só na próxima fotografia', !$naFoto('b3-a'));
admPost(['acao' => 'atualizar_hall']);
checar('…que o atualizar_hall faz na hora', $naFoto('b3-a'));
$r = admPost(['acao' => 'suspender', 'id' => $uidB2, 'motivo' => 'Teste do Hall', 'dias' => 3]);
checar('conta suspensa → as carreiras dela saem na hora e não voltam ao refazer', $r->status === 200 && !$naFoto('b2-a') && !$naFoto('b2-b')
    && hallGet('id=b2-a')->status === 404, $r->resumo());
admPost(['acao' => 'atualizar_hall']);
checar('…nem depois do atualizar_hall', !$naFoto('b2-a'));
q('UPDATE usuarios SET suspenso_ate = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE id = ?', [$uidB2]);
admPost(['acao' => 'atualizar_hall']);
checar('suspensão vencida: volta na fotografia seguinte', $naFoto('b2-a'));
admPost(['acao' => 'reativar', 'id' => $uidB2]);
conta($navB1, ['acao' => 'perfil', 'hallPublico' => 'nao']);
checar('"não aparecer" → sai na hora', !$naFoto('b1-a') && !$naFoto('b1-b'));
conta($navB1, ['acao' => 'perfil', 'hallPublico' => 'auto']);
admPost(['acao' => 'atualizar_hall']);
checar('auto de novo → volta na fotografia seguinte', $naFoto('b1-a'));
$navB1->pedir('POST', '/api/carreiras.php', ['acao' => 'publicar', 'id' => 'b1-b', 'sim' => false]);
checar('tirar a publicação → sai na hora', !$naFoto('b1-b') && $naFoto('b1-a'));
$navB3->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => 'b3-b']);
checar('carreira apagada → sai na hora', !$naFoto('b3-b'));
$r = salvarC($navB3, hallEntry('b3-a', ['nota' => 85, 'pais' => 'ARG', 'clubes' => [$BOCA], 'bolas' => 99]));
checar('carreira do Hall que virou suspeita ao salvar de novo → sai na hora', !$naFoto('b3-a') && ($r->json['carreira']['noHall'] ?? null) === false, $r->resumo());
// cópia: outra conta baixa o HallEntry público (hall.php?id), sobe a nota e salva — fica a primeira dona
$copia = json_decode(hallGet('id=b1-a')->corpo, false)->carreira;
$copia->legacy->score = 96;
$r = salvarC($navB4, $copia, 'manual', false);
$pkCopia = pkCarreira('b1-a', $uidB4);
checar('cópia de uma carreira do Hall (mesmo id, nota 96) salva por outra conta → suspeita copia, fora do Hall', $r->status === 200
    && v('SELECT suspeita FROM carreiras WHERE id = ?', [$pkCopia]) === 'copia' && ($r->json['carreira']['noHall'] ?? null) === false, $r->resumo());
admPost(['acao' => 'atualizar_hall']);
$r = hallGet('id=b1-a');
checar('…na fotografia continua uma vez só, a da primeira dona', (int) v("SELECT COUNT(*) FROM hall_foto WHERE carreira_id = 'b1-a'") === 1
    && ($r->json['apelido'] ?? '') === 'Boliviano' && (json_decode($r->corpo)->carreira->legacy->score ?? 0) === 95, $r->resumo());
admPost(['acao' => 'mostrar_carreira', 'id' => $pkCopia]);
admPost(['acao' => 'atualizar_hall']);
$r = hallGet('id=b1-a');
checar('…mesmo se o admin liberar a cópia: fica a primeira que foi salva (não a de nota maior)', (int) v("SELECT COUNT(*) FROM hall_foto WHERE carreira_id = 'b1-a'") === 1
    && ($r->json['apelido'] ?? '') === 'Boliviano' && !in_array($pkCopia, array_map('intval', q('SELECT carreira_pk FROM hall_foto')), true), $r->resumo());
$r = $navB4->pedir('GET', '/api/carreiras.php');
checar('…e o "Minhas carreiras" de quem copiou não diz que está no Hall', (array_column($r->json['carreiras'] ?? [], 'noHall', 'id')['b1-a'] ?? null) === false, $r->resumo());
$navB4->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => 'b1-a']);
$outroId = json_decode(hallGet('id=b1-a')->corpo, false)->carreira;
$outroId->id = 'b1-a-outro';
$r = salvarC($navB4, $outroId, 'manual', false);
checar('o mesmo resumo com outro id, de outra conta → copia', v("SELECT suspeita FROM carreiras WHERE carreira_id = 'b1-a-outro'") === 'copia', $r->resumo());
$navB4->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => 'b1-a-outro']);
// Imersivo só entra com imersivo_publico (a conta volta para o automático: as 3 melhores)
conta($navB1, ['acao' => 'perfil', 'hallPublico' => 'auto']);
admPost(['acao' => 'config', 'valores' => ['imersivo_publico' => true]]);
admPost(['acao' => 'atualizar_hall']);
checar('imersivo_publico = true → a carreira do Imersivo entra', $naFoto('b1-imersivo'));
admPost(['acao' => 'config', 'valores' => ['imersivo_publico' => false]]);
checar('imersivo_publico = false → sai de novo na hora (sem esperar a fotografia), da lista e do ?id', !$naFoto('b1-imersivo')
    && !in_array('b1-imersivo', idsHall(hallGet('pais=BOL')), true) && hallGet('id=b1-imersivo')->status === 404);
admPost(['acao' => 'atualizar_hall']);
checar('…e não volta ao refazer', !$naFoto('b1-imersivo'));
// renomear e apelido novo: a fotografia acompanha na hora
admPost(['acao' => 'renomear', 'id' => $uidB1, 'apelido' => 'Boliviano Renomeado']);
checar('admin renomear → o apelido muda no Hall na hora', (hallGet('id=b1-a')->json['apelido'] ?? '') === 'Boliviano Renomeado');
conta($navB1, ['acao' => 'perfil', 'apelido' => 'Bolivia Lenda10']);
checar('perfil apelido → muda no Hall na hora', (hallGet('id=b1-a')->json['apelido'] ?? '') === 'Bolivia Lenda10');
// "As 3 melhores" → "Eu escolho" com outra carreira marcada de antes: as 3 do automático saem na hora
[$navM, $uidM] = novaConta('Troca Modo');
foreach ([50, 51, 52, 53] as $n) {
    salvarC($navM, hallEntry("m-$n", ['nota' => $n, 'pais' => 'PER']));
}
q("UPDATE carreiras SET publica = 1 WHERE usuario_id = ? AND carreira_id = 'm-50'", [$uidM]);
admPost(['acao' => 'atualizar_hall']);
checar('auto: as 3 melhores (53, 52, 51) no Hall', $naFoto('m-53') && $naFoto('m-52') && $naFoto('m-51') && !$naFoto('m-50'));
$r = conta($navM, ['acao' => 'perfil', 'hallPublico' => 'manual']);
checar('perfil → manual (com a 50 já marcada): as 3 do automático saem do Hall na hora, da lista e do ?id', $r->status === 200 && !$naFoto('m-53')
    && !$naFoto('m-52') && !$naFoto('m-51') && hallGet('id=m-53')->status === 404 && !array_intersect(['m-51', 'm-52', 'm-53'], idsHall(hallGet('pais=PER'))), $r->resumo());
admPost(['acao' => 'atualizar_hall']);
checar('…e a escolhida entra na fotografia seguinte', $naFoto('m-50') && !$naFoto('m-53'));
q("UPDATE carreiras SET publica = 0 WHERE usuario_id = ? AND carreira_id = 'm-50'", [$uidM]);
checar('desmarcada direto no banco: o ?id já não serve (manual só mostra as marcadas)', hallGet('id=m-50')->status === 404);
admPost(['acao' => 'atualizar_hall']);
checar('…e a limpeza da fotografia tira ela', !$naFoto('m-50'));
// moderação que sobrevive ao "apagar": ocultar, o dono apaga e salva de novo → volta escondida
salvarC($navM, hallEntry('m-mod', ['nota' => 70, 'pais' => 'PER']));
$pkMod = pkCarreira('m-mod', $uidM);
admPost(['acao' => 'ocultar_carreira', 'id' => $pkMod, 'motivo' => 'teste']);
$navM->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => 'm-mod']);
$r = salvarC($navM, hallEntry('m-mod', ['nota' => 70, 'pais' => 'PER']));
$pkMod2 = pkCarreira('m-mod', $uidM);
conta($navM, ['acao' => 'perfil', 'hallPublico' => 'auto']);
admPost(['acao' => 'atualizar_hall']);
checar('carreira oculta pelo admin, apagada e salva de novo pelo dono → volta oculta (1), fora do Hall', $r->status === 200 && $pkMod2 !== $pkMod
    && (int) v('SELECT oculta FROM carreiras WHERE id = ?', [$pkMod2]) === 1 && !$naFoto('m-mod') && hallGet('id=m-mod')->status === 404, $r->resumo());
$r = admGet('r=hall&filtro=ocultas');
checar('…e continua na aba Ocultas do painel', in_array('m-mod', array_column($r->json['itens'] ?? [], 'carreiraId'), true), $r->resumo());
$navM->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => 'm-mod']);
$modOutro = hallEntry('m-mod', ['nota' => 70, 'pais' => 'PER']);
$modOutro->id = 'm-mod-novo-id';
salvarC($navM, $modOutro);
checar('o mesmo conteúdo com outro id → também volta oculta', (int) v("SELECT oculta FROM carreiras WHERE carreira_id = 'm-mod-novo-id'") === 1);
admPost(['acao' => 'mostrar_carreira', 'id' => pkCarreira('m-mod-novo-id', $uidM)]);
$navM->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => 'm-mod-novo-id']);
salvarC($navM, $modOutro);
checar('depois de o admin mostrar, salvar de novo não volta oculta', (int) v("SELECT oculta FROM carreiras WHERE carreira_id = 'm-mod-novo-id'") === 0
    && (int) v('SELECT COUNT(*) FROM carreiras_moderacao WHERE usuario_id = ?', [$uidM]) === 0);
$hApagada = hallEntry('m-apagada', ['nota' => 71, 'pais' => 'PER']);
salvarC($navM, $hApagada);
admPost(['acao' => 'apagar_carreira', 'id' => pkCarreira('m-apagada', $uidM), 'motivo' => 'teste']);
$r = salvarC($navM, $hApagada);
// v3.2 (P1-8): a apagada pelo admin fica na lixeira e o mesmo HallEntry não volta pelo aparelho
checar('apagada pelo admin e subida de novo pelo aparelho do dono → 409 apagada (não volta)', $r->status === 409 && $r->erro() === 'apagada'
    && (int) v("SELECT COUNT(*) FROM carreiras WHERE carreira_id = 'm-apagada'") === 0, $r->resumo());
$hApagada2 = json_decode(canon($hApagada), false);
$hApagada2->id = 'm-apagada-2';
$hApagada2->career->id = 'm-apagada-2';
salvarC($navM, $hApagada2);
checar('…e a mesma carreira com outro id (mesmo resumo) volta oculta', (int) v("SELECT oculta FROM carreiras WHERE carreira_id = 'm-apagada-2'") === 1);
checar('carreiras_moderacao só com ids e o hash do resumo (nada da carreira)', array_keys(q('SELECT * FROM carreiras_moderacao LIMIT 1')[0] ?? [])
    === ['usuario_id', 'carreira_id', 'resumo_hash', 'oculta', 'em']);
// excluir a conta: some do Hall
[$navEx, $uidEx] = novaConta('Vai Sair');
salvarC($navEx, hallEntry('ex-a', ['nota' => 97]));
admPost(['acao' => 'atualizar_hall']);
checar('conta nova no Hall', $naFoto('ex-a'));
admPost(['acao' => 'ocultar_carreira', 'id' => pkCarreira('ex-a', $uidEx), 'motivo' => 'teste']);
conta($navEx, ['acao' => 'excluir', 'senha' => 'senha-v3-' . $CONTAS_N]);
checar('excluir a conta → sai do Hall na hora (LGPD)', !$naFoto('ex-a') && (int) v('SELECT COUNT(*) FROM hall_foto WHERE usuario_id = ?', [$uidEx]) === 0);
checar('…e a moderação guardada das carreiras dela também some', (int) v('SELECT COUNT(*) FROM carreiras_moderacao WHERE usuario_id = ?', [$uidEx]) === 0);

// ══ v3.7 denúncias ═══════════════════════════════════════════════════════════════════════════════

secao('v3 · denúncias (limites, 5 contas que valem ocultam, topo protegido, fila do admin)');
// só contam para esconder as denúncias de contas com mais de 24 h e 3 partidas: as contas do teste "envelhecem"
$envelhecer = static function (array $uids): void {
    q('UPDATE usuarios SET criado_em = UTC_TIMESTAMP() - INTERVAL 2 DAY, partidas_conta = GREATEST(partidas_conta, 3) WHERE id IN (' . marcasT(count($uids)) . ')', $uids);
};
$denunciar = static function (Navegador $n, array $c): Resposta {
    q("DELETE FROM tentativas WHERE chave LIKE 'denunciar-ip:%'"); // o limite por IP (5 a cada 10 min) tem teste próprio
    return $n->pedir('POST', '/api/hall.php', ['acao' => 'denunciar'] + $c);
};
// o topo do Hall (as 10 primeiras) não sai só pelas denúncias: 12 carreiras acima do alvo
for ($i = 0; $i < 4; $i++) {
    [$navT] = novaConta("Topo $i");
    for ($k = 0; $k < 3; $k++) {
        salvarC($navT, hallEntry("topo-$i-$k", ['nota' => 91 + $i * 2 + ($k > 0 ? 1 : 0), 'pais' => 'COL']));
    }
}
admPost(['acao' => 'atualizar_hall']);
$alvoId = 'b4-0';
$pkAlvo = pkCarreira($alvoId, $uidB4);
checar('a carreira alvo está no Hall, fora das 10 primeiras', $naFoto($alvoId) && (int) v('SELECT id FROM hall_foto WHERE carreira_id = ?', [$alvoId]) > 10,
    (string) v('SELECT id FROM hall_foto WHERE carreira_id = ?', [$alvoId]));
$r = $denunciar($anon, ['id' => $alvoId, 'motivo' => 'trapaca']);
checar('denunciar sem login → 401', $r->status === 401 && $r->erro() === 'nao_logado', $r->resumo());
$r = $denunciar($navB1, ['id' => $alvoId, 'motivo' => 'feio']);
checar('motivo fora da lista → 400 motivo', $r->status === 400 && $r->erro() === 'motivo', $r->resumo());
$r = $denunciar($navB1, ['id' => 'b4-3', 'motivo' => 'trapaca']);
checar('carreira fora do Hall → 404', $r->status === 404, $r->resumo());
$r = $denunciar($navB4, ['id' => $alvoId, 'motivo' => 'trapaca']);
checar('denunciar a própria → 400 propria', $r->status === 400 && $r->erro() === 'propria', $r->resumo());
$r = $anon->pedir('POST', '/api/hall.php', ['acao' => 'outra']);
checar('POST hall.php sem login → 401 (antes de olhar a ação)', $r->status === 401, $r->resumo());
$r = $navB1->pedir('POST', '/api/hall.php', ['acao' => 'outra']);
checar('ação desconhecida → 400', $r->status === 400 && $r->erro() === 'acao', $r->resumo());
$r = $navB1->pedir('POST', '/api/hall.php', ['acao' => 'denunciar', 'id' => $alvoId, 'motivo' => 'nome'], ['origem' => false]);
checar('denunciar sem Origin → 403', $r->status === 403, $r->resumo());
// contas criadas agora (sem 24 h nem 3 partidas): 5 denúncias não escondem nada (só entram na fila do admin)
$novatas = [];
for ($i = 0; $i < 5; $i++) {
    [$nv, $uidNv] = novaConta("Novata $i");
    $novatas[] = $uidNv;
    $denunciar($nv, ['id' => 'b4-1', 'motivo' => 'trapaca']);
}
$pkB41 = pkCarreira('b4-1', $uidB4);
checar('5 denúncias de contas recém-criadas: a carreira continua no Hall (as 5 ficam abertas na fila)', $naFoto('b4-1')
    && (int) v('SELECT oculta FROM carreiras WHERE id = ?', [$pkB41]) === 0 && (int) v("SELECT COUNT(*) FROM denuncias WHERE carreira_pk = ? AND status = 'aberta'", [$pkB41]) === 5);
q('DELETE FROM denuncias WHERE carreira_pk = ?', [$pkB41]);
$denunciantes = [$navB1, $navB3]; // (a B2 foi suspensa antes: a sessão dela caiu)
$uidsDen = [$uidB1, $uidB3];
for ($i = 0; $i < 3; $i++) {
    [$nv, $uidNv] = novaConta("Fiscal $i");
    $denunciantes[] = $nv;
    $uidsDen[] = $uidNv;
}
$envelhecer($uidsDen);
$st = [];
foreach (array_slice($denunciantes, 0, 4) as $i => $nv) {
    $st[] = $denunciar($nv, ['id' => $alvoId, 'motivo' => 'trapaca', 'texto' => "  denúncia\n$i  "])->status;
}
$st[] = $denunciar($navB1, ['id' => $alvoId, 'motivo' => 'nome'])->status;
checar('4 contas denunciam (e uma repete): todas 200, continua no Hall', $st === [200, 200, 200, 200, 200] && $naFoto($alvoId)
    && (int) v("SELECT COUNT(*) FROM denuncias WHERE carreira_pk = ? AND status = 'aberta'", [$pkAlvo]) === 4, implode(',', $st));
checar('a repetida não conta de novo e o texto é limpo', v('SELECT texto FROM denuncias WHERE carreira_pk = ? ORDER BY id LIMIT 1', [$pkAlvo]) === 'denúncia 0'
    && v('SELECT motivo FROM denuncias WHERE carreira_pk = ? ORDER BY id LIMIT 1', [$pkAlvo]) === 'trapaca');
$r = $denunciar($denunciantes[4], ['id' => $alvoId, 'motivo' => 'outro', 'texto' => str_repeat('x', 400)]);
checar('5ª conta diferente → sai do Hall na hora (oculta = 2) e ?id= dá 404', $r->status === 200 && !$naFoto($alvoId)
    && (int) v('SELECT oculta FROM carreiras WHERE id = ?', [$pkAlvo]) === 2 && hallGet('id=' . $alvoId)->status === 404, $r->resumo());
checar('texto da denúncia cortado em 300', mb_strlen((string) v('SELECT texto FROM denuncias WHERE carreira_pk = ? ORDER BY id DESC LIMIT 1', [$pkAlvo])) === 300);
admPost(['acao' => 'atualizar_hall']);
checar('…e não volta ao refazer a fotografia', !$naFoto($alvoId));
$r = admGet('r=denuncias');
$d0 = $r->json['itens'][0] ?? [];
checar('admin denuncias: 5 abertas, com denunciante, carreira, dono e abertasNaCarreira', $r->status === 200 && ($r->json['total'] ?? 0) === 5
    && ($d0['abertasNaCarreira'] ?? 0) === 5 && ($d0['carreira']['carreiraId'] ?? '') === $alvoId && ($d0['carreira']['dono']['id'] ?? 0) === $uidB4
    && ($d0['carreira']['oculta'] ?? -1) === 2 && is_int($d0['denunciante']['id'] ?? null), $r->resumo());
$r = admGet('r=hall&filtro=denunciadas');
checar('admin hall filtro=denunciadas: a carreira com 5', ($r->json['itens'][0]['carreiraId'] ?? '') === $alvoId && ($r->json['itens'][0]['denuncias'] ?? 0) === 5
    && ($r->json['itens'][0]['oculta'] ?? 0) === 2, $r->resumo());
$r = admGet('r=hall&filtro=ocultas');
checar('admin hall filtro=ocultas: inclui a escondida pelas denúncias', in_array($alvoId, array_column($r->json['itens'] ?? [], 'carreiraId'), true), $r->resumo());
$r = admPost(['acao' => 'resolver_denuncia', 'id' => (int) $d0['id'], 'resultado' => 'ok']);
checar('resolver_denuncia ok → fecha as 5 e a carreira deixa de estar oculta', $r->status === 200 && ($r->json['denunciasFechadas'] ?? 0) === 5
    && (int) v('SELECT oculta FROM carreiras WHERE id = ?', [$pkAlvo]) === 0
    && (int) v("SELECT COUNT(*) FROM denuncias WHERE carreira_pk = ? AND status = 'ok'", [$pkAlvo]) === 5, $r->resumo());
admPost(['acao' => 'atualizar_hall']);
checar('…volta ao Hall na fotografia seguinte', $naFoto($alvoId));
[$nv6] = novaConta('Sexto Fiscal');
$r = $denunciar($nv6, ['id' => $alvoId, 'motivo' => 'trapaca']);
checar('depois do ok, uma denúncia nova conta do zero (1 aberta, continua no Hall)', $r->status === 200 && $naFoto($alvoId)
    && (int) v("SELECT COUNT(*) FROM denuncias WHERE carreira_pk = ? AND status = 'aberta'", [$pkAlvo]) === 1, $r->resumo());
$r = $denunciar($navB1, ['id' => $alvoId, 'motivo' => 'trapaca']);
checar('quem já denunciou não denuncia de novo (continua 1 aberta)', $r->status === 200 && (int) v("SELECT COUNT(*) FROM denuncias WHERE carreira_pk = ? AND status = 'aberta'", [$pkAlvo]) === 1);
$dNova = (int) v("SELECT id FROM denuncias WHERE carreira_pk = ? AND status = 'aberta'", [$pkAlvo]);
$r = admPost(['acao' => 'resolver_denuncia', 'id' => $dNova, 'resultado' => 'ocultar', 'motivo' => 'teste']);
checar('resolver_denuncia ocultar → oculta = 1 e sai do Hall na hora', $r->status === 200 && (int) v('SELECT oculta FROM carreiras WHERE id = ?', [$pkAlvo]) === 1 && !$naFoto($alvoId), $r->resumo());
foreach ([['id' => $dNova, 'resultado' => 'talvez'], ['id' => 999999, 'resultado' => 'ok'], ['id' => 'x', 'resultado' => 'ok']] as $c) {
    $r = admPost(['acao' => 'resolver_denuncia'] + $c);
    checar('resolver_denuncia ' . json_encode($c) . ' → 4xx', in_array($r->status, [400, 404], true), $r->resumo());
}
checar('resolver_denuncia no admin_log', (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'resolver_denuncia'") === 2);
admPost(['acao' => 'mostrar_carreira', 'id' => $pkAlvo]);
admPost(['acao' => 'atualizar_hall']);
// o topo do Hall: 5 denúncias que valem só sinalizam (quem decide é o admin)
$topoId = (string) v('SELECT carreira_id FROM hall_foto WHERE id = 1');
$pkTopo = (int) v('SELECT carreira_pk FROM hall_foto WHERE id = 1');
$donoTopo = (int) v('SELECT usuario_id FROM hall_foto WHERE id = 1');
$cincoQueValem = [];
foreach ($denunciantes as $i => $nv) {
    if ($uidsDen[$i] !== $donoTopo) {
        $cincoQueValem[] = $nv;
    }
}
[$nvExtra, $uidExtra] = novaConta('Fiscal Extra');
$envelhecer([$uidExtra]);
$cincoQueValem[] = $nvExtra;
foreach (array_slice($cincoQueValem, 0, 5) as $nv) {
    $denunciar($nv, ['id' => $topoId, 'motivo' => 'trapaca']);
}
checar('a nº 1 do Hall com 5 denúncias que valem: continua no Hall (o admin decide)', $naFoto($topoId) && (int) v('SELECT oculta FROM carreiras WHERE id = ?', [$pkTopo]) === 0
    && (int) v("SELECT COUNT(*) FROM denuncias WHERE carreira_pk = ? AND status = 'aberta'", [$pkTopo]) === 5);
$r = admGet('r=hall&filtro=denunciadas');
checar('…e aparece na fila das denunciadas do painel', in_array($topoId, array_column($r->json['itens'] ?? [], 'carreiraId'), true), $r->resumo());
q('DELETE FROM denuncias WHERE carreira_pk = ?', [$pkTopo]);
resetarLimites();
encherLimite('dia-denunciar:u' . $uidB3, 10, true);
$r = $denunciar($navB3, ['id' => 'b1-a', 'motivo' => 'nome']);
checar('10 denúncias por conta por dia: a 11ª → 429', $r->status === 429 && $r->erro() === 'limite', $r->resumo());
resetarLimites();
$denunciar($navB3, ['id' => 'b2-a', 'motivo' => 'nome']);
encherLimite('dia-denunciar:u' . $uidB3, 10, true);
$r = $denunciar($navB3, ['id' => 'b2-a', 'motivo' => 'nome']);
checar('repetir a denúncia da mesma carreira: 200 sem gastar o limite do dia (mesmo no limite)', $r->status === 200, $r->resumo());
resetarLimites();
$st = [];
foreach (['b2-b', 'b2-c', 'b4-1', 'b4-2', 'topo-0-1', 'topo-1-1'] as $alvo) {
    $st[] = $navB3->pedir('POST', '/api/hall.php', ['acao' => 'denunciar', 'id' => $alvo, 'motivo' => 'outro'])->status;
}
checar('denúncias: 5 por IP a cada 10 min, a 6ª → 429', $st === [200, 200, 200, 200, 200, 429], implode(',', $st));
q('DELETE FROM denuncias WHERE usuario_id = ?', [$uidB3]);
resetarLimites();
$pkD = pkCarreira('b2-a', $uidB2);
$denunciar($navB1, ['id' => 'b2-a', 'motivo' => 'nome']);
$r = admPost(['acao' => 'apagar_carreira', 'id' => $pkD, 'motivo' => 'teste']);
checar('admin apagar_carreira: apaga a carreira e as denúncias dela, sai do Hall', $r->status === 200 && (int) v('SELECT COUNT(*) FROM carreiras WHERE id = ?', [$pkD]) === 0
    && (int) v('SELECT COUNT(*) FROM denuncias WHERE carreira_pk = ?', [$pkD]) === 0 && !$naFoto('b2-a'), $r->resumo());
$r = admPost(['acao' => 'ocultar_carreira', 'id' => 999999, 'motivo' => 'teste']);
checar('ocultar carreira inexistente → 404', $r->status === 404, $r->resumo());

// ══ v3.8 conquistas ══════════════════════════════════════════════════════════════════════════════

secao('v3 · conquistas na conta (mescla, data mais antiga, limites)');
limparContas();
$ADM = entrarAdmin();
[$navQ, $uidQ] = novaConta('Colecionador');
$sinc = static fn(Navegador $n, mixed $lista): Resposta => $n->pedir('POST', '/api/conquistas.php', ['acao' => 'sincronizar', 'conquistas' => $lista]);
$r = $anon->pedir('GET', '/api/conquistas.php');
checar('GET sem login → 401', $r->status === 401, $r->resumo());
$r = $sinc($anon, [['id' => 'goat', 'em' => '2026-10-01T10:00:00Z']]);
checar('sincronizar sem login → 401', $r->status === 401, $r->resumo());
$r = $navQ->pedir('GET', '/api/conquistas.php');
checar('conta nova: lista vazia', $r->status === 200 && ($r->json['conquistas'] ?? null) === [], $r->resumo());
$r = $sinc($navQ, [['id' => 'goat', 'em' => '2026-10-01T10:00:00Z'], ['id' => 'legend_90', 'em' => '2026-10-05T10:00:00.123Z']]);
// v3.4: cada item ganhou provada, verificada e carreira (CONTRATO-v34 §A): aqui só o id e a data
$idEm = static fn(mixed $l): ?array => is_array($l) ? array_map(static fn(array $c): array => ['id' => $c['id'] ?? null, 'em' => $c['em'] ?? null], $l) : null;
checar('sincronizar → a união (mais antiga primeiro)', $r->status === 200 && $idEm($r->json['conquistas'] ?? null) === [['id' => 'goat', 'em' => '2026-10-01T10:00:00Z'],
    ['id' => 'legend_90', 'em' => '2026-10-05T10:00:00Z']], $r->resumo());
$navQ2 = novoNav();
conta($navQ2, ['acao' => 'entrar', 'email' => (string) v('SELECT email FROM usuarios WHERE id = ?', [$uidQ]), 'senha' => 'senha-v3-' . $CONTAS_N]);
$r = $sinc($navQ2, [['id' => 'goat', 'em' => '2026-09-01T08:00:00Z'], ['id' => 'legend_90', 'em' => '2026-10-09T10:00:00Z'], ['id' => 'ballon_dor', 'em' => '2026-10-02T00:00:00-03:00']]);
checar('outro aparelho: mescla e fica a data mais antiga de cada (fuso convertido para UTC)', $r->status === 200 && $idEm($r->json['conquistas'] ?? null) === [
    ['id' => 'goat', 'em' => '2026-09-01T08:00:00Z'], ['id' => 'ballon_dor', 'em' => '2026-10-02T03:00:00Z'], ['id' => 'legend_90', 'em' => '2026-10-05T10:00:00Z']], $r->resumo());
$r = $navQ->pedir('GET', '/api/conquistas.php');
checar('o primeiro aparelho vê a união', count($r->json['conquistas'] ?? []) === 3, $r->resumo());
$agoraIso = gmdate('Y-m-d\TH:i:s\Z');
$r = $sinc($navQ, [['id' => 'futuro', 'em' => '2099-01-01T00:00:00Z'], ['id' => 'sem_data'], ['id' => 'data_ruim', 'em' => 'ontem'], ['id' => 'muito_velha', 'em' => '1999-01-01T00:00:00Z'],
    ['id' => 'Goat!', 'em' => $agoraIso], ['id' => '', 'em' => $agoraIso], ['id' => str_repeat('a', 65)], ['id' => 12], 'texto', ['id' => 'nivel:2.x-y']]);
$porId = array_column($r->json['conquistas'] ?? [], 'em', 'id');
checar('data no futuro, ruim ou sem data → agora; antes de 2025 → 2025-01-01; ids fora do formato ignorados', $r->status === 200
    && abs(strtotime((string) ($porId['futuro'] ?? '')) - time()) < 10 && abs(strtotime((string) ($porId['sem_data'] ?? '')) - time()) < 10
    && abs(strtotime((string) ($porId['data_ruim'] ?? '')) - time()) < 10 && ($porId['muito_velha'] ?? '') === '2025-01-01T00:00:00Z'
    && isset($porId['nivel:2.x-y']) && count($porId) === 8, json_encode($porId));
foreach ([['acao' => 'sincronizar'], ['acao' => 'sincronizar', 'conquistas' => 'goat'], ['acao' => 'sincronizar', 'conquistas' => ['a' => 1]],
    ['acao' => 'sincronizar', 'conquistas' => array_fill(0, 501, ['id' => 'x'])], ['acao' => 'outra']] as $c) {
    $r = $navQ->pedir('POST', '/api/conquistas.php', $c);
    checar('sincronizar inválido (' . substr(json_encode($c), 0, 60) . ') → 400', $r->status === 400, $r->resumo());
}
$r = $sinc($navQ, array_fill(0, 500, ['id' => 'goat', 'em' => '2026-01-01T00:00:00Z']));
checar('500 por envio passam (e repetidas viram uma, com a mais antiga)', $r->status === 200 && ($porId = array_column($r->json['conquistas'], 'em', 'id'))['goat'] === '2026-01-01T00:00:00Z', $r->resumo());
$valores = [];
for ($i = 0; $i < 489; $i++) {
    $valores[] = '(' . $uidQ . ", 'extra_$i', UTC_TIMESTAMP())";
}
q('INSERT INTO conquistas_usuario (usuario_id, conquista_id, em) VALUES ' . implode(',', $valores));
$r = $sinc($navQ, [['id' => 'nova_1'], ['id' => 'nova_2'], ['id' => 'nova_3'], ['id' => 'nova_4'], ['id' => 'goat', 'em' => '2025-06-01T00:00:00Z']]);
checar('no máximo 500 por conta: com 497, entram só 3 novas; as que já tem continuam sendo atualizadas', $r->status === 200 && count($r->json['conquistas'] ?? []) === 500
    && v("SELECT em FROM conquistas_usuario WHERE usuario_id = ? AND conquista_id = 'goat'", [$uidQ]) === '2025-06-01 00:00:00', count($r->json['conquistas'] ?? []) . '');
q("DELETE FROM conquistas_usuario WHERE usuario_id = ? AND conquista_id LIKE 'extra\\_%'", [$uidQ]);
resetarLimites();
encherLimite('conquistas:u' . $uidQ, 60);
$r = $sinc($navQ, [['id' => 'goat']]);
checar('sincronizar: 60 por conta a cada 10 min, depois 429', $r->status === 429, $r->resumo());
resetarLimites();

secao('v3 · raridade das conquistas (pública, cache de 1 h, só contas ativas)');
q('DELETE FROM conquistas_usuario');
[$navR1, $uidR1] = novaConta('Raro Um');
[$navR2, $uidR2] = novaConta('Raro Dois');
[$navR3, $uidR3] = novaConta('Raro Tres');
[$navR4, $uidR4] = novaConta('Raro Suspenso');
$sinc($navR1, [['id' => 'goat'], ['id' => 'legend_90'], ['id' => 'porra']]);
$sinc($navR2, [['id' => 'legend_90'], ['id' => 'first_title']]);
$sinc($navR3, [['id' => 'legend_90']]);
$sinc($navR4, [['id' => 'goat'], ['id' => 'so_do_suspenso']]);
admPost(['acao' => 'suspender', 'id' => $uidR4, 'motivo' => 'teste']);
$r = $anon->pedir('GET', '/api/conquistas.php?raridade=1');
checar('raridade: pública, 3 jogadores (o suspenso fora), contagem por conquista', $r->status === 200 && ($r->json['jogadores'] ?? 0) === 3
    && ($r->json['porConquista'] ?? null) === ['legend_90' => 3, 'first_title' => 1, 'goat' => 1], $r->resumo());
checar('raridade: id com palavrão fica fora da resposta pública', !str_contains($r->corpo, 'porra'));
checar('raridade: Cache-Control public, max-age=3600', $r->cab1('cache-control') === 'public, max-age=3600', $r->cab1('cache-control'));
$sinc($navR2, [['id' => 'goat']]);
$r = $anon->pedir('GET', '/api/conquistas.php?raridade=1');
checar('raridade em cache por 1 h: a conquista nova ainda não conta', ($r->json['porConquista']['goat'] ?? 0) === 1, $r->resumo());
$e = json_decode((string) v("SELECT valor FROM site_config WHERE chave = '_raridade'"), true);
$e['atualizadoEm'] = gmdate('Y-m-d\TH:i:s\Z', time() - 3601);
q("UPDATE site_config SET valor = ? WHERE chave = '_raridade'", [json_encode($e)]);
$r = $anon->pedir('GET', '/api/conquistas.php?raridade=1');
checar('depois de 1 h: recalcula', ($r->json['porConquista']['goat'] ?? 0) === 2 && preg_match($RE_ISO, (string) ($r->json['atualizadoEm'] ?? '')) === 1, $r->resumo());
$r = admGet('r=conquistas');
checar('admin conquistas: por conquista quantos jogadores e a %', $r->status === 200 && ($r->json['jogadores'] ?? 0) === 3
    && ($r->json['itens'][0] ?? null) !== null && $r->json['itens'][0]['id'] === 'legend_90' && $r->json['itens'][0]['jogadores'] === 3
    && $r->json['itens'][0]['pct'] == 100, $r->resumo());
admPost(['acao' => 'reativar', 'id' => $uidR4]);

// ══ v3.9 indicações ══════════════════════════════════════════════════════════════════════════════

secao('v3 · indicações (código no cadastro, recusas, validação na 1ª partida, +2 +3 +5, máximo 3)');
limparContas();
$ADM = entrarAdmin();
$vidI = uuid4();
$sidI = uuid4();
medir(novoNav(), $vidI, $sidI, [['t' => 'view'], ['t' => 'jogo_fim', 'm' => 'classico', 'd' => ['nota' => 50]]], ctx()); // jogou antes de ter conta
[$navI, $uidI, $UI, , $emailI] = novaConta('Indicador', ['vid' => $vidI]);
$senhaI = 'senha-v3-' . $CONTAS_N;
$codigo = (string) ($UI['codigoConvite'] ?? '');
checar('cadastro: U traz codigoConvite (8, sem letras ambíguas) e hallPublico auto', preg_match('/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/', $codigo) === 1
    && ($UI['hallPublico'] ?? '') === 'auto', json_encode($UI));
$r = $navI->pedir('GET', '/api/bonus.php');
checar('bonus.php: código e link de convite (?c=), nada liberado, 3 partidas faltando', $r->status === 200 && ($r->json['codigoConvite'] ?? '') === $codigo
    && ($r->json['linkConvite'] ?? '') === $ORIGEM . '/lenda/?c=' . $codigo && ($r->json['liberado'] ?? true) === false && ($r->json['faltamPartidas'] ?? 0) === 3
    && ($r->json['indicacoes'] ?? null) === ['validas' => 0, 'pendentes' => 0, 'limite' => 3, 'proximoValor' => 2] && ($r->json['disponiveis'] ?? null) === []
    && ($r->json['compartilharHoje'] ?? true) === false, $r->resumo());
checar('partidas de antes do cadastro não contam para liberar', (int) v('SELECT partidas_conta FROM usuarios WHERE id = ?', [$uidI]) === 0);
$ind = static fn(int $indicado): ?array => q('SELECT * FROM indicacoes WHERE indicado_id = ?', [$indicado])[0] ?? null;
// recusas no cadastro
[$navMesmo, $uidMesmo] = novaConta('Mesmo Aparelho', ['vid' => $vidI, 'convite' => $codigo]);
checar('cadastro com o código no aparelho do indicador → recusada mesmo_aparelho', ($ind($uidMesmo)['status'] ?? '') === 'recusada'
    && ($ind($uidMesmo)['motivo'] ?? '') === 'mesmo_aparelho', json_encode($ind($uidMesmo)));
$vidSoVisita = uuid4();
q("INSERT INTO visitas (sid, vid, usuario_id, inicio, ultimo, origem, bot) VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), 'direto', 0)", [uuid4(), $vidSoVisita, $uidI]);
[, $uidSoVisita] = novaConta('Visita Velha', ['vid' => $vidSoVisita, 'convite' => strtolower($codigo)]);
checar('aparelho com visita antiga do indicador (sem o vínculo atual) → mesmo_aparelho; código em minúsculo vale', ($ind($uidSoVisita)['motivo'] ?? '') === 'mesmo_aparelho');
[, $uidSemCodigo] = novaConta('Sem Codigo', ['convite' => 'ZZZZZZZZ']);
checar('código que não existe: cadastro normal, sem indicação', $ind($uidSemCodigo) === null);
[, $uidLixo] = novaConta('Codigo Lixo', ['convite' => ['x']]);
checar('convite de outro tipo: ignorado', $ind($uidLixo) === null);
$res = phpComLib('require ' . var_export(dirname(__DIR__) . '/api/_bonus.php', true) . '; registrarIndicacao(' . $uidI . ', ' . var_export($codigo, true)
    . ', null); echo json_encode(1);');
checar('a própria conta → recusada propria_conta', ($ind($uidI)['motivo'] ?? '') === 'propria_conta', json_encode($ind($uidI)));
q('DELETE FROM indicacoes WHERE indicado_id = ?', [$uidI]);
// amigos de verdade
$amigos = [];
for ($i = 1; $i <= 4; $i++) {
    $amigos[$i] = novaConta("Amigo $i", ['convite' => $codigo]);
}
checar('4 amigos com o código → 4 pendentes', count(array_filter(array_map(static fn($a) => $ind($a[1])['status'] ?? '', $amigos), static fn($s) => $s === 'pendente')) === 4);
/** Uma partida de verdade do amigo (início 40 s antes do fim, no aparelho dele) e 3 min e pouco de jogo no site. */
$jogar = static function (array $conta, string $modo = 'classico', string $tipo = 'jogo_fim', ?string $vid = null, int $ativo = 200): void {
    resetarLimitesCurtos();
    $vid ??= $conta[3];
    $sid = uuid4();
    medir($conta[0], $vid, $sid, [['t' => 'jogo_inicio', 'm' => $modo, 'd' => ['ritmo' => 'expressa']]], ctx());
    q('UPDATE visitas SET ativo_s = ? WHERE sid = ?', [$ativo, $sid]);
    q('UPDATE eventos SET em = em - INTERVAL 40 SECOND WHERE vid = ?', [$vid]);
    medir($conta[0], $vid, $sid, [['t' => $tipo, 'm' => $modo, 'd' => ['nota' => 60]]]);
};
$jogar($amigos[1], 'live', 'jogo_fim', null, 0);
checar('fim de jogo da Live não valida', ($ind($amigos[1][1])['status'] ?? '') === 'pendente');
$jogar($amigos[1], 'imersivo', 'partida_fim', null, 0);
checar('partida do Imersivo não valida (só o Clássico)', ($ind($amigos[1][1])['status'] ?? '') === 'pendente');
resetarLimitesCurtos();
medir($amigos[1][0], $amigos[1][3], uuid4(), [['t' => 'jogo_fim', 'm' => 'classico', 'd' => ['nota' => 60]]], ctx());
checar('jogo_fim sem jogo_inicio antes (um curl) não valida', ($ind($amigos[1][1])['status'] ?? '') === 'pendente'
    && (int) v('SELECT partidas_conta FROM usuarios WHERE id = ?', [$amigos[1][1]]) === 0);
$jogar($amigos[1], 'classico', 'jogo_fim', null, 60);
checar('partida de verdade, mas com só 1 min de jogo no site: continua pendente (pede 3 min)', ($ind($amigos[1][1])['status'] ?? '') === 'pendente'
    && (int) v('SELECT partidas_conta FROM usuarios WHERE id = ?', [$amigos[1][1]]) === 1);
$sidMin = (string) v('SELECT sid FROM visitas WHERE usuario_id = ? ORDER BY inicio DESC LIMIT 1', [$amigos[1][1]]);
q('UPDATE visitas SET ativo_s = 170, ultimo = ultimo - INTERVAL 20 SECOND WHERE sid = ?', [$sidMin]);
medir($amigos[1][0], $amigos[1][3], $sidMin, [['t' => 'hb', 'p' => 0]]);
$i1 = $ind($amigos[1][1]);
checar('…passou de 3 min jogando (um batimento a mais): a indicação vale na hora', ($i1['status'] ?? '') === 'valida' && $i1['validada_em'] !== null, json_encode($i1));
q("UPDATE indicacoes SET status = 'pendente', validada_em = NULL WHERE id = ?", [(int) $i1['id']]);
q("DELETE FROM bonus WHERE usuario_id = ? AND origem = 'indicacao'", [$uidI]);
$jogar($amigos[1]);
$i1 = $ind($amigos[1][1]);
checar('1º jogo_fim do Clássico do amigo → valida', ($i1['status'] ?? '') === 'valida' && $i1['validada_em'] !== null, json_encode($i1));
$bon = static fn(int $uid): array => array_map(static fn($b) => [(int) $b['valor'], (string) $b['origem']], q('SELECT valor, origem FROM bonus WHERE usuario_id = ? ORDER BY id', [$uid]));
checar('…e cria o +2 do indicador (origem indicacao)', $bon($uidI) === [[2, 'indicacao']], json_encode($bon($uidI)));
$jogar($amigos[1]);
checar('mais partidas do mesmo amigo não dão outro bônus', $bon($uidI) === [[2, 'indicacao']]);
$jogar($amigos[2]);
checar('2º amigo → +3', $bon($uidI) === [[2, 'indicacao'], [3, 'indicacao']], json_encode($bon($uidI)));
$jogar($amigos[3]);
checar('3º amigo → +5', $bon($uidI) === [[2, 'indicacao'], [3, 'indicacao'], [5, 'indicacao']], json_encode($bon($uidI)));
$jogar($amigos[4]);
checar('4º amigo (pendente desde antes) → recusada limite, sem bônus', ($ind($amigos[4][1])['status'] ?? '') === 'recusada' && ($ind($amigos[4][1])['motivo'] ?? '') === 'limite'
    && count($bon($uidI)) === 3, json_encode($ind($amigos[4][1])));
[, $uid5] = novaConta('Amigo 5', ['convite' => $codigo]);
checar('5º amigo, com 3 válidas: recusada limite já no cadastro', ($ind($uid5)['motivo'] ?? '') === 'limite');
$r = $navI->pedir('GET', '/api/bonus.php');
checar('indicador ainda não liberado: os 3 bônus ficam guardados (disponíveis só os do admin)', ($r->json['disponiveis'] ?? null) === []
    && array_column($r->json['guardados'] ?? [], 'valor') === [2, 3, 5] && ($r->json['indicacoes'] ?? null) === ['validas' => 3, 'pendentes' => 0, 'limite' => 3, 'proximoValor' => 0], $r->resumo());
// validação pelo conta.php partidas (evento já gravado nos eventos da conta)
[$navO, $uidO] = novaConta('Indicador Dois');
$codO = (string) v('SELECT codigo_convite FROM usuarios WHERE id = ?', [$uidO]);
$amigoP = novaConta('Amigo Partidas', ['convite' => $codO]);
$r = conta($amigoP[0], ['acao' => 'partidas', 'n' => 1]);
checar('conta.php partidas sem evento que confirme → continua pendente', $r->status === 200 && ($ind($amigoP[1])['status'] ?? '') === 'pendente', $r->resumo());
$sidP = uuid4();
q("INSERT INTO visitas (sid, vid, usuario_id, inicio, ultimo, ativo_s, origem, bot) VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), 600, 'direto', 0)", [$sidP, $amigoP[3], $amigoP[1]]);
q("INSERT INTO eventos (sid, vid, tipo, modo, dados, em) VALUES (?, ?, 'jogo_fim', 'classico', NULL, UTC_TIMESTAMP())", [$sidP, $amigoP[3]]);
$r = conta($amigoP[0], ['acao' => 'partidas', 'n' => 1]);
checar('conta.php partidas com um jogo_fim inventado nos eventos (sem partida contada) → continua pendente, partidas_conta 0',
    ($ind($amigoP[1])['status'] ?? '') === 'pendente' && (int) v('SELECT partidas_conta FROM usuarios WHERE id = ?', [$amigoP[1]]) === 0, json_encode($ind($amigoP[1])));
q('DELETE FROM eventos WHERE sid = ?', [$sidP]);
q('UPDATE visitas SET ativo_s = 0 WHERE sid = ?', [$sidP]);
$jogar($amigoP, 'classico', 'jogo_fim', null, 30);
checar('partida de verdade com pouco tempo de jogo: pendente, mas contada (partidas_conta 1)', ($ind($amigoP[1])['status'] ?? '') === 'pendente'
    && (int) v('SELECT partidas_conta FROM usuarios WHERE id = ?', [$amigoP[1]]) === 1);
q('UPDATE visitas SET ativo_s = 200 WHERE sid = ?', [$sidP]);
$r = conta($amigoP[0], ['acao' => 'partidas', 'n' => 1]);
checar('conta.php partidas (n ≥ 1) com a partida contada e 3 min de jogo → valida', ($ind($amigoP[1])['status'] ?? '') === 'valida' && $bon($uidO) === [[2, 'indicacao']],
    json_encode($ind($amigoP[1])));
$r = conta($amigoP[0], ['acao' => 'partidas', 'n' => 0]);
checar('partidas n = 0 não confere nada (e não quebra)', $r->status === 200, $r->resumo());
// amigo que joga no aparelho do indicador
$amigoA = novaConta('Amigo Aparelho', ['convite' => $codO]);
$vidO = (string) v('SELECT vid FROM visitantes_usuarios WHERE usuario_id = ?', [$uidO]);
$jogar($amigoA, 'classico', 'jogo_fim', $vidO);
checar('amigo que termina a partida no aparelho do indicador → recusada mesmo_aparelho', ($ind($amigoA[1])['status'] ?? '') === 'recusada'
    && ($ind($amigoA[1])['motivo'] ?? '') === 'mesmo_aparelho' && $bon($uidO) === [[2, 'indicacao']], json_encode($ind($amigoA[1])));
// indicador suspenso
admPost(['acao' => 'suspender', 'id' => $uidO, 'motivo' => 'teste']);
[, $uidS] = novaConta('Amigo de Suspenso', ['convite' => $codO]);
checar('indicador suspenso → recusada suspenso', ($ind($uidS)['motivo'] ?? '') === 'suspenso');
admPost(['acao' => 'reativar', 'id' => $uidO]);
$r = admGet('r=indicacoes');
$it0 = $r->json['itens'][0] ?? [];
checar('admin indicacoes: lista com indicador, indicado, status, motivo e bônus', $r->status === 200 && ($r->json['total'] ?? 0) === (int) v('SELECT COUNT(*) FROM indicacoes')
    && ($it0['indicador']['id'] ?? 0) === $uidO && ($it0['status'] ?? '') === 'recusada' && ($it0['motivo'] ?? '') === 'suspenso', $r->resumo());
$r = admGet('r=indicacoes&status=valida');
checar('admin indicacoes status=valida: as 4 válidas, com o valor do bônus', ($r->json['total'] ?? 0) === 4
    && array_column(array_column($r->json['itens'] ?? [], 'bonus'), 'valor') === [2, 5, 3, 2], $r->resumo());

secao('v3 · partidas com a conta: só as de verdade (início antes do fim, no mesmo aparelho)');
[$navF, $uidF, , $vidF] = novaConta('Sem Atalho');
resetarLimitesCurtos();
medir($navF, $vidF, uuid4(), [['t' => 'jogo_fim', 'm' => 'classico'], ['t' => 'jogo_fim', 'm' => 'classico'], ['t' => 'jogo_fim', 'm' => 'classico']], ctx());
medir($navF, $vidF, uuid4(), array_fill(0, 100, ['t' => 'partida_fim', 'm' => 'imersivo']), ctx());
$r = $navF->pedir('GET', '/api/bonus.php');
checar('3 jogo_fim inventados num pedido e 100 partida_fim: nada conta (liberado false, faltam 3)', ($r->json['liberado'] ?? true) === false
    && ($r->json['faltamPartidas'] ?? 0) === 3 && (int) v('SELECT partidas_conta FROM usuarios WHERE id = ?', [$uidF]) === 0, $r->resumo());
conta($navF, ['acao' => 'partidas', 'n' => 50]);
checar('…nem o conta.php partidas (que não conta mais pelos eventos)', (int) v('SELECT partidas_conta FROM usuarios WHERE id = ?', [$uidF]) === 0);
resetarLimitesCurtos();
$sidF = uuid4();
medir($navF, $vidF, $sidF, [['t' => 'jogo_inicio', 'm' => 'classico'], ['t' => 'jogo_inicio', 'm' => 'classico'], ['t' => 'jogo_inicio', 'm' => 'classico']], ctx());
q('UPDATE eventos SET em = em - INTERVAL 40 SECOND WHERE vid = ?', [$vidF]);
medir($navF, $vidF, $sidF, [['t' => 'jogo_fim', 'm' => 'classico'], ['t' => 'jogo_fim', 'm' => 'classico']]);
q('UPDATE eventos SET em = em - INTERVAL 40 SECOND WHERE vid = ?', [$vidF]);
medir($navF, $vidF, $sidF, [['t' => 'jogo_fim', 'm' => 'classico']]);
checar('3 inícios juntos e depois 3 fins: só 1 partida conta (1 fim por início, 1 por envio)', (int) v('SELECT partidas_conta FROM usuarios WHERE id = ?', [$uidF]) === 1);
partidaReal($navF, $vidF);
checar('uma partida de verdade depois: conta (2)', (int) v('SELECT partidas_conta FROM usuarios WHERE id = ?', [$uidF]) === 2);
resetarLimitesCurtos();
medir($navF, $vidF, uuid4(), [['t' => 'jogo_inicio', 'm' => 'classico']], ctx());
q('UPDATE eventos SET em = em - INTERVAL 40 SECOND WHERE vid = ?', [$vidF]);
$outroVid = uuid4();
medir($navF, $outroVid, uuid4(), [['t' => 'jogo_fim', 'm' => 'classico']], ctx());
checar('o fim num aparelho diferente do início não conta', (int) v('SELECT partidas_conta FROM usuarios WHERE id = ?', [$uidF]) === 2);

secao('v3 · bônus liberados só depois de 3 partidas desde o cadastro');
$jogarI = static function (string $tipo = 'jogo_fim', string $modo = 'classico') use ($navI, $vidI): void {
    resetarLimitesCurtos();
    $sid = uuid4();
    medir($navI, $vidI, $sid, [['t' => 'jogo_inicio', 'm' => $modo]], ctx());
    q('UPDATE eventos SET em = em - INTERVAL 40 SECOND WHERE vid = ?', [$vidI]);
    medir($navI, $vidI, $sid, [['t' => $tipo, 'm' => $modo, 'd' => ['nota' => 70]]]);
};
$jogarI();
$jogarI('jogo_fim', 'live');
$r = $navI->pedir('GET', '/api/bonus.php');
checar('1 partida (a da Live não conta): faltam 2', ($r->json['faltamPartidas'] ?? 0) === 2 && ($r->json['liberado'] ?? true) === false, $r->resumo());
$jogarI('partida_fim', 'imersivo');
checar('com o Imersivo fechado ao público, a partida dele não conta: faltam 2', ($navI->pedir('GET', '/api/bonus.php')->json['faltamPartidas'] ?? 0) === 2);
admPost(['acao' => 'config', 'valores' => ['imersivo_publico' => true]]);
$jogarI('partida_fim', 'imersivo');
checar('com o Imersivo aberto, a partida dele conta: faltam 1', ($navI->pedir('GET', '/api/bonus.php')->json['faltamPartidas'] ?? 0) === 1);
admPost(['acao' => 'config', 'valores' => ['imersivo_publico' => false]]);
resetarLimitesCurtos();
$sidRap = uuid4();
medir($navI, $vidI, $sidRap, [['t' => 'jogo_inicio', 'm' => 'classico']], ctx());
medir($navI, $vidI, $sidRap, [['t' => 'jogo_fim', 'm' => 'classico', 'd' => ['nota' => 70]]]);
checar('início e fim com menos de 20 s: não conta (faltam 1)', ($navI->pedir('GET', '/api/bonus.php')->json['faltamPartidas'] ?? 0) === 1);
q('UPDATE eventos SET em = em - INTERVAL 40 SECOND WHERE vid = ?', [$vidI]);
$r = $navI->pedir('POST', '/api/bonus.php', ['acao' => 'compartilhei', 'carreiraId' => 'c-share']);
checar('compartilhar antes de liberar → {ganhou 0, motivo bloqueado} e nada fica guardado', $r->status === 200 && $r->json === ['ganhou' => 0, 'motivo' => 'bloqueado']
    && (int) v("SELECT COUNT(*) FROM bonus WHERE usuario_id = ? AND origem = 'compartilhar'", [$uidI]) === 0, $r->resumo());
$r = $navI->pedir('POST', '/api/bonus.php', ['acao' => 'usar', 'carreiraId' => 'c-antes']);
checar('usar antes de liberar (só bônus de indicação) → valor 0', $r->status === 200 && ($r->json['valor'] ?? -1) === 0, $r->resumo());
$jogarI();
$r = $navI->pedir('GET', '/api/bonus.php');
checar('3ª partida: liberado; disponíveis +2 +3 +5 (mais antigo primeiro); compartilharHoje', ($r->json['liberado'] ?? false) === true && ($r->json['faltamPartidas'] ?? 1) === 0
    && array_column($r->json['disponiveis'] ?? [], 'valor') === [2, 3, 5] && ($r->json['guardados'] ?? null) === [] && ($r->json['compartilharHoje'] ?? false) === true
    && array_keys($r->json['disponiveis'][0] ?? []) === ['id', 'valor', 'origem', 'criadoEm'], $r->resumo());

secao('v3 · bônus: usar (idempotente, um por carreira), compartilhei (1 por dia), admin');
$usar = static fn(Navegador $n, string $cid): Resposta => $n->pedir('POST', '/api/bonus.php', ['acao' => 'usar', 'carreiraId' => $cid]);
$r1 = $usar($navI, 'c-1');
$r1b = $usar($navI, 'c-1');
checar('usar → o mais antigo (+2 de indicação); repetir com a mesma carreira devolve o mesmo', $r1->json === ['valor' => 2, 'origem' => 'indicacao'] && $r1b->json === $r1->json
    && (int) v('SELECT COUNT(*) FROM bonus WHERE usuario_id = ? AND usado_em IS NOT NULL', [$uidI]) === 1, $r1->resumo() . $r1b->resumo());
checar('usar → +3 numa carreira, +5 na seguinte, depois 0', ($usar($navI, 'c-2')->json['valor'] ?? 0) === 3 && ($usar($navI, 'c-3')->json['valor'] ?? 0) === 5
    && ($usar($navI, 'c-4')->json ?? null) === ['valor' => 0]);
checar('bonus GET: usados 3, nada disponível', ($navI->pedir('GET', '/api/bonus.php')->json['usados'] ?? 0) === 3);
// a carreira salva com o bônus usado nela é plausível; com outro valor ou outra carreira, suspeita
salvarC($navI, hallEntry('c-1', ['bonus' => 2]));
salvarC($navI, hallEntry('c-2', ['bonus' => 5]));
salvarC($navI, hallEntry('c-9', ['bonus' => 2]));
$susp = array_column(q("SELECT carreira_id, suspeita, bonus_ovr FROM carreiras WHERE usuario_id = ? AND carreira_id IN ('c-1', 'c-2', 'c-9') ORDER BY carreira_id", [$uidI]), null, 'carreira_id');
checar('carreira com o bônus usado nela (+2) é plausível e guarda bonus_ovr', nulo($susp['c-1'] ?? null, 'suspeita') && (int) ($susp['c-1']['bonus_ovr'] ?? 0) === 2, json_encode($susp));
checar('bônus diferente do usado (+5 numa de +3) ou sem bônus usado → suspeita bonus', ($susp['c-2']['suspeita'] ?? '') === 'bonus' && ($susp['c-9']['suspeita'] ?? '') === 'bonus', json_encode($susp));
admPost(['acao' => 'atualizar_hall']);
$r = hallGet('id=c-1');
checar('no Hall, o item mostra o bônus (+2)', (array_column(hallGet()->json['itens'] ?? [], 'bonusOvr', 'id')['c-1'] ?? 0) === 2 && $r->status === 200, $r->resumo());
// compartilhar
$r = $navI->pedir('POST', '/api/bonus.php', ['acao' => 'compartilhei', 'carreiraId' => 'c-1']);
checar('compartilhei (liberado) → ganhou 2', $r->status === 200 && $r->json === ['ganhou' => 2], $r->resumo());
$r = $navI->pedir('POST', '/api/bonus.php', ['acao' => 'compartilhei', 'carreiraId' => 'c-2']);
checar('compartilhar de novo no mesmo dia → {ganhou 0, motivo ja_hoje}', $r->json === ['ganhou' => 0, 'motivo' => 'ja_hoje'], $r->resumo());
checar('bonus GET: compartilharHoje false depois de ganhar', ($navI->pedir('GET', '/api/bonus.php')->json['compartilharHoje'] ?? true) === false);
q("UPDATE bonus SET ref = ? WHERE usuario_id = ? AND origem = 'compartilhar'", ['dia:' . gmdate('Y-m-d', time() - 3 * 3600 - 86400), $uidI]);
$r = $navI->pedir('POST', '/api/bonus.php', ['acao' => 'compartilhei', 'carreiraId' => 'c-3']);
checar('no dia seguinte (data de Brasília) → ganha de novo', $r->json === ['ganhou' => 2], $r->resumo());
checar('o dia do compartilhar é o de Brasília', (int) v("SELECT COUNT(*) FROM bonus WHERE usuario_id = ? AND origem = 'compartilhar' AND ref = ?", [$uidI, 'dia:' . gmdate('Y-m-d', time() - 3 * 3600)]) === 1);
$r = $usar($navI, 'c-5');
checar('usar pega o bônus de compartilhar (+2)', $r->json === ['valor' => 2, 'origem' => 'compartilhar'], $r->resumo());
// admin dá e tira
[$navN, $uidN] = novaConta('Novato');
$r = admPost(['acao' => 'dar_bonus', 'id' => $uidN, 'valor' => 4, 'motivo' => 'Ganhou o desafio da live']);
checar('admin dar_bonus → 200 com bonusId', $r->status === 200 && is_int($r->json['bonusId'] ?? null), $r->resumo());
$bidN = (int) ($r->json['bonusId'] ?? 0);
$r = $navN->pedir('GET', '/api/bonus.php');
checar('bônus do admin vale mesmo antes de liberar', ($r->json['liberado'] ?? true) === false && array_column($r->json['disponiveis'] ?? [], 'valor') === [4]
    && ($r->json['disponiveis'][0]['origem'] ?? '') === 'admin', $r->resumo());
foreach ([['valor' => 0], ['valor' => 6], ['valor' => '3'], ['valor' => 3, 'motivo' => ''], ['valor' => 3, 'motivo' => null]] as $c) {
    $r = admPost($c + ['acao' => 'dar_bonus', 'id' => $uidN, 'motivo' => 'x']);
    checar('dar_bonus ' . json_encode($c) . ' → 400', $r->status === 400, $r->resumo());
}
$r = admPost(['acao' => 'dar_bonus', 'id' => 999999, 'valor' => 3, 'motivo' => 'x']);
checar('dar_bonus para usuário inexistente → 404', $r->status === 404, $r->resumo());
$r = admPost(['acao' => 'dar_bonus', 'id' => $uidN, 'valor' => 1, 'motivo' => 'outro']);
$bidN2 = (int) ($r->json['bonusId'] ?? 0);
$r = admPost(['acao' => 'tirar_bonus', 'bonusId' => $bidN2, 'motivo' => 'teste']);
checar('admin tirar_bonus (não usado) → some', $r->status === 200 && (int) v('SELECT COUNT(*) FROM bonus WHERE id = ?', [$bidN2]) === 0, $r->resumo());
$usar($navN, 'n-1');
$r = admPost(['acao' => 'tirar_bonus', 'bonusId' => $bidN, 'motivo' => 'teste']);
checar('tirar_bonus de um já usado → 409 usado', $r->status === 409 && $r->erro() === 'usado', $r->resumo());
$r = admPost(['acao' => 'tirar_bonus', 'bonusId' => 999999, 'motivo' => 'teste']);
checar('tirar_bonus inexistente → 404', $r->status === 404, $r->resumo());
$bInd = (int) v("SELECT id FROM bonus WHERE usuario_id = ? AND origem = 'indicacao'", [$uidO]);
$indO = (int) v("SELECT id FROM indicacoes WHERE indicador_id = ? AND status = 'valida'", [$uidO]);
$r = admPost(['acao' => 'tirar_bonus', 'bonusId' => $bInd, 'motivo' => 'teste']);
checar('tirar o bônus de uma indicação → a indicação vira recusada (admin)', $r->status === 200
    && v('SELECT status FROM indicacoes WHERE id = ?', [$indO]) === 'recusada' && v('SELECT motivo FROM indicacoes WHERE id = ?', [$indO]) === 'admin', $r->resumo());
$r = admPost(['acao' => 'recusar_indicacao', 'motivo' => 'teste', 'id' => (int) v("SELECT id FROM indicacoes WHERE indicador_id = ? AND status = 'valida' ORDER BY id DESC LIMIT 1", [$uidI])]);
checar('admin recusar_indicacao: recusa (o bônus já usado fica)', $r->status === 200 && ($r->json['bonusTirado'] ?? true) === false, $r->resumo());
checar('dar/tirar bônus e recusar indicação no admin_log (só os que deram certo)', (int) v("SELECT COUNT(*) FROM admin_log WHERE acao IN ('dar_bonus', 'tirar_bonus', 'recusar_indicacao')") === 5);
foreach ([['acao' => 'usar'], ['acao' => 'usar', 'carreiraId' => ''], ['acao' => 'usar', 'carreiraId' => str_repeat('x', 65)], ['acao' => 'outra', 'carreiraId' => 'x'],
    ['acao' => 'compartilhei', 'carreiraId' => ['x']]] as $c) {
    $r = $navI->pedir('POST', '/api/bonus.php', $c);
    checar('bonus.php ' . json_encode($c) . ' → 400', $r->status === 400, $r->resumo());
}
$r = $anon->pedir('GET', '/api/bonus.php');
checar('bonus.php sem login → 401', $r->status === 401, $r->resumo());
resetarLimites();
encherLimite('bonus:u' . $uidI, 60);
$r = $usar($navI, 'c-limite');
checar('bonus.php: 60 por conta a cada 10 min, depois 429', $r->status === 429, $r->resumo());
resetarLimites();

// ══ v3.10 suspensão ══════════════════════════════════════════════════════════════════════════════

secao('v3 · suspensão (entrar 403, sessões caem, Hall esconde, data vence)');
[$navS, $uidS1, , $vidS, $emailS] = novaConta('Suspenso');
$senhaS = 'senha-v3-' . $CONTAS_N;
$navS2 = novoNav();
conta($navS2, ['acao' => 'entrar', 'email' => $emailS, 'senha' => $senhaS]);
salvarC($navS, hallEntry('s1-a', ['nota' => 96]));
admPost(['acao' => 'atualizar_hall']);
checar('antes: no Hall e com 2 sessões', $naFoto('s1-a') && (int) v('SELECT COUNT(*) FROM sessoes_login WHERE usuario_id = ?', [$uidS1]) === 2);
foreach ([['dias' => 0], ['dias' => 3651], ['dias' => 'x'], ['dias' => 1.5]] as $c) {
    $r = admPost(['acao' => 'suspender', 'id' => $uidS1] + $c);
    checar('suspender ' . json_encode($c) . ' → 400 dias', $r->status === 400 && $r->erro() === 'dias', $r->resumo());
}
$r = admPost(['acao' => 'suspender', 'id' => $uidS1, 'motivo' => 'Apelido ofensivo', 'dias' => 7]);
checar('suspender → 200: 2 sessões encerradas, status suspenso até daqui a 7 dias', $r->status === 200 && ($r->json['sessoesEncerradas'] ?? 0) === 2
    && ($r->json['status'] ?? '') === 'suspenso' && abs(strtotime((string) ($r->json['suspensoAte'] ?? '')) - (time() + 7 * 86400)) < 10
    && ($r->json['motivo'] ?? '') === 'Apelido ofensivo', $r->resumo());
checar('as sessões caem: GET conta.php → usuario null nos dois aparelhos', nulo($navS->pedir('GET', '/api/conta.php')->json, 'usuario')
    && nulo($navS2->pedir('GET', '/api/conta.php')->json, 'usuario'));
checar('as carreiras saem do Hall na hora', !$naFoto('s1-a') && hallGet('id=s1-a')->status === 404);
resetarLimitesCurtos();
$r = conta($navS, ['acao' => 'entrar', 'email' => $emailS, 'senha' => $senhaS]);
$dataBr = gmdate('d/m/Y', time() + 7 * 86400 - 3 * 3600);
checar('entrar → 403 suspenso, com a data (Brasília) e o motivo, sem cookie', $r->status === 403 && $r->erro() === 'suspenso'
    && str_contains((string) ($r->json['mensagem'] ?? ''), $dataBr) && str_contains((string) ($r->json['mensagem'] ?? ''), 'Apelido ofensivo')
    && !isset($r->cookies['lenda_sessao']), $r->resumo());
$r = conta($navS, ['acao' => 'entrar', 'email' => $emailS, 'senha' => 'errada']);
checar('entrar com a senha errada continua 401 (não revela a suspensão sem a senha)', $r->status === 401 && $r->erro() === 'credenciais', $r->resumo());
// uma sessão que tenha sobrado (corrida): toda rota logada responde 403
$tokS = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
q('INSERT INTO sessoes_login (token_sha256, usuario_id, criada_em, expira_em, renovada_em) VALUES (?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP() + INTERVAL 1 DAY, UTC_TIMESTAMP())',
    [hash('sha256', $tokS), $uidS1]);
$navSobra = novoNav();
$navSobra->jar['lenda_sessao'] = $tokS;
$rotas403 = [
    $navSobra->pedir('GET', '/api/carreiras.php'),
    $navSobra->pedir('GET', '/api/conquistas.php'),
    $navSobra->pedir('GET', '/api/bonus.php'),
    $navSobra->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => hallEntry('s1-b'), 'como' => 'manual']),
    conta($navSobra, ['acao' => 'perfil', 'uf' => 'SP']),
    conta($navSobra, ['acao' => 'partidas', 'n' => 3]),
    $navSobra->pedir('POST', '/api/hall.php', ['acao' => 'denunciar', 'id' => 'c-1', 'motivo' => 'nome']),
];
checar('sessão que sobrou de conta suspensa: toda rota logada → 403 suspenso', count(array_filter($rotas403, static fn(Resposta $x) => $x->status === 403 && $x->erro() === 'suspenso')) === 7,
    implode(' | ', array_map(static fn(Resposta $x) => $x->resumo(), $rotas403)));
checar('…GET conta.php → usuario null', nulo($navSobra->pedir('GET', '/api/conta.php')->json, 'usuario'));
$sidSob = uuid4();
medir($navSobra, uuid4(), $sidSob, [['t' => 'view']], ctx());
checar('…e o e.php trata como anônimo (não liga a visita à conta)', visita($sidSob)['usuario_id'] === null);
checar('a carreira não foi salva', (int) v("SELECT COUNT(*) FROM carreiras WHERE carreira_id = 's1-b'") === 0);
// redefinir a senha de conta suspensa: troca, mas não entra
resetarLimites();
q('DELETE FROM redefinicoes');
$antes = emailsPara($emailS);
conta($anon, ['acao' => 'esqueci', 'email' => $emailS]);
$codS = codigoDe(esperarEmailNovo($emailS, $antes));
$navRd = novoNav();
$r = conta($navRd, ['acao' => 'redefinir', 'email' => $emailS, 'codigo' => $codS, 'senha' => 'senha-nova-suspensa']);
checar('redefinir de conta suspensa → 403 suspenso, sem cookie (a senha muda)', $r->status === 403 && $r->erro() === 'suspenso' && !isset($navRd->jar['lenda_sessao'])
    && password_verify('senha-nova-suspensa', (string) v('SELECT senha_hash FROM usuarios WHERE id = ?', [$uidS1])), $r->resumo());
$senhaS = 'senha-nova-suspensa';
admPost(['acao' => 'atualizar_hall']);
checar('atualizar_hall não traz de volta conta suspensa', !$naFoto('s1-a'));
// suspensão vence sozinha
q('UPDATE usuarios SET suspenso_ate = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE id = ?', [$uidS1]);
resetarLimitesCurtos();
$r = conta($navS, ['acao' => 'entrar', 'email' => $emailS, 'senha' => $senhaS]);
checar('suspensão com a data vencida: entra e o status volta a ativo', $r->status === 200 && v('SELECT status FROM usuarios WHERE id = ?', [$uidS1]) === 'ativo'
    && v('SELECT suspenso_ate FROM usuarios WHERE id = ?', [$uidS1]) === null, $r->resumo());
$r = admPost(['acao' => 'suspender', 'id' => $uidS1, 'motivo' => 'teste']);
checar('suspender sem dias = até reativar (suspensoAte null)', $r->status === 200 && nulo($r->json, 'suspensoAte') && ($r->json['status'] ?? '') === 'suspenso', $r->resumo());
resetarLimitesCurtos();
checar('…não entra', conta(novoNav(), ['acao' => 'entrar', 'email' => $emailS, 'senha' => $senhaS])->status === 403);
$r = admPost(['acao' => 'reativar', 'id' => $uidS1]);
resetarLimitesCurtos();
checar('reativar → entra de novo', $r->status === 200 && ($r->json['status'] ?? '') === 'ativo' && conta(novoNav(), ['acao' => 'entrar', 'email' => $emailS, 'senha' => $senhaS])->status === 200, $r->resumo());
admPost(['acao' => 'atualizar_hall']);
checar('…e volta ao Hall na fotografia seguinte', $naFoto('s1-a'));
$r = admPost(['acao' => 'deslogar', 'id' => $uidS1]);
checar('admin deslogar → apaga as sessões (a conta continua ativa)', $r->status === 200 && ($r->json['sessoesEncerradas'] ?? 0) >= 1
    && (int) v('SELECT COUNT(*) FROM sessoes_login WHERE usuario_id = ?', [$uidS1]) === 0 && v('SELECT status FROM usuarios WHERE id = ?', [$uidS1]) === 'ativo', $r->resumo());
checar('suspender, reativar e deslogar no admin_log com o alvo', (int) v("SELECT COUNT(*) FROM admin_log WHERE alvo = ? AND acao IN ('suspender', 'reativar', 'deslogar')", ['usuario:' . $uidS1]) === 4);
foreach (['suspender', 'reativar', 'deslogar', 'renomear', 'excluir_usuario'] as $ac) {
    $r = admPost(['acao' => $ac, 'id' => 999999, 'apelido' => 'Qualquer']);
    $r2 = admPost(['acao' => $ac, 'id' => 'abc', 'apelido' => 'Qualquer']);
    checar("$ac de usuário inexistente → 404; id inválido → 400", $r->status === 404 && $r2->status === 400, $r->resumo() . ' / ' . $r2->resumo());
}

// ══ v3.11 admin: usuários, detalhe, renomear, excluir, registro, exportar ════════════════════════

secao('v3 · admin: usuários (busca, filtros, ordem), detalhe, renomear, excluir');
limparContas();
$ADM = entrarAdmin();
[$navU1, $uidU1, , $vidU1] = novaConta('Alfa Craque', ['email' => 'alfa@exemplo.com']);
[$navU2, $uidU2] = novaConta('Beta Tempo', ['email' => 'beta@exemplo.com']);
[$navU3, $uidU3] = novaConta('Gama Partidas', ['email' => 'gama@exemplo.com']);
[$navU4, $uidU4] = novaConta('-Hack', ['email' => '=1+1@exemplo.com']);
salvarC($navU1, hallEntry('u1-a', ['nota' => 91]));
salvarC($navU1, hallEntry('u1-b', ['nota' => 50]));
salvarC($navU3, hallEntry('u3-a', ['nota' => 60]));
q('UPDATE usuarios SET partidas = 40 WHERE id = ?', [$uidU3]);
q('UPDATE usuarios SET partidas_conta = 12 WHERE id = ?', [$uidU1]);
q("INSERT INTO visitas (sid, vid, usuario_id, inicio, ultimo, ativo_s, origem, dispositivo, bot) VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), 7200, 'tiktok', 'mobile', 0)",
    [uuid4(), uuid4(), $uidU2]);
q('UPDATE usuarios SET criado_em = criado_em - INTERVAL 1 DAY WHERE id = ?', [$uidU4]);
admPost(['acao' => 'suspender', 'id' => $uidU4, 'motivo' => 'teste']);
$r = admGet('r=usuarios');
$it = $r->json['itens'] ?? [];
$chavesU = array_keys($it[0] ?? []);
sort($chavesU);
checar('usuarios: paginado {total, pagina, porPagina 50, itens}', $r->status === 200 && ($r->json['total'] ?? 0) === 4 && ($r->json['porPagina'] ?? 0) === 50
    && ($r->json['pagina'] ?? 0) === 1, $r->resumo());
checar('usuarios: item com os campos do contrato', $chavesU === ['apelido', 'bonusDisponiveis', 'carreiras', 'criadoEm', 'email', 'emailVerificado', 'hallBloqueado', 'id', 'indicacoes',
    'melhorNota', 'origem', 'partidas', 'status', 'temNota', 'tempoJogadoMin', 'tipo', 'tipoEm', 'ultimoAcesso'], implode(',', $chavesU)); // v3.2: tipo, tipoEm, hallBloqueado, temNota
checar('usuarios: padrão = mais recentes primeiro', array_column($it, 'id') === [$uidU3, $uidU2, $uidU1, $uidU4], json_encode(array_column($it, 'id')));
$porId = array_column($it, null, 'id');
checar('usuarios: carreiras, melhor nota, partidas (maior entre aparelho e conta), tempo, status', ($porId[$uidU1]['carreiras'] ?? 0) === 2 && ($porId[$uidU1]['melhorNota'] ?? 0) === 91
    && ($porId[$uidU1]['partidas'] ?? 0) === 12 && ($porId[$uidU3]['partidas'] ?? 0) === 40 && ($porId[$uidU2]['tempoJogadoMin'] ?? 0) === 120
    && ($porId[$uidU4]['status'] ?? '') === 'suspenso' && nulo($porId[$uidU2] ?? null, 'melhorNota'), json_encode($porId));
foreach (['partidas' => [$uidU3, $uidU1], 'nota' => [$uidU1, $uidU3], 'tempo' => [$uidU2]] as $ordem => $primeiros) {
    $r = admGet('r=usuarios&ordem=' . $ordem);
    checar("usuarios ordem=$ordem", array_slice(array_column($r->json['itens'] ?? [], 'id'), 0, count($primeiros)) === $primeiros, json_encode(array_column($r->json['itens'] ?? [], 'id')));
}
foreach (['q=alfa' => [$uidU1], 'q=BETA%40exemplo' => [$uidU2], 'q=' . $uidU3 => [$uidU3], 'status=suspenso' => [$uidU4], 'q=' . rawurlencode('%') => [],
    'q=' . rawurlencode("' OR 1=1 --") => []] as $qs => $ids) {
    $r = admGet('r=usuarios&' . $qs);
    checar("usuarios $qs", $r->status === 200 && array_column($r->json['itens'] ?? [], 'id') === $ids, $r->resumo());
}
$codU1 = (string) v('SELECT codigo_convite FROM usuarios WHERE id = ?', [$uidU1]);
$r = admGet('r=usuarios&q=' . $codU1);
checar('usuarios: busca pelo código de convite', array_column($r->json['itens'] ?? [], 'id') === [$uidU1], $r->resumo());
$r = admGet('r=usuarios&status=ativo');
checar('usuarios status=ativo: 3', ($r->json['total'] ?? 0) === 3, $r->resumo());
conquistasDe0($navU1);
function conquistasDe0(Navegador $n): void
{
    $n->pedir('POST', '/api/conquistas.php', ['acao' => 'sincronizar', 'conquistas' => [['id' => 'goat', 'em' => '2026-10-01T00:00:00Z']]]);
}
partidaReal($navU1, $vidU1, 'classico', ['nota' => 77]);
$r = admGet('r=usuario&id=' . $uidU1);
$D = $r->json['usuario'] ?? [];
checar('usuario: 200 com o U do contrato + status, conquistas, carreiras, bônus, sessões, visitas e eventos', $r->status === 200 && ($D['id'] ?? 0) === $uidU1
    && ($D['email'] ?? '') === 'alfa@exemplo.com' && ($D['status'] ?? '') === 'ativo' && isset($D['estatisticas'], $D['carreiras'], $D['conquistas'], $D['indicacoes'],
        $D['bonus'], $D['sessoes'], $D['visitas'], $D['eventos'], $D['denuncias']) && count($D['carreiras']) === 2 && ($D['conquistas'][0]['id'] ?? '') === 'goat'
    && ($D['partidasConta'] ?? 0) === 13 && ($D['eventos'][0]['tipo'] ?? '') === 'jogo_fim' && ($D['eventos'][0]['dados']['nota'] ?? 0) === 77, $r->resumo());
checar('usuario: carreiras com pk, oculta, suspeita; sessões sem token', isset($D['carreiras'][0]['pk'], $D['carreiras'][0]['oculta'])
    && array_keys($D['sessoes'][0] ?? []) === ['criadaEm', 'expiraEm', 'renovadaEm'] && !str_contains($r->corpo, 'senha_hash') && !str_contains($r->corpo, 'token'), $r->resumo());
$r = admGet('r=usuario&id=' . $uidU4);
checar('usuario suspenso: status, suspensoAte null (até reativar) e motivo', ($r->json['usuario']['status'] ?? '') === 'suspenso' && nulo($r->json['usuario'] ?? null, 'suspensoAte')
    && ($r->json['usuario']['motivo'] ?? '') === 'teste', $r->resumo());
foreach (['r=usuario', 'r=usuario&id=0', 'r=usuario&id=abc', 'r=usuario&id=999999', 'r=usuario&id[]=1'] as $qs) {
    $r = admGet($qs);
    checar("usuario $qs → 400/404", in_array($r->status, [400, 404], true), $r->resumo());
}
$r = admGet('r=resumo');
checar('resumo: contas, carreiras, denúncias, indicações, bônus, hall e site', $r->status === 200 && ($r->json['usuarios']['total'] ?? 0) === 4
    && ($r->json['usuarios']['suspensos'] ?? 0) === 1 && ($r->json['usuarios']['ativos'] ?? 0) === 3 && ($r->json['carreiras']['total'] ?? 0) === 3
    && isset($r->json['hall'], $r->json['site'], $r->json['bonus'], $r->json['indicacoes']) && ($r->json['usuarios']['novos7Dias'] ?? 0) === 4, $r->resumo());
admPost(['acao' => 'atualizar_hall']);
$r = admGet('r=hall');
checar('admin hall (públicas): as do Hall, na ordem, com dono e posição', $r->status === 200 && array_column($r->json['itens'] ?? [], 'carreiraId') === ['u1-a', 'u3-a', 'u1-b']
    && ($r->json['itens'][0]['usuario']['id'] ?? 0) === $uidU1 && ($r->json['itens'][0]['posicaoHall'] ?? 0) === 1 && ($r->json['filtro'] ?? '') === 'publicas', $r->resumo());
$r = admGet('r=hall&filtro=todas&q=u3-a');
checar('admin hall filtro=todas: busca pelo HallEntry.id', array_column($r->json['itens'] ?? [], 'carreiraId') === ['u3-a'] && ($r->json['filtro'] ?? '') === 'todas', $r->resumo());
$r = admGet('r=hall&filtro=todas&q=Gama');
checar('admin hall: busca pelo apelido do dono', array_column($r->json['itens'] ?? [], 'carreiraId') === ['u3-a'], $r->resumo());
$pkU1a = pkCarreira('u1-a', $uidU1);
$r = admGet('r=carreira&id=' . $pkU1a);
checar('admin carreira: meta + denúncias + o HallEntry inteiro (abre mesmo oculta)', $r->status === 200 && ($r->json['meta']['carreiraId'] ?? '') === 'u1-a'
    && ($r->json['carreira']['id'] ?? '') === 'u1-a' && ($r->json['denuncias'] ?? null) === [], substr($r->corpo, 0, 200));
$r = admGet('r=carreira&id=999999');
checar('admin carreira inexistente → 404', $r->status === 404, $r->resumo());
// renomear
$r = admPost(['acao' => 'renomear', 'id' => $uidU1, 'apelido' => 'LENDA Oficial']);
checar('renomear: o admin pode usar nome reservado', $r->status === 200 && ($r->json['apelido'] ?? '') === 'LENDA Oficial'
    && v('SELECT apelido FROM usuarios WHERE id = ?', [$uidU1]) === 'LENDA Oficial' && v('SELECT apelido FROM hall_foto WHERE usuario_id = ? LIMIT 1', [$uidU1]) === 'LENDA Oficial', $r->resumo());
foreach (['Porra', 'a', '<b>x</b>', null] as $ap) {
    $r = admPost(['acao' => 'renomear', 'id' => $uidU1, 'apelido' => $ap]);
    checar('renomear para ' . json_encode($ap) . ' → 400', $r->status === 400 && in_array($r->erro(), ['apelido_proibido', 'apelido_invalido'], true), $r->resumo());
}
$lr = q("SELECT detalhes FROM admin_log WHERE acao = 'renomear' AND alvo = ?", ['usuario:' . $uidU1]);
checar('renomear no admin_log com de/para', count($lr) === 1 && str_contains((string) $lr[0]['detalhes'], '"de":"Alfa Craque"') && str_contains((string) $lr[0]['detalhes'], '"para":"LENDA Oficial"'));
// excluir pelo admin (LGPD, sem senha)
[$navX1, $uidX1, , $vidX1] = novaConta('Vai Ser Excluido');
$codX1 = (string) v('SELECT codigo_convite FROM usuarios WHERE id = ?', [$uidX1]);
[$navAmX, $uidAmX] = novaConta('Amigo do Excluido', ['convite' => $codX1]);
salvarC($navX1, hallEntry('x1-a', ['nota' => 99]));
$navX1->pedir('POST', '/api/conquistas.php', ['acao' => 'sincronizar', 'conquistas' => [['id' => 'goat']]]);
admPost(['acao' => 'dar_bonus', 'id' => $uidX1, 'valor' => 2, 'motivo' => 'x']);
$navAmX->pedir('POST', '/api/conquistas.php', ['acao' => 'sincronizar', 'conquistas' => [['id' => 'goat']]]);
admPost(['acao' => 'atualizar_hall']);
$denunciar($navU2, ['id' => 'x1-a', 'motivo' => 'nome']);
$sidX1 = uuid4();
medir($navX1, $vidX1, $sidX1, [['t' => 'view']], ctx());
$r = admPost(['acao' => 'excluir_usuario', 'id' => $uidX1, 'confirma' => 'vai ser excluido ']); // v3.2: o apelido digitado
checar('excluir_usuario → 200: conta, carreiras, Hall, conquistas, bônus, indicações feitas e denúncias contra ela somem', $r->status === 200
    && (int) v('SELECT COUNT(*) FROM usuarios WHERE id = ?', [$uidX1]) === 0 && (int) v('SELECT COUNT(*) FROM carreiras WHERE usuario_id = ?', [$uidX1]) === 0
    && (int) v('SELECT COUNT(*) FROM hall_foto WHERE usuario_id = ?', [$uidX1]) === 0 && (int) v('SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id = ?', [$uidX1]) === 0
    && (int) v('SELECT COUNT(*) FROM bonus WHERE usuario_id = ?', [$uidX1]) === 0 && (int) v('SELECT COUNT(*) FROM indicacoes WHERE indicador_id = ?', [$uidX1]) === 0
    && (int) v('SELECT COUNT(*) FROM denuncias') === 0 && (int) v('SELECT COUNT(*) FROM sessoes_login WHERE usuario_id = ?', [$uidX1]) === 0, $r->resumo());
checar('…as visitas ficam anônimas com outro vid', visita($sidX1)['usuario_id'] === null && visita($sidX1)['vid'] !== $vidX1);
checar('…o amigo continua com as conquistas dele', (int) v('SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id = ?', [$uidAmX]) === 1);
$lx = q("SELECT alvo, detalhes FROM admin_log WHERE acao = 'excluir_usuario'");
checar('excluir_usuario no admin_log só com o id (nada pessoal)', count($lx) === 1 && $lx[0]['alvo'] === 'usuario:' . $uidX1
    && !str_contains((string) $lx[0]['detalhes'], 'Vai Ser') && !str_contains((string) $lx[0]['detalhes'], '@'), json_encode($lx));
$ld = q("SELECT acao, detalhes FROM admin_log WHERE alvo = ? AND acao = 'dar_bonus'", ['usuario:' . $uidX1]);
checar('…e o que o admin fez antes com a conta (dar bônus com motivo e apelido) fica só com a ação, a data e o id (LGPD)', count($ld) === 1
    && json_decode((string) $ld[0]['detalhes'], true) === ['via' => 'painel', 'excluido' => true]
    && (int) v("SELECT COUNT(*) FROM admin_log WHERE detalhes LIKE '%Vai Ser Excluido%'") === 0, json_encode($ld));
// o indicado que se exclui: a indicação fica sem ele
[$navI9, $uidI9] = novaConta('Indica Nove');
$cod9 = (string) v('SELECT codigo_convite FROM usuarios WHERE id = ?', [$uidI9]);
$am9 = novaConta('Amigo Nove', ['convite' => $cod9]);
partidaReal($am9[0], $am9[3], 'classico', ['nota' => 60], null, 200);
admPost(['acao' => 'excluir_usuario', 'id' => $am9[1], 'confirma' => 'Amigo Nove']);
checar('indicado excluído: a indicação fica com indicado NULL e o bônus do indicador continua', (int) v("SELECT COUNT(*) FROM indicacoes WHERE indicador_id = ? AND indicado_id IS NULL AND status = 'valida'", [$uidI9]) === 1
    && (int) v("SELECT COUNT(*) FROM bonus WHERE usuario_id = ? AND origem = 'indicacao'", [$uidI9]) === 1);

secao('v3 · admin: registro (log) e exportar CSV');
$r = admGet('r=log');
$l0 = $r->json['itens'][0] ?? [];
checar('log: paginado, o mais novo primeiro, com detalhes em JSON', $r->status === 200 && ($r->json['total'] ?? 0) === (int) v('SELECT COUNT(*) FROM admin_log')
    && ($l0['acao'] ?? '') === 'excluir_usuario' && is_array($l0['detalhes'] ?? null) && preg_match($RE_ISO, (string) ($l0['em'] ?? '')) === 1, $r->resumo());
$r = admGet('r=log&acao=suspender');
checar('log filtrado por ação', ($r->json['total'] ?? 0) === 1 && ($r->json['itens'][0]['acao'] ?? '') === 'suspender', $r->resumo());
$r = admGet('r=log&alvo=usuario:' . $uidU1);
checar('log filtrado por alvo', ($r->json['total'] ?? 0) === 1, $r->resumo());
$r = admGet('r=exportar&tipo=usuarios');
checar('exportar: CSV (text/csv, attachment, sem cache)', $r->status === 200 && str_starts_with($r->cab1('content-type'), 'text/csv')
    && str_contains($r->cab1('content-disposition'), 'attachment; filename="lenda-usuarios-') && $r->cab1('cache-control') === 'no-store', $r->cab1('content-type'));
checar('exportar: começa com o BOM do UTF-8 e o cabeçalho em pt-BR separado por ;', str_starts_with($r->corpo, "\xEF\xBB\xBFid;apelido;e-mail;criado;último acesso;status;partidas;carreiras;origem\r\n"),
    substr($r->corpo, 0, 120));
$linhasCsv = array_values(array_filter(explode("\r\n", substr($r->corpo, 3))));
$total = (int) v('SELECT COUNT(*) FROM usuarios');
checar('exportar: uma linha por conta', count($linhasCsv) === $total + 1, count($linhasCsv) . " / $total");
$hack = '';
foreach ($linhasCsv as $l) {
    if (str_starts_with($l, $uidU4 . ';')) {
        $hack = $l;
    }
}
$cel = str_getcsv($hack, ';', '"', '');
checar('exportar: célula que começa com - ou = ganha \' (sem fórmula na planilha)', ($cel[1] ?? '') === "'-Hack" && ($cel[2] ?? '') === "'=1+1@exemplo.com" && ($cel[5] ?? '') === 'suspenso', $hack);
checar('exportar: nenhuma célula começa com = + - @', !preg_match('/(^|;)"?[=+\-@]/m', implode("\n", array_slice($linhasCsv, 1))), $hack);
checar('exportar: datas em Brasília (AAAA-MM-DD HH:MM)', preg_match('/;"\d{4}-\d\d-\d\d \d\d:\d\d";/', $hack) === 1, $hack);
checar('exportar vai para o log', (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'exportar' AND alvo = 'usuarios'") === 1);
$r = admGet('r=exportar&tipo=outra');
checar('exportar tipo desconhecido → 400', $r->status === 400, $r->resumo());

// ══ v3.12 tipos errados nas rotas novas (nenhum 500) ═════════════════════════════════════════════

secao('v3 · tipos errados e valores estranhos nas rotas novas (nenhum 500)');
$quinhentos = [];
$tentarV3 = static function (Navegador $n, string $metodo, string $caminho, mixed $corpo, string $rotulo) use (&$quinhentos): void {
    resetarLimites();
    $r = $n->pedir($metodo, $caminho, $corpo);
    $csv = str_starts_with($r->cab1('content-type'), 'text/csv');
    if ($r->status >= 500 || $r->status === 0 || ($r->status !== 204 && !$csv && !is_array($r->json))) {
        $quinhentos[] = "$rotulo → " . $r->resumo();
    }
};
$estranhosV3 = [null, 0, -1, 1.5, true, '', str_repeat('é', 300), [], [1, 2], ['a' => ['b' => 1]], "a\0b", "' OR 1=1 --", 1e300];
foreach ($estranhosV3 as $x) {
    $tentarV3($navU2, 'POST', '/api/carreiras.php', ['acao' => 'publicar', 'id' => $x, 'sim' => true], 'publicar id=' . json_encode($x));
    $tentarV3($navU2, 'POST', '/api/carreiras.php', ['acao' => 'publicar', 'id' => 'u1-a', 'sim' => $x], 'publicar sim=' . json_encode($x));
    $tentarV3($navU2, 'POST', '/api/hall.php', ['acao' => 'denunciar', 'id' => $x, 'motivo' => 'nome'], 'denunciar id=' . json_encode($x));
    $tentarV3($navU2, 'POST', '/api/hall.php', ['acao' => 'denunciar', 'id' => 'u1-a', 'motivo' => 'outro', 'texto' => $x], 'denunciar texto=' . json_encode($x));
    $tentarV3($navU2, 'POST', '/api/conquistas.php', ['acao' => 'sincronizar', 'conquistas' => $x], 'conquistas lista=' . json_encode($x));
    $tentarV3($navU2, 'POST', '/api/conquistas.php', ['acao' => 'sincronizar', 'conquistas' => [['id' => $x, 'em' => $x]]], 'conquistas item=' . json_encode($x));
    $tentarV3($navU2, 'POST', '/api/bonus.php', ['acao' => 'usar', 'carreiraId' => $x], 'usar=' . json_encode($x));
    $tentarV3($navU2, 'POST', '/api/bonus.php', ['acao' => $x, 'carreiraId' => 'x'], 'bonus acao=' . json_encode($x));
    $tentarV3($navU2, 'POST', '/api/conta.php', ['acao' => 'cadastrar', 'apelido' => 'Fuzz V3', 'email' => 'fz' . bin2hex(random_bytes(4)) . '@exemplo.com',
        'senha' => 'qualquer123', 'aceite' => true, 'convite' => $x], 'cadastrar convite=' . json_encode($x));
    $tentarV3($navU2, 'POST', '/api/conta.php', ['acao' => 'perfil', 'hallPublico' => $x], 'perfil hallPublico=' . json_encode($x));
    foreach (['suspender' => ['id', 'motivo', 'dias'], 'renomear' => ['id', 'apelido'], 'dar_bonus' => ['id', 'valor', 'motivo'], 'tirar_bonus' => ['bonusId'],
        'ocultar_carreira' => ['id'], 'resolver_denuncia' => ['id', 'resultado'], 'recusar_indicacao' => ['id'], 'config' => ['valores']] as $ac => $campos) {
        foreach ($campos as $campo) {
            $tentarV3($ADM, 'POST', '/api/admin.php', ['acao' => $ac, 'id' => $uidU3, 'valor' => 2, 'motivo' => 'm', 'apelido' => 'Gama Partidas', 'resultado' => 'ok',
                'valores' => ['manutencao' => false], $campo => $x], "admin $ac.$campo=" . json_encode($x));
        }
    }
    $tentarV3($ADM, 'POST', '/api/admin.php', ['acao' => 'config', 'valores' => ['bonus' => $x, 'regras' => $x]], 'config valores=' . json_encode($x));
}
foreach (['?pais=', '?pais[]=1', '?clube=%00', '?pagina=-1', '?pagina=999999999999', '?id=', '?id=%00', '?id=' . str_repeat('x', 300)] as $qs) {
    $tentarV3($anon, 'GET', '/api/hall.php' . $qs, null, "hall GET $qs");
}
foreach (['usuarios&ordem[]=x', 'usuarios&q[]=x', 'usuarios&status[]=x', 'usuarios&pagina=0', 'hall&filtro[]=x', 'hall&q[]=1', 'denuncias&status[]=1', 'indicacoes&status[]=1',
    'log&acao[]=1', 'log&alvo[]=1', 'carreira&id[]=1', 'exportar&tipo[]=1', 'usuarios&q=' . str_repeat('%', 200)] as $qs) {
    $tentarV3($ADM, 'GET', '/api/admin.php?r=' . $qs, null, "admin GET $qs");
}
foreach (['', 'null', '1', '{"a":', str_repeat('[', 600) . str_repeat(']', 600)] as $bruto) {
    foreach (['/api/hall.php', '/api/conquistas.php', '/api/bonus.php', '/api/admin.php'] as $rota) {
        $tentarV3($rota === '/api/admin.php' ? $ADM : $navU2, 'POST', $rota, $bruto, "$rota corpo " . substr($bruto, 0, 12));
    }
}
checar('rotas novas: nenhuma combinação deu 500 ou resposta fora de JSON', !$quinhentos, implode(' | ', array_slice($quinhentos, 0, 6)));
resetarLimites();
admPost(['acao' => 'config', 'valores' => configPadraoTeste()]);

// ══ v3.13 carga e concorrência ═══════════════════════════════════════════════════════════════════

/**
 * Vários pedidos ao mesmo tempo no php -S de 4 processos. Cada pedido: [metodo, caminho, corpo|null, cookies(array), rotulo].
 * Devolve [rotulo => [status, corpo, json]].
 */
function paralelo(array $pedidos): array
{
    global $URL_PAR, $ORIGEM_PAR, $CORPOS;
    $mh = curl_multi_init();
    $hs = [];
    foreach ($pedidos as $i => [$metodo, $caminho, $corpo, $cookies]) {
        $ch = curl_init($URL_PAR . $caminho);
        $cab = ['Expect:'];
        if ($corpo !== null) {
            $cab[] = 'Content-Type: ' . ($caminho === '/api/e.php' ? 'text/plain' : 'application/json');
        }
        if ($metodo === 'POST') {
            $cab[] = 'Origin: ' . $ORIGEM_PAR;
        }
        if ($cookies) {
            $cab[] = 'Cookie: ' . implode('; ', array_map(static fn($k, $v) => "$k=$v", array_keys($cookies), $cookies));
        }
        curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $metodo, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $cab, CURLOPT_TIMEOUT => 60,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (X11; Linux x86_64) Chrome/129.0 Safari/537.36']);
        if ($corpo !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($corpo) ? $corpo : canon($corpo));
        }
        curl_multi_add_handle($mh, $ch);
        $hs[$i] = $ch;
    }
    do {
        $st = curl_multi_exec($mh, $ativos);
        if ($ativos) {
            curl_multi_select($mh, 1.0);
        }
    } while ($ativos && $st === CURLM_OK);
    $out = [];
    foreach ($hs as $i => $ch) {
        $corpo = (string) curl_multi_getcontent($ch);
        $CORPOS[] = $corpo;
        $out[$pedidos[$i][4] ?? $i] = [(int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), $corpo, json_decode($corpo, true)];
        curl_multi_remove_handle($mh, $ch);
    }
    curl_multi_close($mh);
    return $out;
}

function marcasT(int $n): string
{
    return implode(', ', array_fill(0, max(1, $n), '?'));
}

/** Sessão de jogador criada direto no banco (para logar muitas contas de uma vez). */
function sessaoDireta(int $uid): array
{
    $tok = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    q('INSERT INTO sessoes_login (token_sha256, usuario_id, criada_em, expira_em, renovada_em) VALUES (?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP() + INTERVAL 1 DAY, UTC_TIMESTAMP())',
        [hash('sha256', $tok), $uid]);
    return ['lenda_sessao' => $tok];
}

/** Melhor de $n (ms) e a última resposta. */
function cronometrar(callable $f, int $n = 5): array
{
    $tempos = [];
    $r = null;
    for ($i = 0; $i < $n; $i++) {
        $t0 = microtime(true);
        $r = $f();
        $tempos[] = (microtime(true) - $t0) * 1000;
    }
    sort($tempos);
    return [$tempos[0], $tempos[intdiv($n, 2)], $r];
}

if (!$SEM_CARGA) {
    secao('v3 · carga: 2.000 contas, 8.000 carreiras (6.000 no Hall), 60 mil conquistas');
    limparContas();
    $ADM = entrarAdmin();
    $t0 = microtime(true);
    mt_srand(7);
    $paises = ['BRA', 'ARG', 'BOL', 'URU', 'PAR', 'CHI', 'COL', 'PER', 'ECU', 'VEN', 'MEX', 'USA', 'POR', 'ESP', 'FRA', 'ITA', 'GER', 'ENG', 'NED', 'BEL', 'CRO',
        'SRB', 'NOR', 'SWE', 'DEN', 'JPN', 'KOR', 'NGA', 'SEN', 'MAR'];
    $clubesPool = [];
    for ($i = 1; $i <= 300; $i++) {
        $clubesPool[] = 'e' . (100 + $i);
    }
    $blob = gzencode(canon($BASE_HALL), 6);
    $hashSenha = password_hash('senha-carga', PASSWORD_DEFAULT);
    $pdo->beginTransaction();
    for ($lote = 0; $lote < 4; $lote++) {
        $vals = [];
        $ps = [];
        for ($i = 0; $i < 500; $i++) {
            $n = $lote * 500 + $i + 1;
            $vals[] = "(?, ?, ?, UTC_TIMESTAMP() - INTERVAL ? MINUTE, 'tiktok', UTC_TIMESTAMP(), ?, ?, ?)";
            array_push($ps, "carga$n@exemplo.com", "Carga $n", $hashSenha, mt_rand(0, 20000), mt_rand(0, 300), sprintf('K%07d', $n), mt_rand(0, 50));
        }
        q('INSERT INTO usuarios (email, apelido, senha_hash, criado_em, origem, aceite_em, partidas, codigo_convite, partidas_conta) VALUES ' . implode(',', $vals), $ps);
    }
    $uids = array_map('intval', array_column(q("SELECT id FROM usuarios WHERE email LIKE 'carga%' ORDER BY id"), 'id'));
    $cid = 0;
    foreach (array_chunk($uids, 125) as $grupo) {
        $vals = [];
        $ps = [];
        foreach ($grupo as $uid) {
            for ($k = 0; $k < 4; $k++) {
                $cid++;
                $nota = $k === 3 ? mt_rand(1, 20) : mt_rand(25, 99);
                $cl = [];
                for ($c = 0, $q = mt_rand(3, 8); $c < $q; $c++) {
                    $cl[] = $clubesPool[mt_rand(0, 299)];
                }
                $vals[] = "(?, ?, 'classico', ?, ?, ?, 'PE', ?, 2, ?, 24, ?, ?, ?, '', 'auto', ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), ?, ?, 0)";
                array_push($ps, $uid, "carga-$cid", 'JOGADOR ' . $cid, mt_rand(1, 99), $paises[mt_rand(0, 29)], $nota, mt_rand(60, 99), mt_rand(0, 900), mt_rand(0, 60),
                    mt_rand(0, 12), $blob, 30000, json_encode(array_values(array_unique($cl))), mt_rand(0, 2));
            }
        }
        q('INSERT INTO carreiras (usuario_id, carreira_id, modo, jogador, numero, pais, posicao, nota, nota_v, pico_ovr, temporadas, gols, titulos, bolas_ouro,
            headline, como, dados, tamanho, terminou_em, salva_em, clubes, copas, bonus_ovr) VALUES ' . implode(',', $vals), $ps);
    }
    $conqIds = [];
    for ($i = 0; $i < 80; $i++) {
        $conqIds[] = "conq_$i";
    }
    foreach (array_chunk($uids, 250) as $grupo) {
        $vals = [];
        $ps = [];
        foreach ($grupo as $uid) {
            foreach (array_rand(array_flip($conqIds), 30) as $c) {
                $vals[] = '(?, ?, UTC_TIMESTAMP())';
                array_push($ps, $uid, $c);
            }
        }
        q('INSERT INTO conquistas_usuario (usuario_id, conquista_id, em) VALUES ' . implode(',', $vals), $ps);
    }
    $pdo->commit();
    $pdo->query('ANALYZE TABLE usuarios, carreiras, conquistas_usuario')->fetchAll();
    printf("  · carga: %d contas, %d carreiras, %d conquistas em %.1f s\n", count($uids), (int) v('SELECT COUNT(*) FROM carreiras'),
        (int) v('SELECT COUNT(*) FROM conquistas_usuario'), microtime(true) - $t0);

    // fotografia
    $tempos = [];
    $estado = null;
    for ($i = 0; $i < 3; $i++) {
        $t1 = microtime(true);
        $r = admPost(['acao' => 'atualizar_hall']);
        $tempos[] = (microtime(true) - $t1) * 1000;
        $estado = $r->json['hall'] ?? [];
    }
    sort($tempos);
    checar(sprintf('fotografia de 6.000 carreiras (de 8.000): %.0f ms pelo admin (leitura %d ms, troca %d ms; melhor de 3)', $tempos[0], (int) ($estado['msLeitura'] ?? 0),
        (int) ($estado['ms'] ?? 0) - (int) ($estado['msLeitura'] ?? 0)), ($estado['total'] ?? 0) === 6000 && $tempos[0] < 4000, json_encode($estado));
    checar('fotografia: posições 1..6000 sem buraco, 3 por conta, a 4ª (nota baixa) de fora', (int) v('SELECT COUNT(DISTINCT id) FROM hall_foto') === 6000
        && (int) v('SELECT MAX(id) FROM hall_foto') === 6000 && (int) v('SELECT MAX(n) FROM (SELECT COUNT(*) AS n FROM hall_foto GROUP BY usuario_id) t') === 3
        && (int) v('SELECT COUNT(*) FROM hall_foto WHERE nota < 25') === 0);
    $ordemOk = (int) v('SELECT COUNT(*) FROM hall_foto a JOIN hall_foto b ON b.id = a.id + 1 WHERE b.nota > a.nota') === 0;
    checar('fotografia: ordem pela nota', $ordemOk);
    envelhecerFoto(61);
    $emVelho = (string) json_decode((string) v("SELECT valor FROM site_config WHERE chave = '_hall_foto'"), true)['em'];
    $t1 = microtime(true);
    $r = hallGet();
    $msPreg = (microtime(true) - $t1) * 1000;
    $t1 = microtime(true);
    $r2 = hallGet();
    $msDepois = (microtime(true) - $t1) * 1000;
    checar(sprintf('foto vencida: o primeiro pedido responde a anterior em %.0f ms e refaz depois da resposta (o seguinte, que esperou a troca no php -S de 1 processo: %.0f ms)',
        $msPreg, $msDepois), $r->status === 200 && ($r->json['atualizadoEm'] ?? '') === $emVelho && $msPreg < 150 && ($r2->json['atualizadoEm'] ?? '') !== $emVelho
        && ($r2->json['total'] ?? 0) === 6000, $r->resumo());

    // hall.php servido da fotografia
    $clubeX = (string) v('SELECT club_id FROM hall_foto_clubes GROUP BY club_id ORDER BY COUNT(*) DESC LIMIT 1');
    $paisX = (string) v('SELECT pais FROM hall_foto GROUP BY pais ORDER BY COUNT(*) DESC LIMIT 1');
    $idX = (string) v('SELECT carreira_id FROM hall_foto WHERE id = 3000');
    foreach (['sem filtro, página 1' => '', 'sem filtro, página 120 (a última)' => 'pagina=120', "pais=$paisX" => "pais=$paisX", "clube=$clubeX" => "clube=$clubeX",
        "pais+clube" => "pais=$paisX&clube=$clubeX", 'clube, página 5' => "clube=$clubeX&pagina=5", 'abrir por id' => "id=$idX"] as $nome => $qs) {
        [$ms, $med, $r] = cronometrar(static fn() => hallGet($qs));
        checar(sprintf('hall.php %s: %.0f ms (melhor de 5; mediana %.0f ms)', $nome, $ms, $med), $r->status === 200 && $ms < 150, $r->resumo());
    }
    $r = hallGet("pais=$paisX&clube=$clubeX");
    $tot = (int) v('SELECT COUNT(*) FROM hall_foto f JOIN hall_foto_clubes c ON c.foto_id = f.id WHERE f.pais = ? AND c.club_id = ?', [$paisX, $clubeX]);
    checar('pais+clube na carga: total certo e todos os itens batem com o filtro', ($r->json['total'] ?? -1) === $tot
        && !array_filter($r->json['itens'] ?? [], static fn($i) => $i['pais'] !== $paisX || !in_array($clubeX, $i['clubes'], true)), "$tot");
    $r = hallGet('pagina=120');
    checar('última página: 50 itens, posições 5951..6000', count($r->json['itens'] ?? []) === 50 && ($r->json['itens'][0]['posicao'] ?? 0) === 5951
        && ($r->json['itens'][49]['posicao'] ?? 0) === 6000);
    $ex = static fn(string $sql, array $p = []): array => q('EXPLAIN ' . $sql, $p);
    $e1 = $ex('SELECT f.* FROM hall_foto f WHERE f.pais = ? ORDER BY f.id LIMIT 50', [$paisX]);
    $e2 = $ex('SELECT f.* FROM hall_foto_clubes hc JOIN hall_foto f ON f.id = hc.foto_id WHERE hc.club_id = ? ORDER BY hc.foto_id LIMIT 50', [$clubeX]);
    $e3 = $ex('SELECT c.id FROM carreiras c WHERE c.usuario_id = ? AND c.oculta = 0 AND c.suspeita IS NULL AND c.nota_v = 2 ORDER BY c.nota DESC LIMIT 3', [$uids[0]]);
    checar('índices: filtro por país usa ix_hall_foto_pais; por clube, a chave (club_id, foto_id); "as 3 da conta", (usuario_id, nota)',
        ($e1[0]['key'] ?? '') === 'ix_hall_foto_pais' && ($e2[0]['key'] ?? '') === 'PRIMARY' && ($e2[0]['table'] ?? '') === 'hc'
        && in_array($e3[0]['key'] ?? '', ['ix_carreiras_usuario_nota', 'uq_carreiras_usuario_carreira', 'ix_carreiras_usuario_salva'], true)
        && !str_contains((string) ($e1[0]['Extra'] ?? ''), 'filesort') && !str_contains((string) ($e2[0]['Extra'] ?? ''), 'filesort'),
        json_encode([$e1[0]['key'] ?? null, $e1[0]['Extra'] ?? null, $e2[0]['key'] ?? null, $e2[0]['Extra'] ?? null, $e3[0]['key'] ?? null]));

    // conquistas e admin com volume
    q("DELETE FROM site_config WHERE chave = '_raridade'");
    [$ms, , $r] = cronometrar(static function () use ($anon) {
        q("DELETE FROM site_config WHERE chave = '_raridade'");
        return $anon->pedir('GET', '/api/conquistas.php?raridade=1');
    }, 3);
    checar(sprintf('raridade com 60 mil conquistas (recalculando): %.0f ms', $ms), $r->status === 200 && ($r->json['jogadores'] ?? 0) === 2000 && $ms < 1500, $r->resumo());
    [$ms, , $r] = cronometrar(static fn() => $anon->pedir('GET', '/api/conquistas.php?raridade=1'));
    checar(sprintf('raridade do cache: %.0f ms', $ms), $r->status === 200 && $ms < 100, $r->resumo());
    foreach (['recentes', 'partidas', 'nota', 'tempo', 'acesso'] as $ordem) {
        [$ms, , $r] = cronometrar(static fn() => admGet("r=usuarios&ordem=$ordem&pagina=3"), 3);
        checar(sprintf('admin usuarios ordem=%s (2.000 contas): %.0f ms', $ordem, $ms), $r->status === 200 && count($r->json['itens'] ?? []) === 50
            && ($r->json['total'] ?? 0) === 2000 && $ms < 800, $r->resumo());
    }
    foreach (['r=resumo', 'r=hall', 'r=hall&filtro=todas&pagina=40', 'r=conquistas', 'r=usuarios&q=Carga%201'] as $qs) {
        [$ms, , $r] = cronometrar(static fn() => admGet($qs), 3);
        checar(sprintf('admin %s: %.0f ms', $qs, $ms), $r->status === 200 && $ms < 800, $r->resumo());
    }
    [$ms, , $r] = cronometrar(static fn() => admGet('r=exportar&tipo=usuarios'), 2);
    checar(sprintf('exportar CSV de 2.000 contas: %.0f ms', $ms), $r->status === 200 && substr_count($r->corpo, "\r\n") === 2001 && $ms < 3000);

    // e.php continua barato com a conta ligada
    $ckE = sessaoDireta($uids[10]);
    $navE = novoNav();
    $navE->jar = $ckE;
    $vidE = uuid4();
    $sidE = uuid4();
    medir($navE, $vidE, $sidE, [['t' => 'view']], ctx());
    resetarLimites();
    [$msHb, $medHb] = cronometrar(static fn() => medir($navE, $vidE, $sidE, [['t' => 'hb', 'p' => 1, 'm' => 'classico']]), 30);
    [$msFim, $medFim] = cronometrar(static fn() => medir($navE, $vidE, $sidE, [['t' => 'jogo_fim', 'm' => 'classico', 'd' => ['nota' => 50]]]), 10);
    checar(sprintf('e.php logado: batimento %.0f ms (mediana %.0f), fim de partida %.0f ms (mediana %.0f)', $msHb, $medHb, $msFim, $medFim), $medHb < 40 && $medFim < 60);
    resetarLimites();

    secao('v3 · concorrência (php -S com 4 processos): muita gente salvando, sincronizando, compartilhando e lendo o Hall ao mesmo tempo');
    $jog = array_slice($uids, 100, 40);
    q('UPDATE usuarios SET partidas_conta = 5 WHERE id IN (' . marcasT(count($jog)) . ')', $jog);
    $cks = [];
    $vidsPar = [];
    foreach ($jog as $uid) {
        $cks[$uid] = sessaoDireta($uid);
        // cada um começou a carreira há 1 min (o e.php só conta o fim pareado com um início do mesmo aparelho)
        $vidsPar[$uid] = uuid4();
        q("INSERT INTO eventos (sid, vid, tipo, modo, dados, em) VALUES (?, ?, 'jogo_inicio', 'classico', NULL, UTC_TIMESTAMP() - INTERVAL 60 SECOND)",
            [uuid4(), $vidsPar[$uid]]);
    }
    $pedidos = [];
    foreach ($jog as $i => $uid) {
        $h = hallEntry("par-$uid", ['nota' => 99, 'pais' => 'BOL', 'clubes' => ['e609']]);
        $pedidos[] = ['POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $h, 'como' => 'auto'], $cks[$uid], "salvar-$uid"];
        $pedidos[] = ['POST', '/api/conquistas.php', ['acao' => 'sincronizar', 'conquistas' => [['id' => 'goat'], ['id' => "par_$i"]]], $cks[$uid], "conq-$uid"];
        $pedidos[] = ['POST', '/api/bonus.php', ['acao' => 'compartilhei', 'carreiraId' => "par-$uid"], $cks[$uid], "comp-$uid"];
        $pedidos[] = ['GET', '/api/hall.php?' . ['', 'pais=BRA', 'clube=e150', 'pais=ARG&clube=e120'][$i % 4], null, [], "hall-$uid"];
        $pedidos[] = ['POST', '/api/e.php', ['v' => $vidsPar[$uid], 's' => uuid4(), 'bot' => 0, 'ctx' => ctx(), 'ev' => [['t' => 'hb', 'p' => 1], ['t' => 'jogo_fim', 'm' => 'classico']]],
            $cks[$uid], "e-$uid"];
        if ($i % 10 === 5) {
            $pedidos[] = ['POST', '/api/admin.php', ['acao' => 'atualizar_hall'], $ADM->jar, "adm-$i"];
        }
    }
    shuffle($pedidos);
    resetarLimites();
    $t1 = microtime(true);
    $res = paralelo($pedidos);
    $msPar = (microtime(true) - $t1) * 1000;
    $ruins = [];
    foreach ($res as $rot => [$st, $corpo]) {
        $ok = str_starts_with((string) $rot, 'e-') ? $st === 204 : (str_starts_with((string) $rot, 'adm-') ? in_array($st, [200, 409], true) : $st === 200);
        if (!$ok) {
            $ruins[] = "$rot → $st " . substr($corpo, 0, 120);
        }
    }
    checar(sprintf('%d pedidos ao mesmo tempo (salvar, conquistas, compartilhar, Hall, medição, atualizar Hall): todos certos em %.0f ms', count($pedidos), $msPar),
        !$ruins, implode(' | ', array_slice($ruins, 0, 5)));
    checar('cada conta salvou a sua carreira, uma vez', (int) v("SELECT COUNT(*) FROM carreiras WHERE carreira_id LIKE 'par-%'") === 40
        && (int) v("SELECT COUNT(DISTINCT usuario_id) FROM carreiras WHERE carreira_id LIKE 'par-%'") === 40);
    checar('conquistas de todas', (int) v("SELECT COUNT(*) FROM conquistas_usuario WHERE conquista_id LIKE 'par\\_%'") === 40);
    checar('compartilhar: exatamente 1 bônus por conta', (int) v("SELECT COUNT(*) FROM bonus WHERE origem = 'compartilhar'") === 40
        && (int) v("SELECT MAX(n) FROM (SELECT COUNT(*) AS n FROM bonus WHERE origem = 'compartilhar' GROUP BY usuario_id) t") === 1);
    checar('partidas das 40 contas somadas pelo e.php', (int) v('SELECT SUM(partidas_conta) FROM usuarios WHERE id IN (' . marcasT(count($jog)) . ')', $jog) === 40 * 6);
    // a mesma conta, 12 pedidos ao mesmo tempo: usar (3 bônus) e compartilhar
    $u0 = $jog[0];
    q('DELETE FROM bonus WHERE usuario_id = ?', [$u0]);
    foreach ([2, 3, 5] as $val) {
        q("INSERT INTO bonus (usuario_id, valor, origem, ref, criado_em) VALUES (?, ?, 'admin', 'carga', UTC_TIMESTAMP())", [$u0, $val]);
    }
    $ped = [];
    for ($i = 0; $i < 8; $i++) {
        $ped[] = ['POST', '/api/bonus.php', ['acao' => 'usar', 'carreiraId' => "u0-$i"], $cks[$u0], "usar-$i"];
    }
    $valores = array_map(static fn($x) => (int) ($x[2]['valor'] ?? -1), array_values(paralelo($ped)));
    sort($valores);
    $ped = [];
    for ($i = 0; $i < 6; $i++) {
        $ped[] = ['POST', '/api/bonus.php', ['acao' => 'compartilhei', 'carreiraId' => 'x'], $cks[$u0], "comp-$i"];
    }
    $ganhos = array_sum(array_map(static fn($x) => (int) ($x[2]['ganhou'] ?? 0), paralelo($ped)));
    checar('8 "usar" ao mesmo tempo com 3 bônus: cada bônus vai para uma carreira só (0,0,0,0,0,2,3,5)', $valores === [0, 0, 0, 0, 0, 2, 3, 5]
        && (int) v('SELECT COUNT(DISTINCT carreira_id) FROM bonus WHERE usuario_id = ? AND usado_em IS NOT NULL', [$u0]) === 3, json_encode($valores));
    checar('6 "compartilhei" ao mesmo tempo: só um ganha (+2), um bônus só', $ganhos === 2
        && (int) v("SELECT COUNT(*) FROM bonus WHERE usuario_id = ? AND origem = 'compartilhar'", [$u0]) === 1, "ganhos $ganhos");
    // 5 denúncias ao mesmo tempo na mesma carreira (contas de mais de 24 h, com partidas; fora das 10 primeiras do Hall)
    $fiscais = array_slice($jog, 1, 5);
    q('UPDATE usuarios SET criado_em = UTC_TIMESTAMP() - INTERVAL 3 DAY WHERE id IN (' . marcasT(5) . ')', $fiscais);
    resetarLimites();
    $alvo = (string) v('SELECT carreira_id FROM hall_foto WHERE usuario_id NOT IN (' . marcasT(5) . ') AND id > 20 ORDER BY id LIMIT 1', $fiscais);
    $ped = [];
    foreach ($fiscais as $uid) {
        $ped[] = ['POST', '/api/hall.php', ['acao' => 'denunciar', 'id' => $alvo, 'motivo' => 'trapaca'], $cks[$uid], "den-$uid"];
    }
    $res = paralelo($ped);
    checar('5 denúncias ao mesmo tempo: 5 gravadas, a carreira oculta (2) e fora do Hall', count(array_filter($res, static fn($x) => $x[0] === 200)) === 5
        && (int) v('SELECT COUNT(*) FROM denuncias') === 5 && (int) v('SELECT oculta FROM carreiras WHERE carreira_id = ?', [$alvo]) === 2
        && (int) v('SELECT COUNT(*) FROM hall_foto WHERE carreira_id = ?', [$alvo]) === 0);
    // fotografia vencida e 24 leitores ao mesmo tempo: só um refaz, ninguém erra
    envelhecerFoto(61);
    $antesEm = (string) json_decode((string) v("SELECT valor FROM site_config WHERE chave = '_hall_foto'"), true)['em'];
    $ped = [];
    for ($i = 0; $i < 24; $i++) {
        $ped[] = ['GET', '/api/hall.php?pagina=' . ($i % 5 + 1), null, [], "ler-$i"];
    }
    $res = paralelo($ped);
    $ems = array_unique(array_map(static fn($x) => (string) ($x[2]['atualizadoEm'] ?? ''), $res));
    checar('foto vencida + 24 leitores ao mesmo tempo: todos 200, respondem a antiga ou a nova (nunca pela metade)',
        count(array_filter($res, static fn($x) => $x[0] === 200 && count($x[2]['itens'] ?? []) === 50)) === 24 && count($ems) <= 2, json_encode(array_values($ems)));
    $emNova = $antesEm;
    for ($i = 0; $i < 100 && $emNova === $antesEm; $i++) { // a troca roda depois das respostas
        usleep(100_000);
        $emNova = (string) json_decode((string) v("SELECT valor FROM site_config WHERE chave = '_hall_foto'"), true)['em'];
    }
    checar('…um deles refez logo depois, e a fotografia nova está inteira (posições sem buraco)', $emNova !== $antesEm
        && (int) v('SELECT COUNT(*) FROM hall_foto') === (int) v('SELECT MAX(id) FROM hall_foto'));
    $logPhp = (string) file_get_contents($LOG_PHP);
    checar('sem deadlock nem erro no log do PHP durante a concorrência', !preg_match('/Deadlock|Lock wait timeout|LENDA PDOException/i', $logPhp));
}

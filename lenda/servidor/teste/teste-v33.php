<?php
/**
 * LENDA · testes da v3.3, lado do servidor (CONTRATO-v33.md §A): banco e desafios de fábrica, e-mail verificado, Fale
 * conosco, limite de partidas por dia, replay na HallEntry, desafios (quem vira candidato, verificação, vencedor,
 * concorrência), perfil público, LGPD, entradas erradas (nenhum 500) e o banco sem o instalar da v3.3. Com HallEntry reais
 * (amostras v-intenso-01 e, em amostras/v33/, v-intenso-03 e v-otima-02) e o replay de uma carreira real gravada
 * (scripts/gravar/filas).
 * Incluído pelo teste.php depois do teste-v32-corr.php (usa os ajudantes dele, do teste-v3.php, do teste-v32-mod.php,
 * do teste-v32-acesso.php e do teste-v32-integ.php). Deixa a equipe vazia e os desafios desativados no fim.
 */
declare(strict_types=1);

// ── ajudantes ────────────────────────────────────────────────────────────────────────────────────

$V33_FILA = json_decode((string) file_get_contents(dirname($SRC) . '/scripts/gravar/filas/classico.json'), true, 512, JSON_THROW_ON_ERROR);
/** §E: a conta de cada navegador criado por v33Conta (spl_object_id → usuarios.id), para a semente do servidor. */
$V33_UIDS = [];

/**
 * §E: antes de salvar (salvarC chama isto), a semente do replay da carreira fica como sorteada pelo servidor para a conta
 * do navegador (sementes_carreira, agora): os HallEntry do teste usam o replay real das filas, cuja semente não saiu do
 * sorteio do servidor. Só nas contas de v33Conta; as outras salvam como quem jogou sem a conta (sem_semente).
 */
function v33AntesDeSalvar(Navegador $n, stdClass $h): void
{
    $uid = $GLOBALS['V33_UIDS'][spl_object_id($n)] ?? null;
    $seed = $h->replay->seed ?? null;
    if ($uid === null || !is_array($seed) || count($seed) !== 2 || !is_int($seed[0]) || !is_int($seed[1])) {
        return;
    }
    v33Semente($uid, $seed);
}

/** §E: a semente [a0, a1] como sorteada pelo servidor para a conta ($quando = DATETIME(3) do sorteio; null = agora). */
function v33Semente(int $uid, array $seed, ?string $quando = null): void
{
    $s = base_convert((string) $seed[0], 10, 36) . base_convert((string) $seed[1], 10, 36);
    q('INSERT IGNORE INTO sementes_carreira (usuario_id, semente, dia, emitida_em) VALUES (?, ?, ?, ' . ($quando === null ? 'UTC_TIMESTAMP(3)' : '?') . ')',
        $quando === null ? [$uid, $s, v33Hoje()] : [$uid, $s, v33Hoje(), $quando]);
}

/** Estado conhecido: o da v3.2 e as tabelas da v3.3 vazias, os desafios de fábrica desativados. */
function v33Limpar(): void
{
    limparV32();
    foreach (['desafio_candidatos', 'mensagens_suporte', 'verificacoes_email', 'partidas_dia', 'sementes_carreira'] as $t) {
        q("DELETE FROM $t");
    }
    q("DELETE FROM desafios WHERE slug NOT IN ('tacas-do-rei', 'tacas-do-rei-copas', 'todas-as-conquistas')");
    v33ZerarDesafios();
    q("DELETE FROM site_config WHERE chave IN ('partidas_dia_max')");
}

/** Os desafios de fábrica desativados, sem vencedor nem candidatos. */
function v33ZerarDesafios(): void
{
    q('DELETE FROM desafio_candidatos');
    q("UPDATE desafios SET ativo = 0, inicio = NULL, fim = NULL, vencedor_usuario_id = NULL, vencedor_carreira_pk = NULL, vencedor_candidato = NULL,
        vencido_em = NULL");
}

function v33Adm(array $corpo): Resposta
{
    return integAdm('POST', '/api/admin.php', $corpo);
}

function v33Get(string $qs): Resposta
{
    return integAdm('GET', '/api/admin.php?' . $qs);
}

function v33IdDesafio(string $slug): int
{
    return (int) v('SELECT id FROM desafios WHERE slug = ?', [$slug]);
}

/**
 * Ativa (ou desativa) pelo admin. Ao ativar, as carreiras que entraram na conta neste mesmo segundo ficam 5 s mais velhas:
 * o início do desafio é contado em segundos e o teste quer saber, sem sorte, o que é "antes" e o que é "depois".
 */
function v33Ativar(string $slug, bool $ativo = true): Resposta
{
    if ($ativo) {
        q('UPDATE carreiras SET primeira_em = primeira_em - INTERVAL 5 SECOND WHERE primeira_em >= UTC_TIMESTAMP() - INTERVAL 2 SECOND');
        // §E: e a semente sorteada no mesmo segundo
        q('UPDATE carreiras SET semente_em = semente_em - INTERVAL 5 SECOND WHERE semente_em >= UTC_TIMESTAMP(3) - INTERVAL 2 SECOND');
        q('UPDATE sementes_carreira SET emitida_em = emitida_em - INTERVAL 5 SECOND WHERE emitida_em >= UTC_TIMESTAMP(3) - INTERVAL 2 SECOND');
    }
    return v33Adm(['acao' => 'desafio_ativar', 'id' => v33IdDesafio($slug), 'ativo' => $ativo]);
}

/** Candidatos do desafio, na ordem (em, id). */
function v33Cands(string $slug): array
{
    return q('SELECT * FROM desafio_candidatos WHERE desafio_id = ? ORDER BY em, id', [v33IdDesafio($slug)]);
}

/** O replay de uma carreira real gravada (scripts/gravar/filas/classico.json), no formato do contrato. */
function v33Replay(int $i = 0, array $troca = []): array
{
    global $V33_FILA;
    $f = $V33_FILA[$i % count($V33_FILA)];
    $r = ['v' => 1, 'seed' => [$f['a0'], $f['a1']], 'identity' => $f['identity'], 'pace' => $f['pace'],
        'picks' => array_map(static fn(array $p): array => ['id' => $p['id'], 'kind' => $p['kind'], 'idx' => $p['idx'], 'pen' => $p['pen'], 'n' => $p['n']], $f['picks']),
        'bonusOvr' => 0, 'dados' => 'lenda-dados-teste-v33'];
    return array_replace($r, $troca);
}

/** Um HallEntry real de uma amostra (id próprio, legacy.v da versão atual, resumo só dele). */
function v33DaAmostra(string $amostra, string $id, int $nota): stdClass
{
    $h = json_decode(canon(amostra($amostra)), false);
    $h->id = $id;
    $h->career->id = $id;
    $h->legacy->v = 2;
    $h->legacy->score = $nota;
    $h->summary->testeId = $id;
    return $h;
}

/**
 * HallEntry real com exatamente $copas Copas do Mundo e $lib Libertadores. $replay: true = o replay real; array = esse;
 * false = sem replay. $m vai para o hallEntry() do teste-v3 (nota, modo...). $amostra: outra amostra real.
 */
function v33Hall(string $id, int $copas, int $lib, bool|array $replay = true, array $m = [], ?string $amostra = null): stdClass
{
    $h = $amostra === null ? hallEntry($id, $m + ['nota' => 70]) : v33DaAmostra($amostra, $id, (int) ($m['nota'] ?? 70));
    $tr = [];
    foreach ($h->summary->trophies as $t) {
        if (!in_array($t->trophyId, ['world-cup', 'libertadores'], true)) {
            $tr[] = $t;
        }
    }
    if ($copas > 0) {
        $tr[] = (object) ['trophyId' => 'world-cup', 'count' => $copas, 'seasons' => []];
    }
    if ($lib > 0) {
        $tr[] = (object) ['trophyId' => 'libertadores', 'count' => $lib, 'seasons' => []];
    }
    $h->summary->trophies = $tr;
    if ($replay === true) {
        $h->replay = json_decode(json_encode(v33Replay()), false);
    } elseif (is_array($replay)) {
        $h->replay = json_decode(json_encode($replay), false);
    }
    return $h;
}

/** Salva sem liberar a revisão da nota alta (o desafio aceita a carreira que espera a revisão). */
function v33Salvar(Navegador $n, stdClass $h): Resposta
{
    return salvarC($n, $h, 'manual', false);
}

/**
 * Conta pronta para desafio: cadastro de verdade e, direto no banco, o e-mail confirmado e as partidas com a conta.
 * Devolve [nav, uid, email, senha].
 */
function v33Conta(string $apelido, bool $verificada = true, int $partidas = 30): array
{
    [$n, $uid, , , $email] = novaConta($apelido);
    $GLOBALS['V33_UIDS'][spl_object_id($n)] = $uid;
    $senha = 'senha-v3-' . $GLOBALS['CONTAS_N'];
    if ($verificada) {
        q('UPDATE usuarios SET email_verificado_em = UTC_TIMESTAMP() WHERE id = ?', [$uid]);
    }
    q('UPDATE usuarios SET partidas_conta = ? WHERE id = ?', [$partidas, $uid]);
    return [$n, $uid, $email, $senha];
}

function v33Eu(Navegador $n, string $slug): ?array
{
    $r = $n->pedir('GET', '/api/desafios.php?eu=1');
    foreach ($r->json['desafios'] ?? [] as $d) {
        if (($d['slug'] ?? '') === $slug) {
            return $d['eu'] ?? null;
        }
    }
    return null;
}

function v33Publico(string $slug): ?array
{
    global $anon;
    foreach ($anon->pedir('GET', '/api/desafios.php')->json['desafios'] ?? [] as $d) {
        if (($d['slug'] ?? '') === $slug) {
            return $d;
        }
    }
    return null;
}

function v33Hoje(): string
{
    return gmdate('Y-m-d', time() - 10800);
}

$RE_ISO_MS = '/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/';
v33Limpar();
acLimparEquipe();

// ══ 1. banco ════════════════════════════════════════════════════════════════════════════════════

secao('v3.3 · banco: colunas e tabelas novas, _esquema 33 e os desafios de fábrica desativados');
$colunas = static fn(string $t): array => array_column(q("SHOW COLUMNS FROM $t"), 'Field');
checar('usuarios.email_verificado_em; carreiras.tem_replay, libertadores, primeira_em, fora_desafio', in_array('email_verificado_em', $colunas('usuarios'), true)
    && !array_diff(['tem_replay', 'libertadores', 'primeira_em', 'fora_desafio'], $colunas('carreiras')));
checar('tabelas verificacoes_email, partidas_dia, mensagens_suporte, desafios e desafio_candidatos', count(array_filter(['verificacoes_email', 'partidas_dia',
    'mensagens_suporte', 'desafios', 'desafio_candidatos'], static fn(string $t): bool => count(q("SHOW TABLES LIKE '$t'")) === 1)) === 5);
checar('site_config._esquema = 34 (v3.4)', (int) v("SELECT valor FROM site_config WHERE chave = '_esquema'") === 34);
$fab = q("SELECT slug, ativo, premio, criterio, requisitos, inicio, vencido_em, regulamento FROM desafios ORDER BY ordem");
checar('os 3 de fábrica: tacas-do-rei (3 Copas + 2 Libertadores), tacas-do-rei-copas (3 Copas), todas-as-conquistas; desativados, prêmio vazio, sem início',
    array_column($fab, 'slug') === ['tacas-do-rei', 'tacas-do-rei-copas', 'todas-as-conquistas']
    && array_sum(array_map('intval', array_column($fab, 'ativo'))) === 0 && array_unique(array_column($fab, 'premio')) === ['']
    && json_decode((string) $fab[0]['criterio'], true) === ['copas' => 3, 'libertadores' => 2] && json_decode((string) $fab[1]['criterio'], true) === ['copas' => 3]
    && json_decode((string) $fab[2]['criterio'], true) === ['todasConquistas' => true]
    && json_decode((string) $fab[0]['requisitos'], true) === ['partidasMin' => 30, 'emailVerificado' => true, 'publicadoNoHall' => true, 'top3Perfil' => true]
    && array_unique(array_column($fab, 'inicio')) === [null] && str_contains((string) $fab[0]['regulamento'], '30 partidas'), json_encode($fab));
q("UPDATE desafios SET premio = 'texto do admin', titulo = 'Título do admin' WHERE slug = 'tacas-do-rei'");
q("DELETE FROM desafios WHERE slug = 'todas-as-conquistas'");
$r = $anon->pedir('POST', '/api/instalar.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
checar('instalar de novo: idempotente; o de fábrica que o admin mudou fica como está e o que faltava volta (v33.desafios = 1)', $r->status === 200
    && ($r->json['alteracoes'] ?? null) === [] && ($r->json['v33']['desafios'] ?? null) === 1
    && v("SELECT premio FROM desafios WHERE slug = 'tacas-do-rei'") === 'texto do admin' && (int) v('SELECT COUNT(*) FROM desafios') === 3, $r->resumo());
q("UPDATE desafios SET premio = '', titulo = 'As Taças do Rei' WHERE slug = 'tacas-do-rei'");
[$navL, $uidL] = novaConta('Antiga Lib');
salvarC($navL, v33Hall('v33-antiga-lib', 1, 4, false));
q('ALTER TABLE carreiras DROP COLUMN libertadores'); // um banco de antes da v3.3: a carreira não tem a coluna
$r = $anon->pedir('POST', '/api/instalar.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
checar('instalar num banco sem carreiras.libertadores: acrescenta a coluna e preenche as antigas pelo HallEntry guardado',
    $r->status === 200 && in_array('carreiras: coluna libertadores', $r->json['alteracoes'] ?? [], true) && ($r->json['v33']['libertadores'] ?? 0) >= 1
    && (int) v('SELECT libertadores FROM carreiras WHERE usuario_id = ?', [$uidL]) === 4 && ($r->json['preenchidas']['faltam'] ?? -1) === 0, $r->resumo());
$r = $anon->pedir('GET', '/api/desafios.php');
checar('GET desafios.php com tudo desativado → {desafios: []}, público (cache de 60 s)', $r->status === 200 && ($r->json['desafios'] ?? null) === []
    && $r->cab1('cache-control') === 'public, max-age=60', $r->resumo());
$ts = (string) file_get_contents(dirname($SRC) . '/src/engine/career/achievements.ts');
preg_match_all("/\bid: '([a-z0-9_.:-]+)'/", $ts, $mm);
$idsPhp = phpComLib("require " . var_export(dirname(__DIR__) . '/api/_desafios.php', true) . "; echo json_encode(['ids' => CONQUISTAS_IDS, 'n' => CONQUISTAS_TOTAL]);");
checar('as 87 conquistas do servidor são as do jogo (src/engine/career/achievements.ts)', count($mm[1]) === 87 && ($idsPhp['n'] ?? 0) === 87
    && ($idsPhp['ids'] ?? null) === $mm[1], count($mm[1]) . ' no jogo');

// ══ 2. e-mail verificado ═══════════════════════════════════════════════════════════════════════

secao('v3.3 · e-mail verificado: código no cadastro, verificar_email, reenviar, limites e tentativas');
resetarLimitesCurtos();
q("DELETE FROM tentativas WHERE chave LIKE 'dia-verif-%'");
$navE = novoNav();
$emailE = 'verif-' . bin2hex(random_bytes(3)) . '@exemplo.com';
$antes = emailsPara($emailE);
$r = conta($navE, ['acao' => 'cadastrar', 'apelido' => 'Confirma Mail', 'email' => $emailE, 'senha' => 'senha-verif-1', 'aceite' => true]);
$uidE = (int) ($r->json['usuario']['id'] ?? 0);
checar('cadastrar → 201 com U.emailVerificado = false', $r->status === 201 && ($r->json['usuario']['emailVerificado'] ?? null) === false, $r->resumo());
$mail = esperarEmailNovo($emailE, $antes);
$cod1 = codigoDe($mail);
checar('…e o e-mail com o código de 6 dígitos (24 h) chega logo depois; no banco só o HMAC', $cod1 !== null && str_contains((string) $mail, '24 horas')
    && strlen((string) v('SELECT codigo_hash FROM verificacoes_email WHERE usuario_id = ?', [$uidE])) === 64
    && (string) v('SELECT codigo_hash FROM verificacoes_email WHERE usuario_id = ?', [$uidE]) !== $cod1
    && v("SELECT tipo FROM email_log ORDER BY id DESC LIMIT 1") === 'verificacao', substr((string) $mail, 0, 300));
$r = conta($anon, ['acao' => 'verificar_email', 'codigo' => $cod1]);
checar('verificar_email sem sessão → 401', $r->status === 401 && $r->erro() === 'nao_logado', $r->resumo());
$errado = $cod1 === '000000' ? '111111' : '000000';
$r = conta($navE, ['acao' => 'verificar_email', 'codigo' => $errado]);
checar('código errado → 400 codigo_invalido (gasta uma tentativa)', $r->status === 400 && $r->erro() === 'codigo_invalido'
    && (int) v('SELECT tentativas FROM verificacoes_email WHERE usuario_id = ?', [$uidE]) === 1, $r->resumo());
$ruins = [];
resetarLimitesCurtos();
foreach ([null, '', '12345', '1234567', 'abcdef', [], ['a' => 1], 1.5, true, ' 12 34 '] as $x) {
    $r = conta($navE, ['acao' => 'verificar_email', 'codigo' => $x]);
    if ($r->status !== 400 || $r->erro() !== 'codigo_invalido') {
        $ruins[] = json_encode($x) . " → $r->status";
    }
}
checar('código fora do formato (vazio, curto, letras, lista, objeto, número quebrado) → 400 codigo_invalido, nunca 500', !$ruins, implode('; ', $ruins));
resetarLimitesCurtos();
for ($i = 0; $i < 4; $i++) {
    conta($navE, ['acao' => 'verificar_email', 'codigo' => $errado]);
}
$r = conta($navE, ['acao' => 'verificar_email', 'codigo' => $cod1]);
checar('5 códigos errados: o certo também não vale mais (pede outro) → 400', $r->status === 400 && $r->erro() === 'codigo_invalido'
    && (int) v('SELECT tentativas FROM verificacoes_email WHERE usuario_id = ?', [$uidE]) === 5, $r->resumo());
$antes = emailsPara($emailE);
$r = conta($navE, ['acao' => 'reenviar_verificacao']);
$cod2 = codigoDe(esperarEmailNovo($emailE, $antes));
checar('reenviar_verificacao → 200 {ok} e um código novo (tentativas zeradas)', $r->status === 200 && ($r->json['ok'] ?? false) === true && $cod2 !== null
    && (int) v('SELECT tentativas FROM verificacoes_email WHERE usuario_id = ?', [$uidE]) === 0, $r->resumo());
q('UPDATE verificacoes_email SET expira_em = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE usuario_id = ?', [$uidE]);
$r = conta($navE, ['acao' => 'verificar_email', 'codigo' => $cod2]);
checar('código vencido (24 h) → 400', $r->status === 400 && $r->erro() === 'codigo_invalido', $r->resumo());
resetarLimitesCurtos();
$antes = emailsPara($emailE);
conta($navE, ['acao' => 'reenviar_verificacao']);
$cod3 = codigoDe(esperarEmailNovo($emailE, $antes));
q('UPDATE usuarios SET email = ? WHERE id = ?', ['trocado-' . $emailE, $uidE]);
$r = conta($navE, ['acao' => 'verificar_email', 'codigo' => $cod3]);
checar('o código fica preso ao e-mail: com o e-mail da conta trocado, ele não vale', $r->status === 400, $r->resumo());
q('UPDATE usuarios SET email = ? WHERE id = ?', [$emailE, $uidE]);
$r = conta($navE, ['acao' => 'verificar_email', 'codigo' => (int) $cod3]);
checar('com o e-mail de volta, o código certo (até como número) → 200 e U.emailVerificado = true; o código sai do banco', $r->status === 200
    && ($r->json['usuario']['emailVerificado'] ?? null) === true && v('SELECT email_verificado_em FROM usuarios WHERE id = ?', [$uidE]) !== null
    && (int) v('SELECT COUNT(*) FROM verificacoes_email WHERE usuario_id = ?', [$uidE]) === 0, $r->resumo());
$r = conta($navE, ['acao' => 'verificar_email', 'codigo' => '999999']);
checar('já confirmado: verificar_email de novo → 200 (nada muda)', $r->status === 200 && ($r->json['usuario']['emailVerificado'] ?? null) === true, $r->resumo());
$antes = emailsPara($emailE);
$r = conta($navE, ['acao' => 'reenviar_verificacao']);
checar('já confirmado: reenviar → 200 {ok, jaVerificado: true} sem e-mail', $r->status === 200 && ($r->json['jaVerificado'] ?? false) === true
    && count(emailsPara($emailE)) === count($antes), $r->resumo());
$r = $navE->pedir('GET', '/api/conta.php');
checar('GET conta.php: U.emailVerificado', ($r->json['usuario']['emailVerificado'] ?? null) === true, $r->resumo());
[$navR, $uidR] = novaConta('Reenvia Muito');
resetarLimitesCurtos();
$st = [];
for ($i = 0; $i < 4; $i++) {
    $st[] = conta($navR, ['acao' => 'reenviar_verificacao'])->status;
}
checar('reenviar: 3 a cada 10 min por conta; o 4º → 429', $st === [200, 200, 200, 429], json_encode($st));
resetarLimitesCurtos();
encherLimite('dia-reenviar-verif:u' . $uidR, 10, true);
$r = conta($navR, ['acao' => 'reenviar_verificacao']);
checar('reenviar: 10 por dia por conta → 429', $r->status === 429 && $r->erro() === 'limite', $r->resumo());
resetarLimitesCurtos();
encherLimite('verif-ped:todos', 40);
$r = conta($navR, ['acao' => 'reenviar_verificacao']);
checar('reenviar: teto do site (§E: o balde do "Reenviar código", 40 a cada 10 min) → 429', $r->status === 429, $r->resumo());
resetarLimitesCurtos();
$st = [];
for ($i = 0; $i < 11; $i++) {
    $st[] = conta($navR, ['acao' => 'verificar_email', 'codigo' => '123456'])->status;
}
checar('verificar_email: 10 tentativas a cada 10 min por conta; a 11ª → 429', count(array_filter($st, static fn(int $s): bool => $s === 400)) === 10 && end($st) === 429,
    json_encode($st));
resetarLimitesCurtos();
q('UPDATE usuarios SET email_verificado_em = NULL WHERE id = ?', [$uidL]);
checar('conta antiga começa não verificada (U.emailVerificado false)', ($navL->pedir('GET', '/api/conta.php')->json['usuario']['emailVerificado'] ?? null) === false);
// admin: reenviar a verificação de uma conta (Usuários)
[$navLeitor] = navEquipe('leitor');
$r = $navLeitor->pedir('POST', '/api/admin.php', ['acao' => 'reenviar_verificacao', 'id' => $uidR]);
checar('admin reenviar_verificacao: papel leitor → 403 sem_poder', $r->status === 403 && $r->erro() === 'sem_poder', $r->resumo());
$r = $navR->pedir('POST', '/api/admin.php', ['acao' => 'reenviar_verificacao', 'id' => $uidR]);
checar('…jogador (sem admin) → 401', $r->status === 401, $r->resumo());
[$navSup] = navEquipe('suporte');
$r = $navSup->pedir('POST', '/api/admin.php', ['acao' => 'reenviar_verificacao', 'id' => $uidR]);
checar('…papel suporte → 200 {enviado, para mascarado}; registrado', $r->status === 200 && ($r->json['enviado'] ?? null) === true
    && str_contains((string) ($r->json['para'] ?? ''), '***@') && acUltimoLog('reenviar_verificacao') !== null, $r->resumo());
$r = v33Adm(['acao' => 'reenviar_verificacao', 'id' => $uidE]);
checar('…conta já verificada → 409 ja_verificado; conta que não existe → 404', $r->status === 409 && $r->erro() === 'ja_verificado'
    && v33Adm(['acao' => 'reenviar_verificacao', 'id' => 999999])->status === 404, $r->resumo());
$r = v33Get('r=usuarios&verificado=1');
$ids1 = array_column($r->json['itens'] ?? [], 'id');
$r0 = v33Get('r=usuarios&verificado=0');
checar('Usuários: emailVerificado em cada item, filtro verificado=1|0 e contagens.verificado', $r->status === 200 && in_array($uidE, $ids1, true)
    && !in_array($uidR, $ids1, true) && in_array($uidR, array_column($r0->json['itens'] ?? [], 'id'), true)
    && ($r->json['itens'][0]['emailVerificado'] ?? null) === true && is_int($r->json['contagens']['verificado']['sim'] ?? null), $r->resumo());
$r = v33Get('r=usuario&id=' . $uidE);
checar('ficha da conta: emailVerificadoEm, desafios e mensagens', $r->status === 200 && preg_match($RE_ISO, (string) ($r->json['usuario']['emailVerificadoEm'] ?? '')) === 1
    && ($r->json['usuario']['emailVerificado'] ?? null) === true && is_array($r->json['usuario']['desafios'] ?? null) && is_array($r->json['usuario']['mensagens'] ?? null), $r->resumo());

// ══ 3. Fale conosco ═════════════════════════════════════════════════════════════════════════════

secao('v3.3 · Fale conosco: suporte.php (com e sem conta, isca, limites) e as rotas do admin');
resetarLimitesCurtos();
$r = $anon->pedir('GET', '/api/suporte.php');
checar('GET suporte.php → e-mail de contato e os 5 tipos', $r->status === 200 && ($r->json['email'] ?? '') === 'contato@oprojeto.online'
    && array_column($r->json['tipos'] ?? [], 'id') === ['duvida', 'ideia', 'problema', 'recomendacao', 'outro'], $r->resumo());
$msgOk = 'Como faço para jogar com o meu amigo no mesmo aparelho?';
$r = $anon->pedir('POST', '/api/suporte.php', ['tipo' => 'duvida', 'mensagem' => $msgOk, 'email' => 'x@exemplo.com'], ['origem' => false]);
$r2 = $anon->pedir('POST', '/api/suporte.php', ['tipo' => 'duvida', 'mensagem' => $msgOk, 'email' => 'x@exemplo.com'], ['origem' => 'https://outro-site.example']);
$r3 = $anon->pedir('POST', '/api/suporte.php', canon(['tipo' => 'duvida', 'mensagem' => $msgOk, 'email' => 'x@exemplo.com']), ['tipo' => 'text/plain']);
checar('sem Origin, de outro site ou sem JSON → 403 origem', $r->status === 403 && $r2->status === 403 && $r3->status === 403 && $r->erro() === 'origem', $r->resumo());
resetarLimitesCurtos();
$r = $anon->pedir('POST', '/api/suporte.php', ['tipo' => 'duvida', 'mensagem' => $msgOk]);
checar('sem conta e sem e-mail → 400 email_invalido', $r->status === 400 && $r->erro() === 'email_invalido', $r->resumo());
$emailAnon = 'anonimo-' . bin2hex(random_bytes(3)) . '@exemplo.com';
$r = $anon->pedir('POST', '/api/suporte.php', ['tipo' => 'duvida', 'mensagem' => "  $msgOk\n\n\n\n\nObrigado!  ", 'email' => strtoupper($emailAnon), 'pagina' => '/conta']);
$protA = (string) ($r->json['protocolo'] ?? '');
$mA = q('SELECT * FROM mensagens_suporte WHERE protocolo = ?', [$protA])[0] ?? [];
checar('sem conta, com e-mail → 201 {ok, protocolo de 8}; gravada como nova, e-mail minúsculo, sem conta, a tela e o texto limpo',
    $r->status === 201 && preg_match('/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/', $protA) === 1 && ($mA['status'] ?? '') === 'nova'
    && ($mA['email'] ?? '') === $emailAnon && $mA['usuario_id'] === null && ($mA['pagina'] ?? '') === '/conta'
    && ($mA['mensagem'] ?? '') === "$msgOk\n\nObrigado!", $r->resumo() . ' ' . json_encode($mA));
[$navM, $uidM, , , $emailM] = novaConta('Manda Mensagem');
resetarLimitesCurtos();
$r = $navM->pedir('POST', '/api/suporte.php', ['tipo' => 'ideia', 'mensagem' => 'Que tal um modo com a Série B inteira?', 'email' => 'outro@exemplo.com']);
$mM = q('SELECT * FROM mensagens_suporte WHERE protocolo = ?', [(string) ($r->json['protocolo'] ?? '')])[0] ?? [];
checar('logado → 201; a mensagem fica na conta e SEM e-mail (a resposta vai para o da conta)', $r->status === 201 && (int) ($mM['usuario_id'] ?? 0) === $uidM
    && $mM['email'] === null, $r->resumo());
$ruins = [];
foreach ([
    [['tipo' => 'elogio', 'mensagem' => $msgOk, 'email' => 'a@b.com'], 'tipo'], [['tipo' => 1, 'mensagem' => $msgOk, 'email' => 'a@b.com'], 'tipo'],
    [['mensagem' => $msgOk, 'email' => 'a@b.com'], 'tipo'], [['tipo' => 'outro', 'mensagem' => 'curta', 'email' => 'a@b.com'], 'mensagem_curta'],
    [['tipo' => 'outro', 'mensagem' => '   ' . str_repeat(' ', 30) . "\n\n", 'email' => 'a@b.com'], 'mensagem_curta'],
    [['tipo' => 'outro', 'mensagem' => str_repeat('a', 2001), 'email' => 'a@b.com'], 'mensagem_longa'],
    [['tipo' => 'outro', 'mensagem' => ['x'], 'email' => 'a@b.com'], 'mensagem_curta'], [['tipo' => 'outro', 'mensagem' => 12345678901, 'email' => 'a@b.com'], 'mensagem_curta'],
    [['tipo' => 'outro', 'mensagem' => $msgOk, 'email' => 'nao-e-email'], 'email_invalido'], [['tipo' => 'outro', 'mensagem' => $msgOk, 'email' => ['a@b.com']], 'email_invalido'],
] as $i => [$corpo, $erroEsperado]) {
    resetarLimitesCurtos();
    $r = $anon->pedir('POST', '/api/suporte.php', $corpo);
    if ($r->status !== 400 || $r->erro() !== $erroEsperado) {
        $ruins[] = "#$i → $r->status " . $r->erro();
    }
}
resetarLimitesCurtos();
$r = $anon->pedir('POST', '/api/suporte.php', '[1,2,3]');
$r2 = $anon->pedir('POST', '/api/suporte.php', '{"tipo":');
checar('tipo errado ou que falta, mensagem curta/vazia/longa/lista/número, e-mail ruim, JSON que não é objeto → 400 com o código certo (nunca 500)',
    !$ruins && $r->status === 400 && $r2->status === 400, implode('; ', $ruins));
checar('2.000 caracteres cabem', $anon->pedir('POST', '/api/suporte.php', ['tipo' => 'outro', 'mensagem' => str_repeat('b', 2000), 'email' => 'c@exemplo.com'])->status === 201);
resetarLimitesCurtos();
$n0 = (int) v('SELECT COUNT(*) FROM mensagens_suporte');
$r = $anon->pedir('POST', '/api/suporte.php', ['tipo' => 'outro', 'mensagem' => 'Compre seguidores baratos agora mesmo', 'email' => 'robo@exemplo.com', 'site' => 'http://spam.example']);
checar('isca (campo "site" preenchido) → 201 com cara de certo, nada gravado', $r->status === 201 && preg_match('/^[A-Z2-9]{8}$/', (string) ($r->json['protocolo'] ?? '')) === 1
    && (int) v('SELECT COUNT(*) FROM mensagens_suporte') === $n0, $r->resumo());
resetarLimitesCurtos();
$st = [];
for ($i = 0; $i < 6; $i++) {
    $st[] = $anon->pedir('POST', '/api/suporte.php', ['tipo' => 'outro', 'mensagem' => "Mensagem número $i do mesmo IP", 'email' => 'ip@exemplo.com'])->status;
}
checar('5 a cada 10 min por IP; a 6ª → 429', $st === [201, 201, 201, 201, 201, 429], json_encode($st));
checar('o limite usa o HMAC diário do IP (nunca o IP)', (int) v("SELECT COUNT(*) FROM tentativas WHERE chave LIKE 'suporte-ip:%' AND chave LIKE ?", ['%' . quemIpTeste('127.0.0.1')]) === 1
    && (int) v("SELECT COUNT(*) FROM tentativas WHERE chave LIKE '%127.0.0.1%'") === 0);
resetarLimitesCurtos();
encherLimite('dia-suporte-u:u' . $uidM, 20, true);
$r = $navM->pedir('POST', '/api/suporte.php', ['tipo' => 'outro', 'mensagem' => 'Mais uma mensagem da mesma conta']);
checar('20 por dia por conta → 429', $r->status === 429, $r->resumo());
q("DELETE FROM tentativas WHERE chave LIKE 'dia-suporte-u:%'");
resetarLimitesCurtos();
encherLimite('suporte-todos:todos', 300);
$r = $anon->pedir('POST', '/api/suporte.php', ['tipo' => 'outro', 'mensagem' => 'Quando o site inteiro já mandou muitas', 'email' => 'site@exemplo.com']);
checar('300 a cada 10 min no site → 429', $r->status === 429, $r->resumo());
resetarLimitesCurtos();
// admin
$r = $anon->pedir('GET', '/api/admin.php?r=suporte');
$r2 = $navM->pedir('GET', '/api/admin.php?r=suporte');
checar('?r=suporte sem admin → 401 (anônimo e jogador)', $r->status === 401 && $r2->status === 401, $r->resumo());
$r = $navLeitor->pedir('GET', '/api/admin.php?r=suporte');
$it = array_column($r->json['itens'] ?? [], null, 'protocolo');
checar('?r=suporte (papel leitor vê): paginado, mais novas primeiro, contagens por status, o e-mail para responder (o da conta ou o deixado)',
    $r->status === 200 && ($r->json['porPagina'] ?? 0) === 50 && ($r->json['contagens']['nova'] ?? 0) >= 7
    && ($it[$protA]['email'] ?? '') === $emailAnon && nulo($it[$protA] ?? null, 'usuario') && ($it[$protA]['tipo'] ?? '') === 'duvida'
    && ($it[$mM['protocolo']]['email'] ?? '') === $emailM && ($it[$mM['protocolo']]['usuario']['id'] ?? 0) === $uidM
    && preg_match($RE_ISO, (string) ($it[$protA]['criadoEm'] ?? '')) === 1, $r->resumo());
$r = v33Get('r=suporte&tipo=ideia');
$r2 = v33Get('r=suporte&q=' . $protA);
$r3 = v33Get('r=suporte&q=' . urlencode($emailAnon));
$r4 = v33Get('r=suporte&q=' . urlencode('Série B'));
checar('filtros: tipo, protocolo, e-mail e texto', ($r->json['total'] ?? 0) === 1 && ($r2->json['total'] ?? 0) === 1 && ($r3->json['total'] ?? 0) === 1
    && ($r4->json['itens'][0]['protocolo'] ?? '') === $mM['protocolo'], $r->resumo());
$r = v33Get('r=suporte&status=perdida');
$r2 = v33Get('r=suporte&tipo=xx');
checar('status ou tipo desconhecido → 400', $r->status === 400 && $r2->status === 400, $r->resumo());
$idA = (int) $mA['id'];
$r = $navLeitor->pedir('POST', '/api/admin.php', ['acao' => 'suporte_status', 'id' => $idA, 'status' => 'lida']);
checar('suporte_status: papel leitor → 403', $r->status === 403, $r->resumo());
$r = $navSup->pedir('POST', '/api/admin.php', ['acao' => 'suporte_status', 'id' => $idA, 'status' => 'lida']);
checar('suporte_status (papel suporte) → 200 lida, quem e quando; registrado (sem o texto)', $r->status === 200 && v('SELECT status FROM mensagens_suporte WHERE id = ?', [$idA]) === 'lida'
    && v('SELECT quem FROM mensagens_suporte WHERE id = ?', [$idA]) !== null && !str_contains((string) (acUltimoLog('suporte_status')['detalhes'] ?? ''), 'amigo'), $r->resumo());
$r = v33Adm(['acao' => 'suporte_status', 'id' => $idA, 'status' => 'sumida']);
$r2 = v33Adm(['acao' => 'suporte_status', 'id' => 999999, 'status' => 'lida']);
$r3 = v33Adm(['acao' => 'suporte_status', 'id' => 'x', 'status' => 'lida']);
checar('status desconhecido → 400; mensagem que não existe → 404; id ruim → 400', $r->status === 400 && $r2->status === 404 && $r3->status === 400, $r->resumo());
$antes = emailsPara($emailAnon);
$r = v33Adm(['acao' => 'suporte_responder', 'id' => $idA, 'resposta' => "Oi! Dá sim: crie uma conta para cada um.\nAbraços"]);
$mail = esperarEmailNovo($emailAnon, $antes);
checar('suporte_responder (sem conta) → 200 enviado; o e-mail vai para o endereço deixado, com a resposta e a mensagem original; respondida', $r->status === 200
    && ($r->json['enviado'] ?? null) === true && ($r->json['status'] ?? '') === 'respondida' && str_contains((string) $mail, 'crie uma conta para cada um')
    && str_contains((string) $mail, '> ' . $msgOk) && str_contains((string) $mail, $protA)
    && v('SELECT status FROM mensagens_suporte WHERE id = ?', [$idA]) === 'respondida' && v('SELECT respondida_em FROM mensagens_suporte WHERE id = ?', [$idA]) !== null
    && v("SELECT tipo FROM email_log ORDER BY id DESC LIMIT 1") === 'suporte', $r->resumo());
$antes = emailsPara($emailM);
$r = v33Adm(['acao' => 'suporte_responder', 'id' => (int) $mM['id'], 'resposta' => 'Ótima ideia, anotamos!']);
checar('…com conta: vai para o e-mail da conta', $r->status === 200 && esperarEmailNovo($emailM, $antes) !== null, $r->resumo());
$r = v33Adm(['acao' => 'suporte_responder', 'id' => $idA, 'resposta' => '']);
$r2 = v33Adm(['acao' => 'suporte_responder', 'id' => $idA, 'resposta' => str_repeat('r', 4001)]);
$r3 = v33Adm(['acao' => 'suporte_responder', 'id' => $idA, 'resposta' => ['x']]);
checar('resposta vazia, longa demais ou que não é texto → 400', $r->status === 400 && $r2->status === 400 && $r3->status === 400, $r->resumo());
$idsLote = array_map('intval', array_column(q("SELECT id FROM mensagens_suporte WHERE status = 'nova' ORDER BY id LIMIT 3"), 'id'));
$r = v33Adm(['acao' => 'suporte_lote', 'ids' => array_merge($idsLote, [999999]), 'status' => 'arquivada']);
checar('suporte_lote → feitos e pulados (a que não existe)', $r->status === 200 && ($r->json['feitos'] ?? null) === $idsLote
    && array_column($r->json['pulados'] ?? [], 'motivo') === ['nao_encontrada'], $r->resumo());
$r = v33Adm(['acao' => 'suporte_lote', 'ids' => [], 'status' => 'lida']);
checar('suporte_lote sem ids → 400', $r->status === 400, $r->resumo());
q("UPDATE mensagens_suporte SET criado_em = UTC_TIMESTAMP() - INTERVAL 25 HOUR WHERE status = 'nova' ORDER BY id LIMIT 1");
q("DELETE FROM site_config WHERE chave = '_atencao'");
$at = v33Get('r=atencao&atualizar=1')->json['alertas'] ?? [];
$al = array_values(array_filter($at, static fn(array $a): bool => ($a['chave'] ?? '') === 'suporte_parado'));
$pulso = integAdm('GET', '/api/painel.php?so=agora')->json['agora'] ?? [];
checar('"Precisa de atenção": mensagem nova há mais de 24 h (suporte_parado, aba mensagens); pulso: acao.mensagensNovas e filas.mensagens',
    count($al) === 1 && ($al[0]['link']['aba'] ?? '') === 'mensagens' && ($pulso['acao']['mensagensNovas'] ?? -1) === (int) v("SELECT COUNT(*) FROM mensagens_suporte WHERE status = 'nova'")
    && preg_match($RE_MD5, (string) ($pulso['filas']['mensagens'] ?? '')) === 1, json_encode($al) . ' ' . json_encode($pulso['acao'] ?? null));

// ══ 4. limite de partidas por dia ═══════════════════════════════════════════════════════════════

secao('v3.3 · limite de partidas por dia (partidas_dia_max, fuso de Brasília)');
$r = v33Get('r=config');
checar('config partidas_dia_max: padrão 100', ($r->json['valores']['partidas_dia_max'] ?? null) === 100 && ($r->json['padroes']['partidas_dia_max'] ?? null) === 100, $r->resumo());
$ruins = [];
foreach ([9, 10001, 'x', null, 50.5, [], true] as $x) {
    $r = v33Adm(['acao' => 'config', 'valores' => ['partidas_dia_max' => $x]]);
    if ($r->status !== 400 || $r->erro() !== 'config_invalida') {
        $ruins[] = json_encode($x) . " → $r->status";
    }
}
checar('partidas_dia_max fora de 10 a 10.000 ou de outro tipo → 400 config_invalida', !$ruins, implode('; ', $ruins));
[$navP, $uidP] = novaConta('Joga Demais');
$vidP = uuid4();
q('INSERT INTO partidas_dia (usuario_id, dia, n) VALUES (?, ?, 100)', [$uidP, v33Hoje()]);
q('UPDATE usuarios SET partidas_conta = 100 WHERE id = ?', [$uidP]);
partidaReal($navP, $vidP);
checar('com 100 partidas hoje (o padrão), a 101ª não soma na conta; partidas_dia conta todas', (int) v('SELECT partidas_conta FROM usuarios WHERE id = ?', [$uidP]) === 100
    && (int) v('SELECT n FROM partidas_dia WHERE usuario_id = ? AND dia = ?', [$uidP, v33Hoje()]) === 101);
$r = v33Adm(['acao' => 'config', 'valores' => ['partidas_dia_max' => 10]]);
checar('admin muda para 10 → 200', $r->status === 200 && ($r->json['valores']['partidas_dia_max'] ?? 0) === 10, $r->resumo());
[$navQ, $uidQ] = novaConta('Joga Dez');
$vidQ = uuid4();
q('INSERT INTO partidas_dia (usuario_id, dia, n) VALUES (?, ?, 9)', [$uidQ, v33Hoje()]);
partidaReal($navQ, $vidQ);
$c1 = (int) v('SELECT partidas_conta FROM usuarios WHERE id = ?', [$uidQ]);
partidaReal($navQ, $vidQ);
$c2 = (int) v('SELECT partidas_conta FROM usuarios WHERE id = ?', [$uidQ]);
checar('com o limite em 10: a 10ª do dia soma, a 11ª não', $c1 === 1 && $c2 === 1 && (int) v('SELECT n FROM partidas_dia WHERE usuario_id = ? AND dia = ?', [$uidQ, v33Hoje()]) === 11,
    "$c1 / $c2");
$r = salvarC($navQ, v33Hall('v33-limite', 3, 2));
checar('carreira salva no dia em que a conta passou do limite: salva (200), mas marcada fora_desafio = limite_diario', $r->status === 200
    && v('SELECT fora_desafio FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uidQ, 'v33-limite']) === 'limite_diario', $r->resumo());
q('UPDATE partidas_dia SET dia = ? WHERE usuario_id = ?', [gmdate('Y-m-d', time() - 10800 - 3 * 86400), $uidQ]);
salvarC($navQ, v33Hall('v33-limite', 3, 2, true, ['headline' => 'Salva de novo outro dia']));
salvarC($navQ, v33Hall('v33-limite-2', 3, 2));
checar('a marca fica (salvar de novo outro dia não tira); carreira nova num dia normal: sem marca', v('SELECT fora_desafio FROM carreiras WHERE carreira_id = ?', ['v33-limite']) === 'limite_diario'
    && v('SELECT fora_desafio FROM carreiras WHERE carreira_id = ?', ['v33-limite-2']) === null);
$hf = v33Hall('v33-limite-3', 3, 2);
$hf->finishedAt = gmdate('Y-m-d\TH:i:s\Z', time() - 3 * 86400);
salvarC($navQ, $hf);
checar('…e a terminada num dia em que a conta passou do limite (finishedAt) também fica marcada', v('SELECT fora_desafio FROM carreiras WHERE carreira_id = ?', ['v33-limite-3']) === 'limite_diario');
v33Adm(['acao' => 'config', 'valores' => ['partidas_dia_max' => 100]]);

// ══ 5. replay na HallEntry ══════════════════════════════════════════════════════════════════════

secao('v3.3 · replay na HallEntry: guardado, conferido (tamanho e formato) e C.temReplay');
[$navX, $uidX] = novaConta('Grava Replay');
$r = salvarC($navX, v33Hall('v33-rp-ok', 1, 0));
$g = $navX->pedir('GET', '/api/carreiras.php?id=v33-rp-ok');
checar('carreira do Clássico com o replay real → C.temReplay true; o HallEntry guardado leva o replay inteiro', $r->status === 200
    && ($r->json['carreira']['temReplay'] ?? null) === true && ($g->json['carreira']['replay']['seed'] ?? null) === v33Replay()['seed']
    && count($g->json['carreira']['replay']['picks'] ?? []) === count(v33Replay()['picks']) && (int) v('SELECT tem_replay FROM carreiras WHERE carreira_id = ?', ['v33-rp-ok']) === 1,
    $r->resumo());
$r = salvarC($navX, v33Hall('v33-rp-sem', 1, 0, false));
checar('sem replay (carreira antiga) → temReplay false', $r->status === 200 && ($r->json['carreira']['temReplay'] ?? null) === false, $r->resumo());
$picks = v33Replay()['picks'];
$ruins = [];
foreach ([
    'v:2' => v33Replay(0, ['v' => 2]), 'seed 1 número' => v33Replay(0, ['seed' => [1]]), 'seed negativa' => v33Replay(0, ['seed' => [-1, 2]]),
    'seed texto' => v33Replay(0, ['seed' => ['1', '2']]), 'seed 2^32' => v33Replay(0, ['seed' => [4294967296, 1]]), 'sem identity' => v33Replay(0, ['identity' => 'x']),
    'pace ruim' => v33Replay(0, ['pace' => 'MUITO RÁPIDO']), 'bonus 99' => v33Replay(0, ['bonusOvr' => 99]), 'sem dados' => v33Replay(0, ['dados' => '']),
    'dados com controle' => v33Replay(0, ['dados' => "a\nb"]), 'picks objeto' => v33Replay(0, ['picks' => ['a' => 1]]),
    'pick sem id' => v33Replay(0, ['picks' => [['kind' => 'event', 'idx' => 0, 'pen' => null, 'n' => 2]]]),
    'pick idx -2' => v33Replay(0, ['picks' => [['id' => 'x', 'kind' => 'event', 'idx' => -2, 'pen' => null, 'n' => 2]]]),
    'pick kind maiúsculo' => v33Replay(0, ['picks' => [['id' => 'x', 'kind' => 'EVENTO', 'idx' => 0, 'pen' => null, 'n' => 2]]]),
    'pick pen objeto' => v33Replay(0, ['picks' => [['id' => 'x', 'kind' => 'event', 'idx' => 0, 'pen' => ['l' => 1], 'n' => 2]]]),
    '601 picks' => v33Replay(0, ['picks' => array_fill(0, 601, $picks[0])]),
    'grande demais' => v33Replay(0, ['extra' => str_repeat('x', 70 * 1024)]),
    'não é objeto' => [1, 2, 3],
] as $nome => $rp) {
    $id = 'v33-rp-' . substr(md5($nome), 0, 8);
    $r = salvarC($navX, v33Hall($id, 1, 0, $rp));
    $g = $navX->pedir('GET', '/api/carreiras.php?id=' . $id);
    if ($r->status !== 200 || ($r->json['carreira']['temReplay'] ?? null) !== false || array_key_exists('replay', (array) ($g->json['carreira'] ?? []))) {
        $ruins[] = "$nome → $r->status " . json_encode($r->json['carreira']['temReplay'] ?? null);
    }
}
checar('replay fora do formato ou grande demais (v, seed, identity, pace, bônus, dados, picks, 601 decisões, > 64 KB): a carreira entra (200) SEM ele e com temReplay false',
    !$ruins, implode('; ', $ruins));
$r = salvarC($navX, v33Hall('v33-rp-pen', 1, 0, v33Replay(0, ['picks' => array_merge($picks, [['id' => 'pen-1', 'kind' => 'event', 'idx' => 1, 'pen' => 'left', 'n' => 3]]),
    'chaveNova' => 'aceita'])));
checar('pênalti ("left") e chave a mais no replay: aceitos', ($r->json['carreira']['temReplay'] ?? null) === true, $r->resumo());
$r = salvarC($navX, v33Hall('v33-rp-imersivo', 1, 0, true, ['modo' => 'immersive']));
$g = $navX->pedir('GET', '/api/carreiras.php?id=v33-rp-imersivo');
checar('carreira do Imersivo com replay: entra sem ele (temReplay false)', $r->status === 200 && ($r->json['carreira']['temReplay'] ?? null) === false
    && !array_key_exists('replay', (array) ($g->json['carreira'] ?? [])), $r->resumo());
$l = q('SELECT libertadores, copas, primeira_em FROM carreiras WHERE carreira_id = ?', ['v33-rp-ok'])[0] ?? [];
$hReal = v33Hall('v33-rp-real', 1, 0, true, ['nota' => 75], 'v33/v-intenso-03');
$hReal->summary->trophies = json_decode(canon(amostra('v33/v-intenso-03')), false)->summary->trophies;
salvarC($navX, $hReal);
$res = phpComLib('require ' . var_export(dirname(__DIR__) . '/api/_carreiras.php', true) . '; $out = [];'
    . ' foreach (glob(' . var_export("$AMOSTRAS/v33/*.json", true) . ') as $f) { $h = json_decode(file_get_contents($f), false); $x = extrairCampos($h);'
    . ' $out[basename($f)] = [count(array_filter($x["textos"], fn($t) => textoProibido($t, false) !== null)), $x["dados_ok"], $x["libertadores"], $x["copas"]]; }'
    . ' echo json_encode($out);');
checar('as amostras reais da v3.3 (amostras/v33) passam no filtro e o identity bate; Libertadores e Copas lidas delas',
    ($res['v-intenso-03.json'] ?? null) === [0, true, 8, 1] && ($res['v-otima-02.json'] ?? null) === [0, true, 0, 2], json_encode($res));
checar('libertadores e copas tiradas da HallEntry real (v-intenso-03: 8 Libertadores e 1 Copa)', (int) v('SELECT libertadores FROM carreiras WHERE carreira_id = ?', ['v33-rp-real']) === 8
    && (int) v('SELECT copas FROM carreiras WHERE carreira_id = ?', ['v33-rp-real']) === 1);
q("UPDATE carreiras SET primeira_em = '2026-01-01 00:00:00' WHERE carreira_id = 'v33-rp-ok'");
salvarC($navX, v33Hall('v33-rp-ok', 1, 0, true, ['headline' => 'Mudou a manchete']));
checar('primeira_em fica a da primeira vez (salvar de novo não muda)', v('SELECT primeira_em FROM carreiras WHERE carreira_id = ?', ['v33-rp-ok']) === '2026-01-01 00:00:00'
    && $l['primeira_em'] !== null);
$r = $navX->pedir('GET', '/api/carreiras.php');
checar('a lista da conta: temReplay em cada C', $r->status === 200 && count(array_filter($r->json['carreiras'] ?? [], static fn(array $c): bool => ($c['temReplay'] ?? null) === true)) === 3,
    $r->resumo());

// ══ 6. desafios: admin ══════════════════════════════════════════════════════════════════════════

secao('v3.3 · desafios: rotas do admin (401/403, criar, editar, validação)');
$rotas = ['desafios', 'desafio&id=' . v33IdDesafio('tacas-do-rei'), 'suporte'];
$acoes = ['desafio_salvar', 'desafio_ativar', 'candidato_verificar', 'candidato_recusar', 'desafio_declarar_vencedor', 'desafio_reabrir', 'suporte_status',
    'suporte_responder', 'suporte_lote', 'reenviar_verificacao'];
$fora = [];
foreach ([$anon, $navX] as $nv) {
    foreach ($rotas as $rt) {
        if (($s = $nv->pedir('GET', '/api/admin.php?r=' . $rt)->status) !== 401) {
            $fora[] = "GET $rt → $s";
        }
    }
    foreach ($acoes as $ac) {
        if (($s = $nv->pedir('POST', '/api/admin.php', ['acao' => $ac, 'id' => 1])->status) !== 401) {
            $fora[] = "POST $ac → $s";
        }
    }
}
checar('sem admin (anônimo e jogador) → 401 em todas as rotas e ações novas', !$fora, implode('; ', $fora));
$neg = [];
foreach (['desafio_salvar', 'desafio_ativar', 'desafio_declarar_vencedor', 'desafio_reabrir', 'candidato_verificar', 'candidato_recusar', 'suporte_responder'] as $ac) {
    $r = $navLeitor->pedir('POST', '/api/admin.php', ['acao' => $ac, 'id' => 1]);
    if ($r->status !== 403 || $r->erro() !== 'sem_poder') {
        $neg[] = "$ac → $r->status";
    }
}
[$navMod] = navEquipe('moderador');
foreach (['desafio_salvar', 'desafio_ativar', 'desafio_declarar_vencedor', 'desafio_reabrir'] as $ac) {
    $r = $navMod->pedir('POST', '/api/admin.php', ['acao' => $ac, 'id' => 1]);
    if ($r->status !== 403) {
        $neg[] = "moderador $ac → $r->status";
    }
}
$r = $navLeitor->pedir('GET', '/api/admin.php?r=desafios');
checar('papel leitor: vê (GET), não muda nada (403 sem_poder); moderador não cria, ativa nem declara vencedor', !$neg && $r->status === 200
    && count($r->json['itens'] ?? []) === 3, implode('; ', $neg) . ' ' . $r->resumo());
$D = $r->json['itens'][0] ?? [];
checar('?r=desafios: D com criterio, requisitos, ativo, inicio, vencedor, candidatos por estado', ($D['slug'] ?? '') === 'tacas-do-rei' && ($D['criterio'] ?? null) === ['copas' => 3, 'libertadores' => 2]
    && ($D['ativo'] ?? null) === false && nulo($D, 'inicio') && nulo($D, 'vencedor')
    && ($D['candidatos'] ?? null) === ['pendente' => 0, 'verificada' => 0, 'recusada' => 0, 'vencedora' => 0, 'total' => 0], json_encode($D));
$ruins = [];
foreach ([
    [['slug' => 'X', 'titulo' => 'Novo', 'criterio' => ['copas' => 1]], 'slug'], [['slug' => 'ab--cd', 'titulo' => 'Novo', 'criterio' => ['copas' => 1]], 'slug'],
    [['slug' => 'novo-desafio', 'criterio' => ['copas' => 1]], 'titulo'], [['slug' => 'novo-desafio', 'titulo' => 'No', 'criterio' => ['copas' => 1]], 'titulo'],
    [['slug' => 'novo-desafio', 'titulo' => 'Novo'], 'criterio'], [['slug' => 'novo-desafio', 'titulo' => 'Novo', 'criterio' => []], 'criterio'],
    [['slug' => 'novo-desafio', 'titulo' => 'Novo', 'criterio' => ['copas' => 0]], 'criterio'], [['slug' => 'novo-desafio', 'titulo' => 'Novo', 'criterio' => ['copas' => 'x']], 'criterio'],
    [['slug' => 'novo-desafio', 'titulo' => 'Novo', 'criterio' => ['copas' => 31]], 'criterio'], [['slug' => 'novo-desafio', 'titulo' => 'Novo', 'criterio' => ['assistencias' => 3]], 'criterio'], // v3.4: gols virou critério; chave desconhecida
    [['slug' => 'novo-desafio', 'titulo' => 'Novo', 'criterio' => ['copas' => 1, 'todasConquistas' => true]], 'criterio'],
    [['slug' => 'novo-desafio', 'titulo' => 'Novo', 'criterio' => [1, 2]], 'criterio'],
    [['slug' => 'novo-desafio', 'titulo' => 'Novo', 'criterio' => ['copas' => 1], 'requisitos' => ['partidasMin' => -1]], 'requisitos'],
    [['slug' => 'novo-desafio', 'titulo' => 'Novo', 'criterio' => ['copas' => 1], 'requisitos' => ['emailVerificado' => 'sim']], 'requisitos'],
    [['slug' => 'novo-desafio', 'titulo' => 'Novo', 'criterio' => ['copas' => 1], 'requisitos' => ['outro' => true]], 'requisitos'],
    [['slug' => 'novo-desafio', 'titulo' => 'Novo', 'criterio' => ['copas' => 1], 'inicio' => '2026-13-01'], 'datas'],
    [['slug' => 'novo-desafio', 'titulo' => 'Novo', 'criterio' => ['copas' => 1], 'inicio' => '2026-11-10', 'fim' => '2026-11-01'], 'datas'],
    [['slug' => 'novo-desafio', 'titulo' => 'Novo', 'criterio' => ['copas' => 1], 'premio' => ['x']], 'premio'],
    [['slug' => 'novo-desafio', 'titulo' => 'Novo', 'criterio' => ['copas' => 1], 'premio' => str_repeat('p', 2001)], 'premio'],
    [['slug' => 'novo-desafio', 'titulo' => 'Novo', 'criterio' => ['copas' => 1], 'ordem' => 1000], 'ordem'],
    [['slug' => 'tacas-do-rei', 'titulo' => 'Repetido', 'criterio' => ['copas' => 1]], 'slug_em_uso'],
] as $i => [$corpo, $erroEsperado]) {
    $r = v33Adm(['acao' => 'desafio_salvar'] + $corpo);
    if (!in_array($r->status, [400, 409], true) || $r->erro() !== $erroEsperado) {
        $ruins[] = "#$i → $r->status " . $r->erro();
    }
}
checar('desafio_salvar: slug, título, critério, requisitos, datas, prêmio e ordem errados → 400 com o código; slug repetido → 409 slug_em_uso', !$ruins, implode('; ', $ruins));
$r = v33Adm(['acao' => 'desafio_salvar', 'slug' => 'artilheiro-teste', 'titulo' => 'Desafio de teste', 'descricao' => 'Só para o teste.',
    'criterio' => ['libertadores' => 4], 'requisitos' => ['partidasMin' => 5, 'top3Perfil' => false], 'premio' => "Linha 1\nLinha 2", 'inicio' => '2026-10-01',
    'fim' => '2027-01-31', 'ordem' => 9]);
$Dn = $r->json['desafio'] ?? [];
checar('desafio_salvar novo → 201 D: desativado, o regulamento de partida gerado, datas em Brasília (início 00:00, fim 23:59:59), prêmio com as quebras de linha',
    $r->status === 201 && ($Dn['ativo'] ?? null) === false && ($Dn['criterio'] ?? null) === ['libertadores' => 4]
    && ($Dn['requisitos'] ?? null) === ['partidasMin' => 5, 'emailVerificado' => true, 'publicadoNoHall' => true, 'top3Perfil' => false]
    && ($Dn['inicio'] ?? '') === '2026-10-01T03:00:00Z' && ($Dn['fim'] ?? '') === '2027-02-01T02:59:59Z' && ($Dn['premio'] ?? '') === "Linha 1\nLinha 2"
    && str_contains((string) ($Dn['regulamento'] ?? ''), '4 Libertadores') && acUltimoLog('desafio_salvar') !== null, $r->resumo());
$idN = (int) ($Dn['id'] ?? 0);
$r = v33Adm(['acao' => 'desafio_salvar', 'id' => $idN, 'regulamento' => "1. Regra um.\n2. Regra dois.", 'fim' => null]);
$r2 = v33Adm(['acao' => 'desafio_salvar', 'id' => $idN, 'slug' => 'outro-slug']);
$r3 = v33Adm(['acao' => 'desafio_salvar', 'id' => 999999, 'titulo' => 'Não existe']);
checar('editar: só os campos mandados mudam; o slug não muda (400); desafio que não existe → 404', $r->status === 200
    && ($r->json['desafio']['regulamento'] ?? '') === "1. Regra um.\n2. Regra dois." && nulo($r->json['desafio'] ?? null, 'fim')
    && ($r->json['desafio']['premio'] ?? '') === "Linha 1\nLinha 2" && $r2->status === 400 && $r3->status === 404, $r->resumo());
$r = v33Get('r=desafio&id=' . $idN);
checar('?r=desafio&id= → {desafio, candidatos paginado}; id ruim → 400; que não existe → 404', $r->status === 200 && ($r->json['desafio']['slug'] ?? '') === 'artilheiro-teste'
    && ($r->json['candidatos']['total'] ?? -1) === 0 && v33Get('r=desafio&id=x')->status === 400 && v33Get('r=desafio&id=999999')->status === 404
    && v33Get('r=desafio&id=' . $idN . '&estado=sumido')->status === 400, $r->resumo());
$r = v33Adm(['acao' => 'desafio_ativar', 'id' => $idN, 'ativo' => 'sim']);
checar('desafio_ativar com ativo que não é sim/não → 400', $r->status === 400, $r->resumo());
q('DELETE FROM desafios WHERE id = ?', [$idN]);
checar('o desafio salvo/ativado nunca é público enquanto desativado', ($anon->pedir('GET', '/api/desafios.php')->json['desafios'] ?? null) === []);

// ══ 7. desafios: quem vira candidato ════════════════════════════════════════════════════════════

secao('v3.3 · desafios: quem cumpre tudo vira candidato pendente (e quem não cumpre, não)');
v33ZerarDesafios();
q("UPDATE desafios SET premio = 'O prêmio que o admin escrever' WHERE slug = 'tacas-do-rei'");
// antes de ativar: nada vira candidato
[$navA0, $uidA0] = v33Conta('Antes Ativar');
v33Salvar($navA0, v33Hall('v33-antes-ativar', 3, 2));
checar('desafio desativado: a carreira que cumpre tudo não vira candidata', count(v33Cands('tacas-do-rei')) === 0);
q("UPDATE carreiras SET primeira_em = primeira_em - INTERVAL 1 HOUR WHERE carreira_id = 'v33-antes-ativar'");
$r = v33Ativar('tacas-do-rei');
$Dat = $r->json['desafio'] ?? [];
checar('desafio_ativar → 200: começa agora (inicio = hora da ativação), valendo; a carreira salva antes do início não conta (0 candidatos novos)',
    $r->status === 200 && ($Dat['ativo'] ?? null) === true && ($Dat['valendo'] ?? null) === true && preg_match($RE_ISO, (string) ($Dat['inicio'] ?? '')) === 1
    && abs((int) strtotime((string) $Dat['inicio']) - time()) <= 5 && ($r->json['candidatosNovos'] ?? -1) === 0 && acUltimoLog('desafio_ativar') !== null, $r->resumo());
$eu = v33Eu($navA0, 'tacas-do-rei');
checar('?eu=1: a carreira salva antes do início aparece com motivo antes_do_inicio', ($eu['carreirasQueCumprem'][0]['motivo'] ?? '') === 'antes_do_inicio'
    && ($eu['carreirasQueCumprem'][0]['vale'] ?? null) === false, json_encode($eu));
// A: cumpre tudo
[$navA, $uidA] = v33Conta('Craque Taças');
$r = v33Salvar($navA, v33Hall('v33-a', 3, 2));
$cA = v33Cands('tacas-do-rei');
checar('A: verificada, 30 partidas, carreira do Clássico com replay, 3 Copas e 2 Libertadores, no Hall e no top 3 → candidato pendente com em (milésimos)',
    $r->status === 200 && count($cA) === 1 && (int) $cA[0]['usuario_id'] === $uidA && $cA[0]['estado'] === 'pendente' && $cA[0]['chave'] === 'c' . pkCarreira('v33-a', $uidA)
    && preg_match('/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}$/', (string) $cA[0]['em']) === 1 && (int) $cA[0]['copas'] === 3 && (int) $cA[0]['libertadores'] === 2,
    json_encode($cA));
salvarC($navA, v33Hall('v33-a', 3, 2));
checar('salvar de novo a mesma carreira não cria outro candidato (um por carreira)', count(v33Cands('tacas-do-rei')) === 1);
$eu = v33Eu($navA, 'tacas-do-rei');
checar('?eu=1: partidas, partidasMin, emailVerificado, partidas de hoje e o limite, a carreira que cumpre (publicada, no top 3, com replay, vale) e o candidato',
    ($eu['partidas'] ?? 0) === 30 && ($eu['partidasMin'] ?? 0) === 30 && ($eu['emailVerificado'] ?? null) === true && ($eu['partidasDiaMax'] ?? 0) === 100
    && ($eu['carreirasQueCumprem'][0] ?? null) === ['carreiraId' => 'v33-a', 'jogador' => 'VAN RIJN', 'publicada' => true, 'noTop3' => true, 'temReplay' => true,
        'vale' => true, 'motivo' => null, 'motivoTexto' => null]
    && ($eu['candidato']['estado'] ?? '') === 'pendente' && preg_match($RE_ISO_MS, (string) ($eu['candidato']['em'] ?? '')) === 1, json_encode($eu));
$pub = v33Publico('tacas-do-rei');
checar('GET desafios.php (público): o ativo aparece com o prêmio do admin, critério, requisitos, regulamento, pendentes = 1, sem vencedor; o desativado não',
    $pub !== null && ($pub['premio'] ?? '') === 'O prêmio que o admin escrever' && ($pub['pendentes'] ?? 0) === 1 && nulo($pub, 'vencedor')
    && ($pub['ativo'] ?? null) === true && ($pub['encerrado'] ?? null) === false && v33Publico('tacas-do-rei-copas') === null && is_string($pub['regulamento'] ?? null)
    && !array_key_exists('eu', $pub), json_encode($pub));
$r = $anon->pedir('GET', '/api/desafios.php?eu=1');
checar('desafios.php?eu=1 sem sessão → 401; POST → 405', $r->status === 401 && $anon->pedir('POST', '/api/desafios.php', ['x' => 1])->status === 405, $r->resumo());
// B: forjada sem replay
[$navB, $uidB] = v33Conta('Forjador');
v33Salvar($navB, v33Hall('v33-b-forjada', 3, 2, false, ['nota' => 85]));
$eu = v33Eu($navB, 'tacas-do-rei');
checar('carreira forjada sem replay NÃO vira candidata (motivo sem_replay no ?eu=1)', count(array_filter(v33Cands('tacas-do-rei'), static fn($c) => (int) $c['usuario_id'] === $uidB)) === 0
    && ($eu['carreirasQueCumprem'][0]['motivo'] ?? '') === 'sem_replay', json_encode($eu));
// C: Imersivo
[$navC, $uidC] = v33Conta('Imersivo Taças');
v33Salvar($navC, v33Hall('v33-c-imersivo', 3, 2, true, ['modo' => 'immersive']));
q("UPDATE carreiras SET tem_replay = 1 WHERE carreira_id = 'v33-c-imersivo'"); // nem com o replay forçado no banco
salvarC($navC, v33Hall('v33-c-outra', 1, 0)); // salvar outra carreira avalia a conta de novo
$eu = v33Eu($navC, 'tacas-do-rei');
checar('carreira do Imersivo não vale (motivo imersivo), nem com tem_replay no banco', count(array_filter(v33Cands('tacas-do-rei'), static fn($c) => (int) $c['usuario_id'] === $uidC)) === 0
    && ($eu['carreirasQueCumprem'][0]['motivo'] ?? '') === 'imersivo', json_encode($eu));
// D: e-mail não verificado → verifica depois
[$navD, $uidD] = v33Conta('Sem Confirmar', false);
v33Salvar($navD, v33Hall('v33-d', 3, 2));
$semD = count(array_filter(v33Cands('tacas-do-rei'), static fn($c) => (int) $c['usuario_id'] === $uidD)) === 0;
$euD = v33Eu($navD, 'tacas-do-rei');
$emailD = (string) v('SELECT email FROM usuarios WHERE id = ?', [$uidD]);
$antes = emailsPara($emailD);
resetarLimitesCurtos();
conta($navD, ['acao' => 'reenviar_verificacao']);
$codD = codigoDe(esperarEmailNovo($emailD, $antes));
usleep(20_000);
$r = conta($navD, ['acao' => 'verificar_email', 'codigo' => $codD]);
$cD = array_values(array_filter(v33Cands('tacas-do-rei'), static fn($c) => (int) $c['usuario_id'] === $uidD));
checar('sem e-mail confirmado: não vira candidato (?eu=1 emailVerificado false); ao confirmar o e-mail, vira (o em é a hora da confirmação, depois do de A)',
    $semD && ($euD['emailVerificado'] ?? null) === false && $r->status === 200 && count($cD) === 1 && (string) $cD[0]['em'] > (string) $cA[0]['em'], json_encode($cD));
// E: fora do Hall ("nao") → muda para auto
[$navE2, $uidE2] = v33Conta('Fora do Hall');
conta($navE2, ['acao' => 'perfil', 'hallPublico' => 'nao']);
v33Salvar($navE2, v33Hall('v33-e', 3, 2));
$euE = v33Eu($navE2, 'tacas-do-rei');
$semE = count(array_filter(v33Cands('tacas-do-rei'), static fn($c) => (int) $c['usuario_id'] === $uidE2)) === 0;
conta($navE2, ['acao' => 'perfil', 'hallPublico' => 'auto']);
checar('conta que não aparece no Hall: não vira (nao_publicada); ao voltar para o Hall (perfil hallPublico), vira', $semE
    && ($euE['carreirasQueCumprem'][0]['motivo'] ?? '') === 'nao_publicada' && ($euE['carreirasQueCumprem'][0]['publicada'] ?? null) === false
    && count(array_filter(v33Cands('tacas-do-rei'), static fn($c) => (int) $c['usuario_id'] === $uidE2)) === 1, json_encode($euE));
// F: fora do top 3
[$navF, $uidF] = v33Conta('Top Tres');
foreach (['v33-f1', 'v33-f2', 'v33-f3'] as $i => $id) {
    salvarC($navF, v33Hall($id, 1, 0, true, ['nota' => 80 + $i]));
}
v33Salvar($navF, v33Hall('v33-f-taca', 3, 2, true, ['nota' => 60]));
$euF = v33Eu($navF, 'tacas-do-rei');
$semF = count(array_filter(v33Cands('tacas-do-rei'), static fn($c) => (int) $c['usuario_id'] === $uidF)) === 0;
$navF->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => 'v33-f1']);
checar('carreira publicável mas fora das 3 do perfil: não vira (fora_do_top3); apagada uma das 3, ela entra no top 3 e vira', $semF
    && ($euF['carreirasQueCumprem'][0]['motivo'] ?? '') === 'fora_do_top3' && ($euF['carreirasQueCumprem'][0]['publicada'] ?? null) === true
    && count(array_filter(v33Cands('tacas-do-rei'), static fn($c) => (int) $c['usuario_id'] === $uidF)) === 1, json_encode($euF));
// G: 29 partidas → a 30ª pelo e.php
[$navG, $uidG] = v33Conta('Quase Trinta', true, 29);
v33Salvar($navG, v33Hall('v33-g', 3, 2));
$semG = count(array_filter(v33Cands('tacas-do-rei'), static fn($c) => (int) $c['usuario_id'] === $uidG)) === 0;
$euG = v33Eu($navG, 'tacas-do-rei');
partidaReal($navG, uuid4());
checar('29 partidas: não vira (eu.partidas 29); a 30ª partida contada pelo e.php completa e vira candidato', $semG && ($euG['partidas'] ?? 0) === 29
    && (int) v('SELECT partidas_conta FROM usuarios WHERE id = ?', [$uidG]) === 30
    && count(array_filter(v33Cands('tacas-do-rei'), static fn($c) => (int) $c['usuario_id'] === $uidG)) === 1, json_encode($euG));
// H: limite diário
[$navH, $uidH] = v33Conta('Passou Limite');
q('INSERT INTO partidas_dia (usuario_id, dia, n) VALUES (?, ?, 101)', [$uidH, v33Hoje()]);
v33Salvar($navH, v33Hall('v33-h', 3, 2));
$euH = v33Eu($navH, 'tacas-do-rei');
checar('carreira salva num dia em que a conta passou de 100 partidas: não vale (limite_diario; ?eu=1 partidasHoje 101)', count(array_filter(v33Cands('tacas-do-rei'),
    static fn($c) => (int) $c['usuario_id'] === $uidH)) === 0 && ($euH['carreirasQueCumprem'][0]['motivo'] ?? '') === 'limite_diario' && ($euH['partidasHoje'] ?? 0) === 101,
    json_encode($euH));
// I: nota alta esperando a revisão do admin conta como publicada
[$navI, $uidI] = v33Conta('Nota Alta');
$r = v33Salvar($navI, v33Hall('v33-i', 3, 2, true, ['nota' => 93]));
checar('carreira de nota 93 (espera a revisão do Hall): conta como publicada e vira candidata', v('SELECT suspeita FROM carreiras WHERE carreira_id = ?', ['v33-i']) === 'revisao'
    && count(array_filter(v33Cands('tacas-do-rei'), static fn($c) => (int) $c['usuario_id'] === $uidI)) === 1, $r->resumo());
// J: suspeita de verdade (gols impossíveis) → liberada pelo admin
[$navJ, $uidJ] = v33Conta('Suspeito Taças');
v33Salvar($navJ, v33Hall('v33-j', 3, 2, true, ['gols' => 99999]));
$semJ = count(array_filter(v33Cands('tacas-do-rei'), static fn($c) => (int) $c['usuario_id'] === $uidJ)) === 0;
$r = v33Adm(['acao' => 'mostrar_carreira', 'id' => pkCarreira('v33-j', $uidJ), 'motivo' => 'Conferi os números']);
checar('carreira suspeita (fora do Hall) não vira; liberada pelo admin (mostrar_carreira), vira', $semJ && $r->status === 200
    && count(array_filter(v33Cands('tacas-do-rei'), static fn($c) => (int) $c['usuario_id'] === $uidJ)) === 1, $r->resumo());
// K: conta suspensa
[$navK, $uidK] = v33Conta('Suspensa Taças');
v33Adm(['acao' => 'suspender', 'id' => $uidK, 'motivo' => 'teste']);
checar('conta suspensa (sessões derrubadas) não salva nem vira candidata', in_array(salvarC($navK, v33Hall('v33-k', 3, 2))->status, [401, 403], true)
    && count(array_filter(v33Cands('tacas-do-rei'), static fn($c) => (int) $c['usuario_id'] === $uidK)) === 0);
// L: só 2 Libertadores e 2 Copas → não cumpre
[$navLc, $uidLc] = v33Conta('Duas Copas');
v33Salvar($navLc, v33Hall('v33-l', 2, 5));
checar('2 Copas (e 5 Libertadores) não cumprem 3 Copas + 2 Libertadores: ?eu=1 sem carreira que cumpre', count(array_filter(v33Cands('tacas-do-rei'),
    static fn($c) => (int) $c['usuario_id'] === $uidLc)) === 0 && (v33Eu($navLc, 'tacas-do-rei')['carreirasQueCumprem'] ?? null) === []);
// amostra real v-otima-02 (2 Copas reais) com mais 1 Copa e 2 Libertadores
[$navO, $uidO] = v33Conta('Amostra Real');
$hO = v33DaAmostra('v33/v-otima-02', 'v33-otima-02', 72);
foreach ($hO->summary->trophies as $t) {
    if ($t->trophyId === 'world-cup') {
        $t->count = 3;
    }
}
$hO->summary->trophies[] = (object) ['trophyId' => 'libertadores', 'count' => 2, 'seasons' => [2030, 2031]];
$hO->replay = json_decode(json_encode(v33Replay(1)), false);
v33Salvar($navO, $hO);
checar('HallEntry real (v-otima-02) com 3 Copas e 2 Libertadores e replay real → candidato', count(array_filter(v33Cands('tacas-do-rei'),
    static fn($c) => (int) $c['usuario_id'] === $uidO)) === 1);
// o desafio de 3 Copas, ativado depois com início no passado: as carreiras de agora entram na hora (lote)
$r = v33Adm(['acao' => 'desafio_salvar', 'id' => v33IdDesafio('tacas-do-rei-copas'), 'inicio' => gmdate('Y-m-d', time() - 10800 - 86400)]);
$r2 = v33Ativar('tacas-do-rei-copas');
$cCopas = v33Cands('tacas-do-rei-copas');
checar('desafio_ativar de um desafio com início no passado: avalia todas as contas na hora (as que cumprem viram candidatas; o início marcado fica)',
    $r->status === 200 && $r2->status === 200 && ($r2->json['candidatosNovos'] ?? 0) === count($cCopas) && count($cCopas) >= 7
    && str_starts_with((string) ($r2->json['desafio']['inicio'] ?? ''), gmdate('Y-m-d', time() - 86400 - 10800)), $r2->resumo());
v33Ativar('tacas-do-rei-copas', false);
q("UPDATE desafios SET inicio = NULL WHERE slug = 'tacas-do-rei-copas'");
// prazo
q("UPDATE desafios SET fim = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE slug = 'tacas-do-rei'");
[$navFim, $uidFim] = v33Conta('Depois do Fim');
v33Salvar($navFim, v33Hall('v33-fim', 3, 2));
$pubFim = v33Publico('tacas-do-rei');
checar('depois do fim: ninguém mais vira candidato; o público mostra encerrado', count(array_filter(v33Cands('tacas-do-rei'), static fn($c) => (int) $c['usuario_id'] === $uidFim)) === 0
    && ($pubFim['encerrado'] ?? null) === true, json_encode($pubFim));
q("UPDATE desafios SET fim = NULL WHERE slug = 'tacas-do-rei'");
// todas as conquistas. v3.4 (CONTRATO-v34 §A): o §E da v3.3 (409 sem_prova ao ativar) foi trocado pela prova: o desafio
// ativa, e só contam as conquistas PROVADAS por carreiras (as do aparelho não fazem candidato). O caminho com prova está no
// teste-v34.php; aqui, que as do aparelho não bastam
$r = v33Ativar('todas-as-conquistas');
checar('v3.4: desafio_ativar do de todas as conquistas → 200 (antes, §E da v3.3: 409 sem_prova)', $r->status === 200
    && (int) v("SELECT ativo FROM desafios WHERE slug = 'todas-as-conquistas'") === 1, $r->resumo());
q("UPDATE desafios SET ativo = 1, inicio = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE slug = 'todas-as-conquistas'");
[$navT, $uidT] = v33Conta('Todas Conquistas');
$idsT = $idsPhp['ids'];
$r = $navT->pedir('POST', '/api/conquistas.php', ['acao' => 'sincronizar', 'conquistas' => array_map(static fn(string $id): array => ['id' => $id, 'em' => '2026-10-10T10:00:00Z'],
    array_slice($idsT, 0, 86))]);
$semT = count(v33Cands('todas-as-conquistas')) === 0;
$euT = v33Eu($navT, 'todas-as-conquistas');
[$navT2, $uidT2] = v33Conta('Conquista Falsa');
$navT2->pedir('POST', '/api/conquistas.php', ['acao' => 'sincronizar', 'conquistas' => array_merge(array_map(static fn(string $id): array => ['id' => $id],
    array_slice($idsT, 0, 86)), array_map(static fn(int $i): array => ['id' => "inventada_$i"], range(1, 50)))]);
$semT2 = count(v33Cands('todas-as-conquistas')) === 0;
$navT->pedir('POST', '/api/conquistas.php', ['acao' => 'sincronizar', 'conquistas' => [['id' => $idsT[86]]]]);
$cT = v33Cands('todas-as-conquistas');
checar('todas as conquistas (v3.4): as do aparelho não contam — 86, 86 + 50 inventadas e as 87 sincronizadas não fazem candidato (eu: conquistas provadas 0, conquistasTodas 86 de 87)',
    $r->status === 200 && $semT && $semT2 && ($euT['conquistas'] ?? -1) === 0 && ($euT['conquistasTodas'] ?? 0) === 86 && ($euT['conquistasTotal'] ?? 0) === 87
    && count($cT) === 0, json_encode($cT) . ' ' . json_encode($euT));
v33Ativar('todas-as-conquistas', false);
q("UPDATE desafios SET inicio = NULL WHERE slug = 'todas-as-conquistas'");
q("DELETE FROM desafio_candidatos WHERE desafio_id = ?", [v33IdDesafio('todas-as-conquistas')]);
$at = v33Get('r=atencao&atualizar=1')->json['alertas'] ?? [];
$pulso = integAdm('GET', '/api/painel.php?so=agora')->json['agora']['acao'] ?? [];
checar('"Precisa de atenção": candidatos esperando decisão (aba desafios); pulso: acao.candidatosPendentes', count(array_filter($at, static fn($a) => ($a['chave'] ?? '') === 'candidatos')) === 1
    && ($pulso['candidatosPendentes'] ?? -1) === (int) v("SELECT COUNT(*) FROM desafio_candidatos WHERE estado IN ('pendente', 'verificada')"), json_encode($pulso));

// ══ 8. verificação, vencedor e concorrência ═════════════════════════════════════════════════════

secao('v3.3 · desafios: verificação no jogo, recusa, vencedor (o primeiro em), concorrência e reabrir');
$did = v33IdDesafio('tacas-do-rei');
$r = v33Get('r=desafio&id=' . $did);
$K = $r->json['candidatos']['itens'] ?? [];
$k0 = $K[0] ?? [];
checar('?r=desafio: candidatos na ordem do em, com a conta, a carreira, os links do jogo (resumo e #/verificar) e o primeiro marcado', $r->status === 200
    && count($K) === count(v33Cands('tacas-do-rei')) && ($k0['usuario']['id'] ?? 0) === $uidA && ($k0['primeiro'] ?? null) === true
    && ($k0['carreira']['existe'] ?? null) === true && ($k0['carreira']['temReplay'] ?? null) === true
    && ($k0['links']['verificar'] ?? '') === '/lenda/#/verificar?id=' . pkCarreira('v33-a', $uidA) . '&candidato=' . $k0['id']
    && ($k0['links']['resumo'] ?? '') === '/lenda/#/resumo?id=' . pkCarreira('v33-a', $uidA) . '&de=admin' && preg_match($RE_ISO_MS, (string) ($k0['em'] ?? '')) === 1
    && ($K[1]['primeiro'] ?? null) === false, json_encode($k0));
$pkA = pkCarreira('v33-a', $uidA);
$r = v33Get('r=carreira&id=' . $pkA);
checar('?r=carreira (o que o #/verificar lê): meta.temReplay, o replay no HallEntry e os candidatos da carreira', $r->status === 200
    && ($r->json['meta']['temReplay'] ?? null) === true && ($r->json['carreira']['replay']['v'] ?? 0) === 1
    // §E: o candidato do desafio com início no passado nasce com a hora real (a entrada da carreira): ele pode vir antes
    && (array_column(array_map(static fn($k) => ['s' => $k['desafio']['slug'] ?? '', 'e' => $k['estado'] ?? ''], $r->json['candidatos'] ?? []), 'e', 's')['tacas-do-rei'] ?? '') === 'pendente',
    $r->resumo());
$kidA = (int) $k0['id'];
$r = v33Adm(['acao' => 'desafio_declarar_vencedor', 'candidatoId' => $kidA]);
checar('declarar vencedor um candidato pendente (não verificado) → 409 nao_verificada', $r->status === 409 && $r->erro() === 'nao_verificada', $r->resumo());
$ruins = [];
foreach ([['id' => $kidA], ['id' => $kidA, 'resultado' => true], ['id' => $kidA, 'resultado' => ['ok' => 'sim']], ['id' => $kidA, 'resultado' => ['ok' => true, 'detalhes' => 'x']],
    ['id' => $kidA, 'resultado' => ['ok' => true, 'detalhes' => ['x' => str_repeat('d', 9000)]]], ['id' => 'x', 'resultado' => ['ok' => true]],
    ['resultado' => ['ok' => true]], ['carreira' => 999999, 'resultado' => ['ok' => true]], ['id' => 999999, 'resultado' => ['ok' => true]]] as $i => $corpo) {
    $r = v33Adm(['acao' => 'candidato_verificar'] + $corpo);
    if (!in_array($r->status, [400, 404], true)) {
        $ruins[] = "#$i → $r->status";
    }
}
checar('candidato_verificar: resultado que falta/ruim, detalhes > 8 KB, id ruim, carreira sem candidato, candidato que não existe → 400/404', !$ruins, implode('; ', $ruins));
$r = $navMod->pedir('POST', '/api/admin.php', ['acao' => 'candidato_verificar', 'id' => $kidA, 'resultado' => ['ok' => true,
    'detalhes' => ['pico' => [97, 97], 'nota' => [70, 70], 'copas' => [3, 3], 'libertadores' => [2, 2], 'dados' => 'lenda-dados-teste-v33']]]);
$kA = q('SELECT * FROM desafio_candidatos WHERE id = ?', [$kidA])[0] ?? [];
checar('candidato_verificar ok (papel moderador) → verificada, com a verificação guardada (detalhes, quem, quando); registrado', $r->status === 200
    && ($kA['estado'] ?? '') === 'verificada' && (json_decode((string) ($kA['verificacao'] ?? ''), true)['detalhes']['copas'] ?? null) === [3, 3]
    && $kA['decidido_em'] !== null && $kA['quem'] !== null && acUltimoLog('candidato_verificar') !== null, $r->resumo());
$kidB = (int) ($K[1]['id'] ?? 0);
$r = v33Adm(['acao' => 'candidato_verificar', 'id' => $kidB, 'resultado' => ['ok' => false, 'detalhes' => ['motivo' => 'O pico deu 91, não 97.']]]);
checar('candidato_verificar não bateu → recusada com o motivo dos detalhes', $r->status === 200 && v('SELECT estado FROM desafio_candidatos WHERE id = ?', [$kidB]) === 'recusada'
    && v('SELECT motivo FROM desafio_candidatos WHERE id = ?', [$kidB]) === 'O pico deu 91, não 97.', $r->resumo());
$r = v33Adm(['acao' => 'candidato_verificar', 'carreira' => (int) $K[1]['carreira']['pk'], 'resultado' => ['ok' => true]]);
checar('…verificar de novo pela carreira ({carreira: pk}: todos os candidatos dela) → verificada (a recusa por engano se desfaz)', $r->status === 200
    && v('SELECT estado FROM desafio_candidatos WHERE id = ?', [$kidB]) === 'verificada'
    && in_array(['id' => $kidB, 'estado' => 'verificada'], array_map(static fn($k) => ['id' => $k['id'] ?? 0, 'estado' => $k['estado'] ?? ''], $r->json['candidatos'] ?? []), true)
    && count($r->json['candidatos'] ?? []) === (int) v("SELECT COUNT(*) FROM desafio_candidatos WHERE carreira_pk = ?", [(int) $K[1]['carreira']['pk']]), $r->resumo());
$r = v33Adm(['acao' => 'candidato_recusar', 'id' => $kidB]);
$r2 = v33Adm(['acao' => 'candidato_recusar', 'id' => $kidB, 'motivo' => 'A carreira não bateu no replay.']);
$uidK1 = (int) v('SELECT usuario_id FROM desafio_candidatos WHERE id = ?', [$kidB]);
$navK1 = [$uidD => $navD, $uidE2 => $navE2, $uidF => $navF, $uidG => $navG][$uidK1] ?? null;
$euK1 = $navK1 !== null ? v33Eu($navK1, 'tacas-do-rei') : null;
checar('candidato_recusar sem motivo → 400; com motivo → recusada; o jogador vê o estado e o motivo no ?eu=1', $r->status === 400 && $r2->status === 200
    && v('SELECT estado FROM desafio_candidatos WHERE id = ?', [$kidB]) === 'recusada' && acUltimoLog('candidato_recusar') !== null
    && ($euK1['candidato']['estado'] ?? '') === 'recusada' && ($euK1['candidato']['motivo'] ?? '') === 'A carreira não bateu no replay.', $r2->resumo() . ' ' . json_encode($euK1));
$r = v33Get('r=usuario&id=' . $uidA);
checar('ficha da conta (admin): as candidaturas dela aos desafios', ($r->json['usuario']['desafios'][0]['desafio']['slug'] ?? '') !== ''
    && in_array('tacas-do-rei', array_column(array_column($r->json['usuario']['desafios'] ?? [], 'desafio'), 'slug'), true), $r->resumo());
// dois candidatos ao mesmo tempo: só o primeiro em vence
v33ZerarDesafios();
v33Ativar('tacas-do-rei');
[$navP1, $uidP1] = v33Conta('Paralelo Um');
[$navP2, $uidP2] = v33Conta('Paralelo Dois');
v33Semente($uidP1, v33Replay()['seed']); // §E: o salvar em paralelo não passa pelo salvarC
v33Semente($uidP2, v33Replay()['seed']);
resetarLimitesCurtos();
$res = paralelo([
    ['POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => v33Hall('v33-par-1', 3, 2), 'como' => 'manual'], $navP1->jar, 'p1'],
    ['POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => v33Hall('v33-par-2', 3, 2), 'como' => 'manual'], $navP2->jar, 'p2'],
]);
$cP = v33Cands('tacas-do-rei');
checar('dois candidatos ao mesmo tempo (salvar em paralelo): os dois entram, cada um com o seu em', ($res['p1'][0] ?? 0) === 200 && ($res['p2'][0] ?? 0) === 200 && count($cP) === 2
    && $cP[0]['em'] !== null && $cP[1]['em'] !== null, json_encode(array_map(static fn($x) => $x[0], $res)));
$primeiro = (int) $cP[0]['id'];
$segundo = (int) $cP[1]['id'];
foreach ([$primeiro, $segundo] as $kid) {
    v33Adm(['acao' => 'candidato_verificar', 'id' => $kid, 'resultado' => ['ok' => true]]);
}
$r = v33Adm(['acao' => 'desafio_declarar_vencedor', 'candidatoId' => $segundo]);
checar('declarar o segundo (pelo em) com o primeiro ainda valendo → 409 ha_anterior (com o id do anterior)', $r->status === 409 && $r->erro() === 'ha_anterior'
    && ($r->json['anterior'] ?? 0) === $primeiro, $r->resumo());
$vencedorUid = (int) $cP[0]['usuario_id'];
$navVenc = $vencedorUid === $uidP1 ? $navP1 : $navP2;
[$navDono] = navEquipe('dono');
$ped = [];
for ($i = 0; $i < 4; $i++) {
    $ped[] = ['POST', '/api/admin.php', ['acao' => 'desafio_declarar_vencedor', 'candidatoId' => $i % 2 === 0 ? $primeiro : $segundo], $navDono->jar, "d$i"];
}
$res = paralelo($ped);
$st = array_map(static fn($x) => $x[0], $res);
sort($st);
$dV = q('SELECT * FROM desafios WHERE id = ?', [$did])[0] ?? [];
checar('quatro declarações ao mesmo tempo (duas do primeiro, duas do segundo): só uma passa (200), as outras 409; o vencedor é o primeiro em',
    $st === [200, 409, 409, 409] && (int) $dV['vencedor_candidato'] === $primeiro && (int) $dV['vencedor_usuario_id'] === $vencedorUid && $dV['vencido_em'] !== null
    && (int) v("SELECT COUNT(*) FROM desafio_candidatos WHERE desafio_id = ? AND estado = 'vencedora'", [$did]) === 1, json_encode($res));
$uV = q('SELECT aviso_conta, apelido, codigo_convite FROM usuarios WHERE id = ?', [$vencedorUid])[0] ?? [];
$pubV = v33Publico('tacas-do-rei');
checar('o vencedor ganha o aviso em Minha conta; o público mostra o vencedor (apelido, jogador, carreira, perfil, em, declaradoEm) e encerrado',
    str_contains((string) ($uV['aviso_conta'] ?? ''), 'Você venceu o desafio “As Taças do Rei”') && ($pubV['vencedor']['apelido'] ?? '') === $uV['apelido']
    && ($pubV['vencedor']['perfil'] ?? '') === $uV['codigo_convite'] && ($pubV['vencedor']['jogador'] ?? '') === 'VAN RIJN'
    && in_array($pubV['vencedor']['carreiraId'] ?? '', ['v33-par-1', 'v33-par-2'], true) && preg_match($RE_ISO_MS, (string) ($pubV['vencedor']['em'] ?? '')) === 1
    && ($pubV['encerrado'] ?? null) === true && ($pubV['pendentes'] ?? -1) === 1 && acUltimoLog('desafio_vencedor') !== null
    && ($navVenc->pedir('GET', '/api/conta.php')->json['usuario']['aviso']['texto'] ?? '') === $uV['aviso_conta'], json_encode($pubV));
// integração: o jogo mostra o recado do vencedor como vitória (não como "aviso da moderação"): U.aviso.tipo
checar('U.aviso do vencedor vem com tipo "desafio"', ($navVenc->pedir('GET', '/api/conta.php')->json['usuario']['aviso']['tipo'] ?? '') === 'desafio');
$r = v33Adm(['acao' => 'desafio_declarar_vencedor', 'candidatoId' => $segundo]);
$r2 = v33Adm(['acao' => 'candidato_recusar', 'id' => $primeiro, 'motivo' => 'teste']);
$r3 = v33Adm(['acao' => 'candidato_verificar', 'id' => $primeiro, 'resultado' => ['ok' => false]]);
checar('com vencedor: outra declaração → 409 ja_tem_vencedor; recusar ou reverificar a vencedora → 409 vencedora', $r->status === 409 && $r->erro() === 'ja_tem_vencedor'
    && $r2->status === 409 && $r2->erro() === 'vencedora' && $r3->status === 409, $r->resumo());
[$navTarde, $uidTarde] = v33Conta('Chegou Tarde');
v33Salvar($navTarde, v33Hall('v33-tarde', 3, 2));
checar('desafio vencido: quem cumpre depois não vira candidato', count(array_filter(v33Cands('tacas-do-rei'), static fn($c) => (int) $c['usuario_id'] === $uidTarde)) === 0);
$codV = (string) $uV['codigo_convite'];
$rp = $anon->pedir('GET', '/api/perfil.php?c=' . $codV);
checar('perfil do vencedor: desafiosVencidos = [tacas-do-rei]', ($rp->json['desafiosVencidos'] ?? null) === ['tacas-do-rei'], $rp->resumo());
$r = v33Adm(['acao' => 'desafio_reabrir', 'id' => $did]);
$r2 = v33Adm(['acao' => 'desafio_reabrir', 'id' => $did, 'motivo' => 'Declarei por engano']);
checar('desafio_reabrir sem motivo → 400; com motivo → sem vencedor, a vencedora volta a verificada, o aviso não lido some', $r->status === 400 && $r2->status === 200
    && v('SELECT vencido_em FROM desafios WHERE id = ?', [$did]) === null && v('SELECT estado FROM desafio_candidatos WHERE id = ?', [$primeiro]) === 'verificada'
    && v('SELECT aviso_conta FROM usuarios WHERE id = ?', [$vencedorUid]) === null && acUltimoLog('desafio_reabrir') !== null
    && v33Adm(['acao' => 'desafio_reabrir', 'id' => $did, 'motivo' => 'de novo'])->status === 409, $r2->resumo());
$ped = [];
for ($i = 0; $i < 4; $i++) {
    $ped[] = ['POST', '/api/admin.php', ['acao' => 'desafio_declarar_vencedor', 'candidatoId' => $primeiro], $navDono->jar, "e$i"];
}
$st = array_map(static fn($x) => $x[0], paralelo($ped));
sort($st);
checar('quatro declarações do mesmo candidato ao mesmo tempo: uma só', $st === [200, 409, 409, 409]
    && (int) v("SELECT COUNT(*) FROM desafio_candidatos WHERE desafio_id = ? AND estado = 'vencedora'", [$did]) === 1, json_encode($st));
v33Adm(['acao' => 'desafio_reabrir', 'id' => $did, 'motivo' => 'Para o próximo teste']);
// carreira apagada e carreira mudada
$pkP2 = pkCarreira('v33-par-2', $uidP2);
$kidP2 = (int) v('SELECT id FROM desafio_candidatos WHERE carreira_pk = ?', [$pkP2]);
salvarC($navP2, v33Hall('v33-par-2', 3, 2, true, ['headline' => 'Conteúdo novo']));
checar('a dona salva de novo a carreira verificada com outro conteúdo → volta a pendente (verificar de novo)', v('SELECT estado FROM desafio_candidatos WHERE id = ?', [$kidP2]) === 'pendente'
    && v('SELECT verificacao FROM desafio_candidatos WHERE id = ?', [$kidP2]) === null);
$navP2->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => 'v33-par-2']);
$r = v33Adm(['acao' => 'candidato_verificar', 'id' => $kidP2, 'resultado' => ['ok' => true]]);
$k2 = v33Get('r=desafio&id=' . $did)->json['candidatos']['itens'] ?? [];
$k2 = array_column($k2, null, 'id')[$kidP2] ?? [];
checar('a dona apaga a carreira → candidato recusado ("apagada"); verificar → 409 carreira_apagada; no painel: existe false, sem links', v('SELECT estado FROM desafio_candidatos WHERE id = ?', [$kidP2]) === 'recusada'
    && $r->status === 409 && $r->erro() === 'carreira_apagada' && ($k2['carreira']['existe'] ?? null) === false && nulo($k2, 'links'), $r->resumo());
// conta suspensa não vence
$kidP1 = (int) v('SELECT id FROM desafio_candidatos WHERE usuario_id = ? AND desafio_id = ?', [$uidP1, $did]);
v33Adm(['acao' => 'suspender', 'id' => $uidP1, 'motivo' => 'teste do desafio']);
$r = v33Adm(['acao' => 'desafio_declarar_vencedor', 'candidatoId' => $kidP1]);
v33Adm(['acao' => 'reativar', 'id' => $uidP1]);
checar('conta suspensa não pode ser declarada vencedora → 409 conta_suspensa', $r->status === 409 && in_array($r->erro(), ['conta_suspensa', 'ha_anterior'], true), $r->resumo());

// ══ 9. perfil público ═══════════════════════════════════════════════════════════════════════════

secao('v3.3 · perfil público (perfil.php?c=) e o código no Hall');
[$navPf, $uidPf] = v33Conta('Perfil Publico');
foreach (['v33-pf1' => 82, 'v33-pf2' => 81, 'v33-pf3' => 80, 'v33-pf4' => 60] as $id => $nota) {
    salvarC($navPf, v33Hall($id, 1, 0, true, ['nota' => $nota]));
}
$navPf->pedir('POST', '/api/conquistas.php', ['acao' => 'sincronizar', 'conquistas' => [['id' => 'first_title'], ['id' => 'goat'], ['id' => 'nomad']]]);
v33Adm(['acao' => 'atualizar_hall']);
$codPf = (string) v('SELECT codigo_convite FROM usuarios WHERE id = ?', [$uidPf]);
$r = $anon->pedir('GET', '/api/perfil.php?c=' . strtolower($codPf));
$chavesPf = array_keys($r->json['carreiras'][0] ?? []);
sort($chavesPf);
// v3.4: as carreiras-prova (semente do servidor + replay) também põem na conta as conquistas da lista delas (origem carreira)
$nConqPf = (int) v('SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id = ?', [$uidPf]);
checar('perfil.php?c= (código em minúsculas também) → apelido, desde, conquistas (as 3 do aparelho + as das carreiras-prova), as 3 carreiras do Hall (formato do hall.php, com perfil), link',
    $r->status === 200 && ($r->json['apelido'] ?? '') === 'Perfil Publico' && preg_match($RE_ISO, (string) ($r->json['desde'] ?? '')) === 1
    && $nConqPf >= 3 && ($r->json['conquistas'] ?? 0) === $nConqPf && array_column($r->json['carreiras'] ?? [], 'id') === ['v33-pf1', 'v33-pf2', 'v33-pf3'] && $chavesPf === CAMPOS_ITEM_HALL
    && ($r->json['carreiras'][0]['perfil'] ?? '') === $codPf && ($r->json['desafiosVencidos'] ?? null) === [] && ($r->json['codigo'] ?? '') === $codPf
    && ($r->json['link'] ?? '') === $ORIGEM . "/lenda/?c=$codPf#/jogador/$codPf", $r->resumo());
checar('…Cache-Control: public, max-age=120', $r->cab1('cache-control') === 'public, max-age=120', $r->cab1('cache-control'));
$h = hallGet();
$itPf = array_values(array_filter($h->json['itens'] ?? [], static fn(array $i): bool => ($i['apelido'] ?? '') === 'Perfil Publico'));
$hid = $anon->pedir('GET', '/api/hall.php?id=v33-pf1');
checar('hall.php: cada item leva perfil (o código de convite da conta); hall.php?id= também', ($itPf[0]['perfil'] ?? '') === $codPf && ($hid->json['perfil'] ?? '') === $codPf, $hid->resumo());
$ruins = [];
foreach (['', 'ABC', 'IIIIIIII', '00000000', 'ZZZZZZZZ', $codPf . 'X'] as $c) {
    $s = $anon->pedir('GET', '/api/perfil.php?c=' . urlencode($c))->status;
    if ($s !== 404) {
        $ruins[] = "$c → $s";
    }
}
$s1 = $anon->pedir('GET', '/api/perfil.php')->status;
$s2 = $anon->pedir('GET', '/api/perfil.php?c[]=x')->status;
checar('código que não existe ou fora do formato (e sem c, e c como lista) → 404', !$ruins && $s1 === 404 && $s2 === 404, implode('; ', $ruins));
conta($navPf, ['acao' => 'perfil', 'hallPublico' => 'nao']);
$r = $anon->pedir('GET', '/api/perfil.php?c=' . $codPf);
checar('conta que escolheu não aparecer no Hall → 404', $r->status === 404 && $r->erro() === 'nao_encontrado', $r->resumo());
conta($navPf, ['acao' => 'perfil', 'hallPublico' => 'auto']);
v33Adm(['acao' => 'suspender', 'id' => $uidPf, 'motivo' => 'teste do perfil']);
$r = $anon->pedir('GET', '/api/perfil.php?c=' . $codPf);
v33Adm(['acao' => 'reativar', 'id' => $uidPf]);
checar('conta suspensa → 404', $r->status === 404, $r->resumo());
v33Adm(['acao' => 'bloquear_hall', 'id' => $uidPf, 'sim' => true, 'motivo' => 'teste']);
$r = $anon->pedir('GET', '/api/perfil.php?c=' . $codPf);
v33Adm(['acao' => 'bloquear_hall', 'id' => $uidPf, 'sim' => false]);
checar('conta tirada do Hall pelo admin: o perfil abre, sem carreiras', $r->status === 200 && ($r->json['carreiras'] ?? null) === [], $r->resumo());
checar('POST perfil.php → 405', $anon->pedir('POST', '/api/perfil.php', ['c' => $codPf])->status === 405);

// ══ 10. LGPD ════════════════════════════════════════════════════════════════════════════════════

secao('v3.3 · LGPD: excluir a conta apaga mensagens, candidaturas, códigos e partidas por dia');
v33ZerarDesafios();
v33Ativar('tacas-do-rei');
[$navZ, $uidZ, $emailZ, $senhaZ] = v33Conta('Vai Embora');
v33Salvar($navZ, v33Hall('v33-z', 3, 2));
$kidZ = (int) v('SELECT id FROM desafio_candidatos WHERE usuario_id = ?', [$uidZ]);
v33Adm(['acao' => 'candidato_verificar', 'id' => $kidZ, 'resultado' => ['ok' => true]]);
v33Adm(['acao' => 'desafio_declarar_vencedor', 'candidatoId' => $kidZ]);
resetarLimitesCurtos();
$navZ->pedir('POST', '/api/suporte.php', ['tipo' => 'problema', 'mensagem' => 'Quero apagar a minha conta, como faço?']);
$anon->pedir('POST', '/api/suporte.php', ['tipo' => 'duvida', 'mensagem' => 'Mandei antes de entrar na conta.', 'email' => strtoupper($emailZ)]);
$idMsgZ = (int) v('SELECT id FROM mensagens_suporte WHERE usuario_id = ?', [$uidZ]);
v33Adm(['acao' => 'suporte_responder', 'id' => $idMsgZ, 'resposta' => 'É em Minha conta → Excluir conta.']);
q('INSERT INTO verificacoes_email (usuario_id, codigo_hash, expira_em, tentativas, criado_em) VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL 1 DAY, 0, UTC_TIMESTAMP())
    ON DUPLICATE KEY UPDATE expira_em = VALUES(expira_em)', [$uidZ, str_repeat('a', 64)]);
q('INSERT INTO partidas_dia (usuario_id, dia, n) VALUES (?, ?, 7)', [$uidZ, v33Hoje()]);
$antesZ = [(int) v('SELECT COUNT(*) FROM mensagens_suporte WHERE usuario_id = ? OR email = ?', [$uidZ, $emailZ]), (int) v('SELECT COUNT(*) FROM desafio_candidatos WHERE usuario_id = ?', [$uidZ])];
resetarLimitesCurtos();
$r = conta($navZ, ['acao' => 'excluir', 'senha' => $senhaZ]);
$dZ = q("SELECT vencedor_usuario_id, vencedor_candidato, vencido_em FROM desafios WHERE slug = 'tacas-do-rei'")[0] ?? [];
$pubZ = v33Publico('tacas-do-rei');
$logZ = q("SELECT detalhes FROM admin_log WHERE acao IN ('candidato_verificar', 'desafio_vencedor', 'suporte_responder') AND (alvo = ? OR alvo = ?)",
    ['desafio:' . v33IdDesafio('tacas-do-rei'), 'suporte:' . $idMsgZ]);
checar('excluir (pela própria conta) → as 2 mensagens (a da conta e a mandada sem entrar com o mesmo e-mail), a candidatura, o código e as partidas por dia somem',
    $r->status === 200 && $antesZ === [2, 1] && (int) v('SELECT COUNT(*) FROM mensagens_suporte WHERE usuario_id = ? OR email = ?', [$uidZ, $emailZ]) === 0
    && (int) v('SELECT COUNT(*) FROM desafio_candidatos WHERE usuario_id = ?', [$uidZ]) === 0 && (int) v('SELECT COUNT(*) FROM verificacoes_email WHERE usuario_id = ?', [$uidZ]) === 0
    && (int) v('SELECT COUNT(*) FROM partidas_dia WHERE usuario_id = ?', [$uidZ]) === 0, $r->resumo());
checar('…o desafio que ela venceu continua vencido, sem dizer por quem (público: vencedor {excluido: true})', $dZ['vencedor_usuario_id'] === null && $dZ['vencedor_candidato'] === null
    && $dZ['vencido_em'] !== null && ($pubZ['vencedor']['excluido'] ?? null) === true && nulo($pubZ['vencedor'] ?? null, 'apelido'), json_encode($pubZ));
checar('…e o registro do admin dessas ações fica só com a ação, a data e o id (sem a conta)', $logZ !== []
    && !array_filter($logZ, static fn(array $l): bool => str_contains((string) $l['detalhes'], '"usuario":' . $uidZ)), json_encode($logZ));
$rg = acEquipe(novoNav(), ['acao' => 'backup_guardar'], acBearer());
checar('o backup leva os desafios, os candidatos e as mensagens do Fale conosco (não os códigos nem as partidas por dia)', $rg->status === 200
    && isset($rg->json['contagem']['desafios'], $rg->json['contagem']['desafio_candidatos'], $rg->json['contagem']['mensagens_suporte'])
    && !isset($rg->json['contagem']['verificacoes_email']) && !isset($rg->json['contagem']['partidas_dia']), $rg->resumo());
$r = v33Get('r=desafio&id=' . v33IdDesafio('tacas-do-rei'));
checar('o painel abre o desafio vencido pela conta excluída (vencedor.excluido)', $r->status === 200 && ($r->json['desafio']['vencedor']['excluido'] ?? null) === true, $r->resumo());
[$navZ2, $uidZ2] = v33Conta('Saindo Pelo Painel');
resetarLimitesCurtos();
$navZ2->pedir('POST', '/api/suporte.php', ['tipo' => 'outro', 'mensagem' => 'Mensagem de quem o admin vai excluir.']);
$r = v33Adm(['acao' => 'excluir_usuario', 'id' => $uidZ2, 'confirma' => 'Saindo Pelo Painel', 'motivo' => 'pedido_titular']);
checar('excluir pelo admin (excluir_usuario) também apaga as mensagens', $r->status === 200 && (int) v('SELECT COUNT(*) FROM mensagens_suporte WHERE usuario_id = ?', [$uidZ2]) === 0, $r->resumo());

// ══ 11. entradas erradas ════════════════════════════════════════════════════════════════════════

secao('v3.3 · tipos errados e valores estranhos nas rotas novas (nenhum 500)');
$estranhos = [null, true, false, 0, -1, 1.5, 1e300, '', 'x', str_repeat('y', 3000), [], [1, 2], ['a' => ['b' => ['c' => 1]]]];
$antes500 = count($FALHAS);
resetarLimitesCurtos();
foreach ($estranhos as $x) {
    conta($navX, ['acao' => 'verificar_email', 'codigo' => $x]);
    $anon->pedir('POST', '/api/suporte.php', ['tipo' => $x, 'mensagem' => $x, 'email' => $x, 'pagina' => $x]);
    resetarLimitesCurtos();
    foreach (['desafio_salvar' => ['id' => $x, 'slug' => $x, 'titulo' => $x, 'criterio' => $x, 'requisitos' => $x, 'inicio' => $x, 'fim' => $x, 'premio' => $x,
        'regulamento' => $x, 'descricao' => $x, 'ordem' => $x], 'desafio_ativar' => ['id' => $x, 'ativo' => $x],
        'candidato_verificar' => ['id' => $x, 'carreira' => $x, 'resultado' => $x], 'candidato_recusar' => ['id' => $x, 'motivo' => $x],
        'desafio_declarar_vencedor' => ['candidatoId' => $x], 'desafio_reabrir' => ['id' => $x, 'motivo' => $x], 'suporte_status' => ['id' => $x, 'status' => $x],
        'suporte_responder' => ['id' => $x, 'resposta' => $x], 'suporte_lote' => ['ids' => $x, 'status' => $x], 'reenviar_verificacao' => ['id' => $x]] as $ac => $c) {
        v33Adm(['acao' => $ac] + $c);
    }
    salvarC($navX, v33Hall('v33-estranho', 1, 0, is_array($x) ? $x : ['v' => 1, 'seed' => $x, 'picks' => $x, 'identity' => $x, 'pace' => $x, 'dados' => $x, 'bonusOvr' => $x]));
}
foreach (['eu=1', 'eu=x', 'eu[]=1'] as $qs) {
    $navX->pedir('GET', '/api/desafios.php?' . $qs);
}
foreach (['r=desafio&id[]=1', 'r=suporte&status[]=x', 'r=suporte&q[]=x', 'r=suporte&pagina=-1', 'r=desafio&id=1&pagina=x'] as $qs) {
    v33Get($qs);
}
checar('nenhum 500 nem vazamento (conta, suporte, carreiras com replay estranho, desafios, admin)', count($FALHAS) === $antes500);

// ══ 12. banco sem o instalar da v3.3 ════════════════════════════════════════════════════════════

secao('v3.3 · arquivos novos com o banco da v3.2 (sem o instalar da v3.3): o jogo não quebra');
q("UPDATE site_config SET valor = '32' WHERE chave = '_esquema'");
[$navS, $uidS] = novaConta('Banco Antigo');
$navS->conferir = false;
$r1 = salvarC($navS, v33Hall('v33-s22', 3, 2));
$r2 = $navS->pedir('GET', '/api/carreiras.php');
$r3 = $navS->pedir('POST', '/api/suporte.php', ['tipo' => 'duvida', 'mensagem' => 'Funciona antes do instalar?']);
resetarLimitesCurtos();
$r4 = $anon->pedir('GET', '/api/desafios.php');
$r5 = conta($navS, ['acao' => 'reenviar_verificacao']);
$r6 = $navS->pedir('GET', '/api/conta.php');
$antesP = (int) v('SELECT partidas_conta FROM usuarios WHERE id = ?', [$uidS]);
partidaReal($navS, uuid4());
$navB33 = novoNav();
$navB33->conferir = false; // o 503 é a resposta esperada
$r7 = $navB33->pedir('GET', '/api/admin.php?r=desafios', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN, 'origem' => false]);
checar('salvar (C sem temReplay de verdade), listar, conta e a partida contada funcionam; Fale conosco e confirmação respondem 503 indisponivel; desafios.php vazio; o painel diz "rode o instalar"',
    $r1->status === 200 && ($r1->json['carreira']['temReplay'] ?? null) === false && $r2->status === 200 && $r3->status === 503 && $r3->erro() === 'indisponivel'
    && ($r4->json['desafios'] ?? null) === [] && $r5->status === 503 && $r6->status === 200 && (int) v('SELECT partidas_conta FROM usuarios WHERE id = ?', [$uidS]) === $antesP + 1
    && (int) v('SELECT COUNT(*) FROM partidas_dia WHERE usuario_id = ?', [$uidS]) === 0 && $r7->status === 503 && $r7->erro() === 'instalar',
    $r1->resumo() . ' | ' . $r3->resumo() . ' | ' . $r7->resumo());
$r = $anon->pedir('POST', '/api/instalar.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
checar('instalar → _esquema 34 de novo (v3.4)', $r->status === 200 && (int) v("SELECT valor FROM site_config WHERE chave = '_esquema'") === 34, $r->resumo());

// ── fim: desafios desativados, equipe vazia ─────────────────────────────────────────────────────
v33Limpar();
acLimparEquipe();

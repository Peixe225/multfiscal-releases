<?php
/**
 * LENDA · testes da v3.2, lado da moderação (CONTRATO-v32.md §A): "Precisa de atenção", pulso, sinais e lote,
 * motivo obrigatório, Na área, anotação, tipo de conta, tirar do Hall, lixeira, mesmo aparelho, código de troca de
 * senha mandado pelo admin e registro de e-mails, relatórios, filtros, bônus, registro, tempo de jogo, feed, destaque,
 * aviso no celular, tolerância ao banco sem instalar, revisão configurável (X1), estado no Hall (X2) e LGPD. Com a
 * carga do teste-v3.php (2.000 contas), mede o atencao e o resumo e confere as listas sem filesort.
 * Incluído pelo teste.php (usa os ajudantes dele e do teste-v3.php).
 */
declare(strict_types=1);

// ── ajudantes ────────────────────────────────────────────────────────────────────────────────────

/** Estado conhecido: o limparContas() da v3 e as tabelas e estados da v3.2. */
function limparV32(): void
{
    limparContas();
    foreach (['lixeira_carreiras', 'email_log', 'visitas', 'eventos', 'partidas_vid'] as $t) {
        q("DELETE FROM $t");
    }
    q("DELETE FROM site_config WHERE chave IN ('_atencao', '_alertas_lidos', '_multicontas', 'manutencao', 'cadastro_aberto', 'aviso', 'avisos',
        'hall_revisao_nota', 'aviso_celular')");
    q("DELETE FROM site_config WHERE chave LIKE '\\_painel:%'");
}

/**
 * Navegador com uma sessão do painel de uma pessoa da equipe com o papel dado (conta e sessão gravadas direto no
 * banco, como o painel.php gravaria depois da senha e do PIN). Devolve [navegador, id da conta].
 */
function navEquipe(string $papel): array
{
    global $CONFIG_ARQ;
    $cfg = require $CONFIG_ARQ;
    q("INSERT INTO admin_contas (email, nome, senha_hash, pin_hash, papel, ativo, trocar_senha, da_config, criado_em) VALUES (?, ?, 'x', 'x', ?, 1, 0, 0, UTC_TIMESTAMP())",
        [$papel . '-' . bin2hex(random_bytes(4)) . '@equipe.exemplo', 'Pessoa ' . ucfirst($papel), $papel]);
    $id = (int) v('SELECT MAX(id) FROM admin_contas');
    $tok = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    $exp = time() + 3600;
    q("INSERT INTO admin_sessoes (token_sha256, admin_id, etapa, criada_em, expira_em, visto_em, aparelho) VALUES (?, ?, 'pronto', UTC_TIMESTAMP(), ?, UTC_TIMESTAMP(), 'computador')",
        [hash('sha256', $tok), $id, gmdate('Y-m-d H:i:s', $exp)]);
    $n = novoNav();
    $n->jar['lenda_painel'] = $tok . '.' . $exp . '.' . hash_hmac('sha256', 'painel|' . $tok . '|' . $exp, (string) getenv('LENDA_SEGREDO') . '|' . trim((string) $cfg['admin_senha_hash']));
    return [$n, $id];
}

/** Salva e devolve o carreiras.id. */
function salvarPk(Navegador $n, int $uid, string $id, array $m = [], bool $liberar = true): int
{
    salvarC($n, hallEntry($id, $m), 'manual', $liberar);
    return pkCarreira($id, $uid);
}

/** Itens do ?r=hall&filtro=todas por carreiras.id. */
function hallAdminPorPk(string $filtro = 'todas'): array
{
    $r = admGet('r=hall&filtro=' . $filtro);
    return array_column($r->json['itens'] ?? [], null, 'id');
}

function codigosSinais(?array $item): array
{
    return array_column($item['sinais'] ?? [], 'codigo');
}

/** EXPLAIN da consulta: a lista de "Extra" de cada linha. */
function extrasExplain(string $sql, array $p = []): array
{
    return array_map(static fn(array $l): string => (string) ($l['Extra'] ?? ''), q('EXPLAIN ' . $sql, $p));
}

/** Pedidos ao mesmo tempo com a sessão do $ADM. */
function paraleloAdm(array $corpos): array
{
    global $ADM;
    $ped = [];
    foreach ($corpos as $i => $c) {
        $ped[] = ['POST', '/api/admin.php', $c, $ADM->jar, "p$i"];
    }
    return paralelo($ped);
}

/** Roda código PHP com o _lib.php e uma config com chaves trocadas (sem mexer na do php -S). */
function phpComLibConfig(array $extra, string $codigo): mixed
{
    global $CONFIG_ARQ;
    $arq = dirname($CONFIG_ARQ) . '/lenda-config-v32-' . bin2hex(random_bytes(4)) . '.php';
    file_put_contents($arq, '<?php return array_merge(require ' . var_export($CONFIG_ARQ, true) . ', ' . var_export($extra, true) . ');');
    $api = dirname(__DIR__) . '/api';
    $pre = 'putenv(' . var_export('LENDA_CONFIG=' . $arq, true) . '); require ' . var_export("$api/_lib.php", true) . '; ';
    $saida = shell_exec('php -r ' . escapeshellarg($pre . $codigo) . ' 2>&1');
    unlink($arq);
    $j = json_decode((string) $saida, true);
    if ($j === null) {
        checar('php -r com o _lib.php (config trocada)', false, substr((string) $saida, 0, 300));
    }
    return $j;
}

$RE_MD5 = '/^[0-9a-f]{32}$/';

// ══ 0. desempenho com a carga do teste-v3 (2.000 contas, 8.000 carreiras) ═══════════════════════

if (!$SEM_CARGA) {
    secao('v3.2 · desempenho com 2.000 contas: atencao, resumo, pulso e listas sem filesort');
    $ADM = entrarAdmin();
    $uidsC = array_map('intval', array_column(q("SELECT id FROM usuarios WHERE email LIKE 'carga%' ORDER BY id"), 'id'));
    // duas visitas por conta da carga; a cada 2 contas, um aparelho em comum (1.000 grupos de "mesmo aparelho")
    $vidDe = [];
    foreach ($uidsC as $i => $uid) {
        $vidDe[$uid] = sprintf('c0000000-0000-4000-8000-%012d', intdiv($i, 2));
    }
    $pdo->beginTransaction();
    foreach (array_chunk($uidsC, 250) as $grupo) {
        $vals = [];
        $ps = [];
        foreach ($grupo as $uid) {
            $vidC = $vidDe[$uid];
            foreach ([1, 2] as $k) {
                $vals[] = "(?, ?, ?, UTC_TIMESTAMP() - INTERVAL ? MINUTE, UTC_TIMESTAMP() - INTERVAL ? MINUTE, ?, 'tiktok', 'mobile', 0, ?, 'classico')";
                array_push($ps, uuid4(), $vidC, $uid, 60 * $k + $uid % 50, $uid % 50, 120 + $uid % 600, 60 + $uid % 300);
            }
        }
        q('INSERT INTO visitas (sid, vid, usuario_id, inicio, ultimo, ativo_s, origem, dispositivo, bot, jogando_s, modo_atual) VALUES ' . implode(',', $vals), $ps);
    }
    for ($i = 0; $i < 300; $i++) {
        q("INSERT INTO email_log (em, para_hash, para_mask, tipo, via, ok) VALUES (UTC_TIMESTAMP() - INTERVAL ? MINUTE, ?, 'ca***@exemplo.com', 'esqueci', 'arquivo', 1)",
            [$i, hash('sha256', "carga$i")]);
        q("INSERT INTO admin_log (em, acao, alvo, detalhes, quem) VALUES (UTC_TIMESTAMP() - INTERVAL ? MINUTE, ?, ?, '{}', 'token')",
            [$i, $i % 3 === 0 ? 'dar_bonus' : 'nota', 'usuario:' . $uidsC[$i]]);
    }
    $pdo->commit();
    $pdo->query('ANALYZE TABLE usuarios, carreiras, visitas, admin_log, email_log, indicacoes, denuncias, bonus, lixeira_carreiras')->fetchAll();
    admGet('r=multicontas&atualizar=1'); // os grupos de aparelho ficam no cache de 10 min (como no uso: o atencao lê dele)
    foreach ([
        'atencao (recalculado na hora)' => static fn(): Resposta => admGet('r=atencao&atualizar=1'),
        'resumo' => static fn(): Resposta => admGet('r=resumo'),
        'usuarios (com as contagens dos filtros)' => static fn(): Resposta => admGet('r=usuarios'),
        'pulso (painel.php?so=agora)' => static fn(): Resposta => $ADM->pedir('GET', '/api/painel.php?so=agora'),
    ] as $nome => $f) {
        [$ms, $med, $r] = cronometrar($f);
        checar(sprintf('%s com 2.000 contas: %.0f ms (melhor de 5; mediana %.0f ms)', $nome, $ms, $med), $r->status === 200 && $ms < 150, $r->resumo());
    }
    [$ms, , $r] = cronometrar(static fn(): Resposta => admGet('r=multicontas&atualizar=1'), 3);
    checar(sprintf('multicontas recalculado (4.000 visitas, 1.000 grupos): %.0f ms', $ms), $r->status === 200 && ($r->json['total'] ?? 0) >= 1000 && $ms < 1500, $r->resumo());
    $listas = [
        'usuarios (recentes)' => ['SELECT u.* FROM usuarios u FORCE INDEX FOR ORDER BY (ix_usuarios_criado) ORDER BY u.criado_em DESC, u.id DESC LIMIT 50 OFFSET 0', []],
        'usuarios por tipo' => ['SELECT u.* FROM usuarios u WHERE u.tipo = ? ORDER BY u.criado_em DESC, u.id DESC LIMIT 50 OFFSET 0', ['jogador']],
        'usuarios por último acesso' => ['SELECT u.* FROM usuarios u FORCE INDEX FOR ORDER BY (ix_usuarios_acesso) ORDER BY u.ultimo_acesso DESC, u.id DESC LIMIT 50 OFFSET 0', []],
        'registro' => ['SELECT * FROM admin_log FORCE INDEX FOR ORDER BY (ix_admin_log_em) ORDER BY em DESC, id DESC LIMIT 50 OFFSET 0', []],
        'registro por ação' => ['SELECT * FROM admin_log WHERE acao = ? ORDER BY em DESC, id DESC LIMIT 50 OFFSET 0', ['dar_bonus']],
        'registro por quem' => ['SELECT * FROM admin_log WHERE quem = ? ORDER BY em DESC, id DESC LIMIT 50 OFFSET 0', ['token']],
        'e-mails' => ['SELECT * FROM email_log FORCE INDEX FOR ORDER BY (ix_email_log_em) ORDER BY em DESC, id DESC LIMIT 50 OFFSET 0', []],
        'e-mails de um endereço' => ['SELECT * FROM email_log WHERE para_hash = ? ORDER BY em DESC, id DESC LIMIT 50 OFFSET 0', [hash('sha256', 'carga1')]],
        'lixeira' => ['SELECT l.id, l.carreira_pk, l.usuario_id, l.carreira_id, l.jogador, l.nota, l.motivo, l.apagada_em, l.apagada_por, l.expira_em,
            (l.dados IS NOT NULL) AS tem_copia FROM lixeira_carreiras l FORCE INDEX FOR ORDER BY (ix_lixeira_expira) ORDER BY l.expira_em DESC, l.id DESC LIMIT 50 OFFSET 0', []],
        'bônus' => ['SELECT b.*, u.apelido FROM bonus b LEFT JOIN usuarios u ON u.id = b.usuario_id ORDER BY b.id DESC LIMIT 50 OFFSET 0', []],
        'denúncias abertas' => ["SELECT d.id FROM denuncias d FORCE INDEX (ix_denuncias_status) LEFT JOIN usuarios x ON x.id = d.usuario_id LEFT JOIN carreiras c ON c.id = d.carreira_pk
            WHERE d.status = 'aberta' ORDER BY d.criada_em DESC, d.id DESC LIMIT 50 OFFSET 0", []],
        'indicações pendentes' => ["SELECT i.id FROM indicacoes i LEFT JOIN usuarios a ON a.id = i.indicador_id WHERE i.status = ? ORDER BY i.criada_em DESC, i.id DESC LIMIT 50 OFFSET 0", ['pendente']],
        'indicações (todas)' => ['SELECT i.id FROM indicacoes i ORDER BY i.criada_em DESC, i.id DESC LIMIT 50 OFFSET 0', []],
        'denúncias (todas)' => ['SELECT d.id FROM denuncias d ORDER BY d.id DESC LIMIT 50 OFFSET 0', []],
        'relatório nunca jogaram' => ['SELECT u.* FROM usuarios u FORCE INDEX FOR ORDER BY (ix_usuarios_criado) WHERE u.partidas_conta = 0 AND u.partidas = 0 ORDER BY u.criado_em DESC, u.id DESC LIMIT 100 OFFSET 0', []],
        'jogadores (feed)' => ["SELECT e.id FROM eventos e FORCE INDEX (ix_eventos_em_tipo) LEFT JOIN visitas v ON v.sid = e.sid
            WHERE e.em >= UTC_TIMESTAMP() - INTERVAL 30 DAY AND e.tipo IN ('cadastro', 'login', 'jogo_fim', 'compartilhar') ORDER BY e.em DESC LIMIT 50 OFFSET 0", []],
    ];
    $comFilesort = [];
    foreach ($listas as $nome => [$sql, $p]) {
        foreach (extrasExplain($sql, $p) as $x) {
            if (str_contains($x, 'filesort')) {
                $comFilesort[] = "$nome ($x)";
            }
        }
    }
    checar('EXPLAIN das listas do painel: nenhuma com filesort (' . count($listas) . ' listas)', !$comFilesort, implode(' | ', $comFilesort));
}

// ══ 1. banco ════════════════════════════════════════════════════════════════════════════════════

secao('v3.2 · banco: colunas e tabelas novas, _esquema e instalar idempotente');
limparV32();
$ADM = entrarAdmin();
$colunas = static fn(string $t): array => array_column(q("SHOW COLUMNS FROM $t"), 'Field');
checar('usuarios: tipo, hall_bloqueado, nota_admin(_em/_por), aviso_conta(_em)', !array_diff(['tipo', 'tipo_em', 'hall_bloqueado', 'nota_admin',
    'nota_admin_em', 'nota_admin_por', 'aviso_conta', 'aviso_conta_em'], $colunas('usuarios')));
checar('carreiras: motivo_admin, moderada_em, destaque; visitas: rota, modo_atual, jogando_s; admin_log: quem, ip_dia; hall_foto: destaque',
    !array_diff(['motivo_admin', 'moderada_em', 'destaque'], $colunas('carreiras')) && !array_diff(['rota', 'modo_atual', 'jogando_s'], $colunas('visitas'))
    && !array_diff(['quem', 'ip_dia'], $colunas('admin_log')) && in_array('destaque', $colunas('hall_foto'), true));
$idx = static fn(string $t): array => array_unique(array_column(q("SHOW INDEX FROM $t"), 'Key_name'));
checar('índices novos (tipo, acesso, usuario_vid, indicacoes_status, admin_log acao/quem)', in_array('ix_usuarios_tipo', $idx('usuarios'), true)
    && in_array('ix_usuarios_acesso', $idx('usuarios'), true) && in_array('ix_visitas_usuario_vid', $idx('visitas'), true)
    && in_array('ix_indicacoes_status', $idx('indicacoes'), true) && in_array('ix_admin_log_acao', $idx('admin_log'), true) && in_array('ix_admin_log_quem', $idx('admin_log'), true));
checar('tabelas lixeira_carreiras e email_log', count(q("SHOW TABLES LIKE 'lixeira_carreiras'")) === 1 && count(q("SHOW TABLES LIKE 'email_log'")) === 1);
checar('instalar gravou site_config._esquema = 33 (v3.3)', (int) v("SELECT valor FROM site_config WHERE chave = '_esquema'") === 33);
$r = $anon->pedir('POST', '/api/instalar.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
checar('instalar de novo: nada a alterar', $r->status === 200 && ($r->json['alteracoes'] ?? null) === [], $r->resumo());
checar('o _schema.sql segue as regras (sem comentário no fim da linha, sem FOREIGN KEY/CHECK/FULLTEXT, coluna nova NULL ou DEFAULT)', (static function (): bool {
    $sql = (string) file_get_contents(dirname(__DIR__) . '/api/_schema.sql');
    foreach (preg_split('/\R/', $sql) as $l) {
        $t = trim($l);
        if ($t === '' || str_starts_with($t, '--')) {
            continue;
        }
        if (str_contains($t, '--') || preg_match('/FOREIGN KEY|\bCHECK\b|FULLTEXT/i', $t)) {
            return false;
        }
    }
    return true;
})());

// ══ 2. acesso: 401 e 403 ════════════════════════════════════════════════════════════════════════

secao('v3.2 · rotas novas: sem admin → 401; papel sem o poder → 403 sem_poder (registrado como negado)');
[$navJ] = novaConta('Jogador Curioso');
$rotasNovas = ['atencao', 'agora', 'lixeira', 'multicontas', 'emails', 'relatorio&tipo=base', 'tempo', 'eventos', 'bonus', 'seguranca', 'usuario&id=1'];
$acoesNovas = ['alerta_dispensar', 'alerta_reabrir', 'carreiras_lote', 'resolver_denuncias_lote', 'indicacoes_lote', 'nota', 'mudar_tipo', 'bloquear_hall',
    'restaurar_carreira', 'liberar_reenvio', 'enviar_redefinicao', 'destacar_carreira', 'tirar_bonus_lote', 'testar_aviso'];
$fora = [];
foreach ([$anon, $navJ] as $nv) {
    foreach ($rotasNovas as $rt) {
        $r = $nv->pedir('GET', '/api/admin.php?r=' . $rt);
        if ($r->status !== 401) {
            $fora[] = "GET $rt → $r->status";
        }
    }
    foreach ($acoesNovas as $ac) {
        $r = $nv->pedir('POST', '/api/admin.php', ['acao' => $ac, 'id' => 1, 'ids' => [1], 'chave' => 'suspeitas', 'operacao' => 'ocultar', 'motivo' => 'x']);
        if ($r->status !== 401) {
            $fora[] = "POST $ac → $r->status";
        }
    }
}
checar('as ' . count($rotasNovas) . ' rotas e ' . count($acoesNovas) . ' ações novas sem admin (anônimo e jogador) → 401', !$fora, implode(', ', $fora));
[$navMod] = navEquipe('moderador');
[$navLeitor] = navEquipe('leitor');
$r = $navMod->pedir('GET', '/api/admin.php?r=atencao');
checar('moderador (ver) abre o "Precisa de atenção"', $r->status === 200 && is_array($r->json['alertas'] ?? null), $r->resumo());
$r = $navMod->pedir('POST', '/api/admin.php', ['acao' => 'nota', 'id' => 1, 'texto' => 'x']);
checar('moderador anotando conta (poder usuarios) → 403 sem_poder', $r->status === 403 && $r->erro() === 'sem_poder', $r->resumo());
$r = $navLeitor->pedir('POST', '/api/admin.php', ['acao' => 'carreiras_lote', 'ids' => [1], 'operacao' => 'ocultar', 'motivo' => 'x']);
checar('leitor em lote (poder moderar) → 403 antes de olhar o pedido', $r->status === 403 && $r->erro() === 'sem_poder', $r->resumo());
$r = $navLeitor->pedir('GET', '/api/admin.php?r=relatorio&tipo=base&csv=1');
checar('leitor baixando relatório em CSV (poder exportar) → 403', $r->status === 403 && $r->erro() === 'sem_poder', $r->resumo());
$r = $navLeitor->pedir('GET', '/api/admin.php?r=relatorio&tipo=base');
checar('…mas vê o relatório na tela (ver)', $r->status === 200, $r->resumo());
checar('as recusas ficam no registro como "negado"', (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'negado'") >= 3);

// ══ 3. motivo obrigatório e guardado (P0-4) ═════════════════════════════════════════════════════

secao('v3.2 · motivo obrigatório, confirmação do apelido e motivo guardado na carreira (P0-4)');
[$navA, $uidA, , $vidA] = novaConta('Dono Alfa');
$pkA1 = salvarPk($navA, $uidA, 'a1', ['nota' => 70]);
$pkA2 = salvarPk($navA, $uidA, 'a2', ['nota' => 71]);
$pkA3 = salvarPk($navA, $uidA, 'a3', ['nota' => 72]);
admPost(['acao' => 'atualizar_hall']);
$ruins = [];
foreach ([[], ['motivo' => ''], ['motivo' => '   '], ['motivo' => 123], ['motivo' => ['x']], ['motivo' => str_repeat('m', 201)]] as $c) {
    $r = admPost(['acao' => 'ocultar_carreira', 'id' => $pkA1] + $c);
    if ($r->status !== 400 || $r->erro() !== 'motivo') {
        $ruins[] = json_encode($c) . " → $r->status";
    }
}
checar('ocultar sem motivo, vazio, só espaço, número, lista ou com 201 caracteres → 400 motivo', !$ruins, implode(', ', $ruins));
checar('…e nada mudou', (int) v('SELECT oculta FROM carreiras WHERE id = ?', [$pkA1]) === 0);
$r = admPost(['acao' => 'ocultar_carreira', 'id' => $pkA1, 'motivo' => '  Nome   ofensivo ']);
$lA1 = q('SELECT oculta, motivo_admin, moderada_em FROM carreiras WHERE id = ?', [$pkA1])[0];
checar('ocultar com motivo → 200; motivo (limpo) e hora guardados na carreira; sai do Hall', $r->status === 200 && (int) $lA1['oculta'] === 1
    && $lA1['motivo_admin'] === 'Nome ofensivo' && $lA1['moderada_em'] !== null && (int) v('SELECT COUNT(*) FROM hall_foto WHERE carreira_pk = ?', [$pkA1]) === 0, $r->resumo());
$it = hallAdminPorPk('ocultas')[$pkA1] ?? null;
checar('?r=hall: moderacao {em, motivo}', ($it['moderacao']['motivo'] ?? '') === 'Nome ofensivo' && preg_match($RE_ISO, (string) ($it['moderacao']['em'] ?? '')) === 1, json_encode($it));
$r = admGet('r=carreira&id=' . $pkA1);
$r2 = admGet('r=carreira&carreiraId=a1');
checar('?r=carreira (por id e por HallEntry.id, X4): meta.moderacao e o HallEntry', $r->status === 200 && ($r->json['meta']['moderacao']['motivo'] ?? '') === 'Nome ofensivo'
    && ($r->json['carreira']['id'] ?? '') === 'a1' && ($r2->json['meta']['id'] ?? 0) === $pkA1, $r->resumo());
$r = admGet('r=carreira&carreiraId=nao-existe');
checar('?r=carreira&carreiraId que não existe → 404', $r->status === 404, $r->resumo());
$r = admGet('r=usuario&id=' . $uidA);
$cA1 = array_values(array_filter($r->json['usuario']['carreiras'] ?? [], static fn($c) => ($c['id'] ?? '') === 'a1'))[0] ?? [];
checar('?r=usuario: carreira com moderacao', ($cA1['moderacao']['motivo'] ?? '') === 'Nome ofensivo' && ($cA1['pk'] ?? 0) === $pkA1, json_encode($cA1));
salvarC($navA, hallEntry('a1', ['nota' => 70]));
checar('o jogador salva de novo a mesma carreira: continua oculta e com o motivo da decisão', (int) v('SELECT oculta FROM carreiras WHERE id = ?', [$pkA1]) === 1
    && v('SELECT motivo_admin FROM carreiras WHERE id = ?', [$pkA1]) === 'Nome ofensivo');
$lg = json_decode((string) v("SELECT detalhes FROM admin_log WHERE acao = 'ocultar_carreira' ORDER BY id DESC LIMIT 1"), true);
checar('o registro leva o motivo', ($lg['motivo'] ?? '') === 'Nome ofensivo', json_encode($lg));
$r = admPost(['acao' => 'mostrar_carreira', 'id' => $pkA1]);
$lA1 = q('SELECT oculta, motivo_admin, moderada_em FROM carreiras WHERE id = ?', [$pkA1])[0];
checar('mostrar sem motivo → 200; volta (oculta 0), motivo apagado e a hora da decisão nova', $r->status === 200 && (int) $lA1['oculta'] === 0
    && $lA1['motivo_admin'] === null && $lA1['moderada_em'] !== null, $r->resumo());
$r = admPost(['acao' => 'mostrar_carreira', 'id' => $pkA1, 'motivo' => 'Denúncia improcedente']);
checar('mostrar com motivo → guardado', $r->status === 200 && v('SELECT motivo_admin FROM carreiras WHERE id = ?', [$pkA1]) === 'Denúncia improcedente');
$r = admPost(['acao' => 'apagar_carreira', 'id' => $pkA3]);
checar('apagar sem motivo → 400 motivo (e a carreira fica)', $r->status === 400 && $r->erro() === 'motivo' && pkCarreira('a3', $uidA) === $pkA3, $r->resumo());
q("INSERT INTO denuncias (carreira_pk, usuario_id, motivo, criada_em, status) VALUES (?, ?, 'nome', UTC_TIMESTAMP(), 'aberta')", [$pkA2, $uidA + 1000]);
$dA2 = (int) v('SELECT MAX(id) FROM denuncias');
$r = admPost(['acao' => 'resolver_denuncia', 'id' => $dA2, 'resultado' => 'ocultar']);
checar('resolver_denuncia ocultar sem motivo → 400 motivo', $r->status === 400 && $r->erro() === 'motivo', $r->resumo());
$r = admPost(['acao' => 'resolver_denuncia', 'id' => $dA2, 'resultado' => 'ok']);
checar('resolver_denuncia ok sem motivo → 200 (fecha a denúncia; grava a hora da decisão)', $r->status === 200 && ($r->json['denunciasFechadas'] ?? 0) === 1
    && v('SELECT moderada_em FROM carreiras WHERE id = ?', [$pkA2]) !== null, $r->resumo());
$r = admPost(['acao' => 'suspender', 'id' => $uidA]);
checar('suspender sem motivo → 400 motivo (a conta continua ativa)', $r->status === 400 && $r->erro() === 'motivo' && v('SELECT status FROM usuarios WHERE id = ?', [$uidA]) === 'ativo', $r->resumo());
$r = admPost(['acao' => 'suspender', 'id' => $uidA, 'dias' => 0, 'motivo' => 'x']);
checar('…os dias continuam conferidos (400 dias)', $r->status === 400 && $r->erro() === 'dias', $r->resumo());
[, $uidEx1] = novaConta('Vai Embora');
foreach ([[], ['confirma' => ''], ['confirma' => 'Vai'], ['confirma' => 123], ['confirma' => 'Vai Embora', 'motivo' => 'porque sim']] as $c) {
    $r = admPost(['acao' => 'excluir_usuario', 'id' => $uidEx1] + $c);
    checar('excluir_usuario ' . json_encode($c, JSON_UNESCAPED_UNICODE) . ' → 400 ' . (isset($c['motivo']) ? 'motivo' : 'confirma'), $r->status === 400
        && $r->erro() === (isset($c['motivo']) ? 'motivo' : 'confirma') && (int) v('SELECT COUNT(*) FROM usuarios WHERE id = ?', [$uidEx1]) === 1, $r->resumo());
}
$r = admPost(['acao' => 'excluir_usuario', 'id' => $uidEx1, 'confirma' => '  VAI EMBORA ', 'motivo' => 'pedido_titular']);
$lx = json_decode((string) v("SELECT detalhes FROM admin_log WHERE acao = 'excluir_usuario' ORDER BY id DESC LIMIT 1"), true);
checar('excluir_usuario com o apelido (sem maiúsculas nem espaços nas pontas) → 200; no registro só o motivo da lista', $r->status === 200
    && (int) v('SELECT COUNT(*) FROM usuarios WHERE id = ?', [$uidEx1]) === 0 && ($lx['motivo'] ?? '') === 'pedido_titular' && !str_contains(json_encode($lx), 'Embora'), json_encode($lx));
q("INSERT INTO bonus (usuario_id, valor, origem, ref, criado_em) VALUES (?, 2, 'admin', 'x', UTC_TIMESTAMP())", [$uidA]);
$bA = (int) v('SELECT MAX(id) FROM bonus');
$r = admPost(['acao' => 'tirar_bonus', 'bonusId' => $bA]);
checar('tirar_bonus sem motivo → 400 motivo (o bônus fica)', $r->status === 400 && $r->erro() === 'motivo' && (int) v('SELECT COUNT(*) FROM bonus WHERE id = ?', [$bA]) === 1, $r->resumo());
q("INSERT INTO indicacoes (indicador_id, indicado_id, criada_em, status) VALUES (?, NULL, UTC_TIMESTAMP(), 'pendente')", [$uidA]);
$iA = (int) v('SELECT MAX(id) FROM indicacoes');
$r = admPost(['acao' => 'recusar_indicacao', 'id' => $iA]);
checar('recusar_indicacao sem motivo → 400 motivo', $r->status === 400 && $r->erro() === 'motivo' && v('SELECT status FROM indicacoes WHERE id = ?', [$iA]) === 'pendente', $r->resumo());
$r = admPost(['acao' => 'recusar_indicacao', 'id' => $iA, 'motivo' => 'Mesma pessoa']);
checar('…com motivo → 200 e o motivo no registro', $r->status === 200 && str_contains((string) v("SELECT detalhes FROM admin_log WHERE acao = 'recusar_indicacao' ORDER BY id DESC LIMIT 1"), 'Mesma pessoa'), $r->resumo());

// ══ 4. sinais e lote (P0-3) ═════════════════════════════════════════════════════════════════════

secao('v3.2 · sinais automáticos nas filas e moderação em lote (P0-3)');
[$navB, $uidB] = novaConta('Dono Beta');
$pkBg = salvarPk($navB, $uidB, 'b-gols', ['gols' => 99999]);
$pkBr = salvarPk($navB, $uidB, 'b-rev', ['nota' => 93], false);
$pkBd = salvarPk($navB, $uidB, 'b-den', ['nota' => 60]);
$pkA2 = pkCarreira('a2', $uidA);
admPost(['acao' => 'ocultar_carreira', 'id' => $pkA2, 'motivo' => 'teste']);
q('UPDATE usuarios SET criado_em = UTC_TIMESTAMP() - INTERVAL 3 DAY WHERE id = ?', [$uidA]);
$dens = [];
for ($i = 0; $i < 3; $i++) {
    [, $uidD] = novaConta('Fiscal ' . $i);
    $dens[] = $uidD;
    q("INSERT INTO denuncias (carreira_pk, usuario_id, motivo, criada_em, status) VALUES (?, ?, 'trapaca', UTC_TIMESTAMP(), 'aberta')", [$pkBd, $uidD]);
}
// um denunciante em massa: 5 denúncias nas últimas 24 h
foreach ([$pkA1, $pkBg, $pkBr, $pkA3] as $pkX) {
    q("INSERT INTO denuncias (carreira_pk, usuario_id, motivo, criada_em, status) VALUES (?, ?, 'outro', UTC_TIMESTAMP(), 'aberta')", [$pkX, $dens[0]]);
}
admPost(['acao' => 'atualizar_hall']);
$H = hallAdminPorPk();
checar('sinal grave suspeita:gols com o texto', in_array('suspeita:gols', codigosSinais($H[$pkBg] ?? null), true)
    && in_array('Gols demais para as temporadas', array_column($H[$pkBg]['sinais'] ?? [], 'texto'), true) && ($H[$pkBg]['seguro'] ?? true) === false, json_encode($H[$pkBg] ?? null));
$sinRev = array_column($H[$pkBr]['sinais'] ?? [], 'nivel', 'codigo');
checar('revisão (nota 90+) é sinal leve; conta criada há menos de 24 h também', ($sinRev['suspeita:revisao'] ?? '') === 'leve' && ($sinRev['conta_nova'] ?? '') === 'leve', json_encode($sinRev));
checar('3 denúncias abertas de contas diferentes → muitas_denuncias (grave); trapaça sem suspeita → trapaca_plausivel (leve)',
    in_array('muitas_denuncias', codigosSinais($H[$pkBd] ?? null), true) && in_array('trapaca_plausivel', codigosSinais($H[$pkBd] ?? null), true), json_encode($H[$pkBd] ?? null));
checar('dono com outra carreira oculta → reincidente (grave); entre as 20 primeiras do Hall → topo_hall (grave)', in_array('reincidente', codigosSinais($H[$pkA3] ?? null), true)
    && in_array('topo_hall', codigosSinais($H[$pkA3] ?? null), true) && ($H[$pkA3]['seguro'] ?? true) === false, json_encode($H[$pkA3] ?? null));
$niveis = array_column($H[$pkBd]['sinais'] ?? [], 'nivel');
checar('os graves vêm primeiro', $niveis === array_merge(array_filter($niveis, static fn($n) => $n === 'grave'), array_values(array_filter($niveis, static fn($n) => $n !== 'grave'))), json_encode($niveis));
$r = admGet('r=denuncias');
$porDen = [];
foreach ($r->json['itens'] ?? [] as $d) {
    $porDen[$d['denunciante']['id'] ?? 0][] = $d;
}
checar('?r=denuncias: sinais e seguro por item; quem denunciou 5 em 24 h → denunciante_em_massa (leve)', $r->status === 200
    && in_array('denunciante_em_massa', codigosSinais($porDen[$dens[0]][0] ?? null), true) && !in_array('denunciante_em_massa', codigosSinais($porDen[$dens[1]][0] ?? null), true)
    && is_bool($porDen[$dens[1]][0]['seguro'] ?? null), $r->resumo());
// lote: entradas ruins
$ruins = [];
foreach ([['ids' => []], ['ids' => range(1, 101)], ['ids' => ['x']], ['ids' => 'abc'], ['ids' => [0]], ['ids' => ['a' => 1]], ['ids' => [1.5]]] as $c) {
    $r = admPost(['acao' => 'carreiras_lote', 'operacao' => 'ocultar', 'motivo' => 'x'] + $c);
    if ($r->status !== 400 || $r->erro() !== 'ids') {
        $ruins[] = json_encode($c) . " → $r->status " . $r->erro();
    }
}
checar('carreiras_lote com ids ruins (vazio, 101, texto, 0, objeto, decimal) → 400 ids', !$ruins, implode(', ', $ruins));
$r = admPost(['acao' => 'carreiras_lote', 'ids' => [$pkBd], 'operacao' => 'apagar', 'motivo' => 'x']);
checar('apagar não existe em lote → 400 operacao', $r->status === 400 && $r->erro() === 'operacao' && pkCarreira('b-den', $uidB) === $pkBd, $r->resumo());
$r = admPost(['acao' => 'carreiras_lote', 'ids' => [$pkBd], 'operacao' => 'ocultar']);
checar('ocultar em lote sem motivo → 400 motivo', $r->status === 400 && $r->erro() === 'motivo', $r->resumo());
$antesLog = (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'ocultar_carreira'");
$r = admPost(['acao' => 'carreiras_lote', 'ids' => [$pkBd, $pkA3, $pkA2, 999999, $pkBd], 'operacao' => 'ocultar', 'motivo' => 'Trapaça em série', 'avisar' => true, 'avisoMotivo' => 'trapaca']);
$pul = array_column($r->json['pulados'] ?? [], 'motivo', 'id');
checar('ocultar em lote → feitos (sem repetir), pulados já_estava e não_encontrada, denúncias fechadas', $r->status === 200
    && ($r->json['feitos'] ?? null) === [$pkBd, $pkA3] && ($pul[$pkA2] ?? '') === 'ja_estava' && ($pul[999999] ?? '') === 'nao_encontrada'
    && ($r->json['denunciasFechadas'] ?? 0) === 4, $r->resumo());
checar('…saíram do Hall na hora; motivo guardado em cada uma', (int) v('SELECT COUNT(*) FROM hall_foto WHERE carreira_pk IN (?, ?)', [$pkBd, $pkA3]) === 0
    && v('SELECT motivo_admin FROM carreiras WHERE id = ?', [$pkA3]) === 'Trapaça em série');
checar('…uma linha por carreira no registro (com lote: true) e o resumo carreiras_lote', (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'ocultar_carreira'") === $antesLog + 2
    && str_contains((string) v("SELECT detalhes FROM admin_log WHERE acao = 'ocultar_carreira' ORDER BY id DESC LIMIT 1"), '"lote":true')
    && (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'carreiras_lote'") === 1);
checar('avisar: o dono recebe o aviso padrão (H11) sem o motivo escrito pelo admin', str_contains((string) v('SELECT aviso_conta FROM usuarios WHERE id = ?', [$uidB]), 'números impossíveis')
    && !str_contains((string) v('SELECT aviso_conta FROM usuarios WHERE id = ?', [$uidB]), 'série'));
$r = admPost(['acao' => 'carreiras_lote', 'ids' => [$pkBd, $pkA3, $pkBg, $pkBr], 'operacao' => 'mostrar']);
checar('mostrar em lote (sem motivo): libera também as suspeitas', $r->status === 200 && count($r->json['feitos'] ?? []) === 4
    && (int) v('SELECT COUNT(*) FROM carreiras WHERE id IN (?, ?, ?, ?) AND (oculta <> 0 OR suspeita IS NOT NULL)', [$pkBd, $pkA3, $pkBg, $pkBr]) === 0, $r->resumo());
$r = admPost(['acao' => 'carreiras_lote', 'ids' => [$pkBd], 'operacao' => 'mostrar']);
checar('mostrar de novo → pulado já_estava', ($r->json['pulados'][0]['motivo'] ?? '') === 'ja_estava', $r->resumo());
// concorrência: dois lotes iguais ao mesmo tempo
$pksC = [];
[$navC, $uidC] = novaConta('Dono Gama');
for ($i = 0; $i < 10; $i++) {
    $pksC[] = salvarPk($navC, $uidC, "c-$i", ['nota' => 40 + $i]);
}
$res = paraleloAdm([['acao' => 'carreiras_lote', 'ids' => $pksC, 'operacao' => 'ocultar', 'motivo' => 'lote 1'],
    ['acao' => 'carreiras_lote', 'ids' => array_reverse($pksC), 'operacao' => 'ocultar', 'motivo' => 'lote 2']]);
$feitos = array_merge(...array_map(static fn($x) => $x[2]['feitos'] ?? [], array_values($res)));
$jaEst = array_merge(...array_map(static fn($x) => array_column($x[2]['pulados'] ?? [], 'id'), array_values($res)));
sort($feitos);
sort($jaEst);
$pksOrd = $pksC;
sort($pksOrd);
checar('2 lotes iguais ao mesmo tempo: cada carreira feita uma vez só (a outra vê "já estava"), sem erro', count(array_filter($res, static fn($x) => $x[0] === 200)) === 2
    && $feitos === $pksOrd && $jaEst === $pksOrd && (int) v('SELECT COUNT(*) FROM carreiras WHERE usuario_id = ? AND oculta = 1', [$uidC]) === 10, json_encode(array_map(static fn($x) => $x[0], $res)));
// resolver denúncias em lote
q("INSERT INTO denuncias (carreira_pk, usuario_id, motivo, criada_em, status) VALUES (?, ?, 'nome', UTC_TIMESTAMP(), 'aberta'), (?, ?, 'nome', UTC_TIMESTAMP(), 'aberta')",
    [$pksC[0], $dens[1], $pksC[1], $dens[1]]);
q('UPDATE carreiras SET oculta = 2 WHERE id IN (?, ?)', [$pksC[0], $pksC[1]]);
$r = admPost(['acao' => 'resolver_denuncias_lote', 'carreiras' => [$pksC[0], $pksC[1], $pksC[2]], 'resultado' => 'ocultar']);
checar('resolver_denuncias_lote ocultar sem motivo → 400 motivo', $r->status === 400 && $r->erro() === 'motivo', $r->resumo());
$r = admPost(['acao' => 'resolver_denuncias_lote', 'carreiras' => [$pksC[0], $pksC[1], $pksC[2]], 'resultado' => 'ok']);
checar('resolver_denuncias_lote ok → as escondidas pelas denúncias voltam; sem denúncia aberta → pulada (sem_abertas)', $r->status === 200
    && ($r->json['carreiras'] ?? null) === [$pksC[0], $pksC[1]] && ($r->json['denunciasFechadas'] ?? 0) === 2 && ($r->json['pulados'][0]['motivo'] ?? '') === 'sem_abertas'
    && (int) v('SELECT COUNT(*) FROM carreiras WHERE id IN (?, ?) AND oculta = 0', [$pksC[0], $pksC[1]]) === 2, $r->resumo());
$r = admPost(['acao' => 'resolver_denuncias_lote', 'carreiras' => [$pksC[0]], 'resultado' => 'talvez', 'motivo' => 'x']);
checar('resultado fora da lista → 400 resultado', $r->status === 400 && $r->erro() === 'resultado', $r->resumo());

// ══ 5. "Precisa de atenção" e pulso (P0-1, P0-2, P1-13, S17) ════════════════════════════════════

secao('v3.2 · "Precisa de atenção": regras, ordem, dispensa que volta quando a situação muda (P0-1, S17)');
limparV32();
$ADM = entrarAdmin();
[$navE, $uidE, , $vidE] = novaConta('Dono Delta');
$pkE1 = salvarPk($navE, $uidE, 'e1', ['nota' => 60]);
$pkE2 = salvarPk($navE, $uidE, 'e2', ['nota' => 61]);
$pkE3 = salvarPk($navE, $uidE, 'e3', ['gols' => 99999]);
admPost(['acao' => 'atualizar_hall']);
[, $uidF] = novaConta('Fiscal Velho');
q("INSERT INTO denuncias (carreira_pk, usuario_id, motivo, criada_em, status) VALUES (?, ?, 'nome', UTC_TIMESTAMP() - INTERVAL 3 DAY, 'aberta')", [$pkE1, $uidF]);
q('UPDATE carreiras SET oculta = 2 WHERE id = ?', [$pkE2]);
for ($i = 0; $i < 5; $i++) {
    q("INSERT INTO indicacoes (indicador_id, indicado_id, criada_em, status) VALUES (?, NULL, UTC_TIMESTAMP(), 'pendente')", [$uidE]);
}
for ($i = 0; $i < 3; $i++) {
    q("INSERT INTO indicacoes (indicador_id, indicado_id, criada_em, status, motivo) VALUES (?, NULL, UTC_TIMESTAMP(), 'recusada', 'mesmo_aparelho')", [$uidF]);
}
// 3 contas no mesmo aparelho, e uma indicou outra
$grupoM = [];
$vidM = uuid4();
foreach (['Irmão Um', 'Irmão Dois', 'Irmão Três'] as $ap) {
    [, $u] = novaConta($ap);
    $grupoM[] = $u;
    q("INSERT INTO visitas (sid, vid, usuario_id, inicio, ultimo, ativo_s, origem, bot) VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP() - INTERVAL 3 HOUR, 60, 'direto', 0)",
        [uuid4(), $vidM, $u]);
}
q("INSERT INTO indicacoes (indicador_id, indicado_id, criada_em, status) VALUES (?, ?, UTC_TIMESTAMP() - INTERVAL 2 DAY, 'valida')", [$grupoM[0], $grupoM[1]]);
[, $u4] = novaConta('Irmão Quatro'); // entra no mesmo aparelho mais adiante (o cadastro vai ser fechado)
[$navNaoTester] = novaConta('Não Tester');
q('UPDATE visitas SET ultimo = UTC_TIMESTAMP() - INTERVAL 3 HOUR'); // medição parada
encherLimite('painel-todos:todos', 31);
for ($i = 0; $i < 10; $i++) {
    q("INSERT INTO admin_log (em, acao, alvo, detalhes, quem) VALUES (UTC_TIMESTAMP(), 'dar_bonus', 'usuario:1', '{}', 'token')");
    q("INSERT INTO admin_log (em, acao, alvo, detalhes, quem) VALUES (UTC_TIMESTAMP(), 'excluir_usuario', 'usuario:1', '{}', 'a999')");
}
for ($i = 0; $i < 5; $i++) {
    q("INSERT INTO email_log (em, para_hash, para_mask, tipo, via, ok, detalhe) VALUES (UTC_TIMESTAMP(), ?, 'xx***@exemplo.com', 'esqueci', 'mail', 0, 'falhou')", [hash('sha256', "f$i")]);
}
admPost(['acao' => 'config', 'valores' => ['manutencao' => true, 'cadastro_aberto' => false, 'aviso' => ['texto' => 'Oi', 'tipo' => 'info']]]);
q("UPDATE site_config SET atualizado_em = UTC_TIMESTAMP() - INTERVAL 4 DAY WHERE chave = 'aviso'");
envelhecerFoto(200);
admGet('r=multicontas&atualizar=1');
$r = admGet('r=atencao&atualizar=1');
$A = array_column($r->json['alertas'] ?? [], null, 'chave');
$chaveSerie = (string) (array_values(array_filter(array_keys($A), static fn($k) => str_starts_with((string) $k, 'serie:')))[0] ?? '');
$chaveMulti = (string) (array_values(array_filter(array_keys($A), static fn($k) => str_starts_with((string) $k, 'multi:')))[0] ?? '');
$chaveAbuso = (string) (array_values(array_filter(array_keys($A), static fn($k) => str_starts_with((string) $k, 'abuso:')))[0] ?? '');
$esperado = ['denuncias_abertas' => 'grave', 'ocultas_denuncia' => 'grave', 'suspeitas' => 'acao', $chaveSerie => 'grave', 'mesmo_aparelho' => 'leve',
    $chaveMulti => 'grave', 'painel_tentativas' => 'grave', 'bonus_admin' => 'acao', $chaveAbuso => 'grave', 'hall_atrasado' => 'leve',
    'medicao_parada' => 'leve', 'manutencao' => 'acao', 'cadastro_fechado' => 'acao', 'aviso_velho' => 'leve', 'backup_velho' => 'leve', 'emails_falhando' => 'grave'];
$dif = [];
foreach ($esperado as $k => $nivel) {
    if (($A[$k]['nivel'] ?? '') !== $nivel) {
        $dif[] = "$k: " . ($A[$k]['nivel'] ?? 'ausente');
    }
}
checar('as ' . count($esperado) . ' regras disparam com o nível certo (inclusive a denúncia de 3 dias = grave e o abuso interno, S17)', $r->status === 200 && !$dif
    && $chaveSerie !== '' && $chaveMulti !== '' && $chaveAbuso !== '', implode('; ', $dif) . ' | ' . implode(',', array_keys($A)));
$niv = array_column($r->json['alertas'] ?? [], 'nivel');
$ordem = ['grave' => 0, 'acao' => 1, 'leve' => 2];
$ordenado = $niv;
usort($ordenado, static fn($a, $b) => $ordem[$a] <=> $ordem[$b]);
checar('graves primeiro, depois ação, depois leves', $niv === $ordenado, json_encode($niv));
$camposOk = true;
foreach ($r->json['alertas'] ?? [] as $al) {
    $k = array_keys($al);
    sort($k);
    $camposOk = $camposOk && $k === ['chave', 'desde', 'dispensavel', 'link', 'n', 'nivel', 'texto'] && is_string($al['link']['aba'] ?? null)
        && preg_match('/^[a-z_]{2,20}(:[0-9a-f]{8,40})?$/', $al['chave']) === 1;
}
checar('cada alerta: {chave, nivel, texto, n, desde, link: {aba, …}, dispensavel}', $camposOk && preg_match($RE_ISO, (string) ($r->json['geradoEm'] ?? '')) === 1);
checar('textos certos ("1 denúncia aberta (a mais antiga há 3 dias)", "@Dono Delta indicou 5 contas em 24 h", "3 contas no mesmo aparelho … que se indicaram")',
    ($A['denuncias_abertas']['texto'] ?? '') === '1 denúncia aberta (a mais antiga há 3 dias)' && ($A[$chaveSerie]['texto'] ?? '') === '@Dono Delta indicou 5 contas em 24 h'
    && str_starts_with((string) ($A[$chaveMulti]['texto'] ?? ''), '3 contas no mesmo aparelho (@Irmão Um') && str_ends_with((string) ($A[$chaveMulti]['texto'] ?? ''), 'que se indicaram')
    && ($A[$chaveSerie]['link'] ?? null) === ['aba' => 'indicacoes', 'filtro' => 'indicador', 'id' => $uidE], json_encode([$A['denuncias_abertas'] ?? null, $A[$chaveSerie] ?? null]));
checar('dispensáveis: só as séries, os grupos de aparelho e o abuso interno', ($A[$chaveSerie]['dispensavel'] ?? false) === true && ($A[$chaveMulti]['dispensavel'] ?? false) === true
    && ($A['denuncias_abertas']['dispensavel'] ?? true) === false && ($A['manutencao']['dispensavel'] ?? true) === false);
$ger1 = $r->json['geradoEm'] ?? '';
$r = admGet('r=atencao');
checar('cache de 60 s: sem atualizar=1 vem o mesmo cálculo', ($r->json['geradoEm'] ?? '') === $ger1 && (int) v("SELECT COUNT(*) FROM site_config WHERE chave = '_atencao'") === 1, $r->resumo());
// dispensar
foreach ([['chave' => 'X'], ['chave' => 'suspeitas:zz'], ['chave' => 123], [], ['chave' => 'nao_existe']] as $c) {
    $r = admPost(['acao' => 'alerta_dispensar'] + $c);
    checar('alerta_dispensar ' . json_encode($c) . ' → 400 chave', $r->status === 400 && $r->erro() === 'chave', $r->resumo());
}
$r = admPost(['acao' => 'alerta_dispensar', 'chave' => 'manutencao']);
checar('alerta que não é dispensável → 400 nao_dispensavel', $r->status === 400 && $r->erro() === 'nao_dispensavel', $r->resumo());
$r = admPost(['acao' => 'alerta_dispensar', 'chave' => $chaveSerie]);
checar('dispensar a série → 200', $r->status === 200 && ($r->json['ok'] ?? false) === true, $r->resumo());
$r = admGet('r=atencao');
$D = array_column($r->json['dispensados'] ?? [], null, 'chave');
checar('…some dos alertas e aparece em dispensados {chave, texto, em, por}', !in_array($chaveSerie, array_column($r->json['alertas'] ?? [], 'chave'), true)
    && isset($D[$chaveSerie]) && preg_match($RE_ISO, (string) ($D[$chaveSerie]['em'] ?? '')) === 1 && is_string($D[$chaveSerie]['por'] ?? null)
    && str_contains((string) ($D[$chaveSerie]['texto'] ?? ''), 'indicou'), $r->resumo());
checar('…no registro sem o texto (pode ter apelido)', (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'alerta_dispensar' AND detalhes NOT LIKE '%Delta%'") === 1
    && !str_contains((string) v("SELECT valor FROM site_config WHERE chave = '_alertas_lidos'"), 'Delta'));
$P = $ADM->pedir('GET', '/api/painel.php?so=agora');
$gravesAtivos = count(array_filter($r->json['alertas'] ?? [], static fn($a) => $a['nivel'] === 'grave'));
checar('pulso: alertas {grave, acao} do último cálculo, sem os dispensados', ($P->json['agora']['alertas']['grave'] ?? -1) === $gravesAtivos
    && ($P->json['agora']['alertas']['acao'] ?? -1) === count(array_filter($r->json['alertas'] ?? [], static fn($a) => $a['nivel'] === 'acao')), $P->resumo());
// dois "está tudo certo" ao mesmo tempo
$res = paraleloAdm([['acao' => 'alerta_dispensar', 'chave' => $chaveMulti], ['acao' => 'alerta_dispensar', 'chave' => $chaveAbuso]]);
$lidos = json_decode((string) v("SELECT valor FROM site_config WHERE chave = '_alertas_lidos'"), true);
checar('duas dispensas ao mesmo tempo: as duas ficam (nenhuma se perde)', count(array_filter($res, static fn($x) => $x[0] === 200)) === 2
    && isset($lidos[$chaveMulti], $lidos[$chaveAbuso], $lidos[$chaveSerie]), json_encode(array_keys((array) $lidos)));
// conta nova no mesmo aparelho: a chave do grupo muda e o aviso volta
q("INSERT INTO visitas (sid, vid, usuario_id, inicio, ultimo, ativo_s, origem, bot) VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), 60, 'direto', 0)", [uuid4(), $vidM, $u4]);
admGet('r=multicontas&atualizar=1');
$r = admGet('r=atencao&atualizar=1');
$multiNovo = array_values(array_filter(array_column($r->json['alertas'] ?? [], 'chave'), static fn($k) => str_starts_with((string) $k, 'multi:')));
checar('conta nova no mesmo aparelho → chave nova → o aviso volta ("4 contas no mesmo aparelho")', count($multiNovo) === 1 && $multiNovo[0] !== $chaveMulti
    && str_starts_with((string) (array_column($r->json['alertas'], 'texto', 'chave')[$multiNovo[0]] ?? ''), '4 contas'), $r->resumo());
checar('…e a medição voltou (visita agora): medicao_parada some', !in_array('medicao_parada', array_column($r->json['alertas'] ?? [], 'chave'), true));
$r = admPost(['acao' => 'alerta_reabrir', 'chave' => $chaveSerie]);
$r2 = admGet('r=atencao');
checar('alerta_reabrir → volta para os alertas', $r->status === 200 && in_array($chaveSerie, array_column($r2->json['alertas'] ?? [], 'chave'), true), $r2->resumo());
$r = admPost(['acao' => 'alerta_reabrir', 'chave' => $chaveSerie]);
checar('reabrir de novo (idempotente) → 200', $r->status === 200, $r->resumo());
checar('qualquer outra escrita do admin apaga o cache dos alertas', (static function (): bool {
    admPost(['acao' => 'nota', 'id' => $GLOBALS['uidE'], 'texto' => 'oi']);
    return (int) v("SELECT COUNT(*) FROM site_config WHERE chave = '_atencao'") === 0;
})());
// no máximo 500 dispensas guardadas
$muitos = [];
for ($i = 0; $i < 600; $i++) {
    $muitos['serie:' . sha1("velha$i")] = ['em' => gmdate('Y-m-d\TH:i:s\Z', time() - 86400 - $i), 'por' => 'x'];
}
q("UPDATE site_config SET valor = ? WHERE chave = '_alertas_lidos'", [json_encode($muitos)]);
admGet('r=atencao&atualizar=1');
$r = admPost(['acao' => 'alerta_dispensar', 'chave' => $chaveSerie]);
$lidos = json_decode((string) v("SELECT valor FROM site_config WHERE chave = '_alertas_lidos'"), true);
checar('no máximo 500 dispensas guardadas (saem as mais antigas; a nova fica)', $r->status === 200 && count($lidos) === 500 && isset($lidos[$chaveSerie])
    && !isset($lidos['serie:' . sha1('velha599')]), (string) count((array) $lidos));
q("DELETE FROM site_config WHERE chave = '_alertas_lidos'");

secao('v3.2 · pulso do painel: números de ação, filas e alertas (P0-2, P1-13)');
$r = $ADM->pedir('GET', '/api/painel.php?so=agora');
$ac = $r->json['agora']['acao'] ?? [];
checar('?so=agora → acao {denunciasAbertas, ocultasPorDenuncia, suspeitas, indicacoesPendentes, contasHoje} batendo com o banco', $r->status === 200
    && ($ac['denunciasAbertas'] ?? -1) === (int) v("SELECT COUNT(*) FROM denuncias WHERE status = 'aberta'")
    && ($ac['ocultasPorDenuncia'] ?? -1) === 1 && ($ac['suspeitas'] ?? -1) === (int) v('SELECT COUNT(*) FROM carreiras WHERE suspeita IS NOT NULL AND oculta = 0')
    && ($ac['indicacoesPendentes'] ?? -1) === (int) v("SELECT COUNT(*) FROM indicacoes WHERE status = 'pendente'")
    && ($ac['contasHoje'] ?? -1) === (int) v('SELECT COUNT(*) FROM usuarios WHERE criado_em >= ?', [gmdate('Y-m-d H:i:s', (int) strtotime(gmdate('Y-m-d', time() - 10800) . ' 00:00:00 UTC') + 10800)]),
    $r->resumo());
$f1 = $r->json['agora']['filas'] ?? [];
checar('filas: md5 das 3 filas', preg_match($RE_MD5, (string) ($f1['denuncias'] ?? '')) === 1 && preg_match($RE_MD5, (string) ($f1['suspeitas'] ?? '')) === 1
    && preg_match($RE_MD5, (string) ($f1['indicacoes'] ?? '')) === 1, json_encode($f1));
q("INSERT INTO denuncias (carreira_pk, usuario_id, motivo, criada_em, status) VALUES (?, ?, 'outro', UTC_TIMESTAMP(), 'aberta')", [$pkE3, $uidF]);
$f2 = $ADM->pedir('GET', '/api/painel.php?so=agora')->json['agora']['filas'] ?? [];
checar('denúncia nova numa carreira → o hash da fila de denúncias muda (o resto não)', ($f2['denuncias'] ?? '') !== ($f1['denuncias'] ?? '')
    && ($f2['indicacoes'] ?? '') === ($f1['indicacoes'] ?? ''));
q("UPDATE site_config SET valor = JSON_SET(valor, '$.em', ?) WHERE chave = '_atencao'", [time() - 400]);
admGet('r=atencao'); // recalcula (venceu)
q("UPDATE site_config SET valor = JSON_SET(valor, '$.em', ?) WHERE chave = '_atencao'", [time() - 400]);
$r = $ADM->pedir('GET', '/api/painel.php?so=agora');
checar('cálculo dos alertas com mais de 5 min → alertas: null (o pulso nunca recalcula)', nulo($r->json['agora'] ?? null, 'alertas'),
    $r->resumo());
admPost(['acao' => 'config', 'valores' => ['manutencao' => false, 'cadastro_aberto' => true, 'aviso' => null]]);

// ══ 6. Na área (P1-4) ═══════════════════════════════════════════════════════════════════════════

secao('v3.2 · Na área: a tela (view.rota) e o modo do batimento (hb.m) no e.php; ?r=agora (P1-4, X9)');
q('UPDATE visitas SET ultimo = UTC_TIMESTAMP() - INTERVAL 1 HOUR'); // ninguém "na área" agora (as visitas ficam para os blocos seguintes)
$sidE = uuid4();
$r = medir($navE, $vidE, $sidE, [['t' => 'view', 'd' => ['rota' => '/hall']], ['t' => 'hb', 'p' => 1, 'm' => 'classico']], ctx());
$vE = visita($sidE);
checar('view com rota e hb com modo → visitas.rota e modo_atual (sessão nova)', $r->status === 204 && ($vE['rota'] ?? '') === '/hall' && ($vE['modo_atual'] ?? '') === 'classico'
    && (int) ($vE['usuario_id'] ?? 0) === $uidE, json_encode($vE));
q('UPDATE visitas SET ultimo = UTC_TIMESTAMP() - INTERVAL 20 SECOND WHERE sid = ?', [$sidE]);
medir($navE, $vidE, $sidE, [['t' => 'hb', 'p' => 1, 'm' => 'imersivo'], ['t' => 'view', 'd' => ['rota' => '/carreira']]]);
$vE = visita($sidE);
checar('batimento jogando → jogando_s soma (15 s); o modo e a tela mudam', (int) $vE['jogando_s'] === 15 && (int) $vE['ativo_s'] === 15 && $vE['modo_atual'] === 'imersivo'
    && $vE['rota'] === '/carreira', json_encode($vE));
q('UPDATE visitas SET ultimo = UTC_TIMESTAMP() - INTERVAL 20 SECOND WHERE sid = ?', [$sidE]);
medir($navE, $vidE, $sidE, [['t' => 'hb', 'p' => 0, 'm' => 'xyz'], ['t' => 'view', 'd' => ['rota' => '/Hall']], ['t' => 'view', 'd' => ['rota' => str_repeat('a', 30)]],
    ['t' => 'view', 'd' => ['rota' => 'hall']], ['t' => 'view', 'd' => ['rota' => 5]]]);
$vE = visita($sidE);
checar('modo desconhecido e rotas fora do formato (maiúscula, longa, sem barra, número) são ignorados; parado não soma jogando_s', $vE['modo_atual'] === 'imersivo'
    && $vE['rota'] === '/carreira' && (int) $vE['jogando_s'] === 15 && (int) $vE['ativo_s'] === 30, json_encode($vE));
$sidAnon = uuid4();
medir($anon, uuid4(), $sidAnon, [['t' => 'view', 'd' => ['rota' => '/resumo/abc']], ['t' => 'hb', 'p' => 0]], ctx());
medir($anon, uuid4(), uuid4(), [['t' => 'view', 'd' => ['rota' => '/']]], ctx(), 1);
$r = admGet('r=agora');
$porSessao = array_column($r->json['itens'] ?? [], null, 'sessao');
$iE = $porSessao[substr($sidE, 0, 8)] ?? [];
checar('?r=agora: {total, comConta, jogando, itens}; a conta primeiro, com onde/modo/jogando/aparelho/origem; sem robô; nunca IP', $r->status === 200
    && ($r->json['total'] ?? 0) === 2 && ($r->json['comConta'] ?? 0) === 1 && ($r->json['jogando'] ?? -1) === 1
    && ($r->json['itens'][0]['sessao'] ?? '') === substr($sidE, 0, 8) && ($iE['conta']['id'] ?? 0) === $uidE && ($iE['onde'] ?? '') === 'Clássico'
    && ($iE['modo'] ?? '') === 'imersivo' && ($iE['jogando'] ?? false) === true && ($iE['aparelho'] ?? '') === 'mobile'
    && ($porSessao[substr($sidAnon, 0, 8)]['onde'] ?? '') === 'Resumo de carreira' && nulo($porSessao[substr($sidAnon, 0, 8)] ?? null, 'conta')
    && !str_contains($r->corpo, '127.0.0.1'), $r->resumo());
checar('?r=agora&bots=1 inclui o robô', (admGet('r=agora&bots=1')->json['total'] ?? 0) === 3);

// ══ 7. anotação, tipo, tirar do Hall, aviso, tempo e acesso na ficha ════════════════════════════

secao('v3.2 · anotação interna (P1-5)');
$r = admPost(['acao' => 'nota', 'id' => $uidE, 'texto' => "  Pediu ajuda pelo TikTok\r\n\r\nlinha 2  com   espaço\x07\n\n"]);
checar('nota → 200 {nota: {texto, em, por, porNome}}; quebras de linha ficam, controle sai, espaços juntados', $r->status === 200
    && ($r->json['nota']['texto'] ?? '') === "Pediu ajuda pelo TikTok\n\nlinha 2 com espaço" && preg_match($RE_ISO, (string) ($r->json['nota']['em'] ?? '')) === 1
    && is_string($r->json['nota']['por'] ?? null), $r->resumo());
$r = admPost(['acao' => 'nota', 'id' => $uidE, 'texto' => implode("\n", range(1, 11))]);
checar('11 linhas → 400 texto', $r->status === 400 && $r->erro() === 'texto', $r->resumo());
$r = admPost(['acao' => 'nota', 'id' => $uidE, 'texto' => str_repeat('é', 501)]);
checar('501 caracteres → 400 texto', $r->status === 400 && $r->erro() === 'texto', $r->resumo());
$r = admPost(['acao' => 'nota', 'id' => $uidE, 'texto' => ['x']]);
checar('texto que não é texto → 400 texto', $r->status === 400 && $r->erro() === 'texto', $r->resumo());
$r = admPost(['acao' => 'nota', 'id' => $uidE, 'texto' => str_repeat('é', 500)]);
checar('500 caracteres → 200', $r->status === 200, $r->resumo());
$U = admGet('r=usuario&id=' . $uidE)->json['usuario'] ?? [];
$L = array_column(admGet('r=usuarios')->json['itens'] ?? [], null, 'id');
checar('?r=usuario.notaAdmin e ?r=usuarios.temNota; filtro nota=1', mb_strlen((string) ($U['notaAdmin']['texto'] ?? '')) === 500 && ($L[$uidE]['temNota'] ?? false) === true
    && ($L[$uidF]['temNota'] ?? true) === false && array_column(admGet('r=usuarios&nota=1')->json['itens'] ?? [], 'id') === [$uidE]);
$lgN = q("SELECT acao, detalhes FROM admin_log WHERE acao IN ('nota', 'nota_apagada') AND alvo = ? ORDER BY id", ['usuario:' . $uidE]);
checar('no registro só o tamanho (o texto pode ter dado pessoal)', count($lgN) >= 2 && !str_contains(json_encode($lgN), 'TikTok') && str_contains((string) end($lgN)['detalhes'], '"tamanho":500'));
$r = admPost(['acao' => 'nota', 'id' => $uidE, 'texto' => "  \n "]);
checar('vazia apaga → {nota: null}; registro nota_apagada', $r->status === 200 && nulo($r->json, 'nota') && v('SELECT nota_admin FROM usuarios WHERE id = ?', [$uidE]) === null
    && (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'nota_apagada'") === 1, $r->resumo());
$r = admPost(['acao' => 'nota', 'id' => 999999, 'texto' => 'x']);
checar('conta que não existe → 404', $r->status === 404, $r->resumo());

secao('v3.2 · tipo de conta e testers (P1-6)');
foreach ([['tipo' => 'admin'], ['tipo' => ''], ['tipo' => 1], []] as $c) {
    $r = admPost(['acao' => 'mudar_tipo', 'id' => $uidE] + $c);
    checar('mudar_tipo ' . json_encode($c) . ' → 400 tipo', $r->status === 400 && $r->erro() === 'tipo', $r->resumo());
}
$r = admPost(['acao' => 'mudar_tipo', 'id' => $uidE, 'tipo' => 'tester', 'motivo' => 'Testa o Imersivo']);
checar('mudar_tipo tester → {ok, tipo, antes}; tipo_em gravado; registro de → para', $r->status === 200 && ($r->json['tipo'] ?? '') === 'tester' && ($r->json['antes'] ?? '') === 'jogador'
    && v('SELECT tipo_em FROM usuarios WHERE id = ?', [$uidE]) !== null && str_contains((string) v("SELECT detalhes FROM admin_log WHERE acao = 'mudar_tipo' ORDER BY id DESC LIMIT 1"), '"para":"tester"'), $r->resumo());
$r = $navE->pedir('GET', '/api/conta.php');
checar('conta.php: U.tester = true (o jogo abre o Imersivo e a Live com o selo "Teste")', ($r->json['usuario']['tester'] ?? false) === true, $r->resumo());
checar('…e false para quem não é tester', ($navNaoTester->pedir('GET', '/api/conta.php')->json['usuario']['tester'] ?? true) === false);
$r = admGet('r=usuarios&tipo=tester');
checar('?r=usuarios&tipo=tester e o tipo no item; contagens por tipo', array_column($r->json['itens'] ?? [], 'id') === [$uidE] && ($r->json['itens'][0]['tipo'] ?? '') === 'tester'
    && ($r->json['contagens']['tipo']['tester'] ?? 0) === 1, $r->resumo());
checar('…e tipoEm no item (a coluna "Desde" da lista Testers)', preg_match($RE_ISO, (string) ($r->json['itens'][0]['tipoEm'] ?? '')) === 1, $r->resumo());
checar('?r=resumo.usuarios.porTipo', (admGet('r=resumo')->json['usuarios']['porTipo']['tester'] ?? 0) === 1);
// números do painel sem as contas de teste/oficiais
[$navT, $uidT, , $vidT] = novaConta('Conta Teste');
admPost(['acao' => 'mudar_tipo', 'id' => $uidT, 'tipo' => 'teste']);
$hojeP = gmdate('Y-m-d', time() - 10800);
$p0a = (int) ($ADM->pedir('GET', "/api/painel.php?de=$hojeP&ate=$hojeP")->json['periodo']['visitantes'] ?? -1);
$p1a = (int) ($ADM->pedir('GET', "/api/painel.php?de=$hojeP&ate=$hojeP&bots=1")->json['periodo']['visitantes'] ?? -1);
medir($navT, $vidT, uuid4(), [['t' => 'view']], ctx());
$p0 = $ADM->pedir('GET', "/api/painel.php?de=$hojeP&ate=$hojeP");
$p1 = $ADM->pedir('GET', "/api/painel.php?de=$hojeP&ate=$hojeP&bots=1");
checar('painel: sem "incluir robôs/testes", a visita da conta teste fica de fora; com, entra', ($p0->json['periodo']['visitantes'] ?? 0) === $p0a
    && ($p1->json['periodo']['visitantes'] ?? 0) === $p1a + 1, "$p0a/$p1a → " . $p0->resumo());

secao('v3.2 · tirar do Hall sem suspender (P1-7) e estado da carreira no Hall (X2)');
[$navH, $uidH] = novaConta('Dono Épsilon');
foreach (['h1' => 70, 'h2' => 71, 'h3' => 72, 'h4' => 50] as $id => $nota) {
    salvarC($navH, hallEntry($id, ['nota' => $nota]));
}
$pkH4 = pkCarreira('h4', $uidH);
salvarC($navH, hallEntry('h-rev', ['nota' => 95]), 'manual', false);
salvarC($navH, hallEntry('h-gols', ['gols' => 99999]));
salvarC($navH, hallEntry('h-nome', ['jogador' => 'Merda']));
salvarC($navH, hallEntry('h-imersivo', ['nota' => 99, 'modo' => 'immersive']));
salvarC($navH, hallEntry('h-velha', ['nota' => 80, 'v' => 1]));
salvarC($navH, hallEntry('h-oculta', ['nota' => 30]));
admPost(['acao' => 'ocultar_carreira', 'id' => pkCarreira('h-oculta', $uidH), 'motivo' => 'Segredo do admin']);
admPost(['acao' => 'atualizar_hall']);
$C = array_column($navH->pedir('GET', '/api/carreiras.php')->json['carreiras'] ?? [], 'hall', 'id');
checar('GET carreiras.php: hall {estado, motivo?} de cada carreira (no_hall, revisao, suspeita, oculta, fora)', ($C['h1']['estado'] ?? '') === 'no_hall'
    && !isset($C['h1']['motivo']) && ($C['h-rev'] ?? null) === ['estado' => 'revisao', 'motivo' => 'Em revisão: entra no Hall assim que for conferida.']
    && ($C['h-gols']['estado'] ?? '') === 'suspeita' && ($C['h-nome']['motivo'] ?? '') === 'Um nome ou texto desta carreira não é permitido no Hall.'
    && ($C['h-oculta'] ?? null) === ['estado' => 'oculta', 'motivo' => 'A moderação tirou esta carreira do Hall público.']
    && ($C['h-imersivo']['estado'] ?? '') === 'fora' && str_contains((string) ($C['h-imersivo']['motivo'] ?? ''), 'Imersivo')
    && ($C['h-imersivo']['porque'] ?? '') === 'imersivo' && ($C['h-velha']['porque'] ?? '') === 'versao'
    && ($C['h-velha']['motivo'] ?? '') === 'A nota desta carreira é de uma versão antiga do jogo.'
    && ($C['h4'] ?? null) === ['estado' => 'fora', 'porque' => 'limite', 'motivo' => 'Só as 3 melhores carreiras de cada conta entram no Hall.'], json_encode($C, JSON_UNESCAPED_UNICODE));
$motivosX2 = json_encode(array_values(array_filter(array_column($C, 'motivo'))), JSON_UNESCAPED_UNICODE);
checar('…o motivo nunca mostra o que o admin escreveu nem o que a conferência olhou', !str_contains($motivosX2, 'Segredo') && !str_contains($motivosX2, 'gols')
    && !str_contains($motivosX2, 'nota 9'), $motivosX2);
$r = admPost(['acao' => 'bloquear_hall', 'id' => $uidH, 'sim' => true]);
checar('bloquear_hall sem motivo → 400 motivo', $r->status === 400 && $r->erro() === 'motivo', $r->resumo());
$r = admPost(['acao' => 'bloquear_hall', 'id' => $uidH, 'sim' => 'sim', 'motivo' => 'x']);
checar('sim que não é booleano → 400', $r->status === 400, $r->resumo());
$r = admPost(['acao' => 'bloquear_hall', 'id' => $uidH, 'sim' => true, 'motivo' => 'Apelido ofensivo em todas']);
checar('bloquear_hall → {ok, hallBloqueado: true}; sai da fotografia na hora; hall.php?id 404', $r->status === 200 && ($r->json['hallBloqueado'] ?? false) === true
    && (int) v('SELECT COUNT(*) FROM hall_foto WHERE usuario_id = ?', [$uidH]) === 0 && hallGet('id=h1')->status === 404, $r->resumo());
admPost(['acao' => 'atualizar_hall']);
checar('…a fotografia nova não a põe de volta', (int) v('SELECT COUNT(*) FROM hall_foto WHERE usuario_id = ?', [$uidH]) === 0);
$r = $navH->pedir('POST', '/api/carreiras.php', ['acao' => 'publicar', 'id' => 'h4', 'sim' => true]);
checar('publicar com a conta bloqueada → 403 hall_bloqueado', $r->status === 403 && $r->erro() === 'hall_bloqueado', $r->resumo());
$r = $navH->pedir('POST', '/api/carreiras.php', ['acao' => 'publicar', 'id' => 'h1', 'sim' => false]);
checar('…tirar do Hall continua podendo', $r->status === 200, $r->resumo());
$navH->pedir('POST', '/api/conta.php', ['acao' => 'perfil', 'hallPublico' => 'auto']); // volta ao automático para o resto
$C = array_column($navH->pedir('GET', '/api/carreiras.php')->json['carreiras'] ?? [], null, 'id');
checar('C.noHall false e hall = fora ("Sua conta não pode publicar no Hall público.")', ($C['h2']['noHall'] ?? true) === false
    && ($C['h2']['hall'] ?? null) === ['estado' => 'fora', 'porque' => 'bloqueada', 'motivo' => 'Sua conta não pode publicar no Hall público.'], json_encode($C['h2'] ?? null));
checar('?r=usuarios: hallBloqueado e filtro hall=bloqueado', array_column(admGet('r=usuarios&hall=bloqueado')->json['itens'] ?? [], 'id') === [$uidH]);
$r = admPost(['acao' => 'bloquear_hall', 'id' => $uidH, 'sim' => false]);
admPost(['acao' => 'atualizar_hall']);
checar('devolver (sim false, sem motivo) → volta na próxima fotografia', $r->status === 200 && ($r->json['hallBloqueado'] ?? true) === false
    && (int) v('SELECT COUNT(*) FROM hall_foto WHERE usuario_id = ?', [$uidH]) >= 2, $r->resumo());
$r = $navH->pedir('POST', '/api/conta.php', ['acao' => 'perfil', 'hallPublico' => 'nao']);
$C = array_column($navH->pedir('GET', '/api/carreiras.php')->json['carreiras'] ?? [], 'hall', 'id');
checar('"não aparecer" → privada', ($C['h2'] ?? null) === ['estado' => 'privada', 'motivo' => 'Você escolheu não aparecer no Hall público.'], json_encode($C['h2'] ?? null));
$navH->pedir('POST', '/api/conta.php', ['acao' => 'perfil', 'hallPublico' => 'auto']);
$r = salvarC($navH, hallEntry('h5', ['nota' => 20]));
checar('o C do salvar também traz o hall', is_array($r->json['carreira']['hall'] ?? null), $r->resumo());

secao('v3.2 · avisar o autor da decisão (H11)');
$r = admPost(['acao' => 'ocultar_carreira', 'id' => pkCarreira('h2', $uidH), 'motivo' => 'Nome', 'avisar' => true, 'avisoMotivo' => 'xyz']);
checar('avisoMotivo fora da lista → 400 aviso (e nada muda)', $r->status === 400 && $r->erro() === 'aviso' && (int) v('SELECT oculta FROM carreiras WHERE id = ?', [pkCarreira('h2', $uidH)]) === 0, $r->resumo());
$r = admPost(['acao' => 'ocultar_carreira', 'id' => pkCarreira('h2', $uidH), 'motivo' => 'Palavrão escondido no título', 'avisar' => true, 'avisoMotivo' => 'nome']);
$U = $navH->pedir('GET', '/api/conta.php')->json['usuario'] ?? [];
checar('ocultar com avisar → U.aviso {texto padrão, em} (sem o motivo escrito pelo admin)', $r->status === 200
    && str_starts_with((string) ($U['aviso']['texto'] ?? ''), 'Uma carreira sua (') && str_contains((string) ($U['aviso']['texto'] ?? ''), 'nome ofensivo')
    && !str_contains((string) ($U['aviso']['texto'] ?? ''), 'Palavrão') && preg_match($RE_ISO, (string) ($U['aviso']['em'] ?? '')) === 1, json_encode($U['aviso'] ?? null));
checar('…a ficha do admin mostra o aviso pendente', is_array(admGet('r=usuario&id=' . $uidH)->json['usuario']['avisoPendente'] ?? null));
$r = $navH->pedir('POST', '/api/conta.php', ['acao' => 'aviso_lido']);
checar('aviso_lido → some (mostrado uma vez)', $r->status === 200 && nulo($navH->pedir('GET', '/api/conta.php')->json['usuario'] ?? [], 'aviso'), $r->resumo());
checar('aviso_lido sem conta → 401', $anon->pedir('POST', '/api/conta.php', ['acao' => 'aviso_lido'])->status === 401);

secao('v3.2 · ficha: tempo (U9), "por que não entra?" (U15) e mesmo aparelho (P1-9)');
$seg = (int) strtotime('monday this week', time() - 10800) + 10800;
if ($seg > time()) {
    $seg -= 7 * 86400;
}
q("INSERT INTO visitas (sid, vid, usuario_id, inicio, ultimo, ativo_s, jogando_s, modo_atual, origem, bot) VALUES
    (?, ?, ?, ?, ?, 600, 500, 'classico', 'direto', 0), (?, ?, ?, ?, ?, 300, 100, 'imersivo', 'direto', 0), (?, ?, ?, ?, ?, 1000, 0, NULL, 'direto', 0)",
    [uuid4(), uuid4(), $uidH, gmdate('Y-m-d H:i:s', $seg + 60), gmdate('Y-m-d H:i:s', $seg + 120), uuid4(), uuid4(), $uidH, gmdate('Y-m-d H:i:s', $seg - 3 * 86400),
        gmdate('Y-m-d H:i:s', $seg - 3 * 86400 + 60), uuid4(), uuid4(), $uidH, gmdate('Y-m-d H:i:s', $seg - 30 * 86400), gmdate('Y-m-d H:i:s', $seg - 30 * 86400 + 60)]);
$emailH = (string) v('SELECT email FROM usuarios WHERE id = ?', [$uidH]);
resetarLimitesCurtos();
conta(novoNav(), ['acao' => 'entrar', 'email' => $emailH, 'senha' => 'errada-1']);
conta(novoNav(), ['acao' => 'entrar', 'email' => $emailH, 'senha' => 'errada-2']);
conta(novoNav(), ['acao' => 'esqueci', 'email' => $emailH]);
$U = admGet('r=usuario&id=' . $uidH)->json['usuario'] ?? [];
checar('tempo {semana, semanaPassada, total, porModo} (segundos; semana desde segunda em Brasília)', ($U['tempo']['semana'] ?? -1) === 600
    && ($U['tempo']['semanaPassada'] ?? -1) === 300 && ($U['tempo']['total'] ?? -1) === 1900 && ($U['tempo']['porModo']['classico'] ?? -1) === 500
    && ($U['tempo']['porModo']['imersivo'] ?? -1) === 100, json_encode($U['tempo'] ?? null));
checar('acesso {status, sessoes, ultimoLogin, bloqueioEntrar {tentativas, limite, bloqueado}, redefinicaoPendente} (sem pedir senha)',
    ($U['acesso']['status'] ?? '') === 'ativo' && ($U['acesso']['bloqueioEntrar']['tentativas'] ?? 0) === 2 && ($U['acesso']['bloqueioEntrar']['bloqueado'] ?? true) === false
    && preg_match($RE_ISO, (string) ($U['acesso']['redefinicaoPendente']['expiraEm'] ?? '')) === 1 && is_int($U['acesso']['sessoes'] ?? null), json_encode($U['acesso'] ?? null));
$U = admGet('r=usuario&id=' . $grupoM[0])->json['usuario'] ?? [];
checar('mesmoAparelho: as outras contas do mesmo aparelho', array_column($U['mesmoAparelho'] ?? [], 'id') === [$grupoM[1], $grupoM[2], $u4], json_encode($U['mesmoAparelho'] ?? null));

// ══ 8. lixeira (P1-8) ═══════════════════════════════════════════════════════════════════════════

secao('v3.2 · lixeira das carreiras apagadas e bloqueio do reenvio (P1-8)');
[$navL, $uidL] = novaConta('Dono Zeta');
$hL = hallEntry('l1', ['nota' => 77]);
salvarC($navL, $hL);
$pkL = pkCarreira('l1', $uidL);
q("INSERT INTO denuncias (carreira_pk, usuario_id, motivo, criada_em, status) VALUES (?, ?, 'nome', UTC_TIMESTAMP(), 'aberta')", [$pkL, $uidF]);
$r = admPost(['acao' => 'apagar_carreira', 'id' => $pkL, 'motivo' => 'Nome ofensivo']);
$lixL = (int) ($r->json['lixeiraId'] ?? 0);
checar('apagar → {ok, denunciasFechadas, lixeiraId}; a carreira e as denúncias somem; a cópia vai para a lixeira por 30 dias', $r->status === 200 && $lixL > 0
    && ($r->json['denunciasFechadas'] ?? 0) === 1 && pkCarreira('l1', $uidL) === 0
    && (int) v('SELECT COUNT(*) FROM lixeira_carreiras WHERE id = ? AND dados IS NOT NULL AND expira_em > UTC_TIMESTAMP() + INTERVAL 29 DAY', [$lixL]) === 1, $r->resumo());
$r = admGet('r=lixeira');
$it = $r->json['itens'][0] ?? [];
checar('?r=lixeira: {id, carreiraPk, usuario, jogador, nota, motivo, apagadaEm, apagadaPor, expiraEm, temCopia}', $r->status === 200 && ($r->json['total'] ?? 0) === 1
    && ($it['carreiraPk'] ?? 0) === $pkL && ($it['usuario']['id'] ?? 0) === $uidL && ($it['nota'] ?? 0) === 77 && ($it['motivo'] ?? '') === 'Nome ofensivo'
    && ($it['temCopia'] ?? false) === true && is_string($it['apagadaPor'] ?? null) && preg_match($RE_ISO, (string) ($it['expiraEm'] ?? '')) === 1, $r->resumo());
checar('a ficha da conta lista a lixeira dela', count(admGet('r=usuario&id=' . $uidL)->json['usuario']['lixeira'] ?? []) === 1);
$r = salvarC($navL, $hL);
checar('o aparelho do dono salva de novo a mesma carreira → 409 apagada ("removida pela moderação") e ela não volta', $r->status === 409 && $r->erro() === 'apagada'
    && ($r->json['mensagem'] ?? '') === 'Esta carreira foi removida pela moderação.' && pkCarreira('l1', $uidL) === 0, $r->resumo());
$r = admPost(['acao' => 'restaurar_carreira', 'id' => $lixL]);
checar('restaurar → volta como oculta (o admin decide depois), com o mesmo carreiras.id; sai da lixeira', $r->status === 200 && ($r->json['pk'] ?? 0) === $pkL
    && (int) v('SELECT oculta FROM carreiras WHERE id = ?', [$pkL]) === 1 && v('SELECT motivo_admin FROM carreiras WHERE id = ?', [$pkL]) === 'Nome ofensivo'
    && (int) v('SELECT COUNT(*) FROM lixeira_carreiras') === 0 && admGet('r=carreira&id=' . $pkL)->status === 200, $r->resumo());
$r = admPost(['acao' => 'restaurar_carreira', 'id' => $lixL]);
checar('restaurar de novo → 404', $r->status === 404, $r->resumo());
admPost(['acao' => 'apagar_carreira', 'id' => $pkL, 'motivo' => 'de novo']);
$lixL = (int) v('SELECT MAX(id) FROM lixeira_carreiras');
q("INSERT INTO carreiras (usuario_id, carreira_id, dados, salva_em) VALUES (?, 'l1', ?, UTC_TIMESTAMP())", [$uidL, gzencode('{}')]);
$r = admPost(['acao' => 'restaurar_carreira', 'id' => $lixL]);
checar('a conta já tem essa carreira de novo → 409 ja_existe', $r->status === 409 && $r->erro() === 'ja_existe', $r->resumo());
q("DELETE FROM carreiras WHERE usuario_id = ? AND carreira_id = 'l1'", [$uidL]);
q('UPDATE lixeira_carreiras SET expira_em = UTC_TIMESTAMP() - INTERVAL 1 DAY WHERE id = ?', [$lixL]);
$lp = phpComLibConfig(['limpeza_a_cada' => 1], 'limpezaTalvez(); echo json_encode(["ok" => true]);');
checar('limpeza: a cópia vencida (30 dias) é esvaziada e a marca fica', ($lp['ok'] ?? false) === true
    && (int) v('SELECT COUNT(*) FROM lixeira_carreiras WHERE id = ? AND dados IS NULL AND linha IS NULL', [$lixL]) === 1);
$r = admPost(['acao' => 'restaurar_carreira', 'id' => $lixL]);
checar('restaurar sem a cópia → 409 sem_copia', $r->status === 409 && $r->erro() === 'sem_copia', $r->resumo());
checar('…e o reenvio continua barrado', salvarC($navL, $hL)->status === 409);
$r = admPost(['acao' => 'liberar_reenvio', 'id' => $lixL]);
$r2 = salvarC($navL, $hL);
checar('liberar_reenvio → a marca sai e o jogador salva de novo; ela volta como uma carreira qualquer (visível)', $r->status === 200 && $r2->status === 200
    && (int) v('SELECT oculta FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uidL, 'l1']) === 0, $r2->resumo());
checar('liberar de novo → 404; id ruim → 400', admPost(['acao' => 'liberar_reenvio', 'id' => $lixL])->status === 404
    && admPost(['acao' => 'liberar_reenvio', 'id' => 'x'])->status === 400 && admPost(['acao' => 'restaurar_carreira', 'id' => -1])->status === 400);
checar('restaurar, liberar e apagar no registro', (int) v("SELECT COUNT(*) FROM admin_log WHERE acao IN ('restaurar_carreira', 'liberar_reenvio')") === 2);

// ══ 9. mesmo aparelho, sinais e lote nas indicações (P1-9) ═════════════════════════════════════

secao('v3.2 · várias contas no mesmo aparelho, sinais e lote nas indicações (P1-9)');
$r = admGet('r=multicontas&atualizar=1');
$g = array_values(array_filter($r->json['itens'] ?? [], static fn($x) => count($x['contas'] ?? []) === 4))[0] ?? [];
checar('?r=multicontas: {chave multi:<sha1>, aparelho (8), contas [{id, apelido, criadoEm, status, partidas}], seIndicaram, ultimaVisita, dispensado}',
    $r->status === 200 && preg_match('/^multi:[0-9a-f]{40}$/', (string) ($g['chave'] ?? '')) === 1 && strlen((string) ($g['aparelho'] ?? '')) === 8
    && array_column($g['contas'] ?? [], 'id') === [$grupoM[0], $grupoM[1], $grupoM[2], $u4] && ($g['seIndicaram'] ?? false) === true
    && ($g['dispensado'] ?? true) === false && is_int($g['contas'][0]['partidas'] ?? null), $r->resumo());
admPost(['acao' => 'alerta_dispensar', 'chave' => (string) ($g['chave'] ?? '')]);
$r = admGet('r=multicontas');
checar('…o grupo dispensado no "Precisa de atenção" aparece como dispensado', (array_values(array_filter($r->json['itens'] ?? [], static fn($x) => ($x['chave'] ?? '') === ($g['chave'] ?? '')))[0]['dispensado'] ?? false) === true);
// grupo de 2 contas: o "Precisa de atenção" só avisa de 3+, mas o "Está tudo certo" do cartão vale para todo grupo da lista
[, $uidP1] = novaConta('Par Um');
[, $uidP2] = novaConta('Par Dois');
$vidPar = uuid4();
foreach ([$uidP1, $uidP2] as $x) {
    q("INSERT INTO visitas (sid, vid, usuario_id, inicio, ultimo, ativo_s, origem, bot) VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), 60, 'direto', 0)", [uuid4(), $vidPar, $x]);
}
$r = admGet('r=multicontas&atualizar=1');
$gPar = array_values(array_filter($r->json['itens'] ?? [], static fn($x) => array_column($x['contas'] ?? [], 'id') === [$uidP1, $uidP2]))[0] ?? [];
$noAlerta = in_array((string) ($gPar['chave'] ?? ''), array_column(admGet('r=atencao&atualizar=1')->json['alertas'] ?? [], 'chave'), true);
$r = admPost(['acao' => 'alerta_dispensar', 'chave' => (string) ($gPar['chave'] ?? '')]);
$r2 = admGet('r=multicontas');
checar('grupo de 2 contas (fora do "Precisa de atenção"): alerta_dispensar com a chave do cartão → 200 e dispensado', ($gPar['dispensado'] ?? true) === false && !$noAlerta
    && $r->status === 200 && (array_values(array_filter($r2->json['itens'] ?? [], static fn($x) => ($x['chave'] ?? '') === ($gPar['chave'] ?? '')))[0]['dispensado'] ?? false) === true, $r->resumo());
$r = admPost(['acao' => 'alerta_dispensar', 'chave' => 'multi:' . sha1('nao-e-grupo')]);
checar('…multi: de um grupo que não existe → 400 chave', $r->status === 400 && $r->erro() === 'chave', $r->resumo());
// indicações: indicador e indicado no mesmo aparelho; série de 5 em 24 h; indicado novo
limparV32();
$ADM = entrarAdmin();
[$navI, $uidI, , $vidI] = novaConta('Indicador Um');
$codI = (string) v('SELECT codigo_convite FROM usuarios WHERE id = ?', [$uidI]);
medir($navI, $vidI, uuid4(), [['t' => 'view']], ctx());
$indicados = [];
for ($i = 0; $i < 5; $i++) {
    $am = novaConta('Amigo ' . $i, ['convite' => $codI]);
    $indicados[] = $am[1];
}
$vidComum = uuid4();
q("INSERT INTO visitas (sid, vid, usuario_id, inicio, ultimo, origem, bot) VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), 'direto', 0), (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), 'direto', 0)",
    [uuid4(), $vidComum, $uidI, uuid4(), $vidComum, $indicados[0]]);
$r = admGet('r=indicacoes&status=pendente');
$IT = array_column($r->json['itens'] ?? [], null, 'id');
$iMesmo = (int) v('SELECT id FROM indicacoes WHERE indicado_id = ?', [$indicados[0]]);
$iOutro = (int) v('SELECT id FROM indicacoes WHERE indicado_id = ?', [$indicados[1]]);
checar('?r=indicacoes: sinais grave mesmo_aparelho e serie_24h; leve conta_recente; seguro', $r->status === 200 && count($IT) === 5
    && in_array('mesmo_aparelho', codigosSinais($IT[$iMesmo] ?? null), true) && !in_array('mesmo_aparelho', codigosSinais($IT[$iOutro] ?? null), true)
    && in_array('serie_24h', codigosSinais($IT[$iOutro] ?? null), true) && in_array('conta_recente', codigosSinais($IT[$iOutro] ?? null), true)
    && ($IT[$iOutro]['seguro'] ?? true) === false, $r->resumo());
q('UPDATE usuarios SET criado_em = UTC_TIMESTAMP() - INTERVAL 8 DAY WHERE id = ?', [$indicados[2]]);
q('UPDATE indicacoes SET criada_em = UTC_TIMESTAMP() - INTERVAL 8 DAY WHERE indicado_id IN (?, ?, ?)', [$indicados[2], $indicados[3], $indicados[4]]);
$IT = array_column(admGet('r=indicacoes')->json['itens'] ?? [], null, 'id');
$i2 = (int) v('SELECT id FROM indicacoes WHERE indicado_id = ?', [$indicados[2]]);
checar('indicado sem partida há 7+ dias → sem_partida (leve); fora da série de 24 h a série some', in_array('sem_partida', codigosSinais($IT[$i2] ?? null), true)
    && !in_array('serie_24h', codigosSinais($IT[$iOutro] ?? null), true) && ($IT[$i2]['seguro'] ?? false) === true, json_encode($IT[$i2] ?? null));
checar('?r=indicacoes&status=suspeitas (com sinal grave) e &indicador=', array_column(admGet('r=indicacoes&status=suspeitas')->json['itens'] ?? [], 'id') === [$iMesmo]
    && (admGet('r=indicacoes&indicador=' . $uidI)->json['total'] ?? 0) === 5 && (admGet('r=indicacoes&indicador=999999')->json['total'] ?? 1) === 0);
// lote
q("UPDATE indicacoes SET status = 'valida', validada_em = UTC_TIMESTAMP() WHERE id IN (?, ?)", [$iOutro, $i2]);
q("INSERT INTO bonus (usuario_id, valor, origem, ref, criado_em) VALUES (?, 2, 'indicacao', ?, UTC_TIMESTAMP()), (?, 3, 'indicacao', ?, UTC_TIMESTAMP())",
    [$uidI, 'indicacao:' . $iOutro, $uidI, 'indicacao:' . $i2]);
q("UPDATE bonus SET usado_em = UTC_TIMESTAMP(), carreira_id = 'x' WHERE ref = ?", ['indicacao:' . $i2]);
$i3 = (int) v('SELECT id FROM indicacoes WHERE indicado_id = ?', [$indicados[3]]);
q("UPDATE indicacoes SET status = 'recusada', motivo = 'limite' WHERE id = ?", [$i3]);
$r = admPost(['acao' => 'indicacoes_lote', 'ids' => [$iMesmo, $iOutro], 'operacao' => 'aceitar', 'motivo' => 'x']);
checar('indicacoes_lote operacao fora da lista → 400 operacao', $r->status === 400 && $r->erro() === 'operacao', $r->resumo());
$r = admPost(['acao' => 'indicacoes_lote', 'ids' => [$iMesmo], 'operacao' => 'recusar']);
checar('indicacoes_lote sem motivo → 400 motivo', $r->status === 400 && $r->erro() === 'motivo', $r->resumo());
$r = admPost(['acao' => 'indicacoes_lote', 'ids' => [$iMesmo, $iOutro, $i2, $i3, 999999], 'operacao' => 'recusar', 'motivo' => 'Mesmo aparelho em série']);
$pul = array_column($r->json['pulados'] ?? [], 'motivo', 'id');
checar('indicacoes_lote → recusadas [ids], bonusTirados, pulados (bonus_usado, ja_recusada, nao_encontrada)', $r->status === 200
    && ($r->json['recusadas'] ?? null) === [$iMesmo, $iOutro] && ($r->json['bonusTirados'] ?? 0) === 1 && ($pul[$i2] ?? '') === 'bonus_usado'
    && ($pul[$i3] ?? '') === 'ja_recusada' && ($pul[999999] ?? '') === 'nao_encontrada'
    && (int) v("SELECT COUNT(*) FROM bonus WHERE ref = ?", ['indicacao:' . $iOutro]) === 0 && v('SELECT status FROM indicacoes WHERE id = ?', [$i2]) === 'valida', $r->resumo());
$i4 = (int) v('SELECT id FROM indicacoes WHERE indicado_id = ?', [$indicados[4]]);
$res = paraleloAdm([['acao' => 'indicacoes_lote', 'ids' => [$i4], 'operacao' => 'recusar', 'motivo' => 'a'], ['acao' => 'indicacoes_lote', 'ids' => [$i4], 'operacao' => 'recusar', 'motivo' => 'b']]);
$rec = array_sum(array_map(static fn($x) => count($x[2]['recusadas'] ?? []), $res));
checar('dois lotes iguais ao mesmo tempo: a indicação é recusada uma vez só (a outra vê ja_recusada)', $rec === 1
    && count(array_filter($res, static fn($x) => $x[0] === 200)) === 2 && (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'recusar_indicacao' AND alvo = ?", ['indicacao:' . $i4]) === 1);

// ══ 10. código de troca de senha pelo admin e registro de e-mails (P1-10) ═══════════════════════

secao('v3.2 · código de troca de senha mandado pelo admin (o código nunca aparece) e registro de e-mails (P1-10)');
$emailI = (string) v('SELECT email FROM usuarios WHERE id = ?', [$uidI]);
$antes = emailsPara($emailI);
$r = admPost(['acao' => 'enviar_redefinicao', 'id' => $uidI]);
$eml = esperarEmailNovo($emailI, $antes);
$cod = codigoDe($eml);
checar('enviar_redefinicao → {ok, enviado, para: "in***@exemplo.com"}; o e-mail sai com um código de 6 dígitos', $r->status === 200 && ($r->json['enviado'] ?? false) === true
    && preg_match('/^v3\*\*\*@exemplo\.com$/', (string) ($r->json['para'] ?? '')) === 1 && $cod !== null && str_contains((string) $eml, 'A equipe do LENDA'), $r->resumo());
checar('…o código não está na resposta nem no registro', $cod !== null && !str_contains($r->corpo, $cod)
    && !str_contains((string) v("SELECT detalhes FROM admin_log WHERE acao = 'enviar_redefinicao' ORDER BY id DESC LIMIT 1"), $cod));
$el = q('SELECT * FROM email_log ORDER BY id DESC LIMIT 1')[0] ?? [];
checar('email_log: tipo admin_redef, via arquivo, ok, para mascarado e o HMAC (nunca o endereço)', ($el['tipo'] ?? '') === 'admin_redef' && ($el['via'] ?? '') === 'arquivo'
    && (int) ($el['ok'] ?? 0) === 1 && ($el['para_mask'] ?? '') === (string) $r->json['para'] && ($el['para_hash'] ?? '') === quemEmailTeste($emailI)
    && !str_contains(json_encode($el), $emailI), json_encode($el));
resetarLimitesCurtos();
$r = conta(novoNav(), ['acao' => 'redefinir', 'email' => $emailI, 'codigo' => $cod, 'senha' => 'nova-senha-123']);
checar('o código mandado pelo admin troca a senha no jogo', $r->status === 200, $r->resumo());
resetarLimitesCurtos();
admPost(['acao' => 'enviar_redefinicao', 'id' => $uidI]);
admPost(['acao' => 'enviar_redefinicao', 'id' => $uidI]);
admPost(['acao' => 'enviar_redefinicao', 'id' => $uidI]);
$r = admPost(['acao' => 'enviar_redefinicao', 'id' => $uidI]);
checar('no máximo 3 por conta a cada 10 min → 429 (e o 4º não sai)', $r->status === 429 && (int) v("SELECT COUNT(*) FROM email_log WHERE tipo = 'admin_redef'") === 4, $r->resumo());
admPost(['acao' => 'suspender', 'id' => $indicados[1], 'motivo' => 'teste']);
$r = admPost(['acao' => 'enviar_redefinicao', 'id' => $indicados[1]]);
checar('conta suspensa → 409 suspensa', $r->status === 409 && $r->erro() === 'suspensa', $r->resumo());
resetarLimitesCurtos();
conta(novoNav(), ['acao' => 'esqueci', 'email' => (string) v('SELECT email FROM usuarios WHERE id = ?', [$indicados[0]])]);
for ($i = 0; $i < 50 && (int) v("SELECT COUNT(*) FROM email_log WHERE tipo = 'esqueci'") === 0; $i++) {
    usleep(50_000);
}
q("DELETE FROM email_log WHERE tipo = 'verificacao'"); // v3.3: o cadastro manda o código de confirmação do e-mail; aqui contam os de senha
$r = admGet('r=emails');
checar('?r=emails: {resumo {envios24h, falhas24h, via, ultimoOkEm}, itens [{em, para, tipo, via, ok, detalhe}]}; o "Esqueci a senha" também vai (tipo esqueci)', $r->status === 200
    && ($r->json['resumo']['envios24h'] ?? 0) === 5 && ($r->json['resumo']['falhas24h'] ?? -1) === 0 && ($r->json['resumo']['via'] ?? '') === 'arquivo'
    && preg_match($RE_ISO, (string) ($r->json['resumo']['ultimoOkEm'] ?? '')) === 1 && ($r->json['itens'][0]['tipo'] ?? '') === 'esqueci'
    && !str_contains($r->corpo, $emailI), $r->resumo());
checar('?r=emails&email=<exato> acha pelo HMAC', (admGet('r=emails&email=' . rawurlencode(strtoupper($emailI)))->json['total'] ?? 0) === 4
    && (admGet('r=emails&email=ninguem@exemplo.com')->json['total'] ?? 1) === 0);

// ══ 11. relatórios, ativos e filtros da lista de contas (P1-11, P1-12, A10) ══════════════════════

secao('v3.2 · relatórios prontos com CSV e ativos 7/30 dias (P1-11)');
limparV32();
$ADM = entrarAdmin();
[$navR1, $uR1] = novaConta('Relato Um');
[$navR2, $uR2] = novaConta('Relato Dois');
[$navR3, $uR3] = novaConta('Relato Três');
[, $uR4] = novaConta('Relato Quatro');
q('UPDATE usuarios SET partidas_conta = 9, partidas = 9 WHERE id = ?', [$uR1]);
q('UPDATE usuarios SET partidas = 3 WHERE id = ?', [$uR2]);
q('UPDATE usuarios SET ultimo_acesso = UTC_TIMESTAMP() - INTERVAL 40 DAY, criado_em = UTC_TIMESTAMP() - INTERVAL 60 DAY WHERE id = ?', [$uR3]);
salvarC($navR1, hallEntry('r1', ['nota' => 70]));
salvarC($navR2, hallEntry('r2', ['nota' => 10]));
q("UPDATE carreiras SET oculta = 1 WHERE carreira_id = 'r2'");
admPost(['acao' => 'atualizar_hall']);
q("INSERT INTO indicacoes (indicador_id, indicado_id, criada_em, status) VALUES (?, ?, UTC_TIMESTAMP(), 'valida')", [$uR1, $uR4]);
q("INSERT INTO bonus (usuario_id, valor, origem, ref, criado_em) VALUES (?, 2, 'admin', 'x', UTC_TIMESTAMP() - INTERVAL 20 DAY)", [$uR2]);
admPost(['acao' => 'suspender', 'id' => $uR4, 'motivo' => 'teste']);
admPost(['acao' => 'mudar_tipo', 'id' => $uR3, 'tipo' => 'tester']);
$esp = ['nunca_jogaram' => [$uR4, $uR3], 'sumidos30' => [$uR3], 'engajados' => [$uR1, $uR2], 'sem_carreira' => [$uR4, $uR3], 'nunca_no_hall' => [$uR2],
    'suspensos' => [$uR4], 'indicadores' => [$uR1], 'bonus_parado' => [$uR2], 'testers' => [$uR3], 'base' => [$uR4, $uR2, $uR1, $uR3]];
$difR = [];
foreach ($esp as $tipo => $ids) {
    $r = admGet('r=relatorio&tipo=' . $tipo);
    $got = array_column($r->json['itens'] ?? [], 'id');
    if ($r->status !== 200 || $got !== $ids || ($r->json['total'] ?? -1) !== count($ids) || ($r->json['base'] ?? 0) !== 4 || !is_string($r->json['porque'] ?? null)) {
        $difR[] = "$tipo: " . json_encode($got) . " ≠ " . json_encode($ids) . " ($r->status)";
    }
}
checar('os 10 relatórios: as contas certas, na ordem, com total, base e o porquê', !$difR, implode(' | ', $difR));
$r = admGet('r=relatorio&tipo=base');
$it = array_column($r->json['itens'] ?? [], null, 'id')[$uR1] ?? [];
$k = array_keys($it);
sort($k);
checar('item: {id, apelido, email, tipo, status, criadoEm, ultimoAcesso, diasSemAcesso, partidas, carreiras, indicacoesValidas, bonusAbertos}',
    $k === ['apelido', 'bonusAbertos', 'carreiras', 'criadoEm', 'diasSemAcesso', 'email', 'id', 'indicacoesValidas', 'partidas', 'status', 'tipo', 'ultimoAcesso']
    && ($it['partidas'] ?? 0) === 9 && ($it['carreiras'] ?? 0) === 1 && ($it['indicacoesValidas'] ?? 0) === 1 && ($r->json['porPagina'] ?? 0) === 100
    && ($r->json['porTipo']['tester'] ?? 0) === 1, json_encode($it));
$r = admGet('r=relatorio&tipo=base&conta=tester');
checar('filtro por tipo de conta (conta=tester): total e base do tipo', array_column($r->json['itens'] ?? [], 'id') === [$uR3] && ($r->json['base'] ?? 0) === 1, $r->resumo());
checar('relatório desconhecido → 400 tipo; conta fora da lista → 400 conta', admGet('r=relatorio&tipo=xyz')->erro() === 'tipo' && admGet('r=relatorio')->status === 400
    && admGet('r=relatorio&tipo=base&conta=admin')->erro() === 'conta');
$navCsv = clone $ADM;
$navCsv->conferir = false; // a resposta é CSV (a conferência genérica do teste.php espera JSON)
$r = $navCsv->pedir('GET', '/api/admin.php?r=relatorio&tipo=nunca_jogaram&csv=1');
$linhasCsv = explode("\r\n", trim($r->corpo));
checar('csv=1: text/csv com BOM, cabeçalho em pt-BR e uma linha por conta; nome lenda-nunca-jogaram-AAAA-MM-DD.csv', $r->status === 200
    && str_starts_with($r->cab1('content-type'), 'text/csv') && str_contains($r->cab1('content-disposition'), 'lenda-nunca-jogaram-' . gmdate('Y-m-d', time() - 10800) . '.csv')
    && str_starts_with($r->corpo, "\xEF\xBB\xBFid;apelido;e-mail;tipo;status;criado;último acesso;dias sem acesso;partidas;carreiras;indicações válidas;bônus abertos")
    && count($linhasCsv) === 3, substr($r->corpo, 0, 300));
checar('…e o download vai para o registro (exportar com o tipo e as linhas)', str_contains((string) v("SELECT detalhes FROM admin_log WHERE acao = 'exportar' ORDER BY id DESC LIMIT 1"), '"linhas":2'));
$R = admGet('r=resumo')->json ?? [];
checar('?r=resumo.usuarios: ativos7, ativos30, nuncaJogaram', ($R['usuarios']['ativos7'] ?? -1) === 3 && ($R['usuarios']['ativos30'] ?? -1) === 3
    && ($R['usuarios']['nuncaJogaram'] ?? -1) === 2, json_encode($R['usuarios'] ?? null));
checar('?r=resumo.base (A10): suspensas, foraDoHall, naoAparecem, semTime, semUf, comNota, testers', ($R['base']['suspensas'] ?? -1) === 1
    && ($R['base']['testers'] ?? -1) === 1 && ($R['base']['semTime'] ?? -1) === 4 && ($R['base']['foraDoHall'] ?? -1) === 0 && array_key_exists('multicontas', $R['base'] ?? []),
    json_encode($R['base'] ?? null));

secao('v3.2 · filtros da lista de contas com contagens (P1-12)');
admPost(['acao' => 'bloquear_hall', 'id' => $uR2, 'sim' => true, 'motivo' => 'x']);
$navR1->pedir('POST', '/api/conta.php', ['acao' => 'perfil', 'hallPublico' => 'nao']);
admPost(['acao' => 'nota', 'id' => $uR3, 'texto' => 'oi']);
q("INSERT INTO denuncias (carreira_pk, usuario_id, motivo, criada_em, status) VALUES (?, ?, 'nome', UTC_TIMESTAMP(), 'aberta')", [pkCarreira('r1', $uR1), $uR2]);
$casos = ['hall=bloqueado' => [$uR2], 'hall=nao' => [$uR1], 'hall=publico' => [$uR4, $uR3], 'convite=1' => [$uR4], 'denunciado=1' => [$uR1], 'sumido=30' => [$uR3],
    'nota=1' => [$uR3], 'tipo=tester' => [$uR3], 'status=suspenso' => [$uR4], 'sem=time' => [$uR4, $uR2, $uR1, $uR3], 'status=ativo&tipo=jogador' => [$uR2, $uR1],
    'q=%23' . $uR2 => [$uR2], 'q=Relato&ordem=acesso' => [$uR4, $uR2, $uR1, $uR3]];
$difF = [];
foreach ($casos as $qs => $ids) {
    $r = admGet('r=usuarios&' . $qs);
    $got = array_column($r->json['itens'] ?? [], 'id');
    if ($r->status !== 200 || ($qs === 'q=Relato&ordem=acesso' ? $got[3] !== $uR3 || count($got) !== 4 : $got !== $ids) || ($r->json['total'] ?? -1) !== count($ids)) {
        $difF[] = "$qs: " . json_encode($got) . ' total ' . ($r->json['total'] ?? '?');
    }
}
checar('filtros tipo, hall, convite, denunciado, sumido, nota, sem e a busca por #id: os certos e o total da API', !$difF, implode(' | ', $difF));
$ct = admGet('r=usuarios')->json['contagens'] ?? [];
checar('contagens {status, tipo, hall, convite, denunciado, sumido, nota, sem}', ($ct['status'] ?? null) === ['ativo' => 3, 'suspenso' => 1] && ($ct['tipo']['tester'] ?? 0) === 1
    && ($ct['hall'] ?? null) === ['bloqueado' => 1, 'nao' => 1, 'publico' => 2] && ($ct['convite'] ?? 0) === 1 && ($ct['denunciado'] ?? 0) === 1 && ($ct['sumido'] ?? 0) === 1
    && ($ct['nota'] ?? 0) === 1 && ($ct['sem'] ?? null) === ['time' => 4, 'uf' => 4], json_encode($ct));
$ruins = [];
foreach (['tipo=x', 'hall=x', 'sumido=abc', 'sumido=0', 'sem=x', 'ordem=xyz', 'q[]=1', 'tipo[]=1', 'convite[]=1', 'pagina=-1'] as $qs) {
    $r = admGet('r=usuarios&' . $qs);
    if ($r->status !== 200) {
        $ruins[] = "$qs → $r->status";
    }
}
checar('filtros com valor ruim são ignorados (200, sem 500)', !$ruins, implode(', ', $ruins));

// ══ 12. bônus, registro, tempo de jogo e feed (X5, A9, A11, A14, H14) ════════════════════════════

secao('v3.2 · lista de bônus e tirar em lote (X5)');
q("INSERT INTO bonus (usuario_id, valor, origem, ref, criado_em) VALUES (?, 2, 'compartilhar', 'dia:x', UTC_TIMESTAMP()), (?, 3, 'admin', 'presente', UTC_TIMESTAMP())", [$uR1, $uR1]);
$bUsado = (int) v("SELECT id FROM bonus WHERE origem = 'compartilhar'");
q("UPDATE bonus SET usado_em = UTC_TIMESTAMP(), carreira_id = 'r1' WHERE id = ?", [$bUsado]);
$r = admGet('r=bonus');
checar('?r=bonus: paginado {id, usuario, valor, origem, ref, criadoEm, usadoEm, carreiraId, disponivel} + resumo {valor, abertos}', $r->status === 200
    && ($r->json['total'] ?? 0) === 3 && ($r->json['resumo']['abertos'] ?? 0) === 2 && ($r->json['itens'][0]['usuario']['id'] ?? 0) === $uR1
    && is_bool($r->json['itens'][0]['disponivel'] ?? null), $r->resumo());
checar('filtros estado=abertos|usados e origem; valor ruim → 400', (admGet('r=bonus&estado=abertos')->json['total'] ?? 0) === 2 && (admGet('r=bonus&estado=usados')->json['total'] ?? 0) === 1
    && (admGet('r=bonus&origem=admin')->json['total'] ?? 0) === 2 && admGet('r=bonus&estado=x')->status === 400 && admGet('r=bonus&origem=x')->status === 400);
$abertos = array_map('intval', array_column(q('SELECT id FROM bonus WHERE usado_em IS NULL ORDER BY id'), 'id'));
$r = admPost(['acao' => 'tirar_bonus_lote', 'ids' => $abertos]);
checar('tirar_bonus_lote sem motivo → 400 motivo', $r->status === 400 && $r->erro() === 'motivo', $r->resumo());
$r = admPost(['acao' => 'tirar_bonus_lote', 'ids' => array_merge($abertos, [$bUsado, 999999]), 'motivo' => 'Bônus por engano']);
$pul = array_column($r->json['pulados'] ?? [], 'motivo', 'id');
checar('tirar_bonus_lote → feitos; pulados usado e nao_encontrado; uma linha tirar_bonus por bônus', $r->status === 200 && ($r->json['feitos'] ?? null) === $abertos
    && ($pul[$bUsado] ?? '') === 'usado' && ($pul[999999] ?? '') === 'nao_encontrado' && (int) v('SELECT COUNT(*) FROM bonus') === 1
    && (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'tirar_bonus'") === count($abertos), $r->resumo());

secao('v3.2 · registro: quem, texto, período e ações por dia (P1-3 lado do registro, A9)');
q("INSERT INTO admin_log (em, acao, alvo, detalhes, quem) VALUES (UTC_TIMESTAMP() - INTERVAL 3 DAY, 'nota', 'usuario:1', '{\"via\":\"painel\",\"texto\":\"100% certo_\"}', 'a777')");
$r = admGet('r=log&quem=a777');
$it = $r->json['itens'][0] ?? [];
checar('quem= filtra; item {id, em, acao, alvo, quem {codigo, nome}, ipDia, grave, detalhes}', $r->status === 200 && ($r->json['total'] ?? 0) === 1
    && ($it['quem']['codigo'] ?? '') === 'a777' && array_key_exists('ipDia', $it) && ($it['grave'] ?? true) === false, $r->resumo());
checar('q= busca nos detalhes com % e _ escapados', (admGet('r=log&q=' . rawurlencode('100%'))->json['total'] ?? 0) === 1 && (admGet('r=log&q=' . rawurlencode('0%c'))->json['total'] ?? 1) === 0);
$hojeB = gmdate('Y-m-d', time() - 10800);
$ontem3 = gmdate('Y-m-d', time() - 10800 - 3 * 86400);
checar('de=/ate= (dias de Brasília)', (admGet("r=log&de=$ontem3&ate=$ontem3")->json['total'] ?? 0) === 1 && (admGet("r=log&quem=a777&de=$hojeB")->json['total'] ?? 1) === 0);
$r = admGet('r=log&porDia=14');
$pd = $r->json['porDia'] ?? [];
checar('porDia=14 → 14 dias {dia, n}, hoje por último, com as ações de hoje', count($pd) === 14 && ($pd[13]['dia'] ?? '') === $hojeB && ($pd[13]['n'] ?? 0) > 0
    && ($pd[10]['dia'] ?? '') === $ontem3 && ($pd[10]['n'] ?? 0) === 1, json_encode(array_slice($pd, 9)));
$r = admGet('r=log&acao=excluir_usuario');
checar('ação grave pintada (grave: true)', $r->status === 200);
$r = admGet('r=seguranca');
checar('?r=seguranca (o bloco do §B, pelo mesmo endereço)', $r->status === 200 && is_array($r->json['resumo'] ?? null), $r->resumo());

secao('v3.2 · tempo de jogo (A11) e o que os jogadores fizeram (A14)');
q('DELETE FROM visitas');
q('DELETE FROM eventos');
$agoraT = time();
q("INSERT INTO visitas (sid, vid, usuario_id, inicio, ultimo, ativo_s, jogando_s, modo_atual, origem, bot) VALUES
    (?, ?, ?, ?, ?, 600, 400, 'classico', 'direto', 0), (?, ?, ?, ?, ?, 20, 0, NULL, 'direto', 0), (?, ?, NULL, ?, ?, 300, 200, 'classico', 'direto', 0),
    (?, ?, ?, ?, ?, 900, 900, 'imersivo', 'direto', 0), (?, ?, NULL, ?, ?, 999, 999, 'classico', 'direto', 1)",
    [uuid4(), uuid4(), $uR1, gmdate('Y-m-d H:i:s', $agoraT - 60), gmdate('Y-m-d H:i:s', $agoraT), uuid4(), uuid4(), $uR2, gmdate('Y-m-d H:i:s', $agoraT - 60), gmdate('Y-m-d H:i:s', $agoraT),
        uuid4(), uuid4(), gmdate('Y-m-d H:i:s', $agoraT - 60), gmdate('Y-m-d H:i:s', $agoraT), uuid4(), uuid4(), $uR3, gmdate('Y-m-d H:i:s', $agoraT - 60), gmdate('Y-m-d H:i:s', $agoraT),
        uuid4(), uuid4(), gmdate('Y-m-d H:i:s', $agoraT - 60), gmdate('Y-m-d H:i:s', $agoraT)]);
$r = admGet('r=tempo&jan=d30&grupo=jogadores');
checar('?r=tempo jogadores (sem tester/teste/oficial, sem robô): total, jogadores, sessões ≥ 30 s, média, por dia, por modo, ranking', $r->status === 200
    && ($r->json['total']['ativoS'] ?? 0) === 920 && ($r->json['total']['jogandoS'] ?? 0) === 600 && ($r->json['total']['jogadores'] ?? 0) === 2
    && ($r->json['total']['sessoes'] ?? 0) === 2 && ($r->json['total']['mediaS'] ?? 0) === 450 && count($r->json['porDia'] ?? []) === 1
    && ($r->json['porModo'][0] ?? null) === ['modo' => 'classico', 'jogandoS' => 600, 'sessoes' => 2] && array_column($r->json['ranking'] ?? [], 'id') === [$uR1, $uR2]
    && is_string($r->json['regua'] ?? null), $r->resumo());
$r = admGet('r=tempo&jan=semana&grupo=testes');
checar('grupo=testes: só as contas de teste/tester/oficial', array_column($r->json['ranking'] ?? [], 'id') === [$uR3] && ($r->json['total']['jogandoS'] ?? 0) === 900, $r->resumo());
checar('grupo=todos (sem robô)', (admGet('r=tempo&jan=tudo&grupo=todos')->json['total']['ativoS'] ?? 0) === 1820);
$r = admGet('r=tempo&jan=mes&usuario=' . $uR1);
checar('usuario= → as sessões dele', count($r->json['sessoes'] ?? []) === 1 && ($r->json['sessoes'][0]['jogandoS'] ?? 0) === 400, $r->resumo());
checar('jan/grupo ruins → 400 filtro; usuario ruim → 400', admGet('r=tempo&jan=x')->erro() === 'filtro' && admGet('r=tempo&grupo=x')->erro() === 'filtro' && admGet('r=tempo&usuario=x')->status === 400);
$navCsv = clone $ADM;
$navCsv->conferir = false;
$r = $navCsv->pedir('GET', '/api/admin.php?r=tempo&jan=passada&csv=1');
checar('csv=1 → CSV do ranking', $r->status === 200 && str_starts_with($r->cab1('content-type'), 'text/csv') && str_starts_with($r->corpo, "\xEF\xBB\xBFid;apelido;tipo;"), substr($r->corpo, 0, 80));
$sidF = uuid4();
$vidF = uuid4();
medir($navR2, $vidF, $sidF, [['t' => 'login'], ['t' => 'compartilhar', 'd' => ['acao' => 'copiar']]], ctx());
medir($anon, uuid4(), uuid4(), [['t' => 'cadastro']], ctx());
$r = admGet('r=eventos');
checar('?r=eventos: o feed dos jogadores (cadastro, login, jogo_fim, compartilhar) com a conta quando há', $r->status === 200 && ($r->json['total'] ?? 0) === 3
    && count(array_filter($r->json['itens'] ?? [], static fn($e) => ($e['conta']['id'] ?? 0) === $uR2)) === 2 && strlen((string) ($r->json['itens'][0]['aparelho'] ?? '')) === 8, $r->resumo());
checar('tipo= filtra; tipo ruim → 400', (admGet('r=eventos&tipo=login')->json['total'] ?? 0) === 1 && admGet('r=eventos&tipo=view')->status === 400);

secao('v3.2 · tempo de resposta da moderação (H14/A8) e destaque (H12)');
[$navD, $uD] = novaConta('Dono Eta');
$pkD1 = salvarPk($navD, $uD, 'd1', ['nota' => 80]);
q("INSERT INTO denuncias (carreira_pk, usuario_id, motivo, criada_em, status, resolvida_em) VALUES
    (?, ?, 'nome', UTC_TIMESTAMP() - INTERVAL 10 HOUR, 'ok', UTC_TIMESTAMP() - INTERVAL 8 HOUR),
    (?, ?, 'nome', UTC_TIMESTAMP() - INTERVAL 10 HOUR, 'ocultar', UTC_TIMESTAMP() - INTERVAL 6 HOUR),
    (?, ?, 'nome', UTC_TIMESTAMP() - INTERVAL 30 HOUR, 'aberta', NULL)", [$pkD1, $uR1, $pkD1, $uR2, $pkD1, $uR3]);
$M = admGet('r=resumo')->json['moderacao'] ?? [];
checar('resumo.moderacao {esperaMaisAntigaH, mediaH, medianaH, decididas30d} e moderacaoIndicacoes', abs((float) ($M['esperaMaisAntigaH'] ?? 0) - 30) < 0.2
    && (float) ($M['mediaH'] ?? 0) === 3.0 && (float) ($M['medianaH'] ?? 0) === 3.0 && ($M['decididas30d'] ?? 0) === 2
    && is_array(admGet('r=resumo')->json['moderacaoIndicacoes'] ?? null), json_encode($M));
admPost(['acao' => 'atualizar_hall']);
$r = admPost(['acao' => 'destacar_carreira', 'id' => $pkD1, 'sim' => 1]);
checar('destacar_carreira com sim que não é booleano → 400', $r->status === 400, $r->resumo());
$r = admPost(['acao' => 'destacar_carreira', 'id' => $pkD1, 'sim' => true]);
$itD = array_column(hallGet()->json['itens'] ?? [], null, 'id')['d1'] ?? [];
checar('destacar → {ok, destaque: true}; o Hall público mostra destaque: true na hora', $r->status === 200 && ($r->json['destaque'] ?? false) === true && ($itD['destaque'] ?? false) === true, $r->resumo());
admPost(['acao' => 'atualizar_hall']);
checar('…continua depois de refazer a fotografia; ?r=hall&filtro=destaques', (array_column(hallGet()->json['itens'] ?? [], null, 'id')['d1']['destaque'] ?? false) === true
    && array_column(admGet('r=hall&filtro=destaques')->json['itens'] ?? [], 'id') === [$pkD1] && (admGet('r=resumo')->json['carreiras']['destaques'] ?? 0) === 1);
admPost(['acao' => 'destacar_carreira', 'id' => $pkD1, 'sim' => false]);
checar('tirar o destaque → false na hora; carreira inexistente → 404', (array_column(hallGet()->json['itens'] ?? [], null, 'id')['d1']['destaque'] ?? true) === false
    && admPost(['acao' => 'destacar_carreira', 'id' => 999999, 'sim' => true])->status === 404);

// ══ 13. configuração: revisão do Hall (X1), avisos (N14) e aviso no celular (O6) ════════════════

secao('v3.2 · revisão do Hall configurável (X1) e vários avisos com público e validade (N14)');
$r = admGet('r=config');
checar('padrão de hall_revisao_nota = o do arquivo (90); avisos [] ; aviso_celular desligado; celular {ntfy, telegram} só booleanos',
    ($r->json['padroes']['hall_revisao_nota'] ?? 0) === 90 && ($r->json['valores']['hall_revisao_nota'] ?? 0) === 90 && ($r->json['valores']['avisos'] ?? null) === []
    && ($r->json['valores']['aviso_celular'] ?? null) === ['denuncia' => false, 'picoOnline' => 0] && ($r->json['celular'] ?? null) === ['ntfy' => false, 'telegram' => false]
    && !array_key_exists('_esquema', $r->json['valores'] ?? []), $r->resumo());
foreach ([49, 102, '90', 90.5, null] as $v) {
    $r = admPost(['acao' => 'config', 'valores' => ['hall_revisao_nota' => $v]]);
    checar('hall_revisao_nota ' . json_encode($v) . ' → 400 config_invalida', $r->status === 400 && ($r->json['chave'] ?? '') === 'hall_revisao_nota', $r->resumo());
}
admPost(['acao' => 'config', 'valores' => ['hall_revisao_nota' => 95]]);
[$navX, $uX] = novaConta('Dono Teta');
salvarC($navX, hallEntry('x93', ['nota' => 93]), 'manual', false);
salvarC($navX, hallEntry('x96', ['nota' => 96]), 'manual', false);
checar('com 95: a de 93 entra direto, a de 96 espera a revisão', v("SELECT suspeita FROM carreiras WHERE carreira_id = 'x93'") === null
    && v("SELECT suspeita FROM carreiras WHERE carreira_id = 'x96'") === 'revisao' && (admGet('r=resumo')->json['carreiras']['revisaoNota'] ?? 0) === 95);
admPost(['acao' => 'config', 'valores' => ['hall_revisao_nota' => 101]]);
salvarC($navX, hallEntry('x99', ['nota' => 99]), 'manual', false);
checar('101 desliga a revisão', v("SELECT suspeita FROM carreiras WHERE carreira_id = 'x99'") === null);
admPost(['acao' => 'config', 'valores' => ['hall_revisao_nota' => 90]]);
$ruins = [[['texto' => '']], [['texto' => 'a', 'tipo' => 'x']], [['texto' => 'a', 'publico' => 'x']], [['texto' => 'a', 'ate' => '2026-13-01']], [['texto' => 'a', 'ate' => 5]],
    array_fill(0, 6, ['texto' => 'a']), ['a' => ['texto' => 'x']], 'x'];
foreach ($ruins as $v) {
    $r = admPost(['acao' => 'config', 'valores' => ['avisos' => $v]]);
    checar('avisos ' . substr(json_encode($v), 0, 50) . ' → 400 config_invalida', $r->status === 400 && ($r->json['chave'] ?? '') === 'avisos', $r->resumo());
}
$r = admPost(['acao' => 'config', 'valores' => ['avisos' => [['texto' => ' Para todos ', 'tipo' => 'info'], ['texto' => 'Só logados', 'tipo' => 'alerta', 'publico' => 'logados', 'ate' => '2099-12-31'],
    ['texto' => 'Só visitantes', 'publico' => 'visitantes'], ['texto' => 'Venceu', 'ate' => '2020-01-01']]]]);
checar('avisos válidos → gravados (texto limpo, ate em ISO: fim do dia em Brasília)', $r->status === 200 && ($r->json['valores']['avisos'][0]['texto'] ?? '') === 'Para todos'
    && ($r->json['valores']['avisos'][1]['ate'] ?? '') === '2100-01-01T02:59:59Z', $r->resumo());
$sA = $anon->pedir('GET', '/api/conta.php')->json['site']['avisos'] ?? [];
$sL = $navX->pedir('GET', '/api/conta.php')->json['site']['avisos'] ?? [];
checar('GET conta.php: só os avisos valendo e do público certo (visitante × logado)', array_column($sA, 'texto') === ['Para todos', 'Só visitantes']
    && array_column($sL, 'texto') === ['Para todos', 'Só logados'], json_encode([$sA, $sL], JSON_UNESCAPED_UNICODE));
admPost(['acao' => 'config', 'valores' => ['avisos' => []]]);

secao('v3.2 · aviso no celular do admin (O6)');
$r = admPost(['acao' => 'testar_aviso']);
checar('testar_aviso sem canal no arquivo de config → 409 sem_aviso', $r->status === 409 && $r->erro() === 'sem_aviso', $r->resumo());
$r = admPost(['acao' => 'config', 'valores' => ['aviso_celular' => ['denuncia' => 'sim', 'picoOnline' => 0]]]);
checar('aviso_celular inválido → 400', $r->status === 400 && ($r->json['chave'] ?? '') === 'aviso_celular', $r->resumo());
admPost(['acao' => 'config', 'valores' => ['aviso_celular' => ['denuncia' => true, 'picoOnline' => 1]]]);
$recebeDir = dirname($CONFIG_ARQ) . '/receptor-ntfy';
if (!is_dir($recebeDir)) {
    mkdir($recebeDir, 0755, true);
}
$recebidos = $recebeDir . '/recebidos.txt';
if (is_file($recebidos)) {
    unlink($recebidos);
}
$lerRecebidos = static fn(): string => is_file($recebidos) ? (string) file_get_contents($recebidos) : '';
file_put_contents("$recebeDir/index.php", '<?php file_put_contents(' . var_export($recebidos, true) . ', mb_decode_mimeheader((string) ($_SERVER["HTTP_TITLE"] ?? "")) . "|" . file_get_contents("php://input") . "\n", FILE_APPEND); echo "ok";');
$portaR = 8789;
$procR = proc_open(['php', '-S', "127.0.0.1:$portaR", '-t', $recebeDir], [['file', '/dev/null', 'r'], ['file', '/dev/null', 'w'], ['file', '/dev/null', 'w']], $pipesR);
for ($i = 0; $i < 50 && !(static function () use ($portaR): bool {
    try {
        return fsockopen('127.0.0.1', $portaR) !== false;
    } catch (Throwable) {
        return false;
    }
})(); $i++) {
    usleep(100_000);
}
comConfig(['aviso_ntfy' => "http://127.0.0.1:$portaR/index.php?t=topico-de-teste"], static function () use ($lerRecebidos): void {
    $r = admGet('r=config');
    checar('com aviso_ntfy no arquivo: config.celular.ntfy = true (o endereço nunca aparece)', ($r->json['celular']['ntfy'] ?? false) === true
        && !str_contains($r->corpo, 'topico-de-teste'), $r->resumo());
    $r = admPost(['acao' => 'testar_aviso']);
    checar('testar_aviso → {ok, enviado: true, canais: {ntfy: true, telegram: null}}; o celular recebe', $r->status === 200 && ($r->json['enviado'] ?? false) === true
        && ($r->json['canais'] ?? null) === ['ntfy' => true, 'telegram' => null] && str_contains($lerRecebidos(), 'Aviso de teste'), $r->resumo());
    // denúncia nova no Hall avisa (depois de responder ao jogador)
    [$navDen] = novaConta('Denunciante Celular');
    resetarLimites();
    $r = $navDen->pedir('POST', '/api/hall.php', ['acao' => 'denunciar', 'id' => 'd1', 'motivo' => 'nome']);
    for ($i = 0; $i < 50 && !str_contains($lerRecebidos(), 'denúncia nova'); $i++) {
        usleep(100_000);
    }
    checar('denúncia nova → o jogador recebe {ok} e o celular do admin, o aviso (sem texto do jogador)', $r->status === 200
        && str_contains($lerRecebidos(), 'Chegou denúncia nova no Hall público'), $lerRecebidos());
    // pico de gente online (aviso em 1 pessoa): o e.php confere no máximo a cada 10 min
    resetarLimites();
    medir(novoNav(), uuid4(), uuid4(), [['t' => 'hb', 'p' => 0]], ctx());
    for ($i = 0; $i < 30 && !str_contains($lerRecebidos(), 'pico'); $i++) {
        usleep(100_000);
    }
    checar('pico de gente online → aviso (1 por hora)', str_contains($lerRecebidos(), 'pico de gente online'), $lerRecebidos());
});
proc_terminate($procR);
proc_close($procR);
admPost(['acao' => 'config', 'valores' => ['aviso_celular' => ['denuncia' => false, 'picoOnline' => 0]]]);
resetarLimites();

// ══ 14. banco sem instalar (S22) ════════════════════════════════════════════════════════════════

secao('v3.2 · arquivos novos com o banco antigo (S22): o jogo não quebra, o painel diz "rode o instalar.php"');
q("DELETE FROM site_config WHERE chave = '_esquema'");
q('ALTER TABLE usuarios DROP COLUMN hall_bloqueado');
q('ALTER TABLE visitas DROP COLUMN rota, DROP COLUMN modo_atual');
$r1 = $navX->pedir('GET', '/api/carreiras.php');
$r2 = salvarC($navX, hallEntry('x-s22', ['nota' => 50]));
$r3 = hallGet();
$r4 = $navX->pedir('GET', '/api/conta.php');
$sidS22 = uuid4();
$r5 = medir($navX, uuid4(), $sidS22, [['t' => 'view', 'd' => ['rota' => '/hall']], ['t' => 'hb', 'p' => 1, 'm' => 'classico']], ctx());
checar('carreiras (listar e salvar), Hall, conta e medição seguem funcionando (sem 500); a visita é gravada sem as colunas novas', $r1->status === 200 && $r2->status === 200
    && $r3->status === 200 && $r4->status === 200 && $r5->status === 204 && visita($sidS22) !== null, $r1->resumo() . ' ' . $r5->resumo());
$navS22 = clone $ADM;
$navS22->conferir = false; // o 503 é a resposta esperada aqui (a conferência genérica marca todo 5xx)
$r = $navS22->pedir('GET', '/api/admin.php?r=usuarios');
checar('admin numa tela que usa coluna nova → 503 instalar ("rode o instalar.php")', $r->status === 503 && $r->erro() === 'instalar' && str_contains((string) ($r->json['mensagem'] ?? ''), 'instalar.php'), $r->resumo());
$r = $anon->pedir('POST', '/api/instalar.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
checar('instalar → as colunas voltam e _esquema = 33 (v3.3); o admin volta', $r->status === 200 && count($r->json['alteracoes'] ?? []) === 3
    && (int) v("SELECT valor FROM site_config WHERE chave = '_esquema'") === 33 && admGet('r=usuarios')->status === 200, $r->resumo());

// ══ 15. LGPD: o que é da conta sai com ela ══════════════════════════════════════════════════════

secao('v3.2 · LGPD: excluir a conta apaga a anotação, a lixeira, os e-mails registrados, o aviso e os caches');
foreach (['jogador' => 'conta', 'painel' => 'admin'] as $quem => $via) {
    $apZ = $via === 'conta' ? 'Apagavel Um' : 'Apagavel Dois';
    [$navZ, $uZ, , , $emailZ] = novaConta($apZ);
    salvarC($navZ, hallEntry("z-$quem-1", ['nota' => 60]));
    salvarC($navZ, hallEntry("z-$quem-2", ['nota' => 61]));
    admPost(['acao' => 'nota', 'id' => $uZ, 'texto' => 'Telefone dele: 1234']);
    admPost(['acao' => 'apagar_carreira', 'id' => pkCarreira("z-$quem-1", $uZ), 'motivo' => 'x']);
    admPost(['acao' => 'ocultar_carreira', 'id' => pkCarreira("z-$quem-2", $uZ), 'motivo' => 'x', 'avisar' => true]);
    resetarLimitesCurtos();
    admPost(['acao' => 'enviar_redefinicao', 'id' => $uZ]);
    admGet('r=atencao&atualizar=1');
    $hashZ = quemEmailTeste($emailZ);
    q("DELETE FROM email_log WHERE tipo = 'verificacao' AND para_hash = ?", [$hashZ]); // v3.3: o do código de confirmação do cadastro
    checar("($quem) antes: nota, aviso, lixeira e e-mail registrados", v('SELECT nota_admin FROM usuarios WHERE id = ?', [$uZ]) !== null
        && (int) v('SELECT COUNT(*) FROM lixeira_carreiras WHERE usuario_id = ?', [$uZ]) === 1 && (int) v('SELECT COUNT(*) FROM email_log WHERE para_hash = ?', [$hashZ]) === 1);
    if ($via === 'conta') {
        $r = conta($navZ, ['acao' => 'excluir', 'senha' => 'senha-v3-' . $CONTAS_N]);
    } else {
        $r = admPost(['acao' => 'excluir_usuario', 'id' => $uZ, 'confirma' => $apZ, 'motivo' => 'pedido_titular']);
    }
    checar("($quem) excluir → a lixeira dela, os e-mails registrados (pelo HMAC) e os caches que podiam citá-la somem", $r->status === 200
        && (int) v('SELECT COUNT(*) FROM usuarios WHERE id = ?', [$uZ]) === 0 && (int) v('SELECT COUNT(*) FROM lixeira_carreiras WHERE usuario_id = ?', [$uZ]) === 0
        && (int) v('SELECT COUNT(*) FROM email_log WHERE para_hash = ?', [$hashZ]) === 0 && (int) v("SELECT COUNT(*) FROM site_config WHERE chave IN ('_atencao', '_multicontas')") === 0
        && (int) v("SELECT COUNT(*) FROM admin_log WHERE detalhes LIKE '%Telefone%' OR detalhes LIKE '%Apagavel%'") === 0, $r->resumo());
}

// ══ 16. os módulos novos nunca são servidos ═════════════════════════════════════════════════════

secao('v3.2 · módulos novos (_atencao, _moderacao, _relatorios, _celular) nunca são servidos');
$servidos = [];
foreach (['_atencao.php', '_moderacao.php', '_relatorios.php', '_celular.php'] as $arq) {
    $r = $anon->pedir('GET', "/api/$arq");
    if ($r->status !== 404 || $r->corpo !== '') {
        $servidos[] = "php -S $arq → $r->status";
    }
    if ($URL_APACHE !== '') {
        $ap = new Navegador($URL_APACHE, null);
        $ap->conferir = false;
        $r = $ap->pedir('GET', "/api/$arq");
        if ($r->status !== 403) {
            $servidos[] = "Apache $arq → $r->status";
        }
    }
}
checar('chamados direto: 404 sem corpo (a guarda do arquivo) e, no Apache, 403 (o .htaccess)', !$servidos, implode(', ', $servidos));

// ══ 17. entradas estranhas em todas as rotas novas (nenhum 500) ═════════════════════════════════

secao('v3.2 · tipos errados e valores estranhos nas rotas novas (nenhum 500)');
$quinhentos = [];
$estranhos = [null, true, -1, 0, 1.5, '', 'abc', '1; DROP TABLE x', str_repeat('x', 5000), [], [1], ['a' => 1], 1e300, '9999999999999'];
foreach (['alerta_dispensar' => ['chave'], 'alerta_reabrir' => ['chave'], 'carreiras_lote' => ['ids', 'operacao', 'motivo', 'avisar', 'avisoMotivo'],
    'resolver_denuncias_lote' => ['carreiras', 'resultado', 'motivo'], 'indicacoes_lote' => ['ids', 'operacao', 'motivo'], 'nota' => ['id', 'texto'],
    'mudar_tipo' => ['id', 'tipo', 'motivo'], 'bloquear_hall' => ['id', 'sim', 'motivo'], 'restaurar_carreira' => ['id'], 'liberar_reenvio' => ['id'],
    'enviar_redefinicao' => ['id'], 'destacar_carreira' => ['id', 'sim'], 'tirar_bonus_lote' => ['ids', 'motivo'], 'excluir_usuario' => ['id', 'confirma', 'motivo'],
    'ocultar_carreira' => ['id', 'motivo', 'avisar', 'avisoMotivo'], 'config' => ['valores']] as $ac => $campos) {
    foreach ($campos as $campo) {
        foreach ($estranhos as $val) {
            resetarLimitesCurtos();
            $base = ['acao' => $ac, 'id' => $uX, 'ids' => [1], 'carreiras' => [1], 'operacao' => 'ocultar', 'resultado' => 'ok', 'motivo' => 'x', 'sim' => true, 'tipo' => 'jogador',
                'texto' => 'x', 'chave' => 'suspeitas', 'confirma' => 'nao confere'];
            if ($ac === 'config') {
                $base['valores'] = ['avisos' => $val, 'hall_revisao_nota' => $val, 'aviso_celular' => $val];
            }
            $r = admPost([$campo => $val] + $base);
            if ($r->status >= 500 || !is_array($r->json)) {
                $quinhentos[] = "$ac.$campo=" . substr(json_encode($val), 0, 20) . " → $r->status";
            }
        }
    }
}
foreach (['atencao&atualizar[]=1', 'agora&bots[]=1', 'lixeira&pagina=abc', 'multicontas&pagina=999999', 'emails&email[]=x', 'emails&email=' . str_repeat('a', 300),
    'relatorio&tipo[]=base', 'relatorio&tipo=base&conta[]=x', 'relatorio&tipo=base&pagina=10000', 'tempo&jan[]=x', 'tempo&usuario=99999999999', 'eventos&dias=abc', 'eventos&dias=-5',
    'eventos&tipo[]=x', 'bonus&estado[]=x', 'bonus&usuario=abc', 'log&porDia=999', 'log&porDia=abc', 'log&de=2026-02-31', 'log&quem[]=x', 'log&q=' . str_repeat('%', 100),
    'usuarios&sumido=99999', 'usuario&id=abc', 'hall&filtro[]=x', 'carreira&carreiraId[]=x', 'indicacoes&status[]=x', 'indicacoes&indicador=abc'] as $rota) {
    $r = admGet('r=' . $rota);
    if ($r->status >= 500 || !is_array($r->json)) {
        $quinhentos[] = "GET $rota → $r->status";
    }
}
checar('nenhuma combinação deu 500 ou resposta fora de JSON', !$quinhentos, implode(' | ', array_slice($quinhentos, 0, 8)));
resetarLimites();
limparV32();

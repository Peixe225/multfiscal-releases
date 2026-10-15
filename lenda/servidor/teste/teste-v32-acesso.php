<?php
/**
 * LENDA · testes da v3.2, acesso ao painel (CONTRATO-v32 §B): painel desligado, entrada com a senha do arquivo (conta
 * Dono), sessões no servidor (revogar, 8 h, 2 h sem uso, token novo a cada etapa, sair de todos), PIN, contas pessoais
 * (trocar a senha, senha provisória, limites), equipe e papéis (hierarquia, último dono), poderes negados para cada papel
 * em cada ação, recados e presença, bloco Segurança, CSRF, Saúde (sem segredo nenhum), backup, cópias no servidor e
 * restauração (completar, substituir, antes-de-restaurar, caminho malicioso, arquivo estragado, equipe sem senha).
 * Incluído pelo teste.php (usa os ajudantes dele e os do teste-v3.php). Deixa a equipe vazia no fim (a próxima entrada
 * com a senha do arquivo cria a conta Dono de novo, sem PIN), como os outros testes esperam.
 */
declare(strict_types=1);

$AC_BASE = dirname($CONFIG_ARQ);
$AC_PASTA = $AC_BASE . '/lenda-copias';
$AC_WWW = $AC_BASE . '/public_html';
$AC_SEGREDO = (string) getenv('LENDA_SEGREDO');
$AC_CFG = (string) file_get_contents($CONFIG_ARQ);
preg_match("/'admin_senha_hash' => '([^']+)'/", $AC_CFG, $mmAc);
$AC_HASH_SENHA = $mmAc[1] ?? '';
preg_match("/'admin_token_sha256' => '([0-9a-f]{64})'/", $AC_CFG, $mmAc);
$AC_TOKEN_SHA = $mmAc[1] ?? '';

// ── ajudantes (prefixo ac: o teste da moderação roda no mesmo processo) ──────────────────────────

function acPainel(Navegador $n, array $corpo, array $opc = []): Resposta
{
    return $n->pedir('POST', '/api/painel.php', $corpo, $opc);
}

function acEquipe(Navegador $n, array $corpo, array $opc = []): Resposta
{
    return $n->pedir('POST', '/api/equipe.php', $corpo, $opc);
}

function acEquipeGet(Navegador $n, string $qs, array $opc = []): Resposta
{
    return $n->pedir('GET', '/api/equipe.php?' . $qs, null, $opc);
}

/** Opções de um pedido com o Bearer (sem Origin, como um script). */
function acBearer(): array
{
    global $PAINEL_TOKEN;
    return ['auth' => 'Bearer ' . $PAINEL_TOKEN, 'origem' => false];
}

function acLimparEquipe(): void
{
    foreach (['admin_sessoes', 'admin_contas', 'admin_papeis', 'admin_recados'] as $t) {
        q("DELETE FROM $t");
    }
    resetarLimites();
}

/** Entra com a senha do arquivo (e o PIN, se a conta Dono já tem um). */
function acEntrarDono(?string $pin = null): Navegador
{
    global $PAINEL_SENHA;
    resetarLimitesCurtos();
    $n = novoNav();
    $r = acPainel($n, ['acao' => 'entrar', 'senha' => $PAINEL_SENHA]);
    if (($r->json['etapa'] ?? '') === 'pin' && $pin !== null) {
        $r = acPainel($n, ['acao' => 'conferir_pin', 'pin' => $pin]);
    }
    if (($r->json['etapa'] ?? '') !== 'pronto') {
        checar('entrar como Dono (preparação)', false, $r->resumo());
    }
    return $n;
}

/** Entra numa conta pessoal: senha → (troca a provisória) → PIN (cria ou confere) → pronto. */
function acEntrarConta(string $email, string $senha, string $pin, ?string $novaSenha = null): Navegador
{
    resetarLimitesCurtos();
    $n = novoNav();
    $r = acPainel($n, ['acao' => 'entrar', 'email' => $email, 'senha' => $senha]);
    for ($i = 0; $i < 4 && $r->status === 200 && ($r->json['etapa'] ?? '') !== 'pronto'; $i++) {
        $e = $r->json['etapa'] ?? '';
        if ($e === 'pin') {
            $r = acPainel($n, ['acao' => 'conferir_pin', 'pin' => $pin]);
        } elseif ($e === 'criar_pin') {
            $r = acPainel($n, ['acao' => 'criar_pin', 'pin' => $pin, 'repetir' => $pin]);
        } elseif ($e === 'trocar_senha') {
            $r = acPainel($n, ['acao' => 'trocar_senha', 'nova' => $novaSenha ?? ($senha . '-nova-123')]);
        }
    }
    if (($r->json['etapa'] ?? '') !== 'pronto') {
        checar("entrar como $email (preparação)", false, $r->resumo());
    }
    return $n;
}

/** Cria uma pessoa da equipe (por $quem, ou pelo Bearer) e a deixa pronta. Devolve [id, navegador, senha]. */
function acNovaPessoa(?Navegador $quem, string $email, string $papel, string $pin): array
{
    $r = acEquipe($quem ?? novoNav(), ['acao' => 'equipe_criar', 'email' => $email, 'nome' => 'Pessoa ' . $papel, 'papel' => $papel],
        $quem === null ? acBearer() : []);
    if ($r->status !== 201) {
        checar("criar $email ($papel) (preparação)", false, $r->resumo());
        return [0, novoNav(), ''];
    }
    $senha = 'senha-de-' . $papel . '-' . bin2hex(random_bytes(4));
    return [(int) $r->json['id'], acEntrarConta($email, (string) $r->json['senha'], $pin, $senha), $senha];
}

/** sha256 do token do cookie do painel deste navegador (o que fica no banco). */
function acSha(Navegador $n): string
{
    return hash('sha256', explode('.', (string) ($n->jar['lenda_painel'] ?? ''))[0]);
}

function acUltimoLog(string $acao): ?array
{
    return q('SELECT * FROM admin_log WHERE acao = ? ORDER BY id DESC LIMIT 1', [$acao])[0] ?? null;
}

function acContaLog(string $acao): int
{
    return (int) v('SELECT COUNT(*) FROM admin_log WHERE acao = ?', [$acao]);
}

/** Descomprime um gzip de vários membros (o backup sai em pedaços). */
function acGunzip(string $gz): ?string
{
    global $AC_BASE;
    $tmp = $AC_BASE . '/ac-' . bin2hex(random_bytes(4)) . '.gz';
    file_put_contents($tmp, $gz);
    $out = '';
    $h = @gzopen($tmp, 'rb');
    if ($h === false) {
        @unlink($tmp);
        return null;
    }
    while (!gzeof($h)) {
        $p = gzread($h, 1 << 20);
        if ($p === false) {
            break;
        }
        $out .= $p;
    }
    gzclose($h);
    unlink($tmp);
    return $out;
}

/** Escreve um backup (array) no formato do servidor (uma linha por registro), em gzip, na pasta das cópias. */
function acEscreverCopia(string $nome, array $b, ?callable $mexer = null): void
{
    global $AC_PASTA;
    $l = substr(json_encode(['versao' => $b['versao'], 'geradoEm' => $b['geradoEm'], 'medicao' => $b['medicao'] ?? false,
        'binarios' => (object) ($b['binarios'] ?? [])], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 0, -1) . ',"tabelas":{' . "\n";
    $tabs = array_keys($b['tabelas']);
    foreach ($tabs as $i => $t) {
        $l .= json_encode($t) . ":[\n";
        $rows = array_map(static fn($r) => json_encode($r, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $b['tabelas'][$t]);
        $l .= $rows ? implode(",\n", $rows) . "\n" : '';
        $l .= ($i === count($tabs) - 1 ? ']' : '],') . "\n";
    }
    $l .= '},"contagem":' . json_encode((object) $b['contagem']) . "}\n";
    if ($mexer !== null) {
        $l = $mexer($l);
    }
    file_put_contents("$AC_PASTA/$nome", gzencode($l));
}

/** O backup de uma cópia da pasta, lido inteiro (para o teste comparar). */
function acLerCopia(string $nome): ?array
{
    global $AC_PASTA;
    $txt = acGunzip((string) @file_get_contents("$AC_PASTA/$nome"));
    return $txt === null ? null : json_decode($txt, true);
}

function acArquivosNaPasta(): array
{
    global $AC_PASTA;
    return array_values(array_filter(scandir($AC_PASTA) ?: [], static fn(string $f): bool => str_ends_with($f, '.json.gz')));
}

$AC_PIN_DONO = '204816';
$AC_EMAIL_P = 'dona.pessoal@exemplo.com';
$AC_SENHA_P = 'senha-pessoal-da-dona-2026';
$AC_PIN_P = '730195';

// ══ painel desligado, modo ═══════════════════════════════════════════════════════════════════════

secao('v3.2 acesso · modo da entrada e painel desligado (S1)');
acLimparEquipe();
$r = $anon->pedir('GET', '/api/painel.php?so=modo');
checar('?so=modo sem login → "senha" (só a senha do arquivo, nenhuma conta pessoal)', $r->status === 200 && ($r->json ?? null) === ['modo' => 'senha'], $r->resumo());
checar('o banco tem as tabelas da equipe (admin_contas, admin_sessoes, admin_papeis, admin_recados)',
    count(array_intersect(['admin_contas', 'admin_sessoes', 'admin_papeis', 'admin_recados'], array_column(q('SHOW TABLES'), array_key_first(q('SHOW TABLES')[0])))) === 4);
comConfig(['admin_senha_hash' => ''], static function () use ($anon): void {
    $r = $anon->pedir('GET', '/api/painel.php?so=modo');
    checar('sem senha no arquivo e sem conta: ?so=modo → "desligado"', ($r->json['modo'] ?? '') === 'desligado', $r->resumo());
    $n = novoNav();
    $n->conferir = false;
    $r = acPainel($n, ['acao' => 'entrar', 'senha' => 'qualquer-uma']);
    checar('entrar com o painel desligado → 503 painel_desligado (e não "Senha incorreta")', $r->status === 503 && $r->erro() === 'painel_desligado'
        && str_contains((string) ($r->json['mensagem'] ?? ''), 'LEIAME') && !isset($r->cookies['lenda_painel']), $r->resumo());
    $r = novoNav()->pedir('GET', '/api/painel.php?so=agora', null, acBearer());
    checar('…o Bearer continua entrando (scripts e emergência)', $r->status === 200 && isset($r->json['agora']['online']), $r->resumo());
    checar('…e não conta como tentativa errada', (int) v("SELECT COALESCE(SUM(n), 0) FROM tentativas WHERE chave = 'painel-todos:todos'") === 0);
});

// ══ entrada com a senha do arquivo: a conta Dono ═════════════════════════════════════════════════

secao('v3.2 acesso · a senha de sempre entra e cria a conta Dono (P1-1)');
acLimparEquipe();
$D = novoNav();
$r = acPainel($D, ['acao' => 'entrar', 'senha' => $PAINEL_SENHA]);
$ck = $r->cookies['lenda_painel'] ?? null;
checar('entrar com a senha do arquivo → 200, etapa pronto, avisos criar_pin e crie_conta', $r->status === 200 && ($r->json['etapa'] ?? '') === 'pronto'
    && ($r->json['avisos'] ?? null) === ['criar_pin', 'crie_conta'] && ($r->json['aviso'] ?? '') === 'criar_pin', $r->resumo());
$at = strtolower($ck['attrs'] ?? '');
checar('cookie: <token>.<exp>.<hmac>, HttpOnly, SameSite=Strict, Path=/lenda/, 8 h', $ck !== null
    && preg_match('/^[A-Za-z0-9_-]{43}\.\d{10}\.[0-9a-f]{64}$/', $ck['valor']) === 1 && str_contains($at, 'httponly') && str_contains($at, 'samesite=strict')
    && str_contains($at, 'path=/lenda/') && str_contains($at, 'max-age=28800'), json_encode($ck));
$contas = q('SELECT * FROM admin_contas');
$idDono = (int) ($contas[0]['id'] ?? 0);
checar('a primeira entrada criou a conta Dono (da_config, e-mail vazio, papel dono, sem PIN) sem copiar o hash da senha', count($contas) === 1
    && (int) $contas[0]['da_config'] === 1 && $contas[0]['email'] === '' && $contas[0]['papel'] === 'dono' && $contas[0]['pin_hash'] === null
    && $contas[0]['senha_hash'] !== $AC_HASH_SENHA && $contas[0]['ultimo_acesso'] !== null, json_encode($contas));
$ses = q('SELECT * FROM admin_sessoes');
checar('sessão no servidor: só o sha256 do token, etapa pronto, 8 h, aparelho, sem IP', count($ses) === 1 && $ses[0]['token_sha256'] === acSha($D)
    && $ses[0]['etapa'] === 'pronto' && (int) $ses[0]['admin_id'] === $idDono && $ses[0]['aparelho'] === 'computador'
    && abs((int) strtotime($ses[0]['expira_em'] . ' UTC') - (time() + 28800)) <= 5 && !str_contains(json_encode($ses), '127.0.0.1'), json_encode($ses));
$r = acPainel(novoNav(), ['acao' => 'entrar', 'senha' => $PAINEL_SENHA]);
checar('entrar de novo: a mesma conta Dono (não cria outra)', $r->status === 200 && (int) v('SELECT COUNT(*) FROM admin_contas') === 1);
$r = $D->pedir('GET', '/api/painel.php?so=sessao');
$qd = $r->json['quem'] ?? [];
checar('?so=sessao: quem (Dono, senha do arquivo), os 9 poderes, avisos e os aparelhos (com o atual)', $r->status === 200 && ($qd['daConfig'] ?? null) === true
    && ($qd['papel'] ?? '') === 'dono' && ($qd['id'] ?? 0) === $idDono && count($r->json['poderes'] ?? []) === 9 && ($r->json['avisos'] ?? null) === ['criar_pin', 'crie_conta']
    && count(array_filter($r->json['sessoes'] ?? [], static fn($s) => $s['atual'] === true)) === 1 && preg_match('/^[0-9a-f]{12}$/', (string) ($r->json['sessoes'][0]['id'] ?? '')) === 1,
    $r->resumo());
$lg = acUltimoLog('painel_entrar');
checar('registro: painel_entrar com quem = a<id> e o código do aparelho do dia (16 hex, nunca o IP)', $lg !== null && $lg['quem'] === 'a' . $idDono
    && preg_match('/^[0-9a-f]{16}$/', (string) $lg['ip_dia']) === 1 && $lg['alvo'] === 'admin:' . $idDono
    && (json_decode((string) $lg['detalhes'], true)['via'] ?? '') === 'painel', json_encode($lg));
$r = acPainel(novoNav(), ['acao' => 'entrar', 'senha' => 'errada-' . $PAINEL_SENHA]);
$lg = acUltimoLog('painel_falha');
checar('senha errada → 401 credenciais e registro painel_falha (sem quem, motivo senha_arquivo, sem a senha digitada)', $r->status === 401 && $r->erro() === 'credenciais'
    && $lg !== null && $lg['quem'] === null && (json_decode((string) $lg['detalhes'], true)['motivo'] ?? '') === 'senha_arquivo'
    && !str_contains((string) $lg['detalhes'], 'errada'), $r->resumo() . ' ' . json_encode($lg));
$r = $D->pedir('GET', '/api/admin.php?r=resumo');
checar('com a sessão: admin.php responde', $r->status === 200 && isset($r->json['usuarios']), $r->resumo());

// ══ sessões no servidor ══════════════════════════════════════════════════════════════════════════

secao('v3.2 acesso · sessões no servidor: sair, revogar, 8 h, 2 h sem uso, sair de todos (P1-1, X9)');
$S1 = acEntrarDono();
$S2 = acEntrarDono();
$copiaCookie = $S1->jar['lenda_painel'];
$r = acPainel($S1, ['acao' => 'sair']);
$copia = novoNav();
$copia->jar['lenda_painel'] = $copiaCookie;
checar('sair: 200, apaga o cookie e a linha no servidor', $r->status === 200 && !isset($S1->jar['lenda_painel'])
    && (int) v('SELECT COUNT(*) FROM admin_sessoes WHERE token_sha256 = ?', [hash('sha256', explode('.', $copiaCookie)[0])]) === 0, $r->resumo());
checar('o cookie copiado antes de sair não abre mais nada (o servidor revogou)', $copia->pedir('GET', '/api/painel.php?so=agora')->status === 401
    && $copia->pedir('GET', '/api/admin.php?r=resumo')->status === 401 && $copia->pedir('GET', '/api/equipe.php?r=papeis')->status === 401);
checar('…só o ?so=eu (sem banco, para o jogo) ainda diz admin até o cookie vencer', $copia->pedir('GET', '/api/painel.php?so=eu')->status === 200);
checar('registro: painel_sair', (acUltimoLog('painel_sair')['quem'] ?? '') === 'a' . $idDono);
q('UPDATE admin_sessoes SET visto_em = UTC_TIMESTAMP() - INTERVAL 5 MINUTE WHERE token_sha256 = ?', [acSha($S2)]);
$S2->pedir('GET', '/api/painel.php?so=agora');
checar('visto_em é atualizado com o uso (no máximo a cada 60 s)', (int) v('SELECT TIMESTAMPDIFF(SECOND, visto_em, UTC_TIMESTAMP()) FROM admin_sessoes WHERE token_sha256 = ?', [acSha($S2)]) <= 5);
q('UPDATE admin_sessoes SET visto_em = UTC_TIMESTAMP() - INTERVAL 121 MINUTE WHERE token_sha256 = ?', [acSha($S2)]);
checar('2 h sem uso → a sessão cai (401) e sai do banco', $S2->pedir('GET', '/api/painel.php?so=agora')->status === 401
    && (int) v('SELECT COUNT(*) FROM admin_sessoes WHERE token_sha256 = ?', [acSha($S2)]) === 0);
$S3 = acEntrarDono();
q('UPDATE admin_sessoes SET expira_em = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE token_sha256 = ?', [acSha($S3)]);
checar('passou das 8 h → 401 (mesmo usada agora)', $S3->pedir('GET', '/api/painel.php?so=agora')->status === 401);
$S4 = acEntrarDono();
$tok = explode('.', $S4->jar['lenda_painel']);
$S5 = novoNav();
$S5->jar['lenda_painel'] = strrev($tok[0]) . '.' . $tok[1] . '.' . $tok[2];
checar('token trocado no cookie (assinatura não confere) → 401', $S5->pedir('GET', '/api/painel.php?so=agora')->status === 401);
$S5->jar['lenda_painel'] = $tok[0] . '.' . $tok[1] . '.' . hash_hmac('sha256', 'painel|' . $tok[0] . '|' . $tok[1], $AC_SEGREDO);
checar('cookie assinado só com o segredo (sem o hash da senha na chave) → 401', $S5->pedir('GET', '/api/painel.php?so=agora')->status === 401);
$S6 = acEntrarDono();
$S7 = acEntrarDono();
$idS7 = substr(acSha($S7), 0, 12);
$r = acEquipe($S6, ['acao' => 'sessao_encerrar', 'sessao' => $idS7]);
checar('encerrar uma sessão minha de outro aparelho (pela lista) → 200 e ela cai', $r->status === 200 && $S7->pedir('GET', '/api/painel.php?so=agora')->status === 401, $r->resumo());
$S8 = acEntrarDono();
$r = acPainel($S6, ['acao' => 'sair_todos']);
checar('sair de todos os aparelhos: as outras caem, esta continua', $r->status === 200 && ($r->json['encerradas'] ?? 0) >= 2
    && $S8->pedir('GET', '/api/painel.php?so=agora')->status === 401 && $S4->pedir('GET', '/api/painel.php?so=agora')->status === 401
    && $S6->pedir('GET', '/api/painel.php?so=agora')->status === 200 && (acUltimoLog('sair_todos')['quem'] ?? '') === 'a' . $idDono, $r->resumo());
$r = acPainel(novoNav(), ['acao' => 'sair_todos'], ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
$r2 = acPainel(novoNav(), ['acao' => 'sair_todos'], acBearer());
checar('sair_todos com o Bearer → 400 (o token não tem sessões); a entrada do painel sempre pede o Origin (403); sair sem sessão → 200',
    $r->status === 400 && $r->erro() === 'conta' && $r2->status === 403 && acPainel(novoNav(), ['acao' => 'sair'])->status === 200, $r->resumo() . ' / ' . $r2->resumo());
$D = $S6;

// ══ PIN ══════════════════════════════════════════════════════════════════════════════════════════

secao('v3.2 acesso · PIN de 6 dígitos: criar, conferir, 3 erros em 10 min, etapa de 10 min (P1-2)');
$r = acPainel($D, ['acao' => 'criar_pin', 'pin' => $AC_PIN_DONO, 'repetir' => $AC_PIN_DONO]);
checar('criar o PIN na sessão pronta pede a senha de novo (um cookie copiado não tranca o dono para fora)', $r->status === 401 && $r->erro() === 'credenciais', $r->resumo());
$r = acPainel($D, ['acao' => 'criar_pin', 'pin' => $AC_PIN_DONO, 'repetir' => $AC_PIN_DONO, 'senha' => 'errada-mesmo']);
checar('…com a senha errada → 401', $r->status === 401, $r->resumo());
foreach (['123456' => 'pin_fraco', '111111' => 'pin_fraco', '987654' => 'pin_fraco', '12345' => 'pin_formato', '12a456' => 'pin_formato', '1234567' => 'pin_formato'] as $pinRuim => $cod) {
    $r = acPainel($D, ['acao' => 'criar_pin', 'pin' => (string) $pinRuim, 'repetir' => (string) $pinRuim, 'senha' => $PAINEL_SENHA]);
    checar("PIN $pinRuim recusado ($cod)", $r->status === 400 && $r->erro() === $cod, $r->resumo());
}
$r = acPainel($D, ['acao' => 'criar_pin', 'pin' => $AC_PIN_DONO, 'repetir' => '204817', 'senha' => $PAINEL_SENHA]);
checar('PIN e repetição diferentes → 400 pin_diferente', $r->status === 400 && $r->erro() === 'pin_diferente', $r->resumo());
$shaAntes = acSha($D);
$r = acPainel($D, ['acao' => 'criar_pin', 'pin' => $AC_PIN_DONO, 'repetir' => $AC_PIN_DONO, 'senha' => $PAINEL_SENHA]);
$pinHash = (string) v('SELECT pin_hash FROM admin_contas WHERE id = ?', [$idDono]);
checar('PIN criado → 200, token novo, guardado só em hash (com o segredo junto: o hash sozinho não basta)', $r->status === 200 && acSha($D) !== $shaAntes
    && (int) v('SELECT COUNT(*) FROM admin_sessoes WHERE token_sha256 = ?', [$shaAntes]) === 0 && str_starts_with($pinHash, '$2y$')
    && !password_verify($AC_PIN_DONO, $pinHash) && ($r->json['avisos'] ?? null) === ['crie_conta'] && acContaLog('pin_definido') === 1, $r->resumo());
$r = acPainel($D, ['acao' => 'criar_pin', 'pin' => '501739', 'repetir' => '501739', 'senha' => $PAINEL_SENHA]);
checar('criar outro PIN por cima → 409 tem_pin', $r->status === 409 && $r->erro() === 'tem_pin', $r->resumo());
resetarLimitesCurtos();
$E = novoNav();
$r = acPainel($E, ['acao' => 'entrar', 'senha' => $PAINEL_SENHA]);
$shaEtapa = acSha($E);
checar('com PIN, a senha leva à etapa "pin" (restam 3)', $r->status === 200 && ($r->json['etapa'] ?? '') === 'pin' && ($r->json['restam'] ?? 0) === 3, $r->resumo());
checar('na etapa do PIN nada abre: painel, admin.php, equipe.php e o ?so=eu do jogo → 401', $E->pedir('GET', '/api/painel.php?so=agora')->status === 401
    && $E->pedir('GET', '/api/admin.php?r=resumo')->status === 401 && $E->pedir('GET', '/api/equipe.php?r=papeis')->status === 401
    && $E->pedir('GET', '/api/painel.php?so=eu')->status === 401);
$r = $E->pedir('GET', '/api/painel.php?so=sessao');
checar('?so=sessao na etapa → {etapa: pin, restam: 3} (sem poderes)', $r->status === 200 && ($r->json['etapa'] ?? '') === 'pin' && ($r->json['restam'] ?? 0) === 3
    && !isset($r->json['poderes']), $r->resumo());
$r1 = acPainel($E, ['acao' => 'conferir_pin', 'pin' => '000001']);
$r2 = acPainel($E, ['acao' => 'conferir_pin', 'pin' => '000002']);
$r3 = acPainel($E, ['acao' => 'conferir_pin', 'pin' => '000003']);
$r4 = acPainel($E, ['acao' => 'conferir_pin', 'pin' => $AC_PIN_DONO]);
checar('PIN errado: 401 "Restam 2", 401 "Restam 1", e o 3º erro trava (429 pin_travado); o certo também fica barrado',
    $r1->status === 401 && $r1->erro() === 'pin' && ($r1->json['restam'] ?? 0) === 2 && str_contains((string) ($r1->json['mensagem'] ?? ''), 'Restam 2')
    && $r2->status === 401 && ($r2->json['restam'] ?? 0) === 1 && $r3->status === 429 && $r3->erro() === 'pin_travado' && $r4->status === 429,
    implode(' / ', [$r1->resumo(), $r2->resumo(), $r3->resumo(), $r4->resumo()]));
checar('registro: 3 painel_pin_errado e o painel_pin_travado', acContaLog('painel_pin_errado') === 3 && acContaLog('painel_pin_travado') >= 1);
resetarLimitesCurtos();
$r = acPainel($E, ['acao' => 'conferir_pin', 'pin' => $AC_PIN_DONO]);
checar('passados os 10 min (limites zerados): PIN certo → pronto, com token novo (o da etapa sai do banco)', $r->status === 200 && ($r->json['etapa'] ?? '') === 'pronto'
    && acSha($E) !== $shaEtapa && (int) v('SELECT COUNT(*) FROM admin_sessoes WHERE token_sha256 = ?', [$shaEtapa]) === 0
    && $E->pedir('GET', '/api/painel.php?so=agora')->status === 200 && $E->pedir('GET', '/api/painel.php?so=eu')->status === 200, $r->resumo());
$r = acPainel($E, ['acao' => 'conferir_pin', 'pin' => $AC_PIN_DONO]);
checar('conferir_pin numa sessão já pronta → 409 etapa', $r->status === 409 && $r->erro() === 'etapa', $r->resumo());
$F = novoNav();
acPainel($F, ['acao' => 'entrar', 'senha' => $PAINEL_SENHA]);
q('UPDATE admin_sessoes SET expira_em = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE token_sha256 = ?', [acSha($F)]);
$r = acPainel($F, ['acao' => 'conferir_pin', 'pin' => $AC_PIN_DONO]);
checar('etapa do PIN depois de 10 min → 401 etapa_expirou ("Demorou demais")', $r->status === 401 && $r->erro() === 'etapa_expirou'
    && str_contains((string) ($r->json['mensagem'] ?? ''), 'Demorou'), $r->resumo());
$r = acEquipe(novoNav(), ['acao' => 'zerar_pin', 'adminId' => $idDono], acBearer());
$r2 = acPainel(novoNav(), ['acao' => 'entrar', 'senha' => $PAINEL_SENHA]);
checar('esqueceu o PIN: zerar_pin com o Bearer → 200, as sessões da conta caem e a próxima entrada não pede PIN', $r->status === 200
    && $E->pedir('GET', '/api/painel.php?so=agora')->status === 401 && ($r2->json['etapa'] ?? '') === 'pronto' && ($r2->json['avisos'][0] ?? '') === 'criar_pin',
    $r->resumo() . ' / ' . $r2->resumo());
$D = acEntrarDono();
$r = acPainel($D, ['acao' => 'criar_pin', 'pin' => $AC_PIN_DONO, 'repetir' => $AC_PIN_DONO, 'senha' => $PAINEL_SENHA]);
checar('(o Dono cadastra o PIN de novo)', $r->status === 200, $r->resumo());

// ══ contas pessoais, trocar a senha, limites ═════════════════════════════════════════════════════

secao('v3.2 acesso · conta pessoal: criar, e-mail + senha, PIN obrigatório, trocar a senha, limites (P1-1, S2, S8, S19)');
$r = acPainel($D, ['acao' => 'criar_conta', 'email' => $AC_EMAIL_P, 'nome' => 'Dona Pessoal', 'senha' => 'curta']);
checar('criar a conta pessoal com senha curta → 400 senha (12+)', $r->status === 400 && $r->erro() === 'senha', $r->resumo());
$r = acPainel($D, ['acao' => 'criar_conta', 'email' => 'nao-e-email', 'nome' => 'Dona', 'senha' => $AC_SENHA_P]);
checar('…e-mail inválido → 400 email', $r->status === 400 && $r->erro() === 'email', $r->resumo());
$shaD = acSha($D);
$r = acPainel($D, ['acao' => 'criar_conta', 'email' => strtoupper($AC_EMAIL_P), 'nome' => 'Dona Pessoal', 'senha' => $AC_SENHA_P]);
$idP = (int) ($r->json['id'] ?? 0);
$cP = q('SELECT * FROM admin_contas WHERE id = ?', [$idP])[0] ?? [];
checar('criar a conta pessoal (da sessão da senha do arquivo) → 201; a sessão da senha do arquivo acaba; e-mail minúsculo, papel dono',
    $r->status === 201 && ($r->json['entrar'] ?? false) === true && !isset($D->jar['lenda_painel'])
    && (int) v('SELECT COUNT(*) FROM admin_sessoes WHERE token_sha256 = ?', [$shaD]) === 0 && ($cP['email'] ?? '') === $AC_EMAIL_P
    && ($cP['papel'] ?? '') === 'dono' && (int) ($cP['da_config'] ?? 1) === 0 && password_verify($AC_SENHA_P, (string) ($cP['senha_hash'] ?? '')), $r->resumo());
checar('?so=modo → "contas" (a tela mostra o campo E-mail)', ($anon->pedir('GET', '/api/painel.php?so=modo')->json['modo'] ?? '') === 'contas');
$D = acEntrarDono($AC_PIN_DONO);
$r = acPainel($D, ['acao' => 'criar_conta', 'email' => 'outra@exemplo.com', 'nome' => 'Outra', 'senha' => $AC_SENHA_P]);
checar('criar_conta de novo → 409 ja_tem_conta (a senha do arquivo continua entrando como Dono de emergência)', $r->status === 409 && $r->erro() === 'ja_tem_conta', $r->resumo());
resetarLimitesCurtos();
$P = novoNav();
$r = acPainel($P, ['acao' => 'entrar', 'email' => $AC_EMAIL_P, 'senha' => $AC_SENHA_P]);
checar('entrar com e-mail + senha → etapa criar_pin (o PIN é obrigatório na conta pessoal)', $r->status === 200 && ($r->json['etapa'] ?? '') === 'criar_pin', $r->resumo());
checar('…na etapa criar_pin nada abre', $P->pedir('GET', '/api/painel.php?so=agora')->status === 401 && $P->pedir('GET', '/api/admin.php?r=resumo')->status === 401);
$r = acPainel($P, ['acao' => 'criar_pin', 'pin' => '000000', 'repetir' => '000000']);
checar('…PIN fácil recusado na etapa também', $r->status === 400 && $r->erro() === 'pin_fraco', $r->resumo());
$r = acPainel($P, ['acao' => 'criar_pin', 'pin' => $AC_PIN_P, 'repetir' => $AC_PIN_P]);
checar('…PIN criado → pronto, sem avisos; painel_entrar registrado', $r->status === 200 && ($r->json['etapa'] ?? '') === 'pronto' && ($r->json['avisos'] ?? null) === []
    && (acUltimoLog('painel_entrar')['quem'] ?? '') === 'a' . $idP && $P->pedir('GET', '/api/painel.php?so=agora')->status === 200, $r->resumo());
$r = acPainel($P, ['acao' => 'criar_conta', 'email' => 'x@exemplo.com', 'nome' => 'X', 'senha' => $AC_SENHA_P]);
checar('criar_conta de uma conta pessoal → 403 (para outras pessoas é a aba Equipe)', $r->status === 403, $r->resumo());
resetarLimitesCurtos();
$r1 = acPainel(novoNav(), ['acao' => 'entrar', 'email' => $AC_EMAIL_P, 'senha' => 'senha-errada-da-dona']);
$r2 = acPainel(novoNav(), ['acao' => 'entrar', 'email' => 'ninguem@exemplo.com', 'senha' => $AC_SENHA_P]);
$r3 = acPainel(novoNav(), ['acao' => 'entrar', 'senha' => 'errada-sem-email']);
checar('senha errada, e-mail que não existe e senha do arquivo errada: o mesmo 401 "E-mail ou senha não conferem."', $r1->status === 401 && $r2->status === 401
    && $r3->status === 401 && $r1->erro() === 'credenciais' && $r2->erro() === 'credenciais'
    && ($r1->json['mensagem'] ?? '') === 'E-mail ou senha não conferem.' && ($r2->json['mensagem'] ?? '') === ($r1->json['mensagem'] ?? '-')
    && ($r3->json['mensagem'] ?? '') === ($r1->json['mensagem'] ?? '-'), $r1->resumo() . ' / ' . $r2->resumo() . ' / ' . $r3->resumo());
$mot = array_map(static fn($l) => json_decode((string) $l['detalhes'], true)['motivo'] ?? '', q("SELECT detalhes FROM admin_log WHERE acao = 'painel_falha' ORDER BY id DESC LIMIT 3"));
checar('registro das falhas: senha_arquivo, inexistente e senha (o e-mail digitado não vai para o registro)', $mot === ['senha_arquivo', 'inexistente', 'senha']
    && (int) v("SELECT COUNT(*) FROM admin_log WHERE detalhes LIKE '%ninguem@%'") === 0, json_encode($mot));
resetarLimites();
$st = [];
for ($i = 0; $i < 5; $i++) {
    $st[] = acPainel(novoNav(), ['acao' => 'entrar', 'email' => $AC_EMAIL_P, 'senha' => "errada-$i"])->status;
}
$r = acPainel(novoNav(), ['acao' => 'entrar', 'email' => $AC_EMAIL_P, 'senha' => $AC_SENHA_P]);
$r2 = acPainel(novoNav(), ['acao' => 'entrar', 'email' => $AC_EMAIL_P, 'senha' => $AC_SENHA_P]);
$r3 = acPainel(novoNav(), ['acao' => 'entrar', 'email' => 'outra-pessoa@exemplo.com', 'senha' => 'qualquer-coisa']);
checar('5 erros no mesmo e-mail em 30 min: o 6º pedido dá 429 (mesmo com a senha certa); outro e-mail continua sendo conferido',
    $st === [401, 401, 401, 401, 401] && $r->status === 429 && $r2->status === 429 && $r3->status === 401, implode(',', $st) . " / $r->status / $r2->status / $r3->status");
checar('…o bloqueio vai para o registro uma vez só por janela (painel_limite)', (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'painel_limite'") === 1);
resetarLimites();
$r = acPainel($P, ['acao' => 'minha_senha', 'atual' => 'nao-e-a-atual', 'nova' => 'uma-senha-nova-boa-2026']);
checar('trocar a senha com a atual errada → 401 credenciais + registro minha_senha_falha', $r->status === 401 && $r->erro() === 'credenciais'
    && (acUltimoLog('minha_senha_falha')['quem'] ?? '') === 'a' . $idP, $r->resumo());
$r = acPainel($P, ['acao' => 'minha_senha', 'atual' => $AC_SENHA_P, 'nova' => 'curta']);
$r2 = acPainel($P, ['acao' => 'minha_senha', 'atual' => $AC_SENHA_P, 'nova' => $AC_SENHA_P]);
checar('…nova curta ou igual à atual → 400 senha', $r->status === 400 && $r->erro() === 'senha' && $r2->status === 400 && $r2->erro() === 'senha', $r->resumo() . ' / ' . $r2->resumo());
$P2 = acEntrarConta($AC_EMAIL_P, $AC_SENHA_P, $AC_PIN_P);
$shaP = acSha($P);
$AC_SENHA_P_ANTIGA = $AC_SENHA_P;
$AC_SENHA_P = 'uma-senha-nova-boa-2026';
$r = acPainel($P, ['acao' => 'minha_senha', 'atual' => $AC_SENHA_P_ANTIGA, 'nova' => $AC_SENHA_P]);
checar('trocar a senha → 200, derruba as outras sessões, esta continua (com token novo)', $r->status === 200 && ($r->json['sessoesEncerradas'] ?? 0) >= 1
    && $P2->pedir('GET', '/api/painel.php?so=agora')->status === 401 && $P->pedir('GET', '/api/painel.php?so=agora')->status === 200 && acSha($P) !== $shaP
    && (acUltimoLog('minha_senha')['quem'] ?? '') === 'a' . $idP, $r->resumo());
resetarLimitesCurtos();
checar('…a senha antiga não entra mais; a nova leva ao PIN', acPainel(novoNav(), ['acao' => 'entrar', 'email' => $AC_EMAIL_P, 'senha' => $AC_SENHA_P_ANTIGA])->status === 401
    && (acPainel(novoNav(), ['acao' => 'entrar', 'email' => $AC_EMAIL_P, 'senha' => $AC_SENHA_P])->json['etapa'] ?? '') === 'pin');
$r = acPainel($D, ['acao' => 'minha_senha', 'atual' => $PAINEL_SENHA, 'nova' => 'outra-senha-qualquer-1']);
checar('trocar a senha da conta Dono (senha do arquivo) pelo painel → 409 use_conta', $r->status === 409 && $r->erro() === 'use_conta', $r->resumo());
resetarLimitesCurtos();

// ══ equipe e papéis ══════════════════════════════════════════════════════════════════════════════

secao('v3.2 acesso · equipe: criar com senha provisória, trocar no 1º acesso, papéis e hierarquia (S7, S11, S12)');
$r = acEquipe($P, ['acao' => 'equipe_criar', 'email' => 'moderadora@exemplo.com', 'nome' => 'Moderadora', 'papel' => 'moderador']);
$idM = (int) ($r->json['id'] ?? 0);
$provM = (string) ($r->json['senha'] ?? '');
checar('criar pessoa → 201 com a senha provisória (14 caracteres sem 0/O/1/l/I) mostrada só nesta resposta', $r->status === 201 && ($r->json['sorteada'] ?? false) === true
    && preg_match('/^[A-HJ-NP-Za-km-np-z2-9]{14}$/', $provM) === 1 && (int) v('SELECT trocar_senha FROM admin_contas WHERE id = ?', [$idM]) === 1, $r->resumo());
checar('…a senha provisória não vai para o registro', (int) v('SELECT COUNT(*) FROM admin_log WHERE detalhes LIKE ?', ['%' . $provM . '%']) === 0
    && (acUltimoLog('equipe_criar')['alvo'] ?? '') === 'admin:' . $idM);
$r = acEquipe($P, ['acao' => 'equipe_criar', 'email' => 'Moderadora@exemplo.com', 'nome' => 'Outra', 'papel' => 'leitor']);
checar('e-mail repetido → 409 email_em_uso; papel desconhecido → 400 papel', $r->status === 409 && $r->erro() === 'email_em_uso'
    && acEquipe($P, ['acao' => 'equipe_criar', 'email' => 'n@exemplo.com', 'nome' => 'Nome Bom', 'papel' => 'chefao'])->erro() === 'papel', $r->resumo());
resetarLimitesCurtos();
$M = novoNav();
$r = acPainel($M, ['acao' => 'entrar', 'email' => 'moderadora@exemplo.com', 'senha' => $provM]);
checar('1º acesso com a senha provisória → etapa trocar_senha (nada abre antes de trocar)', ($r->json['etapa'] ?? '') === 'trocar_senha'
    && $M->pedir('GET', '/api/admin.php?r=resumo')->status === 401 && $M->pedir('GET', '/api/painel.php?so=agora')->status === 401, $r->resumo());
$r1 = acPainel($M, ['acao' => 'trocar_senha', 'nova' => $provM]);
$r2 = acPainel($M, ['acao' => 'trocar_senha', 'nova' => 'curtinha']);
$senhaM = 'senha-da-moderadora-2026';
$r3 = acPainel($M, ['acao' => 'trocar_senha', 'nova' => $senhaM]);
$r4 = acPainel($M, ['acao' => 'criar_pin', 'pin' => '618204', 'repetir' => '618204']);
checar('…a mesma provisória ou curta → 400; a nova → criar_pin → pronto', $r1->status === 400 && $r2->status === 400 && ($r3->json['etapa'] ?? '') === 'criar_pin'
    && ($r4->json['etapa'] ?? '') === 'pronto' && (int) v('SELECT trocar_senha FROM admin_contas WHERE id = ?', [$idM]) === 0
    && acContaLog('senha_trocada') === 1, $r1->resumo() . ' / ' . $r3->resumo() . ' / ' . $r4->resumo());
[$idS, $S] = acNovaPessoa($P, 'suporte@exemplo.com', 'suporte', '519274');
[$idL, $L] = acNovaPessoa($P, 'leitor@exemplo.com', 'leitor', '736142');
$r = acEquipeGet($P, 'r=equipe');
$porId = array_column($r->json['itens'] ?? [], null, 'id');
checar('GET equipe: as 5 contas, com papel, PIN, último acesso, online, quem eu posso mexer (e nunca hash)', $r->status === 200 && count($porId) === 5
    && ($porId[$idDono]['daConfig'] ?? false) === true && ($porId[$idDono]['podeMexer'] ?? true) === false && ($porId[$idP]['eu'] ?? false) === true
    && ($porId[$idM]['podeMexer'] ?? false) === true && ($porId[$idM]['temPin'] ?? false) === true && ($porId[$idM]['papel'] ?? '') === 'moderador'
    && !str_contains($r->corpo, '$2y$') && !str_contains($r->corpo, 'senha_hash'), $r->resumo());
$r = acEquipe($P, ['acao' => 'equipe_ativar', 'adminId' => $idP, 'ativo' => false]);
checar('mexer na própria conta pela equipe → 403 hierarquia', $r->status === 403 && $r->erro() === 'hierarquia', $r->resumo());
$r = acEquipe($P, ['acao' => 'equipe_ativar', 'adminId' => $idDono, 'ativo' => false]);
checar('dono pessoal não mexe na conta da senha do arquivo (acima dele) → 403', $r->status === 403 && $r->erro() === 'hierarquia', $r->resumo());
$r = acEquipe($P, ['acao' => 'equipe_excluir', 'adminId' => $idDono]);
checar('a conta da senha do arquivo não se apaga → 409 conta_da_config', $r->status === 409 && $r->erro() === 'conta_da_config', $r->resumo());
$r = acEquipe($P, ['acao' => 'papel_salvar', 'chave' => 'gerente', 'nome' => 'Gerente', 'descricao' => 'Cuida da equipe e das contas', 'poderes' => ['equipe', 'usuarios']]);
checar('papel personalizado "gerente" (equipe + usuarios) → nível 70, com "ver" junto', $r->status === 200 && ($r->json['papel']['nivel'] ?? 0) === 70
    && ($r->json['papel']['poderes'] ?? null) === ['ver', 'usuarios', 'equipe'], $r->resumo());
[$idG, $G] = acNovaPessoa($P, 'gerente@exemplo.com', 'gerente', '845037');
foreach (['dono' => 'acima', 'gerente' => 'no mesmo nível', 'moderador' => 'com poder que ele não tem'] as $pap => $porque) {
    $r = acEquipe($G, ['acao' => 'equipe_criar', 'email' => "g-$pap@exemplo.com", 'nome' => 'Tentativa', 'papel' => $pap]);
    checar("gerente não dá o papel $pap ($porque) → 403 hierarquia", $r->status === 403 && $r->erro() === 'hierarquia', $r->resumo());
}
$r = acEquipe($G, ['acao' => 'equipe_criar', 'email' => 'g-suporte@exemplo.com', 'nome' => 'Suporte do Gerente', 'papel' => 'suporte']);
$idGS = (int) ($r->json['id'] ?? 0);
checar('gerente dá o papel suporte (abaixo, com poderes que ele tem) → 201', $r->status === 201, $r->resumo());
$r = acEquipe($G, ['acao' => 'equipe_ativar', 'adminId' => $idP, 'ativo' => false]);
checar('gerente não mexe no dono → 403', $r->status === 403 && $r->erro() === 'hierarquia', $r->resumo());
$r = acEquipe($G, ['acao' => 'equipe_ativar', 'adminId' => $idM, 'ativo' => false]);
resetarLimitesCurtos();
$rM = acPainel(novoNav(), ['acao' => 'entrar', 'email' => 'moderadora@exemplo.com', 'senha' => $senhaM]);
checar('gerente desativa a moderadora (nível abaixo) → 200; as sessões dela caem e ela recebe a mesma mensagem genérica ao entrar',
    $r->status === 200 && ($r->json['sessoesEncerradas'] ?? 0) >= 1 && $M->pedir('GET', '/api/painel.php?so=agora')->status === 401
    && $rM->status === 401 && ($rM->json['mensagem'] ?? '') === 'E-mail ou senha não conferem.', $r->resumo() . ' / ' . $rM->resumo());
// rev3: reativar devolve o acesso com os poderes da conta; o gerente não tem "moderar", então quem reativa é a dona
$r = acEquipe($G, ['acao' => 'equipe_ativar', 'adminId' => $idM, 'ativo' => true]);
checar('…mas não reativa (a moderadora tem "moderar", que ele não tem) → 403 hierarquia; a dona reativa', $r->status === 403 && $r->erro() === 'hierarquia'
    && (int) v('SELECT ativo FROM admin_contas WHERE id = ?', [$idM]) === 0, $r->resumo());
$r = acEquipe($P, ['acao' => 'equipe_ativar', 'adminId' => $idM, 'ativo' => true]);
checar('…e a dona reativa', $r->status === 200 && (int) v('SELECT ativo FROM admin_contas WHERE id = ?', [$idM]) === 1, $r->resumo());
$M = acEntrarConta('moderadora@exemplo.com', $senhaM, '618204');
$r1 = acEquipe($G, ['acao' => 'papel_salvar', 'chave' => 'chefe_equipe', 'nome' => 'Chefe', 'poderes' => ['equipe']]);
$r2 = acEquipe($G, ['acao' => 'papel_salvar', 'chave' => 'moderadorx', 'nome' => 'Moderador X', 'poderes' => ['moderar']]);
$r3 = acEquipe($G, ['acao' => 'papel_salvar', 'chave' => 'atendente', 'nome' => 'Atendente', 'poderes' => ['usuarios']]);
checar('gerente: papel no próprio nível → 403; com poder que não tem → 403; abaixo e com os poderes dele → 200 (nível 50)',
    $r1->status === 403 && $r2->status === 403 && $r3->status === 200 && ($r3->json['papel']['nivel'] ?? 0) === 50, $r1->resumo() . ' / ' . $r2->resumo() . ' / ' . $r3->resumo());
$r1 = acEquipe($P, ['acao' => 'papel_apagar', 'chave' => 'gerente']);
$r2 = acEquipe($P, ['acao' => 'papel_apagar', 'chave' => 'dono']);
$r3 = acEquipe($P, ['acao' => 'papel_salvar', 'chave' => 'dono', 'nome' => 'Dono 2', 'poderes' => ['ver']]);
$r4 = acEquipe($P, ['acao' => 'papel_apagar', 'chave' => 'atendente']);
checar('papel em uso não se apaga (409 em_uso); de fábrica não muda nem se apaga (400 papel_fixo); papel sem uso se apaga',
    $r1->status === 409 && $r1->erro() === 'em_uso' && $r2->erro() === 'papel_fixo' && $r3->erro() === 'papel_fixo' && $r4->status === 200,
    $r1->resumo() . ' / ' . $r2->resumo() . ' / ' . $r3->resumo() . ' / ' . $r4->resumo());
$r = acEquipeGet($L, 'r=papeis');
checar('GET papeis (qualquer um): fábrica (4) + personalizados, catálogo de 9 poderes, o que eu posso dar', $r->status === 200 && count($r->json['fabrica'] ?? []) === 4
    && in_array('gerente', array_column($r->json['personalizados'] ?? [], 'chave'), true) && count($r->json['poderes'] ?? []) === 9
    && !in_array(true, array_column($r->json['fabrica'] ?? [], 'possoDar'), true), $r->resumo());
$r = acEquipe($P, ['acao' => 'equipe_criar', 'email' => 'dono2@exemplo.com', 'nome' => 'Segundo Dono', 'papel' => 'dono']);
$idP2 = (int) ($r->json['id'] ?? 0);
checar('o dono pode nomear outro dono', $r->status === 201, $r->resumo());
$P3 = acEntrarConta('dono2@exemplo.com', (string) ($r->json['senha'] ?? ''), '462093', 'senha-do-segundo-dono-1');
$r = acEquipe($P, ['acao' => 'equipe_zerar_pin', 'adminId' => $idP2]);
checar('um dono zera o PIN de outro dono (esqueceu) → 200 e as sessões dele caem', $r->status === 200 && $P3->pedir('GET', '/api/painel.php?so=agora')->status === 401
    && v('SELECT pin_hash FROM admin_contas WHERE id = ?', [$idP2]) === null, $r->resumo());
$r = acEquipe($P, ['acao' => 'equipe_zerar_pin', 'adminId' => $idP]);
$r2 = acEquipe($P, ['acao' => 'equipe_ativar', 'adminId' => $idP2, 'ativo' => false]);
checar('…mas não o próprio (403) e não desativa outro dono (mesmo nível: 403)', $r->status === 403 && $r2->status === 403, $r->resumo() . ' / ' . $r2->resumo());
$r = acEquipe($G, ['acao' => 'equipe_zerar_pin', 'adminId' => $idP2]);
checar('gerente não zera o PIN de um dono → 403', $r->status === 403, $r->resumo());
comConfig(['admin_senha_hash' => ''], static function () use ($idP, $idP2, $P): void {
    $b = novoNav();
    $r1 = acEquipe($b, ['acao' => 'equipe_ativar', 'adminId' => $idP2, 'ativo' => false], acBearer());
    $r2 = acEquipe($b, ['acao' => 'equipe_ativar', 'adminId' => $idP, 'ativo' => false], acBearer());
    $r3 = acEquipe($b, ['acao' => 'equipe_excluir', 'adminId' => $idP], acBearer());
    $r4 = acEquipe($b, ['acao' => 'equipe_papel', 'adminId' => $idP, 'papel' => 'leitor'], acBearer());
    checar('sem a senha do arquivo, o último dono ativo não sai: desativar, excluir ou rebaixar → 409 ultimo_dono (o outro dono saiu antes)',
        $r1->status === 200 && $r2->status === 409 && $r2->erro() === 'ultimo_dono' && $r3->erro() === 'ultimo_dono' && $r4->erro() === 'ultimo_dono',
        implode(' / ', [$r1->resumo(), $r2->resumo(), $r3->resumo(), $r4->resumo()]));
    checar('trocar a senha do arquivo derruba todas as sessões do painel (a chave do cookie leva o hash)', $P->pedir('GET', '/api/painel.php?so=agora')->status === 401);
    acEquipe($b, ['acao' => 'equipe_ativar', 'adminId' => $idP2, 'ativo' => true], acBearer());
});
checar('config de volta: a sessão da dona volta a valer', $P->pedir('GET', '/api/painel.php?so=agora')->status === 200);
$r = acEquipe($P, ['acao' => 'equipe_senha', 'adminId' => $idM]);
$provM2 = (string) ($r->json['senha'] ?? '');
checar('dar senha provisória (esqueceu a senha) → 200, mostrada uma vez; as sessões dela caem', $r->status === 200 && strlen($provM2) === 14
    && $M->pedir('GET', '/api/painel.php?so=agora')->status === 401 && (int) v('SELECT trocar_senha FROM admin_contas WHERE id = ?', [$idM]) === 1, $r->resumo());
resetarLimitesCurtos();
$M = novoNav();
$r1 = acPainel($M, ['acao' => 'entrar', 'email' => 'moderadora@exemplo.com', 'senha' => $provM2]);
$r2 = acPainel($M, ['acao' => 'conferir_pin', 'pin' => '618204']);
$senhaM = 'senha-nova-da-moderadora-1';
$r3 = acPainel($M, ['acao' => 'trocar_senha', 'nova' => $senhaM]);
checar('…com PIN: senha provisória → PIN → trocar a senha → pronto (o PIN vem antes: quem deu a provisória não entra só com ela)',
    ($r1->json['etapa'] ?? '') === 'pin' && ($r2->json['etapa'] ?? '') === 'trocar_senha' && ($r3->json['etapa'] ?? '') === 'pronto', $r1->resumo() . ' / ' . $r2->resumo() . ' / ' . $r3->resumo());
$r = acEquipe($P, ['acao' => 'equipe_senha', 'adminId' => $idDono]);
checar('senha provisória para a conta da senha do arquivo → 403 (está acima) ', $r->status === 403, $r->resumo());
[$idX, $X] = acNovaPessoa($P, 'temporario@exemplo.com', 'leitor', '927351');
$r = acEquipe($P, ['acao' => 'equipe_excluir', 'adminId' => $idX]);
$lg = acUltimoLog('equipe_excluir');
checar('excluir pessoa → 200; sai com as sessões; o registro guarda uma cópia sem segredos (nome, e-mail mascarado, papel)', $r->status === 200
    && (int) v('SELECT COUNT(*) FROM admin_contas WHERE id = ?', [$idX]) === 0 && $X->pedir('GET', '/api/painel.php?so=agora')->status === 401
    && str_contains((string) $lg['detalhes'], 'te***@exemplo.com') && !str_contains((string) $lg['detalhes'], '$2y$')
    && !str_contains((string) $lg['detalhes'], 'temporario@'), $r->resumo() . ' ' . json_encode($lg));

// ══ poderes negados por papel ════════════════════════════════════════════════════════════════════

secao('v3.2 acesso · mapa único de poderes: cada papel barrado em cada ação que não pode (S10, P1-1)');
$mapa = phpComLib('echo json_encode(["acoes" => PODERES_ACAO, "papeis" => array_map(fn($p) => $p["poderes"], LENDA_PAPEIS)]);');
checar('o mapa ação → poder cobre as ações do admin.php e do equipe.php', is_array($mapa) && count($mapa['acoes'] ?? []) >= 50
    && ($mapa['acoes']['excluir_usuario'] ?? '') === 'excluir' && ($mapa['acoes']['backup_restaurar'] ?? '') === 'sistema'
    && ($mapa['acoes']['ocultar_carreira'] ?? '') === 'moderar' && ($mapa['acoes']['dar_bonus'] ?? '') === 'bonus' && ($mapa['acoes']['config'] ?? '') === 'config',
    json_encode($mapa['acoes'] ?? null));
$AC_EQUIPE_POST = ['equipe_criar', 'equipe_papel', 'equipe_ativar', 'equipe_zerar_pin', 'zerar_pin', 'equipe_senha', 'equipe_excluir', 'papel_salvar',
    'papel_apagar', 'recado_criar', 'recado_lido', 'recado_apagar', 'sessao_encerrar', 'backup_guardar', 'backup_restaurar'];
$AC_EQUIPE_GET = ['equipe', 'sessoes', 'seguranca', 'saude', 'backup', 'copias', 'copia', 'papeis', 'recados'];
$AC_ADMIN_GET = ['exportar' => 'r=exportar&tipo=usuarios', 'relatorio_csv' => 'r=relatorio&tipo=base&csv=1'];
$AC_SO_GET_OUTROS = ['tempo_csv']; // GET de outra rota (CSV do tempo de jogo): conferido no teste da moderação
/** Pede a ação ao servidor como o papel pediria (sem os campos: quem pode responde 400, quem não pode, 403). */
$acPedirAcao = static function (Navegador $n, string $acao) use ($AC_EQUIPE_POST, $AC_EQUIPE_GET, $AC_ADMIN_GET): Resposta {
    if (in_array($acao, $AC_EQUIPE_GET, true)) {
        $n->conferir = !in_array($acao, ['backup', 'copia'], true);
        $r = $n->pedir('GET', '/api/equipe.php?r=' . $acao);
        $n->conferir = true;
        return $r;
    }
    if (isset($AC_ADMIN_GET[$acao])) {
        $n->conferir = false;
        $r = $n->pedir('GET', '/api/admin.php?' . $AC_ADMIN_GET[$acao]);
        $n->conferir = true;
        return $r;
    }
    return $n->pedir('POST', in_array($acao, $AC_EQUIPE_POST, true) ? '/api/equipe.php' : '/api/admin.php', ['acao' => $acao]);
};
$papeisTeste = ['moderador' => [$M, $idM], 'suporte' => [$S, $idS], 'leitor' => [$L, $idL], 'gerente' => [$G, $idG]];
$poderesGerente = ['ver', 'usuarios', 'equipe'];
$negadosAntes = acContaLog('negado');
$totalNegados = 0;
foreach ($papeisTeste as $papel => [$nav, $idPapel]) {
    $poderes = $papel === 'gerente' ? $poderesGerente : ($mapa['papeis'][$papel] ?? []);
    $erradas = [];
    $n = 0;
    foreach ($mapa['acoes'] ?? [] as $acao => $poder) {
        if (in_array($poder, $poderes, true) || in_array($acao, $AC_SO_GET_OUTROS, true)) {
            continue;
        }
        $n++;
        resetarLimitesCurtos();
        $r = $acPedirAcao($nav, $acao);
        if ($r->status !== 403 || !in_array($r->erro(), ['sem_poder'], true)) {
            $erradas[] = "$acao → $r->status " . $r->erro();
        }
    }
    $totalNegados += $n;
    checar("$papel: as $n ações sem o poder dele → 403 sem_poder", !$erradas, implode('; ', $erradas));
}
checar('cada recusa vai para o registro como "negado", com quem pediu', acContaLog('negado') - $negadosAntes === $totalNegados
    && (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'negado' AND quem = ?", ['a' . $idL]) > 0, (acContaLog('negado') - $negadosAntes) . " de $totalNegados");
$r1 = $M->pedir('POST', '/api/admin.php', ['acao' => 'atualizar_hall']);
$r2 = $S->pedir('POST', '/api/admin.php', ['acao' => 'suspender']);
$r3 = $L->pedir('GET', '/api/admin.php?r=resumo');
$r4 = $L->pedir('GET', '/api/painel.php');
$r5 = $G->pedir('GET', '/api/equipe.php?r=equipe');
checar('o que o papel pode passa: moderador atualiza o Hall, suporte chega à validação do suspender, leitor vê resumo e números, gerente vê a equipe',
    $r1->status === 200 && $r2->status === 400 && $r3->status === 200 && $r4->status === 200 && $r5->status === 200,
    implode(' / ', array_map(static fn($x) => $x->resumo(), [$r1, $r2, $r3, $r4, $r5])));
$r1 = acEquipe($M, ['acao' => 'acao_inventada']);
$r2 = acEquipe($P, ['acao' => 'acao_inventada']);
checar('ação fora do mapa: só o dono passa (moderador 403; dono chega ao 400 acao)', $r1->status === 403 && $r2->status === 400 && $r2->erro() === 'acao',
    $r1->resumo() . ' / ' . $r2->resumo());
$r = $L->pedir('GET', '/api/painel.php?so=sessao');
checar('?so=sessao do leitor: poderes = [ver] (o painel esconde os botões; quem barra é o servidor)', ($r->json['poderes'] ?? null) === ['ver']
    && ($r->json['quem']['papel'] ?? '') === 'leitor', $r->resumo());
$r = acEquipeGet(novoNav(), 'r=equipe', acBearer());
checar('o Bearer vale como dono em tudo (GET equipe)', $r->status === 200 && count($r->json['itens'] ?? []) >= 6, $r->resumo());

// ══ recados e presença ═══════════════════════════════════════════════════════════════════════════

secao('v3.2 acesso · recados internos e quem está no painel (S13, S14)');
$r = acEquipe($P, ['acao' => 'recado_criar', 'titulo' => 'Plantão do fim de semana', 'texto' => "Linha 1\nLinha 2\u{0007}", 'tom' => 'aviso', 'para' => [$idM]]);
$idRec = (int) ($r->json['id'] ?? 0);
checar('recado para uma pessoa → 201', $r->status === 201 && $idRec > 0, $r->resumo());
$pM = $M->pedir('GET', '/api/painel.php?so=agora');
$pS = $S->pedir('GET', '/api/painel.php?so=agora');
checar('o pulso conta o recado não lido só para quem ele é', ($pM->json['agora']['recadosNaoLidos'] ?? -1) === 1 && ($pS->json['agora']['recadosNaoLidos'] ?? -1) === 0
    && ($P->pedir('GET', '/api/painel.php?so=agora')->json['agora']['recadosNaoLidos'] ?? -1) === 0, $pM->resumo());
$r = acEquipeGet($M, 'r=recados');
$it = $r->json['itens'][0] ?? [];
checar('GET recados: o texto guarda a quebra de linha (sem o caractere de controle), tom, para, quem escreveu, não lido', $r->status === 200
    && ($it['texto'] ?? '') === "Linha 1\nLinha 2" && ($it['tom'] ?? '') === 'aviso' && ($it['lido'] ?? true) === false && ($it['por']['id'] ?? 0) === $idP
    && ($it['para'][0]['id'] ?? 0) === $idM && ($it['podeApagar'] ?? true) === false, $r->resumo());
checar('…quem não está no "para" não vê', (acEquipeGet($S, 'r=recados')->json['itens'] ?? null) === []);
$r = acEquipe($M, ['acao' => 'recado_lido', 'id' => $idRec]);
checar('marcar como lido → o pulso zera', $r->status === 200 && ($M->pedir('GET', '/api/painel.php?so=agora')->json['agora']['recadosNaoLidos'] ?? -1) === 0, $r->resumo());
$r = acEquipe($M, ['acao' => 'recado_apagar', 'id' => $idRec]);
checar('apagar recado de outra pessoa sem cuidar da equipe → 403', $r->status === 403, $r->resumo());
foreach ([['tom' => 'gritando', 'titulo' => 'Oi'], ['titulo' => ''], ['titulo' => 'Velho', 'ate' => '2020-01-01'], ['titulo' => 'Pra quem?', 'para' => [999999]]] as $ruim) {
    $r = acEquipe($P, ['acao' => 'recado_criar'] + $ruim);
    checar('recado inválido → 400 (' . json_encode($ruim, JSON_UNESCAPED_UNICODE) . ')', $r->status === 400, $r->resumo());
}
$r = acEquipe($P, ['acao' => 'recado_apagar', 'id' => $idRec]);
checar('quem escreveu apaga → 200', $r->status === 200 && (int) v('SELECT COUNT(*) FROM admin_recados WHERE id = ?', [$idRec]) === 0, $r->resumo());
$M->pedir('GET', '/api/painel.php?so=agora');
$eq = array_column($P->pedir('GET', '/api/painel.php?so=agora')->json['agora']['equipe'] ?? [], 'nome');
checar('pulso: quem da equipe está com o painel aberto agora (a moderadora e eu)', in_array('Moderadora', $eq, true) && in_array('Dona Pessoal', $eq, true), json_encode($eq));
q('UPDATE admin_sessoes SET visto_em = UTC_TIMESTAMP() - INTERVAL 4 MINUTE WHERE admin_id = ?', [$idM]);
$eq = array_column($P->pedir('GET', '/api/painel.php?so=agora')->json['agora']['equipe'] ?? [], 'nome');
checar('…sem uso há 3+ min, sai da faixa', !in_array('Moderadora', $eq, true), json_encode($eq));
$ag = $P->pedir('GET', '/api/painel.php?so=agora')->json['agora'] ?? [];
checar('pulso: online, jogando, números de ação, alertas e filas (P0-2/P1-13) junto com a equipe', isset($ag['online'], $ag['jogando'], $ag['atualizadoEm'])
    && array_key_exists('acao', $ag) && array_key_exists('alertas', $ag) && array_key_exists('filas', $ag) && is_array($ag['equipe'] ?? null), json_encode($ag));

// ══ Segurança ════════════════════════════════════════════════════════════════════════════════════

secao('v3.2 acesso · bloco Segurança: entradas, falhas, bloqueios, negados, sessões (P1-3)');
$r = acEquipeGet($P, 'r=seguranca');
$acs = array_unique(array_column($r->json['itens'] ?? [], 'acao'));
$falha = acEquipeGet($P, 'r=seguranca&acao=painel_falha')->json['itens'][0] ?? [];
$entrada = acEquipeGet($P, 'r=seguranca&acao=painel_entrar')->json['itens'][0] ?? [];
$rs = $r->json['resumo'] ?? [];
$rf = acEquipeGet($P, 'r=seguranca&acao=suspender');
checar('GET seguranca: paginado (50), filtro por ação; cada item com quem, aparelho do dia (6) e "grave"', $r->status === 200 && ($r->json['porPagina'] ?? 0) === 50
    && ($r->json['total'] ?? 0) > 50 && in_array('negado', $acs, true) && ($falha['acao'] ?? '') === 'painel_falha' && ($falha['grave'] ?? false) === true
    && $rf->status === 400
    && ($entrada['grave'] ?? true) === false && is_string($entrada['quem']['nome'] ?? null) && preg_match('/^[0-9a-f]{6}$/', (string) ($entrada['ipDia'] ?? '')) === 1,
    $r->resumo());
checar('…resumo: falhas, bloqueios e negados em 24 h, tentativas agora e sessões abertas', ($rs['falhas24h'] ?? 0) >= 3 && ($rs['negados24h'] ?? 0) >= 10
    && ($rs['limites24h'] ?? 0) >= 1 && ($rs['sessoesAtivas'] ?? 0) >= 3 && array_key_exists('tentativasAgora', $rs), json_encode($rs));
checar('…nunca o IP (nem no registro nem nas sessões)', !str_contains($r->corpo, '127.0.0.1')
    && (int) v("SELECT COUNT(*) FROM admin_log WHERE CONCAT_WS(' ', detalhes, ip_dia, quem, alvo) LIKE '%127.0.0.1%'") === 0
    && (int) v("SELECT COUNT(*) FROM admin_log WHERE ip_dia IS NOT NULL AND ip_dia NOT REGEXP '^[0-9a-f]{16}$'") === 0);
checar('leitor não vê o bloco Segurança (403)', acEquipeGet($L, 'r=seguranca')->status === 403);

// ══ CSRF ═════════════════════════════════════════════════════════════════════════════════════════

secao('v3.2 acesso · CSRF: Origin + JSON + SameSite=Strict');
$r1 = acEquipe($P, ['acao' => 'papel_salvar', 'chave' => 'csrf', 'nome' => 'CSRF', 'poderes' => []], ['origem' => false]);
$r2 = acEquipe($P, ['acao' => 'papel_salvar', 'chave' => 'csrf', 'nome' => 'CSRF', 'poderes' => []], ['origem' => 'https://outro-site.example']);
$r3 = acEquipe($P, ['acao' => 'papel_salvar', 'chave' => 'csrf', 'nome' => 'CSRF', 'poderes' => []], ['tipo' => 'text/plain']);
$r4 = acPainel($P, ['acao' => 'sair_todos'], ['origem' => 'https://outro-site.example']);
$r5 = acPainel(novoNav(), ['acao' => 'entrar', 'senha' => $PAINEL_SENHA], ['origem' => 'https://outro-site.example']);
$r6 = $P->pedir('POST', '/api/admin.php', ['acao' => 'atualizar_hall'], ['origem' => false]);
checar('com o cookie: sem Origin, de outro site ou sem JSON → 403 origem (equipe.php, painel.php e admin.php); nada foi gravado',
    $r1->status === 403 && $r1->erro() === 'origem' && $r2->status === 403 && $r3->status === 403 && $r4->status === 403 && $r5->status === 403 && $r6->status === 403
    && (int) v("SELECT COUNT(*) FROM admin_papeis WHERE chave = 'csrf'") === 0, implode(' / ', array_map(static fn($x) => "$x->status", [$r1, $r2, $r3, $r4, $r5, $r6])));
$r = acEquipe(novoNav(), ['acao' => 'papel_salvar', 'chave' => 'por_script', 'nome' => 'Por script', 'poderes' => []], acBearer());
checar('com o Bearer não há CSRF: POST sem Origin (só JSON) → 200, registrado com quem = token', $r->status === 200
    && (acUltimoLog('papel_salvar')['quem'] ?? '') === 'token', $r->resumo());
acEquipe($P, ['acao' => 'papel_apagar', 'chave' => 'por_script']);

// ══ Saúde ════════════════════════════════════════════════════════════════════════════════════════

secao('v3.2 acesso · Saúde: diagnóstico sem segredo nenhum (P1-14, S22)');
$r = acEquipeGet($P, 'r=saude');
$sj = $r->json ?? [];
checar('GET saude → php, banco, schema, config (só sim/não e contagens), hall, medição, e-mail, cópias, dados, problemas', $r->status === 200
    && ($sj['banco']['ok'] ?? false) === true && ($sj['schema']['faltam'] ?? null) === [] && ($sj['config']['segredo'] ?? null) === true
    && ($sj['config']['senhaPainel'] ?? null) === true && ($sj['config']['token'] ?? null) === true && ($sj['config']['origens'] ?? 0) === 3
    && ($sj['config']['emailModo'] ?? '') === 'arquivo' && ($sj['config']['cookieSeguro'] ?? null) === false && is_bool($sj['php']['extensoes']['intl'] ?? null)
    && isset($sj['dados']['contas'], $sj['medicao'], $sj['horaServidor']) && preg_match($RE_ISO, (string) ($sj['horaServidor'] ?? '')) === 1, $r->resumo());
$cods = array_column($sj['problemas'] ?? [], 'grave', 'codigo');
checar('…problemas com "como resolver": cookie sem Secure é grave, e-mail em arquivo é leve (a config de teste tem os dois)', ($cods['cookie_seguro'] ?? null) === true
    && ($cods['email_arquivo'] ?? null) === false && is_string($sj['problemas'][0]['resolver'] ?? null) && ($sj['tudoCerto'] ?? true) === false, json_encode($sj['problemas'] ?? null));
$segredos = ['segredo' => $AC_SEGREDO, 'senha do painel' => $PAINEL_SENHA, 'token' => $PAINEL_TOKEN, 'sha do token' => $AC_TOKEN_SHA, 'hash da senha' => $AC_HASH_SENHA,
    'dsn' => (string) getenv('LENDA_DSN'), 'pasta' => $AC_BASE, 'arquivo de config' => $CONFIG_ARQ, 'pasta dos e-mails' => $EMAILS];
$vaz = array_keys(array_filter($segredos, static fn($s) => $s !== '' && str_contains($r->corpo, $s)));
checar('…nenhum segredo, caminho ou valor da config na resposta', !$vaz && $AC_HASH_SENHA !== '' && $AC_TOKEN_SHA !== '', implode(', ', $vaz));
$r = acEquipeGet(novoNav(), 'r=saude', acBearer());
checar('Saúde também pelo Bearer; leitor e moderador → 403', $r->status === 200 && acEquipeGet($L, 'r=saude')->status === 403 && acEquipeGet($M, 'r=saude')->status === 403, $r->resumo());
q('RENAME TABLE admin_recados TO admin_recados_fora');
$P->conferir = false;
$r = acEquipeGet($P, 'r=recados');
$P->conferir = true;
$sj = acEquipeGet($P, 'r=saude')->json ?? [];
q('RENAME TABLE admin_recados_fora TO admin_recados');
checar('tabela nova que falta (subiu sem rodar o instalar.php) → 503 instalar "rode o instalar.php", e a Saúde aponta', $r->status === 503 && $r->erro() === 'instalar'
    && str_contains((string) ($r->json['mensagem'] ?? ''), 'instalar.php') && in_array(['tabela' => 'admin_recados'], $sj['schema']['faltam'] ?? [], true)
    && in_array('schema', array_column($sj['problemas'] ?? [], 'codigo'), true), $r->resumo());
q('ALTER TABLE admin_contas DROP COLUMN pin_em');
$sj = acEquipeGet($P, 'r=saude')->json ?? [];
$ri = $anon->pedir('POST', '/api/instalar.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
checar('coluna faltando aparece na Saúde ({tabela, coluna}) e o instalar.php a devolve (só acrescenta)', in_array(['tabela' => 'admin_contas', 'coluna' => 'pin_em'], $sj['schema']['faltam'] ?? [], true)
    && in_array('admin_contas: coluna pin_em', $ri->json['alteracoes'] ?? [], true) && (acEquipeGet($P, 'r=saude')->json['schema']['faltam'] ?? null) === [], $ri->resumo());

// ══ backup para baixar ═══════════════════════════════════════════════════════════════════════════

secao('v3.2 acesso · backup para baixar: o que entra e o que fica de fora (P1-15)');
limparContas();
[$nU1, $uid1] = novaConta('Restaura Um');
[$nU2, $uid2] = novaConta('Restaura Dois');
$hR = hallEntry('rest-um', ['nota' => 80]);
$rSalvar = salvarC($nU1, $hR);
checar('(preparação: carreira salva)', $rSalvar->status === 200, $rSalvar->resumo());
q("INSERT INTO site_config (chave, valor, atualizado_em, atualizado_por) VALUES ('hall_intervalo_min', '90', UTC_TIMESTAMP(), 'teste')
    ON DUPLICATE KEY UPDATE valor = '90'");
q("INSERT INTO site_config (chave, valor, atualizado_em) VALUES ('_estado_teste', '{\"x\":1}', UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE valor = VALUES(valor)");
$P->conferir = false;
$r = $P->pedir('GET', '/api/equipe.php?r=backup');
$P->conferir = true;
$txt = $r->status === 200 ? acGunzip($r->corpo) : null;
$bk = $txt !== null ? json_decode($txt, true) : null;
checar('GET backup → 200 gzip para baixar (lenda-backup-AAAA-MM-DD_HHMM.json.gz), no-store', $r->status === 200 && $r->cab1('content-type') === 'application/gzip'
    && preg_match('/attachment; filename="lenda-backup-\d{4}-\d{2}-\d{2}_\d{4}\.json\.gz"/', $r->cab1('content-disposition')) === 1
    && $r->cab1('cache-control') === 'no-store' && is_array($bk), $r->resumo());
$tabs = array_keys($bk['tabelas'] ?? []);
checar('…versão 1, geradoEm, as tabelas de dados e a contagem que confere', ($bk['versao'] ?? 0) === 1 && preg_match($RE_ISO, (string) ($bk['geradoEm'] ?? '')) === 1
    && !array_diff(['usuarios', 'carreiras', 'conquistas_usuario', 'indicacoes', 'bonus', 'denuncias', 'site_config', 'visitantes_usuarios', 'admin_log', 'admin_contas',
        'carreiras_moderacao', 'admin_papeis', 'admin_recados'], $tabs)
    && ($bk['contagem']['usuarios'] ?? -1) === count($bk['tabelas']['usuarios'] ?? []) && count($bk['tabelas']['usuarios'] ?? []) === 2, json_encode($tabs));
checar('…ficam de fora: sessões, códigos de troca de senha, tentativas, sessões do painel, a medição (sem medicao=1) e o estado interno',
    !array_intersect(['sessoes_login', 'admin_sessoes', 'redefinicoes', 'tentativas', 'visitas', 'eventos', 'hall_foto'], $tabs)
    && !in_array('_estado_teste', array_column($bk['tabelas']['site_config'] ?? [], 'chave'), true)
    && in_array('hall_intervalo_min', array_column($bk['tabelas']['site_config'] ?? [], 'chave'), true));
$conta0 = $bk['tabelas']['admin_contas'][0] ?? [];
checar('…a equipe vai sem senha nem PIN', $conta0 !== [] && !array_key_exists('senha_hash', $conta0) && !array_key_exists('pin_hash', $conta0)
    && count($bk['tabelas']['admin_contas']) === (int) v('SELECT COUNT(*) FROM admin_contas'));
$c0 = $bk['tabelas']['carreiras'][0] ?? [];
checar('…a carreira vai com o HallEntry (dados em base64, igual ao do banco)', ($bk['binarios']['carreiras'] ?? null) === ['dados']
    && base64_decode((string) ($c0['dados'] ?? ''), true) === v('SELECT dados FROM carreiras WHERE id = ?', [(int) ($c0['id'] ?? 0)]));
checar('…registrado (backup, com o número de linhas)', ($lg = acUltimoLog('backup')) !== null && (json_decode((string) $lg['detalhes'], true)['linhas'] ?? 0) > 3
    && $lg['quem'] === 'a' . $idP);
$P->conferir = false;
$r = $P->pedir('GET', '/api/equipe.php?r=backup&medicao=1');
$P->conferir = true;
$bkm = json_decode((string) acGunzip($r->corpo), true);
checar('com medicao=1: também visitas e eventos (30 dias)', isset($bkm['tabelas']['visitas'], $bkm['tabelas']['eventos']) && ($bkm['medicao'] ?? false) === true);

// ══ cópias no servidor ═══════════════════════════════════════════════════════════════════════════

secao('v3.2 acesso · cópias no servidor: fora do public_html, 10, uma por dia (O3)');
if (is_dir($AC_PASTA)) {
    foreach (scandir($AC_PASTA) ?: [] as $f) {
        if ($f !== '.' && $f !== '..' && is_file("$AC_PASTA/$f")) {
            unlink("$AC_PASTA/$f");
        }
    }
}
q("DELETE FROM site_config WHERE chave = '_copia_diaria'");
$r = acEquipe($P, ['acao' => 'backup_guardar']);
$copiaA = (string) ($r->json['arquivo'] ?? '');
checar('guardar cópia agora → 200 (nome com data, tipo e sorteio), ao lado do arquivo de config', $r->status === 200
    && preg_match('/^lenda-copia-\d{8}-\d{6}-\d{6}-manual-[0-9a-f]{8}\.json\.gz$/', $copiaA) === 1 && is_file("$AC_PASTA/$copiaA") && ($r->json['linhas'] ?? 0) > 3, $r->resumo());
checar('…pasta 0700 com um .htaccess que nega tudo; arquivo 0600; fora do public_html', (fileperms($AC_PASTA) & 0777) === 0700
    && (fileperms("$AC_PASTA/$copiaA") & 0777) === 0600 && str_contains((string) @file_get_contents("$AC_PASTA/.htaccess"), 'Require all denied') && !str_starts_with((string) realpath($AC_PASTA), (string) realpath($AC_WWW)));
$r = acEquipeGet($P, 'r=copias');
checar('GET copias: a pasta está ok, no máximo 10, a cópia na lista (sem caminho de servidor)', $r->status === 200 && ($r->json['pasta']['ok'] ?? false) === true
    && ($r->json['maximo'] ?? 0) === 10 && ($r->json['itens'][0]['arquivo'] ?? '') === $copiaA && ($r->json['itens'][0]['tipo'] ?? '') === 'manual'
    && !str_contains($r->corpo, $AC_BASE), $r->resumo());
$P->pedir('GET', '/api/painel.php?so=sessao');
$diaria = null;
for ($i = 0; $i < 60 && $diaria === null; $i++) {
    foreach (acArquivosNaPasta() as $f) {
        if (str_contains($f, '-diaria-')) {
            $diaria = $f;
        }
    }
    if ($diaria === null) {
        usleep(100_000);
    }
}
$P->pedir('GET', '/api/painel.php?so=sessao');
usleep(300_000);
checar('a 1ª carga do painel no dia guarda a cópia diária (depois da resposta); a 2ª no mesmo dia, não', $diaria !== null
    && count(array_filter(acArquivosNaPasta(), static fn($f) => str_contains($f, '-diaria-'))) === 1
    && (acUltimoLog('backup_guardar')['quem'] ?? '') === 'sistema', json_encode(acArquivosNaPasta()));
for ($i = 0; $i < 10; $i++) {
    acEquipe($P, ['acao' => 'backup_guardar']);
}
checar('rotação: ficam só as 10 mais novas', count(acArquivosNaPasta()) === 10 && !in_array($copiaA, acArquivosNaPasta(), true), json_encode(acArquivosNaPasta()));
$copiaA = acArquivosNaPasta()[0];
$P->conferir = false;
$r = $P->pedir('GET', '/api/equipe.php?r=copia&arquivo=' . rawurlencode($copiaA));
$P->conferir = true;
checar('baixar uma cópia da lista → 200, o arquivo inteiro', $r->status === 200 && $r->corpo === file_get_contents("$AC_PASTA/$copiaA")
    && (int) $r->cab1('content-length') === filesize("$AC_PASTA/$copiaA"), "HTTP $r->status");
@symlink($CONFIG_ARQ, "$AC_PASTA/lenda-link-config.json.gz");
file_put_contents("$AC_BASE/fora-da-pasta.json.gz", (string) file_get_contents("$AC_PASTA/$copiaA"));
$maliciosos = ['../lenda-config.php', '../fora-da-pasta.json.gz', '/etc/passwd', $AC_PASTA . '/' . $copiaA, 'lenda-copia-x.json.gz/../../lenda-config.php',
    '..%2Flenda-config.php', "$copiaA\0.php", 'lenda-link-config.json.gz', '.htaccess', 'nao-existe.json.gz', str_repeat('a', 300) . '.json.gz', ''];
$erradas = [];
foreach ($maliciosos as $nome) {
    $r1 = $P->pedir('GET', '/api/equipe.php?r=copia&arquivo=' . rawurlencode($nome));
    $r2 = acEquipe($P, ['acao' => 'backup_restaurar', 'arquivo' => $nome, 'modo' => 'completar', 'confirma' => 'RESTAURAR']);
    if ($r1->status !== 404 || $r2->status !== 404 || str_contains($r1->corpo, $AC_SEGREDO) || str_contains($r2->corpo, $AC_SEGREDO)) {
        $erradas[] = json_encode($nome) . " → $r1->status/$r2->status";
    }
}
checar('caminho malicioso (.., absoluto, %2F, byte nulo, link simbólico, fora da pasta, .htaccess) → 404 nos dois (baixar e restaurar), nada vaza',
    !$erradas, implode('; ', $erradas));
@unlink("$AC_PASTA/lenda-link-config.json.gz");
@unlink("$AC_BASE/fora-da-pasta.json.gz");
comConfig(['backup_pasta' => $AC_WWW . '/lenda/copias'], static function () use ($P, $AC_WWW): void {
    $P->conferir = false;
    $r = acEquipe($P, ['acao' => 'backup_guardar']);
    $P->conferir = true;
    $c = acEquipeGet($P, 'r=copias');
    checar('backup_pasta dentro do public_html → recusada (503 copias "fora do public_html"); a pasta nem é criada', $r->status === 503 && $r->erro() === 'copias'
        && str_contains((string) ($r->json['mensagem'] ?? ''), 'public_html') && !is_dir($AC_WWW . '/lenda/copias') && ($c->json['pasta']['ok'] ?? true) === false, $r->resumo());
});
$r = acEquipe($M, ['acao' => 'backup_guardar']);
checar('moderador não guarda cópia (403)', $r->status === 403, $r->resumo());

// ══ restaurar ════════════════════════════════════════════════════════════════════════════════════

secao('v3.2 acesso · restaurar: completar, substituir, antes-de-restaurar, LGPD, equipe sem senha, arquivo estragado (O4)');
foreach (acArquivosNaPasta() as $f) {
    unlink("$AC_PASTA/$f");
}
[$idXr, $Xr, $senhaXr] = acNovaPessoa($P, 'sai-depois@exemplo.com', 'leitor', '381940');
$r = acEquipe($P, ['acao' => 'backup_guardar']);
$copiaA = (string) ($r->json['arquivo'] ?? '');
$bkA = acLerCopia($copiaA);
checar('(preparação: cópia A com 2 contas, 1 carreira, Hall a cada 90 min e a pessoa que vai sair da equipe)', $r->status === 200
    && count($bkA['tabelas']['usuarios'] ?? []) === 2 && count($bkA['tabelas']['carreiras'] ?? []) === 1, $r->resumo());
// depois da cópia: conta nova, apelido mudado, carreira apagada, conta excluída pelo admin, config mudada, pessoa excluída da equipe
[$nU3, $uid3] = novaConta('Restaura Tres');
q('UPDATE usuarios SET apelido = ? WHERE id = ?', ['Restaura Mudou', $uid1]);
q('DELETE FROM carreiras WHERE usuario_id = ?', [$uid1]);
$r = $anon->pedir('POST', '/api/admin.php', ['acao' => 'excluir_usuario', 'id' => $uid2, 'confirma' => 'Restaura Dois', 'motivo' => 'teste'], acBearer());
checar('(preparação: o admin excluiu a conta 2 depois da cópia)', $r->status === 200 && (int) v('SELECT COUNT(*) FROM usuarios WHERE id = ?', [$uid2]) === 0, $r->resumo());
q("UPDATE site_config SET valor = '120' WHERE chave = 'hall_intervalo_min'");
acEquipe($P, ['acao' => 'equipe_excluir', 'adminId' => $idXr]);
$nLog = (int) v('SELECT COUNT(*) FROM admin_log');
foreach ([['modo' => 'tudo', 'confirma' => 'RESTAURAR'], ['modo' => 'completar'], ['modo' => 'completar', 'confirma' => 'restaurar']] as $ruim) {
    $r = acEquipe($P, ['acao' => 'backup_restaurar', 'arquivo' => $copiaA] + $ruim);
    checar('restaurar sem modo válido ou sem digitar RESTAURAR → 400 (' . json_encode($ruim) . ')', $r->status === 400, $r->resumo());
}
$r = acEquipe($G, ['acao' => 'backup_restaurar', 'arquivo' => $copiaA, 'modo' => 'completar', 'confirma' => 'RESTAURAR']);
$rp = acEquipe($P, ['acao' => 'papel_salvar', 'chave' => 'tecnico', 'nome' => 'Técnico', 'poderes' => ['sistema']]);
[$idT, $T] = acNovaPessoa($P, 'tecnico@exemplo.com', 'tecnico', '208461');
$r2 = acEquipe($T, ['acao' => 'backup_restaurar', 'arquivo' => $copiaA, 'modo' => 'completar', 'confirma' => 'RESTAURAR']);
$r3 = acEquipe($T, ['acao' => 'backup_guardar']);
checar('restaurar: só papel de dono (gerente 403; um papel com "sistema" guarda cópia, mas não restaura: 403)', $r->status === 403 && $rp->status === 200
    && $r2->status === 403 && $r3->status === 200, $r->resumo() . ' / ' . $r2->resumo() . ' / ' . $r3->resumo());
foreach (acArquivosNaPasta() as $f) {
    if ($f !== $copiaA) {
        unlink("$AC_PASTA/$f");
    }
}
$r = acEquipe($P, ['acao' => 'backup_restaurar', 'arquivo' => $copiaA, 'modo' => 'completar', 'confirma' => 'RESTAURAR']);
$antes1 = (string) ($r->json['antes'] ?? '');
$u1 = q('SELECT apelido FROM usuarios WHERE id = ?', [$uid1])[0]['apelido'] ?? '';
checar('completar → 200; guardou antes uma cópia "antes" do estado atual', $r->status === 200 && preg_match('/-antes-[0-9a-f]{8}\.json\.gz$/', $antes1) === 1
    && is_file("$AC_PASTA/$antes1") && ($r->json['modo'] ?? '') === 'completar', $r->resumo());
checar('…acrescenta o que falta (a carreira apagada volta) e não mexe no que existe (apelido novo e a conta nova ficam)',
    (int) v('SELECT COUNT(*) FROM carreiras WHERE usuario_id = ?', [$uid1]) === 1 && $u1 === 'Restaura Mudou'
    && (int) v('SELECT COUNT(*) FROM usuarios WHERE id = ?', [$uid3]) === 1 && v("SELECT valor FROM site_config WHERE chave = 'hall_intervalo_min'") === '120');
checar('…a conta que o admin excluiu depois da cópia NÃO volta (LGPD), nem o que era dela', (int) v('SELECT COUNT(*) FROM usuarios WHERE id = ?', [$uid2]) === 0
    && (int) v('SELECT COUNT(*) FROM visitantes_usuarios WHERE usuario_id = ?', [$uid2]) === 0 && ($r->json['puladas'] ?? 0) >= 1, $r->resumo());
$xr = q('SELECT * FROM admin_contas WHERE id = ?', [$idXr])[0] ?? null;
resetarLimitesCurtos();
$rx = acPainel(novoNav(), ['acao' => 'entrar', 'email' => 'sai-depois@exemplo.com', 'senha' => $senhaXr]);
checar('…a pessoa que saiu da equipe volta desativada, sem senha e sem PIN: a senha antiga não entra', $xr !== null && (int) $xr['ativo'] === 0
    && $xr['senha_hash'] === '' && $xr['pin_hash'] === null && (int) $xr['trocar_senha'] === 1 && $rx->status === 401, json_encode($xr) . ' ' . $rx->resumo());
checar('…o registro não perdeu nada e anotou a restauração', (int) v('SELECT COUNT(*) FROM admin_log') > $nLog
    && (json_decode((string) (acUltimoLog('backup_restaurar')['detalhes'] ?? ''), true)['antes'] ?? '') === $antes1);
$r = acEquipe($P, ['acao' => 'backup_restaurar', 'arquivo' => $copiaA, 'modo' => 'substituir', 'confirma' => 'RESTAURAR']);
$antes2 = (string) ($r->json['antes'] ?? '');
checar('substituir → 200: os dados voltam a ser os da cópia (conta nova sai, apelido volta, a config volta)', $r->status === 200
    && (int) v('SELECT COUNT(*) FROM usuarios WHERE id = ?', [$uid3]) === 0 && v('SELECT apelido FROM usuarios WHERE id = ?', [$uid1]) === 'Restaura Um'
    && (int) v('SELECT COUNT(*) FROM carreiras') === 1 && v("SELECT valor FROM site_config WHERE chave = 'hall_intervalo_min'") === '90'
    && (int) v('SELECT COUNT(*) FROM usuarios') === 1, $r->resumo());
checar('…a conta excluída continua fora; a sessão da conta que sumiu cai; a equipe e o registro ficam', (int) v('SELECT COUNT(*) FROM usuarios WHERE id = ?', [$uid2]) === 0
    && nulo($nU3->pedir('GET', '/api/conta.php')->json, 'usuario') && $P->pedir('GET', '/api/painel.php?so=agora')->status === 200
    && (int) v('SELECT COUNT(*) FROM admin_log WHERE acao = ?', ['backup_restaurar']) === 2);
checar('…a fotografia do Hall é refeita com as carreiras restauradas', (string) (json_decode((string) v("SELECT valor FROM site_config WHERE chave = '_hall_foto'"), true)['por'] ?? '') === 'restaurar');
$r = acEquipe($P, ['acao' => 'backup_restaurar', 'arquivo' => $antes2, 'modo' => 'substituir', 'confirma' => 'RESTAURAR']);
checar('a cópia "antes" desfaz a restauração (a conta nova e o apelido mudado voltam)', $r->status === 200
    && (int) v('SELECT COUNT(*) FROM usuarios WHERE id = ?', [$uid3]) === 1 && v('SELECT apelido FROM usuarios WHERE id = ?', [$uid1]) === 'Restaura Mudou', $r->resumo());
// arquivos estragados: nada muda e nenhuma cópia "antes" é feita
$bruto = (string) file_get_contents("$AC_PASTA/$copiaA");
$txtA = (string) acGunzip($bruto);
$estragados = [
    'lenda-cortado.json.gz' => substr($bruto, 0, intdiv(strlen($bruto), 2)),
    'lenda-nao-gzip.json.gz' => 'isto não é gzip',
    'lenda-lixo.json.gz' => gzencode("lixo\nmais lixo\n"),
    'lenda-sem-fim.json.gz' => gzencode(substr($txtA, 0, (int) strrpos($txtA, '},"contagem"'))),
    'lenda-contagem.json.gz' => gzencode((string) preg_replace('/"usuarios":\d+/', '"usuarios":99', $txtA)),
    'lenda-linha.json.gz' => gzencode((string) preg_replace('/\n\{"id":/', "\n{\"id\"::", $txtA, 1)),
    'lenda-versao.json.gz' => gzencode(str_replace('{"versao":1,', '{"versao":2,', $txtA)),
    'lenda-binario.json.gz' => gzencode(str_replace('"binarios":{"carreiras":["dados"]', '"binarios":{"usuarios":["senha_hash"]', $txtA)),
];
foreach ($estragados as $nome => $conteudo) {
    file_put_contents("$AC_PASTA/$nome", $conteudo);
}
$antesN = count(acArquivosNaPasta());
$usuariosAntes = q('SELECT id, apelido FROM usuarios ORDER BY id');
$erradas = [];
foreach (array_keys($estragados) as $nome) {
    $r = acEquipe($P, ['acao' => 'backup_restaurar', 'arquivo' => $nome, 'modo' => 'substituir', 'confirma' => 'RESTAURAR']);
    if ($r->status !== 400 || $r->erro() !== 'copia_estragada' || !str_contains((string) ($r->json['mensagem'] ?? ''), 'Nada foi mudado')) {
        $erradas[] = "$nome → " . $r->resumo();
    }
}
checar('arquivo estragado (cortado, não é gzip, lixo, sem o fim, contagem errada, registro quebrado, versão nova, binário estranho) → 400 copia_estragada "Nada foi mudado"',
    !$erradas, implode('; ', $erradas));
checar('…o banco ficou igual e nenhuma cópia "antes" foi feita', q('SELECT id, apelido FROM usuarios ORDER BY id') === $usuariosAntes && count(acArquivosNaPasta()) === $antesN);
foreach (array_keys($estragados) as $nome) {
    unlink("$AC_PASTA/$nome");
}
// arquivo forjado: conta da equipe dona e ativa com senha conhecida, sessão do painel e coluna inventada
$forjado = $bkA;
$forjado['tabelas']['admin_contas'][] = ['id' => 9000, 'email' => 'invasor@exemplo.com', 'nome' => 'Invasor', 'senha_hash' => password_hash('senha-do-invasor-1', PASSWORD_DEFAULT),
    'pin_hash' => null, 'papel' => 'dono', 'ativo' => 1, 'trocar_senha' => 0, 'da_config' => 0, 'criado_em' => gmdate('Y-m-d H:i:s')];
$forjado['tabelas']['admin_sessoes'] = [['token_sha256' => hash('sha256', 'x'), 'admin_id' => 9000, 'etapa' => 'pronto', 'criada_em' => gmdate('Y-m-d H:i:s'),
    'expira_em' => gmdate('Y-m-d H:i:s', time() + 86400), 'visto_em' => gmdate('Y-m-d H:i:s'), 'aparelho' => 'computador']];
$forjado['tabelas']['usuarios'][0]['apelido`) VALUES (1); DROP TABLE carreiras; -- '] = 'x';
$forjado['contagem']['admin_contas'] = count($forjado['tabelas']['admin_contas']);
$forjado['contagem']['admin_sessoes'] = 1;
acEscreverCopia('lenda-forjada.json.gz', $forjado);
$r = acEquipe($P, ['acao' => 'backup_restaurar', 'arquivo' => 'lenda-forjada.json.gz', 'modo' => 'completar', 'confirma' => 'RESTAURAR']);
$inv = q('SELECT * FROM admin_contas WHERE id = 9000')[0] ?? null;
resetarLimitesCurtos();
$rI = acPainel(novoNav(), ['acao' => 'entrar', 'email' => 'invasor@exemplo.com', 'senha' => 'senha-do-invasor-1']);
checar('arquivo forjado: a conta "dona" do arquivo entra desativada e sem senha (não entra); sessão do arquivo e coluna inventada são ignoradas',
    $r->status === 200 && $inv !== null && (int) $inv['ativo'] === 0 && $inv['senha_hash'] === '' && $rI->status === 401
    && (int) v('SELECT COUNT(*) FROM admin_sessoes WHERE token_sha256 = ?', [hash('sha256', 'x')]) === 0 && in_array('carreiras', array_column(q('SHOW TABLES'), array_key_first(q('SHOW TABLES')[0])), true),
    $r->resumo() . ' / ' . $rI->resumo());

// ══ .htaccess ════════════════════════════════════════════════════════════════════════════════════

if ($URL_APACHE !== '') {
    secao('v3.2 acesso · api/.htaccess no Apache (equipe.php e os módulos novos)');
    $ap = new Navegador($URL_APACHE, null);
    $ap->conferir = false;
    $r = $ap->pedir('GET', '/api/equipe.php');
    checar('equipe.php liberado e sem cache', $r->status === 200 && $r->cab1('cache-control') === 'no-store', "HTTP $r->status " . $r->cab1('cache-control'));
    foreach (['_admin.php', '_copias.php', '_saude.php'] as $arq) {
        $r = $ap->pedir('GET', "/api/$arq");
        checar("$arq negado", $r->status === 403, "HTTP $r->status");
    }
}
$r = $anon->pedir('GET', '/api/_admin.php');
checar('_admin.php chamado direto (sem o .htaccess) → 404 sem corpo', $r->status === 404 && $r->corpo === '', $r->resumo());

// ══ fim: equipe vazia de novo ════════════════════════════════════════════════════════════════════

acLimparEquipe();
foreach (acArquivosNaPasta() as $f) {
    unlink("$AC_PASTA/$f");
}
q("DELETE FROM site_config WHERE chave IN ('_copia_diaria', '_estado_teste')");
$ADM = entrarAdmin();
$adm = $ADM;
checar('fim dos testes de acesso: a senha do arquivo entra de novo direto (conta Dono nova, sem PIN)', $ADM->pedir('GET', '/api/painel.php?so=agora')->status === 200);

<?php
/**
 * LENDA · entrada no painel do administrador e números do painel. CONTRATO-v32 §B (acesso) e CONTRATO-v3 (números).
 * Entrada (POST, JSON com Origin do site; o cookie lenda_painel é SameSite=Strict, HttpOnly, 8 h):
 *   {"acao":"entrar","email"?:"…","senha":"…"} → {ok, etapa: pronto|pin|criar_pin|trocar_senha, aviso?, avisos}
 *     sem e-mail = a senha do arquivo de config (conta "Dono" de emergência, criada na primeira entrada)
 *   {"acao":"conferir_pin","pin":"123456"}  {"acao":"criar_pin","pin","repetir"[,"senha"]}  {"acao":"trocar_senha","nova"}
 *   {"acao":"criar_conta","email","nome","senha"}  {"acao":"minha_senha","atual","nova"}  {"acao":"sair"}  {"acao":"sair_todos"}
 *   GET ?so=modo  → {modo: contas|senha|desligado} (sem login)
 *   GET ?so=eu    → {admin: true} ou 401 (sem banco: só a assinatura do cookie, ou o Bearer)
 *   GET ?so=sessao → quem sou, poderes, avisos e os meus aparelhos (ou a etapa em que a entrada parou)
 * Números (sessão do painel ou Authorization: Bearer <token>; poder "ver"):
 *   GET  ?de=YYYY-MM-DD&ate=YYYY-MM-DD&bots=0[&utm=1]
 *   GET  ?so=agora → só {agora} (o painel atualiza isso a cada 15 s): online, jogando, números de ação, alertas, filas,
 *        quem da equipe está no painel e recados não lidos
 * Dias no fuso America/Sao_Paulo (UTC-3 fixo): o período vira [de 03:00 UTC, ate+1 03:00 UTC). A resposta do
 * período fica guardada por painel_cache_s (90 s; "geradoEm" diz de quando é); o "agora" é sempre na hora.
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';
require_once __DIR__ . '/_atencao.php';

cabecalhos();

// Tabela nova que ainda não existe (subiu os arquivos e não rodou o instalar.php): 503 com o que fazer, em vez de 500.
set_exception_handler(static function (Throwable $e): void {
    if (eFaltaDeSchema($e)) {
        erroInstalar($e);
    }
    error_log('LENDA ' . get_class($e) . ': ' . $e->getMessage() . ' em ' . basename($e->getFile()) . ':' . $e->getLine());
    erro(500, 'interno', 'Algo deu errado no servidor. Tente de novo daqui a pouco.');
});

// ── entrada ──────────────────────────────────────────────────────────────────────────────────────

/** Próxima etapa da entrada, a partir de onde ela está. */
function proximaEtapa(array $conta, string $depoisDe): string
{
    $temPin = ($conta['pin_hash'] ?? null) !== null && $conta['pin_hash'] !== '';
    $daConfig = (int) $conta['da_config'] === 1;
    $trocar = (int) $conta['trocar_senha'] === 1 && !$daConfig;
    if ($depoisDe === 'senha' && $temPin) {
        return 'pin';
    }
    if (in_array($depoisDe, ['senha', 'pin'], true) && $trocar) {
        return 'trocar_senha';
    }
    if (in_array($depoisDe, ['senha', 'pin', 'trocar_senha'], true) && !$temPin && !$daConfig) {
        return 'criar_pin';
    }
    return 'pronto';
}

/** Avisos da sessão pronta: criar_pin (a conta da senha do arquivo ainda sem PIN), crie_conta (só a senha do arquivo). */
function avisosDaConta(array $conta): array
{
    $av = [];
    if ((int) $conta['da_config'] === 1) {
        if (($conta['pin_hash'] ?? null) === null || $conta['pin_hash'] === '') {
            $av[] = 'criar_pin';
        }
        if (!haContaPessoal()) {
            $av[] = 'crie_conta';
        }
    }
    return $av;
}

/** A entrada chegou ao fim: último acesso e registro. */
function entrouNoPainel(array $conta): void
{
    sql('UPDATE admin_contas SET ultimo_acesso = ? WHERE id = ?', [dt(time()), (int) $conta['id']]);
    registrarAdmin('painel_entrar', 'admin:' . (int) $conta['id'], ['aparelho' => aparelhoDoPedido()], 'a' . (int) $conta['id']);
}

/** Resposta de uma etapa (com o que a tela precisa para a próxima). */
function respostaEtapa(array $conta, string $etapa): never
{
    $r = ['ok' => true, 'etapa' => $etapa];
    if ($etapa === 'pin') {
        $r['restam'] = max(0, LENDA_PIN_TENTATIVAS - lerLimite('painel-pin', 'a' . (int) $conta['id']));
    }
    if ($etapa === 'pronto') {
        $r['avisos'] = avisosDaConta($conta);
        if ($r['avisos']) {
            $r['aviso'] = $r['avisos'][0];
        }
    }
    responder(200, $r);
}

/**
 * A sessão do cookie numa destas etapas, ou o erro: sem sessão → 401 nao_logado; etapa intermediária vencida (10 min)
 * → 401 etapa_expirou; outra etapa → 409 etapa.
 */
function sessaoNaEtapa(array $etapas): array
{
    $s = sessaoPainelDoCookie();
    if ($s === null) {
        erro(401, 'nao_logado', 'Entre de novo no painel.');
    }
    if ($s['vencida']) {
        apagarCookiePainel();
        if ($s['etapa'] !== 'pronto') {
            erro(401, 'etapa_expirou', 'Demorou demais. Entre de novo.');
        }
        erro(401, 'nao_logado', 'A sessão do painel venceu. Entre de novo.');
    }
    if (!in_array($s['etapa'], $etapas, true)) {
        erro(409, 'etapa', 'Esta etapa da entrada já passou (ou ainda não chegou). Recarregue o painel.');
    }
    return $s;
}

/**
 * Hash para o password_verify de um e-mail que não é da equipe (o mesmo tempo da senha errada). Vem de uma conta de
 * verdade (o custo do PASSWORD_DEFAULT de quando ela foi criada ou entrou pela última vez, que é o das outras contas);
 * sem nenhuma, um bcrypt fixo com o custo de fábrica desta versão do PHP (10 até o 8.3; 12 a partir do 8.4). Um hash fixo
 * de custo 12 no PHP 8.1–8.3 levava ~4 vezes o tempo de uma conta de verdade e mostrava quais e-mails são da equipe.
 */
function hashParaTempoIgual(): string
{
    $h = umValor("SELECT senha_hash FROM admin_contas WHERE da_config = 0 AND senha_hash LIKE '$%' ORDER BY id LIMIT 1");
    if (is_string($h) && $h !== '') {
        return $h;
    }
    return PHP_VERSION_ID >= 80400
        ? '$2y$12$frZsCl3tbQp3SutTlYb7X.ygc9JfK65GY.8C7qsW0FAk0S9UY0ea2'
        : '$2y$10$T3MWM0iWrPaDmEkEVmKeYuDGrleW3hl3gBGL.LG70asuXgU/cnnfC';
}

/** Confere a senha da conta (a do arquivo de config, para a conta Dono de emergência). */
function senhaDaContaConfere(array $conta, string $senha): bool
{
    if ($senha === '' || strlen($senha) > 256 || str_contains($senha, "\0")) {
        return false;
    }
    $hash = (int) $conta['da_config'] === 1 ? senhaConfigHash() : (string) $conta['senha_hash'];
    return $hash !== '' && password_verify($senha, $hash);
}

$m = metodo();
if ($m === 'POST') {
    exigirEscrita();
    $j = lerJson(16 * 1024);
    $acao = is_string($j['acao'] ?? null) ? $j['acao'] : '';
    $t = time();

    if ($acao === 'entrar') {
        $modo = modoPainel();
        if ($modo === 'desligado') {
            erro(503, 'painel_desligado', 'Painel desligado: defina a senha do painel no arquivo de config (LEIAME §2).');
        }
        $ip = quemIp();
        if (somarLimite('painel', $ip) > 10) {
            registrarLimitePainel('painel_limite', ['limite' => 'ip']);
            erroLimite();
        }
        // Teto do site inteiro contra força bruta de muitos IPs: soma só as senhas erradas e, estourado, barra só os IPs
        // que já erraram nesta janela — o dono, de um IP limpo e com a senha certa, entra mesmo no meio de um ataque.
        if (lerLimite('painel-todos', 'todos') >= 50 && lerLimite('painel-erro', $ip) > 0) {
            registrarLimitePainel('painel_limite', ['limite' => 'site']);
            erroLimite();
        }
        $senha = is_string($j['senha'] ?? null) ? $j['senha'] : '';
        $email = is_string($j['email'] ?? null) ? strtolower(trim($j['email'])) : '';
        $msg = $modo === 'contas' ? 'E-mail ou senha não conferem.' : 'Senha incorreta.';
        $errou = static function (string $motivo, ?int $alvo) use ($ip, $msg): never {
            somarLimite('painel-erro', $ip);
            somarLimite('painel-todos', 'todos');
            registrarAdmin('painel_falha', $alvo !== null ? 'admin:' . $alvo : null, ['motivo' => $motivo], '');
            erro(401, 'credenciais', $msg);
        };
        if ($email !== '') {
            // 5 erros por e-mail a cada 30 min (além dos 10 por IP e do teto do site). A tentativa é reservada ANTES de
            // conferir a senha (somar e depois testar): pedidos ao mesmo tempo, de IPs diferentes, não passam todos pela
            // conferência antes de alguém somar. Quem acerta devolve a reserva (não se trava sozinho).
            [$chaveE, $janelaE] = chaveLimite('painel-e', quemEmail($email), 1800);
            if (somarLimite('painel-e', quemEmail($email), 1, 1800) > 5) {
                registrarLimitePainel('painel_limite', ['limite' => 'email']);
                erroLimite();
            }
            $conta = strlen($email) <= 190 ? umaLinha('SELECT * FROM admin_contas WHERE email = ? AND da_config = 0', [$email]) : null;
            if ($conta === null) {
                password_verify($senha, hashParaTempoIgual()); // o mesmo tempo da senha errada (o resultado não conta)
                $errou('inexistente', null);
            }
            if (!senhaDaContaConfere($conta, $senha) || (string) $conta['senha_hash'] === '') {
                $errou('senha', (int) $conta['id']);
            }
            if ((int) $conta['ativo'] !== 1) {
                $errou('inativa', (int) $conta['id']); // a mesma mensagem: não revela que a conta existe
            }
            sql('UPDATE tentativas SET n = GREATEST(n, 1) - 1 WHERE chave = ? AND janela = ?', [$chaveE, $janelaE]);
            if (password_needs_rehash((string) $conta['senha_hash'], PASSWORD_DEFAULT)) {
                sql('UPDATE admin_contas SET senha_hash = ? WHERE id = ?', [password_hash($senha, PASSWORD_DEFAULT), (int) $conta['id']]);
            }
        } else {
            $hash = senhaConfigHash();
            if ($hash === '' || $senha === '' || strlen($senha) > 256 || str_contains($senha, "\0") || !password_verify($senha, $hash)) {
                $errou('senha_arquivo', null);
            }
            $conta = contaDaConfig(true);
            if ($conta === null || (int) $conta['ativo'] !== 1) {
                $errou('inativa', $conta !== null ? (int) $conta['id'] : null);
            }
        }
        // sessões vencidas saem aqui (a entrada é rara; não pesa nos outros pedidos)
        sql('DELETE FROM admin_sessoes WHERE expira_em < ? OR (etapa = ? AND visto_em < ?) LIMIT 200',
            [dt($t), 'pronto', dt($t - LENDA_PAINEL_OCIOSO_S)]);
        $etapa = proximaEtapa($conta, 'senha');
        novaSessaoPainel((int) $conta['id'], $etapa);
        if ($etapa === 'pronto') {
            entrouNoPainel($conta);
        }
        respostaEtapa($conta, $etapa);
    }

    if ($acao === 'conferir_pin') {
        $s = sessaoNaEtapa(['pin']);
        $conta = $s['conta'];
        $quem = 'a' . (int) $conta['id'];
        if (lerLimite('painel-pin', $quem) >= LENDA_PIN_TENTATIVAS) {
            registrarLimitePainel('painel_pin_travado', ['admin' => (int) $conta['id']]);
            erro(429, 'pin_travado', 'PIN bloqueado. Tente de novo em até 10 minutos.');
        }
        $pin = is_string($j['pin'] ?? null) ? $j['pin'] : '';
        if (!preg_match('/^\d{6}$/', $pin)) {
            erro(400, 'pin_formato', 'O PIN tem 6 dígitos (só números).');
        }
        // 3 PINs a cada 10 min: a tentativa é somada ANTES de conferir (a leitura de cima só poupa o banco). Pedidos ao
        // mesmo tempo com o mesmo cookie não testam mais de 3 PINs: cada um soma primeiro e só confere se ficou dentro.
        $n = somarLimite('painel-pin', $quem);
        if ($n > LENDA_PIN_TENTATIVAS) {
            registrarLimitePainel('painel_pin_travado', ['admin' => (int) $conta['id']]);
            erro(429, 'pin_travado', 'PIN bloqueado. Tente de novo em até 10 minutos.');
        }
        if (!password_verify(pinPreparado((int) $conta['id'], $pin), (string) $conta['pin_hash'])) {
            registrarAdmin('painel_pin_errado', 'admin:' . (int) $conta['id'], ['restam' => max(0, LENDA_PIN_TENTATIVAS - $n)], $quem);
            if ($n >= LENDA_PIN_TENTATIVAS) {
                registrarAdmin('painel_pin_travado', 'admin:' . (int) $conta['id'], [], $quem);
                erro(429, 'pin_travado', 'PIN bloqueado. Tente de novo em até 10 minutos.');
            }
            $restam = LENDA_PIN_TENTATIVAS - $n;
            erroCom(401, 'pin', 'PIN incorreto. Restam ' . $restam . ($restam === 1 ? ' tentativa.' : ' tentativas.'), ['restam' => $restam]);
        }
        sql('DELETE FROM tentativas WHERE chave = ?', [chaveLimite('painel-pin', $quem)[0]]);
        $etapa = proximaEtapa($conta, 'pin');
        trocarSessaoPainel($s, $etapa);
        if ($etapa === 'pronto') {
            entrouNoPainel($conta);
        }
        respostaEtapa($conta, $etapa);
    }

    if ($acao === 'trocar_senha') {
        $s = sessaoNaEtapa(['trocar_senha']);
        $conta = $s['conta'];
        $nova = $j['nova'] ?? null;
        if (($p = problemaSenhaAdmin($nova)) !== null) {
            erro(400, 'senha', $p);
        }
        if (password_verify((string) $nova, (string) $conta['senha_hash'])) {
            erro(400, 'senha', 'Escolha uma senha diferente da provisória.');
        }
        sql('UPDATE admin_contas SET senha_hash = ?, trocar_senha = 0, senha_em = ? WHERE id = ?',
            [password_hash((string) $nova, PASSWORD_DEFAULT), dt($t), (int) $conta['id']]);
        sql('DELETE FROM admin_sessoes WHERE admin_id = ? AND token_sha256 <> ?', [(int) $conta['id'], (string) $s['token_sha256']]);
        $conta['trocar_senha'] = 0;
        registrarAdmin('senha_trocada', 'admin:' . (int) $conta['id'], [], 'a' . (int) $conta['id']);
        $etapa = proximaEtapa($conta, 'trocar_senha');
        trocarSessaoPainel($s, $etapa);
        if ($etapa === 'pronto') {
            entrouNoPainel($conta);
        }
        respostaEtapa($conta, $etapa);
    }

    if ($acao === 'criar_pin') {
        $s = sessaoNaEtapa(['criar_pin', 'pronto']);
        $conta = $s['conta'];
        $temPin = ($conta['pin_hash'] ?? null) !== null && $conta['pin_hash'] !== '';
        if ($s['etapa'] === 'pronto') {
            // fora da entrada (a conta da senha do arquivo cadastrando o PIN): pede a senha de novo, para um cookie
            // copiado não conseguir trancar o dono do lado de fora
            if ($temPin) {
                erro(409, 'tem_pin', 'Esta conta já tem PIN. Para trocar, peça para zerar (LEIAME) e crie outro na próxima entrada.');
            }
            if (adminAtual() === null) {
                erro(401, 'nao_logado', 'Entre de novo no painel.');
            }
            if (!senhaDaContaConfere($conta, is_string($j['senha'] ?? null) ? $j['senha'] : '')) {
                if (somarLimite('painel-minha-senha', 'a' . (int) $conta['id']) > 5) {
                    erroLimite();
                }
                registrarAdmin('minha_senha_falha', 'admin:' . (int) $conta['id'], ['para' => 'criar_pin']);
                erro(401, 'credenciais', 'A senha não confere.');
            }
        }
        $pin = is_string($j['pin'] ?? null) ? $j['pin'] : '';
        if (!preg_match('/^\d{6}$/', $pin)) {
            erro(400, 'pin_formato', 'O PIN tem 6 dígitos (só números).');
        }
        if (($j['repetir'] ?? null) !== $pin) {
            erro(400, 'pin_diferente', 'Os dois PINs não são iguais.');
        }
        if (pinFraco($pin)) {
            erro(400, 'pin_fraco', 'Esse PIN é fácil de adivinhar. Escolha outro.');
        }
        sql('UPDATE admin_contas SET pin_hash = ?, pin_em = ? WHERE id = ?',
            [password_hash(pinPreparado((int) $conta['id'], $pin), PASSWORD_DEFAULT), dt($t), (int) $conta['id']]);
        $conta['pin_hash'] = 'definido';
        registrarAdmin('pin_definido', 'admin:' . (int) $conta['id'], [], 'a' . (int) $conta['id']);
        $vinhaDaEntrada = $s['etapa'] === 'criar_pin';
        trocarSessaoPainel($s, 'pronto');
        if ($vinhaDaEntrada) {
            entrouNoPainel($conta);
        }
        respostaEtapa($conta, 'pronto');
    }

    if ($acao === 'sair') {
        $s = sessaoPainelDoCookie();
        if ($s !== null) {
            sql('DELETE FROM admin_sessoes WHERE token_sha256 = ?', [(string) $s['token_sha256']]);
            if ($s['conta'] !== null && !$s['vencida']) {
                registrarAdmin('painel_sair', 'admin:' . (int) $s['conta']['id'], [], 'a' . (int) $s['conta']['id']);
            }
        }
        esquecerSessaoPainel();
        apagarCookiePainel();
        responder(200, ['ok' => true]);
    }

    // daqui para baixo: sessão pronta (ou o Bearer, onde fizer sentido)
    $adm = exigirAdmin();

    if ($acao === 'sair_todos') {
        if ($adm['id'] === null) {
            erro(400, 'conta', 'O token de script não tem sessões: entre pelo painel.');
        }
        $n = sql('DELETE FROM admin_sessoes WHERE admin_id = ? AND token_sha256 <> ?', [(int) $adm['id'], (string) ($adm['sessao'] ?? '')])->rowCount();
        registrarAdmin('sair_todos', 'admin:' . (int) $adm['id'], ['encerradas' => $n]);
        responder(200, ['ok' => true, 'encerradas' => $n]);
    }

    if ($acao === 'minha_senha') {
        if ($adm['id'] === null) {
            erro(400, 'conta', 'O token de script não tem senha: entre pelo painel.');
        }
        if ($adm['daConfig']) {
            erro(409, 'use_conta', 'Esta conta entra com a senha do arquivo de config: para trocá-la, gere um hash novo (LEIAME §2). Para ter uma senha sua, crie a sua conta.');
        }
        $quem = 'a' . (int) $adm['id'];
        if (lerLimite('painel-minha-senha', $quem) >= 5) {
            erroLimite();
        }
        $s = sessaoPainelDoCookie();
        $conta = $s['conta'];
        if (!senhaDaContaConfere($conta, is_string($j['atual'] ?? null) ? $j['atual'] : '')) {
            somarLimite('painel-minha-senha', $quem);
            registrarAdmin('minha_senha_falha', 'admin:' . (int) $adm['id'], []);
            erro(401, 'credenciais', 'A senha atual não confere.');
        }
        $nova = $j['nova'] ?? null;
        if (($p = problemaSenhaAdmin($nova)) !== null) {
            erro(400, 'senha', $p);
        }
        if ($nova === $j['atual']) {
            erro(400, 'senha', 'A senha nova tem de ser diferente da atual.');
        }
        $n = transacao(static function () use ($conta, $nova, $t, $s): int {
            sql('UPDATE admin_contas SET senha_hash = ?, senha_em = ?, trocar_senha = 0 WHERE id = ?',
                [password_hash((string) $nova, PASSWORD_DEFAULT), dt($t), (int) $conta['id']]);
            return sql('DELETE FROM admin_sessoes WHERE admin_id = ? AND token_sha256 <> ?', [(int) $conta['id'], (string) $s['token_sha256']])->rowCount();
        });
        registrarAdmin('minha_senha', 'admin:' . (int) $adm['id'], ['sessoes' => $n]);
        trocarSessaoPainel($s, 'pronto');
        responder(200, ['ok' => true, 'sessoesEncerradas' => $n]);
    }

    if ($acao === 'criar_conta') {
        if (!$adm['daConfig']) {
            erro(403, 'so_senha_do_arquivo', 'A sua conta pessoal se cria entrando com a senha do arquivo de config. Para outras pessoas, use a aba Equipe.');
        }
        if (haContaPessoal()) {
            erro(409, 'ja_tem_conta', 'Já existe conta pessoal: entre com ela ou peça um acesso na aba Equipe.');
        }
        $email = is_string($j['email'] ?? null) ? strtolower(trim($j['email'])) : '';
        if ($email === '' || strlen($email) > 190 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            erro(400, 'email', 'E-mail inválido.');
        }
        $nome = texto($j['nome'] ?? null, 60);
        if ($nome === null || mb_strlen($nome, 'UTF-8') < 2) {
            erro(400, 'nome', 'O nome precisa ter de 2 a 60 caracteres.');
        }
        if (($p = problemaSenhaAdmin($j['senha'] ?? null)) !== null) {
            erro(400, 'senha', $p);
        }
        try {
            sql("INSERT INTO admin_contas (email, nome, senha_hash, papel, ativo, trocar_senha, da_config, criado_em, criado_por, senha_em)
                VALUES (?, ?, ?, 'dono', 1, 0, 0, ?, ?, ?)", [$email, $nome, password_hash((string) $j['senha'], PASSWORD_DEFAULT), dt($t), (int) $adm['id'], dt($t)]);
        } catch (PDOException $e) {
            if (eChaveDuplicada($e)) {
                erro(409, 'email_em_uso', 'Já existe uma pessoa com esse e-mail na equipe.');
            }
            throw $e;
        }
        $id = (int) bd()->lastInsertId();
        registrarAdmin('criar_conta', 'admin:' . $id, ['email' => emailMascaradoAdmin($email), 'papel' => 'dono']);
        // a sessão da senha do arquivo acaba: a próxima entrada é com o e-mail (e cria o PIN)
        sql('DELETE FROM admin_sessoes WHERE token_sha256 = ?', [(string) ($adm['sessao'] ?? '')]);
        esquecerSessaoPainel();
        apagarCookiePainel();
        responder(201, ['ok' => true, 'id' => $id, 'entrar' => true]);
    }
    erro(400, 'acao', 'Ação desconhecida.');
}
if ($m !== 'GET') {
    erroMetodo();
}
$so = is_string($_GET['so'] ?? null) ? $_GET['so'] : '';
if ($so === 'modo') {
    responder(200, ['modo' => modoPainel()]);
}
if ($so === 'eu') {
    // sem banco: só a assinatura e o prazo do cookie da sessão pronta (ou o Bearer)
    if (!cookiePainelValido() && !tokenAdminValido()) {
        erro(401, 'nao_logado', 'Entre com a senha do painel.');
    }
    responder(200, ['admin' => true]);
}
if ($so === 'sessao') {
    $s = sessaoPainelDoCookie();
    if ($s !== null && $s['vencida'] && $s['etapa'] !== 'pronto') {
        apagarCookiePainel();
        erro(401, 'etapa_expirou', 'Demorou demais. Entre de novo.');
    }
    if ($s !== null && !$s['vencida'] && $s['etapa'] !== 'pronto') {
        $r = ['etapa' => (string) $s['etapa'], 'expiraEm' => iso($s['expira_em']), 'quem' => ['nome' => (string) $s['conta']['nome']]];
        if ($s['etapa'] === 'pin') {
            $r['restam'] = max(0, LENDA_PIN_TENTATIVAS - lerLimite('painel-pin', 'a' . (int) $s['conta']['id']));
        }
        responder(200, $r);
    }
    $adm = exigirAdmin();
    $r = ['etapa' => 'pronto', 'via' => $adm['via'], 'modo' => modoPainel(),
        'quem' => ['id' => $adm['id'], 'nome' => $adm['nome'], 'email' => $adm['email'], 'papel' => $adm['papel'], 'papelNome' => $adm['papelNome'],
            'nivel' => $adm['nivel'], 'daConfig' => $adm['daConfig'], 'temPin' => $adm['temPin']],
        'poderes' => $adm['poderes'], 'expiraEm' => null, 'avisos' => [], 'sessoes' => []];
    if ($adm['id'] !== null) {
        $r['avisos'] = avisosDaConta($s['conta']);
        $r['expiraEm'] = iso($s['expira_em']);
        $t = time();
        $r['sessoes'] = array_map(static fn(array $l): array => ['id' => substr((string) $l['token_sha256'], 0, 12), 'criadaEm' => iso($l['criada_em']),
            'vistoEm' => iso($l['visto_em']), 'expiraEm' => iso($l['expira_em']), 'aparelho' => $l['aparelho'], 'etapa' => (string) $l['etapa'],
            'atual' => $l['token_sha256'] === $adm['sessao']],
            sql("SELECT token_sha256, criada_em, visto_em, expira_em, aparelho, etapa FROM admin_sessoes WHERE admin_id = ? AND expira_em > ?
                AND (etapa <> 'pronto' OR visto_em >= ?) ORDER BY visto_em DESC LIMIT 50",
                [(int) $adm['id'], dt($t), dt($t - LENDA_PAINEL_OCIOSO_S)])->fetchAll());
    }
    // a cópia diária no servidor sai na primeira carga do painel no dia, depois da resposta
    terminarResposta(200, $r);
    require_once __DIR__ . '/_copias.php';
    copiaDiariaTalvez();
    exit;
}
$adm = exigirAdmin('ver');

// ── agora ────────────────────────────────────────────────────────────────────────────────────────

$t = time();
$ag = umaLinha('SELECT COUNT(*) AS online, COALESCE(SUM(jogando_ate > ?), 0) AS jogando
    FROM visitas WHERE ultimo >= ? AND bot = 0', [dt($t), dt($t - 60)]);
$agora = ['online' => (int) $ag['online'], 'jogando' => (int) $ag['jogando'], 'atualizadoEm' => gmdate('Y-m-d\TH:i:s\Z', $t)];
if ($so === 'agora') {
    // números de ação, alertas e filas (P0-2, P1-13: _atencao.php) e a equipe no painel agora e os recados (S13, S14)
    try {
        $agora += pulsoAdmin();
    } catch (PDOException $e) {
        if (!eFaltaDeSchema($e)) {
            throw $e;
        }
        $agora += ['acao' => null, 'alertas' => null, 'filas' => null]; // banco da v3.2 ainda não instalado
    }
    $agora['equipe'] = array_map(static fn(array $p): array => ['nome' => $p['nome'], 'papel' => $p['papel'],
        'eu' => $adm['id'] !== null && $p['id'] === $adm['id']], presencaEquipe());
    $agora['recadosNaoLidos'] = recadosNaoLidos($adm);
    responder(200, ['agora' => $agora]);
}

// ── período ──────────────────────────────────────────────────────────────────────────────────────

function lerDia(mixed $v): ?string
{
    if (!is_string($v) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $p) || !checkdate((int) $p[2], (int) $p[3], (int) $p[1])) {
        return null;
    }
    return $v;
}

function diaUtc(string $dia): int
{
    return (int) strtotime($dia . ' 00:00:00 UTC');
}

$hoje = gmdate('Y-m-d', $t - LENDA_FUSO_H * 3600);
$ate = lerDia($_GET['ate'] ?? null) ?? $hoje;
$de = lerDia($_GET['de'] ?? null) ?? gmdate('Y-m-d', diaUtc($ate) - 6 * 86400);
if ($de > $ate) {
    [$de, $ate] = [$ate, $de];
}
if (diaUtc($ate) - diaUtc($de) > 400 * 86400) {
    $de = gmdate('Y-m-d', diaUtc($ate) - 400 * 86400);
}
$a = dt(diaUtc($de) + LENDA_FUSO_H * 3600);
$b = dt(diaUtc($ate) + 86400 + LENDA_FUSO_H * 3600);
$bots = ($_GET['bots'] ?? '0') === '1';
$utm = ($_GET['utm'] ?? '0') === '1';

// O resto pesa (eventos de 13 meses): a resposta fica guardada por painel_cache_s (90 s) por período, e só um pedido
// recalcula de cada vez (os outros recebem a guardada, mesmo um pouco velha). O "agora" é sempre na hora.
$cacheS = max(0, (int) (config()['painel_cache_s'] ?? 90));
$chaveCache = '_painel:' . $de . ':' . $ate . ':' . ($bots ? '1' : '0') . ($utm ? 'u' : '');
$travou = false;
if ($cacheS > 0) {
    $guardado = lerEstado($chaveCache);
    $fresco = is_array($guardado) && is_int($guardado['em'] ?? null) && is_array($guardado['dados'] ?? null);
    if ($fresco && $guardado['em'] > $t - $cacheS) {
        responder(200, ['agora' => $agora] + $guardado['dados']);
    }
    $travou = pegarTrava('lenda_painel', 0);
    if (!$travou && $fresco) {
        responder(200, ['agora' => $agora] + $guardado['dados']); // outro está recalculando: a de antes serve
    }
    if (!$travou) {
        $travou = pegarTrava('lenda_painel', 10);
        $guardado = lerEstado($chaveCache);
        if (is_array($guardado) && is_int($guardado['em'] ?? null) && is_array($guardado['dados'] ?? null) && $guardado['em'] > $t - $cacheS) {
            if ($travou) {
                soltarTrava('lenda_painel');
            }
            responder(200, ['agora' => $agora] + $guardado['dados']);
        }
    }
}

// Filtros fixos (nada do pedido entra no texto do SQL). Robôs: as visitas pela coluna bot; os eventos pela
// lista (pequena, com índice) das sessões-robô do período, em vez de um JOIN por evento.
$a1 = dt(diaUtc($de) + LENDA_FUSO_H * 3600 - 86400); // sessão-robô que começou até 1 dia antes
// v3.2 (P1-6): sem "incluir robôs/testes", também ficam de fora as visitas (e os eventos delas) das contas de teste e
// oficiais (lista curta de ids inteiros, lida uma vez por pedido).
$foraIds = $bots ? [] : idsContasTeste();
$foraIn = $foraIds ? implode(', ', array_map('intval', $foraIds)) : '';
// rev3: pelo sid (a chave primária, que todo índice secundário do InnoDB carrega), não pelo usuario_id: o ix_visitas_inicio
// continua cobrindo a consulta do período (com usuario_id, cada visita virava uma leitura da linha: ~75% mais lento). A
// lista das sessões dessas contas sai do ix_visitas_usuario (pequena: são poucas contas).
$fora = static fn(string $a): string => $foraIn !== '' ? " AND $a.sid NOT IN (SELECT x.sid FROM visitas x WHERE x.usuario_id IN ($foraIn))" : '';
$sessoesFora = $foraIn !== '' ? "(bot = 1 OR usuario_id IN ($foraIn))" : 'bot = 1';
$fv = $bots ? '' : ' AND v.bot = 0' . $fora('v');
$fw = $bots ? '' : ' AND w.bot = 0' . $fora('w');
$nbE = $bots ? '' : " AND e.sid NOT IN (SELECT sid FROM visitas WHERE $sessoesFora AND inicio >= ? AND inicio < ?)";
$nbC = $bots ? '' : " AND c.sid NOT IN (SELECT sid FROM visitas WHERE $sessoesFora AND inicio >= ? AND inicio < ?)";
$ab = [$a, $b];
$abE = $bots ? $ab : [$a, $b, $a1, $b];
$lv = 'v.inicio >= ? AND v.inicio < ?';
$le = 'e.em >= ? AND e.em < ?';
$porInicio = ' FORCE INDEX (ix_visitas_inicio)';
$fuso = ' - INTERVAL ' . LENDA_FUSO_H . ' HOUR';

$pv = umaLinha("SELECT COUNT(*) AS sessoes, COUNT(DISTINCT v.vid) AS visitantes, COALESCE(SUM(v.ativo_s), 0) AS total
    FROM visitas v$porInicio WHERE $lv$fv", $ab);
$sessoes = (int) $pv['sessoes'];
$visitantes = (int) $pv['visitantes'];
$total = (int) $pv['total'];
$novos = (int) umValor("SELECT COUNT(DISTINCT v.vid) FROM visitas v$porInicio WHERE $lv$fv
    AND NOT EXISTS (SELECT 1 FROM visitas w WHERE w.vid = v.vid AND w.inicio < ?)", [$a, $b, $a]);

// Eventos do período por tipo e modo (contagens) e por tipo (pessoas).
$inicios = ['classico' => 0, 'imersivo' => 0, 'live' => 0];
$fins = $inicios;
$contagem = [];
foreach (sql("SELECT e.tipo, e.modo, COUNT(*) AS n FROM eventos e
    WHERE e.tipo IN ('jogo_inicio', 'jogo_fim', 'partida_fim', 'gate_ver', 'gate_fechar', 'cadastro', 'login')
      AND $le$nbE GROUP BY e.tipo, e.modo", $abE) as $l) {
    $contagem[$l['tipo']] = ($contagem[$l['tipo']] ?? 0) + (int) $l['n'];
    if ($l['modo'] !== null && isset($inicios[$l['modo']])) {
        if ($l['tipo'] === 'jogo_inicio') {
            $inicios[$l['modo']] += (int) $l['n'];
        } elseif ($l['tipo'] === 'jogo_fim') {
            $fins[$l['modo']] += (int) $l['n'];
        }
    }
}
$pessoas = [];
foreach (sql("SELECT e.tipo, COUNT(DISTINCT e.vid) AS p FROM eventos e
    WHERE e.tipo IN ('jogo_inicio', 'jogo_fim', 'gate_ver', 'gate_fechar') AND $le$nbE GROUP BY e.tipo", $abE) as $l) {
    $pessoas[$l['tipo']] = (int) $l['p'];
}
$cadastrosDepois = (int) umValor("SELECT COUNT(DISTINCT c.vid) FROM eventos c
    WHERE c.tipo = 'cadastro' AND c.em >= ? AND c.em < ?$nbC
      AND EXISTS (SELECT 1 FROM eventos g WHERE g.vid = c.vid AND g.tipo = 'gate_ver' AND g.em <= c.em)", $abE);
$cadastros = (int) umValor('SELECT COUNT(*) FROM usuarios WHERE criado_em >= ? AND criado_em < ?', $ab);

// 5 partidas: visitantes do período com 5 ou mais (jogo_fim clássico/imersivo + partida_fim) na vida toda — a soma
// por aparelho fica em partidas_vid (o e.php soma), em vez de agrupar a tabela eventos inteira.
$cinco = (int) umValor("SELECT COUNT(*) FROM partidas_vid p
    WHERE p.n >= 5 AND EXISTS (SELECT 1 FROM visitas w FORCE INDEX (ix_visitas_vid)
        WHERE w.vid = p.vid AND w.inicio >= ? AND w.inicio < ?$fw)", $ab);

// a nota do jogo_fim fica na coluna eventos.nota (o e.php grava); as linhas de antes dela, no JSON de dados
$notas = umaLinha('SELECT ROUND(AVG(x)) AS media, MAX(x) AS melhor FROM (
        SELECT COALESCE(e.nota, CASE WHEN JSON_TYPE(JSON_EXTRACT(e.dados, \'$.nota\')) IN (\'INTEGER\', \'UNSIGNED INTEGER\', \'DOUBLE\', \'DECIMAL\')
                AND JSON_EXTRACT(e.dados, \'$.nota\') + 0 BETWEEN -999 AND 999 THEN JSON_EXTRACT(e.dados, \'$.nota\') + 0 END) AS x
        FROM eventos e
        WHERE e.tipo = \'jogo_fim\' AND e.modo IN (\'classico\', \'imersivo\') AND ' . $le . $nbE . '
          AND (e.nota IS NOT NULL OR e.dados IS NOT NULL)
    ) t WHERE x IS NOT NULL', $abE);

// ── por dia, hora, origem e aparelho ─────────────────────────────────────────────────────────────

$dias = [];
for ($d = diaUtc($de); $d <= diaUtc($ate); $d += 86400) {
    $k = gmdate('Y-m-d', $d);
    $dias[$k] = ['dia' => $k, 'visitantes' => 0, 'sessoes' => 0, 'jogaram' => 0, 'fins' => 0, 'cadastros' => 0, 'tempoMedioS' => 0];
}
foreach (sql("SELECT DATE(v.inicio$fuso) AS dia, COUNT(*) AS sessoes, COUNT(DISTINCT v.vid) AS visitantes,
    COALESCE(SUM(v.ativo_s), 0) AS total FROM visitas v$porInicio WHERE $lv$fv GROUP BY dia", $ab) as $l) {
    if (isset($dias[$l['dia']])) {
        $dias[$l['dia']]['visitantes'] = (int) $l['visitantes'];
        $dias[$l['dia']]['sessoes'] = (int) $l['sessoes'];
        $dias[$l['dia']]['tempoMedioS'] = (int) $l['sessoes'] > 0 ? (int) round((int) $l['total'] / (int) $l['sessoes']) : 0;
    }
}
foreach (sql("SELECT DATE(e.em$fuso) AS dia, e.tipo, COUNT(*) AS n, COUNT(DISTINCT e.vid) AS p FROM eventos e
    WHERE e.tipo IN ('jogo_inicio', 'jogo_fim') AND $le$nbE GROUP BY dia, e.tipo", $abE) as $l) {
    if (isset($dias[$l['dia']])) {
        if ($l['tipo'] === 'jogo_inicio') {
            $dias[$l['dia']]['jogaram'] = (int) $l['p'];
        } else {
            $dias[$l['dia']]['fins'] = (int) $l['n'];
        }
    }
}
foreach (sql("SELECT DATE(criado_em$fuso) AS dia, COUNT(*) AS n FROM usuarios WHERE criado_em >= ? AND criado_em < ?
    GROUP BY dia", $ab) as $l) {
    if (isset($dias[$l['dia']])) {
        $dias[$l['dia']]['cadastros'] = (int) $l['n'];
    }
}

// Uma passada só para hora, origem e aparelho (no máximo 24 × origens × aparelhos linhas).
$horas = [];
for ($h = 0; $h < 24; $h++) {
    $horas[$h] = ['hora' => $h, 'sessoes' => 0];
}
$porOrigem = [];
$porAparelho = [];
foreach (sql("SELECT HOUR(v.inicio$fuso) AS h, v.origem, COALESCE(v.dispositivo, 'outro') AS disp, COUNT(*) AS n
    FROM visitas v$porInicio WHERE $lv$fv GROUP BY h, v.origem, disp", $ab) as $l) {
    $n = (int) $l['n'];
    $horas[(int) $l['h']]['sessoes'] += $n;
    $porOrigem[(string) $l['origem']] = ($porOrigem[(string) $l['origem']] ?? 0) + $n;
    $porAparelho[(string) $l['disp']] = ($porAparelho[(string) $l['disp']] ?? 0) + $n;
}
$ordenar = static function (array $m, string $campo): array {
    uksort($m, static fn($x, $y) => [$m[$y], (string) $x] <=> [$m[$x], (string) $y]);
    $out = [];
    foreach (array_slice($m, 0, 20, true) as $k => $n) {
        $out[] = [$campo => (string) $k, 'sessoes' => $n];
    }
    return $out;
};
$origens = $ordenar($porOrigem, 'origem');
$dispositivos = $ordenar($porAparelho, 'dispositivo');

// ── contas ───────────────────────────────────────────────────────────────────────────────────────

$ultimos = array_map(static fn(array $l): array => [
    'apelido' => (string) $l['apelido'], 'em' => iso($l['criado_em']), 'origem' => (string) $l['origem'],
], sql('SELECT apelido, criado_em, origem FROM usuarios ORDER BY criado_em DESC, id DESC LIMIT 10')->fetchAll());

$ct = umaLinha('SELECT COUNT(*) AS total, COALESCE(SUM(criado_em >= ? AND criado_em < ?), 0) AS novas FROM usuarios', $ab);
$salvas = ['auto' => 0, 'manual' => 0, 'total' => 0, 'noPeriodo' => ['auto' => 0, 'manual' => 0]];
foreach (sql('SELECT como, COUNT(*) AS n, COALESCE(SUM(salva_em >= ? AND salva_em < ?), 0) AS p FROM carreiras GROUP BY como', $ab) as $l) {
    $k = $l['como'] === 'auto' ? 'auto' : 'manual';
    $salvas[$k] += (int) $l['n'];
    $salvas['noPeriodo'][$k] += (int) $l['p'];
    $salvas['total'] += (int) $l['n'];
}
$comCarreira = (int) umValor('SELECT COUNT(DISTINCT usuario_id) FROM carreiras');
$melhores = array_map(static fn(array $l): array => [
    'apelido' => (string) $l['apelido'], 'jogador' => (string) $l['jogador'], 'nota' => (int) $l['nota'],
    'picoOvr' => (int) $l['pico_ovr'], 'modo' => (string) $l['modo'], 'como' => (string) $l['como'], 'salvaEm' => iso($l['salva_em']),
], sql('SELECT u.apelido, c.jogador, c.nota, c.pico_ovr, c.modo, c.como, c.salva_em FROM carreiras c
    JOIN usuarios u ON u.id = c.usuario_id ORDER BY c.nota DESC, c.pico_ovr DESC, c.salva_em ASC LIMIT 10')->fetchAll());

// v3.2 (A4): campanhas por campo do utm (só com &utm=1): top 6 de cada um com visitas, visitantes, contas (que entraram
// numa visita da campanha) e partidas terminadas nelas.
$campanhas = null;
if ($utm) {
    $campanhas = [];
    foreach (['source' => 'utm_source', 'medium' => 'utm_medium', 'campaign' => 'utm_campaign'] as $k => $col) {
        $top = sql("SELECT v.$col AS valor, COUNT(*) AS visitas, COUNT(DISTINCT v.vid) AS visitantes, COUNT(DISTINCT v.usuario_id) AS contas
            FROM visitas v WHERE $lv$fv AND v.$col IS NOT NULL AND v.$col <> '' GROUP BY v.$col ORDER BY visitas DESC, valor LIMIT 6", $ab)->fetchAll();
        $partidas = [];
        if ($top) {
            $vals = array_column($top, 'valor');
            foreach (sql("SELECT v.$col AS valor, COUNT(*) AS n FROM eventos e JOIN visitas v ON v.sid = e.sid
                WHERE e.tipo = 'jogo_fim' AND $le$nbE AND v.$col IN (" . marcas(count($vals)) . ") GROUP BY v.$col", [...$abE, ...$vals]) as $l) {
                $partidas[(string) $l['valor']] = (int) $l['n'];
            }
        }
        $campanhas[$k] = array_map(static fn(array $l): array => ['valor' => (string) $l['valor'], 'visitas' => (int) $l['visitas'],
            'visitantes' => (int) $l['visitantes'], 'contas' => (int) $l['contas'], 'partidas' => $partidas[(string) $l['valor']] ?? 0], $top);
    }
}

limpezaTalvez();

$jogaram = $pessoas['jogo_inicio'] ?? 0;
$dados = [
    'periodo' => [
        'de' => $de,
        'ate' => $ate,
        'visitantes' => $visitantes,
        'novos' => $novos,
        'sessoes' => $sessoes,
        'tempoMedioS' => $sessoes > 0 ? (int) round($total / $sessoes) : 0,
        'tempoTotalH' => round($total / 3600, 1),
        'jogaram' => $jogaram,
        'inicios' => $inicios,
        'fins' => $fins,
        'partidasImersivo' => $contagem['partida_fim'] ?? 0,
        'cadastros' => $cadastros,
        'logins' => $contagem['login'] ?? 0,
        'gate' => [
            'vistos' => $pessoas['gate_ver'] ?? 0,
            'fechados' => $pessoas['gate_fechar'] ?? 0,
            'cadastrosDepois' => $cadastrosDepois,
        ],
    ],
    'dias' => array_values($dias),
    'horas' => array_values($horas),
    'origens' => $origens,
    'dispositivos' => $dispositivos,
    'funil' => [
        ['etapa' => 'Visitaram', 'n' => $visitantes],
        ['etapa' => 'Começaram um jogo', 'n' => $jogaram],
        ['etapa' => 'Terminaram um jogo', 'n' => $pessoas['jogo_fim'] ?? 0],
        ['etapa' => '5 partidas', 'n' => $cinco],
        ['etapa' => 'Criaram conta', 'n' => $cadastros],
    ],
    'notas' => [
        'media' => $notas['media'] !== null ? (int) $notas['media'] : null,
        'melhor' => $notas['melhor'] !== null ? (int) round((float) $notas['melhor']) : null,
    ],
    'ultimosCadastros' => $ultimos,
    'contas' => [
        'total' => (int) $ct['total'],
        'novas' => (int) $ct['novas'],
        'comCarreira' => $comCarreira,
        'carreiras' => $salvas,
        'melhores' => $melhores,
    ],
    'fuso' => 'America/Sao_Paulo',
    'semContasTeste' => count($foraIds),
    'bots' => $bots,
    'geradoEm' => gmdate('Y-m-d\TH:i:s\Z', $t),
];
if ($campanhas !== null) {
    $dados['campanhas'] = $campanhas;
}
if ($cacheS > 0) {
    try {
        gravarSiteConfig($chaveCache, ['em' => $t, 'dados' => $dados], 'painel');
        // os períodos que ninguém pede há mais de 1 dia saem
        sql("DELETE FROM site_config WHERE chave LIKE '\\_painel:%' AND atualizado_em < ?", [dt($t - 86400)]);
    } finally {
        if ($travou) {
            soltarTrava('lenda_painel');
        }
    }
}
responder(200, ['agora' => $agora] + $dados);

<?php
/**
 * LENDA · conta do jogador: cadastrar, entrar, sair, esqueci, redefinir, perfil, partidas, excluir.
 *   GET  conta.php                  → {usuario: U | null, regras}
 *   POST conta.php {"acao": "..."}  → ver servidor/CONTRATO.md
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';

cabecalhos();

const MSG_CREDENCIAIS = 'E-mail ou senha incorretos.';

// ── validação ────────────────────────────────────────────────────────────────────────────────────

function lerEmail(mixed $v): string
{
    $e = is_string($v) ? strtolower(trim($v)) : '';
    if ($e === '' || strlen($e) > 190 || !filter_var($e, FILTER_VALIDATE_EMAIL)) {
        erro(400, 'email_invalido', 'Confira o e-mail: ele parece estar incompleto.');
    }
    return $e;
}

function lerSenha(mixed $v): string
{
    if (!is_string($v) || str_contains($v, "\0") || mb_strlen($v, 'UTF-8') < 6 || strlen($v) > 72) {
        erro(400, 'senha_curta', 'A senha precisa ter de 6 a 72 caracteres.');
    }
    return $v;
}

function lerApelido(mixed $v): string
{
    $a = is_string($v) ? trim($v) : '';
    $n = mb_strlen($a, 'UTF-8');
    if ($n < 2 || $n > 20 || !preg_match('/^[\p{L}\p{M}\p{N}_.\- ]+$/u', $a) || preg_match('/\s{2,}/u', $a)) {
        erro(400, 'apelido_invalido', 'O apelido precisa ter de 2 a 20 caracteres: letras, números, espaço, _ . ou -.');
    }
    return $a;
}

/** Senha que dá para conferir: o bcrypt para no byte nulo e só lê 72 bytes. */
function senhaVerificavel(string $s): bool
{
    return $s !== '' && strlen($s) <= 72 && !str_contains($s, "\0");
}

/** Time do coração: texto livre de até 40 caracteres; vazio = null. */
function lerTime(mixed $v): ?string
{
    if ($v === null || $v === '') {
        return null;
    }
    if (!is_string($v) || mb_strlen(trim($v), 'UTF-8') > 40) {
        erro(400, 'time_invalido', 'O time do coração pode ter até 40 caracteres.');
    }
    return texto($v, 40);
}

/** Sigla de estado brasileiro ou EX (fora do Brasil); vazio = null. */
function lerUf(mixed $v): ?string
{
    if ($v === null || $v === '') {
        return null;
    }
    $uf = is_string($v) ? strtoupper(trim($v)) : '';
    if (!in_array($uf, LENDA_UFS, true)) {
        erro(400, 'uf_invalida', 'Escolha um estado da lista.');
    }
    return $uf;
}

// ── usuário U ────────────────────────────────────────────────────────────────────────────────────

/** Objeto U do contrato, com as estatísticas tiradas do banco. */
function usuarioJson(array $u): array
{
    $id = (int) $u['id'];
    $c = umaLinha('SELECT COUNT(*) AS n, MAX(nota) AS melhor, COALESCE(SUM(bolas_ouro), 0) AS bo,
        COALESCE(SUM(gols), 0) AS gols, COALESCE(SUM(titulos), 0) AS tit FROM carreiras WHERE usuario_id = ?', [$id]);
    $melhorJogador = $c && (int) $c['n'] > 0
        ? umValor('SELECT jogador FROM carreiras WHERE usuario_id = ? ORDER BY nota DESC, pico_ovr DESC, salva_em ASC LIMIT 1', [$id])
        : null;
    $v = umaLinha('SELECT COALESCE(SUM(ativo_s), 0) AS s, MIN(inicio) AS p, MAX(ultimo) AS u FROM visitas WHERE usuario_id = ?', [$id]);
    $aparelhos = sql('SELECT dispositivo FROM visitas WHERE usuario_id = ? AND dispositivo IS NOT NULL
        GROUP BY dispositivo ORDER BY MIN(inicio)', [$id])->fetchAll(PDO::FETCH_COLUMN);
    $partidasEventos = (int) umValor("SELECT COUNT(*) FROM visitas v JOIN eventos e ON e.sid = v.sid
        WHERE v.usuario_id = ? AND e.tipo IN ('jogo_fim', 'partida_fim')
          AND (e.tipo = 'partida_fim' OR e.modo IN ('classico', 'imersivo'))", [$id]);

    $primeiro = $u['criado_em'];
    if (!empty($v['p']) && $v['p'] < $primeiro) {
        $primeiro = $v['p'];
    }
    $ultimo = $u['criado_em'];
    foreach ([$u['ultimo_acesso'] ?? null, $u['ultimo_login'] ?? null, $v['u'] ?? null] as $x) {
        if (!empty($x) && $x > $ultimo) {
            $ultimo = $x;
        }
    }
    return [
        'id' => $id,
        'apelido' => (string) $u['apelido'],
        'email' => (string) $u['email'],
        'criadoEm' => iso($u['criado_em']),
        'timeCoracao' => $u['time_coracao'] !== null ? (string) $u['time_coracao'] : null,
        'uf' => $u['uf'] !== null ? (string) $u['uf'] : null,
        'origem' => (string) $u['origem'],
        'estatisticas' => [
            'partidas' => max((int) $u['partidas'], $partidasEventos),
            'carreirasSalvas' => (int) ($c['n'] ?? 0),
            'melhorNota' => isset($c['melhor']) ? (int) $c['melhor'] : null,
            'melhorJogador' => $melhorJogador !== null ? (string) $melhorJogador : null,
            'bolasOuro' => (int) ($c['bo'] ?? 0),
            'gols' => (int) ($c['gols'] ?? 0),
            'titulos' => (int) ($c['tit'] ?? 0),
            'tempoJogadoMin' => intdiv((int) ($v['s'] ?? 0), 60),
            'primeiroAcesso' => iso($primeiro),
            'ultimoAcesso' => iso($ultimo),
            'aparelhos' => array_values(array_map('strval', $aparelhos)),
        ],
    ];
}

function buscarUsuario(int $id): array
{
    $u = umaLinha('SELECT * FROM usuarios WHERE id = ?', [$id]);
    if ($u === null) {
        erro(401, 'nao_logado', 'Entre na sua conta para continuar.');
    }
    return $u;
}

/** Liga o visitante (aparelho) à conta e passa para ela as visitas sem dono desse aparelho. */
function ligarVisitante(?string $vid, int $uid): void
{
    if ($vid === null) {
        return;
    }
    $t = dt(time());
    sql('INSERT INTO visitantes_usuarios (vid, usuario_id, ligado_em) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE usuario_id = VALUES(usuario_id), ligado_em = VALUES(ligado_em)', [$vid, $uid, $t]);
    sql('UPDATE visitas SET usuario_id = ? WHERE vid = ? AND usuario_id IS NULL', [$uid, $vid]);
}

// ── GET ──────────────────────────────────────────────────────────────────────────────────────────

$cfg = config();
$regras = [
    'aposPartidas' => (int) $cfg['regras']['apos_partidas'],
    'obrigatorio' => (bool) $cfg['regras']['obrigatorio'],
    'lembrarACada' => (int) $cfg['regras']['lembrar_a_cada'],
];

if (metodo() === 'GET') {
    $u = usuarioLogado();
    limpezaTalvez();
    responder(200, ['usuario' => $u ? usuarioJson($u) : null, 'regras' => $regras]);
}
if (metodo() !== 'POST') {
    erroMetodo();
}

// ── POST ─────────────────────────────────────────────────────────────────────────────────────────

exigirEscrita();
$j = lerJson(16 * 1024);
$acao = is_string($j['acao'] ?? null) ? $j['acao'] : '';
$vid = uuid($j['vid'] ?? null);
limpezaTalvez();

switch ($acao) {
    case 'cadastrar':
        limitar('cadastrar', quemIp(), 5);
        limitar('cadastrar-todos', 'todos', 200); // teto do site inteiro (folgado para o pico de um vídeo)
        $apelido = lerApelido($j['apelido'] ?? null);
        $email = lerEmail($j['email'] ?? null);
        $senha = lerSenha($j['senha'] ?? null);
        if (($j['aceite'] ?? null) !== true) {
            erro(400, 'aceite', 'Para criar a conta, aceite a política de privacidade.');
        }
        $time = lerTime($j['timeCoracao'] ?? null);
        $uf = lerUf($j['uf'] ?? null);
        // Origem: a da primeira visita deste aparelho; sem ela, a que o jogo mandou.
        $origem = $vid !== null ? umValor('SELECT origem FROM visitas WHERE vid = ? ORDER BY inicio LIMIT 1', [$vid]) : null;
        if (!is_string($origem) || $origem === '') {
            $origem = normalizarOrigem(is_string($j['origem'] ?? null) ? $j['origem'] : null, null);
        }
        $hash = password_hash($senha, PASSWORD_DEFAULT);
        $t = dt(time());
        try {
            $uid = transacao(static function (PDO $pdo) use ($email, $apelido, $hash, $t, $origem, $time, $uf, $vid): int {
                sql('INSERT INTO usuarios (email, apelido, senha_hash, criado_em, ultimo_login, ultimo_acesso, origem, aceite_em,
                    time_coracao, uf, partidas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
                    [$email, $apelido, $hash, $t, $t, $t, $origem, $t, $time, $uf]);
                $uid = (int) $pdo->lastInsertId();
                ligarVisitante($vid, $uid);
                encerrarSessaoAtual();
                criarSessao($uid);
                return $uid;
            });
        } catch (PDOException $e) {
            if (eChaveDuplicada($e)) {
                erro(409, 'email_em_uso', 'Já existe uma conta com esse e-mail. Tente entrar.');
            }
            throw $e;
        }
        responder(201, ['usuario' => usuarioJson(buscarUsuario($uid))]);

    case 'entrar':
        $email = is_string($j['email'] ?? null) ? strtolower(trim($j['email'])) : '';
        $senha = is_string($j['senha'] ?? null) ? $j['senha'] : '';
        limitar('entrar', quemIp(), 10);
        limitar('entrar-e', quemEmail($email), 5);
        $u = ($email !== '' && strlen($email) <= 190) ? umaLinha('SELECT id, senha_hash FROM usuarios WHERE email = ?', [$email]) : null;
        $ok = false;
        if ($u !== null && senhaVerificavel($senha)) {
            $ok = password_verify($senha, (string) $u['senha_hash']);
        } else {
            password_hash('x', PASSWORD_DEFAULT); // mesmo tempo com ou sem conta
        }
        if (!$ok) {
            erro(401, 'credenciais', MSG_CREDENCIAIS);
        }
        $uid = (int) $u['id'];
        $novoHash = password_needs_rehash((string) $u['senha_hash'], PASSWORD_DEFAULT) ? password_hash($senha, PASSWORD_DEFAULT) : null;
        transacao(static function () use ($uid, $vid, $novoHash): void {
            $t = dt(time());
            if ($novoHash !== null) {
                sql('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [$novoHash, $uid]);
            }
            sql('UPDATE usuarios SET ultimo_login = ?, ultimo_acesso = ? WHERE id = ?', [$t, $t, $uid]);
            ligarVisitante($vid, $uid);
            encerrarSessaoAtual(); // sessão nova a cada login
            criarSessao($uid);
        });
        responder(200, ['usuario' => usuarioJson(buscarUsuario($uid))]);

    case 'sair':
        encerrarSessaoAtual();
        apagarCookie(LENDA_COOKIE_SESSAO);
        responder(200, ['ok' => true]);

    case 'esqueci':
        $email = lerEmail($j['email'] ?? null);
        limitar('esqueci', quemIp(), 10);
        limitar('esqueci-e', quemEmail($email), 3);
        // Tetos de e-mails mandados, antes de procurar a conta (o 429 não revela se ela existe): no site inteiro
        // (a cota de envio da hospedagem) e por e-mail no dia (ninguém recebe uma enxurrada de códigos).
        limitar('esqueci-todos', 'todos', 40);
        limitar('dia-esqueci-todos', 'todos', 300, 1, 86400);
        limitar('dia-esqueci-e', quemEmail($email), 5, 1, 86400);
        $u = umaLinha('SELECT id, apelido FROM usuarios WHERE email = ?', [$email]);
        $codigo = null;
        // Código válido emitido há menos de 2 min: não manda outro (nem zera as tentativas dele).
        $recente = $u !== null && umValor('SELECT 1 FROM redefinicoes WHERE email = ? AND expira_em > ?', [$email, dt(time() + 1680)]) !== null;
        if ($u !== null && !$recente) {
            $codigo = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            sql('INSERT INTO redefinicoes (email, codigo_hash, expira_em, tentativas) VALUES (?, ?, ?, 0)
                ON DUPLICATE KEY UPDATE codigo_hash = VALUES(codigo_hash), expira_em = VALUES(expira_em), tentativas = 0',
                [$email, hash_hmac('sha256', $email . '|' . $codigo, segredo()), dt(time() + 1800)]);
        }
        // Responde antes de mandar o e-mail: a resposta não demora mais quando a conta existe.
        terminarResposta(200, ['ok' => true]);
        if ($u !== null && $codigo !== null) {
            $corpo = "Olá, {$u['apelido']}!\n\n"
                . "Seu código para criar uma senha nova no LENDA é:\n\n"
                . "    {$codigo}\n\n"
                . "Ele vale por 30 minutos. Digite o código no jogo, na tela \"Esqueci a senha\".\n\n"
                . "Se não foi você que pediu, é só ignorar este e-mail: sua senha continua a mesma.\n\n"
                . "— LENDA · https://oprojeto.online/lenda/\n";
            enviarEmail($email, 'LENDA: seu código para trocar a senha', $corpo);
        }
        exit;

    case 'redefinir':
        $email = lerEmail($j['email'] ?? null);
        limitar('redefinir', quemIp(), 20);
        limitar('redefinir-e', quemEmail($email), 5);
        limitar('dia-redefinir-e', quemEmail($email), 15, 1, 86400); // no máximo 15 chutes do código por dia
        $cod = $j['codigo'] ?? null;
        if (is_int($cod) && $cod >= 0 && $cod <= 999999) {
            $cod = str_pad((string) $cod, 6, '0', STR_PAD_LEFT);
        }
        $cod = is_string($cod) ? trim($cod) : '';
        $senha = lerSenha($j['senha'] ?? null);
        if (!preg_match('/^\d{6}$/', $cod)) {
            erro(400, 'codigo', 'Código inválido ou vencido. Peça um novo.');
        }
        $uid = transacao(static function () use ($email, $cod, $senha, $vid): ?int {
            $r = umaLinha('SELECT codigo_hash, expira_em, tentativas FROM redefinicoes WHERE email = ? FOR UPDATE', [$email]);
            if ($r === null || (paraTempo($r['expira_em']) ?? 0) < time() || (int) $r['tentativas'] >= 5) {
                return null;
            }
            if (!hash_equals((string) $r['codigo_hash'], hash_hmac('sha256', $email . '|' . $cod, segredo()))) {
                sql('UPDATE redefinicoes SET tentativas = tentativas + 1 WHERE email = ?', [$email]);
                return null;
            }
            $u = umaLinha('SELECT id FROM usuarios WHERE email = ? FOR UPDATE', [$email]);
            sql('DELETE FROM redefinicoes WHERE email = ?', [$email]);
            if ($u === null) {
                return null;
            }
            $uid = (int) $u['id'];
            $t = dt(time());
            sql('UPDATE usuarios SET senha_hash = ?, ultimo_login = ?, ultimo_acesso = ? WHERE id = ?',
                [password_hash($senha, PASSWORD_DEFAULT), $t, $t, $uid]);
            sql('DELETE FROM sessoes_login WHERE usuario_id = ?', [$uid]); // derruba as outras sessões
            ligarVisitante($vid, $uid);
            criarSessao($uid);
            return $uid;
        });
        if ($uid === null) {
            erro(400, 'codigo', 'Código inválido ou vencido. Peça um novo.');
        }
        responder(200, ['usuario' => usuarioJson(buscarUsuario($uid))]);

    case 'perfil':
        $u = exigirUsuario();
        $campos = [];
        $params = [];
        if (array_key_exists('apelido', $j)) {
            $campos[] = 'apelido = ?';
            $params[] = lerApelido($j['apelido']);
        }
        if (array_key_exists('timeCoracao', $j)) {
            $campos[] = 'time_coracao = ?';
            $params[] = lerTime($j['timeCoracao']);
        }
        if (array_key_exists('uf', $j)) {
            $campos[] = 'uf = ?';
            $params[] = lerUf($j['uf']);
        }
        if ($campos) {
            $params[] = (int) $u['id'];
            sql('UPDATE usuarios SET ' . implode(', ', $campos) . ' WHERE id = ?', $params);
        }
        responder(200, ['usuario' => usuarioJson(buscarUsuario((int) $u['id']))]);

    case 'partidas':
        $u = exigirUsuario();
        $n = $j['n'] ?? null;
        if (is_float($n) && floor($n) === $n) {
            $n = (int) $n;
        }
        if (!is_int($n) || $n < 0 || $n > 10000000) {
            erro(400, 'dados', 'Número de partidas inválido.');
        }
        sql('UPDATE usuarios SET partidas = GREATEST(partidas, ?) WHERE id = ?', [$n, (int) $u['id']]);
        responder(200, ['ok' => true]);

    case 'excluir':
        $u = exigirUsuario();
        $uid = (int) $u['id'];
        limitar('excluir', 'u' . $uid, 5);
        $senha = is_string($j['senha'] ?? null) ? $j['senha'] : '';
        $h = (string) umValor('SELECT senha_hash FROM usuarios WHERE id = ?', [$uid]);
        if (!senhaVerificavel($senha) || !password_verify($senha, $h)) {
            erro(401, 'credenciais', 'Senha incorreta.');
        }
        transacao(static function () use ($uid, $u): void {
            sql('DELETE FROM carreiras WHERE usuario_id = ?', [$uid]);
            sql('DELETE FROM sessoes_login WHERE usuario_id = ?', [$uid]);
            sql('DELETE FROM visitantes_usuarios WHERE usuario_id = ?', [$uid]);
            // As visitas ficam só como estatística anônima: cada aparelho da conta ganha um vid novo, senão a
            // próxima conta criada nele herdaria esse histórico (ligarVisitante liga as visitas sem dono do vid).
            $vids = sql('SELECT DISTINCT vid FROM visitas WHERE usuario_id = ?', [$uid])->fetchAll(PDO::FETCH_COLUMN);
            foreach ($vids as $velho) {
                $novo = uuidNovo();
                sql('UPDATE eventos e JOIN visitas v ON v.sid = e.sid SET e.vid = ? WHERE v.usuario_id = ? AND v.vid = ?', [$novo, $uid, $velho]);
                sql('UPDATE visitas SET vid = ?, usuario_id = NULL WHERE usuario_id = ? AND vid = ?', [$novo, $uid, $velho]);
            }
            sql('UPDATE visitas SET usuario_id = NULL WHERE usuario_id = ?', [$uid]);
            sql('DELETE FROM redefinicoes WHERE email = ?', [(string) $u['email']]);
            sql('DELETE FROM usuarios WHERE id = ?', [$uid]);
        });
        apagarCookie(LENDA_COOKIE_SESSAO);
        responder(200, ['ok' => true]);

    default:
        erro(400, 'acao', 'Ação desconhecida.');
}

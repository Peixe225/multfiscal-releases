<?php
/**
 * LENDA · conta do jogador: cadastrar, entrar, sair, esqueci, redefinir, perfil, partidas, excluir.
 *   GET  conta.php                  → {usuario: U | null, regras, site}
 *   POST conta.php {"acao": "..."}  → ver servidor/CONTRATO.md e CONTRATO-v3.md §3; v3.2 (CONTRATO-v32 §A.7): U.tester,
 *        U.aviso e {"acao": "aviso_lido"}, site.avisos do público de quem pediu
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';
require __DIR__ . '/_contas.php';
require __DIR__ . '/_bonus.php';

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

/** Modo do Hall público da conta: auto | manual | nao. */
function lerHallPublico(mixed $v): string
{
    if (!in_array($v, ['auto', 'manual', 'nao'], true)) {
        erro(400, 'hall_invalido', 'Escolha como suas carreiras aparecem no Hall: automático, escolhidas ou não aparecer.');
    }
    return $v;
}

// ── GET ──────────────────────────────────────────────────────────────────────────────────────────

if (metodo() === 'GET') {
    $u = usuarioLogado();
    if ($u !== null) {
        limitar('conta-get', 'u' . $u['id'], 300); // o jogo pede uma vez por abertura: folga para muitas abas
    }
    limpezaTalvez();
    responder(200, ['usuario' => $u ? usuarioJson($u) : null, 'regras' => regrasPublicas(), 'site' => sitePublico($u !== null)]);
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
        // 30 por IP: no 4G muita gente sai pelo mesmo IP da operadora (CGNAT)
        limitar('cadastrar', quemIp(), 30);
        if (!siteConfig()['cadastro_aberto']) {
            erro(403, 'cadastro_fechado', 'Os cadastros estão fechados no momento. Quem já tem conta pode entrar normalmente.');
        }
        $apelido = lerApelido($j['apelido'] ?? null);
        $email = lerEmail($j['email'] ?? null);
        $senha = lerSenha($j['senha'] ?? null);
        if (($j['aceite'] ?? null) !== true) {
            erro(400, 'aceite', 'Para criar a conta, aceite a política de privacidade.');
        }
        $time = lerTime($j['timeCoracao'] ?? null);
        $uf = lerUf($j['uf'] ?? null);
        // 5 contas por aparelho (vid) a cada 10 min.
        if ($vid !== null) {
            limitar('cadastrar-vid', $vid, 5);
        }
        // Teto do site inteiro (folgado para o pico de um vídeo: ~9.000 contas por hora): só conta o cadastro que passou
        // na validação — pedido inválido já conta no limite por IP e, contando aqui, uns poucos IPs fechariam o
        // cadastro de todo mundo.
        limitar('cadastrar-todos', 'todos', 1500);
        // Origem: a da primeira visita deste aparelho; sem ela, a que o jogo mandou.
        $origem = $vid !== null ? umValor('SELECT origem FROM visitas WHERE vid = ? ORDER BY inicio LIMIT 1', [$vid]) : null;
        if (!is_string($origem) || $origem === '') {
            $origem = normalizarOrigem(is_string($j['origem'] ?? null) ? $j['origem'] : null, null);
        }
        $convite = lerCodigoConvite($j['convite'] ?? null);
        $hash = password_hash($senha, PASSWORD_DEFAULT);
        $t = dt(time());
        try {
            $uid = transacao(static function (PDO $pdo) use ($email, $apelido, $hash, $t, $origem, $time, $uf, $vid, $convite): int {
                sql('INSERT INTO usuarios (email, apelido, senha_hash, criado_em, ultimo_login, ultimo_acesso, origem, aceite_em,
                    time_coracao, uf, partidas, codigo_convite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)',
                    [$email, $apelido, $hash, $t, $t, $t, $origem, $t, $time, $uf]);
                $uid = (int) $pdo->lastInsertId();
                garantirCodigoConvite($uid, null);
                registrarIndicacao($uid, $convite, $vid); // antes de ligar o aparelho (ver se ele é do indicador)
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
        limitar('entrar', quemIp(), 60); // 60 por IP (CGNAT do 4G); 5 por e-mail segura a força bruta
        limitar('entrar-e', quemEmail($email), 5);
        $u = ($email !== '' && strlen($email) <= 190) ? umaLinha('SELECT * FROM usuarios WHERE email = ?', [$email]) : null;
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
        if (contaSuspensa($u)) {
            erro(403, 'suspenso', mensagemSuspenso($u));
        }
        if (($u['status'] ?? 'ativo') === 'suspenso') {
            // a suspensão com data venceu: volta a valer
            sql("UPDATE usuarios SET status = 'ativo', suspenso_ate = NULL, motivo_suspensao = NULL WHERE id = ?", [$uid]);
        }
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
        limitar('esqueci', quemIp(), 20);
        limitar('esqueci-e', quemEmail($email), 3);
        // Por e-mail no dia, antes de procurar a conta (o 429 não revela se ela existe): ninguém recebe uma enxurrada.
        limitar('dia-esqueci-e', quemEmail($email), 5, 1, 86400);
        $u = umaLinha('SELECT id, apelido FROM usuarios WHERE email = ?', [$email]);
        $codigo = null;
        // Código válido emitido há menos de 2 min: não manda outro (nem zera as tentativas dele).
        $recente = $u !== null && umValor('SELECT 1 FROM redefinicoes WHERE email = ? AND expira_em > ?', [$email, dt(time() + 1680)]) !== null;
        $manda = $u !== null && !$recente;
        if ($manda) {
            // Tetos do site inteiro (a cota de envio da hospedagem): só conta o e-mail que vai sair de verdade (e-mail
            // inventado não gasta). Estourou: responde 200 do mesmo jeito, sem mandar (não revela se a conta existe).
            $n10 = somarLimite('esqueci-todos', 'todos');
            $nDia = somarLimite('dia-esqueci-todos', 'todos', 1, 86400);
            if ($n10 > 40 || $nDia > 300) {
                $manda = false;
                // o painel mostra (resumo do admin): quantos e-mails de troca de senha o teto do site segurou
                $e = lerEstado('_esqueci_teto') ?? [];
                gravarSiteConfig('_esqueci_teto', ['em' => gmdate('Y-m-d\TH:i:s\Z'), 'n' => (int) ($e['n'] ?? 0) + 1], 'sistema');
            }
        }
        if ($manda) {
            $codigo = gravarCodigoRedefinicao($email);
        }
        // Responde antes de mandar o e-mail: a resposta não demora mais quando a conta existe.
        terminarResposta(200, ['ok' => true]);
        if ($u !== null && $codigo !== null) {
            enviarEmail($email, 'LENDA: seu código para trocar a senha', corpoEmailRedefinicao((string) $u['apelido'], $codigo), 'esqueci');
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
        $suspensa = null;
        $uid = transacao(static function () use ($email, $cod, $senha, $vid, &$suspensa): ?int {
            $r = umaLinha('SELECT codigo_hash, expira_em, tentativas FROM redefinicoes WHERE email = ? FOR UPDATE', [$email]);
            if ($r === null || (paraTempo($r['expira_em']) ?? 0) < time() || (int) $r['tentativas'] >= 5) {
                return null;
            }
            if (!hash_equals((string) $r['codigo_hash'], hash_hmac('sha256', $email . '|' . $cod, segredo()))) {
                sql('UPDATE redefinicoes SET tentativas = tentativas + 1 WHERE email = ?', [$email]);
                return null;
            }
            $u = umaLinha('SELECT * FROM usuarios WHERE email = ? FOR UPDATE', [$email]);
            sql('DELETE FROM redefinicoes WHERE email = ?', [$email]);
            if ($u === null) {
                return null;
            }
            $uid = (int) $u['id'];
            $t = dt(time());
            sql('UPDATE usuarios SET senha_hash = ?, ultimo_login = ?, ultimo_acesso = ? WHERE id = ?',
                [password_hash($senha, PASSWORD_DEFAULT), $t, $t, $uid]);
            sql('DELETE FROM sessoes_login WHERE usuario_id = ?', [$uid]); // derruba as outras sessões
            if (contaSuspensa($u)) {
                $suspensa = $u; // a senha muda, mas a conta suspensa não entra
                return $uid;
            }
            ligarVisitante($vid, $uid);
            criarSessao($uid);
            return $uid;
        });
        if ($uid === null) {
            erro(400, 'codigo', 'Código inválido ou vencido. Peça um novo.');
        }
        if ($suspensa !== null) {
            erro(403, 'suspenso', mensagemSuspenso($suspensa));
        }
        responder(200, ['usuario' => usuarioJson(buscarUsuario($uid))]);

    case 'perfil':
        $u = exigirUsuario();
        $uid = (int) $u['id'];
        $campos = [];
        $params = [];
        $apelidoNovo = null;
        $hallNovo = null;
        if (array_key_exists('apelido', $j)) {
            $apelidoNovo = lerApelido($j['apelido']);
            $campos[] = 'apelido = ?';
            $params[] = $apelidoNovo;
        }
        if (array_key_exists('hallPublico', $j)) {
            $hallNovo = lerHallPublico($j['hallPublico']);
            $campos[] = 'hall_publico = ?';
            $params[] = $hallNovo;
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
            transacao(static function () use ($campos, $params, $uid, $u, $apelidoNovo, $hallNovo): void {
                sql('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', [$uid]);
                if ($hallNovo === 'manual' && ($u['hall_publico'] ?? 'auto') !== 'manual'
                    && (int) umValor('SELECT COUNT(*) FROM carreiras WHERE usuario_id = ? AND publica = 1', [$uid]) === 0) {
                    // passou para "escolhidas" sem nenhuma marcada: começa com as que já estavam no Hall
                    $ids = idsAutoNoHall($uid);
                    if ($ids) {
                        sql('UPDATE carreiras SET publica = 1 WHERE usuario_id = ? AND id IN (' . marcas(count($ids)) . ')', array_merge([$uid], $ids));
                    }
                }
                sql('UPDATE usuarios SET ' . implode(', ', $campos) . ' WHERE id = ?', array_merge($params, [$uid]));
                if ($apelidoNovo !== null) {
                    sql('UPDATE hall_foto SET apelido = ? WHERE usuario_id = ?', [$apelidoNovo, $uid]);
                }
            });
            if ($hallNovo !== null) {
                // sair do Hall é na hora (o que o modo novo não mostra sai da fotografia); entrar, na próxima fotografia
                tirarDoHallForaDe($uid, idsNoHall($uid, $hallNovo));
            }
        }
        responder(200, ['usuario' => usuarioJson(buscarUsuario($uid))]);

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
        if ($n >= 1) {
            acertarPartidasConta($u); // partidas desde o cadastro (bônus) e a indicação pendente, pelos eventos
        }
        responder(200, ['ok' => true]);

    case 'aviso_lido':
        // v3.2 (H11): o jogador viu o aviso da moderação em Minha conta; ele some
        $u = exigirUsuario();
        if (esquemaV32()) {
            sql('UPDATE usuarios SET aviso_conta = NULL, aviso_conta_em = NULL WHERE id = ?', [(int) $u['id']]);
        }
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
        excluirUsuario($uid);
        apagarCookie(LENDA_COOKIE_SESSAO);
        responder(200, ['ok' => true]);

    default:
        erro(400, 'acao', 'Ação desconhecida.');
}

<?php
/**
 * LENDA · contas: o objeto U, o vínculo do aparelho e a exclusão (LGPD). Usado por conta.php e admin.php.
 * Nunca é servido (o .htaccess nega _*.php). Contrato: servidor/CONTRATO.md e CONTRATO-v3.md §3.
 */
declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/_hall.php';

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
    $codigo = garantirCodigoConvite($id, $u['codigo_convite'] ?? null);
    return [
        'id' => $id,
        'apelido' => (string) $u['apelido'],
        'email' => (string) $u['email'],
        'criadoEm' => iso($u['criado_em']),
        'timeCoracao' => $u['time_coracao'] !== null ? (string) $u['time_coracao'] : null,
        'uf' => $u['uf'] !== null ? (string) $u['uf'] : null,
        'origem' => (string) $u['origem'],
        'hallPublico' => (string) ($u['hall_publico'] ?? 'auto'),
        'codigoConvite' => $codigo,
        // v3.2: tester abre o Imersivo e a Live (com o selo "Teste"), sem o painel nem o #/kit
        'tester' => ($u['tipo'] ?? 'jogador') === 'tester',
        // v3.2: aviso da moderação para o dono (o jogo mostra uma vez; conta.php aviso_lido apaga)
        // v3.3: tipo 'desafio' = o recado de quem venceu um desafio (avisoVencedor); o resto é da moderação
        'aviso' => ($u['aviso_conta'] ?? null) !== null ? ['texto' => (string) $u['aviso_conta'], 'em' => iso($u['aviso_conta_em'] ?? null),
            'tipo' => str_starts_with((string) $u['aviso_conta'], LENDA_AVISO_VENCEDOR) ? 'desafio' : 'moderacao'] : null,
        // v3.3: o e-mail da conta foi confirmado com o código (desafios pedem; contas antigas começam sem)
        'emailVerificado' => ($u['email_verificado_em'] ?? null) !== null,
        'estatisticas' => [
            // o contador do aparelho (inclui as de antes do cadastro) ou as contadas com a conta: nada de contar os
            // eventos da vida inteira a cada abertura do jogo
            'partidas' => max((int) $u['partidas'], (int) ($u['partidas_conta'] ?? 0)),
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

/**
 * Exclui a conta (LGPD): usuário, sessões, carreiras (e o lugar delas no Hall público, as denúncias contra
 * elas e a decisão de moderação guardada), conquistas, bônus, indicações que ela fez, denúncias que ela fez; a
 * indicação que ela recebeu fica sem o indicado (o bônus do amigo continua dele). As visitas ficam só como
 * estatística anônima, com um vid novo por aparelho. No registro do admin, as linhas da conta, das carreiras dela (também
 * as da lixeira) e das indicações dela ficam só com a ação, a data e o id (limparRegistroDaConta). Fica a marca da
 * exclusão (contas_excluidas: só o número da conta), para nenhuma restauração de cópia trazê-la de volta. Sem senha:
 * quem chama confere (conta.php pede a senha; admin.php exige o admin).
 */
function excluirUsuario(int $uid): void
{
    transacao(static function () use ($uid): void {
        $u = umaLinha('SELECT id, email FROM usuarios WHERE id = ? FOR UPDATE', [$uid]);
        if ($u === null) {
            return;
        }
        tirarDoHall(null, $uid);
        $pks = array_map('intval', sql('SELECT id FROM carreiras WHERE usuario_id = ?', [$uid])->fetchAll(PDO::FETCH_COLUMN));
        foreach (array_chunk($pks, 500) as $lote) {
            sql('DELETE FROM denuncias WHERE carreira_pk IN (' . marcas(count($lote)) . ')', $lote);
        }
        limparRegistroDaConta($uid, $pks);
        sql('DELETE FROM carreiras_moderacao WHERE usuario_id = ?', [$uid]);
        if (esquemaV32()) {
            // a marca da exclusão (só o número): uma cópia do servidor restaurada depois nunca traz a conta de volta
            try {
                sql("INSERT IGNORE INTO contas_excluidas (usuario_id, em, via) VALUES (?, ?, ?)",
                    [$uid, dt(time()), function_exists('adminAtual') && adminAtual() !== null ? 'admin' : 'titular']);
            } catch (PDOException $e) {
                if (!eFaltaDeSchema($e)) {
                    throw $e; // sem a tabela (instalar.php pendente), a restauração ainda olha o registro do admin
                }
            }
            // v3.2: a lixeira das carreiras dela (cópia e marca) e o registro dos e-mails mandados para ela; a anotação
            // interna e o aviso da moderação ficam na própria linha de usuarios
            sql('DELETE FROM lixeira_carreiras WHERE usuario_id = ?', [$uid]);
            sql('DELETE FROM email_log WHERE para_hash = ?', [quemEmail(strtolower((string) $u['email']))]);
        }
        // os caches do painel que podem citar a conta (alertas com o apelido, grupos de aparelho, o ranking do Tempo de
        // jogo e as últimas contas/carreiras da Visão geral) são refeitos
        sql("DELETE FROM site_config WHERE chave IN ('_atencao', '_multicontas') OR chave LIKE '\\_tempo:%' OR chave LIKE '\\_painel:%'");
        if (esquemaV33()) {
            // v3.3: as mensagens do Fale conosco (as da conta e as que a pessoa mandou sem entrar, com o mesmo e-mail), as
            // candidaturas aos desafios, o código de confirmação do e-mail e as partidas por dia. Desafio que ela venceu
            // continua vencido, sem dizer por quem.
            sql('DELETE FROM mensagens_suporte WHERE usuario_id = ? OR (usuario_id IS NULL AND email = ?)', [$uid, strtolower((string) $u['email'])]);
            sql('DELETE FROM desafio_candidatos WHERE usuario_id = ?', [$uid]);
            sql('UPDATE desafios SET vencedor_usuario_id = NULL, vencedor_carreira_pk = NULL, vencedor_candidato = NULL WHERE vencedor_usuario_id = ?', [$uid]);
            sql('DELETE FROM verificacoes_email WHERE usuario_id = ?', [$uid]);
            sql('DELETE FROM partidas_dia WHERE usuario_id = ?', [$uid]);
            // §E: as sementes de carreira sorteadas para a conta
            sql('DELETE FROM sementes_carreira WHERE usuario_id = ?', [$uid]);
        }
        if (esquemaV34()) {
            // v3.4: os emblemas da conta (a lista de conquistas da carreira-prova e as provas saem com as carreiras e as conquistas)
            sql('DELETE FROM emblemas_usuario WHERE usuario_id = ?', [$uid]);
            // §E: o "não bateu" guardado pelas sementes da conta (a tabela pode faltar num banco da v3.4 de antes das correções)
            try {
                sql('DELETE FROM provas_nao_bateu WHERE usuario_id = ?', [$uid]);
            } catch (PDOException $e) {
                if (!eFaltaDeSchema($e)) {
                    throw $e;
                }
            }
        }
        // v3.4: as imagens das prévias de link da conta (guardadas em disco, fora do public_html)
        try {
            require_once __DIR__ . '/_previa.php';
            apagarPreviasDaConta($uid);
        } catch (Throwable $e) {
            error_log('LENDA prévias (excluir): ' . $e->getMessage());
        }
        sql('DELETE FROM carreiras WHERE usuario_id = ?', [$uid]);
        sql('DELETE FROM sessoes_login WHERE usuario_id = ?', [$uid]);
        sql('DELETE FROM visitantes_usuarios WHERE usuario_id = ?', [$uid]);
        sql('DELETE FROM conquistas_usuario WHERE usuario_id = ?', [$uid]);
        sql('DELETE FROM bonus WHERE usuario_id = ?', [$uid]);
        sql('DELETE FROM indicacoes WHERE indicador_id = ?', [$uid]);
        sql('UPDATE indicacoes SET indicado_id = NULL WHERE indicado_id = ?', [$uid]);
        sql('DELETE FROM denuncias WHERE usuario_id = ?', [$uid]);
        // As visitas ficam só como estatística anônima: cada aparelho da conta ganha um vid novo, senão a
        // próxima conta criada nele herdaria esse histórico (ligarVisitante liga as visitas sem dono do vid).
        $vids = sql('SELECT DISTINCT vid FROM visitas WHERE usuario_id = ?', [$uid])->fetchAll(PDO::FETCH_COLUMN);
        foreach ($vids as $velho) {
            $novo = uuidNovo();
            sql('UPDATE eventos e JOIN visitas v ON v.sid = e.sid SET e.vid = ? WHERE v.usuario_id = ? AND v.vid = ?', [$novo, $uid, $velho]);
            sql('UPDATE visitas SET vid = ?, usuario_id = NULL WHERE usuario_id = ? AND vid = ?', [$novo, $uid, $velho]);
            sql('UPDATE partidas_vid SET vid = ? WHERE vid = ?', [$novo, $velho]);
        }
        sql('UPDATE visitas SET usuario_id = NULL WHERE usuario_id = ?', [$uid]);
        sql('DELETE FROM redefinicoes WHERE email = ?', [(string) $u['email']]);
        sql('DELETE FROM usuarios WHERE id = ?', [$uid]);
    });
}

/** Ações do registro cujos detalhes citam a conta pelo id (usuario / indicador / indicado), com outro alvo. */
const ACOES_LOG_COM_CONTA = ['ocultar_carreira', 'mostrar_carreira', 'apagar_carreira', 'destacar_carreira', 'restaurar_carreira',
    'resolver_denuncia', 'recusar_indicacao', 'candidato_verificar', 'candidato_recusar', 'desafio_vencedor', 'desafio_reabrir', 'suporte_status',
    'suporte_responder', 'prova_verificar', 'emblema_retirar', 'emblema_devolver']; // v3.3: desafios (alvo desafio:<id>) e Fale conosco (alvo
    // suporte:<id>); v3.4: a verificação das provas (alvo usuario:<id> ou provas) e os emblemas (alvo desafio:<id>)

/**
 * LGPD, no excluirUsuario(): as linhas do registro do admin que falam da conta ficam só com a ação, a data e o id
 * ({via, excluido: true}): as do alvo usuario:<id>; as das carreiras dela (as que ainda existem e as que estão na
 * lixeira, apagadas pela moderação); as das indicações em que ela é indicadora ou indicada; e as que citam o id nos
 * detalhes ("usuario", "indicador", "indicado") com outro alvo (carreira já liberada da lixeira, por exemplo).
 */
function limparRegistroDaConta(int $uid, array $pks): void
{
    $alvos = ['usuario:' . $uid];
    foreach ($pks as $pk) {
        $alvos[] = 'carreira:' . (int) $pk;
    }
    try {
        foreach (sql('SELECT carreira_pk FROM lixeira_carreiras WHERE usuario_id = ?', [$uid])->fetchAll(PDO::FETCH_COLUMN) as $pk) {
            $alvos[] = 'carreira:' . (int) $pk;
        }
    } catch (PDOException $e) {
        if (!eFaltaDeSchema($e)) {
            throw $e; // sem a lixeira (instalar.php pendente): não há carreira apagada pela moderação
        }
    }
    foreach (sql('SELECT id FROM indicacoes WHERE indicador_id = ? OR indicado_id = ?', [$uid, $uid])->fetchAll(PDO::FETCH_COLUMN) as $iid) {
        $alvos[] = 'indicacao:' . (int) $iid;
    }
    $ids = [];
    foreach (array_chunk(array_values(array_unique($alvos)), 500) as $lote) {
        foreach (sql('SELECT id FROM admin_log WHERE alvo IN (' . marcas(count($lote)) . ')', $lote)->fetchAll(PDO::FETCH_COLUMN) as $id) {
            $ids[(int) $id] = true;
        }
    }
    // o id nos detalhes (o json() grava "usuario":12, ou "usuario":12} no fim): só nas ações que o escrevem (índice da ação)
    $parecidos = [];
    $params = [];
    foreach (['usuario', 'indicador', 'indicado'] as $k) {
        foreach ([',', '}'] as $fim) {
            $parecidos[] = 'detalhes LIKE ?';
            $params[] = '%"' . $k . '":' . $uid . $fim . '%';
        }
    }
    foreach (sql('SELECT id, detalhes FROM admin_log WHERE acao IN (' . marcas(count(ACOES_LOG_COM_CONTA)) . ') AND (' . implode(' OR ', $parecidos) . ')',
        array_merge(ACOES_LOG_COM_CONTA, $params))->fetchAll() as $l) {
        $d = is_string($l['detalhes']) ? json_decode($l['detalhes'], true) : null;
        foreach (['usuario', 'indicador', 'indicado'] as $k) {
            if (is_array($d) && ($d[$k] ?? null) === $uid) {
                $ids[(int) $l['id']] = true;
            }
        }
    }
    foreach (array_chunk(array_keys($ids), 500) as $lote) {
        foreach (sql('SELECT id, detalhes FROM admin_log WHERE id IN (' . marcas(count($lote)) . ')', $lote)->fetchAll() as $l) {
            $d = is_string($l['detalhes']) ? json_decode($l['detalhes'], true) : null;
            sql('UPDATE admin_log SET detalhes = ? WHERE id = ?', [json(['via' => is_array($d) && is_string($d['via'] ?? null) ? $d['via'] : 'sistema',
                'excluido' => true]), (int) $l['id']]);
        }
    }
}

/** Código novo de 6 dígitos para trocar a senha (30 min, só o HMAC no banco). Devolve o código (para o e-mail). */
function gravarCodigoRedefinicao(string $email): string
{
    $codigo = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    sql('INSERT INTO redefinicoes (email, codigo_hash, expira_em, tentativas) VALUES (?, ?, ?, 0)
        ON DUPLICATE KEY UPDATE codigo_hash = VALUES(codigo_hash), expira_em = VALUES(expira_em), tentativas = 0',
        [$email, hash_hmac('sha256', $email . '|' . $codigo, segredo()), dt(time() + 1800)]);
    return $codigo;
}

/**
 * Texto do e-mail com o código. $pelaEquipe: mandado pelo painel (U14), não pelo "Esqueci a senha".
 * v3.5: o código numa linha só dele, sem recuo (quem selecionava a linha no celular levava os espaços junto e o campo recusava).
 */
function corpoEmailRedefinicao(string $apelido, string $codigo, bool $pelaEquipe = false): string
{
    return "Olá, {$apelido}!\n\n"
        . ($pelaEquipe ? "A equipe do LENDA mandou este código para você criar uma senha nova (você pediu ajuda para entrar).\n\n"
            : "Seu código para criar uma senha nova no LENDA é:\n\n")
        . "{$codigo}\n\n"
        . "Ele vale por 30 minutos. Digite o código no jogo, na tela \"Esqueci a senha\".\n\n"
        . "Se não foi você que pediu, é só ignorar este e-mail: sua senha continua a mesma.\n\n"
        . "— LENDA · https://oprojeto.online/lenda/\n";
}

// ── confirmação do e-mail (v3.3, CONTRATO-v33 §A) ────────────────────────────────────────────────

const VERIFICACAO_S = 86400;          // o código vale 24 h
const VERIFICACAO_TENTATIVAS = 5;     // chutes por código (depois, só um novo)

/** HMAC do código, preso à conta e ao e-mail de agora (trocar o e-mail invalida o código). */
function hashVerificacao(int $uid, string $email, string $codigo): string
{
    return hash_hmac('sha256', 'verif|' . $uid . '|' . strtolower($email) . '|' . $codigo, segredo());
}

/** Código novo de 6 dígitos para confirmar o e-mail (o anterior deixa de valer). Devolve o código (para o e-mail). */
function gravarCodigoVerificacao(int $uid, string $email): string
{
    $codigo = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $t = time();
    sql('INSERT INTO verificacoes_email (usuario_id, codigo_hash, expira_em, tentativas, criado_em) VALUES (?, ?, ?, 0, ?)
        ON DUPLICATE KEY UPDATE codigo_hash = VALUES(codigo_hash), expira_em = VALUES(expira_em), tentativas = 0, criado_em = VALUES(criado_em)',
        [$uid, hashVerificacao($uid, $email, $codigo), dt($t + VERIFICACAO_S), dt($t)]);
    return $codigo;
}

/** O e-mail de confirmar o e-mail (v3.3). v3.5: o código sem recuo, numa linha só dele (como o da redefinição). */
function corpoEmailVerificacao(string $apelido, string $codigo): string
{
    return "Olá, {$apelido}!\n\n"
        . "Seu código para confirmar o e-mail da sua conta no LENDA é:\n\n"
        . "{$codigo}\n\n"
        . "Ele vale por 24 horas. Digite o código no jogo, em Minha conta.\n\n"
        . "Se não foi você que criou a conta, é só ignorar este e-mail.\n\n"
        . "— LENDA · https://oprojeto.online/lenda/\n";
}

/**
 * §E: os tetos do site para os e-mails de confirmação (a cota de envio da hospedagem: 200 a cada 10 min e 2.000 por dia, no
 * total), repartidos em baldes para que um punhado de IPs cadastrando contas descartáveis não deixe ninguém sem código.
 * [ação do limite, máximo em 10 min, máximo no dia (0 = sem)]:
 *   · cadastro (o e-mail que sai sozinho no cadastro): 120 e 1.200 no site, 15 a cada 10 min por IP (HMAC diário, nunca o
 *     IP) e 20 a cada 10 min por domínio do e-mail (fora os grandes provedores: o domínio de uma vítima não recebe uma
 *     enxurrada em nome do site);
 *   · pedido (o "Reenviar código" de uma conta nova): 40 e 400, mais 10 a cada 10 min por IP;
 *   · jogador (o "Reenviar código" de quem já jogou: EMAIL_VERIF_JOGADOR partidas com a conta): outros 40 e 400, que as
 *     contas recém-criadas não gastam (quando ele enche, ainda tenta o de pedido).
 * O painel avisa no "Precisa de atenção" quando um balde passa de 80% (alertaCotaEmails).
 */
const EMAIL_VERIF_BALDES = ['cadastro' => ['verif-cad', 120, 1200], 'pedido' => ['verif-ped', 40, 400], 'jogador' => ['verif-jog', 40, 400]];
const EMAIL_VERIF_IP_CADASTRO = 15;
const EMAIL_VERIF_IP_PEDIDO = 10;
const EMAIL_VERIF_DOMINIO = 20;
const EMAIL_VERIF_JOGADOR = 5;
/** Provedores grandes (muita gente de verdade): sem o teto por domínio. */
const EMAIL_DOMINIOS_GRANDES = ['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br', 'live.com', 'msn.com',
    'yahoo.com', 'yahoo.com.br', 'icloud.com', 'me.com', 'uol.com.br', 'bol.com.br', 'terra.com.br', 'ig.com.br', 'globo.com', 'globomail.com',
    'proton.me', 'protonmail.com'];

/** Cabe mais um em todos os baldes [[ação, quem, máx. 10 min, máx. no dia]]? Se couber, soma um em cada (senão, em nenhum). */
function cabeNosBaldes(array $baldes): bool
{
    foreach ($baldes as [$acao, $quem, $max10, $maxDia]) {
        if (lerLimite($acao, $quem) >= $max10 || ($maxDia > 0 && lerLimite('dia-' . $acao, $quem, 86400) >= $maxDia)) {
            return false;
        }
    }
    foreach ($baldes as [$acao, $quem, , $maxDia]) {
        somarLimite($acao, $quem);
        if ($maxDia > 0) {
            somarLimite('dia-' . $acao, $quem, 1, 86400);
        }
    }
    return true;
}

/** O balde do site [ação, 'todos', máx. 10 min, máx. no dia]. */
function baldeEmailVerif(string $tipo): array
{
    [$acao, $m10, $mDia] = EMAIL_VERIF_BALDES[$tipo];
    return [$acao, 'todos', $m10, $mDia];
}

/** O e-mail automático do cadastro cabe (site, IP, domínio)? Se couber, conta. */
function cabeEmailCadastro(string $email): bool
{
    $baldes = [baldeEmailVerif('cadastro'), ['verif-cad-ip', quemIp(), EMAIL_VERIF_IP_CADASTRO, 0]];
    $dominio = strtolower((string) substr((string) strrchr($email, '@'), 1));
    if ($dominio !== '' && !in_array($dominio, EMAIL_DOMINIOS_GRANDES, true)) {
        $baldes[] = ['verif-cad-dom', substr(hash('sha256', 'dominio|' . $dominio), 0, 32), EMAIL_VERIF_DOMINIO, 0];
    }
    return cabeNosBaldes($baldes);
}

/** O "Reenviar código" da conta $u cabe? Quem já jogou tem o balde próprio; o pedido também conta por IP. Se couber, conta. */
function cabeEmailPedido(array $u): bool
{
    if ((int) ($u['partidas_conta'] ?? 0) >= EMAIL_VERIF_JOGADOR && cabeNosBaldes([baldeEmailVerif('jogador')])) {
        return true;
    }
    return cabeNosBaldes([baldeEmailVerif('pedido'), ['verif-ped-ip', quemIp(), EMAIL_VERIF_IP_PEDIDO, 0]]);
}

/**
 * Os baldes do site perto do fim (>= 80% em 10 min ou no dia), para o "Precisa de atenção": [{tipo, n10, max10, nDia,
 * maxDia, cheio}].
 */
function cotaEmailsVerif(): array
{
    $out = [];
    foreach (array_keys(EMAIL_VERIF_BALDES) as $tipo) {
        [$acao, , $m10, $mDia] = baldeEmailVerif($tipo);
        $n10 = lerLimite($acao, 'todos');
        $nDia = lerLimite('dia-' . $acao, 'todos', 86400);
        if ($n10 * 5 >= $m10 * 4 || $nDia * 5 >= $mDia * 4) {
            $out[] = ['tipo' => $tipo, 'n10' => $n10, 'max10' => $m10, 'nDia' => $nDia, 'maxDia' => $mDia, 'cheio' => $n10 >= $m10 || $nDia >= $mDia];
        }
    }
    return $out;
}

/** Grava um código novo e manda o e-mail agora (admin). Devolve se o servidor de envio aceitou. */
function mandarCodigoVerificacao(array $u, string $tipo = 'verificacao'): bool
{
    $codigo = gravarCodigoVerificacao((int) $u['id'], (string) $u['email']);
    return enviarEmail((string) $u['email'], 'LENDA: confirme o seu e-mail', corpoEmailVerificacao((string) $u['apelido'], $codigo), $tipo);
}

/**
 * Confere o código e marca o e-mail como confirmado (true; já confirmado também é true). Código errado gasta uma das 5
 * tentativas dele; vencido, gasto ou de outro e-mail: false.
 */
function confirmarEmail(int $uid, string $codigo): bool
{
    return transacao(static function () use ($uid, $codigo): bool {
        $u = umaLinha('SELECT id, email, email_verificado_em FROM usuarios WHERE id = ? FOR UPDATE', [$uid]);
        if ($u === null) {
            return false;
        }
        if ($u['email_verificado_em'] !== null) {
            return true;
        }
        $r = umaLinha('SELECT codigo_hash, expira_em, tentativas FROM verificacoes_email WHERE usuario_id = ? FOR UPDATE', [$uid]);
        if ($r === null || (paraTempo($r['expira_em']) ?? 0) < time() || (int) $r['tentativas'] >= VERIFICACAO_TENTATIVAS) {
            return false;
        }
        if (!hash_equals((string) $r['codigo_hash'], hashVerificacao($uid, (string) $u['email'], $codigo))) {
            sql('UPDATE verificacoes_email SET tentativas = tentativas + 1 WHERE usuario_id = ?', [$uid]);
            return false;
        }
        sql('UPDATE usuarios SET email_verificado_em = ? WHERE id = ?', [dt(time()), $uid]);
        sql('DELETE FROM verificacoes_email WHERE usuario_id = ?', [$uid]);
        return true;
    });
}

/** Status em vigor ('ativo' | 'suspenso'): suspensão com data vencida conta como ativo. */
function statusConta(array $u): string
{
    return contaSuspensa($u) ? 'suspenso' : 'ativo';
}

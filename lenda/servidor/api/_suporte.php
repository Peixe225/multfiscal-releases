<?php
/**
 * LENDA · Fale conosco (mensagens_suporte, CONTRATO-v33 §A): o que o suporte.php grava e o que o admin.php lê e responde
 * (?r=suporte, suporte_status, suporte_responder, suporte_lote). O e-mail fica só na mensagem de quem não estava logado
 * (a de quem tem conta usa o e-mail da conta, na hora de responder). Nunca o IP: o limite usa o HMAC diário (quemIp).
 * Excluir a conta apaga as mensagens dela (excluirUsuario). Nunca é servido (o .htaccess nega _*.php).
 */
declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

const SUPORTE_TIPOS = ['duvida', 'ideia', 'problema', 'recomendacao', 'outro'];
const SUPORTE_STATUS = ['nova', 'lida', 'respondida', 'arquivada'];
const SUPORTE_MIN = 10;
const SUPORTE_MAX = 2000;
const SUPORTE_RESPOSTA_MAX = 4000;
const SUPORTE_TIPO_NOME = ['duvida' => 'Dúvida', 'ideia' => 'Ideia', 'problema' => 'Problema', 'recomendacao' => 'Recomendação', 'outro' => 'Outro'];

/** O e-mail de contato do site (o remetente da config). */
function emailContato(): string
{
    return emailResposta();
}

/** Protocolo de 8 letras (as do convite, sem as que se confundem). */
function protocoloNovo(): string
{
    return codigoConviteNovo();
}

/** Grava a mensagem (protocolo único) e devolve o protocolo. */
function gravarMensagemSuporte(?int $uid, ?string $email, string $tipo, string $mensagem, ?string $pagina): string
{
    for ($i = 0; $i < 10; $i++) {
        $p = protocoloNovo();
        try {
            sql("INSERT INTO mensagens_suporte (protocolo, usuario_id, email, tipo, mensagem, pagina, criado_em, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'nova')",
                [$p, $uid, $email, $tipo, $mensagem, $pagina, dt(time())]);
            return $p;
        } catch (PDOException $e) {
            if (!eChaveDuplicada($e)) {
                throw $e;
            }
        }
    }
    throw new RuntimeException('não consegui sortear um protocolo');
}

/** Para quem vai a resposta: o e-mail da conta (o de agora) ou o que a pessoa deixou. */
function destinoSuporte(array $l): ?string
{
    $e = $l['usuario_id'] !== null ? ($l['u_email'] ?? null) : ($l['email'] ?? null);
    return is_string($e) && filter_var($e, FILTER_VALIDATE_EMAIL) ? $e : null;
}

const SQL_SUPORTE = 'SELECT m.*, u.apelido, u.email AS u_email FROM mensagens_suporte m LEFT JOIN usuarios u ON u.id = m.usuario_id';

function itemSuporteAdmin(array $l, array $nomes): array
{
    $quem = $l['quem'] !== null ? (string) $l['quem'] : null;
    return [
        'id' => (int) $l['id'],
        'protocolo' => (string) $l['protocolo'],
        'tipo' => (string) $l['tipo'],
        'mensagem' => (string) $l['mensagem'],
        'pagina' => $l['pagina'],
        'criadoEm' => iso($l['criado_em']),
        'status' => (string) $l['status'],
        'resposta' => $l['resposta'],
        'respondidaEm' => iso($l['respondida_em']),
        'atualizadaEm' => iso($l['atualizada_em']),
        'quem' => $quem !== null ? ['codigo' => $quem, 'nome' => $nomes[$quem] ?? null] : null,
        'usuario' => $l['usuario_id'] !== null && $l['apelido'] !== null ? ['id' => (int) $l['usuario_id'], 'apelido' => (string) $l['apelido']] : null,
        'email' => destinoSuporte($l),
        'comConta' => $l['usuario_id'] !== null,
    ];
}

/** GET ?r=suporte&status=&tipo=&q=&pagina= (paginado, as mais novas primeiro) com as contagens por status. */
function rotaGetSuporte(int $pagina): never
{
    $status = qs('status', 12);
    $tipo = qs('tipo', 14);
    $q = qs('q', 100);
    $onde = [];
    $params = [];
    if ($status !== '') {
        if (!in_array($status, SUPORTE_STATUS, true)) {
            erro(400, 'filtro', 'Status: nova, lida, respondida ou arquivada.');
        }
        $onde[] = 'm.status = ?';
        $params[] = $status;
    }
    if ($tipo !== '') {
        if (!in_array($tipo, SUPORTE_TIPOS, true)) {
            erro(400, 'filtro', 'Tipo: duvida, ideia, problema, recomendacao ou outro.');
        }
        $onde[] = 'm.tipo = ?';
        $params[] = $tipo;
    }
    if ($q !== '') {
        $o = '(m.mensagem LIKE ? OR u.apelido LIKE ?';
        array_push($params, like($q), like($q));
        if (preg_match('/^[A-Za-z0-9]{8}$/', $q)) {
            $o .= ' OR m.protocolo = ?';
            $params[] = strtoupper($q);
        }
        if (str_contains($q, '@')) {
            $o .= ' OR m.email = ? OR u.email = ?';
            array_push($params, strtolower($q), strtolower($q));
        }
        if (ctype_digit(ltrim($q, '#')) && strlen(ltrim($q, '#')) <= 10) {
            $o .= ' OR m.id = ? OR m.usuario_id = ?';
            array_push($params, (int) ltrim($q, '#'), (int) ltrim($q, '#'));
        }
        $onde[] = $o . ')';
    }
    $w = $onde ? ' WHERE ' . implode(' AND ', $onde) : '';
    $de = ' FROM mensagens_suporte m LEFT JOIN usuarios u ON u.id = m.usuario_id';
    $total = (int) umValor("SELECT COUNT(*)$de$w", $params);
    $linhas = sql(SQL_SUPORTE . "$w ORDER BY m.criado_em DESC, m.id DESC LIMIT " . POR_PAGINA . ' OFFSET ' . (($pagina - 1) * POR_PAGINA), $params)->fetchAll();
    $nomes = function_exists('nomesQuem') ? nomesQuem(array_values(array_unique(array_filter(array_column($linhas, 'quem'), 'is_string')))) : [];
    $cont = array_fill_keys(SUPORTE_STATUS, 0);
    foreach (sql('SELECT status, COUNT(*) AS n FROM mensagens_suporte GROUP BY status') as $l) {
        $cont[(string) $l['status']] = (int) $l['n'];
    }
    $porTipo = array_fill_keys(SUPORTE_TIPOS, 0);
    foreach (sql("SELECT tipo, COUNT(*) AS n FROM mensagens_suporte WHERE status = 'nova' GROUP BY tipo") as $l) {
        $porTipo[(string) $l['tipo']] = (int) $l['n'];
    }
    responder(200, paginado($total, $pagina, array_map(static fn(array $l): array => itemSuporteAdmin($l, $nomes), $linhas))
        + ['contagens' => $cont, 'novasPorTipo' => $porTipo, 'contato' => emailContato()]);
}

function mensagemOu404(int $id, bool $travar = false): array
{
    $l = umaLinha(SQL_SUPORTE . ' WHERE m.id = ?' . ($travar ? ' FOR UPDATE' : ''), [$id]);
    if ($l === null) {
        erro(404, 'nao_encontrada', 'Mensagem não encontrada.');
    }
    return $l;
}

function lerStatusSuporte(mixed $v): string
{
    if (!is_string($v) || !in_array($v, SUPORTE_STATUS, true)) {
        erro(400, 'status', 'Status: nova, lida, respondida ou arquivada.');
    }
    return $v;
}

/** Texto do e-mail com a resposta da equipe (e a mensagem original embaixo). */
function corpoRespostaSuporte(array $l, string $resposta): string
{
    $nome = $l['apelido'] !== null ? (string) $l['apelido'] : null;
    $orig = mb_substr((string) $l['mensagem'], 0, 1500, 'UTF-8');
    $citado = implode("\n", array_map(static fn(string $x): string => '> ' . $x, explode("\n", $orig)));
    return 'Olá' . ($nome !== null ? ', ' . $nome : '') . "!\n\n"
        . $resposta . "\n\n"
        . "— Equipe LENDA · https://oprojeto.online/lenda/\n\n"
        . 'Sua mensagem (protocolo ' . $l['protocolo'] . ', ' . gmdate('d/m/Y', (paraTempo($l['criado_em']) ?? time()) - LENDA_FUSO_H * 3600) . "):\n"
        . $citado . "\n\n"
        . 'Para falar de novo com a gente, use o Fale conosco no jogo ou escreva para ' . emailContato() . ".\n";
}

/** As ações POST do suporte (suporte_status, suporte_responder, suporte_lote). Responde e termina. */
function acaoSuporte(string $acao, array $j): never
{
    $quem = admQuem();
    if ($acao === 'suporte_status') {
        $id = lerIdNumero($j['id'] ?? null, 'Mensagem');
        $st = lerStatusSuporte($j['status'] ?? null);
        $l = mensagemOu404($id);
        sql('UPDATE mensagens_suporte SET status = ?, quem = ?, atualizada_em = ? WHERE id = ?', [$st, $quem, dt(time()), $id]);
        registrarAdmin('suporte_status', 'suporte:' . $id, ['de' => (string) $l['status'], 'para' => $st,
            'usuario' => $l['usuario_id'] !== null ? (int) $l['usuario_id'] : null]);
        responder(200, ['ok' => true, 'status' => $st]);
    }
    if ($acao === 'suporte_lote') {
        $ids = lerIdsLote($j['ids'] ?? null);
        $st = lerStatusSuporte($j['status'] ?? null);
        $feitos = [];
        $pulados = [];
        foreach ($ids as $id) {
            $n = sql('UPDATE mensagens_suporte SET status = ?, quem = ?, atualizada_em = ? WHERE id = ? AND status <> ?', [$st, $quem, dt(time()), $id, $st])->rowCount();
            if ($n === 1) {
                $feitos[] = $id;
            } else {
                $pulados[] = ['id' => $id, 'motivo' => umValor('SELECT 1 FROM mensagens_suporte WHERE id = ?', [$id]) === null ? 'nao_encontrada' : 'ja_estava'];
            }
        }
        registrarAdmin('suporte_lote', 'suporte', ['status' => $st, 'feitos' => count($feitos), 'pulados' => count($pulados)]);
        responder(200, ['ok' => true, 'feitos' => $feitos, 'pulados' => $pulados]);
    }
    // suporte_responder
    $id = lerIdNumero($j['id'] ?? null, 'Mensagem');
    $resp = textoLongo($j['resposta'] ?? null);
    if ($resp === null || mb_strlen($resp, 'UTF-8') < 2 || mb_strlen($resp, 'UTF-8') > SUPORTE_RESPOSTA_MAX) {
        erro(400, 'resposta', 'Escreva a resposta (até ' . number_format(SUPORTE_RESPOSTA_MAX, 0, ',', '.') . ' caracteres).');
    }
    $l = mensagemOu404($id);
    $para = destinoSuporte($l);
    if ($para === null) {
        erro(409, 'sem_email', 'Essa mensagem não tem um e-mail para responder.');
    }
    limitar('suporte-resp', 'm' . $id, 5); // clique duplo não manda duas vezes sem querer
    $enviado = enviarEmail($para, 'LENDA: resposta à sua mensagem (protocolo ' . $l['protocolo'] . ')', corpoRespostaSuporte($l, $resp), 'suporte');
    $t = dt(time());
    if ($enviado) {
        sql("UPDATE mensagens_suporte SET resposta = ?, respondida_em = ?, status = 'respondida', quem = ?, atualizada_em = ? WHERE id = ?",
            [$resp, $t, $quem, $t, $id]);
    } else {
        // não saiu: a resposta fica guardada (para tentar de novo), a mensagem continua como estava
        sql('UPDATE mensagens_suporte SET resposta = ?, quem = ?, atualizada_em = ? WHERE id = ?', [$resp, $quem, $t, $id]);
    }
    // no registro, nada do texto (pode ter dado pessoal): só o tamanho e se saiu
    registrarAdmin('suporte_responder', 'suporte:' . $id, ['enviado' => $enviado, 'tamanho' => mb_strlen($resp, 'UTF-8'),
        'usuario' => $l['usuario_id'] !== null ? (int) $l['usuario_id'] : null]);
    responder(200, ['ok' => true, 'enviado' => $enviado, 'status' => $enviado ? 'respondida' : (string) $l['status'], 'para' => mascararEmail($para)]);
}

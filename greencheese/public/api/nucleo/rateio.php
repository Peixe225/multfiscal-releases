<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Rateio: a compra junto. As regras que o servidor garante (API.md):
// - 1 vaga = 1 unidade; ocupam vaga confirmado + entregue + reservado no prazo;
// - reservado vence em reserva_horas e vira expirado sozinho na leitura (a vaga volta);
// - o contador público é confirmadas/vagas e só sobe por gc_confirmar_participacao (painel agora, Pix depois);
// - lotou (confirmadas >= vagas) com o rateio aberto → fechado sozinho;
// - 1 participação ativa por WhatsApp em cada rateio.
// Toda escrita que mexe em vaga roda dentro de gc_transacao (BEGIN IMMEDIATE): nunca sai vaga a mais.

const GC_STATUS_RATEIO = ['rascunho', 'aberto', 'fechado', 'pedido', 'caminho', 'chegou', 'encerrado', 'cancelado'];

/** Para onde cada status pode ir no painel (cancelado vale de qualquer um). */
const GC_TRANSICOES = [
    'rascunho' => ['aberto', 'cancelado'],
    'aberto' => ['fechado', 'cancelado'],
    'fechado' => ['aberto', 'pedido', 'cancelado'],
    'pedido' => ['caminho', 'cancelado'],
    'caminho' => ['chegou', 'cancelado'],
    'chegou' => ['encerrado', 'cancelado'],
    'encerrado' => ['cancelado'],
    'cancelado' => [],
];

/** Coluna com a data de cada passo. */
const GC_COLUNA_DO_PASSO = [
    'aberto' => 'aberto_em',
    'fechado' => 'fechado_em',
    'pedido' => 'pedido_em',
    'caminho' => 'caminho_em',
    'chegou' => 'chegou_em',
    'encerrado' => 'encerrado_em',
    'cancelado' => 'cancelado_em',
];

/** Encerrado continua no site por 15 dias. */
const GC_ENCERRADO_NO_SITE = 15 * 86400;

const GC_ALFABETO_CODIGO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Reservas vencidas viram expirado (todas, ou só as de um rateio). Lê antes de travar: sem vencida, não escreve. */
function gc_vencer_reservas(?string $rateioId = null): void
{
    $agora = gc_agora();
    $onde = "p.status = 'reservado' AND p.expira_em <= ?" . ($rateioId === null ? '' : ' AND p.rateio_id = ?');
    $p = $rateioId === null ? [$agora] : [$agora, $rateioId];
    if (gc_valor("SELECT 1 FROM participacoes p WHERE $onde LIMIT 1", $p) === null) {
        return;
    }
    gc_transacao(static function () use ($onde, $p, $agora): void {
        $vencidas = gc_todos("SELECT p.id, p.codigo, p.rateio_id, p.quantidade, r.titulo FROM participacoes p JOIN rateios r ON r.id = p.rateio_id WHERE $onde", $p);
        foreach ($vencidas as $v) {
            gc_sql("UPDATE participacoes SET status = 'expirado', expirado_em = expira_em, atualizado_em = ? WHERE id = ? AND status = 'reservado'", [$agora, $v['id']]);
            gc_evento('sistema', 'participacao-expirada', 'participacao:' . $v['codigo'], ['rateio' => $v['rateio_id'], 'titulo' => $v['titulo'], 'quantidade' => (int) $v['quantidade']]);
        }
        foreach (array_unique(array_column($vencidas, 'rateio_id')) as $rid) {
            gc_tocar_rateio((string) $rid);
        }
    });
}

/** @return array<string, mixed>|null */
function gc_rateio_linha(string $id): ?array
{
    return gc_um('SELECT * FROM rateios WHERE id = ?', [$id]);
}

function gc_tocar_rateio(string $id): void
{
    gc_sql('UPDATE rateios SET atualizado_em = ? WHERE id = ?', [gc_agora(), $id]);
}

/**
 * Contagens por rateio (vagas e centavos). Sem $id, de todos.
 * @return array<string, array<string, int>>
 */
function gc_contagens(?string $id = null): array
{
    $sql = "SELECT rateio_id,
              SUM(CASE WHEN status IN ('confirmado','entregue') THEN quantidade ELSE 0 END) AS confirmadas,
              SUM(CASE WHEN status = 'reservado' AND expira_em > :agora THEN quantidade ELSE 0 END) AS reservadas,
              SUM(CASE WHEN status = 'entregue' THEN quantidade ELSE 0 END) AS entregues,
              SUM(CASE WHEN status IN ('confirmado','entregue') THEN quantidade * preco_unit ELSE 0 END) AS arrecadado,
              SUM(CASE WHEN status = 'reservado' AND expira_em > :agora THEN quantidade * preco_unit ELSE 0 END) AS a_receber,
              SUM(CASE WHEN status IN ('confirmado','entregue') THEN 1 ELSE 0 END) AS pessoas_confirmadas,
              SUM(CASE WHEN status = 'reservado' AND expira_em > :agora THEN 1 ELSE 0 END) AS pessoas_reservadas,
              SUM(CASE WHEN status = 'expirado' OR (status = 'reservado' AND expira_em <= :agora) THEN 1 ELSE 0 END) AS expiradas,
              SUM(CASE WHEN status = 'cancelado' THEN 1 ELSE 0 END) AS canceladas,
              COUNT(*) AS participacoes
            FROM participacoes" . ($id === null ? '' : ' WHERE rateio_id = :id') . ' GROUP BY rateio_id';
    $p = ['agora' => gc_agora()];
    if ($id !== null) {
        $p['id'] = $id;
    }
    $out = [];
    foreach (gc_todos($sql, $p) as $l) {
        $rid = (string) $l['rateio_id'];
        unset($l['rateio_id']);
        $out[$rid] = array_map('intval', $l);
    }
    return $out;
}

/** @return array<string, int> */
function gc_contagem_vazia(): array
{
    return [
        'confirmadas' => 0, 'reservadas' => 0, 'entregues' => 0, 'arrecadado' => 0, 'a_receber' => 0,
        'pessoas_confirmadas' => 0, 'pessoas_reservadas' => 0, 'expiradas' => 0, 'canceladas' => 0, 'participacoes' => 0,
    ];
}

/** @return array<string, int> */
function gc_contagem(string $id): array
{
    return gc_contagens($id)[$id] ?? gc_contagem_vazia();
}

/** Vagas ocupadas agora (confirmado + entregue + reservado no prazo), sem contar a participação $exceto. */
function gc_ocupadas(string $rateioId, ?int $exceto = null): int
{
    return (int) gc_valor(
        "SELECT COALESCE(SUM(quantidade), 0) FROM participacoes
          WHERE rateio_id = ? AND id <> ? AND (status IN ('confirmado','entregue') OR (status = 'reservado' AND expira_em > ?))",
        [$rateioId, $exceto ?? 0, gc_agora()],
    );
}

/** Código da participação ativa desse WhatsApp no rateio (ou null). */
function gc_whatsapp_ativo(string $rateioId, string $whatsapp, ?int $exceto = null): ?string
{
    $c = gc_valor(
        "SELECT codigo FROM participacoes
          WHERE rateio_id = ? AND whatsapp = ? AND id <> ?
            AND (status IN ('confirmado','entregue') OR (status = 'reservado' AND expira_em > ?))
          LIMIT 1",
        [$rateioId, $whatsapp, $exceto ?? 0, gc_agora()],
    );
    return $c === null ? null : (string) $c;
}

/** O rateio aceita entrada agora? (aberto, no prazo e com vaga) */
function gc_aceita_entradas(array $r, int $disponiveis): bool
{
    return $r['status'] === 'aberto' && ($r['fecha_em'] === null || (int) $r['fecha_em'] > gc_agora()) && $disponiveis > 0;
}

function gc_no_site(array $r): bool
{
    if ($r['status'] === 'rascunho' || $r['status'] === 'cancelado') {
        return false;
    }
    return !($r['status'] === 'encerrado' && (int) $r['encerrado_em'] < gc_agora() - GC_ENCERRADO_NO_SITE);
}

function gc_int_ou_nulo(mixed $v): ?int
{
    return $v === null ? null : (int) $v;
}

/**
 * O Rateio do contrato público (API.md).
 * @param array<string, mixed> $r
 * @param array<string, int> $c
 * @return array<string, mixed>
 */
function gc_rateio_publico(array $r, array $c): array
{
    $vagas = (int) $r['vagas'];
    $disp = max(0, $vagas - $c['confirmadas'] - $c['reservadas']);
    return [
        'id' => (string) $r['id'],
        'titulo' => (string) $r['titulo'],
        'descricao' => (string) $r['descricao'],
        'produtoId' => $r['produto_id'] === null ? null : (string) $r['produto_id'],
        'imagem' => $r['imagem'] === null ? null : (string) $r['imagem'],
        'precoRateio' => gc_reais((int) $r['preco_rateio']),
        'precoDepois' => $r['preco_depois'] === null ? null : gc_reais((int) $r['preco_depois']),
        'vagas' => $vagas,
        'confirmadas' => $c['confirmadas'],
        'reservadas' => $c['reservadas'],
        'disponiveis' => $disp,
        'limitePorPessoa' => (int) $r['limite_por_pessoa'],
        'ufs' => array_values(array_filter(explode(',', (string) $r['ufs']))),
        'status' => (string) $r['status'],
        'aceitaEntradas' => gc_aceita_entradas($r, $disp),
        'previsaoMin' => (int) $r['previsao_min'],
        'previsaoMax' => (int) $r['previsao_max'],
        'fechaEm' => gc_iso(gc_int_ou_nulo($r['fecha_em'])),
        'fechadoEm' => gc_iso(gc_int_ou_nulo($r['fechado_em'])),
        'pedidoEm' => gc_iso(gc_int_ou_nulo($r['pedido_em'])),
        'chegouEm' => gc_iso(gc_int_ou_nulo($r['chegou_em'])),
        'reservaHoras' => (int) $r['reserva_horas'],
        'demo' => (bool) $r['demo'],
        'atualizadoEm' => (string) gc_iso((int) $r['atualizado_em']),
    ];
}

/**
 * O rateio do painel: o público + datas de todos os passos, totais em dinheiro e o que dá pra fazer com ele.
 * @param array<string, mixed> $r
 * @param array<string, int> $c
 * @return array<string, mixed>
 */
function gc_rateio_admin(array $r, array $c): array
{
    $status = (string) $r['status'];
    return gc_rateio_publico($r, $c) + [
        'criadoEm' => gc_iso((int) $r['criado_em']),
        'abertoEm' => gc_iso(gc_int_ou_nulo($r['aberto_em'])),
        'caminhoEm' => gc_iso(gc_int_ou_nulo($r['caminho_em'])),
        'encerradoEm' => gc_iso(gc_int_ou_nulo($r['encerrado_em'])),
        'canceladoEm' => gc_iso(gc_int_ou_nulo($r['cancelado_em'])),
        'totais' => [
            'pessoasConfirmadas' => $c['pessoas_confirmadas'],
            'pessoasReservadas' => $c['pessoas_reservadas'],
            'entregues' => $c['entregues'],
            'expiradas' => $c['expiradas'],
            'canceladas' => $c['canceladas'],
            'participacoes' => $c['participacoes'],
            'arrecadado' => gc_reais($c['arrecadado']),
            'aReceber' => gc_reais($c['a_receber']),
        ],
        'proximos' => GC_TRANSICOES[$status] ?? [],
        'podeApagar' => $status === 'rascunho' || (bool) $r['demo'] || $c['participacoes'] === 0,
        'noSite' => gc_no_site($r),
    ];
}

/**
 * Os dados da pessoa foram apagados (LGPD, admin-participante-apagar)? O WhatsApp vazio só existe aí: o site e o painel
 * sempre gravam um. Vaga com os dados apagados não volta (nem confirmar, nem reservar de novo, nem editar).
 */
function gc_dados_apagados(array $p): bool
{
    return (string) $p['whatsapp'] === '';
}

function gc_erro_dados_apagados(): ErroApi
{
    return new ErroApi('dados-apagados', 'Os dados dessa pessoa foram apagados: essa vaga não volta.', 409);
}

/** Status de verdade agora (reservado vencido é expirado, mesmo antes do UPDATE). */
function gc_status_participacao(array $p): string
{
    if ($p['status'] === 'reservado' && (int) $p['expira_em'] <= gc_agora()) {
        return 'expirado';
    }
    return (string) $p['status'];
}

/**
 * A Participacao do contrato público (com o token que o aparelho mandou ou acabou de ganhar).
 * @param array<string, mixed> $p
 * @param array<string, mixed> $r
 * @return array<string, mixed>
 */
function gc_participacao_publica(array $p, array $r, string $token): array
{
    $status = gc_status_participacao($p);
    return [
        'codigo' => (string) $p['codigo'],
        'token' => $token,
        'rateio' => (string) $p['rateio_id'],
        'titulo' => (string) $r['titulo'],
        'quantidade' => (int) $p['quantidade'],
        'total' => gc_reais((int) $p['quantidade'] * (int) $p['preco_unit']),
        'status' => $status,
        'expiraEm' => $status === 'reservado' ? gc_iso((int) $p['expira_em']) : null,
        'criadoEm' => (string) gc_iso((int) $p['criado_em']),
        'confirmadoEm' => gc_iso(gc_int_ou_nulo($p['confirmado_em'])),
        'rateioStatus' => (string) $r['status'],
    ];
}

/**
 * Participante no painel: dados completos.
 * @param array<string, mixed> $p
 * @return array<string, mixed>
 */
function gc_participante_admin(array $p): array
{
    $status = gc_status_participacao($p);
    return [
        'id' => (int) $p['id'],
        'codigo' => (string) $p['codigo'],
        'rateio' => (string) $p['rateio_id'],
        'nome' => (string) $p['nome'],
        'whatsapp' => (string) $p['whatsapp'],
        'uf' => (string) $p['uf'],
        'cidade' => (string) $p['cidade'],
        'quantidade' => (int) $p['quantidade'],
        'precoUnit' => gc_reais((int) $p['preco_unit']),
        'total' => gc_reais((int) $p['quantidade'] * (int) $p['preco_unit']),
        'status' => $status,
        'origem' => (string) $p['origem'],
        'observacao' => (string) $p['observacao'],
        'criadoEm' => gc_iso((int) $p['criado_em']),
        'atualizadoEm' => gc_iso((int) $p['atualizado_em']),
        'expiraEm' => $status === 'reservado' ? gc_iso((int) $p['expira_em']) : null,
        'confirmadoEm' => gc_iso(gc_int_ou_nulo($p['confirmado_em'])),
        'confirmadoPor' => $p['confirmado_por'] === null ? null : (string) $p['confirmado_por'],
        'canceladoEm' => gc_iso(gc_int_ou_nulo($p['cancelado_em'])),
        'entregueEm' => gc_iso(gc_int_ou_nulo($p['entregue_em'])),
        'expiradoEm' => gc_iso(gc_int_ou_nulo($p['expirado_em'] ?? ($status === 'expirado' ? $p['expira_em'] : null))),
    ];
}

/** 'RAT-K8EA': 4 caracteres sem os que confundem (0/O, 1/I/L). */
function gc_novo_codigo(): string
{
    for ($i = 0; $i < 50; $i++) {
        $c = 'RAT-';
        for ($j = 0; $j < 4; $j++) {
            $c .= GC_ALFABETO_CODIGO[random_int(0, strlen(GC_ALFABETO_CODIGO) - 1)];
        }
        if (gc_valor('SELECT 1 FROM participacoes WHERE codigo = ?', [$c]) === null) {
            return $c;
        }
    }
    throw new RuntimeException('sem código livre');
}

/** Segredo do aparelho (32 hex) e o hash dele (é o que fica guardado). @return array{0: string, 1: string} */
function gc_novo_token(): array
{
    $t = bin2hex(random_bytes(16));
    return [$t, hash('sha256', $t)];
}

/**
 * Fecha sozinho o rateio aberto que lotou. Roda dentro da transação de quem confirmou.
 */
function gc_fechar_se_lotou(string $id): bool
{
    $r = gc_rateio_linha($id);
    if ($r === null || $r['status'] !== 'aberto') {
        return false;
    }
    if (gc_contagem($id)['confirmadas'] < (int) $r['vagas']) {
        return false;
    }
    $agora = gc_agora();
    gc_sql("UPDATE rateios SET status = 'fechado', fechado_em = ?, atualizado_em = ? WHERE id = ? AND status = 'aberto'", [$agora, $agora, $id]);
    gc_evento('sistema', 'rateio-fechou-sozinho', 'rateio:' . $id, ['titulo' => $r['titulo'], 'vagas' => (int) $r['vagas']]);
    return true;
}

/**
 * Cria a participação (site ou painel) depois de conferir WhatsApp repetido, limite por pessoa e vaga.
 * Roda dentro da transação de quem chamou. O rateio já foi conferido (status, estado).
 * $token: o token que o aparelho gerou (32 hex, ainda sem dono: quem chama conferiu); sem ele, o servidor gera um.
 * @param array<string, mixed> $r
 * @param array{nome: string, whatsapp: string, uf: string, cidade: string, quantidade: int, observacao?: string} $d
 * @return array{0: array<string, mixed>, 1: string} a linha nova e o token
 */
function gc_participacao_criar(array $r, array $d, string $origem, ?string $token = null): array
{
    $rid = (string) $r['id'];
    $ja = gc_whatsapp_ativo($rid, $d['whatsapp']);
    if ($ja !== null) {
        throw new ErroApi('ja-participa', "Esse WhatsApp já tá nesse rateio (código $ja).", 409, ['codigo' => $ja]);
    }
    $limite = (int) $r['limite_por_pessoa'];
    if ($d['quantidade'] > $limite) {
        throw new ErroApi('limite-por-pessoa', $limite === 1 ? 'Aqui é uma vaga por pessoa.' : "Aqui é no máximo $limite por pessoa.", 409, ['limite' => $limite]);
    }
    $disp = max(0, (int) $r['vagas'] - gc_ocupadas($rid));
    if ($d['quantidade'] > $disp) {
        $msg = $disp === 0 ? 'As vagas acabaram.' : ($disp === 1 ? 'Só sobrou 1 vaga.' : "Só sobraram $disp vagas.");
        throw new ErroApi('sem-vagas', $msg, 409, ['disponiveis' => $disp]);
    }
    [$token, $hash] = $token === null ? gc_novo_token() : [$token, hash('sha256', $token)];
    $agora = gc_agora();
    $id = gc_inserir(
        "INSERT INTO participacoes (rateio_id, codigo, token_hash, nome, whatsapp, uf, cidade, quantidade, preco_unit, status, origem, observacao, criado_em, atualizado_em, expira_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reservado', ?, ?, ?, ?, ?)",
        [
            $rid, gc_novo_codigo(), $hash, $d['nome'], $d['whatsapp'], $d['uf'], $d['cidade'], $d['quantidade'],
            (int) $r['preco_rateio'], $origem, $d['observacao'] ?? '', $agora, $agora, $agora + (int) $r['reserva_horas'] * 3600,
        ],
    );
    gc_tocar_rateio($rid);
    $p = gc_um('SELECT * FROM participacoes WHERE id = ?', [$id]);
    gc_evento($origem, $origem === 'site' ? 'participacao-reservada' : 'participacao-incluida', 'participacao:' . $p['codigo'], [
        'rateio' => $rid, 'titulo' => $r['titulo'], 'quantidade' => $d['quantidade'], 'uf' => $d['uf'],
    ]);
    // aviso no grupo da loja (avisos.php), depois da resposta; sem o módulo (publicação no meio), segue sem aviso
    if ($origem === 'site' && function_exists('gc_aviso_rateio_reserva')) {
        gc_aviso_rateio_reserva($p, $r);
    }
    return [$p, $token];
}

/**
 * A ÚNICA porta para o contador subir: confirma o pagamento de uma participação.
 * Usada pelo painel (o dono confirmou o Pix no WhatsApp) e, quando existir, pelo webhook do Pix.
 * Confirmar de novo não faz nada (o webhook pode avisar duas vezes). Reserva vencida ou cancelada só volta se
 * ainda couber e se o WhatsApp não tiver outra vaga ativa. Lotou → o rateio fecha sozinho.
 * @param string $por quem confirmou ('painel:<login>' ou 'pix')
 * @param array<string, mixed> $detalhe vai pra auditoria (ex.: id da transação do Pix)
 * @return array{participacao: array<string, mixed>, rateio: array<string, mixed>, jaConfirmada: bool, fechou: bool}
 */
function gc_confirmar_participacao(int $id, string $origem, string $por, ?int $usuarioId = null, array $detalhe = []): array
{
    return gc_transacao(static function () use ($id, $origem, $por, $usuarioId, $detalhe): array {
        $p = gc_um('SELECT * FROM participacoes WHERE id = ?', [$id]);
        if ($p === null) {
            throw new ErroApi('nao-encontrado', 'Participação não encontrada.', 404);
        }
        gc_vencer_reservas((string) $p['rateio_id']);
        $p = (array) gc_um('SELECT * FROM participacoes WHERE id = ?', [$id]);
        $r = (array) gc_rateio_linha((string) $p['rateio_id']);
        $de = (string) $p['status'];
        if ($de === 'confirmado') {
            return ['participacao' => $p, 'rateio' => $r, 'jaConfirmada' => true, 'fechou' => false];
        }
        if ($de === 'entregue') {
            throw new ErroApi('transicao-invalida', 'Essa vaga já foi entregue.', 409, ['de' => $de, 'para' => 'confirmado']);
        }
        if (gc_dados_apagados($p)) {
            throw gc_erro_dados_apagados();
        }
        if ($r['status'] === 'cancelado') {
            throw new ErroApi('rateio-cancelado', 'Esse rateio foi cancelado.', 409);
        }
        if ($de !== 'reservado') {
            $ja = gc_whatsapp_ativo((string) $r['id'], (string) $p['whatsapp'], $id);
            if ($ja !== null) {
                throw new ErroApi('ja-participa', "Esse WhatsApp já tem outra vaga nesse rateio ($ja).", 409, ['codigo' => $ja]);
            }
            $disp = max(0, (int) $r['vagas'] - gc_ocupadas((string) $r['id'], $id));
            if ((int) $p['quantidade'] > $disp) {
                throw new ErroApi('sem-vagas', $disp === 0 ? 'Não sobrou vaga pra confirmar essa.' : "Só sobrou $disp vaga(s).", 409, ['disponiveis' => $disp]);
            }
        }
        $agora = gc_agora();
        gc_sql(
            "UPDATE participacoes SET status = 'confirmado', confirmado_em = ?, confirmado_por = ?, expira_em = NULL,
               cancelado_em = NULL, expirado_em = NULL, atualizado_em = ? WHERE id = ?",
            [$agora, $por, $agora, $id],
        );
        gc_tocar_rateio((string) $r['id']);
        gc_evento($origem, 'participacao-confirmada', 'participacao:' . $p['codigo'], [
            'rateio' => $r['id'], 'titulo' => $r['titulo'], 'de' => $de, 'quantidade' => (int) $p['quantidade'],
        ] + $detalhe, $usuarioId);
        $fechou = gc_fechar_se_lotou((string) $r['id']);
        $agoraP = (array) gc_um('SELECT * FROM participacoes WHERE id = ?', [$id]);
        $agoraR = (array) gc_rateio_linha((string) $r['id']);
        if (function_exists('gc_aviso_rateio_pago')) {
            gc_aviso_rateio_pago($agoraP, $agoraR, $fechou, $por); // aviso no grupo da loja (avisos.php), depois da resposta
        }
        return [
            'participacao' => $agoraP,
            'rateio' => $agoraR,
            'jaConfirmada' => false,
            'fechou' => $fechou,
        ];
    });
}

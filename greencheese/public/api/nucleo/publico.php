<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Rotas públicas (o site): lista e um rateio, entrar no rateio, minhas vagas e o webhook do Pix (ainda 501).

/** GET rateios: sem rascunho nem cancelado; encerrado só até 15 dias; aberto primeiro. */
function gc_rota_rateios(): array
{
    gc_vencer_reservas();
    $limite = gc_agora() - GC_ENCERRADO_NO_SITE;
    $linhas = gc_todos(
        "SELECT * FROM rateios WHERE status NOT IN ('rascunho','cancelado') AND NOT (status = 'encerrado' AND encerrado_em < ?)",
        [$limite],
    );
    $contagens = gc_contagens();
    usort($linhas, 'gc_ordem_publica');
    return [
        'agora' => gc_iso(gc_agora()),
        'rateios' => array_map(static fn (array $r): array => gc_rateio_publico($r, $contagens[$r['id']] ?? gc_contagem_vazia()), $linhas),
    ];
}

/**
 * Aberto (o que fecha antes primeiro, depois o mais novo) → em andamento (o passo mais recente primeiro) →
 * encerrados (o mais recente primeiro).
 */
function gc_ordem_publica(array $a, array $b): int
{
    $grupo = static fn (array $r): int => $r['status'] === 'aberto' ? 0 : ($r['status'] === 'encerrado' ? 2 : 1);
    if ($grupo($a) !== $grupo($b)) {
        return $grupo($a) <=> $grupo($b);
    }
    if ($a['status'] === 'aberto') {
        $fa = $a['fecha_em'] === null ? PHP_INT_MAX : (int) $a['fecha_em'];
        $fb = $b['fecha_em'] === null ? PHP_INT_MAX : (int) $b['fecha_em'];
        if ($fa !== $fb) {
            return $fa <=> $fb;
        }
        return [(int) ($b['aberto_em'] ?? $b['criado_em']), (string) $a['id']] <=> [(int) ($a['aberto_em'] ?? $a['criado_em']), (string) $b['id']];
    }
    $passo = static fn (array $r): int => max((int) $r['fechado_em'], (int) $r['pedido_em'], (int) $r['caminho_em'], (int) $r['chegou_em'], (int) $r['encerrado_em'], (int) $r['criado_em']);
    return [$passo($b), (string) $a['id']] <=> [$passo($a), (string) $b['id']];
}

/** GET rateio&id= */
function gc_rota_rateio(): array
{
    $id = $_GET['id'] ?? null;
    $r = gc_id_valido($id) ? gc_rateio_linha((string) $id) : null;
    if ($r === null || !gc_no_site($r)) {
        throw new ErroApi('nao-encontrado', 'Esse rateio não existe mais.', 404);
    }
    gc_vencer_reservas((string) $id);
    return ['rateio' => gc_rateio_publico((array) gc_rateio_linha((string) $id), gc_contagem((string) $id))];
}

/** POST rateio-entrar: reserva a vaga na hora (código RAT-XXXX); o pagamento fecha no WhatsApp da loja. */
function gc_rota_rateio_entrar(): array
{
    gc_conferir_origem();
    gc_limite('rateio-entrar', gc_chave_limite('ip', gc_ip()), 12, 3600);
    $c = gc_corpo('rateio');

    // armadilha de robô: gente de verdade não vê nem preenche o campo "site"
    if (array_key_exists('site', $c) && $c['site'] !== null && $c['site'] !== '') {
        throw gc_invalido('rateio', 'Não deu pra entrar. Recarrega a página e tenta de novo.');
    }
    $id = $c['rateio'] ?? null;
    if (!gc_id_valido($id)) {
        throw gc_invalido('rateio', 'Esse rateio não veio certo. Recarrega a página e tenta de novo.');
    }
    $nome = gc_nome($c['nome'] ?? null);
    $whatsapp = gc_whatsapp($c['whatsapp'] ?? null);
    if ($whatsapp === null) {
        throw gc_invalido('whatsapp', 'Esse WhatsApp não fecha. Põe DDD + 9 dígitos.');
    }
    $uf = gc_uf($c['uf'] ?? null);
    if ($uf === null) {
        throw gc_invalido('uf', 'Escolhe teu estado.');
    }
    // cidade é opcional: o que não for texto fica de fora, e passou de 60 corta
    $cidade = gc_texto($c['cidade'] ?? '') ?? '';
    $cidade = rtrim(mb_substr($cidade, 0, 60, 'UTF-8'));
    $quantidade = gc_inteiro($c['quantidade'] ?? null, 1, 1000);
    if ($quantidade === null) {
        throw gc_invalido('quantidade', 'Quantidade tem que ser de 1 pra cima.');
    }

    return gc_transacao(static function () use ($id, $nome, $whatsapp, $uf, $cidade, $quantidade): array {
        gc_vencer_reservas((string) $id);
        $r = gc_rateio_linha((string) $id);
        if ($r === null || $r['status'] === 'rascunho' || $r['status'] === 'cancelado') {
            throw new ErroApi('nao-encontrado', 'Esse rateio não existe mais.', 404);
        }
        $noPrazo = $r['fecha_em'] === null || (int) $r['fecha_em'] > gc_agora();
        if ($r['status'] !== 'aberto' || !$noPrazo) {
            throw new ErroApi('rateio-fechado', $r['status'] === 'aberto' ? 'O prazo pra entrar nesse rateio acabou.' : 'Esse rateio já fechou.', 409, ['status' => $r['status']]);
        }
        $ufs = array_values(array_filter(explode(',', (string) $r['ufs'])));
        if (!in_array($uf, $ufs, true)) {
            throw new ErroApi('fora-do-estado', 'Esse rateio não vale pro teu estado.', 409, ['ufs' => $ufs]);
        }
        [$p, $token] = gc_participacao_criar($r, [
            'nome' => $nome, 'whatsapp' => $whatsapp, 'uf' => $uf, 'cidade' => $cidade, 'quantidade' => $quantidade,
        ], 'site');
        $r = (array) gc_rateio_linha((string) $id);
        return [
            '_status' => 201,
            'participacao' => gc_participacao_publica($p, $r, $token),
            'rateio' => gc_rateio_publico($r, gc_contagem((string) $id)),
        ];
    });
}

/** GET minhas-vagas&t=<token>[,<token>…]: até 20 tokens; desconhecido é ignorado. */
function gc_rota_minhas_vagas(): array
{
    gc_limite('minhas-vagas', gc_chave_limite('ip', gc_ip()), 120, 3600);
    $bruto = $_GET['t'] ?? '';
    $tokens = [];
    foreach (explode(',', is_string($bruto) ? substr($bruto, 0, 2000) : '') as $t) {
        $t = strtolower(trim($t));
        if (preg_match('/^[0-9a-f]{32}$/', $t)) {
            $tokens[hash('sha256', $t)] = $t;
        }
        if (count($tokens) >= 20) {
            break;
        }
    }
    if ($tokens === []) {
        return ['participacoes' => []];
    }
    gc_vencer_reservas();
    $marcas = implode(',', array_fill(0, count($tokens), '?'));
    $linhas = gc_todos(
        "SELECT p.*, r.titulo, r.status AS rateio_status FROM participacoes p JOIN rateios r ON r.id = p.rateio_id
          WHERE p.token_hash IN ($marcas) ORDER BY p.criado_em DESC, p.id DESC",
        array_keys($tokens),
    );
    $out = [];
    foreach ($linhas as $l) {
        $out[] = gc_participacao_publica($l, ['titulo' => $l['titulo'], 'status' => $l['rateio_status']], $tokens[$l['token_hash']]);
    }
    return ['participacoes' => $out];
}

/**
 * POST pix-webhook: 501 até a loja escolher o provedor do Pix (credenciais e assinatura vêm dele).
 * Quando existir: conferir a assinatura do provedor, achar a participação pelo txid/código e chamar
 * gc_confirmar_participacao($id, 'pix', 'pix', null, ['txid' => …]) — a mesma porta do painel. Sem Origin:
 * quem chama é o servidor do provedor.
 */
function gc_rota_pix_webhook(): array
{
    throw new ErroApi('pix-nao-configurado', 'O Pix direto no site ainda não tá ligado.', 501);
}

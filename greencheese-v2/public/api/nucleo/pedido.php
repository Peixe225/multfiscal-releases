<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Pedidos do site (pedido guiado e encomenda). O WhatsApp continua sendo o caminho do cliente: no toque de "Fechar
// pedido no WhatsApp" o site manda uma cópia estruturada (sendBeacon/fetch keepalive), sem segurar o link. Aqui ela é
// conferida e guardada como o site mostrou (itens, preços, combo, cupom, endereço, a mensagem exata) e vira aviso no
// grupo da loja (avisos.php). O código GC-XXXXX nasce no aparelho junto com um token secreto: o mesmo código com o
// mesmo token é a mesma coisa (o toque de novo, a rede que repete), nunca um pedido a mais.

const GC_STATUS_PEDIDO = ['novo', 'confirmado', 'saiu', 'entregue', 'cancelado'];

/** Pra onde cada status do pedido pode ir no painel (voltar um passo também vale: toque errado). */
const GC_PEDIDO_TRANSICOES = [
    'novo' => ['confirmado', 'cancelado'],
    'confirmado' => ['saiu', 'cancelado', 'novo'],
    'saiu' => ['entregue', 'cancelado', 'confirmado'],
    'entregue' => ['saiu'],
    'cancelado' => ['novo'],
];

const GC_PEDIDO_ROTULO = ['novo' => 'novo', 'confirmado' => 'confirmado', 'saiu' => 'saiu pra entrega', 'entregue' => 'entregue', 'cancelado' => 'cancelado'];

/** Coluna com a data de cada passo. */
const GC_PEDIDO_COLUNA = ['confirmado' => 'confirmado_em', 'saiu' => 'saiu_em', 'entregue' => 'entregue_em', 'cancelado' => 'cancelado_em'];

const GC_PAGAMENTOS = ['pix', 'dinheiro', 'cartao'];
const GC_NOME_PAGAMENTO = ['pix' => 'Pix', 'dinheiro' => 'Dinheiro', 'cartao' => 'Cartão na entrega'];

/** Pedidos novos por hora, por IP (o mesmo pedido de novo não conta). */
const GC_PEDIDOS_POR_HORA = 20;

/**
 * Até quanto tempo depois do de antes o pedido mudado entra no lugar dele (o site usa a mesma janela). Passou disso, os
 * dois ficam e o aviso do grupo pede pra conferir.
 */
const GC_PEDIDO_JANELA_TROCA = 7200;

/** 'GC-7KD2X' (5 caracteres do alfabeto sem ambíguos dos códigos), ou null. */
function gc_codigo_pedido(mixed $v): ?string
{
    $c = is_string($v) ? strtoupper(trim($v)) : '';
    return preg_match('/^GC-[' . GC_ALFABETO_CODIGO . ']{5}$/', $c) === 1 ? $c : null;
}

/**
 * De onde veio o pedido: 'sacola' (o "Fechar pedido no WhatsApp" da sacola: um toque, sem nome nem endereço) ou
 * 'guiado' (o chat do pedido guiado, e toda encomenda). Sem o campo (o site de antes, a cópia velha na fila do
 * aparelho) ou com outro valor: 'guiado', que é o que confere mais.
 * @param array<string, mixed> $c
 */
function gc_origem_pedido(array $c, mixed $tipo): string
{
    return ($c['origem'] ?? null) === 'sacola' && $tipo === 'pedido' ? 'sacola' : 'guiado';
}

/** A coluna da origem do pedido (migração 209) já existe? */
function gc_pedidos_com_origem(): bool
{
    static $tem = null;
    if ($tem === null) {
        $tem = false;
        foreach (gc_todos('PRAGMA table_info(pedidos)') as $c) {
            $tem = $tem || $c['name'] === 'origem';
        }
    }
    return $tem;
}

/** As colunas da taxa que o site mostrou (migração 210) já existem? $coluna: taxa_site, taxa_site_texto ou taxa_site_em. */
function gc_pedidos_com_taxa(string $coluna = 'taxa_site'): bool
{
    static $nomes = null;
    if ($nomes === null) {
        $nomes = array_column(gc_todos('PRAGMA table_info(pedidos)'), 'name');
    }
    return in_array($coluna, $nomes, true);
}

/** O nome que só informa (o pedido da sacola): de 2 a 60 letras, ou '' (o painel mostra "Sem nome"). */
function gc_nome_informativo(mixed $v): string
{
    $n = is_string($v) ? gc_texto($v) : null;
    return $n !== null && gc_tamanho($n) >= 2 && gc_tamanho($n) <= 60 ? $n : '';
}

/** Texto curto opcional: limpo, cortado no máximo ('' quando não veio). Não-texto vira ''. */
function gc_texto_curto(mixed $v, int $max): string
{
    $t = gc_texto($v) ?? '';
    return rtrim(mb_substr($t, 0, $max, 'UTF-8'));
}

/**
 * A mensagem do WhatsApp do jeito que saiu do aparelho (é ela que a loja recebe): só confere o UTF-8 e tira caractere
 * de controle; espaços e quebras ficam como estão. null = não é texto.
 */
function gc_mensagem_exata(mixed $v): ?string
{
    if (!is_string($v) || !mb_check_encoding($v, 'UTF-8')) {
        return null;
    }
    $v = str_replace(["\r\n", "\r"], "\n", $v);
    $v = (string) preg_replace('/[\x{0000}-\x{0009}\x{000B}-\x{001F}\x{007F}-\x{009F}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2064}\x{FEFF}]/u', '', $v);
    return trim($v);
}

/** Reais do site (número, como no catalogo.json) em centavos; null fica null; o resto lança no campo. */
function gc_centavos_ou_nulo(mixed $v, string $campo, string $msg): ?int
{
    if ($v === null) {
        return null;
    }
    return gc_centavos($v) ?? throw gc_invalido($campo, $msg);
}

/**
 * Itens do pedido como o site mostrou: nome (com tamanho e variação, como na mensagem), quantidade, preço unitário,
 * total da linha (com o combo) e o combo aplicado. Preço null = "a consultar" (nunca inventado).
 * @return list<array{produtoId: ?string, nome: string, variacao: ?string, qtd: int, precoUnit: ?int, total: ?int, combo: ?string}>
 */
function gc_ler_itens(mixed $v): array
{
    $msg = 'Os itens do pedido não vieram certos. Recarrega a página e monta de novo.';
    if (!is_array($v) || !array_is_list($v) || count($v) < 1 || count($v) > 60) {
        throw gc_invalido('itens', $msg);
    }
    $out = [];
    foreach ($v as $x) {
        if (!is_array($x)) {
            throw gc_invalido('itens', $msg);
        }
        $nome = gc_texto($x['nome'] ?? null);
        if ($nome === null || gc_tamanho($nome) < 1 || gc_tamanho($nome) > 160) {
            throw gc_invalido('itens', $msg);
        }
        $produto = $x['produtoId'] ?? null;
        $variacao = gc_texto_curto($x['variacao'] ?? '', 80);
        $qtd = gc_inteiro($x['qtd'] ?? null, 1, 999) ?? throw gc_invalido('itens', $msg);
        $unit = gc_centavos_ou_nulo($x['precoUnit'] ?? null, 'itens', $msg);
        $total = gc_centavos_ou_nulo($x['total'] ?? null, 'itens', $msg);
        if (($unit === null) !== ($total === null)) {
            throw gc_invalido('itens', $msg);
        }
        $combo = gc_texto_curto($x['combo'] ?? '', 80);
        $out[] = [
            'produtoId' => gc_id_valido($produto) ? (string) $produto : null,
            'nome' => $nome,
            'variacao' => $variacao === '' ? null : $variacao,
            'qtd' => $qtd,
            'precoUnit' => $unit,
            'total' => $total,
            'combo' => $combo === '' ? null : $combo,
        ];
    }
    return $out;
}

/**
 * Confere o corpo do POST pedido e devolve as colunas. A ordem: tipo → estado → nome → itens/encomenda → somas →
 * entrega → pagamento → mensagem (que tem de trazer a linha do código). Tabaco e vape: 422 proibido.
 * @param array<string, mixed> $c
 * @return array<string, mixed>
 */
function gc_ler_pedido(array $c, string $codigo): array
{
    $tipo = $c['tipo'] ?? null;
    if ($tipo !== 'pedido' && $tipo !== 'encomenda') {
        throw gc_invalido('tipo', 'O pedido não veio certo. Recarrega a página e tenta de novo.');
    }
    $uf = gc_uf($c['uf'] ?? null) ?? throw gc_invalido('uf', 'O estado do pedido não veio certo.');
    $origem = gc_origem_pedido($c, $tipo);
    // o pedido da sacola não pergunta o nome (o cliente manda na conversa): vem só quando o aparelho já sabia (a conta),
    // e o que não fechar fica de fora, nunca derruba o pedido. O guiado pergunta: nome de 2 a 60 letras, como sempre
    $nome = $origem === 'sacola' ? gc_nome_informativo($c['nome'] ?? null) : gc_nome($c['nome'] ?? null);
    // o WhatsApp é opcional (o site só sabe quando a pessoa tem conta no aparelho): o que não fechar fica de fora
    $whatsapp = gc_whatsapp($c['whatsapp'] ?? null) ?? '';

    $col = [
        'tipo' => $tipo, 'origem' => $origem, 'uf' => $uf, 'cidade' => gc_texto_curto($c['cidade'] ?? '', 60), 'nome' => $nome, 'whatsapp' => $whatsapp,
        'itens' => '[]', 'subtotal' => null, 'subtotal_texto' => '', 'cupom' => null, 'endereco' => '', 'rua' => '', 'numero' => '',
        'bairro' => '', 'cep' => '', 'cidade_entrega' => '', 'uf_entrega' => '', 'pagamento' => null, 'troco' => null,
        'observacao' => gc_texto_curto($c['obs'] ?? '', 200), 'encomenda' => null,
    ];
    $proibir = [];

    if ($tipo === 'pedido') {
        $itens = gc_ler_itens($c['itens'] ?? null);
        $conhecidos = array_values(array_filter(array_column($itens, 'total'), static fn ($t): bool => $t !== null));
        $soma = $conhecidos === [] ? null : array_sum($conhecidos);
        $subtotal = gc_centavos_ou_nulo($c['subtotal'] ?? null, 'subtotal', 'O subtotal não veio certo.');
        if ($subtotal !== $soma) {
            throw gc_invalido('subtotal', 'O subtotal não bate com os itens. Recarrega a página e monta de novo.');
        }
        $col['itens'] = (string) json_encode($itens, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $col['subtotal'] = $subtotal;
        $col['subtotal_texto'] = gc_texto_curto($c['subtotalTexto'] ?? '', 80);
        $proibir = array_column($itens, 'nome');

        // cupom, pagamento e troco só informam (a loja confirma na conversa; a mensagem exata tem tudo): o que não vier
        // certo fica de fora, nunca derruba o pedido inteiro
        $cupom = $c['cupom'] ?? null;
        $cod = is_array($cupom) && is_string($cupom['codigo'] ?? null) ? strtoupper(trim($cupom['codigo'])) : '';
        if (preg_match('/^[A-Z0-9]{2,12}-[A-Z0-9]{3,10}$/', $cod) === 1) {
            $col['cupom'] = (string) json_encode([
                'codigo' => $cod, 'regra' => gc_texto_curto($cupom['regra'] ?? '', 200), 'origem' => gc_texto_curto($cupom['origem'] ?? '', 40),
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }

        $e = is_array($c['entrega'] ?? null) ? $c['entrega'] : [];
        $cep = is_string($e['cep'] ?? null) ? (string) preg_replace('/\D/', '', $e['cep']) : '';
        $col['endereco'] = gc_texto_curto($e['endereco'] ?? '', 240);
        $col['rua'] = gc_texto_curto($e['rua'] ?? '', 140);
        $col['numero'] = gc_texto_curto($e['numero'] ?? '', 60);
        $col['bairro'] = gc_texto_curto($e['bairro'] ?? '', 80);
        $col['cep'] = strlen($cep) === 8 ? $cep : '';
        $col['cidade_entrega'] = gc_texto_curto($e['cidade'] ?? '', 60);
        $col['uf_entrega'] = gc_uf($e['uf'] ?? null) ?? '';

        // a taxa de entrega que o site mostrou (a taxa por bairro, 22/10): só informa, como o troco. O que não vier certo
        // fica de fora; o aviso do grupo diz a taxa pela tabela do servidor, nunca por este número
        $tx = is_array($c['taxa'] ?? null) ? $c['taxa'] : [];
        $valor = gc_pedido_taxa_dita($tx['valor'] ?? null);
        $col['taxa_site'] = is_int($valor) ? $valor : null;
        $col['taxa_site_texto'] = gc_texto_curto($tx['texto'] ?? '', 80);
        // quando o site mostrou essa taxa (a hora da loja no toque, corrigida pelo servidor): a entrega grátis do dia é
        // a do dia do toque, não a da chegada (a cópia que atrasou, ou que a fila do aparelho mandou de novo depois da
        // meia-noite). Fora da janela da fila do aparelho (3 dias), ou sem o campo (o site de antes): a hora da chegada
        $col['taxa_site_em'] = gc_pedido_quando_do_toque($tx['em'] ?? null);

        $pagamento = in_array($c['pagamento'] ?? null, GC_PAGAMENTOS, true) ? $c['pagamento'] : null;
        $col['pagamento'] = $pagamento;
        // "50,555" ou 50.555 → R$ 50,56 (o mesmo que a mensagem mostrou); o que não der pra ler: sem troco
        $col['troco'] = $pagamento === 'dinheiro' && ($c['troco'] ?? null) !== null ? gc_centavos_informativo($c['troco']) : null;
    } else {
        $e = is_array($c['encomenda'] ?? null) ? $c['encomenda'] : [];
        $produto = gc_texto($e['produto'] ?? null);
        if ($produto === null || gc_tamanho($produto) < 2 || gc_tamanho($produto) > 120) {
            throw gc_invalido('encomenda', 'O produto da encomenda não veio certo.');
        }
        $qtd = gc_texto_curto($e['quantidade'] ?? '', 30);
        if ($qtd === '') {
            throw gc_invalido('encomenda', 'A quantidade da encomenda não veio certa.');
        }
        $ref = gc_texto_curto($e['referencia'] ?? '', 300);
        $col['encomenda'] = (string) json_encode(['produto' => $produto, 'quantidade' => $qtd, 'referencia' => $ref], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $proibir = [$produto, $ref];
    }

    $termo = gc_termo_proibido(...$proibir);
    if ($termo !== null) {
        throw new ErroApi('proibido', 'Derivado do tabaco e cigarro eletrônico não entram no site (Anvisa).', 422, ['campo' => $tipo === 'pedido' ? 'itens' : 'encomenda', 'termo' => $termo]);
    }

    $msg = gc_mensagem_exata($c['mensagem'] ?? null);
    $topo = $tipo === 'pedido' ? 'PEDIDO GREEN CHEESE' : 'ENCOMENDA GREEN CHEESE';
    if ($msg === null || gc_tamanho($msg) > 4000 || !str_starts_with($msg, $topo) || !in_array("Código: $codigo", explode("\n", $msg), true)) {
        throw gc_invalido('mensagem', 'A mensagem do pedido não veio certa. Recarrega a página e tenta de novo.');
    }
    $col['mensagem'] = $msg;
    return $col;
}

/**
 * A cópia veio com um campo estrutural torto (itens, subtotal, encomenda, nome…), mas a mensagem do WhatsApp veio
 * certa (com a linha do código): o pedido entra só com a mensagem, e a anotação diz o que veio errado. O cliente já
 * mandou essa mensagem pra loja; sem isso, o site e o servidor desencontrados (um arredondamento, um campo novo) fariam
 * o pedido sumir do painel e do grupo sem ninguém saber. null = nem a mensagem serve (aí vale o erro de antes).
 * @param array<string, mixed> $c
 * @return array<string, mixed>|null
 */
function gc_ler_pedido_resgate(array $c, string $codigo, ErroApi $erro): ?array
{
    $tipo = $c['tipo'] ?? null;
    if ($tipo !== 'pedido' && $tipo !== 'encomenda') {
        return null;
    }
    $msg = gc_mensagem_exata($c['mensagem'] ?? null);
    $topo = $tipo === 'pedido' ? 'PEDIDO GREEN CHEESE' : 'ENCOMENDA GREEN CHEESE';
    if ($msg === null || gc_tamanho($msg) > 4000 || !str_starts_with($msg, $topo) || !in_array("Código: $codigo", explode("\n", $msg), true)) {
        return null;
    }
    $linhas = explode("\n", $msg);
    $uf = gc_uf($c['uf'] ?? null);
    if ($uf === null && preg_match('/GREEN CHEESE\s+—\s+([A-Z]{2})\b/u', $linhas[0], $m) === 1) {
        $uf = gc_uf(strtolower($m[1]));
    }
    if ($uf === null) {
        return null;
    }
    // o tabaco não entra nem assim: as linhas dos itens (e do produto da encomenda) da própria mensagem
    $itensMsg = array_values(array_filter($linhas, static fn (string $l): bool => preg_match('/^(\d+x |Produto: |Link\/descrição: )/u', $l) === 1));
    $termo = gc_termo_proibido(...$itensMsg);
    if ($termo !== null) {
        throw new ErroApi('proibido', 'Derivado do tabaco e cigarro eletrônico não entram no site (Anvisa).', 422, ['campo' => $tipo === 'pedido' ? 'itens' : 'encomenda', 'termo' => $termo]);
    }
    $nome = gc_texto_curto($c['nome'] ?? '', 60);
    if (gc_tamanho($nome) < 2) {
        foreach ($linhas as $l) {
            if (str_starts_with($l, 'Nome: ')) {
                $nome = gc_texto_curto(substr($l, 6), 60);
            }
        }
    }
    $e = is_array($c['entrega'] ?? null) ? $c['entrega'] : [];
    $cep = is_string($e['cep'] ?? null) ? (string) preg_replace('/\D/', '', $e['cep']) : '';
    $pagamento = in_array($c['pagamento'] ?? null, GC_PAGAMENTOS, true) ? $c['pagamento'] : null;
    $campo = (string) ($erro->extra['campo'] ?? '');
    // o da sacola sem nome fica sem nome (o painel mostra "Sem nome", como no pedido da sacola que entrou inteiro)
    $origem = gc_origem_pedido($c, $tipo);
    return [
        'tipo' => $tipo, 'origem' => $origem, 'uf' => $uf, 'cidade' => gc_texto_curto($c['cidade'] ?? '', 60), 'nome' => gc_tamanho($nome) >= 2 ? $nome : ($origem === 'sacola' ? '' : 'Sem nome'),
        'whatsapp' => gc_whatsapp($c['whatsapp'] ?? null) ?? '', 'itens' => '[]', 'subtotal' => null, 'subtotal_texto' => '', 'cupom' => null,
        'endereco' => $tipo === 'pedido' ? gc_texto_curto($e['endereco'] ?? '', 240) : '', 'rua' => $tipo === 'pedido' ? gc_texto_curto($e['rua'] ?? '', 140) : '',
        'numero' => $tipo === 'pedido' ? gc_texto_curto($e['numero'] ?? '', 60) : '', 'bairro' => $tipo === 'pedido' ? gc_texto_curto($e['bairro'] ?? '', 80) : '',
        'cep' => $tipo === 'pedido' && strlen($cep) === 8 ? $cep : '', 'cidade_entrega' => $tipo === 'pedido' ? gc_texto_curto($e['cidade'] ?? '', 60) : '',
        'uf_entrega' => $tipo === 'pedido' ? (gc_uf($e['uf'] ?? null) ?? '') : '', 'pagamento' => $tipo === 'pedido' ? $pagamento : null,
        'troco' => $tipo === 'pedido' && $pagamento === 'dinheiro' && ($c['troco'] ?? null) !== null ? gc_centavos_informativo($c['troco']) : null,
        'observacao' => gc_texto_curto($c['obs'] ?? '', 200), 'encomenda' => null, 'mensagem' => $msg,
        'nota' => 'A cópia do site veio incompleta' . ($campo !== '' ? " (campo $campo)" : '') . ': o pedido entrou só com a mensagem do cliente. Confere na conversa.',
    ];
}

/**
 * O total da linha com o melhor combo, em centavos: a mesma conta do site (src/lib/preco.ts, calcularLinha), o menor
 * custo combinando os combos (qtd > 1 e total > 0) e as unidades avulsas.
 * @param list<mixed> $combos
 */
function gc_pedido_total_linha(int $unit, int $qtd, array $combos): int
{
    $validos = [];
    foreach ($combos as $c) {
        if (is_array($c) && (int) ($c['qtd'] ?? 0) > 1 && (int) ($c['total'] ?? 0) > 0) {
            $validos[] = [(int) $c['qtd'], (int) $c['total']];
        }
    }
    $custo = [0];
    for ($n = 1; $n <= $qtd; $n++) {
        $melhor = $custo[$n - 1] + $unit;
        foreach ($validos as [$q, $t]) {
            if ($q <= $n) {
                $melhor = min($melhor, $custo[$n - $q] + $t);
            }
        }
        $custo[$n] = $melhor;
    }
    return $custo[$qtd];
}

/**
 * Confere os valores da cópia com o catálogo de agora e com o pedido mínimo do estado. Só marca, nunca recusa: a
 * mensagem já foi do cliente pra loja no WhatsApp, e quem confirma o valor é a loja, na conversa (o preço que o dono
 * acabou de mudar no painel também aparece aqui: o cliente viu o de antes). Cada item com produto: o preço da unidade
 * (a da opção, pelo nome, ou a do produto) e o total da linha com o melhor combo (o combo só vale quando a opção não
 * tem preço próprio diferente, como no site). O mínimo: o subtotal sem o desconto do cupom (DECISOES, item 18), só com
 * todos os itens com preço. Catálogo que não dá pra ler (loja não instalada, publicação no meio): nada a marcar.
 * @param array<string, mixed> $col
 * @return list<string> o que não bateu, em frases curtas
 */
function gc_pedido_conferir_valores(array $col, array $corpo = []): array
{
    if (($col['tipo'] ?? '') !== 'pedido') {
        return [];
    }
    $difs = [];
    $todosComPreco = true;
    try {
        $itens = json_decode((string) $col['itens'], true);
        foreach (is_array($itens) ? $itens : [] as $i) {
            if (!is_array($i)) {
                continue;
            }
            $qtd = (int) ($i['qtd'] ?? 0);
            $nome = $qtd . 'x ' . (string) ($i['nome'] ?? '');
            $total = isset($i['total']) ? (int) $i['total'] : null;
            $todosComPreco = $todosComPreco && $total !== null;
            $id = $i['produtoId'] ?? null;
            $p = is_string($id) ? gc_um('SELECT preco, combos, variacoes FROM loja_produtos WHERE id = ? AND ativo = 1', [$id]) : null;
            if ($p === null) {
                // sem produto do catálogo: com preço, não tem com o que conferir (diz); a consultar, nada a conferir
                if ($total !== null) {
                    $difs[] = "$nome: não tá no catálogo agora";
                }
                continue;
            }
            $opcao = null;
            $variacoes = json_decode((string) $p['variacoes'], true);
            foreach (is_array($variacoes) ? $variacoes : [] as $v) {
                if (is_array($v) && ($i['variacao'] ?? null) !== null && (string) ($v['nome'] ?? '') === (string) $i['variacao']) {
                    $opcao = $v;
                }
            }
            $doProduto = $p['preco'] === null ? null : (int) $p['preco'];
            $unit = $opcao !== null && isset($opcao['preco']) ? (int) $opcao['preco'] : $doProduto;
            if ($unit === null || $total === null) {
                if (($unit === null) !== ($total === null)) {
                    $difs[] = $unit === null ? "$nome: " . gc_brl((int) $total) . ' no site, a consultar no catálogo' : "$nome: a consultar no site, " . gc_brl($unit) . ' a unidade no catálogo';
                }
                continue;
            }
            $proprio = $opcao !== null && isset($opcao['preco']) && (int) $opcao['preco'] !== $doProduto;
            $combos = $proprio ? [] : json_decode((string) $p['combos'], true);
            $esperado = gc_pedido_total_linha($unit, $qtd, is_array($combos) ? $combos : []);
            if ($total !== $esperado) {
                $difs[] = "$nome: " . gc_brl($total) . ' no site, ' . gc_brl($esperado) . ' no catálogo';
            }
        }
    } catch (Throwable) {
        return [];
    }
    try {
        $subtotal = $col['subtotal'] ?? null;
        if ($todosComPreco && $subtotal !== null) {
            $e = gc_um('SELECT pedido_minimo FROM loja_estados WHERE uf = ?', [(string) $col['uf']]);
            $min = $e === null ? null : gc_int_ou_nulo($e['pedido_minimo'] ?? null);
            if ($min !== null && (int) $subtotal < $min) {
                $difs[] = 'abaixo do pedido mínimo de ' . gc_brl($min) . ' pra entrega';
            }
        }
    } catch (Throwable) {
        // a coluna do mínimo (migração 105) ainda não existe: nada a conferir
    }
    // a taxa do bairro que o site mostrou contra a tabela do servidor (o estado cobra por bairro e a lista aparece no
    // site): a cópia forjada, ou a lista que o dono acabou de mudar, viram uma linha pra conferir na conversa. Conta o
    // valor do campo e o que o texto diz ("taxa R$ 1,00", "grátis"): a cópia que manda o valor vazio, negativo ou em
    // texto com outro número no texto também é marcada
    try {
        $t = gc_pedido_taxa_da_tabela($col, gc_pedido_quando_do_site($col));
        if ($t !== null && $t['ver'] === 'site') {
            $bairro = $t['bairro'];
            if (gc_pedido_site_gratis_hoje($col)) {
                if (!$t['diaGratis']) {
                    $difs[] = 'entrega grátis hoje no site, mas hoje não é dia de entrega grátis';
                }
            } else {
                $tx = is_array($corpo['taxa'] ?? null) ? $corpo['taxa'] : ['valor' => $col['taxa_site'] ?? null, 'texto' => $col['taxa_site_texto'] ?? ''];
                $ditas = gc_pedido_taxas_ditas($tx);
                $mostra = static fn (int|string $v): string => is_int($v) ? gc_brl($v) : 'valor torto';
                if ($ditas !== []) {
                    $tabela = $t['achado']['taxa'] ?? null;
                    if ($bairro === '') {
                        $difs[] = 'taxa de entrega: ' . $mostra($ditas[0]) . ' no site, sem o bairro';
                    } elseif ($t['varias'] !== []) {
                        $opcoes = array_map(static fn (array $b): ?int => $b['taxa'], $t['varias']);
                        foreach ($ditas as $d) {
                            if (!is_int($d) || !in_array($d, $opcoes, true)) {
                                $difs[] = "taxa do bairro $bairro: " . $mostra($d) . ' no site, e a tabela tem ' . gc_pedido_opcoes_texto($t['varias']);
                                break;
                            }
                        }
                    } elseif ($t['achado'] === null || $tabela === null) {
                        $difs[] = "taxa do bairro $bairro: " . $mostra($ditas[0]) . ' no site, a consultar na tabela';
                    } else {
                        foreach ($ditas as $d) {
                            if ($d !== (int) $tabela) {
                                $difs[] = "taxa do bairro $bairro: " . $mostra($d) . ' no site, ' . gc_brl((int) $tabela) . ' na tabela';
                                break;
                            }
                        }
                    }
                }
            }
        }
    } catch (Throwable) {
        // as colunas da taxa por bairro (107) ainda não existem: nada a conferir
    }
    return array_slice($difs, 0, 6);
}

/** O site disse "grátis hoje" na entrega do pedido? (o texto da taxa que ele mostrou, migração 210) */
function gc_pedido_site_gratis_hoje(array $p): bool
{
    return str_contains((string) ($p['taxa_site_texto'] ?? ''), 'grátis hoje');
}

/**
 * O valor do campo "valor" da taxa que o site mostrou, em centavos: null = sem valor (a consultar, a confirmar, grátis
 * hoje); 0 = sem taxa; 'torto' = algo que o site nunca manda (negativo, texto que não é número, outro tipo).
 */
function gc_pedido_taxa_dita(mixed $v): int|string|null
{
    if ($v === null) {
        return null;
    }
    if (is_string($v) && preg_match('/^\s*(R\$\s*)?0+([.,]0{1,2})?\s*$/', $v) === 1) {
        return 0;
    }
    if ($v === 0 || $v === 0.0) {
        return 0;
    }
    if (!is_int($v) && !is_float($v) && !is_string($v)) {
        return 'torto';
    }
    return gc_centavos_informativo($v) ?? 'torto';
}

/**
 * Os valores de taxa que a cópia diz que o site mostrou (centavos, sem repetir): o do campo "valor" e o que o texto diz
 * ("taxa R$ 12,00" → 1200, "grátis" → 0; o "grátis hoje" é do dia, conferido à parte). [] = o site não mostrou valor.
 * @param array<string, mixed> $tx
 * @return list<int|string>
 */
function gc_pedido_taxas_ditas(array $tx): array
{
    $out = [];
    $v = gc_pedido_taxa_dita($tx['valor'] ?? null);
    if ($v !== null) {
        $out[] = $v;
    }
    $texto = is_string($tx['texto'] ?? null) ? $tx['texto'] : '';
    if (!str_contains($texto, 'grátis hoje')) {
        if (preg_match('/R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/u', $texto, $m) === 1) {
            $out[] = gc_pedido_taxa_dita($m[1]) ?? 'torto';
        } elseif (preg_match('/\bgr[aá]tis\b/iu', $texto) === 1) {
            $out[] = 0;
        }
    }
    return array_values(array_unique($out, SORT_REGULAR));
}

/** As opções do bairro em várias cidades, pro aviso e pra anotação: "R$ 8,00 em Vila Velha e R$ 10,00 em Vitória". */
function gc_pedido_opcoes_texto(array $varias): string
{
    $partes = array_map(static fn (array $b): string => ($b['taxa'] === null ? 'a consultar' : gc_brl((int) $b['taxa'])) . ($b['cidade'] !== '' ? ' em ' . $b['cidade'] : ' nas outras cidades'), $varias);
    return count($partes) > 1 ? implode(', ', array_slice($partes, 0, -1)) . ' e ' . end($partes) : (string) ($partes[0] ?? '');
}

/**
 * A hora do toque que veio na cópia (unix, a hora da loja que o site tinha), quando cabe na janela da fila do aparelho:
 * de 3 dias (e 1 h de folga) antes até 10 min depois de agora. Fora disso, ou sem o campo: null (vale a hora da chegada).
 */
function gc_pedido_quando_do_toque(mixed $v): ?int
{
    if (!is_int($v) && !(is_float($v) && is_finite($v))) {
        return null;
    }
    $em = (int) $v;
    $agora = gc_agora();
    return $em >= $agora - 3 * 86400 - 3600 && $em <= $agora + 600 ? $em : null;
}

/** A hora em que o site mostrou a taxa (a do toque, quando veio) ou, sem ela, a da chegada do pedido. */
function gc_pedido_quando_do_site(array $p): int
{
    $em = $p['taxa_site_em'] ?? null;
    return $em !== null ? (int) $em : (int) ($p['criado_em'] ?? gc_agora());
}

/**
 * A taxa de entrega do pedido pela tabela do servidor, quando o estado cobra por bairro (migração 107): o bairro do
 * pedido (como veio), o modo (ver: 'site' ou 'consulta'), o bairro achado na lista (null = fora dela) e se o dia do
 * pedido, em Brasília, é dia de entrega grátis do estado (a de verdade; a de exemplo não conta). null = o estado cobra
 * uma taxa só, ou o banco ainda não tem a 107.
 * @param array<string, mixed> $p o pedido (as colunas: uf, cidade, bairro)
 * @return array{ver: string, bairro: string, achado: array{nome: string, cidade: string, taxa: int|null}|null, varias: list<array{nome: string, cidade: string, taxa: int|null}>, diaGratis: bool}|null
 */
function gc_pedido_taxa_da_tabela(array $p, int $quando): ?array
{
    if (!function_exists('gc_loja_tem_bairros') || !gc_loja_tem_bairros()) {
        return null;
    }
    $e = gc_um('SELECT * FROM loja_estados WHERE uf = ?', [(string) ($p['uf'] ?? '')]);
    if ($e === null || gc_loja_taxa_por($e) !== 'bairro') {
        return null;
    }
    $bairro = trim((string) ($p['bairro'] ?? ''));
    $g = gc_loja_entrega_gratis($e);
    $dia = (int) (new DateTimeImmutable('@' . $quando))->setTimezone(new DateTimeZone('America/Sao_Paulo'))->format('w');
    // a cidade do pedido (a escolhida no site) e, sem ela, a do CEP: a mesma que o site usou pra achar o bairro
    $cidade = trim((string) ($p['cidade'] ?? '')) ?: trim((string) ($p['cidade_entrega'] ?? ''));
    $achou = $bairro === '' ? ['achado' => null, 'varias' => []] : gc_loja_achar_bairro($e, $cidade, $bairro);
    return [
        'ver' => gc_loja_bairros_ver($e),
        'bairro' => $bairro,
        'achado' => $achou['achado'],
        'varias' => $achou['varias'],
        'diaGratis' => $g !== null && (int) $e['entrega_gratis_demo'] === 0 && in_array($dia, $g['dias'], true),
    ];
}

/** A anotação que o servidor deixa no pedido quando o valor não bateu (o dono vê no detalhe e pode apagar). */
function gc_pedido_nota_conferir(array $difs): string
{
    $t = 'Confere o valor na conversa: ' . implode('; ', $difs) . '.';
    return gc_tamanho($t) > 500 ? rtrim(mb_substr($t, 0, 499, 'UTF-8')) . '…' : $t;
}

/** Pedido do site que entrou só com a mensagem (gc_ler_pedido_resgate): sem itens nem produto. */
function gc_pedido_resgatado(array $p): bool
{
    return $p['tipo'] === 'pedido' ? (string) $p['itens'] === '[]' : $p['encomenda'] === null;
}

/** O que a busca do painel procura: código, nome, cidade e WhatsApp, sem acento e sem caixa. */
function gc_pedido_busca(string $codigo, string $nome, string $cidade, string $whatsapp): string
{
    return gc_sem_acento(implode(' ', array_filter([$codigo, $nome, $cidade, $whatsapp, $whatsapp === '' ? '' : substr($whatsapp, 2)])));
}

/** O que o site recebe de volta (nada pessoal: o aparelho já tem tudo). @param array<string, mixed> $p */
function gc_pedido_publico(array $p): array
{
    return ['codigo' => (string) $p['codigo'], 'tipo' => (string) $p['tipo'], 'status' => (string) $p['status'], 'criadoEm' => gc_iso((int) $p['criado_em'])];
}

/**
 * POST pedido: a cópia do pedido que foi pro WhatsApp. Quem manda é um beacon (ninguém espera a resposta): o que
 * importa é gravar uma vez só e avisar o grupo. A mesma entrada de novo (código + token) devolve 200 com
 * repetido: true, sem gravar, sem avisar e sem gastar o limite. Token de outro código: invalido. O mesmo código com
 * outro token (dois aparelhos que sortearam igual) vira outro pedido: o painel mostra os dois.
 * substitui { codigo, token }: o aparelho mudou o pedido depois de mandar; o de antes, se ainda novo e de até 2 h
 * atrás, sai da lista (fora disso os dois ficam, ligados, e o aviso pede pra conferir). O de antes que ainda não
 * chegou (o envio dele falhou) fica anotado no novo (código + hash do token): quando chegar, entra já trocado e
 * ligado, sem aviso. Campo informativo torto (troco, cupom, pagamento) fica de fora; campo estrutural torto com a
 * mensagem certa: o pedido entra só com a mensagem (gc_ler_pedido_resgate). Recusa de vez fica no log do servidor.
 */
function gc_rota_pedido(): array
{
    gc_conferir_origem();
    try {
        $c = gc_corpo('codigo');
    } catch (ErroApi $e) {
        // corpo quebrado conta no limite, como as outras erradas
        gc_limite('pedido', gc_chave_limite('ip', gc_ip()), GC_PEDIDOS_POR_HORA, 3600);
        throw $e;
    }
    $codigo = gc_codigo_pedido($c['codigo'] ?? null);
    $token = gc_token_do_aparelho($c['token'] ?? null);
    $armadilha = array_key_exists('site', $c) && $c['site'] !== null && $c['site'] !== '';
    if ($codigo !== null && $token !== null && !$armadilha) {
        $ja = gc_um('SELECT * FROM pedidos WHERE token_hash = ?', [hash('sha256', $token)]);
        if ($ja !== null && (string) $ja['codigo'] === $codigo) {
            return ['pedido' => gc_pedido_publico($ja), 'repetido' => true];
        }
    }
    $tentativa = gc_limite('pedido', gc_chave_limite('ip', gc_ip()), GC_PEDIDOS_POR_HORA, 3600);
    // armadilha de robô: o site manda o campo "site" sempre vazio
    if ($armadilha) {
        throw gc_invalido('site', 'Não deu pra mandar o pedido. Recarrega a página e tenta de novo.');
    }
    if ($codigo === null) {
        throw gc_invalido('codigo', 'O código do pedido não veio certo. Recarrega a página e tenta de novo.');
    }
    if ($token === null) {
        throw gc_invalido('token', 'O pedido não veio certo. Recarrega a página e tenta de novo.');
    }
    $conferir = [];
    try {
        $col = gc_ler_pedido($c, $codigo);
        // o valor que não bate com o catálogo (ou abaixo do mínimo do estado): só marca, o pedido entra igual
        $conferir = gc_pedido_conferir_valores($col, $c);
        if ($conferir !== []) {
            $col['nota'] = gc_pedido_nota_conferir($conferir);
        }
    } catch (ErroApi $e) {
        // campo estrutural torto com a mensagem certa: entra só com a mensagem (o cliente já mandou ela pra loja)
        $col = $e->codigo === 'invalido' ? gc_ler_pedido_resgate($c, $codigo, $e) : null;
        if ($col === null) {
            gc_log("[pedido] recusado $codigo: {$e->codigo}" . (isset($e->extra['campo']) ? ' (' . $e->extra['campo'] . ')' : '') . ' · ' . $e->getMessage());
            throw $e;
        }
        gc_log("[pedido] $codigo entrou só com a mensagem: " . ($e->extra['campo'] ?? '?') . ' · ' . $e->getMessage());
    }
    $sub = is_array($c['substitui'] ?? null) ? $c['substitui'] : null;
    $subCodigo = $sub === null ? null : gc_codigo_pedido($sub['codigo'] ?? null);
    $subToken = $sub === null ? null : gc_token_do_aparelho($sub['token'] ?? null);

    return gc_transacao(static function () use ($col, $codigo, $token, $subCodigo, $subToken, $tentativa, $conferir): array {
        $hash = hash('sha256', $token);
        // dois envios juntos passam pela conferência de cima; aqui é um de cada vez
        $ja = gc_um('SELECT * FROM pedidos WHERE token_hash = ?', [$hash]);
        if ($ja !== null) {
            if ((string) $ja['codigo'] !== $codigo) {
                throw gc_invalido('token', 'O pedido não veio certo. Recarrega a página e tenta de novo.');
            }
            gc_limite_apagar($tentativa); // repetir não gasta tentativa
            return ['pedido' => gc_pedido_publico($ja), 'repetido' => true];
        }
        $agora = gc_agora();
        // o pedido de antes do mesmo aparelho (só com o token dele): ainda novo, sai da lista no lugar deste
        $antigo = null;
        if ($subCodigo !== null && $subToken !== null && $subToken !== $token) {
            $antigo = gc_um('SELECT * FROM pedidos WHERE token_hash = ? AND codigo = ?', [hash('sha256', $subToken), $subCodigo]);
        }
        // e o contrário: este é o de antes de um pedido mudado que já chegou (o envio deste falhou e ele chegou atrasado,
        // da fila do aparelho). O cliente já trocou ele pelo novo: entra trocado, ligado ao novo, sem aviso no grupo
        $novo = gc_um("SELECT * FROM pedidos WHERE substitui_token_hash = ? AND substitui_codigo = ? AND substitui_id IS NULL ORDER BY id DESC LIMIT 1", [$hash, $codigo]);
        // o pedido da sacola que entra no lugar de um pedido do mesmo aparelho (o guiado completo, e depois mexeram na
        // sacola): herda do de antes o que a pessoa já tinha respondido (nome, WhatsApp, endereço, pagamento e troco),
        // quando é do mesmo estado. A mensagem do WhatsApp continua a da sacola; o painel e o aviso não perdem o dado
        if ($antigo !== null && ($col['origem'] ?? '') === 'sacola' && $col['tipo'] === 'pedido' && (string) $antigo['tipo'] === 'pedido'
            && (string) $antigo['uf'] === (string) $col['uf'] && !gc_pedido_dados_apagados($antigo)) {
            $herdou = false;
            foreach (['nome', 'whatsapp', 'endereco', 'rua', 'numero', 'bairro', 'cep', 'cidade_entrega', 'uf_entrega', 'pagamento', 'troco'] as $k) {
                $velho = $antigo[$k] ?? null;
                if ((($col[$k] ?? null) !== null && (string) $col[$k] !== '') || $velho === null || (string) $velho === '' || ($k === 'nome' && (string) $velho === 'Sem nome')) {
                    continue;
                }
                $col[$k] = $velho;
                $herdou = true;
            }
            if ($herdou) {
                $col['nota'] = trim((string) ($col['nota'] ?? '') . " Nome, endereço e pagamento vieram do {$antigo['codigo']}, do mesmo aparelho, antes de mexerem na sacola.");
            }
        }
        // quem estava logado na conta do site (clientes.php): o pedido entra nos "Meus pedidos" e, quando o aparelho não
        // mandou o WhatsApp, vale o da conta (conferido pelo código); o endereço fica guardado pra próxima vez. Só o
        // WhatsApp conferido (o da conta) liga o pedido à conta de quem tem o número (whatsapp_conferido)
        $cliente = function_exists('gc_cliente_logado') ? gc_cliente_logado() : null;
        if ($cliente !== null) {
            $col['cliente_id'] = (int) $cliente['id'];
            if ((string) $col['whatsapp'] === '') {
                $col['whatsapp'] = (string) $cliente['whatsapp'];
            }
            // o pedido da sacola que veio sem nome: o da conta de quem tá logado (nunca perguntado no site)
            if ((string) $col['nome'] === '' && gc_tamanho((string) ($cliente['nome'] ?? '')) >= 2) {
                $col['nome'] = gc_texto_curto($cliente['nome'], 60);
            }
            $col['whatsapp_conferido'] = (string) $col['whatsapp'] === (string) $cliente['whatsapp'] ? 1 : 0;
        }
        $nota = (string) ($col['nota'] ?? '');
        unset($col['nota']);
        // a coluna da origem (migração 209) ainda não existe: publicação no meio, o módulo novo antes da migração
        if (!gc_pedidos_com_origem()) {
            unset($col['origem']);
        }
        // e as da taxa que o site mostrou (210)
        if (!gc_pedidos_com_taxa()) {
            unset($col['taxa_site'], $col['taxa_site_texto']);
        }
        if (!gc_pedidos_com_taxa('taxa_site_em')) {
            unset($col['taxa_site_em']);
        }
        $col = ['codigo' => $codigo, 'token_hash' => $hash, 'status' => 'novo'] + $col + [
            'substitui_id' => $antigo === null ? null : (int) $antigo['id'],
            'substitui_codigo' => $subCodigo !== null && $subToken !== null && $subToken !== $token ? $subCodigo : '',
            'substitui_token_hash' => $subCodigo !== null && $subToken !== null && $subToken !== $token ? hash('sha256', $subToken) : '',
            'nota' => $nota,
            'criado_em' => $agora, 'atualizado_em' => $agora,
            'busca' => gc_pedido_busca($codigo, (string) $col['nome'], (string) $col['cidade'], (string) $col['whatsapp']),
        ];
        if ($novo !== null) {
            $col['status'] = 'cancelado';
            $col['cancelado_em'] = $agora;
            $col['substituido_por_id'] = (int) $novo['id'];
            $col['status_por'] = 'site';
        }
        $nomes = implode(', ', array_keys($col));
        $marcas = implode(', ', array_fill(0, count($col), '?'));
        $id = gc_inserir("INSERT INTO pedidos ($nomes) VALUES ($marcas)", array_values($col));
        if ($novo !== null) {
            gc_sql('UPDATE pedidos SET substitui_id = ? WHERE id = ?', [$id, $novo['id']]);
            gc_evento('site', 'pedido-substituido', 'pedido:' . $codigo, ['id' => $id, 'por' => (string) $novo['codigo'], 'atrasado' => true]);
            return ['_status' => 201, 'pedido' => gc_pedido_publico(gc_pedido_um($id))];
        }
        $trocou = false;
        $recente = $antigo !== null && $agora - (int) $antigo['criado_em'] <= GC_PEDIDO_JANELA_TROCA;
        if ($antigo !== null && $recente && $antigo['status'] === 'novo' && $antigo['substituido_por_id'] === null) {
            gc_sql(
                "UPDATE pedidos SET status = 'cancelado', cancelado_em = ?, substituido_por_id = ?, status_por = 'site', atualizado_em = ? WHERE id = ?",
                [$agora, $id, $agora, $antigo['id']],
            );
            gc_evento('site', 'pedido-substituido', 'pedido:' . $antigo['codigo'], ['id' => (int) $antigo['id'], 'por' => $codigo]);
            $trocou = true;
        }
        $p = gc_pedido_um($id);
        if ($cliente !== null) {
            gc_cliente_pedido_feito((int) $cliente['id'], $p);
        }
        gc_evento('site', $col['tipo'] === 'pedido' ? 'pedido-recebido' : 'encomenda-recebida', 'pedido:' . $codigo, [
            'id' => $id, 'uf' => $col['uf'], 'itens' => count(json_decode((string) $col['itens'], true) ?: []),
            'origem' => (string) ($col['origem'] ?? 'guiado'),
        ] + ((string) $col['nome'] !== '' ? ['nome' => $col['nome']] : []));
        gc_aviso_pedido($p, $antigo === null ? null : ['codigo' => (string) $antigo['codigo'], 'trocou' => $trocou, 'status' => (string) $antigo['status']], $conferir);
        return ['_status' => 201, 'pedido' => gc_pedido_publico($p)];
    });
}

// ─── painel ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** SELECT dos pedidos com o código dos que ele substitui ou que entraram no lugar dele. */
const GC_PEDIDOS_SELECT = 'SELECT p.*, a.codigo AS substitui_codigo, b.codigo AS substituido_por_codigo FROM pedidos p
    LEFT JOIN pedidos a ON a.id = p.substitui_id LEFT JOIN pedidos b ON b.id = p.substituido_por_id';

/** @return array<string, mixed> */
function gc_pedido_um(int $id): array
{
    return (array) gc_um(GC_PEDIDOS_SELECT . ' WHERE p.id = ?', [$id]);
}

/** @return list<array<string, mixed>> */
function gc_pedido_itens(array $p): array
{
    $itens = json_decode((string) $p['itens'], true);
    return is_array($itens) ? array_values(array_filter($itens, 'is_array')) : [];
}

function gc_pedido_dados_apagados(array $p): bool
{
    return $p['dados_apagados_em'] !== null;
}

/** "1x Jack Daniel's Old No. 7 1 L, 3x Seda OCB…" (encomenda: o produto e a quantidade). */
function gc_pedido_resumo(array $p): string
{
    if ($p['tipo'] === 'encomenda') {
        $e = json_decode((string) $p['encomenda'], true);
        $e = is_array($e) ? $e : [];
        return 'Encomenda: ' . ($e['produto'] ?? '') . (isset($e['quantidade']) && $e['quantidade'] !== '' ? ' (' . $e['quantidade'] . ')' : '');
    }
    $partes = array_map(static fn (array $i): string => $i['qtd'] . 'x ' . $i['nome'], gc_pedido_itens($p));
    $s = implode(', ', $partes);
    return gc_tamanho($s) > 140 ? rtrim(mb_substr($s, 0, 139, 'UTF-8')) . '…' : $s;
}

/** {id, codigo} do pedido ligado (ou null). */
function gc_pedido_ligado(mixed $id, mixed $codigo): ?array
{
    return $id === null ? null : ['id' => (int) $id, 'codigo' => (string) ($codigo ?? '')];
}

/** Linha da lista do painel. @param array<string, mixed> $p */
function gc_pedido_linha(array $p): array
{
    $itens = gc_pedido_itens($p);
    return [
        'id' => (int) $p['id'],
        'codigo' => (string) $p['codigo'],
        'tipo' => (string) $p['tipo'],
        // de onde veio: 'sacola' (um toque, sem nome nem endereço) ou 'guiado' (o chat; toda encomenda). Antes da
        // migração 209, todo pedido era do guiado
        'origem' => ($p['origem'] ?? 'guiado') === 'sacola' ? 'sacola' : 'guiado',
        'status' => (string) $p['status'],
        'uf' => (string) $p['uf'],
        'cidade' => (string) $p['cidade'],
        'nome' => (string) $p['nome'],
        'whatsapp' => (string) $p['whatsapp'],
        'resumo' => gc_pedido_resumo($p),
        'unidades' => array_sum(array_map(static fn (array $i): int => (int) ($i['qtd'] ?? 0), $itens)),
        'subtotal' => $p['subtotal'] === null ? null : gc_reais((int) $p['subtotal']),
        'subtotalTexto' => (string) $p['subtotal_texto'],
        'criadoEm' => gc_iso((int) $p['criado_em']),
        'atualizadoEm' => gc_iso((int) $p['atualizado_em']),
        'substitui' => gc_pedido_ligado($p['substitui_id'], $p['substitui_codigo'] ?? null),
        'substituidoPor' => gc_pedido_ligado($p['substituido_por_id'], $p['substituido_por_codigo'] ?? null),
        'dadosApagados' => gc_pedido_dados_apagados($p),
    ];
}

/** O pedido inteiro, pro detalhe do painel. @param array<string, mixed> $p */
function gc_pedido_admin(array $p): array
{
    $cupom = $p['cupom'] === null ? null : json_decode((string) $p['cupom'], true);
    $enc = $p['encomenda'] === null ? null : json_decode((string) $p['encomenda'], true);
    $status = (string) $p['status'];
    // o pedido que entrou no lugar dele é que vale: o trocado não muda mais; nem o que teve os dados apagados (LGPD)
    $proximos = $p['substituido_por_id'] !== null || gc_pedido_dados_apagados($p) ? [] : (GC_PEDIDO_TRANSICOES[$status] ?? []);
    return gc_pedido_linha($p) + [
        'itens' => array_map(static fn (array $i): array => [
            'produtoId' => $i['produtoId'] ?? null,
            'nome' => (string) ($i['nome'] ?? ''),
            'variacao' => $i['variacao'] ?? null,
            'qtd' => (int) ($i['qtd'] ?? 0),
            'precoUnit' => isset($i['precoUnit']) ? gc_reais((int) $i['precoUnit']) : null,
            'total' => isset($i['total']) ? gc_reais((int) $i['total']) : null,
            'combo' => $i['combo'] ?? null,
        ], gc_pedido_itens($p)),
        'cupom' => is_array($cupom) ? $cupom : null,
        'entrega' => [
            'endereco' => (string) $p['endereco'], 'rua' => (string) $p['rua'], 'numero' => (string) $p['numero'], 'bairro' => (string) $p['bairro'],
            'cep' => (string) $p['cep'], 'cidade' => (string) $p['cidade_entrega'], 'uf' => (string) $p['uf_entrega'],
        ],
        // a taxa de entrega que o site mostrou (210): o valor (null = sem valor) e o texto da mensagem; null = o pedido
        // de antes (ou a cópia sem a taxa)
        'taxaSite' => ($p['taxa_site_texto'] ?? '') === '' && ($p['taxa_site'] ?? null) === null
            ? null
            : ['valor' => ($p['taxa_site'] ?? null) === null ? null : gc_reais((int) $p['taxa_site']), 'texto' => (string) ($p['taxa_site_texto'] ?? '')],
        'pagamento' => $p['pagamento'] === null ? null : (string) $p['pagamento'],
        'troco' => $p['troco'] === null ? null : gc_reais((int) $p['troco']),
        'observacao' => (string) $p['observacao'],
        'encomenda' => is_array($enc) ? $enc : null,
        'mensagem' => (string) $p['mensagem'],
        'nota' => (string) $p['nota'],
        'confirmadoEm' => gc_iso(gc_int_ou_nulo($p['confirmado_em'])),
        'saiuEm' => gc_iso(gc_int_ou_nulo($p['saiu_em'])),
        'entregueEm' => gc_iso(gc_int_ou_nulo($p['entregue_em'])),
        'canceladoEm' => gc_iso(gc_int_ou_nulo($p['cancelado_em'])),
        'statusPor' => $p['status_por'] === null ? null : (string) $p['status_por'],
        'proximos' => $proximos,
    ];
}

/** @return array<string, mixed> */
function gc_pedido_ou_404(mixed $id): array
{
    $n = gc_inteiro($id, 1, PHP_INT_MAX >> 1);
    $p = $n === null ? null : gc_um(GC_PEDIDOS_SELECT . ' WHERE p.id = ?', [$n]);
    if ($p === null) {
        throw new ErroApi('nao-encontrado', 'Pedido não encontrado.', 404);
    }
    // gerente e atendente: só os pedidos dos estados deles (equipe.php)
    if (function_exists('gc_exigir_uf')) {
        gc_exigir_uf((string) $p['uf'], 'Esse pedido');
    }
    return $p;
}

/** Os que ainda pedem alguma coisa da loja (o filtro "Em aberto" do painel). */
const GC_PEDIDOS_ABERTOS = ['novo', 'confirmado', 'saiu'];

/**
 * GET admin-pedidos[&status=abertos|novo|confirmado|saiu|entregue|cancelado|todos][&uf=mg][&busca=][&antes=<id>]
 * [&limite=50]: o mais novo primeiro, com a contagem por status (no estado escolhido; abertos = novo + confirmado +
 * saiu) e os estados que já tiveram pedido.
 */
function gc_rota_admin_pedidos(): array
{
    gc_exigir_dono();
    gc_avisos_depois([]);
    $status = $_GET['status'] ?? 'todos';
    $status = is_string($status) && ($status === 'abertos' || in_array($status, GC_STATUS_PEDIDO, true)) ? $status : 'todos';
    $uf = gc_uf($_GET['uf'] ?? null);
    $busca = gc_texto_curto($_GET['busca'] ?? '', 40);
    $antes = gc_inteiro($_GET['antes'] ?? null, 1, PHP_INT_MAX >> 1);
    $limite = gc_inteiro($_GET['limite'] ?? null, 1, 100) ?? 50;

    $onde = [];
    $p = [];
    [$fUf, $pUf] = function_exists('gc_filtro_ufs') ? gc_filtro_ufs('p.uf') : ['', []];
    if ($fUf !== '') {
        $onde[] = $fUf;
        array_push($p, ...$pUf);
    }
    if ($uf !== null) {
        $onde[] = 'p.uf = ?';
        $p[] = $uf;
    }
    $contagem = array_fill_keys(['abertos', ...GC_STATUS_PEDIDO, 'todos'], 0);
    foreach (gc_todos('SELECT p.status, COUNT(*) AS n FROM pedidos p' . ($onde ? ' WHERE ' . implode(' AND ', $onde) : '') . ' GROUP BY p.status', $p) as $l) {
        $contagem[(string) $l['status']] = (int) $l['n'];
        $contagem['todos'] += (int) $l['n'];
        if (in_array($l['status'], GC_PEDIDOS_ABERTOS, true)) {
            $contagem['abertos'] += (int) $l['n'];
        }
    }
    if ($status === 'abertos') {
        $onde[] = "p.status IN ('novo','confirmado','saiu')";
    } elseif ($status !== 'todos') {
        $onde[] = 'p.status = ?';
        $p[] = $status;
    }
    if ($busca !== '') {
        // código (com ou sem o "GC-"), nome, cidade ou WhatsApp, sem acento e sem caixa
        $termo = str_replace(['%', '_', '\\'], '', gc_sem_acento($busca));
        if ($termo !== '') {
            $onde[] = 'p.busca LIKE ?';
            $p[] = '%' . $termo . '%';
        }
    }
    if ($antes !== null) {
        $onde[] = 'p.id < ?';
        $p[] = $antes;
    }
    $linhas = gc_todos(GC_PEDIDOS_SELECT . ($onde ? ' WHERE ' . implode(' AND ', $onde) : '') . ' ORDER BY p.id DESC LIMIT ' . ($limite + 1), $p);
    $mais = count($linhas) > $limite;
    $ufs = array_map(static fn (array $l): string => (string) $l['uf'], gc_todos('SELECT DISTINCT p.uf FROM pedidos p' . ($fUf === '' ? '' : " WHERE $fUf") . ' ORDER BY p.uf', $pUf));
    $res = [
        'agora' => gc_iso(gc_agora()),
        'pedidos' => array_map('gc_pedido_linha', array_slice($linhas, 0, $limite)),
        'contagem' => $contagem,
        'ufs' => $ufs,
        'mais' => $mais,
    ];
    // o painel pergunta de novo a cada 15 s com a tela aberta: sem mudança (o mesmo conteúdo pra quem pergunta), 304
    return $res + ['_etag' => gc_etag_de($res)];
}

/** GET admin-pedidos-resumo: o que o Resumo do painel mostra (pedidos novos e avisos que não chegaram). */
function gc_rota_admin_pedidos_resumo(): array
{
    gc_exigir_dono();
    gc_avisos_depois([]);
    [$fUf, $pUf] = function_exists('gc_filtro_ufs') ? gc_filtro_ufs('p.uf') : ['', []];
    $e = $fUf === '' ? '' : " AND $fUf";
    $novos = gc_todos(GC_PEDIDOS_SELECT . " WHERE p.status = 'novo'$e ORDER BY p.id DESC LIMIT 5", $pUf);
    $res = [
        'agora' => gc_iso(gc_agora()),
        'novos' => (int) gc_valor("SELECT COUNT(*) FROM pedidos p WHERE p.status = 'novo'$e", $pUf),
        'emAndamento' => (int) gc_valor("SELECT COUNT(*) FROM pedidos p WHERE p.status IN ('confirmado','saiu')$e", $pUf),
        // o pedido mais novo que essa pessoa vê (0 = nenhum): o painel sabe que chegou pedido sem baixar a lista
        'ultimoId' => (int) gc_valor('SELECT COALESCE(MAX(p.id), 0) FROM pedidos p' . ($fUf === '' ? '' : " WHERE $fUf"), $pUf),
        'ultimos' => array_map('gc_pedido_linha', $novos),
        // a situação dos avisos no WhatsApp é coisa de quem cuida deles (o dono); os outros recebem null
        'avisos' => !function_exists('gc_pode') || gc_pode('avisos') ? gc_avisos_situacao() : null,
    ];
    // a bolinha da barra e o Início perguntam de novo sozinhos: sem mudança, 304 sem corpo
    return $res + ['_etag' => gc_etag_de($res)];
}

/** GET admin-pedido&id=: o pedido inteiro, os outros com o mesmo código (dois aparelhos que sortearam igual) e os avisos dele. */
function gc_rota_admin_pedido(): array
{
    gc_exigir_dono();
    $p = gc_pedido_ou_404($_GET['id'] ?? null);
    [$fUf, $pUf] = function_exists('gc_filtro_ufs') ? gc_filtro_ufs('p.uf') : ['', []];
    $mesmos = gc_todos(GC_PEDIDOS_SELECT . ' WHERE p.codigo = ? AND p.id <> ?' . ($fUf === '' ? '' : " AND $fUf") . ' ORDER BY p.id DESC LIMIT 5', [$p['codigo'], $p['id'], ...$pUf]);
    $verAvisos = !function_exists('gc_pode') || gc_pode('avisos');
    return [
        'agora' => gc_iso(gc_agora()),
        'pedido' => gc_pedido_admin($p),
        'mesmoCodigo' => array_map('gc_pedido_linha', $mesmos),
        'avisos' => $verAvisos ? array_map('gc_aviso_publico', gc_todos('SELECT * FROM avisos_envios WHERE alvo = ? ORDER BY id DESC LIMIT 5', ['pedido:' . $p['id']])) : [],
    ];
}

/**
 * POST admin-pedido-status { id, status }: novo → confirmado → saiu → entregue (e voltar um passo), cancelado de
 * qualquer um que não foi entregue, cancelado → novo (reabrir). Pedir o status que já tem não é erro (jaEstava).
 * Pedido com os dados apagados (LGPD) não muda mais (409 dados-apagados).
 */
function gc_rota_admin_pedido_status(): array
{
    $s = gc_exigir_dono();
    $c = gc_corpo();
    return gc_transacao(static function () use ($c, $s): array {
        $p = gc_pedido_ou_404($c['id'] ?? null);
        $de = (string) $p['status'];
        $para = $c['status'] ?? null;
        if (!is_string($para) || !in_array($para, GC_STATUS_PEDIDO, true)) {
            throw gc_invalido('status', 'Status inválido.');
        }
        if ($para === $de) {
            // já está assim (outro aparelho, ou o toque de novo depois do "demorou"): nada muda
            return ['pedido' => gc_pedido_admin($p), 'jaEstava' => true];
        }
        if ($p['substituido_por_id'] !== null) {
            $por = (string) ($p['substituido_por_codigo'] ?? '');
            throw new ErroApi('substituido', "O cliente mandou esse pedido de novo, com mudança: vale o $por.", 409, ['por' => $por, 'porId' => (int) $p['substituido_por_id']]);
        }
        if (gc_pedido_dados_apagados($p)) {
            // reabrir um pedido sem nome, endereço nem mensagem só faria um "Dados apagados" voltar pros novos
            throw new ErroApi('dados-apagados', 'Os dados de quem pediu foram apagados (LGPD): esse pedido não volta mais.', 409);
        }
        $permitidos = GC_PEDIDO_TRANSICOES[$de] ?? [];
        if (!in_array($para, $permitidos, true)) {
            throw new ErroApi('transicao-invalida', 'De ' . GC_PEDIDO_ROTULO[$de] . ' não dá pra ir pra ' . GC_PEDIDO_ROTULO[$para] . '.', 409, ['de' => $de, 'para' => $para, 'permitidos' => $permitidos]);
        }
        $agora = gc_agora();
        $sets = ['status = ?', 'atualizado_em = ?', 'status_por = ?'];
        $v = [$para, $agora, 'painel:' . $s['login']];
        $ordem = ['novo', 'confirmado', 'saiu', 'entregue'];
        if ($para === 'cancelado') {
            $sets[] = 'cancelado_em = ?';
            $v[] = $agora;
        } elseif ($de === 'cancelado') {
            // reabrir: recomeça do novo, sem as datas de antes
            $sets[] = 'cancelado_em = NULL, confirmado_em = NULL, saiu_em = NULL, entregue_em = NULL';
        } else {
            $i = (int) array_search($para, $ordem, true);
            if ((int) array_search($de, $ordem, true) < $i) {
                $sets[] = GC_PEDIDO_COLUNA[$para] . ' = ?';
                $v[] = $agora;
            } else {
                // voltou um passo: as datas dos passos depois dele saem
                foreach (array_slice($ordem, $i + 1) as $depois) {
                    $sets[] = GC_PEDIDO_COLUNA[$depois] . ' = NULL';
                }
            }
        }
        $v[] = $p['id'];
        gc_sql('UPDATE pedidos SET ' . implode(', ', $sets) . ' WHERE id = ?', $v);
        gc_evento('painel', 'pedido-status', 'pedido:' . $p['codigo'], ['id' => (int) $p['id'], 'de' => $de, 'para' => $para]);
        return ['pedido' => gc_pedido_admin(gc_pedido_um((int) $p['id']))];
    });
}

/**
 * POST admin-pedido-salvar { id, whatsapp?, nota? }: o WhatsApp do cliente (quando o site não sabia: ele chega na
 * conversa do pedido; salvar o número, mesmo o que já estava, conta como conferido pela loja e liga o pedido à conta
 * desse número) e uma anotação da loja. Campo ausente fica como está.
 */
function gc_rota_admin_pedido_salvar(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    return gc_transacao(static function () use ($c): array {
        $p = gc_pedido_ou_404($c['id'] ?? null);
        if (gc_pedido_dados_apagados($p)) {
            throw new ErroApi('dados-apagados', 'Os dados desse pedido foram apagados.', 409);
        }
        $novo = [];
        if (array_key_exists('whatsapp', $c)) {
            if ($c['whatsapp'] === '' || $c['whatsapp'] === null) {
                $novo['whatsapp'] = '';
            } else {
                $novo['whatsapp'] = gc_whatsapp($c['whatsapp']) ?? throw gc_invalido('whatsapp', 'Esse WhatsApp não fecha. Põe DDD + 9 dígitos.');
            }
        }
        if (array_key_exists('nota', $c)) {
            $nota = gc_texto($c['nota'], true);
            if ($nota === null || gc_tamanho($nota) > 500) {
                throw gc_invalido('nota', 'Anotação até 500 letras.');
            }
            $novo['nota'] = $nota;
        }
        if (array_key_exists('whatsapp', $novo) && array_key_exists('whatsapp_conferido', $p)) {
            // o número que a loja salva (o da conversa do pedido, mesmo que seja o que já estava) é conferido: o pedido
            // aparece na conta de quem tem esse número
            $novo['whatsapp_conferido'] = $novo['whatsapp'] === '' ? 0 : 1;
        }
        $mudou = array_keys(array_filter($novo, static fn ($v, $k) => (string) $v !== (string) $p[$k], ARRAY_FILTER_USE_BOTH));
        if ($mudou !== []) {
            $novo['busca'] = gc_pedido_busca((string) $p['codigo'], (string) $p['nome'], (string) $p['cidade'], (string) ($novo['whatsapp'] ?? $p['whatsapp']));
            $sets = implode(', ', array_map(static fn (string $k): string => "$k = ?", array_keys($novo)));
            gc_sql("UPDATE pedidos SET $sets, atualizado_em = ? WHERE id = ?", [...array_values($novo), gc_agora(), $p['id']]);
            gc_evento('painel', 'pedido-editado', 'pedido:' . $p['codigo'], ['id' => (int) $p['id'], 'campos' => $mudou]);
        }
        return ['pedido' => gc_pedido_admin(gc_pedido_um((int) $p['id']))];
    });
}

/**
 * POST admin-pedido-apagar-dados { id }: pedido de exclusão (LGPD). Nome vira "Dados apagados"; WhatsApp, endereço,
 * observação, anotação e a mensagem (que tinha tudo isso) saem, e também o texto dos avisos dele e o nome na Atividade.
 * Itens, valores, status e datas ficam (as contas da loja não mudam). Só com o pedido entregue ou cancelado.
 */
function gc_rota_admin_pedido_apagar_dados(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    return gc_transacao(static function () use ($c): array {
        $p = gc_pedido_ou_404($c['id'] ?? null);
        if (!in_array($p['status'], ['entregue', 'cancelado'], true)) {
            throw new ErroApi('pedido-ativo', 'Esse pedido ainda tá em andamento. Entrega ou cancela antes de apagar os dados.', 409);
        }
        if (!gc_pedido_dados_apagados($p)) {
            $agora = gc_agora();
            $enc = $p['encomenda'] === null ? null : json_decode((string) $p['encomenda'], true);
            if (is_array($enc)) {
                $enc['referencia'] = '';
            }
            gc_sql(
                "UPDATE pedidos SET nome = 'Dados apagados', whatsapp = '', endereco = '', rua = '', numero = '', bairro = '', cep = '',
                   observacao = '', nota = '', mensagem = '', encomenda = ?, busca = ?, dados_apagados_em = ?, atualizado_em = ? WHERE id = ?",
                [is_array($enc) ? json_encode($enc, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : $p['encomenda'], gc_sem_acento((string) $p['codigo']), $agora, $agora, $p['id']],
            );
            // o aviso do grupo também tinha os dados (o texto e o pedido inteiro, que vai pro webhook)
            gc_avisos_apagar_dados('pedido:' . $p['id']);
            // e a ligação com a conta do cliente (sai dos "Meus pedidos")
            if (array_key_exists('cliente_id', $p)) {
                gc_sql('UPDATE pedidos SET cliente_id = NULL WHERE id = ?', [$p['id']]);
            }
            // e a Atividade, o nome de quem pediu
            foreach (gc_todos('SELECT id, detalhe FROM eventos WHERE alvo = ?', ['pedido:' . $p['codigo']]) as $ev) {
                $d = json_decode((string) $ev['detalhe'], true);
                if (is_array($d) && (int) ($d['id'] ?? 0) === (int) $p['id'] && array_key_exists('nome', $d)) {
                    unset($d['nome']);
                    gc_sql('UPDATE eventos SET detalhe = ? WHERE id = ?', [json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $ev['id']]);
                }
            }
            gc_evento('painel', 'pedido-dados-apagados', 'pedido:' . $p['codigo'], ['id' => (int) $p['id']]);
        }
        return ['pedido' => gc_pedido_admin(gc_pedido_um((int) $p['id']))];
    });
}

// ─── Atividade ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Frase da Atividade pros eventos dos pedidos, dos avisos e das falas do pedido guiado (gc_evento_texto chama quando a
 * ação não é das outras). null = não é daqui.
 * @param array<string, mixed> $d
 */
function gc_pedidos_evento_texto(string $acao, string $alvo, array $d): ?string
{
    $de = static fn (): string => isset($d['nome']) ? ' de ' . $d['nome'] : '';
    $uf = isset($d['uf']) ? ' (' . strtoupper((string) $d['uf']) . ')' : '';
    $fala = static function (string $chave): string {
        $padrao = (string) (gc_textos_info()['textos'][$chave]['padrao'] ?? $chave);
        return '"' . (gc_tamanho($padrao) > 48 ? rtrim(mb_substr($padrao, 0, 47, 'UTF-8')) . '…' : $padrao) . '"';
    };
    return match ($acao) {
        'pedido-recebido' => "Pedido $alvo" . $de() . (($d['origem'] ?? '') === 'sacola' ? ' pela sacola do site' : ' pelo site') . $uf,
        'encomenda-recebida' => "Encomenda $alvo" . $de() . " pelo site$uf",
        'pedido-substituido' => "Pedido $alvo trocado pelo " . ($d['por'] ?? 'novo') . ' (o cliente mudou e mandou de novo)',
        'pedido-status' => match ((string) ($d['para'] ?? '')) {
            'confirmado' => ($d['de'] ?? '') === 'novo' ? "Confirmou o pedido $alvo" : "Pedido $alvo voltou pra confirmado",
            'saiu' => ($d['de'] ?? '') === 'entregue' ? "Desfez a entrega do pedido $alvo" : "Pedido $alvo saiu pra entrega",
            'entregue' => "Entregou o pedido $alvo",
            'cancelado' => "Cancelou o pedido $alvo",
            'novo' => ($d['de'] ?? '') === 'cancelado' ? "Reabriu o pedido $alvo" : "Pedido $alvo voltou pra novo",
            default => "Pedido $alvo mudou de status",
        },
        'pedido-editado' => "Editou o pedido $alvo",
        'pedido-dados-apagados' => "Apagou os dados do pedido $alvo (LGPD)",
        'avisos-ajustados' => 'Ajustou os avisos no WhatsApp' . (isset($d['motor']) ? ' (' . (GC_AVISO_NOME_MOTOR[(string) $d['motor']] ?? (string) $d['motor']) . ')' : ''),
        'texto-pedido-trocado' => 'Trocou a fala ' . $fala((string) ($d['chave'] ?? '')) . ' do pedido guiado',
        'texto-pedido-padrao' => 'Voltou ao texto de sempre a fala ' . $fala((string) ($d['chave'] ?? '')) . ' do pedido guiado',
        default => null,
    };
}

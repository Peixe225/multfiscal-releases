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

/** 'GC-7KD2X' (5 caracteres do alfabeto sem ambíguos dos códigos), ou null. */
function gc_codigo_pedido(mixed $v): ?string
{
    $c = is_string($v) ? strtoupper(trim($v)) : '';
    return preg_match('/^GC-[' . GC_ALFABETO_CODIGO . ']{5}$/', $c) === 1 ? $c : null;
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
    $nome = gc_nome($c['nome'] ?? null);
    // o WhatsApp é opcional (o site só sabe quando a pessoa tem conta no aparelho): o que não fechar fica de fora
    $whatsapp = gc_whatsapp($c['whatsapp'] ?? null) ?? '';

    $col = [
        'tipo' => $tipo, 'uf' => $uf, 'cidade' => gc_texto_curto($c['cidade'] ?? '', 60), 'nome' => $nome, 'whatsapp' => $whatsapp,
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

        $cupom = $c['cupom'] ?? null;
        if (is_array($cupom)) {
            $cod = is_string($cupom['codigo'] ?? null) ? strtoupper(trim($cupom['codigo'])) : '';
            if (preg_match('/^[A-Z0-9]{2,12}-[A-Z0-9]{3,10}$/', $cod) !== 1) {
                throw gc_invalido('cupom', 'O cupom não veio certo.');
            }
            $col['cupom'] = (string) json_encode([
                'codigo' => $cod, 'regra' => gc_texto_curto($cupom['regra'] ?? '', 200), 'origem' => gc_texto_curto($cupom['origem'] ?? '', 40),
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        } elseif ($cupom !== null) {
            throw gc_invalido('cupom', 'O cupom não veio certo.');
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

        $pagamento = $c['pagamento'] ?? null;
        if ($pagamento !== null && !in_array($pagamento, GC_PAGAMENTOS, true)) {
            throw gc_invalido('pagamento', 'A forma de pagamento não veio certa.');
        }
        $col['pagamento'] = $pagamento;
        $col['troco'] = $pagamento === 'dinheiro' ? gc_centavos_ou_nulo($c['troco'] ?? null, 'troco', 'O troco não veio certo.') : null;
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
 * substitui { codigo, token }: o aparelho mudou o pedido depois de mandar; o de antes, se ainda novo, sai da lista.
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
    $col = gc_ler_pedido($c, $codigo);
    $sub = is_array($c['substitui'] ?? null) ? $c['substitui'] : null;
    $subCodigo = $sub === null ? null : gc_codigo_pedido($sub['codigo'] ?? null);
    $subToken = $sub === null ? null : gc_token_do_aparelho($sub['token'] ?? null);

    return gc_transacao(static function () use ($col, $codigo, $token, $subCodigo, $subToken, $tentativa): array {
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
        $col = ['codigo' => $codigo, 'token_hash' => $hash, 'status' => 'novo'] + $col + [
            'substitui_id' => $antigo === null ? null : (int) $antigo['id'],
            'criado_em' => $agora, 'atualizado_em' => $agora,
            'busca' => gc_pedido_busca($codigo, (string) $col['nome'], (string) $col['cidade'], (string) $col['whatsapp']),
        ];
        $nomes = implode(', ', array_keys($col));
        $marcas = implode(', ', array_fill(0, count($col), '?'));
        $id = gc_inserir("INSERT INTO pedidos ($nomes) VALUES ($marcas)", array_values($col));
        $trocou = false;
        if ($antigo !== null && $antigo['status'] === 'novo' && $antigo['substituido_por_id'] === null) {
            gc_sql(
                "UPDATE pedidos SET status = 'cancelado', cancelado_em = ?, substituido_por_id = ?, status_por = 'site', atualizado_em = ? WHERE id = ?",
                [$agora, $id, $agora, $antigo['id']],
            );
            gc_evento('site', 'pedido-substituido', 'pedido:' . $antigo['codigo'], ['id' => (int) $antigo['id'], 'por' => $codigo]);
            $trocou = true;
        }
        $p = gc_pedido_um($id);
        gc_evento('site', $col['tipo'] === 'pedido' ? 'pedido-recebido' : 'encomenda-recebida', 'pedido:' . $codigo, [
            'id' => $id, 'uf' => $col['uf'], 'nome' => $col['nome'], 'itens' => count(json_decode((string) $col['itens'], true) ?: []),
        ]);
        gc_aviso_pedido($p, $antigo === null ? null : ['codigo' => (string) $antigo['codigo'], 'trocou' => $trocou, 'status' => (string) $antigo['status']]);
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
    // o pedido que entrou no lugar dele é que vale: o trocado não muda mais
    $proximos = $p['substituido_por_id'] !== null ? [] : (GC_PEDIDO_TRANSICOES[$status] ?? []);
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
    $ufs = array_map(static fn (array $l): string => (string) $l['uf'], gc_todos('SELECT DISTINCT uf FROM pedidos ORDER BY uf'));
    return [
        'agora' => gc_iso(gc_agora()),
        'pedidos' => array_map('gc_pedido_linha', array_slice($linhas, 0, $limite)),
        'contagem' => $contagem,
        'ufs' => $ufs,
        'mais' => $mais,
    ];
}

/** GET admin-pedidos-resumo: o que o Resumo do painel mostra (pedidos novos e avisos que não chegaram). */
function gc_rota_admin_pedidos_resumo(): array
{
    gc_exigir_dono();
    gc_avisos_depois([]);
    $novos = gc_todos(GC_PEDIDOS_SELECT . " WHERE p.status = 'novo' ORDER BY p.id DESC LIMIT 5");
    return [
        'agora' => gc_iso(gc_agora()),
        'novos' => (int) gc_valor("SELECT COUNT(*) FROM pedidos WHERE status = 'novo'"),
        'emAndamento' => (int) gc_valor("SELECT COUNT(*) FROM pedidos WHERE status IN ('confirmado','saiu')"),
        'ultimos' => array_map('gc_pedido_linha', $novos),
        'avisos' => gc_avisos_situacao(),
    ];
}

/** GET admin-pedido&id=: o pedido inteiro, os outros com o mesmo código (dois aparelhos que sortearam igual) e os avisos dele. */
function gc_rota_admin_pedido(): array
{
    gc_exigir_dono();
    $p = gc_pedido_ou_404($_GET['id'] ?? null);
    $mesmos = gc_todos(GC_PEDIDOS_SELECT . ' WHERE p.codigo = ? AND p.id <> ? ORDER BY p.id DESC LIMIT 5', [$p['codigo'], $p['id']]);
    return [
        'agora' => gc_iso(gc_agora()),
        'pedido' => gc_pedido_admin($p),
        'mesmoCodigo' => array_map('gc_pedido_linha', $mesmos),
        'avisos' => array_map('gc_aviso_publico', gc_todos('SELECT * FROM avisos_envios WHERE alvo = ? ORDER BY id DESC LIMIT 5', ['pedido:' . $p['id']])),
    ];
}

/**
 * POST admin-pedido-status { id, status }: novo → confirmado → saiu → entregue (e voltar um passo), cancelado de
 * qualquer um que não foi entregue, cancelado → novo (reabrir). Pedir o status que já tem não é erro (jaEstava).
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
 * conversa do pedido) e uma anotação da loja. Campo ausente fica como está.
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
            // (e nada mais sai dele: o que ainda esperava nova tentativa para)
            gc_sql(
                "UPDATE avisos_envios SET texto = 'Dados apagados (LGPD).', dados = '{}', reenvia = 0, tentar_em = NULL,
                   status = CASE WHEN status = 'enviado' THEN 'enviado' ELSE 'falhou' END WHERE alvo = ?",
                ['pedido:' . $p['id']],
            );
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
        'pedido-recebido' => "Pedido $alvo" . $de() . " pelo site$uf",
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

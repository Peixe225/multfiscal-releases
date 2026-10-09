<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Conferência do que o painel manda pra loja: textos, preço, combos, variações, cores, horário, Instagram, cidades,
// prêmios (as mesmas regras de src/lib/cupom.ts) e as duas listas de palavras: a do tabaco e vape (Anvisa, a mesma do
// rateio: gc_termo_proibido) em tudo, e a PALAVRAS_PROIBIDAS do site (src/dados/sorte.ts) nos prêmios e nos textos da
// loja. Na edição, campo ausente fica como está. Erro sempre com o campo que a tela marca.

/** PALAVRAS_PROIBIDAS de src/dados/sorte.ts (o scripts/testar-api.mjs confere que é a mesma lista, na mesma ordem). */
const GC_LOJA_PALAVRAS = [
    'folha', 'erva', 'flor', 'prensado', 'marofa', 'fumaça', 'fumar', 'brisa', 'chapar', 'larica', 'tapa', 'trago', '420',
    'grátis', 'frete', 'prazo', 'entrega', 'sorteio', 'cigarro', 'charuto', 'backwoods', 'fumo', 'tabaco',
];

/**
 * Bebida alcoólica no nome: prêmio não cai em produto assim (a regra é a categoria marcada como bebida; esta lista é a
 * rede pra quando o produto foi parar na categoria errada). Palavra inteira, sem acento.
 */
const GC_LOJA_ALCOOL = [
    'whisky', 'whiskey', 'uisque', 'gin', 'vodka', 'vodca', 'rum', 'tequila', 'cachaca', 'conhaque', 'cognac', 'licor',
    'cerveja', 'chopp', 'vinho', 'espumante', 'champagne', 'jagermeister', 'absinto', 'bourbon', 'mezcal',
];

/** Texto pra comparar: minúsculo, sem acento (também o acento solto, de teclado que manda a letra decomposta). */
function gc_loja_comparavel(string $s): string
{
    return gc_sem_acento((string) preg_replace('/\p{Mn}+/u', '', $s));
}

/** Texto limpo (gc_texto) e na forma composta do Unicode quando o PHP tem o intl. null = não é texto. */
function gc_loja_limpo(mixed $v, bool $linhas = false): ?string
{
    $t = gc_texto($v, $linhas);
    if ($t !== null && $t !== '' && class_exists('Normalizer')) {
        $n = Normalizer::normalize($t, Normalizer::FORM_C);
        $t = is_string($n) ? $n : $t;
    }
    return $t;
}

/** Primeira palavra da PALAVRAS_PROIBIDAS no texto, no começo de palavra como no site ("tapa" não pega "etapa"). */
function gc_loja_palavra_proibida(string $texto): ?string
{
    $t = gc_loja_comparavel($texto);
    foreach (GC_LOJA_PALAVRAS as $p) {
        if (preg_match('/(^|[^a-z0-9])' . preg_quote(gc_loja_comparavel($p), '/') . '/', $t) === 1) {
            return $p;
        }
    }
    return null;
}

/** Nome com cara de bebida alcoólica? */
function gc_loja_parece_alcool(string $texto): bool
{
    $t = ' ' . trim((string) preg_replace('/[^a-z0-9]+/', ' ', gc_loja_comparavel($texto))) . ' ';
    foreach (GC_LOJA_ALCOOL as $p) {
        if (str_contains($t, " $p ")) {
            return true;
        }
    }
    return false;
}

/**
 * Tabaco e vape não entram (Anvisa), em campo nenhum.
 * @param array<string, string> $campos campo => texto
 */
function gc_loja_sem_tabaco(array $campos): void
{
    foreach ($campos as $campo => $texto) {
        $termo = gc_termo_proibido(gc_loja_comparavel($texto));
        if ($termo !== null) {
            throw new ErroApi('proibido', 'Derivado do tabaco e cigarro eletrônico não entram no site (Anvisa).', 422, ['campo' => $campo, 'termo' => $termo, 'lista' => 'tabaco']);
        }
    }
}

/**
 * Nem tabaco nem as palavras que o site não usa (gíria e promessa: "grátis", "frete", "prazo"…).
 * @param array<string, string> $campos
 */
function gc_loja_sem_palavras(array $campos): void
{
    gc_loja_sem_tabaco($campos);
    foreach ($campos as $campo => $texto) {
        $p = gc_loja_palavra_proibida($texto);
        if ($p !== null) {
            throw new ErroApi('proibido', "Tira o “{$p}”: o site não usa essa palavra.", 422, ['campo' => $campo, 'termo' => $p, 'lista' => 'palavras']);
        }
    }
}

/** Reais (número ou "14,90") em centavos, de R$ 0,00 a R$ 100.000,00. null = inválido. */
function gc_loja_centavos(mixed $v): ?int
{
    if ($v === 0 || $v === 0.0 || (is_string($v) && preg_match('/^\s*(R\$\s*)?0+([.,]0{1,2})?\s*$/', $v) === 1)) {
        return 0;
    }
    return gc_centavos($v);
}

function gc_loja_cor(mixed $v): ?string
{
    return is_string($v) && preg_match('/^#[0-9a-fA-F]{6}$/', $v) === 1 ? strtolower($v) : null;
}

/** "HH:MM" de 00:00 a 23:59. */
function gc_loja_hora(mixed $v): ?string
{
    return is_string($v) && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $v) === 1 ? $v : null;
}

/** @ do Instagram (aceita com @, com espaço ou o link do perfil colado): letras, números, ponto e _, até 30. */
function gc_loja_instagram(mixed $v): ?string
{
    if (!is_string($v) || strlen($v) > 120) {
        return null;
    }
    $i = strtolower(trim($v));
    $i = (string) preg_replace('#^(https?://)?(www\.)?instagram\.com/#', '', $i);
    $i = trim(ltrim($i, '@'), "/ \t");
    return preg_match('/^(?!.*\.\.)(?!\.)[a-z0-9._]{1,30}(?<!\.)$/', $i) === 1 ? $i : null;
}

function gc_loja_bool(array $c, string $k, string $msg): bool
{
    if (!is_bool($c[$k])) {
        throw gc_invalido($k, $msg);
    }
    return $c[$k];
}

/** Slug (a-z, 0-9 e hífen, até 60) de um nome; vazio vira $padrao. */
function gc_loja_slug(string $texto, string $padrao): string
{
    $s = trim((string) preg_replace('/[^a-z0-9]+/', '-', gc_loja_comparavel($texto)), '-');
    if (strlen($s) > 60) {
        $s = substr($s, 0, 60);
        $corte = strrpos($s, '-');
        if ($corte !== false && $corte > 20) {
            $s = substr($s, 0, $corte);
        }
        $s = rtrim($s, '-');
    }
    return $s === '' ? $padrao : $s;
}

/** Id livre numa tabela da loja (o slug, ou slug-2, slug-3…). */
function gc_loja_id_livre(string $base, string $tabela): string
{
    $id = $base;
    for ($n = 2; gc_valor("SELECT 1 FROM $tabela WHERE id = ?", [$id]) !== null; $n++) {
        $id = $n <= 99 ? substr($base, 0, 56) . '-' . $n : substr($base, 0, 50) . '-' . bin2hex(random_bytes(3));
    }
    return $id;
}

// ─── produto ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Combos coerentes: com o preço da unidade, quantidade sem repetir, cada um mais barato que comprar avulso e o total
 * subindo com a quantidade.
 * @param list<array{qtd: int, total: int}> $combos (em ordem de quantidade)
 */
function gc_loja_conferir_combos(array $combos, ?int $preco): void
{
    if ($combos === []) {
        return;
    }
    if ($preco === null) {
        throw gc_invalido('combos', 'Combo precisa do preço da unidade (com “Consultar” não dá pra fechar a conta).');
    }
    $antes = null;
    foreach ($combos as $i => $c) {
        if ($antes !== null && $c['qtd'] === $antes['qtd']) {
            throw gc_invalido('combos', "Dois combos de {$c['qtd']}: deixa um só.", ['indice' => $i]);
        }
        if ($c['total'] >= $c['qtd'] * $preco) {
            throw gc_invalido('combos', "O combo de {$c['qtd']} tem que sair mais barato que {$c['qtd']} avulsos (R$ " . gc_reais_texto($c['qtd'] * $preco) . ').', ['indice' => $i]);
        }
        if ($antes !== null && $c['total'] <= $antes['total']) {
            throw gc_invalido('combos', "O combo de {$c['qtd']} tem que custar mais que o de {$antes['qtd']}.", ['indice' => $i]);
        }
        $antes = $c;
    }
}

/** @return list<array{qtd: int, total: int}> */
function gc_loja_ler_combos(mixed $v, ?int $preco): array
{
    $v ??= [];
    if (!is_array($v) || !array_is_list($v) || count($v) > 5) {
        throw gc_invalido('combos', 'Até 5 combos.');
    }
    $out = [];
    foreach ($v as $i => $c) {
        $qtd = is_array($c) ? gc_inteiro($c['qtd'] ?? null, 2, 99) : null;
        if ($qtd === null) {
            throw gc_invalido('combos', 'Combo é de 2 unidades pra cima (até 99).', ['indice' => $i, 'parte' => 'qtd']);
        }
        $total = is_array($c) ? gc_centavos($c['total'] ?? null) : null;
        if ($total === null) {
            throw gc_invalido('combos', 'Põe o preço do combo (ex.: 14,99).', ['indice' => $i, 'parte' => 'total']);
        }
        $out[] = ['qtd' => $qtd, 'total' => $total];
    }
    usort($out, static fn (array $a, array $b): int => $a['qtd'] <=> $b['qtd']);
    gc_loja_conferir_combos($out, $preco);
    return $out;
}

/**
 * Variações (sabor, tamanho, modelo): nome de 1 a 40, sem repetir; preço próprio opcional. O id fica o mesmo na edição
 * (a sacola e os links guardam ele); variação nova ganha o id do nome.
 * @return list<array{id: string, nome: string, preco?: int}>
 */
function gc_loja_ler_variacoes(mixed $v): array
{
    $v ??= [];
    if (!is_array($v) || !array_is_list($v) || count($v) > 12) {
        throw gc_invalido('variacoes', 'Até 12 variações.');
    }
    $out = [];
    $ids = [];
    $nomes = [];
    foreach ($v as $i => $x) {
        $nome = is_array($x) ? gc_loja_limpo($x['nome'] ?? null) : null;
        if (!is_string($nome) || gc_tamanho($nome) < 1 || gc_tamanho($nome) > 40) {
            throw gc_invalido('variacoes', 'Nome da variação de 1 a 40 letras.', ['indice' => $i]);
        }
        gc_loja_sem_tabaco(['variacoes' => $nome]);
        $chave = gc_loja_comparavel($nome);
        if (isset($nomes[$chave])) {
            throw gc_invalido('variacoes', "Duas variações “{$nome}”: deixa uma só.", ['indice' => $i]);
        }
        $nomes[$chave] = true;
        $id = isset($x['id']) && gc_id_valido($x['id']) ? (string) $x['id'] : gc_loja_slug($nome, 'opcao');
        $base = $id;
        for ($n = 2; isset($ids[$id]); $n++) {
            $id = substr($base, 0, 56) . '-' . $n;
        }
        $ids[$id] = true;
        $item = ['id' => $id, 'nome' => $nome];
        if (array_key_exists('preco', $x) && $x['preco'] !== null && $x['preco'] !== '') {
            $preco = gc_loja_centavos($x['preco']);
            if ($preco === null) {
                throw gc_invalido('variacoes', 'Preço da variação de R$ 0,00 a R$ 100.000,00 (ou vazio: vale o do produto).', ['indice' => $i]);
            }
            $item['preco'] = $preco;
        }
        $out[] = $item;
    }
    return $out;
}

/**
 * Disponível e estoque por estado vindos do formulário: { uf: { disponivel, estoque } }. Só estados da loja.
 * @return array<string, array{disponivel: bool, estoque: int|null}>
 */
function gc_loja_ler_por_uf(mixed $v): array
{
    if (!is_array($v) || ($v !== [] && array_is_list($v))) {
        throw gc_invalido('estados', 'Disponibilidade por estado veio torta. Recarrega e tenta de novo.');
    }
    $out = [];
    foreach ($v as $uf => $e) {
        $uf = gc_uf($uf);
        if ($uf === null || gc_um('SELECT 1 FROM loja_estados WHERE uf = ?', [$uf]) === null) {
            throw gc_invalido('estados', 'Estado que a loja não atende.');
        }
        if (!is_array($e) || !is_bool($e['disponivel'] ?? null)) {
            throw gc_invalido('estados', 'Disponível é sim ou não.', ['uf' => $uf]);
        }
        $estoque = $e['estoque'] ?? null;
        if ($estoque !== null) {
            $estoque = gc_inteiro($estoque, 0, 99999);
            if ($estoque === null) {
                throw gc_invalido('estados', 'Estoque de 0 a 99.999 unidades (ou sem contar).', ['uf' => $uf]);
            }
        }
        $out[$uf] = ['disponivel' => $e['disponivel'], 'estoque' => $estoque];
    }
    return $out;
}

/**
 * Lê e confere um produto. Tabaco e vape não entram em nome, tamanho, detalhe, descrição nem variação.
 * @param array<string, mixed> $c
 * @param array<string, mixed>|null $atual a linha de loja_produtos (edição)
 * @return array<string, mixed> colunas
 */
function gc_loja_ler_produto(array $c, ?array $atual): array
{
    $tem = static fn (string $k): bool => array_key_exists($k, $c);
    $col = [];

    $nome = $tem('nome') ? gc_loja_limpo($c['nome']) : ($atual['nome'] ?? null);
    if (!is_string($nome) || gc_tamanho($nome) < 2 || gc_tamanho($nome) > 60) {
        throw gc_invalido('nome', 'Nome de 2 a 60 letras.');
    }
    $col['nome'] = $nome;
    foreach (['tamanho' => [20, 'Tamanho até 20 letras (ex.: 350 ml, 1 L).'], 'detalhe' => [60, 'Detalhe até 60 letras.']] as $k => [$max, $msg]) {
        $v = $tem($k) ? gc_loja_limpo($c[$k]) : ($atual[$k] ?? '');
        if (!is_string($v) || gc_tamanho($v) > $max) {
            throw gc_invalido($k, $msg);
        }
        $col[$k] = $v;
    }
    $descricao = $tem('descricao') ? gc_loja_limpo($c['descricao'], true) : ($atual['descricao'] ?? '');
    if (!is_string($descricao) || gc_tamanho($descricao) > 300) {
        throw gc_invalido('descricao', 'Descrição até 300 letras.');
    }
    $col['descricao'] = $descricao;
    gc_loja_sem_tabaco(['nome' => $nome, 'tamanho' => $col['tamanho'], 'detalhe' => $col['detalhe'], 'descricao' => $descricao]);

    $categoria = $tem('categoria') ? $c['categoria'] : ($atual['categoria_id'] ?? null);
    if (!gc_id_valido($categoria) || gc_um('SELECT 1 FROM loja_categorias WHERE id = ?', [$categoria]) === null) {
        throw gc_invalido('categoria', 'Escolhe a categoria.');
    }
    $col['categoria_id'] = (string) $categoria;

    // preço: null = "Consultar" (nunca inventar preço)
    if ($tem('preco')) {
        $preco = $c['preco'] === null || $c['preco'] === '' ? null : gc_loja_centavos($c['preco']);
        if ($preco === null && $c['preco'] !== null && $c['preco'] !== '') {
            throw gc_invalido('preco', 'Preço de R$ 0,00 a R$ 100.000,00, ou vazio pra aparecer “Consultar”.');
        }
    } else {
        $preco = $atual === null ? null : gc_int_ou_nulo($atual['preco']);
    }
    $col['preco'] = $preco;

    // combos: conferidos de novo quando o preço muda (o combo de antes pode ter ficado mais caro que o avulso)
    if ($tem('combos')) {
        $combos = gc_loja_ler_combos($c['combos'], $preco);
    } else {
        $combos = $atual === null ? [] : array_map(static fn (array $x): array => ['qtd' => (int) $x['qtd'], 'total' => (int) $x['total']], gc_loja_combos($atual));
        gc_loja_conferir_combos($combos, $preco);
    }
    $col['combos'] = gc_loja_json($combos);
    $col['variacoes'] = gc_loja_json($tem('variacoes') ? gc_loja_ler_variacoes($c['variacoes']) : ($atual === null ? [] : gc_loja_variacoes($atual)));

    if ($tem('combinaCom')) {
        $lista = $c['combinaCom'] ?? [];
        if (!is_array($lista) || !array_is_list($lista) || count($lista) > 8) {
            throw gc_invalido('combinaCom', 'Até 8 produtos em “Combina com”.');
        }
        $ids = [];
        foreach ($lista as $id) {
            if (!gc_id_valido($id) || $id === ($atual['id'] ?? null) || gc_um('SELECT 1 FROM loja_produtos WHERE id = ?', [$id]) === null) {
                throw gc_invalido('combinaCom', 'Produto do “Combina com” não encontrado.');
            }
            $ids[(string) $id] = true;
        }
        $col['combina_com'] = gc_loja_json(array_keys($ids));
    } else {
        $col['combina_com'] = (string) ($atual['combina_com'] ?? '[]');
    }

    // foto: a enviada pelo painel (uploads/…) ou uma do build do site (produtos/…); sem foto, o site desenha a arte
    $foto = $tem('foto') ? $c['foto'] : ($atual['foto'] ?? null);
    if ($foto === '' || $foto === null) {
        $foto = null;
    } elseif (!is_string($foto)) {
        throw gc_invalido('foto', 'Foto inválida. Envia de novo.');
    } elseif (preg_match('#^uploads/([a-z0-9]{8,64}\.(?:webp|jpe?g|png))$#', $foto, $m) === 1) {
        if ($foto !== ($atual['foto'] ?? null) && !is_file(gc_pasta_uploads() . '/' . $m[1])) {
            throw gc_invalido('foto', 'Foto não encontrada. Envia de novo.');
        }
    } elseif (preg_match('#^produtos/[a-z0-9][a-z0-9._-]{0,80}\.(?:webp|png|jpe?g)$#', $foto) !== 1) {
        throw gc_invalido('foto', 'Foto inválida. Envia de novo.');
    }
    $col['foto'] = $foto;

    $cor = $tem('cor') ? gc_loja_cor($c['cor']) : ($atual['cor'] ?? '#a8a8a8');
    if ($cor === null) {
        throw gc_invalido('cor', 'Cor em #rrggbb (ex.: #d8325f).');
    }
    $col['cor'] = $cor;

    if ($tem('arte')) {
        $a = $c['arte'];
        if (!is_array($a) || !in_array($a['tipo'] ?? null, GC_LOJA_ARTES, true)) {
            throw gc_invalido('arte', 'Escolhe o formato do desenho.');
        }
        $arte = ['tipo' => (string) $a['tipo']];
        foreach (['corpo', 'faixa', 'rotulo', 'detalhe', 'tampa'] as $k) {
            if (($a[$k] ?? null) === null || $a[$k] === '') {
                if ($k === 'corpo') {
                    throw gc_invalido('arte', 'Cor do desenho em #rrggbb.');
                }
                continue;
            }
            $arte[$k] = gc_loja_cor($a[$k]) ?? throw gc_invalido('arte', 'Cor do desenho em #rrggbb.');
        }
        $col['arte'] = gc_loja_json($arte);
    } else {
        $col['arte'] = $atual === null ? gc_loja_json(['tipo' => 'lata', 'corpo' => $cor]) : (string) $atual['arte'];
    }

    $obs = $tem('obs') ? gc_loja_limpo($c['obs'], true) : ($atual['obs'] ?? '');
    if (!is_string($obs) || gc_tamanho($obs) > 300) {
        throw gc_invalido('obs', 'Anotação até 300 letras.');
    }
    $col['obs'] = $obs;
    $col['demo'] = $tem('demo') ? (gc_loja_bool($c, 'demo', 'Exemplo é sim ou não.') ? 1 : 0) : (int) ($atual['demo'] ?? 0);
    $col['ativo'] = $tem('ativo') ? (gc_loja_bool($c, 'ativo', 'No site é sim ou não.') ? 1 : 0) : (int) ($atual['ativo'] ?? 1);
    return $col;
}

// ─── categoria ──────────────────────────────────────────────────────────────────────────────────────────────────

/** @return array<string, mixed> colunas */
function gc_loja_ler_categoria(array $c, ?array $atual): array
{
    $tem = static fn (string $k): bool => array_key_exists($k, $c);
    $nome = $tem('nome') ? gc_loja_limpo($c['nome']) : ($atual['nome'] ?? null);
    if (!is_string($nome) || gc_tamanho($nome) < 2 || gc_tamanho($nome) > 30) {
        throw gc_invalido('nome', 'Nome de 2 a 30 letras.');
    }
    $curto = $tem('curto') ? gc_loja_limpo($c['curto']) : ($atual['curto'] ?? (gc_tamanho($nome) <= 14 ? $nome : null));
    if (!is_string($curto) || gc_tamanho($curto) < 2 || gc_tamanho($curto) > 14) {
        throw gc_invalido('curto', 'Nome curto de 2 a 14 letras (é o que aparece embaixo da bolinha).');
    }
    gc_loja_sem_tabaco(['nome' => $nome, 'curto' => $curto]);
    $icone = $tem('icone') ? $c['icone'] : ($atual['icone'] ?? null);
    if (!in_array($icone, GC_LOJA_ICONES, true)) {
        throw gc_invalido('icone', 'Escolhe o ícone.');
    }
    // categoria nova é bebida até o dono dizer que não (bebida nunca entra em prêmio)
    $bebida = $tem('bebida') ? (gc_loja_bool($c, 'bebida', 'Bebida é sim ou não.') ? 1 : 0) : (int) ($atual['bebida'] ?? 1);
    return ['nome' => $nome, 'curto' => $curto, 'icone' => (string) $icone, 'bebida' => $bebida];
}

// ─── estado ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Horário da semana: 7 dias (domingo primeiro), cada um null (fechado) ou [abre, fecha] em "HH:MM". Fechar antes de
 * abrir é madrugada do dia seguinte (["18:00", "02:00"]).
 * @return list<array{0: string, 1: string}|null>
 */
function gc_loja_ler_horario(mixed $v): array
{
    if (!is_array($v) || !array_is_list($v) || count($v) !== 7) {
        throw gc_invalido('horario', 'Horário dos 7 dias, de domingo a sábado.');
    }
    $dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    $out = [];
    foreach ($v as $i => $t) {
        if ($t === null) {
            $out[] = null;
            continue;
        }
        $abre = is_array($t) && array_is_list($t) && count($t) === 2 ? gc_loja_hora($t[0]) : null;
        $fecha = is_array($t) && array_is_list($t) && count($t) === 2 ? gc_loja_hora($t[1]) : null;
        if ($abre === null || $fecha === null) {
            throw gc_invalido('horario', "Horário de {$dias[$i]} em HH:MM (ex.: 14:00).", ['dia' => $i]);
        }
        if ($abre === $fecha) {
            throw gc_invalido('horario', "Em {$dias[$i]}, abre e fecha no mesmo horário.", ['dia' => $i]);
        }
        $out[] = [$abre, $fecha];
    }
    return $out;
}

/**
 * Lê e confere um estado (o canal de atendimento). Na criação (ativar um estado novo), Instagram e as formas de
 * pagamento são obrigatórios; o resto nasce "a confirmar".
 * @return array<string, mixed> colunas
 */
function gc_loja_ler_estado(array $c, ?array $atual, string $uf): array
{
    $tem = static fn (string $k): bool => array_key_exists($k, $c);
    $col = [];

    $destaque = $tem('destaque') ? gc_loja_limpo($c['destaque']) : ($atual['destaque'] ?? 'DELIVERY ' . strtoupper($uf));
    if (!is_string($destaque) || gc_tamanho($destaque) < 2 || gc_tamanho($destaque) > 20) {
        throw gc_invalido('destaque', 'Nome do destaque de 2 a 20 letras (ex.: DELIVERY RJ).');
    }
    $col['destaque'] = $destaque;

    $perfil = $tem('nomePerfil') ? $c['nomePerfil'] : ($atual['nome_perfil'] ?? null);
    if ($perfil === null || $perfil === '') {
        $perfil = null;
    } else {
        $perfil = gc_loja_limpo($perfil);
        if (!is_string($perfil) || gc_tamanho($perfil) < 2 || gc_tamanho($perfil) > 40) {
            throw gc_invalido('nomePerfil', 'Nome do perfil de 2 a 40 letras (ou vazio: aparece só o @).');
        }
    }
    $col['nome_perfil'] = $perfil;

    $instagram = $tem('instagram') ? gc_loja_instagram($c['instagram']) : ($atual['instagram'] ?? null);
    if ($instagram === null) {
        throw gc_invalido('instagram', 'Põe o @ do Instagram do estado (letras, números, ponto e _).');
    }
    $col['instagram'] = $instagram;

    $whats = $tem('whatsapp') ? $c['whatsapp'] : ($atual['whatsapp'] ?? null);
    if ($whats === null || $whats === '') {
        $whats = null;
    } else {
        $whats = gc_whatsapp($whats) ?? throw gc_invalido('whatsapp', 'Esse WhatsApp não fecha. Põe DDD + 9 dígitos (ou deixa o da loja).');
    }
    $col['whatsapp'] = $whats;

    if ($tem('cidades')) {
        $lista = $c['cidades'] ?? [];
        if (!is_array($lista) || !array_is_list($lista) || count($lista) > 30) {
            throw gc_invalido('cidades', 'Até 30 cidades.');
        }
        $cidades = [];
        $slugs = [];
        foreach ($lista as $i => $x) {
            $nome = gc_loja_limpo(is_array($x) ? ($x['nome'] ?? null) : $x);
            if (!is_string($nome) || gc_tamanho($nome) < 2 || gc_tamanho($nome) > 60) {
                throw gc_invalido('cidades', 'Nome da cidade de 2 a 60 letras.', ['indice' => $i]);
            }
            $slug = gc_loja_slug($nome, 'cidade');
            if (isset($slugs[$slug])) {
                throw gc_invalido('cidades', "“{$nome}” tá duas vezes.", ['indice' => $i]);
            }
            $slugs[$slug] = true;
            $cidades[] = ['slug' => $slug, 'nome' => $nome];
        }
        $col['cidades'] = gc_loja_json($cidades);
    } else {
        $col['cidades'] = (string) ($atual['cidades'] ?? '[]');
    }

    // horário, taxa, entrega grátis e pagamento: o que veio do painel deixa de ser exemplo (a não ser que venha marcado)
    $demo = static function (string $k, string $coluna, bool $mudou) use ($c, $atual, $tem): int {
        if ($tem($k)) {
            if (!is_bool($c[$k])) {
                throw gc_invalido($k, 'Exemplo é sim ou não.');
            }
            return $c[$k] ? 1 : 0;
        }
        return $mudou ? 0 : (int) ($atual[$coluna] ?? 0);
    };
    if ($tem('horario')) {
        $col['horario'] = gc_loja_json(gc_loja_ler_horario($c['horario']));
    } else {
        $col['horario'] = (string) ($atual['horario'] ?? gc_loja_json(array_fill(0, 7, null)));
    }
    // estado novo sem horário: "a confirmar" (o site não mostra horário de exemplo)
    $col['horario_demo'] = $atual === null && !$tem('horario') && !$tem('horarioDemo') ? 1 : $demo('horarioDemo', 'horario_demo', $tem('horario'));

    if ($tem('taxa')) {
        $taxa = $c['taxa'] === null || $c['taxa'] === '' ? null : gc_loja_centavos($c['taxa']);
        if ($taxa === null && $c['taxa'] !== null && $c['taxa'] !== '') {
            throw gc_invalido('taxa', 'Taxa de R$ 0,00 a R$ 100.000,00, ou “A confirmar”.');
        }
    } else {
        $taxa = $atual === null ? null : gc_int_ou_nulo($atual['taxa']);
    }
    $col['taxa'] = $taxa;
    $col['taxa_demo'] = $demo('taxaDemo', 'taxa_demo', $tem('taxa'));

    if ($tem('entregaGratis')) {
        $g = $c['entregaGratis'];
        if ($g === null) {
            $col['entrega_gratis'] = null;
        } else {
            $dias = is_array($g) ? ($g['dias'] ?? null) : null;
            if (!is_array($dias) || !array_is_list($dias) || $dias === []) {
                throw gc_invalido('entregaGratis', 'Escolhe em que dia da semana a entrega é grátis.');
            }
            $lista = [];
            foreach ($dias as $d) {
                $n = gc_inteiro($d, 0, 6);
                if ($n === null) {
                    throw gc_invalido('entregaGratis', 'Dia da semana de domingo (0) a sábado (6).');
                }
                $lista[$n] = true;
            }
            ksort($lista);
            $texto = gc_loja_limpo($g['texto'] ?? null);
            if (!is_string($texto) || gc_tamanho($texto) < 2 || gc_tamanho($texto) > 40) {
                throw gc_invalido('entregaGratis', 'Frase da entrega grátis de 2 a 40 letras (ex.: Sextou com entrega grátis!).');
            }
            gc_loja_sem_tabaco(['entregaGratis' => $texto]);
            $col['entrega_gratis'] = gc_loja_json(['dias' => array_keys($lista), 'texto' => $texto]);
        }
    } else {
        $col['entrega_gratis'] = $atual['entrega_gratis'] ?? null;
    }
    $col['entrega_gratis_demo'] = $demo('entregaGratisDemo', 'entrega_gratis_demo', $tem('entregaGratis'));

    if ($tem('pagamentos')) {
        $p = $c['pagamentos'];
        if (!is_array($p) || !array_is_list($p) || $p === [] || array_diff($p, GC_LOJA_PAGAMENTOS) !== []) {
            throw gc_invalido('pagamentos', 'Escolhe pelo menos uma forma de pagamento.');
        }
        $col['pagamentos'] = gc_loja_json(array_values(array_intersect(GC_LOJA_PAGAMENTOS, $p)));
    } elseif ($atual === null) {
        throw gc_invalido('pagamentos', 'Escolhe pelo menos uma forma de pagamento.');
    } else {
        $col['pagamentos'] = (string) $atual['pagamentos'];
    }
    $col['pagamentos_demo'] = $demo('pagamentosDemo', 'pagamentos_demo', $tem('pagamentos'));

    gc_loja_sem_tabaco(['destaque' => $destaque, 'nomePerfil' => (string) $perfil]);
    $col['ativo'] = $tem('ativo') ? (gc_loja_bool($c, 'ativo', 'Ativo é sim ou não.') ? 1 : 0) : (int) ($atual['ativo'] ?? 1);
    return $col;
}

// ─── loja (ajustes e textos) e Teste minha sorte ────────────────────────────────────────────────────────────────

/** Uma lista de textos curtos (bio, falas): de $min a $max itens, cada um de 1 a $letras. @return list<string> */
function gc_loja_ler_linhas(mixed $v, string $campo, int $min, int $max, int $letras, string $msg): array
{
    if (!is_array($v) || !array_is_list($v)) {
        throw gc_invalido($campo, $msg);
    }
    $out = [];
    foreach ($v as $i => $x) {
        $t = gc_loja_limpo($x);
        if ($t === null || $t === '') {
            continue; // linha em branco some
        }
        if (gc_tamanho($t) > $letras) {
            throw gc_invalido($campo, "Cada linha até $letras letras.", ['indice' => $i]);
        }
        $out[] = $t;
    }
    if (count($out) < $min || count($out) > $max) {
        throw gc_invalido($campo, $msg);
    }
    return $out;
}

/**
 * Textos da loja (src/dados/textos-loja.ts): curtos, sem tabaco e sem as palavras que o site não usa.
 * @param array<string, mixed> $atual
 * @return array{bio: list<string>, fraseStory: string, sacolaVazia: string, falasMercado: list<string>}
 */
function gc_loja_ler_textos(mixed $v, array $atual): array
{
    if (!is_array($v) || ($v !== [] && array_is_list($v))) {
        throw gc_invalido('textos', 'Textos vieram tortos. Recarrega e tenta de novo.');
    }
    $out = $atual;
    if (array_key_exists('bio', $v)) {
        $out['bio'] = gc_loja_ler_linhas($v['bio'], 'bio', 1, 3, 80, 'A bio tem de 1 a 3 linhas.');
        if (gc_tamanho(implode("\n", $out['bio'])) > 150) {
            throw gc_invalido('bio', 'A bio inteira até 150 letras (como a do Instagram).');
        }
    }
    foreach (['fraseStory' => [28, 'A frase do story de 2 a 28 letras.'], 'sacolaVazia' => [48, 'O texto da sacola vazia de 2 a 48 letras.']] as $k => [$max, $msg]) {
        if (array_key_exists($k, $v)) {
            $t = gc_loja_limpo($v[$k]);
            if (!is_string($t) || gc_tamanho($t) < 2 || gc_tamanho($t) > $max) {
                throw gc_invalido($k, $msg);
            }
            $out[$k] = $t;
        }
    }
    if (array_key_exists('falasMercado', $v)) {
        $out['falasMercado'] = gc_loja_ler_linhas($v['falasMercado'], 'falasMercado', 1, 5, 32, 'De 1 a 5 falas do mercador.');
    }
    gc_loja_sem_palavras([
        'bio' => implode(' · ', $out['bio']),
        'fraseStory' => $out['fraseStory'],
        'sacolaVazia' => $out['sacolaVazia'],
        'falasMercado' => implode(' · ', $out['falasMercado']),
    ]);
    return $out;
}

/**
 * Lê e confere um prêmio do Teste minha sorte: as regras de src/lib/cupom.ts (motivoInvalido). Só acessório: nada em
 * bebida (categoria marcada como bebida, ou nome de bebida alcoólica), peso > 0, validade de 1 a 30 dias, percentual
 * de 1 a 50, leve > pague, produto e categoria que existem, e nenhuma palavra da lista nos textos.
 * @return array<string, mixed> colunas
 */
function gc_loja_ler_premio(array $c, ?array $atual): array
{
    $tem = static fn (string $k): bool => array_key_exists($k, $c);
    $col = [];
    $tipo = $tem('tipo') ? $c['tipo'] : ($atual['tipo'] ?? null);
    if (!in_array($tipo, ['desconto-percentual', 'leve-x-pague-y', 'brinde'], true)) {
        throw gc_invalido('tipo', 'Escolhe o tipo do prêmio.');
    }
    $col['tipo'] = $tipo;

    // produto que pode virar prêmio: existe e não é bebida
    $acessorio = static function (mixed $id, string $campo): array {
        $p = gc_loja_produto_e_categoria($id);
        if ($p === null) {
            throw gc_invalido($campo, 'Produto não encontrado.');
        }
        if ((int) $p['bebida'] === 1 || gc_loja_parece_alcool((string) $p['nome'])) {
            throw gc_invalido($campo, "“{$p['nome']}” é bebida: prêmio só em acessório (sedas, piteiras, acessórios).");
        }
        return $p;
    };

    $valor = $tem('valor') ? $c['valor'] : ($atual === null || ($tem('tipo') && $tipo !== $atual['tipo']) ? null : gc_loja_lido($atual['valor'], null));
    if ($tipo === 'desconto-percentual') {
        $n = gc_inteiro($valor, 1, 50);
        if ($n === null) {
            throw gc_invalido('valor', 'Desconto de 1% a 50%.');
        }
        $col['valor'] = gc_loja_json($n);
    } elseif ($tipo === 'leve-x-pague-y') {
        $leve = is_array($valor) ? gc_inteiro($valor['leve'] ?? null, 2, 20) : null;
        $pague = is_array($valor) ? gc_inteiro($valor['pague'] ?? null, 1, 19) : null;
        if ($leve === null || $pague === null || $leve <= $pague) {
            throw gc_invalido('valor', 'Leva tem que ser mais que paga (ex.: leva 4, paga 3).');
        }
        $col['valor'] = gc_loja_json(['leve' => $leve, 'pague' => $pague]);
    } else {
        $qtd = is_array($valor) ? gc_inteiro($valor['qtd'] ?? 1, 1, 10) : null;
        if (!is_array($valor) || $qtd === null) {
            throw gc_invalido('valor', 'Escolhe o produto que vai de brinde (de 1 a 10).');
        }
        $b = $acessorio($valor['produto'] ?? null, 'valor');
        $col['valor'] = gc_loja_json(['produto' => (string) $b['id'], 'qtd' => $qtd]);
    }

    $aplica = $tem('aplicaA') ? $c['aplicaA'] : ($atual === null ? null : gc_loja_lido($atual['aplica_a'], null));
    if (!is_array($aplica) || ($aplica !== [] && array_is_list($aplica))) {
        throw gc_invalido('aplicaA', 'Escolhe em que produto ou categoria o prêmio vale.');
    }
    $produtos = $aplica['produtos'] ?? [];
    $categorias = $aplica['categorias'] ?? [];
    if (!is_array($produtos) || !array_is_list($produtos) || !is_array($categorias) || !array_is_list($categorias) || count($produtos) > 20 || count($categorias) > 10) {
        throw gc_invalido('aplicaA', 'Escolhe em que produto ou categoria o prêmio vale.');
    }
    if ($produtos === [] && $categorias === []) {
        throw gc_invalido('aplicaA', 'Escolhe em que produto ou categoria o prêmio vale.');
    }
    $ap = [];
    foreach ($produtos as $id) {
        $ap['produtos'][] = (string) $acessorio($id, 'aplicaA')['id'];
    }
    foreach ($categorias as $id) {
        $cat = gc_id_valido($id) ? gc_um('SELECT id, nome, bebida FROM loja_categorias WHERE id = ?', [$id]) : null;
        if ($cat === null) {
            throw gc_invalido('aplicaA', 'Categoria não encontrada.');
        }
        if ((int) $cat['bebida'] === 1) {
            throw gc_invalido('aplicaA', "“{$cat['nome']}” é de bebida: prêmio só em acessório.");
        }
        $ap['categorias'][] = (string) $cat['id'];
    }
    foreach ($ap as $k => $ids) {
        $ap[$k] = array_values(array_unique($ids));
    }
    $col['aplica_a'] = gc_loja_json($ap);

    $textos = [];
    foreach ([
        'titulo' => ['titulo', 2, 60, 'Nome interno de 2 a 60 letras.'],
        'descricao' => ['descricao', 2, 40, 'A linha de apoio de 2 a 40 letras (até 28 cabe numa linha no celular).'],
        'regra' => ['regra', 2, 120, 'A regra de 2 a 120 letras (é a frase que vai no WhatsApp).'],
        'comoUsar' => ['como_usar', 0, 160, 'Como usar até 160 letras.'],
    ] as $k => [$coluna, $min, $max, $msg]) {
        $t = $tem($k) ? gc_loja_limpo($c[$k]) : ($atual[$coluna] ?? ($min === 0 ? '' : null));
        if (!is_string($t) || gc_tamanho($t) < $min || gc_tamanho($t) > $max) {
            throw gc_invalido($k, $msg);
        }
        $col[$coluna] = $t;
        $textos[$k] = $t;
    }
    gc_loja_sem_palavras($textos);

    $peso = $tem('peso') ? gc_inteiro($c['peso'], 1, 1000) : ($atual === null ? null : (int) $atual['peso']);
    if ($peso === null) {
        throw gc_invalido('peso', 'Peso de 1 a 1000 (quanto maior, mais sai).');
    }
    $col['peso'] = $peso;
    $validade = $tem('validadeDias') ? gc_inteiro($c['validadeDias'], 1, 30) : ($atual === null ? null : (int) $atual['validade_dias']);
    if ($validade === null) {
        throw gc_invalido('validadeDias', 'Validade de 1 a 30 dias.');
    }
    $col['validade_dias'] = $validade;
    $col['ativo'] = $tem('ativo') ? (gc_loja_bool($c, 'ativo', 'No jogo é sim ou não.') ? 1 : 0) : (int) ($atual['ativo'] ?? 1);
    $col['demo'] = $tem('demo') ? (gc_loja_bool($c, 'demo', 'Exemplo é sim ou não.') ? 1 : 0) : (int) ($atual['demo'] ?? 0);
    return $col;
}

/** O produto com o "bebida" da categoria dele, ou null. @return array<string, mixed>|null */
function gc_loja_produto_e_categoria(mixed $id): ?array
{
    if (!gc_id_valido($id)) {
        return null;
    }
    return gc_um('SELECT p.id, p.nome, c.bebida FROM loja_produtos p JOIN loja_categorias c ON c.id = p.categoria_id WHERE p.id = ?', [$id]);
}

/**
 * Regras do Teste minha sorte (src/dados/sorte.ts, regrasSorte): ligado, giros sem conta, giros por dia com conta e as
 * horas que o prêmio de quem girou sem conta fica guardado.
 * @param array<string, mixed> $atual
 * @return array{ligado: bool, girosSemConta: int, girosPorDiaComConta: int, reservaSemContaHoras: int}
 */
function gc_loja_ler_sorte(array $c, array $atual): array
{
    $out = $atual;
    if (array_key_exists('ligado', $c)) {
        $out['ligado'] = gc_loja_bool($c, 'ligado', 'Ligado é sim ou não.');
    }
    // sem conta gira pelo menos 1 vez: conta é incentivo, nunca pedágio (DECISOES.md, item 13)
    foreach ([
        'girosSemConta' => [1, 3, 'Giros sem conta de 1 a 3 (o primeiro é sempre livre).'],
        'girosPorDiaComConta' => [1, 5, 'Giros por dia com conta de 1 a 5.'],
        'reservaSemContaHoras' => [1, 72, 'O prêmio sem conta fica guardado de 1 a 72 horas.'],
    ] as $k => [$min, $max, $msg]) {
        if (array_key_exists($k, $c)) {
            $out[$k] = gc_inteiro($c[$k], $min, $max) ?? throw gc_invalido($k, $msg);
        }
    }
    return $out;
}

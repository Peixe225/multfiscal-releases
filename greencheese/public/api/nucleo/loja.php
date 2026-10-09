<?php
declare(strict_types=1);
defined('GC_API') || exit;

// A loja no servidor: categorias, produtos (disponível e estoque por estado), estados/canais, stories do Início,
// ajustes (WhatsApp, "restam X", textos) e o Teste minha sorte (prêmios e regras). O site lê tudo num JSON só
// (GET loja, com ETag); o painel mexe pelas rotas de nucleo/loja-painel.php. Formato no API.md, seção "Loja".
// Toda escrita chama gc_loja_mudou() na mesma transação: a versão sobe e o ETag muda.

/** As 27 UFs (o estado novo que o dono ativa ganha o nome daqui). */
const GC_LOJA_NOMES_UF = [
    'ac' => 'Acre', 'al' => 'Alagoas', 'ap' => 'Amapá', 'am' => 'Amazonas', 'ba' => 'Bahia', 'ce' => 'Ceará',
    'df' => 'Distrito Federal', 'es' => 'Espírito Santo', 'go' => 'Goiás', 'ma' => 'Maranhão', 'mt' => 'Mato Grosso',
    'ms' => 'Mato Grosso do Sul', 'mg' => 'Minas Gerais', 'pa' => 'Pará', 'pb' => 'Paraíba', 'pr' => 'Paraná',
    'pe' => 'Pernambuco', 'pi' => 'Piauí', 'rj' => 'Rio de Janeiro', 'rn' => 'Rio Grande do Norte',
    'rs' => 'Rio Grande do Sul', 'ro' => 'Rondônia', 'rr' => 'Roraima', 'sc' => 'Santa Catarina', 'sp' => 'São Paulo',
    'se' => 'Sergipe', 'to' => 'Tocantins',
];
/** Ícones de categoria (os de src/arte/pixel/grades.ts e extras.ts que o destaque do site desenha). */
const GC_LOJA_ICONES = ['lata', 'garrafa', 'seda', 'piteira', 'cuia', 'dichavador', 'tesoura', 'sacola', 'estrela'];
/** Formatos da arte em pixel do produto sem foto (TipoArte de src/lib/tipos.ts). */
const GC_LOJA_ARTES = [
    'lata', 'lata-alta', 'garrafa-quadrada', 'garrafa-gin', 'garrafa-conhaque', 'garrafa-licor', 'seda', 'piteira-vidro',
    'piteira-papel', 'cuia', 'dichavador', 'isqueiro', 'bandeja',
];
const GC_LOJA_PAGAMENTOS = ['pix', 'dinheiro', 'cartao'];
/** Emblema do destaque do estado: os 5 desenhados e o genérico, dos estados que o dono ativar. */
const GC_LOJA_EMBLEMAS = ['pao-de-acucar', 'pedra-preciosa', 'predio-sp', 'convento-es', 'ponte-sc', 'generico'];
/** Produtos no story do Início de um estado: as barrinhas do topo (MAX_BARRAS do Hero.tsx). */
const GC_LOJA_STORIES_MAX = 8;

// ─── JSON e ajustes ─────────────────────────────────────────────────────────────────────────────────────────────

function gc_loja_json(mixed $v): string
{
    return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

/** JSON guardado de volta em PHP; vazio ou torto = $padrao. */
function gc_loja_lido(mixed $texto, mixed $padrao): mixed
{
    if (!is_string($texto) || $texto === '') {
        return $padrao;
    }
    $v = json_decode($texto, true);
    return $v === null ? $padrao : $v;
}

/** Mapa uf → algo, sempre como objeto no JSON ({} e não [] quando vazio). */
function gc_loja_mapa(array $m): array|stdClass
{
    return $m === [] ? new stdClass() : $m;
}

/** A loja mudou (dentro da transação de quem mudou): versão nova e hora da mudança; o ETag do GET loja muda junto. */
function gc_loja_mudou(): void
{
    gc_ajuste_definir('loja.versao', (string) ((int) (gc_ajuste('loja.versao') ?? '0') + 1));
    gc_ajuste_definir('loja.atualizado_em', (string) gc_agora());
}

function gc_loja_semeada(): bool
{
    return gc_ajuste('loja.semeada_em') !== null;
}

/** @return array{whatsapp: string, mesmoWhatsappParaTodos: bool, restamAte: int|null, ruaNoStory: bool} */
function gc_loja_ajustes(): array
{
    $restam = gc_ajuste('loja.restam_ate');
    return [
        'whatsapp' => (string) gc_ajuste('loja.whatsapp'),
        'mesmoWhatsappParaTodos' => gc_ajuste('loja.mesmo_whatsapp') === '1',
        'restamAte' => $restam === null || $restam === '' ? null : (int) $restam,
        // a rua do mercador no começo do Início no celular (Stories do Início, no painel); sem o ajuste, ligada
        'ruaNoStory' => gc_ajuste('loja.rua_story') !== '0',
    ];
}

/** @return array{bio: list<string>, fraseStory: string, sacolaVazia: string, falasMercado: list<string>} */
function gc_loja_textos(): array
{
    $t = gc_loja_lido(gc_ajuste('loja.textos'), []);
    return [
        'bio' => array_values(array_map('strval', (array) ($t['bio'] ?? []))),
        'fraseStory' => (string) ($t['fraseStory'] ?? ''),
        'sacolaVazia' => (string) ($t['sacolaVazia'] ?? ''),
        'falasMercado' => array_values(array_map('strval', (array) ($t['falasMercado'] ?? []))),
    ];
}

/** @return array{ligado: bool, girosSemConta: int, girosPorDiaComConta: int, reservaSemContaHoras: int} */
function gc_loja_sorte(): array
{
    $s = gc_loja_lido(gc_ajuste('loja.sorte'), []);
    return [
        'ligado' => (bool) ($s['ligado'] ?? true),
        'girosSemConta' => (int) ($s['girosSemConta'] ?? 1),
        'girosPorDiaComConta' => (int) ($s['girosPorDiaComConta'] ?? 1),
        'reservaSemContaHoras' => (int) ($s['reservaSemContaHoras'] ?? 24),
    ];
}

// ─── semente ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A semente (nucleo/semente-loja.json, gerada de src/dados por scripts/gerar-semente-loja.mjs). @return array<string, mixed> */
function gc_loja_semente(): array
{
    $arq = __DIR__ . '/semente-loja.json';
    $s = is_file($arq) ? json_decode((string) file_get_contents($arq), true) : null;
    if (!is_array($s) || ($s['formato'] ?? null) !== 1) {
        throw new RuntimeException('semente da loja ausente ou torta (nucleo/semente-loja.json)');
    }
    return $s;
}

/** Reais da semente (149.9) em centavos. */
function gc_loja_centavos_semente(mixed $v): ?int
{
    return $v === null ? null : (int) round((float) $v * 100);
}

/**
 * Semeia a loja num banco que ainda não tem (instalação do painel, ou a migração 101 num banco já instalado). Recebe o
 * PDO (roda também dentro da migração, com a conexão ainda abrindo); quem chama segura a trava. A semente é de
 * confiança (sai do repositório); o scripts/testar-api.mjs confere que cada coisa dela passa nas regras do painel.
 * @param array<string, mixed> $s
 */
function gc_loja_semear(PDO $db, array $s): void
{
    $ja = $db->prepare('SELECT 1 FROM ajustes WHERE chave = ?');
    $ja->execute(['loja.semeada_em']);
    if ($ja->fetchColumn() !== false) {
        return;
    }
    $agora = gc_agora();
    $ajuste = $db->prepare(
        'INSERT INTO ajustes (chave, valor, atualizado_em) VALUES (?, ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em',
    );
    $categoria = $db->prepare('INSERT INTO loja_categorias (id, nome, curto, icone, bebida, ordem, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    foreach (array_values($s['categorias']) as $i => $c) {
        $categoria->execute([$c['id'], $c['nome'], $c['curto'], $c['icone'], !empty($c['bebida']) ? 1 : 0, $i, $agora, $agora]);
    }
    $produto = $db->prepare(
        'INSERT INTO loja_produtos (id, nome, tamanho, detalhe, descricao, categoria_id, preco, combos, variacoes, combina_com, foto, cor, arte, obs, ativo, demo, ordem, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)',
    );
    $porUf = $db->prepare('INSERT INTO loja_produto_estados (produto_id, uf, disponivel, estoque, atualizado_em) VALUES (?, ?, ?, NULL, ?)');
    foreach (array_values($s['produtos']) as $i => $p) {
        $combos = array_map(static fn (array $c): array => ['qtd' => (int) $c['qtd'], 'total' => gc_loja_centavos_semente($c['total'])], $p['combos'] ?? []);
        $variacoes = array_map(
            static fn (array $v): array => ['id' => (string) $v['id'], 'nome' => (string) $v['nome']] + (isset($v['preco']) ? ['preco' => gc_loja_centavos_semente($v['preco'])] : []),
            $p['variacoes'] ?? [],
        );
        $produto->execute([
            $p['id'], $p['nome'], $p['tamanho'] ?? '', $p['detalhe'] ?? '', $p['descricao'] ?? '', $p['categoria'],
            gc_loja_centavos_semente($p['preco'] ?? null), gc_loja_json($combos), gc_loja_json($variacoes), gc_loja_json(array_values($p['combinaCom'] ?? [])),
            $p['foto'] ?? null, $p['cor'], gc_loja_json($p['arte']), $p['obs'] ?? '', !empty($p['demo']) ? 1 : 0, $i, $agora, $agora,
        ]);
        foreach ((array) ($p['disponivel'] ?? []) as $uf => $sim) {
            $porUf->execute([$p['id'], $uf, $sim ? 1 : 0, $agora]);
        }
    }
    $estado = $db->prepare(
        'INSERT INTO loja_estados (uf, ativo, destaque, nome_perfil, instagram, whatsapp, cidades, horario, horario_demo, taxa, taxa_demo,
           entrega_gratis, entrega_gratis_demo, pagamentos, pagamentos_demo, emblema, ordem, criado_em, atualizado_em)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    foreach (array_values($s['estados']) as $i => $e) {
        $gratis = $e['entregaGratis'] ?? null;
        $estado->execute([
            $e['uf'], $e['destaque'], $e['nomePerfil'] ?? null, $e['instagram'], $e['whatsapp'] ?? null, gc_loja_json($e['cidades'] ?? []),
            gc_loja_json($e['horario']['semana']), !empty($e['horario']['demo']) ? 1 : 0,
            gc_loja_centavos_semente($e['taxaEntrega']['valor'] ?? null), !empty($e['taxaEntrega']['demo']) ? 1 : 0,
            $gratis === null ? null : gc_loja_json(['dias' => array_values($gratis['dias']), 'texto' => $gratis['texto']]), !empty($gratis['demo']) ? 1 : 0,
            gc_loja_json(array_values($e['pagamento']['opcoes'])), !empty($e['pagamento']['demo']) ? 1 : 0,
            $e['emblema'] ?? 'generico', $i, $agora, $agora,
        ]);
    }
    $story = $db->prepare('INSERT INTO loja_stories (uf, produto_id, posicao) VALUES (?, ?, ?)');
    foreach ((array) ($s['stories'] ?? []) as $uf => $ids) {
        foreach (array_values($ids) as $i => $id) {
            $story->execute([$uf, $id, $i]);
        }
    }
    $premio = $db->prepare(
        'INSERT INTO loja_premios (id, tipo, valor, titulo, descricao, regra, aplica_a, como_usar, peso, validade_dias, ativo, demo, ordem, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)',
    );
    foreach (array_values($s['sorte']['premios']) as $i => $p) {
        $premio->execute([
            $p['id'], $p['tipo'], gc_loja_json($p['valor']), $p['titulo'], $p['descricao'], $p['regra'], gc_loja_json($p['aplicaA']),
            $p['comoUsar'] ?? '', (int) $p['peso'], (int) $p['validadeDias'], !empty($p['demo']) ? 1 : 0, $i, $agora, $agora,
        ]);
    }
    $a = $s['ajustes'];
    $sorte = ['ligado' => (bool) ($s['sorte']['ligado'] ?? true)] + $s['sorte']['regras'];
    foreach ([
        'loja.whatsapp' => (string) $a['whatsapp'],
        'loja.mesmo_whatsapp' => !empty($a['mesmoWhatsappParaTodos']) ? '1' : '0',
        'loja.restam_ate' => $a['restamAte'] === null ? '' : (string) (int) $a['restamAte'],
        'loja.textos' => gc_loja_json($s['textos']),
        'loja.sorte' => gc_loja_json($sorte),
        'loja.versao' => '1',
        'loja.atualizado_em' => (string) $agora,
        'loja.semeada_em' => (string) $agora,
    ] as $chave => $valor) {
        $ajuste->execute([$chave, $valor, $agora]);
    }
    $db->prepare("INSERT INTO eventos (em, usuario_id, origem, acao, alvo, detalhe) VALUES (?, NULL, 'sistema', 'loja-semeada', 'loja', ?)")
        ->execute([$agora, gc_loja_json(['produtos' => count($s['produtos']), 'estados' => count($s['estados']), 'premios' => count($s['sorte']['premios'])])]);
}

// ─── leitura ────────────────────────────────────────────────────────────────────────────────────────────────────

/** @return list<array<string, mixed>> */
function gc_loja_linhas_categorias(): array
{
    return gc_todos('SELECT * FROM loja_categorias ORDER BY ordem, id');
}

/** @return list<array<string, mixed>> */
function gc_loja_linhas_produtos(bool $soAtivos = false): array
{
    return gc_todos('SELECT * FROM loja_produtos' . ($soAtivos ? ' WHERE ativo = 1' : '') . ' ORDER BY ordem, id');
}

/** @return list<array<string, mixed>> */
function gc_loja_linhas_estados(bool $soAtivos = false): array
{
    return gc_todos('SELECT * FROM loja_estados' . ($soAtivos ? ' WHERE ativo = 1' : '') . ' ORDER BY ordem, uf');
}

/** @return list<array<string, mixed>> */
function gc_loja_linhas_premios(): array
{
    return gc_todos('SELECT * FROM loja_premios ORDER BY ordem, id');
}

/**
 * Disponível e estoque de cada produto em cada estado (só as linhas que existem).
 * @return array<string, array<string, array{disponivel: bool, estoque: int|null}>>
 */
function gc_loja_por_uf(?string $produtoId = null): array
{
    $linhas = $produtoId === null
        ? gc_todos('SELECT produto_id, uf, disponivel, estoque FROM loja_produto_estados')
        : gc_todos('SELECT produto_id, uf, disponivel, estoque FROM loja_produto_estados WHERE produto_id = ?', [$produtoId]);
    $out = [];
    foreach ($linhas as $l) {
        $out[(string) $l['produto_id']][(string) $l['uf']] = ['disponivel' => (bool) $l['disponivel'], 'estoque' => $l['estoque'] === null ? null : (int) $l['estoque']];
    }
    return $out;
}

/** Aparece como disponível no site: ligado no estado e, com estoque contado, pelo menos 1 (0 = esgotado sozinho). */
function gc_loja_vende(?array $e): bool
{
    return $e !== null && $e['disponivel'] && ($e['estoque'] === null || $e['estoque'] > 0);
}

/** @return list<array{qtd: int, total: int}> */
function gc_loja_combos(array $p): array
{
    return array_values(array_filter((array) gc_loja_lido($p['combos'], []), 'is_array'));
}

/** @return list<array{id: string, nome: string, preco?: int}> */
function gc_loja_variacoes(array $p): array
{
    return array_values(array_filter((array) gc_loja_lido($p['variacoes'], []), 'is_array'));
}

function gc_loja_categoria_publica(array $c): array
{
    return ['id' => (string) $c['id'], 'nome' => (string) $c['nome'], 'curto' => (string) $c['curto'], 'icone' => (string) $c['icone'], 'bebida' => (bool) $c['bebida']];
}

/**
 * O Produto do site (src/lib/tipos.ts): campo vazio fica de fora, como no catalogo.json; disponivel por estado ativo
 * (ligado e com estoque, quando contado) e restam (só os estados com 1 a restamAte unidades).
 * @param array<string, array{disponivel: bool, estoque: int|null}> $porUf
 * @param list<string> $ufs estados ativos
 * @param array<string, true> $ativos ids dos produtos no site (o combinaCom só aponta pra eles)
 */
function gc_loja_produto_publico(array $p, array $porUf, array $ufs, ?int $restamAte, array $ativos): array
{
    $disponivel = [];
    $restam = [];
    foreach ($ufs as $uf) {
        $e = $porUf[$uf] ?? null;
        $vende = gc_loja_vende($e);
        $disponivel[$uf] = $vende;
        if ($vende && $e['estoque'] !== null && $restamAte !== null && $e['estoque'] <= $restamAte) {
            $restam[$uf] = $e['estoque'];
        }
    }
    $out = ['id' => (string) $p['id'], 'nome' => (string) $p['nome']];
    foreach (['tamanho', 'detalhe', 'descricao'] as $k) {
        if ((string) $p[$k] !== '') {
            $out[$k] = (string) $p[$k];
        }
    }
    $out['categoria'] = (string) $p['categoria_id'];
    $out['preco'] = $p['preco'] === null ? null : gc_reais((int) $p['preco']);
    $combos = gc_loja_combos($p);
    if ($combos !== []) {
        $out['combos'] = array_map(static fn (array $c): array => ['qtd' => (int) $c['qtd'], 'total' => gc_reais((int) $c['total'])], $combos);
    }
    $variacoes = gc_loja_variacoes($p);
    if ($variacoes !== []) {
        $out['variacoes'] = array_map(
            static fn (array $v): array => ['id' => (string) $v['id'], 'nome' => (string) $v['nome']] + (isset($v['preco']) ? ['preco' => gc_reais((int) $v['preco'])] : []),
            $variacoes,
        );
    }
    $out['disponivel'] = gc_loja_mapa($disponivel);
    $out['restam'] = gc_loja_mapa($restam);
    $combina = array_values(array_filter((array) gc_loja_lido($p['combina_com'], []), static fn ($id): bool => is_string($id) && isset($ativos[$id])));
    if ($combina !== []) {
        $out['combinaCom'] = $combina;
    }
    $out['demo'] = (bool) $p['demo'];
    $out['foto'] = $p['foto'] === null ? null : (string) $p['foto'];
    $out['cor'] = (string) $p['cor'];
    $out['arte'] = gc_loja_lido($p['arte'], ['tipo' => 'lata', 'corpo' => (string) $p['cor']]);
    return $out;
}

/** Entrega grátis guardada: { dias, texto } ou null. */
function gc_loja_entrega_gratis(array $e): ?array
{
    $g = gc_loja_lido($e['entrega_gratis'], null);
    return is_array($g) && isset($g['dias'], $g['texto']) ? ['dias' => array_values(array_map('intval', (array) $g['dias'])), 'texto' => (string) $g['texto']] : null;
}

/**
 * O Canal do site (src/dados/canais.ts). whatsapp: null = o da loja (sempre null com "o mesmo pra todos" ligado).
 * entregaGratis traz os dias (a lista) e, pro site de antes, diaSemana (o primeiro).
 */
function gc_loja_estado_publico(array $e, bool $mesmoParaTodos): array
{
    $gratis = gc_loja_entrega_gratis($e);
    $semana = gc_loja_lido($e['horario'], []);
    return [
        'uf' => (string) $e['uf'],
        'nome' => GC_LOJA_NOMES_UF[(string) $e['uf']] ?? strtoupper((string) $e['uf']),
        'destaque' => (string) $e['destaque'],
        'nomePerfil' => $e['nome_perfil'] === null ? null : (string) $e['nome_perfil'],
        'cidades' => array_values((array) gc_loja_lido($e['cidades'], [])),
        'instagram' => (string) $e['instagram'],
        'whatsapp' => $mesmoParaTodos || $e['whatsapp'] === null ? null : (string) $e['whatsapp'],
        'horario' => ['semana' => is_array($semana) && count($semana) === 7 ? array_values($semana) : array_fill(0, 7, null), 'demo' => (bool) $e['horario_demo']],
        'taxaEntrega' => ['valor' => $e['taxa'] === null ? null : gc_reais((int) $e['taxa']), 'demo' => (bool) $e['taxa_demo']],
        'entregaGratis' => $gratis === null ? null : ['diaSemana' => $gratis['dias'][0] ?? 0, 'dias' => $gratis['dias'], 'texto' => $gratis['texto'], 'demo' => (bool) $e['entrega_gratis_demo']],
        'pagamento' => ['opcoes' => array_values((array) gc_loja_lido($e['pagamentos'], [])), 'demo' => (bool) $e['pagamentos_demo']],
        'emblema' => (string) $e['emblema'],
    ];
}

/** O Premio do site (src/dados/sorte.ts). */
function gc_loja_premio_publico(array $p): array
{
    $out = [
        'id' => (string) $p['id'],
        'tipo' => (string) $p['tipo'],
        'valor' => gc_loja_lido($p['valor'], null),
        'titulo' => (string) $p['titulo'],
        'descricao' => (string) $p['descricao'],
        'regra' => (string) $p['regra'],
        'aplicaA' => gc_loja_mapa((array) gc_loja_lido($p['aplica_a'], [])),
    ];
    if ((string) $p['como_usar'] !== '') {
        $out['comoUsar'] = (string) $p['como_usar'];
    }
    return $out + ['peso' => (int) $p['peso'], 'validadeDias' => (int) $p['validade_dias'], 'demo' => (bool) $p['demo']];
}

/**
 * Produtos e categorias que um prêmio cita (aplicaA e o brinde).
 * @return array{produtos: list<string>, categorias: list<string>}
 */
function gc_loja_alvos_do_premio(array $p): array
{
    $a = (array) gc_loja_lido($p['aplica_a'], []);
    $v = gc_loja_lido($p['valor'], null);
    $produtos = array_values(array_filter((array) ($a['produtos'] ?? []), 'is_string'));
    if ($p['tipo'] === 'brinde' && is_array($v) && is_string($v['produto'] ?? null)) {
        $produtos[] = $v['produto'];
    }
    return ['produtos' => array_values(array_unique($produtos)), 'categorias' => array_values(array_filter((array) ($a['categorias'] ?? []), 'is_string'))];
}

/**
 * O que decide se um prêmio vale no site: os produtos no ar, as categorias e o que é bebida (categoria marcada, ou
 * produto com nome de bebida alcoólica).
 * @param list<array<string, mixed>> $produtos linhas de loja_produtos
 * @param list<array<string, mixed>> $categorias linhas de loja_categorias
 * @return array{ativos: array<string, true>, categorias: array<string, true>, bebidas: array<string, true>, categoriasBebida: array<string, true>}
 */
function gc_loja_contexto_premios(array $produtos, array $categorias): array
{
    $ctx = ['ativos' => [], 'categorias' => [], 'bebidas' => [], 'categoriasBebida' => []];
    foreach ($categorias as $c) {
        $ctx['categorias'][(string) $c['id']] = true;
        if ((int) $c['bebida'] === 1) {
            $ctx['categoriasBebida'][(string) $c['id']] = true;
        }
    }
    foreach ($produtos as $p) {
        if ((int) $p['ativo'] === 1) {
            $ctx['ativos'][(string) $p['id']] = true;
        }
        if (isset($ctx['categoriasBebida'][(string) $p['categoria_id']]) || gc_loja_parece_alcool((string) $p['nome'])) {
            $ctx['bebidas'][(string) $p['id']] = true;
        }
    }
    return $ctx;
}

/**
 * O prêmio vale no site agora? Ligado, com tudo que ele cita no ar (produto desativado ou categoria apagada tiram ele
 * do jogo) e nada de bebida: as rotas já recusam, e isto segura o que mudou depois (um produto que foi pra uma
 * categoria de bebida, uma categoria que virou bebida).
 * @param array{ativos: array<string, true>, categorias: array<string, true>, bebidas: array<string, true>, categoriasBebida: array<string, true>} $ctx
 */
function gc_loja_premio_no_site(array $p, array $ctx): bool
{
    if (!(bool) $p['ativo']) {
        return false;
    }
    $alvos = gc_loja_alvos_do_premio($p);
    foreach ($alvos['produtos'] as $id) {
        if (!isset($ctx['ativos'][$id]) || isset($ctx['bebidas'][$id])) {
            return false;
        }
    }
    foreach ($alvos['categorias'] as $id) {
        if (!isset($ctx['categorias'][$id]) || isset($ctx['categoriasBebida'][$id])) {
            return false;
        }
    }
    return true;
}

/** A loja inteira, do jeito que o site lê (sem nada que seja só do dono). @return array<string, mixed> */
function gc_loja_publica(): array
{
    $ajustes = gc_loja_ajustes();
    $estados = gc_loja_linhas_estados(true);
    $ufs = array_map(static fn (array $e): string => (string) $e['uf'], $estados);
    $produtos = gc_loja_linhas_produtos(true);
    $ativos = array_fill_keys(array_map(static fn (array $p): string => (string) $p['id'], $produtos), true);
    $categorias = gc_loja_linhas_categorias();
    $porUf = gc_loja_por_uf();
    // o story que passa agora: os escolhidos que estão à venda no estado, na ordem do dono (até as 8 barrinhas);
    // nenhum à venda (ou lista vazia) = o estado fica de fora e o site faz o automático
    $stories = [];
    foreach (gc_todos('SELECT uf, produto_id FROM loja_stories ORDER BY uf, posicao') as $s) {
        $uf = (string) $s['uf'];
        $id = (string) $s['produto_id'];
        if (in_array($uf, $ufs, true) && isset($ativos[$id]) && gc_loja_vende($porUf[$id][$uf] ?? null) && count($stories[$uf] ?? []) < GC_LOJA_STORIES_MAX) {
            $stories[$uf][] = $id;
        }
    }
    $sorte = gc_loja_sorte();
    $ctx = gc_loja_contexto_premios($produtos, $categorias);
    $premios = [];
    foreach (gc_loja_linhas_premios() as $p) {
        if (gc_loja_premio_no_site($p, $ctx)) {
            $premios[] = gc_loja_premio_publico($p);
        }
    }
    return [
        'whatsapp' => $ajustes['whatsapp'],
        'restamAte' => $ajustes['restamAte'],
        'ruaNoStory' => $ajustes['ruaNoStory'],
        'textos' => gc_loja_textos(),
        'categorias' => array_map('gc_loja_categoria_publica', $categorias),
        'produtos' => array_map(static fn (array $p): array => gc_loja_produto_publico($p, $porUf[$p['id']] ?? [], $ufs, $ajustes['restamAte'], $ativos), $produtos),
        'estados' => array_map(static fn (array $e): array => gc_loja_estado_publico($e, $ajustes['mesmoWhatsappParaTodos']), $estados),
        'stories' => gc_loja_mapa($stories),
        'sorte' => [
            'ligado' => $sorte['ligado'],
            'regras' => ['girosSemConta' => $sorte['girosSemConta'], 'girosPorDiaComConta' => $sorte['girosPorDiaComConta'], 'reservaSemContaHoras' => $sorte['reservaSemContaHoras']],
            'premios' => $premios,
        ],
    ];
}

/** If-None-Match bate com o ETag? Aceita W/, lista e o sufixo que o compressor do servidor põe ("…-gzip"). */
function gc_loja_etag_bate(string $pedido, string $etag): bool
{
    foreach (explode(',', $pedido) as $e) {
        $e = trim($e);
        if ($e === '*') {
            return true;
        }
        $e = (string) preg_replace(['#^W/#', '/-(?:gzip|br|zstd|deflate)"$/'], ['', '"'], $e);
        if (hash_equals($etag, $e)) {
            return true;
        }
    }
    return false;
}

/**
 * GET loja: a loja inteira num JSON só, com ETag (o mesmo conteúdo, o mesmo ETag) e Cache-Control no-cache: o
 * navegador guarda, pergunta de novo com If-None-Match e recebe 304 sem corpo quando nada mudou.
 * Antes da loja existir no servidor (painel ainda não instalado): 404 sem-loja, e o site segue com o que tem embutido.
 */
function gc_rota_loja(): array
{
    if (!gc_loja_semeada()) {
        throw new ErroApi('sem-loja', 'A loja ainda não foi montada no servidor.', 404);
    }
    $corpo = [
        'ok' => true,
        'versao' => (int) gc_ajuste('loja.versao'),
        'atualizadoEm' => gc_iso((int) gc_ajuste('loja.atualizado_em')),
        'loja' => gc_loja_publica(),
    ];
    $json = json_encode($corpo, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    $etag = '"' . substr(hash('sha256', (string) $json), 0, 32) . '"';
    gc_cabecalhos();
    header('Cache-Control: no-cache');
    header('ETag: ' . $etag);
    $pedido = $_SERVER['HTTP_IF_NONE_MATCH'] ?? '';
    if (is_string($pedido) && $pedido !== '' && gc_loja_etag_bate($pedido, $etag)) {
        http_response_code(304);
        header_remove('Content-Type');
        exit;
    }
    http_response_code(200);
    echo $json;
    exit;
}

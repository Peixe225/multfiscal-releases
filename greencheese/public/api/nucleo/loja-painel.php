<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Rotas do painel pra loja (admin-loja, admin-produto-*, admin-categoria-*, admin-estado-salvar, admin-stories-salvar,
// admin-premio-*…): todas exigem o dono (sessão, Origin e X-CSRF nos POST), escrevem dentro de gc_transacao, sobem a
// versão da loja (o site vê na hora) e vão pra auditoria. O que tem histórico (rateio ou prêmio que cita o produto) não
// apaga: desativa. Contrato no API.md, seção "Loja (painel)".

// ─── leitura do painel ──────────────────────────────────────────────────────────────────────────────────────────

function gc_loja_exigir_semeada(): void
{
    if (!gc_loja_semeada()) {
        // painel instalado sem loja (a instalação e a migração 101 semeiam; isto é só a rede)
        gc_transacao(static function (PDO $db): void {
            gc_loja_semear($db, gc_loja_semente());
        });
    }
}

/**
 * Onde o produto aparece além do site: rateios e prêmios que citam ele (o histórico que impede apagar).
 * @return array<string, array{rateios: list<array<string, mixed>>, premios: list<array<string, mixed>>}>
 */
function gc_loja_usos(): array
{
    $out = [];
    foreach (gc_todos('SELECT id, titulo, status, demo, produto_id FROM rateios WHERE produto_id IS NOT NULL ORDER BY criado_em') as $r) {
        $out[(string) $r['produto_id']]['rateios'][] = ['id' => (string) $r['id'], 'titulo' => (string) $r['titulo'], 'demo' => (bool) $r['demo']];
    }
    foreach (gc_loja_linhas_premios() as $p) {
        foreach (gc_loja_alvos_do_premio($p)['produtos'] as $id) {
            $out[$id]['premios'][] = ['id' => (string) $p['id'], 'titulo' => (string) $p['titulo']];
        }
    }
    return $out;
}

/** O produto no painel: tudo dele, com o estado a estado cru (ligado e estoque) e onde ele é usado. */
function gc_loja_produto_admin(array $p, array $porUf, array $uso): array
{
    $rateios = $uso['rateios'] ?? [];
    $premios = $uso['premios'] ?? [];
    return [
        'id' => (string) $p['id'],
        'nome' => (string) $p['nome'],
        'tamanho' => (string) $p['tamanho'],
        'detalhe' => (string) $p['detalhe'],
        'descricao' => (string) $p['descricao'],
        'categoria' => (string) $p['categoria_id'],
        'preco' => $p['preco'] === null ? null : gc_reais((int) $p['preco']),
        'combos' => array_map(static fn (array $c): array => ['qtd' => (int) $c['qtd'], 'total' => gc_reais((int) $c['total'])], gc_loja_combos($p)),
        'variacoes' => array_map(
            static fn (array $v): array => ['id' => (string) $v['id'], 'nome' => (string) $v['nome'], 'preco' => isset($v['preco']) ? gc_reais((int) $v['preco']) : null],
            gc_loja_variacoes($p),
        ),
        'combinaCom' => array_values(array_filter((array) gc_loja_lido($p['combina_com'], []), 'is_string')),
        'foto' => $p['foto'] === null ? null : (string) $p['foto'],
        'cor' => (string) $p['cor'],
        'arte' => gc_loja_lido($p['arte'], ['tipo' => 'lata', 'corpo' => (string) $p['cor']]),
        'obs' => (string) $p['obs'],
        'ativo' => (bool) $p['ativo'],
        'demo' => (bool) $p['demo'],
        'ordem' => (int) $p['ordem'],
        'estados' => gc_loja_mapa($porUf),
        'uso' => ['rateios' => $rateios, 'premios' => $premios],
        'podeApagar' => $rateios === [] && $premios === [],
        'criadoEm' => gc_iso((int) $p['criado_em']),
        'atualizadoEm' => gc_iso((int) $p['atualizado_em']),
    ];
}

function gc_loja_estado_admin(array $e): array
{
    $gratis = gc_loja_entrega_gratis($e);
    $publico = gc_loja_estado_publico($e, false);
    return [
        'uf' => $publico['uf'],
        'nome' => $publico['nome'],
        'ativo' => (bool) $e['ativo'],
        'destaque' => $publico['destaque'],
        'nomePerfil' => $publico['nomePerfil'],
        'instagram' => $publico['instagram'],
        'whatsapp' => $e['whatsapp'] === null ? null : (string) $e['whatsapp'],
        'cidades' => $publico['cidades'],
        'horario' => $publico['horario'],
        'taxaEntrega' => $publico['taxaEntrega'],
        'entregaGratis' => $gratis === null ? null : $gratis + ['demo' => (bool) $e['entrega_gratis_demo']],
        'pagamento' => $publico['pagamento'],
        'emblema' => $publico['emblema'],
        'ordem' => (int) $e['ordem'],
        'atualizadoEm' => gc_iso((int) $e['atualizado_em']),
    ];
}

/** A loja inteira pro painel: o que o site vê e o que é só do dono (desativados, estoque, anotações, usos). */
function gc_loja_admin(): array
{
    $categorias = gc_loja_linhas_categorias();
    $produtos = gc_loja_linhas_produtos();
    $premios = gc_loja_linhas_premios();
    $porUf = gc_loja_por_uf();
    $usos = gc_loja_usos();
    $contaCategoria = [];
    foreach ($produtos as $p) {
        $contaCategoria[(string) $p['categoria_id']] = ($contaCategoria[(string) $p['categoria_id']] ?? 0) + 1;
    }
    $premiosDaCategoria = [];
    foreach ($premios as $p) {
        foreach (gc_loja_alvos_do_premio($p)['categorias'] as $id) {
            $premiosDaCategoria[$id][] = ['id' => (string) $p['id'], 'titulo' => (string) $p['titulo']];
        }
    }
    $ctx = gc_loja_contexto_premios($produtos, $categorias);
    $stories = [];
    foreach (gc_todos('SELECT uf, produto_id FROM loja_stories ORDER BY uf, posicao') as $s) {
        $stories[(string) $s['uf']][] = (string) $s['produto_id'];
    }
    return [
        'versao' => (int) gc_ajuste('loja.versao'),
        'atualizadoEm' => gc_iso((int) gc_ajuste('loja.atualizado_em')),
        'ajustes' => gc_loja_ajustes(),
        'textos' => gc_loja_textos(),
        'categorias' => array_map(
            static fn (array $c): array => gc_loja_categoria_publica($c) + [
                'ordem' => (int) $c['ordem'],
                'produtos' => $contaCategoria[(string) $c['id']] ?? 0,
                'premios' => $premiosDaCategoria[(string) $c['id']] ?? [],
            ],
            $categorias,
        ),
        'produtos' => array_map(static fn (array $p): array => gc_loja_produto_admin($p, $porUf[$p['id']] ?? [], $usos[$p['id']] ?? []), $produtos),
        'estados' => array_map('gc_loja_estado_admin', gc_loja_linhas_estados()),
        'stories' => gc_loja_mapa($stories),
        'sorte' => gc_loja_sorte() + [
            'premios' => array_map(
                static fn (array $p): array => gc_loja_premio_publico($p) + [
                    'ativo' => (bool) $p['ativo'],
                    'ordem' => (int) $p['ordem'],
                    'noSite' => gc_loja_premio_no_site($p, $ctx),
                    'atualizadoEm' => gc_iso((int) $p['atualizado_em']),
                ],
                $premios,
            ),
        ],
    ];
}

/** GET admin-loja: a loja inteira do painel (uma leitura só pras telas da loja). */
function gc_rota_admin_loja(): array
{
    gc_exigir_dono();
    gc_loja_exigir_semeada();
    return ['loja' => gc_loja_admin()];
}

/** O que muda depois de uma escrita (as telas trocam só o pedaço e a versão). */
function gc_loja_carimbo(): array
{
    return ['versao' => (int) gc_ajuste('loja.versao'), 'atualizadoEm' => gc_iso((int) gc_ajuste('loja.atualizado_em'))];
}

/** @return array<string, mixed> */
function gc_loja_produto_ou_404(mixed $id): array
{
    $p = gc_id_valido($id) ? gc_um('SELECT * FROM loja_produtos WHERE id = ?', [$id]) : null;
    if ($p === null) {
        throw new ErroApi('nao-encontrado', 'Produto não encontrado.', 404);
    }
    return $p;
}

function gc_loja_produto_admin_por_id(string $id): array
{
    return gc_loja_produto_admin((array) gc_um('SELECT * FROM loja_produtos WHERE id = ?', [$id]), gc_loja_por_uf($id)[$id] ?? [], gc_loja_usos()[$id] ?? []);
}

/** Colunas que mudaram (pra auditoria e pra não escrever à toa). @return list<string> */
function gc_loja_mudancas(array $col, ?array $atual): array
{
    if ($atual === null) {
        return array_keys($col);
    }
    return array_values(array_keys(array_filter($col, static fn ($v, $k): bool => (string) $v !== (string) ($atual[$k] ?? ''), ARRAY_FILTER_USE_BOTH)));
}

/**
 * Produto que é prêmio (ou brinde) do Teste minha sorte não vira bebida: nem indo pra uma categoria de bebida, nem
 * com nome de bebida alcoólica, nem com desenho de bebida. Álcool nunca em prêmio.
 * @param array<string, mixed> $col
 */
function gc_loja_conferir_premios_do_produto(string $id, array $col): void
{
    $premios = gc_loja_usos()[$id]['premios'] ?? [];
    if ($premios === []) {
        return;
    }
    $nome = '“' . $premios[0]['titulo'] . '”';
    if ((int) gc_valor('SELECT bebida FROM loja_categorias WHERE id = ?', [$col['categoria_id']]) === 1) {
        throw gc_invalido('categoria', "Esse produto é do prêmio $nome do Teste minha sorte, e bebida não entra em prêmio. Muda o prêmio antes.");
    }
    if (gc_loja_parece_alcool((string) $col['nome'])) {
        throw gc_invalido('nome', "Esse produto é do prêmio $nome do Teste minha sorte, e bebida não entra em prêmio. Muda o prêmio antes.");
    }
    if (gc_loja_bebida_pelo_produto('', $col['arte'])) {
        throw gc_invalido('arte', "Esse produto é do prêmio $nome do Teste minha sorte, e desenho de bebida não entra em prêmio. Muda o prêmio antes.");
    }
}

/** Grava disponível e estoque de um produto nos estados que vieram. @param array<string, array{disponivel: bool, estoque: int|null}> $estados @return list<string> ufs que mudaram */
function gc_loja_gravar_por_uf(string $id, array $estados): array
{
    $antes = gc_loja_por_uf($id)[$id] ?? [];
    $mudou = [];
    foreach ($estados as $uf => $e) {
        // sem linha = desligado e sem contar: só grava o que muda alguma coisa
        $a = $antes[$uf] ?? ['disponivel' => false, 'estoque' => null];
        if ($a['disponivel'] === $e['disponivel'] && $a['estoque'] === $e['estoque']) {
            continue;
        }
        gc_sql(
            'INSERT INTO loja_produto_estados (produto_id, uf, disponivel, estoque, atualizado_em) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(produto_id, uf) DO UPDATE SET disponivel = excluded.disponivel, estoque = excluded.estoque, atualizado_em = excluded.atualizado_em',
            [$id, $uf, $e['disponivel'] ? 1 : 0, $e['estoque'], gc_agora()],
        );
        $mudou[] = $uf;
    }
    return $mudou;
}

// ─── produtos ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * POST admin-produto-salvar: sem id cria (id = slug do nome + tamanho, único; entra no fim da lista), com id edita
 * (campo ausente fica como está). estados (opcional): { uf: { disponivel, estoque } } dos estados da loja.
 */
function gc_rota_admin_produto_salvar(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    gc_loja_exigir_semeada();
    return gc_transacao(static function () use ($c): array {
        $agora = gc_agora();
        $estados = array_key_exists('estados', $c) ? gc_loja_ler_por_uf($c['estados']) : [];
        if (isset($c['id']) && $c['id'] !== '' && $c['id'] !== null) {
            $atual = gc_loja_produto_ou_404($c['id']);
            $id = (string) $atual['id'];
            $col = gc_loja_ler_produto($c, $atual);
            gc_loja_conferir_premios_do_produto($id, $col);
            $mudou = gc_loja_mudancas($col, $atual);
            if ($mudou !== []) {
                $sets = implode(', ', array_map(static fn (string $k): string => "$k = ?", array_keys($col)));
                gc_sql("UPDATE loja_produtos SET $sets, atualizado_em = ? WHERE id = ?", [...array_values($col), $agora, $id]);
            }
            $ufs = gc_loja_gravar_por_uf($id, $estados);
            if ($mudou !== [] || $ufs !== []) {
                gc_loja_mudou();
                $acao = $mudou === ['ativo'] && $ufs === [] ? ($col['ativo'] ? 'produto-ativado' : 'produto-desativado') : 'produto-editado';
                gc_evento('painel', $acao, 'produto:' . $id, ['nome' => $col['nome'], 'campos' => $mudou, 'ufs' => $ufs]);
            }
            return ['produto' => gc_loja_produto_admin_por_id($id)] + gc_loja_carimbo();
        }
        $col = gc_loja_ler_produto($c, null);
        $id = gc_loja_id_livre(gc_loja_slug(trim($col['nome'] . ' ' . $col['tamanho']), 'produto'), 'loja_produtos');
        $col = ['id' => $id] + $col + [
            'ordem' => (int) gc_valor('SELECT COALESCE(MAX(ordem), -1) + 1 FROM loja_produtos'),
            'criado_em' => $agora,
            'atualizado_em' => $agora,
        ];
        $nomes = implode(', ', array_keys($col));
        $marcas = implode(', ', array_fill(0, count($col), '?'));
        gc_sql("INSERT INTO loja_produtos ($nomes) VALUES ($marcas)", array_values($col));
        gc_loja_gravar_por_uf($id, $estados);
        gc_loja_mudou();
        gc_evento('painel', 'produto-criado', 'produto:' . $id, ['nome' => $col['nome']]);
        return ['_status' => 201, 'produto' => gc_loja_produto_admin_por_id($id)] + gc_loja_carimbo();
    });
}

/**
 * POST admin-produto-estado { id, uf, disponivel?, estoque? }: a troca rápida (um toque no celular). Manda o valor
 * novo, não "inverter": dois toques iguais dão no mesmo. estoque null = não contar; 0 = esgotado (sai sozinho do
 * disponível e volta quando o estoque subir, se o produto seguir ligado no estado).
 */
function gc_rota_admin_produto_estado(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    gc_loja_exigir_semeada();
    return gc_transacao(static function () use ($c): array {
        $p = gc_loja_produto_ou_404($c['id'] ?? null);
        $id = (string) $p['id'];
        $uf = gc_uf($c['uf'] ?? null);
        if ($uf === null || gc_um('SELECT 1 FROM loja_estados WHERE uf = ?', [$uf]) === null) {
            throw gc_invalido('uf', 'Estado que a loja não atende.');
        }
        // o gerente só mexe nos estados dele (o dono, em todos)
        if (function_exists('gc_exigir_uf')) {
            gc_exigir_uf($uf, 'Esse estoque');
        }
        $antes = gc_loja_por_uf($id)[$id][$uf] ?? ['disponivel' => false, 'estoque' => null];
        $novo = $antes;
        if (array_key_exists('disponivel', $c)) {
            $novo['disponivel'] = gc_loja_bool($c, 'disponivel', 'Disponível é sim ou não.');
        }
        if (array_key_exists('estoque', $c)) {
            $novo['estoque'] = $c['estoque'] === null ? null : (gc_inteiro($c['estoque'], 0, 99999) ?? throw gc_invalido('estoque', 'Estoque de 0 a 99.999 unidades (ou sem contar).'));
        }
        if (gc_loja_gravar_por_uf($id, [$uf => $novo]) !== []) {
            gc_sql('UPDATE loja_produtos SET atualizado_em = ? WHERE id = ?', [gc_agora(), $id]);
            gc_loja_mudou();
            gc_evento('painel', 'produto-estado', 'produto:' . $id, ['nome' => $p['nome'], 'uf' => $uf, 'antes' => $antes, 'agora' => $novo]);
        }
        return ['produto' => gc_loja_produto_admin_por_id($id)] + gc_loja_carimbo();
    });
}

/** POST admin-produto-apagar { id }: só sem histórico (rateio ou prêmio que cita ele); com histórico, desativa. */
function gc_rota_admin_produto_apagar(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    gc_loja_exigir_semeada();
    return gc_transacao(static function () use ($c): array {
        $p = gc_loja_produto_ou_404($c['id'] ?? null);
        $id = (string) $p['id'];
        $uso = gc_loja_usos()[$id] ?? [];
        if (($uso['rateios'] ?? []) !== [] || ($uso['premios'] ?? []) !== []) {
            $onde = array_merge(
                array_map(static fn (array $r): string => 'rateio “' . $r['titulo'] . '”', $uso['rateios'] ?? []),
                array_map(static fn (array $x): string => 'prêmio “' . $x['titulo'] . '”', $uso['premios'] ?? []),
            );
            throw new ErroApi('em-uso', 'Esse produto tem histórico (' . implode(', ', $onde) . '). Desativa em vez de apagar: ele sai do site e o histórico fica.', 409, [
                'rateios' => $uso['rateios'] ?? [], 'premios' => $uso['premios'] ?? [],
            ]);
        }
        gc_loja_tirar_de_combina($id);
        gc_sql('DELETE FROM loja_produtos WHERE id = ?', [$id]);
        gc_loja_mudou();
        gc_evento('painel', 'produto-apagado', 'produto:' . $id, ['nome' => $p['nome'], 'demo' => (bool) $p['demo']]);
        return gc_loja_carimbo();
    });
}

/** Tira o produto do "Combina com" dos outros (ele vai sair). */
function gc_loja_tirar_de_combina(string $id): void
{
    foreach (gc_todos('SELECT id, combina_com FROM loja_produtos WHERE id <> ?', [$id]) as $o) {
        $lista = (array) gc_loja_lido($o['combina_com'], []);
        if (in_array($id, $lista, true)) {
            gc_sql('UPDATE loja_produtos SET combina_com = ? WHERE id = ?', [gc_loja_json(array_values(array_diff($lista, [$id]))), $o['id']]);
        }
    }
}

/**
 * Ordem nova: os ids que vieram, nessa ordem, primeiro; quem não veio (criado noutro aparelho no meio-tempo) segue
 * depois, na ordem que tinha.
 * @return list<string>
 */
function gc_loja_reordenar(string $tabela, mixed $ids): array
{
    if (!is_array($ids) || !array_is_list($ids) || $ids === [] || count($ids) > 2000) {
        throw gc_invalido('ids', 'A ordem veio torta. Recarrega e tenta de novo.');
    }
    $existentes = array_map(static fn (array $l): string => (string) $l['id'], gc_todos("SELECT id FROM $tabela ORDER BY ordem, id"));
    $ok = array_fill_keys($existentes, true);
    $nova = [];
    foreach ($ids as $id) {
        if (!is_string($id) || !isset($ok[$id]) || isset($nova[$id])) {
            throw gc_invalido('ids', 'A lista mudou em outro aparelho. Recarrega e tenta de novo.');
        }
        $nova[$id] = true;
    }
    $ordem = [...array_keys($nova), ...array_values(array_filter($existentes, static fn (string $id): bool => !isset($nova[$id])))];
    foreach ($ordem as $i => $id) {
        gc_sql("UPDATE $tabela SET ordem = ? WHERE id = ? AND ordem <> ?", [$i, $id, $i]);
    }
    return $ordem;
}

/** POST admin-produtos-ordem { ids }: a ordem da grade do site. */
function gc_rota_admin_produtos_ordem(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    gc_loja_exigir_semeada();
    return gc_transacao(static function () use ($c): array {
        $ordem = gc_loja_reordenar('loja_produtos', $c['ids'] ?? null);
        gc_loja_mudou();
        gc_evento('painel', 'produtos-ordem', 'loja', ['primeiros' => array_slice($ordem, 0, 5)]);
        return ['ordem' => $ordem] + gc_loja_carimbo();
    });
}

// ─── categorias ─────────────────────────────────────────────────────────────────────────────────────────────────

/** POST admin-categoria-salvar { id?, nome, curto, icone, bebida }: sem id cria (id = slug do nome), com id edita. */
function gc_rota_admin_categoria_salvar(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    gc_loja_exigir_semeada();
    return gc_transacao(static function () use ($c): array {
        $agora = gc_agora();
        if (isset($c['id']) && $c['id'] !== '' && $c['id'] !== null) {
            $atual = gc_id_valido($c['id']) ? gc_um('SELECT * FROM loja_categorias WHERE id = ?', [$c['id']]) : null;
            if ($atual === null) {
                throw new ErroApi('nao-encontrado', 'Categoria não encontrada.', 404);
            }
            $col = gc_loja_ler_categoria($c, $atual);
            // virou bebida: nenhum prêmio pode seguir valendo nela (nem nos produtos dela)
            if ($col['bebida'] === 1 && (int) $atual['bebida'] === 0) {
                $daCategoria = array_fill_keys(array_map(static fn (array $l): string => (string) $l['id'], gc_todos('SELECT id FROM loja_produtos WHERE categoria_id = ?', [$atual['id']])), true);
                foreach (gc_loja_linhas_premios() as $premio) {
                    $alvos = gc_loja_alvos_do_premio($premio);
                    if (in_array($atual['id'], $alvos['categorias'], true) || array_intersect_key($daCategoria, array_flip($alvos['produtos'])) !== []) {
                        throw gc_invalido('bebida', 'O prêmio “' . $premio['titulo'] . '” vale nessa categoria: bebida não pode ter prêmio. Muda o prêmio antes.');
                    }
                }
            }
            $mudou = gc_loja_mudancas($col, $atual);
            if ($mudou !== []) {
                gc_sql('UPDATE loja_categorias SET nome = ?, curto = ?, icone = ?, bebida = ?, atualizado_em = ? WHERE id = ?', [$col['nome'], $col['curto'], $col['icone'], $col['bebida'], $agora, $atual['id']]);
                gc_loja_mudou();
                gc_evento('painel', 'categoria-editada', 'categoria:' . $atual['id'], ['nome' => $col['nome'], 'campos' => $mudou]);
            }
            return ['categoria' => gc_loja_categoria_publica((array) gc_um('SELECT * FROM loja_categorias WHERE id = ?', [$atual['id']]))] + gc_loja_carimbo();
        }
        $col = gc_loja_ler_categoria($c, null);
        $id = gc_loja_id_livre(gc_loja_slug($col['nome'], 'categoria'), 'loja_categorias');
        $ordem = (int) gc_valor('SELECT COALESCE(MAX(ordem), -1) + 1 FROM loja_categorias');
        gc_sql('INSERT INTO loja_categorias (id, nome, curto, icone, bebida, ordem, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [$id, $col['nome'], $col['curto'], $col['icone'], $col['bebida'], $ordem, $agora, $agora]);
        gc_loja_mudou();
        gc_evento('painel', 'categoria-criada', 'categoria:' . $id, ['nome' => $col['nome']]);
        return ['_status' => 201, 'categoria' => gc_loja_categoria_publica((array) gc_um('SELECT * FROM loja_categorias WHERE id = ?', [$id]))] + gc_loja_carimbo();
    });
}

/** POST admin-categoria-apagar { id }: só vazia (sem produto, nem desativado) e sem prêmio. */
function gc_rota_admin_categoria_apagar(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    gc_loja_exigir_semeada();
    return gc_transacao(static function () use ($c): array {
        $cat = gc_id_valido($c['id'] ?? null) ? gc_um('SELECT * FROM loja_categorias WHERE id = ?', [$c['id']]) : null;
        if ($cat === null) {
            throw new ErroApi('nao-encontrado', 'Categoria não encontrada.', 404);
        }
        $n = (int) gc_valor('SELECT COUNT(*) FROM loja_produtos WHERE categoria_id = ?', [$cat['id']]);
        if ($n > 0) {
            throw new ErroApi('em-uso', $n === 1 ? 'Tem 1 produto nessa categoria: muda ele de categoria antes de apagar.' : "Tem $n produtos nessa categoria: muda eles de categoria antes de apagar.", 409, ['produtos' => $n]);
        }
        $premios = array_values(array_filter(gc_loja_linhas_premios(), static fn (array $p): bool => in_array($cat['id'], gc_loja_alvos_do_premio($p)['categorias'], true)));
        if ($premios !== []) {
            throw new ErroApi('em-uso', 'O prêmio “' . $premios[0]['titulo'] . '” vale nessa categoria: muda o prêmio antes de apagar.', 409, ['premios' => array_map(static fn (array $p): array => ['id' => $p['id'], 'titulo' => $p['titulo']], $premios)]);
        }
        gc_sql('DELETE FROM loja_categorias WHERE id = ?', [$cat['id']]);
        gc_loja_mudou();
        gc_evento('painel', 'categoria-apagada', 'categoria:' . $cat['id'], ['nome' => $cat['nome']]);
        return gc_loja_carimbo();
    });
}

/** POST admin-categorias-ordem { ids }: a ordem dos destaques do site. */
function gc_rota_admin_categorias_ordem(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    gc_loja_exigir_semeada();
    return gc_transacao(static function () use ($c): array {
        $ordem = gc_loja_reordenar('loja_categorias', $c['ids'] ?? null);
        gc_loja_mudou();
        gc_evento('painel', 'categorias-ordem', 'loja', ['ordem' => $ordem]);
        return ['ordem' => $ordem] + gc_loja_carimbo();
    });
}

// ─── estados ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * POST admin-estado-salvar { uf, … }: estado que a loja ainda não tem = ativar um novo (emblema genérico, horário e
 * taxa "a confirmar", nenhum produto disponível ainda; Instagram e pagamento obrigatórios); estado que já tem = editar
 * (campo ausente fica). ativo: false tira o estado do site (os dados ficam); o último estado ativo não sai.
 */
function gc_rota_admin_estado_salvar(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    gc_loja_exigir_semeada();
    return gc_transacao(static function () use ($c): array {
        $uf = gc_uf($c['uf'] ?? null);
        if ($uf === null) {
            throw gc_invalido('uf', 'Escolhe o estado.');
        }
        $agora = gc_agora();
        $atual = gc_um('SELECT * FROM loja_estados WHERE uf = ?', [$uf]);
        $col = gc_loja_ler_estado($c, $atual, $uf);
        if ($atual !== null && (int) $atual['ativo'] === 1 && $col['ativo'] === 0 && (int) gc_valor('SELECT COUNT(*) FROM loja_estados WHERE ativo = 1') <= 1) {
            throw new ErroApi('ultimo-estado', 'A loja precisa de pelo menos um estado no site.', 409);
        }
        if ($atual === null) {
            $col = ['uf' => $uf] + $col + [
                'emblema' => 'generico',
                'ordem' => (int) gc_valor('SELECT COALESCE(MAX(ordem), -1) + 1 FROM loja_estados'),
                'criado_em' => $agora,
                'atualizado_em' => $agora,
            ];
            $nomes = implode(', ', array_keys($col));
            $marcas = implode(', ', array_fill(0, count($col), '?'));
            gc_sql("INSERT INTO loja_estados ($nomes) VALUES ($marcas)", array_values($col));
            gc_loja_mudou();
            gc_evento('painel', 'estado-ativado', 'estado:' . $uf, ['uf' => $uf, 'novo' => true]);
            return ['_status' => 201, 'estado' => gc_loja_estado_admin((array) gc_um('SELECT * FROM loja_estados WHERE uf = ?', [$uf]))] + gc_loja_carimbo();
        }
        $mudou = gc_loja_mudancas($col, $atual);
        if ($mudou !== []) {
            $sets = implode(', ', array_map(static fn (string $k): string => "$k = ?", array_keys($col)));
            gc_sql("UPDATE loja_estados SET $sets, atualizado_em = ? WHERE uf = ?", [...array_values($col), $agora, $uf]);
            gc_loja_mudou();
            $acao = $mudou === ['ativo'] ? ($col['ativo'] ? 'estado-ativado' : 'estado-desativado') : 'estado-editado';
            gc_evento('painel', $acao, 'estado:' . $uf, ['uf' => $uf, 'campos' => $mudou]);
        }
        return ['estado' => gc_loja_estado_admin((array) gc_um('SELECT * FROM loja_estados WHERE uf = ?', [$uf]))] + gc_loja_carimbo();
    });
}

// ─── stories do Início ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * POST admin-stories-salvar { uf, produtos }: os produtos que passam no story do Início desse estado, na ordem
 * (até as 8 barrinhas). Lista vazia = automático (os disponíveis do estado, na ordem da loja). No GET loja, os da
 * lista que não estão à venda no estado na hora não passam; se nenhum estiver, o estado volta pro automático.
 */
function gc_rota_admin_stories_salvar(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    gc_loja_exigir_semeada();
    return gc_transacao(static function () use ($c): array {
        $uf = gc_uf($c['uf'] ?? null);
        if ($uf === null || gc_um('SELECT 1 FROM loja_estados WHERE uf = ?', [$uf]) === null) {
            throw gc_invalido('uf', 'Estado que a loja não atende.');
        }
        $lista = $c['produtos'] ?? null;
        if (!is_array($lista) || !array_is_list($lista) || count($lista) > GC_LOJA_STORIES_MAX) {
            throw gc_invalido('produtos', 'Até ' . GC_LOJA_STORIES_MAX . ' produtos no story (são as barrinhas do topo).');
        }
        $ids = [];
        foreach ($lista as $id) {
            if (!gc_id_valido($id) || gc_um('SELECT 1 FROM loja_produtos WHERE id = ?', [$id]) === null) {
                throw gc_invalido('produtos', 'Produto não encontrado. Recarrega e tenta de novo.');
            }
            if (isset($ids[$id])) {
                throw gc_invalido('produtos', 'Produto repetido no story.');
            }
            $ids[(string) $id] = true;
        }
        $antes = array_map(static fn (array $l): string => (string) $l['produto_id'], gc_todos('SELECT produto_id FROM loja_stories WHERE uf = ? ORDER BY posicao', [$uf]));
        $nova = array_keys($ids);
        if ($antes !== $nova) {
            gc_sql('DELETE FROM loja_stories WHERE uf = ?', [$uf]);
            foreach ($nova as $i => $id) {
                gc_sql('INSERT INTO loja_stories (uf, produto_id, posicao) VALUES (?, ?, ?)', [$uf, $id, $i]);
            }
            gc_loja_mudou();
            gc_evento('painel', 'stories-salvos', 'estado:' . $uf, ['uf' => $uf, 'produtos' => count($nova)]);
        }
        return ['uf' => $uf, 'produtos' => $nova] + gc_loja_carimbo();
    });
}

// ─── ajustes, textos e Teste minha sorte ────────────────────────────────────────────────────────────────────────

/**
 * POST admin-loja-salvar { whatsapp?, mesmoWhatsappParaTodos?, restamAte?, ruaNoStory?, textos? }: o WhatsApp da loja
 * (o padrão), se todos os estados usam ele (o número próprio de cada estado fica guardado), o "restam X", a rua do
 * mercador no fim do Início do celular (`ruaNoStory`: o nome é de quando ela era o 1º story) e os textos da loja.
 */
function gc_rota_admin_loja_salvar(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    gc_loja_exigir_semeada();
    return gc_transacao(static function () use ($c): array {
        $antes = gc_loja_ajustes();
        $ajustes = $antes;
        if (array_key_exists('whatsapp', $c)) {
            $ajustes['whatsapp'] = gc_whatsapp($c['whatsapp']) ?? throw gc_invalido('whatsapp', 'Esse WhatsApp não fecha. Põe DDD + 9 dígitos.');
        }
        if (array_key_exists('mesmoWhatsappParaTodos', $c)) {
            $ajustes['mesmoWhatsappParaTodos'] = gc_loja_bool($c, 'mesmoWhatsappParaTodos', 'É sim ou não.');
        }
        if (array_key_exists('restamAte', $c)) {
            $ajustes['restamAte'] = $c['restamAte'] === null ? null : (gc_inteiro($c['restamAte'], 1, 99) ?? throw gc_invalido('restamAte', 'De 1 a 99 unidades (ou nunca mostrar).'));
        }
        if (array_key_exists('ruaNoStory', $c)) {
            $ajustes['ruaNoStory'] = gc_loja_bool($c, 'ruaNoStory', 'É sim ou não.');
        }
        $textosAntes = gc_loja_textos();
        $textos = array_key_exists('textos', $c) ? gc_loja_ler_textos($c['textos'], $textosAntes) : $textosAntes;
        $campos = array_keys(array_filter(['whatsapp' => $ajustes['whatsapp'] !== $antes['whatsapp'], 'mesmoWhatsappParaTodos' => $ajustes['mesmoWhatsappParaTodos'] !== $antes['mesmoWhatsappParaTodos'], 'restamAte' => $ajustes['restamAte'] !== $antes['restamAte'], 'ruaNoStory' => $ajustes['ruaNoStory'] !== $antes['ruaNoStory'], 'textos' => $textos !== $textosAntes]));
        if ($campos !== []) {
            gc_ajuste_definir('loja.whatsapp', $ajustes['whatsapp']);
            gc_ajuste_definir('loja.mesmo_whatsapp', $ajustes['mesmoWhatsappParaTodos'] ? '1' : '0');
            gc_ajuste_definir('loja.restam_ate', $ajustes['restamAte'] === null ? '' : (string) $ajustes['restamAte']);
            gc_ajuste_definir('loja.rua_story', $ajustes['ruaNoStory'] ? '1' : '0');
            gc_ajuste_definir('loja.textos', gc_loja_json($textos));
            gc_loja_mudou();
            gc_evento('painel', 'loja-ajustes', 'loja', ['campos' => $campos, 'ruaNoStory' => $ajustes['ruaNoStory']]);
        }
        return ['ajustes' => gc_loja_ajustes(), 'textos' => gc_loja_textos()] + gc_loja_carimbo();
    });
}

/** POST admin-sorte-salvar { ligado?, girosSemConta?, girosPorDiaComConta?, reservaSemContaHoras? } */
function gc_rota_admin_sorte_salvar(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    gc_loja_exigir_semeada();
    return gc_transacao(static function () use ($c): array {
        $antes = gc_loja_sorte();
        $sorte = gc_loja_ler_sorte($c, $antes);
        if ($sorte !== $antes) {
            gc_ajuste_definir('loja.sorte', gc_loja_json($sorte));
            gc_loja_mudou();
            gc_evento('painel', 'sorte-regras', 'loja', ['campos' => array_keys(array_diff_assoc(array_map('strval', $sorte), array_map('strval', $antes)))]);
        }
        return ['sorte' => gc_loja_sorte()] + gc_loja_carimbo();
    });
}

/** O prêmio no painel (o do site + ligado, ordem e se ele está valendo no site agora). */
function gc_loja_premio_admin_por_id(string $id): array
{
    $p = (array) gc_um('SELECT * FROM loja_premios WHERE id = ?', [$id]);
    $ctx = gc_loja_contexto_premios(gc_loja_linhas_produtos(), gc_loja_linhas_categorias());
    return gc_loja_premio_publico($p) + [
        'ativo' => (bool) $p['ativo'],
        'ordem' => (int) $p['ordem'],
        'noSite' => gc_loja_premio_no_site($p, $ctx),
        'atualizadoEm' => gc_iso((int) $p['atualizado_em']),
    ];
}

/**
 * POST admin-premio-salvar: sem id cria (id = slug do nome interno), com id edita (campo ausente fica). As regras de
 * src/lib/cupom.ts: só acessório, peso > 0, validade de 1 a 30 dias, percentual de 1 a 50, leve > pague, sem as
 * palavras da lista. Trocar o tipo pede o valor novo junto.
 */
function gc_rota_admin_premio_salvar(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    gc_loja_exigir_semeada();
    return gc_transacao(static function () use ($c): array {
        $agora = gc_agora();
        if (isset($c['id']) && $c['id'] !== '' && $c['id'] !== null) {
            $atual = gc_id_valido($c['id']) ? gc_um('SELECT * FROM loja_premios WHERE id = ?', [$c['id']]) : null;
            if ($atual === null) {
                throw new ErroApi('nao-encontrado', 'Prêmio não encontrado.', 404);
            }
            $col = gc_loja_ler_premio($c, $atual);
            $mudou = gc_loja_mudancas($col, $atual);
            if ($mudou !== []) {
                $sets = implode(', ', array_map(static fn (string $k): string => "$k = ?", array_keys($col)));
                gc_sql("UPDATE loja_premios SET $sets, atualizado_em = ? WHERE id = ?", [...array_values($col), $agora, $atual['id']]);
                gc_loja_mudou();
                $acao = $mudou === ['ativo'] ? ($col['ativo'] ? 'premio-ativado' : 'premio-desativado') : 'premio-editado';
                gc_evento('painel', $acao, 'premio:' . $atual['id'], ['titulo' => $col['titulo'], 'campos' => $mudou]);
            }
            return ['premio' => gc_loja_premio_admin_por_id((string) $atual['id'])] + gc_loja_carimbo();
        }
        $col = gc_loja_ler_premio($c, null);
        $id = gc_loja_id_livre(gc_loja_slug($col['titulo'], 'premio'), 'loja_premios');
        $col = ['id' => $id] + $col + [
            'ordem' => (int) gc_valor('SELECT COALESCE(MAX(ordem), -1) + 1 FROM loja_premios'),
            'criado_em' => $agora,
            'atualizado_em' => $agora,
        ];
        $nomes = implode(', ', array_keys($col));
        $marcas = implode(', ', array_fill(0, count($col), '?'));
        gc_sql("INSERT INTO loja_premios ($nomes) VALUES ($marcas)", array_values($col));
        gc_loja_mudou();
        gc_evento('painel', 'premio-criado', 'premio:' . $id, ['titulo' => $col['titulo']]);
        return ['_status' => 201, 'premio' => gc_loja_premio_admin_por_id($id)] + gc_loja_carimbo();
    });
}

/** POST admin-premio-apagar { id }: os cupons já guardados ficam com o retrato do prêmio (nada quebra no site). */
function gc_rota_admin_premio_apagar(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    gc_loja_exigir_semeada();
    return gc_transacao(static function () use ($c): array {
        $p = gc_id_valido($c['id'] ?? null) ? gc_um('SELECT * FROM loja_premios WHERE id = ?', [$c['id']]) : null;
        if ($p === null) {
            throw new ErroApi('nao-encontrado', 'Prêmio não encontrado.', 404);
        }
        gc_sql('DELETE FROM loja_premios WHERE id = ?', [$p['id']]);
        gc_loja_mudou();
        gc_evento('painel', 'premio-apagado', 'premio:' . $p['id'], ['titulo' => $p['titulo'], 'demo' => (bool) $p['demo']]);
        return gc_loja_carimbo();
    });
}

// ─── dados de exemplo ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * O que sai com "apagar dados de exemplo": os prêmios de exemplo, os rateios de exemplo (com quem entrou neles) e os
 * produtos de exemplo. Rateio de exemplo com gente que já pagou (confirmado ou entregue) nunca apaga: fica, como rateio
 * de verdade (`manter`), com o histórico de quem pagou. Produto de exemplo com histórico de verdade (num rateio ou
 * prêmio que não é exemplo, ou que fica) não apaga: sai do site (desativa).
 * @return array{premios: list<array{id: string, titulo: string}>, rateios: list<array{id: string, titulo: string, pessoas: int}>, manter: list<array{id: string, titulo: string, pessoas: int, pagas: int}>, produtos: list<array{id: string, nome: string}>, desativar: list<array{id: string, nome: string}>}
 */
function gc_loja_plano_exemplos(): array
{
    $premios = array_map(static fn (array $p): array => ['id' => (string) $p['id'], 'titulo' => (string) $p['titulo']], gc_todos('SELECT id, titulo FROM loja_premios WHERE demo = 1 ORDER BY ordem, id'));
    $rateios = [];
    $manter = [];
    foreach (gc_todos(
        "SELECT r.id, r.titulo, (SELECT COUNT(*) FROM participacoes p WHERE p.rateio_id = r.id) AS pessoas,
                (SELECT COUNT(*) FROM participacoes p WHERE p.rateio_id = r.id AND p.status IN ('confirmado','entregue')) AS pagas
           FROM rateios r WHERE r.demo = 1 ORDER BY r.criado_em",
    ) as $r) {
        $item = ['id' => (string) $r['id'], 'titulo' => (string) $r['titulo'], 'pessoas' => (int) $r['pessoas']];
        if ((int) $r['pagas'] > 0) {
            $manter[] = $item + ['pagas' => (int) $r['pagas']];
        } else {
            $rateios[] = $item;
        }
    }
    $saem = ['premios' => array_fill_keys(array_column($premios, 'id'), true), 'rateios' => array_fill_keys(array_column($rateios, 'id'), true)];
    $produtos = [];
    $desativar = [];
    $usos = gc_loja_usos();
    foreach (gc_todos('SELECT id, nome, ativo FROM loja_produtos WHERE demo = 1 ORDER BY ordem, id') as $p) {
        $uso = $usos[$p['id']] ?? [];
        $fica = count(array_filter($uso['rateios'] ?? [], static fn (array $r): bool => !isset($saem['rateios'][$r['id']])))
            + count(array_filter($uso['premios'] ?? [], static fn (array $x): bool => !isset($saem['premios'][$x['id']])));
        $item = ['id' => (string) $p['id'], 'nome' => (string) $p['nome']];
        if ($fica > 0) {
            if ((int) $p['ativo'] === 1) {
                $desativar[] = $item;
            }
            continue;
        }
        $produtos[] = $item;
    }
    return ['premios' => $premios, 'rateios' => $rateios, 'manter' => $manter, 'produtos' => $produtos, 'desativar' => $desativar];
}

/**
 * A assinatura do plano: o que ele apaga e quem está dentro de cada rateio que sai (as participações, não só a
 * contagem). A confirmação manda a da prévia; se mudou (alguém entrou num rateio de exemplo, pagou, o dono mexeu num
 * prêmio), nada sai e o painel mostra a prévia nova.
 */
function gc_loja_assinatura_exemplos(array $plano): string
{
    $ids = array_column($plano['rateios'], 'id');
    $pessoas = $ids === [] ? [] : gc_todos(
        'SELECT rateio_id, id, status FROM participacoes WHERE rateio_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ') ORDER BY rateio_id, id',
        $ids,
    );
    return substr(hash('sha256', (string) json_encode([$plano, $pessoas])), 0, 24);
}

/**
 * POST admin-loja-exemplos-apagar { conferir? , assinatura? }: tira de uma vez o que é de exemplo
 * (gc_loja_plano_exemplos). conferir: true só diz o que sairia, com a assinatura do plano, sem mexer em nada (a folha
 * de confirmação do painel mostra). Pra apagar, manda a assinatura da prévia: se o plano mudou desde então, 409 mudou
 * com o plano novo (nada sai sem ter aparecido na folha). Rateio de exemplo com gente que pagou fica (vira de verdade).
 * Os valores de exemplo dos estados (horário, taxa, pagamento) saem quando o dono salva os de verdade.
 */
function gc_rota_admin_loja_exemplos_apagar(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    gc_loja_exigir_semeada();
    $conferir = array_key_exists('conferir', $c) && gc_loja_bool($c, 'conferir', 'Conferir é sim ou não.');
    $assinatura = $c['assinatura'] ?? null;
    if (!$conferir && !is_string($assinatura)) {
        throw gc_invalido('assinatura', 'Confere o que sai antes de apagar (a folha mostra).');
    }
    return gc_transacao(static function () use ($conferir, $assinatura): array {
        $plano = gc_loja_plano_exemplos();
        $agora = gc_loja_assinatura_exemplos($plano);
        if ($conferir) {
            return ['plano' => $plano, 'assinatura' => $agora, 'apagou' => false] + gc_loja_carimbo();
        }
        if (!hash_equals($agora, (string) $assinatura)) {
            throw new ErroApi('mudou', 'Mudou alguma coisa nos dados de exemplo desde a conferência (alguém entrou num rateio, por exemplo). Confere de novo.', 409, ['plano' => $plano, 'assinatura' => $agora]);
        }
        foreach ($plano['premios'] as $p) {
            gc_sql('DELETE FROM loja_premios WHERE id = ?', [$p['id']]);
        }
        foreach ($plano['rateios'] as $r) {
            gc_sql('DELETE FROM participacoes WHERE rateio_id = ?', [$r['id']]);
            gc_sql('DELETE FROM rateios WHERE id = ?', [$r['id']]);
        }
        foreach ($plano['produtos'] as $p) {
            gc_loja_tirar_de_combina($p['id']);
            gc_sql('DELETE FROM loja_produtos WHERE id = ?', [$p['id']]);
        }
        foreach ($plano['desativar'] as $p) {
            gc_sql('UPDATE loja_produtos SET ativo = 0, atualizado_em = ? WHERE id = ?', [gc_agora(), $p['id']]);
        }
        // rateio de exemplo em que alguém pagou: fica, como rateio de verdade (o histórico de quem pagou não se perde)
        foreach ($plano['manter'] as $r) {
            gc_sql('UPDATE rateios SET demo = 0, atualizado_em = ? WHERE id = ?', [gc_agora(), $r['id']]);
        }
        $resumo = ['produtos' => count($plano['produtos']), 'premios' => count($plano['premios']), 'rateios' => count($plano['rateios']), 'desativados' => count($plano['desativar']), 'mantidos' => count($plano['manter'])];
        if (array_sum($resumo) > 0) {
            gc_loja_mudou();
            gc_evento('painel', 'loja-exemplos-apagados', 'loja', $resumo);
        }
        return ['plano' => $plano, 'apagou' => true] + gc_loja_carimbo();
    });
}

// ─── auditoria ──────────────────────────────────────────────────────────────────────────────────────────────────

/** "3 produtos", "1 prêmio"; zero = '' (sai da frase). */
function gc_loja_plural(int $n, string $um, string $varios): string
{
    return $n === 0 ? '' : $n . ' ' . ($n === 1 ? $um : $varios);
}

/** Frase da Atividade pros eventos da loja (null = não é da loja). */
function gc_loja_evento_texto(string $acao, array $d): ?string
{
    $nome = '"' . (string) ($d['nome'] ?? $d['titulo'] ?? '') . '"';
    $uf = strtoupper((string) ($d['uf'] ?? ''));
    $estado = static function (mixed $e): string {
        if (!is_array($e) || empty($e['disponivel'])) {
            return 'indisponível';
        }
        $n = $e['estoque'] ?? null;
        return $n === null ? 'disponível' : ((int) $n === 0 ? 'esgotado (0 un.)' : "disponível, $n un.");
    };
    $exemplos = implode(', ', array_filter([
        gc_loja_plural((int) ($d['produtos'] ?? 0), 'produto', 'produtos'),
        gc_loja_plural((int) ($d['premios'] ?? 0), 'prêmio', 'prêmios'),
        gc_loja_plural((int) ($d['rateios'] ?? 0), 'rateio', 'rateios'),
    ]));
    $m = (int) ($d['mantidos'] ?? 0);
    $mantidos = $m === 0 ? '' : ($m === 1 ? '; 1 rateio com pagamento ficou' : "; $m rateios com pagamento ficaram");
    return match ($acao) {
        'loja-semeada' => 'A loja entrou no servidor (' . (int) ($d['produtos'] ?? 0) . ' produtos)',
        'produto-criado' => "Criou o produto $nome",
        'produto-editado' => "Editou o produto $nome",
        'produto-ativado' => "Pôs de volta no site o produto $nome",
        'produto-desativado' => "Tirou do site o produto $nome",
        'produto-estado' => "$uf: $nome " . $estado($d['agora'] ?? null),
        'produto-apagado' => "Apagou o produto $nome",
        'produtos-ordem' => 'Mudou a ordem dos produtos',
        'categoria-criada' => "Criou a categoria $nome",
        'categoria-editada' => "Editou a categoria $nome",
        'categoria-apagada' => "Apagou a categoria $nome",
        'categorias-ordem' => 'Mudou a ordem das categorias',
        'estado-ativado' => !empty($d['novo']) ? "Ativou $uf no site" : "Pôs $uf de volta no site",
        'estado-desativado' => "Tirou $uf do site",
        'estado-editado' => "Editou o atendimento de $uf",
        'stories-salvos' => (int) ($d['produtos'] ?? 0) === 0 ? "Story do Início de $uf no automático" : "Escolheu o story do Início de $uf (" . gc_loja_plural((int) $d['produtos'], 'produto', 'produtos') . ')',
        // só a chave da rua: a frase diz o que ela faz; o resto, a frase de sempre
        'loja-ajustes' => ($d['campos'] ?? null) === ['ruaNoStory']
            ? (!empty($d['ruaNoStory']) ? 'Ligou a rua do mercador no celular' : 'Desligou a rua do mercador no celular')
            : 'Mudou os ajustes da loja',
        'sorte-regras' => 'Mudou as regras do Teste minha sorte',
        'premio-criado' => "Criou o prêmio $nome",
        'premio-editado' => "Editou o prêmio $nome",
        'premio-ativado' => "Pôs no jogo o prêmio $nome",
        'premio-desativado' => "Tirou do jogo o prêmio $nome",
        'premio-apagado' => "Apagou o prêmio $nome",
        'loja-exemplos-apagados' => ($exemplos === '' ? 'Apagou os dados de exemplo' : "Apagou os dados de exemplo ($exemplos)") . $mantidos,
        default => null,
    };
}

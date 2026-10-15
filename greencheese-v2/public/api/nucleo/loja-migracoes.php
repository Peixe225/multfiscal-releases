<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Migrações da loja, na faixa 100–199 do registro de banco.php: as tabelas (100), a semente nos bancos que já
// estavam instalados antes da loja ir pro servidor (101), o vídeo do produto com a capa (102), a raridade dos prêmios do Teste
// minha sorte (103), o material que a loja mandou em 11/10 (104: fotos, a thumb animada de fábrica e 2 produtos novos), o
// pedido mínimo pra entrega de cada estado (105) e os 4 produtos do material de 11/10 de volta pro desenho do site (106:
// sai a mídia de fábrica que a 104 pôs, só onde ela ainda é a de fábrica). Banco novo é semeado na instalação do painel
// (já com tudo isso, pela semente).
// Dinheiro em centavos; listas e objetos pequenos (combos, cidades, horário…) em JSON; hora em unix UTC.

/** @return array<int, string|callable(PDO): void> */
function gc_migracoes_loja(): array
{
    return [
        100 => <<<'SQL'
        CREATE TABLE loja_categorias (
          id TEXT PRIMARY KEY,
          nome TEXT NOT NULL,
          curto TEXT NOT NULL,
          icone TEXT NOT NULL,
          bebida INTEGER NOT NULL DEFAULT 1,
          ordem INTEGER NOT NULL DEFAULT 0,
          criado_em INTEGER NOT NULL,
          atualizado_em INTEGER NOT NULL
        );
        CREATE TABLE loja_produtos (
          id TEXT PRIMARY KEY,
          nome TEXT NOT NULL,
          tamanho TEXT NOT NULL DEFAULT '',
          detalhe TEXT NOT NULL DEFAULT '',
          descricao TEXT NOT NULL DEFAULT '',
          categoria_id TEXT NOT NULL REFERENCES loja_categorias(id),
          preco INTEGER CHECK (preco IS NULL OR preco >= 0),
          combos TEXT NOT NULL DEFAULT '[]',
          variacoes TEXT NOT NULL DEFAULT '[]',
          combina_com TEXT NOT NULL DEFAULT '[]',
          foto TEXT,
          cor TEXT NOT NULL DEFAULT '#a8a8a8',
          arte TEXT NOT NULL DEFAULT '{}',
          obs TEXT NOT NULL DEFAULT '',
          ativo INTEGER NOT NULL DEFAULT 1,
          demo INTEGER NOT NULL DEFAULT 0,
          ordem INTEGER NOT NULL DEFAULT 0,
          criado_em INTEGER NOT NULL,
          atualizado_em INTEGER NOT NULL
        );
        CREATE INDEX loja_produtos_categoria ON loja_produtos(categoria_id);
        CREATE TABLE loja_produto_estados (
          produto_id TEXT NOT NULL REFERENCES loja_produtos(id) ON DELETE CASCADE,
          uf TEXT NOT NULL,
          disponivel INTEGER NOT NULL DEFAULT 0,
          estoque INTEGER CHECK (estoque IS NULL OR estoque >= 0),
          atualizado_em INTEGER NOT NULL,
          PRIMARY KEY (produto_id, uf)
        );
        CREATE TABLE loja_estados (
          uf TEXT PRIMARY KEY,
          ativo INTEGER NOT NULL DEFAULT 1,
          destaque TEXT NOT NULL,
          nome_perfil TEXT,
          instagram TEXT NOT NULL,
          whatsapp TEXT,
          cidades TEXT NOT NULL DEFAULT '[]',
          horario TEXT NOT NULL,
          horario_demo INTEGER NOT NULL DEFAULT 0,
          taxa INTEGER CHECK (taxa IS NULL OR taxa >= 0),
          taxa_demo INTEGER NOT NULL DEFAULT 0,
          entrega_gratis TEXT,
          entrega_gratis_demo INTEGER NOT NULL DEFAULT 0,
          pagamentos TEXT NOT NULL,
          pagamentos_demo INTEGER NOT NULL DEFAULT 0,
          emblema TEXT NOT NULL DEFAULT 'generico',
          ordem INTEGER NOT NULL DEFAULT 0,
          criado_em INTEGER NOT NULL,
          atualizado_em INTEGER NOT NULL
        );
        CREATE TABLE loja_stories (
          uf TEXT NOT NULL,
          produto_id TEXT NOT NULL REFERENCES loja_produtos(id) ON DELETE CASCADE,
          posicao INTEGER NOT NULL,
          PRIMARY KEY (uf, produto_id)
        );
        CREATE TABLE loja_premios (
          id TEXT PRIMARY KEY,
          tipo TEXT NOT NULL CHECK (tipo IN ('desconto-percentual','leve-x-pague-y','brinde')),
          valor TEXT NOT NULL,
          titulo TEXT NOT NULL,
          descricao TEXT NOT NULL,
          regra TEXT NOT NULL,
          aplica_a TEXT NOT NULL,
          como_usar TEXT NOT NULL DEFAULT '',
          peso INTEGER NOT NULL CHECK (peso > 0),
          validade_dias INTEGER NOT NULL CHECK (validade_dias BETWEEN 1 AND 30),
          ativo INTEGER NOT NULL DEFAULT 1,
          demo INTEGER NOT NULL DEFAULT 0,
          ordem INTEGER NOT NULL DEFAULT 0,
          criado_em INTEGER NOT NULL,
          atualizado_em INTEGER NOT NULL
        );
        SQL,
        // painel instalado antes da loja ir pro servidor: a loja nasce da semente (a mesma do site de agora)
        101 => static function (PDO $db): void {
            if ($db->query('SELECT 1 FROM usuarios LIMIT 1')->fetchColumn() !== false) {
                gc_loja_semear($db, gc_loja_semente());
            }
        },
        // thumb animada do produto (Estúdio do produto, no painel): o vídeo curto já tratado ('uploads/<nome>.mp4' ou
        // '.webm') e a capa dele (o 1º quadro, imagem: aparece antes de tocar e onde vídeo não roda). Os dois juntos ou
        // nenhum (loja-validar.php).
        102 => <<<'SQL'
        ALTER TABLE loja_produtos ADD COLUMN video TEXT;
        ALTER TABLE loja_produtos ADD COLUMN capa TEXT;
        SQL,
        // a raridade dos prêmios do Teste minha sorte (comum, raro, épico, lendário: src/lib/raridade.ts). Prêmio de
        // antes fica comum. Os de exemplo de fábrica ganham a raridade deles (e entram o épico e o lendário de exemplo)
        // só se ainda forem exatamente os de fábrica: o que o dono mudou fica como está.
        103 => static function (PDO $db): void {
            $db->exec("ALTER TABLE loja_premios ADD COLUMN raridade TEXT NOT NULL DEFAULT 'comum' CHECK (raridade IN ('comum','raro','epico','lendario'))");
            gc_loja_raridades_de_fabrica($db);
        },
        // o material que a loja mandou (11/10), no banco que já está no ar: as fotos de fábrica (produtos/…, no build
        // do site) e a thumb animada de fábrica do Hennessy, só onde o produto existe e o campo ainda está vazio (nunca
        // troca a foto ou o vídeo que o dono pôs; a thumb só com a foto de fábrica: com a foto do dono, a capa tomaria o
        // lugar dela no card), e os 2 produtos novos vistos no story do RJ, só se a loja ainda não tem o produto (nem
        // pelo id, nem cadastrado pelo dono no painel com outro id ou outro jeito de escrever o nome; à venda só no RJ,
        // sem preço = "Consultar"). Os dados moram aqui (a semente muda com o tempo; a migração não).
        104 => static function (PDO $db): void {
            gc_loja_material_1110($db);
        },
        // o pedido mínimo pra entrega de cada estado (pedido do cliente em 14/10: "mínimo 20 reais pra entrega"), em
        // centavos; NULL = sem mínimo (o de todo estado que já existia: nada muda até o dono pôr um no painel).
        105 => <<<'SQL'
        ALTER TABLE loja_estados ADD COLUMN pedido_minimo INTEGER CHECK (pedido_minimo IS NULL OR pedido_minimo > 0);
        SQL,
        // os 4 produtos do material de 11/10 de volta pro desenho do site, no mesmo padrão do resto do catálogo (pedido
        // do Ian em 15/10: "A fanta de animação de antes estava melhor, e porque esses outros 4 itens estão fora do
        // padrão do restante do catálogo? Por favor, coloque os no mesmo padrão."). No banco que já está no ar, sai a
        // mídia de fábrica que a 104 pôs: a foto, só onde ela ainda é exatamente a de fábrica (produtos/<id>.webp), e a
        // thumb animada do Hennessy (o vídeo e a capa), só onde o vídeo ainda é o de fábrica. A foto ou o vídeo que o
        // dono pôs pelo painel (uploads/…) nunca sai, nem nos 4. Os arquivos continuam no build (produtos/): só deixam
        // de estar ligados aos produtos. Loja ainda não semeada: nada (a semente já vem sem a mídia de fábrica).
        106 => static function (PDO $db): void {
            gc_loja_quatro_no_desenho($db);
        },
    ];
}

/** Teto do pedido mínimo pra entrega (centavos): R$ 1.000,00 (passou disso é engano de digitação). */
const GC_LOJA_MINIMO_MAX = 100000;

/** A coluna do pedido mínimo (migração 105) já existe? (publicação no meio: o módulo novo antes da migração rodar) */
function gc_loja_tem_minimo(): bool
{
    static $tem = null;
    if ($tem === null) {
        $tem = false;
        foreach (gc_todos('PRAGMA table_info(loja_estados)') as $c) {
            $tem = $tem || $c['name'] === 'pedido_minimo';
        }
    }
    return $tem;
}

/** Os produtos novos da migração 104 (os mesmos do src/dados/catalogo.json; o testar-api confere que batem). */
const GC_LOJA_NOVOS_1110 = [
    [
        'id' => 'jack-daniels-tennessee-apple', 'nome' => "Jack Daniel's Tennessee Apple", 'tamanho' => '',
        'detalhe' => 'Whiskey com licor de maçã · garrafa',
        'descricao' => "O Tennessee whiskey da Jack Daniel's com licor de maçã. Vai bem gelado ou com gelo.",
        'categoria' => 'destilados', 'foto' => 'produtos/jack-daniels-tennessee-apple.webp', 'cor' => '#6c5f37',
        'arte' => ['tipo' => 'garrafa-quadrada', 'corpo' => '#a8641f', 'rotulo' => '#5f8a3a', 'detalhe' => '#e8e2c4', 'tampa' => '#c9b98a'],
        'obs' => 'Visto no story do RJ em 11/10. Preço PENDENTE.',
    ],
    [
        'id' => 'fanta-maca-china', 'nome' => 'Fanta Maçã da China', 'tamanho' => '',
        'detalhe' => 'Lata alta · importada da China',
        'descricao' => 'Fanta sabor maçã, importada da China, na lata alta. Serve bem gelada.',
        'categoria' => 'bebidas', 'foto' => 'produtos/fanta-maca-china.webp', 'cor' => '#316f7f',
        'arte' => ['tipo' => 'lata-alta', 'corpo' => '#7dbb3c', 'faixa' => '#1f4fa8', 'detalhe' => '#f2f2f2'],
        'obs' => 'Visto no story do RJ em 11/10. Preço PENDENTE.',
    ],
];

/**
 * As palavras de um nome de produto, pra achar o mesmo produto escrito de outro jeito: sem acento e sem maiúscula, o
 * apóstrofo some ("Daniel's" e "Daniels" dão o mesmo), parêntese e pontuação separam, sem "a/o/e/da/de/do/das/dos" e
 * sem o "s" do fim das palavras compridas.
 * @return list<string>
 */
function gc_loja_palavras_do_nome(string $nome): array
{
    $t = (string) preg_replace("/['’‘´`]/u", '', gc_loja_comparavel($nome));
    $out = [];
    foreach (preg_split('/[^a-z0-9]+/', $t, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $p) {
        if (in_array($p, ['a', 'o', 'e', 'da', 'de', 'do', 'das', 'dos'], true)) {
            continue;
        }
        $out[] = strlen($p) > 3 ? (string) preg_replace('/s$/', '', $p) : $p;
    }
    return $out;
}

/**
 * O produto novo da 104 já está na loja? O dono pode ter cadastrado pelo painel depois do story de 11/10, e o painel
 * gera outro id (o apóstrofo vira traço, o tamanho entra: "jack-daniel-s-tennessee-apple-1-l"). Conta como o mesmo: o
 * id da migração, o id que o painel daria pelo nome (ou um dos dois com sufixo: "-1-l", "-2"), ou um produto cujo
 * nome (com o tamanho) tem todas as palavras do nome do novo ("FANTA MAÇÃ CHINA LATA", "Fanta Maçã (China)").
 * @param array<string, mixed> $p
 * @param list<array{id: string, nome: string, tamanho: string}> $produtos
 */
function gc_loja_novo_ja_existe(array $p, array $produtos): bool
{
    $ids = array_values(array_unique([(string) $p['id'], gc_loja_slug((string) $p['nome'], (string) $p['id'])]));
    $palavras = gc_loja_palavras_do_nome((string) $p['nome']);
    foreach ($produtos as $x) {
        foreach ($ids as $id) {
            if ($x['id'] === $id || str_starts_with($x['id'], $id . '-')) {
                return true;
            }
        }
        $dele = gc_loja_palavras_do_nome($x['nome'] . ' ' . $x['tamanho']);
        if ($palavras !== [] && array_diff($palavras, $dele) === []) {
            return true;
        }
    }
    return false;
}

/**
 * A migração 104: foto de fábrica onde o produto existe e o campo está vazio, a thumb animada de fábrica onde não tem
 * vídeo e a foto é a de fábrica, e os produtos novos que a loja ainda não tem (gc_loja_novo_ja_existe). Loja ainda não
 * semeada (banco novo, antes de instalar): nada (a instalação semeia já com tudo isso). Mudou alguma coisa: a versão
 * da loja sobe (o ETag muda e o site pega na próxima abertura).
 */
function gc_loja_material_1110(PDO $db): void
{
    $semeada = $db->prepare('SELECT 1 FROM ajustes WHERE chave = ?');
    $semeada->execute(['loja.semeada_em']);
    if ($semeada->fetchColumn() === false) {
        return;
    }
    $agora = gc_agora();
    $mudou = 0;
    $foto = $db->prepare("UPDATE loja_produtos SET foto = ?, atualizado_em = ? WHERE id = ? AND (foto IS NULL OR foto = '')");
    foreach (['fanta-ghost-face-punch' => 'produtos/fanta-ghost-face-punch.webp', 'hennessy-very-special' => 'produtos/hennessy-very-special.webp'] as $id => $caminho) {
        $foto->execute([$caminho, $agora, $id]);
        $mudou += $foto->rowCount();
    }
    // vídeo e capa juntos, só sem vídeo nenhum (o que o dono gravou no Estúdio fica) e com a foto de fábrica (a que a
    // linha de cima pôs, ou que já estava): o site mostra a capa e o vídeo na frente da foto, e a foto que o dono
    // escolheu deixaria de aparecer no card, no story e na página
    $video = $db->prepare("UPDATE loja_produtos SET video = ?, capa = ?, atualizado_em = ? WHERE id = ? AND (video IS NULL OR video = '') AND foto = ?");
    $video->execute(['produtos/hennessy-very-special.mp4', 'produtos/hennessy-very-special-capa.webp', $agora, 'hennessy-very-special', 'produtos/hennessy-very-special.webp']);
    $mudou += $video->rowCount();

    /** @var list<array{id: string, nome: string, tamanho: string}> $produtos */
    $produtos = $db->query('SELECT id, nome, tamanho FROM loja_produtos')->fetchAll(PDO::FETCH_ASSOC);
    $categoria = $db->prepare('SELECT 1 FROM loja_categorias WHERE id = ?');
    $ordem = (int) $db->query('SELECT COALESCE(MAX(ordem), -1) FROM loja_produtos')->fetchColumn();
    $novo = $db->prepare(
        'INSERT INTO loja_produtos (id, nome, tamanho, detalhe, descricao, categoria_id, preco, combos, variacoes, combina_com, foto, cor, arte, obs, ativo, demo, ordem, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, NULL, \'[]\', \'[]\', \'[]\', ?, ?, ?, ?, 1, 0, ?, ?, ?)',
    );
    $porUf = $db->prepare('INSERT OR IGNORE INTO loja_produto_estados (produto_id, uf, disponivel, estoque, atualizado_em) VALUES (?, ?, ?, NULL, ?)');
    foreach (GC_LOJA_NOVOS_1110 as $p) {
        if (gc_loja_novo_ja_existe($p, $produtos)) {
            continue;
        }
        // a categoria saiu do painel: o produto não entra (sem ela não tem onde mostrar; o dono cadastra se quiser)
        $categoria->execute([$p['categoria']]);
        if ($categoria->fetchColumn() === false) {
            continue;
        }
        $ordem++;
        $novo->execute([
            $p['id'], $p['nome'], $p['tamanho'], $p['detalhe'], $p['descricao'], $p['categoria'], $p['foto'], $p['cor'],
            gc_loja_json($p['arte']), $p['obs'], $ordem, $agora, $agora,
        ]);
        // à venda só no RJ (veio do Instagram do RJ); nos outros estados do site, fora de venda até o dono ligar
        foreach (['rj' => 1, 'mg' => 0, 'sp' => 0, 'es' => 0, 'sc' => 0] as $uf => $sim) {
            $porUf->execute([$p['id'], $uf, $sim, $agora]);
        }
        $produtos[] = ['id' => $p['id'], 'nome' => $p['nome'], 'tamanho' => $p['tamanho']];
        $mudou++;
    }
    if ($mudou > 0) {
        $versao = $db->prepare('SELECT valor FROM ajustes WHERE chave = ?');
        $versao->execute(['loja.versao']);
        $atual = (int) ($versao->fetchColumn() ?: 0);
        $ajuste = $db->prepare(
            'INSERT INTO ajustes (chave, valor, atualizado_em) VALUES (?, ?, ?)
             ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em',
        );
        $ajuste->execute(['loja.versao', (string) ($atual + 1), $agora]);
        $ajuste->execute(['loja.atualizado_em', (string) $agora, $agora]);
    }
}

/**
 * A foto de fábrica que a 104 ligou a cada um dos 4 produtos do material de 11/10 (o caminho exato: é o que a 106
 * desliga) e a thumb animada de fábrica do Hennessy (o vídeo; a capa sai junto com ele).
 */
const GC_LOJA_FOTOS_FABRICA_106 = [
    'fanta-ghost-face-punch' => 'produtos/fanta-ghost-face-punch.webp',
    'hennessy-very-special' => 'produtos/hennessy-very-special.webp',
    'jack-daniels-tennessee-apple' => 'produtos/jack-daniels-tennessee-apple.webp',
    'fanta-maca-china' => 'produtos/fanta-maca-china.webp',
];
const GC_LOJA_VIDEO_FABRICA_106 = ['hennessy-very-special', 'produtos/hennessy-very-special.mp4'];

/**
 * A migração 106: os 4 produtos voltam pro desenho do site. A foto sai só onde ainda é a de fábrica do próprio produto;
 * o vídeo e a capa do Hennessy saem só onde o vídeo ainda é o de fábrica (a foto ou o vídeo que o dono trocou ficam,
 * um sem o outro: o dono que gravou a thumb e deixou a foto de fábrica fica com a thumb dele). Loja ainda não semeada:
 * nada. Mudou alguma coisa: a versão da loja sobe e a hora da mudança anda, como na 104 (o ETag muda e o site pega na
 * próxima abertura, em vez de um 304 com a loja guardada no aparelho). Rodar de novo, com tudo no lugar, não mexe em
 * nada (nem na versão).
 */
function gc_loja_quatro_no_desenho(PDO $db): void
{
    $semeada = $db->prepare('SELECT 1 FROM ajustes WHERE chave = ?');
    $semeada->execute(['loja.semeada_em']);
    if ($semeada->fetchColumn() === false) {
        return;
    }
    $agora = gc_agora();
    $mudou = 0;
    $foto = $db->prepare('UPDATE loja_produtos SET foto = NULL, atualizado_em = ? WHERE id = ? AND foto = ?');
    foreach (GC_LOJA_FOTOS_FABRICA_106 as $id => $caminho) {
        $foto->execute([$agora, $id, $caminho]);
        $mudou += $foto->rowCount();
    }
    [$id, $caminho] = GC_LOJA_VIDEO_FABRICA_106;
    $video = $db->prepare('UPDATE loja_produtos SET video = NULL, capa = NULL, atualizado_em = ? WHERE id = ? AND video = ?');
    $video->execute([$agora, $id, $caminho]);
    $mudou += $video->rowCount();
    if ($mudou > 0) {
        $versao = $db->prepare('SELECT valor FROM ajustes WHERE chave = ?');
        $versao->execute(['loja.versao']);
        $atual = (int) ($versao->fetchColumn() ?: 0);
        $ajuste = $db->prepare(
            'INSERT INTO ajustes (chave, valor, atualizado_em) VALUES (?, ?, ?)
             ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em',
        );
        $ajuste->execute(['loja.versao', (string) ($atual + 1), $agora]);
        $ajuste->execute(['loja.atualizado_em', (string) $agora, $agora]);
    }
}

/** Os 5 prêmios de exemplo de fábrica de antes da raridade (src/dados/sorte.ts até 11/10), pra conferir se seguem intactos. */
const GC_LOJA_PREMIOS_FABRICA_103 = [
    'ocb-4-por-3' => ['leve-x-pague-y', ['leve' => 4, 'pague' => 3], '4 por 3 na OCB', 'Uma OCB por conta da sorte.', 'Leva 4 Seda OCB Premium Slim e paga 3', ['produtos' => ['seda-ocb-premium-slim']], 'Põe 4 na sacola e usa o cupom. Com o combo da OCB, a conta fecha na conversa.', 30, 7],
    'piteira-vidro-15' => ['desconto-percentual', 15, '15% na piteira de vidro', 'A de vidro sai mais em conta.', '15% de desconto na Piteira de vidro RAW', ['produtos' => ['piteira-de-vidro-raw']], 'Põe a piteira na sacola e usa o cupom.', 20, 7],
    'brinde-piteira-papel' => ['brinde', ['produto' => 'piteira-de-papel-raw', 'qtd' => 1], 'Piteira de papel de brinde', 'Vem junto com tua seda.', '1 Piteira de papel RAW de brinde no pedido com seda', ['categorias' => ['sedas']], 'Põe qualquer seda na sacola e usa o cupom.', 25, 7],
    'dichavador-10' => ['desconto-percentual', 10, '10% no dichavador', 'Agora gira o de verdade.', '10% de desconto no Dichavador de metal 4 partes', ['produtos' => ['dichavador-metal-4-partes']], '', 15, 7],
    'bandeja-10' => ['desconto-percentual', 10, '10% na bandeja RAW', 'Tudo no lugar pra enrolar.', '10% de desconto na Bandeja RAW pequena', ['produtos' => ['bandeja-raw-pequena']], '', 10, 7],
];
/** A raridade de cada exemplo de fábrica (a da semente de 11/10): os 10% e o 4 por 3 comuns, o 15% e o brinde raros. */
const GC_LOJA_RARIDADE_FABRICA_103 = ['ocb-4-por-3' => 'comum', 'piteira-vidro-15' => 'raro', 'brinde-piteira-papel' => 'raro', 'dichavador-10' => 'comum', 'bandeja-10' => 'comum'];
/** O épico e o lendário de exemplo que entram junto (os mesmos da semente de 11/10), na mesma ordem das colunas de cima. */
const GC_LOJA_PREMIOS_NOVOS_103 = [
    'bandeja-25' => ['desconto-percentual', 25, '25% na bandeja RAW', 'Bandeja bem mais em conta.', '25% de desconto na Bandeja RAW pequena', ['produtos' => ['bandeja-raw-pequena']], 'Põe a bandeja na sacola e usa o cupom.', 1, 7, 'epico'],
    'dichavador-40' => ['desconto-percentual', 40, '40% no dichavador', 'Sorte grande no dichavador.', '40% de desconto no Dichavador de metal 4 partes', ['produtos' => ['dichavador-metal-4-partes']], 'Põe o dichavador na sacola e usa o cupom.', 1, 7, 'lendario'],
];

/**
 * Migração 103 (dentro da trava, com o PDO): a raridade dos prêmios de exemplo de fábrica, sem pisar no que o dono
 * mudou. Dois casos põem a raridade; qualquer outro deixa tudo comum:
 * - o banco no ar com os 5 exemplos de fábrica intactos (os mesmos ids e textos, de exemplo e no jogo): cada um ganha a
 *   raridade dele e entram o épico e o lendário de exemplo (pra loja ver as 4 raridades);
 * - a loja que a 101 acabou de semear, sem a coluna (painel instalado antes da loja): os prêmios são os da semente de
 *   agora, intactos, e ganham a raridade dela.
 * Mudou alguma coisa: a versão da loja sobe (o site lê de novo) e fica na Atividade.
 */
function gc_loja_raridades_de_fabrica(PDO $db): void
{
    $linhas = $db->query('SELECT * FROM loja_premios ORDER BY ordem, id')->fetchAll(PDO::FETCH_ASSOC);
    if ($linhas === []) {
        return;
    }
    $porId = [];
    foreach ($linhas as $l) {
        $porId[(string) $l['id']] = $l;
    }
    /** A linha tem esse conteúdo? (tipo, valor, textos, aplicaA, como usar, peso, validade; de exemplo e no jogo) */
    $intacta = static function (array $l, array $f): bool {
        [$tipo, $valor, $titulo, $descricao, $regra, $aplica, $como, $peso, $validade] = $f;
        return (string) $l['tipo'] === $tipo && json_decode((string) $l['valor'], true) == $valor && (string) $l['titulo'] === $titulo
            && (string) $l['descricao'] === $descricao && (string) $l['regra'] === $regra && json_decode((string) $l['aplica_a'], true) == $aplica
            && (string) $l['como_usar'] === $como && (int) $l['peso'] === $peso && (int) $l['validade_dias'] === $validade
            && (int) $l['demo'] === 1 && (int) $l['ativo'] === 1;
    };
    $agora = gc_agora();
    $raridade = $db->prepare('UPDATE loja_premios SET raridade = ? WHERE id = ?');
    $novos = 0;
    $fabrica = array_keys(GC_LOJA_PREMIOS_FABRICA_103);
    $ids = array_keys($porId);
    sort($ids);
    sort($fabrica);
    if ($ids === $fabrica && array_filter(GC_LOJA_PREMIOS_FABRICA_103, static fn (array $f, string $id): bool => !$intacta($porId[$id], $f), ARRAY_FILTER_USE_BOTH) === []) {
        foreach (GC_LOJA_RARIDADE_FABRICA_103 as $id => $r) {
            $raridade->execute([$r, $id]);
        }
        $ordem = max(array_map(static fn (array $l): int => (int) $l['ordem'], $linhas)) + 1;
        $inserir = $db->prepare(
            'INSERT INTO loja_premios (id, tipo, valor, titulo, descricao, regra, aplica_a, como_usar, peso, validade_dias, ativo, demo, ordem, criado_em, atualizado_em, raridade)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)',
        );
        foreach (GC_LOJA_PREMIOS_NOVOS_103 as $id => [$tipo, $valor, $titulo, $descricao, $regra, $aplica, $como, $peso, $validade, $r]) {
            $inserir->execute([$id, $tipo, gc_loja_json($valor), $titulo, $descricao, $regra, gc_loja_json($aplica), $como, $peso, $validade, $ordem++, $agora, $agora, $r]);
            $novos++;
        }
    } else {
        // a 101 acabou de semear (sem a coluna): os prêmios são os da semente de agora, intactos
        $semente = [];
        foreach ((array) (gc_loja_semente()['sorte']['premios'] ?? []) as $p) {
            $semente[(string) $p['id']] = $p;
        }
        $daSemente = array_keys($semente);
        sort($daSemente);
        if ($ids !== $daSemente) {
            return;
        }
        foreach ($semente as $id => $p) {
            $f = [(string) $p['tipo'], $p['valor'], (string) $p['titulo'], (string) $p['descricao'], (string) $p['regra'], $p['aplicaA'], (string) ($p['comoUsar'] ?? ''), (int) $p['peso'], (int) $p['validadeDias']];
            if (!$intacta($porId[$id], $f) || empty($p['demo'])) {
                return;
            }
        }
        foreach ($semente as $id => $p) {
            $raridade->execute([gc_raridade_de($p), $id]);
        }
    }
    $db->prepare("UPDATE ajustes SET valor = CAST(CAST(valor AS INTEGER) + 1 AS TEXT), atualizado_em = ? WHERE chave = 'loja.versao'")->execute([$agora]);
    $db->prepare("UPDATE ajustes SET valor = ?, atualizado_em = ? WHERE chave = 'loja.atualizado_em'")->execute([(string) $agora, $agora]);
    $db->prepare("INSERT INTO eventos (em, usuario_id, origem, acao, alvo, detalhe) VALUES (?, NULL, 'sistema', 'sorte-raridades', 'loja', ?)")
        ->execute([$agora, gc_loja_json(['novos' => $novos])]);
}

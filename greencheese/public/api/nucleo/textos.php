<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Falas do pedido guiado que o dono trocou no painel. O texto de sempre mora no site (src/dados/textos-pedido.ts);
// aqui fica só a troca, por chave. A lista de chaves, marcadores, tipos e tamanhos vem de textos-pedido.json, gerado
// do mesmo arquivo do site (scripts/gerar-textos-pedido.mjs; o testar-api confere que está em dia).

/** Promessas que nenhuma fala pode fazer: prazo, frete e afins a loja combina no WhatsApp. Sem acento, palavra inteira. */
const GC_TERMOS_PROMESSA = [
    'frete', 'gratis', 'gratuito', 'gratuita', 'prazo', 'garantido', 'garantida', 'garantimos', 'garantia', 'minutos',
    'em ate', 'na hora', 'expresso', 'expressa', 'hoje mesmo', 'entrega hoje', 'chega hoje', 'entregamos hoje',
];

/** @return array{textos: array<string, array{padrao: string, tipo: string, marcadores: list<string>}>, maximo: array<string, int>} */
function gc_textos_info(): array
{
    static $info = null;
    if ($info === null) {
        $j = json_decode((string) @file_get_contents(__DIR__ . '/textos-pedido.json'), true);
        $info = is_array($j) && is_array($j['textos'] ?? null) && is_array($j['maximo'] ?? null) ? $j : ['textos' => [], 'maximo' => []];
    }
    return $info;
}

/** As trocas que valem (só de chave que o site conhece). @return array<string, array<string, mixed>> */
function gc_textos_trocados(): array
{
    $info = gc_textos_info()['textos'];
    $out = [];
    foreach (gc_todos('SELECT chave, texto, atualizado_em, por FROM textos_pedido ORDER BY chave') as $l) {
        if (isset($info[$l['chave']])) {
            $out[(string) $l['chave']] = $l;
        }
    }
    return $out;
}

/** ETag das trocas (muda quando o dono troca qualquer fala). @param array<string, string> $textos */
function gc_textos_versao(array $textos): string
{
    ksort($textos);
    return '"t' . substr(hash('sha256', (string) json_encode($textos, JSON_UNESCAPED_UNICODE)), 0, 20) . '"';
}

/** Primeira promessa (prazo, frete…) achada no texto, ou null. */
function gc_termo_promessa(string $t): ?string
{
    $s = ' ' . trim((string) preg_replace('/[^a-z0-9]+/', ' ', gc_sem_acento($t))) . ' ';
    foreach (GC_TERMOS_PROMESSA as $termo) {
        if (str_contains($s, ' ' . $termo . ' ')) {
            return $termo;
        }
    }
    return null;
}

/**
 * Confere a fala nova: chave que existe, texto de 1 até o tamanho do tipo, uma linha só, só os marcadores daquela fala
 * (e nenhuma chave sobrando), sem tabaco nem promessa. Devolve o texto limpo.
 */
function gc_texto_pedido_conferir(string $chave, mixed $v): string
{
    $info = gc_textos_info();
    $d = $info['textos'][$chave];
    $max = (int) ($info['maximo'][$d['tipo']] ?? 120);
    $t = gc_texto($v);
    if ($t === null || $t === '') {
        throw gc_invalido('texto', 'Escreve alguma coisa (ou volta ao padrão).');
    }
    if (gc_tamanho($t) > $max) {
        throw gc_invalido('texto', "Até $max letras aqui.", ['maximo' => $max]);
    }
    $validos = $d['marcadores'];
    preg_match_all('/\{([^{}]*)\}/', $t, $m);
    foreach ($m[1] as $nome) {
        if (!in_array($nome, $validos, true)) {
            $lista = $validos === [] ? 'Essa fala não tem marcador.' : 'Dá pra usar: ' . implode(', ', array_map(static fn (string $x): string => '{' . $x . '}', $validos)) . '.';
            throw gc_invalido('texto', '{' . $nome . '} não existe aqui. ' . $lista, ['marcador' => $nome]);
        }
    }
    if (str_contains((string) preg_replace('/\{[^{}]*\}/', '', $t), '{') || str_contains((string) preg_replace('/\{[^{}]*\}/', '', $t), '}')) {
        throw gc_invalido('texto', 'Sobrou uma chave { ou }: os marcadores vão assim, {nome}.');
    }
    $termo = gc_termo_proibido($t);
    if ($termo !== null) {
        throw new ErroApi('proibido', 'Tabaco e vape não entram no site (Anvisa).', 422, ['campo' => 'texto', 'termo' => $termo]);
    }
    $promessa = gc_termo_promessa($t);
    if ($promessa !== null) {
        throw gc_invalido('texto', "Sem promessa de prazo ou frete (\"$promessa\"): a loja combina isso no WhatsApp.", ['termo' => $promessa]);
    }
    return $t;
}

/**
 * GET pedido-textos: as falas que o dono trocou ({ chave: texto }; o resto é o padrão do site), com ETag. O site manda
 * If-None-Match com a versão que guardou: igual, 304 sem corpo.
 */
function gc_rota_pedido_textos(): array
{
    $textos = array_map(static fn (array $l): string => (string) $l['texto'], gc_textos_trocados());
    $versao = gc_textos_versao($textos);
    $pediu = (string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '');
    if ($pediu !== '' && in_array($versao, array_map('trim', explode(',', $pediu)), true)) {
        http_response_code(304);
        gc_cabecalhos();
        header('ETag: ' . $versao);
        exit;
    }
    if (!headers_sent()) {
        header('ETag: ' . $versao);
    }
    // quem abre o chat também dá a vez dos avisos que esperam nova tentativa (sai depois da resposta)
    gc_avisos_depois([]);
    return ['textos' => (object) $textos, 'versao' => $versao];
}

/** GET admin-textos-pedido: as trocas, com quando e quem trocou (o padrão o painel já tem). */
function gc_rota_admin_textos_pedido(): array
{
    gc_exigir_dono();
    $out = [];
    foreach (gc_textos_trocados() as $chave => $l) {
        $out[$chave] = ['texto' => (string) $l['texto'], 'atualizadoEm' => gc_iso((int) $l['atualizado_em']), 'por' => (string) $l['por']];
    }
    return ['textos' => (object) $out, 'versao' => gc_textos_versao(array_map(static fn (array $x): string => $x['texto'], $out))];
}

/**
 * POST admin-texto-pedido-salvar { chave, texto }: troca uma fala. texto null ou '' (ou igual ao padrão) = volta ao
 * padrão. Devolve todas as trocas (a tela redesenha com elas).
 */
function gc_rota_admin_texto_pedido_salvar(): array
{
    $s = gc_exigir_dono();
    $c = gc_corpo();
    $chave = $c['chave'] ?? null;
    $info = gc_textos_info()['textos'];
    if (!is_string($chave) || !isset($info[$chave])) {
        throw gc_invalido('chave', 'Essa fala não existe (recarrega o painel).');
    }
    $v = $c['texto'] ?? null;
    $padrao = $v === null || (is_string($v) && trim($v) === '');
    $texto = $padrao ? null : gc_texto_pedido_conferir($chave, $v);
    if ($texto !== null && $texto === $info[$chave]['padrao']) {
        $texto = null;
    }
    gc_transacao(static function () use ($chave, $texto, $s): void {
        $antes = gc_um('SELECT texto FROM textos_pedido WHERE chave = ?', [$chave]);
        if ($texto === null) {
            if ($antes !== null) {
                gc_sql('DELETE FROM textos_pedido WHERE chave = ?', [$chave]);
                gc_evento('painel', 'texto-pedido-padrao', 'texto:' . $chave, ['chave' => $chave]);
            }
            return;
        }
        if ($antes !== null && (string) $antes['texto'] === $texto) {
            return;
        }
        gc_sql(
            'INSERT INTO textos_pedido (chave, texto, atualizado_em, por) VALUES (?, ?, ?, ?)
             ON CONFLICT(chave) DO UPDATE SET texto = excluded.texto, atualizado_em = excluded.atualizado_em, por = excluded.por',
            [$chave, $texto, gc_agora(), 'painel:' . $s['login']],
        );
        gc_evento('painel', 'texto-pedido-trocado', 'texto:' . $chave, ['chave' => $chave, 'texto' => $texto]);
    });
    return gc_rota_admin_textos_pedido();
}

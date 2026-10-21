<?php
/**
 * LENDA · testes da v3.4, lado do servidor (CONTRATO-v34.md §A): banco e semeadura (os 10 desafios de emblema ativos, uma
 * vez só), conquistas provadas pelas carreiras (só com semente do servidor + replay; nada some), verificação das provas em
 * lote, o desafio de todas as conquistas pela prova, desafios de emblema (concessão sozinha, idempotente, critérios novos,
 * carreira sem prova não ganha, retirar/devolver), emblemas no perfil, no Hall e no ?eu=1, a prévia de link (v.php: HTML +
 * PNG com cache em disco, carreira pública/oculta/inexistente, perfil fechado), LGPD, backup, entradas erradas (nenhum 500)
 * e o banco sem o instalar da v3.4. HallEntry reais (v-intenso-01) com o replay real de uma carreira gravada.
 * Incluído pelo teste.php depois do teste-v33-corr.php (usa os ajudantes dele e dos de antes). Deixa a equipe vazia e os
 * desafios como o teste da v3.3 deixou (os 3 de fábrica desativados; os de emblema de novo semeados, ativos).
 */
declare(strict_types=1);

// ── ajudantes ────────────────────────────────────────────────────────────────────────────────────

/** Estado conhecido: o da v3.3, sem emblemas, e os 10 desafios de emblema semeados de novo (ativos) pelo instalar. */
function v34Limpar(): Resposta
{
    global $anon, $PAINEL_TOKEN;
    v33Limpar();
    q('DELETE FROM emblemas_usuario');
    q("DELETE FROM site_config WHERE chave IN ('_v34_emblemas', '_v34_emblemas_lote')");
    return $anon->pedir('POST', '/api/instalar.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
}

/** Os de prêmio (modo primeiro) desativados, sem vencedor nem candidatos; os de emblema ficam como estão (ativos). */
function v34ZerarPremio(): void
{
    q('DELETE FROM desafio_candidatos');
    q("UPDATE desafios SET ativo = 0, inicio = NULL, fim = NULL, vencedor_usuario_id = NULL, vencedor_carreira_pk = NULL, vencedor_candidato = NULL,
        vencido_em = NULL WHERE modo = 'primeiro'");
}

/** HallEntry real (v-intenso-01: 12 Bolas de Ouro, 4 Champions, 1 Copa, 794 gols, 11 clubes, 7 temporadas no mesmo clube) com o replay real. */
function v34Hall(string $id, array $m = [], ?array $conquistas = null, int $copas = 1, int $lib = 0): stdClass
{
    $h = v33Hall($id, $copas, $lib, true, $m + ['nota' => 70]);
    if ($conquistas !== null) {
        $h->career->achievements = $conquistas;
    }
    return $h;
}

/** A semente do replay da carreira como sorteada pelo servidor para a conta (o salvar das contas de v33Conta já faz). */
function v34Salvar(Navegador $n, stdClass $h, bool $liberar = true): Resposta
{
    return salvarC($n, $h, 'manual', $liberar);
}

/** Os emblemas (slugs ativos) da conta, direto no banco. */
function v34Emblemas(int $uid): array
{
    return array_map('strval', array_column(q("SELECT d.slug FROM emblemas_usuario e JOIN desafios d ON d.id = e.desafio_id WHERE e.usuario_id = ?
        AND e.estado = 'ativo' ORDER BY d.slug", [$uid]), 'slug'));
}

function v34Conq(Navegador $n): array
{
    return $n->pedir('GET', '/api/conquistas.php')->json ?? [];
}

/** O desafio público de emblema pelo slug. */
function v34Pub(string $slug): ?array
{
    return v33Publico($slug);
}

$V34_IDS = $idsPhp['ids'] ?? []; // as 87 (o teste da v3.3 leu do servidor e conferiu com o jogo)
$V34_BASE = dirname($CONFIG_ARQ);

// ══ 1. banco e semeadura ═════════════════════════════════════════════════════════════════════════

secao('v3.4 · banco: colunas e tabela novas, _esquema 34 e os 10 desafios de emblema semeados ativos (uma vez só)');
$r = v34Limpar();
$colunas = static fn(string $t): array => array_column(q("SHOW COLUMNS FROM $t"), 'Field');
checar('carreiras: champions, n_clubes, mesmo_clube, copas_selecao, pais_inicio, conquistas, conquistas_v, prova_ok, prova_verificacao; conquistas_usuario: prova_pk, provada_em, origem; desafios: modo, dificuldade, emblema, home; tabela emblemas_usuario',
    !array_diff(['champions', 'n_clubes', 'mesmo_clube', 'copas_selecao', 'pais_inicio', 'conquistas', 'conquistas_v', 'prova_ok', 'prova_verificacao'], $colunas('carreiras'))
    && !array_diff(['prova_pk', 'provada_em', 'origem'], $colunas('conquistas_usuario')) && !array_diff(['modo', 'dificuldade', 'emblema', 'home'], $colunas('desafios'))
    && count(q("SHOW TABLES LIKE 'emblemas_usuario'")) === 1);
checar('site_config._esquema = 34', (int) v("SELECT valor FROM site_config WHERE chave = '_esquema'") === 34);
$emb = q("SELECT slug, ativo, modo, dificuldade, emblema, home, criterio, requisitos, premio, inicio, regulamento FROM desafios WHERE modo = 'emblema' ORDER BY ordem");
$porSlug = array_column($emb, null, 'slug');
checar('instalar semeou os 10 de emblema ATIVOS (v34.desafios = 10), com dificuldade, emblema, critério da calibração, sem requisito de conta, prêmio vazio e o início de agora',
    $r->status === 200 && ($r->json['v34']['desafios'] ?? null) === 10 && count($emb) === 10 && array_unique(array_column($emb, 'ativo')) === [1]
    && array_column($emb, 'slug') === ['noite-de-gala', 'andarilho-campeao', 'bandeira-do-clube', 'hexa-e-gloria-eterna', 'era-de-ouro', 'artilheiro-do-mundo',
        'bi-do-mundo-bi-da-america', 'imortal', 'tacas-do-rei-emblema', 'mil-gols-e-o-tri']
    && array_count_values(array_column($emb, 'dificuldade')) === ['facil' => 3, 'medio' => 3, 'dificil' => 2, 'lendario' => 2]
    && json_decode((string) $porSlug['noite-de-gala']['criterio'], true) === ['bolasOuro' => 1, 'champions' => 1]
    && json_decode((string) $porSlug['hexa-e-gloria-eterna']['criterio'], true) === ['copas' => 1, 'libertadores' => 2, 'bolasOuro' => 1, 'nacionalidade' => ['BRA'], 'copasPelaSelecao' => 1]
    && json_decode((string) $porSlug['mil-gols-e-o-tri']['criterio'], true) === ['copas' => 3, 'gols' => 1001]
    && json_decode((string) $porSlug['noite-de-gala']['emblema'], true) === ['icone' => 'star', 'cor' => '#b98652']
    && json_decode((string) $porSlug['noite-de-gala']['requisitos'], true) === ['partidasMin' => 0, 'emailVerificado' => false, 'publicadoNoHall' => false, 'top3Perfil' => false]
    && array_unique(array_column($emb, 'premio')) === [''] && !in_array(null, array_column($emb, 'inicio'), true)
    && str_contains((string) $porSlug['noite-de-gala']['regulamento'], 'Ganha o emblema toda conta') && str_contains((string) $porSlug['noite-de-gala']['regulamento'], '1 de cada 12'),
    $r->resumo());
$rei = $porSlug['tacas-do-rei-emblema'] ?? [];
checar('As Taças do Rei ganham a versão emblema: lendária, ativa, 3 Copas + 2 Libertadores, na faixa da tela inicial (como noite-de-gala e hexa-e-gloria-eterna)',
    ($rei['dificuldade'] ?? '') === 'lendario' && (int) ($rei['ativo'] ?? 0) === 1 && json_decode((string) ($rei['criterio'] ?? ''), true) === ['copas' => 3, 'libertadores' => 2]
    && array_column(array_filter($emb, static fn($d) => (int) $d['home'] === 1), 'slug') === ['noite-de-gala', 'hexa-e-gloria-eterna', 'tacas-do-rei-emblema']);
$fab = q("SELECT slug, ativo, modo FROM desafios WHERE slug IN ('tacas-do-rei', 'tacas-do-rei-copas', 'todas-as-conquistas') ORDER BY ordem");
checar('os 3 de prêmio da v3.3 continuam desativados (modo primeiro)', count($fab) === 3 && array_sum(array_map('intval', array_column($fab, 'ativo'))) === 0
    && array_unique(array_column($fab, 'modo')) === ['primeiro'], json_encode($fab));
q("UPDATE desafios SET ativo = 0, titulo = 'Mudado pelo admin' WHERE slug = 'era-de-ouro'");
q("DELETE FROM desafios WHERE slug = 'imortal'");
$r = $anon->pedir('POST', '/api/instalar.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
checar('instalar de novo: idempotente (alteracoes [], v34 tudo 0, faltam 0); semeia uma vez só: o que o admin mudou fica, o apagado não volta',
    $r->status === 200 && ($r->json['alteracoes'] ?? null) === [] && ($r->json['v34'] ?? null) === ['carreiras' => 0, 'desafios' => 0, 'contas' => 0, 'provas' => 0, 'emblemas' => 0]
    && ($r->json['preenchidas']['faltam'] ?? -1) === 0 && v("SELECT titulo FROM desafios WHERE slug = 'era-de-ouro'") === 'Mudado pelo admin'
    && (int) v("SELECT ativo FROM desafios WHERE slug = 'era-de-ouro'") === 0 && (int) v("SELECT COUNT(*) FROM desafios WHERE slug = 'imortal'") === 0, $r->resumo());
$r = v34Limpar(); // de volta os 10, ativos
checar('(preparação) os 10 de emblema de volta', (int) v("SELECT COUNT(*) FROM desafios WHERE modo = 'emblema' AND ativo = 1") === 10, $r->resumo());
$r = $anon->pedir('GET', '/api/desafios.php');
$pubs = array_column($r->json['desafios'] ?? [], null, 'slug');
$pg = $pubs['noite-de-gala'] ?? [];
checar('desafios.php: os de emblema aparecem com modo, dificuldade, emblema, home e ganharam (0); sem vencedor; os de prêmio desativados não aparecem', $r->status === 200
    && count($pubs) === 10 && ($pg['modo'] ?? '') === 'emblema' && ($pg['dificuldade'] ?? '') === 'facil' && ($pg['emblema'] ?? null) === ['icone' => 'star', 'cor' => '#b98652']
    && ($pg['home'] ?? null) === true && ($pg['ganharam'] ?? null) === 0 && nulo($pg, 'vencedor') && !isset($pubs['tacas-do-rei'])
    && ($pubs['andarilho-campeao']['home'] ?? null) === false && $r->cab1('cache-control') === 'public, max-age=60', $r->resumo());
$ts = (string) file_get_contents(dirname($SRC) . '/src/engine/career/achievements.ts');
preg_match_all("/\bid: '([a-z0-9_.:-]+)'/", $ts, $mm);
checar('as 87 conquistas do servidor continuam as do jogo (os ids não mudaram com as regras novas)', count($mm[1]) === 87 && $mm[1] === $V34_IDS);

// ══ 2. conquistas provadas ═══════════════════════════════════════════════════════════════════════

secao('v3.4 · conquistas provadas: só a carreira com semente do servidor + replay prova; nada some; verificação em lote');
resetarLimitesCurtos();
[$navP, $uidP] = v33Conta('Prova Um');
$navP->pedir('POST', '/api/conquistas.php', ['acao' => 'sincronizar', 'conquistas' => [['id' => 'goat', 'em' => '2026-10-01T10:00:00Z'],
    ['id' => 'first_title', 'em' => '2026-10-02T10:00:00Z'], ['id' => 'inventada_x']]]);
$c0 = v34Conq($navP);
$porId0 = array_column($c0['conquistas'] ?? [], null, 'id');
checar('conquistas.php: as do aparelho entram como não provadas (provada false, carreira null); contagens só das 87 (provadas 0, naoProvadas 2, total 87)',
    count($porId0) === 3 && ($porId0['goat']['provada'] ?? null) === false && ($porId0['goat']['verificada'] ?? null) === false
    && array_key_exists('carreira', $porId0['goat'] ?? []) && $porId0['goat']['carreira'] === null
    && ($c0['provadas'] ?? -1) === 0 && ($c0['naoProvadas'] ?? -1) === 2 && ($c0['verificadas'] ?? -1) === 0 && ($c0['total'] ?? 0) === 87, json_encode($c0));
$lista1 = ['first_title', 'ballon_dor', 'orelhuda', 'goals_100', 'inventada_y', 'ballon_dor'];
$h1 = v34Hall('v34-p1', [], $lista1);
$r = v34Salvar($navP, $h1);
$guardada = json_decode((string) v('SELECT conquistas FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uidP, 'v34-p1']), true);
$cP = v34Conq($navP);
$porIdP = array_column($cP['conquistas'] ?? [], null, 'id');
checar('salvar a carreira-prova: guarda a lista do motor (career.achievements, só os 87 ids, sem repetir) e responde provasNovas (as que passaram a ter prova)',
    $r->status === 200 && $guardada === ['first_title', 'ballon_dor', 'orelhuda', 'goals_100'] && ($r->json['provasNovas'] ?? null) === ['first_title', 'ballon_dor', 'orelhuda', 'goals_100'],
    $r->resumo());
checar('…conquistas.php: as 4 provadas (carreira = o id do HallEntry); a do aparelho que ela prova vira provada (a data fica a do aparelho); as que o aparelho nunca mandou entram (origem carreira)',
    ($cP['provadas'] ?? -1) === 4 && ($cP['naoProvadas'] ?? -1) === 1 && ($porIdP['first_title']['provada'] ?? null) === true
    && ($porIdP['first_title']['carreira'] ?? '') === 'v34-p1' && ($porIdP['first_title']['em'] ?? '') === '2026-10-02T10:00:00Z'
    && ($porIdP['goat']['provada'] ?? null) === false && ($porIdP['orelhuda']['provada'] ?? null) === true
    && v('SELECT origem FROM conquistas_usuario WHERE usuario_id = ? AND conquista_id = ?', [$uidP, 'orelhuda']) === 'carreira'
    && v('SELECT origem FROM conquistas_usuario WHERE usuario_id = ? AND conquista_id = ?', [$uidP, 'first_title']) === 'aparelho'
    && (int) v('SELECT prova_pk FROM conquistas_usuario WHERE usuario_id = ? AND conquista_id = ?', [$uidP, 'orelhuda']) === pkCarreira('v34-p1', $uidP), json_encode($cP));
$cl = $navP->pedir('GET', '/api/carreiras.php')->json['carreiras'] ?? [];
$cp1 = array_values(array_filter($cl, static fn($c) => ($c['id'] ?? '') === 'v34-p1'))[0] ?? [];
checar('C.prova da carreira-prova: {conquistas: 4, unicas: 4, verificada: null}', ($cp1['prova'] ?? null) === ['conquistas' => 4, 'unicas' => 4, 'verificada' => null], json_encode($cp1));
// carreiras que não provam: sem semente do servidor (salva como quem jogou sem a conta), Imersivo, suspeita
[$navQ, $uidQ] = novaConta('Sem Semente');
q('UPDATE usuarios SET email_verificado_em = UTC_TIMESTAMP(), partidas_conta = 30 WHERE id = ?', [$uidQ]);
$r = v34Salvar($navQ, v34Hall('v34-q1', [], ['first_title', 'ballon_dor']));
$cQ = v34Conq($navQ);
checar('carreira sem a semente do servidor (sem_semente): a lista não é guardada, nada vira provado, C.prova null', $r->status === 200
    && v('SELECT conquistas FROM carreiras WHERE usuario_id = ?', [$uidQ]) === null && ($r->json['provasNovas'] ?? null) === [] && ($cQ['provadas'] ?? -1) === 0
    && nulo($r->json['carreira'] ?? null, 'prova'), $r->resumo());
$hI = v34Hall('v34-p-imersivo', ['modo' => 'immersive'], ['the_best']);
$r = v34Salvar($navP, $hI);
checar('carreira do Imersivo: o replay sai, nada é guardado nem provado', $r->status === 200 && v('SELECT conquistas FROM carreiras WHERE carreira_id = ?', ['v34-p-imersivo']) === null
    && !in_array('the_best', array_column(array_filter(v34Conq($navP)['conquistas'] ?? [], static fn($c) => $c['provada'] ?? false), 'id'), true), $r->resumo());
$r = v34Salvar($navP, v34Hall('v34-p-susp', ['gols' => 99999], ['kopa']));
checar('carreira suspeita (números impossíveis): a lista fica guardada, mas não prova (kopa não provada)', $r->status === 200
    && v('SELECT suspeita FROM carreiras WHERE carreira_id = ?', ['v34-p-susp']) !== null && ($r->json['provasNovas'] ?? null) === []
    && v('SELECT prova_pk FROM conquistas_usuario WHERE usuario_id = ? AND conquista_id = ?', [$uidP, 'kopa']) === null, $r->resumo());
// uma segunda carreira-prova com parte das mesmas: unicas
$h2 = v34Hall('v34-p2', ['nota' => 71], ['ballon_dor', 'the_best', 'goals_300']);
$h2->replay = json_decode(json_encode(v33Replay(1)), false);
$h2->conquistas = (object) ['v' => 2, 'ids' => ['ballon_dor', 'the_best', 'goals_300']]; // como o jogo da v3.4 grava
$r = v34Salvar($navP, $h2);
$cl = array_column($navP->pedir('GET', '/api/carreiras.php')->json['carreiras'] ?? [], null, 'id');
checar('outra carreira-prova (outro replay): provasNovas só as que eram novas; unicas de cada uma', $r->status === 200 && ($r->json['provasNovas'] ?? null) === ['the_best', 'goals_300']
    && ($cl['v34-p1']['prova'] ?? null) === ['conquistas' => 4, 'unicas' => 3, 'verificada' => null]
    && ($cl['v34-p2']['prova'] ?? null) === ['conquistas' => 3, 'unicas' => 2, 'verificada' => null], $r->resumo() . ' ' . json_encode($cl['v34-p1']['prova'] ?? null));
// ?r=provas e ?r=carreira
$pk1 = pkCarreira('v34-p1', $uidP);
$pk2 = pkCarreira('v34-p2', $uidP);
$r = v33Get('r=provas&usuario=' . $uidP);
$itP = array_column($r->json['carreiras'] ?? [], null, 'pk');
checar('?r=provas: a conta, as contagens com o que falta provar e verificar, as carreiras-prova (conquistas, unicas, essencial, vale, provaOk) e o link do lote',
    $r->status === 200 && ($r->json['usuario']['id'] ?? 0) === $uidP && ($r->json['conquistas']['provadas'] ?? 0) === 6 && ($r->json['conquistas']['verificadas'] ?? -1) === 0
    && count($r->json['conquistas']['faltamProvar'] ?? []) === 81 && count($r->json['conquistas']['faltamVerificar'] ?? []) === 87
    && ($itP[$pk1]['essencial'] ?? null) === true && ($itP[$pk2]['essencial'] ?? null) === true && ($itP[$pk1]['vale'] ?? null) === true
    && ($itP[$pk1]['unicas'] ?? null) === ['first_title', 'orelhuda', 'goals_100'] && nulo($itP[$pk1] ?? null, 'provaOk')
    && ($itP[$pk1]['conquistasV'] ?? null) === 1 && ($itP[$pk2]['conquistasV'] ?? null) === 2
    && isset($itP[pkCarreira('v34-p-susp', $uidP)]) && ($itP[pkCarreira('v34-p-susp', $uidP)]['vale'] ?? null) === false
    && ($itP[pkCarreira('v34-p-susp', $uidP)]['motivo'] ?? '') === 'suspeita' && ($r->json['links']['lote'] ?? '') === '/lenda/#/verificar?conta=' . $uidP
    && ($itP[$pk1]['links']['verificar'] ?? '') === '/lenda/#/verificar?id=' . $pk1 . '&prova=1', $r->resumo());
$r = v33Get('r=carreira&id=' . $pk1);
checar('?r=carreira: meta.conquistas (a lista guardada), conquistasV (sem HallEntry.conquistas.v: 1), meta.prova, meta.provaOk e os números dos critérios novos (champions, nClubes, mesmoClube, copasSelecao, paisInicio)',
    $r->status === 200 && ($r->json['meta']['conquistas'] ?? null) === ['first_title', 'ballon_dor', 'orelhuda', 'goals_100'] && ($r->json['meta']['prova'] ?? null) === true
    && ($r->json['meta']['conquistasV'] ?? null) === 1
    && nulo($r->json['meta'] ?? null, 'provaOk') && ($r->json['meta']['champions'] ?? null) === 4 && ($r->json['meta']['nClubes'] ?? null) === 11
    && ($r->json['meta']['mesmoClube'] ?? null) === 7 && ($r->json['meta']['copasSelecao'] ?? null) === 0 && ($r->json['meta']['paisInicio'] ?? null) === 'BRA', $r->resumo());
// prova_verificar: poderes e entradas
[$navLeitor34] = navEquipe('leitor');
[$navMod34] = navEquipe('moderador');
$r = $navLeitor34->pedir('POST', '/api/admin.php', ['acao' => 'prova_verificar', 'resultados' => [['carreira' => $pk1, 'ok' => true]]]);
$rJ = $navP->pedir('POST', '/api/admin.php', ['acao' => 'prova_verificar', 'resultados' => [['carreira' => $pk1, 'ok' => true]]]);
checar('prova_verificar: leitor → 403 sem_poder; jogador → 401', $r->status === 403 && $r->erro() === 'sem_poder' && $rJ->status === 401, $r->resumo());
$ruins = [];
foreach ([null, [], 'x', [['carreira' => 'a', 'ok' => true]], [['carreira' => $pk1]], [['carreira' => $pk1, 'ok' => 'sim']], [['carreira' => $pk1, 'ok' => true, 'detalhes' => 'x']],
    [['carreira' => $pk1, 'ok' => true, 'detalhes' => ['x' => str_repeat('a', 9000)]]], array_fill(0, 51, ['carreira' => $pk1, 'ok' => true]), ['a' => 1], [1.5]] as $x) {
    $r = v33Adm(['acao' => 'prova_verificar', 'resultados' => $x]);
    if ($r->status !== 400 || $r->erro() !== 'resultados') {
        $ruins[] = substr(json_encode($x), 0, 40) . " → $r->status " . $r->erro();
    }
}
checar('prova_verificar com resultados errados (vazio, texto, carreira inválida, sem ok, detalhes grandes, 51 itens) → 400 resultados, nunca 500', !$ruins, implode('; ', $ruins));
$r = $navMod34->pedir('POST', '/api/admin.php', ['acao' => 'prova_verificar', 'resultados' => [['carreira' => $pk1, 'ok' => true, 'detalhes' => ['v' => 1, 'conquistas' => true]],
    ['carreira' => 999999, 'ok' => true], ['carreira' => pkCarreira('v34-q1', $uidQ), 'ok' => true]]]);
$cP = v34Conq($navP);
checar('prova_verificar (moderador): a que bateu fica verificada; a que não existe e a que não é prova → pulados; contas: {provadas, verificadas}; registro sem o texto',
    $r->status === 200 && ($r->json['carreiras'] ?? null) === [['pk' => $pk1, 'provaOk' => true]]
    && ($r->json['pulados'] ?? null) === [['carreira' => 999999, 'motivo' => 'nao_encontrada'], ['carreira' => pkCarreira('v34-q1', $uidQ), 'motivo' => 'sem_prova']]
    && ($r->json['contas'][(string) $uidP] ?? null) === ['provadas' => 6, 'verificadas' => 4, 'total' => 87] && ($cP['verificadas'] ?? -1) === 4
    && (array_column($cP['conquistas'] ?? [], null, 'id')['ballon_dor']['verificada'] ?? null) === true
    && (int) v('SELECT prova_ok FROM carreiras WHERE id = ?', [$pk1]) === 1 && acUltimoLog('prova_verificar') !== null
    && str_starts_with((string) (acUltimoLog('prova_verificar')['alvo'] ?? ''), 'usuario:'), $r->resumo());
// a verificada passa a ser a prova de ballon_dor (as duas a têm)
checar('com duas carreiras com a mesma conquista, a prova é a verificada', (int) v('SELECT prova_pk FROM conquistas_usuario WHERE usuario_id = ? AND conquista_id = ?', [$uidP, 'ballon_dor']) === $pk1);
// salvar de novo com outro conteúdo zera a verificação; não bateu tira a carreira das provas (nada some da conta)
$h1b = v34Hall('v34-p1', ['headline' => 'Outra frase'], $lista1);
v34Salvar($navP, $h1b);
checar('salvar a carreira de novo com outro conteúdo: a verificação dela não vale mais (prova_ok volta a null)', v('SELECT prova_ok FROM carreiras WHERE id = ?', [$pk1]) === null
    && (v34Conq($navP)['verificadas'] ?? -1) === 0);
$r = v33Adm(['acao' => 'prova_verificar', 'resultados' => [['carreira' => $pk2, 'ok' => false, 'detalhes' => ['motivo' => 'Conquistas: goals_300 a mais']]]]);
$cP = v34Conq($navP);
$porIdP = array_column($cP['conquistas'] ?? [], null, 'id');
checar('não bateu: a carreira deixa de provar (as que só ela provava voltam a não provadas, mas ficam na conta); a de duas continua provada pela outra',
    $r->status === 200 && ($r->json['carreiras'][0]['provaOk'] ?? null) === false && ($porIdP['goals_300']['provada'] ?? null) === false
    && ($porIdP['the_best']['provada'] ?? null) === false && isset($porIdP['goals_300']) && ($porIdP['ballon_dor']['provada'] ?? null) === true && ($cP['provadas'] ?? 0) === 4
    && str_contains((string) v('SELECT prova_verificacao FROM carreiras WHERE id = ?', [$pk2]), 'goals_300 a mais'), json_encode($cP));
// apagar a carreira-prova: nada some
$antesN = count(v34Conq($navP)['conquistas'] ?? []);
$r = $navP->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => 'v34-p1']);
$cP = v34Conq($navP);
checar('apagar a carreira-prova: as conquistas continuam na conta, sem prova (nada some)', $r->status === 200 && count($cP['conquistas'] ?? []) === $antesN
    && ($cP['provadas'] ?? -1) === 0 && (int) v('SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id = ? AND prova_pk IS NOT NULL', [$uidP]) === 0, json_encode($cP));

// ══ 3. o desafio de todas as conquistas pela prova ═════════════════════════════════════════════

secao('v3.4 · todas as conquistas: ativa, só as provadas contam, verifica com as carreiras verificadas e tem vencedor');
v34ZerarPremio();
$r = v33Ativar('todas-as-conquistas');
checar('desafio_ativar do de todas as conquistas → 200 (o §E da v3.3 foi trocado pela prova)', $r->status === 200 && ($r->json['desafio']['ativo'] ?? null) === true, $r->resumo());
[$navT, $uidT] = v33Conta('Todas Provadas');
$navT->pedir('POST', '/api/conquistas.php', ['acao' => 'sincronizar', 'conquistas' => array_map(static fn(string $id): array => ['id' => $id], $V34_IDS)]);
$semCand = count(array_filter(v33Cands('todas-as-conquistas'), static fn($k) => (int) $k['usuario_id'] === $uidT)) === 0;
$euT = v33Eu($navT, 'todas-as-conquistas');
checar('as 87 só do aparelho: nenhum candidato; eu: conquistas (provadas) 0, conquistasTodas 87, conquistasVerificadas 0', $semCand && ($euT['conquistas'] ?? -1) === 0
    && ($euT['conquistasTodas'] ?? 0) === 87 && ($euT['conquistasVerificadas'] ?? -1) === 0 && ($euT['conquistasTotal'] ?? 0) === 87, json_encode($euT));
$hA = v34Hall('v34-t1', [], array_slice($V34_IDS, 0, 50));
$hB = v34Hall('v34-t2', ['nota' => 72], array_slice($V34_IDS, 40));
$hB->replay = json_decode(json_encode(v33Replay(2)), false);
v34Salvar($navT, $hA);
$semCand2 = count(array_filter(v33Cands('todas-as-conquistas'), static fn($k) => (int) $k['usuario_id'] === $uidT)) === 0;
$r = v34Salvar($navT, $hB);
$kT = array_values(array_filter(v33Cands('todas-as-conquistas'), static fn($k) => (int) $k['usuario_id'] === $uidT))[0] ?? [];
checar('50 provadas não bastam; com a segunda carreira-prova, as 87 provadas → candidato pendente da conta (sem carreira)', $semCand2 && $r->status === 200
    && ($kT['estado'] ?? '') === 'pendente' && nulo($kT, 'carreira_pk') && ($kT['chave'] ?? '') === 'u' . $uidT, json_encode($kT));
$K = array_values(array_filter(v33Get('r=desafio&id=' . v33IdDesafio('todas-as-conquistas'))->json['candidatos']['itens'] ?? [], static fn($k) => ($k['id'] ?? 0) === (int) ($kT['id'] ?? -1)))[0] ?? [];
checar('K do candidato de conquistas: o link do lote do #/verificar (?conta=&candidato=)', ($K['links']['verificar'] ?? '') === '/lenda/#/verificar?conta=' . $uidT . '&candidato=' . ($kT['id'] ?? ''),
    json_encode($K['links'] ?? null));
$r = v33Adm(['acao' => 'candidato_verificar', 'id' => (int) ($kT['id'] ?? 0), 'resultado' => ['ok' => true, 'detalhes' => ['v' => 1, 'manual' => true]]]);
$r2 = v33Adm(['acao' => 'desafio_declarar_vencedor', 'candidatoId' => (int) ($kT['id'] ?? 0)]);
checar('antes de verificar as carreiras: "bateu" → 409 sem_prova com faltam (as 87); declarar → 409', $r->status === 409 && $r->erro() === 'sem_prova'
    && count($r->json['faltam'] ?? []) === 87 && $r2->status === 409, $r->resumo());
$pkA = pkCarreira('v34-t1', $uidT);
$pkB = pkCarreira('v34-t2', $uidT);
$rv = v33Adm(['acao' => 'prova_verificar', 'resultados' => [['carreira' => $pkA, 'ok' => true]]]);
$k1 = q('SELECT estado FROM desafio_candidatos WHERE id = ?', [(int) ($kT['id'] ?? 0)])[0]['estado'] ?? '';
$rv = v33Adm(['acao' => 'prova_verificar', 'resultados' => [['carreira' => $pkB, 'ok' => true]]]);
$k2 = q('SELECT * FROM desafio_candidatos WHERE id = ?', [(int) ($kT['id'] ?? 0)])[0] ?? [];
checar('verificar em lote: com uma só verificada continua pendente; com as duas (as 87 verificadas) o candidato vira verificado sozinho (verificacao.provas)',
    $k1 === 'pendente' && ($k2['estado'] ?? '') === 'verificada' && str_contains((string) ($k2['verificacao'] ?? ''), '"provas":true')
    && ($rv->json['contas'][(string) $uidT]['verificadas'] ?? 0) === 87, json_encode($k2));
$r = v33Adm(['acao' => 'desafio_declarar_vencedor', 'candidatoId' => (int) ($kT['id'] ?? 0)]);
checar('declarar o vencedor do de todas as conquistas → 200 (as 87 provadas e verificadas)', $r->status === 200 && ($r->json['desafio']['vencedor']['usuario']['id'] ?? 0) === $uidT, $r->resumo());
v33Adm(['acao' => 'desafio_reabrir', 'id' => v33IdDesafio('todas-as-conquistas'), 'motivo' => 'teste v3.4']);
v34ZerarPremio();

// ══ 4. desafios de emblema ═══════════════════════════════════════════════════════════════════════

secao('v3.4 · emblemas: todo mundo que cumpre ganha, sozinho e uma vez; critérios novos; sem prova não ganha; o admin tira e devolve');
// v-intenso-01: 12 Bolas, 4 Champions, 1 Copa, 794 gols, 11 clubes, 7 temporadas no mesmo clube; a seleção do replay (BRA) ≠ a do fim (NED)
[$navE, $uidE] = v33Conta('Emblema Um');
$r = v34Salvar($navE, v34Hall('v34-e1', [], ['ballon_dor']));
$novos = array_column($r->json['emblemasNovos'] ?? [], 'slug');
sort($novos);
checar('salvar a carreira-prova dá os emblemas que ela cumpre na hora (emblemasNovos: noite-de-gala e era-de-ouro, com título, ícone, cor e dificuldade); nenhum outro',
    $r->status === 200 && $novos === ['era-de-ouro', 'noite-de-gala'] && v34Emblemas($uidE) === ['era-de-ouro', 'noite-de-gala']
    && (array_column($r->json['emblemasNovos'] ?? [], null, 'slug')['noite-de-gala'] ?? null) === ['slug' => 'noite-de-gala', 'titulo' => 'Noite de gala', 'icone' => 'star',
        'cor' => '#b98652', 'dificuldade' => 'facil'], $r->resumo());
$r = v34Salvar($navE, v34Hall('v34-e1', [], ['ballon_dor']));
$r2 = v34Salvar($navE, v34Hall('v34-e2', ['nota' => 73], ['ballon_dor']));
$navE->pedir('POST', '/api/conquistas.php', ['acao' => 'sincronizar', 'conquistas' => [['id' => 'goat']]]);
checar('idempotente: salvar de novo, outra carreira que também cumpre e outra avaliação não dão de novo (um por conta e desafio)', ($r->json['emblemasNovos'] ?? null) === []
    && ($r2->json['emblemasNovos'] ?? null) === [] && (int) v('SELECT COUNT(*) FROM emblemas_usuario WHERE usuario_id = ?', [$uidE]) === 2
    && (int) v("SELECT carreira_pk FROM emblemas_usuario e JOIN desafios d ON d.id = e.desafio_id WHERE e.usuario_id = ? AND d.slug = 'noite-de-gala'", [$uidE]) === pkCarreira('v34-e1', $uidE));
// sem prova não ganha
$r = v34Salvar($navQ, v34Hall('v34-q2', ['nota' => 74], []));
$euQ = v33Eu($navQ, 'noite-de-gala');
$cqQ = array_column($euQ['carreirasQueCumprem'] ?? [], null, 'carreiraId');
checar('carreira sem prova (sem a semente do servidor) que cumpre o critério: não ganha; ?eu=1 mostra a carreira com o motivo sem_semente e emblema null',
    v34Emblemas($uidQ) === [] && nulo($euQ, 'emblema') && ($cqQ['v34-q2']['vale'] ?? null) === false && ($cqQ['v34-q2']['motivo'] ?? '') === 'sem_semente'
    && is_string($cqQ['v34-q2']['motivoTexto'] ?? null), json_encode($euQ));
// ?eu=1 com emblemas no topo e eu.emblema
$r = $navE->pedir('GET', '/api/desafios.php?eu=1');
$euE = array_column($r->json['desafios'] ?? [], null, 'slug');
$topo = array_column($r->json['emblemas'] ?? [], 'slug');
checar('?eu=1: emblemas da conta no topo (os mais difíceis antes: era-de-ouro, médio, antes de noite-de-gala) e eu.emblema {estado ativo, em, carreiraId}; o público conta ganharam',
    $r->status === 200 && $topo === ['era-de-ouro', 'noite-de-gala'] && ($euE['noite-de-gala']['eu']['emblema']['estado'] ?? '') === 'ativo'
    && ($euE['noite-de-gala']['eu']['emblema']['carreiraId'] ?? '') === 'v34-e1' && preg_match($RE_ISO_MS, (string) ($euE['noite-de-gala']['eu']['emblema']['em'] ?? '')) === 1
    && nulo($euE['noite-de-gala']['eu'] ?? null, 'candidato') && nulo($euE['andarilho-campeao']['eu'] ?? null, 'emblema')
    && ($r->json['emblemas'][0] ?? null) !== null && array_keys($r->json['emblemas'][0]) === ['slug', 'titulo', 'icone', 'cor', 'dificuldade', 'em', 'carreiraId', 'jogador']
    && ($ganhNG = (int) v("SELECT COUNT(*) FROM emblemas_usuario e JOIN usuarios u ON u.id = e.usuario_id JOIN desafios d ON d.id = e.desafio_id
        WHERE d.slug = 'noite-de-gala' AND e.estado = 'ativo' AND u.status = 'ativo'")) >= 1 && (v34Pub('noite-de-gala')['ganharam'] ?? 0) === $ganhNG,
    json_encode($r->json['emblemas'] ?? null));
// critérios novos: nacionalidade + copasPelaSelecao (hexa), clubes, temporadasMesmoClube, nota, gols
[$navB, $uidB] = v33Conta('Hexa Brasil');
$hx = v34Hall('v34-hexa', ['pais' => 'BRA'], ['hexa'], 1, 2);
foreach ($hx->summary->national->trophies as $t) {
    if (($t->trophyId ?? '') === 'world-cup') {
        $t->teamId = 'BRA';
    }
}
$hxNao = v34Hall('v34-hexa-nao', ['pais' => 'BRA', 'nota' => 75], ['hexa'], 1, 2); // a Copa pela Holanda (teamId NED): não é o hexa
$hxNao->replay = json_decode(json_encode(v33Replay(3)), false);
$hxNao->replay->identity->nationality = 'BRA';
[$navB2, $uidB2] = v33Conta('Hexa Nao');
$rN = v34Salvar($navB2, $hxNao);
$rB = v34Salvar($navB, $hx);
checar('critério novo nacionalidade + copasPelaSelecao: brasileiro do começo ao fim com a Copa pelo Brasil, 2 Libertadores e Bola de Ouro → hexa-e-gloria-eterna; a Copa por outra seleção → não',
    in_array('hexa-e-gloria-eterna', v34Emblemas($uidB), true) && !in_array('hexa-e-gloria-eterna', v34Emblemas($uidB2), true)
    && (int) v('SELECT copas_selecao FROM carreiras WHERE carreira_id = ?', ['v34-hexa']) === 1 && v('SELECT pais_inicio FROM carreiras WHERE carreira_id = ?', ['v34-hexa']) === 'BRA'
    && (int) v('SELECT copas_selecao FROM carreiras WHERE carreira_id = ?', ['v34-hexa-nao']) === 0, $rB->resumo() . ' ' . $rN->resumo());
[$navT2, $uidT2] = v33Conta('Troca Selecao');
$hTroca = v34Hall('v34-troca', ['pais' => 'BRA', 'nota' => 76], [], 1, 2);
foreach ($hTroca->summary->national->trophies as $t) {
    if (($t->trophyId ?? '') === 'world-cup') {
        $t->teamId = 'BRA';
    }
}
$hTroca->replay = json_decode(json_encode(v33Replay(4)), false);
$hTroca->replay->identity->nationality = 'ARG'; // começou argentino, terminou brasileiro
v34Salvar($navT2, $hTroca);
checar('quem trocou de seleção não vale para nacionalidade (a da criação, no replay, tem de ser a do fim)', !in_array('hexa-e-gloria-eterna', v34Emblemas($uidT2), true)
    && v('SELECT pais_inicio FROM carreiras WHERE carreira_id = ?', ['v34-troca']) === 'ARG');
[$navG, $uidG] = v33Conta('Muitos Gols');
$hG = v34Hall('v34-gols', ['gols' => 1200, 'nota' => 92, 'temporadas' => 24], [], 3, 2);
$rG = v34Salvar($navG, $hG);
$emG = v34Emblemas($uidG);
checar('critérios gols (> 1.000), nota (92, da versão atual) e Copas: Mil gols e o tri, Imortal, As Taças do Rei, Bi do mundo bi da América e Artilheiro do mundo; sem 12 clubes nem 18 temporadas num clube',
    !array_diff(['mil-gols-e-o-tri', 'imortal', 'tacas-do-rei-emblema', 'bi-do-mundo-bi-da-america', 'artilheiro-do-mundo'], $emG)
    && !in_array('andarilho-campeao', $emG, true) && !in_array('bandeira-do-clube', $emG, true), $rG->resumo() . ' ' . json_encode($emG));
[$navC, $uidC] = v33Conta('Andarilho');
$hC = v34Hall('v34-clubes', ['nota' => 77]);
$hC->summary->clubs = array_map(static fn(int $i): stdClass => (object) ['clubId' => 'x' . $i, 'seasons' => $i === 0 ? 18 : 1, 'apps' => 10, 'goals' => 1, 'assists' => 0,
    'trophies' => 0, 'loan' => false], range(0, 11));
$rC = v34Salvar($navC, $hC);
checar('critérios clubes (12 diferentes) e temporadasMesmoClube (18 num clube) + 20 títulos: Andarilho campeão e Bandeira do clube',
    !array_diff(['andarilho-campeao', 'bandeira-do-clube'], v34Emblemas($uidC)) && (int) v('SELECT n_clubes FROM carreiras WHERE carreira_id = ?', ['v34-clubes']) === 12
    && (int) v('SELECT mesmo_clube FROM carreiras WHERE carreira_id = ?', ['v34-clubes']) === 18, $rC->resumo());
// nota de outra versão não vale
[$navV, $uidV] = v33Conta('Nota Velha');
$hV = v34Hall('v34-nota-velha', ['gols' => 1200, 'nota' => 95, 'temporadas' => 24], [], 2, 0);
$hV->legacy->v = 1;
v34Salvar($navV, $hV);
checar('nota de outra versão dos pesos não vale para o critério nota (Imortal não)', !in_array('imortal', v34Emblemas($uidV), true) && in_array('artilheiro-do-mundo', v34Emblemas($uidV), true));
// perfil e Hall
q('UPDATE usuarios SET hall_publico = ? WHERE id = ?', ['auto', $uidE]);
integAdm('POST', '/api/admin.php', ['acao' => 'atualizar_hall']);
$codE = (string) v('SELECT codigo_convite FROM usuarios WHERE id = ?', [$uidE]);
$r = $anon->pedir('GET', '/api/perfil.php?c=' . $codE);
checar('perfil.php: emblemas [{slug, titulo, icone, cor, dificuldade}] (os mais difíceis antes) e conquistasProvadas; nada da carreira que deu o emblema', $r->status === 200
    && array_column($r->json['emblemas'] ?? [], 'slug') === ['era-de-ouro', 'noite-de-gala'] && array_keys($r->json['emblemas'][0] ?? []) === ['slug', 'titulo', 'icone', 'cor', 'dificuldade']
    && ($r->json['conquistasProvadas'] ?? -1) === 1, $r->resumo());
$h = hallGet();
$itE = array_values(array_filter($h->json['itens'] ?? [], static fn($i) => ($i['apelido'] ?? '') === 'Emblema Um'))[0] ?? [];
$hId = $anon->pedir('GET', '/api/hall.php?id=' . ($itE['id'] ?? 'x'));
checar('hall.php: o item leva emblemas (até 3, só slug, ícone e cor) e emblemasTotal; o hall.php?id= também', ($itE['emblemas'] ?? null) === [['slug' => 'era-de-ouro',
    'icone' => 'circle-dot', 'cor' => '#c8d0dc'], ['slug' => 'noite-de-gala', 'icone' => 'star', 'cor' => '#b98652']] && ($itE['emblemasTotal'] ?? 0) === 2
    && ($hId->json['emblemasTotal'] ?? 0) === 2 && count($hId->json['emblemas'] ?? []) === 2, json_encode($itE));
$hG2 = array_values(array_filter($h->json['itens'] ?? [], static fn($i) => ($i['apelido'] ?? '') === 'Muitos Gols'))[0] ?? null;
checar('…com mais de 3, só os 3 mais difíceis (os lendários primeiro) e o total', $hG2 === null || (count($hG2['emblemas'] ?? []) === 3 && ($hG2['emblemasTotal'] ?? 0) >= 5
    && in_array(($hG2['emblemas'][0]['slug'] ?? ''), ['tacas-do-rei-emblema', 'mil-gols-e-o-tri'], true)), json_encode($hG2));
// integração: o ?r=usuario manda o emblema e a dificuldade em E.desafio (o painel não precisa da lista dos desafios)
$r = v33Get('r=usuario&id=' . $uidE);
$euNG = array_values(array_filter($r->json['usuario']['emblemas'] ?? $r->json['emblemas'] ?? [], static fn($e) => ($e['desafio']['slug'] ?? '') === 'noite-de-gala'))[0] ?? [];
checar('?r=usuario: cada emblema da conta com desafio {id, slug, titulo, emblema {icone, cor}, dificuldade}', $r->status === 200
    && ($euNG['desafio']['emblema'] ?? null) === ['icone' => 'star', 'cor' => '#b98652'] && ($euNG['desafio']['dificuldade'] ?? null) === 'facil', json_encode($euNG));
// admin: D, ?r=desafio de emblema, retirar e devolver
$did = v33IdDesafio('noite-de-gala');
$nNG = (int) v("SELECT COUNT(*) FROM emblemas_usuario WHERE desafio_id = ? AND estado = 'ativo'", [$did]); // as contas com a carreira do v-intenso-01 (12 Bolas, 4 Champions)
// §E.1: a carreira-prova que o Prova Um apagou (seção 2) ainda não estava verificada: o emblema dela saiu pelo sistema
$rNG = (int) v("SELECT COUNT(*) FROM emblemas_usuario WHERE desafio_id = ? AND estado = 'retirado'", [$did]);
$r = v33Get('r=desafios');
$D = array_values(array_filter($r->json['itens'] ?? [], static fn($d) => ($d['slug'] ?? '') === 'noite-de-gala'))[0] ?? [];
checar('?r=desafios: D com modo, dificuldade, emblema, home e emblemas {ativos, retirados}', ($D['modo'] ?? '') === 'emblema' && ($D['dificuldade'] ?? '') === 'facil'
    && ($D['emblema'] ?? null) === ['icone' => 'star', 'cor' => '#b98652'] && ($D['home'] ?? null) === true && $nNG >= 2 && ($D['emblemas'] ?? null) === ['ativos' => $nNG, 'retirados' => $rNG], json_encode($D));
$r = v33Get('r=desafio&id=' . $did);
$E = array_values(array_filter($r->json['emblemas']['itens'] ?? [], static fn($e) => ($e['usuario']['id'] ?? 0) === $uidE))[0] ?? [];
checar('?r=desafio&id= de emblema: emblemas paginado (E: estado, em, usuário, carreira, links), candidatos vazio; filtro estado errado → 400', $r->status === 200
    && ($r->json['emblemas']['total'] ?? 0) === $nNG + $rNG && ($r->json['candidatos']['total'] ?? -1) === 0 && ($E['estado'] ?? '') === 'ativo'
    && ($E['carreira']['pk'] ?? 0) === pkCarreira('v34-e1', $uidE) && ($E['carreira']['existe'] ?? null) === true
    && ($E['links']['verificar'] ?? '') === '/lenda/#/verificar?id=' . pkCarreira('v34-e1', $uidE) . '&prova=1'
    && v33Get('r=desafio&id=' . $did . '&estado=sumido')->status === 400 && (v33Get('r=desafio&id=' . $did . '&estado=retirado')->json['emblemas']['total'] ?? -1) === $rNG, $r->resumo());
$r = $navLeitor34->pedir('POST', '/api/admin.php', ['acao' => 'emblema_retirar', 'id' => (int) ($E['id'] ?? 0), 'motivo' => 'x']);
$r1 = v33Adm(['acao' => 'emblema_retirar', 'id' => (int) ($E['id'] ?? 0)]);
$r2 = $navMod34->pedir('POST', '/api/admin.php', ['acao' => 'emblema_retirar', 'id' => (int) ($E['id'] ?? 0), 'motivo' => 'Carreira em análise.']);
$r3 = v33Adm(['acao' => 'emblema_retirar', 'id' => (int) ($E['id'] ?? 0), 'motivo' => 'De novo.']);
$r4 = v33Adm(['acao' => 'emblema_retirar', 'id' => 999999, 'motivo' => 'x']);
checar('emblema_retirar: leitor → 403; sem motivo → 400; moderador → 200 (E retirado com o motivo e quem); de novo → 409 ja_retirado; não existe → 404',
    $r->status === 403 && $r1->status === 400 && $r2->status === 200 && ($r2->json['emblema']['estado'] ?? '') === 'retirado'
    && ($r2->json['emblema']['motivo'] ?? '') === 'Carreira em análise.' && ($r2->json['emblema']['quem']['codigo'] ?? null) !== null
    && $r3->status === 409 && $r3->erro() === 'ja_retirado' && $r4->status === 404, $r2->resumo());
v34Salvar($navE, v34Hall('v34-e3', ['nota' => 78], []));
$euR = v33Eu($navE, 'noite-de-gala');
checar('retirado: some do perfil e do ?eu=1 (topo), o eu.emblema diz retirado com o motivo; a avaliação não dá de novo', !in_array('noite-de-gala', v34Emblemas($uidE), true)
    && !in_array('noite-de-gala', array_column($anon->pedir('GET', '/api/perfil.php?c=' . $codE)->json['emblemas'] ?? [], 'slug'), true)
    && ($euR['emblema']['estado'] ?? '') === 'retirado' && ($euR['emblema']['motivo'] ?? '') === 'Carreira em análise.'
    && (int) v('SELECT COUNT(*) FROM emblemas_usuario WHERE usuario_id = ? AND desafio_id = ?', [$uidE, $did]) === 1, json_encode($euR));
$r = v33Adm(['acao' => 'emblema_devolver', 'id' => (int) ($E['id'] ?? 0)]);
$r2 = v33Adm(['acao' => 'emblema_devolver', 'id' => (int) ($E['id'] ?? 0)]);
checar('emblema_devolver → 200 (ativo de novo); de novo → 409 ja_ativo; os dois no registro', $r->status === 200 && ($r->json['emblema']['estado'] ?? '') === 'ativo'
    && $r2->status === 409 && $r2->erro() === 'ja_ativo' && in_array('noite-de-gala', v34Emblemas($uidE), true)
    && acUltimoLog('emblema_retirar') !== null && acUltimoLog('emblema_devolver') !== null, $r->resumo());
// não bateu na verificação: os emblemas que a carreira deu saem
$pkG = pkCarreira('v34-gols', $uidG);
v33Adm(['acao' => 'prova_verificar', 'resultados' => [['carreira' => $pkG, 'ok' => false, 'detalhes' => ['motivo' => 'Gols: 1.200 → 900']]]]);
checar('prova_verificar não bateu: os emblemas que a carreira deu são retirados (com o motivo)', v34Emblemas($uidG) === []
    && (string) v("SELECT motivo FROM emblemas_usuario WHERE usuario_id = ? AND estado = 'retirado' LIMIT 1", [$uidG]) === 'Gols: 1.200 → 900');
// apagar pela moderação: idem
$pkC = pkCarreira('v34-clubes', $uidC);
v33Adm(['acao' => 'apagar_carreira', 'id' => $pkC, 'motivo' => 'Teste de moderação.']);
checar('apagada pela moderação: os emblemas que ela deu saem (os 4: andarilho, bandeira, noite de gala, era de ouro)', v34Emblemas($uidC) === []
    && (int) v("SELECT COUNT(*) FROM emblemas_usuario WHERE usuario_id = ? AND estado = 'retirado'", [$uidC]) === 4);
// integração: restaurar da lixeira devolve as colunas da v3.3 e da v3.4 (antes voltava sem a lista nem o replay: não provava mais)
$lixC = (int) v('SELECT id FROM lixeira_carreiras WHERE carreira_pk = ?', [$pkC]);
$provC0 = (int) v('SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id = ? AND prova_pk IS NOT NULL', [$uidC]);
$r = v33Adm(['acao' => 'restaurar_carreira', 'id' => $lixC]);
$pkR = (int) ($r->json['pk'] ?? 0);
// §E.7: os emblemas que o sistema tirou quando ela foi apagada voltam com ela (antes: "não voltam sozinhos")
checar('restaurar da lixeira: a carreira volta com tem_replay, semente_em, a lista de conquistas e os números novos, volta a provar as conquistas da conta e os emblemas que o sistema tinha tirado voltam com ela (§E.7)',
    $r->status === 200 && $pkR === $pkC && (string) v("SELECT CONCAT_WS('|', tem_replay, semente_em IS NOT NULL, conquistas IS NOT NULL, n_clubes, mesmo_clube) FROM carreiras WHERE id = ?", [$pkR]) === '1|1|1|12|18'
    && $provC0 === 0 && (int) v('SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id = ? AND prova_pk = ?', [$uidC, $pkR]) > 0
    && v34Emblemas($uidC) === ['andarilho-campeao', 'bandeira-do-clube', 'era-de-ouro', 'noite-de-gala'], $r->resumo() . ' ' . json_encode(v34Emblemas($uidC)));
// conta suspensa não ganha
[$navS, $uidS] = v33Conta('Suspensa Emb');
q("UPDATE usuarios SET status = 'suspenso' WHERE id = ?", [$uidS]);
v33Semente($uidS, v33Replay()['seed']);
q("INSERT INTO carreiras (usuario_id, carreira_id, modo, jogador, dados, salva_em, tem_replay, semente_em, primeira_em, bolas_ouro, champions, conquistas, libertadores)
    VALUES (?, 'v34-susp-conta', 'classico', 'X', '', UTC_TIMESTAMP(), 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(), 1, 1, '[]', 0)", [$uidS]);
phpComLib('require ' . var_export(dirname(__DIR__) . '/api/_desafios.php', true) . '; echo json_encode(["n" => avaliarDesafiosConta(' . $uidS . ')]);');
checar('conta suspensa não ganha emblema', v34Emblemas($uidS) === []);
q("UPDATE usuarios SET status = 'ativo' WHERE id = ?", [$uidS]);
// desafio_salvar de emblema e as travas
$r = v33Adm(['acao' => 'desafio_salvar', 'slug' => 'v34-teste-emb', 'titulo' => 'Emblema de teste', 'modo' => 'emblema', 'dificuldade' => 'medio',
    'emblema' => ['icone' => 'trophy', 'cor' => '#ABCDEF'], 'home' => false, 'criterio' => ['champions' => 2, 'gols' => 100]]);
$Dn = $r->json['desafio'] ?? [];
checar('desafio_salvar de emblema → 201 (modo, dificuldade, emblema em minúsculas, home, requisitos de emblema, regulamento de emblema); desativado', $r->status === 201
    && ($Dn['modo'] ?? '') === 'emblema' && ($Dn['dificuldade'] ?? '') === 'medio' && ($Dn['emblema'] ?? null) === ['icone' => 'trophy', 'cor' => '#abcdef']
    && ($Dn['home'] ?? null) === false && ($Dn['ativo'] ?? null) === false && ($Dn['requisitos'] ?? null) === ['partidasMin' => 0, 'emailVerificado' => false,
        'publicadoNoHall' => false, 'top3Perfil' => false] && str_contains((string) ($Dn['regulamento'] ?? ''), '2 Champions League e 100 gols')
    && ($Dn['criterio'] ?? null) === ['champions' => 2, 'gols' => 100], $r->resumo());
$idN = (int) ($Dn['id'] ?? 0);
$r = v33Adm(['acao' => 'desafio_ativar', 'id' => $idN, 'ativo' => true]);
checar('ativar o de emblema avalia todo mundo (lote): quem já tinha a carreira ganha agora (emblemasNovos), com a hora em que a carreira entrou na conta',
    $r->status === 200 && ($r->json['emblemasNovos'] ?? 0) >= 2 && in_array('v34-teste-emb', v34Emblemas($uidE), true)
    && (string) v('SELECT em FROM emblemas_usuario WHERE desafio_id = ? AND usuario_id = ?', [$idN, $uidE]) === substr((string) v('SELECT primeira_em FROM carreiras WHERE carreira_id = ?', ['v34-e1']), 0, 19) . '.000',
    $r->resumo());
$ruins = [];
foreach ([[['modo' => 'outro'], 'modo'], [['dificuldade' => 'impossivel'], 'dificuldade'], [['emblema' => ['icone' => 'X!', 'cor' => '#fff']], 'emblema'],
    [['emblema' => 'star'], 'emblema'], [['emblema' => ['icone' => 'star', 'cor' => 'red']], 'emblema'], [['home' => 'sim'], 'home'],
    [['criterio' => ['nacionalidade' => 'BRA']], 'criterio'], [['criterio' => ['nacionalidade' => ['bra']]], 'criterio'], [['criterio' => ['gols' => 5001]], 'criterio'],
    [['criterio' => ['nota' => 0.5]], 'criterio'], [['criterio' => ['clubes' => 41]], 'criterio']] as $i => [$corpo, $esperado]) {
    $r = v33Adm(['acao' => 'desafio_salvar', 'id' => $idN] + $corpo);
    if ($r->status !== 400 || $r->erro() !== $esperado) {
        $ruins[] = "#$i → $r->status " . $r->erro();
    }
}
checar('desafio_salvar: modo, dificuldade, emblema, home e critério novo errados → 400 com o código, nunca 500', !$ruins, implode('; ', $ruins));
$r = v33Adm(['acao' => 'desafio_salvar', 'id' => $idN, 'modo' => 'primeiro']);
$r3 = v33Adm(['acao' => 'desafio_reabrir', 'id' => $idN, 'motivo' => 'x']);
checar('o modo não muda depois que alguém ganhou (409 modo_travado); reabrir um de emblema → 409 emblema', $r->status === 409 && $r->erro() === 'modo_travado'
    && $r3->status === 409 && $r3->erro() === 'emblema', $r->resumo() . ' | ' . $r3->resumo());
q('DELETE FROM emblemas_usuario WHERE desafio_id = ?', [$idN]);
q('DELETE FROM desafios WHERE id = ?', [$idN]);
// um de prêmio com critério novo (o modo primeiro também aceita): candidato pela carreira-prova depois do início
$r = v33Adm(['acao' => 'desafio_salvar', 'slug' => 'v34-premio-champions', 'titulo' => 'Champions de teste', 'criterio' => ['champions' => 4, 'bolasOuro' => 10],
    'requisitos' => ['partidasMin' => 0, 'emailVerificado' => false, 'publicadoNoHall' => false, 'top3Perfil' => false]]);
$idPr = (int) ($r->json['desafio']['id'] ?? 0);
v33Adm(['acao' => 'desafio_ativar', 'id' => $idPr, 'ativo' => true]);
q('UPDATE desafios SET inicio = UTC_TIMESTAMP() - INTERVAL 1 HOUR WHERE id = ?', [$idPr]);
[$navPr, $uidPr] = v33Conta('Premio Novo');
v34Salvar($navPr, v34Hall('v34-premio', ['nota' => 79], []));
checar('desafio de prêmio (modo primeiro) com critério novo (champions + bolasOuro): a carreira-prova que cumpre vira candidata',
    count(q('SELECT id FROM desafio_candidatos WHERE desafio_id = ? AND usuario_id = ?', [$idPr, $uidPr])) === 1);
q('DELETE FROM desafio_candidatos WHERE desafio_id = ?', [$idPr]);
q('DELETE FROM desafios WHERE id = ?', [$idPr]);

// ══ 5. prévia de link ════════════════════════════════════════════════════════════════════════════

secao('v3.4 · prévia de link (v.php): Open Graph + PNG 1200×630 com cache em disco; carreira pública, oculta e inexistente; perfil');
integAdm('POST', '/api/admin.php', ['acao' => 'atualizar_hall']);
$idPub = (string) ($itE['id'] ?? '');
$r = $anon->pedir('GET', '/api/v.php?id=' . rawurlencode($idPub) . '&c=' . $codE);
$html = $r->corpo;
preg_match('/property="og:image" content="([^"]+)"/', $html, $mImg);
$imgUrl = html_entity_decode($mImg[1] ?? '', ENT_QUOTES | ENT_HTML5);
checar('carreira do Hall público → 200 HTML (public, max-age=300) com og:title (jogador e nota), og:description, og:image (png=1, 1200×630), twitter:card e o refresh para o jogo com o código',
    $r->status === 200 && str_starts_with($r->cab1('content-type'), 'text/html') && $r->cab1('cache-control') === 'public, max-age=300' && $r->cab1('x-content-type-options') === 'nosniff'
    && str_contains($html, '<meta property="og:title" content="VAN RIJN · Nota de Legado ' . (int) ($itE['nota'] ?? -1) . ' · LENDA">')
    && str_contains($html, 'name="twitter:card" content="summary_large_image"')
    && str_contains($html, 'og:image:width" content="1200"') && str_contains($imgUrl, '/lenda/api/v.php?id=' . rawurlencode($idPub)) && str_contains($imgUrl, 'png=1')
    && str_contains($html, 'http-equiv="refresh" content="0; url=' . htmlspecialchars($ORIGEM . '/lenda/?c=' . $codE . '#/resumo?id=' . rawurlencode($idPub) . '&de=comunidade', ENT_QUOTES | ENT_HTML5) . '"')
    && str_contains($html, 'Carreira de Emblema Um') && str_contains($html, 'lang="pt-BR"') && !str_contains($html, '<script'), substr($html, 0, 600));
checar('…sem dado pessoal além do apelido público (nenhum e-mail da conta)', !str_contains($html, (string) v('SELECT email FROM usuarios WHERE id = ?', [$uidE])) && !str_contains($html, '@'));
$pastaPrev = $V34_BASE . '/lenda-cache/previas';
array_map('unlink', glob($pastaPrev . '/*.png') ?: []);
$rp = $anon->pedir('GET', '/api/v.php?' . (string) parse_url($imgUrl, PHP_URL_QUERY));
$tam = $rp->status === 200 ? @getimagesizefromstring($rp->corpo) : false;
$arqs = glob($pastaPrev . '/*.png') ?: [];
checar('a imagem: 200 image/png 1200×630 (public, max-age=86400), guardada fora do public_html (lenda-cache/previas ao lado da config)', $rp->status === 200
    && str_starts_with($rp->cab1('content-type'), 'image/png') && $rp->cab1('cache-control') === 'public, max-age=86400' && is_array($tam) && $tam[0] === 1200 && $tam[1] === 630
    && count($arqs) === 1 && !str_contains($pastaPrev, '/public_html/') && is_file($V34_BASE . '/lenda-cache/.htaccess'), $rp->status . ' ' . $rp->cab1('content-type'));
$mt = $arqs ? filemtime($arqs[0]) : 0;
@touch($arqs[0] ?? '', $mt - 100);
clearstatcache();
$rp2 = $anon->pedir('GET', '/api/v.php?' . (string) parse_url($imgUrl, PHP_URL_QUERY));
clearstatcache();
checar('a segunda vez vem do disco (o arquivo não é desenhado de novo)', $rp2->status === 200 && $rp2->corpo === $rp->corpo && $arqs && filemtime($arqs[0]) === $mt - 100);
$rpr = $anon->pedir('GET', '/api/v.php?c=' . strtolower($codE));
checar('perfil (?c=, minúsculas também) → o título com o apelido e a melhor nota, a descrição com conquistas e emblemas, o refresh para #/jogador/CÓDIGO',
    $rpr->status === 200 && str_contains($rpr->corpo, 'content="Emblema Um no LENDA · melhor nota') && str_contains($rpr->corpo, 'emblemas')
    && str_contains($rpr->corpo, htmlspecialchars('/lenda/?c=' . $codE . '#/jogador/' . $codE, ENT_QUOTES | ENT_HTML5)), substr($rpr->corpo, 0, 400));
$geral = static fn(Resposta $x): bool => $x->status === 200 && str_contains($x->corpo, 'LENDA · jogo de carreira de futebol online grátis') && !str_contains($x->corpo, 'VAN RIJN')
    && !str_contains($x->corpo, 'Emblema Um');
$pkPub = (int) v('SELECT carreira_pk FROM hall_foto WHERE carreira_id = ?', [$idPub]);
q('UPDATE carreiras SET oculta = 1 WHERE id = ?', [$pkPub]);
$rOc = $anon->pedir('GET', '/api/v.php?id=' . rawurlencode($idPub));
q('UPDATE carreiras SET oculta = 0 WHERE id = ?', [$pkPub]);
q("UPDATE usuarios SET hall_publico = 'nao' WHERE id = ?", [$uidE]);
$rPriv = $anon->pedir('GET', '/api/v.php?id=' . rawurlencode($idPub));
$rPrivP = $anon->pedir('GET', '/api/v.php?c=' . $codE);
q("UPDATE usuarios SET hall_publico = 'auto' WHERE id = ?", [$uidE]);
$rNada = $anon->pedir('GET', '/api/v.php?id=career-nao-existe');
$rPngNada = $anon->pedir('GET', '/api/v.php?id=career-nao-existe&png=1');
checar('carreira oculta, conta que fechou o Hall (carreira e perfil) e id que não existe → a prévia genérica (200), sem jogador nem apelido; a imagem genérica também',
    $geral($rOc) && $geral($rPriv) && $geral($rPrivP) && $geral($rNada) && $rPngNada->status === 200 && str_starts_with($rPngNada->cab1('content-type'), 'image/png'),
    substr($rOc->corpo, 0, 300));
q("UPDATE usuarios SET status = 'suspenso' WHERE id = ?", [$uidE]);
$rSus = $anon->pedir('GET', '/api/v.php?c=' . $codE);
q("UPDATE usuarios SET status = 'ativo' WHERE id = ?", [$uidE]);
checar('perfil de conta suspensa → genérica', $geral($rSus));
$ruins = [];
foreach (['id=' . str_repeat('a', 65), 'id=%00x', 'id[]=1', 'c[]=x', 'c=!!!', 'png=1&c=xx', 'id=' . rawurlencode('<script>'), 'png=2&id=' . rawurlencode($idPub), ''] as $qs) {
    $x = $anon->pedir('GET', '/api/v.php?' . $qs);
    if ($x->status !== 200 || str_contains($x->corpo, '<script>')) {
        $ruins[] = "$qs → $x->status";
    }
}
$rPost = $anon->pedir('POST', '/api/v.php', ['x' => 1]);
checar('entradas estranhas (id longo, controle, lista, código inválido, HTML) → 200 genérica e escapada, nunca 500; POST → 405', !$ruins && $rPost->status === 405, implode('; ', $ruins));

// ══ 6. LGPD, backup e .htaccess ══════════════════════════════════════════════════════════════════

secao('v3.4 · LGPD (emblemas e provas saem com a conta), backup e o .htaccess');
resetarLimitesCurtos();
$rg = acEquipe(novoNav(), ['acao' => 'backup_guardar'], acBearer());
checar('o backup leva os emblemas', $rg->status === 200 && (int) ($rg->json['contagem']['emblemas_usuario'] ?? 0) === (int) v('SELECT COUNT(*) FROM emblemas_usuario'), $rg->resumo());
$r = integAdm('POST', '/api/admin.php', ['acao' => 'excluir_usuario', 'id' => $uidE, 'confirma' => (string) v('SELECT apelido FROM usuarios WHERE id = ?', [$uidE]),
    'motivo' => 'teste']);
$logRet = (string) v("SELECT detalhes FROM admin_log WHERE acao = 'emblema_retirar' ORDER BY id DESC LIMIT 1");
checar('excluir a conta apaga os emblemas dela; no registro, emblema_retirar fica só com a ação e a data (sem a conta)', in_array($r->status, [200, 204], true)
    && (int) v('SELECT COUNT(*) FROM emblemas_usuario WHERE usuario_id = ?', [$uidE]) === 0 && (int) v('SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id = ?', [$uidE]) === 0
    && !str_contains($logRet, '"usuario":' . $uidE), $r->resumo() . ' ' . $logRet);
if ($URL_APACHE !== '') {
    $ap = new Navegador($URL_APACHE, null);
    $ap->conferir = false;
    $neg = [];
    foreach (['_provas.php', '_previa.php', '_fonte-barlow-condensed-700.ttf', '_fonte-barlow-condensed-500.ttf', '_fonte-OFL.txt'] as $arq) {
        $st = $ap->pedir('GET', "/api/$arq")->status;
        if ($st !== 403) {
            $neg[] = "$arq → $st";
        }
    }
    checar('Apache: v.php liberado; _provas.php, _previa.php, as fontes e a licença negadas', $ap->pedir('GET', '/api/v.php')->status === 200 && !$neg, implode('; ', $neg));
}

// ══ 7. nenhum 500 com entradas estranhas ═════════════════════════════════════════════════════════

secao('v3.4 · tipos errados nas rotas novas (nenhum 500)');
// o excluir_usuario carrega o _previa.php junto com o resto do admin: nenhum nome de função pode repetir (o "Cannot
// redeclare" é fatal, nem o try/catch segura)
$todos = phpComLib('foreach (glob(' . var_export(dirname(__DIR__) . '/api', true) . ' . "/_*.php") as $f) { require_once $f; } echo json_encode(["ok" => true]);');
checar('todos os _*.php da api carregam juntos num processo (nenhuma função declarada duas vezes)', ($todos['ok'] ?? null) === true);
$antes500 = count($FALHAS);
foreach ([null, 'x', -1, 0, 1.5, [], ['a' => 1], 99999999999] as $x) {
    v33Adm(['acao' => 'emblema_retirar', 'id' => $x, 'motivo' => 'x']);
    v33Adm(['acao' => 'emblema_devolver', 'id' => $x]);
    v33Adm(['acao' => 'prova_verificar', 'resultados' => [['carreira' => $x, 'ok' => true]]]);
    v33Get('r=provas&usuario=' . rawurlencode(is_scalar($x) ? (string) $x : 'x'));
    v33Adm(['acao' => 'desafio_salvar', 'slug' => 'v34-tipo', 'titulo' => 'Tipos', 'modo' => $x, 'criterio' => ['copas' => 1]]);
    v33Adm(['acao' => 'desafio_salvar', 'slug' => 'v34-tipo', 'titulo' => 'Tipos', 'criterio' => ['nacionalidade' => $x]]);
    v33Adm(['acao' => 'desafio_salvar', 'slug' => 'v34-tipo', 'titulo' => 'Tipos', 'criterio' => ['copas' => 1], 'emblema' => $x, 'home' => $x, 'dificuldade' => $x]);
}
q("DELETE FROM desafios WHERE slug = 'v34-tipo'");
$h = v34Hall('v34-tipos', ['nota' => 80], ['first_title']);
foreach ([[1, 2], 'x', null, [['a' => 1]], array_fill(0, 2000, 'goat')] as $x) {
    $h->career->achievements = $x;
    v34Salvar($navP, $h);
}
checar('nenhum 500 nem vazamento (emblemas, provas, desafio_salvar com o modo/emblema/critério novos, career.achievements estranho)', count($FALHAS) === $antes500);
checar('career.achievements estranho: a lista guardada sai só com os ids das 87 (aqui, nenhum ou goat)', in_array((string) v('SELECT conquistas FROM carreiras WHERE carreira_id = ?', ['v34-tipos']),
    ['["goat"]', '[]'], true));

// ══ 8. banco sem o instalar da v3.4 ══════════════════════════════════════════════════════════════

secao('v3.4 · arquivos novos com o banco da v3.3 (sem o instalar da v3.4): o jogo não quebra');
q("UPDATE site_config SET valor = '33' WHERE chave = '_esquema'");
[$navX, $uidX] = v33Conta('Banco V33');
$navX->conferir = false;
$r1 = v34Salvar($navX, v34Hall('v34-s33', ['nota' => 81], ['first_title']));
$r2 = $navX->pedir('GET', '/api/conquistas.php');
$r3 = $anon->pedir('GET', '/api/desafios.php');
$r4 = hallGet();
$r5 = $anon->pedir('GET', '/api/v.php?c=' . (string) v('SELECT codigo_convite FROM usuarios WHERE id = ?', [$uidX]));
$navB34 = novoNav();
$navB34->conferir = false; // o 503 é a resposta esperada
$r6 = $navB34->pedir('GET', '/api/admin.php?r=provas&usuario=' . $uidX, null, ['auth' => 'Bearer ' . $PAINEL_TOKEN, 'origem' => false]);
$r7 = $navB34->pedir('POST', '/api/admin.php', ['acao' => 'prova_verificar', 'resultados' => [['carreira' => 1, 'ok' => true]]], ['auth' => 'Bearer ' . $PAINEL_TOKEN, 'origem' => false]);
checar('salvar (sem prova, sem provasNovas), conquistas (o formato de antes), desafios, Hall e a prévia funcionam; ?r=provas e prova_verificar → 503 instalar',
    $r1->status === 200 && !array_key_exists('provasNovas', $r1->json ?? []) && v('SELECT conquistas FROM carreiras WHERE carreira_id = ?', ['v34-s33']) === null
    && $r2->status === 200 && !array_key_exists('provadas', $r2->json ?? []) && $r3->status === 200 && $r4->status === 200 && $r5->status === 200
    && $r6->status === 503 && $r6->erro() === 'instalar' && $r7->status === 503, $r1->resumo() . ' | ' . $r6->resumo());
$r = $anon->pedir('POST', '/api/instalar.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
checar('instalar → _esquema 34 de novo; a carreira salva antes ganha os números novos (e a lista, se for prova)', $r->status === 200
    && (int) v("SELECT valor FROM site_config WHERE chave = '_esquema'") === 34 && v('SELECT champions FROM carreiras WHERE carreira_id = ?', ['v34-s33']) !== null, $r->resumo());

// ══ 9. recálculo das contas no instalar ══════════════════════════════════════════════════════════

secao('v3.4 · instalar: o recálculo das contas (o que dá para provar fica provado; o resto, não provado; nada some)');
[$navR, $uidR] = v33Conta('Conta Antiga');
$navR->pedir('POST', '/api/conquistas.php', ['acao' => 'sincronizar', 'conquistas' => [['id' => 'goat', 'em' => '2026-09-01T00:00:00Z'], ['id' => 'kopa', 'em' => '2026-09-02T00:00:00Z']]]);
v34Salvar($navR, v34Hall('v34-antiga-prova', ['nota' => 82], ['kopa', 'puskas']));
v34Salvar($navR, v34Hall('v34-antiga-sem', ['nota' => 83], ['wall']), false);
q('UPDATE carreiras SET semente_em = NULL WHERE carreira_id = ?', ['v34-antiga-sem']); // jogada sem a conta
// como um banco recém-atualizado: as colunas novas vazias, nada provado ainda
q('UPDATE carreiras SET champions = NULL, conquistas = NULL WHERE usuario_id = ?', [$uidR]);
q('UPDATE conquistas_usuario SET prova_pk = NULL, provada_em = NULL WHERE usuario_id = ?', [$uidR]);
q("DELETE FROM conquistas_usuario WHERE usuario_id = ? AND origem = 'carreira'", [$uidR]); // antes da v3.4 só o aparelho mandava (puskas e wall vieram das carreiras)
$antesR = q('SELECT conquista_id, em FROM conquistas_usuario WHERE usuario_id = ? ORDER BY conquista_id', [$uidR]);
q("DELETE FROM site_config WHERE chave = '_v34_recalculo'");
$r = $anon->pedir('POST', '/api/instalar.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
$depoisR = array_column(q('SELECT conquista_id, em, prova_pk, origem FROM conquistas_usuario WHERE usuario_id = ? ORDER BY conquista_id', [$uidR]), null, 'conquista_id');
checar('instalar: preenche a lista da carreira-prova e refaz as provas da conta: kopa e puskas provadas (puskas entra, origem carreira), goat continua não provada, wall (carreira sem semente) não entra; as datas de antes ficam',
    $r->status === 200 && ($r->json['v34']['contas'] ?? 0) >= 1 && ($r->json['v34']['provas'] ?? 0) >= 2 && ($r->json['preenchidas']['faltam'] ?? -1) === 0
    && ($depoisR['kopa']['prova_pk'] ?? null) !== null && ($depoisR['puskas']['origem'] ?? '') === 'carreira' && nulo($depoisR['goat'] ?? null, 'prova_pk')
    && !isset($depoisR['wall']) && ($depoisR['goat']['em'] ?? '') === (array_column($antesR, 'em', 'conquista_id')['goat'] ?? '-')
    && ($depoisR['kopa']['em'] ?? '') === (array_column($antesR, 'em', 'conquista_id')['kopa'] ?? '-'), $r->resumo() . ' ' . json_encode($depoisR));
$r = $anon->pedir('POST', '/api/instalar.php', null, ['auth' => 'Bearer ' . $PAINEL_TOKEN]);
checar('instalar de novo: o recálculo não roda outra vez (v34 tudo 0)', $r->status === 200 && ($r->json['v34'] ?? null) === ['carreiras' => 0, 'desafios' => 0, 'contas' => 0,
    'provas' => 0, 'emblemas' => 0], $r->resumo());

// ── fim: desafios como o teste da v3.3 deixou (com os de emblema semeados de novo), equipe vazia ─────
v34Limpar();
acLimparEquipe();

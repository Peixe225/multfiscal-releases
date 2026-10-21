<?php
/**
 * LENDA · v3.4 §E (CONTRATO-v34.md §E): as correções confirmadas do servidor, cada uma com o caso que falhava antes —
 *   E.1 apagar a carreira-prova ainda não verificada tira os emblemas que ela deu (e salvar com conteúdo que não cumpre também);
 *   E.2 o prova_verificar só grava o resultado na versão do conteúdo que o admin refez (meta.versao → pulados "mudou");
 *   E.3 o "não bateu" fica pela semente (salvar com 1 byte diferente, apagar e salvar, outro id: continua não bateu);
 *   E.4 a prévia usa o id do banco (id + espaços não desenha outra imagem) e a genérica no lugar da carreira tem cache curto;
 *   E.5 o ícone do emblema é um dos 38 do mapa (constructor → 400; o gravado fora do mapa sai como a medalha);
 *   E.7 o emblema que perde a carreira passa para outra carreira-prova da conta que cumpre; sem nenhuma, sai pelo sistema e
 *       volta com a próxima que cumprir (o tirado à mão pela equipe nunca volta).
 * Incluído pelo teste.php depois do teste-v34.php (usa os ajudantes dele e dos de antes). Deixa o estado como o teste da v3.4.
 */
declare(strict_types=1);

/** O motivo e quem tirou os emblemas (estado retirado) da conta, direto no banco: slug → [motivo, quem]. */
function corr34Retirados(int $uid): array
{
    $out = [];
    foreach (q("SELECT d.slug, e.motivo, e.quem FROM emblemas_usuario e JOIN desafios d ON d.id = e.desafio_id WHERE e.usuario_id = ? AND e.estado = 'retirado'", [$uid]) as $l) {
        $out[(string) $l['slug']] = [(string) $l['motivo'], (string) $l['quem']];
    }
    return $out;
}

/** As carreiras (pk) que sustentam os emblemas ativos da conta. */
function corr34CarreirasDosEmblemas(int $uid): array
{
    return array_values(array_unique(array_map('intval', array_column(q("SELECT carreira_pk FROM emblemas_usuario WHERE usuario_id = ? AND estado = 'ativo'", [$uid]), 'carreira_pk'))));
}

/** A meta.versao do ?r=carreira (o que o jogo manda de volta no prova_verificar). */
function corr34Versao(int $pk): string
{
    return (string) (v33Get('r=carreira&id=' . $pk)->json['meta']['versao'] ?? '');
}

/** HallEntry com o replay $i das filas (outra semente; o salvar das contas de v33Conta a marca como sorteada pelo servidor). */
function corr34ComReplay(stdClass $h, int $i): stdClass
{
    $h->replay = json_decode(json_encode(v33Replay($i)), false);
    return $h;
}

v34Limpar();
q('DELETE FROM provas_nao_bateu');

// ══ E.1 apagar antes da verificação ═══════════════════════════════════════════════════════════════

secao('v3.4 §E.1 · apagar a carreira-prova ainda não verificada tira os emblemas que ela deu (a verificada fica)');
[$navA, $uidA] = v33Conta('Corr Apaga');
$hA = v34Hall('v34c-apaga', ['gols' => 1001, 'temporadas' => 24], ['world_cup_3', 'goat', 'beat_all'], 3, 2);
$r = v34Salvar($navA, $hA);
$novosA = array_column($r->json['emblemasNovos'] ?? [], 'slug');
checar('(preparação) a carreira-prova com o resumo adulterado (3 Copas, 2 Libertadores, 1.001 gols) dá os emblemas na hora, os lendários também',
    $r->status === 200 && in_array('tacas-do-rei-emblema', $novosA, true) && in_array('mil-gols-e-o-tri', $novosA, true), $r->resumo());
$r = $navA->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => 'v34c-apaga']);
$retA = corr34Retirados($uidA);
$codA = (string) v('SELECT codigo_convite FROM usuarios WHERE id = ?', [$uidA]);
$perfA = $anon->pedir('GET', '/api/perfil.php?c=' . $codA);
checar('§E.1 o dono apaga a carreira que ainda não foi verificada: os emblemas dela saem (pelo sistema, "apagada antes de ser verificada"); o perfil não mostra nenhum',
    $r->status === 200 && v34Emblemas($uidA) === [] && count($retA) === count($novosA) && ($retA['tacas-do-rei-emblema'][1] ?? '') === 'sistema'
    && str_contains($retA['tacas-do-rei-emblema'][0] ?? '', 'apagada antes de ser verificada') && ($perfA->json['emblemas'] ?? null) === [],
    json_encode($retA) . ' ' . $perfA->resumo());
$r = v34Salvar($navA, $hA);
$pkA2 = pkCarreira('v34c-apaga', $uidA);
$itA = array_column(v33Get('r=provas&usuario=' . $uidA)->json['carreiras'] ?? [], null, 'pk');
checar('…salva de novo (a semente ainda é do servidor): volta a ser prova, aparece no ?r=provas para verificar e os emblemas voltam com ela',
    $r->status === 200 && in_array('tacas-do-rei-emblema', array_column($r->json['emblemasNovos'] ?? [], 'slug'), true) && isset($itA[$pkA2])
    && ($itA[$pkA2]['vale'] ?? null) === true && corr34CarreirasDosEmblemas($uidA) === [$pkA2], $r->resumo());
$r = v33Adm(['acao' => 'prova_verificar', 'resultados' => [['carreira' => $pkA2, 'ok' => true, 'versao' => corr34Versao($pkA2)]]]);
$antesA = v34Emblemas($uidA);
$navA->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => 'v34c-apaga']);
checar('…a carreira que já bateu na verificação, apagada pelo dono: os emblemas ficam (A.6)', ($r->json['carreiras'][0]['provaOk'] ?? null) === true && $antesA !== []
    && v34Emblemas($uidA) === $antesA, $r->resumo());
// salvar de novo com um conteúdo que não cumpre mais: o emblema daquele desafio sai (a carreira não sustenta mais)
[$navA2, $uidA2] = v33Conta('Corr Muda');
v34Salvar($navA2, v34Hall('v34c-muda', ['gols' => 1001, 'temporadas' => 24], [], 3, 2));
$tinha = in_array('mil-gols-e-o-tri', v34Emblemas($uidA2), true);
v34Salvar($navA2, v34Hall('v34c-muda', ['gols' => 900, 'temporadas' => 24], [], 3, 2));
$retA2 = corr34Retirados($uidA2);
checar('§E.1 salvar de novo a carreira com um conteúdo que não cumpre mais (1.001 → 900 gols): o emblema daquele desafio sai pelo sistema; os que ela ainda cumpre ficam',
    $tinha && !in_array('mil-gols-e-o-tri', v34Emblemas($uidA2), true) && ($retA2['mil-gols-e-o-tri'][1] ?? '') === 'sistema'
    && in_array('tacas-do-rei-emblema', v34Emblemas($uidA2), true) && !isset($retA2['tacas-do-rei-emblema']), json_encode($retA2));

// ══ E.2 a versão do conteúdo no prova_verificar ═══════════════════════════════════════════════════

secao('v3.4 §E.2 · prova_verificar grava só na versão do conteúdo que o admin refez (o dono salvou outro: pulados "mudou")');
[$navV, $uidV] = v33Conta('Corr Versao');
v34Salvar($navV, v34Hall('v34c-versao', [], ['first_title', 'ballon_dor']));
$pkV = pkCarreira('v34c-versao', $uidV);
$verA = corr34Versao($pkV);
$jsonV = @gzdecode((string) v('SELECT dados FROM carreiras WHERE id = ?', [$pkV]));
checar('?r=carreira: meta.versao = o sha1 do HallEntry guardado', preg_match('/^[0-9a-f]{40}$/', $verA) === 1 && is_string($jsonV) && $verA === sha1($jsonV), $verA);
// entre o GET do admin e o POST dele, o dono salva outro conteúdo com o mesmo replay
$rB = v34Salvar($navV, v34Hall('v34c-versao', [], ['first_title', 'ballon_dor', 'goat', 'beat_all', 'world_cup_3', 'ballon_8'], 3, 2));
$r = v33Adm(['acao' => 'prova_verificar', 'resultados' => [['carreira' => $pkV, 'ok' => true, 'versao' => $verA]]]);
$cV = array_column(v34Conq($navV)['conquistas'] ?? [], null, 'id');
checar('§E.2 o resultado era do conteúdo de antes: pulados [{motivo: mudou}], nada gravado (prova_ok null; goat provada, mas não verificada)',
    $rB->status === 200 && $r->status === 200 && ($r->json['pulados'] ?? null) === [['carreira' => $pkV, 'motivo' => 'mudou']] && ($r->json['carreiras'] ?? null) === []
    && v('SELECT prova_ok FROM carreiras WHERE id = ?', [$pkV]) === null && ($cV['goat']['provada'] ?? null) === true && ($cV['goat']['verificada'] ?? null) === false,
    $r->resumo() . ' ' . json_encode($cV['goat'] ?? null));
$r = v33Adm(['acao' => 'prova_verificar', 'resultados' => [['carreira' => $pkV, 'ok' => false, 'versao' => corr34Versao($pkV), 'detalhes' => ['motivo' => 'Copas: 3 → 1']]]]);
checar('…com a versão de agora, o resultado vale (não bateu gravado)', ($r->json['carreiras'] ?? null) === [['pk' => $pkV, 'provaOk' => false]]
    && (int) v('SELECT prova_ok FROM carreiras WHERE id = ?', [$pkV]) === 0, $r->resumo());
$ruins = [];
foreach (['xyz', str_repeat('g', 40), 123, ['a'], str_repeat('a', 41)] as $x) {
    $rr = v33Adm(['acao' => 'prova_verificar', 'resultados' => [['carreira' => $pkV, 'ok' => true, 'versao' => $x]]]);
    if ($rr->status !== 400 || $rr->erro() !== 'resultados') {
        $ruins[] = json_encode($x) . " → $rr->status";
    }
}
checar('versao fora do formato (40 hexadecimais) → 400 resultados, nunca 500', !$ruins, implode('; ', $ruins));

// ══ E.3 o "não bateu" pela semente ════════════════════════════════════════════════════════════════

secao('v3.4 §E.3 · o "não bateu" fica pela semente: salvar de novo, apagar e salvar ou outro id não desfazem');
[$navN, $uidN] = v33Conta('Corr Nao Bateu');
v34Salvar($navN, v34Hall('v34c-nb', ['gols' => 1001, 'temporadas' => 24], ['goat', 'beat_all'], 3, 2));
$pkN = pkCarreira('v34c-nb', $uidN);
$embN = v34Emblemas($uidN);
v33Adm(['acao' => 'prova_verificar', 'resultados' => [['carreira' => $pkN, 'ok' => false, 'versao' => corr34Versao($pkN), 'detalhes' => ['motivo' => 'Copas: 3 → 1']]]]);
checar('(preparação) não bateu: prova_ok 0, nenhuma provada, os emblemas fora; a semente guardada em provas_nao_bateu', count($embN) >= 4
    && (int) v('SELECT prova_ok FROM carreiras WHERE id = ?', [$pkN]) === 0 && v34Emblemas($uidN) === [] && (v34Conq($navN)['provadas'] ?? -1) === 0
    && (int) v('SELECT COUNT(*) FROM provas_nao_bateu WHERE usuario_id = ?', [$uidN]) === 1);
$r = v34Salvar($navN, v34Hall('v34c-nb', ['gols' => 1002, 'temporadas' => 24], ['goat', 'beat_all'], 3, 2));
checar('§E.3 salvar de novo a mesma carreira (o mesmo replay) com 1 número diferente: continua "não bateu" (com a verificação do admin), nada volta a provado, nenhum emblema',
    $r->status === 200 && (int) v('SELECT prova_ok FROM carreiras WHERE id = ?', [$pkN]) === 0
    && str_contains((string) v('SELECT prova_verificacao FROM carreiras WHERE id = ?', [$pkN]), 'Copas: 3') && ($r->json['provasNovas'] ?? null) === []
    && ($r->json['emblemasNovos'] ?? null) === [] && v34Emblemas($uidN) === [] && (v34Conq($navN)['provadas'] ?? -1) === 0, $r->resumo());
$navN->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => 'v34c-nb']);
$r = v34Salvar($navN, v34Hall('v34c-nb', ['gols' => 1002, 'temporadas' => 24], ['goat', 'beat_all'], 3, 2));
$pkN2 = pkCarreira('v34c-nb', $uidN);
checar('…apagar e salvar igual: a linha nova (outro pk, semente_em preenchida) nasce "não bateu"; nada provado, nenhum emblema', $r->status === 200 && $pkN2 !== $pkN
    && v('SELECT semente_em FROM carreiras WHERE id = ?', [$pkN2]) !== null && (int) v('SELECT prova_ok FROM carreiras WHERE id = ?', [$pkN2]) === 0
    && ($r->json['emblemasNovos'] ?? null) === [] && (v34Conq($navN)['provadas'] ?? -1) === 0, $r->resumo());
$r = v34Salvar($navN, v34Hall('v34c-nb-outro-id', ['gols' => 1001, 'temporadas' => 24], ['goat', 'beat_all'], 3, 2));
$pkN3 = pkCarreira('v34c-nb-outro-id', $uidN);
checar('…o mesmo replay com outro id: também "não bateu"', $r->status === 200 && (int) v('SELECT prova_ok FROM carreiras WHERE id = ?', [$pkN3]) === 0
    && ($r->json['emblemasNovos'] ?? null) === [] && v34Emblemas($uidN) === [], $r->resumo());
$r = v34Salvar($navN, corr34ComReplay(v34Hall('v34c-nb-nova', ['gols' => 1001, 'temporadas' => 24], ['goat'], 3, 2), 5));
checar('…outra carreira (outra semente sorteada pelo servidor): é prova normal e dá os emblemas', $r->status === 200
    && v('SELECT prova_ok FROM carreiras WHERE carreira_id = ? AND usuario_id = ?', ['v34c-nb-nova', $uidN]) === null && in_array('tacas-do-rei-emblema', v34Emblemas($uidN), true), $r->resumo());
$r = v33Adm(['acao' => 'prova_verificar', 'resultados' => [['carreira' => $pkN3, 'ok' => true, 'versao' => corr34Versao($pkN3)]]]);
checar('…o "bateu" do admin numa carreira dessa semente libera (a linha sai de provas_nao_bateu)', ($r->json['carreiras'][0]['provaOk'] ?? null) === true
    && (int) v('SELECT COUNT(*) FROM provas_nao_bateu WHERE usuario_id = ?', [$uidN]) === 0, $r->resumo());

// ══ E.4 a prévia de link: o id do banco e o cache curto da genérica ═══════════════════════════════

secao('v3.4 §E.4 · prévia: "id + espaços" não desenha outra imagem; a genérica no lugar da carreira tem cache curto');
[$navH, $uidH] = v33Conta('Corr Previa');
q("UPDATE usuarios SET hall_publico = 'auto' WHERE id = ?", [$uidH]);
v34Salvar($navH, v34Hall('v34c-previa', ['nota' => 71]));
integAdm('POST', '/api/admin.php', ['acao' => 'atualizar_hall']);
checar('(preparação) a carreira na fotografia do Hall', v('SELECT carreira_id FROM hall_foto WHERE carreira_id = ?', ['v34c-previa']) === 'v34c-previa');
$pastaPrev = $V34_BASE . '/lenda-cache/previas';
array_map('unlink', glob($pastaPrev . '/c' . $uidH . '-*.png') ?: []);
resetarLimitesCurtos();
$rH = $anon->pedir('GET', '/api/v.php?id=v34c-previa');
preg_match('/property="og:image" content="([^"]+)"/', $rH->corpo, $mImg);
$rP = $anon->pedir('GET', '/api/v.php?' . (string) parse_url(html_entity_decode($mImg[1] ?? '', ENT_QUOTES | ENT_HTML5), PHP_URL_QUERY));
$gerar = static fn(): int => (int) v("SELECT COALESCE(SUM(n), 0) FROM tentativas WHERE chave = 'previa-gerar:site'");
$arqs = static fn(): int => count(glob($pastaPrev . '/c' . $uidH . '-*.png') ?: []);
checar('(preparação) a imagem da carreira desenhada uma vez (1 arquivo, 1 no teto do site)', $rP->status === 200 && $arqs() === 1 && $gerar() === 1, $rP->resumo());
$cartao = 0;
$cabs = [];
for ($i = 1; $i <= 6; $i++) {
    $x = $anon->pedir('GET', '/api/v.php?id=' . rawurlencode('v34c-previa' . str_repeat(' ', $i)) . '&png=1');
    $xh = $anon->pedir('GET', '/api/v.php?id=' . rawurlencode('v34c-previa' . str_repeat(' ', $i)));
    $cartao += str_contains($xh->corpo, 'Nota de Legado') ? 1 : 0;
    $cabs[] = $xh->cab1('cache-control');
}
checar('§E.4 "id + espaços" (o banco acha a mesma carreira: PAD SPACE): nenhuma imagem nova no disco nem no teto dos desenhos; a genérica (cache de 60 s)',
    $arqs() === 1 && $gerar() === 1 && $cartao === 0 && array_unique($cabs) === ['public, max-age=60'], $arqs() . ' arquivos, ' . $gerar() . ' desenhos, ' . json_encode(array_unique($cabs)));
$mesma = phpComLib('require_once ' . var_export(dirname(__DIR__) . '/api/_desafios.php', true) . '; require_once ' . var_export(dirname(__DIR__) . '/api/_previa.php', true)
    . '; $a = previaCarreira("v34c-previa", null); $b = previaCarreira("v34c-previa   ", null); echo json_encode(["a" => $a["chave"] ?? null, "b" => $b["chave"] ?? null, "q" => $b["q"]["id"] ?? null, "d" => $b["destino"] ?? null]);');
checar('…e na própria previaCarreira: a chave, o id do link e o destino saem do id do banco (iguais aos do id limpo)', is_array($mesma) && $mesma['a'] !== null
    && $mesma['a'] === $mesma['b'] && $mesma['q'] === 'v34c-previa' && !str_contains((string) $mesma['d'], '%20'), json_encode($mesma));
$rN = $anon->pedir('GET', '/api/v.php?id=career-nao-existe-corr');
$rNp = $anon->pedir('GET', '/api/v.php?id=career-nao-existe-corr&png=1');
$rG = $anon->pedir('GET', '/api/v.php');
checar('…carreira que não está no Hall: a genérica com cache de 60 s (a página e a imagem); o link sem nada continua com 300', $rN->cab1('cache-control') === 'public, max-age=60'
    && $rNp->cab1('cache-control') === 'public, max-age=60' && $rG->cab1('cache-control') === 'public, max-age=300' && $rH->cab1('cache-control') === 'public, max-age=300');
// o teto do site cheio: a imagem da carreira nova sai genérica, com cache curto (não fica um dia nos robôs)
array_map('unlink', glob($pastaPrev . '/c' . $uidH . '-*.png') ?: []);
resetarLimitesCurtos();
q('INSERT INTO tentativas (chave, janela, n) VALUES (?, ?, 600) ON DUPLICATE KEY UPDATE n = 600', ['previa-gerar:site', intdiv(time(), 600)]);
$rT = $anon->pedir('GET', '/api/v.php?' . (string) parse_url(html_entity_decode($mImg[1] ?? '', ENT_QUOTES | ENT_HTML5), PHP_URL_QUERY));
checar('…com o teto de desenhos cheio: a imagem genérica, com cache de 60 s (antes: 1 dia), e nada gravado', $rT->status === 200
    && str_starts_with($rT->cab1('content-type'), 'image/png') && $rT->cab1('cache-control') === 'public, max-age=60' && $arqs() === 0, $rT->resumo());
resetarLimitesCurtos();

// ══ E.5 ícone do emblema ══════════════════════════════════════════════════════════════════════════

secao('v3.4 §E.5 · o ícone do emblema é um dos 38 do mapa (constructor não passa; o gravado fora do mapa sai como a medalha)');
$didNG = v33IdDesafio('noite-de-gala');
$embAntes = (string) v('SELECT emblema FROM desafios WHERE id = ?', [$didNG]);
$ruins = [];
foreach (['constructor', 'bola', 'goat'] as $ic) {
    $rr = v33Adm(['acao' => 'desafio_salvar', 'id' => $didNG, 'emblema' => ['icone' => $ic, 'cor' => '#ffffff']]);
    if ($rr->status !== 400 || $rr->erro() !== 'emblema') {
        $ruins[] = "$ic → $rr->status " . $rr->erro();
    }
}
$rOk = v33Adm(['acao' => 'desafio_salvar', 'id' => $didNG, 'emblema' => ['icone' => 'shield-check', 'cor' => '#b98652']]);
checar('§E.5 desafio_salvar com ícone fora do mapa (constructor, bola, goat) → 400 emblema; um do mapa (shield-check) → 200', !$ruins && $rOk->status === 200,
    implode('; ', $ruins) . ' | ' . $rOk->resumo());
q('UPDATE desafios SET emblema = ? WHERE id = ?', ['{"icone":"constructor","cor":"#ffffff"}', $didNG]);
$pubNG = v34Pub('noite-de-gala');
checar('…o que já estiver no banco fora do mapa sai como a medalha (desafios.php), com a cor guardada', ($pubNG['emblema'] ?? null) === ['icone' => 'medal', 'cor' => '#ffffff'],
    json_encode($pubNG['emblema'] ?? null));
q('UPDATE desafios SET emblema = ? WHERE id = ?', [$embAntes, $didNG]);

// ══ E.7 o emblema que perde a carreira ════════════════════════════════════════════════════════════

secao('v3.4 §E.7 · o emblema que perde a carreira passa para outra carreira-prova que cumpre; sem nenhuma, volta com a próxima');
[$navX, $uidX] = v33Conta('Corr Troca');
v34Salvar($navX, v34Hall('v34c-x1', [], []));
v34Salvar($navX, corr34ComReplay(v34Hall('v34c-x2', ['nota' => 72], []), 1));
$pkX1 = pkCarreira('v34c-x1', $uidX);
$pkX2 = pkCarreira('v34c-x2', $uidX);
checar('(preparação) os emblemas saem pela x1 (a que entrou primeiro)', v34Emblemas($uidX) === ['era-de-ouro', 'noite-de-gala'] && corr34CarreirasDosEmblemas($uidX) === [$pkX1]);
v33Adm(['acao' => 'apagar_carreira', 'id' => $pkX1, 'motivo' => 'Nome ofensivo.']);
$euX = v33Eu($navX, 'noite-de-gala');
checar('§E.7 apagada pela moderação a carreira que deu os emblemas: eles passam para a outra carreira-prova da conta que cumpre (continuam ativos, ?eu=1 com a x2)',
    v34Emblemas($uidX) === ['era-de-ouro', 'noite-de-gala'] && corr34CarreirasDosEmblemas($uidX) === [$pkX2] && corr34Retirados($uidX) === []
    && ($euX['emblema']['estado'] ?? '') === 'ativo' && ($euX['emblema']['carreiraId'] ?? '') === 'v34c-x2', json_encode($euX['emblema'] ?? null));
[$navY, $uidY] = v33Conta('Corr Troca Dois');
v34Salvar($navY, v34Hall('v34c-y1', [], []));
v34Salvar($navY, corr34ComReplay(v34Hall('v34c-y2', ['nota' => 72], []), 2));
$pkY1 = pkCarreira('v34c-y1', $uidY);
$pkY2 = pkCarreira('v34c-y2', $uidY);
v33Adm(['acao' => 'prova_verificar', 'resultados' => [['carreira' => $pkY1, 'ok' => false, 'versao' => corr34Versao($pkY1), 'detalhes' => ['motivo' => 'Gols: 794 → 600']],
    ['carreira' => $pkY2, 'ok' => true, 'versao' => corr34Versao($pkY2)]]]);
checar('§E.7 não bateu na y1 e bateu na y2 (no mesmo pedido): os emblemas ficam, agora pela y2 (a verificada)', v34Emblemas($uidY) === ['era-de-ouro', 'noite-de-gala']
    && corr34CarreirasDosEmblemas($uidY) === [$pkY2] && corr34Retirados($uidY) === []);
[$navZ, $uidZ] = v33Conta('Corr Volta');
v34Salvar($navZ, v34Hall('v34c-z1', [], []));
v33Adm(['acao' => 'apagar_carreira', 'id' => pkCarreira('v34c-z1', $uidZ), 'motivo' => 'Nome ofensivo.']);
$retZ = corr34Retirados($uidZ);
checar('(preparação) sem outra carreira que cumpra: os emblemas saem pelo sistema, com o motivo da moderação', v34Emblemas($uidZ) === [] && count($retZ) === 2
    && ($retZ['noite-de-gala'] ?? null) === ['A carreira foi apagada pela moderação.', 'sistema'], json_encode($retZ));
$r = v34Salvar($navZ, corr34ComReplay(v34Hall('v34c-z2', ['nota' => 73], []), 3));
$novosZ = array_column($r->json['emblemasNovos'] ?? [], 'slug');
sort($novosZ);
$pkZ2 = pkCarreira('v34c-z2', $uidZ);
checar('§E.7 depois, outra carreira-prova que cumpre: o emblema retirado pelo sistema volta sozinho (emblemasNovos), com a carreira nova, sem o motivo',
    $novosZ === ['era-de-ouro', 'noite-de-gala'] && v34Emblemas($uidZ) === ['era-de-ouro', 'noite-de-gala'] && corr34CarreirasDosEmblemas($uidZ) === [$pkZ2]
    && (int) v("SELECT COUNT(*) FROM emblemas_usuario WHERE usuario_id = ? AND (motivo IS NOT NULL OR quem IS NOT NULL)", [$uidZ]) === 0, $r->resumo());
$eidZ = (int) v("SELECT e.id FROM emblemas_usuario e JOIN desafios d ON d.id = e.desafio_id WHERE e.usuario_id = ? AND d.slug = 'noite-de-gala'", [$uidZ]);
v33Adm(['acao' => 'emblema_retirar', 'id' => $eidZ, 'motivo' => 'Tirado pela equipe no teste.']);
v34Salvar($navZ, corr34ComReplay(v34Hall('v34c-z3', ['nota' => 74], []), 4));
$retZ = corr34Retirados($uidZ);
checar('…o tirado à mão pela equipe (emblema_retirar) não volta, nem com outra carreira-prova que cumpre', !in_array('noite-de-gala', v34Emblemas($uidZ), true)
    && ($retZ['noite-de-gala'][0] ?? '') === 'Tirado pela equipe no teste.' && ($retZ['noite-de-gala'][1] ?? 'sistema') !== 'sistema', json_encode($retZ));

// ── fim: como o teste da v3.4 deixou ─────────────────────────────────────────────────────────────
q('DELETE FROM provas_nao_bateu');
v34Limpar();
acLimparEquipe();

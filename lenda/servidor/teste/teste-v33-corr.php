<?php
/**
 * LENDA · testes das correções da v3.3 (CONTRATO-v33.md §E): cada bloco é um achado confirmado e falhava antes da correção.
 *   E.1 o candidato é conferido de novo com a carreira guardada (salvar de novo, outro replay, verificar, declarar)
 *   E.2 mudar o critério de um desafio valendo recusa quem não cumpre mais (e quem volta a cumprir volta)
 *   E.3 os requisitos (Hall, top 3) valem na hora de declarar; o ?eu=1 e o painel dizem que não vale agora
 *   E.4 contagem de taça ou prêmio fora do formato (negativa, fração) deixa a carreira suspeita
 *   E.5 o bônus de OVR do replay é conferido (contra o da carreira e o da tabela bonus); teto 10, o do motor
 *   E.6 a semente da carreira sorteada pelo servidor (só ela vale; o limite do dia vale para ela; LGPD)
 *   E.7 o desafio de todas as conquistas não tem prova: não ativa, não verifica, não declara
 *   E.8 os e-mails de confirmação em baldes (cadastro por IP e por domínio; o "Reenviar código" à parte) e o aviso no painel
 *   E.9 ativar com início no passado: o `em` é a hora real (a carreira mais antiga é a primeira, não a conta mais antiga)
 * Incluído pelo teste.php depois do teste-v33.php (usa os ajudantes dele e os de antes). Deixa os desafios desativados.
 */
declare(strict_types=1);

v33Limpar();
acLimparEquipe();
$antes500Corr = count($FALHAS);

/** Cria um desafio de teste (desativado) e devolve o id. */
function corrDesafio(string $slug, array $criterio, array $extra = []): int
{
    $r = v33Adm(['acao' => 'desafio_salvar', 'slug' => $slug, 'titulo' => 'Correção ' . $slug, 'criterio' => $criterio] + $extra);
    if ($r->status !== 201) {
        checar("criar o desafio de teste $slug", false, $r->resumo());
    }
    return (int) ($r->json['desafio']['id'] ?? 0);
}

/** O candidato da conta no desafio (a linha de desafio_candidatos), ou []. */
function corrCand(int $did, int $uid): array
{
    return q('SELECT * FROM desafio_candidatos WHERE desafio_id = ? AND usuario_id = ? ORDER BY id LIMIT 1', [$did, $uid])[0] ?? [];
}

function corrAtivar(int $did): Resposta
{
    return v33Adm(['acao' => 'desafio_ativar', 'id' => $did, 'ativo' => true]);
}

/** O "eu" do ?eu=1 para o desafio de id $did. */
function corrEu(Navegador $n, int $did): ?array
{
    return v33Eu($n, (string) v('SELECT slug FROM desafios WHERE id = ?', [$did]));
}

/** O texto da semente de um par (a mesma conta do jogo). */
function corrSemente(array $par): string
{
    return base_convert((string) $par[0], 10, 36) . base_convert((string) $par[1], 10, 36);
}

// ══ E.1 candidato conferido de novo ═══════════════════════════════════════════════════════════════

secao('v3.3 §E.1 · o candidato é conferido de novo com a carreira GUARDADA (a foto de quando nasceu não decide)');
v33ZerarDesafios();
$dTroca = corrDesafio('corr-troca', ['copas' => 1, 'libertadores' => 2]);
corrAtivar($dTroca);
[$navF, $uidF] = v33Conta('Forjador Corr');
v33Salvar($navF, v33Hall('corr-x', 1, 2)); // T0: o resumo forjado (1 Copa e 2 Libertadores)
$kF = corrCand($dTroca, $uidF);
usleep(30_000);
[$navH, $uidH] = v33Conta('Honesto Corr');
v33Salvar($navH, v33Hall('corr-y', 1, 2)); // T1: a de verdade
$kH = corrCand($dTroca, $uidH);
checar('os dois viram candidatos, o forjado com o menor em', ($kF['estado'] ?? '') === 'pendente' && ($kH['estado'] ?? '') === 'pendente'
    && (string) $kF['em'] < (string) $kH['em'], json_encode([$kF, $kH]));
// T2: o forjado salva de novo a MESMA carreira (mesmo id e replay) com o conteúdo de verdade: 0 Copas, 0 Libertadores
v33Salvar($navF, v33Hall('corr-x', 0, 0, true, ['headline' => 'A de verdade']));
$kF2 = corrCand($dTroca, $uidF);
checar('salvar de novo sem cumprir o critério → o candidato é recusado pelo sistema, com o motivo (antes: seguia pendente e "o primeiro")',
    ($kF2['estado'] ?? '') === 'recusada' && ($kF2['quem'] ?? '') === 'sistema' && str_contains((string) ($kF2['motivo'] ?? ''), 'não cumpre o critério'), json_encode($kF2));
$K = v33Get('r=desafio&id=' . $dTroca)->json['candidatos']['itens'] ?? [];
$primeiro = array_values(array_filter($K, static fn($k) => ($k['primeiro'] ?? false) === true));
checar('…e o primeiro que ainda conta passa a ser o honesto', ($primeiro[0]['usuario']['id'] ?? 0) === $uidH, json_encode($primeiro));
$r = v33Adm(['acao' => 'candidato_verificar', 'id' => (int) $kF2['id'], 'resultado' => ['ok' => true, 'detalhes' => ['v' => 1]]]);
checar('verificar o forjado com "bateu" (a carreira guardada, a de verdade, é a do motor) → continua recusado: ela não cumpre o critério',
    $r->status === 200 && ($r->json['candidatos'][0]['estado'] ?? '') === 'recusada' && str_starts_with((string) ($r->json['candidatos'][0]['motivo'] ?? ''), 'Bateu no replay, mas não vale')
    && ($r->json['candidatos'][0]['valeAgora']['motivo'] ?? '') === 'criterio' && v('SELECT estado FROM desafio_candidatos WHERE id = ?', [(int) $kF2['id']]) === 'recusada', $r->resumo());
$r1 = v33Adm(['acao' => 'desafio_declarar_vencedor', 'candidatoId' => (int) $kF2['id']]);
v33Adm(['acao' => 'candidato_verificar', 'id' => (int) $kH['id'], 'resultado' => ['ok' => true]]);
$r2 = v33Adm(['acao' => 'desafio_declarar_vencedor', 'candidatoId' => (int) $kH['id']]);
checar('declarar o forjado → 409; o honesto, verificado, vence (200)', $r1->status === 409 && $r2->status === 200
    && (int) v('SELECT vencedor_usuario_id FROM desafios WHERE id = ?', [$dTroca]) === $uidH, $r1->resumo() . ' | ' . $r2->resumo());

// outra carreira com o mesmo id (outro replay): a hora do candidato recomeça
v33ZerarDesafios();
$dRep = corrDesafio('corr-replay', ['copas' => 1]);
corrAtivar($dRep);
[$navR, $uidR] = v33Conta('Troca Replay');
v33Salvar($navR, v33Hall('corr-r', 1, 0));
$kR = corrCand($dRep, $uidR);
$primeiraR = (string) v('SELECT primeira_em FROM carreiras WHERE id = ?', [pkCarreira('corr-r', $uidR)]);
usleep(1_100_000);
$rep = v33Replay();
$rep['picks'] = array_slice($rep['picks'], 0, -1); // outras escolhas (o mesmo id e a mesma semente)
v33Salvar($navR, v33Hall('corr-r', 1, 0, $rep));
$kR2 = corrCand($dRep, $uidR);
checar('salvar de novo com outro replay (outra carreira, o mesmo id): o candidato fica com a hora de agora e a carreira com a entrada de agora (antes: a hora velha segurava o lugar)',
    ($kR2['estado'] ?? '') === 'pendente' && (string) $kR2['em'] > (string) $kR['em'] && str_contains((string) $kR2['motivo'], 'outras escolhas')
    && (string) v('SELECT primeira_em FROM carreiras WHERE id = ?', [pkCarreira('corr-r', $uidR)]) > $primeiraR, json_encode([$kR, $kR2]));

// a carreira guardada muda por fora do salvar: verificar e declarar conferem na hora
v33ZerarDesafios();
$dDec = corrDesafio('corr-declarar', ['copas' => 1, 'libertadores' => 2]);
corrAtivar($dDec);
[$navD, $uidD] = v33Conta('Declara Corr');
v33Salvar($navD, v33Hall('corr-d', 1, 2));
$kD = corrCand($dDec, $uidD);
v33Adm(['acao' => 'candidato_verificar', 'id' => (int) $kD['id'], 'resultado' => ['ok' => true]]);
q('UPDATE carreiras SET copas = 0 WHERE id = ?', [pkCarreira('corr-d', $uidD)]);
$r = v33Adm(['acao' => 'desafio_declarar_vencedor', 'candidatoId' => (int) $kD['id']]);
checar('declarar um verificado cuja carreira guardada não cumpre mais → 409 nao_cumpre (motivo criterio) e ele é recusado; sem vencedor (antes: 200)',
    $r->status === 409 && $r->erro() === 'nao_cumpre' && ($r->json['motivo'] ?? '') === 'criterio' && ($r->json['recusado'] ?? null) === true
    && v('SELECT estado FROM desafio_candidatos WHERE id = ?', [(int) $kD['id']]) === 'recusada' && v('SELECT vencido_em FROM desafios WHERE id = ?', [$dDec]) === null, $r->resumo());
[$navD2, $uidD2] = v33Conta('Verifica Corr');
v33Salvar($navD2, v33Hall('corr-d2', 1, 2));
$kD2 = corrCand($dDec, $uidD2);
q('UPDATE carreiras SET libertadores = 1 WHERE id = ?', [pkCarreira('corr-d2', $uidD2)]);
$r = v33Adm(['acao' => 'candidato_verificar', 'id' => (int) $kD2['id'], 'resultado' => ['ok' => true]]);
checar('verificar com "bateu" um candidato cuja carreira guardada não cumpre → recusado (antes: verificado)', $r->status === 200
    && ($r->json['candidatos'][0]['estado'] ?? '') === 'recusada' && v('SELECT estado FROM desafio_candidatos WHERE id = ?', [(int) $kD2['id']]) === 'recusada', $r->resumo());

// ══ E.2 critério mudado ══════════════════════════════════════════════════════════════════════════

secao('v3.3 §E.2 · mudar o critério de um desafio valendo confere de novo os candidatos que já existem');
v33ZerarDesafios();
$dCrit = corrDesafio('corr-criterio', ['copas' => 2]);
corrAtivar($dCrit);
[$navC, $uidC] = v33Conta('Criterio Corr');
v33Salvar($navC, v33Hall('corr-c', 2, 0));
$kC = corrCand($dCrit, $uidC);
$r = v33Adm(['acao' => 'desafio_salvar', 'id' => $dCrit, 'criterio' => ['copas' => 3]]);
$kC2 = corrCand($dCrit, $uidC);
checar('{copas: 2} → {copas: 3}: o candidato de 2 Copas é recusado ("O desafio mudou: …") e a resposta conta os recusados (antes: seguia pendente e "o primeiro")',
    $r->status === 200 && ($r->json['candidatosRecusados'] ?? 0) === 1 && ($kC2['estado'] ?? '') === 'recusada' && str_starts_with((string) $kC2['motivo'], 'O desafio mudou:')
    && v33Adm(['acao' => 'desafio_declarar_vencedor', 'candidatoId' => (int) $kC['id']])->status === 409, $r->resumo() . ' ' . json_encode($kC2));
usleep(1_100_000);
$r = v33Adm(['acao' => 'desafio_salvar', 'id' => $dCrit, 'criterio' => ['copas' => 2]]);
$kC3 = corrCand($dCrit, $uidC);
checar('de volta a {copas: 2}: o recusado pelo sistema volta a pendente, com a hora nova (a equipe não tinha decidido nada)', $r->status === 200
    && ($kC3['estado'] ?? '') === 'pendente' && (string) $kC3['em'] > (string) $kC['em'] && $kC3['quem'] === null, json_encode($kC3));
$r = v33Adm(['acao' => 'candidato_recusar', 'id' => (int) $kC3['id'], 'motivo' => 'Recusado pela equipe.']);
v33Adm(['acao' => 'desafio_salvar', 'id' => $dCrit, 'criterio' => ['copas' => 1]]);
checar('…mas o recusado pela equipe continua recusado quando o critério muda', v('SELECT CONCAT(estado, "|", motivo) FROM desafio_candidatos WHERE id = ?', [(int) $kC3['id']]) === 'recusada|Recusado pela equipe.');

// ══ E.3 requisitos na hora de declarar ════════════════════════════════════════════════════════════

secao('v3.3 §E.3 · os requisitos valem na hora de declarar; o ?eu=1 e o painel dizem que o candidato não vale agora');
v33ZerarDesafios();
$dHall = corrDesafio('corr-hall', ['copas' => 1]);
corrAtivar($dHall);
[$navK, $uidK] = v33Conta('Hall Corr');
v33Salvar($navK, v33Hall('corr-k', 1, 0));
$kK = corrCand($dHall, $uidK);
v33Adm(['acao' => 'candidato_verificar', 'id' => (int) $kK['id'], 'resultado' => ['ok' => true]]);
$r = conta($navK, ['acao' => 'perfil', 'hallPublico' => 'nao']);
$eu = corrEu($navK, $dHall);
$K = v33Get('r=desafio&id=' . $dHall)->json['candidatos']['itens'][0] ?? [];
checar('fechou o Hall depois de virar candidato: o ?eu=1 diz candidato.vale = false (nao_publicada, com a frase) e o painel valeAgora.ok = false',
    $r->status === 200 && ($eu['candidato']['estado'] ?? '') === 'verificada' && ($eu['candidato']['vale'] ?? null) === false
    && ($eu['candidato']['motivoAgora'] ?? '') === 'nao_publicada' && is_string($eu['candidato']['motivoAgoraTexto'] ?? null)
    && ($K['valeAgora']['ok'] ?? null) === false && ($K['valeAgora']['motivo'] ?? '') === 'nao_publicada', json_encode([$eu['candidato'] ?? null, $K['valeAgora'] ?? null]));
$r = v33Adm(['acao' => 'desafio_declarar_vencedor', 'candidatoId' => (int) $kK['id']]);
checar('declarar → 409 nao_cumpre (nao_publicada); o candidato NÃO é recusado (é da conta, não da carreira) e a hora fica (antes: 200, vencedor com o perfil 404)',
    $r->status === 409 && $r->erro() === 'nao_cumpre' && ($r->json['motivo'] ?? '') === 'nao_publicada' && ($r->json['recusado'] ?? null) === false
    && v('SELECT CONCAT(estado, "|", em) FROM desafio_candidatos WHERE id = ?', [(int) $kK['id']]) === 'verificada|' . $kK['em'], $r->resumo());
conta($navK, ['acao' => 'perfil', 'hallPublico' => 'auto']);
$r = v33Adm(['acao' => 'desafio_declarar_vencedor', 'candidatoId' => (int) $kK['id']]);
checar('de volta ao Hall: vale de novo e o declarar passa (200)', $r->status === 200, $r->resumo());

// ══ E.4 contagem de taças ════════════════════════════════════════════════════════════════════════

secao('v3.3 §E.4 · contagem de taça ou prêmio fora do formato: suspeita (o servidor e o motor contam igual)');
v33ZerarDesafios();
$dCont = corrDesafio('corr-contagem', ['copas' => 3, 'libertadores' => 2]);
corrAtivar($dCont);
[$navT, $uidT] = v33Conta('Contagem Corr');
$hT = v33Hall('corr-t', 1, 0);
foreach ([['world-cup', 2], ['world-cup', -2], ['libertadores', 2], ['libertadores', -2]] as [$tid, $n]) {
    $hT->summary->trophies[] = (object) ['trophyId' => $tid, 'count' => $n, 'seasons' => []];
}
$r = v33Salvar($navT, $hT);
$lT = q('SELECT copas, libertadores, suspeita FROM carreiras WHERE id = ?', [pkCarreira('corr-t', $uidT)])[0] ?? [];
$euT = corrEu($navT, $dCont);
checar('Copas [1, 2, -2] e Libertadores [2, -2]: salva (200), mas suspeita "dados" e NÃO vira candidata de 3 + 2 (antes: copas 3, libertadores 2, sem suspeita, candidata)',
    $r->status === 200 && str_contains((string) ($lT['suspeita'] ?? ''), 'dados') && corrCand($dCont, $uidT) === []
    && ($euT['carreirasQueCumprem'][0]['motivo'] ?? '') === 'suspeita', json_encode([$lT, $euT['carreirasQueCumprem'] ?? null]));
$hT2 = v33Hall('corr-t2', 3, 2);
$hT2->summary->awards[] = (object) ['award' => 'ballon_dor', 'count' => 1.5];
v33Salvar($navT, $hT2);
checar('Bola de Ouro com fração (1,5): suspeita "dados" também', str_contains((string) v('SELECT suspeita FROM carreiras WHERE id = ?', [pkCarreira('corr-t2', $uidT)]), 'dados'));
$pc = phpComLib('require ' . var_export(dirname(__DIR__) . '/api/_carreiras.php', true) . '; $ok = []; foreach (glob(' . var_export(__DIR__ . '/amostras', true)
    . ' . "/{,v33/}*.json", GLOB_BRACE) as $f) { $h = json_decode((string) file_get_contents($f), false); $h = $h->hall[0] ?? $h; $e = extrairCampos($h); $ok[] = $e["contagens_ok"]; }'
    . ' $h = json_decode(json_encode(["identity" => ["surname" => "X"], "summary" => ["trophies" => [["trophyId" => "world-cup", "count" => 2], ["trophyId" => "world-cup", "count" => -2]]]]), false);'
    . ' $e = extrairCampos($h); echo json_encode(["amostras" => $ok, "copas" => $e["copas"], "ok" => $e["contagens_ok"]]);');
checar('extrairCampos: as amostras reais têm as contagens no formato; [2, -2] dá contagens_ok = false', is_array($pc) && $pc['amostras'] !== [] && !in_array(false, $pc['amostras'], true)
    && $pc['ok'] === false && $pc['copas'] === 2, json_encode($pc));

// ══ E.5 bônus de OVR do replay ════════════════════════════════════════════════════════════════════

secao('v3.3 §E.5 · o bônus de OVR do replay é conferido (o da carreira e o da tabela bonus); teto +10, o do motor');
v33ZerarDesafios();
$dBon = corrDesafio('corr-bonus', ['copas' => 1]);
corrAtivar($dBon);
[$navB, $uidB] = v33Conta('Bonus Corr');
v33Salvar($navB, v33Hall('corr-b', 1, 0, v33Replay(0, ['bonusOvr' => 10]))); // +10 no replay, sem career.bonusOvr, conta sem bônus
$lB = q('SELECT bonus_ovr, suspeita, tem_replay FROM carreiras WHERE id = ?', [pkCarreira('corr-b', $uidB)])[0] ?? [];
checar('replay com +10 e o career.bonusOvr apagado (conta sem bônus): bonus_ovr 10, suspeita "bonus", não vira candidata (antes: bonus_ovr 0, sem suspeita, candidata)',
    (int) ($lB['bonus_ovr'] ?? -1) === 10 && str_contains((string) ($lB['suspeita'] ?? ''), 'bonus') && (int) ($lB['tem_replay'] ?? 0) === 1 && corrCand($dBon, $uidB) === [],
    json_encode($lB));
q("INSERT INTO bonus (usuario_id, valor, origem, ref, criado_em, usado_em, carreira_id) VALUES (?, 3, 'admin', 'corr-b2', UTC_TIMESTAMP(), UTC_TIMESTAMP(), 'corr-b2')", [$uidB]);
v33Salvar($navB, v33Hall('corr-b2', 1, 0, v33Replay(0, ['bonusOvr' => 3]), ['bonus' => 3]));
$kB2 = corrCand($dBon, $uidB);
checar('o bônus que a conta usou nesta carreira (+3 no replay, no career e na tabela): sem suspeita e vira candidata', v('SELECT suspeita FROM carreiras WHERE id = ?', [pkCarreira('corr-b2', $uidB)]) === null
    && ($kB2['estado'] ?? '') === 'pendente', json_encode($kB2));
v33Salvar($navB, v33Hall('corr-b3', 1, 0, v33Replay(0, ['bonusOvr' => 3]), ['bonus' => 5]));
checar('career.bonusOvr +5 e replay +3: suspeita "bonus"', str_contains((string) v('SELECT suspeita FROM carreiras WHERE id = ?', [pkCarreira('corr-b3', $uidB)]), 'bonus'));
$r = v33Salvar($navB, v33Hall('corr-b4', 1, 0, v33Replay(0, ['bonusOvr' => 15])));
$ts = (string) file_get_contents(dirname($SRC) . '/src/engine/career/constants.ts');
$maxPhp = phpComLib('require ' . var_export(dirname(__DIR__) . '/api/_carreiras.php', true) . '; echo json_encode(BONUS_OVR_MAX);');
checar('BONUS_OVR_MAX do servidor = o do motor (10); replay com +15 sai do HallEntry (temReplay false)', preg_match('/BONUS_OVR_MAX = (\d+)/', $ts, $mm) === 1
    && (int) $mm[1] === 10 && $maxPhp === 10 && ($r->json['carreira']['temReplay'] ?? null) === false, json_encode($maxPhp));

// ══ E.6 semente sorteada pelo servidor ════════════════════════════════════════════════════════════

secao('v3.3 §E.6 · semente da carreira sorteada pelo servidor: só ela vale para desafio, e o limite do dia vale para ela');
v33ZerarDesafios();
$dSem = corrDesafio('corr-semente', ['copas' => 1]);
corrAtivar($dSem);
$r = $anon->pedir('POST', '/api/carreiras.php', ['acao' => 'semente']);
checar('POST carreiras.php {acao: "semente"} sem conta → 401', $r->status === 401, $r->resumo());
[$navS, $uidS, , $senhaS] = v33Conta('Semente Corr');
unset($V33_UIDS[spl_object_id($navS)]); // daqui em diante, só as sementes que o servidor sortear de verdade
$r = $navS->pedir('POST', '/api/carreiras.php', ['acao' => 'semente']);
$parS = $r->json['semente'] ?? null;
checar('com a conta → 200 {semente: [a0, a1], id: "career-<semente>", motivo: null, hoje: 1, max: 100}; guardada para a conta (o texto, com a hora)', $r->status === 200
    && is_array($parS) && count($parS) === 2 && is_int($parS[0]) && is_int($parS[1]) && $parS[0] >= 0 && $parS[1] <= 4294967295
    && ($r->json['id'] ?? '') === 'career-' . corrSemente($parS) && nulo($r->json, 'motivo') && ($r->json['hoje'] ?? 0) === 1 && ($r->json['max'] ?? 0) === 100
    && (int) v('SELECT COUNT(*) FROM sementes_carreira WHERE usuario_id = ? AND semente = ?', [$uidS, corrSemente($parS)]) === 1, $r->resumo());
v33Salvar($navS, v33Hall('corr-s-aparelho', 1, 0, v33Replay(0, ['seed' => [111111, 222222]])));
$euS = corrEu($navS, $dSem);
checar('a carreira com a semente do aparelho (jogada sem a conta e salva depois): não vale (sem_semente), semente_em NULL (antes: candidata)',
    corrCand($dSem, $uidS) === [] && ($euS['carreirasQueCumprem'][0]['motivo'] ?? '') === 'sem_semente'
    && v('SELECT semente_em FROM carreiras WHERE id = ?', [pkCarreira('corr-s-aparelho', $uidS)]) === null, json_encode($euS['carreirasQueCumprem'] ?? null));
$hS = v33Hall('career-' . corrSemente($parS), 1, 0, v33Replay(0, ['seed' => $parS]));
v33Salvar($navS, $hS);
$kS = corrCand($dSem, $uidS);
checar('a carreira com a semente que o servidor sorteou para a conta: vira candidata (semente_em = a hora do sorteio)', ($kS['estado'] ?? '') === 'pendente'
    && v('SELECT semente_em FROM carreiras WHERE id = ?', [pkCarreira($hS->id, $uidS)]) !== null, json_encode($kS));
[$navS2, $uidS2] = v33Conta('Semente Alheia');
unset($V33_UIDS[spl_object_id($navS2)]);
v33Salvar($navS2, v33Hall('corr-s-alheia', 1, 0, v33Replay(0, ['seed' => $parS])));
checar('a mesma semente salva por outra conta (não foi sorteada para ela): não vale', corrCand($dSem, $uidS2) === []
    && in_array((corrEu($navS2, $dSem)['carreirasQueCumprem'][0]['motivo'] ?? ''), ['sem_semente', 'suspeita'], true));
$r = $navS->pedir('POST', '/api/carreiras.php', ['acao' => 'semente']);
$parS2 = $r->json['semente'] ?? [0, 0];
q('UPDATE sementes_carreira SET emitida_em = UTC_TIMESTAMP(3) - INTERVAL 1 DAY WHERE usuario_id = ? AND semente = ?', [$uidS, corrSemente($parS2)]);
v33Salvar($navS, v33Hall('corr-s-antes', 1, 0, v33Replay(0, ['seed' => $parS2])));
checar('semente sorteada antes do começo do desafio (carreira começada antes, salva depois): não vale (antes_do_inicio)', corrCand($dSem, $uidS) !== []
    && count(q('SELECT id FROM desafio_candidatos WHERE desafio_id = ? AND usuario_id = ?', [$dSem, $uidS])) === 1
    && array_column(corrEu($navS, $dSem)['carreirasQueCumprem'] ?? [], 'motivo', 'carreiraId')['corr-s-antes'] === 'antes_do_inicio');
v33Adm(['acao' => 'config', 'valores' => ['partidas_dia_max' => 10]]);
$st = [];
for ($i = 0; $i < 9; $i++) {
    resetarLimitesCurtos();
    $r = $navS->pedir('POST', '/api/carreiras.php', ['acao' => 'semente']);
    $st[] = is_array($r->json['semente'] ?? null) ? 's' : (string) ($r->json['motivo'] ?? $r->status);
}
checar('limite de 10 partidas por dia: com 2 sorteadas hoje, mais 8 saem; a 11ª do dia vem sem semente (motivo limite_diario) — 100 carreiras por dia é o teto que conta',
    $st === ['s', 's', 's', 's', 's', 's', 's', 's', 'limite_diario'] && (int) v('SELECT COUNT(*) FROM sementes_carreira WHERE usuario_id = ?', [$uidS]) === 10, json_encode($st));
v33Adm(['acao' => 'config', 'valores' => ['partidas_dia_max' => 100]]);
resetarLimitesCurtos();
$r = conta($navS, ['acao' => 'excluir', 'senha' => $senhaS]);
checar('LGPD: excluir a conta apaga as sementes sorteadas para ela', $r->status === 200 && (int) v('SELECT COUNT(*) FROM sementes_carreira WHERE usuario_id = ?', [$uidS]) === 0, $r->resumo());
$rg = acEquipe(novoNav(), ['acao' => 'backup_guardar'], acBearer());
checar('o backup não leva as sementes (como os códigos e as partidas por dia)', $rg->status === 200 && !isset($rg->json['contagem']['sementes_carreira']), $rg->resumo());

// ══ E.7 todas as conquistas ══════════════════════════════════════════════════════════════════════

secao('v3.3 §E.7 · o desafio de todas as conquistas: as conquistas do aparelho não provam nada (v3.4: só as provadas por carreiras)');
v33ZerarDesafios();
// v3.4 (CONTRATO-v34 §A): o §E.7 foi trocado pela prova — o desafio ativa e um ativo pode virar o de todas as conquistas; o que
// continua: com as conquistas só do aparelho, "Conferi as conquistas" (verificar com ok) e declarar → 409 sem_prova
$r = v33Ativar('todas-as-conquistas');
checar('v3.4: ativar → 200 (o §E.7 da v3.3 respondia 409 sem_prova)', $r->status === 200, $r->resumo());
v33Ativar('todas-as-conquistas', false);
$dQ = corrDesafio('corr-conq', ['copas' => 1]);
corrAtivar($dQ);
$r = v33Adm(['acao' => 'desafio_salvar', 'id' => $dQ, 'criterio' => ['todasConquistas' => true]]);
checar('v3.4: um desafio ativo pode virar o de todas as conquistas (a prova é a das carreiras)', $r->status === 200
    && v33Adm(['acao' => 'desafio_ativar', 'id' => $dQ, 'ativo' => false])->status === 200, $r->resumo());
q("UPDATE desafios SET ativo = 1, inicio = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE slug = 'todas-as-conquistas'");
[$navQ, $uidQ] = v33Conta('Conquistas Corr');
$navQ->pedir('POST', '/api/conquistas.php', ['acao' => 'sincronizar', 'conquistas' => array_map(static fn(string $id): array => ['id' => $id], $idsPhp['ids'])]);
$semQ = corrCand(v33IdDesafio('todas-as-conquistas'), $uidQ) === [];
// o candidato que nasceu antes da v3.4 (pelas conquistas do aparelho) continua no banco: não verifica nem vence sem a prova
q("INSERT INTO desafio_candidatos (desafio_id, chave, usuario_id, em, estado) VALUES (?, ?, ?, UTC_TIMESTAMP(3), 'pendente')",
    [v33IdDesafio('todas-as-conquistas'), 'u' . $uidQ, $uidQ]);
$kQ = corrCand(v33IdDesafio('todas-as-conquistas'), $uidQ);
$r1 = v33Adm(['acao' => 'candidato_verificar', 'id' => (int) ($kQ['id'] ?? 0), 'resultado' => ['ok' => true, 'detalhes' => ['v' => 1, 'manual' => true, 'conquistas' => true]]]);
q("UPDATE desafio_candidatos SET estado = 'verificada' WHERE id = ?", [(int) ($kQ['id'] ?? 0)]);
$r2 = v33Adm(['acao' => 'desafio_declarar_vencedor', 'candidatoId' => (int) ($kQ['id'] ?? 0)]);
$r3 = v33Adm(['acao' => 'candidato_verificar', 'id' => (int) ($kQ['id'] ?? 0), 'resultado' => ['ok' => false, 'detalhes' => ['motivo' => 'Sem prova.']]]);
checar('as 87 só do aparelho não fazem candidato (v3.4); o candidato de antes: "Conferi as conquistas" → 409 sem_prova (com faltam); declarar → 409 sem_prova; recusar continua valendo',
    $semQ && ($kQ['estado'] ?? '') === 'pendente' && $r1->status === 409 && $r1->erro() === 'sem_prova' && count($r1->json['faltam'] ?? []) === 87
    && $r2->status === 409 && $r2->erro() === 'sem_prova' && $r3->status === 200 && v("SELECT vencido_em FROM desafios WHERE slug = 'todas-as-conquistas'") === null,
    $r1->resumo() . ' | ' . $r2->resumo());
q("UPDATE desafios SET ativo = 0, inicio = NULL WHERE slug = 'todas-as-conquistas'");

// ══ E.8 e-mails de confirmação ═══════════════════════════════════════════════════════════════════

secao('v3.3 §E.8 · e-mails de confirmação em baldes: o cadastro em massa não deixa ninguém sem código');
resetarLimitesCurtos();
q("DELETE FROM tentativas WHERE chave LIKE 'dia-verif-%'");
comConfig(['ip_cabecalho' => 'HTTP_X_FORWARDED_FOR'], static function (): void {
    resetarLimitesCurtos();
    $mails = [];
    for ($i = 1; $i <= 16; $i++) {
        $email = 'corr-ip-' . $i . '-' . bin2hex(random_bytes(3)) . '@exemplo.com';
        $r = conta(novoNav(), ['acao' => 'cadastrar', 'apelido' => 'Massa ' . $i, 'email' => $email, 'senha' => 'senha-corr-' . $i, 'aceite' => true],
            ['cab' => ['X-Forwarded-For: 10.77.1.1']]);
        if ($r->status !== 201) {
            checar("cadastro $i do mesmo IP", false, $r->resumo());
        }
        $mails[] = $email;
    }
    usleep(1_500_000);
    $recebidos = array_map(static fn(string $e): int => count(emailsPara($e)), $mails);
    checar('16 cadastros do mesmo IP: os 16 entram (201), mas só 15 recebem o código sozinho (antes: os 16; o balde do site esvaziava com poucos IPs)',
        array_sum($recebidos) === 15 && $recebidos[15] === 0, json_encode($recebidos));
    resetarLimitesCurtos();
    $dom = 'vitima-' . bin2hex(random_bytes(3)) . '.example';
    $rec = [];
    for ($i = 1; $i <= 21; $i++) {
        $email = 'corr-dom-' . $i . '@' . $dom;
        conta(novoNav(), ['acao' => 'cadastrar', 'apelido' => 'Dominio ' . $i, 'email' => $email, 'senha' => 'senha-dom-' . $i, 'aceite' => true],
            ['cab' => ['X-Forwarded-For: 10.78.' . $i . '.1']]);
        $rec[] = $email;
    }
    usleep(1_500_000);
    $nDom = array_sum(array_map(static fn(string $e): int => count(emailsPara($e)), $rec));
    checar('21 cadastros de IPs diferentes para o mesmo domínio (não é um grande provedor): só 20 e-mails para ele em 10 min', $nDom === 20, "$nDom e-mails");
});
resetarLimitesCurtos();
[$navM, $uidM] = v33Conta('Reenvia Jogador', false, 30);
$emailM = (string) v('SELECT email FROM usuarios WHERE id = ?', [$uidM]);
// a enxurrada de cadastros encheu o balde do cadastro (e, no código de antes, o único balde do site)
encherLimite('verif-cad:todos', 120);
encherLimite('verif-todos:todos', 200);
$antesM = emailsPara($emailM);
$r = conta($navM, ['acao' => 'reenviar_verificacao']);
checar('com a cota do cadastro esgotada, o "Reenviar código" de quem já jogou ainda sai (200 e o e-mail; antes: 429)', $r->status === 200
    && esperarEmailNovo($emailM, $antesM) !== null, $r->resumo());
encherLimite('verif-jog:todos', 40);
encherLimite('verif-ped:todos', 40);
$r = conta($navM, ['acao' => 'reenviar_verificacao']);
checar('…e com os baldes do reenviar cheios também → 429 (a cota da hospedagem continua o teto)', $r->status === 429, $r->resumo());
$at = v33Get('r=atencao&atualizar=1')->json['alertas'] ?? [];
$alertaCota = array_values(array_filter($at, static fn($a) => ($a['chave'] ?? '') === 'emails_cota'));
checar('"Precisa de atenção": a cota de e-mails de confirmação esgotada (grave, com os números de cada balde)', ($alertaCota[0]['nivel'] ?? '') === 'grave'
    && str_contains((string) ($alertaCota[0]['texto'] ?? ''), 'esgotada'), json_encode($alertaCota));
resetarLimitesCurtos();
q("DELETE FROM tentativas WHERE chave LIKE 'dia-verif-%'");
v33Get('r=atencao&atualizar=1');

// ══ E.9 em do lote ════════════════════════════════════════════════════════════════════════════════

secao('v3.3 §E.9 · ativar com início no passado: o em de cada candidato é a hora real em que cumpriu');
v33ZerarDesafios();
$dOrd = corrDesafio('corr-ordem', ['libertadores' => 1], ['inicio' => v33Hoje()]);
[$navX, $uidX] = v33Conta('Ordem X'); // a conta mais antiga (id menor)
[$navY, $uidY] = v33Conta('Ordem Y');
v33Salvar($navY, v33Hall('corr-oy', 0, 1)); // Y cumpre primeiro
usleep(1_100_000);
v33Salvar($navX, v33Hall('corr-ox', 0, 1)); // X depois
$r = corrAtivar($dOrd);
// (as contas dos blocos de cima com carreira de Libertadores salva hoje também viram candidatas: aqui só X e Y importam)
$cs = q('SELECT usuario_id, em FROM desafio_candidatos WHERE desafio_id = ? AND usuario_id IN (?, ?) ORDER BY em, id', [$dOrd, $uidX, $uidY]);
checar('a carreira de Y entrou antes: Y é a primeira, com o em da entrada dela (antes: todas no mesmo instante, na ordem do id da conta, e X ganhava)',
    $r->status === 200 && count($cs) === 2 && (int) $cs[0]['usuario_id'] === $uidY && (int) $cs[1]['usuario_id'] === $uidX
    && substr((string) $cs[0]['em'], 0, 19) === (string) v('SELECT primeira_em FROM carreiras WHERE id = ?', [pkCarreira('corr-oy', $uidY)]), json_encode($cs));

checar('§E: nenhuma falha (nem 500) nas rotas das correções', count($FALHAS) === $antes500Corr);

// ── fim: desafios de teste fora, os de fábrica desativados ──────────────────────────────────────
q("DELETE FROM desafios WHERE slug LIKE 'corr-%'");
v33Limpar();
acLimparEquipe();

<?php
/**
 * LENDA · carreiras salvas na conta (cada uma é um HallEntry inteiro do jogo, guardado com gzip).
 *   GET  carreiras.php            → {carreiras: [C…], limite: 200, hallPublico, hallMax: 3} (C.hall: CONTRATO-v32 §A, X2)
 *   GET  carreiras.php?id=<id>    → {carreira: HallEntry}
 *   POST {"acao":"salvar","carreira": HallEntry, "como":"auto"|"manual"} → {carreira: C}
 *   POST {"acao":"apagar","id": "<id>"}                                  → {ok: true}
 *   POST {"acao":"publicar","id": "<id>","sim": true|false}             → {carreira: C, hallPublico}
 *   POST {"acao":"semente"}                                             → {semente: [a0, a1] | null, id, motivo, hoje, max}
 * Contrato: servidor/CONTRATO.md e CONTRATO-v3.md §4. v3.3 (CONTRATO-v33 §A): C.temReplay; o HallEntry.replay é conferido
 * (fora do formato ou grande demais: a carreira é salva sem ele); libertadores, primeira_em e fora_desafio (limite diário)
 * gravados; salvar, publicar e apagar avaliam os desafios. §E: a semente da carreira do Clássico é sorteada aqui (acao
 * semente, uma por início, até o limite de partidas do dia) e o salvar guarda quando ela saiu para a conta (semente_em: sem
 * ela, a carreira não vale para desafio); salvar de novo com outro replay é outra carreira (primeira_em e a hora do candidato
 * recomeçam) e todo conteúdo novo reconfere os candidatos dela.
 * v3.4 (CONTRATO-v34 §A): a carreira-prova (Clássico, semente do servidor, replay) guarda a lista de conquistas do motor
 * (career.achievements) e prova as conquistas da conta; o salvar responde provasNovas e emblemasNovos; C ganha `prova`;
 * conteúdo novo zera a verificação da prova; salvar e apagar refazem as provas da conta.
 * v3.4 §E: o "não bateu" da verificação vale pela semente (provas_nao_bateu: salvar de novo, outro id ou apagar e salvar não
 * desfazem); apagar a carreira ainda não verificada e salvar um conteúdo que não cumpre mais tiram os emblemas que ela deu
 * (passam para outra carreira-prova da conta que cumpra, ou saem pelo sistema).
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';
require __DIR__ . '/_hall.php';
require __DIR__ . '/_desafios.php';

cabecalhos();

const LIMITE_CARREIRAS = 200;
const MAX_CARREIRA_BYTES = 600 * 1024;
const MAX_CARREIRA_GZ = 128 * 1024;          // já comprimida (uma real fica abaixo de 10 KB)
const COTA_CONTA_BYTES = 20 * 1024 * 1024;   // soma de `tamanho` (JSON) das carreiras de uma conta
const SALVAR_KB_CONTA = 2048;                // KB comprimidos por conta a cada 10 min
const SALVAR_KB_IP = 4096;                   // KB comprimidos por IP a cada 10 min

function lerId(mixed $v): string
{
    if (!is_string($v) || $v === '' || mb_strlen($v, 'UTF-8') > 64 || preg_match('/[\p{Cc}]/u', $v)) {
        erro(400, 'id', 'Carreira inválida.');
    }
    return $v;
}

/** C de uma carreira da conta, com o noHall em vigor e onde ela está em relação ao Hall (C.hall). v3.4: e C.prova. */
function cDaConta(array $u, string $id, string $modoHall): ?array
{
    $uid = (int) $u['id'];
    $l = umaLinha('SELECT ' . camposC() . ' FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uid, $id]);
    return $l === null ? null : comProva(carreiraC($l, idsNoHall($uid, $modoHall), ['hall_publico' => $modoHall] + $u), (int) $l['id'], provasPorCarreira($uid));
}

/** v3.4: C.prova = {conquistas, unicas, verificada} da carreira-prova ou null (só com o banco da v3.4). */
function comProva(array $c, int $pk, array $provas): array
{
    if (esquemaV34()) {
        $c['prova'] = $provas[$pk] ?? null;
    }
    return $c;
}

// ── rotas ────────────────────────────────────────────────────────────────────────────────────────

$m = metodo();
if ($m !== 'GET' && $m !== 'POST') {
    erroMetodo();
}
if ($m === 'POST') {
    exigirEscrita();
    $corpo = lerJson(MAX_CARREIRA_BYTES, false, 512);
}
$u = exigirUsuario();
$uid = (int) $u['id'];
$modoHall = (string) ($u['hall_publico'] ?? 'auto');
limpezaTalvez();

if ($m === 'GET') {
    if (isset($_GET['id'])) {
        $id = lerId($_GET['id']);
        $dados = umValor('SELECT dados FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uid, $id]);
        $json = is_string($dados) ? @gzdecode($dados) : false;
        if (!is_string($json) || $json === '') {
            erro(404, 'nao_encontrada', 'Carreira não encontrada.');
        }
        responderBruto(200, '{"carreira":' . $json . '}');
    }
    $lista = sql('SELECT ' . camposC() . ' FROM carreiras WHERE usuario_id = ? ORDER BY salva_em DESC, id DESC', [$uid])->fetchAll();
    $noHall = idsNoHall($uid, $modoHall);
    $provas = provasPorCarreira($uid);
    responder(200, [
        'carreiras' => array_map(static fn(array $l): array => comProva(carreiraC($l, $noHall, $u), (int) $l['id'], $provas), $lista),
        'limite' => LIMITE_CARREIRAS,
        'hallPublico' => $modoHall,
        'hallMax' => LENDA_HALL_POR_CONTA,
    ]);
}

$acao = is_string($corpo->acao ?? null) ? $corpo->acao : '';

if ($acao === 'semente') {
    // §E: a semente da carreira do Clássico que começa agora, sorteada pelo servidor (só a carreira com ela vale para desafio)
    if (!esquemaV33()) {
        erro(503, 'indisponivel', 'Ainda não disponível: a carreira começa com a semente do aparelho.');
    }
    limitar('semente', 'u' . $uid, 60);
    responder(200, emitirSemente($uid));
}

if ($acao === 'salvar') {
    $h = $corpo->carreira ?? null;
    if (!($h instanceof stdClass) || !($h->identity ?? null) instanceof stdClass || !($h->summary ?? null) instanceof stdClass) {
        erro(400, 'carreira_invalida', 'Carreira inválida.');
    }
    $id = $h->id ?? null;
    if (!is_string($id) || $id === '' || mb_strlen($id, 'UTF-8') > 64 || preg_match('/[\p{Cc}]/u', $id)) {
        erro(400, 'carreira_invalida', 'Carreira inválida.');
    }
    $como = $corpo->como ?? 'manual';
    if ($como !== 'auto' && $como !== 'manual') {
        erro(400, 'como', 'Modo de salvar inválido.');
    }
    arrumarReplay($h); // v3.3: replay fora do formato (ou do Imersivo) sai; a carreira entra sem ele
    $json = json($h);
    if (strlen($json) > MAX_CARREIRA_BYTES) {
        erro(413, 'grande', 'Carreira grande demais para salvar.');
    }
    $f = extrairCampos($h);
    $gz = gzencode($json, 6);
    if (strlen($gz) > MAX_CARREIRA_GZ) {
        erro(413, 'grande', 'Carreira grande demais para salvar.'); // dado que não comprime: não é uma carreira de verdade
    }
    // Limite em bytes (não em pedidos): ao entrar, o jogo sobe de uma vez até 100 carreiras 90+ do aparelho.
    $kb = intdiv(strlen($gz), 1024) + 1;
    limitar('salvar-kb', 'u' . $uid, SALVAR_KB_CONTA, $kb);
    limitar('salvar-ip-kb', quemIp(), SALVAR_KB_IP, $kb);
    $agora = dt(time());
    // §E: quando a semente desta carreira saiu do servidor para a conta (null = não saiu: começou sem a conta, com a semente
    // do aparelho, ou passou do limite do dia) e o replay que chega agora (para saber se é outra carreira com o mesmo id)
    $semente = sementeDoReplay($h);
    $sementeEm = sementeEmitidaEm($uid, $semente);
    $replayNovo = property_exists($h, 'replay') ? json($h->replay) : null;
    // v3.4 §E: a semente desta carreira já "não bateu" na verificação por replay (a verificação do admin, guardada pela semente):
    // ela nasce "não bateu" de novo — salvar com 1 byte diferente, com outro id ou apagar e salvar não desfaz
    $naoBateu = naoBateuDaSemente($uid, $semente);
    // v3.3: salva num dia (Brasília) em que a conta passou do limite de partidas (hoje ou o dia em que ela terminou): não vale
    // para desafio
    $foraDesafio = null;
    if (esquemaV33()) {
        $dias = [diaBrasilia()];
        $fimT = paraTempo($f['terminou_em']);
        if ($fimT !== null && $fimT <= time()) {
            $dias[] = diaBrasilia($fimT);
        }
        $foraDesafio = passouLimiteEm($uid, $dias) ? 'limite_diario' : null;
    }
    [$mudouSuspeita, $mudouDados, $mudouReplay] = transacao(static function () use ($uid, $id, $como, $json, $f, $gz, $agora, $foraDesafio, $sementeEm, $replayNovo, $naoBateu, $semente): array {
        sql('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', [$uid]); // uma gravação por conta de cada vez
        // v3.2: carreira apagada pela moderação não volta pelo aparelho (lixeira_carreiras; o admin pode liberar)
        if (esquemaV32() && umValor('SELECT 1 FROM lixeira_carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uid, $id]) !== null) {
            erro(409, 'apagada', 'Esta carreira foi removida pela moderação.');
        }
        $antes = umaLinha('SELECT id, suspeita, clubes, dados FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uid, $id]);
        if ($antes === null && (int) umValor('SELECT COUNT(*) FROM carreiras WHERE usuario_id = ?', [$uid]) >= LIMITE_CARREIRAS) {
            erro(409, 'cheio', 'Sua conta já tem ' . LIMITE_CARREIRAS . ' carreiras salvas. Apague alguma para salvar esta.');
        }
        $usado = (int) umValor('SELECT COALESCE(SUM(tamanho), 0) FROM carreiras WHERE usuario_id = ? AND carreira_id <> ?', [$uid, $id]);
        if ($usado + strlen($json) > COTA_CONTA_BYTES) {
            erro(409, 'cheio', 'Sua conta está cheia. Apague alguma carreira para salvar esta.');
        }
        // Plausibilidade: conferida quando a carreira entra ou quando qualquer coisa nela muda (números, nomes, textos).
        // Salvar de novo exatamente a mesma carreira mantém a decisão anterior (inclusive a do admin, que liberou).
        $jsonAntes = $antes !== null && is_string($antes['dados']) ? @gzdecode($antes['dados']) : false;
        $mesma = $antes !== null && $antes['clubes'] !== null && $jsonAntes === $json;
        // §E: o replay de antes era outro (outras escolhas, outra semente, ou não havia)? Então é outra carreira com o mesmo id
        $mudouReplay = false;
        $mudouSemente = false;
        if ($antes !== null && !$mesma) {
            $hAntes = is_string($jsonAntes) ? json_decode($jsonAntes, false, 512) : null;
            $replayAntes = $hAntes instanceof stdClass && property_exists($hAntes, 'replay') ? json($hAntes->replay) : null;
            $mudouReplay = $replayAntes !== $replayNovo;
            // v3.4 §E: o "não bateu" de antes só deixa de valer quando é outra semente (outra carreira)
            $mudouSemente = ($hAntes instanceof stdClass ? sementeDoReplay($hAntes) : null) !== $semente;
        }
        $suspeita = $mesma ? $antes['suspeita'] : plausibilidade($f, $uid, $id);
        // carreira que entra agora: se ela (ou o mesmo resumo com outro id) já foi escondida antes, volta escondida
        $oculta = $antes === null ? moderacaoHerdada($uid, $id, $f['resumo_hash']) : 0;
        sql('INSERT INTO carreiras (usuario_id, carreira_id, modo, jogador, numero, pais, posicao, nota, nota_v, pico_ovr, temporadas,
                gols, titulos, bolas_ouro, headline, como, dados, tamanho, terminou_em, salva_em, suspeita, clubes, copas, bonus_ovr,
                resumo_hash, oculta)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE modo = VALUES(modo), jogador = VALUES(jogador), numero = VALUES(numero),
                pais = VALUES(pais), posicao = VALUES(posicao), nota = VALUES(nota), nota_v = VALUES(nota_v), pico_ovr = VALUES(pico_ovr),
                temporadas = VALUES(temporadas), gols = VALUES(gols), titulos = VALUES(titulos),
                bolas_ouro = VALUES(bolas_ouro), headline = VALUES(headline),
                como = IF(como = \'manual\', \'manual\', VALUES(como)),
                dados = VALUES(dados), tamanho = VALUES(tamanho), terminou_em = VALUES(terminou_em), salva_em = VALUES(salva_em),
                suspeita = VALUES(suspeita), clubes = VALUES(clubes), copas = VALUES(copas), bonus_ovr = VALUES(bonus_ovr),
                resumo_hash = VALUES(resumo_hash)',
            [$uid, $id, $f['modo'], $f['jogador'], $f['numero'], $f['pais'], $f['posicao'], $f['nota'], $f['nota_v'], $f['pico_ovr'],
                $f['temporadas'], $f['gols'], $f['titulos'], $f['bolas_ouro'], $f['headline'], $como, $gz, strlen($json),
                $f['terminou_em'], $agora, $suspeita, $f['clubes'], $f['copas'], $f['bonus_ovr'], $f['resumo_hash'], $oculta]);
        if (esquemaV33()) {
            // v3.3: o replay e as Libertadores mudam com a carreira; a hora em que ela entrou na conta e a marca do limite
            // diário ficam as da primeira vez. §E: com outro replay é outra carreira: a hora de entrada recomeça e a da semente é
            // a do replay novo; com o mesmo replay, a hora da semente fica (a linha de sementes_carreira some em 40 dias)
            $novoReplay = $mudouReplay ? 1 : 0;
            sql('UPDATE carreiras SET tem_replay = ?, libertadores = ?, primeira_em = IF(? = 1, ?, COALESCE(primeira_em, ?)),
                fora_desafio = COALESCE(fora_desafio, ?), semente_em = IF(? = 1, ?, COALESCE(?, semente_em))
                WHERE usuario_id = ? AND carreira_id = ?', [$f['tem_replay'], $f['libertadores'], $novoReplay, $agora, $agora, $foraDesafio,
                $novoReplay, $sementeEm, $sementeEm, $uid, $id]);
        }
        if (esquemaV34()) {
            // v3.4: os números dos critérios novos e, só na carreira-prova (Clássico, replay, semente sorteada pelo servidor para a
            // conta), a lista de conquistas do motor. Conteúdo novo: a verificação da prova de antes não vale mais
            sql('UPDATE carreiras SET champions = ?, n_clubes = ?, mesmo_clube = ?, copas_selecao = ?, pais_inicio = ?,
                conquistas = IF(tem_replay = 1 AND modo = \'classico\' AND semente_em IS NOT NULL, ?, NULL),
                conquistas_v = IF(tem_replay = 1 AND modo = \'classico\' AND semente_em IS NOT NULL, ?, NULL)
                WHERE usuario_id = ? AND carreira_id = ?', [$f['champions'], $f['n_clubes'], $f['mesmo_clube'], $f['copas_selecao'], $f['pais_inicio'],
                json($f['conquistas']), $f['conquistas_v'], $uid, $id]);
            if ($naoBateu !== null) {
                // §E: o "não bateu" da semente vale até um admin liberar ("bateu" no prova_verificar)
                sql('UPDATE carreiras SET prova_ok = 0, prova_verificacao = ? WHERE usuario_id = ? AND carreira_id = ?', [$naoBateu, $uid, $id]);
            } elseif ($antes !== null && !$mesma) {
                // conteúdo novo: a verificação de antes não vale mais — menos o "não bateu" da mesma semente, que fica
                sql('UPDATE carreiras SET prova_ok = NULL, prova_verificacao = NULL WHERE usuario_id = ? AND carreira_id = ?
                    AND (prova_ok IS NULL OR prova_ok <> 0 OR ? = 1)', [$uid, $id, $mudouSemente ? 1 : 0]);
            }
        }
        return [$antes !== null && $antes['suspeita'] === null && $suspeita !== null, $antes !== null && !$mesma, $mudouReplay];
    });
    $pkSalva = (int) umValor('SELECT id FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uid, $id]);
    if ($mudouSuspeita) {
        tirarDoHall($pkSalva);
    }
    if ($mudouDados) {
        // v3.3: a verificação de antes não vale para o conteúdo novo. §E: e cada candidato dela é conferido de novo com o que
        // ficou guardado (outro replay: a hora do candidato recomeça)
        candidatosCarreiraMudou($pkSalva, $mudouReplay);
        // v3.4 §E: e cada emblema que ela deu é conferido com o conteúdo de agora (não cumpre mais, virou "não bateu", ficou
        // suspeita: passa para outra carreira-prova da conta que cumpra ou sai pelo sistema)
        emblemasSemACarreira($pkSalva, 'A carreira foi salva de novo e não cumpre mais o desafio.', true);
    }
    // v3.4: as provas da conta (a carreira pode provar conquistas novas) e os desafios (candidatos e emblemas)
    $provas = recalcularProvas($uid);
    avaliarDesafiosConta($uid);
    $resp = ['carreira' => cDaConta($u, $id, $modoHall)];
    if (esquemaV34()) {
        $resp['provasNovas'] = $provas['novas'];
        $resp['emblemasNovos'] = array_map(static fn(array $e): array => array_intersect_key($e, array_flip(['slug', 'titulo', 'icone', 'cor', 'dificuldade'])),
            emblemasDadosAgora());
    }
    responder(200, $resp);
}

if ($acao === 'apagar') {
    // a decisão de moderação (oculta pelo admin ou pelas denúncias) fica em carreiras_moderacao: salvar de novo
    // a mesma carreira não a desfaz
    $id = lerId($corpo->id ?? null);
    $pk = umValor('SELECT id FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uid, $id]);
    if ($pk !== null) {
        tirarDoHall((int) $pk);
        $verificada = transacao(static function () use ($pk): bool {
            $ok = esquemaV34() ? umValor('SELECT prova_ok FROM carreiras WHERE id = ? FOR UPDATE', [(int) $pk]) : null;
            sql('DELETE FROM denuncias WHERE carreira_pk = ?', [(int) $pk]);
            sql('DELETE FROM carreiras WHERE id = ?', [(int) $pk]);
            return $ok !== null && (int) $ok === 1;
        });
        candidatosCarreiraApagada((int) $pk); // v3.3: o candidato dela sai da disputa
        // v3.4 §E: o emblema que ela deu fica só se ela já bateu na verificação por replay; o de uma carreira ainda não
        // verificada passa para outra carreira-prova da conta que cumpra ou sai pelo sistema (antes ficava para sempre e,
        // apagada a carreira, o admin não tinha mais o que verificar). Salva de novo (a semente ainda é do servidor), ela
        // volta a ser prova e o emblema volta com ela.
        if (!$verificada) {
            emblemasSemACarreira((int) $pk, 'A carreira foi apagada antes de ser verificada.');
        }
        // v3.4: as conquistas que só ela provava voltam a "não provadas" (nada some); outra carreira pode ter entrado no lugar dela
        // entre as 3 do perfil
        contaMudouProvas($uid);
    }
    responder(200, ['ok' => true]);
}

if ($acao === 'publicar') {
    // Escolher quais carreiras vão para o Hall público (até 3). Em "auto" ou "nao", passa para "manual"; vindo
    // de "auto", começa com as 3 que já estavam no Hall (nada some sem o jogador pedir).
    limitar('publicar', 'u' . $uid, 60);
    $id = lerId($corpo->id ?? null);
    $sim = $corpo->sim ?? null;
    if (!is_bool($sim)) {
        erro(400, 'dados', 'Diga se a carreira vai (sim) ou não para o Hall.');
    }
    $pk = umValor('SELECT id FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uid, $id]);
    if ($pk === null) {
        erro(404, 'nao_encontrada', 'Carreira não encontrada.');
    }
    $pk = (int) $pk;
    if ($sim && (int) ($u['hall_bloqueado'] ?? 0) === 1) {
        erro(403, 'hall_bloqueado', 'Sua conta não pode publicar no Hall público.');
    }
    $modoNovo = transacao(static function () use ($uid, $pk, $sim): string {
        $modo = (string) umValor('SELECT hall_publico FROM usuarios WHERE id = ? FOR UPDATE', [$uid]);
        if ($modo === 'auto') {
            $ids = idsAutoNoHall($uid);
            sql('UPDATE carreiras SET publica = 0 WHERE usuario_id = ?', [$uid]);
            if ($ids) {
                sql('UPDATE carreiras SET publica = 1 WHERE usuario_id = ? AND id IN (' . marcas(count($ids)) . ')', array_merge([$uid], $ids));
            }
        } elseif ($modo === 'nao') {
            if (!$sim) {
                return 'nao'; // já não aparece nada
            }
            sql('UPDATE carreiras SET publica = 0 WHERE usuario_id = ?', [$uid]);
        }
        if ($sim) {
            $outras = (int) umValor('SELECT COUNT(*) FROM carreiras WHERE usuario_id = ? AND publica = 1 AND id <> ?', [$uid, $pk]);
            if ($outras >= LENDA_HALL_POR_CONTA) {
                erro(409, 'limite_hall', 'Você já tem ' . LENDA_HALL_POR_CONTA . ' carreiras no Hall. Tire uma para pôr esta.');
            }
        }
        sql('UPDATE carreiras SET publica = ? WHERE id = ?', [$sim ? 1 : 0, $pk]);
        sql("UPDATE usuarios SET hall_publico = 'manual' WHERE id = ?", [$uid]);
        return 'manual';
    });
    if (!$sim) {
        tirarDoHall($pk); // sair do Hall é na hora; entrar, na próxima fotografia
    }
    avaliarDesafiosConta($uid); // v3.3: publicar pode ser o que faltava para um desafio
    responder(200, ['carreira' => cDaConta($u, $id, $modoNovo), 'hallPublico' => $modoNovo]);
}

erro(400, 'acao', 'Ação desconhecida.');

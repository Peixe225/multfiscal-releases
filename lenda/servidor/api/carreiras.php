<?php
/**
 * LENDA · carreiras salvas na conta (cada uma é um HallEntry inteiro do jogo, guardado com gzip).
 *   GET  carreiras.php            → {carreiras: [C…], limite: 200, hallPublico, hallMax: 3} (C.hall: CONTRATO-v32 §A, X2)
 *   GET  carreiras.php?id=<id>    → {carreira: HallEntry}
 *   POST {"acao":"salvar","carreira": HallEntry, "como":"auto"|"manual"} → {carreira: C}
 *   POST {"acao":"apagar","id": "<id>"}                                  → {ok: true}
 *   POST {"acao":"publicar","id": "<id>","sim": true|false}             → {carreira: C, hallPublico}
 * Contrato: servidor/CONTRATO.md e CONTRATO-v3.md §4. v3.3 (CONTRATO-v33 §A): C.temReplay; o HallEntry.replay é conferido
 * (fora do formato ou grande demais: a carreira é salva sem ele); libertadores, primeira_em e fora_desafio (limite diário)
 * gravados; salvar, publicar e apagar avaliam os desafios.
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

/** C de uma carreira da conta, com o noHall em vigor e onde ela está em relação ao Hall (C.hall). */
function cDaConta(array $u, string $id, string $modoHall): ?array
{
    $uid = (int) $u['id'];
    $l = umaLinha('SELECT ' . camposC() . ' FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uid, $id]);
    return $l === null ? null : carreiraC($l, idsNoHall($uid, $modoHall), ['hall_publico' => $modoHall] + $u);
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
    responder(200, [
        'carreiras' => array_map(static fn(array $l): array => carreiraC($l, $noHall, $u), $lista),
        'limite' => LIMITE_CARREIRAS,
        'hallPublico' => $modoHall,
        'hallMax' => LENDA_HALL_POR_CONTA,
    ]);
}

$acao = is_string($corpo->acao ?? null) ? $corpo->acao : '';

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
    [$mudouSuspeita, $mudouDados] = transacao(static function () use ($uid, $id, $como, $json, $f, $gz, $agora, $foraDesafio): array {
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
        $mesma = $antes !== null && $antes['clubes'] !== null && is_string($antes['dados']) && @gzdecode($antes['dados']) === $json;
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
            // diário ficam as da primeira vez
            sql('UPDATE carreiras SET tem_replay = ?, libertadores = ?, primeira_em = COALESCE(primeira_em, ?), fora_desafio = COALESCE(fora_desafio, ?)
                WHERE usuario_id = ? AND carreira_id = ?', [$f['tem_replay'], $f['libertadores'], $agora, $foraDesafio, $uid, $id]);
        }
        return [$antes !== null && $antes['suspeita'] === null && $suspeita !== null, $antes !== null && !$mesma];
    });
    $pkSalva = (int) umValor('SELECT id FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uid, $id]);
    if ($mudouSuspeita) {
        tirarDoHall($pkSalva);
    }
    if ($mudouDados) {
        candidatosCarreiraMudou($pkSalva); // v3.3: a verificação de antes não vale para o conteúdo novo
    }
    avaliarDesafiosConta($uid);
    responder(200, ['carreira' => cDaConta($u, $id, $modoHall)]);
}

if ($acao === 'apagar') {
    // a decisão de moderação (oculta pelo admin ou pelas denúncias) fica em carreiras_moderacao: salvar de novo
    // a mesma carreira não a desfaz
    $id = lerId($corpo->id ?? null);
    $pk = umValor('SELECT id FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uid, $id]);
    if ($pk !== null) {
        tirarDoHall((int) $pk);
        transacao(static function () use ($pk): void {
            sql('DELETE FROM denuncias WHERE carreira_pk = ?', [(int) $pk]);
            sql('DELETE FROM carreiras WHERE id = ?', [(int) $pk]);
        });
        candidatosCarreiraApagada((int) $pk); // v3.3: o candidato dela sai da disputa
        avaliarDesafiosConta($uid); // outra carreira pode ter entrado no lugar dela entre as 3 do perfil
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

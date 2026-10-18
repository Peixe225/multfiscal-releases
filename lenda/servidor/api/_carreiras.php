<?php
/**
 * LENDA · o que as rotas sabem das carreiras salvas: campos tirados do HallEntry, conferência de
 * plausibilidade, o objeto C da lista e quais carreiras de uma conta entram no Hall público. Usado por
 * carreiras.php, conta.php, admin.php, hall.php e instalar.php. Nunca é servido (o .htaccess nega _*.php).
 * Contrato: servidor/CONTRATO.md e servidor/CONTRATO-v3.md.
 */
declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

const CAMPOS_C = 'id, carreira_id, modo, jogador, numero, pais, posicao, nota, nota_v, pico_ovr, temporadas, gols, titulos,
    bolas_ouro, headline, como, salva_em, terminou_em, publica, oculta, suspeita, bonus_ovr, copas';
/** Replay do Clássico (HallEntry.replay, CONTRATO-v33 §A): até 64 KB em JSON e 600 decisões. */
const REPLAY_MAX_BYTES = 64 * 1024;
const REPLAY_MAX_PICKS = 600;

/** Os campos de C para o SELECT: com o banco da v3.3, também o tem_replay (C.temReplay). */
function camposC(): string
{
    return CAMPOS_C . (esquemaV33() ? ', tem_replay' : '');
}

/**
 * O replay de uma carreira do Clássico está no formato do contrato? {v:1, seed:[a0,a1], identity, pace, picks:[{id, kind,
 * idx, pen, n}], bonusOvr, dados}. Chaves a mais são aceitas (e guardadas), mas o tamanho conta tudo. idx -1 = a opção não
 * estava entre os cartões (o jogo grava assim); pen = null, "left" | "center" | "right" (texto curto) ou um número.
 */
function replayValido(mixed $r): bool
{
    if (!($r instanceof stdClass) || ($r->v ?? null) !== 1) {
        return false;
    }
    $seed = $r->seed ?? null;
    if (!is_array($seed) || count($seed) !== 2 || !array_is_list($seed)) {
        return false;
    }
    foreach ($seed as $x) {
        if (inteiroOuNulo($x, 0, 4294967295) === null) {
            return false;
        }
    }
    if (!(($r->identity ?? null) instanceof stdClass) || strlen(json($r->identity)) > 2048) {
        return false;
    }
    if (!is_string($r->pace ?? null) || !preg_match('/^[a-z_-]{1,16}$/', $r->pace)) {
        return false;
    }
    if (inteiroOuNulo($r->bonusOvr ?? null, 0, BONUS_OVR_MAX) === null) {
        return false;
    }
    if (!is_string($r->dados ?? null) || $r->dados === '' || strlen($r->dados) > 64 || preg_match('/[\x00-\x1f\x7f]/', $r->dados)) {
        return false;
    }
    $picks = $r->picks ?? null;
    if (!is_array($picks) || !array_is_list($picks) || count($picks) > REPLAY_MAX_PICKS) {
        return false;
    }
    foreach ($picks as $p) {
        if (!($p instanceof stdClass) || !is_string($p->id ?? null) || $p->id === '' || strlen($p->id) > 80
            || !is_string($p->kind ?? null) || !preg_match('/^[a-z0-9_-]{1,24}$/', $p->kind)
            || inteiroOuNulo($p->idx ?? null, -1, 999) === null || inteiroOuNulo($p->n ?? null, 0, 999) === null) {
            return false;
        }
        $pen = $p->pen ?? null;
        if ($pen !== null && !(is_string($pen) && strlen($pen) <= 16) && inteiroOuNulo($pen, 0, 99) === null) {
            return false;
        }
    }
    return strlen(json($r)) <= REPLAY_MAX_BYTES;
}

/**
 * Antes de guardar: replay fora do formato, grande demais ou numa carreira do Imersivo sai do HallEntry (a carreira é
 * salva sem ele e fica com temReplay false; nunca é recusada por causa do replay). Devolve se ficou com replay.
 */
function arrumarReplay(stdClass $h): bool
{
    if (!property_exists($h, 'replay')) {
        return false;
    }
    $modo = $h->mode ?? null;
    if ($modo === 'immersive' || $modo === 'imersivo' || !replayValido($h->replay)) {
        unset($h->replay);
        return false;
    }
    return true;
}
/** Ordem do Hall (dentro da conta e no geral): nota, pico, Bolas de Ouro, títulos, gols, e a mais antiga. */
const ORDEM_HALL = 'nota DESC, pico_ovr DESC, bolas_ouro DESC, titulos DESC, gols DESC, id ASC';
const BONUS_OVR_MAX = 20;

/**
 * Linha do banco → C (item da lista). $noHall = ids (carreiras.id) que entram no Hall público. Com $u (a conta dona,
 * v3.2), C ganha `hall` = onde a carreira está em relação ao Hall público (hallDaCarreira).
 */
function carreiraC(array $l, array $noHall = [], ?array $u = null): array
{
    $c = [
        'id' => (string) $l['carreira_id'],
        'modo' => (string) $l['modo'],
        'jogador' => (string) $l['jogador'],
        'numero' => (int) $l['numero'],
        'pais' => (string) $l['pais'],
        'posicao' => (string) $l['posicao'],
        'nota' => (int) $l['nota'],
        'notaV' => $l['nota_v'] === null ? null : (int) $l['nota_v'],
        'picoOvr' => (int) $l['pico_ovr'],
        'temporadas' => (int) $l['temporadas'],
        'gols' => (int) $l['gols'],
        'titulos' => (int) $l['titulos'],
        'bolasOuro' => (int) $l['bolas_ouro'],
        'headline' => (string) $l['headline'],
        'como' => (string) $l['como'],
        'salvaEm' => iso($l['salva_em']),
        'terminouEm' => iso($l['terminou_em']),
        'publica' => (int) ($l['publica'] ?? 0) === 1,
        'noHall' => in_array((int) $l['id'], $noHall, true),
        'bonusOvr' => (int) ($l['bonus_ovr'] ?? 0),
        // v3.3: a carreira leva os dados do replay (só as do Clássico gravadas nesta versão): pode valer para desafio
        'temReplay' => (int) ($l['tem_replay'] ?? 0) === 1,
    ];
    if ($u !== null) {
        $c['hall'] = hallDaCarreira($l, $noHall, $u);
    }
    return $c;
}

/**
 * Onde a carreira está em relação ao Hall público, para o próprio jogador (Minhas carreiras): {estado: no_hall |
 * entra_na_proxima (rev3: entra pelas regras de agora, mas ainda não está na fotografia) | revisao | suspeita | oculta |
 * fora | privada, porque?, motivo?}. Os motivos são textos curtos que dá para mostrar: não
 * dizem o que a conferência olha nem o que a moderação escreveu (não ensinam a burlar). `porque` (só no "fora") diz se a
 * estrela do jogador muda alguma coisa: bloqueada | imersivo | versao | duplicada (não muda) · escolha | limite (muda).
 */
function hallDaCarreira(array $l, array $noHall, array $u): array
{
    $modoHall = (string) ($u['hall_publico'] ?? 'auto');
    if ($modoHall === 'nao') {
        return ['estado' => 'privada', 'motivo' => 'Você escolheu não aparecer no Hall público.'];
    }
    if ((int) ($u['hall_bloqueado'] ?? 0) === 1) {
        return ['estado' => 'fora', 'porque' => 'bloqueada', 'motivo' => 'Sua conta não pode publicar no Hall público.'];
    }
    $oculta = (int) ($l['oculta'] ?? 0);
    if ($oculta === 1) {
        return ['estado' => 'oculta', 'motivo' => 'A moderação tirou esta carreira do Hall público.'];
    }
    if ($oculta === 2) {
        return ['estado' => 'oculta', 'motivo' => 'Esta carreira está em análise depois de denúncias.'];
    }
    $susp = $l['suspeita'] ?? null;
    if ($susp === 'revisao') {
        // rev3: só promete a entrada quando, conferida, ela estaria entre as que a conta mostra (as 3 melhores no
        // automático; as escolhidas no "Eu escolho"); senão, a revisão não muda nada e a promessa seria falsa
        $uid = (int) ($l['usuario_id'] ?? ($u['id'] ?? 0));
        $entraria = $uid > 0 && in_array((int) $l['id'], idsNoHallConferidas($uid, $modoHall), true);
        return ['estado' => 'revisao', 'motivo' => $entraria ? 'Em revisão: entra no Hall assim que for conferida.'
            : 'Em revisão: a moderação confere as notas altas antes do Hall.'];
    }
    if (is_string($susp) && $susp !== '') {
        $m = explode(',', $susp);
        $motivo = in_array('copia', $m, true) ? 'Esta carreira já foi salva por outra conta.'
            : (in_array('nome', $m, true) ? 'Um nome ou texto desta carreira não é permitido no Hall.'
            : (in_array('dados', $m, true) ? 'Os dados desta carreira não abriram direito.'
            : 'Os números desta carreira esperam a conferência da moderação.'));
        return ['estado' => 'suspeita', 'motivo' => $motivo];
    }
    if (($l['modo'] ?? 'classico') !== 'classico' && !siteConfig()['imersivo_publico']) {
        return ['estado' => 'fora', 'porque' => 'imersivo', 'motivo' => 'As carreiras do Imersivo ainda não entram no Hall público.'];
    }
    if (($l['nota_v'] ?? null) === null || (int) $l['nota_v'] !== LENDA_NOTA_VERSAO) {
        return ['estado' => 'fora', 'porque' => 'versao', 'motivo' => 'A nota desta carreira é de uma versão antiga do jogo.'];
    }
    if (in_array((int) $l['id'], $noHall, true)) {
        // rev3: "no Hall" só quando já está na fotografia (o que o hall.php mostra); pelas regras de agora ela entra,
        // mas a fotografia é refeita de hora em hora: até lá, entra_na_proxima com a hora da próxima atualização
        if (carreiraNaFoto((int) $l['id'])) {
            return ['estado' => 'no_hall'];
        }
        return ['estado' => 'entra_na_proxima', 'motivo' => 'Entra no Hall público na próxima atualização' . horaProximaFoto() . '.'];
    }
    $cheio = count($noHall) >= LENDA_HALL_POR_CONTA;
    if ($modoHall === 'manual' && (int) ($l['publica'] ?? 0) !== 1) {
        return ['estado' => 'fora', 'porque' => 'escolha', 'motivo' => 'Você escolheu outras carreiras para o Hall.'];
    }
    return ['estado' => 'fora', 'porque' => $cheio ? 'limite' : 'duplicada', 'motivo' => $cheio ? 'Só as ' . LENDA_HALL_POR_CONTA . ' melhores carreiras de cada conta entram no Hall.'
        : 'Outra conta já mostra esta mesma carreira no Hall.'];
}

/** rev3 (X2): a carreira (carreiras.id) está na fotografia do Hall público agora (o que o hall.php mostra)? */
function carreiraNaFoto(int $pk): bool
{
    return umValor('SELECT 1 FROM hall_foto WHERE carreira_pk = ? LIMIT 1', [$pk]) !== null;
}

/** " (por volta das HH:MM)" da próxima fotografia do Hall, na hora de Brasília; '' se ela já passou da hora ou não há. */
function horaProximaFoto(): string
{
    if (!function_exists('hallEstado')) {
        return '';
    }
    $e = hallEstado();
    $em = is_array($e) ? paraTempo(str_replace(['T', 'Z'], [' ', ''], (string) ($e['em'] ?? ''))) : null;
    if ($em === null) {
        return '';
    }
    $prox = $em + hallIntervaloS();
    return $prox > time() ? ' (por volta das ' . gmdate('H:i', $prox - LENDA_FUSO_H * 3600) . ')' : '';
}

/**
 * rev3 (X2): as carreiras que a conta mostraria no Hall se as que esperam a revisão da nota alta já estivessem
 * conferidas (idsNoHall com `revisao` contando como liberada). Uma vez por conta e modo em cada pedido.
 */
function idsNoHallConferidas(int $uid, string $modoHall): array
{
    static $cache = [];
    $k = $uid . ':' . $modoHall;
    if (isset($cache[$k])) {
        return $cache[$k];
    }
    if ($modoHall === 'nao' || (esquemaV32() && (int) umValor('SELECT hall_bloqueado FROM usuarios WHERE id = ?', [$uid]) === 1)) {
        return $cache[$k] = [];
    }
    $manual = $modoHall === 'manual' ? ' AND c.publica = 1' : '';
    $visivel = str_replace('c.suspeita IS NULL', "(c.suspeita IS NULL OR c.suspeita = 'revisao')", sqlCarreiraVisivel());
    return $cache[$k] = array_map('intval', sql('SELECT c.id FROM carreiras c WHERE c.usuario_id = ? AND ' . $visivel . $manual
        . ' AND ' . sqlNaoECopia() . ' ORDER BY c.' . str_replace(', ', ', c.', ORDEM_HALL) . ' LIMIT ' . LENDA_HALL_POR_CONTA, [$uid])->fetchAll(PDO::FETCH_COLUMN));
}

function inteiro(mixed $v, int $min, int $max): int
{
    if (is_float($v) && is_finite($v)) {
        $v = (int) round(max(-1e12, min(1e12, $v)));
    }
    if (!is_int($v)) {
        return $min > 0 ? $min : 0;
    }
    return max($min, min($max, $v));
}

function campo(?stdClass $o, string $k): mixed
{
    return $o !== null && property_exists($o, $k) ? $o->{$k} : null;
}

/** Os campos da lista e do Hall, tirados do próprio HallEntry. */
function extrairCampos(stdClass $h): array
{
    $id = campo($h, 'identity') instanceof stdClass ? $h->identity : null;
    $s = campo($h, 'summary') instanceof stdClass ? $h->summary : null;
    $legacy = campo($h, 'legacy') instanceof stdClass ? $h->legacy : null;
    $totals = campo($s, 'totals') instanceof stdClass ? $s->totals : null;
    $career = campo($h, 'career') instanceof stdClass ? $h->career : null;

    $titulos = 0;
    $copas = 0;
    $libertadores = 0;
    foreach ((array) (is_array(campo($s, 'trophies')) ? $s->trophies : []) as $t) {
        if ($t instanceof stdClass) {
            $n = inteiro(campo($t, 'count'), 0, 10000);
            $titulos += $n;
            if (campo($t, 'trophyId') === 'world-cup') {
                $copas += $n;
            } elseif (campo($t, 'trophyId') === 'libertadores') {
                $libertadores += $n;
            }
        }
    }
    $bolas = 0;
    foreach ((array) (is_array(campo($s, 'awards')) ? $s->awards : []) as $a) {
        if ($a instanceof stdClass && campo($a, 'award') === 'ballon_dor') {
            $bolas += inteiro(campo($a, 'count'), 0, 1000);
        }
    }
    // clubes por onde passou (clubId do jogo, sem repetir, na ordem da carreira)
    $clubes = [];
    foreach ((array) (is_array(campo($s, 'clubs')) ? $s->clubs : []) as $c) {
        $cid = $c instanceof stdClass ? campo($c, 'clubId') : null;
        if (is_string($cid) && preg_match('/^[A-Za-z0-9_-]{1,16}$/', $cid) && !in_array($cid, $clubes, true) && count($clubes) < 40) {
            $clubes[] = $cid;
        }
    }
    $nota = campo($legacy, 'score');
    if (!is_int($nota) && !is_float($nota)) {
        $nota = campo($s, 'legacyScore');
    }
    $modo = campo($h, 'mode');
    $modo = $modo === 'immersive' || $modo === 'imersivo' ? 'imersivo' : 'classico';

    $terminou = null;
    $fin = campo($h, 'finishedAt');
    if (is_string($fin) && strlen($fin) <= 40) {
        $t = strtotime($fin);
        if ($t !== false && $t > 0 && $t < 32503680000) {
            $terminou = dt($t);
        }
    }
    $idade = campo($career, 'age');
    $bonus = campo($career, 'bonusOvr');
    $cid = campo($career, 'identity') instanceof stdClass ? $career->identity : null;
    $nome = is_string(campo($id, 'surname')) ? $id->surname : '';
    $nomeCareer = is_string(campo($cid, 'surname')) ? $cid->surname : '';
    return [
        'modo' => $modo,
        'jogador' => texto(campo($id, 'surname'), 40) ?? '',
        'numero' => inteiro(campo($id, 'number'), 0, 999),
        'pais' => texto(campo($id, 'nationality'), 8) ?? '',
        'posicao' => texto(campo($id, 'position'), 8) ?? '',
        'nota' => inteiro($nota, -999, 999),
        // versão dos pesos da Nota de Legado (LEGACY_VERSION do jogo); sem `v` = gravada antes da v2
        'nota_v' => is_int(campo($legacy, 'v')) ? inteiro($legacy->v, 0, 999) : null,
        'pico_ovr' => inteiro(campo($s, 'peakOvr'), 0, 999),
        'temporadas' => inteiro(campo($s, 'seasons'), 0, 999),
        'gols' => inteiro(campo($totals, 'goals'), 0, 1000000),
        'titulos' => $titulos,
        'bolas_ouro' => $bolas,
        'headline' => texto(campo($s, 'headline'), 120) ?? '',
        'terminou_em' => $terminou,
        'clubes' => json($clubes),
        'copas' => min($copas, 65535),
        // v3.3: as Libertadores (desafio As Taças do Rei) e se o HallEntry leva o replay (o arrumarReplay já conferiu)
        'libertadores' => min($libertadores, 65535),
        'tem_replay' => property_exists($h, 'replay') && ($modo === 'classico') && replayValido($h->replay) ? 1 : 0,
        'bonus_ovr' => is_int($bonus) || is_float($bonus) ? inteiro($bonus, 0, BONUS_OVR_MAX) : 0,
        'idade' => is_int($idade) || is_float($idade) ? inteiro($idade, 0, 999) : null,
        // o que o jogo mostra como texto no resumo da carreira de outra pessoa (para o filtro de palavrões)
        'textos' => textosDoHallEntry($h),
        'nomes' => [$nome, $nomeCareer],
        // o resumo lê o nome e o país de career.identity: têm de ser os mesmos do identity (o jogo grava o mesmo objeto)
        'dados_ok' => $cid !== null && $nomeCareer === $nome
            && (string) (campo($cid, 'nationality') ?? '') === (string) (campo($id, 'nationality') ?? ''),
        // a mesma carreira com outro id (cópia, ou salva de novo para fugir da moderação) tem o mesmo resumo
        'resumo_hash' => $s !== null ? sha1(json($s)) : null,
    ];
}

/**
 * Os textos de um HallEntry que o resumo mostra para outra pessoa: nomes, título (headline), comparações, motivo
 * da aposentadoria, fase alcançada nos torneios da seleção, os 3 primeiros da Bola de Ouro de cada ano e os ids que
 * aparecem como texto quando o jogo não os conhece (troféu, clube, competição). No máximo 800 textos de 200 letras.
 */
function textosDoHallEntry(stdClass $h): array
{
    $out = [];
    $por = static function (mixed $v) use (&$out): void {
        if (is_string($v) && $v !== '' && count($out) < 800) {
            $out[] = mb_substr($v, 0, 200, 'UTF-8');
        }
    };
    $porId = static function (mixed $v) use ($por): void {
        if (is_string($v)) {
            $por(str_replace(['_', '-', '.', ':'], ' ', $v));
        }
    };
    $lista = static fn(mixed $v): array => is_array($v) ? $v : [];
    $id = campo($h, 'identity') instanceof stdClass ? $h->identity : null;
    $s = campo($h, 'summary') instanceof stdClass ? $h->summary : null;
    $career = campo($h, 'career') instanceof stdClass ? $h->career : null;
    $cid = campo($career, 'identity') instanceof stdClass ? $career->identity : null;
    $por(campo($id, 'surname'));
    $por(campo($cid, 'surname'));
    $por(campo($s, 'headline'));
    $por(campo($h, 'retiredReason'));
    $por(campo($career, 'retiredReason'));
    foreach ($lista(campo($s, 'comparisons')) as $c) {
        $por($c);
    }
    foreach ($lista(campo($s, 'trophies')) as $t) {
        $porId($t instanceof stdClass ? campo($t, 'trophyId') : null);
    }
    foreach ($lista(campo($s, 'clubs')) as $c) {
        $porId($c instanceof stdClass ? campo($c, 'clubId') : null);
    }
    $nat = campo($s, 'national') instanceof stdClass ? $s->national : null;
    foreach ($lista(campo($nat, 'tournaments')) as $t) {
        if ($t instanceof stdClass) {
            $por(campo($t, 'reached'));
            $porId(campo($t, 'competitionId'));
        }
    }
    foreach ($lista(campo($nat, 'trophies')) as $t) {
        if ($t instanceof stdClass) {
            $porId(campo($t, 'trophyId'));
            $porId(campo($t, 'competitionId'));
        }
    }
    $mundo = campo($career, 'world') instanceof stdClass ? $career->world : null;
    $temporadas = campo($mundo, 'seasons');
    foreach ($temporadas instanceof stdClass || is_array($temporadas) ? (array) $temporadas : [] as $ts) {
        foreach ($ts instanceof stdClass ? $lista(campo($ts, 'awards')) : [] as $a) {
            if (!($a instanceof stdClass) || campo($a, 'award') !== 'ballon_dor') {
                continue;
            }
            foreach (array_slice($lista(campo($a, 'ranking')), 0, 3) as $e) {
                if ($e instanceof stdClass && campo($e, 'isUser') !== true) {
                    $por(campo($e, 'name'));
                }
            }
        }
    }
    return $out;
}

/**
 * Nota a partir da qual a carreira espera a revisão do admin para entrar no Hall: hall_revisao_nota do painel
 * (site_config, v3.2) ou, sem ela, a do arquivo de config (padrão 90). 101 = desligado.
 */
function notaRevisao(): int
{
    $n = siteConfig()['hall_revisao_nota'] ?? revisaoNotaArquivo();
    return is_int($n) && $n >= 1 ? $n : 90;
}

/** Condição SQL (apelido $a de usuarios) de conta que pode aparecer no Hall: não bloqueada pelo admin (v3.2). */
function sqlContaNoHall(string $a = 'u'): string
{
    return esquemaV32() ? "$a.hall_bloqueado = 0" : '1 = 1';
}

/**
 * Plausibilidade (CONTRATO-v3 §4 e §12): null = ok; senão os motivos ("gols,bolas"). Carreira suspeita fica fora do
 * Hall público até o admin liberar. A versão da nota (legacy.v) não entra aqui: nota de outra versão só fica fora do
 * Hall (coluna nota_v), sem virar suspeita. $pk = a própria linha (instalar.php, carreira já gravada): para a cópia,
 * só conta a de outra conta gravada antes dela; null = carreira nova (qualquer outra conta com ela conta).
 * Motivos: temporadas, pico, nota, gols, bolas, titulos, copas, idade, bonus, nome, dados, copia e, sozinho (só quando
 * não há outro), revisao = nota extraordinária, entra depois que o admin olhar.
 */
function plausibilidade(array $f, int $uid, string $carreiraId, ?int $pk = null): ?string
{
    $m = [];
    $t = $f['temporadas'];
    if ($t < 1 || $t > 30) {
        $m[] = 'temporadas';
    }
    if ($f['pico_ovr'] < 40 || $f['pico_ovr'] > 99) {
        $m[] = 'pico';
    }
    // nota alta pede pico alto (nas carreiras reais, toda nota 77+ tem pico 91+)
    if ($f['nota'] < 0 || $f['nota'] > 100 || ($f['nota'] >= 80 && $f['pico_ovr'] < 85)) {
        $m[] = 'nota';
    }
    if ($f['gols'] > 90 * max(1, $t)) {
        $m[] = 'gols';
    }
    // Bola de Ouro: nunca na 1ª temporada (todo mundo começa com OVR 50)
    if ($f['bolas_ouro'] > max(0, $t - 1)) {
        $m[] = 'bolas';
    }
    if ($f['titulos'] > 15 * max(1, $t)) {
        $m[] = 'titulos';
    }
    // uma Copa do Mundo a cada 4 anos (e uma de folga)
    if ($f['copas'] > intdiv(max(0, $t) + 3, 4) + 1) {
        $m[] = 'copas';
    }
    if ($f['idade'] !== null && $f['idade'] > 45) {
        $m[] = 'idade';
    }
    if ($f['bonus_ovr'] > 0) {
        // bônus de OVR só vale se foi usado nesta carreira (bonus.php usar), com o mesmo valor
        $usado = umValor('SELECT valor FROM bonus WHERE usuario_id = ? AND carreira_id = ? AND usado_em IS NOT NULL LIMIT 1', [$uid, $carreiraId]);
        if ($usado === null || (int) $usado !== $f['bonus_ovr']) {
            $m[] = 'bonus';
        }
    }
    $nomeRuim = false;
    foreach ($f['nomes'] ?? [] as $n) {
        $nomeRuim = $nomeRuim || !nomeJogadorSeguro((string) $n);
    }
    foreach ($f['textos'] ?? [] as $x) {
        if ($nomeRuim) {
            break;
        }
        $nomeRuim = textoProibido((string) $x, false) !== null;
    }
    if ($nomeRuim) {
        $m[] = 'nome';
    }
    if (($f['dados_ok'] ?? true) !== true) {
        $m[] = 'dados';
    }
    // a mesma carreira (mesmo id ou mesmo resumo) já salva por outra conta: fica a primeira dona
    $antes = $pk !== null ? ' AND id < ?' : '';
    $p = $pk !== null ? [$pk] : [];
    $copia = umValor('SELECT 1 FROM carreiras WHERE carreira_id = ? AND usuario_id <> ?' . $antes . ' LIMIT 1', array_merge([$carreiraId, $uid], $p)) !== null
        || (is_string($f['resumo_hash'] ?? null)
            && umValor('SELECT 1 FROM carreiras WHERE resumo_hash = ? AND usuario_id <> ?' . $antes . ' LIMIT 1', array_merge([$f['resumo_hash'], $uid], $p)) !== null)
        || copiaDeApagada($f, $uid, $carreiraId, $pk);
    if ($copia) {
        $m[] = 'copia';
    }
    if (!$m && $f['nota'] >= notaRevisao()) {
        $m[] = 'revisao';
    }
    return $m ? substr(implode(',', $m), 0, 64) : null;
}

/**
 * rev3: a mesma carreira (mesmo id ou mesmo resumo) foi APAGADA pela moderação na conta de outra pessoa (lixeira)? A
 * linha some de carreiras, então sem isto a segunda conta do mesmo aparelho salvava o mesmo HallEntry e ele voltava ao
 * Hall: apagar protegia menos que ocultar. Com $pk (instalar.php), só conta a apagada que era mais antiga que ela.
 */
function copiaDeApagada(array $f, int $uid, string $carreiraId, ?int $pk): bool
{
    if (!esquemaV32()) {
        return false;
    }
    $antes = $pk !== null ? ' AND carreira_pk < ?' : '';
    $p = $pk !== null ? [$pk] : [];
    try {
        return umValor('SELECT 1 FROM lixeira_carreiras WHERE carreira_id = ? AND usuario_id <> ?' . $antes . ' LIMIT 1', array_merge([$carreiraId, $uid], $p)) !== null
            || (is_string($f['resumo_hash'] ?? null) && $f['resumo_hash'] !== ''
                && umValor('SELECT 1 FROM lixeira_carreiras WHERE resumo_hash = ? AND usuario_id <> ?' . $antes . ' LIMIT 1', array_merge([$f['resumo_hash'], $uid], $p)) !== null);
    } catch (PDOException $e) {
        if (!eFaltaDeSchema($e)) {
            throw $e;
        }
        return false; // lixeira sem a coluna resumo_hash (instalar.php pendente)
    }
}

/** Condição SQL (apelido `c`, ou $a) de carreira que pode aparecer no Hall público. */
function sqlCarreiraVisivel(string $a = 'c'): string
{
    $modo = siteConfig()['imersivo_publico'] ? '' : " AND $a.modo = 'classico'";
    return "$a.oculta = 0 AND $a.suspeita IS NULL AND $a.nota_v = " . LENDA_NOTA_VERSAO . $modo;
}

/**
 * Condição SQL (apelidos `c` e `u`): esta carreira não é a cópia de uma que outra conta salvou antes e que pode
 * aparecer no Hall. Cada HallEntry.id aparece uma vez só no Hall, o da primeira dona.
 */
function sqlNaoECopia(): string
{
    return 'NOT EXISTS (SELECT 1 FROM carreiras c2 JOIN usuarios u2 ON u2.id = c2.usuario_id
        WHERE c2.carreira_id = c.carreira_id AND c2.id < c.id AND c2.usuario_id <> c.usuario_id AND ' . sqlCarreiraVisivel('c2') . '
          AND ' . str_replace('u.', 'u2.', LENDA_SQL_ATIVO) . " AND u2.hall_publico <> 'nao' AND " . sqlContaNoHall('u2') . ')';
}

/**
 * Quais carreiras (carreiras.id) da conta entram no Hall público agora: auto = as 3 de maior nota; manual = as
 * marcadas (até 3); nao = nenhuma. Só entre as visíveis (não ocultas, não suspeitas, nota da versão atual).
 */
function idsNoHall(int $uid, string $modoHall): array
{
    if ($modoHall === 'nao') {
        return [];
    }
    $manual = $modoHall === 'manual' ? ' AND c.publica = 1' : '';
    if (esquemaV32() && (int) umValor('SELECT hall_bloqueado FROM usuarios WHERE id = ?', [$uid]) === 1) {
        return []; // conta tirada do Hall pelo admin (bloquear_hall)
    }
    return array_map('intval', sql('SELECT c.id FROM carreiras c WHERE c.usuario_id = ? AND ' . sqlCarreiraVisivel() . $manual
        . ' AND ' . sqlNaoECopia() . ' ORDER BY c.' . str_replace(', ', ', c.', ORDEM_HALL) . ' LIMIT ' . LENDA_HALL_POR_CONTA, [$uid])->fetchAll(PDO::FETCH_COLUMN));
}

/** As 3 que o modo auto mostraria (para passar de auto a manual sem tirar nada do Hall). */
function idsAutoNoHall(int $uid): array
{
    return idsNoHall($uid, 'auto');
}

// ── moderação que sobrevive ao "apagar" do dono (carreiras_moderacao) ───────────────────────────

/**
 * Guarda a decisão de esconder a carreira (oculta 1 = admin, 2 = denúncias) fora da linha dela: se o dono apagar e
 * salvar de novo o mesmo HallEntry (ou o mesmo resumo com outro id), ela volta escondida.
 */
function gravarModeracao(int $pk, int $oculta): void
{
    $c = umaLinha('SELECT usuario_id, carreira_id, resumo_hash FROM carreiras WHERE id = ?', [$pk]);
    if ($c === null) {
        return;
    }
    sql('INSERT INTO carreiras_moderacao (usuario_id, carreira_id, resumo_hash, oculta, em) VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE resumo_hash = VALUES(resumo_hash), oculta = VALUES(oculta), em = VALUES(em)',
        [(int) $c['usuario_id'], (string) $c['carreira_id'], $c['resumo_hash'], $oculta, dt(time())]);
}

/** O admin devolveu a carreira ao Hall: a decisão guardada sai. */
function apagarModeracao(int $pk): void
{
    $c = umaLinha('SELECT usuario_id, carreira_id, resumo_hash FROM carreiras WHERE id = ?', [$pk]);
    if ($c === null) {
        return;
    }
    sql('DELETE FROM carreiras_moderacao WHERE usuario_id = ? AND (carreira_id = ? OR (resumo_hash IS NOT NULL AND resumo_hash = ?))',
        [(int) $c['usuario_id'], (string) $c['carreira_id'], (string) ($c['resumo_hash'] ?? '')]);
}

/** A carreira que entra agora na conta já tinha sido escondida antes (mesmo id ou mesmo resumo)? 0, 1 ou 2. */
function moderacaoHerdada(int $uid, string $carreiraId, ?string $resumoHash): int
{
    return (int) umValor('SELECT COALESCE(MAX(oculta), 0) FROM carreiras_moderacao WHERE usuario_id = ? AND (carreira_id = ? OR resumo_hash = ?)',
        [$uid, $carreiraId, $resumoHash ?? '']);
}

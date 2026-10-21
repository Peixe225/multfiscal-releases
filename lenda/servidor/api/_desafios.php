<?php
/**
 * LENDA · desafios com prêmio (As Taças do Rei e "todas as conquistas") e o limite de partidas por dia (CONTRATO-v33 §A).
 * O prêmio é um texto livre do admin (desafios.premio). Os desafios nascem desativados (instalar.php, semearDesafios).
 *
 * Avaliação: o servidor confere sozinho, ao salvar ou publicar uma carreira, ao sincronizar conquistas, ao confirmar o
 * e-mail, ao mudar o modo do Hall, a cada partida contada na conta e quando o admin libera uma carreira ou ativa um
 * desafio (avaliarDesafiosConta). Só desafio ativo, sem vencedor e dentro do prazo. A conta que cumpre o critério e todos
 * os requisitos vira candidata pendente; "o primeiro" = menor `em` (hora do servidor com milésimos; empate: menor id).
 * Carreira de desafio: Clássico, com replay (tem_replay), começada com uma semente que o servidor sorteou para a conta
 * depois do início do desafio (semente_em, §E), entrou na conta depois do início (primeira_em), não foi salva num dia em
 * que a conta passou do limite de partidas (fora_desafio) e sem suspeita (salvo a revisão da nota alta). O admin confere a
 * carreira no jogo (#/verificar, que roda o motor de novo) e só um candidato verificado, sem outro anterior esperando
 * decisão, pode ser declarado vencedor (numa transação: um vencedor por desafio). §E: o candidato é conferido de novo, com a
 * carreira guardada de agora e o critério de agora, ao salvar a carreira, a cada avaliação da conta, ao mudar as regras do
 * desafio, ao verificar e ao declarar (motivoCandidato); o de todas as conquistas não tem prova e não pode ser ativado.
 * v3.4 (CONTRATO-v34 §A): desafios de modo `emblema` (todo mundo que cumprir ganha o emblema, sozinho, na avaliação de
 * sempre; o admin pode retirar), critérios novos (champions, bolasOuro, titulos, gols, nota, clubes, temporadasMesmoClube,
 * nacionalidade, copasPelaSelecao) e o de todas as conquistas pelas conquistas PROVADAS (_provas.php): pode ser ativado,
 * e só verifica e declara com as 87 provadas por carreiras verificadas no replay.
 * Usado por carreiras.php, conquistas.php, conta.php, e.php, desafios.php, perfil.php, hall.php, admin.php e instalar.php.
 * Nunca é servido (o .htaccess nega _*.php).
 */
declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/_hall.php';
require_once __DIR__ . '/_provas.php';

const DESAFIO_ESTADOS = ['pendente', 'verificada', 'recusada', 'vencedora'];
const DESAFIO_SLUG_RE = '/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/';
const DESAFIO_LOTE_S = 10;          // a avaliação de todas as contas (ativar/salvar) roda por no máximo 10 s
const DESAFIO_VERIFICACAO_MAX = 8000;
// CONQUISTAS_IDS e CONQUISTAS_TOTAL (as 87 do jogo) ficam no _carreiras.php desde a v3.4 (a lista de conquistas da carreira-prova).
/**
 * Por que uma carreira que cumpre o critério não vale (eu=1) e, §E, por que um candidato não vale agora (eu=1, painel,
 * declarar, a recusa automática).
 */
const DESAFIO_MOTIVOS = [
    'imersivo' => 'Só carreiras do Modo Clássico valem.',
    'sem_replay' => 'Esta carreira não tem os dados de replay (foi jogada antes desta versão do jogo).',
    'limite_diario' => 'Foi salva num dia em que a conta passou do limite de partidas por dia.',
    'sem_semente' => 'Esta carreira não começou com a conta aberta (a semente não foi sorteada pelo servidor para você) ou passou do limite de partidas do dia.',
    'suspeita' => 'Os números desta carreira esperam a conferência da moderação.',
    'antes_do_inicio' => 'Foi começada ou salva antes do começo do desafio.',
    'depois_do_fim' => 'Foi salva depois do fim do desafio.',
    'nao_publicada' => 'Publique esta carreira no Hall das Lendas.',
    'fora_do_top3' => 'Ela precisa estar entre as 3 carreiras do seu perfil público.',
    'criterio' => 'A carreira guardada não cumpre o critério do desafio.',
    'carreira_apagada' => 'A carreira não está mais na conta.',
    'conta_suspensa' => 'A conta está suspensa.',
    'conta_excluida' => 'A conta foi excluída.',
    'partidas' => 'A conta não tem as partidas mínimas.',
    'email' => 'O e-mail da conta não está confirmado.',
    'conquistas' => 'A conta não tem todas as conquistas provadas.',
    // v3.4: a carreira-prova que não bateu na verificação por replay
    'nao_bateu' => 'Esta carreira não bateu na verificação por replay.',
];
/** v3.4: os modos (primeiro = um vencedor e o prêmio do admin; emblema = todo mundo que cumprir ganha o emblema). */
const DESAFIO_MODOS = ['primeiro', 'emblema'];
const DESAFIO_DIFICULDADES = ['facil', 'medio', 'dificil', 'lendario'];
/** Os limites de cada chave numérica do critério (de 1 até isto). */
const DESAFIO_CRITERIO_MAX = ['copas' => 30, 'libertadores' => 30, 'champions' => 30, 'bolasOuro' => 30, 'copasPelaSelecao' => 30,
    'titulos' => 500, 'gols' => 5000, 'nota' => 100, 'clubes' => 40, 'temporadasMesmoClube' => 30];
/** Emblema de um desafio de modo emblema sem ícone escolhido. */
const DESAFIO_EMBLEMA_PADRAO = ['icone' => 'star', 'cor' => '#f2c75a'];
const DESAFIO_EMBLEMA_ESTADOS = ['ativo', 'retirado'];
/**
 * v3.4 §E: os ícones que um emblema pode ter — os 38 do mapa das conquistas do jogo (src/ui/shared/achievements/meta.ts, sem o
 * apelido goat), os mesmos que o editor do painel oferece. Antes valia qualquer [a-z0-9-]: "constructor" passava e, no jogo
 * (ICONS[nome]) e no painel (ICONES[nome]), achava a função Object do protótipo e a tela caía.
 */
const DESAFIO_ICONES = ['arrow-up', 'award', 'baby', 'backpack', 'badge', 'brick-wall', 'calendar', 'circle-dot', 'circle-off', 'compass', 'crown',
    'flag', 'flame', 'footprints', 'gem', 'globe', 'globe-2', 'goal', 'hand', 'hand-helping', 'heart', 'infinity', 'layers', 'map', 'medal', 'mountain',
    'plane', 'shield', 'shield-check', 'shirt', 'sparkles', 'star', 'sunrise', 'swords', 'target', 'trending-up', 'trophy', 'zap'];
/** §E: por que o desafio de todas as conquistas não pode ser ativado, verificado nem ter vencedor (banco de antes da v3.4). */
const DESAFIO_SEM_PROVA = 'O desafio de todas as conquistas não tem como ser conferido: as conquistas vêm do aparelho do jogador, sem prova (não há replay das conquistas). Ele não pode ser ativado, verificado nem ter vencedor.';
/** v3.4: o candidato ao de todas as conquistas só verifica e vence com as 87 provadas por carreiras verificadas no replay. */
const DESAFIO_SEM_PROVA_V34 = 'Faltam conquistas provadas por carreiras verificadas no replay: verifique as carreiras-prova da conta (#/verificar em lote) antes.';

// ── datas e textos ───────────────────────────────────────────────────────────────────────────────

/** Agora com milésimos, para o `em` do candidato (DATETIME(3), UTC). */
function agoraMs(): string
{
    $t = microtime(true);
    $s = (int) floor($t);
    return gmdate('Y-m-d H:i:s', $s) . '.' . str_pad((string) min(999, (int) floor(($t - $s) * 1000)), 3, '0', STR_PAD_LEFT);
}

/** "2026-10-18 12:00:00.123" → "2026-10-18T12:00:00.123Z" (sem milésimos no banco: .000). */
function isoMs(?string $dt): ?string
{
    if ($dt === null || $dt === '') {
        return null;
    }
    $t = paraTempo(substr($dt, 0, 19));
    if ($t === null) {
        return null;
    }
    $ms = preg_match('/\.(\d{1,6})$/', $dt, $m) ? substr(str_pad($m[1], 3, '0'), 0, 3) : '000';
    return gmdate('Y-m-d\TH:i:s', $t) . '.' . $ms . 'Z';
}

/**
 * Data do admin: "2026-10-14" (00:00 ou, com $fimDoDia, 23:59:59 em Brasília) ou ISO com hora → DATETIME UTC; null/"" →
 * null; inválida → false.
 */
function lerDataHoraDesafio(mixed $v, bool $fimDoDia): string|false|null
{
    if ($v === null || $v === '') {
        return null;
    }
    if (!is_string($v) || strlen($v) > 40) {
        return false;
    }
    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $p)) {
        if (!checkdate((int) $p[2], (int) $p[3], (int) $p[1])) {
            return false;
        }
        return dt((int) strtotime($v . ($fimDoDia ? ' 23:59:59' : ' 00:00:00') . ' UTC') + LENDA_FUSO_H * 3600);
    }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/', $v)) {
        return false;
    }
    $t = strtotime($v);
    return $t === false || $t < 0 || $t > 32503680000 ? false : dt($t);
}

/** Texto longo do admin ou do jogador: quebras de linha ficam, controle sai, espaços juntados, até 2 linhas em branco. */
function textoLongo(mixed $v): ?string
{
    if (!is_string($v)) {
        return null;
    }
    $s = str_replace(["\r\n", "\r"], "\n", $v);
    $s = (string) preg_replace('/[^\P{C}\n]+/u', ' ', $s);
    $linhas = array_map(static fn(string $l): string => trim((string) preg_replace('/[^\S\n]+/u', ' ', $l)), explode("\n", $s));
    $s = trim(implode("\n", $linhas));
    $s = (string) preg_replace("/\n{3,}/", "\n\n", $s);
    return $s === '' ? null : $s;
}

// ── critério e requisitos ────────────────────────────────────────────────────────────────────────

/**
 * O critério conferido; inválido → 400 criterio. Chaves numéricas de DESAFIO_CRITERIO_MAX (v3.4: além de copas e
 * libertadores, champions, bolasOuro, copasPelaSelecao, titulos, gols, nota, clubes, temporadasMesmoClube), `nacionalidade`
 * (lista de 1 a 30 códigos de seleção, como "BRA") ou `{todasConquistas: true}` sozinho. Pelo menos uma chave.
 */
function lerCriterio(mixed $v): array
{
    $ruim = static fn(): never => erro(400, 'criterio', 'Critério: Copas do Mundo, Libertadores, Champions, Bolas de Ouro, Copas pela seleção, títulos, gols, nota, clubes, temporadas no mesmo clube (cada um de 1 até o limite), nacionalidade (lista de seleções) ou todas as conquistas.');
    $chaves = array_merge(array_keys(DESAFIO_CRITERIO_MAX), ['nacionalidade', 'todasConquistas']);
    if (!is_array($v) || ($v !== [] && array_is_list($v)) || array_diff(array_keys($v), $chaves)) {
        $ruim();
    }
    $out = [];
    foreach (DESAFIO_CRITERIO_MAX as $k => $max) {
        if (array_key_exists($k, $v) && $v[$k] !== null && $v[$k] !== 0) {
            $n = inteiroOuNulo($v[$k], 1, $max);
            if ($n === null) {
                $ruim();
            }
            $out[$k] = $n;
        }
    }
    if (array_key_exists('nacionalidade', $v) && $v['nacionalidade'] !== null) {
        $nac = $v['nacionalidade'];
        if (!is_array($nac) || $nac === [] || !array_is_list($nac) || count($nac) > 30) {
            $ruim();
        }
        $lista = [];
        foreach ($nac as $x) {
            if (!is_string($x) || !preg_match('/^[A-Z]{2,4}$/', $x)) {
                $ruim();
            }
            if (!in_array($x, $lista, true)) {
                $lista[] = $x;
            }
        }
        $out['nacionalidade'] = $lista;
    }
    $todas = $v['todasConquistas'] ?? false;
    if (!is_bool($todas) || ($todas && $out) || (!$todas && !$out)) {
        $ruim();
    }
    if ($todas) {
        $out['todasConquistas'] = true;
    }
    return $out;
}

/** {partidasMin, emailVerificado, publicadoNoHall, top3Perfil} conferido (o que faltar fica com o padrão). */
function lerRequisitos(mixed $v): array
{
    if (!is_array($v) || ($v !== [] && array_is_list($v)) || array_diff(array_keys($v), ['partidasMin', 'emailVerificado', 'publicadoNoHall', 'top3Perfil'])) {
        erro(400, 'requisitos', 'Requisitos: partidasMin (0 a 10.000), emailVerificado, publicadoNoHall e top3Perfil (sim ou não).');
    }
    $out = requisitosPadrao();
    if (array_key_exists('partidasMin', $v)) {
        $n = inteiroOuNulo($v['partidasMin'], 0, 10000);
        if ($n === null) {
            erro(400, 'requisitos', 'Requisitos: partidasMin vai de 0 a 10.000.');
        }
        $out['partidasMin'] = $n;
    }
    foreach (['emailVerificado', 'publicadoNoHall', 'top3Perfil'] as $k) {
        if (array_key_exists($k, $v)) {
            if (!is_bool($v[$k])) {
                erro(400, 'requisitos', "Requisitos: $k é sim ou não.");
            }
            $out[$k] = $v[$k];
        }
    }
    return $out;
}

function requisitosPadrao(): array
{
    return ['partidasMin' => 30, 'emailVerificado' => true, 'publicadoNoHall' => true, 'top3Perfil' => true];
}

/** Critério guardado (JSON) → array; estragado = um critério que ninguém cumpre. */
function criterioDe(array $d): array
{
    $c = json_decode((string) ($d['criterio'] ?? ''), true);
    if (!is_array($c)) {
        return ['copas' => 99];
    }
    $out = [];
    foreach (DESAFIO_CRITERIO_MAX as $k => $max) {
        if (isset($c[$k]) && is_int($c[$k]) && $c[$k] > 0) {
            $out[$k] = $c[$k];
        }
    }
    if (isset($c['nacionalidade']) && is_array($c['nacionalidade'])) {
        $nac = array_values(array_filter($c['nacionalidade'], static fn($x): bool => is_string($x) && preg_match('/^[A-Z]{2,4}$/', $x) === 1));
        if ($nac) {
            $out['nacionalidade'] = $nac;
        }
    }
    if (($c['todasConquistas'] ?? false) === true && !$out) {
        $out['todasConquistas'] = true;
    }
    return $out ?: ['copas' => 99];
}

/** v3.4: o modo do desafio (primeiro | emblema); linha de antes da v3.4 = primeiro. */
function modoDe(array $d): string
{
    return ($d['modo'] ?? 'primeiro') === 'emblema' ? 'emblema' : 'primeiro';
}

function eEmblema(array $d): bool
{
    return modoDe($d) === 'emblema';
}

/** v3.4: {icone, cor} do emblema (o guardado, ou o padrão no modo emblema); null no modo primeiro sem emblema. */
function emblemaDe(array $d): ?array
{
    $e = is_string($d['emblema'] ?? null) ? json_decode((string) $d['emblema'], true) : null;
    if (is_array($e) && is_string($e['icone'] ?? null) && preg_match('/^[a-z0-9-]{1,24}$/', $e['icone']) && is_string($e['cor'] ?? null)
        && preg_match('/^#[0-9a-f]{6}$/', $e['cor'])) {
        // §E: ícone fora do mapa (gravado direto no banco ou de antes da lista) → a medalha, como o jogo e o painel desenham
        return ['icone' => in_array($e['icone'], DESAFIO_ICONES, true) ? $e['icone'] : 'medal', 'cor' => $e['cor']];
    }
    return eEmblema($d) ? DESAFIO_EMBLEMA_PADRAO : null;
}

function dificuldadeDe(array $d): ?string
{
    $x = $d['dificuldade'] ?? null;
    return is_string($x) && in_array($x, DESAFIO_DIFICULDADES, true) ? $x : null;
}

/** O emblema mandado pelo admin: {icone (um dos DESAFIO_ICONES), cor (#rrggbb)} ou null; inválido → 400 emblema. */
function lerEmblema(mixed $v): ?array
{
    if ($v === null) {
        return null;
    }
    if (!is_array($v) || array_is_list($v) || array_diff(array_keys($v), ['icone', 'cor']) || !is_string($v['icone'] ?? null)
        || !in_array($v['icone'], DESAFIO_ICONES, true) || !is_string($v['cor'] ?? null) || !preg_match('/^#[0-9a-fA-F]{6}$/', $v['cor'])) {
        erro(400, 'emblema', 'O emblema é {"icone": um dos ícones do jogo (' . implode(', ', DESAFIO_ICONES) . '), "cor": "#rrggbb"}.');
    }
    return ['icone' => $v['icone'], 'cor' => strtolower($v['cor'])];
}

/** O critério em palavras ("3 Copas do Mundo e 2 Libertadores"), para o regulamento de partida. */
function descreverCriterio(array $crit): string
{
    if (eDeConquistas($crit)) {
        return 'as ' . CONQUISTAS_TOTAL . ' conquistas do jogo';
    }
    $nome = [
        'copas' => ['Copa do Mundo', 'Copas do Mundo'], 'libertadores' => ['Libertadores', 'Libertadores'],
        'champions' => ['Champions League', 'Champions League'], 'bolasOuro' => ['Bola de Ouro', 'Bolas de Ouro'],
        'copasPelaSelecao' => ['Copa do Mundo pela seleção em que começou', 'Copas do Mundo pela seleção em que começou'],
        'titulos' => ['título', 'títulos'], 'gols' => ['gol', 'gols'], 'clubes' => ['clube diferente', 'clubes diferentes'],
        'temporadasMesmoClube' => ['temporada no mesmo clube', 'temporadas no mesmo clube'],
    ];
    $partes = [];
    foreach ($nome as $k => [$um, $varios]) {
        if (isset($crit[$k])) {
            $partes[] = number_format($crit[$k], 0, ',', '.') . ' ' . ($crit[$k] === 1 ? $um : $varios);
        }
    }
    if (isset($crit['nota'])) {
        $partes[] = 'Nota de Legado ' . $crit['nota'] . ' ou mais';
    }
    $txt = $partes ? (count($partes) === 1 ? $partes[0] : implode(', ', array_slice($partes, 0, -1)) . ' e ' . end($partes)) : 'o critério do desafio';
    if (isset($crit['nacionalidade'])) {
        $txt .= ', com um jogador de ' . implode(', ', $crit['nacionalidade']) . ' (a mesma seleção do começo ao fim)';
    }
    return $txt;
}

function requisitosDe(array $d): array
{
    $r = json_decode((string) ($d['requisitos'] ?? ''), true);
    $out = requisitosPadrao();
    if (is_array($r)) {
        if (is_int($r['partidasMin'] ?? null) && $r['partidasMin'] >= 0) {
            $out['partidasMin'] = $r['partidasMin'];
        }
        foreach (['emailVerificado', 'publicadoNoHall', 'top3Perfil'] as $k) {
            if (is_bool($r[$k] ?? null)) {
                $out[$k] = $r[$k];
            }
        }
    }
    return $out;
}

function eDeConquistas(array $crit): bool
{
    return ($crit['todasConquistas'] ?? false) === true;
}

// ── os de fábrica ────────────────────────────────────────────────────────────────────────────────

/**
 * Regulamento de partida (o admin edita no painel). Nada aqui fala do prêmio: ele é o texto que o admin escrever. v3.4: no
 * modo emblema, todo mundo que cumprir ganha o emblema ($chance = a frase da calibração, nos de fábrica).
 */
function regulamentoPadrao(array $crit, array $req, string $modo = 'primeiro', ?string $chance = null): string
{
    $l = [];
    if ($modo === 'emblema') {
        $l[] = eDeConquistas($crit) ? 'Ganha o emblema toda conta que tiver as ' . CONQUISTAS_TOTAL . ' conquistas do jogo provadas por carreiras.'
            : 'Ganha o emblema toda conta que terminar uma carreira com ' . descreverCriterio($crit) . '. Não é corrida: todo mundo que cumprir ganha, na hora em que a carreira entra na conta.';
        $l[] = 'Vale carreira do Modo Clássico começada com a conta aberta (a semente da carreira é sorteada pelo servidor), com os dados de replay desta versão do jogo. Vale também carreira salva antes de o desafio existir.';
        if ($req['publicadoNoHall']) {
            $l[] = 'A carreira tem de estar publicada no Hall das Lendas' . ($req['top3Perfil'] ? ' e entre as 3 carreiras do seu perfil público.' : '.');
        }
        if ($chance !== null && $chance !== '') {
            $l[] = $chance;
        }
    } elseif (eDeConquistas($crit)) {
        $l[] = 'Vale a primeira conta a ter as ' . CONQUISTAS_TOTAL . ' conquistas do jogo provadas, com todos os requisitos abaixo cumpridos. A hora que conta é a do servidor.';
        $l[] = 'Só contam as conquistas provadas: as de carreiras do Modo Clássico começadas com a conta aberta (a semente é sorteada pelo servidor) e salvas na conta, com os dados de replay. As que vieram só do aparelho não contam.';
    } else {
        $l[] = 'Vale a primeira conta a terminar uma carreira com ' . descreverCriterio($crit) . ', com todos os requisitos abaixo cumpridos. A hora que conta é a do servidor.';
        $l[] = 'A carreira tem de ser do Modo Clássico, começada com a conta aberta (a semente da carreira é sorteada pelo servidor) e salva na conta depois do começo do desafio, nesta versão do jogo (com os dados de replay).';
        if ($req['publicadoNoHall']) {
            $l[] = 'A carreira tem de estar publicada no Hall das Lendas' . ($req['top3Perfil'] ? ' e entre as 3 carreiras do seu perfil público.' : '.');
        }
    }
    if ($req['emailVerificado']) {
        $l[] = 'A conta precisa ter o e-mail confirmado.';
    }
    if ($req['partidasMin'] > 0) {
        $l[] = 'A conta precisa ter pelo menos ' . $req['partidasMin'] . ' partidas jogadas com ela.';
    }
    $l[] = 'Só contam as partidas e as carreiras começadas até o limite diário do jogo; carreira salva num dia em que a conta passou desse limite não vale.';
    if ($modo === 'emblema') {
        $l[] = 'A equipe do LENDA pode conferir a carreira no próprio jogo, com as mesmas escolhas, e retirar o emblema de carreira que não bater ou de conta com trapaça.';
    } else {
        $l[] = eDeConquistas($crit) ? 'Antes de declarar o vencedor, a equipe refaz no próprio jogo as carreiras que provam as conquistas, com as mesmas escolhas. Carreira que não bater deixa de provar.'
            : 'Antes de declarar o vencedor, a equipe refaz a carreira no próprio jogo, com as mesmas escolhas. Carreira que não bater é recusada.';
        $l[] = 'A equipe do LENDA fala com o vencedor pelo e-mail da conta. Contas suspensas ou com trapaça não valem.';
    }
    $out = [];
    foreach ($l as $i => $x) {
        $out[] = ($i + 1) . '. ' . $x;
    }
    return implode("\n", $out);
}

function desafiosDeFabrica(): array
{
    $req = requisitosPadrao();
    $reqConq = ['partidasMin' => 30, 'emailVerificado' => true, 'publicadoNoHall' => false, 'top3Perfil' => false];
    return [
        ['slug' => 'tacas-do-rei', 'titulo' => 'As Taças do Rei', 'ordem' => 1, 'criterio' => ['copas' => 3, 'libertadores' => 2], 'requisitos' => $req,
            'descricao' => 'Seja o primeiro a terminar uma carreira com 3 Copas do Mundo e 2 Libertadores.'],
        ['slug' => 'tacas-do-rei-copas', 'titulo' => 'As Taças do Rei: as 3 Copas', 'ordem' => 2, 'criterio' => ['copas' => 3], 'requisitos' => $req,
            'descricao' => 'Seja o primeiro a terminar uma carreira com 3 Copas do Mundo.'],
        ['slug' => 'todas-as-conquistas', 'titulo' => 'Todas as conquistas', 'ordem' => 3, 'criterio' => ['todasConquistas' => true], 'requisitos' => $reqConq,
            'descricao' => 'Seja o primeiro a desbloquear as ' . CONQUISTAS_TOTAL . ' conquistas do jogo.'],
    ];
}

/** Semeia os de fábrica, DESATIVADOS e sem prêmio. Um slug que já existe nunca é mexido. Devolve quantos entraram. */
function semearDesafios(): int
{
    $n = 0;
    foreach (desafiosDeFabrica() as $d) {
        $n += sql("INSERT IGNORE INTO desafios (slug, titulo, descricao, regulamento, premio, criterio, requisitos, ativo, inicio, fim, criado_em, ordem)
            VALUES (?, ?, ?, ?, '', ?, ?, 0, NULL, NULL, ?, ?)", [$d['slug'], $d['titulo'], $d['descricao'],
            regulamentoPadrao($d['criterio'], $d['requisitos']), json($d['criterio']), json($d['requisitos']), dt(time()), $d['ordem']])->rowCount();
    }
    return $n;
}

/** v3.4: requisitos dos desafios de emblema de fábrica: nenhum além da carreira provada (todo mundo ganha, não é corrida). */
function requisitosEmblema(): array
{
    return ['partidasMin' => 0, 'emailVerificado' => false, 'publicadoNoHall' => false, 'top3Perfil' => false];
}

/**
 * v3.4: os 10 desafios de emblema de fábrica (calibração da §K do CONTRATO-v34: v34-desafios-emblema.json). umEm = 1 em
 * quantas carreiras sai para quem joga para isso (o melhor plano medido); aoAcaso = para quem escolhe ao acaso (null = não saiu).
 */
function desafiosEmblemaDeFabrica(): array
{
    return [
        ['slug' => 'noite-de-gala', 'titulo' => 'Noite de gala', 'descricao' => 'Ganhe a Bola de Ouro e a Champions League na mesma carreira.', 'dificuldade' => 'facil', 'criterio' => ['bolasOuro' => 1, 'champions' => 1], 'emblema' => ['icone' => 'star', 'cor' => '#b98652'], 'ordem' => 10, 'home' => true, 'umEm' => 12, 'aoAcaso' => 24],
        ['slug' => 'andarilho-campeao', 'titulo' => 'Andarilho campeão', 'descricao' => 'Jogue por 12 clubes diferentes e conquiste 20 títulos na carreira.', 'dificuldade' => 'facil', 'criterio' => ['clubes' => 12, 'titulos' => 20], 'emblema' => ['icone' => 'plane', 'cor' => '#b98652'], 'ordem' => 20, 'home' => false, 'umEm' => 11, 'aoAcaso' => 74],
        ['slug' => 'bandeira-do-clube', 'titulo' => 'Bandeira do clube', 'descricao' => 'Jogue 18 temporadas pelo mesmo clube e conquiste 20 títulos na carreira.', 'dificuldade' => 'facil', 'criterio' => ['temporadasMesmoClube' => 18, 'titulos' => 20], 'emblema' => ['icone' => 'shield', 'cor' => '#b98652'], 'ordem' => 30, 'home' => false, 'umEm' => 9, 'aoAcaso' => 417],
        ['slug' => 'hexa-e-gloria-eterna', 'titulo' => 'Hexa e Glória Eterna', 'descricao' => 'Com um jogador brasileiro, dê o hexa ao Brasil, ganhe duas Libertadores e uma Bola de Ouro.', 'dificuldade' => 'medio', 'criterio' => ['copas' => 1, 'libertadores' => 2, 'bolasOuro' => 1, 'nacionalidade' => ['BRA'], 'copasPelaSelecao' => 1], 'emblema' => ['icone' => 'flag', 'cor' => '#c8d0dc'], 'ordem' => 40, 'home' => true, 'umEm' => 66, 'aoAcaso' => null],
        ['slug' => 'era-de-ouro', 'titulo' => 'Era de ouro', 'descricao' => 'Ganhe cinco Bolas de Ouro e três Champions League na mesma carreira.', 'dificuldade' => 'medio', 'criterio' => ['bolasOuro' => 5, 'champions' => 3], 'emblema' => ['icone' => 'circle-dot', 'cor' => '#c8d0dc'], 'ordem' => 50, 'home' => false, 'umEm' => 79, 'aoAcaso' => 287],
        ['slug' => 'artilheiro-do-mundo', 'titulo' => 'Artilheiro do mundo', 'descricao' => 'Marque 800 gols na carreira e ganhe uma Copa do Mundo.', 'dificuldade' => 'medio', 'criterio' => ['gols' => 800, 'copas' => 1], 'emblema' => ['icone' => 'goal', 'cor' => '#c8d0dc'], 'ordem' => 60, 'home' => false, 'umEm' => 114, 'aoAcaso' => 7740],
        ['slug' => 'bi-do-mundo-bi-da-america', 'titulo' => 'Bi do mundo, bi da América', 'descricao' => 'Ganhe duas Copas do Mundo e duas Libertadores na mesma carreira.', 'dificuldade' => 'dificil', 'criterio' => ['copas' => 2, 'libertadores' => 2], 'emblema' => ['icone' => 'globe', 'cor' => '#f2c75a'], 'ordem' => 70, 'home' => false, 'umEm' => 350, 'aoAcaso' => null],
        ['slug' => 'imortal', 'titulo' => 'Imortal', 'descricao' => 'Ganhe duas Copas do Mundo e encerre a carreira com Nota de Legado 92 ou mais.', 'dificuldade' => 'dificil', 'criterio' => ['copas' => 2, 'nota' => 92], 'emblema' => ['icone' => 'sparkles', 'cor' => '#f2c75a'], 'ordem' => 80, 'home' => false, 'umEm' => 583, 'aoAcaso' => null],
        ['slug' => 'tacas-do-rei-emblema', 'titulo' => 'As Taças do Rei', 'descricao' => 'Ganhe três Copas do Mundo e duas Libertadores, como o Rei Pelé.', 'dificuldade' => 'lendario', 'criterio' => ['copas' => 3, 'libertadores' => 2], 'emblema' => ['icone' => 'crown', 'cor' => '#c9b8ff'], 'ordem' => 90, 'home' => true, 'umEm' => 9577, 'aoAcaso' => null],
        ['slug' => 'mil-gols-e-o-tri', 'titulo' => 'Mil gols e o tri', 'descricao' => 'Ganhe três Copas do Mundo e marque mais de 1.000 gols: a marca do Rei.', 'dificuldade' => 'lendario', 'criterio' => ['copas' => 3, 'gols' => 1001], 'emblema' => ['icone' => 'gem', 'cor' => '#c9b8ff'], 'ordem' => 100, 'home' => false, 'umEm' => 5250, 'aoAcaso' => null],
    ];
}

/** A frase da chance que vai no regulamento de partida de um emblema de fábrica. */
function fraseChance(int $umEm, ?int $aoAcaso): string
{
    $n = static fn(int $x): string => number_format($x, 0, ',', '.');
    return 'Na calibração do jogo (69 mil carreiras simuladas com o motor de verdade), sai em cerca de 1 de cada ' . $n($umEm)
        . ' carreiras de quem joga para isso' . ($aoAcaso !== null ? ' e em 1 de cada ' . $n($aoAcaso) . ' de quem escolhe ao acaso.' : '; escolhendo ao acaso, não saiu nenhuma vez.');
}

/**
 * v3.4: semeia os desafios de emblema de fábrica, ATIVOS (o início = agora), uma vez só: a marca _v34_emblemas em
 * site_config. O que o admin mudar, desligar ou um dia apagar nunca volta nem é mexido (slug que já existe: INSERT IGNORE).
 * Devolve quantos entraram.
 */
function semearEmblemas(): int
{
    if (lerEstado('_v34_emblemas') !== null) {
        return 0;
    }
    $n = 0;
    $req = requisitosEmblema();
    $agora = dt(time());
    foreach (desafiosEmblemaDeFabrica() as $d) {
        $n += sql("INSERT IGNORE INTO desafios (slug, titulo, descricao, regulamento, premio, criterio, requisitos, ativo, inicio, fim, criado_em, ordem, atualizado_em,
                modo, dificuldade, emblema, home)
            VALUES (?, ?, ?, ?, '', ?, ?, 1, ?, NULL, ?, ?, ?, 'emblema', ?, ?, ?)", [$d['slug'], $d['titulo'], $d['descricao'],
            regulamentoPadrao($d['criterio'], $req, 'emblema', fraseChance($d['umEm'], $d['aoAcaso'])), json($d['criterio']), json($req), $agora, $agora,
            $d['ordem'], $agora, $d['dificuldade'], json($d['emblema']), $d['home'] ? 1 : 0])->rowCount();
    }
    gravarSiteConfig('_v34_emblemas', ['em' => gmdate('Y-m-d\TH:i:s\Z'), 'semeados' => $n], 'instalar');
    return $n;
}

// ── limite de partidas por dia ───────────────────────────────────────────────────────────────────

function partidasDiaMax(): int
{
    $n = siteConfig()['partidas_dia_max'] ?? 100;
    return is_int($n) && $n >= 1 ? $n : 100;
}

/**
 * Mais uma partida da conta no dia de Brasília (partidas_dia guarda todas). true = ainda dentro do limite (soma em
 * partidas_conta); false = passou (não soma, e o dia fica marcado: a carreira salva nele não vale para desafio).
 */
function contarPartidaDia(int $uid, int $t): bool
{
    $dia = diaBrasilia($t);
    sql('INSERT INTO partidas_dia (usuario_id, dia, n) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE n = n + 1', [$uid, $dia]);
    return (int) umValor('SELECT n FROM partidas_dia WHERE usuario_id = ? AND dia = ?', [$uid, $dia]) <= partidasDiaMax();
}

/** Partidas da conta hoje (Brasília), também as que passaram do limite. */
function partidasHoje(int $uid): int
{
    return (int) umValor('SELECT n FROM partidas_dia WHERE usuario_id = ? AND dia = ?', [$uid, diaBrasilia()]);
}

/** A conta passou do limite em algum destes dias (YYYY-MM-DD)? */
function passouLimiteEm(int $uid, array $dias): bool
{
    $dias = array_values(array_unique(array_filter($dias, static fn($d): bool => is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) === 1)));
    if (!$dias) {
        return false;
    }
    return (int) umValor('SELECT COALESCE(MAX(n), 0) FROM partidas_dia WHERE usuario_id = ? AND dia IN (' . marcas(count($dias)) . ')',
        array_merge([$uid], $dias)) > partidasDiaMax();
}

// ── avaliação ────────────────────────────────────────────────────────────────────────────────────

/** Desafios valendo agora: ativos, sem vencedor e dentro do prazo (lidos uma vez por pedido). */
function desafiosValendo(bool $recarregar = false): array
{
    static $c = null;
    if ($c !== null && !$recarregar) {
        return $c;
    }
    if (!esquemaV33()) {
        return $c = [];
    }
    $agora = dt(time());
    return $c = sql('SELECT * FROM desafios WHERE ativo = 1 AND vencido_em IS NULL AND (inicio IS NULL OR inicio <= ?) AND (fim IS NULL OR fim > ?)
        ORDER BY ordem, id', [$agora, $agora])->fetchAll();
}

/** v3.4: a coluna (apelido c) de cada chave numérica do critério. */
const DESAFIO_COLUNA_CRITERIO = ['copas' => 'c.copas', 'libertadores' => 'COALESCE(c.libertadores, 0)', 'champions' => 'COALESCE(c.champions, 0)',
    'bolasOuro' => 'c.bolas_ouro', 'titulos' => 'c.titulos', 'gols' => 'c.gols', 'clubes' => 'COALESCE(c.n_clubes, 0)',
    'temporadasMesmoClube' => 'COALESCE(c.mesmo_clube, 0)', 'copasPelaSelecao' => 'COALESCE(c.copas_selecao, 0)'];

/** O critério usa chave da v3.4 (precisa das colunas novas)? */
function criterioV34(array $crit): bool
{
    return (bool) array_diff(array_keys($crit), ['copas', 'libertadores', 'todasConquistas']);
}

/**
 * [condição SQL (apelido c), params] da carreira que cumpre o critério de carreira (todas as chaves; `nota` só com a nota da
 * versão atual; `nacionalidade`: a seleção da criação na lista e igual à do fim). Sem o banco da v3.4, chave nova = ninguém.
 */
function sqlCumpreCriterio(array $crit): array
{
    if (criterioV34($crit) && !esquemaV34()) {
        return ['1 = 0', []];
    }
    $w = [];
    $p = [];
    foreach (DESAFIO_COLUNA_CRITERIO as $k => $col) {
        if (isset($crit[$k])) {
            $w[] = "$col >= ?";
            $p[] = $crit[$k];
        }
    }
    if (isset($crit['nota'])) {
        $w[] = 'c.nota >= ? AND c.nota_v = ' . LENDA_NOTA_VERSAO;
        $p[] = $crit['nota'];
    }
    if (isset($crit['nacionalidade'])) {
        $w[] = 'c.pais_inicio IN (' . marcas(count($crit['nacionalidade'])) . ') AND c.pais = c.pais_inicio';
        array_push($p, ...$crit['nacionalidade']);
    }
    return [$w ? implode(' AND ', $w) : '1 = 0', $p];
}

/** As colunas da carreira que a avaliação de desafio lê (apelido c); com o banco da v3.4, também as dos critérios novos e da prova. */
function camposCarreiraDesafio(): string
{
    return 'c.id, c.usuario_id, c.carreira_id, c.jogador, c.copas, c.libertadores, c.modo, c.tem_replay, c.fora_desafio, c.primeira_em, c.semente_em, c.suspeita'
        . (esquemaV34() ? ', c.salva_em, c.bolas_ouro, c.titulos, c.gols, c.nota, c.nota_v, c.pais, c.champions, c.n_clubes, c.mesmo_clube, c.copas_selecao,
            c.pais_inicio, c.prova_ok' : '');
}

/**
 * §E: os motivos que vêm da própria carreira guardada (o conteúdo de agora, o critério de agora, a semente, o prazo). O
 * candidato que passa a ter um deles é recusado sozinho (quem = sistema) e, se a carreira voltar a cumprir, volta a pendente
 * com a hora de então. Os outros (a conta e o Hall: suspensa, partidas, e-mail, publicada, entre as 3) só deixam o candidato
 * "não vale agora": a hora dele fica, o painel e o ?eu=1 mostram o motivo e o declarar responde 409 nao_cumpre enquanto
 * durar (uma ocultação por denúncias ou o Hall fechado por um dia não mudam quem foi o primeiro).
 */
const DESAFIO_MOTIVOS_CARREIRA = ['criterio', 'carreira_apagada', 'imersivo', 'sem_replay', 'sem_semente', 'limite_diario', 'antes_do_inicio',
    'depois_do_fim', 'suspeita', 'conquistas', 'nao_bateu'];

/** Por que a carreira (que cumpre o critério) não vale para o desafio, ou null. Sem olhar o Hall. v3.4: no de emblema, motivoCarreiraEmblema. */
function motivoCarreiraDesafio(array $c, array $d): ?string
{
    if (eEmblema($d)) {
        return motivoCarreiraEmblema($c, $d);
    }
    if (($c['modo'] ?? 'classico') !== 'classico') {
        return 'imersivo';
    }
    if ((int) ($c['tem_replay'] ?? 0) !== 1) {
        return 'sem_replay';
    }
    if (($c['fora_desafio'] ?? null) !== null) {
        return 'limite_diario';
    }
    // §E: a semente da carreira tem de ter sido sorteada pelo servidor para esta conta (sementes_carreira) — e depois do
    // começo do desafio: a carreira é jogada (não só salva) dentro do prazo
    $semente = $c['semente_em'] ?? null;
    if ($semente === null) {
        return 'sem_semente';
    }
    // §E: números que a plausibilidade marcou (cópia, contagem de taça inválida, bônus sem registro...): a que só espera a
    // revisão da nota alta continua valendo
    $susp = $c['suspeita'] ?? null;
    if ($susp !== null && $susp !== 'revisao') {
        return 'suspeita';
    }
    // v3.4: a carreira que não bateu na verificação por replay (prova_verificar) não vale para nada
    if (($c['prova_ok'] ?? null) !== null && (int) $c['prova_ok'] === 0) {
        return 'nao_bateu';
    }
    $primeira = $c['primeira_em'] ?? null;
    if ($primeira === null || ($d['inicio'] !== null && ((string) $primeira < (string) $d['inicio'] || (string) $semente < (string) $d['inicio']))) {
        return 'antes_do_inicio';
    }
    if ($d['fim'] !== null && (string) $primeira > (string) $d['fim']) {
        return 'depois_do_fim';
    }
    return null;
}

/**
 * v3.4: por que a carreira não dá o emblema: os motivos da prova (Clássico, replay, semente do servidor, limite do dia, suspeita,
 * não bateu) e ter entrado na conta depois do fim do desafio. Não é corrida: carreira de antes do começo (ou de antes de o
 * desafio existir) vale.
 */
function motivoCarreiraEmblema(array $c, array $d): ?string
{
    $m = motivoProva($c);
    if ($m !== null) {
        return $m;
    }
    $primeira = $c['primeira_em'] ?? null;
    if ($d['fim'] !== null && $primeira !== null && (string) $primeira > (string) $d['fim']) {
        return 'depois_do_fim';
    }
    return null;
}

/** A carreira (linha de carreiras, com camposCarreiraDesafio) cumpre o critério de carreira do desafio? */
function cumpreCriterio(array $c, array $crit): bool
{
    if (eDeConquistas($crit) || (criterioV34($crit) && !esquemaV34())) {
        return false;
    }
    $valor = ['copas' => 'copas', 'libertadores' => 'libertadores', 'champions' => 'champions', 'bolasOuro' => 'bolas_ouro', 'titulos' => 'titulos',
        'gols' => 'gols', 'clubes' => 'n_clubes', 'temporadasMesmoClube' => 'mesmo_clube', 'copasPelaSelecao' => 'copas_selecao'];
    $alguma = false;
    foreach ($valor as $k => $col) {
        if (isset($crit[$k])) {
            $alguma = true;
            if ((int) ($c[$col] ?? 0) < $crit[$k]) {
                return false;
            }
        }
    }
    if (isset($crit['nota'])) {
        $alguma = true;
        if ((int) ($c['nota'] ?? 0) < $crit['nota'] || (int) ($c['nota_v'] ?? -1) !== LENDA_NOTA_VERSAO) {
            return false;
        }
    }
    if (isset($crit['nacionalidade'])) {
        $alguma = true;
        $ini = $c['pais_inicio'] ?? null;
        if (!is_string($ini) || !in_array($ini, $crit['nacionalidade'], true) || (string) ($c['pais'] ?? '') !== $ini) {
            return false;
        }
    }
    return $alguma;
}

/**
 * Onde as carreiras da conta estão em relação ao Hall, para os requisitos: publicaveis = as que aparecem no Hall pelas
 * regras de agora, sem o teto de 3 por conta (a que espera a revisão da nota alta conta: entra quando for conferida);
 * top3 = as 3 que o perfil público mostra (idsNoHallConferidas). Conta fora do Hall: nenhuma.
 */
function hallParaDesafio(array $u): array
{
    $uid = (int) $u['id'];
    $modo = (string) ($u['hall_publico'] ?? 'auto');
    if ($modo === 'nao' || (int) ($u['hall_bloqueado'] ?? 0) === 1 || contaSuspensa($u)) {
        return ['publicaveis' => [], 'top3' => []];
    }
    $manual = $modo === 'manual' ? ' AND c.publica = 1' : '';
    $visivel = str_replace('c.suspeita IS NULL', "(c.suspeita IS NULL OR c.suspeita = 'revisao')", sqlCarreiraVisivel());
    $pub = array_map('intval', sql('SELECT c.id FROM carreiras c WHERE c.usuario_id = ? AND ' . $visivel . $manual . ' AND ' . sqlNaoECopia(),
        [$uid])->fetchAll(PDO::FETCH_COLUMN));
    return ['publicaveis' => $pub, 'top3' => idsNoHallConferidas($uid, $modo)];
}

/** Conquistas da conta que estão entre as 87 do jogo. */
function conquistasValidas(int $uid): int
{
    return (int) umValor('SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id = ? AND conquista_id IN (' . marcas(CONQUISTAS_TOTAL) . ')',
        array_merge([$uid], CONQUISTAS_IDS));
}

/**
 * As conquistas que contam no desafio de todas as conquistas: v3.4, só as PROVADAS por carreiras (as do aparelho não contam);
 * com o banco de antes da v3.4, as da conta (como na v3.3).
 */
function conquistasDoDesafio(int $uid): int
{
    return esquemaV34() ? conquistasProvadas($uid) : conquistasValidas($uid);
}

/**
 * Os requisitos da conta para o desafio (e, com a carreira $c, os do Hall): null = cumpre; senão o motivo (conta_suspensa
 * | partidas | email | nao_publicada | fora_do_top3). $hall = cache do hallParaDesafio da conta.
 */
function motivoContaDesafio(array $u, array $req, ?array $c = null, ?array &$hall = null): ?string
{
    if (contaSuspensa($u)) {
        return 'conta_suspensa';
    }
    if ((int) ($u['partidas_conta'] ?? 0) < $req['partidasMin']) {
        return 'partidas';
    }
    if ($req['emailVerificado'] && ($u['email_verificado_em'] ?? null) === null) {
        return 'email';
    }
    if ($c !== null && ($req['publicadoNoHall'] || $req['top3Perfil'])) {
        $hall ??= hallParaDesafio($u);
        if ($req['publicadoNoHall'] && !in_array((int) $c['id'], $hall['publicaveis'], true)) {
            return 'nao_publicada';
        }
        if ($req['top3Perfil'] && !in_array((int) $c['id'], $hall['top3'], true)) {
            return 'fora_do_top3';
        }
    }
    return null;
}

/** Os requisitos da conta (sem os do Hall) estão cumpridos? */
function contaCumpreRequisitos(array $u, array $req): bool
{
    return motivoContaDesafio($u, $req) === null;
}

/**
 * §E: por que o candidato não vale AGORA (null = vale), conferido de novo com as linhas de agora — a carreira guardada (o
 * critério de agora, modo, replay, semente, limite do dia, suspeita, prazo) e a conta (os requisitos e o Hall). A foto do
 * candidato (as Copas e Libertadores de quando ele nasceu) não entra: vale o que está guardado. $u = a conta (null =
 * excluída); $hall = cache do hallParaDesafio dela.
 */
function motivoCandidato(array $k, array $d, ?array $u, ?array &$hall = null): ?string
{
    if ($u === null) {
        return 'conta_excluida';
    }
    $crit = criterioDe($d);
    $c = null;
    if (eDeConquistas($crit)) {
        if (conquistasDoDesafio((int) $u['id']) < CONQUISTAS_TOTAL) {
            return 'conquistas';
        }
    } else {
        $c = $k['carreira_pk'] !== null ? umaLinha('SELECT ' . camposCarreiraDesafio() . ' FROM carreiras c WHERE c.id = ?', [(int) $k['carreira_pk']]) : null;
        if ($c === null || (int) $c['usuario_id'] !== (int) $u['id']) {
            return 'carreira_apagada';
        }
        if (!cumpreCriterio($c, $crit)) {
            return 'criterio';
        }
        $m = motivoCarreiraDesafio($c, $d);
        if ($m !== null) {
            return $m;
        }
    }
    return motivoContaDesafio($u, requisitosDe($d), $c, $hall);
}

/** O candidato deixou de valer pela carreira: recusado pelo sistema, com o motivo (o jogador vê). true = recusou. */
function recusarPeloSistema(int $kid, string $motivo, string $antes = 'Deixou de valer:'): bool
{
    $texto = mb_substr($antes . ' ' . (DESAFIO_MOTIVOS[$motivo] ?? $motivo), 0, 200, 'UTF-8');
    return sql("UPDATE desafio_candidatos SET estado = 'recusada', motivo = ?, decidido_em = ?, quem = 'sistema'
        WHERE id = ? AND estado IN ('pendente', 'verificada')", [$texto, dt(time()), $kid])->rowCount() === 1;
}

/**
 * §E: um candidato pendente ou verificado conferido de novo: motivo da carreira (DESAFIO_MOTIVOS_CARREIRA) → recusado pelo
 * sistema; vale → a foto (Copas, Libertadores, jogador) passa a ser a da carreira de agora. Motivo da conta ou do Hall: nada
 * muda. true = recusou.
 */
function reavaliarCandidato(array $k, array $d, ?array $u, ?array &$hall = null, string $antes = 'Deixou de valer:'): bool
{
    $m = motivoCandidato($k, $d, $u, $hall);
    if ($m !== null && in_array($m, DESAFIO_MOTIVOS_CARREIRA, true)) {
        return recusarPeloSistema((int) $k['id'], $m, $antes);
    }
    if ($m === null && $k['carreira_pk'] !== null) {
        sql("UPDATE desafio_candidatos k JOIN carreiras c ON c.id = k.carreira_pk SET k.copas = c.copas, k.libertadores = COALESCE(c.libertadores, 0),
            k.jogador = LEFT(c.jogador, 40) WHERE k.id = ? AND k.estado IN ('pendente', 'verificada')", [(int) $k['id']]);
    }
    return false;
}

/** §E: os candidatos pendentes e verificados da conta neste desafio, conferidos de novo. Devolve quantos recusou. */
function reavaliarCandidatosConta(array $d, array $u, ?array &$hall = null): int
{
    $n = 0;
    foreach (sql("SELECT * FROM desafio_candidatos WHERE desafio_id = ? AND usuario_id = ? AND estado IN ('pendente', 'verificada')",
        [(int) $d['id'], (int) $u['id']])->fetchAll() as $k) {
        $n += reavaliarCandidato($k, $d, $u, $hall) ? 1 : 0;
    }
    return $n;
}

/**
 * §E: todos os candidatos pendentes e verificados do desafio, conferidos de novo (o admin mudou o critério, os requisitos ou
 * o prazo): o que não cumpre mais pela carreira é recusado ("O desafio mudou: …"). Devolve quantos recusou.
 */
function reavaliarCandidatosDesafio(array $d): int
{
    if ($d['vencido_em'] !== null) {
        return 0;
    }
    $n = 0;
    $contas = [];
    foreach (sql("SELECT * FROM desafio_candidatos WHERE desafio_id = ? AND estado IN ('pendente', 'verificada') ORDER BY em, id LIMIT 5000",
        [(int) $d['id']])->fetchAll() as $k) {
        $uid = (int) $k['usuario_id'];
        if (!array_key_exists($uid, $contas)) {
            $contas[$uid] = ['u' => umaLinha('SELECT * FROM usuarios WHERE id = ?', [$uid]), 'hall' => null];
        }
        $n += reavaliarCandidato($k, $d, $contas[$uid]['u'], $contas[$uid]['hall'], 'O desafio mudou:') ? 1 : 0;
    }
    return $n;
}

/**
 * Confere a conta em cada desafio valendo (ou nos $desafios dados). §E: primeiro os candidatos que ela já tem (o que deixou
 * de cumprir pela carreira é recusado; a foto dos outros fica a de agora); depois cria o candidato pendente do que ela cumpre
 * agora (um por carreira; um por conta no de conquistas) ou faz voltar a pendente o que o sistema tinha recusado e voltou a
 * cumprir. $lote (ativar, salvar um desafio valendo): o `em` de quem já cumpria é a hora real em que cumpriu (emReal), não a
 * da avaliação. v3.4: os de modo emblema dão o emblema (concederEmblemas). Devolve quantos candidatos criou ou fez voltar e
 * quantos emblemas deu.
 */
function avaliarDesafiosConta(int $uid, ?array $desafios = null, bool $lote = false): int
{
    if (!esquemaV33()) {
        return 0;
    }
    $ds = $desafios ?? desafiosValendo();
    if (!$ds) {
        return 0;
    }
    $u = umaLinha('SELECT * FROM usuarios WHERE id = ?', [$uid]);
    if ($u === null) {
        return 0;
    }
    $criados = 0;
    $hall = null;
    $emblemas = [];
    foreach ($ds as $d) {
        if (eEmblema($d)) {
            $emblemas[] = $d;
            continue;
        }
        reavaliarCandidatosConta($d, $u, $hall);
        $req = requisitosDe($d);
        $crit = criterioDe($d);
        if (motivoContaDesafio($u, $req) !== null) {
            continue;
        }
        if (eDeConquistas($crit)) {
            if (conquistasDoDesafio($uid) >= CONQUISTAS_TOTAL) {
                $criados += garantirCandidato($d, $uid, null, $lote ? emRealConquistas($u, $d, $req) : null);
            }
            continue;
        }
        [$w, $p] = sqlCumpreCriterio($crit);
        $linhas = sql('SELECT ' . camposCarreiraDesafio() . " FROM carreiras c WHERE c.usuario_id = ? AND $w ORDER BY c.id LIMIT 200",
            array_merge([$uid], $p))->fetchAll();
        foreach ($linhas as $c) {
            if (motivoCarreiraDesafio($c, $d) !== null || motivoContaDesafio($u, $req, $c, $hall) !== null) {
                continue;
            }
            $criados += garantirCandidato($d, $uid, $c, $lote ? emReal($c, $u, $d, $req) : null);
        }
    }
    if ($emblemas && esquemaV34()) {
        $criados += concederEmblemas($u, $emblemas, $lote, $hall);
    }
    return $criados;
}

/**
 * v3.4 (lote): a hora real em que a conta passou a cumprir o desafio de todas as conquistas — a maior entre a hora em que a
 * 87ª conquista ganhou prova, a confirmação do e-mail (quando pedida) e o começo do desafio, nunca depois de agora.
 */
function emRealConquistas(array $u, array $d, array $req): string
{
    $t = esquemaV34() ? emTodasProvadas((int) $u['id']) : null;
    return emReal(['primeira_em' => $t], $u, $d, $req);
}

/**
 * §E (lote): a hora em que a conta passou a cumprir tudo com esta carreira, até onde o banco sabe — a maior entre a entrada
 * da carreira na conta (primeira_em), a confirmação do e-mail (quando pedida) e o começo do desafio, nunca depois de agora.
 * A hora em que a conta chegou às partidas mínimas e a da publicação no Hall não ficam guardadas: não entram (viés
 * conhecido, CONTRATO-v33 §E; o painel avisa ao afrouxar um requisito de um desafio valendo).
 */
function emReal(array $c, array $u, array $d, array $req): string
{
    $ms = static fn(string $t): string => strlen($t) === 19 ? $t . '.000' : substr($t, 0, 23);
    $ts = [];
    foreach ([$c['primeira_em'] ?? null, $req['emailVerificado'] ? ($u['email_verificado_em'] ?? null) : null, $d['inicio'] ?? null] as $t) {
        if (is_string($t) && strlen($t) >= 19) {
            $ts[] = $ms($t);
        }
    }
    $agora = agoraMs();
    return $ts ? min(max($ts), $agora) : $agora;
}

/**
 * Cria o candidato pendente (só se o desafio ainda vale: ativo e sem vencedor, conferido no próprio INSERT) ou, se ele já
 * existe recusado pelo sistema (§E: a carreira tinha deixado de valer), faz voltar a pendente com a hora de AGORA (é agora
 * que ela volta a cumprir; nunca a hora de antes da recusa). $em = a hora do candidato novo (lote: a real; null = agora).
 * 1 = criou ou voltou.
 */
function garantirCandidato(array $d, int $uid, ?array $c, ?string $em): int
{
    $chave = $c === null ? 'u' . $uid : 'c' . (int) $c['id'];
    $em ??= agoraMs();
    $foto = [$c['carreira_id'] ?? null, $c !== null ? mb_substr((string) $c['jogador'], 0, 40, 'UTF-8') : null,
        $c !== null ? (int) $c['copas'] : null, $c !== null ? (int) ($c['libertadores'] ?? 0) : null];
    $n = sql("INSERT IGNORE INTO desafio_candidatos (desafio_id, chave, carreira_pk, carreira_id, jogador, copas, libertadores, usuario_id, em, estado)
        SELECT d.id, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente' FROM desafios d WHERE d.id = ? AND d.ativo = 1 AND d.vencido_em IS NULL",
        array_merge([$chave, $c !== null ? (int) $c['id'] : null], $foto, [$uid, $em, (int) $d['id']]))->rowCount();
    if ($n === 1) {
        return 1;
    }
    $k = umaLinha('SELECT id, estado, quem, decidido_em FROM desafio_candidatos WHERE desafio_id = ? AND chave = ?', [(int) $d['id'], $chave]);
    if ($k === null || $k['estado'] !== 'recusada' || $k['quem'] !== 'sistema') {
        return 0; // já conta (pendente, verificado, vencedor) ou foi recusado pela equipe: a decisão dela fica
    }
    $em = agoraMs();
    return sql("UPDATE desafio_candidatos k JOIN desafios d ON d.id = k.desafio_id SET k.estado = 'pendente', k.em = ?, k.motivo = NULL,
        k.verificacao = NULL, k.decidido_em = NULL, k.quem = NULL, k.carreira_id = ?, k.jogador = ?, k.copas = ?, k.libertadores = ?
        WHERE k.id = ? AND k.estado = 'recusada' AND k.quem = 'sistema' AND d.ativo = 1 AND d.vencido_em IS NULL",
        array_merge([$em], $foto, [(int) $k['id']]))->rowCount() === 1 ? 1 : 0;
}

/**
 * Todas as contas que podem cumprir o desafio (ativar, salvar um ativo): as com carreira que cumpre o critério (ou com as
 * 87 conquistas), uma a uma, por até DESAFIO_LOTE_S segundos. §E: na ordem de quem cumpriu primeiro (a carreira mais antiga
 * de cada conta), com o `em` de cada uma a hora real (emReal) — antes, todas nasciam no mesmo instante na ordem do id da
 * conta, e a mais antiga sempre era "a primeira". v3.4: no de emblema, as contas com uma carreira-prova que cumpre o critério
 * (de qualquer época), e o de todas as conquistas pelas provadas. Devolve quantos candidatos (ou emblemas) criou.
 */
function avaliarDesafioTodos(array $d): int
{
    $crit = criterioDe($d);
    if (eDeConquistas($crit)) {
        $prova = esquemaV34() ? ' AND prova_pk IS NOT NULL' : '';
        $uids = sql('SELECT usuario_id FROM conquistas_usuario WHERE conquista_id IN (' . marcas(CONQUISTAS_TOTAL) . ')' . $prova . '
            GROUP BY usuario_id HAVING COUNT(*) >= ' . CONQUISTAS_TOTAL . ' ORDER BY MAX(' . (esquemaV34() ? 'provada_em' : 'em') . '), usuario_id LIMIT 5000',
            CONQUISTAS_IDS)->fetchAll(PDO::FETCH_COLUMN);
    } elseif (eEmblema($d)) {
        if (!esquemaV34()) {
            return 0;
        }
        [$w, $p] = sqlCumpreCriterio($crit);
        $uids = sql('SELECT c.usuario_id FROM carreiras c WHERE ' . sqlCarreiraProva() . " AND $w GROUP BY c.usuario_id
            ORDER BY MIN(COALESCE(c.primeira_em, c.salva_em)), c.usuario_id LIMIT 5000", $p)->fetchAll(PDO::FETCH_COLUMN);
    } else {
        [$w, $p] = sqlCumpreCriterio($crit);
        $uids = sql("SELECT c.usuario_id FROM carreiras c WHERE c.tem_replay = 1 AND c.modo = 'classico' AND c.fora_desafio IS NULL
            AND c.semente_em IS NOT NULL AND c.primeira_em >= ? AND $w GROUP BY c.usuario_id ORDER BY MIN(c.primeira_em), c.usuario_id LIMIT 5000",
            array_merge([(string) ($d['inicio'] ?? '1970-01-01 00:00:00')], $p))->fetchAll(PDO::FETCH_COLUMN);
    }
    $fim = microtime(true) + DESAFIO_LOTE_S;
    $n = 0;
    foreach ($uids as $uid) {
        $n += avaliarDesafiosConta((int) $uid, [$d], true);
        if (microtime(true) > $fim) {
            break;
        }
    }
    return $n;
}

// ── emblemas (v3.4) ──────────────────────────────────────────────────────────────────────────────

/** Os emblemas dados neste pedido (para a resposta do salvar: emblemasNovos). */
function emblemasDadosAgora(?array $novo = null): array
{
    static $lista = [];
    if ($novo !== null) {
        $lista[] = $novo;
    }
    return $lista;
}

/**
 * Dá à conta o emblema de cada desafio de emblema (valendo) que ela cumpre e ainda não tem: os requisitos da conta e uma
 * carreira-prova que cumpre o critério (motivoCarreiraEmblema), ou as 87 conquistas provadas no de todas as conquistas. Um
 * por conta e desafio (INSERT IGNORE na chave única: idempotente, e o retirado pelo admin não volta). $lote: o `em` é a hora em
 * que a carreira entrou na conta (a hora real); senão, agora. Devolve quantos deu.
 * §E: o retirado pelo SISTEMA (quem = sistema: a carreira que deu não bateu, foi apagada ou mudou, e a conta não tinha outra que
 * cumprisse) volta, com a carreira-prova que cumpre agora; o tirado à mão pela equipe (emblema_retirar) nunca volta sozinho.
 */
function concederEmblemas(array $u, array $ds, bool $lote, ?array &$hall = null): int
{
    $uid = (int) $u['id'];
    $tem = [];
    $doSistema = [];
    foreach (sql('SELECT id, desafio_id, estado, quem FROM emblemas_usuario WHERE usuario_id = ?', [$uid])->fetchAll() as $e) {
        if ($e['estado'] === 'retirado' && $e['quem'] === 'sistema') {
            $doSistema[(int) $e['desafio_id']] = (int) $e['id'];
        } else {
            $tem[(int) $e['desafio_id']] = true;
        }
    }
    $carreiras = null;
    $n = 0;
    foreach ($ds as $d) {
        if (isset($tem[(int) $d['id']]) || (int) $d['ativo'] !== 1) {
            continue;
        }
        $volta = $doSistema[(int) $d['id']] ?? null;
        $req = requisitosDe($d);
        if (motivoContaDesafio($u, $req) !== null) {
            continue;
        }
        $crit = criterioDe($d);
        if (eDeConquistas($crit)) {
            if (conquistasProvadas($uid) >= CONQUISTAS_TOTAL) {
                $t = emTodasProvadas($uid);
                $n += darEmblema($d, $uid, null, $lote && $t !== null ? $t . '.000' : null, $volta);
            }
            continue;
        }
        $carreiras ??= sql('SELECT ' . camposCarreiraDesafio() . ' FROM carreiras c WHERE c.usuario_id = ? AND ' . sqlCarreiraProva()
            . ' ORDER BY COALESCE(c.primeira_em, c.salva_em), c.id LIMIT 500', [$uid])->fetchAll();
        foreach ($carreiras as $c) {
            if (!cumpreCriterio($c, $crit) || motivoCarreiraEmblema($c, $d) !== null || motivoContaDesafio($u, $req, $c, $hall) !== null) {
                continue;
            }
            $quando = (string) ($c['primeira_em'] ?? $c['salva_em'] ?? '');
            $n += darEmblema($d, $uid, $c, $lote && strlen($quando) >= 19 ? substr($quando, 0, 19) . '.000' : null, $volta);
            break;
        }
    }
    return $n;
}

/**
 * Grava o emblema (só se o desafio ainda está ativo, conferido no próprio INSERT). 1 = deu agora. §E: $volta = o id do
 * emblema retirado pelo sistema, que volta a ativo com esta carreira (só se ainda estiver retirado pelo sistema).
 */
function darEmblema(array $d, int $uid, ?array $c, ?string $em, ?int $volta = null): int
{
    $foto = [$c !== null ? (int) $c['id'] : null, $c['carreira_id'] ?? null, $c !== null ? mb_substr((string) $c['jogador'], 0, 40, 'UTF-8') : null, $em ?? agoraMs()];
    if ($volta !== null) {
        $n = sql("UPDATE emblemas_usuario e JOIN desafios d ON d.id = e.desafio_id SET e.estado = 'ativo', e.carreira_pk = ?, e.carreira_id = ?, e.jogador = ?,
                e.em = ?, e.motivo = NULL, e.retirado_em = NULL, e.quem = NULL
            WHERE e.id = ? AND e.usuario_id = ? AND e.estado = 'retirado' AND e.quem = 'sistema' AND d.ativo = 1 AND d.modo = 'emblema'",
            array_merge($foto, [$volta, $uid]))->rowCount();
    } else {
        $n = sql("INSERT IGNORE INTO emblemas_usuario (usuario_id, desafio_id, carreira_pk, carreira_id, jogador, em, estado)
            SELECT ?, d.id, ?, ?, ?, ?, 'ativo' FROM desafios d WHERE d.id = ? AND d.ativo = 1 AND d.modo = 'emblema'",
            array_merge([$uid], $foto, [(int) $d['id']]))->rowCount();
    }
    if ($n === 1) {
        emblemasDadosAgora(emblemaCurto($d) + ['carreiraId' => $c['carreira_id'] ?? null]);
    }
    return $n;
}

/** {slug, titulo, icone, cor, dificuldade} do emblema de um desafio (o que o jogo mostra). */
function emblemaCurto(array $d): array
{
    $e = emblemaDe($d) ?? DESAFIO_EMBLEMA_PADRAO;
    return ['slug' => (string) $d['slug'], 'titulo' => (string) $d['titulo'], 'icone' => $e['icone'], 'cor' => $e['cor'], 'dificuldade' => dificuldadeDe($d)];
}

/** Ordem dos emblemas para mostrar: os mais difíceis antes, depois os mais antigos. */
const SQL_ORDEM_EMBLEMAS = "FIELD(d.dificuldade, 'lendario', 'dificil', 'medio', 'facil') = 0, FIELD(d.dificuldade, 'lendario', 'dificil', 'medio', 'facil'), e.em, e.id";

/**
 * Os emblemas ativos das contas (perfil, Hall, ?eu=1): uid → [{slug, titulo, icone, cor, dificuldade, em, carreiraId, jogador}],
 * os mais difíceis antes. Vale também o emblema de um desafio já desligado (a conta ganhou).
 */
function emblemasDasContas(array $uids): array
{
    $uids = array_values(array_unique(array_filter(array_map('intval', $uids))));
    if (!$uids || !esquemaV34()) {
        return [];
    }
    $out = [];
    foreach (sql('SELECT e.usuario_id, e.em, e.carreira_id, e.jogador, d.slug, d.titulo, d.emblema, d.dificuldade, d.modo FROM emblemas_usuario e
        JOIN desafios d ON d.id = e.desafio_id WHERE e.usuario_id IN (' . marcas(count($uids)) . ") AND e.estado = 'ativo'
        ORDER BY e.usuario_id, " . SQL_ORDEM_EMBLEMAS, $uids)->fetchAll() as $l) {
        $out[(int) $l['usuario_id']][] = emblemaCurto($l) + ['em' => isoMs($l['em']), 'carreiraId' => $l['carreira_id'], 'jogador' => $l['jogador']];
    }
    return $out;
}

/** Quantas contas ativas têm o emblema de cada desafio (desafio_id → n). */
function ganharamPorDesafio(array $ids): array
{
    if (!$ids || !esquemaV34()) {
        return [];
    }
    $out = [];
    foreach (sql("SELECT e.desafio_id, COUNT(*) AS n FROM emblemas_usuario e JOIN usuarios u ON u.id = e.usuario_id WHERE e.estado = 'ativo' AND "
        . LENDA_SQL_ATIVO . ' AND e.desafio_id IN (' . marcas(count($ids)) . ') GROUP BY e.desafio_id', $ids) as $l) {
        $out[(int) $l['desafio_id']] = (int) $l['n'];
    }
    return $out;
}

/**
 * A carreira deixou de provar (não bateu na verificação, apagada pela moderação): os emblemas ativos que ela deu passam para
 * outra carreira-prova da conta que cumpra o desafio ou, sem nenhuma, são retirados pelo sistema com o motivo
 * (emblemasSemACarreira). Devolve quantos foram retirados.
 */
function retirarEmblemasDaCarreira(int $pk, string $motivo): int
{
    return emblemasSemACarreira($pk, $motivo)['retirados'];
}

/**
 * v3.4 §E: a carreira $pk não sustenta mais os emblemas que deu — não bateu na verificação, foi apagada (pela moderação, ou pelo
 * dono antes de ser verificada) ou foi salva de novo e não cumpre mais ($conferir: ela ainda existe, e só sai o emblema do
 * desafio que ela deixou de cumprir). Cada emblema ativo dela passa para outra carreira-prova da conta que cumpra o desafio (a
 * que entrou primeiro; o `em` fica o de quando a conta ganhou). Sem nenhuma, sai com o motivo e quem = sistema — e volta sozinho
 * quando outra carreira-prova da conta cumprir (concederEmblemas). Antes o emblema ficava retirado para sempre, mesmo com outra
 * carreira-prova (até verificada) que cumpria. Devolve ['movidos' => n, 'retirados' => n].
 */
function emblemasSemACarreira(int $pk, string $motivo, bool $conferir = false): array
{
    $out = ['movidos' => 0, 'retirados' => 0];
    if (!esquemaV34()) {
        return $out;
    }
    $es = sql("SELECT id, usuario_id, desafio_id FROM emblemas_usuario WHERE carreira_pk = ? AND estado = 'ativo' ORDER BY id", [$pk])->fetchAll();
    if (!$es) {
        return $out;
    }
    $uid = (int) $es[0]['usuario_id'];
    $u = umaLinha('SELECT * FROM usuarios WHERE id = ?', [$uid]);
    $carreiras = sql('SELECT ' . camposCarreiraDesafio() . ' FROM carreiras c WHERE c.usuario_id = ? AND ' . sqlCarreiraProva()
        . ' ORDER BY COALESCE(c.primeira_em, c.salva_em), c.id LIMIT 500', [$uid])->fetchAll();
    $hall = null;
    $agora = dt(time());
    foreach ($es as $e) {
        $d = umaLinha('SELECT * FROM desafios WHERE id = ?', [(int) $e['desafio_id']]);
        if ($d === null) {
            continue;
        }
        $crit = criterioDe($d);
        $req = requisitosDe($d);
        $vale = static function (array $c) use ($crit, $d, $req, $u, &$hall): bool {
            return cumpreCriterio($c, $crit) && motivoCarreiraEmblema($c, $d) === null && ($u === null || motivoContaDesafio($u, $req, $c, $hall) === null);
        };
        if ($conferir) {
            foreach ($carreiras as $c) {
                if ((int) $c['id'] === $pk && $vale($c)) {
                    continue 2; // ela ainda cumpre: o emblema fica com ela
                }
            }
        }
        $outra = null;
        foreach ($carreiras as $c) {
            if ((int) $c['id'] !== $pk && $vale($c)) {
                $outra = $c;
                break;
            }
        }
        if ($outra !== null) {
            $out['movidos'] += sql("UPDATE emblemas_usuario SET carreira_pk = ?, carreira_id = ?, jogador = ? WHERE id = ? AND estado = 'ativo' AND carreira_pk = ?",
                [(int) $outra['id'], $outra['carreira_id'], mb_substr((string) $outra['jogador'], 0, 40, 'UTF-8'), (int) $e['id'], $pk])->rowCount();
            continue;
        }
        $out['retirados'] += sql("UPDATE emblemas_usuario SET estado = 'retirado', motivo = ?, retirado_em = ?, quem = 'sistema' WHERE id = ? AND estado = 'ativo' AND carreira_pk = ?",
            [mb_substr($motivo, 0, 200, 'UTF-8'), $agora, (int) $e['id'], $pk])->rowCount();
    }
    return $out;
}

/** E: um emblema para o painel. $l = linha de emblemas_usuario com apelido, u_status, u_suspenso_ate e c_id (a carreira ainda existe). */
function emblemaAdmin(array $l, array $nomes = []): array
{
    $pk = $l['carreira_pk'] !== null ? (int) $l['carreira_pk'] : null;
    $existe = $pk !== null && ($l['c_id'] ?? null) !== null;
    $quem = $l['quem'] !== null ? (string) $l['quem'] : null;
    return [
        'id' => (int) $l['id'],
        'estado' => (string) $l['estado'],
        'em' => isoMs($l['em']),
        'motivo' => $l['motivo'],
        'retiradoEm' => iso($l['retirado_em']),
        'quem' => $quem !== null ? ['codigo' => $quem, 'nome' => $nomes[$quem] ?? ($quem === 'sistema' ? 'Sistema' : null)] : null,
        'usuario' => ['id' => (int) $l['usuario_id'], 'apelido' => (string) ($l['apelido'] ?? ''),
            'status' => ($l['u_status'] ?? null) !== null ? (contaSuspensa(['status' => $l['u_status'], 'suspenso_ate' => $l['u_suspenso_ate'] ?? null]) ? 'suspenso' : 'ativo') : null],
        'carreira' => $pk === null ? null : ['pk' => $pk, 'carreiraId' => $l['carreira_id'], 'jogador' => $l['jogador'], 'existe' => $existe],
        'links' => $existe ? ['resumo' => LENDA_CAMINHO_COOKIE . '#/resumo?id=' . $pk . '&de=admin', 'verificar' => LENDA_CAMINHO_COOKIE . '#/verificar?id=' . $pk . '&prova=1'] : null,
    ];
}

/** O emblema (id de emblemas_usuario) para o painel. */
function emblemaAdminPorId(int $id): ?array
{
    $l = umaLinha('SELECT e.*, u.apelido, u.status AS u_status, u.suspenso_ate AS u_suspenso_ate, c.id AS c_id FROM emblemas_usuario e
        LEFT JOIN usuarios u ON u.id = e.usuario_id LEFT JOIN carreiras c ON c.id = e.carreira_pk WHERE e.id = ?', [$id]);
    if ($l === null) {
        return null;
    }
    $nomes = function_exists('nomesQuem') && is_string($l['quem']) ? nomesQuem([$l['quem']]) : [];
    return emblemaAdmin($l, $nomes);
}

/**
 * O dono salvou de novo uma carreira candidata com outro conteúdo: a verificação de antes não vale mais (volta a pendente,
 * para o admin conferir de novo). §E: com outro replay ($replayMudou) é outra carreira com o mesmo id (outras escolhas): o
 * candidato fica com a hora de agora, porque a de antes era de uma carreira que não existe mais. Depois cada candidato dela
 * é conferido de novo com o que está guardado agora (não cumpre → recusado; cumpre → a foto nova), em qualquer desafio sem
 * vencedor (também nos que já acabaram ou foram desativados). A vencedora não muda.
 */
function candidatosCarreiraMudou(int $pk, bool $replayMudou = false): void
{
    if (!esquemaV33()) {
        return;
    }
    sql("UPDATE desafio_candidatos SET estado = 'pendente', verificacao = NULL, motivo = 'A carreira mudou depois da verificação: confira de novo.',
        decidido_em = NULL, quem = 'sistema' WHERE carreira_pk = ? AND estado = 'verificada'", [$pk]);
    if ($replayMudou) {
        sql("UPDATE desafio_candidatos SET em = ?, motivo = 'A carreira foi salva de novo com outras escolhas: vale a hora de agora.'
            WHERE carreira_pk = ? AND estado = 'pendente'", [agoraMs(), $pk]);
    }
    $contas = [];
    foreach (sql("SELECT k.* FROM desafio_candidatos k JOIN desafios d ON d.id = k.desafio_id WHERE k.carreira_pk = ? AND k.estado = 'pendente'
        AND d.vencido_em IS NULL", [$pk])->fetchAll() as $k) {
        $d = umaLinha('SELECT * FROM desafios WHERE id = ?', [(int) $k['desafio_id']]);
        $uid = (int) $k['usuario_id'];
        if ($d === null) {
            continue;
        }
        if (!array_key_exists($uid, $contas)) {
            $contas[$uid] = ['u' => umaLinha('SELECT * FROM usuarios WHERE id = ?', [$uid]), 'hall' => null];
        }
        reavaliarCandidato($k, $d, $contas[$uid]['u'], $contas[$uid]['hall']);
    }
}

/** O dono apagou a carreira: o candidato pendente ou verificado dela é recusado (a vencedora fica). */
function candidatosCarreiraApagada(int $pk): void
{
    if (!esquemaV33()) {
        return;
    }
    sql("UPDATE desafio_candidatos SET estado = 'recusada', motivo = 'A carreira foi apagada da conta.', decidido_em = ?, quem = 'sistema'
        WHERE carreira_pk = ? AND estado IN ('pendente', 'verificada')", [dt(time()), $pk]);
}

// ── sementes sorteadas pelo servidor (§E) ────────────────────────────────────────────────────────

/**
 * Sorteia a semente da carreira do Clássico que a conta começa agora (POST carreiras.php {acao:"semente"}): uma por início,
 * até partidas_dia_max por dia de Brasília (o mesmo limite das partidas). Passou do limite: sem semente — o jogo usa a do
 * aparelho e a carreira não vale para desafio. → {semente: [a0, a1] | null, id: "career-…" | null, motivo: null |
 * "limite_diario", hoje, max}.
 */
function emitirSemente(int $uid): array
{
    $max = partidasDiaMax();
    $dia = diaBrasilia();
    return transacao(static function () use ($uid, $max, $dia): array {
        sql('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', [$uid]); // uma de cada vez por conta: o limite do dia não estoura
        $n = (int) umValor('SELECT COUNT(*) FROM sementes_carreira WHERE usuario_id = ? AND dia = ?', [$uid, $dia]);
        if ($n >= $max) {
            return ['semente' => null, 'id' => null, 'motivo' => 'limite_diario', 'hoje' => $n, 'max' => $max];
        }
        for ($i = 0; $i < 8; $i++) {
            $a0 = random_int(0, 4294967295);
            $a1 = random_int(0, 4294967295);
            $s = sementeTexto($a0, $a1);
            if (sql('INSERT IGNORE INTO sementes_carreira (usuario_id, semente, dia, emitida_em) VALUES (?, ?, ?, ?)', [$uid, $s, $dia, agoraMs()])->rowCount() === 1) {
                return ['semente' => [$a0, $a1], 'id' => 'career-' . $s, 'motivo' => null, 'hoje' => $n + 1, 'max' => $max];
            }
        }
        throw new RuntimeException('semente: oito sorteios repetidos');
    });
}

/** Quando a semente saiu do servidor para a conta (DATETIME(3)), ou null (não saiu, já foi limpa, ou o banco não tem a tabela). */
function sementeEmitidaEm(int $uid, ?string $semente): ?string
{
    if ($semente === null || !esquemaV33()) {
        return null;
    }
    try {
        $v = umValor('SELECT emitida_em FROM sementes_carreira WHERE usuario_id = ? AND semente = ?', [$uid, $semente]);
    } catch (PDOException $e) {
        if (!eFaltaDeSchema($e)) {
            throw $e;
        }
        return null;
    }
    return $v === null ? null : (string) $v;
}

// ── o que o jogo vê ──────────────────────────────────────────────────────────────────────────────

/** Desafios públicos: os ativos e os que já têm vencedor (o rascunho desativado não aparece). */
function desafiosPublicos(): array
{
    if (!esquemaV33()) {
        return [];
    }
    $ds = sql('SELECT * FROM desafios WHERE ativo = 1 OR vencido_em IS NOT NULL ORDER BY ordem, id')->fetchAll();
    $ids = array_map(static fn(array $d): int => (int) $d['id'], $ds);
    $pend = [];
    $venc = [];
    if ($ids) {
        foreach (sql("SELECT desafio_id, COUNT(*) AS n FROM desafio_candidatos WHERE estado IN ('pendente', 'verificada') AND desafio_id IN ("
            . marcas(count($ids)) . ') GROUP BY desafio_id', $ids) as $l) {
            $pend[(int) $l['desafio_id']] = (int) $l['n'];
        }
        $cids = array_values(array_filter(array_map(static fn(array $d): int => (int) ($d['vencedor_candidato'] ?? 0), $ds)));
        if ($cids) {
            foreach (sql('SELECT k.id, k.carreira_id, k.jogador, k.em, u.apelido, u.codigo_convite FROM desafio_candidatos k
                LEFT JOIN usuarios u ON u.id = k.usuario_id WHERE k.id IN (' . marcas(count($cids)) . ')', $cids) as $l) {
                $venc[(int) $l['id']] = $l;
            }
        }
    }
    $ganharam = ganharamPorDesafio($ids);
    return array_map(static fn(array $d): array => desafioPublico($d, $pend[(int) $d['id']] ?? 0, $venc[(int) ($d['vencedor_candidato'] ?? 0)] ?? null,
        $ganharam[(int) $d['id']] ?? 0), $ds);
}

/** Um desafio para o jogo. v3.4: modo, dificuldade, emblema, home e quantas contas já ganharam o emblema. */
function desafioPublico(array $d, int $pendentes, ?array $k, int $ganharam = 0): array
{
    $agora = dt(time());
    $vencedor = null;
    if ($d['vencido_em'] !== null) {
        // conta do vencedor excluída (LGPD): fica só que o desafio foi vencido e quando
        $vencedor = $k === null ? ['apelido' => null, 'jogador' => null, 'carreiraId' => null, 'perfil' => null, 'em' => null,
            'declaradoEm' => iso($d['vencido_em']), 'excluido' => true]
            : ['apelido' => $k['apelido'] !== null ? (string) $k['apelido'] : null, 'jogador' => $k['jogador'], 'carreiraId' => $k['carreira_id'],
                'perfil' => $k['codigo_convite'] ?? null, 'em' => isoMs($k['em']), 'declaradoEm' => iso($d['vencido_em'])];
    }
    return [
        'slug' => (string) $d['slug'],
        'titulo' => (string) $d['titulo'],
        'descricao' => $d['descricao'] !== null ? (string) $d['descricao'] : null,
        'regulamento' => $d['regulamento'] !== null ? (string) $d['regulamento'] : null,
        'premio' => (string) ($d['premio'] ?? ''),
        'criterio' => (object) criterioDe($d),
        'requisitos' => requisitosDe($d),
        'ativo' => (int) $d['ativo'] === 1,
        'inicio' => iso($d['inicio']),
        'fim' => iso($d['fim']),
        'encerrado' => $d['vencido_em'] !== null || ($d['fim'] !== null && (string) $d['fim'] <= $agora),
        'vencedor' => $vencedor,
        'pendentes' => $pendentes,
        // v3.4
        'modo' => modoDe($d),
        'dificuldade' => dificuldadeDe($d),
        'emblema' => emblemaDe($d),
        'home' => (int) ($d['home'] ?? 0) === 1,
        'ganharam' => $ganharam,
    ];
}

/** O "eu" do desafio para a conta logada (desafios.php?eu=1): o checklist e o candidato dela. */
function euNoDesafio(array $d, array $u, ?array &$hall): array
{
    $uid = (int) $u['id'];
    $req = requisitosDe($d);
    $crit = criterioDe($d);
    $out = [
        'partidas' => (int) $u['partidas_conta'],
        'partidasMin' => $req['partidasMin'],
        'emailVerificado' => ($u['email_verificado_em'] ?? null) !== null,
        'partidasHoje' => partidasHoje($uid),
        'partidasDiaMax' => partidasDiaMax(),
    ];
    $lista = [];
    if (eDeConquistas($crit)) {
        // v3.4: conquistas = as provadas (as que contam); conquistasTodas = também as que só vieram do aparelho
        $out['conquistas'] = conquistasDoDesafio($uid);
        $out['conquistasTotal'] = CONQUISTAS_TOTAL;
        if (esquemaV34()) {
            $out['conquistasVerificadas'] = conquistasProvadas($uid, true);
            $out['conquistasTodas'] = conquistasValidas($uid);
        }
    } else {
        [$w, $p] = sqlCumpreCriterio($crit);
        $linhas = sql('SELECT ' . camposCarreiraDesafio() . " FROM carreiras c WHERE c.usuario_id = ? AND $w ORDER BY c.nota DESC, c.id ASC LIMIT 20",
            array_merge([$uid], $p))->fetchAll();
        foreach ($linhas as $c) {
            $hall ??= hallParaDesafio($u);
            $pk = (int) $c['id'];
            $publicada = in_array($pk, $hall['publicaveis'], true);
            $noTop3 = in_array($pk, $hall['top3'], true);
            $motivo = motivoCarreiraDesafio($c, $d)
                ?? ($req['publicadoNoHall'] && !$publicada ? 'nao_publicada' : ($req['top3Perfil'] && !$noTop3 ? 'fora_do_top3' : null));
            $lista[] = ['carreiraId' => (string) $c['carreira_id'], 'jogador' => (string) $c['jogador'], 'publicada' => $publicada, 'noTop3' => $noTop3,
                'temReplay' => (int) $c['tem_replay'] === 1, 'vale' => $motivo === null, 'motivo' => $motivo,
                'motivoTexto' => $motivo !== null ? DESAFIO_MOTIVOS[$motivo] : null];
        }
    }
    $out['carreirasQueCumprem'] = $lista;
    if (eEmblema($d)) {
        // v3.4: o emblema da conta neste desafio (o retirado pelo admin aparece com o motivo); não há candidato
        $e = esquemaV34() ? umaLinha('SELECT * FROM emblemas_usuario WHERE usuario_id = ? AND desafio_id = ?', [$uid, (int) $d['id']]) : null;
        $out['emblema'] = $e === null ? null : ['estado' => (string) $e['estado'], 'em' => isoMs($e['em']), 'carreiraId' => $e['carreira_id'],
            'jogador' => $e['jogador'], 'motivo' => $e['estado'] === 'retirado' ? $e['motivo'] : null];
        $out['candidato'] = null;
        return $out;
    }
    $k = umaLinha("SELECT * FROM desafio_candidatos WHERE desafio_id = ? AND usuario_id = ?
        ORDER BY FIELD(estado, 'vencedora', 'verificada', 'pendente', 'recusada'), em, id LIMIT 1", [(int) $d['id'], $uid]);
    $out['candidato'] = null;
    if ($k !== null) {
        // §E: o pendente/verificado que não vale agora (a carreira saiu do Hall, das 3 do perfil...) diz o motivo, em vez
        // de "em verificação"
        $agora = in_array($k['estado'], ['pendente', 'verificada'], true) ? motivoCandidato($k, $d, $u, $hall) : null;
        $out['candidato'] = ['estado' => (string) $k['estado'], 'motivo' => $k['motivo'], 'em' => isoMs($k['em']), 'carreiraId' => $k['carreira_id'],
            'vale' => $agora === null, 'motivoAgora' => $agora, 'motivoAgoraTexto' => $agora !== null ? (DESAFIO_MOTIVOS[$agora] ?? null) : null];
    }
    return $out;
}

// ── admin ────────────────────────────────────────────────────────────────────────────────────────

function desafioOu404(int $id, bool $travar = false): array
{
    $d = umaLinha('SELECT * FROM desafios WHERE id = ?' . ($travar ? ' FOR UPDATE' : ''), [$id]);
    if ($d === null) {
        erro(404, 'nao_encontrado', 'Desafio não encontrado.');
    }
    return $d;
}

/** D: o desafio para o painel, com o vencedor e a contagem dos candidatos por estado (v3.4: e dos emblemas). */
function desafioAdmin(array $d, ?array $contagem = null, ?array $emblemas = null): array
{
    $id = (int) $d['id'];
    if ($contagem === null) {
        $contagem = array_fill_keys(DESAFIO_ESTADOS, 0);
        foreach (sql('SELECT estado, COUNT(*) AS n FROM desafio_candidatos WHERE desafio_id = ? GROUP BY estado', [$id]) as $l) {
            $contagem[(string) $l['estado']] = (int) $l['n'];
        }
    }
    $vencedor = null;
    if ($d['vencido_em'] !== null) {
        $k = (int) ($d['vencedor_candidato'] ?? 0) > 0 ? umaLinha('SELECT k.*, u.apelido FROM desafio_candidatos k LEFT JOIN usuarios u ON u.id = k.usuario_id
            WHERE k.id = ?', [(int) $d['vencedor_candidato']]) : null;
        $vencedor = [
            'candidatoId' => $k !== null ? (int) $k['id'] : null,
            'usuario' => $k !== null && $k['apelido'] !== null ? ['id' => (int) $k['usuario_id'], 'apelido' => (string) $k['apelido']] : null,
            'carreira' => $k !== null && $k['carreira_pk'] !== null ? ['pk' => (int) $k['carreira_pk'], 'carreiraId' => $k['carreira_id'], 'jogador' => $k['jogador']] : null,
            'em' => $k !== null ? isoMs($k['em']) : null,
            'declaradoEm' => iso($d['vencido_em']),
            'excluido' => $k === null,
        ];
    }
    $agora = dt(time());
    $porEstado = [];
    foreach (DESAFIO_ESTADOS as $e) {
        $porEstado[$e] = (int) ($contagem[$e] ?? 0);
    }
    return [
        'id' => $id,
        'slug' => (string) $d['slug'],
        'titulo' => (string) $d['titulo'],
        'descricao' => $d['descricao'],
        'regulamento' => $d['regulamento'],
        'premio' => (string) ($d['premio'] ?? ''),
        'criterio' => (object) criterioDe($d),
        'requisitos' => requisitosDe($d),
        'ativo' => (int) $d['ativo'] === 1,
        'inicio' => iso($d['inicio']),
        'fim' => iso($d['fim']),
        'criadoEm' => iso($d['criado_em']),
        'atualizadoEm' => iso($d['atualizado_em'] ?? null),
        'ordem' => (int) $d['ordem'],
        // valendo = a avaliação está criando candidatos agora (ativo, sem vencedor e dentro do prazo)
        'valendo' => (int) $d['ativo'] === 1 && $d['vencido_em'] === null && ($d['inicio'] === null || (string) $d['inicio'] <= $agora)
            && ($d['fim'] === null || (string) $d['fim'] > $agora),
        'encerrado' => $d['vencido_em'] !== null || ($d['fim'] !== null && (string) $d['fim'] <= $agora),
        'vencedor' => $vencedor,
        'candidatos' => $porEstado + ['total' => array_sum($porEstado)],
        // v3.4
        'modo' => modoDe($d),
        'dificuldade' => dificuldadeDe($d),
        'emblema' => emblemaDe($d),
        'home' => (int) ($d['home'] ?? 0) === 1,
        'emblemas' => $emblemas ?? contagemEmblemas($id),
    ];
}

/** v3.4: {ativos, retirados} dos emblemas do desafio. */
function contagemEmblemas(int $id): array
{
    $out = ['ativos' => 0, 'retirados' => 0];
    if (!esquemaV34()) {
        return $out;
    }
    foreach (sql('SELECT estado, COUNT(*) AS n FROM emblemas_usuario WHERE desafio_id = ? GROUP BY estado', [$id]) as $l) {
        $out[$l['estado'] === 'ativo' ? 'ativos' : 'retirados'] += (int) $l['n'];
    }
    return $out;
}

/**
 * K: um candidato para o painel (com os links do jogo: resumo e verificação). §E: $agora = por que o pendente/verificado não
 * vale agora (motivoCandidato; null = vale; false = não conferido) → K.valeAgora.
 */
function candidatoAdmin(array $l, array $nomes, ?int $primeiroId, string|false|null $agora = false): array
{
    $v = is_string($l['verificacao'] ?? null) ? json_decode((string) $l['verificacao'], true) : null;
    $pk = $l['carreira_pk'] !== null ? (int) $l['carreira_pk'] : null;
    $existe = $pk !== null && $l['c_id'] !== null;
    $quem = $l['quem'] !== null ? (string) $l['quem'] : null;
    return [
        'id' => (int) $l['id'],
        'estado' => (string) $l['estado'],
        'em' => isoMs($l['em']),
        'motivo' => $l['motivo'],
        'decididoEm' => iso($l['decidido_em']),
        'quem' => $quem !== null ? ['codigo' => $quem, 'nome' => $nomes[$quem] ?? ($quem === 'sistema' ? 'Sistema' : null)] : null,
        'verificacao' => is_array($v) ? $v : null,
        'primeiro' => $primeiroId !== null && (int) $l['id'] === $primeiroId,
        'usuario' => ['id' => (int) $l['usuario_id'], 'apelido' => (string) ($l['apelido'] ?? ''),
            'status' => $l['u_status'] !== null ? (contaSuspensa(['status' => $l['u_status'], 'suspenso_ate' => $l['u_suspenso_ate']]) ? 'suspenso' : 'ativo') : null,
            'tipo' => $l['u_tipo'], 'emailVerificado' => $l['u_verificado'] !== null, 'partidasConta' => (int) ($l['u_partidas'] ?? 0)],
        'carreira' => $pk === null ? null : ['pk' => $pk, 'carreiraId' => $l['carreira_id'], 'jogador' => $l['jogador'],
            'copas' => $l['copas'] !== null ? (int) $l['copas'] : null, 'libertadores' => $l['libertadores'] !== null ? (int) $l['libertadores'] : null,
            'existe' => $existe, 'nota' => $existe ? (int) $l['c_nota'] : null, 'temReplay' => $existe && (int) $l['c_replay'] === 1],
        'links' => $existe ? ['resumo' => LENDA_CAMINHO_COOKIE . '#/resumo?id=' . $pk . '&de=admin',
            'verificar' => LENDA_CAMINHO_COOKIE . '#/verificar?id=' . $pk . '&candidato=' . (int) $l['id']]
            // v3.4: o de todas as conquistas verifica em lote as carreiras-prova da conta
            : ($pk === null && esquemaV34() ? ['resumo' => null, 'verificar' => LENDA_CAMINHO_COOKIE . '#/verificar?conta=' . (int) $l['usuario_id']
                . '&candidato=' . (int) $l['id']] : null),
        // §E: conferido agora com a carreira guardada e a conta (o declarar confere de novo): {ok, motivo, texto} | null
        'valeAgora' => $agora === false ? null : ['ok' => $agora === null, 'motivo' => $agora, 'texto' => $agora !== null ? (DESAFIO_MOTIVOS[$agora] ?? null) : null],
    ];
}

/** O primeiro candidato que ainda conta (pendente, verificado ou vencedor), pelo menor em. */
function primeiroCandidato(int $desafioId): ?int
{
    $id = umValor("SELECT id FROM desafio_candidatos WHERE desafio_id = ? AND estado IN ('pendente', 'verificada', 'vencedora') ORDER BY em, id LIMIT 1", [$desafioId]);
    return $id === null ? null : (int) $id;
}

/** Texto do aviso em Minha conta para o vencedor (aviso_conta, até 300). */
function avisoVencedor(array $d): string
{
    return mb_substr(LENDA_AVISO_VENCEDOR . (string) $d['titulo'] . '”. A equipe do LENDA vai falar com você pelo e-mail da conta.', 0, 300, 'UTF-8');
}

/** As rotas GET do admin.php da v3.3 (desafios e Fale conosco). Responde e termina, ou volta sem fazer nada. */
function rotasGetV33(string $r, int $pagina): void
{
    if (!in_array($r, ['desafios', 'desafio', 'suporte', 'provas'], true)) {
        return;
    }
    if (!esquemaV33()) {
        erroInstalar();
    }
    if ($r === 'suporte') {
        rotaGetSuporte($pagina);
    }
    if ($r === 'provas') {
        rotaGetProvas(); // v3.4 (_provas.php)
    }
    if ($r === 'desafios') {
        $ds = sql('SELECT * FROM desafios ORDER BY ordem, id')->fetchAll();
        $cont = [];
        foreach (sql('SELECT desafio_id, estado, COUNT(*) AS n FROM desafio_candidatos GROUP BY desafio_id, estado') as $l) {
            $cont[(int) $l['desafio_id']][(string) $l['estado']] = (int) $l['n'];
        }
        $emb = [];
        if (esquemaV34()) {
            foreach (sql('SELECT desafio_id, estado, COUNT(*) AS n FROM emblemas_usuario GROUP BY desafio_id, estado') as $l) {
                $emb[(int) $l['desafio_id']][$l['estado'] === 'ativo' ? 'ativos' : 'retirados'] = (int) $l['n'];
            }
        }
        responder(200, ['itens' => array_map(static fn(array $d): array => desafioAdmin($d, ($cont[(int) $d['id']] ?? []) + array_fill_keys(DESAFIO_ESTADOS, 0),
            ($emb[(int) $d['id']] ?? []) + ['ativos' => 0, 'retirados' => 0]), $ds),
            'partidasDiaMax' => partidasDiaMax(), 'conquistasTotal' => CONQUISTAS_TOTAL]);
    }
    $id = lerIdNumero($_GET['id'] ?? null, 'Desafio');
    $d = desafioOu404($id);
    if (eEmblema($d) && esquemaV34()) {
        // v3.4: no de emblema não há candidatos: quem ganhou (E), paginado, com o filtro estado=ativo|retirado
        $estado = qs('estado', 10);
        $onde = 'e.desafio_id = ?';
        $params = [$id];
        if ($estado !== '') {
            if (!in_array($estado, DESAFIO_EMBLEMA_ESTADOS, true)) {
                erro(400, 'filtro', 'Estado do emblema: ativo ou retirado.');
            }
            $onde .= ' AND e.estado = ?';
            $params[] = $estado;
        }
        $total = (int) umValor("SELECT COUNT(*) FROM emblemas_usuario e WHERE $onde", $params);
        $linhas = sql("SELECT e.*, u.apelido, u.status AS u_status, u.suspenso_ate AS u_suspenso_ate, c.id AS c_id FROM emblemas_usuario e
            LEFT JOIN usuarios u ON u.id = e.usuario_id LEFT JOIN carreiras c ON c.id = e.carreira_pk
            WHERE $onde ORDER BY e.em DESC, e.id DESC LIMIT " . POR_PAGINA . ' OFFSET ' . (($pagina - 1) * POR_PAGINA), $params)->fetchAll();
        $nomes = function_exists('nomesQuem') ? nomesQuem(array_values(array_unique(array_filter(array_column($linhas, 'quem'), 'is_string')))) : [];
        responder(200, ['desafio' => desafioAdmin($d), 'candidatos' => paginado(0, 1, []),
            'emblemas' => paginado($total, $pagina, array_map(static fn(array $l): array => emblemaAdmin($l, $nomes), $linhas))]);
    }
    $estado = qs('estado', 10);
    $onde = 'k.desafio_id = ?';
    $params = [$id];
    if ($estado !== '') {
        if (!in_array($estado, DESAFIO_ESTADOS, true)) {
            erro(400, 'filtro', 'Estado: pendente, verificada, recusada ou vencedora.');
        }
        $onde .= ' AND k.estado = ?';
        $params[] = $estado;
    }
    $total = (int) umValor("SELECT COUNT(*) FROM desafio_candidatos k WHERE $onde", $params);
    $linhas = sql("SELECT k.*, u.apelido, u.status AS u_status, u.suspenso_ate AS u_suspenso_ate, u.tipo AS u_tipo, u.email_verificado_em AS u_verificado,
            u.partidas_conta AS u_partidas, c.id AS c_id, c.nota AS c_nota, c.tem_replay AS c_replay
        FROM desafio_candidatos k LEFT JOIN usuarios u ON u.id = k.usuario_id LEFT JOIN carreiras c ON c.id = k.carreira_pk
        WHERE $onde ORDER BY k.em, k.id LIMIT " . POR_PAGINA . ' OFFSET ' . (($pagina - 1) * POR_PAGINA), $params)->fetchAll();
    $nomes = function_exists('nomesQuem') ? nomesQuem(array_values(array_unique(array_filter(array_column($linhas, 'quem'), 'is_string')))) : [];
    $primeiro = primeiroCandidato($id);
    // §E: cada pendente/verificado conferido agora (critério de agora, carreira guardada, requisitos, Hall)
    $contas = [];
    $agora = [];
    foreach ($linhas as $l) {
        if (!in_array($l['estado'], ['pendente', 'verificada'], true)) {
            continue;
        }
        $uid = (int) $l['usuario_id'];
        if (!array_key_exists($uid, $contas)) {
            $contas[$uid] = ['u' => umaLinha('SELECT * FROM usuarios WHERE id = ?', [$uid]), 'hall' => null];
        }
        $agora[(int) $l['id']] = motivoCandidato($l, $d, $contas[$uid]['u'], $contas[$uid]['hall']);
    }
    responder(200, ['desafio' => desafioAdmin($d), 'candidatos' => paginado($total, $pagina,
        array_map(static fn(array $l): array => candidatoAdmin($l, $nomes, $primeiro, array_key_exists((int) $l['id'], $agora) ? $agora[(int) $l['id']] : false), $linhas))]);
}

/** As ações POST do admin.php da v3.3. Responde e termina, ou volta sem fazer nada (ação de outro). */
function rotasPostV33(string $acao, array $j): void
{
    $minhas = ['desafio_salvar', 'desafio_ativar', 'candidato_verificar', 'candidato_recusar', 'desafio_declarar_vencedor', 'desafio_reabrir',
        'suporte_status', 'suporte_responder', 'suporte_lote', 'reenviar_verificacao', 'prova_verificar', 'emblema_retirar', 'emblema_devolver'];
    if (!in_array($acao, $minhas, true)) {
        return;
    }
    if (!esquemaV33()) {
        erroInstalar();
    }
    if (str_starts_with($acao, 'suporte_')) {
        acaoSuporte($acao, $j);
    }
    if ($acao === 'prova_verificar') {
        acaoProvaVerificar($j); // v3.4 (_provas.php)
    }
    if ($acao === 'emblema_retirar' || $acao === 'emblema_devolver') {
        acaoEmblema($acao, $j); // v3.4
    }
    switch ($acao) {
        case 'reenviar_verificacao':
            $u = usuarioOu404(lerIdNumero($j['id'] ?? null));
            if ($u['email_verificado_em'] !== null) {
                erro(409, 'ja_verificado', 'O e-mail dessa conta já está confirmado.');
            }
            limitar('adm-verif', 'u' . $u['id'], 3);
            $enviado = mandarCodigoVerificacao($u, 'admin_verif');
            registrarAdmin('reenviar_verificacao', 'usuario:' . $u['id'], ['enviado' => $enviado]);
            responder(200, ['ok' => true, 'enviado' => $enviado, 'para' => mascararEmail((string) $u['email'])]);

        case 'desafio_salvar':
            acaoDesafioSalvar($j);

        case 'desafio_ativar':
            $id = lerIdNumero($j['id'] ?? null, 'Desafio');
            $ativo = $j['ativo'] ?? null;
            if (!is_bool($ativo)) {
                erro(400, 'dados', 'Diga se o desafio fica ativo (sim) ou não.');
            }
            $antes = desafioOu404($id);
            if ($ativo && eDeConquistas(criterioDe($antes)) && !esquemaV34()) {
                erro(409, 'sem_prova', DESAFIO_SEM_PROVA); // §E (v3.4: a prova são as conquistas provadas pelas carreiras)
            }
            transacao(static function () use ($id, $ativo): void {
                $d = desafioOu404($id, true);
                // começa quando é ativado (se o admin não marcou outro início)
                sql('UPDATE desafios SET ativo = ?, inicio = ?, atualizado_em = ? WHERE id = ?',
                    [$ativo ? 1 : 0, $ativo && $d['inicio'] === null ? dt(time()) : $d['inicio'], dt(time()), $id]);
            });
            $d = desafioOu404($id);
            $novos = $ativo ? avaliarSeValendo($d) : 0;
            registrarAdmin('desafio_ativar', 'desafio:' . $id, ['slug' => (string) $d['slug'], 'ativo' => $ativo, 'antes' => (int) $antes['ativo'] === 1,
                'candidatosNovos' => $novos]);
            // v3.4: no de emblema, candidatosNovos = quantas contas ganharam o emblema agora (também em emblemasNovos)
            responder(200, ['ok' => true, 'desafio' => desafioAdmin($d), 'candidatosNovos' => $novos, 'emblemasNovos' => eEmblema($d) ? $novos : 0]);

        case 'candidato_verificar':
            $res = $j['resultado'] ?? null;
            if (!is_array($res) || !is_bool($res['ok'] ?? null)) {
                erro(400, 'resultado', 'Mande o resultado da verificação: {"ok": sim ou não, "detalhes": {…}}.');
            }
            $det = $res['detalhes'] ?? null;
            if ($det !== null && (!is_array($det) || strlen(json($det)) > DESAFIO_VERIFICACAO_MAX)) {
                erro(400, 'resultado', 'Os detalhes da verificação são um objeto de até 8 KB.');
            }
            if (array_key_exists('id', $j)) {
                $alvos = [lerIdNumero($j['id'], 'Candidato')];
            } else {
                $pk = lerIdNumero($j['carreira'] ?? null, 'Carreira');
                $alvos = array_map('intval', sql("SELECT id FROM desafio_candidatos WHERE carreira_pk = ? AND estado <> 'vencedora' ORDER BY id", [$pk])
                    ->fetchAll(PDO::FETCH_COLUMN));
                if (!$alvos) {
                    erro(404, 'nao_encontrado', 'Essa carreira não é candidata a nenhum desafio (ou já venceu).');
                }
            }
            $quem = admQuem();
            $feitos = [];
            foreach ($alvos as $cid) {
                $k = transacao(static function () use ($cid, $res, $det, $quem): array {
                    $k = umaLinha('SELECT * FROM desafio_candidatos WHERE id = ? FOR UPDATE', [$cid]);
                    if ($k === null) {
                        erro(404, 'nao_encontrado', 'Candidato não encontrado.');
                    }
                    if ($k['estado'] === 'vencedora') {
                        erro(409, 'vencedora', 'Esse candidato já foi declarado vencedor. Reabra o desafio antes de mexer nele.');
                    }
                    if ($k['carreira_pk'] !== null && umValor('SELECT 1 FROM carreiras WHERE id = ?', [(int) $k['carreira_pk']]) === null) {
                        erro(409, 'carreira_apagada', 'A carreira desse candidato não existe mais.');
                    }
                    $d = umaLinha('SELECT * FROM desafios WHERE id = ?', [(int) $k['desafio_id']]) ?? [];
                    $ok = $res['ok'];
                    if ($ok && eDeConquistas(criterioDe($d))) {
                        if (!esquemaV34()) {
                            erro(409, 'sem_prova', DESAFIO_SEM_PROVA); // §E: "Conferi as conquistas" não conferia nada
                        }
                        // v3.4: só com as 87 provadas por carreiras verificadas no replay (prova_verificar)
                        $faltam = faltasProvas((int) $k['usuario_id'])['faltamVerificar'];
                        if ($faltam) {
                            erroCom(409, 'sem_prova', DESAFIO_SEM_PROVA_V34, ['faltam' => $faltam]);
                        }
                    }
                    $motivo = $ok ? null : (texto(is_array($det) ? ($det['motivo'] ?? null) : null, 200) ?? 'Não bateu na verificação pelo jogo.');
                    $estado = $ok ? 'verificada' : 'recusada';
                    $naoCumpre = null;
                    if ($ok) {
                        // §E: o replay prova que a carreira GUARDADA é a do motor; aqui confere se ela (a de agora) cumpre o critério
                        // de agora. Não cumpre pela carreira: recusada, com o motivo (a verificação fica guardada)
                        $naoCumpre = motivoCandidato($k, $d, umaLinha('SELECT * FROM usuarios WHERE id = ?', [(int) $k['usuario_id']]));
                        if ($naoCumpre !== null && in_array($naoCumpre, DESAFIO_MOTIVOS_CARREIRA, true)) {
                            $estado = 'recusada';
                            $motivo = mb_substr('Bateu no replay, mas não vale: ' . (DESAFIO_MOTIVOS[$naoCumpre] ?? $naoCumpre), 0, 200, 'UTF-8');
                        }
                    }
                    sql('UPDATE desafio_candidatos SET estado = ?, verificacao = ?, motivo = ?, decidido_em = ?, quem = ? WHERE id = ?',
                        [$estado, json(['ok' => $ok, 'detalhes' => $det, 'em' => gmdate('Y-m-d\TH:i:s\Z'), 'quem' => $quem]),
                            $motivo, dt(time()), $quem, $cid]);
                    return $k + ['_estado' => $estado, '_motivo' => $motivo, '_naoCumpre' => $naoCumpre];
                });
                $feitos[] = ['id' => $cid, 'estado' => $k['_estado'], 'motivo' => $k['_motivo'], 'valeAgora' => !$res['ok'] ? null : ($k['_naoCumpre'] === null
                    ? ['ok' => true, 'motivo' => null, 'texto' => null] : ['ok' => false, 'motivo' => $k['_naoCumpre'], 'texto' => DESAFIO_MOTIVOS[$k['_naoCumpre']] ?? null])];
                registrarAdmin('candidato_verificar', 'desafio:' . $k['desafio_id'], ['candidato' => $cid, 'usuario' => (int) $k['usuario_id'],
                    'carreira' => $k['carreira_pk'] !== null ? (int) $k['carreira_pk'] : null, 'ok' => $res['ok'], 'estado' => $k['_estado']]
                    + ($k['_naoCumpre'] !== null ? ['naoCumpre' => $k['_naoCumpre']] : []));
            }
            responder(200, ['ok' => true, 'candidatos' => $feitos]);

        case 'candidato_recusar':
            $cid = lerIdNumero($j['id'] ?? null, 'Candidato');
            $motivo = lerMotivo($j['motivo'] ?? null, true, 'Escreva o motivo da recusa: o jogador vê no desafio.');
            $quem = admQuem();
            $k = transacao(static function () use ($cid, $motivo, $quem): array {
                $k = umaLinha('SELECT * FROM desafio_candidatos WHERE id = ? FOR UPDATE', [$cid]);
                if ($k === null) {
                    erro(404, 'nao_encontrado', 'Candidato não encontrado.');
                }
                if ($k['estado'] === 'vencedora') {
                    erro(409, 'vencedora', 'Esse candidato já foi declarado vencedor. Reabra o desafio antes de recusar.');
                }
                sql("UPDATE desafio_candidatos SET estado = 'recusada', motivo = ?, decidido_em = ?, quem = ? WHERE id = ?", [$motivo, dt(time()), $quem, $cid]);
                return $k;
            });
            registrarAdmin('candidato_recusar', 'desafio:' . $k['desafio_id'], ['candidato' => $cid, 'usuario' => (int) $k['usuario_id'], 'motivo' => $motivo]);
            responder(200, ['ok' => true, 'estado' => 'recusada']);

        case 'desafio_declarar_vencedor':
            $cid = lerIdNumero($j['candidatoId'] ?? null, 'Candidato');
            $quem = admQuem();
            $r = transacao(static function () use ($cid, $quem): array {
                $k0 = umaLinha('SELECT desafio_id FROM desafio_candidatos WHERE id = ?', [$cid]);
                if ($k0 === null) {
                    erro(404, 'nao_encontrado', 'Candidato não encontrado.');
                }
                // a ordem das travas é sempre desafio → candidato: duas declarações ao mesmo tempo esperam uma pela outra
                $d = desafioOu404((int) $k0['desafio_id'], true);
                $k = umaLinha('SELECT * FROM desafio_candidatos WHERE id = ? FOR UPDATE', [$cid]);
                if (eEmblema($d)) {
                    erro(409, 'emblema', 'Desafio de emblema não tem vencedor: todo mundo que cumprir ganha o emblema.');
                }
                if ($d['vencido_em'] !== null) {
                    erroCom(409, 'ja_tem_vencedor', 'Esse desafio já tem vencedor.', ['candidatoId' => $d['vencedor_candidato'] !== null ? (int) $d['vencedor_candidato'] : null]);
                }
                if ($k === null || $k['estado'] !== 'verificada') {
                    erro(409, 'nao_verificada', 'Só um candidato verificado no jogo pode ser declarado vencedor.');
                }
                $antes = umValor("SELECT id FROM desafio_candidatos WHERE desafio_id = ? AND id <> ? AND estado IN ('pendente', 'verificada')
                    AND (em < ? OR (em = ? AND id < ?)) ORDER BY em, id LIMIT 1", [(int) $d['id'], $cid, $k['em'], $k['em'], $cid]);
                if ($antes !== null) {
                    erroCom(409, 'ha_anterior', 'Há um candidato que cumpriu antes esperando decisão: verifique ou recuse esse primeiro.', ['anterior' => (int) $antes]);
                }
                $u = umaLinha('SELECT * FROM usuarios WHERE id = ? FOR UPDATE', [(int) $k['usuario_id']]);
                if ($u === null) {
                    erro(409, 'conta_excluida', 'A conta desse candidato não existe mais.');
                }
                if (contaSuspensa($u)) {
                    erro(409, 'conta_suspensa', 'A conta desse candidato está suspensa.');
                }
                if ($k['carreira_pk'] !== null && umValor('SELECT 1 FROM carreiras WHERE id = ?', [(int) $k['carreira_pk']]) === null) {
                    erro(409, 'carreira_apagada', 'A carreira desse candidato não existe mais.');
                }
                if (eDeConquistas(criterioDe($d))) {
                    if (!esquemaV34()) {
                        erro(409, 'sem_prova', DESAFIO_SEM_PROVA); // §E
                    }
                    $faltam = faltasProvas((int) $k['usuario_id'])['faltamVerificar']; // v3.4: as 87 provadas e verificadas
                    if ($faltam) {
                        erroCom(409, 'sem_prova', DESAFIO_SEM_PROVA_V34, ['faltam' => $faltam]);
                    }
                }
                // §E: a carreira guardada AGORA cumpre o critério de AGORA, e a conta, todos os requisitos (as mesmas regras de
                // quando o candidato nasceu)? A verificação por replay só prova que a guardada é a do motor
                $falha = motivoCandidato($k, $d, $u);
                if ($falha !== null) {
                    $recusado = in_array($falha, DESAFIO_MOTIVOS_CARREIRA, true) && recusarPeloSistema($cid, $falha, 'Na hora de declarar:');
                    return [$d, $k, $falha, $recusado];
                }
                $t = dt(time());
                sql('UPDATE desafios SET vencedor_usuario_id = ?, vencedor_carreira_pk = ?, vencedor_candidato = ?, vencido_em = ?, atualizado_em = ? WHERE id = ?',
                    [(int) $k['usuario_id'], $k['carreira_pk'], $cid, $t, $t, (int) $d['id']]);
                sql("UPDATE desafio_candidatos SET estado = 'vencedora', decidido_em = ?, quem = ? WHERE id = ?", [$t, $quem, $cid]);
                sql('UPDATE usuarios SET aviso_conta = ?, aviso_conta_em = ? WHERE id = ?', [avisoVencedor($d), $t, (int) $k['usuario_id']]);
                return [$d, $k, null, false];
            });
            [$d, $k, $falha, $recusado] = $r;
            if ($falha !== null) {
                if ($recusado) {
                    registrarAdmin('candidato_recusar', 'desafio:' . $d['id'], ['candidato' => $cid, 'usuario' => (int) $k['usuario_id'],
                        'automatico' => true, 'naoCumpre' => $falha]);
                }
                erroCom(409, 'nao_cumpre', 'Esse candidato não vale agora: ' . (DESAFIO_MOTIVOS[$falha] ?? $falha)
                    . ($recusado ? ' Ele foi recusado (a carreira guardada não cumpre mais o desafio).' : ' Resolva isso (ou recuse o candidato) antes de declarar.'),
                    ['motivo' => $falha, 'recusado' => $recusado]);
            }
            registrarAdmin('desafio_vencedor', 'desafio:' . $d['id'], ['slug' => (string) $d['slug'], 'candidato' => $cid, 'usuario' => (int) $k['usuario_id'],
                'carreira' => $k['carreira_pk'] !== null ? (int) $k['carreira_pk'] : null]);
            responder(200, ['ok' => true, 'desafio' => desafioAdmin(desafioOu404((int) $d['id']))]);

        case 'desafio_reabrir':
            $id = lerIdNumero($j['id'] ?? null, 'Desafio');
            $motivo = lerMotivo($j['motivo'] ?? null, true, 'Escreva por que o desafio volta a não ter vencedor: fica no registro.');
            $k = transacao(static function () use ($id): ?array {
                $d = desafioOu404($id, true);
                if (eEmblema($d)) {
                    erro(409, 'emblema', 'Desafio de emblema não tem vencedor para tirar.');
                }
                if ($d['vencido_em'] === null) {
                    erro(409, 'sem_vencedor', 'Esse desafio não tem vencedor.');
                }
                $k = $d['vencedor_candidato'] !== null ? umaLinha('SELECT * FROM desafio_candidatos WHERE id = ? FOR UPDATE', [(int) $d['vencedor_candidato']]) : null;
                sql('UPDATE desafios SET vencedor_usuario_id = NULL, vencedor_carreira_pk = NULL, vencedor_candidato = NULL, vencido_em = NULL, atualizado_em = ? WHERE id = ?',
                    [dt(time()), $id]);
                if ($k !== null) {
                    sql("UPDATE desafio_candidatos SET estado = 'verificada' WHERE id = ? AND estado = 'vencedora'", [(int) $k['id']]);
                    // o aviso de vencedor ainda não lido some
                    sql('UPDATE usuarios SET aviso_conta = NULL, aviso_conta_em = NULL WHERE id = ? AND aviso_conta = ?', [(int) $k['usuario_id'], avisoVencedor($d)]);
                }
                return $k;
            });
            registrarAdmin('desafio_reabrir', 'desafio:' . $id, ['candidato' => $k !== null ? (int) $k['id'] : null,
                'usuario' => $k !== null ? (int) $k['usuario_id'] : null, 'motivo' => $motivo]);
            responder(200, ['ok' => true, 'desafio' => desafioAdmin(desafioOu404($id))]);
    }
}

/**
 * v3.4: emblema_retirar {id, motivo} (a conta perde o emblema; não volta sozinho) e emblema_devolver {id} (volta a ativo).
 * Poder moderar. Registro: alvo desafio:<id>, com a conta.
 */
function acaoEmblema(string $acao, array $j): never
{
    if (!esquemaV34()) {
        erroInstalar();
    }
    $id = lerIdNumero($j['id'] ?? null, 'Emblema');
    $retirar = $acao === 'emblema_retirar';
    $motivo = $retirar ? lerMotivo($j['motivo'] ?? null, true, 'Escreva por que o emblema sai: o jogador vê.') : lerMotivo($j['motivo'] ?? null, false);
    $quem = admQuem();
    $e = transacao(static function () use ($id, $retirar, $motivo, $quem): array {
        $e = umaLinha('SELECT * FROM emblemas_usuario WHERE id = ? FOR UPDATE', [$id]);
        if ($e === null) {
            erro(404, 'nao_encontrado', 'Emblema não encontrado.');
        }
        if ($retirar && $e['estado'] === 'retirado') {
            erro(409, 'ja_retirado', 'Esse emblema já foi retirado.');
        }
        if (!$retirar && $e['estado'] === 'ativo') {
            erro(409, 'ja_ativo', 'Esse emblema já está com a conta.');
        }
        sql('UPDATE emblemas_usuario SET estado = ?, motivo = ?, retirado_em = ?, quem = ? WHERE id = ?',
            [$retirar ? 'retirado' : 'ativo', $retirar ? $motivo : null, $retirar ? dt(time()) : null, $quem, $id]);
        return $e;
    });
    registrarAdmin($acao, 'desafio:' . $e['desafio_id'], ['emblema' => $id, 'usuario' => (int) $e['usuario_id'],
        'carreira' => $e['carreira_pk'] !== null ? (int) $e['carreira_pk'] : null, 'motivo' => $motivo]);
    responder(200, ['ok' => true, 'emblema' => emblemaAdminPorId($id)]);
}

/** Avalia todas as contas se o desafio está valendo agora. */
function avaliarSeValendo(array $d): int
{
    foreach (desafiosValendo(true) as $v) {
        if ((int) $v['id'] === (int) $d['id']) {
            return avaliarDesafioTodos($v);
        }
    }
    return 0;
}

/** desafio_salvar: cria (sem id; slug novo) ou muda os campos mandados (com id). */
function acaoDesafioSalvar(array $j): never
{
    $id = array_key_exists('id', $j) && $j['id'] !== null ? lerIdNumero($j['id'], 'Desafio') : null;
    $antes = $id !== null ? desafioOu404($id) : null;
    $campos = [];
    if ($antes === null) {
        $slug = $j['slug'] ?? null;
        if (!is_string($slug) || !preg_match(DESAFIO_SLUG_RE, $slug) || str_contains($slug, '--')) {
            erro(400, 'slug', 'O endereço do desafio (slug) tem de 3 a 40 letras minúsculas, números e hífens.');
        }
        $campos['slug'] = $slug;
        foreach (['titulo', 'criterio'] as $k) {
            if (!array_key_exists($k, $j)) {
                erro(400, $k, $k === 'titulo' ? 'Dê um título ao desafio.' : 'Diga o critério do desafio.');
            }
        }
    } elseif (array_key_exists('slug', $j) && $j['slug'] !== $antes['slug']) {
        erro(400, 'slug', 'O endereço do desafio (slug) não muda depois de criado.');
    }
    if (array_key_exists('titulo', $j)) {
        $t = texto($j['titulo'], 200);
        if ($t === null || mb_strlen($t, 'UTF-8') < 3 || mb_strlen($t, 'UTF-8') > 80) {
            erro(400, 'titulo', 'O título tem de 3 a 80 caracteres.');
        }
        $campos['titulo'] = $t;
    }
    if (array_key_exists('descricao', $j)) {
        $t = $j['descricao'] === null ? null : texto($j['descricao'], 1000);
        if ($j['descricao'] !== null && !is_string($j['descricao']) || ($t !== null && mb_strlen($t, 'UTF-8') > 400)) {
            erro(400, 'descricao', 'A descrição pode ter até 400 caracteres.');
        }
        $campos['descricao'] = $t;
    }
    foreach (['regulamento' => 20000, 'premio' => 2000] as $k => $max) {
        if (array_key_exists($k, $j)) {
            if ($j[$k] !== null && !is_string($j[$k])) {
                erro(400, $k, $k === 'premio' ? 'O prêmio é um texto.' : 'O regulamento é um texto.');
            }
            $t = textoLongo($j[$k]);
            if ($t !== null && mb_strlen($t, 'UTF-8') > $max) {
                erro(400, $k, ($k === 'premio' ? 'O prêmio' : 'O regulamento') . ' pode ter até ' . number_format($max, 0, ',', '.') . ' caracteres.');
            }
            $campos[$k] = $k === 'premio' ? ($t ?? '') : $t;
        }
    }
    // v3.4: modo (primeiro | emblema), dificuldade, emblema {icone, cor} e home (a faixa da tela inicial)
    $modo = $antes !== null ? modoDe($antes) : 'primeiro';
    if (array_key_exists('modo', $j)) {
        if (!esquemaV34()) {
            erroInstalar();
        }
        if (!is_string($j['modo']) || !in_array($j['modo'], DESAFIO_MODOS, true)) {
            erro(400, 'modo', 'Modo: primeiro (um vencedor, com o prêmio) ou emblema (todo mundo que cumprir ganha o emblema).');
        }
        if ($antes !== null && $j['modo'] !== $modo && ($antes['vencido_em'] !== null
            || (int) umValor('SELECT COUNT(*) FROM desafio_candidatos WHERE desafio_id = ?', [(int) $antes['id']]) > 0
            || (int) umValor('SELECT COUNT(*) FROM emblemas_usuario WHERE desafio_id = ?', [(int) $antes['id']]) > 0)) {
            erro(409, 'modo_travado', 'O modo não muda depois que alguém virou candidato ou ganhou o emblema (crie outro desafio).');
        }
        $modo = $j['modo'];
        $campos['modo'] = $modo;
    }
    if (array_key_exists('dificuldade', $j)) {
        if (!esquemaV34()) {
            erroInstalar();
        }
        if ($j['dificuldade'] !== null && (!is_string($j['dificuldade']) || !in_array($j['dificuldade'], DESAFIO_DIFICULDADES, true))) {
            erro(400, 'dificuldade', 'Dificuldade: facil, medio, dificil, lendario ou vazio.');
        }
        $campos['dificuldade'] = $j['dificuldade'];
    }
    if (array_key_exists('emblema', $j)) {
        if (!esquemaV34()) {
            erroInstalar();
        }
        $e = lerEmblema($j['emblema']);
        $campos['emblema'] = $e === null ? null : json($e);
    }
    if (array_key_exists('home', $j)) {
        if (!esquemaV34()) {
            erroInstalar();
        }
        if (!is_bool($j['home'])) {
            erro(400, 'home', 'Diga se o desafio aparece na faixa da tela inicial (sim ou não).');
        }
        $campos['home'] = $j['home'] ? 1 : 0;
    }
    if (array_key_exists('criterio', $j)) {
        $c = lerCriterio($j['criterio']);
        if (criterioV34($c) && !esquemaV34()) {
            erroInstalar();
        }
        if ($antes !== null && $antes['vencido_em'] !== null && json($c) !== json(criterioDe($antes))) {
            erro(409, 'vencido', 'O desafio já tem vencedor: o critério não muda mais (reabra antes, se precisar).');
        }
        if ($antes !== null && (int) $antes['ativo'] === 1 && eDeConquistas($c) && !esquemaV34()) {
            erro(409, 'sem_prova', DESAFIO_SEM_PROVA); // §E: um desafio ativo não vira o de todas as conquistas (v3.4: pode)
        }
        $campos['criterio'] = json($c);
    }
    if (array_key_exists('requisitos', $j)) {
        $campos['requisitos'] = json(lerRequisitos($j['requisitos']));
    } elseif ($antes === null) {
        $campos['requisitos'] = json($modo === 'emblema' ? requisitosEmblema() : requisitosPadrao());
    }
    foreach (['inicio' => false, 'fim' => true] as $k => $fimDoDia) {
        if (array_key_exists($k, $j)) {
            $v = lerDataHoraDesafio($j[$k], $fimDoDia);
            if ($v === false) {
                erro(400, 'datas', 'Datas: AAAA-MM-DD (dia em Brasília) ou com hora (ISO), ou vazio.');
            }
            $campos[$k] = $v;
        }
    }
    $ini = array_key_exists('inicio', $campos) ? $campos['inicio'] : ($antes['inicio'] ?? null);
    $fim = array_key_exists('fim', $campos) ? $campos['fim'] : ($antes['fim'] ?? null);
    if ($ini !== null && $fim !== null && (string) $fim <= (string) $ini) {
        erro(400, 'datas', 'O fim do desafio tem de ser depois do início.');
    }
    if (array_key_exists('ordem', $j)) {
        $o = inteiroOuNulo($j['ordem'], 0, 999);
        if ($o === null) {
            erro(400, 'ordem', 'A ordem vai de 0 a 999.');
        }
        $campos['ordem'] = $o;
    }
    if ($antes === null && !array_key_exists('regulamento', $campos)) {
        $campos['regulamento'] = regulamentoPadrao(json_decode($campos['criterio'], true), json_decode($campos['requisitos'], true), $modo);
    }
    $t = dt(time());
    if ($antes === null) {
        $campos += ['descricao' => null, 'premio' => '', 'inicio' => null, 'fim' => null, 'ordem' => 0];
        // v3.4: as colunas novas só entram com o banco da v3.4 (antes, o desafio nasce no modo de sempre)
        $v34 = esquemaV34() ? ['modo' => $modo, 'dificuldade' => $campos['dificuldade'] ?? null,
            'emblema' => $campos['emblema'] ?? ($modo === 'emblema' ? json(DESAFIO_EMBLEMA_PADRAO) : null), 'home' => $campos['home'] ?? 0] : [];
        try {
            sql('INSERT INTO desafios (slug, titulo, descricao, regulamento, premio, criterio, requisitos, ativo, inicio, fim, criado_em, ordem, atualizado_em'
                . ($v34 ? ', ' . implode(', ', array_keys($v34)) : '') . ')
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?' . str_repeat(', ?', count($v34)) . ')', array_merge([$campos['slug'], $campos['titulo'],
                $campos['descricao'], $campos['regulamento'], $campos['premio'], $campos['criterio'], $campos['requisitos'], $campos['inicio'], $campos['fim'], $t,
                $campos['ordem'], $t], array_values($v34)));
        } catch (PDOException $e) {
            if (eChaveDuplicada($e)) {
                erro(409, 'slug_em_uso', 'Já existe um desafio com esse endereço (slug).');
            }
            throw $e;
        }
        $id = (int) bd()->lastInsertId();
    } elseif ($campos) {
        $sets = [];
        $p = [];
        foreach ($campos as $k => $v) {
            $sets[] = "`$k` = ?";
            $p[] = $v;
        }
        sql('UPDATE desafios SET ' . implode(', ', $sets) . ', atualizado_em = ? WHERE id = ?', array_merge($p, [$t, $id]));
    }
    $d = desafioOu404($id);
    $mudouRegra = $antes !== null && array_intersect(array_keys($campos), ['criterio', 'requisitos', 'inicio', 'fim', 'modo']);
    // §E: mudou o critério, os requisitos ou o prazo: os candidatos que já existiam são conferidos com as regras novas (o que
    // não cumpre mais pela carreira é recusado: "O desafio mudou: …"); num desafio valendo, quem passou a cumprir vira
    // candidato agora
    $recusados = $mudouRegra ? reavaliarCandidatosDesafio($d) : 0;
    $novos = $mudouRegra ? avaliarSeValendo($d) : 0;
    registrarAdmin('desafio_salvar', 'desafio:' . $id, ['slug' => (string) $d['slug'], 'novo' => $antes === null, 'campos' => array_keys($campos),
        'candidatosNovos' => $novos] + ($recusados ? ['candidatosRecusados' => $recusados] : []));
    responder($antes === null ? 201 : 200, ['ok' => true, 'desafio' => desafioAdmin(desafioOu404($id)), 'candidatosNovos' => $novos,
        'candidatosRecusados' => $recusados]);
}

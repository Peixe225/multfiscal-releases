<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Teste minha sorte validado no servidor (quando a conta do site é a do servidor): quem sorteia, gera o código do cupom
// e confere o limite é o servidor, nunca o aparelho. Regras (as de fábrica são as de src/dados/sorte.ts, regrasSorte;
// com a loja no servidor, os números vêm do painel, gc_sorte_regras):
// - sem conta: 1 giro por aparelho, pra sempre; o prêmio fica reservado pro aparelho por 24 h, sem código, até a
//   pessoa guardar (criar a conta ou entrar, aí vira cupom);
// - com conta: N giros a cada X dias (dias de calendário de Brasília; de fábrica, 1 a cada 1 dia) por conta, por
//   WhatsApp e por aparelho — em quaisquer X dias seguidos, no máximo N giros; sair, apagar a conta ou entrar em outra
//   não dá giro novo no mesmo aparelho. Bloqueado, libera à meia-noite (Brasília) do dia do giro que segura a janela + X
//   (com N = 1, o mais antigo da janela + X; com X = 1, amanhã). O giro sem conta guardado depois (cliente-guardar,
//   entrar) conta como giro do dia dele: só entra se, com ele, nenhuma janela de X dias da conta (ou do WhatsApp dela)
//   passar de N;
// - todo giro ganha: o sorteio é em dois passos (gc_sortear), entre os prêmios que valem no estado (sem nenhum lá,
//   entre todos os que valem): primeiro a raridade, pela chance dela entre as raridades que têm prêmio (a chance das
//   vazias se reparte entre as outras, na proporção); depois o prêmio, pelo peso dele dentro da raridade.
// O aparelho é um segredo de 32 hex gerado no site (localStorage gc-aparelho): só o hash fica no banco.
// Os prêmios vêm de gc_premios_ativos() (loja.php: os do painel, com a sorte ligada); antes da loja ser montada no
// servidor, da semente gerada de src/dados/sorte.ts (premios-semente.php, premios-sorte.json).

const GC_INTERATIVOS = ['sorte'];
// as regras de fábrica: valem até a loja ir pro servidor; dali em diante, as do painel (Loja → Teste minha sorte)
const GC_SORTE_GIROS_SEM_CONTA = 1;
const GC_SORTE_GIROS_POR_INTERVALO = 1;
const GC_SORTE_INTERVALO_DIAS = 1;
const GC_SORTE_RESERVA = 24 * 3600;
/** As raridades, da mais comum pra mais rara (src/lib/raridade.ts, RARIDADES). */
const GC_RARIDADES = ['comum', 'raro', 'epico', 'lendario'];
/** Os nomes que aparecem (src/lib/raridade.ts, INFO_RARIDADE). */
const GC_NOME_RARIDADE = ['comum' => 'Comum', 'raro' => 'Raro', 'epico' => 'Épico', 'lendario' => 'Lendário'];
/** As chances de fábrica, em % (src/lib/raridade.ts, CHANCES_PADRAO): somam 100 e caem com a raridade. */
const GC_CHANCES_PADRAO = ['comum' => 60, 'raro' => 25, 'epico' => 12, 'lendario' => 3];
/** Simular giros no painel (admin-sorte-simular): de 100 a 10.000 por vez. */
const GC_SIMULAR_MIN = 100;
const GC_SIMULAR_MAX = 10000;
/** Cupons que a conta do aparelho (a do tempo em que tudo ficava no aparelho) traz pro servidor, uma vez por conta. */
const GC_MIGRAR_CUPONS = 2;
/** O alfabeto dos códigos de cupom do site (src/lib/cupom-uso.ts): sem I, L, O, 0, 1, S, 5, Z, 2. */
const GC_ALFABETO_CUPOM = 'ABCDEFGHJKMNPQRTUVWXY346789';
const GC_SORTE_PREFIXO = 'SORTE';

// ─── relógio de Brasília ────────────────────────────────────────────────────────────────────────────────────────

function gc_sp(int $t): DateTimeImmutable
{
    return (new DateTimeImmutable('@' . $t))->setTimezone(new DateTimeZone('America/Sao_Paulo'));
}

/** 'AAAA-MM-DD' no horário de Brasília. */
function gc_dia_sp(int $t): string
{
    return gc_sp($t)->format('Y-m-d');
}

/** 23:59:59 (Brasília) do dia de $t mais $mais dias (a validade do cupom, como fimDoDiaSP do site). */
function gc_fim_do_dia_sp(int $t, int $mais = 0): int
{
    return gc_sp($t)->modify("+$mais days")->setTime(23, 59, 59)->getTimestamp();
}

/** Meia-noite (Brasília) do dia seguinte: quando o giro de amanhã libera. */
function gc_inicio_dia_seguinte_sp(int $t): int
{
    return gc_sp($t)->modify('+1 day')->setTime(0, 0, 0)->getTimestamp();
}

/** Meia-noite (Brasília) do dia 'AAAA-MM-DD'. */
function gc_inicio_do_dia_sp(string $dia): int
{
    return (new DateTimeImmutable($dia . ' 00:00:00', new DateTimeZone('America/Sao_Paulo')))->getTimestamp();
}

/** 'AAAA-MM-DD' → número do dia (dias desde 1970-01-01): a conta da janela de X dias é com ele. */
function gc_dia_num(string $dia): int
{
    return intdiv((new DateTimeImmutable($dia . ' 00:00:00', new DateTimeZone('UTC')))->getTimestamp(), 86400);
}

function gc_dia_de_num(int $n): string
{
    return gmdate('Y-m-d', $n * 86400);
}

/**
 * Com conta: o dia ('AAAA-MM-DD', à meia-noite de Brasília) em que libera o próximo giro, ou null se tá liberado
 * hoje. Em quaisquer X dias seguidos, no máximo N giros: com N ou mais giros entre hoje − X + 1 e hoje, libera no dia
 * do giro que segura a janela (o N-ésimo mais novo) + X — com N = 1, o mais antigo da janela + X. A mesma conta do
 * site (src/lib/frequencia.ts, liberaEm).
 * @param list<string> $dias os dias de giro (um por giro: pode repetir)
 */
function gc_janela_libera(array $dias, string $hoje, int $intervalo, int $porIntervalo): ?string
{
    $h = gc_dia_num($hoje);
    $naJanela = [];
    foreach ($dias as $d) {
        if (is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) === 1 && ($n = gc_dia_num($d)) > $h - $intervalo) {
            $naJanela[] = $n;
        }
    }
    if (count($naJanela) < $porIntervalo) {
        return null;
    }
    sort($naJanela);
    return gc_dia_de_num($naJanela[count($naJanela) - $porIntervalo] + $intervalo);
}

/**
 * O giro do dia $dia cabe na conta? Com ele, nenhuma janela de X dias seguidos que passa por $dia fica com mais de N
 * giros (o giro sem conta guardado depois: cliente-guardar, entrar).
 * @param list<string> $dias os outros dias de giro da conta
 */
function gc_janela_cabe(array $dias, string $dia, int $intervalo, int $porIntervalo): bool
{
    $g = gc_dia_num($dia);
    $nums = array_map('gc_dia_num', array_values(array_filter($dias, static fn ($d): bool => is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) === 1)));
    for ($ini = $g - $intervalo + 1; $ini <= $g; $ini++) {
        $n = count(array_filter($nums, static fn (int $d): bool => $d >= $ini && $d < $ini + $intervalo));
        if ($n + 1 > $porIntervalo) {
            return false;
        }
    }
    return true;
}

/** "por dia" · "a cada 2 dias" · "por semana" · "por mês" (src/lib/frequencia.ts, porPeriodo). */
function gc_sorte_por_periodo(int $intervalo): string
{
    return match ($intervalo) {
        1 => 'por dia',
        7 => 'por semana',
        30 => 'por mês',
        default => "a cada $intervalo dias",
    };
}

/** "1 giro por dia" · "2 giros por semana" · "1 giro a cada 15 dias" (src/lib/frequencia.ts, giroPorPeriodo). */
function gc_sorte_frase(int $intervalo, int $porIntervalo): string
{
    return ($porIntervalo === 1 ? '1 giro' : "$porIntervalo giros") . ' ' . gc_sorte_por_periodo($intervalo);
}

/** "amanhã" · "sábado, 17/10" (src/lib/frequencia.ts, diaQueLibera). */
function gc_sorte_dia_que_libera(string $dia, string $hoje): string
{
    $d = gc_dia_num($dia) - gc_dia_num($hoje);
    if ($d <= 0) {
        return 'hoje';
    }
    if ($d === 1) {
        return 'amanhã';
    }
    $semana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][(int) gmdate('w', gc_dia_num($dia) * 86400)];
    return $semana . ', ' . gmdate('d/m', gc_dia_num($dia) * 86400);
}

function gc_hash_whatsapp(string $w): string
{
    return $w === '' ? '' : hash_hmac('sha256', 'whatsapp|' . $w, gc_sal());
}

function gc_hash_aparelho(?string $token): string
{
    return $token === null ? '' : hash('sha256', 'aparelho|' . $token);
}

/**
 * As regras do giro que valem agora: as do painel (gc_loja_sorte, as mesmas que o site lê no GET loja) quando a loja
 * já está no servidor; senão, as de fábrica. Com conta: `porIntervalo` giros a cada `intervalo` dias. A reserva sem
 * conta em segundos; as chances de cada raridade em %.
 * @return array{semConta: int, porIntervalo: int, intervalo: int, reserva: int, chances: array<string, int|float>}
 */
function gc_sorte_regras(): array
{
    if (function_exists('gc_loja_semeada') && function_exists('gc_loja_sorte') && gc_loja_semeada()) {
        $s = gc_loja_sorte();
        return [
            'semConta' => max(1, $s['girosSemConta']),
            'porIntervalo' => max(1, $s['girosPorIntervalo']),
            'intervalo' => min(30, max(1, $s['intervaloDias'])),
            'reserva' => max(1, $s['reservaSemContaHoras']) * 3600,
            'chances' => $s['chances'],
        ];
    }
    return [
        'semConta' => GC_SORTE_GIROS_SEM_CONTA, 'porIntervalo' => GC_SORTE_GIROS_POR_INTERVALO, 'intervalo' => GC_SORTE_INTERVALO_DIAS,
        'reserva' => GC_SORTE_RESERVA, 'chances' => GC_CHANCES_PADRAO,
    ];
}

/** A raridade do prêmio; sem raridade (os de antes de 11/10) ou com uma que não existe, comum (raridadeDe do site). */
function gc_raridade_de(array $p): string
{
    $r = $p['raridade'] ?? null;
    return is_string($r) && in_array($r, GC_RARIDADES, true) ? $r : 'comum';
}

/**
 * Lê as chances de cada raridade (em %, até 1 casa decimal), ou null se não fecham: as 4 raridades, números de 0 a 100,
 * somando 100, e cada uma menor ou igual à da raridade anterior ("quanto mais raro, menor a chance"). Os erros pra
 * quem chama dizer (loja-validar.php): ['erro' => mensagem, 'raridade' => ?string].
 * @return array{chances: array<string, int|float>|null, erro: string|null, raridade: string|null}
 */
function gc_chances_ler(mixed $v): array
{
    $falha = static fn (string $m, ?string $r = null): array => ['chances' => null, 'erro' => $m, 'raridade' => $r];
    if (!is_array($v) || array_is_list($v) || array_diff(array_keys($v), GC_RARIDADES) !== []) {
        return $falha('Manda a chance das 4 raridades: comum, raro, épico e lendário.');
    }
    $dec = [];
    foreach (GC_RARIDADES as $r) {
        $x = $v[$r] ?? null;
        $nome = GC_NOME_RARIDADE[$r];
        if ((!is_int($x) && !is_float($x)) || !is_finite((float) $x)) {
            return $falha("A chance do $nome tem que ser um número (ex.: 12,5).", $r);
        }
        if ($x < 0 || $x > 100) {
            return $falha("A chance do $nome vai de 0% a 100%.", $r);
        }
        $d = (float) $x * 10;
        if (abs($d - round($d)) > 1e-6) {
            return $falha("A chance do $nome tem até 1 casa depois da vírgula (ex.: 12,5%).", $r);
        }
        $dec[$r] = (int) round($d);
    }
    $soma = array_sum($dec);
    if ($soma !== 1000) {
        $txt = str_replace('.', ',', (string) ($soma / 10));
        return $falha("As 4 chances somam 100% (agora dão $txt%).");
    }
    for ($i = 1; $i < count(GC_RARIDADES); $i++) {
        $r = GC_RARIDADES[$i];
        $antes = GC_RARIDADES[$i - 1];
        if ($dec[$r] > $dec[$antes]) {
            return $falha('Quanto mais raro, menor a chance: ' . GC_NOME_RARIDADE[$r] . ' não pode passar de ' . GC_NOME_RARIDADE[$antes] . '.', $r);
        }
    }
    $out = [];
    foreach ($dec as $r => $d) {
        $out[$r] = $d % 10 === 0 ? intdiv($d, 10) : $d / 10;
    }
    return ['chances' => $out, 'erro' => null, 'raridade' => null];
}

// ─── prêmios ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Prêmios que valem agora no estado (sem nenhum lá, os que valem em qualquer estado). A loja define
 * gc_premios_ativos(?string $uf) (loja.php); sem o módulo dela, vale a semente (carregada só aqui, depois de todos os
 * módulos: a de lá, se existir, ganha). Cada prêmio no formato de src/dados/sorte.ts.
 * @return list<array<string, mixed>>
 */
function gc_premios_do_giro(?string $uf): array
{
    if (!function_exists('gc_premios_ativos')) {
        require_once __DIR__ . '/premios-semente.php';
    }
    $ok = static fn (array $p): bool => isset($p['id'], $p['tipo'], $p['peso'], $p['validadeDias']) && (float) $p['peso'] > 0;
    $lista = array_values(array_filter(gc_premios_ativos($uf), $ok));
    if ($lista === [] && $uf !== null) {
        $lista = array_values(array_filter(gc_premios_ativos(null), $ok));
    }
    return $lista;
}

function gc_premio_por_id(string $id): ?array
{
    foreach (gc_premios_do_giro(null) as $p) {
        if ($p['id'] === $id) {
            return $p;
        }
    }
    return null;
}

/** O peso do prêmio dentro da raridade, em inteiro (1 a 1000; o que veio torto vale 1). */
function gc_peso_de(array $p): int
{
    return max(1, (int) round((float) ($p['peso'] ?? 1)));
}

/**
 * Os dois passos do sorteio, em escala inteira (as chances em décimos de %, o peso inteiro): cada raridade que tem
 * prêmio na lista, com o peso dela no 1º passo e os prêmios dela. As raridades sem prêmio ficam de fora (a chance delas
 * se reparte entre as outras, na proporção). Se nenhuma das que têm prêmio tem chance (todas em 0%), todo giro ainda
 * ganha: os prêmios entram num grupo só, pelo peso. A mesma conta do site e do painel (src/lib/sorteio.ts).
 * @param list<array<string, mixed>> $lista
 * @param array<string, int|float> $chances
 * @return list<array{raridade: string|null, peso: int, premios: list<array<string, mixed>>}>
 */
function gc_sorteio_grupos(array $lista, array $chances): array
{
    $grupos = [];
    foreach (GC_RARIDADES as $r) {
        $premios = array_values(array_filter($lista, static fn (array $p): bool => gc_raridade_de($p) === $r));
        if ($premios !== []) {
            $grupos[] = ['raridade' => $r, 'peso' => max(0, (int) round((float) ($chances[$r] ?? 0) * 10)), 'premios' => $premios];
        }
    }
    if ($grupos !== [] && array_sum(array_column($grupos, 'peso')) === 0) {
        return [['raridade' => null, 'peso' => 1, 'premios' => array_values($lista)]];
    }
    return array_values(array_filter($grupos, static fn (array $g): bool => $g['peso'] > 0));
}

/**
 * Sorteio em dois passos (random_int, sem viés): primeiro a raridade, pela chance dela entre as raridades que têm
 * prêmio na lista; depois o prêmio, pelo peso dentro da raridade. Sem $chances, as que valem agora (gc_sorte_regras).
 * @param list<array<string, mixed>> $lista
 * @param array<string, int|float>|null $chances
 */
function gc_sortear(array $lista, ?array $chances = null): ?array
{
    if ($lista === []) {
        return null;
    }
    $grupos = gc_sorteio_grupos($lista, $chances ?? gc_sorte_regras()['chances']);
    $escolher = static function (array $itens, callable $peso): array {
        $total = 0;
        foreach ($itens as $x) {
            $total += $peso($x);
        }
        $n = random_int(0, $total - 1);
        foreach ($itens as $x) {
            $n -= $peso($x);
            if ($n < 0) {
                return $x;
            }
        }
        return $itens[count($itens) - 1];
    };
    $grupo = $escolher($grupos, static fn (array $g): int => $g['peso']);
    return $escolher($grupo['premios'], 'gc_peso_de');
}

/**
 * A chance de cada prêmio sair (0 a 1), pela mesma conta do sorteio: a da raridade dele (entre as que têm prêmio) vezes
 * o peso dele dentro dela. @param list<array<string, mixed>> $lista @return array<string, float> id → chance
 */
function gc_sorteio_chances(array $lista, array $chances): array
{
    $out = array_fill_keys(array_map(static fn (array $p): string => (string) $p['id'], $lista), 0.0);
    $grupos = gc_sorteio_grupos($lista, $chances);
    $total = array_sum(array_column($grupos, 'peso'));
    foreach ($grupos as $g) {
        $pesos = array_sum(array_map('gc_peso_de', $g['premios']));
        foreach ($g['premios'] as $p) {
            $out[(string) $p['id']] = $g['peso'] / $total * gc_peso_de($p) / $pesos;
        }
    }
    return $out;
}

/** O retrato do prêmio no dia (é ele que vale no cupom, mesmo que o prêmio mude depois), com a raridade daquele dia. */
function gc_retrato(array $p): array
{
    $r = [
        'titulo' => (string) $p['titulo'],
        'regra' => (string) $p['regra'],
        'aplicaA' => (object) array_filter((array) ($p['aplicaA'] ?? []), static fn ($v): bool => is_array($v) && $v !== []),
        'tipo' => (string) $p['tipo'],
        'valor' => $p['valor'],
        'raridade' => gc_raridade_de($p),
    ];
    if (isset($p['comoUsar']) && $p['comoUsar'] !== '') {
        $r['comoUsar'] = (string) $p['comoUsar'];
    }
    return $r;
}

function gc_novo_codigo_cupom(): string
{
    for ($i = 0; $i < 60; $i++) {
        $c = GC_SORTE_PREFIXO . '-';
        for ($j = 0; $j < 4; $j++) {
            $c .= GC_ALFABETO_CUPOM[random_int(0, strlen(GC_ALFABETO_CUPOM) - 1)];
        }
        if (gc_valor('SELECT 1 FROM cupons WHERE codigo = ?', [$c]) === null) {
            return $c;
        }
    }
    throw new RuntimeException('sem código de cupom livre');
}

/** Cria o cupom na conta. @return array<string, mixed> a linha */
function gc_cupom_criar(int $clienteId, string $interativo, array $premio, string $origem, ?string $codigo = null, ?int $ganho = null, ?int $validoAte = null): array
{
    $agora = gc_agora();
    $id = gc_inserir(
        'INSERT INTO cupons (codigo, cliente_id, interativo, premio_id, retrato, demo, origem, ganho_em, valido_ate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            $codigo ?? gc_novo_codigo_cupom(), $clienteId, $interativo, (string) $premio['id'],
            json_encode(gc_retrato($premio), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ($premio['demo'] ?? false) ? 1 : 0, $origem, $ganho ?? $agora, $validoAte ?? gc_fim_do_dia_sp($agora, (int) $premio['validadeDias']),
        ],
    );
    return (array) gc_um('SELECT * FROM cupons WHERE id = ?', [$id]);
}

/** O cupom como o site guarda (Cupom de src/store/conta.ts, datas em ISO). @param array<string, mixed> $k */
function gc_cupom_publico(array $k): array
{
    $retrato = json_decode((string) $k['retrato'], true);
    return [
        'codigo' => (string) $k['codigo'],
        'interativo' => (string) $k['interativo'],
        'premioId' => (string) $k['premio_id'],
        'retrato' => is_array($retrato) ? $retrato : (object) [],
        // a raridade do dia em que saiu (o retrato guarda; cupom de antes da raridade: comum)
        'raridade' => gc_raridade_de(is_array($retrato) ? $retrato : []),
        'demo' => (int) $k['demo'] === 1,
        'origem' => (string) $k['origem'],
        'ganhoEm' => gc_iso((int) $k['ganho_em']),
        'validoAte' => gc_iso((int) $k['valido_ate']),
        'usadoEm' => gc_iso(gc_int_ou_nulo($k['usado_em'])),
    ];
}

// ─── giros ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Dias de giro (um por giro, os 60 mais novos: cobre a janela de até 30 dias) da conta, do WhatsApp dela e do
 * aparelho: o site desenha "giro liberado" ou não com eles (regrasSorte), e o servidor recusa de qualquer jeito.
 * @return list<string>
 */
function gc_giro_dias(string $interativo, ?int $clienteId, string $whatsapp, ?string $aparelho): array
{
    [$onde, $p] = gc_giro_quem($clienteId, $whatsapp, $aparelho);
    if ($onde === '') {
        return [];
    }
    $dias = array_map(static fn (array $l): string => (string) $l['dia'], gc_todos("SELECT dia FROM giros WHERE interativo = ? AND ($onde) ORDER BY dia DESC, id DESC LIMIT 60", [$interativo, ...$p]));
    return array_reverse($dias);
}

/** WHERE de "quem girou": a conta, o WhatsApp ou o aparelho. @return array{0: string, 1: list<mixed>} */
function gc_giro_quem(?int $clienteId, string $whatsapp, ?string $aparelho): array
{
    $partes = [];
    $p = [];
    if ($clienteId !== null) {
        $partes[] = 'cliente_id = ?';
        $p[] = $clienteId;
    }
    if ($whatsapp !== '') {
        $partes[] = 'whatsapp_hash = ?';
        $p[] = gc_hash_whatsapp($whatsapp);
    }
    if ($aparelho !== null) {
        $partes[] = 'aparelho_hash = ?';
        $p[] = gc_hash_aparelho($aparelho);
    }
    return [implode(' OR ', $partes), $p];
}

/**
 * Giro liberado? Mesmo formato do GiroInfo do site (src/lib/conta.ts).
 * @return array<string, mixed>
 */
function gc_giro_info(string $interativo, ?array $cliente, ?string $aparelho): array
{
    $agora = gc_agora();
    $hoje = gc_dia_sp($agora);
    $regras = gc_sorte_regras();
    if ($cliente === null) {
        if ($aparelho === null) {
            return ['disponivel' => true];
        }
        $dias = array_map(static fn (array $l): string => (string) $l['dia'], gc_todos('SELECT dia FROM giros WHERE interativo = ? AND aparelho_hash = ?', [$interativo, gc_hash_aparelho($aparelho)]));
        if (count($dias) >= $regras['semConta']) {
            // girouHoje: o giro deste aparelho ainda conta na janela de quem criar a conta aqui (com X = 1, girou hoje);
            // proximoComConta: quando a conta criada aqui gira (sem ele, gira na hora)
            $janela = gc_dia_num($hoje) - $regras['intervalo'];
            $info = ['disponivel' => false, 'motivo' => 'sem-conta-ja-girou', 'girouHoje' => array_filter($dias, static fn (string $d): bool => gc_dia_num($d) > $janela) !== []];
            $libera = gc_janela_libera($dias, $hoje, $regras['intervalo'], $regras['porIntervalo']);
            if ($libera !== null) {
                $info['proximoComConta'] = gc_iso(gc_inicio_do_dia_sp($libera));
            }
            return $info;
        }
        return ['disponivel' => true];
    }
    // os giros da conta, do WhatsApp dela e do aparelho na janela (hoje e os X − 1 dias antes)
    [$onde, $p] = gc_giro_quem((int) $cliente['id'], (string) $cliente['whatsapp'], $aparelho);
    $desde = gc_dia_de_num(gc_dia_num($hoje) - $regras['intervalo'] + 1);
    $dias = array_map(static fn (array $l): string => (string) $l['dia'], gc_todos("SELECT dia FROM giros WHERE interativo = ? AND dia >= ? AND ($onde)", [$interativo, $desde, ...$p]));
    $libera = gc_janela_libera($dias, $hoje, $regras['intervalo'], $regras['porIntervalo']);
    if ($libera !== null) {
        // o motivo segue 'ja-girou-hoje' (o nome do contrato): com a janela, é "já girou no período"
        return ['disponivel' => false, 'motivo' => 'ja-girou-hoje', 'proximoEm' => gc_iso(gc_inicio_do_dia_sp($libera))];
    }
    return ['disponivel' => true];
}

/** O prêmio reservado pro aparelho (giro sem conta, dentro das 24 h, ainda não guardado). @return array<string, mixed>|null */
function gc_reserva_do_aparelho(string $interativo, ?string $aparelho, bool $vencidaTambem = false): ?array
{
    if ($aparelho === null) {
        return null;
    }
    return gc_um(
        'SELECT * FROM giros WHERE interativo = ? AND aparelho_hash = ? AND cliente_id IS NULL AND cupom_id IS NULL AND reserva_expira IS NOT NULL'
            . ($vencidaTambem ? '' : ' AND reserva_expira > ?') . ' ORDER BY id DESC LIMIT 1',
        $vencidaTambem ? [$interativo, gc_hash_aparelho($aparelho)] : [$interativo, gc_hash_aparelho($aparelho), gc_agora()],
    );
}

/** A reserva como o site guarda (Pendente de src/store/conta.ts). */
function gc_pendente_publico(?array $g): ?array
{
    if ($g === null) {
        return null;
    }
    return ['interativo' => (string) $g['interativo'], 'premioId' => (string) $g['premio_id'], 'sorteadoEm' => gc_iso((int) $g['em']), 'expiraEm' => gc_iso((int) $g['reserva_expira'])];
}

/**
 * Guarda na conta o prêmio que o servidor reservou pro aparelho (quem girou sem conta e agora entrou ou criou). O giro
 * guardado conta como giro do dia dele na conta: só entra se, com ele, nenhuma janela de X dias da conta (ou do
 * WhatsApp dela) passa de N giros (com X = 1 e N = 1: a conta que já girou naquele dia recusa); senão recusa e a
 * reserva fica como está, sem cupom — senão bastava girar sem o cookie num aparelho novo e guardar pra ganhar um giro
 * a mais no período. Dentro da transação de quem chama.
 * @return array{cupom: array<string, mixed>|null, erro: string|null} erro: sem-pendente | pendente-vencido | ja-girou-hoje
 */
function gc_cupom_da_reserva(int $clienteId, string $whatsapp, ?string $aparelho, string $interativo = 'sorte'): array
{
    $g = gc_reserva_do_aparelho($interativo, $aparelho);
    $premio = $g === null ? null : gc_premio_por_id((string) $g['premio_id']);
    if ($g === null || $premio === null) {
        return ['cupom' => null, 'erro' => gc_reserva_do_aparelho($interativo, $aparelho, true) !== null ? 'pendente-vencido' : 'sem-pendente'];
    }
    $regras = gc_sorte_regras();
    $dia = (string) $g['dia'];
    $n = gc_dia_num($dia);
    [$onde, $p] = gc_giro_quem($clienteId, $whatsapp, null);
    $outros = array_map(static fn (array $l): string => (string) $l['dia'], gc_todos(
        "SELECT dia FROM giros WHERE interativo = ? AND dia >= ? AND dia <= ? AND id <> ? AND ($onde)",
        [$interativo, gc_dia_de_num($n - $regras['intervalo'] + 1), gc_dia_de_num($n + $regras['intervalo'] - 1), (int) $g['id'], ...$p],
    ));
    if (!gc_janela_cabe($outros, $dia, $regras['intervalo'], $regras['porIntervalo'])) {
        return ['cupom' => null, 'erro' => 'ja-girou-hoje'];
    }
    $k = gc_cupom_criar($clienteId, $interativo, $premio, 'giro');
    gc_sql('UPDATE giros SET cliente_id = ?, whatsapp_hash = ?, cupom_id = ? WHERE id = ?', [$clienteId, gc_hash_whatsapp($whatsapp), $k['id'], $g['id']]);
    return ['cupom' => $k, 'erro' => null];
}

/** O erro do guardar como a API responde (cliente-guardar): fala do período das regras de agora. */
function gc_erro_guardar(string $erro): ErroApi
{
    $r = gc_sorte_regras();
    $periodo = $r['intervalo'] === 1 ? 'no dia desse giro: o prêmio dele' : 'nesse período: o prêmio desse giro';
    return match ($erro) {
        'ja-girou-hoje' => new ErroApi('ja-girou-hoje', "Tua conta já tinha girado $periodo não entra nela. É " . gc_sorte_frase($r['intervalo'], $r['porIntervalo']) . ' por conta.', 409),
        'pendente-vencido' => new ErroApi('pendente-vencido', 'A reserva desse prêmio venceu.', 409),
        default => new ErroApi('sem-pendente', 'Não tem prêmio reservado neste aparelho.', 409),
    };
}

/**
 * Desde quando a conta do site é a do servidor: a primeira vez que o entrar com código pelo WhatsApp esteve ligado
 * (gravado uma vez, no primeiro GET recursos ou pedido de código com ele ligado). Antes disso, cupom só existia no
 * aparelho; depois, todo cupom nasce no servidor — então a conta do aparelho só traz cupom ganho antes desse dia.
 */
function gc_contas_desde(): int
{
    $v = gc_ajuste('contas_desde');
    if ($v === null || !ctype_digit($v)) {
        $agora = gc_agora();
        gc_sql('INSERT OR IGNORE INTO ajustes (chave, valor, atualizado_em) VALUES (?, ?, ?)', ['contas_desde', (string) $agora, $agora]);
        $v = (string) gc_ajuste('contas_desde');
    }
    return (int) $v;
}

/**
 * Traz pra conta o que o aparelho tinha da conta local (a do tempo em que tudo ficava no aparelho): os cupons que ainda
 * valem (com o retrato do prêmio de hoje, o mesmo código quando está livre), o prêmio reservado sem conta e os dias de
 * giro (que só limitam). Nada disso vem conferido — é o aparelho quem diz —, então os cupons e o prêmio reservado
 * entram uma vez só por conta (clientes.migrado_em), no máximo GC_MIGRAR_CUPONS, só de prêmio que existe, só os ganhos
 * ANTES de a conta do servidor existir (gc_contas_desde: depois disso todo cupom nasce no servidor) e com a validade
 * contada do dia em que foi ganho (um cupom inventado com data velha vence junto com os de verdade). A loja confirma no
 * WhatsApp como sempre. Os dias de giro entram sempre (só restringem). Dentro da transação. @return int quantos cupons
 * entraram
 */
function gc_cliente_migrar(int $clienteId, string $whatsapp, array $m, ?string $aparelho): int
{
    $agora = gc_agora();
    $entraram = 0;
    $jaMigrou = gc_valor('SELECT migrado_em FROM clientes WHERE id = ?', [$clienteId]) !== null;
    $cupons = [];
    if (!$jaMigrou) {
        $desde = gc_contas_desde();
        $ja = (int) gc_valor("SELECT COUNT(*) FROM cupons WHERE cliente_id = ? AND origem = 'aparelho'", [$clienteId]);
        // o prêmio reservado primeiro (é o mais recente); dos cupons, no máximo 10 olhados e GC_MIGRAR_CUPONS entram
        $cupons = is_array($m['cupons'] ?? null) && array_is_list($m['cupons']) ? array_slice($m['cupons'], 0, 10) : [];
        $pend = is_array($m['pendente'] ?? null) ? $m['pendente'] : null;
        if ($pend !== null) {
            array_unshift($cupons, ['pendente' => true] + $pend);
        }
        $ms = static fn (mixed $v): ?int => ($n = gc_inteiro($v, 1, PHP_INT_MAX >> 1)) === null ? null : intdiv($n, 1000);
        foreach ($cupons as $k) {
            if ($ja + $entraram >= GC_MIGRAR_CUPONS || !is_array($k)) {
                break;
            }
            $interativo = $k['interativo'] ?? null;
            $premio = is_string($k['premioId'] ?? null) ? gc_premio_por_id($k['premioId']) : null;
            if (!in_array($interativo, GC_INTERATIVOS, true) || $premio === null || isset($k['usadoEm']) && $k['usadoEm'] !== null) {
                continue;
            }
            if (isset($k['pendente'])) {
                // prêmio reservado sem conta (no aparelho): sorteado antes da conta do servidor existir e ainda nas 24 h
                // dele; vira cupom com a validade a partir de agora
                $sorteado = $ms($k['sorteadoEm'] ?? null);
                $expira = $ms($k['expiraEm'] ?? null);
                if ($sorteado === null || $expira === null || $sorteado >= $desde || $sorteado > $agora || $expira <= $agora || $expira > $sorteado + gc_sorte_regras()['reserva'] + 3600) {
                    continue;
                }
                $validoAte = gc_fim_do_dia_sp($agora, (int) $premio['validadeDias']);
                $codigo = null;
                $ganho = $agora;
            } else {
                $ate = $ms($k['validoAte'] ?? null);
                $ganho = $ms($k['ganhoEm'] ?? null);
                if ($ate === null || $ganho === null || $ganho >= $desde || $ganho > $agora) {
                    continue;
                }
                $validoAte = min($ate, gc_fim_do_dia_sp($ganho, (int) $premio['validadeDias']));
                if ($validoAte <= $agora) {
                    continue;
                }
                $c = is_string($k['codigo'] ?? null) ? strtoupper($k['codigo']) : '';
                $codigo = preg_match('/^' . GC_SORTE_PREFIXO . '-[' . GC_ALFABETO_CUPOM . ']{4}$/', $c) === 1 && gc_valor('SELECT 1 FROM cupons WHERE codigo = ?', [$c]) === null ? $c : null;
            }
            gc_cupom_criar($clienteId, (string) $interativo, $premio, 'aparelho', $codigo, $ganho, $validoAte);
            $entraram++;
        }
        gc_sql('UPDATE clientes SET migrado_em = ? WHERE id = ?', [$agora, $clienteId]);
    }
    // os dias em que o aparelho girou (só restringem: o giro de hoje no aparelho conta como giro de hoje)
    $giros = is_array($m['giros'] ?? null) ? $m['giros'] : [];
    foreach (GC_INTERATIVOS as $interativo) {
        $dias = is_array($giros[$interativo] ?? null) && array_is_list($giros[$interativo]) ? array_slice($giros[$interativo], -30) : [];
        $limite = gc_dia_sp($agora - 30 * 86400);
        foreach (array_unique(array_filter($dias, 'is_string')) as $dia) {
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $dia) !== 1 || $dia < $limite || $dia > gc_dia_sp($agora)) {
                continue;
            }
            [$quem, $pq] = gc_giro_quem($clienteId, '', $aparelho);
            if (gc_valor("SELECT 1 FROM giros WHERE interativo = ? AND dia = ? AND ($quem)", [$interativo, $dia, ...$pq]) === null) {
                gc_sql(
                    "INSERT INTO giros (interativo, dia, em, cliente_id, whatsapp_hash, aparelho_hash, origem) VALUES (?, ?, ?, ?, ?, ?, 'aparelho')",
                    [$interativo, $dia, $agora, $clienteId, gc_hash_whatsapp($whatsapp), gc_hash_aparelho($aparelho)],
                );
            }
        }
    }
    return $entraram;
}

/**
 * A frase do giro recusado, no período das regras de agora: "Teu giro de hoje já foi. Volta amanhã." (1 por dia) ou
 * "Teu giro já foi. O próximo libera sábado, 17/10."; sem conta, "Cria a conta pra girar todo dia" (ou "1 vez por
 * semana"…). @param array<string, mixed> $giro
 */
function gc_sorte_msg_sem_giro(array $giro): string
{
    $r = gc_sorte_regras();
    if (($giro['motivo'] ?? '') === 'ja-girou-hoje') {
        if ($r['intervalo'] === 1 && $r['porIntervalo'] === 1) {
            return 'Teu giro de hoje já foi. Volta amanhã.';
        }
        $ate = is_string($giro['proximoEm'] ?? null) ? strtotime($giro['proximoEm']) : false;
        $dia = $ate === false ? null : gc_sorte_dia_que_libera(gc_dia_sp($ate), gc_dia_sp(gc_agora()));
        $foi = $r['porIntervalo'] === 1 ? 'Teu giro já foi.' : ($r['intervalo'] === 1 ? 'Teus giros de hoje já foram.' : 'Teus giros do período já foram.');
        return $foi . ($dia ? " O próximo libera $dia." : '');
    }
    $quando = $r['intervalo'] === 1 && $r['porIntervalo'] === 1 ? 'todo dia' : ($r['porIntervalo'] === 1 ? '1 vez' : "{$r['porIntervalo']} vezes") . ' ' . gc_sorte_por_periodo($r['intervalo']);
    return "O giro deste aparelho já foi. Cria a conta pra girar $quando.";
}

/**
 * Roda o sorteio de verdade (gc_sortear, o mesmo do giro) $giros vezes na lista, sem gravar nada, e conta o que saiu:
 * por prêmio e por raridade, com o esperado (%) pela mesma conta (gc_sorteio_chances) e o que saiu (vezes e %).
 * @param list<array<string, mixed>> $lista
 * @param array<string, int|float> $chances
 * @return array{premios: list<array<string, mixed>>, raridades: list<array<string, mixed>>}
 */
function gc_sorte_simular(array $lista, array $chances, int $giros): array
{
    $saiu = array_fill_keys(array_map(static fn (array $p): string => (string) $p['id'], $lista), 0);
    for ($i = 0; $i < $giros && $lista !== []; $i++) {
        $p = gc_sortear($lista, $chances);
        $saiu[(string) $p['id']]++;
    }
    $esperado = gc_sorteio_chances($lista, $chances);
    $pct = static fn (float $x): float => round($x * 100, 2);
    $premios = [];
    $raridades = array_fill_keys(GC_RARIDADES, ['esperado' => 0.0, 'saiu' => 0, 'premios' => 0]);
    foreach ($lista as $p) {
        $id = (string) $p['id'];
        $r = gc_raridade_de($p);
        $premios[] = [
            'id' => $id, 'titulo' => (string) ($p['titulo'] ?? ''), 'raridade' => $r, 'peso' => gc_peso_de($p),
            'esperado' => $pct($esperado[$id]), 'saiu' => $saiu[$id], 'saiuPct' => $giros > 0 ? $pct($saiu[$id] / $giros) : 0.0,
        ];
        $raridades[$r]['esperado'] += $esperado[$id];
        $raridades[$r]['saiu'] += $saiu[$id];
        $raridades[$r]['premios']++;
    }
    $porRaridade = [];
    foreach ($raridades as $r => $x) {
        $porRaridade[] = ['raridade' => $r, 'chance' => $chances[$r] ?? 0, 'premios' => $x['premios'], 'esperado' => $pct($x['esperado']), 'saiu' => $x['saiu'], 'saiuPct' => $giros > 0 ? $pct($x['saiu'] / $giros) : 0.0];
    }
    return ['premios' => $premios, 'raridades' => $porRaridade];
}

function gc_interativo_valido(mixed $v): string
{
    return is_string($v) && in_array($v, GC_INTERATIVOS, true) ? $v : throw gc_invalido('interativo', 'Interativo que não existe.');
}

/** GET cliente-giro&interativo=sorte&aparelho=<32 hex>: giro liberado?, o prêmio reservado do aparelho e os dias. */
function gc_rota_cliente_giro(): array
{
    $interativo = gc_interativo_valido($_GET['interativo'] ?? null);
    $aparelho = gc_token_do_aparelho($_GET['aparelho'] ?? null);
    $cli = gc_cliente_logado();
    return [
        'agora' => gc_iso(gc_agora()),
        'giro' => gc_giro_info($interativo, $cli, $aparelho),
        'pendente' => $cli === null ? gc_pendente_publico(gc_reserva_do_aparelho($interativo, $aparelho)) : null,
        'dias' => gc_giro_dias($interativo, $cli === null ? null : (int) $cli['id'], $cli === null ? '' : (string) $cli['whatsapp'], $aparelho),
    ];
}

/**
 * POST cliente-girar { interativo, uf, aparelho }: o servidor sorteia. Com a conta logada, o cupom já nasce guardado
 * (código gerado aqui); sem conta, o prêmio fica reservado pro aparelho por 24 h. Limite também por IP (30 por dia),
 * pra quem troca de aparelho de mentira.
 */
function gc_rota_cliente_girar(): array
{
    gc_conferir_origem();
    $c = gc_corpo('interativo');
    $interativo = gc_interativo_valido($c['interativo'] ?? null);
    $aparelho = gc_token_do_aparelho($c['aparelho'] ?? null) ?? throw gc_invalido('aparelho', 'Recarrega a página e tenta de novo.');
    $uf = gc_uf($c['uf'] ?? null);
    gc_limite('cli-girar-ip', gc_chave_limite('ip', gc_ip()), 30, 86400, GC_MSG_TENTATIVAS_CLIENTE);
    $r = gc_transacao(static function () use ($interativo, $aparelho, $uf): array {
        $agora = gc_agora();
        $cli = gc_cliente_logado();
        $giro = gc_giro_info($interativo, $cli, $aparelho);
        if (!$giro['disponivel']) {
            return ['erro' => new ErroApi('sem-giro', gc_sorte_msg_sem_giro($giro), 409, ['giro' => $giro])];
        }
        $premio = gc_sortear(gc_premios_do_giro($uf));
        if ($premio === null) {
            return ['erro' => new ErroApi('sem-premio', 'Sem prêmio pra sortear agora.', 409)];
        }
        $cupom = null;
        $reserva = null;
        if ($cli !== null) {
            $cupom = gc_cupom_criar((int) $cli['id'], $interativo, $premio, 'giro');
        } else {
            $reserva = $agora + gc_sorte_regras()['reserva'];
        }
        $id = gc_inserir(
            'INSERT INTO giros (interativo, dia, em, cliente_id, whatsapp_hash, aparelho_hash, premio_id, uf, reserva_expira, cupom_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $interativo, gc_dia_sp($agora), $agora, $cli === null ? null : (int) $cli['id'], $cli === null ? '' : gc_hash_whatsapp((string) $cli['whatsapp']),
                gc_hash_aparelho($aparelho), (string) $premio['id'], $uf ?? '', $reserva, $cupom === null ? null : (int) $cupom['id'],
            ],
        );
        if (random_int(1, 50) === 1) {
            // o registro dos giros não cresce sem fim (o limite olha o dia; o "1 sem conta" do aparelho, os 60 dias)
            gc_sql('DELETE FROM giros WHERE em < ? AND cupom_id IS NULL', [$agora - 60 * 86400]);
            gc_sql("UPDATE giros SET whatsapp_hash = '' WHERE em < ? AND cliente_id IS NULL", [$agora - 2 * 86400]);
        }
        return ['ok' => [
            'agora' => gc_iso($agora),
            'premioId' => (string) $premio['id'],
            'cupom' => $cupom === null ? null : gc_cupom_publico($cupom),
            'pendente' => $reserva === null ? null : gc_pendente_publico((array) gc_um('SELECT * FROM giros WHERE id = ?', [$id])),
            'dias' => gc_giro_dias($interativo, $cli === null ? null : (int) $cli['id'], $cli === null ? '' : (string) $cli['whatsapp'], $aparelho),
        ]];
    });
    if (isset($r['erro'])) {
        throw $r['erro'];
    }
    return $r['ok'];
}

/**
 * POST cliente-guardar { interativo, aparelho }: guarda na conta o prêmio que o aparelho tinha reservado (409
 * ja-girou-hoje quando a conta já girou no dia daquele giro; a reserva fica).
 */
function gc_rota_cliente_guardar(): array
{
    $cli = gc_exigir_cliente();
    $c = gc_corpo('interativo');
    $interativo = gc_interativo_valido($c['interativo'] ?? null);
    $aparelho = gc_token_do_aparelho($c['aparelho'] ?? null) ?? throw gc_invalido('aparelho', 'Recarrega a página e tenta de novo.');
    $r = gc_transacao(static function () use ($cli, $interativo, $aparelho): array {
        $g = gc_cupom_da_reserva((int) $cli['id'], (string) $cli['whatsapp'], $aparelho, $interativo);
        return $g['cupom'] !== null ? ['ok' => ['cupom' => gc_cupom_publico($g['cupom'])]] : ['erro' => gc_erro_guardar((string) $g['erro'])];
    });
    if (isset($r['erro'])) {
        throw $r['erro'];
    }
    return $r['ok'];
}

/**
 * POST cliente-cupom-usar { codigo }: o cupom foi no pedido (o "Mandei" do pedido guiado). A loja confirma no WhatsApp
 * e pode desfazer no painel (Clientes).
 */
function gc_rota_cliente_cupom_usar(): array
{
    $cli = gc_exigir_cliente();
    $c = gc_corpo('codigo');
    $codigo = is_string($c['codigo'] ?? null) ? strtoupper(trim($c['codigo'])) : '';
    return gc_transacao(static function () use ($cli, $codigo): array {
        $k = gc_um('SELECT * FROM cupons WHERE codigo = ? AND cliente_id = ?', [$codigo, $cli['id']]);
        if ($k === null) {
            throw new ErroApi('nao-encontrado', 'Cupom não encontrado na tua conta.', 404);
        }
        if ($k['usado_em'] !== null) {
            throw new ErroApi('ja-usado', 'Esse cupom já foi usado.', 409, ['cupom' => gc_cupom_publico($k)]);
        }
        if ((int) $k['valido_ate'] < gc_agora()) {
            throw new ErroApi('vencido', 'Esse cupom venceu.', 409, ['cupom' => gc_cupom_publico($k)]);
        }
        gc_sql("UPDATE cupons SET usado_em = ?, usado_por = 'site' WHERE id = ?", [gc_agora(), $k['id']]);
        return ['cupom' => gc_cupom_publico((array) gc_um('SELECT * FROM cupons WHERE id = ?', [$k['id']]))];
    });
}

<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Teste minha sorte validado no servidor (quando a conta do site é a do servidor): quem sorteia, gera o código do cupom
// e confere o limite é o servidor, nunca o aparelho. Regras (as mesmas de src/dados/sorte.ts, regrasSorte):
// - sem conta: 1 giro por aparelho, pra sempre; o prêmio fica reservado pro aparelho por 24 h, sem código, até a
//   pessoa guardar (criar a conta ou entrar, aí vira cupom);
// - com conta: 1 giro por dia (dia de Brasília) por conta, por WhatsApp e por aparelho — sair, apagar a conta ou
//   entrar em outra não dá giro novo no mesmo aparelho;
// - todo giro ganha: sorteio por peso entre os prêmios que valem no estado (sem nenhum lá, entre todos os que valem).
// O aparelho é um segredo de 32 hex gerado no site (localStorage gc-aparelho): só o hash fica no banco.
// Os prêmios vêm de gc_premios_ativos() (a frente da loja, quando o painel cuidar deles); sem ela, da semente gerada
// de src/dados/sorte.ts (premios-semente.php, premios-sorte.json).

const GC_INTERATIVOS = ['sorte'];
const GC_SORTE_GIROS_SEM_CONTA = 1;
const GC_SORTE_GIROS_POR_DIA = 1;
const GC_SORTE_RESERVA = 24 * 3600;
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

function gc_hash_whatsapp(string $w): string
{
    return $w === '' ? '' : hash_hmac('sha256', 'whatsapp|' . $w, gc_sal());
}

function gc_hash_aparelho(?string $token): string
{
    return $token === null ? '' : hash('sha256', 'aparelho|' . $token);
}

// ─── prêmios ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Prêmios que valem agora no estado (sem nenhum lá, os que valem em qualquer estado). A frente da loja define
 * gc_premios_ativos(?string $uf); enquanto ela não está, vale a semente (carregada só aqui, depois de todos os módulos:
 * a de lá, se existir, ganha). Cada prêmio no formato de src/dados/sorte.ts.
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

/** Sorteio por peso (random_int). @param list<array<string, mixed>> $lista */
function gc_sortear(array $lista): ?array
{
    if ($lista === []) {
        return null;
    }
    $escala = 1000;
    $total = 0;
    foreach ($lista as $p) {
        $total += max(1, (int) round((float) $p['peso'] * $escala));
    }
    $r = random_int(0, $total - 1);
    foreach ($lista as $p) {
        $r -= max(1, (int) round((float) $p['peso'] * $escala));
        if ($r < 0) {
            return $p;
        }
    }
    return $lista[count($lista) - 1];
}

/** O retrato do prêmio no dia (é ele que vale no cupom, mesmo que o prêmio mude depois). */
function gc_retrato(array $p): array
{
    $r = [
        'titulo' => (string) $p['titulo'],
        'regra' => (string) $p['regra'],
        'aplicaA' => (object) array_filter((array) ($p['aplicaA'] ?? []), static fn ($v): bool => is_array($v) && $v !== []),
        'tipo' => (string) $p['tipo'],
        'valor' => $p['valor'],
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
        'demo' => (int) $k['demo'] === 1,
        'origem' => (string) $k['origem'],
        'ganhoEm' => gc_iso((int) $k['ganho_em']),
        'validoAte' => gc_iso((int) $k['valido_ate']),
        'usadoEm' => gc_iso(gc_int_ou_nulo($k['usado_em'])),
    ];
}

// ─── giros ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Dias de giro (os últimos 30) da conta, do WhatsApp dela e do aparelho: o site desenha "giro liberado" ou não com eles
 * (regrasSorte), e o servidor recusa de qualquer jeito.
 * @return list<string>
 */
function gc_giro_dias(string $interativo, ?int $clienteId, string $whatsapp, ?string $aparelho): array
{
    [$onde, $p] = gc_giro_quem($clienteId, $whatsapp, $aparelho);
    if ($onde === '') {
        return [];
    }
    $dias = array_map(static fn (array $l): string => (string) $l['dia'], gc_todos("SELECT dia FROM giros WHERE interativo = ? AND ($onde) ORDER BY dia DESC, id DESC LIMIT 30", [$interativo, ...$p]));
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
    if ($cliente === null) {
        if ($aparelho === null) {
            return ['disponivel' => true];
        }
        $dias = array_map(static fn (array $l): string => (string) $l['dia'], gc_todos('SELECT dia FROM giros WHERE interativo = ? AND aparelho_hash = ?', [$interativo, gc_hash_aparelho($aparelho)]));
        if (count($dias) >= GC_SORTE_GIROS_SEM_CONTA) {
            return ['disponivel' => false, 'motivo' => 'sem-conta-ja-girou', 'girouHoje' => in_array(gc_dia_sp($agora), $dias, true)];
        }
        return ['disponivel' => true];
    }
    [$onde, $p] = gc_giro_quem((int) $cliente['id'], (string) $cliente['whatsapp'], $aparelho);
    $hoje = (int) gc_valor("SELECT COUNT(*) FROM giros WHERE interativo = ? AND dia = ? AND ($onde)", [$interativo, gc_dia_sp($agora), ...$p]);
    if ($hoje >= GC_SORTE_GIROS_POR_DIA) {
        return ['disponivel' => false, 'motivo' => 'ja-girou-hoje', 'proximoEm' => gc_iso(gc_inicio_dia_seguinte_sp($agora))];
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
 * Guarda na conta o prêmio que o servidor reservou pro aparelho (quem girou sem conta e agora entrou ou criou). Dentro
 * da transação de quem chama. @return array<string, mixed>|null o cupom
 */
function gc_cupom_da_reserva(int $clienteId, string $whatsapp, ?string $aparelho, string $interativo = 'sorte'): ?array
{
    $g = gc_reserva_do_aparelho($interativo, $aparelho);
    $premio = $g === null ? null : gc_premio_por_id((string) $g['premio_id']);
    if ($g === null || $premio === null) {
        return null;
    }
    $k = gc_cupom_criar($clienteId, $interativo, $premio, 'giro');
    gc_sql('UPDATE giros SET cliente_id = ?, whatsapp_hash = ?, cupom_id = ? WHERE id = ?', [$clienteId, gc_hash_whatsapp($whatsapp), $k['id'], $g['id']]);
    return $k;
}

/**
 * Traz pra conta o que o aparelho tinha da conta local (a do tempo em que tudo ficava no aparelho): o nome (quem
 * chama usa), os cupons que ainda valem (com o retrato do prêmio de hoje, o mesmo código quando está livre, até 10 por
 * conta), o prêmio reservado sem conta e os dias de giro (que só limitam). Nada disso vem conferido: é o aparelho
 * quem diz — por isso só entra cupom de prêmio que existe, na validade que o prêmio dá, e a loja confirma no WhatsApp
 * como sempre. Dentro da transação. @return int quantos cupons entraram
 */
function gc_cliente_migrar(int $clienteId, string $whatsapp, array $m, ?string $aparelho): int
{
    $agora = gc_agora();
    $entraram = 0;
    $ja = (int) gc_valor("SELECT COUNT(*) FROM cupons WHERE cliente_id = ? AND origem = 'aparelho'", [$clienteId]);
    $cupons = is_array($m['cupons'] ?? null) && array_is_list($m['cupons']) ? array_slice($m['cupons'], 0, 10) : [];
    $pend = is_array($m['pendente'] ?? null) ? $m['pendente'] : null;
    if ($pend !== null) {
        $cupons[] = ['pendente' => true] + $pend;
    }
    foreach ($cupons as $k) {
        if ($ja + $entraram >= 10 || !is_array($k)) {
            break;
        }
        $interativo = $k['interativo'] ?? null;
        $premio = is_string($k['premioId'] ?? null) ? gc_premio_por_id($k['premioId']) : null;
        if (!in_array($interativo, GC_INTERATIVOS, true) || $premio === null || isset($k['usadoEm']) && $k['usadoEm'] !== null) {
            continue;
        }
        $maxValidade = gc_fim_do_dia_sp($agora, (int) $premio['validadeDias']);
        if (isset($k['pendente'])) {
            // prêmio reservado sem conta: vale se ainda está nas 24 h; vira cupom com a validade a partir de agora
            $expira = gc_inteiro($k['expiraEm'] ?? null, 1, PHP_INT_MAX >> 1);
            if ($expira === null || intdiv($expira, 1000) <= $agora || intdiv($expira, 1000) > $agora + GC_SORTE_RESERVA + 3600) {
                continue;
            }
            $validoAte = $maxValidade;
            $codigo = null;
            $ganho = $agora;
        } else {
            $ate = gc_inteiro($k['validoAte'] ?? null, 1, PHP_INT_MAX >> 1);
            if ($ate === null || intdiv($ate, 1000) <= $agora) {
                continue;
            }
            $validoAte = min(intdiv($ate, 1000), $maxValidade);
            $g = gc_inteiro($k['ganhoEm'] ?? null, 1, PHP_INT_MAX >> 1);
            $ganho = $g === null ? $agora : min($agora, intdiv($g, 1000));
            $c = is_string($k['codigo'] ?? null) ? strtoupper($k['codigo']) : '';
            $codigo = preg_match('/^' . GC_SORTE_PREFIXO . '-[' . GC_ALFABETO_CUPOM . ']{4}$/', $c) === 1 && gc_valor('SELECT 1 FROM cupons WHERE codigo = ?', [$c]) === null ? $c : null;
        }
        gc_cupom_criar($clienteId, (string) $interativo, $premio, 'aparelho', $codigo, $ganho, $validoAte);
        $entraram++;
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
            return ['erro' => new ErroApi('sem-giro', $giro['motivo'] === 'ja-girou-hoje' ? 'Teu giro de hoje já foi. Volta amanhã.' : 'O giro deste aparelho já foi. Cria a conta pra girar todo dia.', 409, ['giro' => $giro])];
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
            $reserva = $agora + GC_SORTE_RESERVA;
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

/** POST cliente-guardar { interativo, aparelho }: guarda na conta o prêmio que o aparelho tinha reservado. */
function gc_rota_cliente_guardar(): array
{
    $cli = gc_exigir_cliente();
    $c = gc_corpo('interativo');
    $interativo = gc_interativo_valido($c['interativo'] ?? null);
    $aparelho = gc_token_do_aparelho($c['aparelho'] ?? null) ?? throw gc_invalido('aparelho', 'Recarrega a página e tenta de novo.');
    $r = gc_transacao(static function () use ($cli, $interativo, $aparelho): array {
        $k = gc_cupom_da_reserva((int) $cli['id'], (string) $cli['whatsapp'], $aparelho, $interativo);
        if ($k !== null) {
            return ['ok' => ['cupom' => gc_cupom_publico($k)]];
        }
        return ['erro' => gc_reserva_do_aparelho($interativo, $aparelho, true) !== null
            ? new ErroApi('pendente-vencido', 'A reserva desse prêmio venceu.', 409)
            : new ErroApi('sem-pendente', 'Não tem prêmio reservado neste aparelho.', 409)];
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

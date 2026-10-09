<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Contas dos clientes do site. Entrar = WhatsApp + um código de 6 dígitos que o WhatsApp da loja manda (avisos.php,
// gc_whatsapp_mandar), válido por 10 min; criar conta = o mesmo caminho + o nome. A resposta nunca diz se o número já
// tem conta antes do código certo. Sessão própria no cookie gc_cliente (HttpOnly, SameSite=Lax, Secure no HTTPS),
// 90 dias deslizando, só o hash do token no banco. Sem motor de aviso (ou com o código desligado pelo dono), o site
// segue com a conta só no aparelho: o GET recursos diz qual vale.
// Teste minha sorte no servidor (giro, cupons, reserva do aparelho): sorte.php. Rotas do painel (Clientes): no fim.

const GC_COOKIE_CLIENTE = 'gc_cliente';
const GC_CLIENTE_DURA = 90 * 86400;
const GC_CLIENTE_SESSOES = 10;
const GC_CODIGO_DURA = 600;
const GC_CODIGO_TENTATIVAS = 5;
const GC_CODIGO_PAUSA = 60;
const GC_ENDERECOS_POR_CLIENTE = 5;
const GC_MSG_TENTATIVAS_CLIENTE = 'Muita tentativa seguida. Espera um pouco e tenta de novo.';
/** Os códigos de entrada que valem ao mesmo tempo pro mesmo número (o pedido novo não mata o anterior ainda válido). */
const GC_CODIGOS_VALENDO = 2;
/** Teto de códigos da loja inteira (padrão; o dono muda em Clientes): passou, o entrar com código pausa sozinho. */
const GC_CODIGO_TETO_HORA = 30;
const GC_CODIGO_TETO_DIA = 200;
/** Códigos por hora pedidos da mesma rede (IPv4 /24, IPv6 /48), pra quem troca de IP dentro dela. */
const GC_CODIGO_REDE_HORA = 20;
/** Aparelhos lembrados por conta (os que já entraram: pedir código deles não gasta o limite comum do número). */
const GC_CLIENTE_APARELHOS = 10;

// ─── sessão do cliente ──────────────────────────────────────────────────────────────────────────────────────────

function gc_cliente_cookie(string $valor, int $expira): void
{
    if (headers_sent()) {
        return;
    }
    setcookie(GC_COOKIE_CLIENTE, $valor, [
        'expires' => $expira,
        'path' => gc_caminho_site(),
        'secure' => gc_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

/**
 * O cliente logado neste pedido (cookie gc_cliente válido), ou null. Desliza o prazo (no máximo uma escrita a cada
 * 10 min). $esquecer = a sessão acabou de mudar (entrar, sair, apagar).
 * @return array<string, mixed>|null a linha de clientes + sessao_id
 */
function gc_cliente_logado(bool $esquecer = false, ?array $definir = null): ?array
{
    static $lido = false;
    static $cliente = null;
    if ($esquecer) {
        $lido = $definir !== null;
        $cliente = $definir;
        return $cliente;
    }
    if ($lido) {
        return $cliente;
    }
    $lido = true;
    $token = $_COOKIE[GC_COOKIE_CLIENTE] ?? '';
    if (!is_string($token) || !preg_match('/^[0-9a-f]{64}$/', $token)) {
        if ($token !== '') {
            gc_cliente_cookie('', time() - 86400);
        }
        return null;
    }
    $agora = gc_agora();
    $c = gc_um(
        'SELECT c.*, s.id AS sessao_id, s.visto_em FROM clientes_sessoes s JOIN clientes c ON c.id = s.cliente_id
          WHERE s.token_hash = ? AND s.expira_em > ?',
        [hash('sha256', $token), $agora],
    );
    if ($c === null) {
        gc_cliente_cookie('', time() - 86400);
        return null;
    }
    if ($agora - (int) $c['visto_em'] > 600) {
        gc_sql('UPDATE clientes_sessoes SET visto_em = ?, expira_em = ? WHERE id = ?', [$agora, $agora + GC_CLIENTE_DURA, $c['sessao_id']]);
        gc_sql('UPDATE clientes SET acesso_em = ? WHERE id = ?', [$agora, $c['id']]);
        gc_cliente_cookie($token, time() + GC_CLIENTE_DURA);
    }
    $cliente = $c;
    return $cliente;
}

/** Exige o cliente logado: 401 sem-sessao (o site volta pro "Entrar"). @return array<string, mixed> */
function gc_exigir_cliente(): array
{
    if (gc_metodo() === 'POST') {
        gc_conferir_origem();
    }
    return gc_cliente_logado() ?? throw new ErroApi('sem-sessao', 'Tua sessão acabou. Entra de novo com teu WhatsApp.', 401);
}

/** Sessão nova do cliente (token novo sempre; no máximo 10 por conta: sai a menos usada). */
function gc_cliente_sessao_criar(int $clienteId): void
{
    $agora = gc_agora();
    $antigo = $_COOKIE[GC_COOKIE_CLIENTE] ?? '';
    if (is_string($antigo) && preg_match('/^[0-9a-f]{64}$/', $antigo)) {
        gc_sql('DELETE FROM clientes_sessoes WHERE token_hash = ?', [hash('sha256', $antigo)]);
    }
    $token = bin2hex(random_bytes(32));
    $agente = substr(gc_texto($_SERVER['HTTP_USER_AGENT'] ?? '') ?? '', 0, 200);
    gc_sql(
        'INSERT INTO clientes_sessoes (cliente_id, token_hash, criado_em, visto_em, expira_em, agente) VALUES (?, ?, ?, ?, ?, ?)',
        [$clienteId, hash('sha256', $token), $agora, $agora, $agora + GC_CLIENTE_DURA, $agente],
    );
    gc_sql(
        'DELETE FROM clientes_sessoes WHERE cliente_id = ? AND id NOT IN (SELECT id FROM clientes_sessoes WHERE cliente_id = ? ORDER BY visto_em DESC, id DESC LIMIT ' . GC_CLIENTE_SESSOES . ')',
        [$clienteId, $clienteId],
    );
    gc_sql('DELETE FROM clientes_sessoes WHERE expira_em <= ?', [$agora]);
    gc_sql('UPDATE clientes SET acesso_em = ? WHERE id = ?', [$agora, $clienteId]);
    gc_cliente_cookie($token, time() + GC_CLIENTE_DURA);
    gc_cliente_logado(true, (array) gc_um('SELECT * FROM clientes WHERE id = ?', [$clienteId]));
}

/**
 * Dá pra entrar com o código pelo WhatsApp? (motor de aviso configurado, o dono não desligou em Clientes e a loja não
 * bateu o teto de códigos da hora ou do dia: aí pausa sozinho e cada cliente fica com a conta do aparelho até liberar)
 */
function gc_contas_codigo_ligado(): bool
{
    return gc_instalado() && gc_avisos_situacao()['ligado'] && gc_ajuste('contas_codigo') !== '0' && gc_codigo_teto_situacao()['pausadoAte'] === null;
}

/** O teto de códigos da loja inteira (o dono muda em Clientes). @return array{hora: int, dia: int} */
function gc_codigo_teto(): array
{
    $j = json_decode((string) gc_ajuste('contas_codigo_teto'), true);
    $hora = is_array($j) ? gc_inteiro($j['hora'] ?? null, 1, 1000) : null;
    $dia = is_array($j) ? gc_inteiro($j['dia'] ?? null, 1, 10000) : null;
    return ['hora' => $hora ?? GC_CODIGO_TETO_HORA, 'dia' => $dia ?? GC_CODIGO_TETO_DIA];
}

/**
 * Quantos códigos de entrada a loja mandou na última hora e no último dia e, batido o teto, até quando o entrar com
 * código fica pausado (quando o pedido que passou do teto sai da janela).
 * @return array{hora: int, dia: int, usadosHora: int, usadosDia: int, pausadoAte: string|null}
 */
function gc_codigo_teto_situacao(): array
{
    $t = gc_codigo_teto();
    $agora = gc_agora();
    $chave = gc_chave_limite('loja');
    $usados = static fn (int $janela): int => (int) gc_valor('SELECT COUNT(*) FROM tentativas WHERE tipo = ? AND chave = ? AND em > ?', ['cli-codigo-loja', $chave, $agora - $janela]);
    $volta = static function (int $janela, int $teto, int $n) use ($chave, $agora): int {
        $em = gc_valor(
            'SELECT em FROM tentativas WHERE tipo = ? AND chave = ? AND em > ? ORDER BY em ASC, id ASC LIMIT 1 OFFSET ' . max(0, $n - $teto),
            ['cli-codigo-loja', $chave, $agora - $janela],
        );
        return $em === null ? $agora : (int) $em + $janela;
    };
    $h = $usados(3600);
    $d = $usados(86400);
    $ate = 0;
    if ($h >= $t['hora']) {
        $ate = max($ate, $volta(3600, $t['hora'], $h));
    }
    if ($d >= $t['dia']) {
        $ate = max($ate, $volta(86400, $t['dia'], $d));
    }
    return ['hora' => $t['hora'], 'dia' => $t['dia'], 'usadosHora' => $h, 'usadosDia' => $d, 'pausadoAte' => $ate > $agora ? gc_iso($ate) : null];
}

/**
 * Conta mais um código no teto da loja (depois de todos os outros limites, logo antes de mandar). Quem chega no teto
 * deixa um evento na Atividade (o topo de Clientes mostra a pausa até liberar).
 */
function gc_codigo_teto_gastar(): void
{
    $t = gc_codigo_teto();
    $chave = gc_chave_limite('loja');
    $msg = 'Entrar com código pelo WhatsApp tá pausado agora. Tua conta fica neste aparelho por enquanto.';
    try {
        gc_limite_conferir('cli-codigo-loja', $chave, $t['dia'], 86400, $msg);
        gc_limite('cli-codigo-loja', $chave, $t['hora'], 3600, $msg);
    } catch (ErroApi) {
        throw new ErroApi('sem-codigo', $msg, 409, ['pausado' => true]);
    }
    $sit = gc_codigo_teto_situacao();
    if ($sit['usadosHora'] === $t['hora'] || $sit['usadosDia'] === $t['dia']) {
        gc_evento('site', 'contas-codigo-pausado', 'clientes', ['hora' => $sit['usadosHora'], 'dia' => $sit['usadosDia'], 'ate' => $sit['pausadoAte']]);
    }
}

/**
 * A rede de quem pede, pro limite do código: IPv4 pelo /24, IPv6 pelo /48 (gc_ip já junta o /64; quem aluga um servidor
 * ganha um /48 inteiro e trocaria de /64 à vontade).
 */
function gc_rede_do_ip(string $ip): string
{
    if (preg_match('~^([0-9a-f]{12})[0-9a-f]{4}::/64$~', $ip, $m) === 1) {
        return $m[1] . '::/48';
    }
    $bin = @inet_pton((string) preg_replace('~/\d+$~', '', $ip));
    if (!is_string($bin)) {
        return $ip;
    }
    if (strlen($bin) === 4) {
        return implode('.', array_slice(array_map('ord', str_split($bin)), 0, 3)) . '.0/24';
    }
    return bin2hex(substr($bin, 0, 6)) . '::/48';
}

/** O alvo dos envios de código da conta no histórico dos avisos (sem o número: um hash dele). */
function gc_alvo_conta(string $whatsapp): string
{
    return 'conta:' . substr(hash_hmac('sha256', 'conta|' . $whatsapp, gc_sal()), 0, 24);
}

/** O aparelho já entrou na conta desse número? (o segredo do aparelho só quem tem ele na mão sabe) */
function gc_aparelho_conhecido(string $whatsapp, string $aparelho): bool
{
    return gc_valor(
        'SELECT 1 FROM clientes_aparelhos a JOIN clientes c ON c.id = a.cliente_id WHERE c.whatsapp = ? AND a.aparelho_hash = ?',
        [$whatsapp, gc_hash_aparelho($aparelho)],
    ) !== null;
}

/** Lembra o aparelho em que a conta entrou (os 10 mais recentes). */
function gc_aparelho_lembrar(int $clienteId, ?string $aparelho): void
{
    if ($aparelho === null) {
        return;
    }
    gc_sql(
        'INSERT INTO clientes_aparelhos (cliente_id, aparelho_hash, visto_em) VALUES (?, ?, ?) ON CONFLICT(cliente_id, aparelho_hash) DO UPDATE SET visto_em = excluded.visto_em',
        [$clienteId, gc_hash_aparelho($aparelho), gc_agora()],
    );
    gc_sql(
        'DELETE FROM clientes_aparelhos WHERE cliente_id = ? AND aparelho_hash NOT IN (SELECT aparelho_hash FROM clientes_aparelhos WHERE cliente_id = ? ORDER BY visto_em DESC LIMIT ' . GC_CLIENTE_APARELHOS . ')',
        [$clienteId, $clienteId],
    );
}

/** Os códigos do número que ainda valem (os 2 últimos não usados, no prazo e com tentativa sobrando). @return list<array<string, mixed>> */
function gc_codigos_valendo(string $whatsapp, string $motivo, ?int $clienteId = null): array
{
    $agora = gc_agora();
    $ks = gc_todos(
        'SELECT * FROM clientes_codigos WHERE whatsapp = ? AND motivo = ? AND usado_em IS NULL' . ($clienteId === null ? '' : ' AND cliente_id = ?') . ' ORDER BY id DESC LIMIT ' . GC_CODIGOS_VALENDO,
        $clienteId === null ? [$whatsapp, $motivo] : [$whatsapp, $motivo, $clienteId],
    );
    return array_values(array_filter($ks, static fn (array $k): bool => (int) $k['expira_em'] > $agora && (int) $k['tentativas'] < GC_CODIGO_TENTATIVAS));
}

/** O código certo foi usado: os outros que ainda valiam pro mesmo número e motivo param de valer. */
function gc_codigo_usado(array $k): void
{
    $agora = gc_agora();
    gc_sql('UPDATE clientes_codigos SET usado_em = ? WHERE id = ?', [$agora, $k['id']]);
    gc_sql('UPDATE clientes_codigos SET expira_em = ? WHERE whatsapp = ? AND motivo = ? AND usado_em IS NULL AND expira_em > ?', [$agora, $k['whatsapp'], $k['motivo'], $agora]);
}

/** '(33) 9••••-4567' (o histórico dos avisos e a tela mostram assim). */
function gc_whatsapp_mascarado(string $w): string
{
    $d = substr($w, 2);
    return strlen($d) === 11 ? '(' . substr($d, 0, 2) . ') 9••••-' . substr($d, 7) : '';
}

function gc_hash_codigo(string $whatsapp, string $codigo, string $motivo): string
{
    return hash_hmac('sha256', "$whatsapp|$codigo|$motivo", gc_sal());
}

function gc_cliente_busca(string $nome, string $whatsapp): string
{
    return gc_sem_acento($nome . ' ' . $whatsapp . ' ' . substr($whatsapp, 2));
}

// ─── o que volta pro site ───────────────────────────────────────────────────────────────────────────────────────

/** A conta como o site guarda no cache (datas em ISO). @param array<string, mixed> $c */
function gc_cliente_publico(array $c): array
{
    return [
        'id' => 'c' . $c['id'],
        'nome' => (string) $c['nome'],
        'whatsapp' => (string) $c['whatsapp'],
        'aceitaPromo' => (int) $c['aceita_promo'] === 1,
        'aceitaPromoEm' => gc_iso(gc_int_ou_nulo($c['aceita_promo_em'])),
        'confirmou18Em' => gc_iso((int) $c['confirmou18_em']),
        'criadaEm' => gc_iso((int) $c['criado_em']),
    ];
}

/** @param array<string, mixed> $e */
function gc_endereco_publico(array $e): array
{
    return [
        'id' => (int) $e['id'],
        'apelido' => (string) $e['apelido'],
        'cep' => (string) $e['cep'],
        'rua' => (string) $e['rua'],
        'numero' => (string) $e['numero'],
        'bairro' => (string) $e['bairro'],
        'cidade' => (string) $e['cidade'],
        'uf' => (string) $e['uf'],
        'livre' => (string) $e['livre'],
        'usadoEm' => gc_iso((int) $e['usado_em']),
    ];
}

/** @return list<array<string, mixed>> */
function gc_cliente_enderecos(int $id): array
{
    return array_map('gc_endereco_publico', gc_todos('SELECT * FROM clientes_enderecos WHERE cliente_id = ? ORDER BY usado_em DESC, id DESC', [$id]));
}

/** Tudo que o site guarda da conta (o "eu"). @param array<string, mixed> $c */
function gc_cliente_eu(array $c, ?string $aparelho = null): array
{
    $id = (int) $c['id'];
    return [
        'conta' => gc_cliente_publico($c),
        'cupons' => array_map('gc_cupom_publico', gc_todos('SELECT * FROM cupons WHERE cliente_id = ? ORDER BY id DESC LIMIT 50', [$id])),
        'enderecos' => gc_cliente_enderecos($id),
        'dias' => ['sorte' => gc_giro_dias('sorte', $id, (string) $c['whatsapp'], $aparelho)],
    ];
}

// ─── rotas do site ──────────────────────────────────────────────────────────────────────────────────────────────

/** GET recursos: o que o servidor sabe fazer agora (o site escolhe a conta do servidor ou a do aparelho por aqui). */
function gc_rota_recursos(): array
{
    $ligado = gc_contas_codigo_ligado();
    if ($ligado) {
        gc_contas_desde(); // a primeira vez ligado fica anotada (sorte.php: a conta do aparelho só traz o de antes)
    }
    return [
        'contas' => ['codigo' => $ligado, 'sessao' => gc_cliente_logado() !== null],
    ];
}

/**
 * POST cliente-codigo { whatsapp, motivo?: 'entrar' | 'trocar', aparelho?, site }: manda o código de 6 dígitos pelo
 * WhatsApp da loja, pra QUALQUER número que fecha (a resposta é a mesma com ou sem conta). Limites: 10 por hora por IP e
 * 20 por hora por rede (IPv4 /24, IPv6 /48); 3 em 15 min e 8 por dia por número; 1 por minuto por número; e o teto da
 * loja inteira (30 por hora e 200 por dia, o dono muda em Clientes: batido, o entrar com código pausa sozinho e o site
 * volta pra conta do aparelho até liberar). O pedido novo não mata o código anterior: valem os 2 últimos — assim quem
 * pede código pro número dos outros não trava a dona (o código que chegou pra ela continua valendo; no limite do número,
 * a resposta diz codigoValendo e a tela vai pro passo do código). Do aparelho em que a conta já entrou (aparelho), o
 * limite do número é só dele. 'trocar' (com a sessão): o código vai pro número novo da conta.
 */
function gc_rota_cliente_codigo(): array
{
    gc_conferir_origem();
    $c = gc_corpo('whatsapp');
    $kIp = gc_chave_limite('ip', gc_ip());
    if (array_key_exists('site', $c) && $c['site'] !== null && $c['site'] !== '') {
        gc_limite('cli-codigo-ip', $kIp, 10, 3600, GC_MSG_TENTATIVAS_CLIENTE);
        throw gc_invalido('site', 'Não deu pra mandar o código. Recarrega a página e tenta de novo.');
    }
    if (!gc_contas_codigo_ligado()) {
        $pausado = gc_instalado() && gc_ajuste('contas_codigo') !== '0' && gc_codigo_teto_situacao()['pausadoAte'] !== null;
        throw $pausado
            ? new ErroApi('sem-codigo', 'Entrar com código pelo WhatsApp tá pausado agora. Tua conta fica neste aparelho por enquanto.', 409, ['pausado' => true])
            : new ErroApi('sem-codigo', 'Entrar com código pelo WhatsApp tá desligado agora.', 409);
    }
    gc_contas_desde();
    $motivo = $c['motivo'] ?? 'entrar';
    if (!in_array($motivo, ['entrar', 'trocar'], true)) {
        throw gc_invalido('motivo', 'Pedido de código que não existe.');
    }
    $whats = gc_whatsapp($c['whatsapp'] ?? null) ?? throw gc_invalido('whatsapp', 'Esse WhatsApp não fecha. Põe DDD + 9 dígitos.');
    $cliente = null;
    if ($motivo === 'trocar') {
        $cliente = gc_exigir_cliente();
        if ($whats === $cliente['whatsapp']) {
            throw gc_invalido('whatsapp', 'Esse já é o WhatsApp da tua conta.');
        }
    }
    $agora = gc_agora();
    $aparelho = gc_token_do_aparelho($c['aparelho'] ?? null);
    $conhecido = $motivo === 'entrar' && $aparelho !== null && gc_aparelho_conhecido($whats, $aparelho);
    // o limite do número: o comum (qualquer um gasta) ou, do aparelho em que essa conta já entrou, só o dele
    $kNum = $conhecido ? gc_chave_limite('numero-aparelho', $whats, (string) $aparelho) : gc_chave_limite('numero', $whats);
    $valendo = static fn (): bool => gc_codigos_valendo($whats, $motivo, $cliente === null ? null : (int) $cliente['id']) !== [];
    // um por minuto pro mesmo número (antes dos limites: esperar não gasta tentativa)
    $ultimo = $conhecido
        ? gc_int_ou_nulo(gc_valor('SELECT MAX(em) FROM tentativas WHERE tipo = ? AND chave = ?', ['cli-codigo-num', $kNum]))
        : gc_int_ou_nulo(gc_valor('SELECT MAX(criado_em) FROM clientes_codigos WHERE whatsapp = ?', [$whats]));
    if ($ultimo !== null && $agora - $ultimo < GC_CODIGO_PAUSA) {
        $espera = GC_CODIGO_PAUSA - ($agora - $ultimo);
        throw new ErroApi('muitas-tentativas', 'Acabou de sair um código pra esse número. Espera um pouquinho pra pedir outro.', 429, ['esperaSegundos' => $espera, 'codigoValendo' => $valendo()]);
    }
    gc_limite('cli-codigo-ip', $kIp, 10, 3600, GC_MSG_TENTATIVAS_CLIENTE);
    gc_limite('cli-codigo-rede', gc_chave_limite('rede', gc_rede_do_ip(gc_ip())), GC_CODIGO_REDE_HORA, 3600, GC_MSG_TENTATIVAS_CLIENTE);
    try {
        gc_limite('cli-codigo-num', $kNum, 3, 900, GC_MSG_TENTATIVAS_CLIENTE);
        gc_limite('cli-codigo-dia', $kNum, 8, 86400, 'Esse número já pediu código demais hoje. Tenta de novo amanhã.');
    } catch (ErroApi $e) {
        // o código que já chegou no WhatsApp continua valendo: a tela vai pro passo do código
        throw $e->codigo === 'muitas-tentativas' && $valendo() ? new ErroApi($e->codigo, 'Já tem código valendo pra esse número: usa o último que chegou no WhatsApp.', 429, $e->extra + ['codigoValendo' => true]) : $e;
    }
    gc_codigo_teto_gastar();
    $codigo = sprintf('%06d', random_int(0, 999999));
    $id = gc_transacao(static function () use ($whats, $codigo, $motivo, $cliente, $agora): int {
        // valem os 2 últimos: o de antes do anterior para de valer
        gc_sql(
            'UPDATE clientes_codigos SET expira_em = ? WHERE whatsapp = ? AND motivo = ? AND usado_em IS NULL AND expira_em > ? AND id NOT IN
               (SELECT id FROM clientes_codigos WHERE whatsapp = ? AND motivo = ? AND usado_em IS NULL ORDER BY id DESC LIMIT ' . (GC_CODIGOS_VALENDO - 1) . ')',
            [$agora, $whats, $motivo, $agora, $whats, $motivo],
        );
        $id = gc_inserir(
            'INSERT INTO clientes_codigos (whatsapp, codigo_hash, motivo, cliente_id, criado_em, expira_em) VALUES (?, ?, ?, ?, ?, ?)',
            [$whats, gc_hash_codigo($whats, $codigo, $motivo), $motivo, $cliente === null ? null : (int) $cliente['id'], $agora, $agora + GC_CODIGO_DURA],
        );
        if (random_int(1, 20) === 1) {
            // códigos velhos e o registro dos envios de código (só o número mascarado) não ficam pra sempre
            gc_sql('DELETE FROM clientes_codigos WHERE expira_em < ?', [$agora - 86400]);
            gc_sql("DELETE FROM avisos_envios WHERE tipo = 'codigo-login' AND criado_em < ?", [$agora - 30 * 86400]);
        }
        return $id;
    });
    $texto = $motivo === 'trocar'
        ? "*$codigo* é teu código pra trocar o WhatsApp da tua conta na Green Cheese. Vale por 10 minutos.\n\nNão passa ele pra ninguém: a loja nunca pede esse código."
        : "*$codigo* é teu código pra entrar na Green Cheese. Vale por 10 minutos.\n\nNão passa ele pra ninguém: a loja nunca pede esse código.";
    // fora da transação: a espera do gateway não segura o banco. O histórico guarda só o número mascarado (o inteiro vai
    // só pro gateway) e o alvo é um hash do número (pra apagar junto com a conta)
    $mascarado = gc_whatsapp_mascarado($whats);
    $r = gc_whatsapp_mandar($texto, ['tipo' => 'numero', 'valor' => $whats], 'codigo-login', gc_alvo_conta($whats), 'Código de entrada pra ' . $mascarado, [], 'numero:' . $mascarado);
    if (!$r['ok']) {
        gc_sql('UPDATE clientes_codigos SET expira_em = ? WHERE id = ?', [$agora, $id]);
        gc_log('[cliente-codigo] não saiu: ' . $r['erro']);
        throw new ErroApi('sem-envio', 'Não deu pra mandar o código agora. Tenta de novo daqui a pouco.', 503);
    }
    return [
        'enviado' => true,
        'para' => $mascarado,
        'expiraEm' => gc_iso($agora + GC_CODIGO_DURA),
        'reenviarEm' => gc_iso($agora + GC_CODIGO_PAUSA),
    ];
}

/**
 * Confere o código (dentro de uma transação) contra os que valem pro número (os 2 últimos): devolve a linha do código
 * certo, ou o erro pra lançar FORA da transação (assim a tentativa errada conta mesmo com o erro).
 * @return array{codigo?: array<string, mixed>, erro?: ErroApi}
 */
function gc_conferir_codigo_cliente(string $whats, string $codigo, string $motivo, ?int $clienteId = null): array
{
    $agora = gc_agora();
    $validos = gc_codigos_valendo($whats, $motivo, $clienteId);
    if ($validos === []) {
        return ['erro' => new ErroApi('codigo-vencido', 'Esse código venceu. Pede outro.', 403, ['campo' => 'codigo'])];
    }
    $hash = gc_hash_codigo($whats, $codigo, $motivo);
    foreach ($validos as $k) {
        if (hash_equals((string) $k['codigo_hash'], $hash)) {
            return ['codigo' => $k];
        }
    }
    // errado: o chute conta em todos os que valem (valer 2 ao mesmo tempo não dá chute a mais)
    $restam = 0;
    foreach ($validos as $k) {
        $n = (int) $k['tentativas'] + 1;
        gc_sql('UPDATE clientes_codigos SET tentativas = ?, expira_em = CASE WHEN ? >= ? THEN ? ELSE expira_em END WHERE id = ?', [$n, $n, GC_CODIGO_TENTATIVAS, $agora, $k['id']]);
        $restam = max($restam, GC_CODIGO_TENTATIVAS - $n);
    }
    return ['erro' => $restam === 0
        ? new ErroApi('codigo-vencido', 'Código errado de novo: esse não vale mais. Pede outro.', 403, ['campo' => 'codigo'])
        : new ErroApi('codigo-errado', 'Código errado. Confere no WhatsApp e tenta de novo.', 403, ['campo' => 'codigo', 'restam' => $restam])];
}

function gc_ler_codigo_digitado(mixed $v): string
{
    $c = is_string($v) || is_int($v) ? (string) preg_replace('/\D/', '', (string) $v) : '';
    if (!preg_match('/^\d{6}$/', $c)) {
        throw gc_invalido('codigo', 'O código tem 6 números.');
    }
    return $c;
}

/**
 * POST cliente-entrar { whatsapp, codigo, nome?, aceitaPromo?, aparelho?, migrar? }: código certo → entra (ou cria a
 * conta: com o nome, ou o nome da conta do aparelho em migrar). Sem conta e sem nome: 200 com precisaNome (sem
 * sessão; o código continua valendo e a pessoa manda de novo com o nome: é um passo do caminho, não um erro). Entrar traz junto o que o aparelho tinha (migrar: nome, cupons que ainda valem, prêmio reservado,
 * dias de giro; os cupons só uma vez por conta: sorte.php, gc_cliente_migrar) e guarda o prêmio que o servidor reservou
 * pro aparelho (cupomGuardado), menos quando a conta já girou no dia daquele giro (pendenteRecusado: 'ja-girou-hoje').
 */
function gc_rota_cliente_entrar(): array
{
    gc_conferir_origem();
    $c = gc_corpo('codigo');
    gc_limite('cli-entrar-ip', gc_chave_limite('ip', gc_ip()), 30, 3600, GC_MSG_TENTATIVAS_CLIENTE);
    $whats = gc_whatsapp($c['whatsapp'] ?? null) ?? throw gc_invalido('whatsapp', 'Esse WhatsApp não fecha. Põe DDD + 9 dígitos.');
    $codigo = gc_ler_codigo_digitado($c['codigo'] ?? null);
    $nome = isset($c['nome']) && $c['nome'] !== '' && $c['nome'] !== null ? gc_nome($c['nome']) : null;
    if (array_key_exists('aceitaPromo', $c) && !is_bool($c['aceitaPromo'])) {
        throw gc_invalido('aceitaPromo', 'Promoções é sim ou não.');
    }
    $aceita = ($c['aceitaPromo'] ?? false) === true;
    $aparelho = gc_token_do_aparelho($c['aparelho'] ?? null);
    $migrar = is_array($c['migrar'] ?? null) && !array_is_list($c['migrar']) ? $c['migrar'] : null;
    $nomeAparelho = null;
    if ($migrar !== null && isset($migrar['nome'])) {
        $n = gc_texto($migrar['nome']);
        $nomeAparelho = $n !== null && gc_tamanho($n) >= 2 && gc_tamanho($n) <= 60 ? $n : null;
    }

    $r = gc_transacao(static function () use ($whats, $codigo, $nome, $aceita, $aparelho, $migrar, $nomeAparelho): array {
        $conf = gc_conferir_codigo_cliente($whats, $codigo, 'entrar');
        if (isset($conf['erro'])) {
            return $conf;
        }
        $agora = gc_agora();
        $cli = gc_um('SELECT * FROM clientes WHERE whatsapp = ?', [$whats]);
        $criada = false;
        if ($cli === null) {
            $nomeNovo = $nome ?? $nomeAparelho;
            if ($nomeNovo === null) {
                return ['precisaNome' => true];
            }
            // promoções: o que a pessoa marcou agora; vinda do aparelho, o que ela tinha marcado lá (com a data de lá)
            $promo = $nome !== null ? $aceita : (($migrar['aceitaPromo'] ?? false) === true);
            $promoEm = null;
            if ($promo) {
                $em = $nome === null ? gc_inteiro($migrar['aceitaPromoEm'] ?? null, 1, PHP_INT_MAX >> 1) : null;
                $promoEm = $em !== null && intdiv($em, 1000) <= $agora ? intdiv($em, 1000) : $agora;
            }
            $id = gc_inserir(
                'INSERT INTO clientes (whatsapp, nome, aceita_promo, aceita_promo_em, confirmou18_em, origem, criado_em, atualizado_em, busca) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$whats, $nomeNovo, $promo ? 1 : 0, $promoEm, $agora, $nome === null ? 'aparelho' : 'site', $agora, $agora, gc_cliente_busca($nomeNovo, $whats)],
            );
            $cli = (array) gc_um('SELECT * FROM clientes WHERE id = ?', [$id]);
            $criada = true;
            gc_evento('site', 'cliente-criou-conta', 'cliente:' . $id, ['aparelho' => $nome === null]);
        }
        $id = (int) $cli['id'];
        gc_codigo_usado($conf['codigo']);
        gc_cliente_sessao_criar($id);
        gc_aparelho_lembrar($id, $aparelho);
        $migrados = $migrar !== null ? gc_cliente_migrar($id, $whats, $migrar, $aparelho) : 0;
        $guardar = gc_cupom_da_reserva($id, $whats, $aparelho);
        $cli = (array) gc_um('SELECT * FROM clientes WHERE id = ?', [$id]);
        return [
            'ok' => gc_cliente_eu($cli, $aparelho) + [
                'criada' => $criada,
                'cupomGuardado' => $guardar['cupom'] === null ? null : gc_cupom_publico($guardar['cupom']),
                // o prêmio do giro sem conta não entrou porque a conta já tinha girado naquele dia (a reserva fica)
                'pendenteRecusado' => $guardar['erro'] === 'ja-girou-hoje' ? 'ja-girou-hoje' : null,
                'migrados' => $migrados,
                'pendente' => null,
            ],
        ];
    });
    if (isset($r['erro'])) {
        throw $r['erro'];
    }
    if (isset($r['precisaNome'])) {
        return ['precisaNome' => true, 'campo' => 'nome', 'mensagem' => 'Primeira vez por aqui: põe teu nome pra criar a conta.'];
    }
    return $r['ok'] + ['_status' => $r['ok']['criada'] ? 201 : 200];
}

/** GET cliente-eu[&aparelho=]: a conta, os cupons, os endereços e os dias de giro. */
function gc_rota_cliente_eu(): array
{
    $c = gc_exigir_cliente();
    return ['agora' => gc_iso(gc_agora())] + gc_cliente_eu($c, gc_token_do_aparelho($_GET['aparelho'] ?? null));
}

/**
 * POST cliente-atualizar { nome?, aceitaPromo?, whatsapp?, codigo? }: campo ausente fica. Ligar as promoções grava a
 * data (desligar apaga). Trocar o WhatsApp pede o código que foi pro número novo (cliente-codigo com motivo trocar).
 */
function gc_rota_cliente_atualizar(): array
{
    $cli = gc_exigir_cliente();
    $c = gc_corpo();
    $id = (int) $cli['id'];
    $nome = array_key_exists('nome', $c) ? gc_nome($c['nome']) : (string) $cli['nome'];
    if (array_key_exists('aceitaPromo', $c) && !is_bool($c['aceitaPromo'])) {
        throw gc_invalido('aceitaPromo', 'Promoções é sim ou não.');
    }
    $aceita = array_key_exists('aceitaPromo', $c) ? $c['aceitaPromo'] : (int) $cli['aceita_promo'] === 1;
    $whats = (string) $cli['whatsapp'];
    $novoWhats = null;
    if (array_key_exists('whatsapp', $c)) {
        $w = gc_whatsapp($c['whatsapp']) ?? throw gc_invalido('whatsapp', 'Esse WhatsApp não fecha. Põe DDD + 9 dígitos.');
        if ($w !== $whats) {
            $novoWhats = $w;
            gc_ler_codigo_digitado($c['codigo'] ?? null); // o formato antes de abrir a transação
        }
    }
    $r = gc_transacao(static function () use ($id, $cli, $nome, $aceita, $whats, $novoWhats, $c): array {
        $agora = gc_agora();
        if ($novoWhats !== null) {
            $conf = gc_conferir_codigo_cliente($novoWhats, gc_ler_codigo_digitado($c['codigo'] ?? null), 'trocar', $id);
            if (isset($conf['erro'])) {
                return $conf;
            }
            if (gc_valor('SELECT 1 FROM clientes WHERE whatsapp = ? AND id <> ?', [$novoWhats, $id]) !== null) {
                return ['erro' => new ErroApi('whatsapp-existe', 'Esse WhatsApp já tem outra conta aqui.', 409, ['campo' => 'whatsapp'])];
            }
            gc_codigo_usado($conf['codigo']);
        }
        $w = $novoWhats ?? $whats;
        $promoEm = $aceita ? ((int) $cli['aceita_promo'] === 1 ? gc_int_ou_nulo($cli['aceita_promo_em']) : $agora) : null;
        $mudou = array_keys(array_filter([
            'nome' => $nome !== $cli['nome'], 'promocoes' => $aceita !== ((int) $cli['aceita_promo'] === 1), 'whatsapp' => $novoWhats !== null,
        ]));
        if ($mudou !== []) {
            gc_sql(
                'UPDATE clientes SET nome = ?, whatsapp = ?, aceita_promo = ?, aceita_promo_em = ?, atualizado_em = ?, busca = ? WHERE id = ?',
                [$nome, $w, $aceita ? 1 : 0, $promoEm, $agora, gc_cliente_busca($nome, $w), $id],
            );
            gc_evento('site', 'cliente-atualizou', 'cliente:' . $id, ['campos' => $mudou]);
        }
        return ['ok' => ['conta' => gc_cliente_publico((array) gc_um('SELECT * FROM clientes WHERE id = ?', [$id]))]];
    });
    if (isset($r['erro'])) {
        throw $r['erro'];
    }
    return $r['ok'];
}

/** POST cliente-sair: apaga esta sessão e o cookie (sem sessão também responde 200). */
function gc_rota_cliente_sair(): array
{
    gc_conferir_origem();
    $c = gc_cliente_logado();
    if ($c !== null) {
        gc_sql('DELETE FROM clientes_sessoes WHERE id = ?', [$c['sessao_id']]);
    }
    gc_cliente_cookie('', time() - 86400);
    gc_cliente_logado(true);
    return [];
}

/**
 * Apaga a conta inteira (LGPD): a conta, as sessões, os endereços e os cupons. Os pedidos e as vagas ficam com a loja
 * (sem a ligação com a conta; o painel apaga os dados de cada um). Dos giros fica só o hash do aparelho (e o do
 * WhatsApp, até o dia virar), pro limite de 1 por dia continuar valendo.
 */
function gc_cliente_apagar(int $id, string $origem): void
{
    $c = gc_um('SELECT * FROM clientes WHERE id = ?', [$id]);
    if ($c === null) {
        return;
    }
    $hoje = gc_dia_sp(gc_agora());
    gc_sql("UPDATE giros SET whatsapp_hash = '' WHERE whatsapp_hash = ? AND dia < ?", [gc_hash_whatsapp((string) $c['whatsapp']), $hoje]);
    gc_sql('UPDATE giros SET cliente_id = NULL, cupom_id = NULL WHERE cliente_id = ?', [$id]);
    gc_sql('UPDATE pedidos SET cliente_id = NULL WHERE cliente_id = ?', [$id]);
    gc_sql('UPDATE participacoes SET cliente_id = NULL WHERE cliente_id = ?', [$id]);
    gc_sql('DELETE FROM avisos_envios WHERE alvo = ?', [gc_alvo_conta((string) $c['whatsapp'])]);
    gc_sql('DELETE FROM clientes_codigos WHERE whatsapp = ? OR cliente_id = ?', [$c['whatsapp'], $id]);
    gc_sql('DELETE FROM clientes WHERE id = ?', [$id]);
    gc_evento($origem, 'cliente-conta-apagada', 'cliente:' . $id, []);
}

/** POST cliente-apagar { confirmar: true }: apaga a conta de quem está logado (LGPD) e sai. */
function gc_rota_cliente_apagar(): array
{
    $c = gc_exigir_cliente();
    $corpo = gc_corpo();
    if (($corpo['confirmar'] ?? false) !== true) {
        throw gc_invalido('confirmar', 'Confirma que quer apagar a conta.');
    }
    gc_transacao(static fn () => gc_cliente_apagar((int) $c['id'], 'site'));
    gc_cliente_cookie('', time() - 86400);
    gc_cliente_logado(true);
    return [];
}

/**
 * Pedidos da conta: os ligados a ela (feitos com ela logada) e os do WhatsApp dela quando o número foi CONFERIDO
 * (whatsapp_conferido: veio da conta logada, que entrou pelo código, ou a loja pôs no painel depois de falar na
 * conversa). O número que a pessoa digita no aparelho não liga nada: senão qualquer um punha o número dos outros e o
 * pedido (nome, endereço, a mensagem) aparecia na conta do dono do número. O trocado pelo pedido mudado não entra.
 */
function gc_cliente_pedidos_linhas(array $c, int $limite = 30): array
{
    return gc_todos(
        GC_PEDIDOS_SELECT . " WHERE (p.cliente_id = ? OR (p.whatsapp = ? AND p.whatsapp <> '' AND p.whatsapp_conferido = 1)) AND p.substituido_por_id IS NULL AND p.dados_apagados_em IS NULL
          ORDER BY p.id DESC LIMIT $limite",
        [$c['id'], $c['whatsapp']],
    );
}

/** As vagas de rateio da conta: as feitas com ela logada e as do WhatsApp dela quando ele foi conferido (como os pedidos). */
function gc_cliente_vagas_linhas(array $c, int $limite = 30): array
{
    return gc_todos(
        "SELECT p.*, r.titulo, r.status AS rateio_status FROM participacoes p JOIN rateios r ON r.id = p.rateio_id
          WHERE p.cliente_id = ? OR (p.whatsapp = ? AND p.whatsapp <> '' AND p.whatsapp_conferido = 1) ORDER BY p.id DESC LIMIT $limite",
        [$c['id'], $c['whatsapp']],
    );
}

/**
 * A vaga recém-criada (rateio.php, gc_participacao_criar): a do painel tem o WhatsApp conferido (a loja pôs); a do site
 * com a conta logada fica ligada a ela (e conferida quando o número é o da conta).
 */
function gc_vaga_ligar(int $id, string $origem, string $whatsapp): void
{
    if ($origem === 'painel') {
        gc_sql('UPDATE participacoes SET whatsapp_conferido = 1 WHERE id = ?', [$id]);
        return;
    }
    $c = gc_cliente_logado();
    if ($c !== null) {
        gc_sql('UPDATE participacoes SET cliente_id = ?, whatsapp_conferido = ? WHERE id = ?', [$c['id'], $whatsapp === $c['whatsapp'] ? 1 : 0, $id]);
    }
}

/** A loja trocou o WhatsApp da vaga no painel (o número da conversa): conferido. */
function gc_vaga_whatsapp_conferido(int $id): void
{
    gc_sql('UPDATE participacoes SET whatsapp_conferido = 1 WHERE id = ?', [$id]);
}

/** O pedido como o cliente vê em "Meus pedidos" (sem o que é da loja: anotação, quem mudou o status). */
function gc_pedido_do_cliente(array $p): array
{
    return [
        'codigo' => (string) $p['codigo'],
        'tipo' => (string) $p['tipo'],
        'status' => (string) $p['status'],
        'uf' => (string) $p['uf'],
        'cidade' => (string) $p['cidade'],
        'resumo' => gc_pedido_resumo($p),
        'unidades' => array_sum(array_map(static fn (array $i): int => (int) ($i['qtd'] ?? 0), gc_pedido_itens($p))),
        'subtotalTexto' => (string) $p['subtotal_texto'],
        'criadoEm' => gc_iso((int) $p['criado_em']),
        'atualizadoEm' => gc_iso((int) $p['atualizado_em']),
        'confirmadoEm' => gc_iso(gc_int_ou_nulo($p['confirmado_em'])),
        'saiuEm' => gc_iso(gc_int_ou_nulo($p['saiu_em'])),
        'entregueEm' => gc_iso(gc_int_ou_nulo($p['entregue_em'])),
        'canceladoEm' => gc_iso(gc_int_ou_nulo($p['cancelado_em'])),
    ];
}

/** GET cliente-pedidos: os 30 mais novos. */
function gc_rota_cliente_pedidos(): array
{
    $c = gc_exigir_cliente();
    return ['agora' => gc_iso(gc_agora()), 'pedidos' => array_map('gc_pedido_do_cliente', gc_cliente_pedidos_linhas($c))];
}

/** GET cliente-vagas: as vagas de rateio da conta (gc_cliente_vagas_linhas; sem o token do aparelho: ele é de cada aparelho). */
function gc_rota_cliente_vagas(): array
{
    $c = gc_exigir_cliente();
    gc_vencer_reservas();
    $out = [];
    foreach (gc_cliente_vagas_linhas($c) as $p) {
        $out[] = gc_participacao_publica($p, ['titulo' => $p['titulo'], 'status' => $p['rateio_status']], '');
    }
    return ['agora' => gc_iso(gc_agora()), 'vagas' => $out];
}

/**
 * GET cliente-exportar: todos os dados da conta num arquivo JSON (LGPD, acesso aos dados). Pedido ou vaga achado só
 * pelo número (não foi feito com a conta logada) vai sem o que é da pessoa que pediu (nome, endereço, observação, a
 * mensagem, cidade): o número pode ter sido conferido errado, e esses dados podem ser de outra pessoa.
 */
function gc_rota_cliente_exportar(): array
{
    $c = gc_exigir_cliente();
    $id = (int) $c['id'];
    $pedidos = array_map(static function (array $p) use ($id): array {
        $a = gc_pedido_admin($p);
        unset($a['nota'], $a['statusPor'], $a['proximos'], $a['id'], $a['substitui'], $a['substituidoPor'], $a['dadosApagados']);
        if ((int) ($p['cliente_id'] ?? 0) !== $id) {
            unset($a['nome'], $a['entrega'], $a['observacao'], $a['mensagem'], $a['cidade']);
            if (is_array($a['encomenda'] ?? null)) {
                unset($a['encomenda']['referencia']);
            }
            $a['achadoPeloWhatsapp'] = true;
        }
        return $a;
    }, gc_cliente_pedidos_linhas($c, 500));
    $vagas = [];
    foreach (gc_cliente_vagas_linhas($c, 500) as $p) {
        $v = gc_participacao_publica($p, ['titulo' => $p['titulo'], 'status' => $p['rateio_status']], '');
        unset($v['token']);
        $vagas[] = (int) ($p['cliente_id'] ?? 0) === $id
            ? $v + ['nome' => (string) $p['nome'], 'uf' => (string) $p['uf'], 'cidade' => (string) $p['cidade']]
            : $v + ['uf' => (string) $p['uf'], 'achadaPeloWhatsapp' => true];
    }
    $dados = [
        'loja' => 'Green Cheese Imports',
        'exportadoEm' => gc_iso(gc_agora()),
        'conta' => gc_cliente_publico($c) + ['ultimoAcesso' => gc_iso(gc_int_ou_nulo($c['acesso_em']))],
        'enderecos' => gc_cliente_enderecos($id),
        'cupons' => array_map('gc_cupom_publico', gc_todos('SELECT * FROM cupons WHERE cliente_id = ? ORDER BY id', [$id])),
        'giros' => array_map(static fn (array $g): array => ['dia' => (string) $g['dia'], 'premio' => (string) $g['premio_id']], gc_todos('SELECT dia, premio_id FROM giros WHERE cliente_id = ? ORDER BY id', [$id])),
        'pedidos' => $pedidos,
        'vagasEmRateios' => $vagas,
    ];
    gc_evento('site', 'cliente-exportou', 'cliente:' . $id, []);
    $json = (string) json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_INVALID_UTF8_SUBSTITUTE);
    $dia = (new DateTimeImmutable('@' . gc_agora()))->setTimezone(new DateTimeZone('America/Sao_Paulo'))->format('Y-m-d');
    http_response_code(200);
    gc_cabecalhos('application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="greencheese-meus-dados-' . $dia . '.json"');
    header('Content-Length: ' . strlen($json));
    echo $json;
    exit;
}

/** Lê e confere um endereço. @return array<string, string> colunas */
function gc_ler_endereco(array $c): array
{
    $t = static fn (string $k, int $max): string => mb_substr(gc_texto($c[$k] ?? '') ?? '', 0, $max, 'UTF-8');
    $uf = gc_uf($c['uf'] ?? null) ?? throw gc_invalido('uf', 'Escolhe o estado do endereço.');
    $cep = (string) preg_replace('/\D/', '', is_string($c['cep'] ?? null) ? $c['cep'] : '');
    $col = [
        'apelido' => $t('apelido', 30), 'cep' => $cep, 'rua' => $t('rua', 120), 'numero' => $t('numero', 40), 'bairro' => $t('bairro', 60),
        'cidade' => $t('cidade', 60), 'uf' => $uf, 'livre' => $t('livre', 200),
    ];
    if ($cep !== '') {
        if (strlen($cep) !== 8) {
            throw gc_invalido('cep', 'CEP com 8 números.');
        }
        if (gc_tamanho($col['rua']) < 2) {
            throw gc_invalido('rua', 'Põe a rua.');
        }
        if ($col['numero'] === '') {
            throw gc_invalido('numero', 'Põe o número (e o complemento, se tiver).');
        }
        $col['livre'] = '';
    } elseif (gc_tamanho($col['livre']) < 6) {
        throw gc_invalido('livre', 'Escreve o endereço (rua, número e bairro).');
    } else {
        $col['rua'] = $col['numero'] = $col['bairro'] = '';
    }
    $termo = gc_termo_proibido($col['apelido']);
    if ($termo !== null) {
        throw gc_invalido('apelido', 'Esse nome não dá.');
    }
    return $col;
}

/** Guarda (ou acha o mesmo) endereço na conta; passou de 5, sai o menos usado. */
function gc_cliente_endereco_guardar(int $clienteId, array $col, ?int $id = null): int
{
    $agora = gc_agora();
    if ($id === null) {
        $mesmo = gc_valor(
            'SELECT id FROM clientes_enderecos WHERE cliente_id = ? AND cep = ? AND numero = ? AND livre = ? AND uf = ? ORDER BY id LIMIT 1',
            [$clienteId, $col['cep'], $col['numero'], $col['livre'], $col['uf']],
        );
        $id = $mesmo === null ? null : (int) $mesmo;
    }
    if ($id !== null) {
        $sets = implode(', ', array_map(static fn (string $k): string => "$k = ?", array_keys($col)));
        gc_sql("UPDATE clientes_enderecos SET $sets, usado_em = ? WHERE id = ? AND cliente_id = ?", [...array_values($col), $agora, $id, $clienteId]);
        return $id;
    }
    $nomes = implode(', ', array_keys($col));
    $marcas = implode(', ', array_fill(0, count($col), '?'));
    $novo = gc_inserir("INSERT INTO clientes_enderecos (cliente_id, $nomes, criado_em, usado_em) VALUES (?, $marcas, ?, ?)", [$clienteId, ...array_values($col), $agora, $agora]);
    gc_sql(
        'DELETE FROM clientes_enderecos WHERE cliente_id = ? AND id NOT IN (SELECT id FROM clientes_enderecos WHERE cliente_id = ? ORDER BY usado_em DESC, id DESC LIMIT ' . GC_ENDERECOS_POR_CLIENTE . ')',
        [$clienteId, $clienteId],
    );
    return $novo;
}

/** POST cliente-endereco-salvar { id?, apelido?, cep, rua, numero, bairro, cidade, uf } (ou { livre, uf } sem CEP). */
function gc_rota_cliente_endereco_salvar(): array
{
    $cli = gc_exigir_cliente();
    $c = gc_corpo();
    $col = gc_ler_endereco($c);
    $id = isset($c['id']) && $c['id'] !== null ? gc_inteiro($c['id'], 1, PHP_INT_MAX >> 1) : null;
    return gc_transacao(static function () use ($cli, $col, $id, $c): array {
        if (isset($c['id']) && $c['id'] !== null && ($id === null || gc_valor('SELECT 1 FROM clientes_enderecos WHERE id = ? AND cliente_id = ?', [$id, $cli['id']]) === null)) {
            throw new ErroApi('nao-encontrado', 'Endereço não encontrado.', 404);
        }
        if ($id === null && (int) gc_valor('SELECT COUNT(*) FROM clientes_enderecos WHERE cliente_id = ?', [$cli['id']]) >= GC_ENDERECOS_POR_CLIENTE) {
            throw new ErroApi('limite-enderecos', 'Cabem ' . GC_ENDERECOS_POR_CLIENTE . ' endereços. Apaga um antes de pôr outro.', 409);
        }
        $novo = gc_cliente_endereco_guardar((int) $cli['id'], $col, $id);
        return ['_status' => $id === null ? 201 : 200, 'endereco' => $novo, 'enderecos' => gc_cliente_enderecos((int) $cli['id'])];
    });
}

/** POST cliente-endereco-apagar { id } */
function gc_rota_cliente_endereco_apagar(): array
{
    $cli = gc_exigir_cliente();
    $c = gc_corpo();
    $id = gc_inteiro($c['id'] ?? null, 1, PHP_INT_MAX >> 1);
    if ($id === null || gc_valor('SELECT 1 FROM clientes_enderecos WHERE id = ? AND cliente_id = ?', [$id, $cli['id']]) === null) {
        throw new ErroApi('nao-encontrado', 'Endereço não encontrado.', 404);
    }
    gc_sql('DELETE FROM clientes_enderecos WHERE id = ? AND cliente_id = ?', [$id, $cli['id']]);
    return ['enderecos' => gc_cliente_enderecos((int) $cli['id'])];
}

/**
 * Pedido que chegou com a conta logada (pedido.php chama, dentro da transação do pedido): o endereço vai pra conta (o
 * pedido guiado preenche com ele da próxima vez) e o estado da conta passa a ser o do pedido.
 */
function gc_cliente_pedido_feito(int $clienteId, array $p): void
{
    gc_sql('UPDATE clientes SET uf = ?, atualizado_em = ? WHERE id = ?', [$p['uf'], gc_agora(), $clienteId]);
    if ($p['tipo'] !== 'pedido') {
        return;
    }
    $uf = gc_uf((string) $p['uf_entrega']) ?? (string) $p['uf'];
    if ((string) $p['rua'] !== '' && strlen((string) $p['cep']) === 8) {
        $col = ['apelido' => '', 'cep' => (string) $p['cep'], 'rua' => (string) $p['rua'], 'numero' => (string) $p['numero'], 'bairro' => (string) $p['bairro'], 'cidade' => (string) ($p['cidade_entrega'] !== '' ? $p['cidade_entrega'] : $p['cidade']), 'uf' => $uf, 'livre' => ''];
    } elseif ((string) $p['endereco'] !== '' && gc_tamanho((string) $p['endereco']) >= 6) {
        $col = ['apelido' => '', 'cep' => '', 'rua' => '', 'numero' => '', 'bairro' => '', 'cidade' => (string) $p['cidade'], 'uf' => (string) $p['uf'], 'livre' => mb_substr((string) $p['endereco'], 0, 200, 'UTF-8')];
    } else {
        return;
    }
    // o apelido que a pessoa deu fica (o mesmo endereço só ganha o "usado agora")
    $mesmo = gc_um('SELECT id, apelido FROM clientes_enderecos WHERE cliente_id = ? AND cep = ? AND numero = ? AND livre = ? AND uf = ?', [$clienteId, $col['cep'], $col['numero'], $col['livre'], $col['uf']]);
    if ($mesmo !== null) {
        $col['apelido'] = (string) $mesmo['apelido'];
    }
    gc_cliente_endereco_guardar($clienteId, $col, $mesmo === null ? null : (int) $mesmo['id']);
}

// ─── painel: Clientes ───────────────────────────────────────────────────────────────────────────────────────────

/** Linha da lista do painel. @param array<string, mixed> $c */
function gc_cliente_linha(array $c): array
{
    return [
        'id' => (int) $c['id'],
        'nome' => (string) $c['nome'],
        'whatsapp' => (string) $c['whatsapp'],
        'aceitaPromo' => (int) $c['aceita_promo'] === 1,
        'aceitaPromoEm' => gc_iso(gc_int_ou_nulo($c['aceita_promo_em'])),
        'uf' => (string) $c['uf'],
        'origem' => (string) $c['origem'],
        'criadoEm' => gc_iso((int) $c['criado_em']),
        'acessoEm' => gc_iso(gc_int_ou_nulo($c['acesso_em'])),
        'pedidos' => (int) ($c['n_pedidos'] ?? 0),
        'cuponsAtivos' => (int) ($c['n_cupons'] ?? 0),
    ];
}

/** Situação do entrar com código (o topo da tela Clientes), com o teto de códigos da loja e a pausa dele. */
function gc_clientes_situacao(): array
{
    $av = gc_avisos_situacao();
    return ['ligado' => gc_contas_codigo_ligado(), 'motor' => $av['ligado'], 'desligadoPeloDono' => gc_ajuste('contas_codigo') === '0', 'teto' => gc_codigo_teto_situacao()];
}

const GC_CLIENTES_SELECT = "SELECT c.*,
    (SELECT COUNT(*) FROM pedidos p WHERE p.cliente_id = c.id OR (p.whatsapp = c.whatsapp AND p.whatsapp <> '' AND p.whatsapp_conferido = 1)) AS n_pedidos,
    (SELECT COUNT(*) FROM cupons k WHERE k.cliente_id = c.id AND k.usado_em IS NULL AND k.valido_ate > ?) AS n_cupons
    FROM clientes c";

/** GET admin-clientes[&busca=][&promo=1][&antes=<id>][&limite=50]: o mais novo primeiro. */
function gc_rota_admin_clientes(): array
{
    gc_exigir_dono();
    $agora = gc_agora();
    $busca = gc_texto_curto($_GET['busca'] ?? '', 40);
    $promo = ($_GET['promo'] ?? '') === '1';
    $antes = gc_inteiro($_GET['antes'] ?? null, 1, PHP_INT_MAX >> 1);
    $limite = gc_inteiro($_GET['limite'] ?? null, 1, 100) ?? 50;
    $onde = [];
    $p = [$agora];
    if ($busca !== '') {
        $termo = str_replace(['%', '_', '\\'], '', gc_sem_acento($busca));
        if ($termo !== '') {
            $onde[] = 'c.busca LIKE ?';
            $p[] = '%' . $termo . '%';
        }
    }
    if ($promo) {
        $onde[] = 'c.aceita_promo = 1';
    }
    if ($antes !== null) {
        $onde[] = 'c.id < ?';
        $p[] = $antes;
    }
    $linhas = gc_todos(GC_CLIENTES_SELECT . ($onde ? ' WHERE ' . implode(' AND ', $onde) : '') . ' ORDER BY c.id DESC LIMIT ' . ($limite + 1), $p);
    return [
        'agora' => gc_iso($agora),
        'clientes' => array_map('gc_cliente_linha', array_slice($linhas, 0, $limite)),
        'mais' => count($linhas) > $limite,
        'total' => (int) gc_valor('SELECT COUNT(*) FROM clientes'),
        'comPromo' => (int) gc_valor('SELECT COUNT(*) FROM clientes WHERE aceita_promo = 1'),
        'codigo' => gc_clientes_situacao(),
    ];
}

function gc_cliente_ou_404(mixed $id): array
{
    $n = gc_inteiro($id, 1, PHP_INT_MAX >> 1);
    $c = $n === null ? null : gc_um(GC_CLIENTES_SELECT . ' WHERE c.id = ?', [gc_agora(), $n]);
    if ($c === null) {
        throw new ErroApi('nao-encontrado', 'Cliente não encontrado.', 404);
    }
    return $c;
}

/** GET admin-cliente&id=: a conta, os endereços, os cupons, os pedidos e as vagas de rateio. */
function gc_rota_admin_cliente(): array
{
    gc_exigir_dono();
    $c = gc_cliente_ou_404($_GET['id'] ?? null);
    gc_vencer_reservas();
    return [
        'agora' => gc_iso(gc_agora()),
        'cliente' => gc_cliente_linha($c) + ['confirmou18Em' => gc_iso((int) $c['confirmou18_em'])],
        'enderecos' => gc_cliente_enderecos((int) $c['id']),
        'cupons' => array_map('gc_cupom_publico', gc_todos('SELECT * FROM cupons WHERE cliente_id = ? ORDER BY id DESC LIMIT 50', [$c['id']])),
        'pedidos' => array_map('gc_pedido_linha', gc_cliente_pedidos_linhas($c, 20)),
        'vagas' => array_map(
            static fn (array $p): array => gc_participante_admin($p) + ['rateioTitulo' => (string) $p['titulo']],
            gc_cliente_vagas_linhas($c, 20),
        ),
        'giros' => (int) gc_valor('SELECT COUNT(*) FROM giros WHERE cliente_id = ?', [$c['id']]),
    ];
}

/** GET admin-clientes-csv: quem aceitou receber promoções (nome, WhatsApp, estado e quando aceitou), pro Excel. */
function gc_rota_admin_clientes_csv(): array
{
    gc_exigir_dono();
    $linhas = [['Nome', 'WhatsApp', 'Estado', 'Aceitou promoções em', 'Conta criada em']];
    $n = 0;
    foreach (gc_todos('SELECT * FROM clientes WHERE aceita_promo = 1 ORDER BY aceita_promo_em ASC, id ASC') as $c) {
        $linhas[] = [(string) $c['nome'], gc_whatsapp_formatado((string) $c['whatsapp']), strtoupper((string) $c['uf']), gc_data_sp(gc_int_ou_nulo($c['aceita_promo_em'])), gc_data_sp((int) $c['criado_em'])];
        $n++;
    }
    gc_evento('painel', 'clientes-exportados', 'clientes', ['quantos' => $n]);
    $csv = "\xEF\xBB\xBF";
    foreach ($linhas as $l) {
        $csv .= implode(';', array_map('gc_csv_celula', $l)) . "\r\n";
    }
    $dia = (new DateTimeImmutable('@' . gc_agora()))->setTimezone(new DateTimeZone('America/Sao_Paulo'))->format('Y-m-d');
    http_response_code(200);
    gc_cabecalhos('text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="clientes-promocoes-' . $dia . '.csv"');
    header('Content-Length: ' . strlen($csv));
    echo $csv;
    exit;
}

/** POST admin-cliente-apagar { id }: o pedido de exclusão que chegou pela conversa (LGPD). */
function gc_rota_admin_cliente_apagar(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    $cli = gc_cliente_ou_404($c['id'] ?? null);
    gc_transacao(static fn () => gc_cliente_apagar((int) $cli['id'], 'painel'));
    return [];
}

/**
 * POST admin-clientes-ajustes { codigo?, tetoHora?, tetoDia? }: liga ou desliga o entrar com código pelo WhatsApp e
 * muda o teto de códigos da loja inteira (por hora: 1–1000; por dia: 1–10000, nunca menos que o da hora). Campo
 * ausente fica como está.
 */
function gc_rota_admin_clientes_ajustes(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    if (array_key_exists('codigo', $c) && !is_bool($c['codigo'])) {
        throw gc_invalido('codigo', 'Ligado é sim ou não.');
    }
    $teto = gc_codigo_teto();
    $novoTeto = $teto;
    if (array_key_exists('tetoHora', $c)) {
        $novoTeto['hora'] = gc_inteiro($c['tetoHora'], 1, 1000) ?? throw gc_invalido('tetoHora', 'Por hora: de 1 a 1000 códigos.');
    }
    if (array_key_exists('tetoDia', $c)) {
        $novoTeto['dia'] = gc_inteiro($c['tetoDia'], 1, 10000) ?? throw gc_invalido('tetoDia', 'Por dia: de 1 a 10000 códigos.');
    }
    if ($novoTeto['dia'] < $novoTeto['hora']) {
        throw gc_invalido('tetoDia', 'O teto do dia não pode ser menor que o da hora.');
    }
    if (!array_key_exists('codigo', $c) && $novoTeto === $teto && !array_key_exists('tetoHora', $c) && !array_key_exists('tetoDia', $c)) {
        throw gc_invalido('codigo', 'Nada pra mudar.');
    }
    gc_transacao(static function () use ($c, $teto, $novoTeto): void {
        if (array_key_exists('codigo', $c)) {
            gc_ajuste_definir('contas_codigo', $c['codigo'] ? '1' : '0');
            gc_evento('painel', $c['codigo'] ? 'contas-codigo-ligado' : 'contas-codigo-desligado', 'clientes');
        }
        if ($novoTeto !== $teto) {
            gc_ajuste_definir('contas_codigo_teto', (string) json_encode($novoTeto));
            gc_evento('painel', 'contas-codigo-teto', 'clientes', $novoTeto);
        }
    });
    return ['codigo' => gc_clientes_situacao()];
}

/** POST admin-cupom-usado { codigo, usado }: a loja dá baixa (ou desfaz) num cupom de cliente. */
function gc_rota_admin_cupom_usado(): array
{
    $s = gc_exigir_dono();
    $c = gc_corpo();
    if (!is_bool($c['usado'] ?? null)) {
        throw gc_invalido('usado', 'Usado é sim ou não.');
    }
    $codigo = is_string($c['codigo'] ?? null) ? strtoupper(trim($c['codigo'])) : '';
    return gc_transacao(static function () use ($codigo, $c, $s): array {
        $k = gc_um('SELECT * FROM cupons WHERE codigo = ?', [$codigo]);
        if ($k === null) {
            throw new ErroApi('nao-encontrado', 'Cupom não encontrado.', 404);
        }
        $usado = $c['usado'];
        if (($k['usado_em'] !== null) !== $usado) {
            gc_sql('UPDATE cupons SET usado_em = ?, usado_por = ? WHERE id = ?', [$usado ? gc_agora() : null, $usado ? 'painel:' . $s['login'] : null, $k['id']]);
            gc_evento('painel', $usado ? 'cupom-usado' : 'cupom-desfeito', 'cupom:' . $codigo, []);
        }
        return ['cupom' => gc_cupom_publico((array) gc_um('SELECT * FROM cupons WHERE id = ?', [$k['id']]))];
    });
}

/** Frase da Atividade pras contas dos clientes (sem nome nem WhatsApp: só o número da conta). */
function gc_clientes_evento_texto(string $acao, string $alvo, array $d): ?string
{
    return match ($acao) {
        'cliente-criou-conta' => 'Cliente criou conta no site' . (($d['aparelho'] ?? false) ? ' (trouxe a do aparelho)' : ''),
        'cliente-atualizou' => 'Cliente mudou os dados da conta',
        'cliente-exportou' => 'Cliente baixou os dados dele (LGPD)',
        'cliente-conta-apagada' => 'Conta de cliente apagada (LGPD)',
        'clientes-exportados' => 'Baixou a lista de quem aceitou promoções (' . (int) ($d['quantos'] ?? 0) . ')',
        'contas-codigo-ligado' => 'Ligou o entrar com código pelo WhatsApp',
        'contas-codigo-desligado' => 'Desligou o entrar com código pelo WhatsApp',
        'contas-codigo-teto' => 'Mudou o teto de códigos de entrada (' . (int) ($d['hora'] ?? 0) . ' por hora, ' . (int) ($d['dia'] ?? 0) . ' por dia)',
        'contas-codigo-pausado' => 'O entrar com código pausou sozinho: a loja chegou no teto de códigos (' . (int) ($d['hora'] ?? 0) . ' na última hora, ' . (int) ($d['dia'] ?? 0) . ' no dia)',
        'cupom-usado' => "Deu baixa no cupom $alvo",
        'cupom-desfeito' => "Desfez a baixa do cupom $alvo",
        default => null,
    };
}

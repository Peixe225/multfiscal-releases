<?php
/**
 * LENDA · acesso ao painel do administrador (CONTRATO-v32 §B): contas da equipe, sessões no servidor (revogáveis,
 * 8 h absolutas e 2 h sem uso, token novo a cada etapa), PIN de 6 dígitos, papéis e poderes (um mapa único
 * ação → poder), hierarquia, registro (admin_log com quem e o código do aparelho do dia, nunca o IP) e a presença
 * da equipe. Incluído pelo _lib.php: toda rota tem exigirAdmin(), exigirAdminAcao(), adminAtual() e registrarAdmin().
 * Nunca é servido (o .htaccess nega _*.php e, se ele falhar, a linha abaixo responde 404).
 *
 * Quem entra:
 * - a senha do arquivo de config (admin_senha_hash), sem e-mail: entra na conta "Dono" de emergência
 *   (admin_contas.da_config = 1, criada na primeira entrada; o PIN dela é opcional e, criado, passa a ser pedido);
 * - as contas pessoais (e-mail + senha, da_config = 0), criadas pela própria conta Dono ou por quem cuida da equipe;
 *   o PIN é obrigatório (criado no primeiro acesso);
 * - o token Bearer (admin_token_sha256) dos scripts, que vale como dono (via "token").
 */
declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

const LENDA_PAINEL_SESSAO_S = 8 * 3600;   // prazo absoluto da sessão do painel, contado da entrada
const LENDA_PAINEL_OCIOSO_S = 2 * 3600;   // sem uso por isto, a sessão cai
const LENDA_PAINEL_ETAPA_S = 600;         // a etapa intermediária (PIN, trocar a senha) vence em 10 min
const LENDA_PAINEL_VISTO_S = 60;          // visto_em é atualizado no máximo a cada 60 s
const LENDA_PAINEL_PRESENCA_S = 180;      // "da equipe agora": visto nos últimos 3 min
const LENDA_PIN_TENTATIVAS = 3;           // PIN errado: 3 a cada 10 min por conta
const LENDA_SENHA_MIN = 12;               // senha das contas do painel
const LENDA_NIVEL_DA_CONFIG = 101;        // a conta da senha do arquivo fica acima dos donos pessoais
const LENDA_NIVEL_TOKEN = 1000;           // o Bearer, acima de todos

/** Poderes (a chave é o que o servidor confere; o texto é o que o painel mostra). */
const LENDA_PODERES = [
    'ver' => 'Ver o painel, os números e as listas',
    'moderar' => 'Moderar o Hall público e as denúncias',
    'usuarios' => 'Cuidar das contas dos jogadores (suspender, reativar, anotar, mandar código de troca de senha)',
    'excluir' => 'Excluir contas de jogadores',
    'bonus' => 'Dar e tirar bônus e recusar indicações',
    'config' => 'Mudar as configurações do site',
    'exportar' => 'Baixar CSV e relatórios',
    'equipe' => 'Cuidar da equipe do painel (pessoas, papéis, recados, sessões)',
    'sistema' => 'Saúde do servidor, backup, cópias e restauração',
];

/** Papéis de fábrica (não mudam e não podem ser sobrescritos por um personalizado). */
const LENDA_PAPEIS = [
    'dono' => ['nome' => 'Dono', 'nivel' => 100, 'descricao' => 'Pode tudo: equipe, configurações, backup e restauração.',
        'poderes' => ['ver', 'moderar', 'usuarios', 'excluir', 'bonus', 'config', 'exportar', 'equipe', 'sistema']],
    'moderador' => ['nome' => 'Moderador', 'nivel' => 60, 'descricao' => 'Modera o Hall público e as denúncias.',
        'poderes' => ['ver', 'moderar']],
    'suporte' => ['nome' => 'Suporte', 'nivel' => 40, 'descricao' => 'Atende os jogadores: suspende, reativa, anota e manda o código de troca de senha.',
        'poderes' => ['ver', 'usuarios']],
    'leitor' => ['nome' => 'Leitor', 'nivel' => 20, 'descricao' => 'Só vê os números e as listas.',
        'poderes' => ['ver']],
];

/**
 * O mapa único ação → poder, de todas as ações do admin.php e do equipe.php (POST) e das rotas GET que pedem mais do
 * que "ver". Ação fora do mapa = só quem tem papel de dono (fecha por padrão o que for esquecido).
 */
const PODERES_ACAO = [
    // ver
    'alerta_dispensar' => 'ver', 'alerta_reabrir' => 'ver', 'recado_lido' => 'ver', 'recado_apagar' => 'ver',
    'sessao_encerrar' => 'ver', 'papeis' => 'ver', 'recados' => 'ver',
    // moderar
    'renomear' => 'moderar', 'ocultar_carreira' => 'moderar', 'mostrar_carreira' => 'moderar', 'apagar_carreira' => 'moderar',
    'resolver_denuncia' => 'moderar', 'atualizar_hall' => 'moderar', 'carreiras_lote' => 'moderar',
    'resolver_denuncias_lote' => 'moderar', 'bloquear_hall' => 'moderar', 'restaurar_carreira' => 'moderar',
    'liberar_reenvio' => 'moderar', 'destacar_carreira' => 'moderar',
    // usuarios
    'suspender' => 'usuarios', 'reativar' => 'usuarios', 'deslogar' => 'usuarios', 'nota' => 'usuarios',
    'mudar_tipo' => 'usuarios', 'enviar_redefinicao' => 'usuarios',
    // excluir
    'excluir_usuario' => 'excluir',
    // bonus
    'dar_bonus' => 'bonus', 'tirar_bonus' => 'bonus', 'tirar_bonus_lote' => 'bonus', 'recusar_indicacao' => 'bonus',
    'indicacoes_lote' => 'bonus',
    // config
    'config' => 'config', 'testar_aviso' => 'config',
    // exportar (GET)
    'exportar' => 'exportar', 'relatorio_csv' => 'exportar', 'tempo_csv' => 'exportar',
    // equipe
    'equipe' => 'equipe', 'sessoes' => 'equipe', 'equipe_criar' => 'equipe', 'equipe_papel' => 'equipe',
    'equipe_ativar' => 'equipe', 'equipe_zerar_pin' => 'equipe', 'zerar_pin' => 'equipe', 'equipe_senha' => 'equipe',
    'equipe_excluir' => 'equipe', 'papel_salvar' => 'equipe', 'papel_apagar' => 'equipe', 'recado_criar' => 'equipe',
    // sistema
    'seguranca' => 'sistema', 'saude' => 'sistema', 'backup' => 'sistema', 'copias' => 'sistema', 'copia' => 'sistema',
    'backup_guardar' => 'sistema', 'backup_restaurar' => 'sistema',
];

/** Ações do registro que são de acesso ao painel (bloco Segurança). */
const LENDA_ACOES_SEGURANCA = ['painel_falha', 'painel_limite', 'painel_pin_errado', 'painel_pin_travado', 'negado',
    'minha_senha_falha', 'painel_entrar', 'painel_sair', 'minha_senha', 'sair_todos', 'pin_definido', 'senha_trocada',
    'sessao_encerrar', 'criar_conta', 'etapa_expirou'];
/** Destas, as que o painel pinta de vermelho. */
const LENDA_ACOES_GRAVES = ['painel_falha', 'painel_limite', 'painel_pin_errado', 'painel_pin_travado', 'negado',
    'minha_senha_falha', 'excluir_usuario', 'apagar_carreira', 'equipe_excluir', 'backup_restaurar'];

// ── token Bearer (scripts) ───────────────────────────────────────────────────────────────────────

function cabecalhoAutorizacao(): string
{
    foreach (['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $k) {
        if (!empty($_SERVER[$k]) && is_string($_SERVER[$k])) {
            return $_SERVER[$k];
        }
    }
    if (function_exists('getallheaders')) {
        foreach ((array) getallheaders() as $k => $v) {
            if (is_string($k) && strcasecmp($k, 'Authorization') === 0 && is_string($v)) {
                return $v;
            }
        }
    }
    return '';
}

function tokenAdminValido(): bool
{
    $esperado = strtolower((string) (config()['admin_token_sha256'] ?? ''));
    if (!preg_match('/^[0-9a-f]{64}$/', $esperado)) {
        return false;
    }
    if (!preg_match('/^Bearer\s+(\S{16,256})$/i', trim(cabecalhoAutorizacao()), $m)) {
        return false;
    }
    return hash_equals($esperado, hash('sha256', $m[1]));
}

// ── cookie do painel: <token 43>.<exp>.<hmac> ────────────────────────────────────────────────────

/** Hash da senha do arquivo de config ('' se não há). */
function senhaConfigHash(): string
{
    $h = config()['admin_senha_hash'] ?? '';
    return is_string($h) ? trim($h) : '';
}

/**
 * HMAC do cookie. A chave leva o hash da senha do arquivo: trocar essa senha derruba todas as sessões do painel (a
 * alavanca de emergência de sempre). A etiqueta separa o cookie da sessão pronta ("painel") do da etapa intermediária
 * ("etapa"), que o ?so=eu (sem banco) não aceita.
 */
function assinaturaPainel(string $token, string $exp, string $etiqueta = 'painel'): string
{
    return hash_hmac('sha256', $etiqueta . '|' . $token . '|' . $exp, segredo() . '|' . senhaConfigHash());
}

/** [token, exp, hmac] do cookie, ou null se o formato não confere. */
function lerCookiePainel(): ?array
{
    $v = $_COOKIE[LENDA_COOKIE_PAINEL] ?? null;
    if (!is_string($v) || !preg_match('/^([A-Za-z0-9_-]{43})\.(\d{9,11})\.([0-9a-f]{64})$/', $v, $m)) {
        return null;
    }
    return [$m[1], $m[2], $m[3]];
}

/**
 * Só a assinatura e o prazo do cookie de uma sessão pronta, sem banco (GET painel.php?so=eu). Uma sessão encerrada no
 * servidor pode continuar "valendo" aqui até vencer (nunca mais que 8 h); as rotas de admin conferem o banco.
 */
function cookiePainelValido(): bool
{
    $c = lerCookiePainel();
    if ($c === null || (int) $c[1] < time()) {
        return false;
    }
    return hash_equals(assinaturaPainel($c[0], $c[1], 'painel'), $c[2]);
}

function definirCookiePainel(string $token, int $exp, string $etapa): void
{
    $etiqueta = $etapa === 'pronto' ? 'painel' : 'etapa';
    definirCookie(LENDA_COOKIE_PAINEL, $token . '.' . $exp . '.' . assinaturaPainel($token, (string) $exp, $etiqueta), $exp, 'Strict');
}

function apagarCookiePainel(): void
{
    apagarCookie(LENDA_COOKIE_PAINEL, 'Strict');
}

/** Celular, tablet ou computador (do User-Agent; nada de IP). */
function aparelhoDoPedido(): string
{
    $ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
    if (preg_match('/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i', $ua)) {
        return 'tablet';
    }
    if (preg_match('/Mobi|iPhone|iPod|Android|Opera Mini|IEMobile/i', $ua)) {
        return 'celular';
    }
    return 'computador';
}

/** Erro 503 quando a tabela nova ainda não existe (subiu os arquivos e não rodou o instalar.php). */
function erroInstalar(?Throwable $e = null): never
{
    erro(503, 'instalar', 'Falta atualizar o banco: rode o instalar.php (LEIAME §5) e tente de novo.');
}

/** A exceção é de tabela ou coluna que ainda não existe? */
function eFaltaDeSchema(Throwable $e): bool
{
    return $e instanceof PDOException && in_array($e->errorInfo[1] ?? null, [1146, 1054], true);
}

/**
 * Nova sessão do painel (linha em admin_sessoes com o sha256 do token) e o cookie. $criadaEm = a hora da entrada
 * (o prazo absoluto conta dela, mesmo depois das trocas de token de cada etapa).
 */
function novaSessaoPainel(int $adminId, string $etapa, ?int $criadaEm = null): string
{
    $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    $t = time();
    $criadaEm ??= $t;
    $exp = $etapa === 'pronto' ? $criadaEm + LENDA_PAINEL_SESSAO_S : $t + LENDA_PAINEL_ETAPA_S;
    sql('INSERT INTO admin_sessoes (token_sha256, admin_id, etapa, criada_em, expira_em, visto_em, aparelho) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [hash('sha256', $token), $adminId, $etapa, dt($criadaEm), dt($exp), dt($t), aparelhoDoPedido()]);
    definirCookiePainel($token, $exp, $etapa);
    return $token;
}

/** Troca o token (linha nova, apaga a antiga): a cada etapa e ao trocar a senha. */
function trocarSessaoPainel(array $sessao, string $etapa): string
{
    sql('DELETE FROM admin_sessoes WHERE token_sha256 = ?', [(string) $sessao['token_sha256']]);
    return novaSessaoPainel((int) $sessao['admin_id'], $etapa, paraTempo((string) $sessao['criada_em']) ?? time());
}

/** Cache por pedido da sessão do painel e do admin (lidos uma vez; esquecidos ao trocar o token ou sair). */
final class AdminPedido
{
    public static bool $sessaoLida = false;
    public static ?array $sessao = null;
    public static bool $adminLido = false;
    public static ?array $admin = null;
}

/**
 * A sessão do cookie (linha de admin_sessoes + a conta em "conta"), em qualquer etapa, ou null. Confere a assinatura
 * com a etiqueta da etapa guardada no banco. Sessão vencida (prazo, 2 h sem uso ou cookie vencido): apaga a linha e
 * devolve ['vencida' => true, ...]. Conta apagada ou desativada: apaga a linha e devolve null.
 */
function sessaoPainelDoCookie(): ?array
{
    if (AdminPedido::$sessaoLida) {
        return AdminPedido::$sessao;
    }
    AdminPedido::$sessaoLida = true;
    AdminPedido::$sessao = null;
    $c = lerCookiePainel();
    if ($c === null) {
        return null;
    }
    [$token, $exp] = $c;
    $hash = hash('sha256', $token);
    try {
        $l = umaLinha('SELECT * FROM admin_sessoes WHERE token_sha256 = ?', [$hash]);
    } catch (PDOException $e) {
        if (eFaltaDeSchema($e)) {
            return null; // tabela ainda não existe: ninguém está logado
        }
        throw $e;
    }
    if ($l === null) {
        return null;
    }
    $etiqueta = $l['etapa'] === 'pronto' ? 'painel' : 'etapa';
    if (!hash_equals(assinaturaPainel($token, $exp, $etiqueta), $c[2])) {
        return null; // assinada com outra senha do arquivo, ou de outra etapa
    }
    $t = time();
    $vencida = (paraTempo((string) $l['expira_em']) ?? 0) <= $t || (int) $exp < $t
        || ($l['etapa'] === 'pronto' && (paraTempo((string) $l['visto_em']) ?? 0) < $t - LENDA_PAINEL_OCIOSO_S);
    $conta = (int) $l['admin_id'] > 0 ? umaLinha('SELECT * FROM admin_contas WHERE id = ?', [(int) $l['admin_id']]) : null;
    if ($vencida) {
        sql('DELETE FROM admin_sessoes WHERE token_sha256 = ?', [$hash]);
        return AdminPedido::$sessao = ['vencida' => true, 'conta' => $conta] + $l;
    }
    if ($conta === null || (int) $conta['ativo'] !== 1 || ((int) $conta['da_config'] === 1 && senhaConfigHash() === '')) {
        sql('DELETE FROM admin_sessoes WHERE token_sha256 = ?', [$hash]);
        return null; // conta apagada ou desativada (ou a senha do arquivo foi tirada da config): a sessão cai
    }
    return AdminPedido::$sessao = ['vencida' => false, 'conta' => $conta] + $l;
}

/** Esquece a sessão e o admin deste pedido (depois de trocar o token ou sair: o cookie novo vale no próximo pedido). */
function esquecerSessaoPainel(): void
{
    AdminPedido::$sessaoLida = true;
    AdminPedido::$sessao = null;
    AdminPedido::$adminLido = true;
    AdminPedido::$admin = tokenAdminValido() ? adminDoToken() : null;
}

// ── papéis, poderes e nível ──────────────────────────────────────────────────────────────────────

/** Papéis personalizados (admin_papeis): [chave => {nome, descricao, poderes, nivel}]. */
function papeisPersonalizados(bool $recarregar = false): array
{
    static $p = null;
    if ($p !== null && !$recarregar) {
        return $p;
    }
    $p = [];
    try {
        $linhas = sql('SELECT chave, nome, descricao, poderes FROM admin_papeis ORDER BY nome')->fetchAll();
    } catch (PDOException $e) {
        if (!eFaltaDeSchema($e)) {
            throw $e;
        }
        $linhas = [];
    }
    foreach ($linhas as $l) {
        if (isset(LENDA_PAPEIS[$l['chave']])) {
            continue; // de fábrica nunca é sobrescrito
        }
        $pod = array_values(array_intersect(array_keys(LENDA_PODERES), explode(',', (string) $l['poderes'])));
        $p[(string) $l['chave']] = ['nome' => (string) $l['nome'], 'descricao' => $l['descricao'] !== null ? (string) $l['descricao'] : null,
            'poderes' => $pod, 'nivel' => nivelDosPoderes($pod)];
    }
    return $p;
}

/**
 * Nível de um papel personalizado, tirado dos poderes (nunca chega ao dono): quem cuida da equipe fica logo abaixo
 * do dono; quem mexe em contas, Hall ou bônus, entre o moderador e o suporte; o resto, entre o suporte e o leitor.
 */
function nivelDosPoderes(array $poderes): int
{
    if (in_array('equipe', $poderes, true) || in_array('sistema', $poderes, true)) {
        return 70;
    }
    if (array_intersect($poderes, ['moderar', 'usuarios', 'excluir', 'bonus', 'config'])) {
        return 50;
    }
    return 25;
}

/** Definição do papel (fábrica ou personalizado), ou null se não existe. */
function definicaoPapel(string $papel): ?array
{
    if (isset(LENDA_PAPEIS[$papel])) {
        return LENDA_PAPEIS[$papel] + ['fabrica' => true];
    }
    $p = papeisPersonalizados()[$papel] ?? null;
    return $p === null ? null : $p + ['fabrica' => false];
}

/** Poderes de um papel (papel que não existe mais = nenhum poder: fecha por padrão). */
function poderesDoPapel(string $papel): array
{
    return definicaoPapel($papel)['poderes'] ?? [];
}

/** Monta o array do admin a partir da conta (linha de admin_contas). */
function adminDaConta(array $conta, string $via = 'sessao'): array
{
    $daConfig = (int) ($conta['da_config'] ?? 0) === 1;
    $papel = (string) $conta['papel'];
    $def = definicaoPapel($papel);
    $nivel = $daConfig ? LENDA_NIVEL_DA_CONFIG : (int) ($def['nivel'] ?? 0);
    return [
        'id' => (int) $conta['id'],
        'nome' => (string) $conta['nome'],
        'papel' => $daConfig ? 'dono' : $papel,
        'papelNome' => $daConfig ? 'Dono (senha do arquivo)' : (string) ($def['nome'] ?? $papel),
        'quem' => 'a' . (int) $conta['id'],
        'via' => $via,
        'email' => (string) $conta['email'],
        'nivel' => $nivel,
        'poderes' => $daConfig ? LENDA_PAPEIS['dono']['poderes'] : array_values($def['poderes'] ?? []),
        'daConfig' => $daConfig,
        'temPin' => ($conta['pin_hash'] ?? null) !== null && $conta['pin_hash'] !== '',
    ];
}

/** O Bearer dos scripts: dono, sem conta. */
function adminDoToken(): array
{
    return ['id' => null, 'nome' => 'Token (script)', 'papel' => 'dono', 'papelNome' => 'Token de script', 'quem' => 'token',
        'via' => 'token', 'email' => '', 'nivel' => LENDA_NIVEL_TOKEN, 'poderes' => LENDA_PAPEIS['dono']['poderes'],
        'daConfig' => false, 'temPin' => false];
}

/**
 * O admin deste pedido: sessão pronta do painel (no banco: não vencida, usada nas últimas 2 h, conta ativa e sem senha
 * provisória pendente) ou o Bearer; null se nenhum. Atualiza visto_em a cada 60 s.
 */
function adminAtual(): ?array
{
    if (AdminPedido::$adminLido) {
        return AdminPedido::$admin;
    }
    AdminPedido::$adminLido = true;
    AdminPedido::$admin = null;
    $s = sessaoPainelDoCookie();
    if ($s !== null && !$s['vencida'] && $s['etapa'] === 'pronto'
        && ((int) $s['conta']['trocar_senha'] !== 1 || (int) $s['conta']['da_config'] === 1)) {
        $t = time();
        if ((paraTempo((string) $s['visto_em']) ?? 0) < $t - LENDA_PAINEL_VISTO_S) {
            sql('UPDATE admin_sessoes SET visto_em = ? WHERE token_sha256 = ?', [dt($t), (string) $s['token_sha256']]);
        }
        return AdminPedido::$admin = adminDaConta($s['conta']) + ['sessao' => (string) $s['token_sha256']];
    }
    if (tokenAdminValido()) {
        AdminPedido::$admin = adminDoToken();
    }
    return AdminPedido::$admin;
}

/** Compatibilidade com a v3: 'painel' (sessão do painel), 'token' (Bearer) ou null. */
function adminLogado(): ?string
{
    $a = adminAtual();
    return $a === null ? null : ($a['via'] === 'token' ? 'token' : 'painel');
}

function temPoder(array $adm, string $poder): bool
{
    return in_array($poder, $adm['poderes'] ?? [], true);
}

/**
 * Admin obrigatório (401 nao_logado) e, com $poder, o poder (403 sem_poder, registrado como "negado").
 * @return array{id: ?int, nome: string, papel: string, quem: string, via: string}
 */
function exigirAdmin(?string $poder = null): array
{
    $a = adminAtual();
    if ($a === null) {
        erro(401, 'nao_logado', 'Entre com a senha do painel.');
    }
    if ($poder !== null && !temPoder($a, $poder)) {
        registrarAdmin('negado', mb_substr($poder, 0, 40), ['poder' => $poder]);
        erroCom(403, 'sem_poder', 'O seu papel não permite esta ação.', ['poder' => $poder]);
    }
    return $a;
}

/** Admin obrigatório com o poder que o mapa único (PODERES_ACAO) pede para $acao; fora do mapa, só papel dono. */
function exigirAdminAcao(string $acao): array
{
    $a = exigirAdmin();
    $poder = PODERES_ACAO[$acao] ?? null;
    $ok = $poder !== null ? temPoder($a, $poder) : ($a['nivel'] >= LENDA_PAPEIS['dono']['nivel']);
    if (!$ok) {
        registrarAdmin('negado', mb_substr($acao, 0, 40), ['acao' => mb_substr($acao, 0, 40), 'poder' => $poder ?? 'dono']);
        erroCom(403, 'sem_poder', 'O seu papel não permite esta ação.', ['poder' => $poder ?? 'dono']);
    }
    return $a;
}

/**
 * Escrita do admin: JSON sempre; com a sessão do painel (cookie), também o Origin do site (CSRF, além do
 * SameSite=Strict). Com o Bearer não há CSRF. Aceita o array do exigirAdmin(), o texto da v3 ('painel'|'token') ou nada.
 */
function exigirEscritaAdmin(array|string|null $adm = null): void
{
    $via = is_array($adm) ? (string) ($adm['via'] ?? '') : ($adm ?? (adminAtual()['via'] ?? ''));
    if ($via !== 'token') {
        exigirEscrita();
        return;
    }
    $ct = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? ''), 2)[0]));
    if ($ct !== 'application/json') {
        erro(403, 'origem', 'Pedido recusado.');
    }
}

// ── hierarquia ───────────────────────────────────────────────────────────────────────────────────

/** Contas de dono ativas (pessoais, mais a da senha do arquivo se ela ainda existe na config), sem $exceto. */
function donosAtivos(?int $exceto = null): int
{
    $n = (int) umValor("SELECT COUNT(*) FROM admin_contas WHERE ativo = 1 AND papel = 'dono' AND id <> ?
        AND (da_config = 0 OR ? = 1)", [$exceto ?? 0, senhaConfigHash() !== '' ? 1 : 0]);
    return $n;
}

/**
 * Posso mexer nesta pessoa? null = pode; senão o motivo (pt-BR). Ninguém mexe em si mesmo pela equipe, nem em
 * quem está no mesmo nível ou acima (o Bearer está acima de todos; a conta da senha do arquivo, acima dos donos).
 */
function podeMexer(array $eu, array $alvoConta): ?string
{
    $alvo = adminDaConta($alvoConta);
    if ($eu['id'] !== null && $eu['id'] === $alvo['id']) {
        return 'Você não pode fazer isso na sua própria conta (use Minha conta).';
    }
    if ($alvo['nivel'] >= $eu['nivel']) {
        return 'Só quem está acima de ' . $alvo['papelNome'] . ' pode mexer nessa conta.';
    }
    return null;
}

/**
 * Posso abrir o acesso a esta conta (senha provisória, zerar o PIN, reativar)? Além do podeMexer, os poderes dela têm
 * de estar todos entre os meus: zerar o PIN e dar uma senha provisória é o mesmo que entrar na conta e ganhar os
 * poderes dela (a regra do podeDar: ninguém dá a si um poder que não tem). O Bearer, a senha do arquivo e os donos
 * têm todos os poderes, então para eles vale só o podeMexer.
 */
function podeAssumir(array $eu, array $alvoConta): ?string
{
    $m = podeMexer($eu, $alvoConta);
    if ($m !== null) {
        return $m;
    }
    $alvo = adminDaConta($alvoConta);
    foreach ($alvo['poderes'] as $p) {
        if (!temPoder($eu, $p)) {
            return 'Só quem tem todos os poderes de ' . $alvo['papelNome'] . ' pode dar senha, zerar o PIN ou reativar essa conta.';
        }
    }
    return null;
}

/** Posso dar este papel? null = pode. Ninguém dá papel igual ou acima do seu, menos o dono, que pode nomear outro dono. */
function podeDar(array $eu, string $papel): ?string
{
    $def = definicaoPapel($papel);
    if ($def === null) {
        return 'Papel desconhecido.';
    }
    if ($papel === 'dono' && $eu['nivel'] >= LENDA_PAPEIS['dono']['nivel']) {
        return null;
    }
    if ((int) $def['nivel'] >= $eu['nivel']) {
        return 'Você não pode dar o papel de ' . $def['nome'] . ': ele está no seu nível ou acima.';
    }
    foreach ($def['poderes'] as $p) {
        if (!temPoder($eu, $p)) {
            return 'Você não pode dar o papel de ' . $def['nome'] . ': ele tem poderes que você não tem.';
        }
    }
    return null;
}

// ── senha, PIN e a conta da senha do arquivo ─────────────────────────────────────────────────────

/** Senha nova de conta do painel: null se serve, senão a mensagem. */
function problemaSenhaAdmin(mixed $s): ?string
{
    if (!is_string($s) || str_contains($s, "\0") || strlen($s) > 256) {
        return 'Senha inválida.';
    }
    if (mb_strlen($s, 'UTF-8') < LENDA_SENHA_MIN) {
        return 'A senha precisa ter ' . LENDA_SENHA_MIN . ' caracteres ou mais.';
    }
    if (preg_match('/^(.)\1+$/u', $s)) {
        return 'Essa senha é fácil de adivinhar. Escolha outra.';
    }
    return null;
}

/** Senha provisória: 14 caracteres sem 0/O/1/l/I (que se confundem), com random_int. */
function senhaProvisoria(): string
{
    $letras = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    $s = '';
    for ($i = 0; $i < 14; $i++) {
        $s .= $letras[random_int(0, strlen($letras) - 1)];
    }
    return $s;
}

/** PIN fácil (todos iguais, sequência crescente ou decrescente)? */
function pinFraco(string $pin): bool
{
    if (preg_match('/^(\d)\1+$/', $pin)) {
        return true;
    }
    $cresce = $decresce = true;
    for ($i = 1; $i < strlen($pin); $i++) {
        if ((int) $pin[$i] !== (int) $pin[$i - 1] + 1) {
            $cresce = false;
        }
        if ((int) $pin[$i] !== (int) $pin[$i - 1] - 1) {
            $decresce = false;
        }
    }
    return $cresce || $decresce;
}

/** O que vai para o password_hash do PIN: HMAC com o segredo (o banco sozinho não basta para adivinhar). */
function pinPreparado(int $adminId, string $pin): string
{
    return hash_hmac('sha256', 'pin|' . $adminId . '|' . $pin, segredo());
}

/** E-mail mascarado (jo***@gmail.com), para o registro e as telas. */
function emailMascaradoAdmin(string $e): string
{
    $p = strrpos($e, '@');
    if ($p === false) {
        return $e === '' ? '' : mb_substr($e, 0, 2, 'UTF-8') . '***';
    }
    return mb_substr(substr($e, 0, $p), 0, 2, 'UTF-8') . '***' . substr($e, $p);
}

/** A conta da senha do arquivo (da_config = 1); $criar: cria na primeira entrada. */
function contaDaConfig(bool $criar): ?array
{
    $c = umaLinha('SELECT * FROM admin_contas WHERE da_config = 1 ORDER BY id LIMIT 1');
    if ($c !== null || !$criar) {
        return $c;
    }
    try {
        sql("INSERT INTO admin_contas (email, nome, senha_hash, papel, ativo, trocar_senha, da_config, criado_em)
            VALUES ('', 'Dono', '!', 'dono', 1, 0, 1, ?)", [dt(time())]);
    } catch (PDOException $e) {
        if (!eChaveDuplicada($e)) {
            throw $e; // duplicada = outro pedido criou ao mesmo tempo: usa a que existe
        }
    }
    return umaLinha('SELECT * FROM admin_contas WHERE da_config = 1 ORDER BY id LIMIT 1');
}

/** Há conta pessoal ativa (e-mail + senha própria)? */
function haContaPessoal(): bool
{
    try {
        return (int) umValor("SELECT COUNT(*) FROM admin_contas WHERE da_config = 0 AND ativo = 1 AND senha_hash <> ''") > 0;
    } catch (PDOException $e) {
        if (eFaltaDeSchema($e)) {
            return false;
        }
        throw $e;
    }
}

/** "contas" (há conta pessoal: a tela pede e-mail), "senha" (só a senha do arquivo) ou "desligado" (nenhuma credencial). */
function modoPainel(): string
{
    if (haContaPessoal()) {
        return 'contas';
    }
    return senhaConfigHash() !== '' ? 'senha' : 'desligado';
}

// ── registro (admin_log) ─────────────────────────────────────────────────────────────────────────

/**
 * Uma linha em admin_log: quem fez (a<id> | token | sistema; $quem força, para o registro da entrada), o código do
 * aparelho do dia (16 primeiros caracteres do HMAC diário do IP; nunca o IP) e os detalhes (curtos; textos longos são
 * cortados). Chama aoRegistrarAdmin($acao) se o módulo da moderação (_atencao.php) estiver carregado: ele apaga os
 * caches curtos do pulso e dos alertas.
 */
function registrarAdmin(string $acao, ?string $alvo, array $detalhes = [], ?string $quem = null): void
{
    $cortar = static function (mixed $v) use (&$cortar): mixed {
        if (is_string($v)) {
            return mb_substr($v, 0, 300, 'UTF-8');
        }
        if (is_array($v)) {
            return array_map($cortar, array_slice($v, 0, 40, true));
        }
        return $v;
    };
    // $quem: null = o admin deste pedido; '' = ninguém ainda (tentativa de entrar); 'a<id>' = a conta que está entrando
    $a = $quem === null ? adminAtual() : null;
    if ($quem === null) {
        $quem = $a['quem'] ?? 'sistema';
        $via = $a !== null ? ($a['via'] === 'token' ? 'token' : 'painel') : 'sistema';
    } else {
        $via = $quem === 'sistema' ? 'sistema' : ($quem === 'token' ? 'token' : 'painel');
    }
    $detalhes = ['via' => $via] + $cortar($detalhes);
    $txt = json($detalhes);
    if (strlen($txt) > 8000) {
        $txt = json(['via' => $detalhes['via'], 'cortado' => true]);
    }
    $params = [dt(time()), substr($acao, 0, 40), $alvo !== null ? mb_substr($alvo, 0, 80, 'UTF-8') : null, $txt];
    static $semColunas = false;
    if (!$semColunas) {
        try {
            sql('INSERT INTO admin_log (em, acao, alvo, detalhes, quem, ip_dia) VALUES (?, ?, ?, ?, ?, ?)',
                [...$params, $quem === '' ? null : substr($quem, 0, 20), substr(quemIp(), 0, 16)]);
        } catch (PDOException $e) {
            if (($e->errorInfo[1] ?? null) !== 1054) {
                throw $e;
            }
            $semColunas = true; // o admin_log ainda não tem quem/ip_dia (instalar.php pendente)
        }
    }
    if ($semColunas) {
        sql('INSERT INTO admin_log (em, acao, alvo, detalhes) VALUES (?, ?, ?, ?)', $params);
    }
    if (function_exists('aoRegistrarAdmin')) {
        aoRegistrarAdmin($acao);
    }
}

/** Registra a tentativa estourada do login no máximo uma vez por janela de 10 min (um ataque não enche o registro). */
function registrarLimitePainel(string $acao, array $detalhes = []): void
{
    try {
        $n = sql('INSERT IGNORE INTO tentativas (chave, janela, n) VALUES (?, ?, 1)',
            ['log-painel-limite:' . substr($acao, 0, 40), intdiv(time(), LENDA_JANELA_S)])->rowCount();
        if ($n === 1) {
            registrarAdmin($acao, null, $detalhes, '');
        }
    } catch (Throwable $e) {
        error_log('LENDA registro do limite: ' . $e->getMessage());
    }
}

// ── presença e recados (para o pulso) ────────────────────────────────────────────────────────────

/** Quem da equipe está com o painel aberto agora (visto nos últimos 3 min): [{id, nome, papel}]. */
function presencaEquipe(): array
{
    try {
        $t = time();
        return array_map(static fn(array $l): array => ['id' => (int) $l['id'], 'nome' => (string) $l['nome'],
            'papel' => (int) $l['da_config'] === 1 ? 'dono' : (string) $l['papel']],
            sql("SELECT a.id, a.nome, a.papel, a.da_config FROM admin_contas a
                WHERE a.ativo = 1 AND EXISTS (SELECT 1 FROM admin_sessoes s WHERE s.admin_id = a.id AND s.etapa = 'pronto'
                    AND s.visto_em >= ? AND s.expira_em > ?)
                ORDER BY a.nome LIMIT 50", [dt($t - LENDA_PAINEL_PRESENCA_S), dt($t)])->fetchAll());
    } catch (PDOException $e) {
        if (eFaltaDeSchema($e)) {
            return [];
        }
        throw $e;
    }
}

/** Recados internos em vigor, para esta pessoa, que ela ainda não leu. */
function recadosNaoLidos(array $adm): int
{
    if ($adm['id'] === null) {
        return 0;
    }
    try {
        $id = (string) $adm['id'];
        return (int) umValor("SELECT COUNT(*) FROM admin_recados WHERE (ate IS NULL OR ate > ?)
            AND (para IS NULL OR FIND_IN_SET(?, para) > 0) AND FIND_IN_SET(?, COALESCE(lidos, '')) = 0 AND criado_por <> ?",
            [dt(time()), $id, $id, (int) $adm['id']]);
    } catch (PDOException $e) {
        if (eFaltaDeSchema($e)) {
            return 0;
        }
        throw $e;
    }
}

// ── bloco Segurança (P1-3) ───────────────────────────────────────────────────────────────────────

/** Nomes das contas do painel por código de "quem" (a<id>), para as listas do registro. */
function nomesQuem(array $quems): array
{
    $ids = [];
    foreach ($quems as $q) {
        if (is_string($q) && preg_match('/^a(\d{1,10})$/', $q, $m)) {
            $ids[] = (int) $m[1];
        }
    }
    $nomes = ['token' => 'Token (script)', 'sistema' => 'Sistema'];
    $ids = array_values(array_unique($ids)); // (§A) o mesmo "quem" em várias linhas: um id só no IN (senão HY093)
    if ($ids) {
        try {
            foreach (sql('SELECT id, nome, da_config FROM admin_contas WHERE id IN (' . marcas(count($ids)) . ')', array_values(array_unique($ids))) as $l) {
                $nomes['a' . $l['id']] = (int) $l['da_config'] === 1 ? 'Dono (senha do arquivo)' : (string) $l['nome'];
            }
        } catch (PDOException $e) {
            if (!eFaltaDeSchema($e)) {
                throw $e;
            }
        }
    }
    return $nomes;
}

/** Item do registro para as telas: {id, em, acao, alvo, quem: {codigo, nome}|null, ipDia (6), grave, detalhes}. */
function itemRegistroAdmin(array $l, array $nomes): array
{
    $d = is_string($l['detalhes'] ?? null) ? json_decode((string) $l['detalhes'], true) : null;
    $q = isset($l['quem']) && is_string($l['quem']) ? $l['quem'] : null;
    return [
        'id' => (int) $l['id'],
        'em' => iso($l['em']),
        'acao' => (string) $l['acao'],
        'alvo' => $l['alvo'],
        'quem' => $q !== null ? ['codigo' => $q, 'nome' => $nomes[$q] ?? ($q === '' ? null : 'Conta excluída')] : null,
        'ipDia' => isset($l['ip_dia']) && is_string($l['ip_dia']) ? substr($l['ip_dia'], 0, 6) : null,
        'grave' => in_array((string) $l['acao'], LENDA_ACOES_GRAVES, true),
        'detalhes' => is_array($d) ? $d : null,
    ];
}

/**
 * GET ?r=seguranca[&acao=]: as linhas de acesso do admin_log (entrar, falhar, bloquear, sair, negado, PIN, senha),
 * paginado de 50 (com $acao, só essa), e o resumo {falhas24h, limites24h, negados24h, tentativasAgora, sessoesAtivas}.
 */
function respostaSeguranca(int $pagina, ?string $acao = null): array
{
    $por = 50;
    if ($acao !== null && $acao !== '' && !in_array($acao, LENDA_ACOES_SEGURANCA, true)) {
        erro(400, 'acao', 'Filtro de ação desconhecido no bloco Segurança.');
    }
    $acoes = $acao !== null && $acao !== '' ? [$acao] : LENDA_ACOES_SEGURANCA;
    $in = marcas(count($acoes));
    $total = (int) umValor("SELECT COUNT(*) FROM admin_log WHERE acao IN ($in)", $acoes);
    $linhas = sql("SELECT * FROM admin_log WHERE acao IN ($in) ORDER BY id DESC LIMIT $por OFFSET " . (($pagina - 1) * $por), $acoes)->fetchAll();
    $nomes = nomesQuem(array_column($linhas, 'quem'));
    $t = time();
    $dia = dt($t - 86400);
    $c = [];
    foreach (sql("SELECT acao, COUNT(*) AS n FROM admin_log WHERE em >= ? AND acao IN ('painel_falha', 'painel_pin_errado',
        'minha_senha_falha', 'painel_limite', 'painel_pin_travado', 'negado') GROUP BY acao", [$dia]) as $l) {
        $c[$l['acao']] = (int) $l['n'];
    }
    [$chave, $janela] = chaveLimite('painel-todos', 'todos');
    try {
        $sessoes = (int) umValor("SELECT COUNT(*) FROM admin_sessoes WHERE etapa = 'pronto' AND expira_em > ? AND visto_em >= ?",
            [dt($t), dt($t - LENDA_PAINEL_OCIOSO_S)]);
    } catch (PDOException $e) {
        if (!eFaltaDeSchema($e)) {
            throw $e;
        }
        $sessoes = 0;
    }
    return [
        'total' => $total, 'pagina' => $pagina, 'porPagina' => $por,
        'itens' => array_map(static fn(array $l): array => itemRegistroAdmin($l, $nomes), $linhas),
        'resumo' => [
            'falhas24h' => ($c['painel_falha'] ?? 0) + ($c['painel_pin_errado'] ?? 0) + ($c['minha_senha_falha'] ?? 0),
            'limites24h' => ($c['painel_limite'] ?? 0) + ($c['painel_pin_travado'] ?? 0),
            'negados24h' => $c['negado'] ?? 0,
            'tentativasAgora' => (int) umValor('SELECT COALESCE(SUM(n), 0) FROM tentativas WHERE chave = ? AND janela = ?', [$chave, $janela]),
            'sessoesAtivas' => $sessoes,
        ],
    ];
}

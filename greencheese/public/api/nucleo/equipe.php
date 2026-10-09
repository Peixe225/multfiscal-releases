<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Equipe do painel: papéis, o mapa rota → permissão (o único lugar que diz quem pode o quê) e as rotas do dono pra
// cuidar dos logins (criar, editar papel e estados, redefinir a senha, desativar).
// - dono: tudo (inclusive rota que ainda não está no mapa: a de outra frente, antes da integração).
// - gerente: só os estados dele: pedidos, rateios, participantes, fotos e (quando a loja chegar) produtos/estoque.
// - atendente: só os estados dele: pedidos e participantes dos rateios (vê os rateios, não mexe neles).
// Rota admin-* que não está no mapa: só o dono passa. Rota nova entra no mapa com a permissão dela (API.md, "Equipe").

const GC_PAPEIS = ['dono', 'gerente', 'atendente'];
const GC_NOME_PAPEL = ['dono' => 'dono', 'gerente' => 'gerente', 'atendente' => 'atendente'];

/** Permissões de cada papel (o dono tem todas, até as que ainda não existem). */
const GC_PERMISSOES_PAPEL = [
    'gerente' => ['conta', 'resumo', 'atividade', 'pedidos', 'pedidos-dados', 'rateios-ver', 'rateios', 'participantes', 'participantes-dados', 'imagens', 'produtos'],
    'atendente' => ['conta', 'resumo', 'atividade', 'pedidos', 'rateios-ver', 'participantes'],
];

/** Todas as permissões que existem (o dono recebe esta lista no admin-sessao). */
const GC_PERMISSOES = [
    'conta', 'resumo', 'atividade', 'pedidos', 'pedidos-dados', 'rateios-ver', 'rateios', 'participantes', 'participantes-dados',
    'imagens', 'produtos', 'loja', 'avisos', 'textos', 'servidor', 'equipe', 'clientes',
];

/**
 * O mapa: cada rota admin-* e a permissão que ela pede. As de antes da sessão (admin-sessao, -instalar, -entrar,
 * -recuperar) ficam de fora: não têm usuário ainda. 'produtos' (produtos, estoque, disponibilidade) e 'loja' (estados,
 * stories, textos da loja, prêmios) são as da frente da loja: as rotas dela entram aqui na integração.
 */
const GC_PERMISSAO_ROTA = [
    // conta de quem está logado
    'admin-sair' => 'conta',
    'admin-senha' => 'conta',
    // resumo e atividade (filtrados pelos estados de quem pede)
    'admin-resumo' => 'resumo',
    'admin-eventos' => 'atividade',
    // rateios e participantes
    'admin-rateios' => 'rateios-ver',
    'admin-rateio' => 'rateios-ver',
    'admin-rateio-salvar' => 'rateios',
    'admin-rateio-status' => 'rateios',
    'admin-rateio-apagar' => 'rateios',
    'admin-participantes' => 'participantes',
    'admin-participante-salvar' => 'participantes',
    'admin-participante-status' => 'participantes',
    'admin-participantes-csv' => 'participantes',
    'admin-participante-apagar' => 'participantes-dados',
    'admin-upload' => 'imagens',
    // servidor
    'admin-backup' => 'servidor',
    'admin-diagnostico' => 'servidor',
    // pedidos, avisos no WhatsApp e falas do pedido guiado
    'admin-pedidos' => 'pedidos',
    'admin-pedidos-resumo' => 'pedidos',
    'admin-pedido' => 'pedidos',
    'admin-pedido-status' => 'pedidos',
    'admin-pedido-salvar' => 'pedidos',
    'admin-pedido-apagar-dados' => 'pedidos-dados',
    'admin-avisos' => 'avisos',
    'admin-avisos-salvar' => 'avisos',
    'admin-avisos-testar' => 'avisos',
    'admin-aviso-reenviar' => 'avisos',
    'admin-textos-pedido' => 'textos',
    'admin-texto-pedido-salvar' => 'textos',
    // equipe
    'admin-usuarios' => 'equipe',
    'admin-usuario-salvar' => 'equipe',
    'admin-usuario-senha' => 'equipe',
    'admin-usuario-status' => 'equipe',
    // clientes do site
    'admin-clientes' => 'clientes',
    'admin-cliente' => 'clientes',
    'admin-clientes-csv' => 'clientes',
    'admin-cliente-apagar' => 'clientes',
    'admin-clientes-ajustes' => 'clientes',
    'admin-cupom-usado' => 'clientes',
];

/** Com a senha provisória, só dá pra trocar a senha, ver a sessão e sair. */
const GC_ROTAS_SENHA_PROVISORIA = ['admin-senha', 'admin-sair'];

/** @return list<string> */
function gc_permissoes_do_papel(string $papel): array
{
    return $papel === 'dono' ? GC_PERMISSOES : (GC_PERMISSOES_PAPEL[$papel] ?? []);
}

function gc_rota_atual(): string
{
    $r = $_GET['r'] ?? '';
    return is_string($r) ? $r : '';
}

/** Quem está logado pode isso? */
function gc_pode(string $permissao): bool
{
    $u = gc_usuario_atual();
    if ($u === null) {
        return false;
    }
    return ($u['papel'] ?? 'dono') === 'dono' || in_array($permissao, gc_permissoes_do_papel((string) $u['papel']), true);
}

function gc_sem_permissao(string $mensagem = 'Teu acesso não deixa fazer isso. Fala com o dono da loja.', array $extra = []): ErroApi
{
    return new ErroApi('sem-permissao', $mensagem, 403, $extra);
}

/** Confere a rota atual no mapa (chamada pelo gc_exigir_dono, depois da sessão e do CSRF). */
function gc_conferir_permissao(): void
{
    $u = gc_usuario_atual();
    $rota = gc_rota_atual();
    if ($u === null) {
        throw new ErroApi('sem-sessao', 'Tua sessão acabou. Entra de novo.', 401);
    }
    if (($u['trocarSenha'] ?? false) && !in_array($rota, GC_ROTAS_SENHA_PROVISORIA, true)) {
        throw new ErroApi('trocar-senha', 'Troca a senha provisória antes de seguir.', 403);
    }
    if (($u['papel'] ?? 'dono') === 'dono') {
        return;
    }
    $permissao = GC_PERMISSAO_ROTA[$rota] ?? null;
    if ($permissao === null || !gc_pode($permissao)) {
        throw gc_sem_permissao();
    }
}

/** Estados de quem está logado (null = todos: o dono). @return list<string>|null */
function gc_ufs_do_usuario(): ?array
{
    $u = gc_usuario_atual();
    if ($u === null || ($u['papel'] ?? 'dono') === 'dono') {
        return null;
    }
    return $u['ufs'] ?? [];
}

/** O estado é de quem está logado? (o dono pode todos) */
function gc_uf_permitida(string $uf): bool
{
    $ufs = gc_ufs_do_usuario();
    return $ufs === null || in_array($uf, $ufs, true);
}

/** Recusa o que é de outro estado (pedido, vaga): 403 sem-permissao com motivo 'estado'. */
function gc_exigir_uf(string $uf, string $oQue = 'Isso'): void
{
    if (!gc_uf_permitida($uf)) {
        throw gc_sem_permissao("$oQue é de outro estado: teu acesso é só de " . gc_ufs_texto() . '.', ['motivo' => 'estado']);
    }
}

/** 'MG e RJ' (os estados de quem está logado). */
function gc_ufs_texto(): string
{
    $ufs = array_map('strtoupper', gc_ufs_do_usuario() ?? []);
    if ($ufs === []) {
        return 'nenhum estado';
    }
    $ultimo = array_pop($ufs);
    return $ufs === [] ? $ultimo : implode(', ', $ufs) . ' e ' . $ultimo;
}

/**
 * Pedaço do WHERE que deixa só os estados de quem está logado ('' pro dono). Os estados vêm do banco (já conferidos
 * pelo gc_uf), mas vão como parâmetro mesmo assim.
 * @return array{0: string, 1: list<string>}
 */
function gc_filtro_ufs(string $coluna): array
{
    $ufs = gc_ufs_do_usuario();
    if ($ufs === null) {
        return ['', []];
    }
    if ($ufs === []) {
        return ['0 = 1', []];
    }
    return ["$coluna IN (" . implode(', ', array_fill(0, count($ufs), '?')) . ')', $ufs];
}

/** O rateio (ufs 'mg,rj') aparece pra quem está logado? (tem pelo menos um estado dele) */
function gc_rateio_visivel(array $r): bool
{
    $ufs = gc_ufs_do_usuario();
    return $ufs === null || array_intersect(explode(',', (string) $r['ufs']), $ufs) !== [];
}

/** Mexer no rateio inteiro (editar, passos, apagar) só com todos os estados dele. */
function gc_exigir_rateio_inteiro(array $r): void
{
    $ufs = gc_ufs_do_usuario();
    if ($ufs !== null && array_diff(explode(',', (string) $r['ufs']), $ufs) !== []) {
        throw gc_sem_permissao('Esse rateio vale em estado que não é teu: só o dono mexe nele.', ['motivo' => 'estado']);
    }
}

// ─── rotas do dono: os logins da equipe ─────────────────────────────────────────────────────────────────────────

/** Usuário como o painel vê na tela Equipe. @param array<string, mixed> $u */
function gc_usuario_admin(array $u, array $ultimos = []): array
{
    $x = gc_usuario_da_linha($u, (int) $u['id']);
    return [
        'login' => $x['login'],
        'nome' => $x['nome'],
        'papel' => $x['papel'],
        'ufs' => $x['ufs'],
        'ativo' => (int) ($u['ativo'] ?? 1) === 1,
        'trocarSenha' => $x['trocarSenha'],
        'criadoEm' => gc_iso((int) $u['criado_em']),
        'criadoPor' => (string) ($u['criado_por'] ?? ''),
        'acessoEm' => gc_iso(gc_int_ou_nulo($u['acesso_em'])),
        'senhaEm' => gc_iso((int) $u['senha_em']),
        'desativadoEm' => gc_iso(gc_int_ou_nulo($u['desativado_em'] ?? null)),
        'sessoes' => (int) ($u['sessoes'] ?? 0),
        'eu' => $x['id'] === (int) (gc_usuario_atual()['id'] ?? 0),
    ];
}

/** Senha provisória legível (12 letras e números sem os que confundem, em 3 grupos): 'k7m2-x9q4-h3d8'. */
function gc_senha_provisoria(): string
{
    $alf = 'abcdefghjkmnpqrstuvwxyz23456789';
    $s = '';
    for ($i = 0; $i < 12; $i++) {
        $s .= $alf[random_int(0, strlen($alf) - 1)] . ($i === 3 || $i === 7 ? '-' : '');
    }
    return $s;
}

function gc_usuario_ou_404(mixed $login): array
{
    $l = gc_login($login);
    $u = $l === null ? null : gc_um('SELECT * FROM usuarios WHERE login = ?', [$l]);
    if ($u === null) {
        throw new ErroApi('nao-encontrado', 'Login não encontrado.', 404);
    }
    return $u;
}

/** Donos ativos (tem que sobrar pelo menos um). */
function gc_donos_ativos(?int $exceto = null): int
{
    return (int) gc_valor("SELECT COUNT(*) FROM usuarios WHERE papel = 'dono' AND ativo = 1 AND id <> ?", [$exceto ?? 0]);
}

/** GET admin-usuarios: a equipe inteira (o dono primeiro, depois por nome). */
function gc_rota_admin_usuarios(): array
{
    gc_exigir_dono();
    $agora = gc_agora();
    $linhas = gc_todos(
        "SELECT u.*, (SELECT COUNT(*) FROM sessoes s WHERE s.usuario_id = u.id AND s.expira_em > ?) AS sessoes FROM usuarios u
          ORDER BY u.ativo DESC, CASE u.papel WHEN 'dono' THEN 0 WHEN 'gerente' THEN 1 ELSE 2 END, u.nome COLLATE NOCASE, u.id",
        [$agora],
    );
    return ['agora' => gc_iso($agora), 'usuarios' => array_map('gc_usuario_admin', $linhas)];
}

/** Lê papel e estados do corpo. @return array{0: string, 1: string} papel e ufs ('mg,rj') */
function gc_ler_papel(array $c, ?array $atual): array
{
    $papel = array_key_exists('papel', $c) ? $c['papel'] : ($atual['papel'] ?? null);
    if (!is_string($papel) || !in_array($papel, GC_PAPEIS, true)) {
        throw gc_invalido('papel', 'Escolhe o papel: dono, gerente ou atendente.');
    }
    if ($papel === 'dono') {
        return [$papel, ''];
    }
    $ufs = array_key_exists('ufs', $c) ? $c['ufs'] : explode(',', (string) ($atual['ufs'] ?? ''));
    $lista = [];
    if (is_array($ufs)) {
        foreach ($ufs as $u) {
            $uf = gc_uf($u);
            if ($uf === null) {
                throw gc_invalido('ufs', 'Estado inválido na lista.');
            }
            $lista[$uf] = true;
        }
    }
    if ($lista === []) {
        throw gc_invalido('ufs', 'Escolhe pelo menos um estado pra esse acesso.');
    }
    $l = array_keys($lista);
    sort($l);
    return [$papel, implode(',', $l)];
}

/**
 * POST admin-usuario-salvar { login, nome, papel, ufs, novo? }: novo = cria o login com uma senha provisória (volta UMA
 * vez em senhaProvisoria; no primeiro acesso a pessoa troca); sem novo = edita nome, papel e estados. O dono não tira
 * o próprio papel de dono, e sempre sobra um dono ativo.
 */
function gc_rota_admin_usuario_salvar(): array
{
    $s = gc_exigir_dono();
    $c = gc_corpo();
    $novo = ($c['novo'] ?? false) === true;
    $senha = $novo ? gc_senha_provisoria() : null;
    $hash = $senha === null ? null : gc_hash_senha($senha);
    return gc_transacao(static function () use ($c, $novo, $senha, $hash, $s): array {
        $agora = gc_agora();
        $nome = gc_nome($c['nome'] ?? null);
        if ($novo) {
            $login = gc_login($c['login'] ?? null) ?? throw gc_invalido('login', 'Login de 3 a 32 caracteres: letras, números, ponto, traço.');
            if (gc_valor('SELECT 1 FROM usuarios WHERE login = ?', [$login]) !== null) {
                throw gc_invalido('login', 'Esse login já existe. Escolhe outro.');
            }
            [$papel, $ufs] = gc_ler_papel($c, null);
            gc_inserir(
                'INSERT INTO usuarios (login, nome, senha_hash, papel, ufs, trocar_senha, criado_por, criado_em, senha_em) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)',
                [$login, $nome, $hash, $papel, $ufs, (string) $s['login'], $agora, $agora],
            );
            gc_evento('painel', 'usuario-criado', 'usuario:' . $login, ['nome' => $nome, 'papel' => $papel, 'ufs' => $ufs]);
            $u = (array) gc_um('SELECT * FROM usuarios WHERE login = ?', [$login]);
            return ['_status' => 201, 'usuario' => gc_usuario_admin($u), 'senhaProvisoria' => $senha];
        }
        $atual = gc_usuario_ou_404($c['login'] ?? null);
        [$papel, $ufs] = gc_ler_papel($c, $atual);
        $eu = (int) $atual['id'] === (int) $s['usuario_id'];
        if ($atual['papel'] === 'dono' && $papel !== 'dono') {
            if ($eu) {
                throw gc_invalido('papel', 'Tu não tira o teu próprio papel de dono.');
            }
            if (gc_donos_ativos((int) $atual['id']) === 0) {
                throw gc_invalido('papel', 'Tem que sobrar pelo menos um dono.');
            }
        }
        $mudou = array_keys(array_filter(['nome' => $nome !== $atual['nome'], 'papel' => $papel !== $atual['papel'], 'ufs' => $ufs !== (string) ($atual['ufs'] ?? '')]));
        if ($mudou !== []) {
            gc_sql('UPDATE usuarios SET nome = ?, papel = ?, ufs = ? WHERE id = ?', [$nome, $papel, $ufs, $atual['id']]);
            gc_evento('painel', 'usuario-editado', 'usuario:' . $atual['login'], ['nome' => $nome, 'papel' => $papel, 'ufs' => $ufs, 'campos' => $mudou]);
        }
        $u = (array) gc_um('SELECT * FROM usuarios WHERE id = ?', [$atual['id']]);
        return ['usuario' => gc_usuario_admin($u)];
    });
}

/**
 * POST admin-usuario-senha { login }: senha provisória nova (volta UMA vez), troca obrigatória no próximo acesso e
 * todas as sessões dessa pessoa caem. A própria senha o dono troca em Conta.
 */
function gc_rota_admin_usuario_senha(): array
{
    $s = gc_exigir_dono();
    $c = gc_corpo();
    $u = gc_usuario_ou_404($c['login'] ?? null);
    if ((int) $u['id'] === (int) $s['usuario_id']) {
        throw gc_invalido('login', 'A tua senha tu troca em Conta.');
    }
    $senha = gc_senha_provisoria();
    $hash = gc_hash_senha($senha);
    return gc_transacao(static function () use ($u, $senha, $hash): array {
        gc_sql('UPDATE usuarios SET senha_hash = ?, senha_em = ?, trocar_senha = 1 WHERE id = ?', [$hash, gc_agora(), $u['id']]);
        gc_sql('DELETE FROM sessoes WHERE usuario_id = ?', [$u['id']]);
        gc_evento('painel', 'usuario-senha', 'usuario:' . $u['login'], ['nome' => $u['nome']]);
        return ['usuario' => gc_usuario_admin((array) gc_um('SELECT * FROM usuarios WHERE id = ?', [$u['id']])), 'senhaProvisoria' => $senha];
    });
}

/** POST admin-usuario-status { login, ativo }: desativar (as sessões caem na hora) ou reativar. */
function gc_rota_admin_usuario_status(): array
{
    $s = gc_exigir_dono();
    $c = gc_corpo();
    if (!is_bool($c['ativo'] ?? null)) {
        throw gc_invalido('ativo', 'Ativo é sim ou não.');
    }
    $ativo = $c['ativo'];
    return gc_transacao(static function () use ($c, $ativo, $s): array {
        $u = gc_usuario_ou_404($c['login'] ?? null);
        if ((int) $u['id'] === (int) $s['usuario_id']) {
            throw gc_invalido('login', 'Tu não desativa o teu próprio acesso.');
        }
        if ((int) ($u['ativo'] ?? 1) === ($ativo ? 1 : 0)) {
            return ['usuario' => gc_usuario_admin($u), 'jaEstava' => true];
        }
        if (!$ativo && $u['papel'] === 'dono' && gc_donos_ativos((int) $u['id']) === 0) {
            throw gc_invalido('login', 'Tem que sobrar pelo menos um dono ativo.');
        }
        gc_sql('UPDATE usuarios SET ativo = ?, desativado_em = ? WHERE id = ?', [$ativo ? 1 : 0, $ativo ? null : gc_agora(), $u['id']]);
        if (!$ativo) {
            gc_sql('DELETE FROM sessoes WHERE usuario_id = ?', [$u['id']]);
        }
        gc_evento('painel', $ativo ? 'usuario-reativado' : 'usuario-desativado', 'usuario:' . $u['login'], ['nome' => $u['nome']]);
        return ['usuario' => gc_usuario_admin((array) gc_um('SELECT * FROM usuarios WHERE id = ?', [$u['id']]))];
    });
}

/** Frase dos eventos da equipe (gc_evento_texto chama). */
function gc_equipe_evento_texto(string $acao, string $alvo, array $d): ?string
{
    $quem = isset($d['nome']) ? $d['nome'] . " (@$alvo)" : "@$alvo";
    $papel = static function (array $d): string {
        $p = GC_NOME_PAPEL[(string) ($d['papel'] ?? '')] ?? (string) ($d['papel'] ?? '');
        $ufs = (string) ($d['ufs'] ?? '');
        return $p . ($ufs !== '' ? ' de ' . strtoupper(str_replace(',', ', ', $ufs)) : '');
    };
    return match ($acao) {
        'usuario-criado' => "Criou o acesso de $quem, " . $papel($d),
        'usuario-editado' => "Mudou o acesso de $quem: " . $papel($d),
        'usuario-senha' => "Gerou uma senha provisória pra $quem",
        'usuario-desativado' => "Desativou o acesso de $quem",
        'usuario-reativado' => "Reativou o acesso de $quem",
        'senha-provisoria-trocada' => 'Trocou a senha provisória',
        'entrar-desativado' => "Tentou entrar com o acesso desativado (@$alvo)",
        default => null,
    };
}

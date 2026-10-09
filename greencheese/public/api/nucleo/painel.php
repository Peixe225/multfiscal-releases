<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Rotas do painel do dono (admin-*): instalação, entrar/sair/senha, resumo, rateios, participantes, CSV e eventos.
// Toda rota exige a sessão (gc_exigir_dono), menos sessao, instalar, recuperar e entrar.

/** Hash qualquer (de um segredo jogado fora): login com usuário que não existe gasta o mesmo tempo. */
const GC_HASH_FALSO = '$2y$11$4GO1AA6/TpiWlHtNfVYKKeglh15P.r4HRAzeZwja0.qXVWqPukL7a';

const GC_ROTULO_STATUS = [
    'rascunho' => 'rascunho', 'aberto' => 'aberto', 'fechado' => 'fechado', 'pedido' => 'pedido feito',
    'caminho' => 'a caminho', 'chegou' => 'chegou', 'encerrado' => 'encerrado', 'cancelado' => 'cancelado',
    'reservado' => 'reservado', 'confirmado' => 'confirmado', 'expirado' => 'expirado', 'entregue' => 'entregue',
];

// ─── sessão ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** GET admin-sessao: { instalado, usuario | null, csrf | null }. */
function gc_rota_admin_sessao(): array
{
    $instalado = gc_instalado();
    $s = $instalado ? gc_sessao_atual() : null;
    return [
        'instalado' => $instalado,
        'usuario' => $s === null ? null : gc_usuario_publico(),
        'csrf' => $s === null ? null : (string) $s['csrf'],
        'versao' => GC_API,
    ];
}

/** POST admin-instalar { codigo, login, nome, senha }: só enquanto não existe usuário. */
function gc_rota_admin_instalar(): array
{
    gc_conferir_origem();
    $c = gc_corpo();
    if (gc_instalado()) {
        throw new ErroApi('ja-instalado', 'O painel já foi instalado. Entra com teu login.', 409);
    }
    $hash = gc_conferir_codigo($c['codigo'] ?? null);
    $login = gc_login($c['login'] ?? null) ?? throw gc_invalido('login', 'Login de 3 a 32 caracteres: letras, números, ponto, traço.');
    $nome = gc_nome($c['nome'] ?? null);
    $senha = gc_senha_nova($c['senha'] ?? null);
    $senhaHash = gc_hash_senha($senha);

    return gc_transacao(static function () use ($hash, $login, $nome, $senhaHash): array {
        if (gc_instalado()) {
            throw new ErroApi('ja-instalado', 'O painel já foi instalado. Entra com teu login.', 409);
        }
        $agora = gc_agora();
        $id = gc_inserir(
            "INSERT INTO usuarios (login, nome, senha_hash, papel, criado_em, senha_em) VALUES (?, ?, ?, 'dono', ?, ?)",
            [$login, $nome, $senhaHash, $agora, $agora],
        );
        gc_ajuste_definir('instalacao_usada', hash('sha256', $hash));
        gc_ajuste_definir('instalado_em', (string) $agora);
        $s = gc_sessao_criar($id);
        gc_evento('painel', 'painel-instalado', 'usuario:' . $login, [], $id);
        gc_semear_exemplos();
        // a loja nasce com a semente (a mesma do site de agora); dali em diante, quem manda é o painel. Sem o
        // módulo (index.php de antes da loja, no meio de uma publicação), a migração 101 semeia depois.
        if (function_exists('gc_loja_semear')) {
            gc_loja_semear(gc_db(), gc_loja_semente());
        }
        return ['_status' => 201, 'usuario' => gc_usuario_publico(), 'csrf' => $s['csrf']];
    });
}

/**
 * POST admin-recuperar { codigo, senha, login? }: senha nova pra quem esqueceu, com um código de instalação NOVO
 * (cada código vale uma vez: o da instalação não serve). Derruba todas as sessões.
 */
function gc_rota_admin_recuperar(): array
{
    gc_conferir_origem();
    $c = gc_corpo();
    if (!gc_instalado()) {
        throw new ErroApi('nao-instalado', 'O painel ainda não foi instalado.', 409);
    }
    $hash = gc_conferir_codigo($c['codigo'] ?? null);
    if (hash_equals((string) gc_ajuste('instalacao_usada'), hash('sha256', $hash))) {
        throw new ErroApi('codigo-usado', 'Esse código já foi usado. Gere outro e publique o instalacao.php de novo.', 409);
    }
    $senha = gc_senha_nova($c['senha'] ?? null);
    $login = isset($c['login']) && $c['login'] !== '' ? gc_login($c['login']) : null;
    $u = $login !== null
        ? gc_um('SELECT * FROM usuarios WHERE login = ?', [$login])
        : gc_um("SELECT * FROM usuarios WHERE papel = 'dono' ORDER BY id LIMIT 1");
    if ($u === null) {
        throw gc_invalido('login', 'Login não encontrado.');
    }
    $senhaHash = gc_hash_senha($senha);
    return gc_transacao(static function () use ($u, $hash, $senhaHash): array {
        $agora = gc_agora();
        gc_sql('UPDATE usuarios SET senha_hash = ?, senha_em = ? WHERE id = ?', [$senhaHash, $agora, $u['id']]);
        gc_sql('DELETE FROM sessoes WHERE usuario_id = ?', [$u['id']]);
        gc_ajuste_definir('instalacao_usada', hash('sha256', $hash));
        $s = gc_sessao_criar((int) $u['id']);
        gc_evento('painel', 'senha-recuperada', 'usuario:' . $u['login'], [], (int) $u['id']);
        return ['usuario' => gc_usuario_publico(), 'csrf' => $s['csrf']];
    });
}

/**
 * POST admin-entrar { login, senha }. Limite: 5 erros em 15 min por IP + login e 20 por IP. A tentativa conta
 * antes de conferir a senha (30 de uma vez não passam do limite) e sai se der certo. Mensagem sempre a mesma.
 */
function gc_rota_admin_entrar(): array
{
    gc_conferir_origem();
    $c = gc_corpo();
    if (!gc_instalado()) {
        throw new ErroApi('nao-instalado', 'O painel ainda não foi instalado.', 409);
    }
    $login = is_string($c['login'] ?? null) ? strtolower(trim(substr($c['login'], 0, 64))) : '';
    $senha = is_string($c['senha'] ?? null) ? $c['senha'] : '';
    $ip = gc_ip();
    $kIp = gc_chave_limite('ip', $ip);
    $kLogin = gc_chave_limite('ip-login', $ip, $login);
    $msg = 'Muita tentativa errada. Espera uns minutos e tenta de novo.';
    [$t1, $t2] = gc_transacao(static function () use ($kIp, $kLogin, $msg): array {
        gc_limite_conferir('entrar-ip', $kIp, 20, 900, $msg);
        $t1 = gc_limite('entrar', $kLogin, 5, 900, $msg);
        $t2 = gc_inserir('INSERT INTO tentativas (tipo, chave, em) VALUES (?, ?, ?)', ['entrar-ip', $kIp, gc_agora()]);
        return [$t1, $t2];
    });
    $u = $login === '' ? null : gc_um('SELECT * FROM usuarios WHERE login = ?', [$login]);
    $ok = password_verify($senha, $u === null ? GC_HASH_FALSO : (string) $u['senha_hash']);
    if ($u === null || !$ok || $senha === '') {
        throw new ErroApi('credenciais', 'Login ou senha não confere.', 401);
    }
    return gc_transacao(static function () use ($u, $senha, $t1, $t2, $kLogin): array {
        gc_limite_apagar($t1);
        gc_limite_apagar($t2);
        gc_limite_zerar('entrar', $kLogin);
        if (password_needs_rehash((string) $u['senha_hash'], PASSWORD_DEFAULT, ['cost' => 11])) {
            gc_sql('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [gc_hash_senha($senha), $u['id']]);
        }
        $s = gc_sessao_criar((int) $u['id']);
        gc_evento('painel', 'entrou', 'usuario:' . $u['login'], [], (int) $u['id']);
        return ['usuario' => gc_usuario_publico(), 'csrf' => $s['csrf']];
    });
}

/** POST admin-sair: apaga a sessão e o cookie. */
function gc_rota_admin_sair(): array
{
    $s = gc_exigir_dono();
    gc_sql('DELETE FROM sessoes WHERE id = ?', [$s['id']]);
    gc_evento('painel', 'saiu', 'usuario:' . $s['login']);
    gc_cookie_apagar();
    return [];
}

/** POST admin-senha { atual, nova }: troca e derruba as outras sessões (esta continua). */
function gc_rota_admin_senha(): array
{
    $s = gc_exigir_dono();
    $c = gc_corpo();
    gc_limite('senha', gc_chave_limite('usuario', (string) $s['usuario_id']), 5, 900, 'Muita tentativa errada. Espera uns minutos e tenta de novo.');
    $u = (array) gc_um('SELECT * FROM usuarios WHERE id = ?', [$s['usuario_id']]);
    $atual = is_string($c['atual'] ?? null) ? $c['atual'] : '';
    if (!password_verify($atual, (string) $u['senha_hash'])) {
        throw new ErroApi('senha-atual', 'Senha atual não confere.', 403, ['campo' => 'atual']);
    }
    $nova = gc_senha_nova($c['nova'] ?? null, 'nova');
    if (hash_equals($atual, $nova)) {
        throw gc_invalido('nova', 'A senha nova tem que ser diferente da atual.');
    }
    $hash = gc_hash_senha($nova);
    gc_transacao(static function () use ($s, $hash): void {
        gc_sql('UPDATE usuarios SET senha_hash = ?, senha_em = ? WHERE id = ?', [$hash, gc_agora(), $s['usuario_id']]);
        gc_sql('DELETE FROM sessoes WHERE usuario_id = ? AND id <> ?', [$s['usuario_id'], $s['id']]);
        gc_evento('painel', 'senha-trocada', 'usuario:' . $s['login']);
    });
    return [];
}

// ─── resumo e rateios ───────────────────────────────────────────────────────────────────────────────────────────

/** GET admin-resumo: o que o dono precisa ver primeiro (quem tá esperando confirmar o pagamento). */
function gc_rota_admin_resumo(): array
{
    gc_exigir_dono();
    gc_vencer_reservas();
    $agora = gc_agora();
    $grupos = ['rascunho' => 0, 'aberto' => 0, 'andamento' => 0, 'encerrado' => 0, 'cancelado' => 0];
    foreach (gc_todos('SELECT status, COUNT(*) AS n FROM rateios GROUP BY status') as $l) {
        $g = in_array($l['status'], ['fechado', 'pedido', 'caminho', 'chegou'], true) ? 'andamento' : (string) $l['status'];
        $grupos[$g] = ($grupos[$g] ?? 0) + (int) $l['n'];
    }
    $res = gc_um(
        "SELECT COUNT(*) AS pessoas, COALESCE(SUM(p.quantidade), 0) AS vagas, COALESCE(SUM(p.quantidade * p.preco_unit), 0) AS valor,
                COALESCE(SUM(CASE WHEN p.expira_em <= ? THEN 1 ELSE 0 END), 0) AS vencendo
           FROM participacoes p JOIN rateios r ON r.id = p.rateio_id
          WHERE p.status = 'reservado' AND p.expira_em > ? AND r.status <> 'cancelado'",
        [$agora + 6 * 3600, $agora],
    );
    $conf = gc_um(
        "SELECT COUNT(*) AS pessoas, COALESCE(SUM(p.quantidade), 0) AS vagas, COALESCE(SUM(p.quantidade * p.preco_unit), 0) AS valor
           FROM participacoes p JOIN rateios r ON r.id = p.rateio_id
          WHERE p.status IN ('confirmado','entregue') AND r.status <> 'cancelado'",
    );
    $comTitulo = static fn (array $l): array => gc_participante_admin($l) + ['rateioTitulo' => (string) $l['titulo']];
    $esperando = gc_todos(
        "SELECT p.*, r.titulo FROM participacoes p JOIN rateios r ON r.id = p.rateio_id
          WHERE p.status = 'reservado' AND p.expira_em > ? AND r.status <> 'cancelado'
          ORDER BY p.expira_em ASC, p.id ASC LIMIT 20",
        [$agora],
    );
    $ultimas = gc_todos('SELECT p.*, r.titulo FROM participacoes p JOIN rateios r ON r.id = p.rateio_id ORDER BY p.criado_em DESC, p.id DESC LIMIT 10');
    return [
        'agora' => gc_iso($agora),
        'rateios' => $grupos,
        'reservas' => [
            'pessoas' => (int) $res['pessoas'], 'vagas' => (int) $res['vagas'], 'aReceber' => gc_reais((int) $res['valor']),
            'vencendo' => (int) $res['vencendo'],
        ],
        'confirmado' => ['pessoas' => (int) $conf['pessoas'], 'vagas' => (int) $conf['vagas'], 'valor' => gc_reais((int) $conf['valor'])],
        'esperandoPagamento' => array_map($comTitulo, $esperando),
        'ultimasEntradas' => array_map($comTitulo, $ultimas),
    ];
}

/** GET admin-rateios: todos, com totais. Ordem: aberto, rascunho, em andamento, encerrado, cancelado. */
function gc_rota_admin_rateios(): array
{
    gc_exigir_dono();
    gc_vencer_reservas();
    $ordem = array_flip(['aberto', 'rascunho', 'fechado', 'pedido', 'caminho', 'chegou', 'encerrado', 'cancelado']);
    $linhas = gc_todos('SELECT * FROM rateios');
    usort($linhas, static fn (array $a, array $b): int => [$ordem[$a['status']] ?? 9, -(int) $a['atualizado_em'], $a['id']] <=> [$ordem[$b['status']] ?? 9, -(int) $b['atualizado_em'], $b['id']]);
    $cont = gc_contagens();
    return [
        'agora' => gc_iso(gc_agora()),
        'rateios' => array_map(static fn (array $r): array => gc_rateio_admin($r, $cont[$r['id']] ?? gc_contagem_vazia()), $linhas),
    ];
}

/** Rateio pelo id (corpo ou ?id=), ou 404. @return array<string, mixed> */
function gc_rateio_ou_404(mixed $id): array
{
    $r = gc_id_valido($id) ? gc_rateio_linha((string) $id) : null;
    if ($r === null) {
        throw new ErroApi('nao-encontrado', 'Rateio não encontrado.', 404);
    }
    return $r;
}

function gc_rateio_admin_por_id(string $id): array
{
    return gc_rateio_admin((array) gc_rateio_linha($id), gc_contagem($id));
}

/** GET admin-rateio&id= */
function gc_rota_admin_rateio(): array
{
    gc_exigir_dono();
    $r = gc_rateio_ou_404($_GET['id'] ?? null);
    gc_vencer_reservas((string) $r['id']);
    return ['rateio' => gc_rateio_admin_por_id((string) $r['id'])];
}

/**
 * Lê e confere os campos do rateio. Na edição, campo ausente fica como está.
 * @param array<string, mixed> $c
 * @param array<string, mixed>|null $atual
 * @return array<string, mixed> colunas
 */
function gc_ler_rateio(array $c, ?array $atual): array
{
    $tem = static fn (string $k): bool => array_key_exists($k, $c);
    $col = [];

    $titulo = $tem('titulo') ? gc_texto($c['titulo']) : ($atual['titulo'] ?? null);
    if (!is_string($titulo) || gc_tamanho($titulo) < 3 || gc_tamanho($titulo) > 80) {
        throw gc_invalido('titulo', 'Título de 3 a 80 letras.');
    }
    $col['titulo'] = $titulo;

    $descricao = $tem('descricao') ? gc_texto($c['descricao'], true) : ($atual['descricao'] ?? '');
    if (!is_string($descricao) || gc_tamanho($descricao) > 400) {
        throw gc_invalido('descricao', 'Descrição até 400 letras.');
    }
    $col['descricao'] = $descricao;

    $produto = $tem('produtoId') ? $c['produtoId'] : ($atual['produto_id'] ?? null);
    if ($produto === '' || $produto === null) {
        $produto = null;
    } elseif (!gc_id_valido($produto)) {
        throw gc_invalido('produtoId', 'Id do produto só com a-z, 0-9 e traço (o mesmo do catálogo).');
    }
    $col['produto_id'] = $produto;

    $imagem = $tem('imagem') ? $c['imagem'] : ($atual['imagem'] ?? null);
    if ($imagem === '' || $imagem === null) {
        $imagem = null;
    } elseif (!is_string($imagem) || !preg_match('#^uploads/([a-z0-9]{8,64}\.(?:webp|jpe?g|png))$#', $imagem, $m) || !is_file(gc_pasta_uploads() . '/' . $m[1])) {
        throw gc_invalido('imagem', 'Imagem não encontrada. Envia de novo.');
    }
    $col['imagem'] = $imagem;

    foreach (['titulo' => $titulo, 'descricao' => $descricao, 'produtoId' => (string) $produto] as $campo => $texto) {
        $termo = gc_termo_proibido($texto);
        if ($termo !== null) {
            throw new ErroApi('proibido', 'Derivado do tabaco e cigarro eletrônico não entram no site (Anvisa).', 422, ['campo' => $campo, 'termo' => $termo]);
        }
    }

    $preco = $tem('precoRateio') ? gc_centavos($c['precoRateio']) : ($atual === null ? null : (int) $atual['preco_rateio']);
    if ($preco === null) {
        throw gc_invalido('precoRateio', 'Preço do rateio de R$ 0,01 a R$ 100.000,00.');
    }
    $col['preco_rateio'] = $preco;

    $depois = $tem('precoDepois') ? $c['precoDepois'] : ($atual === null ? null : gc_int_ou_nulo($atual['preco_depois']));
    if ($depois === '' || $depois === null) {
        $depois = null;
    } else {
        $depois = $tem('precoDepois') ? gc_centavos($depois) : (int) $depois;
        if ($depois === null) {
            throw gc_invalido('precoDepois', 'Preço depois que chega de R$ 0,01 a R$ 100.000,00 (ou vazio).');
        }
        if ($depois <= $preco) {
            throw gc_invalido('precoDepois', 'Preço depois que chega tem que ser maior que o do rateio (ou vazio).');
        }
    }
    $col['preco_depois'] = $depois;

    $vagas = $tem('vagas') ? gc_inteiro($c['vagas'], 1, 1000) : ($atual === null ? null : (int) $atual['vagas']);
    if ($vagas === null) {
        throw gc_invalido('vagas', 'Vagas de 1 a 1000.');
    }
    if ($atual !== null) {
        $ocupadas = gc_ocupadas((string) $atual['id']);
        if ($vagas < $ocupadas) {
            throw gc_invalido('vagas', "Já tem $ocupadas vaga(s) ocupada(s): não dá pra deixar menos.", ['minimo' => $ocupadas]);
        }
    }
    $col['vagas'] = $vagas;

    $limite = $tem('limitePorPessoa') ? gc_inteiro($c['limitePorPessoa'], 1, 100) : ($atual === null ? 1 : (int) $atual['limite_por_pessoa']);
    if ($limite === null || $limite > $vagas) {
        throw gc_invalido('limitePorPessoa', 'Limite por pessoa de 1 até o número de vagas.');
    }
    $col['limite_por_pessoa'] = $limite;

    $ufs = $tem('ufs') ? $c['ufs'] : ($atual === null ? null : explode(',', (string) $atual['ufs']));
    $lista = [];
    if (is_array($ufs)) {
        foreach ($ufs as $u) {
            $u = gc_uf($u);
            if ($u === null) {
                throw gc_invalido('ufs', 'Estado inválido na lista.');
            }
            $lista[$u] = true;
        }
    }
    if ($lista === []) {
        throw gc_invalido('ufs', 'Escolhe pelo menos um estado.');
    }
    $col['ufs'] = implode(',', array_keys($lista));

    $min = $tem('previsaoMin') ? gc_inteiro($c['previsaoMin'], 1, 90) : ($atual === null ? 6 : (int) $atual['previsao_min']);
    $max = $tem('previsaoMax') ? gc_inteiro($c['previsaoMax'], 1, 120) : ($atual === null ? 10 : (int) $atual['previsao_max']);
    if ($min === null) {
        throw gc_invalido('previsaoMin', 'Previsão mínima de 1 a 90 dias.');
    }
    if ($max === null || $max < $min) {
        throw gc_invalido('previsaoMax', 'Previsão máxima igual ou maior que a mínima (até 120 dias).');
    }
    $col['previsao_min'] = $min;
    $col['previsao_max'] = $max;

    $fecha = $tem('fechaEm') ? gc_data($c['fechaEm'], 'fechaEm') : ($atual === null ? null : gc_int_ou_nulo($atual['fecha_em']));
    $mudou = $atual === null || $fecha !== gc_int_ou_nulo($atual['fecha_em']);
    if ($fecha !== null && $mudou && $fecha <= gc_agora()) {
        throw gc_invalido('fechaEm', 'Essa data já passou.');
    }
    $col['fecha_em'] = $fecha;

    $reserva = $tem('reservaHoras') ? gc_inteiro($c['reservaHoras'], 1, 168) : ($atual === null ? 24 : (int) $atual['reserva_horas']);
    if ($reserva === null) {
        throw gc_invalido('reservaHoras', 'Reserva de 1 a 168 horas.');
    }
    $col['reserva_horas'] = $reserva;

    if ($tem('demo')) {
        if (!is_bool($c['demo'])) {
            throw gc_invalido('demo', 'Exemplo é sim ou não.');
        }
        $col['demo'] = $c['demo'] ? 1 : 0;
    } else {
        $col['demo'] = $atual === null ? 0 : (int) $atual['demo'];
    }
    return $col;
}

/**
 * POST admin-rateio-salvar: sem id cria (id = slug do título, único; status 'rascunho' ou 'aberto'); com id edita
 * (campo ausente fica como está; preço novo não muda quem já entrou). Encerrado e cancelado não editam.
 */
function gc_rota_admin_rateio_salvar(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    return gc_transacao(static function () use ($c): array {
        $agora = gc_agora();
        if (isset($c['id']) && $c['id'] !== '' && $c['id'] !== null) {
            $atual = gc_rateio_ou_404($c['id']);
            if (in_array($atual['status'], ['encerrado', 'cancelado'], true)) {
                throw new ErroApi('nao-editavel', 'Rateio ' . GC_ROTULO_STATUS[$atual['status']] . ' não edita mais.', 409);
            }
            gc_vencer_reservas((string) $atual['id']);
            $col = gc_ler_rateio($c, $atual);
            $mudou = array_keys(array_filter($col, static fn ($v, $k) => (string) $v !== (string) ($atual[$k] ?? ''), ARRAY_FILTER_USE_BOTH));
            if ($mudou !== []) {
                $sets = implode(', ', array_map(static fn ($k) => "$k = ?", array_keys($col)));
                gc_sql("UPDATE rateios SET $sets, atualizado_em = ? WHERE id = ?", [...array_values($col), $agora, $atual['id']]);
                gc_evento('painel', 'rateio-editado', 'rateio:' . $atual['id'], ['titulo' => $col['titulo'], 'campos' => $mudou]);
                gc_fechar_se_lotou((string) $atual['id']);
            }
            return ['rateio' => gc_rateio_admin_por_id((string) $atual['id'])];
        }

        $col = gc_ler_rateio($c, null);
        $status = $c['status'] ?? 'rascunho';
        if (!in_array($status, ['rascunho', 'aberto'], true)) {
            throw gc_invalido('status', 'Rateio novo nasce em rascunho ou aberto.');
        }
        $base = gc_slug($col['titulo']);
        $id = $base;
        for ($n = 2; gc_rateio_linha($id) !== null; $n++) {
            $id = $n <= 99 ? substr($base, 0, 56) . '-' . $n : substr($base, 0, 50) . '-' . bin2hex(random_bytes(3));
        }
        $col = ['id' => $id] + $col + [
            'status' => $status, 'criado_em' => $agora, 'atualizado_em' => $agora, 'aberto_em' => $status === 'aberto' ? $agora : null,
        ];
        $nomes = implode(', ', array_keys($col));
        $marcas = implode(', ', array_fill(0, count($col), '?'));
        gc_sql("INSERT INTO rateios ($nomes) VALUES ($marcas)", array_values($col));
        gc_evento('painel', 'rateio-criado', 'rateio:' . $id, ['titulo' => $col['titulo'], 'status' => $status]);
        return ['_status' => 201, 'rateio' => gc_rateio_admin_por_id($id)];
    });
}

/**
 * POST admin-rateio-status { id, status }: rascunho→aberto, aberto→fechado, fechado→aberto (reabrir),
 * fechado→pedido→caminho→chegou→encerrado e qualquer→cancelado, com a data de cada passo.
 */
function gc_rota_admin_rateio_status(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    return gc_transacao(static function () use ($c): array {
        $r = gc_rateio_ou_404($c['id'] ?? null);
        $id = (string) $r['id'];
        gc_vencer_reservas($id);
        $de = (string) $r['status'];
        $para = $c['status'] ?? null;
        if (!is_string($para) || !in_array($para, GC_STATUS_RATEIO, true)) {
            throw gc_invalido('status', 'Status inválido.');
        }
        $permitidos = GC_TRANSICOES[$de] ?? [];
        if (!in_array($para, $permitidos, true)) {
            throw new ErroApi('transicao-invalida', 'De ' . GC_ROTULO_STATUS[$de] . ' não dá pra ir pra ' . GC_ROTULO_STATUS[$para] . '.', 409, ['de' => $de, 'para' => $para, 'permitidos' => $permitidos]);
        }
        $agora = gc_agora();
        if ($para === 'aberto') {
            if ($r['fecha_em'] !== null && (int) $r['fecha_em'] <= $agora) {
                throw new ErroApi('prazo-vencido', 'O prazo pra entrar já passou. Muda a data antes de abrir.', 409);
            }
            if (gc_contagem($id)['confirmadas'] >= (int) $r['vagas']) {
                throw new ErroApi('lotado', 'Tá lotado: aumenta as vagas antes de reabrir.', 409);
            }
        }
        $sets = 'status = ?, atualizado_em = ?';
        $p = [$para, $agora];
        if ($de === 'fechado' && $para === 'aberto') {
            $sets .= ', fechado_em = NULL';
        } elseif ($para === 'aberto' && $r['aberto_em'] !== null) {
            // abrir de novo não apaga a data da primeira abertura
        } else {
            $sets .= ', ' . GC_COLUNA_DO_PASSO[$para] . ' = ?';
            $p[] = $agora;
        }
        $p[] = $id;
        gc_sql("UPDATE rateios SET $sets WHERE id = ?", $p);
        gc_evento('painel', 'rateio-status', 'rateio:' . $id, ['titulo' => $r['titulo'], 'de' => $de, 'para' => $para]);
        return ['rateio' => gc_rateio_admin_por_id($id)];
    });
}

/** POST admin-rateio-apagar { id }: só rascunho, exemplo ou sem participação; senão, cancelar. */
function gc_rota_admin_rateio_apagar(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    return gc_transacao(static function () use ($c): array {
        $r = gc_rateio_ou_404($c['id'] ?? null);
        $id = (string) $r['id'];
        $n = (int) gc_valor('SELECT COUNT(*) FROM participacoes WHERE rateio_id = ?', [$id]);
        if (!($r['status'] === 'rascunho' || (bool) $r['demo'] || $n === 0)) {
            throw new ErroApi('use-cancelar', 'Esse rateio já tem gente. Cancela em vez de apagar.', 409, ['participacoes' => $n]);
        }
        gc_sql('DELETE FROM participacoes WHERE rateio_id = ?', [$id]);
        gc_sql('DELETE FROM rateios WHERE id = ?', [$id]);
        gc_evento('painel', 'rateio-apagado', 'rateio:' . $id, ['titulo' => $r['titulo'], 'participacoes' => $n, 'demo' => (bool) $r['demo']]);
        return [];
    });
}

// ─── participantes ──────────────────────────────────────────────────────────────────────────────────────────────

/** GET admin-participantes&rateio=: o rateio e todo mundo dele, na ordem em que entrou. */
function gc_rota_admin_participantes(): array
{
    gc_exigir_dono();
    $r = gc_rateio_ou_404($_GET['rateio'] ?? null);
    $id = (string) $r['id'];
    gc_vencer_reservas($id);
    $linhas = gc_todos('SELECT * FROM participacoes WHERE rateio_id = ? ORDER BY criado_em ASC, id ASC', [$id]);
    return [
        'rateio' => gc_rateio_admin_por_id($id),
        'participantes' => array_map('gc_participante_admin', $linhas),
    ];
}

/** @return array<string, mixed> */
function gc_participacao_ou_404(mixed $id): array
{
    $n = gc_inteiro($id, 1, PHP_INT_MAX >> 1);
    $p = $n === null ? null : gc_um('SELECT * FROM participacoes WHERE id = ?', [$n]);
    if ($p === null) {
        throw new ErroApi('nao-encontrado', 'Participação não encontrada.', 404);
    }
    return $p;
}

/**
 * POST admin-participante-salvar: sem id inclui à mão quem entrou pela DM (status inicial reservado ou
 * confirmado); com id edita nome, WhatsApp, estado, cidade, quantidade e observação. Mesmas regras de vaga.
 */
function gc_rota_admin_participante_salvar(): array
{
    $s = gc_exigir_dono();
    $c = gc_corpo();
    return gc_transacao(static function () use ($c, $s): array {
        $agora = gc_agora();
        $editar = isset($c['id']) && $c['id'] !== null && $c['id'] !== '';
        $atual = $editar ? gc_participacao_ou_404($c['id']) : null;
        $r = gc_rateio_ou_404($atual['rateio_id'] ?? ($c['rateio'] ?? null));
        $rid = (string) $r['id'];
        gc_vencer_reservas($rid);
        if ($atual !== null) {
            $atual = (array) gc_um('SELECT * FROM participacoes WHERE id = ?', [$atual['id']]);
            if (gc_dados_apagados($atual)) {
                throw gc_erro_dados_apagados();
            }
        }
        $tem = static fn (string $k): bool => array_key_exists($k, $c);

        $nome = gc_nome($tem('nome') ? $c['nome'] : ($atual['nome'] ?? null));
        $whatsapp = $tem('whatsapp') ? gc_whatsapp($c['whatsapp']) : ($atual['whatsapp'] ?? null);
        if ($whatsapp === null) {
            throw gc_invalido('whatsapp', 'Esse WhatsApp não fecha. Põe DDD + 9 dígitos.');
        }
        $uf = $tem('uf') ? gc_uf($c['uf']) : ($atual['uf'] ?? null);
        if ($uf === null) {
            throw gc_invalido('uf', 'Escolhe o estado.');
        }
        $cidade = $tem('cidade') ? gc_texto($c['cidade']) : ($atual['cidade'] ?? '');
        if ($cidade === null || gc_tamanho($cidade) > 60) {
            throw gc_invalido('cidade', 'Cidade até 60 letras.');
        }
        $quantidade = $tem('quantidade') ? gc_inteiro($c['quantidade'], 1, 1000) : ($atual === null ? 1 : (int) $atual['quantidade']);
        if ($quantidade === null) {
            throw gc_invalido('quantidade', 'Quantidade de 1 pra cima.');
        }
        $obs = $tem('observacao') ? gc_texto($c['observacao'], true) : ($atual['observacao'] ?? '');
        if ($obs === null || gc_tamanho($obs) > 500) {
            throw gc_invalido('observacao', 'Observação até 500 letras.');
        }

        if ($atual === null) {
            if (!in_array($r['status'], ['aberto', 'fechado', 'pedido', 'caminho', 'chegou'], true)) {
                throw new ErroApi('rateio-fechado', 'Só dá pra incluir gente em rateio aberto ou em andamento.', 409, ['status' => $r['status']]);
            }
            $inicial = $c['status'] ?? 'reservado';
            if (!in_array($inicial, ['reservado', 'confirmado'], true)) {
                throw gc_invalido('status', 'Começa como reservado ou confirmado.');
            }
            [$p, $token] = gc_participacao_criar($r, [
                'nome' => $nome, 'whatsapp' => $whatsapp, 'uf' => $uf, 'cidade' => $cidade, 'quantidade' => $quantidade, 'observacao' => $obs,
            ], 'painel');
            if ($inicial === 'confirmado') {
                $p = gc_confirmar_participacao((int) $p['id'], 'painel', 'painel:' . $s['login'])['participacao'];
            }
            return ['_status' => 201, 'participante' => gc_participante_admin($p), 'token' => $token, 'rateio' => gc_rateio_admin_por_id($rid)];
        }

        $status = gc_status_participacao($atual);
        $ativa = in_array($status, ['reservado', 'confirmado', 'entregue'], true);
        $id = (int) $atual['id'];
        if ($ativa && $whatsapp !== $atual['whatsapp']) {
            $ja = gc_whatsapp_ativo($rid, $whatsapp, $id);
            if ($ja !== null) {
                throw new ErroApi('ja-participa', "Esse WhatsApp já tá nesse rateio (código $ja).", 409, ['codigo' => $ja]);
            }
        }
        if ($quantidade !== (int) $atual['quantidade']) {
            if ($quantidade > (int) $r['limite_por_pessoa']) {
                throw new ErroApi('limite-por-pessoa', 'Aqui é no máximo ' . $r['limite_por_pessoa'] . ' por pessoa.', 409, ['limite' => (int) $r['limite_por_pessoa']]);
            }
            $disp = max(0, (int) $r['vagas'] - gc_ocupadas($rid, $id));
            if ($ativa && $quantidade > $disp) {
                throw new ErroApi('sem-vagas', "Só cabem $disp vaga(s) pra essa pessoa.", 409, ['disponiveis' => $disp]);
            }
        }
        $novo = ['nome' => $nome, 'whatsapp' => $whatsapp, 'uf' => $uf, 'cidade' => $cidade, 'quantidade' => $quantidade, 'observacao' => $obs];
        $mudou = array_keys(array_filter($novo, static fn ($v, $k) => (string) $v !== (string) $atual[$k], ARRAY_FILTER_USE_BOTH));
        if ($mudou !== []) {
            gc_sql(
                'UPDATE participacoes SET nome = ?, whatsapp = ?, uf = ?, cidade = ?, quantidade = ?, observacao = ?, atualizado_em = ? WHERE id = ?',
                [$nome, $whatsapp, $uf, $cidade, $quantidade, $obs, $agora, $id],
            );
            gc_tocar_rateio($rid);
            gc_evento('painel', 'participacao-editada', 'participacao:' . $atual['codigo'], ['rateio' => $rid, 'titulo' => $r['titulo'], 'campos' => $mudou]);
            if (in_array('quantidade', $mudou, true)) {
                gc_fechar_se_lotou($rid);
            }
        }
        return ['participante' => gc_participante_admin((array) gc_um('SELECT * FROM participacoes WHERE id = ?', [$id])), 'rateio' => gc_rateio_admin_por_id($rid)];
    });
}

/**
 * POST admin-participante-status { id, status }: confirmado (pagamento caiu: o contador sobe), cancelado,
 * entregue, reservado (voltar: desfaz a confirmação ou revive reserva vencida/cancelada, se couber).
 */
function gc_rota_admin_participante_status(): array
{
    $s = gc_exigir_dono();
    $c = gc_corpo();
    return gc_transacao(static function () use ($c, $s): array {
        $p = gc_participacao_ou_404($c['id'] ?? null);
        $rid = (string) $p['rateio_id'];
        gc_vencer_reservas($rid);
        $p = (array) gc_um('SELECT * FROM participacoes WHERE id = ?', [$p['id']]);
        $r = (array) gc_rateio_linha($rid);
        $id = (int) $p['id'];
        $de = (string) $p['status'];
        $para = $c['status'] ?? null;
        $mapa = [
            'reservado' => ['confirmado', 'cancelado'],
            'expirado' => ['confirmado', 'reservado', 'cancelado'],
            'cancelado' => ['confirmado', 'reservado'],
            'confirmado' => ['entregue', 'cancelado', 'reservado'],
            'entregue' => ['confirmado'],
        ];
        if (!is_string($para) || !in_array($para, ['reservado', 'confirmado', 'cancelado', 'entregue'], true)) {
            throw gc_invalido('status', 'Status inválido.');
        }
        if ($para === $de) {
            // já está assim (outro aparelho, ou o toque de novo depois do "demorou"): nada muda, nada vai pra auditoria
            return ['participante' => gc_participante_admin($p), 'rateio' => gc_rateio_admin_por_id($rid), 'jaEstava' => true];
        }
        if (in_array($para, ['confirmado', 'reservado'], true) && gc_dados_apagados($p)) {
            throw gc_erro_dados_apagados();
        }
        if (!in_array($para, $mapa[$de] ?? [], true)) {
            throw new ErroApi('transicao-invalida', 'De ' . GC_ROTULO_STATUS[$de] . ' não dá pra ir pra ' . GC_ROTULO_STATUS[$para] . '.', 409, ['de' => $de, 'para' => $para, 'permitidos' => $mapa[$de] ?? []]);
        }
        if ($r['status'] === 'cancelado' && $para !== 'cancelado') {
            throw new ErroApi('rateio-cancelado', 'Esse rateio foi cancelado.', 409);
        }
        if ($para === 'confirmado' && $de !== 'entregue') {
            gc_confirmar_participacao($id, 'painel', 'painel:' . $s['login']);
        } else {
            $agora = gc_agora();
            if ($para === 'reservado' && $de !== 'confirmado') {
                $ja = gc_whatsapp_ativo($rid, (string) $p['whatsapp'], $id);
                if ($ja !== null) {
                    throw new ErroApi('ja-participa', "Esse WhatsApp já tem outra vaga nesse rateio ($ja).", 409, ['codigo' => $ja]);
                }
                $disp = max(0, (int) $r['vagas'] - gc_ocupadas($rid, $id));
                if ((int) $p['quantidade'] > $disp) {
                    throw new ErroApi('sem-vagas', $disp === 0 ? 'Não sobrou vaga pra essa reserva.' : "Só sobrou $disp vaga(s).", 409, ['disponiveis' => $disp]);
                }
            }
            $sql = match ($para) {
                'reservado' => 'status = \'reservado\', expira_em = ?, confirmado_em = NULL, confirmado_por = NULL, cancelado_em = NULL, expirado_em = NULL',
                'cancelado' => 'status = \'cancelado\', cancelado_em = ?, expira_em = NULL',
                'entregue' => 'status = \'entregue\', entregue_em = ?',
                default => 'status = \'confirmado\', entregue_em = NULL, atualizado_em = ?', // entregue → confirmado (desfaz a entrega)
            };
            $quando = $para === 'reservado' ? $agora + (int) $r['reserva_horas'] * 3600 : $agora;
            if ($para === 'confirmado') {
                gc_sql("UPDATE participacoes SET $sql WHERE id = ?", [$agora, $id]);
            } else {
                gc_sql("UPDATE participacoes SET $sql, atualizado_em = ? WHERE id = ?", [$quando, $agora, $id]);
            }
            gc_tocar_rateio($rid);
            gc_evento('painel', 'participacao-status', 'participacao:' . $p['codigo'], ['rateio' => $rid, 'titulo' => $r['titulo'], 'de' => $de, 'para' => $para]);
        }
        return ['participante' => gc_participante_admin((array) gc_um('SELECT * FROM participacoes WHERE id = ?', [$id])), 'rateio' => gc_rateio_admin_por_id($rid)];
    });
}

/**
 * POST admin-participante-apagar { id }: apaga os dados pessoais de quem pediu (LGPD) e deixa a vaga na conta
 * (quantidade, valor, status, datas). Vaga ativa (reservada ou paga, rateio em curso) cancela antes.
 */
function gc_rota_admin_participante_apagar(): array
{
    gc_exigir_dono();
    $c = gc_corpo();
    return gc_transacao(static function () use ($c): array {
        $p = gc_participacao_ou_404($c['id'] ?? null);
        $rid = (string) $p['rateio_id'];
        gc_vencer_reservas($rid);
        $p = (array) gc_um('SELECT * FROM participacoes WHERE id = ?', [$p['id']]);
        $r = (array) gc_rateio_linha($rid);
        if (in_array($p['status'], ['reservado', 'confirmado'], true) && !in_array($r['status'], ['encerrado', 'cancelado'], true)) {
            throw new ErroApi('participacao-ativa', 'Essa vaga tá ativa. Cancela antes de apagar os dados.', 409);
        }
        // o token do aparelho também para de valer
        gc_sql(
            "UPDATE participacoes SET nome = 'Dados apagados', whatsapp = '', cidade = '', observacao = '', token_hash = ?, atualizado_em = ? WHERE id = ?",
            [hash('sha256', bin2hex(random_bytes(16))), gc_agora(), $p['id']],
        );
        gc_tocar_rateio($rid);
        gc_evento('painel', 'participacao-dados-apagados', 'participacao:' . $p['codigo'], ['rateio' => $rid, 'titulo' => $r['titulo']]);
        return ['participante' => gc_participante_admin((array) gc_um('SELECT * FROM participacoes WHERE id = ?', [$p['id']])), 'rateio' => gc_rateio_admin_por_id($rid)];
    });
}

/**
 * GET admin-backup: cópia do banco inteira e coerente (VACUUM INTO), pra baixar e guardar. Copiar o loja.sqlite à
 * mão pode sair sem as últimas mudanças, que ficam no loja.sqlite-wal até o SQLite juntar.
 */
function gc_rota_admin_backup(): array
{
    gc_exigir_dono();
    $db = gc_db();
    $dir = gc_pasta_dados();
    foreach (scandir($dir) ?: [] as $n) {
        // sobra de uma cópia que não terminou (o PHP caiu no meio)
        if (preg_match('/^copia-[0-9a-f]{16}\.sqlite$/', $n) && (int) @filemtime("$dir/$n") < time() - 3600) {
            @unlink("$dir/$n");
        }
    }
    gc_evento('painel', 'backup-baixado', 'banco');
    $tmp = $dir . '/copia-' . bin2hex(random_bytes(8)) . '.sqlite';
    try {
        try {
            $db->prepare('VACUUM INTO ?')->execute([$tmp]);
        } catch (PDOException) {
            // SQLite antes do 3.27 não tem VACUUM INTO: junta o diário no arquivo e copia
            $db->exec('PRAGMA wal_checkpoint(TRUNCATE)');
            if (!copy($dir . '/loja.sqlite', $tmp)) {
                throw new RuntimeException('não deu pra copiar o banco');
            }
        }
        $quando = (new DateTimeImmutable('@' . gc_agora()))->setTimezone(new DateTimeZone('America/Sao_Paulo'))->format('Y-m-d-Hi');
        http_response_code(200);
        gc_cabecalhos('application/vnd.sqlite3');
        header('Content-Disposition: attachment; filename="greencheese-loja-' . $quando . '.sqlite"');
        header('Content-Length: ' . filesize($tmp));
        readfile($tmp);
    } finally {
        @unlink($tmp);
    }
    exit;
}

/** Célula do CSV: entre aspas quando precisa; fórmula (=, +, -, @) vira texto (o Excel não executa). */
function gc_csv_celula(string $v): string
{
    if ($v !== '' && str_contains("=+-@\t\r", $v[0])) {
        $v = "'" . $v;
    }
    return preg_match('/[;"\r\n]/', $v) ? '"' . str_replace('"', '""', $v) . '"' : $v;
}

function gc_data_sp(?int $t): string
{
    if ($t === null) {
        return '';
    }
    return (new DateTimeImmutable('@' . $t))->setTimezone(new DateTimeZone('America/Sao_Paulo'))->format('d/m/Y H:i');
}

/** GET admin-participantes-csv&rateio=: planilha pro Excel (separador ; e BOM UTF-8). */
function gc_rota_admin_participantes_csv(): array
{
    gc_exigir_dono();
    $r = gc_rateio_ou_404($_GET['rateio'] ?? null);
    $id = (string) $r['id'];
    gc_vencer_reservas($id);
    $linhas = [[
        'Código', 'Nome', 'WhatsApp', 'Estado', 'Cidade', 'Quantidade', 'Valor da vaga (R$)', 'Total (R$)', 'Status',
        'Entrou por', 'Entrou em', 'Confirmado em', 'Confirmado por', 'Entregue em', 'Observação',
    ]];
    foreach (gc_todos('SELECT * FROM participacoes WHERE rateio_id = ? ORDER BY criado_em ASC, id ASC', [$id]) as $p) {
        $linhas[] = [
            (string) $p['codigo'], (string) $p['nome'], gc_whatsapp_formatado((string) $p['whatsapp']), strtoupper((string) $p['uf']),
            (string) $p['cidade'], (string) $p['quantidade'], gc_reais_texto((int) $p['preco_unit']),
            gc_reais_texto((int) $p['quantidade'] * (int) $p['preco_unit']), GC_ROTULO_STATUS[gc_status_participacao($p)],
            $p['origem'] === 'site' ? 'site' : 'painel', gc_data_sp((int) $p['criado_em']), gc_data_sp(gc_int_ou_nulo($p['confirmado_em'])),
            (string) ($p['confirmado_por'] ?? ''), gc_data_sp(gc_int_ou_nulo($p['entregue_em'])), (string) $p['observacao'],
        ];
    }
    $csv = "\xEF\xBB\xBF";
    foreach ($linhas as $l) {
        $csv .= implode(';', array_map('gc_csv_celula', $l)) . "\r\n";
    }
    // a data no horário de Brasília, como a da cópia do banco (em UTC, depois das 21h saía o dia seguinte)
    $dia = (new DateTimeImmutable('@' . gc_agora()))->setTimezone(new DateTimeZone('America/Sao_Paulo'))->format('Y-m-d');
    $arquivo = 'rateio-' . $id . '-' . $dia . '.csv';
    http_response_code(200);
    gc_cabecalhos('text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $arquivo . '"');
    header('Content-Length: ' . strlen($csv));
    echo $csv;
    exit;
}

// ─── eventos ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Frase curta do evento, pra lista do painel ('Pagamento de RAT-K8EA confirmado em "Arizona…"'). */
function gc_evento_texto(array $e, array $d): string
{
    // os da loja (produtos, categorias, estados, stories, prêmios) têm a frase no módulo dela
    $loja = function_exists('gc_loja_evento_texto') ? gc_loja_evento_texto((string) $e['acao'], $d) : null;
    if ($loja !== null) {
        return $loja;
    }
    $alvo = (string) preg_replace('/^[a-z]+:/', '', (string) $e['alvo']);
    // o rateio pelo título (o id só se o título não veio)
    $t = isset($d['titulo']) ? '"' . $d['titulo'] . '"' : (string) ($d['rateio'] ?? $alvo);
    $rot = static fn ($s): string => GC_ROTULO_STATUS[(string) $s] ?? (string) $s;
    $vagas = static fn ($n): string => (int) $n === 1 ? '1 vaga' : (int) $n . ' vagas';
    return match ((string) $e['acao']) {
        'painel-instalado' => 'Painel instalado',
        'entrou' => 'Entrou no painel',
        'saiu' => 'Saiu do painel',
        'senha-trocada' => 'Trocou a senha',
        'senha-recuperada' => 'Senha nova com o código de instalação',
        'rateio-exemplo' => "Rateio de exemplo $t",
        'rateio-criado' => "Criou o rateio $t",
        'rateio-editado' => "Editou o rateio $t",
        'rateio-status' => match ((string) ($d['para'] ?? '')) {
            'aberto' => ($d['de'] ?? '') === 'fechado' ? "Reabriu o rateio $t" : "Publicou o rateio $t",
            'fechado' => "Fechou o rateio $t",
            'pedido' => "Pedido feito do rateio $t",
            'caminho' => "Rateio $t a caminho",
            'chegou' => "Rateio $t chegou",
            'encerrado' => "Encerrou o rateio $t",
            'cancelado' => "Cancelou o rateio $t",
            default => "Rateio $t: " . $rot($d['de'] ?? '') . ' → ' . $rot($d['para'] ?? ''),
        },
        'rateio-apagado' => "Apagou o rateio $t",
        'rateio-fechou-sozinho' => "Rateio $t lotou e fechou sozinho",
        'participacao-reservada' => "$alvo reservou " . $vagas($d['quantidade'] ?? 1) . " pelo site em $t",
        'participacao-incluida' => "$alvo incluído à mão em $t",
        'participacao-editada' => "Editou $alvo em $t",
        'participacao-confirmada' => "Pagamento de $alvo confirmado em $t" . ($e['origem'] === 'pix' ? ' (Pix)' : ''),
        'participacao-status' => match ((string) ($d['de'] ?? '') . '>' . (string) ($d['para'] ?? '')) {
            'confirmado>entregue' => "Entregou $alvo em $t",
            'entregue>confirmado' => "Desfez a entrega de $alvo em $t",
            'confirmado>reservado' => "Desfez o pagamento de $alvo em $t",
            'expirado>reservado', 'cancelado>reservado' => "Reservou de novo $alvo em $t",
            'reservado>cancelado', 'expirado>cancelado' => "Cancelou a reserva $alvo em $t",
            'confirmado>cancelado' => "Cancelou a vaga paga $alvo em $t",
            default => "$alvo em $t: " . $rot($d['de'] ?? '') . ' → ' . $rot($d['para'] ?? ''),
        },
        'participacao-expirada' => "Reserva $alvo venceu em $t",
        'participacao-dados-apagados' => "Apagou os dados de $alvo (LGPD)",
        'imagem-enviada' => 'Enviou uma imagem',
        'backup-baixado' => 'Baixou a cópia do banco',
        default => (string) $e['acao'],
    };
}

/** GET admin-eventos: os últimos 100, do mais novo pro mais velho. */
function gc_rota_admin_eventos(): array
{
    gc_exigir_dono();
    $out = [];
    foreach (gc_todos('SELECT e.*, u.login FROM eventos e LEFT JOIN usuarios u ON u.id = e.usuario_id ORDER BY e.id DESC LIMIT 100') as $e) {
        $d = json_decode((string) $e['detalhe'], true);
        $d = is_array($d) ? $d : [];
        $out[] = [
            'id' => (int) $e['id'],
            'em' => gc_iso((int) $e['em']),
            'origem' => (string) $e['origem'],
            'usuario' => $e['login'] === null ? null : (string) $e['login'],
            'acao' => (string) $e['acao'],
            'alvo' => (string) $e['alvo'],
            'detalhe' => (object) $d,
            'texto' => gc_evento_texto($e, $d),
        ];
    }
    return ['eventos' => $out];
}

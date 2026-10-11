<?php
declare(strict_types=1);
defined('GC_API') || exit;

// O que deixa o dono independente de quem fez o site:
// - a lista "Pra deixar a loja pronta" do Resumo e o que só o servidor sabe pra ela (senha trocada, equipe, avisos,
//   cópia de segurança), com o "pular" de cada item guardado aqui (admin-pronto, admin-pronto-salvar);
// - quando foi a última cópia de segurança (o admin-backup anota em ajustes.copia_em; banco de antes: a última
//   "backup-baixado" da Atividade);
// - a senha do dono pelo WhatsApp da loja, como segunda via (admin-recuperar-codigo e admin-recuperar-codigo-entrar,
//   abertas como o admin-recuperar: ainda não tem sessão). Código de 6 números, só o hash no banco, vale 10 minutos e
//   uma vez, 5 chutes; 1 pedido por minuto, 3 por hora por login, 5 por hora por IP e 10 por hora na loja inteira; a
//   resposta é a mesma pra login que existe ou não (e o envio sai depois dela). Só dono ativo recebe; gerente e
//   atendente resolvem com o dono (Equipe → Gerar senha provisória). O dono desliga em Conta.
// Migrações na faixa 300–399 (gc_migracoes_dono, registradas em banco.php): os códigos da senha pelo WhatsApp (300) e
// a marca "Bebida alcoólica" das categorias (301).

const GC_REC_DURA = 600;
const GC_REC_TENTATIVAS = 5;
const GC_REC_PAUSA = 60;
const GC_MSG_REC = 'Muito pedido seguido. Espera um pouco e tenta de novo.';
/** Os itens da lista "Pra deixar a loja pronta" (a ordem é a da tela). */
const GC_PRONTO_ITENS = ['senha', 'estados', 'exemplos', 'precos', 'fotos', 'equipe', 'avisos', 'copia'];

/** @return array<int, string|callable(PDO): void> */
function gc_migracoes_dono(): array
{
    $m = [
        300 => <<<'SQL'
        CREATE TABLE painel_codigos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          codigo_hash TEXT NOT NULL,
          criado_em INTEGER NOT NULL,
          expira_em INTEGER NOT NULL,
          tentativas INTEGER NOT NULL DEFAULT 0,
          usado_em INTEGER
        );
        CREATE INDEX painel_codigos_usuario ON painel_codigos(usuario_id, criado_em);
        SQL,
    ];
    // a marca "Bebida alcoólica" da categoria (alcool): a categoria fica fora da rua do mercador e de qualquer prêmio
    // (alcoólica é sempre bebida: loja-validar.php). Num banco que já tinha a loja, os Destilados da semente (a
    // categoria de álcool dela) ficam marcados; banco novo é semeado já com a marca. Mexe na tabela da loja: só entra
    // com o módulo da loja carregado (como a 206 com o dos pedidos).
    if (function_exists('gc_migracoes_loja')) {
        $m[301] = <<<'SQL'
        ALTER TABLE loja_categorias ADD COLUMN alcool INTEGER NOT NULL DEFAULT 0;
        UPDATE loja_categorias SET alcool = 1 WHERE id = 'destilados' AND bebida = 1;
        SQL;
    }
    return $m;
}

// ─── cópia de segurança ─────────────────────────────────────────────────────────────────────────────────────────

/** O admin-backup chama: a cópia de agora. */
function gc_copia_marcar(): void
{
    gc_ajuste_definir('copia_em', (string) gc_agora());
}

/** Quando foi a última cópia (null = nenhuma). */
function gc_copia_ultima(): ?int
{
    $v = gc_ajuste('copia_em');
    if ($v !== null && ctype_digit($v)) {
        return (int) $v;
    }
    // banco de antes deste módulo: a última cópia que ficou na Atividade
    return gc_int_ou_nulo(gc_valor("SELECT MAX(em) FROM eventos WHERE acao = 'backup-baixado'"));
}

// ─── senha pelo WhatsApp da loja ────────────────────────────────────────────────────────────────────────────────

/** O WhatsApp da loja (Ajustes da loja), ou null. */
function gc_whatsapp_da_loja(): ?string
{
    return gc_whatsapp(gc_ajuste('loja.whatsapp') ?? '');
}

/**
 * Situação da segunda via: disponivel = os avisos tão ligados e a loja tem WhatsApp; ligado = o dono não desligou;
 * para = o WhatsApp da loja mascarado ('(33) 9••••-9036').
 * @return array{disponivel: bool, ligado: bool, para: string|null}
 */
function gc_recuperacao_whatsapp(): array
{
    $para = gc_whatsapp_da_loja();
    $avisos = function_exists('gc_avisos_situacao') && gc_avisos_situacao()['ligado'];
    return [
        'disponivel' => $avisos && $para !== null,
        'ligado' => gc_ajuste('recuperar_whatsapp') !== '0',
        'para' => $para === null ? null : '(' . substr($para, 2, 2) . ') 9••••-' . substr($para, -4),
    ];
}

/** Dá pra pedir o código agora? (o admin-sessao conta pra tela de "Esqueci a senha"; não diz nada de login nenhum) */
function gc_recuperacao_whatsapp_valendo(): bool
{
    if (!gc_instalado()) {
        return false;
    }
    $r = gc_recuperacao_whatsapp();
    return $r['disponivel'] && $r['ligado'];
}

function gc_rec_hash(int $usuarioId, string $codigo): string
{
    return hash_hmac('sha256', "senha-dono|$usuarioId|$codigo", gc_sal());
}

/** Login como veio (minúsculo, sem espaço); '' = não veio. */
function gc_rec_login(mixed $v): string
{
    return is_string($v) ? strtolower(trim(substr($v, 0, 64))) : '';
}

/** Dono ativo com esse login, ou null (gerente, atendente, desativado e login que não existe dão no mesmo). */
function gc_rec_dono(string $login): ?array
{
    if ($login === '') {
        return null;
    }
    $u = gc_um('SELECT * FROM usuarios WHERE login = ?', [$login]);
    return $u !== null && ($u['papel'] ?? 'dono') === 'dono' && (int) ($u['ativo'] ?? 1) === 1 ? $u : null;
}

/**
 * POST admin-recuperar-codigo { login }: manda um código de 6 números pro WhatsApp da loja, se o login for de um dono.
 * A resposta é sempre a mesma (enviado, pra onde e até quando) e a mensagem sai depois dela.
 */
function gc_rota_admin_recuperar_codigo(): array
{
    gc_conferir_origem();
    $c = gc_corpo();
    if (!gc_instalado()) {
        throw new ErroApi('nao-instalado', 'O painel ainda não foi instalado.', 409);
    }
    $rec = gc_recuperacao_whatsapp();
    if (!$rec['disponivel'] || !$rec['ligado']) {
        throw new ErroApi('sem-whatsapp', 'A senha pelo WhatsApp da loja tá desligada. Pede pra outro dono gerar uma senha provisória pra ti (Equipe), ou um código de instalação novo pra quem cuida do site.', 409);
    }
    $login = gc_rec_login($c['login'] ?? null);
    if ($login === '') {
        throw gc_invalido('login', 'Põe teu login.');
    }
    $agora = gc_agora();
    $kLogin = gc_chave_limite('login', $login);
    // um por minuto pro mesmo login (antes dos limites: esperar não gasta tentativa)
    $ultimo = gc_int_ou_nulo(gc_valor('SELECT MAX(em) FROM tentativas WHERE tipo = ? AND chave = ?', ['rec-codigo-login', $kLogin]));
    if ($ultimo !== null && $agora - $ultimo < GC_REC_PAUSA) {
        throw new ErroApi('muitas-tentativas', 'Acabou de sair um código. Espera um pouquinho pra pedir outro.', 429, ['esperaSegundos' => GC_REC_PAUSA - ($agora - $ultimo)]);
    }
    gc_limite('rec-codigo-ip', gc_chave_limite('ip', gc_ip()), 5, 3600, GC_MSG_REC);
    gc_limite('rec-codigo-login', $kLogin, 3, 3600, GC_MSG_REC);
    gc_limite('rec-codigo-loja', gc_chave_limite('loja'), 10, 3600, GC_MSG_REC);
    $u = gc_rec_dono($login);
    $codigo = sprintf('%06d', random_int(0, 999999));
    $hash = gc_rec_hash((int) ($u['id'] ?? 0), $codigo);
    $id = null;
    if ($u !== null) {
        $id = gc_transacao(static function () use ($u, $hash, $agora): int {
            // só o último vale
            gc_sql('UPDATE painel_codigos SET expira_em = ? WHERE usuario_id = ? AND usado_em IS NULL AND expira_em > ?', [$agora, $u['id'], $agora]);
            if (random_int(1, 20) === 1) {
                gc_sql('DELETE FROM painel_codigos WHERE expira_em < ?', [$agora - 86400]);
            }
            gc_evento('painel', 'senha-codigo-pedido', 'usuario:' . $u['login'], [], (int) $u['id']);
            return gc_inserir('INSERT INTO painel_codigos (usuario_id, codigo_hash, criado_em, expira_em) VALUES (?, ?, ?, ?)', [$u['id'], $hash, $agora, $agora + GC_REC_DURA]);
        });
    }
    // sempre com trabalho depois da resposta (a resposta sai igual, com ou sem dono)
    gc_depois(static function () use ($u, $codigo, $id): void {
        if ($u === null || $id === null) {
            return;
        }
        $para = gc_whatsapp_da_loja();
        if ($para === null) {
            return;
        }
        $texto = "*$codigo* é o código pra trocar a senha do painel da Green Cheese (login @{$u['login']}). Vale por 10 minutos, uma vez só.\n\nSe não foi tu que pediu, ignora: a senha continua a mesma.";
        $mascarado = '(' . substr($para, 2, 2) . ') 9••••-' . substr($para, -4);
        $r = gc_whatsapp_mandar($texto, ['tipo' => 'numero', 'valor' => $para], 'codigo-senha', 'usuario:' . $u['login'], 'Código pra trocar a senha do painel (@' . $u['login'] . ')', [], 'numero:' . $mascarado);
        if (!$r['ok']) {
            gc_sql('UPDATE painel_codigos SET expira_em = ? WHERE id = ?', [gc_agora(), $id]);
            gc_log('[recuperar-codigo] não saiu: ' . $r['erro']);
        }
    });
    return [
        'enviado' => true,
        'para' => $rec['para'],
        'expiraEm' => gc_iso($agora + GC_REC_DURA),
        'mensagem' => 'Se esse login for de um dono da loja, o código chega no WhatsApp da loja (' . $rec['para'] . ') em instantes. Vale 10 minutos.',
    ];
}

/**
 * POST admin-recuperar-codigo-entrar { login, codigo, senha }: o código certo troca a senha, derruba as sessões desse
 * dono e entra. Errado, vencido, usado ou login que não é de dono: a mesma resposta.
 */
function gc_rota_admin_recuperar_codigo_entrar(): array
{
    gc_conferir_origem();
    $c = gc_corpo();
    if (!gc_instalado()) {
        throw new ErroApi('nao-instalado', 'O painel ainda não foi instalado.', 409);
    }
    $login = gc_rec_login($c['login'] ?? null);
    if ($login === '') {
        throw gc_invalido('login', 'Põe teu login.');
    }
    $codigo = is_string($c['codigo'] ?? null) || is_int($c['codigo'] ?? null) ? (string) preg_replace('/\D/', '', (string) $c['codigo']) : '';
    if (preg_match('/^\d{6}$/', $codigo) !== 1) {
        throw gc_invalido('codigo', 'O código tem 6 números.');
    }
    $senha = gc_senha_nova($c['senha'] ?? null);
    gc_limite('rec-entrar-ip', gc_chave_limite('ip', gc_ip()), 10, 900, 'Muita tentativa errada. Espera uns minutos e tenta de novo.');
    gc_limite('rec-entrar-login', gc_chave_limite('login', $login), 10, 900, 'Muita tentativa errada. Espera uns minutos e tenta de novo.');
    $errado = new ErroApi('codigo-invalido', 'Código errado ou vencido. Confere no WhatsApp da loja ou pede outro.', 403, ['campo' => 'codigo']);
    $agora = gc_agora();
    $u = gc_rec_dono($login);
    $conta = gc_rec_hash((int) ($u['id'] ?? 0), $codigo);
    $k = $u === null ? null : gc_um(
        'SELECT * FROM painel_codigos WHERE usuario_id = ? AND usado_em IS NULL AND expira_em > ? AND tentativas < ? ORDER BY id DESC LIMIT 1',
        [$u['id'], $agora, GC_REC_TENTATIVAS],
    );
    if ($u === null || $k === null) {
        throw $errado;
    }
    if (!hash_equals((string) $k['codigo_hash'], $conta)) {
        // o chute errado conta (no 5º o código para de valer)
        $n = (int) $k['tentativas'] + 1;
        gc_sql('UPDATE painel_codigos SET tentativas = ?, expira_em = CASE WHEN ? >= ? THEN ? ELSE expira_em END WHERE id = ?', [$n, $n, GC_REC_TENTATIVAS, $agora, $k['id']]);
        throw $errado;
    }
    $hash = gc_hash_senha($senha);
    return gc_transacao(static function () use ($u, $k, $hash, $agora, $errado): array {
        // de novo, dentro da trava: o mesmo código em dois pedidos juntos entra uma vez só
        if (gc_valor('SELECT 1 FROM painel_codigos WHERE id = ? AND usado_em IS NULL AND expira_em > ?', [$k['id'], $agora]) === null) {
            throw $errado;
        }
        gc_sql('UPDATE painel_codigos SET usado_em = ? WHERE id = ?', [$agora, $k['id']]);
        gc_sql('UPDATE painel_codigos SET expira_em = ? WHERE usuario_id = ? AND usado_em IS NULL AND expira_em > ?', [$agora, $u['id'], $agora]);
        gc_sql('UPDATE usuarios SET senha_hash = ?, senha_em = ? WHERE id = ?', [$hash, $agora, $u['id']]);
        if (array_key_exists('trocar_senha', $u)) {
            gc_sql('UPDATE usuarios SET trocar_senha = 0 WHERE id = ?', [$u['id']]);
        }
        gc_sql('DELETE FROM sessoes WHERE usuario_id = ?', [$u['id']]);
        $s = gc_sessao_criar((int) $u['id']);
        gc_evento('painel', 'senha-recuperada-whatsapp', 'usuario:' . $u['login'], [], (int) $u['id']);
        // o grupo da loja fica sabendo (se não foi o dono quem trocou, ele vê ali)
        if (function_exists('gc_aviso_enfileirar')) {
            gc_aviso_enfileirar('', 'seguranca', 'usuario:' . $u['login'], "*SENHA DO PAINEL TROCADA* · @{$u['login']}\nTrocada agora com o código do WhatsApp da loja. Se não foi tu, fala com quem cuida do site.");
        }
        return ['usuario' => gc_usuario_publico(), 'csrf' => $s['csrf']];
    });
}

// ─── a lista "Pra deixar a loja pronta" e os ajustes do dono ────────────────────────────────────────────────────

/** @return list<string> */
function gc_pronto_pulados(): array
{
    $j = json_decode((string) gc_ajuste('pronto_pulados'), true);
    return is_array($j) ? array_values(array_intersect(GC_PRONTO_ITENS, array_filter($j, 'is_string'))) : [];
}

/** O que só o servidor sabe pra lista do Resumo, pra Conta (cópia e senha esquecida). */
function gc_pronto(array $s): array
{
    $u = (array) gc_um('SELECT * FROM usuarios WHERE id = ?', [$s['usuario_id']]);
    $outrosDonos = gc_todos("SELECT nome, login FROM usuarios WHERE papel = 'dono' AND COALESCE(ativo, 1) = 1 AND id <> ? ORDER BY id", [$s['usuario_id']]);
    $copia = gc_copia_ultima();
    $instalado = gc_int_ou_nulo(gc_ajuste('instalado_em'));
    return [
        'agora' => gc_iso(gc_agora()),
        'instaladoEm' => gc_iso($instalado),
        // a senha é dele (trocou depois de criar o acesso: a da entrega, a provisória ou a do primeiro acesso)
        'senhaTrocada' => (int) $u['senha_em'] > (int) $u['criado_em'],
        'equipe' => (int) gc_valor('SELECT COUNT(*) FROM usuarios WHERE COALESCE(ativo, 1) = 1 AND id <> ?', [$s['usuario_id']]),
        'outrosDonos' => array_map(static fn (array $x): array => ['nome' => (string) $x['nome'], 'login' => (string) $x['login']], $outrosDonos),
        'avisos' => ['ligado' => function_exists('gc_avisos_situacao') && gc_avisos_situacao()['ligado']],
        'copia' => ['ultimaEm' => gc_iso($copia)],
        'pulados' => gc_pronto_pulados(),
        'recuperacao' => gc_recuperacao_whatsapp(),
    ];
}

/** GET admin-pronto */
function gc_rota_admin_pronto(): array
{
    return gc_pronto(gc_exigir_dono());
}

/**
 * POST admin-pronto-salvar { pular?: { item, pular }, recuperarPeloWhatsapp?: bool }: tira (ou volta) um item da lista
 * do Resumo; liga ou desliga a senha esquecida pelo WhatsApp da loja. Devolve o mesmo do admin-pronto.
 */
function gc_rota_admin_pronto_salvar(): array
{
    $s = gc_exigir_dono();
    $c = gc_corpo();
    gc_transacao(static function () use ($c): void {
        if (array_key_exists('pular', $c)) {
            $p = is_array($c['pular']) ? $c['pular'] : [];
            $item = $p['item'] ?? null;
            if (!is_string($item) || !in_array($item, GC_PRONTO_ITENS, true)) {
                throw gc_invalido('pular', 'Item da lista que não existe.');
            }
            if (!is_bool($p['pular'] ?? null)) {
                throw gc_invalido('pular', 'Pular é sim ou não.');
            }
            $lista = gc_pronto_pulados();
            $nova = $p['pular'] ? array_values(array_unique([...$lista, $item])) : array_values(array_diff($lista, [$item]));
            if ($nova !== $lista) {
                gc_ajuste_definir('pronto_pulados', (string) json_encode($nova));
                gc_evento('painel', 'pronto-pulou', 'pronto:' . $item, ['item' => $item, 'pular' => $p['pular']]);
            }
        }
        if (array_key_exists('recuperarPeloWhatsapp', $c)) {
            if (!is_bool($c['recuperarPeloWhatsapp'])) {
                throw gc_invalido('recuperarPeloWhatsapp', 'É ligado ou desligado.');
            }
            $antes = gc_ajuste('recuperar_whatsapp') !== '0';
            if ($antes !== $c['recuperarPeloWhatsapp']) {
                gc_ajuste_definir('recuperar_whatsapp', $c['recuperarPeloWhatsapp'] ? '1' : '0');
                gc_evento('painel', 'recuperacao-whatsapp', 'conta', ['ligado' => $c['recuperarPeloWhatsapp']]);
            }
        }
    });
    return gc_pronto($s);
}

/** Frase dos eventos deste módulo (gc_evento_texto chama). */
function gc_dono_evento_texto(string $acao, string $alvo, array $d): ?string
{
    $itens = [
        'senha' => 'Troca a senha', 'estados' => 'Horário e taxa de cada estado', 'exemplos' => 'Apagar os dados de exemplo', 'precos' => 'Preço nos produtos',
        'fotos' => 'Fotos dos produtos', 'equipe' => 'Cadastrar a equipe', 'avisos' => 'Avisos no WhatsApp', 'copia' => 'A 1ª cópia de segurança',
    ];
    return match ($acao) {
        'senha-codigo-pedido' => 'Pediu um código pra trocar a senha (WhatsApp da loja)',
        'senha-recuperada-whatsapp' => 'Senha nova com o código do WhatsApp da loja',
        'recuperacao-whatsapp' => ($d['ligado'] ?? false) ? 'Ligou a senha esquecida pelo WhatsApp da loja' : 'Desligou a senha esquecida pelo WhatsApp da loja',
        'pronto-pulou' => (($d['pular'] ?? true) ? 'Tirou da lista “Pra deixar a loja pronta”: ' : 'Pôs de volta na lista “Pra deixar a loja pronta”: ') . ($itens[(string) ($d['item'] ?? '')] ?? (string) ($d['item'] ?? '')),
        default => null,
    };
}

<?php
/**
 * LENDA · equipe do painel e operação (só admin: sessão do painel ou Authorization: Bearer). CONTRATO-v32 §B.
 * Cada rota pede o poder do mapa único (PODERES_ACAO, no _admin.php); toda escrita vai para o admin_log.
 *   GET  ?r=equipe | papeis | recados | sessoes | seguranca | saude | backup[&medicao=1] | copias | copia&arquivo=
 *   POST {"acao": "equipe_criar" | "equipe_papel" | "equipe_ativar" | "equipe_zerar_pin" | "zerar_pin" | "equipe_senha"
 *        | "equipe_excluir" | "papel_salvar" | "papel_apagar" | "recado_criar" | "recado_lido" | "recado_apagar"
 *        | "sessao_encerrar" | "backup_guardar" | "backup_restaurar", ...}
 * Hierarquia: ninguém mexe em si mesmo por aqui (use Minha conta), nem em quem está no mesmo nível ou acima; ninguém dá
 * papel igual ou acima do seu (o dono pode nomear outro dono); o último dono ativo não sai; papel em uso não se apaga.
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';

cabecalhos();

// Tabela nova que ainda não existe (subiu os arquivos e não rodou o instalar.php): 503 com o que fazer, em vez de 500.
set_exception_handler(static function (Throwable $e): void {
    if (eFaltaDeSchema($e)) {
        erroInstalar($e);
    }
    error_log('LENDA ' . get_class($e) . ': ' . $e->getMessage() . ' em ' . basename($e->getFile()) . ':' . $e->getLine());
    erro(500, 'interno', 'Algo deu errado no servidor. Tente de novo daqui a pouco.');
});

const EQUIPE_TONS = ['nota', 'aviso', 'urgente'];

// ── ajudantes ────────────────────────────────────────────────────────────────────────────────────

/** Id de conta do painel vindo do pedido. */
function lerAdminId(mixed $v): int
{
    if (is_string($v) && ctype_digit($v)) {
        $v = (int) $v;
    }
    $n = inteiroOuNulo($v, 1, 4294967295);
    if ($n === null) {
        erro(400, 'id', 'Pessoa da equipe inválida.');
    }
    return $n;
}

function contaAdminOu404(int $id): array
{
    $c = umaLinha('SELECT * FROM admin_contas WHERE id = ?', [$id]);
    if ($c === null) {
        erro(404, 'nao_encontrado', 'Pessoa da equipe não encontrada.');
    }
    return $c;
}

/**
 * Barra a ação se $eu não pode mexer em $alvo (403 hierarquia, registrado como "negado"). $assumir: a ação abre o
 * acesso à conta (senha provisória, zerar o PIN, reativar), e aí os poderes dela também têm de ser meus (podeAssumir).
 */
function exigirMexer(array $eu, array $alvo, string $acao, bool $assumir = false): void
{
    $m = $assumir ? podeAssumir($eu, $alvo) : podeMexer($eu, $alvo);
    if ($m !== null) {
        registrarAdmin('negado', 'admin:' . (int) $alvo['id'], ['acao' => $acao, 'motivo' => 'hierarquia']);
        erro(403, 'hierarquia', $m);
    }
}

function exigirDar(array $eu, string $papel, string $acao): void
{
    $m = podeDar($eu, $papel);
    if ($m !== null) {
        registrarAdmin('negado', 'papel:' . mb_substr($papel, 0, 20), ['acao' => $acao, 'motivo' => 'hierarquia']);
        erro($m === 'Papel desconhecido.' ? 400 : 403, $m === 'Papel desconhecido.' ? 'papel' : 'hierarquia', $m);
    }
}

/** E-mail de conta do painel (minúsculo), ou 400. */
function lerEmailAdmin(mixed $v): string
{
    $e = is_string($v) ? strtolower(trim($v)) : '';
    if ($e === '' || strlen($e) > 190 || !filter_var($e, FILTER_VALIDATE_EMAIL)) {
        erro(400, 'email', 'E-mail inválido.');
    }
    return $e;
}

function lerNomeAdmin(mixed $v): string
{
    $n = texto($v, 60);
    if ($n === null || mb_strlen($n, 'UTF-8') < 2) {
        erro(400, 'nome', 'O nome precisa ter de 2 a 60 caracteres.');
    }
    return $n;
}

/** Texto com quebras de linha (até $max caracteres e $linhas linhas), sem os outros caracteres de controle. */
function textoComLinhas(mixed $v, int $max, int $linhas): ?string
{
    if (!is_string($v)) {
        return null;
    }
    $s = str_replace(["\r\n", "\r"], "\n", $v);
    $s = (string) preg_replace('/[^\P{Cc}\n]|[\p{Cf}\p{Zl}\p{Zp}]/u', '', $s);
    $partes = array_slice(array_map(static fn(string $l): string => trim((string) preg_replace('/[ \t]+/u', ' ', $l)), explode("\n", $s)), 0, $linhas);
    $s = trim(implode("\n", $partes));
    return $s === '' ? null : mb_substr($s, 0, $max, 'UTF-8');
}

/** Item de pessoa da equipe para as telas (nunca hash de senha ou PIN). */
function itemEquipe(array $c, array $eu, array $online): array
{
    $a = adminDaConta($c);
    return [
        'id' => $a['id'],
        'nome' => $a['nome'],
        'email' => $a['email'],
        'papel' => $a['papel'],
        'papelNome' => $a['papelNome'],
        'nivel' => $a['nivel'],
        'ativo' => (int) $c['ativo'] === 1,
        'temPin' => $a['temPin'],
        'trocarSenha' => (int) $c['trocar_senha'] === 1,
        'daConfig' => $a['daConfig'],
        'criadoEm' => iso($c['criado_em']),
        'ultimoAcesso' => iso($c['ultimo_acesso']),
        'senhaEm' => iso($c['senha_em']),
        'online' => isset($online[$a['id']]),
        'podeMexer' => podeMexer($eu, $c) === null,
        // senha provisória, zerar o PIN e reativar pedem também todos os poderes da pessoa (podeAssumir)
        'podeAssumir' => podeAssumir($eu, $c) === null,
        'eu' => $eu['id'] !== null && $eu['id'] === $a['id'],
    ];
}

/** Ids da lista "para" de um recado (só contas que existem). */
function lerParaRecado(mixed $v): ?string
{
    if ($v === null || $v === [] || $v === '') {
        return null;
    }
    if (!is_array($v) || !array_is_list($v) || count($v) > 30) {
        erro(400, 'para', 'Para quem: uma lista de até 30 pessoas da equipe (ou vazio para todos).');
    }
    $ids = [];
    foreach ($v as $x) {
        $ids[] = lerAdminId($x);
    }
    $ids = array_values(array_unique($ids));
    $existem = array_map('intval', sql('SELECT id FROM admin_contas WHERE id IN (' . marcas(count($ids)) . ')', $ids)->fetchAll(PDO::FETCH_COLUMN));
    if (count($existem) !== count($ids)) {
        erro(400, 'para', 'Alguém da lista "para" não está na equipe.');
    }
    sort($existem);
    $csv = implode(',', $existem);
    if (strlen($csv) > 200) {
        erro(400, 'para', 'Gente demais na lista "para".');
    }
    return $csv;
}

/** Validade do recado: "AAAA-MM-DD" (fim do dia em Brasília) → DATETIME UTC; vazio → null; inválida ou fora de hoje–1 ano → 400. */
function lerValidadeRecado(mixed $v): ?string
{
    if ($v === null || $v === '') {
        return null;
    }
    if (!is_string($v) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $p) || !checkdate((int) $p[2], (int) $p[3], (int) $p[1])) {
        erro(400, 'ate', 'Validade: uma data (AAAA-MM-DD) de hoje a um ano, ou vazia.');
    }
    $t = (int) strtotime($v . ' 23:59:59 UTC') + LENDA_FUSO_H * 3600;
    if ($t <= time() || $t > time() + 366 * 86400) {
        erro(400, 'ate', 'Validade: uma data (AAAA-MM-DD) de hoje a um ano, ou vazia.');
    }
    return dt($t);
}

function idsCsv(?string $csv): array
{
    return $csv === null || $csv === '' ? [] : array_map('intval', explode(',', $csv));
}

/** Manda o arquivo de backup/cópia (gzip) em fluxo. */
function cabecalhosDownload(string $nome): void
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    header('Content-Type: application/gzip');
    header('Content-Disposition: attachment; filename="' . $nome . '"');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
}

// ── GET ──────────────────────────────────────────────────────────────────────────────────────────

if (metodo() === 'GET') {
    $r = is_string($_GET['r'] ?? null) ? $_GET['r'] : '';
    switch ($r) {
        case 'equipe':
            $eu = exigirAdminAcao('equipe');
            $online = array_flip(array_column(presencaEquipe(), 'id'));
            $itens = array_map(static fn(array $c): array => itemEquipe($c, $eu, $online),
                sql('SELECT * FROM admin_contas ORDER BY da_config DESC, ativo DESC, nome, id')->fetchAll());
            responder(200, ['itens' => $itens, 'eu' => ['id' => $eu['id'], 'nivel' => $eu['nivel'], 'papel' => $eu['papel']],
                'donosAtivos' => donosAtivos(), 'modo' => modoPainel()]);

        case 'papeis':
            $eu = exigirAdminAcao('papeis');
            $uso = [];
            foreach (sql('SELECT papel, COUNT(*) AS n FROM admin_contas WHERE da_config = 0 GROUP BY papel') as $l) {
                $uso[(string) $l['papel']] = (int) $l['n'];
            }
            $item = static fn(string $k, array $d, bool $fabrica): array => ['chave' => $k, 'nome' => $d['nome'], 'descricao' => $d['descricao'] ?? null,
                'poderes' => array_values($d['poderes']), 'nivel' => (int) $d['nivel'], 'fabrica' => $fabrica, 'emUso' => $uso[$k] ?? 0,
                'possoDar' => podeDar($eu, $k) === null];
            $fab = [];
            foreach (LENDA_PAPEIS as $k => $d) {
                $fab[] = $item($k, $d, true);
            }
            $pers = [];
            foreach (papeisPersonalizados() as $k => $d) {
                $pers[] = $item($k, $d, false);
            }
            $poderes = [];
            foreach (LENDA_PODERES as $k => $txt) {
                $poderes[] = ['chave' => $k, 'texto' => $txt];
            }
            responder(200, ['fabrica' => $fab, 'personalizados' => $pers, 'poderes' => $poderes]);

        case 'recados':
            $eu = exigirAdminAcao('recados');
            $t = time();
            $gere = temPoder($eu, 'equipe');
            $nomes = [];
            foreach (sql('SELECT id, nome, da_config FROM admin_contas') as $l) {
                $nomes[(int) $l['id']] = (int) $l['da_config'] === 1 ? 'Dono (senha do arquivo)' : (string) $l['nome'];
            }
            $itens = [];
            foreach (sql('SELECT * FROM admin_recados WHERE ate IS NULL OR ate > ? ORDER BY fixo DESC, criado_em DESC, id DESC LIMIT 100', [dt($t)]) as $l) {
                $para = idsCsv($l['para']);
                $meu = $eu['id'] !== null && (int) $l['criado_por'] === $eu['id'];
                if ($para && !$meu && !$gere && !in_array((int) $eu['id'], $para, true)) {
                    continue; // não é para mim
                }
                $itens[] = [
                    'id' => (int) $l['id'], 'titulo' => (string) $l['titulo'], 'texto' => $l['texto'], 'tom' => (string) $l['tom'],
                    'para' => $para ? array_map(static fn(int $i): array => ['id' => $i, 'nome' => $nomes[$i] ?? 'Ex-membro'], $para) : null,
                    'fixo' => (int) $l['fixo'] === 1, 'ate' => iso($l['ate']), 'criadoEm' => iso($l['criado_em']),
                    'por' => ['id' => (int) $l['criado_por'], 'nome' => $nomes[(int) $l['criado_por']] ?? 'Ex-membro'],
                    'lido' => $meu || ($eu['id'] !== null && in_array((int) $eu['id'], idsCsv($l['lidos']), true)),
                    'podeApagar' => $meu || $gere,
                ];
            }
            responder(200, ['itens' => $itens, 'naoLidos' => recadosNaoLidos($eu)]);

        case 'sessoes':
            $eu = exigirAdminAcao('sessoes');
            $t = time();
            $itens = array_map(static fn(array $l): array => [
                'id' => substr((string) $l['token_sha256'], 0, 12),
                'admin' => ['id' => (int) $l['admin_id'], 'nome' => (int) $l['da_config'] === 1 ? 'Dono (senha do arquivo)' : (string) $l['nome'],
                    'papel' => (int) $l['da_config'] === 1 ? 'dono' : (string) $l['papel']],
                'etapa' => (string) $l['etapa'], 'criadaEm' => iso($l['criada_em']), 'vistoEm' => iso($l['visto_em']), 'expiraEm' => iso($l['expira_em']),
                'aparelho' => $l['aparelho'], 'atual' => ($eu['sessao'] ?? '') === $l['token_sha256'],
            ], sql("SELECT s.token_sha256, s.admin_id, s.etapa, s.criada_em, s.visto_em, s.expira_em, s.aparelho, a.nome, a.papel, a.da_config
                FROM admin_sessoes s JOIN admin_contas a ON a.id = s.admin_id
                WHERE s.expira_em > ? AND (s.etapa <> 'pronto' OR s.visto_em >= ?) ORDER BY s.visto_em DESC LIMIT 200",
                [dt($t), dt($t - LENDA_PAINEL_OCIOSO_S)])->fetchAll());
            responder(200, ['itens' => $itens]);

        case 'seguranca':
            exigirAdminAcao('seguranca');
            responder(200, respostaSeguranca(paginaPedida(), is_string($_GET['acao'] ?? null) ? $_GET['acao'] : null));

        case 'saude':
            exigirAdminAcao('saude');
            require_once __DIR__ . '/_saude.php';
            responder(200, respostaSaude());

        case 'backup':
            exigirAdminAcao('backup');
            require_once __DIR__ . '/_copias.php';
            @set_time_limit(300);
            ignore_user_abort(true);
            $medicao = ($_GET['medicao'] ?? '') === '1';
            cabecalhosDownload('lenda-backup-' . gmdate('Y-m-d_Hi', time() - LENDA_FUSO_H * 3600) . '.json.gz');
            $contagem = escreverBackup(static function (string $pedaco): void {
                echo gzencode($pedaco, 6);
                flush();
            }, $medicao);
            registrarAdmin('backup', 'backup', ['linhas' => array_sum($contagem), 'medicao' => $medicao]);
            exit;

        case 'copias':
            exigirAdminAcao('copias');
            require_once __DIR__ . '/_copias.php';
            $p = pastaCopias();
            responder(200, ['pasta' => ['ok' => $p['ok'], 'motivo' => $p['motivo']], 'maximo' => copiasMax(), 'itens' => listarCopias(),
                'diaria' => lerEstado('_copia_diaria')]);

        case 'copia':
            exigirAdminAcao('copia');
            require_once __DIR__ . '/_copias.php';
            $arq = resolverCopia($_GET['arquivo'] ?? null);
            if ($arq === null) {
                erro(404, 'nao_encontrada', 'Cópia não encontrada.');
            }
            registrarAdmin('copia_baixar', 'copia', ['arquivo' => basename($arq)]);
            cabecalhosDownload(basename($arq));
            header('Content-Length: ' . (string) filesize($arq));
            readfile($arq);
            exit;
    }
    exigirAdmin();
    erro(400, 'rota', 'Rota desconhecida.');
}

if (metodo() !== 'POST') {
    erroMetodo();
}

// ── POST ─────────────────────────────────────────────────────────────────────────────────────────

$adm = exigirAdmin();
exigirEscritaAdmin($adm);
$j = lerJson(32 * 1024);
$acao = is_string($j['acao'] ?? null) ? $j['acao'] : '';
$eu = exigirAdminAcao($acao);
$agora = dt(time());

switch ($acao) {
    case 'equipe_criar':
        $email = lerEmailAdmin($j['email'] ?? null);
        $nome = lerNomeAdmin($j['nome'] ?? null);
        $papel = is_string($j['papel'] ?? null) ? $j['papel'] : '';
        exigirDar($eu, $papel, $acao);
        $sorteada = !isset($j['senha']) || $j['senha'] === null || $j['senha'] === '';
        $senha = $sorteada ? senhaProvisoria() : $j['senha'];
        if (!$sorteada && ($m = problemaSenhaAdmin($senha)) !== null) {
            erro(400, 'senha', $m);
        }
        try {
            sql('INSERT INTO admin_contas (email, nome, senha_hash, papel, ativo, trocar_senha, da_config, criado_em, criado_por, senha_em)
                VALUES (?, ?, ?, ?, 1, 1, 0, ?, ?, ?)', [$email, $nome, password_hash((string) $senha, PASSWORD_DEFAULT), $papel, $agora, $eu['id'], $agora]);
        } catch (PDOException $e) {
            if (eChaveDuplicada($e)) {
                erro(409, 'email_em_uso', 'Já existe uma pessoa com esse e-mail na equipe.');
            }
            throw $e;
        }
        $id = (int) bd()->lastInsertId();
        registrarAdmin('equipe_criar', 'admin:' . $id, ['nome' => $nome, 'email' => emailMascaradoAdmin($email), 'papel' => $papel]);
        // a senha provisória aparece só nesta resposta (o painel mostra uma vez, com "Copiar")
        responder(201, ['ok' => true, 'id' => $id, 'sorteada' => $sorteada] + ($sorteada ? ['senha' => $senha] : []));

    case 'equipe_papel':
        $alvo = contaAdminOu404(lerAdminId($j['adminId'] ?? null));
        exigirMexer($eu, $alvo, $acao);
        $papel = is_string($j['papel'] ?? null) ? $j['papel'] : '';
        exigirDar($eu, $papel, $acao);
        if ((string) $alvo['papel'] === 'dono' && $papel !== 'dono' && (int) $alvo['ativo'] === 1 && donosAtivos((int) $alvo['id']) === 0) {
            erro(409, 'ultimo_dono', 'É o último dono ativo: dê o papel de dono a outra pessoa antes.');
        }
        sql('UPDATE admin_contas SET papel = ? WHERE id = ?', [$papel, (int) $alvo['id']]);
        registrarAdmin('equipe_papel', 'admin:' . (int) $alvo['id'], ['de' => (string) $alvo['papel'], 'para' => $papel]);
        responder(200, ['ok' => true, 'papel' => $papel]);

    case 'equipe_ativar':
        $alvo = contaAdminOu404(lerAdminId($j['adminId'] ?? null));
        exigirMexer($eu, $alvo, $acao);
        if (!is_bool($j['ativo'] ?? null)) {
            erro(400, 'ativo', 'Informe ativo: sim ou não.');
        }
        $ativo = $j['ativo'];
        if ($ativo) {
            exigirMexer($eu, $alvo, $acao, true); // reativar devolve o acesso com os poderes dela
        }
        if (!$ativo && (string) $alvo['papel'] === 'dono' && donosAtivos((int) $alvo['id']) === 0) {
            erro(409, 'ultimo_dono', 'É o último dono ativo: ele não pode ser desativado.');
        }
        $sessoes = transacao(static function () use ($alvo, $ativo): int {
            sql('UPDATE admin_contas SET ativo = ? WHERE id = ?', [$ativo ? 1 : 0, (int) $alvo['id']]);
            return $ativo ? 0 : sql('DELETE FROM admin_sessoes WHERE admin_id = ?', [(int) $alvo['id']])->rowCount();
        });
        registrarAdmin('equipe_ativar', 'admin:' . (int) $alvo['id'], ['ativo' => $ativo, 'sessoes' => $sessoes]);
        responder(200, ['ok' => true, 'ativo' => $ativo, 'sessoesEncerradas' => $sessoes]);

    case 'equipe_zerar_pin':
    case 'zerar_pin':
        $alvo = contaAdminOu404(lerAdminId($j['adminId'] ?? null));
        // Esqueceu o PIN: o Bearer zera qualquer um; um dono zera o de outro dono (a regra do nível igual não vale aqui);
        // o resto segue a hierarquia.
        $alvoAdm = adminDaConta($alvo);
        $mesmoNivelDono = $eu['nivel'] >= LENDA_PAPEIS['dono']['nivel'] && $alvoAdm['nivel'] <= $eu['nivel'] && $eu['id'] !== $alvoAdm['id'];
        if (!$mesmoNivelDono) {
            exigirMexer($eu, $alvo, $acao, true);
        }
        $sessoes = transacao(static function () use ($alvo): int {
            sql('UPDATE admin_contas SET pin_hash = NULL, pin_em = NULL WHERE id = ?', [(int) $alvo['id']]);
            return sql('DELETE FROM admin_sessoes WHERE admin_id = ?', [(int) $alvo['id']])->rowCount();
        });
        sql('DELETE FROM tentativas WHERE chave = ?', [chaveLimite('painel-pin', 'a' . (int) $alvo['id'])[0]]);
        registrarAdmin('zerar_pin', 'admin:' . (int) $alvo['id'], ['sessoes' => $sessoes]);
        responder(200, ['ok' => true, 'sessoesEncerradas' => $sessoes]);

    case 'equipe_senha':
        $alvo = contaAdminOu404(lerAdminId($j['adminId'] ?? null));
        exigirMexer($eu, $alvo, $acao, true);
        if ((int) $alvo['da_config'] === 1) {
            erro(409, 'senha_do_arquivo', 'Esta conta entra com a senha do arquivo de config: troque-a lá (LEIAME §2).');
        }
        $sorteada = !isset($j['senha']) || $j['senha'] === null || $j['senha'] === '';
        $senha = $sorteada ? senhaProvisoria() : $j['senha'];
        if (!$sorteada && ($m = problemaSenhaAdmin($senha)) !== null) {
            erro(400, 'senha', $m);
        }
        $sessoes = transacao(static function () use ($alvo, $senha, $agora): int {
            sql('UPDATE admin_contas SET senha_hash = ?, trocar_senha = 1, senha_em = ? WHERE id = ?',
                [password_hash((string) $senha, PASSWORD_DEFAULT), $agora, (int) $alvo['id']]);
            return sql('DELETE FROM admin_sessoes WHERE admin_id = ?', [(int) $alvo['id']])->rowCount();
        });
        // quem errou a senha antiga não fica travado com a nova
        sql('DELETE FROM tentativas WHERE chave = ?', [chaveLimite('painel-e', quemEmail((string) $alvo['email']), 1800)[0]]);
        registrarAdmin('equipe_senha', 'admin:' . (int) $alvo['id'], ['sorteada' => $sorteada, 'sessoes' => $sessoes]);
        responder(200, ['ok' => true, 'sorteada' => $sorteada, 'sessoesEncerradas' => $sessoes] + ($sorteada ? ['senha' => $senha] : []));

    case 'equipe_excluir':
        $alvo = contaAdminOu404(lerAdminId($j['adminId'] ?? null));
        if ((int) $alvo['da_config'] === 1) {
            erro(409, 'conta_da_config', 'A conta da senha do arquivo não se apaga: para desligá-la, tire a senha do arquivo de config.');
        }
        exigirMexer($eu, $alvo, $acao);
        if ((string) $alvo['papel'] === 'dono' && (int) $alvo['ativo'] === 1 && donosAtivos((int) $alvo['id']) === 0) {
            erro(409, 'ultimo_dono', 'É o último dono ativo: ele não pode ser excluído.');
        }
        transacao(static function () use ($alvo): void {
            sql('DELETE FROM admin_sessoes WHERE admin_id = ?', [(int) $alvo['id']]);
            sql('DELETE FROM admin_contas WHERE id = ?', [(int) $alvo['id']]);
        });
        // o registro guarda uma cópia sem segredos (nada de hash de senha ou de PIN)
        registrarAdmin('equipe_excluir', 'admin:' . (int) $alvo['id'], ['copia' => ['nome' => (string) $alvo['nome'],
            'email' => emailMascaradoAdmin((string) $alvo['email']), 'papel' => (string) $alvo['papel'], 'criadoEm' => iso($alvo['criado_em']),
            'ultimoAcesso' => iso($alvo['ultimo_acesso'])]]);
        responder(200, ['ok' => true]);

    case 'papel_salvar':
        $chave = is_string($j['chave'] ?? null) ? $j['chave'] : '';
        if (!preg_match('/^[a-z][a-z0-9_]{2,19}$/', $chave)) {
            erro(400, 'chave', 'Chave do papel: de 3 a 20 letras minúsculas, números ou _, começando por letra.');
        }
        if (isset(LENDA_PAPEIS[$chave])) {
            erro(400, 'papel_fixo', 'Os papéis de fábrica não mudam.');
        }
        $nome = texto($j['nome'] ?? null, 40);
        if ($nome === null || mb_strlen($nome, 'UTF-8') < 2) {
            erro(400, 'nome', 'O nome do papel precisa ter de 2 a 40 caracteres.');
        }
        $desc = array_key_exists('descricao', $j) && $j['descricao'] !== null ? texto($j['descricao'], 200) : null;
        $pod = $j['poderes'] ?? null;
        if (!is_array($pod) || !array_is_list($pod) || count($pod) > count(LENDA_PODERES)) {
            erro(400, 'poderes', 'Poderes: uma lista com os poderes do papel.');
        }
        $lista = ['ver'];
        foreach ($pod as $p) {
            if (!is_string($p) || !isset(LENDA_PODERES[$p])) {
                erro(400, 'poderes', 'Poder desconhecido.');
            }
            $lista[] = $p;
        }
        $lista = array_values(array_intersect(array_keys(LENDA_PODERES), $lista)); // na ordem do catálogo, sem repetir
        $negar = static function (string $msg) use ($chave, $acao): never {
            registrarAdmin('negado', 'papel:' . $chave, ['acao' => $acao, 'motivo' => 'hierarquia']);
            erro(403, 'hierarquia', $msg);
        };
        // o papel que já existe: reescrever é mexer em quem o usa (rebaixar, tirar poderes), então vale a mesma
        // hierarquia do equipe_papel e do papel_apagar: só abaixo de mim e só com poderes que eu tenho
        $antes = papeisPersonalizados()[$chave] ?? null;
        if ($antes !== null) {
            if ((int) $antes['nivel'] >= $eu['nivel']) {
                $negar('Esse papel está no seu nível ou acima.');
            }
            foreach ($antes['poderes'] as $p) {
                if (!temPoder($eu, $p)) {
                    $negar('Esse papel tem poderes que você não tem.');
                }
            }
        }
        foreach ($lista as $p) {
            if (!temPoder($eu, $p)) {
                $negar('Você não pode criar um papel com poderes que você não tem.');
            }
        }
        if (nivelDosPoderes($lista) >= $eu['nivel']) {
            $negar('Esse papel ficaria no seu nível ou acima.');
        }
        sql('INSERT INTO admin_papeis (chave, nome, descricao, poderes, criado_em) VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE nome = VALUES(nome), descricao = VALUES(descricao), poderes = VALUES(poderes)',
            [$chave, $nome, $desc, implode(',', $lista), $agora]);
        registrarAdmin('papel_salvar', 'papel:' . $chave, ['nome' => $nome, 'poderes' => $lista, 'de' => $antes['poderes'] ?? null]);
        responder(200, ['ok' => true, 'papel' => ['chave' => $chave, 'nome' => $nome, 'descricao' => $desc, 'poderes' => $lista,
            'nivel' => nivelDosPoderes($lista)]]);

    case 'papel_apagar':
        $chave = is_string($j['chave'] ?? null) ? $j['chave'] : '';
        if (isset(LENDA_PAPEIS[$chave])) {
            erro(400, 'papel_fixo', 'Os papéis de fábrica não se apagam.');
        }
        $def = papeisPersonalizados()[$chave] ?? null;
        if ($def === null) {
            erro(404, 'nao_encontrado', 'Papel não encontrado.');
        }
        if ((int) $def['nivel'] >= $eu['nivel']) {
            erro(403, 'hierarquia', 'Esse papel está no seu nível ou acima.');
        }
        $uso = (int) umValor('SELECT COUNT(*) FROM admin_contas WHERE papel = ?', [$chave]);
        if ($uso > 0) {
            erroCom(409, 'em_uso', $uso === 1 ? 'Há 1 pessoa com esse papel: mude o papel dela antes.' : "Há $uso pessoas com esse papel: mude o papel delas antes.",
                ['emUso' => $uso]);
        }
        sql('DELETE FROM admin_papeis WHERE chave = ?', [$chave]);
        registrarAdmin('papel_apagar', 'papel:' . $chave, ['nome' => $def['nome']]);
        responder(200, ['ok' => true]);

    case 'recado_criar':
        if ($eu['id'] === null) {
            erro(400, 'conta', 'Recado precisa de uma pessoa da equipe (entre pelo painel).');
        }
        $titulo = texto($j['titulo'] ?? null, 90);
        if ($titulo === null) {
            erro(400, 'titulo', 'Escreva o título do recado (até 90 caracteres).');
        }
        $txt = array_key_exists('texto', $j) && $j['texto'] !== null ? textoComLinhas($j['texto'], 600, 12) : null;
        $tom = $j['tom'] ?? 'nota';
        if (!in_array($tom, EQUIPE_TONS, true)) {
            erro(400, 'tom', 'Tom do recado: nota, aviso ou urgente.');
        }
        $para = lerParaRecado($j['para'] ?? null);
        $fixo = $j['fixo'] ?? false;
        if (!is_bool($fixo)) {
            erro(400, 'fixo', 'Fixo: sim ou não.');
        }
        $ate = lerValidadeRecado($j['ate'] ?? null);
        sql('INSERT INTO admin_recados (titulo, texto, tom, para, fixo, ate, criado_em, criado_por, lidos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$titulo, $txt, $tom, $para, $fixo ? 1 : 0, $ate, $agora, (int) $eu['id'], (string) $eu['id']]);
        $id = (int) bd()->lastInsertId();
        registrarAdmin('recado_criar', 'recado:' . $id, ['tom' => $tom, 'para' => $para !== null ? count(idsCsv($para)) : 'todos', 'fixo' => $fixo]);
        responder(201, ['ok' => true, 'id' => $id]);

    case 'recado_lido':
        $id = lerAdminId($j['id'] ?? null);
        if ($eu['id'] === null) {
            responder(200, ['ok' => true]); // o Bearer não tem caixa de recados
        }
        // um recibo de leitura, não uma ação de admin: não vai para o registro
        transacao(static function () use ($id, $eu): void {
            $l = umaLinha('SELECT lidos FROM admin_recados WHERE id = ? FOR UPDATE', [$id]);
            if ($l === null) {
                erro(404, 'nao_encontrado', 'Recado não encontrado.');
            }
            $lidos = idsCsv($l['lidos']);
            if (!in_array((int) $eu['id'], $lidos, true)) {
                $lidos[] = (int) $eu['id'];
                sql('UPDATE admin_recados SET lidos = ? WHERE id = ?', [implode(',', array_slice($lidos, -500)), $id]);
            }
        });
        responder(200, ['ok' => true]);

    case 'recado_apagar':
        $id = lerAdminId($j['id'] ?? null);
        $l = umaLinha('SELECT id, criado_por FROM admin_recados WHERE id = ?', [$id]);
        if ($l === null) {
            erro(404, 'nao_encontrado', 'Recado não encontrado.');
        }
        if (!($eu['id'] !== null && (int) $l['criado_por'] === $eu['id']) && !temPoder($eu, 'equipe')) {
            registrarAdmin('negado', 'recado:' . $id, ['acao' => $acao, 'poder' => 'equipe']);
            erro(403, 'sem_poder', 'Só quem escreveu (ou quem cuida da equipe) apaga o recado.');
        }
        sql('DELETE FROM admin_recados WHERE id = ?', [$id]);
        registrarAdmin('recado_apagar', 'recado:' . $id, []);
        responder(200, ['ok' => true]);

    case 'sessao_encerrar':
        $sid = is_string($j['sessao'] ?? null) ? strtolower($j['sessao']) : '';
        if (!preg_match('/^[0-9a-f]{12}$/', $sid)) {
            erro(400, 'sessao', 'Sessão inválida.');
        }
        $s = umaLinha('SELECT token_sha256, admin_id FROM admin_sessoes WHERE token_sha256 LIKE ? LIMIT 1', [$sid . '%']);
        if ($s === null) {
            erro(404, 'nao_encontrada', 'Sessão não encontrada (talvez já tenha saído).');
        }
        if ($eu['id'] === null || (int) $s['admin_id'] !== $eu['id']) {
            if (!temPoder($eu, 'equipe')) {
                registrarAdmin('negado', 'admin:' . (int) $s['admin_id'], ['acao' => $acao, 'poder' => 'equipe']);
                erro(403, 'sem_poder', 'O seu papel não permite esta ação.');
            }
            exigirMexer($eu, contaAdminOu404((int) $s['admin_id']), $acao);
        }
        sql('DELETE FROM admin_sessoes WHERE token_sha256 = ?', [(string) $s['token_sha256']]);
        registrarAdmin('sessao_encerrar', 'admin:' . (int) $s['admin_id'], ['sessao' => $sid]);
        responder(200, ['ok' => true, 'atual' => ($eu['sessao'] ?? '') === $s['token_sha256']]);

    case 'backup_guardar':
        require_once __DIR__ . '/_copias.php';
        if (!pegarTrava('lenda_copia', 20)) {
            erro(409, 'ocupado', 'Outra cópia está sendo guardada agora. Tente de novo em instantes.');
        }
        try {
            $r = guardarCopia('manual', ($j['medicao'] ?? false) === true);
        } catch (RuntimeException $e) {
            erro(503, 'copias', $e->getMessage());
        } finally {
            soltarTrava('lenda_copia');
        }
        registrarAdmin('backup_guardar', 'copia', ['tipo' => 'manual', 'arquivo' => $r['arquivo'], 'linhas' => $r['linhas']]);
        responder(200, ['ok' => true, 'arquivo' => $r['arquivo'], 'bytes' => $r['bytes'], 'linhas' => $r['linhas'], 'contagem' => $r['contagem']]);

    case 'backup_restaurar':
        require_once __DIR__ . '/_copias.php';
        require_once __DIR__ . '/_hall.php';
        // restaurar é o que mais estraga se der errado: além do poder "sistema", só papel de dono
        if ($eu['nivel'] < LENDA_PAPEIS['dono']['nivel']) {
            registrarAdmin('negado', 'copia', ['acao' => $acao, 'poder' => 'dono']);
            erro(403, 'sem_poder', 'Só o dono restaura uma cópia.');
        }
        $modo = $j['modo'] ?? '';
        if (!in_array($modo, ['completar', 'substituir'], true)) {
            erro(400, 'modo', 'Modo: completar (só acrescenta o que falta) ou substituir (volta tudo ao que está na cópia).');
        }
        if (($j['confirma'] ?? null) !== 'RESTAURAR') {
            erro(400, 'confirma', 'Digite RESTAURAR para confirmar.');
        }
        $arq = resolverCopia($j['arquivo'] ?? null);
        if ($arq === null) {
            registrarAdmin('backup_restaurar_recusado', 'copia', ['motivo' => 'nao_encontrada']);
            erro(404, 'nao_encontrada', 'Cópia não encontrada.');
        }
        if ((int) filesize($arq) > COPIA_MAX_BYTES) {
            erro(413, 'grande', 'A cópia é grande demais para restaurar por aqui.');
        }
        if (!pegarTrava('lenda_copia', 20)) {
            erro(409, 'ocupado', 'Outra cópia ou restauração está em andamento. Tente de novo em instantes.');
        }
        try {
            $res = restaurarCopia($arq, $modo);
        } catch (RuntimeException $e) {
            registrarAdmin('backup_restaurar_recusado', 'copia', ['arquivo' => basename($arq), 'motivo' => mb_substr($e->getMessage(), 0, 120)]);
            erro(400, 'copia_estragada', 'A cópia não pode ser restaurada: ' . $e->getMessage() . '. Nada foi mudado.');
        } catch (PDOException $e) {
            // a transação foi desfeita: o banco ficou como estava
            error_log('LENDA restaurar: ' . $e->getMessage());
            registrarAdmin('backup_restaurar_recusado', 'copia', ['arquivo' => basename($arq), 'motivo' => 'banco']);
            erro(500, 'restaurar_falhou', 'A restauração deu erro no banco e foi desfeita: nada mudou. A cópia "antes" do estado atual ficou guardada.');
        } finally {
            soltarTrava('lenda_copia');
        }
        // a fotografia do Hall volta a ser feita a partir das carreiras restauradas
        try {
            refazerFoto(true, 10, 'restaurar');
        } catch (Throwable $e) {
            error_log('LENDA restaurar: fotografia do Hall: ' . $e->getMessage());
        }
        registrarAdmin('backup_restaurar', 'copia', ['arquivo' => basename($arq), 'modo' => $modo, 'antes' => $res['antes'],
            'gravadas' => $res['gravadas'], 'puladas' => $res['puladas']]);
        responder(200, ['ok' => true, 'modo' => $modo, 'antes' => $res['antes'], 'geradoEm' => $res['geradoEm'], 'contagem' => $res['contagem'],
            'gravadas' => $res['gravadas'], 'puladas' => $res['puladas']]);
}

erro(400, 'acao', 'Ação desconhecida.');

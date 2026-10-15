<?php
/**
 * LENDA · v3.2 · correções da revisão 3, lado do servidor (CONTRATO-v32 §E.7). Incluído pelo teste.php depois do
 * teste-v32-integ.php (usa os ajudantes do teste.php, do teste-v3.php, do teste-v32-mod.php e do teste-v32-acesso.php).
 * Cada bloco é um achado confirmado e falhava antes da correção:
 *   1 tomar a conta de quem tem poder que eu não tenho (zerar PIN + senha provisória)   2 papel_salvar reescrevendo papel
 *   3 PINs ao mesmo tempo (mais de 3 testados)   4 LGPD: registro com motivo/jogador depois de excluir   5 e-mail inteiro
 *   no email_log (recusa do SMTP)   6 senhas ao mesmo tempo no mesmo e-mail (mais de 5)   7 hash fixo de custo 12 (o tempo
 *   mostra quem é da equipe)   8 conta excluída pelo jogador voltando pela restauração   9 backup quadrático (chave
 *   composta)   10 cópia de carreira APAGADA em outra conta voltando ao Hall   11 "substituir" perdendo a cópia da
 *   lixeira   12 dois admins na mesma denúncia   13 Tempo de jogo sem cache   14 conta oficial tirando o índice de
 *   cobertura do painel   15 X2: "no Hall" sem estar na fotografia e "Em revisão" prometendo o que não acontece
 *   16 oculta por denúncias sem denúncia aberta   17 três números para "Suspeitas"   18 tempo por modo e o modo no Menu
 *   19 GROUP_CONCAT cortado. Deixa a equipe vazia no fim, como os outros.
 */
declare(strict_types=1);

$CR_PINS = ['508317', '640258', '731946', '852073', '926481', '374619'];

function crAdm(array $corpo): Resposta
{
    return integAdm('POST', '/api/admin.php', $corpo);
}

function crGet(string $qs): Resposta
{
    return integAdm('GET', '/api/admin.php?' . $qs);
}

function crEquipe(array $corpo): Resposta
{
    return acEquipe(novoNav(), $corpo, acBearer());
}

acLimparEquipe();

// ══ 1. tomar a conta de quem tem um poder que eu não tenho ══════════════════════════════════════

secao('rev3 · 1 · quem cuida da equipe não assume a conta de quem tem poder que ele não tem (zerar PIN, senha, reativar)');
$r1 = crEquipe(['acao' => 'papel_salvar', 'chave' => 'gerente_rv', 'nome' => 'Gerente RV', 'poderes' => ['equipe']]);
$r2 = crEquipe(['acao' => 'papel_salvar', 'chave' => 'mod_senior', 'nome' => 'Mod Sênior', 'poderes' => ['moderar', 'usuarios', 'excluir', 'bonus', 'config']]);
checar('papéis: gerente_rv [ver, equipe] nível 70; mod_senior [ver, moderar, usuarios, excluir, bonus, config] nível 50',
    ($r1->json['papel']['nivel'] ?? 0) === 70 && ($r2->json['papel']['nivel'] ?? 0) === 50, $r1->resumo() . ' / ' . $r2->resumo());
[$idB, $B] = acNovaPessoa(null, 'b-gerente@exemplo.com', 'gerente_rv', $CR_PINS[0]);
[$idC, $C, $senhaC] = acNovaPessoa(null, 'c-modsenior@exemplo.com', 'mod_senior', $CR_PINS[1]);
[$idL] = acNovaPessoa(null, 'l-leitor@exemplo.com', 'leitor', $CR_PINS[2]);
$r = $B->pedir('POST', '/api/admin.php', ['acao' => 'config', 'valores' => ['cadastro_aberto' => false]]);
checar('o gerente não tem "config" (403 sem_poder)', $r->status === 403 && $r->erro() === 'sem_poder', $r->resumo());
$negados0 = (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'negado' AND quem = ?", ['a' . $idB]);
$pinAntes = v('SELECT pin_hash FROM admin_contas WHERE id = ?', [$idC]);
$rz = acEquipe($B, ['acao' => 'equipe_zerar_pin', 'adminId' => $idC]);
$rz2 = acEquipe($B, ['acao' => 'zerar_pin', 'adminId' => $idC]);
$rs = acEquipe($B, ['acao' => 'equipe_senha', 'adminId' => $idC]);
checar('zerar o PIN (os dois nomes) e dar senha provisória a quem tem poderes que ele não tem → 403 hierarquia, sem senha na resposta',
    $rz->status === 403 && $rz->erro() === 'hierarquia' && $rz2->status === 403 && $rs->status === 403 && $rs->erro() === 'hierarquia'
    && !isset($rs->json['senha']) && v('SELECT pin_hash FROM admin_contas WHERE id = ?', [$idC]) === $pinAntes
    && (int) v('SELECT trocar_senha FROM admin_contas WHERE id = ?', [$idC]) === 0, $rz->resumo() . ' / ' . $rs->resumo());
checar('…e a pessoa continua entrando com a senha dela; as recusas vão para o registro como "negado" com quem tentou',
    (acPainel(novoNav(), ['acao' => 'entrar', 'email' => 'c-modsenior@exemplo.com', 'senha' => $senhaC])->json['etapa'] ?? '') === 'pin'
    && (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'negado' AND quem = ?", ['a' . $idB]) - $negados0 === 3);
resetarLimitesCurtos();
$ra = acEquipe($B, ['acao' => 'equipe_ativar', 'adminId' => $idC, 'ativo' => false]);
$rb = acEquipe($B, ['acao' => 'equipe_ativar', 'adminId' => $idC, 'ativo' => true]);
checar('desativar ele ainda pode (só restringe); reativar devolve o acesso com os poderes dela → 403 hierarquia', $ra->status === 200
    && $rb->status === 403 && $rb->erro() === 'hierarquia' && (int) v('SELECT ativo FROM admin_contas WHERE id = ?', [$idC]) === 0, $ra->resumo() . ' / ' . $rb->resumo());
crEquipe(['acao' => 'equipe_ativar', 'adminId' => $idC, 'ativo' => true]);
$r = acEquipeGet($B, 'r=equipe');
$porId = array_column($r->json['itens'] ?? [], null, 'id');
checar('GET equipe: podeMexer continua (nível abaixo), podeAssumir diz se dá para dar senha/zerar PIN/reativar',
    ($porId[$idC]['podeMexer'] ?? false) === true && ($porId[$idC]['podeAssumir'] ?? true) === false && ($porId[$idL]['podeAssumir'] ?? false) === true, $r->resumo());
$rz = acEquipe($B, ['acao' => 'equipe_zerar_pin', 'adminId' => $idL]);
$rs = acEquipe($B, ['acao' => 'equipe_senha', 'adminId' => $idL]);
checar('quem só tem poderes que ele tem (leitor): zerar o PIN e a senha provisória → 200', $rz->status === 200 && $rs->status === 200
    && strlen((string) ($rs->json['senha'] ?? '')) === 14, $rz->resumo() . ' / ' . $rs->resumo());
$rs = crEquipe(['acao' => 'equipe_senha', 'adminId' => $idC]);
checar('o Bearer (acima de todos) continua dando a senha provisória', $rs->status === 200, $rs->resumo());

// ══ 2. papel_salvar reescrevendo um papel do mesmo nível (ou com poder que ele não tem) ═════════

secao('rev3 · 2 · papel_salvar respeita a hierarquia do papel que já existe (como o equipe_papel e o papel_apagar)');
crEquipe(['acao' => 'papel_salvar', 'chave' => 'infra_rv', 'nome' => 'Infra', 'poderes' => ['sistema']]);
crEquipe(['acao' => 'papel_salvar', 'chave' => 'atende_rv', 'nome' => 'Atende', 'poderes' => ['usuarios']]);
crEquipe(['acao' => 'papel_salvar', 'chave' => 'leitor_rv', 'nome' => 'Leitor RV', 'poderes' => []]);
[$idD] = acNovaPessoa(null, 'd-infra@exemplo.com', 'infra_rv', $CR_PINS[3]);
$negados0 = (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'negado' AND quem = ?", ['a' . $idB]);
$r1 = acEquipe($B, ['acao' => 'equipe_papel', 'adminId' => $idD, 'papel' => 'leitor']);
$r2 = acEquipe($B, ['acao' => 'papel_apagar', 'chave' => 'infra_rv']);
$r3 = acEquipe($B, ['acao' => 'papel_salvar', 'chave' => 'infra_rv', 'nome' => 'Infra', 'poderes' => []]);
checar('papel do mesmo nível (infra [sistema], 70): equipe_papel, papel_apagar e papel_salvar → 403 hierarquia; o papel continua com "sistema"',
    $r1->status === 403 && $r2->status === 403 && $r3->status === 403 && $r3->erro() === 'hierarquia'
    && (string) v("SELECT poderes FROM admin_papeis WHERE chave = 'infra_rv'") === 'ver,sistema', $r3->resumo());
$r4 = acEquipe($B, ['acao' => 'papel_salvar', 'chave' => 'atende_rv', 'nome' => 'Atende', 'poderes' => []]);
checar('papel abaixo com um poder que ele não tem (atende [usuarios], 50) → 403 hierarquia ("tem poderes que você não tem")',
    $r4->status === 403 && str_contains((string) ($r4->json['mensagem'] ?? ''), 'poderes que você não tem')
    && (string) v("SELECT poderes FROM admin_papeis WHERE chave = 'atende_rv'") === 'ver,usuarios', $r4->resumo());
$r5 = acEquipe($B, ['acao' => 'papel_salvar', 'chave' => 'leitor_rv', 'nome' => 'Leitor Renomeado', 'poderes' => []]);
checar('papel abaixo só com poderes dele (leitor_rv) → 200; as 2 recusas do papel_salvar viram "negado"', $r5->status === 200
    && (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'negado' AND quem = ? AND alvo LIKE 'papel:%'", ['a' . $idB]) >= 2
    && (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'negado' AND quem = ?", ['a' . $idB]) - $negados0 === 3, $r5->resumo());
$r = acEquipeGet(novoNav(), 'r=equipe', acBearer());
$porId = array_column($r->json['itens'] ?? [], null, 'id');
checar('…e a pessoa do papel infra continua no nível 70', ($porId[$idD]['nivel'] ?? 0) === 70, json_encode($porId[$idD] ?? null));

// ══ 3. PINs ao mesmo tempo ══════════════════════════════════════════════════════════════════════

secao('rev3 · 3 · PIN: no máximo 3 testados a cada 10 min, mesmo com pedidos ao mesmo tempo (soma antes de conferir)');
[$idE, , $senhaE] = acNovaPessoa(null, 'e-pin@exemplo.com', 'leitor', $CR_PINS[4]);
resetarLimites();
$navE = novoNav();
$r = acPainel($navE, ['acao' => 'entrar', 'email' => 'e-pin@exemplo.com', 'senha' => $senhaE]);
checar('entrar → etapa pin (restam 3)', ($r->json['etapa'] ?? '') === 'pin' && ($r->json['restam'] ?? 0) === 3, $r->resumo());
$errados0 = (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'painel_pin_errado' AND alvo = ?", ['admin:' . $idE]);
$ped = [];
for ($i = 0; $i < 24; $i++) {
    $ped[] = ['POST', '/api/painel.php', ['acao' => 'conferir_pin', 'pin' => sprintf('%06d', 100000 + 7919 * $i)], $navE->jar, "p$i"];
}
$res = paralelo($ped);
$st = array_count_values(array_map(static fn(array $x): int => $x[0], $res));
$errados = (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'painel_pin_errado' AND alvo = ?", ['admin:' . $idE]) - $errados0;
checar('24 PINs errados ao mesmo tempo (php -S com 4 processos): no máximo 3 conferidos (painel_pin_errado), o resto 429',
    $errados <= 3 && ($st[401] ?? 0) <= 3 && ($st[429] ?? 0) >= 21 && !isset($st[500]), "conferidos $errados; " . json_encode($st));
$r = acPainel($navE, ['acao' => 'conferir_pin', 'pin' => $CR_PINS[4]]);
checar('…e o PIN certo depois, na mesma janela → 429 pin_travado', $r->status === 429 && $r->erro() === 'pin_travado', $r->resumo());
resetarLimites();
$navE = novoNav();
acPainel($navE, ['acao' => 'entrar', 'email' => 'e-pin@exemplo.com', 'senha' => $senhaE]);
$r1 = acPainel($navE, ['acao' => 'conferir_pin', 'pin' => '111112']);
$r2 = acPainel($navE, ['acao' => 'conferir_pin', 'pin' => $CR_PINS[4]]);
checar('um a um continua igual: errado → 401 "Restam 2"; o certo → pronto (e o contador some)', $r1->status === 401 && ($r1->json['restam'] ?? 0) === 2
    && ($r2->json['etapa'] ?? '') === 'pronto' && (int) v("SELECT COUNT(*) FROM tentativas WHERE chave = ?", ['painel-pin:a' . $idE]) === 0,
    $r1->resumo() . ' / ' . $r2->resumo());

// ══ 6. senhas erradas ao mesmo tempo no mesmo e-mail ════════════════════════════════════════════

secao('rev3 · 6 · senha do painel: no máximo 5 conferidas por e-mail a cada 30 min, mesmo ao mesmo tempo (e o acerto não gasta)');
resetarLimites();
$falhas0 = (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'painel_falha' AND alvo = ?", ['admin:' . $idE]);
$ped = [];
for ($i = 0; $i < 16; $i++) {
    $ped[] = ['POST', '/api/painel.php', ['acao' => 'entrar', 'email' => 'e-pin@exemplo.com', 'senha' => 'errada-' . $i], [], "e$i"];
}
$res = paralelo($ped);
$st = array_count_values(array_map(static fn(array $x): int => $x[0], $res));
$falhas = (int) v("SELECT COUNT(*) FROM admin_log WHERE acao = 'painel_falha' AND alvo = ?", ['admin:' . $idE]) - $falhas0;
checar('16 senhas erradas ao mesmo tempo para o mesmo e-mail: no máximo 5 conferidas (painel_falha), o resto 429', $falhas <= 5
    && ($st[401] ?? 0) <= 5 && !isset($st[500]), "conferidas $falhas; " . json_encode($st));
resetarLimites();
$chaveE = 'dia-painel-e:' . quemEmailTeste('e-pin@exemplo.com');
for ($i = 0; $i < 4; $i++) {
    acPainel(novoNav(), ['acao' => 'entrar', 'email' => 'e-pin@exemplo.com', 'senha' => 'errada-seq-' . $i]);
}
$r = acPainel(novoNav(), ['acao' => 'entrar', 'email' => 'e-pin@exemplo.com', 'senha' => $senhaE]);
checar('4 erradas e a certa → entra (etapa pin) e o contador do e-mail fica em 4 (a reserva do acerto volta)', ($r->json['etapa'] ?? '') === 'pin'
    && (int) v('SELECT MAX(n) FROM tentativas WHERE chave = ?', [$chaveE]) === 4, $r->resumo());
$r5 = acPainel(novoNav(), ['acao' => 'entrar', 'email' => 'e-pin@exemplo.com', 'senha' => 'errada-5']);
$r6 = acPainel(novoNav(), ['acao' => 'entrar', 'email' => 'e-pin@exemplo.com', 'senha' => $senhaE]);
checar('…a 5ª errada ainda é conferida (401); depois, até a certa espera a janela (429)', $r5->status === 401 && $r6->status === 429, $r5->resumo() . ' / ' . $r6->resumo());
resetarLimites();

// ══ 7. o tempo da senha errada não mostra quem é da equipe ══════════════════════════════════════

secao('rev3 · 7 · e-mail que não é da equipe leva o mesmo tempo que um que é (custo do hash igual ao das contas)');
$hashes = q("SELECT id, senha_hash FROM admin_contas WHERE da_config = 0 AND senha_hash <> ''");
$custo10 = password_hash('outra-senha-qualquer', PASSWORD_BCRYPT, ['cost' => 10]); // como o PHP 8.1–8.3 grava (PASSWORD_DEFAULT)
q("UPDATE admin_contas SET senha_hash = ? WHERE da_config = 0 AND senha_hash <> ''", [$custo10]);
$medir = static function (string $email): float {
    $t = [];
    for ($i = 0; $i < 5; $i++) {
        resetarLimites();
        $t0 = microtime(true);
        acPainel(novoNav(), ['acao' => 'entrar', 'email' => $email, 'senha' => 'errada-tempo-' . $i]);
        $t[] = microtime(true) - $t0;
    }
    sort($t);
    return $t[2];
};
$tExiste = $medir('e-pin@exemplo.com');
$tNao = $medir('ninguem-da-equipe@exemplo.com');
foreach ($hashes as $h) {
    q('UPDATE admin_contas SET senha_hash = ? WHERE id = ?', [$h['senha_hash'], (int) $h['id']]);
}
resetarLimites();
checar('com as contas em custo 10, o e-mail que não existe leva no máximo 1,8× o tempo do que existe (antes ~4×: hash fixo de custo 12)',
    $tNao < 1.8 * $tExiste && $tNao > 0.4 * $tExiste, sprintf('existe %.0f ms, não existe %.0f ms', $tExiste * 1000, $tNao * 1000));
checar('…e o painel.php não tem mais o hash fixo de custo 12 como único caminho', !preg_match("/password_verify\\(\\\$senha, '\\\$2y\\\$12\\\$/",
    (string) file_get_contents(dirname(__DIR__) . '/api/painel.php')));

acLimparEquipe();

// ══ 4. LGPD: o registro do admin depois de excluir a conta ══════════════════════════════════════

secao('rev3 · 4 · LGPD: excluir a conta limpa também as linhas do registro da lixeira, das indicações e as que citam o id');
[$navF, $uidF, , , $emailF] = novaConta('Fera Gol');
[$navR, $uidR, , , $emailR] = novaConta('Rei Drible');
$senhaR = 'senha-v3-' . $CONTAS_N;
[, $uidA9] = novaConta('Amigo Nove');
$pkF1 = salvarPk($navF, $uidF, 'lgpd-c1', ['jogador' => 'MENDES']);
$pkF2 = salvarPk($navF, $uidF, 'lgpd-c2', ['jogador' => 'MENDES']);
$motivoF = 'Fera Gol (Pedro, 14 anos, de Campinas) usou nome ofensivo';
$r1 = crAdm(['acao' => 'apagar_carreira', 'id' => $pkF1, 'motivo' => $motivoF]);
$r2 = crAdm(['acao' => 'apagar_carreira', 'id' => $pkF2, 'motivo' => $motivoF]);
$lixF2 = (int) ($r2->json['lixeiraId'] ?? 0);
$r3 = crAdm(['acao' => 'liberar_reenvio', 'id' => $lixF2]); // a carreira 2 sai da lixeira: o alvo carreira:<pk> não leva mais a ela
q("INSERT INTO indicacoes (indicador_id, indicado_id, criada_em, status) VALUES (?, ?, UTC_TIMESTAMP(), 'pendente')", [$uidR, $uidA9]);
$iidR = (int) v('SELECT MAX(id) FROM indicacoes');
$r4 = crAdm(['acao' => 'recusar_indicacao', 'id' => $iidR, 'motivo' => 'Rei Drible e o irmão João usam o mesmo celular']);
checar('preparação: apagar 2 carreiras (uma liberada da lixeira depois) e recusar uma indicação', $r1->status === 200 && $r2->status === 200
    && $r3->status === 200 && $r4->status === 200, $r1->resumo() . ' / ' . $r3->resumo() . ' / ' . $r4->resumo());
$r = crAdm(['acao' => 'excluir_usuario', 'id' => $uidF, 'confirma' => 'Fera Gol', 'motivo' => 'pedido_titular']);
resetarLimitesCurtos();
$r2 = conta($navR, ['acao' => 'excluir', 'senha' => $senhaR]);
$restos = q("SELECT id, acao, alvo, detalhes FROM admin_log WHERE detalhes LIKE '%Pedro, 14 anos%' OR detalhes LIKE '%irmão João%' OR detalhes LIKE '%MENDES%'");
$linhas = q('SELECT acao, detalhes FROM admin_log WHERE alvo IN (?, ?, ?)', ['carreira:' . $pkF1, 'carreira:' . $pkF2, 'indicacao:' . $iidR]);
checar('excluir pelo admin e pelo titular → nenhuma linha do registro guarda o motivo escrito nem o jogador', $r->status === 200 && $r2->status === 200
    && $restos === [], json_encode($restos, JSON_UNESCAPED_UNICODE) . ' ' . $r2->resumo());
checar('…as linhas ficam só com a ação, a data e o id ({via, excluido: true}): apagar_carreira (lixeira e liberada) e recusar_indicacao',
    count($linhas) >= 3 && !array_filter($linhas, static fn(array $l): bool => !preg_match('/^\{"via":"[a-z]+","excluido":true\}$/', (string) $l['detalhes'])),
    json_encode($linhas, JSON_UNESCAPED_UNICODE));
checar('…e a indicação recebida pelo Amigo Nove some do registro dele junto (o indicador saiu)', (int) v('SELECT COUNT(*) FROM indicacoes WHERE id = ?', [$iidR]) === 0);

// ══ 8. a conta que o jogador excluiu não volta pela restauração ═════════════════════════════════

secao('rev3 · 8 · LGPD: conta excluída pelo próprio jogador nunca volta ao restaurar uma cópia (marca contas_excluidas)');
[$navT, $uidT, , , $emailT] = novaConta('Titular Saiu');
$senhaT = 'senha-v3-' . $CONTAS_N;
salvarPk($navT, $uidT, 'titular-c1');
q("INSERT INTO conquistas_usuario (usuario_id, conquista_id, em) VALUES (?, 'primeira_carreira', UTC_TIMESTAMP())", [$uidT]);
$rg = crEquipe(['acao' => 'backup_guardar']);
$arqT = (string) ($rg->json['arquivo'] ?? '');
resetarLimitesCurtos();
$rx = conta($navT, ['acao' => 'excluir', 'senha' => $senhaT]);
checar('backup guardado com a conta; o jogador exclui a conta → 200, a marca fica só com o número (via titular)', $rg->status === 200 && $rx->status === 200
    && (int) v('SELECT COUNT(*) FROM usuarios WHERE email = ?', [$emailT]) === 0
    && (int) v('SELECT COUNT(*) FROM contas_excluidas WHERE usuario_id = ?', [$uidT]) === 1
    && v('SELECT via FROM contas_excluidas WHERE usuario_id = ?', [$uidT]) === 'titular', $rx->resumo());
checar('…a marca do admin também (Fera Gol, via admin)', v('SELECT via FROM contas_excluidas WHERE usuario_id = ?', [$uidF]) === 'admin');
$rr = crEquipe(['acao' => 'backup_restaurar', 'arquivo' => $arqT, 'modo' => 'completar', 'confirma' => 'RESTAURAR']);
resetarLimitesCurtos();
$re = conta(novoNav(), ['acao' => 'entrar', 'email' => $emailT, 'senha' => $senhaT]);
checar('restaurar "completar" a cópia de antes → a conta NÃO volta (nem carreira, nem conquista); entrar com a senha antiga → 401',
    $rr->status === 200 && ($rr->json['puladas'] ?? 0) >= 3 && (int) v('SELECT COUNT(*) FROM usuarios WHERE id = ? OR email = ?', [$uidT, $emailT]) === 0
    && (int) v('SELECT COUNT(*) FROM carreiras WHERE usuario_id = ?', [$uidT]) === 0 && (int) v('SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id = ?', [$uidT]) === 0
    && $re->status === 401, $rr->resumo() . ' / ' . $re->resumo());
$rr = crEquipe(['acao' => 'backup_restaurar', 'arquivo' => $arqT, 'modo' => 'substituir', 'confirma' => 'RESTAURAR']);
checar('…nem no "substituir"; e a marca vai no backup (contas_excluidas)', $rr->status === 200 && (int) v('SELECT COUNT(*) FROM usuarios WHERE id = ?', [$uidT]) === 0
    && (int) v('SELECT COUNT(*) FROM contas_excluidas WHERE usuario_id = ?', [$uidT]) === 1, $rr->resumo());
$rg = crEquipe(['acao' => 'backup_guardar']);
checar('o backup novo leva a tabela contas_excluidas', ($rg->json['contagem']['contas_excluidas'] ?? 0) >= 2, $rg->resumo());
$priv = (string) file_get_contents(dirname(__DIR__) . '/privacidade.html');
checar('a política diz por quanto tempo ficam as cópias do servidor e que a conta excluída nunca volta por elas',
    str_contains($priv, 'Cópias de segurança do servidor') && str_contains($priv, 'nunca volta'));

// ══ 11. "substituir" e a cópia das carreiras na lixeira ═════════════════════════════════════════

secao('rev3 · 11 · restaurar "substituir" não perde a cópia restaurável da lixeira');
[$navS, $uidS] = novaConta('Dono Lixeira');
$pkS = salvarPk($navS, $uidS, 'lix-sub-1');
$rl = crAdm(['acao' => 'apagar_carreira', 'id' => $pkS, 'motivo' => 'Teste da lixeira']);
$lixS = (int) ($rl->json['lixeiraId'] ?? 0);
$rg = crEquipe(['acao' => 'backup_guardar']);
$arqS = (string) ($rg->json['arquivo'] ?? '');
$bk = acGunzip((string) file_get_contents($AC_PASTA . '/' . $arqS));
checar('o backup leva a lixeira com a cópia (dados em base64)', is_string($bk) && str_contains($bk, '"binarios":{"carreiras":["dados"],"lixeira_carreiras":["dados"]}'));
$rr = crEquipe(['acao' => 'backup_restaurar', 'arquivo' => $arqS, 'modo' => 'substituir', 'confirma' => 'RESTAURAR']);
checar('substituir pelo backup de segundos atrás → a lixeira continua com a cópia', $rr->status === 200
    && (int) v('SELECT dados IS NOT NULL FROM lixeira_carreiras WHERE id = ?', [$lixS]) === 1, $rr->resumo());
// um backup de antes da rev3 (a lixeira sem a coluna dados): feito a partir deste, tirando "dados" da lixeira
$antigo = '';
$naLixeira = false;
foreach (explode("\n", (string) $bk) as $l) {
    if (str_starts_with($l, '{"versao":')) {
        $l = str_replace(',"lixeira_carreiras":["dados"]', '', $l);
    } elseif ($l === '"lixeira_carreiras":[') {
        $naLixeira = true;
    } elseif ($naLixeira && ($l === ']' || $l === '],')) {
        $naLixeira = false;
    } elseif ($naLixeira && str_starts_with($l, '{')) {
        $virgula = str_ends_with($l, ',');
        $reg = json_decode(rtrim($l, ','), true);
        unset($reg['dados']);
        $l = json_encode($reg, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . ($virgula ? ',' : '');
    }
    $antigo .= $l . "\n";
}
$arqAntigo = 'lenda-backup-antigo-rev3.json.gz';
file_put_contents($AC_PASTA . '/' . $arqAntigo, gzencode(rtrim($antigo, "\n") . "\n"));
$rr = crEquipe(['acao' => 'backup_restaurar', 'arquivo' => $arqAntigo, 'modo' => 'substituir', 'confirma' => 'RESTAURAR']);
checar('substituir por um backup SEM a cópia da lixeira (o formato de antes) → a cópia que o banco tem fica', $rr->status === 200
    && (int) v('SELECT dados IS NOT NULL FROM lixeira_carreiras WHERE id = ?', [$lixS]) === 1, $rr->resumo());
$r = crAdm(['acao' => 'restaurar_carreira', 'id' => $lixS]);
checar('…e "Restaurar (oculta)" funciona → 200, a carreira volta oculta', $r->status === 200 && (int) v('SELECT oculta FROM carreiras WHERE id = ?', [(int) ($r->json['pk'] ?? 0)]) === 1,
    $r->resumo());
$pkS = (int) ($r->json['pk'] ?? 0);
$rl = crAdm(['acao' => 'apagar_carreira', 'id' => $pkS, 'motivo' => 'De novo']);
$lixS = (int) ($rl->json['lixeiraId'] ?? 0);
q('UPDATE lixeira_carreiras SET dados = NULL WHERE id = ?', [$lixS]);
$r1 = crAdm(['acao' => 'restaurar_carreira', 'id' => $lixS]);
q('UPDATE lixeira_carreiras SET expira_em = UTC_TIMESTAMP() - INTERVAL 1 DAY WHERE id = ?', [$lixS]);
$r2 = crAdm(['acao' => 'restaurar_carreira', 'id' => $lixS]);
checar('sem a cópia: a mensagem separa "não veio na restauração" (dentro dos 30 dias) de "venceu (30 dias)"', $r1->erro() === 'sem_copia'
    && str_contains((string) ($r1->json['mensagem'] ?? ''), 'não veio na restauração') && str_contains((string) ($r2->json['mensagem'] ?? ''), 'venceu'),
    $r1->resumo() . ' / ' . $r2->resumo());
if (is_file($AC_PASTA . '/' . $arqAntigo)) {
    unlink($AC_PASTA . '/' . $arqAntigo);
}

// ══ 10. a cópia de uma carreira APAGADA, salva por outra conta ══════════════════════════════════

secao('rev3 · 10 · a mesma carreira apagada pela moderação, salva por outra conta (segunda conta do aparelho), vira "cópia"');
$vidX = uuid4();
[$navXa, $uidXa] = novaConta('Primeira Conta', ['vid' => $vidX]);
[$navXb, $uidXb] = novaConta('Segunda Conta', ['vid' => $vidX]);
$hX = hallEntry('lix-x1', ['nota' => 61]);
$pkXa = salvarPk($navXa, $uidXa, 'lix-x1', ['nota' => 61]);
crAdm(['acao' => 'apagar_carreira', 'id' => $pkXa, 'motivo' => 'Carreira forjada']);
$r = salvarC($navXa, $hX);
checar('a dona salva de novo → 409 apagada (como antes)', $r->status === 409 && $r->erro() === 'apagada', $r->resumo());
$r = salvarC($navXb, $hX);
$suspB = (string) v('SELECT suspeita FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uidXb, 'lix-x1']);
crAdm(['acao' => 'atualizar_hall']);
checar('a outra conta salva o mesmo HallEntry → entra como suspeita "copia", fora do Hall (hall.php?id → 404)', $r->status === 200
    && str_contains($suspB, 'copia') && ($r->json['carreira']['hall']['estado'] ?? '') === 'suspeita' && hallGet('id=lix-x1')->status === 404, $r->resumo() . " / $suspB");
$hX2 = hallEntry('lix-x1-outro-id', ['nota' => 61]);
$hX2->summary->testeId = 'lix-x1'; // o mesmo resumo com outro id
$r = salvarC($navXb, $hX2);
checar('…o mesmo resumo com outro id também (resumo_hash guardado na lixeira)', str_contains((string) v('SELECT suspeita FROM carreiras WHERE usuario_id = ? AND carreira_id = ?',
    [$uidXb, 'lix-x1-outro-id']), 'copia'), $r->resumo());
checar('a lixeira guarda o resumo_hash da carreira apagada', (string) v('SELECT resumo_hash FROM lixeira_carreiras WHERE carreira_pk = ?', [$pkXa])
    === (string) v('SELECT resumo_hash FROM carreiras WHERE usuario_id = ? AND carreira_id = ?', [$uidXb, 'lix-x1']));

// ══ 12. dois admins na mesma denúncia ═══════════════════════════════════════════════════════════

secao('rev3 · 12 · denúncia decidida por um admin: o segundo, com a tela velha, recebe 409 ja_decidida (nada muda)');
[$navDd, $uidDd] = novaConta('Dono Disputa');
[, $uidDen] = novaConta('Quem Denuncia');
$pkDd = salvarPk($navDd, $uidDd, 'disp-1');
q("INSERT INTO denuncias (carreira_pk, usuario_id, motivo, criada_em, status) VALUES (?, ?, 'nome', UTC_TIMESTAMP(), 'aberta')", [$pkDd, $uidDen]);
$dDd = (int) v('SELECT MAX(id) FROM denuncias');
$rA = crAdm(['acao' => 'resolver_denuncia', 'id' => $dDd, 'resultado' => 'ocultar', 'motivo' => 'Nome ofensivo']);
$rB = crAdm(['acao' => 'resolver_denuncia', 'id' => $dDd, 'resultado' => 'ok', 'motivo' => 'Denúncia improcedente']);
$lDd = q('SELECT oculta, motivo_admin FROM carreiras WHERE id = ?', [$pkDd])[0] ?? [];
checar('A oculta (200); B manda "manter" → 409 ja_decidida com o estado; a carreira fica oculta com o motivo de A e a denúncia "ocultar"',
    $rA->status === 200 && $rB->status === 409 && $rB->erro() === 'ja_decidida' && ($rB->json['estado']['oculta'] ?? 0) === 1
    && ($rB->json['estado']['resultado'] ?? '') === 'ocultar' && (int) ($lDd['oculta'] ?? 0) === 1 && ($lDd['motivo_admin'] ?? '') === 'Nome ofensivo'
    && v('SELECT status FROM denuncias WHERE id = ?', [$dDd]) === 'ocultar', $rB->resumo() . ' ' . json_encode($lDd));
q("INSERT INTO denuncias (carreira_pk, usuario_id, motivo, criada_em, status) VALUES (?, ?, 'trapaca', UTC_TIMESTAMP(), 'aberta')", [$pkDd, $uidDd + 5000]);
$dDd2 = (int) v('SELECT MAX(id) FROM denuncias');
$r = crAdm(['acao' => 'resolver_denuncia', 'id' => $dDd2, 'resultado' => 'ok', 'motivo' => 'Improcedente']);
checar('denúncia aberta numa carreira que o admin escondeu → "manter" fecha a denúncia, mas a carreira e o motivo de quem escondeu ficam',
    $r->status === 200 && (int) v('SELECT oculta FROM carreiras WHERE id = ?', [$pkDd]) === 1
    && v('SELECT motivo_admin FROM carreiras WHERE id = ?', [$pkDd]) === 'Nome ofensivo' && v('SELECT status FROM denuncias WHERE id = ?', [$dDd2]) === 'ok', $r->resumo());

// ══ 16. escondida pelas denúncias sem nenhuma denúncia aberta ═══════════════════════════════════

secao('rev3 · 16 · a escondida pelas denúncias que volta sem denúncia (o dono apagou e salvou) se decide no lote');
[$navO2, $uidO2] = novaConta('Dono Den Tres');
$hO2 = hallEntry('den-3', ['nota' => 66]);
salvarC($navO2, $hO2);
$pkO2 = pkCarreira('den-3', $uidO2);
q('UPDATE carreiras SET oculta = 2 WHERE id = ?', [$pkO2]);
q('INSERT INTO carreiras_moderacao (usuario_id, carreira_id, resumo_hash, oculta, em) SELECT usuario_id, carreira_id, resumo_hash, 2, UTC_TIMESTAMP() FROM carreiras WHERE id = ?', [$pkO2]);
for ($i = 1; $i <= 5; $i++) {
    q("INSERT INTO denuncias (carreira_pk, usuario_id, motivo, criada_em, status) VALUES (?, ?, 'trapaca', UTC_TIMESTAMP(), 'aberta')", [$pkO2, 900000 + $i]);
}
$navO2->pedir('POST', '/api/carreiras.php', ['acao' => 'apagar', 'id' => 'den-3']);
salvarC($navO2, $hO2);
$pkO2 = pkCarreira('den-3', $uidO2);
checar('preparação: salva de novo → oculta = 2 e nenhuma denúncia', (int) v('SELECT oculta FROM carreiras WHERE id = ?', [$pkO2]) === 2
    && (int) v('SELECT COUNT(*) FROM denuncias WHERE carreira_pk = ?', [$pkO2]) === 0);
$r = crAdm(['acao' => 'resolver_denuncias_lote', 'carreiras' => [$pkO2], 'resultado' => 'ok']);
checar('lote "manter" → decidida (carreiras [pk], sem "sem_abertas"); volta ao Hall (oculta 0) e a decisão guardada sai', $r->status === 200
    && ($r->json['carreiras'] ?? null) === [$pkO2] && ($r->json['pulados'] ?? null) === [] && (int) v('SELECT oculta FROM carreiras WHERE id = ?', [$pkO2]) === 0
    && (int) v('SELECT COUNT(*) FROM carreiras_moderacao WHERE usuario_id = ? AND carreira_id = ?', [$uidO2, 'den-3']) === 0, $r->resumo());
q('UPDATE carreiras SET oculta = 2 WHERE id = ?', [$pkO2]);
$r = crAdm(['acao' => 'resolver_denuncias_lote', 'carreiras' => [$pkO2], 'resultado' => 'ocultar', 'motivo' => 'Trapaça confirmada']);
checar('…e "ocultar" no lote → oculta = 1 com o motivo', $r->status === 200 && (int) v('SELECT oculta FROM carreiras WHERE id = ?', [$pkO2]) === 1
    && v('SELECT motivo_admin FROM carreiras WHERE id = ?', [$pkO2]) === 'Trapaça confirmada', $r->resumo());
$pkSem = salvarPk($navO2, $uidO2, 'den-sem');
$r = crAdm(['acao' => 'resolver_denuncias_lote', 'carreiras' => [$pkSem], 'resultado' => 'ok']);
checar('carreira visível sem denúncia continua "sem_abertas" no lote', ($r->json['pulados'][0]['motivo'] ?? '') === 'sem_abertas', $r->resumo());

// ══ 17. "Suspeitas": um número só ═══════════════════════════════════════════════════════════════

secao('rev3 · 17 · "Suspeitas": o pulso, a lista do Hall e a marca da fila contam o mesmo (as já escondidas ficam em "ocultas")');
[$navSu, $uidSu] = novaConta('Dono Suspeitas');
$pkSu1 = salvarPk($navSu, $uidSu, 'susp-1', ['gols' => 99999]);
$pkSu2 = salvarPk($navSu, $uidSu, 'susp-2', ['gols' => 88888]);
crAdm(['acao' => 'ocultar_carreira', 'id' => $pkSu2, 'motivo' => 'Números impossíveis']);
$pulso = integAdm('GET', '/api/painel.php?so=agora')->json['agora']['acao']['suspeitas'] ?? -1;
$lista = crGet('r=hall&filtro=suspeitas');
$pksLista = array_column($lista->json['itens'] ?? [], 'id');
checar('pulso.suspeitas = total da lista "Suspeitas"; a escondida pelo admin não está nela (mas está em "ocultas")', $pulso === ($lista->json['total'] ?? -2)
    && in_array($pkSu1, $pksLista, true) && !in_array($pkSu2, $pksLista, true) && in_array($pkSu2, array_column(crGet('r=hall&filtro=ocultas')->json['itens'] ?? [], 'id'), true),
    "pulso $pulso / " . $lista->resumo());
$resumoSu = crGet('r=resumo')->json['carreiras'] ?? [];
checar('…e o ?r=resumo (ladrilho "Carreiras suspeitas" da Visão geral, que abre essa lista) conta o mesmo; a escondida vai em "ocultas"',
    ($resumoSu['suspeitas'] ?? -1) === $pulso && ($resumoSu['ocultas'] ?? 0) >= 1, json_encode($resumoSu));

// ══ 15. X2: "no Hall" só na fotografia; "Em revisão" só promete o que acontece ═══════════════════

secao('rev3 · 15 · X2: no_hall só quando está na fotografia (entra_na_proxima antes); "Em revisão" sem promessa falsa');
crAdm(['acao' => 'atualizar_hall']);
[$navX2, $uidX2] = novaConta('Selo Novo');
$r = salvarC($navX2, hallEntry('selo-1', ['nota' => 70]));
$h1 = $r->json['carreira']['hall'] ?? null;
checar('salva depois da fotografia → entra_na_proxima ("Entra no Hall público na próxima atualização (por volta das HH:MM).") e hall.php?id → 404',
    ($h1['estado'] ?? '') === 'entra_na_proxima' && preg_match('/^Entra no Hall público na próxima atualização \(por volta das \d\d:\d\d\)\.$/', (string) ($h1['motivo'] ?? '')) === 1
    && hallGet('id=selo-1')->status === 404 && ($r->json['carreira']['noHall'] ?? false) === true, json_encode($h1, JSON_UNESCAPED_UNICODE));
crAdm(['acao' => 'atualizar_hall']);
$C = array_column($navX2->pedir('GET', '/api/carreiras.php')->json['carreiras'] ?? [], 'hall', 'id');
checar('…depois da fotografia → no_hall, e o hall.php mostra', ($C['selo-1'] ?? null) === ['estado' => 'no_hall'] && hallGet('id=selo-1')->status === 200, json_encode($C));
[$navM, $uidM] = novaConta('Eu Escolho');
salvarC($navM, hallEntry('man-a', ['nota' => 60]));
$navM->pedir('POST', '/api/carreiras.php', ['acao' => 'publicar', 'id' => 'man-a', 'sim' => true]);
$r = salvarC($navM, hallEntry('man-b', ['nota' => 93]), 'manual', false);
$hb = $r->json['carreira']['hall'] ?? null;
checar('"Eu escolho" sem ela marcada, nota 93 → revisao SEM a promessa ("a moderação confere as notas altas antes do Hall")',
    ($hb ?? null) === ['estado' => 'revisao', 'motivo' => 'Em revisão: a moderação confere as notas altas antes do Hall.'], json_encode($hb, JSON_UNESCAPED_UNICODE));
crAdm(['acao' => 'mostrar_carreira', 'id' => pkCarreira('man-b', $uidM)]);
$C = array_column($navM->pedir('GET', '/api/carreiras.php')->json['carreiras'] ?? [], 'hall', 'id');
checar('…conferida, fica "fora: você escolheu outras" (era o que a frase sem promessa dizia)', ($C['man-b']['estado'] ?? '') === 'fora'
    && ($C['man-b']['porque'] ?? '') === 'escolha', json_encode($C['man-b'] ?? null, JSON_UNESCAPED_UNICODE));
$r = salvarC($navM, hallEntry('man-c', ['nota' => 94]), 'manual', false);
$navM->pedir('POST', '/api/carreiras.php', ['acao' => 'publicar', 'id' => 'man-c', 'sim' => true]);
$C = array_column($navM->pedir('GET', '/api/carreiras.php')->json['carreiras'] ?? [], 'hall', 'id');
checar('marcada para o Hall e em revisão → a promessa volta ("entra no Hall assim que for conferida")',
    ($C['man-c'] ?? null) === ['estado' => 'revisao', 'motivo' => 'Em revisão: entra no Hall assim que for conferida.'], json_encode($C['man-c'] ?? null, JSON_UNESCAPED_UNICODE));

// ══ 18. tempo jogando por modo e o modo no Menu ═════════════════════════════════════════════════

secao('rev3 · 18 · tempo jogando por modo (Clássico e depois Imersivo na mesma sessão) e o modo some no Menu');
[$navTm, $uidTm, , $vidTm] = novaConta('Dois Modos');
$sidTm = uuid4();
medir($navTm, $vidTm, $sidTm, [['t' => 'hb', 'p' => 1, 'm' => 'classico']], ctx());
$hb = static function (array $ev, int $s = 15) use ($navTm, $vidTm, $sidTm): void {
    q('UPDATE visitas SET ultimo = ultimo - INTERVAL ? SECOND WHERE sid = ?', [$s, $sidTm]);
    medir($navTm, $vidTm, $sidTm, $ev);
};
for ($i = 0; $i < 4; $i++) {
    $hb([['t' => 'hb', 'p' => 1, 'm' => 'classico']]);
}
$hb([['t' => 'hb', 'p' => 1, 'm' => 'imersivo']]);
$hb([['t' => 'hb', 'p' => 1, 'm' => 'classico'], ['t' => 'hb', 'p' => 1, 'm' => 'imersivo']], 30);
$vTm = visita($sidTm);
checar('visita: jogando 105 s = Clássico 75 + Imersivo 30 (o lote misto divide); modo_atual = o do último batimento', (int) $vTm['jogando_s'] === 105
    && (int) $vTm['jogando_classico_s'] === 75 && (int) $vTm['jogando_imersivo_s'] === 30 && (int) $vTm['jogando_live_s'] === 0 && $vTm['modo_atual'] === 'imersivo',
    json_encode(array_intersect_key($vTm, array_flip(['jogando_s', 'jogando_classico_s', 'jogando_imersivo_s', 'modo_atual']))));
$hb([['t' => 'hb', 'p' => 0, 'm' => null]]);
checar('batimento no Menu (sem modo) → modo_atual NULL (a Na área não mostra mais o selo do último modo)', visita($sidTm)['modo_atual'] === null);
$r = crGet('r=tempo&jan=semana&grupo=todos&usuario=' . $uidTm);
checar('?r=tempo porModo: Clássico 75 s e Imersivo 30 s (antes: os 105 no Imersivo)', ($r->json['porModo'] ?? null) === [
    ['modo' => 'classico', 'jogandoS' => 75, 'sessoes' => 1], ['modo' => 'imersivo', 'jogandoS' => 30, 'sessoes' => 1]], $r->resumo());
$r = crGet('r=usuario&id=' . $uidTm);
checar('ficha: tempo.porModo {classico: 75, imersivo: 30}', ($r->json['usuario']['tempo']['porModo'] ?? null) === ['classico' => 75, 'imersivo' => 30], $r->resumo());

// ══ 13. Tempo de jogo: as janelas longas ficam guardadas ════════════════════════════════════════

secao('rev3 · 13 · Tempo de jogo: "tudo", mês e 30 dias guardados por alguns minutos (um pedido recalcula); semana sempre na hora');
comConfig(['painel_cache_s' => 60], static function () use ($uidTm): void {
    q("DELETE FROM site_config WHERE chave LIKE '\\_tempo:%'");
    $a = crGet('r=tempo&jan=tudo&grupo=todos');
    q("INSERT INTO visitas (sid, vid, usuario_id, inicio, ultimo, ativo_s, jogando_s, origem, bot) VALUES (?, ?, NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP(), 777, 0, 'direto', 0)",
        [uuid4(), uuid4()]);
    $b = crGet('r=tempo&jan=tudo&grupo=todos');
    $s1 = crGet('r=tempo&jan=semana&grupo=todos');
    checar('jan=tudo: a 2ª resposta é a guardada (mesmo geradoEm e total, sem a visita nova); semana já tem a visita nova', $a->status === 200
        && ($a->json['geradoEm'] ?? 'x') === ($b->json['geradoEm'] ?? 'y') && ($b->json['total']['ativoS'] ?? 0) === ($a->json['total']['ativoS'] ?? -1)
        && ($s1->json['total']['ativoS'] ?? 0) >= 777 && (int) v("SELECT COUNT(*) FROM site_config WHERE chave = '_tempo:tudo:todos'") === 1, $b->resumo());
    $u = crGet('r=tempo&jan=tudo&grupo=todos&usuario=' . $uidTm);
    checar('…com usuario= (a ficha), sempre na hora', ($u->json['total']['jogandoS'] ?? 0) === 105, $u->resumo());
});
// o ranking guardado tem apelidos: excluir uma conta (LGPD) apaga as respostas guardadas junto
[$navZ] = novaConta('Sai Do Ranking');
$senhaZ = 'senha-v3-' . $CONTAS_N;
$tinhaCache = (int) v("SELECT COUNT(*) FROM site_config WHERE chave = '_tempo:tudo:todos'");
resetarLimitesCurtos();
$rz = conta($navZ, ['acao' => 'excluir', 'senha' => $senhaZ]);
checar('excluir uma conta apaga o Tempo de jogo guardado (o ranking cita apelidos) e o resumo guardado da Visão geral', $tinhaCache === 1 && $rz->status === 200
    && (int) v("SELECT COUNT(*) FROM site_config WHERE chave LIKE '\\_tempo:%' OR chave LIKE '\\_painel:%'") === 0, $rz->resumo());
q("DELETE FROM site_config WHERE chave LIKE '\\_tempo:%'");

// ══ 5. e-mail inteiro no email_log ══════════════════════════════════════════════════════════════

secao('rev3 · 5 · LGPD: a recusa do servidor de e-mail ("550 <endereço>") fica com o endereço mascarado no email_log');
$smtpDir2 = dirname($CONFIG_ARQ) . '/smtp-falso-rev3';
if (!is_dir("$smtpDir2/saida")) {
    mkdir("$smtpDir2/saida", 0700, true);
}
$cnf2 = "$smtpDir2/openssl.cnf";
file_put_contents($cnf2, "[req]\ndistinguished_name = dn\n[dn]\n[ext]\nbasicConstraints = critical, CA:TRUE\nsubjectAltName = DNS:localhost\n");
$ch2 = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA, 'config' => $cnf2]);
$crt2 = openssl_csr_sign(openssl_csr_new(['commonName' => 'localhost'], $ch2, ['config' => $cnf2, 'digest_alg' => 'sha256']), null, $ch2, 1,
    ['config' => $cnf2, 'x509_extensions' => 'ext', 'digest_alg' => 'sha256'], random_int(1, PHP_INT_MAX));
openssl_x509_export($crt2, $pem2);
openssl_pkey_export($ch2, $pemK2, null, ['config' => $cnf2]);
file_put_contents("$smtpDir2/cert.pem", $pem2);
file_put_contents("$smtpDir2/chave.pem", $pemK2);
chmod("$smtpDir2/chave.pem", 0600);
$uSmtp2 = 'caixa-rev3@exemplo.com';
$sSmtp2 = 'smtp-' . bin2hex(random_bytes(8));
$SENHAS[] = $sSmtp2;
$proc2 = proc_open([PHP_BINARY, __DIR__ . '/smtp-falso.php', "$smtpDir2/cert.pem", "$smtpDir2/chave.pem", "$smtpDir2/saida", $uSmtp2, $sSmtp2],
    [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['file', "$smtpDir2/erros.log", 'a']], $canos2);
$porta2 = is_resource($proc2) && preg_match('/^porta=(\d+)/', (string) fgets($canos2[1]), $mm2) ? (int) $mm2[1] : 0;
[, $uidRec] = novaConta('Tita Recusada', ['email' => 'recusado.tita.lima@exemplo.com']);
if (checar('servidor SMTP de mentira no ar', $porta2 > 0)) {
    comConfig(['email_modo' => 'smtp', 'smtp' => ['host' => 'localhost', 'porta' => $porta2, 'usuario' => $uSmtp2, 'senha' => $sSmtp2, 'cafile' => "$smtpDir2/cert.pem"]],
        static function () use ($uidRec): void {
            $r = crAdm(['acao' => 'enviar_redefinicao', 'id' => $uidRec]);
            $el = q('SELECT * FROM email_log ORDER BY id DESC LIMIT 1')[0] ?? [];
            checar('o SMTP recusa o destinatário (550 com o endereço): enviado false; o detalhe guarda o código e o endereço só mascarado',
                ($r->json['enviado'] ?? null) === false && str_contains((string) ($el['detalhe'] ?? ''), 'RCPT TO: 550 5.1.1')
                && str_contains((string) $el['detalhe'], 're***@exemplo.com') && !str_contains(json_encode($el), 'recusado.tita'), $r->resumo() . ' | ' . json_encode($el));
            $e = crGet('r=emails');
            checar('…e o ?r=emails também não mostra o endereço inteiro', $e->status === 200 && !str_contains($e->corpo, 'recusado.tita'), $e->resumo());
        });
}
if (is_resource($proc2)) {
    proc_terminate($proc2);
    proc_close($proc2);
}
foreach (array_merge(glob("$smtpDir2/saida/*") ?: [], glob("$smtpDir2/*") ?: []) as $f) {
    if (is_file($f)) {
        unlink($f);
    }
}
foreach (["$smtpDir2/saida", $smtpDir2] as $d) {
    if (is_dir($d) && count(scandir($d)) === 2) {
        rmdir($d);
    }
}
q("INSERT INTO email_log (em, para_hash, para_mask, tipo, via, ok, detalhe) VALUES (UTC_TIMESTAMP(), ?, 'an***@exemplo.com', 'admin_redef', 'smtp', 0, ?)",
    [hash('sha256', 'antiga'), 'smtp RCPT TO: 550 5.1.1 <ana.antiga@exemplo.com>: Recipient address rejected']);
$e = crGet('r=emails');
checar('linha gravada antes da correção (com o endereço inteiro) → o ?r=emails mostra mascarado', !str_contains($e->corpo, 'ana.antiga@')
    && str_contains($e->corpo, 'an***@exemplo.com>: Recipient'), $e->resumo());

// ══ 19. GROUP_CONCAT cortado ════════════════════════════════════════════════════════════════════

secao('rev3 · 19 · mesmo aparelho com 200 contas: a lista não corta (group_concat_max_len) nem inventa conta');
$vidFarm = 'f0000000-0000-4000-8000-' . substr(bin2hex(random_bytes(6)), 0, 12);
$vals = [];
$ps = [];
for ($i = 0; $i < 200; $i++) {
    $vals[] = "(?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), 30, 'direto', 0)";
    array_push($ps, uuid4(), $vidFarm, 7100000 + $i);
}
q('INSERT INTO visitas (sid, vid, usuario_id, inicio, ultimo, ativo_s, origem, bot) VALUES ' . implode(', ', $vals), $ps);
$g = phpComLib('require_once ' . var_export(dirname(__DIR__) . '/api/_atencao.php', true) . ';
    $sessao = (int) umValor("SELECT @@SESSION.group_concat_max_len");
    bd()->exec("SET SESSION group_concat_max_len = 1024"); // o padrão do MySQL 8
    foreach (gruposMulticontas(true) as $x) {
        if ($x["aparelho"] === ' . var_export(substr($vidFarm, 0, 8), true) . ' && in_array(7100000, $x["ids"], true)) {
            echo json_encode(["sessao" => $sessao, "n" => count($x["ids"]), "min" => min($x["ids"]), "max" => max($x["ids"])]);
            exit;
        }
    }
    echo json_encode(["sessao" => $sessao, "n" => 0]);');
checar('a conexão pede group_concat_max_len de 1 MB', ($g['sessao'] ?? 0) >= 1048576, json_encode($g));
checar('mesmo com 1024 (MySQL 8): o grupo tem as 200 contas, de 7100000 a 7100199 (nada cortado, nenhuma conta inventada)', ($g['n'] ?? 0) === 200
    && ($g['min'] ?? 0) === 7100000 && ($g['max'] ?? 0) === 7100199, json_encode($g));
q('DELETE FROM visitas WHERE vid = ?', [$vidFarm]);
q("DELETE FROM site_config WHERE chave = '_multicontas'");

// ══ 9 e 14. carga: backup com 600 mil conquistas; painel com conta oficial ══════════════════════

secao('rev3 · 9 · backup: lotes pela faixa do índice (chave composta na forma expandida), linear com muitas conquistas');
$hn = phpComLib('require_once ' . var_export(dirname(__DIR__) . '/api/_copias.php', true) . ';
    [$w, $p] = depoisDaChave(["usuario_id", "conquista_id"], [123, "c_5"]);
    echo json_encode(["w" => $w, "p" => $p]);');
checar('depoisDaChave: (a > ? OR (a = ? AND b > ?)), não (a, b) > (?, ?)', ($hn['w'] ?? '') === '(`usuario_id` > ? OR (`usuario_id` = ? AND `conquista_id` > ?))'
    && ($hn['p'] ?? null) === [123, 123, 'c_5'], json_encode($hn));
if (!$SEM_CARGA) {
    $t0 = microtime(true);
    q("INSERT INTO conquistas_usuario (usuario_id, conquista_id, em)
        SELECT 6000000 + FLOOR(n / 20), CONCAT('carga_', MOD(n, 20)), UTC_TIMESTAMP() FROM (
            SELECT a.d + 10 * b.d + 100 * c.d + 1000 * d.d + 10000 * e.d + 100000 * f.d AS n
            FROM (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) a,
                 (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) b,
                 (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) c,
                 (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) d,
                 (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) e,
                 (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5) f
        ) t");
    $pdo->query('ANALYZE TABLE conquistas_usuario')->fetchAll();
    $nConq = (int) v('SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id >= 6000000');
    $hb2 = phpComLib('require_once ' . var_export(dirname(__DIR__) . '/api/_copias.php', true) . ';
        $antes = (int) sql("SHOW SESSION STATUS LIKE \'Handler_read_next\'")->fetch()["Value"];
        [$w, $p] = depoisDaChave(["usuario_id", "conquista_id"], [6025000, "carga_5"]);
        $n = count(sql("SELECT usuario_id, conquista_id, em FROM conquistas_usuario WHERE $w ORDER BY usuario_id, conquista_id LIMIT 1000", $p)->fetchAll());
        $depois = (int) sql("SHOW SESSION STATUS LIKE \'Handler_read_next\'")->fetch()["Value"];
        $t0 = microtime(true);
        $c = escreverBackup(static function (string $x): void {}, false);
        echo json_encode(["n" => $n, "lidas" => $depois - $antes, "s" => round(microtime(true) - $t0, 2), "conq" => $c["conquistas_usuario"] ?? 0]);');
    checar("um lote depois de (6025000, carga_5) com $nConq conquistas lê ~1.000 linhas do índice (antes ~500 mil: lia desde o começo)",
        ($hb2['n'] ?? 0) === 1000 && ($hb2['lidas'] ?? PHP_INT_MAX) <= 2000, json_encode($hb2));
    checar('o backup inteiro com elas sai em menos de 25 s (antes: quadrático, ~30 s com 600 mil, 300 s+ com 2 milhões)', ($hb2['conq'] ?? 0) >= 600000
        && ($hb2['s'] ?? 99) < 25, json_encode($hb2) . sprintf(' (inserir: %.1f s)', microtime(true) - $t0));
    q('DELETE FROM conquistas_usuario WHERE usuario_id >= 6000000');
}

secao('rev3 · 14 · painel: conta oficial/teste não tira o índice de cobertura do período (sid NOT IN, não usuario_id)');
$fonte = (string) file_get_contents(dirname(__DIR__) . '/api/painel.php');
checar('painel.php filtra as contas de teste pelo sid', str_contains($fonte, '.sid NOT IN (SELECT x.sid FROM visitas x WHERE x.usuario_id IN (')
    && !str_contains($fonte, '.usuario_id NOT IN ($foraIn)'));
[, $uidOf] = novaConta('Conta Dona Rev');
q("UPDATE usuarios SET tipo = 'oficial' WHERE id = ?", [$uidOf]);
$aP = gmdate('Y-m-d H:i:s', time() - 30 * 86400);
$bP = gmdate('Y-m-d H:i:s', time() + 86400);
$exp = q("EXPLAIN SELECT COUNT(*) AS sessoes, COUNT(DISTINCT v.vid) AS visitantes, COALESCE(SUM(v.ativo_s), 0) AS total
    FROM visitas v FORCE INDEX (ix_visitas_inicio) WHERE v.inicio >= ? AND v.inicio < ? AND v.bot = 0
    AND v.sid NOT IN (SELECT x.sid FROM visitas x WHERE x.usuario_id IN ($uidOf))", [$aP, $bP]);
$extraV = (string) ($exp[0]['Extra'] ?? '');
checar('EXPLAIN do período com a conta oficial: a tabela v continua só no índice ("Using index", sem "index condition")',
    str_contains($extraV, 'Using index') && !str_contains($extraV, 'index condition'), json_encode($exp));
if (!$SEM_CARGA) {
    // 120 mil visitas nos últimos 30 dias (mais as da carga), com o cache do painel desligado (painel_cache_s 0 no teste)
    $pdo->beginTransaction();
    for ($lote = 0; $lote < 120; $lote++) {
        $vals = [];
        $ps = [];
        for ($i = 0; $i < 1000; $i++) {
            $vals[] = "(?, ?, NULL, UTC_TIMESTAMP() - INTERVAL ? MINUTE, UTC_TIMESTAMP() - INTERVAL ? MINUTE, ?, 'carga-rev3', ?, 0)";
            $min = mt_rand(10, 29 * 1440);
            array_push($ps, uuid4(), uuid4(), $min, $min - 5, mt_rand(5, 900), ['mobile', 'desktop'][$i % 2]);
        }
        q('INSERT INTO visitas (sid, vid, usuario_id, inicio, ultimo, ativo_s, origem, dispositivo, bot) VALUES ' . implode(', ', $vals), $ps);
    }
    $pdo->commit();
    $pdo->query('ANALYZE TABLE visitas')->fetchAll();
    $deP = gmdate('Y-m-d', time() - 10800 - 29 * 86400);
    $ateP = gmdate('Y-m-d', time() - 10800);
    $tempoPainel = static function () use ($deP, $ateP): float {
        $t = [];
        for ($i = 0; $i < 3; $i++) {
            $t0 = microtime(true);
            integAdm('GET', "/api/painel.php?de=$deP&ate=$ateP");
            $t[] = microtime(true) - $t0;
        }
        sort($t);
        return $t[1];
    };
    q("UPDATE usuarios SET tipo = 'jogador' WHERE id = ?", [$uidOf]);
    $sem = $tempoPainel();
    q("UPDATE usuarios SET tipo = 'oficial' WHERE id = ?", [$uidOf]);
    $com = $tempoPainel();
    checar('período de 30 dias com 120 mil visitas: com 1 conta oficial leva no máximo 1,35× o tempo sem ela (antes: 1,6–1,8×)', $com < 1.35 * $sem,
        sprintf('sem %.0f ms, com %.0f ms', $sem * 1000, $com * 1000));
    q("DELETE FROM visitas WHERE origem = 'carga-rev3'");
}
q("UPDATE usuarios SET tipo = 'jogador' WHERE id = ?", [$uidOf]);

acLimparEquipe();

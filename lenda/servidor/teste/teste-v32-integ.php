<?php
/**
 * LENDA · v3.2 · o que a integração acrescentou (CONTRATO-v32 §E). Incluído pelo teste.php depois do
 * teste-v32-acesso.php (usa o novaConta do teste-v3.php; o admin vai pelo Bearer).
 *   - O7: e-mail pelo SMTP autenticado da caixa, contra um servidor SMTP de mentira (smtp-falso.php) com STARTTLS de
 *     verdade e um certificado desta rodada: o código chega por TLS e troca a senha; senha errada, certificado não
 *     confiável e config incompleta falham com o motivo no email_log, sem a senha nem o usuário; a Saúde e o ?r=emails
 *     dizem o modo; a senha da caixa nunca aparece numa resposta.
 *   - ?r=usuario devolve `tipo` (o painel deixava de saber se a conta era criador/oficial/teste).
 *   - hall.php?id= devolve `destaque` (o selo no resumo aberto pelo link).
 */
declare(strict_types=1);

/** Admin pelo Bearer (a sessão do painel dos testes anteriores pode ter caído: PIN, troca de senha, sair de todos). */
function integAdm(string $metodo, string $caminho, ?array $corpo = null): Resposta
{
    global $PAINEL_TOKEN;
    return novoNav()->pedir($metodo, $caminho, $corpo, ['auth' => 'Bearer ' . $PAINEL_TOKEN, 'origem' => false]);
}

// ══ 1. O7 · e-mail pelo SMTP da caixa ═══════════════════════════════════════════════════════════

secao('v3.2 integração · e-mail pelo SMTP da caixa (O7): STARTTLS, certificado conferido, senha que nunca aparece');
$smtpDir = dirname($CONFIG_ARQ) . '/smtp-falso';
foreach (array_merge(glob("$smtpDir/saida/*") ?: [], glob("$smtpDir/*.pem") ?: []) as $f) {
    @unlink($f);
}
@mkdir("$smtpDir/saida", 0700, true);
// certificado só desta rodada (localhost), autoassinado: serve de CA no 'cafile' da config de teste
$cnf = "$smtpDir/openssl.cnf";
file_put_contents($cnf, "[req]\ndistinguished_name = dn\n[dn]\n[ext]\nbasicConstraints = critical, CA:TRUE\nsubjectAltName = DNS:localhost\n");
$chaveSmtp = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA, 'config' => $cnf]);
$csr = openssl_csr_new(['commonName' => 'localhost'], $chaveSmtp, ['config' => $cnf, 'digest_alg' => 'sha256']);
$crt = openssl_csr_sign($csr, null, $chaveSmtp, 1, ['config' => $cnf, 'x509_extensions' => 'ext', 'digest_alg' => 'sha256'], random_int(1, PHP_INT_MAX));
openssl_x509_export($crt, $pemCert);
openssl_pkey_export($chaveSmtp, $pemChave, null, ['config' => $cnf]);
file_put_contents("$smtpDir/cert.pem", $pemCert);
file_put_contents("$smtpDir/chave.pem", $pemChave);
chmod("$smtpDir/chave.pem", 0600);

$USUARIO_SMTP = 'caixa-' . bin2hex(random_bytes(3)) . '@exemplo.com';
$SENHA_SMTP = 'smtp-' . bin2hex(random_bytes(8));
$SENHAS[] = $SENHA_SMTP;
$procSmtp = proc_open([PHP_BINARY, __DIR__ . '/smtp-falso.php', "$smtpDir/cert.pem", "$smtpDir/chave.pem", "$smtpDir/saida", $USUARIO_SMTP, $SENHA_SMTP],
    [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['file', "$smtpDir/erros.log", 'a']], $canos);
$linhaPorta = is_resource($procSmtp) ? (string) fgets($canos[1]) : '';
$portaSmtp = preg_match('/^porta=(\d+)/', $linhaPorta, $mm) ? (int) $mm[1] : 0;

/** As mensagens que o servidor de mentira aceitou: [arquivo => [cabeçalhos, corpo decodificado]]. */
$lerSmtp = static function () use ($smtpDir): array {
    $out = [];
    foreach (glob("$smtpDir/saida/*.eml") ?: [] as $f) {
        [$cab, $corpo] = array_pad(explode("\r\n\r\n", (string) file_get_contents($f), 2), 2, '');
        $out[$f] = [$cab, (string) base64_decode(str_replace(["\r", "\n"], '', $corpo), true)];
    }
    return $out;
};
/** Espera uma mensagem nova (o esqueci responde antes de mandar). */
$esperarSmtp = static function (array $antes) use ($lerSmtp): ?array {
    for ($i = 0; $i < 100; $i++) {
        $novas = array_diff_key($lerSmtp(), $antes);
        if ($novas) {
            return reset($novas);
        }
        usleep(50_000);
    }
    return null;
};
$ultimoEmailLog = static fn(): array => q('SELECT * FROM email_log ORDER BY id DESC LIMIT 1')[0] ?? [];

if (checar('servidor SMTP de mentira no ar (STARTTLS com o certificado desta rodada)', $portaSmtp > 0, $linhaPorta)) {
    $cfgSmtp = ['host' => 'localhost', 'porta' => $portaSmtp, 'usuario' => $USUARIO_SMTP, 'senha' => $SENHA_SMTP, 'cafile' => "$smtpDir/cert.pem"];
    [, $uidS1, , , $emailS1] = novaConta('Caixa Smtp Um');
    [, $uidS2, , , $emailS2] = novaConta('Caixa Smtp Dois');
    comConfig(['email_modo' => 'smtp', 'smtp' => $cfgSmtp], static function () use ($emailS1, $uidS2, $emailS2, $lerSmtp, $esperarSmtp, $ultimoEmailLog, $USUARIO_SMTP): void {
        resetarLimitesCurtos();
        $antes = $lerSmtp();
        $r = conta(novoNav(), ['acao' => 'esqueci', 'email' => $emailS1]);
        $msg = $esperarSmtp($antes);
        $cab = $msg[0] ?? '';
        $cod = codigoDe($msg[1] ?? null);
        checar('esqueci com email_modo smtp: a mensagem chega pela caixa, depois do STARTTLS, com o código de 6 dígitos', $r->status === 200 && $msg !== null
            && str_contains($cab, 'X-Teste-Tls: sim') && str_contains($cab, "X-Teste-Para: <$emailS1>") && str_contains($cab, 'X-Teste-De: <contato@oprojeto.online>')
            && preg_match('/^Subject: =\?UTF-8\?B\?/m', $cab) === 1 && preg_match('/^Message-ID: <[0-9a-f]{24}@oprojeto\.online>/m', $cab) === 1 && $cod !== null,
            substr($cab, 0, 300));
        $el = $ultimoEmailLog();
        // o email_log é gravado depois do QUIT do SMTP: a mensagem chega na caixa um instante antes (v3.3 §E: corrida do teste)
        for ($i = 0; $i < 40 && ($el['tipo'] ?? '') !== 'esqueci'; $i++) {
            usleep(50_000);
            $el = $ultimoEmailLog();
        }
        checar('…email_log: via smtp, ok, tipo esqueci, endereço só mascarado', ($el['via'] ?? '') === 'smtp' && (int) ($el['ok'] ?? 0) === 1 && ($el['tipo'] ?? '') === 'esqueci'
            && ($el['detalhe'] ?? null) === null && !str_contains(json_encode($el), $emailS1), json_encode($el));
        resetarLimitesCurtos();
        $r = conta(novoNav(), ['acao' => 'redefinir', 'email' => $emailS1, 'codigo' => $cod, 'senha' => 'senha-pela-caixa-1']);
        checar('…o código que chegou pelo SMTP troca a senha', $r->status === 200, $r->resumo());
        $r = integAdm('POST', '/api/admin.php', ['acao' => 'enviar_redefinicao', 'id' => $uidS2]);
        checar('enviar_redefinicao pelo SMTP: enviado = true (a caixa aceitou)', $r->status === 200 && ($r->json['enviado'] ?? null) === true, $r->resumo());
        $r = integAdm('GET', '/api/admin.php?r=emails');
        checar('?r=emails: resumo.via = smtp', ($r->json['resumo']['via'] ?? '') === 'smtp', $r->resumo());
        $r = integAdm('GET', '/api/equipe.php?r=saude');
        $codigos = array_column((array) ($r->json['problemas'] ?? []), 'codigo');
        checar('Saúde: emailModo smtp, sem problema de SMTP, e nada da caixa na resposta', ($r->json['config']['emailModo'] ?? '') === 'smtp'
            && !in_array('smtp_config', $codigos, true) && !in_array('email_arquivo', $codigos, true) && !str_contains($r->corpo, $USUARIO_SMTP)
            && !str_contains($r->corpo, 'localhost'), $r->resumo());
    });
    [, $uidS3] = novaConta('Caixa Smtp Tres');
    comConfig(['email_modo' => 'smtp', 'smtp' => ['senha' => 'senha-errada-da-caixa'] + $cfgSmtp], static function () use ($uidS3, $lerSmtp, $ultimoEmailLog, $USUARIO_SMTP): void {
        $antes = $lerSmtp();
        $r = integAdm('POST', '/api/admin.php', ['acao' => 'enviar_redefinicao', 'id' => $uidS3]);
        $el = $ultimoEmailLog();
        checar('senha da caixa errada: enviado = false; email_log diz o passo e o código (AUTH 535), sem a senha nem o usuário',
            $r->status === 200 && ($r->json['enviado'] ?? null) === false && (int) ($el['ok'] ?? 1) === 0 && str_contains((string) ($el['detalhe'] ?? ''), 'AUTH: 535')
            && !str_contains((string) $el['detalhe'], 'senha-errada') && !str_contains((string) $el['detalhe'], $USUARIO_SMTP) && count(array_diff_key($lerSmtp(), $antes)) === 0,
            $r->resumo() . ' | ' . json_encode($el));
    });
    [, $uidS4] = novaConta('Caixa Smtp Quatro');
    $semCa = $cfgSmtp;
    unset($semCa['cafile']);
    comConfig(['email_modo' => 'smtp', 'smtp' => $semCa], static function () use ($uidS4, $lerSmtp, $ultimoEmailLog): void {
        $antes = $lerSmtp();
        $r = integAdm('POST', '/api/admin.php', ['acao' => 'enviar_redefinicao', 'id' => $uidS4]);
        $el = $ultimoEmailLog();
        checar('certificado que não confere (sem a CA de teste): não manda (a senha não sai) e o email_log diz o porquê',
            ($r->json['enviado'] ?? null) === false && str_contains((string) ($el['detalhe'] ?? ''), 'certificado') && count(array_diff_key($lerSmtp(), $antes)) === 0,
            $r->resumo() . ' | ' . json_encode($el));
    });
    [, $uidS5] = novaConta('Caixa Smtp Cinco');
    comConfig(['email_modo' => 'smtp', 'smtp' => ['host' => 'localhost']], static function () use ($uidS5, $ultimoEmailLog): void {
        $r = integAdm('POST', '/api/admin.php', ['acao' => 'enviar_redefinicao', 'id' => $uidS5]);
        $el = $ultimoEmailLog();
        checar('smtp sem usuário e senha: não tenta e o email_log diz o que falta', ($r->json['enviado'] ?? null) === false
            && str_contains((string) ($el['detalhe'] ?? ''), 'falta host, usuário ou senha'), json_encode($el));
        $r = integAdm('GET', '/api/equipe.php?r=saude');
        $p = array_values(array_filter((array) ($r->json['problemas'] ?? []), static fn($x) => ($x['codigo'] ?? '') === 'smtp_config'));
        checar('Saúde: problema grave "smtp_config" com o como resolver', count($p) === 1 && ($p[0]['grave'] ?? false) === true && str_contains((string) ($p[0]['resolver'] ?? ''), 'smtp.hostinger.com'),
            $r->resumo());
    });
    resetarLimitesCurtos();
}
if (is_resource($procSmtp)) {
    proc_terminate($procSmtp);
    proc_close($procSmtp);
}
foreach (array_merge(glob("$smtpDir/saida/*") ?: [], glob("$smtpDir/*") ?: []) as $f) {
    if (is_file($f)) {
        @unlink($f);
    }
}
@rmdir("$smtpDir/saida");
@rmdir($smtpDir);

// ══ 2. ?r=usuario com o tipo; hall.php?id= com o destaque ═══════════════════════════════════════

secao('v3.2 integração · ?r=usuario devolve o tipo; hall.php?id= devolve o destaque');
[, $uidT] = novaConta('Tipo Na Ficha');
$r = integAdm('GET', '/api/admin.php?r=usuario&id=' . $uidT);
checar('?r=usuario: tipo = jogador numa conta nova', ($r->json['usuario']['tipo'] ?? null) === 'jogador', $r->resumo());
integAdm('POST', '/api/admin.php', ['acao' => 'mudar_tipo', 'id' => $uidT, 'tipo' => 'oficial']);
$r = integAdm('GET', '/api/admin.php?r=usuario&id=' . $uidT);
checar('?r=usuario: tipo = oficial depois do mudar_tipo (e tester continua false)', ($r->json['usuario']['tipo'] ?? null) === 'oficial' && ($r->json['usuario']['tester'] ?? null) === false, $r->resumo());
if ((int) v('SELECT COUNT(*) FROM hall_foto') === 0) {
    // banco sem Hall (rodando este arquivo sozinho): uma carreira de verdade, abaixo da nota de revisão
    [$navH] = novaConta('Hall Destaque');
    $hD = json_decode(canon(amostra('v-intenso-01')), false);
    $hD->id = 'career-integ-destaque-' . bin2hex(random_bytes(3));
    $hD->career->id = $hD->id;
    $hD->summary->integ = $hD->id;
    $hD->legacy->score = 70;
    $hD->legacy->v = 2;
    $navH->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $hD, 'como' => 'manual']);
    integAdm('POST', '/api/admin.php', ['acao' => 'atualizar_hall']);
}
$foto = q('SELECT carreira_id, carreira_pk FROM hall_foto ORDER BY id LIMIT 1')[0] ?? null;
if (checar('há carreira na fotografia do Hall para conferir o destaque', $foto !== null)) {
    $anonH = novoNav();
    $r0 = $anonH->pedir('GET', '/api/hall.php?id=' . rawurlencode((string) $foto['carreira_id']));
    integAdm('POST', '/api/admin.php', ['acao' => 'destacar_carreira', 'id' => (int) $foto['carreira_pk'], 'sim' => true]);
    $r1 = $anonH->pedir('GET', '/api/hall.php?id=' . rawurlencode((string) $foto['carreira_id']));
    integAdm('POST', '/api/admin.php', ['acao' => 'destacar_carreira', 'id' => (int) $foto['carreira_pk'], 'sim' => false]);
    $r2 = $anonH->pedir('GET', '/api/hall.php?id=' . rawurlencode((string) $foto['carreira_id']));
    checar('hall.php?id=: destaque false → true (destacar_carreira, na hora) → false', ($r0->json['destaque'] ?? null) === false && ($r1->json['destaque'] ?? null) === true
        && ($r2->json['destaque'] ?? null) === false && is_array($r1->json['carreira'] ?? null), $r0->resumo() . ' | ' . $r1->resumo());
}

// ══ 3. "Precisa de atenção": a carreira em revisão (nota alta) tem a linha dela ═════════════════

secao('v3.2 integração · "Precisa de atenção": revisão da nota alta separada das suspeitas');
[$navR, $uidR] = novaConta('Revisao Alta');
$hR = json_decode(canon(amostra('v-intenso-01')), false); // nota 93: espera a revisão (hall_revisao_nota 90)
$hR->id = 'career-integ-revisao-' . bin2hex(random_bytes(3));
$hR->career->id = $hR->id;
$hR->summary->integ = $hR->id;
$hR->legacy->v = 2;
$r = $navR->pedir('POST', '/api/carreiras.php', ['acao' => 'salvar', 'carreira' => $hR, 'como' => 'auto']);
checar('carreira de nota 93 salva vai para a revisão (C.hall = revisao)', $r->status === 200 && ($r->json['carreira']['hall']['estado'] ?? '') === 'revisao', $r->resumo());
$nRev = (int) v("SELECT COUNT(*) FROM carreiras WHERE suspeita = 'revisao' AND oculta = 0");
$nSusp = (int) v("SELECT COUNT(*) FROM carreiras WHERE suspeita IS NOT NULL AND suspeita <> 'revisao' AND oculta = 0");
$r = integAdm('GET', '/api/admin.php?r=atencao&atualizar=1');
$A = array_column($r->json['alertas'] ?? [], null, 'chave');
checar('alerta "revisao" (ação): "N carreira(s) de nota alta espera(m) a sua revisão para entrar no Hall", link Hall · revisao',
    ($A['revisao']['nivel'] ?? '') === 'acao' && ($A['revisao']['n'] ?? 0) === $nRev && ($A['revisao']['link'] ?? null) === ['aba' => 'hall', 'filtro' => 'revisao']
    && preg_match('/^\d+ carreiras? de nota alta esperam? a sua revisão para entrar no Hall$/', (string) ($A['revisao']['texto'] ?? '')) === 1
    && ($A['revisao']['dispensavel'] ?? true) === false, json_encode($A['revisao'] ?? null));
checar('…e o "suspeitas" conta só as suspeitas de verdade', $nSusp === 0 ? !isset($A['suspeitas']) : ($A['suspeitas']['n'] ?? 0) === $nSusp, json_encode($A['suspeitas'] ?? null));
$r = integAdm('POST', '/api/admin.php', ['acao' => 'mostrar_carreira', 'id' => (int) v('SELECT id FROM carreiras WHERE carreira_id = ?', [$hR->id]), 'motivo' => 'Conferi os números']);
$r = integAdm('GET', '/api/admin.php?r=atencao');
$A = array_column($r->json['alertas'] ?? [], null, 'chave');
checar('liberada a revisão, o alerta acompanha (a escrita do admin refaz o cálculo)', $nRev === 1 ? !isset($A['revisao']) : ($A['revisao']['n'] ?? 0) === $nRev - 1, json_encode($A['revisao'] ?? null));

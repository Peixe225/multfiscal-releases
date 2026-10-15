<?php
/**
 * LENDA · teste: servidor SMTP de mentira para o envio pela caixa (O7). Para o teste-v32-integ.php e o teste-v32-corr.php.
 *   php smtp-falso.php <cert.pem> <chave.pem> <pasta de saída> <usuário> <senha>
 * Escuta em 127.0.0.1 numa porta livre (escreve "porta=<n>" na saída), exige STARTTLS antes do AUTH (538 sem ele),
 * aceita AUTH PLAIN e AUTH LOGIN com o usuário e a senha dados (535 com outros), exige AUTH antes do MAIL (530) e grava
 * cada mensagem aceita em <pasta>/<n>.eml (com uma linha "X-Teste-Tls: sim|nao" no topo). RCPT para um endereço que
 * começa com "recusado" recebe o 550 do Postfix com o endereço inteiro (rev3: o email_log mascara). Um cliente por vez;
 * termina quando o processo que o subiu o encerra.
 */
declare(strict_types=1);

[$_, $cert, $chave, $saida, $usuario, $senha] = $argv + array_fill(0, 6, '');
$ctx = stream_context_create(['ssl' => ['local_cert' => $cert, 'local_pk' => $chave, 'verify_peer' => false]]);
$srv = stream_socket_server('tcp://127.0.0.1:0', $n, $t, STREAM_SERVER_BIND | STREAM_SERVER_LISTEN, $ctx);
if (!$srv) {
    fwrite(STDERR, "não subiu: $t\n");
    exit(1);
}
$nome = (string) stream_socket_get_name($srv, false);
echo 'porta=' . substr($nome, strrpos($nome, ':') + 1) . "\n";
@mkdir($saida, 0700, true);
$k = 0;
while (true) {
    $c = @stream_socket_accept($srv, 3600);
    if (!$c) {
        continue;
    }
    stream_set_timeout($c, 20);
    $tls = false;
    $autenticado = false;
    $de = $para = null;
    $diz = static function (string $l) use ($c): void {
        @fwrite($c, $l . "\r\n");
    };
    $diz('220 smtp-falso ESMTP');
    while (($linha = fgets($c, 4096)) !== false) {
        $l = rtrim($linha, "\r\n");
        $cmd = strtoupper(strtok($l, ' ') ?: '');
        if ($cmd === 'EHLO' || $cmd === 'HELO') {
            if ($tls) {
                @fwrite($c, "250-smtp-falso\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
            } else {
                @fwrite($c, "250-smtp-falso\r\n250-STARTTLS\r\n250 8BITMIME\r\n");
            }
        } elseif ($cmd === 'STARTTLS') {
            $diz('220 pode começar');
            $tls = @stream_socket_enable_crypto($c, true, STREAM_CRYPTO_METHOD_TLS_SERVER) === true;
            if (!$tls) {
                break; // o cliente recusou o certificado
            }
        } elseif ($cmd === 'AUTH') {
            if (!$tls) {
                $diz('538 5.7.11 STARTTLS antes');
                continue;
            }
            $partes = explode(' ', $l);
            $tipo = strtoupper($partes[1] ?? '');
            $u = $s = '';
            if ($tipo === 'PLAIN') {
                $b = explode("\0", (string) base64_decode($partes[2] ?? ''));
                $u = $b[1] ?? '';
                $s = $b[2] ?? '';
            } elseif ($tipo === 'LOGIN') {
                $diz('334 VXNlcm5hbWU6');
                $u = (string) base64_decode(rtrim((string) fgets($c, 4096)));
                $diz('334 UGFzc3dvcmQ6');
                $s = (string) base64_decode(rtrim((string) fgets($c, 4096)));
            }
            $autenticado = $u === $usuario && $s === $senha;
            $diz($autenticado ? '235 2.7.0 ok' : '535 5.7.8 usuário ou senha não conferem');
        } elseif ($cmd === 'MAIL') {
            if (!$autenticado) {
                $diz('530 5.7.0 entre primeiro');
                continue;
            }
            $de = substr($l, 10);
            $diz('250 ok');
        } elseif ($cmd === 'RCPT') {
            $para = substr($l, 8);
            // rev3: destinatário que começa com "recusado" é recusado como o Postfix faz (repetindo o endereço inteiro)
            if (preg_match('/^<(recusado[^>]*)>/i', $para, $mm)) {
                $diz('550 5.1.1 <' . $mm[1] . '>: Recipient address rejected: User unknown in virtual mailbox table');
                continue;
            }
            $diz('250 ok');
        } elseif ($cmd === 'DATA') {
            $diz('354 pode mandar');
            $msg = '';
            while (($x = fgets($c, 8192)) !== false && rtrim($x, "\r\n") !== '.') {
                $msg .= $x;
            }
            file_put_contents($saida . '/' . (++$k) . '.eml', 'X-Teste-Tls: ' . ($tls ? 'sim' : 'nao') . "\r\nX-Teste-De: $de\r\nX-Teste-Para: $para\r\n" . $msg);
            $diz('250 2.0.0 aceita');
        } elseif ($cmd === 'QUIT') {
            $diz('221 tchau');
            break;
        } else {
            $diz('502 não sei');
        }
    }
    @fclose($c);
}

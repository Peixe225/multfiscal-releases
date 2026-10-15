<?php
/**
 * LENDA · aviso no celular do admin (v3.2, O6 do mapa): ntfy e/ou Telegram, com o destino no arquivo de config
 * (nunca no banco nem no painel): `aviso_ntfy` = URL do tópico (https://ntfy.sh/<tópico-secreto>) e `aviso_telegram`
 * = ['token' => '<token do bot>', 'chat' => '<id do chat>']. O que avisa fica em site_config.aviso_celular
 * ({denuncia: bool, picoOnline: N}, aba Configurações). Timeout de 3 s e falha calada: nunca atrapalha a rota que
 * chamou. Usado por hall.php (denúncia), e.php (pico) e admin.php (testar_aviso). Nunca é servido.
 * Contrato: servidor/CONTRATO-v32.md §A.
 */
declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

/** {ntfy: url|null, telegram: {token, chat}|null} lidos do arquivo de config (formatos conferidos). */
function canaisCelular(): array
{
    $c = config();
    $ntfy = $c['aviso_ntfy'] ?? null;
    $ntfy = is_string($ntfy) && preg_match('#^https?://[^\s"\'<>]{3,300}$#', $ntfy) ? $ntfy : null;
    $tg = $c['aviso_telegram'] ?? null;
    $tg = is_array($tg) && is_string($tg['token'] ?? null) && preg_match('/^\d{3,20}:[A-Za-z0-9_-]{20,100}$/', $tg['token'])
        && ((is_string($tg['chat'] ?? null) && preg_match('/^-?[0-9A-Za-z@_]{1,64}$/', $tg['chat'])) || is_int($tg['chat'] ?? null))
        ? ['token' => $tg['token'], 'chat' => (string) $tg['chat']] : null;
    return ['ntfy' => $ntfy, 'telegram' => $tg];
}

function celularConfigurado(): bool
{
    $c = canaisCelular();
    return $c['ntfy'] !== null || $c['telegram'] !== null;
}

/** POST curto (3 s); true = respondeu 2xx. Nunca lança. */
function postCurto(string $url, string $corpo, array $cab): bool
{
    try {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $corpo,
                CURLOPT_HTTPHEADER => $cab,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 3,
                CURLOPT_CONNECTTIMEOUT => 3,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            ]);
            $r = curl_exec($ch);
            $st = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            unset($ch);
            return $r !== false && $st >= 200 && $st < 300;
        }
        $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => implode("\r\n", $cab), 'content' => $corpo,
            'timeout' => 3, 'ignore_errors' => true, 'follow_location' => 0]]);
        $r = @file_get_contents($url, false, $ctx);
        $linha = isset($http_response_header[0]) && is_string($http_response_header[0]) ? $http_response_header[0] : '';
        return $r !== false && preg_match('#^HTTP/\S+\s+2\d\d#', $linha) === 1;
    } catch (Throwable) {
        return false;
    }
}

/**
 * Manda o aviso pelos canais configurados. {ntfy: bool|null, telegram: bool|null} (null = canal não configurado).
 * Os textos são do servidor (nada escrito por jogador vai para o celular).
 */
function avisarCelular(string $titulo, string $texto): array
{
    $c = canaisCelular();
    $r = ['ntfy' => null, 'telegram' => null];
    if ($c['ntfy'] !== null) {
        $r['ntfy'] = postCurto($c['ntfy'], $texto, [
            'Content-Type: text/plain; charset=utf-8',
            'Title: =?UTF-8?B?' . base64_encode($titulo) . '?=',
            'Tags: soccer',
        ]);
    }
    if ($c['telegram'] !== null) {
        $r['telegram'] = postCurto('https://api.telegram.org/bot' . $c['telegram']['token'] . '/sendMessage',
            json(['chat_id' => $c['telegram']['chat'], 'text' => $titulo . "\n" . $texto, 'disable_web_page_preview' => true]),
            ['Content-Type: application/json']);
    }
    return $r;
}

/** Marca de "já fiz nesta janela" na tabela tentativas: true só para o primeiro pedido da janela. */
function marcaJanela(string $chave, int $janelaS): bool
{
    [$k, $janela] = chaveLimite($chave, 'aviso', $janelaS);
    return sql('INSERT IGNORE INTO tentativas (chave, janela, n) VALUES (?, ?, 1)', [$k, $janela])->rowCount() === 1;
}

/** Denúncia nova (hall.php, depois de responder): no máximo um aviso a cada 10 min; a que escondeu a carreira sempre avisa. */
function avisarDenunciaNova(bool $ocultou): void
{
    if (!celularConfigurado() || !(siteConfig()['aviso_celular']['denuncia'] ?? false)) {
        return;
    }
    if (!marcaJanela($ocultou ? 'aviso-den-oculta' : 'aviso-denuncia', LENDA_JANELA_S)) {
        return;
    }
    $abertas = (int) umValor("SELECT COUNT(*) FROM denuncias WHERE status = 'aberta'");
    avisarCelular('LENDA · denúncia no Hall', $ocultou
        ? 'Uma carreira saiu do Hall público depois de 5 denúncias e espera a sua decisão no painel.'
        : 'Chegou denúncia nova no Hall público (' . $abertas . ' aberta' . ($abertas === 1 ? '' : 's') . '). Abra o painel para decidir.');
}

/** e.php: pico de gente online (aviso_celular.picoOnline): confere no máximo a cada 10 min e avisa no máximo 1 vez por hora. */
function avisarPicoTalvez(): void
{
    if (!celularConfigurado()) {
        return; // sem canal no arquivo de config: nada de banco
    }
    try {
        $pico = (int) (siteConfig()['aviso_celular']['picoOnline'] ?? 0);
        if ($pico <= 0 || !marcaJanela('aviso-pico-conf', LENDA_JANELA_S)) {
            return;
        }
        $online = (int) umValor('SELECT COUNT(*) FROM visitas WHERE ultimo >= ? AND bot = 0', [dt(time() - 60)]);
        if ($online >= $pico && marcaJanela('aviso-pico', 3600)) {
            avisarCelular('LENDA · pico de gente online', $online . ' pessoas com o jogo aberto agora (o aviso está em ' . $pico . ').');
        }
    } catch (Throwable $e) {
        error_log('LENDA aviso de pico: ' . $e->getMessage());
    }
}

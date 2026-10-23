<?php
/**
 * LENDA · v3.5 (revisão mobile, grupo "base"): a medição de quem chega pelo celular.
 *   · ROBO_UA (e.php): os robôs de verdade (Googlebot, bingbot, AhrefsBot, TelegramBot, a prévia do WhatsApp,
 *     facebookexternalhit, Bytespider, Lighthouse, HeadlessChrome, UA vazio) continuam bot=1; os celulares com "bot" no nome
 *     (CUBOT, inclusive dentro do Instagram e do Facebook) e os navegadores de dentro do TikTok, do Instagram e do WhatsApp
 *     ficam bot=0 — antes um CUBOT sumia do painel.
 *   · normalizarOrigem (_lib.php): o pacote do Android (android-app://com.whatsapp/, ou "com.whatsapp" cru, que a versão de
 *     antes do jogo mandava) vira a rede; o utm implícito do app (source tiktok, medium app) fica como origem tiktok.
 * Incluído pelo teste.php depois do teste-v34-corr.php (usa medir/ctx/visita dele).
 */
declare(strict_types=1);

secao('v3.5 · robô × gente pelo user agent (e.php)');
resetarLimites();

$v35Robos = [
    'Googlebot' => 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.122 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'bingbot' => 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
    'AhrefsBot' => 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
    'TelegramBot' => 'TelegramBot (like TwitterBot)',
    'prévia do WhatsApp' => 'WhatsApp/2.23.20.0 A',
    'facebookexternalhit' => 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Bytespider (TikTok)' => 'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)',
    'Lighthouse (PageSpeed)' => 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
    'HeadlessChrome' => 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
    'Google-InspectionTool' => 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; Google-InspectionTool/1.0;)',
];
$v35Gente = [
    'CUBOT X30 (Chrome)' => 'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    'CUBOT (WebView, Build/)' => 'Mozilla/5.0 (Linux; Android 10; CUBOT X30 Build/QP1A.190711.020; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.70 Mobile Safari/537.36',
    'CUBOT antigo (U; pt-br)' => 'Mozilla/5.0 (Linux; U; Android 4.4.2; pt-br; CUBOT X9 Build/KOT49H) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
    'CUBOT no Instagram' => 'Mozilla/5.0 (Linux; Android 11; KINGKONG 5 Pro Build/RP1A.200720.011; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.70 Mobile Safari/537.36 Instagram 401.0.0.48.79 Android (30/11; 320dpi; 720x1560; CUBOT; KINGKONG 5 Pro; KINGKONG_5_Pro; mt6762; pt_BR; 800000000)',
    'CUBOT no Facebook' => 'Mozilla/5.0 (Linux; Android 10; CUBOT X30 Build/QP1A.190711.020; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.70 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.47.109;FBDV/CUBOT X30;FBMD/CUBOT;]',
    'TikTok (Android)' => 'Mozilla/5.0 (Linux; Android 14; SM-A155M Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.7339.207 Mobile Safari/537.36 trill_410603 JsSdk/1.0 NetType/4G Channel/googleplay AppName/trill app_version/41.6.3 ByteLocale/pt-BR ByteFullLocale/pt-BR Region/BR AppId/1180 Spark/1.7.8.6-bugfix AppVersion/41.6.3 BytedanceWebview/d8a21c6',
    'TikTok (iPhone)' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_41.5.0 JsSdk/2.0 NetType/4G Channel/App Store ByteLocale/pt Region/BR isDarkMode/1 WKWebView/1 RevealType/Dialog BytedanceWebview/d8a21c6 FalconTag/',
    'Instagram (Android)' => 'Mozilla/5.0 (Linux; Android 14; SM-A155M Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.70 Mobile Safari/537.36 Instagram 401.0.0.48.79 Android (34/14; 450dpi; 1080x2340; samsung; SM-A155M; a15; mt6789; pt_BR; 800000000)',
    'Instagram (iPhone)' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 401.0.0.29.80 (iPhone14,7; iOS 18_5; pt_BR; pt-BR; scale=3.00; 1170x2532; 800000000) NW/3',
    'WhatsApp (Android → Custom Tab)' => 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    'WhatsApp (iPhone → Safari)' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
];
$v35Nav = novoNav();
foreach ([[$v35Robos, 1], [$v35Gente, 0]] as [$lista, $esperado]) {
    foreach ($lista as $nome => $ua) {
        $sid = uuid4();
        $r = medir($v35Nav, uuid4(), $sid, [['t' => 'view', 'd' => ['rota' => '/']]], ctx(), 0, ['ua' => $ua]);
        $vis = visita($sid);
        checar(($esperado ? 'robô' : 'gente') . ": $nome → bot=$esperado", $r->status === 204 && $vis !== null && (int) $vis['bot'] === $esperado,
            $r->resumo() . ' bot=' . ($vis['bot'] ?? 'sem visita'));
    }
}

secao('v3.5 · origem: pacotes do Android e o app pelo utm implícito (normalizarOrigem)');
$v35Ua = $v35Gente['TikTok (Android)'];
foreach ([
    ['android-app://com.whatsapp/ (cru)', ctx('android-app://com.whatsapp/'), 'whatsapp'],
    ['com.whatsapp (o jogo de antes)', ctx('com.whatsapp'), 'whatsapp'],
    ['whatsapp (o jogo da v3.5)', ctx('whatsapp'), 'whatsapp'],
    ['com.whatsapp.w4b (Business)', ctx('com.whatsapp.w4b'), 'whatsapp'],
    ['com.zhiliaoapp.musically', ctx('android-app://com.zhiliaoapp.musically/'), 'tiktok'],
    ['com.ss.android.ugc.trill', ctx('com.ss.android.ugc.trill'), 'tiktok'],
    ['com.instagram.android', ctx('com.instagram.android'), 'instagram'],
    ['com.facebook.katana', ctx('android-app://com.facebook.katana/'), 'facebook'],
    ['com.facebook.orca (Messenger)', ctx('com.facebook.orca'), 'facebook'],
    ['com.google.android.gm (Gmail)', ctx('android-app://com.google.android.gm/'), 'gmail'],
    ['app fora da lista', ctx('android-app://com.exemplo.leitor/'), 'com.exemplo.leitor'],
    ['utm implícito do app (tiktok/app)', ctx('', 'mobile', ['source' => 'tiktok', 'medium' => 'app']), 'tiktok'],
    ['l.instagram.com (referrer)', ctx('l.instagram.com'), 'instagram'],
    ['sem nada', ctx(), 'direto'],
] as [$nome, $c, $esperado]) {
    $sid = uuid4();
    $r = medir($v35Nav, uuid4(), $sid, [['t' => 'view', 'd' => ['rota' => '/']]], $c, 0, ['ua' => $v35Ua]);
    $vis = visita($sid);
    checar("origem: $nome → $esperado", $r->status === 204 && ($vis['origem'] ?? null) === $esperado, $r->resumo() . ' origem=' . ($vis['origem'] ?? 'sem visita'));
}
$sid = uuid4();
medir($v35Nav, uuid4(), $sid, [['t' => 'view', 'd' => ['rota' => '/']]], ctx('', 'mobile', ['source' => 'instagram', 'medium' => 'app']), 0, ['ua' => $v35Gente['Instagram (iPhone)']]);
$vis = visita($sid);
checar('utm implícito: utm_source instagram e utm_medium app gravados (Campanhas separa)', ($vis['utm_source'] ?? '') === 'instagram' && ($vis['utm_medium'] ?? '') === 'app'
    && (int) ($vis['bot'] ?? 1) === 0 && ($vis['dispositivo'] ?? '') === 'mobile', json_encode($vis));

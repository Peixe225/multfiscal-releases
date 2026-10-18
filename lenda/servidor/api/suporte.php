<?php
/**
 * LENDA · Fale conosco (CONTRATO-v33 §A): dúvida, ideia, problema, recomendação ou outro, com ou sem conta.
 *   GET  suporte.php → {email, tipos: [{id, nome}], min, max}
 *   POST suporte.php {tipo, mensagem (10 a 2000), email? (obrigatório sem conta), pagina?, site?} → 201 {ok: true, protocolo}
 * `site` é a isca para robôs: veio preenchido, a mensagem é descartada calada (a resposta é a mesma). Limites (só contam as
 * mensagens que passaram na conferência: um erro de digitação não gasta a vez): 5 a cada 10 min por IP (o HMAC diário,
 * nunca o IP; a isca também conta), 20 por dia por conta e 300 a cada 10 min no site. Quem está logado não manda e-mail (a
 * resposta vai para o da conta).
 */
declare(strict_types=1);

require __DIR__ . '/_lib.php';
require __DIR__ . '/_desafios.php';
require __DIR__ . '/_suporte.php';

cabecalhos();

$m = metodo();
if ($m === 'GET') {
    responder(200, ['email' => emailContato(), 'tipos' => array_map(static fn(string $t): array => ['id' => $t, 'nome' => SUPORTE_TIPO_NOME[$t]], SUPORTE_TIPOS),
        'min' => SUPORTE_MIN, 'max' => SUPORTE_MAX]);
}
if ($m !== 'POST') {
    erroMetodo();
}
exigirEscrita();
$j = lerJson(16 * 1024);
if (!esquemaV33()) {
    erro(503, 'indisponivel', 'O Fale conosco ainda não está disponível. Escreva para ' . emailContato() . '.');
}
$u = usuarioLogado();
$tipo = $j['tipo'] ?? null;
if (!is_string($tipo) || !in_array($tipo, SUPORTE_TIPOS, true)) {
    erro(400, 'tipo', 'Escolha o tipo da mensagem: dúvida, ideia, problema, recomendação ou outro.');
}
$msg = $j['mensagem'] ?? null;
$msg = is_string($msg) ? textoLongo($msg) : null;
$n = $msg === null ? 0 : mb_strlen($msg, 'UTF-8');
if ($n < SUPORTE_MIN) {
    erro(400, 'mensagem_curta', 'Escreva um pouco mais (pelo menos ' . SUPORTE_MIN . ' letras), para a gente entender.');
}
if ($n > SUPORTE_MAX) {
    erro(400, 'mensagem_longa', 'A mensagem pode ter até ' . number_format(SUPORTE_MAX, 0, ',', '.') . ' caracteres.');
}
$email = null;
if ($u === null) {
    $e = is_string($j['email'] ?? null) ? strtolower(trim($j['email'])) : '';
    if ($e === '' || strlen($e) > 190 || !filter_var($e, FILTER_VALIDATE_EMAIL)) {
        erro(400, 'email_invalido', 'Deixe um e-mail para a gente responder (ou entre na sua conta).');
    }
    $email = $e;
}
$pag = $j['pagina'] ?? null;
$pagina = is_string($pag) ? texto($pag, 120) : null;
limitar('suporte-ip', quemIp(), 5);
$isca = $j['site'] ?? null;
if ($isca !== null && $isca !== '' && $isca !== false) {
    // robô (preencheu o campo escondido): parece que deu certo, nada é gravado
    responder(201, ['ok' => true, 'protocolo' => protocoloNovo()]);
}
if ($u !== null) {
    limitar('dia-suporte-u', 'u' . $u['id'], 20, 1, 86400);
}
// teto do site inteiro: só conta a mensagem que passou na validação
limitar('suporte-todos', 'todos', 300);
$protocolo = gravarMensagemSuporte($u !== null ? (int) $u['id'] : null, $email, $tipo, $msg, $pagina);
limpezaTalvez();
responder(201, ['ok' => true, 'protocolo' => $protocolo]);

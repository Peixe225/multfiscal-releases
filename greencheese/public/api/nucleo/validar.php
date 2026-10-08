<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Conferência do que chega: texto, WhatsApp, estado, dinheiro, data, slug e a lista do tabaco (Anvisa).

const GC_UFS = ['ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mt', 'ms', 'mg', 'pa', 'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'sp', 'se', 'to'];

/** DDDs em uso no Brasil (plano da Anatel), os mesmos de src/lib/telefone.ts. */
const GC_DDDS = [
    11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
    41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
    71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
];

/**
 * Derivados do tabaco e cigarro eletrônico não entram (Anvisa RDC 840/2023 e RDC 855/2024).
 * Comparação sem acento e sem caixa; 'rape' só como palavra inteira (senão pegaria "grape").
 */
const GC_TERMOS_PROIBIDOS = [
    'backwoods', 'charuto', 'cigarrilha', 'cigarro', 'cigarrete', 'tabaco', 'fumo', 'palheiro', 'swisher',
    'dutch master', 'black & mild', 'black and mild', 'al capone', 'djarum', 'essencia de narguile', 'vape',
    'cigarro eletronico', 'pod descartavel', 'juul', 'ignite', 'elfbar', 'elf bar',
];
const GC_TERMOS_PALAVRA_INTEIRA = ['rape'];

/** Erro de campo: 400 invalido com o campo que a tela marca. */
function gc_invalido(string $campo, string $mensagem, array $extra = []): ErroApi
{
    return new ErroApi('invalido', $mensagem, 400, ['campo' => $campo] + $extra);
}

/**
 * Texto limpo: UTF-8 válido, sem caractere de controle, espaços juntados e aparados.
 * $linhas = true mantém quebras de linha (no máximo uma linha em branco seguida). Não-texto vira null.
 */
function gc_texto(mixed $v, bool $linhas = false): ?string
{
    if ($v === null) {
        return '';
    }
    if (is_int($v) || is_float($v)) {
        $v = (string) $v;
    }
    if (!is_string($v) || !mb_check_encoding($v, 'UTF-8')) {
        return null;
    }
    $v = str_replace(["\r\n", "\r"], "\n", $v);
    // controles (menos a quebra de linha), invisíveis de largura zero e os de direção do texto
    $v = (string) preg_replace('/[\x{0000}-\x{0009}\x{000B}-\x{001F}\x{007F}-\x{009F}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2064}\x{FEFF}]/u', '', $v);
    if ($linhas) {
        $v = (string) preg_replace('/[^\S\n]+/u', ' ', $v);
        $v = (string) preg_replace('/ *\n */u', "\n", $v);
        $v = (string) preg_replace('/\n{3,}/u', "\n\n", $v);
    } else {
        $v = (string) preg_replace('/\s+/u', ' ', $v);
    }
    return trim($v);
}

function gc_tamanho(string $s): int
{
    return mb_strlen($s, 'UTF-8');
}

/** Nome de quem entra: 2 a 60 caracteres depois de limpar. */
function gc_nome(mixed $v, string $campo = 'nome'): string
{
    $n = gc_texto($v);
    if ($n === null || gc_tamanho($n) < 2 || gc_tamanho($n) > 60) {
        throw gc_invalido($campo, 'Põe teu nome (de 2 a 60 letras).');
    }
    return $n;
}

/**
 * Celular brasileiro como '55' + DDD + 9 dígitos. Aceita com ou sem 55, com ou sem pontuação, com 0 na frente.
 * null = não é celular brasileiro.
 */
function gc_whatsapp(mixed $v): ?string
{
    if (is_int($v)) {
        $v = (string) $v;
    }
    if (!is_string($v) || strlen($v) > 40) {
        return null;
    }
    if (preg_match('/[^\d\s()+\-.]/', $v)) {
        return null;
    }
    $d = (string) preg_replace('/\D/', '', $v);
    if ((strlen($d) === 12 || strlen($d) === 13) && str_starts_with($d, '55')) {
        $d = substr($d, 2);
    }
    $d = ltrim($d, '0');
    if (strlen($d) !== 11 || !in_array((int) substr($d, 0, 2), GC_DDDS, true) || $d[2] !== '9') {
        return null;
    }
    return '55' . $d;
}

/** "(33) 99113-9036" a partir do guardado. */
function gc_whatsapp_formatado(string $w): string
{
    $d = substr($w, 2);
    return strlen($d) === 11 ? sprintf('(%s) %s-%s', substr($d, 0, 2), substr($d, 2, 5), substr($d, 7)) : $w;
}

function gc_uf(mixed $v): ?string
{
    if (!is_string($v)) {
        return null;
    }
    $u = strtolower(trim($v));
    return in_array($u, GC_UFS, true) ? $u : null;
}

/**
 * Inteiro (número JSON inteiro, 3.0 ou "3"); fora de [$min, $max] ou outra coisa = null.
 */
function gc_inteiro(mixed $v, int $min, int $max): ?int
{
    if (is_float($v) && floor($v) === $v && abs($v) < 1e9) {
        $v = (int) $v;
    } elseif (is_string($v) && preg_match('/^\s*-?\d{1,9}\s*$/', $v)) {
        $v = (int) trim($v);
    }
    if (!is_int($v) || $v < $min || $v > $max) {
        return null;
    }
    return $v;
}

/** Reais (número, como no catalogo.json; aceita "14,90") em centavos. null = inválido. */
function gc_centavos(mixed $v): ?int
{
    if (is_string($v)) {
        $s = str_replace(['R$', ' '], '', trim($v));
        if (preg_match('/^\d{1,3}(\.\d{3})+,\d{1,2}$/', $s)) {
            $s = str_replace('.', '', $s);
        }
        $s = str_replace(',', '.', $s);
        if (!preg_match('/^\d{1,7}(\.\d{1,2})?$/', $s)) {
            return null;
        }
        $v = (float) $s;
    }
    if (is_int($v)) {
        $v = (float) $v;
    }
    if (!is_float($v) || !is_finite($v) || $v <= 0 || $v > 100000) {
        return null;
    }
    $c = (int) round($v * 100);
    // mais de 2 casas (14.999) não é preço
    if (abs($v * 100 - $c) > 0.0001) {
        return null;
    }
    return $c;
}

/** Centavos em reais como no catalogo.json: 9000 → 90, 1490 → 14.9. */
function gc_reais(int $c): int|float
{
    return $c % 100 === 0 ? intdiv($c, 100) : $c / 100;
}

/** "14,90" para o CSV. */
function gc_reais_texto(int $c): string
{
    return number_format($c / 100, 2, ',', '.');
}

/** Data ISO (com fuso; sem fuso = horário de Brasília) em unix. Vazio = null; inválida lança. */
function gc_data(mixed $v, string $campo): ?int
{
    if ($v === null || $v === '') {
        return null;
    }
    if (!is_string($v) || strlen($v) > 40 || !preg_match('/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?)?(Z|[+\-]\d{2}:?\d{2})?$/', $v)) {
        throw gc_invalido($campo, 'Data inválida.');
    }
    try {
        $d = new DateTimeImmutable($v, new DateTimeZone('America/Sao_Paulo'));
    } catch (Exception) {
        throw gc_invalido($campo, 'Data inválida.');
    }
    return $d->getTimestamp();
}

/** Minúsculo e sem acento (para comparar e para o slug). */
function gc_sem_acento(string $s): string
{
    $s = mb_strtolower($s, 'UTF-8');
    return strtr($s, [
        'á' => 'a', 'à' => 'a', 'â' => 'a', 'ã' => 'a', 'ä' => 'a', 'å' => 'a', 'ā' => 'a',
        'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e', 'ē' => 'e',
        'í' => 'i', 'ì' => 'i', 'î' => 'i', 'ï' => 'i', 'ī' => 'i',
        'ó' => 'o', 'ò' => 'o', 'ô' => 'o', 'õ' => 'o', 'ö' => 'o', 'ø' => 'o', 'ō' => 'o',
        'ú' => 'u', 'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'ū' => 'u',
        'ç' => 'c', 'ñ' => 'n', 'ý' => 'y', 'ÿ' => 'y', 'ß' => 'ss', 'æ' => 'ae', 'œ' => 'oe',
        'ª' => 'a', 'º' => 'o',
    ]);
}

/**
 * Primeiro termo proibido achado nos textos (ou null). Pontuação vira espaço (o "&" fica), então
 * "Black&Mild", "black-and-mild" e "BLACK & MILD" caem igual; os de duas palavras também valem colados.
 */
function gc_termo_proibido(string ...$textos): ?string
{
    foreach ($textos as $t) {
        $s = gc_sem_acento($t);
        $s = str_replace('&', ' & ', $s);
        $s = (string) preg_replace('/[^a-z0-9&]+/', ' ', $s);
        $s = ' ' . trim((string) preg_replace('/\s+/', ' ', $s)) . ' ';
        $colado = str_replace(' ', '', $s);
        foreach (GC_TERMOS_PROIBIDOS as $termo) {
            if (str_contains($s, $termo)) {
                return $termo;
            }
            if (str_contains($termo, ' ') && str_contains($colado, str_replace(' ', '', $termo))) {
                return $termo;
            }
        }
        foreach (GC_TERMOS_PALAVRA_INTEIRA as $termo) {
            if (str_contains($s, ' ' . $termo . ' ')) {
                return $termo;
            }
        }
    }
    return null;
}

/** Slug do título: a-z, 0-9 e hífen, até 60. */
function gc_slug(string $titulo): string
{
    $s = (string) preg_replace('/[^a-z0-9]+/', '-', gc_sem_acento($titulo));
    $s = trim($s, '-');
    if (strlen($s) > 60) {
        $s = substr($s, 0, 60);
        $corte = strrpos($s, '-');
        if ($corte !== false && $corte > 20) {
            $s = substr($s, 0, $corte);
        }
        $s = rtrim($s, '-');
    }
    return $s === '' ? 'rateio' : $s;
}

function gc_id_valido(mixed $v): bool
{
    return is_string($v) && preg_match('/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/', $v) === 1;
}

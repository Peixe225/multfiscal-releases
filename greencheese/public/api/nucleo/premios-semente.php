<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Semente dos prêmios do Teste minha sorte: vale enquanto a frente da loja não define gc_premios_ativos() (os prêmios
// no painel). Carregada só pelo gc_premios_do_giro (sorte.php), depois de todos os módulos: se a da loja existir, esta
// nem é lida. Os prêmios vêm de premios-sorte.json, gerado de src/dados/sorte.ts (node scripts/gerar-premios-sorte.mjs).

if (!function_exists('gc_premios_ativos')) {
    /**
     * Prêmios que valem agora no estado ($uf null = todos os que valem), no formato de src/dados/sorte.ts.
     * @return list<array<string, mixed>>
     */
    function gc_premios_ativos(?string $uf = null): array
    {
        static $semente = null;
        if ($semente === null) {
            $j = json_decode((string) @file_get_contents(__DIR__ . '/premios-sorte.json'), true);
            $semente = is_array($j) && is_array($j['premios'] ?? null) ? $j['premios'] : [];
        }
        $out = [];
        foreach ($semente as $p) {
            // sem estado (ou estado que a loja não atende), todos; senão, só os que valem lá (como premiosElegiveis do site)
            if (!is_array($p) || ($uf !== null && !in_array($uf, (array) ($p['ufs'] ?? []), true))) {
                continue;
            }
            unset($p['ufs']);
            $out[] = $p;
        }
        return $out;
    }
}

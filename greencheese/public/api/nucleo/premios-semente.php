<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Semente dos prêmios do Teste minha sorte: os prêmios de premios-sorte.json, gerado de src/dados/sorte.ts (node
// scripts/gerar-premios-sorte.mjs). Carregada só quando precisa: pelo gc_premios_do_giro (sorte.php), se nenhum módulo
// definiu gc_premios_ativos(), e pela loja (loja.php) enquanto ela ainda não foi montada no servidor (painel sem
// instalar: o site também segue com os prêmios embutidos).

/**
 * Prêmios da semente que valem no estado ($uf null = todos os que valem), no formato de src/dados/sorte.ts.
 * @return list<array<string, mixed>>
 */
function gc_premios_da_semente(?string $uf = null): array
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

if (!function_exists('gc_premios_ativos')) {
    /** Sem a loja no servidor, os prêmios do giro são os da semente. @return list<array<string, mixed>> */
    function gc_premios_ativos(?string $uf = null): array
    {
        return gc_premios_da_semente($uf);
    }
}

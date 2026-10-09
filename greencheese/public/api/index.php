<?php
// API da Green Cheese: controlador único, rota por parâmetro (index.php?r=<rota>), sem regra de reescrita (a raiz
// do domínio já tem a dela). O contrato está no API.md. Os módulos ficam em nucleo/ (negado pelo .htaccess e com
// guarda no topo de cada arquivo: acesso direto não faz nada); banco e log em privado/.
declare(strict_types=1);

define('GC_API', '1.0.0');

require __DIR__ . '/nucleo/base.php';
require __DIR__ . '/nucleo/banco.php';
require __DIR__ . '/nucleo/validar.php';
require __DIR__ . '/nucleo/limite.php';
require __DIR__ . '/nucleo/sessao.php';
require __DIR__ . '/nucleo/rateio.php';
require __DIR__ . '/nucleo/exemplos.php';
require __DIR__ . '/nucleo/publico.php';
require __DIR__ . '/nucleo/painel.php';
require __DIR__ . '/nucleo/upload.php';
require __DIR__ . '/nucleo/diagnostico.php';
// loja: catálogo, estados, stories, ajustes e Teste minha sorte (site e painel)
require __DIR__ . '/nucleo/loja-migracoes.php';
require __DIR__ . '/nucleo/loja.php';
require __DIR__ . '/nucleo/loja-validar.php';
require __DIR__ . '/nucleo/loja-painel.php';

$rotas = [
    // site
    'rateios' => ['GET', 'gc_rota_rateios'],
    'rateio' => ['GET', 'gc_rota_rateio'],
    'rateio-entrar' => ['POST', 'gc_rota_rateio_entrar'],
    'minhas-vagas' => ['GET', 'gc_rota_minhas_vagas'],
    'pix-webhook' => ['POST', 'gc_rota_pix_webhook'],
    // painel do dono
    'admin-sessao' => ['GET', 'gc_rota_admin_sessao'],
    'admin-instalar' => ['POST', 'gc_rota_admin_instalar'],
    'admin-recuperar' => ['POST', 'gc_rota_admin_recuperar'],
    'admin-entrar' => ['POST', 'gc_rota_admin_entrar'],
    'admin-sair' => ['POST', 'gc_rota_admin_sair'],
    'admin-senha' => ['POST', 'gc_rota_admin_senha'],
    'admin-resumo' => ['GET', 'gc_rota_admin_resumo'],
    'admin-rateios' => ['GET', 'gc_rota_admin_rateios'],
    'admin-rateio' => ['GET', 'gc_rota_admin_rateio'],
    'admin-rateio-salvar' => ['POST', 'gc_rota_admin_rateio_salvar'],
    'admin-rateio-status' => ['POST', 'gc_rota_admin_rateio_status'],
    'admin-rateio-apagar' => ['POST', 'gc_rota_admin_rateio_apagar'],
    'admin-participantes' => ['GET', 'gc_rota_admin_participantes'],
    'admin-participante-salvar' => ['POST', 'gc_rota_admin_participante_salvar'],
    'admin-participante-status' => ['POST', 'gc_rota_admin_participante_status'],
    'admin-participante-apagar' => ['POST', 'gc_rota_admin_participante_apagar'],
    'admin-participantes-csv' => ['GET', 'gc_rota_admin_participantes_csv'],
    'admin-backup' => ['GET', 'gc_rota_admin_backup'],
    'admin-upload' => ['POST', 'gc_rota_admin_upload'],
    'admin-diagnostico' => ['GET', 'gc_rota_admin_diagnostico'],
    'admin-eventos' => ['GET', 'gc_rota_admin_eventos'],
    // loja: o site lê tudo num JSON só; o painel mexe em cada pedaço
    'loja' => ['GET', 'gc_rota_loja'],
    'admin-loja' => ['GET', 'gc_rota_admin_loja'],
    'admin-loja-salvar' => ['POST', 'gc_rota_admin_loja_salvar'],
    'admin-loja-exemplos-apagar' => ['POST', 'gc_rota_admin_loja_exemplos_apagar'],
    'admin-produto-salvar' => ['POST', 'gc_rota_admin_produto_salvar'],
    'admin-produto-estado' => ['POST', 'gc_rota_admin_produto_estado'],
    'admin-produto-apagar' => ['POST', 'gc_rota_admin_produto_apagar'],
    'admin-produtos-ordem' => ['POST', 'gc_rota_admin_produtos_ordem'],
    'admin-categoria-salvar' => ['POST', 'gc_rota_admin_categoria_salvar'],
    'admin-categoria-apagar' => ['POST', 'gc_rota_admin_categoria_apagar'],
    'admin-categorias-ordem' => ['POST', 'gc_rota_admin_categorias_ordem'],
    'admin-estado-salvar' => ['POST', 'gc_rota_admin_estado_salvar'],
    'admin-stories-salvar' => ['POST', 'gc_rota_admin_stories_salvar'],
    'admin-sorte-salvar' => ['POST', 'gc_rota_admin_sorte_salvar'],
    'admin-premio-salvar' => ['POST', 'gc_rota_admin_premio_salvar'],
    'admin-premio-apagar' => ['POST', 'gc_rota_admin_premio_apagar'],
];

if (gc_teste()) {
    // só com GC_TESTE=1 (scripts/testar-api.mjs): um erro de verdade, pra conferir que o detalhe não vaza
    $rotas['teste-erro'] = ['GET', static function (): array {
        throw new RuntimeException('detalhe-secreto-do-teste em /caminho/interno');
    }];
}

gc_atender($rotas);

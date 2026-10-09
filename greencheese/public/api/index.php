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
// pedidos, avisos no WhatsApp e textos do pedido guiado (site e painel)
require __DIR__ . '/nucleo/pedido-migracoes.php';
require __DIR__ . '/nucleo/pedido.php';
require __DIR__ . '/nucleo/avisos.php';
require __DIR__ . '/nucleo/textos.php';
// contas: a equipe do painel (papéis e o mapa de permissões) e os clientes do site (entrar com código, Minha conta,
// Teste minha sorte no servidor)
require __DIR__ . '/nucleo/contas-migracoes.php';
require __DIR__ . '/nucleo/equipe.php';
require __DIR__ . '/nucleo/clientes.php';
require __DIR__ . '/nucleo/sorte.php';

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
    // pedidos, avisos no WhatsApp e textos do pedido guiado: o site manda o pedido e lê as falas; o painel cuida do resto
    'pedido' => ['POST', 'gc_rota_pedido'],
    'pedido-textos' => ['GET', 'gc_rota_pedido_textos'],
    'admin-pedidos' => ['GET', 'gc_rota_admin_pedidos'],
    'admin-pedidos-resumo' => ['GET', 'gc_rota_admin_pedidos_resumo'],
    'admin-pedido' => ['GET', 'gc_rota_admin_pedido'],
    'admin-pedido-status' => ['POST', 'gc_rota_admin_pedido_status'],
    'admin-pedido-salvar' => ['POST', 'gc_rota_admin_pedido_salvar'],
    'admin-pedido-apagar-dados' => ['POST', 'gc_rota_admin_pedido_apagar_dados'],
    'admin-avisos' => ['GET', 'gc_rota_admin_avisos'],
    'admin-avisos-salvar' => ['POST', 'gc_rota_admin_avisos_salvar'],
    'admin-avisos-testar' => ['POST', 'gc_rota_admin_avisos_testar'],
    'admin-aviso-reenviar' => ['POST', 'gc_rota_admin_aviso_reenviar'],
    'admin-textos-pedido' => ['GET', 'gc_rota_admin_textos_pedido'],
    'admin-texto-pedido-salvar' => ['POST', 'gc_rota_admin_texto_pedido_salvar'],
    // contas: o site (recursos, cliente-*) e o painel (equipe e clientes)
    'recursos' => ['GET', 'gc_rota_recursos'],
    'cliente-codigo' => ['POST', 'gc_rota_cliente_codigo'],
    'cliente-entrar' => ['POST', 'gc_rota_cliente_entrar'],
    'cliente-eu' => ['GET', 'gc_rota_cliente_eu'],
    'cliente-atualizar' => ['POST', 'gc_rota_cliente_atualizar'],
    'cliente-sair' => ['POST', 'gc_rota_cliente_sair'],
    'cliente-apagar' => ['POST', 'gc_rota_cliente_apagar'],
    'cliente-exportar' => ['GET', 'gc_rota_cliente_exportar'],
    'cliente-pedidos' => ['GET', 'gc_rota_cliente_pedidos'],
    'cliente-vagas' => ['GET', 'gc_rota_cliente_vagas'],
    'cliente-endereco-salvar' => ['POST', 'gc_rota_cliente_endereco_salvar'],
    'cliente-endereco-apagar' => ['POST', 'gc_rota_cliente_endereco_apagar'],
    'cliente-giro' => ['GET', 'gc_rota_cliente_giro'],
    'cliente-girar' => ['POST', 'gc_rota_cliente_girar'],
    'cliente-guardar' => ['POST', 'gc_rota_cliente_guardar'],
    'cliente-cupom-usar' => ['POST', 'gc_rota_cliente_cupom_usar'],
    'admin-usuarios' => ['GET', 'gc_rota_admin_usuarios'],
    'admin-usuario-salvar' => ['POST', 'gc_rota_admin_usuario_salvar'],
    'admin-usuario-senha' => ['POST', 'gc_rota_admin_usuario_senha'],
    'admin-usuario-status' => ['POST', 'gc_rota_admin_usuario_status'],
    'admin-clientes' => ['GET', 'gc_rota_admin_clientes'],
    'admin-cliente' => ['GET', 'gc_rota_admin_cliente'],
    'admin-clientes-csv' => ['GET', 'gc_rota_admin_clientes_csv'],
    'admin-cliente-apagar' => ['POST', 'gc_rota_admin_cliente_apagar'],
    'admin-clientes-ajustes' => ['POST', 'gc_rota_admin_clientes_ajustes'],
    'admin-cupom-usado' => ['POST', 'gc_rota_admin_cupom_usado'],
];

if (gc_teste()) {
    // só com GC_TESTE=1 (scripts/testar-api.mjs): um erro de verdade, pra conferir que o detalhe não vaza
    $rotas['teste-erro'] = ['GET', static function (): array {
        throw new RuntimeException('detalhe-secreto-do-teste em /caminho/interno');
    }];
}

gc_atender($rotas);

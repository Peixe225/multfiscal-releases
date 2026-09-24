<?php
declare(strict_types=1);

namespace OmniChannel\Atendimento;

use OmniChannel\Nucleo\Roteador;

/**
 * Rotas do núcleo do atendimento (descobertas sozinhas pela Aplicacao):
 * atendentes, contatos, conversas, etiquetas, respostas rápidas e métricas.
 * Mesmos caminhos, métodos e status do app Python.
 */
final class Rotas
{
    public static function registrar(Roteador $r): void
    {
        $r->get('/api/atendentes', [ApiAtendentes::class, 'listar']);
        $r->post('/api/atendentes', [ApiAtendentes::class, 'criar'], status: 201);
        $r->patch('/api/atendentes/{atendente_id:int}', [ApiAtendentes::class, 'atualizar']);

        $r->get('/api/contatos', [ApiContatos::class, 'listar']);
        $r->get('/api/contatos/{contato_id:int}', [ApiContatos::class, 'obter']);
        $r->patch('/api/contatos/{contato_id:int}', [ApiContatos::class, 'atualizar']);
        $r->post('/api/contatos/{contato_id:int}/mesclar/{outro_id:int}', [ApiContatos::class, 'mesclar']);

        $r->get('/api/conversas', [ApiConversas::class, 'listar']);
        $r->get('/api/conversas/{conversa_id:int}', [ApiConversas::class, 'obter']);
        $r->post('/api/conversas/{conversa_id:int}/mensagens', [ApiConversas::class, 'responder'], status: 201);
        $r->post('/api/conversas/{conversa_id:int}/notas', [ApiConversas::class, 'anotar'], status: 201);
        $r->post('/api/conversas/{conversa_id:int}/atribuir', [ApiConversas::class, 'atribuir']);
        $r->post('/api/conversas/{conversa_id:int}/status', [ApiConversas::class, 'mudarStatus']);
        $r->post('/api/conversas/{conversa_id:int}/prioridade', [ApiConversas::class, 'mudarPrioridade']);
        $r->post('/api/conversas/{conversa_id:int}/etiquetas', [ApiConversas::class, 'marcarEtiqueta']);
        $r->delete('/api/conversas/{conversa_id:int}/etiquetas/{etiqueta_id:int}', [ApiConversas::class, 'desmarcarEtiqueta']);
        $r->post('/api/conversas/{conversa_id:int}/ler', [ApiConversas::class, 'ler']);

        $r->get('/api/etiquetas', [ApiCatalogo::class, 'listarEtiquetas']);
        $r->post('/api/etiquetas', [ApiCatalogo::class, 'criarEtiqueta'], status: 201);
        $r->delete('/api/etiquetas/{etiqueta_id:int}', [ApiCatalogo::class, 'removerEtiqueta'], status: 204);
        $r->get('/api/respostas-rapidas', [ApiCatalogo::class, 'listarRespostas']);
        $r->post('/api/respostas-rapidas', [ApiCatalogo::class, 'criarResposta'], status: 201);
        $r->delete('/api/respostas-rapidas/{resposta_id:int}', [ApiCatalogo::class, 'removerResposta'], status: 204);

        $r->get('/api/metricas/resumo', [ApiCatalogo::class, 'metricas']);
    }
}

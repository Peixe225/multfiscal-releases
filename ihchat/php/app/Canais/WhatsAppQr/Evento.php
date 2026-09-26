<?php
declare(strict_types=1);

namespace IHchat\Canais\WhatsAppQr;

use IHchat\Atendimento\MensagemRecebida;

/** O que uma entrega do provedor traz, já traduzido (Evento de app/canais/whatsapp_qr.py). */
final class Evento
{
    /** @var list<MensagemRecebida> mensagens do cliente */
    public array $recebidas = [];
    /** @var list<MensagemRecebida> fromMe: o dono respondendo pelo celular */
    public array $doCelular = [];
    /** @var list<array{externo_id: string, status: string}> recibos de entrega/leitura */
    public array $recibos = [];
    /** @var array{0: string, 1: ?string}|null [estado, número] */
    public ?array $conexao = null;
}

<?php
declare(strict_types=1);

namespace IHchat\Canais\WhatsAppQr;

/**
 * Estado da conexão no provedor: o que GET /api/canais/{id}/qr devolve
 * (EstadoConexao de app/canais/whatsapp_qr.py).
 */
final class EstadoConexao
{
    public const CONECTADO = 'conectado';
    public const AGUARDANDO = 'aguardando_leitura';
    public const DESCONECTADO = 'desconectado';
    public const ERRO = 'erro';

    public function __construct(
        public readonly string $status,
        public readonly ?string $qr = null,
        public readonly ?string $numero = null,
        public readonly string $mensagem = '',
    ) {
    }

    public static function erro(string $mensagem): self
    {
        return new self(self::ERRO, mensagem: $mensagem);
    }

    public static function frase(string $estado, ?string $numero = null): string
    {
        return match ($estado) {
            self::CONECTADO => $numero !== null ? "WhatsApp conectado ao número {$numero}" : 'WhatsApp conectado',
            self::AGUARDANDO => 'Abra o WhatsApp no celular e leia o QR Code',
            default => 'O WhatsApp não está conectado: leia o QR Code para conectar',
        };
    }

    public static function conectado(?string $numero): self
    {
        return new self(self::CONECTADO, numero: $numero, mensagem: self::frase(self::CONECTADO, $numero));
    }

    public function comMensagem(string $mensagem): self
    {
        return new self($this->status, $this->qr, $this->numero, $mensagem);
    }

    /** @return array{status: string, qr: ?string, numero: ?string, mensagem: string} */
    public function saida(): array
    {
        return ['status' => $this->status, 'qr' => $this->qr, 'numero' => $this->numero, 'mensagem' => $this->mensagem];
    }
}

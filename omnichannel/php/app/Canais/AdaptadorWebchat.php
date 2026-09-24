<?php
declare(strict_types=1);

namespace OmniChannel\Canais;

use OmniChannel\Atendimento\MensagemRecebida;
use OmniChannel\Atendimento\ResultadoEnvio;
/** Webchat do próprio site: a entrega acontece dentro do sistema (eventos por consulta). */
final class AdaptadorWebchat extends Adaptador
{
    public const TIPO = Campos::WEBCHAT;

    public function configurado(): bool
    {
        return true;
    }

    /** O arquivo já está guardado aqui; o visitante o busca pela API. */
    public function enviaArquivos(): bool
    {
        return true;
    }

    public function verificarConexao(): string
    {
        return 'O webchat não depende de provedor externo: está sempre pronto.';
    }

    /**
     * O widget usa rotas próprias (/api/widget/*, com sessão por visitante). O
     * POST /webhooks/{id} do webchat não tinha autenticação nenhuma e só
     * servia para criar conversas forjadas: a rota o recusa.
     */
    public function recebeWebhook(): bool
    {
        return false;
    }

    /** Mantido para quem traduz uma entrega à mão (testes, importações). */
    public function analisarWebhook(array $payload): array
    {
        $identificador = self::texto($payload['visitante'] ?? null) ?? self::texto($payload['identificador'] ?? null);
        $conteudo = trim(self::texto($payload['conteudo'] ?? null) ?? self::texto($payload['texto'] ?? null) ?? '');
        if ($identificador === null || $conteudo === '') {
            return [];
        }
        return [new MensagemRecebida(
            identificador: $identificador,
            conteudo: $conteudo,
            nome_exibicao: self::texto($payload['nome'] ?? null),
            externo_id: $this->prefixar(self::texto($payload['id'] ?? null)),
        )];
    }

    protected function enviarDeFato(string $destino, string $conteudo, array $contexto): ResultadoEnvio
    {
        // a mensagem já foi gravada; o visitante a recebe pelo fluxo de eventos
        return new ResultadoEnvio(ResultadoEnvio::ENVIADA);
    }

    private static function texto(mixed $valor): ?string
    {
        if (is_string($valor)) {
            return $valor === '' ? null : $valor;
        }
        return is_int($valor) || is_float($valor) ? (string) $valor : null;
    }
}

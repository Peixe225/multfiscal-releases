<?php
declare(strict_types=1);

namespace IHchat\Atendimento;

/**
 * Quem está falando com o cliente.
 *
 * Toda resposta grava em mensagens.assinatura o {nome, setor} do atendente
 * NO MOMENTO do envio (se ele mudar de setor depois, o histórico continua
 * dizendo o que o cliente viu). O texto que vai ao provedor leva a
 * assinatura no jeito de cada canal; o `conteudo` gravado fica sem ela, para
 * o painel não mostrar o nome duas vezes:
 *
 *   WhatsApp  primeira linha "*Ana · Suporte técnico*" (negrito do WhatsApp)
 *   Telegram  primeira linha "Ana · Suporte técnico" (texto puro, sem parse_mode)
 *   e-mail    no fim, depois do separador de assinatura "-- "
 *   webchat   texto intacto: o widget mostra autor e setor em campos próprios
 */
final class Assinaturas
{
    public const SEPARADOR = ' · ';

    /**
     * @param array{nome: string, setor: ?string}|null $assinatura
     */
    public static function aplicar(string $tipoCanal, string $conteudo, ?array $assinatura): string
    {
        if ($assinatura === null || trim((string) ($assinatura['nome'] ?? '')) === '') {
            return $conteudo;
        }
        $linha = self::linha($assinatura);
        return match ($tipoCanal) {
            'whatsapp' => self::emCima('*' . $linha . '*', $conteudo),
            'telegram' => self::emCima($linha, $conteudo),
            'email' => self::noFim($assinatura, $conteudo),
            default => $conteudo,
        };
    }

    /** "Ana · Suporte técnico" (só o nome, sem setor). @param array{nome: string, setor: ?string} $assinatura */
    public static function linha(array $assinatura): string
    {
        // quebra de linha no nome ou setor desmontaria o formato (e, no
        // e-mail, pareceria parte da mensagem)
        $nome = trim((string) preg_replace('/\s+/u', ' ', (string) $assinatura['nome']));
        $setor = trim((string) preg_replace('/\s+/u', ' ', (string) ($assinatura['setor'] ?? '')));
        return $setor === '' ? $nome : $nome . self::SEPARADOR . $setor;
    }

    private static function emCima(string $cabecalho, string $conteudo): string
    {
        return $conteudo === '' ? $cabecalho : $cabecalho . "\n" . $conteudo;
    }

    /** @param array{nome: string, setor: ?string} $assinatura */
    private static function noFim(array $assinatura, string $conteudo): string
    {
        $nome = trim((string) preg_replace('/\s+/u', ' ', (string) $assinatura['nome']));
        $setor = trim((string) preg_replace('/\s+/u', ' ', (string) ($assinatura['setor'] ?? '')));
        $bloco = "-- \n" . $nome . ($setor === '' ? '' : "\n" . $setor);
        return $conteudo === '' ? $bloco : rtrim($conteudo) . "\n\n" . $bloco;
    }
}

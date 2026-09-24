<?php
declare(strict_types=1);

namespace OmniChannel\Tarefas;

use OmniChannel\Widget\Faxina;

/**
 * Tira do banco as sessões do widget abertas há mais de um dia que nunca
 * mandaram mensagem (e o contato vazio que cada uma criou). Abrir o widget
 * sem escrever é o caso comum — e um robô abrindo sessões em série encheria
 * contatos e sessoes_widget sem isto. A abertura de sessão também faz uma
 * faxina de vez em quando (1 em 100); o cron garante que ela aconteça mesmo
 * num site com pouco movimento.
 */
final class FaxinaWidget
{
    public const INTERVALO = 3600;

    public static function executar(): string
    {
        [$sessoes, $contatos] = Faxina::limpar();
        if ($sessoes === 0 && $contatos === 0) {
            return '';
        }
        return "sessões do widget sem mensagem removidas: {$sessoes}; contatos vazios removidos: {$contatos}";
    }
}

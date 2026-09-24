<?php
declare(strict_types=1);

namespace IHchat\Canais\Tarefas;

use IHchat\Canais\Coletor;

/**
 * Coleta do cron: e-mails não lidos (IMAP) e Telegram em modo polling.
 * Uma vez por minuto; o Telegram em modo webhook não passa por aqui.
 */
final class ColetarCanais
{
    public const INTERVALO = 60;

    public static function executar(): string
    {
        $r = Coletor::coletarTodos();
        if ($r['canais'] === 0 || ($r['novas'] === 0 && $r['erros'] === 0)) {
            return '';
        }
        return "{$r['novas']} mensagem(ns) nova(s) de {$r['canais']} canal(is)" . ($r['erros'] > 0 ? ", {$r['erros']} com erro" : '');
    }
}

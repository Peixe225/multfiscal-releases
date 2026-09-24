<?php
declare(strict_types=1);

namespace OmniChannel\Tarefas;

use OmniChannel\Eventos\Eventos;

/** Mantém a fila de eventos pequena (a poda na publicação é só oportunista). */
final class PodarEventos
{
    public const INTERVALO = 3600;

    public static function executar(): string
    {
        $apagados = Eventos::podar();
        return $apagados > 0 ? "{$apagados} eventos antigos apagados" : '';
    }
}

<?php
declare(strict_types=1);

namespace OmniChannel\Canais;

/** Fábrica de adaptadores a partir de um canal cadastrado (app/canais/registro.py). */
final class Registro
{
    public const ADAPTADORES = [
        Campos::WHATSAPP => AdaptadorWhatsApp::class,
        Campos::TELEGRAM => AdaptadorTelegram::class,
        Campos::EMAIL => AdaptadorEmail::class,
        Campos::WEBCHAT => AdaptadorWebchat::class,
    ];

    /**
     * @param array<string, mixed> $canal linha tipada (Canais::tipar)
     * @throws CanalNaoSuportado
     */
    public static function adaptadorPara(array $canal): Adaptador
    {
        $classe = self::ADAPTADORES[$canal['tipo'] ?? ''] ?? null;
        if ($classe === null) {
            throw new CanalNaoSuportado('tipo de canal desconhecido: ' . ($canal['tipo'] ?? ''));
        }
        return new $classe($canal);
    }
}

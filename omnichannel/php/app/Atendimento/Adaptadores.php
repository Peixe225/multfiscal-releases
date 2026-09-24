<?php
declare(strict_types=1);

namespace OmniChannel\Atendimento;

use OmniChannel\Banco\Banco;
use OmniChannel\Nucleo\Json;
use OmniChannel\Nucleo\Log;

/**
 * Onde o núcleo do atendimento encontra o adaptador de um canal.
 *
 * A frente de canais registra os adaptadores em
 * `OmniChannel\Canais\Registro::adaptadorPara(array $canal)`; enquanto ela
 * não existir (ou para um tipo que ela não conheça), vale o AdaptadorSandbox.
 * Um adaptador que não implemente AdaptadorDeCanal passa pela ponte
 * AdaptadorExterno. Nos testes, definir() troca a fábrica.
 */
final class Adaptadores
{
    public const REGISTRO = 'OmniChannel\\Canais\\Registro';

    /** @var (callable(array<string, mixed>): AdaptadorDeCanal)|null */
    private static $fabrica = null;

    /** @param (callable(array<string, mixed>): AdaptadorDeCanal)|null $fabrica */
    public static function definir(?callable $fabrica): void
    {
        self::$fabrica = $fabrica;
    }

    /** @param array<string, mixed> $canal linha de `canais` (credenciais em texto JSON ou já decodificadas) */
    public static function para(array $canal): AdaptadorDeCanal
    {
        $canal = self::comCredenciais($canal);
        if (self::$fabrica !== null) {
            return (self::$fabrica)($canal);
        }
        if (class_exists(self::REGISTRO) && method_exists(self::REGISTRO, 'adaptadorPara')) {
            try {
                $adaptador = (self::REGISTRO)::adaptadorPara($canal);
            } catch (\Throwable $erro) {
                // tipo desconhecido para a frente de canais: o sandbox responde
                Log::aviso('adaptador de canal indisponível', ['canal' => $canal['id'] ?? null, 'erro' => $erro->getMessage()]);
                $adaptador = null;
            }
            if ($adaptador instanceof AdaptadorDeCanal) {
                return $adaptador;
            }
            if (is_object($adaptador)) {
                return new AdaptadorExterno($adaptador, $canal);
            }
        }
        return new AdaptadorSandbox($canal);
    }

    /**
     * O que dizer ao atendente quando o canal falha. Erros "de canal"
     * (ErroCanal da frente de canais, falha de rede, arquivo grande) trazem
     * frases pensadas para a tela; qualquer outro pode carregar detalhe interno
     * (uma URL com token do bot, por exemplo) e vira frase genérica — o
     * detalhe vai para o log.
     */
    public static function mensagemDeErro(\Throwable $erro): string
    {
        $classe = (new \ReflectionClass($erro))->getShortName();
        if (in_array($classe, ['ErroCanal', 'ErroTransporte', 'AnexoGrande', 'ErroDeCanal'], true)
            || $erro instanceof \OmniChannel\Nucleo\Http\ErroTransporte) {
            $mensagem = trim($erro->getMessage());
            return $mensagem !== '' ? mb_substr($mensagem, 0, 500) : 'falha ao falar com o provedor';
        }
        Log::excecao($erro, 'adaptador de canal');
        return 'falha ao falar com o provedor (detalhes no log do servidor)';
    }

    /** @return array<string, mixed>|null a linha do canal, com credenciais decodificadas */
    public static function canal(int $id): ?array
    {
        $linha = Banco::um('SELECT * FROM canais WHERE id = ?', [$id]);
        return $linha === null ? null : self::comCredenciais($linha);
    }

    /**
     * @param array<string, mixed> $canal
     * @return array<string, mixed>
     */
    public static function comCredenciais(array $canal): array
    {
        if (!is_array($canal['credenciais'] ?? null)) {
            $canal['credenciais'] = (array) Json::ler(isset($canal['credenciais']) ? (string) $canal['credenciais'] : null, []);
        }
        return $canal;
    }
}

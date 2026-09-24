<?php
declare(strict_types=1);

namespace OmniChannel\Atendimento;

use OmniChannel\Nucleo\Json;

/**
 * Adaptador usado quando a frente de canais não entregou um adaptador para
 * o tipo (ou ainda não está instalada): sabe dizer se o canal tem as
 * credenciais que o provedor exige (as mesmas de campos_obrigatorios do
 * Python) e responde como o AdaptadorCanal.enviar() do Python responderia sem
 * provedor — o webchat entrega dentro do sistema; os outros, sem adaptador
 * real, não têm como sair.
 */
final class AdaptadorSandbox implements AdaptadorDeCanal
{
    /** Credenciais sem as quais o canal não envia (app/canais/*.py). */
    public const CAMPOS_OBRIGATORIOS = [
        'whatsapp' => ['token', 'id_numero'],
        'telegram' => ['token'],
        'email' => ['smtp_host', 'smtp_usuario', 'smtp_senha', 'remetente'],
        'webchat' => [],
    ];

    /** @var array<string, mixed> */
    private array $credenciais;

    /** @param array<string, mixed> $canal linha de `canais` */
    public function __construct(private readonly array $canal)
    {
        $credenciais = $canal['credenciais'] ?? [];
        $this->credenciais = is_array($credenciais) ? $credenciais : (array) Json::ler((string) $credenciais, []);
    }

    public function tipo(): string
    {
        return (string) ($this->canal['tipo'] ?? '');
    }

    public function configurado(): bool
    {
        if ($this->tipo() === 'webchat') {
            return true;
        }
        $campos = self::CAMPOS_OBRIGATORIOS[$this->tipo()] ?? null;
        if ($campos === null) {
            return false;
        }
        foreach ($campos as $campo) {
            $valor = $this->credenciais[$campo] ?? null;
            if ($valor === null || $valor === '' || $valor === false) {
                return false;
            }
        }
        return true;
    }

    public function enviaArquivos(): bool
    {
        // os quatro canais do Python transportam arquivos; no webchat o
        // visitante busca o arquivo pela API
        return array_key_exists($this->tipo(), self::CAMPOS_OBRIGATORIOS);
    }

    public function enviar(string $destino, string $conteudo, array $contexto): ResultadoEnvio
    {
        if ($this->tipo() === 'webchat') {
            // a mensagem já está gravada; o visitante a recebe pelos eventos
            return new ResultadoEnvio(ResultadoEnvio::ENVIADA);
        }
        return ResultadoEnvio::falhou("o canal {$this->tipo()} ainda nao tem adaptador neste servidor");
    }

    public function baixarAnexo(AnexoRecebido $anexo): string
    {
        if ($anexo->dados !== null) {
            return $anexo->dados;
        }
        throw new \RuntimeException("o canal {$this->tipo()} nao sabe baixar anexos");
    }
}

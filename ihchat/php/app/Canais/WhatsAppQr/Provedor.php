<?php
declare(strict_types=1);

namespace IHchat\Canais\WhatsAppQr;

use IHchat\Atendimento\AnexoRecebido;
use IHchat\Atendimento\Anexos;
use IHchat\Atendimento\ArquivoParaEnviar;
use IHchat\Atendimento\MensagemRecebida;
use IHchat\Canais\AdaptadorWhatsAppQr;
use IHchat\Canais\ErroCanal;
use IHchat\Nucleo\Http\Cliente;
use IHchat\Nucleo\Http\ErroTransporte;

/**
 * O que cada provedor do WhatsApp pelo QR Code sabe fazer (ProvedorQR de
 * app/canais/whatsapp_qr.py). Um objeto por requisição.
 */
abstract class Provedor
{
    public const CHAVE = '';
    public const ROTULO = '';
    /** "a Z-API": entra nas frases de erro */
    public const NOME = '';
    /** @var list<string> */
    public const OBRIGATORIOS = [];

    /** @var array<string, mixed> */
    protected readonly array $credenciais;

    public function __construct(protected readonly AdaptadorWhatsAppQr $adaptador)
    {
        $this->credenciais = $adaptador->credenciais;
    }

    protected function credencial(string $chave): string
    {
        $valor = $this->credenciais[$chave] ?? '';
        return is_string($valor) || is_int($valor) || is_float($valor) ? trim((string) $valor) : '';
    }

    /** Token e API key nunca aparecem num erro que vai para a tela. */
    public function semSegredos(string $mensagem): string
    {
        foreach (['instancia_token', 'client_token', 'api_key'] as $chave) {
            $valor = $this->credencial($chave);
            if (strlen($valor) >= 4) {
                $mensagem = str_replace($valor, '<oculto>', $mensagem);
            }
        }
        return $mensagem;
    }

    /**
     * [status, json (array ou null), corpo cru]. Falha de rede vira ErroCanal sem segredo.
     *
     * @param array<string, string> $cabecalhos
     * @param array<string, mixed>|null $query
     * @return array{0: int, 1: mixed, 2: string}
     */
    protected function pedir(string $metodo, string $url, mixed $corpo = null, array $cabecalhos = [], ?array $query = null): array
    {
        $opcoes = ['cabecalhos' => $cabecalhos];
        if ($corpo !== null) {
            $opcoes['json'] = $corpo;
        }
        if ($query !== null) {
            $opcoes['query'] = $query;
        }
        try {
            $resposta = Cliente::pedir($metodo, $url, $opcoes);
        } catch (ErroTransporte $erro) {
            throw new ErroCanal($this->semSegredos('falha de rede com ' . static::NOME . ': ' . $erro->getMessage()));
        }
        return [$resposta->status, $resposta->json(), $resposta->corpo];
    }

    /**
     * Mídia hospedada pelo provedor: GET simples, SEM as credenciais (a URL
     * veio no webhook e não pode receber o token de ninguém). Só endereço
     * público e até o limite de anexos: a URL pode ter sido forjada por quem
     * tem o token do webhook (RedeExterna).
     */
    protected function baixarUrl(string $url): string
    {
        return RedeExterna::baixar($url, Anexos::limiteBytes());
    }

    /**
     * A mensagem traduzida, ou null quando não há nada que valha registrar.
     * $lid: o "@lid" do contato quando a entrega também traz o número.
     *
     * @param list<AnexoRecebido> $anexos
     */
    protected function montar(string $identificador, ?string $idMensagem, ?string $conteudo, array $anexos, ?string $nome, ?string $tipo, ?string $lid = null): ?MensagemRecebida
    {
        if ($conteudo === null || ($conteudo === '' && $anexos === [])) {
            return null;
        }
        $metadados = ['tipo_whatsapp' => $tipo];
        if ($lid !== null && Leitura::eLid($lid) && !Leitura::eLid($identificador)) {
            // o @lid do contato, para o webhook ligá-lo ao número (Rotas::ligarLid)
            $metadados[AdaptadorWhatsAppQr::METADADO_LID] = $lid;
        }
        return new MensagemRecebida(
            identificador: $identificador,
            conteudo: $conteudo,
            nome_exibicao: $nome,
            externo_id: $this->adaptador->idExterno($idMensagem),
            metadados: $metadados,
            anexos: $anexos,
        );
    }

    abstract public function estado(bool $comQr): EstadoConexao;

    abstract public function desconectar(): string;

    abstract public function conectarWebhook(string $url): string;

    abstract public function enviarTexto(string $numero, string $texto): string;

    abstract public function enviarMidia(string $numero, ArquivoParaEnviar $arquivo, string $legenda): string;

    /** @param array<string, mixed> $payload */
    abstract public function analisar(array $payload): Evento;

    abstract public function baixar(AnexoRecebido $anexo): string;
}

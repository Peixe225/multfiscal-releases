<?php
declare(strict_types=1);

namespace OmniChannel\Canais;

use OmniChannel\Atendimento\AdaptadorDeCanal;
use OmniChannel\Atendimento\AnexoRecebido;
use OmniChannel\Atendimento\MensagemRecebida;
use OmniChannel\Atendimento\ResultadoEnvio;
use OmniChannel\Nucleo\Config;
use OmniChannel\Nucleo\Http\Cliente;
use OmniChannel\Nucleo\Http\ErroTransporte;
use OmniChannel\Nucleo\Http\RespostaHttp;

/**
 * Contrato comum a todos os canais (app/canais/base.py).
 *
 * Cada provedor traduz seu formato para MensagemRecebida e sabe enviar uma
 * resposta. O canal chega como a linha do banco com `credenciais` já
 * decodificadas (Canais::tipar ou Atendimento\Adaptadores::comCredenciais).
 *
 * Implementa AdaptadorDeCanal, o recorte que o núcleo do atendimento usa
 * (Atendimento\Mensagens: enviar, baixar anexos); webhook, coleta e teste de
 * conexão são usados só por esta frente (Canais\Rotas e o cron).
 */
abstract class Adaptador implements AdaptadorDeCanal
{
    public const TIPO = '';

    /** @var list<string> */
    public const CAMPOS_OBRIGATORIOS = [];

    /** @var array<string, mixed> */
    public readonly array $credenciais;

    /** @param array<string, mixed> $canal */
    public function __construct(public readonly array $canal)
    {
        $this->credenciais = is_array($canal['credenciais'] ?? null) ? $canal['credenciais'] : [];
    }

    // ------------------------------------------------------------------ estado

    public function tipo(): string
    {
        return static::TIPO;
    }

    /** Tem as credenciais de ENVIO? Sem elas, o envio é só simulado (sandbox). */
    public function configurado(): bool
    {
        foreach (static::CAMPOS_OBRIGATORIOS as $campo) {
            if (!$this->preenchido($campo)) {
                return false;
            }
        }
        return true;
    }

    /** @return list<string> */
    public function faltando(): array
    {
        return array_values(array_filter(static::CAMPOS_OBRIGATORIOS, fn (string $c): bool => !$this->preenchido($c)));
    }

    protected function preenchido(string $campo): bool
    {
        $valor = $this->credenciais[$campo] ?? null;
        return $valor !== null && $valor !== '' && $valor !== false && $valor !== 0;
    }

    protected function credencial(string $campo): string
    {
        $valor = $this->credenciais[$campo] ?? '';
        return is_scalar($valor) ? (string) $valor : '';
    }

    /** Garante unicidade global do id externo entre provedores ("whatsapp:wamid.X"). */
    protected function prefixar(?string $externoId): ?string
    {
        return ($externoId === null || $externoId === '') ? null : static::TIPO . ':' . $externoId;
    }

    /**
     * Id externo que só é único DENTRO do canal ("telegram:5:777001-3").
     *
     * O wamid da Meta é global, mas o message_id do Telegram recomeça em 1 em
     * cada conversa bot-usuário (e o chat.id de um chat privado é o id do
     * usuário), e o Message-ID de um e-mail mandado para duas caixas é o
     * mesmo nas duas. Sem o canal no id, a mensagem ao segundo bot (ou à
     * segunda caixa) morria na deduplicação como se fosse reentrega.
     */
    protected function prefixarNoCanal(?string $externoId): ?string
    {
        if ($externoId === null || $externoId === '') {
            return null;
        }
        $canalId = (int) ($this->canal['id'] ?? 0);
        return $canalId > 0 ? static::TIPO . ":{$canalId}:{$externoId}" : $this->prefixar($externoId);
    }

    // ---------------------------------------------------------------- entrada

    /**
     * Sem segredo cadastrado, não há o que verificar.
     *
     * @param array<string, string> $cabecalhos nomes em minúsculas
     */
    public function verificarAssinatura(string $corpo, array $cabecalhos): bool
    {
        return true;
    }

    /**
     * O canal aceita POST /webhooks/{id}? O webchat não: o widget tem rotas
     * próprias, com sessão, e um webhook aberto só serviria para forjar conversas.
     */
    public function recebeWebhook(): bool
    {
        return true;
    }

    /**
     * Resposta ao handshake GET que alguns provedores exigem (Meta).
     *
     * @param array<string, string> $parametros query string crua ("hub.mode")
     */
    public function desafioVerificacao(array $parametros): ?string
    {
        return null;
    }

    /**
     * @param array<string, mixed> $payload
     * @return list<MensagemRecebida>
     */
    abstract public function analisarWebhook(array $payload): array;

    /**
     * Recibos de entrega/leitura, quando o canal os envia.
     *
     * @param array<string, mixed> $payload
     * @return list<array{externo_id: string, status: string}> (o que Mensagens::aplicarStatusExterno recebe)
     */
    public function analisarStatus(array $payload): array
    {
        return [];
    }

    /**
     * Canais sem webhook (e-mail via IMAP, Telegram em polling) buscam aqui.
     * Quem coleta grava cada mensagem ao recebê-la e chama confirmarColeta()
     * no fim. Pode ser um gerador (o e-mail entrega uma mensagem por vez, e o
     * código depois de cada `yield` só roda quando a anterior já foi gravada).
     *
     * @return iterable<MensagemRecebida>
     */
    public function coletar(): iterable
    {
        return [];
    }

    /** Avisa o provedor de que o último lote foi gravado (marca lido, avança offset). */
    public function confirmarColeta(): void
    {
    }

    /**
     * De onde o canal busca, para dois canais não dividirem a mesma fonte
     * (mesmo bot, mesma caixa). null = não busca ou não disputa com ninguém.
     */
    public function chaveColeta(): ?string
    {
        return null;
    }

    /** Busca no provedor os bytes de um arquivo anunciado no webhook. */
    public function baixarAnexo(AnexoRecebido $anexo): string
    {
        if ($anexo->dados !== null) {
            return $anexo->dados;
        }
        throw new ErroCanal('o canal ' . static::TIPO . ' nao sabe baixar anexos');
    }

    /** Se falso, um anexo na resposta é recusado antes de gravar nada. */
    public function enviaArquivos(): bool
    {
        return false;
    }

    /**
     * Confere, no provedor, se as credenciais funcionam. Devolve uma frase
     * curta para o painel ("Conectado como @bot") ou lança ErroCanal dizendo
     * o que está errado.
     */
    public function verificarConexao(): string
    {
        $faltando = $this->faltando();
        if ($faltando !== []) {
            throw new ErroCanal('preencha: ' . implode(', ', $faltando));
        }
        throw new ErroCanal('o canal ' . static::TIPO . ' nao tem verificacao automatica');
    }

    // ----------------------------------------------------------------- saída

    /**
     * @param array{assunto?: ?string, referencia?: ?string, arquivos?: list<\OmniChannel\Atendimento\ArquivoParaEnviar>, assinatura?: ?array} $contexto
     */
    abstract protected function enviarDeFato(string $destino, string $conteudo, array $contexto): ResultadoEnvio;

    /**
     * Envia de fato, ou apenas registra quando o canal não tem credenciais.
     * O sandbox é o que permite rodar o produto inteiro sem nenhum provedor.
     *
     * @param array<string, mixed> $contexto
     */
    public function enviar(string $destino, string $conteudo, array $contexto = []): ResultadoEnvio
    {
        if (!$this->configurado()) {
            if (self::sandbox()) {
                return new ResultadoEnvio(ResultadoEnvio::SIMULADA);
            }
            return new ResultadoEnvio(
                ResultadoEnvio::FALHOU,
                erro: 'canal ' . ($this->canal['nome'] ?? '') . ' sem credenciais configuradas',
            );
        }
        try {
            return $this->enviarDeFato($destino, $conteudo, $contexto);
        } catch (ErroCanal $erro) {
            return new ResultadoEnvio(ResultadoEnvio::FALHOU, erro: $erro->getMessage());
        }
    }

    // ----------------------------------------------------------------- apoio

    protected static function sandbox(): bool
    {
        try {
            return Config::obter()->modo_sandbox;
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * Chamada HTTP ao provedor; falha de rede vira ErroCanal com o prefixo dado.
     *
     * @param array<string, mixed> $opcoes as do Cliente::pedir
     */
    protected function http(string $metodo, string $url, array $opcoes, string $prefixoErroRede): RespostaHttp
    {
        try {
            return Cliente::pedir($metodo, $url, $opcoes);
        } catch (ErroTransporte $erro) {
            throw new ErroCanal($prefixoErroRede . ': ' . $this->semSegredos($erro->getMessage()));
        }
    }

    /** Tira tokens e senhas de um texto de erro antes de ele ir para a tela. */
    protected function semSegredos(string $texto): string
    {
        foreach ($this->credenciais as $chave => $valor) {
            if (is_string($valor) && strlen($valor) >= 4 && Campos::eSecreta(static::TIPO, (string) $chave)) {
                $texto = str_replace($valor, '<oculto>', $texto);
            }
        }
        return $texto;
    }

    /** Corpo JSON como objeto (array associativo); qualquer outra coisa vira []. @return array<string, mixed> */
    protected static function objetoJson(RespostaHttp $resposta): array
    {
        $dados = $resposta->json();
        return is_array($dados) && !array_is_list($dados) ? $dados : [];
    }

    /** Os primeiros N caracteres do corpo (mensagens de erro), sem quebrar UTF-8. */
    protected static function trecho(string $texto, int $limite): string
    {
        return mb_substr(mb_check_encoding($texto, 'UTF-8') ? $texto : mb_convert_encoding($texto, 'UTF-8', 'ISO-8859-1'), 0, $limite);
    }
}

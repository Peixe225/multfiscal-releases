<?php
declare(strict_types=1);

namespace IHchat\Canais;

use IHchat\Atendimento\AnexoRecebido;
use IHchat\Atendimento\MensagemRecebida;
use IHchat\Atendimento\ResultadoEnvio;
use IHchat\Canais\WhatsAppQr\EstadoConexao;
use IHchat\Canais\WhatsAppQr\Evento;
use IHchat\Canais\WhatsAppQr\Leitura;
use IHchat\Canais\WhatsAppQr\Provedor;
use IHchat\Canais\WhatsAppQr\ProvedorEvolution;
use IHchat\Canais\WhatsAppQr\ProvedorZApi;

/**
 * WhatsApp comum conectado pelo QR Code, com a sessão num provedor online
 * (app/canais/whatsapp_qr.py).
 *
 * O QR Code do WhatsApp (o protocolo do WhatsApp Web) exige uma sessão ligada
 * o tempo todo, e a hospedagem compartilhada não mantém processo nenhum. A
 * sessão fica num PROVEDOR (Z-API, hospedado; ou Evolution API, software
 * livre num servidor próprio) e o IHchat fala com ele por REST e recebe por
 * webhook. Nada é instalado no computador do dono.
 *
 * Não é a API oficial da Meta (essa é o tipo "whatsapp"): o WhatsApp pode
 * bloquear o número que mandar mensagem em massa. Rotas, formatos e links dos
 * provedores: PROVEDORES-WHATSAPP.md, nesta pasta.
 */
final class AdaptadorWhatsAppQr extends Adaptador
{
    public const TIPO = Campos::WHATSAPP_QR;

    public const PROVEDORES = ['zapi', 'evolution'];
    public const PROVEDOR_PADRAO = 'zapi';

    /** Credenciais NÃO secretas que o próprio servidor grava (não são campos do formulário). */
    public const CHAVE_ESTADO = 'estado_conexao';
    public const CHAVE_NUMERO = 'numero_conectado';
    public const CHAVE_WEBHOOK = 'webhook_url';

    /**
     * Dados que valem para UMA instância do provedor. Trocar de instância
     * (outro ID na Z-API, outro servidor ou nome na Evolution, outro
     * provedor) os invalida: a instância nova nasce sem webhook e sem número
     * conectado, e mantê-los fazia o painel dizer "webhook cadastrado"
     * enquanto nenhuma mensagem chegava.
     */
    public const CHAVES_DA_INSTANCIA = [self::CHAVE_ESTADO, self::CHAVE_NUMERO, self::CHAVE_WEBHOOK];

    /**
     * Metadado da mensagem recebida com o "@lid" do contato quando a entrega
     * traz também o número: o webhook liga as duas identidades ao mesmo contato.
     */
    public const METADADO_LID = 'lid_whatsapp';

    /**
     * Recibos chegam fora de ordem (a Evolution dispara cada webhook sem
     * esperar o anterior; a Z-API pode mandar o RECEIVED depois do READ): o
     * recibo só AVANÇA o status. Para cada status novo, os atuais que ele pode
     * substituir. "enviada" não substitui nada (a mensagem já nasce enviada),
     * e "falhou" só vale enquanto ninguém confirmou a entrega.
     */
    public const RECIBO_SUBSTITUI = [
        'entregue' => ['enviada', 'falhou'],
        'lida' => ['enviada', 'entregue', 'falhou'],
        'falhou' => ['enviada'],
    ];

    /**
     * O "autor" de uma resposta que o dono mandou pelo celular: gravado em
     * mensagens.assinatura, que os dois servidores já leem.
     */
    public const ASSINATURA_DO_CELULAR = ['nome' => 'Enviada pelo celular', 'setor' => null];

    /** Preenchidos por verificarConexao, para o "Testar conexão". */
    public ?EstadoConexao $ultimoEstado = null;
    public ?string $alertaDeConexao = null;

    /**
     * Evolution: quem chama pode pedir que uma instância criada agora já nasça
     * com o webhook (a URL com o token do canal). Depois da chamada,
     * $instanciaCriada diz se o provedor criou a instância, e
     * $webhookNaCriacao se ela nasceu com esse webhook: uma instância recriada
     * sem ele não recebe nada, e o webhook gravado deixa de valer.
     */
    public ?string $webhookDaInstancia = null;
    public bool $instanciaCriada = false;
    public bool $webhookNaCriacao = false;

    /** @var array{0: array<string, mixed>, 1: Evento}|null a última entrega traduzida */
    private ?array $traduzido = null;

    // -------------------------------------------------------------- provedor

    public function chaveProvedor(): string
    {
        $valor = $this->credenciais['provedor'] ?? null;
        return is_string($valor) && trim($valor) !== '' ? strtolower(trim($valor)) : self::PROVEDOR_PADRAO;
    }

    /** @throws ErroCanal provedor desconhecido */
    public function provedor(): Provedor
    {
        return match ($this->chaveProvedor()) {
            'zapi' => new ProvedorZApi($this),
            'evolution' => new ProvedorEvolution($this),
            default => throw new ErroCanal('provedor desconhecido: ' . $this->chaveProvedor() . ' (use zapi ou evolution)'),
        };
    }

    public function camposObrigatorios(): array
    {
        return match ($this->chaveProvedor()) {
            'zapi' => ProvedorZApi::OBRIGATORIOS,
            'evolution' => ProvedorEvolution::OBRIGATORIOS,
            default => ['provedor'],
        };
    }

    // --------------------------------------------------------------- entrada

    /**
     * O token do canal vem na URL cadastrada no provedor (?token=), que a rota
     * copia para X-IHchat-Token. Sem segredo no canal, nada passa: sem ele
     * qualquer um que soubesse a URL forjaria mensagens de clientes.
     */
    public function verificarAssinatura(string $corpo, array $cabecalhos): bool
    {
        $segredo = $this->canal['segredo_webhook'] ?? null;
        $recebido = $cabecalhos['x-ihchat-token'] ?? null;
        if (!is_string($segredo) || $segredo === '' || !is_string($recebido) || $recebido === '') {
            return false;
        }
        return hash_equals($segredo, $recebido);
    }

    /**
     * A rota pede entradas, recibos, "do celular" e conexão da MESMA entrega:
     * traduz uma vez só.
     *
     * @param array<string, mixed> $payload
     */
    private function evento(array $payload): Evento
    {
        if ($this->traduzido === null || $this->traduzido[0] !== $payload) {
            try {
                $evento = $this->provedor()->analisar($payload);
            } catch (ErroCanal) {
                $evento = new Evento(); // provedor desconhecido: nada a registrar
            }
            $this->traduzido = [$payload, $evento];
        }
        return $this->traduzido[1];
    }

    public function analisarWebhook(array $payload): array
    {
        return $this->evento($payload)->recebidas;
    }

    public function analisarStatus(array $payload): array
    {
        return $this->evento($payload)->recibos;
    }

    /**
     * Mensagens que o dono mandou pelo próprio celular (fromMe).
     *
     * @param array<string, mixed> $payload
     * @return list<MensagemRecebida>
     */
    public function analisarDoCelular(array $payload): array
    {
        return $this->evento($payload)->doCelular;
    }

    /** @param array<string, mixed> $payload @return array{0: string, 1: ?string}|null */
    public function analisarConexao(array $payload): ?array
    {
        return $this->evento($payload)->conexao;
    }

    public function baixarAnexo(AnexoRecebido $anexo): string
    {
        if ($anexo->dados !== null) {
            return $anexo->dados;
        }
        if ($anexo->referencia === null || $anexo->referencia === '') {
            throw new ErroCanal('anexo sem referência de mídia');
        }
        return $this->provedor()->baixar($anexo);
    }

    /**
     * "whatsapp_qr:<canal>:<id>": o id da mensagem é do WhatsApp, e a mesma
     * mensagem entre dois números conectados chegaria aos dois canais.
     */
    public function idExterno(?string $id): ?string
    {
        return $this->prefixarNoCanal($id);
    }

    // ---------------------------------------------------------------- estado

    /** Estado (e o QR Code, se $comQr) no provedor; erro vira status "erro" com a frase. */
    public function estadoQr(bool $comQr = true): EstadoConexao
    {
        try {
            return $this->provedor()->estado($comQr);
        } catch (ErroCanal $erro) {
            return EstadoConexao::erro($erro->getMessage());
        }
    }

    public function verificarConexao(): string
    {
        if (!$this->configurado()) {
            return parent::verificarConexao();
        }
        $provedor = $this->provedor();
        $estado = $provedor->estado(false);
        $this->ultimoEstado = $estado;
        if ($estado->status === EstadoConexao::ERRO) {
            throw new ErroCanal($estado->mensagem);
        }
        if ($estado->status === EstadoConexao::CONECTADO) {
            return $estado->mensagem . ' (via ' . $provedor::ROTULO . ')';
        }
        // as credenciais funcionam; o que falta é o celular ler o QR Code
        $this->alertaDeConexao = 'o WhatsApp ainda não está conectado: use “Conectar pelo QR Code” e leia o código com o celular';
        return mb_strtoupper(mb_substr($provedor::NOME, 0, 1)) . mb_substr($provedor::NOME, 1) . ' aceitou as credenciais';
    }

    public function desconectar(): string
    {
        return $this->provedor()->desconectar();
    }

    public function conectarWebhook(string $url): string
    {
        return $this->provedor()->conectarWebhook($url);
    }

    /**
     * As credenciais com o estado novo, ou null se nada mudou (sem gravar à
     * toa). O número só fica enquanto está conectado.
     *
     * @param array<string, mixed> $credenciais
     * @return array<string, mixed>|null
     */
    public static function credenciaisComConexao(array $credenciais, string $estado, ?string $numero): ?array
    {
        if (!in_array($estado, [EstadoConexao::CONECTADO, EstadoConexao::AGUARDANDO, EstadoConexao::DESCONECTADO], true)) {
            return null;
        }
        $novas = $credenciais;
        $novas[self::CHAVE_ESTADO] = $estado;
        if ($estado === EstadoConexao::CONECTADO && $numero !== null && $numero !== '') {
            $novas[self::CHAVE_NUMERO] = $numero;
        } elseif ($estado !== EstadoConexao::CONECTADO) {
            unset($novas[self::CHAVE_NUMERO]);
        }
        return $novas === $credenciais ? null : $novas;
    }

    /**
     * O que identifica a instância no provedor (a sessão do WhatsApp).
     *
     * @param array<string, mixed> $credenciais
     * @return list<string>
     */
    public static function identidadeDaInstancia(array $credenciais): array
    {
        $provedor = $credenciais['provedor'] ?? null;
        $provedor = is_string($provedor) && trim($provedor) !== '' ? strtolower(trim($provedor)) : self::PROVEDOR_PADRAO;
        $valor = static function (string $chave) use ($credenciais): string {
            $bruto = $credenciais[$chave] ?? null;
            return is_scalar($bruto) ? trim(is_bool($bruto) ? ($bruto ? 'True' : 'False') : (string) $bruto) : '';
        };
        if ($provedor === 'evolution') {
            return [$provedor, rtrim($valor('url_servidor'), '/'), $valor('nome_instancia')];
        }
        return [$provedor, $valor('instancia_id'), $valor('instancia_token')];
    }

    /**
     * As credenciais novas sem estado, número e webhook quando a instância mudou.
     *
     * @param array<string, mixed> $atuais
     * @param array<string, mixed> $novas
     * @return array<string, mixed>
     */
    public static function semDadosDeOutraInstancia(array $atuais, array $novas): array
    {
        if (self::identidadeDaInstancia($atuais) === self::identidadeDaInstancia($novas)) {
            return $novas;
        }
        foreach (self::CHAVES_DA_INSTANCIA as $chave) {
            unset($novas[$chave]);
        }
        return $novas;
    }

    /** localhost ou IP de loopback: o tráfego não sai do próprio servidor. */
    public static function hostLocal(string $host): bool
    {
        $nome = trim(rtrim(strtolower(trim($host)), '.'), '[]');
        if ($nome === 'localhost' || str_ends_with($nome, '.localhost')) {
            return true;
        }
        if (filter_var($nome, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
            return str_starts_with($nome, '127.');
        }
        if (filter_var($nome, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) !== false) {
            return inet_pton($nome) === inet_pton('::1');
        }
        return false;
    }

    /**
     * Por que o endereço do servidor Evolution não serve (null = serve).
     *
     * A API key (muitas vezes a GLOBAL, que controla todas as instâncias) vai
     * num cabeçalho de cada chamada: por http:// ela passaria sem criptografia
     * pela internet a cada consulta do diálogo, envio e teste. Fora do
     * sandbox, só https://, ou http:// para o próprio servidor (localhost).
     */
    public static function problemaNoEnderecoEvolution(string $endereco): ?string
    {
        $esquema = strtolower((string) parse_url($endereco, PHP_URL_SCHEME));
        $host = (string) parse_url($endereco, PHP_URL_HOST);
        if (!in_array($esquema, ['http', 'https'], true) || $host === '') {
            return 'precisa começar com https://, ex.: https://evolution.suaempresa.com.br';
        }
        if ($esquema === 'http' && !self::hostLocal($host) && !self::sandbox()) {
            return 'precisa usar https://: por http:// a API key iria sem criptografia pela internet '
                . '(http:// só vale para um servidor Evolution nesta mesma máquina, em localhost)';
        }
        return null;
    }

    // ----------------------------------------------------------------- saída

    public function enviaArquivos(): bool
    {
        return true;
    }

    protected function enviarDeFato(string $destino, string $conteudo, array $contexto): ResultadoEnvio
    {
        $provedor = $this->provedor();
        // o texto já chega assinado ("*Ana · Suporte*" na primeira linha) pelo
        // núcleo (Assinaturas::aplicar), como no WhatsApp oficial
        $texto = $conteudo;
        $arquivos = $contexto['arquivos'] ?? [];
        $numero = Leitura::identificadorDoContato($destino) ?? $destino;
        // uma mensagem carrega uma mídia; o texto vira a legenda dela
        $id = $arquivos !== []
            ? $provedor->enviarMidia($numero, $arquivos[0], $texto)
            : $provedor->enviarTexto($numero, $texto);
        return new ResultadoEnvio(ResultadoEnvio::ENVIADA, $this->idExterno($id));
    }
}

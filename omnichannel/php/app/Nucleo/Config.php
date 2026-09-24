<?php
declare(strict_types=1);

namespace OmniChannel\Nucleo;

/**
 * Configuração da aplicação, lida de um arquivo PHP que devolve um array.
 *
 * O arquivo fica FORA do public/ (php/config.php por padrão) porque guarda a
 * senha do banco e a chave que assina os tokens. A variável de ambiente
 * OMNI_CONFIG aponta outro arquivo: é assim que a suíte de contrato e o
 * servidor de desenvolvimento sobem com um SQLite descartável sem tocar no
 * config de produção.
 *
 * Os nomes das propriedades são os mesmos do app Python (app/config.py), em
 * snake_case, para que uma regra portada leia igual nos dois lados.
 */
final class Config
{
    /** Valor de fábrica: aceitar em produção seria assinar tokens com uma chave pública. */
    public const CHAVE_PADRAO = 'troque-esta-chave-em-producao';

    private static ?Config $atual = null;

    public readonly string $nome_aplicacao;
    public readonly string $versao;

    /** 'mysql' ou 'sqlite' */
    public readonly string $driver;
    public readonly string $dsn;
    public readonly ?string $usuario;
    public readonly ?string $senha;

    public readonly string $chave_secreta;
    public readonly int $horas_token;

    public readonly bool $modo_sandbox;
    /** Endereço público sem barra final (https://atendimento.oprojeto.online). */
    public readonly string $url_publica;
    public readonly int $horas_reabertura;
    public readonly bool $distribuicao_automatica;
    public readonly int $tamanho_max_anexo_mb;
    public readonly float $timeout_http;

    /** Pasta gravável fora do public: anexos, logs, travas. */
    public readonly string $pasta_dados;
    /** Pasta do front (painel.html, widget.js...). */
    public readonly string $pasta_web;

    /** @var list<string> origens liberadas para o widget ("*" = qualquer site) */
    public readonly array $origens_permitidas;

    /** Caminho do arquivo lido (útil em mensagens de diagnóstico). */
    public readonly string $arquivo;

    /** @param array<string, mixed> $valores */
    private function __construct(array $valores, string $arquivo)
    {
        $raizPhp = dirname(__DIR__, 2);
        $this->arquivo = $arquivo;
        $this->nome_aplicacao = (string) ($valores['nome_aplicacao'] ?? 'OmniChannel 2');
        $this->versao = (string) ($valores['versao'] ?? '2.0.0');

        $this->driver = strtolower((string) ($valores['driver'] ?? 'sqlite'));
        $this->dsn = (string) ($valores['dsn'] ?? ('sqlite:' . $raizPhp . '/dados/omnichannel.sqlite'));
        $this->usuario = isset($valores['usuario']) ? (string) $valores['usuario'] : null;
        $this->senha = isset($valores['senha']) ? (string) $valores['senha'] : null;

        $this->chave_secreta = (string) ($valores['chave_secreta'] ?? self::CHAVE_PADRAO);
        $this->horas_token = (int) ($valores['horas_token'] ?? 12);

        $this->modo_sandbox = (bool) ($valores['modo_sandbox'] ?? false);
        $this->url_publica = rtrim((string) ($valores['url_publica'] ?? ''), '/');
        $this->horas_reabertura = (int) ($valores['horas_reabertura'] ?? 24);
        $this->distribuicao_automatica = (bool) ($valores['distribuicao_automatica'] ?? true);
        $this->tamanho_max_anexo_mb = (int) ($valores['tamanho_max_anexo_mb'] ?? 20);
        $this->timeout_http = (float) ($valores['timeout_http'] ?? 15.0);

        $this->pasta_dados = rtrim((string) ($valores['pasta_dados'] ?? ($raizPhp . '/dados')), '/');
        $this->pasta_web = rtrim((string) ($valores['pasta_web'] ?? self::pastaWebPadrao($raizPhp)), '/');

        $origens = $valores['origens_permitidas'] ?? ['*'];
        $this->origens_permitidas = array_values(array_map('strval', (array) $origens));
    }

    /**
     * Onde está o front: no pacote de deploy ele é copiado para public/web; em
     * desenvolvimento a fonte única é app/web do projeto Python.
     */
    private static function pastaWebPadrao(string $raizPhp): string
    {
        if (is_dir($raizPhp . '/public/web')) {
            return $raizPhp . '/public/web';
        }
        return dirname($raizPhp) . '/app/web';
    }

    public static function caminhoDoArquivo(): string
    {
        $doAmbiente = getenv('OMNI_CONFIG');
        if (is_string($doAmbiente) && $doAmbiente !== '') {
            return $doAmbiente;
        }
        return dirname(__DIR__, 2) . '/config.php';
    }

    /** A configuração carregada (uma vez por requisição). */
    public static function obter(): Config
    {
        if (self::$atual === null) {
            self::$atual = self::carregar(self::caminhoDoArquivo());
        }
        return self::$atual;
    }

    /** Troca a configuração em uso (testes de unidade). */
    public static function definir(?Config $config): void
    {
        self::$atual = $config;
    }

    /** @param array<string, mixed> $valores */
    public static function deArray(array $valores, string $arquivo = '(memória)'): Config
    {
        $config = new Config($valores, $arquivo);
        $config->conferir();
        return $config;
    }

    public static function carregar(string $arquivo): Config
    {
        if (!is_file($arquivo)) {
            throw new ErroConfiguracao('servidor ainda não instalado: falta o arquivo de configuração');
        }
        $valores = require $arquivo;
        if (!is_array($valores)) {
            throw new ErroConfiguracao('o arquivo de configuração precisa devolver um array');
        }
        return self::deArray($valores, $arquivo);
    }

    /** Recusa configurações perigosas antes de atender qualquer requisição. */
    private function conferir(): void
    {
        if (!in_array($this->driver, ['mysql', 'sqlite'], true)) {
            throw new ErroConfiguracao("driver de banco não suportado: {$this->driver}");
        }
        if (!$this->modo_sandbox) {
            // fora do sandbox o sistema fala com clientes reais: um token
            // assinado com a chave de fábrica seria forjável por qualquer um
            if ($this->chave_secreta === self::CHAVE_PADRAO || strlen($this->chave_secreta) < 32) {
                throw new ErroConfiguracao(
                    'chave_secreta ausente, padrão ou curta demais (mínimo de 32 caracteres) fora do modo sandbox'
                );
            }
        }
    }

    /** Pasta dentro de pasta_dados, criada (e protegida) na primeira vez. */
    public function pasta(string $nome = ''): string
    {
        $raiz = $this->pasta_dados;
        if (!is_dir($raiz)) {
            @mkdir($raiz, 0775, true);
        }
        // proteção extra se a pasta de dados acabar dentro de algo servido
        $trava = $raiz . '/.htaccess';
        if (!is_file($trava)) {
            @file_put_contents($trava, "Require all denied\n");
        }
        if ($nome === '') {
            return $raiz;
        }
        $caminho = $raiz . '/' . trim($nome, '/');
        if (!is_dir($caminho)) {
            @mkdir($caminho, 0775, true);
        }
        return $caminho;
    }

    public function tamanhoMaxAnexoBytes(): int
    {
        return $this->tamanho_max_anexo_mb * 1024 * 1024;
    }
}

<?php
declare(strict_types=1);

namespace OmniChannel\Nucleo;

/**
 * A requisição HTTP, já normalizada.
 *
 * Construída uma vez pelo front controller (doAmbiente) ou à mão nos testes
 * de unidade. As rotas nunca leem $_GET/$_POST/$_SERVER diretamente: tudo
 * passa por aqui, o que mantém o comportamento igual no php -S, no LiteSpeed
 * e nos testes.
 */
final class Requisicao
{
    /** @var array<string, string> cabeçalhos com nome em minúsculas */
    private array $cabecalhos;

    /** Parâmetros de rota ({id}), preenchidos pelo roteador. */
    public array $rota = [];

    private bool $jsonLido = false;
    private mixed $jsonCache = null;

    /** Atendente autenticado (linha do banco), preenchido por Auth. */
    public ?array $atendente = null;

    /**
     * @param array<string, string> $consulta query string (último valor vence, como no FastAPI)
     * @param array<string, string> $cabecalhos
     * @param array<string, mixed> $formulario campos de multipart/urlencoded
     * @param array<string, ArquivoEnviado> $arquivos
     * @param array<string, list<string>> $consultaMultipla todos os valores de cada chave
     */
    public function __construct(
        public readonly string $metodo,
        public readonly string $caminho,
        public readonly array $consulta = [],
        array $cabecalhos = [],
        private readonly string $corpo = '',
        public readonly array $formulario = [],
        public readonly array $arquivos = [],
        public readonly string $ip = '',
        private readonly array $consultaMultipla = [],
    ) {
        $normalizados = [];
        foreach ($cabecalhos as $nome => $valor) {
            $normalizados[strtolower((string) $nome)] = (string) $valor;
        }
        $this->cabecalhos = $normalizados;
    }

    public static function doAmbiente(): self
    {
        $metodo = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        $caminho = (string) (parse_url($uri, PHP_URL_PATH) ?? '/');
        $caminho = rawurldecode($caminho === '' ? '/' : $caminho);
        $queryString = (string) ($_SERVER['QUERY_STRING'] ?? (parse_url($uri, PHP_URL_QUERY) ?? ''));
        [$consulta, $multipla] = self::lerConsulta($queryString);

        $cabecalhos = [];
        foreach ($_SERVER as $chave => $valor) {
            if (str_starts_with((string) $chave, 'HTTP_')) {
                $cabecalhos[str_replace('_', '-', strtolower(substr((string) $chave, 5)))] = (string) $valor;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $cabecalhos['content-type'] = (string) $_SERVER['CONTENT_TYPE'];
        }
        if (isset($_SERVER['CONTENT_LENGTH'])) {
            $cabecalhos['content-length'] = (string) $_SERVER['CONTENT_LENGTH'];
        }
        // Apache/LiteSpeed em CGI escondem o Authorization; o .htaccess o
        // repassa como variável de ambiente
        if (!isset($cabecalhos['authorization'])) {
            foreach (['REDIRECT_HTTP_AUTHORIZATION', 'HTTP_AUTHORIZATION'] as $chave) {
                if (!empty($_SERVER[$chave])) {
                    $cabecalhos['authorization'] = (string) $_SERVER[$chave];
                    break;
                }
            }
        }

        $tipo = strtolower($cabecalhos['content-type'] ?? '');
        $corpo = '';
        $formulario = [];
        $arquivos = [];
        if (str_starts_with($tipo, 'multipart/form-data')) {
            // o PHP já consumiu o corpo; só POST tem $_POST/$_FILES preenchidos
            $formulario = $_POST;
            foreach ($_FILES as $nome => $info) {
                if (is_array($info) && !is_array($info['name'] ?? null)) {
                    $arquivos[(string) $nome] = ArquivoEnviado::doUpload($info);
                }
            }
        } else {
            $corpo = (string) file_get_contents('php://input');
            if (str_starts_with($tipo, 'application/x-www-form-urlencoded')) {
                parse_str($corpo, $formulario);
            }
        }

        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        return new self($metodo, $caminho, $consulta, $cabecalhos, $corpo, $formulario, $arquivos, $ip, $multipla);
    }

    /**
     * Query string lida à mão: o $_GET do PHP troca "." e " " por "_" nos nomes
     * e transforma "a[]" em array, o que o FastAPI não faz.
     *
     * @return array{0: array<string, string>, 1: array<string, list<string>>}
     */
    public static function lerConsulta(string $texto): array
    {
        $ultimo = [];
        $todos = [];
        if ($texto === '') {
            return [$ultimo, $todos];
        }
        foreach (explode('&', $texto) as $par) {
            if ($par === '') {
                continue;
            }
            $partes = explode('=', $par, 2);
            $nome = urldecode($partes[0]);
            $valor = urldecode($partes[1] ?? '');
            $ultimo[$nome] = $valor;
            $todos[$nome][] = $valor;
        }
        return [$ultimo, $todos];
    }

    public function cabecalho(string $nome): ?string
    {
        return $this->cabecalhos[strtolower($nome)] ?? null;
    }

    /** @return array<string, string> */
    public function cabecalhos(): array
    {
        return $this->cabecalhos;
    }

    /** Valor da query string, ou null se ausente. */
    public function consulta(string $nome): ?string
    {
        return $this->consulta[$nome] ?? null;
    }

    /** Todos os valores de um parâmetro repetido (?etiqueta=1&etiqueta=2). @return list<string> */
    public function consultaLista(string $nome): array
    {
        return $this->consultaMultipla[$nome] ?? [];
    }

    /** Parâmetro de rota já convertido ({id:int} chega como int). */
    public function parametro(string $nome): mixed
    {
        return $this->rota[$nome] ?? null;
    }

    /** Corpo cru (para conferir assinatura de webhook byte a byte). */
    public function corpoBruto(): string
    {
        return $this->corpo;
    }

    public function tipoConteudo(): string
    {
        return strtolower(trim(explode(';', $this->cabecalho('content-type') ?? '')[0]));
    }

    /**
     * Corpo JSON decodificado (arrays associativos), ou null se vazio.
     * JSON malformado vira 422 "json_invalid", como no FastAPI.
     */
    public function json(): mixed
    {
        if ($this->jsonLido) {
            return $this->jsonCache;
        }
        $this->jsonLido = true;
        if (trim($this->corpo) === '') {
            return $this->jsonCache = null;
        }
        $tipo = $this->tipoConteudo();
        if ($tipo !== '' && !str_contains($tipo, 'json')) {
            throw ErroValidacao::um('model_attributes_type', ['body'], 'o corpo precisa ser JSON (Content-Type: application/json)');
        }
        try {
            return $this->jsonCache = Json::decodificar($this->corpo);
        } catch (\JsonException $erro) {
            throw ErroValidacao::um('json_invalid', ['body', 0], 'JSON inválido no corpo da requisição', $erro->getMessage());
        }
    }

    /**
     * Corpo JSON que precisa ser um objeto ({...}); ausente vira 422
     * "missing", como um modelo pydantic obrigatório.
     *
     * @return array<string, mixed>
     */
    public function jsonObjeto(bool $obrigatorio = true): array
    {
        $dados = $this->json();
        if ($dados === null) {
            if ($obrigatorio) {
                throw ErroValidacao::um('missing', ['body'], 'corpo da requisição ausente');
            }
            return [];
        }
        if (!is_array($dados) || (array_is_list($dados) && $dados !== [])) {
            throw ErroValidacao::um('model_attributes_type', ['body'], 'o corpo precisa ser um objeto JSON');
        }
        return $dados;
    }

    public function arquivo(string $campo): ?ArquivoEnviado
    {
        return $this->arquivos[$campo] ?? null;
    }

    public function campo(string $nome): ?string
    {
        $valor = $this->formulario[$nome] ?? null;
        return is_scalar($valor) ? (string) $valor : null;
    }

    /** Token "Bearer ..." do cabeçalho Authorization, ou null. */
    public function tokenBearer(): ?string
    {
        $valor = $this->cabecalho('authorization');
        if ($valor === null || strncasecmp($valor, 'bearer ', 7) !== 0) {
            return null;
        }
        $token = trim(substr($valor, 7));
        return $token === '' ? null : $token;
    }

    /** Origem do navegador (CORS do widget). */
    public function origem(): ?string
    {
        return $this->cabecalho('origin');
    }

    public function esquema(): string
    {
        $proto = $this->cabecalho('x-forwarded-proto');
        if ($proto !== null && $proto !== '') {
            return strtolower(explode(',', $proto)[0]) === 'https' ? 'https' : 'http';
        }
        $https = $_SERVER['HTTPS'] ?? '';
        return ($https !== '' && $https !== 'off') ? 'https' : 'http';
    }

    /** https://host sem barra final: url_publica da config ou o host pedido. */
    public function urlBase(): string
    {
        $configurada = '';
        try {
            $configurada = Config::obter()->url_publica;
        } catch (\Throwable) {
        }
        if ($configurada !== '') {
            return $configurada;
        }
        $host = $this->cabecalho('host') ?? 'localhost';
        return $this->esquema() . '://' . $host;
    }
}

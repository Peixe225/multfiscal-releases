<?php
declare(strict_types=1);

namespace IHchat\Nucleo;

/**
 * Validação de entrada reutilizável, no espírito dos modelos pydantic.
 *
 *     $v = Validador::corpo($req);                 // exige objeto JSON
 *     $nome  = $v->texto('nome', min: 2, max: 120);
 *     $email = $v->email('email');
 *     $papel = $v->opcao('papel', ['admin', 'atendente'], padrao: 'atendente');
 *     $ativo = $v->booleano('ativo', obrigatorio: false);
 *     $v->validar();                               // 422 com TODOS os problemas
 *
 * Cada método devolve o valor já convertido (ou o padrão quando ausente) e
 * acumula os problemas; validar() lança um único 422 no formato do FastAPI.
 * Por padrão, campo opcional aceita null (como `str | None = None`); campo
 * obrigatório não. Para PATCH, use tem() para saber se o campo foi enviado.
 *
 * As mensagens vão direto para a tela do painel, por isso são frases em
 * português que já dizem qual é o campo.
 */
final class Validador
{
    /** Domínios de uso especial que o email-validator do Python recusa. */
    private const DOMINIOS_ESPECIAIS = ['arpa', 'invalid', 'local', 'localhost', 'onion', 'test'];

    /** @var list<array{type: string, loc: list<string|int>, msg: string, input?: mixed}> */
    private array $erros = [];

    /** @param array<string, mixed> $dados */
    public function __construct(private readonly array $dados, private readonly string $origem = 'body')
    {
    }

    /** Corpo JSON da requisição; ausente ou não-objeto já é 422. */
    public static function corpo(Requisicao $req, bool $obrigatorio = true): self
    {
        return new self($req->jsonObjeto($obrigatorio), 'body');
    }

    /** Query string (valores sempre chegam como texto e são convertidos). */
    public static function consulta(Requisicao $req): self
    {
        return new self($req->consulta, 'query');
    }

    /** Campos de formulário multipart. */
    public static function formulario(Requisicao $req): self
    {
        return new self($req->formulario, 'body');
    }

    /** O campo veio na entrada (mesmo que null)? */
    public function tem(string $campo): bool
    {
        return array_key_exists($campo, $this->dados);
    }

    /** @return array<string, mixed> os dados crus */
    public function dados(): array
    {
        return $this->dados;
    }

    public function valido(): bool
    {
        return $this->erros === [];
    }

    /** @return list<array<string, mixed>> */
    public function erros(): array
    {
        return $this->erros;
    }

    /** Lança 422 se algum campo falhou. */
    public function validar(): void
    {
        if ($this->erros !== []) {
            throw new ErroValidacao($this->erros);
        }
    }

    /** Registra um problema de regra própria (ex.: "senha e confirmação diferem"). */
    public function falhar(string $campo, string $mensagem, string $tipo = 'value_error'): void
    {
        $this->erro($tipo, $campo, $mensagem, $this->dados[$campo] ?? null);
    }

    // ------------------------------------------------------------------ tipos

    public function texto(
        string $campo,
        int $min = 0,
        ?int $max = null,
        bool $obrigatorio = true,
        ?string $padrao = null,
        ?bool $anulavel = null,
        bool $aparar = false,
        ?string $rotulo = null,
    ): ?string {
        if (!$this->presente($campo, $obrigatorio, $anulavel, $rotulo)) {
            return $this->tem($campo) ? null : $padrao;
        }
        $valor = $this->dados[$campo];
        if (!is_string($valor)) {
            $this->erro('string_type', $campo, $this->nome($campo, $rotulo) . ': precisa ser texto', $valor);
            return null;
        }
        if ($aparar) {
            $valor = trim($valor);
        }
        $tamanho = mb_strlen($valor);
        if ($tamanho < $min) {
            $msg = $min === 1 ? 'não pode ficar vazio' : "precisa ter pelo menos {$min} caracteres";
            $this->erro('string_too_short', $campo, $this->nome($campo, $rotulo) . ': ' . $msg, $valor);
            return null;
        }
        if ($max !== null && $tamanho > $max) {
            $this->erro('string_too_long', $campo, $this->nome($campo, $rotulo) . ": pode ter no máximo {$max} caracteres", $valor);
            return null;
        }
        return $valor;
    }

    /** E-mail validado e normalizado (domínio em minúsculas), como o EmailStr. */
    public function email(
        string $campo,
        bool $obrigatorio = true,
        ?string $padrao = null,
        ?bool $anulavel = null,
        ?string $rotulo = null,
    ): ?string {
        if (!$this->presente($campo, $obrigatorio, $anulavel, $rotulo)) {
            return $this->tem($campo) ? null : $padrao;
        }
        $valor = $this->dados[$campo];
        if (!is_string($valor)) {
            $this->erro('string_type', $campo, $this->nome($campo, $rotulo) . ': precisa ser texto', $valor);
            return null;
        }
        $normalizado = self::normalizarEmail($valor);
        if ($normalizado === null) {
            $this->erro('value_error', $campo, $this->nome($campo, $rotulo) . ': e-mail inválido', $valor);
            return null;
        }
        return $normalizado;
    }

    /**
     * @param list<string> $opcoes
     */
    public function opcao(
        string $campo,
        array $opcoes,
        bool $obrigatorio = true,
        ?string $padrao = null,
        ?bool $anulavel = null,
        ?string $rotulo = null,
    ): ?string {
        if (!$this->presente($campo, $obrigatorio, $anulavel, $rotulo)) {
            return $this->tem($campo) ? null : $padrao;
        }
        $valor = $this->dados[$campo];
        if (!is_string($valor) || !in_array($valor, $opcoes, true)) {
            $this->erro(
                'enum',
                $campo,
                $this->nome($campo, $rotulo) . ': valor inválido; use ' . implode(', ', array_map(static fn ($o) => "'{$o}'", $opcoes)),
                $valor
            );
            return null;
        }
        return $valor;
    }

    public function inteiro(
        string $campo,
        bool $obrigatorio = true,
        ?int $padrao = null,
        ?bool $anulavel = null,
        ?int $minimo = null,
        ?int $maximo = null,
        ?string $rotulo = null,
    ): ?int {
        if (!$this->presente($campo, $obrigatorio, $anulavel, $rotulo)) {
            return $this->tem($campo) ? null : $padrao;
        }
        $valor = $this->dados[$campo];
        $numero = null;
        if (is_int($valor)) {
            $numero = $valor;
        } elseif (is_float($valor) && floor($valor) === $valor && abs($valor) < PHP_INT_MAX) {
            $numero = (int) $valor;
        } elseif (is_string($valor) && preg_match('/^\s*[+-]?\d{1,18}\s*$/', $valor) === 1) {
            $numero = (int) trim($valor);
        }
        if ($numero === null) {
            $this->erro('int_parsing', $campo, $this->nome($campo, $rotulo) . ': precisa ser um número inteiro', $valor);
            return null;
        }
        if ($minimo !== null && $numero < $minimo) {
            $this->erro('greater_than_equal', $campo, $this->nome($campo, $rotulo) . ": precisa ser maior ou igual a {$minimo}", $valor);
            return null;
        }
        if ($maximo !== null && $numero > $maximo) {
            $this->erro('less_than_equal', $campo, $this->nome($campo, $rotulo) . ": precisa ser menor ou igual a {$maximo}", $valor);
            return null;
        }
        return $numero;
    }

    public function booleano(
        string $campo,
        bool $obrigatorio = true,
        ?bool $padrao = null,
        ?bool $anulavel = null,
        ?string $rotulo = null,
    ): ?bool {
        if (!$this->presente($campo, $obrigatorio, $anulavel, $rotulo)) {
            return $this->tem($campo) ? null : $padrao;
        }
        $valor = $this->dados[$campo];
        if (is_bool($valor)) {
            return $valor;
        }
        if ($valor === 0 || $valor === 1) {
            return (bool) $valor;
        }
        if (is_string($valor)) {
            $texto = strtolower(trim($valor));
            if (in_array($texto, ['1', 'true', 't', 'yes', 'y', 'on', 'sim'], true)) {
                return true;
            }
            if (in_array($texto, ['0', 'false', 'f', 'no', 'n', 'off', 'nao', 'não'], true)) {
                return false;
            }
        }
        $this->erro('bool_parsing', $campo, $this->nome($campo, $rotulo) . ': precisa ser verdadeiro ou falso', $valor);
        return null;
    }

    /**
     * Objeto JSON ({...}) como array associativo.
     *
     * @param array<string, mixed>|null $padrao
     * @return array<string, mixed>|null
     */
    public function objeto(
        string $campo,
        bool $obrigatorio = false,
        ?array $padrao = [],
        ?bool $anulavel = null,
        ?string $rotulo = null,
    ): ?array {
        if (!$this->presente($campo, $obrigatorio, $anulavel, $rotulo)) {
            return $this->tem($campo) ? null : $padrao;
        }
        $valor = $this->dados[$campo];
        if (!is_array($valor) || (array_is_list($valor) && $valor !== [])) {
            $this->erro('dict_type', $campo, $this->nome($campo, $rotulo) . ': precisa ser um objeto', $valor);
            return null;
        }
        return $valor;
    }

    /**
     * Lista JSON ([...]). Com $deTexto, cada item precisa ser texto.
     *
     * @param list<mixed>|null $padrao
     * @return list<mixed>|null
     */
    public function lista(
        string $campo,
        bool $obrigatorio = false,
        ?array $padrao = [],
        ?bool $anulavel = null,
        bool $deTexto = false,
        ?string $rotulo = null,
    ): ?array {
        if (!$this->presente($campo, $obrigatorio, $anulavel, $rotulo)) {
            return $this->tem($campo) ? null : $padrao;
        }
        $valor = $this->dados[$campo];
        if (!is_array($valor) || !array_is_list($valor)) {
            $this->erro('list_type', $campo, $this->nome($campo, $rotulo) . ': precisa ser uma lista', $valor);
            return null;
        }
        if ($deTexto) {
            foreach ($valor as $i => $item) {
                if (!is_string($item)) {
                    $this->erros[] = [
                        'type' => 'string_type',
                        'loc' => [$this->origem, $campo, $i],
                        'msg' => $this->nome($campo, $rotulo) . ': todos os itens precisam ser texto',
                        'input' => $item,
                    ];
                    return null;
                }
            }
        }
        return $valor;
    }

    // --------------------------------------------------------------- apoio

    /** E-mail normalizado ou null se inválido (aceita "Nome <a@b.com>"). */
    public static function normalizarEmail(string $valor): ?string
    {
        $valor = trim($valor);
        if (preg_match('/^[^<>]*<([^<>]+)>$/', $valor, $m) === 1) {
            $valor = trim($m[1]);
        }
        if (strlen($valor) > 254 || preg_match('/\s/', $valor) === 1) {
            return null;
        }
        $partes = explode('@', $valor);
        if (count($partes) !== 2) {
            return null;
        }
        [$local, $dominio] = $partes;
        if ($local === '' || strlen($local) > 64 || preg_match('/^[A-Za-z0-9!#$%&\'*+\/=?^_`{|}~.-]+$/u', $local) !== 1
            || str_starts_with($local, '.') || str_ends_with($local, '.') || str_contains($local, '..')) {
            return null;
        }
        $dominio = mb_strtolower($dominio);
        if (!str_contains($dominio, '.')) {
            return null;
        }
        $rotulos = explode('.', $dominio);
        foreach ($rotulos as $rotulo) {
            if ($rotulo === '' || strlen($rotulo) > 63
                || preg_match('/^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u', $rotulo) !== 1) {
                return null;
            }
        }
        if (in_array(end($rotulos), self::DOMINIOS_ESPECIAIS, true)) {
            return null;
        }
        return $local . '@' . $dominio;
    }

    /**
     * Confere presença e nulidade. Devolve true quando há um valor a validar.
     */
    private function presente(string $campo, bool $obrigatorio, ?bool $anulavel, ?string $rotulo): bool
    {
        $anulavel ??= !$obrigatorio;
        if (!array_key_exists($campo, $this->dados)) {
            if ($obrigatorio) {
                $this->erros[] = [
                    'type' => 'missing',
                    'loc' => [$this->origem, $campo],
                    'msg' => $this->nome($campo, $rotulo) . ': campo obrigatório',
                ];
            }
            return false;
        }
        if ($this->dados[$campo] === null) {
            if (!$anulavel) {
                $this->erro('missing', $campo, $this->nome($campo, $rotulo) . ': campo obrigatório', null);
            }
            return false;
        }
        return true;
    }

    private function nome(string $campo, ?string $rotulo): string
    {
        return $rotulo ?? $campo;
    }

    private function erro(string $tipo, string $campo, string $mensagem, mixed $entrada): void
    {
        $erro = ['type' => $tipo, 'loc' => [$this->origem, $campo], 'msg' => $mensagem];
        // senha e segredo nunca voltam na resposta, nem para quem os digitou
        if ($entrada !== null && preg_match('/senha|segredo|secret|token|password/i', $campo) !== 1) {
            $erro['input'] = $entrada;
        }
        $this->erros[] = $erro;
    }
}

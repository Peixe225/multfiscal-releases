<?php
declare(strict_types=1);

namespace IHchat\Nucleo;

/**
 * Roteador com parâmetros de rota, no comportamento do FastAPI/Starlette.
 *
 * Padrões:
 *   /api/canais/tipos                  literal (tem prioridade sobre os com parâmetro)
 *   /api/conversas/{conversa_id:int}   inteiro; "abc" vira 422 (como `conversa_id: int` no FastAPI)
 *   /api/widget/{chave}                qualquer segmento sem "/"
 *   /static/{arquivo:caminho}          o resto do caminho, com "/"
 *
 * Ação: callable que recebe (Requisicao $req, array $parametros) e devolve
 * array|object|null (vira JSON com o status da rota) ou uma Resposta.
 *
 * Caminho conhecido com método errado: 405 com cabeçalho Allow. Caminho
 * desconhecido: 404 {"detail": "Not Found"} — as mesmas frases do Starlette,
 * para o front tratar os dois servidores igual.
 */
final class Roteador
{
    /** @var list<array{metodos: list<string>, padrao: string, regex: string, tipos: array<string, string>, acao: callable, status: int, literal: bool}> */
    private array $rotas = [];

    public function get(string $padrao, callable $acao, int $status = 200): self
    {
        return $this->adicionar(['GET'], $padrao, $acao, $status);
    }

    public function post(string $padrao, callable $acao, int $status = 200): self
    {
        return $this->adicionar(['POST'], $padrao, $acao, $status);
    }

    public function put(string $padrao, callable $acao, int $status = 200): self
    {
        return $this->adicionar(['PUT'], $padrao, $acao, $status);
    }

    public function patch(string $padrao, callable $acao, int $status = 200): self
    {
        return $this->adicionar(['PATCH'], $padrao, $acao, $status);
    }

    public function delete(string $padrao, callable $acao, int $status = 200): self
    {
        return $this->adicionar(['DELETE'], $padrao, $acao, $status);
    }

    /** @param list<string> $metodos */
    public function adicionar(array $metodos, string $padrao, callable $acao, int $status = 200): self
    {
        $tipos = [];
        $regex = preg_replace_callback(
            '#\{([a-zA-Z_][a-zA-Z0-9_]*)(?::(int|caminho|texto))?\}#',
            static function (array $m) use (&$tipos): string {
                $tipo = $m[2] ?? 'texto';
                $tipos[$m[1]] = $tipo === '' ? 'texto' : $tipo;
                return $tipo === 'caminho' ? '(?P<' . $m[1] . '>.+)' : '(?P<' . $m[1] . '>[^/]+)';
            },
            // escapa o literal, preservando os {parametros}
            implode('', array_map(
                static fn (string $parte): string => str_starts_with($parte, '{') ? $parte : preg_quote($parte, '#'),
                preg_split('#(\{[^}]+\})#', $padrao, -1, PREG_SPLIT_DELIM_CAPTURE | PREG_SPLIT_NO_EMPTY) ?: ['/']
            ))
        );
        $this->rotas[] = [
            'metodos' => array_map('strtoupper', $metodos),
            'padrao' => $padrao,
            'regex' => '#^' . $regex . '$#u',
            'tipos' => $tipos,
            'acao' => $acao,
            'status' => $status,
            'literal' => $tipos === [],
        ];
        return $this;
    }

    /** @return list<array{metodos: list<string>, padrao: string}> para diagnóstico e testes */
    public function listar(): array
    {
        return array_map(static fn (array $r): array => ['metodos' => $r['metodos'], 'padrao' => $r['padrao']], $this->rotas);
    }

    public function despachar(Requisicao $req): Resposta
    {
        $metodo = $req->metodo === 'HEAD' ? 'GET' : $req->metodo;
        [$rota, $parametros, $permitidos] = $this->encontrar($req->caminho, $metodo);

        if ($rota === null) {
            if ($permitidos !== []) {
                throw new ErroHttp(405, 'Method Not Allowed', ['Allow' => implode(', ', $permitidos)]);
            }
            $alternativo = $this->caminhoComBarraTrocada($req->caminho, $metodo);
            if ($alternativo !== null) {
                $consulta = $req->consulta === [] ? '' : '?' . http_build_query($req->consulta);
                return Resposta::redirecionar($alternativo . $consulta);
            }
            throw new ErroHttp(404, 'Not Found');
        }

        $req->rota = $this->converter($rota['tipos'], $parametros);
        $resultado = ($rota['acao'])($req, $req->rota);
        if ($resultado instanceof Resposta) {
            return $resultado;
        }
        if ($rota['status'] === 204) {
            return Resposta::vazia();
        }
        return Resposta::json($resultado, $rota['status']);
    }

    /**
     * @return array{0: ?array, 1: array<string, string>, 2: list<string>}
     */
    private function encontrar(string $caminho, string $metodo): array
    {
        $candidatas = [];
        foreach ($this->rotas as $rota) {
            if (preg_match($rota['regex'], $caminho, $m) === 1) {
                $parametros = [];
                foreach ($rota['tipos'] as $nome => $_) {
                    $parametros[$nome] = $m[$nome];
                }
                $candidatas[] = [$rota, $parametros];
            }
        }
        // literais primeiro: /api/canais/tipos não pode cair em /api/canais/{id}
        usort($candidatas, static fn (array $a, array $b): int => (int) $b[0]['literal'] <=> (int) $a[0]['literal']);

        $permitidos = [];
        foreach ($candidatas as [$rota, $parametros]) {
            if (in_array($metodo, $rota['metodos'], true)) {
                return [$rota, $parametros, []];
            }
            array_push($permitidos, ...$rota['metodos']);
        }
        return [null, [], array_values(array_unique($permitidos))];
    }

    /** O Starlette redireciona /api/x/ para /api/x (e vice-versa) quando só um existe. */
    private function caminhoComBarraTrocada(string $caminho, string $metodo): ?string
    {
        if ($caminho === '/') {
            return null;
        }
        $outro = str_ends_with($caminho, '/') ? rtrim($caminho, '/') : $caminho . '/';
        if ($outro === '') {
            return null;
        }
        [$rota] = $this->encontrar($outro, $metodo);
        return $rota !== null ? $outro : null;
    }

    /**
     * @param array<string, string> $tipos
     * @param array<string, string> $parametros
     * @return array<string, int|string>
     */
    private function converter(array $tipos, array $parametros): array
    {
        $convertidos = [];
        $erros = [];
        foreach ($parametros as $nome => $valor) {
            if (($tipos[$nome] ?? 'texto') === 'int') {
                if (preg_match('/^[+-]?\d{1,18}$/', $valor) !== 1) {
                    $erros[] = [
                        'type' => 'int_parsing',
                        'loc' => ['path', $nome],
                        'msg' => 'informe um número inteiro válido',
                        'input' => $valor,
                    ];
                    continue;
                }
                $convertidos[$nome] = (int) $valor;
                continue;
            }
            $convertidos[$nome] = $valor;
        }
        if ($erros !== []) {
            throw new ErroValidacao($erros);
        }
        return $convertidos;
    }
}

<?php
declare(strict_types=1);

namespace IHchat\Nucleo;

/**
 * Resposta HTTP montada pela rota e enviada pelo front controller.
 *
 * A rota pode devolver um array (vira JSON com o status padrão da rota) ou
 * uma Resposta quando precisa de status, cabeçalho ou corpo diferentes.
 */
final class Resposta
{
    /** @var array<string, string> */
    public array $cabecalhos = [];

    /** Arquivo a enviar por streaming em vez de $corpo (downloads grandes). */
    private ?string $arquivo = null;

    /** @param array<string, string> $cabecalhos */
    public function __construct(
        public int $status = 200,
        public string $corpo = '',
        array $cabecalhos = [],
    ) {
        foreach ($cabecalhos as $nome => $valor) {
            $this->cabecalho($nome, $valor);
        }
    }

    /** @param array<string, string> $cabecalhos */
    public static function json(mixed $dados, int $status = 200, array $cabecalhos = []): self
    {
        $resposta = new self($status, Json::codificar($dados), $cabecalhos);
        $resposta->cabecalho('Content-Type', 'application/json');
        return $resposta;
    }

    /** Erro no formato do FastAPI: {"detail": "..."} */
    public static function erro(int $status, string|array $detalhe): self
    {
        return self::json(['detail' => $detalhe], $status);
    }

    public static function vazia(int $status = 204): self
    {
        return new self($status);
    }

    public static function texto(string $texto, int $status = 200, string $tipo = 'text/plain; charset=utf-8'): self
    {
        $resposta = new self($status, $texto);
        $resposta->cabecalho('Content-Type', $tipo);
        return $resposta;
    }

    /** Redirecionamento temporário que preserva o método (307, o padrão do FastAPI). */
    public static function redirecionar(string $destino, int $status = 307): self
    {
        $resposta = new self($status);
        $resposta->cabecalho('Location', $destino);
        return $resposta;
    }

    /**
     * Envia um arquivo do disco.
     *
     * $inline=false força download. Tipos que o navegador executaria (HTML,
     * SVG, XML) vão sempre como download e com CSP "sandbox": um anexo
     * enviado por um cliente nunca pode rodar script na origem do painel.
     * $confiavel=true só para os arquivos do próprio front (Estaticos).
     */
    public static function arquivo(
        string $caminho,
        string $tipo,
        ?string $nomeDownload = null,
        bool $inline = true,
        bool $confiavel = false,
    ): self {
        $resposta = new self(200);
        $resposta->arquivo = $caminho;
        $perigoso = !$confiavel && (bool) preg_match('#(html|xml|svg|javascript|ecmascript)#i', $tipo);
        $resposta->cabecalho('Content-Type', $tipo);
        $resposta->cabecalho('Content-Length', (string) (is_file($caminho) ? filesize($caminho) : 0));
        if ($nomeDownload !== null || $perigoso) {
            $disposicao = ($inline && !$perigoso) ? 'inline' : 'attachment';
            $resposta->cabecalho('Content-Disposition', self::disposicao($disposicao, $nomeDownload ?? basename($caminho)));
        }
        if ($perigoso) {
            $resposta->cabecalho('Content-Security-Policy', 'sandbox');
        }
        return $resposta;
    }

    /** Content-Disposition com nome em UTF-8 (RFC 5987) e fallback ASCII. */
    public static function disposicao(string $tipo, string $nome): string
    {
        $ascii = preg_replace('/[^A-Za-z0-9._ -]/', '_', $nome) ?: 'arquivo';
        return sprintf('%s; filename="%s"; filename*=UTF-8\'\'%s', $tipo, $ascii, rawurlencode($nome));
    }

    public function cabecalho(string $nome, string $valor): self
    {
        // remove variação de caixa já presente para não duplicar
        foreach (array_keys($this->cabecalhos) as $existente) {
            if (strcasecmp($existente, $nome) === 0) {
                unset($this->cabecalhos[$existente]);
            }
        }
        $this->cabecalhos[$nome] = $valor;
        return $this;
    }

    public function temCabecalho(string $nome): bool
    {
        foreach (array_keys($this->cabecalhos) as $existente) {
            if (strcasecmp($existente, $nome) === 0) {
                return true;
            }
        }
        return false;
    }

    public function obterCabecalho(string $nome): ?string
    {
        foreach ($this->cabecalhos as $existente => $valor) {
            if (strcasecmp($existente, $nome) === 0) {
                return $valor;
            }
        }
        return null;
    }

    public function caminhoArquivo(): ?string
    {
        return $this->arquivo;
    }

    /** Corpo como texto (lê o arquivo, se houver) — usado nos testes de unidade. */
    public function conteudo(): string
    {
        return $this->arquivo !== null ? (string) file_get_contents($this->arquivo) : $this->corpo;
    }

    public function enviar(bool $semCorpo = false): void
    {
        if (!headers_sent()) {
            // não anunciar versão do PHP a quem faz varredura de vulnerabilidade
            header_remove('X-Powered-By');
            http_response_code($this->status);
            foreach ($this->cabecalhos as $nome => $valor) {
                header($nome . ': ' . str_replace(["\r", "\n"], '', $valor));
            }
        }
        if ($semCorpo || $this->status === 204 || $this->status === 304) {
            return;
        }
        if ($this->arquivo !== null) {
            readfile($this->arquivo);
            return;
        }
        echo $this->corpo;
    }
}

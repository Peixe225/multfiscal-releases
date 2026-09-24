<?php
declare(strict_types=1);

namespace IHchat\Canais\Email;

use IHchat\Nucleo\Config;

/**
 * Conexão real (stream_socket_client) com SMTP ou IMAP.
 *
 * O TLS SEMPRE confere o certificado e o nome do servidor: sem isso, quem
 * estiver no caminho (Wi-Fi, DNS trocado) recebe a senha no login e o teste
 * ainda responderia "ok". Não usa ext-imap (fora do núcleo desde o PHP 8.4):
 * o protocolo é falado aqui, o que funciona em qualquer hospedagem.
 */
final class Soquete implements Fluxo
{
    /** @var (callable(string, int, bool, float): Fluxo)|null fábrica trocada nos testes */
    private static $fabrica = null;

    /** @param resource $recurso */
    private function __construct(private $recurso, private readonly string $host)
    {
    }

    /** Troca a fábrica de conexões (testes de unidade). null volta à rede. */
    public static function definirFabrica(?callable $fabrica): void
    {
        self::$fabrica = $fabrica;
    }

    /**
     * Abre a conexão; $ssl = TLS desde o início (465, 993).
     *
     * @throws ErroConexao
     */
    public static function abrir(string $host, int $porta, bool $ssl, float $timeout): Fluxo
    {
        if (self::$fabrica !== null) {
            return (self::$fabrica)($host, $porta, $ssl, $timeout);
        }
        $contexto = stream_context_create(['ssl' => self::opcoesTls($host)]);
        $endereco = ($ssl ? 'ssl://' : 'tcp://') . $host . ':' . $porta;
        [$recurso, $avisos] = self::capturar(static fn () => stream_socket_client(
            $endereco,
            $codigo,
            $mensagem,
            $timeout,
            STREAM_CLIENT_CONNECT,
            $contexto,
        ));
        if (!is_resource($recurso)) {
            throw self::erro($avisos, 'não foi possível conectar');
        }
        stream_set_timeout($recurso, (int) max(1, ceil($timeout)));
        return new self($recurso, $host);
    }

    /** @return array<string, mixed> */
    private static function opcoesTls(string $host): array
    {
        $opcoes = [
            'verify_peer' => true,
            'verify_peer_name' => true,
            'peer_name' => $host,
            'allow_self_signed' => false,
            'SNI_enabled' => true,
        ];
        // só nos testes locais (sandbox): uma CA de mentira para o servidor falso
        $ca = getenv('IHCHAT_TESTE_CAFILE');
        if (is_string($ca) && $ca !== '' && self::sandbox()) {
            $opcoes['cafile'] = $ca;
        }
        return $opcoes;
    }

    private static function sandbox(): bool
    {
        try {
            return Config::obter()->modo_sandbox;
        } catch (\Throwable) {
            return false;
        }
    }

    public function lerLinha(): string
    {
        [$linha, $avisos] = self::capturar(fn () => fgets($this->recurso, 65536));
        if ($linha === false) {
            $meta = stream_get_meta_data($this->recurso);
            throw $meta['timed_out'] ?? false
                ? new ErroConexao('o servidor não respondeu a tempo')
                : self::erro($avisos, 'o servidor fechou a conexão');
        }
        return rtrim($linha, "\r\n");
    }

    public function lerBytes(int $tamanho): string
    {
        $dados = '';
        while (strlen($dados) < $tamanho) {
            [$parte, $avisos] = self::capturar(fn () => fread($this->recurso, min(65536, $tamanho - strlen($dados))));
            if ($parte === false || $parte === '') {
                $meta = stream_get_meta_data($this->recurso);
                if (($meta['timed_out'] ?? false) || feof($this->recurso) || $parte === false) {
                    throw self::erro($avisos, 'a conexão caiu no meio da mensagem');
                }
            }
            $dados .= (string) $parte;
        }
        return $dados;
    }

    public function escrever(string $dados): void
    {
        $enviado = 0;
        while ($enviado < strlen($dados)) {
            [$escrito, $avisos] = self::capturar(fn () => fwrite($this->recurso, substr($dados, $enviado)));
            if ($escrito === false || $escrito === 0) {
                throw self::erro($avisos, 'falha ao escrever na conexão');
            }
            $enviado += $escrito;
        }
    }

    public function ativarTls(): void
    {
        foreach (self::opcoesTls($this->host) as $opcao => $valor) {
            stream_context_set_option($this->recurso, 'ssl', $opcao, $valor);
        }
        $metodo = STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | (defined('STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT') ? STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT : 0);
        [$ok, $avisos] = self::capturar(fn () => stream_socket_enable_crypto($this->recurso, true, $metodo));
        if ($ok !== true) {
            throw self::erro($avisos, 'a negociação TLS falhou');
        }
    }

    public function fechar(): void
    {
        if (is_resource($this->recurso)) {
            @fclose($this->recurso);
        }
    }

    public function __destruct()
    {
        $this->fechar();
    }

    /**
     * Roda uma função de stream guardando os avisos do PHP (é neles que vem o
     * motivo: "certificate verify failed", "Connection refused").
     *
     * @return array{0: mixed, 1: list<string>}
     */
    private static function capturar(callable $acao): array
    {
        $avisos = [];
        set_error_handler(static function (int $nivel, string $texto) use (&$avisos): bool {
            $avisos[] = $texto;
            return true;
        });
        try {
            $resultado = $acao();
        } finally {
            restore_error_handler();
        }
        return [$resultado, $avisos];
    }

    /** @param list<string> $avisos */
    private static function erro(array $avisos, string $padrao): ErroConexao
    {
        $texto = trim(implode('; ', array_map(
            static fn (string $a): string => (string) preg_replace('/^stream_socket_\w+\(\): |^fgets\(\): |^fwrite\(\): |^fread\(\): /', '', $a),
            $avisos
        )));
        $certificado = (bool) preg_match('/certificate verify failed|did not match expected CN|peer certificate|self[- ]signed|certificate has expired/i', $texto);
        $motivo = '';
        if ($certificado) {
            $motivo = match (true) {
                (bool) preg_match('/did not match expected CN/i', $texto) => 'o nome no certificado não confere com o endereço',
                (bool) preg_match('/self[- ]signed/i', $texto) => 'certificado autoassinado',
                (bool) preg_match('/expired/i', $texto) => 'certificado expirado',
                default => 'certificate verify failed',
            };
        }
        return new ErroConexao($texto !== '' ? $texto : $padrao, $certificado, $motivo);
    }
}

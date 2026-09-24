<?php
declare(strict_types=1);

namespace OmniChannel\Canais\Email;

/**
 * Cliente SMTP mínimo: conexão (SSL na 465, STARTTLS nas outras), EHLO,
 * AUTH PLAIN/LOGIN e envio de uma mensagem já montada.
 *
 * Cada passo anota a `etapa`, porque cada uma tem um culpado diferente
 * (host/porta errados, porta trocada, senha) e o erro precisa dizer qual foi.
 */
final class Smtp
{
    public string $etapa = '';
    private ?Fluxo $fluxo = null;
    /** @var list<string> extensões anunciadas no EHLO (em maiúsculas) */
    private array $extensoes = [];

    public function __construct(private readonly string $host, private readonly int $porta, private readonly float $timeout)
    {
    }

    public function seguranca(): string
    {
        return $this->porta === 465 ? 'SSL' : 'STARTTLS';
    }

    /**
     * Conecta, cifra e entra. Lança ErroConexao (rede/TLS) ou ErroSmtp (o
     * servidor respondeu com erro), sempre com $this->etapa preenchida.
     */
    public function entrar(string $usuario, string $senha): void
    {
        $this->etapa = "conectar ao servidor SMTP {$this->host}:{$this->porta}";
        $this->fluxo = Soquete::abrir($this->host, $this->porta, $this->porta === 465, $this->timeout);
        $this->esperar([220]);
        $this->ehlo();
        if ($this->porta !== 465) {
            $this->etapa = "iniciar STARTTLS em {$this->host}:{$this->porta}";
            if (!in_array('STARTTLS', $this->extensoes, true)) {
                throw new ErroSmtp(0, 'STARTTLS extension not supported by server.');
            }
            $this->comando('STARTTLS', [220]);
            $this->fluxo->ativarTls();
            $this->ehlo();
        }
        $this->etapa = 'entrar no SMTP';
        $this->autenticar($usuario, $senha);
    }

    /** Manda a mensagem (bytes RFC 5322 com CRLF) para os destinatários. @param list<string> $destinatarios */
    public function enviar(string $remetente, array $destinatarios, string $mensagem): void
    {
        $this->etapa = 'enviar a mensagem';
        $this->comando('MAIL FROM:<' . self::limpar($remetente) . '>', [250]);
        foreach ($destinatarios as $destino) {
            $this->comando('RCPT TO:<' . self::limpar($destino) . '>', [250, 251]);
        }
        $this->comando('DATA', [354]);
        // "dot-stuffing": linha que começa com ponto ganha outro ponto, senão
        // o servidor a entenderia como fim da mensagem
        $corpo = (string) preg_replace('/^\./m', '..', $mensagem);
        if (!str_ends_with($corpo, "\r\n")) {
            $corpo .= "\r\n";
        }
        $this->fluxo?->escrever($corpo . ".\r\n");
        $this->esperar([250]);
    }

    public function sair(): void
    {
        if ($this->fluxo === null) {
            return;
        }
        try {
            $this->fluxo->escrever("QUIT\r\n");
            $this->lerResposta();
        } catch (\Throwable) {
            // já entregue ou já falhou: o QUIT não muda nada
        }
        $this->fluxo->fechar();
        $this->fluxo = null;
    }

    private function ehlo(): void
    {
        $nome = gethostname() ?: 'localhost';
        [, $linhas] = $this->comando('EHLO ' . self::limpar($nome), [250]);
        $this->extensoes = [];
        // a primeira linha é o nome do servidor; não casa com extensão nenhuma
        foreach ($linhas as $linha) {
            $this->extensoes[] = strtoupper(trim(explode(' ', $linha)[0]));
            if (stripos($linha, 'AUTH') === 0) {
                foreach (preg_split('/[\s=]+/', strtoupper($linha)) ?: [] as $mecanismo) {
                    $this->extensoes[] = 'AUTH:' . $mecanismo;
                }
            }
        }
    }

    private function autenticar(string $usuario, string $senha): void
    {
        if (in_array('AUTH:PLAIN', $this->extensoes, true) || !in_array('AUTH:LOGIN', $this->extensoes, true)) {
            $this->comando('AUTH PLAIN ' . base64_encode("\0{$usuario}\0{$senha}"), [235]);
            return;
        }
        $this->comando('AUTH LOGIN', [334]);
        $this->comando(base64_encode($usuario), [334]);
        $this->comando(base64_encode($senha), [235]);
    }

    /**
     * @param list<int> $esperados
     * @return array{0: int, 1: list<string>}
     */
    private function comando(string $linha, array $esperados): array
    {
        if ($this->fluxo === null) {
            throw new ErroConexao('conexão SMTP não aberta');
        }
        $this->fluxo->escrever($linha . "\r\n");
        return $this->esperar($esperados);
    }

    /**
     * @param list<int> $esperados
     * @return array{0: int, 1: list<string>}
     */
    private function esperar(array $esperados): array
    {
        [$codigo, $linhas] = $this->lerResposta();
        if (!in_array($codigo, $esperados, true)) {
            throw new ErroSmtp($codigo, implode(' ', $linhas));
        }
        return [$codigo, $linhas];
    }

    /** Resposta de várias linhas ("250-..." até "250 ..."). @return array{0: int, 1: list<string>} */
    private function lerResposta(): array
    {
        if ($this->fluxo === null) {
            throw new ErroConexao('conexão SMTP não aberta');
        }
        $linhas = [];
        $codigo = 0;
        for ($i = 0; $i < 200; $i++) {
            $linha = $this->fluxo->lerLinha();
            if (preg_match('/^(\d{3})([ -])(.*)$/', $linha, $m) !== 1) {
                throw new ErroConexao("resposta SMTP inesperada: " . mb_substr($linha, 0, 120));
            }
            $codigo = (int) $m[1];
            $linhas[] = $m[3];
            if ($m[2] === ' ') {
                break;
            }
        }
        return [$codigo, $linhas];
    }

    /** Nada de CR/LF dentro de um comando (injeção de comandos SMTP). */
    private static function limpar(string $texto): string
    {
        return str_replace(["\r", "\n", '<', '>'], '', $texto);
    }
}

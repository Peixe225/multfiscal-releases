<?php
declare(strict_types=1);

namespace OmniChannel\Canais\Email;

/**
 * Uma conexão de texto com um servidor de e-mail (SMTP ou IMAP).
 *
 * Existe como interface para os testes de unidade trocarem o servidor por um
 * roteiro (sem rede), do mesmo jeito que o Cliente HTTP troca o transporte.
 * Erros de rede e de TLS lançam ErroConexao.
 */
interface Fluxo
{
    /** Uma linha do servidor, sem o CRLF final. */
    public function lerLinha(): string;

    /** Exatamente $tamanho bytes (literais do IMAP). */
    public function lerBytes(int $tamanho): string;

    public function escrever(string $dados): void;

    /** STARTTLS: passa a conexão aberta para TLS, conferindo o certificado. */
    public function ativarTls(): void;

    public function fechar(): void;
}

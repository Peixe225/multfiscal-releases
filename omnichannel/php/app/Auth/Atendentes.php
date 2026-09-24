<?php
declare(strict_types=1);

namespace OmniChannel\Auth;

use OmniChannel\Banco\Banco;

/**
 * Leitura de atendentes e o formato de saída AtendenteSaida.
 *
 * As linhas vêm do banco como arrays; `tipar()` converte os tipos (o MySQL e
 * o SQLite devolvem inteiros/booleanos de jeitos diferentes). Toda rota que
 * devolve um atendente usa `saida()`: é o que garante que senha_hash nunca
 * sai para o navegador.
 */
final class Atendentes
{
    public const PAPEL_ADMIN = 'admin';
    public const PAPEL_ATENDENTE = 'atendente';
    public const PAPEIS = [self::PAPEL_ADMIN, self::PAPEL_ATENDENTE];

    /** @return array<string, mixed>|null */
    public static function porId(int $id): ?array
    {
        $linha = Banco::um('SELECT * FROM atendentes WHERE id = ?', [$id]);
        return $linha === null ? null : self::tipar($linha);
    }

    /** Busca sem diferenciar maiúsculas (o e-mail do login é só uma chave). @return array<string, mixed>|null */
    public static function porEmail(string $email): ?array
    {
        $linha = Banco::um('SELECT * FROM atendentes WHERE LOWER(email) = ?', [mb_strtolower(trim($email))]);
        return $linha === null ? null : self::tipar($linha);
    }

    /**
     * @param array<string, mixed> $linha
     * @return array<string, mixed>
     */
    public static function tipar(array $linha): array
    {
        $linha['id'] = (int) $linha['id'];
        $linha['ativo'] = (bool) $linha['ativo'];
        $linha['disponivel'] = (bool) $linha['disponivel'];
        $linha['setor'] = isset($linha['setor']) && $linha['setor'] !== '' ? (string) $linha['setor'] : null;
        return $linha;
    }

    /**
     * AtendenteSaida: {id, nome, email, papel, ativo, disponivel, setor}
     *
     * @param array<string, mixed> $atendente
     * @return array<string, mixed>
     */
    public static function saida(array $atendente): array
    {
        return [
            'id' => (int) $atendente['id'],
            'nome' => (string) $atendente['nome'],
            'email' => (string) $atendente['email'],
            'papel' => (string) $atendente['papel'],
            'ativo' => (bool) $atendente['ativo'],
            'disponivel' => (bool) $atendente['disponivel'],
            'setor' => isset($atendente['setor']) && $atendente['setor'] !== '' ? (string) $atendente['setor'] : null,
        ];
    }

    /** @param array<string, mixed> $atendente */
    public static function eAdmin(array $atendente): bool
    {
        return ($atendente['papel'] ?? null) === self::PAPEL_ADMIN;
    }

    /**
     * Assinatura gravada em mensagens.assinatura no momento do envio: o que o
     * cliente vê como "quem me respondeu".
     *
     * @param array<string, mixed> $atendente
     * @return array{nome: string, setor: ?string}
     */
    public static function assinatura(array $atendente): array
    {
        return [
            'nome' => (string) $atendente['nome'],
            'setor' => isset($atendente['setor']) && $atendente['setor'] !== '' ? (string) $atendente['setor'] : null,
        ];
    }
}

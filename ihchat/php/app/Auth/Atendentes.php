<?php
declare(strict_types=1);

namespace IHchat\Auth;

use IHchat\Banco\Banco;

/**
 * Leitura de atendentes e o formato de saída AtendenteSaida.
 *
 * As linhas vêm do banco como arrays; `tipar()` converte os tipos (o MySQL e
 * o SQLite devolvem inteiros/booleanos de jeitos diferentes). Toda rota que
 * devolve um atendente usa `saida()`: é o que garante que senha_hash nunca
 * sai para o navegador.
 *
 * Cargo e setor são cadastros (cargo_id, setor_id). As colunas antigas
 * continuam gravadas para o JSON de sempre: `papel` ("admin" se o cargo é
 * Administrador, senão "atendente") e `setor` (o nome do setor, que também
 * vai na assinatura das mensagens).
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
        $linha['cargo_id'] = isset($linha['cargo_id']) && $linha['cargo_id'] !== '' ? (int) $linha['cargo_id'] : null;
        $linha['setor_id'] = isset($linha['setor_id']) && $linha['setor_id'] !== '' ? (int) $linha['setor_id'] : null;
        return $linha;
    }

    /**
     * AtendenteSaida: {id, nome, email, papel, ativo, disponivel, setor,
     * setor_id, cargo: {id, nome, nivel}, permissoes}. `papel` vem do cargo
     * (o front antigo e o contrato ainda o leem); `permissoes` é a lista
     * efetiva, que o painel usa para esconder o que a pessoa não pode fazer
     * (quem decide de verdade é o servidor, rota a rota).
     *
     * @param array<string, mixed> $atendente
     * @return array<string, mixed>
     */
    public static function saida(array $atendente): array
    {
        $atendente = self::tipar($atendente);
        $cargo = Permissoes::cargoDe($atendente);
        return [
            'id' => $atendente['id'],
            'nome' => (string) $atendente['nome'],
            'email' => (string) $atendente['email'],
            'papel' => Cargos::eAdministrador($cargo) ? self::PAPEL_ADMIN : self::PAPEL_ATENDENTE,
            'ativo' => $atendente['ativo'],
            'disponivel' => $atendente['disponivel'],
            'setor' => $atendente['setor'],
            'setor_id' => $atendente['setor_id'],
            'cargo' => Cargos::resumo($cargo),
            'permissoes' => Permissoes::de($atendente),
        ];
    }

    /** Tem o cargo Administrador? (o cargo decide; o papel é só espelho) @param array<string, mixed> $atendente */
    public static function eAdmin(array $atendente): bool
    {
        return Permissoes::eAdministrador($atendente);
    }

    /** O papel antigo que acompanha o cargo (gravado junto, na coluna papel). @param array<string, mixed> $cargo */
    public static function papelDoCargo(array $cargo): string
    {
        return Cargos::eAdministrador($cargo) ? self::PAPEL_ADMIN : self::PAPEL_ATENDENTE;
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

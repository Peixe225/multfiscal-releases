<?php
declare(strict_types=1);

namespace IHchat\Auth;

use IHchat\Nucleo\ErroHttp;

/**
 * Catálogo fixo de permissões e as perguntas "fulano pode X?".
 *
 * O catálogo mora no código (não no banco): cada permissão é conferida por
 * alguma rota, então só faz sentido existir a que o código conhece. Os cargos
 * guardam listas de chaves deste catálogo; o Administrador tem TODAS, sempre
 * (inclusive as que vierem em versões futuras), calculado aqui e não lido do
 * banco. O mesmo catálogo, na mesma ordem e com os mesmos rótulos, está em
 * app/permissoes.py: GET /api/permissoes sai igual nos dois servidores.
 *
 * Hierarquia: cada cargo tem um nível (Administrador 100; os outros de 1 a 99).
 * Quem gerencia a equipe só mexe em quem tem nível MENOR que o seu e só
 * concede cargo de nível menor que o seu; o Administrador passa por cima das
 * duas regras (ver Equipe\Hierarquia).
 */
final class Permissoes
{
    /** chave => [rótulo, grupo]. A ordem é a da tela (grupos juntos). */
    public const CATALOGO = [
        'equipe.ver' => ['Ver a equipe', 'Equipe'],
        'equipe.gerenciar' => ['Gerenciar pessoas de cargo abaixo do seu (cadastrar, editar, desativar)', 'Equipe'],
        'equipe.definir_cargo' => ['Definir o cargo das pessoas', 'Equipe'],
        'equipe.definir_setor' => ['Definir o setor das pessoas', 'Equipe'],
        'cargos.gerenciar' => ['Criar e editar cargos e permissões', 'Equipe'],
        'setores.gerenciar' => ['Criar, renomear e desativar setores', 'Equipe'],
        'canais.ver' => ['Ver os canais', 'Canais'],
        'canais.gerenciar' => ['Cadastrar e configurar canais', 'Canais'],
        'conversas.ver_todas' => ['Ver todas as conversas', 'Conversas'],
        'conversas.ver_setor' => ['Ver as conversas do próprio setor', 'Conversas'],
        'conversas.transferir' => ['Transferir conversas para outra pessoa ou setor', 'Conversas'],
        'conversas.resolver' => ['Resolver conversas', 'Conversas'],
        'conversas.reabrir' => ['Reabrir conversas resolvidas', 'Conversas'],
        'contatos.editar' => ['Editar a ficha do contato', 'Contatos'],
        'contatos.mesclar' => ['Mesclar contatos', 'Contatos'],
        'respostas.gerenciar' => ['Criar e apagar respostas rápidas', 'Catálogo'],
        'etiquetas.gerenciar' => ['Criar e apagar etiquetas', 'Catálogo'],
        'metricas.ver_todas' => ['Ver as métricas de todo o atendimento', 'Métricas'],
        'metricas.ver_setor' => ['Ver as métricas do próprio setor', 'Métricas'],
        'chat.criar_grupo' => ['Criar grupos no chat da equipe', 'Chat da equipe'],
        'chat.moderar' => ['Moderar o chat da equipe (apagar mensagem de outros)', 'Chat da equipe'],
        'simulador.usar' => ['Usar o simulador de clientes', 'Ferramentas'],
    ];

    public const NIVEL_ADMINISTRADOR = 100;
    public const NIVEL_MAXIMO_OUTROS = 99;

    /** @return list<string> todas as chaves, na ordem do catálogo */
    public static function todas(): array
    {
        return array_keys(self::CATALOGO);
    }

    public static function existe(string $chave): bool
    {
        return isset(self::CATALOGO[$chave]);
    }

    /** @return list<array{chave: string, rotulo: string, grupo: string}> GET /api/permissoes */
    public static function catalogo(): array
    {
        $saida = [];
        foreach (self::CATALOGO as $chave => [$rotulo, $grupo]) {
            $saida[] = ['chave' => $chave, 'rotulo' => $rotulo, 'grupo' => $grupo];
        }
        return $saida;
    }

    /**
     * Só as chaves do catálogo, sem repetição, na ordem do catálogo (a ordem
     * em que vieram não importa; a saída fica estável).
     *
     * @param iterable<mixed> $chaves
     * @return list<string>
     */
    public static function ordenar(iterable $chaves): array
    {
        $tem = [];
        foreach ($chaves as $chave) {
            if (is_string($chave) && self::existe($chave)) {
                $tem[$chave] = true;
            }
        }
        return array_values(array_filter(self::todas(), static fn (string $c): bool => isset($tem[$c])));
    }

    // ------------------------------------------------------ de um atendente

    /**
     * O cargo efetivo do atendente. Sem cargo_id (linha gravada por código
     * antigo), vale o papel: admin é Administrador, o resto é Colaborador —
     * a mesma regra da migração. Assim ninguém fica sem cargo nem ganha mais
     * do que tinha.
     *
     * @param array<string, mixed> $atendente
     * @return array<string, mixed> linha tipada de Cargos
     */
    public static function cargoDe(array $atendente): array
    {
        $id = $atendente['cargo_id'] ?? null;
        $cargo = $id !== null && $id !== '' ? Cargos::porId((int) $id) : null;
        if ($cargo === null) {
            $chave = ($atendente['papel'] ?? null) === Atendentes::PAPEL_ADMIN ? Cargos::ADMINISTRADOR : Cargos::COLABORADOR;
            $cargo = Cargos::porChave($chave) ?? Cargos::vazio($chave);
        }
        return $cargo;
    }

    /**
     * Permissões efetivas (lista na ordem do catálogo). Atendente inativo não
     * tem nenhuma: nem chega a passar pelo login, mas a regra fica explícita.
     *
     * @param array<string, mixed> $atendente
     * @return list<string>
     */
    public static function de(array $atendente): array
    {
        if (array_key_exists('ativo', $atendente) && !$atendente['ativo']) {
            return [];
        }
        return self::cargoDe($atendente)['permissoes'];
    }

    /** @param array<string, mixed> $atendente */
    public static function tem(array $atendente, string $permissao): bool
    {
        return in_array($permissao, self::de($atendente), true);
    }

    /** @param array<string, mixed> $atendente */
    public static function nivel(array $atendente): int
    {
        return (int) self::cargoDe($atendente)['nivel'];
    }

    /** @param array<string, mixed> $atendente */
    public static function eAdministrador(array $atendente): bool
    {
        return self::cargoDe($atendente)['chave'] === Cargos::ADMINISTRADOR;
    }

    /** "sem permissão para ver os canais": a frase vem do rótulo do catálogo. */
    public static function mensagem(string $permissao): string
    {
        $rotulo = self::CATALOGO[$permissao][0] ?? $permissao;
        return 'sem permissão para ' . mb_strtolower(mb_substr($rotulo, 0, 1)) . mb_substr($rotulo, 1);
    }

    /**
     * 403 se o atendente não tiver a permissão.
     *
     * @param array<string, mixed> $atendente
     */
    public static function exigir(array $atendente, string $permissao): void
    {
        if (!self::tem($atendente, $permissao)) {
            throw ErroHttp::proibido(self::mensagem($permissao));
        }
    }
}

<?php
declare(strict_types=1);

namespace IHchat\Equipe;

use IHchat\Atendimento\Concorrencia;
use IHchat\Auth\Atendentes;
use IHchat\Auth\Cargos;
use IHchat\Auth\Permissoes;
use IHchat\Banco\Banco;
use IHchat\Nucleo\ErroHttp;

/**
 * As regras de hierarquia, conferidas no servidor (as mesmas de
 * app/servicos/hierarquia.py). O painel esconde o que a pessoa não pode, mas
 * quem decide é daqui:
 *
 *  - ninguém gerencia quem tem nível igual ou maior que o seu, e ninguém
 *    concede cargo de nível igual ou maior que o seu (o Administrador passa
 *    por cima das duas);
 *  - quem não pode definir setor só gerencia gente do PRÓPRIO setor (é o
 *    líder de uma equipe: cadastra no setor dele e cuida de quem está nele);
 *  - ninguém cria ou edita cargo com permissão que ele próprio não tem, nem
 *    mexe em cargo de nível igual ou maior que o seu; o cargo Administrador
 *    não se edita (tem tudo, sempre);
 *  - sempre sobra pelo menos um Administrador ativo;
 *  - no próprio perfil, cada um só troca a senha e a disponibilidade: nome,
 *    setor e cargo são de quem gerencia (antes o próprio atendente trocava o
 *    setor e passava a ver a sala de outro setor no chat).
 */
final class Hierarquia
{
    public const SO_ABAIXO = 'você só gerencia pessoas de cargo abaixo do seu';
    public const CONCEDER_ABAIXO = 'você só pode conceder cargos abaixo do seu';
    public const SO_SEU_SETOR = 'você só gerencia pessoas do seu setor';
    public const PROPRIO_PERFIL = 'no próprio perfil você só altera a senha e a disponibilidade';
    public const ULTIMO_ADMIN = 'é preciso manter pelo menos um Administrador ativo';
    public const CARGO_ADMIN_TRAVADO = 'o cargo Administrador não pode ser alterado';
    public const CARGO_ACIMA = 'você só gerencia cargos abaixo do seu';
    public const CARGO_DE_FABRICA = 'cargo de fábrica não pode ser apagado';
    public const PERMISSAO_QUE_NAO_TEM = 'você não pode dar a um cargo permissões que você não tem';

    /**
     * $eu pode editar/desativar $alvo (outra pessoa)?
     *
     * @param array<string, mixed> $eu
     * @param array<string, mixed> $alvo
     */
    public static function exigirGerenciar(array $eu, array $alvo): void
    {
        Permissoes::exigir($eu, 'equipe.gerenciar');
        if (Permissoes::eAdministrador($eu)) {
            return;
        }
        if (Permissoes::nivel($alvo) >= Permissoes::nivel($eu)) {
            throw ErroHttp::proibido(self::SO_ABAIXO);
        }
        if (!Permissoes::tem($eu, 'equipe.definir_setor') && ($alvo['setor_id'] ?? null) !== ($eu['setor_id'] ?? null)) {
            throw ErroHttp::proibido(self::SO_SEU_SETOR);
        }
    }

    /**
     * $eu pode dar o $cargo a alguém?
     *
     * @param array<string, mixed> $eu
     * @param array<string, mixed> $cargo
     */
    public static function exigirConceder(array $eu, array $cargo): void
    {
        Permissoes::exigir($eu, 'equipe.definir_cargo');
        if (!Permissoes::eAdministrador($eu) && (int) $cargo['nivel'] >= Permissoes::nivel($eu)) {
            throw ErroHttp::proibido(self::CONCEDER_ABAIXO);
        }
    }

    /**
     * A pessoa com o cargo padrão (Colaborador) cabe abaixo de quem cadastra?
     * Quem não define cargo só cadastra com o padrão, e mesmo assim o nível
     * dele precisa ficar abaixo do seu.
     *
     * @param array<string, mixed> $eu
     * @param array<string, mixed> $cargo
     */
    public static function exigirNivelAbaixo(array $eu, array $cargo): void
    {
        if (!Permissoes::eAdministrador($eu) && (int) $cargo['nivel'] >= Permissoes::nivel($eu)) {
            throw ErroHttp::proibido(self::CONCEDER_ABAIXO);
        }
    }

    /**
     * Antes de desativar ou tirar o cargo de um Administrador ativo: sobra
     * outro? Chame dentro de uma transação (Concorrencia::transacao): no MySQL
     * as linhas dos administradores ficam travadas até o fim dela, e duas
     * pessoas rebaixando uma à outra ao mesmo tempo não deixam o sistema sem
     * ninguém (a segunda espera a primeira e já vê o resultado).
     */
    public static function exigirOutroAdministrador(int $alvoId): void
    {
        $admin = Cargos::porChave(Cargos::ADMINISTRADOR);
        $outros = Banco::todos(
            'SELECT id FROM atendentes WHERE ativo = 1 AND id <> ? AND (cargo_id = ? OR (cargo_id IS NULL AND papel = ?))'
            . Concorrencia::travando(),
            [$alvoId, $admin['id'] ?? 0, Atendentes::PAPEL_ADMIN]
        );
        if ($outros === []) {
            throw ErroHttp::proibido(self::ULTIMO_ADMIN);
        }
    }

    // ------------------------------------------------------------------ cargos

    /**
     * $eu pode editar/apagar o $cargo?
     *
     * @param array<string, mixed> $eu
     * @param array<string, mixed> $cargo
     */
    public static function exigirGerenciarCargo(array $eu, array $cargo): void
    {
        Permissoes::exigir($eu, 'cargos.gerenciar');
        if (Cargos::eAdministrador($cargo)) {
            throw ErroHttp::proibido(self::CARGO_ADMIN_TRAVADO);
        }
        self::exigirNivelDeCargo($eu, (int) $cargo['nivel']);
    }

    /** O nível (novo ou atual) de um cargo precisa ficar abaixo do de quem mexe. @param array<string, mixed> $eu */
    public static function exigirNivelDeCargo(array $eu, int $nivel): void
    {
        if (!Permissoes::eAdministrador($eu) && $nivel >= Permissoes::nivel($eu)) {
            throw ErroHttp::proibido(self::CARGO_ACIMA);
        }
    }

    /**
     * Ninguém entrega a um cargo o que não tem (senão criaria um cargo mais
     * poderoso que o próprio e o daria a alguém de confiança).
     *
     * @param array<string, mixed> $eu
     * @param list<string> $permissoes as que o cargo vai ganhar
     */
    public static function exigirPermissoesQueTem(array $eu, array $permissoes): void
    {
        if (Permissoes::eAdministrador($eu)) {
            return;
        }
        $faltam = array_values(array_diff($permissoes, Permissoes::de($eu)));
        if ($faltam !== []) {
            throw ErroHttp::proibido(self::PERMISSAO_QUE_NAO_TEM . ': ' . implode(', ', $faltam));
        }
    }
}

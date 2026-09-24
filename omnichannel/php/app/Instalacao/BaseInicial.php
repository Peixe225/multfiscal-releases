<?php
declare(strict_types=1);

namespace OmniChannel\Instalacao;

use OmniChannel\Auth\Atendentes;
use OmniChannel\Auth\Senhas;
use OmniChannel\Banco\Banco;
use OmniChannel\Banco\Esquema;
use OmniChannel\Nucleo\Datas;
use OmniChannel\Nucleo\ErroHttp;
use OmniChannel\Nucleo\Json;
use OmniChannel\Nucleo\Texto;

/**
 * O que a instalação grava no banco novo.
 *
 * Por padrão, só o essencial para um sistema de verdade: o administrador
 * informado no formulário e um canal "Chat do site" (o webchat não precisa de
 * credencial nenhuma, então o widget funciona no minuto seguinte). Nada de
 * usuário de demonstração: o Seed cria a Ana com a senha "ana12345", que é
 * pública no repositório — em produção isso seria uma porta aberta.
 *
 * Com "carregar exemplos", usa o Seed completo (Ana, os quatro canais,
 * etiquetas, respostas rápidas e conversas de exemplo) e troca o admin de
 * fábrica pelo informado. Serve para conhecer o sistema, mas é a MESMA base
 * que vai atender clientes: a Ana dos exemplos fica desativada e com uma
 * senha aleatória que ninguém conhece (a do Seed, "ana12345", é pública). As
 * conversas continuam atribuídas a ela para a demonstração; quem quiser usar
 * a Ana a reativa e define a senha pelo administrador. Pelo mesmo motivo, os
 * canais de exemplo que recebem webhook (WhatsApp, Telegram, e-mail) ficam
 * desativados: sem credencial, o WhatsApp aceitaria webhook forjado.
 *
 * Antes de qualquer DDL, confere que o banco é nosso: sem tabela nenhuma, ou
 * só com tabelas do OmniChannel (instalação anterior). Escolher por engano o
 * banco de outro sistema do domínio não pode enfiar tabelas nossas nele — no
 * MySQL cada CREATE faz commit sozinho, não haveria como desfazer.
 */
final class BaseInicial
{
    public const NOME_CANAL_WEBCHAT = 'Chat do site';

    /**
     * @return array{chave_webchat: ?string, exemplos: bool}
     */
    public static function criar(
        string $nome,
        string $email,
        #[\SensitiveParameter] string $senha,
        bool $exemplos,
    ): array {
        self::conferirBancoDoSistema();
        Esquema::aplicar();
        if ((int) Banco::valor('SELECT COUNT(*) FROM atendentes') > 0) {
            throw ErroHttp::conflito(
                'o banco informado já tem atendentes cadastrados; use um banco vazio '
                . '(ou restaure o config.php da instalação anterior)'
            );
        }
        if ($exemplos) {
            return self::comExemplos($nome, $email, $senha);
        }

        return Banco::transacao(static function () use ($nome, $email, $senha): array {
            $agora = Datas::agoraBanco();
            Banco::inserir('atendentes', [
                'nome' => $nome, 'email' => $email, 'senha_hash' => Senhas::gerarHash($senha),
                'papel' => Atendentes::PAPEL_ADMIN, 'ativo' => true, 'disponivel' => true, 'setor' => null,
                'criado_em' => $agora,
            ]);
            // mesma regra do cadastro pela API: webchat tem chave pública, sem segredo
            $chave = Texto::gerarChave('wc_');
            Banco::inserir('canais', [
                'nome' => self::NOME_CANAL_WEBCHAT, 'tipo' => 'webchat', 'ativo' => true,
                'credenciais' => Json::objeto([]), 'chave_publica' => $chave, 'segredo_webhook' => null,
                'criado_em' => $agora,
            ]);
            return ['chave_webchat' => $chave, 'exemplos' => false];
        });
    }

    /** @return array{chave_webchat: ?string, exemplos: bool} */
    private static function comExemplos(string $nome, string $email, #[\SensitiveParameter] string $senha): array
    {
        if ($email === Seed::EMAIL_ATENDENTE) {
            throw ErroHttp::conflito('com exemplos, o e-mail ' . Seed::EMAIL_ATENDENTE . ' já pertence à atendente de demonstração');
        }
        // fora de transação nossa: o Seed confere o esquema (DDL), e no MySQL
        // DDL encerra a transação aberta calado — o commit depois falharia
        $resultado = Seed::semear(true, $senha);
        // o Seed cria o admin de fábrica; ele passa a ser quem instalou
        Banco::executar(
            'UPDATE atendentes SET nome = ?, email = ? WHERE email = ?',
            [$nome, $email, Seed::EMAIL_ADMIN]
        );
        // a senha do Seed é pública; ativa, a Ana também receberia clientes
        // reais pela distribuição automática sem ninguém para atendê-los
        Banco::executar(
            'UPDATE atendentes SET senha_hash = ?, ativo = ?, disponivel = ? WHERE email = ?',
            [Senhas::gerarHash(bin2hex(random_bytes(32))), 0, 0, Seed::EMAIL_ATENDENTE]
        );
        // os canais de exemplo nascem sem credencial; o WhatsApp sem App Secret
        // aceita QUALQUER POST em /webhooks/<id> (id previsível) e deixaria um
        // estranho injetar "clientes" falsos na base de produção. Ficam
        // desativados até o dono pôr as credenciais e ativá-los pelo painel;
        // só o chat do site, que não recebe webhook, continua no ar
        Banco::executar('UPDATE canais SET ativo = ? WHERE tipo <> ?', [0, 'webchat']);
        return ['chave_webchat' => $resultado['chave_webchat'], 'exemplos' => true];
    }

    /**
     * Recusa (409) um banco com tabelas que não são do OmniChannel.
     *
     * Um banco é "nosso" se não tem tabela nenhuma ou se tem a tabela de
     * migrações do OmniChannel e nada fora da lista de tabelas que as nossas
     * migrações criam. Sem a tabela de migrações, qualquer tabela é estranha,
     * mesmo com nome igual a uma nossa ("contatos" de um ERP não é a nossa).
     */
    public static function conferirBancoDoSistema(): void
    {
        $tabelas = self::tabelasDoBanco();
        if ($tabelas === []) {
            return;
        }
        $estranhas = self::temNossaTabelaDeMigracoes($tabelas)
            ? array_values(array_diff($tabelas, self::tabelasDoSistema()))
            : $tabelas;
        if ($estranhas === []) {
            return;
        }
        $n = count($estranhas);
        throw ErroHttp::conflito(sprintf(
            'o banco informado não está vazio (tem %d %s de outro sistema); crie um banco novo no hPanel',
            $n,
            $n === 1 ? 'tabela' : 'tabelas',
        ));
    }

    /** @return list<string> tabelas e visões do banco conectado (sem as internas do SQLite) */
    private static function tabelasDoBanco(): array
    {
        if (Banco::driver() === 'mysql') {
            $sql = 'SELECT table_name AS nome FROM information_schema.tables WHERE table_schema = DATABASE()';
        } else {
            $sql = "SELECT name AS nome FROM sqlite_master WHERE type IN ('table', 'view') AND substr(name, 1, 7) <> 'sqlite_'";
        }
        return array_values(array_map(static fn (array $l): string => (string) $l['nome'], Banco::todos($sql)));
    }

    /**
     * A tabela "migracoes" existe, tem as nossas colunas e só registra
     * migrações no nosso formato de nome (M<AAAAMMDD>_<HHMM>_<Descricao>).
     * Uma vazia também vale: é a sobra de uma instalação que falhou no meio.
     *
     * @param list<string> $tabelas
     */
    private static function temNossaTabelaDeMigracoes(array $tabelas): bool
    {
        if (!in_array('migracoes', $tabelas, true)) {
            return false;
        }
        try {
            $linhas = Banco::todos('SELECT nome, descricao, aplicada_em FROM migracoes');
        } catch (\PDOException) {
            return false; // "migracoes" de outro sistema, com outras colunas
        }
        foreach ($linhas as $linha) {
            if (preg_match('/^M\d{8}_\d{4}_\w+$/', (string) $linha['nome']) !== 1) {
                return false;
            }
        }
        return true;
    }

    /**
     * Tabelas que as migrações do OmniChannel criam, lidas das próprias
     * migrações (convenção: `$e->criarTabela('nome', ...)`), mais a de controle.
     *
     * @return list<string>
     */
    public static function tabelasDoSistema(): array
    {
        $pasta = dirname((string) (new \ReflectionClass(Esquema::class))->getFileName()) . '/Migracoes';
        $nomes = ['migracoes'];
        foreach (glob($pasta . '/M*.php') ?: [] as $arquivo) {
            preg_match_all("/criarTabela\(\s*'([A-Za-z0-9_]+)'/", (string) file_get_contents($arquivo), $achados);
            array_push($nomes, ...$achados[1]);
        }
        return array_values(array_unique($nomes));
    }
}

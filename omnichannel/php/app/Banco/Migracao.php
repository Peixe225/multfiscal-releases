<?php
declare(strict_types=1);

namespace OmniChannel\Banco;

/**
 * Um passo de evolução do banco.
 *
 * Cada migração é um arquivo em app/Banco/Migracoes/ chamado
 * M<AAAAMMDD>_<HHMM>_<Descricao>.php, com a classe de mesmo nome. Elas rodam
 * em ordem alfabética (logo, cronológica) e cada uma só uma vez: o nome fica
 * gravado na tabela `migracoes`. Nunca edite uma migração já publicada; crie
 * outra. Escreva-as idempotentes (os ajudantes de Esquema conferem se a
 * tabela, coluna ou índice já existe), porque no MySQL cada DDL confirma a
 * transação sozinho e uma falha no meio deixa metade aplicada.
 */
interface Migracao
{
    public function descricao(): string;

    public function aplicar(Esquema $esquema): void;
}

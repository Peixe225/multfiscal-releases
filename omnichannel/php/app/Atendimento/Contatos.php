<?php
declare(strict_types=1);

namespace OmniChannel\Atendimento;

use OmniChannel\Banco\Banco;
use OmniChannel\Nucleo\Datas;
use OmniChannel\Nucleo\Texto;

/**
 * Identidade unificada do contato entre canais (app/servicos/contatos.py).
 *
 * Um contato pode falar por vários canais: a identidade externa (número de
 * WhatsApp, chat_id do Telegram, e-mail) fica em contato_identidades, e não
 * no contato. Assim o histórico do cliente continua único quando ele troca
 * de canal.
 */
final class Contatos
{
    /** Canais cujo identificador já é um dado de contato conhecido. */
    public const CANAIS_TELEFONE = ['whatsapp'];
    public const CANAIS_EMAIL = ['email'];

    /** @return array<string, mixed>|null a linha do contato */
    public static function porId(int $id): ?array
    {
        return Banco::um('SELECT * FROM contatos WHERE id = ?', [$id]);
    }

    /** Como a identidade é gravada: WhatsApp só com dígitos, e-mail em minúsculas. */
    public static function normalizarIdentificador(string $canalTipo, string $identificador): string
    {
        $identificador = trim($identificador);
        if (in_array($canalTipo, self::CANAIS_TELEFONE, true)) {
            return Texto::normalizarTelefone($identificador);
        }
        if (in_array($canalTipo, self::CANAIS_EMAIL, true)) {
            return mb_strtolower($identificador);
        }
        return $identificador;
    }

    /**
     * O contato dono daquela identidade, criando-o na primeira vez.
     *
     * Ordem: identidade já conhecida → contato com o mesmo telefone (WhatsApp)
     * ou e-mail (e-mail) → contato novo. Devolve o id.
     */
    public static function resolver(string $canalTipo, string $identificador, ?string $nomeExibicao = null): int
    {
        return Concorrencia::transacao(static function () use ($canalTipo, $identificador, $nomeExibicao): int {
            $identificador = self::normalizarIdentificador($canalTipo, $identificador);
            $nomeExibicao = $nomeExibicao === null || trim($nomeExibicao) === '' ? null : mb_substr(trim($nomeExibicao), 0, 160);

            $existente = self::porIdentidade($canalTipo, $identificador);
            if ($existente !== null) {
                if ($nomeExibicao !== null && (string) $existente['nome'] === $identificador) {
                    // antes só tínhamos o número/endereço
                    Banco::atualizar('contatos', ['nome' => $nomeExibicao, 'atualizado_em' => Datas::agoraBanco()], 'id = ?', [$existente['id']]);
                }
                return (int) $existente['id'];
            }

            $contatoId = self::porDadoConhecido($canalTipo, $identificador);
            $criado = false;
            if ($contatoId === null) {
                $agora = Datas::agoraBanco();
                $contatoId = Banco::inserir('contatos', [
                    'nome' => mb_substr($nomeExibicao ?? $identificador, 0, 160),
                    'telefone' => in_array($canalTipo, self::CANAIS_TELEFONE, true) ? mb_substr($identificador, 0, 32) : null,
                    'email' => in_array($canalTipo, self::CANAIS_EMAIL, true) ? mb_substr($identificador, 0, 160) : null,
                    'criado_em' => $agora,
                    'atualizado_em' => $agora,
                ]);
                $criado = true;
            }
            try {
                Banco::inserir('contato_identidades', [
                    'contato_id' => $contatoId,
                    'canal_tipo' => $canalTipo,
                    'identificador' => mb_substr($identificador, 0, 200),
                    'nome_exibicao' => $nomeExibicao,
                    'criado_em' => Datas::agoraBanco(),
                ]);
            } catch (\PDOException $erro) {
                // duas entregas simultâneas do mesmo contato novo: a outra
                // gravou primeiro; fica valendo a dela. A releitura é TRAVADA:
                // no MySQL uma leitura comum veria a foto do início desta
                // transação, sem a identidade que a outra acabou de confirmar
                if (!Banco::eUnicidade($erro)) {
                    throw $erro;
                }
                $vencedor = self::porIdentidade($canalTipo, $identificador, travar: true);
                if ($vencedor === null) {
                    throw $erro;
                }
                if ($criado) {
                    Banco::executar('DELETE FROM contatos WHERE id = ?', [$contatoId]);
                }
                return (int) $vencedor['id'];
            }
            return $contatoId;
        });
    }

    /**
     * Para onde responder este contato dentro de um canal (null: não há como).
     *
     * É o ÚLTIMO recurso: a resposta de uma conversa vai para a identidade
     * que escreveu nela (Mensagens::destinoDaConversa). Depois de uma
     * mesclagem o contato pode ter dois números no mesmo canal, e "o
     * primeiro" seria o de outra conversa — talvez de outra pessoa.
     */
    public static function identificadorNoCanal(int $contatoId, string $canalTipo): ?string
    {
        $identificador = Banco::valor(
            'SELECT identificador FROM contato_identidades WHERE contato_id = ? AND canal_tipo = ? ORDER BY id LIMIT 1',
            [$contatoId, $canalTipo]
        );
        if ($identificador !== null) {
            return (string) $identificador;
        }
        $contato = self::porId($contatoId);
        if ($contato === null) {
            return null;
        }
        if (in_array($canalTipo, self::CANAIS_TELEFONE, true) && (string) ($contato['telefone'] ?? '') !== '') {
            return Texto::normalizarTelefone((string) $contato['telefone']);
        }
        if (in_array($canalTipo, self::CANAIS_EMAIL, true) && (string) ($contato['email'] ?? '') !== '') {
            return (string) $contato['email'];
        }
        return null;
    }

    /**
     * Junta um contato duplicado no principal, sem perder nada: identidades e
     * conversas passam para o principal; dados que só o secundário tinha
     * completam a ficha. Devolve o id do principal.
     *
     * As sessões do widget dos DOIS contatos são ENCERRADAS, não
     * transferidas: mesclar é uma decisão da atendente, não uma prova de
     * identidade. O widget mostra ao navegador o histórico do contato ligado
     * à sessão, e esse histórico acabou de ganhar as conversas (e as
     * identidades, ou seja, as mensagens futuras) da outra ficha. Encerrar só
     * a do secundário (como o ON DELETE CASCADE do Python) deixava o caminho
     * inverso aberto: o visitante anônimo que diz "sou a Maria do e-mail",
     * mesclado como PRINCIPAL, passava a ler o e-mail e o WhatsApp da Maria,
     * e dois visitantes do mesmo site juntados liam um a conversa do outro.
     * O widget recebe 401, abre uma sessão nova e o visitante continua
     * conversando; a equipe segue vendo tudo unificado no painel.
     */
    public static function mesclar(int $principalId, int $secundarioId): int
    {
        if ($principalId === $secundarioId) {
            return $principalId;
        }
        return Concorrencia::transacao(static function () use ($principalId, $secundarioId): int {
            // trava os dois contatos (sempre na mesma ordem) antes de mexer:
            // uma mensagem chegando para um deles espera a mesclagem terminar
            foreach ([min($principalId, $secundarioId), max($principalId, $secundarioId)] as $id) {
                Banco::valor('SELECT id FROM contatos WHERE id = ?' . Concorrencia::travando(), [$id]);
            }
            $principal = self::porId($principalId);
            $secundario = self::porId($secundarioId);
            if ($principal === null || $secundario === null) {
                throw new \RuntimeException('contato nao encontrado');
            }
            // identidade que os dois têm fica só a do principal (a unicidade
            // canal+identificador impediria a mudança de dono)
            $existentes = [];
            foreach (Banco::todos('SELECT canal_tipo, identificador FROM contato_identidades WHERE contato_id = ?', [$principalId]) as $i) {
                $existentes[$i['canal_tipo'] . "\0" . $i['identificador']] = true;
            }
            foreach (Banco::todos('SELECT id, canal_tipo, identificador FROM contato_identidades WHERE contato_id = ?', [$secundarioId]) as $i) {
                if (isset($existentes[$i['canal_tipo'] . "\0" . $i['identificador']])) {
                    Banco::executar('DELETE FROM contato_identidades WHERE id = ?', [(int) $i['id']]);
                }
            }
            Banco::executar('UPDATE contato_identidades SET contato_id = ? WHERE contato_id = ?', [$principalId, $secundarioId]);
            $movidas = array_map('intval', array_column(
                Banco::todos('SELECT id FROM conversas WHERE contato_id = ?', [$secundarioId]),
                'id'
            ));
            Banco::executar('UPDATE conversas SET contato_id = ? WHERE contato_id = ?', [$principalId, $secundarioId]);
            // os dois lados (ver o comentário da função): nenhum navegador
            // herda o histórico da outra ficha
            Banco::executar('DELETE FROM sessoes_widget WHERE contato_id IN (?, ?)', [$principalId, $secundarioId]);

            $mudancas = [];
            foreach (['email', 'telefone', 'empresa', 'documento'] as $campo) {
                if ((string) ($principal[$campo] ?? '') === '' && (string) ($secundario[$campo] ?? '') !== '') {
                    $mudancas[$campo] = $secundario[$campo];
                }
            }
            $obsP = trim((string) ($principal['observacoes'] ?? ''));
            $obsS = trim((string) ($secundario['observacoes'] ?? ''));
            if ($obsS !== '' && $obsS !== $obsP) {
                $mudancas['observacoes'] = $obsP === '' ? $obsS : $obsP . "\n\n" . $obsS;
            }
            $mudancas['atualizado_em'] = Datas::agoraBanco();
            Banco::atualizar('contatos', $mudancas, 'id = ?', [$principalId]);
            Banco::executar('DELETE FROM contatos WHERE id = ?', [$secundarioId]);

            // o painel atualiza a ficha nas conversas que mudaram de dono
            foreach ($movidas as $conversaId) {
                Conversas::publicar($conversaId);
            }
            return $principalId;
        });
    }

    /** @return array<string, mixed>|null */
    private static function porIdentidade(string $canalTipo, string $identificador, bool $travar = false): ?array
    {
        return Banco::um(
            'SELECT c.* FROM contatos c JOIN contato_identidades i ON i.contato_id = c.id
             WHERE i.canal_tipo = ? AND i.identificador = ? ORDER BY i.id LIMIT 1'
            . ($travar ? Concorrencia::travando() : ''),
            [$canalTipo, $identificador]
        );
    }

    /** O contato que já existe com o mesmo telefone ou e-mail. */
    private static function porDadoConhecido(string $canalTipo, string $identificador): ?int
    {
        if (in_array($canalTipo, self::CANAIS_TELEFONE, true)) {
            $telefone = Texto::normalizarTelefone($identificador);
            if ($telefone === '') {
                return null;
            }
            // o telefone é sempre gravado só com dígitos (ver PATCH do contato)
            $id = Banco::valor('SELECT id FROM contatos WHERE telefone = ? ORDER BY id LIMIT 1', [$telefone]);
            return $id === null ? null : (int) $id;
        }
        if (in_array($canalTipo, self::CANAIS_EMAIL, true)) {
            $id = Banco::valor('SELECT id FROM contatos WHERE LOWER(email) = ? ORDER BY id LIMIT 1', [mb_strtolower($identificador)]);
            return $id === null ? null : (int) $id;
        }
        return null;
    }
}

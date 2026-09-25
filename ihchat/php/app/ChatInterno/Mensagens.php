<?php
declare(strict_types=1);

namespace IHchat\ChatInterno;

use IHchat\Banco\Banco;
use IHchat\Eventos\Eventos;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\ErroHttp;
use IHchat\Nucleo\Json;

/**
 * Mensagens do chat interno (o mesmo contrato de app/servicos/chat_interno.py).
 *
 * MensagemInternaSaida {id, sala_id, autor {id, nome, setor} | null, conteudo,
 *   mencoes [ids], conversa_id, conversa {id, contato, canal_tipo, canal_nome,
 *   status, assunto} | null, criada_em, editada_em, apagada}
 *
 * Apagar é "mensagem apagada": o texto, as menções e o cartão saem do banco
 * de verdade; fica só o lugar na conversa.
 */
final class Mensagens
{
    public const MAX_CONTEUDO = 4000;
    public const LIMITE_PADRAO = 50;
    public const LIMITE_MAXIMO = 100;

    /**
     * Em lote: uma consulta para os autores e uma para as conversas.
     *
     * @param list<array<string, mixed>> $linhas de interno_mensagens
     * @return list<array<string, mixed>>
     */
    public static function saidas(array $linhas): array
    {
        $idsAutores = array_values(array_unique(array_filter(array_map(
            static fn (array $l): int => (int) ($l['autor_id'] ?? 0),
            $linhas
        ))));
        $autores = [];
        if ($idsAutores !== []) {
            foreach (Banco::todos(
                'SELECT id, nome, setor FROM atendentes WHERE id IN (' . Salas::marcadores($idsAutores) . ')',
                $idsAutores
            ) as $a) {
                $autores[(int) $a['id']] = [
                    'id' => (int) $a['id'],
                    'nome' => (string) $a['nome'],
                    'setor' => isset($a['setor']) && $a['setor'] !== '' ? (string) $a['setor'] : null,
                ];
            }
        }
        $idsConversas = array_values(array_unique(array_filter(array_map(
            static fn (array $l): int => (bool) $l['apagada'] ? 0 : (int) ($l['conversa_id'] ?? 0),
            $linhas
        ))));
        $cartoes = [];
        if ($idsConversas !== []) {
            foreach (Banco::todos(
                'SELECT c.id, c.status, c.assunto, ct.nome AS contato, ca.tipo AS canal_tipo, ca.nome AS canal_nome
                 FROM conversas c
                 JOIN contatos ct ON ct.id = c.contato_id
                 JOIN canais ca ON ca.id = c.canal_id
                 WHERE c.id IN (' . Salas::marcadores($idsConversas) . ')',
                $idsConversas
            ) as $c) {
                $cartoes[(int) $c['id']] = [
                    'id' => (int) $c['id'],
                    'contato' => (string) $c['contato'],
                    'canal_tipo' => (string) $c['canal_tipo'],
                    'canal_nome' => (string) $c['canal_nome'],
                    'status' => (string) $c['status'],
                    'assunto' => isset($c['assunto']) && $c['assunto'] !== '' ? (string) $c['assunto'] : null,
                ];
            }
        }
        $saida = [];
        foreach ($linhas as $l) {
            $apagada = (bool) $l['apagada'];
            $cartao = !$apagada && $l['conversa_id'] !== null ? ($cartoes[(int) $l['conversa_id']] ?? null) : null;
            $saida[] = [
                'id' => (int) $l['id'],
                'sala_id' => (int) $l['sala_id'],
                'autor' => $l['autor_id'] !== null ? ($autores[(int) $l['autor_id']] ?? null) : null,
                'conteudo' => $apagada ? '' : (string) $l['conteudo'],
                'mencoes' => $apagada ? [] : self::lerMencoes($l['mencoes'] ?? null),
                'conversa_id' => $cartao !== null ? $cartao['id'] : null,
                'conversa' => $cartao,
                'criada_em' => Datas::iso((string) $l['criada_em']),
                'editada_em' => Datas::iso($l['editada_em'] !== null ? (string) $l['editada_em'] : null),
                'apagada' => $apagada,
            ];
        }
        return $saida;
    }

    /** @return list<int> */
    private static function lerMencoes(mixed $texto): array
    {
        $lido = Json::ler(is_string($texto) ? $texto : null, []);
        if (!is_array($lido)) {
            return []; // texto estragado não derruba a leitura da sala
        }
        return array_values(array_filter($lido, 'is_int'));
    }

    /** @return array<string, mixed> */
    public static function saidaPorId(int $id): array
    {
        $linha = Banco::um('SELECT * FROM interno_mensagens WHERE id = ?', [$id]);
        return self::saidas([$linha ?? []])[0];
    }

    /**
     * A mensagem e a sala dela, se quem pede for membro; senão 404 (nem
     * confirma que a mensagem existe).
     *
     * @param array<string, mixed> $eu
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    public static function exigir(int $mensagemId, array $eu): array
    {
        $mensagem = Banco::um('SELECT * FROM interno_mensagens WHERE id = ?', [$mensagemId]);
        if ($mensagem === null) {
            throw ErroHttp::naoEncontrado('mensagem não encontrada');
        }
        try {
            $sala = Salas::exigir((int) $mensagem['sala_id'], $eu);
        } catch (ErroHttp) {
            throw ErroHttp::naoEncontrado('mensagem não encontrada');
        }
        return [$mensagem, $sala];
    }

    /**
     * Página de mensagens (mais novas por último) e se há mais antigas.
     *
     * @return array{mensagens: list<array<string, mixed>>, tem_mais: bool}
     */
    public static function pagina(int $salaId, ?int $antes, int $limite): array
    {
        $sql = 'SELECT * FROM interno_mensagens WHERE sala_id = ?';
        $parametros = [$salaId];
        if ($antes !== null) {
            $sql .= ' AND id < ?';
            $parametros[] = $antes;
        }
        $sql .= ' ORDER BY id DESC LIMIT ?';
        $parametros[] = $limite + 1;
        $linhas = Banco::todos($sql, $parametros);
        $temMais = count($linhas) > $limite;
        $linhas = array_reverse(array_slice($linhas, 0, $limite));
        return ['mensagens' => self::saidas($linhas), 'tem_mais' => $temMais];
    }

    // ---------------------------------------------------------------- menções

    /**
     * Padrão de "@Nome": espaços do nome casam com qualquer espaço digitado;
     * sem letra antes do "@" (e-mail não menciona) nem depois do nome
     * ("@Ana" não casa "@Anabela").
     *
     * @param list<string> $partes
     */
    private static function padrao(array $partes): string
    {
        $escapadas = array_map(static fn (string $p): string => preg_quote($p, '/'), $partes);
        return '/(?<![\p{L}\p{N}_])@' . implode('\s+', $escapadas) . '(?![\p{L}\p{N}_])/iu';
    }

    /**
     * Ids mencionados por @Nome Completo, ou por @Primeiro nome quando só um
     * membro tem esse primeiro nome. Só membros ativos da sala; nunca o autor.
     *
     * @param list<array{0: int, 1: string}> $candidatos
     * @return list<int>
     */
    public static function resolverMencoes(string $conteudo, array $candidatos, ?int $autorId): array
    {
        if (!str_contains($conteudo, '@')) {
            return [];
        }
        $partesDe = [];
        $primeiros = [];
        foreach ($candidatos as [$id, $nome]) {
            $partes = preg_split('/\s+/u', trim($nome), -1, PREG_SPLIT_NO_EMPTY) ?: [];
            $partesDe[$id] = $partes;
            if ($partes !== []) {
                $chave = mb_strtolower($partes[0]);
                $primeiros[$chave] = ($primeiros[$chave] ?? 0) + 1;
            }
        }
        $achados = [];
        foreach ($candidatos as [$id]) {
            $partes = $partesDe[$id];
            if ($id === $autorId || $partes === []) {
                continue;
            }
            if (preg_match(self::padrao($partes), $conteudo) === 1) {
                $achados[] = $id;
                continue;
            }
            if (($primeiros[mb_strtolower($partes[0])] ?? 0) === 1 && preg_match(self::padrao([$partes[0]]), $conteudo) === 1) {
                $achados[] = $id;
            }
        }
        $achados = array_values(array_unique($achados));
        sort($achados);
        return $achados;
    }

    /** @return list<array{0: int, 1: string}> */
    private static function candidatos(int $salaId): array
    {
        return array_map(
            static fn (array $l): array => [(int) $l['id'], (string) $l['nome']],
            Banco::todos(
                'SELECT a.id, a.nome FROM atendentes a JOIN interno_membros m ON m.atendente_id = a.id
                 WHERE m.sala_id = ? AND a.ativo = 1 ORDER BY a.id',
                [$salaId]
            )
        );
    }

    /** Espaço nas pontas não conta (o strip() do Python). */
    private static function aparar(?string $texto): string
    {
        return (string) preg_replace('/^\s+|\s+$/u', '', (string) $texto);
    }

    private static function exigirConversa(?int $conversaId): ?int
    {
        if ($conversaId === null) {
            return null;
        }
        if (Banco::valor('SELECT id FROM conversas WHERE id = ?', [$conversaId]) === null) {
            throw ErroHttp::naoEncontrado('conversa nao encontrada');
        }
        return $conversaId;
    }

    // ------------------------------------------------------------------ ações

    /**
     * @param array<string, mixed> $sala linha de Salas::exigir()
     * @param array<string, mixed> $eu
     * @return array<string, mixed>
     */
    public static function enviar(array $sala, array $eu, ?string $conteudo, ?int $conversaId): array
    {
        $texto = self::aparar($conteudo);
        $conversaId = self::exigirConversa($conversaId);
        if ($texto === '' && $conversaId === null) {
            throw ErroHttp::invalido('conteudo: não pode ficar vazio');
        }
        $salaId = (int) $sala['id'];
        $euId = (int) $eu['id'];
        return Banco::transacao(static function () use ($salaId, $euId, $texto, $conversaId): array {
            $agora = Datas::agoraBanco();
            $id = Banco::inserir('interno_mensagens', [
                'sala_id' => $salaId,
                'autor_id' => $euId,
                'conteudo' => $texto,
                'mencoes' => self::resolverMencoes($texto, self::candidatos($salaId), $euId),
                'conversa_id' => $conversaId,
                'criada_em' => $agora,
                'editada_em' => null,
                'apagada' => false,
            ]);
            Banco::atualizar('interno_salas', ['atualizada_em' => $agora], 'id = ?', [$salaId]);
            // a própria mensagem já está lida
            Banco::executar(
                'UPDATE interno_membros SET lida_ate = ? WHERE sala_id = ? AND atendente_id = ? AND lida_ate < ?',
                [$id, $salaId, $euId, $id]
            );
            $saida = self::saidaPorId($id);
            Eventos::publicar('interno.mensagem', $saida);
            return $saida;
        });
    }

    /**
     * @param array<string, mixed> $mensagem
     * @param array<string, mixed> $eu
     * @return array<string, mixed>
     */
    public static function editar(array $mensagem, array $eu, string $conteudo): array
    {
        if ((int) ($mensagem['autor_id'] ?? 0) !== (int) $eu['id']) {
            throw ErroHttp::proibido('só quem escreveu pode editar a mensagem');
        }
        if ((bool) $mensagem['apagada']) {
            throw ErroHttp::conflito('mensagem apagada não pode ser editada');
        }
        $texto = self::aparar($conteudo);
        if ($texto === '' && $mensagem['conversa_id'] === null) {
            throw ErroHttp::invalido('conteudo: não pode ficar vazio');
        }
        $id = (int) $mensagem['id'];
        $salaId = (int) $mensagem['sala_id'];
        $euId = (int) $eu['id'];
        return Banco::transacao(static function () use ($id, $salaId, $euId, $texto): array {
            Banco::atualizar('interno_mensagens', [
                'conteudo' => $texto,
                'mencoes' => self::resolverMencoes($texto, self::candidatos($salaId), $euId),
                'editada_em' => Datas::agoraBanco(),
            ], 'id = ?', [$id]);
            $saida = self::saidaPorId($id);
            self::sanearFila($saida);
            Eventos::publicar('interno.mensagem.atualizada', $saida);
            return $saida;
        });
    }

    /**
     * Troca, nos eventos já gravados desta mensagem, o texto velho pelo atual.
     * A fila guarda os eventos por 48 h, e quem relê de um cursor antigo
     * leria de novo o texto apagado (ou o de antes da edição). Só olha os
     * eventos do chat criados depois da mensagem; é raro (editar, apagar).
     *
     * @param array<string, mixed> $saida a MensagemInternaSaida atual
     */
    private static function sanearFila(array $saida): void
    {
        $criada = Banco::valor('SELECT criada_em FROM interno_mensagens WHERE id = ?', [$saida['id']]);
        $novo = Json::codificar($saida);
        foreach (Banco::todos(
            "SELECT id, dados FROM fila_eventos WHERE tipo IN ('interno.mensagem', 'interno.mensagem.atualizada') AND criado_em >= ?",
            [(string) $criada]
        ) as $linha) {
            $dados = Json::ler((string) $linha['dados'], null);
            if (is_array($dados) && ($dados['id'] ?? null) === $saida['id'] && ($dados['sala_id'] ?? null) === $saida['sala_id']) {
                Banco::executar('UPDATE fila_eventos SET dados = ? WHERE id = ?', [$novo, (int) $linha['id']]);
            }
        }
    }

    /**
     * @param array<string, mixed> $mensagem
     * @param array<string, mixed> $eu
     * @return array<string, mixed>
     */
    public static function apagar(array $mensagem, array $eu): array
    {
        if ((int) ($mensagem['autor_id'] ?? 0) !== (int) $eu['id']) {
            throw ErroHttp::proibido('só quem escreveu pode apagar a mensagem');
        }
        $id = (int) $mensagem['id'];
        $jaApagada = (bool) $mensagem['apagada'];
        return Banco::transacao(static function () use ($id, $jaApagada): array {
            if (!$jaApagada) {
                // o texto sai do banco de verdade; fica só o lugar ("mensagem apagada")
                Banco::atualizar('interno_mensagens', [
                    'apagada' => true,
                    'conteudo' => '',
                    'mencoes' => [],
                    'conversa_id' => null,
                    'editada_em' => Datas::agoraBanco(),
                ], 'id = ?', [$id]);
            }
            $saida = self::saidaPorId($id);
            self::sanearFila($saida);
            Eventos::publicar('interno.mensagem.atualizada', $saida);
            return $saida;
        });
    }

    /**
     * O cursor só anda para a frente e nunca passa da última mensagem.
     *
     * @param array<string, mixed> $sala linha de Salas::exigir()
     * @param array<string, mixed> $eu
     * @return array{sala_id: int, lida_ate: int, nao_lidas: int}
     */
    public static function marcarLida(array $sala, array $eu, ?int $ate): array
    {
        $salaId = (int) $sala['id'];
        $euId = (int) $eu['id'];
        return Banco::transacao(static function () use ($sala, $salaId, $euId, $ate): array {
            $ultima = Salas::ultimasIds([$salaId])[$salaId] ?? 0;
            $alvo = $ate === null ? $ultima : min($ate, $ultima);
            $lida = (int) $sala['lida_ate'];
            if ($alvo > $lida) {
                Banco::executar(
                    'UPDATE interno_membros SET lida_ate = ? WHERE sala_id = ? AND atendente_id = ?',
                    [$alvo, $salaId, $euId]
                );
                $lida = $alvo;
                // só para a própria pessoa: as outras abas dela zeram o contador
                Eventos::publicar('interno.lida', ['sala_id' => $salaId, 'lida_ate' => $alvo, 'para' => [$euId]]);
            }
            $restantes = (int) Banco::valor(
                'SELECT COUNT(*) FROM interno_mensagens WHERE sala_id = ? AND id > ?
                 AND (autor_id IS NULL OR autor_id <> ?) AND apagada = 0',
                [$salaId, $lida, $euId]
            );
            return ['sala_id' => $salaId, 'lida_ate' => $lida, 'nao_lidas' => $restantes];
        });
    }
}

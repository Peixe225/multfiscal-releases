<?php
declare(strict_types=1);

namespace IHchat\Atendimento;

use IHchat\Banco\Banco;
use IHchat\Eventos\Eventos;
use IHchat\Nucleo\Config;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\ErroHttp;

/**
 * Ciclo de vida das conversas (app/servicos/conversas.py).
 *
 * Toda mudança grava também uma linha na trilha de auditoria (`eventos`) e,
 * quando a rota pede, publica "conversa.atualizada" na fila de tempo real —
 * dentro da mesma transação do dado.
 */
final class Conversas
{
    public const STATUS = ['aberta', 'pendente', 'resolvida'];
    public const PRIORIDADES = ['baixa', 'normal', 'alta'];

    /** @return array<string, mixed>|null */
    public static function porId(int $id): ?array
    {
        return Banco::um('SELECT * FROM conversas WHERE id = ?', [$id]);
    }

    /** A conversa, ou 404 "conversa nao encontrada" (ConversaAtual do Python). @return array<string, mixed> */
    public static function exigir(int $id): array
    {
        $conversa = self::porId($id);
        if ($conversa === null) {
            throw ErroHttp::naoEncontrado('conversa nao encontrada');
        }
        return $conversa;
    }

    /** Trilha de auditoria: quem atribuiu, resolveu, reabriu... */
    public static function registrarEvento(?int $conversaId, string $tipo, string $descricao, ?int $atendenteId = null): void
    {
        Banco::inserir('eventos', [
            'conversa_id' => $conversaId,
            'atendente_id' => $atendenteId,
            'tipo' => mb_substr($tipo, 0, 40),
            'descricao' => mb_substr($descricao, 0, 300),
            'criado_em' => Datas::agoraBanco(),
        ]);
    }

    /**
     * Encontra a conversa viva do contato naquele canal, ou abre uma nova.
     *
     * Uma conversa resolvida há pouco é reaberta em vez de duplicada: quem
     * responde "obrigado" cinco minutos depois não deve virar um novo
     * atendimento. Conversa nova entra na distribuição automática.
     *
     * Duas mensagens simultâneas do mesmo contato não podem abrir duas
     * conversas (cada uma poderia ir para um atendente): a linha do contato é
     * travada primeiro, então a segunda requisição espera a primeira
     * confirmar e, com a leitura travada, já enxerga a conversa que ela criou.
     *
     * @return array{0: int, 1: bool} [id da conversa, se é nova]
     */
    public static function obterOuCriar(int $contatoId, int $canalId, ?string $assunto = null): array
    {
        return Concorrencia::transacao(static function () use ($contatoId, $canalId, $assunto): array {
            $travando = Concorrencia::travando();
            Banco::valor('SELECT id FROM contatos WHERE id = ?' . $travando, [$contatoId]);
            $viva = Banco::valor(
                "SELECT id FROM conversas WHERE contato_id = ? AND canal_id = ? AND status <> 'resolvida'
                 ORDER BY ultima_mensagem_em DESC, id DESC LIMIT 1" . $travando,
                [$contatoId, $canalId]
            );
            if ($viva !== null) {
                return [(int) $viva, false];
            }

            $recente = Banco::um(
                "SELECT id, ultima_mensagem_em FROM conversas WHERE contato_id = ? AND canal_id = ? AND status = 'resolvida'
                 ORDER BY ultima_mensagem_em DESC, id DESC LIMIT 1" . $travando,
                [$contatoId, $canalId]
            );
            $limite = Datas::doBanco(Datas::haHoras(Config::obter()->horas_reabertura));
            $ultima = $recente === null ? null : Datas::doBanco((string) $recente['ultima_mensagem_em']);
            if ($recente !== null && $ultima !== null && $limite !== null && $ultima >= $limite) {
                $id = (int) $recente['id'];
                Banco::atualizar('conversas', [
                    'status' => 'aberta', 'resolvida_em' => null, 'atualizada_em' => Datas::agoraBanco(),
                ], 'id = ?', [$id]);
                self::registrarEvento($id, 'conversa.reaberta', 'Conversa reaberta por nova mensagem do contato');
                return [$id, false];
            }

            $agora = Datas::agoraBanco();
            // o canal pode mandar as conversas novas para a fila de um setor
            $setorId = Banco::valor(
                'SELECT s.id FROM canais ca JOIN setores s ON s.id = ca.setor_padrao_id WHERE ca.id = ? AND s.ativo = 1',
                [$canalId]
            );
            $setorId = $setorId === null ? null : (int) $setorId;
            $id = Banco::inserir('conversas', [
                'contato_id' => $contatoId,
                'canal_id' => $canalId,
                'setor_id' => $setorId,
                'atendente_id' => null,
                'status' => 'aberta',
                'prioridade' => 'normal',
                'assunto' => $assunto === null ? null : mb_substr($assunto, 0, 200),
                'previa' => null,
                'nao_lidas' => 0,
                'criada_em' => $agora,
                'atualizada_em' => $agora,
                'ultima_mensagem_em' => $agora,
            ]);
            if (Config::obter()->distribuicao_automatica) {
                $atendente = Distribuicao::proximoAtendente($setorId);
                if ($atendente !== null) {
                    Banco::atualizar('conversas', ['atendente_id' => $atendente['id']], 'id = ?', [$id]);
                    self::registrarEvento($id, 'conversa.atribuida', "Atribuida automaticamente a {$atendente['nome']}");
                }
            }
            return [$id, true];
        });
    }

    /**
     * Atribui (e, com $mudaSetor, transfere de setor) e registra no histórico.
     *
     * @param array<string, mixed>|null $destino atendente que recebe (null: fica na fila)
     * @param array<string, mixed>|null $autor quem fez a mudança
     * @param array<string, mixed>|null $setor o setor novo (null: fila geral), só com $mudaSetor
     */
    public static function atribuir(int $conversaId, ?array $destino, ?array $autor = null, ?array $setor = null, bool $mudaSetor = false): void
    {
        Banco::transacao(static function () use ($conversaId, $destino, $autor, $setor, $mudaSetor): void {
            $mudancas = [
                'atendente_id' => $destino === null ? null : (int) $destino['id'],
                'atualizada_em' => Datas::agoraBanco(),
            ];
            if ($mudaSetor) {
                $mudancas['setor_id'] = $setor === null ? null : (int) $setor['id'];
            }
            Banco::atualizar('conversas', $mudancas, 'id = ?', [$conversaId]);
            if ($mudaSetor) {
                $para = $setor === null ? 'a fila geral' : "o setor {$setor['nome']}";
                $descricao = $destino !== null ? "Transferida para {$destino['nome']} ({$para})" : "Transferida para {$para}";
                $tipo = 'conversa.transferida';
            } else {
                $setorAtual = Banco::valor(
                    'SELECT s.nome FROM conversas c JOIN setores s ON s.id = c.setor_id WHERE c.id = ?',
                    [$conversaId]
                );
                $descricao = $destino !== null
                    ? "Atribuida a {$destino['nome']}"
                    : ($setorAtual === null ? 'Devolvida a fila geral' : "Devolvida a fila do setor {$setorAtual}");
                $tipo = 'conversa.atribuida';
            }
            self::registrarEvento($conversaId, $tipo, $descricao, $autor === null ? null : (int) $autor['id']);
        });
    }

    /** @param array<string, mixed>|null $autor */
    public static function mudarStatus(int $conversaId, string $status, ?array $autor = null): void
    {
        Banco::transacao(static function () use ($conversaId, $status, $autor): void {
            $anterior = (string) Banco::valor('SELECT status FROM conversas WHERE id = ?', [$conversaId]);
            $agora = Datas::agoraBanco();
            Banco::atualizar('conversas', [
                'status' => $status,
                'resolvida_em' => $status === 'resolvida' ? $agora : null,
                'atualizada_em' => $agora,
            ], 'id = ?', [$conversaId]);
            self::registrarEvento($conversaId, 'conversa.status', "Status: {$anterior} -> {$status}", $autor === null ? null : (int) $autor['id']);
        });
    }

    public static function mudarPrioridade(int $conversaId, string $prioridade): void
    {
        Banco::atualizar('conversas', ['prioridade' => $prioridade, 'atualizada_em' => Datas::agoraBanco()], 'id = ?', [$conversaId]);
    }

    public static function marcarLida(int $conversaId): void
    {
        Banco::executar('UPDATE conversas SET nao_lidas = 0 WHERE id = ? AND nao_lidas <> 0', [$conversaId]);
    }

    /** Marca a etiqueta (sem duplicar). */
    public static function etiquetar(int $conversaId, int $etiquetaId): void
    {
        Banco::transacao(static function () use ($conversaId, $etiquetaId): void {
            $ja = Banco::valor('SELECT 1 FROM conversa_etiqueta WHERE conversa_id = ? AND etiqueta_id = ?', [$conversaId, $etiquetaId]);
            if ($ja !== null) {
                return;
            }
            try {
                Banco::inserir('conversa_etiqueta', ['conversa_id' => $conversaId, 'etiqueta_id' => $etiquetaId]);
            } catch (\PDOException $erro) {
                if (!Banco::eUnicidade($erro)) {  // clique duplo: a outra requisição já marcou
                    throw $erro;
                }
            }
        });
    }

    public static function desetiquetar(int $conversaId, int $etiquetaId): void
    {
        Banco::executar('DELETE FROM conversa_etiqueta WHERE conversa_id = ? AND etiqueta_id = ?', [$conversaId, $etiquetaId]);
    }

    /**
     * Publica a conversa (ConversaSaida) na fila de tempo real e a devolve.
     * Chame dentro da transação que mudou o dado.
     *
     * @return array<string, mixed>|null
     */
    public static function publicar(int $conversaId, string $tipo = 'conversa.atualizada'): ?array
    {
        $saida = Saidas::conversaPorId($conversaId);
        if ($saida !== null) {
            Eventos::publicar($tipo, $saida, (int) $saida['contato']['id']);
        }
        return $saida;
    }

    /**
     * Caixa de entrada com filtros (GET /api/conversas).
     *
     * Só as conversas que $eu vê (Visibilidade), com os filtros por cima.
     *
     * @param array{status?: ?string, atendente?: ?string, canal_id?: ?int, setor_id?: ?int, etiqueta_id?: ?int, q?: ?string, limite?: int, deslocamento?: int} $filtros
     * @param array<string, mixed> $eu o atendente logado (visibilidade e filtro "eu")
     * @return list<array<string, mixed>> ConversaSaida
     */
    public static function listar(array $filtros, array $eu): array
    {
        $euId = (int) $eu['id'];
        $onde = [];
        $p = [];
        $visiveis = Visibilidade::condicao($eu, 'c');
        if ($visiveis !== null) {
            $onde[] = $visiveis[0];
            array_push($p, ...$visiveis[1]);
        }
        if (($filtros['setor_id'] ?? null) !== null) {
            $onde[] = 'c.setor_id = ?';
            $p[] = (int) $filtros['setor_id'];
        }
        if (($filtros['status'] ?? null) !== null) {
            $onde[] = 'c.status = ?';
            $p[] = $filtros['status'];
        }
        $atendente = $filtros['atendente'] ?? null;
        if ($atendente === 'eu') {
            $onde[] = 'c.atendente_id = ?';
            $p[] = $euId;
        } elseif ($atendente === 'sem') {
            $onde[] = 'c.atendente_id IS NULL';
        } elseif ($atendente !== null && $atendente !== '') {
            if (preg_match('/^\d+$/', $atendente) !== 1) {
                throw ErroHttp::invalido('filtro de atendente invalido');
            }
            $onde[] = 'c.atendente_id = ?';
            $p[] = (int) $atendente;
        }
        if (($filtros['canal_id'] ?? null) !== null) {
            $onde[] = 'c.canal_id = ?';
            $p[] = (int) $filtros['canal_id'];
        }
        if (($filtros['etiqueta_id'] ?? null) !== null) {
            $onde[] = 'EXISTS (SELECT 1 FROM conversa_etiqueta ce WHERE ce.conversa_id = c.id AND ce.etiqueta_id = ?)';
            $p[] = (int) $filtros['etiqueta_id'];
        }
        $q = $filtros['q'] ?? null;
        if ($q !== null && $q !== '') {
            // a busca cobre os dados do contato, o assunto e o conteúdo das
            // mensagens. LOWER dos DOIS lados, no banco (o ilike do SQLAlchemy):
            // o LOWER do SQLite só troca ASCII, então baixar o termo no PHP
            // ("cálculo") nunca casaria com o dado ("CÁLCULO" vira "cÁlculo")
            $alvo = '%' . trim($q) . '%';
            $onde[] = '(LOWER(ct.nome) LIKE LOWER(?) OR LOWER(ct.email) LIKE LOWER(?) OR LOWER(ct.telefone) LIKE LOWER(?)
                        OR LOWER(c.assunto) LIKE LOWER(?)
                        OR EXISTS (SELECT 1 FROM mensagens m WHERE m.conversa_id = c.id AND LOWER(m.conteudo) LIKE LOWER(?)))';
            array_push($p, $alvo, $alvo, $alvo, $alvo, $alvo);
        }
        $sql = 'SELECT c.* FROM conversas c JOIN contatos ct ON ct.id = c.contato_id'
            . ($onde === [] ? '' : ' WHERE ' . implode(' AND ', $onde))
            . ' ORDER BY c.ultima_mensagem_em DESC, c.id DESC LIMIT ? OFFSET ?';
        $p[] = max(0, (int) ($filtros['limite'] ?? 50));
        $p[] = max(0, (int) ($filtros['deslocamento'] ?? 0));
        return Saidas::conversas(Banco::todos($sql, $p));
    }
}

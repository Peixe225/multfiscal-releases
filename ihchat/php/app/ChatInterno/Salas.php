<?php
declare(strict_types=1);

namespace IHchat\ChatInterno;

use IHchat\Auth\Atendentes;
use IHchat\Banco\Banco;
use IHchat\Eventos\Eventos;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\ErroHttp;
use IHchat\Nucleo\Json;

/**
 * Salas do chat interno (o mesmo contrato de app/servicos/chat_interno.py).
 *
 *   geral   todos os atendentes ativos; uma só (chave "geral");
 *   setor   uma por setor do perfil (chave "setor:<hash do setor normalizado>");
 *   direta  uma por par de atendentes (chave "direta:<menor id>:<maior id>");
 *   grupo   criado por qualquer atendente com os membros escolhidos; quem
 *           cria administra (e o admin do sistema também).
 *
 * Geral e setores não têm cadastro: sincronizar() acerta os membros a partir
 * de atendentes.ativo/setor no começo de TODA rota /api/interno. Como nenhuma
 * mensagem entra numa sala sem essa conferência antes, o evento de uma sala
 * nunca vai para quem já saiu dela (o filtro de Eventos lê os membros).
 *
 * Quem não é membro recebe 404 em tudo da sala: ela "não existe" para ele.
 *
 * O setor é editável no próprio perfil; por isso quem ENTRA numa sala de
 * setor só vê dali para a frente (interno_membros.visivel_desde): trocar o
 * setor não abre o histórico de outro setor, nem pela API nem pelos eventos
 * guardados na fila. Grupo apagado (o último saiu) tem os eventos esvaziados.
 *
 * SalaSaida {id, tipo, nome, setor, com, criada_por, administrador,
 *            total_membros, nao_lidas, lida_ate, silenciada, ultima_mensagem,
 *            atualizada_em}  (+ membros no detalhe)
 */
final class Salas
{
    public const GERAL = 'geral';
    public const SETOR = 'setor';
    public const DIRETA = 'direta';
    public const GRUPO = 'grupo';
    public const NOME_GERAL = 'Geral';
    public const CHAVE_GERAL = 'geral';
    public const MAX_NOME_GRUPO = 80;
    public const MAX_MEMBROS = 200;
    private const TENTATIVAS = 3;
    /** Evento de sala apagada: fica na fila sem dados, e o filtro não o entrega. */
    public const TIPO_REMOVIDO = 'interno.removido';
    private const ORDEM_TIPO = [self::GERAL => 0, self::SETOR => 1, self::GRUPO => 2, self::DIRETA => 3];

    // ---------------------------------------------------------------- chaves

    /** "  Suporte   Técnico " e "suporte técnico" são o mesmo setor. */
    public static function normalizarSetor(?string $setor): string
    {
        return mb_strtolower(self::espacos((string) $setor));
    }

    /**
     * Hash, e não o texto: a chave é única no banco, e a colação *_ci do
     * MySQL acharia "Implantação" igual a "Implantacao" (outro setor aqui).
     */
    public static function chaveSetor(?string $setor): ?string
    {
        $normal = self::normalizarSetor($setor);
        return $normal === '' ? null : 'setor:' . substr(hash('sha256', $normal), 0, 40);
    }

    public static function chaveDireta(int $a, int $b): string
    {
        return 'direta:' . min($a, $b) . ':' . max($a, $b);
    }

    /** Espaços repetidos viram um, sem espaço nas pontas (o split() do Python). */
    public static function espacos(string $texto): string
    {
        return trim((string) preg_replace('/\s+/u', ' ', $texto));
    }

    // --------------------------------------------------------- sincronização

    /**
     * Acerta Geral e setores com os atendentes de agora (idempotente). Duas
     * requisições ao mesmo tempo podem tentar criar a mesma sala ou membro:
     * a segunda esbarra na unicidade, desfaz e confere de novo.
     */
    public static function sincronizar(): void
    {
        for ($tentativa = 1; ; $tentativa++) {
            try {
                Banco::transacao(static function (): void {
                    self::acertarAutomaticas();
                });
                return;
            } catch (\PDOException $erro) {
                if (!Banco::eUnicidade($erro) || $tentativa >= self::TENTATIVAS) {
                    throw $erro;
                }
            }
        }
    }

    private static function acertarAutomaticas(): void
    {
        $agora = Datas::agoraBanco();
        $ativos = Banco::todos('SELECT id, setor FROM atendentes WHERE ativo = 1 ORDER BY id');
        $automaticas = [];
        foreach (Banco::todos("SELECT id, chave FROM interno_salas WHERE tipo IN ('geral', 'setor')") as $linha) {
            $automaticas[(string) $linha['chave']] = (int) $linha['id'];
        }
        $sala = static function (string $chave, string $tipo, string $nome, ?string $setor) use (&$automaticas, $agora): int {
            if (!isset($automaticas[$chave])) {
                $automaticas[$chave] = Banco::inserir('interno_salas', [
                    'tipo' => $tipo,
                    'nome' => $nome,
                    'setor' => $setor,
                    'chave' => $chave,
                    'criada_por' => null,
                    'criada_em' => $agora,
                    'atualizada_em' => $agora,
                ]);
            }
            return $automaticas[$chave];
        };

        $geral = $sala(self::CHAVE_GERAL, self::GERAL, self::NOME_GERAL, null);
        $esperado = [];
        foreach ($ativos as $linha) {
            $id = (int) $linha['id'];
            $esperado["{$geral}:{$id}"] = [$geral, $id];
            $chave = self::chaveSetor($linha['setor'] ?? null);
            if ($chave !== null) {
                // o primeiro atendente (menor id) dá o nome de exibição da sala
                $exibicao = mb_substr(self::espacos((string) $linha['setor']), 0, 80);
                $setorId = $sala($chave, self::SETOR, $exibicao, $exibicao);
                $esperado["{$setorId}:{$id}"] = [$setorId, $id];
            }
        }

        $ids = array_values($automaticas);
        $atuais = [];
        foreach (Banco::todos(
            'SELECT sala_id, atendente_id FROM interno_membros WHERE sala_id IN (' . self::marcadores($ids) . ')',
            $ids
        ) as $linha) {
            $atuais["{$linha['sala_id']}:{$linha['atendente_id']}"] = [(int) $linha['sala_id'], (int) $linha['atendente_id']];
        }
        $faltam = array_diff_key($esperado, $atuais);
        $sobram = array_diff_key($atuais, $esperado);
        if ($faltam !== []) {
            // o que veio antes não conta como não lido. Na Geral quem entra vê
            // o histórico (só o admin ativa alguém); no setor, não: o setor
            // qualquer um troca no próprio perfil, e isso não pode abrir a
            // conversa de outro setor
            $ultimas = self::ultimasIds(array_values(array_unique(array_column($faltam, 0))));
            foreach (self::ordenar($faltam) as [$salaId, $atendenteId]) {
                $ultima = $ultimas[$salaId] ?? 0;
                Banco::inserir('interno_membros', [
                    'sala_id' => $salaId,
                    'atendente_id' => $atendenteId,
                    'lida_ate' => $ultima,
                    'visivel_desde' => $salaId === $geral ? 0 : $ultima,
                    'silenciada' => false,
                    'entrou_em' => $agora,
                ]);
                Eventos::publicar('interno.sala', ['sala_id' => $salaId, 'acao' => 'entrou', 'para' => [$atendenteId]]);
            }
        }
        foreach (self::ordenar($sobram) as [$salaId, $atendenteId]) {
            Banco::executar('DELETE FROM interno_membros WHERE sala_id = ? AND atendente_id = ?', [$salaId, $atendenteId]);
            Eventos::publicar('interno.sala', ['sala_id' => $salaId, 'acao' => 'saiu', 'para' => [$atendenteId]]);
        }
        self::acertarAdministracao();
    }

    /**
     * Grupo cujo administrador foi desativado (ou removido) passa a quem está
     * nele há mais tempo entre os ativos, como se ele tivesse saído.
     * Desativar não tira a pessoa dos grupos (são histórico), e sem isto o
     * grupo ficava sem ninguém que o administrasse.
     */
    private static function acertarAdministracao(): void
    {
        $orfaos = Banco::todos(
            "SELECT s.id, s.criada_por FROM interno_salas s
             LEFT JOIN atendentes a ON a.id = s.criada_por
             WHERE s.tipo = 'grupo' AND (a.id IS NULL OR a.ativo = 0)"
        );
        foreach ($orfaos as $sala) {
            $novo = self::maisAntigoAtivo((int) $sala['id']);
            if ($novo !== null && $novo !== ($sala['criada_por'] !== null ? (int) $sala['criada_por'] : null)) {
                Banco::atualizar(
                    'interno_salas',
                    ['criada_por' => $novo, 'atualizada_em' => Datas::agoraBanco()],
                    'id = ?',
                    [(int) $sala['id']]
                );
                Eventos::publicar('interno.sala', ['sala_id' => (int) $sala['id'], 'acao' => 'atualizada']);
            }
        }
    }

    /**
     * Membro ativo há mais tempo na sala (entre $entre, se vier).
     *
     * @param list<int>|null $entre
     */
    private static function maisAntigoAtivo(int $salaId, ?array $entre = null): ?int
    {
        $sql = 'SELECT m.atendente_id FROM interno_membros m JOIN atendentes a ON a.id = m.atendente_id
                WHERE m.sala_id = ? AND a.ativo = 1';
        $parametros = [$salaId];
        if ($entre !== null) {
            if ($entre === []) {
                return null;
            }
            $sql .= ' AND m.atendente_id IN (' . self::marcadores($entre) . ')';
            $parametros = [...$parametros, ...$entre];
        }
        $id = Banco::valor($sql . ' ORDER BY m.entrou_em, m.atendente_id LIMIT 1', $parametros);
        return $id !== null ? (int) $id : null;
    }

    /**
     * @param array<string, array{0: int, 1: int}> $pares
     * @return list<array{0: int, 1: int}>
     */
    private static function ordenar(array $pares): array
    {
        $lista = array_values($pares);
        usort($lista, static fn (array $a, array $b): int => [$a[0], $a[1]] <=> [$b[0], $b[1]]);
        return $lista;
    }

    /**
     * Maior id de mensagem por sala.
     *
     * @param list<int> $salas
     * @return array<int, int>
     */
    public static function ultimasIds(array $salas): array
    {
        if ($salas === []) {
            return [];
        }
        $saida = [];
        foreach (Banco::todos(
            'SELECT sala_id, MAX(id) AS ultima FROM interno_mensagens WHERE sala_id IN (' . self::marcadores($salas) . ') GROUP BY sala_id',
            $salas
        ) as $linha) {
            $saida[(int) $linha['sala_id']] = (int) $linha['ultima'];
        }
        return $saida;
    }

    /** "?, ?, ?" para um IN com a lista (nunca vazia: quem chama confere). @param list<mixed> $valores */
    public static function marcadores(array $valores): string
    {
        return implode(', ', array_fill(0, max(1, count($valores)), '?'));
    }

    // ----------------------------------------------------------------- acesso

    /**
     * [sala_id => visivel_desde] das salas de que a pessoa é membro agora. O
     * filtro dos eventos usa: mensagem de id até visivel_desde não é para ela.
     *
     * @return array<int, int>
     */
    public static function visiveisDoAtendente(int $atendenteId): array
    {
        $saida = [];
        foreach (Banco::todos(
            'SELECT sala_id, visivel_desde FROM interno_membros WHERE atendente_id = ?',
            [$atendenteId]
        ) as $linha) {
            $saida[(int) $linha['sala_id']] = (int) ($linha['visivel_desde'] ?? 0);
        }
        return $saida;
    }

    /**
     * A sala com o vínculo de quem pede (lida_ate, silenciada); 404 se não for membro.
     *
     * @param array<string, mixed> $eu
     * @return array<string, mixed>
     */
    public static function exigir(int $salaId, array $eu): array
    {
        $linha = Banco::um(
            'SELECT s.*, m.lida_ate, m.silenciada, m.entrou_em, m.visivel_desde FROM interno_salas s
             JOIN interno_membros m ON m.sala_id = s.id
             WHERE s.id = ? AND m.atendente_id = ?',
            [$salaId, (int) $eu['id']]
        );
        if ($linha === null) {
            throw ErroHttp::naoEncontrado('sala não encontrada');
        }
        return $linha;
    }

    /**
     * @param array<string, mixed> $sala
     * @param array<string, mixed> $eu
     */
    public static function podeAdministrar(array $sala, array $eu): bool
    {
        return $sala['tipo'] === self::GRUPO
            && ((int) ($sala['criada_por'] ?? 0) === (int) $eu['id'] || Atendentes::eAdmin($eu));
    }

    // ----------------------------------------------------------------- saídas

    /**
     * @param array<string, mixed> $eu
     * @return list<array<string, mixed>>
     */
    public static function listar(array $eu): array
    {
        return self::saidas(Banco::todos(
            'SELECT s.*, m.lida_ate, m.silenciada, m.visivel_desde FROM interno_salas s
             JOIN interno_membros m ON m.sala_id = s.id
             WHERE m.atendente_id = ?',
            [(int) $eu['id']]
        ), $eu);
    }

    /**
     * SalaSaida de cada linha (sala + vínculo), com as contagens em lote.
     * Ordem: Geral, setores (por nome), grupos e diretas (a mais recente primeiro).
     *
     * @param list<array<string, mixed>> $linhas
     * @param array<string, mixed> $eu
     * @return list<array<string, mixed>>
     */
    public static function saidas(array $linhas, array $eu): array
    {
        if ($linhas === []) {
            return [];
        }
        $euId = (int) $eu['id'];
        $ids = array_map(static fn (array $l): int => (int) $l['id'], $linhas);
        $in = self::marcadores($ids);

        $totais = [];
        foreach (Banco::todos(
            "SELECT m.sala_id, COUNT(*) AS n FROM interno_membros m
             JOIN atendentes a ON a.id = m.atendente_id
             WHERE m.sala_id IN ({$in}) AND a.ativo = 1 GROUP BY m.sala_id",
            $ids
        ) as $l) {
            $totais[(int) $l['sala_id']] = (int) $l['n'];
        }
        $naoLidas = [];
        foreach (Banco::todos(
            "SELECT g.sala_id, COUNT(*) AS n FROM interno_mensagens g
             JOIN interno_membros m ON m.sala_id = g.sala_id AND m.atendente_id = ?
             WHERE g.sala_id IN ({$in}) AND g.id > m.lida_ate
               AND (g.autor_id IS NULL OR g.autor_id <> ?) AND g.apagada = 0
             GROUP BY g.sala_id",
            [$euId, ...$ids, $euId]
        ) as $l) {
            $naoLidas[(int) $l['sala_id']] = (int) $l['n'];
        }
        $ultimas = [];
        $idsUltimas = array_values(self::ultimasIds($ids));
        if ($idsUltimas !== []) {
            $mensagens = Banco::todos(
                'SELECT * FROM interno_mensagens WHERE id IN (' . self::marcadores($idsUltimas) . ')',
                $idsUltimas
            );
            foreach (Mensagens::saidas($mensagens) as $saida) {
                $ultimas[$saida['sala_id']] = $saida;
            }
        }
        $diretas = array_values(array_map(
            static fn (array $l): int => (int) $l['id'],
            array_filter($linhas, static fn (array $l): bool => $l['tipo'] === self::DIRETA)
        ));
        $outros = [];
        if ($diretas !== []) {
            foreach (Banco::todos(
                'SELECT m.sala_id AS sala_da_direta, a.* FROM interno_membros m
                 JOIN atendentes a ON a.id = m.atendente_id
                 WHERE m.sala_id IN (' . self::marcadores($diretas) . ') AND m.atendente_id <> ?',
                [...$diretas, $euId]
            ) as $l) {
                $outros[(int) $l['sala_da_direta']] = Atendentes::tipar($l);
            }
        }

        $saida = [];
        foreach ($linhas as $l) {
            $id = (int) $l['id'];
            $com = $outros[$id] ?? null;
            $nome = $l['tipo'] === self::DIRETA
                ? ($com !== null ? (string) $com['nome'] : 'Conversa direta')
                : ((string) ($l['nome'] ?? '') !== '' ? (string) $l['nome'] : self::NOME_GERAL);
            $saida[] = [
                'id' => $id,
                'tipo' => (string) $l['tipo'],
                'nome' => $nome,
                'setor' => $l['tipo'] === self::SETOR && ($l['setor'] ?? '') !== '' ? (string) $l['setor'] : null,
                'com' => $com !== null ? self::resumo($com) : null,
                'criada_por' => $l['tipo'] === self::GRUPO && $l['criada_por'] !== null ? (int) $l['criada_por'] : null,
                'administrador' => self::podeAdministrar($l, $eu),
                'total_membros' => $totais[$id] ?? 0,
                'nao_lidas' => $naoLidas[$id] ?? 0,
                'lida_ate' => (int) ($l['lida_ate'] ?? 0),
                'silenciada' => (bool) ($l['silenciada'] ?? false),
                // a última da sala é de antes de a pessoa entrar (setor): nenhuma é visível
                'ultima_mensagem' => isset($ultimas[$id]) && $ultimas[$id]['id'] > (int) ($l['visivel_desde'] ?? 0)
                    ? $ultimas[$id]
                    : null,
                'atualizada_em' => Datas::iso((string) $l['atualizada_em']),
                '_ordem' => (string) $l['atualizada_em'],
            ];
        }
        usort($saida, static function (array $a, array $b): int {
            $chave = static fn (array $s): array => [
                self::ORDEM_TIPO[$s['tipo']] ?? 9,
                $s['tipo'] === self::SETOR ? mb_strtolower($s['nome']) : '',
            ];
            $comparacao = $chave($a) <=> $chave($b);
            if ($comparacao !== 0) {
                return $comparacao;
            }
            if (in_array($a['tipo'], [self::GRUPO, self::DIRETA], true)) {
                // mais recente primeiro (o texto do banco ordena como a data)
                $comparacao = $b['_ordem'] <=> $a['_ordem'];
                if ($comparacao !== 0) {
                    return $comparacao;
                }
            }
            return $a['id'] <=> $b['id'];
        });
        foreach ($saida as &$item) {
            unset($item['_ordem']);
        }
        unset($item);
        return $saida;
    }

    /**
     * SalaDetalhe: a saída da sala com a lista de membros.
     *
     * @param array<string, mixed> $sala linha de exigir()
     * @param array<string, mixed> $eu
     * @return array<string, mixed>
     */
    public static function detalhe(array $sala, array $eu): array
    {
        $saida = self::saidas([$sala], $eu)[0];
        $saida['membros'] = array_map(
            static fn (array $l): array => self::resumo(Atendentes::tipar($l)),
            Banco::todos(
                'SELECT a.* FROM atendentes a JOIN interno_membros m ON m.atendente_id = a.id
                 WHERE m.sala_id = ? ORDER BY a.nome, a.id',
                [(int) $sala['id']]
            )
        );
        return $saida;
    }

    /**
     * AtendenteResumo {id, nome, setor, ativo, disponivel, admin}: sem e-mail,
     * sem senha. `admin` vem do papel, que só o admin muda: nome e setor
     * qualquer um troca no próprio perfil, então é o que não dá para imitar.
     *
     * @param array<string, mixed> $a
     * @return array<string, mixed>
     */
    public static function resumo(array $a): array
    {
        return [
            'id' => (int) $a['id'],
            'nome' => (string) $a['nome'],
            'setor' => isset($a['setor']) && $a['setor'] !== '' ? (string) $a['setor'] : null,
            'ativo' => (bool) $a['ativo'],
            'disponivel' => (bool) $a['disponivel'],
            'admin' => Atendentes::eAdmin($a),
        ];
    }

    /** Recarrega a sala com o vínculo (depois de mudar algo nela). @param array<string, mixed> $eu @return array<string, mixed> */
    public static function recarregar(int $salaId, array $eu): array
    {
        return self::detalhe(self::exigir($salaId, $eu), $eu);
    }

    // ----------------------------------------------------------------- gestão

    /**
     * Confere que os ids são de atendentes ativos (422 com os que não são).
     *
     * @param list<int> $ids
     * @return list<int> sem repetição, em ordem
     */
    public static function conferirMembros(array $ids, string $campo): array
    {
        $unicos = array_values(array_unique(array_map('intval', $ids)));
        sort($unicos);
        if ($unicos === []) {
            return [];
        }
        $validos = array_map('intval', array_column(Banco::todos(
            'SELECT id FROM atendentes WHERE ativo = 1 AND id IN (' . self::marcadores($unicos) . ')',
            $unicos
        ), 'id'));
        $faltando = array_values(array_diff($unicos, $validos));
        if ($faltando !== []) {
            throw ErroHttp::invalido("{$campo}: atendente inexistente ou inativo: " . implode(', ', $faltando));
        }
        return $unicos;
    }

    public static function nomeDoGrupo(?string $nome): string
    {
        $texto = self::espacos((string) $nome);
        if ($texto === '') {
            throw ErroHttp::invalido('nome: não pode ficar vazio');
        }
        if (mb_strlen($texto) > self::MAX_NOME_GRUPO) {
            throw ErroHttp::invalido('nome: pode ter no máximo ' . self::MAX_NOME_GRUPO . ' caracteres');
        }
        return $texto;
    }

    /**
     * @param array<string, mixed> $eu
     * @param list<int> $membros
     * @return array<string, mixed> SalaDetalhe
     */
    public static function criarGrupo(array $eu, string $nome, array $membros): array
    {
        $nome = self::nomeDoGrupo($nome);
        $euId = (int) $eu['id'];
        $ids = self::conferirMembros(array_values(array_filter($membros, static fn ($i): bool => (int) $i !== $euId)), 'membros');
        $salaId = Banco::transacao(static function () use ($eu, $euId, $nome, $ids): int {
            $agora = Datas::agoraBanco();
            $salaId = Banco::inserir('interno_salas', [
                'tipo' => self::GRUPO,
                'nome' => $nome,
                'setor' => null,
                'chave' => null,
                'criada_por' => $euId,
                'criada_em' => $agora,
                'atualizada_em' => $agora,
            ]);
            foreach ([$euId, ...$ids] as $atendenteId) {
                Banco::inserir('interno_membros', [
                    'sala_id' => $salaId,
                    'atendente_id' => $atendenteId,
                    'lida_ate' => 0,
                    'silenciada' => false,
                    'entrou_em' => $agora,
                ]);
            }
            Eventos::publicar('interno.sala', ['sala_id' => $salaId, 'acao' => 'criada']);
            return $salaId;
        });
        return self::recarregar($salaId, $eu);
    }

    /**
     * A direta do par: devolve a que existe ou cria (uma só por par).
     *
     * @param array<string, mixed> $eu
     * @return array<string, mixed> SalaDetalhe
     */
    public static function abrirDireta(array $eu, int $outroId): array
    {
        $euId = (int) $eu['id'];
        if ($outroId === $euId) {
            throw ErroHttp::invalido('escolha outra pessoa para a conversa direta');
        }
        $outro = Atendentes::porId($outroId);
        if ($outro === null || !$outro['ativo']) {
            throw ErroHttp::naoEncontrado('atendente nao encontrado');
        }
        $chave = self::chaveDireta($euId, $outroId);
        for ($tentativa = 1; ; $tentativa++) {
            $existente = Banco::valor('SELECT id FROM interno_salas WHERE chave = ?', [$chave]);
            if ($existente !== null) {
                return self::recarregar((int) $existente, $eu);
            }
            try {
                $salaId = Banco::transacao(static function () use ($chave, $euId, $outroId): int {
                    $agora = Datas::agoraBanco();
                    $salaId = Banco::inserir('interno_salas', [
                        'tipo' => self::DIRETA,
                        'nome' => null,
                        'setor' => null,
                        'chave' => $chave,
                        'criada_por' => null,
                        'criada_em' => $agora,
                        'atualizada_em' => $agora,
                    ]);
                    foreach ([$euId, $outroId] as $atendenteId) {
                        Banco::inserir('interno_membros', [
                            'sala_id' => $salaId,
                            'atendente_id' => $atendenteId,
                            'lida_ate' => 0,
                            'silenciada' => false,
                            'entrou_em' => $agora,
                        ]);
                    }
                    Eventos::publicar('interno.sala', ['sala_id' => $salaId, 'acao' => 'criada']);
                    return $salaId;
                });
                return self::recarregar($salaId, $eu);
            } catch (\PDOException $erro) {
                // a outra pessoa criou no mesmo instante: usa a dela
                if (!Banco::eUnicidade($erro) || $tentativa >= self::TENTATIVAS) {
                    throw $erro;
                }
            }
        }
    }

    /**
     * PATCH: silenciada (qualquer membro, só para si); nome/adicionar/remover
     * (só grupo, só quem administra). Campo ausente ou null: não mexe.
     *
     * @param array<string, mixed> $sala linha de exigir()
     * @param array<string, mixed> $eu
     * @param array{silenciada: ?bool, nome: ?string, adicionar: ?list<int>, remover: ?list<int>} $pedido
     * @return array<string, mixed> SalaDetalhe
     */
    public static function alterar(array $sala, array $eu, array $pedido): array
    {
        $salaId = (int) $sala['id'];
        $euId = (int) $eu['id'];
        $gestao = $pedido['nome'] !== null || $pedido['adicionar'] !== null || $pedido['remover'] !== null;
        if ($gestao) {
            if ($sala['tipo'] !== self::GRUPO) {
                throw ErroHttp::requisicaoInvalida('só grupos podem ser renomeados ou ter membros alterados');
            }
            if (!self::podeAdministrar($sala, $eu)) {
                throw ErroHttp::proibido('só quem administra o grupo pode alterá-lo');
            }
        }
        $nome = $pedido['nome'] !== null ? self::nomeDoGrupo($pedido['nome']) : null;
        $adicionar = $pedido['adicionar'] ? self::conferirMembros($pedido['adicionar'], 'adicionar') : [];

        Banco::transacao(static function () use ($sala, $salaId, $euId, $pedido, $nome, $adicionar): void {
            if ($pedido['silenciada'] !== null && (bool) $sala['silenciada'] !== $pedido['silenciada']) {
                Banco::executar(
                    'UPDATE interno_membros SET silenciada = ? WHERE sala_id = ? AND atendente_id = ?',
                    [$pedido['silenciada'], $salaId, $euId]
                );
                Eventos::publicar('interno.sala', ['sala_id' => $salaId, 'acao' => 'atualizada', 'para' => [$euId]]);
            }
            $mudou = false;
            if ($nome !== null && $nome !== $sala['nome']) {
                Banco::atualizar('interno_salas', ['nome' => $nome], 'id = ?', [$salaId]);
                $mudou = true;
            }
            $atuais = self::membrosDe($salaId);
            $novos = array_values(array_diff($adicionar, $atuais));
            if ($novos !== []) {
                $ultima = self::ultimasIds([$salaId])[$salaId] ?? 0;
                foreach ($novos as $atendenteId) {
                    Banco::inserir('interno_membros', [
                        'sala_id' => $salaId,
                        'atendente_id' => $atendenteId,
                        'lida_ate' => $ultima,
                        'silenciada' => false,
                        'entrou_em' => Datas::agoraBanco(),
                    ]);
                }
                $atuais = [...$atuais, ...$novos];
                $mudou = true;
            }
            if ($pedido['remover']) {
                $tirar = array_values(array_unique(array_filter(
                    array_map('intval', $pedido['remover']),
                    static fn (int $i): bool => in_array($i, $atuais, true) && $i !== $euId
                )));
                sort($tirar);
                foreach ($tirar as $atendenteId) {
                    Banco::executar('DELETE FROM interno_membros WHERE sala_id = ? AND atendente_id = ?', [$salaId, $atendenteId]);
                    Eventos::publicar('interno.sala', ['sala_id' => $salaId, 'acao' => 'saiu', 'para' => [$atendenteId]]);
                }
                if ($tirar !== []) {
                    $atuais = array_values(array_diff($atuais, $tirar));
                    $mudou = true;
                    self::passarAdministracao($sala, $atuais);
                }
            }
            if ($mudou) {
                Banco::atualizar('interno_salas', ['atualizada_em' => Datas::agoraBanco()], 'id = ?', [$salaId]);
                Eventos::publicar('interno.sala', ['sala_id' => $salaId, 'acao' => 'atualizada']);
            }
        });
        return self::recarregar($salaId, $eu);
    }

    /** @return list<int> */
    private static function membrosDe(int $salaId): array
    {
        return array_map('intval', array_column(
            Banco::todos('SELECT atendente_id FROM interno_membros WHERE sala_id = ?', [$salaId]),
            'atendente_id'
        ));
    }

    /**
     * Quem criou saiu: administra quem está no grupo há mais tempo entre os
     * ATIVOS (um desativado não administraria nada). Sem ativo nenhum, fica
     * com quem está há mais tempo; a sincronização passa adiante depois.
     *
     * @param array<string, mixed> $sala
     * @param list<int> $restantes
     */
    private static function passarAdministracao(array $sala, array $restantes): void
    {
        $criador = $sala['criada_por'] !== null ? (int) $sala['criada_por'] : null;
        if ($restantes === [] || ($criador !== null && in_array($criador, $restantes, true))) {
            return;
        }
        $novo = self::maisAntigoAtivo((int) $sala['id'], $restantes) ?? Banco::valor(
            'SELECT atendente_id FROM interno_membros WHERE sala_id = ? AND atendente_id IN (' . self::marcadores($restantes) . ')
             ORDER BY entrou_em, atendente_id LIMIT 1',
            [(int) $sala['id'], ...$restantes]
        );
        Banco::atualizar('interno_salas', ['criada_por' => $novo !== null ? (int) $novo : null], 'id = ?', [(int) $sala['id']]);
    }

    /**
     * @param array<string, mixed> $sala linha de exigir()
     * @param array<string, mixed> $eu
     */
    public static function sair(array $sala, array $eu): void
    {
        if ($sala['tipo'] !== self::GRUPO) {
            throw ErroHttp::requisicaoInvalida('só é possível sair de grupos');
        }
        $salaId = (int) $sala['id'];
        $euId = (int) $eu['id'];
        Banco::transacao(static function () use ($sala, $salaId, $euId): void {
            Banco::executar('DELETE FROM interno_membros WHERE sala_id = ? AND atendente_id = ?', [$salaId, $euId]);
            Eventos::publicar('interno.sala', ['sala_id' => $salaId, 'acao' => 'saiu', 'para' => [$euId]]);
            $restantes = self::membrosDe($salaId);
            if ($restantes === []) {
                // grupo sem ninguém não volta a ser visto: sai do banco com as
                // mensagens, e os eventos dele na fila (com o texto) são esvaziados
                self::esvaziarEventosDaSala($salaId);
                Banco::executar('DELETE FROM interno_salas WHERE id = ?', [$salaId]);
                return;
            }
            self::passarAdministracao($sala, $restantes);
            Banco::atualizar('interno_salas', ['atualizada_em' => Datas::agoraBanco()], 'id = ?', [$salaId]);
            Eventos::publicar('interno.sala', ['sala_id' => $salaId, 'acao' => 'atualizada']);
        });
    }

    /**
     * Os eventos "interno.*" guardados de uma sala que vai ser apagada viram
     * TIPO_REMOVIDO sem dados. A fila os guarda por 48 h: sem isto o texto do
     * grupo apagado continuaria lá, e se o id da sala voltasse (base SQLite
     * criada pelo Python antigo) chegaria a quem estivesse na sala nova. A
     * linha fica: apagar abriria uma lacuna de id que faz o cursor esperar.
     */
    private static function esvaziarEventosDaSala(int $salaId): void
    {
        $ids = [];
        foreach (Banco::todos(
            "SELECT id, dados FROM fila_eventos WHERE tipo LIKE 'interno.%' AND tipo <> ?",
            [self::TIPO_REMOVIDO]
        ) as $linha) {
            $dados = Json::ler((string) $linha['dados'], null);
            if (is_array($dados) && ($dados['sala_id'] ?? null) === $salaId) {
                $ids[] = (int) $linha['id'];
            }
        }
        if ($ids !== []) {
            Banco::executar(
                "UPDATE fila_eventos SET tipo = ?, dados = '{}' WHERE id IN (" . self::marcadores($ids) . ')',
                [self::TIPO_REMOVIDO, ...$ids]
            );
        }
    }
}

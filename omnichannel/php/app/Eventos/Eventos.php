<?php
declare(strict_types=1);

namespace OmniChannel\Eventos;

use OmniChannel\Banco\Banco;
use OmniChannel\Nucleo\Datas;
use OmniChannel\Nucleo\Json;

/**
 * Tempo real por consulta.
 *
 * A hospedagem compartilhada não segura conexão aberta (nada de SSE), então
 * cada evento vira uma linha em `fila_eventos` com id crescente, e o painel e
 * o widget perguntam a cada ~2 s "o que há depois do id N".
 *
 *     Eventos::publicar('mensagem.nova', $mensagemSaida, $contatoId);
 *     Eventos::publicar('conversa.atualizada', $conversaSaida, $contatoId);
 *
 * Publique DENTRO da mesma transação que gravou o dado (Banco::transacao):
 * assim ninguém recebe um evento cujo dado ainda não está no banco, e um
 * rollback leva o evento junto. Os tipos e o formato de `dados` são os mesmos
 * que o Python manda pelo SSE (app/servicos/mensagens.py).
 */
final class Eventos
{
    /** Retenção: quem ficou offline mais que isso recarrega a tela inteira. */
    public const HORAS_RETENCAO = 48;
    public const LIMITE_PADRAO = 200;
    public const LIMITE_MAXIMO = 500;

    /**
     * Uma lacuna de id recente pode ser uma transação ainda não confirmada (o
     * MySQL reserva o id antes do commit): o cursor espera por ela até este
     * tempo. Passado isso, é id perdido num rollback e a leitura segue.
     */
    public const SEGUNDOS_LACUNA = 3.0;

    /** Uma poda a cada N publicações, em média (o cron também poda). */
    private const CHANCE_PODA = 50;

    /**
     * Grava o evento e devolve o id.
     *
     * @param array<string, mixed>|object $dados
     * @param int|null $contatoId dono do evento, para o widget filtrar o do visitante
     */
    public static function publicar(string $tipo, array|object $dados, ?int $contatoId = null): int
    {
        $id = Banco::inserir('fila_eventos', [
            'tipo' => $tipo,
            'dados' => Json::codificar($dados),
            'contato_id' => $contatoId,
            'criado_em' => Datas::agoraBanco(),
        ]);
        if (random_int(1, self::CHANCE_PODA) === 1) {
            self::podar();
        }
        return $id;
    }

    /** Maior id existente (0 se vazia): o cursor de quem acabou de abrir a tela. */
    public static function ultimoId(): int
    {
        return (int) (Banco::valor('SELECT MAX(id) FROM fila_eventos') ?? 0);
    }

    /**
     * Eventos depois do cursor, para o painel (todos os tipos).
     *
     * $depois = null: nenhum evento, só o cursor atual ("começar de agora").
     *
     * @return array{eventos: list<array{id: int, tipo: string, dados: mixed}>, ultimo: int}
     */
    public static function desde(?int $depois, int $limite = self::LIMITE_PADRAO): array
    {
        if ($depois === null) {
            return ['eventos' => [], 'ultimo' => self::ultimoId()];
        }
        $linhas = Banco::todos(
            'SELECT id, tipo, dados, criado_em FROM fila_eventos WHERE id > ? ORDER BY id LIMIT ?',
            [$depois, self::limitar($limite)]
        );
        return self::montar($linhas, $depois, null);
    }

    /**
     * Eventos para o visitante do widget: só "mensagem.nova" de SAÍDA para o
     * próprio contato, e nunca nota interna — o mesmo filtro do SSE do Python.
     *
     * @return array{eventos: list<array{id: int, tipo: string, dados: mixed}>, ultimo: int}
     */
    public static function desdeDoVisitante(?int $depois, int $contatoId, int $limite = self::LIMITE_PADRAO): array
    {
        if ($depois === null) {
            return ['eventos' => [], 'ultimo' => self::ultimoId()];
        }
        // o cursor avança por TODOS os ids (não só os do contato), senão a
        // espera de lacuna nunca terminaria para quem tem poucos eventos
        $linhas = Banco::todos(
            'SELECT id, tipo, dados, contato_id, criado_em FROM fila_eventos WHERE id > ? ORDER BY id LIMIT ?',
            [$depois, self::limitar($limite)]
        );
        $filtro = static function (array $linha, mixed $dados) use ($contatoId): bool {
            return $linha['tipo'] === 'mensagem.nova'
                && (int) ($linha['contato_id'] ?? 0) === $contatoId
                && is_array($dados)
                && ($dados['direcao'] ?? null) === 'saida'
                && ($dados['tipo'] ?? null) !== 'nota_interna';
        };
        return self::montar($linhas, $depois, $filtro);
    }

    /** Apaga eventos mais velhos que a retenção. Devolve quantos. */
    public static function podar(): int
    {
        return Banco::executar('DELETE FROM fila_eventos WHERE criado_em < ?', [Datas::haHoras(self::HORAS_RETENCAO)]);
    }

    private static function limitar(int $limite): int
    {
        return max(1, min(self::LIMITE_MAXIMO, $limite));
    }

    /**
     * Monta a resposta respeitando lacunas recentes (ver SEGUNDOS_LACUNA).
     *
     * @param list<array<string, mixed>> $linhas
     * @param (callable(array<string, mixed>, mixed): bool)|null $filtro
     * @return array{eventos: list<array{id: int, tipo: string, dados: mixed}>, ultimo: int}
     */
    private static function montar(array $linhas, int $depois, ?callable $filtro): array
    {
        $eventos = [];
        $ultimo = $depois;
        $esperado = $depois + 1;
        $limiteLacuna = Datas::agora()->modify('-' . (int) (self::SEGUNDOS_LACUNA * 1000) . ' milliseconds');
        foreach ($linhas as $linha) {
            $id = (int) $linha['id'];
            if ($id !== $esperado && $depois > 0) {
                $criado = Datas::doBanco((string) $linha['criado_em']);
                if ($criado !== null && $criado > $limiteLacuna) {
                    // um id anterior pode estar numa transação ainda aberta:
                    // para aqui e volta na próxima consulta
                    break;
                }
            }
            $esperado = $id + 1;
            $ultimo = $id;
            $dados = Json::ler((string) $linha['dados'], null);
            if ($filtro !== null && !$filtro($linha, $dados)) {
                continue;
            }
            $eventos[] = ['id' => $id, 'tipo' => (string) $linha['tipo'], 'dados' => self::comoObjeto($dados)];
        }
        return ['eventos' => $eventos, 'ultimo' => $ultimo];
    }

    /** {} continua {} na saída (json_decode de "{}" vira array vazio). */
    private static function comoObjeto(mixed $dados): mixed
    {
        return $dados === [] ? new \stdClass() : $dados;
    }
}

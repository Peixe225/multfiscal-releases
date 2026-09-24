<?php
declare(strict_types=1);

namespace OmniChannel\Canais;

use OmniChannel\Nucleo\Config;
use OmniChannel\Nucleo\Datas;
use OmniChannel\Nucleo\Json;
use OmniChannel\Nucleo\Log;

/**
 * Coleta dos canais que BUSCAM as mensagens em vez de recebê-las
 * (app/coletor.py): e-mail via IMAP e Telegram em modo polling.
 *
 * Na hospedagem não há processo contínuo: o cron chama coletarTodos() uma vez
 * por minuto (Tarefas\ColetarCanais). Cada adaptador decide em coletar() se há
 * o que buscar, e confirmarColeta() só é chamado depois que o lote foi
 * gravado: com falha transitória (banco fora do ar), nada é confirmado e o
 * lote volta na próxima vez, morrendo na deduplicação pelo id externo. O
 * e-mail entrega um gerador: cada mensagem é gravada aqui antes de a próxima
 * ser baixada, e ele a marca como lida logo depois (memória de um e-mail só).
 */
final class Coletor
{
    /** @return array{novas: int, canais: int, erros: int} */
    public static function coletarTodos(): array
    {
        $canais = Canais::todos(soAtivos: true);
        $chaves = [];
        foreach ($canais as $canal) {
            try {
                $chaves[$canal['id']] = Registro::adaptadorPara($canal)->chaveColeta();
            } catch (\Throwable) {
                // canal com credencial estranha não derruba a coleta dos outros
                $chaves[$canal['id']] = null;
            }
        }
        $repetidos = self::repetidos($canais, $chaves);
        $situacoes = self::lerSituacoes();
        $resumo = ['novas' => 0, 'canais' => 0, 'erros' => 0];
        foreach ($canais as $canal) {
            if ($chaves[$canal['id']] === null) {
                continue; // não busca nada (webhook, webchat, e-mail sem IMAP)
            }
            $resumo['canais']++;
            $erro = null;
            if (isset($repetidos[$canal['id']])) {
                $erro = self::erroDeRepetido($repetidos[$canal['id']]);
            } else {
                try {
                    $resumo['novas'] += self::coletarCanal($canal);
                } catch (ErroCanal $e) {
                    $erro = $e->getMessage();
                } catch (\Throwable $e) {
                    Log::excecao($e, "coleta do canal {$canal['id']}");
                    $erro = 'falha inesperada na coleta: ' . mb_substr(strtok($e->getMessage(), "\n") ?: get_class($e), 0, 200);
                }
            }
            if ($erro !== null) {
                $resumo['erros']++;
            }
            self::anotar($situacoes, $canal, $erro);
        }
        // canal desativado ou removido não tem mais situação a mostrar
        $situacoes = array_intersect_key($situacoes, array_flip(array_map('strval', array_column($canais, 'id'))));
        self::gravarSituacoes($situacoes);
        return $resumo;
    }

    /**
     * Busca e grava as mensagens de um canal. Devolve quantas entraram.
     *
     * @param array<string, mixed> $canal
     */
    public static function coletarCanal(array $canal): int
    {
        $adaptador = Registro::adaptadorPara($canal);
        // a rede fica fora de qualquer transação; cada mensagem grava na sua
        $novas = 0;
        foreach ($adaptador->coletar() as $recebida) {
            try {
                if (Rotas::gravarRecebida($canal, $recebida) !== null) {
                    $novas++;
                }
            } catch (\PDOException $erro) {
                // banco travado ou fora do ar: para sem confirmar, o lote volta depois
                throw $erro;
            } catch (\Throwable $erro) {
                // uma mensagem que nunca grava (defeito de dado) não pode travar
                // a fila do canal para sempre: fica no log e o lote segue
                Log::excecao($erro, "canal {$canal['id']}: mensagem {$recebida->externo_id} descartada");
            }
        }
        $adaptador->confirmarColeta();
        return $novas;
    }

    /**
     * Canais que buscam no mesmo lugar que outro, cada um apontando o dono (o
     * de menor id). Dois canais com o mesmo bot dividiriam ao acaso as
     * conversas de um cliente.
     *
     * @param list<array<string, mixed>> $canais
     * @param array<int, ?string> $chaves
     * @return array<int, array<string, mixed>>
     */
    public static function repetidos(array $canais, array $chaves): array
    {
        usort($canais, static fn (array $a, array $b): int => $a['id'] <=> $b['id']);
        $donos = [];
        $bloqueados = [];
        foreach ($canais as $canal) {
            $chave = $chaves[$canal['id']] ?? null;
            if ($chave === null) {
                continue;
            }
            $dono = $donos[$chave] ??= $canal;
            if ($dono['id'] !== $canal['id']) {
                $bloqueados[$canal['id']] = $dono;
            }
        }
        return $bloqueados;
    }

    /** @param array<string, mixed> $dono */
    public static function erroDeRepetido(array $dono): string
    {
        return "o canal '{$dono['nome']}' já busca as mensagens com estas mesmas credenciais (mesmo "
            . 'token ou caixa), e só ele recebe: dois canais buscando no mesmo lugar dividiriam as '
            . 'conversas de um cliente ao acaso. Deixe as credenciais em um canal só: desative este '
            . 'ou troque o token';
    }

    /**
     * Situação da coleta de um canal ({recebendo, erro, erro_desde,
     * ultima_coleta_ok}), ou null se o cron ainda não passou por ele.
     *
     * @return array<string, mixed>|null
     */
    public static function situacao(int $canalId): ?array
    {
        $atual = self::lerSituacoes()[(string) $canalId] ?? null;
        if (!is_array($atual)) {
            return null;
        }
        return [
            'recebendo' => ($atual['erro'] ?? null) === null,
            'erro' => $atual['erro'] ?? null,
            'erro_desde' => Datas::iso($atual['erro_desde'] ?? null),
            'ultima_coleta_ok' => Datas::iso($atual['ultima_coleta_ok'] ?? null),
        ];
    }

    /**
     * Registra o resultado e só escreve no log quando muda (a cada minuto o
     * mesmo aviso viraria ruído).
     *
     * @param array<string, array<string, mixed>> $situacoes
     * @param array<string, mixed> $canal
     */
    private static function anotar(array &$situacoes, array $canal, ?string $erro): void
    {
        $chave = (string) $canal['id'];
        $atual = $situacoes[$chave] ?? ['erro' => null, 'erro_desde' => null, 'ultima_coleta_ok' => null];
        $agora = Datas::agoraBanco();
        if ($erro === null) {
            if ($atual['erro'] !== null) {
                Log::info("canal {$canal['nome']} voltou a coletar");
            }
            $atual = ['erro' => null, 'erro_desde' => null, 'ultima_coleta_ok' => $agora];
        } elseif ($erro !== $atual['erro']) {
            Log::aviso("canal {$canal['nome']}: {$erro}");
            $atual['erro_desde'] = $atual['erro'] === null ? $agora : $atual['erro_desde'];
            $atual['erro'] = $erro;
        }
        $situacoes[$chave] = $atual;
    }

    private static function arquivoSituacoes(): string
    {
        return Config::obter()->pasta('coleta') . '/situacao.json';
    }

    /** @return array<string, array<string, mixed>> */
    private static function lerSituacoes(): array
    {
        $arquivo = self::arquivoSituacoes();
        $dados = is_file($arquivo) ? Json::ler((string) file_get_contents($arquivo), []) : [];
        return is_array($dados) ? $dados : [];
    }

    /** @param array<string, array<string, mixed>> $situacoes */
    private static function gravarSituacoes(array $situacoes): void
    {
        file_put_contents(self::arquivoSituacoes(), Json::codificar((object) $situacoes), LOCK_EX);
    }
}

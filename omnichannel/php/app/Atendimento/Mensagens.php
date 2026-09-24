<?php
declare(strict_types=1);

namespace OmniChannel\Atendimento;

use OmniChannel\Auth\Atendentes;
use OmniChannel\Banco\Banco;
use OmniChannel\Eventos\Eventos;
use OmniChannel\Nucleo\Config;
use OmniChannel\Nucleo\Datas;
use OmniChannel\Nucleo\Json;
use OmniChannel\Nucleo\Log;
use OmniChannel\Nucleo\Texto;

/**
 * Entrada e saída de mensagens — o coração do atendimento
 * (app/servicos/mensagens.py).
 *
 * Uso pelas outras frentes:
 *
 *   // webhook, coleta IMAP/getUpdates, widget, simulador
 *   $saida = Mensagens::registrarEntrada($canal, new MensagemRecebida(...));   // null = repetida
 *
 *   // resposta com arquivo (rota de anexos)
 *   $arquivo = Anexos::paraEnvio($nome, $bytes, $tipo);                          // AnexoGrande -> 413
 *   $saida = Mensagens::enviarMensagem($conversaId, $legenda, $atendente, [$arquivo]); // CanalSemArquivos -> 409
 *
 *   // recibos de entrega/leitura
 *   Mensagens::aplicarStatusExterno([['externo_id' => 'whatsapp:wamid.X', 'status' => 'lida']]);
 *
 * Cada uma grava e publica os eventos (mensagem.nova, conversa.atualizada,
 * mensagem.status) na MESMA transação; passe publicar: false para publicar
 * por conta própria. O retorno é a MensagemSaida (Saidas::mensagens).
 *
 * A chamada ao provedor (rede) acontece FORA da transação: um provedor lento
 * não pode segurar o banco (no SQLite, travaria todas as gravações).
 *
 * Concorrência (webhooks em rajada, resposta cruzando com entrada): toda
 * gravação trava a CONVERSA antes de inserir a mensagem. O INSERT põe uma
 * trava compartilhada na conversa (chave estrangeira); duas transações com
 * a compartilhada tentando depois o UPDATE da conversa se travam uma à
 * outra (deadlock). Contadores sobem no próprio SQL (nao_lidas + 1), nunca
 * "valor lido + 1", que perde incrementos. Ver Concorrencia.
 *
 * Para onde vai a resposta: para a identidade que escreveu por último na
 * conversa (gravada em mensagens.metadados.identidade na entrada), não para
 * "a primeira identidade do contato no canal" — depois de uma mesclagem o
 * contato pode ter dois números/endereços no mesmo canal.
 */
final class Mensagens
{
    public const TIPOS_INTERNOS = ['nota_interna'];
    /** Em mensagens.metadados da entrada: o identificador de quem escreveu. */
    public const CHAVE_IDENTIDADE = 'identidade';

    /** Webhooks são reentregues; o id externo evita mensagem duplicada. */
    public static function jaProcessada(?string $externoId): ?int
    {
        if ($externoId === null || $externoId === '') {
            return null;
        }
        $id = Banco::valor('SELECT id FROM mensagens WHERE externo_id = ?', [$externoId]);
        return $id === null ? null : (int) $id;
    }

    /**
     * Grava uma mensagem que chegou do contato. Devolve null se for repetida.
     *
     * @param array<string, mixed> $canal linha de `canais`
     * @param MensagemRecebida|array<string, mixed>|object $recebida
     * @return array<string, mixed>|null MensagemSaida
     */
    public static function registrarEntrada(array $canal, array|object $recebida, bool $publicar = true): ?array
    {
        $canal = Adaptadores::comCredenciais($canal);
        $recebida = MensagemRecebida::de($recebida);
        $externoId = $recebida->externo_id === null ? null : mb_substr($recebida->externo_id, 0, 200);
        if (self::jaProcessada($externoId) !== null) {
            return null;
        }

        // arquivos baixados antes de abrir a transação (rede fora do banco)
        $arquivos = self::baixarRecebidos(Adaptadores::para($canal), $recebida->anexos);

        $canalTipo = (string) $canal['tipo'];
        // quem escreveu, como ficou gravado na identidade: é para lá que a
        // resposta desta conversa volta (destinoDaConversa)
        $metadados = $recebida->metadados;
        $metadados[self::CHAVE_IDENTIDADE] = mb_substr(Contatos::normalizarIdentificador($canalTipo, $recebida->identificador), 0, 200);

        try {
            $saida = Concorrencia::transacao(static function () use ($canal, $canalTipo, $recebida, $externoId, $arquivos, $metadados, $publicar): ?array {
                $contatoId = Contatos::resolver($canalTipo, $recebida->identificador, $recebida->nome_exibicao);
                [$conversaId, $nova] = Conversas::obterOuCriar($contatoId, (int) $canal['id'], $recebida->assunto);

                $agora = Datas::agoraBanco();
                // trava a conversa ANTES do INSERT da mensagem (ver cabeçalho)
                $conversa = self::travarConversa($conversaId, $agora);
                try {
                    $mensagemId = Banco::inserir('mensagens', [
                        'conversa_id' => $conversaId,
                        'direcao' => 'entrada',
                        'tipo' => 'texto',
                        'conteudo' => $recebida->conteudo,
                        'status' => 'recebida',
                        'atendente_id' => null,
                        'externo_id' => $externoId,
                        'erro' => null,
                        'metadados' => Json::objeto($metadados),
                        'assinatura' => null,
                        'criada_em' => $agora,
                    ]);
                } catch (\PDOException $erro) {
                    // a mesma entrega chegou ao mesmo tempo por outra requisição
                    if (!Banco::eUnicidade($erro) || $externoId === null) {
                        throw $erro;
                    }
                    if ($nova) {
                        Banco::executar('DELETE FROM conversas WHERE id = ?', [$conversaId]);
                    }
                    return null;
                }

                $mudancas = [
                    'ultima_mensagem_em' => $agora,
                    'previa' => Texto::resumir($recebida->conteudo, 180),
                    'atualizada_em' => $agora,
                ];
                if ($recebida->assunto !== null && (string) ($conversa['assunto'] ?? '') === '') {
                    $mudancas['assunto'] = mb_substr($recebida->assunto, 0, 200);
                }
                $nomes = self::gravarAnexos($mensagemId, $arquivos);
                if (trim($recebida->conteudo) === '' && $nomes !== []) {
                    // mensagem só com arquivo precisa de prévia; senão a lista fica vazia
                    $mudancas['previa'] = Texto::resumir('📎 ' . $nomes[0], 180);
                }
                // o incremento é do banco: "valor lido + 1" perderia mensagens em rajada
                $sets = [];
                foreach (array_keys($mudancas) as $coluna) {
                    $sets[] = "{$coluna} = ?";
                }
                Banco::executar(
                    'UPDATE conversas SET nao_lidas = nao_lidas + 1, ' . implode(', ', $sets) . ' WHERE id = ?',
                    [...array_values($mudancas), $conversaId]
                );

                return self::concluir($mensagemId, $conversaId, $publicar, true);
            });
            if ($saida === null) {
                self::descartarArquivos($arquivos); // repetida: os bytes baixados sobram
            }
            return $saida;
        } catch (\Throwable $erro) {
            self::descartarArquivos($arquivos);
            throw $erro;
        }
    }

    /**
     * Responde ao contato pelo mesmo canal em que ele falou.
     *
     * A resposta grava em `assinatura` o {nome, setor} do atendente e chega
     * ao provedor com a assinatura no formato do canal (Assinaturas). Sem
     * credencial: "simulada" no sandbox, "falhou" fora dele. Conversa em que
     * alguma entrada foi escrita pelo simulador nunca sai por provedor real:
     * o destino é inventado e poderia ser o número de alguém.
     *
     * @param array<string, mixed>|null $atendente
     * @param list<ArquivoParaEnviar> $arquivos
     * @return array<string, mixed> MensagemSaida
     * @throws CanalSemArquivos|AnexoGrande
     */
    public static function enviarMensagem(
        int $conversaId,
        string $conteudo,
        ?array $atendente = null,
        array $arquivos = [],
        bool $publicar = true,
        bool $marcarLida = true,
    ): array {
        $conversa = Conversas::porId($conversaId) ?? throw new \RuntimeException('conversa nao encontrada');
        $canal = Adaptadores::canal((int) $conversa['canal_id']) ?? throw new \RuntimeException('canal nao encontrado');
        $tipoCanal = (string) $canal['tipo'];
        $adaptador = Adaptadores::para($canal);
        if ($arquivos !== [] && !$adaptador->enviaArquivos()) {
            throw new CanalSemArquivos("o canal {$tipoCanal} não envia arquivos");
        }
        foreach ($arquivos as $arquivo) {
            Anexos::conferirTamanho($arquivo->dados);
        }

        $assinatura = $atendente === null ? null : Atendentes::assinatura($atendente);
        $destino = self::destinoDaConversa($conversa, $tipoCanal);
        if ($destino === null) {
            $resultado = ResultadoEnvio::falhou("contato sem identificacao no canal {$tipoCanal}");
        } elseif ($tipoCanal !== 'webchat' && self::temEntradaSimulada($conversaId)) {
            $resultado = new ResultadoEnvio(ResultadoEnvio::SIMULADA);
        } elseif (!$adaptador->configurado()) {
            $resultado = Config::obter()->modo_sandbox
                ? new ResultadoEnvio(ResultadoEnvio::SIMULADA)
                : ResultadoEnvio::falhou("canal {$canal['nome']} sem credenciais configuradas");
        } else {
            $contexto = self::contextoDeEnvio($conversa) + ['arquivos' => $arquivos, 'assinatura' => $assinatura];
            try {
                $resultado = $adaptador->enviar($destino, Assinaturas::aplicar($tipoCanal, $conteudo, $assinatura), $contexto);
            } catch (\Throwable $erro) {
                $resultado = ResultadoEnvio::falhou(Adaptadores::mensagemDeErro($erro));
            }
        }

        // os bytes vão para o disco antes da transação (ela pode ser repetida)
        $guardados = [];
        try {
            foreach ($arquivos as $arquivo) {
                $guardados[] = [
                    'nome' => $arquivo->nome,
                    'tipo' => Anexos::tipoSeguro($arquivo->nome, $arquivo->tipo_conteudo, $arquivo->dados),
                    'referencia' => null,
                    'chave' => Anexos::salvar($arquivo->dados, $arquivo->nome),
                    'tamanho' => strlen($arquivo->dados),
                    'erro' => null,
                ];
            }
            return Concorrencia::transacao(
                static fn (): array => self::gravarSaida($conversaId, $conteudo, $atendente, $assinatura, $guardados, $resultado, $publicar, $marcarLida)
            );
        } catch (\Throwable $erro) {
            self::descartarArquivos($guardados);
            if (!in_array($resultado->status, [ResultadoEnvio::SIMULADA, ResultadoEnvio::FALHOU], true)) {
                // o cliente JÁ recebeu: sem este rastro, o atendente reenviaria em dobro
                Log::erro('resposta entregue ao provedor mas nao gravada', [
                    'conversa_id' => $conversaId,
                    'externo_id' => $resultado->externo_id,
                    'atendente_id' => $atendente === null ? null : (int) $atendente['id'],
                    'erro' => get_class($erro) . ': ' . $erro->getMessage(),
                ]);
            }
            throw $erro;
        }
    }

    /**
     * A parte de banco da resposta (repetível: nada de rede nem disco aqui).
     *
     * @param array<string, mixed>|null $atendente
     * @param array{nome: string, setor: ?string}|null $assinatura
     * @param list<array{nome: string, tipo: string, referencia: ?string, chave: ?string, tamanho: int, erro: ?string}> $guardados
     * @return array<string, mixed>
     */
    private static function gravarSaida(
        int $conversaId,
        string $conteudo,
        ?array $atendente,
        ?array $assinatura,
        array $guardados,
        ResultadoEnvio $resultado,
        bool $publicar,
        bool $marcarLida,
    ): array {
        $agora = Datas::agoraBanco();
        // trava a conversa ANTES do INSERT da mensagem (ver cabeçalho)
        $conversa = self::travarConversa($conversaId, $agora);
        $externoId = $resultado->externo_id === null || $resultado->externo_id === '' ? null : mb_substr($resultado->externo_id, 0, 200);
        if ($externoId !== null && self::jaProcessada($externoId) !== null) {
            $externoId = null; // id repetido do provedor não pode derrubar a resposta já entregue
        }
        $mensagemId = Banco::inserir('mensagens', [
            'conversa_id' => $conversaId,
            'direcao' => 'saida',
            'tipo' => 'texto',
            'conteudo' => $conteudo,
            'status' => mb_substr($resultado->status, 0, 20),
            'atendente_id' => $atendente === null ? null : (int) $atendente['id'],
            'externo_id' => $externoId,
            'erro' => $resultado->erro,
            'metadados' => Json::objeto([]),
            'assinatura' => $assinatura === null ? null : Json::codificar($assinatura),
            'criada_em' => $agora,
        ]);

        $mudancas = ['ultima_mensagem_em' => $agora, 'previa' => Texto::resumir($conteudo, 180), 'atualizada_em' => $agora];
        if (($conversa['primeira_resposta_em'] ?? null) === null && $resultado->status !== ResultadoEnvio::FALHOU) {
            $mudancas['primeira_resposta_em'] = $agora;
        }
        if ($conversa['status'] === 'resolvida') {
            $mudancas['status'] = 'aberta';
            $mudancas['resolvida_em'] = null;
        }
        if ($marcarLida) {
            $mudancas['nao_lidas'] = 0;
        }
        // guardado mesmo quando o envio falha: o atendente reenvia sem subir de novo
        $nomes = self::gravarAnexos($mensagemId, $guardados);
        if (trim($conteudo) === '' && $nomes !== []) {
            $mudancas['previa'] = Texto::resumir('📎 ' . $nomes[0], 180);
        }
        Banco::atualizar('conversas', $mudancas, 'id = ?', [$conversaId]);

        return self::concluir($mensagemId, $conversaId, $publicar, true);
    }

    /**
     * Nota interna: fica no histórico da equipe e nunca vai para o contato.
     *
     * @param array<string, mixed> $atendente
     * @return array<string, mixed> MensagemSaida
     */
    public static function registrarNota(int $conversaId, string $conteudo, array $atendente, bool $publicar = true): array
    {
        return Concorrencia::transacao(static function () use ($conversaId, $conteudo, $atendente, $publicar): array {
            $id = Banco::inserir('mensagens', [
                'conversa_id' => $conversaId,
                'direcao' => 'saida',
                'tipo' => 'nota_interna',
                'conteudo' => $conteudo,
                'status' => 'enviada',
                'atendente_id' => (int) $atendente['id'],
                'externo_id' => null,
                'erro' => null,
                'metadados' => Json::objeto([]),
                'assinatura' => null,
                'criada_em' => Datas::agoraBanco(),
            ]);
            return self::concluir($id, $conversaId, $publicar, false);
        });
    }

    /**
     * Recibos de entrega/leitura vindos do provedor. Cada item: {externo_id, status}
     * (array, objeto ou ResultadoEnvio). Devolve as mensagens alteradas.
     *
     * @param list<array<string, mixed>|object> $atualizacoes
     * @return list<array<string, mixed>> MensagemSaida
     */
    public static function aplicarStatusExterno(array $atualizacoes, bool $publicar = true): array
    {
        if ($atualizacoes === []) {
            return [];
        }
        return Concorrencia::transacao(static function () use ($atualizacoes, $publicar): array {
            $alteradas = [];
            foreach ($atualizacoes as $atualizacao) {
                $r = ResultadoEnvio::de($atualizacao);
                if ($r->externo_id === null || $r->externo_id === '') {
                    continue;
                }
                $id = self::jaProcessada($r->externo_id);
                if ($id === null) {
                    continue;
                }
                Banco::atualizar('mensagens', ['status' => mb_substr($r->status, 0, 20)], 'id = ?', [$id]);
                $saida = Saidas::mensagemPorId($id);
                if ($saida === null) {
                    continue;
                }
                if ($publicar) {
                    Eventos::publicar('mensagem.status', $saida, $saida['contato_id']);
                }
                $alteradas[] = $saida;
            }
            return $alteradas;
        });
    }

    /**
     * Dados extras que alguns canais precisam (assunto e thread do e-mail).
     *
     * @param array<string, mixed> $conversa
     * @return array{assunto: ?string, referencia: mixed}
     */
    public static function contextoDeEnvio(array $conversa): array
    {
        $dados = self::metadadosDaUltimaEntrada((int) $conversa['id']);
        $assunto = $conversa['assunto'] ?? null;
        return [
            'assunto' => $assunto === null || $assunto === '' ? null : (string) $assunto,
            'referencia' => $dados['referencias'] ?? null,
        ];
    }

    /**
     * A ÚLTIMA mensagem do cliente nesta conversa foi escrita pelo simulador?
     *
     * O simulador inventa o número/endereço: responder a ele por um provedor
     * real poderia chegar a um estranho. Mas vale só enquanto a última
     * entrada for simulada — quando o canal vai ao ar e o cliente de verdade
     * escreve na mesma conversa, a resposta precisa sair (e vai para quem
     * escreveu por último, destinoDaConversa).
     */
    public static function temEntradaSimulada(int $conversaId): bool
    {
        return array_key_exists('simulada_por', self::metadadosDaUltimaEntrada($conversaId));
    }

    /**
     * Para onde responder: a identidade que escreveu por último nesta
     * conversa, se ela ainda é do contato; senão (conversa antiga, sem o
     * registro) a identidade do contato no canal.
     *
     * @param array<string, mixed> $conversa
     */
    public static function destinoDaConversa(array $conversa, string $canalTipo): ?string
    {
        $contatoId = (int) $conversa['contato_id'];
        $identidade = self::metadadosDaUltimaEntrada((int) $conversa['id'])[self::CHAVE_IDENTIDADE] ?? null;
        if (is_string($identidade) && $identidade !== '') {
            $doContato = Banco::valor(
                'SELECT identificador FROM contato_identidades WHERE contato_id = ? AND canal_tipo = ? AND identificador = ?',
                [$contatoId, $canalTipo, $identidade]
            );
            if ($doContato !== null) {
                return (string) $doContato;
            }
        }
        return Contatos::identificadorNoCanal($contatoId, $canalTipo);
    }

    /** @return array<string, mixed> metadados da última entrada ([] se não houver) */
    private static function metadadosDaUltimaEntrada(int $conversaId): array
    {
        $metadados = Banco::valor(
            "SELECT metadados FROM mensagens WHERE conversa_id = ? AND direcao = 'entrada' ORDER BY criada_em DESC, id DESC LIMIT 1",
            [$conversaId]
        );
        $dados = $metadados === null ? [] : Json::ler((string) $metadados, []);
        return is_array($dados) ? $dados : [];
    }

    /**
     * Publica a mensagem (MensagemSaida) na fila de tempo real e a devolve.
     *
     * @return array<string, mixed>|null
     */
    public static function publicarMensagem(int $mensagemId, string $tipo = 'mensagem.nova'): ?array
    {
        $saida = Saidas::mensagemPorId($mensagemId);
        if ($saida !== null) {
            Eventos::publicar($tipo, $saida, $saida['contato_id']);
        }
        return $saida;
    }

    // -------------------------------------------------------------- apoio

    /**
     * Trava a linha da conversa (UPDATE de atualizada_em) e a relê já travada.
     *
     * @return array<string, mixed>
     */
    private static function travarConversa(int $conversaId, string $agora): array
    {
        Banco::executar('UPDATE conversas SET atualizada_em = ? WHERE id = ?', [$agora, $conversaId]);
        return Banco::um('SELECT * FROM conversas WHERE id = ?' . Concorrencia::travando(), [$conversaId])
            ?? throw new \RuntimeException('conversa nao encontrada');
    }

    /** @return array<string, mixed> */
    private static function concluir(int $mensagemId, int $conversaId, bool $publicar, bool $comConversa): array
    {
        $saida = Saidas::mensagemPorId($mensagemId) ?? throw new \RuntimeException('mensagem sumiu');
        if ($publicar) {
            Eventos::publicar('mensagem.nova', $saida, $saida['contato_id']);
            if ($comConversa) {
                Conversas::publicar($conversaId);
            }
        }
        return $saida;
    }

    /**
     * @param list<AnexoRecebido> $recebidos
     * @return list<array{nome: string, tipo: string, referencia: ?string, chave: ?string, tamanho: int, erro: ?string}>
     */
    private static function baixarRecebidos(AdaptadorDeCanal $adaptador, array $recebidos): array
    {
        $arquivos = [];
        foreach ($recebidos as $recebido) {
            $item = [
                'nome' => $recebido->nome === '' ? 'arquivo' : $recebido->nome,
                // sem os bytes, só o nome/tipo anunciados (já filtrados)
                'tipo' => Anexos::tipoSeguro($recebido->nome, $recebido->tipo_conteudo),
                'referencia' => $recebido->referencia,
                'chave' => null,
                'tamanho' => 0,
                'erro' => null,
            ];
            try {
                $dados = $adaptador->baixarAnexo($recebido);
                Anexos::conferirTamanho($dados);
                // o tipo anunciado vem do REMETENTE (e-mail, Telegram, Meta):
                // confere com os bytes e só aceita tipos que o navegador não executa
                $item['tipo'] = Anexos::tipoSeguro($recebido->nome, $recebido->tipo_conteudo, $dados);
                $item['chave'] = Anexos::salvar($dados, $item['nome']);
                $item['tamanho'] = strlen($dados);
            } catch (\Throwable $erro) {
                // o atendente precisa saber que veio um arquivo, mesmo sem os bytes
                $item['erro'] = Adaptadores::mensagemDeErro($erro);
            }
            $arquivos[] = $item;
        }
        return $arquivos;
    }

    /**
     * @param list<array{nome: string, tipo: string, referencia: ?string, chave: ?string, tamanho: int, erro: ?string}> $arquivos
     * @return list<string> nomes gravados
     */
    private static function gravarAnexos(int $mensagemId, array $arquivos): array
    {
        $nomes = [];
        foreach ($arquivos as $a) {
            Banco::inserir('anexos', [
                'mensagem_id' => $mensagemId,
                'nome' => mb_substr($a['nome'], 0, 160),
                'tipo_conteudo' => mb_substr($a['tipo'], 0, 120),
                'tamanho' => $a['tamanho'],
                'chave' => $a['chave'],
                'externo_id' => $a['referencia'] === null ? null : mb_substr($a['referencia'], 0, 200),
                'erro' => $a['erro'],
                'criado_em' => Datas::agoraBanco(),
            ]);
            $nomes[] = $a['nome'];
        }
        return $nomes;
    }

    /** @param list<array{chave: ?string}> $arquivos */
    private static function descartarArquivos(array $arquivos): void
    {
        foreach ($arquivos as $a) {
            if ($a['chave'] !== null) {
                try {
                    Anexos::remover($a['chave']);
                } catch (\Throwable) {
                    // melhor esforço: arquivo órfão não quebra nada
                }
            }
        }
    }
}

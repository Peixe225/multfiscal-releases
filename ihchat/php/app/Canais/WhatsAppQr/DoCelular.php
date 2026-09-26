<?php
declare(strict_types=1);

namespace IHchat\Canais\WhatsAppQr;

use IHchat\Atendimento\Adaptadores;
use IHchat\Atendimento\AnexoRecebido;
use IHchat\Atendimento\Anexos;
use IHchat\Atendimento\Concorrencia;
use IHchat\Atendimento\Contatos;
use IHchat\Atendimento\Conversas;
use IHchat\Atendimento\MensagemRecebida;
use IHchat\Atendimento\Mensagens;
use IHchat\Atendimento\Saidas;
use IHchat\Banco\Banco;
use IHchat\Canais\AdaptadorWhatsAppQr;
use IHchat\Eventos\Eventos;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\Json;
use IHchat\Nucleo\Texto;

/**
 * Mensagem que o dono mandou pelo próprio WhatsApp (fromMe): entra no
 * histórico como SAÍDA "Enviada pelo celular" e NÃO é reenviada. Assim a
 * equipe vê a conversa inteira (registrar_do_celular em app/api/webhooks.py).
 *
 * Segue as regras de Mensagens::registrarEntrada: mídia baixada ANTES da
 * transação (rede fora do banco), conversa travada antes do INSERT, e a
 * corrida de duas entregas iguais resolvida pela unicidade do id externo.
 */
final class DoCelular
{
    /**
     * @param array<string, mixed> $canal
     * @return array<string, mixed>|null MensagemSaida, ou null se já registrada
     */
    public static function registrar(array $canal, AdaptadorWhatsAppQr $adaptador, MensagemRecebida $recebida): ?array
    {
        $externoId = $recebida->externo_id === null ? null : mb_substr($recebida->externo_id, 0, 200);
        if (Mensagens::jaProcessada($externoId) !== null) {
            return null; // reentrega, ou a que o próprio IHchat mandou e voltou pelo webhook
        }
        $arquivos = self::baixar($adaptador, $recebida->anexos);
        $metadados = $recebida->metadados;
        $metadados['enviada_pelo_celular'] = true;
        try {
            $saida = Concorrencia::transacao(static function () use ($canal, $recebida, $externoId, $arquivos, $metadados): ?array {
                $contatoId = Contatos::resolver((string) $canal['tipo'], $recebida->identificador, $recebida->nome_exibicao);
                [$conversaId, $nova] = self::conversa($contatoId, (int) $canal['id']);
                $agora = Datas::agoraBanco();
                // trava a conversa ANTES do INSERT da mensagem (ver Mensagens)
                Banco::executar('UPDATE conversas SET atualizada_em = ? WHERE id = ?', [$agora, $conversaId]);
                $conversa = Banco::um('SELECT * FROM conversas WHERE id = ?' . Concorrencia::travando(), [$conversaId])
                    ?? throw new \RuntimeException('conversa nao encontrada');
                $tinhaEntrada = Banco::valor(
                    "SELECT id FROM mensagens WHERE conversa_id = ? AND direcao = 'entrada' LIMIT 1",
                    [$conversaId]
                ) !== null;
                try {
                    $mensagemId = Banco::inserir('mensagens', [
                        'conversa_id' => $conversaId,
                        'direcao' => 'saida',
                        'tipo' => 'texto',
                        'conteudo' => $recebida->conteudo,
                        'status' => 'enviada',
                        'atendente_id' => null,
                        'externo_id' => $externoId,
                        'erro' => null,
                        'metadados' => Json::objeto($metadados),
                        // o painel mostra "Enviada pelo celular" no lugar do atendente
                        'assinatura' => Json::codificar(AdaptadorWhatsAppQr::ASSINATURA_DO_CELULAR),
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
                    'nao_lidas' => 0, // quem respondeu já leu, como numa resposta pelo painel
                ];
                if (($conversa['primeira_resposta_em'] ?? null) === null && $tinhaEntrada) {
                    $mudancas['primeira_resposta_em'] = $agora; // o cliente foi atendido, só que pelo celular
                }
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
                if (trim($recebida->conteudo) === '' && $nomes !== []) {
                    $mudancas['previa'] = Texto::resumir('📎 ' . $nomes[0], 180);
                }
                Banco::atualizar('conversas', $mudancas, 'id = ?', [$conversaId]);

                $saida = Saidas::mensagemPorId($mensagemId) ?? throw new \RuntimeException('mensagem sumiu');
                Eventos::publicar('mensagem.nova', $saida, $saida['contato_id']);
                Conversas::publicar($conversaId);
                return $saida;
            });
        } catch (\Throwable $erro) {
            self::descartar($arquivos);
            throw $erro;
        }
        if ($saida === null) {
            self::descartar($arquivos); // repetida: os bytes baixados sobram
        }
        return $saida;
    }

    /**
     * Onde entra a resposta dada pelo celular: a conversa viva do contato
     * neste canal; senão a mais recente, mesmo resolvida (o dono respondendo
     * "de nada" não reabre atendimento para a equipe); senão uma nova.
     *
     * @return array{0: int, 1: bool} [id, se é nova]
     */
    private static function conversa(int $contatoId, int $canalId): array
    {
        $viva = Banco::valor(
            "SELECT id FROM conversas WHERE contato_id = ? AND canal_id = ? AND status <> 'resolvida'
             ORDER BY ultima_mensagem_em DESC, id DESC LIMIT 1",
            [$contatoId, $canalId]
        );
        if ($viva !== null) {
            return [(int) $viva, false];
        }
        $recente = Banco::valor(
            'SELECT id FROM conversas WHERE contato_id = ? AND canal_id = ? ORDER BY ultima_mensagem_em DESC, id DESC LIMIT 1',
            [$contatoId, $canalId]
        );
        if ($recente !== null) {
            return [(int) $recente, false];
        }
        return Conversas::obterOuCriar($contatoId, $canalId);
    }

    /**
     * Baixa e guarda os arquivos anunciados (fora da transação). Falha de
     * download não derruba a mensagem: o anexo fica registrado com o erro.
     *
     * @param list<AnexoRecebido> $recebidos
     * @return list<array{nome: string, tipo: string, referencia: ?string, chave: ?string, tamanho: int, erro: ?string}>
     */
    private static function baixar(AdaptadorWhatsAppQr $adaptador, array $recebidos): array
    {
        $arquivos = [];
        foreach ($recebidos as $recebido) {
            $item = [
                'nome' => $recebido->nome === '' ? 'arquivo' : $recebido->nome,
                'tipo' => Anexos::tipoSeguro($recebido->nome, $recebido->tipo_conteudo),
                'referencia' => $recebido->referencia,
                'chave' => null,
                'tamanho' => 0,
                'erro' => null,
            ];
            try {
                $dados = $adaptador->baixarAnexo($recebido);
                Anexos::conferirTamanho($dados);
                $item['tipo'] = Anexos::tipoSeguro($recebido->nome, $recebido->tipo_conteudo, $dados);
                $item['chave'] = Anexos::salvar($dados, $item['nome']);
                $item['tamanho'] = strlen($dados);
            } catch (\Throwable $erro) {
                $item['erro'] = Adaptadores::mensagemDeErro($erro);
            }
            $arquivos[] = $item;
        }
        return $arquivos;
    }

    /** @param list<array{chave: ?string}> $arquivos */
    private static function descartar(array $arquivos): void
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

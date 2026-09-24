<?php
declare(strict_types=1);

namespace OmniChannel\Instalacao;

use OmniChannel\Auth\Atendentes;
use OmniChannel\Auth\Senhas;
use OmniChannel\Banco\Banco;
use OmniChannel\Banco\Esquema;
use OmniChannel\Nucleo\Config;
use OmniChannel\Nucleo\Datas;
use OmniChannel\Nucleo\Json;
use OmniChannel\Nucleo\Texto;

/**
 * Base inicial, equivalente a scripts/seed.py:
 *   admin@multfiscal.com.br (senha informada, padrão admin123) e
 *   ana@multfiscal.com.br / ana12345, os quatro canais, etiquetas e
 *   respostas rápidas; com $demo, três conversas de exemplo.
 *
 * Só age em base vazia (nenhum atendente): rodar de novo não duplica nada.
 * Chamado pelo console (php console.php semear [--demo]) e pelo instalador.
 */
final class Seed
{
    public const EMAIL_ADMIN = 'admin@multfiscal.com.br';
    public const EMAIL_ATENDENTE = 'ana@multfiscal.com.br';
    public const SENHA_ATENDENTE = 'ana12345';

    private const CANAIS = [
        ['WhatsApp Suporte', 'whatsapp'],
        ['Telegram Suporte', 'telegram'],
        ['suporte@multfiscal', 'email'],
        ['Chat do site', 'webchat'],
    ];

    private const ETIQUETAS = [
        ['dúvida fiscal', '#3b82f6'],
        ['instalação', '#8b5cf6'],
        ['financeiro', '#10b981'],
        ['bug', '#ef4444'],
        ['urgente', '#f59e0b'],
    ];

    private const RESPOSTAS = [
        ['bomdia', 'Saudação', 'Bom dia! Aqui é o suporte MultFiscal. Como posso ajudar?'],
        ['versao', 'Versão atual', 'A versão mais recente é a 0.8.7.2. Você atualiza pelo próprio sistema, em Configurações → Atualizações.'],
        ['senha', 'Redefinição de senha', 'A troca de senha fica em Configurações → Acesso → "Alterar minha senha". Se você esqueceu a senha, só o suporte redefine — me confirme o CNPJ da empresa.'],
        ['aguarde', 'Pedir um instante', 'Só um instante, por favor, já verifico isso para você.'],
    ];

    /**
     * Roteiro das conversas de exemplo: canal, identificador, nome, pergunta, resposta.
     * Número e endereço fictícios (faixa 5500 9..., domínio .example), para
     * que um teste com credencial real nunca atinja ninguém.
     */
    private const ROTEIRO = [
        ['whatsapp', '5500912345678', 'Ian Dantas', 'Bom dia! O DIFAL do Rio está saindo com base dupla, isso está certo?',
            'Bom dia, Ian! Está correto: o RJ já vem cadastrado com antecipação por base dupla na aba CÁLCULO DE ICMS.'],
        ['telegram', '884412', 'Marcos Contabilidade', 'Consigo cadastrar a regra de um estado que não está na lista?',
            'Consegue sim: CÁLCULO DE ICMS → guia de base única × dupla → clique na sigla da UF e em "Ajustar esta UF".'],
        ['email', 'financeiro@loja.example', 'Financeiro Loja Exemplo', 'Preciso da segunda via do boleto da licença deste mês.', null],
    ];

    /**
     * @return array{criada: bool, mensagem: string, chave_webchat: ?string}
     */
    public static function semear(bool $demo = false, ?string $senhaAdmin = null): array
    {
        Esquema::aplicar();
        if ((int) Banco::valor('SELECT COUNT(*) FROM atendentes') > 0) {
            return ['criada' => false, 'mensagem' => 'Base já inicializada; nada a fazer.', 'chave_webchat' => null];
        }
        $senhaAdmin = $senhaAdmin ?? (getenv('OMNI_SENHA_ADMIN') ?: 'admin123');

        return Banco::transacao(static function () use ($demo, $senhaAdmin): array {
            $agora = Datas::agoraBanco();
            Banco::inserir('atendentes', [
                'nome' => 'Administrador', 'email' => self::EMAIL_ADMIN, 'senha_hash' => Senhas::gerarHash($senhaAdmin),
                'papel' => Atendentes::PAPEL_ADMIN, 'ativo' => true, 'disponivel' => true, 'setor' => null, 'criado_em' => $agora,
            ]);
            $anaId = Banco::inserir('atendentes', [
                'nome' => 'Ana Suporte', 'email' => self::EMAIL_ATENDENTE, 'senha_hash' => Senhas::gerarHash(self::SENHA_ATENDENTE),
                'papel' => Atendentes::PAPEL_ATENDENTE, 'ativo' => true, 'disponivel' => true, 'setor' => 'Suporte técnico',
                'criado_em' => $agora,
            ]);

            $canais = [];
            $chaveWebchat = null;
            foreach (self::CANAIS as [$nome, $tipo]) {
                // mesma regra do cadastro pela API: só o webchat tem chave
                // pública e só o Telegram tem segredo gerado por nós (o
                // WhatsApp é assinado pela Meta com o App Secret dela)
                $chave = $tipo === 'webchat' ? Texto::gerarChave('wc_') : null;
                $canais[$tipo] = [
                    'id' => Banco::inserir('canais', [
                        'nome' => $nome, 'tipo' => $tipo, 'ativo' => true, 'credenciais' => Json::objeto([]),
                        'chave_publica' => $chave,
                        'segredo_webhook' => $tipo === 'telegram' ? Texto::gerarChave() : null,
                        'criado_em' => $agora,
                    ]),
                    'nome' => $nome,
                ];
                $chaveWebchat = $chave ?? $chaveWebchat;
            }
            foreach (self::ETIQUETAS as [$nome, $cor]) {
                Banco::inserir('etiquetas', ['nome' => $nome, 'cor' => $cor]);
            }
            foreach (self::RESPOSTAS as [$atalho, $titulo, $conteudo]) {
                Banco::inserir('respostas_rapidas', ['atalho' => $atalho, 'titulo' => $titulo, 'conteudo' => $conteudo, 'criada_em' => $agora]);
            }

            if ($demo) {
                $ana = Atendentes::porId($anaId);
                foreach (self::ROTEIRO as [$tipo, $identificador, $nome, $pergunta, $resposta]) {
                    self::conversaDeExemplo($canais[$tipo], $tipo, $identificador, $nome, $pergunta, $resposta, $ana);
                }
            }

            $senhaExibida = getenv('OMNI_SENHA_ADMIN') ? '(a de OMNI_SENHA_ADMIN)' : $senhaAdmin;
            return [
                'criada' => true,
                'mensagem' => "Base criada.\n  admin: " . self::EMAIL_ADMIN . " / {$senhaExibida}\n  atendente: "
                    . self::EMAIL_ATENDENTE . ' / ' . self::SENHA_ATENDENTE . "\n  chave pública do webchat: {$chaveWebchat}",
                'chave_webchat' => $chaveWebchat,
            ];
        });
    }

    /**
     * Reproduz o que registrar_entrada + enviar_mensagem fazem no Python para
     * uma conversa nova, sem depender dos serviços de mensagens (que vêm em
     * outra etapa do porte). Canais sem credencial: resposta "simulada" no
     * sandbox, "falhou" fora dele — exatamente como o adaptador faria.
     *
     * @param array{id: int, nome: string} $canal
     * @param array<string, mixed>|null $atendente
     */
    private static function conversaDeExemplo(
        array $canal,
        string $tipo,
        string $identificador,
        string $nome,
        string $pergunta,
        ?string $resposta,
        ?array $atendente,
    ): void {
        $agora = Datas::agoraBanco();
        // mesma normalização do resolver_contato do Python
        $identificador = match ($tipo) {
            'whatsapp' => Texto::normalizarTelefone($identificador),
            'email' => mb_strtolower(trim($identificador)),
            default => trim($identificador),
        };
        $contatoId = Banco::inserir('contatos', [
            'nome' => $nome,
            'telefone' => $tipo === 'whatsapp' ? Texto::normalizarTelefone($identificador) : null,
            'email' => $tipo === 'email' ? mb_strtolower($identificador) : null,
            'criado_em' => $agora, 'atualizado_em' => $agora,
        ]);
        Banco::inserir('contato_identidades', [
            'contato_id' => $contatoId, 'canal_tipo' => $tipo, 'identificador' => $identificador,
            'nome_exibicao' => $nome, 'criado_em' => $agora,
        ]);

        $responsavel = self::proximoAtendente();
        $conversaId = Banco::inserir('conversas', [
            'contato_id' => $contatoId, 'canal_id' => $canal['id'], 'atendente_id' => $responsavel['id'] ?? null,
            'status' => 'aberta', 'prioridade' => 'normal', 'nao_lidas' => 1, 'previa' => Texto::resumir($pergunta, 180),
            'criada_em' => $agora, 'atualizada_em' => $agora, 'ultima_mensagem_em' => $agora,
        ]);
        if ($responsavel !== null) {
            Banco::inserir('eventos', [
                'conversa_id' => $conversaId, 'atendente_id' => null, 'tipo' => 'conversa.atribuida',
                'descricao' => "Atribuida automaticamente a {$responsavel['nome']}", 'criado_em' => $agora,
            ]);
        }
        Banco::inserir('mensagens', [
            'conversa_id' => $conversaId, 'direcao' => 'entrada', 'tipo' => 'texto', 'conteudo' => $pergunta,
            'status' => 'recebida', 'metadados' => Json::objeto([]), 'criada_em' => $agora,
        ]);

        if ($resposta === null || $atendente === null) {
            return;
        }
        $sandbox = Config::obter()->modo_sandbox;
        $enviada = Datas::agoraBanco();
        Banco::inserir('mensagens', [
            'conversa_id' => $conversaId, 'direcao' => 'saida', 'tipo' => 'texto', 'conteudo' => $resposta,
            'status' => $sandbox ? 'simulada' : 'falhou',
            'erro' => $sandbox ? null : "canal {$canal['nome']} sem credenciais configuradas",
            'atendente_id' => $atendente['id'], 'metadados' => Json::objeto([]),
            'assinatura' => Json::codificar(Atendentes::assinatura($atendente)), 'criada_em' => $enviada,
        ]);
        $mudancas = ['previa' => Texto::resumir($resposta, 180), 'ultima_mensagem_em' => $enviada, 'atualizada_em' => $enviada];
        if ($sandbox) {
            $mudancas['primeira_resposta_em'] = $enviada;
        }
        Banco::atualizar('conversas', $mudancas, 'id = ?', [$conversaId]);
    }

    /** Menor fila primeiro, empate pelo id (app/servicos/distribuicao.py). @return array<string, mixed>|null */
    private static function proximoAtendente(): ?array
    {
        if (!Config::obter()->distribuicao_automatica) {
            return null;
        }
        return Banco::um(
            "SELECT a.id, a.nome FROM atendentes a
             LEFT JOIN (SELECT atendente_id, COUNT(id) AS total FROM conversas
                        WHERE status <> 'resolvida' GROUP BY atendente_id) c ON c.atendente_id = a.id
             WHERE a.ativo = 1 AND a.disponivel = 1
             ORDER BY COALESCE(c.total, 0) ASC, a.id ASC
             LIMIT 1"
        );
    }
}

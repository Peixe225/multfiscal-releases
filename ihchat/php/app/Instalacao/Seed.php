<?php
declare(strict_types=1);

namespace IHchat\Instalacao;

use IHchat\Atendimento\Adaptadores;
use IHchat\Atendimento\MensagemRecebida;
use IHchat\Atendimento\Mensagens;
use IHchat\Auth\Atendentes;
use IHchat\Auth\Senhas;
use IHchat\Banco\Banco;
use IHchat\Banco\Esquema;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\Json;
use IHchat\Nucleo\Texto;

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
        $senhaAdmin = $senhaAdmin ?? (getenv('IHCHAT_SENHA_ADMIN') ?: 'admin123');

        $saida = Banco::transacao(static function () use ($senhaAdmin): array {
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
                // pública; Telegram e e-mail têm segredo gerado por nós (o
                // secret_token do setWebhook e o token do webhook de e-mail).
                // O WhatsApp é assinado pela Meta com o App Secret dela
                $chave = $tipo === 'webchat' ? Texto::gerarChave('wc_') : null;
                $canais[$tipo] = Banco::inserir('canais', [
                    'nome' => $nome, 'tipo' => $tipo, 'ativo' => true, 'credenciais' => Json::objeto([]),
                    'chave_publica' => $chave,
                    'segredo_webhook' => in_array($tipo, ['telegram', 'email'], true) ? Texto::gerarChave() : null,
                    'criado_em' => $agora,
                ]);
                $chaveWebchat = $chave ?? $chaveWebchat;
            }
            foreach (self::ETIQUETAS as [$nome, $cor]) {
                Banco::inserir('etiquetas', ['nome' => $nome, 'cor' => $cor]);
            }
            foreach (self::RESPOSTAS as [$atalho, $titulo, $conteudo]) {
                Banco::inserir('respostas_rapidas', ['atalho' => $atalho, 'titulo' => $titulo, 'conteudo' => $conteudo, 'criada_em' => $agora]);
            }

            $senhaExibida = getenv('IHCHAT_SENHA_ADMIN') ? '(a de IHCHAT_SENHA_ADMIN)' : $senhaAdmin;
            return [
                'criada' => true,
                'mensagem' => "Base criada.\n  admin: " . self::EMAIL_ADMIN . " / {$senhaExibida}\n  atendente: "
                    . self::EMAIL_ATENDENTE . ' / ' . self::SENHA_ATENDENTE . "\n  chave pública do webchat: {$chaveWebchat}",
                'chave_webchat' => $chaveWebchat,
                'canais' => $canais,
                'ana' => $anaId,
            ];
        });

        if ($demo) {
            // depois da base confirmada, pelos MESMOS serviços que atendem os
            // webhooks e o painel (como o scripts/seed.py): contato, conversa,
            // distribuição e assinatura saem exatamente como numa conversa real
            $ana = Atendentes::porId($saida['ana']);
            foreach (self::ROTEIRO as [$tipo, $identificador, $nome, $pergunta, $resposta]) {
                self::conversaDeExemplo($saida['canais'][$tipo], $identificador, $nome, $pergunta, $resposta, $ana);
            }
        }
        unset($saida['canais'], $saida['ana']);
        return $saida;
    }

    /**
     * Uma conversa de exemplo: o cliente escreve e, se houver resposta, a Ana
     * responde. Canais sem credencial: "simulada" no sandbox, "falhou" fora
     * dele — exatamente como numa conversa real. Sem eventos de tempo real
     * (ninguém está olhando) e sem marcar como lida: fica na caixa como nova.
     *
     * @param array<string, mixed>|null $atendente
     */
    private static function conversaDeExemplo(
        int $canalId,
        string $identificador,
        string $nome,
        string $pergunta,
        ?string $resposta,
        ?array $atendente,
    ): void {
        $canal = Adaptadores::canal($canalId) ?? throw new \RuntimeException("canal {$canalId} sumiu");
        $entrada = Mensagens::registrarEntrada(
            $canal,
            new MensagemRecebida(identificador: $identificador, conteudo: $pergunta, nome_exibicao: $nome),
            publicar: false,
        );
        if ($entrada === null || $resposta === null || $atendente === null) {
            return;
        }
        Mensagens::enviarMensagem((int) $entrada['conversa_id'], $resposta, $atendente, publicar: false, marcarLida: false);
    }
}

<?php
declare(strict_types=1);

namespace IHchat\Canais;

use IHchat\Nucleo\Config;

/**
 * Campos de credencial de cada tipo de canal (app/canais/campos.py).
 *
 * É o contrato entre a tela de canais do painel e os adaptadores: a tela monta
 * o formulário a partir daqui, e a API usa `secreto` para nunca devolver o
 * valor de uma senha ou token ao navegador — só se ele está preenchido.
 */
final class Campos
{
    public const WHATSAPP = 'whatsapp';
    /** WhatsApp comum pelo QR Code, com a sessão num provedor online (AdaptadorWhatsAppQr). */
    public const WHATSAPP_QR = 'whatsapp_qr';
    public const TELEGRAM = 'telegram';
    public const EMAIL = 'email';
    public const WEBCHAT = 'webchat';
    public const TIPOS = [self::WHATSAPP, self::WHATSAPP_QR, self::TELEGRAM, self::EMAIL, self::WEBCHAT];

    /**
     * Para onde vai cada senha guardada: [senhas na ordem em que o adaptador as
     * usa, campos que escolhem o servidor]. Sem isto, trocar só o host e clicar
     * em "Testar" entregava a senha guardada a um servidor qualquer. O IMAP entra
     * com a senha do SMTP quando não tem a sua, por isso ela aparece nas duas.
     */
    public const DESTINOS_DOS_SEGREDOS = [
        self::EMAIL => [
            [['smtp_senha'], ['smtp_host', 'smtp_porta', 'smtp_usuario']],
            [['imap_senha', 'smtp_senha'], ['imap_host', 'imap_porta', 'imap_usuario']],
        ],
        // a API key da Evolution vai para o servidor que o admin escreveu; a da
        // Z-API vai sempre para api.z-api.io, então não tem destino a proteger
        self::WHATSAPP_QR => [
            [['api_key'], ['url_servidor']],
        ],
    ];

    /**
     * @return array<string, list<array{chave: string, rotulo: string, secreto: bool, obrigatorio: bool, ajuda: string, padrao: string, opcoes: list<string>}>>
     */
    public static function todos(): array
    {
        return [
            self::WHATSAPP => [
                self::campo('token', 'Token de acesso permanente', secreto: true, obrigatorio: true,
                    ajuda: 'Meta for Developers → WhatsApp → Configuração da API'),
                self::campo('id_numero', 'ID do número de telefone', obrigatorio: true,
                    ajuda: "Não é o número em si: é o 'Phone number ID' da mesma tela"),
                self::campo('token_verificacao', 'Token de verificação do webhook',
                    ajuda: 'Qualquer texto; repita-o no cadastro do webhook na Meta'),
                // a Meta assina os webhooks com o App Secret do app dela; não é
                // um segredo que este sistema possa escolher ou gerar
                self::campo('segredo_app', 'App Secret (valida a assinatura)', secreto: true,
                    ajuda: 'Meta for Developers → Configurações do app → Básico → Chave secreta do app'),
            ],
            // WhatsApp comum pelo QR Code: a sessão fica num provedor online.
            // Quais campos valem depende do provedor (o painel mostra só os
            // dele); por isso só o provedor é obrigatório aqui, e o adaptador
            // diz o resto (AdaptadorWhatsAppQr::camposObrigatorios)
            self::WHATSAPP_QR => [
                self::campo('provedor', 'Provedor da conexão', obrigatorio: true, padrao: 'zapi',
                    opcoes: ['zapi', 'evolution'],
                    ajuda: 'Z-API: serviço online pago, nada para instalar. Evolution API: software livre, '
                        . 'num servidor seu (a VPS)'),
                self::campo('instancia_id', 'ID da instância (Z-API)',
                    ajuda: 'Painel da Z-API → Instâncias → a sua instância → ID'),
                self::campo('instancia_token', 'Token da instância (Z-API)', secreto: true,
                    ajuda: 'Na mesma tela do ID da instância'),
                self::campo('client_token', 'Client-Token da conta (Z-API)', secreto: true,
                    ajuda: 'Painel da Z-API → Segurança → Token de segurança da conta. '
                        . 'Obrigatório se você ativou esse token'),
                self::campo('url_servidor', 'Endereço do servidor Evolution',
                    ajuda: 'Ex.: https://evolution.suaempresa.com.br'),
                self::campo('api_key', 'API key (Evolution)', secreto: true,
                    ajuda: 'A AUTHENTICATION_API_KEY do servidor: com ela o IHchat cria a instância sozinho'),
                self::campo('nome_instancia', 'Nome da instância (Evolution)',
                    ajuda: 'Um nome sem espaços, ex.: ihchat-suporte. Se não existir, é criada no primeiro QR Code'),
            ],
            self::TELEGRAM => [
                self::campo('token', 'Token do bot', secreto: true, obrigatorio: true,
                    ajuda: 'Fale com @BotFather no Telegram, envie /newbot e cole o token aqui'),
                self::campo('modo_recebimento', 'Como receber mensagens', padrao: self::modoTelegramPadrao(),
                    opcoes: ['polling', 'webhook'],
                    ajuda: "'polling' funciona até no seu computador, sem endereço público. "
                        . "'webhook' exige uma URL pública apontada para este servidor"),
            ],
            self::EMAIL => [
                self::campo('remetente', 'Remetente', obrigatorio: true, ajuda: 'Ex.: Suporte <suporte@empresa.com.br>'),
                self::campo('smtp_host', 'Servidor SMTP', obrigatorio: true),
                self::campo('smtp_porta', 'Porta SMTP', padrao: '587', ajuda: '587 (STARTTLS) ou 465 (SSL)'),
                self::campo('smtp_usuario', 'Usuário SMTP', obrigatorio: true),
                self::campo('smtp_senha', 'Senha SMTP', secreto: true, obrigatorio: true),
                self::campo('imap_host', 'Servidor IMAP', ajuda: 'Para receber: a caixa é lida a cada minuto'),
                self::campo('imap_usuario', 'Usuário IMAP', ajuda: 'Em branco: usa o do SMTP'),
                self::campo('imap_senha', 'Senha IMAP', secreto: true, ajuda: 'Em branco: usa a do SMTP'),
            ],
            self::WEBCHAT => [],
        ];
    }

    /**
     * Com endereço público HTTPS (a hospedagem), o Telegram recebe por webhook:
     * é instantâneo e não depende do cron. Sem ele (desenvolvimento, testes),
     * só o polling funciona — o mesmo padrão do app Python.
     */
    public static function modoTelegramPadrao(): string
    {
        try {
            $url = Config::obter()->url_publica;
        } catch (\Throwable) {
            $url = '';
        }
        return str_starts_with(strtolower($url), 'https://') ? 'webhook' : 'polling';
    }

    /** @return list<array<string, mixed>> */
    public static function de(string $tipo): array
    {
        return self::todos()[$tipo] ?? [];
    }

    /** @return array<string, mixed>|null */
    public static function campoDe(string $tipo, string $chave): ?array
    {
        foreach (self::de($tipo) as $campo) {
            if ($campo['chave'] === $chave) {
                return $campo;
            }
        }
        return null;
    }

    /**
     * Chave secreta? Fora do contrato (gravada à mão, via curl), vale a cara
     * do nome: na dúvida, é tratada como senha e nunca volta ao navegador.
     */
    public static function eSecreta(string $tipo, string $chave): bool
    {
        $campo = self::campoDe($tipo, $chave);
        if ($campo !== null) {
            return $campo['secreto'];
        }
        return preg_match('/senha|segredo|secret|token|password/i', $chave) === 1;
    }

    /** Como o formulário chama o campo: é o nome que o admin reconhece no erro. */
    public static function rotulo(string $tipo, string $chave): string
    {
        $campo = self::campoDe($tipo, $chave);
        if ($campo !== null) {
            return $campo['rotulo'];
        }
        return $chave === 'imap_porta' ? 'Porta IMAP' : $chave;
    }

    /** Campos que, mudados, exigem digitar `segredo` de novo (vai para /tipos). @return list<string> */
    public static function destinosDe(string $tipo, string $segredo): array
    {
        $destinos = [];
        foreach (self::DESTINOS_DOS_SEGREDOS[$tipo] ?? [] as [$segredos, $campos]) {
            if ($segredos[0] === $segredo) {
                array_push($destinos, ...$campos);
            }
        }
        return $destinos;
    }

    /**
     * @param list<string> $opcoes
     * @return array{chave: string, rotulo: string, secreto: bool, obrigatorio: bool, ajuda: string, padrao: string, opcoes: list<string>}
     */
    private static function campo(
        string $chave,
        string $rotulo,
        bool $secreto = false,
        bool $obrigatorio = false,
        string $ajuda = '',
        string $padrao = '',
        array $opcoes = [],
    ): array {
        return compact('chave', 'rotulo', 'secreto', 'obrigatorio', 'ajuda', 'padrao', 'opcoes');
    }
}

<?php
declare(strict_types=1);

namespace OmniChannel\Canais;

use OmniChannel\Atendimento\AnexoRecebido;
use OmniChannel\Atendimento\Anexos;
use OmniChannel\Atendimento\MensagemRecebida;
use OmniChannel\Atendimento\ResultadoEnvio;
use OmniChannel\Canais\Email\ErroConexao;
use OmniChannel\Canais\Email\ErroImap;
use OmniChannel\Canais\Email\ErroSmtp;
use OmniChannel\Canais\Email\Imap;
use OmniChannel\Canais\Email\Mime;
use OmniChannel\Canais\Email\Smtp;
use OmniChannel\Nucleo\Log;
use OmniChannel\Nucleo\Texto;

/**
 * Canal de e-mail (app/canais/email.py): envia por SMTP e recebe por IMAP
 * (cron a cada minuto) ou pelo webhook genérico de provedores (JSON ou
 * formulário), protegido pelo segredo do canal.
 *
 * A resposta sai com o assunto original prefixado por "Re:" e com
 * In-Reply-To/References, para o cliente de e-mail do contato manter a thread.
 */
final class AdaptadorEmail extends Adaptador
{
    public const TIPO = Campos::EMAIL;
    public const CAMPOS_OBRIGATORIOS = ['smtp_host', 'smtp_usuario', 'smtp_senha', 'remetente'];

    public const LIMITE_COLETA = 25;
    /** O admin espera olhando para a tela: melhor um erro claro em 10 s que a roda girando. */
    public const TEMPO_VERIFICACAO = 10.0;
    public const TEMPO_ENVIO = 20.0;

    /** Conexão IMAP aberta pela coleta em andamento. */
    private ?Imap $imapAberto = null;

    // ------------------------------------------------------------------ estado

    /** A API já recusa porta inválida; isto cobre o que foi gravado antes dela. */
    private function porta(string $campo, int $padrao): int
    {
        $valor = $this->credenciais[$campo] ?? null;
        if ($valor === null || $valor === '' || $valor === false) {
            return $padrao;
        }
        $porta = (is_int($valor) || (is_string($valor) && preg_match('/^\s*[+-]?\d+\s*$/', $valor) === 1)) ? (int) $valor : 0;
        if ($porta < 1 || $porta > 65535) {
            $exibido = is_string($valor) ? "'{$valor}'" : (is_scalar($valor) ? (string) $valor : '?');
            throw new ErroCanal(Campos::rotulo(self::TIPO, $campo) . " inválida: {$exibido}; use um número, ex.: {$padrao}");
        }
        return $porta;
    }

    /**
     * Entra no SMTP e, se houver, no IMAP, sem enviar nem ler nada. Cada erro
     * diz a etapa (conexão, STARTTLS, login): cada uma tem um culpado diferente.
     */
    public function verificarConexao(): string
    {
        if (!$this->configurado()) {
            return parent::verificarConexao();
        }
        $feito = [$this->verificarSmtp()];
        if ($this->preenchido('imap_host')) {
            $feito[] = $this->verificarImap();
        } else {
            $feito[] = 'sem servidor IMAP, a caixa não é lida: e-mails só chegam pelo webhook do provedor';
        }
        return implode('; ', $feito);
    }

    private function verificarSmtp(): string
    {
        $host = $this->credencial('smtp_host');
        $porta = $this->porta('smtp_porta', 587);
        $smtp = new Smtp($host, $porta, self::TEMPO_VERIFICACAO);
        try {
            $smtp->entrar($this->credencial('smtp_usuario'), $this->credencial('smtp_senha'));
        } catch (ErroSmtp $erro) {
            if ($smtp->etapa === 'entrar no SMTP') {
                throw new ErroCanal("o servidor SMTP recusou o usuário e a senha: {$erro->getMessage()}");
            }
            throw new ErroCanal($this->falhaNaEtapa($smtp->etapa, $erro->getMessage()));
        } catch (ErroConexao $erro) {
            if ($erro->certificado) {
                throw self::erroDeCertificado('SMTP', $host, $erro);
            }
            throw new ErroCanal($this->falhaNaEtapa($smtp->etapa, $erro->getMessage()));
        } finally {
            $smtp->sair();
        }
        return "SMTP ok (login em {$host}:{$porta} com {$smtp->seguranca()})";
    }

    private function falhaNaEtapa(string $etapa, string $motivo): string
    {
        // quem usa SSL direto e esquece a porta 465 cai aqui, no STARTTLS
        $dica = str_contains($etapa, 'STARTTLS') ? ' (servidor com SSL direto usa a porta 465)' : '';
        return "falha ao {$etapa}: {$this->semSegredos($motivo)}{$dica}";
    }

    private static function erroDeCertificado(string $servico, string $host, ErroConexao $erro): ErroCanal
    {
        $motivo = $erro->motivoCertificado !== '' ? $erro->motivoCertificado : $erro->getMessage();
        return new ErroCanal(
            "o certificado TLS do servidor {$servico} {$host} não é válido ({$motivo}); a senha não "
            . 'foi enviada. Confira o endereço do servidor: é preciso o nome que consta no certificado'
        );
    }

    /** @return array{0: string, 1: string} usuário e senha do IMAP (os do SMTP quando em branco) */
    private function loginImap(): array
    {
        $usuario = $this->preenchido('imap_usuario') ? $this->credencial('imap_usuario') : $this->credencial('smtp_usuario');
        $senha = $this->preenchido('imap_senha') ? $this->credencial('imap_senha') : $this->credencial('smtp_senha');
        return [$usuario, $senha];
    }

    private function verificarImap(): string
    {
        $host = $this->credencial('imap_host');
        $porta = $this->porta('imap_porta', 993);
        $imap = new Imap($host, $porta, self::TEMPO_VERIFICACAO);
        try {
            $imap->entrar(...$this->loginImap());
        } catch (ErroImap $erro) {
            if ($imap->etapa === 'entrar no IMAP') {
                throw new ErroCanal("o servidor IMAP recusou o usuário e a senha: {$erro->getMessage()}");
            }
            throw new ErroCanal("falha ao {$imap->etapa}: {$erro->getMessage()}");
        } catch (ErroConexao $erro) {
            if ($erro->certificado) {
                throw self::erroDeCertificado('IMAP', $host, $erro);
            }
            throw new ErroCanal("falha ao {$imap->etapa}: {$this->semSegredos($erro->getMessage())}");
        } finally {
            $imap->sair();
        }
        return "IMAP ok (login em {$host}:{$porta})";
    }

    /** A caixa de onde este canal lê: duas leituras da mesma caixa dividiriam os e-mails. */
    public function chaveColeta(): ?string
    {
        if (!$this->preenchido('imap_host')) {
            return null;
        }
        [$usuario] = $this->loginImap();
        return 'email:' . substr(hash('sha256', strtolower($this->credencial('imap_host') . '|' . $usuario)), 0, 16);
    }

    // ---------------------------------------------------------------- entrada

    /**
     * O webhook genérico de e-mail exige o segredo do canal (gerado no
     * cadastro, em segredo_webhook), no cabeçalho X-Omni-Token ou em ?token=
     * na URL cadastrada no provedor. Sem ele, qualquer um que achasse a URL
     * (ids são sequenciais) punha mensagens na ficha de um cliente real,
     * com o e-mail dele, e a resposta do atendente ia para o cliente de verdade.
     * Canal sem segredo recusa tudo.
     */
    public function verificarAssinatura(string $corpo, array $cabecalhos): bool
    {
        $segredo = $this->canal['segredo_webhook'] ?? null;
        $enviado = $cabecalhos['x-omni-token'] ?? '';
        if (!is_string($segredo) || $segredo === '' || $enviado === '') {
            return false;
        }
        return hash_equals($segredo, $enviado);
    }

    /**
     * Formato genérico de provedores: JSON, ou os campos do formulário do
     * SendGrid Inbound Parse (from, text, subject, headers) e das rotas do
     * Mailgun (sender, body-plain, stripped-text, Message-Id).
     */
    public function analisarWebhook(array $payload): array
    {
        $remetente = self::texto($payload['from'] ?? null) ?? self::texto($payload['sender'] ?? null) ?? '';
        [$nome, $endereco] = Mime::endereco(Mime::decodificarCabecalho($remetente));
        $endereco = mb_strtolower($endereco);
        $texto = self::texto($payload['text'] ?? null) ?? self::texto($payload['body-plain'] ?? null)
            ?? self::texto($payload['stripped-text'] ?? null) ?? '';
        if ($endereco === '' || $texto === '') {
            return [];
        }
        $messageId = self::texto($payload['message-id'] ?? null) ?? self::texto($payload['Message-Id'] ?? null)
            ?? self::messageIdDosCabecalhos(self::texto($payload['headers'] ?? null));
        return [new MensagemRecebida(
            identificador: $endereco,
            conteudo: trim($texto),
            nome_exibicao: $nome !== '' ? $nome : $endereco,
            externo_id: $this->prefixarNoCanal($messageId),
            assunto: self::texto($payload['subject'] ?? null),
        )];
    }

    /**
     * Entrega em formulário (multipart ou urlencoded), como a do SendGrid e a
     * do Mailgun: os campos viram o payload de analisarWebhook, e os arquivos
     * (attachment1, attachment-1...) viram anexos da mensagem.
     *
     * @param array<string, mixed> $campos
     * @param array<string, \OmniChannel\Nucleo\ArquivoEnviado> $arquivos
     * @return list<MensagemRecebida>
     */
    public function analisarFormulario(array $campos, array $arquivos): array
    {
        $anexos = [];
        foreach ($arquivos as $arquivo) {
            if ($arquivo->ok() && $arquivo->tamanho > 0) {
                $anexos[] = new AnexoRecebido(
                    nome: $arquivo->nome !== '' ? $arquivo->nome : 'arquivo',
                    dados: $arquivo->dados(),
                    tipo_conteudo: $arquivo->tipoInformado !== '' ? $arquivo->tipoInformado : null,
                );
            }
        }
        $saida = [];
        foreach ($this->analisarWebhook($campos) as $recebida) {
            $saida[] = $anexos === [] ? $recebida : new MensagemRecebida(
                identificador: $recebida->identificador,
                conteudo: $recebida->conteudo,
                nome_exibicao: $recebida->nome_exibicao,
                externo_id: $recebida->externo_id,
                assunto: $recebida->assunto,
                metadados: $recebida->metadados,
                anexos: $anexos,
            );
        }
        return $saida;
    }

    /** Message-ID de um bloco de cabeçalhos crus (o campo "headers" do SendGrid). */
    private static function messageIdDosCabecalhos(?string $cabecalhos): ?string
    {
        if ($cabecalhos === null) {
            return null;
        }
        [$campos] = Mime::separar($cabecalhos);
        $id = trim($campos['message-id'] ?? '');
        return $id !== '' ? $id : null;
    }

    /**
     * Tamanho máximo de um e-mail que a coleta baixa: o limite de anexo em
     * base64 (4/3, mais as quebras de linha) e uma folga para o texto. Acima
     * disso o anexo seria recusado de qualquer jeito, e ler a mensagem inteira
     * só serviria para estourar a memória do cron.
     */
    public static function tamanhoMaximoColeta(): int
    {
        return intdiv(Anexos::limiteBytes() * 14, 10) + 1024 * 1024;
    }

    /**
     * Busca os não lidos por IMAP, UMA MENSAGEM POR VEZ: cada uma é baixada,
     * entregue a quem grava e só então marcada como lida (o código depois do
     * `yield` roda quando o Coletor pede a próxima, com a anterior já gravada).
     * Assim a memória do cron tem o tamanho de um e-mail, não do lote, e uma
     * falha no meio não perde nada nem trava a caixa: o que foi gravado já
     * está marcado, e o resto volta na próxima coleta.
     *
     * @return iterable<MensagemRecebida>
     */
    public function coletar(): iterable
    {
        if (!$this->preenchido('imap_host')) {
            return [];
        }
        $host = $this->credencial('imap_host');
        $porta = $this->porta('imap_porta', 993);
        $this->fecharImap();
        $imap = new Imap($host, $porta, self::TEMPO_ENVIO);
        try {
            $imap->entrar(...$this->loginImap());
            $pasta = $this->preenchido('imap_pasta') ? $this->credencial('imap_pasta') : 'INBOX';
            $imap->selecionar($pasta);
            $uids = array_slice($imap->naoLidas(), 0, self::LIMITE_COLETA);
            $tamanhos = $uids === [] ? [] : $imap->tamanhos($uids);
        } catch (ErroConexao|ErroImap $erro) {
            $imap->sair();
            throw $this->erroDeLeitura($host, $erro);
        }
        $this->imapAberto = $imap;
        return $this->percorrer($imap, $host, $uids, $tamanhos);
    }

    /**
     * @param list<int> $uids
     * @param array<int, int> $tamanhos
     * @return \Generator<int, MensagemRecebida>
     */
    private function percorrer(Imap $imap, string $host, array $uids, array $tamanhos): \Generator
    {
        $maximo = self::tamanhoMaximoColeta();
        foreach ($uids as $uid) {
            try {
                [$existe, $recebida] = $this->lerUma($imap, $uid, $tamanhos[$uid] ?? null, $maximo);
            } catch (ErroConexao|ErroImap $erro) {
                $this->fecharImap();
                throw $this->erroDeLeitura($host, $erro);
            }
            if (!$existe) {
                continue; // apagada entre a busca e o download
            }
            if ($recebida !== null) {
                yield $recebida;
            }
            // chegou aqui: a mensagem foi gravada (ou descartada de vez, por defeito
            // de dado), então pode sair da lista de não lidos
            unset($recebida);
            try {
                $imap->marcarLidas([$uid]);
            } catch (ErroConexao|ErroImap $erro) {
                // não marcou: volta na próxima coleta e morre na deduplicação
                Log::aviso('e-mail gravado mas não marcado como lido', ['motivo' => $erro->getMessage()]);
                $this->fecharImap();
                return;
            }
        }
    }

    /**
     * Baixa e traduz uma mensagem. Devolve [false, null] se ela sumiu e
     * [true, null] se não vira mensagem (sem remetente, mal formada).
     *
     * @return array{0: bool, 1: ?MensagemRecebida}
     * @throws ErroConexao|ErroImap
     */
    private function lerUma(Imap $imap, int $uid, ?int $tamanho, int $maximo): array
    {
        $canal = $this->canal['id'] ?? '?';
        if ($tamanho !== null && $tamanho > $maximo) {
            $cabecalhos = $imap->cabecalhos($uid);
            if ($cabecalhos === null || $cabecalhos === '') {
                return [false, null];
            }
            Log::aviso("e-mail {$uid} do canal {$canal} acima do limite: não baixado", ['bytes' => $tamanho]);
            return [true, $this->avisoDeGrande($cabecalhos, $tamanho)];
        }
        $bruto = $imap->buscar($uid);
        if ($bruto === null || $bruto === '') {
            return [false, null];
        }
        try {
            return [true, $this->mensagemDe($bruto)];
        } catch (\Throwable $erro) {
            // uma mensagem mal formada não pode travar a caixa: fica no log
            Log::excecao($erro, "e-mail {$uid} do canal {$canal} ignorado");
            return [true, null];
        }
    }

    /**
     * O e-mail grande demais não some em silêncio: vira uma mensagem do
     * remetente avisando o atendente, que o abre direto na caixa.
     */
    private function avisoDeGrande(string $cabecalhos, int $tamanho): ?MensagemRecebida
    {
        [$campos] = Mime::separar($cabecalhos);
        [$nome, $endereco] = Mime::endereco(Mime::decodificarCabecalho($campos['from'] ?? ''));
        $endereco = mb_strtolower($endereco);
        if ($endereco === '' || !str_contains($endereco, '@')) {
            return null;
        }
        $messageId = isset($campos['message-id']) && $campos['message-id'] !== '' ? $campos['message-id'] : null;
        $assunto = Mime::decodificarCabecalho($campos['subject'] ?? '');
        $mb = static fn (float $bytes): string => str_replace('.', ',', (string) round($bytes / 1048576, 1));
        return new MensagemRecebida(
            identificador: $endereco,
            conteudo: '[e-mail de ' . $mb($tamanho) . ' MB, acima do limite de '
                . $mb(Anexos::limiteBytes()) . ' MB para anexos: não foi baixado. Abra-o direto na caixa de entrada]',
            nome_exibicao: $nome !== '' ? $nome : $endereco,
            externo_id: $this->prefixarNoCanal($messageId),
            assunto: $assunto !== '' ? Texto::resumir($assunto, 200) : null,
            metadados: ['referencias' => $messageId],
        );
    }

    private function erroDeLeitura(string $host, ErroConexao|ErroImap $erro): ErroCanal
    {
        if ($erro instanceof ErroConexao && $erro->certificado) {
            return self::erroDeCertificado('IMAP', $host, $erro);
        }
        return new ErroCanal('falha ao ler a caixa de entrada: ' . $this->semSegredos($erro->getMessage()));
    }

    /** Uma mensagem bruta (RFC 822) vira MensagemRecebida; null se não tem remetente. */
    public function mensagemDe(string $bruto): ?MensagemRecebida
    {
        $lida = Mime::ler($bruto);
        $cabecalhos = $lida['cabecalhos'];
        [$nome, $endereco] = Mime::endereco(Mime::decodificarCabecalho($cabecalhos['from'] ?? ''));
        $endereco = mb_strtolower($endereco);
        if ($endereco === '' || !str_contains($endereco, '@')) {
            return null;
        }
        $messageId = isset($cabecalhos['message-id']) && $cabecalhos['message-id'] !== '' ? $cabecalhos['message-id'] : null;
        $assunto = Mime::decodificarCabecalho($cabecalhos['subject'] ?? '');
        return new MensagemRecebida(
            identificador: $endereco,
            conteudo: trim($lida['texto']),
            nome_exibicao: $nome !== '' ? $nome : $endereco,
            // com o canal: o cliente que escreve para suporte@ e vendas@ manda o
            // mesmo Message-ID às duas caixas, e as duas precisam recebê-lo
            externo_id: $this->prefixarNoCanal($messageId),
            assunto: $assunto !== '' ? Texto::resumir($assunto, 200) : null,
            metadados: ['referencias' => $messageId],
            anexos: $lida['anexos'],
        );
    }

    /** Cada mensagem já foi marcada ao ser gravada; aqui só fecha a conexão. */
    public function confirmarColeta(): void
    {
        $this->fecharImap();
    }

    private function fecharImap(): void
    {
        $this->imapAberto?->sair();
        $this->imapAberto = null;
    }

    public function __destruct()
    {
        $this->fecharImap();
    }

    // ------------------------------------------------------------------ saída

    public function enviaArquivos(): bool
    {
        return true;
    }

    protected function enviarDeFato(string $destino, string $conteudo, array $contexto): ResultadoEnvio
    {
        $assunto = (string) ($contexto['assunto'] ?? '');
        if ($assunto === '') {
            $assunto = 'Atendimento';
        }
        if (!str_starts_with(mb_strtolower($assunto), 're:')) {
            $assunto = "Re: {$assunto}";
        }
        // ErroCanal, não exceção genérica: vira mensagem "falhou" com reenviar, não 500
        $porta = $this->porta('smtp_porta', 587);
        $host = $this->credencial('smtp_host');
        $remetente = $this->credencial('remetente');
        [, $enderecoRemetente] = Mime::endereco($remetente);
        [$bytes, $messageId] = Mime::montar(
            $remetente,
            $destino,
            Texto::resumir($assunto, 180),
            $conteudo,
            isset($contexto['referencia']) && is_string($contexto['referencia']) ? $contexto['referencia'] : null,
            $contexto['arquivos'] ?? [],
        );
        $smtp = new Smtp($host, $porta, self::TEMPO_ENVIO);
        try {
            $smtp->entrar($this->credencial('smtp_usuario'), $this->credencial('smtp_senha'));
            $smtp->enviar($enderecoRemetente !== '' ? $enderecoRemetente : $remetente, [Mime::endereco($destino)[1] ?: $destino], $bytes);
        } catch (ErroConexao $erro) {
            if ($erro->certificado) {
                throw self::erroDeCertificado('SMTP', $host, $erro);
            }
            throw new ErroCanal('falha ao enviar e-mail: ' . $this->semSegredos($erro->getMessage()));
        } catch (ErroSmtp $erro) {
            $motivo = $smtp->etapa === 'entrar no SMTP'
                ? "o servidor SMTP recusou o usuário e a senha: {$erro->getMessage()}"
                : $erro->getMessage();
            throw new ErroCanal("falha ao enviar e-mail: {$motivo}");
        } finally {
            $smtp->sair();
        }
        return new ResultadoEnvio(ResultadoEnvio::ENVIADA, $this->prefixarNoCanal($messageId));
    }

    private static function texto(mixed $valor): ?string
    {
        return is_string($valor) && $valor !== '' ? $valor : null;
    }
}

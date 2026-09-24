<?php
declare(strict_types=1);

use IHchat\Atendimento\ArquivoParaEnviar;
use IHchat\Canais\AdaptadorEmail;
use IHchat\Canais\Email\ErroConexao;
use IHchat\Canais\Email\Fluxo;
use IHchat\Canais\Email\Mime;
use IHchat\Canais\Email\Soquete;
use IHchat\Canais\ErroCanal;

/**
 * Servidor de e-mail de mentira: devolve o roteiro de bytes e anota o que o
 * cliente escreveu. Um por conexão aberta (SMTP e IMAP abrem as suas).
 */
final class FluxoRoteiroEmail implements Fluxo
{
    public string $escrito = '';
    public bool $tls = false;
    public bool $fechado = false;

    /** @param (callable(): void)|null $aoAtivarTls */
    public function __construct(private string $saida, private $aoAtivarTls = null)
    {
    }

    public function lerLinha(): string
    {
        $fim = strpos($this->saida, "\r\n");
        if ($fim === false) {
            throw new ErroConexao('o servidor fechou a conexão');
        }
        $linha = substr($this->saida, 0, $fim);
        $this->saida = substr($this->saida, $fim + 2);
        return $linha;
    }

    public function lerBytes(int $tamanho): string
    {
        $dados = substr($this->saida, 0, $tamanho);
        $this->saida = substr($this->saida, $tamanho);
        return $dados;
    }

    public function escrever(string $dados): void
    {
        $this->escrito .= $dados;
    }

    public function ativarTls(): void
    {
        if ($this->aoAtivarTls !== null) {
            ($this->aoAtivarTls)();
        }
        $this->tls = true;
    }

    public function fechar(): void
    {
        $this->fechado = true;
    }
}

/**
 * Liga a fábrica de conexões a uma fila de fluxos (na ordem em que o código
 * as abre) e devolve a lista de conexões abertas, para conferir depois.
 *
 * @param list<FluxoRoteiroEmail> $fluxos
 * @return ArrayObject<int, array{0: string, 1: int, 2: bool, 3: FluxoRoteiroEmail}>
 */
function servidores_email(array $fluxos): ArrayObject
{
    $abertas = new ArrayObject();
    Soquete::definirFabrica(static function (string $host, int $porta, bool $ssl) use (&$fluxos, $abertas): Fluxo {
        $fluxo = array_shift($fluxos) ?? throw new ErroConexao("Connection refused ({$host}:{$porta})");
        $abertas->append([$host, $porta, $ssl, $fluxo]);
        return $fluxo;
    });
    return $abertas;
}

const SMTP_OK = "220 smtp ESMTP\r\n"
    . "250-smtp\r\n250-STARTTLS\r\n250 AUTH PLAIN LOGIN\r\n"   // EHLO
    . "220 vai\r\n"                                            // STARTTLS
    . "250-smtp\r\n250 AUTH PLAIN LOGIN\r\n"                   // EHLO de novo, já cifrado
    . "235 ok\r\n"                                             // AUTH
    . "250 ok\r\n250 ok\r\n354 manda\r\n250 aceito\r\n"        // MAIL, RCPT, DATA, fim
    . "221 tchau\r\n";

const EMAIL_CANAL = [
    'id' => 7, 'nome' => 'Suporte', 'tipo' => 'email', 'ativo' => true,
    'credenciais' => [
        'remetente' => 'Suporte <suporte@empresa.com.br>', 'smtp_host' => 'smtp.empresa.com.br', 'smtp_porta' => '587',
        'smtp_usuario' => 'suporte@empresa.com.br', 'smtp_senha' => 'senha-smtp', 'imap_host' => 'imap.empresa.com.br',
    ],
];

return [
    'mime monta mensagem com acento, thread e anexo, e le de volta' => function (): void {
        [$bytes, $id] = Mime::montar(
            'Suporte Técnico <suporte@empresa.com.br>',
            'cliente@loja.com.br',
            'Re: Apuração de março',
            "Olá!\n.linha com ponto\nSegue o arquivo.",
            '<original@loja.com.br>',
            [new ArquivoParaEnviar('relatório.pdf', 'application/pdf', "%PDF-1.4\n\x00\xff binário")],
        );
        Afirmar::verdade(str_ends_with($id, '@empresa.com.br>'), 'message-id no domínio do remetente');
        Afirmar::verdade(preg_match('/^[\x00-\x7f]*$/', $bytes) === 1, 'mensagem só com ASCII (7bit)');
        $lida = Mime::ler($bytes);
        Afirmar::igual('<original@loja.com.br>', $lida['cabecalhos']['in-reply-to']);
        Afirmar::igual('<original@loja.com.br>', $lida['cabecalhos']['references']);
        Afirmar::igual('Re: Apuração de março', Mime::decodificarCabecalho($lida['cabecalhos']['subject']));
        Afirmar::igual(['Suporte Técnico', 'suporte@empresa.com.br'], Mime::endereco(Mime::decodificarCabecalho($lida['cabecalhos']['from'])));
        Afirmar::igual("Olá!\r\n.linha com ponto\r\nSegue o arquivo.", $lida['texto']);
        Afirmar::igual(1, count($lida['anexos']));
        Afirmar::igual('relatório.pdf', $lida['anexos'][0]->nome);
        Afirmar::igual("%PDF-1.4\n\x00\xff binário", $lida['anexos'][0]->dados);
        Afirmar::igual('application/pdf', $lida['anexos'][0]->tipo_conteudo);
    },
    'mime le quoted-printable latin1, base64 e nome em RFC 2231' => function (): void {
        $bruto = "From: =?ISO-8859-1?Q?Jos=E9_Silva?= <Jose@Loja.COM>\r\n"
            . "Subject: =?UTF-8?B?RMO6dmlkYQ==?=\r\n"
            . "Message-ID: <m1@loja.com>\r\n"
            . "Content-Type: multipart/mixed; boundary=\"XX\"\r\n\r\n"
            . "preambulo\r\n--XX\r\n"
            . "Content-Type: multipart/alternative; boundary=YY\r\n\r\n"
            . "--YY\r\nContent-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n"
            . "Ol=E1, segue a nota=\r\n fiscal.\r\n--YY\r\nContent-Type: text/html\r\n\r\n<p>html</p>\r\n--YY--\r\n"
            . "--XX\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename*=UTF-8''nota%20n%C2%BA%201.xml\r\n"
            . "Content-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode('<nfe/>')) . "--XX--\r\n";
        $lida = Mime::ler($bruto);
        Afirmar::igual("Olá, segue a nota fiscal.", $lida['texto']);
        Afirmar::igual('nota nº 1.xml', $lida['anexos'][0]->nome);
        Afirmar::igual('<nfe/>', $lida['anexos'][0]->dados);
        Afirmar::igual(['José Silva', 'Jose@Loja.COM'], Mime::endereco(Mime::decodificarCabecalho($lida['cabecalhos']['from'])));
        Afirmar::igual('Dúvida', Mime::decodificarCabecalho($lida['cabecalhos']['subject']));
    },
    'mime so com html vira texto, e sem corpo avisa' => function (): void {
        $html = "Content-Type: multipart/alternative; boundary=a\r\n\r\n--a\r\nContent-Type: text/html; charset=utf-8\r\n\r\n"
            . "<div>Bom dia,<br>preciso da <b>2ª via</b>&nbsp;do boleto</div><style>p{}</style>\r\n--a--\r\n";
        Afirmar::igual("Bom dia,\npreciso da 2ª via\u{a0}do boleto", Mime::ler($html)['texto']);
        $vazio = "Content-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: image/png\r\nContent-Disposition: attachment; filename=a.png\r\n\r\nPNG\r\n--b--\r\n";
        Afirmar::igual('[mensagem sem corpo em texto]', Mime::ler($vazio)['texto']);
    },
    'endereco entende os formatos comuns' => function (): void {
        Afirmar::igual(['', 'a@b.com'], Mime::endereco('a@b.com'));
        Afirmar::igual(['Fulano de Tal', 'a@b.com'], Mime::endereco('"Fulano de Tal" <a@b.com>'));
        Afirmar::igual(['Nome', 'a@b.com'], Mime::endereco('a@b.com (Nome)'));
        Afirmar::igual(['', ''], Mime::endereco('sem endereco nenhum'));
    },
    'smtp com starttls entra e envia com dot-stuffing' => function (): void {
        $abertas = servidores_email([new FluxoRoteiroEmail(SMTP_OK)]);
        try {
            $resultado = (new AdaptadorEmail(EMAIL_CANAL))->enviar('Cliente <cliente@loja.com.br>', ".começa com ponto\nfim", [
                'assunto' => 'Segunda via', 'referencia' => '<orig@loja.com.br>', 'arquivos' => [],
            ]);
        } finally {
            Soquete::definirFabrica(null);
        }
        Afirmar::igual('enviada', $resultado->status, (string) $resultado->erro);
        // com o canal (7): o mesmo Message-ID pode existir em outra caixa
        Afirmar::verdade(str_starts_with((string) $resultado->externo_id, 'email:7:<'), 'id externo com o canal e o Message-ID');
        [$host, $porta, $ssl, $fluxo] = $abertas[0];
        Afirmar::igual(['smtp.empresa.com.br', 587, false], [$host, $porta, $ssl]);
        Afirmar::verdade($fluxo->tls, 'STARTTLS antes do login');
        $escrito = $fluxo->escrito;
        Afirmar::verdade(str_contains($escrito, "STARTTLS\r\n"), 'pediu STARTTLS');
        Afirmar::verdade(str_contains($escrito, 'AUTH PLAIN ' . base64_encode("\0suporte@empresa.com.br\0senha-smtp") . "\r\n"), 'AUTH PLAIN');
        Afirmar::verdade(strpos($escrito, 'STARTTLS') < strpos($escrito, 'AUTH PLAIN'), 'senha só depois do TLS');
        Afirmar::verdade(str_contains($escrito, "MAIL FROM:<suporte@empresa.com.br>\r\nRCPT TO:<cliente@loja.com.br>\r\nDATA\r\n"), 'envelope');
        Afirmar::verdade(str_contains($escrito, 'Subject: Re: Segunda via'), 'assunto com Re:');
        Afirmar::verdade(str_contains($escrito, "In-Reply-To: <orig@loja.com.br>"), 'mesma thread');
        Afirmar::verdade(str_contains($escrito, "\r\n..come"), 'linha com ponto ganha outro ponto');
        Afirmar::verdade(str_contains($escrito, "\r\n.\r\nQUIT\r\n"), 'fim da mensagem e QUIT');
    },
    'smtp na porta 465 usa ssl direto sem starttls' => function (): void {
        $canal = EMAIL_CANAL;
        $canal['credenciais']['smtp_porta'] = '465';
        unset($canal['credenciais']['imap_host']);
        $abertas = servidores_email([new FluxoRoteiroEmail("220 ok\r\n250 AUTH LOGIN\r\n334 VXNlcm5hbWU6\r\n334 UGFzc3dvcmQ6\r\n235 ok\r\n221 tchau\r\n")]);
        try {
            $mensagem = (new AdaptadorEmail($canal))->verificarConexao();
        } finally {
            Soquete::definirFabrica(null);
        }
        Afirmar::verdade(str_starts_with($mensagem, 'SMTP ok (login em smtp.empresa.com.br:465 com SSL)'), $mensagem);
        Afirmar::verdade(str_contains($mensagem, 'sem servidor IMAP'), $mensagem);
        Afirmar::igual(true, $abertas[0][2], 'SSL desde a conexão');
        Afirmar::verdade(!str_contains($abertas[0][3]->escrito, 'STARTTLS'), 'sem STARTTLS');
        Afirmar::verdade(str_contains($abertas[0][3]->escrito, "AUTH LOGIN\r\n" . base64_encode('suporte@empresa.com.br') . "\r\n"), 'AUTH LOGIN');
    },
    'smtp senha recusada diz a etapa sem mostrar a senha' => function (): void {
        servidores_email([new FluxoRoteiroEmail(
            "220 ok\r\n250-x\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n220 vai\r\n250 AUTH PLAIN\r\n535 5.7.8 bad credentials\r\n221 tchau\r\n"
        )]);
        try {
            Afirmar::lanca(ErroCanal::class, fn () => (new AdaptadorEmail(EMAIL_CANAL))->verificarConexao(), function (ErroCanal $e): void {
                Afirmar::igual('o servidor SMTP recusou o usuário e a senha: 535 5.7.8 bad credentials', $e->getMessage());
            });
        } finally {
            Soquete::definirFabrica(null);
        }
    },
    'smtp com certificado invalido nao manda a senha' => function (): void {
        $fluxo = new FluxoRoteiroEmail("220 ok\r\n250-x\r\n250 STARTTLS\r\n220 vai\r\n", static function (): void {
            throw new ErroConexao('certificate verify failed', true, 'certificate verify failed');
        });
        servidores_email([$fluxo]);
        try {
            Afirmar::lanca(ErroCanal::class, fn () => (new AdaptadorEmail(EMAIL_CANAL))->verificarConexao(), function (ErroCanal $e): void {
                Afirmar::verdade(str_starts_with($e->getMessage(), 'o certificado TLS do servidor SMTP smtp.empresa.com.br não é válido'), $e->getMessage());
            });
        } finally {
            Soquete::definirFabrica(null);
        }
        Afirmar::verdade(!str_contains($fluxo->escrito, 'AUTH'), 'nenhuma senha saiu');
    },
    'smtp fora do ar vira falhou no envio' => function (): void {
        servidores_email([]);
        try {
            $r = (new AdaptadorEmail(EMAIL_CANAL))->enviar('a@b.com.br', 'oi', []);
        } finally {
            Soquete::definirFabrica(null);
        }
        Afirmar::igual('falhou', $r->status);
        Afirmar::verdade(str_starts_with((string) $r->erro, 'falha ao enviar e-mail: Connection refused'), (string) $r->erro);
    },
    'verificar conexao entra no smtp e no imap com a senha do smtp' => function (): void {
        $abertas = servidores_email([
            new FluxoRoteiroEmail(SMTP_OK),
            new FluxoRoteiroEmail("* OK IMAP pronto\r\nA1 OK LOGIN feito\r\n* BYE\r\nA2 OK LOGOUT\r\n"),
        ]);
        try {
            $mensagem = (new AdaptadorEmail(EMAIL_CANAL))->verificarConexao();
        } finally {
            Soquete::definirFabrica(null);
        }
        Afirmar::igual('SMTP ok (login em smtp.empresa.com.br:587 com STARTTLS); IMAP ok (login em imap.empresa.com.br:993)', $mensagem);
        Afirmar::igual(['imap.empresa.com.br', 993, true], array_slice($abertas[1], 0, 3));
        Afirmar::verdade(str_starts_with($abertas[1][3]->escrito, "A1 LOGIN \"suporte@empresa.com.br\" \"senha-smtp\"\r\n"), $abertas[1][3]->escrito);
    },
    'imap recusando a senha diz qual servidor' => function (): void {
        servidores_email([new FluxoRoteiroEmail(SMTP_OK), new FluxoRoteiroEmail("* OK\r\nA1 NO [AUTHENTICATIONFAILED] Invalid credentials\r\n")]);
        try {
            Afirmar::lanca(ErroCanal::class, fn () => (new AdaptadorEmail(EMAIL_CANAL))->verificarConexao(), function (ErroCanal $e): void {
                Afirmar::igual('o servidor IMAP recusou o usuário e a senha: NO [AUTHENTICATIONFAILED] Invalid credentials', $e->getMessage());
            });
        } finally {
            Soquete::definirFabrica(null);
        }
    },
    'imap com senha acentuada vai como literal' => function (): void {
        $canal = EMAIL_CANAL;
        $canal['credenciais']['imap_senha'] = 'senhação';
        $abertas = servidores_email([new FluxoRoteiroEmail(SMTP_OK), new FluxoRoteiroEmail("* OK\r\n+ vai\r\nA1 OK\r\nA2 OK\r\n")]);
        try {
            (new AdaptadorEmail($canal))->verificarConexao();
        } finally {
            Soquete::definirFabrica(null);
        }
        Afirmar::verdade(str_starts_with($abertas[1][3]->escrito, "A1 LOGIN \"suporte@empresa.com.br\" {" . strlen('senhação') . "}\r\nsenhação\r\n"), $abertas[1][3]->escrito);
    },
    'imap coleta um por vez e so marca como lido depois de gravado' => function (): void {
        $m1 = "From: Cliente <Cliente@Empresa.com.br>\r\nSubject: =?UTF-8?Q?D=C3=BAvida?=\r\nMessage-ID: <imap-1@empresa.com.br>\r\n\r\nChegou por IMAP\r\n";
        $m2 = "From: sem-arroba\r\n\r\nignorada\r\n";
        $imap = new FluxoRoteiroEmail(
            "* OK\r\nA1 OK\r\n* 2 EXISTS\r\nA2 OK [READ-WRITE] SELECT\r\n* SEARCH 11 12\r\nA3 OK\r\n"
            . '* 1 FETCH (UID 11 RFC822.SIZE ' . strlen($m1) . ")\r\n* 2 FETCH (RFC822.SIZE " . strlen($m2) . " UID 12)\r\nA4 OK\r\n"
            . '* 1 FETCH (UID 11 BODY[] {' . strlen($m1) . "}\r\n{$m1})\r\nA5 OK\r\n"
            . "A6 OK\r\n"
            . '* 2 FETCH (UID 12 BODY[] {' . strlen($m2) . "}\r\n{$m2})\r\nA7 OK\r\n"
            . "A8 OK\r\n* BYE\r\nA9 OK\r\n"
        );
        servidores_email([$imap]);
        $recebidas = [];
        try {
            $adaptador = new AdaptadorEmail(EMAIL_CANAL);
            foreach ($adaptador->coletar() as $recebida) {
                // é aqui que o Coletor grava: nada pode estar marcado ainda
                Afirmar::verdade(!str_contains($imap->escrito, 'STORE'), 'nada marcado antes de gravar');
                Afirmar::verdade(!str_contains($imap->escrito, 'UID FETCH 12 (BODY.PEEK[])'), 'uma mensagem por vez');
                $recebidas[] = $recebida;
            }
            Afirmar::verdade(str_contains($imap->escrito, "A4 UID FETCH 11,12 (RFC822.SIZE)\r\n"), 'tamanhos antes de baixar');
            Afirmar::verdade(str_contains($imap->escrito, 'A5 UID FETCH 11 (BODY.PEEK[])'), 'PEEK não marca como lida');
            Afirmar::verdade(str_contains($imap->escrito, "A6 UID STORE 11 +FLAGS.SILENT (\\Seen)\r\n"), $imap->escrito);
            // a sem remetente não vira mensagem, mas sai dos não lidos para não voltar sempre
            Afirmar::verdade(str_contains($imap->escrito, "A8 UID STORE 12 +FLAGS.SILENT (\\Seen)\r\n"), $imap->escrito);
            $adaptador->confirmarColeta();
        } finally {
            Soquete::definirFabrica(null);
        }
        Afirmar::igual(1, count($recebidas));
        $r = $recebidas[0];
        Afirmar::igual(['cliente@empresa.com.br', 'Chegou por IMAP', 'Cliente', 'email:7:<imap-1@empresa.com.br>', 'Dúvida'],
            [$r->identificador, $r->conteudo, $r->nome_exibicao, $r->externo_id, $r->assunto]);
        Afirmar::igual(['referencias' => '<imap-1@empresa.com.br>'], $r->metadados);
        Afirmar::verdade(str_contains($imap->escrito, "A9 LOGOUT\r\n"), 'saiu');
    },
    'imap: falha ao gravar para a coleta sem marcar a mensagem' => function (): void {
        $m1 = "From: a@b.com.br\r\nMessage-ID: <x1@b>\r\n\r\num\r\n";
        $imap = new FluxoRoteiroEmail(
            "* OK\r\nA1 OK\r\nA2 OK\r\n* SEARCH 5\r\nA3 OK\r\n* 1 FETCH (UID 5 RFC822.SIZE 40)\r\nA4 OK\r\n"
            . '* 1 FETCH (UID 5 BODY[] {' . strlen($m1) . "}\r\n{$m1})\r\nA5 OK\r\n* BYE\r\nA6 OK\r\n"
        );
        servidores_email([$imap]);
        try {
            $adaptador = new AdaptadorEmail(EMAIL_CANAL);
            Afirmar::lanca(\PDOException::class, function () use ($adaptador): void {
                foreach ($adaptador->coletar() as $recebida) {
                    throw new \PDOException('banco fora do ar'); // o Coletor relança e não confirma
                }
            });
            unset($adaptador);
        } finally {
            Soquete::definirFabrica(null);
        }
        Afirmar::verdade(!str_contains($imap->escrito, 'STORE'), 'volta na próxima coleta');
    },
    'imap: e-mail acima do limite nao e baixado, vira aviso e sai dos nao lidos' => function (): void {
        $grande = AdaptadorEmail::tamanhoMaximoColeta() + 1;
        $cabecalho = "From: Cliente <cli@empresa.com.br>\r\nSubject: Planilha enorme\r\nMessage-ID: <big@empresa.com.br>\r\n\r\n";
        $imap = new FluxoRoteiroEmail(
            "* OK\r\nA1 OK\r\nA2 OK\r\n* SEARCH 9\r\nA3 OK\r\n* 1 FETCH (UID 9 RFC822.SIZE {$grande})\r\nA4 OK\r\n"
            . '* 1 FETCH (UID 9 BODY[HEADER] {' . strlen($cabecalho) . "}\r\n{$cabecalho})\r\nA5 OK\r\n"
            . "A6 OK\r\n* BYE\r\nA7 OK\r\n"
        );
        servidores_email([$imap]);
        try {
            $adaptador = new AdaptadorEmail(EMAIL_CANAL);
            $recebidas = iterator_to_array($adaptador->coletar(), false);
            $adaptador->confirmarColeta();
        } finally {
            Soquete::definirFabrica(null);
        }
        Afirmar::verdade(!str_contains($imap->escrito, 'BODY.PEEK[]'), 'o corpo gigante nunca é pedido');
        Afirmar::verdade(str_contains($imap->escrito, 'A5 UID FETCH 9 (BODY.PEEK[HEADER])'), $imap->escrito);
        Afirmar::verdade(str_contains($imap->escrito, "A6 UID STORE 9 +FLAGS.SILENT (\\Seen)\r\n"), 'não trava a caixa');
        Afirmar::igual(1, count($recebidas));
        Afirmar::igual(['cli@empresa.com.br', 'email:7:<big@empresa.com.br>', 'Planilha enorme'],
            [$recebidas[0]->identificador, $recebidas[0]->externo_id, $recebidas[0]->assunto]);
        Afirmar::verdade(str_contains($recebidas[0]->conteudo, 'acima do limite de 20 MB'), $recebidas[0]->conteudo);
    },
    'mime le anexo grande sem copias do corpo inteiro' => function (): void {
        $anexo = random_bytes(4 * 1024 * 1024);
        $bruto = "From: a@b.com.br\r\nContent-Type: multipart/mixed; boundary=\"XX\"\r\n\r\npreambulo\r\n--XX\r\n"
            . "Content-Type: text/plain\r\n\r\noi\r\nsegunda linha\r\n--XX\r\nContent-Type: application/pdf; name=\"a.pdf\"\r\n"
            . "Content-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($anexo), 76, "\r\n") . "--XX--\r\n";
        $antes = memory_get_usage();
        memory_reset_peak_usage();
        $lida = Mime::ler($bruto);
        $pico = memory_get_peak_usage() - $antes;
        Afirmar::igual("oi\nsegunda linha", $lida['texto']);
        Afirmar::igual($anexo, $lida['anexos'][0]->dados);
        // o bruto (~5,6 MB) já estava na memória; o pico extra era ~7x o bruto
        // (str_replace e preg_split sobre o corpo inteiro) e agora fica em ~3x:
        // o corpo, a parte e o anexo decodificado
        Afirmar::verdade($pico < 3.5 * strlen($bruto), 'pico de ' . round($pico / 1048576, 1) . ' MB');
    },
    'canal sem imap nao coleta nada' => function (): void {
        $canal = EMAIL_CANAL;
        unset($canal['credenciais']['imap_host']);
        servidores_email([]);
        try {
            Afirmar::igual([], (new AdaptadorEmail($canal))->coletar());
            Afirmar::igual(null, (new AdaptadorEmail($canal))->chaveColeta());
        } finally {
            Soquete::definirFabrica(null);
        }
    },
];

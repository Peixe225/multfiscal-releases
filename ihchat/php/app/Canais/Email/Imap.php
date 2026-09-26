<?php
declare(strict_types=1);

namespace IHchat\Canais\Email;

/**
 * Cliente IMAP mínimo (IMAPS, porta 993): LOGIN, SELECT, UID SEARCH UNSEEN,
 * UID FETCH (RFC822.SIZE, BODY.PEEK[HEADER], BODY.PEEK[]) e UID STORE +FLAGS (\Seen).
 *
 * O BODY.PEEK não marca a mensagem como lida: ela só vira lida quando o
 * sistema já a gravou (marcarLidas), senão uma queda no meio perderia e-mail.
 */
final class Imap
{
    public string $etapa = '';
    private ?Fluxo $fluxo = null;
    private int $sequencia = 0;

    public function __construct(private readonly string $host, private readonly int $porta, private readonly float $timeout)
    {
    }

    /** @throws ErroConexao|ErroImap */
    public function entrar(string $usuario, string $senha): void
    {
        $this->etapa = "conectar ao servidor IMAP {$this->host}:{$this->porta}";
        $this->fluxo = Soquete::abrir($this->host, $this->porta, true, $this->timeout);
        $saudacao = $this->fluxo->lerLinha();
        if (!str_starts_with($saudacao, '* OK') && !str_starts_with($saudacao, '* PREAUTH')) {
            throw new ErroImap('saudação inesperada: ' . mb_substr($saudacao, 0, 120));
        }
        $this->etapa = 'entrar no IMAP';
        $this->comando(['LOGIN', $usuario, $senha]);
    }

    public function selecionar(string $pasta): void
    {
        $this->etapa = "abrir a pasta {$pasta}";
        $this->comando(['SELECT', $pasta]);
    }

    /** UIDs das mensagens não lidas, na ordem do servidor. @return list<int> */
    public function naoLidas(): array
    {
        $this->etapa = 'procurar mensagens não lidas';
        $uids = [];
        foreach ($this->comando(['UID SEARCH UNSEEN'])[0] as $linha) {
            if (preg_match('/^\* SEARCH\b(.*)$/i', $linha, $m) === 1) {
                foreach (preg_split('/\s+/', trim($m[1])) ?: [] as $uid) {
                    if (ctype_digit($uid)) {
                        $uids[] = (int) $uid;
                    }
                }
            }
        }
        return $uids;
    }

    /**
     * Tamanho de cada mensagem (RFC822.SIZE), sem baixar nada: a coleta pula
     * o e-mail gigante antes de ele estourar a memória do cron.
     *
     * @param list<int> $uids
     * @return array<int, int> uid => bytes (uid ausente = o servidor não disse)
     */
    public function tamanhos(array $uids): array
    {
        $this->etapa = 'consultar o tamanho das mensagens';
        $tamanhos = [];
        foreach (array_chunk($uids, 50) as $bloco) {
            [$linhas] = $this->comando(['UID FETCH ' . implode(',', $bloco) . ' (RFC822.SIZE)']);
            foreach ($linhas as $linha) {
                // "* 3 FETCH (UID 12 RFC822.SIZE 2044)", em qualquer ordem
                if (preg_match('/\bUID\s+(\d+)/i', $linha, $u) === 1 && preg_match('/\bRFC822\.SIZE\s+(\d+)/i', $linha, $t) === 1) {
                    $tamanhos[(int) $u[1]] = (int) $t[1];
                }
            }
        }
        return $tamanhos;
    }

    /** Só os cabeçalhos (sem marcar como lida): o aviso do e-mail grande diz de quem é. */
    public function cabecalhos(int $uid): ?string
    {
        $this->etapa = 'baixar os cabeçalhos da mensagem';
        [, $literais] = $this->comando(["UID FETCH {$uid} (BODY.PEEK[HEADER])"]);
        return $literais[0] ?? null;
    }

    /** A mensagem inteira (RFC 822) sem marcá-la como lida; null se sumiu. */
    public function buscar(int $uid): ?string
    {
        $this->etapa = 'baixar a mensagem';
        [, $literais] = $this->comando(["UID FETCH {$uid} (BODY.PEEK[])"]);
        return $literais[0] ?? null;
    }

    /** @param list<int> $uids */
    public function marcarLidas(array $uids): void
    {
        if ($uids === []) {
            return;
        }
        $this->etapa = 'marcar as mensagens como lidas';
        // em blocos, para a linha de comando não passar do limite do servidor
        foreach (array_chunk($uids, 50) as $bloco) {
            $this->comando(['UID STORE ' . implode(',', $bloco) . ' +FLAGS.SILENT (\\Seen)']);
        }
    }

    public function sair(): void
    {
        if ($this->fluxo === null) {
            return;
        }
        try {
            $this->comando(['LOGOUT']);
        } catch (\Throwable) {
            // o servidor pode fechar antes do OK; tanto faz
        }
        $this->fluxo->fechar();
        $this->fluxo = null;
    }

    /**
     * Manda um comando. O primeiro item vai cru (é o verbo e os átomos); os
     * demais são textos, citados ou como literal quando têm acento.
     *
     * @param list<string> $partes
     * @return array{0: list<string>, 1: list<string>} linhas não marcadas e literais recebidos
     */
    private function comando(array $partes): array
    {
        if ($this->fluxo === null) {
            throw new ErroConexao('conexão IMAP não aberta');
        }
        $marca = 'A' . (++$this->sequencia);
        $linha = $marca . ' ' . array_shift($partes);
        foreach ($partes as $texto) {
            if (preg_match('/^[\x20-\x7e]*$/', $texto) === 1) {
                $linha .= ' "' . addcslashes($texto, '"\\') . '"';
                continue;
            }
            // literal: o servidor precisa autorizar ("+") antes dos bytes
            $this->fluxo->escrever($linha . ' {' . strlen($texto) . "}\r\n");
            $resposta = $this->fluxo->lerLinha();
            if (!str_starts_with($resposta, '+')) {
                throw new ErroImap(self::semMarca($resposta, $marca));
            }
            $linha = $texto;
        }
        $this->fluxo->escrever($linha . "\r\n");
        return $this->respostas($marca);
    }

    /** @return array{0: list<string>, 1: list<string>} */
    private function respostas(string $marca): array
    {
        $linhas = [];
        $literais = [];
        while (true) {
            $linha = $this->fluxo?->lerLinha() ?? '';
            // um literal no fim da linha: {N} seguido de N bytes e do resto da linha
            while (preg_match('/\{(\d+)\}$/', $linha, $m) === 1 && $this->fluxo !== null) {
                $literais[] = $this->fluxo->lerBytes((int) $m[1]);
                $linha .= ' ' . $this->fluxo->lerLinha();
            }
            if (str_starts_with($linha, $marca . ' ')) {
                $resto = substr($linha, strlen($marca) + 1);
                if (stripos($resto, 'OK') !== 0) {
                    throw new ErroImap(self::semMarca($linha, $marca));
                }
                return [$linhas, $literais];
            }
            $linhas[] = $linha;
        }
    }

    private static function semMarca(string $linha, string $marca): string
    {
        $texto = str_starts_with($linha, $marca . ' ') ? substr($linha, strlen($marca) + 1) : $linha;
        return mb_substr(trim($texto), 0, 200);
    }
}

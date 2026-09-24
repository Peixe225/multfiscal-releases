<?php
declare(strict_types=1);

namespace OmniChannel\Canais\Email;

use OmniChannel\Atendimento\AnexoRecebido;

/**
 * Leitura e montagem de mensagens de e-mail (RFC 5322 + MIME).
 *
 * Leitura: cabeçalhos (com "=?UTF-8?B?...?=" decodificado), o corpo em texto
 * e os anexos, o que o `email` da biblioteca padrão do Python faz no coletor.
 * Montagem: uma mensagem UTF-8 com anexos e com In-Reply-To/References, para
 * a resposta cair na mesma thread no cliente de e-mail do contato.
 */
final class Mime
{
    // ------------------------------------------------------------------ leitura

    /**
     * Separa cabeçalhos (nomes em minúsculas, primeira ocorrência, linhas
     * dobradas juntadas) e corpo.
     *
     * @return array{0: array<string, string>, 1: string}
     */
    public static function separar(string $bruto): array
    {
        // só o cabeçalho é normalizado: o corpo pode ter dezenas de MB (anexo),
        // e cada str_replace sobre ele seria mais uma cópia inteira na memória
        $crlf = strpos($bruto, "\r\n\r\n");
        $lf = strpos($bruto, "\n\n");
        if ($crlf !== false && ($lf === false || $crlf < $lf)) {
            [$posicao, $separador] = [$crlf, 4];
        } else {
            [$posicao, $separador] = [$lf, 2];
        }
        $cabecalho = $posicao === false ? $bruto : substr($bruto, 0, $posicao);
        $corpo = $posicao === false ? '' : substr($bruto, $posicao + $separador);
        $cabecalho = str_replace("\r\n", "\n", $cabecalho);
        $cabecalho = (string) preg_replace("/\n[ \t]+/", ' ', $cabecalho);
        $campos = [];
        foreach (explode("\n", $cabecalho) as $linha) {
            $partes = explode(':', $linha, 2);
            if (count($partes) !== 2) {
                continue;
            }
            $nome = strtolower(trim($partes[0]));
            if ($nome !== '' && !isset($campos[$nome])) {
                $campos[$nome] = trim($partes[1]);
            }
        }
        return [$campos, $corpo];
    }

    /** "=?UTF-8?B?...?=" e afins viram texto UTF-8. */
    public static function decodificarCabecalho(?string $valor): string
    {
        if ($valor === null || $valor === '') {
            return '';
        }
        if (!str_contains($valor, '=?')) {
            return self::paraUtf8($valor, 'UTF-8');
        }
        $texto = @iconv_mime_decode($valor, ICONV_MIME_DECODE_CONTINUE_ON_ERROR, 'UTF-8');
        return is_string($texto) ? $texto : $valor;
    }

    /**
     * "Nome <a@b.com>" -> ["Nome", "a@b.com"] (o parseaddr do Python).
     *
     * @return array{0: string, 1: string}
     */
    public static function endereco(?string $valor): array
    {
        $valor = trim((string) $valor);
        if ($valor === '') {
            return ['', ''];
        }
        if (preg_match('/^(.*)<([^<>]*)>\s*$/s', $valor, $m) === 1) {
            $nome = trim($m[1]);
            if (strlen($nome) >= 2 && $nome[0] === '"' && str_ends_with($nome, '"')) {
                $nome = stripcslashes(substr($nome, 1, -1));
            }
            return [$nome, trim($m[2])];
        }
        // "a@b.com (Nome)": o comentário entre parênteses é o nome
        if (preg_match('/^([^\s()]+)\s*\((.*)\)\s*$/', $valor, $m) === 1) {
            return [trim($m[2]), $m[1]];
        }
        return ['', str_contains($valor, ' ') ? '' : $valor];
    }

    /**
     * Texto e anexos de uma mensagem bruta.
     *
     * @return array{cabecalhos: array<string, string>, texto: string, anexos: list<AnexoRecebido>}
     */
    public static function ler(string $bruto): array
    {
        [$cabecalhos, $corpo] = self::separar($bruto);
        $folhas = [];
        self::folhas($cabecalhos, $corpo, $folhas, 0);
        $texto = null;
        $html = null;
        $anexos = [];
        $multipart = str_starts_with(self::tipo($cabecalhos), 'multipart/');
        foreach ($folhas as $folha) {
            if ($folha['anexo']) {
                if ($folha['dados'] !== '') {
                    $anexos[] = new AnexoRecebido(
                        nome: $folha['nome'] !== '' ? $folha['nome'] : 'arquivo',
                        dados: $folha['dados'],
                        tipo_conteudo: $folha['tipo'],
                    );
                }
                continue;
            }
            if ($folha['tipo'] === 'text/plain' && $texto === null) {
                $texto = self::paraUtf8($folha['dados'], $folha['charset']);
            } elseif ($folha['tipo'] === 'text/html' && $html === null) {
                $html = self::paraUtf8($folha['dados'], $folha['charset']);
            }
        }
        if ($texto === null && $html !== null) {
            // só HTML (muito cliente de celular): vira texto em vez de sumir
            $texto = self::htmlParaTexto($html);
        }
        if ($texto === null) {
            $texto = $multipart ? '[mensagem sem corpo em texto]' : '';
        }
        return ['cabecalhos' => $cabecalhos, 'texto' => $texto, 'anexos' => $anexos];
    }

    /**
     * @param array<string, string> $cabecalhos
     * @param list<array{tipo: string, charset: string, nome: string, anexo: bool, dados: string}> $folhas
     */
    private static function folhas(array $cabecalhos, string $corpo, array &$folhas, int $profundidade): void
    {
        $tipo = self::tipo($cabecalhos);
        $parametros = self::parametros($cabecalhos['content-type'] ?? '');
        if (str_starts_with($tipo, 'multipart/') && $profundidade < 10 && ($parametros['boundary'] ?? '') !== '') {
            $fronteira = preg_quote($parametros['boundary'], '/');
            // só as POSIÇÕES dos delimitadores (preg_split copiaria o corpo
            // inteiro em pedaços de uma vez); cada parte é recortada, lida e solta
            preg_match_all('/^--' . $fronteira . '(?:--)?[ \t]*\r?$/m', $corpo, $delimitadores, PREG_OFFSET_CAPTURE);
            $delimitadores = $delimitadores[0];
            // o que vem antes do primeiro é o preâmbulo e depois do último, o epílogo
            for ($i = 0; $i + 1 < count($delimitadores); $i++) {
                $inicio = $delimitadores[$i][1] + strlen($delimitadores[$i][0]);
                if (($corpo[$inicio] ?? '') === "\n") {
                    $inicio++;
                }
                // a quebra de linha antes do delimitador pertence a ele, não à parte
                $fim = $delimitadores[$i + 1][1];
                if ($fim > $inicio && $corpo[$fim - 1] === "\n") {
                    $fim--;
                    if ($fim > $inicio && $corpo[$fim - 1] === "\r") {
                        $fim--;
                    }
                }
                [$subCabecalhos, $subCorpo] = self::separar(substr($corpo, $inicio, max(0, $fim - $inicio)));
                self::folhas($subCabecalhos, $subCorpo, $folhas, $profundidade + 1);
                unset($subCorpo);
            }
            return;
        }
        $disposicao = $cabecalhos['content-disposition'] ?? '';
        $parametrosDisposicao = self::parametros($disposicao);
        $nome = $parametrosDisposicao['filename'] ?? $parametros['name'] ?? '';
        $nome = self::decodificarCabecalho($nome);
        $dados = self::decodificarCorpo($corpo, strtolower(trim($cabecalhos['content-transfer-encoding'] ?? '')));
        $folhas[] = [
            'tipo' => $tipo,
            'charset' => $parametros['charset'] ?? 'utf-8',
            'nome' => basename(str_replace('\\', '/', $nome)),
            // sem nome e sem "attachment" é corpo, não anexo (como no coletor Python)
            'anexo' => stripos($disposicao, 'attachment') !== false || $nome !== '',
            'dados' => $dados,
        ];
    }

    /** @param array<string, string> $cabecalhos */
    private static function tipo(array $cabecalhos): string
    {
        $tipo = strtolower(trim(explode(';', $cabecalhos['content-type'] ?? 'text/plain')[0]));
        return $tipo !== '' ? $tipo : 'text/plain';
    }

    /**
     * Parâmetros de um cabeçalho ("text/plain; charset=utf-8; name=\"a.pdf\"").
     * Entende o formato RFC 2231 (filename*=UTF-8''rel%C3%B3rio.pdf).
     *
     * @return array<string, string>
     */
    public static function parametros(string $valor): array
    {
        $resultado = [];
        preg_match_all('/;\s*([A-Za-z0-9_\-\*]+)\s*=\s*("(?:[^"\\\\]|\\\\.)*"|[^;]*)/', $valor, $m, PREG_SET_ORDER);
        $continuacoes = [];
        foreach ($m as [, $nome, $conteudo]) {
            $nome = strtolower($nome);
            $conteudo = trim($conteudo);
            if (strlen($conteudo) >= 2 && $conteudo[0] === '"') {
                $conteudo = stripcslashes(substr($conteudo, 1, -1));
            }
            if (preg_match('/^(.+?)\*(\d+)?(\*)?$/', $nome, $partes) === 1) {
                $continuacoes[$partes[1]][(int) ($partes[2] ?? 0)] = [$conteudo, ($partes[3] ?? '') === '*' || ($partes[2] ?? '') === ''];
                continue;
            }
            $resultado[$nome] = $conteudo;
        }
        foreach ($continuacoes as $nome => $pedacos) {
            ksort($pedacos);
            $texto = '';
            $charset = 'UTF-8';
            foreach ($pedacos as $indice => [$conteudo, $codificado]) {
                if ($codificado) {
                    if ($indice === 0 && preg_match("/^([^']*)'[^']*'(.*)$/", $conteudo, $c) === 1) {
                        $charset = $c[1] !== '' ? $c[1] : 'UTF-8';
                        $conteudo = $c[2];
                    }
                    $conteudo = rawurldecode($conteudo);
                }
                $texto .= $conteudo;
            }
            $resultado[$nome] = self::paraUtf8($texto, $charset);
        }
        return $resultado;
    }

    private static function decodificarCorpo(string $corpo, string $codificacao): string
    {
        return match ($codificacao) {
            // fora do modo estrito, o base64_decode já pula quebras de linha e
            // espaços: sem o preg_replace, uma cópia a menos do anexo inteiro
            'base64' => (string) base64_decode($corpo),
            'quoted-printable' => quoted_printable_decode(str_replace("\n", "\r\n", str_replace("\r\n", "\n", $corpo))),
            default => str_replace("\r\n", "\n", $corpo),
        };
    }

    public static function paraUtf8(string $texto, string $charset): string
    {
        $charset = strtoupper(trim($charset, " \"'"));
        if ($charset === '' || $charset === 'UTF-8' || $charset === 'UTF8' || $charset === 'US-ASCII') {
            return mb_check_encoding($texto, 'UTF-8') ? $texto : mb_convert_encoding($texto, 'UTF-8', 'ISO-8859-1');
        }
        try {
            $convertido = mb_convert_encoding($texto, 'UTF-8', $charset);
        } catch (\ValueError) {
            $convertido = @iconv($charset, 'UTF-8//IGNORE', $texto);
        }
        if (!is_string($convertido) || !mb_check_encoding($convertido, 'UTF-8')) {
            return mb_convert_encoding($texto, 'UTF-8', 'ISO-8859-1');
        }
        return $convertido;
    }

    private static function htmlParaTexto(string $html): string
    {
        $html = (string) preg_replace('#<(script|style)\b[^>]*>.*?</\1>#is', '', $html);
        $html = (string) preg_replace('#<br\s*/?>|</p>|</div>|</li>|</tr>#i', "\n", $html);
        $texto = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $texto = (string) preg_replace("/[ \t]+/", ' ', $texto);
        return trim((string) preg_replace("/\n\s*\n+/", "\n\n", $texto));
    }

    // ----------------------------------------------------------------- montagem

    /**
     * Monta a mensagem pronta para o DATA do SMTP.
     *
     * @param list<\OmniChannel\Atendimento\ArquivoParaEnviar> $arquivos
     * @return array{0: string, 1: string} bytes da mensagem e o Message-ID usado
     */
    public static function montar(
        string $remetente,
        string $destino,
        string $assunto,
        string $texto,
        ?string $referencia = null,
        array $arquivos = [],
    ): array {
        [$nomeRemetente, $enderecoRemetente] = self::endereco($remetente);
        $dominio = substr((string) strrchr($enderecoRemetente, '@'), 1) ?: 'omnichannel.local';
        $messageId = '<' . bin2hex(random_bytes(12)) . '.' . time() . '@' . $dominio . '>';

        $cabecalhos = [
            'From' => self::formatarEndereco($nomeRemetente, $enderecoRemetente),
            'To' => self::formatarEndereco(...self::endereco($destino)),
            'Subject' => self::codificarCabecalho($assunto),
            'Date' => gmdate('D, d M Y H:i:s') . ' +0000',
            'Message-ID' => $messageId,
            'MIME-Version' => '1.0',
        ];
        if ($referencia !== null && $referencia !== '') {
            $referencia = str_replace(["\r", "\n"], '', $referencia);
            $cabecalhos['In-Reply-To'] = $referencia;
            $cabecalhos['References'] = $referencia;
        }
        // quebras de linha normalizadas para CRLF antes do quoted-printable
        $linhas = str_replace("\n", "\r\n", str_replace(["\r\n", "\r"], "\n", $texto));
        $parteTexto = "Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n"
            . quoted_printable_encode($linhas);
        if ($arquivos === []) {
            [$tipoTexto, $corpoTexto] = explode("\r\n\r\n", $parteTexto, 2);
            $saida = '';
            foreach ($cabecalhos as $nome => $valor) {
                $saida .= "{$nome}: {$valor}\r\n";
            }
            return [$saida . $tipoTexto . "\r\n\r\n" . $corpoTexto . "\r\n", $messageId];
        }
        $fronteira = '=_omni_' . bin2hex(random_bytes(12));
        $cabecalhos['Content-Type'] = "multipart/mixed; boundary=\"{$fronteira}\"";
        $saida = '';
        foreach ($cabecalhos as $nome => $valor) {
            $saida .= "{$nome}: {$valor}\r\n";
        }
        $saida .= "\r\nMensagem MIME com anexos.\r\n\r\n--{$fronteira}\r\n{$parteTexto}\r\n";
        foreach ($arquivos as $arquivo) {
            $tipo = preg_match('#^[\w.+-]+/[\w.+-]+$#', $arquivo->tipo_conteudo) === 1 ? $arquivo->tipo_conteudo : 'application/octet-stream';
            $saida .= "--{$fronteira}\r\n"
                . "Content-Type: {$tipo}; name=\"" . self::nomeAscii($arquivo->nome) . "\"\r\n"
                . "Content-Transfer-Encoding: base64\r\n"
                . 'Content-Disposition: attachment; filename="' . self::nomeAscii($arquivo->nome) . '"'
                . (self::eAscii($arquivo->nome) ? '' : "; filename*=UTF-8''" . rawurlencode($arquivo->nome)) . "\r\n\r\n"
                . rtrim(chunk_split(base64_encode($arquivo->dados), 76, "\r\n")) . "\r\n";
        }
        return [$saida . "--{$fronteira}--\r\n", $messageId];
    }

    /** Texto com acento vira "=?UTF-8?B?...?=" (cabeçalho só aceita ASCII). */
    public static function codificarCabecalho(string $texto): string
    {
        $texto = str_replace(["\r", "\n"], ' ', $texto);
        if (self::eAscii($texto)) {
            return $texto;
        }
        $codificado = mb_encode_mimeheader($texto, 'UTF-8', 'B', "\r\n");
        return $codificado;
    }

    private static function formatarEndereco(string $nome, string $endereco): string
    {
        $endereco = str_replace(["\r", "\n", '<', '>'], '', $endereco);
        $nome = trim(str_replace(["\r", "\n"], ' ', $nome));
        if ($nome === '') {
            return $endereco;
        }
        $nome = self::eAscii($nome) ? '"' . addcslashes($nome, '"\\') . '"' : self::codificarCabecalho($nome);
        return "{$nome} <{$endereco}>";
    }

    private static function eAscii(string $texto): bool
    {
        return preg_match('/^[\x20-\x7e]*$/', $texto) === 1;
    }

    private static function nomeAscii(string $nome): string
    {
        $ascii = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $nome);
        $ascii = preg_replace('/[^A-Za-z0-9._ ()-]/', '_', is_string($ascii) ? $ascii : '') ?: 'arquivo';
        return $ascii;
    }
}

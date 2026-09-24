<?php
declare(strict_types=1);

namespace OmniChannel\Atendimento;

use OmniChannel\Banco\Banco;
use OmniChannel\Nucleo\Config;
use OmniChannel\Nucleo\Datas;
use OmniChannel\Nucleo\Log;

/**
 * Arquivos trocados nas conversas (app/servicos/anexos.py + app/armazenamento.py).
 *
 * Os bytes ficam em <pasta_dados>/anexos/<chave>, FORA do public; o acesso é
 * sempre pela API (/api/anexos/{id}, /api/widget/anexos/{id}), para que a
 * permissão da conversa valha também para o arquivo. A chave é gerada aqui
 * (uuid + nome higienizado, o mesmo formato do Python) e nunca vem do
 * usuário, então nenhum nome de arquivo escapa da pasta.
 */
final class Anexos
{
    public const TIPO_PADRAO = 'application/octet-stream';
    /** Tipos que o painel e o widget exibem embutidos; o resto vira link de download. */
    public const TIPOS_IMAGEM = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

    /**
     * Tipos que podem ficar gravados (e ser servidos) como estão: o navegador
     * mostra ou baixa, mas nunca executa script. Qualquer outro tipo vira
     * application/octet-stream — ou, se for de família executável (HTML, XML,
     * XSL, SVG, JS), um tipo canônico dessa família, que a entrega sempre
     * serve como download com CSP sandbox (Resposta::arquivo).
     */
    public const TIPOS_SEGUROS = [
        'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff', 'image/heic',
        'image/vnd.microsoft.icon', 'image/x-icon',
        'application/pdf', 'text/plain', 'text/csv', 'application/json', 'application/rtf', 'application/x-ofx',
        'application/zip', 'application/gzip', 'application/x-gzip', 'application/vnd.rar', 'application/x-rar',
        'application/x-7z-compressed', 'application/x-tar',
        'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet',
        self::TIPO_PADRAO,
    ];
    /** Famílias inteiras sem script: áudio e vídeo. */
    private const PREFIXOS_SEGUROS = ['audio/', 'video/'];
    /** Famílias que o navegador EXECUTA se abrir como documento. */
    private const EXECUTAVEL = '#(html|xml|xsl|svg|javascript|ecmascript)#i';

    /** O essencial do mimetypes do Python, sem depender do servidor. */
    private const EXTENSOES = [
        'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'jpe' => 'image/jpeg',
        'gif' => 'image/gif', 'webp' => 'image/webp', 'svg' => 'image/svg+xml', 'bmp' => 'image/bmp',
        'ico' => 'image/vnd.microsoft.icon', 'tif' => 'image/tiff', 'tiff' => 'image/tiff', 'heic' => 'image/heic',
        'pdf' => 'application/pdf', 'txt' => 'text/plain', 'csv' => 'text/csv', 'htm' => 'text/html',
        'html' => 'text/html', 'xml' => 'application/xml', 'json' => 'application/json', 'js' => 'text/javascript',
        'css' => 'text/css', 'zip' => 'application/zip', 'gz' => 'application/gzip', 'rar' => 'application/vnd.rar',
        '7z' => 'application/x-7z-compressed', 'tar' => 'application/x-tar',
        'doc' => 'application/msword', 'xls' => 'application/vnd.ms-excel', 'ppt' => 'application/vnd.ms-powerpoint',
        'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'odt' => 'application/vnd.oasis.opendocument.text', 'ods' => 'application/vnd.oasis.opendocument.spreadsheet',
        'mp3' => 'audio/mpeg', 'ogg' => 'audio/ogg', 'oga' => 'audio/ogg', 'opus' => 'audio/ogg', 'wav' => 'audio/x-wav',
        'm4a' => 'audio/mp4', 'aac' => 'audio/aac', 'amr' => 'audio/amr',
        'mp4' => 'video/mp4', 'webm' => 'video/webm', 'mov' => 'video/quicktime', '3gp' => 'video/3gpp',
        'eml' => 'message/rfc822', 'ofx' => 'application/x-ofx', 'rtf' => 'application/rtf',
    ];

    /** Acentos comuns, para quando a extensão intl (Normalizer) não existe na hospedagem. */
    private const SEM_ACENTO = [
        'á' => 'a', 'à' => 'a', 'â' => 'a', 'ã' => 'a', 'ä' => 'a', 'å' => 'a', 'Á' => 'A', 'À' => 'A', 'Â' => 'A',
        'Ã' => 'A', 'Ä' => 'A', 'Å' => 'A', 'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e', 'É' => 'E', 'È' => 'E',
        'Ê' => 'E', 'Ë' => 'E', 'í' => 'i', 'ì' => 'i', 'î' => 'i', 'ï' => 'i', 'Í' => 'I', 'Ì' => 'I', 'Î' => 'I',
        'Ï' => 'I', 'ó' => 'o', 'ò' => 'o', 'ô' => 'o', 'õ' => 'o', 'ö' => 'o', 'Ó' => 'O', 'Ò' => 'O', 'Ô' => 'O',
        'Õ' => 'O', 'Ö' => 'O', 'ú' => 'u', 'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'Ú' => 'U', 'Ù' => 'U', 'Û' => 'U',
        'Ü' => 'U', 'ç' => 'c', 'Ç' => 'C', 'ñ' => 'n', 'Ñ' => 'N', 'ý' => 'y', 'ÿ' => 'y', 'Ý' => 'Y',
    ];

    public static function limiteBytes(): int
    {
        return Config::obter()->tamanhoMaxAnexoBytes();
    }

    /** @throws AnexoGrande */
    public static function conferirTamanho(string $dados): void
    {
        if (strlen($dados) > self::limiteBytes()) {
            throw new AnexoGrande('arquivo maior que o limite de ' . Config::obter()->tamanho_max_anexo_mb . ' MB');
        }
    }

    /** Remove acentos, caminhos e caracteres que não deveriam virar nome de arquivo. */
    public static function nomeSeguro(?string $nome): string
    {
        $nome = (string) ($nome ?? '');
        $nome = $nome === '' ? 'arquivo' : $nome;
        $partes = explode('/', $nome);
        $nome = (string) end($partes);
        if (class_exists(\Normalizer::class)) {
            $nome = (string) \Normalizer::normalize($nome, \Normalizer::FORM_KD);
        } else {
            $nome = strtr($nome, self::SEM_ACENTO);
        }
        $nome = (string) preg_replace('/[^\x00-\x7F]/', '', $nome);
        $nome = trim((string) preg_replace('/[^A-Za-z0-9._-]+/', '_', $nome), '._-');
        $nome = substr($nome, 0, 120);
        return $nome === '' ? 'arquivo' : $nome;
    }

    /**
     * O tipo informado pelo navegador/provedor, ou o da extensão — CRU, sem
     * filtro. Para gravar, use tipoSeguro(): o informado vem de fora (o
     * remetente de um e-mail escolhe "text/xsl" e o Chromium executaria).
     */
    public static function adivinharTipo(string $nome, ?string $informado = null): string
    {
        if ($informado !== null && str_contains($informado, '/')) {
            return strtolower(trim(explode(';', $informado)[0]));
        }
        $extensao = strtolower((string) pathinfo($nome, PATHINFO_EXTENSION));
        return self::EXTENSOES[$extensao] ?? self::TIPO_PADRAO;
    }

    /**
     * O tipo que fica gravado: confere o anunciado (remetente, navegador,
     * provedor) com os BYTES (fileinfo) e só deixa passar os TIPOS_SEGUROS.
     *
     *  - bytes ou anúncio de família executável: tipo canônico da família
     *    (servido só como download, com CSP sandbox);
     *  - anúncio seguro: fica o anunciado (imagem, PDF, planilha...);
     *  - anúncio desconhecido: o detectado, se for seguro;
     *  - o resto: application/octet-stream.
     */
    public static function tipoSeguro(string $nome, ?string $informado, ?string $dados = null): string
    {
        $anunciado = self::adivinharTipo($nome, $informado);
        if ($anunciado === self::TIPO_PADRAO) {
            $anunciado = self::adivinharTipo($nome); // "application/octet-stream" não diz nada: vale a extensão
        }
        $detectado = $dados === null || $dados === '' ? null : self::detectar($dados);
        if ($detectado !== null && self::executavel($detectado)) {
            return self::neutralizar($detectado);
        }
        if (self::executavel($anunciado)) {
            return self::neutralizar($anunciado);
        }
        if (self::seguro($anunciado) && $anunciado !== self::TIPO_PADRAO) {
            return $anunciado;
        }
        if ($detectado !== null && self::seguro($detectado)) {
            return $detectado;
        }
        return self::TIPO_PADRAO;
    }

    /**
     * Um tipo JÁ gravado, pronto para servir (anexos gravados antes do
     * filtro podem ter "text/xsl" e afins): seguro fica, executável vira o
     * canônico da família, o resto vira application/octet-stream.
     */
    public static function tipoParaServir(string $gravado): string
    {
        $tipo = strtolower(trim(explode(';', $gravado)[0]));
        if (self::executavel($tipo)) {
            return self::neutralizar($tipo);
        }
        return self::seguro($tipo) ? $tipo : self::TIPO_PADRAO;
    }

    private static function seguro(string $tipo): bool
    {
        if (in_array($tipo, self::TIPOS_SEGUROS, true)) {
            return true;
        }
        foreach (self::PREFIXOS_SEGUROS as $prefixo) {
            if (str_starts_with($tipo, $prefixo)) {
                return true;
            }
        }
        return false;
    }

    /** Executável = fora da lista segura e com cara de HTML/XML/SVG/JS ("openxmlformats" é seguro). */
    private static function executavel(string $tipo): bool
    {
        return !self::seguro($tipo) && preg_match(self::EXECUTAVEL, $tipo) === 1;
    }

    /** O canônico da família: todos casam com o filtro de Resposta::arquivo (download + sandbox). */
    private static function neutralizar(string $tipo): string
    {
        return match (true) {
            str_contains($tipo, 'svg') => 'image/svg+xml',
            str_contains($tipo, 'html') => 'text/html',
            str_contains($tipo, 'javascript'), str_contains($tipo, 'ecmascript') => 'text/javascript',
            default => 'application/xml',
        };
    }

    /** Tipo pelos bytes (fileinfo); null quando não há como dizer. */
    private static function detectar(string $dados): ?string
    {
        if (!class_exists(\finfo::class)) {
            return null;
        }
        $tipo = (new \finfo(FILEINFO_MIME_TYPE))->buffer($dados);
        if (!is_string($tipo) || !str_contains($tipo, '/')) {
            return null;
        }
        $tipo = strtolower($tipo);
        return in_array($tipo, ['application/x-empty', 'inode/x-empty'], true) ? null : $tipo;
    }

    /** Caminho absoluto de uma chave, recusando qualquer coisa fora da pasta. */
    public static function caminho(string $chave): string
    {
        if ($chave === '' || preg_match('/^[A-Za-z0-9._-]+$/', $chave) !== 1 || str_starts_with($chave, '.')) {
            throw new \RuntimeException('chave de anexo inválida');
        }
        return Config::obter()->pasta('anexos') . '/' . $chave;
    }

    /** Grava os bytes e devolve a chave. */
    public static function salvar(string $dados, string $nome): string
    {
        $chave = bin2hex(random_bytes(16)) . '-' . self::nomeSeguro($nome);
        $caminho = self::caminho($chave);
        if (@file_put_contents($caminho, $dados, LOCK_EX) === false) {
            throw new \RuntimeException('não foi possível gravar o anexo');
        }
        return $chave;
    }

    /** Bytes guardados de uma chave. */
    public static function ler(string $chave): string
    {
        $caminho = self::caminho($chave);
        if (!is_file($caminho)) {
            throw new \RuntimeException('arquivo não encontrado');
        }
        return (string) file_get_contents($caminho);
    }

    /** Apaga os bytes (a linha em `anexos` é de quem chamou). */
    public static function remover(string $chave): void
    {
        $caminho = self::caminho($chave);
        if (is_file($caminho)) {
            @unlink($caminho);
        }
    }

    /**
     * Guarda um arquivo da mensagem e registra a linha. Devolve o id do anexo.
     *
     * @throws AnexoGrande
     */
    public static function guardar(int $mensagemId, string $nome, string $dados, ?string $tipo = null, ?string $externoId = null): int
    {
        self::conferirTamanho($dados);
        $chave = self::salvar($dados, $nome);
        return Banco::inserir('anexos', [
            'mensagem_id' => $mensagemId,
            'nome' => mb_substr($nome, 0, 160),
            'tipo_conteudo' => mb_substr(self::tipoSeguro($nome, $tipo, $dados), 0, 120),
            'tamanho' => strlen($dados),
            'chave' => $chave,
            'externo_id' => $externoId === null ? null : mb_substr($externoId, 0, 200),
            'erro' => null,
            'criado_em' => Datas::agoraBanco(),
        ]);
    }

    /**
     * Baixa no provedor os arquivos anunciados e os guarda.
     *
     * Falha de download não derruba a mensagem: o anexo fica registrado com o
     * erro, porque o atendente precisa saber que veio um arquivo mesmo quando
     * não foi possível buscá-lo.
     *
     * @param list<AnexoRecebido> $recebidos
     * @return list<array{id: int, nome: string}>
     */
    public static function guardarRecebidos(AdaptadorDeCanal $adaptador, int $mensagemId, array $recebidos): array
    {
        $guardados = [];
        foreach ($recebidos as $recebido) {
            try {
                $dados = $adaptador->baixarAnexo($recebido);
                $id = self::guardar($mensagemId, $recebido->nome, $dados, $recebido->tipo_conteudo, $recebido->referencia);
            } catch (\Exception $erro) {
                Log::aviso("anexo de {$adaptador->tipo()} não baixado", ['erro' => $erro->getMessage()]);
                $id = Banco::inserir('anexos', [
                    'mensagem_id' => $mensagemId,
                    'nome' => mb_substr($recebido->nome, 0, 160),
                    'tipo_conteudo' => mb_substr(self::tipoSeguro($recebido->nome, $recebido->tipo_conteudo), 0, 120),
                    'tamanho' => 0,
                    'chave' => null,
                    'externo_id' => $recebido->referencia === null ? null : mb_substr($recebido->referencia, 0, 200),
                    'erro' => self::erroSeguro($erro),
                    'criado_em' => Datas::agoraBanco(),
                ]);
            }
            $guardados[] = ['id' => $id, 'nome' => $recebido->nome];
        }
        return $guardados;
    }

    /** Arquivo pronto para o adaptador, já conferido e com tipo. @throws AnexoGrande */
    public static function paraEnvio(string $nome, string $dados, ?string $tipo = null): ArquivoParaEnviar
    {
        self::conferirTamanho($dados);
        return new ArquivoParaEnviar($nome, self::tipoSeguro($nome, $tipo, $dados), $dados);
    }

    /**
     * Frase que pode ir para a tela: a de erros "de canal" ou de rede; o resto
     * (que pode carregar URL com token) fica só no log.
     */
    public static function erroSeguro(\Throwable $erro): string
    {
        return Adaptadores::mensagemDeErro($erro);
    }
}

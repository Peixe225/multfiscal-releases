<?php
declare(strict_types=1);

namespace OmniChannel\Nucleo;

/**
 * Um arquivo recebido em multipart/form-data (o UploadFile do FastAPI).
 *
 * O arquivo temporário do PHP some ao fim da requisição: quem quiser guardar
 * lê os bytes (dados()) ou move (moverPara()) para a pasta de dados, que fica
 * fora do public e só é servida pela API.
 */
final class ArquivoEnviado
{
    public function __construct(
        public readonly string $nome,
        public readonly string $tipoInformado,
        public readonly int $tamanho,
        public readonly string $caminhoTemporario,
        public readonly int $erro = UPLOAD_ERR_OK,
    ) {
    }

    /** @param array<string, mixed> $info entrada de $_FILES */
    public static function doUpload(array $info): self
    {
        return new self(
            basename((string) ($info['name'] ?? 'arquivo')),
            (string) ($info['type'] ?? ''),
            (int) ($info['size'] ?? 0),
            (string) ($info['tmp_name'] ?? ''),
            (int) ($info['error'] ?? UPLOAD_ERR_NO_FILE),
        );
    }

    /** Cria a partir de bytes (testes de unidade e anexos baixados de provedores). */
    public static function deBytes(string $nome, string $dados, string $tipo = 'application/octet-stream'): self
    {
        $temporario = tempnam(sys_get_temp_dir(), 'omni');
        file_put_contents($temporario, $dados);
        return new self($nome, $tipo, strlen($dados), $temporario);
    }

    public function ok(): bool
    {
        return $this->erro === UPLOAD_ERR_OK && $this->caminhoTemporario !== '' && is_file($this->caminhoTemporario);
    }

    /** O arquivo passou do limite do PHP (upload_max_filesize) e nem chegou. */
    public function excedeuLimiteDoServidor(): bool
    {
        return $this->erro === UPLOAD_ERR_INI_SIZE || $this->erro === UPLOAD_ERR_FORM_SIZE;
    }

    public function dados(): string
    {
        return $this->ok() ? (string) file_get_contents($this->caminhoTemporario) : '';
    }

    /**
     * Tipo do conteúdo como o cliente informou (o que o FastAPI expõe em
     * UploadFile.content_type); vazio vira application/octet-stream.
     */
    public function tipo(): string
    {
        return $this->tipoInformado !== '' ? $this->tipoInformado : 'application/octet-stream';
    }

    /** Tipo detectado pelos bytes (fileinfo): não confia no que o navegador disse. */
    public function tipoDetectado(): string
    {
        if (!$this->ok() || !class_exists(\finfo::class)) {
            return $this->tipo();
        }
        $detectado = (new \finfo(FILEINFO_MIME_TYPE))->file($this->caminhoTemporario);
        return is_string($detectado) && $detectado !== '' ? $detectado : $this->tipo();
    }
}

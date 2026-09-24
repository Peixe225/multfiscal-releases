<?php
declare(strict_types=1);

namespace IHchat\Anexos;

use IHchat\Atendimento\AnexoGrande;
use IHchat\Atendimento\Anexos;
use IHchat\Atendimento\CanalSemArquivos;
use IHchat\Atendimento\Mensagens;
use IHchat\Auth\Auth;
use IHchat\Banco\Banco;
use IHchat\Nucleo\ArquivoEnviado;
use IHchat\Nucleo\Config;
use IHchat\Nucleo\ErroHttp;
use IHchat\Nucleo\ErroValidacao;
use IHchat\Nucleo\Requisicao;
use IHchat\Nucleo\Resposta;
use IHchat\Nucleo\Roteador;

/**
 * Envio e download de arquivos das conversas (app/api/anexos.py).
 *
 * O download passa pela API, e não por uma pasta pública: assim o arquivo tem
 * a mesma proteção da conversa a que pertence. Os bytes ficam em
 * <pasta_dados>/anexos (Atendimento\Anexos), fora do public.
 */
final class Rotas
{
    /** Tipos que o fileinfo devolve quando não sabe dizer mais que "é binário/texto". */
    private const TIPOS_GENERICOS = [
        'application/octet-stream', 'text/plain', 'application/zip', 'application/x-empty',
        'inode/x-empty', 'application/cdfv2', 'application/x-ole-storage', 'application/encrypted',
    ];

    /**
     * Os ÚNICOS tipos servidos inline (e com o próprio Content-Type): imagens
     * que o painel mostra, PDF, áudio, vídeo e texto puro. Nenhum deles roda
     * script. Todo o resto sai como download, application/octet-stream e CSP
     * sandbox: uma lista negra (html|xml|svg...) deixava passar text/xsl, que
     * o Chromium abre como documento XML e em que executa o script de um
     * elemento XHTML, na origem do painel, com o ?token= do atendente na URL.
     */
    public const TIPOS_INLINE = [
        'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain',
    ];
    /** Famílias inline inteiras (o navegador só toca, não interpreta). */
    private const FAMILIAS_INLINE = ['audio/', 'video/'];

    /** Tipos que nunca são aceitos só pela palavra de quem mandou (o navegador os executaria). */
    private const PADRAO_ATIVO = '#(html|xml|xsl|svg|javascript|ecmascript|script|x-shockwave|x-msdownload)#i';

    public static function registrar(Roteador $r): void
    {
        $r->post('/api/conversas/{conversa_id:int}/anexos', [self::class, 'enviar'], status: 201);
        $r->get('/api/anexos/{anexo_id:int}', [self::class, 'baixar']);
    }

    /**
     * Resposta com arquivo (multipart: `arquivo` e a legenda opcional
     * `conteudo`). O arquivo fica guardado mesmo quando o envio ao provedor
     * falha: o atendente reenvia sem subir de novo.
     */
    public static function enviar(Requisicao $req, array $p): array
    {
        $atendente = Auth::atendente($req);
        $conversaId = (int) $p['conversa_id'];
        if (Banco::valor('SELECT id FROM conversas WHERE id = ?', [$conversaId]) === null) {
            throw ErroHttp::naoEncontrado('conversa nao encontrada');
        }
        $arquivo = $req->arquivo('arquivo');
        if ($arquivo === null) {
            throw ErroValidacao::um('missing', ['body', 'arquivo'], 'arquivo: campo obrigatório');
        }
        if ($arquivo->excedeuLimiteDoServidor()) {
            throw ErroHttp::grandeDemais('arquivo maior que o limite de ' . Config::obter()->tamanho_max_anexo_mb . ' MB');
        }
        $dados = $arquivo->dados();
        if ($dados === '') {
            throw ErroHttp::invalido('arquivo vazio');
        }
        $nome = $arquivo->nome !== '' ? $arquivo->nome : 'arquivo';
        try {
            $paraEnviar = Anexos::paraEnvio($nome, $dados, self::tipo($arquivo, $nome));
            return Mensagens::enviarMensagem($conversaId, trim($req->campo('conteudo') ?? ''), $atendente, [$paraEnviar]);
        } catch (AnexoGrande $erro) {
            throw ErroHttp::grandeDemais($erro->getMessage());
        } catch (CanalSemArquivos $erro) {
            throw ErroHttp::conflito($erro->getMessage());
        }
    }

    /** Download (cabeçalho Authorization ou ?token=, porque <img src> não manda cabeçalho). */
    public static function baixar(Requisicao $req, array $p): Resposta
    {
        Auth::atendenteDeArquivo($req);
        $anexo = Banco::um('SELECT * FROM anexos WHERE id = ?', [(int) $p['anexo_id']]);
        if ($anexo === null) {
            throw ErroHttp::naoEncontrado('anexo não encontrado');
        }
        return self::resposta($anexo);
    }

    /**
     * Resposta com os bytes de um anexo (também serve à rota do widget).
     *
     * @param array<string, mixed> $anexo linha de `anexos`
     */
    public static function resposta(array $anexo): Resposta
    {
        $chave = (string) ($anexo['chave'] ?? '');
        if ($chave === '') {
            $erro = (string) ($anexo['erro'] ?? '');
            throw ErroHttp::naoEncontrado($erro !== '' ? $erro : 'anexo sem conteúdo guardado');
        }
        try {
            $caminho = Anexos::caminho($chave);
        } catch (\RuntimeException $erro) {
            throw ErroHttp::naoEncontrado($erro->getMessage());
        }
        if (!is_file($caminho)) {
            throw ErroHttp::naoEncontrado('arquivo não encontrado');
        }
        // inline só a lista fechada (o painel exibe imagem, PDF, áudio); o nome
        // vale no "salvar como". O resto vai como download inerte e isolado
        $tipo = strtolower(trim(explode(';', (string) $anexo['tipo_conteudo'])[0]));
        if (self::exibivel($tipo)) {
            $resposta = Resposta::arquivo($caminho, $tipo, (string) $anexo['nome'], inline: true);
        } else {
            $resposta = Resposta::arquivo($caminho, 'application/octet-stream', (string) $anexo['nome'], inline: false);
            $resposta->cabecalho('Content-Security-Policy', "sandbox; default-src 'none'");
        }
        $resposta->cabecalho('Cache-Control', 'private, max-age=3600');
        return $resposta;
    }

    /** Pode ser aberto no navegador com o próprio tipo (TIPOS_INLINE)? */
    public static function exibivel(string $tipo): bool
    {
        $tipo = strtolower(trim(explode(';', $tipo)[0]));
        if (in_array($tipo, self::TIPOS_INLINE, true)) {
            return true;
        }
        foreach (self::FAMILIAS_INLINE as $familia) {
            if (str_starts_with($tipo, $familia) && preg_match(self::PADRAO_ATIVO, $tipo) !== 1) {
                return true;
            }
        }
        return false;
    }

    /**
     * O tipo guardado vem dos BYTES (fileinfo), não do que o navegador disse:
     * um HTML enviado como "imagem.png" precisa ser tratado como HTML (e
     * servido só como download). Quando o fileinfo só sabe dizer "binário" ou
     * "texto", vale o informado (ou o da extensão), exceto se ele for um tipo
     * que o navegador executaria.
     */
    public static function tipo(ArquivoEnviado $arquivo, string $nome): string
    {
        $informado = Anexos::adivinharTipo($nome, str_contains($arquivo->tipo(), '/') ? $arquivo->tipo() : null);
        if ($informado === Anexos::TIPO_PADRAO) {
            $informado = Anexos::adivinharTipo($nome);
        }
        $detectado = strtolower($arquivo->tipoDetectado());
        if ($detectado === '' || !str_contains($detectado, '/')) {
            return $informado;
        }
        if (in_array($detectado, self::TIPOS_GENERICOS, true) && self::aceitavelPelaPalavra($informado)) {
            return $informado;
        }
        return $detectado;
    }

    /**
     * Quando os bytes não dizem nada ("texto", "binário"), o tipo informado
     * só vale se for um dos exibíveis ou um tipo comum de documento
     * (application/…, text/csv), nunca um que o navegador executaria.
     */
    private static function aceitavelPelaPalavra(string $tipo): bool
    {
        if (preg_match(self::PADRAO_ATIVO, $tipo) === 1) {
            return false;
        }
        return self::exibivel($tipo) || str_starts_with($tipo, 'application/') || $tipo === 'text/csv';
    }
}

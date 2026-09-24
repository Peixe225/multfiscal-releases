<?php
declare(strict_types=1);

namespace OmniChannel\Canais;

use OmniChannel\Atendimento\AnexoRecebido;
use OmniChannel\Atendimento\MensagemRecebida;
use OmniChannel\Atendimento\ResultadoEnvio;
use OmniChannel\Nucleo\Config;
use OmniChannel\Nucleo\Http\RespostaHttp;
use OmniChannel\Nucleo\Log;

/**
 * Telegram Bot API (app/canais/telegram.py).
 *
 * Recebe de dois jeitos: por webhook (a hospedagem tem HTTPS público, então é
 * o padrão aqui: POST /api/canais/{id}/conectar-webhook faz o setWebhook) ou
 * por polling, em que o cron chama getUpdates uma vez por minuto.
 */
final class AdaptadorTelegram extends Adaptador
{
    public const TIPO = Campos::TELEGRAM;
    public const CAMPOS_OBRIGATORIOS = ['token'];

    public const BASE = 'https://api.telegram.org';
    /** Só o que vira mensagem; o resto (entrada em grupo, enquete...) nem precisa trafegar. */
    public const TIPOS_DE_UPDATE = ['message', 'edited_message', 'channel_post'];

    public const TOKEN_RECUSADO = 'token recusado pelo Telegram: confira se colou o token inteiro que o @BotFather '
        . 'enviou (formato 123456789:ABC...)';

    /** Os tipos que o sendPhoto processa (vaiComoFoto). */
    public const TIPOS_DE_FOTO = ['image/jpeg', 'image/png', 'image/webp'];

    /**
     * A última verificarConexao() achou o bot em modo webhook sem webhook
     * cadastrado: o canal não recebe nada até o setWebhook (Rotas::testar o faz).
     */
    public bool $semWebhookCadastrado = false;

    /** Offset que o próximo getUpdates mandará, quando o lote for gravado. */
    private ?int $aConfirmar = null;

    private function url(string $metodo): string
    {
        return self::BASE . '/bot' . $this->credencial('token') . '/' . $metodo;
    }

    public function modoRecebimento(): string
    {
        $modo = strtolower(trim($this->credencial('modo_recebimento')));
        if ($modo === '') {
            $modo = Campos::modoTelegramPadrao();
        }
        return $modo === 'webhook' ? 'webhook' : 'polling';
    }

    /**
     * Identifica o bot de onde este canal busca: dois canais com o mesmo token
     * buscando dividiriam as conversas de um cliente ao acaso. Vai um resumo
     * do token, nunca o token.
     */
    public function chaveColeta(): ?string
    {
        if (!$this->configurado() || $this->modoRecebimento() === 'webhook') {
            return null;
        }
        return 'telegram:' . substr(hash('sha256', $this->credencial('token')), 0, 16);
    }

    /**
     * Chama um método da Bot API e devolve o `result`, ou ErroCanal legível.
     *
     * @param array<string, mixed> $corpo
     */
    private function chamar(string $metodo, array $corpo = [], ?float $timeout = null): mixed
    {
        $opcoes = ['json' => (object) $corpo];
        if ($timeout !== null) {
            $opcoes['timeout'] = $timeout;
        }
        $resposta = $this->http('POST', $this->url($metodo), $opcoes, 'falha de rede com a API do Telegram');
        $dados = self::objetoJson($resposta);
        $descricao = self::textoDe($dados['description'] ?? null) ?? self::trecho($resposta->corpo, 300);
        // token com formato inválido chega como 404, não 401
        if ($resposta->status === 401 || $resposta->status === 404) {
            throw new ErroCanal(self::TOKEN_RECUSADO);
        }
        if ($resposta->status === 409) {
            throw new ErroCanal(self::explicarConflito($descricao));
        }
        if ($resposta->status >= 400 || ($dados['ok'] ?? false) !== true) {
            throw new ErroCanal("Telegram respondeu {$resposta->status}: {$descricao}");
        }
        return $dados['result'] ?? null;
    }

    /**
     * Nada de ensinar a abrir api.telegram.org/bot<token>/deleteWebhook no
     * navegador: o token iria para o histórico. O botão do painel pede a
     * remoção ao servidor (remover-webhook).
     */
    public static function conflitoWebhook(?string $url = null): string
    {
        $onde = ($url !== null && $url !== '') ? " ({$url})" : '';
        return "o bot tem um webhook ativo{$onde}, e o Telegram não entrega mensagens por polling "
            . "enquanto ele existir. Duas saídas: se esse endereço aponta para este servidor, mude "
            . "'Como receber mensagens' para 'webhook'; ou, para continuar no polling, use "
            . "'Remover webhook' neste canal (ou desligue-o no sistema que o cadastrou) e "
            . 'verifique a conexão de novo';
    }

    /** O 409 do Telegram tem duas causas, e cada uma pede uma ação diferente. */
    private static function explicarConflito(string $descricao): string
    {
        if (str_contains(strtolower($descricao), 'webhook')) {
            return self::conflitoWebhook();
        }
        return 'outro programa está buscando as mensagens deste bot ao mesmo tempo: outra cópia '
            . 'do OmniChannel (neste ou em outro computador) ou outro sistema com o mesmo token. '
            . 'Deixe só um ligado, ou gere um token novo no @BotFather (/revoke) para usar só aqui';
    }

    public function verificarConexao(): string
    {
        if (!$this->configurado()) {
            return parent::verificarConexao();
        }
        $bot = $this->chamar('getMe');
        $bot = is_array($bot) ? $bot : [];
        $webhook = $this->chamar('getWebhookInfo');
        $webhook = is_array($webhook) ? $webhook : [];
        $usuario = self::textoDe($bot['username'] ?? null);
        $nome = $usuario !== null ? "@{$usuario}" : (self::textoDe($bot['first_name'] ?? null) ?? 'o bot');
        $url = self::textoDe($webhook['url'] ?? null);
        if ($this->modoRecebimento() === 'polling' && $url !== null) {
            // sem isso o admin vê "conectado" e as mensagens nunca chegam
            throw new ErroCanal(self::conflitoWebhook($url));
        }
        $this->semWebhookCadastrado = false;
        if ($this->modoRecebimento() === 'webhook') {
            if ($url === null) {
                $this->semWebhookCadastrado = true;
                return "Conectado como {$nome}, mas o bot ainda não tem webhook cadastrado: as "
                    . "mensagens só chegam depois do setWebhook apontando para este servidor";
            }
            $this->conferirWebhook($webhook);
        }
        return "Conectado como {$nome}";
    }

    /**
     * No modo webhook, getMe respondendo não basta: o token pode estar
     * perfeito e as mensagens irem para outro sistema, ou baterem aqui e serem
     * recusadas. O getWebhookInfo já diz as duas coisas.
     *
     * @param array<string, mixed> $info
     */
    private function conferirWebhook(array $info): void
    {
        $url = self::textoDe($info['url'] ?? null) ?? '';
        $esperado = '/webhooks/' . (int) ($this->canal['id'] ?? 0);
        $caminho = rtrim((string) (parse_url($url, PHP_URL_PATH) ?? ''), '/');
        if (!str_ends_with($caminho, $esperado)) {
            throw new ErroCanal(
                "o webhook do bot aponta para outro endereço ({$url}): as mensagens vão para lá, "
                . "não para este canal. Refaça o setWebhook com a URL deste canal, terminada em {$esperado}"
            );
        }
        $falha = trim(self::textoDe($info['last_error_message'] ?? null) ?? '');
        // o Telegram guarda o último erro mesmo depois de resolvido; com entrega
        // pendente, porém, ele ainda está tentando: o erro é atual
        if ($falha !== '' && (int) ($info['pending_update_count'] ?? 0) > 0) {
            $dica = '';
            if (str_contains($falha, '401')) {
                $dica = ' O setWebhook foi feito sem o secret_token deste canal (ou com outro): '
                    . 'use "Conectar webhook" neste canal para refazê-lo com o segredo certo';
            }
            throw new ErroCanal("o Telegram não consegue entregar as mensagens no webhook: {$falha}.{$dica}");
        }
    }

    /**
     * Cadastra no bot o webhook deste canal, com o segredo que o cadastro gerou.
     * Feito pelo servidor: o token nunca aparece em URL nenhuma do navegador.
     */
    public function conectarWebhook(string $url, string $segredo): string
    {
        if (!$this->configurado()) {
            throw new ErroCanal('preencha: ' . Campos::rotulo(self::TIPO, 'token'));
        }
        $this->chamar('setWebhook', [
            'url' => $url,
            'secret_token' => $segredo,
            'allowed_updates' => self::TIPOS_DE_UPDATE,
            // o que chegou enquanto não havia webhook vem na primeira entrega
            'drop_pending_updates' => false,
        ]);
        return "Webhook conectado: o Telegram entrega as mensagens em {$url}";
    }

    /**
     * Apaga o webhook do bot para o polling voltar a receber. Só por clique
     * explícito do admin: outro sistema pode depender desse webhook. As
     * mensagens pendentes ficam (drop_pending_updates falso).
     */
    public function removerWebhook(): string
    {
        if (!$this->configurado()) {
            throw new ErroCanal('preencha: ' . Campos::rotulo(self::TIPO, 'token'));
        }
        $this->chamar('deleteWebhook', ['drop_pending_updates' => false]);
        return 'Webhook removido: o bot volta a entregar as mensagens por polling';
    }

    // ---------------------------------------------------------------- polling

    /** Arquivo com o próximo offset do getUpdates (por canal e token). */
    private function arquivoOffset(): string
    {
        $pasta = Config::obter()->pasta('coleta');
        return $pasta . '/telegram-' . (int) ($this->canal['id'] ?? 0) . '-'
            . substr(hash('sha256', $this->credencial('token')), 0, 16) . '.offset';
    }

    public function coletar(): array
    {
        if (!$this->configurado() || $this->modoRecebimento() === 'webhook') {
            return [];
        }
        $arquivo = $this->arquivoOffset();
        $offset = is_file($arquivo) ? (int) trim((string) file_get_contents($arquivo)) : null;
        // sem espera: o cron roda a cada minuto e não pode ficar preso aqui
        $corpo = ['timeout' => 0, 'allowed_updates' => self::TIPOS_DE_UPDATE];
        if ($offset !== null && $offset > 0) {
            $corpo['offset'] = $offset;
        }
        $resultado = $this->chamar('getUpdates', $corpo, 20.0);
        $updates = is_array($resultado) ? array_values(array_filter($resultado, 'is_array')) : [];

        $ids = array_values(array_filter(array_map(static fn (array $u) => $u['update_id'] ?? null, $updates), 'is_int'));
        // o offset só anda em confirmarColeta(), depois que o lote foi gravado:
        // se andasse aqui, uma falha ao gravar perderia o lote inteiro; assim
        // ele volta e a deduplicação pelo id externo descarta o que já entrou
        $this->aConfirmar = $ids !== [] ? max($ids) + 1 : null;

        $recebidas = [];
        foreach ($updates as $update) {
            try {
                array_push($recebidas, ...$this->analisarWebhook($update));
            } catch (\Throwable $erro) {
                // um update num formato inesperado não pode travar a fila do bot
                Log::excecao($erro, 'telegram: update ' . json_encode($update['update_id'] ?? null) . ' ignorado');
            }
        }
        return $recebidas;
    }

    public function confirmarColeta(): void
    {
        if ($this->aConfirmar === null) {
            return;
        }
        $arquivo = $this->arquivoOffset();
        $atual = is_file($arquivo) ? (int) trim((string) file_get_contents($arquivo)) : 0;
        // o max() impede que uma coleta atrasada faça o offset voltar
        file_put_contents($arquivo, (string) max($atual, $this->aConfirmar), LOCK_EX);
        $this->aConfirmar = null;
    }

    // ---------------------------------------------------------------- entrada

    public function verificarAssinatura(string $corpo, array $cabecalhos): bool
    {
        $segredo = $this->canal['segredo_webhook'] ?? null;
        if (!is_string($segredo) || $segredo === '') {
            return true;
        }
        return hash_equals($segredo, (string) ($cabecalhos['x-telegram-bot-api-secret-token'] ?? ''));
    }

    public function analisarWebhook(array $payload): array
    {
        $msg = null;
        foreach (['message', 'edited_message', 'channel_post'] as $chave) {
            if (is_array($payload[$chave] ?? null) && $payload[$chave] !== []) {
                $msg = $payload[$chave];
                break;
            }
        }
        if ($msg === null) {
            return [];
        }
        $texto = self::textoDe($msg['text'] ?? null) ?? self::textoDe($msg['caption'] ?? null) ?? '';
        $anexos = self::anexosDe($msg);
        if ($texto === '' && $anexos === []) {
            return [];
        }
        $chat = is_array($msg['chat'] ?? null) ? $msg['chat'] : [];
        $autor = is_array($msg['from'] ?? null) ? $msg['from'] : [];
        $chatId = self::textoDe($chat['id'] ?? null);
        if ($chatId === null) {
            return [];
        }
        $partes = array_filter([self::textoDe($autor['first_name'] ?? null), self::textoDe($autor['last_name'] ?? null)]);
        $nome = $partes !== [] ? implode(' ', $partes) : self::textoDe($chat['title'] ?? null);
        $mensagemId = self::textoDe($msg['message_id'] ?? null) ?? 'None';
        return [new MensagemRecebida(
            identificador: $chatId,
            conteudo: $texto,
            nome_exibicao: $nome ?? self::textoDe($autor['username'] ?? null),
            // com o canal: dois bots conversando com o mesmo usuário numeram as
            // mensagens do mesmo jeito (chat.id = id do usuário, message_id desde 1)
            externo_id: $this->prefixarNoCanal("{$chatId}-{$mensagemId}"),
            metadados: ['usuario' => self::textoDe($autor['username'] ?? null)],
            anexos: $anexos,
        )];
    }

    /** @param array<string, mixed> $msg @return list<AnexoRecebido> */
    private static function anexosDe(array $msg): array
    {
        if (is_array($msg['photo'] ?? null) && $msg['photo'] !== []) {
            // o Telegram manda a mesma foto em vários tamanhos; o último é o maior
            $fotos = array_values($msg['photo']);
            $maior = is_array(end($fotos)) ? end($fotos) : [];
            return [new AnexoRecebido('foto.jpg', self::textoDe($maior['file_id'] ?? null), tipo_conteudo: 'image/jpeg')];
        }
        foreach (['document' => null, 'voice' => 'audio.ogg', 'audio' => 'audio.mp3', 'video' => 'video.mp4'] as $especie => $padrao) {
            $arquivo = $msg[$especie] ?? null;
            if (!is_array($arquivo) || $arquivo === []) {
                continue;
            }
            return [new AnexoRecebido(
                nome: self::textoDe($arquivo['file_name'] ?? null) ?? $padrao ?? "{$especie}.bin",
                referencia: self::textoDe($arquivo['file_id'] ?? null),
                tipo_conteudo: self::textoDe($arquivo['mime_type'] ?? null),
            )];
        }
        return [];
    }

    public function baixarAnexo(AnexoRecebido $anexo): string
    {
        if ($anexo->dados !== null) {
            return $anexo->dados;
        }
        if ($anexo->referencia === null || $anexo->referencia === '') {
            throw new ErroCanal('anexo sem file_id');
        }
        // getFile devolve um caminho válido por cerca de uma hora
        $descricao = $this->http('GET', $this->url('getFile'), ['query' => ['file_id' => $anexo->referencia]],
            'falha de rede ao baixar o arquivo');
        // o erro também vem em JSON, e o motivo ("file is too big", o limite de
        // 20 MB do getFile) é o que o atendente precisa ver
        $dados = self::objetoJson($descricao);
        $resultado = is_array($dados['result'] ?? null) ? $dados['result'] : [];
        $caminho = self::textoDe($resultado['file_path'] ?? null);
        if ($caminho === null) {
            $motivo = self::textoDe($dados['description'] ?? null) ?? "resposta {$descricao->status}";
            throw new ErroCanal("o Telegram nao devolveu o arquivo: {$motivo}");
        }
        $arquivo = $this->http('GET', self::BASE . '/file/bot' . $this->credencial('token') . '/' . $caminho, [],
            'falha de rede ao baixar o arquivo');
        if ($arquivo->status >= 400) {
            throw new ErroCanal("download falhou ({$arquivo->status})");
        }
        return $arquivo->corpo;
    }

    // ------------------------------------------------------------------ saída

    public function enviaArquivos(): bool
    {
        return true;
    }

    protected function enviarDeFato(string $destino, string $conteudo, array $contexto): ResultadoEnvio
    {
        $arquivos = $contexto['arquivos'] ?? [];
        if ($arquivos !== []) {
            $arquivo = $arquivos[0];
            $imagem = self::vaiComoFoto($arquivo->tipo_conteudo);
            $resposta = $this->http('POST', $this->url($imagem ? 'sendPhoto' : 'sendDocument'), [
                'multipart' => [
                    ['nome' => 'chat_id', 'valor' => $destino],
                    ['nome' => 'caption', 'valor' => mb_substr($conteudo, 0, 1024)],
                    ['nome' => $imagem ? 'photo' : 'document', 'arquivo' => $arquivo->nome,
                        'dados' => $arquivo->dados, 'tipo' => $arquivo->tipo_conteudo],
                ],
            ], 'falha de rede com a API do Telegram');
        } else {
            $resposta = $this->http('POST', $this->url('sendMessage'),
                ['json' => ['chat_id' => $destino, 'text' => $conteudo]], 'falha de rede com a API do Telegram');
        }
        return $this->resultadoDoEnvio($resposta, $destino);
    }

    /**
     * O sendPhoto recomprime a imagem e só processa JPEG, PNG e WebP: SVG,
     * HEIC ou BMP voltam "IMAGE_PROCESS_FAILED", e um GIF perderia a animação.
     * O resto vai por sendDocument, que entrega qualquer arquivo como está.
     */
    public static function vaiComoFoto(string $tipo): bool
    {
        return in_array(strtolower(trim(explode(';', $tipo)[0])), self::TIPOS_DE_FOTO, true);
    }

    private function resultadoDoEnvio(RespostaHttp $resposta, string $destino): ResultadoEnvio
    {
        if ($resposta->status >= 400) {
            throw new ErroCanal("Telegram respondeu {$resposta->status}: " . self::trecho($resposta->corpo, 300));
        }
        $dados = self::objetoJson($resposta);
        if (($dados['ok'] ?? false) !== true) {
            $descricao = self::textoDe($dados['description'] ?? null) ?? 'None';
            throw new ErroCanal("Telegram recusou o envio: {$descricao}");
        }
        $resultado = is_array($dados['result'] ?? null) ? $dados['result'] : [];
        $id = self::textoDe($resultado['message_id'] ?? null);
        return new ResultadoEnvio(ResultadoEnvio::ENVIADA, $this->prefixarNoCanal($id !== null ? "{$destino}-{$id}" : null));
    }

    private static function textoDe(mixed $valor): ?string
    {
        if (is_string($valor)) {
            return $valor === '' ? null : $valor;
        }
        if (is_int($valor)) {
            return (string) $valor;
        }
        return null;
    }
}

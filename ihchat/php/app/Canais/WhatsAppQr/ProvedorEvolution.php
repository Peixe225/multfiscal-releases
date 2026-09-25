<?php
declare(strict_types=1);

namespace IHchat\Canais\WhatsAppQr;

use IHchat\Atendimento\AnexoRecebido;
use IHchat\Atendimento\ArquivoParaEnviar;
use IHchat\Canais\AdaptadorWhatsAppQr;
use IHchat\Canais\ErroCanal;

/**
 * Evolution API v2: WhatsApp pelo QR Code num servidor próprio (software livre).
 *
 * Rotas conferidas no código-fonte (github.com/evolution-foundation/evolution-api,
 * v2.3.7), não só na documentação, que em dois pontos está desatualizada: o
 * formato de erro e o corpo do webhook/set. Detalhes em ../PROVEDORES-WHATSAPP.md.
 * Mesmo comportamento de app/canais/evolution.py.
 */
final class ProvedorEvolution extends Provedor
{
    public const CHAVE = 'evolution';
    public const ROTULO = 'Evolution API';
    public const NOME = 'a Evolution API';
    public const OBRIGATORIOS = ['url_servidor', 'api_key', 'nome_instancia'];

    /** Eventos que o IHchat assina no webhook/set (os nomes do enum da Evolution). */
    public const EVENTOS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'];

    /** messages.update -> status da mensagem de saída (src/utils/renderStatus.ts) */
    private const STATUS = [
        'SERVER_ACK' => 'enviada',
        'DELIVERY_ACK' => 'entregue',
        'READ' => 'lida',
        'PLAYED' => 'lida',
        'ERROR' => 'falhou',
    ];

    /**
     * Mídia recebida: o webhook é cadastrado com base64=false (a Evolution
     * poria o arquivo inteiro no JSON, e acima do post_max_size da hospedagem
     * a entrega leva 413 e some, legenda junto). O IHchat baixa depois, pela
     * API do próprio servidor Evolution (getBase64FromMediaMessage), mandando
     * a mensagem que veio no webhook: assim não depende do banco da Evolution
     * ter guardado a mensagem. Fica aqui entre a tradução da entrega e o
     * download, na mesma requisição.
     *
     * @var array<string, array<string, mixed>>
     */
    private static array $mensagensABaixar = [];

    /** messageType -> [tipo, nome padrão do arquivo] */
    private const MIDIAS = [
        'imageMessage' => ['image', 'imagem'],
        'videoMessage' => ['video', 'video'],
        'ptvMessage' => ['video', 'video'],
        'audioMessage' => ['audio', 'audio'],
        'documentMessage' => ['document', 'documento'],
        'stickerMessage' => ['sticker', 'figurinha'],
    ];

    // ------------------------------------------------------------ transporte

    private function url(string $caminho): string
    {
        $base = rtrim($this->credencial('url_servidor'), '/');
        // conferido também aqui: um endereço gravado antes da regra (ou à mão)
        // não leva a API key por http:// à internet
        $problema = AdaptadorWhatsAppQr::problemaNoEnderecoEvolution($base);
        if ($problema !== null) {
            throw new ErroCanal('o endereço do servidor Evolution ' . $problema);
        }
        return $base . $caminho;
    }

    public function instancia(): string
    {
        return $this->credencial('nome_instancia');
    }

    private function caminho(string $rota): string
    {
        return $rota . '/' . rawurlencode($this->instancia());
    }

    /**
     * @param array<string, mixed>|null $query
     * @return array{0: int, 1: array<mixed>}
     */
    private function chamar(string $metodo, string $caminho, mixed $corpo = null, ?array $query = null): array
    {
        [$status, $dados, $bruto] = $this->pedir($metodo, $this->url($caminho), $corpo, ['apikey' => $this->credencial('api_key')], $query);
        if (!is_array($dados)) {
            $dados = $status < 400 ? [] : ['message' => mb_substr(trim($bruto), 0, 300)];
        }
        return [$status, $dados];
    }

    /** {"status", "error", "response": {"message": [...]}} (src/main.ts) @param array<mixed> $dados */
    private static function mensagensDoErro(array $dados): ?string
    {
        $dados = Leitura::objeto($dados);
        $resposta = Leitura::objeto($dados['response'] ?? null);
        $mensagens = $resposta['message'] ?? null;
        if (is_array($mensagens) && array_is_list($mensagens)) {
            $partes = [];
            foreach ($mensagens as $m) {
                $parte = Leitura::texto($m) ?? (is_array($m) ? json_encode($m, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : '');
                if ($parte !== '' && $parte !== false) {
                    $partes[] = $parte;
                }
            }
            if ($partes !== []) {
                return implode('; ', $partes);
            }
        }
        return Leitura::texto($mensagens) ?? Leitura::texto($dados['message'] ?? null) ?? Leitura::texto($dados['error'] ?? null);
    }

    /** @param array<mixed> $dados */
    private function explicar(int $status, array $dados): string
    {
        $mensagem = $this->semSegredos(self::mensagensDoErro($dados) ?? "HTTP {$status}");
        if ($status === 401) {
            return "a Evolution API recusou ({$status}): {$mensagem} — confira a API key";
        }
        return "a Evolution API recusou ({$status}): {$mensagem}";
    }

    /** A instância não existe (404 do instanceExistsGuard). @param array<mixed> $dados */
    private static function inexistente(int $status, array $dados): bool
    {
        if ($status !== 404) {
            return false;
        }
        $mensagem = mb_strtolower(self::mensagensDoErro($dados) ?? '');
        return $mensagem === '' || str_contains($mensagem, 'does not exist') || str_contains($mensagem, 'not found');
    }

    /** O webhook do IHchat, igual no webhook/set e no instance/create. @return array<string, mixed> */
    public static function corpoDoWebhook(string $url): array
    {
        return ['enabled' => true, 'url' => $url, 'byEvents' => false, 'base64' => false, 'events' => self::EVENTOS];
    }

    /**
     * Cria a instância (Baileys, com QR Code, ignorando grupos). Com o webhook
     * pedido pelo chamador, ela já nasce entregando ao IHchat (o InstanceDto
     * aceita "webhook"). Sem ele, nasce sem webhook nenhum, e o adaptador avisa
     * ($instanciaCriada) para o webhook gravado sair.
     *
     * @return array<string, mixed>
     */
    private function criarInstancia(): array
    {
        $corpo = [
            'instanceName' => $this->instancia(), 'integration' => 'WHATSAPP-BAILEYS', 'qrcode' => true, 'groupsIgnore' => true,
        ];
        $webhook = $this->adaptador->webhookDaInstancia;
        if ($webhook !== null && $webhook !== '') {
            $corpo['webhook'] = self::corpoDoWebhook($webhook);
        }
        [$status, $dados] = $this->chamar('POST', '/instance/create', $corpo);
        if ($status === 403 && str_contains(self::mensagensDoErro($dados) ?? '', 'already in use')) {
            return []; // criada por outra requisição ao mesmo tempo
        }
        if ($status === 401 || $status === 403) {
            throw new ErroCanal($this->explicar($status, $dados) . '. Para o IHchat criar a instância, use a API key global '
                . 'do servidor (AUTHENTICATION_API_KEY), ou crie a instância no painel da Evolution');
        }
        if ($status >= 400) {
            throw new ErroCanal($this->explicar($status, $dados));
        }
        $this->adaptador->instanciaCriada = true;
        $this->adaptador->webhookNaCriacao = isset($corpo['webhook']);
        return Leitura::objeto($dados);
    }

    /**
     * A API key vale neste servidor? (ErroCanal se não.) Para uma instância que
     * não existe, a Evolution responde 404 ANTES de conferir a chave (os guards
     * rodam na ordem instanceExists, auth): o connectionState não diz nada
     * sobre ela. O fetchInstances passa só pela autenticação: 401/403 com
     * chave errada; com a global, 404 ou a lista.
     */
    private function conferirChave(): void
    {
        [$status, $dados] = $this->chamar('GET', '/instance/fetchInstances', query: ['instanceName' => $this->instancia()]);
        if ($status === 403) {
            throw new ErroCanal($this->explicar($status, $dados) . '. A instância “' . $this->instancia() . '” ainda não existe, e para o '
                . 'IHchat criá-la a API key precisa ser a global do servidor (AUTHENTICATION_API_KEY)');
        }
        if ($status === 401) {
            throw new ErroCanal($this->explicar($status, $dados));
        }
    }

    // ---------------------------------------------------------------- estado

    private function numeroConectado(): ?string
    {
        try {
            [$status, $dados] = $this->chamar('GET', '/instance/fetchInstances', query: ['instanceName' => $this->instancia()]);
        } catch (ErroCanal) {
            return null;
        }
        if ($status >= 400) {
            return null;
        }
        $instancias = array_is_list($dados) ? Leitura::lista($dados) : [Leitura::objeto($dados)];
        foreach ($instancias as $instancia) {
            $numero = Leitura::identificadorDoContato(Leitura::texto($instancia['ownerJid'] ?? null));
            if ($numero !== null) {
                return $numero;
            }
        }
        return null;
    }

    /** @param array<string, mixed> $dados */
    private static function comQr(array $dados): EstadoConexao
    {
        $qr = Leitura::qrComoImagem(Leitura::texto($dados['base64'] ?? null));
        if ($qr === null) {
            return new EstadoConexao(EstadoConexao::AGUARDANDO, mensagem: 'o servidor Evolution ainda está gerando o QR Code; aguarde alguns segundos');
        }
        return new EstadoConexao(EstadoConexao::AGUARDANDO, qr: $qr, mensagem: EstadoConexao::frase(EstadoConexao::AGUARDANDO));
    }

    public function estado(bool $comQr): EstadoConexao
    {
        [$status, $dados] = $this->chamar('GET', $this->caminho('/instance/connectionState'));
        if (self::inexistente($status, $dados)) {
            if (!$comQr) {
                $this->conferirChave();
                return new EstadoConexao(EstadoConexao::DESCONECTADO, mensagem: 'a instância “' . $this->instancia()
                    . '” ainda não existe no servidor Evolution: “Conectar pelo QR Code” a cria');
            }
            return self::comQr(Leitura::objeto($this->criarInstancia()['qrcode'] ?? null));
        }
        if ($status >= 400) {
            throw new ErroCanal($this->explicar($status, $dados));
        }
        $instancia = Leitura::objeto(Leitura::objeto($dados)['instance'] ?? null);
        if (Leitura::texto($instancia['state'] ?? null) === 'open') {
            return EstadoConexao::conectado($this->numeroConectado());
        }
        if (!$comQr) {
            return new EstadoConexao(EstadoConexao::DESCONECTADO, mensagem: EstadoConexao::frase(EstadoConexao::DESCONECTADO));
        }
        [$status, $dados] = $this->chamar('GET', $this->caminho('/instance/connect'));
        if (self::inexistente($status, $dados)) {
            return self::comQr(Leitura::objeto($this->criarInstancia()['qrcode'] ?? null));
        }
        if ($status >= 400) {
            throw new ErroCanal($this->explicar($status, $dados));
        }
        $dados = Leitura::objeto($dados);
        if (Leitura::verdade($dados['error'] ?? null)) {
            return EstadoConexao::erro('a Evolution API recusou: ' . (Leitura::texto($dados['message'] ?? null) ?? 'erro ao conectar'));
        }
        if (Leitura::texto(Leitura::objeto($dados['instance'] ?? null)['state'] ?? null) === 'open') {
            return EstadoConexao::conectado($this->numeroConectado());
        }
        return self::comQr($dados);
    }

    public function desconectar(): string
    {
        [$status, $dados] = $this->chamar('DELETE', $this->caminho('/instance/logout'));
        if ($status < 400) {
            return 'WhatsApp desconectado da Evolution API: para voltar, leia um QR Code novo';
        }
        $mensagem = mb_strtolower(self::mensagensDoErro($dados) ?? '');
        if (self::inexistente($status, $dados) || str_contains($mensagem, 'not connected')) {
            return 'O WhatsApp já estava desconectado';
        }
        throw new ErroCanal($this->explicar($status, $dados));
    }

    public function conectarWebhook(string $url): string
    {
        // base64 false: a mídia é baixada depois (veja $mensagensABaixar)
        $corpo = ['webhook' => self::corpoDoWebhook($url)];
        [$status, $dados] = $this->chamar('POST', $this->caminho('/webhook/set'), $corpo);
        if (self::inexistente($status, $dados)) {
            $this->criarInstancia();
            [$status, $dados] = $this->chamar('POST', $this->caminho('/webhook/set'), $corpo);
        }
        if ($status >= 400) {
            throw new ErroCanal($this->explicar($status, $dados));
        }
        return 'Webhook conectado: a Evolution API passa a entregar as mensagens deste número ao IHchat';
    }

    // ----------------------------------------------------------------- envio

    /** @param array<mixed> $dados */
    private function idEnviado(int $status, array $dados): string
    {
        if ($status >= 400) {
            throw new ErroCanal($this->explicar($status, $dados));
        }
        $id = Leitura::texto(Leitura::objeto(Leitura::objeto($dados)['key'] ?? null)['id'] ?? null);
        if ($id === null) {
            throw new ErroCanal('a Evolution API não devolveu o id da mensagem');
        }
        return $id;
    }

    public function enviarTexto(string $numero, string $texto): string
    {
        return $this->idEnviado(...$this->chamar('POST', $this->caminho('/message/sendText'), ['number' => $numero, 'text' => $texto]));
    }

    public function enviarMidia(string $numero, ArquivoParaEnviar $arquivo, string $legenda): string
    {
        $mime = Leitura::mimeLimpo($arquivo->tipo_conteudo);
        $mime = $mime === '' ? 'application/octet-stream' : $mime;
        $corpo = [
            'number' => $numero,
            'mediatype' => Leitura::especieDeEnvio($mime),
            'mimetype' => $mime,
            // base64 puro (sem "data:"): é o que o isBase64 do servidor aceita
            'media' => base64_encode($arquivo->dados),
            'fileName' => $arquivo->nome,
        ];
        if ($legenda !== '') {
            $corpo['caption'] = $legenda;
        }
        return $this->idEnviado(...$this->chamar('POST', $this->caminho('/message/sendMedia'), $corpo));
    }

    // --------------------------------------------------------------- entrada

    public function analisar(array $payload): Evento
    {
        $evento = new Evento();
        $nome = Leitura::texto($payload['event'] ?? null) ?? '';
        $tipo = str_replace(['.', '-'], '_', strtoupper($nome));
        $instancia = Leitura::texto($payload['instance'] ?? null);
        if ($instancia !== null && $this->instancia() !== '' && $instancia !== $this->instancia()) {
            return $evento; // entrega de outra instância do mesmo servidor
        }
        $dados = $payload['data'] ?? null;
        $itens = is_array($dados) && array_is_list($dados) && $dados !== [] ? Leitura::lista($dados) : [Leitura::objeto($dados)];
        if ($tipo === 'MESSAGES_UPSERT') {
            foreach ($itens as $item) {
                $this->mensagem($item, $evento);
            }
        } elseif ($tipo === 'MESSAGES_UPDATE') {
            foreach ($itens as $item) {
                if (($item['message'] ?? null) !== null || ($item['pollUpdates'] ?? null) !== null) {
                    // edição ou voto em enquete: o Baileys não manda status, e a
                    // Evolution preenche "SERVER_ACK" — não é recibo nenhum
                    continue;
                }
                $novo = self::STATUS[Leitura::texto($item['status'] ?? null) ?? ''] ?? null;
                $id = Leitura::texto($item['keyId'] ?? null) ?? Leitura::texto(Leitura::objeto($item['key'] ?? null)['id'] ?? null);
                // só as NOSSAS mensagens têm recibo a aplicar
                if ($novo !== null && $id !== null && Leitura::verdade($item['fromMe'] ?? null)
                    && Leitura::eConversaPrivada(Leitura::texto($item['remoteJid'] ?? null))) {
                    $evento->recibos[] = ['externo_id' => (string) $this->adaptador->idExterno($id), 'status' => $novo];
                }
            }
        } elseif ($tipo === 'CONNECTION_UPDATE') {
            $estado = $itens === [] ? null : Leitura::texto($itens[0]['state'] ?? null);
            if ($estado === 'open') {
                $evento->conexao = [EstadoConexao::CONECTADO, Leitura::identificadorDoContato(Leitura::texto($itens[0]['wuid'] ?? null))];
            } elseif ($estado === 'close' || $estado === 'refused') {
                $evento->conexao = [EstadoConexao::DESCONECTADO, null];
            }
        } elseif ($tipo === 'QRCODE_UPDATED') {
            $evento->conexao = [EstadoConexao::AGUARDANDO, null];
        } elseif ($tipo === 'LOGOUT_INSTANCE' || $tipo === 'REMOVE_INSTANCE') {
            $evento->conexao = [EstadoConexao::DESCONECTADO, null];
        }
        return $evento;
    }

    /** @param array<string, mixed> $item */
    private function mensagem(array $item, Evento $evento): void
    {
        $chave = Leitura::objeto($item['key'] ?? null);
        $jid = Leitura::texto($chave['remoteJid'] ?? null);
        $alternativo = Leitura::texto($chave['remoteJidAlt'] ?? null);
        $lid = null;
        if (Leitura::eLid($jid) && $alternativo !== null && !Leitura::eLid($alternativo)) {
            // o número de verdade, quando o WhatsApp o dá; o @lid fica ligado a ele
            [$lid, $jid] = [$jid, $alternativo];
        } elseif (Leitura::eLid($alternativo) && !Leitura::eLid($jid)) {
            $lid = $alternativo;
        }
        if (!Leitura::eConversaPrivada($jid)) {
            return;
        }
        $identificador = Leitura::identificadorDoContato($jid);
        if ($identificador === null) {
            return;
        }
        $deMim = Leitura::verdade($chave['fromMe'] ?? null);
        $idMensagem = Leitura::texto($chave['id'] ?? null);
        [$conteudo, $anexos, $especie] = self::conteudo($item, $idMensagem);
        // o pushName de uma mensagem do próprio dono é "Você": não é o contato
        $nome = $deMim ? null : Leitura::texto($item['pushName'] ?? null);
        $mensagem = $this->montar($identificador, $idMensagem, $conteudo, $anexos, $nome, $especie, $lid);
        if ($mensagem !== null) {
            if ($deMim) {
                $evento->doCelular[] = $mensagem;
            } else {
                $evento->recebidas[] = $mensagem;
            }
        }
    }

    /**
     * @param array<string, mixed> $item
     * @return array{0: ?string, 1: list<AnexoRecebido>, 2: ?string}
     */
    private static function conteudo(array $item, ?string $idMensagem): array
    {
        $mensagem = Leitura::objeto($item['message'] ?? null);
        $tipo = Leitura::texto($item['messageType'] ?? null);
        if ($tipo === null) {
            foreach (array_keys($mensagem) as $chave) {
                if (str_ends_with((string) $chave, 'Message') || $chave === 'conversation') {
                    $tipo = (string) $chave;
                    break;
                }
            }
        }
        if ($tipo === 'conversation') {
            return [Leitura::texto($mensagem['conversation'] ?? null) ?? '', [], 'conversation'];
        }
        if ($tipo === 'extendedTextMessage') {
            return [Leitura::texto(Leitura::objeto($mensagem['extendedTextMessage'] ?? null)['text'] ?? null) ?? '', [], $tipo];
        }
        if ($tipo !== null && isset(self::MIDIAS[$tipo])) {
            [$especie, $nomePadrao] = self::MIDIAS[$tipo];
            $midia = Leitura::objeto($mensagem[$tipo] ?? null);
            $mime = Leitura::mimeLimpo(Leitura::texto($midia['mimetype'] ?? null));
            $nome = $especie === 'document'
                ? (Leitura::texto($midia['fileName'] ?? null) ?? Leitura::texto($midia['title'] ?? null))
                : null;
            $nome ??= $nomePadrao . '.' . Leitura::extensao($mime, $especie === 'sticker' ? 'webp' : 'bin');
            // webhook antigo, cadastrado com base64: a mídia já vem aqui. Senão,
            // pela API do servidor Evolution (nunca pela mediaUrl do webhook:
            // uma entrega forjada escolheria o endereço a buscar)
            $dados = Leitura::base64OuNada($mensagem['base64'] ?? null);
            $referencia = null;
            if ($dados === null && $idMensagem !== null) {
                $referencia = $idMensagem;
                // base64 e mediaUrl são acréscimos da Evolution, não da mensagem do WhatsApp
                $proto = $mensagem;
                unset($proto['base64'], $proto['mediaUrl']);
                self::$mensagensABaixar[$referencia] = ['key' => Leitura::objeto($item['key'] ?? null), 'message' => $proto];
            }
            $anexos = [];
            if ($dados !== null || $referencia !== null) {
                $anexos[] = new AnexoRecebido(
                    nome: $nome,
                    referencia: $referencia,
                    dados: $dados,
                    tipo_conteudo: $mime === '' ? null : $mime,
                );
            }
            return [Leitura::texto($midia['caption'] ?? null) ?? '', $anexos, $especie];
        }
        if ($tipo === 'locationMessage') {
            $local = Leitura::objeto($mensagem['locationMessage'] ?? null);
            return ['[localizacao] ' . Leitura::numero($local['degreesLatitude'] ?? null) . ',' . Leitura::numero($local['degreesLongitude'] ?? null), [], 'location'];
        }
        if ($tipo === 'contactMessage') {
            return [trim('[contato] ' . (Leitura::texto(Leitura::objeto($mensagem['contactMessage'] ?? null)['displayName'] ?? null) ?? '')), [], 'contact'];
        }
        if ($tipo === 'buttonsResponseMessage' || $tipo === 'templateButtonReplyMessage') {
            return [Leitura::texto(Leitura::objeto($mensagem[$tipo] ?? null)['selectedDisplayText'] ?? null) ?? '', [], $tipo];
        }
        if ($tipo === 'listResponseMessage') {
            return [Leitura::texto(Leitura::objeto($mensagem[$tipo] ?? null)['title'] ?? null) ?? '', [], $tipo];
        }
        return [null, [], null];
    }

    public function baixar(AnexoRecebido $anexo): string
    {
        $referencia = (string) $anexo->referencia;
        // a mensagem inteira, como veio no webhook: a Evolution baixa por ela
        // mesmo sem tê-la guardado; sem ela, só pelo id (busca no banco dela)
        $mensagem = self::$mensagensABaixar[$referencia] ?? ['key' => ['id' => $referencia]];
        unset(self::$mensagensABaixar[$referencia]);
        [$status, $dados] = $this->chamar('POST', $this->caminho('/chat/getBase64FromMediaMessage'), [
            'message' => $mensagem, 'convertToMp4' => false,
        ]);
        if ($status >= 400) {
            throw new ErroCanal($this->explicar($status, $dados));
        }
        $conteudo = Leitura::base64OuNada(Leitura::objeto($dados)['base64'] ?? null);
        if ($conteudo === null) {
            throw new ErroCanal('a Evolution API não devolveu a mídia');
        }
        return $conteudo;
    }
}

<?php
declare(strict_types=1);

namespace IHchat\Canais\WhatsAppQr;

use IHchat\Atendimento\AnexoRecebido;
use IHchat\Atendimento\ArquivoParaEnviar;
use IHchat\Canais\ErroCanal;

/**
 * Z-API: WhatsApp pelo QR Code num serviço hospedado (brasileiro, pago).
 * Rotas e formatos conferidos na documentação (links em
 * ../PROVEDORES-WHATSAPP.md). Mesmo comportamento de app/canais/zapi.py.
 */
final class ProvedorZApi extends Provedor
{
    public const CHAVE = 'zapi';
    public const ROTULO = 'Z-API';
    public const NOME = 'a Z-API';
    public const OBRIGATORIOS = ['instancia_id', 'instancia_token'];

    public const BASE = 'https://api.z-api.io/instances';

    /**
     * MessageStatusCallback -> status da mensagem de saída. READ_BY_ME é a
     * leitura que o próprio dono fez de uma mensagem RECEBIDA: não é recibo nosso.
     */
    private const STATUS = ['SENT' => 'enviada', 'RECEIVED' => 'entregue', 'READ' => 'lida', 'PLAYED' => 'lida'];

    /** tipo de mensagem -> [campo da URL da mídia, nome padrão do arquivo] */
    private const MIDIAS = [
        'image' => ['imageUrl', 'imagem'],
        'audio' => ['audioUrl', 'audio'],
        'video' => ['videoUrl', 'video'],
        'document' => ['documentUrl', 'documento'],
        'sticker' => ['stickerUrl', 'figurinha'],
    ];

    // ------------------------------------------------------------ transporte

    private function url(string $caminho): string
    {
        return self::BASE . '/' . rawurlencode($this->credencial('instancia_id'))
            . '/token/' . rawurlencode($this->credencial('instancia_token')) . $caminho;
    }

    /** @return array<string, string> */
    private function cabecalhos(): array
    {
        // a Z-API responde 415 sem Content-Type, inclusive no GET
        $cabecalhos = ['Content-Type' => 'application/json'];
        if ($this->credencial('client_token') !== '') {
            $cabecalhos['Client-Token'] = $this->credencial('client_token');
        }
        return $cabecalhos;
    }

    /** JSON-objeto da resposta; status de erro vira ErroCanal explicado. @return array<string, mixed> */
    private function chamar(string $metodo, string $caminho, mixed $corpo = null): array
    {
        [$status, $dados, $bruto] = $this->pedir($metodo, $this->url($caminho), $corpo, $this->cabecalhos());
        $dados = Leitura::objeto($dados);
        if ($status >= 400) {
            throw new ErroCanal($this->explicar($status, $dados, $bruto));
        }
        return $dados;
    }

    /** @param array<string, mixed> $dados */
    private function explicar(int $status, array $dados, string $bruto): string
    {
        $mensagem = Leitura::texto($dados['error'] ?? null) ?? Leitura::texto($dados['message'] ?? null)
            ?? (trim($bruto) !== '' ? mb_substr(trim($bruto), 0, 300) : "HTTP {$status}");
        $mensagem = $this->semSegredos($mensagem);
        $minusculo = mb_strtolower($mensagem);
        if (str_contains($minusculo, 'null not allowed') || str_contains($minusculo, 'client-token') || str_contains($minusculo, 'client token')) {
            $dica = 'confira o Client-Token (painel da Z-API → Segurança → Token de segurança da conta)';
        } elseif (in_array($status, [401, 403, 404], true) || str_contains($minusculo, 'instance not found')) {
            $dica = 'confira o ID e o token da instância no painel da Z-API';
        } else {
            return "a Z-API recusou ({$status}): {$mensagem}";
        }
        return "a Z-API recusou ({$status}): {$mensagem} — {$dica}";
    }

    // ---------------------------------------------------------------- estado

    private function numeroConectado(): ?string
    {
        try {
            $dados = $this->chamar('GET', '/device');
        } catch (ErroCanal) {
            return null; // o número é um detalhe: a conexão já foi confirmada
        }
        return Leitura::identificadorDoContato(Leitura::texto($dados['phone'] ?? null));
    }

    public function estado(bool $comQr): EstadoConexao
    {
        $situacao = $this->chamar('GET', '/status');
        if (Leitura::verdade($situacao['connected'] ?? null)) {
            return EstadoConexao::conectado($this->numeroConectado());
        }
        if (!$comQr) {
            return new EstadoConexao(EstadoConexao::DESCONECTADO, mensagem: EstadoConexao::frase(EstadoConexao::DESCONECTADO));
        }
        $imagem = $this->chamar('GET', '/qr-code/image');
        if (Leitura::verdade($imagem['connected'] ?? null)) {
            return EstadoConexao::conectado($this->numeroConectado());
        }
        if (array_key_exists('challenge', $imagem)) {
            // aparelhos com Chave de Acesso: o WebAuthn é concluído no painel deles
            return EstadoConexao::erro('o WhatsApp pediu a Chave de Acesso (passkey) deste celular: '
                . 'conclua a conexão pelo painel da Z-API');
        }
        $qr = Leitura::qrComoImagem(Leitura::texto($imagem['value'] ?? null));
        if ($qr === null) {
            return new EstadoConexao(EstadoConexao::AGUARDANDO, mensagem: 'a Z-API ainda está gerando o QR Code; aguarde alguns segundos');
        }
        return new EstadoConexao(EstadoConexao::AGUARDANDO, qr: $qr, mensagem: EstadoConexao::frase(EstadoConexao::AGUARDANDO));
    }

    public function desconectar(): string
    {
        $this->chamar('GET', '/disconnect');
        return 'WhatsApp desconectado da Z-API: para voltar, leia um QR Code novo';
    }

    public function conectarWebhook(string $url): string
    {
        // um só endereço para todos os eventos; notifySentByMe faz chegar também
        // o que o dono manda pelo celular (e o histórico fica completo)
        $dados = $this->chamar('PUT', '/update-every-webhooks', ['value' => $url, 'notifySentByMe' => true]);
        if (($dados['value'] ?? null) === false) {
            throw new ErroCanal('a Z-API não aceitou o endereço do webhook');
        }
        return 'Webhook conectado: a Z-API passa a entregar as mensagens deste número ao IHchat';
    }

    // ----------------------------------------------------------------- envio

    /** @param array<string, mixed> $dados */
    private static function idEnviado(array $dados): string
    {
        $id = Leitura::texto($dados['messageId'] ?? null) ?? Leitura::texto($dados['id'] ?? null);
        if ($id === null) {
            $erro = Leitura::texto($dados['error'] ?? null);
            throw new ErroCanal($erro !== null ? "a Z-API não confirmou o envio: {$erro}" : 'a Z-API não devolveu o id da mensagem');
        }
        return $id;
    }

    public function enviarTexto(string $numero, string $texto): string
    {
        return self::idEnviado($this->chamar('POST', '/send-text', ['phone' => $numero, 'message' => $texto]));
    }

    public function enviarMidia(string $numero, ArquivoParaEnviar $arquivo, string $legenda): string
    {
        $mime = Leitura::mimeLimpo($arquivo->tipo_conteudo);
        $mime = $mime === '' ? 'application/octet-stream' : $mime;
        $conteudo = "data:{$mime};base64," . base64_encode($arquivo->dados);
        $especie = Leitura::especieDeEnvio($mime);
        $corpo = ['phone' => $numero];
        if ($especie === 'image') {
            $caminho = '/send-image';
            $corpo['image'] = $conteudo;
        } elseif ($especie === 'video') {
            $caminho = '/send-video';
            $corpo['video'] = $conteudo;
        } else {
            $caminho = '/send-document/' . self::extensaoDoArquivo($arquivo);
            $corpo['document'] = $conteudo;
            $corpo['fileName'] = $arquivo->nome;
        }
        if ($legenda !== '') {
            $corpo['caption'] = $legenda;
        }
        return self::idEnviado($this->chamar('POST', $caminho, $corpo));
    }

    /** A extensão vai no caminho (/send-document/pdf): só letras e números. */
    private static function extensaoDoArquivo(ArquivoParaEnviar $arquivo): string
    {
        $ponto = strrpos($arquivo->nome, '.');
        $bruta = $ponto !== false ? substr($arquivo->nome, $ponto + 1) : Leitura::extensao($arquivo->tipo_conteudo);
        $limpa = substr((string) preg_replace('/[^a-z0-9]/', '', strtolower($bruta)), 0, 10);
        return $limpa === '' ? 'bin' : $limpa;
    }

    // --------------------------------------------------------------- entrada

    public function analisar(array $payload): Evento
    {
        $evento = new Evento();
        $tipo = Leitura::texto($payload['type'] ?? null) ?? '';
        if ($tipo === 'ReceivedCallback') {
            $this->mensagem($payload, $evento);
        } elseif ($tipo === 'MessageStatusCallback') {
            if (!Leitura::verdade($payload['isGroup'] ?? null)) {
                $novo = self::STATUS[Leitura::texto($payload['status'] ?? null) ?? ''] ?? null;
                $ids = is_array($payload['ids'] ?? null) ? $payload['ids'] : [$payload['id'] ?? null];
                foreach ($ids as $bruto) {
                    $id = Leitura::texto($bruto);
                    if ($novo !== null && $id !== null) {
                        $evento->recibos[] = ['externo_id' => (string) $this->adaptador->idExterno($id), 'status' => $novo];
                    }
                }
            }
        } elseif ($tipo === 'DeliveryCallback') {
            $id = Leitura::texto($payload['messageId'] ?? null);
            if ($id !== null && Leitura::texto($payload['error'] ?? null) !== null) {
                $evento->recibos[] = ['externo_id' => (string) $this->adaptador->idExterno($id), 'status' => 'falhou'];
            }
        } elseif ($tipo === 'ConnectedCallback') {
            $evento->conexao = [EstadoConexao::CONECTADO, Leitura::identificadorDoContato(Leitura::texto($payload['phone'] ?? null))];
        } elseif ($tipo === 'DisconnectedCallback') {
            $evento->conexao = [EstadoConexao::DESCONECTADO, null];
        }
        return $evento;
    }

    /** @param array<string, mixed> $payload */
    private function mensagem(array $payload, Evento $evento): void
    {
        $telefone = Leitura::texto($payload['phone'] ?? null);
        if (Leitura::verdade($payload['isGroup'] ?? null) || Leitura::verdade($payload['isNewsletter'] ?? null)
            || Leitura::verdade($payload['broadcast'] ?? null) || !Leitura::eConversaPrivada($telefone)) {
            return;
        }
        $deMim = Leitura::verdade($payload['fromMe'] ?? null);
        if ($deMim && Leitura::verdade($payload['fromApi'] ?? null)) {
            return; // foi o próprio IHchat que mandou: já está no histórico
        }
        $identificador = Leitura::identificadorDoContato($telefone);
        if ($identificador === null) {
            return;
        }
        [$conteudo, $anexos, $especie] = self::conteudo($payload);
        $nome = $deMim
            ? Leitura::texto($payload['chatName'] ?? null)
            : (Leitura::texto($payload['senderName'] ?? null) ?? Leitura::texto($payload['chatName'] ?? null));
        // "phone" pode vir ora com o número, ora com o próprio @lid; o chatLid é
        // o estável (developer.z-api.io/tips/lid). Com os dois, o webhook liga o
        // @lid ao contato do número; só com o @lid, acha o contato por ele —
        // o mesmo cliente não vira duas conversas
        $lid = Leitura::texto($payload['chatLid'] ?? null);
        $mensagem = $this->montar($identificador, Leitura::texto($payload['messageId'] ?? null), $conteudo, $anexos, $nome, $especie, $lid);
        if ($mensagem !== null) {
            if ($deMim) {
                $evento->doCelular[] = $mensagem;
            } else {
                $evento->recebidas[] = $mensagem;
            }
        }
    }

    /**
     * [texto, anexos, tipo]. Texto null = tipo que não vira mensagem (reação...).
     *
     * @param array<string, mixed> $payload
     * @return array{0: ?string, 1: list<AnexoRecebido>, 2: ?string}
     */
    private static function conteudo(array $payload): array
    {
        foreach (self::MIDIAS as $especie => [$campoUrl, $nomePadrao]) {
            $midia = $payload[$especie] ?? null;
            if (!is_array($midia) || $midia === [] || array_is_list($midia)) {
                continue; // vazio não é mídia ({} e [] chegam iguais aqui)
            }
            $url = Leitura::urlDeMidia($midia[$campoUrl] ?? null);
            $mime = Leitura::mimeLimpo(Leitura::texto($midia['mimeType'] ?? null));
            $anexos = [];
            if ($url !== null) {
                $nome = $especie === 'document'
                    ? (Leitura::texto($midia['fileName'] ?? null) ?? Leitura::texto($midia['title'] ?? null))
                    : null;
                $anexos[] = new AnexoRecebido(
                    nome: $nome ?? $nomePadrao . '.' . Leitura::extensao($mime, $especie === 'sticker' ? 'webp' : 'bin'),
                    referencia: $url,
                    tipo_conteudo: $mime === '' ? null : $mime,
                );
            }
            return [Leitura::texto($midia['caption'] ?? null) ?? '', $anexos, $especie];
        }
        $texto = Leitura::objeto($payload['text'] ?? null);
        if ($texto !== []) {
            return [Leitura::texto($texto['message'] ?? null) ?? '', [], 'text'];
        }
        $local = Leitura::objeto($payload['location'] ?? null);
        if ($local !== []) {
            return ['[localizacao] ' . Leitura::numero($local['latitude'] ?? null) . ',' . Leitura::numero($local['longitude'] ?? null), [], 'location'];
        }
        $contato = Leitura::objeto($payload['contact'] ?? null);
        if ($contato !== []) {
            return [trim('[contato] ' . (Leitura::texto($contato['displayName'] ?? null) ?? '')), [], 'contact'];
        }
        foreach (['buttonsResponseMessage', 'listResponseMessage'] as $chave) {
            $resposta = Leitura::objeto($payload[$chave] ?? null);
            if ($resposta !== []) {
                return [Leitura::texto($resposta['message'] ?? null) ?? Leitura::texto($resposta['title'] ?? null) ?? '', [], $chave];
            }
        }
        return [null, [], null];
    }

    public function baixar(AnexoRecebido $anexo): string
    {
        $url = Leitura::urlDeMidia($anexo->referencia);
        if ($url === null) {
            throw new ErroCanal('a Z-API não informou o endereço da mídia');
        }
        return $this->baixarUrl($url);
    }
}

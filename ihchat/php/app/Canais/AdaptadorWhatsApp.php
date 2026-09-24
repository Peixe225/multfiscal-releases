<?php
declare(strict_types=1);

namespace IHchat\Canais;

use IHchat\Atendimento\AnexoRecebido;
use IHchat\Atendimento\ArquivoParaEnviar;
use IHchat\Atendimento\MensagemRecebida;
use IHchat\Atendimento\ResultadoEnvio;
use IHchat\Nucleo\Texto;

/** WhatsApp Cloud API da Meta (app/canais/whatsapp.py). */
final class AdaptadorWhatsApp extends Adaptador
{
    public const TIPO = Campos::WHATSAPP;
    public const CAMPOS_OBRIGATORIOS = ['token', 'id_numero'];

    public const VERSAO_API = 'v20.0';
    public const BASE = 'https://graph.facebook.com/' . self::VERSAO_API;
    private const TIPOS_COM_ARQUIVO = ['image', 'audio', 'video', 'document', 'sticker'];
    /** O que o tipo "image" da Cloud API aceita (especieDaMidia). */
    public const TIPOS_DE_IMAGEM = ['image/jpeg', 'image/png'];

    private const STATUS = [
        'sent' => 'enviada',
        'delivered' => 'entregue',
        'read' => 'lida',
        'failed' => 'falhou',
    ];

    // ------------------------------------------------------------------ estado

    public function verificarConexao(): string
    {
        if (!$this->configurado()) {
            return parent::verificarConexao(); // a base diz o que falta preencher
        }
        $idNumero = $this->credencial('id_numero');
        $resposta = $this->http('GET', self::BASE . '/' . rawurlencode($idNumero), [
            'query' => ['fields' => 'display_phone_number,verified_name'],
            'cabecalhos' => $this->autorizacao(),
        ], 'falha de rede com a API do WhatsApp');
        $dados = self::objetoJson($resposta);
        if ($resposta->status >= 400) {
            throw new ErroCanal(self::explicarErroMeta($resposta->status, $dados, $resposta->corpo));
        }
        $numero = self::texto($dados['display_phone_number'] ?? null) ?? $idNumero;
        $nome = self::texto($dados['verified_name'] ?? null);
        return $nome !== null ? "Conectado ao número {$numero} ({$nome})" : "Conectado ao número {$numero}";
    }

    /** Repete a mensagem da Meta e, nos erros comuns, diz onde corrigir. @param array<string, mixed> $dados */
    public static function explicarErroMeta(int $status, array $dados, string $texto): string
    {
        $erro = is_array($dados['error'] ?? null) ? $dados['error'] : [];
        $mensagem = self::texto($erro['message'] ?? null) ?? (trim($texto) !== '' ? self::trecho($texto, 300) : "HTTP {$status}");
        $codigo = $erro['code'] ?? null;
        if ($codigo === 190 || $status === 401) {
            $dica = 'o token está inválido ou expirou; gere um token permanente (usuário do sistema)';
        } elseif ($codigo === 100) {
            $dica = "confira o ID do número: é o 'Phone number ID', não o telefone";
        } else {
            return "a Meta recusou ({$status}): {$mensagem}";
        }
        return "a Meta recusou ({$status}): {$mensagem} — {$dica}";
    }

    // ------------------------------------------------------------- assinatura

    /**
     * O segredo que confere as entregas e de onde ele veio.
     *
     * A Meta assina com o App Secret do app dela, nunca com um segredo nosso.
     * Ordem: `segredo_app` (o campo da tela); `segredo_webhook` dentro das
     * credenciais (onde o README antigo mandava pôr o App Secret); por último a
     * coluna do canal, que o cadastro antigo enchia com um valor aleatório que a
     * Meta nunca conheceu.
     *
     * @return array{0: ?string, 1: string}
     */
    private function segredoDeAssinatura(): array
    {
        foreach (['segredo_app', 'segredo_webhook'] as $chave) {
            if ($this->preenchido($chave)) {
                return [$this->credencial($chave), 'app_secret'];
            }
        }
        $legado = $this->canal['segredo_webhook'] ?? null;
        if (is_string($legado) && $legado !== '') {
            return [$legado, 'legada'];
        }
        return [null, 'nenhuma'];
    }

    /** "app_secret", "legada" ou "nenhuma": a tela avisa cada caso de um jeito. */
    public function origemAssinatura(): string
    {
        return $this->segredoDeAssinatura()[1];
    }

    /** O que o admin precisa saber mesmo com o token funcionando. */
    public function alertaDeAssinatura(): ?string
    {
        return match ($this->origemAssinatura()) {
            'nenhuma' => 'sem o App Secret, a assinatura das entregas não é conferida: quem souber a URL '
                . 'do webhook pode forjar mensagens de clientes. Preencha-o em Editar',
            // quem semeou a base antes da correção cai aqui sem ter feito nada
            'legada' => 'há um segredo antigo, gerado pelo sistema, que a Meta não conhece: toda entrega '
                . 'da Meta será recusada (401) até você preencher o App Secret em Editar',
            default => null,
        };
    }

    // ---------------------------------------------------------------- entrada

    public function verificarAssinatura(string $corpo, array $cabecalhos): bool
    {
        [$segredo] = $this->segredoDeAssinatura();
        if ($segredo === null) {
            return true;
        }
        return self::assinaturaValida($segredo, $corpo, $cabecalhos['x-hub-signature-256'] ?? null);
    }

    /** HMAC-SHA256 do corpo cru, no formato "sha256=<hex>" da Meta; comparação em tempo constante. */
    public static function assinaturaValida(string $segredo, string $corpo, ?string $cabecalho): bool
    {
        if ($cabecalho === null || $cabecalho === '') {
            return false;
        }
        $partes = explode('=', $cabecalho, 2);
        $recebida = trim(end($partes));
        return hash_equals(hash_hmac('sha256', $corpo, $segredo), $recebida);
    }

    public function desafioVerificacao(array $parametros): ?string
    {
        $esperado = $this->credencial('token_verificacao');
        $enviado = $parametros['hub.verify_token'] ?? null;
        if (($parametros['hub.mode'] ?? null) === 'subscribe' && $esperado !== '' && is_string($enviado)
            && hash_equals($esperado, $enviado)) {
            return (string) ($parametros['hub.challenge'] ?? '');
        }
        return null;
    }

    public function analisarWebhook(array $payload): array
    {
        $recebidas = [];
        foreach ($this->valoresDesteNumero($payload) as $valor) {
            // os dois lados são normalizados: o número pode vir formatado
            $perfis = [];
            foreach (self::lista($valor['contacts'] ?? null) as $contato) {
                $perfil = is_array($contato['profile'] ?? null) ? $contato['profile'] : [];
                $perfis[Texto::normalizarTelefone(self::texto($contato['wa_id'] ?? null) ?? '')] = self::texto($perfil['name'] ?? null);
            }
            foreach (self::lista($valor['messages'] ?? null) as $msg) {
                $conteudo = self::extrairConteudo($msg);
                if ($conteudo === null) {
                    continue;
                }
                $anexos = self::anexosDe($msg);
                if ($conteudo === '' && $anexos === []) {
                    continue; // nada que valha uma mensagem
                }
                $remetente = Texto::normalizarTelefone(self::texto($msg['from'] ?? null) ?? '');
                if ($remetente === '') {
                    continue;
                }
                $recebidas[] = new MensagemRecebida(
                    identificador: $remetente,
                    conteudo: $conteudo,
                    nome_exibicao: $perfis[$remetente] ?? null,
                    externo_id: $this->prefixar(self::texto($msg['id'] ?? null)),
                    metadados: ['tipo_whatsapp' => self::texto($msg['type'] ?? null)],
                    anexos: $anexos,
                );
            }
        }
        return $recebidas;
    }

    /** @param array<string, mixed> $msg @return list<AnexoRecebido> */
    private static function anexosDe(array $msg): array
    {
        $tipo = $msg['type'] ?? null;
        if (!in_array($tipo, self::TIPOS_COM_ARQUIVO, true)) {
            return [];
        }
        $midia = is_array($msg[$tipo] ?? null) ? $msg[$tipo] : [];
        $id = self::texto($midia['id'] ?? null);
        if ($id === null) {
            return [];
        }
        $mime = trim(explode(';', self::texto($midia['mime_type'] ?? null) ?? '')[0]);
        $extensao = str_contains($mime, '/') ? substr($mime, strrpos($mime, '/') + 1) : 'bin';
        return [new AnexoRecebido(
            nome: self::texto($midia['filename'] ?? null) ?? "{$tipo}.{$extensao}",
            referencia: $id,
            tipo_conteudo: $mime !== '' ? $mime : null,
        )];
    }

    /** @param array<string, mixed> $msg */
    private static function extrairConteudo(array $msg): ?string
    {
        $tipo = $msg['type'] ?? null;
        $parte = is_string($tipo) && is_array($msg[$tipo] ?? null) ? $msg[$tipo] : [];
        if ($tipo === 'text') {
            return self::texto($parte['body'] ?? null) ?? '';
        }
        if ($tipo === 'button') {
            return self::texto($parte['text'] ?? null) ?? '';
        }
        if ($tipo === 'interactive') {
            foreach (['button_reply', 'list_reply'] as $chave) {
                if (array_key_exists($chave, $parte)) {
                    return is_array($parte[$chave]) ? (self::texto($parte[$chave]['title'] ?? null) ?? '') : '';
                }
            }
            return null;
        }
        if (in_array($tipo, self::TIPOS_COM_ARQUIVO, true)) {
            // o arquivo vem junto como anexo; sem legenda, a mensagem é só ele
            return self::texto($parte['caption'] ?? null) ?? '';
        }
        if ($tipo === 'location') {
            return '[localizacao] ' . self::numero($parte['latitude'] ?? null) . ',' . self::numero($parte['longitude'] ?? null);
        }
        return null;
    }

    public function analisarStatus(array $payload): array
    {
        $atualizacoes = [];
        foreach ($this->valoresDesteNumero($payload) as $valor) {
            foreach (self::lista($valor['statuses'] ?? null) as $st) {
                // status em formato inesperado (lista, número) é ignorado: como
                // chave de array, derrubava a entrega inteira com TypeError
                $status = self::texto($st['status'] ?? null);
                $novo = $status === null ? null : (self::STATUS[$status] ?? null);
                $id = self::texto($st['id'] ?? null);
                if ($novo !== null && $id !== null) {
                    $atualizacoes[] = ['externo_id' => (string) $this->prefixar($id), 'status' => $novo];
                }
            }
        }
        return $atualizacoes;
    }

    public function baixarAnexo(AnexoRecebido $anexo): string
    {
        if ($anexo->dados !== null) {
            return $anexo->dados;
        }
        if ($anexo->referencia === null || $anexo->referencia === '') {
            throw new ErroCanal('anexo sem referencia de midia');
        }
        // a Meta entrega uma URL temporária, que ainda exige o token
        $metadados = $this->http('GET', self::BASE . '/' . rawurlencode($anexo->referencia),
            ['cabecalhos' => $this->autorizacao()], 'falha de rede ao baixar a midia');
        if ($metadados->status >= 400) {
            throw new ErroCanal("midia indisponivel ({$metadados->status})");
        }
        $url = self::texto(self::objetoJson($metadados)['url'] ?? null);
        if ($url === null) {
            throw new ErroCanal('a resposta da Meta nao trouxe a URL da midia');
        }
        $arquivo = $this->http('GET', $url, ['cabecalhos' => $this->autorizacao()], 'falha de rede ao baixar a midia');
        if ($arquivo->status >= 400) {
            throw new ErroCanal("download da midia falhou ({$arquivo->status})");
        }
        return $arquivo->corpo;
    }

    // ------------------------------------------------------------------ saída

    public function enviaArquivos(): bool
    {
        return true;
    }

    /** A Meta exige subir o arquivo antes de citá-lo numa mensagem. */
    private function subirMidia(ArquivoParaEnviar $arquivo): string
    {
        $resposta = $this->http('POST', self::BASE . '/' . rawurlencode($this->credencial('id_numero')) . '/media', [
            'cabecalhos' => $this->autorizacao(),
            'multipart' => [
                ['nome' => 'messaging_product', 'valor' => 'whatsapp'],
                ['nome' => 'file', 'arquivo' => $arquivo->nome, 'dados' => $arquivo->dados, 'tipo' => $arquivo->tipo_conteudo],
            ],
        ], 'falha de rede ao subir o arquivo');
        if ($resposta->status >= 400) {
            throw new ErroCanal("upload recusado ({$resposta->status}): " . self::trecho($resposta->corpo, 200));
        }
        $id = self::texto(self::objetoJson($resposta)['id'] ?? null);
        if ($id === null) {
            throw new ErroCanal('a Meta nao devolveu o id da midia');
        }
        return $id;
    }

    protected function enviarDeFato(string $destino, string $conteudo, array $contexto): ResultadoEnvio
    {
        $corpo = [
            'messaging_product' => 'whatsapp',
            'recipient_type' => 'individual',
            'to' => Texto::normalizarTelefone($destino),
            'type' => 'text',
            'text' => ['preview_url' => false, 'body' => $conteudo],
        ];
        $arquivos = $contexto['arquivos'] ?? [];
        if ($arquivos !== []) {
            // uma mensagem carrega uma mídia; o texto vira legenda dela
            $arquivo = $arquivos[0];
            $especie = self::especieDaMidia($arquivo->tipo_conteudo);
            $midia = ['id' => $this->subirMidia($arquivo)];
            if ($conteudo !== '') {
                $midia['caption'] = $conteudo;
            }
            if ($especie === 'document') {
                $midia['filename'] = $arquivo->nome;
            }
            unset($corpo['text']);
            $corpo['type'] = $especie;
            $corpo[$especie] = $midia;
        }
        $resposta = $this->http('POST', self::BASE . '/' . rawurlencode($this->credencial('id_numero')) . '/messages', [
            'json' => $corpo,
            'cabecalhos' => $this->autorizacao(),
        ], 'falha de rede com a API do WhatsApp');
        if ($resposta->status >= 400) {
            throw new ErroCanal("WhatsApp respondeu {$resposta->status}: " . self::trecho($resposta->corpo, 300));
        }
        $mensagens = self::objetoJson($resposta)['messages'] ?? null;
        $externo = is_array($mensagens) && is_array($mensagens[0] ?? null) ? self::texto($mensagens[0]['id'] ?? null) : null;
        return new ResultadoEnvio(ResultadoEnvio::ENVIADA, $this->prefixar($externo));
    }

    /**
     * O tipo "image" da Cloud API só aceita JPEG e PNG (WebP é só figurinha):
     * um GIF, SVG ou HEIC como "image" é recusado e a mensagem fica "falhou".
     * Como documento, com o nome, a Meta entrega o que a lista dela aceitar.
     */
    public static function especieDaMidia(string $tipo): string
    {
        return in_array(strtolower(trim(explode(';', $tipo)[0])), self::TIPOS_DE_IMAGEM, true) ? 'image' : 'document';
    }

    // ----------------------------------------------------------- vários números

    /**
     * O número (Phone number ID) de cada "value" da entrega, na ordem.
     *
     * A Meta cadastra a URL do webhook por APP, não por número: com dois
     * números no mesmo app (um por setor, por exemplo), as entregas dos dois
     * chegam na mesma URL, e o metadata.phone_number_id diz de qual é cada uma.
     *
     * @param array<string, mixed> $payload
     * @return list<array{0: ?string, 1: array<string, mixed>}> [número ou null, value]
     */
    public static function valoresPorNumero(array $payload): array
    {
        $saida = [];
        foreach (self::valores($payload) as $valor) {
            $metadados = is_array($valor['metadata'] ?? null) ? $valor['metadata'] : [];
            $saida[] = [self::texto($metadados['phone_number_id'] ?? null), $valor];
        }
        return $saida;
    }

    /** Uma entrega só com os "value" dados (o que outro canal recebe dela). @param list<array<string, mixed>> $valores */
    public static function entregaCom(array $valores): array
    {
        return ['object' => 'whatsapp_business_account', 'entry' => [[
            'changes' => array_map(static fn (array $v): array => ['field' => 'messages', 'value' => $v], $valores),
        ]]];
    }

    /** O Phone number ID deste canal ('' quando não preenchido). */
    public function idNumero(): string
    {
        return trim($this->credencial('id_numero'));
    }

    /**
     * Os "value" que são deste canal: sem metadata (entrega montada à mão) ou
     * sem id_numero cadastrado (sandbox), tudo; senão, só os do seu número.
     * A rota já encaminha os dos outros números ao canal certo; isto garante
     * que, mesmo sem ela, a conversa do número B nunca abre no canal A.
     *
     * @param array<string, mixed> $payload
     * @return list<array<string, mixed>>
     */
    private function valoresDesteNumero(array $payload): array
    {
        $meu = $this->idNumero();
        $valores = [];
        foreach (self::valoresPorNumero($payload) as [$numero, $valor]) {
            if ($numero === null || $meu === '' || $numero === $meu) {
                $valores[] = $valor;
            }
        }
        return $valores;
    }

    // ------------------------------------------------------------------ apoio

    /** @return array<string, string> */
    private function autorizacao(): array
    {
        return ['Authorization' => 'Bearer ' . $this->credencial('token')];
    }

    /** Os "value" de entry[].changes[] do webhook da Meta. @param array<string, mixed> $payload @return list<array<string, mixed>> */
    private static function valores(array $payload): array
    {
        $valores = [];
        foreach (self::lista($payload['entry'] ?? null) as $entrada) {
            foreach (self::lista($entrada['changes'] ?? null) as $mudanca) {
                if (is_array($mudanca['value'] ?? null)) {
                    $valores[] = $mudanca['value'];
                }
            }
        }
        return $valores;
    }

    /** Itens-objeto de uma lista JSON; qualquer outra coisa vira lista vazia. @return list<array<string, mixed>> */
    private static function lista(mixed $valor): array
    {
        if (!is_array($valor)) {
            return [];
        }
        return array_values(array_filter($valor, 'is_array'));
    }

    private static function texto(mixed $valor): ?string
    {
        if (is_string($valor)) {
            return $valor === '' ? null : $valor;
        }
        if (is_int($valor) || is_float($valor)) {
            return (string) $valor;
        }
        return null;
    }

    /** Número como o Python o escreveria (None quando ausente). */
    private static function numero(mixed $valor): string
    {
        if ($valor === null) {
            return 'None';
        }
        if (is_float($valor)) {
            $texto = (string) $valor;
            return str_contains($texto, '.') || str_contains($texto, 'E') ? $texto : $texto . '.0';
        }
        return is_scalar($valor) ? (string) $valor : 'None';
    }
}

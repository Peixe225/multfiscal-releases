<?php
declare(strict_types=1);

namespace IHchat\Simulador;

use IHchat\Atendimento\MensagemRecebida;
use IHchat\Atendimento\Mensagens;
use IHchat\Atendimento\Saidas;
use IHchat\Auth\Auth;
use IHchat\Banco\Banco;
use IHchat\Canais\Adaptador;
use IHchat\Canais\CanalNaoSuportado;
use IHchat\Canais\Canais;
use IHchat\Canais\Registro;
use IHchat\Nucleo\Config;
use IHchat\Nucleo\ErroHttp;
use IHchat\Nucleo\Json;
use IHchat\Nucleo\Requisicao;
use IHchat\Nucleo\Roteador;
use IHchat\Nucleo\Texto;
use IHchat\Nucleo\Validador;

/**
 * Simulador de clientes (app/api/simulador.py): faz o papel do contato no
 * WhatsApp, Telegram e e-mail.
 *
 * Sem credencial de provedor ninguém consegue escrever "como cliente" para
 * testar o atendimento. O simulador monta o JSON que o provedor mandaria no
 * webhook e o entrega ao adaptador do canal, pelo mesmo caminho de um webhook
 * real: o que se testa aqui é o código de produção, não uma imitação dele.
 *
 * Só existe no modo sandbox. Fora dele, qualquer atendente poderia forjar
 * mensagens de cliente na caixa de entrada (e a rota responde 404 antes até
 * de conferir o token: quem procura por ela não aprende nada).
 */
final class Rotas
{
    public const LIMITE_HISTORICO = 200;
    /** O cliente nunca vê o que é da equipe, nem o que o provedor não entregou. */
    public const TIPOS_INTERNOS = ['nota_interna', 'sistema'];
    public const TIPOS_SIMULAVEIS = ['whatsapp', 'telegram', 'email'];
    /**
     * Ajustes que sozinhos não ligam o canal a provedor nenhum: sem token nem
     * servidor, porta e modo de recebimento não recebem nem enviam nada.
     */
    public const AJUSTES_SEM_PROVEDOR = ['modo_recebimento', 'smtp_porta', 'imap_porta', 'imap_pasta'];
    /** O que cabe no assunto da conversa (conversas.assunto VARCHAR(200)). */
    public const ASSUNTO_MAXIMO = 200;
    /** O que o AdaptadorEmail põe no assunto da resposta quando a conversa não tem um. */
    public const ASSUNTO_SEM_ASSUNTO = 'Atendimento';

    public static function registrar(Roteador $r): void
    {
        $r->get('/api/simulador/canais', [self::class, 'canais']);
        $r->post('/api/simulador/mensagens', [self::class, 'escreverComoCliente'], status: 201);
        $r->get('/api/simulador/conversa', [self::class, 'conversaDoCliente']);
    }

    // -------------------------------------------------------------- rotas

    /** @return list<array<string, mixed>> CanalSimulado */
    public static function canais(Requisicao $req): array
    {
        self::exigirSandbox();
        Auth::atendente($req);
        $ativos = Banco::todos('SELECT * FROM canais WHERE ativo = 1 ORDER BY tipo, nome, id');
        return array_map(static fn (array $c): array => self::situacao(Canais::tipar($c)), $ativos);
    }

    /** O atendente escreve como se fosse o cliente. Devolve a MensagemVista. */
    public static function escreverComoCliente(Requisicao $req): array
    {
        self::exigirSandbox();
        $atendente = Auth::atendente($req);
        $v = Validador::corpo($req);
        $canalId = $v->inteiro('canal_id');
        $identificador = $v->texto('identificador', min: 1, max: 200);
        $nome = $v->texto('nome', max: 160, obrigatorio: false);
        $conteudo = $v->texto('conteudo', min: 1, max: 8000, aparar: true);
        // 998 é o limite de uma linha de cabeçalho (RFC 5322). Acima de 200 o
        // assunto é cortado, não recusado: ele só dá nome à conversa
        $assunto = $v->texto('assunto', max: 998, obrigatorio: false);
        $v->validar();

        $canal = self::canalAtivo((int) $canalId);
        $situacao = self::situacao($canal);
        if (!$situacao['disponivel']) {
            throw ErroHttp::conflito((string) $situacao['motivo']);
        }
        $tipo = (string) $canal['tipo'];
        $identificador = self::normalizar($tipo, (string) $identificador);
        // quebra de linha num nome viraria cabeçalho extra no From do e-mail
        $nome = trim((string) preg_replace('/\s+/u', ' ', (string) $nome));
        $nome = $nome === '' ? null : $nome;

        $payload = match ($tipo) {
            'whatsapp' => self::payloadWhatsApp($identificador, $nome, (string) $conteudo),
            'telegram' => self::payloadTelegram($identificador, $nome, (string) $conteudo),
            default => self::payloadEmail($identificador, $nome, (string) $conteudo, $assunto),
        };
        $recebidas = self::adaptador($canal)?->analisarWebhook($payload) ?? [];
        if (count($recebidas) !== 1) {
            throw ErroHttp::invalido('o canal nao reconheceu a mensagem');
        }
        $recebida = $recebidas[0];
        // rastro para auditoria: mensagem de cliente que foi escrita por um atendente
        $extras = ['simulada_por' => (int) $atendente['id']];
        if ($tipo === 'email') {
            // a conversa só guarda o primeiro assunto: sem isto, o cliente que
            // muda de assunto num e-mail seguinte veria o cartão com outro assunto
            $extras['assunto'] = $recebida->assunto;
        }
        $recebida = new MensagemRecebida(
            identificador: $recebida->identificador,
            conteudo: $recebida->conteudo,
            nome_exibicao: $recebida->nome_exibicao,
            externo_id: $recebida->externo_id,
            assunto: $recebida->assunto,
            metadados: array_merge($recebida->metadados, $extras),
            anexos: $recebida->anexos,
        );

        $saida = Mensagens::registrarEntrada($canal, $recebida);
        if ($saida === null) {
            throw ErroHttp::conflito('mensagem duplicada'); // o id externo é sempre novo
        }
        $linha = Banco::um('SELECT * FROM mensagens WHERE id = ?', [(int) $saida['id']]) ?? throw new \RuntimeException('mensagem sumiu');
        return self::vistas([$linha], $canal)[0];
    }

    /** O que o cliente veria no aparelho dele: todas as conversas naquele canal. */
    public static function conversaDoCliente(Requisicao $req): array
    {
        self::exigirSandbox();
        Auth::atendente($req);
        $q = Validador::consulta($req);
        $canalId = $q->inteiro('canal_id');
        $identificador = $q->texto('identificador', min: 1, max: 200);
        $q->validar();

        $canal = self::canalAtivo((int) $canalId);
        $normalizado = self::normalizar((string) $canal['tipo'], (string) $identificador);
        $identidade = Banco::um(
            'SELECT contato_id FROM contato_identidades WHERE canal_tipo = ? AND identificador = ? LIMIT 1',
            [(string) $canal['tipo'], $normalizado]
        );
        if ($identidade === null) {
            return ['contato_id' => null, 'mensagens' => []];
        }
        $contatoId = (int) $identidade['contato_id'];
        $internos = implode(', ', array_fill(0, count(self::TIPOS_INTERNOS), '?'));
        // as mais novas primeiro para o limite cortar o passado, não o presente
        $recentes = Banco::todos(
            "SELECT m.* FROM mensagens m JOIN conversas c ON c.id = m.conversa_id
             WHERE c.contato_id = ? AND c.canal_id = ? AND m.tipo NOT IN ({$internos}) AND m.status <> 'falhou'
             ORDER BY m.criada_em DESC, m.id DESC LIMIT " . self::LIMITE_HISTORICO,
            [$contatoId, (int) $canal['id'], ...self::TIPOS_INTERNOS]
        );
        return ['contato_id' => $contatoId, 'mensagens' => self::vistas(array_reverse($recentes), $canal)];
    }

    // ---------------------------------------------------------- situação

    private static function exigirSandbox(): void
    {
        // 404 e não 403: fora do sandbox a rota simplesmente não existe
        if (!Config::obter()->modo_sandbox) {
            throw ErroHttp::naoEncontrado('simulador desligado fora do modo sandbox');
        }
    }

    /** @param array<string, mixed> $canal */
    private static function adaptador(array $canal): ?Adaptador
    {
        try {
            return Registro::adaptadorPara($canal);
        } catch (CanalNaoSuportado) {
            return null;
        }
    }

    /**
     * Alguma credencial preenchida, mesmo que ainda não dê para enviar.
     *
     * `configurado` mede só o ENVIO: uma caixa só com IMAP, ou um WhatsApp com
     * o App Secret e ainda sem token, já recebe clientes de verdade. Simular
     * ali poria a mensagem forjada na conversa de um cliente real.
     *
     * @param array<string, mixed> $canal
     */
    private static function ligadoAProvedor(array $canal): bool
    {
        foreach ((array) $canal['credenciais'] as $chave => $valor) {
            if (in_array((string) $chave, self::AJUSTES_SEM_PROVEDOR, true)) {
                continue;
            }
            if ($valor !== null && $valor !== '' && $valor !== false && $valor !== 0 && $valor !== 0.0 && $valor !== []) {
                return true;
            }
        }
        return false;
    }

    /**
     * CanalSimulado {id, nome, tipo, disponivel, motivo, link}: dá para simular
     * um cliente naquele canal, e por que não.
     *
     * @param array<string, mixed> $canal linha tipada
     * @return array<string, mixed>
     */
    public static function situacao(array $canal): array
    {
        $base = ['id' => (int) $canal['id'], 'nome' => (string) $canal['nome'], 'tipo' => (string) $canal['tipo']];
        $indisponivel = static fn (string $motivo, ?string $link = null): array
            => $base + ['disponivel' => false, 'motivo' => $motivo, 'link' => $link];
        if ($canal['tipo'] === 'webchat') {
            $link = '/widget/demo?chave=' . ($canal['chave_publica'] ?? '');
            return $indisponivel("o webchat tem widget de verdade: teste em {$link}", $link);
        }
        $adaptador = self::adaptador($canal);
        if ($adaptador === null || !in_array($canal['tipo'], self::TIPOS_SIMULAVEIS, true)) {
            return $indisponivel('o simulador ainda nao imita este canal');
        }
        if ($adaptador->configurado()) {
            // com credencial, a resposta do atendente sairia pela API do
            // provedor para o número ou endereço inventado aqui
            return $indisponivel('canal ligado a um provedor real: a resposta do atendente iria '
                . 'para um numero ou endereco de verdade');
        }
        if (self::ligadoAProvedor($canal)) {
            return $indisponivel('canal com credenciais de um provedor real: ele recebe clientes de '
                . 'verdade, e a mensagem simulada entraria na conversa deles');
        }
        return $base + ['disponivel' => true, 'motivo' => null, 'link' => null];
    }

    /** @return array<string, mixed> linha tipada do canal */
    private static function canalAtivo(int $canalId): array
    {
        $canal = Canais::porId($canalId);
        if ($canal === null || !$canal['ativo']) {
            throw ErroHttp::naoEncontrado('canal nao encontrado ou desativado');
        }
        if (!in_array($canal['tipo'], self::TIPOS_SIMULAVEIS, true)) {
            throw ErroHttp::invalido((string) self::situacao($canal)['motivo']);
        }
        return $canal;
    }

    /**
     * Valida e normaliza como a identidade é gravada. Sem isso, "+55 (33) 9..."
     * e "5533..." virariam dois clientes, e o histórico pedido com um não
     * acharia as mensagens mandadas com o outro.
     */
    private static function normalizar(string $tipo, string $identificador): string
    {
        $bruto = trim($identificador);
        if ($tipo === 'whatsapp') {
            $numero = Texto::normalizarTelefone($bruto);
            if (strlen($numero) < 10 || strlen($numero) > 15) {
                throw ErroHttp::invalido('numero de WhatsApp invalido: use DDI + DDD + numero (10 a 15 digitos)');
            }
            return $numero;
        }
        if ($tipo === 'telegram') {
            // o chat_id é numérico; grupos têm id negativo. Sem (int): um id de
            // 20 dígitos passaria do inteiro do PHP
            if (preg_match('/^(-?)(\d{1,20})$/', $bruto, $m) !== 1) {
                throw ErroHttp::invalido('id do Telegram invalido: e um numero (negativo para grupos)');
            }
            $digitos = ltrim($m[2], '0');
            if ($digitos === '') {
                throw ErroHttp::invalido('id do Telegram invalido: e um numero (negativo para grupos)');
            }
            return $m[1] . $digitos; // como o adaptador grava: o id sem zeros à esquerda
        }
        $email = Validador::normalizarEmail($bruto);
        if ($email === null) {
            throw ErroHttp::invalido('endereco de e-mail invalido');
        }
        return mb_strtolower($email);
    }

    // ----------------------------------------------------------- payloads
    // Cada um devolve o corpo que o provedor mandaria no webhook, com um id
    // externo novo: o adaptador descarta id repetido como reentrega.

    /** @return array<string, mixed> */
    private static function payloadWhatsApp(string $numero, ?string $nome, string $conteudo): array
    {
        $contato = ['wa_id' => $numero];
        if ($nome !== null) {
            $contato['profile'] = ['name' => $nome];
        }
        return [
            'object' => 'whatsapp_business_account',
            'entry' => [[
                'id' => 'simulador',
                'changes' => [[
                    'field' => 'messages',
                    'value' => [
                        'messaging_product' => 'whatsapp',
                        'contacts' => [$contato],
                        'messages' => [[
                            'from' => $numero,
                            'id' => 'wamid.SIM' . bin2hex(random_bytes(16)),
                            'timestamp' => (string) time(),
                            'type' => 'text',
                            'text' => ['body' => $conteudo],
                        ]],
                    ],
                ]],
            ]],
        ];
    }

    /** @return array<string, mixed> */
    private static function payloadTelegram(string $chatId, ?string $nome, string $conteudo): array
    {
        $negativo = str_starts_with($chatId, '-');
        // inteiro como no Telegram, quando cabe; o adaptador lê como texto
        $numero = strlen(ltrim($chatId, '-')) <= 18 ? (int) $chatId : $chatId;
        $chat = ['id' => $numero, 'type' => $negativo ? 'group' : 'private'];
        $autor = ['id' => is_int($numero) ? abs($numero) : ltrim($chatId, '-'), 'is_bot' => false];
        if ($nome !== null) {
            $partes = explode(' ', $nome, 2);
            $autor['first_name'] = $partes[0];
            if (isset($partes[1]) && trim($partes[1]) !== '') {
                $autor['last_name'] = trim($partes[1]);
            }
            if ($negativo) {
                $chat['title'] = $nome;
            }
        }
        return [
            'update_id' => random_int(1, 2 ** 31 - 1),
            'message' => [
                'message_id' => random_int(1, PHP_INT_MAX),
                'date' => time(),
                'chat' => $chat,
                'from' => $autor,
                'text' => $conteudo,
            ],
        ];
    }

    /** @return array<string, mixed> */
    private static function payloadEmail(string $endereco, ?string $nome, string $conteudo, ?string $assunto): array
    {
        $remetente = $endereco;
        if ($nome !== null) {
            // entre aspas, vírgula ou parênteses no nome não quebram o endereço
            $escapado = str_replace(['\\', '"'], ['\\\\', '\\"'], $nome);
            $remetente = "\"{$escapado}\" <{$endereco}>";
        }
        $payload = [
            'from' => $remetente,
            'text' => $conteudo,
            'message-id' => '<' . bin2hex(random_bytes(16)) . '@simulador.ihchat>',
        ];
        $assunto = Texto::resumir($assunto ?? '', self::ASSUNTO_MAXIMO);
        if ($assunto !== '') {
            $payload['subject'] = $assunto;
        }
        return $payload;
    }

    // -------------------------------------------------------------- vista

    /** A regra do AdaptadorEmail: o assunto que o cliente recebe de volta. */
    private static function comoResposta(?string $assunto): string
    {
        $base = $assunto === null || $assunto === '' ? self::ASSUNTO_SEM_ASSUNTO : $assunto;
        return str_starts_with(mb_strtolower($base), 're:') ? $base : "Re: {$base}";
    }

    /**
     * MensagemVista: MensagemSaida + assunto e assunto_conversa (só no e-mail;
     * nos outros canais saem null).
     *
     * @param list<array<string, mixed>> $linhas linhas de `mensagens`, em ordem cronológica
     * @param array<string, mixed> $canal
     * @return list<array<string, mixed>>
     */
    private static function vistas(array $linhas, array $canal): array
    {
        $saidas = Saidas::mensagens($linhas);
        $email = $canal['tipo'] === 'email';
        $assuntos = [];
        if ($email) {
            $ids = array_map(static fn (array $l): int => (int) $l['conversa_id'], $linhas);
            foreach (Saidas::porIds('SELECT id, assunto FROM conversas WHERE id IN (%s)', $ids) as $c) {
                $assuntos[(int) $c['id']] = $c['assunto'] === null || $c['assunto'] === '' ? null : (string) $c['assunto'];
            }
        }
        $batizadas = $email ? self::batizadas($linhas, $assuntos) : [];
        $vistas = [];
        foreach ($linhas as $i => $linha) {
            $vista = $saidas[$i] + ['assunto' => null, 'assunto_conversa' => null];
            if ($email) {
                $conversaId = (int) $linha['conversa_id'];
                $daConversa = $assuntos[$conversaId] ?? null;
                $vista['assunto_conversa'] = $daConversa;
                // o assunto que a conversa tinha quando esta mensagem foi escrita
                $batizadaEm = $batizadas[$conversaId] ?? null;
                $naEpoca = $batizadaEm !== null && (string) $linha['criada_em'] < $batizadaEm ? null : $daConversa;
                $metadados = Json::ler((string) ($linha['metadados'] ?? ''), []);
                if ($linha['direcao'] === 'saida') {
                    $vista['assunto'] = self::comoResposta($naEpoca);
                } elseif (is_array($metadados) && array_key_exists('assunto', $metadados)) {
                    // gravado pelo simulador: o que o cliente digitou
                    $vista['assunto'] = $metadados['assunto'] === null ? null : (string) $metadados['assunto'];
                } else {
                    $vista['assunto'] = $naEpoca;
                }
            }
            $vistas[] = $vista;
        }
        return $vistas;
    }

    /**
     * Quando cada conversa ganhou o assunto que tem hoje, se foi o simulador.
     * O que veio antes dela é de quando a conversa não tinha assunto, e não
     * pode herdar o que só apareceu depois.
     *
     * @param list<array<string, mixed>> $linhas em ordem cronológica
     * @param array<int, ?string> $assuntos assunto atual de cada conversa
     * @return array<int, string> criada_em (formato do banco) por conversa
     */
    private static function batizadas(array $linhas, array $assuntos): array
    {
        $batizadas = [];
        foreach ($linhas as $linha) {
            $conversaId = (int) $linha['conversa_id'];
            if (isset($batizadas[$conversaId])) {
                continue; // fica a primeira
            }
            $metadados = Json::ler((string) ($linha['metadados'] ?? ''), []);
            $proprio = is_array($metadados) ? ($metadados['assunto'] ?? null) : null;
            if ($proprio !== null && $proprio !== '' && $proprio === ($assuntos[$conversaId] ?? null)) {
                $batizadas[$conversaId] = (string) $linha['criada_em'];
            }
        }
        return $batizadas;
    }
}

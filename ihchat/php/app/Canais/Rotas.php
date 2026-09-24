<?php
declare(strict_types=1);

namespace IHchat\Canais;

use IHchat\Atendimento\Mensagens;
use IHchat\Auth\Auth;
use IHchat\Banco\Banco;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\ErroHttp;
use IHchat\Nucleo\Json;
use IHchat\Nucleo\Log;
use IHchat\Nucleo\Requisicao;
use IHchat\Nucleo\Resposta;
use IHchat\Nucleo\Roteador;
use IHchat\Nucleo\Texto;
use IHchat\Nucleo\Validador;

/**
 * Cadastro de canais (app/api/canais.py) e recepção dos webhooks dos
 * provedores (app/api/webhooks.py), com o mesmo contrato HTTP do Python.
 *
 * Só no PHP (a hospedagem tem HTTPS público): conectar-webhook e
 * remover-webhook, que fazem o setWebhook/deleteWebhook do Telegram pelo
 * servidor — o token do bot nunca passa pelo navegador.
 */
final class Rotas
{
    public const NOME_INVALIDO = 'o nome do canal precisa ter de 2 a 120 caracteres (espaços não contam)';

    public static function registrar(Roteador $r): void
    {
        $r->get('/api/canais', [self::class, 'listar']);
        $r->get('/api/canais/tipos', [self::class, 'tipos']);
        $r->post('/api/canais', [self::class, 'criar'], status: 201);
        $r->get('/api/canais/{canal_id:int}/credenciais', [self::class, 'verCredenciais']);
        $r->patch('/api/canais/{canal_id:int}', [self::class, 'atualizar']);
        $r->post('/api/canais/{canal_id:int}/testar', [self::class, 'testar']);
        $r->post('/api/canais/{canal_id:int}/conectar-webhook', [self::class, 'conectarWebhook']);
        $r->post('/api/canais/{canal_id:int}/remover-webhook', [self::class, 'removerWebhook']);
        $r->delete('/api/canais/{canal_id:int}', [self::class, 'remover'], status: 204);

        $r->get('/webhooks/{canal_id:int}', [self::class, 'verificarWebhook']);
        $r->post('/webhooks/{canal_id:int}', [self::class, 'receberWebhook']);
    }

    // ------------------------------------------------------------------ canais

    /** @return list<array<string, mixed>> */
    public static function listar(Requisicao $req): array
    {
        Auth::atendente($req);
        return array_map([Canais::class, 'saida'], Canais::todos());
    }

    /** Campos de credencial de cada tipo: a tela de canais monta o formulário daqui. */
    public static function tipos(Requisicao $req): array
    {
        Auth::atendente($req);
        $saida = [];
        foreach (Campos::todos() as $tipo => $campos) {
            $saida[$tipo] = array_map(
                static fn (array $campo): array => $campo + ['destinos' => Campos::destinosDe($tipo, $campo['chave'])],
                $campos
            );
        }
        return $saida;
    }

    public static function criar(Requisicao $req): array
    {
        Auth::admin($req);
        $v = Validador::corpo($req);
        $nome = self::nome($v, obrigatorio: true);
        $tipo = $v->opcao('tipo', Campos::TIPOS);
        $credenciais = $v->objeto('credenciais', padrao: [], anulavel: false);
        $ativo = $v->booleano('ativo', obrigatorio: false, padrao: true, anulavel: false);
        $v->validar();

        $credenciais = self::comModoEfetivo((string) $tipo, Credenciais::mesclar((string) $tipo, [], $credenciais ?? []));
        $id = Banco::inserir('canais', [
            'nome' => $nome,
            'tipo' => $tipo,
            'ativo' => (bool) $ativo,
            'credenciais' => Json::objeto($credenciais),
            // só o webchat tem chave pública. Telegram e e-mail têm segredo gerado
            // aqui: o do Telegram vai no secret_token do setWebhook, e o do e-mail
            // é o token que o provedor manda ao webhook (AdaptadorEmail). A Meta
            // assina o WhatsApp com o App Secret DELA: um segredo nosso recusaria tudo
            'chave_publica' => $tipo === Campos::WEBCHAT ? Texto::gerarChave('wc_') : null,
            'segredo_webhook' => in_array($tipo, self::TIPOS_COM_SEGREDO, true) ? Texto::gerarChave() : null,
            'criado_em' => Datas::agoraBanco(),
        ]);
        return Canais::saida(self::canal($id));
    }

    public static function verCredenciais(Requisicao $req, array $p): array
    {
        Auth::admin($req);
        $canal = self::garantirSegredo(self::canal($p['canal_id']));
        $tipo = (string) $canal['tipo'];
        $visiveis = [];
        $definidos = [];
        // o modo que o servidor usa de fato: sem ele, a tela supunha "polling"
        // num canal que o servidor tratava como webhook
        foreach (self::comModoEfetivo($tipo, $canal['credenciais']) as $chave => $valor) {
            $chave = (string) $chave;
            if (!Campos::eSecreta($tipo, $chave)) {
                $visiveis[$chave] = $valor;
            } elseif ($valor !== null && $valor !== '' && $valor !== false && $valor !== 0 && $valor !== []) {
                $definidos[] = $chave; // do segredo, o navegador só fica sabendo que existe
            }
        }
        $adaptador = self::adaptadorOuNulo($canal);
        return [
            'credenciais' => Json::objeto($visiveis),
            'secretos_definidos' => $definidos,
            // Telegram: vai no secret_token do setWebhook. E-mail: o token do
            // webhook de entrada (X-IHchat-Token ou ?token=). O de um WhatsApp
            // antigo é legado e não é o que a Meta usa para assinar
            'segredo_webhook' => in_array($tipo, self::TIPOS_COM_SEGREDO, true) ? $canal['segredo_webhook'] : null,
            'chave_publica' => $canal['chave_publica'],
            'campos_obrigatorios' => $adaptador === null ? [] : $adaptador::CAMPOS_OBRIGATORIOS,
            // o valor do segredo legado nunca sai, mas a tela precisa saber que
            // ele existe: com ele, toda entrega da Meta leva 401
            'assinatura' => $adaptador instanceof AdaptadorWhatsApp ? $adaptador->origemAssinatura() : null,
        ];
    }

    public static function atualizar(Requisicao $req, array $p): array
    {
        Auth::admin($req);
        $v = Validador::corpo($req);
        $nome = self::nome($v, obrigatorio: false);
        $credenciais = $v->objeto('credenciais', padrao: null);
        $limpar = $v->lista('limpar', padrao: [], anulavel: false, deTexto: true) ?? [];
        $ativo = $v->booleano('ativo', obrigatorio: false);
        $v->validar();

        $canal = self::canal($p['canal_id']);
        $mudancas = [];
        // antes de mexer no canal: uma credencial recusada não salva o resto pela metade
        $novas = $canal['credenciais'];
        if ($credenciais !== null || $limpar !== []) {
            $novas = self::comModoEfetivo(
                (string) $canal['tipo'],
                Credenciais::mesclar((string) $canal['tipo'], $canal['credenciais'], $credenciais ?? [], $limpar)
            );
            $mudancas['credenciais'] = Json::objeto($novas);
        }
        if ($nome !== null) {
            $mudancas['nome'] = $nome;
        }
        if ($canal['tipo'] === Campos::WHATSAPP && $canal['segredo_webhook'] !== null) {
            // o segredo da coluna só conta sem App Secret nas credenciais, e pelo
            // cadastro antigo era aleatório: com o App Secret preenchido ele
            // morre aqui, senão voltaria a recusar tudo no dia em que o App Secret saísse
            if (in_array('segredo_webhook', $limpar, true)
                || self::preenchido($novas['segredo_app'] ?? null) || self::preenchido($novas['segredo_webhook'] ?? null)) {
                $mudancas['segredo_webhook'] = null;
            }
        }
        if ($ativo !== null) {
            $mudancas['ativo'] = $ativo;
        }
        if ($mudancas !== []) {
            Banco::atualizar('canais', $mudancas, 'id = ?', [$canal['id']]);
        }
        self::garantirSegredo(self::canal($canal['id']));
        return Canais::saida(self::canal($canal['id']));
    }

    /**
     * Confere no provedor se as credenciais funcionam. Sempre 200: credencial
     * errada é o resultado esperado de um teste, não uma falha da requisição.
     */
    public static function testar(Requisicao $req, array $p): array
    {
        Auth::admin($req);
        $canal = self::canal($p['canal_id']);
        try {
            $adaptador = Registro::adaptadorPara($canal);
        } catch (CanalNaoSuportado $erro) {
            return self::teste(false, $erro->getMessage());
        }
        if ($canal['tipo'] === Campos::WEBCHAT && !$canal['ativo']) {
            // sem provedor, o "teste" do webchat é só o canal estar ligado
            return self::teste(false, 'o webchat está desativado: o widget não abre no site até você ativá-lo');
        }
        // com os rótulos do formulário: "preencha: token, id_numero" não diz nada
        $faltando = array_map(static fn (string $c): string => Campos::rotulo((string) $canal['tipo'], $c), $adaptador->faltando());
        if ($faltando !== []) {
            return self::teste(false, 'preencha: ' . implode(', ', $faltando));
        }
        try {
            $mensagem = $adaptador->verificarConexao();
        } catch (ErroCanal $erro) {
            return self::teste(false, $erro->getMessage());
        } catch (\Throwable $erro) {
            // um defeito no adaptador não pode deixar o admin olhando para um 500
            Log::excecao($erro, "verificacao do canal {$canal['id']}");
            return self::teste(false, 'erro inesperado ao verificar a conexão; detalhes no log do servidor');
        }
        // o provedor aceitou, mas "Funcionou" em verde esconderia o que ainda
        // impede (ou ameaça) o canal de receber
        $alertas = [];
        if ($adaptador instanceof AdaptadorWhatsApp && ($alerta = $adaptador->alertaDeAssinatura()) !== null) {
            $alertas[] = $alerta;
        }
        if ($adaptador instanceof AdaptadorTelegram && $adaptador->semWebhookCadastrado) {
            // modo webhook sem setWebhook: o canal não recebe nada. Com endereço
            // público HTTPS, o "Salvar e testar" já deixa o canal recebendo
            if ($canal['ativo'] && self::urlPublicaHttps()) {
                $conexao = self::conectarTelegram($canal);
                if (!$conexao['ok']) {
                    return self::teste(false, $mensagem . '; ao cadastrar o webhook: ' . $conexao['mensagem']);
                }
                $mensagem = preg_replace('/, mas o bot ainda não tem webhook cadastrado.*$/u', '', $mensagem) . '. ' . $conexao['mensagem'];
            } else {
                $alertas[] = 'o bot ainda não tem webhook cadastrado: nenhuma mensagem chega até você usar '
                    . "'Conectar webhook' (com o endereço público HTTPS) ou trocar para 'polling'";
            }
        }
        if (!$canal['ativo']) {
            $alertas[] = 'o canal está desativado: não recebe mensagens novas até você ativá-lo';
        }
        return self::teste(true, $mensagem, $alertas === [] ? null : implode('; ', $alertas));
    }

    /**
     * Telegram: cadastra no bot o webhook deste canal (url_publica + /webhooks/{id})
     * com o secret_token do canal, e passa o canal para o modo webhook.
     * Sempre 200 com {ok, mensagem, alerta}, como o testar.
     */
    public static function conectarWebhook(Requisicao $req, array $p): array
    {
        Auth::admin($req);
        $canal = self::canal($p['canal_id']);
        if ($canal['tipo'] !== Campos::TELEGRAM) {
            return self::teste(false, $canal['tipo'] === Campos::WHATSAPP
                ? 'no WhatsApp o webhook é cadastrado no painel da Meta: use a URL ' . Canais::urlWebhook($canal['id'])
                    . ' e o token de verificação deste canal'
                : 'este tipo de canal não tem webhook a conectar');
        }
        return self::conectarTelegram($canal);
    }

    /**
     * setWebhook do canal Telegram com o segredo dele, e o canal passa ao modo
     * webhook. Usado pelo botão "Conectar webhook" e pelo testar.
     *
     * @param array<string, mixed> $canal
     * @return array{ok: bool, mensagem: string, alerta: ?string}
     */
    private static function conectarTelegram(array $canal): array
    {
        if (!self::urlPublicaHttps()) {
            return self::teste(false, 'o endereço público desta instalação (url_publica, com https) não está configurado: '
                . 'o Telegram só entrega mensagens num endereço HTTPS público. Enquanto isso, use o modo polling');
        }
        $adaptador = new AdaptadorTelegram($canal);
        if (!$adaptador->configurado()) {
            return self::teste(false, 'preencha: ' . Campos::rotulo(Campos::TELEGRAM, 'token'));
        }
        $segredo = $canal['segredo_webhook'];
        if ($segredo === null) {
            // canal cadastrado à mão, sem segredo: sem ele qualquer um que
            // soubesse a URL poderia forjar mensagens de clientes
            $segredo = Texto::gerarChave();
            Banco::atualizar('canais', ['segredo_webhook' => $segredo], 'id = ?', [$canal['id']]);
            $canal['segredo_webhook'] = $segredo;
            $adaptador = new AdaptadorTelegram($canal);
        }
        try {
            $mensagem = $adaptador->conectarWebhook(Canais::urlWebhook($canal['id']), $segredo);
        } catch (ErroCanal $erro) {
            return self::teste(false, $erro->getMessage());
        }
        self::definirModo($canal, 'webhook');
        $alerta = $canal['ativo'] ? null : 'o canal está desativado: as entregas do Telegram serão recusadas (409) até você ativá-lo';
        return self::teste(true, $mensagem, $alerta);
    }

    /** Telegram: apaga o webhook do bot e volta o canal ao polling (cron). */
    public static function removerWebhook(Requisicao $req, array $p): array
    {
        Auth::admin($req);
        $canal = self::canal($p['canal_id']);
        if ($canal['tipo'] !== Campos::TELEGRAM) {
            return self::teste(false, 'este tipo de canal não tem webhook a remover');
        }
        try {
            $mensagem = (new AdaptadorTelegram($canal))->removerWebhook();
        } catch (ErroCanal $erro) {
            return self::teste(false, $erro->getMessage());
        }
        self::definirModo($canal, 'polling');
        return self::teste(true, $mensagem);
    }

    public static function remover(Requisicao $req, array $p): void
    {
        Auth::admin($req);
        $canal = self::canal($p['canal_id']);
        $conversas = (int) Banco::valor('SELECT COUNT(*) FROM conversas WHERE canal_id = ?', [$canal['id']]);
        if ($conversas > 0) {
            // "um cliente, um histórico": apagar o canal levaria junto as conversas
            throw ErroHttp::conflito(
                "o canal tem {$conversas} conversa(s) no histórico e não pode ser removido; "
                . 'desative-o para parar de receber sem perder nada'
            );
        }
        Banco::executar('DELETE FROM canais WHERE id = ?', [$canal['id']]);
    }

    // ---------------------------------------------------------------- webhooks

    /** Handshake de verificação exigido por alguns provedores (Meta). */
    public static function verificarWebhook(Requisicao $req, array $p): Resposta
    {
        $canal = self::canalAtivo($p['canal_id']);
        $adaptador = self::adaptadorOuNulo($canal);
        $desafio = $adaptador?->desafioVerificacao($req->consulta);
        if ($desafio === null) {
            throw ErroHttp::proibido('verificacao recusada');
        }
        return Resposta::texto($desafio);
    }

    /**
     * Recebe uma entrega do provedor: confere a assinatura sobre o corpo CRU,
     * traduz, grava (idempotente pelo id externo) e aplica os recibos.
     * Os anexos são baixados antes de cada transação (Mensagens::registrarEntrada).
     */
    public static function receberWebhook(Requisicao $req, array $p): array
    {
        $canal = self::canalAtivo($p['canal_id']);
        try {
            $adaptador = Registro::adaptadorPara($canal);
        } catch (CanalNaoSuportado $erro) {
            throw new ErroHttp(400, $erro->getMessage());
        }
        if (!$adaptador->recebeWebhook()) {
            throw ErroHttp::naoEncontrado('este canal nao recebe por webhook');
        }
        $corpo = $req->corpoBruto();
        $cabecalhos = $req->cabecalhos();
        // o token do webhook de e-mail pode vir na URL cadastrada no provedor
        // (SendGrid e Mailgun não deixam escolher cabeçalhos)
        $token = $req->consulta('token');
        if (!isset($cabecalhos['x-ihchat-token']) && $token !== null && $token !== '') {
            $cabecalhos['x-ihchat-token'] = $token;
        }
        if (!$adaptador->verificarAssinatura($corpo, $cabecalhos)) {
            throw ErroHttp::naoAutorizado('assinatura invalida');
        }

        if ($adaptador instanceof AdaptadorEmail && self::eFormulario($req)) {
            // SendGrid Inbound Parse e Mailgun entregam em formulário, não em JSON
            $lotes = [[$canal, $adaptador, $adaptador->analisarFormulario($req->formulario, $req->arquivos), []]];
        } else {
            $payload = self::objetoDoCorpo($corpo);
            $lotes = [];
            foreach (self::destinos($canal, $adaptador, $payload) as [$destino, $adaptadorDestino, $parte]) {
                $lotes[] = [$destino, $adaptadorDestino, $adaptadorDestino->analisarWebhook($parte), $adaptadorDestino->analisarStatus($parte)];
            }
        }

        $novas = 0;
        $atualizadas = 0;
        foreach ($lotes as [$destino, , $recebidas, $recibos]) {
            foreach ($recebidas as $recebida) {
                if (self::gravarRecebida($destino, $recebida) !== null) { // null = reentrega do mesmo webhook
                    $novas++;
                }
            }
            $atualizadas += count(Mensagens::aplicarStatusExterno($recibos));
        }
        return ['recebidas' => $novas, 'status_atualizados' => $atualizadas];
    }

    /**
     * A que canal vai cada parte da entrega. Só o WhatsApp divide: a Meta
     * manda as entregas de TODOS os números do app para a URL cadastrada no
     * app, e cada "value" diz o número (metadata.phone_number_id). A parte de
     * outro número vai para o canal WhatsApp ativo daquele número; a de um
     * número que nenhum canal tem é descartada (com aviso no log), para a
     * conversa do número B nunca abrir no canal A e ser respondida pelo A.
     * A assinatura já foi conferida: os números do mesmo app têm o mesmo App Secret.
     *
     * @param array<string, mixed> $canal
     * @param array<string, mixed> $payload
     * @return list<array{0: array<string, mixed>, 1: Adaptador, 2: array<string, mixed>}>
     */
    private static function destinos(array $canal, Adaptador $adaptador, array $payload): array
    {
        if (!$adaptador instanceof AdaptadorWhatsApp) {
            return [[$canal, $adaptador, $payload]];
        }
        $meu = $adaptador->idNumero();
        $porNumero = null;
        $grupos = [];
        foreach (AdaptadorWhatsApp::valoresPorNumero($payload) as [$numero, $valor]) {
            $destino = $canal;
            if ($numero !== null && $numero !== $meu) {
                $porNumero ??= self::whatsappPorNumero();
                if (isset($porNumero[$numero])) {
                    $destino = $porNumero[$numero];
                } elseif ($meu !== '') {
                    Log::aviso("webhook do canal {$canal['id']}: entrega do número {$numero}, que nenhum canal WhatsApp ativo tem; descartada");
                    continue;
                }
                // sem id_numero neste canal (sandbox) e número sem dono: fica aqui
            }
            $grupos[$destino['id']] ??= [$destino, []];
            $grupos[$destino['id']][1][] = $valor;
        }
        $saida = [];
        foreach ($grupos as [$destino, $valores]) {
            $saida[] = [
                $destino,
                $destino['id'] === $canal['id'] ? $adaptador : new AdaptadorWhatsApp($destino),
                AdaptadorWhatsApp::entregaCom($valores),
            ];
        }
        return $saida;
    }

    /** Canais WhatsApp ativos pelo Phone number ID (o de menor id, se repetido). @return array<string, array<string, mixed>> */
    private static function whatsappPorNumero(): array
    {
        $mapa = [];
        foreach (Canais::todos(soAtivos: true) as $outro) {
            if ($outro['tipo'] !== Campos::WHATSAPP) {
                continue;
            }
            $numero = (new AdaptadorWhatsApp($outro))->idNumero();
            if ($numero !== '' && !isset($mapa[$numero])) {
                $mapa[$numero] = $outro;
            }
        }
        return $mapa;
    }

    private static function eFormulario(Requisicao $req): bool
    {
        return in_array($req->tipoConteudo(), ['multipart/form-data', 'application/x-www-form-urlencoded'], true);
    }

    /**
     * Grava uma mensagem recebida, com uma segunda tentativa em corrida de
     * unicidade (o mesmo cliente escrevendo a dois canais ao mesmo tempo cria
     * a identidade dele nas duas requisições; na segunda, a consulta já a vê).
     *
     * @param array<string, mixed> $canal
     * @return array<string, mixed>|null MensagemSaida, ou null se repetida
     */
    public static function gravarRecebida(array $canal, \IHchat\Atendimento\MensagemRecebida $recebida): ?array
    {
        try {
            return Mensagens::registrarEntrada($canal, $recebida);
        } catch (\PDOException $erro) {
            if (!Banco::eUnicidade($erro)) {
                throw $erro;
            }
            return Mensagens::registrarEntrada($canal, $recebida);
        }
    }

    // ------------------------------------------------------------------- apoio

    /** @return array<string, mixed> */
    private static function objetoDoCorpo(string $corpo): array
    {
        if (trim($corpo) === '') {
            return [];
        }
        try {
            $objeto = json_decode($corpo, false, 512, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
        } catch (\JsonException) {
            throw new ErroHttp(400, 'corpo nao e JSON valido');
        }
        if (!$objeto instanceof \stdClass) {
            throw new ErroHttp(400, 'corpo deve ser um objeto JSON');
        }
        return (array) json_decode($corpo, true, 512, JSON_BIGINT_AS_STRING);
    }

    /** @return array<string, mixed> */
    private static function canal(int $id): array
    {
        return Canais::porId($id) ?? throw ErroHttp::naoEncontrado('canal nao encontrado');
    }

    /** @return array<string, mixed> */
    private static function canalAtivo(int $id): array
    {
        $canal = self::canal($id);
        if (!$canal['ativo']) {
            throw ErroHttp::conflito('canal desativado');
        }
        return $canal;
    }

    /** @param array<string, mixed> $canal */
    private static function adaptadorOuNulo(array $canal): ?Adaptador
    {
        try {
            return Registro::adaptadorPara($canal);
        } catch (CanalNaoSuportado) {
            return null;
        }
    }

    /** Apara antes de medir: "   " passava e virava um canal sem nome nos filtros. */
    private static function nome(Validador $v, bool $obrigatorio): ?string
    {
        if (!$v->tem('nome') || $v->dados()['nome'] === null) {
            return $v->texto('nome', obrigatorio: $obrigatorio);
        }
        $valor = $v->texto('nome');
        if ($valor === null) {
            return null;
        }
        $valor = trim($valor);
        $tamanho = mb_strlen($valor);
        if ($tamanho < 2 || $tamanho > 120) {
            $v->falhar('nome', self::NOME_INVALIDO, 'nome_do_canal');
            return null;
        }
        return $valor;
    }

    /** Tipos cujo cadastro gera segredo_webhook (Telegram: secret_token; e-mail: token do webhook). */
    private const TIPOS_COM_SEGREDO = [Campos::TELEGRAM, Campos::EMAIL];

    /**
     * Telegram sem modo_recebimento ganha o modo padrão desta instalação
     * GRAVADO: o painel, o Coletor e o app Python (cujo padrão é polling)
     * passam a ver o mesmo modo, em vez de cada um supor o seu.
     *
     * @param array<string, mixed> $credenciais
     * @return array<string, mixed>
     */
    private static function comModoEfetivo(string $tipo, array $credenciais): array
    {
        $modo = $credenciais['modo_recebimento'] ?? null;
        if ($tipo === Campos::TELEGRAM && (!is_string($modo) || trim($modo) === '')) {
            $credenciais['modo_recebimento'] = Campos::modoTelegramPadrao();
        }
        return $credenciais;
    }

    /**
     * Canal de e-mail cadastrado antes do segredo (ou gravado à mão) ganha um
     * na primeira vez que o admin o abre: sem segredo o webhook recusa tudo.
     *
     * @param array<string, mixed> $canal
     * @return array<string, mixed>
     */
    private static function garantirSegredo(array $canal): array
    {
        if ($canal['tipo'] === Campos::EMAIL && $canal['segredo_webhook'] === null) {
            $canal['segredo_webhook'] = Texto::gerarChave();
            Banco::atualizar('canais', ['segredo_webhook' => $canal['segredo_webhook']], 'id = ?', [$canal['id']]);
        }
        return $canal;
    }

    private static function urlPublicaHttps(): bool
    {
        return str_starts_with(strtolower(Canais::urlPublica()), 'https://');
    }

    /** @param array<string, mixed> $canal */
    private static function definirModo(array $canal, string $modo): void
    {
        $credenciais = $canal['credenciais'];
        $credenciais['modo_recebimento'] = $modo;
        Banco::atualizar('canais', ['credenciais' => Json::objeto($credenciais)], 'id = ?', [$canal['id']]);
    }

    private static function preenchido(mixed $valor): bool
    {
        return !($valor === null || $valor === '' || $valor === false || $valor === 0 || $valor === []);
    }

    /** TesteConexaoSaida: {ok, mensagem, alerta}. @return array{ok: bool, mensagem: string, alerta: ?string} */
    private static function teste(bool $ok, string $mensagem, ?string $alerta = null): array
    {
        return ['ok' => $ok, 'mensagem' => $mensagem, 'alerta' => $alerta];
    }
}

<?php
declare(strict_types=1);

namespace IHchat\Widget;

use IHchat\Anexos\Rotas as RotasAnexos;
use IHchat\Atendimento\AnexoGrande;
use IHchat\Atendimento\AnexoRecebido;
use IHchat\Atendimento\Anexos;
use IHchat\Atendimento\MensagemRecebida;
use IHchat\Atendimento\Mensagens;
use IHchat\Atendimento\Saidas;
use IHchat\Banco\Banco;
use IHchat\Canais\Canais;
use IHchat\Eventos\Eventos;
use IHchat\Eventos\Rotas as RotasEventos;
use IHchat\Nucleo\Aplicacao;
use IHchat\Nucleo\Config;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\ErroHttp;
use IHchat\Nucleo\ErroValidacao;
use IHchat\Nucleo\Requisicao;
use IHchat\Nucleo\Roteador;
use IHchat\Nucleo\Texto;
use IHchat\Nucleo\Validador;

/**
 * Webchat embutido no site do cliente (app/api/widget.py).
 *
 * O visitante não tem login: recebe um token de sessão opaco, que amarra o
 * navegador dele a um contato e a um canal de webchat. As rotas moram em
 * /api/widget/* (as únicas, com /widget.js, que liberam CORS: o widget roda
 * no site de terceiros).
 *
 * O QUE O VISITANTE ENXERGA. O histórico unificado ("um cliente, um
 * histórico") é da equipe; o navegador anônimo só vê o que ele mesmo
 * conversou naquela sessão. Por isso:
 *  - cada sessão nova cria o SEU contato. O e-mail digitado não prova nada
 *    (a chave pública está no HTML do site; qualquer um digita o e-mail de
 *    um cliente), então ele não liga a sessão à ficha que já tem esse
 *    endereço, não renomeia ficha nenhuma e nem vai para contatos.email
 *    (onde o e-mail real que chegasse depois cairia na ficha do estranho):
 *    fica nas observações, para a atendente juntar as fichas se quiser;
 *  - histórico, anexos e eventos só trazem mensagens das conversas do
 *    webchat da sessão, do contato da sessão, criadas depois que ela abriu;
 *  - a sessão acaba (401) se o canal for desativado ou se o contato ganhar
 *    outra identidade de webchat (fichas juntadas no painel).
 *
 * Tempo real: a hospedagem não segura conexão aberta, então em vez do
 * /api/widget/stream (SSE, só no Python) o widget pergunta a cada 2 s em
 * GET /api/widget/eventos/desde?token=<sessão>&depois=<id>. O widget
 * descobre isso em GET /api/widget/saude, rota do widget (com CORS, como o
 * resto do /api/widget/*).
 */
final class Rotas
{
    /** O histórico que o widget mostra ao abrir (as mais recentes). */
    public const LIMITE_HISTORICO = 100;
    private const BASE_ANEXOS = '/api/widget/anexos';
    /** Uma faxina de sessões vazias a cada N sessões abertas, em média. */
    private const CHANCE_FAXINA = 100;

    /**
     * O recorte do visitante em SQL (mensagens m JOIN conversas c): o
     * contato e o webchat da sessão, só depois que ela abriu, sem nota
     * interna e sem resposta que não saiu.
     */
    private const DO_VISITANTE = "c.contato_id = ? AND c.canal_id = ? AND m.criada_em >= ?
               AND m.tipo <> 'nota_interna' AND m.status <> 'falhou'";

    public static function registrar(Roteador $r): void
    {
        $r->get('/api/widget/saude', [self::class, 'saude']);
        $r->post('/api/widget/sessao', [self::class, 'abrirSessao'], status: 201);
        $r->post('/api/widget/mensagens', [self::class, 'enviar'], status: 201);
        $r->get('/api/widget/mensagens', [self::class, 'historico']);
        $r->post('/api/widget/anexos', [self::class, 'enviarArquivo'], status: 201);
        $r->get('/api/widget/anexos/{anexo_id:int}', [self::class, 'baixarAnexo']);
        $r->get('/api/widget/eventos/desde', [self::class, 'eventosDesde']);
    }

    // -------------------------------------------------------------- rotas

    /**
     * Como o widget recebe as respostas: {"status": "ok", "eventos": "consulta"}.
     * É o "eventos" do /saude, numa rota com CORS: o widget roda no site de
     * terceiros, e lá o /saude daria erro de CORS no console do cliente.
     *
     * @return array<string, string>
     */
    public static function saude(): array
    {
        return ['status' => 'ok', 'eventos' => Aplicacao::saude()['eventos']];
    }

    /** Abre a conversa do visitante: {token, contato_id, nome}. */
    public static function abrirSessao(Requisicao $req): array
    {
        $v = Validador::corpo($req);
        $chave = $v->texto('chave_publica');
        $nome = $v->texto('nome', max: 160, obrigatorio: false);
        $email = $v->email('email', obrigatorio: false);
        $v->validar();

        $canal = Banco::um(
            "SELECT * FROM canais WHERE chave_publica = ? AND tipo = 'webchat' AND ativo = 1",
            [(string) $chave]
        );
        if ($canal === null) {
            throw ErroHttp::naoEncontrado('canal de webchat nao encontrado');
        }
        Limites::novaSessao($req->ip);
        if (random_int(1, self::CHANCE_FAXINA) === 1) {
            Faxina::limpar();
        }
        $nomeContato = $nome !== null && $nome !== '' ? $nome : 'Visitante do site';
        $observacoes = $email === null ? null : self::observacaoDoEmail(mb_strtolower($email));

        return Banco::transacao(static function () use ($canal, $nomeContato, $observacoes): array {
            $agora = Datas::agoraBanco();
            // sempre uma ficha nova (ver o comentário da classe)
            $contatoId = Banco::inserir('contatos', [
                'nome' => $nomeContato,
                'observacoes' => $observacoes,
                'criado_em' => $agora,
                'atualizado_em' => $agora,
            ]);
            Banco::inserir('contato_identidades', [
                'contato_id' => $contatoId,
                'canal_tipo' => 'webchat',
                'identificador' => Texto::gerarChave('v_'),
                'nome_exibicao' => $nomeContato,
                'criado_em' => $agora,
            ]);
            $token = Texto::gerarChave('ws_');
            Banco::inserir('sessoes_widget', [
                'token' => $token,
                'canal_id' => (int) $canal['id'],
                'contato_id' => $contatoId,
                'criada_em' => $agora,
            ]);
            return ['token' => $token, 'contato_id' => $contatoId, 'nome' => $nomeContato];
        });
    }

    /** O visitante escreve. */
    public static function enviar(Requisicao $req): array
    {
        $v = Validador::corpo($req);
        // aparado antes de medir: "   " não é mensagem (linha vazia na caixa da equipe)
        $conteudo = $v->texto('conteudo', min: 1, max: 8000, aparar: true);
        $v->validar();
        $sessao = self::sessao($req->cabecalho('x-sessao'));
        Limites::mensagem($sessao);

        $identidade = $sessao['identidade'];
        $saida = Mensagens::registrarEntrada(self::canal($sessao), new MensagemRecebida(
            identificador: (string) $identidade['identificador'],
            conteudo: trim((string) $conteudo),
            nome_exibicao: self::textoOuNulo($identidade['nome_exibicao'] ?? null),
        ));
        if ($saida === null) {
            throw ErroHttp::conflito('mensagem duplicada'); // o widget não reenvia id externo
        }
        return self::saidaWidget((int) $saida['id'], self::textoOuNulo($identidade['nome_exibicao'] ?? null));
    }

    /** Histórico do visitante (sem notas internas), em ordem cronológica. */
    public static function historico(Requisicao $req): array
    {
        $sessao = self::sessao($req->cabecalho('x-sessao'));
        // as mais novas primeiro para o limite cortar o passado, não o presente
        $linhas = Banco::todos(
            'SELECT m.* FROM mensagens m JOIN conversas c ON c.id = m.conversa_id
             WHERE ' . self::DO_VISITANTE . '
             ORDER BY m.criada_em DESC, m.id DESC LIMIT ' . self::LIMITE_HISTORICO,
            self::parametrosDoVisitante($sessao)
        );
        return self::montar(array_reverse($linhas));
    }

    /** O visitante manda um print ou um PDF (multipart: arquivo + conteudo opcional). */
    public static function enviarArquivo(Requisicao $req): array
    {
        $arquivo = $req->arquivo('arquivo');
        if ($arquivo === null) {
            throw ErroValidacao::um('missing', ['body', 'arquivo'], 'arquivo: campo obrigatório');
        }
        $sessao = self::sessao($req->cabecalho('x-sessao'));
        if ($arquivo->excedeuLimiteDoServidor()) {
            throw ErroHttp::grandeDemais('arquivo maior que o limite de ' . Config::obter()->tamanho_max_anexo_mb . ' MB');
        }
        $dados = $arquivo->dados();
        if ($dados === '') {
            throw ErroHttp::invalido('arquivo vazio');
        }
        try {
            Anexos::conferirTamanho($dados);
        } catch (AnexoGrande $erro) {
            throw ErroHttp::grandeDemais($erro->getMessage());
        }
        Limites::mensagem($sessao);
        Limites::arquivo($sessao, $req->ip, strlen($dados));
        $nome = $arquivo->nome !== '' ? $arquivo->nome : 'arquivo';

        $identidade = $sessao['identidade'];
        $saida = Mensagens::registrarEntrada(self::canal($sessao), new MensagemRecebida(
            identificador: (string) $identidade['identificador'],
            conteudo: trim($req->campo('conteudo') ?? ''),
            nome_exibicao: self::textoOuNulo($identidade['nome_exibicao'] ?? null),
            // o tipo vem dos bytes, não do que o navegador disse (um HTML
            // chamado "foto.png" é servido só como download)
            anexos: [new AnexoRecebido($nome, dados: $dados, tipo_conteudo: RotasAnexos::tipo($arquivo, $nome))],
        ));
        if ($saida === null) {
            throw ErroHttp::conflito('mensagem duplicada');
        }
        Limites::registrarArquivo($req->ip, strlen($dados));
        return self::saidaWidget((int) $saida['id'], self::textoOuNulo($identidade['nome_exibicao'] ?? null));
    }

    /** O visitante só alcança arquivo da própria conversa, e nunca de nota interna. */
    public static function baixarAnexo(Requisicao $req, array $p): \IHchat\Nucleo\Resposta
    {
        $token = $req->consulta('token');
        if ($token === null) {
            throw ErroValidacao::um('missing', ['query', 'token'], 'token: campo obrigatório');
        }
        $sessao = self::sessao($token);
        $anexo = Banco::um(
            'SELECT a.* FROM anexos a
             JOIN mensagens m ON m.id = a.mensagem_id
             JOIN conversas c ON c.id = m.conversa_id
             WHERE a.id = ? AND ' . self::DO_VISITANTE,
            [(int) $p['anexo_id'], ...self::parametrosDoVisitante($sessao)]
        );
        if ($anexo === null) {
            throw ErroHttp::naoEncontrado('anexo não encontrado');
        }
        return RotasAnexos::resposta($anexo);
    }

    /**
     * GET /api/widget/eventos/desde?token=<sessão>&depois=<id>&limite=<n>
     * (a sessão também vale no cabeçalho X-Sessao). Sem "depois": só o cursor.
     *
     * Os dados de cada evento saem no formato do histórico do widget
     * ({id, direcao, conteudo, criada_em, autor, assinatura, anexos}), nunca
     * a MensagemSaida do painel (status, erro, ids da equipe, URL do painel).
     */
    public static function eventosDesde(Requisicao $req): array
    {
        [$depois, $limite] = RotasEventos::cursor($req);
        // ?token= vazio conta como ausente (o Python faz `token or x_sessao`)
        $token = $req->consulta('token');
        $sessao = self::sessao($token === null || $token === '' ? $req->cabecalho('x-sessao') : $token);
        $lote = Eventos::desdeDoVisitante($depois, (int) $sessao['contato_id'], $limite);
        $lote['eventos'] = self::paraOVisitante($lote['eventos'], $sessao);
        return $lote;
    }

    // -------------------------------------------------------------- apoio

    /**
     * @param array<string, mixed> $sessao
     * @return list<int|string>
     */
    private static function parametrosDoVisitante(array $sessao): array
    {
        return [(int) $sessao['contato_id'], (int) $sessao['canal_id'], (string) $sessao['criada_em']];
    }

    /**
     * A sessão válida, com a identidade de webchat do visitante em
     * ['identidade']. 401 "invalida" também quando o canal foi desativado
     * (senão desligar o canal no meio de um abuso não deteria quem já tem
     * sessão) e quando o contato tem mais de uma identidade de webchat
     * (fichas juntadas: a sessão não sabe mais qual é a dela).
     *
     * @return array<string, mixed>
     */
    private static function sessao(?string $token): array
    {
        if ($token === null || $token === '') {
            throw ErroHttp::naoAutorizado('sessao do widget ausente');
        }
        $sessao = Banco::um(
            "SELECT s.* FROM sessoes_widget s JOIN canais k ON k.id = s.canal_id
             WHERE s.token = ? AND k.tipo = 'webchat' AND k.ativo = 1",
            [$token]
        );
        if ($sessao === null) {
            throw ErroHttp::naoAutorizado('sessao do widget invalida');
        }
        $identidades = Banco::todos(
            "SELECT * FROM contato_identidades WHERE contato_id = ? AND canal_tipo = 'webchat' ORDER BY id LIMIT 2",
            [(int) $sessao['contato_id']]
        );
        if (count($identidades) !== 1) {
            throw ErroHttp::naoAutorizado('sessao do widget invalida');
        }
        $sessao['identidade'] = $identidades[0];
        return $sessao;
    }

    /**
     * @param array<string, mixed> $sessao
     * @return array<string, mixed>
     */
    private static function canal(array $sessao): array
    {
        return Canais::porId((int) $sessao['canal_id']) ?? throw ErroHttp::naoAutorizado('sessao do widget invalida');
    }

    private static function observacaoDoEmail(string $email): string
    {
        return "E-mail informado no site (não confirmado): {$email}";
    }

    /**
     * Converte os eventos "mensagem.nova" já filtrados pelo contato para o
     * formato do widget, relendo as mensagens com o recorte do visitante
     * (canal e início da sessão). Evento cuja mensagem não passa no recorte
     * some; o cursor ("ultimo") não muda.
     *
     * @param list<array{id: int, tipo: string, dados: mixed}> $eventos
     * @param array<string, mixed> $sessao
     * @return list<array{id: int, tipo: string, dados: mixed}>
     */
    private static function paraOVisitante(array $eventos, array $sessao): array
    {
        $ids = [];
        foreach ($eventos as $evento) {
            $dados = $evento['dados'];
            if (is_array($dados) && isset($dados['id']) && is_int($dados['id'])) {
                $ids[] = $dados['id'];
            }
        }
        if ($ids === []) {
            return [];
        }
        $marcadores = implode(', ', array_fill(0, count(array_unique($ids)), '?'));
        $linhas = Banco::todos(
            "SELECT m.* FROM mensagens m JOIN conversas c ON c.id = m.conversa_id
             WHERE m.id IN ({$marcadores}) AND m.direcao = 'saida' AND " . self::DO_VISITANTE,
            [...array_values(array_unique($ids)), ...self::parametrosDoVisitante($sessao)]
        );
        $porId = [];
        foreach (self::montar($linhas) as $saida) {
            $porId[$saida['id']] = $saida;
        }
        $saida = [];
        foreach ($eventos as $evento) {
            $id = is_array($evento['dados']) ? ($evento['dados']['id'] ?? null) : null;
            if (is_int($id) && isset($porId[$id])) {
                $saida[] = ['id' => $evento['id'], 'tipo' => $evento['tipo'], 'dados' => $porId[$id]];
            }
        }
        return $saida;
    }

    /** WidgetMensagemSaida da mensagem recém-gravada, com o autor que o POST informa. */
    private static function saidaWidget(int $mensagemId, ?string $autor): array
    {
        $linha = Banco::um('SELECT * FROM mensagens WHERE id = ?', [$mensagemId]) ?? throw new \RuntimeException('mensagem sumiu');
        $saida = self::montar([$linha])[0];
        $saida['autor'] = $autor;
        return $saida;
    }

    /**
     * WidgetMensagemSaida: {id, direcao, conteudo, criada_em, autor, assinatura, anexos}.
     * Nada da equipe além de quem respondeu (nome e setor): o visitante
     * precisa saber com quem fala, e só isso.
     *
     * @param list<array<string, mixed>> $linhas linhas de `mensagens`
     * @return list<array<string, mixed>>
     */
    private static function montar(array $linhas): array
    {
        if ($linhas === []) {
            return [];
        }
        $ids = array_map(static fn (array $l): int => (int) $l['id'], $linhas);
        $anexos = [];
        foreach (Saidas::porIds('SELECT * FROM anexos WHERE mensagem_id IN (%s) ORDER BY id', $ids) as $a) {
            $anexos[(int) $a['mensagem_id']][] = Saidas::anexo($a, self::BASE_ANEXOS);
        }
        $nomes = [];
        foreach (Saidas::porIds('SELECT id, nome FROM atendentes WHERE id IN (%s)', array_map(
            static fn (array $l): ?int => Saidas::inteiroOuNulo($l['atendente_id'] ?? null),
            $linhas
        )) as $a) {
            $nomes[(int) $a['id']] = (string) $a['nome'];
        }
        $saida = [];
        foreach ($linhas as $l) {
            $id = (int) $l['id'];
            $direcao = (string) $l['direcao'];
            $assinatura = $direcao === 'saida' ? Saidas::assinatura($l['assinatura'] ?? null) : null;
            $atendenteId = Saidas::inteiroOuNulo($l['atendente_id'] ?? null);
            $saida[] = [
                'id' => $id,
                'direcao' => $direcao,
                'conteudo' => (string) $l['conteudo'],
                'criada_em' => Datas::iso((string) $l['criada_em']),
                // o nome gravado no envio (o que o cliente viu), senão o atual
                'autor' => $assinatura['nome'] ?? ($atendenteId === null ? null : ($nomes[$atendenteId] ?? null)),
                'assinatura' => $assinatura,
                'anexos' => $anexos[$id] ?? [],
            ];
        }
        return $saida;
    }

    private static function textoOuNulo(mixed $valor): ?string
    {
        return $valor === null || $valor === '' ? null : (string) $valor;
    }
}

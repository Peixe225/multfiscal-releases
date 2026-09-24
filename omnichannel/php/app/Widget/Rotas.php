<?php
declare(strict_types=1);

namespace OmniChannel\Widget;

use OmniChannel\Anexos\Rotas as RotasAnexos;
use OmniChannel\Atendimento\AnexoGrande;
use OmniChannel\Atendimento\AnexoRecebido;
use OmniChannel\Atendimento\Anexos;
use OmniChannel\Atendimento\MensagemRecebida;
use OmniChannel\Atendimento\Mensagens;
use OmniChannel\Atendimento\Saidas;
use OmniChannel\Banco\Banco;
use OmniChannel\Canais\Canais;
use OmniChannel\Eventos\Eventos;
use OmniChannel\Eventos\Rotas as RotasEventos;
use OmniChannel\Nucleo\Config;
use OmniChannel\Nucleo\Datas;
use OmniChannel\Nucleo\ErroHttp;
use OmniChannel\Nucleo\ErroValidacao;
use OmniChannel\Nucleo\Requisicao;
use OmniChannel\Nucleo\Roteador;
use OmniChannel\Nucleo\Texto;
use OmniChannel\Nucleo\Validador;

/**
 * Webchat embutido no site do cliente (app/api/widget.py).
 *
 * O visitante não tem login: recebe um token de sessão opaco, que amarra o
 * navegador dele a um contato e a um canal de webchat. As rotas moram em
 * /api/widget/* (as únicas, com /widget.js, que liberam CORS: o widget roda
 * no site de terceiros).
 *
 * Tempo real: a hospedagem não segura conexão aberta, então em vez do
 * /api/widget/stream (SSE, só no Python) o widget pergunta a cada 2 s em
 * GET /api/widget/eventos/desde?token=<sessão>&depois=<id>. O visitante só
 * enxerga "mensagem.nova" de saída do próprio contato, nunca nota interna.
 */
final class Rotas
{
    /** O histórico que o widget mostra ao abrir (as mais recentes). */
    public const LIMITE_HISTORICO = 100;
    private const BASE_ANEXOS = '/api/widget/anexos';

    public static function registrar(Roteador $r): void
    {
        $r->post('/api/widget/sessao', [self::class, 'abrirSessao'], status: 201);
        $r->post('/api/widget/mensagens', [self::class, 'enviar'], status: 201);
        $r->get('/api/widget/mensagens', [self::class, 'historico']);
        $r->post('/api/widget/anexos', [self::class, 'enviarArquivo'], status: 201);
        $r->get('/api/widget/anexos/{anexo_id:int}', [self::class, 'baixarAnexo']);
        $r->get('/api/widget/eventos/desde', [self::class, 'eventosDesde']);
    }

    // -------------------------------------------------------------- rotas

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
        $email = $email === null ? null : mb_strtolower($email);

        return Banco::transacao(static function () use ($canal, $nome, $email): array {
            $agora = Datas::agoraBanco();
            $contato = null;
            if ($email !== null) {
                // visitante identificado: reaproveita a ficha que já existe
                $contato = Banco::um('SELECT id, nome FROM contatos WHERE email = ? ORDER BY id LIMIT 1', [$email]);
            }
            if ($contato === null) {
                $nomeContato = $nome !== null && $nome !== '' ? $nome : 'Visitante do site';
                $contatoId = Banco::inserir('contatos', [
                    'nome' => $nomeContato,
                    'email' => $email,
                    'criado_em' => $agora,
                    'atualizado_em' => $agora,
                ]);
            } else {
                $contatoId = (int) $contato['id'];
                $nomeContato = (string) $contato['nome'];
                if ($nome !== null && $nome !== '') {
                    $nomeContato = $nome;
                    Banco::atualizar('contatos', ['nome' => $nome, 'atualizado_em' => $agora], 'id = ?', [$contatoId]);
                }
            }

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
        $conteudo = $v->texto('conteudo', min: 1, max: 8000);
        $v->validar();
        $sessao = self::sessao($req->cabecalho('x-sessao'));
        [$canal, $identidade] = self::canalEIdentidade($sessao);

        $saida = Mensagens::registrarEntrada($canal, new MensagemRecebida(
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
            "SELECT m.* FROM mensagens m JOIN conversas c ON c.id = m.conversa_id
             WHERE c.contato_id = ? AND m.tipo <> 'nota_interna'
             ORDER BY m.criada_em DESC, m.id DESC LIMIT " . self::LIMITE_HISTORICO,
            [(int) $sessao['contato_id']]
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
        [$canal, $identidade] = self::canalEIdentidade($sessao);
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
        $nome = $arquivo->nome !== '' ? $arquivo->nome : 'arquivo';

        $saida = Mensagens::registrarEntrada($canal, new MensagemRecebida(
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
        return self::saidaWidget((int) $saida['id'], self::textoOuNulo($identidade['nome_exibicao'] ?? null));
    }

    /** O visitante só alcança arquivo da própria conversa, e nunca de nota interna. */
    public static function baixarAnexo(Requisicao $req, array $p): \OmniChannel\Nucleo\Resposta
    {
        $token = $req->consulta('token');
        if ($token === null) {
            throw ErroValidacao::um('missing', ['query', 'token'], 'token: campo obrigatório');
        }
        $sessao = self::sessao($token);
        $anexo = Banco::um(
            "SELECT a.* FROM anexos a
             JOIN mensagens m ON m.id = a.mensagem_id
             JOIN conversas c ON c.id = m.conversa_id
             WHERE a.id = ? AND c.contato_id = ? AND m.tipo <> 'nota_interna'",
            [(int) $p['anexo_id'], (int) $sessao['contato_id']]
        );
        if ($anexo === null) {
            throw ErroHttp::naoEncontrado('anexo não encontrado');
        }
        return RotasAnexos::resposta($anexo);
    }

    /**
     * GET /api/widget/eventos/desde?token=<sessão>&depois=<id>&limite=<n>
     * (a sessão também vale no cabeçalho X-Sessao). Sem "depois": só o cursor.
     */
    public static function eventosDesde(Requisicao $req): array
    {
        [$depois, $limite] = RotasEventos::cursor($req);
        $sessao = self::sessao($req->consulta('token') ?? $req->cabecalho('x-sessao'));
        return Eventos::desdeDoVisitante($depois, (int) $sessao['contato_id'], $limite);
    }

    // -------------------------------------------------------------- apoio

    /** @return array<string, mixed> a linha de sessoes_widget */
    private static function sessao(?string $token): array
    {
        if ($token === null || $token === '') {
            throw ErroHttp::naoAutorizado('sessao do widget ausente');
        }
        $sessao = Banco::um('SELECT * FROM sessoes_widget WHERE token = ?', [$token]);
        if ($sessao === null) {
            throw ErroHttp::naoAutorizado('sessao do widget invalida');
        }
        return $sessao;
    }

    /**
     * @param array<string, mixed> $sessao
     * @return array{0: array<string, mixed>, 1: array<string, mixed>} canal e identidade de webchat do visitante
     */
    private static function canalEIdentidade(array $sessao): array
    {
        $canal = Canais::porId((int) $sessao['canal_id']);
        $identidade = Banco::um(
            "SELECT * FROM contato_identidades WHERE contato_id = ? AND canal_tipo = 'webchat' ORDER BY id LIMIT 1",
            [(int) $sessao['contato_id']]
        );
        if ($canal === null || $identidade === null) {
            throw ErroHttp::conflito('sessao do widget inconsistente');
        }
        return [$canal, $identidade];
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

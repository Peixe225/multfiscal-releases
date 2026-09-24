<?php
declare(strict_types=1);

use IHchat\Atendimento\AdaptadorDeCanal;
use IHchat\Atendimento\Adaptadores;
use IHchat\Atendimento\AnexoRecebido;
use IHchat\Atendimento\Assinaturas;
use IHchat\Atendimento\Contatos;
use IHchat\Atendimento\Conversas;
use IHchat\Atendimento\MensagemRecebida;
use IHchat\Atendimento\Mensagens;
use IHchat\Atendimento\ResultadoEnvio;
use IHchat\Auth\Atendentes;
use IHchat\Auth\Token;
use IHchat\Banco\Banco;
use IHchat\Eventos\Eventos;
use IHchat\Instalacao\Seed;
use IHchat\Nucleo\Aplicacao;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\Json;
use IHchat\Nucleo\Requisicao;

/** Adaptador falso: guarda o que "enviou". */
final class AdaptadorFalsoAtendimento implements AdaptadorDeCanal
{
    /** @var list<array{destino: string, conteudo: string, contexto: array}> */
    public static array $enviados = [];
    public function __construct(private array $canal) {}
    public function tipo(): string { return $this->canal['tipo']; }
    public function configurado(): bool { return ($this->canal['credenciais']['token'] ?? '') !== '' || $this->canal['tipo'] === 'webchat'; }
    public function enviaArquivos(): bool { return $this->canal['tipo'] !== 'telegram' || true; }
    public function enviar(string $destino, string $conteudo, array $contexto): ResultadoEnvio
    {
        self::$enviados[] = ['destino' => $destino, 'conteudo' => $conteudo, 'contexto' => $contexto];
        if (str_contains($conteudo, 'explode')) {
            throw new RuntimeException('https://api.telegram.org/botSEGREDO/sendMessage caiu');
        }
        return new ResultadoEnvio('enviada', $this->canal['tipo'] . ':' . count(self::$enviados));
    }
    public function baixarAnexo(AnexoRecebido $anexo): string
    {
        if ($anexo->referencia === 'quebrado') { throw new RuntimeException('segredo'); }
        return $anexo->dados ?? 'bytes-de-' . $anexo->referencia;
    }
}

function atend_canal(string $tipo, array $credenciais = []): array
{
    $id = Banco::inserir('canais', ['nome' => "Canal {$tipo} " . random_int(1, 99999), 'tipo' => $tipo, 'ativo' => true,
        'credenciais' => Json::objeto($credenciais), 'chave_publica' => null, 'segredo_webhook' => null, 'criado_em' => Datas::agoraBanco()]);
    return Adaptadores::canal($id);
}

function atend_http(string $metodo, string $caminho, ?array $corpo = null, array $consulta = [], ?string $token = null): array
{
    $cab = ['Content-Type' => 'application/json'];
    if ($token !== null) { $cab['Authorization'] = 'Bearer ' . $token; }
    $r = Aplicacao::atender(new Requisicao($metodo, $caminho, $consulta, $cab, $corpo === null ? '' : Json::codificar($corpo)));
    $texto = $r->conteudo();
    return [$r->status, $texto === '' ? null : Json::decodificar($texto)];
}

function atend_ana(): array { return Atendentes::porEmail('ana@multfiscal.com.br'); }
function atend_token_ana(): string { return Token::criar(atend_ana()['id']); }
function atend_token_admin(): string { return Token::criar(Atendentes::porEmail('admin@multfiscal.com.br')['id']); }

return [
    'seed de exemplo passa pelos servicos de mensagens' => function (): void {
        $resultado = Seed::semear(true);
        Afirmar::verdade($resultado['criada'], 'base não criada');
        Afirmar::igual(3, (int) Banco::valor('SELECT COUNT(*) FROM conversas'));
        // pergunta + resposta no WhatsApp e no Telegram; só a pergunta no e-mail
        Afirmar::igual(5, (int) Banco::valor('SELECT COUNT(*) FROM mensagens'));
        $respostas = Banco::todos("SELECT status, assinatura FROM mensagens WHERE direcao = 'saida' ORDER BY id");
        Afirmar::igual(2, count($respostas));
        foreach ($respostas as $r) {
            Afirmar::igual('simulada', $r['status']);
            Afirmar::igual(['nome' => 'Ana Suporte', 'setor' => 'Suporte técnico'], Json::ler((string) $r['assinatura'], []));
        }
        // fica na caixa como nova, distribuída, com a identidade de quem escreveu
        foreach (Banco::todos('SELECT nao_lidas, atendente_id FROM conversas') as $c) {
            Afirmar::igual(1, (int) $c['nao_lidas']);
            Afirmar::verdade($c['atendente_id'] !== null, 'conversa sem atendente');
        }
        Afirmar::igual('5500912345678', Banco::valor("SELECT identificador FROM contato_identidades WHERE canal_tipo = 'whatsapp'"));
        // Telegram e e-mail já nascem com o segredo do webhook (o e-mail recusa tudo sem ele)
        Afirmar::igual(0, (int) Banco::valor("SELECT COUNT(*) FROM canais WHERE tipo IN ('telegram', 'email') AND segredo_webhook IS NULL"));
        // seed sem eventos de tempo real: ninguém estava olhando
        Afirmar::igual(0, (int) Banco::valor('SELECT COUNT(*) FROM fila_eventos'));
        // rodar de novo não duplica nada
        Afirmar::verdade(!Seed::semear(true)['criada'], 'semeou duas vezes');
        Afirmar::igual(3, (int) Banco::valor('SELECT COUNT(*) FROM conversas'));
    },
    'whatsapp reconhece pelo telefone e completa o nome' => function (): void {
        $agora = Datas::agoraBanco();
        $id = Banco::inserir('contatos', ['nome' => 'Ian', 'telefone' => '5500912345678', 'criado_em' => $agora, 'atualizado_em' => $agora]);
        Afirmar::igual($id, Contatos::resolver('whatsapp', '+55 (00) 91234-5678', 'Ian D.'));
        $novo = Contatos::resolver('whatsapp', '5511999998888');
        Afirmar::igual('5511999998888', Contatos::porId($novo)['nome']);
        Afirmar::igual($novo, Contatos::resolver('whatsapp', '5511999998888', 'Joana'));
        Afirmar::igual('Joana', Contatos::porId($novo)['nome']);
    },
    'email reconhece pelo endereco sem caixa' => function (): void {
        $agora = Datas::agoraBanco();
        $id = Banco::inserir('contatos', ['nome' => 'Loja', 'email' => 'financeiro@loja.example', 'criado_em' => $agora, 'atualizado_em' => $agora]);
        Afirmar::igual($id, Contatos::resolver('email', 'Financeiro@Loja.EXAMPLE'));
        Afirmar::igual('financeiro@loja.example', Banco::valor('SELECT identificador FROM contato_identidades WHERE contato_id = ?', [$id]));
    },
    'para onde responder' => function (): void {
        $id = Contatos::resolver('telegram', '884412', 'Marcos');
        Afirmar::igual('884412', Contatos::identificadorNoCanal($id, 'telegram'));
        Afirmar::igual(null, Contatos::identificadorNoCanal($id, 'email'));
    },
    'mesclar junta identidades e conversas e encerra as sessoes' => function (): void {
        Seed::semear();
        $wa = atend_canal('whatsapp');
        $tel = Contatos::resolver('whatsapp', '5511977776666', 'Cliente WhatsApp');
        $mail = Contatos::resolver('email', 'cliente@empresa.com.br', 'Cliente E-mail');
        Banco::executar('UPDATE contatos SET observacoes = ? WHERE id = ?', ['cliente antigo', $mail]);
        [$conv] = Conversas::obterOuCriar($mail, $wa['id']);
        Banco::inserir('sessoes_widget', ['token' => 'ws_x', 'canal_id' => $wa['id'], 'contato_id' => $mail, 'criada_em' => Datas::agoraBanco()]);
        Contatos::resolver('whatsapp', '5511977776666');
        Afirmar::igual($tel, Contatos::mesclar($tel, $mail));
        $tipos = array_column(Banco::todos('SELECT canal_tipo FROM contato_identidades WHERE contato_id = ? ORDER BY canal_tipo', [$tel]), 'canal_tipo');
        Afirmar::igual(['email', 'whatsapp'], $tipos);
        $p = Contatos::porId($tel);
        Afirmar::igual('cliente@empresa.com.br', $p['email']);
        Afirmar::igual('cliente antigo', $p['observacoes']);
        Afirmar::igual(null, Contatos::porId($mail));
        Afirmar::igual($tel, (int) Banco::valor('SELECT contato_id FROM conversas WHERE id = ?', [$conv]));
        // a sessão do widget é ENCERRADA, não transferida: mesclar não é prova de identidade
        Afirmar::igual(null, Banco::valor('SELECT contato_id FROM sessoes_widget WHERE token = ?', ['ws_x']));
    },
    'entrada idempotente, distribuida e com evento' => function (): void {
        Seed::semear();
        $wa = atend_canal('whatsapp');
        $cursor = Eventos::ultimoId();
        $m = Mensagens::registrarEntrada($wa, new MensagemRecebida('5500912345678', 'Bom dia', 'Ian', 'whatsapp:w1'));
        Afirmar::igual(null, Mensagens::registrarEntrada($wa, ['identificador' => '5500912345678', 'conteudo' => 'Bom dia', 'externo_id' => 'whatsapp:w1']));
        Afirmar::igual('entrada', $m['direcao']);
        Afirmar::igual('Ian', $m['autor']);
        $conv = Conversas::porId($m['conversa_id']);
        Afirmar::igual(1, (int) $conv['nao_lidas']);
        Afirmar::verdade($conv['atendente_id'] !== null, 'distribuida');
        $eventos = Eventos::desde($cursor)['eventos'];
        Afirmar::igual(['mensagem.nova', 'conversa.atualizada'], array_column($eventos, 'tipo'));
        Afirmar::igual($m['contato_id'], $eventos[0]['dados']['contato_id']);
        Afirmar::igual(1, (int) Banco::valor('SELECT COUNT(*) FROM mensagens'));
    },
    'distribuicao equilibra a carga' => function (): void {
        Seed::semear();
        $wa = atend_canal('whatsapp');
        foreach (range(0, 3) as $i) {
            Mensagens::registrarEntrada($wa, new MensagemRecebida("5511900000{$i}", 'oi', null, "whatsapp:d{$i}"));
        }
        $cargas = array_map('intval', array_column(Banco::todos('SELECT COUNT(*) AS n FROM conversas GROUP BY atendente_id'), 'n'));
        sort($cargas);
        Afirmar::igual([2, 2], $cargas);
    },
    'reabre dentro da janela e abre nova depois' => function (): void {
        Seed::semear();
        $wa = atend_canal('whatsapp');
        $m = Mensagens::registrarEntrada($wa, new MensagemRecebida('5500912345678', 'oi', null, 'whatsapp:a'));
        Conversas::mudarStatus($m['conversa_id'], 'resolvida');
        $m2 = Mensagens::registrarEntrada($wa, new MensagemRecebida('5500912345678', 'Obrigado!', null, 'whatsapp:b'));
        Afirmar::igual($m['conversa_id'], $m2['conversa_id']);
        Afirmar::igual('aberta', Conversas::porId($m['conversa_id'])['status']);
        Conversas::mudarStatus($m['conversa_id'], 'resolvida');
        Banco::atualizar('conversas', ['ultima_mensagem_em' => Datas::haHoras(25)], 'id = ?', [$m['conversa_id']]);
        $m3 = Mensagens::registrarEntrada($wa, new MensagemRecebida('5500912345678', 'outro assunto', null, 'whatsapp:c'));
        Afirmar::verdade($m3['conversa_id'] !== $m['conversa_id'], 'conversa nova');
    },
    'resposta sem credencial e simulada e assinada' => function (): void {
        Seed::semear();
        $wa = atend_canal('whatsapp');
        $m = Mensagens::registrarEntrada($wa, new MensagemRecebida('5500912345678', 'oi', 'Ian', 'whatsapp:x'));
        $r = Mensagens::enviarMensagem($m['conversa_id'], 'Bom dia! Pode me dizer o CNPJ?', atend_ana());
        Afirmar::igual('simulada', $r['status']);
        Afirmar::igual('Ana Suporte', $r['autor']);
        Afirmar::igual(['nome' => 'Ana Suporte', 'setor' => 'Suporte técnico'], $r['assinatura']);
        $c = Conversas::porId($m['conversa_id']);
        Afirmar::verdade($c['primeira_resposta_em'] !== null, 'primeira resposta');
        Afirmar::igual('Bom dia! Pode me dizer o CNPJ?', $c['previa']);
        Afirmar::igual(0, (int) $c['nao_lidas']);
    },
    'fora do sandbox sem credencial falha' => function (): void {
        preparar_ambiente(['modo_sandbox' => false, 'chave_secreta' => str_repeat('x', 40)]);
        Seed::semear();
        $wa = atend_canal('whatsapp');
        $m = Mensagens::registrarEntrada($wa, new MensagemRecebida('5500912345678', 'oi', 'Ian', 'whatsapp:x'));
        $r = Mensagens::enviarMensagem($m['conversa_id'], 'oi', atend_ana());
        Afirmar::igual('falhou', $r['status']);
        Afirmar::igual("canal {$wa['nome']} sem credenciais configuradas", $r['erro']);
        Afirmar::igual(null, Conversas::porId($m['conversa_id'])['primeira_resposta_em']);
    },
    'texto ao provedor leva a assinatura do canal' => function (): void {
        Seed::semear();
        Adaptadores::definir(static fn (array $c) => new AdaptadorFalsoAtendimento($c));
        AdaptadorFalsoAtendimento::$enviados = [];
        foreach (['whatsapp' => '5500912345678', 'telegram' => '99', 'email' => 'x@loja.example', 'webchat' => 'v1'] as $tipo => $ident) {
            $c = atend_canal($tipo, ['token' => 't']);
            $m = Mensagens::registrarEntrada($c, new MensagemRecebida($ident, 'oi', 'Cli', "{$tipo}:e1", 'Boleto'));
            $r = Mensagens::enviarMensagem($m['conversa_id'], 'Olá!', atend_ana());
            Afirmar::igual('Olá!', $r['conteudo'], 'conteudo gravado sem assinatura');
            Afirmar::igual('enviada', $r['status']);
        }
        $textos = array_column(AdaptadorFalsoAtendimento::$enviados, 'conteudo');
        Afirmar::igual("*Ana Suporte · Suporte técnico*\nOlá!", $textos[0]);
        Afirmar::igual("Ana Suporte · Suporte técnico\nOlá!", $textos[1]);
        Afirmar::igual("Olá!\n\n-- \nAna Suporte\nSuporte técnico", $textos[2]);
        Afirmar::igual('Olá!', $textos[3]);
        Afirmar::igual('Boleto', AdaptadorFalsoAtendimento::$enviados[2]['contexto']['assunto']);
        Afirmar::igual(['nome' => 'Ana Suporte', 'setor' => 'Suporte técnico'], AdaptadorFalsoAtendimento::$enviados[0]['contexto']['assinatura']);
    },
    'atendente sem setor assina so com o nome' => function (): void {
        Afirmar::igual("*Bia*\noi", Assinaturas::aplicar('whatsapp', 'oi', ['nome' => 'Bia', 'setor' => null]));
        Afirmar::igual('oi', Assinaturas::aplicar('whatsapp', 'oi', null));
    },
    'entrada simulada nunca sai pelo provedor' => function (): void {
        Seed::semear();
        Adaptadores::definir(static fn (array $c) => new AdaptadorFalsoAtendimento($c));
        AdaptadorFalsoAtendimento::$enviados = [];
        $c = atend_canal('telegram', ['token' => 't']);
        $m = Mensagens::registrarEntrada($c, new MensagemRecebida('77', 'oi', null, 'telegram:s', null, ['simulada_por' => 1]));
        $r = Mensagens::enviarMensagem($m['conversa_id'], 'resposta', atend_ana());
        Afirmar::igual('simulada', $r['status']);
        Afirmar::igual([], AdaptadorFalsoAtendimento::$enviados);
    },
    'erro do adaptador vira falhou sem vazar detalhe' => function (): void {
        Seed::semear();
        Adaptadores::definir(static fn (array $c) => new AdaptadorFalsoAtendimento($c));
        $c = atend_canal('telegram', ['token' => 't']);
        $m = Mensagens::registrarEntrada($c, new MensagemRecebida('77', 'oi', null, 'telegram:q'));
        $r = @Mensagens::enviarMensagem($m['conversa_id'], 'explode', atend_ana());
        Afirmar::igual('falhou', $r['status']);
        Afirmar::verdade(!str_contains((string) $r['erro'], 'SEGREDO'), 'vazou: ' . $r['erro']);
    },
    'contato sem identidade no canal falha' => function (): void {
        Seed::semear();
        $c = atend_canal('email');
        $agora = Datas::agoraBanco();
        $contato = Banco::inserir('contatos', ['nome' => 'Sem email', 'criado_em' => $agora, 'atualizado_em' => $agora]);
        [$conv] = Conversas::obterOuCriar($contato, $c['id']);
        $r = Mensagens::enviarMensagem($conv, 'oi', atend_ana());
        Afirmar::igual('falhou', $r['status']);
        Afirmar::igual('contato sem identificacao no canal email', $r['erro']);
    },
    'anexos recebidos: baixados ou com erro' => function (): void {
        Seed::semear();
        Adaptadores::definir(static fn (array $c) => new AdaptadorFalsoAtendimento($c));
        $c = atend_canal('whatsapp', ['token' => 't']);
        $m = Mensagens::registrarEntrada($c, new MensagemRecebida('5500912345678', '', null, 'whatsapp:f', null, [], [
            new AnexoRecebido('nota.pdf', 'm1', null, 'application/pdf'),
            new AnexoRecebido('foto.png', 'quebrado'),
        ]));
        Afirmar::igual(2, count($m['anexos']));
        Afirmar::igual('/api/anexos/' . $m['anexos'][0]['id'], $m['anexos'][0]['url']);
        Afirmar::igual(null, $m['anexos'][1]['url']);
        Afirmar::verdade($m['anexos'][1]['imagem'], 'png e imagem');
        Afirmar::verdade(!str_contains((string) $m['anexos'][1]['erro'], 'segredo'), 'vazou');
        Afirmar::igual('📎 nota.pdf', Conversas::porId($m['conversa_id'])['previa']);
    },
    'status externo atualiza e publica' => function (): void {
        Seed::semear();
        Adaptadores::definir(static fn (array $c) => new AdaptadorFalsoAtendimento($c));
        $c = atend_canal('whatsapp', ['token' => 't']);
        $m = Mensagens::registrarEntrada($c, new MensagemRecebida('5500912345678', 'oi', null, 'whatsapp:z'));
        $r = Mensagens::enviarMensagem($m['conversa_id'], 'oi', atend_ana());
        $cursor = Eventos::ultimoId();
        $externo = (string) Banco::valor('SELECT externo_id FROM mensagens WHERE id = ?', [$r['id']]);
        Afirmar::verdade(str_starts_with($externo, 'whatsapp:'), 'externo gravado');
        $alteradas = Mensagens::aplicarStatusExterno([['externo_id' => $externo, 'status' => 'lida'], ['externo_id' => 'nada', 'status' => 'lida']]);
        Afirmar::igual(1, count($alteradas));
        Afirmar::igual('lida', $alteradas[0]['status']);
        Afirmar::igual(['mensagem.status'], array_column(Eventos::desde($cursor)['eventos'], 'tipo'));
    },
    'rotas: lista, filtros, detalhe, nota e etiquetas' => function (): void {
        Seed::semear();
        $wa = atend_canal('whatsapp');
        $tg = atend_canal('telegram');
        $m1 = Mensagens::registrarEntrada($wa, new MensagemRecebida('5500912345678', 'Bom dia, tenho uma dúvida', 'Ian', 'whatsapp:1'));
        $m2 = Mensagens::registrarEntrada($tg, new MensagemRecebida('99', 'boleto', 'Zé', 'telegram:1'));
        $t = atend_token_ana();
        [$s, $lista] = atend_http('GET', '/api/conversas', null, [], $t);
        Afirmar::igual(200, $s);
        Afirmar::igual(2, count($lista));
        Afirmar::igual([$m2['conversa_id']], array_column(atend_http('GET', '/api/conversas', null, ['q' => 'boleto'], $t)[1], 'id'));
        Afirmar::igual([$m1['conversa_id']], array_column(atend_http('GET', '/api/conversas', null, ['q' => 'ian'], $t)[1], 'id'));
        Afirmar::igual([$m2['conversa_id']], array_column(atend_http('GET', '/api/conversas', null, ['canal_id' => (string) $tg['id']], $t)[1], 'id'));
        atend_http('POST', "/api/conversas/{$m2['conversa_id']}/atribuir", ['atendente_id' => null], [], $t);
        atend_http('POST', "/api/conversas/{$m1['conversa_id']}/atribuir", ['atendente_id' => atend_ana()['id']], [], $t);
        Afirmar::igual([$m1['conversa_id']], array_column(atend_http('GET', '/api/conversas', null, ['atendente' => 'eu'], $t)[1], 'id'));
        Afirmar::igual([$m2['conversa_id']], array_column(atend_http('GET', '/api/conversas', null, ['atendente' => 'sem'], $t)[1], 'id'));
        Afirmar::igual([422, ['detail' => 'filtro de atendente invalido']], atend_http('GET', '/api/conversas', null, ['atendente' => 'abc'], $t));
        Afirmar::igual(422, atend_http('GET', '/api/conversas', null, ['status' => 'xyz'], $t)[0]);
        [$s, $d] = atend_http('GET', "/api/conversas/{$m1['conversa_id']}", null, [], $t);
        Afirmar::igual(['Bom dia, tenho uma dúvida'], array_column($d['mensagens'], 'conteudo'));
        Afirmar::igual(0, atend_http('GET', '/api/conversas', null, ['canal_id' => (string) $wa['id']], $t)[1][0]['nao_lidas']);
        [$s, $nota] = atend_http('POST', "/api/conversas/{$m1['conversa_id']}/notas", ['conteudo' => ' interno '], [], $t);
        Afirmar::igual([201, 'nota_interna', 'interno'], [$s, $nota['tipo'], $nota['conteudo']]);
        Afirmar::igual('Bom dia, tenho uma dúvida', Conversas::porId($m1['conversa_id'])['previa']);
        [$s, $e] = atend_http('POST', '/api/etiquetas', ['nome' => 'urgente2', 'cor' => '#ff0000'], [], $t);
        Afirmar::igual(201, $s);
        Afirmar::igual(409, atend_http('POST', '/api/etiquetas', ['nome' => 'URGENTE2'], [], $t)[0]);
        [$s, $c] = atend_http('POST', "/api/conversas/{$m1['conversa_id']}/etiquetas", ['etiqueta_id' => $e['id']], [], $t);
        Afirmar::igual(['urgente2'], array_column($c['etiquetas'], 'nome'));
        Afirmar::igual([$m1['conversa_id']], array_column(atend_http('GET', '/api/conversas', null, ['etiqueta_id' => (string) $e['id']], $t)[1], 'id'));
        Afirmar::igual([], atend_http('DELETE', "/api/conversas/{$m1['conversa_id']}/etiquetas/{$e['id']}", null, [], $t)[1]['etiquetas']);
        Afirmar::igual([404, ['detail' => 'etiqueta nao encontrada']], atend_http('POST', "/api/conversas/{$m1['conversa_id']}/etiquetas", ['etiqueta_id' => 9999], [], $t));
        Afirmar::igual([404, ['detail' => 'conversa nao encontrada']], atend_http('GET', '/api/conversas/9999', null, [], $t));
        Afirmar::igual(401, atend_http('GET', '/api/conversas/9999')[0]);
        [$s, $st] = atend_http('POST', "/api/conversas/{$m1['conversa_id']}/status", ['status' => 'resolvida'], [], $t);
        Afirmar::igual('resolvida', $st['status']);
        [$s, $r] = atend_http('POST', "/api/conversas/{$m1['conversa_id']}/mensagens", ['conteudo' => 'Voltando...'], [], $t);
        Afirmar::igual(201, $s);
        Afirmar::igual('aberta', Conversas::porId($m1['conversa_id'])['status']);
        Afirmar::igual('alta', atend_http('POST', "/api/conversas/{$m1['conversa_id']}/prioridade", ['prioridade' => 'alta'], [], $t)[1]['prioridade']);
        Afirmar::igual(204, atend_http('DELETE', "/api/etiquetas/{$e['id']}", null, [], $t)[0]);
    },
    'rotas: metricas' => function (): void {
        Seed::semear();
        $t = atend_token_ana();
        $wa = atend_canal('whatsapp');
        $ids = [];
        foreach (range(0, 2) as $i) {
            $ids[] = Mensagens::registrarEntrada($wa, new MensagemRecebida("5511900000{$i}", 'oi', null, "whatsapp:m{$i}"))['conversa_id'];
        }
        atend_http('POST', "/api/conversas/{$ids[0]}/mensagens", ['conteudo' => 'Bom dia!'], [], $t);
        atend_http('POST', "/api/conversas/{$ids[1]}/status", ['status' => 'resolvida'], [], $t);
        [$s, $r] = atend_http('GET', '/api/metricas/resumo', null, [], $t);
        Afirmar::igual(2, $r['abertas']);
        Afirmar::igual(1, $r['resolvidas_hoje']);
        Afirmar::igual(0, $r['sem_atendente']);
        Afirmar::igual(4, $r['mensagens_hoje']);
        Afirmar::igual([$wa['nome'] => 2], $r['por_canal']);
        Afirmar::verdade(is_float($r['tempo_medio_primeira_resposta_seg']) || is_int($r['tempo_medio_primeira_resposta_seg']), 'media');
    },
    'rotas: atendentes e setor' => function (): void {
        Seed::semear();
        $adm = atend_token_admin();
        [$s, $novo] = atend_http('POST', '/api/atendentes', ['nome' => 'Bia', 'email' => 'Bia@Empresa.com.br', 'senha' => '123456', 'setor' => ' Financeiro '], [], $adm);
        Afirmar::igual(201, $s);
        Afirmar::igual(['id', 'nome', 'email', 'papel', 'ativo', 'disponivel', 'setor'], array_keys($novo));
        Afirmar::igual(['bia@empresa.com.br', 'Financeiro', 'atendente'], [$novo['email'], $novo['setor'], $novo['papel']]);
        Afirmar::igual([409, ['detail' => 'ja existe um atendente com esse e-mail']], atend_http('POST', '/api/atendentes', ['nome' => 'Bia', 'email' => 'bia@empresa.com.br', 'senha' => '123456'], [], $adm));
        Afirmar::igual(403, atend_http('POST', '/api/atendentes', ['nome' => 'X', 'email' => 'x@e.com.br', 'senha' => '123456'], [], atend_token_ana())[0]);
        $t = atend_token_ana();
        [$s, $eu] = atend_http('PATCH', '/api/atendentes/' . atend_ana()['id'], ['setor' => 'Comercial', 'disponivel' => false], [], $t);
        Afirmar::igual([200, 'Comercial', false], [$s, $eu['setor'], $eu['disponivel']]);
        Afirmar::igual([403, ['detail' => 'somente admin altera papel ou acesso']], atend_http('PATCH', '/api/atendentes/' . atend_ana()['id'], ['papel' => 'admin'], [], $t));
        Afirmar::igual([403, ['detail' => 'acao restrita a administradores']], atend_http('PATCH', '/api/atendentes/' . $novo['id'], ['nome' => 'Outra'], [], $t));
        Afirmar::igual(null, atend_http('PATCH', '/api/atendentes/' . atend_ana()['id'], ['setor' => ''], [], $t)[1]['setor']);
        Afirmar::igual(422, atend_http('PATCH', '/api/atendentes/' . atend_ana()['id'], ['setor' => str_repeat('x', 61)], [], $t)[0]);
        Afirmar::igual([404, ['detail' => 'atendente nao encontrado']], atend_http('PATCH', '/api/atendentes/9999', ['nome' => 'Outra'], [], $adm));
        [$s, $lista] = atend_http('GET', '/api/atendentes', null, [], $t);
        Afirmar::igual(['Administrador', 'Ana Suporte', 'Bia'], array_column($lista, 'nome'));
    },
    'rotas: contatos' => function (): void {
        Seed::semear();
        $t = atend_token_ana();
        $a = Contatos::resolver('whatsapp', '5511911110000', 'Padaria do Zé');
        $b = Contatos::resolver('email', 'duplicado@empresa.com.br', 'Duplicado B');
        Afirmar::igual(['Padaria do Zé'], array_column(atend_http('GET', '/api/contatos', null, ['q' => 'padaria'], $t)[1], 'nome'));
        [$s, $c] = atend_http('PATCH', "/api/contatos/{$b}", ['telefone' => '+55 (00) 91234-5678', 'email' => 'Dup@Empresa.com.br', 'empresa' => 'ACME'], [], $t);
        Afirmar::igual([200, '5500912345678', 'dup@empresa.com.br', 'ACME'], [$s, $c['telefone'], $c['email'], $c['empresa']]);
        Afirmar::igual(422, atend_http('PATCH', "/api/contatos/{$b}", ['email' => 'nao-e-email'], [], $t)[0]);
        Afirmar::igual(422, atend_http('PATCH', "/api/contatos/{$b}", ['nome' => null], [], $t)[0]);
        Afirmar::igual(null, atend_http('PATCH', "/api/contatos/{$b}", ['empresa' => null], [], $t)[1]['empresa']);
        [$s, $m] = atend_http('POST', "/api/contatos/{$a}/mesclar/{$b}", null, [], $t);
        Afirmar::igual(200, $s);
        Afirmar::igual(2, count($m['identidades']));
        Afirmar::igual([404, ['detail' => 'contato nao encontrado']], atend_http('GET', "/api/contatos/{$b}", null, [], $t));
        Afirmar::igual([404, ['detail' => 'contato nao encontrado']], atend_http('POST', "/api/contatos/{$a}/mesclar/9999", null, [], $t));
    },
    'rotas: respostas rapidas' => function (): void {
        Seed::semear();
        $t = atend_token_ana();
        [$s, $r] = atend_http('POST', '/api/respostas-rapidas', ['atalho' => ' /ola ', 'titulo' => 'Oi', 'conteudo' => 'Olá!'], [], $t);
        Afirmar::igual([201, 'ola'], [$s, $r['atalho']]);
        Afirmar::igual(409, atend_http('POST', '/api/respostas-rapidas', ['atalho' => 'ola', 'titulo' => 'Oi', 'conteudo' => 'Olá!'], [], $t)[0]);
        Afirmar::verdade(in_array('ola', array_column(atend_http('GET', '/api/respostas-rapidas', null, [], $t)[1], 'atalho'), true), 'listada');
        Afirmar::igual(204, atend_http('DELETE', "/api/respostas-rapidas/{$r['id']}", null, [], $t)[0]);
        Afirmar::igual([404, ['detail' => 'resposta nao encontrada']], atend_http('DELETE', "/api/respostas-rapidas/{$r['id']}", null, [], $t));
    },
];

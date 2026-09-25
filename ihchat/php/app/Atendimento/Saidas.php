<?php
declare(strict_types=1);

namespace IHchat\Atendimento;

use IHchat\Auth\Atendentes;
use IHchat\Banco\Banco;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\Json;

/**
 * Formatos de saída do atendimento (app/serializacao.py + app/schemas.py).
 *
 * Fica num lugar só porque a API e os eventos precisam do MESMO JSON: se
 * divergirem, o painel mostra uma coisa e recebe outra. As listas são
 * montadas em lote (uma consulta por tabela, não uma por linha).
 *
 *   ContatoSaida   {id, nome, empresa, documento, email, telefone, observacoes, identidades}
 *   CanalSaida     {id, nome, tipo, ativo, chave_publica, configurado, url_webhook}
 *   AnexoSaida     {id, nome, tipo_conteudo, tamanho, erro, imagem, url}
 *   MensagemSaida  {id, conversa_id, contato_id, direcao, tipo, conteudo, status, erro,
 *                   atendente_id, autor, assinatura, anexos, criada_em}
 *   ConversaSaida  {id, status, prioridade, assunto, previa, nao_lidas, ultima_mensagem_em,
 *                   criada_em, contato, canal, atendente, etiquetas}  (+ mensagens no detalhe)
 */
final class Saidas
{
    // ------------------------------------------------------------ simples

    /** @param array<string, mixed> $canal linha de `canais` */
    public static function canal(array $canal): array
    {
        return [
            'id' => (int) $canal['id'],
            'nome' => (string) $canal['nome'],
            'tipo' => (string) $canal['tipo'],
            'ativo' => (bool) $canal['ativo'],
            'chave_publica' => self::textoOuNulo($canal['chave_publica'] ?? null),
            'configurado' => Adaptadores::para($canal)->configurado(),
            // absoluta com url_publica, igual a GET /api/canais (o admin copia daqui)
            'url_webhook' => \IHchat\Canais\Canais::urlWebhook((int) $canal['id']),
        ];
    }

    /** @param array<string, mixed> $linha */
    public static function etiqueta(array $linha): array
    {
        return ['id' => (int) $linha['id'], 'nome' => (string) $linha['nome'], 'cor' => (string) $linha['cor']];
    }

    /** @param array<string, mixed> $linha */
    public static function respostaRapida(array $linha): array
    {
        return [
            'id' => (int) $linha['id'],
            'atalho' => (string) $linha['atalho'],
            'titulo' => (string) $linha['titulo'],
            'conteudo' => (string) $linha['conteudo'],
        ];
    }

    /**
     * @param array<string, mixed> $linha linha de `anexos`
     * @param string $base prefixo do link (o widget usa /api/widget/anexos)
     */
    public static function anexo(array $linha, string $base = '/api/anexos'): array
    {
        $tipo = (string) $linha['tipo_conteudo'];
        $chave = self::textoOuNulo($linha['chave'] ?? null);
        return [
            'id' => (int) $linha['id'],
            'nome' => (string) $linha['nome'],
            'tipo_conteudo' => $tipo,
            'tamanho' => (int) $linha['tamanho'],
            'erro' => self::textoOuNulo($linha['erro'] ?? null),
            'imagem' => in_array($tipo, Anexos::TIPOS_IMAGEM, true),
            // sem chave o arquivo não chegou a ser guardado: não há link a oferecer
            'url' => $chave === null ? null : $base . '/' . (int) $linha['id'],
        ];
    }

    // ----------------------------------------------------------- contatos

    public static function contatoPorId(int $id): ?array
    {
        return self::contatos([$id])[$id] ?? null;
    }

    /**
     * @param list<int> $ids
     * @return array<int, array<string, mixed>> ContatoSaida por id
     */
    public static function contatos(array $ids): array
    {
        $linhas = self::porIds('SELECT * FROM contatos WHERE id IN (%s)', $ids);
        return self::montarContatos($linhas);
    }

    /**
     * @param list<array<string, mixed>> $linhas linhas de `contatos`, na ordem desejada
     * @return array<int, array<string, mixed>>
     */
    public static function montarContatos(array $linhas): array
    {
        $ids = array_map(static fn (array $l): int => (int) $l['id'], $linhas);
        $identidades = [];
        foreach (self::porIds('SELECT * FROM contato_identidades WHERE contato_id IN (%s) ORDER BY id', $ids) as $i) {
            $identidades[(int) $i['contato_id']][] = [
                'canal_tipo' => (string) $i['canal_tipo'],
                'identificador' => (string) $i['identificador'],
                'nome_exibicao' => self::textoOuNulo($i['nome_exibicao'] ?? null, vazioENulo: false),
            ];
        }
        $saida = [];
        foreach ($linhas as $l) {
            $id = (int) $l['id'];
            $saida[$id] = [
                'id' => $id,
                'nome' => (string) $l['nome'],
                'empresa' => self::textoOuNulo($l['empresa'] ?? null, vazioENulo: false),
                'documento' => self::textoOuNulo($l['documento'] ?? null, vazioENulo: false),
                'email' => self::textoOuNulo($l['email'] ?? null, vazioENulo: false),
                'telefone' => self::textoOuNulo($l['telefone'] ?? null, vazioENulo: false),
                'observacoes' => self::textoOuNulo($l['observacoes'] ?? null, vazioENulo: false),
                'identidades' => $identidades[$id] ?? [],
            ];
        }
        return $saida;
    }

    // ---------------------------------------------------------- mensagens

    /** A mensagem veio do celular do dono (metadados.enviada_pelo_celular)? */
    private static function peloCelular(mixed $metadados): bool
    {
        $dados = is_array($metadados) ? $metadados : Json::ler(is_string($metadados) ? $metadados : null, []);
        return is_array($dados) && ($dados['enviada_pelo_celular'] ?? false) === true;
    }

    public static function mensagemPorId(int $id): ?array
    {
        $linha = Banco::um('SELECT * FROM mensagens WHERE id = ?', [$id]);
        return $linha === null ? null : self::mensagens([$linha])[0];
    }

    /**
     * @param list<array<string, mixed>> $linhas linhas de `mensagens`
     * @return list<array<string, mixed>> MensagemSaida na mesma ordem
     */
    public static function mensagens(array $linhas): array
    {
        if ($linhas === []) {
            return [];
        }
        $ids = array_map(static fn (array $l): int => (int) $l['id'], $linhas);
        $anexos = [];
        foreach (self::porIds('SELECT * FROM anexos WHERE mensagem_id IN (%s) ORDER BY id', $ids) as $a) {
            $anexos[(int) $a['mensagem_id']][] = self::anexo($a);
        }
        // o widget filtra os eventos por contato, não por conversa
        $conversas = [];
        $conversaIds = array_values(array_unique(array_map(static fn (array $l): int => (int) $l['conversa_id'], $linhas)));
        foreach (self::porIds(
            'SELECT c.id, c.contato_id, ct.nome FROM conversas c JOIN contatos ct ON ct.id = c.contato_id WHERE c.id IN (%s)',
            $conversaIds
        ) as $c) {
            $conversas[(int) $c['id']] = ['contato_id' => (int) $c['contato_id'], 'nome' => (string) $c['nome']];
        }
        $atendentes = self::nomesDeAtendentes(array_map(static fn (array $l): ?int => self::inteiroOuNulo($l['atendente_id'] ?? null), $linhas));

        $saida = [];
        foreach ($linhas as $l) {
            $id = (int) $l['id'];
            $conversa = $conversas[(int) $l['conversa_id']] ?? null;
            $atendenteId = self::inteiroOuNulo($l['atendente_id'] ?? null);
            $assinatura = self::assinatura($l['assinatura'] ?? null);
            $saida[] = [
                'id' => $id,
                'conversa_id' => (int) $l['conversa_id'],
                'contato_id' => $conversa['contato_id'] ?? null,
                'direcao' => (string) $l['direcao'],
                'tipo' => (string) $l['tipo'],
                'conteudo' => (string) $l['conteudo'],
                'status' => (string) $l['status'],
                'erro' => self::textoOuNulo($l['erro'] ?? null, vazioENulo: false),
                'atendente_id' => $atendenteId,
                'autor' => self::autor((string) $l['tipo'], (string) $l['direcao'], $atendenteId, $atendentes, $assinatura, $conversa),
                'assinatura' => $assinatura,
                'anexos' => $anexos[$id] ?? [],
                'criada_em' => Datas::iso((string) $l['criada_em']),
                // WhatsApp pelo QR Code: o dono respondeu direto pelo celular
                // (não saiu pelo IHchat nem levou assinatura). Igual ao Python.
                'pelo_celular' => self::peloCelular($l['metadados'] ?? null),
            ];
        }
        return $saida;
    }

    /**
     * Quem escreveu (autor_de do Python). Mensagem de saída cujo atendente foi
     * apagado continua com o nome gravado na assinatura, em vez de virar o
     * nome do cliente.
     *
     * @param array<int, string> $atendentes
     * @param array{nome: string, setor: ?string}|null $assinatura
     * @param array{contato_id: int, nome: string}|null $conversa
     */
    private static function autor(string $tipo, string $direcao, ?int $atendenteId, array $atendentes, ?array $assinatura, ?array $conversa): string
    {
        if ($tipo === 'sistema') {
            return 'Sistema';
        }
        if ($atendenteId !== null && isset($atendentes[$atendenteId])) {
            return $atendentes[$atendenteId];
        }
        if ($direcao === 'saida' && $assinatura !== null) {
            return $assinatura['nome'];
        }
        return $conversa['nome'] ?? 'Contato';
    }

    /** @return array{nome: string, setor: ?string}|null */
    public static function assinatura(mixed $valor): ?array
    {
        if ($valor === null || $valor === '') {
            return null;
        }
        $dados = is_array($valor) ? $valor : Json::ler((string) $valor, null);
        if (!is_array($dados) || !isset($dados['nome'])) {
            return null;
        }
        $setor = $dados['setor'] ?? null;
        return ['nome' => (string) $dados['nome'], 'setor' => $setor === null || $setor === '' ? null : (string) $setor];
    }

    // ---------------------------------------------------------- conversas

    public static function conversaPorId(int $id): ?array
    {
        $linha = Banco::um('SELECT * FROM conversas WHERE id = ?', [$id]);
        return $linha === null ? null : self::conversas([$linha])[0];
    }

    /** ConversaDetalhe: a conversa com todas as mensagens em ordem cronológica. */
    public static function conversaDetalhe(int $id): ?array
    {
        $conversa = self::conversaPorId($id);
        if ($conversa === null) {
            return null;
        }
        $conversa['mensagens'] = self::mensagens(
            Banco::todos('SELECT * FROM mensagens WHERE conversa_id = ? ORDER BY criada_em, id', [$id])
        );
        return $conversa;
    }

    /**
     * @param list<array<string, mixed>> $linhas linhas de `conversas`, na ordem desejada
     * @return list<array<string, mixed>> ConversaSaida
     */
    public static function conversas(array $linhas): array
    {
        if ($linhas === []) {
            return [];
        }
        $ids = array_map(static fn (array $l): int => (int) $l['id'], $linhas);
        $contatos = self::contatos(array_map(static fn (array $l): int => (int) $l['contato_id'], $linhas));

        $canais = [];
        foreach (self::porIds('SELECT * FROM canais WHERE id IN (%s)', array_map(static fn (array $l): int => (int) $l['canal_id'], $linhas)) as $c) {
            $canais[(int) $c['id']] = self::canal(Adaptadores::comCredenciais($c));
        }

        $atendentes = [];
        $atendenteIds = array_values(array_filter(array_map(static fn (array $l): ?int => self::inteiroOuNulo($l['atendente_id'] ?? null), $linhas)));
        foreach (self::porIds('SELECT * FROM atendentes WHERE id IN (%s)', $atendenteIds) as $a) {
            $atendentes[(int) $a['id']] = Atendentes::saida(Atendentes::tipar($a));
        }

        $etiquetas = [];
        foreach (self::porIds(
            'SELECT ce.conversa_id, e.id, e.nome, e.cor FROM conversa_etiqueta ce
             JOIN etiquetas e ON e.id = ce.etiqueta_id WHERE ce.conversa_id IN (%s) ORDER BY e.nome, e.id',
            $ids
        ) as $e) {
            $etiquetas[(int) $e['conversa_id']][] = self::etiqueta($e);
        }

        $saida = [];
        foreach ($linhas as $l) {
            $id = (int) $l['id'];
            $atendenteId = self::inteiroOuNulo($l['atendente_id'] ?? null);
            $saida[] = [
                'id' => $id,
                'status' => (string) $l['status'],
                'prioridade' => (string) $l['prioridade'],
                'assunto' => self::textoOuNulo($l['assunto'] ?? null, vazioENulo: false),
                'previa' => self::textoOuNulo($l['previa'] ?? null, vazioENulo: false),
                'nao_lidas' => (int) $l['nao_lidas'],
                'ultima_mensagem_em' => Datas::iso((string) $l['ultima_mensagem_em']),
                'criada_em' => Datas::iso((string) $l['criada_em']),
                'contato' => $contatos[(int) $l['contato_id']] ?? null,
                'canal' => $canais[(int) $l['canal_id']] ?? null,
                'atendente' => $atendenteId === null ? null : ($atendentes[$atendenteId] ?? null),
                'etiquetas' => $etiquetas[$id] ?? [],
            ];
        }
        return $saida;
    }

    // -------------------------------------------------------------- apoio

    /**
     * SELECT ... WHERE x IN (?, ?, ...) com os ids como parâmetros (sem
     * nenhum valor concatenado no SQL). Lista vazia não consulta nada.
     *
     * @param list<int|null> $ids
     * @return list<array<string, mixed>>
     */
    public static function porIds(string $sqlComIn, array $ids): array
    {
        $ids = array_values(array_unique(array_map('intval', array_filter($ids, static fn ($i): bool => $i !== null))));
        if ($ids === []) {
            return [];
        }
        $resultado = [];
        // lotes: o SQLite antigo limita a 999 parâmetros por consulta
        foreach (array_chunk($ids, 500) as $lote) {
            $marcadores = implode(', ', array_fill(0, count($lote), '?'));
            array_push($resultado, ...Banco::todos(sprintf($sqlComIn, $marcadores), $lote));
        }
        return $resultado;
    }

    /**
     * @param list<int|null> $ids
     * @return array<int, string> nome por id
     */
    private static function nomesDeAtendentes(array $ids): array
    {
        $nomes = [];
        foreach (self::porIds('SELECT id, nome FROM atendentes WHERE id IN (%s)', $ids) as $a) {
            $nomes[(int) $a['id']] = (string) $a['nome'];
        }
        return $nomes;
    }

    public static function inteiroOuNulo(mixed $valor): ?int
    {
        return $valor === null || $valor === '' ? null : (int) $valor;
    }

    private static function textoOuNulo(mixed $valor, bool $vazioENulo = true): ?string
    {
        if ($valor === null || ($vazioENulo && $valor === '')) {
            return null;
        }
        return (string) $valor;
    }
}

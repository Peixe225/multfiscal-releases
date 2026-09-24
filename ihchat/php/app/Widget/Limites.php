<?php
declare(strict_types=1);

namespace IHchat\Widget;

use IHchat\Banco\Banco;
use IHchat\Nucleo\Config;
use IHchat\Nucleo\Datas;
use IHchat\Nucleo\ErroHttp;
use IHchat\Nucleo\Log;

/**
 * Freios do widget: a única porta da API aberta a anônimos.
 *
 * A chave pública do webchat vai no HTML do site, então qualquer um abre
 * sessões e manda arquivos. Sem limite, um laço de "sessão + anexo de 20 MB"
 * enche o disco da conta compartilhada, e aí param o MySQL e os OUTROS sites
 * do domínio. Os limites são folgados para gente de verdade (um escritório
 * inteiro atrás do mesmo IP) e apertados para um robô:
 *
 *  - sessões novas por IP por hora;
 *  - mensagens por sessão por minuto;
 *  - arquivos e bytes por sessão por dia, bytes por IP por dia;
 *  - bytes de todos os visitantes do site por dia (507: o disco é de todos).
 *
 * O que é por sessão sai do próprio banco (cada sessão tem o seu contato).
 * O que é por IP não tem coluna no banco: fica em arquivos pequenos em
 * dados/widget-limites/, um por IP (só o hash, nunca o endereço), com
 * janelas fixas de hora e de dia. Falha de disco ao contar não barra o
 * visitante: o freio existe para proteger o disco, não para derrubar o chat.
 */
final class Limites
{
    public const SESSOES_POR_IP_HORA = 120;
    public const MENSAGENS_POR_SESSAO_MINUTO = 20;
    public const ARQUIVOS_POR_SESSAO_DIA = 40;
    public const MB_POR_SESSAO_DIA = 100;
    public const MB_POR_IP_DIA = 300;
    public const MB_DO_SITE_POR_DIA = 2048;

    private const PASTA = 'widget-limites';
    /** Uma faxina dos arquivos de IP a cada N sessões, em média. */
    private const CHANCE_FAXINA = 200;

    /** Abre mais uma sessão para este IP, ou 429. */
    public static function novaSessao(string $ip, int $maximo = self::SESSOES_POR_IP_HORA, ?string $pasta = null): void
    {
        $hora = intdiv(time(), 3600);
        $recusada = false;
        self::alterarContador($ip, $pasta, static function (array $c) use ($hora, $maximo, &$recusada): array {
            if (($c['hora'] ?? null) !== $hora) {
                $c['hora'] = $hora;
                $c['sessoes'] = 0;
            }
            if ($c['sessoes'] >= $maximo) {
                $recusada = true;
                return $c;
            }
            $c['sessoes']++;
            return $c;
        });
        if ($recusada) {
            throw new ErroHttp(429, 'muitas conversas abertas a partir deste endereço; tente de novo mais tarde', [
                'Retry-After' => (string) (3600 - time() % 3600),
            ]);
        }
        if (random_int(1, self::CHANCE_FAXINA) === 1) {
            self::podarContadores($pasta);
        }
    }

    /**
     * Mais uma mensagem (texto ou arquivo) desta sessão, ou 429.
     *
     * @param array<string, mixed> $sessao linha de sessoes_widget
     */
    public static function mensagem(array $sessao, int $maximo = self::MENSAGENS_POR_SESSAO_MINUTO): void
    {
        $recentes = (int) Banco::valor(
            "SELECT COUNT(*) FROM mensagens m JOIN conversas c ON c.id = m.conversa_id
             WHERE c.contato_id = ? AND c.canal_id = ? AND m.direcao = 'entrada' AND m.criada_em >= ?",
            [(int) $sessao['contato_id'], (int) $sessao['canal_id'], Datas::haHoras(1 / 60)]
        );
        if ($recentes >= $maximo) {
            throw new ErroHttp(429, 'muitas mensagens em pouco tempo; aguarde um instante', ['Retry-After' => '60']);
        }
    }

    /**
     * Cabe mais um arquivo de $bytes? 429 (sessão ou IP) ou 507 (o site todo).
     * Chame antes de gravar; depois de gravar, registrarArquivo().
     *
     * @param array<string, mixed> $sessao
     * @param array{arquivos?: int, mb_sessao?: int, mb_ip?: int, mb_site?: int} $limites só para testes
     */
    public static function arquivo(array $sessao, string $ip, int $bytes, array $limites = [], ?string $pasta = null): void
    {
        $mb = 1024 * 1024;
        $desde = Datas::haHoras(24);
        $daSessao = Banco::um(
            "SELECT COUNT(*) AS quantos, COALESCE(SUM(a.tamanho), 0) AS bytes
             FROM anexos a JOIN mensagens m ON m.id = a.mensagem_id JOIN conversas c ON c.id = m.conversa_id
             WHERE c.contato_id = ? AND c.canal_id = ? AND m.direcao = 'entrada' AND a.criado_em >= ?",
            [(int) $sessao['contato_id'], (int) $sessao['canal_id'], $desde]
        ) ?? ['quantos' => 0, 'bytes' => 0];
        if ((int) $daSessao['quantos'] >= ($limites['arquivos'] ?? self::ARQUIVOS_POR_SESSAO_DIA)
            || (int) $daSessao['bytes'] + $bytes > ($limites['mb_sessao'] ?? self::MB_POR_SESSAO_DIA) * $mb) {
            throw new ErroHttp(429, 'limite de arquivos desta conversa atingido; tente de novo amanhã', ['Retry-After' => '3600']);
        }

        $doIp = self::lerContador($ip, $pasta);
        $hoje = intdiv(time(), 86400);
        $usadosIp = ($doIp['dia'] ?? null) === $hoje ? (int) ($doIp['bytes'] ?? 0) : 0;
        if ($usadosIp + $bytes > ($limites['mb_ip'] ?? self::MB_POR_IP_DIA) * $mb) {
            throw new ErroHttp(429, 'limite de arquivos deste endereço atingido; tente de novo amanhã', ['Retry-After' => '3600']);
        }

        // todos os visitantes de todos os webchats: o disco da conta é um só
        $doSite = (int) Banco::valor(
            "SELECT COALESCE(SUM(a.tamanho), 0)
             FROM anexos a JOIN mensagens m ON m.id = a.mensagem_id
             JOIN conversas c ON c.id = m.conversa_id JOIN canais k ON k.id = c.canal_id
             WHERE k.tipo = 'webchat' AND m.direcao = 'entrada' AND a.criado_em >= ?",
            [$desde]
        );
        if ($doSite + $bytes > ($limites['mb_site'] ?? self::MB_DO_SITE_POR_DIA) * $mb) {
            Log::aviso('widget: limite diário de arquivos do site atingido', ['bytes_hoje' => $doSite]);
            throw new ErroHttp(507, 'o limite diário de arquivos enviados pelo site foi atingido; tente de novo amanhã');
        }
    }

    /** Soma os bytes de um arquivo aceito na conta do IP. */
    public static function registrarArquivo(string $ip, int $bytes, ?string $pasta = null): void
    {
        $hoje = intdiv(time(), 86400);
        self::alterarContador($ip, $pasta, static function (array $c) use ($hoje, $bytes): array {
            if (($c['dia'] ?? null) !== $hoje) {
                $c['dia'] = $hoje;
                $c['bytes'] = 0;
            }
            $c['bytes'] += $bytes;
            return $c;
        });
    }

    /** Apaga os contadores de IP parados há mais de dois dias. Devolve quantos. */
    public static function podarContadores(?string $pasta = null): int
    {
        $apagados = 0;
        foreach (glob(self::pasta($pasta) . '/*.json') ?: [] as $arquivo) {
            $mudou = @filemtime($arquivo);
            if ($mudou !== false && $mudou < time() - 2 * 86400 && @unlink($arquivo)) {
                $apagados++;
            }
        }
        return $apagados;
    }

    // -------------------------------------------------------------- apoio

    private static function pasta(?string $pasta): string
    {
        return $pasta ?? (Config::obter()->pasta_dados . '/' . self::PASTA);
    }

    private static function arquivoDoIp(string $ip, ?string $pasta): string
    {
        // hash com prefixo próprio: o endereço do visitante não vai para o disco
        return self::pasta($pasta) . '/' . substr(hash('sha256', 'ihchat-widget|' . $ip), 0, 32) . '.json';
    }

    /** @return array<string, int> */
    private static function lerContador(string $ip, ?string $pasta): array
    {
        $texto = @file_get_contents(self::arquivoDoIp($ip, $pasta));
        return self::decodificar(is_string($texto) ? $texto : '');
    }

    /**
     * Lê, altera e grava o contador do IP com o arquivo travado: duas
     * requisições ao mesmo tempo não contam uma só.
     *
     * @param callable(array<string, int>): array<string, int> $alterar
     */
    private static function alterarContador(string $ip, ?string $pasta, callable $alterar): void
    {
        $dir = self::pasta($pasta);
        if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
            Log::aviso('widget: não foi possível criar a pasta dos limites', ['pasta' => $dir]);
            $alterar(self::decodificar('')); // conta em memória só para decidir a recusa
            return;
        }
        $f = @fopen(self::arquivoDoIp($ip, $pasta), 'c+');
        if ($f === false) {
            $alterar(self::decodificar(''));
            return;
        }
        try {
            flock($f, LOCK_EX);
            $atual = self::decodificar((string) stream_get_contents($f));
            $novo = $alterar($atual);
            if ($novo !== $atual) {
                rewind($f);
                ftruncate($f, 0);
                fwrite($f, (string) json_encode($novo));
                fflush($f);
            }
        } finally {
            flock($f, LOCK_UN);
            fclose($f);
        }
    }

    /** @return array<string, int> */
    private static function decodificar(string $texto): array
    {
        $dados = $texto === '' ? null : json_decode($texto, true);
        $limpo = ['hora' => -1, 'sessoes' => 0, 'dia' => -1, 'bytes' => 0];
        if (!is_array($dados)) {
            return $limpo;
        }
        foreach ($limpo as $chave => $_) {
            if (isset($dados[$chave]) && is_int($dados[$chave])) {
                $limpo[$chave] = $dados[$chave];
            }
        }
        return $limpo;
    }
}

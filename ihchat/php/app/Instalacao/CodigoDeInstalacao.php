<?php
declare(strict_types=1);

namespace IHchat\Instalacao;

use IHchat\Nucleo\ErroHttp;

/**
 * O código que prova que quem está no /instalar é o dono do servidor.
 *
 * Entre o upload dos arquivos e a instalação, o /instalar fica aberto na
 * internet: sem uma prova de posse, qualquer um que chegasse primeiro criaria
 * o administrador e apontaria o sistema para um banco dele. A prova é um
 * arquivo que só quem tem acesso ao servidor consegue criar:
 * dados/instalacao.codigo (fora do public/, gravado pelo implantar_hostinger.py
 * ou pelo Gerenciador de Arquivos). Sem esse arquivo, nada instala.
 *
 * Contra força bruta: comparação em tempo constante e, depois de
 * MAX_FALHAS erros em JANELA segundos vindos do MESMO endereço IP, recusa
 * esse endereço até a janela passar (mesmo com o código certo, para não
 * servir de oráculo). A conta é por IP de propósito: com um contador único,
 * qualquer um que achasse o /instalar mandaria 10 chutes a cada 15 minutos e
 * o dono nunca conseguiria instalar. O IP é o REMOTE_ADDR (X-Forwarded-For
 * seria forjável) e vai para o arquivo só como hash.
 *
 * Destravar na hora: apagar dados/instalacao.tentativas.
 */
final class CodigoDeInstalacao
{
    public const ARQUIVO = 'instalacao.codigo';
    private const TENTATIVAS = 'instalacao.tentativas';
    /** Código curto demais seria adivinhável: tratado como ausente. */
    public const TAMANHO_MINIMO = 16;
    public const MAX_FALHAS = 10;
    public const JANELA = 900;
    /** Endereços lembrados no arquivo de tentativas (os mais antigos saem). */
    private const MAX_ORIGENS = 500;

    public function __construct(private readonly string $pastaDados)
    {
    }

    public function caminho(): string
    {
        return $this->pastaDados . '/' . self::ARQUIVO;
    }

    /** O código do arquivo, ou null se ausente/curto demais. */
    private function esperado(): ?string
    {
        $arquivo = $this->caminho();
        if (!is_file($arquivo)) {
            return null;
        }
        $codigo = trim((string) @file_get_contents($arquivo));
        return strlen($codigo) >= self::TAMANHO_MINIMO ? $codigo : null;
    }

    public function existe(): bool
    {
        return $this->esperado() !== null;
    }

    /**
     * Confere o código digitado. Chame com a trava da instalação já tomada:
     * o contador de falhas é lido e gravado sem corrida.
     *
     * @param string $origem IP de quem tenta (REMOTE_ADDR)
     * @throws ErroHttp 403 (sem arquivo ou código errado) ou 429 (muitas falhas desse IP)
     */
    public function conferir(#[\SensitiveParameter] string $informado, string $origem = ''): void
    {
        $esperado = $this->esperado();
        if ($esperado === null) {
            throw ErroHttp::proibido(
                'instalação bloqueada: crie o arquivo dados/' . self::ARQUIVO
                . ' no servidor (fora do public) com o código de instalação'
            );
        }
        $agora = time();
        $todas = $this->lerTentativas($agora);
        $chave = 'ip_' . substr(hash('sha256', 'ihchat-instalacao|' . $origem), 0, 24);
        $estado = $todas[$chave] ?? ['falhas' => 0, 'desde' => $agora];
        if ($estado['falhas'] >= self::MAX_FALHAS) {
            $espera = max(1, self::JANELA - ($agora - $estado['desde']));
            throw new ErroHttp(429, 'muitas tentativas com código errado; aguarde ' . (int) ceil($espera / 60)
                . ' minuto(s) ou apague o arquivo dados/' . self::TENTATIVAS . ' no Gerenciador de Arquivos', [
                'Retry-After' => (string) $espera,
            ]);
        }
        if (!hash_equals($esperado, trim($informado))) {
            $estado['falhas']++;
            $todas[$chave] = $estado;
            $this->gravarTentativas($todas);
            throw ErroHttp::proibido('código de instalação inválido');
        }
    }

    /** Depois da instalação o código não serve mais para nada: some do disco. */
    public function apagar(): void
    {
        @unlink($this->caminho());
        @unlink($this->pastaDados . '/' . self::TENTATIVAS);
    }

    /**
     * Falhas por origem ainda dentro da janela (as vencidas somem aqui).
     *
     * @return array<string, array{falhas: int, desde: int}>
     */
    private function lerTentativas(int $agora): array
    {
        $texto = @file_get_contents($this->pastaDados . '/' . self::TENTATIVAS);
        $dados = is_string($texto) ? json_decode($texto, true) : null;
        $validas = [];
        foreach (is_array($dados) ? $dados : [] as $chave => $estado) {
            if (!is_string($chave) || !is_array($estado)) {
                continue; // formato antigo (contador único) ou lixo: recomeça
            }
            $desde = (int) ($estado['desde'] ?? 0);
            if ($agora - $desde < self::JANELA) {
                $validas[$chave] = ['falhas' => (int) ($estado['falhas'] ?? 0), 'desde' => $desde];
            }
        }
        return $validas;
    }

    /** @param array<string, array{falhas: int, desde: int}> $todas */
    private function gravarTentativas(array $todas): void
    {
        if (count($todas) > self::MAX_ORIGENS) {
            // um robô com muitos IPs não faz o arquivo crescer sem fim
            uasort($todas, static fn (array $a, array $b): int => $b['desde'] <=> $a['desde']);
            $todas = array_slice($todas, 0, self::MAX_ORIGENS, true);
        }
        @file_put_contents($this->pastaDados . '/' . self::TENTATIVAS, json_encode($todas), LOCK_EX);
    }
}

<?php
declare(strict_types=1);

namespace OmniChannel\Instalacao;

use OmniChannel\Banco\Banco;
use OmniChannel\Banco\Esquema;
use OmniChannel\Nucleo\Aplicacao;
use OmniChannel\Nucleo\Config;
use OmniChannel\Nucleo\ErroHttp;
use OmniChannel\Nucleo\ErroValidacao;
use OmniChannel\Nucleo\Log;
use OmniChannel\Nucleo\Requisicao;
use OmniChannel\Nucleo\Resposta;
use OmniChannel\Nucleo\Validador;

/**
 * Instalador web (/instalar): transforma uma pasta recém-enviada num sistema
 * funcionando, sem SSH e sem editar arquivo à mão.
 *
 * Regras de segurança, nesta ordem:
 *  1. só existe enquanto não há config.php — instalado, responde 404 para
 *     sempre (ninguém "reinstala" por cima e toma o sistema);
 *  2. exige o código de dados/instalacao.codigo (ver CodigoDeInstalacao);
 *  3. uma instalação por vez (trava de arquivo) e conferência do config de
 *     novo depois de pegar a trava;
 *  4. senha forte para o admin, chave_secreta aleatória de 256 bits,
 *     config.php 0600 fora do public/, código apagado no fim;
 *  5. página sem script, com CSP fechada, sem cache e sem Referer.
 *
 * Fala HTML (formulário do navegador) e JSON (mesmo corpo, para automação e
 * para a suíte de contrato): sucesso é 201 em JSON e 200 em HTML.
 */
final class Instalador
{
    /** Tipos de banco aceitos no formulário. */
    public const BANCOS = ['mysql', 'sqlite'];
    private const SENHAS_OBVIAS = ['1234567890', 'senha12345', 'password123', 'admin12345', 'qwertyuiop', 'omnichannel'];

    /** Ponto de entrada de public/instalar.php. */
    public static function executar(): void
    {
        ini_set('display_errors', '0');
        set_error_handler([Aplicacao::class, 'tratarAviso']);
        ob_start();
        $req = Requisicao::doAmbiente();
        $resposta = self::atender($req);
        ob_end_clean(); // nada de aviso perdido no meio do HTML
        $resposta->enviar($req->metodo === 'HEAD');
    }

    public static function atender(Requisicao $req): Resposta
    {
        $json = self::quereJson($req);
        try {
            if (self::instalado()) {
                $resposta = Resposta::erro(404, 'Not Found');
            } elseif (in_array($req->metodo, ['GET', 'HEAD'], true)) {
                $resposta = Resposta::texto(PaginaInstalador::formulario(
                    self::valoresPadrao($req),
                    [],
                    (new CodigoDeInstalacao(self::pastaDados()))->existe(),
                    $req->esquema() === 'https' || self::eLocal($req),
                    self::pastaDaRequisicao($req),
                ), 200, 'text/html; charset=utf-8');
            } elseif ($req->metodo === 'POST') {
                $resposta = self::instalar($req, $json);
            } else {
                $resposta = Resposta::erro(405, 'Method Not Allowed');
                $resposta->cabecalho('Allow', 'GET, POST');
            }
        } catch (ErroHttp $erro) {
            $resposta = self::respostaDeErro($req, $erro, $json);
        } catch (\Throwable $erro) {
            // sem config.php o Log comum não tem pasta: grava direto em dados/logs
            self::registrar('falha inesperada', $erro);
            $resposta = self::respostaDeErro($req, new ErroHttp(500, 'erro interno do servidor'), $json);
        }
        return self::protegida($resposta);
    }

    public static function instalado(): bool
    {
        return is_file(Config::caminhoDoArquivo());
    }

    /** dados/ ao lado do config.php (php/dados em produção). */
    public static function pastaDados(): string
    {
        return dirname(Config::caminhoDoArquivo()) . '/dados';
    }

    private static function instalar(Requisicao $req, bool $json): Resposta
    {
        $pasta = self::pastaDados();
        if (!is_dir($pasta) && !@mkdir($pasta, 0775, true)) {
            error_log("OmniChannel instalação: não consegui criar {$pasta}");
            throw new ErroHttp(500, 'sem permissão para criar a pasta dados/ ao lado do config.php');
        }
        if (!is_file($pasta . '/.htaccess')) {
            @file_put_contents($pasta . '/.htaccess', "Require all denied\n");
        }

        $trava = fopen($pasta . '/instalacao.lock', 'c');
        if ($trava === false || !flock($trava, LOCK_EX)) {
            throw new ErroHttp(500, 'não foi possível travar a instalação');
        }
        $config = new ArquivoDeConfig(Config::caminhoDoArquivo());
        try {
            // outra requisição pode ter instalado enquanto esta esperava a trava
            if (self::instalado()) {
                return Resposta::erro(404, 'Not Found');
            }
            $dados = self::dadosDaRequisicao($req, $json);
            $codigo = new CodigoDeInstalacao($pasta);
            $codigo->conferir(is_string($dados['codigo'] ?? null) ? $dados['codigo'] : '', $req->ip);

            $pedido = self::validar($dados, $req);
            $valores = self::valoresDoConfig($pedido, $pasta);

            // temporário primeiro: pasta sem escrita para aqui, antes do banco
            try {
                $config->preparar($valores['arquivo'], $valores['relativas']);
            } catch (\RuntimeException $erro) {
                self::registrar($erro->getMessage());
                throw new ErroHttp(500, 'sem permissão para gravar o config.php na pasta do sistema');
            }

            Config::definir(Config::deArray($valores['memoria'], Config::caminhoDoArquivo()));
            Banco::definir(null);
            try {
                Banco::conexao();
            } catch (\PDOException $erro) {
                $motivo = self::mascarar($erro->getMessage(), $pedido['banco_senha']);
                throw ErroHttp::requisicaoInvalida('não foi possível conectar ao banco de dados: ' . $motivo);
            }
            try {
                $base = BaseInicial::criar($pedido['admin_nome'], $pedido['admin_email'], $pedido['admin_senha'], $pedido['exemplos']);
            } catch (\PDOException $erro) {
                // típico: usuário do banco sem permissão de CREATE/ALTER. O dono
                // precisa do motivo na tela (o log do PHP costuma estar desligado)
                $motivo = self::mascarar($erro->getMessage(), $pedido['banco_senha']);
                self::registrar('falha ao preparar o banco: ' . $motivo, $erro, $pedido['banco_senha']);
                throw ErroHttp::requisicaoInvalida('não foi possível preparar o banco de dados: ' . $motivo);
            }

            $config->efetivar();
            $codigo->apagar();
            Esquema::garantir(); // deixa a marca do esquema: a 1ª requisição já sai rápida
            Log::info('instalação concluída', [
                'admin' => $pedido['admin_email'], 'banco' => $pedido['banco_tipo'], 'exemplos' => $base['exemplos'],
            ]);

            $resultado = [
                'instalado' => true,
                'url_painel' => $pedido['url_publica'] . '/painel',
                'admin' => ['nome' => $pedido['admin_nome'], 'email' => $pedido['admin_email']],
                'banco' => $pedido['banco_tipo'],
                'exemplos' => $base['exemplos'],
                'chave_webchat' => $base['chave_webchat'],
                'url_widget' => $pedido['url_publica'] . '/widget.js',
            ];
            if ($json) {
                return Resposta::json($resultado, 201);
            }
            return Resposta::texto(PaginaInstalador::concluida($resultado), 200, 'text/html; charset=utf-8');
        } catch (\Throwable $erro) {
            $config->descartar();
            Config::definir(null);
            Banco::definir(null);
            throw $erro;
        } finally {
            flock($trava, LOCK_UN);
            fclose($trava);
        }
    }

    /** @return array<string, mixed> */
    private static function dadosDaRequisicao(Requisicao $req, bool $json): array
    {
        if (str_contains($req->tipoConteudo(), 'json')) {
            return $req->jsonObjeto();
        }
        return $req->formulario;
    }

    /**
     * @param array<string, mixed> $dados
     * @return array{banco_tipo: string, banco_host: string, banco_porta: int, banco_nome: string,
     *   banco_usuario: string, banco_senha: string, admin_nome: string, admin_email: string,
     *   admin_senha: string, url_publica: string, exemplos: bool}
     */
    public static function validar(array $dados, Requisicao $req): array
    {
        // formulário HTML manda "" em campo vazio; para a validação, vazio é ausente
        $limpos = array_filter($dados, static fn ($v): bool => $v !== '' && $v !== null);
        $v = new Validador($limpos);
        $tipo = $v->opcao('banco_tipo', self::BANCOS, obrigatorio: false, padrao: 'mysql') ?? 'mysql';
        $mysql = $tipo === 'mysql';
        $host = $v->texto('banco_host', max: 255, obrigatorio: false, padrao: '127.0.0.1', aparar: true, rotulo: 'servidor do banco') ?? '';
        $porta = $v->inteiro('banco_porta', obrigatorio: false, padrao: 3306, minimo: 1, maximo: 65535, rotulo: 'porta do banco') ?? 3306;
        $nomeBanco = $v->texto('banco_nome', min: 1, max: 64, obrigatorio: $mysql, aparar: true, rotulo: 'nome do banco') ?? '';
        $usuario = $v->texto('banco_usuario', min: 1, max: 80, obrigatorio: $mysql, aparar: true, rotulo: 'usuário do banco') ?? '';
        $senhaBanco = $v->texto('banco_senha', max: 255, obrigatorio: false, padrao: '', rotulo: 'senha do banco') ?? '';
        // o DSN é montado com esses textos: nada de ";" ou "=" que injete parâmetro
        if ($mysql && $host !== '' && preg_match('/^[A-Za-z0-9.\-]+$|^\[[0-9A-Fa-f:]+\]$/', $host) !== 1) {
            $v->falhar('banco_host', 'servidor do banco: use um nome ou IP (ex.: 127.0.0.1)');
        }
        if ($mysql && $nomeBanco !== '' && preg_match('/^[A-Za-z0-9_$\-]+$/', $nomeBanco) !== 1) {
            $v->falhar('banco_nome', 'nome do banco: use só letras, números, _ e -');
        }

        $nome = $v->texto('admin_nome', min: 2, max: 120, aparar: true, rotulo: 'nome do administrador') ?? '';
        $email = $v->email('admin_email', rotulo: 'e-mail do administrador') ?? '';
        if (strlen($email) > 160) {
            $v->falhar('admin_email', 'e-mail do administrador: pode ter no máximo 160 caracteres');
        }
        $senha = $v->texto('admin_senha', rotulo: 'senha do administrador') ?? '';
        if ($senha !== '' && ($problema = self::problemaDaSenha($senha, $email, $nome)) !== null) {
            $v->falhar('admin_senha', 'senha do administrador: ' . $problema);
        }
        if (array_key_exists('admin_senha_confirmacao', $dados) && $senha !== '' && $dados['admin_senha_confirmacao'] !== $senha) {
            $v->falhar('admin_senha_confirmacao', 'confirmação da senha: não confere com a senha');
        }

        $url = $v->texto('url_publica', max: 255, obrigatorio: false, aparar: true, rotulo: 'endereço público')
            ?? self::urlDaRequisicao($req);
        $url = rtrim($url, '/');
        $partes = parse_url($url);
        $informada = is_string($limpos['url_publica'] ?? null);
        if (!$informada && self::pastaDaRequisicao($req) !== null) {
            // aberto por https://dominio/pasta/instalar: o endereço da
            // requisição levaria à pasta, onde o sistema não funciona
            $v->falhar('url_publica', 'endereço público: informe o endereço do subdomínio (o instalador foi aberto por uma pasta)');
        } elseif (!is_array($partes) || !in_array(strtolower((string) ($partes['scheme'] ?? '')), ['http', 'https'], true)
            || empty($partes['host']) || isset($partes['query']) || isset($partes['fragment']) || isset($partes['user'])) {
            $v->falhar('url_publica', 'endereço público: informe algo como https://atendimento.seudominio.com');
        } elseif (($partes['path'] ?? '') !== '' && $partes['path'] !== '/') {
            // o front e as rotas usam caminhos absolutos (/api, /webhooks,
            // /widget.js): o sistema só funciona na raiz de um endereço
            $v->falhar('url_publica', 'endereço público: use só o endereço do subdomínio, sem pasta');
        }
        $exemplos = $v->booleano('exemplos', obrigatorio: false, padrao: false) ?? false;
        $v->validar();

        return [
            'banco_tipo' => $tipo, 'banco_host' => $host, 'banco_porta' => $porta, 'banco_nome' => $nomeBanco,
            'banco_usuario' => $usuario, 'banco_senha' => $senhaBanco,
            'admin_nome' => $nome, 'admin_email' => $email, 'admin_senha' => $senha,
            'url_publica' => $url, 'exemplos' => $exemplos,
        ];
    }

    /** Frase do problema, ou null se a senha serve para um administrador. */
    public static function problemaDaSenha(#[\SensitiveParameter] string $senha, string $email, string $nome): ?string
    {
        if (mb_strlen($senha) < 10) {
            return 'precisa ter pelo menos 10 caracteres';
        }
        if (mb_strlen($senha) > 128) {
            return 'pode ter no máximo 128 caracteres';
        }
        $classes = (int) (preg_match('/[a-z]/', $senha) === 1) + (int) (preg_match('/[A-Z]/', $senha) === 1)
            + (int) (preg_match('/\d/', $senha) === 1) + (int) (preg_match('/[^A-Za-z0-9]/', $senha) === 1);
        if ($classes < 3) {
            return 'misture pelo menos três tipos: minúsculas, maiúsculas, números e símbolos';
        }
        $minuscula = mb_strtolower($senha);
        $local = mb_strtolower((string) strstr($email, '@', true));
        if (in_array($minuscula, self::SENHAS_OBVIAS, true) || count(array_unique(mb_str_split($minuscula))) < 5
            || ($local !== '' && mb_strlen($local) >= 4 && str_contains($minuscula, $local))) {
            return 'fácil de adivinhar; evite repetições e partes do e-mail';
        }
        return null;
    }

    /**
     * Config em duas formas: a do arquivo (caminhos relativos ao config, que
     * viram __DIR__) e a da memória (caminhos absolutos, para testar já).
     *
     * @param array<string, mixed> $pedido
     * @return array{arquivo: array<string, mixed>, memoria: array<string, mixed>, relativas: list<string>}
     */
    private static function valoresDoConfig(array $pedido, string $pasta): array
    {
        $comum = [
            'chave_secreta' => bin2hex(random_bytes(32)),
            'horas_token' => 12,
            'modo_sandbox' => false,
            'url_publica' => $pedido['url_publica'],
            'horas_reabertura' => 24,
            'distribuicao_automatica' => true,
            'tamanho_max_anexo_mb' => 20,
            'timeout_http' => 15.0,
            'origens_permitidas' => ['*'],
        ];
        // no pacote de deploy o front fica em omnichannel2/web, FORA do public
        // (senão /web/painel.html sairia direto, sem os cabeçalhos anti-moldura)
        $pastaDoConfig = dirname(Config::caminhoDoArquivo());
        $comWeb = is_file($pastaDoConfig . '/web/painel.html');
        if ($comWeb) {
            $comum['pasta_web'] = 'web';
        }
        if ($pedido['banco_tipo'] === 'mysql') {
            $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $pedido['banco_host'], $pedido['banco_porta'], $pedido['banco_nome']);
            $banco = ['driver' => 'mysql', 'dsn' => $dsn, 'usuario' => $pedido['banco_usuario'], 'senha' => $pedido['banco_senha']];
            $arquivo = $banco + $comum + ['pasta_dados' => 'dados'];
            $memoria = $banco + $comum + ['pasta_dados' => $pasta];
        } else {
            // SQLite sempre dentro de dados/: nenhum caminho vem do formulário
            $arquivo = ['driver' => 'sqlite', 'dsn' => 'dados/omnichannel.sqlite'] + $comum + ['pasta_dados' => 'dados'];
            $memoria = ['driver' => 'sqlite', 'dsn' => 'sqlite:' . $pasta . '/omnichannel.sqlite'] + $comum + ['pasta_dados' => $pasta];
        }
        $relativas = $pedido['banco_tipo'] === 'sqlite' ? ['pasta_dados', 'dsn'] : ['pasta_dados'];
        if ($comWeb) {
            $memoria['pasta_web'] = $pastaDoConfig . '/web';
            $relativas[] = 'pasta_web';
        }
        return [
            'arquivo' => $arquivo,
            'memoria' => $memoria,
            // viram __DIR__ . '/...' no config.php; o dsn só no SQLite
            'relativas' => $relativas,
        ];
    }

    /** @return array<string, string> */
    private static function valoresPadrao(Requisicao $req): array
    {
        return [
            'banco_tipo' => 'mysql', 'banco_host' => '127.0.0.1', 'banco_porta' => '3306',
            // aberto por uma pasta, o endereço da requisição estaria errado: melhor em branco
            'url_publica' => self::pastaDaRequisicao($req) === null ? self::urlDaRequisicao($req) : '',
        ];
    }

    /**
     * A pasta pela qual o instalador foi aberto (ex.: "/omnichannel2" em
     * https://oprojeto.online/omnichannel2/instalar), ou null se foi pela raiz.
     */
    public static function pastaDaRequisicao(Requisicao $req): ?string
    {
        if (preg_match('#^(.*?)/instalar(?:\.php)?/?$#', $req->caminho, $achado) !== 1 || $achado[1] === '') {
            return null;
        }
        return $achado[1];
    }

    private static function mascarar(string $texto, #[\SensitiveParameter] string $senha): string
    {
        return $senha !== '' ? str_replace($senha, '***', $texto) : $texto;
    }

    /**
     * Log da instalação direto em dados/logs (mesmo arquivo do Log comum).
     * Durante a instalação não há config.php, e o Log comum depende dele; o
     * log de erros do PHP na hospedagem costuma estar desligado.
     */
    private static function registrar(string $mensagem, ?\Throwable $erro = null, #[\SensitiveParameter] string $segredo = ''): void
    {
        $contexto = $erro === null ? [] : [
            'erro' => get_class($erro) . ': ' . $erro->getMessage(),
            'arquivo' => $erro->getFile() . ':' . $erro->getLine(),
            'pilha' => $erro->getTraceAsString(),
        ];
        $linha = sprintf(
            "%s ERRO instalação: %s%s\n",
            gmdate('Y-m-d\TH:i:s\Z'),
            $mensagem,
            $contexto !== [] ? ' ' . json_encode($contexto, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE) : ''
        );
        $linha = self::mascarar($linha, $segredo);
        $pasta = self::pastaDados() . '/logs';
        if (is_dir($pasta) || @mkdir($pasta, 0775, true)) {
            @file_put_contents($pasta . '/omnichannel-' . gmdate('Y-m-d') . '.log', $linha, FILE_APPEND | LOCK_EX);
        }
        error_log('OmniChannel ' . rtrim($linha));
    }

    private static function urlDaRequisicao(Requisicao $req): string
    {
        $host = $req->cabecalho('host') ?? 'localhost';
        return $req->esquema() . '://' . $host;
    }

    private static function eLocal(Requisicao $req): bool
    {
        $host = strtolower((string) preg_replace('/:\d+$/', '', $req->cabecalho('host') ?? ''));
        return in_array($host, ['localhost', '127.0.0.1', '[::1]'], true);
    }

    private static function quereJson(Requisicao $req): bool
    {
        if (str_contains($req->tipoConteudo(), 'json')) {
            return true;
        }
        $aceita = strtolower($req->cabecalho('accept') ?? '');
        return str_contains($aceita, 'application/json') && !str_contains($aceita, 'text/html');
    }

    private static function respostaDeErro(Requisicao $req, ErroHttp $erro, bool $json): Resposta
    {
        $resposta = $json || $erro->status === 404 || $erro->status === 405
            ? Resposta::erro($erro->status, $erro->detalhe)
            : self::paginaComErro($req, $erro);
        foreach ($erro->cabecalhos as $nome => $valor) {
            $resposta->cabecalho($nome, $valor);
        }
        return $resposta;
    }

    /** Formulário de novo, com o que foi digitado (menos senhas e código) e os problemas. */
    private static function paginaComErro(Requisicao $req, ErroHttp $erro): Resposta
    {
        $mensagens = $erro instanceof ErroValidacao
            ? array_map(static fn (array $e): string => (string) $e['msg'], $erro->erros)
            : [is_string($erro->detalhe) ? $erro->detalhe : 'dados inválidos'];
        $valores = self::valoresPadrao($req);
        foreach (['banco_tipo', 'banco_host', 'banco_porta', 'banco_nome', 'banco_usuario', 'admin_nome', 'admin_email', 'url_publica', 'exemplos'] as $campo) {
            $valor = $req->formulario[$campo] ?? null;
            if (is_string($valor)) {
                $valores[$campo] = $valor;
            }
        }
        $html = PaginaInstalador::formulario(
            $valores,
            $mensagens,
            (new CodigoDeInstalacao(self::pastaDados()))->existe(),
            $req->esquema() === 'https' || self::eLocal($req),
            self::pastaDaRequisicao($req),
        );
        return Resposta::texto($html, $erro->status, 'text/html; charset=utf-8');
    }

    /** Cabeçalhos de toda resposta do instalador. */
    private static function protegida(Resposta $resposta): Resposta
    {
        $resposta->cabecalho('X-Content-Type-Options', 'nosniff');
        $resposta->cabecalho('Referrer-Policy', 'no-referrer');
        $resposta->cabecalho('Cache-Control', 'no-store');
        $resposta->cabecalho('X-Frame-Options', 'DENY');
        $resposta->cabecalho(
            'Content-Security-Policy',
            "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
        );
        $resposta->cabecalho('X-Robots-Tag', 'noindex, nofollow');
        return $resposta;
    }
}

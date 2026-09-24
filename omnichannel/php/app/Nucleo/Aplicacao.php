<?php
declare(strict_types=1);

namespace OmniChannel\Nucleo;

use OmniChannel\Banco\Banco;
use OmniChannel\Banco\Esquema;

/**
 * O que o front controller (public/index.php) faz a cada requisição:
 *
 *  1. preflight CORS do widget;
 *  2. front estático (/painel, /static/..., /widget.js);
 *  3. garante o esquema do banco e despacha para a rota;
 *  4. converte erros no formato do FastAPI ({"detail": ...});
 *  5. aplica os cabeçalhos de segurança e envia.
 *
 * Rotas são descobertas sozinhas: toda classe em app/Api/*.php e todo
 * app/<Modulo>/Rotas.php com `public static function registrar(Roteador $r)`
 * entra no roteador. Nenhum arquivo central para editar ao criar rota nova.
 */
final class Aplicacao
{
    private static ?Roteador $roteador = null;

    /** Ponto de entrada do front controller. */
    public static function executar(): void
    {
        ini_set('display_errors', '0');
        set_error_handler([self::class, 'tratarAviso']);
        ob_start();

        $req = Requisicao::doAmbiente();
        $resposta = self::atender($req);

        $sobra = (string) ob_get_clean();
        if ($sobra !== '') {
            // saída perdida (echo esquecido, aviso) corromperia o JSON
            Log::aviso('saída inesperada descartada', ['caminho' => $req->caminho, 'inicio' => mb_substr($sobra, 0, 200)]);
        }
        $resposta->enviar($req->metodo === 'HEAD');
    }

    /** Atende uma requisição já montada (usado também pelos testes de unidade). */
    public static function atender(Requisicao $req): Resposta
    {
        try {
            $resposta = self::despachar($req);
        } catch (ErroHttp $erro) {
            Banco::desfazerPendente();
            $resposta = Resposta::erro($erro->status, $erro->detalhe);
            foreach ($erro->cabecalhos as $nome => $valor) {
                $resposta->cabecalho($nome, $valor);
            }
        } catch (ErroConfiguracao $erro) {
            // o motivo vai para o log; ao visitante, só que não está pronto
            Log::erro('configuração recusada: ' . $erro->getMessage());
            $resposta = Resposta::erro(503, 'servidor não configurado; veja o log de instalação');
        } catch (\PDOException $erro) {
            Banco::desfazerPendente();
            Log::excecao($erro, "banco em {$req->metodo} {$req->caminho}");
            $resposta = Resposta::erro(500, 'erro interno do servidor');
        } catch (\Throwable $erro) {
            Banco::desfazerPendente();
            Log::excecao($erro, "{$req->metodo} {$req->caminho}");
            $resposta = Resposta::erro(500, 'erro interno do servidor');
        }
        self::cabecalhosPadrao($req, $resposta);
        return $resposta;
    }

    private static function despachar(Requisicao $req): Resposta
    {
        if (Cors::aplica($req->caminho) && Cors::ePreflight($req)) {
            return Cors::preflight($req);
        }
        $config = Config::obter();
        if (self::corpoAcimaDoLimiteDoPhp($req)) {
            // o PHP descartou o corpo inteiro ($_POST e $_FILES vazios): sem
            // isto a rota veria "campo ausente" em vez de "grande demais"
            throw ErroHttp::grandeDemais(str_starts_with($req->tipoConteudo(), 'multipart/')
                ? "arquivo maior que o limite de {$config->tamanho_max_anexo_mb} MB"
                : 'requisição grande demais');
        }
        if (Estaticos::eDoFront($req->caminho)) {
            return Estaticos::atender($req);
        }
        if ($req->caminho !== '/saude') {
            try {
                Esquema::garantir();
            } catch (\PDOException $erro) {
                Log::excecao($erro, 'conexão/esquema do banco');
                throw ErroHttp::indisponivel('banco de dados indisponível');
            }
        }
        return self::roteador()->despachar($req);
    }

    private static function corpoAcimaDoLimiteDoPhp(Requisicao $req): bool
    {
        $tamanho = (int) ($req->cabecalho('content-length') ?? 0);
        $limite = self::bytesDoIni((string) ini_get('post_max_size'));
        return $limite > 0 && $tamanho > $limite;
    }

    /** "8M" -> 8388608 (formato das diretivas do php.ini). */
    public static function bytesDoIni(string $valor): int
    {
        $valor = trim($valor);
        if ($valor === '') {
            return 0;
        }
        $numero = (int) $valor;
        return match (strtolower(substr($valor, -1))) {
            'g' => $numero * 1024 ** 3,
            'm' => $numero * 1024 ** 2,
            'k' => $numero * 1024,
            default => $numero,
        };
    }

    /** O roteador com todas as rotas descobertas (montado uma vez por processo). */
    public static function roteador(): Roteador
    {
        if (self::$roteador !== null) {
            return self::$roteador;
        }
        $r = new Roteador();
        $r->get('/saude', [self::class, 'saude']);
        foreach (self::modulosDeRotas() as $classe) {
            $classe::registrar($r);
        }
        return self::$roteador = $r;
    }

    /** Permite recriar o roteador (testes de unidade). */
    public static function reiniciar(): void
    {
        self::$roteador = null;
    }

    /** @return list<class-string> */
    public static function modulosDeRotas(): array
    {
        $raiz = dirname(__DIR__);
        $classes = [];
        foreach (glob($raiz . '/Api/*.php') ?: [] as $arquivo) {
            $classes[] = 'OmniChannel\\Api\\' . basename($arquivo, '.php');
        }
        foreach (glob($raiz . '/*/Rotas.php') ?: [] as $arquivo) {
            $classes[] = 'OmniChannel\\' . basename(dirname($arquivo)) . '\\Rotas';
        }
        sort($classes, SORT_STRING);
        return array_values(array_filter(
            $classes,
            static fn (string $c): bool => class_exists($c) && method_exists($c, 'registrar')
        ));
    }

    /**
     * GET /saude — o Python responde {"eventos": "stream"}; aqui é
     * "consulta": é assim que o front escolhe EventSource ou consulta a cada 2 s.
     *
     * @return array<string, string>
     */
    public static function saude(): array
    {
        $config = Config::obter();
        return [
            'status' => 'ok',
            'aplicacao' => $config->nome_aplicacao,
            'versao' => $config->versao,
            'eventos' => 'consulta',
        ];
    }

    private static function cabecalhosPadrao(Requisicao $req, Resposta $resposta): void
    {
        $resposta->cabecalho('X-Content-Type-Options', 'nosniff');
        if (!$resposta->temCabecalho('Referrer-Policy')) {
            $resposta->cabecalho('Referrer-Policy', 'same-origin');
        }
        if (str_starts_with($req->caminho, '/api/') && !$resposta->temCabecalho('Cache-Control')) {
            // dados de atendimento e tokens não ficam em cache de proxy nem do navegador
            $resposta->cabecalho('Cache-Control', 'no-store');
        }
        if (Cors::aplica($req->caminho)) {
            Cors::decorar($req, $resposta);
        }
    }

    /** Avisos do PHP vão para o log; nunca para a resposta. */
    public static function tratarAviso(int $nivel, string $mensagem, string $arquivo = '', int $linha = 0): bool
    {
        if ((error_reporting() & $nivel) === 0) {
            return true; // suprimido com @
        }
        Log::aviso("PHP: {$mensagem}", ['arquivo' => "{$arquivo}:{$linha}", 'nivel' => $nivel]);
        return true;
    }
}

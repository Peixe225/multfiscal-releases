<?php
declare(strict_types=1);

namespace IHchat\Canais;

use IHchat\Nucleo\ErroHttp;

/**
 * Regras de gravação das credenciais de um canal (app/api/canais.py).
 *
 *  - segredo em branco ou ausente = MANTER: a tela nunca recebe o valor de
 *    volta, então não teria como reenviá-lo, e um formulário salvo sem mexer
 *    no token não pode desligar o canal. Apagar um segredo é pedido explícito
 *    (`limpar`);
 *  - campo comum em branco = limpar (senão não haveria como tirar um IMAP);
 *  - texto chega aparado (token colado com espaço ou quebra de linha);
 *  - porta é validada ao salvar ("porta 587" só estouraria no envio);
 *  - senha guardada só segue para um servidor novo se quem o mudou a digitar
 *    de novo (a mesma regra de Grafana e Jenkins).
 */
final class Credenciais
{
    /**
     * @param array<string, mixed> $atuais
     * @param array<string, mixed> $enviadas
     * @param list<string> $limpar
     * @return array<string, mixed>
     * @throws ErroHttp 422 com a frase para a tela
     */
    public static function mesclar(string $tipo, array $atuais, array $enviadas, array $limpar = []): array
    {
        $resultado = [];
        foreach ($atuais as $chave => $valor) {
            if (!in_array((string) $chave, $limpar, true)) {
                $resultado[$chave] = $valor;
            }
        }
        foreach ($enviadas as $chave => $valor) {
            $chave = (string) $chave;
            $valor = self::normalizar($tipo, $chave, $valor);
            $vazio = $valor === null || $valor === '';
            if (Campos::eSecreta($tipo, $chave)) {
                if (!$vazio) {
                    $resultado[$chave] = $valor;
                }
            } elseif ($vazio) {
                unset($resultado[$chave]);
            } else {
                $resultado[$chave] = $valor;
            }
        }
        self::exigirSenhaParaServidorNovo($tipo, $atuais, $resultado, $enviadas);
        if ($tipo === Campos::WHATSAPP_QR) {
            // outra instância: o webhook, o estado e o número gravados eram da antiga
            $resultado = AdaptadorWhatsAppQr::semDadosDeOutraInstancia($atuais, $resultado);
        }
        return $resultado;
    }

    private static function normalizar(string $tipo, string $chave, mixed $valor): mixed
    {
        if (is_string($valor)) {
            $valor = trim($valor);
        }
        if ($tipo === Campos::WHATSAPP_QR && $valor !== null && $valor !== '') {
            return self::normalizarWhatsAppQr($tipo, $chave, $valor);
        }
        if ($valor === null || $valor === '' || !str_ends_with($chave, '_porta')) {
            return $valor;
        }
        $texto = self::comoTexto($valor);
        $porta = preg_match('/^\s*[+-]?\d{1,6}\s*$/', $texto) === 1 ? (int) $texto : 0;
        if ($porta < 1 || $porta > 65535) {
            $campo = Campos::campoDe($tipo, $chave);
            $exemplo = ($campo !== null && $campo['padrao'] !== '') ? " (ex.: {$campo['padrao']})" : '';
            throw ErroHttp::invalido(Campos::rotulo($tipo, $chave) . " precisa ser um número de 1 a 65535{$exemplo}");
        }
        return (string) $porta;
    }

    /**
     * Provedor e endereço da Evolution conferidos ao salvar, com a frase na
     * tela, em vez de só estourar no primeiro QR Code (canais.py do Python).
     */
    private static function normalizarWhatsAppQr(string $tipo, string $chave, mixed $valor): mixed
    {
        if ($chave === 'provedor') {
            $provedor = strtolower(self::comoTexto($valor));
            if (!in_array($provedor, AdaptadorWhatsAppQr::PROVEDORES, true)) {
                throw ErroHttp::invalido(Campos::rotulo($tipo, $chave) . ' precisa ser zapi ou evolution');
            }
            return $provedor;
        }
        if ($chave === 'url_servidor') {
            $endereco = rtrim(self::comoTexto($valor), '/');
            $problema = AdaptadorWhatsAppQr::problemaNoEnderecoEvolution($endereco);
            if ($problema !== null) {
                throw ErroHttp::invalido(Campos::rotulo($tipo, $chave) . ' ' . $problema);
            }
            return $endereco;
        }
        return $valor;
    }

    /**
     * @param array<string, mixed> $atuais
     * @param array<string, mixed> $resultado
     * @param array<string, mixed> $enviadas
     */
    private static function exigirSenhaParaServidorNovo(string $tipo, array $atuais, array $resultado, array $enviadas): void
    {
        foreach (Campos::DESTINOS_DOS_SEGREDOS[$tipo] ?? [] as [$segredos, $destinos]) {
            $mudaram = [];
            foreach ($destinos as $destino) {
                if (self::verdadeiro($resultado[$destino] ?? null)
                    && self::comoTexto($resultado[$destino]) !== self::comoTexto(self::verdadeiro($atuais[$destino] ?? null) ? $atuais[$destino] : '')) {
                    $mudaram[] = $destino;
                }
            }
            $usada = null;
            foreach ($segredos as $segredo) {
                if (self::verdadeiro($resultado[$segredo] ?? null)) {
                    $usada = $segredo;
                    break;
                }
            }
            if ($mudaram === [] || $usada === null) {
                continue;
            }
            $digitada = $enviadas[$usada] ?? null;
            if (is_string($digitada) && trim($digitada) !== '') {
                continue;
            }
            $rotulos = implode(', ', array_map(static fn (string $d): string => Campos::rotulo($tipo, $d), $mudaram));
            throw ErroHttp::invalido(
                "ao trocar {$rotulos}, digite de novo a " . Campos::rotulo($tipo, $segredos[0])
                . ': a senha guardada só vai para outro servidor se você a confirmar'
            );
        }
    }

    /** Verdade no sentido do Python ("0" é verdadeiro; "", 0, null e [] não). */
    private static function verdadeiro(mixed $valor): bool
    {
        return !($valor === null || $valor === '' || $valor === false || $valor === 0 || $valor === 0.0 || $valor === []);
    }

    private static function comoTexto(mixed $valor): string
    {
        if (is_bool($valor)) {
            return $valor ? 'True' : 'False';
        }
        if (is_scalar($valor)) {
            return (string) $valor;
        }
        return json_encode($valor) ?: '';
    }
}

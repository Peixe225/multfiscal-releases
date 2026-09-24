<?php
declare(strict_types=1);

namespace IHchat\Atendimento;

/**
 * Ponte para um adaptador da frente de canais que não implemente
 * AdaptadorDeCanal diretamente: procura os métodos pelos nomes em português
 * (camelCase ou snake_case, como no Python) e converte o resultado.
 *
 * Existe para que as duas frentes, escritas em paralelo, se encaixem sem que
 * uma precise esperar a outra; o ideal é o adaptador implementar a interface.
 */
final class AdaptadorExterno implements AdaptadorDeCanal
{
    /** @param array<string, mixed> $canal */
    public function __construct(private readonly object $alvo, private readonly array $canal)
    {
    }

    public function tipo(): string
    {
        $tipo = $this->ler(['tipo'], null);
        if ($tipo instanceof \BackedEnum) {
            $tipo = $tipo->value;
        }
        return is_string($tipo) && $tipo !== '' ? $tipo : (string) ($this->canal['tipo'] ?? '');
    }

    public function configurado(): bool
    {
        return (bool) $this->ler(['configurado', 'estaConfigurado'], false);
    }

    public function enviaArquivos(): bool
    {
        return (bool) $this->ler(['enviaArquivos', 'envia_arquivos'], false);
    }

    public function enviar(string $destino, string $conteudo, array $contexto): ResultadoEnvio
    {
        $resultado = $this->alvo->enviar($destino, $conteudo, $contexto);
        if (!is_array($resultado) && !is_object($resultado)) {
            return ResultadoEnvio::falhou('resposta inesperada do adaptador do canal');
        }
        return ResultadoEnvio::de($resultado);
    }

    public function baixarAnexo(AnexoRecebido $anexo): string
    {
        foreach (['baixarAnexo', 'baixar_anexo'] as $metodo) {
            if (method_exists($this->alvo, $metodo)) {
                return (string) $this->alvo->{$metodo}($anexo);
            }
        }
        if ($anexo->dados !== null) {
            return $anexo->dados;
        }
        throw new \RuntimeException("o canal {$this->tipo()} nao sabe baixar anexos");
    }

    /** Valor de um método sem argumentos ou de uma propriedade pública. @param list<string> $nomes */
    private function ler(array $nomes, mixed $padrao): mixed
    {
        foreach ($nomes as $nome) {
            if (method_exists($this->alvo, $nome)) {
                return $this->alvo->{$nome}();
            }
            if (property_exists($this->alvo, $nome)) {
                return $this->alvo->{$nome};
            }
        }
        return $padrao;
    }
}

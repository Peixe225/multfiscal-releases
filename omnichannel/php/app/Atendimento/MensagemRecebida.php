<?php
declare(strict_types=1);

namespace OmniChannel\Atendimento;

/**
 * Uma mensagem que chegou do contato, já traduzida do formato do provedor
 * (o MensagemRecebida de app/canais/base.py).
 *
 * Quem produz: os adaptadores de canal (analisar o webhook, coletar IMAP,
 * getUpdates), o widget e o simulador. Quem consome: Mensagens::registrarEntrada().
 *
 * `externo_id` já vem PREFIXADO pelo canal ("whatsapp:wamid.XX"): é o que
 * torna idempotente a reentrega de um webhook.
 */
final class MensagemRecebida
{
    /**
     * @param array<string, mixed> $metadados
     * @param list<AnexoRecebido> $anexos
     */
    public function __construct(
        public readonly string $identificador,
        public readonly string $conteudo,
        public readonly ?string $nome_exibicao = null,
        public readonly ?string $externo_id = null,
        public readonly ?string $assunto = null,
        public readonly array $metadados = [],
        public readonly array $anexos = [],
    ) {
    }

    /**
     * Aceita também um array com as mesmas chaves (ou um objeto com as mesmas
     * propriedades públicas), para quem monta a mensagem sem esta classe.
     *
     * @param self|array<string, mixed>|object $valor
     */
    public static function de(array|object $valor): self
    {
        if ($valor instanceof self) {
            return $valor;
        }
        $d = is_array($valor) ? $valor : get_object_vars($valor);
        $pegar = static fn (string ...$nomes): mixed => array_reduce(
            $nomes,
            static fn (mixed $achado, string $n): mixed => $achado ?? ($d[$n] ?? null),
            null
        );
        $anexos = [];
        foreach ((array) ($pegar('anexos') ?? []) as $anexo) {
            $anexos[] = AnexoRecebido::de($anexo);
        }
        $texto = static fn (mixed $v): ?string => $v === null || $v === '' ? null : (string) $v;
        return new self(
            identificador: (string) $pegar('identificador'),
            conteudo: (string) ($pegar('conteudo') ?? ''),
            nome_exibicao: $texto($pegar('nome_exibicao', 'nomeExibicao')),
            externo_id: $texto($pegar('externo_id', 'externoId')),
            assunto: $texto($pegar('assunto')),
            metadados: (array) ($pegar('metadados') ?? []),
            anexos: $anexos,
        );
    }
}

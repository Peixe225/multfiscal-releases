<?php
declare(strict_types=1);

namespace IHchat\Atendimento;

/**
 * O que o núcleo do atendimento precisa de um canal (WhatsApp, Telegram,
 * e-mail, webchat). É o recorte de AdaptadorCanal (app/canais/base.py) que
 * as conversas usam; webhook, coleta e teste de conexão ficam com a frente de
 * canais e não passam por aqui.
 *
 * Como o núcleo encontra o adaptador: Adaptadores::para($canal) chama
 * `IHchat\Canais\Registro::adaptadorPara(array $canal)` quando essa
 * classe existe; senão usa AdaptadorSandbox (sem provedor: "simulada" no
 * sandbox, "falhou" fora dele). $canal é a linha da tabela `canais` com
 * `credenciais` já decodificado em array.
 *
 * Regras que o núcleo já aplica, para o adaptador não repetir:
 *  - enviar() só é chamado com configurado() verdadeiro (sem credencial, o
 *    núcleo grava "simulada" no sandbox ou "falhou" fora dele);
 *  - o texto chega JÁ ASSINADO no formato do canal (Assinaturas::aplicar);
 *    a assinatura crua vai em $contexto['assinatura'] para quem quiser
 *    montar algo mais rico (HTML no e-mail);
 *  - exceção em enviar() vira "falhou": a mensagem de ErroCanal/ErroTransporte
 *    vai para o atendente; qualquer outra vira frase genérica e vai para o log.
 */
interface AdaptadorDeCanal
{
    /** 'whatsapp' | 'telegram' | 'email' | 'webchat' */
    public function tipo(): string;

    /** Credenciais suficientes para ENVIAR. */
    public function configurado(): bool;

    /** Se falso, resposta com arquivo é recusada antes de gravar qualquer coisa. */
    public function enviaArquivos(): bool;

    /**
     * Entrega ao provedor.
     *
     * @param array{assunto: ?string, referencia: ?string, arquivos: list<ArquivoParaEnviar>, assinatura: ?array{nome: string, setor: ?string}} $contexto
     */
    public function enviar(string $destino, string $conteudo, array $contexto): ResultadoEnvio;

    /**
     * Bytes de um arquivo anunciado no webhook. Lança exceção se não der
     * (o anexo fica registrado com o erro; a mensagem não se perde).
     */
    public function baixarAnexo(AnexoRecebido $anexo): string;
}

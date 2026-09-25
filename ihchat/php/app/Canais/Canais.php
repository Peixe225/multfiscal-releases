<?php
declare(strict_types=1);

namespace IHchat\Canais;

use IHchat\Banco\Banco;
use IHchat\Canais\WhatsAppQr\EstadoConexao;
use IHchat\Nucleo\Config;
use IHchat\Nucleo\Json;

/**
 * Leitura de canais e o formato CanalSaida (app/serializacao.py:canal_saida).
 *
 * `tipar()` decodifica as credenciais e converte os tipos (MySQL e SQLite
 * devolvem inteiros e booleanos de jeitos diferentes). As credenciais NUNCA
 * saem daqui para o navegador: CanalSaida não as tem, e /credenciais filtra
 * os segredos (Rotas::verCredenciais).
 */
final class Canais
{
    /** @return array<string, mixed>|null */
    public static function porId(int $id): ?array
    {
        $linha = Banco::um('SELECT * FROM canais WHERE id = ?', [$id]);
        return $linha === null ? null : self::tipar($linha);
    }

    /** @return list<array<string, mixed>> */
    public static function todos(bool $soAtivos = false): array
    {
        $sql = 'SELECT * FROM canais' . ($soAtivos ? ' WHERE ativo = 1' : '') . ' ORDER BY ' . ($soAtivos ? 'id' : 'nome, id');
        return array_map([self::class, 'tipar'], Banco::todos($sql));
    }

    /**
     * @param array<string, mixed> $linha
     * @return array<string, mixed>
     */
    public static function tipar(array $linha): array
    {
        $linha['id'] = (int) $linha['id'];
        $linha['ativo'] = (bool) $linha['ativo'];
        $credenciais = is_array($linha['credenciais'] ?? null)
            ? $linha['credenciais']
            : Json::ler(isset($linha['credenciais']) ? (string) $linha['credenciais'] : null, []);
        $linha['credenciais'] = is_array($credenciais) ? $credenciais : [];
        foreach (['chave_publica', 'segredo_webhook'] as $coluna) {
            $linha[$coluna] = isset($linha[$coluna]) && $linha[$coluna] !== '' ? (string) $linha[$coluna] : null;
        }
        return $linha;
    }

    /**
     * CanalSaida: {id, nome, tipo, ativo, chave_publica, configurado, url_webhook, conexao, setor_padrao_id}.
     *
     * url_webhook é absoluta quando a instalação conhece o próprio endereço
     * (url_publica): é o que o admin cola na Meta ou vê no setWebhook.
     *
     * @param array<string, mixed> $canal
     * @return array<string, mixed>
     */
    public static function saida(array $canal): array
    {
        $canal = self::tipar($canal);
        try {
            $configurado = Registro::adaptadorPara($canal)->configurado();
        } catch (CanalNaoSuportado) {
            $configurado = false;
        }
        return [
            'id' => $canal['id'],
            'nome' => (string) $canal['nome'],
            'tipo' => (string) $canal['tipo'],
            'ativo' => $canal['ativo'],
            'chave_publica' => $canal['chave_publica'],
            'configurado' => $configurado,
            'url_webhook' => self::urlWebhook($canal['id']),
            'conexao' => self::conexao($canal),
            // conversa nova deste canal entra na fila deste setor (null: fila geral)
            'setor_padrao_id' => isset($canal['setor_padrao_id']) && $canal['setor_padrao_id'] !== null
                ? (int) $canal['setor_padrao_id']
                : null,
        ];
    }

    /**
     * Só no WhatsApp pelo QR Code: "conectado", "aguardando_leitura" ou
     * "desconectado", o último estado que o servidor viu (webhook, /qr ou
     * testar); null nos outros tipos e antes da primeira conferência. Não é
     * segredo: é o que deixa a equipe ver que o celular caiu. Igual a
     * conexao_do_canal do Python.
     *
     * @param array<string, mixed> $canal já tipado
     */
    public static function conexao(array $canal): ?string
    {
        if (($canal['tipo'] ?? null) !== 'whatsapp_qr') {
            return null;
        }
        $estado = $canal['credenciais'][AdaptadorWhatsAppQr::CHAVE_ESTADO] ?? null;
        $validos = [EstadoConexao::CONECTADO, EstadoConexao::AGUARDANDO, EstadoConexao::DESCONECTADO];
        return in_array($estado, $validos, true) ? $estado : null;
    }

    /** "/webhooks/5", ou "https://atendimento.../webhooks/5" com url_publica configurada. */
    public static function urlWebhook(int $canalId): string
    {
        return self::urlPublica() . '/webhooks/' . $canalId;
    }

    /** Endereço público sem barra final ('' quando não configurado). */
    public static function urlPublica(): string
    {
        try {
            return Config::obter()->url_publica;
        } catch (\Throwable) {
            return '';
        }
    }
}

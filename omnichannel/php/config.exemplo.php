<?php
/**
 * Modelo de configuração. Copie para php/config.php (FORA do public/) e ajuste.
 * O instalador gera esse arquivo sozinho; ele nunca vai para o git.
 *
 * A variável de ambiente OMNI_CONFIG pode apontar outro arquivo (a suíte de
 * contrato e o servidor de desenvolvimento usam isso).
 */
return [
    // --- banco -----------------------------------------------------------
    // Produção (Hostinger): MySQL/MariaDB no mesmo servidor -> host localhost.
    'driver' => 'mysql',
    'dsn' => 'mysql:host=localhost;dbname=u000000000_omni;charset=utf8mb4',
    'usuario' => 'u000000000_omni',
    'senha' => 'defina-uma-senha-forte',
    // Desenvolvimento: SQLite num arquivo.
    // 'driver' => 'sqlite',
    // 'dsn' => 'sqlite:' . __DIR__ . '/dados/omnichannel.sqlite',

    // --- segurança -------------------------------------------------------
    // Assina os tokens dos atendentes. Mínimo de 32 caracteres fora do sandbox;
    // gere com: php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
    // Ao migrar o banco para a VPS (app Python), use lá a MESMA chave
    // (OMNI_CHAVE_SECRETA): os atendentes continuam logados.
    'chave_secreta' => 'troque-esta-chave-em-producao',
    'horas_token' => 12,

    // --- comportamento ---------------------------------------------------
    // true: canal sem credencial "envia" só registrando (status "simulada").
    'modo_sandbox' => false,
    'url_publica' => 'https://atendimento.oprojeto.online',
    // janela em que nova mensagem reabre a conversa resolvida em vez de abrir outra
    'horas_reabertura' => 24,
    'distribuicao_automatica' => true,
    'tamanho_max_anexo_mb' => 20,
    'timeout_http' => 15.0,
    // sites que podem embutir o widget; ['*'] libera qualquer um
    'origens_permitidas' => ['*'],

    // --- pastas ----------------------------------------------------------
    // anexos, logs e travas; precisa ser gravável e ficar fora do public/
    'pasta_dados' => __DIR__ . '/dados',
    // front (painel, widget). Padrão: web/ ao lado deste arquivo (o pacote),
    // senão public/web, senão ../app/web (desenvolvimento, a fonte única)
    // 'pasta_web' => __DIR__ . '/web',
];

<?php
declare(strict_types=1);

namespace OmniChannel\Instalacao;

/**
 * HTML do instalador: formulário e tela de conclusão.
 *
 * Página sem JavaScript (a CSP do instalador nem permite script) e com todo
 * valor escapado por h(): o que o visitante digitou volta na tela só como
 * texto. Senha e código de instalação nunca voltam.
 */
final class PaginaInstalador
{
    /**
     * @param array<string, string> $valores campos a preencher de novo
     * @param list<string> $erros
     * @param ?string $pasta pasta pela qual o instalador foi aberto (null = raiz)
     */
    public static function formulario(array $valores, array $erros, bool $temCodigo, bool $conexaoSegura, ?string $pasta = null): string
    {
        $v = static fn (string $campo, string $padrao = ''): string => self::h($valores[$campo] ?? $padrao);
        $avisos = '';
        if ($pasta !== null) {
            $avisos .= '<p class="alerta">Você abriu o instalador por uma pasta (<code>' . self::h($pasta) . '</code>). '
                . 'O sistema só funciona na raiz de um endereço: crie o subdomínio (ex.: <b>atendimento</b>) '
                . 'apontando para <code>public_html/omnichannel2/public</code> e informe abaixo o endereço dele, '
                . 'sem pasta (ex.: <code>https://atendimento.oprojeto.online</code>). O melhor é instalar já por ele.</p>';
        }
        if (!$conexaoSegura) {
            $avisos .= '<p class="alerta">Você está em <b>http</b> sem cadeado: a senha iria sem criptografia. '
                . 'Ative o SSL do subdomínio no hPanel e abra este endereço com <b>https://</b>.</p>';
        }
        if (!$temCodigo) {
            $avisos .= '<p class="alerta">Falta o <b>código de instalação</b>. Crie o arquivo '
                . '<code>omnichannel2/dados/instalacao.codigo</code> no Gerenciador de Arquivos, com um texto '
                . 'aleatório de pelo menos ' . CodigoDeInstalacao::TAMANHO_MINIMO . ' caracteres (ou rode '
                . '<code>implantar_hostinger.py --criar-codigo</code>), e digite o mesmo texto abaixo.</p>';
        }
        $listaErros = '';
        if ($erros !== []) {
            $itens = implode('', array_map(static fn (string $e): string => '<li>' . self::h($e) . '</li>', $erros));
            $listaErros = '<div class="erro" role="alert"><b>Não deu para instalar:</b><ul>' . $itens . '</ul></div>';
        }
        $tipo = $valores['banco_tipo'] ?? 'mysql';
        $selecionado = static fn (string $opcao): string => $tipo === $opcao ? ' selected' : '';
        $exemplos = in_array(strtolower($valores['exemplos'] ?? ''), ['1', 'on', 'true', 'sim'], true) ? ' checked' : '';

        $corpo = <<<HTML
            <h1>Instalar o OmniChannel 2</h1>
            <p class="sub">Uma vez só: depois de instalado, este endereço deixa de existir.</p>
            {$avisos}{$listaErros}
            <form method="post" action="" autocomplete="off">
              <fieldset>
                <legend>Código de instalação</legend>
                <label>Código (o texto de <code>dados/instalacao.codigo</code>)
                  <input name="codigo" type="password" required minlength="16" autocomplete="off"></label>
              </fieldset>
              <fieldset>
                <legend>Banco de dados</legend>
                <p class="dica">No hPanel: Bancos de dados → Gerenciamento. Crie o banco e o usuário e copie os nomes
                  completos (com o prefixo <code>u123456789_</code>).</p>
                <label>Tipo
                  <select name="banco_tipo">
                    <option value="mysql"{$selecionado('mysql')}>MySQL / MariaDB (recomendado)</option>
                    <option value="sqlite"{$selecionado('sqlite')}>SQLite (arquivo em dados/, só para testes)</option>
                  </select></label>
                <div class="linha">
                  <label>Servidor <input name="banco_host" value="{$v('banco_host', '127.0.0.1')}"></label>
                  <label class="curto">Porta <input name="banco_porta" inputmode="numeric" value="{$v('banco_porta', '3306')}"></label>
                </div>
                <label>Nome do banco <input name="banco_nome" value="{$v('banco_nome')}" placeholder="u123456789_omni"></label>
                <label>Usuário do banco <input name="banco_usuario" value="{$v('banco_usuario')}" placeholder="u123456789_omni"></label>
                <label>Senha do banco <input name="banco_senha" type="password" autocomplete="off"></label>
              </fieldset>
              <fieldset>
                <legend>Administrador</legend>
                <label>Nome <input name="admin_nome" required minlength="2" maxlength="120" value="{$v('admin_nome')}"></label>
                <label>E-mail (é o login) <input name="admin_email" type="email" required value="{$v('admin_email')}"></label>
                <label>Senha <input name="admin_senha" type="password" required minlength="10" autocomplete="new-password"></label>
                <label>Repita a senha <input name="admin_senha_confirmacao" type="password" required minlength="10" autocomplete="new-password"></label>
                <p class="dica">Pelo menos 10 caracteres, misturando três tipos entre minúsculas, maiúsculas, números e símbolos.</p>
              </fieldset>
              <fieldset>
                <legend>Endereço</legend>
                <label>Endereço público <input name="url_publica" value="{$v('url_publica')}" placeholder="https://atendimento.oprojeto.online"></label>
                <p class="dica">É o endereço que vai nas URLs de webhook do WhatsApp e do Telegram e no código do widget.
                  Só o endereço do subdomínio, sem pasta no fim.</p>
                <label class="caixa"><input type="checkbox" name="exemplos" value="1"{$exemplos}>
                  Carregar exemplos (atendente Ana, canais, etiquetas e conversas fictícias) — só para conhecer o sistema</label>
              </fieldset>
              <button type="submit">Instalar</button>
            </form>
            HTML;
        return self::pagina('Instalar o OmniChannel 2', $corpo);
    }

    /** @param array<string, mixed> $r resultado da instalação */
    public static function concluida(array $r): string
    {
        $painel = self::h((string) $r['url_painel']);
        $email = self::h((string) $r['admin']['email']);
        $webhooks = self::h(preg_replace('#/painel$#', '', (string) $r['url_painel']) . '/webhooks/');
        $widget = '';
        if (!empty($r['chave_webchat'])) {
            $trecho = '<script src="' . $r['url_widget'] . '"' . "\n        data-chave=\"" . $r['chave_webchat'] . "\"\n"
                . "        data-titulo=\"Suporte\"></script>";
            $widget = '<h2>Chat no seu site</h2><p>Cole antes de <code>&lt;/body&gt;</code> nas páginas do site:</p><pre>'
                . self::h($trecho) . '</pre>';
        }
        $aviso = '';
        if (!empty($r['exemplos'])) {
            $aviso = '<p class="alerta">Os exemplos criaram a atendente <b>ana@multfiscal.com.br</b> <b>desativada</b> '
                . 'e com uma senha aleatória: a senha de demonstração (ana12345, que é pública) não entra aqui. '
                . 'As conversas de exemplo ficam atribuídas a ela. Para usar a Ana, o administrador a reativa e '
                . 'define uma senha (<code>PATCH /api/atendentes/&lt;id&gt;</code> com <code>{"ativo": true, "senha": "..."}</code>).</p>';
        }
        $corpo = <<<HTML
            <h1>Instalação concluída</h1>
            <p class="ok">O OmniChannel 2 está no ar. Entre no painel com <b>{$email}</b> e a senha que você escolheu.</p>
            {$aviso}
            <p><a class="botao" href="{$painel}">Abrir o painel</a></p>
            <h2>Próximos passos</h2>
            <ol>
              <li>hPanel → Avançado → Cron Jobs: a cada minuto, <code>/usr/bin/php …/omnichannel2/cron.php</code>
                (coleta e-mails e mensagens do Telegram, limpa a fila de eventos).</li>
              <li>No painel, Canais: cadastre as credenciais do WhatsApp e do Telegram. As URLs de webhook
                começam com <code>{$webhooks}</code> e aparecem prontas na tela de cada canal.</li>
              <li>Cada atendente escolhe o seu setor em Perfil, no topo do painel: é o que o cliente vê ao ser atendido.</li>
            </ol>
            {$widget}
            <p class="dica">Este endereço de instalação não existe mais, e o código de instalação foi apagado.</p>
            HTML;
        return self::pagina('OmniChannel 2 instalado', $corpo);
    }

    private static function pagina(string $titulo, string $corpo): string
    {
        $titulo = self::h($titulo);
        return <<<HTML
            <!doctype html>
            <html lang="pt-BR">
            <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta name="robots" content="noindex, nofollow">
            <title>{$titulo}</title>
            <style>
              :root { color-scheme: light dark; --fundo: #f5f6fa; --cartao: #fff; --texto: #1c2233; --suave: #5b6478;
                      --borda: #d8dce6; --acento: #2c5cf6; --erro: #b42318; --erro-fundo: #fef3f2; --alerta-fundo: #fff8e6; }
              @media (prefers-color-scheme: dark) {
                :root { --fundo: #11141b; --cartao: #1a1f2b; --texto: #e7eaf1; --suave: #9aa3b5; --borda: #2c3342;
                        --erro: #fda29b; --erro-fundo: #3a1714; --alerta-fundo: #33290f; }
              }
              * { box-sizing: border-box; }
              body { margin: 0; background: var(--fundo); color: var(--texto); font: 16px/1.5 system-ui, sans-serif; }
              main { max-width: 640px; margin: 32px auto; padding: 0 16px; }
              .cartao { background: var(--cartao); border: 1px solid var(--borda); border-radius: 12px; padding: 24px; }
              h1 { margin: 0 0 4px; font-size: 1.5rem; } h2 { font-size: 1.1rem; margin-top: 24px; }
              .sub, .dica { color: var(--suave); font-size: .9rem; margin-top: 0; }
              fieldset { border: 1px solid var(--borda); border-radius: 8px; margin: 16px 0; padding: 12px 16px; }
              legend { font-weight: 600; padding: 0 4px; }
              label { display: block; margin: 8px 0; font-size: .95rem; }
              input, select { display: block; width: 100%; margin-top: 4px; padding: 8px 10px; font: inherit; color: inherit;
                              background: var(--fundo); border: 1px solid var(--borda); border-radius: 6px; }
              .linha { display: flex; gap: 12px; } .linha label { flex: 1; } .linha .curto { flex: 0 0 110px; }
              .caixa { display: flex; gap: 8px; align-items: flex-start; } .caixa input { width: auto; margin-top: 5px; }
              button, .botao { display: inline-block; background: var(--acento); color: #fff; border: 0; border-radius: 8px;
                               padding: 10px 20px; font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; }
              .erro { background: var(--erro-fundo); color: var(--erro); border-radius: 8px; padding: 12px 16px; margin: 16px 0; }
              .erro ul { margin: 6px 0 0; padding-left: 20px; }
              .alerta { background: var(--alerta-fundo); border-radius: 8px; padding: 12px 16px; }
              .ok { font-size: 1.05rem; }
              code, pre { font-family: ui-monospace, monospace; font-size: .85rem; }
              pre { background: var(--fundo); border: 1px solid var(--borda); border-radius: 6px; padding: 12px; overflow-x: auto; }
              @media (max-width: 480px) { .linha { flex-direction: column; gap: 0; } .linha .curto { flex: 1; } main { margin: 16px auto; } }
            </style>
            </head>
            <body><main><div class="cartao">
            {$corpo}
            </div></main></body>
            </html>
            HTML;
    }

    public static function h(string $texto): string
    {
        return htmlspecialchars($texto, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
    }
}

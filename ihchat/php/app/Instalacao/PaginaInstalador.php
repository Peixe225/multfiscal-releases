<?php
declare(strict_types=1);

namespace IHchat\Instalacao;

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
                . 'apontando para <code>public_html/ihchat/public</code> e informe abaixo o endereço dele, '
                . 'sem pasta (ex.: <code>https://atendimento.oprojeto.online</code>). O melhor é instalar já por ele.</p>';
        }
        if (!$conexaoSegura) {
            $avisos .= '<p class="alerta">Você está em <b>http</b> sem cadeado: a senha iria sem criptografia. '
                . 'Ative o SSL do subdomínio no hPanel e abra este endereço com <b>https://</b>.</p>';
        }
        if (!$temCodigo) {
            $avisos .= '<p class="alerta">Falta o <b>código de instalação</b>. Crie o arquivo '
                . '<code>ihchat/dados/instalacao.codigo</code> no Gerenciador de Arquivos, com um texto '
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
            <h1>Instalar o IHchat</h1>
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
                <label>Nome do banco <input name="banco_nome" value="{$v('banco_nome')}" placeholder="u123456789_ihchat"></label>
                <label>Usuário do banco <input name="banco_usuario" value="{$v('banco_usuario')}" placeholder="u123456789_ihchat"></label>
                <label>Senha do banco <input name="banco_senha" type="password" autocomplete="off"></label>
              </fieldset>
              <fieldset>
                <legend>Administrador</legend>
                <label>Nome <input name="admin_nome" required minlength="2" maxlength="120" value="{$v('admin_nome')}"></label>
                <label>E-mail (é o login) <input name="admin_email" type="email" required value="{$v('admin_email')}"></label>
                <label>Senha <input name="admin_senha" type="password" required minlength="10" maxlength="72" autocomplete="new-password"></label>
                <label>Repita a senha <input name="admin_senha_confirmacao" type="password" required minlength="10" maxlength="72" autocomplete="new-password"></label>
                <p class="dica">De 10 a 72 caracteres (letra com acento conta 2), misturando três tipos entre minúsculas,
                  maiúsculas, números e símbolos.</p>
              </fieldset>
              <fieldset>
                <legend>Endereço</legend>
                <label>Endereço público <input name="url_publica" value="{$v('url_publica')}" placeholder="https://atendimento.oprojeto.online"></label>
                <p class="dica">É o endereço que vai nas URLs de webhook do WhatsApp e do Telegram e no código do widget.
                  Só o endereço do subdomínio, sem pasta no fim.</p>
                <label class="caixa"><input type="checkbox" name="exemplos" value="1"{$exemplos}>
                  Carregar exemplos (atendente Ana e canais desativados, etiquetas e conversas fictícias) — só para conhecer o sistema</label>
              </fieldset>
              <button type="submit">Instalar</button>
            </form>
            HTML;
        return self::pagina('Instalar o IHchat', $corpo);
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
                . 'As conversas de exemplo ficam atribuídas a ela. Para usar a Ana, o administrador abre '
                . '<b>Equipe</b> no painel, define uma senha para ela (Editar) e a reativa.</p>'
                . '<p class="alerta">Os canais de exemplo <b>WhatsApp, Telegram e e-mail</b> foram criados <b>desativados</b>: '
                . 'sem credenciais, o webhook do WhatsApp aceitaria mensagens forjadas por qualquer pessoa. Em Canais, '
                . 'preencha as credenciais (no WhatsApp, o <b>App Secret</b>) e só então clique em Ativar. '
                . 'O chat do site já está ativo.</p>';
        }
        $corpo = <<<HTML
            <h1>Instalação concluída</h1>
            <p class="ok">O IHchat está no ar. Entre no painel com <b>{$email}</b> e a senha que você escolheu.</p>
            {$aviso}
            <p><a class="botao" href="{$painel}">Abrir o painel</a></p>
            <h2>Próximos passos</h2>
            <ol>
              <li>hPanel → Avançado → Cron Jobs: a cada minuto, <code>/usr/bin/php …/ihchat/cron.php</code>
                (coleta e-mails e mensagens do Telegram, limpa a fila de eventos).</li>
              <li>No painel, Canais: cadastre as credenciais do WhatsApp e do Telegram. As URLs de webhook
                começam com <code>{$webhooks}</code> e aparecem prontas na tela de cada canal.</li>
              <li>Cada atendente escolhe o seu setor em Perfil, no topo do painel: é o que o cliente vê ao ser atendido.</li>
            </ol>
            {$widget}
            <p class="dica">Este endereço de instalação não existe mais, e o código de instalação foi apagado.</p>
            HTML;
        return self::pagina('IHchat instalado', $corpo);
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
              /* Paleta do IHchat (ver o topo de app/web/painel.css): o laranja da I&H
                 é o acento e leva texto azul-noite (9,67:1; branco daria 2,06:1);
                 laranja como texto só na versão escura #a35200 (5,58:1 no branco) */
              :root { color-scheme: light dark; --noite: #060912; --lilas: #eaedf7; --laranja: #ff9e3d;
                      --fundo: #f4f5fa; --cartao: #fff; --texto: #0e1222; --suave: #585f76; --borda: #dcdfeb;
                      --campo: #eef0f7; --acento-texto: #a35200; --linha: #d16900;
                      --erro: #b42318; --erro-fundo: #fef3f2; --alerta-fundo: #fff5d6; --alerta-borda: #e8c877; }
              @media (prefers-color-scheme: dark) {
                :root { --fundo: var(--noite); --cartao: #0d1120; --texto: var(--lilas); --suave: #9ba2bd; --borda: #262c43;
                        --campo: #161b2e; --acento-texto: #ffa654; --linha: var(--laranja);
                        --erro: #fda29b; --erro-fundo: #3a1714; --alerta-fundo: #332b12; --alerta-borda: #5f5327; }
              }
              * { box-sizing: border-box; }
              body { margin: 0; background: var(--fundo); color: var(--texto);
                     font: 16px/1.5 "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
              main { max-width: 640px; margin: 32px auto; padding: 0 16px; }
              .marca { display: flex; align-items: center; gap: 10px; margin: 0 0 16px 2px; }
              .marca svg { height: 30px; width: auto; flex: none; color: var(--texto); }
              .marca b { font-size: 20px; font-weight: 800; letter-spacing: -.03em; }
              .marca span { color: var(--suave); font-size: .9rem; }
              .cartao { background: var(--cartao); border: 1px solid var(--borda); border-top: 4px solid var(--laranja);
                        border-radius: 12px; padding: 24px; }
              h1 { margin: 0 0 4px; font-size: 1.5rem; letter-spacing: -.02em; } h2 { font-size: 1.1rem; margin-top: 24px; }
              .sub, .dica { color: var(--suave); font-size: .9rem; margin-top: 0; }
              fieldset { border: 1px solid var(--borda); border-radius: 8px; margin: 16px 0; padding: 12px 16px; }
              legend { font-weight: 650; padding: 0 4px; }
              label { display: block; margin: 8px 0; font-size: .95rem; }
              input, select { display: block; width: 100%; margin-top: 4px; padding: 8px 10px; font: inherit; color: inherit;
                              background: var(--campo); border: 1px solid var(--borda); border-radius: 6px; }
              input:focus, select:focus { outline: 2px solid var(--linha); outline-offset: -1px; }
              .linha { display: flex; gap: 12px; } .linha label { flex: 1; } .linha .curto { flex: 0 0 110px; }
              .caixa { display: flex; gap: 8px; align-items: flex-start; } .caixa input { width: auto; margin-top: 5px; accent-color: var(--linha); }
              button, .botao { display: inline-block; background: var(--laranja); color: var(--noite); border: 0; border-radius: 8px;
                               padding: 10px 20px; font: inherit; font-weight: 650; cursor: pointer; text-decoration: none; }
              button:hover, .botao:hover { filter: brightness(1.06) saturate(1.05); }
              button:focus-visible, .botao:focus-visible { outline: 2px solid var(--linha); outline-offset: 2px; }
              a { color: var(--acento-texto); }
              .erro { background: var(--erro-fundo); color: var(--erro); border-radius: 8px; padding: 12px 16px; margin: 16px 0; }
              .erro ul { margin: 6px 0 0; padding-left: 20px; }
              .alerta { background: var(--alerta-fundo); border: 1px solid var(--alerta-borda); border-radius: 8px; padding: 12px 16px; }
              .ok { font-size: 1.05rem; }
              code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .85rem; }
              /* o trecho do widget numa superfície de marca: azul-noite com o lilás do "H" */
              pre { background: var(--noite); color: var(--lilas); border: 1px solid var(--borda); border-radius: 6px;
                    padding: 12px; overflow-x: auto; }
              @media (max-width: 480px) { .linha { flex-direction: column; gap: 0; } .linha .curto { flex: 1; } main { margin: 16px auto; } }
            </style>
            </head>
            <body><main>
            <!-- "iH" da I&H (app/web/marca/ih.svg) em linha: a CSP do instalador
                 (default-src 'none') bloquearia um <img> ou um favicon -->
            <header class="marca">
              <svg viewBox="11 3.5 284 401" aria-hidden="true" focusable="false">
                <circle cx="53" cy="45.5" r="40" fill="#ff9e3d"/>
                <rect x="13" y="135" width="80" height="267" rx="8" fill="#ff9e3d"/>
                <rect x="93" y="235" width="128" height="67" rx="8" fill="currentColor"/>
                <rect x="213" y="66" width="80" height="336" rx="8" fill="currentColor"/>
              </svg>
              <b>IHchat</b> <span>· central de atendimento da I&amp;H</span>
            </header>
            <div class="cartao">
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

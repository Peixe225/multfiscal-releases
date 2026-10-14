# LENDA · servidor (medição + contas) — contrato

Tudo roda na hospedagem da Hostinger (PHP 8 + MySQL), na mesma origem do jogo:
`https://oprojeto.online/lenda/`. Sem serviço de terceiros. O jogo (build do site, `VITE_SITE=1`) fala com
`/lenda/api/*.php` por `fetch` com `credentials: 'same-origin'` e JSON.

## Arquivos publicados

```
public_html/lenda/
  api/
    .htaccess          nega _*.php, *.sql, *.md; sem listagem; sem cache
    _lib.php           config, PDO, JSON, origem, limites, sessão (nunca servido)
    _schema.sql        tabelas (nunca servido)
    e.php              medição (eventos e batimentos)
    conta.php          cadastro, entrar, sair, eu, esqueci, redefinir, excluir
    progresso.php      Hall das Lendas na nuvem (GET / POST)
    painel.php         números do painel (só administrador)
    instalar.php       cria/atualiza as tabelas (só administrador, idempotente)
  painel/
    index.html         painel de números (estático, sem script embutido)
    painel.js, painel.css
  privacidade.html     política de privacidade (LGPD)
```

Config (fora do public_html quando der): `/home/u785231359/domains/oprojeto.online/lenda-config.php`.
`_lib.php` procura, nesta ordem: `getenv('LENDA_CONFIG')`, `dirname(__DIR__, 3) . '/lenda-config.php'`,
`dirname(__DIR__, 2) . '/lenda-config.php'`, `__DIR__ . '/_config.php'` (negado pelo .htaccess). O arquivo
retorna um array:

```php
<?php return [
  'db' => ['dsn' => 'mysql:host=localhost;dbname=u785231359_lenda;charset=utf8mb4', 'user' => '…', 'pass' => '…'],
  'segredo' => '<64 hex>',                 // HMAC do cookie do painel e sal do hash de IP
  'admin_senha_hash' => '<password_hash>', // senha do painel
  'admin_token_sha256' => '<sha256 hex>',  // token para consultas por script (Authorization: Bearer)
  'origens' => ['https://oprojeto.online', 'https://www.oprojeto.online'],
  'regras' => ['apos_partidas' => 5, 'obrigatorio' => false, 'lembrar_a_cada' => 3],
  'email_remetente' => 'contato@oprojeto.online',
  'cookie_seguro' => true,                 // false só no teste local (http)
];
```

## Regras gerais (todas as rotas)

- Respostas `application/json; charset=utf-8`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
- Escrita (POST) só com `Content-Type: application/json` (ou `text/plain` no `e.php`, por causa do
  `sendBeacon`) e `Origin` (ou, sem Origin, `Referer`) dentro de `origens`. Fora disso: `403 {"erro":"origem"}`.
- Corpo máximo: 16 KB (`e.php`, `conta.php`), 6 MB (`progresso.php`). Acima: `413`.
- Erros: `{"erro":"<codigo>","mensagem":"<texto pt-BR para mostrar>"}` com o status certo (400, 401, 403,
  404, 409, 413, 429, 500). Nunca vaza SQL, caminho ou pilha.
- IP nunca é gravado. Para limite de tentativas: `hash_hmac('sha256', ip . date('Y-m-d'), segredo)`.
- Limites (tabela `tentativas`, janela de 10 min): entrar 10/IP e 5/e-mail; cadastrar 5/IP; esqueci 3/e-mail
  e 10/IP; redefinir 5/e-mail; `e.php` 240 eventos/sessão/10 min. Estourou: `429 {"erro":"limite"}`.

## Sessão de jogador

- Cookie `lenda_sessao`: 32 bytes aleatórios em base64url; no banco só o `sha256`. `HttpOnly`, `Secure`
  (se `cookie_seguro`), `SameSite=Lax`, `Path=/lenda/`, 180 dias, renovado a cada uso depois de 7 dias.
- Senha: `password_hash(PASSWORD_DEFAULT)`; mínimo 6, máximo 72 caracteres.
- E-mail: `trim`, minúsculo, `filter_var(FILTER_VALIDATE_EMAIL)`, até 190.
- Apelido: 2 a 20 caracteres, letras (com acento), números, espaço, `_ . -`; sem espaço nas pontas.

## `POST /lenda/api/conta.php` — corpo `{"acao": "...", ...}`

| acao | entrada | sucesso |
|---|---|---|
| `cadastrar` | `apelido, email, senha, aceite: true, vid?, origem?` | `201 {"usuario":U}` + cookie |
| `entrar` | `email, senha, vid?` | `200 {"usuario":U}` + cookie |
| `sair` | — | `200 {"ok":true}`, apaga a sessão e o cookie |
| `esqueci` | `email` | `200 {"ok":true}` sempre (não revela se existe). Se existe: código de 6 dígitos, válido 30 min, `mail()` de `email_remetente` |
| `redefinir` | `email, codigo, senha` | `200 {"usuario":U}` + cookie; derruba as outras sessões |
| `excluir` | `senha` | `200 {"ok":true}`; apaga usuário, sessões e progresso (LGPD) |

`GET /lenda/api/conta.php` → `200 {"usuario": U | null, "regras": {"aposPartidas":5,"obrigatorio":false,"lembrarACada":3}}`.

`U = {"id": 12, "apelido": "Foguete", "email": "a@b.com", "criadoEm": "2026-10-14T12:00:00Z"}`.

Erros de `conta.php`: `email_invalido`, `apelido_invalido`, `senha_curta`, `aceite`, `email_em_uso` (409),
`credenciais` (401, mesma mensagem para e-mail inexistente e senha errada), `codigo` (400), `nao_logado` (401).

## `GET|POST /lenda/api/progresso.php` (precisa da sessão)

- `GET` → `200 {"hall": [HallEntry…] | [], "partidas": 7, "atualizadoEm": "…"}`.
- `POST {"hall": [HallEntry…], "partidas": 7}` → `200 {"ok":true,"atualizadoEm":"…"}`. O servidor só
  confere que `hall` é lista (até 100 itens, cada um com `id` string) e guarda o JSON comprimido (`gzencode`).
  `partidas` = maior entre o salvo e o enviado. O cliente mescla antes de mandar (`mergeHall`).

## `POST /lenda/api/e.php` — medição

Corpo (texto JSON, até 16 KB):

```json
{"v":"<uuid do visitante>","s":"<uuid da sessão>","bot":0,
 "ctx":{"ref":"tiktok.com","utm":{"source":"tiktok","medium":"bio","campaign":""},"dev":"mobile","lang":"pt-BR","tela":"390x844"},
 "ev":[{"t":"view","m":null,"d":{"rota":"/"},"ts":1760000000000},
       {"t":"hb","p":1,"m":"classico"}]}
```

- `ctx` só é lido na criação da sessão (primeiro envio). `v` e `s` = UUID v4 (validar formato).
- Tipos de evento (`t`): `view` (abriu uma tela; `d.rota`), `hb` (batimento a cada 15 s com a aba visível;
  `p:1` se está jogando), `jogo_inicio` (`m`: `classico`|`imersivo`|`live`; `d.ritmo`), `jogo_fim`
  (`m`; `d.nota`, `d.temporadas`), `partida_fim` (imersivo: uma partida jogada; `d.resultado`), `gate_ver`,
  `gate_fechar`, `cadastro`, `login`, `logout`, `compartilhar`. Outros tipos: ignorados.
- `hb`: atualiza `visitas.ultimo = agora`, soma até 15 s em `ativo_s` (nunca mais que o tempo real desde o
  último batimento) e, com `p:1`, `jogando_ate = agora + 45 s`. Não vira linha em `eventos`.
- Os outros tipos viram linha em `eventos` (`dados` = JSON de até 1 KB).
- Sessão com `bot:1`, `navigator.webdriver` ou User-Agent de robô (`bot|crawl|spider|preview|headless|
  facebookexternalhit|Slurp|curl|wget|python`) é gravada com `bot = 1` (o painel esconde por padrão).
- Se o jogador estiver logado (cookie válido), grava `usuario_id` na sessão.
- Resposta: `204` sem corpo.

## `GET /lenda/api/painel.php` (administrador)

Autenticação: cookie `lenda_painel` (HMAC de `exp`, 12 h, `Path=/lenda/`) ou `Authorization: Bearer <token>`.
`POST {"acao":"entrar","senha":"…"}` cria o cookie; `POST {"acao":"sair"}` apaga. Sem autenticação: `401`.

`GET ?de=YYYY-MM-DD&ate=YYYY-MM-DD&bots=0` (padrão: últimos 7 dias, fuso America/Sao_Paulo) →

```json
{"agora":{"online":3,"jogando":2,"atualizadoEm":"…"},
 "periodo":{"de":"…","ate":"…","visitantes":120,"novos":95,"sessoes":160,"tempoMedioS":312,"tempoTotalH":13.9,
   "jogaram":70,"inicios":{"classico":90,"imersivo":20,"live":4},"fins":{"classico":61,"imersivo":3,"live":2},
   "partidasImersivo":45,"cadastros":8,"logins":12,"gate":{"vistos":20,"fechados":9,"cadastrosDepois":8}},
 "dias":[{"dia":"2026-10-14","visitantes":40,"sessoes":52,"jogaram":25,"fins":30,"cadastros":3,"tempoMedioS":300}],
 "horas":[{"hora":0,"sessoes":2}],
 "origens":[{"origem":"tiktok","sessoes":80}],
 "dispositivos":[{"dispositivo":"mobile","sessoes":130}],
 "funil":[{"etapa":"Visitaram","n":120},{"etapa":"Começaram um jogo","n":70},{"etapa":"Terminaram um jogo","n":50},
          {"etapa":"5 partidas","n":12},{"etapa":"Criaram conta","n":8}],
 "notas":{"media":41,"melhor":88},
 "ultimosCadastros":[{"apelido":"Foguete","em":"…","origem":"tiktok"}]}
```

- `online` = sessões não-robô com `ultimo` nos últimos 60 s; `jogando` = com `jogando_ate > agora`.
- `visitantes` = `vid` distintos com sessão no período; `novos` = cuja primeira sessão caiu no período.
- `jogaram` = visitantes com pelo menos um `jogo_inicio`. `5 partidas` = visitantes com 5 ou mais
  (`jogo_fim` de classico/imersivo + `partida_fim`), contando a vida toda.
- `origem` da sessão: `utm.source` se veio, senão o domínio do `ref` normalizado (`tiktok.com`,
  `vm.tiktok.com` → `tiktok`; `youtube.com`, `youtu.be`, `m.youtube.com` → `youtube`; `instagram.com` →
  `instagram`; `google.*` → `google`; vazio → `direto`; outro → o domínio).

## Tabelas (MySQL 8 / MariaDB 10.6, InnoDB, utf8mb4)

`usuarios(id, email UNIQUE, apelido, senha_hash, criado_em, ultimo_login, origem, aceite_em)`,
`sessoes_login(token_sha256 PK, usuario_id, criada_em, expira_em, renovada_em)`,
`progresso(usuario_id PK, dados MEDIUMBLOB, tamanho, partidas, atualizado_em)`,
`redefinicoes(email PK, codigo_hash, expira_em, tentativas)`,
`tentativas(chave, janela, n, PK(chave, janela))`,
`visitas(sid PK, vid, usuario_id, inicio, ultimo, ativo_s, jogando_ate, origem, utm_source, utm_medium,
utm_campaign, dispositivo, idioma, tela, bot)` com índices em `inicio`, `ultimo`, `vid`,
`eventos(id PK, sid, vid, tipo, modo, dados, em)` com índices em `(em, tipo)`, `sid`, `(vid, tipo)`.
Datas em UTC (`DATETIME`); o painel converte para America/Sao_Paulo.

## No jogo (só `VITE_SITE=1`)

- Contador de partidas no aparelho (`localStorage['lenda:partidas']`): +1 a cada carreira terminada no
  Clássico, +1 a cada partida jogada no Imersivo. A Live (rota `/live`, simulador) não conta e nunca mostra o
  convite.
- Com `partidas >= aposPartidas` e sem conta, abre o convite de conta (cadastro / entrar / esqueci). Com
  `obrigatorio: false`, "Agora não" fecha e o convite volta depois de mais `lembrarACada` partidas; com
  `obrigatorio: true` não há como fechar. Nunca interrompe uma partida em andamento: abre na tela seguinte ao
  fim da partida/carreira, ou ao tentar começar outra.
- Com conta: o Hall das Lendas sobe para a nuvem (`progresso.php`) ao entrar (mescla com o do aparelho) e a cada
  carreira terminada; em outro aparelho, desce ao entrar.
- O menu ganha "Entrar / Criar conta" (sempre disponível) ou o apelido com "Sair" e "Excluir conta".

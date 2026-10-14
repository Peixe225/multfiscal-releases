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
    carreiras.php      carreiras salvas na conta (listar, abrir, salvar, apagar)
    lendas.php         números atualizados de Messi e Cristiano Ronaldo (cache do messivsronaldo.app)
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
- Corpo máximo: 16 KB (`e.php`, `conta.php`), 600 KB (`carreiras.php`). Acima: `413`.
- Erros: `{"erro":"<codigo>","mensagem":"<texto pt-BR para mostrar>"}` com o status certo (400, 401, 403,
  404, 409, 413, 429, 500). Nunca vaza SQL, caminho ou pilha.
- IP nunca é gravado. Para limite de tentativas: `hash_hmac('sha256', ip . date('Y-m-d'), segredo)` (IPv6: o /64).
  Com `ip_cabecalho` na config, vale o último item válido do cabeçalho (e, com `ip_proxies`, só vindo deles).
- Limites (tabela `tentativas`, janela de 10 min): entrar 10/IP e 5/e-mail; cadastrar 5/IP e 200 no site;
  esqueci 3/e-mail, 10/IP, 40 no site, 5/e-mail/dia e 300 no site/dia; redefinir 5/e-mail e 15/e-mail/dia; login
  do painel 10/IP e 50 no site; salvar carreira 2048 KB comprimidos/conta e 4096 KB/IP; `e.php` 240
  eventos/sessão/10 min. Estourou: `429 {"erro":"limite"}`. Janelas encerradas de 10 min são apagadas na janela
  seguinte; as diárias (chave `dia-*`), depois de 1 dia.

## Sessão de jogador

- Cookie `lenda_sessao`: 32 bytes aleatórios em base64url; no banco só o `sha256`. `HttpOnly`, `Secure`
  (se `cookie_seguro`), `SameSite=Lax`, `Path=/lenda/`, 180 dias, renovado a cada uso depois de 7 dias.
- Senha: `password_hash(PASSWORD_DEFAULT)`; mínimo 6, máximo 72 caracteres.
- E-mail: `trim`, minúsculo, `filter_var(FILTER_VALIDATE_EMAIL)`, até 190.
- Apelido: 2 a 20 caracteres, letras (com acento), números, espaço, `_ . -`; sem espaço nas pontas.

## `POST /lenda/api/conta.php` — corpo `{"acao": "...", ...}`

| acao | entrada | sucesso |
|---|---|---|
| `cadastrar` | `apelido, email, senha, aceite: true, vid?, origem?, timeCoracao?, uf?` | `201 {"usuario":U}` + cookie |
| `entrar` | `email, senha, vid?` | `200 {"usuario":U}` + cookie |
| `sair` | — | `200 {"ok":true}`, apaga a sessão e o cookie |
| `esqueci` | `email` | `200 {"ok":true}` sempre (não revela se existe). Se existe: código de 6 dígitos, válido 30 min, `mail()` de `email_remetente` (com um código emitido há menos de 2 min, não manda outro) |
| `redefinir` | `email, codigo, senha` | `200 {"usuario":U}` + cookie; derruba as outras sessões |
| `perfil` | `apelido?, timeCoracao?, uf?` | `200 {"usuario":U}` |
| `partidas` | `n` (contador do aparelho) | `200 {"ok":true}`; guarda o maior entre o salvo e `n` |
| `excluir` | `senha` | `200 {"ok":true}`; apaga usuário, sessões e carreiras; tira o `usuario_id` das visitas e troca o `vid` delas (e dos eventos) por um novo, um por aparelho (LGPD) |

`GET /lenda/api/conta.php` → `200 {"usuario": U | null, "regras": {"aposPartidas":5,"obrigatorio":false,"lembrarACada":3}}`.

`U = {"id": 12, "apelido": "Foguete", "email": "a@b.com", "criadoEm": "2026-10-14T12:00:00Z", "timeCoracao": "Flamengo" | null,
"uf": "PE" | null, "origem": "tiktok", "estatisticas": {"partidas": 9, "carreirasSalvas": 4, "melhorNota": 88,
"melhorJogador": "BATISTA", "bolasOuro": 3, "gols": 912, "titulos": 61, "tempoJogadoMin": 140,
"primeiroAcesso": "…", "ultimoAcesso": "…", "aparelhos": ["mobile", "desktop"]}}`.

- Ao `cadastrar`/`entrar` com `vid`, o servidor liga ao usuário o visitante (`visitantes_usuarios(vid, usuario_id)`)
  e marca `usuario_id` nas visitas desse `vid`: o histórico de antes do cadastro passa a ser da conta.
- `estatisticas` vem do banco: `partidas` = maior entre o contador salvo e o que os eventos mostram;
  `tempoJogadoMin` = soma de `ativo_s` das visitas do usuário; o resto, das carreiras salvas.
- `timeCoracao`: texto livre de até 40 caracteres (opcional). `uf`: sigla de estado brasileiro ou `EX` (fora do Brasil).

Erros de `conta.php`: `email_invalido`, `apelido_invalido`, `senha_curta`, `aceite`, `email_em_uso` (409),
`credenciais` (401, mesma mensagem para e-mail inexistente e senha errada), `codigo` (400), `nao_logado` (401).

## `/lenda/api/carreiras.php` (precisa da sessão; `401 nao_logado` sem ela)

Cada carreira salva é um `HallEntry` inteiro do jogo (o mesmo objeto do Hall das Lendas do aparelho: `id`,
`identity`, `summary`, `career`, `legacy`, …), guardado comprimido (`gzencode`). Limite: 200 por conta.

- `GET` → `200 {"carreiras": [C…], "limite": 200}`, mais recentes primeiro. `C = {"id": "<HallEntry.id>",
  "modo": "classico"|"imersivo", "jogador": "BATISTA", "numero": 10, "pais": "BRA", "posicao": "MEI",
  "nota": 51, "notaV": 2, "picoOvr": 87, "temporadas": 21, "gols": 132, "titulos": 30, "bolasOuro": 0, "headline": "Lenda do
  Flamengo", "como": "auto"|"manual", "salvaEm": "…", "terminouEm": "…"}` (os campos da lista saem do
  próprio HallEntry: `identity`, `summary.peakOvr`, `summary.seasons`, `summary.totals`, `summary.trophies`,
  `summary.awards`, `legacy.score`, `summary.headline`, `finishedAt`).
- Nota (`nota`, `legacy.score`) e versão dos pesos: o `HallEntry.legacy` traz `v` (versão da fórmula da Nota de
  Legado, `LEGACY_VERSION` em `src/engine/legacy/score.ts`; hoje `2`; sem `v` = gravada antes da v2). O cliente
  SEMPRE manda o `HallEntry` com `legacy` já recalculado na versão atual (`refreshLegacy` em `src/store/career.ts`,
  o mesmo número que o Hall mostra). O servidor guarda `legacy.v` junto da nota (coluna `nota_v`, `NULL` sem `v`)
  e devolve `"notaV": 2 | null` em cada `C`. Em "Minhas carreiras" e no painel, carreira com `notaV` diferente da
  versão atual: o cliente abre (`GET ?id`), recalcula e reenvia com `salvar` (mesmo `como`), e a nota da lista
  passa a bater com a do Hall. O servidor não recalcula nada (a fórmula fica só no jogo).
- `GET ?id=<HallEntry.id>` → `200 {"carreira": HallEntry}`; outra conta ou inexistente: `404`.
- `POST {"acao":"salvar","carreira": HallEntry, "como":"auto"|"manual"}` → `200 {"carreira": C}`. Grava ou
  atualiza pelo par (usuário, `id`). Confere: objeto com `id` (texto até 64), `identity` e `summary`; JSON até
  600 KB (e até 128 KB já comprimido; acima: `413 grande`). Conta cheia (200 carreiras ou 20 MB de JSON):
  `409 {"erro":"cheio"}`. `como` só sobe de `auto` para `manual`, nunca o contrário.
- `POST {"acao":"apagar","id": "<HallEntry.id>"}` → `200 {"ok":true}`.

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
- Os outros tipos viram linha em `eventos`. `dados` = só as chaves conhecidas do tipo, em JSON de até 256 bytes:
  `view {rota}`, `jogo_inicio {ritmo}`, `jogo_fim {nota, temporadas, pico}`, `partida_fim {resultado, placar,
  gols}`, `gate_ver {partidas, rota}`, `gate_fechar {partidas}`, `compartilhar {acao, rota}`. Texto até 64
  caracteres; `nota`, `temporadas` e `pico` números finitos de -999 a 999 (decimal arredondado), os outros
  números de 0 a 10^7; fora disso a chave sai.
- Teto de linhas em `eventos`: 1.500 por IP a cada 10 min (os `hb` não contam) e 3.000 por sessão na vida toda
  (`visitas.eventos`). O que passa é descartado em silêncio (continua `204`; os `hb` do envio continuam valendo).
- Sessão com `bot:1`, `navigator.webdriver` ou User-Agent de robô (`bot|crawl|spider|preview|headless|
  facebookexternalhit|Slurp|curl|wget|python`) é gravada com `bot = 1` (o painel esconde por padrão).
- Se o jogador estiver logado (cookie válido), grava `usuario_id` na sessão.
- Resposta: `204` sem corpo.

## `GET /lenda/api/painel.php` (administrador)

Autenticação: cookie `lenda_painel` (`exp.HMAC(exp)`, com chave `segredo|admin_senha_hash`: trocar a senha do painel
derruba os cookies; 12 h, `Path=/lenda/`) ou `Authorization: Bearer <token>`.
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
`carreiras(id PK, usuario_id, carreira_id, modo, jogador, numero, pais, posicao, nota, nota_v, pico_ovr, temporadas, gols,
titulos, bolas_ouro, headline, como, dados MEDIUMBLOB, tamanho, terminou_em, salva_em, UNIQUE(usuario_id,
carreira_id), INDEX(usuario_id, salva_em))`, `visitantes_usuarios(vid PK, usuario_id, ligado_em)`, e em
`usuarios` também `time_coracao, uf, partidas, ultimo_acesso`,
`redefinicoes(email PK, codigo_hash, expira_em, tentativas)`,
`tentativas(chave, janela, n, PK(chave, janela))`,
`visitas(sid PK, vid, usuario_id, inicio, ultimo, ativo_s, jogando_ate, origem, utm_source, utm_medium,
utm_campaign, dispositivo, idioma, tela, bot, eventos)` com índices em `inicio`, `ultimo`, `vid`,
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
- Carreiras na conta (`carreiras.php`):
  - Salva SOZINHA, com conta, toda carreira terminada com pico de OVR acima de 89 (`summary.peakOvr >= 90`),
    `como: "auto"`. Ao entrar/cadastrar, as carreiras do aparelho com pico >= 90 que ainda não estão na conta
    sobem sozinhas.
  - As outras: botão "Salvar na minha conta" na tela de fim de carreira / resumo, e "Salvar a última carreira"
    no menu da conta (`como: "manual"`). Sem conta, o botão abre o diálogo de conta e salva logo depois de entrar.
  - Tela "Minhas carreiras" (no menu da conta e no Hall): aba "Na conta" (lista do servidor, com abrir e apagar)
    e aba "Neste aparelho" (Hall local que não está na conta, com "Salvar na conta"). Abrir uma carreira da
    conta mostra a mesma tela de resumo da carreira (`/resumo`) com aquele HallEntry, em qualquer aparelho, e
    oferece pôr no Hall deste aparelho.
- O menu ganha "Entrar / Criar conta" (sempre disponível) ou o apelido com "Minha conta" (perfil com as
  estatísticas, time do coração e estado editáveis), "Minhas carreiras", "Salvar a última carreira", "Sair" e
  "Excluir conta".
- O painel ganha "Contas": total, novas no período, carreiras salvas (auto x manual) e as 10 melhores carreiras
  salvas (apelido, jogador, nota).

## `GET /lenda/api/lendas.php` — números atualizados de Messi e Cristiano Ronaldo

Arquivo independente (não usa `_lib.php`). Busca no servidor, no máximo a cada 6 h, o arquivo de dados público
do site MessivsRonaldo.app (`https://www.messivsronaldo.app/page-data/index/page-data.json`, gerado pelo
Gatsby: `allSheetMessiAllTimeStats`, `allSheetRonaldoAllTimeStats`, `allSheetHonours`) com timeout de 8 s e
User-Agent `LENDA/1.0 (+https://oprojeto.online/lenda/)`. Guarda o resultado já convertido em
`dirname(__DIR__, 3) . '/lenda-cache/lendas.json'` (fora do public_html; cria a pasta). Se a busca falhar,
responde o último cache (com `"desatualizado": true`); sem cache nenhum, `503`. `Cache-Control: public,
max-age=3600`.

```json
{"fonte":"MessivsRonaldo.app","url":"https://www.messivsronaldo.app/","buscadoEm":"2026-10-14T05:00:00Z",
 "lendas":{"messi":{"jogos":1179,"gols":934,"assistencias":426,"golsSelecao":…,"jogosSelecao":…,
   "golsChampions":…,"golsCopa":…,"titulos":49,"bolasOuro":8,"premios":[{"nome":"Ballon d'Or","n":8,"anos":"2023, 2021, …"}, …]},
  "cristiano-ronaldo":{…}}}
```

`titulos` = soma dos títulos coletivos da tabela de honras; `premios` = a tabela inteira (nome original, número
e anos de cada um), para o Hall mostrar e o jogo mapear para as categorias dele. No jogo (só `VITE_SITE=1`), o
Hall das Lendas busca `lendas.php` e, se vier, usa esses números para Messi e Cristiano Ronaldo no lugar dos
fixos, com a linha "Atualizado em 12/10/2026 · fonte: MessivsRonaldo.app" (link). Sem resposta: usa os fixos.

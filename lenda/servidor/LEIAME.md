# LENDA · servidor (medição + contas)

PHP 8.1+ e MySQL 8/MariaDB 10.6+, sem framework nem composer, na mesma hospedagem do jogo
(`https://oprojeto.online/lenda/`). O contrato com o jogo (rotas, campos, erros, tabelas) está em
[`CONTRATO.md`](CONTRATO.md) (medição, contas, carreiras) e [`CONTRATO-v3.md`](CONTRATO-v3.md) (configuração do site,
admin, Hall público, conquistas, indicações e bônus; o §8 tem os detalhes do que foi implementado).

```
servidor/
  api/            → public_html/lenda/api/      (e.php, conta.php, carreiras.php, hall.php, conquistas.php, bonus.php,
                                                  admin.php, painel.php, instalar.php, _lib.php, _palavras.php,
                                                  _contas.php, _carreiras.php, _hall.php, _bonus.php, _schema.sql,
                                                  .htaccess; o lendas.php é de outro time)
  painel/         → public_html/lenda/painel/   (index.html, painel.js, painel.css)
  privacidade.html→ public_html/lenda/privacidade.html
  teste/          fica no repositório (não sobe)
```

## Publicar na Hostinger

### 1. Criar o banco

No hPanel: **Bancos de dados → Gerenciamento → Criar novo banco**. Anote o nome do banco, o usuário e a senha
(ex.: `u785231359_lenda` / `u785231359_lenda`). O PHP do site fala com o banco em `localhost`.

### 2. Gerar os segredos (no seu computador ou no terminal SSH da Hostinger)

```sh
# segredo do servidor (assina o cookie do painel e embaralha o IP dos limites)
php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'

# senha do painel: longa e aleatória (16 caracteres ou mais; esta gera 24) e o hash dela (o arquivo guarda só o hash)
php -r '$s = rtrim(strtr(base64_encode(random_bytes(18)), "+/", "-_"), "="); fwrite(STDERR, "senha do painel (guarde num gerenciador de senhas): $s\n"); echo password_hash($s, PASSWORD_DEFAULT), PHP_EOL;'

# token para consultas por script (instalar.php e painel.php com Authorization: Bearer)
php -r '$t = bin2hex(random_bytes(24)); echo "token (guarde num gerenciador de senhas): $t", PHP_EOL, "sha256 (vai na config): ", hash("sha256", $t), PHP_EOL;'
```

Guarde a senha do painel e o token fora do repositório. A config recebe só o hash e o sha256. A senha do painel
tem de ser longa e aleatória: o login do painel tem limite por IP e um teto do site inteiro (50 tentativas a cada
10 min), e sob ataque ele pode responder 429 por alguns minutos; nesse caso, use o token (Bearer).

### 3. Escrever a config (fora do public_html)

Arquivo `/home/u785231359/domains/oprojeto.online/lenda-config.php` (pelo Gerenciador de Arquivos, fora da
pasta `public_html`). Nunca suba este arquivo para o repositório.

```php
<?php return [
  'db' => [
    'dsn'  => 'mysql:host=localhost;dbname=u785231359_lenda;charset=utf8mb4',
    'user' => 'u785231359_lenda',
    'pass' => 'SENHA-DO-BANCO',
  ],
  'segredo' => 'COLE-OS-64-HEX',
  'admin_senha_hash' => 'COLE-O-HASH-DA-SENHA-DO-PAINEL',
  'admin_token_sha256' => 'COLE-O-SHA256-DO-TOKEN',
  'origens' => ['https://oprojeto.online', 'https://www.oprojeto.online'],
  'regras' => ['apos_partidas' => 5, 'obrigatorio' => false, 'lembrar_a_cada' => 3],
  'email_remetente' => 'contato@oprojeto.online',
  'cookie_seguro' => true,
  // Opcionais:
  // 'email_modo' => 'mail',            // 'arquivo' grava o e-mail em email_pasta (só para teste)
  // 'ip_cabecalho' => '',              // vazio = REMOTE_ADDR; veja "IP do visitante" abaixo antes de mudar
  // 'ip_proxies' => [],                // com ip_cabecalho: só confia no cabeçalho vindo destes IPs/faixas (ex.: '10.0.0.0/8')
  // 'limpeza_a_cada' => 100,           // limpeza leve em 1 a cada N pedidos
];
```

#### IP do visitante (antes de abrir ao público)

Os limites de tentativas (cadastro, entrar, esqueci, painel, sessões novas da medição) contam por IP (o IPv6 conta
pelo /64). O site passa pelo CDN da Hostinger (`server: hcdn`), então confira o que chega ao PHP:

1. Suba um `public_html/lenda/api/ipteste.php` temporário com
   `<?php header('Content-Type: text/plain'); foreach (['REMOTE_ADDR', 'HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'HTTP_CF_CONNECTING_IP'] as $k) echo $k, ' = ', $_SERVER[$k] ?? '(nada)', "\n";`
2. Abra `https://oprojeto.online/lenda/api/ipteste.php` pelo celular no 4G (com IPv6) e no Wi-Fi, e compare com o
   IP que o aparelho mostra em um site de "qual é meu IP".
3. **Apague o arquivo** em seguida.
4. Se `REMOTE_ADDR` já é o IP do aparelho: deixe `ip_cabecalho` vazio. Se `REMOTE_ADDR` é um IP da Hostinger (o
   mesmo para todo mundo) e o IP do aparelho veio num cabeçalho, ponha esse cabeçalho em `ip_cabecalho` (ex.:
   `'HTTP_X_FORWARDED_FOR'`) e, se der, os IPs/faixas do CDN em `ip_proxies`. Com vírgulas no cabeçalho, vale o
   último item (o que o proxy acrescentou; os da frente o cliente pode inventar).

Sem esse ajuste, com `REMOTE_ADDR` do CDN, todos os visitantes dividiriam poucos IPs e os limites virariam do site
inteiro (ex.: 5 cadastros a cada 10 min para todo mundo).

Ordem de busca da config: `getenv('LENDA_CONFIG')`, `domains/oprojeto.online/lenda-config.php`,
`public_html/lenda-config.php`, `public_html/lenda/api/_config.php` (negado pelo `.htaccess`). Se faltar
config, as rotas respondem `500 {"erro":"config"}` e nada mais.

O e-mail de troca de senha sai pelo `mail()` do PHP com `From: contato@oprojeto.online`. Essa caixa precisa
existir em **E-mails** no hPanel (senão o servidor de e-mail da Hostinger recusa o remetente).

### 4. Subir os arquivos

O `npm run build:site` já copia `servidor/api/` (inclusive o `.htaccess`, sem `_config*.php`, testes nem `.md`),
`servidor/painel/` e `servidor/privacidade.html` para dentro do `dist-site/`: subindo o `dist-site/` inteiro para
`public_html/lenda/`, o servidor vai junto. Sem o build, copie à mão `servidor/api/*` (com o `.htaccess`) para
`public_html/lenda/api/`, `servidor/painel/*` para `public_html/lenda/painel/` e `servidor/privacidade.html`
para `public_html/lenda/`. Confira que o `api/.htaccess` subiu (arquivo que começa com ponto some fácil).

### 5. Criar as tabelas

```sh
curl -sS -X POST -H "Authorization: Bearer SEU-TOKEN" https://oprojeto.online/lenda/api/instalar.php
# {"ok":true,"comandos":16,"alteracoes":[],"tabelas":["admin_log","bonus","carreiras",...],
#  "preenchidas":{"convites":0,"carreiras":0,"faltam":0}}
```

Pode rodar de novo sempre que o `_schema.sql` mudar: ele cria tabela nova e acrescenta em tabela antiga a
coluna ou o índice que faltar (nunca apaga nem altera o que já existe). Depois preenche o que for de dados
antigos (código de convite das contas; clubes, Copas, bônus e plausibilidade das carreiras salvas antes). Se a
resposta disser `"faltam"` maior que 0, rode de novo (cada chamada trabalha no máximo uns 20 s).

### 5b. Atualizar da v2 para a v3 (o site já está no ar)

1. Suba **todos** os arquivos de `servidor/api/` (os novos: `hall.php`, `conquistas.php`, `bonus.php`, `admin.php`,
   `_palavras.php`, `_contas.php`, `_carreiras.php`, `_hall.php`, `_bonus.php`; e os que mudaram: `_lib.php`,
   `_schema.sql`, `conta.php`, `carreiras.php`, `e.php`, `painel.php`, `instalar.php`, `.htaccess`) e o
   `privacidade.html`. Se for pelo `dist-site/`, o build já leva tudo.
2. **Logo em seguida**, rode o `instalar.php` (passo 5) até `"faltam": 0`. Entre o upload e o instalar as rotas novas
   respondem 500 (as colunas ainda não existem); o `GET conta.php` continua funcionando com os padrões.
3. Confira (passo 6) e abra o painel: em **Configurações** ficam o Imersivo e a Live (fechados ao público por padrão),
   o aviso no topo, a manutenção, os cadastros, os bônus e o intervalo do Hall (60 a 180 min).
4. O `hall.php` e a raridade das conquistas saem com cache público (5 min e 1 h): o CDN da Hostinger e o navegador
   podem mostrar a versão anterior por esse tempo, mesmo depois do "Atualizar Hall agora". Tirar uma carreira do
   Hall é na hora no servidor, mas quem já tinha a página guardada pode vê-la por até 5 min.
5. A versão da Nota de Legado fica em `LENDA_NOTA_VERSAO` (`_lib.php`, hoje 2) e tem de acompanhar o
   `LEGACY_VERSION` do jogo (`src/engine/legacy/score.ts`): só entram no Hall público carreiras com a nota dessa
   versão. Subiu a versão no jogo? Suba aqui no mesmo deploy.

### 6. Conferir

```sh
curl -sS https://oprojeto.online/lenda/api/conta.php            # {"usuario":null,"regras":{...},"site":{...}}
curl -sS https://oprojeto.online/lenda/api/hall.php | head -c 300   # {"atualizadoEm":"…","total":…,"itens":[…]}
curl -sS "https://oprojeto.online/lenda/api/conquistas.php?raridade=1" | head -c 200
curl -sI https://oprojeto.online/lenda/api/_lib.php | head -1   # 403 (ou 404)
curl -sI https://oprojeto.online/lenda/api/_palavras.php | head -1 # 403 (ou 404)
curl -sI https://oprojeto.online/lenda/api/_schema.sql | head -1 # 403
curl -sS https://oprojeto.online/lenda/api/admin.php?r=resumo   # 401 (sem admin)
curl -sS -H "Authorization: Bearer SEU-TOKEN" "https://oprojeto.online/lenda/api/painel.php?so=agora"
curl -sS -H "Authorization: Bearer SEU-TOKEN" "https://oprojeto.online/lenda/api/admin.php?r=resumo"
```

### 7. O painel

**https://oprojeto.online/lenda/painel/** → senha do painel. Mostra online/jogando agora (atualiza a cada
15 s), o período (hoje, 7 ou 30 dias, fuso de Brasília), gráfico por dia, funil, origens, aparelhos, horários e
a seção Contas. "Incluir robôs/testes" mostra também as sessões marcadas como robô. O cookie do painel vale 12 h.
"Sair" apaga o cookie deste navegador; para derrubar o painel em todos os navegadores (ex.: suspeita de cookie
copiado), troque a senha do painel (o hash novo na config invalida todos os cookies emitidos).

Por script: `GET /lenda/api/painel.php?de=2026-10-01&ate=2026-10-14&bots=0` com `Authorization: Bearer`.

Administração (v3): tudo o que o painel faz passa pelo `admin.php` (CONTRATO-v3 §2 e §8.7): usuários (busca,
detalhe, suspender, reativar, deslogar, renomear, excluir, dar/tirar bônus), Hall público (públicas, suspeitas,
ocultas, denunciadas; abrir, ocultar, mostrar, apagar; "Atualizar Hall agora"), denúncias, indicações,
conquistas, configurações, registro e exportar CSV. Também por script, com o Bearer (sem `Origin`):

```sh
curl -sS -H "Authorization: Bearer SEU-TOKEN" -H "Content-Type: application/json" \
  -d '{"acao":"suspender","id":12,"motivo":"Apelido ofensivo","dias":7}' https://oprojeto.online/lenda/api/admin.php
curl -sS -H "Authorization: Bearer SEU-TOKEN" "https://oprojeto.online/lenda/api/admin.php?r=exportar&tipo=usuarios" -o usuarios.csv
```

Tudo o que o admin muda (e cada exportação) fica no registro (`admin_log`, aba Registro). `GET painel.php?so=eu`
responde `{"admin":true}` para o jogo liberar o Imersivo de teste e a Live só para quem está com o painel aberto
no mesmo navegador.

## O que o servidor garante

- SQL sempre com parâmetros (PDO, prepared statements, sem emulação); transação onde há mais de uma escrita.
- Senha só como `password_hash`; nunca em log nem em resposta. Comparações de token/código/HMAC com
  `hash_equals`. Sessão nova (token novo) a cada login; redefinir senha derruba as outras sessões.
- Cookie `lenda_sessao`: 32 bytes aleatórios, só o sha256 no banco, `HttpOnly`, `Secure`, `SameSite=Lax`.
- `esqueci` sempre responde `{"ok":true}` (não revela se o e-mail existe) e manda o e-mail depois de responder.
- Escrita só com JSON e `Origin`/`Referer` do próprio site (CSRF); corpo limitado (16 KB / 600 KB).
- Limites por IP (só um HMAC diário do IP fica no banco, por até ~20 min; IPv6 pelo /64), por e-mail, por sessão
  e tetos do site inteiro (cadastros, e-mails de troca de senha, login do painel); `429` ao estourar.
- Medição: `d` de cada evento só com as chaves conhecidas do tipo (até 256 bytes); no máximo 1.500 linhas por IP a
  cada 10 min e 3.000 por sessão (o resto é descartado em silêncio, os batimentos seguem valendo).
- v3 · Público só o que pode ser: o `hall.php` mostra apelido e números das carreiras (nunca e-mail ou id de conta) e
  sai da fotografia (sem tocar nas carreiras na hora de servir); a raridade das conquistas é só contagem. Live e
  Imersivo ficam fechados ao público (`site_config`) e as carreiras do Imersivo não entram no Hall enquanto ele estiver
  fechado. `admin.php` nunca responde sem admin (cookie do painel ou Bearer); com o cookie, escrita só com `Origin`.
- v3 · Filtro de apelidos (e do nome do jogador no Hall): palavrões, ofensas raciais/homofóbicas e termos de ódio em
  pt-BR (`_palavras.php`), sem acento, sem leetspeak simples, palavra inteira, colada ou soletrada; nomes reservados
  (admin, moderador, lenda, oficial, suporte). Só letras do alfabeto latino no apelido.
- v3 · Hall: até 3 carreiras por conta, plausibilidade conferida ao salvar (suspeita fica fora até o admin liberar),
  bônus de OVR só vale se foi usado naquela carreira, 5 denúncias de contas diferentes escondem até o admin decidir.
  Tirar do Hall é na hora; entrar, na próxima fotografia (de hora em hora, ou "Atualizar Hall agora").
- v3 · Muita gente ao mesmo tempo: o Hall é servido de uma fotografia (2 consultas com índice por pedido, ~5 ms com
  6.000 carreiras), com `Cache-Control: public, max-age=300` para o CDN; a fotografia é refeita por um pedido só
  (`GET_LOCK`), sem travar quem salva carreira, e quem chega no meio lê a anterior; o primeiro pedido depois do prazo
  responde na hora e refaz depois da resposta. A raridade é recalculada no máximo 1 vez por hora. Bônus, publicar,
  denúncias e salvar travam só a linha da conta (ou da carreira): sem corrida e sem bônus em dobro. O `e.php` só faz
  trabalho a mais em envio com fim de partida e conta logada (um UPDATE e, no máximo, uma consulta).
- v3 · Exportar CSV: `;`, UTF-8 com BOM, célula de texto entre aspas e com `'` na frente se começa com `= + - @`.
- Carreiras: até 128 KB comprimida, 20 MB por conta e um limite de KB salvos por conta e por IP a cada 10 min.
- Nenhum aviso do PHP sai na resposta (`display_errors` desligado nas rotas; erro vira `500` em JSON genérico).
- Limpeza leve (1% dos pedidos): tentativas velhas, sessões e códigos vencidos, medição com mais de 13 meses.

## Teste de ponta a ponta

```sh
bash servidor/teste/rodar.sh
```

Precisa de `php` (8.1+, com `pdo_mysql` e `curl`) e do MariaDB instalados. O script:

1. reusa o MariaDB que estiver de pé em `/run/mysqld/mysqld.sock` ou sobe um só dele em
   `/tmp/lenda-teste/mariadb` (porta 8706);
2. recria o banco `lenda_teste_back_e2e` e escreve `/tmp/lenda-teste/lenda-config.php` com segredos
   aleatórios, `cookie_seguro => false` e `email_modo => 'arquivo'`;
3. monta `/tmp/lenda-teste/public_html/lenda/{api,painel,privacidade.html}` (cópia, como na hospedagem) e sobe
   `php -S 127.0.0.1:8711` (com `display_errors` ligado de propósito);
4. se houver Apache, sobe um na porta 8712 só para conferir as regras do `api/.htaccess`;
5. roda `servidor/teste/teste.php` (e, dentro dele, `teste-v3.php`): ~790 verificações por HTTP (curl) e no banco
   (PDO) — cadastro, entrar,
   sair, limites (429, inclusive os tetos do site inteiro e os diários), esqueci/redefinir com o código lido do
   arquivo de e-mail, perfil, partidas, estatísticas, vínculo do aparelho, excluir (LGPD, com o vid trocado),
   carreiras (auto/manual, lista, abrir, 404 de outra conta, apagar, 409 cheio por número e por 20 MB, 413 por
   JSON e por tamanho comprimido, KB por conta e por IP), medição (sessão, batimentos, robôs, origens, `d` só
   com as chaves de cada tipo, tetos de linhas por IP e por sessão, recusas), IP do visitante (/64 do IPv6,
   último item do cabeçalho, `ip_proxies`), painel (acesso, teto do site, cookie que cai ao trocar a senha,
   números conferidos um a um, nota fora da faixa, fuso, seção Contas, Bearer), limpeza (inclusive a das
   janelas de 10 min encerradas), carga de 100 mil eventos (< 300 ms), vazamentos (senha, aviso do PHP, IP) e o
   log do PHP; e a v3: `instalar.php` num banco da v2 (acrescenta e preenche), configuração do site (padrões,
   gravar, validação), `painel.php?so=eu`, `admin.php` sem admin (401 em tudo), filtro de apelidos (80 casos, inclusive
   os que não podem ser barrados e as conquistas do jogo), publicar (auto, manual, limite de 3, "não aparecer"),
   plausibilidade, fotografia do Hall (prazo, atualizar, trava, filtros por país e clube, abrir por id, tudo o que tem
   de sair na hora), denúncias, conquistas e raridade, indicações (recusas, validação, +2 +3 +5, limite), bônus
   (liberar após 3 partidas, usar, compartilhar 1 por dia, admin), suspensão, todas as rotas do admin, registro, CSV,
   tipos errados em todos os campos novos, carga (2.000 contas, 8.000 carreiras, 6.000 no Hall, 60 mil conquistas:
   tempos medidos e índices conferidos com EXPLAIN) e concorrência num segundo `php -S` com 4 processos (~200 pedidos
   ao mesmo tempo; "usar" e "compartilhei" em paralelo sem bônus em dobro; 5 denúncias simultâneas; fotografia
   vencida com 24 leitores);
6. termina com `PASSOU: N verificações` (código 0) ou `FALHOU` com a lista; mata pelo PID só o que subiu.

Variáveis: `LENDA_TESTE_PORTA` (8711), `LENDA_TESTE_PORTA_APACHE` (8712), `LENDA_TESTE_PORTA_PAR` (porta do
`php -S` com 4 processos; padrão `LENDA_TESTE_PORTA + 4`), `LENDA_TESTE_BANCO`, `LENDA_TESTE_BASE` (pasta de trabalho,
`/tmp/lenda-teste`; mude para rodar dois testes ao mesmo tempo), `LENDA_TESTE_SEM_CARGA=1` (pula as cargas). As
amostras de carreira (`teste/amostras/`) são `HallEntry` reais do jogo.

Medido aqui (MariaDB 10.11, `php -S`, 4 CPUs): fotografia de 6.000 carreiras (de 8.000, 2.000 contas) em ~0,6 s
(leitura ~80 ms, troca ~0,5 s); `hall.php` sem filtro, por país, por clube, os dois juntos e a última página em
4–7 ms; abrir por id ~5 ms; raridade recalculada com 60 mil conquistas ~35 ms (do cache, 3 ms); listas do admin
com 2.000 contas 8–60 ms; CSV de 2.000 contas ~40 ms; `e.php` logado ~5 ms por batimento e ~8 ms por fim de
partida; ~200 pedidos simultâneos (salvar, conquistas, compartilhar, Hall, medição, atualizar Hall) em ~3 s, sem
erro nem deadlock.

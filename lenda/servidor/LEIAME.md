# LENDA · servidor (medição + contas)

PHP 8.1+ e MySQL 8/MariaDB 10.6+, sem framework nem composer, na mesma hospedagem do jogo
(`https://oprojeto.online/lenda/`). O contrato com o jogo (rotas, campos, erros, tabelas) está em
[`CONTRATO.md`](CONTRATO.md) (medição, contas, carreiras), [`CONTRATO-v3.md`](CONTRATO-v3.md) (configuração do site,
admin, Hall público, conquistas, indicações e bônus; o §8 tem os detalhes do que foi implementado) e
[`CONTRATO-v32.md`](CONTRATO-v32.md) (o painel completo: moderação no §A; acesso, equipe, PIN, Saúde, backup e cópias
no §B).

```
servidor/
  api/            → public_html/lenda/api/      (a pasta inteira: e.php, conta.php, carreiras.php, hall.php,
                                                  conquistas.php, bonus.php, admin.php, painel.php, equipe.php,
                                                  instalar.php, os módulos _*.php — _lib, _admin, _copias, _saude,
                                                  _palavras, _contas, _carreiras, _hall, _bonus e os da moderação —,
                                                  _schema.sql e .htaccess; o lendas.php é de outro time)
  painel/         → public_html/lenda/painel/   (a pasta inteira: index.html, painel.css, nucleo.js, visao.js,
                                                  usuarios.js, moderacao.js, sistema.js, painel.js, nomes.json)
  privacidade.html→ public_html/lenda/privacidade.html
  teste/          fica no repositório (não sobe): rodar.sh (servidor) e integracao/ (jogo + servidor + painel juntos:
                  subir.sh, e2e.mjs com vários aparelhos no navegador, hall-prazo.mjs, carga.mjs, teto-cadastro.mjs)
```

Fora do `public_html`, ao lado do arquivo de config, o servidor cria sozinho a pasta `lenda-copias/` (as cópias do
banco que o painel guarda, ver §8). Ela nunca vai para o repositório.

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

A senha do painel é a **senha de emergência** do dono: ela sempre entra (sem e-mail) na conta "Dono" do painel, que o
servidor cria na primeira entrada (v3.2, §5c). Sem `admin_senha_hash` e sem nenhuma conta pessoal, o painel fica
desligado ("Painel desligado: defina a senha"); o token continua valendo. Trocar o hash na config derruba na hora
todas as sessões abertas do painel (de todo mundo da equipe).

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
  // 'email_modo' => 'mail',            // 'smtp' manda pela caixa (abaixo; menos spam); 'arquivo' grava em email_pasta (só teste)
  // 'smtp' => ['host' => 'smtp.hostinger.com', 'porta' => 587, 'usuario' => 'contato@oprojeto.online', 'senha' => 'SENHA-DA-CAIXA'],
  //                                    // com 'email_modo' => 'smtp': STARTTLS na 587 (ou 'porta' => 465, SSL), certificado conferido
  // 'ip_cabecalho' => '',              // vazio = REMOTE_ADDR; veja "IP do visitante" abaixo antes de mudar
  // 'ip_proxies' => [],                // com ip_cabecalho: só confia no cabeçalho vindo destes IPs/faixas (ex.: '10.0.0.0/8')
  // 'limpeza_a_cada' => 100,           // limpeza leve em 1 a cada N pedidos
  // 'hall_revisao_nota' => 90,         // padrão da revisão do Hall (v3.2: muda no painel, em Configurações; 101 = desligado)
  // 'painel_cache_s' => 90,            // a Visão geral do painel recalcula no máximo a cada N segundos (0 = sempre)
  // 'backup_pasta' => '/home/u785231359/domains/oprojeto.online/lenda-copias', // padrão: lenda-copias ao lado da config
  // 'copias_max' => 10,                // quantas cópias do banco ficam guardadas no servidor (1 a 30)
  // 'copias_diaria' => true,           // false = sem a cópia automática do dia
  // 'aviso_ntfy' => 'https://ntfy.sh/UM-TOPICO-SECRETO', // aviso no celular (denúncia nova, pico de online); ligue em Configurações
  // 'aviso_telegram' => ['token' => 'TOKEN-DO-BOT', 'chat' => 'ID-DO-CHAT'], // o mesmo aviso pelo Telegram
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
# {"ok":true,"comandos":18,"alteracoes":[],"tabelas":["admin_log","bonus","carreiras",...],
#  "preenchidas":{"convites":0,"carreiras":0,"resumos":0,"moderacao":0,"partidasVid":0,"faltam":0}}
```

Pode rodar de novo sempre que o `_schema.sql` mudar: ele cria tabela nova e acrescenta em tabela antiga a
coluna ou o índice que faltar (nunca apaga nem altera o que já existe). Depois preenche o que for de dados
antigos (código de convite das contas; clubes, Copas, bônus e plausibilidade das carreiras salvas antes). Se a
resposta disser `"faltam"` maior que 0, rode de novo (cada chamada trabalha no máximo uns 20 s).

### 5b. Atualizar da v2 para a v3 (o site já está no ar)

1. Suba **todos** os arquivos de `servidor/api/` (os novos: `hall.php`, `conquistas.php`, `bonus.php`, `admin.php`,
   `_palavras.php`, `_contas.php`, `_carreiras.php`, `_hall.php`, `_bonus.php`; e os que mudaram: `_lib.php`,
   `_schema.sql`, `conta.php`, `carreiras.php`, `e.php`, `painel.php`, `instalar.php`, `.htaccess`) e o
   `privacidade.html`, e a pasta `servidor/painel/` **inteira** (o painel da v3 tem 9 arquivos; subir só o
   `index.html`, o `painel.js` e o `painel.css` de antes quebra o painel). Se for pelo `dist-site/`, o build já leva
   tudo.
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
6. **v3.1 (CONTRATO-v3 §12):** suba de novo a pasta `api/` inteira (mudaram quase todos os arquivos e há colunas e
   tabelas novas: `carreiras_moderacao`, `partidas_vid`, `carreiras.resumo_hash`, `eventos.nota`) e a pasta `painel/`,
   e rode o `instalar.php` **logo em seguida** até `"faltam": 0`: até lá o `e.php` e o salvar carreira dão erro. Na
   primeira vez ele soma as partidas por aparelho a partir dos eventos (uma consulta mais pesada, de segundos).
7. **Revisão do Hall:** carreira com nota 90 ou mais entra no Hall só depois que você conferir e clicar em
   "Liberar" (painel → Hall público → **Esperando revisão**; o contador fica na aba). Para mudar o corte, ponha
   `'hall_revisao_nota' => 95` (ou 101 para desligar) na config.

### 5c. Atualizar para a v3.2 (painel completo; o site já está no ar)

1. Suba as pastas `servidor/api/` e `servidor/painel/` **inteiras** (há arquivos novos: `equipe.php`, `_admin.php`,
   `_copias.php`, `_saude.php` e os módulos da moderação; o painel tem arquivos novos também). Pelo `dist-site/`, o
   build já leva tudo. Confira que o `api/.htaccess` subiu.
2. **Logo em seguida**, rode o `instalar.php` (passo 5) até `"faltam": 0`. Ele só acrescenta: cria `admin_contas`,
   `admin_sessoes`, `admin_papeis`, `admin_recados`, `lixeira_carreiras`, `email_log` e `contas_excluidas` e as colunas novas, sem apagar
   nada. Entre o upload e o instalar, as rotas do painel que usam tabela nova respondem `503 instalar` ("rode o
   instalar.php"); o jogo continua funcionando.
3. Abra `https://oprojeto.online/lenda/painel/` e entre **com a senha de sempre** (deixe o e-mail vazio). Essa
   primeira entrada cria a conta **Dono** do painel. Os cookies antigos do painel não valem mais: todo mundo entra de
   novo uma vez.
4. **Cadastre o PIN** (segunda etapa, 6 dígitos): em Configurações → Minha conta → "Criar PIN" (o painel também mostra
   a faixa "Cadastre o seu PIN"). Ele pede a senha do arquivo de novo, o PIN e a repetição. Não vale todos iguais nem
   sequência (123456, 987654). Daí em diante, toda entrada com a senha do arquivo pede o PIN; 3 PINs errados travam a
   entrada por até 10 minutos.
5. (Opcional, recomendado) **Crie a sua conta pessoal** (Minha conta → "Criar a minha conta": e-mail, nome e uma senha
   sua, 12+ caracteres): a sessão da senha do arquivo termina e a próxima entrada é com o e-mail, que pede o PIN na
   primeira vez. A senha do arquivo continua entrando (é a de emergência, acima de todos na equipe). Faça isto **antes**
   de convidar alguém: "Criar a minha conta" só aparece enquanto não há nenhuma conta pessoal; depois, a conta Dono cria
   a sua pela aba Equipe ("Pôr alguém na equipe", papel Dono, com o seu e-mail).
6. **Equipe** (aba Equipe): convide moderadores, suporte ou leitores. O painel mostra uma senha provisória **uma vez**
   (copie e mande por um canal seguro); a pessoa troca a senha e cria o PIN no primeiro acesso. Papéis: Dono (tudo),
   Moderador (Hall e denúncias), Suporte (contas dos jogadores), Leitor (só vê), e papéis seus com os poderes que
   escolher. Ninguém mexe em quem está no mesmo nível ou acima; o último dono não sai.
7. **Esqueceu o PIN** da conta Dono: zere pelo token (a próxima entrada pede um PIN novo):

   ```sh
   # o id da conta Dono aparece na aba Equipe; na primeira instalação, costuma ser 1
   curl -sS -H "Authorization: Bearer SEU-TOKEN" -H "Content-Type: application/json" \
     -d '{"acao":"zerar_pin","adminId":1}' https://oprojeto.online/lenda/api/equipe.php
   curl -sS -H "Authorization: Bearer SEU-TOKEN" https://oprojeto.online/lenda/api/equipe.php?r=equipe   # lista a equipe (ids)
   ```

   O PIN de uma pessoa da equipe, outro dono zera na aba Equipe. Esqueceu a senha do arquivo: gere outra (§2) e troque o
   hash na config (isso também derruba todas as sessões do painel).
8. **Saúde** (aba Saúde): mostra o que falta no banco, as extensões do PHP, a config (só sim/não) e as cópias, com o
   "como resolver" de cada problema. Por script: `GET equipe.php?r=saude` com o Bearer.
9. (Opcional, recomendado) **E-mail pela caixa (SMTP)**: o `mail()` da hospedagem cai no spam com frequência. Para mandar
   os códigos de troca de senha pela caixa `contato@oprojeto.online`, ponha na config `'email_modo' => 'smtp'` e
   `'smtp' => ['host' => 'smtp.hostinger.com', 'porta' => 587, 'usuario' => 'contato@oprojeto.online', 'senha' => '<a
   senha da caixa>']` (STARTTLS na 587, ou `'porta' => 465` com SSL; o certificado do servidor é conferido). A senha
   fica só no arquivo de config (nunca no banco nem no painel). Confira mandando um código a uma conta sua (ficha da
   conta → "Mandar código de troca de senha") e em Registro → E-mails ("Como saiu: SMTP da caixa"; uma falha mostra
   o passo e o código do servidor, nunca a senha). Config incompleta aparece na Saúde como problema grave.

### 5d. Atualizar para a v3.3 (As Taças do Rei, e-mail verificado, Fale conosco, perfil público)

> **Correções da v3.3 (CONTRATO-v33 §E):** o `instalar.php` acrescenta também `carreiras.semente_em` e a tabela
> `sementes_carreira` (a semente de cada carreira do Clássico começada com a conta é sorteada pelo servidor; só a carreira
> com ela vale para desafio). Quem já rodou o instalar da v3.3 antes destas correções roda de novo (só acrescenta). O
> `dist-site/` passa a levar `dados/<versão>.json` (os dados do jogo desta versão, para a verificação por replay refazer
> as carreiras de versões antigas): suba por cima e **nunca apague a pasta `dados/` do servidor** — as versões dos deploys
> de antes ficam lá.

1. Suba a pasta `servidor/api/` **inteira** (arquivos novos: `suporte.php`, `desafios.php`, `perfil.php`, `_desafios.php`,
   `_suporte.php`; mudaram, entre outros, o `.htaccess`, o `_schema.sql` e o `instalar.php`), a pasta `servidor/painel/` e
   o `privacidade.html`. Pelo `dist-site/`, o build já leva tudo.
2. **Logo em seguida**, rode o `instalar.php` (passo 5) até `"faltam": 0`. Ele só acrescenta: `usuarios.email_verificado_em`,
   as colunas `tem_replay`, `libertadores`, `primeira_em` e `fora_desafio` das carreiras, as tabelas `verificacoes_email`,
   `partidas_dia`, `mensagens_suporte`, `desafios` e `desafio_candidatos`; preenche as Libertadores das carreiras antigas
   (lidas do HallEntry guardado) e cria os três desafios de fábrica **desativados e sem prêmio** (`tacas-do-rei`,
   `tacas-do-rei-copas` e `todas-as-conquistas`). A resposta traz `"v33": {"libertadores": N, "desafios": 3}` (na 2ª vez,
   0 e 0). Entre o upload e o instalar, o jogo continua como na v3.2 (o Fale conosco e a confirmação do e-mail respondem
   `503 indisponivel`; as abas novas do painel, `503 instalar`).
3. As contas que já existem começam com o e-mail **não confirmado**; quem se cadastra recebe o código na hora (o
   e-mail sai pelo `enviarEmail()` de sempre: com `email_modo => 'smtp'` ele vai pela caixa). Teto do site para esses
   e-mails: 200 a cada 10 min e 2.000 por dia, repartido em baldes (CONTRATO-v33 §E.8): o do cadastro (120 e 1.200, 15
   por IP e 20 por domínio a cada 10 min), o do "Reenviar código" (40 e 400) e o do "Reenviar código" de quem já jogou
   (40 e 400); acima disso o jogador pede outro depois, e o "Precisa de atenção" avisa quando um balde passa de 80%.
4. **Para ligar um desafio** (aba Desafios do painel): escreva o prêmio e confira o regulamento (o de fábrica fala dos
   requisitos; mude à vontade), marque o início se não quiser que comece na hora, e ative. Ativar avalia na hora todas as
   contas (as que já cumprem viram candidatas). A carreira só vale se entrou na conta depois do início.
5. **Quem vence:** cada candidato pendente tem o botão "Verificar no jogo" (abre o `#/verificar` no jogo, que refaz a
   carreira com o replay e manda o resultado). Só um candidato verificado, sem outro anterior esperando decisão, pode ser
   declarado vencedor; o vencedor vê um aviso em Minha conta e aparece na página do desafio. Declarou por engano:
   "Reabrir" (com o motivo). O limite de partidas por dia que contam fica em Configurações (`partidas_dia_max`, padrão 100).
6. O e-mail de contato do Fale conosco é o `email_remetente` da config (`contato@oprojeto.online`). As respostas da aba
   Mensagens saem por ele, com o registro no Registro → E-mails (tipo `suporte`).

### 6. Conferir

```sh
curl -sS https://oprojeto.online/lenda/api/conta.php            # {"usuario":null,"regras":{...},"site":{...}}
curl -sS https://oprojeto.online/lenda/api/hall.php | head -c 300   # {"atualizadoEm":"…","total":…,"itens":[…]}
curl -sS "https://oprojeto.online/lenda/api/conquistas.php?raridade=1" | head -c 200
curl -sS https://oprojeto.online/lenda/api/desafios.php        # {"desafios":[]} até ativar um desafio
curl -sS https://oprojeto.online/lenda/api/suporte.php         # {"email":"contato@oprojeto.online","tipos":[…]}
curl -sI https://oprojeto.online/lenda/api/_lib.php | head -1   # 403 (ou 404)
curl -sI https://oprojeto.online/lenda/api/_palavras.php | head -1 # 403 (ou 404)
curl -sI https://oprojeto.online/lenda/api/_schema.sql | head -1 # 403
curl -sS https://oprojeto.online/lenda/api/admin.php?r=resumo   # 401 (sem admin)
curl -sS -H "Authorization: Bearer SEU-TOKEN" "https://oprojeto.online/lenda/api/painel.php?so=agora"
curl -sS -H "Authorization: Bearer SEU-TOKEN" "https://oprojeto.online/lenda/api/admin.php?r=resumo"
curl -sS https://oprojeto.online/lenda/api/painel.php?so=modo  # {"modo":"senha"} (ou "contas" depois da conta pessoal)
curl -sI https://oprojeto.online/lenda/api/_admin.php | head -1 # 403 (ou 404)
curl -sS -H "Authorization: Bearer SEU-TOKEN" "https://oprojeto.online/lenda/api/equipe.php?r=saude" | head -c 400
# "schema":{"faltam":[]} = o banco está completo
```

### 7. O painel

**https://oprojeto.online/lenda/painel/** → senha do painel (ou e-mail + senha da sua conta) e o PIN. Mostra
online/jogando agora (atualiza a cada 15 s), o período (hoje, 7 ou 30 dias, fuso de Brasília), gráfico por dia, funil,
origens, aparelhos, horários e a seção Contas. "Incluir robôs/testes" mostra também as sessões marcadas como robô (e as
contas marcadas como teste ou oficial).

Sessões do painel (v3.2): ficam no servidor (no banco só o sha256 do token) e valem 8 h desde a entrada, caindo antes
com 2 h sem uso; o cookie é `HttpOnly` e `SameSite=Strict`, com token novo a cada etapa (senha → PIN). "Sair" encerra
esta sessão no servidor; em Minha conta há "Aparelhos com o painel aberto" (encerrar um) e "Sair de todos os outros";
trocar a senha da conta pessoal pede a atual e derruba as outras sessões. Tudo vai para o Registro (aba Registro →
Segurança): entradas, senhas e PINs errados, bloqueios, saídas e as ações recusadas por falta de poder, com quem e um
código do aparelho que muda todo dia (o IP nunca é guardado). Para derrubar o painel em todos os navegadores de uma
vez (ex.: suspeita de cookie copiado), troque a senha do painel na config.

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

### 8. Backup e cópias no servidor (v3.2)

- **Baixar backup** (Configurações → Backup, ou `GET equipe.php?r=backup` com o Bearer): um `.json.gz` com contas,
  carreiras, conquistas, indicações, bônus, denúncias, a config do site, o registro (90 dias) e a equipe (sem senha nem
  PIN). Com "incluir medição", também as visitas e os eventos de 30 dias. Ficam de fora as sessões, os códigos de troca
  de senha e o arquivo de config. **O arquivo tem os e-mails dos jogadores: guarde fora do servidor e não compartilhe.**
  Faça um antes de qualquer atualização.

  ```sh
  curl -sS -H "Authorization: Bearer SEU-TOKEN" "https://oprojeto.online/lenda/api/equipe.php?r=backup" -o lenda-backup.json.gz
  ```

- **Cópias no servidor**: o painel guarda uma por dia (na primeira vez que alguém da equipe abre o painel no dia) e
  quando você clica em "Guardar cópia agora", na pasta `lenda-copias/` **ao lado do arquivo de config, fora do
  public_html** (ou em `backup_pasta`). Ficam as 10 mais novas. Se a config estiver dentro do `public_html`, as cópias
  ficam desligadas (a Saúde avisa) — o backup para baixar continua funcionando.
- **Restaurar** (só o dono): escolha uma cópia da lista, o modo e digite RESTAURAR. "Completar" só acrescenta o que
  falta (nada é apagado); "Substituir" volta as tabelas de dados ao que está na cópia. Antes, o servidor confere o
  arquivo inteiro (estragado = nada muda) e guarda uma cópia "antes de restaurar" do estado atual (é ela que desfaz).
  A equipe volta desativada e sem senha (dê uma senha provisória na aba Equipe); o registro nunca é apagado; contas
  excluídas (pelo admin ou pelo próprio jogador) **nunca voltam**: cada exclusão deixa uma marca só com o número da conta
  (tabela `contas_excluidas`, desde a rev3) e a restauração pula a conta e tudo o que é dela. A lixeira das carreiras
  apagadas pela moderação vai no backup com a cópia restaurável (desde a rev3); restaurar um backup de antes, no modo
  "Substituir", mantém as cópias que o banco já tem. Para restaurar um backup baixado, ponha o `.json.gz` na pasta
  `lenda-copias/` pelo Gerenciador de Arquivos (o nome só com letras minúsculas, números, `.`, `-` e `_`).

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
- v3.2 · Painel: contas da equipe com senha (12+) e PIN de 6 dígitos só em hash (o do PIN com o segredo junto), a mesma
  mensagem para conta inexistente, desativada ou senha errada, limites por IP, por e-mail (5 erros em 30 min) e do
  site inteiro, PIN com 3 erros a cada 10 min, sessões no servidor revogáveis (8 h, 2 h sem uso, token novo a cada
  etapa), um mapa único ação → poder conferido no servidor em toda rota (ação esquecida = só o dono), hierarquia da
  equipe, CSRF por `Origin` + JSON + `SameSite=Strict`, e o registro de toda entrada, falha, bloqueio, saída e recusa.
  A Saúde nunca mostra segredo, valor da config ou caminho de arquivo. As cópias ficam fora do `public_html`; a
  restauração só aceita um arquivo da lista (nada de caminho vindo do pedido) e nunca devolve senha da equipe.
- v3.3 · Desafios: o prêmio é o texto que o admin escreve; os desafios nascem desativados. O servidor cria o candidato
  sozinho (ao salvar/publicar, sincronizar conquistas, confirmar o e-mail, mudar o modo do Hall, contar uma partida e
  quando o admin libera uma carreira ou ativa o desafio), só com o desafio ativo e no prazo; carreira sem replay, do
  Imersivo, de antes do início ou salva num dia acima do limite de partidas não vale. "O primeiro" é o menor `em` (hora do
  servidor com milésimos); a declaração do vencedor é uma transação com trava no desafio (duas ao mesmo tempo: uma só).
  O código de confirmação do e-mail fica só como HMAC, preso à conta e ao e-mail (24 h, 5 chutes por código). O Fale
  conosco guarda o e-mail só de quem não estava logado, tem isca para robôs e limites por IP (HMAC), por conta e do site.
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
5. roda `servidor/teste/teste.php` (e, dentro dele, `teste-v3.php`, `teste-v32-mod.php`, `teste-v32-acesso.php`,
   `teste-v32-integ.php`, `teste-v32-corr.php` e `teste-v33.php`):
   mais de 1.000 verificações por HTTP (curl) e no banco
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
   tipos errados em todos os campos novos; e as correções da v3.1 (CONTRATO-v3 §12): cópia de carreira do Hall,
   revisão das notas 90+, faixas novas e textos do resumo no filtro, letras disfarçadas (largura total, versalete,
   ø, ı, l no lugar do I), os títulos com os ~1.000 clubes do jogo, moderação que volta depois de apagar e salvar,
   denúncias de contas novas e do topo do Hall, partidas pareadas (início antes do fim, no mesmo aparelho) e a
   indicação com 3 min de jogo, tetos novos (cadastro, esqueci, painel, e.php) e o cache do painel; carga (2.000
   contas, 8.000 carreiras, 6.000 no Hall, 60 mil conquistas:
   tempos medidos e índices conferidos com EXPLAIN) e concorrência num segundo `php -S` com 4 processos (~200 pedidos
   ao mesmo tempo; "usar" e "compartilhei" em paralelo sem bônus em dobro; 5 denúncias simultâneas; fotografia
   vencida com 24 leitores); e a v3.2 do acesso (`teste-v32-acesso.php`): painel desligado, a senha de sempre criando a
   conta Dono, sessões no servidor (sair, cookie copiado, 8 h, 2 h sem uso, sair de todos, token novo a cada etapa), PIN
   (fácil, 3 erros, etapa de 10 min, zerar pelo token), conta pessoal (e-mail + senha, mensagem única, 5 erros por
   e-mail, trocar a senha), equipe (senha provisória, papéis, hierarquia, último dono), cada papel barrado em cada ação
   sem o poder dele, recados, presença, bloco Segurança, CSRF, Saúde sem segredo e com tabela faltando, backup, cópias
   (pasta, rotação, diária, caminho malicioso, pasta dentro do public_html) e restauração (completar, substituir,
   desfazer, LGPD, arquivo estragado ou forjado); e o que a integração acrescentou (`teste-v32-integ.php`): o e-mail pelo
   SMTP da caixa contra um servidor SMTP de mentira com STARTTLS de verdade (`teste/smtp-falso.php`, certificado sorteado
   na rodada: código que chega e troca a senha, senha da caixa errada, certificado que não confere, config incompleta,
   a senha nunca numa resposta), o `tipo` na ficha, o `destaque` no `hall.php?id=` e a linha "revisão" do "Precisa de
   atenção"; e a v3.3 (`teste-v33.php`, CONTRATO-v33 §A): o banco e os desafios de fábrica (instalar idempotente, as 87
   conquistas iguais às do jogo), o e-mail verificado (código no cadastro, tentativas, vencido, preso ao e-mail, limites),
   o Fale conosco (com e sem conta, isca, limites, as rotas do admin, responder por e-mail, "Precisa de atenção"), o
   limite de partidas por dia, o replay (guardado, formato e tamanho conferidos), os desafios (quem vira candidato e quem
   não: sem replay, Imersivo, sem e-mail, fora do Hall, fora do top 3, 29 partidas, limite diário, antes do início, depois
   do fim; o lote ao ativar; todas as conquistas), a verificação, o vencedor (dois candidatos ao mesmo tempo: só o
   primeiro `em` vence; quatro declarações ao mesmo tempo: uma só), reabrir, o perfil público (privado ou suspenso = 404),
   a LGPD (mensagens, candidaturas, códigos), entradas estranhas (nenhum 500) e o banco sem o instalar da v3.3; e as
   correções da v3.3 (`teste-v33-corr.php`, CONTRATO-v33 §E): o candidato conferido de novo (salvar sem cumprir, outro
   replay, verificar e declarar com a carreira de agora, critério mudado, requisitos na hora de declarar), a contagem de
   taças fora do formato, o bônus do replay, a semente sorteada pelo servidor (limite do dia, LGPD), o desafio de todas
   as conquistas sem prova, os baldes dos e-mails de confirmação e o `em` real do lote ao ativar;
6. com Chromium (`/opt/pw-browsers/...`, ou `LENDA_CHROMIUM`), roda também o teste do painel pelo navegador
   (`teste/painel/rodar.sh`: pilha própria na porta `LENDA_TESTE_PORTA + 6`, banco `<banco>_painel`);
   `LENDA_TESTE_SEM_NAVEGADOR=1` pula;
7. termina com `PASSOU: N verificações` (código 0) ou `FALHOU` com a lista; mata pelo PID só o que subiu.

Variáveis: `LENDA_TESTE_PORTA` (8711), `LENDA_TESTE_PORTA_APACHE` (8712), `LENDA_TESTE_PORTA_PAR` (porta do
`php -S` com 4 processos; padrão `LENDA_TESTE_PORTA + 4`), `LENDA_TESTE_BANCO`, `LENDA_TESTE_BASE` (pasta de trabalho,
`/tmp/lenda-teste`; mude para rodar dois testes ao mesmo tempo), `LENDA_TESTE_SEM_CARGA=1` (pula as cargas). As
amostras de carreira (`teste/amostras/`) são `HallEntry` reais do jogo.

### Integração (jogo + servidor + painel no navegador)

Em `servidor/teste/integracao/` (precisa do `npm run build:site` antes, do Chromium e do Playwright):

```sh
LENDA_INTEG_BASE=/tmp/lenda-integracao PORTA=8752 LENDA_INTEG_SOCK=/run/mysqld/mysqld.sock bash servidor/teste/integracao/subir.sh
cd servidor/teste/integracao
LENDA_INTEG_BASE=/tmp/lenda-integracao node e2e.mjs          # jogo e painel de ponta a ponta, vários aparelhos
LENDA_INTEG_BASE=/tmp/lenda-integracao node carga-painel.mjs 50   # 50 jogadores com o painel aberto pulsando
LENDA_INTEG_SOCK=/run/mysqld/mysqld.sock PORTA=8824 LENDA_ATUALIZAR_REF=<commit publicado> bash atualizar.sh   # deploy por cima do que está no ar
```

- `subir.sh`: o `dist-site/` + o servidor PHP + um banco novo (`LENDA_INTEG_SOCK` = socket do MariaDB).
- `e2e.mjs`: o jogo jogado pela tela (carreiras com sementes fixas, conta pelo convite, salvar, conquistas, bônus,
  segundo aparelho, Hall público com filtros, denúncia) e o painel novo (senha de sempre criando a conta Dono, PIN,
  "Precisa de atenção", liberar em lote, suspender e ocultar com motivo, "Fora do Hall: …" e o aviso da moderação no
  jogo, "Em revisão" das notas altas, Convide amigos, Abrir no jogo como admin, lixeira, nota interna, tester,
  configurações, CSV de contas e de relatório, Registro e Segurança, backup baixado e restaurado, moderadora sem poder
  de excluir, sessão revogada, tema claro, celular sem rolagem lateral em todas as abas). v3.3 (etapas `g`): o código
  do cadastro lido do e-mail do modo arquivo (confirmar no diálogo, "Depois", o "Confirmar" do desafio, a faixa de
  Minha conta, o reenviar do painel), Fale conosco com e sem conta e a resposta do painel por e-mail, desafio de teste
  criado e ativado no painel (os 3 de fábrica continuam fora do público), uma carreira REAL de fila
  (`scripts/gravar/filas/classico.json`, `v-otima-04`) jogada pela tela com a semente dela (`jogarFila` do `lib.mjs`)
  que cumpre o critério e vira candidata, "Verificar no jogo" que bate, HallEntry adulterada pela API (sem replay: não
  vira candidata; com replay e taças a mais: "Não bateu" e recusada), limite de partidas por dia, vencedor declarado
  (o jogo mostra; o recado do vencedor em Minha conta) e o perfil público pelo link do código.
- `carga-painel.mjs`: o `carga.mjs` (N jogadores ao mesmo tempo) com um navegador no painel, pulsando e passeando pelas
  abas: nenhum 5xx, o pulso rápido durante a carga e quanto cada pulso custa no banco (consultas e linhas lidas, antes
  e depois da carga).
- `atualizar.sh`: sobe o `servidor/` de um commit (`LENDA_ATUALIZAR_REF`, padrão `HEAD`: passe o commit que está
  publicado), cria dados pela API dele, põe os arquivos novos por cima e roda o `instalar.php` duas vezes: nenhuma linha
  antiga some nem muda (só o número do `_esquema`), a 2ª vez não altera nada, a sessão do jogador continua e o painel
  novo lê tudo. Saindo da v3.2 (`_esquema` 32), a sessão do painel continua; para a v3.3, confere também as contas de
  antes sem o e-mail confirmado, as Libertadores lidas das carreiras guardadas, os desafios de fábrica desativados, o
  Fale conosco e o perfil público da conta de antes.

Medido aqui (MariaDB 10.11, `php -S`, 4 CPUs): fotografia de 6.000 carreiras (de 8.000, 2.000 contas) em ~0,6 s
(leitura ~80 ms, troca ~0,5 s); `hall.php` sem filtro, por país, por clube, os dois juntos e a última página em
4–7 ms; abrir por id ~5 ms; raridade recalculada com 60 mil conquistas ~35 ms (do cache, 3 ms); listas do admin
com 2.000 contas 8–60 ms; CSV de 2.000 contas ~40 ms; `e.php` logado ~5 ms por batimento e ~8 ms por fim de
partida; ~200 pedidos simultâneos (salvar, conquistas, compartilhar, Hall, medição, atualizar Hall) em ~3 s, sem
erro nem deadlock.

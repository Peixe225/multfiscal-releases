# IHchat na Hostinger: passo a passo

Este guia coloca o IHchat (a central de atendimento da I&H) no ar em
**https://atendimento.oprojeto.online**, numa pasta própria
(`public_html/ihchat/`) que não mexe em nenhum outro sistema do domínio. O
subdomínio aponta para **`public_html/ihchat/public`**. No fim há o caminho
para a futura VPS (app Python com Docker, o mesmo painel).

Resumo do que o sistema tem: caixa de entrada única para WhatsApp (API
oficial da Meta, Graph API **v26.0**, ou um número comum conectado **pelo QR
Code** via Z-API ou Evolution API), Telegram, e-mail e chat do site; o **chat
da equipe** (sala Geral, salas por setor, diretas e grupos); e a marca da I&H.

## O que vai para onde

```
public_html/
└── ihchat/                  pasta do sistema (só ela é nossa)
    ├── .htaccess                  se o subdomínio apontar aqui, manda tudo para public/
    ├── app/                       código PHP (a web não alcança: .htaccess nega tudo)
    ├── public/                    RAIZ DO SUBDOMÍNIO (DocumentRoot): só estes quatro
    │   ├── index.php              entrada de todas as requisições
    │   ├── instalar.php           instalador (some depois de instalar)
    │   ├── .htaccess              https obrigatório, cabeçalhos, rotas
    │   └── .user.ini              limites do PHP: anexos de até 20 MB, erros fora da tela
    ├── web/                       painel, simulador e widget (fora do public: saem só
    │                              por /painel, /widget.js e /static/, com os cabeçalhos)
    ├── cron.php                   tarefas de cada minuto (e-mail, Telegram, limpeza)
    ├── console.php                utilitários de linha de comando
    ├── config.exemplo.php         modelo do config.php (já aponta o front em web/)
    ├── config.php                 criado pelo instalador (senha do banco, chave secreta)
    └── dados/                     criado sozinho: anexos, logs, código de instalação
```

`config.php`, `dados/` e `web/` ficam **fora** de `public/`: nem com o endereço
exato alguém baixa o config ou os dados pela internet, e o painel nunca sai
como arquivo solto (sem a proteção contra ser emoldurado por outro site).

## Antes de começar (hPanel)

1. **Versão do PHP**: Sites → oprojeto.online → Avançado → Configuração do PHP.
   Qualquer versão 8.1 ou mais nova (a conta usa 8.5). Extensões necessárias:
   `pdo_mysql`, `curl`, `mbstring`, `openssl`, `fileinfo` (e `imap`, para
   receber e-mail). Já vêm ligadas na Hostinger; confira se alguém desligou.
   Os limites vêm no `public/.user.ini` do pacote (`upload_max_filesize` 25M,
   `post_max_size` 30M, `display_errors` Off, `max_execution_time` 60). Se um
   anexo de 20 MB for recusado, ajuste esses mesmos valores nessa tela do hPanel.
2. **Banco de dados**: Bancos de dados → Gerenciamento → Criar banco.
   Anote os três valores, **com o prefixo** que a Hostinger põe na frente
   (ex.: `u123456789_ihchat`):
   - nome do banco;
   - usuário;
   - senha (use uma forte e guarde num cofre de senhas).
   O servidor é **127.0.0.1**, porta **3306** (o banco roda na mesma máquina do site).
3. **Subdomínio**: Domínios → Subdomínios → criar `atendimento` em
   `oprojeto.online`, marcando **pasta personalizada** e informando
   `public_html/ihchat/public`.
   Se o painel não aceitar a pasta `public`, aponte para
   `public_html/ihchat`: o `.htaccess` dessa pasta reescreve tudo para
   `public/` e o resto continua protegido.
4. **SSL**: Segurança → SSL → confira se `atendimento.oprojeto.online` tem o
   certificado (o gratuito é instalado sozinho em alguns minutos). O sistema
   **obriga https**: sem o certificado, o endereço não abre.

## Enviar os arquivos

Os dois caminhos dão no mesmo resultado; o primeiro faz os próximos deploys
em segundos (só o que mudou vai).

### Caminho A: script (recomendado)

No computador com o projeto, dentro de `ihchat/`:

```bash
# 1. monta dist/ihchat (sem testes, sem config, sem dados) e o .zip
../.venv/bin/python scripts/empacotar_php.py

# 2. credenciais de upload: peça ao Claude ("gere a URL de upload do
#    oprojeto.online") ou use a API da Hostinger. Elas EXPIRAM; nunca as
#    grave em arquivo do projeto.
export HOSTINGER_UPLOAD_URL='https://...'
export HOSTINGER_AUTH_KEY='...'
export HOSTINGER_REST_AUTH_KEY='...'
export HOSTINGER_SITE='oprojeto.online'   # o site de destino (identifica o que já foi enviado)

# 3. primeiro envio: também cria o código de instalação
../.venv/bin/python scripts/implantar_hostinger.py --criar-codigo
```

O script mostra **uma vez** o código de instalação. Anote: você vai digitá-lo
no passo seguinte. Ele fica só em `ihchat/dados/instalacao.codigo`, no
servidor, e é apagado quando a instalação termina.

Opções úteis: `--simular` (lista o que iria, sem enviar), `--tudo` (reenvia
tudo), `--empacotar` (empacota antes). Se a conexão cair no meio, rode de novo:
o que já chegou não é reenviado.

O script lembra, em `dist/implantado.json`, o que cada site já recebeu. A
primeira linha da saída diz qual alvo ele reconheceu e quantos arquivos já
estão registrados; "nenhum envio registrado para este alvo" num site que já
tem o sistema quer dizer que o alvo mudou (outra URL de upload sem
`HOSTINGER_SITE`): tudo é reenviado, sem prejuízo. Use sempre o mesmo
`HOSTINGER_SITE` para o mesmo site, e um diferente para cada site.

### Caminho B: Gerenciador de Arquivos

1. Rode `scripts/empacotar_php.py` e pegue `dist/ihchat-<versão>.zip`.
2. No Gerenciador de Arquivos, entre em `public_html/`, envie o zip e use
   **Extrair**: ele cria a pasta `ihchat/`. Apague o zip depois.
   Numa atualização, extrair por cima **não apaga** o que saiu do pacote:
   compare com a lista de arquivos do zip e apague à mão as sobras em
   `app/` (uma rota antiga em `app/Api/` continua sendo carregada).
3. Crie a pasta `ihchat/dados/` e, dentro dela, o arquivo
   `instalacao.codigo` com um texto aleatório de 16+ caracteres (ex.: gere uma
   senha longa no seu cofre de senhas). Esse texto é o código de instalação.

## Instalar

Abra **https://atendimento.oprojeto.online/instalar** e preencha:

- **código de instalação** (o do passo anterior);
- **banco**: MySQL, servidor `127.0.0.1`, porta `3306`, nome, usuário e senha
  do banco criado no hPanel;
- **administrador**: seu nome, e-mail (é o login) e senha forte (de 10 a 72
  caracteres, misturando três tipos entre minúsculas, maiúsculas, números e
  símbolos; letra com acento conta como 2, e tabulação ou quebra de linha não
  entram). O limite de 72 é do bcrypt, que ignoraria o resto em silêncio;
- **endereço público**: `https://atendimento.oprojeto.online` (vai nas URLs de
  webhook e no código do widget);
- **carregar exemplos**: deixe desmarcado em produção. Marcado, cria
  etiquetas, respostas rápidas e conversas fictícias na MESMA base que vai
  atender clientes, por isso tudo que abriria uma porta vem desligado:
  - a atendente de demonstração `ana@multfiscal.com.br` é criada
    **desativada** e com uma senha aleatória (a `ana12345` do repositório não
    vale aqui). Para usá-la, como administrador, no painel em **Equipe**:
    **Editar** (defina uma senha) e **Reativar**;
  - os canais de exemplo **WhatsApp, Telegram e e-mail** são criados
    **desativados**: sem credenciais, o webhook do WhatsApp aceitaria mensagens
    forjadas por qualquer pessoa. Em Canais, preencha as credenciais (no
    WhatsApp, o **App Secret**) e só então clique em **Ativar**. O chat do
    site já vem ativo.

O instalador testa a conexão, cria as tabelas, cria o administrador e um canal
"Chat do site", gera uma chave secreta aleatória, grava `config.php` com
permissão só do dono e apaga o código. A partir daí `/instalar` responde 404.

Proteções: sem o arquivo de código nada instala; código errado 10 vezes bloqueia
por 15 minutos; um banco que já tem atendentes nunca é sobrescrito.

## Cron (a cada minuto)

hPanel → Avançado → Cron Jobs → **Personalizado**, frequência "a cada minuto"
(`* * * * *`):

```
/usr/bin/php /home/u123456789/domains/oprojeto.online/public_html/ihchat/cron.php
```

(troque `u123456789` pelo usuário da conta; o caminho completo aparece no topo
do Gerenciador de Arquivos). O cron lê a caixa de e-mail, busca mensagens do
Telegram quando ele está em modo "polling" e limpa a fila de tempo real.
Webhooks (WhatsApp, Telegram em modo webhook) e o chat do site **não dependem**
do cron: chegam na hora.

## Conferir

```bash
../.venv/bin/python scripts/implantar_hostinger.py --conferir https://atendimento.oprojeto.online
```

Confere que o sistema responde, que http vai para https, que painel e widget
saem com os cabeçalhos certos, que o widget colado em `https://oprojeto.online`
consegue abrir sessão (CORS; outro site com `--origem-widget https://...`) e
que nada interno (`config.php`, `app/`, `dados/`, `cron.php`) é baixável.
Qualquer "FALHA" é para resolver antes de divulgar o endereço.

## Configurar os canais

Entre no painel (https://atendimento.oprojeto.online/painel) como
administrador → **Canais**. Cada canal mostra a sua **URL de webhook**
(`https://atendimento.oprojeto.online/webhooks/<id>`) e tem o botão **Testar**.

**Quem atende aparece para o cliente.** Cada atendente precisa de nome e
**setor**: cada um ajusta o setor em **Perfil** (canto superior do painel), e
o administrador cadastra a equipe em **Equipe** (ao lado de Canais): nome,
e-mail (o login), senha (de 6 caracteres a 72 bytes), papel e setor. Quem sai
é **desativado**, não apagado: não entra mais e o histórico continua dizendo
quem respondeu. Cada resposta leva a assinatura de quem a enviou,
gravada no momento do envio (o histórico continua certo mesmo se a pessoa
mudar de nome ou de setor depois). O cliente vê assim:

| Canal | Como aparece |
|---|---|
| WhatsApp (oficial ou QR Code) | primeira linha em negrito: **Ana · Suporte técnico** |
| Telegram | primeira linha: Ana · Suporte técnico |
| E-mail | no fim, como assinatura (`-- `, nome e setor) |
| Chat do site | nome e setor acima da resposta, no balão |

### Chat do site (webchat)

Já vem criado. Cole no site, antes de `</body>`:

```html
<script src="https://atendimento.oprojeto.online/widget.js"
        data-chave="wc_... (a chave pública do canal, na tela de Canais)"
        data-titulo="Suporte"></script>
```

O visitante escreve pelo balão; a conversa aparece no painel na hora e a
resposta volta para o balão em até ~2 segundos (na hospedagem compartilhada o
tempo real é por consulta; na VPS, instantâneo).

### WhatsApp (API oficial da Meta, Cloud API)

1. Em developers.facebook.com, crie um app do tipo **Empresa** e adicione o
   produto **WhatsApp**. Vincule o número (ele não pode estar em uso no
   aplicativo do WhatsApp).
2. No painel do IHchat, crie o canal WhatsApp com:
   - **Token de acesso permanente** (usuário do sistema no Business Manager;
     o token temporário de 24 h serve só para teste);
   - **ID do número de telefone** ("Phone number ID", não o número);
   - **Token de verificação**: qualquer texto que você inventar;
   - **App Secret** (Configurações do app → Básico): com ele o sistema recusa
     webhooks falsificados.
3. Na Meta: WhatsApp → Configuração → Webhook → **URL de retorno** = a URL de
   webhook do canal; **token de verificação** = o mesmo do passo 2. Assine o
   campo **messages**.
4. Clique em **Testar** no painel e mande uma mensagem para o número.

A Meta só deixa a empresa iniciar conversa com modelo aprovado; responder a
quem escreveu é livre por 24 horas depois da última mensagem do cliente.

O IHchat chama a Graph API **v26.0** (constante `VERSAO_API` em
`app/Canais/AdaptadorWhatsApp.php`). A v20.0 de versões antigas já saiu do ar;
se a Meta anunciar o fim da v26.0, troque só essa constante (e a do Python).

### WhatsApp pelo QR Code (Z-API ou Evolution API)

Um número de WhatsApp comum (o do celular da empresa), conectado lendo um QR
Code como no WhatsApp Web. A hospedagem compartilhada não mantém a sessão do
WhatsApp ligada, então ela fica num **provedor online** e o IHchat conversa
com ele (detalhes técnicos em `app/Canais/PROVEDORES-WHATSAPP.md`, no
repositório).

**Custos** (consultados em setembro de 2026; confira antes de contratar):

- **Z-API** (serviço hospedado, brasileiro): R$ 99,99 por mês por número
  (instância), mensagens ilimitadas, 2 dias grátis para testar sem cartão.
  Planos Partner com preço menor por instância para volume.
- **Evolution API v2** (software livre): gratuita, mas precisa de um servidor
  seu com https (uma VPS pequena com Docker e banco PostgreSQL ou MySQL) e de
  alguém para mantê-lo atualizado. Na hospedagem compartilhada ela **não roda**.

**Riscos:**

- **Não é oficial.** O WhatsApp pode **banir o número**, principalmente com
  envio em massa, contatos que não pediram mensagem ou muitas denúncias. Use
  para responder a quem escreveu; para campanha, use a API oficial.
- **O celular tem de continuar conectado.** Se ele sair de "Aparelhos
  conectados" (troca de aparelho, reinstalação, dias sem internet), as
  mensagens param. O painel marca o canal como **desconectado** na barra
  lateral e avisa no campo de resposta; o admin lê o QR Code de novo.
- **Um terceiro no caminho**: as mensagens passam pela Z-API (as mídias ficam
  30 dias lá) ou pelo seu servidor Evolution.
- O que for respondido **direto no celular** aparece no histórico com o selo
  "Enviada pelo celular" (não é reenviado nem leva assinatura).

**Passo a passo com a Z-API:**

1. Crie a conta em z-api.io e uma instância. Anote o **ID da instância**, o
   **token da instância** e, se ativou em Segurança, o **Client-Token**.
2. No painel do IHchat (admin): **Canais → Novo canal → WhatsApp (QR Code)**,
   provedor **Z-API**, preencha os campos e salve.
3. **Conectar pelo QR Code**: no celular, WhatsApp → **Aparelhos conectados**
   → **Conectar aparelho**, e aponte para o código na tela (ele se renova a
   cada ~15 s). Quando conectar, o painel mostra o número.
4. **Conectar webhook**: o IHchat cadastra na Z-API o endereço
   `https://atendimento.oprojeto.online/webhooks/<id>?token=<segredo>`. Exige
   o **endereço público** (`url_publica`) com https no `config.php`, que o
   instalador já grava.
5. **Testar conexão** e mande uma mensagem de outro celular para o número.

**Passo a passo com a Evolution API:**

1. Na sua VPS, suba a Evolution API v2 (Docker) com https e anote a
   `AUTHENTICATION_API_KEY` (a chave global; é ela que cria a instância).
2. No IHchat: **Canais → Novo canal → WhatsApp (QR Code)**, provedor
   **Evolution**: endereço do servidor (`https://...`), API key e um nome para
   a instância.
3. **Conectar pelo QR Code**: o IHchat cria a instância nessa hora (já com o
   webhook) e mostra o código para ler no celular.
4. **Conectar webhook** (numa instância criada antes, use **Reconectar
   webhook**) e **Testar conexão**.

O cliente que já falou pela API oficial é reconhecido pelo telefone: mesmo
contato, mesmo histórico.

### Telegram

1. No Telegram, fale com **@BotFather**, envie `/newbot` e copie o token.
2. No painel, crie o canal Telegram com o token. Com o endereço https, o modo
   padrão é **webhook**: clique em **Conectar webhook** (o sistema faz o
   `setWebhook` com a URL e um segredo próprios).
3. Mande uma mensagem para o bot. (O modo "polling" também funciona, via cron,
   com até 1 minuto de atraso.)

### Chat da equipe

Não tem configuração: depois de instalar (ou atualizar), o botão **Chat da
equipe** aparece no topo do painel para todo atendente. A sala **Geral** e as
salas de **setor** se montam sozinhas a partir do cadastro em **Equipe** (quem
muda de setor ou é desativado ganha ou perde a sala na hora); diretas e grupos
cada um cria. As tabelas entram pela migração automática na primeira
requisição depois da atualização. Os eventos do chat só chegam a quem é
membro da sala. Na conversa de um cliente, **Compartilhar com a equipe** manda
um cartão dela para uma sala; o cartão abre a conversa.

### E-mail (caixa da Hostinger)

Crie a caixa (ex.: `suporte@oprojeto.online`) em hPanel → E-mails e, no canal
E-mail: remetente `Suporte <suporte@oprojeto.online>`, SMTP
`smtp.hostinger.com` porta `465` (ou `587`), IMAP `imap.hostinger.com`, usuário
= o endereço, senha = a da caixa. O cron lê a caixa a cada minuto.

## Atualizações

```bash
../.venv/bin/python scripts/implantar_hostinger.py --empacotar
```

Só os arquivos alterados sobem, um de cada vez, nesta ordem: a camada de
banco e as migrações (`app/Banco/`), o resto do código, o front e por último
`.htaccess`, `instalar.php` e `index.php`. As migrações chegam antes do código
que usa as colunas novas, e a primeira requisição depois delas as aplica, com
trava para duas requisições não migrarem juntas (`php console.php esquema`
força pelo terminal SSH, se houver). Durante os segundos do envio o sistema
roda com arquivos novos e velhos misturados: a API de upload não tem troca de
uma vez só. A ordem diminui essa janela, mas não a elimina; prefira atualizar
fora do horário de atendimento.

A API de upload não apaga arquivos. Quando um arquivo sai do pacote, o script
mostra "no servidor e fora do pacote" **em todo envio** (também no `--simular`
e no `--tudo`) até você apagá-lo pelo Gerenciador de Arquivos e confirmar:

```bash
../.venv/bin/python scripts/implantar_hostinger.py --ja-apaguei app/Api/Antiga.php
../.venv/bin/python scripts/implantar_hostinger.py --limpar-removidos   # apaguei todos da lista
```

Os marcados como "rota carregada sozinha", "migração aplicada sozinha" ou
"tarefa que o cron roda" são urgentes: o sistema continua executando esses
arquivos, e um deles quebrado derruba a API inteira.

## Cópias de segurança

- **Banco**: hPanel → Bancos de dados → phpMyAdmin → Exportar (ou os backups
  automáticos da Hostinger, que incluem o banco).
- **Arquivos**: `ihchat/config.php` (guarde num cofre de senhas ou numa
  pasta fora do projeto: tem a senha do banco e a chave secreta. O empacotador
  deixa de fora `config.php` e `config.*.php` e recusa o pacote se achar uma
  chave secreta de verdade em qualquer arquivo, mas não guarde cópias em `php/`)
  e `ihchat/dados/anexos/`.

## Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| `{"detail": "servidor não configurado..."}` (503) | Ainda não instalado: abra `/instalar`. |
| `/instalar` diz "instalação bloqueada" | Falta `ihchat/dados/instalacao.codigo` (16+ caracteres). |
| `/instalar` responde 404 | Já está instalado. Para reinstalar do zero: apague `config.php` e use um banco vazio. |
| "muitas tentativas" | 10 códigos errados: espere 15 minutos. |
| Erro 500 | Detalhes em `ihchat/dados/logs/ihchat-<data>.log`. |
| Esqueci a senha do admin | Com SSH: `php console.php hash-senha` (digite a nova senha) e grave o resultado em `atendentes.senha_hash` pelo phpMyAdmin. |
| Perdi o `config.php` | Copie `ihchat/config.exemplo.php` para `ihchat/config.php` e troque os dados do banco (`dsn`, `usuario`, `senha`), a `chave_secreta` (64 caracteres aleatórios: `php -r "echo bin2hex(random_bytes(32));"`; uma chave nova só desloga todo mundo) e a `url_publica`. Mantenha a linha `'pasta_web' => __DIR__ . '/web'`: sem ela, painel e widget respondem 404. |
| `/painel` e `/widget.js` dão 404, `/saude` funciona | O `config.php` não aponta o front: acrescente `'pasta_web' => __DIR__ . '/web',` antes do `];` final. |
| WhatsApp não recebe | Canal **ativo** (o de exemplo vem desativado; entregas a canal desativado dão 409), URL e token de verificação iguais nos dois lados, campo "messages" assinado, App Secret certo (assinatura inválida é recusada). |
| WhatsApp (QR Code) "desconectado" | O celular saiu de "Aparelhos conectados": em Canais, **Conectar pelo QR Code** e leia de novo. |
| WhatsApp (QR Code) conecta mas não recebe | Falta o webhook: **Conectar webhook** (precisa de `url_publica` com https). Se o endereço público mudou, o teste avisa: use **Reconectar webhook**. |
| QR Code não aparece (Z-API) | Aparelho com Chave de Acesso: conclua a conexão no painel da Z-API. |
| QR Code não aparece (Evolution) | A API key precisa ser a global (`AUTHENTICATION_API_KEY`) para criar a instância; com o token de uma instância, crie-a no painel da Evolution. |

## Futuro: VPS com o app Python

O mesmo painel e o mesmo contrato de API rodam no app Python
(`ihchat/app`, FastAPI), com tempo real por stream (instantâneo) e sem
limite de processo longo.

1. Na VPS (Ubuntu), instale o Docker e copie a pasta `ihchat/`.
2. Crie `ihchat/.env` com:
   - `IHCHAT_MODO_SANDBOX=0` e `IHCHAT_DEMO=0`;
   - `IHCHAT_SENHA_ADMIN=<senha forte>`;
   - `IHCHAT_ORIGENS_PERMITIDAS=["https://oprojeto.online","https://www.oprojeto.online"]`
     (os sites onde o widget está colado; `["*"]` libera qualquer site, como
     na Hostinger). **Sem essa linha o widget para**: a imagem Docker vem com
     `IHCHAT_ORIGENS_PERMITIDAS=[]`, e o navegador bloqueia o balão em
     oprojeto.online (CORS) — ele aparece, mas não abre conversa;
   - `IHCHAT_CHAVE_SECRETA`: **só** se for levar o banco da Hostinger junto,
     com a mesma `chave_secreta` do config.php (ninguém precisa entrar de
     novo). Com base nova, **não** defina: o container gera uma chave nova e
     a guarda no volume. Reusar a chave com base nova deixaria um login ainda
     válido da Hostinger (o token assina só o id do atendente) entrar na VPS
     como quem tiver o mesmo id na base nova — um atendente virando administrador.
   O banco padrão é SQLite no volume; `IHCHAT_BANCO_URL` aceita PostgreSQL.
3. `IHCHAT_DEMO=0 docker compose up -d --build` (sobe em 127.0.0.1:8000; com
   `IHCHAT_DEMO=0` o seed roda com `--producao` e não cria a atendente de exemplo
   `ana@multfiscal.com.br`, de senha pública) e, **antes** de pôr o proxy https
   na frente (Caddy ou Nginx + Let's Encrypt), feche o login de fábrica: o
   administrador é `admin@multfiscal.com.br` com a `IHCHAT_SENHA_ADMIN`. Numa base
   migrada da hospedagem nada disso roda (o seed não mexe em base existente).
   Pelo túnel SSH (`ssh -L 8000:127.0.0.1:8000 vps`), em http://localhost:8000/painel:
   - entre como `admin@multfiscal.com.br` com a `IHCHAT_SENHA_ADMIN`;
   - em **Equipe**, cadastre o seu administrador (papel Administrador) e entre com ele;
   - em **Equipe**, desative o admin de fábrica (e a Ana, se a base foi criada
     com `IHCHAT_DEMO=1`);
   - em Canais, desative o WhatsApp de exemplo até preencher o App Secret
     (sem ele, o webhook aceita mensagem forjada).
4. Aponte o DNS de `atendimento` para a VPS e troque as URLs de webhook só se
   o endereço mudar (se continuar o mesmo, nada muda na Meta nem no Telegram).
5. Confira: `scripts/implantar_hostinger.py --conferir https://atendimento.oprojeto.online`
   (inclui o CORS do widget colado em oprojeto.online).

Para levar os dados da Hostinger: exporte o banco pelo phpMyAdmin. As tabelas
têm os mesmos nomes e colunas nos dois lados, mas o app Python ainda precisa de
dois ajustes antes dessa migração: um caminho de importação do MySQL (driver
MySQL ou conversão para SQLite/PostgreSQL) e aceitar os hashes de senha `$2y$`
gerados pelo PHP. Estão registrados como pendências do projeto; até lá, a VPS
começa com base nova.

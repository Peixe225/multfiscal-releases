# OmniChannel 2 na Hostinger: passo a passo

Este guia coloca o OmniChannel 2 no ar em **https://atendimento.oprojeto.online**,
numa pasta própria (`public_html/omnichannel2/`) que não mexe em nenhum outro
sistema do domínio. No fim há o caminho para a futura VPS (app Python com
Docker, o mesmo painel).

## O que vai para onde

```
public_html/
└── omnichannel2/                  pasta do sistema (só ela é nossa)
    ├── .htaccess                  se o subdomínio apontar aqui, manda tudo para public/
    ├── app/                       código PHP (a web não alcança: .htaccess nega tudo)
    ├── public/                    RAIZ DO SUBDOMÍNIO (DocumentRoot)
    │   ├── index.php              entrada de todas as requisições
    │   ├── instalar.php           instalador (some depois de instalar)
    │   ├── .htaccess              https obrigatório, cabeçalhos, rotas
    │   └── web/                   painel, simulador e widget
    ├── cron.php                   tarefas de cada minuto (e-mail, Telegram, limpeza)
    ├── console.php                utilitários de linha de comando
    ├── config.php                 criado pelo instalador (senha do banco, chave secreta)
    └── dados/                     criado sozinho: anexos, logs, código de instalação
```

`config.php` e `dados/` ficam **fora** de `public/`: nem com o endereço exato
alguém os baixa pela internet.

## Antes de começar (hPanel)

1. **Versão do PHP**: Sites → oprojeto.online → Avançado → Configuração do PHP.
   Qualquer versão 8.1 ou mais nova (a conta usa 8.5). Extensões necessárias:
   `pdo_mysql`, `curl`, `mbstring`, `openssl`, `fileinfo` (e `imap`, para
   receber e-mail). Já vêm ligadas na Hostinger; confira se alguém desligou.
2. **Banco de dados**: Bancos de dados → Gerenciamento → Criar banco.
   Anote os três valores, **com o prefixo** que a Hostinger põe na frente
   (ex.: `u123456789_omni`):
   - nome do banco;
   - usuário;
   - senha (use uma forte e guarde num cofre de senhas).
   O servidor é **127.0.0.1**, porta **3306** (o banco roda na mesma máquina do site).
3. **Subdomínio**: Domínios → Subdomínios → criar `atendimento` em
   `oprojeto.online`, marcando **pasta personalizada** e informando
   `public_html/omnichannel2/public`.
   Se o painel não aceitar a pasta `public`, aponte para
   `public_html/omnichannel2`: o `.htaccess` dessa pasta reescreve tudo para
   `public/` e o resto continua protegido.
4. **SSL**: Segurança → SSL → confira se `atendimento.oprojeto.online` tem o
   certificado (o gratuito é instalado sozinho em alguns minutos). O sistema
   **obriga https**: sem o certificado, o endereço não abre.

## Enviar os arquivos

Os dois caminhos dão no mesmo resultado; o primeiro faz os próximos deploys
em segundos (só o que mudou vai).

### Caminho A: script (recomendado)

No computador com o projeto, dentro de `omnichannel/`:

```bash
# 1. monta dist/omnichannel2 (sem testes, sem config, sem dados) e o .zip
../.venv/bin/python scripts/empacotar_php.py

# 2. credenciais de upload: peça ao Claude ("gere a URL de upload do
#    oprojeto.online") ou use a API da Hostinger. Elas EXPIRAM; nunca as
#    grave em arquivo do projeto.
export HOSTINGER_UPLOAD_URL='https://...'
export HOSTINGER_AUTH_KEY='...'
export HOSTINGER_REST_AUTH_KEY='...'

# 3. primeiro envio: também cria o código de instalação
../.venv/bin/python scripts/implantar_hostinger.py --criar-codigo
```

O script mostra **uma vez** o código de instalação. Anote: você vai digitá-lo
no passo seguinte. Ele fica só em `omnichannel2/dados/instalacao.codigo`, no
servidor, e é apagado quando a instalação termina.

Opções úteis: `--simular` (lista o que iria, sem enviar), `--tudo` (reenvia
tudo), `--empacotar` (empacota antes). Se a conexão cair no meio, rode de novo:
o que já chegou não é reenviado.

### Caminho B: Gerenciador de Arquivos

1. Rode `scripts/empacotar_php.py` e pegue `dist/omnichannel2-<versão>.zip`.
2. No Gerenciador de Arquivos, entre em `public_html/`, envie o zip e use
   **Extrair**: ele cria a pasta `omnichannel2/`. Apague o zip depois.
3. Crie a pasta `omnichannel2/dados/` e, dentro dela, o arquivo
   `instalacao.codigo` com um texto aleatório de 16+ caracteres (ex.: gere uma
   senha longa no seu cofre de senhas). Esse texto é o código de instalação.

## Instalar

Abra **https://atendimento.oprojeto.online/instalar** e preencha:

- **código de instalação** (o do passo anterior);
- **banco**: MySQL, servidor `127.0.0.1`, porta `3306`, nome, usuário e senha
  do banco criado no hPanel;
- **administrador**: seu nome, e-mail (é o login) e senha forte (10+
  caracteres, misturando três tipos entre minúsculas, maiúsculas, números e
  símbolos);
- **endereço público**: `https://atendimento.oprojeto.online` (vai nas URLs de
  webhook e no código do widget);
- **carregar exemplos**: deixe desmarcado em produção. Marcado, cria dados
  fictícios e a atendente de demonstração `ana@multfiscal.com.br` com a senha
  pública `ana12345` (desative-a antes de atender clientes reais:
  `PATCH /api/atendentes/<id>` com `{"ativo": false}`, como administrador).

O instalador testa a conexão, cria as tabelas, cria o administrador e um canal
"Chat do site", gera uma chave secreta aleatória, grava `config.php` com
permissão só do dono e apaga o código. A partir daí `/instalar` responde 404.

Proteções: sem o arquivo de código nada instala; código errado 10 vezes bloqueia
por 15 minutos; um banco que já tem atendentes nunca é sobrescrito.

## Cron (a cada minuto)

hPanel → Avançado → Cron Jobs → **Personalizado**, frequência "a cada minuto"
(`* * * * *`):

```
/usr/bin/php /home/u123456789/domains/oprojeto.online/public_html/omnichannel2/cron.php
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
saem com os cabeçalhos certos e que nada interno (`config.php`, `app/`,
`dados/`, `cron.php`) é baixável. Qualquer "FALHA" é para resolver antes de
divulgar o endereço.

## Configurar os canais

Entre no painel (https://atendimento.oprojeto.online/painel) como
administrador → **Canais**. Cada canal mostra a sua **URL de webhook**
(`https://atendimento.oprojeto.online/webhooks/<id>`) e tem o botão **Testar**.

**Quem atende aparece para o cliente.** Cada atendente precisa de nome e
**setor**: cada um ajusta o setor em **Perfil** (canto superior do painel). O
painel ainda não tem tela para o administrador cadastrar atendentes; até ela
chegar, o cadastro é pela API (`POST /api/atendentes` com
`{"nome", "email", "senha", "papel": "atendente", "setor"}`, logado como
administrador). Cada resposta leva a assinatura de quem a enviou,
gravada no momento do envio (o histórico continua certo mesmo se a pessoa
mudar de nome ou de setor depois). O cliente vê assim:

| Canal | Como aparece |
|---|---|
| WhatsApp | primeira linha em negrito: **Ana · Suporte técnico** |
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
2. No painel do OmniChannel, crie o canal WhatsApp com:
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

### Telegram

1. No Telegram, fale com **@BotFather**, envie `/newbot` e copie o token.
2. No painel, crie o canal Telegram com o token. Com o endereço https, o modo
   padrão é **webhook**: clique em **Conectar webhook** (o sistema faz o
   `setWebhook` com a URL e um segredo próprios).
3. Mande uma mensagem para o bot. (O modo "polling" também funciona, via cron,
   com até 1 minuto de atraso.)

### E-mail (caixa da Hostinger)

Crie a caixa (ex.: `suporte@oprojeto.online`) em hPanel → E-mails e, no canal
E-mail: remetente `Suporte <suporte@oprojeto.online>`, SMTP
`smtp.hostinger.com` porta `465` (ou `587`), IMAP `imap.hostinger.com`, usuário
= o endereço, senha = a da caixa. O cron lê a caixa a cada minuto.

## Atualizações

```bash
../.venv/bin/python scripts/implantar_hostinger.py --empacotar
```

Só os arquivos alterados sobem, com o `index.php` por último (o sistema nunca
roda meia versão nova). Mudanças no banco (migrações) são aplicadas sozinhas na
primeira requisição depois do envio, com trava para duas requisições não
migrarem juntas; `php console.php esquema` força pelo terminal SSH, se houver.

A API de upload não apaga arquivos: quando um arquivo sai do pacote, o script
lista "no servidor e fora do pacote" e você apaga pelo Gerenciador de Arquivos
(importante para arquivos de `app/Api/`, que o sistema carrega sozinho).

## Cópias de segurança

- **Banco**: hPanel → Bancos de dados → phpMyAdmin → Exportar (ou os backups
  automáticos da Hostinger, que incluem o banco).
- **Arquivos**: `omnichannel2/config.php` (guarde em lugar seguro: tem a senha
  do banco e a chave secreta) e `omnichannel2/dados/anexos/`.

## Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| `{"detail": "servidor não configurado..."}` (503) | Ainda não instalado: abra `/instalar`. |
| `/instalar` diz "instalação bloqueada" | Falta `omnichannel2/dados/instalacao.codigo` (16+ caracteres). |
| `/instalar` responde 404 | Já está instalado. Para reinstalar do zero: apague `config.php` e use um banco vazio. |
| "muitas tentativas" | 10 códigos errados: espere 15 minutos. |
| Erro 500 | Detalhes em `omnichannel2/dados/logs/omnichannel-<data>.log`. |
| Esqueci a senha do admin | Com SSH: `php console.php hash-senha` (digite a nova senha) e grave o resultado em `atendentes.senha_hash` pelo phpMyAdmin. |
| Perdi o `config.php` | Refaça a partir de `config.exemplo.php` com os dados do banco; uma chave secreta nova só desloga todo mundo. |
| WhatsApp não recebe | URL e token de verificação iguais nos dois lados, campo "messages" assinado, App Secret certo (assinatura inválida é recusada). |

## Futuro: VPS com o app Python

O mesmo painel e o mesmo contrato de API rodam no app Python
(`omnichannel/app`, FastAPI), com tempo real por stream (instantâneo) e sem
limite de processo longo.

1. Na VPS (Ubuntu), instale o Docker e copie a pasta `omnichannel/`.
2. Crie `omnichannel/.env` com `OMNI_CHAVE_SECRETA` (use **a mesma
   `chave_secreta` do config.php**: ninguém precisa entrar de novo),
   `OMNI_MODO_SANDBOX=0`, `OMNI_DEMO=0` e `OMNI_SENHA_ADMIN` (senha forte).
   O banco padrão é SQLite no volume; `OMNI_BANCO_URL` aceita PostgreSQL.
3. `docker compose up -d --build` (sobe em 127.0.0.1:8000) e ponha um proxy
   reverso com https na frente (Caddy ou Nginx + Let's Encrypt).
4. Aponte o DNS de `atendimento` para a VPS e troque as URLs de webhook só se
   o endereço mudar (se continuar o mesmo, nada muda na Meta nem no Telegram).

Para levar os dados da Hostinger: exporte o banco pelo phpMyAdmin. As tabelas
têm os mesmos nomes e colunas nos dois lados, mas o app Python ainda precisa de
dois ajustes antes dessa migração: um caminho de importação do MySQL (driver
MySQL ou conversão para SQLite/PostgreSQL) e aceitar os hashes de senha `$2y$`
gerados pelo PHP. Estão registrados como pendências do projeto; até lá, a VPS
começa com base nova.

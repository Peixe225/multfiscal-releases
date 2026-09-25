<picture>
  <source media="(prefers-color-scheme: dark)" srcset="app/web/marca/ih.svg">
  <img src="app/web/marca/ih-fundo-claro.svg" alt="I&H" width="56">
</picture>

# IHchat

A central de atendimento da **I&H**: WhatsApp (API oficial ou pelo QR Code),
Telegram, e-mail e webchat numa única caixa de entrada, com a ficha do cliente
sempre do lado da conversa, e um chat interno para a equipe conversar sem
misturar com os clientes.

Produção: **https://atendimento.oprojeto.online** (hospedagem compartilhada
Hostinger, backend PHP em `php/`). O passo a passo de implantação está em
[`php/LEIAME-IMPLANTACAO.md`](php/LEIAME-IMPLANTACAO.md).

A promessa é simples: **um cliente, um histórico**. Se o mesmo contato pergunta
pelo WhatsApp hoje e manda um e-mail amanhã, o atendente vê as duas coisas na
mesma ficha, não em dois sistemas.

---

## Dois backends, um contrato

| Onde | Backend | Tempo real |
|---|---|---|
| Hostinger (hoje) | PHP 8.1+ com PDO/MySQL, em `php/` (arquitetura em [`php/ARQUITETURA.md`](php/ARQUITETURA.md)) | consulta a `/api/eventos/desde` a cada ~2 s |
| VPS (futuro) | Python/FastAPI, em `app/` (a referência) | stream SSE, instantâneo |

O front (`app/web/`: painel, simulador, widget) é **um só** e fala o mesmo
contrato HTTP com os dois. A suíte `contrato/` roda os MESMOS testes contra os
dois servidores; toda regra nova entra nos dois backends com teste de contrato
nos dois alvos.

**Na Hostinger** o sistema mora numa pasta própria, `public_html/ihchat/`,
que não mexe em nada do resto do domínio. O subdomínio `atendimento` aponta
para **`public_html/ihchat/public`** (só a entrada `index.php`, o instalador e
os ajustes do servidor ficam ali); código, `config.php`, dados e front ficam
um nível acima, fora do alcance da web. O pacote sai de
`scripts/empacotar_php.py` (em `dist/ihchat`) e sobe com
`scripts/implantar_hostinger.py`.

---

## Como rodar

```bash
cd ihchat
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt

cp .env.example .env          # ajuste IHCHAT_CHAVE_SECRETA
python -m scripts.seed --demo # cria usuários, canais e conversas de exemplo
uvicorn app.main:app --reload
```

Depois abra:

| Endereço | O que é |
|---|---|
| `http://localhost:8000/painel` | painel do atendente |
| `http://localhost:8000/widget/demo` | página de teste do webchat |
| `http://localhost:8000/docs` | documentação interativa da API |

O `seed` imprime o login do administrador, o do atendente de exemplo e a chave
pública do canal de webchat.

### Modo sandbox

Sem credenciais de provedor, o envio **não falha**: a mensagem é gravada com
status `simulada` e o painel avisa. Dá para percorrer o produto inteiro — receber,
distribuir, responder, etiquetar, resolver, medir — antes de contratar
qualquer API. Em produção, desligue com `IHCHAT_MODO_SANDBOX=false`, para que uma
credencial faltando apareça como erro em vez de mensagem que ninguém recebeu.

---

## Como funciona

```
  WhatsApp (Meta) ─┐
  WhatsApp (QR)   ─┤   webhook / IMAP        ┌── painel do atendente (SSE ou consulta)
  Telegram        ─┼──► adaptador de canal ──┤
  E-mail          ─┤         │               └── widget no site do cliente
  Webchat         ─┘         ▼
                   contato unificado ──► conversa ──► mensagens
```

**Adaptador de canal** (`app/canais/`) — cada provedor traduz o formato dele
para `MensagemRecebida` e sabe enviar uma resposta. Nada fora dessa pasta
conhece detalhes de WhatsApp ou de IMAP; acrescentar Instagram ou SMS é
escrever uma classe nova e registrá-la em `registro.py`.

**Identidade unificada** (`app/servicos/contatos.py`) — a identificação externa
(número, `chat_id`, endereço de e-mail) vive em `ContatoIdentidade`, não no
contato. Quando alguém escreve de um canal novo, o sistema procura primeiro a
identidade; depois tenta reconhecer pelo telefone ou pelo e-mail que já estão na
ficha. Duplicatas que escaparem podem ser juntadas com
`POST /api/contatos/{id}/mesclar/{outro_id}`, sem perder conversa nenhuma.

**Conversa** (`app/servicos/conversas.py`) — uma por contato e canal. Uma
resolvida há pouco tempo é *reaberta* em vez de duplicada: quem responde
"obrigado" cinco minutos depois não deve virar um atendimento novo
(`IHCHAT_HORAS_REABERTURA`). Conversas novas são distribuídas para o atendente
disponível com a menor fila.

**Anexos** (`app/armazenamento.py`, `app/servicos/anexos.py`) — imagem e
documento entram e saem por todos os canais. O que chega é baixado do provedor
e guardado; o que sai é guardado antes de subir, para que um envio que falha
possa ser repetido sem reenviar o arquivo. Quando o download no provedor falha,
o anexo fica registrado com o erro: o atendente precisa saber que veio um
arquivo mesmo quando não foi possível buscá-lo. O nome do arquivo nunca vira
caminho — a chave de armazenamento é gerada pelo sistema.

**Tempo real** (`app/eventos.py`) — os eventos são publicados *depois* do
commit, para que o painel nunca receba um evento cujo dado ainda não está no
banco. A entrega passa por `call_soon_threadsafe` porque as rotas são síncronas
e os assinantes SSE são corrotinas. Todo evento também vai para a tabela
`fila_eventos`, que é o que a hospedagem entrega por consulta
(`/api/eventos/desde`).

Quem recebe o quê:

| Evento | Para quem |
|---|---|
| `mensagem.nova`, `mensagem.status`, `conversa.atualizada` | todo atendente logado (o widget, só os do próprio contato) |
| `canal.atualizado` (o `CanalSaida`, sem credenciais) | todo atendente logado; sai quando o WhatsApp do QR Code conecta ou cai |
| `interno.*` (chat da equipe) | **só membros da sala** do `sala_id`, conferido no momento da entrega; com `"para": [ids]`, só essas pessoas. Sem atendente identificado, nenhum `interno.*` sai (`Eventos::desde` recebe o `atendenteId`; no Python, `FiltroDoAtendente`) |

---

## Ligando os canais

Cadastre o canal em `POST /api/canais` (ou pelo `seed`) e consulte
`GET /api/canais/{id}/credenciais` para ver a URL de webhook e o segredo
gerado. As credenciais ficam em `Canal.credenciais`.

### WhatsApp (Cloud API, Meta)

```json
{"token": "EAAG...", "id_numero": "1234567890", "token_verificacao": "escolha-um"}
```

A versão da Graph API é uma constante só por backend: **v26.0**
(`VERSAO_API` em `app/canais/whatsapp.py` e `php/app/Canais/AdaptadorWhatsApp.php`).
A v20.0, usada antes, já saiu do ar na Meta.

No painel da Meta, aponte o webhook para `https://SEU-HOST/webhooks/{canal_id}`
e use o `token_verificacao` no handshake. Se preencher `segredo_webhook`, toda
entrega passa a ser conferida pelo HMAC do cabeçalho `X-Hub-Signature-256`.
Recibos de entrega e leitura chegam pelo mesmo webhook e atualizam o status da
mensagem enviada.

### WhatsApp pelo QR Code (Z-API ou Evolution API)

Um número de WhatsApp **comum** (o do celular da empresa), conectado lendo um
QR Code como no WhatsApp Web. Esse protocolo exige uma sessão ligada o tempo
todo, que a hospedagem compartilhada não mantém; por isso a sessão fica num
**provedor online**, e o IHchat fala com ele por REST (QR, estado, envio) e
recebe por webhook. Detalhes de cada rota, conferidos na documentação e no
código dos provedores: [`php/app/Canais/PROVEDORES-WHATSAPP.md`](php/app/Canais/PROVEDORES-WHATSAPP.md).

| | Z-API | Evolution API v2 |
|---|---|---|
| O que é | serviço brasileiro hospedado | software livre que você hospeda |
| Custo (consultado em set/2026) | R$ 99,99 por mês por instância (número), sem custo por mensagem; 2 dias grátis para testar; planos Partner com preço menor por instância para quem contrata volume (confira no site: preço muda) | o software é gratuito; o custo é o servidor onde ele roda (uma VPS pequena com Docker e um banco PostgreSQL ou MySQL; Redis é opcional) e o tempo de quem o mantém |
| Credenciais no IHchat | ID da instância, token da instância e, se a conta ativou, o Client-Token | endereço do servidor (https), API key global e o nome da instância |
| Quem cria a instância | você, no painel da Z-API | o próprio IHchat, no primeiro "Conectar pelo QR Code" |

**Riscos (leia antes de usar).**

- **Não é oficial.** O WhatsApp não autoriza esse uso e pode **banir o
  número**, principalmente com mensagens em massa, listas frias ou muitas
  denúncias. Use para atender quem escreveu, nunca para disparo. Para volume
  ou campanhas, use a API oficial (tipo "WhatsApp (API oficial)").
- **O celular precisa continuar conectado.** Se ele sair de "Aparelhos
  conectados" (troca de aparelho, WhatsApp reinstalado, muitos dias sem
  internet), as mensagens param. O IHchat marca o canal como
  **desconectado** no filtro da caixa de entrada e avisa no redator; o admin
  lê o QR Code de novo em **Canais**.
- **Terceiro no meio.** As mensagens passam pelo provedor (na Z-API, pelos
  servidores dela; na Evolution, pelo seu servidor). As mídias ficam 30 dias
  no armazenamento da Z-API.
- O que o dono responder **direto pelo celular** entra no histórico com o selo
  "Enviada pelo celular", sem ser reenviado e sem assinatura.

**Passo a passo (Z-API).**

1. Crie a conta em z-api.io e uma instância. Anote o **ID** e o **token** da
   instância (e o **Client-Token**, em Segurança, se você o ativou).
2. No IHchat, como admin: **Canais → Novo canal → WhatsApp (QR Code)**,
   provedor Z-API, e preencha os três campos.
3. **Conectar pelo QR Code**: no celular, WhatsApp → Aparelhos conectados →
   Conectar aparelho, e leia o código da tela (ele se renova sozinho a cada
   ~15 s). O painel mostra "conectado" com o número.
4. **Conectar webhook**: o IHchat cadastra na Z-API a URL
   `https://atendimento.oprojeto.online/webhooks/<id>?token=<segredo do canal>`
   (exige o endereço público https no `config.php`/`IHCHAT_URL_PUBLICA`).
5. **Testar conexão** e mande uma mensagem de outro celular para o número.

**Passo a passo (Evolution).**

1. Suba a Evolution API v2 num servidor com https (Docker) e anote a
   `AUTHENTICATION_API_KEY` (a chave global: é ela que cria instâncias).
2. No IHchat: **Canais → Novo canal → WhatsApp (QR Code)**, provedor
   Evolution: endereço do servidor (`https://...`), API key e um nome para a
   instância.
3. **Conectar pelo QR Code** (a instância é criada nessa hora, já com o
   webhook quando há endereço público https) e leia o código no celular.
4. **Conectar webhook** (ou "Reconectar webhook" numa instância antiga) e
   **Testar conexão**.

A resposta do atendente sai com a mesma assinatura do WhatsApp oficial
(`*Ana · Suporte técnico*` na primeira linha). O cliente que já falou pela API
oficial é reconhecido pelo telefone: é o mesmo contato, o mesmo histórico.

### Telegram

```json
{"token": "123456:ABC-DEF..."}
```

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://SEU-HOST/webhooks/<CANAL_ID>" \
  -d "secret_token=<SEGREDO_WEBHOOK>"
```

### E-mail

```json
{
  "smtp_host": "smtp.provedor.com.br", "smtp_porta": 587,
  "smtp_usuario": "suporte@empresa.com.br", "smtp_senha": "...",
  "remetente": "Suporte <suporte@empresa.com.br>",
  "imap_host": "imap.provedor.com.br", "imap_usuario": "suporte@empresa.com.br",
  "imap_senha": "..."
}
```

A entrada tem dois caminhos: coleta IMAP a cada `IHCHAT_INTERVALO_COLETA`
segundos (só as não lidas, marcadas como lidas depois), ou o webhook genérico
de provedores como Mailgun e SendGrid. A resposta sai com `Re:` e com os
cabeçalhos `In-Reply-To`/`References`, para o cliente de e-mail manter a
thread.

### Webchat

O canal de webchat ganha uma chave pública. Uma linha no site basta:

```html
<script src="https://SEU-HOST/widget.js"
        data-chave="wc_..."
        data-titulo="Suporte I&H"
        data-cor="#ff9e3d"></script>
```

O widget vive num shadow root — o CSS do site não interfere nele, nem o dele no
site. Cada visitante ganha uma ficha própria e só vê a conversa que ele mesmo
teve no site. O e-mail que ele digita não é confirmado: fica nas observações da
ficha, e quem junta as fichas do mesmo cliente é a equipe, no painel (mesclar).
Assim ninguém lê o histórico de outra pessoa só por digitar o e-mail dela.

---

## O painel

- Filtros por situação, atendente, canal e etiqueta, e busca que também olha
  dentro das mensagens.
- Respostas rápidas: digite `/` no campo de texto; `{{nome}}` vira o primeiro
  nome do contato.
- Notas internas, que ficam no histórico da equipe e nunca vão para o contato.
- Atribuição, prioridade, etiquetas e situação direto no cabeçalho.
- Indicadores no topo: abertas, pendentes, sem atendente, resolvidas hoje e
  tempo médio até a primeira resposta.
- Mensagem que falhou aparece marcada, com o erro do provedor e um botão de
  reenviar — o texto digitado nunca se perde.
- Anexos pelo clipe: imagem aparece embutida na conversa, outros formatos viram
  link de download. O visitante também anexa pelo widget — no suporte, "manda
  um print" é metade dos atendimentos.
- Para o administrador: **Canais** (cadastro, teste de conexão; no Telegram,
  conectar ou remover o webhook; no WhatsApp pelo QR Code, o QR ao vivo,
  desconectar e conectar o webhook) e **Equipe** (cadastrar quem atende, com
  papel e setor; quem sai é desativado e o histórico fica).
- **Compartilhar com a equipe**, no cabeçalho da conversa: manda um cartão
  daquela conversa para uma sala do chat da equipe; quem clica no cartão abre
  a conversa no painel.

## Chat da equipe

O botão **Chat da equipe** no topo abre o chat interno: nada daqui chega aos
clientes.

- **Geral** (todo atendente ativo), uma **sala por setor** (segue o setor do
  perfil, na hora em que ele muda), **diretas** entre duas pessoas e
  **grupos** (quem cria administra: renomeia, põe e tira gente).
- **@menções** (`@Nome Completo`, ou `@Primeiro` nome quando só um membro da
  sala tem esse nome), resolvidas no servidor; mensagem direta e menção avisam
  mesmo com a aba em segundo plano, se o navegador permitir.
- Não lidas por sala, editar e apagar a própria mensagem, cartão de conversa
  de cliente.
- Privacidade: quem não é membro recebe 404 nas rotas da sala, e os eventos
  `interno.*` só chegam a membros (ver "Tempo real"). Quem entra num setor não
  vê o histórico de antes; na Geral, vê.
- Rotas em `/api/interno` (`app/api/chat_interno.py` e
  `php/app/ChatInterno/`), com o mesmo contrato nos dois backends.

---

## API

Todas as rotas de `/api` (menos `/api/auth/login` e `/api/widget/*`) pedem
`Authorization: Bearer <token>`.

| Método | Rota | Para quê |
|---|---|---|
| `POST` | `/api/auth/login` | entrar e receber o token |
| `GET` | `/api/conversas` | caixa de entrada, com filtros e busca |
| `GET` | `/api/conversas/{id}` | conversa com todas as mensagens |
| `POST` | `/api/conversas/{id}/mensagens` | responder pelo canal de origem |
| `POST` | `/api/conversas/{id}/anexos` | responder com arquivo (multipart) |
| `GET` | `/api/anexos/{id}` | baixar um arquivo |
| `POST` | `/api/conversas/{id}/notas` | nota interna |
| `POST` | `/api/conversas/{id}/atribuir` | trocar o responsável |
| `POST` | `/api/conversas/{id}/status` | aberta / pendente / resolvida |
| `POST` | `/api/contatos/{id}/mesclar/{outro}` | juntar fichas duplicadas |
| `GET` | `/api/canais/{id}/qr` | WhatsApp pelo QR Code: estado e QR (`?so_estado=1` só o estado) |
| `POST` | `/api/canais/{id}/desconectar` | desconectar o número no provedor |
| `POST` | `/api/canais/{id}/conectar-webhook` | cadastrar o webhook no provedor |
| `GET` | `/api/interno/salas` | salas do chat da equipe (e `/salas/{id}/mensagens`, `/lida`, `/sair`) |
| `POST` | `/api/interno/diretas`, `/api/interno/grupos` | abrir direta, criar grupo |
| `GET` | `/api/eventos/stream` | fluxo SSE do painel |
| `GET` | `/api/eventos/desde` | os mesmos eventos por consulta (hospedagem) |
| `GET` | `/api/metricas/resumo` | indicadores |
| `POST` | `/webhooks/{canal_id}` | entrada dos provedores |

A referência completa fica em `/docs`.

---

## Testes

```bash
cd ihchat
../.venv/bin/python -m pytest tests -q                                  # Python
IHCHAT_CONTRATO_ALVO=python ../.venv/bin/python -m pytest contrato -q   # contrato no Python
IHCHAT_CONTRATO_ALVO=php ../.venv/bin/python -m pytest contrato -q      # contrato no PHP (SQLite)
php php/tests/rodar.php                                                 # unidade PHP
```

`IHCHAT_CONTRATO_MYSQL="dsn|usuario|senha"` roda o contrato PHP num MySQL ou
MariaDB descartável, e `IHCHAT_CONTRATO_ESTRITO=1` transforma rota faltando em
falha. Cobrem webhook com assinatura e reentrega, unificação e mesclagem de
contatos, envio real com o transporte HTTP substituído (nenhum teste toca a
rede: os provedores são falsos, via `IHCHAT_TESTE_PROVEDOR`), permissões,
reabertura de conversa, widget, WhatsApp pelo QR Code, chat da equipe,
métricas e o barramento de eventos.

---

## Estrutura

```
app/
  canais/       adaptadores por provedor (o único lugar que conhece cada API)
  servicos/     regras de negócio: contatos, conversas, mensagens, distribuição
  api/          rotas HTTP
  web/          painel, chat da equipe, simulador e widget (sem build; é só abrir)
    marca/      logo "iH" da I&H, favicon e ícone de toque (ver "Marca")
  models.py     domínio
  eventos.py    barramento SSE
php/            o mesmo sistema em PHP para a hospedagem (ARQUITETURA.md, LEIAME-IMPLANTACAO.md)
contrato/       testes HTTP que rodam iguais contra o Python e o PHP
scripts/        seed, empacotar_php.py, implantar_hostinger.py
tests/
```

## Marca

O IHchat usa a identidade da I&H. O símbolo "iH" foi redesenhado em SVG a
partir do logo oficial (`oprojeto.online/assets/logo-ih.png`), com as mesmas
medidas, e mora em `app/web/marca/`:

| Arquivo | Uso |
|---|---|
| `ih.svg` | símbolo com as cores oficiais, para fundo escuro (o "H" é lilás) |
| `ih-fundo-claro.svg` | o mesmo símbolo com o "H" em azul-noite, para fundo claro |
| `favicon.svg`, `favicon-32.png` | ícone da aba: o "iH" num quadro azul-noite, sem o anel do pingo (a 16 px ele vira borrão) |
| `apple-touch-icon.png` | 180×180 para a tela inicial do celular |

Nos cabeçalhos o símbolo vai em linha no HTML, com o "H" em `currentColor`:
segue o tema sozinho. Os PNGs saem dos SVGs pelo Chromium do Playwright (o
mesmo dos testes de navegador), sem dependência nova.

**Cores.** Laranja `#ff9e3d` (o "i"), lilás `#eaedf7` (o "H") e azul-noite
`#060912` (o fundo). O azul-noite é o fundo do modo escuro e das superfícies de
marca (tela de login, trechos de código); os neutros puxam para o lilás.

O laranja é claro demais para texto branco em cima, e para ser texto sobre
branco. Por isso tem três papéis (tokens no topo de `app/web/painel.css`):

| Token | Claro | Escuro | Para quê |
|---|---|---|---|
| `--marca` | `#ff9e3d` | `#ff9e3d` | preenchimento: botão, balão de saída, contador |
| `--marca-contraste` | `#060912` | `#060912` | texto sobre `--marca` |
| `--marca-texto` | `#a35200` | `#ffa654` | laranja que vira texto (links, filtro ativo) |
| `--marca-linha` | `#d16900` | `#ff9e3d` | foco, barra do item ativo, borda de seleção |

Razões de contraste conferidas (WCAG 2.x; AA pede 4,5:1 para texto e 3:1 para
contorno e estado):

| Par | Claro | Escuro |
|---|---|---|
| branco sobre `#ff9e3d` (**não usar**) | 2,06 | — |
| `--marca-contraste` sobre `--marca` | 9,67 | 9,67 |
| `--marca-texto` sobre superfície / superfície-2 / `--marca-fraca` | 5,58 / 4,90 / 5,03 | 9,69 / 8,81 / 8,53 |
| `--marca-linha` sobre fundo / superfície-2 (não texto, mínimo 3) | 3,37 / 3,22 | 9,67 / 8,30 |
| texto sobre superfície-2 | 16,35 | 14,59 |
| texto fraco sobre superfície-2 (o pior caso) | 5,57 | 6,74 |
| verde / âmbar / vermelho como texto (pior fundo) | 4,73 / 4,89 / 4,95 | 8,55 / 7,54 / 6,15 |
| texto sobre o botão de perigo | 5,63 (branco) | 7,17 (azul-noite) |
| balão de saída: hora e status (texto a 75%) | 6,17 | 6,17 |

Exceção consciente: no simulador, o celular imita o WhatsApp e o Telegram de
verdade (o botão verde de enviar, o balão azul do Telegram) e fica com as cores
deles.

## Limites conhecidos

- Os anexos são gravados em disco local (`IHCHAT_PASTA_ANEXOS`). Serve bem uma
  instalação só; com mais de uma máquina, entra um armazenamento compartilhado
  — `Armazenamento` em `app/armazenamento.py` é a interface a implementar.
- Arquivo recebido não passa por antivírus. Se o time for abrir anexo de
  desconhecido, vale plugar uma verificação em `guardar_recebidos`.
- O esquema é criado com `create_all`. Para evoluir o banco em produção com
  dados dentro, entra Alembic.
- O barramento de eventos é em memória: com mais de um processo do app, cada um
  entrega os próprios eventos. Vários processos pedem Redis pub/sub no lugar.
- A coleta IMAP roda no processo do app. Com muitas caixas, vale mover para um
  worker separado.

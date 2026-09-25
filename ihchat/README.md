<picture>
  <source media="(prefers-color-scheme: dark)" srcset="app/web/marca/ih.svg">
  <img src="app/web/marca/ih-fundo-claro.svg" alt="I&H" width="56">
</picture>

# IHchat

A central de atendimento da **I&H**: WhatsApp, Telegram, e-mail e webchat numa
única caixa de entrada, com a ficha do cliente sempre do lado da conversa.

A promessa é simples: **um cliente, um histórico**. Se o mesmo contato pergunta
pelo WhatsApp hoje e manda um e-mail amanhã, o atendente vê as duas coisas na
mesma ficha, não em dois sistemas.

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
  WhatsApp ─┐
  Telegram ─┤   webhook / IMAP        ┌── painel do atendente (SSE)
  E-mail   ─┼──► adaptador de canal ──┤
  Webchat  ─┘         │               └── widget no site do cliente (SSE)
                      ▼
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
e os assinantes SSE são corrotinas.

---

## Ligando os canais

Cadastre o canal em `POST /api/canais` (ou pelo `seed`) e consulte
`GET /api/canais/{id}/credenciais` para ver a URL de webhook e o segredo
gerado. As credenciais ficam em `Canal.credenciais`.

### WhatsApp (Cloud API, Meta)

```json
{"token": "EAAG...", "id_numero": "1234567890", "token_verificacao": "escolha-um"}
```

No painel da Meta, aponte o webhook para `https://SEU-HOST/webhooks/{canal_id}`
e use o `token_verificacao` no handshake. Se preencher `segredo_webhook`, toda
entrega passa a ser conferida pelo HMAC do cabeçalho `X-Hub-Signature-256`.
Recibos de entrega e leitura chegam pelo mesmo webhook e atualizam o status da
mensagem enviada.

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
- Para o administrador: **Canais** (cadastro, teste de conexão e, no Telegram,
  conectar ou remover o webhook) e **Equipe** (cadastrar quem atende, com papel
  e setor; quem sai é desativado e o histórico fica).

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
| `GET` | `/api/eventos/stream` | fluxo SSE do painel |
| `GET` | `/api/metricas/resumo` | indicadores |
| `POST` | `/webhooks/{canal_id}` | entrada dos provedores |

A referência completa fica em `/docs`.

---

## Testes

```bash
cd ihchat && python -m pytest
```

Cobrem webhook com assinatura e reentrega, unificação e mesclagem de contatos,
envio real com o transporte HTTP substituído (nenhum teste toca a rede),
permissões, reabertura de conversa, widget, métricas e o barramento de eventos.

---

## Estrutura

```
app/
  canais/       adaptadores por provedor (o único lugar que conhece cada API)
  servicos/     regras de negócio: contatos, conversas, mensagens, distribuição
  api/          rotas HTTP
  web/          painel e widget (sem build; é só abrir)
    marca/      logo "iH" da I&H, favicon e ícone de toque (ver "Marca")
  models.py     domínio
  eventos.py    barramento SSE
scripts/seed.py carga inicial
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

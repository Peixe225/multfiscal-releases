# IHchat

Central de atendimento unificada: WhatsApp, Telegram, e-mail e webchat numa
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
        data-titulo="Suporte MultFiscal"
        data-cor="#2c5cf6"></script>
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
  models.py     domínio
  eventos.py    barramento SSE
scripts/seed.py carga inicial
tests/
```

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

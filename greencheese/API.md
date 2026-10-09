# API da Green Cheese (servidor da loja)

O servidor é PHP + SQLite na mesma hospedagem do site (Hostinger), em `public/api/` → `dist/api/` → `oprojeto.online/greencheese/api/`.
Este arquivo é o contrato entre o site, o painel do dono e o servidor. A parte pública (abaixo) é fixa: o que entra nela
depois é só acréscimo compatível, marcado assim (campo opcional que o outro lado pode ignorar sem quebrar nada, como o
`token` do `rateio-entrar`); a parte do painel fica descrita no fim, por quem escreve o servidor.

## Regras gerais

- Rota por parâmetro, sem regra de reescrita (a raiz do domínio já tem a dela): `api/index.php?r=<rota>`, relativo à
  página. No site: `./api/index.php?r=rateios`. No painel (`/painel/`): `../api/index.php?r=...`.
- Respostas sempre em JSON UTF-8. Sucesso: `{"ok": true, ...}`. Erro: `{"ok": false, "erro": "<codigo>", "mensagem": "<frase curta em pt-BR>"}`
  com status HTTP 4xx/5xx (alguns erros trazem campos a mais, listados em cada rota).
- Datas em ISO 8601 UTC (`"2026-10-08T03:05:00Z"`). Quem mostra formata no fuso `America/Sao_Paulo`.
- Dinheiro em reais, número (`90`, `89.9`), como no `catalogo.json`. O servidor guarda em centavos e soma em centavos.
- UF sempre minúscula (`"mg"`). WhatsApp guardado como `55` + DDD + 9 dígitos (13 dígitos, ex.: `5533991139036`); a
  entrada aceita com ou sem `55`, com ou sem pontuação, e recusa o que não for celular brasileiro.
- POST com corpo JSON (`Content-Type: application/json`), menos o envio de imagem do painel (multipart).
- Sem CORS: site, painel e API são do mesmo domínio (no desenvolvimento, o Vite repassa `/api` para o PHP).
- Todo POST confere `Origin` (ou `Referer`, se o navegador não mandar `Origin`): de outro site → 403 `origem`. Só o
  `pix-webhook` fica de fora (quem chama é o provedor).
- Erros que qualquer rota pode dar: `rota-desconhecida` 404, `metodo` 405 (com `Allow`), `origem` 403, `invalido`
  415/413 (corpo que não é JSON, ou maior que 64 KB), `muitas-tentativas` 429 (com `esperaSegundos` e `Retry-After`),
  `ocupado` 503 (banco travado por muita escrita junta: tenta de novo em 2 s), `erro-interno` 500 (o detalhe vai pro
  log no servidor, nunca na resposta). No desenvolvimento, com o PHP desligado, o Vite responde 503 `sem-servidor`.
- A `mensagem` de todo erro já vem pronta pra mostrar na tela (frase curta, no tom do site).
- Os limites por IP (`muitas-tentativas`) contam o IP de quem pediu: o `REMOTE_ADDR` e, só quando ele é da CDN de
  confiança (lista `GC_PROXIES` do servidor), o último IP que ela pôs no `X-Forwarded-For`. O resto desse cabeçalho o
  aparelho pode inventar e nunca conta (PENDENCIAS.md, “IP do cliente”).

## Rateio

Rateio é a compra junto: a loja abre X vagas de um produto importado, cada pessoa entra com nome e WhatsApp, paga a
vaga e, quando as vagas fecham, a loja faz o pedido. Sai mais barato do que comprar depois que chega. Previsão
padrão: de 6 a 10 dias depois de fechar.

Regras (o servidor é quem garante):
- 1 vaga = 1 unidade. `limitePorPessoa` (padrão 1) limita quantas vagas um WhatsApp pega no mesmo rateio.
- Ocupam vaga: participações `confirmado` e `entregue` + `reservado` ainda dentro do prazo (`expiraEm` no futuro).
- `reservado` vence em `reservaHoras` (padrão 24 h, por rateio). Vencido vira `expirado` sozinho (na leitura) e a vaga volta.
- O contador público ("8/10") é `confirmadas`/`vagas`: só sobe quando o pagamento é confirmado — hoje pelo dono no
  painel; depois, sozinho, quando o webhook do Pix avisar que caiu. As duas coisas passam pela mesma função do servidor.
- Quando `confirmadas >= vagas`, o rateio vira `fechado` sozinho (`fechadoEm`).
- Um WhatsApp tem no máximo 1 participação ativa (reservado/confirmado) por rateio.
- Derivados do tabaco e cigarro eletrônico não entram (Anvisa RDC 840/2023 e RDC 855/2024): o servidor recusa título ou
  descrição com qualquer termo da lista (sem acento e sem caixa, e também com o número no lugar da letra: `V4PE`,
  `P0D`, `C1GARRO`): `backwoods`, `charuto`, `cigarrilha`, `cigarro`, `cigarrete`, `tabaco`, `fumo`, `palheiro`,
  `swisher`, `dutch master`, `black & mild`, `black and mild`, `al capone`, `djarum`, `essencia de narguile`, `vape`,
  `cigarro eletronico`, `pod descartavel`, `juul`, `ignite`, `elfbar`, `elf bar`, `narguile`, `arguile`, `hookah`,
  `nicotina`, `nicotine`, `nic salt`, `iqos`, `lost mary`, `geek bar` e, só como palavra inteira, `rape`, `pod`, `pods`,
  `essencia`, `essencias`, `heets`, `terea`, `waka`, `oxbar`, `shisha`, `ecig`, `e cig` (`GC_TERMOS_PROIBIDOS` em
  `nucleo/validar.php`; a mesma lista no painel, `src/painel/proibidos.ts`).

Status do rateio: `rascunho` (só no painel) → `aberto` → `fechado` (lotou, ou o dono fechou) → `pedido` (dono fez o
pedido) → `caminho` → `chegou` → `encerrado` (entregue a todos). `cancelado` em qualquer ponto (só no painel e nas
"minhas vagas" de quem participava).

### GET `r=rateios`

`{ ok, agora: string, rateios: Rateio[] }` — sem `rascunho` nem `cancelado`; `encerrado` só até 15 dias depois.
Ordem: `aberto` primeiro (o que fecha antes primeiro, depois o mais novo), depois os em andamento, por último os
encerrados.

### GET `r=rateio&id=<id>`

`{ ok, rateio: Rateio }` ou 404 `nao-encontrado` (também para rascunho e cancelado).

```ts
interface Rateio {
  id: string                 // slug: a-z, 0-9 e hífen
  titulo: string
  descricao: string          // pode ser ''
  produtoId: string | null   // id do catalogo.json: a tela usa a arte do produto
  imagem: string | null      // caminho relativo à raiz do site ('uploads/ab12cd.webp'); tem prioridade sobre a arte
  precoRateio: number        // preço da vaga no rateio
  precoDepois: number | null // preço quando chegar (null = sem comparação)
  vagas: number
  confirmadas: number        // vagas pagas: o contador
  reservadas: number         // vagas reservadas esperando pagamento (no prazo)
  disponiveis: number        // vagas - confirmadas - reservadas, nunca negativo
  limitePorPessoa: number
  ufs: string[]              // estados onde vale
  status: 'aberto' | 'fechado' | 'pedido' | 'caminho' | 'chegou' | 'encerrado'
  aceitaEntradas: boolean    // aberto, dentro do prazo e com vaga disponível
  previsaoMin: number        // dias depois de fechar
  previsaoMax: number
  fechaEm: string | null     // prazo para entrar (opcional)
  fechadoEm: string | null
  pedidoEm: string | null
  chegouEm: string | null
  reservaHoras: number
  demo: boolean              // rateio de exemplo (a tela some com ele quando config.dadosDeExemplo = false)
  atualizadoEm: string
}
```

### POST `r=rateio-entrar`

Corpo: `{ rateio: string, nome: string, whatsapp: string, uf: string, cidade?: string, quantidade: number, site?: string, token?: string }`
(`site` é armadilha para robô: tem que vir vazio ou ausente; cheio → `invalido`, sem gravar nada).

**`token` — acréscimo compatível (opcional).** 32 hex (`[0-9a-f]{32}`) gerados no aparelho, o mesmo em cada nova
tentativa da mesma entrada (o site já manda). É o que impede vaga órfã quando a resposta se perde DEPOIS de o servidor
gravar (3G, hospedagem lenta):
- na primeira vez, o servidor guarda só o hash desse token no lugar de gerar um (`participacao.token` volta igual ao
  que veio), e o `minhas-vagas` com ele já acha a vaga;
- o mesmo `token` no mesmo `rateio`, com o mesmo `whatsapp` e a vaga viva (reservada no prazo, paga ou entregue),
  devolve a MESMA participação, sem criar outra: 200 `{ ok, participacao, rateio }`, sem `ja-participa`, mesmo que o
  rateio tenha lotado ou o prazo passado nesse meio-tempo. Não ocupa vaga nem gasta tentativa do limite por IP (passa
  até depois das 12 da hora); dois envios iguais ao mesmo tempo também viram uma participação só;
- `token` já usado em **outro** rateio: `invalido` 400 com `campo: 'token'`, sem gravar nada (o site gera um token por
  entrada, então isso só acontece com aparelho adulterado);
- `token` mal formado, de outro WhatsApp ou de uma vaga que venceu ou foi cancelada: ignorado (o servidor gera o dele,
  como sem `token`, e é esse que volta em `participacao.token`).

Sem `token`, nada muda. Compatível dos dois lados: servidor que não conhece o campo ignora e gera o dele (aí a nova
tentativa recebe `ja-participa` com o código, e o site manda falar com a loja com esse código, sem inventar quantidade).

Sucesso 201 (200 na repetição com o mesmo `token`): `{ ok, participacao: Participacao, rateio: Rateio }` (o rateio já
com o contador novo).

Erros: `invalido` 400 (com `campo`: `nome` | `whatsapp` | `uf` | `quantidade` | `rateio` | `token`), `nao-encontrado` 404,
`fora-do-estado` 409, `rateio-fechado` 409 (não aceita entrada: fechado, fora do prazo ou não aberto), `sem-vagas` 409
(com `disponiveis`), `limite-por-pessoa` 409 (com `limite`), `ja-participa` 409 (com `codigo`), `muitas-tentativas` 429,
`erro-interno` 500.

Nome: 2 a 60 caracteres depois de limpar espaços. Quantidade: inteiro de 1 a `limitePorPessoa`.

Detalhes do servidor: `fora-do-estado` traz `ufs` (onde vale) e `rateio-fechado` traz `status`; `cidade` passa de 60
caracteres e é cortada; o preço da vaga fica guardado na entrada (`total` não muda se o dono mexer no preço depois);
a ordem das conferências é rateio (existe) → a mesma entrada de novo (`token`) → rateio (aberto, no prazo) → estado →
`ja-participa` → `limite-por-pessoa` → `sem-vagas`. Limite: 12 tentativas por hora por IP (contam as erradas também;
a repetição com o mesmo `token` não conta).

### GET `r=minhas-vagas&t=<token>[,<token>…]`

Até 20 tokens. Token desconhecido é ignorado. `{ ok, participacoes: Participacao[] }` (a mais nova primeiro; o
`token` volta igual ao que foi mandado). Limite: 120 consultas por hora por IP.

```ts
interface Participacao {
  codigo: string             // 'RAT-K8EA' (4 caracteres de 23456789ABCDEFGHJKMNPQRSTUVWXYZ)
  token: string              // segredo do aparelho (32 hex); o servidor guarda só o hash
  rateio: string             // id
  titulo: string
  quantidade: number
  total: number              // quantidade × precoRateio
  status: 'reservado' | 'confirmado' | 'expirado' | 'cancelado' | 'entregue'
  expiraEm: string | null    // só em reservado
  criadoEm: string
  confirmadoEm: string | null
  rateioStatus: Rateio['status'] | 'cancelado'
}
```

### POST `r=pix-webhook`

501 `pix-nao-configurado` até o Pix direto no site existir (provedor e credenciais vêm da loja). Quando existir, ele
confirma a participação pela mesma função do painel e o contador sobe sozinho.

## Pedidos do site

O pedido continua fechando no WhatsApp da loja: o cliente toca em "Fechar pedido no WhatsApp" e manda a mensagem de
lá. Junto com o toque, o site manda uma cópia estruturada pro servidor (`POST r=pedido`), sem segurar o link (regra do
Instagram: o link já está montado e nada espera resposta). O dono vê o pedido no painel (Pedidos) e, se ligar, recebe
um aviso num grupo do WhatsApp (Avisos no WhatsApp, abaixo).

- **Código do pedido** `GC-XXXXX`: 5 caracteres do alfabeto dos códigos (`23456789ABCDEFGHJKMNPQRSTUVWXYZ`, sem 0/O,
  1/I/L), sorteado no aparelho quando o pedido começa a ser montado, junto com um **token** (32 hex) que só vai pro
  servidor. Vai numa linha só da mensagem, logo depois do cabeçalho: `Código: GC-7KD2X`. O resto da mensagem não muda.
- O mesmo código com o mesmo token é sempre o mesmo pedido (o site pode mandar de novo à vontade). O mesmo código com
  outro token (dois aparelhos que sortearam igual) vira outro pedido: o painel avisa que tem dois com o mesmo código.
- Mudou o pedido depois de mandar (voltou do WhatsApp e trocou a obs., o endereço…): o aparelho sorteia código novo e,
  até 2 h depois do envio, o pedido novo vai com `substitui: { codigo, token }` do de antes. O de antes, se ainda `novo`
  e de até 2 h atrás (relógio do servidor), vira `cancelado` com `substituidoPor`; se já andou (ou passou das 2 h), os
  dois ficam, ligados, e o aviso do grupo pede pra conferir. Depois das 2 h o aparelho manda sem `substitui`: é outro
  pedido (a pessoa voltou outro dia sem tocar em "Mandei"). O de antes que ainda não tinha chegado (o envio dele falhou):
  o aparelho tira a cópia dele da fila quando manda o mudado, e o servidor guarda no mudado o código e o hash do token
  do `substitui` — se o de antes chegar depois mesmo assim, entra já `cancelado`, ligado ao mudado, sem aviso no grupo.
- No aparelho, a cópia fica pendente (`localStorage` `gc-pedidos`, até 10, por 3 dias) até o servidor confirmar: a
  volta pra aba (o retorno do WhatsApp) ou a próxima visita mandam de novo, com espera crescente (30 s, 1 min, 2 min…
  até 6 h, ou o `esperaSegundos` do 429). Erro que não muda tentando de novo (recusado, site sem servidor) sai da fila,
  mas a recusa fica anotada no aparelho (`localStorage` `gc-pedidos-recusados`, as 10 últimas, com o erro e o campo) e
  no console; o servidor anota cada recusa no log dele (`[pedido] recusado GC-XXXXX: invalido (campo)`).
- Sem servidor (o zip da prévia, `file:`, `npm run dev` com o PHP desligado), nada disso aparece pro cliente.

### POST `r=pedido`

Quem manda é `navigator.sendBeacon` (ou `fetch` com `keepalive`, quando o beacon recusa). Confere `Origin`.

```ts
interface CorpoPedido {
  codigo: string                 // 'GC-7KD2X'
  token: string                  // 32 hex (o servidor guarda só o hash)
  tipo: 'pedido' | 'encomenda'
  uf: string
  cidade: string                 // até 60
  nome: string                   // 2 a 60
  whatsapp: string               // só quando o aparelho sabe (conta do Teste minha sorte); '' = a loja vê na conversa;
                                 // o que não fechar vira '' (nunca recusa o pedido por isso)
  // pedido
  itens?: {                      // de 1 a 60, como a sacola e a mensagem mostram
    produtoId: string | null
    nome: string                 // com tamanho e variação, como na mensagem (até 160)
    variacao: string | null
    qtd: number                  // 1 a 999
    precoUnit: number | null     // null = preço a consultar (nunca inventado); junto com total
    total: number | null         // total da linha já com o combo
    combo: string | null         // '3 por R$ 19,99' · '2× 3 por R$ 19,99 + 1 avulsa'
  }[]
  subtotal?: number | null       // tem que ser a soma dos totais conhecidos (null = tudo a consultar)
  subtotalTexto?: string         // 'R$ 169,89' · 'R$ 29,98 + itens a consultar' · 'a consultar'
  cupom?: { codigo: string; regra: string; origem: string } | null // 'SORTE-K8EA'; a loja confirma; torto vira null
  entrega?: { endereco: string; rua: string; numero: string; bairro: string; cep: string; cidade: string; uf: string }
  pagamento?: 'pix' | 'dinheiro' | 'cartao' | null // o que não for um desses vira null (não recusa)
  troco?: number | null          // só com dinheiro; arredondado pra centavos (50.555 → 50,56); acima de R$ 100.000 ou
                                 // ilegível vira null (não recusa: o troco só informa)
  obs?: string                   // até 200
  // encomenda
  encomenda?: { produto: string; quantidade: string; referencia: string } // produto 2 a 120; referência até 300
  mensagem: string               // a mensagem exata do WhatsApp: começa com "PEDIDO GREEN CHEESE" (ou "ENCOMENDA …") e tem
                                 // a linha "Código: <codigo>"; até 4000. Fica guardada como veio (só sai caractere de controle)
  site: ''                       // armadilha de robô: sempre vazio
  substitui: { codigo: string; token: string } | null
}
```

- 201 `{ ok, pedido: { codigo, tipo, status: 'novo', criadoEm } }` (nada pessoal volta: o aparelho já tem tudo).
- 200 `{ ok, pedido, repetido: true }`: a mesma entrada de novo (código + token). Não grava, não avisa o grupo e não
  gasta o limite.
- **Campo informativo não derruba o pedido**: cupom, pagamento e troco tortos ficam de fora (null) e o pedido entra.
  Campo estrutural torto (`uf`, `nome`, `itens`, `subtotal`, `encomenda`) com a **mensagem certa** (começa com o
  cabeçalho e tem a linha do código): o pedido entra só com a mensagem (sem itens; o estado e o nome saem do cabeçalho e
  da linha "Nome:" quando o corpo não trouxe) e a anotação diz o campo — o cliente já mandou essa mensagem pra loja, e
  um desencontro entre o site e o servidor nunca faz o pedido sumir do painel e do grupo. O aviso do grupo leva a
  mensagem do cliente. Tabaco nas linhas dos itens da mensagem continua 422.
- Erros: `invalido` 400 (`campo`: `codigo`, `token`, `site` quando a armadilha veio preenchida, `mensagem`; e os
  estruturais quando nem a mensagem serve; token de outro código também é `token`), `proibido` 422 (`campo`: `itens` | `encomenda`, `termo`: derivado do tabaco ou cigarro eletrônico, a lista
  do Rateio — a mesma recusa vale pra produto), `origem` 403, `muitas-tentativas` 429 (20 pedidos novos por hora por
  IP; a armadilha e o corpo quebrado contam), `ocupado` 503.

### GET `r=pedido-textos`

As falas do pedido guiado (o chat do site) que o dono trocou no painel: `{ ok, textos: { [chave]: string }, versao }`
(só as trocadas; o resto é o texto de sempre, que mora no site em `src/dados/textos-pedido.ts`). `ETag` = `versao`; o
site guarda as trocas com a versão (`localStorage` `gc-falas`) e pede de novo cada vez que o chat abre, no máximo 1 vez
por minuto, com `If-None-Match`: igual, 304 sem corpo (a versão marcada por proxy, `W/"…"` ou `"…-gzip"`, também
vale). Sem servidor, vale o que o aparelho tinha (na primeira vez, as de sempre). O site só aceita troca de chave que ele conhece, com os marcadores da lista dela, no tamanho e sem promessa.

Cada fala tem um tipo (`fala` 280 letras, `resposta` 80, `botao` 40, `dica` 60, `erro` 120) e só aceita os marcadores
da lista dela (`{nome}` — o primeiro nome —, `{uf}`, `{estado}`, `{cidade}`, `{lugar}`, `{horario}`, `{onde}`, `{endereco}`,
`{ufAtendimento}`, `{valor}`, `{numero}`, `{instagram}` — já com o @ —, `{cupom}`, `{motivo}`, `{premio}`). A lista
das chaves, tipos e marcadores que o servidor confere é `api/nucleo/textos-pedido.json`, gerado do arquivo do site
(`node scripts/gerar-textos-pedido.mjs`; o `testar-api` recusa lista velha). A mensagem que vai pro WhatsApp não é fala:
o formato dela é combinado com a loja e não muda pelo painel.

### Migrações (faixa 200–299)

O banco cresce por migrações numeradas com registro (tabela `migracoes`, `gc_migracoes()` em `nucleo/banco.php`;
faixas: 1–99 base, 100–199 loja, 200–299 pedidos e contas). As desta frente moram em `nucleo/pedido-migracoes.php`
(`gc_migracoes_pedidos()`, somada só quando o módulo existe): `200` pedidos, `201` avisos no WhatsApp (envios e
tentativas), `202` falas trocadas do pedido guiado. Nunca edite uma que já foi pro ar: acrescente a próxima da faixa.

As das contas moram em `nucleo/contas-migracoes.php` (`gc_migracoes_contas()`, somada quando o módulo existe):
`203` equipe (colunas `ativo`, `ufs`, `trocar_senha`, `criado_por`, `desativado_em` em `usuarios`; índice dos eventos
por usuário), `204` clientes (`clientes`, `clientes_codigos`, `clientes_sessoes`, `clientes_enderecos`), `205` Teste
minha sorte no servidor (`cupons`, `giros`), `206` pedido ligado à conta (`pedidos.cliente_id` e índices por conta e
por WhatsApp).

## Pedidos, avisos e falas (painel)

Rotas `admin-*` com a sessão e o CSRF do Painel do dono (abaixo).

| Rota | Corpo / parâmetros | Sucesso |
|---|---|---|
| GET `admin-pedidos` | `[&status=abertos\|novo\|confirmado\|saiu\|entregue\|cancelado\|todos][&uf=][&busca=][&antes=<id>][&limite=50]` | `ListaPedidos` (o mais novo primeiro) |
| GET `admin-pedidos-resumo` | — | `{ agora, novos, emAndamento, ultimos: PedidoLinha[] (até 5 novos), avisos: SituacaoAvisos }` |
| GET `admin-pedido` | `&id=` | `{ agora, pedido: PedidoAdmin, mesmoCodigo: PedidoLinha[], avisos: EnvioAviso[] (até 5) }` |
| POST `admin-pedido-status` | `{ id, status }` | `{ pedido, jaEstava? }` |
| POST `admin-pedido-salvar` | `{ id, whatsapp?, nota? }` | `{ pedido }` (campo ausente fica; `whatsapp: ''` tira) |
| POST `admin-pedido-apagar-dados` | `{ id }` | `{ pedido }` (LGPD; só entregue ou cancelado) |
| GET `admin-avisos` | — | `{ agora, config: ConfigAvisos, situacao: SituacaoAvisos, envios: EnvioAviso[] (os 50 últimos) }` |
| POST `admin-avisos-salvar` | `CorpoAvisos` | `{ config, situacao }` |
| POST `admin-avisos-testar` | `{}` | `{ envio: EnvioAviso }` (manda agora, com os ajustes salvos; até 30 s) |
| POST `admin-aviso-reenviar` | `{ id }` | `{ envio: EnvioAviso }` (manda agora, até o que já foi) |
| GET `admin-textos-pedido` | — | `{ textos: { [chave]: { texto, atualizadoEm, por } }, versao }` |
| POST `admin-texto-pedido-salvar` | `{ chave, texto }` | `{ textos, versao }` (`texto` null, '' ou igual ao padrão = volta ao padrão) |

`busca` procura no código (com ou sem o `GC-`), no nome, na cidade e no WhatsApp, sem acento e sem caixa (até 40). A
contagem por status vale pro estado escolhido (`abertos` = novo + confirmado + saiu). `antes` pagina pelo id.

**Status do pedido** (`admin-pedido-status`): `novo → confirmado → saiu → entregue`, voltar um passo (toque errado:
`confirmado → novo`, `saiu → confirmado`, `entregue → saiu`; a data do passo desfeito sai), `cancelado` de qualquer
um que não foi entregue e `cancelado → novo` (reabrir; recomeça sem as datas). Pedir o status que já tem: 200 com
`jaEstava: true`. Pedido trocado pelo cliente (`substituidoPor`) não muda mais; pedido com os dados apagados (LGPD)
também não (409 `dados-apagados`; `proximos: []`, o painel não mostra "Reabrir"). O cliente não é avisado sozinho: o
painel mostra a mensagem pronta de cada passo pro dono mandar no WhatsApp de quem pediu.

Erros: `nao-encontrado` 404; `invalido` 400 (`campo`: `status`, `whatsapp`, `nota` — até 500 —, `chave`, `texto`,
`motor`, `destino`, `zapi.instancia`, `zapi.token`, `zapi.clientToken`, `evolution.url`, `evolution.instancia`,
`evolution.apikey`, `webhook.url`, `webhook.segredo`, `eventos`; no `texto`, também `maximo`, `marcador` ou `termo`);
`transicao-invalida` 409 (`de`, `para`, `permitidos`); `substituido` 409 (`por`, `porId`); `pedido-ativo` 409 (apagar
dados de pedido em andamento); `dados-apagados` 409 (editar ou mudar o status depois de apagar); `proibido` 422 (tabaco na fala);
`avisos-desligados` 409 (testar ou reenviar com o motor desligado); `nao-reenvia` 409 (aviso que não guarda o texto de
verdade, como o código de login das contas); `muitas-tentativas` 429 (20 testes/reenvios em 10 min por usuário).

**Apagar os dados (LGPD)**: nome vira "Dados apagados"; WhatsApp, endereço, observação, anotação, a referência da
encomenda e a mensagem saem; o texto dos avisos desse pedido vira "Dados apagados (LGPD)." (e o que esperava nova
tentativa para); a Atividade perde o nome. Itens, valores, status e datas ficam.

```ts
type StatusPedido = 'novo' | 'confirmado' | 'saiu' | 'entregue' | 'cancelado'

interface PedidoLinha {
  id: number
  codigo: string
  tipo: 'pedido' | 'encomenda'
  status: StatusPedido
  uf: string
  cidade: string
  nome: string
  whatsapp: string               // '' quando o site não sabia (o dono põe pelo admin-pedido-salvar)
  resumo: string                 // '1x Jack Daniel's Old No. 7 1 L, 3x Seda OCB…' · 'Encomenda: Fanta de uva japonesa (2)'
  unidades: number
  subtotal: number | null
  subtotalTexto: string
  criadoEm: string
  atualizadoEm: string
  substitui: { id: number; codigo: string } | null
  substituidoPor: { id: number; codigo: string } | null
  dadosApagados: boolean
}

interface PedidoAdmin extends PedidoLinha {
  itens: { produtoId: string | null; nome: string; variacao: string | null; qtd: number; precoUnit: number | null; total: number | null; combo: string | null }[]
  cupom: { codigo: string; regra: string; origem: string } | null
  entrega: { endereco: string; rua: string; numero: string; bairro: string; cep: string; cidade: string; uf: string }
  pagamento: 'pix' | 'dinheiro' | 'cartao' | null
  troco: number | null
  observacao: string
  encomenda: { produto: string; quantidade: string; referencia: string } | null
  mensagem: string               // a mensagem do WhatsApp como veio ('' depois de apagar os dados)
  nota: string                   // anotação da loja
  confirmadoEm: string | null
  saiuEm: string | null
  entregueEm: string | null
  canceladoEm: string | null
  statusPor: string | null       // 'painel:<login>' ou 'site' (trocado pelo cliente)
  proximos: StatusPedido[]       // os botões de agora
}

interface ListaPedidos {
  agora: string
  pedidos: PedidoLinha[]
  contagem: Record<'abertos' | StatusPedido | 'todos', number>
  ufs: string[]                  // estados que já tiveram pedido
  mais: boolean                  // tem mais antigos (antes=<id do último>)
}
```

## Avisos no WhatsApp

Um número de WhatsApp da loja, conectado num gateway, manda um aviso num grupo (ou num número) a cada pedido. O dono
escolhe o motor no painel e troca quando quiser; sem motor (`nenhum`), nada entra na fila.

| Motor | Requisição |
|---|---|
| `zapi` | POST `https://api.z-api.io/instances/{instancia}/token/{token}/send-text`, cabeçalho `Client-Token` (se a conta tiver), corpo `{ "phone": "<id-do-grupo>-group" \| "<55DDDnúmero>", "message": "<texto>" }`; 200 com `error` (instância desconectada) conta como falha |
| `evolution` | POST `{url}/message/sendText/{instancia}`, cabeçalho `apikey`, corpo `{ "number": "<id-do-grupo>@g.us" \| "<55DDDnúmero>", "text": "<texto>" }` |
| `webhook` | POST `{url}` com `{ "tipo", "texto", "dados" }` e `X-GC-Assinatura` = HMAC-SHA256 do corpo (hex) com o segredo (n8n, Make, robô próprio) |
| `nenhum` | desligado |

- **Eventos** (o dono liga e desliga cada um): `pedido`, `encomenda`, `rateio-reserva` (alguém entrou num rateio pelo
  site) e `rateio-pago` (pagamento confirmado no painel; o Pix vai usar a mesma porta). No webhook, o `tipo` é
  `pedido` | `pedido-atualizado` | `encomenda` | `encomenda-atualizado` | `rateio-reserva` | `rateio-pago` | `teste`,
  e `dados` traz o pedido inteiro (`{ pedido: PedidoAdmin }`) ou `{ participante, rateio, fechou? }`.
- **A mensagem do grupo** (negrito e itálico do WhatsApp, quase sem emoji): `*NOVO PEDIDO* · #GC-7KD2X`, a linha de
  onde e quando (`MG / Teófilo Otoni · qua., 08/10 às 22:41`), `*Itens*` (com o total de cada um e o combo em
  itálico), `Subtotal`, o cupom (`_(a loja confirma)_`), `*Entrega:*` (`_(taxa a confirmar)_`), `*Pagamento:*`
  (com o troco), `*Cliente:*` (com o `wa.me/` quando tem), `*Obs.:*` e o link do pedido no painel. Encomenda e rateio
  têm os modelos deles. Nada de prazo, frete ou valor que a loja não passou.
- **Depois da resposta**: o aviso entra na fila (`avisos_envios`) na mesma transação do que aconteceu e sai depois que
  quem pediu já recebeu a resposta (o cliente nunca espera o gateway). Cada tentativa fica registrada
  (`avisos_tentativas`, as 20 últimas de cada aviso). Falhou: tenta de novo sozinho em 1 min e em 5 min, quando alguém
  passa pelo servidor (o site mandando pedido, o chat abrindo, o painel lendo); depois, só pelo "Mandar de novo".
  Tempo limite: 4 s pra conectar e 10 s no total (2 s e 4 s quando alguém espera, como o código de login).
- **Segredos** (token, Client-Token, apikey, segredo e o caminho do webhook) ficam só no servidor (tabela `ajustes`):
  o painel recebe o final (`•••1234`, ou `•••` quando é curto) e o endereço do webhook mascarado; segredo em branco no
  salvar mantém o guardado, `null` apaga. Erro do gateway volta sem os segredos e sem a URL.
- **Endereço de envio**: Evolution e webhook só com `https` (http só no desenvolvimento e nos testes); o host tem que
  resolver só pra IP público (rede interna, loopback, link-local, CGNAT… recusados) e a conexão fica presa no IP
  conferido; sem redirecionamento, só http/https, lendo no máximo 8 KB da resposta.
- **Link do painel nas mensagens**: o endereço guardado quando o dono salvou os avisos (nunca o `Host` de quem mandou
  o pedido).
- **Porta pra outras frentes** (código de login das contas): `gc_whatsapp_mandar($texto, ['tipo' => 'numero', 'valor'
  => '5533…'], 'codigo-login', 'conta:<id>', 'Código de login pra (33) 9••••-4567')` manda na hora (tempo curto),
  registra no histórico sem guardar o texto de verdade (o painel não reenvia) e devolve `{ ok, motor, http, ms, erro,
  envio }`. `gc_aviso_enfileirar($evento, $tipo, $alvo, $texto, $dados, $para)` põe na fila com novas tentativas;
  `gc_whatsapp_enviar()` manda sem registro.

```ts
type Motor = 'nenhum' | 'zapi' | 'evolution' | 'webhook'
type EventoAviso = 'pedido' | 'encomenda' | 'rateio-reserva' | 'rateio-pago'

interface ConfigAvisos {
  motor: Motor
  destino: { tipo: 'grupo' | 'numero'; valor: string } // grupo: só o ID (o que vem antes de "-group" ou "@g.us"); número: 55…
  zapi: { instancia: string; token: string | null; clientToken: string | null } // segredos: o final, '' (curto) ou null (não tem)
  evolution: { url: string; instancia: string; apikey: string | null }
  webhook: { url: string; temUrl: boolean; segredo: string | null }           // url mascarada: 'https://n8n.loja.com/•••a1b2'
  eventos: Record<EventoAviso, boolean>
  atualizadoEm: string | null
}

// Corpo do admin-avisos-salvar: campo ausente fica como está; segredo '' fica o guardado; null apaga. O motor
// escolhido tem que estar completo (Z-API e Evolution também pedem o destino).
interface CorpoAvisos {
  motor: Motor
  destino?: { tipo: 'grupo' | 'numero'; valor: string }
  zapi?: { instancia?: string; token?: string | null; clientToken?: string | null }   // instância e token: letras e números
  evolution?: { url?: string; instancia?: string; apikey?: string | null }
  webhook?: { url?: string | null; segredo?: string | null }                        // segredo: 16 a 200, sem espaço
  eventos?: Partial<Record<EventoAviso, boolean>>
}

interface SituacaoAvisos { motor: Motor; ligado: boolean; falhas: number /* 7 dias */; naFila: number; ultimoEnviado: string | null }

interface EnvioAviso {
  id: number
  tipo: string                   // 'pedido', 'encomenda-atualizado', 'rateio-pago', 'teste', 'codigo-login'…
  alvo: string                   // 'pedido:12', 'participacao:RAT-K8EA', 'avisos'
  para: { tipo: 'grupo' | 'numero'; valor: string } | null // null = o destino do painel
  reenvia: boolean               // false = o texto guardado é só o registro (código de login): não reenvia
  texto: string
  status: 'pendente' | 'enviando' | 'enviado' | 'falhou'
  motor: string
  tentativas: number
  erro: string                   // frase pronta, sem segredo
  criadoEm: string
  atualizadoEm: string
  enviadoEm: string | null
  tentarEm: string | null        // a próxima tentativa sozinha
  ultimas: { em: string; ok: boolean; motor: string; http: number; ms: number; erro: string; por: string }[] // até 5
}
```

Na Atividade: `pedido-recebido`, `encomenda-recebida`, `pedido-substituido`, `pedido-status`, `pedido-editado`,
`pedido-dados-apagados`, `avisos-ajustados`, `texto-pedido-trocado` e `texto-pedido-padrao` (alvo `pedido:<código>`,
`avisos` ou `texto:<chave>`).

## Painel do dono

Rotas `admin-*`, no mesmo `api/index.php?r=…` (do painel em `/painel/`: `../api/index.php?r=…`). Dinheiro, datas e
erros seguem as regras gerais.

### Sessão, CSRF e instalação

- **Cookie** `gc_painel`: token aleatório de 32 bytes (o servidor guarda só o hash), `HttpOnly`, `SameSite=Strict`,
  `Secure` no HTTPS, `Path` = pasta do site (`/greencheese/`). Vale 30 dias e desliza a cada uso; até 10 sessões por
  usuário (a 11ª derruba a menos usada). O painel nunca lê o cookie: pergunta ao `admin-sessao`.
- **CSRF**: `csrf` (64 hex) vem no `admin-sessao`, `admin-instalar`, `admin-entrar` e `admin-recuperar`. Todo POST do
  painel manda o cabeçalho `X-CSRF: <csrf>` (menos instalar, recuperar e entrar, que ainda não têm sessão). Sem ele:
  403 `csrf` ("Recarrega a página e tenta de novo.").
- **Sem sessão** (cookie vencido, sair em outro aparelho, senha trocada): 401 `sem-sessao` → o painel volta pro login.
- **Código de instalação**: só o hash fica em `api/instalacao.php` (gerado por `php scripts/codigo-instalacao.php`,
  que mostra o código uma vez). O servidor compara só letras e números minúsculos (`K7M2P-X9Q4R…` = `k7m2px9q4r…`).
  Cada código vale **uma vez**: instala o painel ou, depois, troca a senha de quem esqueceu (`admin-recuperar`).
  Limite: 10 tentativas de código por hora por IP. O código de desenvolvimento (`dev-instalar-greencheese`) só vale com
  `GC_DADOS` (desenvolvimento); no ar → 403 `codigo-de-desenvolvimento`. O servidor o reconhece pelo próprio hash (a
  marca `// DEV` do `instalacao.php` é só lembrete: apagar o comentário não adianta), e o `publicar.mjs` e o
  `empacotar.mjs` nem sobem nem empacotam com ele.
- **Senha**: de 10 a 72 caracteres (`password_hash`). Login: 3 a 32, letras minúsculas, números, `.`, `_`, `-`.

### Rotas

| Rota | Corpo / parâmetros | Sucesso |
|---|---|---|
| GET `admin-sessao` | — | `{ instalado, usuario: Usuario \| null, csrf: string \| null, versao }` |
| POST `admin-instalar` | `{ codigo, login, nome, senha }` | 201 `{ usuario, csrf }` + cookie; semeia os 2 rateios de exemplo |
| POST `admin-recuperar` | `{ codigo, senha, login? }` | `{ usuario, csrf }` + cookie; derruba todas as sessões |
| POST `admin-entrar` | `{ login, senha }` | `{ usuario, csrf }` + cookie (token novo sempre) |
| POST `admin-sair` | `{}` | `{}`, apaga a sessão e o cookie |
| POST `admin-senha` | `{ atual, nova }` | `{}`; derruba as outras sessões (esta fica) |
| GET `admin-resumo` | — | `Resumo` |
| GET `admin-rateios` | — | `{ agora, rateios: RateioAdmin[] }` (todos, até rascunho e cancelado) |
| GET `admin-rateio` | `&id=` | `{ rateio: RateioAdmin }` |
| POST `admin-rateio-salvar` | `RateioCorpo` (sem `id` cria, com `id` edita) | 201 (criou) ou 200 `{ rateio: RateioAdmin }` |
| POST `admin-rateio-status` | `{ id, status }` | `{ rateio: RateioAdmin }` |
| POST `admin-rateio-apagar` | `{ id }` | `{}` |
| GET `admin-participantes` | `&rateio=` | `{ rateio: RateioAdmin, participantes: Participante[] }` (na ordem em que entraram) |
| POST `admin-participante-salvar` | `ParticipanteCorpo` (sem `id` inclui, com `id` edita) | 201 `{ participante, token, rateio }` ou 200 `{ participante, rateio }` |
| POST `admin-participante-status` | `{ id, status }` | `{ participante, rateio, jaEstava? }` (`jaEstava: true`: já tinha esse status, nada mudou) |
| POST `admin-participante-apagar` | `{ id }` | `{ participante, rateio }` (dados pessoais apagados) |
| GET `admin-participantes-csv` | `&rateio=` | arquivo `rateio-<id>-<data>.csv` (`;`, BOM UTF-8: abre direto no Excel; data no horário de Brasília) |
| GET `admin-backup` | — | arquivo `greencheese-loja-<data>-<hora>.sqlite` (cópia inteira e coerente do banco; horário de Brasília) |
| POST `admin-upload` | multipart, campo `imagem` | 201 `{ imagem: 'uploads/<nome>', largura, altura, bytes, tipo }` |
| GET `admin-diagnostico` | — | `Diagnostico` |
| GET `admin-eventos` | `[&usuario=<login>]` (só o dono) | `{ eventos: Evento[] }` (os últimos 100, do mais novo; gerente e atendente veem só os deles) |

Erros de cada uma (além dos gerais e do `sem-sessao`/`csrf`):

- `admin-instalar`: `ja-instalado` 409, `codigo-invalido` 403, `codigo-de-desenvolvimento` 403, `invalido` 400
  (`campo`: `login` | `nome` | `senha`), `muitas-tentativas` 429.
- `admin-recuperar`: `nao-instalado` 409, `codigo-invalido` 403, `codigo-usado` 409, `invalido` 400 (`senha` | `login`).
- `admin-entrar`: `credenciais` 401 (sempre "Login ou senha não confere."), `muitas-tentativas` 429 (5 erros em 15 min
  por IP + login; 20 por IP), `nao-instalado` 409.
- `admin-senha`: `senha-atual` 403 (`campo: 'atual'`), `invalido` 400 (`campo: 'nova'`), `muitas-tentativas` 429.
- `admin-rateio-salvar`: `invalido` 400 (com `campo`; em `vagas`, também `minimo` = vagas ocupadas), `proibido` 422
  (`campo` + `termo`: tabaco e cigarro eletrônico, a lista do Rateio), `nao-encontrado` 404, `nao-editavel` 409
  (encerrado ou cancelado).
- `admin-rateio-status`: `transicao-invalida` 409 (`de`, `para`, `permitidos`), `lotado` 409 (reabrir sem aumentar as
  vagas), `prazo-vencido` 409 (abrir com o `fechaEm` no passado), `invalido` 400 (`campo: 'status'`).
- `admin-rateio-apagar`: `use-cancelar` 409 (com `participacoes`): só apaga rascunho, exemplo ou rateio sem ninguém.
- `admin-participante-salvar` e `-status`: `nao-encontrado` 404, `invalido` 400 (com `campo`), `ja-participa` 409
  (`codigo`), `limite-por-pessoa` 409 (`limite`), `sem-vagas` 409 (`disponiveis`), `rateio-fechado` 409 (incluir em
  rascunho, encerrado ou cancelado), `rateio-cancelado` 409, `transicao-invalida` 409 (`de`, `para`, `permitidos`),
  `dados-apagados` 409 (a vaga de quem teve os dados apagados não volta: nem editar, nem confirmar, nem reservar).
- `admin-participante-apagar`: `participacao-ativa` 409 (reservada ou paga num rateio em curso: cancela antes).
- `admin-upload`: `grande-demais` 413 (`limite` em bytes: 8 MB ou o limite do PHP, o menor), `tipo-invalido` 415 (só
  JPG, PNG e WebP de verdade, conferidos pelo conteúdo), `imagem-grande` 413 (mais de 40 megapixels), `invalido` 400
  (`campo: 'imagem'`), `envio-falhou` 500.

```ts
// quem está logado (admin-sessao, -entrar, -instalar, -recuperar e -senha): o painel esconde o que o papel não pode
interface Usuario {
  login: string
  nome: string
  papel: 'dono' | 'gerente' | 'atendente'
  ufs: string[]                  // os estados dele ([] = todos: o dono)
  permissoes: string[]           // as do papel (seção "Equipe"); o dono recebe todas
  trocarSenha: boolean           // senha provisória: o painel só mostra a troca até ela ser feita
}

// O Rateio público + o que só o dono vê. status inclui 'rascunho' e 'cancelado'.
interface RateioAdmin extends Omit<Rateio, 'status'> {
  status: Rateio['status'] | 'rascunho' | 'cancelado'
  criadoEm: string
  abertoEm: string | null
  caminhoEm: string | null
  encerradoEm: string | null
  canceladoEm: string | null
  totais: {
    pessoasConfirmadas: number   // pessoas com vaga paga (confirmado + entregue)
    pessoasReservadas: number    // pessoas com reserva no prazo
    entregues: number            // vagas entregues
    expiradas: number            // participações que venceram
    canceladas: number
    participacoes: number        // linhas no total (todas)
    arrecadado: number           // R$ confirmado (vagas pagas × preço da vaga na entrada)
    aReceber: number             // R$ das reservas no prazo
  }
  proximos: string[]             // status pra onde dá pra ir agora (os botões do painel)
  podeApagar: boolean            // rascunho, exemplo ou sem ninguém; senão, cancelar
  noSite: boolean                // aparece no site agora
}

// Corpo do admin-rateio-salvar. Na edição, campo ausente fica como está.
interface RateioCorpo {
  id?: string                    // sem id: cria (o id sai do título, único: 'teste', 'teste-2'…)
  titulo: string                 // 3 a 80
  descricao?: string             // até 400 (quebra de linha vale)
  produtoId?: string | null      // id do catalogo.json ([a-z0-9-]); a tela usa a arte do produto
  imagem?: string | null         // o 'uploads/<nome>' que o admin-upload devolveu
  precoRateio: number            // de 0,01 a 100.000, até 2 casas ("14,90" também vale)
  precoDepois?: number | null    // > precoRateio (até 100.000), ou null (sem comparação)
  vagas: number                  // 1 a 1000; na edição, nunca menos que as ocupadas
  limitePorPessoa?: number       // 1 até as vagas (padrão 1)
  ufs: string[]                  // pelo menos 1 ('mg', 'rj'…)
  previsaoMin?: number           // dias depois de fechar (padrão 6)
  previsaoMax?: number           // >= previsaoMin (padrão 10)
  fechaEm?: string | null        // prazo pra entrar, ISO; sem fuso = horário de Brasília; tem que ser no futuro
  reservaHoras?: number          // 1 a 168 (padrão 24)
  demo?: boolean                 // exemplo (some do site com config.dadosDeExemplo = false)
  status?: 'rascunho' | 'aberto' // só ao criar (padrão 'rascunho')
}

interface Participante {
  id: number
  codigo: string                 // 'RAT-K8EA'
  rateio: string
  nome: string
  whatsapp: string               // '5533991139036' (o painel monta o wa.me com ele); '' depois de apagar os dados
  uf: string
  cidade: string
  quantidade: number
  precoUnit: number              // preço da vaga quando entrou
  total: number
  status: 'reservado' | 'confirmado' | 'expirado' | 'cancelado' | 'entregue'
  origem: 'site' | 'painel'
  observacao: string
  criadoEm: string
  atualizadoEm: string
  expiraEm: string | null        // só em reservado
  confirmadoEm: string | null
  confirmadoPor: string | null   // 'painel:<login>' ou 'pix'
  canceladoEm: string | null
  entregueEm: string | null
  expiradoEm: string | null
}

// Corpo do admin-participante-salvar (incluir quem entrou pela DM, ou editar). Mesmas regras de vaga do site:
// WhatsApp único por rateio, limite por pessoa e vaga sobrando. Incluir vale com o rateio aberto, fechado, pedido,
// a caminho ou chegou; o estado pode ser qualquer um (o dono decide).
interface ParticipanteCorpo {
  id?: number                    // sem id: inclui (rateio obrigatório)
  rateio?: string
  nome: string
  whatsapp: string
  uf: string
  cidade?: string
  quantidade?: number            // padrão 1
  observacao?: string            // até 500 (ex.: "pagou no Pix às 14h")
  status?: 'reservado' | 'confirmado' // só ao incluir (padrão reservado; confirmado já sobe o contador)
}
// Ao incluir, volta também `token`: o mesmo segredo de aparelho do site (serve no minhas-vagas, se o site um dia
// aceitar a vaga por link).

interface Resumo {
  agora: string
  rateios: { rascunho: number; aberto: number; andamento: number; encerrado: number; cancelado: number }
  reservas: { pessoas: number; vagas: number; aReceber: number; vencendo: number } // vencendo = nas próximas 6 h
  confirmado: { pessoas: number; vagas: number; valor: number }                 // fora os cancelados
  esperandoPagamento: (Participante & { rateioTitulo: string })[]  // reservas no prazo, a que vence antes primeiro (até 20)
  ultimasEntradas: (Participante & { rateioTitulo: string })[]     // as 10 mais novas
}

interface Diagnostico {
  versaoApi: string
  agora: string
  php: { versao: string; ok: boolean; sapi: string }    // ok = 8.1 ou mais
  extensoes: { pdo_sqlite: boolean; sqlite: string; gd: boolean; webp: boolean; exif: boolean; fileinfo: boolean; mbstring: boolean; openssl: boolean; curl: boolean }
  dados: { gravavel: boolean; bancoBytes: number; diario: string; versaoBanco: number } // diario 'wal' = certo
  uploads: { existe: boolean; gravavel: boolean; arquivos: number; bytes: number }
  limites: { upload_max_filesize: string; post_max_size: string; memory_limit: string; max_execution_time: string; envioMaximo: number; envioMaximoTexto: string }
  https: boolean
  // o IP que conta nos limites de tentativa e se tem CDN na frente (sem segredo: IP de gente sai mascarado, '177.38.12.x')
  rede: {
    remoto: string               // o REMOTE_ADDR: inteiro quando é de CDN/proxy, mascarado quando é de gente
    proxyNaFrente: boolean       // chegou X-Forwarded-For (ou parecido) sem o REMOTE_ADDR dentro, ou ele está no GC_PROXIES
    confiavel: boolean           // o REMOTE_ADDR está no GC_PROXIES (aí vale o X-Forwarded-For)
    usado: string                // o IP que conta nos limites (mascarado)
    certo: boolean               // os limites contam por pessoa (false = de todo mundo junto: vem aviso)
    cabecalhos: { nome: string; ips: string[] }[] // X-Forwarded-For, X-Real-IP, Forwarded… que chegaram (IPs mascarados)
    site24h: { pedidos: number; ips: number }     // pedidos do site (entrar, minhas vagas) e IPs diferentes em 24 h
  }
  instalacao: { codigoDev: boolean }
  // pede pela web, do próprio servidor: o banco, o log, um módulo, o instalacao.php, o .htaccess e um .php de mentira
  // em uploads/. ok = true (fechado, como deve), false (ABERTO), null (não deu pra saber)
  web: { testado: boolean; motivo: string; base: string; itens: { nome: string; status: number; ok: boolean | null }[] }
  avisos: string[]               // frases prontas do que precisa de atenção ([] = tudo certo)
}

interface Evento {
  id: number
  em: string
  origem: 'painel' | 'site' | 'pix' | 'sistema'
  usuario: string | null         // login de quem fez (painel)
  acao: string                   // 'rateio-criado', 'participacao-confirmada', 'participacao-expirada'…
  alvo: string                   // 'rateio:<id>', 'participacao:<codigo>', 'usuario:<login>'
  detalhe: object
  texto: string                  // frase pronta: 'Pagamento de RAT-K8EA confirmado', 'Fechou o rateio "Arizona…"', 'Entregou RAT-K8EA em "Arizona…"'
}
```

**Status do rateio** (`admin-rateio-status`): `rascunho → aberto`, `aberto → fechado`, `fechado → aberto` (reabrir;
apaga o `fechadoEm`), `fechado → pedido → caminho → chegou → encerrado`, e `cancelado` de qualquer um. Cada passo grava
a data. Lotou com o rateio aberto, ele fecha sozinho (evento `rateio-fechou-sozinho`); desconfirmar alguém depois não
reabre (o dono reabre se quiser).

**Status da participação** (`admin-participante-status`):

| De | Pode ir pra |
|---|---|
| `reservado` | `confirmado` (pagou: o contador sobe), `cancelado` |
| `expirado` | `confirmado` (pagou atrasado, se ainda couber), `reservado` (nova reserva, se couber), `cancelado` |
| `cancelado` | `confirmado` ou `reservado` (se couber e o WhatsApp não tiver outra vaga) |
| `confirmado` | `entregue`, `cancelado` (o contador desce), `reservado` (desfaz a confirmação; novo prazo) |
| `entregue` | `confirmado` (desfaz a entrega) |

Confirmar passa sempre por uma função só do servidor (`gc_confirmar_participacao`), a mesma que o webhook do Pix vai
chamar: confere a vaga, grava quem confirmou, audita e fecha o rateio se lotou.

Pedir o status que a vaga já tem (outro aparelho, ou o toque de novo depois do "demorou") não é erro: 200 com
`jaEstava: true`, e nada muda (nem a auditoria). Dois "confirmar" juntos: os dois 200, o contador sobe uma vez.

**Apagar dados (LGPD)**: `admin-participante-apagar` troca o nome por "Dados apagados", limpa WhatsApp, cidade e
observação e invalida o token do aparelho; quantidade, valor, status e datas ficam (as contas do rateio não mudam).
Essa vaga não volta: confirmar, reservar de novo, desfazer a entrega e editar dão 409 `dados-apagados` (o contador
nunca sobe por alguém sem nome nem WhatsApp); cancelar continua valendo.

**Cópia do banco**: `admin-backup` baixa o banco inteiro num arquivo só, já com o que estava no diário do SQLite
(copiar o `loja.sqlite` à mão pode sair sem as últimas mudanças). Tem nome, WhatsApp e tudo: guardar em lugar seguro.

## Banco: migrações por número

O banco cresce por migrações numeradas. Cada uma roda uma vez só, em ordem de número e numa trava só
(`BEGIN IMMEDIATE`), na primeira conexão depois de publicar, e fica anotada na tabela `migracoes` (`numero`,
`aplicada_em`). Cada frente tem a sua faixa, pra duas frentes nunca pegarem o mesmo número:

| Faixa | De quem | Onde |
|---|---|---|
| 1–99 | base (painel e rateio) | `nucleo/banco.php`, `gc_migracoes_base()` |
| 100–199 | loja (catálogo, estados, stories, ajustes, Teste minha sorte) | `nucleo/loja-migracoes.php`, `gc_migracoes_loja()` |
| 200–299 | pedidos, avisos, falas e contas | `nucleo/pedido-migracoes.php` (`gc_migracoes_pedidos()`) e `nucleo/contas-migracoes.php` (`gc_migracoes_contas()`) |

- Nunca edite uma migração que já foi pro ar: acrescente outra com o próximo número livre da faixa.
- Uma migração é SQL ou uma função que recebe o `PDO` (pra semear dados). A função roda dentro da trava, com a conexão
  ainda abrindo: nada de `gc_sql`/`gc_transacao`/`gc_evento` lá dentro, só o `PDO` que ela recebe.
- Banco de antes do registro (a versão ficava só no `PRAGMA user_version`, uma migração por número a partir do 1): o
  que o `user_version` diz conta como feito e entra no registro na primeira vez. O `user_version` segue contando a base
  em sequência, pra um código antigo que volte não tentar criar de novo o que já existe.
- O `gc_migracoes()` só soma a faixa de um módulo quando a função dele existe (`function_exists`). Na publicação os
  módulos sobem antes do `index.php` novo: no meio da subida, o index velho não carrega a loja e as migrações dela
  esperam a próxima chamada, sem erro.
- O Diagnóstico mostra em `dados.versaoBanco` o número da migração mais nova que rodou.

Hoje: `1` (base: ajustes, usuários, sessões, tentativas, eventos, rateios, participações), `100` (as tabelas da loja),
`101` (semeia a loja num banco instalado antes dela; banco novo é semeado na instalação do painel) e, dos pedidos e das
contas, `200`–`202` (pedidos, avisos, falas), `203` (equipe), `204` (clientes), `205` (cupons e giros), `206` (pedido
ligado à conta), `207` (WhatsApp conferido, aparelhos conhecidos, migração da conta do aparelho) e `208` (o pedido
mudado guarda qual ele substitui).

## Loja

O catálogo, os estados (canais), os stories do Início, os ajustes (WhatsApp, "restam X", a rua do mercador, textos)
e o Teste minha sorte moram no servidor, e o dono mexe neles pelo painel. O site lê tudo num JSON só (ver "Como o site
lê", logo abaixo).

A loja nasce da semente `nucleo/semente-loja.json`, gerada de `src/dados` (catálogo, canais, config, prêmios e textos)
por `node scripts/gerar-semente-loja.mjs`; o build e o `testar-api` recusam semente velha. Ela entra na instalação do
painel e, num banco já instalado, pela migração 101, com os "exemplo" (`demo`) de cada coisa. Depois de semeada, quem
manda é o painel: mexer em `src/dados` muda só o que vai embutido no site e a semente de um banco novo.

### GET `r=loja`

`{ ok: true, versao: number, atualizadoEm: string, loja: Loja }`

- **ETag** (`"<32 hex>"`: o mesmo conteúdo, o mesmo ETag) e `Cache-Control: no-cache`. O navegador guarda a resposta e
  pergunta de novo com `If-None-Match`; nada mudou → **304 sem corpo** (vale o ETag fraco `W/"…"`, a lista `"a", "b"`
  e o sufixo que o compressor do servidor põe, `"…-gzip"`). As outras rotas seguem `no-store`.
- `versao` sobe a cada mudança feita no painel (preço, estoque, estado, story, prêmio, texto, qualquer uma) e
  `atualizadoEm` é a hora dela.
- Antes da loja existir no servidor (painel ainda não instalado): **404 `sem-loja`**. O site segue com o que tem
  embutido (`src/dados`), que é a mesma loja da semente.
- Só o que o site mostra: nada de anotação do dono, estoque contado, produto ou estado desativado nem prêmio fora do
  jogo. Mapa vazio sai como `{}`.

**Como o site lê** (`src/store/loja.ts`):

1. A primeira tela sai com a loja guardada no aparelho (`gc-loja` no `localStorage`, a última que veio do servidor) ou,
   sem ela, com a embutida no build (`src/dados`, a mesma da semente). Nunca espera a rede.
2. No primeiro respiro depois da primeira pintura (na hora, se o `?uf=` do link ou o estado salvo não está na loja do
   aparelho: estado ativado no painel) pergunta `GET r=loja`; o navegador manda o `If-None-Match` sozinho e, sem
   mudança, recebe 304. Volta pra aba depois de 10 min fora: pergunta de novo (com o pedido guiado aberto, não).
3. Versão nova: o `loja` é conferido campo a campo (`src/store/loja-ler.ts`, num pedaço à parte que só baixa aí): item
   torto fica de fora, texto com palavra da lista volta pro embutido, prêmio passa pelas regras do `cupom.ts`; sem
   nenhum estado que feche, a resposta inteira é ignorada. Entra na tela de uma vez, num respiro do navegador, e o que
   não mudou continua o mesmo objeto (nada pisca nem recomeça).
4. Guardado: `{ formato: 2, build, versao, atualizadoEm, loja, pronta }` — o `loja` como veio e a `pronta` já
   conferida, que abre a primeira tela sem conferir de novo. Guardado por outro build (site publicado de novo), a
   `pronta` abre a primeira tela do mesmo jeito e o `loja` é conferido outra vez com as regras do build novo logo
   depois da conversa com o servidor. O `formato` sobe
   quando o jeito da `Loja` do site muda (aí a guardada só serve pra conferir de novo).
5. Fora do ar, lento (10 s), 403/5xx ou JSON torto: fica com o que tem. **404 `sem-loja`**: apaga o guardado e volta pra
   embutida.
6. Quem depende da loja do servidor espera a conversa com ele terminar (a leitura desiste em 10 s; rede de segurança
   em 12 s), nunca um prazo curto (no 4G lento a resposta passa de 4 s): o estado do link da bio ou o salvo que a loja
   do aparelho não conhece (estado ativado no painel: "procurando" e uma vaga preta no Início, em vez de "ainda não
   chegou aí", que só aparece se a resposta chegar sem o estado ou o pedido falhar) e os links diretos de um produto
   que ela não tem (criado no painel depois da última visita): a pergunta ao servidor sai na hora, sem esperar o
   respiro; `?produto=` abre a página "carregando" e `?p=` avisa "Abrindo o produto…" e abre o story quando a loja
   chega; produto que não veio nem depois da resposta (ou servidor fora do ar) sai da URL com um aviso. O palpite de IP
   num estado desses e o jogo (`?jogo=`, que existe na loja daqui) esperam no máximo 2,5 s.

```ts
interface Loja {
  whatsapp: string               // o WhatsApp da loja ('5533991139036'): onde o pedido fecha
  restamAte: number | null       // "restam X": o estoque contado chegou nesse número (null = nunca mostra)
  ruaNoStory: boolean            // a rua do mercador como 1º story do Início no celular (sem o ajuste, true)
  textos: { bio: string[]; fraseStory: string; sacolaVazia: string; falasMercado: string[] } // src/dados/textos-loja.ts
  categorias: { id: string; nome: string; curto: string; icone: string; bebida: boolean }[] // na ordem dos destaques
  produtos: ProdutoLoja[]        // só os que estão no site, na ordem da grade
  estados: EstadoLoja[]          // só os que estão no site, na ordem
  stories: Record<string, string[]> // uf → ids na ordem do dono; uf ausente = automático (o site escolhe, como hoje)
  sorte: {
    ligado: boolean              // desligado: o Teste minha sorte some do site
    regras: { girosSemConta: number; girosPorDiaComConta: number; reservaSemContaHoras: number }
    premios: PremioLoja[]        // só os que valem agora
  }
}

// O Produto do site (src/lib/tipos.ts), com o disponível já resolvido e o "restam".
interface ProdutoLoja {
  id: string
  nome: string
  tamanho?: string               // campo vazio fica de fora, como no catalogo.json
  detalhe?: string
  descricao?: string
  categoria: string
  preco: number | null           // null = "Consultar" (nunca inventar preço)
  combos?: { qtd: number; total: number }[]
  variacoes?: { id: string; nome: string; preco?: number }[]
  disponivel: Record<string, boolean> // cada estado do site: ligado nele e, com estoque contado, pelo menos 1
  restam: Record<string, number> // só os estados com de 1 a restamAte unidades contadas
  combinaCom?: string[]          // só ids de produtos que estão no site
  demo: boolean
  foto: string | null            // 'uploads/<nome>' (enviada pelo painel) ou 'produtos/<arquivo>' (do build do site)
  cor: string                    // '#rrggbb' (o halo)
  arte: { tipo: TipoArte; corpo: string; faixa?: string; rotulo?: string; detalhe?: string; tampa?: string }
}

// O Canal do site (src/dados/canais.ts).
interface EstadoLoja {
  uf: string
  nome: string                   // 'Minas Gerais'
  destaque: string               // a bolinha dos destaques ('DELIVERY MG')
  nomePerfil: string | null
  cidades: { slug: string; nome: string }[]
  instagram: string              // sem @
  whatsapp: string | null        // o próprio do estado; null = o da loja (sempre null com "o mesmo pra todos")
  horario: { semana: ([string, string] | null)[]; demo: boolean } // 7 dias, domingo primeiro; demo: de exemplo, o site não mostra
  taxaEntrega: { valor: number | null; demo: boolean }            // valor null = a confirmar
  entregaGratis: { diaSemana: number; dias: number[]; texto: string; demo: boolean } | null // diaSemana = dias[0]
  pagamento: { opcoes: ('pix' | 'dinheiro' | 'cartao')[]; demo: boolean }
  emblema: 'pao-de-acucar' | 'pedra-preciosa' | 'predio-sp' | 'convento-es' | 'ponte-sc' | 'generico' // generico: estado ativado no painel
}

// O Premio do site (src/dados/sorte.ts). Vale agora = ligado, tudo que ele cita no site e nada de bebida.
interface PremioLoja {
  id: string
  tipo: 'desconto-percentual' | 'leve-x-pague-y' | 'brinde'
  valor: number | { leve: number; pague: number } | { produto: string; qtd: number }
  titulo: string
  descricao: string
  regra: string
  aplicaA: { produtos?: string[]; categorias?: string[] }
  comoUsar?: string
  peso: number
  validadeDias: number
  demo: boolean
}
```

## Loja (painel)

Rotas `admin-*` da loja: dono, sessão, Origin e `X-CSRF` como as outras. Toda escrita roda numa transação, sobe a
`versao` da loja (o ETag do `GET loja` muda: o site vê na hora) e entra na Atividade com quem fez. As escritas
devolvem o pedaço novo e o carimbo `{ versao, atualizadoEm }`; salvar sem mudar nada não sobe a versão. Na edição,
campo ausente fica como está.

| Rota | Corpo | Sucesso |
|---|---|---|
| GET `admin-loja` | — | `{ loja: LojaAdmin }` |
| POST `admin-produto-salvar` | `ProdutoCorpo` (sem `id` cria) | 201 ou 200 `{ produto: ProdutoAdmin, versao, atualizadoEm }` |
| POST `admin-produto-estado` | `{ id, uf, disponivel?, estoque? }` | `{ produto, versao, atualizadoEm }` |
| POST `admin-produto-apagar` | `{ id }` | `{ versao, atualizadoEm }` |
| POST `admin-produtos-ordem` | `{ ids: string[] }` | `{ ordem, versao, atualizadoEm }` |
| POST `admin-categoria-salvar` | `{ id?, nome, curto?, icone, bebida? }` | 201 ou 200 `{ categoria, versao, atualizadoEm }` |
| POST `admin-categoria-apagar` | `{ id }` | `{ versao, atualizadoEm }` |
| POST `admin-categorias-ordem` | `{ ids: string[] }` | `{ ordem, versao, atualizadoEm }` |
| POST `admin-estado-salvar` | `EstadoCorpo` (UF que a loja não tem = ativar) | 201 ou 200 `{ estado: EstadoAdmin, versao, atualizadoEm }` |
| POST `admin-stories-salvar` | `{ uf, produtos: string[] }` | `{ uf, produtos, versao, atualizadoEm }` |
| POST `admin-loja-salvar` | `{ whatsapp?, mesmoWhatsappParaTodos?, restamAte?, ruaNoStory?, textos? }` | `{ ajustes, textos, versao, atualizadoEm }` |
| POST `admin-sorte-salvar` | `{ ligado?, girosSemConta?, girosPorDiaComConta?, reservaSemContaHoras? }` | `{ sorte, versao, atualizadoEm }` |
| POST `admin-premio-salvar` | `PremioCorpo` (sem `id` cria) | 201 ou 200 `{ premio: PremioAdmin, versao, atualizadoEm }` |
| POST `admin-premio-apagar` | `{ id }` | `{ versao, atualizadoEm }` |
| POST `admin-loja-exemplos-apagar` | `{ conferir: true }` ou `{ assinatura }` | `{ plano, assinatura, apagou, versao, atualizadoEm }` |

Regras (o servidor confere; o painel mostra o mesmo enquanto a pessoa digita):

- **Produto**: nome 2–60; tamanho até 20; detalhe até 60; descrição até 300; categoria que existe; `preco` `null` ou
  `''` = Consultar, senão de R$ 0 a R$ 100.000 (número ou `"14,90"`); `combos` até 5, quantidade 2–99 sem repetir,
  precisam do preço da unidade, cada um mais barato que avulso e o total subindo com a quantidade (conferidos de novo
  quando o preço muda); `variacoes` até 12, nome 1–40 sem repetir (sem olhar acento e caixa), preço opcional, o `id`
  fica o mesmo na edição; `combinaCom` até 8 produtos que existem (nunca ele mesmo); `foto` `'uploads/<nome>'` (o que o
  `admin-upload` devolveu: tem que existir) ou `'produtos/<arquivo>'`; `cor` `#rrggbb`; `arte` `{ tipo, corpo, faixa?,
  rotulo?, detalhe?, tampa? }` (tipo da lista do `TipoArte`, cores `#rrggbb`); `obs` até 300 (só no painel); `demo` e
  `ativo` sim/não; `estados` `{ <uf>: { disponivel: boolean, estoque: number | null } }`, só estados da loja, estoque de 0
  a 99.999. Tabaco e vape (a lista do Rateio) em nome, tamanho, detalhe, descrição ou variação → 422 `proibido`
  (`campo`, `termo`, `lista: 'tabaco'`); a gíria e a promessa da `PALAVRAS_PROIBIDAS` (`GC_LOJA_PALAVRAS_LOJA`:
  `fumaça`, `fumar`, `marofa`, `brisa`, `chapar`, `larica`, `prensado`, `420`, `grátis`, `frete`, `prazo`, `sorteio`, no
  começo de palavra; `420` só o número inteiro) nos mesmos campos → 422 `proibido` (`lista: 'palavras'`). "folha",
  "erva", "flor", "trago", "tapa" e "entrega" têm uso de verdade em produto e passam. Id novo = slug do nome + tamanho,
  único. Produto que é prêmio ou brinde não vai pra categoria de bebida nem ganha nome ou desenho de bebida (400,
  `campo: 'categoria' | 'nome' | 'arte'`).
- **Troca rápida** (`admin-produto-estado`): manda o valor novo, não "inverter" (dois toques iguais dão no mesmo).
  `estoque: null` = não contar; `0` = esgotado: sai do disponível sozinho e volta quando o estoque subir (se seguir
  ligado no estado).
- **Apagar produto**: só sem histórico (rateio ou prêmio que cita ele) → senão 409 `em-uso` (com `rateios` e
  `premios`): aí desativa (`ativo: false`), ele sai do site e o histórico fica. Apagar tira o produto do "Combina com"
  dos outros e dos stories.
- **Ordem** (produtos e categorias): os ids que vieram primeiro e quem não veio (criado noutro aparelho) depois, na
  ordem que tinha. Lista vazia, repetida ou com id que não existe → 400 (`campo: 'ids'`).
- **Categoria**: nome 2–30; curto 2–14 (sem curto, vale o nome se couber); `icone` `lata`, `garrafa`, `seda`,
  `piteira`, `cuia`, `dichavador`, `tesoura`, `sacola` ou `estrela`; `bebida` (categoria nova nasce bebida até o dono
  dizer que não; bebida nunca entra em prêmio). Virar bebida com prêmio valendo nela ou nos produtos dela → 400
  (`campo: 'bebida'`). Apagar só vazia (nenhum produto, nem desativado) e sem prêmio → senão 409 `em-uso` (com
  `produtos` ou `premios`). Nome e curto sem tabaco nem a gíria e a promessa (422, como no produto).
- **Estado**: `uf` uma das 27. UF que a loja ainda não tem = ativar um estado novo: Instagram e pagamento obrigatórios,
  emblema `generico`, horário "a confirmar" (fica de exemplo, que o site não mostra, até vir um), taxa a confirmar e
  nenhum produto à venda ainda. `destaque` 2–20 (padrão `DELIVERY <UF>`); `nomePerfil` 2–40 ou `null`; `instagram`
  (aceita `@`, maiúscula e o link do perfil colado); `whatsapp` do estado ou `null` (= o da loja); `cidades` até 30, de
  2 a 60 letras, sem repetir (`[{ nome }]` ou `['nome']`: o slug sai do nome); `horario` 7 dias, cada um `null` ou
  `['HH:MM', 'HH:MM']` (abre ≠ fecha; fechar antes de abrir = madrugada do dia seguinte), o erro diz o `dia`; `taxa`
  `null` (a confirmar) ou de R$ 0 a R$ 100.000; `entregaGratis` `null` ou `{ dias: number[] (0–6), texto (2–40) }`;
  `pagamentos` pelo menos um de `pix`, `dinheiro`, `cartao`; `ativo` (o último estado no site não sai: 409
  `ultimo-estado`). Horário, taxa, entrega grátis e pagamento que vierem deixam de ser exemplo, a não ser que venha
  junto `horarioDemo`, `taxaDemo`, `entregaGratisDemo` ou `pagamentosDemo: true`. Destaque, nome do perfil e cidades
  sem tabaco nem a gíria e a promessa (422, como no produto; o nome do perfil aparece no cabeçalho do site). A taxa de
  verdade e o dia de entrega grátis aparecem na sacola e na mensagem do pedido (`(taxa R$ 15,50)`,
  `(entrega grátis hoje)`); a de exemplo, não ("taxa a confirmar").
- **Stories**: até 8 (as barrinhas do topo), sem repetir, produtos que existem, `uf` da loja; lista vazia =
  automático. No `GET loja` passam só os que estão à venda no estado na hora (no site, ligado, com estoque); se nenhum
  estiver, o estado fica no automático.
- **Ajustes**: `whatsapp` (celular brasileiro); `mesmoWhatsappParaTodos` (o número de cada estado fica guardado);
  `restamAte` 1–99 ou `null`; `ruaNoStory` sim/não (a rua do mercador no começo do Início do celular; o painel mostra
  em Stories do Início); `textos` (só o que vier muda): `bio` 1–3 linhas de até 80 (até 150 no todo; linha em
  branco some), `fraseStory` 2–28, `sacolaVazia` 2–48, `falasMercado` 1–5 de até 32. Nos textos, tabaco (422,
  `lista: 'tabaco'`) e as `PALAVRAS_PROIBIDAS` do site (422 `proibido`, `lista: 'palavras'`, no começo de palavra:
  "tapa" não pega "etapa").
- **Regras do Teste minha sorte**: `girosSemConta` 1–3 (o primeiro giro sem conta é sempre livre),
  `girosPorDiaComConta` 1–5, `reservaSemContaHoras` 1–72, `ligado`.
- **Prêmio** (as regras de `src/lib/cupom.ts`): `tipo`; desconto 1–50 (%); leva 2–20 > paga 1–19; brinde
  `{ produto, qtd 1–10 }`; `aplicaA` `{ produtos?: até 20, categorias?: até 10 }`, pelo menos um, tudo existindo e nada
  de bebida (categoria marcada como bebida; ou produto com desenho de bebida, `GC_LOJA_ARTES_BEBIDA`: lata alta e as
  garrafas; ou com nome de bebida alcoólica, `GC_LOJA_ALCOOL`: os tipos, como whisky, gin, vodka, chope, saquê, e as
  marcas comuns, como Jack Daniels, Smirnoff, Heineken, Brahma, Skol, Campari; a mesma lista do site e do painel em
  `src/lib/alcool.ts`); `titulo` 2–60 (só no painel); `descricao` 2–40; `regra` 2–120;
  `comoUsar` até 160; `peso` 1–1000; `validadeDias` 1–30; `ativo`; `demo`. Textos sem tabaco nem as palavras da lista
  (422). Trocar o tipo pede o valor novo junto. Id novo = slug do título. Os cupons já guardados no site têm o retrato
  do prêmio: apagar não quebra nada.
- **Apagar dados de exemplo**: `conferir: true` só devolve o `plano` (`{ premios, rateios, manter, produtos,
  desativar }`, rateios com `pessoas`) e a `assinatura` dele; pra apagar, manda `{ assinatura }` (a da prévia que a
  folha mostrou): apaga de uma vez os prêmios de exemplo, os rateios de exemplo (com quem entrou neles) e os produtos de
  exemplo. Se o plano mudou desde a prévia (alguém entrou num rateio de exemplo, pagou, saiu), nada sai: 409 `mudou`,
  com o `plano` e a `assinatura` novos. Sem assinatura: 400 (`campo: 'assinatura'`). Rateio de exemplo com gente que
  pagou (confirmado ou entregue) nunca apaga: fica, como rateio de verdade (`manter`, com `pagas`; `demo` vira falso),
  com o histórico. Produto de exemplo com histórico de verdade (citado num rateio ou prêmio que fica) só sai do site
  (`desativar`). Os valores de exemplo dos estados saem quando o dono salva os de verdade.

Erros (além dos gerais e do `sem-sessao`/`csrf`): `invalido` 400 (com `campo`; às vezes `indice`, `dia`, `uf`),
`proibido` 422 (`campo`, `termo`, `lista`), `nao-encontrado` 404, `em-uso` 409, `ultimo-estado` 409, `mudou` 409
(apagar dados de exemplo).

```ts
interface LojaAdmin {
  versao: number
  atualizadoEm: string
  ajustes: { whatsapp: string; mesmoWhatsappParaTodos: boolean; restamAte: number | null; ruaNoStory: boolean }
  textos: Loja['textos']
  categorias: (Loja['categorias'][number] & { ordem: number; produtos: number; premios: { id: string; titulo: string }[] })[]
  produtos: ProdutoAdmin[]       // todos, até os desativados
  estados: EstadoAdmin[]         // todos, até os desativados
  stories: Record<string, string[]> // a lista inteira que o dono escolheu (o GET loja filtra o que não tá à venda)
  sorte: { ligado: boolean; girosSemConta: number; girosPorDiaComConta: number; reservaSemContaHoras: number; premios: PremioAdmin[] }
}

interface ProdutoAdmin {
  id: string
  nome: string
  tamanho: string                // '' quando vazio
  detalhe: string
  descricao: string
  categoria: string
  preco: number | null
  combos: { qtd: number; total: number }[]
  variacoes: { id: string; nome: string; preco: number | null }[]
  combinaCom: string[]
  foto: string | null
  cor: string
  arte: ProdutoLoja['arte']
  obs: string                    // anotação só do dono
  ativo: boolean                 // no site
  demo: boolean
  ordem: number
  estados: Record<string, { disponivel: boolean; estoque: number | null }> // só as linhas que existem (sem linha = desligado, sem contar)
  uso: { rateios: { id: string; titulo: string; demo: boolean }[]; premios: { id: string; titulo: string }[] }
  podeApagar: boolean            // sem histórico
  criadoEm: string
  atualizadoEm: string
}

// O EstadoLoja + o que é do dono. whatsapp: o próprio do estado, mesmo com "o mesmo pra todos" ligado.
interface EstadoAdmin extends Omit<EstadoLoja, 'entregaGratis'> {
  ativo: boolean
  entregaGratis: { dias: number[]; texto: string; demo: boolean } | null
  ordem: number
  atualizadoEm: string
}

interface PremioAdmin extends PremioLoja {
  ativo: boolean                 // no jogo
  ordem: number
  noSite: boolean                // vale no site agora (ligado, o que ele cita no site, nada de bebida)
  atualizadoEm: string
}
```

Auditoria (`alvo` → `produto:<id>`, `categoria:<id>`, `estado:<uf>`, `premio:<id>` ou `loja`): `loja-semeada`
(sistema), `produto-criado`, `produto-editado`, `produto-ativado`, `produto-desativado`, `produto-estado` (a troca
rápida: `MG: "Seda OCB" esgotado (0 un.)`), `produto-apagado`, `produtos-ordem`, `categoria-criada`,
`categoria-editada`, `categoria-apagada`, `categorias-ordem`, `estado-ativado`, `estado-desativado`, `estado-editado`,
`stories-salvos`, `loja-ajustes`, `sorte-regras`, `premio-criado`, `premio-editado`, `premio-ativado`,
`premio-desativado`, `premio-apagado` e `loja-exemplos-apagados`. Cada um com a frase pronta em `texto` (o
`loja-ajustes` só da rua diz o que ela faz: "Ligou a rua do mercador no começo do Início" ou "Desligou…").

**Sem os segredos dos avisos**: o token e o Client-Token do Z-API, a apikey da Evolution e o segredo e o endereço do
webhook saem da cópia (zerados, com `secure_delete` e `VACUUM`); quem voltar uma cópia põe eles de novo em Avisos no
WhatsApp. O sal fica (sem ele os hashes e os limites da cópia não batem).

## Equipe: papéis e permissões

Cada pessoa entra no painel com o login dela. Três papéis (`nucleo/equipe.php`):

| Papel | Pode | Estados |
|---|---|---|
| `dono` | tudo (todas as permissões, rota fora do mapa também) | todos |
| `gerente` | `conta`, `resumo`, `atividade`, `pedidos`, `pedidos-dados`, `rateios-ver`, `rateios`, `participantes`, `participantes-dados`, `imagens`, `produtos` | só os dele |
| `atendente` | `conta`, `resumo`, `atividade`, `pedidos`, `rateios-ver`, `participantes` | só os dele |

Permissões que existem (`GC_PERMISSOES`): as de cima mais `loja`, `avisos`, `textos`, `servidor`, `equipe` e
`clientes`, que só o dono tem. Na loja: `produtos` (ler a loja do painel, `admin-loja`, e mudar o disponível e o
estoque de um estado, `admin-produto-estado`, só nos estados de quem pede) e `loja` (o resto: produto, categorias,
estados, stories, textos da loja, Teste minha sorte e prêmios). No painel, Produtos e Loja ficam só pro dono por
enquanto: a tela de estoque do gerente (só o disponível e o estoque dos estados dele) é o passo seguinte.

**O mapa** (`GC_PERMISSAO_ROTA`): toda rota `admin-*` tem a permissão que pede, num lugar só. O `gc_exigir_dono()`
(que toda rota do painel já chamava) passou a conferir o mapa depois do CSRF: papel sem a permissão → 403
`sem-permissao` ("Teu acesso não deixa fazer isso. Fala com o dono da loja."). Rota que não está no mapa: só o dono
passa (gerente e atendente levam 403). As rotas abertas (`admin-sessao`, `-instalar`, `-entrar`, `-recuperar`) ficam
fora: não têm usuário ainda. O `testar-api` recusa rota `admin-*` do `index.php` sem linha no mapa.

**Rota nova**: põe a linha `'admin-<rota>' => '<permissão>'` no `GC_PERMISSAO_ROTA`
(`produtos` pra produto, estoque e disponibilidade; `loja` pra estados, stories, textos da loja e prêmios; ou outra
da lista), e, quando a rota lê ou muda coisa de um estado, filtra com `gc_filtro_ufs('<coluna uf>')` na lista e
`gc_exigir_uf($uf)` no item (403 `sem-permissao` com `motivo: 'estado'`). No painel, a seção nova em
`src/painel/secoes.ts` leva a mesma permissão (`permissao`) e os papéis que têm ela na barra do celular (`barra`).

**Só os estados de cada um**: gerente e atendente veem e mexem só no que é dos estados deles. Pedidos (lista,
contagem, detalhe, resumo), participantes (lista, CSV, incluir, mudar) e o Resumo filtram pelo `uf`; o rateio
aparece quando vale pra algum estado da pessoa, e mudar o rateio (salvar, status, apagar) pede que ele seja só dos
estados dela (`gc_exigir_rateio_inteiro`). De outro estado: 404 na lista/detalhe do rateio, 403 `sem-permissao`
(`motivo: 'estado'`) no pedido e na vaga. A Atividade de gerente e atendente mostra só o que a própria pessoa fez; a
situação dos avisos no WhatsApp (no Resumo e no pedido) vem `null`/`[]` pra quem não tem `avisos`.

**Senha provisória**: o dono cria o acesso (ou gera senha nova) e a senha aparece uma vez, em 3 grupos de 4 letras e
números sem os que confundem (`k7m2-x9q4-h3d8`; o banco guarda só o hash). Com ela, a sessão só passa em `admin-senha`
e `admin-sair` (o resto: 403 `trocar-senha`); trocar libera tudo (evento `senha-provisoria-trocada`). Gerar senha nova
derruba as sessões da pessoa; desativar também, e ela não entra mais (403 `desativado` depois da senha certa, que não
revela nada a quem não sabe a senha). Sempre sobra um dono ativo; ninguém muda o próprio papel.

| Rota | Corpo / parâmetros | Sucesso |
|---|---|---|
| GET `admin-usuarios` | — | `{ agora, usuarios: UsuarioAdmin[] }` (ativos e desativados) |
| POST `admin-usuario-salvar` | `{ novo: true, login, nome, papel, ufs }` cria · `{ login, nome?, papel?, ufs? }` edita | 201 `{ usuario, senhaProvisoria }` · 200 `{ usuario }` |
| POST `admin-usuario-senha` | `{ login }` | `{ usuario, senhaProvisoria }` (as sessões da pessoa caem) |
| POST `admin-usuario-status` | `{ login, ativo }` | `{ usuario, jaEstava? }` (desativar derruba as sessões) |

Erros: `nao-encontrado` 404 e `invalido` 400 com `campo`: `login` (repetido, fora do formato, a própria senha —
que se troca em Conta —, desativar a si mesmo ou o último dono ativo), `nome`, `papel` (que não existe, tirar o
próprio papel de dono, ficar sem dono), `ufs` (vazio pra gerente e atendente, estado que não existe), `ativo`.

```ts
interface UsuarioAdmin {
  login: string; nome: string; papel: 'dono' | 'gerente' | 'atendente'; ufs: string[]
  ativo: boolean; trocarSenha: boolean
  criadoEm: string; criadoPor: string; acessoEm: string | null; senhaEm: string; desativadoEm: string | null
  sessoes: number                // aparelhos logados agora
  eu: boolean                    // é quem está vendo
}
```

Na Atividade: `usuario-criado`, `usuario-editado`, `usuario-senha` (senha provisória nova), `usuario-desativado`,
`usuario-reativado`, `senha-provisoria-trocada`, `entrar-desativado` (alvo `usuario:<login>`).

## Contas dos clientes (site)

A conta do cliente fica na loja quando o servidor consegue mandar o código de entrada pelo WhatsApp: os Avisos no
WhatsApp ligados com um motor que manda mensagem pra número (Z-API ou Evolution) e o dono sem desligar em Clientes.
Sem isso, o site segue com a conta só no aparelho (como antes). O site pergunta no `recursos`.

- **Código**: 6 números, vale 10 min, 5 tentativas; valem os **2 últimos** do número (pedir outro não mata o que já
  chegou; o terceiro mata o primeiro; o chute errado conta nos dois; usado um, o outro para de valer). Vai pelo WhatsApp da loja:
  `*482913* é teu código pra entrar na Green Cheese. Vale por 10 minutos.` + `Não passa ele pra ninguém: a loja nunca
  pede esse código.` O banco guarda só o HMAC do código. A resposta do pedir é a mesma com ou sem conta (não revela se
  o número tem conta).
- **Limites**: 1 código por minuto por número; 3 em 15 min e 8 por dia por número; 10 por hora por IP; 20 por hora por
  rede (IPv4 /24, IPv6 /48); e o **teto da loja inteira** (30 por hora e 200 por dia, o dono muda em Clientes): batido,
  o entrar com código **pausa sozinho** (`recursos` diz `codigo: false`, o site volta pra conta do aparelho, o pedir
  código responde `sem-codigo` 409 com `pausado: true`, a Atividade registra `contas-codigo-pausado`) e volta sozinho
  quando a janela passa. No limite do número, se ainda tem código valendo, o 429 vem com `codigoValendo: true` (a tela
  vai pro passo do código: quem pede código pro número dos outros não trava a dona). Do **aparelho em que a conta já
  entrou** (`aparelho` no corpo), o limite do número é só dele. 30 entradas por hora por IP; 30 giros por dia por IP.
- **Cookie** `gc_cliente`: token de 32 bytes (o servidor guarda o hash), `HttpOnly`, `SameSite=Lax`, `Secure` no
  HTTPS, `Path` = pasta do site, 90 dias, desliza a cada uso; até 10 sessões por conta. Separado do `gc_painel`.

| Rota | Corpo / parâmetros | Sucesso |
|---|---|---|
| GET `recursos` | — | `{ contas: { codigo: boolean, sessao: boolean } }` (`codigo`: dá pra entrar com código; `sessao`: este aparelho tem conta aberta) |
| POST `cliente-codigo` | `{ whatsapp, motivo?: 'entrar' \| 'trocar', aparelho?, site: '' }` | `{ enviado: true, para: '(33) 9••••-4567', expiraEm, reenviarEm }` |
| POST `cliente-entrar` | `{ whatsapp, codigo, nome?, aceitaPromo?, aparelho?, migrar? }` | 201 (criou) / 200 `ContaEu & { criada, cupomGuardado, pendenteRecusado: 'ja-girou-hoje' \| null, migrados, pendente: null }` + cookie · sem conta e sem nome: 200 `{ precisaNome: true, campo: 'nome' }` (sem sessão; o código continua valendo) |
| GET `cliente-eu` | `[&aparelho=]` | `{ agora } & ContaEu` |
| POST `cliente-atualizar` | `{ nome?, aceitaPromo?, whatsapp?, codigo? }` (WhatsApp novo pede o código que foi pra ele, `motivo: 'trocar'`) | `{ conta }` |
| POST `cliente-sair` | `{}` | `{}`, apaga a sessão e o cookie |
| POST `cliente-apagar` | `{ confirmar: true }` | `{}` (LGPD: some a conta, endereços, cupons, códigos e sessões; os pedidos ficam com a loja, sem a conta) |
| GET `cliente-pedidos` | — | `{ pedidos: PedidoDaConta[] }` (os 30 últimos: os feitos com a conta logada e os do WhatsApp dela quando o número foi conferido) |
| GET `cliente-vagas` | — | `{ vagas: Participacao[] }` (as vagas feitas com a conta logada e as do WhatsApp dela quando conferido, sem token) |
| GET `cliente-exportar` | — | arquivo `greencheese-meus-dados-<data>.json` (conta, endereços, cupons, giros, pedidos, vagas; pedido/vaga achado só pelo número vai sem nome, endereço, observação, mensagem e cidade, com `achadoPeloWhatsapp`/`achadaPeloWhatsapp`) |
| POST `cliente-endereco-salvar` | `{ id?, apelido, cep, rua, numero, bairro, cidade, uf, livre }` (com CEP ou `livre`) | `{ enderecos }` (até 5) |
| POST `cliente-endereco-apagar` | `{ id }` | `{ enderecos }` |

Erros: `sem-codigo` 409 (o código está desligado: o site volta pra conta do aparelho), `sem-envio` 503 (o WhatsApp da
loja não mandou; o código não vale), `codigo-errado` 403 (com `restam`), `codigo-vencido` 403 (passou dos 10 min ou das
5 tentativas: pede outro), `whatsapp-existe` 409 (trocar pra um número que já tem conta), `limite-enderecos` 409,
`sem-sessao` 401 (o site larga a conta do servidor e volta pro "Entrar"), `invalido` 400 (com `campo`),
`muitas-tentativas` 429. O `site` é a armadilha de robô (preenchido → finge que mandou).

**Primeiro login com a conta do aparelho** (`migrar`): `{ nome, aceitaPromo, aceitaPromoEm, cupons: [{ codigo,
interativo, premioId, ganhoEm, validoAte }], pendente?, giros }`. Número sem conta na loja: a conta nasce com o nome e
as promoções do aparelho (`origem: 'aparelho'`, sem pedir o nome). Nada disso vem conferido (é o aparelho quem diz),
então: os cupons e o prêmio reservado entram **uma vez por conta** (a primeira vez que a conta recebe `migrar`), **no
máximo 2** (o prêmio reservado primeiro), só de prêmio que existe e **só os ganhos antes de a conta do servidor
existir** (o primeiro dia em que o entrar com código esteve ligado, guardado no ajuste `contas_desde`: depois disso
todo cupom nasce no servidor), com a validade contada do dia em que foram ganhos (`ganhoEm` + a validade do prêmio) e o
mesmo código quando está livre (`origem: 'aparelho'`). Os dias de giro do aparelho contam como giro da conta (sempre:
só restringem). `migrados` diz quantos cupons vieram.

**Pedidos e vagas da conta**: o pedido (ou a vaga) entra na conta quando foi feito com ela logada, ou quando o
WhatsApp dele foi **conferido**: veio da conta logada (que entrou pelo código) ou a loja salvou o número no painel
(`admin-pedido-salvar` com `whatsapp`, mesmo que seja o que já estava; a vaga incluída pelo painel ou com o WhatsApp
trocado no painel). O número que a pessoa digita no aparelho não liga nada a conta nenhuma.

**Pedido com a conta aberta**: o `POST pedido` liga o pedido à conta (`cliente_id`), completa o WhatsApp com o da
conta quando veio vazio (conferido quando é o da conta) e guarda o endereço da entrega na conta (o mesmo endereço não repete; o mais antigo sai depois
de 5). O pedido guiado oferece os endereços guardados do estado do atendimento.

```ts
interface ContaEu {
  conta: { id: string; nome: string; whatsapp: string; aceitaPromo: boolean; aceitaPromoEm: string | null; confirmou18Em: string; criadaEm: string }
  cupons: CupomConta[]
  enderecos: { id: number; apelido: string; cep: string; rua: string; numero: string; bairro: string; cidade: string; uf: string; livre: string; usadoEm: string }[]
  dias: { sorte: string[] }      // dias de Brasília em que a conta (ou o WhatsApp, ou o aparelho) girou
}
interface CupomConta {
  codigo: string                 // 'SORTE-K8EA'
  interativo: 'sorte'; premioId: string
  retrato: object                // o prêmio congelado no dia (titulo, regra, aplicaA, comoUsar, tipo, valor)
  demo: boolean; origem: 'giro' | 'aparelho' | 'conta'
  ganhoEm: string; validoAte: string; usadoEm: string | null
}
interface PedidoDaConta { codigo: string; tipo: 'pedido' | 'encomenda'; status: 'novo' | 'confirmado' | 'saiu' | 'entregue' | 'cancelado'; uf: string; cidade: string; resumo: string; unidades: number; subtotalTexto: string; criadoEm: string; atualizadoEm: string }
```

Na Atividade (sem o nome de ninguém): `cliente-criou-conta`, `cliente-atualizou`, `cliente-exportou`,
`cliente-conta-apagada` (pelo site ou pelo painel), `clientes-exportados` (CSV), `contas-codigo-ligado` /
`-desligado`, `contas-codigo-teto` (o dono mudou o teto), `contas-codigo-pausado` (a loja bateu o teto), `cupom-usado` /
`cupom-desfeito`. O envio do código fica no registro dos avisos (`codigo-login`) só com o número mascarado: o texto
"Código de entrada pra (33) 9••••-4567", o destino `{ tipo: 'numero', valor: '(33) 9••••-4567' }` (o número inteiro
vai só pro gateway, nunca pro banco) e o alvo `conta:<hash do número>`, que some quando a conta é apagada.

### Clientes no painel (só o dono, permissão `clientes`)

| Rota | Corpo / parâmetros | Sucesso |
|---|---|---|
| GET `admin-clientes` | `[&busca=][&promo=1][&antes=<id>][&limite=50]` | `{ agora, clientes: ClienteLinha[], mais, total, comPromo, codigo: { ligado, motor, desligadoPeloDono, teto: { hora, dia, usadosHora, usadosDia, pausadoAte } } }` |
| GET `admin-cliente` | `&id=` | `{ cliente, cupons, enderecos, pedidos, vagas, giros }` |
| GET `admin-clientes-csv` | — | arquivo `clientes-promocoes-<data>.csv` (`;`, BOM: Nome, WhatsApp, Estado, Aceitou promoções em, Conta criada em; só quem aceitou) |
| POST `admin-cliente-apagar` | `{ id }` | `{}` (o pedido de exclusão que chegou pela conversa; as sessões do cliente caem) |
| POST `admin-clientes-ajustes` | `{ codigo?: boolean, tetoHora?: 1–1000, tetoDia?: 1–10000 }` | `{ codigo }` (liga/desliga o entrar com código; o teto de códigos da loja inteira, o do dia nunca menor que o da hora) |
| POST `admin-cupom-usado` | `{ codigo, usado: boolean }` | `{ cupom }` (dar baixa / desfazer) |

## Teste minha sorte no servidor

Com a conta no servidor, quem sorteia é o servidor (o site só anima o resultado). Os prêmios vêm de
`gc_premios_ativos(?string $uf)`, em `nucleo/loja.php`: os mesmos que o site lê no GET `loja` (Teste minha sorte
ligado no painel, tudo o que o prêmio cita no ar e nada de bebida) e, no estado, só os que dá pra usar lá (algum produto
do prêmio à venda no estado e, no brinde, o brinde também). Sorte desligada no painel: lista vazia, e o giro responde
409 `sem-premio`. Antes da loja ser montada no servidor (painel sem instalar), valem os da semente:
`nucleo/premios-semente.php` (`gc_premios_da_semente`) lê `api/nucleo/premios-sorte.json`, gerado de
`src/dados/sorte.ts` (`node scripts/gerar-premios-sorte.mjs`; `--conferir` só confere; o `testar-api` recusa lista
velha). As regras (giros sem conta, giros por dia com conta e as horas da reserva) também vêm do painel
(`gc_sorte_regras`, as do GET `loja`); sem a loja no servidor, as de fábrica (1, 1 e 24 h, as de baixo). Contrato da função: devolve a lista de prêmios `{ id, tipo, valor, titulo, descricao, regra, aplicaA,
comoUsar, peso, validadeDias, demo, ufs? }` (o mesmo formato do `sorte.ts`); `uf` null = todos; com `uf`, os que valem
nesse estado (sem nenhum no estado, o sorteio usa todos). Bebida alcoólica nunca é prêmio (o gerador e o `testar-api`
recusam).

- Sem conta: **1 giro por aparelho** (o segredo `aparelho`, 32 hex, que o site guarda); o prêmio fica reservado pro
  aparelho por 24 h. Entrar ou criar a conta nesse aparelho guarda a reserva como cupom (`cupomGuardado`), e esse giro
  vira o giro daquele dia da conta: se a conta (ou o WhatsApp dela) já tinha girado no dia do giro reservado, não
  guarda (`pendenteRecusado: 'ja-girou-hoje'` no entrar; 409 `ja-girou-hoje` no `cliente-guardar`) e a reserva fica
  sem cupom — senão bastava girar sem o cookie num aparelho novo e guardar pra ter um giro a mais por dia.
- Com conta: **1 giro por dia** (dia de Brasília) por conta, por WhatsApp e por aparelho (trocar de conta no mesmo
  aparelho não dá giro a mais); o cupom já nasce guardado, com o código `SORTE-XXXX` gerado no servidor.

| Rota | Corpo / parâmetros | Sucesso |
|---|---|---|
| GET `cliente-giro` | `&interativo=sorte&aparelho=` | `{ agora, giro: { disponivel, motivo?: 'ja-girou-hoje' \| 'sem-conta-ja-girou', proximoEm?, girouHoje? }, pendente, dias }` |
| POST `cliente-girar` | `{ interativo, uf, aparelho }` | `{ agora, premioId, cupom: CupomConta \| null, pendente: Pendente \| null, dias }` |
| POST `cliente-guardar` | `{ interativo, aparelho }` (com sessão) | `{ cupom }` (409 `ja-girou-hoje` quando a conta já girou no dia daquele giro) |
| POST `cliente-cupom-usar` | `{ codigo }` (com sessão) | `{ cupom }` (o cupom foi no pedido; a loja desfaz no painel se precisar) |

Erros: `sem-giro` 409 (com `giro`), `sem-premio` 409, `sem-pendente` 409, `pendente-vencido` 409, `ja-girou-hoje` 409, `nao-encontrado`
404, `ja-usado` 409, `vencido` 409, `invalido` 400 (`interativo`, `aparelho`), `muitas-tentativas` 429.

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
  descrição com qualquer termo da lista (sem acento e sem caixa): `backwoods`, `charuto`, `cigarrilha`, `cigarro`,
  `cigarrete`, `tabaco`, `fumo`, `palheiro`, `rape` (como palavra inteira), `swisher`, `dutch master`, `black & mild`,
  `black and mild`, `al capone`, `djarum`, `essencia de narguile`, `vape`, `cigarro eletronico`, `pod descartavel`,
  `juul`, `ignite`, `elfbar`, `elf bar`.

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
| GET `admin-eventos` | — | `{ eventos: Evento[] }` (os últimos 100, do mais novo) |

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
interface Usuario { login: string; nome: string; papel: 'dono' }

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
| 200–299 | pedidos e contas | a frente dela acrescenta a função dela e o `+=` em `gc_migracoes()`, como a loja |

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

Hoje: `1` (base: ajustes, usuários, sessões, tentativas, eventos, rateios, participações), `100` (as tabelas da loja) e
`101` (semeia a loja num banco instalado antes dela; banco novo é semeado na instalação do painel).

## Loja

O catálogo, os estados (canais), os stories do Início, os ajustes (WhatsApp, "restam X", textos) e o Teste minha sorte
moram no servidor, e o dono mexe neles pelo painel. O site lê tudo num JSON só.

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

```ts
interface Loja {
  whatsapp: string               // o WhatsApp da loja ('5533991139036'): onde o pedido fecha
  restamAte: number | null       // "restam X": o estoque contado chegou nesse número (null = nunca mostra)
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
| POST `admin-loja-salvar` | `{ whatsapp?, mesmoWhatsappParaTodos?, restamAte?, textos? }` | `{ ajustes, textos, versao, atualizadoEm }` |
| POST `admin-sorte-salvar` | `{ ligado?, girosSemConta?, girosPorDiaComConta?, reservaSemContaHoras? }` | `{ sorte, versao, atualizadoEm }` |
| POST `admin-premio-salvar` | `PremioCorpo` (sem `id` cria) | 201 ou 200 `{ premio: PremioAdmin, versao, atualizadoEm }` |
| POST `admin-premio-apagar` | `{ id }` | `{ versao, atualizadoEm }` |
| POST `admin-loja-exemplos-apagar` | `{ conferir?: boolean }` | `{ plano, apagou, versao, atualizadoEm }` |

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
  (`campo`, `termo`, `lista: 'tabaco'`). Id novo = slug do nome + tamanho, único. Produto que é prêmio ou brinde não vai
  pra categoria de bebida nem ganha nome de bebida alcoólica (400, `campo: 'categoria' | 'nome'`).
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
  `produtos` ou `premios`).
- **Estado**: `uf` uma das 27. UF que a loja ainda não tem = ativar um estado novo: Instagram e pagamento obrigatórios,
  emblema `generico`, horário "a confirmar" (fica de exemplo, que o site não mostra, até vir um), taxa a confirmar e
  nenhum produto à venda ainda. `destaque` 2–20 (padrão `DELIVERY <UF>`); `nomePerfil` 2–40 ou `null`; `instagram`
  (aceita `@`, maiúscula e o link do perfil colado); `whatsapp` do estado ou `null` (= o da loja); `cidades` até 30, de
  2 a 60 letras, sem repetir (`[{ nome }]` ou `['nome']`: o slug sai do nome); `horario` 7 dias, cada um `null` ou
  `['HH:MM', 'HH:MM']` (abre ≠ fecha; fechar antes de abrir = madrugada do dia seguinte), o erro diz o `dia`; `taxa`
  `null` (a confirmar) ou de R$ 0 a R$ 100.000; `entregaGratis` `null` ou `{ dias: number[] (0–6), texto (2–40) }`;
  `pagamentos` pelo menos um de `pix`, `dinheiro`, `cartao`; `ativo` (o último estado no site não sai: 409
  `ultimo-estado`). Horário, taxa, entrega grátis e pagamento que vierem deixam de ser exemplo, a não ser que venha
  junto `horarioDemo`, `taxaDemo`, `entregaGratisDemo` ou `pagamentosDemo: true`.
- **Stories**: até 8 (as barrinhas do topo), sem repetir, produtos que existem, `uf` da loja; lista vazia =
  automático. No `GET loja` passam só os que estão à venda no estado na hora (no site, ligado, com estoque); se nenhum
  estiver, o estado fica no automático.
- **Ajustes**: `whatsapp` (celular brasileiro); `mesmoWhatsappParaTodos` (o número de cada estado fica guardado);
  `restamAte` 1–99 ou `null`; `textos` (só o que vier muda): `bio` 1–3 linhas de até 80 (até 150 no todo; linha em
  branco some), `fraseStory` 2–28, `sacolaVazia` 2–48, `falasMercado` 1–5 de até 32. Nos textos, tabaco (422,
  `lista: 'tabaco'`) e as `PALAVRAS_PROIBIDAS` do site (422 `proibido`, `lista: 'palavras'`, no começo de palavra:
  "tapa" não pega "etapa").
- **Regras do Teste minha sorte**: `girosSemConta` 1–3 (o primeiro giro sem conta é sempre livre),
  `girosPorDiaComConta` 1–5, `reservaSemContaHoras` 1–72, `ligado`.
- **Prêmio** (as regras de `src/lib/cupom.ts`): `tipo`; desconto 1–50 (%); leva 2–20 > paga 1–19; brinde
  `{ produto, qtd 1–10 }`; `aplicaA` `{ produtos?: até 20, categorias?: até 10 }`, pelo menos um, tudo existindo e nada
  de bebida (categoria marcada como bebida, ou produto com nome de bebida alcoólica: whisky, gin, vodka, rum, tequila,
  cachaça, conhaque, licor, cerveja, vinho…); `titulo` 2–60 (só no painel); `descricao` 2–40; `regra` 2–120;
  `comoUsar` até 160; `peso` 1–1000; `validadeDias` 1–30; `ativo`; `demo`. Textos sem tabaco nem as palavras da lista
  (422). Trocar o tipo pede o valor novo junto. Id novo = slug do título. Os cupons já guardados no site têm o retrato
  do prêmio: apagar não quebra nada.
- **Apagar dados de exemplo**: `conferir: true` só devolve o `plano` (`{ premios, rateios, produtos, desativar }`,
  rateios com `pessoas`); sem ele, apaga de uma vez os prêmios de exemplo, os rateios de exemplo (com quem entrou neles)
  e os produtos de exemplo. Produto de exemplo com histórico de verdade (citado num rateio ou prêmio que fica) só sai do
  site (`desativar`). Os valores de exemplo dos estados saem quando o dono salva os de verdade.

Erros (além dos gerais e do `sem-sessao`/`csrf`): `invalido` 400 (com `campo`; às vezes `indice`, `dia`, `uf`),
`proibido` 422 (`campo`, `termo`, `lista`), `nao-encontrado` 404, `em-uso` 409, `ultimo-estado` 409.

```ts
interface LojaAdmin {
  versao: number
  atualizadoEm: string
  ajustes: { whatsapp: string; mesmoWhatsappParaTodos: boolean; restamAte: number | null }
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
`premio-desativado`, `premio-apagado` e `loja-exemplos-apagados`. Cada um com a frase pronta em `texto`.

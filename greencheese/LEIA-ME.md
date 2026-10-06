# Green Cheese Imports — site (prévia)

Site único da Green Cheese para todos os estados: catálogo no formato dos stories da marca + pedido guiado que termina com a mensagem pronta no WhatsApp (ou na DM do Instagram) do atendimento certo. Estático, sem servidor, sem banco.

Prévia criada pela I&H Soluções Digitais.

---

## Rodar no computador

Precisa de Node 20 ou mais novo (testado com Node 22).

```bash
cd greencheese
npm install
npm run dev -- --host
```

O terminal mostra dois endereços:

- **Local**: `http://localhost:5173/` (no próprio computador);
- **Network**: `http://192.168.x.x:5173/` — abra esse no celular, na mesma rede Wi-Fi.

Para testar como o cliente chega pela bio de um perfil: `http://localhost:5173/?uf=mg` (ou `rj`, `sp`, `es`, `sc`).

## Gerar o site para publicar

```bash
npm run build
```

O site pronto fica na pasta `dist/`. Ele usa caminhos relativos: funciona em qualquer pasta ou subdomínio, sem regra de servidor.

Para conferir o build antes de subir: `npm run preview` e abra o endereço mostrado.

## Subir na Hostinger (oprojeto.online)

**No ar:** `https://oprojeto.online/greencheese/` (pasta `public_html/greencheese/`). Só essa pasta é do site; o resto do domínio não é tocado.

### Publicar uma atualização (automático)

```bash
npm run build
HOSTINGER_UPLOAD_URL=… HOSTINGER_AUTH=… HOSTINGER_AUTH_REST=… node scripts/publicar.mjs
```

A url e as duas chaves saem da API da Hostinger ("Generate upload URL" do site `oprojeto.online`, usuário da hospedagem) e valem por cerca de 6 horas — não vão para o repositório. O script sobe o `.htaccess` primeiro, os arquivos de `assets/` depois e o `index.html` por último (nunca fica um index apontando para arquivo que ainda não subiu). `SO=".htaccess,index.html"` sobe só os arquivos listados.

O `.htaccess` da pasta (vem de `public/.htaccess`) troca a política de segurança (CSP) da raiz do domínio por uma própria: a da raiz só deixa o site falar com o próprio domínio e bloquearia a detecção de estado (ipwho.is, geojs) e o CEP (BrasilAPI, ViaCEP). Também deixa o HTML sem cache (quem abre no celular vê a versão nova na hora) e os arquivos de `assets/` em cache de 1 ano (têm o hash no nome).

### Publicar à mão (hPanel)

O pacote pronto está em `entrega/greencheese-dist.zip` (é a pasta `dist/` zipada, com o `.htaccess`).

1. **hPanel** → **Sites** → `oprojeto.online` → **Gerenciador de Arquivos** → `public_html/greencheese/` (crie se não existir).
2. **Enviar** → `greencheese-dist.zip` → botão direito → **Extrair**. O `index.html` e o `.htaccess` têm de ficar direto em `greencheese/`.
3. Apague o zip do servidor e abra o endereço no celular.

Quer na raiz ou num subdomínio? Troque `urlPublica` em `src/dados/config.ts` e gere o build de novo (o endereço vai na imagem de compartilhamento e nos links da bio).

> O SSL (https) precisa estar ativo: a detecção de estado, o CEP e o "copiar pedido" dependem de https.

### Link para a bio de cada perfil

Cada perfil põe na bio o link do próprio estado (é a forma mais confiável de mandar o cliente pro atendimento certo):

| Perfil | Link da bio |
|---|---|
| @greencheese_importsrj | `https://oprojeto.online/greencheese/?uf=rj&cidade=rio-de-janeiro` |
| @greencheese_importsmg | `https://oprojeto.online/greencheese/?uf=mg&cidade=teofilo-otoni` |
| @greencheese_importssp | `https://oprojeto.online/greencheese/?uf=sp` |
| @greencheese_importses | `https://oprojeto.online/greencheese/?uf=es` |
| @greencheese_importssc | `https://oprojeto.online/greencheese/?uf=sc` |

Link direto de um produto (para o adesivo de link do story): `https://oprojeto.online/greencheese/?uf=mg&p=jack-daniels-old-no7-1l` — o id de cada produto está no `catalogo.json`. No site, o botão de compartilhar do story já copia esse link.

Na prévia, o selo **prévia** (canto de cima no celular, barra lateral no computador) abre um painel com esses links e com tudo que ainda falta.

---

## Abas e Home 2

O site é um app só, com três abas no molde do Instagram. O **Início** termina no story + perfil + rodapé; o resto fica nas outras abas:

| Aba | Endereço | O que tem |
|---|---|---|
| Início | `…/greencheese/?uf=mg` | story dos produtos (com "Enviar mensagem…" no pé, no celular), faixa dos perfis, perfil com "Ver loja" |
| Catálogo | `…/greencheese/?uf=mg&aba=catalogo` | destaques, busca, Só DISPONÍVEL, grade, encomenda e, no fim, o interativo (Teste minha sorte) e os reposts com o mercador |
| Por estado | `…/greencheese/?uf=mg&aba=estados` | os perfis de cada estado |

- **Celular:** barra fixa embaixo com Início, Catálogo (lupa), Teste minha sorte (no meio), Sacola (com o número de itens) e Por estado (o avatar da loja com o selo da UF). Tocar de novo na aba aberta sobe ao topo; a lupa tocada de novo no Catálogo vai até a busca. Num estado sem entrega a barra fica com 4 abas (sem o Teste minha sorte). Com o teclado aberto (busca, chat) a barra sai, como no Instagram — também no Android, onde a janela inteira encolhe com o teclado.
- **Celular deitado:** o story do Início cabe inteiro acima da barra (arte à esquerda; nome, preço e DISPONÍVEL à direita; VER PRODUTO e "Enviar mensagem…" numa linha só no pé). Celular grande deitado (900 px ou mais) pega o layout de computador; a lateral rola quando não cabe.
- **Computador:** a barra lateral troca as abas (Início, Buscar, Catálogo, Por estado), com a aba atual em negrito e o ícone cheio ("Buscar" fica ativo com a busca em uso; tocar em "Catálogo" volta o destaque para ele). Ctrl+clique ou o botão do meio abre a aba numa aba nova do navegador. Em janela baixa (notebook com a barra do navegador, enquete de local aberta) a lateral rola sozinha, sem levar a página.
- **Voltar:** cada troca de aba entra no histórico. O voltar do Android (e do navegador) fecha primeiro a camada aberta (story, página do produto, sacola, chat, jogo) e depois volta para a aba de antes, com a rolagem de antes. Um link direto (`?aba=catalogo`) não inventa um Início embaixo: voltar sai do site. Trocar de estado na aba Por estado leva ao Início, como trocar de conta no Instagram; se a troca foi feita com o chat aberto (ex.: "Trocar estado" dentro do pedido), o chat continua e o Início entra quando ele fechar.
- **Rapidez:** as abas escondidas usam `content-visibility: hidden` (o navegador guarda o layout e mostrar de novo é instantâneo) e o Catálogo é montado e calculado no tempo ocioso depois da abertura; trocar de aba não re-renderiza o catálogo nem o hero.
- Os links de sempre continuam valendo por cima de qualquer aba: `?p=`, `?produto=`, `?jogo=sorte`, `?chat=pedido`. Ex.: `?uf=mg&aba=catalogo&produto=jack-daniels-old-no7-1l` abre a página do produto e o voltar cai no Catálogo.
- O código das abas está em `src/lib/abas.ts` (URL e histórico) e `src/componentes/Abas.tsx` (as vistas).

### Home 2 (em teste)

A Home 2 é a mesma coisa com o **Teste minha sorte e o mercador no Início**:

- **Computador:** a partir de 1200 px de largura, um card de story menor à esquerda do perfil (como os stories vizinhos do instagram.com), com o adesivo "Tá com sorte hoje?" e o mercador abrindo o casaco; o story fica com a largura que sobra e com a altura da janela, então tudo cabe em notebook baixo. Em janela baixa o card fica compacto (sem o título, CTA numa linha) para o mercador não virar miniatura. Abaixo de 1200 px o card deita embaixo do perfil.
- **Celular:** o rosto do mercador piscando no meio da barra (no lugar do dichavador), o mercador como 2º story do Início (aparece aos 5 s, com a barrinha dele; deitado, mercador e adesivo ficam lado a lado) e, uma vez por sessão, o balão "Tá com sorte hoje?" saindo da barra logo depois que esse story passa (só em celular alto, sem cobrir nada).

Como ver:

- `https://oprojeto.online/greencheese/home2/` (atalho para compartilhar), `?home=2` em qualquer link ou o atalho digitado `?home2` (vira `?home=2` sozinho). A escolha fica lembrada enquanto a aba do navegador estiver aberta (as abas e o recarregar seguem nela). `?home=1` volta para a Home 1.
- No painel da prévia: **Versão da home** → Home 1 / Home 2, e o botão "Copiar link da Home 2".

**Aprovar a Home 2:** em `src/lib/home.ts`, trocar `HOME_PADRAO = 1` para `HOME_PADRAO = 2`, gerar o build e subir.

**Recusar a Home 2** (tirar do código): apagar `src/componentes/StoryMercador.tsx`/`.css`; em `Hero.tsx`, tirar o passo do mercador (`comMercador`) e o card (`vitrine`, `.hero-h2`); em `BarraAbas.tsx`, tirar `BalaoMercador` e o `RostoMercador` da aba do meio; em `Hero.css`, apagar o bloco "Home 2 no computador"; em `App.tsx`, o `BalaoMercador`; e, se quiser, `src/lib/home.ts`, `public/home2/` e a seção "Versão da home" do painel da prévia (`Lateral.tsx`). O mercador do repost no Catálogo não depende da Home 2.

> Num estado sem entrega (ex.: `?uf=ba`) o Início vira a tela "A Green Cheese ainda não chegou aí" e a Home 2 fica igual à Home 1.

---

## Onde trocar cada coisa

Tudo que o dono muda fica em `src/dados/`. Depois de mexer, rode `npm run build` e suba de novo.

### Número de WhatsApp de cada estado — `src/dados/canais.ts`

Em cada estado, troque `whatsapp: null` pelo número com 55 + DDD + número, só dígitos:

```ts
whatsapp: '5533999998888',
```

Com número, o botão "Enviar no WhatsApp" abre a conversa direto com a loja. Sem número (`null`), o WhatsApp abre para a pessoa escolher o contato, e ao lado tem "Copiar pedido e abrir a DM do Instagram".

No mesmo arquivo: cidades atendidas (`cidades`), horário (`horario`), taxa de entrega (`taxaEntrega`), formas de pagamento (`pagamento`) e o "Sextou com entrega grátis!" de MG (`entregaGratis`). Quando trocar um valor de demonstração pelo real, mude também `demo: true` para `demo: false`.

Estado com mais de uma cidade: liste todas em `cidades` — o site pergunta a cidade.

### Produto, preço e disponibilidade — `src/dados/catalogo.json`

Cada produto:

```json
{
  "id": "jack-daniels-old-no7-1l",
  "nome": "Jack Daniel's Old No. 7",
  "tamanho": "1 L",
  "categoria": "destilados",
  "preco": 149.9,
  "disponivel": { "rj": true, "mg": true, "sp": true, "es": false, "sc": true },
  "demo": false,
  "foto": null
}
```

- **Preço**: número com ponto (`149.9`). Sem preço: `null` → aparece "Consultar" (nunca inventar).
- **Combo** (ex.: 2 por R$ 14,99): `"combos": [{ "qtd": 2, "total": 14.99 }, { "qtd": 3, "total": 19.99 }]` — a sacola aplica o melhor preço sozinha.
- **Variações** (ex.: piteira flat/slim): `"variacoes": [{ "id": "flat", "nome": "Flat · 6 mm × 3,5 cm" }]`.
- **Disponível/indisponível**: `true`/`false` por estado. Indisponível continua aparecendo, em cinza, com "Avisar quando chegar".
- **Descrição** (página do produto): `"descricao"`, 1 ou 2 frases curtas, só fato certo do produto (sem promessa de preço, frete ou prazo). Sem ela, a página só omite o bloco.
- **Produto novo**: copie um bloco parecido, troque o `id` (sem espaço e sem acento) e os dados. Enquanto não tiver ilustração nem foto, ele aparece em pixel art feita a partir de `arte` (tipo e cores) e `cor` (halo).
- **`demo: true`** = produto de exemplo. Ele só aparece na prévia; com `modoPrevia: false` some do site.

### Imagem dos produtos

Hoje os 17 produtos são **ilustrações realistas em código** (SVG), uma por produto, em `src/arte/realista/` (latas, destilados, papel, acessórios). O registro fica em `src/arte/realista/index.ts`: o `id` do produto aponta para o desenho. Ao entrar na tela, o produto "sintoniza": chiado → pixel art → produto real. Indisponível aparece em cinza com chiado por dentro.

Para usar **foto** no lugar da ilustração:

1. Ponha os prints/fotos em `referencias/` e liste em `scripts/recortes.json` qual arquivo é de qual produto.
2. `npm run recortar` → as fotos saem em `public/produtos/*.webp` (fundo recortado) e o catálogo passa a usar (`"foto"` no produto).

A foto ganha prioridade sobre a ilustração e recebe o mesmo halo, a mesma revelação e o mesmo cinza de indisponível.

### Teste minha sorte: como trocar os prêmios — `src/dados/sorte.ts`

Cada prêmio é um bloco na lista `premios`:

```ts
{
  id: 'ocb-4-por-3',                       // único, sem espaço
  tipo: 'leve-x-pague-y',                  // 'desconto-percentual' | 'leve-x-pague-y' | 'brinde'
  valor: { leve: 4, pague: 3 },            // percentual: 15 · brinde: { produto: 'piteira-de-papel-raw', qtd: 1 }
  titulo: '4 por 3 na OCB',                // curto (cabe num chip)
  descricao: 'Compra 3, leva 4.',          // 1 frase no cartão
  regra: 'Leva 4 Seda OCB Premium Slim e paga 3', // frase completa: é ela que vai na linha do WhatsApp
  aplicaA: { produtos: ['seda-ocb-premium-slim'] }, // ids do catalogo.json (ou { categorias: ['sedas'] })
  comoUsar: 'Põe 4 na sacola e usa o cupom.',       // opcional
  peso: 30,                                // chance relativa (não precisa somar 100; nunca aparece na tela)
  validadeDias: 7,                         // conta a partir de quando a pessoa guarda (1 a 30)
  papel: 'branco',                         // cor do beck e do cartão: 'branco' (OCB) ou 'natural' (RAW, padrão)
  demo: true,                              // exemplo: só aparece na prévia
}
```

- **Todo giro ganha**: o peso decide qual sai, e só entre os prêmios que valem no estado de quem gira (produto disponível lá).
- **A validação recusa** (em dev o site para com o erro na tela; no ar, o prêmio é descartado com aviso no console): id repetido; produto ou categoria que não existe no `catalogo.json`; prêmio ou brinde em **bebidas ou destilados**; peso ≤ 0; validade fora de 1–30; percentual fora de 1–50; leve ≤ pague; e qualquer palavra da lista `PALAVRAS_PROIBIDAS` (folha, erva, fumaça, grátis, frete, prazo, sorteio, cigarro, tabaco…) no título, descrição, regra ou "como usar".
- Promoção de verdade: `demo: false`. Com `modoPrevia: false`, os de exemplo saem; sem nenhum prêmio válido, o "Teste minha sorte" some do site inteiro (destaque, lateral, adesivo, sacola) e o link `?jogo=sorte` é ignorado. Também some em estado que a loja não atende (o cupom não serviria lá).
- A validade que aparece nas Regras sai de `validadeDias` ("vale 7 dias" quando todos os prêmios têm a mesma; senão, "até a data escrita no cupom").
- Limites (`regrasSorte`): 1 giro sem conta (para sempre, no aparelho), 1 giro por dia com conta (vira à meia-noite de Brasília), prêmio sem conta reservado por 24 h. Na prévia, tudo fica só no aparelho; na versão oficial, o servidor valida (ver PENDENCIAS.md).
- A copy do jogo fica em `src/interativos/sorte/textos.ts`; a das entradas do site (destaque, lateral, adesivo, sacola), em `src/interativos/sorte/textos-entrada.ts`.
- Link direto: `https://oprojeto.online/greencheese/?uf=mg&jogo=sorte` abre o jogo depois do +18.
- O próximo interativo entra com uma linha em `src/interativos/registro.ts`, o jogo em `src/interativos/<id>/` e a tabela de prêmios dele em `src/dados/`.
- Conferir a mensagem do pedido (sem cupom, igual ao formato de sempre; com cupom, +1 linha): `node scripts/conferir-mensagem.mjs`.

### Disponibilidade pelo celular (opcional) — planilha do Google

Crie uma planilha com as colunas `id, preco, rj, mg, sp, es, sc` (disponível = `sim`/`não`), publique em **Arquivo → Compartilhar → Publicar na Web → CSV** e cole o link em `planilhaCsvUrl` no `src/dados/config.ts`. O site lê a planilha toda vez que abre; se ela falhar, usa o `catalogo.json`.

### Tirar do modo prévia — `src/dados/config.ts`

`modoPrevia: false` tira o selo "prévia", o crédito da I&H no rodapé, as marcas "demo"/"exemplo", os produtos de exemplo e o `noindex` (o Google passa a poder indexar).

### Outras peças

- Logo: `src/arte/Logo.tsx` (SVG). Favicon: `public/favicon.svg`.
- Imagem de compartilhamento (WhatsApp/Instagram): `npm run og` com o `npm run dev` rodando → `public/og.png` e `public/apple-touch-icon.png`.
- Revisão por screenshots: `npm run revisao` com o dev rodando → `revisao/<rodada>/`.
- Mapa do Brasil ("Por estado", estado sem atendimento e seletor de estado): pixel art com o formato de verdade de cada estado, em `src/dados/mapa-brasil.ts` (uma letra por estado, dá pra ver o Brasil no arquivo). Ele é **gerado** da malha das UFs do IBGE (API de malhas, qualidade mínima) por `node scripts/gerar-mapa-brasil.mjs` (baixa a malha; ou passe um GeoJSON já baixado: `node scripts/gerar-mapa-brasil.mjs malha.json`; `--previa /tmp/mapa` desenha PNGs ampliados para conferir). O site não busca nada no ar. Crédito: **Fonte: IBGE** (aparece embaixo do mapa do "Por estado"). Estado atendido novo aparece aceso sozinho (vem de `canais.ts`); se ele ficar fora da lupa, ajuste `LUPA_UFS` no script e gere de novo. Cidade nova com pino no mapa: coordenada em `CIDADES` no script.

## O que o site faz

- Abertura em formato de story com a pergunta +18 (lembrada por 30 dias) e o adesivo de localização.
- Estado do cliente nesta ordem: link da bio (`?uf=`), escolha salva, palpite pelo IP (sempre pergunta "Você está em …?"), escolha manual com os 27 estados.
- Três abas (Início, Catálogo, Por estado), com barra de abas no celular e barra lateral no computador; o voltar do Android passa pelas abas (ver "Abas e Home 2").
- Catálogo por estado com disponível/indisponível, categorias como destaques, busca, "Só DISPONÍVEL ✅".
- Story do topo (hero): passa sozinho; toque nas bordas ou arrastar de lado passa e volta; no computador, setas ao lado do story e ← →. Na primeira visita, uma dica mostra onde tocar.
- Página do produto ("aba"): tocar no produto do story ou em "VER PRODUTO" abre a página com descrição curta, preço, disponibilidade no estado, formato e combos, quantidade, "Adicionar à sacola", "Pedir este item" e "Combina com". Voltar pelo botão do topo, pelo voltar do Android ou Esc. Cada produto tem link próprio (`?produto=<id>`), que abre direto depois do +18 (segurar o dedo ou Ctrl+clique abre em aba nova). No story do produto, "Mais opções" → "Ver detalhes do produto".
- Story do produto com barrinhas, toque nas laterais, segurar para pausar, arrastar para baixo para fechar, setas e Esc no teclado.
- Sacola com combo automático, pedido guiado em formato de DM (CEP preenche o endereço), mensagem pronta para o WhatsApp do estado ou para a DM.
- Encomenda ("Não achou? A Green Cheese importa."), "Avisar quando chegar", todos os Instagrams.
- "Segue o perfil do teu estado": mapa do Brasil em pixel (atendidos acesos, os outros em pontinhos apagados) com uma lupa no Sudeste + SC, onde cada estado atendido é um botão (a sigla do estado do cliente vira o adesivo de localização em miniatura: pino + "MG"); tocar num estado sem atendimento mostra "ainda não chegou" com Encomendar (fecha no X, no Esc ou tocando fora). Ao lado, a lista dos perfis no molde do "trocar de conta" do Instagram (na ordem do mapa, de cima pra baixo): tocar troca o site de estado. Mapa e lista ficam lado a lado quando a própria seção tem 910 px ou mais (container query; a coluna do mapa precisa caber o Brasil com a lupa); mais estreito, a lista vai embaixo. O tamanho das células e o lugar da lupa saem de `planejar()` em `MapaBrasil.tsx` (sempre em escala inteira, sem passar da largura da coluna nem da altura da tela).
- Sacola e respostas ficam salvas no aparelho; o botão voltar do Android fecha a camada aberta.
- **Teste minha sorte** (aba do meio da barra no celular, destaque "Sorte", item na lateral, card no fim do Catálogo, convite discreto na sacola; na Home 2, também no Início): gira a tampa do dichavador com o dedo (ou o botão "Girar", as setas, Espaço/Enter segurado, a roda do mouse); ele abre, sai um beck bolado e o beck desenrola no cupom. O 1º giro é sem conta; pra guardar e usar o cupom, cria conta com nome e WhatsApp. Com conta: 1 giro por dia, cupons em "Minha conta" e o nome já no pedido. O cupom aplicado vira uma linha na mensagem do WhatsApp; a loja confirma o desconto (o subtotal do site não muda).

Derivados do tabaco não entram no site (Anvisa, RDC 840/2023, art. 6º).

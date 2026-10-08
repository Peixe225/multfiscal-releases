# Green Cheese Imports — site (prévia)

Site único da Green Cheese para todos os estados: catálogo no formato dos stories da marca + pedido guiado que termina com a mensagem pronta no WhatsApp da loja, (33) 99113-9036 (o Pix direto no site aparece como "Em breve"). Dúvida fora do pedido vai pro Instagram do estado. Estático, sem servidor, sem banco.

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

## Abas e Início

O site é um app só, com três abas no molde do Instagram. O **Início** é o perfil da loja de cima a baixo e acaba na grade do catálogo:

| Aba | Endereço | O que tem |
|---|---|---|
| Início | `…/greencheese/?uf=mg` | story dos produtos (no celular, a rua da loja vem primeiro e o "Enviar mensagem…" fica no pé), faixa dos perfis, perfil com "Ver loja", destaques e a grade do catálogo (a caixa "Não achou? A Green Cheese importa." é a última célula), rodapé |
| Catálogo | `…/greencheese/?uf=mg&aba=catalogo` | destaques, busca, Só DISPONÍVEL, grade, encomenda e, no fim, o interativo (Teste minha sorte) e os reposts com o mercador |
| Por estado | `…/greencheese/?uf=mg&aba=estados` | os perfis de cada estado |

**O Início:**

- **Celular:** story (a rua viva primeiro, depois os produtos) → faixa dos @ → perfil ("Enviar mensagem", "Ver no Instagram", "Ver loja") → destaques → grade → rodapé. Sem busca e sem "Só DISPONÍVEL" (a busca é a lupa da barra) e sem o Teste minha sorte e o repost do fim da aba Catálogo. O mercador do Início do celular mora no story da rua (nada entre a faixa dos @ e o perfil).
- **Destaques do Início** (uma linha só, rola de lado): primeiro os que levam a outro lugar — o destaque do estado (moto, abre o story de atendimento), **Buscar** (abre o Catálogo com o cursor na busca), **Sorte** (abre o Teste minha sorte, com o anel aceso e o selo "novo") e **Por estado** (o pino com o selo da UF) —, um fio fino e, à direita, os filtros (Tudo, Importadas, Destilados, Sedas, Piteiras, Acessórios), que filtram a grade do próprio Início. No celular a linha é mais compacta (bolinhas de 56 px até 400 px de largura, 60 px até 479), para o "Tudo" aparecer inteiro na primeira tela com o filtro seguinte espiando na borda — o sinal de que a linha rola (em 360 px, 15 px do "Importadas"; em 390, 45). No computador, quando a linha não cabe (de 900 a ~1170 px), aparecem setas nas pontas, como na bandeja de destaques do instagram.com, e Shift + roda anda a linha de lado. Na aba Catálogo os destaques continuam como eram.
- **"Ver loja"** do perfil desce até os destaques (suave; corte seco com movimento reduzido) e leva o foco junto.
- **Computador:** a linha de cima é [mercador | perfil | story], depois a faixa, os mesmos destaques e a mesma grade (na moldura da aba Catálogo) e o rodapé. O mercador fica de pé ao lado do perfil, com os pés na linha do "Ver loja" e uma sombra de chão em pixel: sem moldura, sem texto e sem link (decorativo). Abre o casaco (e dá uns tragos, com `mercadorTraga`) só na tela, com a aba do navegador à vista e sem camada por cima; o mouse em cima abre o casaco na hora. A escala é inteira (3× até 1439 px de largura, 4× de 1440, 5× de 1800) e sai da sobra da coluna do perfil (o perfil fica com 285 px ou mais, compacto abaixo de 380): o story nunca encolhe por causa dele.
- **Mercador por largura** (sempre à vista no computador, nunca some): de 900 a 1199 px o hero empilha — story em cima, centrado com as setas, e mercador + perfil logo abaixo. De 1200 em diante fica [mercador | perfil | story] sempre que o 3× cabe ao lado do perfil (1200×720, 1240×800, 1280×650/800/1024, 1300×1000, 1366 e acima); onde não cabe — janela alta de 1200 a ~1270 px, como 1200×900 e 1260×900 — o hero empilha igual ao de 900 a 1199 em vez de tirar o mercador. Quem decide é uma régua invisível no hero (`.hero-regua`, com as mesmas variáveis do arranjo lado a lado), então a escolha não oscila. O código: `src/componentes/MercadorLoja.tsx` e `useLojaDesktop` em `Hero.tsx`.

**Abas:**

- **Celular:** barra fixa embaixo com Início, Catálogo (lupa), Teste minha sorte (o dichavador, no meio), Sacola (com o número de itens) e Por estado (o avatar da loja com o selo da UF). Tocar de novo na aba aberta sobe ao topo; a lupa tocada de novo no Catálogo vai até a busca. Num estado sem entrega a barra fica com 4 abas (sem o Teste minha sorte). Com o teclado aberto (busca, chat) a barra sai, como no Instagram — também no Android, onde a janela inteira encolhe com o teclado.
- **Celular deitado:** o story do Início cabe inteiro acima da barra (a rua na faixa larga, entre o cabeçalho e o pé; nos produtos, arte à esquerda; nome, preço e DISPONÍVEL à direita; VER PRODUTO e "Enviar mensagem…" numa linha só no pé). Celular grande deitado (900 px ou mais) pega o layout de computador; a lateral rola quando não cabe.
- **Computador:** a barra lateral troca as abas (Início, Buscar, Catálogo, Por estado), com a aba atual em negrito e o ícone cheio ("Buscar" fica ativo com a busca em uso; tocar em "Catálogo" volta o destaque para ele). Ctrl+clique ou o botão do meio abre a aba numa aba nova do navegador. Em janela baixa (notebook com a barra do navegador, enquete de local aberta) a lateral rola sozinha, sem levar a página.
- **Voltar:** cada troca de aba entra no histórico. O voltar do Android (e do navegador) fecha primeiro a camada aberta (story, página do produto, sacola, chat, jogo) e depois volta para a aba de antes, com a rolagem de antes. Um link direto (`?aba=catalogo`) não inventa um Início embaixo: voltar sai do site. Trocar de estado na aba Por estado leva ao Início, como trocar de conta no Instagram; se a troca foi feita com o chat aberto (ex.: "Trocar estado" dentro do pedido), o chat continua e o Início entra quando ele fechar.
- **Rapidez:** as abas escondidas usam `content-visibility: hidden` (o navegador guarda o layout e mostrar de novo não recalcula nada; sem `inert`, que recalcularia a vista inteira a cada troca; o papel de região "Início" só fica na vista à vista, para o leitor de tela não anunciar uma região vazia nas outras abas) e cada card fora da tela usa `content-visibility: auto`. A grade do Início e o Catálogo montam no tempo ocioso depois da abertura, um de cada vez, numa transição do React (o toque passa na frente); trocar de aba não re-renderiza o catálogo nem o hero, e sem camada aberta a troca sai no mesmo quadro do toque. O filtro anima a grade só com transform (Flip no modo simples).
- Os links de sempre continuam valendo por cima de qualquer aba: `?p=`, `?produto=`, `?jogo=sorte`, `?chat=pedido`. Ex.: `?uf=mg&aba=catalogo&produto=jack-daniels-old-no7-1l` abre a página do produto e o voltar cai no Catálogo.
- O código das abas está em `src/lib/abas.ts` (URL, histórico e o "Ver loja") e `src/componentes/Abas.tsx` (as vistas); a loja do Início é o mesmo `Catalogo.tsx` com `onde="inicio"` (ids próprios: `inicio-loja`; o `#catalogo` é da aba Catálogo, que o chat e a rolagem usam).

**Links velhos da Home 2** (a versão em teste com o Teste minha sorte e o mercador no Início, que saiu): `https://oprojeto.online/greencheese/home2/` (e `Home2/`, `HOME2/`, que o `scripts/publicar.mjs` sobe junto) leva para a home de sempre mantendo o resto do link (`home2/?uf=rj` abre no RJ); `?home=2`, `?home2`, `?Home2`, `?home=1` num link já enviado saem da URL sozinhos e nada muda.

> Num estado sem entrega (ex.: `?uf=ba`) o Início vira a tela "A Green Cheese ainda não chegou aí", sem destaques nem grade.

## Início vivo e Mercado

> Esta seção vale por cima do que as outras dizem: a aba **Catálogo agora se chama Mercado** e o mercador saiu de pé ao lado do perfil para **morar na rua viva** do Início (no celular, ela é o primeiro story).

**A rua viva do Início.** Uma rua de madrugada em pixel art — muro, poste com a luz em pontilhado e o gato nos engradados debaixo dela, a porta da loja com o letreiro GC em néon — onde o mercador vive e vende:

- **Entre um cliente e outro** ele olha quem foi embora (ou acena), anda até um ponto, para, olha em volta, **bebe a Fanta Ghost Face Punch** (tira do casaco, gole de cabeça inclinada, guarda), faz carinho no gato e espera no ponto. Bebe uma vez sim, outra não; carinho no gato no máximo uma vez sim, outra não.
- **Quatro clientes**, sorteados num saco embaralhado (os quatro passam antes de alguém voltar e nunca o mesmo duas vezes seguidas), um por vez. Cada um: entra, chega perto, fala, o mercador responde, entrega, recebe e o cliente faz a coisa dele:
  - **skatista** chega rodando e freia arrastando o pé, pede seda, aponta "esse aí" no casaco aberto, pega o livreto, paga com nota e sai remando: volta por onde veio ou segue em frente pela beira da calçada, passando na frente do mercador, e só dá o ollie depois de passar por ele;
  - **motoboy** chega no asfalto e encosta; o mercador desce até o meio-fio, entrega a sacola GC (vai por cima do ombro para a bag), pisca o farol e faz joia, o mercador acena e a moto arranca com as linhas de velocidade, passando na frente dele;
  - **MC** chega no beat, toque de mão em 3 tempos (a nota passa no aperto: paga no toque), pega a Arizona e sai dançando, com notas musicais saindo do fone;
  - **turista** chega lendo o mapa e quase esbarra (o "!"), pergunta se é ali a GC, tira foto do mercador de casaco aberto (flash na lente), pega a piteira, paga e sai feliz.
- Ciclo de uns 20 a 35 s; o cliente que anda devagar já vem entrando enquanto o mercador volta para o ponto (nada de vazio longo) e ninguém atravessa ninguém. Falas curtas em balão, uma por vez, que não cobrem a cabeça de ninguém nem o letreiro GC (sem lugar de lado, o balão quebra em duas linhas, com a cauda sempre em cima de quem fala), em `src/componentes/rua/falas.ts` ("Chega mais.", "Vem no certo!", "Quem já usou sabe da qualidade"…); "Sextou!" só às sextas. Nada de álcool ou tabaco na rua: ele bebe refrigerante e o forro do casaco só mostra refrigerante e acessório.
- **Tocar**: no mercador, ele abre o casaco (assim que termina o que está fazendo; no meio de um atendimento, logo depois dele), fala e aparece o adesivo **VER O MERCADO**, que leva à aba Mercado; num cliente, ele reage (pop shove-it, farol e joia, pose de b-boy, selfie); no gato, ele empina a cabeça. Pelo teclado, o botão "Chamar o mercador" (por cima dele) faz o mesmo e o Tab seguinte cai no "Ver o Mercado". Na faixa do computador, o botão discreto no canto (**Pausar a rua** / **Continuar a rua**, alvo de 44 px) congela tudo; no story do celular, quem pausa é o botão do story. Para o leitor de tela a cena é decorativa: o grupo "A rua da loja" (no story, "A rua da loja: o mercador atendendo"), o botão do mercador, o do Mercado e o de pausar; chamado, o aviso diz o que de fato acontece (abre agora, no fim do atendimento, quando a rua voltar a andar ou, na foto, só oferece).
- **Onde fica**: no celular, é o **primeiro story do Início** (abaixo). No computador, **embaixo do perfil, na coluna dele** — [perfil e rua | story] de 1200 px em diante; de 900 a 1199 o story vem em cima e perfil e rua embaixo —, na maior escala inteira que a largura da coluna aceita (2× em coluna estreita, 3× no notebook, 4× em tela grande), com as pontas sumindo no preto, sem encolher o story. Lado a lado com o story, perfil + rua cabem na altura que o hero já tinha (a da janela, até 900): numa janela baixa (notebook com a barra do navegador, 1366×657, 1280×650) o perfil fica baixo — o avatar ao lado dos números, como no celular — e a rua desce para 2×, então o story inteiro, a calçada da rua e os destaques ficam na primeira tela, onde ficavam antes da rua (`useLojaDesktop` no `Hero.tsx`). Escolhida pelos prints: no computador, uma faixa de ponta a ponta embaixo do hero empurrava o catálogo uns 280 px para baixo e deixava vazio o lado do perfil; no celular, como faixa ela tirava da primeira tela a faixa dos @ ou empurrava o perfil, e no story ganha a tela inteira.
- **No story do celular** a rua é o **primeiro story do Início**, com barrinha própria, e o último produto volta para ela. Em pé, um mundo fixo de 176 × 281 pixels da arte — o céu de madrugada em pontilhado, a fachada da loja subindo com a janela acesa e o letreiro GC em cima da porta, o poste alto com a luz em pontilhado, a calçada e o asfalto — recortado pelo quadro a 3× (2× abaixo de 360 px de largura), com os pés de todo mundo logo acima dos adesivos e do "Enviar mensagem…" e os balões entre o cabeçalho ("@… · agora") e os adesivos; deitado, a faixa larga (220 de largura, a 2×; no celular deitado baixo, o que couber com o poste abaixo do cabeçalho). O segmento dura ~12 s (`DURACAO_RUA` no `Hero.tsx`): o primeiro cliente (o skatista ou o motoboy) já vem entrando e a conversa tem ritmo de story, então um atendimento inteiro cabe nele; nos produtos a rua fica montada e parada e, na volta, a cena continua de onde estava. No pé, o adesivo "Chega mais." em pixel (o mercador não repete essa fala no balão). Os lados passam e voltam, segurar pausa (a rua junto), arrastar passa; o foco do teclado dentro do story segura o tempo dele, não a cena (chamado pelo teclado, o mercador responde), e o botão de pausar do story para a rua junto; tocar no mercador chama ele (o casaco, o balão e o adesivo VER O MERCADO; o story espera enquanto o adesivo está aberto, uns 7 s); tocar num cliente, ele reage; a dica diz "toca no mercador". O tempo do segmento só corre com a rua pronta (ou 4 s depois, em cima do pôster, com a rede lenta). Um link direto de produto (`?p=`) começa no produto; sem produto no estado, a rua é o story inteiro.
- **Para sozinha** fora da tela (atrás da barra de abas também), com a aba do navegador escondida, com qualquer camada por cima (story, página do produto, sacola, chat, jogo, conta, rateio) e no botão de pausar; no story do celular, também nos produtos e com o story pausado ou segurado: aí nem o `requestAnimationFrame` roda (o `scripts/revisao.mjs` conta as voltas dele em cada caso). Com **movimento reduzido** vira uma foto: o mercador de casaco aberto atendendo o skatista que aponta, o gato e o letreiro aceso, com o balão "Chega mais." (no story, "Vem no certo!": o adesivo já diz "Chega mais."; tocar nele ainda mostra o VER O MERCADO).
- **Leve**: a vaga da rua (computador) tem a altura reservada desde o primeiro quadro (zero pulo) e a rua só baixa no primeiro respiro depois da abertura, num pedaço à parte (`Rua-*.js`, ~12 KB gzip). No story do celular, o primeiro quadro é um **pôster** desenhado no build pelo mesmo motor (`virtual:rua-poster` no `vite.config.ts`: PNG de paleta de ~2,5 KB, 1 px por pixel da arte, no pedaço principal; o da faixa deitada vem num pedaço à parte, só para quem deita): ele aparece junto com o story e a rua viva assume por cima sem piscar, porque o quadro 0 dela é o próprio pôster. Os 280 quadros do elenco são montados num **worker** (`elenco.worker-*.js`, ~21 KB gzip) e voltam prontos como imagens; sem worker (navegador antigo, arquivo único), monta na página no tempo ocioso. O canvas tem a resolução da arte (um pixel do canvas = um pixel da arte) e o CSS amplia em px inteiros do aparelho, nítido em DPR 1, 2, 2,625 e 3. O relógio é próprio (rAF com acumulador em passos fixos) e o desenho só acontece quando algum quadro troca (~10 por segundo).
- **Código**: `src/componentes/RuaInicio.tsx` (a vaga do computador, no pedaço principal), `src/componentes/rua/` — `StoryRua.tsx` (o story da rua no celular: o recorte, o pôster e os adesivos do pé), `Rua.tsx` (canvas, balões, botões), `cta.ts` (o adesivo do Mercado), `motor.ts` (relógio, atores, desenho; a fachada do mundo em pé), `roteiro.ts` (o diretor, a vida do mercador e os quatro atos; o ritmo do story), `palco.ts` (geometria: a faixa de 92 de altura e o mundo em pé de 176 × 281, faixas do chão, onde ficam poste, porta e pontos), `poster.ts` / `tela-falsa.ts` (o pôster do build), `falas.ts`, `pacote.ts` / `montar.ts` / `elenco.worker.ts` (montagem das folhas). Prints quadro a quadro: abra com `?ruaquadros=<semente>` — o relógio para e `window.__rua.avancar(ms)` anda na mão, com a mesma rua para a mesma semente.

**Aba Mercado** (o antigo Catálogo): `?aba=mercado` abre (os links velhos `?aba=catalogo` continuam valendo) e a aba escreve `?aba=mercado` na URL; "Mercado" na barra de abas (lupa), na lateral, no título da aba e da janela, no "Buscar no Mercado" e no "Ver o Mercado" do chat. No **topo**, o mercador de pé (2× em celular pequeno ou deitado, para a primeira fileira de produtos aparecer) com a animação que ele já tem (abre o casaco; os tragos só com `config.mercadorTraga`), como o dono da banca recebendo — balão "Chega mais.", o título e a contagem ao lado. Tocar nele (ou o mouse em cima) abre o casaco na hora e ele troca a fala. No DOM o título vem antes dele: abrir a aba leva o foco ao h1 "Mercado". O repost do fim saiu: a aba não repete o mercador; no fim ficam o Teste minha sorte e a linha "Chegou teu pedido? Marca @… no story". Código: `src/componentes/MercadoTopo.tsx`.

**Elenco da rua em pixel art** (`src/arte/pixel/rua/`), na mesma escala de pixel do mercador do repost e com a mesma luz (poste e néon fraco vindo de cima: a borda de cima da silhueta acende, como o aro cinza do casaco dele):

- **Mercador** (`mercador.ts`): os movimentos novos saem das grades que ele já tem (corpo da sacola vazia de casaco fechado, corpo do repost para abrir o casaco). `parado`, `olhar`, `andar`, `beber`, `passar`, `receber`, `acenar`, `rir`, `aprovar`, `abrir` / `mostrar` / `fechar`, `toque` (com o MC) e `carinho` (no gato).
- **Clientes** (`skatista.ts`, `motoboy.ts`, `mc.ts`, `turista.ts`) e o **gato** (`gato.ts`); **itens e efeitos** (`itens.ts`): latas, livreto de seda, piteira de vidro, sacola GC, nota, moeda, flash, linhas de velocidade, notas musicais; **cenário** (`cenario.ts`): ladrilhos de muro, calçada, meio-fio e asfalto, poste (`criarPoste(altura)`) com a luz (`criarLuz(altura)`), porta, letreiro, engradados e a sombra de cada um.
- **Formato** (`modelo.ts`): cada personagem tem `w × h`, `ancora` (meio dos pés, na linha do chão), `cores` e `animacoes` com os quadros `dir` e `esq` (já espelhados, com o GC legível); cada quadro traz `px`, `ms`, `passo` (quanto anda até o próximo quadro, para o pé não escorregar), `mao` (onde vai o item segurado) e `evento` (`oferece`, `pega`, `paga`, `recebe`, `toque1`–`toque3`, `flash`, `arranca`, `nota`, `carinho`…). Para uma troca, o cliente fica com a mão dele (no quadro do evento) no x da mão do mercador — a rua calcula essa distância sozinha.
- **Laboratório** (`lab/`, fora do git): `npx vite --port 4660` e abrir `/lab/rua.html`; prints com `node lab/rua.shots.mjs <pasta> 4660`; pranchas sem navegador com `node --experimental-strip-types --import ./lab/rua/registrar.mjs lab/rua/pranchas.mjs <pasta>`.

---

## Rateio (site)

Rateio é a compra junto: a loja abre X vagas de um produto importado, cada pessoa entra com nome e WhatsApp, paga a vaga e, quando as vagas fecham, a loja faz o pedido. Sai mais barato do que comprar depois que chega. O servidor e o painel (criar rateio, confirmar pagamento, avançar o status) estão no `API.md`; aqui é o lado do cliente.

**Onde aparece**

- Aba **Rateio** (`…/greencheese/?uf=mg&aba=rateio`), a 4ª aba do site:
  - **celular**: a barra de baixo passa a ter 6 células — Início, Catálogo, **Rateio** (a caixa de importação com a fita e o corte tracejado; cheia na aba atual), Teste minha sorte, Sacola, Por estado. O selo branco na caixa é quantos rateios dá pra entrar agora no estado. Num estado sem entrega (ex.: `?uf=ba`) o Rateio sai da barra, como a Sorte.
  - **computador**: item "Rateio" na lateral, logo depois de Catálogo, com o mesmo número.
  - **Início**: de 560 px em diante, destaque "Rateio" logo depois de Buscar (anel aceso enquanto tem rateio aberto pro estado; selo "novo" até a pessoa ver os abertos na aba). No celular ele fica só na barra de baixo: com 5 caminhos os filtros saíam da primeira tela da linha (o "Tudo" sumia em 320 px), desfazendo a correção "filtros à vista no celular"; os destaques continuam nos 4 caminhos aprovados, com o "Tudo" inteiro e o filtro seguinte espiando. Pra pôr o Rateio de volta nos destaques do celular (às custas dos filtros), é a regra `max-width: 559px` em `Catalogo.css`.
- **Link de um rateio** (para o adesivo de link dos stories): `https://oprojeto.online/greencheese/?uf=mg&rateio=arizona-green-tea` — abre a página do rateio depois do +18, por cima da aba Rateio (fechar mostra os outros rateios; voltar de novo sai do site, como todo link direto). O botão de compartilhar da página copia esse link. O id de cada rateio aparece no painel.

**A aba**: título com o "?" (abre a folha **Como funciona**: entra com nome e WhatsApp; a vaga fica guardada por `reservaHoras` enquanto fecha o pagamento no WhatsApp; o contador mostra as vagas pagas; o pedido do rateio é feito depois que fecham as vagas; chega de `previsaoMin` a `previsaoMax` dias depois que fechar; por que sai mais barato; e se não lotar, a loja chama no WhatsApp pra combinar). Embaixo, as seções **Minhas vagas** (só com vaga neste aparelho), **Abertos** (os do estado primeiro; os de outro estado por último, apagados, com "Só pra MG, SP…"), **Em andamento** (fechou, pedido feito, a caminho, chegou, com a linha do tempo e a previsão em datas) e **Chegaram** (entregues nos últimos 15 dias). Sem nenhum: "Nenhum rateio aberto agora", com o mercador e "Fica de olho no @…" do estado.

**O cartão** é um post do perfil: avatar, @ do estado e "Rateio · vale pra RJ, MG…" no lugar da localização. A mídia é um story:
- as barrinhas do topo são a linha do tempo (lotar → pedido feito → a caminho → chegou; a 1ª enche com as vagas pagas);
- o selo do status em pixel (ABERTO com o ponto piscando, FECHOU, PEDIDO FEITO, A CAMINHO, CHEGOU, ENTREGUE; aberto com o prazo vencido e vaga sobrando: TEMPO ACABOU, sem piscar);
- o produto flutuando no preto: a arte do produto do `produtoId` (ilustração ou foto, com o halo); a imagem enviada pelo painel tem prioridade, com o mesmo tratamento; sem nenhum dos dois, a caixa de importação em pixel;
- o preço do rateio grande ("R$ 14,90 no rateio"), "R$ 19,90 quando chegar" e o adesivo "economiza R$ 5,00" (só quando o rateio tem `precoDepois`);
- o **contador** no adesivo de controle deslizante: "8/10 vagas", um bloco por vaga (preto = paga, xadrez = reservada esperando o pagamento, cinza = livre; acima de 30 vagas, 30 degraus arredondados pra baixo, mas 1 vaga paga já acende 1 degrau e 99/100 nunca enche a barra) e "+2 reservadas" ao lado. Conta só as pagas: sobe quando a loja confirma o pagamento no painel (e, quando o Pix no site existir, sozinho pelo webhook);
- a entrada no adesivo "Adicione o seu": "Entrar no rateio · sobram 7 vagas" (já dentro: "Tu tá nesse rateio · Código RAT-K8EA"). Sem entrada possível: "Vagas tomadas: esperando os pagamentos" (todas pagas ou reservadas; uma reserva que vence devolve a vaga) ou "O prazo pra entrar acabou".
Na legenda, a previsão ("Chega de 6 a 10 dias depois que fechar."), o prazo ("Fecha dia 12/10 ou quando lotar."; vencido: "O prazo pra entrar acabou dia 07/10.") e os estados. O número de "Abertos" na aba é o de rateios em que dá pra entrar agora (o mesmo do selo da barra).

**A página do rateio** (camada `?rateio=<id>`, no molde da página do produto: tela cheia no celular, diálogo no computador, 2 colunas a partir de 600 px; voltar do Android, Esc e o botão do topo fecham): o cartão grande, a descrição, o como funciona resumido (+ "Como funciona o rateio") e **Entrar no rateio**: nome, WhatsApp (mesma máscara e validação da conta), estado (os do rateio, o atual marcado), cidade quando o estado ainda não tem cidade cadastrada, quantidade (1 até `limitePorPessoa`, sem passar das vagas que sobram) e o total ao vivo. Nome e WhatsApp vêm preenchidos da conta do Teste minha sorte (ou da última vaga). Tem um campo "site" escondido de gente e de leitor de tela (armadilha pra robô) e a linha "Teu nome e WhatsApp servem só pra loja confirmar tua vaga."

"Reservar minha vaga" → `POST rateio-entrar` → **Tá no rateio!**: comemoração curta em pixel, o código RAT-XXXX (com "Copiar"), "tua vaga fica guardada até 18h de amanhã", a mensagem, **Fechar pagamento no WhatsApp** (o WhatsApp da loja, `config.whatsappPedidos`; link montado antes do toque, sem nova aba no celular) e **Pagar com Pix aqui no site** com o carimbo EM BREVE (explica que o Pix no site chega em breve e aí a vaga confirma sozinha; o foco volta pro WhatsApp). Com várias vagas, "tuas vagas ficam guardadas até…". Cada erro do servidor vira uma frase curta com caminho, e o foco vai pro alerta (ou pro botão dele), nunca solto na página: sem vagas (mostra quantas sobraram e ajusta a quantidade), limite por pessoa, esse WhatsApp já está no rateio (com o código, "Ver minhas vagas" e "Falar com a loja", que manda só o código: a quantidade e o total quem confere é a loja), fora do estado (com os estados que o servidor mandou; a lista é recarregada), rateio fechado, `invalido` sem campo do formulário (a frase do servidor, ex.: a armadilha), muitas tentativas, erro do servidor. Na página, aberto com o prazo vencido diz "O prazo pra entrar acabou dia 07/10." (não "as vagas foram todas pegas", que é só quando não sobra vaga).

**Resposta que se perde** (3G, hospedagem lenta): o `POST rateio-entrar` espera até 20 s ("Reservando…"; depois de 5 s, "Tá demorando: a conexão tá lenta. Segura aí."). Antes de enviar, o aparelho gera um `token` e guarda a entrada como pendente (`gc-rateio`); sem resposta, a tela diz que a vaga pode ter ficado guardada e oferece **Tentar de novo** com o MESMO token — nada de "Entrar pelo WhatsApp" sem código de cara. Na nova tentativa: o servidor que segue o `API.md` (token do aparelho) devolve a mesma vaga e sai o "Tá no rateio!"; o de hoje responde `ja-participa`, o site pergunta ao `minhas-vagas` pelo token e, sem achar, mostra "Tua vaga ficou guardada (código RAT-…), mas a resposta da loja se perdeu no caminho" com **Falar com a loja** (só o código). Duas tentativas sem resposta: o WhatsApp aparece como segunda opção ("se a vaga já tiver ficado guardada, a loja acha ela pelo teu número"). As "Minhas vagas" também perguntam pelos tokens pendentes: se o servidor gravou, a vaga aparece sozinha.

**Mensagem do WhatsApp** (no padrão do pedido; `montarRateio` em `src/lib/mensagem.ts`, conferida por `node scripts/conferir-mensagem.mjs`):

```
RATEIO GREEN CHEESE — MG / Teófilo Otoni
Arizona Green Tea 680 ml — 2 vagas × R$ 14,90 = R$ 29,80
Código: RAT-K8EA
Nome: Ian Teste
WhatsApp: (33) 99123-4567
Quero confirmar minha vaga e pagar.
```

Sem servidor sai sem a linha do código e termina em "Quero entrar no rateio." Quem já tem vaga (`ja-participa`) manda a linha do produto sem conta, o código e "Já tenho vaga nesse rateio. Quero conferir e pagar."

**O código** (RAT-XXXX) tem fonte própria, `GC Codigo` (grade 5×7 em pixel, `scripts/gerar-codigo.mjs` → `src/componentes/rateio/codigo.css`): na Pixelify o 2 e o Z trocavam de cara e B, G e 6 se confundiam, e o código é lido, anotado e ditado pra loja.

**Minhas vagas**: o token de cada vaga fica neste aparelho (`gc-rateio` no localStorage, até 20) e a aba pergunta o status ao servidor (`GET minhas-vagas`) ao abrir e a cada minuto, com a aba à vista e a página em primeiro plano (a lista dos rateios também: o contador sobe sozinho). Cada vaga mostra o código, as vagas, o total e o status: "Esperando pagamento · guardada até 18h de amanhã" ("guardadas", com várias) (com "Pagar no WhatsApp"), "Confirmada ✅", "Venceu — a vaga voltou" (com "Entrar de novo" se ainda tem vaga), "Cancelada", "Entregue", e o andamento do rateio (fechou, pedido feito, a caminho, chegou, cancelado).

**Sem servidor aqui** (o arquivo único da prévia, a página aberta do disco, o zip sem a pasta `api/` — 404 ou HTML no lugar de JSON —, `npm run dev` sem PHP): a aba mostra os rateios de exemplo de `src/dados/rateios-exemplo.json` (só com `dadosDeExemplo`), com o contador em 0, e o formulário vira **Entrar pelo WhatsApp** (sem código; "A loja confirma tua vaga pelo WhatsApp."). Nenhum erro vermelho na tela, nada trava.

**Servidor fora do ar** (a lista passa de 8 s, rede caída, 5xx da hospedagem) numa visita sem lista: **nunca** os exemplos no lugar dos rateios de verdade. A aba diz "Sem conexão com a loja agora" com **Tentar de novo** (e tenta sozinha a cada minuto); a página de um rateio diz "Não deu pra abrir esse rateio agora". Se a lista já tinha chegado nesta visita, ela fica. Um aparelho que já falou com o servidor (`servidorVisto` em `gc-rateio`) trata até 404/HTML como fora do ar.

**Rateios de exemplo**: `src/dados/rateios-exemplo.json`, no mesmo formato da API (Arizona Green Tea 680 ml e Dichavador de metal 4 partes 55 mm, `demo: true`, contadores em 0). Somem com `dadosDeExemplo: false` (os do servidor marcados `demo` também). Os rateios de verdade são criados no painel do dono.

**Rapidez**: na primeira tela só entra o que a barra, a lateral e o destaque precisam (a lista de rateios, buscada no tempo ocioso depois da abertura). A aba, o cartão, a página, o formulário e o CSS do rateio baixam à parte, no tempo ocioso ou na primeira visita (o CSS entra como `<style>`, como o do Teste minha sorte).

**Código**: `src/lib/rateio-api.ts` (o contrato e a lista), `src/lib/rateio-vagas.ts` (entrar, rateio avulso, minhas vagas), `src/lib/minhas-vagas.ts`, `src/store/rateio.ts` (lista em memória e as vagas do aparelho), `src/componentes/rateio/` (`VistaRateio`, `CartaoRateio`, `PaginaRateio`, `EntrarRateio`, `ComoFunciona`, `util.ts`, `Rateio.css` + `estilo.ts`). Ícones: `caixa` e `caixa-cheia` em `src/arte/pixel/abas.ts`, `interrogacao` em `src/arte/pixel/extras.ts`.

**Testado contra o PHP de verdade** (o servidor da frente F8, `php -S` com o roteador de desenvolvimento e um proxy no lugar do Vite): lista, entrar (código e mensagem), `ja-participa` de outro aparelho, resposta perdida, armadilha, fora do estado com a lista velha, confirmar no painel → "Confirmada ✅" e o contador 2/24.

**Testes**: `scripts/revisao.mjs` tem a rodada do rateio (aba, cartão com o contador, "?", formulário, confirmação com a mensagem certa, Pix em breve, Minhas vagas, sem servidor) com a API simulada no formato do `API.md`; `scripts/celulares.mjs` abre a aba e a página em cada celular (rolagem lateral, alvos de 44 px, voltar). Nas outras rodadas a API responde como "sem servidor".

---

## Onde trocar cada coisa

Tudo que o dono muda fica em `src/dados/`. Depois de mexer, rode `npm run build` e suba de novo.

### WhatsApp dos pedidos — `src/dados/config.ts`

Todo pedido e toda encomenda fecham no mesmo WhatsApp da loja, `whatsappPedidos` (55 + DDD + número, só dígitos). Hoje: `'5533991139036'` = (33) 99113-9036 (o dono passou "33 9113-9036"; celular tem 9 dígitos, então entra o 9 na frente).

```ts
whatsappPedidos: '5533991139036',
```

O WhatsApp só aparece no **último passo do pedido guiado**, com o pedido completo: "Fechar pedido no WhatsApp" (ou "Fechar encomenda no WhatsApp") abre a conversa com a mensagem pronta e a loja fecha no x1. Embaixo fica "Pagar com Pix aqui no site" com o carimbo **EM BREVE**: tocar não sai do site, a loja responde que o Pix chega em breve e o foco volta para o botão do WhatsApp. Se o pagamento escolhido não for Pix, a loja oferece "Trocar pra Pix" (muda o pagamento ali mesmo, sem refazer os passos) e só depois devolve o foco ao WhatsApp, pra ninguém mandar o pedido no cartão achando que vai pagar no Pix. Se o WhatsApp não abrir, o chat mostra o número e o "Copiar texto".

Dúvida que o site não tira vai para a **DM do Instagram do estado** (`instagram` em `canais.ts`): link no começo do pedido guiado ("Outra dúvida? Chama a @… no Instagram"), quadro "Dúvidas" do destaque do estado e o rodapé ("Outra dúvida? Chama a @… na DM", com o estado escolhido ou palpitado). "Avisar quando chegar" também vai pra DM do estado (copia a mensagem e abre a DM).

Um estado com WhatsApp próprio: em `src/dados/canais.ts`, troque o `whatsapp: null` dele pelo número (`whatsapp: '5521999998888'`); `null` = usa o da loja.

### Cidades, horário, taxa e pagamento — `src/dados/canais.ts`

No arquivo de canais: cidades atendidas (`cidades`), horário (`horario`), taxa de entrega (`taxaEntrega`), formas de pagamento (`pagamento`) e o "Sextou com entrega grátis!" de MG (`entregaGratis`). Em `perfisAConfirmar` ficam os perfis vistos em marcações de clientes que ainda não foram confirmados (hoje o @greencheese_importsvv): eles não aparecem em nenhuma tela pública (faixa, rodapé, Por estado); quando um for confirmado, vira um estado em `canais`. Quando trocar um valor de demonstração pelo real, mude também `demo: true` para `demo: false`.

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
- **`demo: true`** = produto de exemplo. Fica no site enquanto `dadosDeExemplo: true` (em `src/dados/config.ts`); com `false`, some.

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
  titulo: '4 por 3 na OCB',                // nome interno (na tela o prêmio aparece como "LEVA 4 PAGA 3 · Seda OCB Premium Slim")
  descricao: 'Uma OCB por conta da sorte.', // 1 linha de apoio no story (até ~28 letras; sem repetir o prêmio nem prometer "hoje")
  regra: 'Leva 4 Seda OCB Premium Slim e paga 3', // frase completa: vai na linha do WhatsApp e no "Ver condições"
  aplicaA: { produtos: ['seda-ocb-premium-slim'] }, // ids do catalogo.json (ou { categorias: ['sedas'] })
  comoUsar: 'Põe 4 na sacola e usa o cupom.',       // opcional: vai no "Ver condições"
  peso: 30,                                // chance relativa (não precisa somar 100; nunca aparece na tela)
  validadeDias: 7,                         // conta a partir de quando a pessoa guarda (1 a 30)
  demo: true,                              // exemplo: fica enquanto dadosDeExemplo (src/dados/config.ts)
}
```

- **Todo giro ganha**: o peso decide qual sai, e só entre os prêmios que valem no estado de quem gira (produto disponível lá).
- **O prêmio é um story dos Melhores amigos, só pra pessoa** (`src/interativos/sorte/StoryPremio.tsx`), e monta tudo sozinho a partir do `tipo`, do `valor` e do produto. Quando a tampa sai, a câmera mergulha na câmara do dichavador e o preto de dentro cresce até virar o quadro do story; ele sintoniza do chiado pro real (a mesma revelação em dither dos produtos) e fica assim: barrinha de 1 segmento que enche uma vez, o cabeçalho do perfil do estado com o **anel verde** e o selo **Melhores amigos**, o produto flutuando com o brilho da cor dele, "DEU SORTE!" como adesivo de texto, o destaque em pixel ("15% OFF", "LEVA 4 PAGA 3", "BRINDE") + o produto, a `descricao` (1 linha; some em tela baixa) e dois adesivos: o do **código**, como o adesivo de link (tocar copia, vira "COPIADO" num degrau; sem conta ele aparece trancado, "Guarda pra liberar o código", e tocar leva pra guardar; ao guardar, o cadeado abre com um estalo e o código entra letra por letra), e o de **contagem** da validade ("Vale até qua., 14/10" + os dias; antes de guardar, "Vale depois de guardar" + `validadeDias`). Embaixo, o texto clicável **Ver condições** abre por cima do story a `regra`, o `comoUsar`, a validade, a reserva de quem ainda não tem conta e as regras de sempre (1 pedido, não soma com outro cupom, só com o produto no estado, a loja confirma no WhatsApp), e "Ver produto" abre a página dele. As ações ficam no pé, como as do story: embaixo dele quando a tela é alta; numa linha só, por cima do pé dele, em celular baixo (320×568); numa coluna ao lado, com o story deitado, quando a tela é baixa e larga: celular deitado (inclusive o grande, de 900 px ou mais, que pega o layout de computador) e computador com a janela baixa (até ~635 px de altura; o diálogo alarga pra isso). Deitado e estreito (até ~812 px), a contagem vai pra baixo do produto e o código fica sozinho ao lado; no menor (568×320) o story cresce um pouco e a coluna rola, sem nada cortado nem encavalado. No computador o story fica no tamanho de celular, no meio do diálogo (nunca mais estreito que 272 px), e não muda de tamanho nem de modo ao guardar. Na revelação tem uma comemoração curta em pixel (o adesivo bate, o destaque carimba, confete estourando de trás do produto e brilhos no destaque); um toque pula pro story pronto; com movimento reduzido, corte seco (o dichavador aberto e o story). Os cupons da **Minha conta** e o "Hoje saiu" da espera usam as mesmas peças: a bolinha de story com o anel verde (cinza quando o cupom já foi usado ou venceu, como story visto, com o carimbo USADO ou VENCEU), o destaque em pixel e os adesivos. Na **sacola**, o cupom aplicado e os cupons pra usar levam o código no adesivo branco e o destaque em pixel (sem bolinha).
- **O verde** só aparece no anel e no selo dos Melhores amigos (é a semântica do Instagram, "só pra você"; ver DECISOES.md, item 13). A cor fica em `VERDE_AMIGOS` (`src/interativos/sorte/Adesivos.tsx`).
- **O prêmio tem um nome só** em todo lugar (story, faixa do cadastro, Minha conta, sacola, pedido, adesivo do site, "O que pode sair"): o destaque + o produto, ex. "LEVA 4 PAGA 3 · Seda OCB Premium Slim", "BRINDE · Piteira de papel RAW". O `titulo` do prêmio fica só para a validação e para os dados guardados; quem aparece é esse par (`nomeDoPremio` em `src/lib/cupom.ts`).
- O 2 e o 5 do destaque vêm de uma fonte mínima (`src/interativos/sorte/digitos.css`, gerada por `node scripts/gerar-digitos.mjs`): na Pixelify o 5 parece S e o 2 parece Z, e "15% OFF" lia "1S% OFF".
- **A validação recusa** (em dev o site para com o erro na tela; no ar, o prêmio é descartado com aviso no console): id repetido; produto ou categoria que não existe no `catalogo.json`; prêmio ou brinde em **bebidas ou destilados**; peso ≤ 0; validade fora de 1–30; percentual fora de 1–50; leve ≤ pague; e qualquer palavra da lista `PALAVRAS_PROIBIDAS` (folha, erva, fumaça, grátis, frete, prazo, sorteio, cigarro, tabaco…) no título, descrição, regra ou "como usar".
- Promoção de verdade: `demo: false`. Com `dadosDeExemplo: false`, os de exemplo saem; sem nenhum prêmio válido, o "Teste minha sorte" some do site inteiro (destaque, lateral, adesivo, sacola) e o link `?jogo=sorte` é ignorado. Também some em estado que a loja não atende (o cupom não serviria lá).
- A validade que aparece nas Regras sai de `validadeDias` ("vale 7 dias" quando todos os prêmios têm a mesma; senão, "até a data escrita no cupom").
- Limites (`regrasSorte`): 1 giro sem conta (para sempre, no aparelho), 1 giro por dia com conta (vira à meia-noite de Brasília), prêmio sem conta reservado por 24 h. Na prévia, tudo fica só no aparelho; na versão oficial, o servidor valida (ver PENDENCIAS.md).
- A copy do jogo fica em `src/interativos/sorte/textos.ts`; a das entradas do site (destaque, lateral, adesivo, sacola), em `src/interativos/sorte/textos-entrada.ts`.
- Link direto: `https://oprojeto.online/greencheese/?uf=mg&jogo=sorte` abre o jogo depois do +18.
- O próximo interativo entra com uma linha em `src/interativos/registro.ts`, o jogo em `src/interativos/<id>/` e a tabela de prêmios dele em `src/dados/`.
- Conferir a mensagem do pedido (sem cupom, igual ao formato de sempre; com cupom, +1 linha): `node scripts/conferir-mensagem.mjs`.
- Conferir o story do prêmio em 21 tamanhos (celular em pé e deitado, do 568×320 ao 932×430, tablet e notebook com janela baixa): `node scripts/sorte-tamanhos.mjs [pasta] [url]` com o site rodando. Confere prêmio, "Ver condições" aberto e guardado: nada sai do quadro nem encavala, todo botão dá pra tocar, o story não pula no fim da revelação, o teclado e o Esc com a lista aberta. Usa o prêmio de destaque mais comprido e o código mais largo (`PREMIO=brinde` etc. troca o prêmio; `VP=915x412,568x320` escolhe os tamanhos).

### Disponibilidade pelo celular (opcional) — planilha do Google

Crie uma planilha com as colunas `id, preco, rj, mg, sp, es, sc` (disponível = `sim`/`não`), publique em **Arquivo → Compartilhar → Publicar na Web → CSV** e cole o link em `planilhaCsvUrl` no `src/dados/config.ts`. O site lê a planilha toda vez que abre; se ela falhar, usa o `catalogo.json`.

### Tirar do modo prévia — `src/dados/config.ts`

Em `src/dados/config.ts`: `dadosDeExemplo` (produtos, prêmios, horário e taxa de exemplo continuam no site; `false` tira), `carimboDeExemplo` (mostra o carimbo "exemplo"/"demo"; hoje desligado, então horário de exemplo não aparece e taxa de exemplo vira "a confirmar") e `indexar` (hoje `false`: `noindex` até o catálogo ter só dados reais). A assinatura do rodapé fica em `credito` (`null` tira).

### Outras peças

- Logo: `src/arte/Logo.tsx` (SVG). Favicon: `public/favicon.svg`.
- Mercador em pixel art: o do repost (abre o casaco) em `src/arte/pixel/mercador.ts`; o da sacola vazia (casaco fechado, erguendo a garrafa pelo gargalo, piscando de vez em quando) em `src/arte/pixel/mercador-garrafa.ts`. Grades separadas: as camadas da animação do repost dependem pixel a pixel da grade dele. Na sacola ele usa `<PixelArte ancora="base">`: com o ajuste ao pixel da tela (125%, 225%…) a sobra vai para cima e a sombra fica sempre à mesma distância do adesivo.
- Imagem de compartilhamento (WhatsApp/Instagram): `npm run og` com o `npm run dev` rodando → `public/og.png` e `public/apple-touch-icon.png`.
- Revisão por screenshots: `npm run revisao` com o dev rodando → `revisao/<rodada>/`.
- Mapa do Brasil ("Por estado", estado sem atendimento e seletor de estado): pixel art com o formato de verdade de cada estado, em `src/dados/mapa-brasil.ts` (uma letra por estado, dá pra ver o Brasil no arquivo). Ele é **gerado** da malha das UFs do IBGE (API de malhas, qualidade mínima) por `node scripts/gerar-mapa-brasil.mjs` (baixa a malha; ou passe um GeoJSON já baixado: `node scripts/gerar-mapa-brasil.mjs malha.json`; `--previa /tmp/mapa` desenha PNGs ampliados para conferir). O site não busca nada no ar. Crédito: **Fonte: IBGE** (aparece embaixo do mapa do "Por estado"). Estado atendido novo aparece aceso sozinho (vem de `canais.ts`); se ele ficar fora da lupa, ajuste `LUPA_UFS` no script e gere de novo. Cidade nova com pino no mapa: coordenada em `CIDADES` no script.

## O que o site faz

- Abertura em formato de story com a pergunta +18 (lembrada por 30 dias) e o adesivo de localização.
- Estado do cliente nesta ordem: link da bio (`?uf=`), escolha salva, palpite pelo IP (sempre pergunta "Você está em …?"), escolha manual com os 27 estados. A pergunta do palpite aparece na abertura; se a pessoa pular, no celular ela fica no pé do story do Início, no lugar do "Enviar mensagem…" (que volta depois da resposta), e nas outras abas logo acima da barra.
- Três abas (Início, Catálogo, Por estado), com barra de abas no celular e barra lateral no computador; o voltar do Android passa pelas abas (ver "Abas e Início").
- Catálogo por estado com disponível/indisponível, categorias como destaques, busca, "Só DISPONÍVEL ✅" (no Início, a mesma grade logo depois do perfil, com os destaques que levam às abas primeiro e as categorias à direita).
- Story do topo (hero): passa sozinho; toque nas bordas ou arrastar de lado passa e volta; no computador, setas ao lado do story e ← →. Na primeira visita, uma dica mostra onde tocar.
- Página do produto ("aba"): tocar no produto do story ou em "VER PRODUTO" abre a página com descrição curta, preço, disponibilidade no estado, formato e combos, quantidade, "Adicionar à sacola", "Pedir este item" e "Combina com". Voltar pelo botão do topo, pelo voltar do Android ou Esc. Cada produto tem link próprio (`?produto=<id>`), que abre direto depois do +18 (segurar o dedo ou Ctrl+clique abre em aba nova). No story do produto, "Mais opções" → "Ver detalhes do produto".
- Story do produto com barrinhas, toque nas laterais, segurar para pausar, arrastar para baixo para fechar, setas e Esc no teclado.
- Sacola com combo automático, pedido guiado em formato de DM (CEP preenche o endereço) e, no fim, "Fechar pedido no WhatsApp" com a mensagem pronta pro WhatsApp da loja. "Pagar com Pix aqui no site" fica marcado EM BREVE (a loja responde no chat e devolve pro WhatsApp).
- Encomenda ("Não achou? A Green Cheese importa.", fecha no mesmo WhatsApp), "Avisar quando chegar" (DM do Instagram do estado), todos os Instagrams.
- Dúvidas: o pedido guiado, o destaque do estado e o rodapé mandam pra DM/Instagram do estado; o WhatsApp fica só pro fechamento.
- "Segue o perfil do teu estado": mapa do Brasil em pixel (atendidos acesos, os outros em pontinhos apagados) com uma lupa no Sudeste + SC, onde cada estado atendido é um botão (a sigla do estado do cliente vira o adesivo de localização em miniatura: pino + "MG"); tocar num estado sem atendimento mostra "ainda não chegou" com Encomendar (fecha no X, no Esc ou tocando fora). Ao lado, a lista dos perfis no molde do "trocar de conta" do Instagram (na ordem do mapa, de cima pra baixo): tocar troca o site de estado. Mapa e lista ficam lado a lado quando a própria seção tem 910 px ou mais (container query; a coluna do mapa precisa caber o Brasil com a lupa); mais estreito, a lista vai embaixo. O tamanho das células e o lugar da lupa saem de `planejar()` em `MapaBrasil.tsx` (sempre em escala inteira, sem passar da largura da coluna nem da altura da tela).
- Sacola e respostas ficam salvas no aparelho; o botão voltar do Android fecha a camada aberta.
- **Teste minha sorte** (aba do meio da barra no celular, destaque "Sorte" no Início e no Catálogo, item na lateral, card no fim do Catálogo, convite discreto na sacola): gira a tampa do dichavador com o dedo (ou o botão "Girar", as setas, Espaço/Enter segurado, a roda do mouse); ele abre e, lá dentro, tem um story dos Melhores amigos só pra pessoa, com o prêmio. O 1º giro é sem conta; pra guardar e usar o cupom, cria conta com nome e WhatsApp. Com conta: 1 giro por dia, cupons em "Minha conta" e o nome já no pedido. O cupom aplicado vira uma linha na mensagem do WhatsApp; a loja confirma o desconto (o subtotal do site não muda).

Derivados do tabaco não entram no site (Anvisa, RDC 840/2023, art. 6º).

# PLANO — Green Cheese Imports (prévia)

> Referências: a pasta `referencias/` não veio no repositório. O plano parte da descrição detalhada dos 16 prints no briefing (seção 3). Quando os prints chegarem, `npm run recortar` gera as fotos dos produtos.

## Paleta (interface monocromática; a cor vem do produto)

| Nome | Hex | Uso |
|---|---|---|
| Preto Story | `#000000` | fundo de tudo. A página some na moldura do OLED, igual ao story. |
| Bolha | `#262626` | bolha recebida no chat, campos, fios e divisórias. |
| Chiado | `#636363` | anéis e controles apagados, bloco do mapa sem atendimento (3,5:1 no preto). |
| Legenda | `#A8A8A8` | texto secundário (8,9:1 no preto). |
| Branco Adesivo | `#FFFFFF` | texto, adesivo de localização, bolha enviada, botão principal. |
| *Cor do produto* | dinâmica | brilho atrás de cada produto, tirado da arte/foto. Verde só no ✅ do "DISPONÍVEL". |

## Tipografia

- **Pixelify Sans 700/400** (escolhida no teste: acentos Í Ç Ã É limpos, tem minúsculas, legível em 13 px; Silkscreen ficou largo demais e o til do Ã desalinha; Jersey 15 perde o "Nº" e parece fonte esportiva). Papel: *a marca escrevendo* — nome do produto, preço, DISPONÍVEL ✅, títulos de seção, mapa.
- **system-ui**: *a interface do Instagram em volta* — botões, chat, campos, avisos, adesivo de localização (que é peça do app).
- Regra: se é algo que a Green Cheese postaria no story, é pixel. Se é algo que o Instagram desenharia, é system-ui.

## Wireframes — celular (390 px)

```
ABERTURA                    HOME (topo)                  STORY DO PRODUTO              CHAT (DM)
┌────────────────────┐     ┌────────────────────┐       ┌────────────────────┐       ┌────────────────────┐
│                    │     │◉ [📍 TEÓFILO OTONI]│ fixo  │▬▬▬▬▬ ▭▭▭▭ ▭▭▭▭ ▭▭▭│       │ ─── (alça)         │
│      ╭──────╮      │     │▬▬▬▬ ▭▭▭ ▭▭▭ ▭▭▭    │       │◉ greencheese_mg  ✕ │       │◉ Pedido guiado     │
│      │ cuia │      │     │◉ greencheese_mg ·ag│       │                    │       │  @greencheese_mg   │
│      │GREEN │ logo │     │   ·lata      ·     │       │      ░▒▓██▓▒░      │       │┌─────────────┐     │
│      │CHEESE│ se   │     │      ░▓██▓░        │       │      ▓ GARRAFA▓    │       ││Confere: MG / │     │
│      ╰──✂───╯ desenha    │      ▓GARRA▓  ·seda│       │      ░▒▓██▓▒░ gira │       ││Teófilo Otoni?│     │
│                    │     │  JACK DANIEL'S     │       │ JACK DANIEL'S      │       │└─────────────┘     │
│ TEM 18 ANOS        │     │  R$ 149,90         │       │ OLD Nº 7 1 L       │       │   (Isso)(Trocar)   │
│ OU MAIS?           │     │  DISPONÍVEL ✅     │       │ R$ 149,90  ✅      │       │┌─────────────┐     │
│ [Tenho] [Não tenho]│     │(Enviar mensagem…)➤│       │ [flat] [slim]      │       ││1x Jack…149,90│    │
│                    │     │~~ RJ ✦ MG ✦ SP ✦ ~~│ faixa │ 2 por 14,99│3 por…│       │└─────────────┘     │
│   [📍 adesivo cai] │     │(◯)(◯)(◯)(◯)(◯)(◯) │ cat.  │ [−] 1 [+]          │       │        (Tá certo)  │
│              pular │     │ [busca]  [Só disp.]│       │ [ Pôr na sacola  ] │       │ [Seu nome…    ] ➤ │
└────────────────────┘     │ ┌────┐ ┌────┐      │       │(Pedir este item…)➤│       └────────────────────┘
                           │ │9:16│ │9:16│ grade│       └────────────────────┘
                           │ └────┘ └────┘   (🛍3)      toque esq/dir · segurar pausa · arrastar ↓ fecha
                           └────────────────────┘
```

## Wireframe — desktop (1440 px)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ◉ GREEN CHEESE   [📍 TEÓFILO OTONI]                         @greencheese_mg 🛍│
├───────────────────────────────┬───────────────────────────────────────────────┤
│ VEM NO CERTO.                 │        · lata              ┌─────────┐        │
│ Importados e acessórios em    │                  · seda    │ story   │ ·gin   │
│ Teófilo Otoni. Escolhe, põe   │   ·garrafa                 │ 9:16    │        │
│ na sacola, o pedido chega     │                            │ produto │        │
│ pronto no WhatsApp.           │        produtos flutuando  │ ciclando│        │
│ [📍 Trocar cidade]            │        no vazio, paralaxe  └─────────┘        │
├───────────────────────────────┴───────────────────────────────────────────────┤
│ (◯)(◯)(◯)(◯)(◯)(◯)            [busca]        [Só disponíveis]                 │
│ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐   grade 9:16, 5 colunas                              │
├──────────────────────────────┬────────────────────────────────────────────────┤
│  MAPA EM BLOCOS (acende)     │  cartões por estado (atual primeiro)           │
└──────────────────────────────┴────────────────────────────────────────────────┘
STORY ABERTO NO DESKTOP: coluna 9:16 central, catálogo escurecido atrás, setas laterais.
```

## Os 3 momentos de motion

1. **Abertura** (1x por visita, pulável, ≤ 3 s): preto → o traço da cuia se desenha → a tesoura fecha e "corta" a tela (as duas metades deslizam) → "TEM 18 ANOS OU MAIS?" em pixel → o adesivo de localização cai girando no topo com o estado detectado.
2. **Card → story**: o card vira a tela cheia (o fundo preto cresce do retângulo do card; a arte do produto voa no mesmo elemento via GSAP Flip), produto flutua com leve giro, barrinhas correm. "Pôr na sacola": o produto voa em arco até a sacola, que dá um soco de escala.
3. **Revelação em dither**: cada arte nasce do chiado (ruído → Bayer → imagem) quando entra na tela; o mapa em blocos acende estado por estado.

Resto quieto: produtos do hero flutuam (transform), paralaxe leve, faixa de estados rolando, respostas de toque (scale 0,96).

## 5 princípios

1. **O preto é a tela.** Nada de cartão cinza por cima do preto: o produto flutua no vazio, como no story.
2. **A marca escreve em pixel, o app fala em system-ui.** Duas vozes, nunca misturadas.
3. **A cor é do produto.** Interface sem cor; o brilho vem da lata, da garrafa, da seda.
4. **Tudo do Instagram vira função.** Adesivo = localização. Destaque = categoria. Story = produto. "Enviar mensagem…" = pedido. DM = chat.
5. **Nunca decidir nem inventar pelo cliente.** Palpite de IP pergunta antes; preço que não existe é "Consultar"; demo vem marcado; quem aperta enviar é a pessoa.
6. **Duas vozes de movimento** (entrou na crítica). Voz *pixel* para o decorativo em laço: `steps()`, posição presa em 2 px. Voz *app* para o funcional (card → story, folhas, arrastar): easing liso, como o Instagram. Nunca as duas no mesmo elemento.

## Crítica do plano (passo 3) — o que sairia igual em qualquer site escuro, e a troca

Três revisores independentes (clichês de template, fidelidade ao Instagram da marca, uso real no navegador do Instagram) atacaram o plano acima. Trocas adotadas:

| Sairia genérico | Troca que só faz sentido para a Green Cheese |
|---|---|
| Age-gate centralizado com dois botões; logo "se desenhando" por stroke-dashoffset; cortina que abre em duas metades | A abertura é **um story de 3 quadros** com barrinhas e ✕: o logo se monta **bloco a bloco** (pixels que acendem por opacity), a **tesoura recorta** um adesivo que vira a **enquete do IG** "Tem 18 anos ou mais?" (Tenho \| Não tenho, a metade tocada enche), e o **adesivo de localização cola** com o pop do app. "Não tenho" vai para a tela no molde do **aviso de conteúdo sensível** do IG, com dither no lugar do desfoque. |
| App bar com logo + carrinho em cima de tudo | O adesivo de localização nasce **dentro do story do hero**, torto; ao rolar ele **descola e gruda** no topo (sempre visível). |
| Hero de objetos boiando com paralaxe | O hero **é um story rodando** com os disponíveis do estado: barrinhas, cabeçalho com avatar + @ completo, um produto por segmento; só o próximo espera atrás, pequeno, com paralaxe. |
| Botão flutuante redondo com contador vermelho | A **barra de resposta do story** fica fixa: pílula "Enviar mensagem…" (abre o chat) e a **sacola pixel** no lugar do coração, contador em pílula branca. |
| Página de produto (variação, combo, stepper, botão) colada no story | Cada controle vira **o adesivo do IG que já faz aquilo**: variação = enquete; combo = quiz ("1 por R$ 9,99 / 2 por R$ 14,99 / 3 por R$ 19,99", tocar escolhe a quantidade); "Pôr na sacola" = adesivo de link com a quantidade dentro. O story não rola; toque nas laterais só sobre a imagem; tocar num controle congela o avanço. |
| Voo em arco com escala elástica até o carrinho | "Pôr na sacola" é **mandar o story por DM**: a arte encolhe numa miniatura 9:16 e desce até a sacola; carimbo pixel "NA SACOLA"; contador troca em degrau. |
| Chatbot com "Olá! Como posso ajudar?", digitando…, recibo | **DM do Instagram de verdade**: cartão do perfil no topo, hora do aparelho, "Você respondeu ao story" com a miniatura, respostas rápidas em pílula, campo "Mensagem…" com "Enviar" só quando há texto, resumo = **o texto exato** que vai pro WhatsApp. Cabeçalho "Pedido guiado · respostas automáticas"; nada que finja gente. |
| Carrinho com "Finalizar compra" | Cada linha da sacola **já sai escrita como vai na mensagem** ("3x Seda OCB Premium Slim — R$ 19,99"), combo aplicado como adesivo pixel. |
| Bolinhas com ícone de biblioteca; anel com gradiente do IG | Destaques com **capa em pixel art**; o primeiro é o destaque real ("DELIVERY RJ" / "TEÓFILO OTONI", com a moto) e abre o story de atendimento do estado; o **anel é segmentado**: um segmento por produto, branco se tem no estado. |
| H2 "Catálogo", "Onde estamos" | Seções abrem com o **adesivo de texto do story** (caixa branca por linha) e frases deles; catálogo sem título visível. |
| Busca sem resultado com ilustração vazia | Vira o **adesivo de caixa de perguntas**: "Não achou? A Green Cheese importa." com o termo preenchido → ramo de encomenda. |
| Card cinza com selo "esgotado" | Indisponível = o mesmo story **em dither cinza com chiado**, "INDISPONÍVEL" e o **adesivo de lembrete** "Avisar quando chegar". |
| Brilho em degradê (aurora) atrás de cada produto; verde do Tanqueray | **Halo pontilhado** (Bayer quantizado), com trava de matiz: verde e roxo viram cinza — verde continua só no ✅. Nada por cima do #000: sem blur, scanline ou neon. |
| Marquee infinito "RJ ✦ MG ✦ SP" | A faixa em pixel é a **lista de perfis** que a marca posta, separados pela moto; só se move com a rolagem; cada @ troca o estado. |
| Página "nossas unidades" de franquia | **O story da lista de perfis por estado**: mapa em blocos que acende, UF em pixel, adesivo de menção @GREENCHEESE_IMPORTSRJ, só o que é verdade ("cidade a confirmar", vv "a confirmar"). |
| Split hero de SaaS no desktop | Desktop no molde do **instagram.com**: barra lateral com o adesivo de local; hero = perfil do estado à esquerda + visualizador de stories à direita. |
| Folha #121212 com cantos de 16 px e fundo preto 60% | Folhas **pretas com canto em degrau de pixel** e fio #262626; o fundo atrás escurece em **screen-door** (3 de cada 4 pixels pretos), sem blur. |
| `active:scale(.96)` | Toque = **inversão de pixel** por 80 ms. |
| `target=_blank` e `window.open` no webview | `<a href>` montado antes do toque, sem target no celular; cópia síncrona para a DM; "Não abriu?" se a página continuar visível. |

Utilidade que entrou: link por produto (`?p=`) com compartilhar; selo "Aberto agora" (demo marcado); empurrão de combo ("leva mais 1 e as 3 saem por R$ 19,99"); par sugerido só de `combinaCom`; volta do WhatsApp reabre o pedido com "Já mandou?"; painel da prévia com as pendências e os links de bio por estado.

# PENDÊNCIAS — o que está PENDENTE ou como demonstração

Tudo funciona até a mensagem pronta no WhatsApp. O que está abaixo depende de dado do dono da Green Cheese. Onde trocar: veja o LEIA-ME.md.

## Atendimento por estado (`src/dados/canais.ts`)

| Item | RJ | MG | SP | ES | SC |
|---|---|---|---|---|---|
| WhatsApp | PENDENTE (`null`) | PENDENTE | PENDENTE | PENDENTE | PENDENTE |
| Cidades atendidas | Rio de Janeiro | Teófilo Otoni | PENDENTE | PENDENTE | PENDENTE |
| Horário | demo | demo | demo | demo | demo |
| Taxa de entrega | demo (R$ 10) | demo (R$ 8) | demo (R$ 12) | demo (R$ 10) | demo (R$ 12) |
| Formas de pagamento | demo (Pix, dinheiro, cartão na entrega) | demo | demo | demo | demo |

- **WhatsApp**: os prints não mostram número (hoje a venda é por DM). Sem número, o botão abre o WhatsApp para a pessoa escolher o contato, com "Copiar pedido e abrir a DM do Instagram" ao lado. Nenhum número foi inventado.
- **Cidades de SP, ES e SC**: enquanto não vierem, o pedido pergunta a cidade do cliente (ou pega pelo CEP) e põe na mensagem.
- **Valores demo** aparecem com a marca "demo" só na prévia; a mensagem do pedido sempre diz "taxa a confirmar".
- **"Sextou com entrega grátis!" (MG)**: dado real dos stories. Confirmar se vale **toda** sexta — o site mostra a frase só às sextas, só em MG.
- **Nome do perfil**: "GREEN CHEESE LTDA" aparece só em RJ e MG (visto nos prints). SP, ES e SC mostram só o @.
- **Destaque "DELIVERY SP/ES/SC"**: nome de demonstração (só RJ e MG têm destaque visto nos prints).
- **@greencheese_importsvv**: aparece em marcações de clientes do Rio. Listado com a marca "confirmar". Pode ser Vila Velha (ES) ou outro perfil — confirmar se é oficial e de qual cidade.

## Catálogo (`src/dados/catalogo.json`)

**Preços PENDENTES (aparecem como "Consultar")** — produtos reais:
- Fanta Ghost Face Punch 350 ml
- Coca-Cola Vanilla (lata)
- Hennessy Very Special
- Cuia de silicone RAW

**Preços reais** (vistos nos stories): Jack Daniel's Old No. 7 1 L R$ 149,90 (MG) · Gin Tanqueray London Dry 750 ml R$ 99,99 (RJ e MG) · Seda OCB Premium Slim R$ 9,99 / 2 por R$ 14,99 / 3 por R$ 19,99 (RJ) · Piteira de vidro RAW R$ 29,99 (RJ). Confirmar se o preço é o mesmo nos outros estados.

**Disponibilidade**: confirmada só onde o produto apareceu num story (campo `disponivelConfirmado`). O resto da tabela por estado é demonstração, montada para mostrar disponível e indisponível (3 ou 4 indisponíveis por estado).

**9 produtos de exemplo** (`demo: true`, marcados "exemplo" na prévia; somem com `modoPrevia: false`): Arizona Green Tea, Dr Pepper, Jägermeister, Seda RAW Classic King Size, Seda Smoking Brown, Piteira de papel RAW, Dichavador de metal 4 partes, Isqueiro Clipper, Bandeja RAW pequena. Preços de exemplo.

**Fotos oficiais**: nenhuma. A pasta `referencias/` (os 16 prints) **não veio** com o projeto. Os 17 produtos estão como **ilustrações realistas desenhadas em código**, a partir da embalagem pública de cada um (rótulos simplificados: o texto miúdo é aproximado). Fica bom para a prévia; para a versão oficial, o ideal é foto do produto que a loja vende de fato: `npm run recortar` (ver `referencias/LEIA-ME.md`) — a foto entra no lugar da ilustração sozinha.

**Logo**: redesenhado em SVG a partir da descrição do briefing (círculo preto, cuia em linha, GREEN CHEESE inclinado, tesoura). Comparar com a foto de perfil real quando os prints chegarem.

## Fora do site, de propósito

- **Derivados do tabaco** (Backwoods, charutos, cigarros, fumo): não entram. A Anvisa veda oferta e venda pela internet (RDC 840/2023, art. 6º). Sedas, piteiras, cuias e acessórios entram normalmente.
- **Depoimentos de clientes**: a seção de repost usa só a ilustração da marca. Reposts reais entram com print e permissão do cliente.
- Figura encapuzada dos prints (personagem de jogo) e o perfil pessoal citado na bio: não usados.

## Publicação

- Hospedagem: não há acesso à Hostinger a partir daqui. O pacote `entrega/greencheese-dist.zip` e o passo a passo estão no LEIA-ME.md (sugestão: `https://oprojeto.online/greencheese/`).
- Se o endereço final for outro, trocar `urlPublica` em `src/dados/config.ts` e gerar o build de novo.
- Testar dentro do navegador do Instagram, no Android e no iPhone, com o domínio real (https).

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
- Perfil pessoal citado na bio: não usado.

## Repost: o mercador

- A seção de repost usa o **mercador do Resident Evil 4** em pixel art (pedido do cliente), com produtos da loja no casaco no lugar das armas. É personagem da **Capcom**: serve para a prévia; para a versão oficial, a loja precisa decidir se assume o uso como mascote ou troca por uma figura própria.

## Página do produto

- **Descrições** (`descricao` no `catalogo.json`): escritas só com fatos públicos e certos de cada produto, em tom neutro. **Confirmar com a loja** antes da versão oficial, principalmente as dos 9 produtos de exemplo.
- "Combina com" usa o campo `combinaCom` e, depois, outros da mesma categoria disponíveis no estado.

## Teste minha sorte (interativo + conta do cliente)

O que está na prévia: o dichavador que gira, abre e entrega um beck bolado com cupom dentro; conta só com nome e WhatsApp; cupons em "Minha conta"; 1 giro por dia com conta; cupom aplicado na sacola e no pedido. **Na prévia, tudo fica só no aparelho** (sem servidor) e a tela diz isso.

1. **Promoções de verdade**: os 5 prêmios de `src/dados/sorte.ts` são de **exemplo** (`demo: true`, carimbo "exemplo"; somem com `modoPrevia: false` e, sem prêmio válido, o interativo some do site). Promoções, pesos, validade e estoque são decisão da loja.
2. **Lei 5.768/1971 e Decreto 70.951/1972**: promoção comercial com elemento de sorte pode exigir **autorização prévia do Ministério da Fazenda** (hoje pela Secretaria de Prêmios e Apostas). Confirmar com contador ou advogado antes da versão oficial. O caminho mais seguro é ficar só com descontos condicionados à compra; o tipo `brinde` só entra depois de confirmado.
3. **CDC, arts. 30 e 31**: oferta precisa obriga a loja. Por isso o "exemplo" na prévia (também na linha do WhatsApp: "· exemplo ·") e a regra completa na versão oficial. "A loja confirma" quer dizer conferir código e estoque, não recusar cupom válido.
4. **LGPD**: falta definir o controlador (CNPJ), finalidade, base legal, prazo de retenção, canal de exclusão e publicar a política de privacidade (a prévia fica **sem link de propósito**). O opt-in de promoções é separado, desligado por padrão e gravado com data e hora (`aceitaPromoEm`); "Apagar minha conta deste aparelho" apaga conta e cupons.
5. **Versão oficial validada no servidor** (PHP + MySQL na mesma hospedagem da Hostinger): `POST` conta; entrar com código pelo WhatsApp (hoje entra só com o número, no mesmo aparelho); girar (o **servidor sorteia** e gera o código único); guardar cupom; limite por WhatsApp + aparelho; relógio de America/Sao_Paulo; baixa de "usado" dada pela **loja** num painel simples (não pelo "Mandei"). As telas já falam com uma interface (`AdaptadorConta` em `src/lib/conta.ts`): o adaptador do servidor entra no lugar do local sem mexer nelas. Modo em `src/dados/conta.ts`.
6. **Nome e imagem**: "beck bolado" fica em `regrasSorte.nomeDoPremio`; a lista de palavras e imagens proibidas (`PALAVRAS_PROIBIDAS`) vale para tudo. A **imagem de compartilhamento e o link da bio ficam sem "beck"** (regras da Meta). O beck é só um tubo de papel enrolado: sem folha, broto, fumaça, ponta acesa ou cinza.
7. **OCB 4 por 3 junto com o combo "3 por R$ 19,99"**: confirmar com a loja como os dois convivem (o site não recalcula; a mensagem leva o cupom e a loja confirma).
8. **Álcool e tabaco fora dos prêmios** (Lei 9.294/1996, Anvisa RDC 840/2023): a validação de `src/lib/cupom.ts` recusa prêmio em bebidas e destilados.
9. **Furos conhecidos da prévia** (aceitos; na versão oficial, validado no servidor): mexer no relógio do aparelho, usar aba anônima ou outro navegador burla o limite de giros; apagar a conta não devolve o giro do dia; o navegador do Instagram, o Safari e o Chrome guardam contas separadas.
10. **Rodapé**: falta a frase "Quem cria conta no Teste minha sorte: na prévia, nome e WhatsApp ficam só neste aparelho." no fim do parágrafo de privacidade de `src/componentes/Rodape.tsx` (o rodapé está sendo mexido em outra branch; entra quando as duas se juntarem). A mesma informação já aparece no cadastro, na conta e nas regras.
11. **Modo da conta**: a especificação pedia `conta: { modo }` em `src/dados/config.ts`; como o config está sendo mexido em outra branch, o modo ficou em `src/dados/conta.ts` (`configConta.modo`). Dá pra mover pro config quando as branches se juntarem.

## Publicação

- **No ar em `https://oprojeto.online/greencheese/`** (com `noindex` enquanto `modoPrevia: true`). Atualizar: `npm run build` + `node scripts/publicar.mjs` (ver LEIA-ME.md). Só a pasta `greencheese/` é escrita.
- Se o endereço final for outro, trocar `urlPublica` em `src/dados/config.ts` e gerar o build de novo.
- Testar no navegador do Instagram, no Android e no iPhone de verdade (os testes daqui simulam toque e tamanho de tela, não o aparelho).

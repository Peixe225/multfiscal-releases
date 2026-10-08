# PENDÊNCIAS — o que está PENDENTE ou como demonstração

Tudo funciona até a mensagem pronta no WhatsApp. O que está abaixo depende de dado do dono da Green Cheese. Onde trocar: veja o LEIA-ME.md.

## Atendimento por estado (`src/dados/canais.ts`)

| Item | RJ | MG | SP | ES | SC |
|---|---|---|---|---|---|
| WhatsApp | (33) 99113-9036 (o da loja) | o da loja | o da loja | o da loja | o da loja |
| Cidades atendidas | Rio de Janeiro | Teófilo Otoni | PENDENTE | PENDENTE | PENDENTE |
| Horário | demo | demo | demo | demo | demo |
| Taxa de entrega | demo (R$ 10) | demo (R$ 8) | demo (R$ 12) | demo (R$ 10) | demo (R$ 12) |
| Formas de pagamento | demo (Pix, dinheiro, cartão na entrega) | demo | demo | demo | demo |

- **WhatsApp**: o dono passou "33 9113-9036" para todos os estados; entrou como (33) 99113-9036 (`config.whatsappPedidos`), porque celular tem 9 dígitos desde 2016. **Confirmar com o dono que é esse o número** (com o 9). Ele só aparece no fim do pedido guiado.
- **Pix direto no site**: "Em breve" (o botão responde no chat e devolve pro WhatsApp). Para ligar de verdade precisa de um provedor de Pix com QR dinâmico e confirmação do pagamento (servidor) — entra junto com o backend.
- **Cidades de SP, ES e SC**: enquanto não vierem, o pedido pergunta a cidade do cliente (ou pega pelo CEP) e põe na mensagem.
- **Valores demo** aparecem com a marca "demo" só na prévia; a mensagem do pedido sempre diz "taxa a confirmar".
- **"Sextou com entrega grátis!" (MG)**: dado real dos stories. Confirmar se vale **toda** sexta — o site mostra a frase só às sextas, só em MG.
- **Nome do perfil**: "GREEN CHEESE LTDA" aparece só em RJ e MG (visto nos prints). SP, ES e SC mostram só o @.
- **Destaque "DELIVERY SP/ES/SC"**: nome de demonstração (só RJ e MG têm destaque visto nos prints).
- **@greencheese_importsvv**: aparece em marcações de clientes do Rio. Listado com a marca "confirmar" na faixa dos @ e no "Por estado"; fora do rodapé até confirmar. Pode ser Vila Velha (ES) ou outro perfil — confirmar se é oficial e de qual cidade.

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
- Ele também aparece na **sacola vazia**, de casaco fechado erguendo a garrafa (`src/arte/pixel/mercador-garrafa.ts`, no lugar do bonequinho de boné, a pedido do cliente). Se o mercador for trocado, as duas grades vão juntas.
- Com ele, a **sacola vazia ficou 13,5 px mais alta**: a grade do mercador dá 192 px de altura nos mesmos 132 de largura (o bonequinho dava 181,5) e 3 px embaixo mantêm a sombra à mesma distância do adesivo. Onde a folha cabe na tela, só o topo dela sobe; os pés do mercador, o adesivo, o cupom e os stories ficam no mesmo lugar. Em tela baixa, onde a folha já rolava, ela rola 13,5 px a mais (320×568: 67 → 81 px; celular deitado: 219 → 232 px). Para voltar à altura de antes, dá para tirar o respiro de cima (`.sacola-vazia`, `padding-top` 28 → 14,5 px), mas aí o mercador sobe e quase encosta no título da folha (em tela de 125%, a garrafa fica a 1,7 px da linha embaixo do título).

## Mercador e elenco

- O **mercador é personagem da Capcom** (Resident Evil 4). Agora ele aparece em quatro lugares: vivendo na **rua do Início** (anda, bebe, vende), no **topo da aba Mercado** (a animação do repost, que saiu do fim da aba), na **sacola vazia** e, no código, nas grades da rua. A decisão de assumir o uso ou trocar por uma figura própria vale para todos, e as grades vão juntas (`src/arte/pixel/mercador.ts`, `mercador-garrafa.ts` e `src/arte/pixel/rua/mercador.ts`). As falas dele são da loja, nenhuma frase do jogo.
- O **elenco novo é original**, desenhado para a Green Cheese: skatista, motoboy, MC, turista e o gato, além do cenário (muro, poste, porta com o letreiro GC). Pode ser usado sem pedir licença a ninguém.
- **Na rua, sem álcool e sem tabaco** (Lei 9.294/1996 e as regras da Meta): o mercador bebe a Fanta Ghost Face Punch, o forro do casaco mostra só refrigerante e acessório (o uísque, o gin e o isqueiro do repost não entram), nada aparece aceso, e as falas passam pela lista `PALAVRAS_PROIBIDAS` (o `scripts/revisao.mjs` confere). O skatista leva um livreto de seda e o turista uma piteira de vidro, acessórios que a loja vende; se a loja preferir, o item da mão troca por uma lata numa linha do `roteiro.ts`.
- **No topo do Mercado** o mercador é o do repost, com a animação de sempre: o forro mostra os produtos do catálogo (inclusive os destilados) e os tragos seguem `config.mercadorTraga` (ver "Repost: tragos do mercador": para a versão oficial, a recomendação é `false`).
- A **camisa do turista é de bolinhas** coloridas, não a estampa havaiana de sempre: os desenhos dela caem na lista de imagens que o site não usa.
- A lata da Fanta Ghost Face Punch traz a máscara do Ghostface da embalagem do produto (marca de terceiros): aparece só como a lata que a loja vende.
- O **gato** entrou: fica nos engradados debaixo da luz do poste, ganha carinho do mercador de vez em quando e empina a cabeça quando tocam nele.
- **Falas e ritmo** ficam em `src/componentes/rua/falas.ts` e `roteiro.ts`; quando o painel do dono existir (F10), as falas podem ir para lá (sempre passando pela mesma lista de palavras).
- O texto "saiu do catálogo" (cupom de um produto que não existe mais, no chat e na sacola) continua com "catálogo": fala da lista de produtos, não da aba. A sacola (`CupomSacola.tsx`) é da frente do Teste minha sorte.

## Página do produto

- **Descrições** (`descricao` no `catalogo.json`): escritas só com fatos públicos e certos de cada produto, em tom neutro. **Confirmar com a loja** antes da versão oficial, principalmente as dos 9 produtos de exemplo.
- "Combina com" usa o campo `combinaCom` e, depois, outros da mesma categoria disponíveis no estado.

## Teste minha sorte (interativo + conta do cliente)

O que está na prévia: o dichavador que gira, abre e entrega um beck bolado com cupom dentro; conta só com nome e WhatsApp; cupons em "Minha conta"; 1 giro por dia com conta; cupom aplicado na sacola e no pedido. **Na prévia, tudo fica só no aparelho** (sem servidor) e a tela diz isso.

1. **Promoções de verdade**: os 5 prêmios de `src/dados/sorte.ts` são de **exemplo** (`demo: true`, carimbo "exemplo"; somem com `modoPrevia: false` e, sem prêmio válido, o interativo some do site). Promoções, pesos, validade e estoque são decisão da loja.
2. **Lei 5.768/1971 e Decreto 70.951/1972**: promoção comercial com elemento de sorte pode exigir **autorização prévia do Ministério da Fazenda** (hoje pela Secretaria de Prêmios e Apostas). Confirmar com contador ou advogado antes da versão oficial. O caminho mais seguro é ficar só com descontos condicionados à compra; o tipo `brinde` só entra depois de confirmado.
3. **CDC, arts. 30 e 31**: oferta precisa obriga a loja. Por isso o "exemplo" na prévia (também na linha do WhatsApp: "· exemplo ·") e a regra completa na versão oficial. "A loja confirma" quer dizer conferir código e estoque, não recusar cupom válido.
4. **LGPD**: falta definir o controlador (CNPJ), finalidade, base legal, prazo de retenção, canal de exclusão e publicar a política de privacidade (a prévia fica **sem link de propósito**). O opt-in de promoções é separado, desligado por padrão e gravado com data e hora (`aceitaPromoEm`); "Apagar minha conta deste aparelho" apaga conta e cupons.
5. **Versão oficial validada no servidor** (PHP + MySQL na mesma hospedagem da Hostinger): `POST` conta; entrar com código pelo WhatsApp; girar (o **servidor sorteia** e gera o código único); guardar cupom; limite por WhatsApp + aparelho; relógio de America/Sao_Paulo; baixa de "usado" dada pela **loja** num painel simples (não pelo "Mandei"). As telas já falam com uma interface (`AdaptadorConta` em `src/lib/conta.ts`; o adaptador em uso fica em `src/lib/conta-adaptador.ts`), e o contrato já tem o que o servidor precisa:
   - **Entrar em dois passos**: `pedirCodigo(whatsapp)` manda o código pelo WhatsApp e `confirmarCodigo(whatsapp, codigo)` abre a conta. O formulário já mostra o campo do código quando `pedirCodigo` devolve `enviado: true`. O adaptador local devolve `enviado: false` (a conta só existe no aparelho) e a tela pula o 2º passo. Sem o código, qualquer um veria o nome e os cupons de outra pessoa só com o número.
   - **Leitura pelo cache**: as telas leem pelos hooks de `src/lib/conta.ts`, que leem o store `gc-conta`. Esse store é o cache da conta no aparelho; o adaptador do servidor grava nele o que a API devolve a cada chamada (conta, cupons, dias de giro e prêmio reservado). A regra de "1 giro por dia" roda sobre esse cache só pra desenhar a tela; quem recusa o giro é o servidor.
   - `criar`, `confirmarCodigo` e `salvarCupom` devolvem o cupom que acabou de ser guardado (`cupomGuardado`); a tela de "guardado" só mostra esse.
   Modo em `src/dados/conta.ts`.
6. **Nome e imagem**: "beck bolado" fica em `regrasSorte.nomeDoPremio`; a lista de palavras e imagens proibidas (`PALAVRAS_PROIBIDAS`) vale para tudo. A **imagem de compartilhamento e o link da bio ficam sem "beck"** (regras da Meta). O beck é só um tubo de papel enrolado: sem folha, broto, fumaça, ponta acesa ou cinza.
7. **OCB 4 por 3 junto com o combo "3 por R$ 19,99"**: confirmar com a loja como os dois convivem (o site não recalcula; a mensagem leva o cupom e a loja confirma).
8. **Álcool e tabaco fora dos prêmios** (Lei 9.294/1996, Anvisa RDC 840/2023): a validação de `src/lib/cupom.ts` recusa prêmio em bebidas e destilados.
9. **Furos conhecidos da prévia** (aceitos; na versão oficial, validado no servidor): mexer no relógio do aparelho, usar aba anônima ou outro navegador burla o limite de giros; apagar a conta não devolve o giro do dia; o navegador do Instagram, o Safari e o Chrome guardam contas separadas.
10. **Modo da conta**: fica em `src/dados/conta.ts` (`configConta.modo`: `'local'` na prévia, `'servidor'` quando o adaptador PHP + MySQL existir).

## Repost: tragos do mercador

- `mercadorTraga` em `src/dados/config.ts` liga os tragos do mercador (ligado na prévia, a pedido). A Lei 9.294/1996, art. 3º, veda propaganda de produtos fumígenos: **para a versão oficial, a recomendação é `false`** (o mercador continua abrindo o manto com os acessórios).

## Rateio

O site já tem a aba, a página, a reserva com código, o fechamento no WhatsApp da loja e as "Minhas vagas" (ver LEIA-ME, "Rateio (site)"). Falta a loja decidir:

1. **Se não lotar**: hoje o site só diz "a loja te chama no WhatsApp pra combinar" (no "Como funciona"). Definir a regra (prazo máximo pra lotar? a loja completa as vagas? devolve o valor? em quanto tempo?) antes de escrever qualquer promessa na tela.
2. **Devolução e desistência**: quem pagou e desiste, ou o produto chega com defeito — nada disso aparece no site. Definir com a loja (e conferir com o CDC: compra pela internet tem direito de arrependimento de 7 dias, art. 49).
3. **Prazo da reserva e previsão**: o padrão é 24 h de reserva (`reservaHoras`) e 6 a 10 dias depois de fechar (`previsaoMin`/`previsaoMax`), por rateio. Confirmar com o dono se é a média real de entrega.
4. **LGPD**: quem entra num rateio manda nome, WhatsApp, estado, cidade e quantidade pro servidor da loja — o rodapé já diz isso (com a cidade), e o formulário diz "Teu nome e WhatsApp servem só pra loja confirmar tua vaga". Falta definir o controlador (CNPJ), o prazo de retenção (ex.: apagar os dados X dias depois do rateio encerrado), o canal pra pedir exclusão e publicar a política de privacidade.
5. **Pix direto no site**: "Em breve". Precisa de um provedor de Pix com QR dinâmico e webhook (escolha e credenciais da loja). O servidor já tem a rota `pix-webhook` (responde 501 até lá) e a confirmação passa pela mesma função do painel: quando o Pix existir, o contador sobe sozinho e o botão do site deixa de ser "Em breve".
6. **Rateios de exemplo**: Arizona Green Tea (R$ 14,90 no rateio, R$ 19,90 quando chegar, 24 vagas) e Dichavador de metal 4 partes (R$ 44,90 / R$ 59,90, 10 vagas) são **exemplo** (`demo: true`, preços e vagas inventados para a prévia; o "quando chegar" é o preço de exemplo do catálogo). Somem com `dadosDeExemplo: false`; os de verdade nascem no painel.
7. **Vaga em outro aparelho**: "Minhas vagas" vive no aparelho onde a pessoa entrou (o token fica no localStorage). Quem troca de celular ou limpa o navegador continua com a vaga no servidor e com o código na mensagem do WhatsApp, mas não vê o status no site. Se fizer falta: recuperar as vagas pelo WhatsApp com código (como a conta do Teste minha sorte).
8. **Conta da mensagem**: no exemplo da conversa veio "2 vagas × R$ 14,90 = R$ 29,90"; o site soma certo (R$ 29,80) e, quando o servidor devolve o total (somado em centavos), usa o dele.
9. **Contrato (API.md), para quem escreve o servidor**: o site aceita `token` vazio em `minhas-vagas` (o servidor guarda só o hash; se não devolver o token que recebeu, o site casa pelo `codigo`) e espera `agora` em `GET rateios` (o "guardada até" usa a hora do servidor quando o relógio do aparelho está errado).
10. **Servidor: `token` do aparelho no `rateio-entrar`** (API.md): o site já manda um token gerado no aparelho, o mesmo em cada nova tentativa. Falta o servidor (frente F8) guardar o hash dele no lugar de gerar um novo e devolver a mesma participação num POST repetido com o mesmo token. Sem isso a resposta perdida (3G, hospedagem lenta) continua sem quebrar nada — a nova tentativa recebe `ja-participa` com o código e a tela manda falar com a loja —, mas a vaga não aparece em "Minhas vagas" daquele aparelho.
11. **Destaque do Rateio no Início do celular**: ficou só de 560 px em diante. Com ele no celular (5 caminhos), os filtros saíam da primeira tela da linha, desfazendo a correção "filtros à vista no celular". No celular o Rateio está na barra de baixo, com o número de abertos. Confirmar com o Ian se prefere o Rateio nos destaques do celular às custas dos filtros (é uma regra em `Catalogo.css`).
12. **Backwoods no rateio**: o exemplo da conversa (Backwoods R$ 90 no rateio → R$ 110 depois que chega) é derivado do tabaco; o servidor recusa título ou descrição com `backwoods`, `charuto`, `cigarrilha`… (API.md, Anvisa RDC 840/2023 e RDC 855/2024). Os exemplos do site viraram Arizona e dichavador. Confirmar com o Ian e com a loja: tabaco e cigarro eletrônico ficam fora do rateio.
13. **Mensagem conferida com o print da conversa**: o print da conversa do WhatsApp com o cliente não está no repositório; a mensagem do rateio foi conferida com o `conferir-mensagem.mjs` e o LEIA-ME. Conferir com o print original antes de publicar.
14. **Desenvolvimento com o PHP**: o repasse de `/api` pro PHP no `npm run dev` vem com a frente F8 (`vite.config.ts` dela); nesta frente ainda não tem. O site desta frente já foi testado contra o servidor PHP da F8 (lista, entrar, `ja-participa`, resposta perdida, armadilha, fora do estado, confirmar no painel → contador): repetir depois de juntar as frentes.

## Publicação

- **No ar em `https://oprojeto.online/greencheese/`** (com `noindex` enquanto `modoPrevia: true`). Atualizar: `npm run build` + `node scripts/publicar.mjs` (ver LEIA-ME.md). Só a pasta `greencheese/` é escrita.
- Se o endereço final for outro, trocar `urlPublica` em `src/dados/config.ts` e gerar o build de novo.
- Testar no navegador do Instagram, no Android e no iPhone de verdade (os testes daqui simulam toque e tamanho de tela, não o aparelho).

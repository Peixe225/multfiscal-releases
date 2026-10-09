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

O que está na prévia: o dichavador que gira, abre e mostra o prêmio num story dos Melhores amigos (com o código trancado até guardar); conta só com nome e WhatsApp; cupons em "Minha conta"; 1 giro por dia com conta; cupom aplicado na sacola e no pedido. **Na prévia, tudo fica só no aparelho** (sem servidor) e a tela diz isso.

1. **Promoções de verdade**: os 5 prêmios de `src/dados/sorte.ts` são de **exemplo** (`demo: true`, carimbo "exemplo"; somem com `modoPrevia: false` e, sem prêmio válido, o interativo some do site). Promoções, pesos, validade e estoque são decisão da loja.
2. **Lei 5.768/1971 e Decreto 70.951/1972**: promoção comercial com elemento de sorte pode exigir **autorização prévia do Ministério da Fazenda** (hoje pela Secretaria de Prêmios e Apostas). Confirmar com contador ou advogado antes da versão oficial. O caminho mais seguro é ficar só com descontos condicionados à compra; o tipo `brinde` só entra depois de confirmado.
3. **CDC, arts. 30 e 31**: oferta precisa obriga a loja. Por isso o "exemplo" na prévia (também na linha do WhatsApp: "· exemplo ·") e a regra completa na versão oficial. "A loja confirma" quer dizer conferir código e estoque, não recusar cupom válido.
4. **LGPD**: falta definir o controlador (CNPJ), finalidade, base legal, prazo de retenção, canal de exclusão e publicar a política de privacidade (a prévia fica **sem link de propósito**). O opt-in de promoções é separado, desligado por padrão e gravado com data e hora (`aceitaPromoEm`); "Apagar minha conta deste aparelho" apaga conta e cupons.
5. **Versão oficial validada no servidor** (PHP + MySQL na mesma hospedagem da Hostinger): `POST` conta; entrar com código pelo WhatsApp; girar (o **servidor sorteia** e gera o código único); guardar cupom; limite por WhatsApp + aparelho; relógio de America/Sao_Paulo; baixa de "usado" dada pela **loja** num painel simples (não pelo "Mandei"). As telas já falam com uma interface (`AdaptadorConta` em `src/lib/conta.ts`; o adaptador em uso fica em `src/lib/conta-adaptador.ts`), e o contrato já tem o que o servidor precisa:
   - **Entrar em dois passos**: `pedirCodigo(whatsapp)` manda o código pelo WhatsApp e `confirmarCodigo(whatsapp, codigo)` abre a conta. O formulário já mostra o campo do código quando `pedirCodigo` devolve `enviado: true`. O adaptador local devolve `enviado: false` (a conta só existe no aparelho) e a tela pula o 2º passo. Sem o código, qualquer um veria o nome e os cupons de outra pessoa só com o número.
   - **Leitura pelo cache**: as telas leem pelos hooks de `src/lib/conta.ts`, que leem o store `gc-conta`. Esse store é o cache da conta no aparelho; o adaptador do servidor grava nele o que a API devolve a cada chamada (conta, cupons, dias de giro e prêmio reservado). A regra de "1 giro por dia" roda sobre esse cache só pra desenhar a tela; quem recusa o giro é o servidor.
   - `criar`, `confirmarCodigo` e `salvarCupom` devolvem o cupom que acabou de ser guardado (`cupomGuardado`); a tela de "guardado" só mostra esse.
   **Feito** (ver "Contas (equipe e clientes)"): o adaptador do servidor existe e o site escolhe sozinho pelo `GET recursos` (`src/lib/conta-modo.ts`).
6. **Nome e imagem**: o prêmio não tem mais beck nem papel enrolado (é um story dos Melhores amigos); a lista de palavras e imagens proibidas (`PALAVRAS_PROIBIDAS`) continua valendo para tudo: nada de folha, broto, fumaça, ponta acesa ou cinza. O anel e o selo verdes imitam o recurso Melhores amigos do Instagram (desenhados no estilo do site, sem copiar a imagem deles); se a Meta reclamar, trocar `VERDE_AMIGOS` e o texto do selo resolve.
7. **OCB 4 por 3 junto com o combo "3 por R$ 19,99"**: confirmar com a loja como os dois convivem (o site não recalcula; a mensagem leva o cupom e a loja confirma).
8. **Álcool e tabaco fora dos prêmios** (Lei 9.294/1996, Anvisa RDC 840/2023): a validação de `src/lib/cupom.ts` recusa prêmio em bebidas e destilados.
9. **Furos conhecidos da prévia** (aceitos; na versão oficial, validado no servidor): mexer no relógio do aparelho, usar aba anônima ou outro navegador burla o limite de giros; apagar a conta não devolve o giro do dia; o navegador do Instagram, o Safari e o Chrome guardam contas separadas.
10. **Modo da conta**: automático (`src/lib/conta-modo.ts`): conta no servidor quando o servidor diz que manda o código pelo WhatsApp (`GET recursos`); senão, só no aparelho, como na prévia.

## Repost: tragos do mercador

- `mercadorTraga` em `src/dados/config.ts` liga os tragos do mercador (ligado na prévia, a pedido). A Lei 9.294/1996, art. 3º, veda propaganda de produtos fumígenos: **para a versão oficial, a recomendação é `false`** (o mercador continua abrindo o manto com os acessórios).

## Rateio

O site já tem a aba, a página, a reserva com código, o fechamento no WhatsApp da loja e as "Minhas vagas" (ver LEIA-ME, "Rateio (site)"). Falta a loja decidir:

1. **Se não lotar**: hoje o site só diz "a loja te chama no WhatsApp pra combinar" (no "Como funciona"). Definir a regra (prazo máximo pra lotar? a loja completa as vagas? devolve o valor? em quanto tempo?) antes de escrever qualquer promessa na tela.
2. **Devolução e desistência**: quem pagou e desiste, ou o produto chega com defeito — nada disso aparece no site. Definir com a loja (e conferir com o CDC: compra pela internet tem direito de arrependimento de 7 dias, art. 49).
3. **Prazo da reserva e previsão**: o padrão é 24 h de reserva (`reservaHoras`) e 6 a 10 dias depois de fechar (`previsaoMin`/`previsaoMax`), por rateio. Confirmar com o dono se é a média real de entrega.
4. **LGPD**: quem entra num rateio manda nome, WhatsApp, estado, cidade e quantidade pro servidor da loja — o rodapé já diz isso (com a cidade, e que uma cópia das vagas fica no aparelho: `gc-rateio`, até 20 vagas e 5 entradas pendentes por 8 dias), e o formulário diz "Teu nome e WhatsApp servem só pra loja confirmar tua vaga". Falta definir o controlador (CNPJ), o prazo de retenção (ex.: apagar os dados X dias depois do rateio encerrado), o canal pra pedir exclusão e publicar a política de privacidade.
5. **Pix direto no site**: "Em breve". Precisa de um provedor de Pix com QR dinâmico e webhook (escolha e credenciais da loja). O servidor já tem a rota `pix-webhook` (responde 501 até lá) e a confirmação passa pela mesma função do painel: quando o Pix existir, o contador sobe sozinho e o botão do site deixa de ser "Em breve".
6. **Rateios de exemplo**: Arizona Green Tea (R$ 14,90 no rateio, R$ 19,90 quando chegar, 24 vagas) e Dichavador de metal 4 partes (R$ 44,90 / R$ 59,90, 10 vagas) são **exemplo** (`demo: true`, preços e vagas inventados para a prévia; o "quando chegar" é o preço de exemplo do catálogo). Somem com `dadosDeExemplo: false`; os de verdade nascem no painel.
7. **Vaga em outro aparelho**: "Minhas vagas" vive no aparelho onde a pessoa entrou (o token fica no localStorage). Quem troca de celular ou limpa o navegador continua com a vaga no servidor e com o código na mensagem do WhatsApp, mas não vê o status no site. Se fizer falta: recuperar as vagas pelo WhatsApp com código (como a conta do Teste minha sorte).
8. **Conta da mensagem**: no exemplo da conversa veio "2 vagas × R$ 14,90 = R$ 29,90"; o site soma certo (R$ 29,80) e, quando o servidor devolve o total (somado em centavos), usa o dele.
9. **Contrato com o servidor**: feito — o `minhas-vagas` devolve o token que recebeu e o `GET rateios` traz `agora` (o "guardada até" usa a hora do servidor quando o relógio do aparelho está errado).
10. **`token` do aparelho no `rateio-entrar`**: feito nos dois lados (API.md). O site manda o mesmo token em cada nova tentativa da mesma entrada e o servidor devolve a MESMA participação (200), sem criar outra: resposta perdida no 3G não vira vaga órfã.
11. **Destaque do Rateio no Início do celular**: entra logo depois de Buscar também no celular (o Ian pediu as abas primeiro e os filtros à direita). As bolinhas ficaram no tamanho de antes (56 px até 396 px de largura, 60 até 479), com um degrau a mais ou a menos nas faixas em que nada espiaria (52 de 329 a 352, 64 de 441 a 470): com 5 abas o "Tudo" deixa de caber inteiro na primeira tela (em 360 px aparecem 15 px dele; em 320 quem espia é o "Por estado", com 44 de 56 px), e o primeiro destaque que não cabe espia na borda, mostrando que a linha continua (o `celulares.mjs` confere em cada celular). Confirmar com o Ian.
12. **Backwoods no rateio**: o exemplo da conversa (Backwoods R$ 90 no rateio → R$ 110 depois que chega) é derivado do tabaco; o servidor recusa título ou descrição com `backwoods`, `charuto`, `cigarrilha`… (API.md, Anvisa RDC 840/2023 e RDC 855/2024). Os exemplos do site viraram Arizona e dichavador. Confirmar com o Ian e com a loja: tabaco e cigarro eletrônico ficam fora do rateio.
13. **Mensagem conferida com o print da conversa**: o print da conversa do WhatsApp com o cliente não está no repositório; a mensagem do rateio foi conferida com o `conferir-mensagem.mjs` e o LEIA-ME. Conferir com o print original antes de publicar.
14. **Desenvolvimento com o PHP**: `npm run api` liga o servidor de desenvolvimento e o Vite repassa `/api` e `/uploads` pra ele (LEIA-ME, "Servidor (API)").
15. **Se o site for ao ar sem a pasta `api/`** (só o site, sem o servidor da F8, ou com o PHP sem rodar): o `./api/index.php` dá 404 ou HTML e, pra quem nunca falou com o servidor, o rateio age como no arquivo único: mostra os 2 rateios de **exemplo** (Arizona a R$ 14,90 e dichavador a R$ 44,90, preços inventados, sem carimbo porque `carimboDeExemplo` está desligado como o pedido manda), com o contador em 0 e "Entrar pelo WhatsApp", que manda "Quero entrar no rateio." pro WhatsApp de verdade da loja, num rateio que o dono nunca abriu. Quem já falou com o servidor (`servidorVisto` no aparelho) vê "Sem conexão com a loja agora" com o WhatsApp. Com a `api/` no ar, servidor que responde em JSON (até erro, 429 ou resposta torta) nunca troca os de verdade pelos de exemplo; o pior caso é "Sem conexão" com "Entrar pelo WhatsApp" (a rodada do rateio do `revisao.mjs` confere). Pra não cair nisso: publicar junto com a F8. O `scripts/publicar.mjs` se recusa a publicar sem `dist/api/index.php` (ou sem a api respondendo no destino) enquanto `dadosDeExemplo` estiver ligado; `RATEIO_SEM_API=1` publica assim mesmo, de propósito. Outra saída: `dadosDeExemplo: false` (sem servidor, a aba diz "Nenhum rateio aberto agora").
16. **"N participando" no adesivo**: o pedido fala em "Entrar no rateio · N participando" e o Ian em "contador de quantas pessoas já entraram". A API conta vagas (`confirmadas`, `reservadas`, `disponiveis`), não pessoas. Com 1 vaga por pessoa daria pra deduzir, mas o dono pode baixar o limite por pessoa depois que alguém pegou mais de uma, e aí o número sairia inventado. O adesivo segue com "sobram N vagas", e o contador "8/10 vagas" mostra as pagas. Pra ter pessoas: um campo `participantes` no `GET rateios` (acréscimo compatível, pedir à F8) e confirmar com o Ian.
17. **Limite do `minhas-vagas` por IP** (F8: 120 por hora): o site pergunta no máximo 1 vez por minuto por aparelho, a cada 3 min com a aba aberta e só com vaga que ainda pode mudar, e recua o tempo que o servidor mandar quando vem `muitas-tentativas`. Se ainda assim a loja tiver muita gente atrás do mesmo IP (Wi-Fi de evento), subir o limite dessa rota na F8.

## Servidor

O servidor (PHP + SQLite, `api/`) está pronto e testado (ver LEIA-ME.md, "Servidor (API)"). Falta da loja:

- **LGPD dos dados do rateio**: o servidor guarda nome, WhatsApp, estado e cidade de quem entra num rateio (e as anotações do dono). Falta definir: o **controlador** (razão social e CNPJ da loja), a finalidade e a base legal (fechar e entregar o pedido do rateio), **por quanto tempo** os dados ficam depois do rateio encerrado (sugestão: 6 meses e depois apagar), o **canal de exclusão** (o painel já apaga os dados de uma pessoa sem mexer nas contas do rateio: `admin-participante-apagar`) e publicar a política de privacidade (com link no formulário do rateio). O IP de quem tenta entrar não é guardado puro (só um hash com sal, para o limite de tentativas, e some em 1 dia).
- **Rateio que não lota e devolução**: a loja não definiu. O site não promete nada: diz que a loja chama no WhatsApp pra combinar. Confirmar com o dono: prazo máximo pra lotar, o que acontece com quem já pagou (devolve o Pix? vira crédito?) e se dá pra sair depois de pagar.
- **Rotina de backup**: quem baixa a cópia do banco (painel → "Baixar cópia do banco"), de quanto em quanto tempo (sugestão: toda segunda) e onde guarda (fora do celular, ex.: Drive da loja; o arquivo tem dados de clientes). O backup da Hostinger existe, mas restaurar a hospedagem inteira desfaz o resto do site junto.
- **Pix direto no site**: escolher o provedor (ex.: Mercado Pago, Efí, Asaas, PagSeguro ou o banco da loja) e gerar as credenciais (geralmente com conta PJ). A rota do webhook (`pix-webhook`, hoje responde "não configurado") e a confirmação automática (a mesma função do painel) já estão prontas; falta ligar o provedor.
- **Código de instalação**: gerar o de verdade antes de publicar o servidor (`php scripts/codigo-instalacao.php`) e entregar ao dono por canal seguro.
- **Conferir no ar** depois da 1ª publicação com a API: painel → Diagnóstico (banco, log e módulos fechados pela web, nenhum `.php` rodando em `uploads/`, PHP 8.1+, GD com WebP, pasta gravável). Os `.htaccess` passaram num Apache local (os dois ramos, `Require` e `Order/Deny`); a Hostinger usa LiteSpeed, que lê o mesmo `.htaccess`, mas só o Diagnóstico no ar prova.
- **Versão do PHP** no hPanel: 8.1 ou mais nova (8.3 recomendada).
- **IP do cliente (a CDN já está na frente)**: o `oprojeto.online` responde pela CDN da Hostinger (cabeçalhos `server: hcdn` e `x-hcdn-request-id`). O limite de tentativas conta por IP (12 entradas em rateio por hora; no painel, 5 senhas erradas por login e 20 por IP em 15 min; IPv6 conta por /64). Se o PHP enxergar o IP da CDN no lugar do de cada cliente, esses limites viram de todo mundo junto: 12 entradas por hora pra todo mundo e 20 senhas erradas de qualquer um travando o login do dono. Daqui não deu pra provar o que o PHP enxerga lá (precisa de PHP no ar). O servidor só confia no `X-Forwarded-For` quando o pedido vem de uma faixa da lista `GC_PROXIES` (`public/api/nucleo/base.php`, vazia de propósito: confiar no cabeçalho sem saber de onde veio deixaria qualquer um inventar IP e furar o limite). **Depois de publicar a API, conferir:**
  1. No celular, no 4G e depois no Wi-Fi: painel → Servidor, item "O servidor vê o IP…". Ele mostra o IP que conta nos limites (mascarado, ex.: `177.38.12.x`), o IP da CDN quando ela está no caminho (inteiro) e os cabeçalhos de encaminhamento que chegaram (`X-Forwarded-For`, `X-Real-IP`…). Comparar com o IP da internet do aparelho (qualquer site de "qual é meu IP").
  2. "O servidor vê o IP de quem acessa", com o IP do aparelho: a hospedagem já entrega o IP certo; nada a fazer.
  3. "O servidor vê o IP da CDN" (com aviso no topo): anotar o IP da CDN que aparece nas duas redes e pedir à Hostinger as faixas da CDN (hCDN) que falam com o servidor. Pôr só essas faixas em `GC_PROXIES` (ex.: `const GC_PROXIES = ['203.0.113.0/24'];`), gerar o build, publicar e conferir de novo (tem que virar "vê o IP de quem acessa", com o IP do aparelho). **Nunca** a faixa inteira da Hostinger (`2a02:4780::/32`, por exemplo, tem servidor de cliente, que poderia inventar IP).
  4. Se a CDN mandar o IP em outro cabeçalho (não no `X-Forwarded-For`), o servidor ainda não lê: ajustar `gc_ip_cliente` em `base.php`.
  5. Sem abrir o Servidor: com rateio aberto, o aviso "os pedidos do site nas últimas 24 h vieram todos do mesmo IP" quer dizer a mesma coisa.

  Operadora de celular que põe muita gente atrás de um IPv4 só (CGNAT) pode fazer clientes diferentes dividirem o limite num rateio muito disputado: se aparecer "Muita tentativa seguida" pra quem não errou, subir o 12 em `publico.php`.
- **Mesma origem do outro site do domínio**: o painel e a API moram em `oprojeto.online/greencheese/`, na mesma origem do site que ocupa a raiz do domínio (outro projeto). A conferência de Origin compara só o endereço e o `Path=/greencheese/` do cookie não separa páginas da mesma origem: um script rodando em qualquer página do `oprojeto.online` (um XSS no outro projeto, por exemplo) leria o csrf no `admin-sessao` e mexeria no painel com a sessão do dono (nomes, WhatsApps, confirmar, apagar). Quando a loja tiver domínio ou subdomínio próprio (ex.: `greencheese.oprojeto.online`), mover site, painel e API pra lá (o build já usa caminho relativo; troca o `urlPublica`). Até lá, a segurança do painel depende também do outro projeto.

## Painel do dono

O painel (`/painel/`, ver LEIA-ME.md, "Painel do dono") está pronto e testado contra o servidor de verdade. Falta da loja:

- **Mensagens prontas do WhatsApp** (`src/painel/mensagens.ts`): confirmar o tom com o dono. A de cobrar a reserva diz "Me chama aqui que te passo o Pix" porque a chave Pix não está no painel; se a loja quiser, a chave entra na mensagem.
- **Rateio que não lota, devolução e sair depois de pagar**: o painel não promete nada (a mensagem do cancelamento diz que a loja chama pra combinar). Ver "Servidor".
- **Celular de verdade**: abrir o painel no celular do dono, entrar e "Adicionar à tela de início" (Android/Chrome e iPhone/Safari). Os testes daqui simulam toque e tamanho de tela, não o aparelho.
- **"Avisados"** (quem já recebeu o aviso de cada passo) fica guardado no aparelho: em outro celular a marcação recomeça (as mensagens continuam todas lá).
- **Próximas seções** (produtos, prêmios, ajustes, pedidos): entram na lista de `src/painel/secoes.ts` quando existirem; por enquanto o painel mostra só o que funciona.

## Pedidos e avisos no WhatsApp

O pedido com código, a cópia no servidor, o painel dos pedidos, os avisos no grupo e os textos do pedido estão prontos e testados (ver LEIA-ME.md, "Pedidos, avisos no WhatsApp e textos do pedido"). Falta da loja:

1. **Número que manda e o serviço de envio**: escolher Z-API ou Evolution API (contratar ou subir o servidor) e um chip só pra mandar os avisos. Esses serviços usam o WhatsApp Web do número conectado, não a API oficial da Meta: por isso um número à parte, nunca o que atende os clientes. Conectar (QR Code), criar o grupo privado com o celular da loja, preencher em Avisos no WhatsApp e tocar em "Enviar teste". Até lá os avisos ficam desligados: os pedidos chegam no WhatsApp da loja e no painel do mesmo jeito.
2. **A mensagem do grupo**: conferir com o dono o modelo (LEIA-ME tem o exemplo): o que falta, o que sobra, a ordem. Os textos moram em `public/api/nucleo/avisos.php` (`gc_aviso_texto_pedido`, `gc_aviso_rateio_reserva`, `gc_aviso_rateio_pago`).
3. **Mensagens prontas pro cliente** em cada passo do pedido (`src/painel/pedidos/mensagens.ts`): confirmar o tom. A do confirmado diz o valor dos itens e que "a taxa de entrega e o total a gente fecha por aqui" (a taxa não está no painel).
4. **WhatsApp de quem pediu**: vai junto quando a pessoa está com a conta aberta (a conta com código pelo WhatsApp liga com os avisos). Nos outros pedidos o dono guarda o número no pedido, tirando da conversa.
5. **Pedido mudado**: até 2 h depois de mandar, o pedido mudado entra no lugar do de antes (que sai da lista se ainda estava novo); depois disso são dois pedidos, ligados, e o aviso pede pra conferir. Confirmar com o dono se 2 h é o tempo certo.
6. **LGPD dos pedidos**: o servidor guarda nome, endereço, observação e (quando tem) o WhatsApp de quem pediu, e o texto dos avisos. Valem as mesmas definições pendentes do rateio (controlador, prazo de retenção, canal de exclusão, política de privacidade). O painel já apaga os dados de um pedido entregue ou cancelado ("Apagar os dados (LGPD)").
7. **Pedidos no celular**: no painel do celular, Pedidos, Avisos e Textos ficam no Resumo (os novos no topo) e em Conta → "Mais do painel", fora da barra de baixo (que segue com 5: Resumo, Rateios, Criar, Atividade e Conta). Se o dono usar mais os pedidos que os rateios, trocar em `src/painel/secoes.ts` (confirmar com o Ian).
8. **Textos do pedido**: o dono troca as falas do chat; o formato da mensagem do WhatsApp e o botão "Fechar pedido no WhatsApp" continuam fixos (combinados com a loja). Promessa de prazo ou frete e tabaco são recusados.
9. **Limite de pedidos por IP e a CDN**: o servidor aceita 20 pedidos novos por hora de cada IP (contra robô). Se ele estiver vendo o IP da CDN no lugar do de cada cliente (ver "Servidor", IP do cliente), o limite vira da loja inteira: depois do 20º pedido na hora, a cópia dos próximos fica guardada no aparelho e só chega no painel e no grupo quando a pessoa volta ao site (o pedido em si chega no WhatsApp da loja na hora, como sempre). Conferir o Diagnóstico depois de publicar.

## Contas (equipe e clientes)

A equipe com papéis e estados, as contas dos clientes com código pelo WhatsApp, a Minha conta com pedidos, vagas e endereços e o Teste minha sorte sorteado no servidor estão prontos e testados (LEIA-ME.md, "Contas: equipe e clientes"). Falta:

1. **Número que manda o código**: é o mesmo dos Avisos no WhatsApp (Z-API ou Evolution, WhatsApp Web de um chip à parte). Mandar mensagem pra número que não salvou o contato aumenta o risco de bloqueio do WhatsApp — e um bloqueio derruba os avisos do grupo junto. O que segura hoje: 1 por minuto, 3 em 15 min e 8 por dia por número; 10 por hora por IP e 20 por hora por rede (IPv4 /24, IPv6 /48); e o **teto da loja inteira** (30 por hora e 200 por dia; o dono muda em Clientes): batido, o entrar com código pausa sozinho (o site volta pra conta do aparelho e o topo de Clientes diz até quando) e volta sozinho quando a janela passa. Quem pede código pro número dos outros não trava a dona: valem os 2 últimos códigos (o que chegou pra ela continua valendo e a tela vai direto pro passo do código) e, do aparelho em que a conta já entrou, o limite do número é só dela. Fica de fora: exigir conta existente antes de mandar (impediria criar conta) ou um passo a mais (captcha: não tem provedor). Acompanhar o volume no começo; a saída oficial continua sendo a API do WhatsApp Business da Meta com um modelo de mensagem de autenticação aprovado: contratar quando o volume pedir (aí o número dos avisos fica separado do número dos códigos).
2. **A mensagem do código**: "*482913* é teu código pra entrar na Green Cheese. Vale por 10 minutos. Não passa ele pra ninguém: a loja nunca pede esse código." (em `public/api/nucleo/clientes.php`). Confirmar o tom com o dono.
3. **LGPD das contas**: valem as definições pendentes do rateio e dos pedidos (controlador com CNPJ, finalidade, base legal, prazo de retenção, canal de exclusão e a política de privacidade publicada, com link na Minha conta). Já funcionam: opt-in de promoções separado, desligado por padrão e com data; "Baixar meus dados"; "Apagar minha conta" no site e "Apagar a conta" no painel (os pedidos ficam com a loja, sem a conta: confirmar se a loja precisa guardar esses pedidos e por quanto tempo).
4. **Lista de promoções (Excel)**: só quem aceitou, com a data. Usar fora da loja (disparo em massa) tem as mesmas regras do WhatsApp e da LGPD: confirmar com o contador ou advogado como a loja vai mandar promoções.
5. **Frente da loja (integração)**: as rotas dela entram no mapa `GC_PERMISSAO_ROTA` (`public/api/nucleo/equipe.php`) com a permissão `produtos` (produtos, estoque, disponibilidade: gerente e dono) ou `loja` (estados, stories, textos da loja, prêmios: só o dono), e filtram por estado com `gc_filtro_ufs`/`gc_exigir_uf` quando for coisa de um estado. Até entrar no mapa, só o dono passa (o `testar-api` acusa rota fora do mapa). Os prêmios do Teste minha sorte saem de `gc_premios_ativos()`: quando a frente da loja definir essa função (os prêmios do painel), a semente (`premios-semente.php` + `premios-sorte.json`) para de valer sozinha; o contrato está no API.md.
6. **Papéis**: os do pedido (dono, gerente, atendente). Se a loja quiser outro (ex.: só entregas), é uma linha em `GC_PERMISSOES_PAPEL` e no `PAPEIS` do painel (`src/painel/contas/comum.tsx`): confirmar com o Ian antes.
7. **Baixa do cupom**: a loja dá baixa em Clientes (o "Mandei" do pedido guiado também marca, e a loja desfaz se não usou). Confirmar com o dono se a baixa é na entrega ou na confirmação do pedido.
8. **Giro do Teste minha sorte**: 1 por aparelho sem conta e 1 por dia com conta (por conta, WhatsApp e aparelho). Aba anônima ou outro navegador ainda dão o giro sem conta de novo (o aparelho é um segredo guardado no navegador), mas ele só vira cupom numa conta que não girou naquele dia: guardar o giro sem conta (entrar, criar a conta ou o "guardar") conta como o giro do dia da conta, e a conta que já girou recusa ("ja-girou-hoje"; a tela diz que o prêmio desse giro não entra). Então, com conta, é uma vez por dia mesmo. As pendências legais do sorteio continuam valendo ("Teste minha sorte", itens 1 a 3).
10. **A conta do aparelho no primeiro login**: os cupons que estavam só no aparelho entram uma vez por conta, no máximo 2, e só os ganhos antes de a conta do servidor existir (o primeiro dia em que o entrar com código esteve ligado: depois disso todo cupom nasce no servidor), com a validade contada do dia em que foram ganhos. Quem usou a conta do aparelho num período em que o código esteve desligado depois do primeiro dia perde esses cupons ao entrar (a loja confirma no WhatsApp como sempre). Confirmar com o dono.
11. **Pedidos e vagas na conta**: aparecem na conta os feitos com ela logada e os do WhatsApp dela quando o número foi conferido (veio da conta logada, ou a loja salvou o número no pedido ou na vaga pelo painel). O número que a pessoa digita no aparelho não liga nada a conta nenhuma. No "Baixar meus dados", o pedido ou a vaga achado só pelo número vai sem nome, endereço, observação e mensagem.
9. **Painel no celular**: a barra de baixo muda por papel (gerente: Resumo, Rateios, Criar, Pedidos e Conta; atendente: Resumo, Rateios, Atividade, Pedidos e Conta; dono: como antes, com Equipe e Clientes em Conta → "Mais do painel"). Confirmar com o Ian se o dono quer Pedidos na barra dele.

## Publicação

- **No ar em `https://oprojeto.online/greencheese/`** (com `noindex` enquanto `modoPrevia: true`). Atualizar: `npm run build` + `node scripts/publicar.mjs` (ver LEIA-ME.md). Só a pasta `greencheese/` é escrita.
- **Publicar à mão** (hPanel): o pacote sai de `npm run empacotar`, com as mesmas regras do `publicar.mjs` (recusa o código de dev, deixa banco, log e fotos de fora). O `entrega/greencheese-dist.zip` que está no repositório é de antes do servidor (só o site, sem `api/`): gerar de novo antes de usar.
- Se o endereço final for outro, trocar `urlPublica` em `src/dados/config.ts` e gerar o build de novo.
- Testar no navegador do Instagram, no Android e no iPhone de verdade (os testes daqui simulam toque e tamanho de tela, não o aparelho).

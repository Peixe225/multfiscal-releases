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

## Servidor

O servidor (PHP + SQLite, `api/`) está pronto e testado (ver LEIA-ME.md, "Servidor (API)"). Falta da loja:

- **LGPD dos dados do rateio**: o servidor guarda nome, WhatsApp, estado e cidade de quem entra num rateio (e as anotações do dono). Falta definir: o **controlador** (razão social e CNPJ da loja), a finalidade e a base legal (fechar e entregar o pedido do rateio), **por quanto tempo** os dados ficam depois do rateio encerrado (sugestão: 6 meses e depois apagar), o **canal de exclusão** (o painel já apaga os dados de uma pessoa sem mexer nas contas do rateio: `admin-participante-apagar`) e publicar a política de privacidade (com link no formulário do rateio). O IP de quem tenta entrar não é guardado puro (só um hash com sal, para o limite de tentativas, e some em 1 dia).
- **Rateio que não lota e devolução**: a loja não definiu. O site não promete nada: diz que a loja chama no WhatsApp pra combinar. Confirmar com o dono: prazo máximo pra lotar, o que acontece com quem já pagou (devolve o Pix? vira crédito?) e se dá pra sair depois de pagar.
- **Rotina de backup**: quem baixa a cópia do banco (painel → "Baixar cópia do banco"), de quanto em quanto tempo (sugestão: toda segunda) e onde guarda (fora do celular, ex.: Drive da loja; o arquivo tem dados de clientes). O backup da Hostinger existe, mas restaurar a hospedagem inteira desfaz o resto do site junto.
- **Pix direto no site**: escolher o provedor (ex.: Mercado Pago, Efí, Asaas, PagSeguro ou o banco da loja) e gerar as credenciais (geralmente com conta PJ). A rota do webhook (`pix-webhook`, hoje responde "não configurado") e a confirmação automática (a mesma função do painel) já estão prontas; falta ligar o provedor.
- **Código de instalação**: gerar o de verdade antes de publicar o servidor (`php scripts/codigo-instalacao.php`) e entregar ao dono por canal seguro.
- **Conferir no ar** depois da 1ª publicação com a API: painel → Diagnóstico (banco, log e módulos fechados pela web, nenhum `.php` rodando em `uploads/`, PHP 8.1+, GD com WebP, pasta gravável). Os `.htaccess` passaram num Apache local (os dois ramos, `Require` e `Order/Deny`); a Hostinger usa LiteSpeed, que lê o mesmo `.htaccess`, mas só o Diagnóstico no ar prova.
- **Versão do PHP** no hPanel: 8.1 ou mais nova (8.3 recomendada).
- **IP do cliente**: o limite de tentativas usa o IP que chega no PHP (12 entradas em rateio por hora por IP; IPv6 conta por /64, que é um aparelho ou uma casa). Se um dia a Hostinger puser CDN na frente do site, conferir que o IP continua sendo o de cada cliente (senão todo mundo divide o mesmo limite). Operadora de celular que põe muita gente atrás de um IPv4 só (CGNAT) pode fazer clientes diferentes dividirem o limite num rateio muito disputado: se aparecer "Muita tentativa seguida" pra quem não errou, subir o 12 em `publico.php`.

## Painel do dono

O painel (`/painel/`, ver LEIA-ME.md, "Painel do dono") está pronto e testado contra o servidor de verdade. Falta da loja:

- **Mensagens prontas do WhatsApp** (`src/painel/mensagens.ts`): confirmar o tom com o dono. A de cobrar a reserva diz "Me chama aqui que te passo o Pix" porque a chave Pix não está no painel; se a loja quiser, a chave entra na mensagem.
- **Rateio que não lota, devolução e sair depois de pagar**: o painel não promete nada (a mensagem do cancelamento diz que a loja chama pra combinar). Ver "Servidor".
- **Celular de verdade**: abrir o painel no celular do dono, entrar e "Adicionar à tela de início" (Android/Chrome e iPhone/Safari). Os testes daqui simulam toque e tamanho de tela, não o aparelho.
- **"Avisados"** (quem já recebeu o aviso de cada passo) fica guardado no aparelho: em outro celular a marcação recomeça (as mensagens continuam todas lá).
- **Próximas seções** (produtos, prêmios, ajustes, pedidos): entram na lista de `src/painel/secoes.ts` quando existirem; por enquanto o painel mostra só o que funciona.
- **Ao juntar com a frente do rateio no site**: a variável `__ARQUIVO_UNICO__` que ela põe no `define` do `vite.config.ts` entra na constante `definir` (vale pro site e pro painel). Conferido numa cópia de integração: o rateio criado no painel aparece em `/?rateio=<id>` com a foto enviada, e o `testar-painel` passa a abrir o site sozinho quando o build tem a aba Rateio.

## Publicação

- **No ar em `https://oprojeto.online/greencheese/`** (com `noindex` enquanto `modoPrevia: true`). Atualizar: `npm run build` + `node scripts/publicar.mjs` (ver LEIA-ME.md). Só a pasta `greencheese/` é escrita.
- Se o endereço final for outro, trocar `urlPublica` em `src/dados/config.ts` e gerar o build de novo.
- Testar no navegador do Instagram, no Android e no iPhone de verdade (os testes daqui simulam toque e tamanho de tela, não o aparelho).

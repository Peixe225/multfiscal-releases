# Briefing original (cópia fiel do pedido) — MVP de prospecção Green Cheese Imports

MVP DE PROSPECÇÃO — GREEN CHEESE IMPORTS
Prévia feita pela I&H Soluções Digitais para mostrar ao dono da marca e fechar a venda.

== 0. MODO DE TRABALHO ==
Atuar como diretor de arte e desenvolvedor front-end sênior. Trabalhar do começo ao fim sem pedir aprovação a cada etapa: decidir, anotar a decisão em DECISOES.md e seguir. Parar para perguntar só se algo impedir o trabalho (ex.: Node não instalado).
Ordem obrigatória:
1) abrir TODAS as imagens de referencias/;
2) escrever PLANO.md (curto): paleta com 4 a 6 cores nomeadas em hex; tipografia e papéis; wireframe em ASCII das telas do celular (abertura, home, story do produto, chat) e do desktop; os 3 momentos de motion; 5 princípios;
3) criticar o plano: marcar tudo que sairia igual em qualquer outro site escuro e trocar por algo que só faz sentido para a Green Cheese;
4) construir;
5) revisar por screenshots e corrigir (seção 10);
6) gerar o build e os documentos de entrega (seção 11).

== 1. O QUE É E PARA QUEM ==
Um site só para a Green Cheese Imports inteira: catálogo + pedido guiado que termina no WhatsApp do atendimento certo. Por ser prévia de venda, precisa impressionar nos primeiros 10 segundos e funcionar de verdade até a mensagem do pedido ficar pronta no WhatsApp.
Quem abre: o dono da marca e, depois, os clientes dele, quase sempre no celular, vindos do link da bio, dentro do navegador interno do Instagram. Celular em primeiro lugar (360 a 430 px). Desktop bem composto, não um celular esticado.

== 2. PEDIDO DO IAN (palavras dele; respeitar à risca) ==
- "É uma tabacaria online/delivery que funciona em diversos estados e cidades diferentes."
- "As cores predominantes são pretas, e o seu estilo é mais underground."
- "Quero um site onde a pessoa possa pedir por lá e direcionar pro atendimento correto (cidade)."
- "Além de mostrar os produtos do catálogo, disponível e indisponível."
- "Quero algo bem visual, com bastante motion, no estilo deles e artes bem lindas."
- "E tem que ter todos os Instagrans da Greenchesee"
- "1 site só para vários estados"
- "Green Cheese Imports, poder encomendar os pedidos através do chat, fazendo chegar no WhatsApp."
- "Identifica o estado do cliente o redireciona para o canal certo."
- "Torne o site o mais útil possível"

== 3. REFERÊNCIAS ==
A pasta referencias/ tem 16 prints de tela (1242×2688) do Instagram da marca. São a fonte da identidade. O que há neles:
- Perfis "GREEN CHEESE LTDA" do RJ e de MG. Logo: círculo preto, cuia desenhada em linha branca, "GREEN CHEESE" em letras brancas grossas e inclinadas dentro da cuia, tesoura em cima.
- Stories de produto no padrão da marca: fundo preto puro, produto recortado no centro com brilho suave, nome e preço em fonte pixel/bitmap branca, "DISPONÍVEL ✅" e o adesivo de localização do Instagram ("Rio de Janeiro", "Teófilo Otoni").
- Destaques com ícone de entregador de moto: "DELIVERY RJ" e "TEÓFILO OTONI".
- Um story com a lista dos perfis por estado; reposts de clientes marcando a loja; uma ilustração em pixel art de cliente segurando a garrafa.
- Trilha dos stories: rap underground e lo-fi (Xavier Wulf, BONES, Pizza Hotline). Clima: madrugada, VHS, pixel, dither.
Não usar: a figura encapuzada de um dos prints (é personagem de jogo, não é da marca) nem o perfil pessoal "merchant" citado na bio. O site usa só os perfis greencheese_imports.

== 4. DADOS ==
4.1 Canais por estado — tudo em src/dados/canais.ts
- RJ: @greencheese_importsrj, Rio de Janeiro ("Delivery RJ")
- MG: @greencheese_importsmg, Teófilo Otoni
- SP: @greencheese_importssp, cidade PENDENTE
- ES: @greencheese_importses, cidade PENDENTE
- SC: @greencheese_importssc, cidade PENDENTE
- @greencheese_importsvv aparece em marcações de clientes do Rio: listar junto dos perfis, com a marca "confirmar".
WhatsApp de cada canal: PENDENTE (os prints não mostram; hoje a venda é por DM). Deixar whatsapp: null. Nunca inventar número.
Campos do canal: uf, nome, cidades[] (um estado pode ter mais de uma), instagram, whatsapp, horario, taxaEntrega, entregaGratis, pagamento[]. Horário, taxa e pagamento são PENDENTES: usar valores de demonstração marcados com demo: true. Dado real para aproveitar: em MG, "Sextou com entrega grátis!".

4.2 Catálogo — src/dados/catalogo.json
Produtos e preços reais vistos nos stories:
- Fanta Ghost Face Punch 350 ml | bebidas importadas | disponível em MG | preço PENDENTE
- Coca-Cola Vanilla (lata) | bebidas importadas | preço PENDENTE
- Jack Daniel's Old No. 7 1 L | destilados | R$ 149,90 (MG)
- Gin Tanqueray London Dry 750 ml | destilados | R$ 99,99 (RJ e MG)
- Hennessy Very Special | destilados | RJ | preço PENDENTE
- Seda OCB Premium Slim | sedas | R$ 9,99, 2 por R$ 14,99, 3 por R$ 19,99 (RJ)
- Piteira de vidro RAW, 6 mm × 3,5 cm flat e 7 mm × 5 cm slim | piteiras | R$ 29,99 (RJ)
- Cuia de silicone RAW | acessórios | disponível no RJ | preço PENDENTE
Regras:
- Disponibilidade é por estado: disponivel: { rj, mg, sp, es, sc }.
- Preço desconhecido de produto real: mostrar "Consultar"; não inventar.
- Combo de quantidade (como o da OCB) vai em combos: [{ qtd, total }] e a sacola aplica o melhor preço sozinha.
- Completar até cerca de 16 itens com produtos de exemplo coerentes com a linha (bebidas importadas, sedas, piteiras, dichavadores, isqueiros, bandejas), marcados demo: true. Deixar 3 ou 4 indisponíveis por estado para o estado "indisponível" aparecer.
- Derivados do tabaco (Backwoods, charutos, cigarros, fumo) NÃO entram no site: a Anvisa não considera a internet local de venda desses produtos e veda oferta e venda por esse meio (RDC 840/2023, art. 6º). Sedas, piteiras, cuias e acessórios entram normalmente.
- Fotos: recortar a arte dos produtos a partir dos prints (script com sharp), sobre preto puro, em WebP. Resolução baixa se resolve com o tratamento em dither da seção 7. Produto sem foto: silhueta em pixel art feita em SVG (garrafa, lata, caixa, seda); nunca imagem genérica de banco.

== 5. CONCEITO: O STORY QUE VENDE SOZINHO ==
Hoje a Green Cheese vende por story: fundo preto, produto flutuando, nome em pixel, preço, "DISPONÍVEL ✅", adesivo de cidade. O site pega exatamente essa linguagem e transforma em loja. O dono precisa bater o olho e pensar: "é o nosso story, só que o pedido chega pronto".
Tradução da linguagem do Instagram para a interface, coerente do começo ao fim:
- adesivo de localização = seletor de estado/cidade, sempre visível no topo;
- bolinhas de destaque = categorias do catálogo;
- story de produto = o card (proporção 9:16) e também a tela do produto em tela cheia, com barrinhas de progresso no topo, toque nas laterais para passar, segurar para pausar, arrastar para baixo para fechar;
- campo "Enviar mensagem…" do story = entrada do pedido pelo chat;
- DM = chat de pedido.
Pode melhorar o conceito; não pode diluir em loja genérica.

== 6. O QUE O SITE FAZ ==
6.1 Entrada +18
"Tem 18 anos ou mais?" com "Tenho" e "Não tenho". Faz parte da abertura, não é pop-up por cima. Lembrar por 30 dias. "Não tenho" leva a uma tela de saída.

6.2 Estado e cidade (o coração do site)
Ordem de decisão:
1) parâmetro na URL (?uf=mg e, opcional, &cidade=teofilo-otoni): é o link que cada perfil vai pôr na própria bio, a fonte mais confiável;
2) escolha já salva no aparelho;
3) palpite por IP, sem pedir permissão de GPS: ipwho.is (campo region_code) e, se falhar, get.geojs.io/v1/ip/geo.json (campo region, nome do estado). Timeout de 2,5 s; nunca travar a página esperando;
4) seletor manual com as 27 UFs, as 5 atendidas no topo.
O palpite por IP erra, principalmente em rede móvel: nunca direcionar em silêncio. Mostrar no adesivo "Parece que é de Minas Gerais — Teófilo Otoni" com "É daí" e "Trocar".
CEP (opcional, no chat): BrasilAPI (brasilapi.com.br/api/cep/v2/{cep}) com ViaCEP de reserva; confirma UF, cidade e bairro e preenche o endereço.
Estado com mais de uma cidade: perguntar a cidade. Estado sem atendimento: tela própria ("A Green Cheese ainda não chegou aí"), com os estados atendidos e a opção de encomenda.
Trocar de estado muda tudo junto: disponibilidade, canal do pedido, Instagram em destaque, horário e entrega.

6.3 Catálogo
Categorias como bolinhas de destaque (Tudo, Bebidas importadas, Destilados, Sedas, Piteiras, Acessórios); busca; chave "Só disponíveis". Grade de cards 9:16, 2 colunas no celular. Card: foto sobre preto, nome em pixel, preço (ou "Consultar"), "DISPONÍVEL ✅" ou "INDISPONÍVEL". Item indisponível continua visível, em dither cinza, com "Avisar quando chegar" (abre o canal do estado com a mensagem pronta).

6.4 Tela do produto (story)
Tela cheia com barrinhas de progresso da categoria, produto grande flutuando, variações (ex.: piteira flat/slim), faixas de combo com o preço de cada uma, seletor de quantidade, "Pôr na sacola" e a barra "Pedir este item…", que abre o chat já com o item.

6.5 Sacola
Botão flutuante com contador. Lista, quantidades, melhor combo aplicado, subtotal. "Fazer pedido" abre o chat.

6.6 Pedido pelo chat → WhatsApp
Folha que sobe de baixo, com cara de conversa de DM. É um roteiro guiado, não uma IA e não finge ser gente: título "Pedido guiado". Respostas rápidas em chips e campo de texto só onde precisa. Passos: confirmar estado/cidade → revisar a sacola → nome → endereço (CEP opcional preenche) → pagamento (Pix, dinheiro com troco, cartão na entrega) → observação → resumo → "Enviar no WhatsApp".
Formato da mensagem (exemplo):
    PEDIDO GREEN CHEESE — MG / Teófilo Otoni
    1x Jack Daniel's Old No. 7 1 L — R$ 149,90
    3x Seda OCB Premium Slim — R$ 19,99
    Subtotal: R$ 169,89
    Entrega: Rua …, Bairro … (taxa a confirmar)
    Pagamento: Pix
    Nome: …
    Obs.: …
Destino:
- canal com WhatsApp cadastrado: https://wa.me/55DDDNUMERO?text=(mensagem codificada);
- canal sem número (caso da prévia): https://wa.me/?text=(mensagem), que abre o WhatsApp para escolher o contato, e ao lado "Copiar pedido e abrir a DM do Instagram" (https://ig.me/m/perfil-do-estado).
Abrir o link sempre por um <a href> tocado pela pessoa (o navegador interno do Instagram bloqueia window.open depois de await). O site só monta a mensagem; quem aperta enviar é o cliente.
Guardar sacola e respostas no aparelho para não perder se a pessoa sair e voltar.

6.7 Encomenda
"Não achou? A Green Cheese importa." Ramo do chat: produto desejado, quantidade, link ou descrição → mensagem pronta para o canal do estado.

6.8 Green Cheese por estado (todos os Instagrams)
Mapa do Brasil em blocos + um cartão por estado com cidades, Instagram (https://www.instagram.com/perfil/), botão de pedido e horário. O estado atual vem primeiro; tocar em outro estado troca o site para ele. Todos os perfis aparecem também no rodapé.

6.9 Rodapé e avisos
"Venda proibida para menores de 18 anos." "Beba com moderação." Aviso curto de privacidade: a localização aproximada (pelo IP) serve só para indicar o atendimento; nada é guardado em servidor da loja. Favicon do logo e imagem de compartilhamento no padrão story.

6.10 Se sobrar fôlego (só com o essencial impecável)
Catálogo lido de planilha publicada (CSV do Google Sheets), para o dono marcar disponível/indisponível pelo celular; link direto por produto (?p=id) com botão de compartilhar; selo "Aberto agora/Fechado" a partir do horário; sugestão de combinação na sacola (ex.: Jack Daniel's + Coca-Cola Vanilla, como num post deles).

== 7. DIREÇÃO VISUAL, ARTE E MOTION ==
Paleta: preto puro #000 (os stories são preto puro; em tela OLED a página some na moldura do aparelho), branco e 2 ou 3 cinzas. Interface monocromática. A cor vem do produto: cada card tira a cor dominante da foto e usa como brilho. Verde só no "DISPONÍVEL ✅". Nada de preto com verde neon "hacker".
Tipografia: títulos em fonte pixel/bitmap como nos stories (testar Pixelify Sans, Jersey 15 e Silkscreen com Í, Ç, Ã, É e escolher uma); texto corrido na fonte do sistema (system-ui), que é a cara da interface do Instagram onde a marca vive e não pesa nada. Fontes hospedadas no projeto (Fontsource/woff2), sem chamada externa.
Arte, toda feita em código:
- logo redesenhado em SVG (cuia em linha, tesoura, GREEN CHEESE inclinado); se não ficar fiel, usar o recorte do print;
- mapa do Brasil em blocos: 27 UFs como quadrados em posição aproximada, estilo pixel, com os 5 estados atendidos acesos;
- um emblema em pixel art por estado (RJ: Pão de Açúcar; MG/Teófilo Otoni: pedra preciosa, porque um print traz "capital das pedras preciosas"; SP, ES e SC: motivo do estado até a cidade ser confirmada);
- ícones em pixel art SVG (entregador de moto, cuia, tesoura, sacola);
- imagens com dither ordenado (Bayer) e grão leve; item indisponível em dither cinza com chiado.
Motion: três momentos fortes, o resto quieto.
1) Abertura (uma vez por visita, pulável, até 3 s): tela preta, o logo se desenha em linha, a tesoura dá um corte, entra a pergunta do +18 em pixel e depois o adesivo de localização cai no lugar com o estado detectado.
2) Card → story: o card cresce até virar a tela cheia do produto (elemento compartilhado com GSAP Flip ou View Transitions), produto flutuando com leve giro, barrinhas de progresso correndo; ao pôr na sacola, o produto voa até o ícone.
3) Revelação em dither: as imagens surgem do ruído para a foto ao entrar na tela, e o mapa em blocos acende estado por estado.
Fora isso: hero com os produtos disponíveis do estado flutuando no vazio com paralaxe de rolagem; faixa em pixel com os estados; microinterações que respondem ao toque.
Desktop: story em coluna central no formato do celular, com o catálogo escurecido ao fundo; hero e mapa ganham composição própria em duas colunas.
Proibido (cara de site gerado): cards arredondados com sombra cinza, gradiente roxo, vidro fosco, fade-up em toda seção, rótulo em caixa-alta acima de cada título, numeração 01/02/03 onde não há sequência, hero de título centralizado com dois botões, emoji como marcador de lista.
Limites: animar só transform e opacity; 60 fps em Android intermediário; canvas/WebGL só onde dá ganho real e pausado fora da tela; respeitar prefers-reduced-motion (troca por cortes secos); sem som.
Texto do site: voz direta, de rua, frases curtas, sem tom corporativo. Matéria-prima real dos stories: "DISPONÍVEL ✅", "Sextou com entrega grátis!", "Vem no certo!", "Quem tiver interesse é só mandar dm", "Quem já usou sabe da qualidade". Botão diz o que acontece: "Pôr na sacola", "Enviar no WhatsApp", "Trocar cidade", "Avisar quando chegar". Não inventar promessa (prazo, frete, desconto) que não esteja nos dados.

== 8. STACK ==
Vite + React + TypeScript; GSAP (ScrollTrigger, Flip) e Lenis; estado com Zustand; sem back-end e sem banco. Saída 100% estática em dist/, com base './' e sem depender de regra de servidor (estado, produto e chat por query string), para subir em qualquer pasta ou subdomínio da Hostinger.
Dados só em src/dados/ (canais.ts, catalogo.json, config.ts). Em config.ts, modoPrevia: true liga o noindex, um selo "prévia" discreto e o crédito no rodapé: "Prévia criada pela I&H Soluções Digitais — @ihsdigital".
Antes de começar, conferir node -v e npm -v; se faltar, parar e avisar.

== 9. QUALIDADE ==
Funciona de 360 a 430 px e em 1440 px; 100dvh e áreas seguras do iPhone; nada depende de hover; alvos de toque de pelo menos 44 px; foco visível e teclado no story (setas, Esc); contraste AA; imagens WebP com lazy-load; sem pulo de layout; primeira tela utilizável em até ~2,5 s em 4G; console sem erro; textos em pt-BR, valores em R$ com vírgula.

== 10. REVISÃO POR SCREENSHOTS ==
Subir o servidor de desenvolvimento e tirar screenshots com Playwright (ou a ferramenta de navegador disponível) em 390×844 e 1440×900 de: abertura, hero, catálogo, story de produto, item indisponível, sacola, chat no resumo, estado sem atendimento, perfis por estado. Comparar cada imagem com este briefing e com os prints de referencias/. Listar o que está genérico, quebrado ou fora da marca, corrigir e repetir. No mínimo duas rodadas. Testar o fluxo inteiro até o link do WhatsApp sair com a mensagem certa para RJ e para MG.

== 11. ENTREGA ==
- projeto rodando (npm run dev -- --host, para abrir no celular pela rede) e build em dist/;
- LEIA-ME.md: como rodar, como subir a pasta dist/ na Hostinger, onde trocar número de WhatsApp, produto, preço e disponibilidade;
- PENDENCIAS.md: tudo que está como PENDENTE ou demo (WhatsApp de cada estado, cidades de SP/ES/SC, horários, taxas, preços, fotos oficiais, situação do perfil "vv", derivados do tabaco fora do site);
- DECISOES.md: direção visual e escolhas, em até 15 linhas;
- no fim, responder com o endereço local e o de rede, o que ficou pronto e o que ficou pendente.

Hospedagem desejada: Hostinger, domínio "Oprojeto.online".

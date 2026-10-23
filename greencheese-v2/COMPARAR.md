# COMPARAR — versão no ar (`greencheese/`) × versão 2 (`greencheese-v2/`)

A `greencheese/` é a versão que está no ar em oprojeto.online/greencheese (commit f30c143) e não mudou. A
`greencheese-v2/` nasceu dela (commit 775e3de) e recebeu a rodada final de polimento antes da entrega: a bateria de
testes (segurança, site e painel), as correções do que ela achou e três novidades (estúdio de foto, thumb animada e a
vitrine do mercador).

Para ver a diferença no código: `git diff 775e3de HEAD -- greencheese-v2` (ou `diff -r greencheese greencheese-v2`).
Para ver na tela: os prints lado a lado (antes à esquerda, depois à direita) que acompanham esta entrega.

## Novidades

- **Estúdio do produto (painel)**: a foto do celular vira o estilo do site sozinha — fundo liso recortado (com
  "Quanto do fundo apagar" e toque para apagar/devolver), produto enquadrado na medida das ilustrações, cor acertada e
  prévia "Antes | Depois" igual ao site. "Usar a foto original" continua possível; foto já salva ganha "Ajustar a foto".
  Ver LEIA-ME, "Estúdio do produto".
- **Thumb animada**: um vídeo curto do celular (trecho de até 6 s) gravado no estilo da loja, com capa. Toca na grade, no
  story aberto e na página do produto, só à vista, no máximo 2 ao mesmo tempo, nunca antes da primeira tela; com economia
  de dados ou movimento reduzido fica na capa. O servidor confere o vídeo pelos bytes (até 6 MB).
- **Vitrine do mercador**: entre um cliente e outro o mercador ergue um produto da loja do estado com uma plaquinha de
  nome e preço; tocar abre o produto. Sem bebida alcoólica, sem tabaco, sem isqueiro. Chave no painel: Loja → "O mercador
  mostra produtos na rua".
- **Categoria "Bebida alcoólica"** (painel): a marca alimenta o filtro de álcool da rua e dos prêmios (o nome continua
  como reforço). Os Destilados já vêm marcados.
- **Rodapé** com "© 2026 Green Cheese Imports. Todos os direitos reservados."

## Rodada de 11 a 13/10

- **Endereço próprio**: `greencheese.oprojeto.online`, com certificado. O endereço antigo leva ao novo (301 em GET e
  HEAD; pedido de outro tipo no antigo recebe 410). O painel deixa de dividir o endereço com o outro site.
- **Teste minha sorte, regras do dono**: N giros a cada X dias (1 a 5 giros, 1 a 30 dias, no calendário de Brasília),
  quatro raridades com cor (Comum prata, Raro azul, Épico fúcsia, Lendário ouro), chance por raridade somando 100% (de
  fábrica 60/25/12/3), a chance real de cada prêmio ("1 em 8"), "Simular giros" no servidor e "Testar a animação" de
  cada prêmio ou das 4 raridades.
- **Revelação na fumaça**: o beck sobe aceso no isqueiro, é fumado, a fumaça enche a tela e o prêmio aparece grande no
  meio dela, depois voa para o story. Uma cena por raridade, mais viajada quanto mais rara (comum ~5,4 s, raro ~6,7 s,
  épico ~8,1 s, lendário ~8,8 s). Desenhada sem WebGL: ~57 quadros por segundo com o processador 4× mais lento.
  "Pular" chega ao story em ~0,5 s; com movimento reduzido, nada anima (o quadro final parado).
- **Conta do cliente**: criar e entrar auditados de ponta a ponta, 14 + 9 achados corrigidos com teste (sair sem
  internet, o passo do código guardado por 10 min, código pausado no meio do entrar, entre outros).
- **Material da loja de 11/10**: Jack Daniel's Tennessee Apple e Fanta Maçã da China (só no RJ, sem preço), fotos da
  Fanta Ghost Face Punch e do Hennessy Very Special, thumb animada do Hennessy em MP4/H.264. O Estúdio aceita a
  gravação de tela do Instagram (acha a janela do vídeo sozinho) e não recorta fundo que já é preto; o tamanho do
  produto ficou opcional.
- **Banco no ar**: as migrações 103 (raridade dos prêmios) e 104 (o material novo, sem repetir produto e nunca por
  cima do que o dono pôs) rodam sozinhas no primeiro acesso.

## Painel (auditoria: 2.534 checagens, 21 erros e 20 propostas de uso)

- Barra nova: Início · Pedidos · + · Produtos · Mais, com o nome embaixo de cada ícone; gerente com **Estoque** (tela
  nova: à venda e estoque dos estados dele); atendente com Rateios. Lateral a partir de 720 px.
- Início com atalhos (preço e estoque, produto novo, horário e taxa, stories) e a lista **"Pra deixar a loja pronta"**.
- Guia **"Como usar o painel"** dentro do painel (14 tarefas, cada uma com botão para a tela).
- Produto com o básico em cima (foto e thumb, nome, categoria, preço, onde tem) e o resto em "Mais detalhes"; produto
  novo já nasce à venda no estado escolhido; "À venda em:" com Desfazer; sair sem salvar avisa.
- Estado reordenado (horário e taxa primeiro), "Tirar do site" no fim com confirmação e Desfazer; a cidade digitada entra
  ao salvar.
- Senha do dono recuperável sem o desenvolvedor (2º dono ou código pelo WhatsApp da loja, com limites).
- Cópia de segurança em Conta, com a data da última e lembrete depois de 7 dias.
- Erros dos avisos do WhatsApp em linguagem de dono; recado sempre no mesmo lugar; textos revistos.
- Rolagens nas 14 tarefas comuns: de 26 para 10 (mudar preço: 2 → 0; produto novo: 3 → 1).

## Site — compra (auditoria: 1.564 casos, 15 achados)

Variação com preço próprio não herda o combo; texto de privacidade com a verdade do que vai pro servidor; duas abas não
repetem o código do pedido; trocar de estado no meio do pedido revalida; CEP de outra cidade avisa; horário de Brasília
(hora do servidor) no aberto/fechado, entrega grátis e cupom; "Mandei" não limpa pedido que não saiu; troco, CEP colado,
endereço longo, RESTAM no cupom, limite de 99 e taxa R$ 0 ("Entrega grátis") certos. Bateria: 88 falhas → 0.

## Site — navegação, visual e desempenho (auditoria: 3.369 checagens, 12 erros e 14 polimentos)

Preços do story com combos sem encavalar em nenhum tamanho; busca certa ("gin" traz o gin); RESTAM longe do adesivo da
cidade; foco do teclado visível e no lugar certo; aviso com "tentar de novo" se o site não carregar; links que não
deixam lixo na URL; textos em "tu"; alvos de toque de 44 px; contraste. **Home 2 no celular: maior pintura de 5,9 s para
2,5 s**, CLS 0,047 → 0,006, e a página com metade dos elementos (14,8 mil → 8 mil).

## Segurança (auditoria: 89 ataques simulados, nota 8,5/10)

Sem brecha nova no código. Os dois pontos altos dependiam de hospedagem: o painel dividir o endereço com o outro site
do oprojeto.online (resolvido com o subdomínio, na rodada de 11 a 13/10) e o IP atrás da CDN (conferir no painel no
ar). Ver PENDENCIAS.md, "Servidor".

## O que ficou de fora de propósito

- Fonte em px (o "tamanho da fonte" do navegador não muda o texto; o zoom funciona): a fonte em pixel só fica nítida em
  px inteiros (PENDENCIAS.md).
- Conferir em aparelho de verdade: gravação de vídeo no Android e no iPhone, recorte com fotos reais da loja, navegador
  do Instagram.
- Decisões da loja (PENDENCIAS.md): gateway do WhatsApp, regras do rateio, estoque, prêmios reais, LGPD, mercador
  (personagem da Capcom), domínio próprio.

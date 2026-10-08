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

---

## Servidor (API)

O rateio (e o painel do dono) usam um servidor pequeno em **PHP + SQLite** que mora junto do site, na mesma hospedagem: `public/api/` → `dist/api/` → `oprojeto.online/greencheese/api/`. Sem MySQL e sem serviço de fora. Rotas, campos e erros: **API.md** (é o contrato entre site, painel e servidor).

### Como fica no ar

Dentro de `public_html/greencheese/`:

| Pasta | O que tem | Pela web |
|---|---|---|
| `api/index.php` | a única porta da API (a rota vai em `?r=`, ex.: `api/index.php?r=rateios`) | aberto |
| `api/nucleo/`, `api/instalacao.php` | os módulos e o hash do código de instalação | fechado (403) |
| `api/privado/` | o banco `loja.sqlite` (com o diário `loja.sqlite-wal` e `-shm`) e o `erros.log` (passou de 1 MB, vira `erros.log.1`) | fechado (403) |
| `uploads/` | as imagens que o dono envia pelo painel (WebP, nome aleatório) | só imagem; nenhum `.php` roda ali |

- O banco nasce sozinho no primeiro acesso e se atualiza sozinho (migrações pelo `PRAGMA user_version`).
- Precisa de **PHP 8.1 ou mais novo** (hPanel → Avançado → Configuração do PHP; 8.3 é o melhor) com `pdo_sqlite`, que a Hostinger já tem. Com GD + WebP, as fotos do painel são ajustadas (lado maior até 1600 px, viram WebP); sem isso, sobem do jeito que vieram.
- Cada pasta interna tem o próprio `.htaccess` (com as duas sintaxes: `Require` e `Order/Deny`) e cada módulo PHP começa com uma guarda: mesmo se o `.htaccess` falhar, abrir um módulo direto não faz nada.
- **Sem `RewriteEngine` nas nossas pastas**, de propósito: ligar a reescrita aqui anularia as regras da raiz do domínio (HTTPS etc.). Por isso a rota é um parâmetro.
- Erro nunca aparece com detalhe pro cliente: o detalhe vai pro `api/privado/erros.log`.

### Primeiro acesso: o código de instalação

1. `php scripts/codigo-instalacao.php` → mostra o código **uma vez** (4 grupos de 5, sem letra que confunde, ex.: `k7m2p-x9q4r-h3d8w-5tnby`) e grava só o hash em `public/api/instalacao.php`.
2. `npm run build` e publicar. O `publicar.mjs` **recusa** enquanto o `instalacao.php` for o de desenvolvimento (marcado `// DEV`), e o servidor no ar também não aceita o código de desenvolvimento.
3. Passar o código pro dono por um canal seguro (não em grupo). No painel, ele cria o login e a senha (10 caracteres ou mais) com esse código. Dali em diante o código não vale mais.
4. **Esqueceu a senha?** Gere outro código (passos 1 e 2): no painel, "Esqueci a senha" pede o código novo e a senha nova. Cada código vale uma vez; todas as sessões abertas caem.

### Backup dos dados

- **Pelo painel** (o jeito certo): "Baixar cópia do banco" (`admin-backup`) baixa um arquivo `.sqlite` com tudo, coerente. Sugestão: toda semana e antes de qualquer mudança grande. O arquivo tem nome e WhatsApp dos clientes: guardar em lugar seguro.
- **Pelo gerenciador de arquivos** da Hostinger: `public_html/greencheese/api/privado/` → baixar o `loja.sqlite` **junto com** o `loja.sqlite-wal`, se ele existir (as últimas mudanças ficam no `-wal` até o SQLite juntar; só o `loja.sqlite` pode sair desatualizado).
- **Restaurar** (numa hora sem movimento): primeiro apagar `loja.sqlite-wal` e `loja.sqlite-shm` de `api/privado/` (um diário velho por cima do banco novo estraga o banco), depois subir a cópia como `api/privado/loja.sqlite`.
- Publicar o site **nunca mexe nos dados**: o `publicar.mjs` não sobe nada de `api/privado/` além do `.htaccess` e do `index.html` vazio, nem nada de `uploads/` além do `.htaccess` (e nenhum `.sqlite`/`.log` de pasta nenhuma).

### Publicar com o servidor

Mesmo comando de sempre (`npm run build` + `node scripts/publicar.mjs`). A ordem agora: os `.htaccess` de todas as pastas primeiro (nada fica aberto nem por um instante), depois a API (módulos antes do `index.php`), `assets/`, o resto, `painel/` e os `index.html` por último. Ensaio sem rede: `PUBLICAR_SECO=1 node scripts/publicar.mjs` lista na ordem o que subiria e o que fica de fora (`PUBLICAR_DIST=<pasta>` ensaia outro build).

**Depois da primeira publicação com a API**: painel → Diagnóstico. Ele pede pela web o banco, o log, um módulo, o `instalacao.php`, o `.htaccess` e um `.php` de teste dentro de `uploads/`: tudo tem que dar fechado, e a lista de avisos vazia. Se algo aparecer aberto, o `.htaccess` daquela pasta não está valendo: não use o painel até resolver.

### Desenvolvimento

```bash
npm run api    # PHP em http://127.0.0.1:8090 (GC_API_PORTA troca), dados em greencheese/.dados-dev/
npm run dev    # em outro terminal: o Vite repassa /api e /uploads pro PHP (o preview também)
```

- Código de instalação de desenvolvimento: `dev-instalar-greencheese` (só vale com `GC_DADOS`, que o `npm run api` liga).
- Zerar tudo: apagar a pasta `.dados-dev/` (fica fora do Git e do build).
- Com o PHP desligado o site abre igual: o Vite responde 503 `sem-servidor` e o site segue sem servidor (o rateio fecha pelo WhatsApp).
- Variáveis: `GC_API_PORTA` (porta), `GC_DADOS` e `GC_UPLOADS` (pastas), `PHP` (outro binário do PHP).

### Testes do servidor

- `npm run testar-api`: sobe um `php -S` com dados temporários e confere o contrato inteiro (cerca de 690 pontos: instalar, entrar com limite e cookie, CSRF e Origin, rateios e a lista do tabaco, cada erro do rateio-entrar, **30 entradas ao mesmo tempo num rateio de 10 vagas → exatamente 10**, vencimento da reserva com relógio de teste, confirmar → contador → fecha sozinho, minhas vagas, CSV, envio de imagem, cópia do banco, apagar dados e o que tem que ficar fechado). Termina com `api ok`. `PHP=/caminho/do/php npm run testar-api` testa outra versão: passou no PHP 8.1 e no 8.3, com e sem GD/WebP.
- `npm run testar-htaccess -- <pasta-do-build>`: sobe um Apache local com `mod_php` (`apt install apache2 libapache2-mod-php`), sem `GC_DADOS` (como no ar), e confere os dois ramos dos `.htaccess` (`Require` e `Order/Deny`): site, API, tudo que é fechado, `.php`/`.phtml`/`.svg`/`.html` plantados em `uploads/` (nenhum roda), envio de imagem e o Diagnóstico pela web. Termina com `htaccess ok`.

### Onde fica cada coisa no código

`public/api/index.php` (a lista de rotas) e, em `public/api/nucleo/`: `base.php` (respostas, erros, Origin, relógio), `banco.php` (SQLite, migrações, transação — o único arquivo que muda pra ir pro MySQL), `validar.php` (WhatsApp, estado, dinheiro, datas, slug e a lista do tabaco), `limite.php` (tentativas), `sessao.php` (cookie, CSRF, código de instalação), `rateio.php` (as regras de vaga; `gc_confirmar_participacao` é a única porta pro contador subir), `publico.php` (rotas do site), `painel.php` (rotas do dono), `upload.php`, `diagnostico.php` e `exemplos.php` (os 2 rateios de exemplo). Mudança no banco: uma migração nova no fim de `gc_migracoes()`.

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

## Painel do dono

O painel é onde o dono cria os rateios, confirma os pagamentos e avisa a galera no WhatsApp: **`https://oprojeto.online/greencheese/painel/`**. Não tem link no site (nem aparece no Google: `noindex` no HTML e `X-Robots-Tag` no `.htaccess` da pasta). Feito pro celular (barra embaixo no molde do Instagram: Resumo, Rateios, **Criar** no meio, Atividade e Conta) e com lateral no computador.

### Entrar

- **Primeiro acesso**: o painel abre na tela "Primeiro acesso". Põe o código de instalação (ver "Primeiro acesso: o código de instalação" acima), teu nome, um login (letras minúsculas, números, ponto, traço) e a senha (10 caracteres ou mais) duas vezes → "Criar acesso". O painel já nasce com os 2 rateios de exemplo (Arizona e dichavador), que dá pra apagar.
- **Depois**: login e senha. A sessão dura 30 dias e renova sozinha a cada uso. "Sair do painel" (em Conta) sai só daquele aparelho; trocar a senha tira todos os outros.
- **Esqueceu a senha**: "Esqueci a senha" pede um código de instalação **novo** (gerado de novo pelo `php scripts/codigo-instalacao.php` e publicado) e a senha nova.
- **No celular, como app**: no Chrome, menu ⋮ → "Adicionar à tela inicial"; no iPhone, Safari → Compartilhar → "Adicionar à Tela de Início". O painel tem manifesto próprio (`painel/manifest.webmanifest`, ícone da loja, "Painel GC").
- Se a sessão cair no meio do trabalho (senha trocada em outro aparelho, 30 dias sem usar), o login abre **por cima** da tela: o que estava digitado fica, e o que estava sendo salvo termina sozinho depois de entrar.

### Criar um rateio

Barra de baixo → **+** (ou "Criar rateio"):

1. **Produto**: busca no catálogo (Arizona, dichavador…): o nome vem preenchido, o site usa a arte do produto e o preço da loja entra como "quando chegar". Se não tá no catálogo, "nome livre".
2. **Foto** (opcional): "Enviar foto" abre a câmera ou a galeria do celular. A foto grande é reduzida no próprio celular antes de subir (sobe rápido no 4G) e o servidor ajusta de novo (WebP, 1600 px). Com foto, ela aparece no lugar da arte.
3. **Preço** no rateio e **quando chegar** (opcional): o painel mostra a economia ("Economia de R$ 5,00 por vaga") e o site também.
4. **Vagas** (1 vaga = 1 unidade) e **por pessoa** (o máximo que um WhatsApp pega).
5. **Onde vale**: RJ, MG, SP, ES, SC (quem é de outro estado vê o rateio apagado no site).
6. **Prazos**: previsão de chegada (padrão: de 6 a 10 dias depois de fechar), prazo pra entrar (opcional: sem prazo, fecha quando lotar) e quanto tempo a reserva segura a vaga (padrão 24 h).
7. **Descrição** (opcional) e a **prévia do cartão** como o cliente vê no site (no computador, fixa do lado).
8. **Salvar rascunho** (só o dono vê) ou **Publicar no site**. Depois de publicar, o rateio mostra o link pra compartilhar (`…/greencheese/?rateio=<id>`): "Copiar link", "Compartilhar" (celular) e "Ver no site".

Derivado do tabaco e cigarro eletrônico não entra (Anvisa): o nome ou a descrição com um termo da lista (Backwoods, charuto, vape, pod…) mostra o aviso na hora e não publica; o servidor recusa de novo. O que está sendo digitado fica guardado no aparelho até salvar ("Continuando de onde tu parou").

### No dia a dia

- **Resumo**: primeiro o que pede ação (reservas esperando pagamento, a que vence antes primeiro, com "Confirmar pagamento" e "Cobrar" no WhatsApp; rateio que lotou, chegou ou teve o prazo vencido), depois o dinheiro (pago e a receber), os rateios abertos com a barra e as últimas entradas. Atualiza sozinho a cada 30 s e quando o painel volta pra frente.
- **Confirmar pagamento** (quando o Pix cair na conta): no rateio, "Confirmar pagamento" na pessoa → confirma → o contador sobe ("8/10") e aparece **"Avisar no WhatsApp"** com a mensagem pronta pra ela ("Pagamento confirmado ✅, código RAT-…"). Quando as vagas pagas lotam, o rateio **fecha sozinho** e o painel avisa.
- **Mensagens prontas**: cada pessoa tem o botão do WhatsApp com a mensagem do momento (cobrar a reserva com o prazo, confirmado, venceu, fechou, pedido feito com a previsão em datas, a caminho, chegou, cancelado). Abre o WhatsApp da loja com o texto escrito; é só mandar.
- **Passos do rateio**: a linha do status (no celular, de cima pra baixo, como rastreio de entrega) mostra o próximo passo como botão, sempre com confirmação: Fechar agora → Pedido feito → A caminho → Chegou → Encerrar (e "Reabrir" depois de fechar). Passo fora de hora fica cinza em vez de branco: "Fechar agora" com vaga sobrando e no prazo, "Encerrar" com gente sem receber (o placar mostra "Entregue 2/6"). Ao avançar, abre o **"Avisar todos"**: um link do WhatsApp por pessoa, cada um com a mensagem e o nome dela; quem já foi avisado fica marcado (neste aparelho). Dá pra voltar nele depois pelo botão "Avisar todos no WhatsApp".
- **Participantes**: busca (nome, WhatsApp ou código), filtro por status e, em "⋯", editar, cancelar, desfazer o pagamento, reservar de novo, marcar entregue e apagar os dados (pedido de exclusão da LGPD; a vaga continua nas contas). **Incluir** põe quem entrou pela DM: nome, WhatsApp, estado, vagas e se já pagou. **CSV** baixa a planilha (abre direto no Excel).
- **Atividade**: tudo que aconteceu (entradas pelo site, pagamentos, reservas vencidas, passos), do mais novo pro mais velho.
- **Servidor** (lateral no computador; no celular, em Conta → "Mais do painel"): o diagnóstico em português (o que tem que ficar fechado pela web, PHP, fotos, HTTPS) e **"Baixar cópia do banco"**.

### Desenvolvimento e testes

- `npm run api` e `npm run dev` (ver "Desenvolvimento" acima) → `http://localhost:5173/painel/` (código de instalação de desenvolvimento: `dev-instalar-greencheese`).
- `npm run testar-painel -- <pasta-do-build>`: sobe a API com dados temporários e o `vite preview` do build e roda o fluxo inteiro no Chromium (instalar → criar com foto → publicar → o site enxerga → clientes entram pela API → confirmar → lota e fecha sozinho → avisar todos → pedido feito → a caminho → chegou → entregue → CSV → incluir → trocar senha → sair), mais a robustez (rascunho, tabaco, sem rede, sessão que cai no meio, toque duplo, voltar do Android, teclado, deitado e 320 px) e o HTML do painel. Quando o build do site já tem a aba Rateio, abre também `/?rateio=<id>` no site e confere que o rateio criado no painel aparece lá. Termina com `painel ok`. `GC_PRINTS=<pasta>` guarda prints; `GC_AXE=<axe.min.js>` roda o axe em cada tela; `GC_TESTE_PORTA` (PHP) e `GC_TESTE_PORTA_SITE` (preview) fixam as portas.
- O `npm run testar-htaccess` também abre `/greencheese/painel/` no Apache e confere `noindex`, HTML sem cache e que todo arquivo do painel carrega por caminho relativo.

### Onde fica cada coisa no código

- `painel/index.html` (a página) e `public/painel/` (manifesto e `.htaccess`). O `npm run build` gera o site e, logo depois, o painel num build à parte na mesma pasta (plugin `painelAParte` do `vite.config.ts`): num build só, o Vite repartiria o React entre as duas páginas e o site ganharia pedaços e pedidos novos. Assim o site sai **byte a byte igual** ao de antes do painel e o painel leva o dele (`assets/painel-*.js`, com o CSS dentro, em `src/painel/estilo.ts`). No `npm run dev`, o `/painel/` abre direto. Variável nova no `define` do site (ex.: `__ARQUIVO_UNICO__`) entra na constante `definir`, que vale pros dois.
- `src/painel/`: `api.ts` (conversa com o servidor: csrf, sessão que cai, rede), `rotas.ts` (telas por `#/…`, histórico), `secoes.ts` (**a lista de seções**: seção nova entra aqui, com a tela dela em `Painel.tsx`), `mensagens.ts` (os textos do WhatsApp), `proibidos.ts` (a lista do tabaco, igual à do servidor), `painel.css` e `telas/`.

---

## Abas e Início

O site é um app só, com três abas no molde do Instagram. O **Início** é o perfil da loja de cima a baixo e acaba na grade do catálogo:

| Aba | Endereço | O que tem |
|---|---|---|
| Início | `…/greencheese/?uf=mg` | story dos produtos (com "Enviar mensagem…" no pé, no celular), faixa dos perfis, perfil com "Ver loja", destaques e a grade do catálogo (a caixa "Não achou? A Green Cheese importa." é a última célula), rodapé |
| Catálogo | `…/greencheese/?uf=mg&aba=catalogo` | destaques, busca, Só DISPONÍVEL, grade, encomenda e, no fim, o interativo (Teste minha sorte) e os reposts com o mercador |
| Por estado | `…/greencheese/?uf=mg&aba=estados` | os perfis de cada estado |

**O Início:**

- **Celular:** story → faixa dos @ → perfil ("Enviar mensagem", "Ver no Instagram", "Ver loja") → destaques → grade → rodapé. Sem busca e sem "Só DISPONÍVEL" (a busca é a lupa da barra) e sem o Teste minha sorte e o repost do fim da aba Catálogo. Nenhum mercador no Início do celular.
- **Destaques do Início** (uma linha só, rola de lado): primeiro os que levam a outro lugar — o destaque do estado (moto, abre o story de atendimento), **Buscar** (abre o Catálogo com o cursor na busca), **Sorte** (abre o Teste minha sorte, com o anel aceso e o selo "novo") e **Por estado** (o pino com o selo da UF) —, um fio fino e, à direita, os filtros (Tudo, Importadas, Destilados, Sedas, Piteiras, Acessórios), que filtram a grade do próprio Início. No celular a linha é mais compacta (bolinhas de 56 px até 400 px de largura, 60 px até 479), para o "Tudo" aparecer inteiro na primeira tela com o filtro seguinte espiando na borda — o sinal de que a linha rola (em 360 px, 15 px do "Importadas"; em 390, 45). No computador, quando a linha não cabe (de 900 a ~1170 px), aparecem setas nas pontas, como na bandeja de destaques do instagram.com, e Shift + roda anda a linha de lado. Na aba Catálogo os destaques continuam como eram.
- **"Ver loja"** do perfil desce até os destaques (suave; corte seco com movimento reduzido) e leva o foco junto.
- **Computador:** a linha de cima é [mercador | perfil | story], depois a faixa, os mesmos destaques e a mesma grade (na moldura da aba Catálogo) e o rodapé. O mercador fica de pé ao lado do perfil, com os pés na linha do "Ver loja" e uma sombra de chão em pixel: sem moldura, sem texto e sem link (decorativo). Abre o casaco (e dá uns tragos, com `mercadorTraga`) só na tela, com a aba do navegador à vista e sem camada por cima; o mouse em cima abre o casaco na hora. A escala é inteira (3× até 1439 px de largura, 4× de 1440, 5× de 1800) e sai da sobra da coluna do perfil (o perfil fica com 285 px ou mais, compacto abaixo de 380): o story nunca encolhe por causa dele.
- **Mercador por largura** (sempre à vista no computador, nunca some): de 900 a 1199 px o hero empilha — story em cima, centrado com as setas, e mercador + perfil logo abaixo. De 1200 em diante fica [mercador | perfil | story] sempre que o 3× cabe ao lado do perfil (1200×720, 1240×800, 1280×650/800/1024, 1300×1000, 1366 e acima); onde não cabe — janela alta de 1200 a ~1270 px, como 1200×900 e 1260×900 — o hero empilha igual ao de 900 a 1199 em vez de tirar o mercador. Quem decide é uma régua invisível no hero (`.hero-regua`, com as mesmas variáveis do arranjo lado a lado), então a escolha não oscila. O código: `src/componentes/MercadorLoja.tsx` e `useLojaDesktop` em `Hero.tsx`.

**Abas:**

- **Celular:** barra fixa embaixo com Início, Catálogo (lupa), Teste minha sorte (o dichavador, no meio), Sacola (com o número de itens) e Por estado (o avatar da loja com o selo da UF). Tocar de novo na aba aberta sobe ao topo; a lupa tocada de novo no Catálogo vai até a busca. Num estado sem entrega a barra fica com 4 abas (sem o Teste minha sorte). Com o teclado aberto (busca, chat) a barra sai, como no Instagram — também no Android, onde a janela inteira encolhe com o teclado.
- **Celular deitado:** o story do Início cabe inteiro acima da barra (arte à esquerda; nome, preço e DISPONÍVEL à direita; VER PRODUTO e "Enviar mensagem…" numa linha só no pé). Celular grande deitado (900 px ou mais) pega o layout de computador; a lateral rola quando não cabe.
- **Computador:** a barra lateral troca as abas (Início, Buscar, Catálogo, Por estado), com a aba atual em negrito e o ícone cheio ("Buscar" fica ativo com a busca em uso; tocar em "Catálogo" volta o destaque para ele). Ctrl+clique ou o botão do meio abre a aba numa aba nova do navegador. Em janela baixa (notebook com a barra do navegador, enquete de local aberta) a lateral rola sozinha, sem levar a página.
- **Voltar:** cada troca de aba entra no histórico. O voltar do Android (e do navegador) fecha primeiro a camada aberta (story, página do produto, sacola, chat, jogo) e depois volta para a aba de antes, com a rolagem de antes. Um link direto (`?aba=catalogo`) não inventa um Início embaixo: voltar sai do site. Trocar de estado na aba Por estado leva ao Início, como trocar de conta no Instagram; se a troca foi feita com o chat aberto (ex.: "Trocar estado" dentro do pedido), o chat continua e o Início entra quando ele fechar.
- **Rapidez:** as abas escondidas usam `content-visibility: hidden` (o navegador guarda o layout e mostrar de novo não recalcula nada; sem `inert`, que recalcularia a vista inteira a cada troca; o papel de região "Início" só fica na vista à vista, para o leitor de tela não anunciar uma região vazia nas outras abas) e cada card fora da tela usa `content-visibility: auto`. A grade do Início e o Catálogo montam no tempo ocioso depois da abertura, um de cada vez, numa transição do React (o toque passa na frente); trocar de aba não re-renderiza o catálogo nem o hero, e sem camada aberta a troca sai no mesmo quadro do toque. O filtro anima a grade só com transform (Flip no modo simples).
- Os links de sempre continuam valendo por cima de qualquer aba: `?p=`, `?produto=`, `?jogo=sorte`, `?chat=pedido`. Ex.: `?uf=mg&aba=catalogo&produto=jack-daniels-old-no7-1l` abre a página do produto e o voltar cai no Catálogo.
- O código das abas está em `src/lib/abas.ts` (URL, histórico e o "Ver loja") e `src/componentes/Abas.tsx` (as vistas); a loja do Início é o mesmo `Catalogo.tsx` com `onde="inicio"` (ids próprios: `inicio-loja`; o `#catalogo` é da aba Catálogo, que o chat e a rolagem usam).

**Links velhos da Home 2** (a versão em teste com o Teste minha sorte e o mercador no Início, que saiu): `https://oprojeto.online/greencheese/home2/` (e `Home2/`, `HOME2/`, que o `scripts/publicar.mjs` sobe junto) leva para a home de sempre mantendo o resto do link (`home2/?uf=rj` abre no RJ); `?home=2`, `?home2`, `?Home2`, `?home=1` num link já enviado saem da URL sozinhos e nada muda.

> Num estado sem entrega (ex.: `?uf=ba`) o Início vira a tela "A Green Cheese ainda não chegou aí", sem destaques nem grade.

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
  descricao: 'Uma OCB por conta da sorte.', // 1 linha de apoio no cartão (até ~28 letras; sem repetir o prêmio nem prometer "hoje")
  regra: 'Leva 4 Seda OCB Premium Slim e paga 3', // frase completa: vai na linha do WhatsApp e no "Ver condições"
  aplicaA: { produtos: ['seda-ocb-premium-slim'] }, // ids do catalogo.json (ou { categorias: ['sedas'] })
  comoUsar: 'Põe 4 na sacola e usa o cupom.',       // opcional: vai no "Ver condições"
  peso: 30,                                // chance relativa (não precisa somar 100; nunca aparece na tela)
  validadeDias: 7,                         // conta a partir de quando a pessoa guarda (1 a 30)
  papel: 'branco',                         // cor do beck e do cartão: 'branco' (OCB) ou 'natural' (RAW, padrão)
  demo: true,                              // exemplo: fica enquanto dadosDeExemplo (src/dados/config.ts)
}
```

- **Todo giro ganha**: o peso decide qual sai, e só entre os prêmios que valem no estado de quem gira (produto disponível lá).
- **O cartão do prêmio monta o destaque sozinho** a partir do `tipo`, do `valor` e do produto: a ilustração (ou foto) do produto grande, com raios de pixel atrás, e embaixo "15% OFF" + o nome do produto, "LEVA 4 PAGA 3" + o produto, ou "BRINDE" + o produto do brinde. Depois vêm a `descricao` (1 linha), o código (coberto até a pessoa guardar) e o texto clicável **Ver condições**, que abre a `regra`, o `comoUsar`, a validade, a reserva de quem ainda não tem conta e as regras de sempre (1 pedido, não soma com outro cupom, só com o produto no estado, a loja confirma no WhatsApp). Guardado, o carimbo GUARDADO bate no lugar do "DEU SORTE!". O ingresso da Minha conta segue o mesmo molde. Na revelação tem uma comemoração curta em pixel (confete saindo de trás da metade de cima do cartão, sem passar por texto nem pelos botões, e brilhos no destaque; com movimento reduzido, corte seco).
- **O prêmio tem um nome só** em todo lugar (cartão, faixa do cadastro, Minha conta, sacola, pedido, adesivo do site, "O que pode sair"): o destaque + o produto, ex. "LEVA 4 PAGA 3 · Seda OCB Premium Slim", "BRINDE · Piteira de papel RAW". O `titulo` do prêmio fica só para a validação e para os dados guardados; quem aparece é esse par (`nomeDoPremio` em `src/lib/cupom.ts`).
- O 2 e o 5 do destaque vêm de uma fonte mínima (`src/interativos/sorte/digitos.css`, gerada por `node scripts/gerar-digitos.mjs`): na Pixelify o 5 parece S e o 2 parece Z, e "15% OFF" lia "1S% OFF".
- **A validação recusa** (em dev o site para com o erro na tela; no ar, o prêmio é descartado com aviso no console): id repetido; produto ou categoria que não existe no `catalogo.json`; prêmio ou brinde em **bebidas ou destilados**; peso ≤ 0; validade fora de 1–30; percentual fora de 1–50; leve ≤ pague; e qualquer palavra da lista `PALAVRAS_PROIBIDAS` (folha, erva, fumaça, grátis, frete, prazo, sorteio, cigarro, tabaco…) no título, descrição, regra ou "como usar".
- Promoção de verdade: `demo: false`. Com `dadosDeExemplo: false`, os de exemplo saem; sem nenhum prêmio válido, o "Teste minha sorte" some do site inteiro (destaque, lateral, adesivo, sacola) e o link `?jogo=sorte` é ignorado. Também some em estado que a loja não atende (o cupom não serviria lá).
- A validade que aparece nas Regras sai de `validadeDias` ("vale 7 dias" quando todos os prêmios têm a mesma; senão, "até a data escrita no cupom").
- Limites (`regrasSorte`): 1 giro sem conta (para sempre, no aparelho), 1 giro por dia com conta (vira à meia-noite de Brasília), prêmio sem conta reservado por 24 h. Na prévia, tudo fica só no aparelho; na versão oficial, o servidor valida (ver PENDENCIAS.md).
- A copy do jogo fica em `src/interativos/sorte/textos.ts`; a das entradas do site (destaque, lateral, adesivo, sacola), em `src/interativos/sorte/textos-entrada.ts`.
- Link direto: `https://oprojeto.online/greencheese/?uf=mg&jogo=sorte` abre o jogo depois do +18.
- O próximo interativo entra com uma linha em `src/interativos/registro.ts`, o jogo em `src/interativos/<id>/` e a tabela de prêmios dele em `src/dados/`.
- Conferir a mensagem do pedido (sem cupom, igual ao formato de sempre; com cupom, +1 linha): `node scripts/conferir-mensagem.mjs`.

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
- **Teste minha sorte** (aba do meio da barra no celular, destaque "Sorte" no Início e no Catálogo, item na lateral, card no fim do Catálogo, convite discreto na sacola): gira a tampa do dichavador com o dedo (ou o botão "Girar", as setas, Espaço/Enter segurado, a roda do mouse); ele abre, sai um beck bolado e o beck desenrola no cupom. O 1º giro é sem conta; pra guardar e usar o cupom, cria conta com nome e WhatsApp. Com conta: 1 giro por dia, cupons em "Minha conta" e o nome já no pedido. O cupom aplicado vira uma linha na mensagem do WhatsApp; a loja confirma o desconto (o subtotal do site não muda).

Derivados do tabaco não entram no site (Anvisa, RDC 840/2023, art. 6º).

# Green Cheese Imports — site, servidor e painel do dono

Site único da Green Cheese para todos os estados: catálogo no formato dos stories da marca + pedido guiado que termina com a mensagem pronta no WhatsApp da loja, (33) 99113-9036 (o Pix direto no site aparece como "Em breve"). Dúvida fora do pedido vai pro Instagram do estado. O site é estático; o rateio e o painel do dono (`/painel/`) usam o servidor da loja (PHP + SQLite na mesma hospedagem, em `api/`). Sem o servidor, o site abre igual e o rateio cai no WhatsApp.

Feito pela I&H Soluções Digitais.

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

Sem as chaves da API da Hostinger, dá pra publicar pelo gerenciador de arquivos. O pacote sai do build, com as mesmas regras do `publicar.mjs`:

```bash
npm run build
npm run empacotar      # → entrega/greencheese-dist.zip (outro lugar: npm run empacotar -- caminho/do/pacote.zip)
```

O `empacotar` recusa o código de instalação de desenvolvimento (gere o de verdade antes: "Primeiro acesso: o código de instalação", lá embaixo) e deixa de fora banco, log e fotos enviadas: o Vite copia `public/` inteiro pro build, e um `loja.sqlite` ou uma foto esquecidos ali, extraídos no ar, sobrescreveriam os de verdade. **Não zipe a pasta `dist/` à mão**, nem use um zip velho: o `entrega/greencheese-dist.zip` que está no repositório é de antes do servidor (só o site).

1. Painel → Servidor → **Baixar cópia do banco** (sempre, antes de publicar).
2. **hPanel** → **Sites** → `oprojeto.online` → **Gerenciador de Arquivos** → `public_html/greencheese/` (crie se não existir).
3. **Enviar** → `greencheese-dist.zip` → botão direito → **Extrair** ali mesmo, por cima do que já tem (substituir). O `index.html` e o `.htaccess` têm de ficar direto em `greencheese/`.
4. **Nunca apague** `greencheese/`, `greencheese/api/privado/` nem `greencheese/uploads/` antes de extrair: o banco, o log e as fotos dos rateios moram lá, e o zip não traz nenhum deles (de propósito).
5. Apague o zip do servidor e abra o endereço no celular. Os atalhos `Home2/` e `HOME2/` só o `publicar.mjs` sobe (pastas que só mudam a caixa colidem no Windows e no macOS); no zip vai só `home2/`.

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

- O banco nasce sozinho no primeiro acesso e se atualiza sozinho: migrações por número, cada uma anotada na tabela `migracoes` (API.md, “Banco: migrações por número”).
- Precisa de **PHP 8.1 ou mais novo** (hPanel → Avançado → Configuração do PHP; 8.3 é o melhor) com `pdo_sqlite`, que a Hostinger já tem. Com GD + WebP, as fotos do painel são ajustadas (lado maior até 1600 px, viram WebP); sem isso, sobem do jeito que vieram.
- Cada pasta interna tem o próprio `.htaccess` (com as duas sintaxes: `Require` e `Order/Deny`) e cada módulo PHP começa com uma guarda: mesmo se o `.htaccess` falhar, abrir um módulo direto não faz nada.
- **Sem `RewriteEngine` nas nossas pastas**, de propósito: ligar a reescrita aqui anularia as regras da raiz do domínio (HTTPS etc.). Por isso a rota é um parâmetro.
- Erro nunca aparece com detalhe pro cliente: o detalhe vai pro `api/privado/erros.log`.

### Primeiro acesso: o código de instalação

1. `php scripts/codigo-instalacao.php` → mostra o código **uma vez** (4 grupos de 5, sem letra que confunde, ex.: `k7m2p-x9q4r-h3d8w-5tnby`) e grava só o hash em `public/api/instalacao.php`.
2. `npm run build` e publicar. O `publicar.mjs` (e o `empacotar.mjs`) **recusa** enquanto o `instalacao.php` for o de desenvolvimento, e o servidor no ar também não aceita o código de desenvolvimento. Os dois conferem o próprio hash, não só a marca `// DEV` do arquivo: apagar o comentário não adianta.
3. Passar o código pro dono por um canal seguro (não em grupo). No painel, ele cria o login e a senha (10 caracteres ou mais) com esse código. Dali em diante o código não vale mais.
4. **Esqueceu a senha?** Gere outro código (passos 1 e 2): no painel, "Esqueci a senha" pede o código novo e a senha nova. Cada código vale uma vez; todas as sessões abertas caem.

### Backup dos dados

- **Pelo painel** (o jeito certo): "Baixar cópia do banco" (`admin-backup`) baixa um arquivo `.sqlite` com tudo, coerente. Sugestão: toda semana e antes de qualquer mudança grande. O arquivo tem nome e WhatsApp dos clientes: guardar em lugar seguro. Não leva as senhas dos Avisos no WhatsApp (token e Client-Token do Z-API, apikey da Evolution, segredo e endereço do webhook): quem voltar a cópia põe elas de novo em Avisos no WhatsApp.
- **Pelo gerenciador de arquivos** da Hostinger: `public_html/greencheese/api/privado/` → baixar o `loja.sqlite` **junto com** o `loja.sqlite-wal`, se ele existir (as últimas mudanças ficam no `-wal` até o SQLite juntar; só o `loja.sqlite` pode sair desatualizado).
- **Restaurar** (numa hora sem movimento): primeiro apagar `loja.sqlite-wal` e `loja.sqlite-shm` de `api/privado/` (um diário velho por cima do banco novo estraga o banco), depois subir a cópia como `api/privado/loja.sqlite`.
- Publicar o site **nunca mexe nos dados**: o `publicar.mjs` não sobe nada de `api/privado/` além do `.htaccess` e do `index.html` vazio, nem nada de `uploads/` além do `.htaccess` (e nenhum `.sqlite`/`.log` de pasta nenhuma).

### Publicar com o servidor

Mesmo comando de sempre (`npm run build` + `node scripts/publicar.mjs`). A ordem agora: os `.htaccess` de todas as pastas primeiro (nada fica aberto nem por um instante), depois a API (módulos antes do `index.php`), `assets/`, o resto, `painel/` e os `index.html` por último. Ensaio sem rede: `PUBLICAR_SECO=1 node scripts/publicar.mjs` lista na ordem o que subiria e o que fica de fora (`PUBLICAR_DIST=<pasta>` ensaia outro build).

**Depois da primeira publicação com a API**: painel → Diagnóstico. Ele pede pela web o banco, o log, um módulo, o `instalacao.php`, o `.htaccess` e um `.php` de teste dentro de `uploads/`: tudo tem que dar fechado, e a lista de avisos vazia. Se algo aparecer aberto, o `.htaccess` daquela pasta não está valendo: não use o painel até resolver.

**IP do cliente**: o site está atrás da CDN da Hostinger. O mesmo Diagnóstico diz que IP conta nos limites de tentativa ("O servidor vê o IP de quem acessa" ou "…da CDN") e quais cabeçalhos de encaminhamento chegaram. Se ele vir o IP da CDN, os limites viram de todo mundo junto: o passo a passo pra pôr a faixa da CDN em `GC_PROXIES` (`public/api/nucleo/base.php`) está no PENDENCIAS.md, “IP do cliente”. O servidor só lê o `X-Forwarded-For` quando o pedido vem de uma faixa dessa lista (vazia, vale só o `REMOTE_ADDR`), e lê da direita pra esquerda: o que o aparelho inventa à esquerda nunca conta.

### Desenvolvimento

```bash
npm run api    # PHP em http://127.0.0.1:8090 (GC_API_PORTA troca), dados em greencheese/.dados-dev/
npm run dev    # em outro terminal: o Vite repassa /api e /uploads pro PHP (o preview também)
```

- Código de instalação de desenvolvimento: `dev-instalar-greencheese` (só vale com `GC_DADOS`, que o `npm run api` liga).
- Zerar tudo: apagar a pasta `.dados-dev/` (fica fora do Git e do build).
- Com o PHP desligado o site abre igual: o Vite responde 503 `sem-servidor` e o site segue sem servidor (o rateio fecha pelo WhatsApp).
- Variáveis: `GC_API_PORTA` (porta), `GC_DADOS` e `GC_UPLOADS` (pastas), `PHP` (outro binário do PHP), `GC_PROXIES` (faixas de proxy de confiança, separadas por vírgula: somam às de `GC_PROXIES` em `base.php`).

### Testes do servidor

- `npm run testar-api`: sobe um `php -S` com dados temporários e confere o contrato inteiro (cerca de 2.000 pontos; os da loja ficam em `scripts/testar-api-loja.mjs`: instalar, entrar com limite e cookie, CSRF e Origin, rateios e a lista do tabaco, cada erro do rateio-entrar, o token do aparelho (a mesma entrada de novo devolve a mesma vaga, até 10 envios juntos), **30 entradas ao mesmo tempo num rateio de 10 vagas → exatamente 10**, vencimento da reserva com relógio de teste, confirmar → contador → fecha sozinho, minhas vagas, CSV, envio de imagem, cópia do banco, apagar dados, o IP atrás de CDN com e sem `GC_PROXIES`, o código de dev recusado com e sem a marca, o zip do `empacotar`, o que tem que ficar fechado e a loja inteira: a semente em dia, o `GET loja` com ETag/304, cada rota `admin-*` da loja, a migração num banco de antes e o "apagar dados de exemplo"). Termina com `api ok`. `PHP=/caminho/do/php npm run testar-api` testa outra versão: passou no PHP 8.1 e no 8.3, com e sem GD/WebP.
- `npm run testar-htaccess -- <pasta-do-build>`: sobe um Apache local com `mod_php` (`apt install apache2 libapache2-mod-php`), sem `GC_DADOS` (como no ar), e confere os dois ramos dos `.htaccess` (`Require` e `Order/Deny`): site, API, tudo que é fechado, `.php`/`.phtml`/`.svg`/`.html` plantados em `uploads/` (nenhum roda), envio de imagem e o Diagnóstico pela web. Termina com `htaccess ok`.

### Onde fica cada coisa no código

`public/api/index.php` (a lista de rotas) e, em `public/api/nucleo/`: `base.php` (respostas, erros, Origin, relógio), `banco.php` (SQLite, migrações, transação — o único arquivo que muda pra ir pro MySQL), `validar.php` (WhatsApp, estado, dinheiro, datas, slug e a lista do tabaco), `limite.php` (tentativas), `sessao.php` (cookie, CSRF, código de instalação), `rateio.php` (as regras de vaga; `gc_confirmar_participacao` é a única porta pro contador subir), `publico.php` (rotas do site), `painel.php` (rotas do dono), `upload.php`, `diagnostico.php`, `exemplos.php` (os 2 rateios de exemplo) e os da loja (`loja-migracoes.php`, `loja.php`, `loja-validar.php`, `loja-painel.php` e a semente `semente-loja.json`; ver “Loja no painel”), os dos pedidos (`pedido-migracoes.php`, `pedido.php`, `avisos.php`, `textos.php`) e os das contas (`contas-migracoes.php`, `equipe.php`, `clientes.php`, `sorte.php`, `premios-semente.php`). Mudança no banco: uma migração nova com o próximo número livre da faixa de quem mexe (1–99 a base, em `banco.php`; 100–199 a loja, em `loja-migracoes.php`; 200–299 pedidos e contas), nunca editando uma que já foi pro ar.

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

---

## Painel do dono

O painel é onde o dono cria os rateios, confirma os pagamentos e avisa a galera no WhatsApp: **`https://oprojeto.online/greencheese/painel/`**. Não tem link no site (nem aparece no Google: `noindex` no HTML e `X-Robots-Tag` no `.htaccess` da pasta). Feito pro celular (barra embaixo no molde do Instagram: Resumo, Rateios, **Criar** no meio, Atividade e Conta) e com lateral no computador.

### Entrar

- **Primeiro acesso**: o painel abre na tela "Primeiro acesso". Põe o código de instalação (ver "Primeiro acesso: o código de instalação" acima), teu nome, um login (letras minúsculas, números, ponto, traço) e a senha (10 caracteres ou mais) duas vezes → "Criar acesso". O painel já nasce com os 2 rateios de exemplo (Arizona e dichavador), que dá pra apagar.
- **Depois**: login e senha. A sessão dura 30 dias e renova sozinha a cada uso. "Sair do painel" (em Conta) sai só daquele aparelho; trocar a senha tira todos os outros.
- **Equipe**: cada pessoa entra com o login dela (gerente e atendente, só dos estados deles); quem cria é o dono, em Equipe. Ver "Contas: equipe e clientes".
- **Esqueceu a senha**: "Esqueci a senha" pede um código de instalação **novo** (gerado de novo pelo `php scripts/codigo-instalacao.php` e publicado) e a senha nova.
- **No celular, como app**: no Chrome, menu ⋮ → "Adicionar à tela inicial"; no iPhone, Safari → Compartilhar → "Adicionar à Tela de Início". O painel tem manifesto próprio (`painel/manifest.webmanifest`, ícone da loja, "Painel GC").
- Se a sessão cair no meio do trabalho (senha trocada em outro aparelho, 30 dias sem usar), o login abre **por cima** da tela: o que estava digitado fica, e o que estava sendo salvo termina sozinho depois de entrar.

### Criar um rateio

Barra de baixo → **+** (ou "Criar rateio"):

1. **Produto**: busca nos produtos da loja (Loja → Produtos, os que estão no site, até os criados no painel; Arizona, dichavador…): o nome vem preenchido, o site usa a foto ou a arte do produto e o preço da loja entra como "quando chegar". Se não tá no catálogo, "nome livre".
2. **Foto** (opcional): "Enviar foto" abre a câmera ou a galeria do celular. A foto grande é reduzida no próprio celular antes de subir (sobe rápido no 4G) e o servidor ajusta de novo (WebP, 1600 px). Com foto, ela aparece no lugar da arte.
3. **Preço** no rateio e **quando chegar** (opcional): o painel mostra a economia ("Economia de R$ 5,00 por vaga") e o site também.
4. **Vagas** (1 vaga = 1 unidade) e **por pessoa** (o máximo que um WhatsApp pega).
5. **Onde vale**: os estados do site (Loja → Estados; o estado ativado no painel entra aqui), todos marcados no começo (quem é de outro estado vê o rateio apagado no site).
6. **Prazos**: previsão de chegada (padrão: de 6 a 10 dias depois de fechar), prazo pra entrar (opcional: sem prazo, fecha quando lotar) e quanto tempo a reserva segura a vaga (padrão 24 h).
7. **Descrição** (opcional) e a **prévia do cartão** como o cliente vê no site (no computador, fixa do lado).
8. **Salvar rascunho** (só o dono vê) ou **Publicar no site**. Depois de publicar, o rateio mostra o link pra compartilhar (`…/greencheese/?rateio=<id>`): "Copiar link", "Compartilhar" (celular) e "Ver no site".

Derivado do tabaco e cigarro eletrônico não entra (Anvisa): o nome ou a descrição com um termo da lista (Backwoods, charuto, vape, pod…) mostra o aviso na hora e não publica; o servidor recusa de novo. O que está sendo digitado fica guardado no aparelho até salvar ("Continuando de onde tu parou").

### No dia a dia

- **Resumo**: primeiro o que pede ação (reservas esperando pagamento, a que vence antes primeiro, com "Confirmar pagamento" e "Cobrar" no WhatsApp; rateio que lotou, chegou ou teve o prazo vencido), depois o dinheiro (pago e a receber), os rateios abertos com a barra e as últimas entradas. Atualiza sozinho a cada 30 s e quando o painel volta pra frente.
- **Confirmar pagamento** (quando o Pix cair na conta): no rateio, "Confirmar pagamento" na pessoa → confirma → o contador sobe ("8/10") e aparece **"Avisar no WhatsApp"** com a mensagem pronta pra ela ("Pagamento confirmado ✅, código RAT-…"). Quando as vagas pagas lotam, o rateio **fecha sozinho** e o painel avisa.
- **Mensagens prontas**: cada pessoa tem o botão do WhatsApp com a mensagem do momento (cobrar a reserva com o prazo, confirmado, venceu, fechou, pedido feito com a previsão em datas, a caminho, chegou, cancelado). Abre o WhatsApp da loja com o texto escrito; é só mandar.
- **Passos do rateio**: a linha do status (no celular, de cima pra baixo, como rastreio de entrega) mostra o próximo passo como botão, sempre com confirmação: Fechar agora → Pedido feito → A caminho → Chegou → Encerrar (e "Reabrir" depois de fechar). Passo fora de hora fica cinza em vez de branco: "Fechar agora" com vaga sobrando e no prazo, "Encerrar" com gente sem receber (o placar mostra "Entregue 2/6"). Ao avançar, abre o **"Avisar todos"**: um link do WhatsApp por pessoa, cada um com a mensagem e o nome dela; quem já foi avisado fica marcado (neste aparelho). Dá pra voltar nele depois pelo botão "Avisar todos no WhatsApp".
- **Participantes**: busca (nome, WhatsApp ou código), filtro por status e, em "⋯", editar, cancelar, desfazer o pagamento, reservar de novo, marcar entregue e apagar os dados (pedido de exclusão da LGPD; a vaga continua nas contas). **Incluir** põe quem entrou pela DM: nome, WhatsApp, estado, vagas e se já pagou. **CSV** baixa a planilha (abre direto no Excel; com a sessão vencida, o login abre por cima e a planilha baixa depois de entrar). Vaga de quem teve os dados apagados não volta (nem paga, nem reservada).
- **Atividade**: tudo que aconteceu (entradas pelo site, pagamentos, reservas vencidas, passos), do mais novo pro mais velho.
- **Servidor** (lateral no computador; no celular, em Conta → "Mais do painel"): o diagnóstico em português (o que tem que ficar fechado pela web, PHP, fotos, HTTPS, o IP que conta nos limites de tentativa) e **"Baixar cópia do banco"**.

### Desenvolvimento e testes

- `npm run api` e `npm run dev` (ver "Desenvolvimento" acima) → `http://localhost:5173/painel/` (código de instalação de desenvolvimento: `dev-instalar-greencheese`).
- `npm run testar-painel -- <pasta-do-build>`: sobe a API com dados temporários e o `vite preview` do build e roda o fluxo inteiro no Chromium (instalar → criar com foto → publicar → o site enxerga → clientes entram pela API → confirmar → lota e fecha sozinho → avisar todos → pedido feito → a caminho → chegou → entregue → CSV → incluir → a loja (em `scripts/testar-painel-loja.mjs`: troca rápida, estoque, preço, foto, produto novo, estado novo, hora, story, prêmio, textos) → trocar senha → sair), mais a robustez (rascunho, tabaco, sem rede, sessão que cai no meio, toque duplo, voltar do Android, teclado, deitado e 320 px) e o HTML do painel. Quando o build do site já tem a aba Rateio, abre também `/?rateio=<id>` no site e confere que o rateio criado no painel aparece lá. Termina com `painel ok`. `GC_PRINTS=<pasta>` guarda prints; `GC_AXE=<axe.min.js>` roda o axe em cada tela; `GC_TESTE_PORTA` (PHP) e `GC_TESTE_PORTA_SITE` (preview) fixam as portas.
- O `npm run testar-htaccess` também abre `/greencheese/painel/` no Apache e confere `noindex`, HTML sem cache e que todo arquivo do painel carrega por caminho relativo.

### Onde fica cada coisa no código

- `painel/index.html` (a página) e `public/painel/` (manifesto e `.htaccess`). O `npm run build` gera o site e, logo depois, o painel num build à parte na mesma pasta (plugin `painelAParte` do `vite.config.ts`): num build só, o Vite repartiria o React entre as duas páginas e o site ganharia pedaços e pedidos novos. Assim o site sai **byte a byte igual** ao de antes do painel e o painel leva o dele (`assets/painel-*.js`, com o CSS dentro, em `src/painel/estilo.ts`). No `npm run dev`, o `/painel/` abre direto. Variável nova no `define` do site (ex.: `__ARQUIVO_UNICO__`) entra na constante `definir`, que vale pros dois.
- `src/painel/`: `api.ts` (conversa com o servidor: csrf, sessão que cai, rede), `rotas.ts` (telas por `#/…`, histórico), `secoes.ts` (**a lista de seções**: seção nova entra aqui, com a tela dela em `Painel.tsx`), `mensagens.ts` (os textos do WhatsApp), `proibidos.ts` (a lista do tabaco, igual à do servidor), `painel.css` e `telas/`.

## Loja no painel

Com o painel instalado, a loja inteira mora no servidor e muda pelo painel, sem build: **Produtos** e **Loja** na lateral do computador; no celular, o bloco **Loja** do Resumo (o que tá esgotado, acabando ou fora do site, e os atalhos Produtos, Estados, Stories e Sorte) e o "Ajustes" dele.

- **Produtos**: busca, filtro por categoria e por estado. Escolhido um estado, cada produto tem o interruptor "À venda" (**um toque**: liga ou desliga só naquele estado) e "Contar estoque" (com o estoque contado, − e + em cada linha; **chegou a 0, sai do site sozinho** nesse estado e volta quando sobe). Em "Todos", uma bolinha por estado faz o mesmo. Recortes: esgotados, acabando ("restam X" no site), fora do site e de exemplo (com o carimbo EXEMPLO). "Organizar" muda a ordem da grade (subir e descer, que dá no teclado e no leitor de tela).
- **Produto** (criar e editar): foto (o card do site aparece do lado, como o cliente vê: o preto da foto some no preto), nome, tamanho, categoria, linha de baixo, descrição, preço (vazio = "Consultar"), combos ("2 por R$ 14,99", com a economia), variações, onde tem (estado a estado, com ou sem estoque), "Combina com", o desenho em pixel (formato e cores, pra produto sem foto), no site sim/não, exemplo e uma anotação só tua. Tabaco e vape não entram. Com histórico (rateio ou prêmio), não apaga: desliga o "Aparece no site".
- **Estados**: os do site e os fora (os dados ficam guardados), e "Ativar outro estado" entre as 27 UFs (entra com o emblema de pino, horário e taxa "a confirmar" e nenhum produto à venda). Cada estado: aparece no site, Instagram, nome do perfil e do destaque, WhatsApp (o da loja ou um próprio), cidades, horário da semana (hora digitada com máscara, madrugada vale, "Repetir o de seg em todos"), taxa ou "a confirmar", entrega grátis por dia da semana e formas de pagamento. O que era exemplo deixa de ser quando tu salva o de verdade.
- **Stories do Início**: por estado, quais produtos passam no story do topo e em que ordem (até 8, as barrinhas), com a prévia. Lista vazia = automático (os à venda no estado). O que esgota ou sai do site para de passar sozinho. Em cima, a chave **"Rua do mercador no fim do Início (celular)"** (ligada; vale pra todos os estados; no contrato é a `ruaNoStory`, o nome de quando a rua era o 1º story): desligada, o celular fica sem a rua; no computador ela continua embaixo do perfil.
- **Categorias**: nome, nome curto (o de baixo da bolinha), ícone e se é bebida (bebida nunca entra em prêmio); subir e descer muda a ordem dos destaques.
- **Loja**: o WhatsApp da loja e "o mesmo pra todos os estados", o "restam X" (a partir de quantas unidades o site avisa), os textos (bio, frase do story, sacola vazia, falas do mercador) e **"Apagar dados de exemplo"** (mostra antes o que sai: produtos, prêmios e rateios de exemplo; produto de exemplo com histórico de verdade só sai do site).
- **Teste minha sorte**: liga e desliga o jogo, as regras (giros sem conta, giros por dia com conta, quanto tempo o prêmio sem conta fica guardado) e os prêmios, cada um com "no jogo" num toque e a chance de sair (só no painel). No prêmio, as regras do site conferidas enquanto digita (só acessório, bebida nem aparece pra escolher; desconto de 1% a 50%; leva mais que paga; validade de 1 a 30 dias; sem as palavras da lista) e a prévia do story dos Melhores amigos.
- **Atividade**: cada mudança da loja com quem fez (e o toque leva pra tela dela).

Como a loja chega no site: o servidor entrega tudo num JSON só, `GET api/index.php?r=loja` (API.md, “Loja”), com ETag: o navegador pergunta de novo e, sem mudança, recebe 304 vazio. O site lê essa rota sozinho (ver “O site lendo a loja”, logo abaixo). A loja do servidor nasce da semente `public/api/nucleo/semente-loja.json`, gerada de `src/dados` por `node scripts/gerar-semente-loja.mjs` (o build para com erro se ela estiver velha; `--conferir` só confere): na instalação do painel e, num painel que já estava instalado, sozinha na primeira chamada depois de publicar (migração 101).

Onde fica cada coisa: servidor em `public/api/nucleo/loja*.php` (ver “Onde fica cada coisa no código” do servidor); painel em `src/painel/loja/` (uma tela por arquivo, `dados.ts` com a leitura e a situação de cada produto em cada estado, `trocas.ts` com a troca rápida em fila, `validar.ts` com as mesmas conferências do servidor, `Previa.tsx` e `premio-ui.tsx` com o card, o story e o prêmio como o site mostra, `loja.css`) e os textos da loja em `src/dados/textos-loja.ts`.

### O site lendo a loja

O que o dono muda no painel aparece no site na próxima vez que a página abre (ou quando a pessoa volta pra aba depois de 10 min fora), sem build e sem publicar:

- **Produtos**: nome, preço (vazio = "Consultar"), combos, variações, descrição, foto (a que o dono mandou, com o tratamento do site: o preto da foto some no preto, a revelação em pixel e o cinza do indisponível), "Combina com", produto novo e o que saiu do site (com a página aberta, ele fica como indisponível em vez de sumir; na sacola, vai pra "Saiu da loja", com o nome de quando entrou nela e o "Tirar", mesmo que tenha saído antes da visita). Opção que saiu (o dono tirou o "slim") também vai pra "Saiu da loja", com "Trocar" (abre a página pra escolher outra) e "Tirar": o pedido nunca vai sem dizer qual. Preço que mudou desde que o item entrou na sacola aparece na linha ("Preço novo: era R$ 29,99 a unidade") até a pessoa fechar a sacola. O link direto de um produto novo (`?produto=`, `?p=`) espera a loja do servidor: a página abre "carregando" e o produto aparece quando ela chega, também no 4G lento.
- **Estoque**: com o estoque contado e no limite do "restam X", o adesivo **RESTAM 3** ("RESTA 1") aparece colado na arte do card, do story do Início, do story aberto e da página do produto, que também diz "Só restam 3 unidades". A quantidade não passa do que resta (o combo maior apaga, o "+" para) e, com tudo que resta já na sacola, "Adicionar" só avisa ("As 3 que restam aqui já tão na tua sacola."). Se o estoque baixa com o produto na sacola, ela ajusta sozinha e avisa ("Ajustei tua sacola."; na sacola, "Só restam 2 unidades em Teófilo Otoni: ajustei a quantidade."). Estoque 0 = indisponível, com o "Avisar quando chegar" de sempre.
- **Estados**: estado ativado no painel aparece no site inteiro (seletor, mapa aceso, Por estado, faixa dos @, rodapé), com o emblema de pino no story de atendimento; quem chega pelo link da bio dele vê "procurando" por um instante, nunca "ainda não chegou aí". Estado tirado do site some de tudo, e quem estava nele vê a tela de sem atendimento. Horário, taxa, entrega grátis (em quantos dias da semana o dono marcar) e formas de pagamento de cada estado vêm do painel.
- **WhatsApp**: o pedido fecha no WhatsApp próprio do estado quando o dono desliga "o mesmo pra todos"; senão, no da loja (Loja → WhatsApp do pedido).
- **Stories do Início**: os produtos e a ordem do dono; sem escolha, o automático. A rua do fim do Início do celular sai com a chave dela.
- **Textos** (bio, frase do story, sacola vazia, falas do mercador no topo do Mercado) e o **Teste minha sorte** (ligado ou não, as regras de giro e os prêmios; os textos que citam "1 giro por dia" e "24 h" seguem os números do painel).

Sem servidor (arquivo único, zip sem `api/`) ou com ele fora do ar, o site segue com o que tem (a loja guardada no aparelho ou a embutida em `src/dados`): nunca fica em branco nem trava. A primeira tela não espera a rede: a pergunta ao servidor vai no primeiro respiro e a conferência do que chega fica num pedaço à parte (`loja-ler-*.js`, ~3 KB), que só baixa quando chega loja nova. Medido no celular de 390×844 com a CPU 4× mais lenta e 4G lenta: o story à vista no mesmo tempo de antes, dentro da variação (os números estão em PENDENCIAS, “Loja no servidor”).

Testes: `scripts/revisao-loja.mjs` (rodada do `revisao.mjs`, com o `GET loja` simulado como o dono mexe: story na ordem do dono, RESTAM, a sacola que trava, BA ativada sem a tela de sem atendimento piscar, WhatsApp do estado e "o mesmo pra todos", entrega grátis em dois dias, Sorte desligada, rua desligada, servidor fora do ar com a loja guardada, resposta torta, estado tirado e o 404 `sem-loja`); o fim do `scripts/testar-painel-loja.mjs` (o painel muda e o site de verdade mostra, com o PHP ligado, inclusive o 304 do ETag); e `GC_LOJA_REAL=1` no `celulares.mjs` e no `revisao.mjs`, que deixa o `GET loja` ir pro servidor de verdade (PHP ligado e painel instalado).

Onde fica cada coisa: `src/store/loja.ts` (a fonte única: embutida, guardada e servidor), `src/store/loja-ler.ts` (a conferência), `src/lib/estoque.ts` (a sacola e o "restam X"), `src/lib/premios.ts` (as regras dos prêmios, pro embutido e pro servidor) e `src/arte/pixel/emblemas.ts` (os emblemas, com o de pino do estado ativado no painel).

---

## Pedidos, avisos no WhatsApp e textos do pedido

O pedido continua fechando no WhatsApp da loja, do jeito que o cliente já conhece. O que mudou: cada pedido ganha um **código** (`GC-7KD2X`), uma cópia completa fica no **painel** (Pedidos) e, se o dono ligar, um número de WhatsApp da loja manda o pedido **formatado num grupo privado** com o celular que recebe e notifica. As falas do pedido guiado (o chat do site) o dono troca no painel (Textos do pedido). Contrato: API.md, "Pedidos do site", "Pedidos, avisos e falas (painel)" e "Avisos no WhatsApp".

### O pedido no servidor

- O código nasce no aparelho (5 letras e números sem os que confundem: nada de 0/O, 1/I/L) e vai numa linha só da mensagem, logo depois do cabeçalho: `Código: GC-7KD2X`. O resto da mensagem não mudou (o `conferir-mensagem.mjs` garante). Com ele a loja acha o pedido no painel e no grupo.
- No toque de "Fechar pedido no WhatsApp" (e "Fechar encomenda…"), o site manda a cópia estruturada pro servidor (`navigator.sendBeacon`, ou `fetch` com `keepalive`) **sem segurar o link**: o WhatsApp abre na hora, como sempre. Itens com quantidade, variação, preço de cada um, total com o combo, subtotal, cupom, estado, cidade, nome, endereço com CEP e bairro, pagamento, troco, observação e a mensagem exata.
- A cópia fica guardada no aparelho até o servidor confirmar: se a internet cair no toque, ela vai de novo quando a pessoa volta pro site (o mesmo código nunca vira dois pedidos).
- Mudou o pedido depois de mandar (voltou do WhatsApp, tocou em "Não consegui" e trocou o endereço, por exemplo): nasce um código novo, que **entra no lugar** do de antes até 2 h depois (o de antes sai da lista se ainda estava "novo"). Depois disso é outro pedido. Se o envio do de antes tinha falhado, ele não vai mais sozinho; e se chegar atrasado mesmo assim, entra já trocado pelo novo, sem aviso no grupo.
- Campo que só informa (troco, cupom, pagamento) nunca derruba o pedido: o chat guarda o troco em centavos ("50,555" → R$ 50,56) e no mesmo teto do servidor; o servidor arredonda o que vier. Se a cópia vier torta num campo de estrutura (itens, subtotal) mas com a mensagem certa, o pedido entra só com a mensagem (a anotação diz o que veio errado) — nunca some do painel e do grupo. O que o servidor recusa de vez fica anotado no aparelho e no log do servidor.
- Sem servidor (o zip da prévia, o `npm run dev` com o PHP desligado), nada disso aparece pro cliente: o pedido fecha no WhatsApp igual.
- O WhatsApp do cliente vai junto quando ele está com a conta aberta (ver "Contas: equipe e clientes": o pedido fica na conta dele e o endereço é guardado). Nos outros, o dono guarda o número no pedido, tirando da conversa.

### Painel → Pedidos

- **Onde**: no Resumo, o bloco "Pedidos novos" (e a frase de cima conta os novos); no computador, na lateral; no celular, também em Conta → "Mais do painel".
- **Lista**: abre no "Em aberto" (novo, confirmado e saiu pra entrega), o mais novo primeiro; filtros por status (só aparecem os que têm pedido), por estado e busca por código (com ou sem o "GC-"), nome, cidade ou WhatsApp.
- **Pedido por dentro**: quem pediu (com o link do WhatsApp dele), os itens com o combo, o subtotal (sem a taxa de entrega: a loja combina na conversa), o cupom, o endereço com "Ver no mapa", o pagamento com o troco, a observação, a mensagem que foi pro WhatsApp e a anotação da loja (só o painel vê).
- **Passos**: Recebido → Confirmado → Saiu pra entrega → Entregue (ou Cancelado), com o próximo passo num botão. Em cada passo, a **mensagem pronta pro cliente** ("Teu pedido GC-… tá confirmado ✅…"), que abre o WhatsApp com o texto escrito; o cliente nunca é avisado sozinho. Toque errado: "Voltar pra…" e "Desfazer a entrega" (com confirmação); cancelado dá pra reabrir.
- **Apagar os dados (LGPD)**: com o pedido entregue ou cancelado, tira nome, WhatsApp, endereço, observação, anotação e a mensagem (e o texto do aviso no grupo). Itens, valores e datas ficam nas contas.

### Avisos no WhatsApp (o grupo da loja)

A ideia do Ian: um número de WhatsApp da loja **só pra mandar** (um chip à parte, não o número que atende os clientes), conectado num serviço de envio, e um **grupo privado** com esse número e o celular da loja. Cada pedido vira uma mensagem no grupo, e o celular notifica.

1. Contratar o serviço de envio e conectar o número que manda: **Z-API** (serviço contratado à parte) ou **Evolution API** (servidor próprio ou contratado). Os dois usam o WhatsApp Web do número conectado (ler o QR Code com o celular desse número).
2. Criar o grupo com esse número e o celular da loja. Pegar o **ID do grupo** no serviço (a lista de grupos do número): no Z-API ele termina em `-group`, na Evolution em `@g.us`. O painel aceita com ou sem esse final.
3. Painel → **Avisos no WhatsApp** → escolher o serviço e preencher: Z-API (ID e token da instância e, se a conta tiver o token de segurança ligado, o Client-Token) ou Evolution (endereço do servidor com `https://`, nome da instância e apikey); depois, "Quem recebe" (o grupo, ou um número só). **Salvar** e tocar em **"Enviar teste"**: a mensagem de teste tem que chegar no grupo.
4. "O que avisa": pedido novo, encomenda, reserva de rateio e pagamento de rateio confirmado (cada um liga e desliga).
5. Quem já usa n8n, Make ou outro automatizador: **Webhook**. A loja manda um POST em JSON (`tipo`, `texto` pronto e `dados` com o pedido inteiro) assinado com `X-GC-Assinatura` (HMAC-SHA256 do corpo com o segredo, que o painel gera); o fluxo confere a assinatura e manda o texto pro WhatsApp.

A mensagem no grupo (negrito e itálico do WhatsApp, sem enfeite):

```
*NOVO PEDIDO* · #GC-7KD2X
MG / Teófilo Otoni · qua., 08/10 às 22:41

*Itens*
1x Jack Daniel's Old No. 7 1 L — R$ 149,90
3x Seda OCB Premium Slim — R$ 19,99 _(combo 3 por R$ 19,99)_
Subtotal: *R$ 169,89*
Cupom: SORTE-K8EA — Leva 4 Seda OCB Premium Slim e paga 3 _(a loja confirma)_

*Entrega:* Rua Doutor Manoel Esteves, 120 — Centro · CEP 39800-000 _(taxa a confirmar)_
*Pagamento:* Pix
*Cliente:* Ian · wa.me/5533…
*Obs.:* Portão azul

Painel: https://oprojeto.online/greencheese/painel/#/pedido/12
```

A encomenda (`*NOVA ENCOMENDA*`, com produto, quantidade e o link do cliente), o pedido que o cliente mudou (`*PEDIDO ATUALIZADO*`, dizendo qual saiu da lista) e o rateio (`*RATEIO · NOVA RESERVA*` com o placar e até quando a vaga fica guardada; `*RATEIO · PAGAMENTO CONFIRMADO* ✅` com o placar e quem confirmou) têm os modelos deles. Nada de prazo, frete ou valor que a loja não passou.

- O aviso sai **depois** que o cliente já teve a resposta (o site nunca espera o serviço de envio). Não foi? Tenta de novo sozinho em 1 min e em 5 min; depois, o histórico da tela mostra o que não foi, o porquê em português e o botão **"Mandar de novo"**. O Resumo avisa quando algum aviso não foi.
- Token, Client-Token, apikey e o segredo do webhook ficam **só no servidor**: o painel mostra só o final (`•••1234`). Campo de segredo em branco ao salvar mantém o guardado.

### Painel → Textos do pedido

Cada fala do chat que monta o pedido (as perguntas, as respostas e os botões) com a prévia do balão. Toca na fala, troca o texto e salva; o site usa a nova na próxima vez que alguém abrir o chat. Os **marcadores** (`{nome}`, que é o primeiro nome, `{cidade}`, `{uf}`…) viram o dado de quem tá pedindo: cada fala mostra os que valem nela e põe com um toque. O painel (e o servidor de novo) recusa marcador que não existe naquela fala, texto grande demais, promessa de prazo ou frete ("frete grátis", "em 30 minutos"…) e tabaco. "Voltar ao padrão" põe o texto de sempre. A mensagem que vai pro WhatsApp **não** muda por aqui (o formato é o combinado com a loja), nem o botão "Fechar pedido no WhatsApp".

Pra quem mexe no código: o texto de sempre de cada fala, o tipo e os marcadores moram em `src/dados/textos-pedido.ts`. Depois de mexer: `node scripts/gerar-textos-pedido.mjs` (gera a lista que o servidor confere, `public/api/nucleo/textos-pedido.json`; o `testar-api` recusa lista velha).

### Testes

- `npm run testar-api`: também os pedidos (cada validação, a armadilha, o Origin, o tabaco, a mesma entrada de novo, 8 envios juntos, o mesmo código em dois aparelhos, o pedido mudado com a janela de 2 h, o limite por IP), o painel dos pedidos, as falas (ETag e 304) e os avisos contra servidores falsos do Z-API, da Evolution e do webhook: o formato exato de cada requisição, a resposta que não espera o envio, falha, nova tentativa, "Mandar de novo" e segredo que nunca volta (`scripts/testar-api-pedidos.mjs`).
- `npm run testar-painel -- <build>`: no fim, o fluxo dos pedidos, dos avisos (webhook falso com a assinatura conferida) e dos textos no navegador, com axe e os 4 tamanhos (`scripts/testar-painel-pedidos.mjs`; roda sozinho também: `node scripts/testar-painel-pedidos.mjs <build>`).
- `npm run revisao`: a rodada "pedido no servidor" (a cópia sai no toque, com a mensagem exata e o código; fica no aparelho até o servidor confirmar; código novo quando o pedido muda; as falas trocadas no painel; tabaco recusado na encomenda).
- `testar-htaccess`: os módulos novos fechados pela web, o pedido e as falas pelo Apache.

### Onde fica cada coisa no código

- Servidor (`public/api/nucleo/`): `pedido-migracoes.php` (as tabelas, faixa 200–299), `pedido.php` (o `POST pedido` e as rotas do painel), `avisos.php` (os motores, a fila, as mensagens do grupo e as portas `gc_whatsapp_enviar`, `gc_whatsapp_mandar` e `gc_aviso_enfileirar`), `textos.php` (as falas) e `textos-pedido.json` (gerado); em `base.php`, `gc_depois()` (o trabalho que roda depois da resposta).
- Site: `src/lib/codigo-pedido.ts` (o código e o token), `src/store/chat.ts` (o código do pedido montado), `src/lib/pedido-envio.ts` (a cópia e a fila no aparelho), `src/lib/pedido-itens.ts`, `src/lib/pedido-pendente.ts` (a nova tentativa na volta pro site), `src/lib/falas.ts` e `src/dados/textos-pedido.ts` (as falas), `src/componentes/Chat.tsx`.
- Painel: `src/painel/pedidos/` (as telas Pedidos, Pedido, Avisos e Textos, o bloco do Resumo, as mensagens prontas de cada passo em `mensagens.ts`, o CSS em `pedidos.css`).

---

## Contas: equipe e clientes

Duas contas diferentes, cada uma com o cookie dela: a **equipe** entra no painel (login e senha, papel e estados) e o **cliente** entra no site (WhatsApp e um código que o WhatsApp da loja manda). Contrato: API.md, "Equipe: papéis e permissões", "Contas dos clientes (site)" e "Teste minha sorte no servidor".

### Equipe (painel → Equipe, só o dono)

- **Papéis**: **Dono** (tudo, todos os estados), **Gerente** (pedidos, rateios, participantes e, quando a frente da loja chegar no painel, produtos e estoque; só os estados dele) e **Atendente** (pedidos e participantes dos rateios, só os estados dele; não cria nem muda rateio, não apaga dados). Equipe, Clientes, Avisos no WhatsApp, Textos do pedido, Servidor e os ajustes da loja são só do dono.
- **Criar um acesso**: Equipe → **Novo acesso** → nome (o login vem sugerido: "ana.souza"), papel e os estados → **Criar acesso**. Aparece a **senha provisória** uma vez só (3 grupos de 4 letras e números, sem os que confundem): "Copiar login e senha" e mandar pra pessoa por mensagem direta. No primeiro acesso o painel pede a senha nova antes de qualquer coisa (o servidor também recusa o resto até trocar).
- **No dia a dia**: tocar na pessoa mostra o último acesso, quantos aparelhos estão logados, o papel e os estados (**Mudar**), **Gerar senha provisória** (esqueceu a senha: os aparelhos dela saem na hora) e **Desativar acesso** (sai na hora de todos os aparelhos e não entra mais; o que ela fez continua na Atividade; dá pra reativar). Embaixo, **O que fez** (as últimas ações dela) e o link pra Atividade só dela. Sempre sobra um dono; ninguém muda o próprio papel.
- **O que cada um vê**: o painel mostra só as seções e os botões que o papel e os estados da pessoa permitem: rateio que vale também em estado que não é dela (MG+RJ pra gerente de MG) aparece sem Editar, sem os passos e sem cancelar, com "Esse rateio vale em estado que não é teu: só o dono mexe nele"; o rateio novo nasce só com os estados dela (os outros chips ficam travados); o "Incluir" de participante já vem com o estado dela e só lista os dela (a barra do celular muda: a do gerente tem Resumo, Rateios, Criar, Pedidos e Conta; a do atendente, Resumo, Rateios, Atividade, Pedidos e Conta). Link guardado pra uma tela que o papel não abre mostra "Sem acesso". Mesmo assim quem decide é o servidor: cada rota do painel pede uma permissão (o mapa em `public/api/nucleo/equipe.php`), e pedido, rateio ou vaga de outro estado é recusado. A Atividade de gerente e atendente mostra só o que a própria pessoa fez.

### Clientes (site → Minha conta; painel → Clientes)

- **Quando liga**: com os Avisos no WhatsApp ligados num serviço que manda mensagem pra número (Z-API ou Evolution): o mesmo número que avisa o grupo manda o código pros clientes. O dono desliga em Clientes ("Clientes entram com o código pelo WhatsApp"). Desligado, ou sem servidor (o zip da prévia), o site segue com a conta só no aparelho, como antes: quem decide é o `GET recursos`, perguntado logo depois da primeira tela.
- **Entrar ou criar**: Minha conta (ou "Entrar com teu WhatsApp" em Por estado, ou "Guardar meu prêmio" no Teste minha sorte) → o WhatsApp → **Receber o código** → os 6 números que chegaram ("*482913* é teu código pra entrar na Green Cheese. Vale por 10 minutos. Não passa ele pra ninguém: a loja nunca pede esse código.") → número sem conta pede o nome (e as promoções, opcional, com a data gravada). O código vale 10 min e 5 tentativas; "Mandar outro código" depois de 1 min (o código anterior continua valendo: valem os 2 últimos). Se alguém pediu código demais pro número (até de propósito, pra travar a dona), a tela vai direto pro passo do código ("Já tem código valendo…: usa o último que chegou"), e do aparelho em que a pessoa já entrou o limite é só dela. A loja inteira tem um teto de códigos (30 por hora e 200 por dia, muda em Clientes): batido, o entrar com código pausa sozinho e o site volta pra conta do aparelho até a janela passar. A tela é a mesma com ou sem conta (ninguém descobre se um número tem conta). A conta fica aberta 90 dias no aparelho.
- **Minha conta**: o giro de hoje e os cupons; **Meus pedidos** (os feitos com a conta logada e os do WhatsApp dela que a loja conferiu — salvando o número no pedido, no painel; o número digitado no aparelho não liga nada; o código, o que pediu e o andamento que a loja dá no painel: Recebido → Confirmado → Saiu pra entrega → Entregue); **Minhas vagas de rateio** (as feitas com a conta e as do WhatsApp dela que a loja conferiu, com "Ver rateio"); **Meus endereços** (até 5; o do último pedido entra sozinho; o pedido guiado oferece os do estado na hora do endereço); teus dados (nome, promoções, trocar o número com um código pro número novo); **Baixar meus dados** (um arquivo com tudo que a loja guarda; pedido achado só pelo número vai sem nome, endereço, observação e mensagem); **Sair**; **Apagar minha conta** (LGPD: some a conta, os cupons e os endereços; os pedidos ficam com a loja, sem a conta).
- **A conta que já estava no aparelho**: quando a loja liga as contas, a conta do aparelho espera a pessoa confirmar o número ("Tua conta deste aparelho (Ian, 1 cupom) vai junto"). No primeiro login vão junto o nome, as promoções e até 2 cupons (o prêmio reservado primeiro) ganhos antes de a conta do servidor existir, com o mesmo código e a validade contada do dia em que foram ganhos — uma vez só por conta.
- **Teste minha sorte**: com a conta no servidor, quem sorteia é o servidor (os prêmios do painel quando a frente da loja ligar `gc_premios_ativos`; até lá os de `src/dados/sorte.ts`, copiados por `node scripts/gerar-premios-sorte.mjs`). Sem conta: 1 giro por aparelho, e o prêmio fica reservado 24 h pra quem criar a conta ali. Com conta: 1 giro por dia por conta, por WhatsApp e por aparelho — o giro sem conta guardado depois (entrar ou criar a conta naquele aparelho) conta como o giro daquele dia da conta: conta que já girou no dia não guarda ("Tua conta já tinha girado nesse dia: o prêmio desse giro não entra nela"). O código do cupom nasce no servidor.
- **Painel → Clientes** (só o dono): o liga/desliga do código e o **teto de códigos da loja** (por hora e por dia, com quantos saíram; pausado, diz até quando), quantas contas e quantas aceitaram promoções, a busca (nome ou WhatsApp), o filtro "Aceitaram promoções" e **Baixar lista (Excel)** (só quem aceitou, com a data). No cliente: os dados com a data das promoções, os cupons (**Dar baixa** quando foi usado, **Desfazer**), os pedidos, as vagas, os endereços e **Apagar a conta** (o pedido de exclusão que chegou pela conversa).

### Testes

- `npm run testar-api`: no fim, `scripts/testar-api-contas.mjs` (um PHP próprio com o Z-API falso): o mapa cobre toda rota do painel, cada papel em cada rota, os estados de cada um, senha provisória e troca obrigatória, desativar e redefinir; o código (formato, limites por número e por IP, 1 por minuto, expiração, tentativas, sem revelar conta), entrar/criar, a sessão, atualizar e trocar o número, endereços, pedidos e vagas, exportar, sair e apagar; a migração da conta do aparelho; o giro no servidor (sem conta, com conta, 1 por dia, prêmios do estado, álcool nunca) e o painel Clientes.
- `npm run testar-painel -- <build>`: no fim, `scripts/testar-painel-contas.mjs` (roda sozinho também: `node scripts/testar-painel-contas.mjs <build>`; portas em `GC_TESTE_PORTA_CONTAS` e `GC_TESTE_PORTA_CONTAS_SITE`): o dono cria a gerente e o atendente no navegador, a troca obrigatória, o que cada papel vê e o que o servidor recusa, desativar/reativar/senha nova; no site (celular), entrar com o código, Minha conta, o endereço guardado oferecido no pedido guiado, o pedido em "Meus pedidos", o Teste minha sorte sorteado no servidor, a migração da conta do aparelho, Clientes (busca, CSV, baixa, apagar), sair, apagar e o código desligado. Axe e sem rolagem lateral nos 4 tamanhos.
- `npm run revisao`: a rodada "conta no servidor" (simulada como no API.md): a conta do aparelho vai junto no primeiro login, Minha conta com pedidos, vagas e endereços da loja, em 390 e 320.

### Como as contas estão montadas (pra comparar com outro sistema)

Feito do zero aqui (o código do portalmultipla não estava acessível pra seguir o jeito dele); pra comparar, o desenho é este:

- **Equipe**: tabela `usuarios` (login, nome, `papel`, `ufs` em JSON, hash da senha com `password_hash`, `trocar_senha`, `ativo`, `criado_por`) e `sessoes` (hash do token, validade deslizante de 30 dias, até 10 por pessoa; cookie `gc_painel` `HttpOnly` + `SameSite=Strict`) com CSRF por sessão no cabeçalho `X-CSRF`. Permissão por **mapa rota → permissão** (`GC_PERMISSAO_ROTA`) e papel → lista de permissões (`GC_PERMISSOES_PAPEL`), conferido num ponto só (o `gc_exigir_dono()`, que toda rota do painel chama); os estados filtram por `uf` nas consultas. Toda ação grava em `eventos` com o login de quem fez.
- **Clientes**: tabela `clientes` (WhatsApp único como chave, nome, promoções com data, +18 com data, `origem` site/aparelho), `clientes_codigos` (HMAC do código, motivo, validade, tentativas), `clientes_sessoes` (hash do token, 90 dias, até 10; cookie `gc_cliente` `HttpOnly` + `SameSite=Lax`, separado do painel) e `clientes_enderecos`. Sem senha: o login é o código pelo WhatsApp. Limites em `tentativas` (por número e por IP).
- **Sorte**: `giros` (dia de Brasília, conta, hash do WhatsApp, hash do aparelho, prêmio, reserva) e `cupons` (código único, prêmio congelado no dia, validade, baixa).
- **Site**: a interface `AdaptadorConta` (`src/lib/conta.ts`) com dois adaptadores (`contaLocal` e `contaServidor`, em `src/lib/conta-adaptador.ts`) e a escolha automática em `src/lib/conta-modo.ts`; as telas leem o cache `gc-conta` (localStorage), que o adaptador do servidor preenche com o que a API devolve.

### Onde fica cada coisa no código

- Servidor (`public/api/nucleo/`): `contas-migracoes.php` (203–206), `equipe.php` (papéis, o mapa, os estados, as rotas da equipe), `sessao.php` (o usuário com papel e estados), `clientes.php` (código, sessão do cliente, rotas `cliente-*` e o painel Clientes), `sorte.php` (giros e cupons), `premios-semente.php` e `premios-sorte.json` (os prêmios até a frente da loja definir `gc_premios_ativos`).
- Site: `src/lib/conta-modo.ts` (pergunta o `recursos` e escolhe), `src/lib/conta-servidor.ts` (a conversa com a API e o cache), `src/lib/conta-adaptador.ts`, `src/componentes/FormConta.tsx` (os passos do código), `src/componentes/ContaFolha.tsx` e `ContaServidor.tsx` (Minha conta: pedidos, vagas, endereços, meus dados).
- Painel: `src/painel/permissoes.ts` (o que o papel pode), `src/painel/secoes.ts` (cada seção com a permissão e os papéis que têm ela na barra), `src/painel/contas/` (Equipe, a pessoa, Clientes, o cliente e a troca obrigatória da senha).

---

## Abas e Início

O site é um app só, com quatro abas no molde do Instagram. O **Início** é o perfil da loja de cima a baixo e acaba na grade da loja:

| Aba | Endereço | O que tem |
|---|---|---|
| Início | `…/greencheese/?uf=mg` | story dos produtos (no celular, o "Enviar mensagem…" fica no pé), faixa dos perfis, perfil com "Ver loja" (no computador, com a rua viva embaixo), destaques e a grade (a caixa "Não achou? A Green Cheese importa." é a última célula); no celular, a rua viva depois da grade; rodapé |
| Mercado | `…/greencheese/?uf=mg&aba=mercado` (o velho `?aba=catalogo` vale) | o mercador de pé no topo, destaques, busca, Só DISPONÍVEL, grade, encomenda e, no fim, o Teste minha sorte e a linha "Chegou teu pedido? Marca @… no story" |
| Rateio | `…/greencheese/?uf=mg&aba=rateio` | os rateios do estado (ver "Rateio (site)") |
| Por estado | `…/greencheese/?uf=mg&aba=estados` | o mapa do Brasil e os perfis de cada estado |

**O Início:**

- **Celular:** story dos produtos → faixa dos @ → perfil ("Enviar mensagem", "Ver no Instagram", "Ver loja") → destaques → grade → **a rua viva** (com o título pequeno "Na rua da loja") → rodapé. Sem busca e sem "Só DISPONÍVEL" (a busca é a lupa da barra) e sem o fim da aba Mercado. O mercador do Início do celular mora na rua do fim (pedido do Ian em 09/10: o topo é o de 08/10 e a animação do mercador fica só lá no fim).
- **Computador:** [perfil e rua viva | story] de 1200 px em diante (de 900 a 1199 o story vem em cima, centrado com as setas, e perfil e rua embaixo); depois a faixa, os mesmos destaques e a mesma grade (na moldura da aba Mercado) e o rodapé. A rua fica na maior escala inteira que a coluna do perfil aceita, sem encolher o story (`useLojaDesktop` em `Hero.tsx`). De 1600 px em diante o hero fica numa moldura centrada (até 1440 px) e o perfil vai pro meio da coluna, em cima da rua, alinhado com os destaques e a grade.
- **Destaques do Início** (uma linha só, rola de lado): primeiro os que levam a outro lugar — o destaque do estado (moto, abre o story de atendimento; o nome comprido vira curto embaixo da bolinha, "T. OTONI", e fica inteiro no leitor de tela), **Buscar** (abre o Mercado com o cursor na busca), **Rateio** (abre a aba Rateio), **Sorte** (abre o Teste minha sorte, com o anel aceso e o selo "novo") e **Por estado** (o pino com o selo da UF) —, um fio fino e, à direita, os filtros (Tudo, Importadas, Destilados, Sedas, Piteiras, Acessórios), que filtram a grade do próprio Início. No celular a linha é mais compacta (bolinhas de 52 a 64 px conforme a largura; as medidas estão em `Catalogo.css`): as abas vêm primeiro e o primeiro destaque que não cabe espia na borda — o sinal de que a linha continua. O `celulares.mjs` confere a espiada em cada celular. No computador, quando a linha não cabe (de 900 a ~1170 px), aparecem setas nas pontas, como na bandeja de destaques do instagram.com, e Shift + roda anda a linha de lado.
- **"Ver loja"** do perfil desce até os destaques (suave; corte seco com movimento reduzido) e leva o foco junto.
- **Story:** os lados passam e voltam, arrastar passa, segurar pausa. Nos produtos, a borda que passa é larga (28%) até o topo do nome e, dali até os adesivos, uma faixa de 18% de cada lado: o miolo do nome, do preço e do DISPONÍVEL abre o produto. O clique que o navegador gera depois de um toque na borda não abre o produto que ficou embaixo do dedo. O cabeçalho mostra há quanto tempo o catálogo foi atualizado (`catalogoAtualizadoEm`) só com menos de 24 h, como story de verdade; depois disso, nada.

**Abas:**

- **Celular:** barra fixa embaixo com 6 células: Início, Mercado (lupa), Rateio (a caixa de importação, com o número de rateios abertos), Teste minha sorte (o dichavador), Sacola (com o número de itens) e Por estado (o avatar da loja com o selo da UF). Tocar de novo na aba aberta sobe ao topo; a lupa tocada de novo no Mercado vai até a busca. Num estado sem entrega o Rateio e o Teste minha sorte saem da barra. Com o teclado aberto (busca, chat) a barra sai, como no Instagram — também no Android, onde a janela inteira encolhe com o teclado.
- **Celular deitado:** o story do Início cabe inteiro acima da barra (nos produtos, arte à esquerda e nome, preço e DISPONÍVEL à direita); a rua fica no fim do Início, como em pé. Celular grande deitado (900 px ou mais) pega o layout de computador; a lateral rola quando não cabe. A abertura deitada põe a pergunta à esquerda e a enquete à direita, sempre dentro da tela.
- **Computador:** a barra lateral tem Início, Buscar, Mercado, Rateio, Pedido guiado, Sacola, Teste minha sorte, Por estado (e Minha conta, com conta), com a aba atual em negrito e o ícone cheio ("Buscar" fica ativo com a busca em uso). Ctrl+clique ou o botão do meio abre a aba numa aba nova do navegador. Em janela baixa a lateral rola sozinha, sem levar a página.
- **Voltar:** cada troca de aba entra no histórico. O voltar do Android (e do navegador) fecha primeiro a camada aberta (story, página do produto, sacola, chat, jogo, rateio) e depois volta para a aba de antes, com a rolagem de antes. Um link direto (`?aba=mercado`) não inventa um Início embaixo: voltar sai do site. Trocar de estado na aba Por estado leva ao Início, como trocar de conta no Instagram; se a troca foi feita com o chat aberto, o chat continua e o Início entra quando ele fechar.
- **Teclado e leitor de tela:** a abertura prende o Tab, leva o foco pro "Sim" do palpite de IP e, ao sair, pro título da aba. Nos adesivos brancos (quiz, enquete, caixa de encomenda) o anel de foco é preto. O quiz "Quanto leva?" e a enquete de formato são grupos de rádio (setas trocam, uma parada de Tab). A faixa dos @ traz o botão focado pelo teclado pra dentro dela (no toque e no clique o trilho segue com a rolagem). O "Mais opções" do story abre com o foco no 1º item, anda nas setas e o Esc fecha só o menu. A busca do Mercado diz quantos produtos sobraram (ou que dá pra encomendar).
- **Rapidez:** as abas escondidas usam `content-visibility: hidden` e cada card fora da tela usa `content-visibility: auto`. A grade do Início e o Mercado montam no tempo ocioso depois da abertura, numa transição do React (o toque passa na frente); trocar de aba não re-renderiza a loja nem o hero. O filtro anima a grade só com transform (Flip no modo simples).
- Os links de sempre continuam valendo por cima de qualquer aba: `?p=`, `?produto=`, `?jogo=sorte`, `?chat=pedido`, `?rateio=`. Ex.: `?uf=mg&aba=mercado&produto=jack-daniels-old-no7-1l` abre a página do produto e o voltar cai no Mercado.
- O código das abas está em `src/lib/abas.ts` (URL, histórico e o "Ver loja") e `src/componentes/Abas.tsx` (as vistas); a loja do Início é o mesmo `Catalogo.tsx` com `onde="inicio"` (ids próprios: `inicio-loja`; o `#catalogo` é da aba Mercado, que o chat e a rolagem usam).

**Links velhos da Home 2** (a versão em teste que saiu): `https://oprojeto.online/greencheese/home2/` (e `Home2/`, `HOME2/`, que o `scripts/publicar.mjs` sobe junto) leva para a home de sempre mantendo o resto do link (`home2/?uf=rj` abre no RJ); `?home=2`, `?home2`, `?Home2`, `?home=1` num link já enviado saem da URL sozinhos e nada muda.

> Num estado sem entrega (ex.: `?uf=ba`) o Início vira a tela "A Green Cheese ainda não chegou aí", sem destaques nem grade, e diz que a loja atende no RJ, MG, SP, ES e SC (as cidades, cada perfil confirma).

## Início vivo e Mercado

> A aba **Mercado** é o antigo Catálogo, e o mercador **mora na rua viva** do Início (no celular, no fim do Início, depois da grade; no computador, embaixo do perfil).

**A rua viva do Início.** Uma rua de madrugada em pixel art — muro, poste com a luz em pontilhado e o gato nos engradados debaixo dela, a porta da loja com o letreiro GC em néon — onde o mercador vive e vende:

- **Entre um cliente e outro** ele olha quem foi embora (ou acena), anda até um ponto, para, olha em volta, **bebe a Fanta Ghost Face Punch** (tira do casaco, gole de cabeça inclinada, guarda), faz carinho no gato e espera no ponto. Bebe uma vez sim, outra não; carinho no gato no máximo uma vez sim, outra não.
- **Quatro clientes**, sorteados num saco embaralhado (os quatro passam antes de alguém voltar e nunca o mesmo duas vezes seguidas), um por vez. Cada um: entra, chega perto, fala, o mercador responde, entrega, recebe e o cliente faz a coisa dele:
  - **skatista** chega rodando e freia arrastando o pé, pede seda, aponta "esse aí" no casaco aberto, pega o livreto, paga com nota e sai remando: volta por onde veio ou segue em frente pela beira da calçada, passando na frente do mercador, e só dá o ollie depois de passar por ele;
  - **motoboy** chega no asfalto e encosta; o mercador desce até o meio-fio, entrega a sacola GC (vai por cima do ombro para a bag), pisca o farol e faz joia, o mercador acena e a moto arranca com as linhas de velocidade, passando na frente dele;
  - **MC** chega no beat, toque de mão em 3 tempos (a nota passa no aperto: paga no toque), pega a Arizona e sai dançando, com notas musicais saindo do fone;
  - **turista** chega lendo o mapa e quase esbarra (o "!"), pergunta se é ali a GC, tira foto do mercador de casaco aberto (flash na lente), pega a piteira, paga e sai feliz.
- Ciclo de uns 20 a 35 s; o cliente que anda devagar já vem entrando enquanto o mercador volta para o ponto (nada de vazio longo) e ninguém atravessa ninguém. Falas curtas em balão, uma por vez, que não cobrem a cabeça de ninguém nem o letreiro GC (sem lugar de lado, o balão quebra em duas linhas, com a cauda sempre em cima de quem fala), em `src/componentes/rua/falas.ts` ("Chega mais.", "Vem no certo!", "Quem já usou sabe da qualidade."…); "Sextou!" só às sextas. Nada de álcool ou tabaco na rua: ele bebe refrigerante e o forro do casaco só mostra refrigerante e acessório.
- **Tocar**: no mercador, ele abre o casaco (assim que termina o que está fazendo; no meio de um atendimento, logo depois dele), fala e aparece o adesivo **VER O MERCADO**, que leva à aba Mercado; num cliente, ele reage (pop shove-it, farol e joia, pose de b-boy, selfie); no gato, ele empina a cabeça. Pelo teclado, o botão "Chamar o mercador" (por cima dele) faz o mesmo e o Tab seguinte cai no "Ver o Mercado". O botão discreto no canto (**Pausar a rua** / **Continuar a rua**, alvo de 44 px) congela tudo. Para o leitor de tela a cena é decorativa: o grupo "A rua da loja", o botão do mercador, o do Mercado e o de pausar (no celular, com o título "Na rua da loja" em cima); chamado, o aviso diz o que de fato acontece (abre agora, no fim do atendimento, quando a rua voltar a andar ou, na foto, só oferece).
- **Onde fica**: no celular, **no fim do Início, depois da grade e antes do rodapé** (pedido do Ian em 09/10), faixa de ponta a ponta, 184 px de altura a 2 px por pixel da arte, com o título pequeno "Na rua da loja" em cima; o topo do celular é o de 08/10 (o 1º story é o dos produtos, a faixa dos @ e o perfil logo depois). No computador, **embaixo do perfil, na coluna dele** — [perfil e rua | story] de 1200 px em diante; de 900 a 1199 o story vem em cima e perfil e rua embaixo —, na maior escala inteira que a largura da coluna aceita (2× em coluna estreita, 3× no notebook, 4× em tela grande), com as pontas sumindo no preto, sem encolher o story. Lado a lado com o story, perfil + rua cabem na altura que o hero já tinha (a da janela, até 900): numa janela baixa (notebook com a barra do navegador, 1366×657, 1280×650) o perfil fica baixo — o avatar ao lado dos números, como no celular — e a rua desce para 2×, então o story inteiro, a calçada da rua e os destaques ficam na primeira tela, onde ficavam antes da rua (`useLojaDesktop` no `Hero.tsx`). A chave do painel (Stories do Início, "Rua do mercador no fim do Início (celular)", a `ruaNoStory` da loja) desliga a rua do celular; o computador não muda.
- **Por que no fim**: a rua chegou a ser o 1º story do celular (com um pôster desenhado no build); em 09/10 o Ian pediu o layout de 08/10 no topo, com a animação do mercador só lá no fim do Início. O story do celular voltou a ter só produtos (5 s cada, uma barrinha por produto); o link direto de um produto (`?p=`) abre o story dele por cima, e um estado sem produto à venda fica sem story, como no computador.
- **Para sozinha** fora da tela (atrás da barra de abas também), com a aba do navegador escondida, com qualquer camada por cima (story, página do produto, sacola, chat, jogo, conta, rateio) e no botão de pausar: aí nem o `requestAnimationFrame` roda (o `scripts/revisao.mjs` conta as voltas dele em cada caso, no celular e no computador). Com **movimento reduzido** vira uma foto: o mercador de casaco aberto atendendo o skatista que aponta, o gato e o letreiro aceso, com o balão "Chega mais." (tocar nele ainda mostra o VER O MERCADO).
- **Leve**: a vaga da rua tem a altura reservada desde o primeiro quadro (zero pulo) e a rua vem num pedaço à parte (`Rua-*.js`, ~11 KB gzip). No computador ela baixa no primeiro respiro depois da abertura (está na primeira tela); no celular, só quando a vaga chega perto da tela, rolando (um `IntersectionObserver` com folga de pouco mais de uma tela): a primeira tela do celular não paga nada por ela. Os 280 quadros do elenco são montados num **worker** (`elenco.worker-*.js`, ~21 KB gzip) e voltam prontos como imagens; sem worker (navegador antigo, arquivo único), monta na página no tempo ocioso. O canvas tem a resolução da arte (um pixel do canvas = um pixel da arte) e o CSS amplia em px inteiros do aparelho, nítido em DPR 1, 2, 2,625 e 3. O relógio é próprio (rAF com acumulador em passos fixos) e o desenho só acontece quando algum quadro troca (~10 por segundo).
- **Primeira tela do celular**: nada da montagem lê a geometria da página (ler no meio da montagem obriga o navegador a calcular a página inteira mais de uma vez). As medidas do story vêm do `ResizeObserver`; a entrada do produto (o GSAP do palco) e a conferência do teclado virtual vão para o quadro seguinte, antes da pintura; a faixa dos @, a paralaxe do próximo produto e o adesivo do topo ligam a rolagem quando a página respira (`quandoRespirar`, em `src/lib/movimento.ts`); a lateral e as setas dos destaques não medem nada no celular; a arte com prioridade entra na fila no quadro seguinte (a revelação começa vazia de qualquer jeito). Medido em 390×844 com a CPU 4× mais lenta e 4G lenta: o story pintado em ~2,6 s, mais cedo que com a rua no story e que o topo de 08/10 (os números estão em PENDENCIAS, "Desempenho com a rua no fim do Início").
- **Código**: `src/componentes/RuaInicio.tsx` (a vaga, no pedaço principal: `RuaInicio` no hero do computador e `RuaCelular` no fim do Início do celular), `src/componentes/rua/` — `Rua.tsx` (canvas, balões, botões), `motor.ts` (relógio, atores, desenho), `roteiro.ts` (o diretor, a vida do mercador e os quatro atos), `palco.ts` (geometria: altura 92, faixas do chão, onde ficam poste, porta e pontos), `falas.ts`, `pacote.ts` / `montar.ts` / `elenco.worker.ts` (montagem das folhas). Prints quadro a quadro: abra com `?ruaquadros=<semente>` — o relógio para e `window.__rua.avancar(ms)` anda na mão, com a mesma rua para a mesma semente.

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
  - **celular**: a barra de baixo passa a ter 6 células — Início, Mercado, **Rateio** (a caixa de importação com a fita e o corte tracejado; cheia na aba atual), Teste minha sorte, Sacola, Por estado. O selo branco na caixa é quantos rateios dá pra entrar agora no estado (os contadores da barra e da lateral usam o 2 e o 5 redesenhados de `digitos.css`, carregado com o CSS principal: na Pixelify "2" lia "Z"/"a" e "55" lia "SS"). Num estado sem entrega (ex.: `?uf=ba`) o Rateio sai da barra, como a Sorte.
  - **computador**: item "Rateio" na lateral, logo depois de Mercado, com o mesmo número.
  - **Início**: destaque "Rateio" logo depois de Buscar, também no celular (anel aceso enquanto tem rateio aberto pro estado; selo "novo" até a pessoa ver os abertos na aba). As bolinhas ficam no tamanho de sempre; com as 5 abas, o "Tudo" deixa de caber inteiro na primeira tela do celular, e o primeiro destaque que não cabe espia na borda (ver "Destaques do Início", acima; as medidas estão em `Catalogo.css`).
- **Link de um rateio** (para o adesivo de link dos stories): `https://oprojeto.online/greencheese/?uf=mg&rateio=arizona-green-tea` — abre a página do rateio depois do +18, por cima da aba Rateio (fechar mostra os outros rateios; voltar de novo sai do site, como todo link direto). O botão de compartilhar da página copia esse link. O id de cada rateio aparece no painel.

**A aba**: título com o "?" (abre a folha **Como funciona**: entra com nome e WhatsApp; a vaga fica guardada por `reservaHoras` enquanto fecha o pagamento no WhatsApp; o contador mostra as vagas pagas; o pedido do rateio é feito depois que fecham as vagas; "Previsão: de `previsaoMin` a `previsaoMax` dias depois que fechar", que pode mudar; por que sai mais barato (sem prometer preço de depois: o cartão mostra o "quando chegar" quando o rateio tem); e se não lotar, a loja chama no WhatsApp pra combinar). Embaixo, as seções **Minhas vagas** (só com vaga neste aparelho), **Abertos** (os do estado primeiro; os de outro estado por último, apagados, com "Só pra MG, SP…"), **Em andamento** (fechou, pedido feito, a caminho, chegou, com a linha do tempo e a previsão em datas) e **Chegaram** (entregues nos últimos 15 dias). Sem nenhum: "Nenhum rateio aberto agora", com o mercador e "Fica de olho no @…" do estado.

**O cartão** é um post do perfil: avatar, @ do estado e "Rateio · vale pra RJ, MG…" no lugar da localização. A mídia é um story:
- as barrinhas do topo são a linha do tempo (lotar → pedido feito → a caminho → chegou; a 1ª enche com as vagas pagas);
- o selo do status em pixel (ABERTO com o ponto piscando, FECHOU, PEDIDO FEITO, A CAMINHO, CHEGOU, ENTREGUE; aberto com o prazo vencido e vaga sobrando: TEMPO ACABOU, sem piscar);
- o produto flutuando no preto: a arte do produto do `produtoId` (ilustração ou foto, com o halo); a imagem enviada pelo painel tem prioridade, com o mesmo tratamento; sem nenhum dos dois, a caixa de importação em pixel;
- o preço do rateio grande ("R$ 14,90 no rateio"), "R$ 19,90 quando chegar" e o adesivo "economiza R$ 5,00" (só quando o rateio tem `precoDepois`);
- o **contador** no adesivo de controle deslizante: "8/10 vagas", um bloco por vaga (preto = paga, xadrez = reservada esperando o pagamento, cinza = livre; acima de 30 vagas, 30 degraus arredondados pra baixo, mas 1 vaga paga já acende 1 degrau e 99/100 nunca enche a barra) e "+2 reservadas" ao lado. Conta só as pagas: sobe quando a loja confirma o pagamento no painel (e, quando o Pix no site existir, sozinho pelo webhook);
- a entrada no adesivo "Adicione o seu": "Entrar no rateio · sobram 7 vagas" (a API conta vagas, não pessoas: "N participando" depende de um campo novo, ver PENDENCIAS). Já dentro: "Tu tá nesse rateio · Código RAT-K8EA", que fica mesmo quando não dá mais pra entrar. Sem entrada possível: "Vagas tomadas: esperando os pagamentos" (todas pagas ou reservadas; uma reserva que vence devolve a vaga) ou "O prazo pra entrar acabou".
Na legenda, a previsão ("Previsão: de 6 a 10 dias depois que fechar."; depois de fechar, "Previsão de chegada: entre 14/10 e 18/10."; é previsão, nunca prazo), o prazo ("Fecha dia 12/10 ou quando lotar."; vencido: "O prazo pra entrar acabou dia 07/10.") e os estados. O número de "Abertos" na aba é o de rateios em que dá pra entrar agora (o mesmo do selo da barra).

**A página do rateio** (camada `?rateio=<id>`, no molde da página do produto: tela cheia no celular, diálogo no computador, 2 colunas a partir de 600 px; voltar do Android, Esc e o botão do topo fecham): o cartão grande, a descrição, o como funciona resumido (+ "Como funciona o rateio") e **Entrar no rateio**: nome, WhatsApp (mesma máscara e validação da conta), estado (os do rateio, o atual marcado), cidade quando o estado ainda não tem cidade cadastrada, quantidade (1 até `limitePorPessoa`, sem passar das vagas que sobram) e o total ao vivo. Nome e WhatsApp vêm preenchidos da conta do Teste minha sorte (ou da última vaga do dono do aparelho). Quem já tem vaga vê "Tua vaga" (a do WhatsApp do dono) e, enquanto sobra vaga, **Entrar com outro WhatsApp** (pra um amigo): essa vaga fica marcada, aparece em Minhas vagas, mas não preenche o formulário dos próximos rateios nem vira "Tua vaga". Sem vaga sobrando, a quantidade diz "Vagas tomadas" e o envio trava (nunca "Só sobrou 1 vaga"). Tem um campo "site" escondido de gente e de leitor de tela (armadilha pra robô) e a linha "Teu nome e WhatsApp servem só pra loja confirmar tua vaga."

"Reservar minha vaga" → `POST rateio-entrar` → **Tá no rateio!**: comemoração curta em pixel, o código RAT-XXXX (com "Copiar"), "tua vaga fica guardada até 18h de amanhã", a mensagem, **Fechar pagamento no WhatsApp** (o WhatsApp da loja, `config.whatsappPedidos`; link montado antes do toque, sem nova aba no celular) e **Pagar com Pix aqui no site** com o carimbo EM BREVE (explica que o Pix no site chega em breve e aí a vaga confirma sozinha; o foco volta pro WhatsApp). Com várias vagas, "tuas vagas ficam guardadas até…". Cada erro do servidor vira uma frase curta com caminho, e o foco vai pro alerta (ou pro botão dele), nunca solto na página: sem vagas (mostra quantas sobraram e ajusta a quantidade), limite por pessoa, esse WhatsApp já está no rateio (com o código, "Ver minhas vagas" e "Falar com a loja", que manda só o código: a quantidade e o total quem confere é a loja), fora do estado (com os estados que o servidor mandou; a lista é recarregada), rateio fechado, `invalido` sem campo do formulário (a frase do servidor, ex.: a armadilha), muitas tentativas, erro do servidor. Na página, aberto com o prazo vencido diz "O prazo pra entrar acabou dia 07/10." (não "as vagas foram todas pegas", que é só quando não sobra vaga).

**Resposta que se perde** (3G, hospedagem lenta): o `POST rateio-entrar` espera até 20 s ("Reservando…"; depois de 5 s, "Tá demorando: a conexão tá lenta. Segura aí."). Antes de enviar, o aparelho gera um `token` (32 hex) e guarda a entrada como pendente (`gc-rateio`); sem resposta, a tela diz que a vaga pode ter ficado guardada e oferece **Tentar de novo** com o MESMO token — nada de "Entrar pelo WhatsApp" sem código de cara. O `token` é um acréscimo compatível do `API.md`: o servidor guarda o hash dele no lugar de gerar um, e o mesmo token no mesmo rateio devolve a MESMA participação (200), sem criar outra. Então a nova tentativa sai no "Tá no rateio!" de sempre, e a vaga aparece em Minhas vagas com o status. Servidor que ainda não conheça o campo responde `ja-participa` com o código: o site pergunta ao `minhas-vagas` pelo token e, sem achar, mostra "Tua vaga ficou guardada (código RAT-…), mas a resposta da loja se perdeu no caminho" com **Falar com a loja** (manda só o código: a quantidade e o total quem confere é a loja), e a lista recarrega (o contador conta a vaga). Duas tentativas sem resposta: o WhatsApp aparece como segunda opção ("se a vaga já tiver ficado guardada, a loja acha ela pelo teu número"). As "Minhas vagas" também perguntam pelos tokens pendentes: se o servidor gravou, a vaga aparece sozinha.

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

**O código** (RAT-XXXX) tem fonte própria, `GC Codigo` (grade 5×7 em pixel, `scripts/gerar-codigo.mjs` → `src/componentes/rateio/codigo.css`): na Pixelify o 2 e o Z trocavam de cara e B, G e 6 se confundiam, e o código é lido, anotado e ditado pra loja. Os códigos do Teste minha sorte (SORTE-XXXX) usam a mesma fonte (na Pixelify o C fechava e "SORTE-GATC" lia "SORTE-GATO"): `src/lib/fonte-codigo.ts` põe ela na página só com o jogo, a Minha conta e a sacola.

**Minhas vagas**: o token de cada vaga fica neste aparelho (`gc-rateio` no localStorage, até 20) e a aba pergunta o status ao servidor (`GET minhas-vagas`) ao abrir e a cada 3 min, com a aba à vista, a página em primeiro plano e alguma vaga que ainda pode mudar (reservada, ou paga com o rateio andando); nunca mais de 1 vez por minuto, e com `muitas-tentativas` espera o tempo que o servidor mandar (a F8 limita essa rota a 120 por hora por IP). A lista dos rateios se atualiza a cada minuto (o contador sobe sozinho). Cada vaga mostra o código, as vagas, o total e o status: "Esperando pagamento · guardada até 18h de amanhã" ("guardadas", com várias) (com "Pagar no WhatsApp"), "Confirmada ✅", "Venceu — a vaga voltou" (com "Entrar de novo" se ainda tem vaga), "Cancelada", "Entregue", e o andamento do rateio (fechou, pedido feito, a caminho, chegou, cancelado).

**Sem servidor aqui** (o arquivo único da prévia, a página aberta do disco, o zip sem a pasta `api/` — 404 ou HTML no lugar de JSON —, `npm run dev` sem PHP): a aba mostra os rateios de exemplo de `src/dados/rateios-exemplo.json` (só com `dadosDeExemplo`), com o contador em 0, e o formulário vira **Entrar pelo WhatsApp** (sem código; "A loja confirma tua vaga pelo WhatsApp."). Nenhum erro vermelho na tela, nada trava.

**Servidor fora do ar** (a lista não chega em ~4 s, rede caída, 403/5xx da hospedagem) numa visita sem lista: **nunca** os exemplos no lugar dos rateios de verdade. A aba diz "Sem conexão com a loja agora" com **Entrar pelo WhatsApp** (o WhatsApp da loja com "Quero entrar num rateio. Quais estão abertos?") e **Tentar de novo** (e tenta sozinha a cada minuto); a busca segue até 8 s e, se a lista chegar, entra no lugar do aviso. A página de um rateio diz "Não deu pra abrir esse rateio agora", com **Entrar pelo WhatsApp** (a mensagem leva o link do rateio), **Tentar de novo** e **Ver os rateios** — também quando o rateio não está na lista e o `GET rateio` falha por tempo, rede ou 5xx (só `nao-encontrado` vira "Esse rateio não tá mais no ar"). Se a lista já tinha chegado nesta visita, ela fica. Um aparelho que já falou com o servidor (`servidorVisto` em `gc-rateio`) trata até 404/HTML como fora do ar.

**Rateios de exemplo**: `src/dados/rateios-exemplo.json`, no mesmo formato da API (Arizona Green Tea 680 ml e Dichavador de metal 4 partes 55 mm, `demo: true`, contadores em 0). Somem com `dadosDeExemplo: false` (os do servidor marcados `demo` também). Os rateios de verdade são criados no painel do dono. Eles só aparecem quando não tem servidor nenhum (arquivo único, página do disco, zip sem `api/`): servidor que responde em JSON, mesmo com erro ou resposta torta, nunca troca os de verdade pelos de exemplo. Como eles aparecem sem carimbo, `scripts/publicar.mjs` não publica sem a `api/` do servidor (`dist/api/index.php`, ou a api já respondendo no destino): `RATEIO_SEM_API=1` força. O que acontece se o site for ao ar sem a `api/`: PENDENCIAS, Rateio, item 15.

**Rapidez**: na primeira tela só entra o que a barra, a lateral e o destaque precisam (a lista de rateios, buscada no tempo ocioso depois da abertura). A aba, o cartão, a página, o formulário e o CSS do rateio baixam à parte, no tempo ocioso ou na primeira visita (o CSS entra como `<style>`, como o do Teste minha sorte).

**Código**: `src/lib/rateio-api.ts` (o contrato e a lista), `src/lib/rateio-vagas.ts` (entrar, rateio avulso, minhas vagas), `src/lib/minhas-vagas.ts`, `src/store/rateio.ts` (lista em memória e as vagas do aparelho), `src/componentes/rateio/` (`VistaRateio`, `CartaoRateio`, `PaginaRateio`, `EntrarRateio`, `ComoFunciona`, `util.ts`, `Rateio.css` + `estilo.ts`). Ícones: `caixa` e `caixa-cheia` em `src/arte/pixel/abas.ts`, `interrogacao` em `src/arte/pixel/extras.ts`.

**Testado contra o PHP de verdade** (o servidor da frente F8, `php -S` com o roteador de desenvolvimento e um proxy no lugar do Vite): lista, entrar (código e mensagem), `ja-participa` de outro aparelho, resposta perdida, armadilha, fora do estado com a lista velha, confirmar no painel → "Confirmada ✅" e o contador 2/24. Com o `token` do aparelho (o código da F8 em andamento): a resposta cortada depois de o PHP gravar → "Tentar de novo" → a mesma vaga (201 e depois 200, uma participação só); e as repetições automáticas do navegador, quando a conexão cai sem resposta, também voltam a mesma vaga.

**Testes**: `scripts/revisao.mjs` tem a rodada do rateio com a API simulada no formato do `API.md`: aba, cartão com o contador, "?" (que rola pelo teclado em 320×568), formulário, confirmação com a mensagem certa (o botão do WhatsApp cabe em 320), Pix em breve, Minhas vagas, sem servidor, resposta perdida (servidor que guarda o token devolve a mesma vaga; o que ignora dá `ja-participa` sem vaga inventada), fora do ar, lento e JSON torto (nunca exemplo), rateio fora da lista com o `GET rateio` falhando, a vaga pro amigo, sem vaga sobrando, as setas do estado e o selo da lateral. `scripts/celulares.mjs` abre a aba e a página em cada celular (rolagem lateral, alvos de 44 px, voltar) e confere a linha de destaques do Início (as abas inteiras e o primeiro destaque que não cabe espiando). Nas outras rodadas a API responde como "sem servidor".

---

## Onde trocar cada coisa

Tudo que o dono muda fica em `src/dados/`. Depois de mexer, rode `npm run build` e suba de novo. Com o painel instalado, produtos, estados, stories, textos e prêmios mudam pelo painel (ver “Loja no painel”); o que está aqui vira a semente de um banco novo (`node scripts/gerar-semente-loja.mjs` depois de mexer) e o que o site mostra embutido.

### WhatsApp dos pedidos — `src/dados/config.ts`

Todo pedido e toda encomenda fecham no mesmo WhatsApp da loja, `whatsappPedidos` (55 + DDD + número, só dígitos). Hoje: `'5533991139036'` = (33) 99113-9036 (o dono passou "33 9113-9036"; celular tem 9 dígitos, então entra o 9 na frente).

```ts
whatsappPedidos: '5533991139036',
```

O WhatsApp só aparece no **último passo do pedido guiado**, com o pedido completo: "Fechar pedido no WhatsApp" (ou "Fechar encomenda no WhatsApp") abre a conversa com a mensagem pronta e a loja fecha no x1. Embaixo fica "Pagar com Pix aqui no site" com o carimbo **EM BREVE**: tocar não sai do site, a loja responde que o Pix chega em breve e o foco volta para o botão do WhatsApp. Se o pagamento escolhido não for Pix, a loja oferece "Trocar pra Pix" (muda o pagamento ali mesmo, sem refazer os passos) e só depois devolve o foco ao WhatsApp, pra ninguém mandar o pedido no cartão achando que vai pagar no Pix. Se o WhatsApp não abrir, o chat mostra o número e o "Copiar texto".

Dúvida que o site não tira vai para a **DM do Instagram do estado** (`instagram` em `canais.ts`): link no começo do pedido guiado ("Outra dúvida? Chama a @… no Instagram"), quadro "Dúvidas" do destaque do estado e o rodapé ("Outra dúvida? Chama a @… na DM", com o estado escolhido ou palpitado). "Avisar quando chegar" também vai pra DM do estado (copia a mensagem e abre a DM).

Um estado com WhatsApp próprio: em `src/dados/canais.ts`, troque o `whatsapp: null` dele pelo número (`whatsapp: '5521999998888'`); `null` = usa o da loja.

### Cidades, horário, taxa e pagamento — `src/dados/canais.ts`

No arquivo de canais: cidades atendidas (`cidades`), horário (`horario`), taxa de entrega (`taxaEntrega`), formas de pagamento (`pagamento`) e o "Sextou com entrega grátis!" de MG (`entregaGratis`: o texto só aparece no dia da semana dele, no Início, no perfil, no Por estado e no destaque; nos outros dias sai "Entrega grátis às sextas."). Em `perfisAConfirmar` ficam os perfis vistos em marcações de clientes que ainda não foram confirmados (hoje o @greencheese_importsvv): eles não aparecem em nenhuma tela pública (faixa, rodapé, Por estado); quando um for confirmado, vira um estado em `canais`. Quando trocar um valor de demonstração pelo real, mude também `demo: true` para `demo: false`.

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
- O 2 e o 5 vêm de uma fonte mínima (`src/interativos/sorte/digitos.css`, gerada por `node scripts/gerar-digitos.mjs`, no CSS principal): na Pixelify o 5 parece S e o 2 parece Z ("15% OFF" lia "1S% OFF", "R$ 159,89" lia "R$ 1S9,89"). Ela fica na frente da Pixelify na própria variável `--pixel` (`src/estilos/base.css`), então todo preço, quantidade e contador em pixel usa o 2 e o 5 redesenhados. O site também desliga as ligaduras (na Pixelify o "fi" virava um glifo que lê "A": "a confirmar" saía "a conArmar").
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
- Estado do cliente nesta ordem: link da bio (`?uf=`), escolha salva, palpite pelo IP (sempre pergunta "Tu tá em …?"), escolha manual com os 27 estados. A pergunta do palpite aparece na abertura; se a pessoa pular, no celular ela fica no pé do story do Início, no lugar do "Enviar mensagem…" (que volta depois da resposta), e nas outras abas logo acima da barra.
- Quatro abas (Início, Mercado, Rateio, Por estado), com barra de abas no celular e barra lateral no computador; o voltar do Android passa pelas abas (ver "Abas e Início").
- Início vivo: no celular, a rua da loja fecha o Início, depois da grade; no computador, ela fica embaixo do perfil (ver "Início vivo e Mercado").
- Mercado por estado com disponível/indisponível, categorias como destaques, busca, "Só DISPONÍVEL ✅" (no Início, a mesma grade logo depois do perfil, com os destaques que levam às abas primeiro e as categorias à direita).
- Story do topo (hero): passa sozinho; toque nas bordas ou arrastar de lado passa e volta; no computador, setas ao lado do story e ← →. Na primeira visita, uma dica mostra onde tocar.
- Página do produto ("aba"): tocar no produto do story ou em "VER PRODUTO" abre a página com descrição curta, preço, disponibilidade no estado, formato e combos, quantidade, "Pôr na sacola" (o mesmo nome do story), "Pedir este item" e "Combina com". Voltar pelo botão do topo, pelo voltar do Android ou Esc. Cada produto tem link próprio (`?produto=<id>`), que abre direto depois do +18 (segurar o dedo ou Ctrl+clique abre em aba nova). No story do produto, "Mais opções" → "Ver detalhes do produto".
- Story do produto com barrinhas, toque nas laterais, segurar para pausar, arrastar para baixo para fechar, setas e Esc no teclado.
- Sacola com combo automático, pedido guiado em formato de DM (CEP preenche o endereço) e, no fim, "Fechar pedido no WhatsApp" com a mensagem pronta pro WhatsApp da loja. "Pagar com Pix aqui no site" fica marcado EM BREVE (a loja responde no chat e devolve pro WhatsApp).
- Encomenda ("Não achou? A Green Cheese importa.", fecha no mesmo WhatsApp), "Avisar quando chegar" (DM do Instagram do estado), todos os Instagrams.
- Dúvidas: o pedido guiado, o destaque do estado e o rodapé mandam pra DM/Instagram do estado; o WhatsApp fica só pro fechamento.
- "Segue o perfil do teu estado": mapa do Brasil em pixel (atendidos acesos, os outros em pontinhos apagados) com uma lupa no Sudeste + SC, onde cada estado atendido é um botão (a sigla do estado do cliente vira o adesivo de localização em miniatura: pino + "MG"); tocar num estado sem atendimento mostra "ainda não chegou" com Encomendar (fecha no X, no Esc ou tocando fora). Ao lado, a lista dos perfis no molde do "trocar de conta" do Instagram (na ordem do mapa, de cima pra baixo): tocar troca o site de estado. Mapa e lista ficam lado a lado quando a própria seção tem 910 px ou mais (container query; a coluna do mapa precisa caber o Brasil com a lupa); mais estreito, a lista vai embaixo. O tamanho das células e o lugar da lupa saem de `planejar()` em `MapaBrasil.tsx` (sempre em escala inteira, sem passar da largura da coluna nem da altura da tela).
- Sacola e respostas ficam salvas no aparelho; o botão voltar do Android fecha a camada aberta.
- **Rateio**: compra junto de produto importado, com vagas, código RAT-XXXX e pagamento fechado no WhatsApp da loja (ver "Rateio (site)").
- **Teste minha sorte** (célula da barra no celular, destaque "Sorte" no Início e no Mercado, item na lateral, card no fim do Mercado, convite discreto na sacola): gira a tampa do dichavador com o dedo (ou o botão "Girar", as setas, Espaço/Enter segurado, a roda do mouse); ele abre e, lá dentro, tem um story dos Melhores amigos só pra pessoa, com o prêmio. O 1º giro é sem conta; pra guardar e usar o cupom, cria conta com nome e WhatsApp. Com conta: 1 giro por dia, cupons em "Minha conta" e o nome já no pedido. O cupom aplicado vira uma linha na mensagem do WhatsApp; a loja confirma o desconto (o subtotal do site não muda).

Derivados do tabaco não entram no site (Anvisa, RDC 840/2023, art. 6º).

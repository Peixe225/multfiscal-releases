# LENDA na live do TikTok

O chat comanda o Modo Clássico. Cada decisão da carreira (proposta de clube, empréstimo, evento, pênalti decisivo) vira uma votação. O público vota comentando o número da opção ou mandando o presente ligado a ela: 🌹 Rosa no 1, 🎵 TikTok no 2, 🎮 GG no 3 e 🍦 Sorvete no 4.

Antes de cada carreira abre uma **disputa**: quem doar mais nos próximos segundos cria a nova lenda, digitando no chat o nome, a nacionalidade e a posição do jogador.

```
TikTok LIVE ──► ponte (seu PC) ──► jogo ─┬─► OBS (fonte Navegador) ───────────────────► sua live
             comentários, presentes,     └─► janela do Chrome/Edge ──► LIVE Studio ───► sua live
             curtidas, seguidores
```

## Do que você precisa

- Um PC com Windows. Mac e Linux também funcionam, pelo terminal (sem os `.bat`).
- **Node.js 22 ou mais novo.** Baixe a versão **LTS** em https://nodejs.org e instale com as opções padrão.
- **Google Chrome** ou **Microsoft Edge**: o painel da live abre neles.
- Um programa para transmitir do PC (veja [Dois jeitos de transmitir](#dois-jeitos-de-transmitir)):
  - o **OBS Studio** (grátis, versão 30 ou mais nova), se a sua conta tem **chave de transmissão**;
  - ou o **TikTok LIVE Studio**, o programa do próprio TikTok.
- Acesso à LIVE no TikTok. As regras do TikTok pedem "pelo menos 18 anos para iniciar LIVE" e "1.000 seguidores para iniciar LIVE (pode variar conforme a região)".

## Instalar (uma vez só)

1. Baixe o LENDA.
   - Pelo site: abra https://github.com/Peixe225/multfiscal-releases, troque para a branch `claude/football-simulation-game-xhgk2n`, clique em **Code → Download ZIP** e extraia o ZIP numa pasta sua (por exemplo, `Documentos\LENDA`).
   - Ou, com git: `git clone https://github.com/Peixe225/multfiscal-releases` e depois `git checkout claude/football-simulation-game-xhgk2n`.
2. Pronto. O `INICIAR-LIVE.bat` (ou o `LIVE-OBS.bat`) instala o resto sozinho na primeira vez. Ele precisa de internet e leva alguns minutos.
   - No Mac ou no Linux, abra um terminal na pasta `lenda` e rode `npm install`.

**Para atualizar:** baixe a versão nova e copie os arquivos **por cima** da pasta antiga, sem apagar a pasta. O `.bat` percebe a mudança, instala o que faltar e recompila o jogo sozinho. Pelo terminal, rode `npm install` depois de cada atualização.

> Suas configurações, carreiras e o Hall das Lendas da live ficam guardados dentro da pasta do LENDA, em `lenda\.cache\janela-live`. Apagar a pasta apaga tudo isso. Com o OBS é um pouco diferente: veja *Onde ficam as carreiras*, em [Transmitir com OBS](#transmitir-com-obs-recomendado).

## Dois jeitos de transmitir

Os dois usam a mesma ponte e o mesmo painel. Muda só por onde a imagem do jogo sai do seu PC.

| | **OBS** (recomendado) | **TikTok LIVE Studio** |
|---|---|---|
| Precisa de | chave de transmissão do TikTok (nem toda conta tem) | acesso à LIVE pelo LIVE Studio |
| Como o jogo entra na live | fonte **Navegador** dentro do OBS | **Captura de janela** da janela da live (Chrome/Edge) |
| Imagem | nítida: o jogo é desenhado em 1080×1920 | a janela de 540×960 é ampliada |
| Abrir | `INSTALAR-OBS.bat` (uma vez) e `LIVE-OBS.bat` | `INICIAR-LIVE.bat` |
| Cuidado | a chave é segredo e pode mudar: copie de novo em toda live | não minimize a janela da live |

Depois que o jogo está pronto na live, os passos são os mesmos: veja [Durante a live](#durante-a-live-vale-para-os-dois-jeitos).

## Transmitir com OBS (recomendado)

O **OBS Studio** é grátis. O kit do LENDA (pasta `lenda\live\obs`) já traz o perfil em pé, a cena com o jogo e o som, e o `LIVE-OBS.bat` abre tudo na ordem certa.

### A chave de transmissão: quem tem e onde pegar

O OBS manda a imagem para o TikTok usando um **URL do servidor** (*Server URL*) e uma **chave de transmissão** (*Stream Key*). O OBS não tem o TikTok na lista de serviços, por isso o kit usa o serviço **Personalizado**.

- **Quem tem:** o TikTok não publica a regra. A chave aparece para contas que já podem fazer LIVE (18 anos ou mais, por volta de 1.000 seguidores, conta sem restrições), mas não para todas. Há relatos, em 2026, de contas que só conseguem a chave por meio de agências. Se a página abaixo não mostrar o URL do servidor e a chave, a sua conta ainda não tem: use o [LIVE Studio](#com-o-tiktok-live-studio).
- **Onde pegar:**
  1. No computador, entre em tiktok.com com a sua conta e clique em **LIVE** (*Go LIVE*) na barra da esquerda. Abre o **LIVE Producer** (`livecenter.tiktok.com/producer`).
  2. Escreva o título, escolha o tema e salve (*Save & Go LIVE*).
  3. O **URL do servidor** e a **chave de transmissão** aparecem na página (às vezes em *Stream Settings*), com botões de copiar. Deixe a página aberta.

  O TikTok não tem um guia oficial dessa página, e os nomes dos botões podem variar.
- **Ela muda?** Não há confirmação oficial. Uns dizem que muda a cada live, outros que muda quando você sai da conta. Trate a chave como de uma live só e copie de novo em toda live. O `LIVE-OBS.bat` pergunta toda vez (só Enter repete a última) e, quando a chave traz a validade escrita, avisa se ela já venceu.
- **É segredo:** quem tem a chave transmite na sua conta. Nunca mostre a chave na live nem mande para ninguém. O `LIVE-OBS.bat` grava a chave só no próprio OBS (no perfil **LENDA**, como se você tivesse colado em *Configurações → Transmissão*) e nunca mostra a chave inteira.

### Preparar o OBS (uma vez só)

1. Instale o **OBS Studio** 30 ou mais novo: https://obsproject.com/pt-br/download.
2. **Abra o OBS uma vez e feche** (*Arquivo → Encerrar OBS*). Se ele oferecer o assistente de configuração, pode cancelar: o perfil do LENDA traz as configurações certas.
3. Dê dois cliques em `lenda\live\INSTALAR-OBS.bat`. Ele:
   - acha o OBS. Se não achar, pede para você arrastar para a janela o `obs64.exe` ou o atalho do OBS da Área de Trabalho;
   - pede para fechar o OBS, se ele estiver aberto (o OBS regrava as configurações quando fecha);
   - põe no OBS o perfil **LENDA** e a coleção de cenas **LENDA Live**. Se eles já existirem, pergunta antes e guarda uma cópia do que havia em `%APPDATA%\obs-studio\lenda-copias`.

O que vem pronto:

- **Cena LENDA Live:** a fonte **Navegador** "Jogo LENDA" (`http://localhost:5178/obs`, 1080×1920) ocupando a tela toda. Ela vem travada (cadeado) para não sair do lugar sem querer. O som do jogo vai para a live (**Controlar áudio via OBS**) e para os seus fones (monitoramento ligado).
- **Cena Intervalo:** fundo escuro com "INTERVALO — Já voltamos!", para pausas curtas. O jogo continua por baixo, coberto (assim o OBS não deixa o jogo em segundo plano).
- **Microfone:** o padrão do Windows (**Mic/Aux** no *Mixer de áudio*).
- **Perfil LENDA:** tela em pé, transmissão em 720×1280 a 30 quadros por segundo. Veja *Configurações do perfil LENDA*, abaixo.

Rodar o `INSTALAR-OBS.bat` de novo volta tudo ao original, com cópia do que você tinha mudado. O URL do servidor e a chave salvos continuam no perfil.

### Em cada live com o OBS

1. **Abra a página de transmissão do TikTok** (veja *Onde pegar*, acima) e deixe o URL do servidor e a chave à vista.
2. **Dê dois cliques em `lenda\live\LIVE-OBS.bat`.** Ele:
   - pede para fechar o OBS, se ele estiver aberto (daqui a pouco ele abre de novo, do jeito certo);
   - pergunta o seu @, igual ao do link do perfil. A ponte já conecta nele;
   - pede o **URL do servidor** e a **chave de transmissão**. Cole com `Ctrl+V` ou com o botão direito do mouse e aperte Enter. Só Enter repete os da última live. A chave some da tela depois do Enter;
   - pergunta se o OBS deve **começar a transmitir sozinho** quando abrir;
   - abre a ponte numa janela preta própria, **LENDA - Live interativa** (deixe aberta durante toda a live). Ela abre o **painel da live** no Chrome/Edge;
   - espera a ponte ficar pronta (na primeira vez ela instala e compila o jogo, o que leva alguns minutos) e só então abre o OBS no perfil **LENDA**, na cena **LENDA Live**.
3. **Confira.** No OBS, a cena mostra **"A live já vai começar!"**, e o painel mostra **Live pronta no OBS**.
   - **Não** clique em **Abrir janela da live (9:16)**: com o OBS, a live roda dentro do OBS.
   - Para aparecer na câmera, veja *Câmera, microfone e intervalo*, abaixo.
4. **Transmita.** Se o OBS não começou sozinho, clique em **Iniciar transmissão**. Na página do TikTok, espere a prévia aparecer e, se a página pedir, clique para entrar ao vivo.
5. **Siga em [Durante a live](#durante-a-live-vale-para-os-dois-jeitos).** O @ já vem conectado, e o painel comanda a live do OBS.
6. **Para terminar:** clique em **Parar** no painel, encerre a LIVE no TikTok e só então clique em **Interromper transmissão** no OBS. Depois feche a janela da ponte.

> **Testar antes, sem transmitir:** abra o Prompt de Comando na pasta `lenda\live` e rode `LIVE-OBS.bat --demo`. O OBS abre sem pedir a chave, com o público de demonstração da ponte (veja [Testar sem estar ao vivo](#testar-sem-estar-ao-vivo)).

> **Onde ficam as carreiras:** com o OBS, o jogo roda dentro do OBS. As carreiras e o Hall das Lendas dessas lives ficam no navegador do próprio OBS (na pasta de configurações do OBS), separados dos da janela do Chrome/Edge. Com a live pronta no OBS, o botão **Continuar NOME** do painel é o da carreira salva no OBS. As configurações da live (como votar, presentes, carreira automática) e o @ vão do painel para o OBS pela ponte.

### Configurações do perfil LENDA

| No OBS, em Configurações | No perfil LENDA | Quando mudar |
|---|---|---|
| Vídeo → Resolução base (área de edição) | 1080×1920 | Não mude: a fonte do jogo tem esse tamanho. |
| Vídeo → Resolução de saída (escala) | 720×1280 | PC forte e upload de 8 Mbps ou mais: 1080×1920, com taxa de bits 5000. |
| Vídeo → FPS | 30 | Não precisa: 60 gasta mais internet e quase não melhora no celular. |
| Saída → Codificador de vídeo | Software (x264), predefinição veryfast | Processador no limite ("Codificação sobrecarregada!"): use o de hardware, abaixo. |
| Saída → Taxa de bits do vídeo | 3000 kbps (CBR) | Internet fraca ou quadros perdidos: 2500. |
| Saída → Configurações de codificador personalizadas | `keyint=60` (um quadro-chave a cada 2 segundos) | Não mude. |
| Saída → Taxa de bits do áudio | 128 | — |
| Áudio → Taxa de amostragem | 48 kHz, estéreo | — |

- O TikTok recomenda 720p e 30 FPS para a maioria das lives, porque quase todo o público assiste no celular.
- Use uma internet com pelo menos 5 Mbps de **upload**. Cabo é melhor que Wi-Fi.
- **Codificador de hardware** (placa de vídeo NVIDIA, AMD ou Intel): alivia o processador. Em *Configurações → Saída*, troque o **Modo de saída** para **Avançado**. Na aba **Transmissão**, escolha o codificador NVENC, AMD ou QuickSync, ponha a **Taxa de bits** em 3000 e o **Intervalo de keyframes** em 2. No modo Simples não dá para escolher o intervalo, e esses codificadores mandam um quadro-chave a cada 8 segundos, mais ou menos.

### Câmera, microfone e intervalo

- **Apareça na câmera e fale com o público.** O TikTok pede o rosto à vista e trata live sem ninguém como de pouca interação. Na cena **LENDA Live**, em **Fontes**, clique em **+** → **Dispositivo de captura de vídeo**, escolha a câmera e arraste e diminua a imagem para um canto. Deixe livres a faixa do topo e as opções de voto.
- **Microfone:** o kit usa o microfone padrão do Windows (**Mic/Aux** no *Mixer de áudio*). Para trocar, clique na engrenagem dele e em **Propriedades**.
- **Som do jogo:** sai pela fonte **Jogo LENDA**. Ajuste o volume dela no *Mixer de áudio* para não cobrir a sua voz. Use fones para o som do jogo não voltar pelo microfone.
- **Intervalo:** numa pausa curta, clique em **Pausar** no painel e troque para a cena **Intervalo**. Na volta, troque para a cena **LENDA Live** e clique em **Retomar**. Pause antes: o jogo continua rodando por baixo da tela do intervalo, e sem a pausa as votações seguiriam sem o público ver. Não tire a fonte **Jogo LENDA** da cena **Intervalo** nem crie outras cenas sem ela: numa cena sem o jogo, o OBS deixa a fonte em segundo plano, os relógios do jogo atrasam e o painel pode perder a live do OBS de vista. E não fique muito tempo no intervalo: o TikTok para de recomendar lives com a tela parada.

### Problemas com o OBS

| O que aparece | O que fazer |
|---|---|
| "Não achei o OBS Studio" | Instale o OBS (https://obsproject.com/pt-br/download), ou arraste para a janela o `obs64.exe` ou o atalho do OBS e aperte Enter. O lugar fica salvo. |
| "O OBS ainda não foi aberto neste computador" | Abra o OBS uma vez, feche e rode o `INSTALAR-OBS.bat` de novo. |
| "O LENDA ainda não está instalado no OBS" | Rode o `INSTALAR-OBS.bat` uma vez. |
| "O OBS está aberto. Feche o OBS…" | *Arquivo → Encerrar OBS*. Se ele estiver só no ícone perto do relógio, clique nele com o botão direito e em **Encerrar OBS**. Depois aperte Enter na janela do `.bat`. |
| "A ponte não respondeu" | A ponte não ficou pronta. Veja o erro na janela preta da ponte (**LENDA - Live interativa**), resolva e abra o `LIVE-OBS.bat` de novo. |
| A fonte **Jogo LENDA** ficou preta ou mostra um erro | O OBS abriu antes da ponte e não tenta de novo sozinho. Com a ponte aberta, clique duas vezes em **Jogo LENDA** e em **Atualizar o cache da página atual**. Continua preta? Em *Configurações → Avançado*, desligue **Ativar a aceleração por hardware do navegador** e reabra o OBS. |
| O painel não mostra **Live pronta no OBS** (ou **Rodando no OBS**) | A ponte precisa estar aberta e o OBS na cena **LENDA Live** (ou **Intervalo**). Continua? Clique duas vezes em **Jogo LENDA** e em **Atualizar o cache da página atual**: com a live ligada, o jogo continua de onde estava. |
| A tela do OBS ficou deitada | O assistente de configuração automática do OBS troca a tela em pé do perfil LENDA por uma deitada. Feche o OBS e rode o `INSTALAR-OBS.bat` de novo. |
| O OBS abriu outras cenas | Escolha o perfil **LENDA** no menu **Perfil** e a coleção **LENDA Live** no menu **Coleção de cenas**. Para voltar às suas cenas de sempre, é pelos mesmos menus. |
| Sem som do jogo na live | Clique duas vezes em **Jogo LENDA**: **Controlar áudio via OBS** precisa estar ligado. No *Mixer de áudio*, **Jogo LENDA** não pode estar no mudo. |
| Você não ouve o jogo | No *Mixer de áudio*, na engrenagem, abra **Propriedades de áudio avançadas** e ponha o **Monitoramento de áudio** de **Jogo LENDA** em **Monitoramento ativado**. |
| "Falha ao conectar" ou "Não foi possível acessar o canal especificado ou a chave de transmissão" | A chave venceu ou é de outra live. Copie uma nova no TikTok, feche o OBS e rode o `LIVE-OBS.bat` de novo. Ou cole direto em *Configurações → Transmissão → Chave da transmissão*. |
| "Caminho ou URL inválida" | O URL do servidor está errado. Copie de novo no TikTok (ele começa com `rtmp://`). |
| "Codificação sobrecarregada!" | O processador não está dando conta: use o codificador de hardware (veja *Configurações do perfil LENDA*) ou feche outros programas. |
| "O OBS Studio não foi fechado corretamente" | Escolha **Executar no modo normal**. |
| "OBS já está em execução" | Já tem um OBS aberto. Feche um deles; não use **Executar mesmo assim**. |

## Com o TikTok LIVE Studio

Sem chave de transmissão, use o **TikTok LIVE Studio**, o programa do TikTok para transmitir do PC (https://www.tiktok.com/studio/download).

- O seu acesso aparece no canto de cima, à direita do LIVE Studio. Se faltar algum requisito, ele aparece em cinza.
- No acesso de teste, o TikTok pede pelo menos duas lives de 25 minutos na primeira semana; sem isso, o acesso é retirado.

### Em cada live com o LIVE Studio

1. **Ligue a ponte.** Dê dois cliques em `lenda\live\INICIAR-LIVE.bat`.
   - Abre uma janela preta: é a ponte. **Deixe ela aberta durante toda a live.**
   - Na primeira vez (e depois de cada atualização), ela compila o jogo. Isso leva cerca de 1 minuto.
   - Em seguida ela abre o **painel da live** numa janela própria do Chrome/Edge, em `http://localhost:5178/#/live`. A fonte já vem marcada como **TikTok (ponte do LENDA)**.
   - Essa janela usa um perfil separado do navegador, só do LENDA. Se você abrir o mesmo endereço no seu navegador de sempre, ele começa do zero (sem suas configurações nem carreiras). Use sempre a janela que a ponte abre.
   - No Mac ou no Linux, rode `npm run live -- --abrir` na pasta `lenda`.
2. **Abra a janela da live.** No topo do painel, clique em **Abrir janela da live (9:16)**.
   - Abre uma janela em pé, de 540×960, com a tela **"A live já vai começar!"**. Ela ainda não começa nada.
   - Se o navegador bloquear a janela, libere os pop-ups para `localhost`.
3. **Mostre a janela no LIVE Studio.**
   - Crie uma cena **Retrato** (vertical, 9:16).
   - Clique em **Adicionar fonte → Captura de janela** e escolha a janela em pé do LENDA. Desligue a captura do cursor.
   - Não minimize essa janela. Ela pode ficar atrás do LIVE Studio.
   - Qualidade: **720P** e **30 FPS**, o recomendado pelo TikTok para a maioria das lives. Deixe a taxa de bits no padrão e, se houver, use o codificador de hardware. Na adaptação de tela, prefira **Ajustar à tela**, que não corta as laterais.
   - Não use a fonte **Link** do LIVE Studio para o jogo: o próprio TikTok aconselha evitar fontes de navegador.
4. **Comece a live no TikTok.**
5. **Siga em [Durante a live](#durante-a-live-vale-para-os-dois-jeitos).**

> **Só uma janela?** Se você não abrir a janela da live, **Iniciar modo live** começa o jogo no próprio painel, e você captura essa janela. A janela em pé é melhor: ela tem o formato da live e respeita a área segura do TikTok.

## Durante a live (vale para os dois jeitos)

1. **Configure (só na primeira vez).** No painel, ajuste as seções *2. Como o chat vota* e *3. Carreira automática*. As configurações ficam salvas.
2. **Conecte a ponte na sua live.** No painel, em *1. Conexão*:
   - digite o seu @, igual ao do link do perfil (`tiktok.com/@seuperfil`). Maiúsculas, o `@` e um link colado são corrigidos sozinhos;
   - clique em **Conectar**.

   O indicador fica verde: "Conectado em @seuperfil". Se a live ainda não estiver no ar, a ponte tenta de novo sozinha a cada 30 segundos. Com o `LIVE-OBS.bat`, a ponte já conecta no @ que você digitou nele, e o painel abre com esse @. Se a ponte já estava aberta, o `LIVE-OBS.bat` usa a que está rodando: confira o @ no painel.
3. **Comece o jogo.** No topo do painel, clique em:
   - **Iniciar modo live**, quando não há carreira salva;
   - **Continuar NOME**, para seguir a carreira salva;
   - **Nova lenda**, para começar outra lenda (o botão diz como: disputa, maior apoiador ou chat vota).

   O jogo começa na janela da live (ou no OBS), e o topo dela vira a **faixa da live**: a votação, o relógio, o último presente, o pódio de apoiadores e o termômetro de curtidas.
4. **Fixe no chat os textos de como participar.** Em *2. Como o chat vota* há dois textos prontos: **Como votar** e **Próxima lenda**. Cada um tem no máximo 150 caracteres (o limite de um comentário no TikTok). Clique em **Copiar**, cole no chat e fixe. Faça um de cada vez.
5. **Durante a live, use o painel** (a janela de configurações) como controle remoto. Os botões do topo comandam a janela da live (ou o OBS):
   - **Pausar** e **Retomar**;
   - **Encerrar votação**, **Encerrar disputa** ou **Encerrar criação**, conforme o que estiver aberto;
   - **Nova lenda**, que pede confirmação quando há uma carreira em andamento;
   - **Parar**.

   O menu ⚙ da faixa tem os mesmos comandos.
6. **Para terminar:** clique em **Parar**. A janela da live (ou o OBS) volta para "A live já vai começar!". Encerre a live no TikTok e a transmissão no OBS ou no LIVE Studio. Depois feche a janela preta da ponte (ou aperte `Ctrl+C` nela).

## Área segura do TikTok

O app do TikTok desenha por cima da sua transmissão. No topo ficam o seu nome e o número de espectadores. Embaixo ficam o chat, os presentes e a caixa de comentário.

Com a opção **Área segura do TikTok** ligada (*5. Transmitir no TikTok*, já vem ligada), a janela da live se ajusta:

- a faixa da live começa abaixo da sobreposição do topo (cerca de 8% da altura);
- as opções e os votos ficam acima da parte de baixo (cerca de 22% da altura), que vira um fundo escuro onde o chat do TikTok fica legível;
- durante a votação, as opções aparecem em duas colunas, e o título da decisão vai para a faixa.

A área segura vale para a janela em pé (9:16) e para a fonte do OBS. Num monitor deitado nada muda.

## Como o público vota

| O que a pessoa faz | Quanto vale |
|---|---|
| Comenta `1`, `2`, `3` ou `4` (também vale `#2`, `opção 2`, `voto 2`, `vou de 2`) | 1 voto por pessoa em cada votação. Comentar outro número muda o voto. |
| Manda o presente de uma opção (padrão: Rosa = 1, TikTok = 2, GG = 3, Sorvete = 4) | Moedas × "cada moeda vale" (padrão 10). Uma rosa vale 10 votos. |
| Manda outro presente qualquer | **Vale para o número que a pessoa comentar nesta votação.** Se ela ainda não comentou, o presente fica guardado e passa a valer assim que ela comentar um número, antes do fim da votação. Se ela não comentar, o presente não conta. |
| Manda um presente acima do valor de "decide na hora" (se estiver ligado) | Encerra a votação na hora, para a opção daquela pessoa. |

- Ganha a opção com mais pontos.
- Empate nos pontos: ganha a opção com mais moedas, depois a que tem mais gente. A faixa explica: "Empate nos votos — venceu quem mandou mais moedas".
- Se o empate continuar no fim do tempo, a votação ganha **mais 10 segundos**, uma vez só. Se ainda assim empatar, há um sorteio.
- Se ninguém votar, o jogo sorteia para a live não travar.
- **Presentes em sequência** (combo) contam uma vez só: a ponte desconta as repetições que o TikTok manda durante o combo.
- Na faixa, um presente guardado aparece com o aviso **"comente 1 a 4"**. Quando a pessoa comenta, aparece "presente guardado → 2".
- Cada votação tem no máximo 4 opções. Se uma decisão tiver mais que isso, ficam "ficar no clube" e "aposentar-se" e as primeiras propostas.

Tudo isso é configurável no painel: tempo da votação, peso das moedas, presente de cada opção, comentários valendo voto ou não, presentes que seguem o comentário, prorrogação e presente que decide na hora. Cada presente só pode estar em uma opção: escolher um presente que já é de outra opção troca os dois de lugar.

## Quem cria a nova lenda

Em *3. Carreira automática*, no campo **Quem cria a nova lenda**, há três modos:

| Modo | Como funciona |
|---|---|
| **Disputa de doações** (padrão) | Abre uma disputa de 30 s (ajustável). Quem doar mais moedas nesse tempo ganha e cria a lenda. Em caso de empate, vence quem doou primeiro. O palco mostra o placar da disputa ao vivo. |
| **Maior apoiador** | Quem mais doou durante a carreira que acabou cria a próxima, sem disputa. |
| **Votação do chat** | O chat vota posição e nacionalidade, e o nome sai do maior apoiador (ou é fixo, ou aleatório). |

O criador tem 60 s (ajustável) para digitar no chat. **Só as mensagens dele contam**, e os comandos começam sempre com `!` (ou `/`):

```
!nome Gabigol
!pais Brasil           também: !país, !nacionalidade, !selecao
                       aceita "Argentina", "ARG", "eua", "Holanda", "brasileira", "England"
!posicao atacante      também: !posição, !pos
                       goleiro, zagueiro, lateral direito, lateral esquerdo, volante, meio campo,
                       meia, ponta direita, ponta esquerda, centroavante...
!criar Gabigol, Brasil, atacante    tudo de uma vez, nessa ordem: nome, país, posição
!ok                    confirma na hora
```

- Acento e dois-pontos tanto faz: `!país: Brasil` também vale.
- Sem vírgulas também funciona quando dá para entender: `!criar Gabigol Brasil atacante`.
- Uma mensagem **sem `!`** só preenche um país ou uma posição que ainda estão faltando, e só com a palavra inteira ("Brasil", "goleiro"). Conversa normal ("como?", "lenda demais") não muda nada.
- **Nome:** até 15 letras. Um nome comprido é encurtado sem cortar palavra no meio, ficando o último sobrenome: "Cristiano Ronaldo" vira RONALDO.
- **Palavrões e ofensas são recusados**, mesmo escritos com espaços, símbolos, números no lugar de letras ou siglas (FDP, VSF, PQP…). Nomes sem vogal também (CR7). O filtro é rígido e às vezes recusa um nome de verdade; aí é só escolher outro. A tela avisa: "Esse nome não pode — escolha outro".
- **Confirmação:** quando nome, país e posição estão preenchidos, a lenda nasce em cerca de **6 segundos**. Cada correção reinicia a contagem, então dá para trocar alguma coisa. `!ok` começa na hora. A tela mostra a ficha, a contagem e o retorno de cada comando ("País não reconhecido: Wakanda — tente !pais Brasil").
- **O tempo acabou e faltou algo?** O chat vota a posição e a nacionalidade que faltarem. Dá para desligar em "Chat vota o que o criador não escolher"; aí o jogo completa sozinho. Se faltar só o nome, vale o apelido do criador.
- **Ninguém doou na disputa** (ou ninguém chegou ao "Mínimo para vencer a disputa"): a faixa avisa, e o chat vota a lenda do jeito normal.
- O anúncio credita o criador: "Criada por @fulano, que venceu a disputa com 1,1 mil moedas!".

## O que acontece sozinho

- **Comemoração de título:** fica alguns segundos na tela (padrão 6) e o jogo segue.
- **Fim de carreira:** a tela final agradece aos 3 maiores apoiadores da carreira e mostra **Nova lenda agora**. Depois de 20 s (ajustável) começa a próxima lenda (no modo padrão, abre a disputa). Com 0 segundos, o jogo espera você clicar em **Nova lenda**.
- **Nome da lenda quando ninguém cria:** sai do apelido do maior apoiador, com o filtro de palavrões. Também dá para usar um nome fixo ou um aleatório.
- **Ritmo:** *Expresso* tem menos decisões por carreira e é bom para lives curtas.
- **Pausa:** congela a votação, a disputa, a criação (com a contagem de 6 s), a contagem do fim de carreira e a comemoração. A faixa mostra "Votação pausada" em amarelo.
- **Intervenção manual:** você pode clicar numa opção para escolher no lugar do chat; a votação em andamento é cancelada.
- **Recarregou a janela da live (F5) no meio?** A disputa (com os lances), a criação (com a ficha) e o anúncio continuam de onde pararam.

## Testar sem estar ao vivo

- **Simulador:** em *1. Conexão*, escolha **Simulador**. Um público de mentira comenta números, manda presentes, curte, segue e até cria a lenda. A velocidade é ajustável.
- **Demonstração da ponte:** rode `npm run live:demo` (ou `INICIAR-LIVE.bat --demo`). A ponte gera eventos no formato do TikTok e testa o caminho completo, ponte → jogo:
  - votos de 1 a 4, conversa, presentes com a lista de presentes, curtidas, seguidores e espectadores;
  - um "maior doador", @gabi.fut, que vence a disputa e digita `!criar`, `!posicao` e `!ok`.

  A faixa mostra **DEMO**. O botão Desconectar não para a demonstração; para parar, feche a ponte.
- **Demonstração no OBS:** `LIVE-OBS.bat --demo` faz o mesmo com o jogo dentro do OBS, sem pedir a chave e sem transmitir.
- **4. Testar votos:** botões para comentar e mandar presentes durante uma votação. Na disputa e na criação aparecem também botões para dar lance e digitar os comandos como o criador.
  - Com a live rodando na janela da live (ou no OBS), os botões mandam o teste para lá, e o painel lista "Enviado para a janela da live: …" (ou "Enviado para o OBS: …").
  - Numa live de verdade, um teste conta como voto, mas nunca vira apoiador nem lance da disputa.

Gente de teste (simulador ou botões) nunca entra numa live de verdade: começar a live ou trocar a fonte zera os apoiadores, e um apoiador de teste nunca dá nome nem cria a lenda.

## Usa o TikFinity?

Em *1. Conexão*, escolha **TikFinity** e informe o endereço WebSocket dele (padrão `ws://localhost:21213/`). O TikFinity precisa estar aberto e conectado na sua live. Nesse caso a ponte do LENDA só serve o jogo: abra pelo `INICIAR-LIVE.bat` normalmente, troque a fonte para TikFinity e não precisa conectar o @. O painel lembra a escolha.

## Problemas comuns

| O que aparece | O que fazer |
|---|---|
| "Nao achei o Node.js" ou "Seu Node.js e a versao…" (na janela preta) | Instale o Node.js 22 ou mais novo (versão LTS em https://nodejs.org) e abra o `.bat` de novo. |
| "Nao consegui instalar as dependencias" | Confira a internet e abra o `.bat` de novo. |
| "Faltam dependências" ou "Dependências desatualizadas" | O `.bat` resolve sozinho. Pelo terminal, rode `npm install` na pasta `lenda`. |
| "Não consegui compilar o jogo" | Veja o erro logo acima na janela preta. Se faltar dependência, rode `npm install` (ou abra o `.bat`, que instala sozinho). |
| "A porta 5178 já está em uso" | Já tem uma ponte aberta. Feche a outra janela preta ou use outra porta: `INICIAR-LIVE.bat --porta 5179`. Em outra porta o jogo acha a ponte sozinho, mas as configurações, o @ e as carreiras são outros (configure de novo). |
| "A ponte não está rodando" (no painel) | A janela preta foi fechada, ou você abriu o jogo por outro endereço. Abra pelo `.bat` e use a janela que ele abre. Pelo link do claude.ai só o simulador funciona. |
| "@seuperfil não está ao vivo agora" | Comece a live no TikTok. A ponte entra sozinha (tenta a cada 30 s). |
| "Não achei a live de @…" | Confira se o @ está igual ao do link do perfil (`tiktok.com/@seuperfil`) e se a live já começou. A ponte tenta de novo a cada 30 s e, depois de alguns minutos, a cada 1 min. |
| "Esse @ não parece um perfil do TikTok" ou "@ inválido" | Digite só o que vem depois do @ no link do perfil. |
| "O serviço gratuito que libera a conexão (Euler Stream) pediu uma pausa" | Muitas conexões seguidas. Não precisa reiniciar nada: a ponte espera e tenta de novo sozinha. Uma chave do Euler Stream (eulerstream.com), colada em *Opções avançadas*, aumenta esse limite. |
| "O serviço de conexão (Euler Stream) recusou o pedido" | Confira a chave em *Opções avançadas*, ou apague a chave para usar o plano gratuito. |
| "A conexão com a live caiu. Reconectando em…" | Nada a fazer: a ponte reconecta sozinha (5 s, 15 s, 30 s, 1 min). |
| "Sem resposta do TikTok" | Confira a internet. A ponte tenta de novo sozinha. |
| "A live terminou" | Quando você começar outra live, a ponte entra sozinha (procura a cada 30 s). |
| "Recusei uma conexão de …" (na janela preta) | Alguma página fora do seu computador tentou usar a ponte. Abra o jogo pelo endereço que a ponte mostra (`http://localhost:5178`). |
| "Não consegui abrir o navegador sozinho" | Abra no Chrome ou no Edge o endereço que a ponte mostra. |
| O navegador bloqueou a janela da live | Libere os pop-ups para `localhost` e clique de novo em **Abrir janela da live (9:16)**. |
| A janela da live congela ou some na captura | Não minimize a janela. A janela aberta pela ponte continua desenhando atrás do LIVE Studio. |
| Problemas com o OBS | Veja *Problemas com o OBS*, em [Transmitir com OBS](#transmitir-com-obs-recomendado). |
| Um presente não conta para a opção | O nome do presente pode variar por região. Conecte na live e escolha o presente pela lista real da sua sala (com preço) em *Presente de cada opção*. |
| As configurações "sumiram" | Você abriu o jogo no navegador de sempre ou em outra porta. Use a janela que a ponte abre. |
| Duas janelas do jogo abertas | Só uma roda a live. A outra vira painel: a faixa mostra "PAINEL — A live está rodando em outra janela", e o menu ⚙ dela comanda a janela da live. |
| O Windows pediu permissão no Firewall | Só versões antigas pediam. Hoje a ponte só escuta no próprio computador; pode cancelar. |

## Boas práticas e regras do TikTok

- A leitura dos eventos usa só o @ público da live, sem login nem senha.
  - A biblioteca é o [TikTok-Live-Connector](https://github.com/zerodytrash/TikTok-Live-Connector), não oficial.
  - A assinatura da conexão passa pelo Euler Stream.
  - Se um dia o TikTok mudar algo, atualizar a biblioteca com `npm update tiktok-live-connector` costuma resolver.
- A chave do Euler Stream fica escondida no painel, mas evite mostrar a página de configurações na live. O item "Configurações da live (nova aba)" do menu ⚙ abre as configurações numa aba nova, fora da janela capturada.
- Siga as **regras de LIVE e de presentes do TikTok**:
  - os presentes só influenciam escolhas dentro do jogo;
  - não prometa dinheiro, prêmios ou vantagens fora da live em troca de presentes;
  - não troque presentes por curtidas ou seguidores ("like por like") e não fique pedindo presentes sem parar;
  - não apresente a votação como aposta.
- Esteja na live: apareça na câmera, narre e converse com o chat. O TikTok pode parar de recomendar, e deixar sem presentes, a live que roda sozinha, sem o criador, ou que fica com a tela parada, preta ou vazia por muito tempo. A carreira automática é para animar a live com você, não para deixar rodando sozinha.
- Para sair um pouco, pause o jogo (e, no LIVE Studio, a live). Não mostre QR codes.
- Você responde pelo que aparece na sua live, inclusive os nomes e comentários do público que o jogo mostra. O LENDA recusa palavrões nos nomes das lendas, mas fique de olho.
- Nunca mostre a chave de transmissão do OBS na tela.

## Opções da ponte

```
npm run live -- [opções]          (ou: INICIAR-LIVE.bat [opções])

  --usuario <perfil>   já conecta na live desse @ ao iniciar
  --porta <número>     porta do jogo e do WebSocket (padrão 5178)
  --chave <chave>      chave do Euler Stream (opcional)
  --demo               público de teste passando pela ponte (sem TikTok)
  --abrir              abre o painel da live numa janela própria do Chrome/Edge
                       (o INICIAR-LIVE.bat já usa)
  --sem-site           só o WebSocket (para usar com "npm run dev")
  --refazer            força recompilar o jogo (normalmente ela recompila sozinha quando o código muda)
```

Para passar opções ao `.bat`, abra o Prompt de Comando na pasta `lenda\live` e rode, por exemplo, `INICIAR-LIVE.bat --porta 5179`.

A ponte só aceita conexões do próprio computador (`localhost`). Para usar outro navegador na janela do `--abrir`, defina a variável de ambiente `LENDA_NAVEGADOR` com o caminho do executável.

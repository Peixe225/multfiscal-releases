# LENDA na live do TikTok

O chat comanda o Modo Clássico. Cada decisão da carreira (proposta de clube, empréstimo, evento, pênalti decisivo) vira uma votação. O público vota comentando o número da opção ou mandando o presente ligado a ela: 🌹 Rosa no 1, 🎵 TikTok no 2, 🎮 GG no 3 e 🍦 Sorvete no 4.

Antes de cada carreira abre uma **disputa**: quem doar mais nos próximos segundos cria a nova lenda, digitando no chat o nome, a nacionalidade e a posição do jogador.

```
TikTok LIVE ──► ponte (seu PC) ──► jogo no Chrome/Edge ──► LIVE Studio (captura de janela) ──► sua live
             comentários, presentes,
             curtidas, seguidores
```

## Do que você precisa

- Um PC com Windows. Mac e Linux também funcionam, pelo terminal.
- **Node.js 22 ou mais novo.** Baixe a versão **LTS** em https://nodejs.org e instale com as opções padrão.
- **Google Chrome** ou **Microsoft Edge**.
- O **TikTok LIVE Studio**, para transmitir do PC. Sem ele, dá para usar o OBS, desde que sua conta tenha chave de transmissão.
- Acesso à LIVE no TikTok.

## Instalar (uma vez só)

1. Baixe o LENDA.
   - Pelo site: abra https://github.com/Peixe225/multfiscal-releases, troque para a branch `claude/football-simulation-game-xhgk2n`, clique em **Code → Download ZIP** e extraia o ZIP numa pasta sua (por exemplo, `Documentos\LENDA`).
   - Ou, com git: `git clone https://github.com/Peixe225/multfiscal-releases` e depois `git checkout claude/football-simulation-game-xhgk2n`.
2. Pronto. O `INICIAR-LIVE.bat` instala o resto sozinho na primeira vez. Ele precisa de internet e leva alguns minutos.
   - No Mac ou no Linux, abra um terminal na pasta `lenda` e rode `npm install`.

**Para atualizar:** baixe a versão nova e copie os arquivos **por cima** da pasta antiga, sem apagar a pasta. O `.bat` percebe a mudança, instala o que faltar e recompila o jogo sozinho. Pelo terminal, rode `npm install` depois de cada atualização.

> Suas configurações, carreiras e o Hall das Lendas da live ficam guardados dentro da pasta do LENDA, em `lenda\.cache\janela-live`. Apagar a pasta apaga tudo isso.

## Começar uma live, passo a passo

1. **Ligue a ponte.** Dê dois cliques em `lenda\live\INICIAR-LIVE.bat`.
   - Abre uma janela preta: é a ponte. **Deixe ela aberta durante toda a live.**
   - Na primeira vez (e depois de cada atualização), ela compila o jogo. Isso leva cerca de 1 minuto.
   - Em seguida ela abre o **painel da live** numa janela própria do Chrome/Edge, em `http://localhost:5178/#/live`. A fonte já vem marcada como **TikTok (ponte do LENDA)**.
   - Essa janela usa um perfil separado do navegador, só do LENDA. Se você abrir o mesmo endereço no seu navegador de sempre, ele começa do zero (sem suas configurações nem carreiras). Use sempre a janela que a ponte abre.
   - No Mac ou no Linux, rode `npm run live -- --abrir` na pasta `lenda`.
2. **Configure (só na primeira vez).** No painel, ajuste as seções *2. Como o chat vota* e *3. Carreira automática*. As configurações ficam salvas.
3. **Abra a janela da live.** No topo do painel, clique em **Abrir janela da live (9:16)**.
   - Abre uma janela em pé, de 540×960, com a tela **"A live já vai começar!"**. Ela ainda não começa nada.
   - Se o navegador bloquear a janela, libere os pop-ups para `localhost`.
4. **Mostre a janela no LIVE Studio.**
   - Crie uma cena **vertical** (9:16).
   - Adicione uma fonte **Captura de janela** e escolha a janela em pé do LENDA.
   - Não minimize essa janela. Ela pode ficar atrás do LIVE Studio.
5. **Comece a live no TikTok.**
6. **Conecte a ponte na sua live.** No painel, em *1. Conexão*:
   - digite o seu @, igual ao do link do perfil (`tiktok.com/@seuperfil`). Maiúsculas, o `@` e um link colado são corrigidos sozinhos;
   - clique em **Conectar**.

   O indicador fica verde: "Conectado em @seuperfil". Se a live ainda não estiver no ar, a ponte tenta de novo sozinha a cada 30 segundos.
7. **Comece o jogo.** No topo do painel, clique em:
   - **Iniciar modo live**, quando não há carreira salva;
   - **Continuar NOME**, para seguir a carreira salva;
   - **Nova lenda**, para começar outra lenda (o botão diz como: disputa, maior apoiador ou chat vota).

   O jogo começa na janela da live, e o topo dela vira a **faixa da live**: a votação, o relógio, o último presente, o pódio de apoiadores e o termômetro de curtidas.
8. **Fixe no chat os textos de como participar.** Em *2. Como o chat vota* há dois textos prontos: **Como votar** e **Próxima lenda**. Cada um tem no máximo 150 caracteres (o limite de um comentário no TikTok). Clique em **Copiar**, cole no chat e fixe. Faça um de cada vez.
9. **Durante a live, use o painel** (a janela de configurações) como controle remoto. Os botões do topo comandam a janela da live:
   - **Pausar** e **Retomar**;
   - **Encerrar votação**, **Encerrar disputa** ou **Encerrar criação**, conforme o que estiver aberto;
   - **Nova lenda**, que pede confirmação quando há uma carreira em andamento;
   - **Parar**.

   O menu ⚙ da faixa tem os mesmos comandos.
10. **Para terminar:** clique em **Parar**. A janela da live volta para "A live já vai começar!". Depois feche a janela preta da ponte (ou aperte `Ctrl+C` nela).

> **Só uma janela?** Se você não abrir a janela da live, **Iniciar modo live** começa o jogo no próprio painel, e você captura essa janela. A janela em pé é melhor: ela tem o formato da live e respeita a área segura do TikTok.

## Área segura do TikTok

O app do TikTok desenha por cima da sua transmissão. No topo ficam o seu nome e o número de espectadores. Embaixo ficam o chat, os presentes e a caixa de comentário.

Com a opção **Área segura do TikTok** ligada (*5. Transmitir no TikTok*, já vem ligada), a janela da live se ajusta:

- a faixa da live começa abaixo da sobreposição do topo (cerca de 8% da altura);
- as opções e os votos ficam acima da parte de baixo (cerca de 22% da altura), que vira um fundo escuro onde o chat do TikTok fica legível;
- durante a votação, as opções aparecem em duas colunas, e o título da decisão vai para a faixa.

A área segura só vale para a janela em pé (9:16). Num monitor deitado nada muda.

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
- **4. Testar votos:** botões para comentar e mandar presentes durante uma votação. Na disputa e na criação aparecem também botões para dar lance e digitar os comandos como o criador.
  - Com a live rodando na janela da live, os botões mandam o teste para lá, e o painel lista "Enviado para a janela da live: …".
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
  - não apresente a votação como aposta.

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

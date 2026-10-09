# LENDA na live do TikTok

O chat comanda o Modo Clássico. Cada decisão da carreira (transferência, evento, pênalti decisivo) vira uma votação. O público vota comentando o número da opção ou mandando o presente ligado a ela: 🌹 Rosa no 1, 🎵 TikTok no 2 e assim por diante.

No começo de cada carreira, o chat escolhe a posição e a nacionalidade da nova lenda. O maior apoiador da live dá o nome ao jogador.

```
TikTok LIVE ──► ponte (seu PC) ──► jogo no navegador ──► LIVE Studio (captura de janela) ──► sua live
             comentários, presentes,
             curtidas, seguidores
```

## Do que você precisa

- Um PC com Windows, Mac ou Linux.
- **Node.js 20 ou mais novo**: baixe a versão LTS em https://nodejs.org.
- Acesso à LIVE no TikTok e o **TikTok LIVE Studio**, para transmitir do PC. Se você ainda não tiver o LIVE Studio, dá para usar o OBS, desde que sua conta tenha chave de transmissão.
- Chrome ou Edge.

## Instalar (uma vez só)

1. Baixe o projeto.
   - Com git: `git clone` do repositório e `git checkout claude/football-simulation-game-xhgk2n`.
   - Ou baixe o ZIP dessa branch no GitHub.
2. Abra um terminal na pasta `lenda` e rode:

   ```
   npm install
   ```

## Começar uma live

1. **Ligue a ponte.**
   - No Windows: dê dois cliques em `lenda/live/INICIAR-LIVE.bat`.
   - Em qualquer sistema: rode `npm run live -- --abrir` na pasta `lenda`.

   Na primeira vez ela compila o jogo, o que leva cerca de 1 minuto. Depois abre o jogo numa janela em pé (540×960), em `http://localhost:5178/#/live`.

   Deixe a janela preta da ponte aberta durante toda a live.
2. **Comece a live no TikTok.** A ponte só consegue entrar quando a live já está no ar.
3. **Conecte a ponte na sua live.** Na tela **Live interativa**, em *1. Conexão*:
   - escolha **TikTok (ponte do LENDA)**;
   - digite o seu @;
   - clique em **Conectar**.

   O indicador fica verde ("Conectado em @seuperfil"). Se a live ainda não começou, a ponte tenta de novo a cada 30 segundos.
4. **Ligue as votações.** Clique em **Iniciar modo live** (ou em **Nova lenda votada pelo chat**). A barra do topo vira a faixa da live, com a votação, o relógio, os presentes que chegam, o pódio de apoiadores e o termômetro de curtidas.
5. **Mostre o jogo na live.** No LIVE Studio:
   - crie uma cena **vertical**;
   - adicione **Captura de janela**;
   - escolha a janela do jogo.

   Se você abriu a janela pelo botão **Abrir janela da live (9:16)**, use a aba original como painel de controle: os botões Pausar, Encerrar votação, Nova lenda e Parar comandam a janela da live.
6. **Fixe no chat o texto de como votar.** O botão **Copiar** em *2. Como o chat vota* já monta esse texto.

Para encerrar, use **Sair do modo live** (no menu ⚙ da faixa ou na página de configuração) e feche a ponte com `Ctrl+C`.

## Como o público vota

| O que a pessoa faz | Quanto vale |
|---|---|
| Comenta `1`, `2`, `3` ou `4` (também vale `#2`, `opção 2`, `voto 2`) | 1 voto por pessoa por votação. Comentar outro número muda o voto. |
| Manda o presente de uma opção (padrão: Rosa = 1, TikTok = 2, GG = 3, Sorvete = 4) | moedas × "cada moeda vale" (padrão 10). Uma rosa vale 10 votos. |
| Manda outro presente qualquer | Vai para o último número que a pessoa comentou. |
| Manda um presente acima do limite de "decide na hora" (se estiver ligado) | Encerra a votação na hora, para a opção da pessoa. |

- Ganha a opção com mais pontos.
- Em caso de empate, ganha quem tem mais moedas e depois mais pessoas.
- Se o empate continuar no fim do tempo, a votação ganha **mais 10 segundos** (uma vez). Persistindo, há um sorteio.
- Se ninguém votar, o jogo sorteia para a live não travar.
- **Presentes em sequência** (combo) contam certinho: a ponte desconta as repetições que o TikTok manda durante o combo.

Tudo isso é configurável na página: tempo da votação, peso das moedas, presente de cada opção, comentários valendo ou não e prorrogação.

## O que acontece sozinho

- **Comemoração de título:** fica alguns segundos na tela (padrão 6) e o jogo segue.
- **Fim de carreira:** a tela final fica na tela (padrão 20 s) e começa a votação da próxima lenda. Com 0 segundos, o jogo espera você clicar em **Nova lenda**.
- **Nome da lenda:** sai do apelido do maior apoiador, com um filtro de palavrões. Também dá para usar um nome fixo ou um aleatório.
- **Ritmo:** *Expresso* tem menos decisões por carreira e é bom para lives curtas.
- **Intervenção manual:** você pode clicar numa opção para escolher no lugar do chat; a votação em andamento é cancelada. Também pode pausar as votações a qualquer momento.

## Testar sem estar ao vivo

- **Simulador** (em *1. Conexão*): um público de mentira comenta números, manda rosas, curte e segue. A velocidade é ajustável.
- `npm run live:demo`: a própria ponte gera eventos no formato do TikTok. Serve para testar o caminho completo (ponte → jogo) antes da live.
- *4. Testar votos*: botões para comentar e mandar presentes durante uma votação.

## Usa o TikFinity?

Em *1. Conexão*, escolha **TikFinity** e informe o endereço WebSocket dele (padrão `ws://localhost:21213/`). O TikFinity precisa estar aberto e conectado na sua live. Nesse caso a ponte do LENDA só serve o jogo, então você pode rodar `npm run live` sem conectar o @.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| "A ponte não está rodando" | Abra o jogo pelo `npm run live` (ou pelo `.bat`), em `http://localhost:5178`. Pelo link do claude.ai só o simulador funciona. |
| "@perfil não está ao vivo agora" | Comece a live primeiro. A ponte tenta de novo a cada 30 s. |
| "Limite do serviço de conexão atingido" | A conexão usa o serviço gratuito de assinatura do Euler Stream. Espere alguns minutos ou crie uma chave em eulerstream.com e cole em *Opções avançadas*. |
| Um presente não conta para a opção | O nome do presente pode variar por região. Conecte na live e escolha o presente pela lista real da sua sala (com preço) em *Presente de cada opção*. |
| "A porta 5178 já está em uso" | Feche a outra ponte ou rode `npm run live -- --porta 5179`. Depois ajuste o endereço em *Opções avançadas*. |
| Duas janelas do jogo abertas | Só uma roda a live. A outra vira painel de controle automaticamente. |

## Boas práticas e regras do TikTok

- A leitura dos eventos usa só o @ público da live, sem login nem senha.
  - A biblioteca é o [TikTok-Live-Connector](https://github.com/zerodytrash/TikTok-Live-Connector), não oficial.
  - A assinatura da conexão passa pelo Euler Stream.
  - Se um dia o TikTok mudar algo, atualizar a biblioteca com `npm update tiktok-live-connector` costuma resolver.
- Siga as **regras de LIVE e de presentes do TikTok**:
  - os presentes só influenciam escolhas dentro do jogo;
  - não prometa dinheiro, prêmios ou vantagens fora da live em troca de presentes;
  - não apresente a votação como aposta.

## Opções da ponte

```
npm run live -- [opções]

  --usuario <perfil>   já conecta na live desse @ ao iniciar
  --porta <número>     porta do jogo e do WebSocket (padrão 5178)
  --chave <chave>      chave do Euler Stream (opcional)
  --demo               público de teste (sem TikTok)
  --abrir              abre o jogo numa janela em pé para captura
  --sem-site           só o WebSocket (para usar com "npm run dev")
  --refazer            força recompilar o jogo (normalmente ela recompila sozinha quando o código muda)
```

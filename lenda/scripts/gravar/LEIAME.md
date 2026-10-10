# Gravar criativos do LENDA

Scripts que jogam o LENDA sozinhos num Chromium sem janela e gravam em MP4 (H.264, 30 fps):
vertical 1080×1920 para TikTok, Reels e Shorts, e horizontal 1920×1080 para o YouTube.
Foi assim que os criativos de lançamento foram feitos.

## O que cada arquivo faz

| Arquivo | Para quê |
|---|---|
| `gravador.mjs` | Grava a página: pega os quadros do screencast do DevTools e monta um vídeo de fps constante com o ffmpeg. |
| `comum.mjs` | Abre o navegador, cria o contexto 9:16 ou 16:9, desliga o som, fixa a semente da carreira e desenha o "toque" na tela. |
| `classico.mjs` | Uma carreira do Modo Clássico do começo ao fim: criação, decisões, fim, Nota de Legado e card final. |
| `live.mjs` | Uma lenda inteira do modo LIVE com o simulador: disputa, criação pelo maior doador, carreira votada e fim. |
| `imersivo.mjs` | O começo de uma carreira do Modo Imersivo: base, treino e as primeiras partidas com os lances decisivos. |
| `hall.mjs` | O Hall das Lendas cheio das carreiras gravadas: ranking, filtros, categorias e as fichas. |
| `rodar.mjs` | Fila de gravações: `node scripts/gravar/rodar.mjs fila.json saida/ 2` (2 ao mesmo tempo). Pula o que já foi gravado. |
| `pos.mjs` | Capas JPG, um corte rápido de 20–35 s de cada vídeo e a compilação "do pior ao melhor". |
| `catalogo.mjs` | Junta tudo num `_catalogo.json` com os fatos de cada carreira (clubes, títulos, prêmios, nota). |
| `galeria.mjs` | Gera o `index.html` da galeria que vai para a hospedagem junto com os vídeos. |

## Como as carreiras saem iguais

O Modo Clássico é determinístico: a mesma semente, a mesma nacionalidade, posição e ritmo, e as
mesmas escolhas dão exatamente a mesma carreira. A semente sai de `crypto.getRandomValues(new Uint32Array(2))`,
e o `comum.mjs` fixa esse valor na página. Por isso dá para procurar, fora do navegador, carreiras de
cada faixa (péssima a extraordinária) rodando o motor do jogo milhares de vezes. Depois o navegador
repete a carreira escolhida clicando nos mesmos cartões. O nome e o número da camisa não mudam nada.

Cada item da fila do Clássico tem `a0`, `a1` (a semente), `identity`, `pace` e `picks`
(`{ idx, pen }`: o cartão `#ck-opt-<idx>`, ou o canto do pênalti).

## Do que precisa

- Node 22 e o Playwright com o Chromium (`npx playwright install chromium`). Se o Chromium estiver em
  outro lugar, use `LENDA_CHROME=/caminho/do/chrome`.
- ffmpeg com libx264 (`LENDA_FFMPEG=/caminho/do/ffmpeg` se não estiver no PATH).
- O jogo servido em algum endereço (`LENDA_BASE`, padrão `http://localhost:4173/`), por exemplo
  `npx vite preview --port 4173` depois do `npm run build`.

## Dicas

- Cada gravação ocupa bem um núcleo de CPU com o Chromium desenhando em 1080×1920. Com 4 núcleos, grave
  2 por vez. `LENDA_PRESET=ultrafast` alivia o ffmpeg durante a gravação, e depois
  `LENDA_RECOMPRIMIR=1 node scripts/gravar/pos.mjs saida/` recomprime tudo uma vez.
- O `.json` de cada vídeo traz `recebidos` (quadros que o Chromium mandou). Dividido pela duração, isso dá
  a fluidez real. Abaixo de uns 24 por segundo, regrave com menos coisas rodando ao mesmo tempo.
- Os vídeos não têm som: entram música e narração na edição.
- O modo LIVE grava com o simulador, então o selo "SIMULADOR" aparece. Ao postar, diga que é uma simulação.

# Editar criativos do LENDA

Transforma as gravações brutas de `scripts/gravar/` em vídeos curtos prontos para postar no TikTok e no
YouTube Shorts (9:16, 1080×1920, 30 fps). O vídeo sai com cortes, zoom suave, textos animados, uma trilha
original sintetizada (sem direitos de terceiros) e efeitos sonoros. Sai também uma versão só com os efeitos,
para usar um som em alta dentro do TikTok.

## O que cada arquivo faz

| Arquivo | Para quê |
|---|---|
| `comemoracoes.py` | Acha nas gravações as telas de título (douradas) e de rebaixamento (vermelhas). Escreve `_ouro-<gravação>.json`. |
| `roteiros.py` | Escreve os roteiros (EDL) dos criativos em `roteiros/`, a partir das marcas, das comemorações e do `_catalogo.json`. |
| `textos.mjs` | Desenha os textos por cima do vídeo (gancho, legenda, contador, chips, selo, nota, CTA, flash) em PNG transparente, com as fontes do jogo. |
| `trilha.py` | Sintetiza a música (hype, épico ou leve, no BPM do roteiro, com riser e impacto no drop) e os efeitos (whoosh, impacto, ding, riser, tick, pop). |
| `montar.mjs` | Lê um roteiro, corta as cenas, aplica zoom e velocidade, sobrepõe os textos e mixa trilha + efeitos em −14 LUFS. |
| `pagina.mjs` | Monta a página de download (`index.html`) com os vídeos, as capas, as legendas de postagem e o botão de copiar. |
| `legendas.json` | Legenda de postagem, hashtags e ordem sugerida de cada criativo. |

## Passo a passo

```bash
# 1. comemorações das carreiras usadas nos roteiros (uma vez)
python3 scripts/editar/comemoracoes.py saida/ v-intenso-01 v-intenso-02
# 2. roteiros
python3 scripts/editar/roteiros.py saida/
# 3. cada criativo (≈1 min cada)
node scripts/editar/montar.mjs scripts/editar/roteiros/c2-bolas-de-ouro-seguidas.json saida/ editados/
# 4. página de download e upload
node scripts/editar/pagina.mjs editados/ editados-site/
HOST_URL=… HOST_AUTH=… HOST_REST=… node scripts/publicar-hostinger.mjs editados-site lenda/criativos/editados
```

`saida/` é a pasta das gravações brutas (com `_catalogo.json`, gerado por `scripts/gravar/catalogo.mjs`).
Os tempos fixos dentro de `roteiros.py` foram conferidos quadro a quadro nessas gravações. Se você gravar de
novo, confira as cenas antes de montar.

## Os criativos

| Criativo | Ideia |
|---|---|
| `c1-como-funciona` | Explica o jogo: criar, escolher, cada decisão muda a história; 3 modos, 3 ritmos, Bolas de Ouro, Nota de Legado, Hall. |
| `c2-bolas-de-ouro-seguidas` | VAN RIJN: rebaixado aos 18, Barcelona, contador de Bolas de Ouro ×1…×12, 794 gols, nota 93. |
| `c3-qual-nota-voce-tiraria` | Escada da Nota de Legado: 5, 14, 33, 51, 67, 85 e 93, uma carreira de cada faixa. |
| `c4-o-chat-decide` | A live interativa (simulação): o maior doador cria o jogador e o chat vota cada decisão. |
| `c5-brasileiro-imortal` | CORDEIRO: da base do Náutico a campeão do mundo aos 39, 10 Bolas de Ouro, nota 92. |
| `c6-entre-em-campo` | Modo Imersivo: escolher o lance, acertar o tempo, decidir o jogo e a Noite da Bola de Ouro. |
| `c7-nenhuma-carreira-igual` | Montagem com 30 carreiras gravadas, da nota 5 à 93, no ritmo da música. |

## Do que precisa

- Node 22 com Playwright e o Chromium (o mesmo das gravações), para desenhar os textos.
- ffmpeg (ou `LENDA_FFMPEG=/caminho/do/ffmpeg`).
- Python 3 com `numpy` e `scipy`.
- As fontes vêm de `node_modules` (`@fontsource/barlow-condensed` e `@fontsource-variable/inter-tight`), então rode `npm ci` antes.

## Zonas seguras

O TikTok cobre os 10% de cima, os 22% de baixo e os 12% da direita com a interface e a legenda. Os textos dos
roteiros ficam entre y≈190 e y≈1500, longe da borda direita. Confira com uma folha de quadros antes de postar.

# LENDA · Design Spec — tema **Transmissão** (`data-theme="transmissao"`)

> Direção aprovada para o **Modo Imersivo** (jogo completo, partida a partida). Convive no mesmo código com o tema **Noite de Final** (Modo Clássico / MVP) através de um **contrato de tokens idêntico** — componentes React não sabem qual tema está ativo.
>
> Stack: React 19 · Tailwind v4 · `motion` (motion/react) · `lucide-react` · fontes via `@fontsource`.

**Arquivos deste pacote**

| Arquivo | O quê |
|---|---|
| `design/theme-transmissao.css` | CSS de produção: ponte Tailwind v4 (compartilhada), tokens do contrato, tokens privados `--lx-*`, efeitos/primitivas `.lx-*`, superfícies imersivas, keyframes, reduced-motion e forced-colors. Compila no Tailwind 4.3 e passa no lightningcss sem erros. |
| `design/snippets-transmissao/index.html` | Galeria dos snippets (abra no navegador, funciona offline). |
| `design/snippets-transmissao/effects/*.html` | 13 snippets autocontidos (dependem só do CSS do tema + `_fonts/`). |
| `design/snippets-transmissao/trophies/*.svg` | 11 troféus individuais + `trophy-sprite.svg` + `index.html` (galeria). |
| `design/snippets-transmissao/art/*.svg` | Camisa paramétrica, escudo fallback, marca, 3 campos, microfones, sprite de ícones esportivos + `index.html`. |
| `design/snippets-transmissao/_fonts/` | Cópia offline dos woff2 do @fontsource (só para os snippets) + `fonts.css` + licença OFL. |

Mockups-fonte: `design/broadcast/` (landing, identity, career, celebration, tabela, bola-de-ouro, summary, trophies + `NOTES.md`). Todas as medidas "do mockup" abaixo foram extraídas do CSS desses arquivos; as de telas imersivas são novas e estão implementadas nos snippets.

---

## 0. Princípios (em ordem de prioridade)

1. **Lê como transmissão, mas é sempre legível.** O fundo recua (noite azul, feixes, grão), os dados vêm pra frente (branco, tabular, caixa-alta condensada).
2. **Cada cor tem UM papel.** Ciano = seleção / ao vivo / foco. Ouro = glória (títulos, recordes, CTA primário). Verde/vermelho = consequência positiva/negativa. Âmbar (`--warning`) = atenção — nunca confundir com ouro.
3. **Sem cantos arredondados.** Forma = recorte angular (`clip-path`): chanfro nas placas, paralelogramo em botões/chips/abas. Raio só em escudos/bandeiras (2px) e bolinhas.
4. **Consequência antes da escolha.** Toda decisão mostra efeito + probabilidade (chips `.lx-fx`) — em carreira, lance decisivo, coletiva e contrato.
5. **Movimento de TV é "wipe" e "sweep", não "bounce".** Entradas por wipe/slide curtos, brilho que passa a cada 7 s, overshoot só para troféu/vencedor.

---

## 1. Cor

### 1.1 Contrato compartilhado (valores deste tema)

Contraste medido (WCAG 2.x) contra `--surface #0C1344`, salvo indicação.

| Token | Valor | Uso | Contraste |
|---|---|---|---|
| `--bg` | `#03051A` | fundo base (noite) | — |
| `--bg-2` | `#060A26` | topbar, faixas, ticker, célula de relógio do placar | — |
| `--surface` | `#0C1344` | painel / área de gráfico | — |
| `--surface-2` | `#111A57` | placa elevada, times do placar | — |
| `--surface-3` | `#18236E` | hover / selecionado | — |
| `--glass` | `rgb(26 36 118 / .55)` | vidro (sempre com `backdrop-filter`) | — |
| `--border` | `rgb(134 156 255 / .13)` | divisores | — |
| `--border-strong` | `rgb(134 156 255 / .24)` | contorno de input, chip, kbd | — |
| `--text` | `#F4F6FF` | texto primário | 16.3 : 1 |
| `--text-2` | `#B9C1EA` | secundário / corpo | 10.0 : 1 |
| `--text-3` | `#7C86BE` | rótulos, metadados | 5.0 : 1 (4.0 em `--surface-3` → só ≥14px bold) |
| `--accent` | `#3BE4FF` | seleção, ao vivo, aba ativa, foco, handles | 11.5 : 1 |
| `--accent-ink` | `#06103A` | texto sobre ciano | 12.0 : 1 |
| `--positive` | `#33F0A8` | efeito +, vitória, Sul-Americana | 11.9 : 1 · 9.3 sobre `--positive-bg` |
| `--positive-bg` | `rgb(51 240 168 / .12)` | fundo de chip positivo | — |
| `--negative` | `#FF5A78` | efeito −, derrota, rebaixamento | 5.9 : 1 · 5.1 sobre `--negative-bg` |
| `--negative-bg` | `rgb(255 90 120 / .12)` | fundo de chip negativo | — |
| `--warning` | `#FF9F43` | energia baixa, paciência, cronômetro ≤5 s | 8.6 : 1 |
| `--info` | `#7FA8FF` | pré-Libertadores, tom "humilde", avisos neutros | 7.5 : 1 |

Tokens de forma, elevação, tipo e motion do contrato estão nas seções 3–8.

### 1.2 Tokens privados do tema (`--lx-*`, **não** usar em componentes compartilhados)

| Token | Valor | Papel |
|---|---|---|
| `--lx-bg-3` | `#0A1036` | faixa intermediária |
| `--lx-line-3` | `rgb(160 180 255 / .40)` | divisores inclinados (stats) |
| `--lx-text-4` | `#505A94` | **decorativo apenas** (2.7:1): zeros apagados, anos futuros |
| `--lx-accent-2` | `#00A8FF` | início dos gradientes de barra |
| `--lx-gold` / `-hi` / `-lo` / `-ink` | `#F7C948` / `#FFEDB0` / `#B67B0B` / `#241400` | glória (= `--metal-gold-2`), brilho, sombra, tinta sobre ouro |
| `--lx-live` | `#FF2E55` | bolinha/chip "AO VIVO" (4.8:1) |
| `--lx-pos-1/-2` | `#E0195A → #B3123F` | chip de posição (CA, MEI…), branco 4.7–6.8:1 |
| `--lx-zone-lib/pre/sul/reb` | ciano / `#7FA8FF` / verde / vermelho | barras de zona da tabela |
| `--lx-card-yellow` / `--lx-card-red` | `#FFD21F` / `#E5213C` | cartões (o vermelho tem 3.9:1 → sempre com ícone + texto) |
| `--lx-series-1/2/3` | `#17A86C` / `#7F80EC` / `#C4821A` | gráficos (validado no dataviz: Clubes BR / Europa / Recorde) |
| `--lx-turf-*` | `#0E5B45 → #083A33`, linhas `rgb(158 247 224 / .55)` | campos verdes |
| `--lx-tier-*-ink` | bronze `#1C0901`, prata `#141B2E`, ouro `#1D1300`, lenda `#0A0B2A` | tinta do número no badge |
| `--lx-cut-xs/sm/md/lg/xl` | 4 / 8 / 14 / 18 / 28 px | chanfros |
| `--lx-skew-sm/md/lg` | 6 / 10 / 14 px | inclinação dos paralelogramos |
| `--lx-drop-1/2/3/glow/gold/trophy` | `drop-shadow(...)` | elevação de formas recortadas (§4) |
| `--lx-ease-in` / `--lx-ease-sweep` | `cubic-bezier(.5,0,.75,0)` / `(.6,0,.2,1)` | saídas / varredura |
| `--lx-noise` | data-URI SVG `feTurbulence` | grão (sem rede) |

### 1.3 Tiers do OVR (`--tier-*-1/2/3`)

`-1` claro · `-2` meio · `-3` sombra. O **brilho** e a **tinta** são derivados — o contrato só carrega os 3 tons de corpo.

| Tier | Faixa | `-1` | `-2` | `-3` | Tinta (`--lx-tier-*-ink`) | Contraste da tinta sobre `-1` / `-2` |
|---|---|---|---|---|---|---|
| bronze | < 70 | `#E39A5A` | `#B8652A` | `#7C3A12` | `#1C0901` | 8.3 / 4.5 |
| silver | 70–79 | `#D7DEEC` | `#A5B0C8` | `#6E7A96` | `#141B2E` | 12.7 / 7.9 |
| gold | 80–89 | `#FFD65C` | `#E7A51C` | `#A86A06` | `#1D1300` | 13.1 / 8.6 |
| lenda | 90+ | `#8AF0FF` | `#6F7BFF` | `#B04DFF` | `#0A0B2A` | 14.6 / 5.4 |

**Receita do badge** (em `.lx-ovr`, `.lx-ovr-s`):

```css
background: linear-gradient(150deg,
  color-mix(in oklab, var(--tier-X-1), #fff 55%) 0%,   /* brilho derivado */
  var(--tier-X-1) 28%, var(--tier-X-2) 62%, var(--tier-X-3) 100%);
color: var(--lx-tier-X-ink);
/* + ::before reflexo 115° (branco .55 entre 30–54%) + micro-listras 135° 2px/6px, mix-blend-mode: soft-light
   + ::after hairline branca .45 a 3px, mesmo chanfro */
```

Regra de tier: `ovr >= 90 ? "lenda" : ovr >= 80 ? "gold" : ovr >= 70 ? "silver" : "bronze"` → `data-tier` no elemento. (O mockup chamava o 90+ de `elite`; o contrato usa **`lenda`**.)

### 1.4 Metais dos troféus (`--metal-{gold|silver|bronze|wood}-{1..5}`)

**Convenção de sufixo (proposta para os dois temas): `1` = especular (mais claro) … `5` = sombra mais profunda.**

| | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| gold | `#FFF3C4` | `#F7C948` | `#E3A21C` | `#A56B0A` | `#6A3F03` |
| silver | `#FFFFFF` | `#C8D0E0` | `#A8B2C8` | `#6B7690` | `#4E5873` |
| bronze | `#FFD2A6` | `#E39A5A` | `#B8652A` | `#7C3A12` | `#4A1E06` |
| wood | `#83502B` | `#5A3219` | `#4A2813` | `#1E0F07` | `#190B05` |

Como os gradientes dos troféus consomem os tokens (ordem das paradas):

| Gradiente | Paradas → token |
|---|---|
| prata horizontal (cilindro facetado) | 0 → s5 · .14 → s2 · .28 → s1 · .44 → s3 · .60 → s4 · .80 → s2 · 1 → s5 |
| prata vertical | s1 · s2 · s4 |
| ouro horizontal | g5 · g3 · g1 · g2 · g4 · g2 · g5 (mesmos offsets) |
| ouro vertical | g1 · g2 · g4 |
| bola de ouro (radial `cx .36 cy .3 r .78`) | g1 · g2 (.22) · g3 (.58) · g5 |
| núcleo (diamante do Brasileirão, estrela do Estadual) | g1 · g3 (.45) · g4 |
| madeira horizontal | w4 · w2 (.3) · w1 (.46) · w3 (.7) · w5 |
| gravações/linhas | prata → s5; ouro → g5; placas → g2; brilhos → g1 / `#fff` |
| **canônicos, não tematizados** | malaquita da Copa (`#042A1A → #36C98A`), ônix das bases, faixa verde-amarela do Brasileirão, faixa vermelha da LaLiga |

`--color-glory` (Tailwind `text-glory`, `bg-glory`) = `var(--metal-gold-2)` — é o "ouro de glória" que componentes compartilhados podem usar sem depender de token privado.

### 1.5 Cor de clube em runtime

O React injeta **inline** no container do contexto (header do jogador, linha da carreira, time no placar, dia de jogo, card de opção):

```tsx
style={{ "--club": c.c1, "--club-2": c.c2, "--club-ink": clubInk(c.c1), "--club-tint": c.tint } as React.CSSProperties}
```

- `--club` (obrigatório): cor de identidade. `--club-2` (obrigatório): sombra/2ª cor. `--club-ink`: texto sobre `--club`.
- `--club-tint` (**opcional**, fora do contrato): cor para rastros/placas quando `--club` é amarelo ou muito claro (ex.: Mirassol `#F4C400` → tint `#1E8A45`; amarelo a 34% sobre navy vira marrom).
- Defaults do tema (sem contexto de clube): `#3D5BFF` / `#1A2B8E` / `#FFFFFF`.

```ts
// src/theme/clubInk.ts — escolhe o que der MAIS contraste sobre --club
const lum = (hex: string) => {
  const [r, g, b] = hex.slice(1).match(/../g)!.map(h => parseInt(h, 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
export const clubInk = (hex: string) => (ratio("#FFFFFF", hex) >= ratio("#07103A", hex) ? "#FFFFFF" : "#07103A");
// Palmeiras #0A7A45 → branco (5.4) · Real Madrid #E9ECF5 → navy (15.5) · Mirassol #F4C400 → navy (11.1) · Man City #6CABDD → navy (7.4)
```

**Onde o Transmissão usa `--club`:**

| Superfície | Receita |
|---|---|
| Brilho ambiente (hub, partida, `.lx-club-glow`, `.lx-stadium--club`) | radial 70%×90% no canto sup.-esq. com `--club` a 32% + radial oposto com `--club-2` a 22%; no estádio: 900×520 a 30%. Nunca > 35% atrás de texto pequeno. |
| Placa de cabeçalho (`.lx-club-plate`) | `linear-gradient(100deg, club-tint∨club 0%, mix(club-tint∨club-2 85%, #000) 46%, rgb(8 12 44 / .96) 100%)` + listras 115° (2px/12px, branco .045) + brilho superior + escudo marca-d'água 190px, −10°, 16%, `screen`. **Clubes claros**: `oklch(from var(--club) min(l, .52) c h)` clampa a luminosidade para o texto branco continuar legível (Real Madrid vira ardósia). Texto da placa é sempre branco. |
| Rastro da linha (`.lx-club-row`) | `::before` a partir de 22px: `club-tint∨club` 34% → 10% (38%) → navy .30 (70%) → .22; recorte com lado direito inclinado 8px. Empréstimo (`--loan`): 20% → navy. |
| Badge de idade (`.lx-club-age`) | 44×26, paralelogramo 7px, `linear-gradient(135deg, club, club-2)`, número em `--club-ink`, brilho interno superior 1px. Temporada atual: anel ciano **interno** 1.5px. |
| Placar (bug) | só a faixa de 6px `club → club-2`; nome do time sempre branco sobre navy → qualquer clube funciona. |
| Placar de celebração (`.lx-score__tm`) | fundo `club → club-2`, texto `--club-ink`, recortes para dentro (16px). |
| Halo do escudo nas opções (`.lx-club-halo`) | radial 150×96 `mix(club 90%, white)` a 55%. |
| Dia de jogo (`.lx-day.is-match`) | `linear-gradient(160deg, club-tint∨club 30%, navy .35 70%)`. |
| Post oficial / avatar | barra inset 3px / anel 2px na cor do clube. |
| Pontos no campo | ver §9.1 (regra de contraste com a grama). |

### 1.6 Zonas, gráficos e cartões

- Zonas (barra 3px à esquerda): Libertadores `--accent`, Pré-Liberta `#7FA8FF`, Sul-Americana `--positive`, Rebaixamento `--negative`; linha de corte do Z4 = tracejado vermelho 6/4 px, 4px acima da 17ª linha. Sempre com legenda textual.
- Posição final na linha da carreira (`.lx-rank[data-zone]`): campeão = gradiente ouro + "CAMPEÃO" 11px ouro; G6 ciano; Sula verde; Z4 vermelho + "▼ REBAIXADO".
- Gráficos: linha única do OVR `--accent` 2.5px + área ciano .32→0; faixas de tier no fundo a 6–10%; séries `--lx-series-1/2/3`. Barras podem ter topo com raio 3px (única exceção ao "sem raio").

---

## 2. Tipografia

### 2.1 Fontes (npm, sem CDN)

| Pacote | Versão verificada | Família registrada | Pesos usados |
|---|---|---|---|
| `@fontsource/barlow-condensed` | 5.3.0 | `"Barlow Condensed"` | 600, 700, 800, 700-italic, 800-italic |
| `@fontsource/barlow` | 5.3.0 | `"Barlow"` | 400, 500, 600, 700 |

Não existe `@fontsource-variable` para Barlow (a família só tem estáticos). Instalação e imports (entrada do app, ex. `src/main.tsx`):

```bash
npm i @fontsource/barlow-condensed @fontsource/barlow
```
```ts
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/barlow-condensed/800.css";
import "@fontsource/barlow-condensed/700-italic.css";
import "@fontsource/barlow-condensed/800-italic.css";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
```

Cada CSS já traz os subsets `latin`, `latin-ext` e `vietnamese` com `unicode-range` + `font-display: swap` (latin-ext cobre nomes como "Szczęsny"). Os 9 faces no subset latin somam ≈ 205 KB woff2 (o navegador só baixa os pesos usados na tela; latin-ext só quando aparece um caractere dele). Se o Noite também usar Barlow, importe uma vez só.

| Token | Valor (Transmissão) |
|---|---|
| `--font-ui` | `"Barlow", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` |
| `--font-display` | `"Barlow Condensed", "Arial Narrow", "Roboto Condensed", system-ui, sans-serif` |
| `--font-num` | `"Barlow Condensed", "Arial Narrow", "Roboto Condensed", system-ui, sans-serif` |

### 2.2 Numerais tabulares — obrigatório

Verificado nos arquivos da fonte: **os dígitos padrão do Barlow são proporcionais** (o "1" tem 285 unidades, o "0" 443–453) e a fonte tem a feature `tnum`. Sem `tabular-nums` o relógio da partida "treme" a cada segundo e colunas de tabela desalinham. Regra: **todo número que muda ou se alinha em coluna** usa a utility `num` (família `--font-num` + `tabular-nums` + `"tnum" 1`). As classes `.lx-t-num*`, `.lx-ovr__num`, `.lx-bug__*`, `.lx-ticker__pts`, `.lx-rank` já aplicam.

### 2.3 Escala

Display = Barlow Condensed, sempre caixa-alta via `text-transform: uppercase` (nunca digitar em caixa-alta no dado — leitores de tela soletram). Itálico 800 é a "voz" da transmissão.

| Papel (classe) | Família | Peso/estilo | Tamanho desktop → mobile | Line-height | Tracking | Onde |
|---|---|---|---|---|---|---|
| Celebração `.lx-t-celebrate` | display | 800 it | 150 → 84 | 1 | −.01em | "CAMPEÃO!" |
| Gala `.lx-t-gala` | display | 800 it | 124 → 72 (cerimônia 96 → 64) | .86 | −.01em | nome do vencedor |
| Hero `.lx-t-hero` | display | 800 it | 96 → 60 | .86 | −.01em | título da landing |
| Número OVR `.lx-t-num-xl` / `.lx-ovr__num` | num | 800 it | 70 (xl) · 64 (padrão) → 56 | .86 | −.02em | badge principal |
| KPI grande | num | 800 it | 58 → 44 | .9 | 0 | resumo (jogos/gols) |
| Display `.lx-t-display` | display | 800 it | 52 → 40 | .9 | −.005em | títulos de página |
| KPI `.lx-t-num-lg` | num | 800 it | 40 | .9 | 0 | idade/valor na placa |
| KPI `.lx-t-num` | num | 800 it | 33 → 28 | 1 | 0 | faixa de stats |
| Seção `.lx-t-sec` | display | 800 it | 30 → 26 (24 nos gráficos) | 1 | .005em | "PROPOSTA DA EUROPA" |
| Card `.lx-t-card` | display | 800 it | 24 → 20 | 1 | 0 | nome na opção |
| Placar ao vivo | num | 800 it | 28 → 24 | 1 | 0 | bug |
| Relógio | num | 700 | 22 → 18 | 1 | .02em | bug |
| Botão | display | 800 it | 19 (lg) · 16 (sm) · 14 (xs) | 1 | .06em (.08 xs) | CTAs |
| Linha de tabela `.lx-t-row` | display | 700 | 17 → 15 (16 na classificação) | 1.1 | .02em | clubes |
| Número de linha `.lx-t-num-row` | num | 700 | 18 → 16 | 1 | 0 | J/G/A |
| Aba | display | 800 | 15 → 13 | 1 | .12em | tabs |
| Corpo `.lx-t-body` | ui | 400 | 15 (14.5–17) | 1.5 (1.42–1.5) | 0 | descrições |
| Pergunta da coletiva | ui | 500 | 21 → 17 | 1.35 | 0 | lower-third |
| Post social | ui | 400 | 15 | 1.45 | 0 | feed |
| Pequeno `.lx-t-small` | ui | 500 | 13 | 1.4 | 0 | notas |
| Kicker `.lx-kicker` | display | 700 | 12 | 1 | .18em | com bloco inclinado 14×10 antes |
| Rótulo `.lx-label` | display | 700 | 11 (10.5 · 10 mobile) | 1.2 | .16em | cabeçalhos de coluna |

Regras:
- Texto em gradiente (`.lx-metal-gold/-silver`, `.lx-text-accent`) sempre com `padding-right: .07em; margin-right: -.07em` — o itálico 800 corta a última letra ("!").
- Palavras de celebração: `.lx-gold-glow` = `drop-shadow(0 8px 0 rgb(90 50 0/.55)) drop-shadow(0 0 40px rgb(255 200 80/.45))`.
- Mínimo absoluto: 10px só para rótulos em caixa-alta com tracking ≥ .1em; corpo nunca < 12.5px.
- `lang="pt-BR"` no `<html>` (hifenização/caixa-alta corretas).

---

## 3. Espaçamento e grid

Base 4px (Tailwind `--spacing: .25rem` padrão — `p-3.5` = 14px, `gap-4.5` = 18px funcionam no v4).

| Passo | px | Uso típico |
|---|---|---|
| 0.5 | 2 | gap entre abas |
| 0.75 | 3 | gap entre linhas da carreira, entre chips de forma |
| 1 | 4 | padding do segmentado |
| 1.5 | 6 | gap entre chips, entre fx |
| 2 | 8 | gap pequeno, padding de chip |
| 2.5 | 10 | gap da coluna esquerda da carreira |
| 3 | 12 | gap das opções, padding mobile de tela densa |
| 3.5 | 14 | padding de placa (decisão, tabela), gap do hub |
| 4 | 16 | padding de placa (identidade), gutter de tela de conteúdo mobile |
| 4.5 | 18 | padding de placa de painel, gap das colunas da carreira |
| 6 | 24 | gutter desktop (carreira/partida) |
| 7 | 28 | gutter topbar desktop |
| 8 | 32 | gutter identidade |
| 10 | 40 | gutter hero landing |

Gutters: desktop 24px (telas densas) · 28–40px (landing/identidade) · mobile **12px** em telas densas (carreira, partida, tabela) e **16px** nas de conteúdo (landing, identidade). Nada de scroll horizontal de página; áreas roláveis (prateleira, abas, faixa da semana) usam `mask: linear-gradient(90deg,#000 85%,transparent)`.

Alvos de toque: ≥ 40×40 desktop, ≥ 44×44 mobile (botões `sm` 42px de altura ficam ok; chips clicáveis ganham `min-height: 44px` no mobile via área de toque do pai).

---

## 4. Forma, elevação e luz

### 4.1 Raios (contrato)

`--radius-xs: 2px` (escudo, bandeira, kbd) · `--radius-sm/md/lg/xl: 0` · `--radius-pill: 9999px` (bolinhas: ao vivo, dots do campo, "?" pendente). Componentes compartilhados podem usar `rounded-lg` à vontade: no Transmissão vira 0 e a forma vem dos recortes.

### 4.2 Recortes

| Forma | Classe | Fórmula | Tamanhos |
|---|---|---|---|
| Chanfro sup.-dir. + inf.-esq. (placa) | `.lx-cut` + `.lx-c-{xs,sm,md,lg,xl}` | `polygon(0 0, calc(100% - c) 0, 100% c, 100% 100%, c 100%, 0 calc(100% - c))` | 4/8/14/18/28 — cards 14–18, heróis 20–28 |
| Só sup.-dir. | `.lx-cut-tr` | `polygon(0 0, calc(100% - c) 0, 100% c, 100% 100%, 0 100%)` | 8 (tooltip, fx, promo, caixa de fato) |
| Espelhado (OVR, icon-button) | `.lx-cut-tl-br` | `polygon(c 0, 100% 0, 100% calc(100% - c), calc(100% - c) 100%, 0 100%, 0 c)` | 8–18 |
| Paralelogramo | `.lx-skew` + `.lx-k-{sm,md,lg}` | `polygon(k 0, 100% 0, calc(100% - k) 100%, 0 100%)` | 6 (chip) · 7 (idade) · 8 (segmento) · 10–12 (botão) |
| Lado direito inclinado | `.lx-skew-r` | `polygon(0 0, 100% 0, calc(100% - k) 100%, 0 100%)` | ribbon, tag do ticker (14), time visitante |
| Lado esquerdo inclinado | `.lx-skew-l` | `polygon(k 0, 100% 0, 100% 100%, 0 100%)` | time da casa, célula de competição |
| Barra de dados | `.lx-edge` (+ `--lx-edge`) | `box-shadow: inset 3px 0 0 var(--lx-edge)` | zona, efeito, fato, post oficial |

**Placa (`.lx-plate`)**: a borda-gradiente é o `background` do host (`--lx-bd`, 140°: `rgb(140 165 255/.46)` → .10 (38%) → .08 (70%) → `rgb(59 228 255/.34)`), o miolo é o `::before` com `inset: var(--lx-bw, 1px)` e o **mesmo** `clip-path` — por isso o chanfro também ganha filete (~1,4px). Miolo padrão `linear-gradient(180deg, rgb(20 30 104/.78), rgb(11 17 62/.92))`. Variantes: `--flat` (dados), `--glass` (backdrop-filter **no host**), `--gold` (gala), `--premium` (card do jogador / opção Europa), `--selected` / `[aria-checked|pressed|selected=true]` (borda ciano + miolo `rgb(18 52 130/.85) → rgb(10 22 74/.95)`), `--tr` (só canto sup.-dir.), `--interactive` (hover −2px).

**Regras duras do clip-path** (bugs encontrados no mockup):
1. `clip-path` corta `box-shadow` externo, `outline` e `filter` do próprio elemento. **Elevação e brilho vão no wrapper sem recorte** (`.lx-elev-1/2/3/glow/gold` usam `filter: drop-shadow`, que segue a silhueta recortada dos filhos). O "glow ciano" da idade atual e o foco do mockup eram invisíveis por isso.
2. `clip-path` torna o elemento um *backdrop root*: `backdrop-filter` precisa estar **no host recortado**, não num `::before`.
3. Wipes (`clip-path: inset()`) animam num elemento sem outra forma de recorte e com `fill-mode: backwards` — senão o `inset(0)` final corta a sombra para sempre.

### 4.3 Elevação (contrato + privados)

| Token | Valor | Onde |
|---|---|---|
| `--shadow-1` | `inset 0 1px 0 rgb(255 255 255/.05), 0 10px 30px -12px rgb(0 0 0/.6)` | elementos **sem** recorte (dropdown, toast) |
| `--shadow-2` | `0 24px 60px -20px rgb(0 0 0/.75), 0 0 0 1px rgb(134 156 255/.10)` | modal/sheet sem recorte |
| `--shadow-3` | `0 40px 80px -24px rgb(0 0 0/.8), 0 0 48px -8px rgb(59 110 255/.35)` | card herói sem recorte |
| `--glow-accent` | `0 0 0 1px rgb(59 228 255/.55), 0 0 24px -4px rgb(59 228 255/.55)` | seleção em elemento sem recorte |
| `--lx-drop-1` | `drop-shadow(0 4px 6px rgb(0 0 0/.55))` | troféus pequenos, lower-thirds |
| `--lx-drop-2` | `drop-shadow(0 14px 24px rgb(0 0 0/.5))` | prompt de lance, lower-third grande |
| `--lx-drop-3` | `drop-shadow(0 40px 60px rgb(0 0 0/.6)) drop-shadow(0 0 40px rgb(59 110 255/.35))` | card do jogador (hero) |
| `--lx-drop-gold` | `drop-shadow(0 24px 30px rgb(0 0 0/.6)) drop-shadow(0 0 28px rgb(247 201 72/.35))` | troféus no hero |
| `--lx-drop-trophy` | `drop-shadow(0 16px 20px rgb(0 0 0/.6))` | `.lx-trophy` |

Utilities: `elev-1/2/3` (box-shadow), `glow-accent`, ou `shadow-(--shadow-2)`.

### 4.4 Luz e textura

- **Varredura** `.lx-sweep`: faixa 45% de largura, `linear-gradient(105deg, … rgb(255 255 255/.20) 50% …)`, `skewX(−18deg)`, percorre −60% → 130% em 28% de um ciclo de **7 s** (`--lx-ease-sweep`), atraso 1.2 s. Só em "placas premium": OVR, placa do clube, card do jogador. `--once` = 1 passada de 1.6 s (ex.: badge ao mudar de tier).
- **Grão** `.lx-noise-layer` / `.lx-noise::after`: turbulência 160px, opacidade .07, `overlay`.
- **Vidro** `.lx-glass`: `--glass` + `blur(14px) saturate(1.3)` + anel interno `--border-strong`.
- **Halo de troféu** `.lx-trophy-halo`: radial 190px ouro .30. **Linha de prateleira** `.lx-shelf::after`: 2px ouro→branco→ouro com glow 18px.
- **Estádio** `.lx-stadium` (camada `position: fixed`, `z-index: 0`, `pointer-events: none`): 4 radiais + gradiente noite; 4 feixes cônicos (`is-l/l2/r/r2`, ±28° e ±14°, 60vw × 120vh, blur 6, `screen`); 2 torres de luz 6×3 pontos 6px com bloom; névoa; grade de campo em perspectiva (`rotateX(64deg)`); bokeh; grão. Variantes: `--calm` (telas de dados: feixes .45/.25, sem torres), `--gala` (ouro), `--club` (tinge com `--club` 30%), `--press` (spot central). Cone simétrico: `.lx-spot-cone`.

> ⚠️ `conic-gradient(from X …)`: os ângulos das paradas são **relativos ao `from`**. O mockup usava `from 180deg` com paradas 150–210° (hero), 160–200° (armário da camisa) e 163–197° (gala) → o cone apontava para **cima** e era invisível. Cone para baixo centrado: `from 163deg` + paradas 0…34deg (ou `from 150deg` + 0…60deg). Corrigido no tema.

---

## 5. Componentes base (anatomia com medidas)

Todas as medidas são desktop; entre parênteses, mobile (≤ 639px).

### 5.1 Topbar
Altura 64 (56) · padding 0 28 (0 14) · gap 18 (10) · fundo `linear-gradient(180deg, rgb(4 7 30/.85), rgb(4 7 30/.35))` + `border-bottom: 1px var(--border)`.
- Marca: símbolo 34 (28) + "LENDA" 28px (24) 800 it .05em + sub "SIMULADOR DE CARREIRA" 10px 700 .24em `--text-3` (some no mobile). Arte: `art/brand-mark.svg`.
- Nav: links 15px 700 .1em caixa-alta `--text-3`, padding 8/14; ativo `--text` + sublinhado 3px `--accent` com glow 12px a −12px da base. Some no mobile (vai para tab bar / menu).
- Seletor de idioma: pad 3, gap 2, botões 30h pad 0 12, 13px 700 .08em, bandeira 18×13; ativo ciano .14.
- Chip de temporada: 40h, pad 0 16 0 14, paralelogramo 8, bolinha 6px ciano com glow, rótulo 10px, ano 20px 800 it.
- Icon-button `.lx-icon-btn`: 40×40, chanfro espelhado 8, ícone 20, fundo `rgb(28 38 120/.55)` + anel .25.

### 5.2 Botões `.lx-btn`
Host **sem** recorte; `::before` = preenchimento recortado (paralelogramo `--lx-k`), `::after` = anel de foco.

| Tamanho | Altura | Padding | Fonte | `--lx-k` |
|---|---|---|---|---|
| padrão | 54 | 0 30 | 19px 800 it .06em | 12 |
| `--sm` | 42 | 0 20 | 16px | 10 |
| `--xs` | 32 | 0 14 | 14px .08em | 7 |
| `--sq` | 54×54 (42×42 com `--sm`) | 0 | — | 10 |

Skins: `--primary` ouro (`#FFF3C0 → #FFD55A 40% → #E9A61E`, tinta `#241400`, `inset 0 −3px 0 rgb(120 70 0/.35)`) — **CTA principal por tela, só um** · `--accent` ciano (`#9AF3FF → #1FB8FF`) — "ir para o jogo" · `--ghost` (navy + anel .5) · `--line` (navy .6 + anel .38) · `--danger`. Hover `brightness(1.08)`; active `translateY(1px) scale(.99)`; disabled `saturate(.3) brightness(.7)`. Ícone à direita 18px (seta `ArrowRight`).

### 5.3 Chips, efeitos, kicker
- `.lx-chip`: 24h, pad 0 10, 14px 700 .06em, paralelogramo 6, fundo `rgb(8 12 44/.55)`; bandeira 20×14. Skins: `--pos`, `--num` (branco .12), `--accent`, `--gold`, `--pos-ok`, `--neg`, `--solid-gold`, `--live` (bolinha branca piscando 1.4 s), `--sm` (20h 11px .12em), `--new` (16h 9.5px ouro).
- `.lx-fx` (consequência): 38h (34 mobile; `--sm` 30), pad 0 10 0 8, 16px 700 .03em, recorte sup.-dir. 8; bloco-ícone 24×24 com fundo da cor a 16%; barra inset 3px; probabilidade à direita 15px tabular em `rgb(0 0 0/.25)`. Cores via `--lx-fx`: `--up`, `--down`, `--gold`, `--info`, `--neu`. **Sempre** ícone + texto + sinal (+/−), nunca só cor.
- `.lx-kicker`: 12px 700 .18em ciano (`--gold` para glória) com bloco inclinado 14×10 antes; `--plain` sem bloco (use a bolinha ao vivo 8px).
- `.lx-you` "SEU CLUBE": 10px 800 .14em, ciano sólido, tinta navy, paralelogramo 3.
- `.lx-form` V/E/D: 18×18, 11px 800, paralelogramo 3; V verde .2, E cinza .14, D vermelho .18 (letra sempre presente).

### 5.4 Badges de OVR
- `.lx-ovr` (padrão): chanfro espelhado 14, rótulo "OVR" 13px 800 .2em opacidade .72, número 64px 800 it −.02em (margem direita .06em para o itálico).
- `--xl`: 116×126, chanfro 18, número 70 (mobile 92×112, número 56, rótulo 11). Resumo usa 118×134 com rótulo "PICO".
- `--md`: 54×60, chanfro 9, número 32, rótulo 9 (identidade, card da partida).
- `.lx-ovr-s` (linha): 44×24 (38×22), 17px (15) 800 it tabular, paralelogramo 6; `--ghost` para projeção (linha pendente).

### 5.5 Abas, segmentado, campos
- `.lx-tabs` 50h pad 0 14 (0 6), rolagem horizontal sem barra no mobile; `.lx-tab` pad 0 14 (0 10), 15px (13) 800 .12em, ícone 15; ativa: `--text` + sublinhado 3px ciano (glow 14) que escala de 0→1 em `--dur-1`. `role="tab"` + `aria-selected`.
- `.lx-seg`: pad 4 gap 4, paralelogramo 10; botões 36h pad 0 20, 15px 800 .12em, paralelogramo 8; ativo = branco → `#C9D1F0`, tinta `#0A0F3A`. `role="radiogroup"` + `aria-checked`.
- `.lx-field`: 48h pad 0 14, chanfro espelhado 8, 22px 800 .08em caixa-alta, fundo `rgb(6 10 40/.7)` + anel `--border-strong`; foco = anel 1.5px ciano + brilho interno 20px; cursor ciano 2×24 piscando. `--search` 46h, 15px corpo, ícone `Search` 18 + `.lx-kbd` "CTRL K".

### 5.6 Lower-third `.lx-lt`
Bloco-ícone (min 44w, pad 0 12, lado direito inclinado 10) + placa navy (`rgb(18 28 100/.96) → rgb(9 14 58/.96)`, pad 6 18 6 16, −6px de sobreposição, paralelogramo 10, brilho superior 1px). Rótulo 11px 700 .2em `--text-3`; valor 21px 800 it caixa-alta. Sombra no host (`drop-shadow(0 14px 24px rgb(0 0 0/.5))`). Blocos: ouro (padrão), `--accent`, `--club`, `--yellow`, `--red`, `--live`. Usos: prêmios no hero, transferência, eventos da partida (cartão, substituição, gol), pergunta da coletiva (valor em Barlow 500 21px, não caixa-alta), manchete.

### 5.7 Ticker "Central Lenda" `.lx-ticker`
44h (40), fundo `rgb(8 13 52/.96) → rgb(4 7 32/.98)` + topo 1px `--border-strong`. Tag ouro (17px 800 it .08em, lado direito inclinado 14; pode conter chip "AO VIVO" 20h 12px). Viewport com máscara 48px/70px e −14px de sobreposição. Itens 16px 600 .04em `--text-2`, sigla 800 `--text`, posição 800 `--text-3` (ciano no G4, vermelho no Z4), pontos 800 ciano tabular; seção 16px 800 it .1em ouro com mini-troféu 12px; separador losango 8px ciano .6. **Mecânica**: o conteúdo é renderizado 2× (a 2ª cópia `aria-hidden`), `translateX(-50%)` linear infinito, **segura 3.5 s** antes de rolar; duração = largura de uma cópia ÷ **45 px/s** (React seta `--lx-crawl-dur`). Pausa em hover/focus (`WCAG 2.2.2`). Mobile: esconde o texto da tag, mantém o ícone.

### 5.8 Tela de carreira (compartilhada: carreira / celebração / tabela)
Grid `548px minmax(0,1fr)`, gap 18, max 1400, pad 14 24. **Trava na viewport** quando `≥1024w e ≥820h`: página `100vh` sem scroll, colunas `calc(100vh − 64 − 44)`; a tabela rola por dentro. Coluna esquerda: gap 10.

1. **Cabeçalho do jogador** (`p-head`): grid `116px 1fr` gap 10, altura 126 (92/112). OVR `--xl` com `.lx-sweep`. Placa `.lx-club-plate` (chanfro 16, pad 14 18 / 10 12): coluna principal (chips BRA · pos · #9 SOBRENOME → escudo 44 (32) + nome 40px (30) 800 it com `text-shadow 0 2px 12px .35` → meta 13px branco .74 "logo 16 · Liga · Papel") + coluna lateral separada por filete branco .14 (IDADE 40px, VALOR 40px com "€" e "M" a .62em). Mobile: lateral some, IDADE/VALOR vão para uma linha 24px sob o nome.
2. **Faixa de stats**: placa flat chanfro 12, 4 colunas, 66h (64); célula pad 0 18 (0 10); divisor 1px `--lx-line-3` inclinado −14° entre células; rótulo com ícone 14 (some no mobile); valor 33px (28); gols com "0,33/J" 14px 700 `--text-3`; títulos em `.lx-metal-gold`.
3. **Sala de troféus**: placa flat chanfro 12 pad 10 18 8; cabeçalho kicker ouro + "7 TÍTULOS · 1 PRÊMIO"; prateleira 80h, linha de luz a 15px da base; grupos com pilha 58h, troféus 36px sobrepostos −14px, legenda 11px .12em com "2×" ouro 800. Mobile: rolagem horizontal com máscara, troféus 30×50.
4. **Card de decisão**: placa chanfro 16 pad 14 16, hairline ciano no topo; kicker "DECISÃO · JANELA DE TRANSFERÊNCIAS" + timer à direita (12px .14em com relógio 14) ; título `.lx-t-sec`; subtítulo 14.5/1.42 max 500 com clube em `--text` e valor em ouro. Opções: grid 2 colunas gap 12 (8). **Opção**: placa chanfro 14 pad 12 12 10; rótulo "ASSINAR COM" 10.5px; nome 24px (20); área do escudo 86h (70–110) com `.lx-club-halo` e filete inferior; escudo 74 (70); linha liga 13.5px .06em (logo 18, bandeira 18×13, ponto 3px); termos 12.5px (`FileText` 13 + "5 anos" + "€11,5M/ano"); fx empilhados gap 6 no rodapé. Ribbon "RECORDE" 11px .14em ouro no topo (10px, −1px da esquerda). Opção Europa = `--premium`. Hover −2px.
5. **Tabela da carreira**: placa flat chanfro 18 pad 0 0 12; abas (Carreira · Classificação · Bola de Ouro [NOVO] · Seleção) + legenda "↳ EMPRÉSTIMO" à direita. Grid das linhas: **`54 | 1fr | 62 | 66 | 62 | 62`** (mobile **`42 | 1fr | 46 | 40 | 36 | 34`**); cabeçalho 34h (rótulo 11px .16em com ícones 13); linhas 30h, gap 3, pad lateral 14 (8).
   - Linha: `.lx-club-row` + `.lx-club-age` + célula do clube (pad-l 8, gap 9, "↳" 15px para empréstimo, escudo 22 (20), nome 17px (15) 700 .02em, tag "EMP." 10px .14em com anel, troféus da temporada 13px, posição final `.lx-rank` à direita com logo da liga 16 a .75) + OVR `.lx-ovr-s` + J/G/A 18px (16) 700 tabular (0 → `.lx-zero`, ≥20 gols → `.lx-hi`). Mobile esconde tag EMP. e posição final.
   - Pendente `.lx-pending`: listras 115° ciano .07/.02 (8px) + anel .35; idade ciano; "?" 22px pulsando 1.6 s; "DECISÃO DE CARREIRA…" ciano it .08em; OVR ghost; traços.
   - Futuras: altura flexível 14–24px; idade 14px 700 `--lx-text-4`; ano 12px 600 .08em; linha tracejada; **marcador de Copa do Mundo** (mini troféu 9px + "COPA DO MUNDO 2038" 11px .14em ouro .75; idade em ouro .8) a cada 4 anos a partir de 2026. Mobile: substituídas por caixa tracejada 30h "⏱ 13 temporadas pela frente".
   - Seleção: 40h, margem 8 14 0, fundo `gold .20 → green .12 → navy .30`, lado direito inclinado 10, topo inset ouro .45; bandeira 34×24 no lugar da idade; nome it 800; rótulo "SELEÇÃO" 10px no lugar do OVR.
6. **Aba Classificação**: seletor de liga (chips 32h 13px .08em paralelogramo 6, logos 18; ativo ciano .16 + sublinhado inset 2px) + meta "2035 · 38ª RODADA · FINAL". Grid **`40 | 1fr | 44 | 36 | 36 | 36 | 36 | 48 | 120`** (#, clube, P, J, V, E, D, SG, últimos 5); linhas 27h (cabeçalho 30), fundo navy .30 com lado direito inclinado 6; posição 16px 800 com barra de zona; escudo 20; nome 16px 700; P 18px 800 `--text`; demais 16px 700 `--text-2`; SG verde/vermelho; forma = 5 `.lx-form`. Seu clube `.lx-row-me`. Corte do Z4 tracejado. Legenda 11.5px .12em (quadrados 10px). Faixas "▲ SOBEM DA SÉRIE B" / "▼ CAEM" 2 colunas, recorte sup.-dir. 8, pad 8 12, rótulo 12px 800 .14em, escudos 24.

### 5.9 Identidade (nova carreira)
Stepper no topbar: número 30×24 paralelogramo 6 (ativo ciano com glow 16, tinta navy) + rótulo 14px 800 .14em + barras 56×2 (concluída ciano). Wrap max 1360 pad 16 32 0; título 52px (40) + texto 15/1.45 max 420 alinhado à direita (esquerda no mobile). Colunas **`372 | 1fr | 396`** gap 16 → ≤1279 **2 colunas** (a 3ª ocupa a linha toda, min-h 520) → ≤767 **1 coluna**. Painéis `.lx-plate` chanfro 18 pad 18; cabeçalho: índice "A/B/C" 28×22 ciano + título 22px 800 it + rótulo à direita.
- A · Identidade: armário 200–290h (radial ouro .22 + cone de luz + cabide 120×3 + sombra de chão) com camisa 268px (`art/jersey.svg`); campos `1fr 104` gap 10 (sobrenome com contador 5/12, número com stepper −/+); "PERNA DOMINANTE" segmentado 2 colunas 38h; caixa de início (OVR `--md` bronze 50 · IDADE 16 · VALOR €100K · POTENCIAL "? ? ?" ciano, valores 20px 800 it).
- B · Nacionalidade: busca 46h; confederações (chips 28h 12.5px .12em); grade 2 colunas linhas 46h gap 6 com máscara inferior 85% (bandeira 32×24, nome 15px 600, estrelas de títulos mundiais 11px ouro; selecionado = gradiente ciano .24→.06 + barra inset 3 + anel + check 20px); rodapé "Origem: Brasileirão · 3 clubes vão disputar sua assinatura" (verde .10 + anel, escudos 26).
- C · Posição: campo vertical (`art/pitch-vertical.svg`) com nós HTML posicionados em % (GOL 50/90, ZAG 50/77, LE 18/70, LD 82/70, VOL 50/62, ME 18/47, MC 50/50, MD 82/47, MEI 50/37, PE 20/20, PD 80/20, CA 50/15): nó min 48×30 15px 800 .08em paralelogramo 7, ativo 58×34 17px ciano gradiente com glow radial 150×110 atrás; caixa de info (título 22px + 3 atributos: rótulo 12px, valor 14px, barra `.lx-attr-bar` 5px).
- Rodapé: "Voltar" `--line --sm` · resumo 48h paralelogramo 10 com chips 26h · "Confirmar identidade" `--primary`.

### 5.10 Landing
Hero grid `minmax(0,600px) 1fr` gap 24 max 1360 pad 18 40 20; ≤1279 empilha (arte em cima, altura 520, escala .74); ≤639 arte 400h escala .6, some lower-third esquerdo, fx flutuante e nós não ativos.
- Cópia: kicker plain com bolinha ao vivo; H1 96px (60) com "FUTEBOL" em ouro + `.lx-gold-glow-sm`; lede 17/1.5 max 520 (15.5).
- Cards de modo: grid 2 colunas gap 12 (1 coluna mobile), placa chanfro 16 pad 16 16 14 min-h 124; ícone 34×34 chanfro espelhado 7 (clássico ciano `Zap`, imersivo ouro `Play`); título 23px 2 linhas; tag à direita; texto 13.5/1.42; rádio 18px (anel 2px `--lx-text-4`, selecionado ciano com ponto 4px). Selecionado = `--selected`.
- Ritmo: segmentado INTENSA/NORMAL/EXPRESSA + dica 13px ("Decisões a cada 2 temporadas · ~12 min").
- CTAs: `--primary` "Começar carreira →" · "Continuar carreira salva" (`--line`, 2 linhas: 12px corpo + 17px) · quadrado `Medal`. Letras miúdas 12.5px com `Check` 14 verde.
- Arte: palco 720×700 — cone de luz, chão holográfico (`art/pitch-floor.svg` em `perspective(900px) rotateX(64deg)` + máscara radial), halos ouro/ciano, número "9" 560px contornado a .16, card do jogador 318×448 `rotate(-2deg)` chanfro 28 com borda ouro→ciano (OVR 78px ouro, camisa 270, nome 54px, sub 12px .24em, 3 stats 30px) + `.lx-elev-3`, Bola de Ouro 150 e Copa 112 com `--lx-drop-gold`, lower-thirds e fx flutuantes, nós de posição.
- Ticker com a **classificação real** do Brasileirão (G4 ciano, Z4 vermelho).

### 5.11 Celebração "CAMPEÃO!" (overlay)
Fundo: app com `.lx-dim-behind` (`blur(6px) brightness(.42) saturate(.7)`, escala 1.01). Camadas (`.lx-cele`, z 50): laterais na cor do clube (30% largura, 35%) → raios (1800px, `repeating-conic` 5°/15° ouro .13, máscara radial, gira 60 s) → anéis 560/720 → halo 760 (pulsa 3 s) → flash 260 → confete (110 peças, **seed fixa 7**, 4–9 s) → palco centralizado: competição (logo 64 + nome 18px .28em ouro-hi + "GRANDE FINAL · 2035" 12px .3em) → troféu 200px (`.lx-trophy-in`) com elipse de chão 260×30 → "CAMPEÃO!" `.lx-t-celebrate` ouro, margem −18 → linha 22px 700 .06em ("**2ª LIBERTADORES**" em ouro) → placar `.lx-score` (62h, times min 250, 26px, escudo 40; resultado 130 min 40px; local 11px .2em abaixo) → autores dos gols 14px (seu gol em ouro) → 3 recompensas 46h (ícone 28 ouro) → "também nesta temporada" (placa canto inf.-dir. 36px das bordas) → "TOQUE PARA CONTINUAR" 13px .3em piscando 2 s. `role="dialog" aria-modal="true"`, foco no overlay, Esc/Enter/toque fecha.

### 5.12 Bola de Ouro (gala)
Fundo `.lx-stadium--gala` + pontos 28px + spots (cone corrigido). Layout `1.25fr 440px` gap 28 max 1380. Palco: grid `300 1fr` — Bola de Ouro 260px (halo 520, reflexo `scaleY(-1)` .14 com máscara) + bloco do vencedor: evento 15px .3em ouro-hi com traço 36×2 + local 12px; "E O VENCEDOR É…" 26px 700 it; nome 124px (72) ouro; chips 30h 15px; caixa de fato (ouro .08 + barra 3px, recorte 10, ícone `Star` 22, 14.5/1.45); temporada (4 colunas com divisores ouro .14, 40px); ações "Subir ao palco" primary + "Discurso" line. Ranking: placa `--gold` chanfro 18 pad 18 18 14; linhas grid **`38 | 28 | 1fr | 92`** gap 10, 42h (1º 56h), gap 4; posição em bloco inclinado 22px (1º ouro 28px); escudo 26 (32); nome 18px 800 (1º 22px ouro-hi) + meta 12px com bandeira 16×12; pontos 18px tabular + barra 4px proporcional. Revelação do 10º ao 1º (§8). Rodapé: 2 prêmios paralelos (Gerd Müller, Clube do ano).

### 5.13 Resumo de fim de carreira
Wrap max 1380 pad 16 28 40 gap 12.
- Herói: placa chanfro 20, grid `minmax(540px,1fr) auto 290px`, min-h 172 → empilha ≤1279. Quem (gradiente do clube 100° .55→.15, marca-d'água 230 .08; OVR 118×134 "PICO" tier lenda; kicker ouro; nome 58px (40); chips + "24 temporadas · 6 clubes · destro" 14px; cadeia de escudos 24/18 com "›"). Números: 4 × 58px (44) com sub 12.5px. Legado: fundo ouro .10→.02, "97" 64px ouro + "LENDA MUNDIAL" 22px + "Top 0,3%" 12px, botão primary sm, link 13px .12em ciano.
- Prêmios `1.1fr 1.25fr 1fr` gap 12: card chanfro 18 pad 16 18 min-h 236 (arte 112×190 com halo 190; "3×" 88px ouro; anos em chips 26h ouro; ranking por ano 10 colunas: célula 26h 14px 800, 1º gradiente ouro, top-3 ouro .16, ano 10.5px). Card Copa com borda ouro/verde e placar da final (40h).
- Gráficos `1.9fr 1fr`: placa flat chanfro 18 pad 16 18 12, título 24px, nota 12.5px à direita; SVG 258h, margens `l30 r58 t22 b58`; faixas de tier; linha ciano com glow; ★ nas temporadas de Bola de Ouro; etiqueta "91 · PICO" branca; eventos tracejados; faixa de clubes 18h com escudos 20; tooltip (recorte 8, min 150). Barras de gols com topo raio 3 e legenda 11.5px.
- Inferior 2 colunas: sala completa (grid 5 → 3 no mobile, pilhas 74h, troféus 40 sobrepostos −18) + tabela por clube (`border-spacing 0 3`, th 11px .14em, td 30h 16px 700 tabular, total ouro .10).

---

## 6. Superfícies exclusivas do Modo Imersivo

Implementadas em `snippets-transmissao/effects/`. Medidas para 1440×900.

### 6.1 Tela de partida ao vivo — `match-screen.html`
Grid da página: `64px (topbar) | 1fr | 44px (ticker)`; miolo `290px | minmax(0,1fr) | 310px`, gap 16, pad 14 24, altura = viewport (sem scroll de página ≥1024×820).
- **Topbar**: marca · chip "AO VIVO" · "LIBERTADORES 2035 · FINAL · ESTADIO CENTENARIO" (rótulo `--text-2`) · chip "IMERSIVO" · pausar (`Pause`).
- **Centro** (coluna flex gap 10):
  1. Campo: placa flat chanfro 18, **`aspect-ratio: 1050/680`** (nunca `cover` — cortava o gol), `art/pitch-live.svg` + SVG de jogadores no mesmo sistema (x 0..1050, y 0..680 = metros × 10; casa ataca → direita). Bug de placar sobreposto a 16/14px do canto sup.-esq.; lower-third de eventos a 16/16 do canto inf.-esq. (some após 3.5 s).
  2. Momentum: placa flat 64h pad 8 12; SVG 900×48 `preserveAspectRatio=none`: linha central `--border-strong`; 1 barra por minuto (8 de largura, passo 10): casa para cima na cor da casa, visitante para baixo; gols = losango 10px (seu time ouro, adversário branco); minuto atual = linha 2px ciano.
  3. Controles: placa flat pad 10 14 — "POSTURA" segmentado (Pedir a bola · Equilibrada · Poupar energia; afeta energia/participação) + "VELOCIDADE" 1× 2× 4× + `--line --xs` "Próx. lance ›".
- **Esquerda**: "LANCES" (placa flat, lista `aria-live="polite"`): linha min 44h grid `44 | 22 | 1fr` gap 8, divisor `--border`; minuto em paralelogramo 24h 15px 800 it (seu evento = ouro); ícone 18 (bola, cartão amarelo/vermelho, substituição); título 15px 700 .04em + detalhe 12.5px `--text-3`; gols com barra inset 3px da cor do time. Novo evento entra no topo: `lx-drop-in` 300 ms + `lx-stamp` (flash ciano .35 → 0 em 900 ms). "ESTATÍSTICAS": linhas `40 | 1fr | 40` (valor 17px tabular · rótulo 11px centralizado · valor), barra dividida 6px com as cores dos times (posse, finalizações, xG…).
- **Direita**: card "você" (OVR `--md`, nome 22px, "CA · #9 · 71 MIN", **nota ao vivo** em paralelogramo 48×32 22px: ≥8.0 ouro, 7.0–7.9 `--positive`, 6.0–6.9 `--text-3`, <6 `--negative`; 4 KPIs 20px; energia `.lx-meter`); "NARRAÇÃO" (lista rolável, item 13.5/1.45 com minuto ciano 13px tabular, lances decisivos em negrito; se o usuário rolou para cima, pílula "↓ novos lances" em vez de auto-scroll); "TABELA AO VIVO" (3–5 linhas 26h com ▲/▼ de variação).
- **Ticker**: "AO VIVO · OUTROS JOGOS" (placares da rodada, minuto em ciano, INT) + artilharia.
- **Mobile (≤639)**: bug no topo 100% (40h: sigla 18, placar 24, relógio 18); campo full-bleed 16:10; momentum 48h; abas LANCES | NARRAÇÃO | ESTATS | TABELA; controles numa barra fixa inferior; ticker oculto.

**Bug de placar `.lx-bug`** — `scoreboard-bug.html`
Altura 44 (40). Células: competição 52w (`--bg-2`, lado esquerdo inclinado 10, logo 26) · casa min 76w (navy `#16217A → #0C1450`, sigla 22px 800 it .04em, faixa 6px do clube à esquerda, 1 retângulo 6×9 vermelho por expulso) · placar min 84w (branco → `#C8D0EE`, 28px 800 it tabular, travessão .45) · visitante (faixa à direita) · relógio min 88w (`--bg-2`, bolinha ciano, 22px 700 tabular, lado direito inclinado 10) · acréscimos `.lx-bug__extra` ("+3", 22h ouro, cai 8px sob o relógio, 18px da direita). Entra com wipe 700 ms. Estados: `data-phase="live|ht|ft"` (INT/FIM em ouro it .1em); **gol** `.is-goal[data-side-scored]`: placar pisca ouro 1.2 s e a célula do time que marcou abre para 220px com "SILVA 67'" (14px 700 ouro) por 4 s (`--dur-2`). Anúncio `aria-live="polite"`: "Gol do Palmeiras, Silva. Palmeiras 2, Boca 1."

### 6.2 Lance decisivo (prompt com cronômetro) — `key-moment.html`
Quando o motor pausa num lance-chave:
1. Campo escurece (`brightness(.7) saturate(.8)`, 450 ms) e ganha **holofote** `.lx-spotlight` (radial transparente até 70px, `rgb(3 5 26/.66)` a 170px) na posição do lance (`--lx-x/--lx-y` em %). Seu jogador: disco 28px branco com anel ciano 3px + anel de pulso 44px (`.lx-pitch-me`, 1.8 s) + etiqueta "SILVA · 7.4" (placa navy com anel ciano .6, 14px 800 it).
2. Prompt sobe do rodapé do campo (`translateY(24px)→0`, opacidade, 450 ms `--ease-out`): largura `min(760px, 100% − 40px)`, 20px da base, wrapper `.lx-elev-2`, placa chanfro 18 pad 16 16 14 com `.lx-hl-top`.
   - **Barra de tempo** `.lx-countdown` 4px colada no topo da placa (preenchimento `scaleX 1→0` linear, glow 12px) + **anel** `.lx-cd-ring` 44px (traço 4, `pathLength=100`, número 20px 800 it tabular no centro). Duração padrão **10 s** (`--lx-cd-dur`). Urgência: `data-urgency="warn"` em ≤5 s (`--warning`), `"crit"` em ≤3 s (`--negative` + piscar .5 s na barra).
   - Cabeçalho: kicker com bolinha ao vivo "LANCE DECISIVO · 78'"; título 28px; contexto 14.5px (placar/importância em `--text`).
   - Opções `.lx-options` grid 3 colunas gap 10 (2 ou 3 opções): `.lx-option` chanfro 12 pad 12 12 10 — tecla `.lx-option__key` 22×22 ("1/2/3", ciano), meta 12px .12em ("FIN 84 · CHUTE"), título 20px 800 it, 2 fx `--sm` (sucesso com % · falha com %). Uma opção tem a tag **"PADRÃO"** (9.5px .14em com anel) = escolha automática ao zerar.
   - Rodapé 13px: "Sem resposta → opção Padrão · teclas 1 2 3" / "Cronômetro: Ajustes › Acessibilidade".
3. Escolha: `aria-pressed="true"` na opção (borda 2px ciano + miolo ciano .12), as demais `opacity .4` (`.has-choice`), barra e anel pausam; após 650 ms o prompt sai, o campo clareia, o holofote some e entra o resultado (stinger "GOL!" §6.3 ou lower-third "LANCE · Driblar o goleiro").
- **Acessibilidade**: `role="alertdialog"` + `aria-labelledby/-describedby`; foco vai para a 1ª opção; `aria-live="assertive"` anuncia "Lance decisivo. 10 segundos. Opções 1, 2 ou 3." e "3 segundos."; cronômetro **pausa com a aba oculta**; ajuste "Lances sem cronômetro" (WCAG 2.2.1) e "Tempo ×2"; movimento reduzido → barra/anel em degraus de 1 s (`steps(var(--lx-cd-steps))`).
- **Mobile**: campo em cima (16:10, sem placa), prompt vira **bottom sheet** colado (−18px sobre o campo), opções empilhadas (tecla + meta + título numa linha, fx lado a lado).

### 6.3 GOL! stinger e lower-thirds de evento
- `.lx-stinger`: faixa 120h atravessando o campo em `skewY(-4deg)`, gradiente ouro com pontas transparentes; texto "GOOOL!" 110px 800 it tinta `#241400` (contra-inclinado). Entra com wipe 350 ms, fica 1.6 s, sai com `.is-out` (wipe para a direita, 350 ms `--lx-ease-in`) e dá lugar ao lower-third "GOL · 78' / SILVA · PALMEIRAS 2–1". Reduced motion: fade 150 ms.
- Lower-thirds de partida: cartão (`--yellow`/`--red` + `lx-i-card`), substituição (`--club` + `lx-i-sub`: "SAI VÍTOR · ENTRA LUAN"), VAR (`--accent` + `lx-i-var`), lesão (`--red` + `Ambulance`), fim de tempo (`--live`). Duram 3.5 s; nunca mais de 1 por vez (fila).

### 6.4 Central da semana / calendário — `hub-week.html`
Grid 12 colunas gap 14, max 1400, pad 18 24 40.
- Cabeçalho: kicker "CENTRAL · SEMANA 23 · 14–20 OUT 2035" + "SUA SEMANA" 52px + CTA primary "Simular até o jogo →".
- **Próximo jogo** (span 8, placa chanfro 18 min-h 230, `.lx-club-glow` ao fundo): kicker com competição/rodada; confronto grid `1fr auto 1fr` (escudo 76×88 com drop-shadow, nome 32px, posição/pontos 11px, forma 5 chips; "×" 26px `--text-3`); chips de data/local/"Titular provável"; **barra de probabilidade** 8h em 3 segmentos (vitória `--positive`, empate `--text-3`, derrota `--negative`) + legenda 12px .12em colorida; lateral: "FALTAM 2 DIAS" (56px tabular) + `--accent --sm` "Ir para o jogo".
- **Condição** (span 4, placa flat): medidores `.lx-meter--seg` 10px em 10 segmentos (Energia, Moral, Confiança do técnico — cor por limiar: ≥70 `good`, 40–69 padrão/`warn`, <40 `crit`) com valor 18px tabular; forma = 5 barras 14px de largura (altura ∝ nota; ≥8 ouro, ≥7 verde, resto `--text-3`).
- **Agenda** (span 12): 7 dias `.lx-day` (min 128w, pad 12 14, paralelogramo 10, fundo navy .35): dia 11px .16em, data 22px it tabular, atividade 15px 700 com ícone 18, chip de impacto `--sm` no rodapé. Estados: `is-past` (opacidade .6 + "✓"), `is-today` (gradiente ciano .16→.04 + barra superior 3px + anel .45), `is-match` (tinta do clube, escudo do adversário 26×30, chip "JOGO" live). Janela de transferências = `.lx-window-band` (listras ciano) na legenda e, no mês, faixa atravessando os dias.
- Linha inferior: Caixa de entrada (span 5; itens com barra 4px colorida por tipo: proposta ouro, cobrança âmbar, convocação ciano) · Classificação mini (span 4, com `.lx-row-me`) · Em alta (span 3).
- **Mês** (aba Calendário): grade 7 colunas, célula 116×92, data 14px tabular no canto sup.-esq., pílula de jogo (escudo 18 + "vs COR" + barra 3px na cor da competição), convocação com barra ouro, janela como faixa listrada contínua.
- ≤1023: tudo span 12. ≤639: próximo jogo em 1 coluna (escudos 48×56, nomes 22px), agenda rola na horizontal com `scroll-snap` (dias 132px) e máscara.

### 6.5 Coletiva de imprensa — `press-conference.html`
Cena: `.lx-stadium--press` + `.lx-press-wall` (padrão quincunce 180×110 da marca LENDA + "LENDA TV", 6%, máscara radial) + cone de luz central + mesa (360px da base, `#0C1450 → #03051A`, topo 1px .3) + `art/mic-cluster.svg` (320px, veículos **fictícios**: LTV, R+, ARQ — nunca marcas reais) + plaquinha "RAFAEL SILVA · PALMEIRAS" (chip 30h 16px).
- Topo: lower-third `--live` "AO VIVO / COLETIVA · PÓS-JOGO — PALMEIRAS 2×1 BOCA · FINAL"; à direita **Repercussão** (placa flat 300w: kicker + 4 pips de progresso 26×6 "pergunta 2 de 4"; barra 10px gradiente `--negative → neutro → --positive`; ponteiro 4×20 branco com glow que anda com `--ease-spring` 600 ms; extremos "CRISE · NEUTRO · ÍDOLO").
- Pergunta: lower-third `--accent` largura `min(980px,100%)` — bloco com iniciais do veículo + "Rádio"; rótulo "MARINA LOPES · RÁDIO ARQUIBANCADA"; pergunta entre aspas em Barlow 500 21px/1.35 (não caixa-alta).
- Respostas: grid 4 colunas gap 10 (2 ≤899, 1 ≤559), `.lx-option` min-h 150: tom `.lx-tone` (HUMILDE `--info`, CONFIANTE ciano, POLÊMICO `--negative`, EVASIVO `--text-2`; 11px 800 .16em), citação 15/1.45, chips de efeito `--sm` (Torcida +, Técnico +, Mídia ++, Diretoria −−, Valor +3%, Proposta ▲).
- Ao escolher: demais esmaecem; **flashes de câmera** (`.lx-camera-flash`, 180px radial branco `screen`, 220 ms, 5 flashes com seed fixa em ~450 ms; nenhum com movimento reduzido); ponteiro de repercussão se move; entra lower-third "MANCHETE: …". Coletiva **sem cronômetro** por padrão.

### 6.6 Rede social ("Arquibancada") — `social-feed.html`
Grid `280 | minmax(0,600) | 300` gap 18 (≤1099: coluna única, laterais viram grade).
- Perfil (placa): avatar 72 (chanfro espelhado 6, anel do clube), nome 24px, handle ciano 13px + selo verificado (`BadgeCheck` preenchido ciano), "SEGUIDORES" + 34px tabular, chip "+184K ESTA SEMANA".
- Humor da torcida: barra de 12 segmentos 14h (paralelogramo 3) negativo/neutro/positivo + 3 percentuais.
- Compositor: kicker "POSTAR APÓS O JOGO" + 3–4 respostas prontas `--line --xs` (o jogo não tem texto livre).
- Post `.lx-post` (placa flat chanfro 8 pad 14 16): grid `40 | 1fr` gap 12; avatar 40 chanfro 6; cabeçalho nome 15px 700 + selo 15px + "@handle · 12 min" 13px `--text-3`; texto 15/1.45 com @/# em ciano 600; mídia 16:9 com chanfro 8 (arte gerada: campo/placar — nunca foto real); ações `MessageCircle / Repeat2 / Heart / Eye` 16px + contagem 13px 600 tabular `--text-3` (curtido = `--negative` preenchido); ribbon "EM ALTA" ouro no canto sup.-dir. Tipos: veículo (avatar ciano), **oficial do clube** (`.lx-post--official`: barra 3px + avatar com anel do clube), torcedor (avatar `--surface-3` com iniciais), jogador rival.
- Em alta: lista numerada, hashtag 15px 700 ciano + contagem 12.5px.

### 6.7 Negociação de contrato — `contract.html`
Placa chanfro 28 (max 1120) pad 20 22 18 com `.lx-hl-top`.
- Cabeçalho: escudo 52×60 · kicker "NEGOCIAÇÃO · RENOVAÇÃO" + "PALMEIRAS × SILVA" 30px · rodadas "RODADA 2/3" + 3 pips 30×8 (feita `--text-2`, atual ciano com glow).
- **Paciência da diretoria**: `.lx-meter--seg` (10 segmentos) + "6/10" — perde 1–3 por contraproposta agressiva; em 0 a mesa fecha.
- Termos (grid `170 | 140 | 1fr | 92`, linhas min 64h com divisor): rótulo `.lx-t-row` · "Clube oferece" 22px tabular `--text-2` · sua contraproposta (slider `.lx-range` + valor 24px 800 it tabular, ou segmentado para anos/papel) · delta em chip (`--gold` se pedir mais, `--neg` se ceder, "=" neutro). Termos: salário/ano, duração, luvas, multa para a Europa, papel (Rotação/Titular/Capitão), bônus.
- **Slider `.lx-range`**: trilho 6px (preenchido `--lx-accent-2 → --accent` até `--lx-v`), polegar retangular 16×26 branco com anel navy e glow ciano (foco: anel 2px `--bg` + 2px ciano); **teto do clube** = triângulo ouro 6px sobre o trilho em `--lx-cap` (`.lx-range-wrap__cap`). React só mantém `--lx-v = (v−min)/(max−min)`.
- Lateral (280w): **Chance de aceite** 64px 800 it tabular (cor: ≥65 `--positive`, 35–64 `--warning`, <35 `--negative`) + `.lx-meter` + "Acima do teto em 2 termos"; conselho do empresário (avatar "AG" ciano chanfro 6, texto 14px).
- Ações à direita: "Recusar" (line, texto `--negative`) · "Enviar contraproposta" (ghost) · "Aceitar proposta" (primary). ≤899: termos viram cartões (rótulo+delta / clube / slider).

### 6.8 Palco de cerimônia — `ceremony.html`
Generaliza a Bola de Ouro para qualquer prêmio (Craque do Brasileirão, Bola de Prata, Seleção do campeonato, Puskás).
- Fundo `.lx-stadium--gala` + 3 spots (520w, cone corrigido) que **balançam ±8°** (4 s alternado, defasados 1.3 s).
- Cabeçalho: evento 15px .3em ouro-hi entre traços 36×2; "OS INDICADOS SÃO…" 26px it `--text-2`.
- Indicados: grid 3 × 240px gap 22 (3 colunas fluidas no mobile, camisas 90px, sem stats); card `.lx-plate--gold` chanfro 18: camisa paramétrica 150px, nome 28px, sigla + OVR `.lx-ovr-s`, stats J/G/A 24px (gols `.lx-hi`); entram com stagger 60 ms.
- "Abrir envelope": texto troca para "E O VENCEDOR É…", **1.5 s de suspense**, então `.revealed`: spots convergem para o centro (1.2 s `--ease-out`), vencedor `translateY(-12px) scale(1.08)` com `--ease-spring` 700 ms, demais `opacity .35 saturate(.4) translateY(8px) scale(.97)`; nome 96px (64) ouro entra 500 ms depois (espaço de 104px já reservado — não empurra o layout); confete ouro opcional. Depois: discurso (3 opções no padrão da coletiva) e ranking completo (§5.12).

---

## 7. Iconografia

**Base: `lucide-react`** (verificado na v1.48): traço 2, `strokeLinecap/Join="round"`, `currentColor`. Tamanhos: 13 (cabeçalho de coluna, termos) · 14 (rótulos de stats, dicas) · 15 (abas) · 16 (ações de post, fx `--sm`) · 18 (botões, eventos) · 20 (icon-button) · 22 (lower-third). Cor = cor do texto do contexto; nunca ícone colorido sozinho sem rótulo (exceto cartões com texto ao lado).

| Conceito | lucide-react | Conceito | lucide-react |
|---|---|---|---|
| avançar / voltar | `ArrowRight` / `ArrowLeft` | conquistas | `Medal` |
| ajustes | `Settings` | compartilhar | `Share2` |
| busca | `Search` | confirmado | `Check` / `CircleCheck` |
| +OVR / −OVR | `TrendingUp` / `TrendingDown` | título / capitão | `Crown` |
| troféu genérico | `Trophy` | Bola de Ouro / prêmio | `Star` |
| contrato | `FileText` / `Signature` | transferência | `Plane` |
| relógio / cronômetro | `Clock` / `Timer` | ao vivo (TV) | `Tv` / `Radio` |
| titular / camisa | `Shirt` | reserva | `Armchair` (ou `lx-i-bench`) |
| classificação | `ListOrdered` | calendário | `CalendarDays` |
| treino físico / tático | `Dumbbell` / `Target` | descanso / recuperação | `BedDouble` / `HeartPulse` |
| coletiva / mídia | `MicVocal` / `Newspaper` | manchete | `Megaphone` |
| comentário / repost / curtir / views | `MessageCircle` / `Repeat2` / `Heart` / `Eye` | verificado | `BadgeCheck` |
| empresário / negociação | `Handshake` | dinheiro | `Banknote` / `Wallet` |
| lesão | `Ambulance` / `Bandage` | energia | `BatteryMedium` / `Zap` |
| empréstimo | `CornerDownRight` (ou "↳" tipográfico) | substituição | `ArrowLeftRight` (ou `lx-i-sub`) |
| pausar / play / acelerar | `Pause` / `Play` / `FastForward` | aviso | `TriangleAlert` |

**Ícones esportivos próprios** (`art/icons-sport.svg`, grade 24, traço 2, mesma linguagem): `lx-i-games` (jogos), `lx-i-ball` (gol), `lx-i-boot` (assistência), `lx-i-pitch`, `lx-i-bench`, `lx-i-card` (preencha com `--lx-card-yellow/red`), `lx-i-whistle`, `lx-i-armband`, `lx-i-glove` (defesa), `lx-i-post` (na trave), `lx-i-sub`, `lx-i-var`. Em React, prefira transformá-los em componentes (`<SportIcon name="ball" size={18}/>`) no mesmo contrato de props do lucide.

Escudos e logos: **cache local** (o mockup fazia hotlink da ESPN — só para protótipo); sempre `alt` com o nome do clube quando for informação, `alt=""` quando decorativo (marca-d'água, halo). Enquanto carrega ou para clubes fictícios: `art/crest-fallback.svg`.

---

## 8. Motion

### 8.1 Tokens

| Token | Valor | Uso |
|---|---|---|
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | entradas, wipes, linhas (motion: `[0.2,0.8,0.2,1]`) |
| `--ease-spring` | `cubic-bezier(.2,.9,.2,1.1)` | troféu, vencedor, ponteiro (motion: `[0.2,0.9,0.2,1.1]` ou `{type:"spring", stiffness:420, damping:28}`) |
| `--dur-1` | 180ms | hover, press, sublinhado de aba, cor |
| `--dur-2` | 450ms | linhas, chips, lower-thirds, prompt, flip |
| `--dur-3` | 700ms | placas, wipes grandes, placar, troféu |
| privados | `--lx-ease-in` `(.5,0,.75,0)`, `--lx-ease-sweep` `(.6,0,.2,1)` | saídas, varredura |

### 8.2 Catálogo

| Momento | O que anima | Duração · easing · atraso/stagger | Reduced motion |
|---|---|---|---|
| Entrada de placas (`.lx-anim-rise`) | `translateY(14px)→0` + opacidade | 700 · ease-out · stagger **60 ms** (`--i`) | fade 1 ms (visível na hora) |
| Linhas da carreira/classificação (`.lx-anim-slide`) | `translateX(−14px)→0` + opacidade ("wipe de transmissão") | 450 · ease-out · stagger **35 ms** | sem |
| Placar / bug (`lx-wipe-in`) | `clip-path: inset(0 100% 0 0)→inset(0)` + opacidade .4→1 | 700 · ease-out · `backwards` | sem |
| Placas premium (`.lx-sweep`) | faixa de luz cruzando | ciclo 7 s (28% em movimento) · ease-sweep · 1.2 s | desligado |
| Aba ativa | sublinhado `scaleX 0→1` | 180 · ease-out | instantâneo |
| Hover de card/opção | `translateY(−2px)` | 180 · ease-out | sem |
| Linha pendente | "?" pisca | 1.6 s infinito | estático |
| Ao vivo | bolinha pisca | 1.4 s infinito | estática |
| Ticker | segura 3.5 s, rola a 45 px/s linear | infinito, pausa em hover/focus | parado, rolável manualmente |
| Contagem do OVR (fim de temporada) | número 78→81 | 1.2 s · ease-out | salta para o final |
| Troca de tier | `rotateY 0→90→0` (troca `data-tier` a 90°) + `.lx-sweep--once` | 450 · ease-out | troca direta |
| Linha nova "carimbada" (`.lx-stamp`) | fundo ciano .35→0 | 900 · ease-out | sem |
| Evento na partida | `translateY(−8px)→0` + stamp | 300 + 900 | sem |
| Gol no bug | placar ouro + célula 76→220px com autor | 1.2 s flash · 450 abrir · 4 s visível | cor muda, sem expansão animada |
| GOL! stinger | wipe in → segura → wipe out | 350 · 1.6 s · 350 (ease-in) | fade 150 |
| Lance decisivo: entrada | prompt `translateY(24px)→0`; campo escurece | 450 · ease-out | fade |
| Lance decisivo: cronômetro | barra `scaleX 1→0`, anel `dashoffset 0→100` | 10 s linear (urgência em 5 s/3 s) | **degraus de 1 s** (continua: é informação) |
| Lance decisivo: escolha | outras opções → .4; saída do prompt | 180 · 650 ms de espera | sem espera |
| Celebração: troféu | `translateY(40px) scale(.8)→1` com overshoot | 1 s · ease-spring | aparece |
| Celebração: textos | rise escalonado | .1 / .35 / .5 / .8 / .95 s | aparecem |
| Celebração: placar | wipe | 700 · .65 s | aparece |
| Celebração: raios / halo | rotação / pulsação | 60 s linear / 3 s ease-in-out | estáticos |
| Confete | queda com rotação 3D, seed fixa | 4–9 s linear infinito | **removido** |
| Coletiva: flashes | escala .6→1.1 + opacidade | 220 ms × 5 em ~450 ms | removidos |
| Coletiva: ponteiro | `left` | 600 · ease-spring | instantâneo |
| Cerimônia: spots | balanço ±8° → convergência | 4 s alternado → 1.2 s ease-out | estáticos |
| Cerimônia: vencedor | sobe 12px + escala 1.08; demais recuam | 700 · ease-spring | troca direta |
| Ranking Bola de Ouro | do 10º ao 1º: slide + contagem de pontos | 450 cada · stagger **600 ms** · pausa 1.2 s antes do 1º · contagem 800 | lista completa de uma vez |
| Medidores (`--lx-v` registrado com `@property`) | largura do preenchimento | 450 · ease-out | instantâneo |

### 8.3 Receitas com `motion` (motion/react)

```tsx
import { motion, MotionConfig, AnimatePresence, animate, useMotionValue, useTransform } from "motion/react";

// raiz do app: respeita o SO e o ajuste do jogo
<MotionConfig reducedMotion={settings.reduceMotion ? "always" : "user"}>…</MotionConfig>

// tokens em JS (espelham o CSS)
export const ease = { out: [0.2, 0.8, 0.2, 1], spring: [0.2, 0.9, 0.2, 1.1] } as const;
export const dur = { 1: 0.18, 2: 0.45, 3: 0.7 } as const;

// lista de linhas (stagger de transmissão)
const list = { show: { transition: { staggerChildren: 0.035 } } };
const row  = { hidden: { opacity: 0, x: -14 }, show: { opacity: 1, x: 0, transition: { duration: dur[2], ease: ease.out } } };
<motion.div variants={list} initial="hidden" animate="show">{rows.map(r => <motion.div key={r.id} variants={row}/>)}</motion.div>

// wipe do placar — num wrapper SEM clip-path próprio
<motion.div initial={{ clipPath: "inset(0 100% 0 0)" }} animate={{ clipPath: "inset(0 0% 0 0)" }}
  transition={{ duration: dur[3], ease: ease.out }} onAnimationComplete={e => (e.currentTarget.style.clipPath = "")} />

// prompt de lance decisivo
<AnimatePresence>{moment && (
  <motion.section key={moment.id} role="alertdialog" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
    exit={{ y: 12, opacity: 0, transition: { duration: dur[1] } }} transition={{ duration: dur[2], ease: ease.out }} />
)}</AnimatePresence>

// contagem do OVR
const mv = useMotionValue(78); const txt = useTransform(mv, v => Math.round(v));
useEffect(() => { const c = animate(mv, 81, { duration: 1.2, ease: ease.out }); return c.stop; }, []);
<motion.span className="num">{txt}</motion.span>
```

Regras: anime só `transform`, `opacity`, `clip-path` (em elementos pequenos) e `filter` pontual; entradas CSS com **`fill-mode: backwards`** (com `both` o estado final prende `opacity/transform` e anula hover e o esmaecido de `.has-choice` — bug corrigido); um CTA/efeito "de glória" por tela; nada pisca mais de 3×/s.

---

## 9. Arte SVG

### 9.1 Pontos de jogador no campo (regra nova)
Disco 22px (r 11) com número 12px 800. O **anel de 2.5px é obrigatório e precisa de ≥ 3:1 contra a grama** (`#0F6149`) — é ele que torna o ponto visível, não o preenchimento. Algoritmo: `fill = --club`; `ring = --club-2` se `contrast(club-2, turf) ≥ 3`, senão branco. **Se `club` e `club-2` tiverem < 3:1 contra a grama** (ex. Palmeiras 1.37:1, Coritiba, Chapecoense) → `fill` branco `#F4F6FF` (6.9:1) + anel e número na cor do clube. Boca (azul 1.39:1) funciona só por causa do anel amarelo. Visitante: se colidir com a casa (ΔE < 25), trocar para `--club-2`/branco. Você: disco 28px + anel ciano 3px + pulso 44px + etiqueta. Bola 12px branca com contorno navy; rastro de 3 pontos (.15/.3/.5).

### 9.2 Troféus (`snippets-transmissao/trophies/`)

| Arquivo | Troféu | Materiais |
|---|---|---|
| `libertadores.svg` | CONMEBOL Libertadores (jogador no topo, base de madeira com 20 plaquinhas) | prata + madeira |
| `brasileirao.svg` | Brasileirão (taça facetada com diamante dourado, base ônix com faixa verde-amarela) | prata + núcleo ouro + ônix |
| `copa-do-brasil.svg` | Copa do Brasil (alças grandes, anel ouro) | prata + ouro |
| `copa-america.svg` | Copa América (base de madeira em 3 degraus com placas) | prata + madeira |
| `laliga.svg` | LaLiga (faixas vermelhas) | prata + vermelho canônico |
| `champions-league.svg` | Champions League ("orelhuda") | prata |
| `world-cup.svg` | Copa do Mundo (globo, faixas de malaquita) | ouro + malaquita |
| `ballon-dor.svg` | Bola de Ouro (padrão de gomos pré-calculado, pedestal ônix) | ouro + ônix |
| `golden-boot.svg` | Chuteira de Ouro | ouro + ônix |
| `artilheiro.svg` | Artilheiro do Brasileirão (chuteira de prata) | prata + madeira |
| `estadual.svg` | **Novo** — Campeonato Estadual (urna com tampa e pináculo, estrela dourada, anel ouro, plinto de madeira com escudo, base ônix) | prata + ouro + madeira + ônix |
| `trophy-sprite.svg` | todos acima como `<symbol id="lx-trophy-{slug}">` + defs compartilhadas `lx-m-*` | — |

Construção: `viewBox="0 0 120 200"`, base em y ≈ 196, luz vinda da esquerda (faixa especular a 28–30% da largura), filete branco .55 no lado claro. Gradientes com `objectBoundingBox`. **Cada `stop`/`fill` metálico usa `style="stop-color: var(--metal-…, #hexDoMockup)"`** — como `<img>` (sem variáveis) o arquivo renderiza idêntico ao mockup; inline, segue o tema.

Uso em React:
- **Sprite** (recomendado para prateleiras com muitas cópias): injete `trophy-sprite.svg` uma vez no `<body>` (dentro do elemento com `data-theme`; `width/height 0`, **nunca `display:none`** — o Chrome não pinta gradientes de SVG escondido) e use `<svg className="lx-trophy" viewBox="0 0 120 200" width={36} height={60}><use href="#lx-trophy-libertadores"/></svg>`. Os gradientes resolvem as variáveis **onde o sprite está** → troca de tema no `<html>` funciona; override por instância **não**.
- **Inline/SVGR** (para override por instância, ex. troféu "prata" de vice): importe o arquivo com SVGR e `svgo prefixIds` (ou gere ids com `useId()`), porque IDs duplicados fazem todas as cópias usarem os gradientes da **primeira** da página.
- Tamanhos usados: 9 (marcador de Copa na linha futura) · 12–14 (ticker, linha da carreira) · 20–22 (ranking, prêmios) · 36–40 (prateleira) · 96–112 (cards de prêmio) · 150–200 (celebração/hero) · 260 (gala).
- A11y: decorativo → `aria-hidden="true"`; informativo → `role="img"` + `<title>` (os arquivos já trazem).

### 9.3 Demais artes (`snippets-transmissao/art/`)
- `jersey.svg`: camisa 300×300 com `--jersey-body`, `--jersey-body-2`, `--jersey-trim`, `--jersey-ink` (fallback: Seleção Brasileira); sobrenome 30px e número 128px em Barlow Condensed 800. IDs únicos por instância (`useId`).
- `crest-fallback.svg`: escudo 48×56 com `--club/--club-2/--club-ink` e sigla 15px.
- `brand-mark.svg`: "L" vazado em paralelogramo ouro (lê `--metal-gold-1/2/4`); mínimo 24px.
- `pitch-live.svg` (partida, 1050×680 = 105×68 m, listras de 7,5 m, vinheta), `pitch-vertical.svg` (seletor de posição, traço 1px não-escalável), `pitch-floor.svg` (campo holográfico azul do hero).
- `mic-cluster.svg`: 3 microfones com cubos de veículos fictícios.
- `icons-sport.svg`: sprite de ícones (§7).

---

## 10. Responsivo

Breakpoints = **padrão do Tailwind** (compartilhados pelos dois temas; não redefinir por tema): `sm 640` · `md 768` · `lg 1024` · `xl 1280` · `2xl 1536`. Os cortes do mockup (620 / 720 / 1100 / 1180) foram normalizados para estes.

| Tela | base (<640) | sm–md (640–1023) | lg (1024–1279) | xl+ (≥1280) |
|---|---|---|---|---|
| Topbar | 56h, sem nav/sub da marca/idioma, chip de temporada só com o ano | 64h, nav compacta | completa | completa |
| **Carreira** | 1 coluna, gutter 12; componentes em tamanho mobile (§5.8) | 1 coluna **max 720 centralizada**, tamanhos desktop | **2 colunas `460px 1fr`** gap 16: nome do clube 32px, painel lateral IDADE/VALOR 32px, opções 2 col (escudo 64) | **`548px 1fr`** gap 18, max 1400 |
| Carreira: tabela | grid `42 36 1fr…` (§5.8), sem EMP./posição final, futuras colapsadas | completa | completa, posição final só chip (sem "CAMPEÃO") | completa |
| Trava de altura | não | não | `≥1024w e ≥820h`: 100vh, rolagem interna na tabela | idem |
| Identidade | 1 coluna | 1 coluna (≥768: 2) | 2 colunas + 3ª abaixo | 3 colunas `372 1fr 396` |
| Landing | arte 400h escala .6 em cima; modos 1 coluna; CTA primário `flex:1` | arte 520h escala .74 em cima | idem | 2 colunas |
| Partida | bug topo, campo full-bleed, abas, controles fixos embaixo | idem, campo com placa | `260 1fr 280` | `290 1fr 310` |
| Lance decisivo | bottom sheet, opções empilhadas | idem | prompt sobre o campo | idem |
| Hub | tudo 1 coluna, agenda rola (snap) | idem | 8/4 · 12 · 5/4/3 | idem |
| Coletiva | respostas 1 coluna, sem medidor | 2 colunas | 4 colunas | 4 colunas |
| Contrato | termos em cartões | idem | tabela + lateral 280 | idem |

**Como a carreira colapsa (ordem no mobile)**: cabeçalho do jogador → faixa de stats → sala de troféus → **card de decisão** (fica acima da tabela: é a ação) → tabela com abas. Em `lg+` a tabela vai para a coluna direita e a decisão ocupa o resto da coluna esquerda (`flex:1`).

---

## 11. Acessibilidade

- **Contraste**: tabela §1.1. `--text-3` só ≥ 14px bold sobre `--surface-3`; `--lx-text-4` nunca para informação necessária. Texto sobre clube = `clubInk()`; placa de clube clampa luminosidade.
- **Foco visível** (3 receitas, porque `clip-path` corta `outline`):
  1. Elementos sem recorte (abas, links, tabs): `outline: 2px solid var(--accent); outline-offset: 2px` (padrão do tema; abas −4px).
  2. Botões `.lx-btn`: anel 2px ciano **fora** da forma, 3px de folga, mesmo ângulo (`::after` com `polygon(evenodd, …)`).
  3. Placas/opções recortadas: a borda vira **2px ciano sólido** + brilho interno 22px (`--lx-bw: 2px`). Pequenos recortados (segmento, icon-button, chips-botão): `inset 0 0 0 2px var(--accent)` (`.lx-focus-inset`).
  Ciano vs borda normal da placa ≈ 5:1; vs fundo 13:1.
- **Seleção ≠ foco**: selecionado = borda-gradiente ciano 1px + miolo azul; foco = 2px sólido.
- **Movimento**: `prefers-reduced-motion` **e** ajuste do jogo (`<html data-motion="reduced">`) — ambos implementados no CSS (§8.2 coluna "Reduced motion"); `MotionConfig reducedMotion`.
- **Tempo** (WCAG 2.2.1): cronômetro do lance decisivo ajustável (desligar / ×2), pausa com a aba oculta, opção "Padrão" sinalizada antes de acontecer. Coletiva e contrato sem limite de tempo.
- **Movimento automático** (2.2.2): ticker pausa em hover/focus e com reduced-motion vira lista rolável; a cópia duplicada é `aria-hidden`.
- **Leitores de tela**: eventos da partida `aria-live="polite"`; lance decisivo `role="alertdialog"` + `aria-live="assertive"` (início e 3 s); celebração `role="dialog" aria-modal`; tabs `role="tab"/aria-selected`; segmentados `role="radiogroup"/aria-checked`; opções `aria-pressed`; números com contexto (`aria-label="Nota 7,8"`).
- **Cor nunca sozinha**: zonas com legenda e posição; forma com letras V/E/D; efeitos com ícone + sinal + texto; nota com número; cartões com ícone + texto.
- **Teclado**: 1/2/3 nas opções de lance, Enter confirma, Esc fecha overlays (celebração só depois de 1 s), setas nos segmentados/abas.
- **Alto contraste** (`forced-colors`): recortes e gradientes caem para bordas reais `CanvasText`/`ButtonText`; texto metálico vira texto sólido; badges mantêm cor (`forced-color-adjust: none`).
- **`[hidden]`**: o tema garante `display:none !important` (classes `.lx-*` definem `display` e anulavam o atributo fora do preflight do Tailwind).
- Alvos ≥ 40px (44 mobile), `lang="pt-BR"`, caixa-alta só via CSS.

---

## 12. Tailwind v4 — integração

O bloco **§1 do `theme-transmissao.css`** (ponte) é idêntico para os dois temas — mantenha **uma** cópia em `src/styles/tokens.css` e importe os dois temas depois:

```css
/* src/styles/app.css */
@import "tailwindcss";
@import "./tokens.css";            /* @theme inline + @theme + @utility + @custom-variant (compartilhado) */
@import "./theme-transmissao.css"; /* [data-theme="transmissao"] + .lx-*  (remova daqui o §1 duplicado) */
@import "./theme-noite.css";
```

- Cores com nome diferente do token → `@theme inline { --color-surface: var(--surface); … }` (resolve no elemento; funciona com `data-theme` em qualquer container e com opacidade: `bg-accent/20`).
- Tokens que já são namespaces do Tailwind (`--font-*`, `--radius-*`, `--ease-*`) → `@theme` comum com valor literal; o `[data-theme]` sobrescreve em runtime porque o utilitário referencia `var(--radius-lg)`. **Não** escreva `--radius-lg: var(--radius-lg)` em `@theme inline` (referência cíclica).
- Tokens do tema ficam em `@layer base` (vencem o `@layer theme` do Tailwind); primitivas `.lx-*` em `@layer components` (utilitários vencem: `class="lx-btn h-12"` funciona).
- Coloque `data-theme` no `<html>` (o `--default-font-family` do preflight também passa a seguir o tema).

Utilitários disponíveis: `bg-bg bg-bg-2 bg-surface{,-2,-3} bg-glass border-border{,-strong} text-text{,-2,-3} text-accent bg-accent text-accent-ink text-positive bg-positive-bg text-negative bg-negative-bg text-warning text-info text-glory bg-club text-club-ink border-club text-tier-{bronze,silver,gold,lenda}` · `rounded-{xs,sm,md,lg,xl,pill}` · `font-ui font-display font-num` + **`num`** (família + tabular) · `ease-out ease-spring` · `dur-1/2/3` ou `duration-(--dur-2)` · `elev-1/2/3`, `glow-accent`, `shadow-(--shadow-2)` · `animate-lx-rise animate-lx-slide animate-lx-wipe` · variantes `transmissao:` e `noite:`.

Exemplo de componente agnóstico:

```tsx
export function StatCell({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="flex flex-col justify-center px-4.5">
      <span className="lx-label">{label}</span>
      <span className="lx-t-num text-text">{value}{sub && <span className="ml-1.5 text-sm font-bold not-italic text-text-3">{sub}</span>}</span>
    </div>
  );
}

export function ClubRow({ club, age, children }: { club: Club; age: number; children: React.ReactNode }) {
  return (
    <div className="lx-club-row grid h-[30px] grid-cols-[54px_minmax(0,1fr)_62px_66px_62px_62px] items-center max-sm:grid-cols-[42px_minmax(0,1fr)_46px_40px_36px_34px]"
         style={{ "--club": club.c1, "--club-2": club.c2, "--club-ink": clubInk(club.c1), "--club-tint": club.tint } as React.CSSProperties}>
      <span className="lx-club-age">{age}</span>{children}
    </div>
  );
}
```

Contrato de classes semânticas (recomendado aos dois temas para os componentes não precisarem de `if (theme)`): `.lx-plate(--flat/--glass/--selected)`, `.lx-btn(--primary/--ghost/--line/--sm/--xs/--sq)`, `.lx-icon-btn`, `.lx-chip(--*)`, `.lx-fx(--up/--down/--gold/--neu)`, `.lx-ovr(__label/__num, --xl/--md)`, `.lx-ovr-s`, `.lx-kicker`, `.lx-label`, `.lx-t-*`, `.lx-tabs/.lx-tab`, `.lx-seg`, `.lx-field`, `.lx-lt`, `.lx-ticker`, `.lx-trophy`, `.lx-club-*`, `.lx-bug`, `.lx-countdown`, `.lx-option(s)`, `.lx-meter`, `.lx-range`, `.lx-elev-*`, `.lx-focus-inset`. O Noite implementa os mesmos nomes com raios em vez de recortes.

---

## 13. Faça / Não faça

**Faça**
- Use recortes (`.lx-cut*`, `.lx-skew*`) e `rounded-*` do contrato; deixe o tema decidir a forma.
- Coloque sombra/brilho no **wrapper** de qualquer forma recortada (`.lx-elev-*`).
- `num` em todo número vivo; caixa-alta via CSS; itálico 800 para a "voz" da transmissão.
- Mostre efeito + probabilidade antes de toda escolha.
- Ouro só para glória e para **um** CTA primário por tela.
- Injete `--club/--club-2/--club-ink` (e `--club-tint` para clubes amarelos/claros) no container do contexto.
- Seeds fixas para confete/flash/momentum (screenshots e testes determinísticos).
- Escudos, logos e fontes locais; veículos de mídia fictícios.

**Não faça**
- `border-radius` em placas/botões; `box-shadow`/`outline` externos em elemento com `clip-path`.
- `backdrop-filter` em `::before` de placa recortada; `display:none` no sprite de troféus.
- `fill-mode: both` em entradas; wipe `clip-path` no mesmo elemento que tem chanfro ou sombra.
- Mais de 1 lower-third de evento ao mesmo tempo; mais de 1 elemento com `.lx-sweep` no mesmo cartão.
- Ciano e ouro no mesmo elemento com papéis diferentes; `--warning` como "ouro".
- Texto `--lx-text-4` para informação; cor como único sinal.
- Hotlink de escudos (ESPN) ou Google Fonts em produção; marcas reais de veículos/patrocinadores.
- IDs fixos em SVG repetido (camisa, escudo, troféu inline); comentários com `--` dentro de arquivos `.svg` (XML inválido).
- `conic-gradient(from 180deg …)` com paradas > 90° esperando cone para baixo.

---

## 14. Correções em relação aos mockups (já aplicadas no tema/snippets)

| # | Problema no mockup | Correção |
|---|---|---|
| 1 | Cones de luz (`from 180deg` + paradas 150–210°) apontavam para cima — spot do hero, armário da camisa e gala invisíveis | `from 163deg` + 0…34° / `.lx-spot-cone` |
| 2 | Glow ciano da idade atual e foco em elementos recortados (sombra externa cortada pelo clip) | anéis internos; anel de foco fora via `::after` no host sem clip |
| 3 | `wipeIn` com `both` + `filter: drop-shadow` no mesmo elemento: sombra cortada para sempre | `fill-mode: backwards` |
| 4 | Entradas com `both` prendiam `opacity/transform` (hover e esmaecimento não funcionavam) | `backwards` em todas as entradas |
| 5 | `backdrop-filter` impossível num `::before` de placa recortada | vidro no host |
| 6 | Pontos/linhas verdes (Palmeiras) somem sobre campo verde; amarelo a 34% vira marrom | regra de fill branco (§9.1) e `--club-tint` |
| 7 | Clubes claros (Real Madrid) com texto branco na placa | clamp `oklch(from … min(l,.52))` |
| 8 | Campo da partida em `cover` cortava o gol quando a coluna é estreita | `aspect-ratio: 1050/680` |
| 9 | Tier 90+ chamado `elite` | `lenda` (contrato) |
| 10 | Escudos via ESPN, fontes via Google Fonts | cache local + `@fontsource` |
| 11 | IDs fixos na camisa (`jb`, `jc`) | `useId()` por instância |
| 12 | `[hidden]` anulado por `display` das classes | regra `!important` no tema |

---

## 15. Checklist de implementação

1. `npm i @fontsource/barlow-condensed @fontsource/barlow motion lucide-react` e os 9 imports de fonte.
2. Copiar `theme-transmissao.css` para `src/styles/`; mover o §1 para `tokens.css` compartilhado.
3. `<html lang="pt-BR" data-theme="transmissao">` (Modo Imersivo) / `"noite"` (Clássico).
4. Injetar `trophy-sprite.svg` + `icons-sport.svg` uma vez no `<body>`.
5. `clubInk()` + `--club-tint` no modelo de dados de clube (`c1`, `c2`, `tint?`, `ink` calculado).
6. `<MotionConfig reducedMotion>` + ajuste "Movimento reduzido" (seta `data-motion`) + "Lances sem cronômetro".
7. Montar as telas pelos snippets: `match-screen` → `scoreboard-bug` → `key-moment` → `hub-week` → `press-conference` → `social-feed` → `contract` → `ceremony` → `celebration`.
8. Verificar: relógio não "treme" (tabular), foco visível por teclado em todas as placas/botões, reduced-motion (ticker parado, cronômetro em degraus), 390px sem scroll horizontal.

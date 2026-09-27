# LENDA — Design Spec · "Noite de Final" (`data-theme="noite"`)

**Scope.** The Modo Clássico MVP ("Copero, 200% better") ships in this direction. Modo Imersivo ships in "Transmissão", but the two share every component, so this spec also covers how the Imersivo-only surfaces (match HUD, standings) look when rendered with `noite`.
**Sources.** `design/noite/*.html | lenda.css | trophies.js | icons.js | data.js` and all 15 screenshots (1440×900 desktop, 390×844 mobile). There was no NOTES.md, so every value below comes from the mockup code and was checked against the screenshots.
**Deliverables.**
- `design/theme-noite.css` is the production CSS: the shared Tailwind mapping, the tokens, and the `.lx-*` classes.
- `design/snippets-noite/` holds 13 HTML effect snippets, 4 illustration SVGs and 10 trophy SVGs plus a sprite. Section 17 indexes them.

> Mood in one line: **a floodlit stadium at night.** A near-black stage, lit from the top-left corner by the player's club colour. Frosted glass cards float on it. FUT-style metal marks the player's rating. Real-looking trophies are the reward. White is how you act; gold is what you win.

---

## 0. Principles

1. **The stage recedes and the data comes forward.** Backgrounds are ≤ 6 % white on `#07080c`. The only saturated things on screen are the club light, the metal tiers, the trophies and the semantic chips.
2. **The club is the light source.** Changing club changes the ambient glow, the hero card, the table rows and the age badges. You should be able to name the player's club with your eyes half closed.
3. **White is interactive and gold is glory.** The primary CTA, the selected segment, the selected pitch chip and the "VOCÊ" badge are white with dark ink. Gold is reserved for trophies, the Bola de Ouro, the selected game mode, counts on titles and celebration moments.
4. **Metal marks rank.** Bronze is below 70, Prata is 70–79, Ouro is 80–89 and Lenda is 90 or more (holographic). The number is always printed on the metal, so colour never carries the meaning on its own.
5. **Numbers are condensed and tabular.** Every stat, OVR, minute, score, points value and year uses Barlow Condensed with `tabular-nums`.
6. **Motion celebrates and never blocks.** Ambient loops are slow (5–90 s). State changes take 140–420 ms. Celebrations are timed sequences that can always be skipped (`Esc`, ✕).

---

## 1. Integration

### 1.1 Files
| File | What it is |
|---|---|
| `theme-noite.css` | §0 is the shared Tailwind v4 mapping (identical in `theme-transmissao.css`). §1 is the tokens under `[data-theme="noite"]`. §2 is base. §3 is the `.lx-*` components in `@layer components`. §4 is keyframes (`lxn-*`). §5 covers reduced motion, contrast and transparency. |
| `snippets-noite/*.html` | Self-contained demos. Each links `../theme-noite.css` and nothing else. Crests and flags are inline SVG placeholders, so no network is needed. |
| `snippets-noite/trophies/*.svg` | 10 standalone trophies plus `trophies-sprite.svg`, which holds the shared defs and symbols. |
| `snippets-noite/{brand-mark,jersey,pitch-vertical,pitch-horizontal}.svg` | Illustration art. |

### 1.2 Fonts (self-hosted, no CDN)
```bash
npm i @fontsource-variable/inter @fontsource-variable/inter-tight @fontsource/barlow-condensed @fontsource-variable/cormorant-garamond
```
```ts
// src/main.tsx
import '@fontsource-variable/inter';                              // family 'Inter Variable'        (wght 100–900)
import '@fontsource-variable/inter-tight';                        // family 'Inter Tight Variable'  (wght 100–900)
import '@fontsource/barlow-condensed/500.css';                    // family 'Barlow Condensed'
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource-variable/cormorant-garamond/wght-italic.css'; // 'Cormorant Garamond Variable' — Bola de Ouro title only
```
All packages are at v5.3.0. The imports cover latin and latin-ext, and fontsource subsets them by `unicode-range`, which handles PT, ES and EN. Optionally lazy-load Cormorant with the ceremony route chunk.

### 1.3 Activating
```html
<html lang="pt-BR" data-theme="noite">
```
Every token is scoped to `[data-theme="noite"]`, so a subtree can switch themes. For example, a Modo Imersivo route can render `<div data-theme="transmissao">`.

```css
/* src/styles/index.css */
@import "tailwindcss";
@import "./theme-noite.css";
@import "./theme-transmissao.css";
```
Import the theme files through Tailwind's CSS entry, not from JS, so that `@theme`, `@utility` and `@custom-variant` get compiled. This was verified against the project's tailwindcss 4.3.3.

### 1.4 Tailwind v4 mapping (shared, in `theme-noite.css` §0)
- **Colours** use `@theme inline { --color-surface: var(--surface); … }`. That gives you `bg-surface bg-surface-2 bg-surface-3 bg-glass bg-bg bg-bg-2 text-text text-text-2 text-text-3 border-border border-border-strong bg-accent text-accent-ink text-positive bg-positive-bg text-negative bg-negative-bg text-warning text-info bg-club text-club-ink bg-tier-gold-2 …`. Opacity modifiers work too (`bg-surface/50` compiles to `color-mix`).
- **Radii, fonts and easings** share their Tailwind key with the contract token (`--radius-lg` *is* the Tailwind key), so they are registered in a **non-inline** `@theme`. The utility emits `var(--radius-lg)` and the theme block overrides it at runtime. That gives `rounded-xs|sm|md|lg|xl|pill`, `font-ui|display|num`, `ease-out|spring`.
  - ⚠️ Never write `@theme inline { --radius-lg: var(--radius-lg) }`. That is a self-reference and resolves to nothing.
- **Shadows.** Tailwind inlines `--shadow-*` values at build time, so a runtime theme could not change them. They are exposed as custom utilities instead: `shadow-1 shadow-2 shadow-3 shadow-glow`.
- **Extra utilities:**
  - `num` = `font-num` + `tabular-nums`.
  - `dur-1 dur-2 dur-3` set `transition-duration` from the tokens. You can also write `duration-(--dur-2)`.
- **Theme variants:** `noite:` and `transmissao:` let one shared component carry per-theme tweaks, e.g. `className="rounded-lg transmissao:rounded-none"`.
- **Breakpoints** (shared, mobile-first): `sm` 36rem (576px) · `md` 45rem (720px) · `lg` 69rem (1104px) · `xl` 80rem (1280px). Noite's mockup breakpoints of 560, 700 and 1100 map to `sm`, `md` and `lg` (§12).

### 1.5 Runtime club variables
React sets these inline on the container that "belongs" to a club. That is usually the app root, set from the current club.

| Var | Meaning | Required |
|---|---|---|
| `--club` | Identity colour (hex). Used for the age badge fill, club strip and scoreboard. | ✅ |
| `--club-2` | Secondary colour. Used for the floor glow and nation accents. | ✅ |
| `--club-ink` | Text on `--club`, computed for contrast. | ✅ |
| `--club-glow` | *Proposed contract addition, optional.* An ambient-safe glow colour. Needed when `--club` is near-black, near-white or grey (Botafogo, Corinthians, Real Madrid). Falls back to `--club`. | optional |
| `--row-club` / `--row-club-ink` | The same pair, scoped to one table row or strip segment. | per row |

> ⚠️ **Implementation rule.** Never derive club colours at the theme root (for example `--x: var(--club)` in `[data-theme]`). A `var()` inside a custom property resolves where it is declared, so a club set on a descendant would be ignored. This bug happened while building the snippets and is fixed in the CSS. Every club-tinted rule resolves `var(--club-glow, var(--club))` at the element that uses it.

```ts
// src/theme/club.ts — one helper, used by every surface that sets a club
type ClubColors = { primary: string; secondary: string; glow?: string; ink?: string };
const rgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (h: string) => rgb(h).map(v => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
  .reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const sat = (h: string) => { const c = rgb(h).map(v => v / 255), mx = Math.max(...c), mn = Math.min(...c), l = (mx + mn) / 2;
  return mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1)); };
export const bestInk = (bg: string) =>
  contrast(bg, '#ffffff') >= 4.5 ? '#ffffff' : contrast(bg, '#0a0b10') > contrast(bg, '#ffffff') ? '#0a0b10' : '#ffffff';
const glowable = (h: string) => { const L = lum(h); return L > .02 && L < .6 && sat(h) > .12; };
export const ambientGlow = (c: ClubColors) =>
  c.glow ?? (glowable(c.primary) ? c.primary : glowable(c.secondary) ? c.secondary : '#c8c8c8');
export const clubVars = (c: ClubColors) => ({
  '--club': c.primary, '--club-2': c.secondary,
  '--club-ink': c.ink ?? bestInk(c.primary), '--club-glow': ambientGlow(c),
}) as React.CSSProperties;
```
Data overrides from the mockups, stored per club in `clubs.json`:
- Palmeiras: `c #0b7a43`, `glow #0e8c4c`.
- Real Madrid: `c #ece6d2`, `ink #1a1a2a`, `glow #a082ff` (the lilac "merengue" light).
- Corinthians: `c #f2f2f2`, `ink #111`, `glow #dcdcdc`.
- Botafogo and Juventus: `glow #c8c8c8`.
- Manchester City: `c #6cabdd`, `ink #0b2340`.

---

## 2. Colour

### 2.1 Stage & surfaces
| Token | Value | Use |
|---|---|---|
| `--bg` | `#07080c` | Page stage (the colour under the ambient glow). |
| `--bg-2` | `#0b0d12` | Recessed wells: shelf base, dot ring, brand-mark field. |
| `--surface` | `rgba(255,255,255,.04)` | Flat in-flow card, chip, ghost button, stats bar. |
| `--surface-2` | `rgba(255,255,255,.065)` | Hover, active tab, chip fill, icon tiles. |
| `--surface-3` | `rgba(255,255,255,.10)` | Selected segment, pressed. |
| `--glass` | `rgba(10,11,16,.72)` | **Dark** frosted panel floating over art or pitch: trail, floating tags, celebration facts. |
| `--border` | `rgba(255,255,255,.07)` | Default hairline. |
| `--border-strong` | `rgba(255,255,255,.11)` | Inputs, options, cards that need definition. |
| `--nx-border-3` | `rgba(255,255,255,.18)` | Hover border, pending dashed row. |
| `--nx-bg-3` | `#171b24` | Rarely used; solid fallback. |

**Glass card recipe (`.lx-glass`):**
- `linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,.02))`
- `1px solid var(--border)`, `radius 20`, `shadow-2`
- `backdrop-filter: blur(22px) saturate(140%)`

Surfaces are translucent **on purpose**, because the club light has to tint them. For popovers use `.lx-tooltip`, `rgba(12,13,19,.92)`.

### 2.2 Ink (contrast measured on `#121317`, the glass card over `--bg`)
| Token | Hex | On bg | On card | Use |
|---|---|---|---|---|
| `--text` | `#f4f5f8` | 18.4 | 17.0 | Primary |
| `--text-2` | `#a6abb8` | 8.7 | 8.1 | Secondary copy, meta |
| `--text-3` | `#80869a` | 5.5 | 5.1 | Labels, eyebrows, captions. **Changed from the mockup's `#6d7384`, which scored 3.9:1 (fails AA).** |
| `--nx-text-4` | `#454a58` | 2.3 | 2.1 | Decorative only: separator dots, zero values, far-future ages. Never use it for text anyone needs to read. |

### 2.3 Accent & semantic
| Token | Hex | Role |
|---|---|---|
| `--accent` / `--accent-ink` | `#ffffff` / `#0a0b10` | Primary CTA, selection, focus ring, "VOCÊ" / "SEU CLUBE" badges (16.5:1). |
| `--positive` (+`-bg` `rgba(62,230,164,.09)`) | `#3ee6a4` | +OVR, acesso, G4/Libertadores, live, "Pronto" (12.4:1). |
| `--negative` (+`-bg` `rgba(255,94,120,.09)`) | `#ff5e78` | −OVR, rebaixamento, red card, live ceremony (6.8:1). |
| `--warning` | `#ffc857` | Pending decision, amber effects ("Capitão"), the timer ring (13:1). |
| `--info` | `#6cb2ff` | Defensive positions, neutral info (9:1). |

**Noite-private tones.** Use these only inside the theme's CSS. Shared components must not reference them.

| Group | Values |
|---|---|
| Lines | `--nx-positive-line rgba(62,230,164,.22)` · `--nx-negative-line rgba(255,94,120,.22)` · `--nx-warning-bg .09` / `-line .24` |
| Soft text on tinted bg | positive `#b4f7da` · negative `#ffc3cd` · warning `#ffe7b0` |
| Gold text | `#ffe39a` (counts), `#ffe7a6` (celebration), `#d8b36a` (ceremony labels), `#ffd66e` (chart / markers) |
| Position families | ATK `#ff6b81` · MID `#4ce0a0` · DEF `#6cb2ff` · GK `#ffc857` |
| Position chip recipe | bg .14/.12 · border .30/.28 · text `#ffc2cc` / `#b9f5da` / `#cfe5ff` / `#ffe6ad` |
| Standings zones | Libertadores `#3ee6a4` · Pré-Liberta `#7fd9ff` · Sul-Americana `#6f8cff` · Z4 `#ff5e78` |
| Match | home bars `#2fd07f` · away bars `#e5484d` · rating tile `#3ee6a4→#16a870` ink `#062116` · yellow card `#ffd21f` |
| Celebration kicker | `#9ef3c7` (mint), or the club colour lifted to L ≥ 80 % |

---

## 3. How `--club` shows up in Noite

| Surface | Recipe (all resolved at the element) |
|---|---|
| **Ambient stage** `.lx-stage` | Glow A: `radial 900×620 at 8% -6%` at 34 % of the glow colour. Glow B: `700×520 at 104% 110%` at 16 %. Glow C (`--club-2`): `1200×700 at 60% 120%` at 3.5 %. Then floodlight cones, grain and vignette. The colour change crossfades over 800 ms (`@property --nx-glow-*`). |
| **Career hero card** `.lx-club-card` | `linear-gradient(100deg, club 42% → club 14% @46% → club 6%)` over the glass. Border is club at 35 %. A pinstripe (`115deg, 1px/14px`) fades in from the right. The crest watermark is 230px, `rotate(-8deg)`, opacity .1, `right:-36px`. |
| **Career table panel** `.lx-club-panel` | Faint wash, `radial 700×260 at 30% -8%`, club 12 %. |
| **Career rows** `.lx-club-row` + `--row-club` | Filled: `90deg club 20% → 6% @38% → white .018`. Loan: 12 % → 3 %. Current: 38 % → 12 % @50% plus a 1px inset ring (club 60 %) and a glow `0 0 24px -6px` (club 70 %). |
| **Age badge** `.lx-age` | 30×22, fill `--row-club`, text `--row-club-ink`, inset highlights. This is the most "club-coloured" pixel in the UI. |
| **Option cards** `.lx-option` (`--oc`) | Radial `260×160 at 50% 18%` at 22 %. Crest halo 120px at 30 %. On hover or focus: ring `4px` at 10 % and shadow `0 30px 60px -24px` at 45 %. |
| **Progress / club bars** `.lx-bar--club` | `club lifted 55% toward white → #d7ffe9` plus glow `0 0 12px club 90%`. |
| **Celebration veil** | `radial 1100×700 at 50% 40%` club 30 % under a warm spotlight. Confetti colours use the club palette plus gold. |
| **Standings, "your club"** `.lx-club-row--mine` | `club 34% → 8%` + inset ring 60 % + glow `0 0 26px -8px` at 90 %. |
| **Summary club strip** `.lx-club-strip` | `linear-gradient(180deg, club, club 70% + black)` with `--club-ink` text. |
| **Match scoreboard** | Home segment `club → club lifted 12%`. Away segment uses the rival's colour (set `--club` locally). |
| **Identity step** | `--club` / `--club-2` are the **nation** colours (Brasil `#009c3b` / `#ffd600`). They tint the stage (`.lx-stage--duo`), the selected country row and the check circle. |

---

## 4. Typography

**Families**
- `--font-ui` is Inter Variable. Body and UI text; `font-feature-settings: 'cv11','ss01'` (single-storey a, open digits).
- `--font-display` is Inter Tight Variable. Headlines, names, card titles.
- `--font-num` is Barlow Condensed (500/600/700/800). All numerals, and it must always be combined with `tabular-nums`.
- `--nx-font-serif` is Cormorant Garamond Variable, italic 700. It appears **only** in the "Ballon d'Or" title.

Base: 14px/1.45, `-webkit-font-smoothing: antialiased`.

| Role | Family | Size / line-height | Weight | Tracking | Notes / where |
|---|---|---|---|---|---|
| Hero H1 | display | 70 / .96 (mobile 46) | 800 | −.035em | Landing. "futebol." uses `.lx-metal-text`. |
| Player name (summary) | display | 68 / .95 | 900 | −.035em | Resumo |
| Celebration H1 | display | 64 / 1 | 900 | −.035em | `.lx-chrome-text` |
| Ceremony serif | serif italic | 76 / .9 | 700 | −.01em | "Ballon d'Or", `.lx-serif-gold` |
| Giant watermark | display | clamp(120,18vw,260) | 900 | −.04em | "CAMPEÃO", 1.5px outline at 6.5 % |
| Page H1 | display | 36 / 1.05 (mobile 30) | 800 | −.03em | "Defina sua identidade" |
| Hero name (career) | display | 36 / 1 (mobile 28) | 900 | −.03em | Text-shadow `0 2px 18px rgba(0,0,0,.4)` |
| Section H2 | display | 34 (mobile 26) | 800 | −.03em | Landing features |
| Winner name | display | 34 / 1 | 900 | −.02em | Bola de Ouro 1º |
| Panel title | display | 24 | 800 | −.02em | Standings, ranking |
| Decision title | display | 23 / 1.1 (mobile 21) | 800 | −.025em | |
| Moment title | display | 22 | 800 | −.02em | Match HUD |
| Option / card title | display | 19 (mobile 16) · 18 · 16.5 · 16 | 800 | −.02 to −.01em | Option, feature, mode, panel |
| Lead | ui | 16.5 / 1.55 (mobile 15) | 400 | 0 | `<b>` is 600 in `--text` |
| Body | ui | 14 / 1.45 | 400–500 | 0 | |
| Small copy | ui | 13 / 1.45, 12.5 / 1.45 | 400–650 | 0 | Decision sub, option desc |
| Meta | ui | 12–11.5 | 600–650 | 0 | Rows, chips |
| Eyebrow `.lx-eyebrow` | ui | **10.5** / 1.3 | 700 | **.14em** | UPPERCASE, `--text-3` |
| Table header | ui | 10 | 700 | .12em | UPPERCASE |
| Tag `.lx-tag` | ui | 10 | 800 | .04em | UPPERCASE |
| Micro labels | ui | 9.5 | 800 | .08–.14em | NOVO, VOCÊ, IDADE/VALOR |
| Card tier label | ui | 9.5 (3.8cqw) | 800 | .34em | "OURO", "LENDA" |
| Wordmark "LENDA" | display | 19 | 900 | .16em | + sub-label 11/600/.1em `--text-3` |
| OVR big | num | `.62 × --w` / .86 | 800 | −.01em | Text-shadow `0 1px 0 rgba(255,255,255,.45)` |
| KPI big | num | 46 / .9 · 34 / .95 · 27 / 1.05 | 700–800 | .005em | Summary · hero kv · stats bar |
| Score | num | 44 (celebration) · 28 (scoreboard) | 800 | .04em | |
| Table numerals | num | 15–17 | 700–800 | 0 | pts 16/800, age 15/700, OVR pill 15/800 |
| Year chips | ui | 11.5 | 700 | 0 | `tabular-nums` |

**Rules**
- Any number that can change or needs comparing uses `num` (Barlow + tabular).
- Years inside Inter text use `font-variant-numeric: tabular-nums` and stay in Inter.
- Use pt-BR formatting: `1.284` pontos, `€68M`, `1,84 m`, `2–1` (en dash) on scoreboards and `2×1` in finals.
- Player surnames are UPPERCASE (e.g. RIBEIRO). Club names are Title Case.
- Never letter-space lowercase text. Never go below 9.5px.

---

## 5. Spacing & layout

- **Base unit** is 2px. The rhythm steps are **4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 22 · 24**. In Tailwind v4 they are `1 1.5 2 2.5 3 3.5 4 4.5 5 5.5 6`, with fractional steps allowed.
- **Gaps.** Within a card, 6–10. Between cards in a column, **12**. Between columns, **16–22** (career 20, summary 22). Between page sections, 18.
- **Card padding.**
  - Panels: `16 18 14`.
  - Hero card: `18 20 18 18`.
  - Decision: `16 16 14`.
  - Options: `12 12 10`.
  - Chips: `0 9`.
- **Page containers.**
  - Landing, summary and season: max **1392**, padding `0 24`.
  - Career and match: **1440**.
  - Identity: **1320**.
  - Features and footer: **1344**.
- **Top bar.**
  - Height is **60** (landing 72, identity 62), padding `0 24`, gap 18.
  - Mobile: 60 high, padding `0 16`, gap 10.
- **Cockpit screens** (career, match, ceremony) fill `height: calc(100vh - 60px)`. The career screen also sets `min-height: 820px`; below that height the page scrolls.

---

## 6. Radii

| Token | px | Snap these mockup values to it |
|---|---|---|
| `--radius-xs` | 6 | kbd (6), tags (6), OVR pill (7), fx chip icon (7), age badge (7), flag (2–4) |
| `--radius-sm` | 10 | chip (8), table row (9), seg item (9–10), tab (10), fx chip (10), pitch chip (10) |
| `--radius-md` | 14 | button (14; sm 11; xl 16), input/stepper/seg track (13), icon-btn (12), list item (12), cabinet tile (14) |
| `--radius-lg` | 20 | glass default (20), stats/shelf/mode/option/momentum (18), box (20) |
| `--radius-xl` | 28 | hero/decision/table/panels (22), identity panel (26), ranking (26) |
| `--radius-pill` | 999 | live pills, dots, range thumb |

OVR badge radius is `0.2 × --w`, inner frame `0.15 × --w`. The player card uses its own shield path.

---

## 7. Elevation, glass and glows

| Token | Value | Use |
|---|---|---|
| `--shadow-1` | `inset 0 1px 0 rgba(255,255,255,.05), 0 8px 24px -12px rgba(0,0,0,.7)` | Chips, small tiles |
| `--shadow-2` | `inset 0 1px 0 rgba(255,255,255,.07), 0 24px 60px -24px rgba(0,0,0,.9)` | **All cards and panels** |
| `--shadow-3` | `inset 0 1px 0 rgba(255,255,255,.09), 0 40px 100px -30px rgba(0,0,0,1)` | Dialogs, celebration |
| `--glow-accent` | `0 0 0 1px rgba(255,255,255,.5), 0 14px 40px -12px rgba(255,255,255,.35)` | Primary CTA; hover grows to `0 18px 50px -12px .5` |
| gold glow | `0 14px 40px -12px rgba(255,200,87,.55)` | `.lx-btn--gold` |
| mode selected | `0 0 0 4px rgba(255,200,90,.07), 0 24px 50px -24px rgba(255,190,80,.45)` | `.lx-mode.is-on` |
| lenda aura | `0 0 40px -6px rgba(214,190,255,.55)` / `drop-shadow(0 0 36px rgba(200,170,255,.35))` | 90+ badge and card |
| winner | `0 0 0 5px rgba(255,214,120,.06), 0 30px 60px -20px rgba(255,190,80,.45)` | Bola de Ouro 1º |
| trophy drop | `drop-shadow(0 6px 10px rgba(0,0,0,.55))`; hero: `0 40px 50px .8 + 0 0 30px rgba(255,240,200,.25)` | `.lx-trophy`, `--hero` |
| crest | `drop-shadow(0 2px 6px rgba(0,0,0,.45))`; option crest `0 10px 18px .55` | |

Light effects are classes and are documented in §11:
- `.lx-halo`, `.lx-rays`
- `.lx-beam`
- `.lx-trophy-glow`, `.lx-floor`
- `.lx-sweep`, `.lx-sheen`
- `.lx-club-glow`, `.lx-trophy-spot`
- `.lx-noise`, `.lx-vignette`

---

## 8. OVR tiers

| Tier | Range | Stops `-1` shadow · `-2` body · `-3` highlight | Ink | Chart line | Chart band |
|---|---|---|---|---|---|
| Bronze | < 70 | `#7a4220 · #c47d49 · #f0b884` | `#2b1306` | `#e3a06a` | `rgba(192,122,72,.07)` |
| Prata | 70–79 | `#6c7482 · #bcc4cf · #f4f6f9` | `#1b212c` | `#dfe5ee` | `rgba(205,212,224,.05)` |
| Ouro | 80–89 | `#93650e · #f0c653 · #fff0b3` | `#2c1d00` | `#ffd66e` | `rgba(240,198,83,.075)` |
| Lenda | ≥ 90 | `#ffd3f2 · #bff3ff · #fff0b8` (+ mint `#d9ffc9`, rose `#ffc9e8`, lilac `#cfd4ff`) | `#1d1233` | `#e2d4ff` | `rgba(205,185,255,.10)` |

`tier(ovr) = ovr >= 90 ? 'lenda' : ovr >= 80 ? 'gold' : ovr >= 70 ? 'silver' : 'bronze'`. Classes are `.lx-tier-{bronze|silver|gold|lenda}`; they set the background and the ink.
The ink tokens `--tier-*-ink` are a **proposed contract addition**.

**Metal recipe (bronze, silver, gold)**
```
linear-gradient(135deg, mix(t1 82%, black) 0%, mix(t2 90%, black) 28%, t3 46%, t2 60%, t1 100%)
```

**Lenda recipe**
```
conic-gradient(from 200deg at 60% 40%, pink, ice, mint, cream, rose, lilac, pink)
```

**Badge `.lx-ovr` (sized by `--w`)**
- Size is `w × 1.14w`, radius `.2w`.
- Box shadow is inset 1px white .45, inset `0 -10px 22px` black .25, and drop `0 18px 40px -14px` black .9.
- `::before` is the engraved frame, inset 5px, radius `.15w`, 1px black .18 plus a top white hairline.
- The label "OVR" is `.115w` / 800 / .16em / opacity .62. The number is Barlow 800 at `.62w`.
- The sheen (`.lx-sheen`) is a soft-light diagonal white band that sweeps every 5.5 s (idle 0–70 %), with a 1.2 s delay.
- Sizes:

| `--w` | Where | Notes |
|---|---|---|
| **100** | Career hero | Mobile 78 |
| 96 | Default | |
| 58 | Identity jersey stage | |
| 50 | Match side box | `.lx-ovr--compact`: no label, number `.6w`, radius `.25w` |
| 40 | Season "you" line | Compact |

**Delta `.lx-delta`**
- Absolutely placed at the bottom centre, −9px, 20px high, padding `0 7`, radius 7.
- bg `#07130d`, positive line border, Barlow 700 13, arrow 11 with stroke 2.6.
- `--down` variant is red.

**Pill `.lx-ovr-pill`**
- min 38×22, radius 7, Barlow 800 15, inset 1px white .35, drop `0 4px 10px -4px`.
- `--ghost` is transparent with a strong border.
- The predicted, pending value sits at opacity .55.

**Player card `.lx-pcard`** (LENDA shield, 250×356 design box, resolution independent)
- Shape: an SVG mask (path in the CSS), so it scales to any width; `aspect-ratio 250/356`. Children use **cqw units** because the card is a size container.
- Frame: an SVG overlay with an outer 1.4px white .55 stroke, an inner path 1px black .22, and a second inner path .8px white .35 offset y+1.
- Surface: the metal recipe, a `::before` pinstripe (`repeating-linear-gradient(125deg, white .14 0 1px, transparent 1px 7px)` in overlay), and a `::after` top-left specular plus diagonal glare (soft-light). Lenda swaps the pinstripe for a `repeating-conic` sunburst.
- Layout (px at 250 wide, cqw in brackets):

| Element | Position and size |
|---|---|
| OVR column | left 30 (12), top 40 (16), width 58. OVR 60 (24) at `.78` line height; position 20 (8); 30px rule; flag 30×22; crest 32. |
| Kit | left 86, top 30, 152×152 (60.8) |
| Name | top 190 (76), Inter Tight 900 26 (10.4) |
| Stats row | 3 columns, top 232 (92.8), inset 34 (13.6), 1px black .18 top rule. Label 9.5 (3.8) / 800 / .14em / .62. Value Barlow 700 24 (9.6). |
| Tier label | top 296 (118.4), 9.5 / 800 / .34em / .6 |

- Drop shadow `0 30px 40px rgba(0,0,0,.55)`.
- Sizes used: 250 (landing hero centre ×1.08), ~195 (summary slot, .78), 150.

---

## 9. Trophy art & metals

**Metal ramps** (contract `--metal-*`; 1 = darkest, 8 = specular)
- gold `#3d2603 #5c3a05 #94640f #a87414 #d4a236 #f4cf63 #ffe697 #fff4cc`
- silver `#2b2f37 #474d59 #5a6270 #747c8a #8f98a6 #bec6d1 #e3e8ed #fbfcfd`
- bronze `#3d1f0d #5a2e14 #7a4220 #9a5a2e #b36a38 #c47d49 #e09c68 #f0b884`
- wood `#1a0e06 #4c2b14 #7d4b23`
- **malachite** `#03271b #0d7446 #43d796` (World Cup bands) and **lacquer** `#050506 #232529 #40434b` (black plinths). These two are *proposed additions under the `--metal-*` family*.

Every gradient stop is written as `style="stop-color:var(--metal-gold-5,#d4a236)"`:
- **Inlined**, the stops follow the theme.
- **Loaded as `<img>`**, they fall back to the exact mockup hex.
- The trophy art also has overlay strokes (for example `#6b4206` panel lines and `#fff4c8` highlights) and fixed flag colours (Brasileirão and Copa do Brasil rings `#0f9a50` / `#ffd21f`). These are hard-coded on purpose.

| File (`snippets-noite/trophies/`) | viewBox | Aspect | Built from |
|---|---|---|---|
| `world-cup.svg` | 0 0 100 180 | .556 | gold spiral figures + globe + 2 malachite bands |
| `ballon-dor.svg` | 0 0 100 140 | .714 | radial-gold ball with projected truncated-icosahedron panels, black lacquer plinth |
| `golden-boot.svg` | 0 0 140 112 | 1.25 | vertical gold boot, studs, lacquer base with plate |
| `champions-league.svg` | 0 0 130 180 | .722 | "Orelhuda": big-eared silver cup |
| `libertadores.svg` | 0 0 100 180 | .556 | silver figurine on ball + cone cup, wooden base with 20 gold/silver plaques |
| `brasileirao.svg` | 0 0 100 180 | .556 | silver open frame around gold core, green/yellow ring, black base |
| `copa-do-brasil.svg` | 0 0 120 180 | .667 | wide silver cup with handles, green/yellow band |
| `copa-america.svg` | 0 0 100 180 | .556 | lidded silver cup on 3-tier wooden base with plaques |
| `laliga.svg` | 0 0 110 180 | .611 | tall lidded silver cup with gold ring. This is the generic European league cup, labelled "LaLiga" in the mockups. |
| `estadual.svg` | 0 0 100 150 | .667 | slim silver goblet (Paulistão / any state title) |
| `trophies-sprite.svg` | n/a | n/a | shared `<defs>` (ids `lx-lg-gold`, `lx-rg-gold`, `lx-lg-silver`, …) and `<symbol id="lx-trophy-{name}">` |

**Usage**
- Mount the sprite **once**, inline, inside the `[data-theme]` root (`<TrophySprite/>`). Then render:
  ```html
  <svg class="lx-trophy" viewBox="0 0 100 180" style="aspect-ratio:.556;height:70px"><use href="#lx-trophy-libertadores"/></svg>
  ```
- Set the height and let the width follow.
- Sizes by context:

| Context | Height |
|---|---|
| Table row | **19** (nation row 24) |
| Tag | 13 |
| Tooltip | 15 |
| Scoreboard | 26 |
| Shelf | 70 (estadual 58) |
| Cabinet | 86 (boot 52) |
| Honor card | 108 (boot 92) |
| Feature card | 118 |
| Landing float | 150–200 |
| Trophy sheet | 220 (boot 150) |
| Celebration | **380** |
| Ceremony | **400** |

- **Tinting variants** (for example a silver "Chuteira de Prata"): render the SVG with its **own** defs (unique ids via `useId`) inside a wrapper that remaps `--metal-gold-N: var(--metal-silver-N)`.
  - This only works when the defs sit inside the wrapper, because stop `var()`s resolve where the `<stop>` element lives.
- Stacks of repeated titles overlap by −16px, with a `×N` count badge at top-right (−16px).

**Other illustration**
- `brand-mark.svg`: 32 grid, gold diagonal gradient shield, `--bg-2` field, "L" stroke 2.6, star `--metal-gold-8`.
- `jersey.svg`: back-of-shirt "portrait". CSS vars `kit-base`, `kit-base-2`, `kit-trim`, `kit-ink`, `kit-stroke`, `kit-stripe`, `kit-stripe-on`. Name is Inter Tight 900 20 (17 when longer than 8 characters), letter-spacing 2.2, y=72. Number is Barlow 800 96, y=165. Presets are listed in the file.
- `pitch-vertical.svg`: identity picker, 328×400, grass `#0f4a2c → #0c3d24 → #0a321e`, 25px stripes at 2.8 %, top spotlight, lines white .32 1.4px.
- `pitch-horizontal.svg`: match, 1000×560. Crop to `236 -10 780 580` for the attacking view. Tokens, shot cone and run path are documented inside the file.

---

## 10. Component anatomy

The global components are implemented as `.lx-*` classes; the page layouts are specified here and demonstrated in the snippets.

### 10.1 Global chrome
- **Top bar.**
  - Height 60, flex, `gap 18`, `padding 0 24`, above the stage (`z 5`).
  - Brand: mark 30×30 + "LENDA" (display 900 19 / .16em) + sub-label `CLÁSSICO | IMERSIVO | NOVA CARREIRA | SIMULADOR DE CARREIRA` (11/600/.1em, `--text-3`, `margin-left 8`, `vertical-align 3px`).
  - Right cluster: icon buttons, gap 8.
- **Session pill (career top bar).** 34h, `padding 0 14 0 12`, r11, `--surface`, border. 12.5/600 `--text-2`, bold parts in `--text`, 3px separator dots `--nx-text-4`.
  - Career progress: 120×4 track (`white .08`) with a club gradient fill and glow, plus a tabular "10/24".
- **Icon button `.lx-icon-btn`.** 38×38 (44 on phones), r12, `--surface` + border, icon 18, `--text-2`; hover `--surface-2` / `--text`. The notification dot is 7px `--warning` with a 2px `--bg-2` ring at top 7 / right 7.
- **Buttons `.lx-btn`.** All are 700 weight, gap 10, icon 18.

| Variant | Height, padding, size | Look |
|---|---|---|
| base | 50h, `0 24`, 15px, r14 | |
| `--primary` | | white → `#e9ebf0`, ink `#0a0b10`, hover lifts −1px |
| `--gold` | | `#ffe7a3 → #e7b54a`, ink `#231600` |
| `--ghost` | | `--surface` + `--border-strong`; hover `--surface-2` / `--nx-border-3` |
| `--sm` | 38h, `0 14`, 13px, r11 | |
| `--md` | 44h, 13.5px | |
| `--xl` | 56h, `0 26`, 16px, r16 | |

  - Active state scales to .98. Disabled is opacity .45.
- **Segmented `.lx-seg`.**
  - Track: padding 4, r13, `rgba(0,0,0,.3)`, border.
  - Items: 32h, `0 15`, r9, 13/700 `--text-3`.
  - `[aria-pressed=true]`: `--surface-3`, `--text`, inset strong border, drop `0 4px 12px -4px #000`.
  - `--solid` (identity foot choice): the selected item is white/ink with `0 6px 16px -6px` white .4, items 36h r10.
- **Tabs `.lx-tab`.** 32h, `0 13`, r10, 13/650 `--text-3`. Selected is `--surface-2` + inset strong border. `.lx-tab__badge` is 10/800, `0 6`, r5, amber on amber .14.
- **Chip `.lx-chip`.**
  - 24h, `0 9`, r8, 11.5/700/.02em, `--surface-2` + border.
  - Flag 18×13 r2.5; number `.lx-chip__n` is Barlow 700 13.
  - Position variants `--atk|mid|def|gk`, and `--muted`.
- **Tag `.lx-tag`.** 18h, `0 6 0 4`, r6, 10/800/.04em uppercase, icon 11 at stroke 2.8, trophy 13. Variants:
  - `--up`: ACESSO
  - `--down`: REBAIXADO
  - `--gold`: BOLA 3º, ARTILHEIRO
  - On phones the text hides and the icon stays; keep `title` / `aria-label`.
- **kbd `.lx-kbd`.** min 20×20, r6, 10.5/700 `--text-3`, border strong, `rgba(0,0,0,.25)`. Hidden on touch devices.
- **Effect chip `.lx-fx`.** 32h, `0 6 0 5`, r10, 12.5/650.
  - Icon tile 22×22 r7 with a 13px icon. The percentage `.lx-fx__p` is Barlow 700 14 on the same tint, `1px 7px`, r6.
  - `--pos`: +OVR. `--neg`: −OVR. `--amb`: captain, special. `--neu`: neutral.
  - The text always carries a sign ("+3 OVR", "−2 OVR", with a real minus).
- **Inputs.**
  - `.lx-input`: 46h, r13, `rgba(0,0,0,.35)`, strong border, `0 14`. Focus: border white .4 + 4px ring white .06.
  - `--name`: 800 16 / .08em uppercase, counter "7/12" 11/600 `--text-3`.
  - `.lx-stepper`: 32 | 1fr | 32, value Barlow 800 24.
  - `.lx-range`: native input, 6px track, fill `#7ef0bd → #fff` via `--pct`, 18px white thumb with a 5px white .12 halo.
- **Bars `.lx-bar`.** 6px, r6, track white .07, fill `linear(--from → --to)` width `--v`, animated 420ms. The club variant is 4px with a glow.
- **Status.**
  - `.lx-live`: 30h pill, positive tint, 12/650 `#bdf5dc`, dot 7px with 3px ring and glow. `--red` for the ceremony, 11/800/.14em uppercase.
  - `.lx-pill-gold`: 30h, 11/800/.16em, `#ffe7a6` on `rgba(40,28,4,.55)`, gold border .35, blur 10.
  - `.lx-badge-new`: "NOVO", holographic, 9.5/800.
  - `.lx-you`: "VOCÊ" / "SEU CLUBE", white, 9.5/800/.08em.
- **Tooltip `.lx-tooltip`.** min 230, `10 12`, r14, `rgba(12,13,19,.92)`, border white .18, `0 20px 40px -12px`, blur 10. Offset (18, 10) from the pointer, flipped near edges.

### 10.2 Landing (`landing.html`)
- **Stage** `lx-stage--brand`: indigo at the top-left, warm gold behind the art, pitch green at the floor.
- **Nav** (≥ `lg`): links 34h, `0 12`, r10, 13.5/600 `--text-2`, margin-left 28. "Modo Imersivo" carries a NOVO badge.
- **Language switch.** Track padding 3, r12. Buttons 30h `0 10` r9 12/700 with a flag 18×13. The selected one is white/ink. On phones only the selected flag shows.
- **Hero grid.** `610px | 1fr`, gap 20, `padding 6 24 0 64`.
  - Live pill: "Temporada 2026 ao vivo | Tabelas reais de hoje · 27 set", with a 1×12 separator.
  - H1, then the lead (max 540, mb 22).
- **Modes** (radiogroup, 2 columns, gap 12, max 590).
  - `.lx-mode`: padding `15 16 14`, r18. Icon tile 36 r11 (the selected one is a gold gradient with ink `#2a1a00`). Title 16.5/800. Kicker 11/600 `--text-3`. Description 12.5/1.45, mt 10. Check 20 circle (`#ffd66e`) at top/right 14.
  - Meta chips: 22h, `0 8`, r7, 11/650, 12px icon ("~10 min", "120+ taças").
  - The Imersivo card shows a mini live match: 30h, r9, `rgba(0,0,0,.3)`, crests 18, score Barlow 800 17, minute in `--positive` with a glowing dot.
- **Rhythm.** Eyebrow "RITMO" + `.lx-seg` (Intensa / **Normal** / Expressa) + hint 12.5 `--text-3` with the bold part in `--text-2`. Margin `16 0 20`.
- **CTAs** (gap 10).
  - `btn--primary --xl` "Começar carreira →".
  - `btn--ghost --xl` "Continuar": crest 22, a two-line label (13/700 and 11/600 `--text-3` "RIBEIRO · 25 anos · OVR 87").
  - Achievements icon button 56×56 r16 with a count badge "12/48" (10/800 amber, `#1a1d26`, bottom −6).
- **Art column** (684h):
  - `.lx-halo` 760 at 50 %/44 %.
  - `.lx-rays` 1100 spinning over 90 s.
  - Floor SVG 900×240: ellipse `330×70` stroked with a white .16 radial, a centre dot, a horizon line.
  - **Card fan**, box 640×560, cards at left 195 / top 70, `transform-origin: 50% 100%`:

| Card | Transform | Filter |
|---|---|---|
| c1 | `translateX(-196px) translateY(42px) rotate(-17deg) scale(.8)` | `brightness(.86) saturate(.9)` + drop `0 30 40 .6` |
| c2 | `translateX(-104px) translateY(14px) rotate(-8deg) scale(.88)` | same |
| c3 | `translateX(118px) translateY(18px) rotate(9deg) scale(.9)` | same |
| c4 (front, lenda 94) | `translateY(-14px) scale(1.08)`, z 5 | none |

  - Floating trophies (`.lx-bob`):

| Trophy | Height | Placement | Tilt | Bob | Delay | Extra |
|---|---|---|---|---|---|---|
| Ballon d'Or | 170 | right 4, top 44 | +8° | 6 s | 0 | |
| World Cup | 200 | left 6, bottom 76 | −6° | 7 s | .6 s | |
| Libertadores | 150 | right 30, bottom 96 | none | 8 s | 1.2 s | blur .4px |

  - **Trail** pill (`.lx-glass-tag`, bottom 30, centred): eyebrow "A TRAJETÓRIA" + 4 steps (pill 32×20 at 14px + age), arrows 14 `--nx-text-4`.
- **Ticker.**
  - Glass bar 58h, r18, max 1344, mt 14.
  - Label block: `0 18`, border-right, positive tint `.05`, "AO VIVO" 11/800/.12em + "Líderes de hoje" 10.5/600.
  - Items: `0 22`, border-right, league logo tile 30 (white gradient, r9, padding 4), name 12.5/700, round 11/600, leader chip (26h, crest 17, points Barlow 700 15 + "PTS" 10.5).
  - Motion: marquee over 70 s, starting after a 4 s delay, with edge fade masks at 4 % and 92 %.
- **Features** (mt 72).
  - Section header: eyebrow + H2 34/800 on the left; a 14px `--text-2` paragraph (max 420) on the right.
  - Grid of 4, gap 14.
  - `.feat` card: padding 20, r22, min-h 250. Art 150h with a 170px radial glow (`--fg`), trophy 118. H3 18/800. Paragraph 13/1.5.
  - The standings mini-table shows rows 1–3 and 18–20 as 20h rows with 3px zone bars.
- **Footer.** Border-top, 11.5 `--text-3`, `22 24 40`, two spans split with space-between.

### 10.3 Identity — "Nova carreira · 1 Identidade" (`identity.html`)
- **Top bar** 62h, with the stepper centred.
  - Steps are 24×24 r8 Barlow 700 14 tiles. The current step is white with an 18px white glow. Connectors are 40×1.
  - Close button on the right.
- **Title row.**
  - Left: eyebrow "MODO CLÁSSICO · RITMO NORMAL", H1 36, sub 14 `--text-2`.
  - Right: "Rascunho salvo automaticamente", 12 `--text-3`, save icon 14.
- **Panel.** `.lx-glass` r26, grid `350 | 1fr | 372`.
  - Columns: padding `18 20`, dividers `border-left var(--border)`.
  - Column header: "01 Identidade" (index Barlow 700 13 `--text-3` + display 800 16) on the left; status "✓ Pronto" (11/700 positive, icon 13 at stroke 3) on the right.
- **01 Identidade.**
  - Jersey stage 236h, with:
    - a conic light cone behind (240×330, 7 % white, blur 4);
    - a floor shadow ellipse 220×34;
    - the kit 226px, offset 30px right, drop `0 24 30 .55`, swaying over 6 s;
    - OVR 58 bronze at left 4 / top 12 with the caption "INICIAL" (9.5/700/.1em) below;
    - a rotate-shirt icon button at top-right.
  - Fields: labels 10.5/700/.12em. Sobrenome + Número sit in a `minmax(0,1fr) 112px` grid, gap 10 (**`min-width:0` on the field**).
  - "Perna dominante" uses `.lx-seg--solid` with 2 items; the left boot icon is mirrored.
  - "Altura": label row with the value "1,84 m" in Barlow 15, then the range, then 3 labels (10.5 `--text-3`): 1,60 · "Mais forte no jogo aéreo" · 2,00. The middle label describes the gameplay effect.
- **02 Nacionalidade.**
  - Search input with a `/` kbd.
  - "POPULARES" chips: 30h, `0 10 0 7`, r9, 12/650, flags 18×13.
  - List well: r16, border, `rgba(0,0,0,.18)`, padding 8, 2 columns gap 4, bottom fade 70px, custom 4px scrollbar.
  - Country row: 50h, r12, 13.5/650, flag 32×24 r4 with a ring and shadow.
  - Selected: `90deg club 22% → club-2 6%`, border club-2 .35, `0 10px 30px -14px` club .7, check 22px circle in club-2 with a dark check.
  - Ambient uses `.lx-stage--duo` in the nation colours.
- **03 Posição.**
  - Pitch `aspect 328/400`, r18. Chips `.lx-pchip` at the % positions listed in the SVG file.
  - The family is shown by the border tint. Selected is white with a 5px halo, a 30px glow and a pulsing ring (inset −10, r16, 2 s).
  - Position card: padding 14, r16, `--surface`. Header "Centroavante" 16/800 + family chip (22h).
  - 3 attribute rows (`110 | 1fr | 26`, 22h, 12/600). The bar is in the position family colour (ATK `#ff6b81 → #ffb1be`). Value Barlow 700 15.
- **Action bar.** Glass r20, padding 10, mt 12.
  - "← Voltar" ghost on the left.
  - A centre summary (flag 20×15, "RIBEIRO #9" 700, · Centroavante · Destro · 16 anos · 2026) at 13 `--text-2`. Hidden below `md`.
  - "Confirmar identidade →" primary on the right.

### 10.4 Career — Modo Clássico cockpit (`career.html`)
**Layout.** Grid `560px | 1fr`, gap 20, `padding 4 24 24`, max 1440, height `calc(100vh-60px)`, min 820.
- The left column is flex, gap 12, holding hero, stats, shelf and decision (the decision grows).
- The right column is the career table, full height.

**Top bar centre.** Session pill "Temporada 2035 · Ritmo Normal" + "Carreira ▬▬▬ 10/24". Right: Salvar · Som · Conquistas (with a dot) · Menu.

**Hero `.lx-club-card`** (r22, padding `18 20 18 18`, gap 18, centred)
1. OVR badge (`--w:100`, tier by value) + `.lx-delta` "↑2".
2. Main block:
   - chips (flag BRA, `--atk` "#9 CA", `--muted` "Destro");
   - name 36/900;
   - club line: crest 24, name 15/700, then league (logo 15 + name 12/600 `--text-2`, 1px left divider, padding-left 9).
3. Right KV stack (gap 10, right-aligned):
   - "IDADE" 25;
   - "VALOR" €68M, with a sub-line "↑ €14M" in 11/700 positive.
   - Eyebrows 9.5, values Barlow 700 34/.95.
4. Watermark crest.

**Stats bar.** 4 columns (Jogos · Gols · Assist. · Títulos), padding `9 6 8`, r18, `--surface` + border.
- Vertical 1px dividers, inset 8px.
- Eyebrow 10 with a 13px icon (shirt, ball, boot, trophy). Value Barlow 700 27.

**Vitrine (shelf).** `.lx-shelf` 104h, r18.
- Header: "VITRINE 8" on the left, "Ver todas →" (11.5/650) on the right.
- Trophy row: absolute, inset `left 84 / right 104 / bottom 12`, space-between.
- Groups: repeated copies overlap by −16px, 70h (estadual 58). Warm 90px spot (the gold variant for the World Cup). `×N` count badge.

**Decision card** (`.lx-glass` r22 + `.lx-top-light`, padding `16 16 14`, flex column, grows)
- Top row:
  - left: amber eyebrow with a pulsing dot, "JANELA DE TRANSFERÊNCIAS";
  - right: progress dots (12×4, gap 3; done `--text-2`, current amber with an 8px glow, future white .09) + "Decisão 7 de 12" (11.5/600 `--text-3`).
- Title 23/800, then sub 13/1.45 `--text-2` (max 480) with bold facts in `--text`.
- **Options.** Grid of 2, gap 12, flex 1. Each is `.lx-option` with `--oc` = that club's glow:
  1. Header: verb eyebrow ("ASSINAR COM" / "RENOVAR COM") + name 19/800 on the left, `kbd 1` on the right.
  2. Crest zone 78h, crest 70, halo.
  3. Meta, centred: league logo 14 · name · dot · flag 16×12 · code (11.5/600 `--text-2`).
  4. Effects list (gap 6, pushed to the bottom): each outcome is one `.lx-fx` with its probability.
  5. Footer: dashed top border, "Salário **€14M/ano**" / "Contrato **5 anos**" (11/600 `--text-3`, values `--text-2` 700).
  - The keyboard-focused or hovered option lifts −3px (§11).
  - Two options is the default. Three options → grid of 3 on ≥ `lg`, and a stack below `sm`.

**Career table** (`.lx-glass .lx-club-panel`, r22, padding `14 14 12`)
- Tabs: Carreira (chart icon) · Temporada 2035 · Prêmios + badge "BOLA 3º". Right aside: "🕐 Próxima decisão em 2 temporadas" (11.5 `--text-3`). Bottom divider with 12px padding.
- Columns: `34 | 40 | minmax(0,1fr) | 50 | 52 | 46 | 46`, column-gap 6, row padding `0 10 0 6`.
- Header row: 24h, 10/700/.12em uppercase. Age spans 2 columns. Number columns are centred with 12px icons (shirt J, ball G, boot A).
- Rows: 27h, r9, 13px, gap 2. **One row per age from 16 to 39, always.**
- Row types:

| Type | Class | Content |
|---|---|---|
| Filled | `--filled` | age badge · year (11/600 `--text-3` tabular) · club (crest 18, name 650 with ellipsis, trophies 19h gap 2, tags) · OVR pill · J G A (650 tabular; a zero is `--nx-text-4`) |
| Loan | `--loan` | lighter tint + a `CornerDownRight` 14px icon before the crest, `--nx-text-4` |
| Current season | `--current` | strong tint + ring + glow |
| Pending / next | `--pending lx-shimmer` | 1px dashed `--nx-border-3`, age badge `#2a2e38`, "? Decisão de carreira…" (12.5/600 `--text-3`, the "?" in an 18px circle), a predicted OVR pill at .55 |
| Future | `empty` | age in `--nx-text-4`, a dashed 4/8 hairline, opacity `max(.28, 1 − (age−27)·.06)` |

- **National team row** (below, border-top): 36h, `.lx-club-row--nation`.
  - Flag badge 30×22 r6 · "2031–" · national crest 20 + "Seleção Brasileira" · trophies 24h · caption "Campeão do Mundo 2034" (10.5 `--text-3`) · caps / goals / assists.

**Mobile (< `sm`) order.** Hero → stats → shelf → decision → table (the single column follows DOM order). §12 has the details.

### 10.5 Celebration overlay (`celebration.html`) — title won
Layer order, bottom to top:
1. The career screen stays mounted as `.lx-under` (blur 4px, brightness .55, saturate 1.1, scale 1.02).
2. `.lx-veil`: warm spot 600×520 at 50 %/34 %, club 30 %, dark centre falloff.
3. `.lx-beam`: 900×720 top cone, blur 6.
4. `.lx-rays--celebration`: 1300px, 60 s.
5. Confetti.
6. `.lx-outline-word` "CAMPEÃO" at top 128.
7. Content (dialog).
8. Corners.

Content column (centred, padding-top 34), top to bottom:
1. Gold pill "🏆 8º TÍTULO DA CARREIRA".
2. Trophy 380h, mt 10: `.lx-trophy--hero .lx-rise`, glow 420 breathing over 3.6 s. A **glint** sparkle (160px, 4-point conic star, screen blend, 2.6 s twinkle) sits at 150px from the top.
3. `.lx-floor` 460×40 (mt −26), with a gold rim light.
4. Kicker: 12/800/.3em mint with 40px gradient rules each side, "CAMPEÃO DA AMÉRICA · 2035".
5. H1 64/900 chrome, then sub 15 `--text-2` ("…o gol do título é **seu**").
6. Score card `.lx-glass` (mt 18, padding `12 22`, r20, gap 22):
   - teams at min 170 (display 800 18, crest 44);
   - the loser at `--text-3` with the crest at .6 opacity and grayscale .4;
   - score Barlow 800 44/.04em "2 × 1" (× in `--text-3`, margin `0 6`);
   - small "FINAL · CENTENÁRIO, MONTEVIDÉU" 10.5/700/.14em.
7. Scorers row (width 660, 2 columns, gap 120): ball icon 13 + name + **minute**. The player's own goal is gold (`#ffe7a6`) and the opponent's is `--text-3`.
8. Facts (mt 16, gap 10): 40h pills, `.lx-glass-tag` r12, icon tile 24 r8.
   - Gold: "Craque da final", "Artilheiro… 11 gols".
   - Positive: "OVR 87 → 88" (with pills).
9. Actions (mt 22): "Continuar →" primary + "Compartilhar momento" ghost.

Corners:
- top-left, a glass card "TAMBÉM EM 2035 · Campeão Brasileiro" with its 30px trophy (for a second title that season);
- top-right, Som + ✕ (skip).

Confetti is `canvas-confetti`:
```ts
confetti({ particleCount: 140, spread: 80, startVelocity: 45, origin: { y: .25 },
           colors: [club, clubDark, '#ffffff', '#ffd66e', '#f3c14a', clubLight], disableForReducedMotion: true })
```
Fire a second burst at +700 ms from both sides (`angle` 60/120, `origin.x` .1/.9). The CSS fallback in the snippet uses 110 pieces (8×14, 12×5 or 8px dots), 5–11 s falls, ±80px drift and up to 900° spin.

### 10.6 Bola de Ouro ceremony (`ballondor.html`)
- **Stage** `--ceremony` + spot cone (760×900 at 27 %, blur 8) + 40 dust motes (3px `#ffe6a8`, gold glow, rising 140px over 4–9 s, random delays).
- **Top bar.** Brand + `.lx-live--red` "CERIMÔNIA AO VIVO" (ml 18) on the left; Som + ghost sm "Pular cerimônia" on the right.
- **Grid** `600 | 1fr`, gap 28, `height calc(100vh - 60px)`.
- **Left column** (centred, pt 18):
  - `.lx-serif-gold` "Ballon d'Or" 76px;
  - year Barlow 700 20 with .5em tracking in `#d8b36a`;
  - venue 12/600 `--text-3` ("Théâtre du Châtelet · Paris · 20 de outubro");
  - trophy stage 470h (glow 460, breathing over 4 s): trophy 400h (mb 36) on a pedestal ellipse 380×60 with a gold rim line.
- **Ranking card.** `.lx-glass` r26, padding 18, border gold .16.
  - Header: gold eyebrow "E o vencedor é…" + H1 24/800 "Ranking da Bola de Ouro 2037" on the left.
  - Reveal progress on the right: 10 bars 14×4 (revealed gold `#d8b36a`, current white with a glow) + "10 de 10 revelados".
- **Winner `.lx-winner .lx-sweep`.** Grid `auto 1fr auto`, gap 18, padding `16 18`, r20.
  - "1º" Barlow 800 64/.8 in vertical gold, with "LUGAR" below (12/.2em `#d8b36a`).
  - Name 34/900 + `.lx-you` (10px here).
  - Meta: flag 20×15 · Brasil · crest 20 · Real Madrid · 27 anos (13/600 `--text-2`).
  - Award chips: 24h, r7, `rgba(0,0,0,.3)`, border gold .25, 11.5/700 `#ffe7a6`, trophy 16 ("61 gols", Champions, LaLiga, Chuteira de Ouro).
  - Points Barlow 800 38 "1.284" + "PONTOS".
- **Nominees 2–10.** Grid `34 26 1fr 150 70`, gap 12, 38h, r11, `white .022` + border `.035`.
  - Position Barlow 800 18 (top 3 in `#e7c06a`), flag 24×18, name 700 + crest 20 + club 12/600 `--text-3`.
  - Points bar 6px (`#8a6420 → #e7c06a`, width = pts / winner), value Barlow 700 16.
- **Speech bar.** `.lx-glass` r20, padding `12 14`: "Seu discurso" 15/800 + "O mundo está ouvindo" 11.5 `--text-3`, then 3 radio options.
  - Options: 50h, r13, 12.5/700, a coloured effect line 10.5/700 + kbd. The selected one has border white .4 + a 3px ring.

### 10.7 Career summary (`summary.html`)
- **Top bar.** Brand | divider + "Resumo da carreira" (13/650 `--text-2`, ml 18, pl 18, border-left). Right: ghost sm "Ver tabela completa" · ghost sm "Compartilhar card" · primary sm "Jogar novamente".
- **Top band.** Grid `236 | 1fr | 620`, gap 22, height 280.
  - **Card slot:** a lilac radial 300 behind the player card (scale .78, ~195 wide).
  - **Ident:**
    - eyebrow "FIM DE CARREIRA · 2026 – 2049 · 24 TEMPORADAS" (3px dot separators);
    - H1 68/900;
    - legacy line: holo pill "👑 LENDA" (24h, 11/800/.08em) + "Ídolo do Real Madrid e do Palmeiras" (14.5/650 `#e9dcff`);
    - chips (mt 14): flag, #9 CA, "Pico **94** aos 28", "Aposentou aos 39";
    - big KPIs (mt 20, 4 auto columns, gap 30): Barlow 800 46/.9 + eyebrow 10 (JOGOS · GOLS · ASSISTÊNCIAS · TÍTULOS).
  - **Honors** (3 × `.lx-honor`, gap 12, r22):

| Card | `--hg` / `--hl` |
|---|---|
| Individual (Bola de Ouro) | gold .26 / .32 |
| Seleção (Copa do Mundo) | green `rgba(60,220,140,.22)` / `rgba(80,230,160,.28)` |
| Artilharia (Chuteira) | amber .2 / default border |

    - Corner label 10/800/.1em at top/right 12. Art 112h (trophy 108, boot 92).
    - Name 16/800 + `×N` Barlow 800 34 in vertical gold.
    - Year chips: 22h r7 11.5/700, gold highlight for wins; "3º 2035" and "Vice 2038" stay plain.
    - Footer: dashed rule + "2038 · **1º Você** · 2º L. Yamal" (11/600, key 10/800 uppercase, me in `#ffe7a6`; ellipsis when it overflows).
- **Middle.** Grid `1fr | 540`, gap 16, mt 18.
  - **OVR chart panel** (`.lx-glass` r22, padding `16 18 14`):
    - header "Evolução do OVR" 17/800; legend dots 10px with glow (Bola de Ouro gold, Copa do Mundo green) + "Idade 16 → 39".
    - Chart 356h, `pl 34 pr 58 pt 14 pb 26`, Y range 50–100, X ages 16–39. The layers:

| Layer | Spec |
|---|---|
| Tier bands | §8 colours; right-edge labels LENDA/OURO/PRATA/BRONZE, 10/700/1.4 tracking, `#8a8f9c` |
| Gridlines | every 10, white .06 |
| Axis labels | 10.5/600 `--text-3` |
| Line | 2.2px, round joins; hard-stop tier gradient in user space (bronze < 70, prata 70–80, ouro 80–90, lenda ≥ 90); duplicated at 6px, blur 4, opacity .35 as glow |
| Area | white .16 → 0 |
| Points | r3, fill `#0b0d12`, stroke white .7 |
| Event markers | r9 ring + r4 dot, gold (BdO) / green (WC) |
| Transfer markers | dashed white .14 verticals + 10px labels ("Real Madrid", "Volta ao Palmeiras") |
| Peak label | "PICO 94", 11/800 `#efe6ff` |
| Crosshair | white .35 line + r6 white dot with a 2px dark stroke; tooltip: crest + club + "2037 · 27 anos", OVR pill 24h + "**61** gols na temporada", award tags |

    - **Club strip** under the plot (30h, aligned to the plot insets): `.lx-club-strip` segments per spell (22h r7, crest 15, name shown when the spell is 4 or more seasons).
  - **Trophy room** (`.lx-glass`): "Sala de troféus" + "21 títulos · 5 prêmios".
    - Cabinet grid of 5, gap 8. Tile r14, padding `12 6 10`. Trophy zone 92h (trophy 86, boot 52) + 70px spot. Name 11/650 `--text-2` with ellipsis. Count badge Barlow 800 13, 24×19 r6 at top/right 7.
    - Gold tiles (World Cup, BdO, UCL, Boot) get a gold border .28 + radial.
    - Records chips: 28h r9 12/650 `--surface`, amber 14 icon, bold lead.
- **Por clube table** (`.lx-glass` r22, padding `16 18`).
  - Columns `1.3fr 170 80 80 80 80 1fr`, gap 10. Header 28h 10px. Rows 44h r12 mt 4 with a club gradient 18 % → white .015 @45 %.
  - Club: crest 26 + name 700 + league 11/600 `--text-3`. Period `--text-2` 600 tabular, **nowrap**. Numbers Barlow 700 17. Trophies 24h gap 3.

### 10.8 Season / standings (`season.html`; used in Clássico "Temporada" tab and Imersivo)
- Top bar tabs: Carreira · **Temporada 2026** · Elenco · Prêmios.
- Grid `1fr | 420`, gap 18.
- **Standings card** (`.lx-glass` r22, padding `16 16 12`):
  - Header: league logo tile 46 r14 (white gradient, `0 8 20 -8` shadow) + H1 24/800 + sub row (`.lx-live` 22h "Tabela real de hoje" + "Rodada 28 de 38 · 27 set 2026" 12.5 `--text-2`) + a seg on the right (Geral / Mandante / Visitante, 30h items).
  - Columns `36 1fr 46 36 36 36 36 46 64` (# · Clube · Pts · J · V · E · D · SG · Gols), gap 4, rows 30h r9 13px, zebra odd rows at white .018.
  - Cells: position Barlow 700 15 `--text-2` with a `.lx-zone` bar 3×18 + glow; crest 20; name 650; **Pts Barlow 800 16**; the rest 600 `--text-2`; SG in positive or negative colour; goals "55:23".
  - Zone boundaries: `.lx-cut` (dashed 6/5 in the zone colour at .6) after 4, 6, 12 and 16.
  - Your club: `.lx-club-row--mine` + "SEU CLUBE" badge.
  - Legend: swatches 10×10 r3, 11.5/600; source on the right ("Fonte: ESPN · atualizado 27/09/2026").
- **Next match card.**
  - Top club radial 380×200.
  - Header "Próxima rodada" + eyebrow "RODADA 29 · DOM 16H".
  - You-line: `rgba(0,0,0,.25)` r14, OVR 40 compact, name 14/800, "16 anos · reserva · estreia na R21", 3 mini stats (Barlow 19 + 9.5/800 labels).
  - VS block: crests 64, names 14/700, "2º · 57 pts" 11/600; centre "VS" Barlow 800 30 + venue 11.
  - Odds: 3 cells, 38h r10, `rgba(0,0,0,.28)`, label 11.5/650 + value Barlow 16.
  - Buttons, 2 columns: "▶ Jogar partida" (primary, 44h) and "Simular" (ghost).
- **Série B mini table.** Columns `30 1fr 36 40`, G4 cut + note "↑ G4 · Os 4 primeiros sobem para a Série A 2027".

### 10.9 Match HUD (`match.html`; Imersivo under Noite)
- **Scoreboard** (centred in the top bar, 46h, r14, `inset 0 0 0 1px white .1` + `0 16 40 -16` shadow). Segments:

| Segment | Look |
|---|---|
| competition | black .55, trophy 26h, 11/800/.1em "FINAL" |
| home | club gradient, crest 28, display 800 15/.04em "PAL" |
| score | `#f4f5f8` with dark ink, Barlow 800 28 "1–1", the dash at .35 |
| away | rival gradient |
| clock | black .7, red blinking dot, Barlow 700 20 "87:42" + stoppage "+4" 13 `#ffb3bf` |

- Right of the top bar: Som + ghost sm "Simular resto".
- **Layout.** Grid `1fr | 360`, gap 16.
- **Momentum strip.** Glass r18, 76h, `150 | 1fr`: eyebrow "PRESSÃO" + "Palmeiras domina" (14/800). Bars (0–90') are 7px wide, rx 2; home rises from the midline in `#2fd07f`, away drops in `#e5484d`; opacity .5–1; goal markers are r4 white dots on the scoring side.
- **Pitch.** r22, `shadow-2` + inset ring, horizontal pitch cropped. Player tokens and the "you" pulse are in `pitch-horizontal.svg`. The name tag is a white pill 100×26 r8 "**9** RIBEIRO" (the 9 in the club colour). The xG chip is `rgba(0,0,0,.6)` with a white .25 border, "xG 0.41" Barlow 700 14.
- **Decisive moment** `.lx-glass-hud` (bottom 16, width `min(820px, 100% − 32px)`, padding 16):
  - Header: countdown ring 48 (r21, stroke 4, track white .1, amber arc with `stroke-dasharray 132`, animating `dashoffset` linearly each second) + Barlow 800 20; kicker amber "✦ LANCE DECISIVO · 88'"; title 22/800; attribute chips on the right (30h r9: "Finalização **84**", "Frieza **79**", "Fôlego **41%**").
  - Choices: grid of 3, gap 10. Card r16, padding `12 12 10`, gradient .06→.02, strong border.
    - Icon tile 34 r11 + kbd; name 16/800; desc 12 `--text-2`.
    - Success probability: bar + Barlow 800 17 (safe green `#16a870→#3ee6a4`, risky amber `#c98a1c→#ffc857`, pass blue `#3f6fff→#8fb0ff`).
    - Consequence tags: 20h r6 10.5/700, green / amber / red.
    - Selected: border white .45 + 4px ring + `0 20 40 -18` green .5.
- **Side column:**
  - Me box: OVR 50 compact, "RIBEIRO #9", "Centroavante · 88 min em campo", rating tile 48×34 r10 green "7.8" + "NOTA".
  - Meters (`78 | 1fr | 34`): Fôlego orange→amber, Confiança green, Torcida lilac `#9a7cff→#e2d4ff`.
  - Live stats: rows 30h (values Barlow 700 16, label 11.5/600 centred, a 4px duel bar underneath split home/away).
  - Events feed: rows 38h, dashed dividers, minute Barlow 700 15 `--text-2`, icon tile 24 r8 (a yellow card is a solid `#ffd21f` tile), text 12.5 with bold event + small detail `--text-3`.

### 10.10 Trophy sheet / Sala de troféus (`trophies.html`)
- Grid of 5 (3 at `< lg`, 2 at `< sm`), gap 14.
- Card: glass r22, padding `18 14 14`. Art 230h (trophy 220, boot 150) with a 220px warm spot. Name 15/800, category 11.5/600 `--text-3`.
- Size-proof strip at 19px.

---

## 11. Motion

**Tokens**
- `--dur-1` 140ms: colour, press.
- `--dur-2` 240ms: buttons, tabs, chips, icon buttons.
- `--dur-3` 420ms: card lift, reveals, bars.
- `--nx-dur-4` 800ms: ambient crossfade, count-ups.
- Easing: `--ease-out` `cubic-bezier(.16,1,.3,1)` for UI; `--ease-spring` `(.34,1.56,.64,1)` for pops and crests; `--nx-ease-io` `(.65,0,.35,1)` for sweeps and ambient.
- `motion` equivalents:
  - ease-out → `{ duration: .42, ease: [.16, 1, .3, 1] }`
  - spring → `{ type: 'spring', stiffness: 420, damping: 28 }`
  - soft spring → `{ type: 'spring', stiffness: 260, damping: 26 }`

**Ambient loops (CSS, `lxn-*` keyframes)**

| Effect | Class | Loop |
|---|---|---|
| OVR / card sheen | `.lx-sheen` | 5.5 s, io, idle 0–70 %, delay 1.2 s |
| Winner sweep | `.lx-sweep` | 3.2 s, io |
| God rays | `.lx-rays` | 90 s (celebration 60 s), linear |
| Trophy float | `.lx-bob` | 6 / 7 / 8 s, ease-in-out, −8px, delays 0 / .6 / 1.2 s |
| Jersey sway | `.lx-sway` | 6 s, −4px, −.6° |
| Glow breathe | `.lx-trophy-glow` | 3.6 s (ceremony 4 s), opacity .7, scale 1.06 |
| Ticker | `.lx-marquee__row` | 70 s linear, starts after 4 s, pauses on hover and focus |
| Live dot | `.lx-dot--blink` | 1.6 s (scoreboard 1.2, ceremony 1.4), opacity .35 |
| Decision pulse | `.lx-dot--pulse` | 1.8 s, ring 0 → 8px |
| Pending row | `.lx-shimmer` | 2.2 s linear |
| Position ring | `.lx-pchip[aria-checked]` | 2 s ease-out, scale .85 → 1.3, fading |
| Caret | input | 1 s steps(1) |
| Dust | `.lx-dust i` | 4–9 s, rise 140px, fade in at 20 % |
| Glint | celebration | 2.6 s twinkle, scale .6→1, rotate 45° |
| "You" token | match SVG | r 20 → 34, 2 s |

**Interaction**

| Element | State | Change | Timing |
|---|---|---|---|
| `.lx-btn--primary` | hover | translateY −1px, glow grows | 240ms ease-out |
| `.lx-btn` | press | scale .98 | 140ms |
| `.lx-mode` | hover | translateY −2px, border | 420ms ease-out |
| `.lx-option` | hover / focus | translateY −3px, ring + `--oc` glow | 420ms ease-out |
| `.lx-option` crest | hover / focus | scale 1.05, rotate −2° | 420ms **spring** |
| Match choice | hover / focus | translateY −2px | 240ms |
| Icon button, seg, tab | hover / press | colour and background | 240ms |
| `.lx-bar` | value change | width | 420ms ease-out |
| Stage | club change | glow crossfade | 800ms io |

**Choreographies (use motion/react)**
- **Page enter.** Opacity 0→1 and y 8→0, 420ms ease-out. Children stagger by 40ms (top bar, then hero, stats, shelf, decision, table).
- **Career table fill.** On mount, rows 16→current stagger 35ms (`x −6 → 0`, opacity). After a decision resolves:
  1. The pending row's shimmer stops.
  2. Its background crossfades to the filled or current tint (420ms).
  3. The age badge pops (`scale .8 → 1`, spring).
  4. The OVR pill counts up (600ms).
  5. Trophies drop in from y −6 (spring), 80ms apart.
  6. The previous "current" row relaxes to filled.
  7. The next age becomes pending.
- **OVR change (hero).**
  1. The number counts to the new value (600ms, ease-out, via `animate()` on a motion value).
  2. When the tier changes, the badge background crossfades (420ms) and the sheen fires once immediately.
  3. The delta chip slides up from y 6 (240ms, 200ms delay).
  4. The value "€68M" counts too.
- **Decision reveal.**
  1. The card fades in (240ms).
  2. Title and sub rise (420ms, 60ms apart).
  3. Options enter with `y 14 → 0`, `scale .98 → 1` (spring 380/30), 80ms apart.
  4. The kbd hints appear last (140ms).
  - **On choose:**
    1. The chosen option scales 1.02 then settles (spring); the other option dims to .35 opacity and scale .98 (240ms).
    2. The outcome resolves: the `.lx-fx` that happened pulses (a background flash 140ms ×2) and the other chip fades to .3.
    3. 600ms later the table-fill sequence runs.
- **Celebration** (timeline in ms, skippable at any point with `Esc`, ✕ or "Continuar"):

| t (ms) | What happens |
|---|---|
| 0 | `.lx-under` blur 0 → 4px and brightness 1 → .55 (240); veil fades in (240) |
| 120 | Beam and rays fade in (800 io) |
| 200 | Trophy `lx-rise` (1400, ease-out); glow breathe starts |
| 600 | Confetti burst 1 |
| 900 | Kicker, then H1, then sub (420 each, 80 stagger, y 10 → 0) |
| 1300 | Score card rises; scorers fade |
| 1300 | Confetti burst 2 (side cannons) |
| 1500 | Facts stagger 80 |
| 1800 | Actions fade in; focus moves to "Continuar" |

- **Bola de Ouro reveal** (`aria-live="polite"` on the list):
  1. Nominees are revealed from 10th up to 2nd, one every 700ms. Each row slides from y 10, its bar grows from 0 over 800ms, the points count up, and the progress segment turns gold.
  2. After 2nd: a 1200ms "drumroll" hold, where the spotlight `--nx-glow` brightens 10 %.
  3. Winner: row `scale .96 → 1` (spring 300/22) with a border flash; then `.lx-sweep` and the dust start and the serif title glints.
  4. 400ms later the speech options stagger in.
- **Match moment.** The HUD slides up from y 24 (420 ease-out) while the pitch dims to 85 %. The timer ring ticks linearly every second. When time runs out, the default choice fires. The result briefly flashes the pitch (a goal: a white radial at .12 over 240ms plus a scoreboard pulse).

**Reduced motion** (`useReducedMotion()` / `@media (prefers-reduced-motion: reduce)`, already in the CSS):
- Every ambient loop stops: rays, bob, sway, sheen, sweep, shimmer, dust, blink, pulse and ring.
- The marquee becomes a static, horizontally scrollable list.
- State changes become opacity-only at 120ms, with no lifts, springs or counts. Count-ups jump straight to the value.
- Celebration and ceremony render their final state at once; confetti is off.
- The stage switches colour without a crossfade.

**Performance.** Only animate `transform`, `opacity` and `background-position`. Give the rays `will-change: transform`. Pause loops when `document.hidden`. Keep ≤ 6 blurred glass elements visible at once. Add `.lx-lowfx` on low-end devices (no blur, no grain, no rays).

---

## 12. Responsive rules

Breakpoints (Tailwind, mobile-first): **`sm` 576 · `md` 720 · `lg` 1104 · `xl` 1280**. The mockup's max-width rules at 560 / 700 / 1100 correspond to below-`sm`, below-`md` and below-`lg`.

**Career cockpit (the key collapse)**
- **≥ `lg`:** two columns `560px | 1fr`, locked to the viewport height (`calc(100vh − 60px)`, min 820).
  - The left column is flex; the decision card grows and its options fill the remaining height.
  - The table column is full height; its rows keep 27px, and the space below the last visible age is empty.
- **< `lg`:** one column, `height: auto`. The order is hero, stats, shelf, decision, table.
  - The top bar hides the career progress and the secondary pill.
  - Decision options stay 2-up.
  - The table shows all ages.
- **< `sm` (phone):**

| Area | Change |
|---|---|
| Top bar | 16px gutter; centre pills hidden; brand sub-label hidden; icon buttons 44 |
| Shell | padding `4 12 20`, gap 12 |
| Hero | padding 14, wraps; OVR `--w 78`; name 28; league hidden; KV becomes a 2-column row under a 1px divider, left-aligned, values 26 |
| Stats | values 24; eyebrows 9 without icons |
| Shelf | row inset 18, `space-around`, trophies 46 (estadual 40), only the first 4 groups |
| Decision | title 21; step dots hidden (text only); options gap 8, padding `12 10 10`; name 16; crest 62 in a 74 zone; meta 10.5; fx 11.5 / % 13; long fx text (`· adaptação`) hidden; footer stacks; tagline hidden |
| Table columns | `30 | 1fr | 42 | 30 | 28 | 28` (**year column removed**) |
| Table rows | font 12.5, padding `0 6 0 4`; age 28w; tag text hidden (icon only), loan text tag hidden |
| Table tabs | scroll horizontally (`overflow-x:auto`, no scrollbar, tabs `flex:none`); aside hidden |
| Table length | ages ≥ 30 hidden, replaced by "+10 temporadas pela frente · até os 39" (11.5/600 `--text-3`, centred) |
| Nation row | caption hidden, name ellipsised |

**Landing**
- `< lg`:
  - hero becomes one column with the art **on top** (`order:-1`, 560h);
  - nav hidden;
  - features 2-up.
- `< sm`:

| Area | Change |
|---|---|
| Top bar | 60h; only the selected language flag |
| Art | 384h, full bleed (`margin 0 −16`), card fan `scale(.62)` from the top centre; halo 520 / rays 700 at 36 %; Ballon d'Or 100 at top-right; World Cup 112 at bottom-left; Libertadores hidden; trail compact (labels hidden) |
| Type | H1 46; lead 15 |
| Modes | stacked |
| Rhythm | seg full width with equal items; the hint wraps |
| CTAs | "Começar" grows, medal next to it, "Continuar" drops to a full-width second row |
| Ticker | 16px margin; label sub-line hidden |
| Features | 1 column; the standings feature card must let its art box grow (mockup defect §16.1) |
| Footer | stacked |

**Identity**
- `< lg`: panel `1fr 1fr`, and Posição spans the full width under a border-top. Step labels are hidden except the current one.
- `< md`: a single column with dividers on top; the title stacks; the action-bar summary is hidden.

**Summary** (not mocked for phones; the rules follow the same system):
- `< xl`: top band `236 | 1fr` with honors on a full-width row below (3-up).
- `< lg`: chart and cabinet stack; cabinet 5-up becomes 4-up.
- `< sm`: card centred above the ident; KPIs 2×2; honors horizontally scroll-snapped (280px cards); clubs table becomes cards (club + period on line 1, J/G/A/T chips on line 2).

**Ceremony, celebration, match** (phones):
- Ceremony: left column collapses to a 160px header (serif 44, trophy 180), then the ranking; the speech bar stacks.
- Celebration: trophy 220; H1 36; the score card becomes full width; facts wrap; corner cards hidden.
- Match: the side column moves below the pitch as tabs (Você · Estatísticas · Lances); the momentum label is hidden; the HUD becomes a bottom sheet with choices stacked (56h rows).

**Global**
- No page-level horizontal scroll. Fix overflow at the source; don't rely on the mockup's `html{overflow-x:clip}` hack.
- Gutters are 16px on phones and 24px on desktop.
- Touch targets are ≥ 44px.
- Keyboard hints (kbd) are hidden on touch devices.

---

## 13. Iconography

Use lucide-react **1.48** (installed). Render through a wrapper so the defaults match the mockup:
```tsx
export const Icon = ({ as: C, size = 18, strokeWidth = 1.9, ...p }) => <C size={size} strokeWidth={strokeWidth} absoluteStrokeWidth={false} aria-hidden {...p} />;
```
**Sizes.**
- 18: buttons, icon buttons, choice tiles.
- 14–15: eyebrows, stepper, small buttons.
- 13: fx chips, stats eyebrows, chip icons.
- 11: tags and deltas, at stroke 2.6–2.8.
- Checks inside circles use stroke 3–3.2.

| Mockup key | lucide-react | Used for |
|---|---|---|
| medal | `Medal` | Achievements |
| volume | `Volume2` (muted `VolumeX`) | Sound |
| menu | `Menu` | Menu |
| arrow / back | `ArrowRight` / `ArrowLeft` | CTAs, trail |
| up / down | `TrendingUp` / `TrendingDown` | fx +/− OVR |
| flat | `Minus` | Neutral fx |
| loan | `CornerDownRight` | Loan rows |
| shirt | `Shirt` | Jogos |
| boot | `SportShoe` (or custom `BootIcon`, below) | Assist., perna |
| ball | **custom `BallIcon`** (lucide has no football) | Gols, goal events |
| trophy | `Trophy` | Títulos, pill |
| arrowUp / arrowDown | `ArrowUp` / `ArrowDown` | Delta, acesso, rebaixado |
| crown | `Crown` | Capitão, Lenda, records |
| search | `Search` | Country search |
| check | `Check` | Selected, Pronto |
| share | `Share` | Compartilhar |
| replay | `RotateCcw` | Jogar novamente, girar camisa |
| play | `Play` | Jogar partida |
| sparkle | `Sparkles` | Lance decisivo, cavadinha |
| star | `Star` | Craque, records |
| clock | `Clock` | Próxima decisão, ~10 min |
| cards | `Copy` | Modo Clássico icon |
| whistle | `Whistle` | Modo Imersivo, intervalo |
| globe | `Globe` | Idioma |
| live | `Radio` | Ao vivo |
| plus / minus / x | `Plus` / `Minus` / `X` | Stepper, close |
| chart | `ChartLine` | Carreira tab |
| target | `Target` | Chute colocado, defesa |
| save | `Save` | Salvar / rascunho |
| stadium | **custom `StadiumIcon`** | Venue |

Custom paths (24 grid, stroke 1.9, round caps and joins):
```
BallIcon:    <circle cx="12" cy="12" r="10"/><path d="m12 7.2 4.2 3-1.6 4.8H9.4L7.8 10.2z"/><path d="M12 7.2V2.3M16.2 10.2l4.6-1.5M14.6 15l2.9 4M9.4 15l-2.9 4M7.8 10.2 3.2 8.7"/>
BootIcon:    <path d="M3.5 5.5h5.2l1 3.6 3.3 2.1 5.4 1.3a3 3 0 0 1 2.3 2.9v1.1H3.5z"/><path d="M6 16.5v2.2M10 16.5v2.2M17 16.5v2.2"/>
StadiumIcon: <ellipse cx="12" cy="12" rx="10" ry="6"/><ellipse cx="12" cy="12" rx="5" ry="2.6"/><path d="M2 12v3c0 3.3 4.5 6 10 6s10-2.7 10-6v-3"/>
```

**Assets.**
- Flags come from the `flag-icons` package (already a devDependency; 4×3 SVG). Render them at 18×13, 20×15, 24×18, 30×22 or 32×24, with radius 2–6 and `box-shadow: 0 0 0 1px rgba(0,0,0,.25)` or `rgba(255,255,255,.08)` on dark.
- Crests and league logos are downloaded by `npm run data` into `/public`, never hot-linked. Always render them with `object-fit: contain` + `.lx-crest`.
- League logos sit on a white tile (`.lx-logo-tile`).

---

## 14. Accessibility

- **Contrast.**
  - Every text token is ≥ 4.5:1 on the glass card (table §2.2).
  - Tier inks on metal: bronze ≥ 5.3 on the body stop, silver 9.2, gold 10.1, lenda 12+.
  - `--club-ink` is computed (§1.5). Pale mid-greens such as Juventude `#119c4d` get dark ink (white is only 3.6:1).
  - Positive, negative and warning on their tinted backgrounds are 9.8, 5.7 and > 10.
  - `--nx-text-4` is decorative only.
  - `@media (prefers-contrast: more)` raises borders to .22/.34, raises `--text-3` and `--text-2`, and makes glass opaque.
- **Focus.**
  - `:focus-visible` draws a **2px solid white outline with a 2px offset**, following the border radius. White fills (primary button, solid seg) use a 3px offset.
  - Options, modes and choices also get their hover lift and ring on focus.
  - Focus is never hidden behind the stage (`z-index`: the stage is 0, the app 1).
- **Keyboard.**
  - `1` / `2` / `3` pick decision options, speech options and match choices. The kbd hint must match `aria-keyshortcuts`.
  - `Enter` confirms. `Esc` skips a celebration or ceremony. `/` focuses the country search. Arrow keys move inside radiogroups (modes, seg, pitch chips, countries).
- **Semantics.**
  - Modes, options, country list, pitch positions and speech → `role="radiogroup"` / `radio` with `aria-checked`.
  - Seg → `role="group"` with `aria-pressed`.
  - Tabs → `tablist` / `tab` / `aria-selected`.
  - The career grid and standings → `role="table"`, `row` and `cell`, or a real `<table>` with `display: grid` rows.
  - Celebration and ceremony → `role="dialog" aria-modal="true"` with a focus trap, and focus goes to "Continuar".
  - Scoreboard → `role="status"`. The ceremony list and the match event feed → `aria-live="polite"`. The timer → `role="timer"`.
- **Not colour-only.**
  - OVR always prints the number.
  - fx chips carry a sign and an icon.
  - Tags carry an arrow, plus text or `aria-label` on mobile.
  - Standings zones are explained by the legend, and each row's zone bar carries an `aria-label` ("Zona de rebaixamento").
  - Won and lost states use weight and opacity, not only colour.
- **Images.**
  - Crests and flags next to their names use `alt=""`. A standalone flag gets `alt="Brasil"`.
  - Trophies are `role="img" aria-label="Taça Libertadores"` when meaningful and `aria-hidden` when decorative (row repeats with a tooltip, landing floats).
- **Motion.** Reduced motion is honoured everywhere (§11). Celebrations never auto-advance faster than 6 s and are always skippable. Nothing flashes more than 3 times per second.
- **Transparency.** `prefers-reduced-transparency` and `.lx-lowfx` remove blur and make surfaces opaque.
- **Zoom and text.** Use `min-height` instead of `height` for rows in production (the mockup's fixed 27px and 30px rows break at 200 % text zoom). Truncate names with ellipsis and show the full name in `title` or a tooltip.
- **Locale.** `lang="pt-BR"` with `Intl` number and date formatting. ES and EN strings run 10–25 % longer, so no fixed-width text containers except the numeric columns.

---

## 15. Do / Don't

**Do**
- Set the club once on the root with `clubVars()` and let everything tint itself; override per row with `--row-club`.
- Keep numbers in `num` (Barlow + tabular) and right- or centre-align numeric columns.
- Use white for "do this" and gold for "you won this".
- Put exactly one strong light source per screen: the club glow top-left, or the spotlight for ceremonies.
- Show all 24 ages (16–39) in the career table, including future ones dimmed. The empty future is part of the game's tension.
- Use real trophy SVGs at every size (19px to 400px). Never replace them with emoji or generic cups.
- Keep ceremonies skippable and fast to dismiss. Replays belong in "Compartilhar momento".
- Use `.lx-clip` in shared components when Transmissão wants a clipped corner; Noite renders it as a radius.

**Don't**
- Don't add a second saturated accent (no blue buttons, no purple links). Lilac belongs to Lenda-tier only.
- Don't put glass on glass on glass. At most 2 blurred layers in any stack, and ≤ 6 visible.
- Don't use `--nx-text-4` or 9.5px text for anything the player must read.
- Don't hot-link ESPN or jsDelivr assets in production (the mockups do).
- Don't use pure black `#000` panels or pure white page backgrounds. The stage is `#07080c` and cards are translucent white.
- Don't animate layout properties (height, width, top) in loops, or blur more than the recipes.
- Don't hard-code club hex values in components. Always go through `--club*` / `--row-club*`.
- Don't derive club values in `[data-theme]` custom properties (§1.5 warning).
- Don't use `@theme inline` for radius, shadow, font or ease names (§1.4).

---

## 16. Mockup defects to fix while implementing

1. **Landing, phone.** In the "Acesso e rebaixamento" feature card, the zones table (7 rows ≈ 165px) overflows its fixed 150px art box and covers the H3. Use `min-height:150px; height:auto` for that card's art.
2. **`--tx-3 #6d7384`** fails AA on cards (3.9:1). It is already replaced by `#80869a` in the tokens.
3. **Summary, clubs table.** "2026–35 · 2044–49" wraps inside the 170px period column. Use `white-space: nowrap` with a 190px column, or format as two chips.
4. **Summary, honor footers** are clipped mid-word ("2º L. Yamal 3º…"). Add `text-overflow: ellipsis` or allow 2 lines.
5. **Summary chart tooltip** covers the line to the right of the pointer. Flip it to the left when the pointer is past 60 % of the width, and clamp it inside the plot.
6. **Career, phone.** The tab row overflows the viewport, and the mockup hides this with `html{overflow-x:clip}`. Use a horizontally scrollable tab list instead (done in `career-cockpit.html`).
7. **Celebration** renders the career in an `<iframe>`. In React, keep the career screen mounted underneath and apply `.lx-under`.
8. **Bahia kit.** The centre stripe runs through the surname. Render the name text with `paint-order: stroke; stroke: var(--kit-base); stroke-width: 3px` for striped kits.
9. **Identity.** The inputs, stepper and range are `div`s in the mockup. Use real `<input>`, `<output>` and `<input type=range>` (`.lx-range`). The field grid needs `min-width:0`, found while building the snippet.
10. **Ceremony.** The speech options wrap to 3 lines at 1440 ("Dedicar ao Palmeiras" + effect). Allow 2 lines and a 56px min-height, or shorten the copy.
11. **`.icon-btn` 38px** is below the touch minimum. The theme bumps it to 44 on phones.
12. **Season.** `.row` collides with the global `.row` utility in `lenda.css`. The production classes are namespaced (`.lx-*`, and Tailwind for layout).
13. **Future ages in the career table** are drawn with 2.1:1 ink. This is acceptable only because they are decorative placeholders, so mark them `aria-hidden` and announce "13 temporadas restantes" once.

---

## 17. Snippet index (`design/snippets-noite/`)

| File | Demonstrates |
|---|---|
| `stage-ambient.html` | `.lx-stage`: club glows, floodlights, grain, vignette, presets, **800ms club crossfade via @property** (buttons switch clubs, including `--club-glow` for Real Madrid and Botafogo) |
| `player-card.html` | `.lx-pcard` in 4 tiers at 250, 196 and 150px (mask shape, cqw layout, pinstripe, holo sunburst, jersey) |
| `ovr-badges.html` | `.lx-ovr` at 100, 58, 50 and 40 (compact), sheen, delta, `.lx-ovr-pill` in all tiers + ghost + pending, landing trail |
| `landing-hero.html` | H1 metal text, live pill, mode cards, seg, CTAs, card fan, halo, rays, floor, bobbing trophies; responsive rules included |
| `career-cockpit.html` | Club hero card, stats bar, vitrine shelf, decision card + options + fx chips, full career table (filled, loan, current, pending shimmer, future), nation row; phone rules |
| `celebration.html` | Veil, beam, rays, outline word, gold pill, trophy rise + breathe + glint, floor, chrome H1, score card, facts, confetti (CSS fallback + canvas-confetti config) |
| `ballon-dor.html` | Serif gold title, spotlight, dust, trophy stage, reveal progress, winner row with sweep, nominee bars, speech radio |
| `ovr-chart.html` | Tier bands, hard-stop tier gradient line + glow, event markers, transfer markers, crosshair + tooltip, club strip |
| `match-hud.html` | Scoreboard, momentum bars, cropped pitch, decisive-moment HUD with timer ring and probability bars, meters, duel stats |
| `standings.html` | Zone bars, cut lines, your-club row, legend |
| `identity-controls.html` | Jersey stage (cone, floor, sway), name input, stepper, solid seg, range, country radio list, pitch position picker with pulsing ring, attribute bars |
| `ticker.html` | Live leaders marquee (duplicated row, pause on hover, reduced-motion fallback) |
| `trophy-gallery.html` | All 10 trophies via the sprite (`<use>`), via standalone `<img>` (hex fallbacks), and at 19px |
| `brand-mark.svg` · `jersey.svg` · `pitch-vertical.svg` · `pitch-horizontal.svg` | Illustration art (§9) |
| `trophies/*.svg` + `trophies-sprite.svg` | Trophy art (§9) |

---

## 18. Proposed shared class API (both themes implement the same names)

So that React stays theme-agnostic, `theme-transmissao.css` should style the same class names under its own `[data-theme]`. Noite implements all of them:
- **Surfaces:** `lx-stage` (+ `--brand|duo|legend|ceremony|versus`, slots `--lx-glow-a|b|c`), `lx-glass`, `lx-glass-flat`, `lx-glass-well`, `lx-glass-hud`, `lx-glass-tag`, `lx-tooltip`, `lx-hairline`, `lx-top-light`, `lx-clip`, `lx-clip-sm`, `lx-noise`, `lx-vignette`, `lx-veil`, `lx-under`.
- **Type:** `lx-eyebrow`, `lx-display`, `lx-num`, `lx-metal-text` (+ `--v`), `lx-chrome-text`, `lx-serif-gold`, `lx-outline-word`.
- **Light:** `lx-sweep`, `lx-sheen`, `lx-club-glow`, `lx-halo`, `lx-rays` (+ `--celebration`), `lx-beam`, `lx-trophy-glow`, `lx-floor`, `lx-shimmer`, `lx-dust`, `lx-bob`, `lx-sway`, `lx-rise`.
- **Status:** `lx-dot` (+ `--blink|pulse`), `lx-live` (+ `--red`), `lx-pill-gold`, `lx-badge-new`, `lx-you`.
- **Controls:** `lx-btn` (+ `--primary|gold|ghost|sm|md|xl`), `lx-icon-btn` (+ `__dot`), `lx-seg` (+ `__item`, `--solid`), `lx-tab` (+ `__badge`), `lx-input` (+ `--name`), `lx-stepper`, `lx-range`, `lx-bar` (+ `--club`), `lx-kbd`.
- **Data:** `lx-chip` (+ `__flag|__n`, `--atk|mid|def|gk|muted`), `lx-tag` (+ `--up|down|gold`), `lx-fx` (+ `__ic|__p`, `--pos|neg|neu|amb`).
- **Rating:** `lx-tier-bronze|silver|gold|lenda`, `lx-ovr` (+ `__l|__n`, `--compact`), `lx-ovr-pill` (+ `--ghost`), `lx-delta` (+ `--down`), `lx-pcard` (+ `__shape|__frame|__ovr|__flag|__crest|__kit|__name|__stats|__tier`).
- **Club:** `lx-club-card` (+ `__wm`), `lx-club-panel`, `lx-club-row` (+ `--filled|loan|current|pending|mine|nation`), `lx-age` (+ `--pending|empty`), `lx-club-strip`, `lx-option` (+ `__crest`), `lx-mode`, `lx-honor`, `lx-winner`.
- **Trophies & sport:** `lx-trophy` (+ `--hero|card|row`), `lx-trophy-spot` (+ `--gold`), `lx-count` (+ `--gold`), `lx-shelf`, `lx-zone`, `lx-cut`, `lx-pchip` (+ `--atk|mid|def|gk`), `lx-marquee` (+ `__row`), `lx-logo-tile`, `lx-crest`, `lx-flag`.
- **Performance:** `lx-lowfx` (on the root).

// Logo do LENDA em alta resolução: escudo detalhado (vetor) + palavra "LENDA" na fonte do jogo.
// Gera PNGs para a foto de perfil (círculo do TikTok) e um SVG mestre do escudo.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// node scripts/marca/logo.mjs [pasta-de-saida]   (padrão: docs/marca)
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = process.argv[2] || join(RAIZ, 'docs', 'marca')
const NM = join(RAIZ, 'node_modules')
mkdirSync(OUT, { recursive: true })
const fonte = 'data:font/woff2;base64,' + readFileSync(`${NM}/@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2`).toString('base64')

// ── escudo (viewBox 32×32, mesmos traços do favicon do jogo, com dourado em camadas e relevo) ──
const OUTER = 'M16 1.8 28.4 6.6V16c0 7.2-5.6 12.3-12.4 14.2C9.2 28.3 3.6 23.2 3.6 16V6.6z'
const INNER = 'M16 4.9 25.5 8.6V16c0 5.7-4.3 9.8-9.5 11.3C10.8 25.8 6.5 21.7 6.5 16V8.6z'
const L = 'M12.6 10.2v11.2h7.6'
const STAR = [[19.6, 9.2], [20.5, 11.1], [22.5, 11.4], [21.0, 12.8], [21.4, 14.8], [19.6, 13.8], [17.8, 14.8], [18.2, 12.8], [16.7, 11.4], [18.7, 11.1]]
const SC = [19.6, 12.25]
const facetas = STAR.map((p, i) => {
  const q = STAR[(i + 1) % STAR.length]
  const claro = i % 2 === 0
  return `<path d="M${SC[0]} ${SC[1]}L${p[0]} ${p[1]}L${q[0]} ${q[1]}z" fill="${claro ? 'url(#e-claro)' : 'url(#e-escuro)'}"/>`
}).join('')
const estrelaD = 'M' + STAR.map((p) => p.join(' ')).join('L') + 'z'
const brilho = (x, y, r, op = 1) => `<g transform="translate(${x} ${y})" opacity="${op}"><path d="M0 ${-r}C${r * 0.12} ${-r * 0.12} ${r * 0.12} ${-r * 0.12} ${r} 0C${r * 0.12} ${r * 0.12} ${r * 0.12} ${r * 0.12} 0 ${r}C${-r * 0.12} ${r * 0.12} ${-r * 0.12} ${r * 0.12} ${-r} 0C${-r * 0.12} ${-r * 0.12} ${-r * 0.12} ${-r * 0.12} 0 ${-r}z" fill="#fffbe9"/><circle r="${r * 0.18}" fill="#fff"/></g>`

const escudo = (id = 'e') => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">
  <defs>
    <linearGradient id="e-ouro" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#fff6d3"/>
      <stop offset=".18" stop-color="#f7d47a"/>
      <stop offset=".42" stop-color="#e2a93b"/>
      <stop offset=".58" stop-color="#f6cf6c"/>
      <stop offset=".78" stop-color="#b07a1e"/>
      <stop offset="1" stop-color="#6e4608"/>
    </linearGradient>
    <linearGradient id="e-ouro-l" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff3c4"/>
      <stop offset=".35" stop-color="#f4c95d"/>
      <stop offset=".7" stop-color="#d79c33"/>
      <stop offset="1" stop-color="#8a5a0c"/>
    </linearGradient>
    <linearGradient id="e-brilho" x1="0" y1="0" x2="0.9" y2="0.9">
      <stop offset="0" stop-color="#fff" stop-opacity=".75"/>
      <stop offset=".35" stop-color="#fff" stop-opacity=".12"/>
      <stop offset=".55" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="e-campo" cx=".45" cy=".35" r=".8">
      <stop offset="0" stop-color="#1d2130"/>
      <stop offset=".6" stop-color="#0d1017"/>
      <stop offset="1" stop-color="#05060a"/>
    </radialGradient>
    <linearGradient id="e-claro" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fffbe8"/>
      <stop offset="1" stop-color="#f6d27a"/>
    </linearGradient>
    <linearGradient id="e-escuro" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e9b852"/>
      <stop offset="1" stop-color="#a86f17"/>
    </linearGradient>
    <clipPath id="e-clip-ext"><path d="${OUTER}"/></clipPath>
    <clipPath id="e-clip-int"><path d="${INNER}"/></clipPath>
    <filter id="e-sombra" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation=".35"/>
      <feOffset dx=".18" dy=".3" result="b"/>
      <feComponentTransfer><feFuncA type="linear" slope=".7"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <!-- borda dourada -->
  <path d="${OUTER}" fill="url(#e-ouro)"/>
  <g clip-path="url(#e-clip-ext)">
    <path d="${OUTER}" fill="url(#e-brilho)"/>
    <!-- chanfro: luz em cima/esquerda, sombra embaixo/direita -->
    <path d="${OUTER}" fill="none" stroke="#fff8dc" stroke-opacity=".8" stroke-width=".55" transform="translate(-.18 -.22)"/>
    <path d="${OUTER}" fill="none" stroke="#4a2e04" stroke-opacity=".55" stroke-width=".6" transform="translate(.2 .26)"/>
  </g>
  <path d="${OUTER}" fill="none" stroke="#2c1b02" stroke-width=".22" stroke-opacity=".9"/>
  <!-- friso entre a borda e o campo -->
  <path d="${INNER}" fill="none" stroke="#3a2504" stroke-width="1.05" stroke-opacity=".75"/>
  <path d="${INNER}" fill="none" stroke="#fff1bf" stroke-width=".22" stroke-opacity=".7" transform="translate(-.08 -.1)"/>
  <!-- campo escuro com reflexo -->
  <path d="${INNER}" fill="url(#e-campo)"/>
  <g clip-path="url(#e-clip-int)">
    <ellipse cx="11" cy="7.5" rx="9" ry="5" fill="#ffffff" opacity=".05"/>
    <path d="${INNER}" fill="none" stroke="#000" stroke-opacity=".7" stroke-width="1.4" transform="translate(.25 .35)"/>
    <path d="${INNER}" fill="none" stroke="#f4c95d" stroke-opacity=".28" stroke-width=".12" transform="translate(16 16.2) scale(.86) translate(-16 -16.2)"/>
  </g>
  <!-- L com relevo -->
  <g filter="url(#e-sombra)">
    <path d="${L}" stroke="#5a3a06" stroke-width="2.95" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${L}" stroke="url(#e-ouro-l)" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <path d="M12.05 10.5v10.4" stroke="#fffbe6" stroke-opacity=".7" stroke-width=".42" stroke-linecap="round"/>
  <path d="M12.9 20.55h6.9" stroke="#fffbe6" stroke-opacity=".55" stroke-width=".36" stroke-linecap="round"/>
  <path d="M13.15 11v9.6" stroke="#6b4407" stroke-opacity=".45" stroke-width=".3" stroke-linecap="round"/>
  <!-- estrela lapidada -->
  <g filter="url(#e-sombra)">
    <path d="${estrelaD}" fill="#7a4f0a" transform="translate(19.6 12.25) scale(1.09) translate(-19.6 -12.25)"/>
    ${facetas}
  </g>
  ${brilho(19.6, 9.35, 1.05, .95)}
  ${brilho(8.6, 7.55, 1.25, .9)}
  ${brilho(26.2, 17.5, .55, .55)}
</svg>`

// SVG mestre do escudo (fundo transparente)
writeFileSync(`${OUT}/lenda-escudo.svg`, escudo().trim().replace('width="100%" height="100%"', 'width="1024" height="1024"') + '\n')

const pagina = (corpo, { fundo = true } = {}) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'IT';font-weight:100 900;src:url('${fonte}') format('woff2')}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1024px;height:1024px;overflow:hidden;background:${fundo ? '#07080c' : 'transparent'}}
.fundo{position:absolute;inset:0;background:
  radial-gradient(52% 52% at 50% 45%, rgba(244,201,93,.26), rgba(244,201,93,.07) 45%, rgba(244,201,93,0) 70%),
  radial-gradient(90% 90% at 50% 40%, #1d2132 0%, #10131c 55%, #07080c 100%)}
.raios{position:absolute;inset:-20%;background:repeating-conic-gradient(from 0deg at 50% 46%, rgba(255,230,160,.055) 0deg 4deg, rgba(255,230,160,0) 4deg 15deg);
  -webkit-mask:radial-gradient(closest-side at 50% 46%, #000 25%, transparent 72%);mask:radial-gradient(closest-side at 50% 46%, #000 25%, transparent 72%)}
.anel{position:absolute;left:50%;top:50%;width:900px;height:900px;margin:-450px 0 0 -450px;border-radius:50%;
  box-shadow:inset 0 0 0 3px rgba(244,201,93,.35), inset 0 0 0 9px rgba(244,201,93,.07), inset 0 0 80px rgba(0,0,0,.6)}
.grao{position:absolute;inset:0;opacity:.09;mix-blend-mode:overlay}
.palco{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.escudo{filter:drop-shadow(0 18px 30px rgba(0,0,0,.65)) drop-shadow(0 0 40px rgba(244,201,93,.28))}
.palavra{font-family:'IT';font-weight:900;color:#fff;letter-spacing:.16em;line-height:1;
  background:linear-gradient(180deg,#ffffff 0%,#f3f1ea 55%,#cfcbbf 100%);-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 6px 10px rgba(0,0,0,.6))}
.linha{height:4px;border-radius:2px;background:linear-gradient(90deg,rgba(244,201,93,0),#f4c95d 30%,#fff1bf 50%,#f4c95d 70%,rgba(244,201,93,0))}
</style></head><body>${corpo}</body></html>`

const grao = `<svg class="grao" width="1024" height="1024"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`
const cena = (miolo, anel = true) => `<div class="fundo"></div><div class="raios"></div>${grao}${anel ? '<div class="anel"></div>' : ''}<div class="palco">${miolo}</div>`

const VARIANTES = [
  // perfil: escudo + LENDA empilhados, tudo dentro do círculo do TikTok
  { nome: 'lenda-perfil', html: pagina(cena(`<div class="escudo" style="width:520px;height:520px;margin-top:-30px">${escudo()}</div>
      <div class="palavra" style="font-size:150px;margin-top:-6px;padding-left:.16em">LENDA</div>
      <div class="linha" style="width:330px;margin-top:30px"></div>`)) },
  // perfil só com o escudo (lê melhor bem pequeno)
  { nome: 'lenda-perfil-escudo', html: pagina(cena(`<div class="escudo" style="width:700px;height:700px;margin-top:-10px">${escudo()}</div>`)) },
  // escudo sozinho, fundo transparente
  { nome: 'lenda-escudo', html: pagina(`<div class="palco"><div class="escudo" style="width:900px;height:900px">${escudo()}</div></div>`, { fundo: false }), transparente: true },
]

const b = await chromium.launch({ executablePath: process.env.LENDA_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
for (const v of VARIANTES) {
  const p = await b.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 2 })
  await p.setContent(v.html, { waitUntil: 'load' })
  await p.evaluate(() => document.fonts.ready)
  await p.waitForTimeout(300)
  await p.screenshot({ path: `${OUT}/${v.nome}.png`, omitBackground: !!v.transparente })
  await p.close()
}
// logo horizontal (como no topo do jogo), fundo transparente
{
  const p = await b.newPage({ viewport: { width: 1600, height: 480 }, deviceScaleFactor: 2 })
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:'IT';font-weight:100 900;src:url('${fonte}') format('woff2')}
    html,body{margin:0;width:1600px;height:480px;background:transparent}
    .l{height:100%;display:flex;align-items:center;justify-content:center;gap:56px}
    .e{width:340px;height:340px;filter:drop-shadow(0 10px 18px rgba(0,0,0,.5))}
    .w{font-family:'IT';font-weight:900;font-size:230px;letter-spacing:.16em;color:#fff;line-height:1;filter:drop-shadow(0 6px 10px rgba(0,0,0,.45))}
  </style></head><body><div class="l"><div class="e">${escudo()}</div><div class="w">LENDA</div></div></body></html>`, { waitUntil: 'load' })
  await p.evaluate(() => document.fonts.ready)
  await p.waitForTimeout(300)
  await p.screenshot({ path: `${OUT}/lenda-logo-horizontal.png`, omitBackground: true })
  await p.close()
}
await b.close()
console.log('ok')

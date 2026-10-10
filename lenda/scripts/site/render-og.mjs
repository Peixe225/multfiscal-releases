#!/usr/bin/env node
/**
 * Refaz scripts/site/og.jpg — a imagem de compartilhamento do site (1200×630, o cartão que aparece no
 * WhatsApp, Discord, X, Facebook quando alguém cola o link). O build:site só COPIA este arquivo; rode este
 * script quando a landing mudar e suba o og.jpg novo junto.
 *
 * Fotografa a landing de verdade (cartas em leque, troféus, halo — o HeroArt do jogo, nada redesenhado):
 * serve uma pasta compilada em /lenda/ num servidor local, abre no Chromium a 1200×630 com 2× de
 * densidade (a foto é reduzida depois: bordas e letras mais limpas), esconde o que é da interface (menu,
 * cards de modo, botões, faixa da trajetória) e põe por cima, à esquerda, o texto do cartão: escudo +
 * LENDA, a frase da landing e os três jeitos de jogar — grande, porque a prévia aparece pequena no celular.
 *
 * Precisa do Playwright, que não faz parte do projeto (não entra no npm install; o --no-save não mexe no
 * package.json — o import() do Node não acha pacote instalado com -g, daí o PLAYWRIGHT_MODULE abaixo):
 *   npm i --no-save playwright && npx playwright install chromium
 *   npm run build            (ou npm run build:site — qualquer pasta compilada serve)
 *   node scripts/site/render-og.mjs
 * Variáveis: SITE_DIR (pasta compilada; padrão dist-site, senão dist), PLAYWRIGHT_MODULE (caminho do
 * index.mjs do playwright, se não estiver instalado onde o Node acha), CHROMIUM_PATH (outro Chromium).
 */
import http from 'node:http'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'

const root = fileURLToPath(new URL('../..', import.meta.url))
const dir = process.env.SITE_DIR ? join(root, process.env.SITE_DIR) : ['dist-site', 'dist'].map((d) => join(root, d)).find((d) => existsSync(join(d, 'index.html')))
if (!dir || !existsSync(join(dir, 'index.html'))) {
  console.error('nenhuma pasta compilada: rode "npm run build" (ou npm run build:site) antes')
  process.exit(1)
}
const out = join(root, 'scripts', 'site', 'og.jpg')

const mod = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(mod ? pathToFileURL(mod).href : 'playwright').catch(() => {
  console.error('Playwright não encontrado: npm i --no-save playwright && npx playwright install chromium (ou PLAYWRIGHT_MODULE=…/playwright/index.mjs)')
  process.exit(1)
})

// ── servidor local: /lenda/* → pasta compilada (o mesmo caminho do site, para nada depender da raiz) ──
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' }
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (!p.startsWith('/lenda/')) return res.writeHead(404).end()
  let f = normalize(join(dir, p.slice('/lenda/'.length)))
  if (!f.startsWith(dir)) return res.writeHead(403).end()
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html')
  if (!existsSync(f)) return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' })
  res.end(readFileSync(f))
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const base = `http://127.0.0.1:${server.address().port}/lenda/`

// ── o que vai por cima da landing ──
const CSS = `
  /* fora: tudo que é interface (no cartão ninguém clica) e o que envelhece (a data das tabelas) */
  .lx-topbar, .ld-copy, .ld-trail, .ld-ticker, .lx-toaster, [data-sonner-toaster], footer { visibility: hidden !important; }
  /* a arte um pouco menor e para cima: as cartas e os três troféus inteiros dentro dos 1200×630; o halo
     dourado mais forte (na prévia pequena, o brilho atrás das cartas é o que chama o olho) */
  .ld-art { transform: translate(-22px, -44px) scale(.84); transform-origin: 60% 0; }
  .ld-art .lx-halo { width: 820px; background: radial-gradient(circle, rgba(255, 214, 130, .42) 0%, rgba(255, 180, 80, .15) 30%, rgba(140, 110, 255, .07) 50%, transparent 66%); }
  .og { position: fixed; z-index: 50; left: 64px; top: 0; bottom: 0; width: 600px; display: flex; flex-direction: column; justify-content: center; color: #f4f5f8; font-family: var(--font-ui); }
  .og__brand { display: flex; align-items: center; gap: 14px; }
  .og__brand img { width: 50px; height: 50px; filter: drop-shadow(0 6px 18px rgba(231, 181, 74, .35)); }
  .og__word { font: 800 34px/1 var(--font-display); letter-spacing: .2em; }
  .og__sub { margin-left: 6px; padding-left: 16px; border-left: 1px solid rgba(255, 255, 255, .18); font: 700 13px/1.2 var(--font-ui); letter-spacing: .16em; text-transform: uppercase; color: rgba(244, 245, 248, .62); }
  .og__h1 { margin: 34px 0 20px; font: 800 78px/.95 var(--font-display); letter-spacing: -.035em; text-wrap: balance; }
  .og__lead { margin: 0; max-width: 520px; font-size: 23px; line-height: 1.42; color: rgba(244, 245, 248, .78); }
  .og__lead b { color: #fff; font-weight: 650; }
  .og__chips { display: flex; gap: 10px; margin-top: 30px; }
  .og__chip { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px; border-radius: 12px; font-size: 17px; font-weight: 700; color: #f4f5f8; background: rgba(255, 255, 255, .06); border: 1px solid rgba(255, 255, 255, .14); }
  .og__chip i { width: 8px; height: 8px; border-radius: 50%; background: #e7b54a; box-shadow: 0 0 10px rgba(231, 181, 74, .8); }
  .og__chip--live i { background: #ff4d6d; box-shadow: 0 0 10px rgba(255, 77, 109, .9); }
`
const HTML = `
  <div class="og">
    <div class="og__brand"><img src="./favicon.svg" alt=""><span class="og__word">LENDA</span><span class="og__sub">Simulador de carreira</span></div>
    <h1 class="og__h1">Construa sua carreira no <span class="lx-metal-text">futebol.</span></h1>
    <p class="og__lead">Dos 16 aos 40 anos: <b>títulos, Bolas de Ouro e Copas do Mundo</b>, com as tabelas reais de hoje.</p>
    <div class="og__chips"><span class="og__chip"><i></i>Modo Clássico</span><span class="og__chip"><i></i>Modo Imersivo</span><span class="og__chip og__chip--live"><i></i>Live no TikTok</span></div>
  </div>
`

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
try {
  // movimento reduzido: as cartas já nascem na posição final (sem a animação de entrada pela metade)
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: 'dark' })
  await page.goto(base, { waitUntil: 'load' })
  await page.waitForSelector('.ld-fan__slot--front .lx-pcard', { timeout: 20_000 })
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  await page.addStyleTag({ content: CSS })
  await page.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), HTML)
  // fontes e imagens (troféus, escudos, bandeiras) carregadas antes da foto
  // (com prazo: imagem com loading="lazy" fora da tela nunca dispara o load)
  await page.evaluate(async () => {
    await document.fonts.ready
    const imgs = [...document.images].map((i) => (i.complete ? null : new Promise((ok) => ((i.onload = ok), (i.onerror = ok)))))
    await Promise.race([Promise.all(imgs), new Promise((ok) => setTimeout(ok, 4000))])
  })
  await page.waitForTimeout(600)
  const png = await page.screenshot({ type: 'png' })
  // 2400×1260 → 1200×630; o JPEG mais bonito que caiba em 300 KB (o WhatsApp ignora imagem grande)
  let q = 88
  let jpg
  for (;;) {
    jpg = await sharp(png).resize(1200, 630, { kernel: 'lanczos3' }).jpeg({ quality: q, mozjpeg: true, progressive: true, chromaSubsampling: '4:4:4' }).toBuffer()
    if (jpg.length <= 280 * 1024 || q <= 60) break
    q -= 4
  }
  writeFileSync(out, jpg)
  if (process.env.OG_PNG) writeFileSync(process.env.OG_PNG, png)
  console.log(`og.jpg: 1200×630 · ${Math.round(jpg.length / 1024)} KB (qualidade ${q}) → ${out}`)
} finally {
  await browser.close()
  server.close()
}

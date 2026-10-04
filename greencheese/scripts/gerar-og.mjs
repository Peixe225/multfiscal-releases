// Gera public/og.png (1200×630, imagem de compartilhamento no padrão story) e public/apple-touch-icon.png (180×180).
// Uso: com "npm run dev" rodando, execute "npm run og".
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5173/'
const pasta = new URL('../public/', import.meta.url).pathname
const b = await chromium.launch()
for (const [modo, w, h, arq] of [
  ['og', 1200, 630, 'og.png'],
  ['icone', 180, 180, 'apple-touch-icon.png'],
]) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.goto(`${base}ferramentas/og.html?modo=${modo}`)
  await p.waitForTimeout(1500)
  await p.screenshot({ path: pasta + arq })
  console.log('✓', arq)
}
await b.close()

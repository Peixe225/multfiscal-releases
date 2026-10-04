// Gera um arquivo HTML único (JS, CSS, fontes e favicon embutidos) para ver a prévia sem servidor.
// Uso: npm run arquivo-unico  →  entrega/greencheese-previa.html
import { build } from 'vite'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const raiz = new URL('..', import.meta.url).pathname
const tmp = join(raiz, 'node_modules', '.arquivo-unico')
await build({
  root: raiz,
  logLevel: 'warn',
  build: {
    outDir: tmp,
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rolldownOptions: { output: { inlineDynamicImports: true } },
  },
})
const assets = join(tmp, 'assets')
let html = readFileSync(join(tmp, 'index.html'), 'utf8')
const arquivos = readdirSync(assets)
const css = arquivos.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n')
// fontes: só woff2 latin/latin-ext (as outras ficam de fora para o arquivo não inchar)
const cssFontes = css.replace(/url\(\.?\/?(?:assets\/)?([^)]+?\.(woff2?|png|svg))\)/g, (m, nome) => {
  const f = nome.split('/').pop()
  if (!arquivos.includes(f)) return m
  if (/cyrillic/.test(f) || f.endsWith('.woff')) return 'url(data:,)'
  const tipo = f.endsWith('.woff2') ? 'font/woff2' : f.endsWith('.png') ? 'image/png' : 'image/svg+xml'
  return `url(data:${tipo};base64,${readFileSync(join(assets, f)).toString('base64')})`
})
const js = arquivos.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8'))
html = html
  .replace(/<link rel="stylesheet"[^>]*>/g, '')
  .replace(/<link rel="modulepreload"[^>]*>/g, '')
  .replace(/<script type="module"[^>]*><\/script>/, '')
  // função como substituto: o JS minificado tem "$`" e "$'", que o replace com texto interpretaria
  .replace('</head>', () => `<style>${cssFontes}</style></head>`)
  .replace('</body>', () => `<script type="module">${js.join('\n').replace(/<\/script/g, '<\\/script')}</script></body>`)
const fav = readFileSync(join(raiz, 'public', 'favicon.svg')).toString('base64')
html = html.replace(/href="\.\/favicon\.svg"/, () => `href="data:image/svg+xml;base64,${fav}"`).replace(/<link rel="apple-touch-icon"[^>]*>/, '').replace(/<link rel="manifest"[^>]*>/, '')
mkdirSync(join(raiz, 'entrega'), { recursive: true })
writeFileSync(join(raiz, 'entrega', 'greencheese-previa.html'), html)
console.log(`entrega/greencheese-previa.html — ${(html.length / 1024).toFixed(0)} KB`)

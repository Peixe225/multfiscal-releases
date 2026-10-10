#!/usr/bin/env node
/**
 * Build do site público: https://oprojeto.online/lenda/ (hospedagem compartilhada da Hostinger,
 * LiteSpeed com .htaccess no formato do Apache). O conteúdo de dist-site/ vai inteiro para
 * public_html/lenda/ — a pasta já funciona em qualquer subpasta (vite base './' + rotas com #).
 *
 * Este script:
 *   1. roda `vite build` em dist-site/ com VITE_SITE=1 (a live só com o simulador: a página pública nunca
 *      abre ws://localhost — ver LIVE_SANDBOXED em src/live/config.ts) e LENDA_SITE_URL (o plugin
 *      lenda:site-meta do vite.config.ts põe no index.html o canonical e o cartão Open Graph/Twitter);
 *   2. escreve o .htaccess da pasta (tipos, compressão, cache, sem listagem) e o de assets/ (cache de 1 ano);
 *   3. copia a imagem de compartilhamento (scripts/site/og.jpg, 1200×630 — refaça com
 *      `node scripts/site/render-og.mjs`) e gera o apple-touch-icon.png (180×180) a partir do favicon.svg;
 *   4. tira o carimbo .lenda-build (é da ponte, só faz sentido no dist/ local) e confere o resultado;
 *   5. imprime um resumo (arquivos, tamanho, os maiores).
 *
 * Sem `tsc` de propósito: a checagem de tipos é o `npm run typecheck`; aqui é só empacotar.
 *
 * Uso: npm run build:site
 *      LENDA_SITE_URL=https://outro.site/jogo/ npm run build:site   (outro endereço final)
 *      SITE_OUT=dist-site2 npm run build:site                        (outra pasta de saída)
 */
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = fileURLToPath(new URL('..', import.meta.url))
const outName = process.env.SITE_OUT || 'dist-site'
const out = join(root, outName)
// sempre com a barra final: é a PASTA do jogo (o og:image e o canonical são montados em cima dela)
const siteUrl = new URL(process.env.LENDA_SITE_URL || 'https://oprojeto.online/lenda/').href.replace(/\/?$/, '/')

const fail = (msg) => {
  console.error(`\n✗ build:site — ${msg}`)
  process.exit(1)
}

// ── 1. vite build ──
// as chaves dos outros builds saem do ambiente: um VITE_ARTIFACT esquecido no terminal faria um site com
// o texto do claude.ai, e o VITE_FLAG_PACK trocaria as bandeiras soltas pelo pacote
const env = { ...process.env, VITE_SITE: '1', LENDA_SITE_URL: siteUrl }
for (const k of ['VITE_ARTIFACT', 'LENDA_ARTIFACT', 'VITE_FLAG_PACK']) delete env[k]
execSync(`npx vite build --outDir ${outName} --emptyOutDir`, { cwd: root, stdio: 'inherit', env })

// ── 2. .htaccess ──
// Vale só para public_html/lenda/ e o que está dentro: o .htaccess do public_html continua mandando no
// resto do site, e nada daqui chega às pastas irmãs. Nenhuma RewriteRule/RewriteEngine de propósito (ver o
// cabeçalho do arquivo). Cada bloco dentro de <IfModule>: módulo ausente = bloco ignorado, nunca erro 500.
const TEXT_TYPES = 'text/html text/css text/javascript application/javascript application/json application/manifest+json image/svg+xml text/plain'
const htaccess = `# ─────────────────────────────────────────────────────────────────────────────────────────────
# LENDA · public_html/lenda/.htaccess — gerado por scripts/build-site.mjs (não edite aqui: rode
# "npm run build:site" de novo e suba a pasta dist-site/ inteira).
#
# Vale SÓ para esta pasta e as de dentro dela. O .htaccess do public_html segue valendo para o resto do
# site, e nada daqui vaza para ele nem para as pastas irmãs.
# De propósito, nenhuma RewriteRule nem RewriteEngine: o jogo usa rotas com # (#/carreira), então não há
# endereço para reescrever — e um "RewriteEngine" aqui desligaria, nesta pasta, as regras herdadas do
# .htaccess de cima (ex.: forçar https).
# Cada bloco está dentro de <IfModule>: sem o módulo, o bloco é ignorado (nunca vira erro 500).
# ─────────────────────────────────────────────────────────────────────────────────────────────

# Sem listagem de pastas: /lenda/photos/ não mostra a lista dos arquivos. O LiteSpeed nem sempre se
# apresenta como mod_autoindex, por isso o mesmo bloco de novo para ele.
<IfModule mod_autoindex.c>
  Options -Indexes
</IfModule>
<IfModule LiteSpeed>
  Options -Indexes
</IfModule>

# /lenda → /lenda/ (com a barra). O jogo carrega tudo por caminho relativo (./assets/…): sem a barra o
# navegador procuraria em /assets/ e a página ficaria em branco.
<IfModule mod_dir.c>
  DirectorySlash On
  DirectoryIndex index.html
</IfModule>

# Tipos certos. Módulo JavaScript só roda com tipo de JavaScript (o navegador recusa
# application/octet-stream), e servidores antigos não conhecem .webp, .woff2 nem .mjs.
<IfModule mod_mime.c>
  AddType text/javascript .js .mjs
  AddType text/css .css
  AddType application/json .json
  AddType application/manifest+json .webmanifest
  AddType image/svg+xml .svg
  AddType image/webp .webp
  AddType font/woff2 .woff2
  AddCharset utf-8 .html .js .mjs .css .json .svg .webmanifest
</IfModule>

# Compressão do que é texto (HTML, JS, CSS, JSON, SVG). Imagens .webp/.jpg/.png e fontes .woff2 já vêm
# comprimidas e ficam de fora.
# LiteSpeed (Hostinger): comprime sozinho, em gzip e brotli, os tipos de texto — os AddType acima garantem
# que cada arquivo caia num desses tipos, e nada aqui desliga a compressão dele.
# Apache: brotli quando o mod_brotli existe (vem antes: quem aceita br recebe br), senão gzip pelo
# mod_deflate. Um não comprime de novo o que o outro já comprimiu.
<IfModule mod_filter.c>
  <IfModule mod_brotli.c>
    AddOutputFilterByType BROTLI_COMPRESS ${TEXT_TYPES}
  </IfModule>
  <IfModule mod_deflate.c>
    AddOutputFilterByType DEFLATE ${TEXT_TYPES}
  </IfModule>
</IfModule>

# Cache.
#  · index.html: sempre pergunta ao servidor antes de usar a cópia guardada (no-cache; com ETag a resposta
#    é um 304 de poucos bytes). É ele que aponta para os arquivos do build novo depois de um deploy.
#  · imagens e fontes com nome fixo (escudos, fotos, troféus, bandeiras, ligas, og.jpg): 30 dias.
#  · assets/ (nome com hash, muda a cada build): 1 ano e immutable — no .htaccess de lá.
# As regras de cabeçalho vão em <FilesMatch>: assim valem mesmo se o .htaccess de cima tiver regras de
# cache por arquivo (as de <FilesMatch> são aplicadas por último, e as daqui depois das de lá).
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/html "access plus 0 seconds"
  ExpiresByType image/webp "access plus 30 days"
  ExpiresByType image/svg+xml "access plus 30 days"
  ExpiresByType image/png "access plus 30 days"
  ExpiresByType image/jpeg "access plus 30 days"
  ExpiresByType image/x-icon "access plus 30 days"
  ExpiresByType font/woff2 "access plus 30 days"
</IfModule>
<IfModule mod_headers.c>
  Header set X-Content-Type-Options "nosniff"
  <FilesMatch "\\.html?$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
  <FilesMatch "\\.(webp|png|jpe?g|svg|ico|woff2)$">
    Header set Cache-Control "public, max-age=2592000"
  </FilesMatch>
</IfModule>
`
// assets/ herda tipos e compressão da pasta de cima; aqui só o cache longo. O <FilesMatch> deste arquivo
// é aplicado depois do de cima (que daria 30 dias às fontes e imagens que também moram em assets/).
const ASSET_EXT = 'js|mjs|css|json|woff2|webp|png|jpe?g|svg|ico'
const htaccessAssets = `# LENDA · public_html/lenda/assets/.htaccess — gerado por scripts/build-site.mjs.
# Tudo aqui tem hash no nome (index-AbC123xy.js), que muda quando o arquivo muda: o navegador guarda por
# 1 ano e nem pergunta de novo (immutable). Tipos e compressão vêm do .htaccess da pasta de cima.
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresDefault "access plus 1 year"
${['text/javascript', 'application/javascript', 'text/css', 'application/json', 'font/woff2', 'image/webp', 'image/png', 'image/jpeg', 'image/svg+xml'].map((t) => `  ExpiresByType ${t} "access plus 1 year"`).join('\n')}
</IfModule>
<IfModule mod_headers.c>
  <FilesMatch "\\.(${ASSET_EXT})$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
</IfModule>
`
if (!existsSync(join(out, 'assets'))) fail('o vite build não gerou a pasta assets/')
writeFileSync(join(out, '.htaccess'), htaccess)
writeFileSync(join(out, 'assets', '.htaccess'), htaccessAssets)

// ── 3. imagem de compartilhamento + ícone da tela inicial ──
// og.jpg: composição feita com as artes do jogo (scripts/site/og.html), fotografada pelo Playwright em
// scripts/site/render-og.mjs. Fica pronta no repositório porque o Playwright não faz parte do projeto —
// assim o build do site roda em qualquer PC que tenha só o `npm install`.
const ogSrc = join(root, 'scripts', 'site', 'og.jpg')
if (!existsSync(ogSrc)) fail('falta scripts/site/og.jpg — gere com: node scripts/site/render-og.mjs')
const og = await sharp(ogSrc).metadata()
if (og.width !== 1200 || og.height !== 630) fail(`og.jpg com ${og.width}×${og.height} (precisa ser 1200×630)`)
if (statSync(ogSrc).size > 300 * 1024) fail(`og.jpg com ${Math.round(statSync(ogSrc).size / 1024)} KB (WhatsApp e afins recusam imagem grande: até 300 KB)`)
copyFileSync(ogSrc, join(out, 'og.jpg'))

// apple-touch-icon: o escudo do favicon num quadrado escuro (o iOS pinta de preto o que for transparente e
// arredonda os cantos sozinho) com um brilho dourado atrás, como no topo do jogo
const crest = await sharp(readFileSync(join(root, 'public', 'favicon.svg')), { density: 72 * (132 / 32) })
  .resize(132, 132)
  .png()
  .toBuffer()
const iconBg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180">
    <defs>
      <radialGradient id="glow" cx="50%" cy="44%" r="62%">
        <stop offset="0" stop-color="#3a2a0e"/>
        <stop offset=".55" stop-color="#14110c"/>
        <stop offset="1" stop-color="#07080c"/>
      </radialGradient>
    </defs>
    <rect width="180" height="180" fill="url(#glow)"/>
  </svg>`,
)
await sharp(iconBg)
  .composite([{ input: crest, top: 22, left: 24 }])
  .flatten({ background: '#07080c' })
  .png({ compressionLevel: 9 })
  .toFile(join(out, 'apple-touch-icon.png'))

// ── 4. limpeza e conferência ──
rmSync(join(out, '.lenda-build'), { force: true })
const html = readFileSync(join(out, 'index.html'), 'utf8')
for (const need of [`<link rel="canonical" href="${siteUrl}"`, `content="${siteUrl}og.jpg"`, 'twitter:card', 'apple-touch-icon']) {
  if (!html.includes(need)) fail(`index.html sem ${need} (o plugin lenda:site-meta do vite.config.ts rodou?)`)
}

// ── 5. resumo ──
const files = []
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    const st = statSync(p)
    if (st.isDirectory()) walk(p)
    else files.push({ path: relative(out, p).split('\\').join('/'), size: st.size })
  }
}
walk(out)
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`)
const total = files.reduce((s, f) => s + f.size, 0)
const byDir = {}
for (const f of files) {
  const top = f.path.includes('/') ? f.path.split('/')[0] + '/' : '(raiz)'
  byDir[top] = byDir[top] ?? { n: 0, size: 0 }
  byDir[top].n++
  byDir[top].size += f.size
}
console.log(`\n✓ site: ${files.length} arquivos · ${kb(total)} em ${outName}/ → suba o conteúdo para public_html/lenda/`)
console.log(`  endereço: ${siteUrl}`)
console.log('  por pasta:')
for (const [d, v] of Object.entries(byDir).sort((a, b) => b[1].size - a[1].size)) console.log(`    ${d.padEnd(12)} ${String(v.n).padStart(4)} arq.  ${kb(v.size).padStart(10)}`)
console.log('  maiores:')
for (const f of [...files].sort((a, b) => b.size - a.size).slice(0, 10)) console.log(`    ${kb(f.size).padStart(10)}  ${f.path}`)

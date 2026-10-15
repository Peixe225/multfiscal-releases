#!/usr/bin/env node
/**
 * Build do site público: https://oprojeto.online/lenda/ (hospedagem compartilhada da Hostinger,
 * LiteSpeed com .htaccess no formato do Apache). O conteúdo de dist-site/ vai inteiro para
 * public_html/lenda/ — a pasta já funciona em qualquer subpasta (vite base './' + rotas com #).
 *
 * Este script:
 *   1. roda `vite build` em dist-site/ com VITE_SITE=1 (a live só com o simulador: a página pública nunca
 *      abre ws://localhost — ver LIVE_SANDBOXED em src/live/config.ts), LENDA_SITE_URL (o plugin
 *      lenda:site-meta do vite.config.ts põe no index.html o canonical e o cartão Open Graph/Twitter) e
 *      VITE_CRESTS_V (hash dos atlas de escudos: eles vão para crests/<hash>/ — ver src/ui/primitives/crestAtlas.ts);
 *   2. escreve o .htaccess da pasta (tipos, compressão, cache, CSP própria, sem listagem) e o de assets/
 *      (cache de 1 ano);
 *   3. copia a imagem de compartilhamento (scripts/site/og.jpg, 1200×630 — refaça com
 *      `node scripts/site/render-og.mjs`) e gera o apple-touch-icon.png (180×180) a partir do favicon.svg;
 *   4. tira o carimbo .lenda-build (é da ponte, só faz sentido no dist/ local) e confere o resultado;
 *   5. imprime um resumo (arquivos, tamanho, os maiores).
 *   Antes do .htaccess, copia o servidor (servidor/CONTRATO.md), se já existir: servidor/api → api/ (sem
 *   _config.php nem testes), servidor/painel → painel/ e servidor/privacidade.html. Faltando, segue sem eles.
 *
 * Sem `tsc` de propósito: a checagem de tipos é o `npm run typecheck`; aqui é só empacotar.
 *
 * Uso: npm run build:site
 *      LENDA_SITE_URL=https://outro.site/jogo/ npm run build:site   (outro endereço final)
 *      SITE_OUT=dist-site2 npm run build:site                        (outra pasta de saída, relativa ao
 *                                                                     projeto ou absoluta)
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = fileURLToPath(new URL('..', import.meta.url))
// resolve (e não join): SITE_OUT=/tmp/x vale como absoluto, igual ao que o vite faria com o --outDir
const out = resolve(root, process.env.SITE_OUT || 'dist-site')
const outName = relative(root, out) || '.'
// sempre com a barra final: é a PASTA do jogo (o og:image e o canonical são montados em cima dela)
const siteUrl = new URL(process.env.LENDA_SITE_URL || 'https://oprojeto.online/lenda/').href.replace(/\/?$/, '/')

const fail = (msg) => {
  console.error(`\n✗ build:site — ${msg}`)
  process.exit(1)
}

// ── 1. vite build ──
// as chaves dos outros builds saem do ambiente: um VITE_ARTIFACT esquecido no terminal faria um site com
// o texto do claude.ai, e o VITE_FLAG_PACK trocaria as bandeiras soltas pelo pacote
//
// Versão dos escudos: os atlas (public/crests/<liga>.webp) têm nome fixo, mas a ordem dos escudos dentro
// deles segue a tabela do dia em que `npm run data` rodou, e o índice de cada clube fica no JS (com hash).
// Com o cache de 30 dias das imagens (e o CDN da Hostinger na frente), um atlas velho seria desenhado com os
// índices novos: escudo de outro clube, liga inteira, sem erro nenhum. Por isso eles vão para
// crests/<hash do conteúdo>/ — dado novo, pasta nova; dado igual, mesma pasta (o cache continua valendo).
// O jogo monta o caminho com o VITE_CRESTS_V (src/ui/primitives/crestAtlas.ts e src/data/index.ts).
const crestsSrc = join(root, 'public', 'crests')
const crestFiles = readdirSync(crestsSrc).filter((f) => f.endsWith('.webp')).sort()
if (!crestFiles.length) fail('public/crests/ sem nenhum atlas .webp (rode npm run data)')
const crestHash = createHash('sha256')
for (const f of crestFiles) crestHash.update(f).update('\0').update(readFileSync(join(crestsSrc, f))).update('\0')
const crestsV = crestHash.digest('hex').slice(0, 10)

const env = { ...process.env, VITE_SITE: '1', LENDA_SITE_URL: siteUrl, VITE_CRESTS_V: crestsV }
for (const k of ['VITE_ARTIFACT', 'LENDA_ARTIFACT', 'VITE_FLAG_PACK']) delete env[k]
// o vite pelo node, sem npx nem shell: a pasta de saída vai como argumento, então espaço ou acento no
// caminho não quebram o comando (e funciona igual no Windows)
const viteBin = (() => {
  const pkgPath = createRequire(import.meta.url).resolve('vite/package.json')
  const bin = JSON.parse(readFileSync(pkgPath, 'utf8')).bin
  return join(dirname(pkgPath), typeof bin === 'string' ? bin : bin.vite)
})()
execFileSync(process.execPath, [viteBin, 'build', '--outDir', out, '--emptyOutDir'], { cwd: root, stdio: 'inherit', env })
if (!existsSync(join(out, 'assets'))) fail('o vite build não gerou a pasta assets/')

// os atlas que o vite copiou de public/crests/ descem para crests/<versão>/
const crestsOut = join(out, 'crests')
const crestsTmp = join(out, `.crests-${crestsV}`)
renameSync(crestsOut, crestsTmp)
mkdirSync(crestsOut)
renameSync(crestsTmp, join(crestsOut, crestsV))

// ── 1b. servidor (medição + contas) ──
// PHP da API, painel e política de privacidade vão junto, na mesma pasta do jogo (o jogo chama ./api/*.php).
// Se o servidor ainda não existir (ou estiver pela metade), o build segue sem ele. Nunca vai: a config com
// senhas (_config.php, que mora fora do public_html), testes e anotações.
const servidor = join(root, 'servidor')
const NUNCA = (nome) => /^_config.*\.php$/i.test(nome) || /(^|[._-])(test|tests|teste|testes)([._-]|$)/i.test(nome) || /\.(md|log|bak|swp)$/i.test(nome) || nome === '.DS_Store' || nome === 'node_modules'
const copiados = []
const copiarPasta = (de, para) => {
  mkdirSync(para, { recursive: true })
  for (const nome of readdirSync(de)) {
    if (NUNCA(nome)) continue
    const a = join(de, nome)
    const b = join(para, nome)
    if (statSync(a).isDirectory()) copiarPasta(a, b)
    else {
      copyFileSync(a, b)
      copiados.push(relative(out, b).split('\\').join('/'))
    }
  }
}
for (const [de, para] of [
  ['api', 'api'],
  ['painel', 'painel'],
]) {
  const src = join(servidor, de)
  if (existsSync(src) && statSync(src).isDirectory()) copiarPasta(src, join(out, para))
}
if (existsSync(join(servidor, 'privacidade.html'))) {
  copyFileSync(join(servidor, 'privacidade.html'), join(out, 'privacidade.html'))
  copiados.push('privacidade.html')
}
if (copiados.some((f) => /(^|\/)_config/i.test(f))) fail('a config do servidor (_config*.php) não pode ir para o site')
// nomes.json do painel (clubes, países, troféus, prêmios e conquistas em pt-BR): refeito dos dados do jogo a cada build
// (scripts/painel-nomes.mjs), para o painel nunca mostrar um nome velho
if (existsSync(join(out, 'painel'))) {
  const { gerarNomesPainel } = await import('./painel-nomes.mjs')
  const n = await gerarNomesPainel({ saida: join(out, 'painel', 'nomes.json') })
  if (!copiados.includes('painel/nomes.json')) copiados.push('painel/nomes.json')
  console.log(`  painel/nomes.json: ${Object.entries(n).map(([k, v]) => `${v} ${k}`).join(', ')}`)
}

// ── 2. .htaccess ──
// Vale só para public_html/lenda/ e o que está dentro: o .htaccess do public_html continua mandando no
// resto do site, e nada daqui chega às pastas irmãs. Nenhuma RewriteRule/RewriteEngine de propósito (ver o
// cabeçalho do arquivo). Cada bloco dentro de <IfModule>: módulo ausente = bloco ignorado, nunca erro 500.
const TEXT_TYPES = 'text/html text/css text/javascript application/javascript application/json application/manifest+json image/svg+xml text/plain'

// CSP da pasta. O oprojeto.online manda uma CSP para o site inteiro (Header always, até nos 403) feita para
// a página principal: connect-src sem a ESPN, img-src sem os logos dela, child-src 'self' (nada de worker
// de blob:). Herdada aqui, ela quebraria o "Atualizar agora" das Ligas ao vivo e os logos dos times que não
// estão nos nossos dados. Então o index.html daqui sai com a NOSSA, com só o que o jogo usa:
//  · script-src: os arquivos daqui + o hash de cada <script> embutido no index.html (o de pré-pintura do tema),
//    calculado agora — sem 'unsafe-inline'. Se algo no caminho reescrever esse script (minificador de CDN),
//    ele é barrado e o tema só entra quando o app carrega (src/store/app.ts aplica de novo), sem quebrar nada;
//  · style-src 'unsafe-inline': os style="" do React/motion e o <style> do index.html;
//  · img-src: data: e blob: (o cartão de compartilhamento: html-to-image e o "Ver imagem") e os logos da ESPN;
//  · connect-src: a API de tabelas da ESPN (CORS aberto, pedido simples);
//  · o resto fica em 'self' (fontes, áudio, workers) ou fechado (object, base, form).
// Só nos .html: CSP só vale para documentos, e é onde a de cima estaria. "unset" tira a que veio por
// "Header set" e "always set" substitui a que veio por "Header always set" — com só um dos dois, o navegador
// recebe DUAS CSPs e aplica as duas (vale a mais fechada). Dentro de <FilesMatch> porque um <FilesMatch> do
// .htaccess de cima é aplicado depois das linhas soltas deste e venceria (testado no Apache 2.4).
// A MESMA CSP vale para as outras páginas .html da pasta (painel/, privacidade.html): elas só carregam
// arquivos próprios ('self'). Se alguma tiver <script> embutido, o hash dele entra também (senão seria
// barrado em silêncio) — e o aviso no fim lembra que o combinado é sem script embutido.
const html0 = readFileSync(join(out, 'index.html'), 'utf8')
const INLINE_RE = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi
const inlineScripts = [...html0.matchAll(INLINE_RE)].map((m) => m[1])
const outrasPaginas = copiados.filter((f) => /\.html?$/i.test(f))
const avisosCsp = []
for (const f of outrasPaginas) {
  const h = readFileSync(join(out, f), 'utf8')
  const embutidos = [...h.matchAll(INLINE_RE)].map((m) => m[1]).filter((c) => c.trim())
  if (embutidos.length) {
    avisosCsp.push(`${f}: ${embutidos.length} <script> embutido(s) — hash incluído na CSP`)
    inlineScripts.push(...embutidos)
  }
  for (const m of h.matchAll(/<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)=["'](https?:)?\/\/([^"'/]+)/gi)) {
    if (!/^(a\.espncdn\.com)$/i.test(m[2])) avisosCsp.push(`${f}: recurso externo de ${m[2]} (a CSP só deixa arquivos daqui)`)
  }
}
const scriptHashes = [...new Set(inlineScripts)].map((code) => `'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`)
const CSP = [
  "default-src 'self'",
  ['script-src', "'self'", ...scriptHashes].join(' '),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://a.espncdn.com",
  "font-src 'self'",
  "connect-src 'self' https://site.api.espn.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ')
if (CSP.includes('"')) fail('a CSP não pode ter aspas duplas (vai entre aspas no .htaccess)')
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
#  · imagens e fontes com nome fixo (fotos, troféus, bandeiras, ligas, og.jpg): 30 dias. Os escudos também,
#    mas numa pasta com o hash do conteúdo (crests/<hash>/): dado novo vem com pasta nova, e um atlas velho
#    guardado nunca é desenhado com os índices novos. As pastas antigas podem ser apagadas do servidor.
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
</IfModule>

# CSP desta pasta, no lugar da do site inteiro (a de cima não deixa o jogo falar com a ESPN nem mostrar os
# logos dela). "unset" + "always set": sobra UMA só, venha a de cima por "Header set" ou "Header always set".
# O hash em script-src é o do <script> embutido no index.html deste build (muda quando ele muda).
# Depois de subir, confira: curl -sI ${siteUrl} | grep -i content-security
# (tem que aparecer UMA linha, esta). Se aparecer a do site também, ela vem de fora do .htaccess (CDN ou
# painel): o jogo segue funcionando, só sem o "Atualizar agora" das Ligas ao vivo e os logos da ESPN.
<IfModule mod_headers.c>
  <FilesMatch "\\.html?$">
    Header unset Content-Security-Policy
    Header always set Content-Security-Policy "${CSP}"
  </FilesMatch>
</IfModule>

<IfModule mod_headers.c>
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
// o caminho versionado dos escudos tem que estar no JS (senão o jogo pediria crests/<liga>.webp, que não existe mais)
const crestsRef = `crests/${crestsV}/`
if (!readdirSync(join(out, 'assets')).some((f) => f.endsWith('.js') && readFileSync(join(out, 'assets', f), 'utf8').includes(crestsRef))) {
  fail(`nenhum JS do build monta ${crestsRef} (o VITE_CRESTS_V chegou em src/ui/primitives/crestAtlas.ts?)`)
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
console.log(`\n✓ site: ${files.length} arquivos · ${kb(total)} em ${outName.startsWith('..') ? out : outName}/ → suba o conteúdo para public_html/lenda/`)
console.log(`  endereço: ${siteUrl}`)
console.log(`  escudos: crests/${crestsV}/ · CSP: ${scriptHashes.length} script(s) embutido(s) com hash`)
const temApi = copiados.some((f) => f.startsWith('api/'))
console.log(
  `  servidor: ${copiados.length ? `${copiados.filter((f) => f.startsWith('api/')).length} arq. em api/ · ${copiados.filter((f) => f.startsWith('painel/')).length} em painel/ · privacidade.html ${copiados.includes('privacidade.html') ? 'sim' : 'não'}` : 'ainda não existe (servidor/) — o jogo funciona sem, só não mede nem tem conta'}`,
)
if (copiados.length && !temApi) console.log('  ⚠ servidor/api não encontrado: sem medição nem conta neste build')
for (const a of avisosCsp) console.log(`  ⚠ ${a}`)
console.log('  por pasta:')
for (const [d, v] of Object.entries(byDir).sort((a, b) => b[1].size - a[1].size)) console.log(`    ${d.padEnd(12)} ${String(v.n).padStart(4)} arq.  ${kb(v.size).padStart(10)}`)
console.log('  maiores:')
for (const f of [...files].sort((a, b) => b.size - a.size).slice(0, 10)) console.log(`    ${kb(f.size).padStart(10)}  ${f.path}`)

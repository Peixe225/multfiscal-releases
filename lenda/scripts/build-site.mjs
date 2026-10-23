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
 *   3c. (v3.5) o manifesto (manifest.webmanifest: nome curto "LENDA", ícones 192/512 e o maskable — o "Instalar app" do
 *      Android) e o favicon em PNG (favicon-32.png) e em ICO (favicon.ico) dentro da pasta: quem não usa o SVG ia buscar
 *      /favicon.ico na raiz do domínio, que é o ícone de outro site;
 *   3b. (v3.4) SEO: título e descrição para busca, JSON-LD de VideoGame, sitemap.xml e o arquivo da chave do IndexNow
 *      (scripts/indexnow.mjs avisa os buscadores depois do deploy);
 *   4. tira o carimbo .lenda-build (é da ponte, só faz sentido no dist/ local) e confere o resultado (v3.5: também a
 *      medição embutida no index.html, com o hash na CSP, e as pré-cargas da abertura — plugins lenda:medicao-cedo e
 *      lenda:precarga do vite.config.ts);
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

// ── 1c. os dados do jogo desta versão: dados/<DADOS_VERSAO>.json (CONTRATO-v33 §E) ──
// A verificação por replay (#/verificar, só o admin) refaz a carreira com a versão dos dados com que ela foi jogada
// (HallEntry.replay.dados). Cada build publica a sua com o nome da versão (src/data/versao.ts); o deploy só acrescenta —
// NUNCA apague a pasta dados/ do servidor —, então as versões dos deploys de antes continuam lá para as carreiras antigas.
// O jogo confere o hash do arquivo pelo próprio nome (FNV-1a, a mesma conta do DADOS_VERSAO) antes de usar.
{
  const versaoTs = readFileSync(join(root, 'src', 'data', 'versao.ts'), 'utf8')
  const versao = /DADOS_VERSAO\s*=\s*'([^']+)'/.exec(versaoTs)?.[1] ?? ''
  const txt = readFileSync(join(root, 'src', 'data', 'generated', 'game-data.json'), 'utf8')
  let h = 0x811c9dc5
  for (let i = 0; i < txt.length; i++) h = Math.imul(h ^ txt.charCodeAt(i), 0x01000193)
  const esperado = `${String(JSON.parse(txt).generatedAt ?? '').slice(0, 10)}.${(h >>> 0).toString(16).padStart(8, '0')}`
  if (!/^\d{4}-\d{2}-\d{2}\.[0-9a-f]{8}$/.test(versao) || versao !== esperado) {
    console.warn(`  ! dados/: o DADOS_VERSAO (${versao || 'sem valor'}) não é o do game-data.json (${esperado}); a versão não foi publicada`)
  } else {
    mkdirSync(join(out, 'dados'), { recursive: true })
    writeFileSync(join(out, 'dados', `${versao}.json`), txt)
    console.log(`  dados/${versao}.json (a verificação por replay das carreiras desta versão)`)
  }
}

// ── 1d. SEO (CONTRATO-v34 §B): título e descrição para busca, JSON-LD de VideoGame, sitemap.xml e a chave do IndexNow ──
// Só na pasta /lenda/ (nada fora dela: o robots.txt da raiz do domínio é de outro site e não é mexido). ATENÇÃO (CONTRATO-v34
// §E): hoje esse robots.txt tem `User-agent: *` + `Disallow: /` de propósito (domínio de trabalho), o que bloqueia /lenda/
// inteira — enquanto for assim, nada disto é indexado e o X não mostra o card da prévia; `node scripts/indexnow.mjs --conferir`
// avisa e diz o que pedir ao dono (`Allow: /lenda/` no grupo do `*`). O JSON-LD é um
// <script type="application/ld+json">: a CSP não se aplica a ele (o navegador não executa esse tipo), então ele NÃO entra
// nos hashes do script-src (ver INLINE_RE abaixo). O jogo usa rotas com # (#/hall…), que os buscadores não veem como
// páginas: o sitemap tem só as páginas de verdade da pasta (o jogo e a política de privacidade).
const SEO_TITULO = 'LENDA · Jogo de carreira de futebol online grátis'
const SEO_DESCRICAO =
  'Jogo de carreira de futebol online e grátis, em português: crie seu jogador, escolha clubes reais e conquiste Bolas de Ouro e Copas do Mundo dos 16 aos 40 anos.'
const SEO_OG_TITULO = 'LENDA — jogo de carreira de futebol online grátis'
const SEO_PALAVRAS =
  'jogo de carreira de futebol, jogo de futebol online grátis, simulador de carreira de futebol, jogo de futebol no navegador, modo carreira, Bola de Ouro, Copa do Mundo, Libertadores'
const { CHAVE_INDEXNOW, chaveIndexNow, arquivoDaChave } = await import('./indexnow.mjs')
const indexNowKey = chaveIndexNow()
{
  if (SEO_DESCRICAO.length > 160) fail(`a descrição de SEO tem ${SEO_DESCRICAO.length} caracteres (até 160: o Google corta o resto)`)
  const arq = join(out, 'index.html')
  let h = readFileSync(arq, 'utf8')
  const escAttr = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const trocar = (re, novo, nome) => {
    if (!re.test(h)) fail(`index.html sem ${nome} (o SEO não foi aplicado)`)
    h = h.replace(re, novo)
  }
  trocar(/<title>[^<]*<\/title>/, `<title>${escAttr(SEO_TITULO)}</title>`, '<title>')
  trocar(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${escAttr(SEO_DESCRICAO)}" />`, 'meta description')
  // o cartão de compartilhamento (plugin lenda:site-meta) fica com o mesmo texto da busca
  for (const [attr, k, v] of [
    ['property', 'og:title', SEO_OG_TITULO],
    ['property', 'og:description', SEO_DESCRICAO],
    ['name', 'twitter:title', SEO_OG_TITULO],
    ['name', 'twitter:description', SEO_DESCRICAO],
  ]) {
    trocar(new RegExp(`<meta ${attr}="${k}" content="[^"]*"\\s*/?>`), `<meta ${attr}="${k}" content="${escAttr(v)}">`, k)
  }
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: 'LENDA',
    alternateName: ['LENDA — Simulador de carreira de futebol', 'LENDA jogo de futebol'],
    description: SEO_DESCRICAO,
    url: siteUrl,
    image: new URL('og.jpg', siteUrl).href,
    inLanguage: 'pt-BR',
    genre: ['Futebol', 'Esporte', 'Simulação', 'Carreira'],
    keywords: SEO_PALAVRAS,
    gamePlatform: ['Navegador no computador', 'Navegador no celular'],
    applicationCategory: 'Game',
    operatingSystem: 'Qualquer sistema com um navegador atual',
    playMode: 'SinglePlayer',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'BRL', availability: 'https://schema.org/InStock', url: siteUrl },
  }
  // "<" escapado: nenhum texto do JSON fecha o <script> antes da hora
  const ldJson = JSON.stringify(ld).replace(/</g, '\\u003c')
  const cabeca = [
    `<meta name="keywords" content="${escAttr(SEO_PALAVRAS)}" />`,
    '<meta name="robots" content="index, follow, max-image-preview:large" />',
    `<script type="application/ld+json">${ldJson}</script>`,
  ].join('\n    ')
  if (!h.includes('</head>')) fail('index.html sem </head>')
  h = h.replace(/\s*<\/head>/, `\n    ${cabeca}\n  </head>`)
  // para quem lê sem JavaScript (alguns robôs de busca e de prévia): o que é o jogo, em texto. Quem tem JavaScript nunca vê.
  const noscript = `<noscript><main style="max-width:640px;margin:48px auto;padding:0 16px;font:16px/1.5 system-ui,sans-serif"><h1>LENDA — jogo de carreira de futebol online grátis</h1><p>${escAttr(SEO_DESCRICAO)}</p><p>Decida a carreira inteira: clube, empréstimo, transferência, seleção. Ganhe títulos, Bolas de Ouro, Libertadores e Copas do Mundo e compare sua lenda com Pelé, Messi e Cristiano Ronaldo no Hall das Lendas.</p><p>Para jogar, ative o JavaScript do navegador.</p></main></noscript>`
  h = h.replace(/<body>\s*/, `<body>\n    ${noscript}\n    `)
  writeFileSync(arq, h)
  // sitemap: só as páginas públicas de verdade desta pasta (o jogo e a política de privacidade)
  const hoje = new Date().toISOString().slice(0, 10)
  const paginas = [
    { loc: siteUrl, freq: 'weekly', prio: '1.0' },
    ...(existsSync(join(out, 'privacidade.html')) ? [{ loc: new URL('privacidade.html', siteUrl).href, freq: 'monthly', prio: '0.3' }] : []),
  ]
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paginas
    .map((p) => `  <url>\n    <loc>${p.loc.replace(/&/g, '&amp;')}</loc>\n    <lastmod>${hoje}</lastmod>\n    <changefreq>${p.freq}</changefreq>\n    <priority>${p.prio}</priority>\n  </url>`)
    .join('\n')}\n</urlset>\n`
  writeFileSync(join(out, 'sitemap.xml'), xml)
  // IndexNow: o arquivo da chave fica na pasta (o protocolo exige; a chave é pública). scripts/indexnow.mjs avisa os buscadores.
  writeFileSync(join(out, arquivoDaChave(indexNowKey)), indexNowKey)
  console.log(`  SEO: título, descrição, JSON-LD (VideoGame), sitemap.xml (${paginas.length} páginas) e ${arquivoDaChave(indexNowKey)} (IndexNow${indexNowKey === CHAVE_INDEXNOW ? '' : ', chave do LENDA_INDEXNOW_KEY'})`)
}

// ── 2. .htaccess ──
// Vale só para public_html/lenda/ e o que está dentro: o .htaccess do public_html continua mandando no
// resto do site, e nada daqui chega às pastas irmãs. Nenhuma RewriteRule/RewriteEngine de propósito (ver o
// cabeçalho do arquivo). Cada bloco dentro de <IfModule>: módulo ausente = bloco ignorado, nunca erro 500.
const TEXT_TYPES = 'text/html text/css text/javascript application/javascript application/json application/manifest+json image/svg+xml text/plain application/xml'

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
// sem os blocos de dados (application/ld+json, o JSON-LD do SEO): o navegador não os executa e a CSP não se aplica a eles
const INLINE_RE = /<script\b(?![^>]*\bsrc=)(?![^>]*\btype=["']?application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi
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
// Links curtos de divulgação (oprojeto.online/lenda/reddit, /insta, /blog/<nome>…): um 302 para o jogo com os
// utm_* já postos, que a medição grava como a origem da visita (painel → De onde vieram e Campanhas).
// Por mod_alias (RedirectMatch), não por RewriteRule: um RewriteEngine aqui desligaria as regras herdadas do
// .htaccess de cima (ver o cabeçalho). O nome depois da barra vira o utm_campaign (só letras, números, - e _).
const BASE_PATH = new URL(siteUrl).pathname
const LINKS_CURTOS = [
  ['reddit', 'reddit', 'social'],
  ['insta', 'instagram', 'social'],
  ['ig', 'instagram', 'social'],
  ['blog', 'blog', 'referral'],
  ['tiktok', 'tiktok', 'social'],
  ['yt', 'youtube', 'social'],
  ['zap', 'whatsapp', 'social'],
]
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const regrasLinks = LINKS_CURTOS.flatMap(([caminho, source, medium]) => {
  const de = `(?i)^${esc(BASE_PATH)}${caminho}`
  const para = `${BASE_PATH}?utm_source=${source}&utm_medium=${medium}`
  return [`  RedirectMatch 302 "${de}/?$" "${para}"`, `  RedirectMatch 302 "${de}/([A-Za-z0-9_-]{1,40})/?$" "${para}&utm_campaign=$1"`]
}).join('\n')
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

# Links curtos de divulgação: /lenda/reddit, /lenda/insta (ou /ig), /lenda/blog, /lenda/tiktok, /lenda/yt e
# /lenda/zap levam ao jogo com os utm_* da origem; com um nome depois (/lenda/blog/nome-do-blog,
# /lenda/reddit/futebol) o nome vira o utm_campaign. 302 (não 301): o navegador não guarda para sempre.
# O LiteSpeed nem sempre se apresenta como mod_alias, por isso o mesmo bloco de novo para ele.
<IfModule mod_alias.c>
${regrasLinks}
</IfModule>
<IfModule LiteSpeed>
${regrasLinks}
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
  AddType image/x-icon .ico
  AddType font/woff2 .woff2
  AddType application/xml .xml
  AddType text/plain .txt
  AddCharset utf-8 .html .js .mjs .css .json .svg .webmanifest .xml .txt
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

// ── 3c. (v3.5) manifesto + ícones do "Instalar app" + favicon em PNG/ICO ──
// O escudo do favicon.svg desenhado em cada tamanho (nada de reduzir o PNG grande: em 16/32 px o traço fica borrado).
const svgFavicon = readFileSync(join(root, 'public', 'favicon.svg'))
const escudo = (lado) => sharp(svgFavicon, { density: Math.max(72, Math.ceil((72 * lado) / 32)) }).resize(lado, lado).png().toBuffer()
// "any": o escudo num quadrado escuro com o brilho dourado (o mesmo desenho do apple-touch-icon, em 192 e 512)
const iconeQuadrado = async (lado, escala) => {
  const e = Math.round(lado * escala)
  const fundo = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}"><defs><radialGradient id="g" cx="50%" cy="44%" r="62%">` +
      `<stop offset="0" stop-color="#3a2a0e"/><stop offset=".55" stop-color="#14110c"/><stop offset="1" stop-color="#07080c"/></radialGradient></defs>` +
      `<rect width="${lado}" height="${lado}" fill="url(#g)"/></svg>`,
  )
  return sharp(fundo)
    .composite([{ input: await escudo(e), top: Math.round((lado - e) / 2 - lado * 0.01), left: Math.round((lado - e) / 2) }])
    .flatten({ background: '#07080c' })
    .png({ compressionLevel: 9 })
    .toBuffer()
}
const ICONES = [
  ['icon-192.png', await iconeQuadrado(192, 132 / 180)],
  ['icon-512.png', await iconeQuadrado(512, 132 / 180)],
  // maskable: o Android corta num círculo/gota — o escudo fica dentro da zona segura (o círculo de 80% do meio)
  ['icon-maskable-512.png', await iconeQuadrado(512, 0.52)],
  ['favicon-32.png', await escudo(32)],
]
for (const [nome, buf] of ICONES) writeFileSync(join(out, nome), buf)
// favicon.ico com PNG dentro (16, 32 e 48 px): o formato que todo navegador desde o IE11 entende
{
  const pngs = await Promise.all([16, 32, 48].map(async (l) => [l, await escudo(l)]))
  const cab = Buffer.alloc(6 + 16 * pngs.length)
  cab.writeUInt16LE(0, 0)
  cab.writeUInt16LE(1, 2)
  cab.writeUInt16LE(pngs.length, 4)
  let pos = cab.length
  pngs.forEach(([l, png], i) => {
    const o = 6 + 16 * i
    cab.writeUInt8(l, o)
    cab.writeUInt8(l, o + 1)
    cab.writeUInt8(0, o + 2)
    cab.writeUInt8(0, o + 3)
    cab.writeUInt16LE(1, o + 4)
    cab.writeUInt16LE(32, o + 6)
    cab.writeUInt32LE(png.length, o + 8)
    cab.writeUInt32LE(pos, o + 12)
    pos += png.length
  })
  writeFileSync(join(out, 'favicon.ico'), Buffer.concat([cab, ...pngs.map(([, png]) => png)]))
}
const manifesto = {
  id: './',
  name: 'LENDA — Simulador de carreira de futebol',
  short_name: 'LENDA',
  description: SEO_DESCRICAO,
  lang: 'pt-BR',
  dir: 'ltr',
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: '#07080c',
  theme_color: '#07080c',
  categories: ['games', 'sports', 'entertainment'],
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}
writeFileSync(join(out, 'manifest.webmanifest'), `${JSON.stringify(manifesto, null, 2)}\n`)

// ── 4. limpeza e conferência ──
rmSync(join(out, '.lenda-build'), { force: true })
const html = readFileSync(join(out, 'index.html'), 'utf8')
for (const need of [
  `<link rel="canonical" href="${siteUrl}"`,
  `content="${siteUrl}og.jpg"`,
  'twitter:card',
  'apple-touch-icon',
  '<link rel="manifest" href="./manifest.webmanifest">',
  'href="./favicon-32.png"',
  '<meta name="apple-mobile-web-app-title" content="LENDA">',
]) {
  if (!html.includes(need)) fail(`index.html sem ${need} (o plugin lenda:site-meta do vite.config.ts rodou?)`)
}
// v3.5: manifesto e ícones
{
  const m = JSON.parse(readFileSync(join(out, 'manifest.webmanifest'), 'utf8'))
  if (m.short_name !== 'LENDA' || m.display !== 'standalone' || m.start_url !== './') fail('manifest.webmanifest sem short_name/display/start_url')
  for (const i of m.icons) {
    const meta = await sharp(join(out, i.src)).metadata()
    if (`${meta.width}x${meta.height}` !== i.sizes) fail(`${i.src} com ${meta.width}×${meta.height} (o manifesto diz ${i.sizes})`)
  }
  const ico = readFileSync(join(out, 'favicon.ico'))
  if (ico.readUInt16LE(2) !== 1 || ico.readUInt16LE(4) !== 3) fail('favicon.ico inválido')
}
// v3.5: a medição de quem abre e sai logo (lenda:medicao-cedo) — embutida ANTES da folha de estilo e com o hash na CSP
{
  const i = html.indexOf('window.__lendaMedicao')
  const css = html.search(/<link rel="stylesheet"/)
  if (i < 0) fail('index.html sem a medição embutida (o plugin lenda:medicao-cedo do vite.config.ts rodou?)')
  if (css >= 0 && i > css) fail('a medição embutida ficou depois da folha de estilo (assim ela espera o CSS chegar)')
  // a folha de estilo do jogo no <head>, ANTES das que os pedaços acrescentam (fora dele, ela venceria o CSS da Home no desempate)
  if (css < 0 || css > html.indexOf('</head>')) fail('a folha de estilo do jogo não está no <head>')
  if (html.includes('<!--lenda:medicao-cedo-->')) fail('o marcador <!--lenda:medicao-cedo--> sobrou no index.html')
  if (scriptHashes.length !== new Set(inlineScripts).size || scriptHashes.length < 2) fail(`a CSP tem ${scriptHashes.length} hash(es) de script embutido (eram para ser o do tema e o da medição)`)
}
// v3.5: as pré-cargas da abertura (lenda:precarga): os pedaços data e LandingScreen e a fonte do título (Inter Tight)
{
  const pre = [...html.matchAll(/<link rel="modulepreload"[^>]*href="\.\/assets\/([^"]+)"/g)].map((m) => m[1])
  for (const nome of ['data-', 'LandingScreen-']) {
    if (!pre.some((f) => f.startsWith(nome))) fail(`index.html sem <link rel=modulepreload> do pedaço ${nome}* (a abertura volta a chegar em cascata)`)
  }
  for (const f of ['inter-tight-latin-wght-normal-']) {
    if (!new RegExp(`<link rel="preload" as="font" type="font/woff2" crossorigin href="\\./assets/${f}`).test(html)) fail(`index.html sem o preload da fonte ${f}*`)
  }
  // os ícones (lucide-react) num pedaço só: um pedaço pequeno com o desenho de um ícone ([["path",{d:…}]]) quer dizer que o
  // codeSplitting do vite.config.ts parou de valer (eram ~60 arquivos de 1,4 KB, um pedido de 150 ms cada no 4G)
  const soltos = readdirSync(join(out, 'assets')).filter(
    (f) => f.endsWith('.js') && statSync(join(out, 'assets', f)).size < 3000 && /\[\[[`"'](?:path|circle|rect|line|polyline|polygon|ellipse)[`"'],\{/.test(readFileSync(join(out, 'assets', f), 'utf8')),
  )
  if (soltos.length) fail(`${soltos.length} ícone(s) num pedaço próprio (${soltos.slice(0, 3).join(', ')}…): o grupo "icones" do codeSplitting no vite.config.ts não pegou`)
}
// SEO: o JSON-LD é JSON de verdade, o sitemap e a chave do IndexNow estão na pasta
{
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)
  let ld = null
  try {
    ld = m ? JSON.parse(m[1]) : null
  } catch {
    ld = null
  }
  if (!ld || ld['@type'] !== 'VideoGame') fail('index.html sem o JSON-LD de VideoGame (ou com JSON inválido)')
  if (!html.includes(`<title>${SEO_TITULO}</title>`)) fail('index.html sem o título de SEO')
  if (!existsSync(join(out, 'sitemap.xml')) || !readFileSync(join(out, 'sitemap.xml'), 'utf8').includes(`<loc>${siteUrl}</loc>`)) fail('sitemap.xml sem a página do jogo')
  if (readFileSync(join(out, arquivoDaChave(indexNowKey)), 'utf8') !== indexNowKey) fail('arquivo da chave do IndexNow com outro conteúdo')
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

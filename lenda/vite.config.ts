import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// Build publicado no claude.ai (scripts/build-artifact.mjs): a CSP do Artifact só aceita fontes do
// Google Fonts ou embutidas — arquivos .woff2 próprios são bloqueados em silêncio e o navegador cai
// numa fonte de sistema mais larga (texto cortado). Lá, as fontes vão dentro do CSS como data: URI.
const ARTIFACT = process.env.LENDA_ARTIFACT === '1'

// O minificador de CSS (lightningcss) funde `backdrop-filter` e `-webkit-backdrop-filter` e fica só com
// o ÚLTIMO da regra: escrito com o -webkit- por último, o Chrome perde o desfoque e todo "vidro" fica
// transparente (o texto de trás aparece através). Escreva sempre `-webkit-backdrop-filter` primeiro.
const backdropGuard = {
  name: 'lenda:backdrop-guard',
  apply: 'build' as const,
  generateBundle(this: { error(msg: string): never }, _: unknown, bundle: Record<string, { type: string; fileName: string; source?: unknown }>) {
    const bad: string[] = []
    for (const f of Object.values(bundle)) {
      if (f.type !== 'asset' || !f.fileName.endsWith('.css')) continue
      for (const m of String(f.source).matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
        if (/-webkit-backdrop-filter:/.test(m[2]) && !/(^|;)backdrop-filter:/.test(m[2])) bad.push(`${f.fileName}: ${m[1].trim().slice(-80)}`)
      }
    }
    if (bad.length) this.error(`-webkit-backdrop-filter sem backdrop-filter (ponha o -webkit- antes):\n${bad.join('\n')}`)
  },
}

// Site público (scripts/build-site.mjs → oprojeto.online/lenda/): com LENDA_SITE_URL definido, o index.html
// ganha o cartão de compartilhamento (Open Graph/Twitter — WhatsApp, Discord, X, Facebook) e o ícone da
// tela inicial do iPhone. As URLs do og:image e do canonical precisam ser ABSOLUTAS (os robôs de prévia não
// resolvem "./"), por isso dependem do endereço final; sem a variável (build normal, dev, Artifact) nada muda.
const SITE_URL = process.env.LENDA_SITE_URL?.trim()
const SITE_TITLE = 'LENDA — Simulador de carreira de futebol'
const SITE_DESCRIPTION =
  'Dos 16 aos 40 anos, cada escolha é sua: clubes e tabelas reais de hoje, títulos, Bolas de Ouro e Copas do Mundo. Escreva a carreira de uma lenda — direto no navegador.'
// descreve o scripts/site/og.jpg (refeito por scripts/site/render-og.mjs): mudou a imagem, mude aqui
const SITE_IMAGE_ALT = 'LENDA: "Construa sua carreira no futebol." Cartas de jogador do bronze à lenda, com a Copa do Mundo, a Bola de Ouro e a Libertadores.'

const siteMeta = {
  name: 'lenda:site-meta',
  apply: 'build' as const,
  transformIndexHtml() {
    if (!SITE_URL) return []
    // sempre com a barra final: é a pasta do jogo, e o Apache redireciona /lenda → /lenda/ de todo jeito
    const url = new URL(SITE_URL).href.replace(/\/?$/, '/')
    const image = new URL('og.jpg', url).href
    const meta = (attr: 'name' | 'property', key: string, content: string) => ({ tag: 'meta', attrs: { [attr]: key, content }, injectTo: 'head' as const })
    return [
      { tag: 'link', attrs: { rel: 'canonical', href: url }, injectTo: 'head' as const },
      { tag: 'link', attrs: { rel: 'apple-touch-icon', href: './apple-touch-icon.png' }, injectTo: 'head' as const },
      // v3.5: ícone em PNG para quem não usa o SVG (sem ele, o navegador ia buscar /favicon.ico na raiz do domínio, que é de
      // outro site), o manifesto (nome curto "LENDA", ícones 192/512 e o "Instalar app" do Android) e o nome na tela de início
      // do iPhone (sem ele, o título inteiro, cortado). Os arquivos são gerados pelo scripts/build-site.mjs.
      { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '32x32', href: './favicon-32.png' }, injectTo: 'head' as const },
      { tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest' }, injectTo: 'head' as const },
      meta('name', 'apple-mobile-web-app-title', 'LENDA'),
      meta('name', 'application-name', 'LENDA'),
      meta('property', 'og:type', 'website'),
      meta('property', 'og:site_name', 'LENDA'),
      meta('property', 'og:locale', 'pt_BR'),
      meta('property', 'og:url', url),
      meta('property', 'og:title', SITE_TITLE),
      meta('property', 'og:description', SITE_DESCRIPTION),
      meta('property', 'og:image', image),
      meta('property', 'og:image:type', 'image/jpeg'),
      meta('property', 'og:image:width', '1200'),
      meta('property', 'og:image:height', '630'),
      meta('property', 'og:image:alt', SITE_IMAGE_ALT),
      meta('name', 'twitter:card', 'summary_large_image'),
      meta('name', 'twitter:title', SITE_TITLE),
      meta('name', 'twitter:description', SITE_DESCRIPTION),
      meta('name', 'twitter:image', image),
      meta('name', 'twitter:image:alt', SITE_IMAGE_ALT),
    ]
  },
}

// ── v3.5: abertura no celular (4G lento) — só no build do site (VITE_SITE=1, scripts/build-site.mjs) ──
const SITE = process.env.VITE_SITE === '1'

/**
 * A visita contada antes de o jogo carregar: o src/site/medicaoCedo.ts (com o pedaço da medicao.ts que ele usa) vira um
 * <script> embutido no lugar do <!--lenda:medicao-cedo--> do index.html — ANTES da folha de estilo, porque um <script>
 * comum depois de um <link rel=stylesheet> espera o CSS chegar. O build-site.mjs põe o hash dele na CSP. Fora do site
 * (Artifact, ponte, dev) o marcador só some.
 */
const MARCA_MEDICAO = '<!--lenda:medicao-cedo-->'
const medicaoCedo = {
  name: 'lenda:medicao-cedo',
  apply: 'build' as const,
  transformIndexHtml: {
    order: 'pre' as const,
    async handler(html: string) {
      if (!html.includes(MARCA_MEDICAO)) {
        if (SITE) throw new Error(`index.html sem o marcador ${MARCA_MEDICAO} (a medição de quem abre e sai logo)`)
        return html
      }
      if (!SITE) return html.replace(MARCA_MEDICAO, '')
      const { build } = await import('rolldown')
      const r = await build({
        input: fileURLToPath(new URL('./src/site/medicaoCedo.ts', import.meta.url)),
        write: false,
        platform: 'browser',
        treeshake: true,
        // o import.meta.env do api.ts (que a medicao.ts importa) nem entra: o tree-shaking tira o apiUrl
        transform: { target: 'safari15', define: { 'import.meta.env.BASE_URL': '"./"' } },
        output: { format: 'iife', minify: true, codeSplitting: false },
      })
      const code = r.output.map((o) => (o.type === 'chunk' ? o.code : '')).join('\n').trim()
      if (!code) throw new Error('lenda:medicao-cedo: o rolldown não gerou o script')
      if (/import\.meta|\bimport\(|<\/script/i.test(code)) throw new Error('lenda:medicao-cedo: o script embutido tem import ou </script>')
      if (code.length > 12_000) throw new Error(`lenda:medicao-cedo: script embutido com ${code.length} bytes (era para ter ~3 KB)`)
      return html.replace(MARCA_MEDICAO, `<script>${code}</script>`)
    },
  },
}

/**
 * Pré-carga do que a 1ª tela precisa (medido no 4G lento + CPU 4×, HTTP/2 com brotli como a Hostinger): sem isto a Home
 * (LandingScreen e o que ela importa) só era pedida depois de o index chegar e rodar, e as fontes só depois de o CSS
 * chegar e a tela desenhar — o texto trocava de fonte já com a Home na tela (CLS 0,15). Aqui o index.html já pede tudo
 * de uma vez: <link rel=modulepreload> dos pedaços (e de tudo o que eles importam), <link rel=preload as=style> do CSS
 * deles e <link rel=preload as=font> da fonte do título (CLS 0,008). Os pedaços são achados pelo módulo de entrada
 * deles (se um sumir, o build avisa). O game-data (137 KB) fica de fora de propósito: a Home não espera por ele, e pedido
 * junto ele dividia a banda com o index e atrasava o botão em ~0,7 s; um pedaço grande que entrar aqui vai com
 * fetchpriority=low.
 */
const PRECARGA_PEDACOS: [string, RegExp][] = [
  ['data', /[\\/]src[\\/]data[\\/]index\.ts$/],
  ['LandingScreen', /[\\/]src[\\/]ui[\\/]shared[\\/]landing[\\/]LandingScreen\.tsx$/],
]
// só a do título grande (Inter Tight): é ela que empurrava a Home ao trocar (CLS 0,15 → 0,008). Com a Inter do texto junto
// (mais 47 KB disputando a banda com o index) o botão saía ~0,25 s depois, para tirar só o resto (0,008 → 0)
const PRECARGA_FONTES = [/^inter-tight-latin-wght-normal-[\w-]+\.woff2$/]
const PRECARGA_GRANDE = 60 * 1024

type PedacoSaida = { type: 'chunk'; fileName: string; facadeModuleId: string | null; imports: string[]; code: string; viteMetadata?: { importedCss?: Set<string> } }
type ArquivoSaida = PedacoSaida | { type: 'asset'; fileName: string }

function tagsDePrecarga(html: string, bundle: Record<string, ArquivoSaida>, avisar: (m: string) => void = () => {}) {
  const pedacos = new Map<string, PedacoSaida>()
  for (const f of Object.values(bundle)) if (f.type === 'chunk') pedacos.set(f.fileName, f)
  const ja = new Set([...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((m) => m[1]))
  const js: PedacoSaida[] = []
  const css: string[] = []
  const visitar = (c: PedacoSaida | undefined) => {
    if (!c || ja.has(c.fileName)) return
    ja.add(c.fileName)
    for (const i of c.imports) visitar(pedacos.get(i))
    js.push(c)
    for (const f of c.viteMetadata?.importedCss ?? []) if (!ja.has(f)) (ja.add(f), css.push(f))
  }
  for (const [nome, re] of PRECARGA_PEDACOS) {
    const c = [...pedacos.values()].find((p) => p.facadeModuleId && re.test(p.facadeModuleId))
    if (c) visitar(c)
    else avisar(`lenda:precarga: o pedaço "${nome}" não existe mais (a abertura volta a chegar em cascata)`)
  }
  const fontes = Object.values(bundle)
    .filter((f) => f.type === 'asset' && PRECARGA_FONTES.some((re) => re.test(f.fileName.split('/').pop() ?? '')))
    .map((f) => f.fileName)
  if (fontes.length !== PRECARGA_FONTES.length) avisar(`lenda:precarga: achei ${fontes.length} de ${PRECARGA_FONTES.length} fonte(s) do 1º desenho`)
  const tag = (attrs: Record<string, string | boolean>) => ({ tag: 'link', attrs, injectTo: 'head' as const })
  return [
    ...fontes.map((f) => tag({ rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: true, href: `./${f}` })),
    ...css.map((f) => tag({ rel: 'preload', as: 'style', crossorigin: true, href: `./${f}` })),
    ...js.map((c) =>
      tag({ rel: 'modulepreload', crossorigin: true, href: `./${c.fileName}`, ...(c.code.length > PRECARGA_GRANDE ? { fetchpriority: 'low' } : {}) }),
    ),
  ]
}

const precarga = {
  name: 'lenda:precarga',
  apply: 'build' as const,
  transformIndexHtml: {
    order: 'post' as const,
    handler(html: string, ctx: { bundle?: Record<string, ArquivoSaida> }) {
      if (!SITE || !ctx.bundle) return []
      // a folha de estilo do jogo fica onde o Vite pôs (no <head>, antes das que os pedaços acrescentam depois): no fim do
      // <body> ela pintaria a marca antes, mas passaria a vencer o CSS da Home no desempate (testado: a Home perde o estilo)
      return tagsDePrecarga(html, ctx.bundle, (m) => console.warn(`\n  ⚠ ${m}`))
    },
  },
}

/**
 * v3.5 · Safari < 16.2 (iOS 15 e 16.0–16.1) não tem color-mix(). Uma declaração com color-mix() E var() não é conferida
 * na leitura (por causa do var()): ela vence a declaração de reserva escrita antes dela e só falha depois, já calculada —
 * e aí a propriedade volta ao valor inicial (o emblema sem fundo, a borda sem cor). Este plugin do PostCSS tira cada
 * declaração assim da regra e a põe numa cópia da regra logo depois, dentro de @supports (color: color-mix(...)): quem
 * tem color-mix() vê o mesmo de antes; quem não tem fica com a reserva (ou com o que a cascata já dava). Ficam de fora as
 * variáveis (--x: …), o que já está dentro de um @supports de color-mix e os @keyframes.
 */
type NoCss = { type: string; name?: string; params?: string; parent?: NoCss; prop?: string; value?: string; clone(o?: object): NoCss; append(n: NoCss): NoCss; after(n: NoCss): NoCss; remove(): void; next?(): NoCss | undefined }
const SUPORTA_COLOR_MIX = '(color: color-mix(in srgb, red 50%, blue))'
const colorMixComReserva = {
  postcssPlugin: 'lenda:color-mix-com-reserva',
  Declaration(decl: NoCss, { AtRule }: { AtRule: new (o: { name: string; params: string }) => NoCss }) {
    const v = decl.value ?? ''
    if (!/color-mix\(/i.test(v) || !/var\(/i.test(v) || decl.prop?.startsWith('--')) return
    const regra = decl.parent
    if (!regra || regra.type !== 'rule') return
    for (let p = regra.parent; p; p = p.parent) {
      if (p.type === 'atrule' && (/keyframes$/i.test(p.name ?? '') || (p.name === 'supports' && /color-mix/i.test(p.params ?? '')))) return
    }
    // a cópia da regra (no mesmo @media/@layer) logo depois dela, com as declarações de color-mix seguidas que já foram para lá
    let bloco = regra.next?.()
    const ehNosso = (n: NoCss | undefined) => !!n && n.type === 'atrule' && n.name === 'supports' && n.params === SUPORTA_COLOR_MIX && (n as unknown as { __lenda?: NoCss }).__lenda === regra
    if (!ehNosso(bloco)) {
      bloco = new AtRule({ name: 'supports', params: SUPORTA_COLOR_MIX })
      ;(bloco as unknown as { __lenda?: NoCss }).__lenda = regra
      bloco.append(regra.clone({ nodes: [] }))
      regra.after(bloco)
    }
    const copia = (bloco as unknown as { first: NoCss }).first
    copia.append(decl.clone())
    decl.remove()
  },
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), backdropGuard, siteMeta, medicaoCedo, precarga],
  css: { postcss: { plugins: [colorMixComReserva] } },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    // v3.5: e o Safari 15 (iPhone com iOS 15): o que for sintaxe nova demais para ele é reescrito (as APIs que faltam
    // estão em src/polyfills.ts)
    target: ['es2022', 'safari15'],
    chunkSizeWarningLimit: 4000,
    ...(ARTIFACT ? { assetsInlineLimit: (file: string) => (/\.woff2$/.test(file) ? true : undefined) } : {}),
    rolldownOptions: {
      output: {
        // v3.5: os ícones (lucide-react) num pedaço só — antes saíam ~60 arquivos de 1,4 KB, um pedido (150 ms no 4G) cada
        codeSplitting: {
          groups: [{ name: 'icones', test: /[\\/]node_modules[\\/]lucide-react[\\/]/, includeDependenciesRecursively: false }],
        },
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as any)

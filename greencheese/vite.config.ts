import { defineConfig, runnerImport, type Plugin, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import { config } from './src/dados/config'

/** O desenho do pôster (src/componentes/rua/poster.ts), carregado só quando o pôster é pedido. */
type DesenhoDoPoster = typeof import('./src/componentes/rua/poster')
type Poster = Awaited<ReturnType<DesenhoDoPoster['pintarPosteres']>>['emPe']

declare const process: { env: Record<string, string | undefined> }

// API de desenvolvimento (npm run api: php -S na GC_API_PORTA, padrão 8090). O Vite repassa /api e /uploads pra ela,
// no dev e no preview. Com o PHP desligado o site abre igual: a API responde 503 em JSON e o site segue "sem servidor".
const alvoApi = `http://127.0.0.1:${process.env.GC_API_PORTA ?? '8090'}`

/** O pedaço do proxy (EventEmitter) que interessa aqui; os tipos do Node não estão no projeto. */
type Emissor = { emit: (evento: string, ...args: unknown[]) => boolean; on: (evento: string, f: () => void) => unknown }
type Resposta = { headersSent?: boolean; writeHead?: (s: number, h: Record<string, string>) => { end: (b: string) => void } }

function repasse(): ProxyOptions {
  let avisou = false
  return {
    target: alvoApi,
    // sem changeOrigin: o Host fica o do site, e a conferência de Origin da API bate
    configure(proxy) {
      // o erro de conexão vira um 503 calmo (e um aviso só) em vez do erro vermelho do Vite a cada pedido
      const p = proxy as unknown as Emissor
      const emitir = p.emit.bind(p)
      p.emit = (evento, ...args) => {
        if (evento !== 'error') return emitir(evento, ...args)
        const res = args[2] as Resposta | undefined
        if (!avisou) {
          avisou = true
          console.warn(`[api] sem resposta em ${alvoApi}: o site segue sem servidor (npm run api liga)`)
        }
        if (res?.writeHead && !res.headersSent) {
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
            .end(JSON.stringify({ ok: false, erro: 'sem-servidor', mensagem: 'Servidor desligado.' }))
        }
        return true
      }
      p.on('proxyRes', () => {
        avisou = false
      })
    },
  }
}
const proxyApi = { '/api/': repasse(), '/uploads/': repasse() }

// Liga o noindex e ajusta título/descrição a partir de src/dados/config.ts.
function htmlDaConfig(): Plugin {
  return {
    name: 'html-da-config',
    transformIndexHtml(html) {
      const robots = !config.indexar ? '<meta name="robots" content="noindex, nofollow" />' : ''
      return html.replace('<!--robots-->', robots).replaceAll('%URL_PUBLICA%', config.urlPublica)
    },
  }
}

/**
 * O pôster da rua (o primeiro story do celular): o quadro 0 da rua, desenhado aqui com o mesmo motor e o mesmo elenco
 * da página (src/componentes/rua/poster.ts) e posto no pedaço principal como PNG de paleta, 1 px por pixel da arte
 * (uns poucos KB). O story mostra ele na hora; a animação assume quando o worker devolve os quadros. O motor (pelo
 * executor de módulos do Vite) e o sharp só carregam quando o pôster é pedido (build e dev): o preview e o resto da
 * config não dependem deles.
 */
function posterDaRua(): Plugin {
  const ids = { 'virtual:rua-poster': 'emPe', 'virtual:rua-poster-faixa': 'faixa' } as const
  let prontos: Promise<Record<'emPe' | 'faixa', string>> | null = null
  let raiz = ''
  const gerar = async () => {
    const [{ default: sharp }, { module: desenho }] = await Promise.all([
      import('sharp'),
      runnerImport<DesenhoDoPoster>('/src/componentes/rua/poster.ts', { root: raiz, logLevel: 'error' }),
    ])
    const png = async (p: Poster) => {
      const b = await sharp(p.rgba, { raw: { width: p.w, height: p.h, channels: 4 } })
        .png({ palette: true, colors: 256, dither: 0, compressionLevel: 9, effort: 10 })
        .toBuffer()
      return `data:image/png;base64,${b.toString('base64')}`
    }
    const p = await desenho.pintarPosteres()
    return { emPe: await png(p.emPe), faixa: await png(p.faixa) }
  }
  return {
    name: 'poster-da-rua',
    configResolved: (c) => {
      raiz = c.root
    },
    resolveId: (s) => (s in ids ? `\0${s}` : null),
    async load(s) {
      const id = s.startsWith('\0') ? (s.slice(1) as keyof typeof ids) : null
      if (!id || !(id in ids)) return null
      prontos ??= gerar()
      const p = await prontos
      return ids[id] === 'emPe' ? `export const posterEmPe = ${JSON.stringify(p.emPe)}` : `export const posterFaixa = ${JSON.stringify(p.faixa)}`
    },
  }
}

// Painel do dono (painel/index.html): build à parte, logo depois do site e na mesma pasta de saída. Num build só, o
// Vite repartiria o React entre as duas páginas e o site ganharia pedaços e pedidos novos; assim o site sai igual,
// byte a byte, e o painel leva o dele (o CSS do painel vai inline, em src/painel/estilo.ts). No dev, o Vite já serve
// /painel/ sozinho.
// __ARQUIVO_UNICO__: só o arquivo único da prévia (scripts/arquivo-unico.mjs) liga; aí o rateio sabe que não há servidor.
const definir = { __BUILD_TIME__: JSON.stringify(new Date().toISOString()), __ARQUIVO_UNICO__: 'false' }
const alvo = 'es2020'
function painelAParte(): Plugin {
  let raiz = ''
  let saida = ''
  let pular = false
  return {
    name: 'painel-a-parte',
    apply: 'build',
    configResolved(c) {
      raiz = c.root
      saida = c.build.outDir
      // o arquivo único da prévia (scripts/arquivo-unico.mjs: tudo num pedaço só) não leva o painel
      const saidas = c.build.rolldownOptions?.output
      pular = [saidas].flat().some((o) => !!o && typeof o === 'object' && 'inlineDynamicImports' in o && !!o.inlineDynamicImports)
    },
    async closeBundle() {
      if (pular) return
      const { build } = await import('vite')
      // configFile false: o build do painel não lê este arquivo de novo (nem roda este plugin outra vez)
      await build({
        configFile: false,
        root: raiz,
        base: './',
        publicDir: false,
        logLevel: 'warn',
        plugins: [react()],
        define: definir,
        build: {
          outDir: saida,
          emptyOutDir: false,
          target: alvo,
          assetsInlineLimit: 2048,
          rolldownOptions: { input: { painel: `${raiz}/painel/index.html` } },
        },
      })
    },
  }
}

export default defineConfig({
  // Caminhos relativos: o dist/ sobe em qualquer pasta ou subdomínio da Hostinger.
  base: './',
  plugins: [react(), htmlDaConfig(), posterDaRua(), painelAParte()],
  // Hora do build: vira o "há 2 h" do cabeçalho do story quando config.catalogoAtualizadoEm está vazio.
  define: definir,
  build: {
    target: alvo,
    assetsInlineLimit: 2048,
    cssCodeSplit: false,
  },
  server: { port: 5173, proxy: proxyApi },
  preview: { proxy: proxyApi },
})

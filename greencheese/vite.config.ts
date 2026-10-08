import { defineConfig, type Plugin, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import { config } from './src/dados/config'

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

export default defineConfig({
  // Caminhos relativos: o dist/ sobe em qualquer pasta ou subdomínio da Hostinger.
  base: './',
  plugins: [react(), htmlDaConfig()],
  // Hora do build: vira o "há 2 h" do cabeçalho do story quando config.catalogoAtualizadoEm está vazio.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  build: {
    target: 'es2020',
    assetsInlineLimit: 2048,
    cssCodeSplit: false,
  },
  server: { port: 5173, proxy: proxyApi },
  preview: { proxy: proxyApi },
})

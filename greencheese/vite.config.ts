import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import sharp from 'sharp'
import { config } from './src/dados/config'
import { montar } from './src/componentes/rua/montar'
import { PEDIDO } from './src/componentes/rua/pacote'
import { pintarPoster, type Poster } from './src/componentes/rua/poster'

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
 * (uns poucos KB). O story mostra ele na hora; a animação assume quando o worker devolve os quadros.
 */
function posterDaRua(): Plugin {
  const ids = { 'virtual:rua-poster': 'emPe', 'virtual:rua-poster-faixa': 'faixa' } as const
  let prontos: Promise<Record<'emPe' | 'faixa', string>> | null = null
  const png = async (p: Poster) => {
    const b = await sharp(p.rgba, { raw: { width: p.w, height: p.h, channels: 4 } })
      .png({ palette: true, colors: 256, dither: 0, compressionLevel: 9, effort: 10 })
      .toBuffer()
    return `data:image/png;base64,${b.toString('base64')}`
  }
  const gerar = async () => {
    const bruto = await montar(PEDIDO)
    return { emPe: await png(pintarPoster(bruto, 'emPe')), faixa: await png(pintarPoster(bruto, 'faixa')) }
  }
  return {
    name: 'poster-da-rua',
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

export default defineConfig({
  // Caminhos relativos: o dist/ sobe em qualquer pasta ou subdomínio da Hostinger.
  base: './',
  plugins: [react(), htmlDaConfig(), posterDaRua()],
  // Hora do build: vira o "há 2 h" do cabeçalho do story quando config.catalogoAtualizadoEm está vazio.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()), __ARQUIVO_UNICO__: 'false' },
  build: {
    target: 'es2020',
    assetsInlineLimit: 2048,
    cssCodeSplit: false,
  },
  server: { port: 5173 },
})

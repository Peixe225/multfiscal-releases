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

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), backdropGuard, siteMeta],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    ...(ARTIFACT ? { assetsInlineLimit: (file: string) => (/\.woff2$/.test(file) ? true : undefined) } : {}),
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as any)

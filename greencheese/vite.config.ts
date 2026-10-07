import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { config } from './src/dados/config'

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
  server: { port: 5173 },
})

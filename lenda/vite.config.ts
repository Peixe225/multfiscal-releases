import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// Build publicado no claude.ai (scripts/build-artifact.mjs): a CSP do Artifact só aceita fontes do
// Google Fonts ou embutidas — arquivos .woff2 próprios são bloqueados em silêncio e o navegador cai
// numa fonte de sistema mais larga (texto cortado). Lá, as fontes vão dentro do CSS como data: URI.
const ARTIFACT = process.env.LENDA_ARTIFACT === '1'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    ...(ARTIFACT ? { assetsInlineLimit: (file: string) => (/\.woff2$/.test(file) ? true : undefined) } : {}),
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as any)

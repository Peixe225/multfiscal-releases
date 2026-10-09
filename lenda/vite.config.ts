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

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), backdropGuard],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    ...(ARTIFACT ? { assetsInlineLimit: (file: string) => (/\.woff2$/.test(file) ? true : undefined) } : {}),
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as any)

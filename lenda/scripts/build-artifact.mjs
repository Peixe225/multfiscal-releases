#!/usr/bin/env node
/**
 * Build para publicar o jogo como Artifact no claude.ai.
 *
 * O claude.ai aceita no máximo ~511 arquivos por versão e embrulha a página num esqueleto
 * próprio (sem <html>/<head>/<body> no arquivo publicado). Este script:
 *   1. roda `vite build` com VITE_FLAG_PACK=1 e LENDA_ARTIFACT=1 em dist-artifact/ (fontes embutidas no
 *      CSS: a CSP do Artifact bloqueia .woff2 próprios);
 *   2. junta as 211 bandeiras em um único flags/pack.json e apaga flags/4x3/;
 *   3. escreve dist-artifact/_page.html (só o conteúdo da página) e _batches.json
 *      (lotes de até 250 arquivos para publicar).
 *
 * Uso: node scripts/build-artifact.mjs
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = join(root, 'dist-artifact')

execSync('npx vite build --outDir dist-artifact --emptyOutDir', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, VITE_FLAG_PACK: '1', LENDA_ARTIFACT: '1' },
})

// 2. pacote de bandeiras
const flagsDir = join(out, 'flags', '4x3')
const pack = {}
for (const f of readdirSync(flagsDir)) if (f.endsWith('.svg')) pack[f.slice(0, -4)] = readFileSync(join(flagsDir, f), 'utf8')
rmSync(join(out, 'flags', '4x3'), { recursive: true, force: true })
mkdirSync(join(out, 'flags'), { recursive: true })
writeFileSync(join(out, 'flags', 'pack.json'), JSON.stringify(pack))

// 3. página sem esqueleto
const html = readFileSync(join(out, 'index.html'), 'utf8')
const head = (html.match(/<head>([\s\S]*)<\/head>/) ?? [])[1] ?? ''
const body = (html.match(/<body>([\s\S]*)<\/body>/) ?? [])[1] ?? ''
const title = (head.match(/<title>[\s\S]*?<\/title>/) ?? [''])[0]
const cleanHead = head
  .replace(title, '')
  .replace(/\s*<meta charset="[^"]*"\s*\/?>/i, '')
  .replace(/\s*<meta name="viewport"[^>]*>/i, '')
  .trim()
const boot =
  '<script>try{document.documentElement.setAttribute("data-lx-theme","noite");document.documentElement.lang="pt-BR"}catch(e){}</script>'
writeFileSync(join(out, '_page.html'), `${title}\n${boot}\n${cleanHead}\n${body.trim()}\n`)

// lotes
const files = []
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) walk(p)
    else files.push(relative(out, p).split('\\').join('/'))
  }
}
walk(out)
const publish = files.filter((p) => p !== 'index.html' && !p.startsWith('_')).sort()
const batches = []
for (let i = 0; i < publish.length; i += 250) batches.push(publish.slice(i, i + 250))
writeFileSync(join(out, '_batches.json'), JSON.stringify(batches))
console.log(`artifact: ${publish.length} arquivos em ${batches.length} lote(s) · página ${join(out, '_page.html')}`)
if (!existsSync(join(out, 'flags', 'pack.json'))) process.exit(1)
if (publish.some((p) => p.endsWith('.woff2'))) {
  console.error('fontes .woff2 soltas no build: a CSP do Artifact vai bloqueá-las')
  process.exit(1)
}

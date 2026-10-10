// Gera public/api/nucleo/textos-pedido.json a partir de src/dados/textos-pedido.ts: a lista de falas do pedido guiado
// (chave, texto de sempre, tipo e marcadores) e o tamanho máximo de cada tipo, que o servidor confere quando o dono troca
// uma fala no painel. Também confere as falas de sempre (só os marcadores declarados, no tamanho, sem chave sobrando,
// sem tabaco e sem promessa de prazo ou frete: as mesmas regras do servidor) e que a lista de promessas do site
// (PROMESSAS, que o painel usa enquanto o dono digita) é a mesma do servidor (GC_TERMOS_PROMESSA).
// Uso: node scripts/gerar-textos-pedido.mjs              → (re)grava o JSON
//      node scripts/gerar-textos-pedido.mjs --conferir   → só confere que o JSON está em dia (sai 1 se não estiver)
import { rolldown } from 'rolldown'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const raiz = new URL('../', import.meta.url).pathname
const destino = join(raiz, 'public/api/nucleo/textos-pedido.json')

async function carregar(arquivo) {
  const tmp = mkdtempSync(join(tmpdir(), 'gc-textos-'))
  const saida = join(tmp, 'm.mjs')
  const pacote = await rolldown({ input: join(raiz, arquivo), logLevel: 'silent' })
  await pacote.write({ file: saida, format: 'esm' })
  await pacote.close()
  const m = await import(pathToFileURL(saida).href)
  rmSync(tmp, { recursive: true, force: true })
  return m
}

const { TEXTOS_PEDIDO, MAXIMO_TEXTO, PROMESSAS: PROMESSAS_SITE, problemaDaFala } = await carregar('src/dados/textos-pedido.ts')
const { termoProibido } = await carregar('src/painel/proibidos.ts')

// as mesmas promessas do servidor (GC_TERMOS_PROMESSA em public/api/nucleo/textos.php)
const php = readFileSync(join(raiz, 'public/api/nucleo/textos.php'), 'utf8')
const PROMESSAS = [...(/const GC_TERMOS_PROMESSA = \[([\s\S]*?)\];/.exec(php)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const problemas = []
if (PROMESSAS.length < 5) problemas.push('não achei GC_TERMOS_PROMESSA em textos.php')
if (JSON.stringify(PROMESSAS) !== JSON.stringify([...PROMESSAS_SITE])) problemas.push('PROMESSAS (src/dados/textos-pedido.ts) e GC_TERMOS_PROMESSA (textos.php) estão diferentes')
const textos = {}
for (const [chave, d] of Object.entries(TEXTOS_PEDIDO)) {
  const marcadores = [...(d.marcadores ?? [])]
  const usados = [...d.padrao.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1])
  for (const u of usados) if (!marcadores.includes(u)) problemas.push(`${chave}: {${u}} no texto de sempre sem estar nos marcadores`)
  if (/[{}]/.test(d.padrao.replace(/\{[^{}]*\}/g, ''))) problemas.push(`${chave}: chave sobrando no texto de sempre`)
  if (!(d.tipo in MAXIMO_TEXTO)) problemas.push(`${chave}: tipo ${d.tipo} desconhecido`)
  else if ([...d.padrao].length > MAXIMO_TEXTO[d.tipo]) problemas.push(`${chave}: passa de ${MAXIMO_TEXTO[d.tipo]} letras`)
  if (!d.padrao.trim() || /\n/.test(d.padrao)) problemas.push(`${chave}: texto vazio ou com quebra de linha`)
  const termo = termoProibido(d.padrao)
  if (termo) problemas.push(`${chave}: termo proibido "${termo}"`)
  const s = ` ${semAcento(d.padrao).replace(/[^a-z0-9]+/g, ' ').trim()} `
  const promessa = PROMESSAS.find((p) => s.includes(` ${p} `))
  if (promessa) problemas.push(`${chave}: promessa "${promessa}"`)
  if (!/^[a-z][a-zA-Z.]+$/.test(chave)) problemas.push(`${chave}: chave fora do padrão (letras e pontos)`)
  const doSite = problemaDaFala(chave, d.padrao)
  if (doSite) problemas.push(`${chave}: ${doSite}`)
  textos[chave] = { padrao: d.padrao, tipo: d.tipo, marcadores }
}
if (problemas.length) {
  console.error(problemas.join('\n'))
  process.exit(1)
}

const json = `${JSON.stringify({ gerado: 'scripts/gerar-textos-pedido.mjs (de src/dados/textos-pedido.ts)', maximo: MAXIMO_TEXTO, textos }, null, 2)}\n`
if (process.argv.includes('--conferir')) {
  const atual = existsSync(destino) ? readFileSync(destino, 'utf8') : ''
  if (atual !== json) {
    console.error('public/api/nucleo/textos-pedido.json está velho: rode node scripts/gerar-textos-pedido.mjs')
    process.exit(1)
  }
  console.log(`textos ok: ${Object.keys(textos).length} falas em dia`)
} else {
  writeFileSync(destino, json)
  console.log(`gravei ${Object.keys(textos).length} falas em public/api/nucleo/textos-pedido.json`)
}

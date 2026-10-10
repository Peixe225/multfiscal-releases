/**
 * Fila de gravações: node scripts/gravar/rodar.mjs fila.json saida/ [paralelo=2]
 * fila.json = [{ tipo:'classico'|'live'|'hall', nome, ...job }]. Escreve saida/<nome>.mp4 e saida/<nome>.json.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { abrirNavegador, FORMATOS } from './comum.mjs'
import { gravarClassico } from './classico.mjs'

const [fila, saida, par = '2'] = process.argv.slice(2)
const jobs = JSON.parse(readFileSync(fila, 'utf8'))
mkdirSync(saida, { recursive: true })
const tipos = { classico: gravarClassico }
try { const m = await import('./live.mjs'); tipos.live = m.gravarLive } catch {}
try { const m = await import('./hall.mjs'); tipos.hall = m.gravarHall } catch {}
try { const m = await import('./imersivo.mjs'); tipos.imersivo = m.gravarImersivo } catch {}

let prox = 0
async function trabalhador(w) {
  const browser = await abrirNavegador()
  try {
    while (prox < jobs.length) {
      const job = jobs[prox++]
      const meta = join(saida, `${job.nome}.json`)
      if (existsSync(meta) && JSON.parse(readFileSync(meta, 'utf8')).ok) { console.log(`[${w}] já feito: ${job.nome}`); continue }
      const t0 = Date.now()
      console.log(`[${w}] ▶ ${job.nome}`)
      const res = await tipos[job.tipo](browser, { ...job, arquivo: join(saida, `${job.nome}.mp4`), video: FORMATOS[job.formato].video }, (m) => console.log(`[${w}] ${job.nome}: ${m}`))
      writeFileSync(meta, JSON.stringify({ ...job, ...res, picks: undefined, gravadoEm: new Date().toISOString(), msGravacao: Date.now() - t0 }, null, 1))
      console.log(`[${w}] ${res.ok ? '✔' : '✖'} ${job.nome} ${res.segundos ? res.segundos.toFixed(1) + 's' : ''} ${res.erro ?? ''}`)
    }
  } finally { await browser.close() }
}
await Promise.all(Array.from({ length: Number(par) }, (_, i) => trabalhador(i)))

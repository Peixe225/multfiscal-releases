// Procura uma semente cuja carreira (Bolívia, goleiro — o último botão de posição —, ritmo Expresso, sempre a 1ª opção) passe de pico 90.
// Uso: node buscar-semente.mjs <paralelos> <x0> <n>   (sementes [x0+i, 777])
import { lancar, aparelho, jogarCarreira, ultimaTerminada, URL0, sleep } from './lib.mjs'

const par = Number(process.argv[2] ?? 3)
const x0 = Number(process.argv[3] ?? 1000)
const n = Number(process.argv[4] ?? 6)
const browser = await lancar()
const fila = Array.from({ length: n }, (_, i) => [x0 + i, 777])
const achados = []
async function trabalhador(k) {
  const a = await aparelho(browser, `busca${k}`, { partidas: 0 })
  await a.page.goto(URL0)
  await a.page.waitForSelector('.ld-modes', { timeout: 60000 })
  while (fila.length) {
    const s = fila.shift()
    const r = await jogarCarreira(a.page, { semente: s, nacao: 'Bolívia', sobrenome: 'BUSCA' }).catch((e) => ({ erro: String(e) }))
    await sleep(2500)
    const h = await ultimaTerminada(a.page)
    const linha = { s, ms: r.ms, fim: r.fim, erro: r.erro, id: h?.id, pico: h?.summary?.peakOvr, nota: h?.legacy?.score, clubes: (h?.summary?.clubs ?? []).map((c) => c.clubId).join(',') }
    console.log(JSON.stringify(linha))
    achados.push(linha)
  }
  await a.ctx.close()
}
await Promise.all(Array.from({ length: par }, (_, k) => trabalhador(k)))
await browser.close()
console.log('melhores:', JSON.stringify(achados.filter((a) => a.pico >= 90)))

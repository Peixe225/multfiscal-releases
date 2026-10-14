// LENDA v3 · o Hall público se refaz sozinho no prazo (hall_intervalo_min, 60–180 min): o primeiro pedido depois
// do prazo recebe a fotografia anterior e a refaz logo depois; a carreira liberada pelo admin entra nessa hora.
// Roda depois do e2e.mjs (usa o estado.json). Uso: node hall-prazo.mjs
import { readFileSync } from 'node:fs'
import { admin, ok, resultado, sql, sleep, URL0, BASE } from './lib.mjs'

const estado = JSON.parse(readFileSync(`${BASE}/estado.json`, 'utf8'))
const hall = async (q = '') => (await fetch(`${URL0}api/hall.php${q}`)).json()
const pk = sql(`SELECT id FROM carreiras WHERE oculta=1 LIMIT 1`)
const cid = sql(`SELECT carreira_id FROM carreiras WHERE id=${pk}`)
ok(/^\d+$/.test(pk), `uma carreira oculta pelo admin (${cid})`)
let r = await admin({ acao: 'mostrar_carreira', id: Number(pk) })
ok(r.status === 200, 'admin: mostrar/liberar a carreira')
let h = await hall()
ok(!h.itens.some((i) => i.id === cid), 'dentro do prazo: ela ainda não está no Hall (entra na próxima fotografia)')
const antes = h.atualizadoEm
// fotografia de 61 min atrás (intervalo padrão: 60 min)
const em = new Date(Date.now() - 61 * 60_000).toISOString().replace(/\.\d+Z$/, 'Z')
sql(`UPDATE site_config SET valor=JSON_SET(valor, '$.em', '${em}') WHERE chave='_hall_foto'`)
const t0 = performance.now()
h = await hall()
const ms = performance.now() - t0
ok(h.atualizadoEm === em && !h.itens.some((i) => i.id === cid), `prazo vencido: o 1º pedido recebe a fotografia anterior na hora (${ms.toFixed(0)} ms)`)
let novo = null
for (let i = 0; i < 20 && !novo; i++) {
  await sleep(250)
  const x = await hall()
  if (x.atualizadoEm !== em) novo = x
}
ok(novo && novo.itens.some((i) => i.id === cid), `…e refaz logo depois: a carreira liberada entrou (${novo?.atualizadoEm})`)
ok(novo && Date.parse(novo.proximaEm) - Date.parse(novo.atualizadoEm) === 60 * 60_000, 'próxima atualização em 60 min')
r = await admin({ acao: 'config', valores: { hall_intervalo_min: 180 } })
ok(r.status === 200, 'admin: intervalo do Hall = 3 h')
r = await admin({ acao: 'config', valores: { hall_intervalo_min: 30 } })
ok(r.status === 400 && r.json?.erro === 'config_invalida', 'intervalo fora de 60–180: 400 config_invalida')
r = await admin({ acao: 'atualizar_hall' })
const x = await hall('?pais=BOL')
ok(Date.parse(x.proximaEm) - Date.parse(x.atualizadoEm) === 180 * 60_000, 'com 3 h: próxima atualização em 180 min')
await admin({ acao: 'config', valores: { hall_intervalo_min: 60 } })
void antes
void estado
const res = resultado()
console.log(`\n${res.falhas ? 'FALHOU' : 'PASSOU'}: ${res.oks} ok, ${res.falhas} falhas`)
process.exit(res.falhas ? 1 : 0)

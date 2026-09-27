import { ensureProxyEnv, pmap } from './lib/http.mjs'
import { getEvents } from './lib/espn.mjs'
await ensureProxyEnv(import.meta.url)
const L = (process.argv[2]||'mex.1 ger.2 bra.1 arg.1 usa.1 col.1 uru.1 ecu.1 arg.2 crc.1 jpn.1 bra.2 arg.3 aus.1 bel.1 eng.1 uefa.champions uefa.europa uefa.europa.conf').split(' ')
await pmap(L, async (slug) => {
  let out=[]
  for (const y of ['2026','2027']) {
    const {events} = await getEvents(slug, y)
    const st = {}
    for (const e of events) { const k=e.stage+':'+e.state; st[k]=(st[k]||0)+1 }
    const pre = events.filter(e=>e.state==='pre')
    out.push(`${y}: n=${events.length} pre=${pre.length} first=${pre[0]?.date?.slice(0,10)} last=${pre.at(-1)?.date?.slice(0,10)} stages=${JSON.stringify(st)}`)
  }
  console.log(slug, '\n  '+out.join('\n  '))
}, 6)

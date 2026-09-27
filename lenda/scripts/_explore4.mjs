import { ensureProxyEnv } from './lib/http.mjs'
import { getEvents } from './lib/espn.mjs'
await ensureProxyEnv(import.meta.url)
for (const slug of (process.argv[2]||'conmebol.libertadores conmebol.sudamericana bra.copa_do_brazil arg.copa usa.open').split(' ')) {
  const {events}=await getEvents(slug,'2026')
  const by={}
  for (const e of events) { (by[e.stage] ||= []).push(e) }
  console.log('==', slug, events.length)
  for (const [st, evs] of Object.entries(by)) {
    if (/group|league|first|second|third|preliminary|qualif/i.test(st) && evs.length>16) { console.log('  ',st, evs.length, 'evs'); continue }
    console.log('  ', st, evs.length)
    for (const e of evs) console.log(`      ${e.date.slice(0,10)} ${e.state} ${e.home.name}(${e.home.id}) ${e.home.score??''}${e.home.shootout!=null?'('+e.home.shootout+')':''} x ${e.away.score??''}${e.away.shootout!=null?'('+e.away.shootout+')':''} ${e.away.name}(${e.away.id}) leg=${e.leg??''} ${e.notes.join(';')}`)
  }
}

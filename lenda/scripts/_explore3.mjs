import { ensureProxyEnv } from './lib/http.mjs'
import { getEvents } from './lib/espn.mjs'
await ensureProxyEnv(import.meta.url)
for (const slug of ['arg.1','col.1','uru.1','jpn.1','ecu.1','mex.1','eng.1','uefa.champions','ven.1','per.1','par.1']) {
  const c={}
  for (const y of ['2026','2027']) { const {events}=await getEvents(slug,y); for (const e of events) { const k=`${e.seasonYear}/${e.seasonType}/${e.stage}/${e.state}`; c[k]=(c[k]||0)+1 } }
  console.log(slug, JSON.stringify(c))
}

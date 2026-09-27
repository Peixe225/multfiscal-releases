import { ensureProxyEnv, pmap } from './lib/http.mjs'
import { getStandings, getTeams, flattenStandings, standingsSeason } from './lib/espn.mjs'
await ensureProxyEnv(import.meta.url)
const L = 'mex.1 ger.2 bra.1 ger.1 eng.2 esp.1 esp.2 arg.1 fra.1 fra.2 eng.1 ita.1 ita.2 par.1 bol.1 chi.1 col.1 ven.1 uru.1 per.1 ecu.1 arg.2 usa.1 por.1 tur.1 rus.1 ned.1 crc.1 hon.1 gua.1 slv.1 sco.1 chn.1 jpn.1 ksa.1 arg.3 bra.2 mex.2 rsa.1 bel.1 gre.1 den.1 aut.1 nor.1 aus.1 swe.1 eng.3 eng.4 sco.2 ned.2 rou.1 sui.1'.split(' ')
const Q = { 'ecu.1': 'seasontype=1', 'rou.1': 'seasontype=1', 'sui.1': 'seasontype=1' }
await pmap(L, async (slug) => {
  const j = await getStandings(slug, Q[slug])
  const t = await getTeams(slug)
  const g = flattenStandings(j)
  const ss = standingsSeason(j)
  const types = (j?.seasons||[]).filter(s=>s.year>=2025).map(s=>`${s.year}:[`+(s.types||[]).map(t=>`${t.id}/${t.abbreviation||t.name}${t.hasStandings?'*':''}(${(t.startDate||'').slice(0,10)}..${(t.endDate||'').slice(0,10)})`).join(' ')+']').join(' ')
  const n = g.reduce((a,x)=>a+x.entries.length,0)
  const maxgp = Math.max(0,...g.flatMap(x=>x.entries.map(e=>e.stats.played||0)))
  const teamsN = t?.sports?.[0]?.leagues?.[0]?.teams?.length
  console.log(`${slug.padEnd(7)} n=${n} teams=${teamsN} groups=${g.map(x=>x.name+'('+x.entries.length+')').join('|')} gp=${maxgp} season=${ss.season}/${ss.seasonType} ${ss.name}\n    ${types}`)
}, 6)

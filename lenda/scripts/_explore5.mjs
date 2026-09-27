import { ensureProxyEnv, pmap } from './lib/http.mjs'
import { getTeams, getStandings, flattenStandings } from './lib/espn.mjs'
await ensureProxyEnv(import.meta.url)
for (const slug of (process.argv[2]||'uefa.champions uefa.europa uefa.europa.conf concacaf.champions afc.champions caf.champions caf.confed afc.cup uefa.champions_qual uefa.europa_qual uefa.europa.conf_qual').split(' ')) {
  const t = await getTeams(slug)
  const teams = t?.sports?.[0]?.leagues?.[0]?.teams?.map(x=>x.team) || []
  const st = flattenStandings(await getStandings(slug))
  console.log('==', slug, 'teams', teams.length, 'standings', st.map(g=>g.name+':'+g.entries.length).join(','))
  console.log('   ', teams.map(x=>`${x.id}:${x.displayName}[${x.slug||''}|${x.location||''}]${x.color||''}`).join('  '))
}

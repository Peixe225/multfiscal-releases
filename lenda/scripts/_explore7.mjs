import { getStandings, getTeams, flattenStandings } from './lib/espn.mjs'
const Q = { 'ecu.1': 'seasontype=1', 'rou.1': 'seasontype=1', 'sui.1': 'seasontype=1' }
for (const slug of process.argv[2].split(' ')) {
  const g = flattenStandings(await getStandings(slug, Q[slug]))
  const t = await getTeams(slug)
  const tm = Object.fromEntries((t?.sports?.[0]?.leagues?.[0]?.teams||[]).map(x=>[x.team.id,x.team]))
  for (const grp of g) {
    console.log(`== ${slug} ${grp.name}`)
    console.log(grp.entries.map((e,i)=>`${i+1}.${e.team.id}:${e.team.displayName}|${e.team.shortDisplayName}|${e.team.abbreviation} ${e.stats.played}j ${e.stats.points}p ${e.stats.gf}-${e.stats.ga} #${tm[e.team.id]?.color||'-'}/${tm[e.team.id]?.alternateColor||'-'}${e.note?' ['+e.note.description+']':''}`).join('\n'))
  }
}

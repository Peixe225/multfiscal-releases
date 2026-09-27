import { getStandings, flattenStandings } from './lib/espn.mjs'
import { LEAGUES } from '../src/data/catalog/leagues.ts'
const Q = { 'ecu.1': 'seasontype=1', 'rou.1': 'seasontype=1', 'sui.1': 'seasontype=1' }
for (const l of LEAGUES) {
  const g = flattenStandings(await getStandings(l.id, Q[l.id]))
  const es = g.flatMap(x=>x.entries)
  console.log(`${l.id}: ` + es.map(e=>`${e.team.id}=${e.team.shortDisplayName}`).join(', '))
}

import { crawlAll } from './lib/ea.mjs'
import { writeFileSync } from 'node:fs'
const all = await crawlAll(()=>{})
writeFileSync('/tmp/claude-0/-home-user-multfiscal-releases/856de241-fe5b-5ff3-9843-1a584641489b/scratchpad/ea_all.json', JSON.stringify(all))
const by = {}
for (const p of all) { const k = p.leagueEaId+'|'+p.league; (by[k] ||= {}); (by[k][p.club] ||= []).push(p.ovr) }
for (const [lg, clubs] of Object.entries(by)) {
  const rows = Object.entries(clubs).map(([c, o]) => { o.sort((a,b)=>b-a); const t=o.slice(0,14); return [c, o.length, (t.reduce((a,b)=>a+b,0)/t.length).toFixed(1)] }).sort((a,b)=>b[2]-a[2])
  console.log('##', lg, rows.length, rows.map(r=>`${r[0]}(${r[1]},${r[2]})`).join('; '))
}

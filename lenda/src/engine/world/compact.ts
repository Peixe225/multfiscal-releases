/**
 * Compactação de temporadas antigas (o WorldState é salvo no IndexedDB a cada temporada).
 *
 * Temporadas com 4+ anos de idade mantêm: tabelas finais completas de TODAS as ligas, campeões,
 * acesso/rebaixamento, finais e chaveamentos de seleções, Bola de Ouro/The Best/Kopa/Chuteira/Luva/
 * Puskás completos e o vencedor de cada prêmio de liga. Descartam: tabelas de fase de grupos/liga das
 * copas de clubes, confrontos antes da semifinal e `reached` antes das quartas (copas de clubes),
 * artilharia além do top 3, fases de play-off antes da final, rankings de prêmios de liga (fica só o
 * vencedor) e `clubStats` (os resumos de clube já foram lidos pela carreira).
 */
import type { SeasonWorldResult } from '../types'
import { stageDepth } from './knockout'

export const COMPACT_AFTER = 4

export function compactSeason(r: SeasonWorldResult): SeasonWorldResult {
  const leagues: SeasonWorldResult['leagues'] = {}
  for (const [id, l] of Object.entries(r.leagues)) {
    const out = { ...l, topScorers: l.topScorers.slice(0, 3) }
    const finals = l.playoffs?.filter((st) => st.name.endsWith('Final'))
    if (finals?.length) out.playoffs = finals
    else delete out.playoffs
    leagues[id] = out
  }
  const cups: SeasonWorldResult['cups'] = {}
  for (const [id, c] of Object.entries(r.cups)) {
    const out = { ...c }
    delete out.groups
    out.knockout = c.knockout.filter((st) => stageDepth(st.name) >= 8 || st.name.endsWith('Final'))
    const reached: Record<string, string> = {}
    for (const [k, v] of Object.entries(c.reached)) if (stageDepth(v) >= 7) reached[k] = v
    out.reached = reached
    cups[id] = out
  }
  const awards = r.awards.map((a) => (a.leagueId ? { ...a, ranking: a.ranking.slice(0, 1) } : a))
  const out: SeasonWorldResult = { ...r, leagues, cups, awards }
  delete out.clubStats
  return out
}

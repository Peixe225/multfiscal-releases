/**
 * Evolução anual de forças.
 *
 * Clube: s' = s + 0,3·(âncora − s) + N(0; 1,8) + eventos; âncora = força inicial real
 *   + 1,5·(prestígio − prestígio inicial) + 0,6·(média da liga atual − média da liga de origem)
 *   + deriva de ligas ricas (ENG/KSA: +0,1/ano, até +2).
 *   Eventos: campeão +0,3; campeão continental principal +0,5; rebaixado −1,0; promovido +0,8
 *   (pequenos de propósito: evitam dinastias eternas por realimentação).
 * Prestígio (0–5): volta devagar ao inicial (5%/ano), +0,08 por liga, +0,15 por continental, −0,2 se cair.
 * Seleção: n' = n + 0,15·(âncora − n) + N(0; 0,9); âncora = força inicial + 25% da variação da média
 *   do top-5 de craques daquela nacionalidade (novas gerações fortalecem países); campeão mundial +0,8.
 * Limites: clubes 40–92, seleções 40–95. O reforço do jogador NÃO entra aqui (vale só na temporada).
 */
import type { ClubDynamic, GameData, Rival, SeasonWorldResult } from '../types'
import { clamp, rng as subRng } from '../rng'
import type { DataIndex } from './context'

const MONEY_LEAGUES = new Set(['ENG', 'KSA'])

export function clubAnchor(ix: DataIndex, clubId: string, dyn: ClubDynamic, season: number): number {
  const c = ix.club.get(clubId)
  if (!c) return dyn.strength
  const homeMean = ix.leagueMean.get(c.leagueId) ?? c.strength
  const curMean = ix.leagueMean.get(dyn.leagueId) ?? homeMean
  let a = c.strength + 1.5 * (dyn.prestige - c.prestige) + 0.6 * (curMean - homeMean)
  const lg = ix.league.get(dyn.leagueId)
  if (lg && lg.tier === 1 && MONEY_LEAGUES.has(lg.country)) a += 0.1 * Math.min(20, Math.max(0, season - ix.firstSeason))
  return a
}

export function evolveClubs(
  data: GameData,
  ix: DataIndex,
  seed: string,
  clubs: Record<string, ClubDynamic>,
  result: SeasonWorldResult,
  moves: Map<string, string>,
): Record<string, ClubDynamic> {
  const season = result.season
  const rng = subRng(seed, 'season', season, 'evolve')
  const champs = new Set<string>()
  const promoted = new Set<string>()
  const relegated = new Set<string>()
  for (const l of Object.values(result.leagues)) {
    const lg = ix.league.get(l.leagueId)
    if (lg && lg.tier === 1) {
      champs.add(l.champion)
      for (const c of l.champions ?? []) champs.add(c.clubId)
    }
    for (const c of l.promoted) promoted.add(c)
    for (const c of l.relegated) relegated.add(c)
  }
  const continental = new Set<string>()
  for (const cf of Object.values(ix.confed)) {
    const w = cf.primary && result.cups[cf.primary.id]?.winner
    if (w) continental.add(w)
  }
  const out: Record<string, ClubDynamic> = {}
  for (const c of data.clubs) {
    const cur = clubs[c.id]
    if (!cur) continue
    const leagueId = moves.get(c.id) ?? cur.leagueId
    let prestige = cur.prestige + (c.prestige - cur.prestige) * 0.05 + rng.normal(0, 0.04)
    if (champs.has(c.id)) prestige += 0.08
    if (continental.has(c.id)) prestige += 0.15
    if (relegated.has(c.id)) prestige -= 0.2
    prestige = clamp(prestige, 0, 5)
    const next: ClubDynamic = { strength: cur.strength, leagueId, prestige: Math.round(prestige * 100) / 100 }
    const anchor = clubAnchor(ix, c.id, next, season + 1)
    let s = cur.strength + (anchor - cur.strength) * 0.3 + rng.normal(0, 1.8)
    if (champs.has(c.id)) s += 0.3
    if (continental.has(c.id)) s += 0.5
    if (relegated.has(c.id)) s -= 1.0
    if (promoted.has(c.id)) s += 0.8
    next.strength = Math.round(clamp(s, 40, 92) * 10) / 10
    out[c.id] = next
  }
  return out
}

/** Média dos 5 melhores OVR por nacionalidade. */
export function topTalent(rivals: readonly { nationality: string; ovr: number; retired?: boolean }[]): Map<string, number> {
  const by = new Map<string, number[]>()
  for (const r of rivals) {
    if (r.retired) continue
    const l = by.get(r.nationality)
    if (l) l.push(r.ovr)
    else by.set(r.nationality, [r.ovr])
  }
  const out = new Map<string, number>()
  for (const [k, l] of by) {
    l.sort((a, b) => b - a)
    const top = l.slice(0, 5)
    // quem tem menos de 5 craques completa com 72 (nível de seleção comum)
    while (top.length < 5) top.push(72)
    out.set(k, top.reduce((s, x) => s + x, 0) / 5)
  }
  return out
}

export function evolveNations(
  data: GameData,
  seed: string,
  season: number,
  nations: Record<string, number>,
  result: SeasonWorldResult,
  initialTalent: Map<string, number>,
  rivals: readonly Rival[],
): Record<string, number> {
  const rng = subRng(seed, 'season', season, 'nations-evolve')
  const talent = topTalent(rivals)
  const winners = new Set<string>()
  for (const t of Object.values(result.national)) winners.add(t.winner)
  const out: Record<string, number> = {}
  for (const c of data.countries) {
    const cur = nations[c.code] ?? c.strength
    const dt = (talent.get(c.code) ?? 72) - (initialTalent.get(c.code) ?? 72)
    const anchor = c.strength + clamp(dt * 0.25, -4, 4)
    let n = cur + (anchor - cur) * 0.15 + rng.normal(0, 0.9)
    if (winners.has(c.code)) n += 0.8
    out[c.code] = Math.round(clamp(n, 40, 95) * 10) / 10
  }
  return out
}

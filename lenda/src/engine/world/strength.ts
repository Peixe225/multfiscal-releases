/**
 * Evolução anual de forças.
 *
 * Clube: s' = s + 0,3·(âncora − s) + N(0; 1,4) + eventos; âncora = base + 1,5·(prestígio − prestígio
 *   inicial) + 0,6·(média da liga atual − média da liga de origem) + deriva de ligas ricas (ENG/KSA:
 *   +0,1/ano, até +2) + ciclo do clube.
 *   - base: força inicial real, mas quem sobra na 1ª divisão de origem tem a vantagem sobre os
 *     perseguidores (média do 2º ao 4º) comprimida — até 2 pontos ficam; do excedente, 35%: o
 *     dinheiro da liga se espalha, craques saem, os rivais se reforçam. O PSG de 88 numa Ligue 1
 *     de 77 vira ~83, o Bayern ~84; Real/Barça, City, Inter, Flamengo perdem < 1.
 *   - ciclo: projeto esportivo de cada clube (técnico, gestão, investidor, geração da base), um
 *     ruído suave e sem estado — nós N(0; 2,4) (limitados a ±2σ) a cada 7 temporadas, com fase aleatória por clube e
 *     interpolação cossenoidal. Cria eras: dinastias de 4–8 anos que um dia acabam.
 *   Eventos: campeão +0,3; campeão continental principal +0,5; rebaixado −1,0; promovido +0,8
 *   (pequenos de propósito: evitam dinastias eternas por realimentação). Desgaste de dinastia: quem
 *   ganhou mais de 2 das últimas 5 ligas (torneio anual) perde 0,7 por título além do 2º, todo ano.
 *   Calibrado em 30 temporadas × 12 seeds: o maior campeão fica com ~40–45% das ligas de um gigante
 *   só (GER/FRA/POR/NED/SCO), ~30–38% em ENG/ESP/ITA; Brasil e Argentina têm 8+ campeões.
 *   A 1ª temporada usa a força real inicial (continua a tabela de hoje); tudo isso vale da 2ª em diante.
 * Prestígio (0–5): volta devagar ao inicial (5%/ano), +0,08 por liga, +0,15 por continental, −0,2 se cair.
 * Seleção: n' = n + 0,15·(âncora − n) + N(0; 0,9); âncora = força inicial + 25% da variação da média
 *   do top-5 de craques daquela nacionalidade (novas gerações fortalecem países); campeão mundial +0,8.
 * Limites: clubes 40–92, seleções 40–95. O reforço do jogador NÃO entra aqui (vale só na temporada).
 */
import type { ClubDynamic, GameData, Rival, SeasonWorldResult } from '../types'
import { clamp, rng as subRng } from '../rng'
import type { DataIndex } from './context'

const MONEY_LEAGUES = new Set(['ENG', 'KSA'])

/** Parâmetros do equilíbrio de longo prazo (exportados para calibração). */
export const EVOLVE = {
  /** Vantagem sobre os perseguidores (média do 2º ao 4º da liga de origem) mantida integralmente. */
  freeGap: 2,
  /** Fração mantida do excedente acima de `freeGap`. */
  gapKeep: 0.35,
  /** Desvio dos nós do ciclo do clube. */
  cycleSd: 2.4,
  /** Temporadas entre nós do ciclo. */
  cycleLen: 7,
  /** Desgaste de dinastia: janela (temporadas) e perda por título acima de `fatigueFree` nela. */
  fatigueWindow: 5,
  fatigueFree: 2,
  fatigue: 0.7,
  /** Ruído anual da força (entressafra: contratações, lesões longas). */
  noise: 1.4,
}

const contenders = new WeakMap<DataIndex, Map<string, number>>()

/** Média da 2ª à 4ª maior força inicial de cada 1ª divisão (os "perseguidores"). */
function contenderRef(ix: DataIndex): Map<string, number> {
  const hit = contenders.get(ix)
  if (hit) return hit
  const by = new Map<string, number[]>()
  for (const c of ix.club.values()) {
    const l = by.get(c.leagueId)
    if (l) l.push(c.strength)
    else by.set(c.leagueId, [c.strength])
  }
  const out = new Map<string, number>()
  for (const [id, l] of by) {
    if (ix.league.get(id)?.tier !== 1 || l.length < 6) continue
    l.sort((a, b) => b - a)
    out.set(id, (l[1] + l[2] + l[3]) / 3)
  }
  contenders.set(ix, out)
  return out
}

/** Força-base de longo prazo: a real, com a sobra sobre os perseguidores da liga de origem comprimida. */
export function baseStrength(ix: DataIndex, clubId: string): number {
  const c = ix.club.get(clubId)
  if (!c) return 60
  const ref = contenderRef(ix).get(c.leagueId)
  if (ref === undefined) return c.strength
  const excess = c.strength - ref - EVOLVE.freeGap
  return excess > 0 ? ref + EVOLVE.freeGap + excess * EVOLVE.gapKeep : c.strength
}

/** Ciclo do clube na temporada (média 0): ruído suave por clube, sem estado. */
export function clubCycle(seed: string, clubId: string, season: number, firstSeason: number): number {
  if (EVOLVE.cycleSd <= 0) return 0
  const phase = subRng(seed, 'cycle', clubId).next() * EVOLVE.cycleLen
  const t = (season - firstSeason + phase) / EVOLVE.cycleLen
  const k = Math.floor(t)
  const f = (1 - Math.cos(Math.PI * (t - k))) / 2
  const lim = 2 * EVOLVE.cycleSd
  const a = clamp(subRng(seed, 'cycle', clubId, k).normal(0, EVOLVE.cycleSd), -lim, lim)
  const b = clamp(subRng(seed, 'cycle', clubId, k + 1).normal(0, EVOLVE.cycleSd), -lim, lim)
  return a + (b - a) * f
}

export function clubAnchor(ix: DataIndex, clubId: string, dyn: ClubDynamic, season: number, seed?: string): number {
  const c = ix.club.get(clubId)
  if (!c) return dyn.strength
  const homeMean = ix.leagueMean.get(c.leagueId) ?? c.strength
  const curMean = ix.leagueMean.get(dyn.leagueId) ?? homeMean
  let a = baseStrength(ix, clubId) + 1.5 * (dyn.prestige - c.prestige) + 0.6 * (curMean - homeMean)
  const lg = ix.league.get(dyn.leagueId)
  if (lg && lg.tier === 1 && MONEY_LEAGUES.has(lg.country)) a += 0.1 * Math.min(20, Math.max(0, season - ix.firstSeason))
  if (seed !== undefined) a += clubCycle(seed, clubId, season, ix.firstSeason)
  return a
}

export function evolveClubs(
  data: GameData,
  ix: DataIndex,
  seed: string,
  clubs: Record<string, ClubDynamic>,
  result: SeasonWorldResult,
  moves: Map<string, string>,
  past: Readonly<Record<number, SeasonWorldResult>> = {},
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
  // títulos de 1ª divisão na janela recente (esta temporada inclusa): base do desgaste de dinastia
  const recent = new Map<string, number>()
  for (let s = season; s > season - EVOLVE.fatigueWindow; s--) {
    const r = s === season ? result : past[s]
    if (!r) continue
    for (const l of Object.values(r.leagues)) {
      if (ix.league.get(l.leagueId)?.tier !== 1 || l.champions?.length) continue
      recent.set(l.champion, (recent.get(l.champion) ?? 0) + 1)
    }
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
    const anchor = clubAnchor(ix, c.id, next, season + 1, seed)
    let s = cur.strength + (anchor - cur.strength) * 0.3 + rng.normal(0, EVOLVE.noise)
    if (champs.has(c.id)) s += 0.3
    if (continental.has(c.id)) s += 0.5
    if (relegated.has(c.id)) s -= 1.0
    if (promoted.has(c.id)) s += 0.8
    // desgaste de dinastia: elenco envelhece, craques são vendidos, rivais contratam os destaques
    const run = (recent.get(c.id) ?? 0) - EVOLVE.fatigueFree
    if (run > 0) s -= EVOLVE.fatigue * run
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

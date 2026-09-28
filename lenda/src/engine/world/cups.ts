/**
 * Copas nacionais (mata-mata; Copa do Brasil em ida e volta a partir das oitavas) e estaduais.
 * Na 1ª temporada, as copas em andamento continuam do ponto real (GameData.cupsInProgress).
 */
import type { CupInProgress } from '../api'
import type { Competition, CupResult } from '../types'
import { rng as subRng, type Rng } from '../rng'
import type { SeasonCtx } from './context'
import { nextPow2, runKnockout, stageDepth, stageName, type PresetTie } from './knockout'
import { roundRobin } from './schedule'
import { play, recordKnown } from './context'
import { addResult, newRow, sortTable } from './table'

/** Reached compacto nas copas nacionais: só quem chegou às oitavas (ou mais) e o clube do jogador. */
export function compactReached(ctx: SeasonCtx, reached: Record<string, string>, minDepth: number): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [id, st] of Object.entries(reached)) {
    if (stageDepth(st) >= minDepth || id === ctx.userClub) out[id] = st
  }
  return out
}

/** Participantes ordenados: divisão mais alta primeiro, depois força. */
function seedOrder(ctx: SeasonCtx, clubs: string[]): string[] {
  const tier = (id: string) => ctx.ix.league.get(ctx.leagueOf.get(id) ?? '')?.level ?? ctx.ix.league.get(ctx.leagueOf.get(id) ?? '')?.tier ?? 9
  return clubs.slice().sort((a, b) => tier(a) - tier(b) || (ctx.str.get(b) ?? 0) - (ctx.str.get(a) ?? 0) || (a < b ? -1 : 1))
}

export function inProgress(ctx: SeasonCtx, compId: string): CupInProgress | undefined {
  if (!ctx.first) return undefined
  const cip = ctx.data.cupsInProgress?.[compId]
  return cip && cip.season === ctx.season ? cip : undefined
}

/**
 * Confrontos reais já definidos (só clubes conhecidos). Confronto já decidido (todos os jogos com
 * placar e só um dos dois ainda vivo) não é rejogado: o eliminado entra em `reached` com `stageName`.
 */
export function presetFrom(ctx: SeasonCtx, cip: CupInProgress, reached?: Record<string, string>, stageName?: string): PresetTie[] {
  const out: PresetTie[] = []
  const alive = new Set(cip.alive)
  for (const p of cip.pairs ?? []) {
    if (!ctx.ix.club.has(p.a) || !ctx.ix.club.has(p.b)) continue
    const legs = p.legs?.filter((l) => l.home === p.a || l.home === p.b)
    const decided = !!legs?.length && legs.every((l) => l.score) && alive.has(p.a) !== alive.has(p.b)
    if (decided) {
      if (reached && stageName) reached[alive.has(p.a) ? p.b : p.a] = stageName
      continue
    }
    if (!alive.has(p.a) && !alive.has(p.b)) continue
    out.push({ a: p.a, b: p.b, legs })
  }
  return out
}

/** Fases já concluídas no snapshot → quem caiu nelas (e os jogos reais entram nas estatísticas). */
export function reachedFromCompleted(ctx: SeasonCtx, cip: CupInProgress, reached: Record<string, string>, kind?: Competition['kind']) {
  for (const st of cip.completed ?? []) {
    for (const t of st.ties) {
      const loser = t.winner === t.a ? t.b : t.a
      if (ctx.ix.club.has(loser) || ctx.ix.country.has(loser)) reached[loser] = st.name
      if (!kind) continue
      for (const l of t.legs ?? []) {
        if (l.score && ctx.ix.club.has(l.home) && ctx.ix.club.has(l.away)) recordKnown(ctx, l, kind)
      }
    }
  }
}

export function simulateDomesticCup(ctx: SeasonCtx, comp: Competition, participants: string[]): CupResult | null {
  const rng = subRng(ctx.seed, 'season', ctx.season, 'cup', comp.id)
  const cip = inProgress(ctx, comp.id)
  const brazil = comp.country === 'BRA' || comp.id.startsWith('bra.')
  let entrants: string[]
  let preset: PresetTie[] | undefined
  const reached: Record<string, string> = {}
  if (cip) {
    entrants = seedOrder(
      ctx,
      cip.alive.filter((id) => ctx.ix.club.has(id)),
    )
    reachedFromCompleted(ctx, cip, reached, comp.kind)
    preset = presetFrom(ctx, cip, reached, stageName(nextPow2(entrants.length)))
  } else {
    const all = seedOrder(ctx, participants)
    const size = comp.size > 1 ? Math.min(comp.size, all.length) : all.length
    entrants = all.slice(0, size)
  }
  if (entrants.length < 2) return null
  const coversAll = !!preset?.length && preset.length * 2 === entrants.length
  const ko = runKnockout(
    ctx,
    rng,
    entrants,
    {
      kind: comp.kind,
      legs: (size) => (brazil && size <= 16 ? 2 : 1),
      neutral: (size) => size === 2 && !brazil,
      extraTime: !brazil,
      mode: coversAll ? 'fixed' : 'draw',
      keepFrom: 2,
    },
    preset,
  )
  Object.assign(reached, ko.reached)
  return {
    competitionId: comp.id,
    season: ctx.season,
    winner: ko.winner,
    runnerUp: ko.runnerUp,
    knockout: ko.stages,
    reached: compactReached(ctx, reached, 6),
  }
}

/** Estadual: turno único entre os clubes da UF + semifinal (jogo único) e final em ida e volta. */
export function simulateRegionalCup(ctx: SeasonCtx, comp: Competition, participants: string[]): CupResult | null {
  if (participants.length < 2) return null
  const rng: Rng = subRng(ctx.seed, 'season', ctx.season, 'regional', comp.id)
  const clubs = seedOrder(ctx, participants).slice(0, Math.max(2, comp.size || 16))
  let seeds = clubs
  if (clubs.length >= 4) {
    const rows = new Map(clubs.map((c) => [c, newRow(c)] as const))
    for (const day of roundRobin(clubs, 1, rng)) {
      for (const [h, a] of day) {
        const m = play(ctx, rng, h, a, { kind: comp.kind })
        addResult(rows.get(m.home)!, rows.get(m.away)!, m.score[0], m.score[1])
      }
    }
    const table = sortTable([...rows.values()])
    seeds = table.slice(0, clubs.length >= 6 ? 4 : 2).map((r) => r.clubId)
  }
  const ko = runKnockout(ctx, rng, seeds, {
    kind: comp.kind,
    legs: (size) => (size === 2 ? 2 : 1),
    extraTime: false,
    mode: 'bracket',
    keepFrom: 2,
  })
  const reached: Record<string, string> = {}
  for (const c of clubs) reached[c] = 'Fase de grupos'
  Object.assign(reached, ko.reached)
  const res: CupResult = {
    competitionId: comp.id,
    season: ctx.season,
    winner: ko.winner,
    runnerUp: ko.runnerUp,
    knockout: ko.stages,
    reached: compactReached(ctx, reached, 8),
  }
  // a tabela do turno não é guardada (compacto): só quem chegou ao mata-mata e o clube do jogador
  return res
}

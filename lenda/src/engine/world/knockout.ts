/**
 * Blocos de competição reutilizáveis: confronto (jogo único ou ida e volta), chaveamento
 * mata-mata (com byes, sorteio ou chave fixa), fase de grupos e fase de liga suíça.
 *
 * Compacto: só guardamos confrontos a partir de `keepFrom` (ex.: final) e os do clube/seleção do
 * jogador — o resto vira apenas `reached` (fase alcançada).
 */
import type { CompetitionKind, KnockoutStage, MatchResult, StandingRow } from '../types'
import type { Rng } from '../rng'
import { forced, isNationalKind, play, recordKnown, setTag, strengthIn, userEntity, type SeasonCtx } from './context'
import { remainingSchedule, roundRobin, swissPairings } from './schedule'
import { addResult, newRow, sortTable } from './table'

export function stageName(size: number): string {
  switch (size) {
    case 2:
      return 'Final'
    case 4:
      return 'Semifinal'
    case 8:
      return 'Quartas de final'
    case 16:
      return 'Oitavas de final'
    case 32:
      return '16 avos de final'
    case 64:
      return '32 avos de final'
    case 128:
      return '64 avos de final'
    default:
      return 'Fase preliminar'
  }
}

/** Profundidade de uma fase (para comparar "até onde chegou"). */
export function stageDepth(name: string | undefined): number {
  if (!name) return 0
  if (name === 'Campeão') return 10
  if (name === 'Final') return 9
  if (name.startsWith('Semifinal') || name === 'Copa Challenger') return 8
  if (name.startsWith('Quartas')) return 7
  if (name.startsWith('Oitavas')) return 6
  if (name.startsWith('16 avos') || name.startsWith('Play-off')) return 5
  if (name.startsWith('32 avos')) return 4
  if (/grupo|liga/i.test(name)) return 3
  return 2
}

export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

export interface TieSpec {
  /** Melhor campanha/cabeça de chave: decide em casa na volta; mandante em jogo único (se não neutro). */
  a: string
  b: string
  legs: 1 | 2
  neutral?: boolean
  extraTime?: boolean
  /** Agregado empatado → avança `a` (Liguilla do México). */
  seedAdvancesOnDraw?: boolean
  /** Jogos reais já definidos (continuação): placar presente = já disputado. */
  fixed?: { home: string; away: string; score?: [number, number] }[]
  hosts?: Set<string>
  /** Esta é a final (para "impedir título"). */
  isFinal?: boolean
}

export interface TieResult {
  winner: string
  loser: string
  legs: MatchResult[]
}

function goalsFor(legs: MatchResult[], id: string): number {
  let g = 0
  for (const l of legs) g += l.home === id ? l.score[0] : l.away === id ? l.score[1] : 0
  return g
}

export function playTie(ctx: SeasonCtx, rng: Rng, kind: CompetitionKind, t: TieSpec): TieResult {
  const legs: MatchResult[] = []
  const nLegs = t.fixed?.length ? t.fixed.length : t.legs
  const po = { kind, extraTime: t.extraTime, hosts: t.hosts }
  let winner: string
  if (ctx.keys) ctx.tie = { legs: nLegs, index: 0, a: t.a, b: t.b, extraTime: t.extraTime !== false, seedAdvancesOnDraw: t.seedAdvancesOnDraw, prior: legs }
  if (nLegs === 1) {
    const f = t.fixed?.[0]
    const home = f?.home ?? t.a
    const away = home === t.a ? t.b : t.a
    let m: MatchResult
    if (f?.score) {
      m = { home, away, score: [f.score[0], f.score[1]] }
      recordKnown(ctx, m, kind)
      if (m.score[0] === m.score[1]) {
        const pa = strengthIn(ctx, home, kind) - strengthIn(ctx, away, kind)
        m.pens = rng.chance(0.5 + pa / 100) ? [5, 4] : [4, 5]
      }
    } else {
      m = play(ctx, rng, home, away, { ...po, neutral: t.neutral && !f, knockout: true })
    }
    legs.push(m)
    winner = legWinner(m)
  } else {
    // ida: b em casa; volta: a em casa (ou a ordem real dos jogos fixos)
    const order = t.fixed?.length
      ? t.fixed.map((f) => [f.home, f.home === t.a ? t.b : t.a] as [string, string])
      : ([
          [t.b, t.a],
          [t.a, t.b],
        ] as [string, string][])
    for (let i = 0; i < order.length; i++) {
      const [home, away] = order[i]
      const f = t.fixed?.[i]
      const last = i === order.length - 1
      if (ctx.tie) ctx.tie.index = i
      let m: MatchResult
      if (f?.score) {
        m = { home, away, score: [f.score[0], f.score[1]] }
        recordKnown(ctx, m, kind)
      } else {
        m = play(ctx, rng, home, away, { ...po, neutral: last && t.neutral })
      }
      legs.push(m)
    }
    const lastLeg = legs[legs.length - 1]
    if (ctx.fixedSet?.has(lastLeg)) replayTieRng(ctx, rng, kind, t, legs)
    const ga = goalsFor(legs, t.a)
    const gb = goalsFor(legs, t.b)
    if (ga !== gb) winner = ga > gb ? t.a : t.b
    else if (t.seedAdvancesOnDraw) winner = t.a
    else if (ctx.fixedSet?.has(lastLeg)) {
      // (Modo Imersivo) jogo de volta com placar fixo: prorrogação já está no placar; pênaltis vêm do fixo
      if (!lastLeg.pens) lastLeg.pens = lastLeg.home === t.a ? [5, 4] : [4, 5]
      winner = lastLeg.pens[0] > lastLeg.pens[1] ? lastLeg.home : lastLeg.away
    } else {
      // prorrogação (se houver) e pênaltis no último jogo
      const m = legs[legs.length - 1]
      const hs = strengthIn(ctx, m.home, kind)
      const as = strengthIn(ctx, m.away, kind)
      if (t.extraTime !== false) {
        const eh = rng.poisson(0.39 * Math.exp(0.038 * (hs - as + 3.5)))
        const ea = rng.poisson(0.39 * Math.exp(-0.038 * (hs - as + 3.5)))
        m.score = [m.score[0] + eh, m.score[1] + ea]
        m.aet = true
        addExtra(ctx, m, eh, ea, kind)
      }
      const g2a = goalsFor(legs, t.a)
      const g2b = goalsFor(legs, t.b)
      if (g2a !== g2b) winner = g2a > g2b ? t.a : t.b
      else {
        const edge = Math.max(-1, Math.min(1, (hs - as) / 20))
        const pens = shootout(rng, edge)
        m.pens = pens
        winner = pens[0] > pens[1] ? m.home : m.away
      }
    }
  }
  if (ctx.tie) ctx.tie = undefined
  const loser = winner === t.a ? t.b : t.a
  const out: TieResult = { winner, loser, legs }
  applyForce(ctx, kind, t, out)
  if (ctx.collected) {
    // agenda coletada com o placar final do confronto (prorrogação/pênaltis decididos aqui)
    for (const l of legs) {
      const f = ctx.collected.get(l)
      if (!f) continue
      f.score = [l.score[0], l.score[1]]
      if (l.pens) f.pens = [l.pens[0], l.pens[1]]
      if (l.aet) f.aet = true
    }
  }
  return out
}

/**
 * (Modo Imersivo) Volta com placar fixo: consome o rng exatamente como o caminho sem resultado
 * fixo consumiria (prorrogação + pênaltis sobre os placares simulados), para que os confrontos
 * seguintes da competição não mudem. O resultado desse "ensaio" é descartado.
 */
function replayTieRng(ctx: SeasonCtx, rng: Rng, kind: CompetitionKind, t: TieSpec, legs: MatchResult[]) {
  const sim = legs.map((l) => {
    const sc = ctx.simScore?.get(l) ?? l.score
    return { home: l.home, away: l.away, score: [sc[0], sc[1]] as [number, number] }
  })
  const ga = goalsFor(sim, t.a)
  const gb = goalsFor(sim, t.b)
  if (ga !== gb || t.seedAdvancesOnDraw) return
  const m = sim[sim.length - 1]
  const hs = strengthIn(ctx, m.home, kind)
  const as = strengthIn(ctx, m.away, kind)
  let eh = 0
  let ea = 0
  if (t.extraTime !== false) {
    eh = rng.poisson(0.39 * Math.exp(0.038 * (hs - as + 3.5)))
    ea = rng.poisson(0.39 * Math.exp(-0.038 * (hs - as + 3.5)))
  }
  if (eh === ea) shootout(rng, Math.max(-1, Math.min(1, (hs - as) / 20)))
}

function addExtra(ctx: SeasonCtx, m: MatchResult, eh: number, ea: number, kind: CompetitionKind) {
  // o jogo já foi contado: soma os gols da prorrogação (e desfaz o "sem sofrer gol" se for o caso)
  if (isNationalKind(kind)) {
    const h = ctx.ns.get(m.home)
    const a = ctx.ns.get(m.away)
    if (h) h[1] += eh
    if (a) a[1] += ea
    return
  }
  const h = ctx.cs.get(m.home)
  const a = ctx.cs.get(m.away)
  if (h) {
    if (ea > 0 && m.score[1] === ea) h[3] = Math.max(0, h[3] - 1)
    h[1] += eh
    h[2] += ea
  }
  if (a) {
    if (eh > 0 && m.score[0] === eh) a[3] = Math.max(0, a[3] - 1)
    a[1] += ea
    a[2] += eh
  }
}

function shootout(rng: Rng, edge: number): [number, number] {
  let a = 0
  let b = 0
  for (let k = 0; k < 5; k++) {
    if (rng.chance(0.76 + 0.03 * edge)) a++
    if (rng.chance(0.76 - 0.03 * edge)) b++
  }
  for (let k = 0; k < 30 && a === b; k++) {
    if (rng.chance(0.76)) a++
    if (rng.chance(0.76)) b++
  }
  if (a === b) a++
  return [a, b]
}

function legWinner(m: MatchResult): string {
  if (m.score[0] !== m.score[1]) return m.score[0] > m.score[1] ? m.home : m.away
  if (m.pens) return m.pens[0] > m.pens[1] ? m.home : m.away
  return m.home
}

/** Título forçado/impedido: vira o confronto nos pênaltis (evento "pênalti decisivo"). */
function applyForce(ctx: SeasonCtx, kind: CompetitionKind, t: TieSpec, r: TieResult) {
  const ent = userEntity(ctx, kind)
  if (!ent || (t.a !== ent && t.b !== ent)) return
  const f = forced(ctx, kind, ent)
  if (!f) return
  const wantWinner = f === 'win' ? ent : t.isFinal ? (t.a === ent ? t.b : t.a) : null
  if (!wantWinner || r.winner === wantWinner) return
  const last = r.legs[r.legs.length - 1]
  const other = wantWinner === t.a ? t.b : t.a
  const deficit = goalsFor(r.legs, other) - goalsFor(r.legs, wantWinner)
  // iguala (ou vira) o agregado no último jogo; empate decidido nos pênaltis a favor de quem deve vencer
  const byPens = !t.seedAdvancesOnDraw
  const add = deficit + (byPens || wantWinner === t.a ? 0 : 1)
  if (last.home === wantWinner) last.score = [last.score[0] + add, last.score[1]]
  else last.score = [last.score[0], last.score[1] + add]
  if (byPens) last.pens = last.home === wantWinner ? [5, 4] : [4, 5]
  else delete last.pens
  r.winner = wantWinner
  r.loser = other
}

// ───────────────────────── mata-mata ─────────────────────────

export interface KOConfig {
  kind: CompetitionKind
  /** Jogos por confronto conforme o tamanho da fase (2 = final, 4 = semi…). */
  legs: (size: number) => 1 | 2
  extraTime?: boolean
  /** Sede neutra (jogo único) conforme o tamanho da fase. */
  neutral?: (size: number) => boolean
  /** bracket = cabeças de chave (1º × último, re-semeado); draw = sorteio a cada fase; fixed = ordem dada. */
  mode: 'bracket' | 'draw' | 'fixed'
  /** Guardar confrontos a partir desta fase (2 = só a final). */
  keepFrom: number
  seedAdvancesOnDraw?: boolean
  hosts?: Set<string>
  names?: (size: number) => string
  /** Para quando restarem N (play-off de acesso com 2 vagas). Padrão 1. */
  stopAt?: number
  /** Prefixo dos nomes das fases guardadas (ex.: "Play-off de acesso — "). */
  prefix?: string
}

export interface KOResult {
  winner: string
  runnerUp: string
  stages: KnockoutStage[]
  reached: Record<string, string>
  survivors: string[]
}

export interface PresetTie {
  a: string
  b: string
  legs?: { home: string; away: string; score?: [number, number] }[]
}

/**
 * Mata-mata completo. `teams` em ordem de cabeça de chave (0 = melhor). `preset` = confrontos
 * já definidos da primeira fase (continuação real); os demais vivos passam direto.
 */
export function runKnockout(
  ctx: SeasonCtx,
  rng: Rng,
  teams: readonly string[],
  cfg: KOConfig,
  preset?: PresetTie[],
): KOResult {
  const seed = new Map<string, number>()
  teams.forEach((t, i) => seed.set(t, i))
  const reached: Record<string, string> = {}
  const stages: KnockoutStage[] = []
  const names = cfg.names ?? stageName
  const stopAt = Math.max(1, cfg.stopAt ?? 1)
  const ent = userEntity(ctx, cfg.kind)
  let alive = teams.slice()
  let first = true
  let runnerUp = ''
  let guard = 0
  while (alive.length > stopAt && guard++ < 20) {
    const size = nextPow2(alive.length)
    const name = names(size)
    const byes = size - alive.length
    let pairs: { a: string; b: string; fixed?: PresetTie['legs'] }[] = []
    let passing: string[] = []
    if (first && preset?.length) {
      const inPreset = new Set<string>()
      for (const p of preset) {
        if (!seed.has(p.a) || !seed.has(p.b)) continue
        pairs.push({ a: p.a, b: p.b, fixed: p.legs })
        inPreset.add(p.a)
        inPreset.add(p.b)
      }
      passing = alive.filter((t) => !inPreset.has(t))
    } else if (cfg.mode === 'fixed') {
      for (let i = 0; i + 1 < alive.length; i += 2) pairs.push({ a: alive[i], b: alive[i + 1] })
      if (alive.length % 2) passing.push(alive[alive.length - 1])
    } else {
      const sorted = alive.slice().sort((x, y) => seed.get(x)! - seed.get(y)!)
      passing = sorted.slice(0, byes)
      const rest = sorted.slice(byes)
      if (cfg.mode === 'bracket') {
        for (let i = 0; i < rest.length / 2; i++) pairs.push({ a: rest[i], b: rest[rest.length - 1 - i] })
      } else {
        const sh = rng.shuffle(rest)
        for (let i = 0; i + 1 < sh.length; i += 2) {
          const [x, y] = seed.get(sh[i])! <= seed.get(sh[i + 1])! ? [sh[i], sh[i + 1]] : [sh[i + 1], sh[i]]
          pairs.push({ a: x, b: y })
        }
        if (sh.length % 2) passing.push(sh[sh.length - 1])
      }
    }
    first = false
    setTag(ctx, undefined, (cfg.prefix ?? '') + name)
    const legs = cfg.legs(size)
    const neutral = cfg.neutral?.(size) ?? false
    const stage: KnockoutStage = { name: (cfg.prefix ?? '') + name, ties: [] }
    const winners: string[] = []
    for (const p of pairs) {
      const r = playTie(ctx, rng, cfg.kind, {
        a: p.a,
        b: p.b,
        legs,
        neutral,
        extraTime: cfg.extraTime,
        seedAdvancesOnDraw: cfg.seedAdvancesOnDraw && size > 2,
        fixed: p.fixed,
        hosts: cfg.hosts,
        isFinal: size === 2 && stopAt === 1,
      })
      reached[r.loser] = name
      if (size === 2) runnerUp = r.loser
      winners.push(r.winner)
      if (size <= cfg.keepFrom || (ent && (p.a === ent || p.b === ent))) {
        stage.ties.push({ a: p.a, b: p.b, legs: r.legs, winner: r.winner })
      }
    }
    if (stage.ties.length) stages.push(stage)
    alive = cfg.mode === 'fixed' ? [...winners, ...passing] : [...passing, ...winners]
    if (!pairs.length) break
  }
  if (stopAt === 1 && alive.length === 1) reached[alive[0]] = 'Campeão'
  return { winner: alive[0] ?? '', runnerUp, stages, reached, survivors: alive }
}

/**
 * Título forçado (evento da carreira): se o time do jogador disputa a fase mas ficou fora da lista
 * de classificados, entra no lugar de `slot` (o mata-mata depois garante o resultado).
 */
export function forceInto(ctx: SeasonCtx, kind: CompetitionKind, participants: readonly string[], qualified: string[], slot: number): string[] {
  const ent = userEntity(ctx, kind)
  if (!ent || forced(ctx, kind, ent) !== 'win' || !participants.includes(ent) || qualified.includes(ent) || !qualified.length) return qualified
  const out = qualified.slice()
  out[Math.max(0, Math.min(out.length - 1, slot))] = ent
  return out
}

// ───────────────────────── grupos e fase de liga ─────────────────────────

export interface GroupOpts {
  kind: CompetitionKind
  rounds: 1 | 2
  neutral?: boolean
  hosts?: Set<string>
}

/** Fase de grupos: todos contra todos em cada grupo. Retorna as tabelas ordenadas. */
export function runGroups(
  ctx: SeasonCtx,
  rng: Rng,
  groups: { name: string; teams: string[] }[],
  o: GroupOpts,
): { name: string; table: StandingRow[] }[] {
  return groups.map((g) => {
    setTag(ctx, undefined, g.name)
    const rows = new Map(g.teams.map((t) => [t, newRow(t, g.name)] as const))
    for (const day of roundRobin(g.teams, o.rounds, rng)) {
      for (const [h, a] of day) {
        const m = play(ctx, rng, h, a, { kind: o.kind, neutral: o.neutral, hosts: o.hosts })
        addResult(rows.get(m.home)!, rows.get(m.away)!, m.score[0], m.score[1])
      }
    }
    return { name: g.name, table: sortTable([...rows.values()]) }
  })
}

/**
 * Fase de liga suíça: `matches` jogos por clube contra adversários distintos. `start` = tabela
 * real em andamento (continua do ponto atual).
 */
export function runSwiss(
  ctx: SeasonCtx,
  rng: Rng,
  teams: readonly string[],
  matches: number,
  kind: CompetitionKind,
  start?: StandingRow[],
  /** Jogos reais já sorteados (continuação): jogados primeiro, o resto é completado. */
  fixtures?: readonly import('../types').Fixture[],
): StandingRow[] {
  const rows = new Map<string, StandingRow>()
  for (const t of teams) rows.set(t, newRow(t))
  const already = new Map<string, number>()
  for (const r of start ?? []) {
    if (!rows.has(r.clubId)) continue
    rows.set(r.clubId, { ...r })
    already.set(r.clubId, r.played)
  }
  const pairs = fixtures?.length
    ? remainingSchedule([...rows.values()], fixtures, matches, rng, false)
    : swissPairings([...rows.keys()], matches, rng, already)
  setTag(ctx, undefined, 'Fase de liga')
  for (const [h, a] of pairs) {
    const m = play(ctx, rng, h, a, { kind })
    addResult(rows.get(m.home)!, rows.get(m.away)!, m.score[0], m.score[1])
  }
  return sortTable([...rows.values()])
}

/** Pots por força e sorteio de grupos de 4 (um de cada pote). */
export function drawGroups(
  rng: Rng,
  teams: readonly string[],
  groupCount: number,
  strength: (id: string) => number,
  firstPot?: readonly string[],
): { name: string; teams: string[] }[] {
  const size = Math.floor(teams.length / groupCount)
  const fixedFirst = (firstPot ?? []).filter((t) => teams.includes(t)).slice(0, groupCount)
  const rest = teams.filter((t) => !fixedFirst.includes(t)).sort((a, b) => strength(b) - strength(a))
  const ordered = [...fixedFirst, ...rest]
  const groups = Array.from({ length: groupCount }, (_, i) => ({
    name: `Grupo ${String.fromCharCode(65 + i)}`,
    teams: [] as string[],
  }))
  for (let p = 0; p < size; p++) {
    const pot = ordered.slice(p * groupCount, (p + 1) * groupCount)
    const sh = p === 0 && fixedFirst.length ? [...fixedFirst, ...rng.shuffle(pot.slice(fixedFirst.length))] : rng.shuffle(pot)
    sh.forEach((t, i) => groups[i].teams.push(t))
  }
  return groups
}

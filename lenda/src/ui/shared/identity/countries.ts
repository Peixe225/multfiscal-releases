/** Nationality list rules (Copero `vt@13781`): 24 featured countries first (Brasil first), accent-insensitive search incl. FIFA code. */
import { callUpOvr } from '@/engine/career/util'
import type { Country, Position } from '@/engine/types'
import { positionGroup } from '@/ui/primitives'

export const FEATURED = ['BRA', 'ARG', 'URU', 'COL', 'CHI', 'PER', 'ECU', 'PAR', 'BOL', 'VEN', 'MEX', 'USA', 'CAN', 'ENG', 'ESP', 'GER', 'ITA', 'FRA', 'POR', 'NED', 'BEL', 'CRO', 'TUR', 'RUS']
export const POPULAR = ['BRA', 'ARG', 'POR', 'FRA', 'ESP', 'ITA']

export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' })

export interface CountryLists {
  featured: Country[]
  others: Country[]
}

export function countryLists(all: Country[]): CountryLists {
  const byCode = new Map(all.map((c) => [c.code, c]))
  const featuredRest = FEATURED.slice(1)
    .map((c) => byCode.get(c))
    .filter((c): c is Country => !!c)
    .sort((a, b) => collator.compare(a.name, b.name))
  const bra = byCode.get('BRA')
  const featured = bra ? [bra, ...featuredRest] : featuredRest
  const set = new Set(featured.map((c) => c.code))
  const others = all.filter((c) => !set.has(c.code)).sort((a, b) => collator.compare(a.name, b.name))
  return { featured, others }
}

export function searchCountries(all: Country[], q: string): Country[] {
  const n = norm(q)
  if (!n) return []
  const scored: { c: Country; s: number }[] = []
  for (const c of all) {
    const name = norm(c.name)
    const code = c.code.toLowerCase()
    let s = -1
    if (code === n || c.iso2 === n) s = 0
    else if (name.startsWith(n)) s = 1
    else if (name.split(/[\s-]+/).some((w) => w.startsWith(n))) s = 2
    else if (code.startsWith(n)) s = 3
    else if (name.includes(n)) s = 4
    if (s >= 0) scored.push({ c, s })
  }
  return scored.sort((a, b) => a.s - b.s || collator.compare(a.c.name, b.c.name)).map((x) => x.c)
}

/** "a seleção brasileira" style phrase is hard to generate; keep it neutral. */
export const nationLine = (c: Country) => `Convocação a partir de OVR ${callUpOvr(c)} · ${c.confed}`

// ───────────────────────── positions ─────────────────────────

/** Chip placement on the vertical pitch (% of the container), from pitch-vertical.svg. */
export const PITCH_SPOTS: { pos: Position; x: number; y: number }[] = [
  { pos: 'CA', x: 50, y: 11 },
  { pos: 'PE', x: 17, y: 19 },
  { pos: 'PD', x: 83, y: 19 },
  { pos: 'MEI', x: 50, y: 31 },
  { pos: 'ME', x: 15, y: 45 },
  { pos: 'MC', x: 50, y: 46 },
  { pos: 'MD', x: 85, y: 45 },
  { pos: 'VOL', x: 50, y: 60 },
  { pos: 'LE', x: 15, y: 69 },
  { pos: 'LD', x: 85, y: 69 },
  { pos: 'ZAG', x: 50, y: 77 },
  { pos: 'GOL', x: 50, y: 91 },
]

export const FAMILY_LABEL = { atk: 'Ataque', mid: 'Meio-campo', def: 'Defesa', gk: 'Goleiro' } as const
export const FAMILY_GRAD = {
  atk: 'linear-gradient(90deg,#ff6b81,#ffb1be)',
  mid: 'linear-gradient(90deg,#3ee6a4,#b9f5da)',
  def: 'linear-gradient(90deg,#6cb2ff,#cfe5ff)',
  gk: 'linear-gradient(90deg,#ffc857,#ffe6ad)',
} as const

type RateRole = 'attacker' | 'creator' | 'support' | 'defensive' | 'goalkeeper'
const RATE_ROLE: Record<Position, RateRole> = {
  CA: 'attacker',
  PE: 'attacker',
  PD: 'attacker',
  MEI: 'creator',
  ME: 'creator',
  MD: 'creator',
  MC: 'support',
  LE: 'support',
  LD: 'support',
  VOL: 'defensive',
  ZAG: 'defensive',
  GOL: 'goalkeeper',
}
// Engine reference (career/constants.ts, band "starter at his club's level"): goals & assists per game.
const GOALS: Record<RateRole, number> = { attacker: 0.5, creator: 0.3, support: 0.05, defensive: 0.04, goalkeeper: 0 }
const ASSISTS: Record<RateRole, number> = { attacker: 0.15, creator: 0.25, support: 0.12, defensive: 0.03, goalkeeper: 0 }
const AWARD_WEIGHT = { attacking: 1, support: 0.6, defensive: 0.4, goalkeeper: 1 } as const

export interface PositionTrait {
  label: string
  value: string
  pct: number
}

const dec = (n: number) => n.toFixed(2).replace('.', ',')

/** What the position means in the simulation (real engine weights, not cosmetic numbers). */
export function positionTraits(p: Position): { traits: PositionTrait[]; note: string } {
  const r = RATE_ROLE[p]
  const w = AWARD_WEIGHT[positionGroup(p)]
  const traits: PositionTrait[] = [
    { label: 'Gols por jogo', value: dec(GOALS[r]), pct: GOALS[r] / 0.5 },
    { label: 'Assistências', value: dec(ASSISTS[r]), pct: ASSISTS[r] / 0.25 },
    { label: 'Peso nos prêmios', value: `${Math.round(w * 100)}%`, pct: w },
  ]
  const note =
    r === 'goalkeeper'
      ? 'Goleiros não marcam, mas somam jogos sem sofrer gol e disputam a Luva de Ouro.'
      : r === 'attacker'
        ? 'Média de um titular num clube do seu nível. Artilharias e Chuteira de Ouro ao alcance.'
        : r === 'creator'
          ? 'Média de um titular num clube do seu nível. Quem mais dá assistências no jogo.'
          : 'Média de um titular num clube do seu nível. Menos gols, mais regularidade.'
  return { traits, note }
}

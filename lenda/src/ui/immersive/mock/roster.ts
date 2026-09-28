/**
 * Elencos do motor de exemplo: usa o pacote real (src/data/generated/rosters.json, carregado pela
 * store) quando disponível; senão gera nomes plausíveis por nacionalidade (determinístico).
 */
import type { GameData, Position } from '@/engine/types'
import type { RostersPack } from '@/data'
import { Rng } from '@/engine/rng'
import { randomName } from '@/engine/world/names'

export interface SquadPlayer {
  name: string
  /** Nome curto para placar/lower-third ("Roque"). */
  short: string
  position: Position
  number: number
  ovr: number
}

let pack: RostersPack | null = null
const cache = new Map<string, SquadPlayer[]>()

export function setMockRosters(p: RostersPack | null) {
  pack = p
  cache.clear()
}
export const hasMockRosters = () => !!pack

const TEMPLATE: Position[] = ['GOL', 'LD', 'ZAG', 'ZAG', 'LE', 'VOL', 'MC', 'MEI', 'PD', 'CA', 'PE', 'GOL', 'ZAG', 'LE', 'MC', 'VOL', 'PE', 'CA', 'MEI', 'LD']

const shortOf = (name: string) => {
  const parts = name.trim().split(/\s+/)
  if (parts.length <= 1) return name
  const last = parts[parts.length - 1]
  // "Vitor Roque" → "Roque"; particles ("de", "da") are skipped
  return /^(de|da|do|dos|das|van|von|di|del)$/i.test(parts[parts.length - 2] ?? '') ? parts.slice(-2).join(' ') : last
}

/** Elenco de um clube (ou seleção, código FIFA de 3 letras). */
export function squadOf(data: GameData, teamId: string, seed = 'lenda'): SquadPlayer[] {
  const key = `${teamId}`
  const hit = cache.get(key)
  if (hit) return hit
  let list: SquadPlayer[] = []
  const real = pack?.clubs?.[teamId]
  if (real && real.length >= 11) {
    list = real.slice(0, 30).map((p, i) => ({ name: p.name, short: shortOf(p.name), position: p.position, number: p.number ?? i + 1, ovr: p.ovr }))
  } else {
    const club = data.clubs.find((c) => c.id === teamId)
    const nation = club ? club.country : teamId
    const country = data.countries.find((c) => c.code === nation)
    const rng = new Rng(`${seed}:squad:${teamId}`)
    const base = club?.strength ?? country?.strength ?? 65
    // national teams: real stars first
    const stars = club ? data.stars.filter((s) => s.clubId === teamId) : data.stars.filter((s) => s.nationality === teamId)
    list = stars.slice(0, 14).map((s, i) => ({ name: s.name, short: s.shortName || shortOf(s.name), position: s.position, number: i + 2, ovr: s.ovr }))
    let n = list.length
    for (const pos of TEMPLATE) {
      if (list.filter((p) => p.position === pos).length >= (pos === 'GOL' ? 2 : pos === 'ZAG' ? 3 : 2)) continue
      const nm = randomName(nation, rng)
      list.push({ name: nm.name, short: nm.shortName, position: pos, number: 1 + (n++ % 40), ovr: Math.round(base + rng.normal(0, 3)) })
    }
  }
  cache.set(key, list)
  return list
}

const NEAR: Record<Position, Position[]> = {
  GOL: ['GOL'],
  ZAG: ['ZAG', 'VOL', 'LD', 'LE'],
  LD: ['LD', 'ZAG', 'MD', 'LE'],
  LE: ['LE', 'ZAG', 'ME', 'LD'],
  VOL: ['VOL', 'MC', 'ZAG'],
  MC: ['MC', 'VOL', 'MEI'],
  ME: ['ME', 'PE', 'MC', 'LE'],
  MD: ['MD', 'PD', 'MC', 'LD'],
  MEI: ['MEI', 'MC', 'PE', 'PD'],
  PE: ['PE', 'ME', 'PD', 'CA', 'MEI'],
  PD: ['PD', 'MD', 'PE', 'CA', 'MEI'],
  CA: ['CA', 'PE', 'PD', 'MEI'],
}

/** 4-3-3: slot order used by the 2D pitch (GOL, LD, ZAG, ZAG, LE, VOL, MC, MEI, PD, CA, PE). */
export const XI_SLOTS: Position[] = ['GOL', 'LD', 'ZAG', 'ZAG', 'LE', 'VOL', 'MC', 'MEI', 'PD', 'CA', 'PE']

/** Titulares (11), com o jogador do usuário ocupando o slot da sua posição quando titular. */
export function lineupOf(squad: SquadPlayer[], userPos?: Position): (SquadPlayer | null)[] {
  const used = new Set<SquadPlayer>()
  const out: (SquadPlayer | null)[] = []
  let userSlot = -1
  if (userPos) {
    const near = NEAR[userPos]
    for (const p of near) {
      const i = XI_SLOTS.indexOf(p)
      if (i >= 0) {
        userSlot = i
        break
      }
    }
  }
  XI_SLOTS.forEach((pos, i) => {
    if (i === userSlot) {
      out.push(null)
      return
    }
    const pick = NEAR[pos]
      .flatMap((p) => squad.filter((s) => s.position === p && !used.has(s)).sort((a, b) => b.ovr - a.ovr))
      .find(Boolean) ?? squad.find((s) => !used.has(s))
    if (pick) used.add(pick)
    out.push(pick ?? null)
  })
  return out
}

export const attackersOf = (squad: SquadPlayer[]) => squad.filter((p) => ['CA', 'PE', 'PD', 'MEI'].includes(p.position))
export const keeperOf = (squad: SquadPlayer[]) => squad.filter((p) => p.position === 'GOL').sort((a, b) => b.ovr - a.ovr)[0] ?? squad[0]

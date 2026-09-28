/**
 * Local preferences for a new career: the last pace (ritmo) and the identity draft.
 * Mirrors Copero's `preferences:v1` (mode + identity, validated on read) — per browser only.
 */
import { create } from 'zustand'
import type { Foot, Pace, PlayerIdentity, Position } from '@/engine/types'

const KEY = 'lenda:prefs:v1'

export const POSITIONS: Position[] = ['CA', 'PE', 'PD', 'MEI', 'ME', 'MD', 'MC', 'VOL', 'LE', 'LD', 'ZAG', 'GOL']
export const PACES: Pace[] = ['intensa', 'normal', 'expressa']

export interface IdentityDraft {
  surname: string
  /** Kept as text while editing (validated with /^(?:[1-9]|[1-9]\d)$/). */
  number: string
  foot: Foot
  nationality: string | null
  position: Position | null
}

export const EMPTY_DRAFT: IdentityDraft = { surname: '', number: '10', foot: 'right', nationality: null, position: null }

export const PACE_INFO: Record<Pace, { label: string; seasons: number; lead: string; tail: string }> = {
  intensa: { label: 'Intensa', seasons: 1, lead: '1 decisão por temporada', tail: 'imersão profunda' },
  normal: { label: 'Normal', seasons: 2, lead: 'Decisões a cada 2 temporadas', tail: 'experiência equilibrada' },
  expressa: { label: 'Expressa', seasons: 3, lead: 'Decisões a cada 3 temporadas', tail: 'para jogar mais rápido' },
}

export const isValidNumber = (v: string) => /^(?:[1-9]|[1-9]\d)$/.test(v.trim())
export const cleanSurname = (v: string) =>
  v
    .replace(/[^\p{L}\p{M}' .-]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 15)

export function draftToIdentity(d: IdentityDraft): PlayerIdentity | null {
  if (!d.nationality || !d.position || !isValidNumber(d.number)) return null
  const surname = d.surname.trim().toUpperCase() || 'SILVA'
  return { surname: surname.slice(0, 15), number: Number(d.number), foot: d.foot, nationality: d.nationality, position: d.position }
}

interface Prefs {
  pace: Pace
  draft: IdentityDraft
  savedAt: number | null
  setPace(p: Pace): void
  patchDraft(p: Partial<IdentityDraft>): void
  resetDraft(): void
}

function read(): { pace: Pace; draft: IdentityDraft; savedAt: number | null } {
  const fallback = { pace: 'normal' as Pace, draft: { ...EMPTY_DRAFT }, savedAt: null }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return fallback
    const v = JSON.parse(raw) as Partial<{ pace: Pace; draft: Partial<IdentityDraft>; savedAt: number }>
    const pace = PACES.includes(v.pace as Pace) ? (v.pace as Pace) : 'normal'
    const d = v.draft ?? {}
    const draft: IdentityDraft = {
      surname: typeof d.surname === 'string' ? cleanSurname(d.surname) : '',
      number: typeof d.number === 'string' && (d.number === '' || /^\d{1,2}$/.test(d.number)) ? d.number : '10',
      foot: d.foot === 'left' ? 'left' : 'right',
      nationality: typeof d.nationality === 'string' ? d.nationality : null,
      position: POSITIONS.includes(d.position as Position) ? (d.position as Position) : null,
    }
    return { pace, draft, savedAt: typeof v.savedAt === 'number' ? v.savedAt : null }
  } catch {
    return fallback
  }
}

function write(p: { pace: Pace; draft: IdentityDraft; savedAt: number | null }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
    return true
  } catch {
    return false
  }
}

export const usePrefs = create<Prefs>()((set, get) => ({
  ...read(),
  setPace: (pace) => {
    set({ pace })
    write({ pace, draft: get().draft, savedAt: get().savedAt })
  },
  patchDraft: (p) => {
    const draft = { ...get().draft, ...p }
    const savedAt = Date.now()
    set({ draft, savedAt })
    write({ pace: get().pace, draft, savedAt })
  },
  resetDraft: () => {
    const draft = { ...EMPTY_DRAFT }
    set({ draft, savedAt: null })
    write({ pace: get().pace, draft, savedAt: null })
  },
}))

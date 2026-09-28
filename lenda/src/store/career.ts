/**
 * Career store (zustand) — the Clássico loop over an injectable CareerEngine, with persistence.
 *
 *   const { state, reveal, busy } = useCareer()
 *   await useCareer.getState().start(identity, 'normal')        // → academy decision pending
 *   const reveal = await useCareer.getState().choose(optionId)  // engine.choose + save + achievements + hall
 *   useCareer.getState().ackReveal()                            // reveal animation finished
 *   useCareer.getState().abandon()                              // discard current career
 *   useCareer.getState().loadFixture('mid' | 'end' | 'reveal' | 'new')   // dev / screenshots
 *
 * Persistence (IndexedDB via ./persist): current career after every start/choose, the Hall das Lendas
 * (finished careers) and unlocked achievements. `init()` restores everything on boot.
 */
import { create } from 'zustand'
import type { CareerEngine, RevealScript } from '@/engine/api'
import type { CareerState, CareerSummary, GameData, GameMode, Pace, PlayerIdentity } from '@/engine/types'
import { kv, KV_KEYS } from './persist'
import { useData } from './data'
import { resolveCareerEngine, type EngineKind } from './engine'

export interface HallEntry {
  id: string
  finishedAt: string
  identity: PlayerIdentity
  pace: Pace
  mode: GameMode
  summary: CareerSummary
  retiredReason?: string
  /** The career without the (large) world state — enough to re-open the summary screen. */
  career: Omit<CareerState, 'world'>
  engine: EngineKind
  /** Número sequencial da run no Hall das Lendas (1 = a primeira carreira encerrada). Nunca é reaproveitado. */
  runNo?: number
  /**
   * Nota de Legado congelada no dia da aposentadoria (src/engine/legacy). A nota é função só da
   * própria run, então o Hall recalcula o mesmo número; este registro serve para ordenar o corte
   * do Hall e como referência caso os pesos mudem.
   */
  legacy?: { score: number; raw: number; at: string }
}

/** Hall das Lendas: garante `runNo` em todas as entradas (as antigas ganham número pela data de término). */
export function withRunNumbers(list: HallEntry[]): HallEntry[] {
  if (list.every((h) => typeof h.runNo === 'number')) return list
  let next = Math.max(0, ...list.map((h) => h.runNo ?? 0))
  const missing = list.filter((h) => typeof h.runNo !== 'number').sort((a, b) => a.finishedAt.localeCompare(b.finishedAt))
  const assigned = new Map(missing.map((h) => [h.id, ++next]))
  return list.map((h) => (typeof h.runNo === 'number' ? h : { ...h, runNo: assigned.get(h.id) }))
}

/** Máximo de carreiras guardadas no Hall (as de menor legado saem primeiro). */
const HALL_CAP = 100

export interface AchievementUnlock {
  id: string
  unlockedAt: string
  careerId: string | null
  /** Surname + age at unlock, for the dialog ("RIBEIRO · 25 anos"). */
  context?: string
}

export type FixtureName = 'new' | 'mid' | 'end' | 'reveal'

interface CareerStore {
  /** boot status: 'idle' → 'restoring' → 'ready' */
  status: 'idle' | 'restoring' | 'ready'
  data: GameData | null
  engine: CareerEngine | null
  engineKind: EngineKind | null
  state: CareerState | null
  /** Pending reveal (set by choose, cleared by ackReveal). */
  reveal: RevealScript | null
  /** State before the last choose (the reveal animates from it). */
  previous: CareerState | null
  busy: boolean
  error: string | null
  saving: boolean
  lastSavedAt: number | null
  finishedCareers: HallEntry[]
  achievements: Record<string, AchievementUnlock>
  /** Unlocked but not yet seen in the achievements dialog (drives the top-bar dot). */
  unseenAchievements: string[]
  /** Ids unlocked by the last choose() — for toasts/celebration. */
  lastUnlocked: string[]
  /** true while showing a fixture (never persisted). */
  isFixture: boolean

  init(): Promise<void>
  start(identity: PlayerIdentity, pace: Pace, opts?: { seed?: string }): Promise<CareerState>
  choose(optionId: string): Promise<RevealScript | null>
  ackReveal(): void
  resume(): Promise<boolean>
  abandon(): Promise<void>
  saveNow(): Promise<boolean>
  summary(): CareerSummary | null
  summaryOf(state: CareerState | Omit<CareerState, 'world'>): CareerSummary | null
  /** `from` = the state the unlocks belong to (defaults to the current one; context uses its last season's age). */
  unlockAchievements(ids: string[], from?: CareerState | null): string[]
  markAchievementsSeen(): void
  removeHallEntry(id: string): Promise<void>
  loadFixture(name: FixtureName): Promise<void>
  /** Swap the engine at runtime (tests). */
  setEngine(engine: CareerEngine, kind?: EngineKind): void
}

const randomSeed = () => {
  try {
    const a = new Uint32Array(2)
    crypto.getRandomValues(a)
    return `${a[0].toString(36)}${a[1].toString(36)}`
  } catch {
    return Math.random().toString(36).slice(2, 12)
  }
}

const stripWorld = (s: CareerState): Omit<CareerState, 'world'> => {
  const { world: _w, ...rest } = s
  return rest
}

let summaryCache: { key: unknown; value: CareerSummary | null } = { key: null, value: null }

async function ensureEngine(get: () => CareerStore, set: (p: Partial<CareerStore>) => void) {
  const s = get()
  const data = s.data ?? (await useData.getState().load())
  if (s.engine && s.data) return { engine: s.engine, data }
  const { engine, kind } = await resolveCareerEngine(useData.getState().source)
  set({ engine, engineKind: kind, data })
  return { engine, data }
}

export const useCareer = create<CareerStore>()((set, get) => {
  const persistCurrent = async () => {
    const { state, isFixture } = get()
    if (isFixture) return true
    set({ saving: true })
    const ok = state ? await kv.set(KV_KEYS.current, state) : (await kv.del(KV_KEYS.current), true)
    set({ saving: false, lastSavedAt: ok ? Date.now() : get().lastSavedAt })
    return ok
  }

  const addToHall = async (state: CareerState, engine: CareerEngine, data: GameData, kind: EngineKind) => {
    if (get().finishedCareers.some((h) => h.id === state.id)) return
    let summary: CareerSummary
    try {
      summary = engine.summarize(data, state)
    } catch (err) {
      console.warn('[LENDA] summarize falhou', err)
      return
    }
    let legacy: HallEntry['legacy']
    try {
      // import dinâmico: o motor de legado (e as 50 lendas) fica fora do bundle inicial
      const { evaluateRun } = await import('@/engine/legacy')
      const run = evaluateRun({ id: state.id, identity: state.identity, seasons: state.seasons, national: state.national }, { finished: true })
      legacy = { score: run.score, raw: Math.round(run.raw * 100) / 100, at: new Date().toISOString() }
    } catch (err) {
      console.warn('[LENDA] nota de legado falhou', err)
    }
    if (get().finishedCareers.some((h) => h.id === state.id)) return
    const current = get().finishedCareers
    const entry: HallEntry = {
      runNo: Math.max(current.length, ...current.map((h) => h.runNo ?? 0)) + 1,
      id: state.id,
      finishedAt: new Date().toISOString(),
      identity: state.identity,
      pace: state.pace,
      mode: state.mode,
      summary,
      retiredReason: state.retiredReason,
      career: stripWorld(state),
      engine: kind,
      legacy,
    }
    // corte do Hall: saem as de menor Nota de Legado (a nota de uma run não depende das outras)
    const nota = (h: HallEntry) => h.legacy?.raw ?? h.summary.legacyScore
    const list = [entry, ...get().finishedCareers].sort((a, b) => nota(b) - nota(a)).slice(0, HALL_CAP)
    set({ finishedCareers: list })
    if (!get().isFixture) await kv.set(KV_KEYS.hall, list)
  }

  return {
    status: 'idle',
    data: null,
    engine: null,
    engineKind: null,
    state: null,
    reveal: null,
    previous: null,
    busy: false,
    error: null,
    saving: false,
    lastSavedAt: null,
    finishedCareers: [],
    achievements: {},
    unseenAchievements: [],
    lastUnlocked: [],
    isFixture: false,

    async init() {
      if (get().status !== 'idle') return
      set({ status: 'restoring' })
      try {
        const [current, hall, ach] = await Promise.all([
          kv.get<CareerState>(KV_KEYS.current),
          kv.get<HallEntry[]>(KV_KEYS.hall),
          kv.get<{ unlocked: Record<string, AchievementUnlock>; unseen: string[] }>(KV_KEYS.achievements),
        ])
        set({
          state: current && current.version === 1 ? current : null,
          finishedCareers: Array.isArray(hall) ? withRunNumbers(hall) : [],
          achievements: ach?.unlocked ?? {},
          unseenAchievements: ach?.unseen ?? [],
        })
      } catch (err) {
        console.warn('[LENDA] não foi possível restaurar o progresso', err)
      }
      set({ status: 'ready' })
      // warm the engine in the background
      void ensureEngine(get, set).catch(() => {})
    },

    async start(identity, pace, opts = {}) {
      set({ busy: true, error: null })
      try {
        const { engine, data } = await ensureEngine(get, set)
        const seed = opts.seed ?? randomSeed()
        const state = engine.newCareer(data, identity, pace, seed)
        set({ state, reveal: null, previous: null, isFixture: false, busy: false, lastUnlocked: [] })
        await persistCurrent()
        return state
      } catch (err) {
        set({ busy: false, error: String((err as Error)?.message ?? err) })
        throw err
      }
    },

    async choose(optionId) {
      const cur = get().state
      if (!cur || get().busy || !cur.pendingDecision) return null
      set({ busy: true, error: null })
      try {
        const { engine, data } = await ensureEngine(get, set)
        // yield a frame so the UI can show the pressed/busy state before a heavy simulation
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
        const { state, reveal } = engine.choose(data, cur, optionId)
        // the unlocks belong to the season just played (the new state), not the one before it
        const unlocked = get().unlockAchievements(reveal.achievements ?? [], state)
        set({ state, reveal, previous: cur, busy: false, lastUnlocked: unlocked })
        await persistCurrent()
        if (reveal.finished || state.phase === 'finished') await addToHall(state, engine, data, get().engineKind ?? 'mock')
        return reveal
      } catch (err) {
        console.error('[LENDA] choose falhou', err)
        set({ busy: false, error: String((err as Error)?.message ?? err) })
        return null
      }
    },

    ackReveal() {
      const s = get().state
      if (s && s.phase === 'revealing') set({ state: { ...s, phase: s.pendingDecision ? 'deciding' : 'finished' } })
      set({ reveal: null, previous: null })
    },

    async resume() {
      if (get().state) return true
      const saved = await kv.get<CareerState>(KV_KEYS.current)
      if (saved) {
        set({ state: saved, reveal: null, previous: null, isFixture: false })
        return true
      }
      return false
    },

    async abandon() {
      set({ state: null, reveal: null, previous: null, isFixture: false, lastUnlocked: [] })
      await kv.del(KV_KEYS.current)
    },

    saveNow: () => persistCurrent(),

    summary() {
      const s = get().state
      return s ? get().summaryOf(s) : null
    },

    summaryOf(state) {
      if (summaryCache.key === state) return summaryCache.value
      const { engine, data } = get()
      // engine still loading (e.g. reload on #/resumo): don't cache the miss, or the summary never shows
      if (!engine || !data) return null
      let value: CareerSummary | null = null
      try {
        value = engine.summarize(data, state as CareerState)
      } catch (err) {
        console.warn('[LENDA] summarize falhou', err)
      }
      summaryCache = { key: state, value }
      return value
    },

    unlockAchievements(ids, from) {
      if (!ids.length) return []
      const cur = get().achievements
      const s = from ?? get().state
      const fresh = ids.filter((id) => !cur[id])
      if (!fresh.length) return []
      const now = new Date().toISOString()
      const next = { ...cur }
      for (const id of fresh) next[id] = { id, unlockedAt: now, careerId: s?.id ?? null, context: s ? `${s.identity.surname} · ${s.seasons.at(-1)?.age ?? s.age} anos` : undefined }
      const unseen = [...new Set([...get().unseenAchievements, ...fresh])]
      set({ achievements: next, unseenAchievements: unseen })
      if (!get().isFixture) void kv.set(KV_KEYS.achievements, { unlocked: next, unseen })
      return fresh
    },

    markAchievementsSeen() {
      if (!get().unseenAchievements.length) return
      set({ unseenAchievements: [] })
      if (!get().isFixture) void kv.set(KV_KEYS.achievements, { unlocked: get().achievements, unseen: [] })
    },

    async removeHallEntry(id) {
      const list = get().finishedCareers.filter((h) => h.id !== id)
      set({ finishedCareers: list })
      await kv.set(KV_KEYS.hall, list)
    },

    async loadFixture(name) {
      const { data } = await ensureEngine(get, set)
      const fx = await import('@/ui/classic/mock/fixtures')
      if (name === 'reveal') {
        const { before, state, reveal } = fx.sampleReveal(data)
        set({ state, reveal, previous: before, isFixture: true, busy: false })
        return
      }
      const state = name === 'new' ? fx.careerNew(data) : name === 'mid' ? fx.careerMid(data) : fx.careerEnd(data)
      set({ state, reveal: null, previous: null, isFixture: true, busy: false })
    },

    setEngine(engine, kind = 'custom') {
      set({ engine, engineKind: kind })
    },
  }
})

// ── selectors ──
export const selectHasActiveCareer = (s: CareerStore) => !!s.state && s.state.phase !== 'finished' && !s.state.retired
export const selectCurrentClubId = (s: CareerStore) => s.state?.clubId ?? null
export const selectPending = (s: CareerStore) => s.state?.pendingDecision ?? null
/** Decision counter "Decisão 7 de 12" (estimate from pace: 24 seasons of career). */
export function decisionProgress(s: CareerState | null): { index: number; total: number; seasonsDone: number; seasonsTotal: number } {
  if (!s) return { index: 0, total: 0, seasonsDone: 0, seasonsTotal: 24 }
  const per = s.pace === 'intensa' ? 1 : s.pace === 'expressa' ? 3 : 2
  const seasonsDone = s.seasons.length
  const seasonsTotal = 24
  return { index: s.period + 1, total: Math.ceil(seasonsTotal / per), seasonsDone, seasonsTotal }
}

/**
 * Modo Imersivo — store (zustand) sobre um ImmersiveEngine injetável, com persistência.
 *
 *   const { state, busy } = useImmersive()
 *   await useImmersive.getState().start(identity)              // nova carreira imersiva
 *   await useImmersive.getState().dispatch({ type: 'advance' }) // → efeitos na fila
 *   useImmersive.getState().abandon()
 *   useImmersive.getState().loadFixture('lance')               // dev / screenshots (#/imersivo?fixture=lance)
 *
 * Efeitos: cada dispatch empurra os efeitos do motor para `effects` (numerados por `seq`). Os
 * consumidores (toasts, placar, estádio…) guardam o último `seq` visto — ver `useEffectStream`.
 *
 * Motor: ordem = setImmersiveEngine() › flag (?engine=mock|real, localStorage "lenda:engine",
 * ajustes) › motor real (src/engine/immersive/index.ts exportando `immersiveEngine`,
 * `createImmersiveEngine(world?)` ou default) › motor de exemplo (src/ui/immersive/mock).
 * Cada carreira salva lembra o motor que a criou (a memória opaca `state.engine` não é portável).
 *
 * Persistência (IndexedDB via ./persist): chave "immersive:current" após cada ação (na partida: na
 * troca de fase e no máximo a cada 6 s). Aposentadoria → a run entra no Hall das Lendas.
 */
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import type { WorldEngine } from '@/engine/api'
import type { ImmersiveAction, ImmersiveEffect, ImmersiveEngine, ImmersiveState, LiveMatch } from '@/engine/immersive/types'
import type { GameData, PlayerIdentity } from '@/engine/types'
import { kv, KV_KEYS } from './persist'
import { useData } from './data'
import { engineFlag } from './engine'
import { useCareer, withRunNumbers, type HallEntry } from './career'

export type ImmersiveEngineKind = 'real' | 'mock' | 'custom'

export const IMMERSIVE_KEY = 'immersive:current'

// Defensivo: {} até o time do motor publicar o módulo.
const immersiveModules = import.meta.glob('../engine/immersive/index.ts')
const worldModules = import.meta.glob('../engine/world/index.ts')

export const hasRealImmersiveEngine = () => !!immersiveModules['../engine/immersive/index.ts']

let injected: { engine: ImmersiveEngine; kind: ImmersiveEngineKind } | null = null

/** Catálogos que o motor real pode publicar (modelos de post, itens de estilo de vida). */
export interface EngineCatalog {
  postTemplates?: { id: string; label: string; text: string; tone: 'positive' | 'negative' | 'neutral'; hint: string; when?: string[] }[]
  lifestyleItems?: readonly { id: string; name: string; price: number; morale: number }[]
}

/** Chances de uma contraproposta (mesma conta do motor): aceite, melhora, desistência; teto do clube. */
export interface CounterOdds {
  accept: number
  improve: number
  walk: number
  ceiling: number
  roundsLeft: number
}
const catalogs: Partial<Record<'real' | 'mock', EngineCatalog>> = {}
const cache: Partial<Record<'real' | 'mock', Promise<ImmersiveEngine | null>>> = {}

/** Injeta um motor (testes). null = volta à resolução automática. */
export function setImmersiveEngine(engine: ImmersiveEngine | null, kind: ImmersiveEngineKind = 'custom') {
  injected = engine ? { engine, kind } : null
}

const isEngine = (x: unknown): x is ImmersiveEngine => !!x && typeof (x as ImmersiveEngine).dispatch === 'function' && typeof (x as ImmersiveEngine).newCareer === 'function'

async function loadReal(): Promise<ImmersiveEngine | null> {
  const load = immersiveModules['../engine/immersive/index.ts']
  if (!load) return null
  const mod = (await load()) as Record<string, unknown>
  catalogs.real = {
    postTemplates: Array.isArray(mod.POST_TEMPLATES) ? (mod.POST_TEMPLATES as EngineCatalog['postTemplates']) : undefined,
    lifestyleItems: Array.isArray(mod.LIFESTYLE_ITEMS) ? (mod.LIFESTYLE_ITEMS as EngineCatalog['lifestyleItems']) : undefined,
  }
  if (isEngine(mod.immersiveEngine)) return mod.immersiveEngine
  if (typeof mod.createImmersiveEngine === 'function') {
    const factory = mod.createImmersiveEngine as (world?: WorldEngine) => ImmersiveEngine
    let world: WorldEngine | undefined
    if (factory.length > 0) {
      const wl = worldModules['../engine/world/index.ts']
      if (wl) {
        const wm = (await wl()) as Record<string, unknown>
        world = (wm.worldEngine as WorldEngine) ?? (typeof wm.createWorldEngine === 'function' ? (wm.createWorldEngine as () => WorldEngine)() : undefined)
      }
      if (!world) {
        console.info('[LENDA] motor imersivo pronto, mas o motor do mundo ainda não — usando o motor de exemplo.')
        return null
      }
    }
    const e = factory(world)
    return isEngine(e) ? e : null
  }
  if (isEngine(mod.default)) return mod.default
  return null
}

async function loadMock(): Promise<ImmersiveEngine> {
  const [{ mockImmersive }, roster] = await Promise.all([import('@/ui/immersive/mock/mockImmersive'), import('@/ui/immersive/mock/roster')])
  // elencos reais (quando o pacote existe) deixam a narração com nomes de verdade
  if (!roster.hasMockRosters()) {
    try {
      const dataMod = import.meta.glob('../data/index.ts')['../data/index.ts']
      if (dataMod) {
        const m = (await dataMod()) as { loadRosters?: () => Promise<Parameters<typeof roster.setMockRosters>[0]> }
        if (m.loadRosters) roster.setMockRosters(await m.loadRosters())
      }
    } catch (err) {
      console.info('[LENDA] elencos reais indisponíveis — nomes gerados.', err)
    }
  }
  return mockImmersive
}

function engineOf(kind: 'real' | 'mock'): Promise<ImmersiveEngine | null> {
  cache[kind] ??= (kind === 'real' ? loadReal() : loadMock()).catch((err) => {
    console.warn(`[LENDA] motor imersivo (${kind}) falhou ao carregar`, err)
    delete cache[kind]
    return null
  })
  return cache[kind]!
}

/** Resolve o motor: `prefer` (motor que criou a carreira salva) › flag › real › mock. */
export async function resolveImmersiveEngine(prefer?: ImmersiveEngineKind | null): Promise<{ engine: ImmersiveEngine; kind: ImmersiveEngineKind }> {
  if (injected) return injected
  const flag = engineFlag()
  const source = useData.getState().source
  const wantReal = prefer === 'real' || (prefer == null && (flag === 'real' || (flag === 'auto' && source !== 'mock' && hasRealImmersiveEngine())))
  if (prefer !== 'mock' && wantReal) {
    const real = await engineOf('real')
    if (real) return { engine: real, kind: 'real' }
  }
  const mock = await engineOf('mock')
  if (!mock) throw new Error('Nenhum motor imersivo disponível.')
  return { engine: mock, kind: 'mock' }
}

// ───────────────────────────── store ─────────────────────────────

export interface QueuedEffect {
  seq: number
  effect: ImmersiveEffect
  /** Ação que gerou o efeito. */
  action: ImmersiveAction['type'] | 'start' | 'fixture'
}

interface Saved {
  kind: ImmersiveEngineKind
  state: ImmersiveState
  savedAt: string
}

interface ImmersiveStore {
  status: 'idle' | 'restoring' | 'ready'
  data: GameData | null
  engine: ImmersiveEngine | null
  engineKind: ImmersiveEngineKind | null
  /** Catálogos do motor ativo (vazio = constantes da UI). */
  catalog: EngineCatalog
  state: ImmersiveState | null
  /** Estado antes da última ação (animações "de → para"). */
  previous: ImmersiveState | null
  /** Última partida encerrada (placar/estatísticas para a Central e o post pós-jogo). */
  lastMatch: LiveMatch | null
  effects: QueuedEffect[]
  seq: number
  busy: boolean
  error: string | null
  saving: boolean
  /** Última gravação falhou (IndexedDB/localStorage cheio ou bloqueado). */
  saveFailed: boolean
  isFixture: boolean
  fixture: string | null
  /** Estado de exemplo que não chegou onde devia (mostrado na tela, em vez de outra tela em silêncio). */
  fixtureWarning: string | null

  init(): Promise<void>
  start(identity: PlayerIdentity, opts?: { seed?: string }): Promise<ImmersiveState>
  dispatch(action: ImmersiveAction): Promise<ImmersiveEffect[]>
  abandon(): Promise<void>
  saveNow(): Promise<boolean>
  /** Chances da contraproposta pelo motor (null = o motor não calcula; a UI usa a mesma conta). */
  counterOdds(offerId: string, counter: { salary?: number; years?: number; role?: 'Titular' | 'Rotação' | 'Reserva' | 'Promessa' }): CounterOdds | null
  loadFixture(name: string, opts?: { club?: string }): Promise<void>
  /** Troca o motor em tempo de execução (testes). */
  setEngine(engine: ImmersiveEngine, kind?: ImmersiveEngineKind): void
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

const MAX_EFFECTS = 80

export const useImmersive = create<ImmersiveStore>()((set, get) => {
  const ensure = async (prefer?: ImmersiveEngineKind | null) => {
    const s = get()
    const data = s.data ?? (await useData.getState().load())
    if (s.engine && s.data && (prefer == null || prefer === s.engineKind)) return { engine: s.engine, data, kind: s.engineKind ?? 'mock' }
    const { engine, kind } = await resolveImmersiveEngine(prefer)
    set({ engine, engineKind: kind, data, catalog: (kind !== 'custom' && catalogs[kind]) || {} })
    return { engine, data, kind }
  }

  const persist = async () => {
    if (pending) {
      clearTimeout(pending)
      pending = 0
    }
    const { state, isFixture, engineKind } = get()
    if (isFixture) return true
    set({ saving: true })
    let ok = false
    try {
      ok = state ? await kv.set(IMMERSIVE_KEY, { kind: engineKind ?? 'mock', state, savedAt: new Date().toISOString() } satisfies Saved) : (await kv.del(IMMERSIVE_KEY), true)
    } catch (err) {
      console.warn('[LENDA] falha ao salvar a carreira imersiva', err)
    }
    set({ saving: false, saveFailed: !ok })
    return ok
  }
  /**
   * Durante a partida o estado muda a cada lance: grava na troca de fase (intervalo, fim) e, no
   * meio de um tempo, no máximo a cada 6 s. Fora da partida grava a cada ação.
   */
  let pending = 0
  const phaseKey = (x: ImmersiveState | null) => (x?.live ? `${x.live.itemId}:${x.live.phase}:${x.live.pendingMoment ? 1 : 0}` : `-:${x?.cursor ?? 0}`)
  const schedulePersist = (before: ImmersiveState | null, after: ImmersiveState | null) => {
    if (after?.live && before?.live && phaseKey(before) === phaseKey(after)) {
      if (!pending) pending = window.setTimeout(() => void persist(), 6000)
      return
    }
    void persist()
  }
  if (typeof window !== 'undefined') {
    const flush = () => {
      if (pending) void persist()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())
  }

  /** Aposentadoria: a run imersiva entra no Hall das Lendas (quando o motor sabe resumir). */
  const addToHall = async (state: ImmersiveState, engine: ImmersiveEngine, data: GameData, kind: ImmersiveEngineKind) => {
    if (!engine.summarize || get().isFixture) return
    try {
      const hall = useCareer.getState().finishedCareers
      if (hall.some((h) => h.id === state.id)) return
      const summary = engine.summarize(data, state)
      let legacy: HallEntry['legacy']
      try {
        const { evaluateRun } = await import('@/engine/legacy')
        const run = evaluateRun({ id: state.id, identity: state.identity, seasons: state.seasons, national: state.national }, { finished: true })
        legacy = { score: run.score, raw: Math.round(run.raw * 100) / 100, at: new Date().toISOString() }
      } catch (err) {
        console.warn('[LENDA] nota de legado (imersivo) falhou', err)
      }
      const career = {
        version: 1,
        id: state.id,
        mode: 'immersive',
        pace: 'intensa',
        seed: state.seed,
        identity: state.identity,
        createdAt: state.createdAt,
        age: state.age,
        ovr: state.ovr,
        clubId: state.clubId,
        seasons: state.seasons,
        national: state.national,
        trophies: state.trophies,
        awards: state.awards,
        log: state.log,
        retired: true,
        retiredReason: state.retiredReason,
        phase: 'finished',
      } as unknown as HallEntry['career']
      const entry: HallEntry = {
        runNo: Math.max(hall.length, ...hall.map((h) => h.runNo ?? 0)) + 1,
        id: state.id,
        finishedAt: new Date().toISOString(),
        identity: state.identity,
        pace: 'intensa',
        mode: 'immersive',
        summary,
        retiredReason: state.retiredReason,
        career,
        engine: kind === 'real' ? 'real' : 'mock',
        legacy,
      }
      const nota = (h: HallEntry) => h.legacy?.raw ?? h.summary.legacyScore
      const list = withRunNumbers([entry, ...hall].sort((a, b) => nota(b) - nota(a)).slice(0, 100))
      useCareer.setState({ finishedCareers: list })
      await kv.set(KV_KEYS.hall, list)
    } catch (err) {
      console.warn('[LENDA] não foi possível registrar a carreira imersiva no Hall', err)
    }
  }

  const push = (effects: ImmersiveEffect[], action: QueuedEffect['action']) => {
    if (!effects.length) return
    let seq = get().seq
    const queued = effects.map((effect) => ({ seq: ++seq, effect, action }))
    set({ effects: [...get().effects, ...queued].slice(-MAX_EFFECTS), seq })
  }

  let chain: Promise<unknown> = Promise.resolve()

  return {
    status: 'idle',
    data: null,
    engine: null,
    engineKind: null,
    catalog: {},
    state: null,
    previous: null,
    lastMatch: null,
    effects: [],
    seq: 0,
    busy: false,
    error: null,
    saving: false,
    saveFailed: false,
    isFixture: false,
    fixture: null,
    fixtureWarning: null,

    async init() {
      if (get().status !== 'idle') return
      set({ status: 'restoring' })
      try {
        const saved = await kv.get<Saved>(IMMERSIVE_KEY)
        if (saved?.state?.mode === 'immersive' && !get().isFixture) {
          set({ state: saved.state })
          await ensure(saved.kind === 'custom' ? null : saved.kind)
        }
      } catch (err) {
        console.warn('[LENDA] não foi possível restaurar a carreira imersiva', err)
      }
      set({ status: 'ready' })
      void ensure().catch(() => {})
    },

    async start(identity, opts = {}) {
      set({ busy: true, error: null })
      // a Central já vai carregando enquanto o motor monta a carreira
      void import('@/ui/immersive/ImmersiveApp').catch(() => {})
      void import('@/ui/immersive/hub/HubScreen').catch(() => {})
      try {
        const { engine, data } = await ensure(null)
        const seed = opts.seed ?? randomSeed()
        const state = engine.newCareer(data, identity, seed)
        set({ state, previous: null, lastMatch: null, isFixture: false, fixture: null, fixtureWarning: null, busy: false, effects: [] })
        await persist()
        return state
      } catch (err) {
        set({ busy: false, error: String((err as Error)?.message ?? err) })
        throw err
      }
    },

    dispatch(action) {
      // ações em série: um clique duplo nunca aplica duas vezes sobre o mesmo estado
      const run = async (): Promise<ImmersiveEffect[]> => {
        const cur = get().state
        if (!cur) return []
        set({ busy: true, error: null })
        try {
          const { engine, data, kind } = await ensure()
          const { state, effects } = engine.dispatch(data, cur, action)
          const endedMatch = cur.live && !state.live ? cur.live : null
          set({ state, previous: cur, busy: false, ...(endedMatch ? { lastMatch: endedMatch } : {}) })
          push(effects, action.type)
          schedulePersist(cur, state)
          if (state.retired && !cur.retired) void addToHall(state, engine, data, kind)
          return effects
        } catch (err) {
          console.error('[LENDA] dispatch imersivo falhou', action, err)
          set({ busy: false, error: String((err as Error)?.message ?? err) })
          return []
        }
      }
      const p = chain.then(run, run)
      chain = p.catch(() => {})
      return p
    },

    async abandon() {
      set({ state: null, previous: null, lastMatch: null, effects: [], isFixture: false, fixture: null })
      await kv.del(IMMERSIVE_KEY)
    },

    saveNow: () => persist(),

    counterOdds(offerId, counter) {
      const { engine, data, state } = get()
      if (!engine || !data || !state) return null
      try {
        return engine.acceptChance ? engine.acceptChance(data, state, offerId, counter) : null
      } catch {
        return null
      }
    },

    async loadFixture(name, opts = {}) {
      const { engine, data } = await ensure()
      const mod = await import('@/ui/immersive/fixtures')
      const { state, lastMatch, effects, warning } = mod.buildFixture(engine, data, name, opts)
      if (warning) console.warn('[LENDA]', warning)
      set({ state, previous: null, lastMatch: lastMatch ?? null, isFixture: true, fixture: opts.club ? `${name}@${opts.club}` : name, fixtureWarning: warning ?? null, busy: false, effects: [] })
      push(effects ?? [], 'fixture')
    },

    setEngine(engine, kind = 'custom') {
      set({ engine, engineKind: kind })
    },
  }
})

// ───────────────────────────── seletores / hooks ─────────────────────────────

export const selectHasImmersiveCareer = (s: ImmersiveStore) => !!s.state && !s.state.retired && !s.isFixture

/** Estado salvo (sem carregar o motor) — para a landing mostrar "Continuar". */
export async function peekSavedImmersive(): Promise<ImmersiveState | null> {
  const saved = await kv.get<Saved>(IMMERSIVE_KEY)
  return saved?.state?.mode === 'immersive' ? saved.state : null
}

/**
 * Consome a fila de efeitos a partir da montagem: `handler` recebe cada efeito novo uma vez.
 * `fromStart` = também os que já estavam na fila (ex.: tela aberta logo após o dispatch).
 */
export function useEffectStream(handler: (e: ImmersiveEffect, q: QueuedEffect) => void, opts: { fromStart?: boolean; enabled?: boolean } = {}) {
  const last = useRef<number | null>(null)
  const ref = useRef(handler)
  ref.current = handler
  const enabled = opts.enabled ?? true
  useEffect(() => {
    if (last.current == null) last.current = opts.fromStart ? 0 : useImmersive.getState().seq
    const flush = (list: QueuedEffect[]) => {
      if (!enabled) return
      for (const q of list) {
        if (q.seq <= (last.current ?? 0)) continue
        last.current = q.seq
        ref.current(q.effect, q)
      }
    }
    flush(useImmersive.getState().effects)
    return useImmersive.subscribe((s, p) => {
      if (s.effects !== p.effects) flush(s.effects)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
}

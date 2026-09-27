/**
 * Career engine resolution (injectable).
 *
 * Order: explicit setCareerEngine() › flag › real engine (src/engine/career, if it exists and the
 * real data pack is loaded) › mock engine (src/ui/classic/mock).
 * Flag: ?engine=mock|real in the URL (or inside the hash query), localStorage "lenda:engine",
 * VITE_LENDA_ENGINE, or settings.engine ('auto' default).
 */
import type { CareerEngine, WorldEngine } from '@/engine/api'
import type { DataSource } from './data'
import { useApp } from './app'

export type EngineKind = 'real' | 'mock' | 'custom'

// Defensive globs: {} until the engine teams ship their modules.
const careerModules = import.meta.glob('../engine/career/index.ts')
const worldModules = import.meta.glob('../engine/world/index.ts')

let injected: { engine: CareerEngine; kind: EngineKind } | null = null
let resolved: Promise<{ engine: CareerEngine; kind: EngineKind }> | null = null

/** Inject an engine (tests, storybook-like previews). Pass null to reset. */
export function setCareerEngine(engine: CareerEngine | null, kind: EngineKind = 'custom') {
  injected = engine ? { engine, kind } : null
  resolved = null
}

export function engineFlag(): 'auto' | 'mock' | 'real' {
  try {
    const q = new URLSearchParams(location.search).get('engine') ?? new URLSearchParams(location.hash.split('?')[1] ?? '').get('engine')
    if (q === 'mock' || q === 'real') return q
    const ls = localStorage.getItem('lenda:engine')
    if (ls === 'mock' || ls === 'real') return ls
  } catch {
    /* ignore */
  }
  const env = import.meta.env.VITE_LENDA_ENGINE as string | undefined
  if (env === 'mock' || env === 'real') return env
  return useApp.getState().settings.engine
}

export const hasRealEngine = () => !!careerModules['../engine/career/index.ts']

async function loadReal(): Promise<CareerEngine | null> {
  const load = careerModules['../engine/career/index.ts']
  if (!load) return null
  const mod = (await load()) as Record<string, unknown>
  if (mod.careerEngine && typeof (mod.careerEngine as CareerEngine).choose === 'function') return mod.careerEngine as CareerEngine
  if (typeof mod.createCareerEngine === 'function') {
    let world: WorldEngine | undefined
    const wl = worldModules['../engine/world/index.ts']
    if (wl) {
      const wm = (await wl()) as Record<string, unknown>
      world = (wm.worldEngine as WorldEngine) ?? (typeof wm.createWorldEngine === 'function' ? (wm.createWorldEngine as () => WorldEngine)() : undefined)
    }
    return (mod.createCareerEngine as (w?: WorldEngine) => CareerEngine)(world)
  }
  if (mod.default && typeof (mod.default as CareerEngine).choose === 'function') return mod.default as CareerEngine
  return null
}

export function resolveCareerEngine(dataSource: DataSource | null): Promise<{ engine: CareerEngine; kind: EngineKind }> {
  if (injected) return Promise.resolve(injected)
  if (resolved) return resolved
  resolved = (async () => {
    const flag = engineFlag()
    const wantReal = flag === 'real' || (flag === 'auto' && dataSource === 'real')
    if (wantReal) {
      try {
        const real = await loadReal()
        if (real) return { engine: real, kind: 'real' as const }
      } catch (err) {
        console.warn('[LENDA] motor real indisponível — usando o motor de exemplo.', err)
      }
    }
    const { mockEngine } = await import('@/ui/classic/mock/mockEngine')
    return { engine: mockEngine, kind: 'mock' as const }
  })()
  return resolved
}

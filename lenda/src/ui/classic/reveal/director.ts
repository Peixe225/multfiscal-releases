/**
 * Reveal director — turns a RevealScript into a timed sequence on the shared reveal store.
 *
 *   director.pick(optionId)        user choice → engine.choose (the hook below starts the run)
 *   director.skip()                "Pular" / Space — jump to the end state
 *   director.dismissCelebration()  close the trophy overlay and resume the timeline
 *   useRevealDirector()            mount ONCE in the cockpit: watches useCareer().reveal
 */
import { useEffect } from 'react'
import type { RevealScript } from '@/engine/api'
import { useApp, selectReducedMotion } from '@/store/app'
import { useCareer } from '@/store/career'
import { toast } from '@/ui/primitives'
import { sfx } from '@/ui/shell/sfx'
import { achievementById } from '@/ui/shell/achievementsRegistry'
import { celebrationItems } from '@/ui/classic/celebration/items'
import { PENALTY_TOTAL, PHASE_AT, ROULETTE, useReveal, type Side } from './store'

let timers: ReturnType<typeof setTimeout>[] = []
let token = 0
let resume: (() => void) | null = null
let current: RevealScript | null = null
let wonNames: string[] = []

const clear = () => {
  timers.forEach(clearTimeout)
  timers = []
}
const at = (ms: number, fn: () => void, t = token) => {
  timers.push(
    setTimeout(() => {
      if (t === token) fn()
    }, Math.max(0, ms)),
  )
}
const R = () => useReveal.getState()

function env() {
  const app = useApp.getState()
  const rm = selectReducedMotion(app)
  return { skip: app.settings.skipAnimations, rm, instant: app.settings.skipAnimations || rm }
}

/** Options whose outcome is a gamble (≥ 2 chips with p < 1) spin the roulette. */
export function rouletteIndexes(effects: { probability?: number }[]): number[] {
  return effects.map((e, i) => (e.probability != null && e.probability > 0 && e.probability < 1 ? i : -1)).filter((i) => i >= 0)
}

function finish() {
  clear()
  resume = null
  const c = useCareer.getState()
  const unlocked = c.lastUnlocked
  const rev = current
  current = null
  c.ackReveal()
  R().set({
    phase: 'idle',
    chosenId: null,
    decision: null,
    spinIdx: null,
    settled: false,
    outcome: 'none',
    celebration: null,
    celebrationOpen: false,
    penaltySide: null,
    focusIdx: null,
    sheetCollapsed: false,
  })
  // achievement toasts come from src/ui/shared/achievements/unlockToasts (single source)
  if (rev?.finished) sfx.play('whistle')
}

function continueAfterTrophies(delay = 0) {
  const t = token
  const { instant } = env()
  if (instant) {
    R().set({ phase: 'complete' })
    at(0, finish, t)
    return
  }
  const base = delay
  at(base + (PHASE_AT.overall - PHASE_AT.trophies), () => R().set({ phase: 'overall' }), t)
  at(base + (PHASE_AT.postOverall - PHASE_AT.trophies), () => R().set({ phase: 'postOverall' }), t)
  at(base + (PHASE_AT.complete - PHASE_AT.trophies), () => {
    R().set({ phase: 'complete' })
    finish()
  }, t)
}

function reachTrophies() {
  const items = R().celebration
  const { skip } = env()
  if (items?.length && !skip) {
    R().set({ phase: 'celebrating', celebrationOpen: true })
    sfx.play(items[0].kind === 'relegation' ? 'relegation' : 'trophy')
    resume = () => continueAfterTrophies(120)
    return
  }
  if (items?.length && skip) announceTrophies()
  R().set({ phase: 'trophies' })
  continueAfterTrophies(0)
}

/** Aviso único (substitui o anterior) quando a celebração foi pulada. */
let lastTrophyToast: string | null = null
function announceTrophies() {
  const items = R().celebration ?? []
  if (!items.length) return
  if (lastTrophyToast) toast.dismiss(lastTrophyToast)
  const names = [...new Set(items.map((i) => i.name))].join(' · ')
  lastTrophyToast =
    items[0].kind === 'relegation'
      ? (toast.error('Rebaixamento', items[0].subtitle) as unknown as string)
      : (toast.gold(items.length > 1 ? `${items.length} títulos` : 'Título!', names, { duration: 3200 }) as unknown as string)
}

export const director = {
  /** User choice. Freezes the decision, shows the pressed state, runs the engine. */
  async pick(optionId: string, opts: { side?: Side } = {}) {
    const c = useCareer.getState()
    if (c.busy || R().phase !== 'idle' || !c.state?.pendingDecision) return
    const decision = c.state.pendingDecision
    if (!decision.options.some((o) => o.id === optionId)) return
    R().set({ phase: 'choosing', chosenId: optionId, decision, penaltySide: opts.side ?? null, focusIdx: null, spinIdx: null, settled: false })
    sfx.play('click')
    const reveal = await useCareer.getState().choose(optionId)
    if (!reveal) {
      R().set({ phase: 'idle', chosenId: null, decision: null, penaltySide: null })
      toast.error('Algo deu errado', 'Não foi possível simular a temporada. Tente de novo.')
    }
  },

  /** Start the timeline for a reveal (idempotent per reveal object). */
  start(reveal: RevealScript) {
    if (current === reveal) return
    clear()
    token++
    current = reveal
    resume = null
    const c = useCareer.getState()
    const st = R()
    const decision = st.decision ?? c.previous?.pendingDecision ?? null
    const option = decision?.options.find((o) => o.id === reveal.optionId)
    const spinIdx = option ? rouletteIndexes(option.effects) : []
    const hasPenalty = !!reveal.penalty && option?.minigame === 'penalty'
    const hasRoulette = !hasPenalty && reveal.rolledEffect != null && spinIdx.length >= 2
    const items = celebrationItems(reveal, c.previous, c.state)
    wonNames = items.map((i) => i.name)
    const outcome = hasPenalty ? 'penalty' : hasRoulette ? 'roulette' : 'none'
    const { instant } = env()
    R().set({
      runId: st.runId + 1,
      decision,
      chosenId: reveal.optionId,
      outcome,
      celebration: items.length ? items : null,
      celebrationOpen: false,
      spinIdx: hasRoulette ? null : (reveal.rolledEffect ?? null),
      settled: !hasRoulette,
      sheetCollapsed: true,
    })
    const t = token
    if (instant) {
      R().set({ phase: 'stats', spinIdx: reveal.rolledEffect ?? null, settled: true })
      at(0, reachTrophies, t)
      return
    }
    // no seasons (retirement): short farewell beat, then commit
    if (!reveal.seasons.length) {
      R().set({ phase: 'metrics' })
      at(650, () => {
        R().set({ phase: 'complete' })
        finish()
      }, t)
      return
    }
    let y = 0
    if (hasRoulette) {
      R().set({ phase: 'outcome' })
      const steps = Math.ceil(ROULETTE.spin / ROULETTE.flip)
      for (let k = 0; k < steps; k++)
        at(k * ROULETTE.flip, () => {
          R().set({ spinIdx: spinIdx[k % spinIdx.length] })
          sfx.tick()
        }, t)
      at(ROULETTE.spin, () => {
        R().set({ spinIdx: reveal.rolledEffect ?? spinIdx[0], settled: true })
        const k = option?.effects[reveal.rolledEffect ?? 0]?.kind
        sfx.play(k === 'negative' ? 'miss' : 'reveal')
      }, t)
      y = ROULETTE.total
    } else if (hasPenalty) {
      R().set({ phase: 'outcome' })
      y = PENALTY_TOTAL
    } else {
      R().set({ phase: 'metrics' })
      y = 240 // let the chosen card settle before the table fills
    }
    at(y + PHASE_AT.metrics, () => R().set({ phase: 'metrics' }), t)
    at(y + PHASE_AT.identity, () => {
      R().set({ phase: 'identity' })
      sfx.play('whoosh')
    }, t)
    at(y + PHASE_AT.history, () => R().set({ phase: 'history' }), t)
    at(y + PHASE_AT.stats, () => R().set({ phase: 'stats' }), t)
    at(y + PHASE_AT.trophies, reachTrophies, t)
  },

  /** Skip to the end state (Space / "Pular"). */
  skip() {
    const ph = R().phase
    if (ph === 'idle' || ph === 'choosing') return
    if (R().celebrationOpen) {
      director.dismissCelebration()
      return
    }
    const rev = current
    if (rev && !R().celebrationOpen && ['outcome', 'metrics', 'identity', 'history', 'stats'].includes(ph) && wonNames.length) announceTrophies()
    R().set({ phase: 'complete', settled: true, spinIdx: rev?.rolledEffect ?? R().spinIdx })
    finish()
  },

  dismissCelebration() {
    if (!R().celebrationOpen) return
    R().set({ celebrationOpen: false })
    const r = resume
    resume = null
    if (r) r()
    else continueAfterTrophies(120)
  },

  /** Unmount / abandon: stop everything without committing. */
  reset() {
    clear()
    token++
    resume = null
    current = null
    R().set({ phase: 'idle', chosenId: null, decision: null, spinIdx: null, settled: false, outcome: 'none', celebration: null, celebrationOpen: false, penaltySide: null, focusIdx: null })
  },
}

/** Mount once in the cockpit. Starts a run whenever the career store publishes a reveal. */
export function useRevealDirector() {
  const reveal = useCareer((s) => s.reveal)
  useEffect(() => {
    if (reveal) director.start(reveal)
  }, [reveal])
  useEffect(
    () => () => {
      // leaving the screen mid-reveal: commit silently so the next visit starts clean
      if (current && useCareer.getState().reveal) useCareer.getState().ackReveal()
      director.reset()
    },
    [],
  )
}

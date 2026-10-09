/**
 * Replay da partida: o motor devolve de uma vez os eventos até o próximo lance-chave; a UI os
 * "transmite" no relógio (1× ≈ 0,38 s por minuto, 2×, instantâneo), segurando nos gols.
 * Estado fora do React para o relógio andar a 60 fps sem re-renderizar a tela inteira.
 */
import { useEffect, useLayoutEffect, useRef } from 'react'
import { create } from 'zustand'
import type { LiveMatch, MatchEvent } from '@/engine/immersive/types'
import { useImmersive } from '@/store/immersive'

export type Speed = 1 | 2 | 4 | 0

export const MS_PER_MIN: Record<Speed, number> = { 1: 380, 2: 150, 4: 70, 0: 0 }

interface PB {
  itemId: string | null
  /** Eventos já exibidos (índice em live.events). */
  shown: number
  /** Minuto exibido (fracionário). */
  clock: number
  /** Tudo exibido e relógio no minuto do motor. */
  settled: boolean
  /** Pausa restante (ms) — gol, cartão. */
  hold: number
  speed: Speed
  /** Último evento revelado + contador (para efeitos). */
  last: MatchEvent | null
  revealSeq: number
  /** Eventos revelados de uma vez no modo instantâneo. */
  burst: MatchEvent[]
  /** Pedido de pular o replay (consumido no próximo quadro). */
  skipping: boolean
  /** Pausa pedida pelo usuário (botão ⏸ da barra / da transmissão). */
  userPaused: boolean
  /** Adiantar sem mudar a velocidade salva: banco até você entrar, tribuna até o fim. */
  ff: boolean
  /** Adiantamento em 4× (melhores momentos, no banco) em vez de instantâneo. */
  ffFast: boolean
  setFF(v: boolean, fast?: boolean): void
  setSpeed(s: Speed): void
  /** Pula o replay em andamento (Espaço). */
  skip(): void
  togglePause(v?: boolean): void
  /** Pré-jogo: a partida vai começar do zero (replay desde o apito, inclusive "da tribuna"). */
  prime(itemId: string): void
}

export const usePlayback = create<PB>()((set) => ({
  itemId: null,
  shown: 0,
  clock: 0,
  settled: true,
  hold: 0,
  speed: 1,
  last: null,
  revealSeq: 0,
  burst: [],
  skipping: false,
  userPaused: false,
  ff: false,
  ffFast: false,
  setFF: (ff, fast = false) => set({ ff, ffFast: ff && fast }),
  setSpeed: (speed) => {
    set({ speed })
    try {
      localStorage.setItem('lenda:imm:speed', String(speed))
    } catch {
      /* ignore */
    }
  },
  skip: () => set({ hold: 0, skipping: true }),
  togglePause: (v) => set((st) => ({ userPaused: v ?? !st.userPaused })),
  prime: (itemId) => set({ itemId, shown: 0, clock: 0, settled: false, hold: 0, last: null, burst: [], skipping: false, userPaused: false }),
}))

try {
  const raw = localStorage.getItem('lenda:imm:speed')
  const v = raw == null ? NaN : Number(raw)
  if (v === 1 || v === 2 || v === 4 || v === 0) usePlayback.setState({ speed: v as Speed })
} catch {
  /* ignore */
}

const HOLD: Partial<Record<MatchEvent['type'], number>> = { goal: 2600, penalty_goal: 2600, own_goal: 2400, red: 1400, penalty_miss: 1200, half_time: 600, full_time: 600, sub_on: 700 }
const GAP = 320

const targetOf = (l: LiveMatch) => (l.phase === 'pre' ? 0 : l.minute)

/**
 * Minuto exibido salvo neste navegador: o save do motor já guarda a PRÓXIMA parada, então recarregar
 * (ou sair e voltar) no meio do replay retoma do minuto que estava na tela, sem pular gols.
 */
const POS_KEY = 'lenda:imm:replay'
interface SavedPos {
  itemId: string
  shown: number
  clock: number
}
function readPos(): SavedPos | null {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as SavedPos | null
    return v && typeof v.itemId === 'string' && Number.isFinite(v.shown) && Number.isFinite(v.clock) ? v : null
  } catch {
    return null
  }
}
let posSig = ''
usePlayback.subscribe((st) => {
  if (!st.itemId || useImmersive.getState().isFixture) return
  const clock = Math.floor(st.clock)
  const sig = `${st.itemId}|${st.shown}|${clock}`
  if (sig === posSig) return
  posSig = sig
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ itemId: st.itemId, shown: st.shown, clock } satisfies SavedPos))
  } catch {
    /* ignore */
  }
})

/**
 * Motor do replay. `paused` congela (lance decisivo aberto, minijogo animando, aba oculta).
 * Na montagem (ou nova partida) o replay retoma do minuto salvo; sem posição salva, tudo o que já
 * aconteceu é mostrado de uma vez.
 */
export function usePlaybackDriver(live: LiveMatch | null, paused: boolean) {
  const liveRef = useRef(live)
  liveRef.current = live
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  // nova partida → retoma do minuto salvo (recarregar no meio do jogo) ou sincroniza sem replay; se o
  // pré-jogo "armou" esta partida (prime), o replay começa do apito inicial — inclusive da tribuna.
  // (antes da pintura: nada de um quadro com o placar final)
  const itemId = live?.itemId ?? null
  useLayoutEffect(() => {
    const l = liveRef.current
    if (!l) return
    if (usePlayback.getState().itemId === l.itemId) return
    const pos = useImmersive.getState().isFixture ? null : readPos()
    const target = targetOf(l)
    if (pos && pos.itemId === l.itemId && pos.shown < l.events.length && pos.clock <= target) {
      usePlayback.setState({ itemId: l.itemId, shown: pos.shown, clock: Math.max(pos.clock, l.events[pos.shown - 1]?.minute ?? 0), settled: false, hold: 0, last: null, burst: [], userPaused: false })
      return
    }
    usePlayback.setState({ itemId: l.itemId, shown: l.events.length, clock: target, settled: true, hold: 0, last: null, burst: [], userPaused: false })
  }, [itemId])

  useEffect(() => {
    let raf = 0
    let lastT = performance.now()
    let gap = 0
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(120, t - lastT)
      lastT = t
      const l = liveRef.current
      const st = usePlayback.getState()
      if (!l || st.itemId !== l.itemId) return
      const evs = l.events
      const target = targetOf(l)
      if (st.shown > evs.length) {
        usePlayback.setState({ shown: evs.length })
        return
      }
      if (pausedRef.current || st.userPaused || document.hidden) return
      const instant = st.speed === 0 || (st.ff && !st.ffFast) || st.skipping
      if (instant) {
        if (st.shown < evs.length || st.clock !== target || !st.settled || st.skipping) {
          const burst = evs.slice(st.shown)
          usePlayback.setState({ shown: evs.length, clock: target, settled: true, hold: 0, last: burst[burst.length - 1] ?? st.last, revealSeq: st.revealSeq + (burst.length ? 1 : 0), burst, skipping: false })
        }
        return
      }
      if (st.hold > 0) {
        usePlayback.setState({ hold: Math.max(0, st.hold - dt), settled: false })
        return
      }
      if (gap > 0) {
        gap -= dt
        return
      }
      // banco adiantando: melhores momentos em 4× (dá para ver os gols, sem pular direto ao apito final)
      const speed: Speed = st.ff && st.ffFast ? 4 : st.speed
      const rate = dt / MS_PER_MIN[speed]
      const next = evs[st.shown]
      if (next) {
        const em = next.minute
        if (st.clock + rate >= em || em <= st.clock) {
          const k = speed === 4 ? 0.25 : speed === 2 ? 0.5 : 1
          gap = GAP * k
          usePlayback.setState({ shown: st.shown + 1, clock: Math.max(st.clock, Math.min(em, target || em)), last: next, revealSeq: st.revealSeq + 1, burst: [next], hold: (HOLD[next.type] ?? 0) * k, settled: false })
        } else usePlayback.setState({ clock: st.clock + rate, settled: false })
        return
      }
      if (st.clock < target) {
        usePlayback.setState({ clock: Math.min(target, st.clock + rate), settled: false })
        return
      }
      if (!st.settled) usePlayback.setState({ settled: true, clock: target })
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
}

/** Eventos já exibidos (para placar, lances e narração). */
export function useShownEvents(live: LiveMatch | null): MatchEvent[] {
  const shown = usePlayback((s) => s.shown)
  const same = usePlayback((s) => s.itemId === live?.itemId)
  if (!live) return []
  return same ? live.events.slice(0, shown) : live.events
}

/**
 * LENDA SFX — tiny WebAudio-synthesized sounds (no audio files). Honors settings.sound/volume.
 *
 *   import { sfx } from '@/ui/shell/sfx'
 *   sfx.play('click') · sfx.play('whoosh') · sfx.tick() · sfx.play('trophy') · sfx.play('goal') · sfx.play('save')
 *
 * Sounds: click · tap · whoosh · tick · reveal · trophy · unlock · goal · save · miss · whistle · relegation · error
 * The AudioContext is created lazily on the first user gesture (browser autoplay rules).
 */
import { useApp } from '@/store/app'

export type SfxName =
  | 'click'
  | 'tap'
  | 'whoosh'
  | 'tick'
  | 'reveal'
  | 'trophy'
  | 'unlock'
  | 'goal'
  | 'save'
  | 'miss'
  | 'whistle'
  | 'relegation'
  | 'error'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuf: AudioBuffer | null = null
let lastTick = 0

function enabled() {
  const s = useApp.getState().settings
  return s.sound && s.volume > 0
}

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    try {
      ctx = new AC({ latencyHint: 'interactive' })
    } catch {
      return null
    }
    master = ctx.createGain()
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 4
    master.connect(comp).connect(ctx.destination)
  }
  if (master) master.gain.value = 0.9 * useApp.getState().settings.volume
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  return ctx
}

function noise(c: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf
  const len = c.sampleRate * 2
  noiseBuf = c.createBuffer(1, len, c.sampleRate)
  const d = noiseBuf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  return noiseBuf
}

interface ToneOpts {
  type?: OscillatorType
  freq: number
  to?: number
  at?: number
  dur: number
  gain?: number
  attack?: number
  detune?: number
}
function tone(c: AudioContext, o: ToneOpts, out: AudioNode = master!) {
  const t = c.currentTime + (o.at ?? 0)
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.freq, t)
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.dur)
  if (o.detune) osc.detune.value = o.detune
  const a = o.attack ?? 0.005
  const peak = o.gain ?? 0.2
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + a)
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur)
  osc.connect(g).connect(out)
  osc.start(t)
  osc.stop(t + o.dur + 0.05)
}

interface NoiseOpts {
  at?: number
  dur: number
  gain?: number
  type?: BiquadFilterType
  freq: number
  to?: number
  q?: number
  attack?: number
  release?: number
}
function burst(c: AudioContext, o: NoiseOpts, out: AudioNode = master!) {
  const t = c.currentTime + (o.at ?? 0)
  const src = c.createBufferSource()
  src.buffer = noise(c)
  src.loop = true
  const f = c.createBiquadFilter()
  f.type = o.type ?? 'bandpass'
  f.frequency.setValueAtTime(o.freq, t)
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + o.dur)
  f.Q.value = o.q ?? 0.8
  const g = c.createGain()
  const peak = o.gain ?? 0.2
  const a = o.attack ?? 0.02
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + a)
  g.gain.setValueAtTime(peak, t + Math.max(a, o.dur - (o.release ?? o.dur * 0.6)))
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur)
  src.connect(f).connect(g).connect(out)
  src.start(t, Math.random())
  src.stop(t + o.dur + 0.05)
}

const NOTE = (n: number) => 440 * 2 ** ((n - 69) / 12) // MIDI → Hz

const RECIPES: Record<SfxName, (c: AudioContext) => void> = {
  click: (c) => {
    tone(c, { type: 'triangle', freq: 1650, to: 900, dur: 0.05, gain: 0.12 })
  },
  tap: (c) => {
    tone(c, { type: 'sine', freq: 900, to: 700, dur: 0.035, gain: 0.08 })
  },
  whoosh: (c) => {
    burst(c, { dur: 0.42, freq: 380, to: 3200, q: 1.4, gain: 0.16, attack: 0.12, release: 0.26 })
  },
  tick: (c) => {
    tone(c, { type: 'square', freq: 2300, dur: 0.018, gain: 0.03, attack: 0.001 })
  },
  reveal: (c) => {
    ;[72, 76, 79].forEach((n, i) => tone(c, { type: 'triangle', freq: NOTE(n), at: i * 0.06, dur: 0.35, gain: 0.07 }))
  },
  trophy: (c) => {
    // brass-ish fanfare: C5 E5 G5 → C6 held, doubled an octave down + sparkle
    const seq: [number, number, number][] = [
      [72, 0, 0.18],
      [76, 0.14, 0.18],
      [79, 0.28, 0.2],
      [84, 0.44, 0.9],
    ]
    for (const [n, at, dur] of seq) {
      tone(c, { type: 'sawtooth', freq: NOTE(n), at, dur, gain: 0.05, attack: 0.02 })
      tone(c, { type: 'triangle', freq: NOTE(n), at, dur, gain: 0.09, attack: 0.01, detune: 6 })
      tone(c, { type: 'triangle', freq: NOTE(n - 12), at, dur, gain: 0.06, attack: 0.02 })
    }
    ;[88, 91, 96].forEach((n, i) => tone(c, { type: 'sine', freq: NOTE(n), at: 0.5 + i * 0.07, dur: 0.6, gain: 0.03 }))
    burst(c, { at: 0.44, dur: 1.3, type: 'highpass', freq: 6000, gain: 0.025, attack: 0.05 })
  },
  unlock: (c) => {
    ;[84, 88, 91, 96].forEach((n, i) => tone(c, { type: 'sine', freq: NOTE(n), at: i * 0.05, dur: 0.5, gain: 0.06 }))
  },
  goal: (c) => {
    tone(c, { type: 'sine', freq: 140, to: 50, dur: 0.18, gain: 0.35 }) // strike
    burst(c, { at: 0.08, dur: 0.12, type: 'highpass', freq: 2500, gain: 0.08 }) // net
    burst(c, { at: 0.12, dur: 2.2, type: 'bandpass', freq: 700, to: 1100, q: 0.5, gain: 0.22, attack: 0.35, release: 1.2 }) // crowd roar
    burst(c, { at: 0.2, dur: 2.0, type: 'bandpass', freq: 1800, q: 0.7, gain: 0.07, attack: 0.4, release: 1.1 })
  },
  save: (c) => {
    tone(c, { type: 'sine', freq: 110, to: 45, dur: 0.22, gain: 0.35 }) // glove thud
    burst(c, { at: 0.02, dur: 0.08, type: 'lowpass', freq: 900, gain: 0.12 })
    burst(c, { at: 0.18, dur: 1.2, type: 'bandpass', freq: 600, to: 300, q: 0.6, gain: 0.14, attack: 0.2, release: 0.8 }) // "ohhh"
  },
  miss: (c) => {
    tone(c, { type: 'sine', freq: 130, to: 60, dur: 0.16, gain: 0.3 })
    burst(c, { at: 0.2, dur: 1.0, type: 'bandpass', freq: 500, to: 260, q: 0.6, gain: 0.12, attack: 0.15 })
  },
  whistle: (c) => {
    const t0 = 0
    ;[0, 0.22].forEach((at) => {
      tone(c, { type: 'sine', freq: 2900, at: t0 + at, dur: at ? 0.5 : 0.16, gain: 0.08, detune: 30 })
      tone(c, { type: 'sine', freq: 3150, at: t0 + at, dur: at ? 0.5 : 0.16, gain: 0.05 })
    })
  },
  relegation: (c) => {
    ;[67, 63, 60, 55].forEach((n, i) => tone(c, { type: 'triangle', freq: NOTE(n), at: i * 0.16, dur: 0.4, gain: 0.08 }))
  },
  error: (c) => {
    tone(c, { type: 'square', freq: 220, to: 180, dur: 0.16, gain: 0.05 })
  },
}

export const sfx = {
  play(name: SfxName) {
    if (!enabled()) return
    const c = ac()
    if (!c || !master) return
    try {
      RECIPES[name](c)
    } catch {
      /* ignore */
    }
  },
  /** Count-up tick, throttled (≥ 45ms apart). */
  tick() {
    const now = performance.now()
    if (now - lastTick < 45) return
    lastTick = now
    this.play('tick')
  },
  /** Call once from a user gesture to unlock audio on iOS/Safari. */
  unlock() {
    if (enabled()) ac()
  },
}

// unlock on the first gesture
if (typeof window !== 'undefined') {
  const once = () => {
    sfx.unlock()
    window.removeEventListener('pointerdown', once)
    window.removeEventListener('keydown', once)
  }
  window.addEventListener('pointerdown', once, { passive: true })
  window.addEventListener('keydown', once)
}

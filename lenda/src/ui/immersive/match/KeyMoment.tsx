/**
 * Lance decisivo: prompt com cronômetro (barra + anel) DENTRO do campo, 2–3 opções com o par de
 * consequências (sucesso · falha, % complementares), teclas 1–3, opção PADRÃO (definida pela
 * postura) escolhida quando o tempo acaba. Minijogos: pênalti (canto × goleiro no gol em
 * perspectiva) e barra de precisão (pare o marcador; 0–1).
 * O cronômetro pausa com a aba oculta ou com um diálogo do app aberto; "Tempo ×2" nos ajustes locais.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, Crosshair, Flag, Hand, Minus, Move, Repeat, Send, Shield, Target, Timer, TrendingDown, TrendingUp, Zap } from 'lucide-react'
import type { ImmersiveEffect, KeyMoment, KeyMomentOption, LiveMatch } from '@/engine/immersive/types'
import { Kbd, cx, formatPercent, useIsTouch, useReducedMotion } from '@/ui/primitives'
import { SITUATION_LABEL } from '../model/constants'
import { optionSide, outcomeOf, type PenSide, type TeamInfo } from '../model/view'
import { appModalOpen, imSfx, keyBlocked } from '../hooks'

const ICONS: Record<string, typeof Target> = { target: Target, zap: Zap, send: Send, repeat: Repeat, arrow: ArrowRight, 'arrow-left': ArrowLeft, 'arrow-right': ArrowRight, 'arrow-up': ArrowUp, 'arrow-down-right': ArrowDownRight, shield: Shield, move: Move, hand: Hand, flag: Flag }

export type MomentChoice = (optionId: string, minigame?: { side?: PenSide; timing?: number }) => Promise<ImmersiveEffect[]>

const prefs = {
  get noTimer() {
    try {
      return localStorage.getItem('lenda:imm:notimer') === '1'
    } catch {
      return false
    }
  },
  get slow() {
    try {
      return localStorage.getItem('lenda:imm:slowtimer') === '1'
    } catch {
      return false
    }
  },
}

// ───────────────────────── cronômetro ─────────────────────────

function useCountdown(ms: number, running: boolean, onEnd: () => void) {
  const [left, setLeft] = useState(ms)
  const [held, setHeld] = useState(false)
  const end = useRef(onEnd)
  end.current = onEnd
  const leftRef = useRef(ms)
  useEffect(() => {
    if (!running) return
    let last = performance.now()
    const id = setInterval(() => {
      const now = performance.now()
      const dt = now - last
      last = now
      // aba oculta ou diálogo do app por cima (caixa de entrada, menu): o tempo não corre
      const hold = document.hidden || appModalOpen()
      setHeld(hold)
      if (hold) return
      leftRef.current = Math.max(0, leftRef.current - dt)
      setLeft(leftRef.current)
      if (leftRef.current <= 0) {
        clearInterval(id)
        end.current()
      }
    }, 100)
    return () => clearInterval(id)
  }, [running])
  return { left, held }
}

// ───────────────────────── par de consequências ─────────────────────────

function OutcomeChips({ o, situation }: { o: KeyMomentOption; situation: KeyMoment['situation'] }) {
  const out = outcomeOf(situation, o.id, o.label)
  const ok = Math.max(0, Math.min(1, o.chance))
  const okCls = out.goal ? 'lx-fx--gold' : ok >= 0.5 ? 'lx-fx--up' : 'lx-fx--info'
  const failCls = o.risk || situation === 'save' || situation === 'penalty_save' ? 'lx-fx--down' : 'lx-fx--neu'
  return (
    <span className="im-opt__fx">
      <span className={cx('lx-fx lx-fx--sm', okCls)}>
        <span className="lx-fx__ic">{out.goal ? <Target size={14} aria-hidden="true" /> : <TrendingUp size={14} aria-hidden="true" />}</span>
        <span className="truncate">{out.ok}</span>
        <span className="lx-fx__p">{formatPercent(ok)}</span>
      </span>
      <span className={cx('lx-fx lx-fx--sm', failCls)}>
        <span className="lx-fx__ic">{o.risk ? <TrendingDown size={14} aria-hidden="true" /> : <Minus size={14} aria-hidden="true" />}</span>
        <span className="truncate">{o.risk ?? out.fail}</span>
        <span className="lx-fx__p">{formatPercent(1 - ok)}</span>
      </span>
    </span>
  )
}

// ───────────────────────── prompt ─────────────────────────

interface PromptProps {
  live: LiveMatch
  moment: KeyMoment
  /** Opção escolhida quando o tempo acaba (postura); ausente = a mais provável. */
  defaultId?: string
  /** Time que defende o gol no pênalti (goleiro adversário) e o seu (quando você defende). */
  keeperTeam?: TeamInfo
  onChoose: MomentChoice
  onTimeout: () => void
  onBusy: (b: boolean) => void
}

export const KeyMomentPrompt = memo(function KeyMomentPrompt({ live, moment, defaultId: preset, keeperTeam, onChoose, onTimeout, onBusy }: PromptProps) {
  const rm = useReducedMotion()
  const touch = useIsTouch()
  const root = useRef<HTMLElement>(null)
  const noTimer = prefs.noTimer
  const total = moment.timeLimitMs * (prefs.slow ? 2 : 1)
  const [chosen, setChosen] = useState<string | null>(null)
  const isPen = moment.minigame === 'penalty_kick' || moment.minigame === 'penalty_save'
  const [stage, setStage] = useState<'options' | 'timing' | 'penalty'>(isPen ? 'penalty' : 'options')
  const firstRef = useRef<HTMLButtonElement>(null)
  const fallbackId = useMemo(() => moment.options.slice().sort((a, b) => b.chance - a.chance)[0]?.id, [moment])
  const defaultId = preset && moment.options.some((o) => o.id === preset) ? preset : fallbackId
  const done = useRef(false)
  const { left, held } = useCountdown(total, !noTimer && !chosen && stage !== 'timing', () => {
    if (done.current) return
    done.current = true
    onTimeout()
  })
  const secs = Math.ceil(left / 1000)
  const urgency = secs <= 3 ? 'crit' : secs <= 5 ? 'warn' : 'ok'

  useEffect(() => {
    imSfx.play('whistle')
    const t = setTimeout(() => (root.current?.querySelector('button:not([disabled])') as HTMLButtonElement | null)?.focus({ preventScroll: true }), 60)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    if (urgency === 'crit' && !chosen && !noTimer && !held) imSfx.tick()
  }, [secs, urgency, chosen, noTimer, held])

  const pick = useCallback(
    (o: KeyMomentOption) => {
      if (chosen || done.current) return
      setChosen(o.id)
      imSfx.play('click')
      if (moment.minigame === 'timing') {
        setTimeout(() => setStage('timing'), rm ? 0 : 380)
        return
      }
      done.current = true
      onBusy(true)
      setTimeout(() => void onChoose(o.id).finally(() => onBusy(false)), rm ? 120 : 650)
    },
    [chosen, moment.minigame, onChoose, onBusy, rm],
  )

  useEffect(() => {
    if (stage !== 'options') return
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key)
      if (!(n >= 1 && n <= moment.options.length) || keyBlocked(e, root.current)) return
      e.preventDefault()
      pick(moment.options[n - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moment.options, pick, stage])

  const us = live.userSide === 'home' ? live.score[0] : live.score[1]
  const them = live.userSide === 'home' ? live.score[1] : live.score[0]
  const title = SITUATION_LABEL[moment.situation]
  const running = !chosen && !held && stage !== 'timing'
  const showTimer = !noTimer && stage !== 'timing' && !(stage === 'penalty' && chosen)
  return (
    <section ref={root} className={cx('im-km', stage !== 'options' && 'is-game', stage === 'penalty' && 'is-pen')} role="alertdialog" aria-modal="false" aria-labelledby="im-km-t" aria-describedby="im-km-d">
      <div className="lx-elev-2">
        <div className={cx('lx-plate lx-c-lg im-km__plate', stage !== 'options' && 'is-game')}>
          <i className="lx-hl-top" aria-hidden="true" />
          {showTimer && (
            <div className={cx('lx-countdown', !running && 'is-paused', rm && 'is-steps')} data-urgency={urgency} style={{ ['--lx-cd-dur' as string]: `${total}ms` }}>
              <i className="lx-countdown__fill" />
            </div>
          )}
          <div className="im-km__h">
            <div className="min-w-0">
              <span className="lx-kicker">
                <span className="lx-live-dot" />
                Lance decisivo · {moment.minute}&apos;
              </span>
              <h2 className="lx-t-sec im-km__t" id="im-km-t">
                {title}
              </h2>
              <p className="lx-t-body im-km__d" id="im-km-d">
                {moment.description}{' '}
                <b className="text-text num">
                  {us}–{them}
                </b>
              </p>
            </div>
            {showTimer && (
              <div className="im-km__ring" aria-hidden="true">
                <svg className={cx('lx-cd-ring', !running && 'is-paused')} viewBox="0 0 44 44" data-urgency={urgency} style={{ ['--lx-cd-dur' as string]: `${total}ms` }}>
                  <circle className="lx-cd-ring__track" cx="22" cy="22" r="19" pathLength="100" />
                  <circle className="lx-cd-ring__fill" cx="22" cy="22" r="19" pathLength="100" />
                </svg>
                <span className="lx-cd-num">{secs}</span>
              </div>
            )}
          </div>
          {stage === 'options' && (
            <>
              <div className={cx('lx-options im-km__opts', chosen && 'has-choice', moment.options.length === 2 && 'is-2')}>
                {moment.options.map((o, i) => {
                  const Ico = ICONS[o.icon ?? ''] ?? Crosshair
                  return (
                    <button key={o.id} ref={i === 0 ? firstRef : undefined} type="button" className="lx-option im-opt" aria-pressed={chosen === o.id} aria-keyshortcuts={String(i + 1)} onClick={() => pick(o)}>
                      <span className="im-opt__top">
                        <span className="lx-option__key">{i + 1}</span>
                        <span className="lx-option__meta truncate">{o.detail ?? title}</span>
                        {o.id === defaultId && <span className="im-opt__def">Padrão</span>}
                      </span>
                      <span className="lx-option__title">
                        <Ico size={18} aria-hidden="true" className="im-opt__ic" />
                        {o.label}
                      </span>
                      <OutcomeChips o={o} situation={moment.situation} />
                    </button>
                  )
                })}
              </div>
              <div className="im-km__f">
                <span className="lx-t-small">
                  Sem resposta → <b>opção Padrão</b>
                  <span className="im-kbd-hint"> · teclas <Kbd>1</Kbd> <Kbd>2</Kbd> {moment.options.length > 2 && <Kbd>3</Kbd>}</span>
                  {held && <b className="text-warning"> · pausado</b>}
                </span>
                {!touch && <TimerPrefs />}
              </div>
            </>
          )}
          {stage === 'timing' && chosen && (
            <TimingBar
              label={moment.options.find((o) => o.id === chosen)?.label ?? ''}
              onDone={(timing) => {
                done.current = true
                onBusy(true)
                void onChoose(chosen, { timing }).finally(() => onBusy(false))
              }}
            />
          )}
          {stage === 'penalty' && (
            <PenaltyGame
              moment={moment}
              keeper={moment.minigame === 'penalty_save'}
              keeperTeam={keeperTeam}
              scope={root}
              onPick={(o, side) => {
                done.current = true
                setChosen(o.id)
                return onChoose(o.id, { side })
              }}
              onBusy={onBusy}
            />
          )}
        </div>
      </div>
      <p className="sr-only" aria-live="assertive">
        {stage === 'options' && !chosen ? (secs === Math.ceil(total / 1000) ? `Lance decisivo. ${secs} segundos. Opções 1 a ${moment.options.length}.` : secs === 3 ? '3 segundos.' : '') : ''}
      </p>
    </section>
  )
})

function TimerPrefs() {
  const [slow, setSlow] = useState(prefs.slow)
  return (
    <button
      type="button"
      className="im-km__pref lx-t-small"
      aria-pressed={slow}
      onClick={() => {
        const v = !slow
        setSlow(v)
        try {
          localStorage.setItem('lenda:imm:slowtimer', v ? '1' : '0')
        } catch {
          /* ignore */
        }
      }}
      title="Dobra o tempo dos próximos lances (acessibilidade)"
    >
      <Timer size={13} aria-hidden="true" /> Tempo ×2 {slow ? 'ligado' : 'desligado'}
    </button>
  )
}

// ───────────────────────── barra de precisão ─────────────────────────

export function TimingBar({ label, onDone }: { label: string; onDone: (timing: number) => void }) {
  const rm = useReducedMotion()
  const [pos, setPos] = useState(0)
  const [stopped, setStopped] = useState<{ timing: number; at: number } | null>(null)
  const stoppedRef = useRef(false)
  const posRef = useRef(0)
  const raf = useRef(0)
  const auto = useRef(0)
  const btn = useRef<HTMLButtonElement>(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const stop = useCallback(() => {
    if (stoppedRef.current) return
    stoppedRef.current = true
    cancelAnimationFrame(raf.current)
    clearTimeout(auto.current)
    const p = posRef.current
    const timing = Math.max(0, 1 - Math.abs(p - 0.5) * 2)
    setStopped({ timing, at: p })
    imSfx.play(timing > 0.8 ? 'goal' : 'click')
    setTimeout(() => doneRef.current(Math.round(timing * 100) / 100), 650)
  }, [])
  useEffect(() => {
    btn.current?.focus({ preventScroll: true })
    const t0 = performance.now()
    const period = rm ? 2600 : 1250
    const f = (t: number) => {
      if (stoppedRef.current) return
      const u = ((t - t0) % period) / period
      const p = u < 0.5 ? u * 2 : 2 - u * 2
      posRef.current = p
      setPos(p)
      raf.current = requestAnimationFrame(f)
    }
    raf.current = requestAnimationFrame(f)
    // sem reação em 4,2 s → batida fraca (uma vez só: o guard do ref impede o 2º envio)
    auto.current = window.setTimeout(stop, 4200)
    return () => {
      cancelAnimationFrame(raf.current)
      clearTimeout(auto.current)
    }
  }, [rm, stop])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.key !== 'Enter') return
      if (keyBlocked(e, btn.current?.closest('.im-km') ?? null)) return
      e.preventDefault()
      stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stop])
  const g = stopped?.timing
  const grade = g == null ? null : g >= 0.85 ? 'Perfeito!' : g >= 0.6 ? 'Bom' : g >= 0.3 ? 'Regular' : 'Fraco'
  return (
    <div className="im-timing">
      <div className="im-timing__head">
        <span className="lx-label">Precisão · {label}</span>
        {grade && <b className={cx('im-timing__grade', g! >= 0.85 ? 'is-perfect' : g! >= 0.6 && 'is-good')}>{grade}</b>}
      </div>
      <div className="im-timing__bar" aria-hidden="true">
        {[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((k) => (
          <i key={k} className="im-timing__tick" style={{ left: `${k * 100}%` }} />
        ))}
        <i className="im-timing__zone is-ok" />
        <i className="im-timing__zone is-perfect" />
        <i className={cx('im-timing__marker', stopped && 'is-stopped')} style={{ left: `${(stopped ? stopped.at : pos) * 100}%` }} />
      </div>
      <button ref={btn} type="button" className="lx-btn lx-btn--primary lx-btn--sm im-timing__go" onClick={stop} disabled={!!stopped}>
        <span>Agora!</span>
        <Kbd className="im-kbd-hint">Espaço</Kbd>
      </button>
    </div>
  )
}

// ───────────────────────── pênalti ─────────────────────────

const SIDE_X: Record<PenSide, number> = { left: 108, center: 200, right: 292 }
const OTHER: Record<PenSide, PenSide> = { left: 'right', right: 'left', center: 'left' }

const rgbOf = (h: string) => {
  const m = h.replace('#', '')
  const n = parseInt(m.length === 3 ? m.replace(/./g, (c) => c + c) : m, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const
}
const hexLum = (h: string) => {
  const [r, g, b] = rgbOf(h)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}
/** Uniforme do goleiro pela regra do disco (§9.1): cor escura/verde → claro com contorno. */
function keeperKit(t?: TeamInfo): { kit: string; line: string; glove: string } {
  const p = t?.colors.secondary ?? '#F7C948'
  const [r, g, b] = rgbOf(p)
  const greenish = g > r * 1.15 && g > b * 1.1
  const kit = greenish || hexLum(p) < 0.13 ? '#F4F6FF' : p
  return { kit, line: hexLum(kit) > 0.55 ? '#0A0F3A' : '#F4F6FF', glove: hexLum(kit) > 0.55 ? '#3BE4FF' : '#F4F6FF' }
}

interface PenProps {
  moment: KeyMoment
  keeper: boolean
  keeperTeam?: TeamInfo
  scope: RefObject<HTMLElement | null>
  onPick: (o: KeyMomentOption, side: PenSide) => Promise<ImmersiveEffect[]>
  onBusy: (b: boolean) => void
}

export function PenaltyGame({ moment, keeper, keeperTeam, scope, onPick, onBusy }: PenProps) {
  const rm = useReducedMotion()
  const [pick, setPick] = useState<PenSide | null>(null)
  const [hover, setHover] = useState<PenSide | null>(null)
  const [result, setResult] = useState<{ ok: boolean; ball: PenSide; keeper: PenSide; wide: boolean } | null>(null)
  const opts = moment.options
  const sides = useMemo(() => opts.map((o, i) => optionSide(o.id, i, opts.length)), [opts])
  const kit = keeperKit(keeperTeam)
  const go = useCallback(
    async (i: number) => {
      const o = opts[i]
      if (pick || !o) return
      const side = sides[i]
      setPick(side)
      onBusy(true)
      imSfx.play('whistle')
      const fx = await onPick(o, side)
      const r = fx.find((e): e is Extract<ImmersiveEffect, { type: 'moment_result' }> => e.type === 'moment_result')
      const ok = r?.success ?? false
      let res: { ok: boolean; ball: PenSide; keeper: PenSide; wide: boolean }
      if (r?.penalty) {
        // o motor diz exatamente onde foi a bola e para onde o goleiro pulou (câmera atrás do batedor)
        const { shot, keeper: dive } = r.penalty
        res = { ok, ball: shot, keeper: dive, wide: !keeper && !ok && shot !== dive }
      } else {
        const wide = !keeper && !ok && /fora|por cima|trave|isol|travessão/i.test(r?.text ?? '')
        // chutando: sucesso = goleiro no outro canto; pegando: sucesso = você no canto da bola
        res = keeper ? { ok, keeper: side, ball: ok ? side : OTHER[side], wide: false } : { ok, ball: side, keeper: ok || wide ? OTHER[side] : side, wide }
      }
      setTimeout(() => {
        setResult(res)
        imSfx.play(ok ? (keeper ? 'save' : 'goal') : 'miss')
      }, rm ? 0 : 250)
      setTimeout(() => onBusy(false), rm ? 900 : 2300)
    },
    [pick, opts, sides, onPick, onBusy, keeper, rm],
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keyBlocked(e, scope.current)) return
      let i = -1
      if (e.key >= '1' && e.key <= '9') i = Number(e.key) - 1
      else if (e.key === 'ArrowLeft') i = sides.indexOf('left')
      else if (e.key === 'ArrowUp') i = sides.indexOf('center')
      else if (e.key === 'ArrowRight') i = sides.indexOf('right')
      if (i < 0 || i >= opts.length) return
      e.preventDefault()
      void go(i)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, opts.length, sides, scope])
  const kx = result ? SIDE_X[result.keeper] : 200
  const dive = result ? (result.keeper === 'left' ? -58 : result.keeper === 'right' ? 58 : 0) : 0
  const bx = result ? SIDE_X[result.ball] + (result.wide ? (result.ball === 'left' ? -30 : result.ball === 'right' ? 30 : 0) : 0) : 200
  const by = result ? (result.wide ? 30 : result.ball === 'center' ? 96 : 84) : 206
  const focusSide = pick ?? hover
  const banner = result ? (keeper ? (result.ok ? 'Defendeu!' : 'Gol deles') : result.ok ? 'Gooool!' : result.wide ? 'Pra fora!' : 'Defendeu!') : null
  const good = result ? result.ok : false
  return (
    <div className="im-pen">
      <div className="im-pen__art">
        <svg viewBox="0 0 400 230" className="im-pen__svg" aria-hidden="true">
          <defs>
            <linearGradient id="im-pen-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#0B1454" />
              <stop offset="1" stopColor="#060A2C" />
            </linearGradient>
            <linearGradient id="im-pen-grass" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#0C5A44" />
              <stop offset="1" stopColor="#0F6C51" />
            </linearGradient>
            <linearGradient id="im-pen-net" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#020618" stopOpacity=".78" />
              <stop offset="1" stopColor="#0A1244" stopOpacity=".45" />
            </linearGradient>
            <pattern id="im-pen-mesh" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <path d="M0 0 H9 M0 0 V9" stroke="#DFE6FF" strokeOpacity=".2" strokeWidth=".8" />
            </pattern>
            <radialGradient id="im-pen-spot" cx=".5" cy=".35" r=".6">
              <stop offset="0" stopColor="#9FB6FF" stopOpacity=".22" />
              <stop offset="1" stopColor="#9FB6FF" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="400" height="230" fill="url(#im-pen-sky)" />
          <rect width="400" height="230" fill="url(#im-pen-spot)" />
          {/* gramado em perspectiva */}
          <path d="M0 176 H400 V230 H0 Z" fill="url(#im-pen-grass)" />
          {[0, 1, 2, 3].map((k) => (
            <path key={k} d={`M${k * 110 - 20} 176 L${k * 110 + 35} 176 L${k * 130 + 10} 230 L${k * 130 - 55} 230 Z`} fill="#fff" opacity=".035" />
          ))}
          <path d="M60 196 H340" stroke="#DFFCF2" strokeOpacity=".45" strokeWidth="2" />
          <ellipse cx="200" cy="214" rx="3" ry="1.6" fill="#DFFCF2" opacity=".7" />
          {/* rede: fundo + laterais com sombreado */}
          <path d="M72 58 H328 V170 H72 Z" fill="url(#im-pen-net)" />
          <path d="M72 58 H328 V170 H72 Z" fill="url(#im-pen-mesh)" />
          <path d="M44 34 L72 58 V170 L44 190 Z" fill="url(#im-pen-net)" />
          <path d="M44 34 L72 58 V170 L44 190 Z" fill="url(#im-pen-mesh)" opacity=".8" />
          <path d="M356 34 L328 58 V170 L356 190 Z" fill="url(#im-pen-net)" />
          <path d="M356 34 L328 58 V170 L356 190 Z" fill="url(#im-pen-mesh)" opacity=".8" />
          <path d="M44 34 L72 58 H328 L356 34 Z" fill="url(#im-pen-mesh)" opacity=".6" />
          {/* zonas */}
          {(['left', 'center', 'right'] as PenSide[]).map((s) => (
            <rect key={s} x={SIDE_X[s] - 44} y="44" width="88" height="140" className={cx('im-pen__zone', focusSide === s && 'is-pick')} />
          ))}
          {/* goleiro (silhueta com o uniforme do time que defende) */}
          <g className="im-pen__keeper" style={{ transform: `translate(${kx}px, ${result && result.keeper !== 'center' ? 150 : 152}px) rotate(${dive}deg)` }}>
            <ellipse cx="0" cy="38" rx="18" ry="4" fill="#000" opacity=".35" />
            <path d="M-7 12 L-11 36 H-4 L0 18 L4 36 H11 L7 12 Z" fill="#0A0F3A" stroke={kit.line} strokeOpacity=".35" strokeWidth="1" />
            <path d="M-14 -24 Q0 -30 14 -24 L12 14 H-12 Z" fill={kit.kit} stroke={kit.line} strokeWidth="1.5" />
            <path d="M-14 -22 L-34 -40 L-30 -45 L-10 -30 Z" fill={kit.kit} stroke={kit.line} strokeWidth="1.5" />
            <path d="M14 -22 L34 -40 L30 -45 L10 -30 Z" fill={kit.kit} stroke={kit.line} strokeWidth="1.5" />
            <circle cx="-34" cy="-45" r="5" fill={kit.glove} />
            <circle cx="34" cy="-45" r="5" fill={kit.glove} />
            <circle cx="0" cy="-36" r="8.5" fill="#C9A27E" stroke={kit.line} strokeOpacity=".5" />
            <path d="M-9 -38 Q0 -48 9 -38" fill="#2A1A10" />
          </g>
          {/* traves por cima da rede e do goleiro */}
          <path d="M44 190 V34 H356 V190" fill="none" stroke="#F4F6FF" strokeWidth="6" strokeLinejoin="round" />
          <path d="M44 34 L72 58 H328 L356 34" fill="none" stroke="#F4F6FF" strokeOpacity=".35" strokeWidth="2" />
          {/* bola */}
          <g className="im-pen__ball" style={{ transform: `translate(${bx}px, ${by}px) scale(${result ? 0.62 : 1})` }}>
            <ellipse cx="0" cy="11" rx="9" ry="2.5" fill="#000" opacity={result ? 0 : 0.35} />
            <circle r="9" fill="#F4F6FF" stroke="#0A0F3A" strokeWidth="1.4" />
            <path d="M0 -4 L3.8 -1.2 L2.4 3.2 H-2.4 L-3.8 -1.2 Z" fill="#0A0F3A" opacity=".75" />
          </g>
        </svg>
        {banner && (
          <div className={cx('im-pen__banner', good ? 'is-ok' : 'is-bad')} role="status">
            <span>{banner}</span>
          </div>
        )}
      </div>
      <div className="im-pen__opts" role="group" aria-label={keeper ? 'Para onde pular' : 'Onde bater'}>
        {opts.map((o, i) => (
          <button
            key={o.id}
            type="button"
            className={cx('lx-option im-pen__opt', pick === sides[i] && 'is-on')}
            aria-pressed={pick === sides[i]}
            aria-keyshortcuts={String(i + 1)}
            disabled={!!pick}
            onMouseEnter={() => setHover(sides[i])}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(sides[i])}
            onBlur={() => setHover(null)}
            onClick={() => void go(i)}
          >
            <span className="im-opt__top">
              <span className="lx-option__key">{i + 1}</span>
              <span className="lx-option__title">{o.label}</span>
            </span>
            <OutcomeChips o={o} situation={moment.situation} />
          </button>
        ))}
      </div>
    </div>
  )
}

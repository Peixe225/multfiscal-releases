/**
 * Lance decisivo: prompt com cronômetro (barra + anel), 2–3 opções com % e pílula de risco,
 * teclas 1–3, opção PADRÃO (a mais segura) escolhida pela IA quando o tempo acaba.
 * Minijogos: pênalti (canto × goleiro animado) e barra de precisão (pare o marcador; 0–1).
 * O cronômetro pausa com a aba oculta; "Tempo ×2" e "sem cronômetro" nos ajustes locais.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUp, Crosshair, Hand, Move, Repeat, Send, Shield, Target, Timer, TriangleAlert, Zap } from 'lucide-react'
import type { ImmersiveEffect, KeyMoment, KeyMomentOption, LiveMatch } from '@/engine/immersive/types'
import { cx, formatPercent, useReducedMotion } from '@/ui/primitives'
import { sfx } from '@/ui/shell/sfx'
import { SITUATION_LABEL } from '../model/constants'

const ICONS: Record<string, typeof Target> = { target: Target, zap: Zap, send: Send, repeat: Repeat, arrow: ArrowRight, 'arrow-left': ArrowLeft, 'arrow-right': ArrowRight, 'arrow-up': ArrowUp, shield: Shield, move: Move, hand: Hand }

export type MomentChoice = (optionId: string, minigame?: { side?: 'left' | 'center' | 'right'; timing?: number }) => Promise<ImmersiveEffect[]>

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
      if (document.hidden) return
      leftRef.current = Math.max(0, leftRef.current - dt)
      setLeft(leftRef.current)
      if (leftRef.current <= 0) {
        clearInterval(id)
        end.current()
      }
    }, 100)
    return () => clearInterval(id)
  }, [running])
  return left
}

// ───────────────────────── prompt ─────────────────────────

export const KeyMomentPrompt = memo(function KeyMomentPrompt({ live, moment, onChoose, onTimeout, onBusy }: { live: LiveMatch; moment: KeyMoment; onChoose: MomentChoice; onTimeout: () => void; onBusy: (b: boolean) => void }) {
  const rm = useReducedMotion()
  const noTimer = prefs.noTimer
  const total = moment.timeLimitMs * (prefs.slow ? 2 : 1)
  const [chosen, setChosen] = useState<string | null>(null)
  const [stage, setStage] = useState<'options' | 'timing' | 'penalty'>(moment.minigame === 'penalty_kick' || moment.minigame === 'penalty_save' ? 'penalty' : 'options')
  const [hidden, setHidden] = useState(false)
  const firstRef = useRef<HTMLButtonElement>(null)
  const defaultId = useMemo(() => moment.options.slice().sort((a, b) => b.chance - a.chance)[0]?.id, [moment])
  const done = useRef(false)
  const left = useCountdown(total, !noTimer && !chosen && stage !== 'timing', () => {
    if (done.current) return
    done.current = true
    onTimeout()
  })
  const secs = Math.ceil(left / 1000)
  const urgency = secs <= 3 ? 'crit' : secs <= 5 ? 'warn' : 'ok'

  useEffect(() => {
    sfx.play('whistle')
    const t = setTimeout(() => firstRef.current?.focus({ preventScroll: true }), 60)
    const vis = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', vis)
    return () => {
      clearTimeout(t)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [])
  useEffect(() => {
    if (urgency === 'crit' && !chosen && !noTimer) sfx.tick()
  }, [secs, urgency, chosen, noTimer])

  const pick = useCallback(
    (o: KeyMomentOption) => {
      if (chosen || done.current) return
      setChosen(o.id)
      sfx.play('click')
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
      if (n >= 1 && n <= moment.options.length) {
        e.preventDefault()
        pick(moment.options[n - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moment.options, pick, stage])

  const us = live.userSide === 'home' ? live.score[0] : live.score[1]
  const them = live.userSide === 'home' ? live.score[1] : live.score[0]
  const title = SITUATION_LABEL[moment.situation]
  const running = !chosen && !hidden && stage !== 'timing'
  return (
    <section className="im-km" role="alertdialog" aria-modal="false" aria-labelledby="im-km-t" aria-describedby="im-km-d">
      <div className="lx-elev-2">
        <div className={cx('lx-plate lx-c-lg im-km__plate', stage !== 'options' && 'is-game')}>
          <i className="lx-hl-top" aria-hidden="true" />
          {!noTimer && stage !== 'timing' && (
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
                <b className="text-text">
                  {us}–{them}
                </b>
              </p>
            </div>
            {!noTimer && stage !== 'timing' && (
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
                      <span className="im-opt__fx">
                        <span className={cx('lx-fx lx-fx--sm', o.chance >= 0.5 ? 'lx-fx--up' : o.chance >= 0.3 ? 'lx-fx--gold' : 'lx-fx--down')}>
                          <span className="lx-fx__ic">
                            <Target size={14} aria-hidden="true" />
                          </span>
                          Sucesso
                          <span className="lx-fx__p">{formatPercent(o.chance)}</span>
                        </span>
                        {o.risk && (
                          <span className="lx-fx lx-fx--sm lx-fx--down">
                            <span className="lx-fx__ic">
                              <TriangleAlert size={14} aria-hidden="true" />
                            </span>
                            {o.risk}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="im-km__f">
                <span className="lx-t-small">
                  Sem resposta → <b>opção Padrão</b> · teclas <b>1 2 3</b>
                </span>
                <TimerPrefs />
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
              onPick={(side) => {
                done.current = true
                setChosen(side)
                return onChoose(side, { side })
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
  const [stopped, setStopped] = useState<number | null>(null)
  const posRef = useRef(0)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    btn.current?.focus({ preventScroll: true })
    let raf = 0
    const t0 = performance.now()
    const period = rm ? 2600 : 1250
    const f = (t: number) => {
      const u = ((t - t0) % period) / period
      const p = u < 0.5 ? u * 2 : 2 - u * 2
      posRef.current = p
      setPos(p)
      raf = requestAnimationFrame(f)
    }
    raf = requestAnimationFrame(f)
    // sem reação em 4 s → batida fraca
    const auto = setTimeout(() => stop(), 4200)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(auto)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const stop = () => {
    if (stopped != null) return
    const p = posRef.current
    const timing = Math.max(0, 1 - Math.abs(p - 0.5) * 2)
    setStopped(timing)
    sfx.play(timing > 0.8 ? 'goal' : 'click')
    setTimeout(() => onDone(Math.round(timing * 100) / 100), 650)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const grade = stopped == null ? null : stopped >= 0.85 ? 'Perfeito!' : stopped >= 0.6 ? 'Bom' : stopped >= 0.3 ? 'Regular' : 'Fraco'
  return (
    <div className="im-timing">
      <div className="im-timing__head">
        <span className="lx-label">Precisão · {label}</span>
        {grade && <b className={cx('im-timing__grade', stopped! >= 0.6 && 'is-good')}>{grade}</b>}
      </div>
      <div className="im-timing__bar" aria-hidden="true">
        <i className="im-timing__zone is-ok" />
        <i className="im-timing__zone is-perfect" />
        <i className="im-timing__marker" style={{ left: `${(stopped != null ? posRef.current : pos) * 100}%` }} />
      </div>
      <button ref={btn} type="button" className="lx-btn lx-btn--primary im-timing__go" onClick={stop} disabled={stopped != null}>
        <span>Agora! (Espaço)</span>
      </button>
    </div>
  )
}

// ───────────────────────── pênalti ─────────────────────────

type Side = 'left' | 'center' | 'right'
const OTHER: Record<Side, Side> = { left: 'right', right: 'left', center: 'left' }
const SIDE_X: Record<Side, number> = { left: 70, center: 160, right: 250 }

export function PenaltyGame({ moment, keeper, onPick, onBusy }: { moment: KeyMoment; keeper: boolean; onPick: (side: Side) => Promise<ImmersiveEffect[]>; onBusy: (b: boolean) => void }) {
  const rm = useReducedMotion()
  const [pick, setPick] = useState<Side | null>(null)
  const [result, setResult] = useState<{ ok: boolean; ball: Side; keeper: Side } | null>(null)
  const opts = moment.options
  const go = useCallback(
    async (side: Side) => {
      if (pick) return
      setPick(side)
      onBusy(true)
      sfx.play('whistle')
      const fx = await onPick(side)
      const r = fx.find((e): e is Extract<ImmersiveEffect, { type: 'moment_result' }> => e.type === 'moment_result')
      const ok = r?.success ?? false
      // chutando: sucesso = goleiro no outro canto; pegando: sucesso = você no canto da bola
      const res = keeper ? { ok, keeper: side, ball: ok ? side : OTHER[side] } : { ok, ball: side, keeper: ok ? OTHER[side] : side }
      setTimeout(() => {
        setResult(res)
        sfx.play(ok ? (keeper ? 'save' : 'goal') : 'miss')
      }, rm ? 0 : 250)
      setTimeout(() => onBusy(false), rm ? 900 : 2100)
    },
    [pick, onPick, onBusy, keeper, rm],
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Side> = { '1': 'left', ArrowLeft: 'left', '2': 'center', ArrowUp: 'center', '3': 'right', ArrowRight: 'right' }
      const s = map[e.key]
      if (s && opts.some((o) => o.id === s)) {
        e.preventDefault()
        void go(s)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, opts])
  const kx = result ? SIDE_X[result.keeper] : 160
  const bx = result ? SIDE_X[result.ball] : 160
  const by = result ? (result.ball === 'center' ? 70 : 62) : 196
  return (
    <div className="im-pen">
      <svg viewBox="0 0 320 220" className="im-pen__svg" aria-hidden="true">
        <defs>
          <pattern id="im-net" width="12" height="12" patternUnits="userSpaceOnUse">
            <path d="M0 0 L12 12 M12 0 L0 12" stroke="#DFE6FF" strokeOpacity=".22" strokeWidth="1" />
          </pattern>
        </defs>
        <rect x="0" y="176" width="320" height="44" fill="#0C5A44" />
        <rect x="20" y="30" width="280" height="146" fill="url(#im-net)" />
        <path d="M20 176 V30 H300 V176" fill="none" stroke="#F4F6FF" strokeWidth="6" />
        {/* zonas */}
        {(['left', 'center', 'right'] as Side[]).map((s) => (
          <rect key={s} x={SIDE_X[s] - 48} y="40" width="96" height="130" className={cx('im-pen__zone', pick === s && 'is-pick')} />
        ))}
        {/* goleiro */}
        <g className="im-pen__keeper" style={{ transform: `translate(${kx}px, ${result && result.keeper !== 'center' ? 110 : 118}px) rotate(${result ? (result.keeper === 'left' ? -62 : result.keeper === 'right' ? 62 : 0) : 0}deg)` }}>
          <rect x="-10" y="-30" width="20" height="44" rx="8" fill={keeper ? '#3BE4FF' : '#F7C948'} />
          <circle cx="0" cy="-40" r="9" fill="#F1C9A5" />
          <rect x="-30" y="-26" width="20" height="7" rx="3.5" fill={keeper ? '#3BE4FF' : '#F7C948'} />
          <rect x="10" y="-26" width="20" height="7" rx="3.5" fill={keeper ? '#3BE4FF' : '#F7C948'} />
          <rect x="-9" y="14" width="7" height="24" rx="3" fill="#0A0F3A" />
          <rect x="2" y="14" width="7" height="24" rx="3" fill="#0A0F3A" />
        </g>
        <g className="im-pen__ball" style={{ transform: `translate(${bx}px, ${by}px) scale(${result ? 0.7 : 1})` }}>
          <circle r="9" fill="#fff" stroke="#0A0F3A" strokeWidth="1.5" />
          <circle r="3" cx="-2" cy="-2" fill="#0A0F3A" opacity=".5" />
        </g>
      </svg>
      {result ? (
        <div className={cx('im-pen__res', result.ok ? 'is-ok' : 'is-bad')} role="status">
          {keeper ? (result.ok ? 'DEFENDEU!' : 'GOL DELES') : result.ok ? 'GOOOL!' : 'DEFENDEU!'}
        </div>
      ) : (
        <div className="im-pen__opts" role="group" aria-label={keeper ? 'Para onde pular' : 'Onde bater'}>
          {opts.map((o, i) => (
            <button key={o.id} type="button" className={cx('lx-option im-pen__opt', pick === o.id && 'is-on')} aria-pressed={pick === o.id} disabled={!!pick} onClick={() => void go(o.id as Side)}>
              <span className="im-opt__top">
                <span className="lx-option__key">{i + 1}</span>
                <span className="lx-option__meta">{o.detail}</span>
              </span>
              <span className="lx-option__title">{o.label}</span>
              <span className={cx('lx-fx lx-fx--sm', o.chance >= 0.5 ? 'lx-fx--up' : 'lx-fx--gold')}>
                {keeper ? 'Defesa' : 'Gol'}
                <span className="lx-fx__p">{formatPercent(o.chance)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

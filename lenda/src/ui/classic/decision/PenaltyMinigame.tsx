/**
 * Decisive penalty minigame. The decision's penalty options ARE the corners (real engine:
 * `decisive_penalty-left|center|right`); a single "Bater" option (mock) maps every corner to it.
 * Flow (Copero `pc`, re-staged): choose a corner (click · 1–3) → run-up → ball flies / keeper
 * dives → "Gol!" / "Defesa!" badge at ~1010 ms; the table reveal starts at 2010 ms.
 * Goalkeepers pick the dive instead of the shot.
 */
import { memo, useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react'
import type { Decision, DecisionOption } from '@/engine/types'
import { useCareer } from '@/store/career'
import { useClub } from '@/store/data'
import { Button, Kbd, clubColors, cx, formatPercent, useIsTouch, useReducedMotion } from '@/ui/primitives'
import { sfx } from '@/ui/shell/sfx'
import { director } from '@/ui/classic/reveal/director'
import { useReveal, type Side } from '@/ui/classic/reveal/store'

const SIDES: Side[] = ['left', 'center', 'right']
const SIDE_LABEL: Record<Side, string> = { left: 'Esquerda', center: 'Meio', right: 'Direita' }
const SIDE_ICON = { left: ArrowLeft, center: ArrowUp, right: ArrowRight } as const
/** Ball / keeper x offsets inside the goal (% of goal width, from the centre). */
const X: Record<Side, number> = { left: -34, center: 0, right: 34 }

export function isPenaltyDecision(d: Decision | null | undefined): boolean {
  return !!d?.options.some((o) => o.minigame === 'penalty')
}

function sideOf(o: DecisionOption): Side | null {
  const m = `${o.id} ${o.art ?? ''}`.match(/(left|center|right)\b/)
  return (m?.[1] as Side) ?? null
}

export interface PenaltyTarget {
  side: Side
  option: DecisionOption
  p?: number
}

export function penaltyTargets(d: Decision): { targets: PenaltyTarget[]; others: DecisionOption[] } {
  const pens = d.options.filter((o) => o.minigame === 'penalty')
  const others = d.options.filter((o) => o.minigame !== 'penalty')
  const bySide = new Map<Side, DecisionOption>()
  for (const o of pens) {
    const s = sideOf(o)
    if (s) bySide.set(s, o)
  }
  const targets = SIDES.map((side) => {
    const option = bySide.get(side) ?? pens[0]
    const pos = option.effects.find((e) => e.kind === 'positive')
    return { side, option, p: pos?.probability }
  })
  return { targets, others }
}

const other = (s: Side, avoid: Side): Side => (SIDES.find((x) => x !== s && x !== avoid) ?? 'center')

export const PenaltyMinigame = memo(function PenaltyMinigame({ decision, locked }: { decision: Decision; locked: boolean }) {
  const rm = useReducedMotion()
  const touch = useIsTouch()
  const gk = useCareer((s) => s.state?.identity.position === 'GOL')
  const clubId = useCareer((s) => s.state?.clubId ?? null)
  const reveal = useCareer((s) => s.reveal)
  const club = useClub(clubId)
  const phase = useReveal((s) => s.phase)
  const picked = useReveal((s) => s.penaltySide)
  const chosenId = useReveal((s) => s.chosenId)
  const { targets, others } = useMemo(() => penaltyTargets(decision), [decision])
  const [hover, setHover] = useState<Side | null>(null)
  const kit = clubColors(club ?? null)

  // resolved shot (the user's corner is honoured; the engine decides the outcome)
  const shot = useMemo(() => {
    const pen = reveal?.penalty
    if (!pen || !picked) return null
    const scored = pen.scored
    if (gk) {
      const keeper = picked
      const ball = scored ? (pen.side !== keeper ? pen.side : other(keeper, keeper)) : keeper
      return { ball, keeper, scored, good: !scored }
    }
    const ball = picked
    const keeper = scored ? (pen.keeperSide !== ball ? pen.keeperSide : other(ball, ball)) : ball
    return { ball, keeper, scored, good: scored }
  }, [reveal, picked, gk])

  // stage timeline: 0 run-up · 330 strike · 1010 result
  const [stage, setStage] = useState<'aim' | 'runup' | 'strike' | 'result'>('aim')
  useEffect(() => {
    if (!picked) {
      setStage('aim')
      return
    }
    if (!shot) {
      setStage('runup')
      return
    }
    if (rm) {
      setStage('result')
      return
    }
    setStage('runup')
    const t1 = setTimeout(() => {
      setStage('strike')
      sfx.play('whoosh')
    }, 330)
    const t2 = setTimeout(() => {
      setStage('result')
      sfx.play(shot.scored ? 'goal' : 'save')
    }, 1010)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [picked, shot, rm])

  const aiming = !picked && !locked && phase === 'idle'
  const pick = (t: PenaltyTarget) => {
    if (!aiming) return
    sfx.play('whistle')
    void director.pick(t.option.id, { side: t.side })
  }
  const struck = stage === 'strike' || stage === 'result'
  const ballX = shot && struck ? X[shot.ball] : 0
  const keeperX = shot && struck ? X[shot.keeper] * 0.92 : 0
  const keeperRot = shot && struck ? (shot.keeper === 'left' ? -58 : shot.keeper === 'right' ? 58 : 0) : 0
  const saved = shot && !shot.scored

  return (
    <div className="ck-pen" style={{ ['--kit' as string]: kit.primary, ['--kit-2' as string]: kit.secondary }}>
      <div className={cx('ck-pen__scene', stage === 'result' && shot?.scored && 'is-goal', stage === 'result' && saved && 'is-save')}>
        <span className="ck-pen__sky" aria-hidden="true" />
        <span className="ck-pen__crowd" aria-hidden="true" />
        <span className="ck-pen__grass" aria-hidden="true" />
        {/* goal */}
        <div className="ck-pen__goal" role="group" aria-label={gk ? 'Escolha para onde pular' : 'Escolha o canto da cobrança'}>
          <span className="ck-pen__net" aria-hidden="true" />
          <span className="ck-pen__frame" aria-hidden="true" />
          {targets.map((t, i) => {
            const Icon = SIDE_ICON[t.side]
            const on = hover === t.side || picked === t.side
            return (
              <button
                key={t.side}
                type="button"
                id={`ck-opt-${i}`}
                data-idx={i}
                className={cx('ck-pen__zone', `is-${t.side}`, on && 'is-on', picked && picked !== t.side && 'is-off')}
                disabled={!aiming}
                aria-label={`${gk ? 'Pular para' : 'Chutar no'} ${t.side === 'center' ? 'meio' : `canto ${SIDE_LABEL[t.side].toLowerCase()}`}${t.p != null ? ` (${formatPercent(t.p)} de chance)` : ''}`}
                aria-keyshortcuts={String(i + 1)}
                onMouseEnter={() => setHover(t.side)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(t.side)}
                onBlur={() => setHover(null)}
                onClick={() => pick(t)}
              >
                <span className="ck-pen__target" aria-hidden="true">
                  <Icon />
                </span>
                <span className="ck-pen__zlabel">
                  {!touch && <Kbd>{i + 1}</Kbd>}
                  {SIDE_LABEL[t.side]}
                  {t.p != null && <b className="num">{formatPercent(t.p)}</b>}
                </span>
              </button>
            )
          })}
          {/* keeper */}
          <motion.span
            className="ck-pen__keeper"
            aria-hidden="true"
            initial={false}
            animate={{ x: `${(keeperX / 12.5) * 100}%`, rotate: keeperRot, y: struck && shot?.keeper !== 'center' ? '16%' : struck ? '-12%' : '0%' }}
            transition={{ duration: rm ? 0 : 0.42, ease: [0.2, 0.9, 0.3, 1], delay: rm ? 0 : 0.05 }}
          >
            <svg viewBox="0 0 60 90">
              <circle cx="30" cy="12" r="8" fill="#e9c9a6" />
              <path d="M14 26c4-5 28-5 32 0l4 30H10z" fill={gk ? 'var(--kit)' : '#f5d33a'} />
              <path d="M10 30 2 14M50 30l8-16" stroke={gk ? 'var(--kit)' : '#f5d33a'} strokeWidth="7" strokeLinecap="round" />
              <circle cx="2" cy="13" r="4" fill="#fff" />
              <circle cx="58" cy="13" r="4" fill="#fff" />
              <path d="M13 56h34l-2 12H15z" fill="#15171d" />
              <path d="M18 68v18M42 68v18" stroke="#15171d" strokeWidth="7" strokeLinecap="round" />
            </svg>
          </motion.span>
        </div>
        {/* ball: the track spans the scene, so x/y percentages are scene-relative */}
        <motion.span
          className="ck-pen__track"
          aria-hidden="true"
          initial={false}
          animate={
            !shot || !struck
              ? { x: '0%', y: '0%' }
              : saved
                ? { x: ['0%', `${ballX * 0.62}%`, `${ballX * 0.62 + (shot.ball === 'right' ? 9 : -9)}%`], y: ['0%', '-40%', '-22%'] }
                : { x: `${ballX * 0.7}%`, y: '-46%' }
          }
          transition={{ duration: rm ? 0 : saved ? 0.72 : 0.46, ease: [0.2, 0.8, 0.3, 1], times: saved ? [0, 0.6, 1] : undefined }}
        >
          <motion.span
            className="ck-pen__ball"
            initial={false}
            animate={!shot || !struck ? { scale: 1, rotate: 0 } : { scale: saved ? 0.58 : 0.48, rotate: saved ? 420 : 540 }}
            transition={{ duration: rm ? 0 : 0.5, ease: [0.2, 0.8, 0.3, 1] }}
          >
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10.5" fill="#fff" stroke="#1b1d22" strokeWidth="1.2" />
              <path d="m12 7.2 4.2 3-1.6 4.8H9.4L7.8 10.2z" fill="#1b1d22" />
              <path d="M12 7.2V2.3M16.2 10.2l4.6-1.5M14.6 15l2.9 4M9.4 15l-2.9 4M7.8 10.2 3.2 8.7" stroke="#1b1d22" strokeWidth="1.1" />
            </svg>
          </motion.span>
        </motion.span>
        <span className="ck-pen__shooter" aria-hidden="true" data-stage={stage} />
        {stage === 'result' && shot && (
          <motion.span
            className={cx('ck-pen__badge', shot.good ? 'is-good' : 'is-bad')}
            initial={rm ? false : { opacity: 0, y: -10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 22 }}
            role="status"
          >
            {shot.scored ? 'Gol!' : 'Defesa!'}
          </motion.span>
        )}
        {aiming && (
          <span className="ck-pen__hint" aria-hidden="true">
            {gk ? 'Escolha o canto para pular' : 'Escolha o canto e bata'}
          </span>
        )}
      </div>
      {others.length > 0 && (
        <div className="ck-pen__others">
          {others.map((o) => (
            <Button key={o.id} variant="ghost" size="sm" disabled={!aiming} className={cx(chosenId === o.id && 'is-chosen')} onClick={() => director.pick(o.id)}>
              {o.title ?? o.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
})

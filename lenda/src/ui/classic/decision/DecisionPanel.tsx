/**
 * Decision card (`.lx-glass` + `.lx-top-light`): kind chip with pulsing dot + step dots
 * ("Decisão 7 de 12"), title, description with bold facts, and the option grid
 * (1 full · 2 side by side · 3 = 2 on top + 1 centred · 4 = 2×2). Penalty decisions render the
 * minigame. While a reveal plays the frozen decision stays on screen with the chosen card lit.
 */
import { Fragment, memo, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { SkipForward } from 'lucide-react'
import type { Decision, DecisionOption } from '@/engine/types'
import { decisionProgress, useCareer } from '@/store/career'
import { Button, Kbd, cx, useIsTouch, useReducedMotion } from '@/ui/primitives'
import { DECISION_KIND_LABEL } from '@/ui/classic/cockpit/model'
import { director } from '@/ui/classic/reveal/director'
import { useReveal } from '@/ui/classic/reveal/store'
import { cardFor, type CardState } from './OptionCards'
import { PenaltyMinigame, isPenaltyDecision } from './PenaltyMinigame'

/** Bold money, placings and counts inside engine copy ("…oferecem **€95M** ao Palmeiras"). */
export function richText(text: string): ReactNode {
  const re = /(€\s?[\d.,]+\s?(?:mil|[KMB])?(?:\/ano)?|\d+º lugar(?: na Bola de Ouro)?|\d+ (?:gols?|títulos?|jogos|temporadas?|anos)|[−-]\d+ OVR|\+\d+ OVR)/g
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0
    if (i > last) out.push(text.slice(last, i))
    out.push(<b key={i}>{m[0]}</b>)
    last = i + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function StepDots({ index, total }: { index: number; total: number }) {
  const n = Math.min(total, 16)
  return (
    <span className="ck-dots" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={cx(i + 1 < index && 'on', i + 1 === index && 'now')} />
      ))}
    </span>
  )
}

export const DecisionPanel = memo(function DecisionPanel({ footer }: { footer?: ReactNode }) {
  const state = useCareer((s) => s.state)
  const busy = useCareer((s) => s.busy)
  const phase = useReveal((s) => s.phase)
  const frozen = useReveal((s) => s.decision)
  const chosenId = useReveal((s) => s.chosenId)
  const rm = useReducedMotion()
  const touch = useIsTouch()
  const revealing = phase !== 'idle'
  const decision: Decision | null = revealing ? frozen : (state?.pendingDecision ?? null)
  // while revealing, the step counter belongs to the decision being resolved
  const prog = decisionProgress(state)
  const index = revealing ? Math.max(1, prog.index - 1) : prog.index
  useRestoreFocus(revealing ? null : (decision?.id ?? null))
  if (!state) return null
  if (!decision) return revealing ? <SimulatingCard /> : null
  const penalty = isPenaltyDecision(decision)

  return (
    <section className="lx-glass lx-top-light ck-decision" aria-labelledby="ck-dtitle" aria-busy={busy || undefined}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={decision.id}
          className="ck-decision__in"
          initial={rm ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.18 } }}
          transition={{ duration: 0.24 }}
        >
          <div className="ck-decision__top">
            <span className="lx-eyebrow ck-kind">
              <span className={cx('lx-dot', !revealing && 'lx-dot--pulse')} style={revealing ? { ['--lx-dot' as string]: 'var(--text-3)' } : undefined} aria-hidden="true" />
              {DECISION_KIND_LABEL[decision.kind] ?? 'Decisão'}
            </span>
            {revealing ? (
              <Button variant="ghost" size="sm" icon={SkipForward} onClick={() => director.skip()} aria-keyshortcuts="Space" className="ck-skip">
                Pular
                {!touch && <Kbd>Espaço</Kbd>}
              </Button>
            ) : (
              <span className="ck-step">
                <StepDots index={index} total={prog.total} />
                {/* shown (CSS) while a card has keyboard focus: the number keys only focus, Enter picks */}
                {!touch && (
                  <span className="ck-step__hint" aria-hidden="true">
                    <Kbd>Enter</Kbd> confirma
                  </span>
                )}
                <span>
                  Decisão {index} de {prog.total}
                </span>
              </span>
            )}
          </div>
          <motion.h2 id="ck-dtitle" className="ck-decision__title" initial={rm ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}>
            {decision.title}
          </motion.h2>
          {decision.description && (
            <motion.p className="ck-decision__sub" initial={rm ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.42, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}>
              {richText(decision.description)}
            </motion.p>
          )}
          {penalty ? (
            <PenaltyMinigame decision={decision} locked={busy || revealing} />
          ) : (
            <OptionGrid decision={decision} chosenId={revealing || busy ? chosenId : null} locked={busy || revealing} />
          )}
          {footer}
        </motion.div>
      </AnimatePresence>
    </section>
  )
})

/** A new decision replaced the one that held focus: hand focus to its first option (keyboard flow). */
function useRestoreFocus(id: string | null) {
  const prev = useRef(id)
  useEffect(() => {
    if (!id) return
    const was = prev.current
    prev.current = id
    if (!was || was === id) return
    const t = setTimeout(() => {
      const a = document.activeElement
      if (a && a !== document.body) return
      ;(document.getElementById('ck-opt-0') as HTMLElement | null)?.focus({ preventScroll: true })
    }, 450)
    return () => clearTimeout(t)
  }, [id])
}

/** Reveal without a frozen decision (restored fixtures): keep the slot filled. */
function SimulatingCard() {
  const reveal = useCareer((s) => s.reveal)
  const touch = useIsTouch()
  const seasons = reveal?.seasons ?? []
  const span = seasons.length ? (seasons.length > 1 ? `${seasons[0].season}–${seasons[seasons.length - 1].season}` : String(seasons[0].season)) : ''
  return (
    <section className="lx-glass lx-top-light ck-decision ck-simulating" aria-live="polite">
      <div className="ck-decision__top">
        <span className="lx-eyebrow ck-kind">
          <span className="lx-dot lx-dot--blink" aria-hidden="true" />
          Simulando
        </span>
        <Button variant="ghost" size="sm" icon={SkipForward} onClick={() => director.skip()} className="ck-skip">
          Pular
          {!touch && <Kbd>Espaço</Kbd>}
        </Button>
      </div>
      <h2 className="ck-decision__title">{seasons.length > 1 ? `Temporadas ${span}` : `Temporada ${span}`}</h2>
      <p className="ck-decision__sub">O mundo está jogando: ligas, copas e prêmios da temporada.</p>
    </section>
  )
}

const OptionGrid = memo(function OptionGrid({ decision, chosenId, locked }: { decision: Decision; chosenId: string | null; locked: boolean }) {
  const rm = useReducedMotion()
  const options = decision.options.slice(0, 4)
  const n = options.length
  const compact = n >= 3
  const onPick = (o: DecisionOption) => void director.pick(o.id)
  const items = useMemo(() => options.map((o) => ({ o, Card: cardFor(decision, o) })), [decision, options])
  return (
    <div className={cx('ck-grid-opts', `is-n${n}`)} role="group" aria-label="Opções">
      {items.map(({ o, Card }, i) => {
        const state: CardState = chosenId ? (o.id === chosenId ? 'chosen' : 'dim') : locked ? 'locked' : 'idle'
        return (
          <Fragment key={o.id}>
            <motion.div
              className={cx('ck-grid-opts__cell', n === 3 && i === 2 && 'is-center')}
              initial={rm ? false : { opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30, delay: 0.12 + i * 0.08 }}
            >
              <Card decision={decision} option={o} index={i} count={n} compact={compact} state={state} onPick={onPick} />
            </motion.div>
          </Fragment>
        )
      })}
    </div>
  )
})

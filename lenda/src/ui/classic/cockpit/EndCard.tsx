/**
 * "Sua carreira chegou ao fim" — replaces the decision card once the career is over:
 * retirement art, the reason, a 4-up stat strip and Ver resumo · Jogar novamente.
 */
import { memo } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, Crown, RotateCcw } from 'lucide-react'
import { navigate } from '@/store/app'
import { useCareer } from '@/store/career'
import { Button, formatInt, useReducedMotion } from '@/ui/primitives'
import { EventArt } from '@/ui/classic/reveal/EventArt'
import { careerTotals, isKeeper } from './model'
import type { CockpitData } from './view'

export const EndCard = memo(function EndCard({ data }: { data: CockpitData }) {
  const { state } = data
  const rm = useReducedMotion()
  const abandon = useCareer((s) => s.abandon)
  const t = careerTotals(state.seasons)
  const gk = isKeeper(state.identity.position)
  const last = state.seasons[state.seasons.length - 1]
  const peak = state.seasons.reduce((a, r) => Math.max(a, r.ovrEnd), 0)
  const cols = gk
    ? [
        ['Jogos', t.apps],
        ['SG', t.cleanSheets],
        ['GS', t.conceded],
        ['Títulos', t.titles],
      ]
    : [
        ['Jogos', t.apps],
        ['Gols', t.goals],
        ['Assist.', t.assists],
        ['Títulos', t.titles],
      ]
  const again = async () => {
    await abandon()
    navigate('/identidade')
  }
  return (
    <motion.section
      className="lx-glass lx-top-light ck-decision ck-end"
      aria-labelledby="ck-end-title"
      initial={rm ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
    >
      <EventArt art="retirement" variant="bg" className="ck-end__art" />
      <div className="ck-end__in">
        <span className="lx-eyebrow ck-kind">
          <Crown aria-hidden="true" className="ck-end__crown" />
          Fim de carreira
        </span>
        <h2 id="ck-end-title" className="ck-end__title">
          Sua carreira chegou ao fim
        </h2>
        <p className="ck-decision__sub">
          {state.retiredReason ?? (last ? `Pendurou as chuteiras aos ${last.age} anos` : 'Carreira encerrada')}
          {peak > 0 && (
            <>
              {' '}
              · auge de <b>{peak} OVR</b>
            </>
          )}
          .
        </p>
        <dl className="ck-end__stats">
          {cols.map(([l, v]) => (
            <div key={l as string}>
              <dt className="lx-eyebrow">{l}</dt>
              <dd className="num">{formatInt(v as number)}</dd>
            </div>
          ))}
        </dl>
        <div className="ck-end__actions">
          <Button variant="primary" size="lg" iconRight={ArrowRight} onClick={() => navigate('/resumo')}>
            Ver resumo
          </Button>
          <Button variant="ghost" size="lg" icon={RotateCcw} onClick={again}>
            Jogar novamente
          </Button>
        </div>
      </div>
    </motion.section>
  )
})

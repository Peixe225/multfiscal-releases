/**
 * Placar da live no topo de cada card de decisão: número + presente da opção + barra + %.
 * Não renderiza nada fora de uma votação.
 */
import { memo } from 'react'
import { useLiveConfig } from '@/live/config'
import { useLive } from '@/live/store'
import { percents } from '@/live/votes'
import { GiftIcon, OPTION_COLORS } from './bits'
import './live.css'

export const VoteBadge = memo(function VoteBadge({ optionId }: { optionId: string }) {
  const round = useLive((s) => (s.round?.kind === 'decision' ? s.round : null))
  const result = useLive((s) => (s.result?.round.kind === 'decision' ? s.result : null))
  const binding = useLiveConfig((s) => s.config.giftBindings)
  const r = round ?? (result && Date.now() - result.at < 5000 ? result.round : null)
  if (!r) return null
  const i = r.options.findIndex((o) => o.id === optionId)
  if (i < 0) return null
  const pct = percents(r)[i]
  const won = !round && result?.outcome.winner === i
  return (
    <span className={`lv-vrow${won ? ' is-won' : ''}`} style={{ ['--oc' as string]: OPTION_COLORS[i] }} aria-label={`Opção ${i + 1} na votação: ${pct}% dos votos`}>
      <b>{i + 1}</b>
      {binding[i] && <GiftIcon name={binding[i]} size={18} />}
      <span className="lv-vrow__bar" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="lv-vrow__p tabular-nums">{pct}%</span>
    </span>
  )
})

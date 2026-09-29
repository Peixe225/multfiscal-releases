/**
 * Bug de placar (canto do campo): competição · casa · placar · visitante · relógio (+acréscimos).
 * Gol: placar pisca ouro e a célula de quem marcou abre com o autor por 4 s. Anúncio aria-live.
 */
import { memo, useEffect, useState, type CSSProperties } from 'react'
import type { LiveMatch, MatchEvent } from '@/engine/immersive/types'
import { clubVars, cx } from '@/ui/primitives'
import { CompLogo } from '../bits'
import { clockText, isGoal, type TeamInfo } from '../model/view'
import { usePlayback } from './playback'

function Clock({ phase }: { phase: LiveMatch['phase'] }) {
  const clock = usePlayback((s) => Math.floor(s.clock * 6) / 6)
  return <span className="num">{phase === 'penalties' ? 'PÊN' : clockText(clock, phase)}</span>
}

export const ScoreBug = memo(function ScoreBug({ live, home, away, score, events, last, seq, className }: { live: LiveMatch; home: TeamInfo; away: TeamInfo; score: [number, number]; events: MatchEvent[]; last: MatchEvent | null; seq: number; className?: string }) {
  const [goal, setGoal] = useState<{ side: 'home' | 'away'; text: string } | null>(null)
  const [announce, setAnnounce] = useState('')
  useEffect(() => {
    if (!last || !isGoal(last)) return
    const side = last.type === 'own_goal' ? (last.side === 'home' ? 'away' : 'home') : last.side
    setGoal({ side, text: `${last.player ?? ''} ${last.minute}'`.trim() })
    const team = side === 'home' ? home : away
    setAnnounce(`Gol do ${team.short}${last.player ? `, ${last.player}` : ''}. ${home.short} ${score[0]}, ${away.short} ${score[1]}.`)
    const t = setTimeout(() => setGoal(null), 4000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq])
  const reds = (side: 'home' | 'away') => events.filter((e) => e.type === 'red' && e.side === side).length
  // durante o replay o motor já pode estar no intervalo/fim: o bug segue o relógio exibido
  const settled = usePlayback((s) => s.settled)
  const shownPhase: LiveMatch['phase'] = settled || live.phase === 'pre' ? live.phase : events.some((e) => e.type === 'half_time') && !events.some((e) => e.type === 'kickoff' && e.minute > 45) ? 'half_time' : 'second_half'
  const phase = shownPhase === 'half_time' ? 'ht' : shownPhase === 'full_time' ? 'ft' : 'live'
  const team = (t: TeamInfo, side: 'home' | 'away') => (
    <span className={cx('lx-bug__team', side === 'home' ? 'is-home' : 'is-away')} style={clubVars(t.colors) as CSSProperties}>
      {side === 'home' && <i className="lx-bug__bar" />}
      {side === 'away' && Array.from({ length: reds('away') }).map((_, i) => <i key={i} className="lx-bug__red" title="Expulso" />)}
      {t.abbr}
      {side === 'home' && Array.from({ length: reds('home') }).map((_, i) => <i key={i} className="lx-bug__red" title="Expulso" />)}
      {side === 'away' && <i className="lx-bug__bar" />}
    </span>
  )
  return (
    <>
      <div className={cx('lx-bug im-bug', goal && 'is-goal', className)} data-phase={phase} data-side-scored={goal?.side} role="group" aria-label={`Placar: ${home.short} ${score[0]} × ${score[1]} ${away.short}`}>
        <span className="lx-bug__comp">
          <CompLogo id={live.competitionId} size={24} />
        </span>
        {team(home, 'home')}
        <span className="lx-bug__score num" key={`${score[0]}-${score[1]}`}>
          <span>{score[0]}</span>
          <i>–</i>
          <span>{score[1]}</span>
        </span>
        {team(away, 'away')}
        <span className="lx-bug__clock">
          <i className="lx-dot-accent" />
          <Clock phase={shownPhase === 'second_half' && !settled ? 'first_half' : shownPhase} />
        </span>
        {live.pens && <span className="lx-bug__extra num">Pên. {live.pens[0]}–{live.pens[1]}</span>}
        {/* autor do gol numa aba sob o placar (dentro da célula do time, cortava a sigla) */}
        {goal && (
          <span className={cx('im-bug__scorer', goal.side === 'away' && 'is-away')} key={seq}>
            <b>Gol</b> {goal.text}
          </span>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </>
  )
})

/**
 * "CAMPEÃO!" — overlay de taça (raios, anéis, halo, confete, taça, placar da final).
 * Portal no <body>; Esc/Enter/Espaço/clique fecham. Movimento reduzido: sem raios/confete.
 */
import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { ImmersiveState, LiveMatch } from '@/engine/immersive/types'
import type { TrophyWin } from '@/engine/types'
import { getCompetition, getLeague, getTrophy } from '@/store/data'
import { clubVars, useMediaQuery, useReducedMotion } from '@/ui/primitives'
import { sfx } from '@/ui/shell/sfx'
import { TrophyArt } from '@/ui/trophies'
import { CompLogo } from '../bits'
import { teamInfo } from '../model/view'

const CONFETTI = ['#F7C948', '#FFEDB0', '#3BE4FF', '#FFFFFF', '#33F0A8']

export function Confetti({ n = 70, seed = 7 }: { n?: number; seed?: number }) {
  const bits = useMemo(() => {
    let x = seed
    const r = () => ((x = (x * 9301 + 49297) % 233280) / 233280)
    return Array.from({ length: n }, (_, i) => ({
      left: r() * 100,
      delay: -r() * 6,
      dur: 4 + r() * 4,
      w: 5 + r() * 7,
      h: 8 + r() * 8,
      c: CONFETTI[i % CONFETTI.length],
    }))
  }, [n, seed])
  return (
    <div className="lx-cele__confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <i key={i} style={{ left: `${b.left}%`, width: b.w, height: b.h, background: b.c, animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s` }} />
      ))}
    </div>
  )
}

export function TrophyCelebration({ trophy, state, lastMatch, onClose }: { trophy: TrophyWin; state: ImmersiveState; lastMatch: LiveMatch | null; onClose: () => void }) {
  const rm = useReducedMotion()
  const phone = useMediaQuery('(max-width: 44.99rem)')
  const ref = useRef<HTMLDivElement>(null)
  const t = getTrophy(trophy.trophyId)
  const comp = getCompetition(trophy.competitionId)
  const league = getLeague(trophy.competitionId)
  const name = t?.name ?? comp?.name ?? league?.name ?? 'Título'
  const team = teamInfo(trophy.teamId)
  const count = state.trophies.filter((x) => x.trophyId === trophy.trophyId).length
  const final = lastMatch && lastMatch.competitionId === trophy.competitionId ? lastMatch : null
  const vars = clubVars(team.colors) as CSSProperties

  useEffect(() => {
    sfx.play('trophy')
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const scorers = final ? final.events.filter((e) => e.type === 'goal' || e.type === 'penalty_goal') : []
  return createPortal(
    <div ref={ref} className="lx-cele im-cele" role="dialog" aria-modal="true" aria-labelledby="im-cele-t" tabIndex={-1} style={vars} onClick={onClose}>
      <div className="im-cele__side is-l" />
      <div className="im-cele__side is-r" />
      {!rm && <div className="lx-cele__rays" />}
      <div className="lx-cele__ring is-outer" />
      <div className="lx-cele__ring" />
      <div className="lx-cele__halo" />
      <div className="lx-cele__flash" />
      {!rm && <Confetti />}
      <div className="im-cele__stage">
        <div className="im-cele__top">
          <CompLogo id={trophy.competitionId} size={44} />
          <div className="im-cele__comp">
            {name}
            <small>
              {final?.stage ?? (trophy.kind === 'league' ? 'Campeão da liga' : 'Título')} · {trophy.season}
            </small>
          </div>
        </div>
        <div className="im-cele__trophy lx-trophy-in">
          <TrophyArt id={trophy.trophyId} size={phone ? 170 : 260} trophy={t} />
        </div>
        <div id="im-cele-t" className="lx-t-celebrate lx-metal-gold lx-gold-glow im-cele__word">
          Campeão!
        </div>
        <div className="im-cele__sub">
          {team.name} levanta a taça · <b>{count}º título</b> de {state.identity.surname}
        </div>
        {final && (
          <div className="im-cele__score">
            <div className="lx-score">
              <div className="lx-score__tm is-home" style={clubVars(teamInfo(final.home.id, final.home).colors) as CSSProperties}>
                {final.home.shortName}
              </div>
              <div className="lx-score__res num">
                {final.score[0]} × {final.score[1]}
              </div>
              <div className="lx-score__tm is-away" style={clubVars(teamInfo(final.away.id, final.away).colors) as CSSProperties}>
                {final.away.shortName}
              </div>
            </div>
            {scorers.length > 0 && (
              <div className="im-cele__goals">
                {scorers.slice(0, 5).map((e, i) => (
                  <span key={i} className={e.byUser ? 'is-me' : undefined}>
                    <b>{e.player ?? '—'}</b> {e.minute}&apos;
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="lx-tap-hint im-cele__tap">Toque para continuar</div>
    </div>,
    document.body,
  )
}


/**
 * "CAMPEÃO!" — overlay de taça (raios, anéis, halo, confete, taça, placar da final).
 * Portal no <body>; Esc/Enter/Espaço/clique fecham. Movimento reduzido: sem raios/confete.
 */
import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Award, Coins, TrendingUp } from 'lucide-react'
import type { ImmersiveState, LiveMatch } from '@/engine/immersive/types'
import type { TrophyWin } from '@/engine/types'
import { getClub, getCompetition, getLeague, getTrophy } from '@/store/data'
import { clubVars, useMediaQuery, useReducedMotion } from '@/ui/primitives'
import { TrophyArt } from '@/ui/trophies'
import { CompLogo, TeamMark } from '../bits'
import { imSfx } from '../hooks'
import { fmtMoney, scoreColors, teamInfo } from '../model/view'

const CONFETTI = ['#F7C948', '#FFEDB0', '#3BE4FF', '#FFFFFF', '#33F0A8']
const PRIZE: Record<string, string> = { ballon_dor: 'Bola de Ouro', league_top_scorer: 'Artilheiro da liga', league_best_player: 'Craque da liga', golden_boot: 'Chuteira de Ouro', golden_glove: 'Luva de Ouro', the_best: 'The Best', kopa: 'Troféu Kopa', puskas: 'Prêmio Puskás', team_of_the_year: 'Seleção do ano', wc_golden_ball: 'Bola de Ouro da Copa', wc_golden_boot: 'Chuteira de Ouro da Copa' }

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
  const rec = state.seasons.find((r) => r.season === trophy.season) ?? state.seasons[state.seasons.length - 1]
  // placar da campanha na liga (pontos do campeão × vice) quando não há "final"
  const table = !final && trophy.kind === 'league' ? (state.world.seasons?.[trophy.season]?.leagues?.[trophy.competitionId]?.table ?? []) : []
  const champRow = table.find((r) => r.clubId === trophy.teamId) ?? table[0]
  const runner = table.find((r) => r.clubId !== champRow?.clubId)
  const runnerTeam = runner ? teamInfo(runner.clubId) : null
  const others = rec ? rec.trophies.filter((x) => !(x.trophyId === trophy.trophyId && x.competitionId === trophy.competitionId)) : []
  const prizes = rec ? rec.awards.filter((a) => a.place === 1) : []
  const ballon = state.world.seasons?.[trophy.season]?.awards?.find((a) => a.award === 'ballon_dor')
  const ballonPlace = ballon ? ballon.ranking.findIndex((r) => r.isUser) + 1 : 0

  useEffect(() => {
    imSfx.play('trophy')
    ref.current?.focus({ preventScroll: true })
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
      {!rm && <Confetti n={phone ? 60 : 110} seed={7} />}
      <div className="im-cele__stage">
        <div className="im-cele__top">
          <CompLogo id={trophy.competitionId} size={phone ? 40 : 56} />
          <div className="im-cele__comp">
            {name}
            <small>
              {final?.stage ?? (trophy.kind === 'league' ? 'Campeão da liga' : 'Título')} · temporada {trophy.season}
            </small>
          </div>
        </div>
        <div className="im-cele__trophy lx-trophy-in">
          <TrophyArt id={trophy.trophyId} size={phone ? 160 : 210} trophy={t} variant="svg" />
          <span className="im-cele__floor" aria-hidden="true" />
        </div>
        <div id="im-cele-t" className="lx-t-celebrate lx-metal-gold lx-gold-glow im-cele__word">
          Campeão!
        </div>
        <div className="im-cele__sub">
          {team.name} levanta a taça · <b>{count}º título</b> de {state.identity.surname}
        </div>
        {final ? (
          <div className="im-cele__score">
            <div className="lx-score">
              <div className="lx-score__tm is-home" style={scoreColors(teamInfo(final.home.id, final.home).colors) as CSSProperties}>
                <span className="truncate">{final.home.shortName}</span>
                <TeamMark team={teamInfo(final.home.id, final.home)} size={36} />
              </div>
              <div className="lx-score__res num">
                {final.score[0]} × {final.score[1]}
              </div>
              <div className="lx-score__tm is-away" style={scoreColors(teamInfo(final.away.id, final.away).colors) as CSSProperties}>
                <TeamMark team={teamInfo(final.away.id, final.away)} size={36} />
                <span className="truncate">{final.away.shortName}</span>
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
        ) : champRow ? (
          <div className="im-cele__score">
            <div className="lx-score">
              <div className="lx-score__tm is-home" style={scoreColors(team.colors) as CSSProperties}>
                <span className="truncate">{team.short}</span>
                <TeamMark team={team} size={36} />
              </div>
              <div className="lx-score__res num im-cele__pts">
                {champRow.points}
                <small>pts</small>
              </div>
              {runnerTeam && runner && (
                <div className="lx-score__tm is-away" style={scoreColors(runnerTeam.colors) as CSSProperties}>
                  <TeamMark team={runnerTeam} size={36} />
                  <span className="truncate">
                    {runnerTeam.short} · {runner.points}
                  </span>
                </div>
              )}
            </div>
            <div className="im-cele__goals">
              <span>
                {champRow.won}V · {champRow.drawn}E · {champRow.lost}D
              </span>
              {runner && (
                <span>
                  <b>{champRow.points - runner.points}</b> pts à frente do vice
                </span>
              )}
              {rec && (
                <span className="is-me">
                  <b>{state.identity.surname}</b> {rec.stats.goals} gols · {rec.stats.assists} assist.
                </span>
              )}
            </div>
          </div>
        ) : null}
        {rec && (
          <div className="im-cele__rewards">
            <span className="im-cele__rw">
              <TrendingUp aria-hidden="true" />
              <span>
                <small>OVR</small>
                <b className="num">
                  {rec.ovrStart} → {rec.ovrEnd}
                </b>
              </span>
            </span>
            <span className="im-cele__rw">
              <Coins aria-hidden="true" />
              <span>
                <small>Valor de mercado</small>
                <b className="num">{fmtMoney(rec.marketValue)}</b>
              </span>
            </span>
            <span className="im-cele__rw">
              <Award aria-hidden="true" />
              <span>
                <small>Bola de Ouro · prévia</small>
                <b>{ballonPlace ? `${ballonPlace}º na votação` : 'Fora do top 10'}</b>
              </span>
            </span>
          </div>
        )}
      </div>
      {(others.length > 0 || prizes.length > 0) && (
        <aside className="lx-plate lx-plate--gold lx-c-md im-cele__also" onClick={(e) => e.stopPropagation()}>
          <span className="lx-kicker lx-kicker--gold">Também nesta temporada</span>
          <ul>
            {others.slice(0, 3).map((o, i) => (
              <li key={`${o.trophyId}-${i}`}>
                <TrophyArt id={o.trophyId} size={30} variant="svg" />
                <b>{getTrophy(o.trophyId)?.name ?? getCompetition(o.competitionId)?.name ?? o.competitionId}</b>
              </li>
            ))}
            {prizes.slice(0, 2).map((p, i) => (
              <li key={`p-${i}`}>
                <TrophyArt id={p.award === 'ballon_dor' ? 'ballon-dor' : p.award === 'league_top_scorer' || p.award === 'golden_boot' ? 'golden-boot' : 'award-generic'} size={30} variant="svg" />
                <b>{PRIZE[p.award] ?? p.award.replace(/_/g, ' ')}</b>
              </li>
            ))}
          </ul>
        </aside>
      )}
      <div className="lx-tap-hint im-cele__tap">Toque para continuar</div>
    </div>,
    document.body,
  )
}

/**
 * "AO VIVO · Líderes de hoje" — the leader of each league from the REAL standings snapshot.
 * Marquee (70 s, pauses on hover/focus); static + horizontally scrollable under reduced motion.
 */
import { memo, useMemo } from 'react'
import { useData } from '@/store/data'
import { buildHash } from '@/store/app'
import { Crest, useReducedMotion } from '@/ui/primitives'
import { LeagueLogo } from '@/ui/shared/live/LeagueLogo'
import { leaderOf, liveLeagues, roundOf } from '@/ui/shared/live/leagues'

export const LiveTicker = memo(function LiveTicker() {
  const data = useData((s) => s.data)
  const index = useData((s) => s.index)
  const rm = useReducedMotion()
  const items = useMemo(() => {
    if (!data || !index) return []
    return liveLeagues(data)
      .filter((l) => l.tier === 1 && !l.stale)
      .slice(0, 12)
      .map((l) => {
        const rows = data.standings[l.id]
        const top = leaderOf(rows)
        const club = top ? index.clubById.get(top.clubId) : undefined
        const snap = data.snapshot?.[l.id]
        const phase = snap?.phase && /apertura|clausura/i.test(snap.phase) ? snap.phase.replace(/\s*\d{4}$/, '') : null
        return top && club ? { league: l, club, pts: top.points, round: roundOf(rows), phase } : null
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
  }, [data, index])

  if (!items.length) return null
  const row = (dup: boolean) =>
    items.map((it) => (
      <a
        key={`${dup ? 'd' : 'a'}-${it.league.id}`}
        className="ld-tk"
        href={buildHash('/ligas', { liga: it.league.id })}
        tabIndex={dup ? -1 : undefined}
        aria-hidden={dup || undefined}
        aria-label={dup ? undefined : `${it.league.shortName}: ${it.club.shortName} lidera com ${it.pts} pontos, rodada ${it.round}`}
      >
        <LeagueLogo league={it.league} size={30} />
        <span>
          <span className="ld-tk__nm block">{it.league.shortName}</span>
          <span className="ld-tk__rd block">{it.phase ? `${it.phase} · ` : ''}Rodada {it.round}</span>
        </span>
        <span className="ld-ld">
          <Crest club={it.club} size={17} decorative />
          {it.club.shortName}
          <b>{it.pts}</b>
          <small>PTS</small>
        </span>
      </a>
    ))
  return (
    <section className="ld-ticker lx-glass" aria-label="Líderes das ligas hoje">
      <div className="ld-ticker__l">
        <span className="lx-dot lx-dot--blink" aria-hidden="true" />
        <div>
          Ao vivo
          <small>Líderes de hoje</small>
        </div>
      </div>
      <div className="lx-marquee no-scrollbar">
        <div className="lx-marquee__row">
          {row(false)}
          {!rm && row(true)}
        </div>
      </div>
    </section>
  )
})

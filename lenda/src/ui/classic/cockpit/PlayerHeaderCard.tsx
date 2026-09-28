/**
 * Career hero card (`.lx-club-card`): OVR metal + delta, flag / #number·position / foot chips,
 * surname, club + league, IDADE and VALOR (with delta). Club-colour gradient + crest watermark.
 * During a reveal: the club crossfades at `identity`, the OVR counts at `overall` (1.7 s, tier
 * flash when the metal changes) and age / value count at `postOverall`.
 */
import { memo, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useClub, useCountry, useLeague } from '@/store/data'
import { Crest, Flag, OvrBadge, clubVars, cx, formatMoney, positionFamily, tierOf, gradeOf, useCountUp, useReducedMotion } from '@/ui/primitives'
import { sfx } from '@/ui/shell/sfx'
import { LeagueLogo } from './bits'
import { FOOT_LABEL } from './model'
import type { CockpitData } from './view'

const BRAND = { primary: '#5c50ff', secondary: '#ffc45c' } as const

function lastLeagueOf(seasons: CockpitData['state']['seasons'], clubId: string): string | undefined {
  for (let i = seasons.length - 1; i >= 0; i--) if (seasons[i].clubId === clubId) return seasons[i].leagueId
  return undefined
}

export const PlayerHeaderCard = memo(function PlayerHeaderCard({ data }: { data: CockpitData }) {
  const { state, previous, gates } = data
  const rm = useReducedMotion()
  const before = previous ?? state
  const clubId = gates.identity ? state.clubId : before.clubId
  const club = useClub(clubId)
  const league = useLeague(club ? (lastLeagueOf(state.seasons, club.id) ?? club.leagueId) : null)
  const country = useCountry(state.identity.nationality)

  // ── OVR ──
  const ovrTarget = gates.overall ? state.ovr : before.ovr
  const last = state.seasons[state.seasons.length - 1]
  const prevSeason = state.seasons[state.seasons.length - 2]
  const idleDelta = last ? last.ovrEnd - last.ovrStart : 0
  const delta = gates.revealing ? (gates.overall ? state.ovr - before.ovr : 0) : idleDelta

  // tier change flash (metal crossfade + sheen fires once)
  const [flash, setFlash] = useState(0)
  const shownTier = useRef(`${tierOf(ovrTarget)}:${gradeOf(ovrTarget)}`)
  const onStep = (v: number) => {
    const k = `${tierOf(v)}:${gradeOf(v)}`
    if (k !== shownTier.current) {
      shownTier.current = k
      setFlash((n) => n + 1)
      sfx.play('unlock')
    }
    sfx.tick()
  }
  useEffect(() => {
    if (!gates.revealing) shownTier.current = `${tierOf(state.ovr)}:${gradeOf(state.ovr)}`
  }, [gates.revealing, state.ovr])

  // ── age / value ──
  const lastBefore = before.seasons[before.seasons.length - 1]
  const ageNow = gates.postOverall ? (last?.age ?? state.age) : (lastBefore?.age ?? before.age)
  const valueNow = gates.postOverall ? state.marketValue : before.marketValue
  const valueDelta = gates.revealing ? (gates.postOverall ? state.marketValue - before.marketValue : 0) : last && prevSeason ? last.marketValue - prevSeason.marketValue : 0
  const age = useCountUp(ageNow, { duration: 700 })
  const value = useCountUp(valueNow, { duration: 700 })

  const fam = positionFamily(state.identity.position)
  const vars = clubVars(club ?? BRAND)

  return (
    <section className="lx-club-card ck-hero" style={vars} aria-label={`${state.identity.surname}, ${club?.name ?? 'sem clube'}, OVR ${state.ovr}`}>
      <div className="lx-club-card__wm ck-hero__wm" aria-hidden="true">
        <AnimatePresence initial={false}>
          <motion.span
            key={clubId ?? 'none'}
            className="ck-hero__wmin"
            initial={rm ? false : { opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {club?.crest && <Crest club={club} size={200} decorative shadow={false} edge="off" />}
          </motion.span>
        </AnimatePresence>
      </div>

      <div className="ck-hero__ovr">
        <OvrBadge
          ovr={ovrTarget}
          size="xl"
          delta={delta || undefined}
          countUp={gates.revealing ? { duration: 1700, onStep } : undefined}
          from={gates.revealing ? before.ovr : undefined}
          className="ck-hero__badge"
        />
        {flash > 0 && <span key={flash} className="ck-tier-flash" aria-hidden="true" />}
      </div>

      <div className="ck-hero__main">
        <div className="ck-hero__chips">
          <span className="lx-chip">
            <Flag code={state.identity.nationality} h={13} w={18} radius={2.5} decorative className="lx-chip__flag" />
            {state.identity.nationality}
          </span>
          <span className={cx('lx-chip', `lx-chip--${fam}`)} title={`Camisa ${state.identity.number} · ${state.identity.position}`}>
            <span className="lx-chip__n">#{state.identity.number}</span>
            {state.identity.position}
          </span>
          <span className="lx-chip lx-chip--muted">{FOOT_LABEL[state.identity.foot]}</span>
        </div>
        <h1 className="ck-hero__name">{state.identity.surname}</h1>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={clubId ?? 'none'}
            className="ck-hero__club"
            initial={rm ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            {club ? (
              <>
                <Crest club={club} size={24} decorative />
                <span className="ck-hero__clubname">{club.name}</span>
                {league && (
                  <span className="ck-hero__league">
                    <LeagueLogo league={league} size={15} />
                    {league.shortName}
                  </span>
                )}
              </>
            ) : (
              <span className="ck-hero__noclub">{country ? `Promessa de ${country.name}` : 'Jovem promessa'} · aguardando a primeira oferta</span>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <dl className="ck-hero__kv">
        <div className="ck-kv">
          <dt className="lx-eyebrow">Idade</dt>
          <dd className="ck-kv__v num">{age}</dd>
        </div>
        <div className="ck-kv">
          <dt className="lx-eyebrow">Valor</dt>
          <dd className="ck-kv__v num">{formatMoney(value)}</dd>
          {valueDelta !== 0 && (
            <dd className={cx('ck-kv__sub', valueDelta < 0 && 'is-down')}>
              {valueDelta > 0 ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
              <span className="lx-sr-only">{valueDelta > 0 ? 'subiu' : 'caiu'}</span>
              {formatMoney(Math.abs(valueDelta))}
            </dd>
          )}
        </div>
      </dl>
    </section>
  )
})

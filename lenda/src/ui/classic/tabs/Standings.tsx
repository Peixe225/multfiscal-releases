/**
 * League table with qualification zones (DESIGN-SPEC-noite §10.8) — # · Clube · Pts · J · V · E · D · SG · Gols.
 * The table is a size container: under ~520px it drops V/E/D/Gols (see tabs.css).
 */
import { Fragment, memo, useMemo, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { ArrowDown, ArrowUp, Trophy as TrophyIcon } from 'lucide-react'
import type { League, LeagueSeasonResult, StandingRow } from '@/engine/types'
import { getClub, useGameData } from '@/store/data'
import { BallIcon, Crest, cx, formatInt, rowClubVars, useReducedMotion, MINUS } from '@/ui/primitives'
import { leagueZones, zoneAt, ZONE_COLOR, type Zone } from './model'
import { You } from './parts'

interface Props {
  result: LeagueSeasonResult
  league: League | undefined
  userClubId?: string | null
  /** Rows around the user only (mini table). */
  window?: number
  animateKey?: string | number
  dense?: boolean
}

export const StandingsTable = memo(function StandingsTable({ result, league, userClubId, window: win, animateKey, dense }: Props) {
  const data = useGameData()
  const rm = useReducedMotion()
  const groups = useMemo(() => splitGroups(result.table), [result.table])
  const grouped = groups.length > 1
  return (
    <div className={cx('tb-st', dense && 'tb-st--dense')} role="table" aria-label={`Classificação${league ? ` — ${league.name}` : ''}`}>
      <div className="tb-st__row tb-st__head" role="row">
        <span role="columnheader" className="tb-st__pos">#</span>
        <span role="columnheader" className="tb-st__club">Clube</span>
        <span role="columnheader" className="tb-st__pts">Pts</span>
        <span role="columnheader" className="tb-c-j" title="Jogos">J</span>
        <span role="columnheader" className="tb-c-x" title="Vitórias">V</span>
        <span role="columnheader" className="tb-c-x" title="Empates">E</span>
        <span role="columnheader" className="tb-c-x" title="Derrotas">D</span>
        <span role="columnheader" className="tb-c-sg" title="Saldo de gols">SG</span>
        <span role="columnheader" className="tb-c-g" title="Gols pró e contra">Gols</span>
      </div>
      {groups.map((g) => {
        const zones = grouped ? [] : leagueZones(data, league, g.rows.length)
        let rows = g.rows.map((r, i) => ({ r, pos: i + 1 }))
        if (win && userClubId) {
          const at = rows.findIndex((x) => x.r.clubId === userClubId)
          if (at >= 0) {
            const from = Math.max(0, Math.min(rows.length - win, at - Math.floor(win / 2)))
            rows = rows.slice(from, from + win)
          } else rows = rows.slice(0, win)
        }
        return (
          <Fragment key={g.name ?? 'all'}>
            {grouped && (
              <div className="tb-st__group" role="row">
                <span role="cell">{g.name}</span>
              </div>
            )}
            {rows.map(({ r, pos }, i) => {
              const z = zoneAt(zones, pos)
              const next = rows[i + 1]
              const nz = next ? zoneAt(zones, next.pos) : undefined
              const cut = next && z?.kind !== nz?.kind ? (z ?? nz) : undefined
              return (
                <Fragment key={r.clubId}>
                  <Row
                    row={r}
                    pos={pos}
                    zone={z}
                    mine={r.clubId === userClubId}
                    champion={result.champion === r.clubId || !!result.champions?.some((c) => c.clubId === r.clubId)}
                    promoted={result.promoted.includes(r.clubId)}
                    relegated={result.relegated.includes(r.clubId)}
                    delay={rm || animateKey === undefined ? 0 : Math.min(i, 24) * 0.014}
                    animateKey={animateKey}
                    rm={rm}
                  />
                  {cut && <div className="tb-st__cut" role="presentation" style={{ '--zc': ZONE_COLOR[cut.kind] } as CSSProperties} />}
                </Fragment>
              )
            })}
          </Fragment>
        )
      })}
    </div>
  )
})

const Row = memo(function Row({
  row,
  pos,
  zone,
  mine,
  champion,
  promoted,
  relegated,
  delay,
  animateKey,
  rm,
}: {
  row: StandingRow
  pos: number
  zone?: Zone
  mine: boolean
  champion: boolean
  promoted: boolean
  relegated: boolean
  delay: number
  animateKey?: string | number
  rm: boolean
}) {
  const club = getClub(row.clubId)
  const sg = row.gf - row.ga
  return (
    <motion.div
      key={animateKey}
      role="row"
      className={cx('tb-st__row lx-club-row', pos % 2 === 1 && 'is-odd', mine && 'lx-club-row--mine is-mine')}
      style={mine ? rowClubVars(club) : undefined}
      initial={rm || animateKey === undefined ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay, ease: [0.16, 1, 0.3, 1] }}
      aria-current={mine ? 'true' : undefined}
    >
      <span role="cell" className="tb-st__pos">
        <i className="tb-zone" style={{ '--zc': zone ? ZONE_COLOR[zone.kind] : 'transparent' } as CSSProperties} title={zone?.label} aria-hidden="true" />
        <span className="num">{pos}</span>
        {zone && <span className="sr-only">({zone.label})</span>}
      </span>
      <span role="cell" className="tb-st__club">
        <Crest club={club} size={20} decorative />
        <span className="tb-st__name">{club?.shortName ?? club?.name ?? row.clubId}</span>
        {champion && (
          <span className="tb-st__champ" title="Campeão">
            <TrophyIcon aria-hidden="true" />
            <span className="sr-only">Campeão</span>
          </span>
        )}
        {promoted && (
          <span className="tb-st__mv is-up" title="Acesso">
            <ArrowUp aria-hidden="true" />
            <span className="sr-only">Acesso</span>
          </span>
        )}
        {relegated && (
          <span className="tb-st__mv is-down" title="Rebaixado">
            <ArrowDown aria-hidden="true" />
            <span className="sr-only">Rebaixado</span>
          </span>
        )}
        {mine && <You>SEU CLUBE</You>}
      </span>
      <span role="cell" className="tb-st__pts num">{row.points}</span>
      <span role="cell" className="tb-c-j">{row.played}</span>
      <span role="cell" className="tb-c-x">{row.won}</span>
      <span role="cell" className="tb-c-x">{row.drawn}</span>
      <span role="cell" className="tb-c-x">{row.lost}</span>
      <span role="cell" className={cx('tb-c-sg', sg > 0 && 'is-pos', sg < 0 && 'is-neg')}>{sg > 0 ? `+${sg}` : sg < 0 ? `${MINUS}${-sg}` : '0'}</span>
      <span role="cell" className="tb-c-g">
        {row.gf}:{row.ga}
      </span>
    </motion.div>
  )
})

function splitGroups(table: StandingRow[]): { name: string | null; rows: StandingRow[] }[] {
  if (!table.some((r) => r.group)) return [{ name: null, rows: table }]
  const m = new Map<string, StandingRow[]>()
  for (const r of table) {
    const k = r.group ?? 'Geral'
    const list = m.get(k) ?? []
    list.push(r)
    m.set(k, list)
  }
  return [...m.entries()].map(([name, rows]) => ({ name, rows }))
}

export function ZoneLegend({ league, teams, note }: { league: League | undefined; teams: number; note?: string }) {
  const data = useGameData()
  const zones = leagueZones(data, league, teams)
  const seen = new Set<string>()
  const items = zones.filter((z) => (seen.has(z.kind) ? false : (seen.add(z.kind), true)))
  return (
    <div className="tb-legend">
      {items.map((z) => (
        <span key={z.kind} className="tb-legend__i">
          <i style={{ background: ZONE_COLOR[z.kind] }} aria-hidden="true" />
          {z.label}
        </span>
      ))}
      <span className="tb-legend__i">
        <TrophyIcon aria-hidden="true" className="tb-legend__ic" /> Campeão
      </span>
      {note && <span className="tb-legend__src">{note}</span>}
    </div>
  )
}

export const TopScorers = memo(function TopScorers({ list, max = 10, userClubId }: { list: LeagueSeasonResult['topScorers']; max?: number; userClubId?: string | null }) {
  const rows = list.slice(0, max)
  const top = rows[0]?.goals || 1
  if (!rows.length) return <p className="tb-muted">Sem artilharia registrada.</p>
  return (
    <ol className="tb-scorers">
      {rows.map((s, i) => {
        const club = getClub(s.clubId)
        const you = !!s.isUser
        return (
          <li key={`${s.name}-${s.clubId}`} className={cx('tb-scorers__row', you && 'is-you lx-club-row lx-club-row--mine')} style={you ? rowClubVars(club) : undefined}>
            <span className={cx('tb-scorers__p num', i < 3 && 'is-top')}>{i + 1}</span>
            <span className="tb-scorers__n">
              <span className="tb-scorers__nm">
                <span className="tb-scorers__name">{s.name}</span>
                {you && <You />}
              </span>
              <span className="tb-scorers__club">
                <Crest club={club} size={14} decorative />
                {club?.shortName ?? ''}
                {s.clubId === userClubId && !you && <span className="sr-only"> (seu clube)</span>}
              </span>
            </span>
            <span className="tb-scorers__bar" aria-hidden="true">
              <i style={{ width: `${Math.max(8, (s.goals / top) * 100)}%` }} />
            </span>
            <span className="tb-scorers__g num">
              {formatInt(s.goals)}
              <BallIcon aria-hidden="true" />
            </span>
          </li>
        )
      })}
    </ol>
  )
})

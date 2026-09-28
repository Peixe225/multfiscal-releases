/**
 * Career table ("Trajetória"): one row per age 16…39, always.
 *   filled   age badge in club colour (YIQ ink) · year (2026 / 2026/27) · ↳ loan · crest · name ·
 *            trophies · tags (ACESSO / REBAIXADO / ARTILHEIRO / BOLA 3º / SUSP) · OVR · J G A
 *   pending  dashed + shimmer, "? Escolhendo clube…" / "Decisão de carreira…", predicted OVR
 *   future   dimmed age + dashed hairline + upcoming tournaments (Copa 2030…)
 * Reveal: "?" mask fades at identity, age badge pops, stats count at stats, trophies drop at
 * trophies (after the overlay), OVR switches at overall. The national-team row closes the table.
 */
import { memo, useMemo, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { CornerDownRight, ArrowDown, ArrowUp, Trophy, Ban } from 'lucide-react'
import type { SeasonRecord } from '@/engine/types'
import { useClub, useGameData } from '@/store/data'
import { AgeBadge, BallIcon, BootIcon, CleanSheetIcon, Crest, Flag, GlovesIcon, OvrPill, ShirtIcon, cx, rowClubVars, useReducedMotion, nationColors } from '@/ui/primitives'
import { useCountry } from '@/store/data'
import { TrophyArt } from '@/ui/trophies'
import { Num } from './bits'
import { buildRows, futureOpacity, isKeeper, nationalLine, rowTags, seasonLabel, seasonShelfItems, type RowTag, type TableRow } from './model'
import type { CockpitData } from './view'
import { useReveal } from '@/ui/classic/reveal/store'

const SPRING = { type: 'spring', stiffness: 420, damping: 22 } as const

export const CareerTable = memo(function CareerTable({ data, compactFuture }: { data: CockpitData; compactFuture?: boolean }) {
  const { state, gates, newSeasons } = data
  const game = useGameData()
  const revealDecision = useReveal((s) => s.decision)
  const finished = state.phase === 'finished' || state.retired
  const rows = useMemo(
    () =>
      buildRows({
        seasons: state.seasons,
        newSeasons,
        pending: gates.revealing || finished ? null : { decision: state.pendingDecision, pace: state.pace, ovr: state.ovr, age: state.age },
        competitions: game?.competitions ?? [],
        nationality: state.identity.nationality,
        finished,
      }),
    [state, newSeasons, gates.revealing, finished, game],
  )
  const gk = isKeeper(state.identity.position)
  const firstNew = rows.find((r) => r.isNew)?.age
  const lastFilled = rows.reduce((a, r) => (r.kind === 'filled' ? r.age : a), 0)
  // phones: hide far-future ages (≥ 30) behind a summary line
  const cut = compactFuture ? Math.max(30, lastFilled + 3) : 99
  const visible = rows.filter((r) => r.kind !== 'future' || r.age < cut)
  const hiddenCount = rows.length - visible.length

  return (
    <div className="ck-table" role="table" aria-label="Trajetória na carreira" aria-rowcount={rows.length + 2}>
      <div className="ck-thead ck-grid" role="row">
        <span role="columnheader" className="ck-thead__age">
          Idade
        </span>
        <span role="columnheader" className="ck-thead__club">
          Clube
        </span>
        <span role="columnheader" className="ck-c">
          OVR
        </span>
        <span role="columnheader" className="ck-c" title="Jogos">
          <ShirtIcon size={12} aria-hidden />
          <span>J</span>
        </span>
        {gk ? (
          <>
            <span role="columnheader" className="ck-c" title="Jogos sem sofrer gol">
              <CleanSheetIcon size={12} aria-hidden />
              <span>SG</span>
            </span>
            <span role="columnheader" className="ck-c" title="Gols sofridos">
              <GlovesIcon size={12} aria-hidden />
              <span>GS</span>
            </span>
          </>
        ) : (
          <>
            <span role="columnheader" className="ck-c" title="Gols">
              <BallIcon size={12} aria-hidden />
              <span>G</span>
            </span>
            <span role="columnheader" className="ck-c" title="Assistências">
              <BootIcon size={12} aria-hidden />
              <span>A</span>
            </span>
          </>
        )}
      </div>
      <div className="ck-rows" role="rowgroup">
        {visible.map((r) =>
          r.kind === 'filled' && r.record ? (
            <FilledRow key={r.age} row={r} rec={r.record} gk={gk} data={data} maskLabel={r.isNew && r.age === firstNew ? revealDecision : undefined} />
          ) : r.kind === 'pending' ? (
            <PendingRow key={r.age} row={r} />
          ) : (
            <FutureRow key={r.age} row={r} />
          ),
        )}
        {hiddenCount > 0 && (
          <div className="ck-rows__more" role="row">
            <span role="cell">
              +{hiddenCount} {hiddenCount === 1 ? 'temporada' : 'temporadas'} pela frente · até os 39
            </span>
          </div>
        )}
      </div>
      <NationalTeamRow data={data} gk={gk} />
    </div>
  )
})

// ───────────────────────── filled ─────────────────────────

const FilledRow = memo(function FilledRow({ row, rec, gk, data, maskLabel }: { row: TableRow; rec: SeasonRecord; gk: boolean; data: CockpitData; maskLabel?: { kind: import('@/engine/types').DecisionKind } | null }) {
  const { gates } = data
  const club = useClub(rec.clubId)
  const rm = useReducedMotion()
  const isNew = row.isNew
  const masked = isNew && !gates.identity
  const showStats = !isNew || gates.stats
  const showTrophies = !isNew || gates.trophies
  const showOvr = !isNew || gates.overall
  const items = seasonShelfItems(rec).filter((i) => i.scope !== 'national')
  const tags = rowTags(rec)
  const vars = rowClubVars(club ?? null) as CSSProperties
  const cls = row.current ? 'lx-club-row--current' : rec.loan ? 'lx-club-row--loan' : 'lx-club-row--filled'
  const year = seasonLabel(rec)
  const s = rec.stats
  const c1 = s.apps
  const c2 = gk ? (s.cleanSheets ?? 0) : s.goals
  const c3 = gk ? (s.conceded ?? 0) : s.assists
  const stagger = items.length > 1 ? Math.min(300 / (items.length - 1), 70) : 0
  const detail = [year, club?.name, rec.leaguePosition ? `${rec.leaguePosition}º na liga` : null, `nota ${String(s.rating.toFixed(1)).replace('.', ',')}`].filter(Boolean).join(' · ')

  return (
    <div role="row" className={cx('ck-row ck-grid lx-club-row', cls, isNew && 'is-new', masked && 'is-masked')} style={vars} title={masked ? undefined : detail}>
      <motion.span
        role="cell"
        className="ck-row__age"
        initial={false}
        animate={isNew && gates.identity && !rm ? { scale: [0.8, 1.08, 1] } : { scale: 1 }}
        transition={{ duration: 0.42, ease: [0.34, 1.56, 0.64, 1] }}
      >
        <AgeBadge age={row.age} club={club ?? undefined} current={row.current} state={masked ? 'pending' : 'filled'} />
      </motion.span>
      <span role="cell" className="ck-row__yr num-ui">
        {year}
      </span>
      <span role="cell" className="ck-row__club">
        {rec.loan && <CornerDownRight className="ck-row__loan" aria-label="Por empréstimo" />}
        <Crest club={club ?? { id: rec.clubId }} size={18} decorative />
        <span className="ck-row__nm">{club?.shortName ?? club?.name ?? '—'}</span>
        {(items.length > 0 || tags.length > 0) && (
          <span className="ck-row__honors">
            {items.map((it, i) => (
              <motion.span
                key={it.key}
                className="ck-row__tr"
                title={`${it.name} ${it.year}`}
                initial={false}
                animate={showTrophies ? { opacity: 1, y: 0 } : { opacity: 0, y: -6 }}
                transition={isNew && !rm ? { ...SPRING, delay: (i * stagger) / 1000 } : { duration: 0 }}
              >
                <TrophyArt id={it.art} size={19} trophy={it.trophy} className="lx-trophy lx-trophy--row" title={it.name} />
              </motion.span>
            ))}
            {tags.map((t) => (
              <RowTagChip key={t.label} tag={t} hidden={isNew && !showTrophies} />
            ))}
          </span>
        )}
      </span>
      <span role="cell" className="ck-row__ovr">
        <OvrCell value={showOvr ? rec.ovrEnd : rec.ovrStart} animate={isNew} />
      </span>
      <span role="cell" className={cx('ck-row__n', c1 === 0 && 'is-zero', !showStats && 'is-hidden')}>
        <Num value={showStats ? c1 : 0} from={isNew ? 0 : undefined} duration={isNew ? 500 : 0} />
      </span>
      <span role="cell" className={cx('ck-row__n', c2 === 0 && 'is-zero', !showStats && 'is-hidden')}>
        <Num value={showStats ? c2 : 0} from={isNew ? 0 : undefined} duration={isNew ? 500 : 0} />
      </span>
      <span role="cell" className={cx('ck-row__n', c3 === 0 && 'is-zero', !showStats && 'is-hidden')}>
        <Num value={showStats ? c3 : 0} from={isNew ? 0 : undefined} duration={isNew ? 500 : 0} />
      </span>
      {isNew && (
        <span className="ck-row__mask" aria-hidden="true">
          <span className="ck-q">?</span>
          {maskLabel && <span className="ck-row__masklabel">{maskText(maskLabel.kind)}</span>}
        </span>
      )}
    </div>
  )
})

function maskText(kind: import('@/engine/types').DecisionKind): string {
  return ['academy', 'transfer', 'loan', 'loan_return', 'non_renewal'].includes(kind) ? 'Escolhendo clube…' : 'Simulando temporada…'
}

function OvrCell({ value, animate }: { value: number; animate: boolean }) {
  return (
    <motion.span
      key={animate ? value : 'static'}
      className="ck-ovrcell"
      initial={animate ? { scale: 0.86, filter: 'brightness(1.8)' } : false}
      animate={{ scale: 1, filter: 'brightness(1)' }}
      transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
    >
      <OvrPill ovr={value} size="sm" />
    </motion.span>
  )
}

function RowTagChip({ tag, hidden }: { tag: RowTag; hidden?: boolean }) {
  const Icon = tag.kind === 'up' ? ArrowUp : tag.kind === 'down' ? ArrowDown : tag.kind === 'susp' ? Ban : Trophy
  return (
    <span
      className={cx('lx-tag ck-tag', tag.kind === 'up' && 'lx-tag--up', tag.kind === 'down' && 'lx-tag--down', tag.kind === 'gold' && 'lx-tag--gold', tag.kind === 'susp' && 'ck-tag--susp', hidden && 'is-hidden')}
      title={tag.title}
      aria-label={tag.title}
    >
      <Icon aria-hidden="true" />
      <span className="ck-tag__t">{tag.label}</span>
    </span>
  )
}

// ───────────────────────── pending / future ─────────────────────────

function PendingRow({ row }: { row: TableRow }) {
  return (
    <div role="row" className={cx('ck-row ck-grid lx-club-row lx-club-row--pending', row.lead && 'lx-shimmer is-lead')} aria-label={row.lead ? `${row.age} anos: ${row.label}` : undefined}>
      <span role="cell" className="ck-row__age">
        <AgeBadge age={row.age} state="pending" />
      </span>
      <span role="cell" className="ck-row__yr num-ui">
        {row.season}
      </span>
      <span role="cell" className="ck-row__club ck-row__pending">
        {row.lead ? (
          <>
            <span className="ck-q ck-q--pulse" aria-hidden="true">
              ?
            </span>
            <span className="ck-row__plabel">{row.label}</span>
          </>
        ) : (
          <>
            <span className="ck-row__pdots" aria-hidden="true" />
            {row.markers.map((m) => (
              <span key={m.label} className={cx('ck-marker', m.kind === 'world_cup' && 'ck-marker--wc')} title={m.title}>
                <Trophy aria-hidden="true" />
                {m.label}
              </span>
            ))}
          </>
        )}
      </span>
      <span role="cell" className="ck-row__ovr">
        {row.lead && row.predictedOvr != null && <OvrPill ovr={row.predictedOvr} size="sm" pending title="OVR atual" />}
      </span>
      <span role="cell" />
      <span role="cell" />
      <span role="cell" />
    </div>
  )
}

function FutureRow({ row }: { row: TableRow }) {
  return (
    <div role="row" className="ck-row ck-grid ck-row--future" style={{ opacity: futureOpacity(row.age) }}>
      <span role="cell" className="ck-row__age">
        <AgeBadge age={row.age} state="empty" />
      </span>
      <span role="cell" className="ck-row__yr num-ui">
        {row.season}
      </span>
      <span role="cell" className="ck-row__club ck-row__future">
        <span className="ck-row__hair" aria-hidden="true" />
        {row.markers.map((m) => (
          <span key={m.label} className={cx('ck-marker', m.kind === 'world_cup' && 'ck-marker--wc')} title={m.title}>
            <Trophy aria-hidden="true" />
            {m.label}
          </span>
        ))}
      </span>
      <span role="cell" />
      <span role="cell" />
      <span role="cell" />
      <span role="cell" />
    </div>
  )
}

// ───────────────────────── national team ─────────────────────────

const NationalTeamRow = memo(function NationalTeamRow({ data, gk }: { data: CockpitData; gk: boolean }) {
  const nat = data.state.identity.nationality
  const stats = nationalLine(data.statSeasons, nat)
  const trophies = nationalLine(data.trophySeasons, nat)
  const country = useCountry(stats.code)
  const called = stats.apps > 0
  const nc = nationColors(country ?? null)
  const style = { ['--nat' as string]: nc.primary, ['--nat-2' as string]: nc.secondary } as CSSProperties
  // goalkeepers: caps · clean sheets are not tracked for the national team → show caps · gols · ast
  void gk
  return (
    <div className={cx('ck-nat', !called && 'is-off')} role="rowgroup" aria-label={called ? `${stats.name}: ${stats.apps} jogos, ${stats.goals} gols, ${stats.assists} assistências` : `${stats.name}: ainda sem convocação`}>
      <div role="row" className="ck-row ck-grid ck-nat__row lx-club-row" style={style}>
        <span role="cell" className="ck-nat__flag">
          <Flag code={stats.code} h={22} w={30} radius={6} decorative />
        </span>
        <span role="cell" className="ck-row__yr num-ui">
          {stats.firstCallUp ? `${stats.firstCallUp}–` : '—'}
        </span>
        <span role="cell" className="ck-row__club">
          <Flag code={stats.code} h={14} w={20} radius={3} decorative className="ck-nat__mini" />
          <span className="ck-row__nm">{stats.name}</span>
          {trophies.trophies.length > 0 && (
            <span className="ck-row__honors">
              {trophies.trophies.map((it) => (
                <span key={it.key} className="ck-row__tr ck-row__tr--nat" title={`${it.name} ${it.year}`}>
                  <TrophyArt id={it.art} size={24} trophy={it.trophy} className="lx-trophy lx-trophy--row" title={it.name} />
                </span>
              ))}
            </span>
          )}
          {trophies.caption ? <span className="ck-nat__cap">{trophies.caption}</span> : !called ? <span className="ck-nat__cap">Aguardando a primeira convocação</span> : null}
        </span>
        <span role="cell" />
        <span role="cell" className={cx('ck-row__n', stats.apps === 0 && 'is-zero')}>
          <Num value={stats.apps} duration={500} />
        </span>
        <span role="cell" className={cx('ck-row__n', stats.goals === 0 && 'is-zero')}>
          <Num value={stats.goals} duration={500} />
        </span>
        <span role="cell" className={cx('ck-row__n', stats.assists === 0 && 'is-zero')}>
          <Num value={stats.assists} duration={500} />
        </span>
      </div>
    </div>
  )
})

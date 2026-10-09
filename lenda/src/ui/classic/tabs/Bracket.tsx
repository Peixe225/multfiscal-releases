/**
 * Knockout bracket (KnockoutStage[] → columns). Works for clubs (crests) and national teams (flags).
 *
 * Layout: every column is a grid with the same height and `repeat(n, 1fr)` rows, so tie i of a
 * column sits exactly between ties 2i and 2i+1 of the previous one; the connectors are pseudo
 * elements of each cell (see tabs.css). Only a consistent chain (n, n/2, …, 1 ties) is drawn as a
 * bracket — anything earlier (qualifying rounds, compacted seasons) is listed under it.
 */
import { memo, useMemo, useState, type CSSProperties } from 'react'
import { ChevronDown } from 'lucide-react'
import type { KnockoutStage } from '@/engine/types'
import { getClub, getCountry } from '@/store/data'
import { cx, rowClubVars, nationColors } from '@/ui/primitives'
import { aggregate, orderBracket, stageShort, teamName } from './model'
import { TeamMark } from './parts'

type Tie = KnockoutStage['ties'][number]

export const Bracket = memo(function Bracket({
  stages,
  highlight,
  maxFirst = 8,
  label,
  showRest = true,
}: {
  stages: KnockoutStage[]
  /** Team id whose path is highlighted (the player's club or nation). */
  highlight?: string | null
  /** Columns with more ties than this start collapsed behind "Mostrar fases anteriores". */
  maxFirst?: number
  label: string
  /** List the stages that are not part of the drawn bracket (path-only / compacted data). */
  showRest?: boolean
}) {
  const [all, setAll] = useState(false)
  const { chain, rest } = useMemo(() => buildChain(stages), [stages])
  const hiddenCount = chain.findIndex((s) => s.ties.length <= maxFirst)
  const shown = all || hiddenCount <= 0 ? chain : chain.slice(hiddenCount)
  const collapsed = chain.length - shown.length
  if (!chain.length) return null
  const rows = shown[0].ties.length
  const hl = highlight ?? null
  const hlVars = hl ? teamVars(hl) : undefined
  return (
    <div className="tb-br-wrap">
      <div className="tb-br no-scrollbar" role="group" aria-label={label} style={{ '--rows': rows, ...hlVars } as CSSProperties}>
        {shown.map((st, k) => (
          <div key={st.name} className={cx('tb-br__col', k > 0 && shown[k - 1].ties.length === st.ties.length * 2 && 'has-in', k < shown.length - 1 && 'has-out')}>
            <div className="tb-br__stage">{stageShort(st.name)}</div>
            <div className="tb-br__cells" style={{ gridTemplateRows: `repeat(${st.ties.length}, minmax(0, 1fr))` }}>
              {st.ties.map((t, i) => (
                <div key={`${t.a}-${t.b}-${i}`} className="tb-br__cell">
                  <TieCard tie={t} highlight={hl} final={k === shown.length - 1 && /final/i.test(st.name) && !/semi/i.test(st.name)} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {collapsed > 0 && (
        <button type="button" className="tb-linkbtn" onClick={() => setAll(true)}>
          <ChevronDown aria-hidden="true" /> Mostrar {collapsed === 1 ? 'fase anterior' : `${collapsed} fases anteriores`}
        </button>
      )}
      {showRest && rest.length > 0 && <EarlierStages stages={rest} highlight={hl} />}
    </div>
  )
})

function buildChain(stages: KnockoutStage[]): { chain: KnockoutStage[]; rest: KnockoutStage[] } {
  const ko = orderBracket(stages)
  if (!ko.length) return { chain: [], rest: [] }
  const chain: KnockoutStage[] = [ko[ko.length - 1]]
  let k = ko.length - 2
  for (; k >= 0; k--) {
    if (ko[k].ties.length === chain[0].ties.length * 2) chain.unshift(ko[k])
    else break
  }
  return { chain, rest: ko.slice(0, k + 1) }
}

function teamVars(id: string): CSSProperties {
  const club = getClub(id)
  if (club) return rowClubVars(club)
  const n = getCountry(id)
  return n ? rowClubVars(nationColors(n)) : {}
}

export const TieCard = memo(function TieCard({ tie, highlight, final }: { tie: Tie; highlight: string | null; final?: boolean }) {
  const g = aggregate(tie)
  const path = !!highlight && (tie.a === highlight || tie.b === highlight)
  const legs = tie.legs.length
  const title = tie.legs
    .map((l, i) => `${legs > 1 ? `${i + 1}º jogo: ` : ''}${teamName(l.home, true)} ${l.score[0]}×${l.score[1]} ${teamName(l.away, true)}${l.pens ? ` (${l.pens[0]}×${l.pens[1]} pên.)` : ''}${l.aet && !l.pens ? ' (prorr.)' : ''}`)
    .join(' · ')
  return (
    <div className={cx('tb-tie', path && 'is-path', final && 'is-final')} title={title}>
      <TieLine id={tie.a} goals={g.a} pens={g.pens?.[0]} won={tie.winner === tie.a} you={tie.a === highlight} />
      <TieLine id={tie.b} goals={g.b} pens={g.pens?.[1]} won={tie.winner === tie.b} you={tie.b === highlight} />
      <span className="sr-only">{title}</span>
    </div>
  )
})

function TieLine({ id, goals, pens, won, you }: { id: string; goals: number; pens?: number; won: boolean; you: boolean }) {
  return (
    <div className={cx('tb-tie__l', won && 'is-won', you && 'is-you')}>
      <TeamMark id={id} size={16} />
      <span className="tb-tie__n">{teamName(id, true)}</span>
      <span className="tb-tie__s num">
        {goals}
        {pens != null && <small>({pens})</small>}
      </span>
    </div>
  )
}

function EarlierStages({ stages, highlight }: { stages: KnockoutStage[]; highlight: string | null }) {
  const [open, setOpen] = useState(false)
  const total = stages.reduce((a, s) => a + s.ties.length, 0)
  return (
    <div className="tb-earlier">
      <button type="button" className="tb-linkbtn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ChevronDown aria-hidden="true" className={cx(open && 'rotate-180')} /> Fases preliminares ({total} {total === 1 ? 'confronto' : 'confrontos'})
      </button>
      {open && (
        <div className="tb-earlier__body">
          {stages.map((st) => (
            <div key={st.name} className="tb-earlier__stage">
              <div className="lx-eyebrow">{st.name}</div>
              <div className="tb-earlier__grid">
                {st.ties.map((t, i) => (
                  <TieCard key={i} tie={t} highlight={highlight} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * "Sua campanha": the highlighted team's tie in every stage, in order. The world engine keeps the
 * early rounds only for the player's club, so this is the complete story of its cup run.
 */
export const CupPath = memo(function CupPath({ stages, team, champion }: { stages: KnockoutStage[]; team: string; champion?: string }) {
  const steps = stages
    .map((st) => ({ st, tie: st.ties.find((t) => t.a === team || t.b === team) }))
    .filter((x): x is { st: KnockoutStage; tie: Tie } => !!x.tie)
  if (!steps.length) return null
  return (
    <ol className="tb-path no-scrollbar" style={teamVars(team)} aria-label="Sua campanha no mata-mata">
      {steps.map(({ st, tie }, i) => {
        const won = tie.winner === team
        const last = i === steps.length - 1
        const title = won ? (last && champion === team ? 'Campeão' : 'Classificado') : 'Eliminado'
        return (
          <li key={st.name} className={cx('tb-path__step', won ? 'is-won' : 'is-out', last && champion === team && 'is-champ')}>
            <div className="tb-path__h">
              <span className="tb-path__stage">{stageShort(st.name)}</span>
              <span className="tb-path__res">{title}</span>
            </div>
            <TieCard tie={tie} highlight={team} />
          </li>
        )
      })}
    </ol>
  )
})

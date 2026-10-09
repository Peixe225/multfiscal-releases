/**
 * Aba "Temporada" do cockpit (DESIGN-SPEC-noite §10.8, season.html).
 *
 *   seletor de temporadas (todas as simuladas) · tabela da liga do jogador com zonas
 *   (Libertadores / Sul-Americana / rebaixamento / acesso…), o clube dele em destaque e outras
 *   ligas selecionáveis · play-offs · "Sua temporada" · artilharia · copas com chaveamento.
 *
 * Reads everything from the stores; rendered inside the cockpit's right panel (a size container).
 */
import { memo, useMemo, useState, type CSSProperties } from 'react'
import { CalendarDays, ChevronDown, ShieldHalf, Trophy as TrophyIcon } from 'lucide-react'
import type { CupResult, League, SeasonRecord, SeasonWorldResult, SquadRole } from '@/engine/types'
import { getClub, getCompetition, getCountry, getLeague, useGameData } from '@/store/data'
import { BallIcon, BootIcon, Crest, OvrBadge, ShirtIcon, cx, formatInt, formatRating, formatSeason, rowClubVars } from '@/ui/primitives'
import { TrophyArt } from '@/ui/trophies'
import {
  AWARD_LABEL,
  compName,
  cupOptions,
  finalTie,
  leagueOptions,
  quickLeagues,
  scoreLine,
  splitPlayoffs,
  stageDepth,
  useSelectedSeason,
  useTabState,
  type CupOption,
} from './model'
import { CompLogo, EmptyTab, SeasonRail, Section, TeamMark, You } from './parts'
import { StandingsTable, TopScorers, ZoneLegend } from './Standings'
import { Bracket, CupPath } from './Bracket'
import './tabs.css'

const ROLE_LABEL: Record<SquadRole, string> = {
  starter: 'titular',
  high_rotation: 'rotação alta',
  low_rotation: 'rotação',
  substitute: 'reserva',
  third_keeper: '3º goleiro',
}

const CONFED_LABEL: Record<string, string> = {
  CONMEBOL: 'América do Sul',
  UEFA: 'Europa',
  CONCACAF: 'Américas do Norte e Central',
  AFC: 'Ásia',
  CAF: 'África',
  OFC: 'Oceania',
}

export function SeasonTab() {
  const state = useTabState()
  const { entries, current, select } = useSelectedSeason(state)
  if (!state || !current) {
    return (
      <EmptyTab icon={<CalendarDays aria-hidden="true" />} title="Nenhuma temporada simulada ainda">
        Faça a primeira escolha da carreira para ver a tabela da liga, as copas e a artilharia.
      </EmptyTab>
    )
  }
  return (
    <div className="tb" data-tab="temporada">
      <SeasonRail entries={entries} value={current.season} onChange={select} />
      <SeasonBody key={current.season} record={current.record} world={current.world} />
    </div>
  )
}

const SeasonBody = memo(function SeasonBody({ record, world }: { record: SeasonRecord; world: SeasonWorldResult | undefined }) {
  const data = useGameData()
  const playerLeague = getLeague(record.leagueId)
  const options = useMemo(() => leagueOptions(world, record.leagueId), [world, record.leagueId])
  const quick = useMemo(() => quickLeagues(options, record.leagueId), [options, record.leagueId])
  const [leagueId, setLeagueId] = useState(record.leagueId)
  const league = getLeague(leagueId) ?? playerLeague
  const result = world?.leagues[leagueId] ?? world?.leagues[record.leagueId]
  const cups = useMemo(() => cupOptions(data, world, record.clubId), [data, world, record.clubId])

  if (!world || !result) {
    return (
      <div className="tb-grid">
        <YourSeason record={record} world={world} />
        <EmptyTab title="Resultados do mundo indisponíveis">
          Esta carreira não guardou a simulação completa de {formatSeason(record.season, playerLeague?.calendar)} — só a sua linha na tabela.
        </EmptyTab>
      </div>
    )
  }

  const seasonLabel = formatSeason(record.season, league?.calendar)
  const first = record.season === 2026 && data?.generatedAt
  const champs = result.champions?.length ? result.champions : [{ name: '', clubId: result.champion }]
  const userPos = result.table.findIndex((r) => r.clubId === record.clubId) + 1
  const playoffs = splitPlayoffs(result.playoffs)
  return (
    <div className="tb-grid tb-grid--season">
      <Section
        className="tb-standings"
        id="tb-standings"
        icon={league ? <CompLogo id={league.id} size={46} /> : undefined}
        title={
          <>
            {league?.name ?? leagueId} <span className="tb-h-year">{seasonLabel}</span>
          </>
        }
        eyebrow={league ? `${getCountry(league.country)?.name ?? ''} · ${league.tier}ª divisão` : undefined}
        aside={
          <LeaguePicker options={options} quick={quick} value={league?.id ?? leagueId} playerLeagueId={record.leagueId} onChange={setLeagueId} />
        }
      >
        <div className="tb-sub">
          {champs.map((c) => (
            <span key={c.name + c.clubId} className="tb-chip tb-chip--gold">
              <TrophyIcon aria-hidden="true" />
              {c.name ? `${c.name}: ` : 'Campeão: '}
              <Crest clubId={c.clubId} size={16} decorative />
              <b>{getClub(c.clubId)?.shortName ?? c.clubId}</b>
            </span>
          ))}
          {userPos > 0 && (
            <span className="tb-chip" style={rowClubVars(getClub(record.clubId))}>
              <ShieldHalf aria-hidden="true" /> Seu clube: <b>{userPos}º</b> · {result.table[userPos - 1].points} pts
            </span>
          )}
          <span className="tb-sub__meta">
            {result.table[0]?.played ?? 0} rodadas · {result.table.length} clubes
          </span>
        </div>
        <StandingsTable result={result} league={league} userClubId={record.clubId} animateKey={`${record.season}-${league?.id}`} />
        <ZoneLegend
          league={league}
          teams={result.table.length}
          note={first ? 'Começou da tabela real de 27/09/2026 · simulação LENDA' : league?.format.playoffTeams ? `${league.format.playoffTeams} vão aos play-offs · simulação LENDA` : 'Simulação LENDA'}
        />
        {playoffs.map((p) => (
          <div key={p.name} className="tb-sub-block">
            <div className="tb-sub-block__h">
              <span className="lx-eyebrow">{p.name === 'Play-offs' ? 'Play-offs' : p.name}</span>
            </div>
            <Bracket stages={p.stages} highlight={record.clubId} label={`${league?.shortName ?? ''} — ${p.name}`} />
          </div>
        ))}
      </Section>

      <div className="tb-side">
        <YourSeason record={record} world={world} />
        <Section title="Artilharia" eyebrow={`${league?.shortName ?? ''} ${seasonLabel}`} icon={<BootIcon aria-hidden="true" />}>
          <TopScorers list={result.topScorers} max={8} userClubId={record.clubId} />
        </Section>
      </div>

      {cups.length > 0 && <Cups cups={cups} record={record} />}
    </div>
  )
})

// ───────────────────────── league picker ─────────────────────────

function LeaguePicker({ options, quick, value, playerLeagueId, onChange }: { options: League[]; quick: League[]; value: string; playerLeagueId: string; onChange: (id: string) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, League[]>()
    for (const l of options) {
      const k = l.confed
      const list = m.get(k) ?? []
      list.push(l)
      m.set(k, list)
    }
    return [...m.entries()]
  }, [options])
  return (
    <div className="tb-lpick">
      <div className="tb-lpick__chips no-scrollbar" role="group" aria-label="Ligas em destaque">
        {quick.map((l) => (
          <button key={l.id} type="button" className={cx('tb-pchip', l.id === value && 'is-on')} aria-pressed={l.id === value} onClick={() => onChange(l.id)} title={l.name}>
            <CompLogo id={l.id} size={16} />
            <span>{l.shortName}</span>
            {l.id === playerLeagueId && <i className="tb-pchip__dot" aria-label="sua liga" />}
          </button>
        ))}
      </div>
      <label className="tb-select">
        <span className="sr-only">Outra liga</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {groups.map(([confed, list]) => (
            <optgroup key={confed} label={CONFED_LABEL[confed] ?? confed}>
              {list.map((l) => (
                <option key={l.id} value={l.id}>
                  {getCountry(l.country)?.name ?? l.country} · {l.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown aria-hidden="true" />
      </label>
    </div>
  )
}

// ───────────────────────── your season card ─────────────────────────

function YourSeason({ record, world }: { record: SeasonRecord; world: SeasonWorldResult | undefined }) {
  const club = getClub(record.clubId)
  const lg = getLeague(record.leagueId)
  const cups = world
    ? Object.values(world.cups)
        .map((c) => ({ c, reached: c.winner === record.clubId ? 'Campeão' : c.reached?.[record.clubId] }))
        .filter((x): x is { c: CupResult; reached: string } => !!x.reached)
        .sort((a, b) => stageDepth(b.reached) - stageDepth(a.reached))
    : []
  const nat = record.national?.tournament
  const s = record.stats
  const gk = record.position === 'GOL'
  return (
    <Section className="tb-you-card" style={rowClubVars(club)} title="Sua temporada" eyebrow={`${formatSeason(record.season, lg?.calendar)} · ${record.age} anos`} tone="club">
      <div className="tb-youline">
        <OvrBadge ovr={record.ovrEnd} size={44} delta={record.ovrEnd - record.ovrStart || undefined} />
        <div className="tb-youline__who">
          <div className="tb-youline__club">
            <Crest club={club} size={18} decorative />
            <b title={club?.name}>{club?.shortName || club?.name || record.clubId}</b>
          </div>
          {/* "empréstimo" fica na linha de baixo: ao lado do nome espremia o clube até "B…" */}
          <div className="tb-youline__meta">
            {record.loan && <span className="tb-mini">empréstimo</span>}
            {ROLE_LABEL[record.role] ?? record.role}
            {record.captain ? ' · capitão' : ''}
            {s.rating ? ` · nota ${formatRating(s.rating)}` : ''}
          </div>
        </div>
        <dl className="tb-mstats">
          <div>
            <dt>
              <ShirtIcon aria-hidden="true" /> Jog
            </dt>
            <dd className="num">{formatInt(s.apps)}</dd>
          </div>
          <div>
            <dt>
              <BallIcon aria-hidden="true" /> {gk ? 'SG' : 'Gol'}
            </dt>
            <dd className="num">{formatInt(gk ? (s.cleanSheets ?? 0) : s.goals)}</dd>
          </div>
          <div>
            <dt>
              <BootIcon aria-hidden="true" /> Ast
            </dt>
            <dd className="num">{formatInt(s.assists)}</dd>
          </div>
        </dl>
      </div>
      <ul className="tb-facts">
        {record.leaguePosition != null && (
          <li>
            <CompLogo id={record.leagueId} size={18} />
            <span className="tb-facts__k">{lg?.shortName ?? 'Liga'}</span>
            <span className="tb-facts__v">
              {record.leaguePosition}º lugar
              {record.promoted && <span className="lx-tag lx-tag--up tb-facts__tag">Acesso</span>}
              {record.relegated && <span className="lx-tag lx-tag--down tb-facts__tag">Rebaixado</span>}
            </span>
          </li>
        )}
        {cups.slice(0, 5).map(({ c, reached }) => (
          <li key={c.competitionId} className={cx(reached === 'Campeão' && 'is-gold')}>
            <CompLogo id={c.competitionId} size={18} />
            <span className="tb-facts__k">{compName(c.competitionId, true)}</span>
            <span className="tb-facts__v">{reached}</span>
          </li>
        ))}
        {nat && (
          <li className={cx(nat.reached === 'Campeão' && 'is-gold')}>
            <CompLogo id={nat.competitionId} size={18} />
            <span className="tb-facts__k">{compName(nat.competitionId, true)}</span>
            <span className="tb-facts__v">{nat.reached}</span>
          </li>
        )}
        {record.awards.map((a) => (
          <li key={a.award + a.year} className={cx(a.place === 1 && 'is-gold')}>
            <TrophyArt id={a.award.replace(/_/g, '-')} size={18} variant="svg" />
            <span className="tb-facts__k">
              {AWARD_LABEL[a.award]} {a.year}
            </span>
            <span className="tb-facts__v">{a.place === 1 ? 'Venceu' : `${a.place}º lugar`}</span>
          </li>
        ))}
        {record.injury && (
          <li className="is-neg">
            <span className="tb-facts__dot" aria-hidden="true" />
            <span className="tb-facts__k">Lesão</span>
            <span className="tb-facts__v">{record.injury.name}</span>
          </li>
        )}
      </ul>
      {record.trophies.length > 0 && (
        <div className="tb-won" aria-label="Títulos da temporada">
          {record.trophies.map((t, i) => (
            <span key={t.trophyId + i} className="tb-won__i" title={getCompetition(t.competitionId)?.name ?? t.trophyId}>
              <TrophyArt id={t.trophyId} size={40} />
            </span>
          ))}
        </div>
      )}
    </Section>
  )
}

// ───────────────────────── cups ─────────────────────────

function Cups({ cups, record }: { cups: CupOption[]; record: SeasonRecord }) {
  const [pick, setPick] = useState(cups[0].id)
  const cur = cups.find((c) => c.id === pick) ?? cups[0]
  const cup = cur.cup
  const comp = getCompetition(cup.competitionId)
  const fin = finalTie(cup)
  const group = cup.groups?.find((g) => g.table.some((r) => r.clubId === record.clubId))
  return (
    <Section
      className="tb-cups"
      title="Copas"
      eyebrow={`Temporada ${formatSeason(record.season, getLeague(record.leagueId)?.calendar)}`}
      icon={<TrophyIcon aria-hidden="true" />}
    >
      <div className="tb-cupchips no-scrollbar" role="tablist" aria-label="Copas da temporada">
        {cups.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={c.id === cur.id}
            className={cx('tb-cupchip', c.id === cur.id && 'is-on', c.champion && 'is-gold')}
            onClick={() => setPick(c.id)}
          >
            <CompLogo id={c.id} size={22} />
            <span className="tb-cupchip__t">
              <b>{compName(c.id, true)}</b>
              <small>{c.reached ?? 'Não disputou'}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="tb-cuphero" style={rowClubVars(getClub(cup.winner))}>
        <span className="tb-cuphero__art lx-trophy-spot lx-trophy-spot--gold">
          <TrophyArt id={comp?.trophyId ?? cup.trophyId ?? 'generic'} size={78} />
        </span>
        <div className="tb-cuphero__t">
          <div className="lx-eyebrow">{comp?.name ?? cup.competitionId}</div>
          <div className="tb-cuphero__champ">
            <TeamMark id={cup.winner} size={28} />
            <b>{getClub(cup.winner)?.name ?? cup.winner}</b>
            {cup.winner === record.clubId && <You>SEU CLUBE</You>}
          </div>
          <div className="tb-cuphero__meta">
            Campeão
            {fin ? (
              <>
                {' '}
                · final {scoreLine(fin, cup.winner)} contra <TeamMark id={cup.runnerUp} size={14} /> {getClub(cup.runnerUp)?.shortName ?? cup.runnerUp}
              </>
            ) : cup.runnerUp ? (
              <> · vice: {getClub(cup.runnerUp)?.shortName ?? cup.runnerUp}</>
            ) : null}
          </div>
        </div>
        {cur.reached && cur.reached !== 'Campeão' && (
          <div className="tb-cuphero__you">
            <span className="lx-eyebrow">Seu clube</span>
            <b>{cur.reached}</b>
          </div>
        )}
      </div>
      {group && (
        <div className="tb-sub-block">
          <div className="tb-sub-block__h">
            <span className="lx-eyebrow">Fase de grupos · {group.name}</span>
          </div>
          <MiniTable rows={group.table} userClubId={record.clubId} />
        </div>
      )}
      {cup.knockout.some((st) => st.ties.some((t) => t.a === record.clubId || t.b === record.clubId)) && (
        <div className="tb-sub-block">
          <div className="tb-sub-block__h">
            <span className="lx-eyebrow">Sua campanha no mata-mata</span>
          </div>
          <CupPath stages={cup.knockout} team={record.clubId} champion={cup.winner} />
        </div>
      )}
      {cup.knockout.length > 0 ? (
        <div className="tb-sub-block">
          <div className="tb-sub-block__h">
            <span className="lx-eyebrow">Chaveamento</span>
          </div>
          <Bracket stages={cup.knockout} highlight={record.clubId} label={`Chaveamento — ${comp?.name ?? ''}`} showRest={false} />
        </div>
      ) : (
        <p className="tb-muted">Sem mata-mata registrado.</p>
      )}
    </Section>
  )
}

function MiniTable({ rows, userClubId }: { rows: { clubId: string; points: number; played: number; gf: number; ga: number }[]; userClubId: string }) {
  return (
    <div className="tb-mini-table" role="table" aria-label="Tabela do grupo">
      {rows.map((r, i) => {
        const club = getClub(r.clubId)
        const mine = r.clubId === userClubId
        return (
          <div key={r.clubId} role="row" className={cx('tb-mini-table__r lx-club-row', mine && 'lx-club-row--mine')} style={mine ? (rowClubVars(club) as CSSProperties) : undefined}>
            <span role="cell" className={cx('num tb-mini-table__p', i < 2 && 'is-q')}>
              {i + 1}
            </span>
            <span role="cell" className="tb-mini-table__n">
              <Crest club={club} size={16} decorative />
              {club?.shortName ?? r.clubId}
            </span>
            <span role="cell" className="num">
              {r.played}
            </span>
            <span role="cell" className="num tb-mini-table__pts">
              {r.points}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default SeasonTab

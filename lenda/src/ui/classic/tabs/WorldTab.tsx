/**
 * Aba "Mundo" do cockpit — o mundo simulado ao redor da carreira.
 *
 *   campeões da temporada (cada competição com escudo + arte do troféu) · torneios de seleções
 *   do ano (Copa do Mundo, Copa América, Euro… com chaveamento) · todas as competições ·
 *   história real + simulada (campeões da Copa, Bola de Ouro, Libertadores, Champions).
 */
import { memo, useMemo, useState } from 'react'
import { Globe, History, ListOrdered, MapPin, Sparkles } from 'lucide-react'
import type { CareerState, CupResult, GameData, NationalTournamentResult, SeasonRecord, SeasonWorldResult } from '@/engine/types'
import { getClub, getCompetition, getCountry, getLeague, useGameData } from '@/store/data'
import { Crest, Flag, cx, nationColors, rowClubVars, useMediaQuery } from '@/ui/primitives'
import { compName, compRank, editionLabel, finalTie, hostNames, isNation, scoreLine, scoreStyle, teamName, useSelectedSeason, useTabState } from './model'
import { CompLogo, EmptyTab, Prize, SeasonRail, Section, TeamMark, You } from './parts'
import { Bracket } from './Bracket'
import './tabs.css'

export function WorldTab() {
  const state = useTabState()
  const { entries, current, select } = useSelectedSeason(state)
  if (!state || !current) {
    return (
      <EmptyTab icon={<Globe aria-hidden="true" />} title="O mundo ainda não girou">
        Depois da primeira temporada aparecem aqui os campeões de todas as ligas e copas, as Copas do Mundo e a história do futebol.
      </EmptyTab>
    )
  }
  return (
    <div className="tb" data-tab="mundo">
      <SeasonRail entries={entries} value={current.season} onChange={select} />
      <WorldBody key={current.season} state={state} record={current.record} world={current.world} />
    </div>
  )
}

interface Champ {
  id: string
  winner: string
  runnerUp?: string
  note?: string
  kind: 'league' | 'cup'
  rank: number
}

function champions(world: SeasonWorldResult): Champ[] {
  const out: Champ[] = []
  for (const l of Object.values(world.leagues)) {
    const lg = getLeague(l.leagueId)
    if (!lg) continue
    const list = l.champions?.length ? l.champions : [{ name: '', clubId: l.champion }]
    list.forEach((c, i) => {
      const row = l.table.find((r) => r.clubId === c.clubId)
      out.push({
        id: l.leagueId,
        winner: c.clubId,
        runnerUp: list.length === 1 ? l.table.find((r) => r.clubId !== c.clubId)?.clubId : undefined,
        note: c.name ? c.name : row ? `${row.points} pts` : undefined,
        kind: 'league',
        rank: compRank(undefined, lg) + i * 0.01,
      })
    })
  }
  const cups: CupResult[] = [...Object.values(world.cups), ...Object.values(world.national)]
  for (const c of cups) {
    const fin = finalTie(c)
    out.push({ id: c.competitionId, winner: c.winner, runnerUp: c.runnerUp, note: fin ? `final ${scoreLine(fin, c.winner)}` : undefined, kind: 'cup', rank: compRank(getCompetition(c.competitionId)) })
  }
  return out.sort((a, b) => a.rank - b.rank)
}

/** "2026" → [2026] · "2026/27" → [2026, 2027]. */
function yearsOf(label: string): number[] {
  const m = /^(\d{4})(?:\/(\d{2}))?$/.exec(label)
  if (!m) return []
  const a = Number(m[1])
  return m[2] ? [a, Math.floor(a / 100) * 100 + Number(m[2])] : [a]
}

const FEATURED_LEAGUES = new Set(['bra.1', 'eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'por.1'])
const FEATURED_CONFEDS = ['uefa.', 'conmebol.']

const WorldBody = memo(function WorldBody({ state, record, world }: { state: CareerState; record: SeasonRecord; world: SeasonWorldResult | undefined }) {
  const data = useGameData()
  const all = useMemo(() => (world ? champions(world) : []), [world])
  const nation = record.nationality ?? state.identity.nationality
  if (!world) {
    return (
      <div className="tb-grid">
        <EmptyTab title="Resultados do mundo indisponíveis">Esta carreira não guardou a simulação completa desta temporada.</EmptyTab>
        <HistoryCard state={state} data={data} nation={nation} />
      </div>
    )
  }
  const playerComps = new Set([record.leagueId, getLeague(record.leagueId)?.domesticCupId])
  const featured = all.filter((c) => {
    const k = getCompetition(c.id)?.kind
    if (k === 'world_cup' || k === 'national_continental' || k === 'club_world_cup') return true
    const major = FEATURED_CONFEDS.some((p) => c.id.startsWith(p))
    if (k === 'continental_primary' && major) return true
    if (k === 'continental_secondary' && major && !getCompetition(c.id)?.superCup) return true
    if (c.kind === 'league' && (FEATURED_LEAGUES.has(c.id) || playerComps.has(c.id))) return true
    return playerComps.has(c.id)
  })
  const nationals = Object.values(world.national).sort((a, b) => compRank(getCompetition(a.competitionId)) - compRank(getCompetition(b.competitionId)))
  const isYou = (c: Champ) => c.winner === record.clubId || c.winner === nation
  // "temporada 2026" (calendário brasileiro) também traz os torneios do meio de 2027 (seleções, Mundial de Clubes)
  const label = editionLabel(record.leagueId, record.season)
  const later = [...new Set(featured.map((c) => editionLabel(c.id, record.season)).filter((y) => /^\d{4}$/.test(y) && !yearsOf(label).includes(Number(y))))].sort()
  return (
    <div className="tb-grid">
      <Section
        title={`Campeões da temporada ${label}`}
        eyebrow={later.length ? `O mundo nesta temporada · inclui os torneios de ${later.join(' e ')}` : 'O mundo nesta temporada'}
        icon={<Sparkles aria-hidden="true" />}
        aside={<span className="tb-count-note">{all.length} competições simuladas</span>}
      >
        <div className="tb-champs">
          {featured.map((c) => (
            <ChampCard key={c.id + c.winner + (c.note ?? "")} c={c} season={record.season} you={isYou(c)} />
          ))}
        </div>
      </Section>
      {nationals.map((n) => (
        <NationalCard key={n.competitionId} t={n} nation={nation} />
      ))}
      <AllComps list={all} season={record.season} isYou={isYou} />
      <HistoryCard state={state} data={data} nation={nation} />
    </div>
  )
})

// ───────────────────────── champion cards ─────────────────────────

const ChampCard = memo(function ChampCard({ c, season, you }: { c: Champ; season: number; you: boolean }) {
  const comp = getCompetition(c.id)
  const lg = getLeague(c.id)
  const trophyId = comp?.trophyId ?? lg?.trophyId ?? ''
  const nat = isNation(c.winner)
  const vars = nat ? rowClubVars(nationColors(getCountry(c.winner))) : rowClubVars(getClub(c.winner))
  // phones: one card per row (trophy on the left), so the names fit whole
  const row = useMediaQuery('(max-width: 35.99rem)')
  return (
    <article className={cx('tb-champ', you && 'is-you')} style={vars}>
      <div className="tb-champ__art lx-trophy-spot lx-trophy-spot--gold">
        <Prize id={trophyId} h={row ? 56 : 78} maxW={row ? 52 : 96} />
      </div>
      <div className="tb-champ__comp">
        <CompLogo id={c.id} size={16} />
        <span>{compName(c.id, true)}</span>
        <small className="num">{editionLabel(c.id, season)}</small>
      </div>
      <div className="tb-champ__win">
        <TeamMark id={c.winner} size={22} />
        <b>{teamName(c.winner)}</b>
        {you && <You />}
      </div>
      <div className="tb-champ__meta">
        {c.note}
        {c.runnerUp && (
          <>
            {c.note ? ' · ' : ''}vice {teamName(c.runnerUp, true)}
          </>
        )}
      </div>
    </article>
  )
})

// ───────────────────────── national tournaments ─────────────────────────

function NationalCard({ t, nation }: { t: NationalTournamentResult; nation: string }) {
  const comp = getCompetition(t.competitionId)
  const year = editionLabel(t.competitionId, t.season)
  const host = hostNames(t.host)
  const hosts = t.host?.split(/[,/]/).filter(Boolean).length ?? 0
  const fin = finalTie(t)
  const reached = t.reached?.[nation] ?? (t.winner === nation ? 'Campeão' : undefined)
  const group = t.groups?.find((g) => g.table.some((r) => r.clubId === nation))
  const colors = nationColors(getCountry(t.winner))
  // phones: the art box is 96px tall — a 120px trophy spilled over "CAMPEÃO"
  const phone = useMediaQuery('(max-width: 35.99rem)')
  return (
    <Section
      className="tb-natcard"
      style={rowClubVars(colors)}
      tone="club"
      title={`${comp?.name ?? t.competitionId} ${year}`}
      eyebrow="Torneio de seleções"
      icon={<CompLogo id={t.competitionId} size={40} />}
      aside={
        host ? (
          <span className="tb-chip tb-chip--wrap">
            <MapPin aria-hidden="true" />
            <span>
              {hosts > 1 ? 'Sedes' : 'Sede'}: <b>{host}</b>
            </span>
          </span>
        ) : undefined
      }
    >
      <div className="tb-nathero">
        <div className="tb-nathero__art lx-trophy-spot lx-trophy-spot--gold">
          <Prize id={comp?.trophyId ?? ''} h={phone ? 92 : 120} maxW={phone ? 68 : 110} />
        </div>
        <div className="tb-nathero__t">
          <div className="lx-eyebrow">Campeão</div>
          <div className="tb-nathero__champ">
            <Flag code={t.winner} h={30} radius={4} decorative />
            <b>{getCountry(t.winner)?.name ?? t.winner}</b>
            {t.winner === nation && <You />}
          </div>
          {fin && (
            <div className="tb-nathero__final">
              Final: <Flag code={t.winner} h={12} decorative /> {scoreLine(fin, t.winner)} <Flag code={t.runnerUp} h={12} decorative /> {getCountry(t.runnerUp)?.name ?? t.runnerUp}
            </div>
          )}
        </div>
        {reached && reached !== 'Campeão' && (
          <div className="tb-cuphero__you">
            <span className="lx-eyebrow">
              <Flag code={nation} h={10} decorative /> Sua seleção
            </span>
            <b>{reached}</b>
          </div>
        )}
      </div>
      {group && !t.knockout.some((st) => st.ties.some((x) => x.a === nation || x.b === nation)) && (
        <div className="tb-sub-block">
          <div className="tb-sub-block__h">
            <span className="lx-eyebrow">Fase de grupos · {group.name}</span>
          </div>
          <div className="tb-mini-table">
            {group.table.map((r, i) => (
              <div key={r.clubId} className={cx('tb-mini-table__r', r.clubId === nation && 'lx-club-row lx-club-row--mine')} style={r.clubId === nation ? rowClubVars(nationColors(getCountry(nation))) : undefined}>
                <span className={cx('num tb-mini-table__p', i < 2 && 'is-q')}>{i + 1}</span>
                <span className="tb-mini-table__n">
                  <Flag code={r.clubId} h={11} decorative /> {getCountry(r.clubId)?.name ?? r.clubId}
                </span>
                <span className="num">{r.played}</span>
                <span className="num tb-mini-table__pts">{r.points}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {t.knockout.length > 0 && (
        <div className="tb-sub-block">
          <div className="tb-sub-block__h">
            <span className="lx-eyebrow">Mata-mata</span>
          </div>
          <Bracket stages={t.knockout} highlight={nation} label={`Chaveamento — ${comp?.name ?? ''} ${year}`} maxFirst={8} />
        </div>
      )}
    </Section>
  )
}

// ───────────────────────── all competitions ─────────────────────────

type Filter = 'ligas' | 'copas' | 'continentais' | 'estaduais'
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ligas', label: 'Ligas' },
  { value: 'copas', label: 'Copas nacionais' },
  { value: 'continentais', label: 'Internacionais' },
  { value: 'estaduais', label: 'Estaduais' },
]

function AllComps({ list, season, isYou }: { list: Champ[]; season: number; isYou: (c: Champ) => boolean }) {
  const [f, setF] = useState<Filter>('ligas')
  const by = (c: Champ): Filter => {
    if (c.kind === 'league') return 'ligas'
    if (c.id.startsWith('bra.camp.')) return 'estaduais'
    return getCompetition(c.id)?.kind === 'domestic_cup' ? 'copas' : 'continentais'
  }
  const rows = list.filter((c) => by(c) === f)
  const filters = FILTERS.filter((x) => list.some((c) => by(c) === x.value))
  return (
    <Section
      title="Todas as competições"
      eyebrow={`${list.length} campeões`}
      icon={<ListOrdered aria-hidden="true" />}
      aside={
        <div className="tb-seg" role="group" aria-label="Filtrar competições">
          {filters.map((x) => (
            <button key={x.value} type="button" aria-pressed={f === x.value} onClick={() => setF(x.value)}>
              {x.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="tb-allc">
        {rows.map((c) => {
          const lg = getLeague(c.id)
          const country = lg ? getCountry(lg.country) : getCountry(getCompetition(c.id)?.country)
          const split = !!c.note && c.kind === 'league' && lg?.tournamentsPerSeason === 2
          return (
            <div key={c.id + c.winner + (c.note ?? "")} className={cx("tb-allc__r", isYou(c) && 'is-you')}>
              <CompLogo id={c.id} size={24} />
              <span className="tb-allc__c">
                <b>{compName(c.id)}</b>
                <small>
                  {country && <Flag code={country.code} h={9} decorative />}
                  {/* one text run (wraps next to the flag); "Apertura 2031" already carries the year */}
                  {`${country?.name ?? ''}${split ? ` · ${c.note}` : ''}${split && /\d{4}/.test(c.note ?? '') ? '' : ` · ${editionLabel(c.id, season)}`}`}
                </small>
              </span>
              <span className="tb-allc__w">
                <TeamMark id={c.winner} size={18} />
                <span>{teamName(c.winner, true)}</span>
                {isYou(c) && <You />}
              </span>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

// ───────────────────────── history (real + simulated) ─────────────────────────

type HistKind = 'wc' | 'bdo' | 'lib' | 'ucl'
interface HistRow {
  year: string
  sort: number
  winner: string
  winnerLabel?: string
  nat?: string
  clubId?: string
  sub?: string
  simulated: boolean
  you?: boolean
  /** Real edition not awarded yet when the data was captured. */
  open?: boolean
}

function HistoryCard({ state, data, nation }: { state: CareerState; data: GameData | null; nation: string }) {
  const [k, setK] = useState<HistKind>('wc')
  const rows = useMemo(() => buildHistory(k, state, data, nation), [k, state, data, nation])
  const tabs: { value: HistKind; label: string }[] = [
    { value: 'wc', label: 'Copa do Mundo' },
    { value: 'bdo', label: 'Bola de Ouro' },
    { value: 'lib', label: 'Libertadores' },
    { value: 'ucl', label: 'Champions' },
  ]
  const sim = rows.filter((r) => r.simulated).length
  return (
    <Section
      title="História"
      eyebrow="Real até 2026 · simulada depois"
      icon={<History aria-hidden="true" />}
      aside={
        <div className="tb-seg" role="group" aria-label="Escolher história">
          {tabs.map((x) => (
            <button key={x.value} type="button" aria-pressed={k === x.value} onClick={() => setK(x.value)}>
              {x.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="tb-hist-meta">
        <span>
          <i className="is-sim" aria-hidden="true" /> {sim} {sim === 1 ? 'edição simulada' : 'edições simuladas'} na sua carreira
        </span>
        <span>
          <i className="is-real" aria-hidden="true" /> {rows.filter((r) => !r.simulated && !r.open).length} reais
        </span>
      </div>
      <ol className="tb-histlist">
        {rows.map((r, i) => (
          <li key={r.year + r.winner + i} className={cx('tb-histlist__r', r.simulated && 'is-sim', r.you && 'is-you')}>
            <span className="tb-histlist__y num">{r.year}</span>
            <span className="tb-histlist__w">
              {r.clubId ? <Crest clubId={r.clubId} size={18} decorative /> : r.nat ? <Flag code={r.nat} h={13} decorative /> : null}
              <b>{r.winnerLabel ?? teamName(r.winner)}</b>
              {r.you && <You />}
            </span>
            <span className="tb-histlist__s">{r.sub}</span>
            <span className={cx('tb-histlist__tag', r.simulated ? 'is-sim' : 'is-real')}>{r.simulated ? 'Simulada' : r.open ? 'Em aberto' : 'Real'}</span>
          </li>
        ))}
      </ol>
    </Section>
  )
}

function buildHistory(k: HistKind, state: CareerState, data: GameData | null, nation: string): HistRow[] {
  const out: HistRow[] = []
  const seasons = Object.values(state.world?.seasons ?? {}).sort((a, b) => a.season - b.season)
  const userClubs = new Map(state.seasons.map((r) => [r.season, r.clubId]))
  const hist = data?.history
  if (k === 'wc') {
    for (const w of hist?.worldCup ?? []) {
      out.push({ year: String(w.year), sort: w.year, winner: w.champion, nat: w.champion, sub: `${w.score ? `${scoreStyle(w.score)} ` : ''}vs ${getCountry(w.runnerUp)?.name ?? w.runnerUp}${w.host ? ` · ${hostNames(w.host)}` : ''}`, simulated: false })
    }
    for (const s of seasons) {
      const t = s.national['fifa.world']
      if (!t) continue
      const fin = finalTie(t)
      const y = s.season + 1
      if (out.some((r) => r.sort === y)) continue
      out.push({
        year: String(y),
        sort: y,
        winner: t.winner,
        nat: t.winner,
        sub: `${fin ? `${scoreLine(fin, t.winner)} ` : ''}vs ${getCountry(t.runnerUp)?.name ?? t.runnerUp}${t.host ? ` · ${hostNames(t.host)}` : ''}`,
        simulated: true,
        you: t.winner === nation && state.national.tournaments.some((x) => x.competitionId === 'fifa.world' && x.year === y),
      })
    }
  } else if (k === 'bdo') {
    for (const b of hist?.ballonDor ?? []) {
      out.push({ year: String(b.year), sort: b.year, winner: b.player, winnerLabel: b.player, nat: b.nationality, sub: getClub(b.club)?.name ?? b.club, simulated: false })
    }
    // a Bola de Ouro 2026 (temporada 2025/26) é entregue depois do retrato dos dados e antes da 1ª simulada (2027)
    const next = hist?.ballonDorShortlist
    if (next && !out.some((r) => r.sort === next.year) && !seasons.some((s) => s.awards.some((a) => a.award === 'ballon_dor' && a.year === next.year))) {
      const day = next.ceremony?.split('-').reverse().join('/')
      out.push({ year: String(next.year), sort: next.year, winner: '', winnerLabel: 'A definir', sub: `${day ? `cerimônia em ${day} · ` : ''}${next.players.length} indicados`, simulated: false, open: true })
    }
    for (const s of seasons) {
      const b = s.awards.find((a) => a.award === 'ballon_dor')
      if (!b || out.some((r) => r.sort === b.year)) continue
      out.push({ year: String(b.year), sort: b.year, winner: b.winner.name, winnerLabel: b.winner.name, nat: b.winner.nationality, sub: getClub(b.winner.clubId)?.name ?? '', simulated: true, you: !!b.winner.isUser })
    }
  } else {
    const id = k === 'lib' ? 'conmebol.libertadores' : 'uefa.champions'
    for (const c of hist?.champions?.[id] ?? []) {
      out.push({ year: editionLabel(id, c.season), sort: c.season, winner: c.winner, clubId: c.winner, simulated: false })
    }
    for (const s of seasons) {
      const c = s.cups[id]
      if (!c || out.some((r) => r.sort === s.season)) continue
      const fin = finalTie(c)
      out.push({
        year: editionLabel(id, s.season),
        sort: s.season,
        winner: c.winner,
        clubId: c.winner,
        sub: fin ? `${scoreLine(fin, c.winner)} vs ${teamName(c.runnerUp, true)}` : c.runnerUp ? `vice ${teamName(c.runnerUp, true)}` : undefined,
        simulated: true,
        you: c.winner === userClubs.get(s.season),
      })
    }
  }
  return out.sort((a, b) => b.sort - a.sort)
}

export default WorldTab

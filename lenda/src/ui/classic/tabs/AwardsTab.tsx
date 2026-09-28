/**
 * Aba "Prêmios" do cockpit (ballondor.html / DESIGN-SPEC-noite §10.6, sem a cerimônia).
 *
 *   Bola de Ouro do ano (top 10, pódio, você em destaque) · seu histórico na Bola de Ouro ·
 *   The Best, Chuteira de Ouro, Luva de Ouro, Kopa, Puskás, prêmios da Copa · craque e
 *   artilheiro de cada liga.
 *
 * A Bola de Ouro do ano T premia a temporada T-1: a temporada selecionada no seletor é a jogada.
 */
import { memo, useMemo, useState, type CSSProperties } from 'react'
import { Award, ChevronDown, Crown, Medal } from 'lucide-react'
import type { AwardId, AwardRankingEntry, AwardResult, CareerState, SeasonRecord, SeasonWorldResult } from '@/engine/types'
import { getClub, getCountry, getLeague } from '@/store/data'
import { BallIcon, Crest, Flag, cx, formatInt, formatSeason, rowClubVars } from '@/ui/primitives'
import { TrophyArt } from '@/ui/trophies'
import {
  AWARD_HINT,
  AWARD_LABEL,
  awardPoints,
  awardTrophyId,
  awardUnit,
  compName,
  globalAwards,
  leagueAwards,
  shortPerson,
  useSelectedSeason,
  useTabState,
} from './model'
import { CompLogo, EmptyTab, Prize, SeasonRail, Section, You } from './parts'
import './tabs.css'

const OTHER_AWARDS: AwardId[] = ['the_best', 'golden_boot', 'wc_golden_ball', 'wc_golden_boot', 'kopa', 'golden_glove', 'puskas']

export function AwardsTab() {
  const state = useTabState()
  const { entries, current, select } = useSelectedSeason(state)
  if (!state || !current) {
    return (
      <EmptyTab icon={<Award aria-hidden="true" />} title="Nenhum prêmio entregue ainda">
        A Bola de Ouro e os prêmios individuais aparecem depois da primeira temporada simulada.
      </EmptyTab>
    )
  }
  return (
    <div className="tb" data-tab="premios">
      <SeasonRail entries={entries} value={current.season} onChange={select} />
      <AwardsBody key={current.season} state={state} record={current.record} world={current.world} />
    </div>
  )
}

const AwardsBody = memo(function AwardsBody({ state, record, world }: { state: CareerState; record: SeasonRecord; world: SeasonWorldResult | undefined }) {
  const all = globalAwards(world)
  const ballon = all.find((a) => a.award === 'ballon_dor')
  const others = OTHER_AWARDS.map((id) => all.find((a) => a.award === id)).filter((a): a is AwardResult => !!a)
  if (!world || !ballon) {
    const mine = record.awards
    return (
      <div className="tb-grid">
        <EmptyTab icon={<Award aria-hidden="true" />} title="Ranking indisponível">
          Esta carreira não guardou a votação completa da temporada {formatSeason(record.season, getLeague(record.leagueId)?.calendar)}.
          {mine.length > 0 && ` Seus prêmios: ${mine.map((a) => `${AWARD_LABEL[a.award]} ${a.place === 1 ? '' : `(${a.place}º)`}`).join(', ')}.`}
        </EmptyTab>
        <BallonHistory state={state} selectedYear={record.season + 1} />
      </div>
    )
  }
  return (
    <div className="tb-grid">
      <BallonCard ballon={ballon} world={world} record={record} />
      <BallonHistory state={state} selectedYear={ballon.year} />
      {others.length > 0 && (
        <div className="tb-awards">
          {others.map((a) => (
            <AwardCard key={a.award} award={a} />
          ))}
        </div>
      )}
      <LeagueAwards world={world} playerLeagueId={record.leagueId} />
    </div>
  )
})

// ───────────────────────── Bola de Ouro ─────────────────────────

function titlesOf(world: SeasonWorldResult, e: AwardRankingEntry): string[] {
  const out: string[] = []
  if (e.clubId) {
    for (const l of Object.values(world.leagues)) if (l.champion === e.clubId || l.champions?.some((c) => c.clubId === e.clubId)) out.push(l.leagueId)
    for (const c of Object.values(world.cups)) if (c.winner === e.clubId && !c.competitionId.startsWith('bra.camp.')) out.push(c.competitionId)
  }
  for (const n of Object.values(world.national)) if (n.winner === e.nationality) out.push(n.competitionId)
  return out
}

function BallonCard({ ballon, world, record }: { ballon: AwardResult; world: SeasonWorldResult; record: SeasonRecord }) {
  const list = ballon.ranking.slice(0, 10)
  const top = list[0]
  const max = top?.score || 1
  const floor = Math.min(...list.map((e) => e.score)) * 0.82
  const ratio = (v: number) => 0.1 + 0.9 * ((v - floor) / Math.max(1e-6, max - floor))
  const youAt = list.findIndex((e) => e.isUser)
  const seasonLabel = formatSeason(record.season, getLeague(record.leagueId)?.calendar)
  return (
    <section className="tb-card tb-card--gold tb-bdo" aria-labelledby="tb-bdo-h">
      <div className="tb-bdo__stage" aria-hidden="true">
        <span className="tb-bdo__glow" />
        <TrophyArt id="ballon-dor" size={200} className="tb-bdo__trophy" />
        <span className="tb-bdo__ped" />
      </div>
      <div className="tb-bdo__main">
        <header className="tb-bdo__h">
          <div>
            <div className="lx-serif-gold tb-bdo__serif">Ballon d'Or</div>
            <h3 id="tb-bdo-h" className="tb-bdo__title">
              Ranking da Bola de Ouro {ballon.year}
            </h3>
            <p className="tb-bdo__sub">Temporada {seasonLabel} · top 10</p>
          </div>
          <span className="tb-bdo__mini" aria-hidden="true">
            <TrophyArt id="ballon-dor" size={64} />
          </span>
        </header>
        {top && <Winner entry={top} world={world} record={record} points={awardPoints('ballon_dor', top.score)} />}
        <ol className="tb-nom" start={2}>
          {list.slice(1).map((e, i) => (
            <Nominee key={e.name + i} entry={e} pos={i + 2} ratio={ratio(e.score)} points={awardPoints('ballon_dor', e.score)} />
          ))}
        </ol>
        {youAt < 0 && (
          <p className="tb-bdo__out">
            <Medal aria-hidden="true" /> Você ficou fora dos 10 finalistas nesta temporada ({formatInt(record.stats.goals)} gols, OVR {record.ovrEnd}).
          </p>
        )}
      </div>
    </section>
  )
}

function Winner({ entry, world, record, points }: { entry: AwardRankingEntry; world: SeasonWorldResult; record: SeasonRecord; points: number }) {
  const club = getClub(entry.clubId)
  const country = getCountry(entry.nationality)
  const titles = titlesOf(world, entry).slice(0, 4)
  return (
    <div className={cx('lx-winner lx-sweep tb-winner', entry.isUser && 'is-you')} style={entry.isUser ? rowClubVars(club) : undefined}>
      <div className="tb-winner__pos lx-metal-text--v" aria-label="1º lugar">
        1º<small>lugar</small>
      </div>
      <div className="tb-winner__who">
        <div className="tb-winner__name">
          <span>{entry.name}</span>
          {entry.isUser && <You />}
        </div>
        <div className="tb-winner__meta">
          <Flag code={entry.nationality} h={14} decorative />
          <span>{country?.name ?? entry.nationality}</span>
          {club && (
            <>
              <i aria-hidden="true">·</i>
              <Crest club={club} size={18} decorative />
              <span>{club.name}</span>
            </>
          )}
        </div>
        <div className="tb-winner__chips">
          {entry.isUser && (
            <span className="tb-gchip">
              <BallIcon aria-hidden="true" /> {formatInt(record.stats.goals)} gols
            </span>
          )}
          {titles.map((id) => (
            <span key={id} className="tb-gchip">
              <CompLogo id={id} size={14} tile={false} /> {compName(id, true)}
            </span>
          ))}
        </div>
      </div>
      <div className="tb-winner__pts">
        <b className="num">{formatInt(points)}</b>
        <span>pontos</span>
      </div>
    </div>
  )
}

function Nominee({ entry, pos, ratio, points, unit = 'pts' }: { entry: AwardRankingEntry; pos: number; ratio: number; points: number; unit?: string | null }) {
  const club = getClub(entry.clubId)
  return (
    <li className={cx('tb-nom__r', pos <= 3 && `is-p${pos}`, entry.isUser && 'is-you lx-club-row lx-club-row--mine')} style={entry.isUser ? rowClubVars(club) : undefined}>
      <span className="tb-nom__p num">{pos}</span>
      <Flag code={entry.nationality} h={16} decorative className="tb-nom__flag" />
      <span className="tb-nom__n">
        <b>{shortPerson(entry.name, 20)}</b>
        {entry.isUser && <You />}
        {club && (
          <span className="tb-nom__club">
            <Crest club={club} size={16} decorative />
            <span>{club.shortName}</span>
          </span>
        )}
      </span>
      <span className="tb-nom__bar" aria-hidden="true">
        <i style={{ width: `${Math.max(4, Math.min(100, ratio * 100))}%` }} />
      </span>
      <span className="tb-nom__v num">
        {formatInt(points)}
        {unit && <small> {unit}</small>}
      </span>
    </li>
  )
}

// ───────────────────────── history strip ─────────────────────────

export function BallonHistory({ state, selectedYear }: { state: Pick<CareerState, 'seasons'> & { world?: CareerState['world'] }; selectedYear: number }) {
  const rows = useMemo(() => {
    const out: { year: number; place: number | null; winner?: AwardRankingEntry }[] = []
    for (const r of state.seasons) {
      const w = state.world?.seasons?.[r.season]
      const b = w?.awards.find((a) => a.award === 'ballon_dor')
      if (!b) {
        const own = r.awards.find((a) => a.award === 'ballon_dor')
        out.push({ year: r.season + 1, place: own?.place ?? null })
        continue
      }
      const i = b.ranking.findIndex((e) => e.isUser)
      out.push({ year: b.year, place: i >= 0 ? i + 1 : null, winner: b.winner })
    }
    return out
  }, [state])
  const best = rows.reduce<number | null>((m, r) => (r.place != null && (m == null || r.place < m) ? r.place : m), null)
  const wins = rows.filter((r) => r.place === 1).length
  const top10 = rows.filter((r) => r.place != null).length
  return (
    <Section
      title="Você na Bola de Ouro"
      eyebrow={`${rows.length} ${rows.length === 1 ? 'votação' : 'votações'}`}
      icon={<Crown aria-hidden="true" />}
      aside={
        <div className="tb-kpis">
          <span>
            <b className="num">{wins}</b> {wins === 1 ? 'vitória' : 'vitórias'}
          </span>
          <span>
            <b className="num">{top10}</b> top 10
          </span>
          <span>
            <b className="num">{best ? `${best}º` : '—'}</b> melhor
          </span>
        </div>
      }
    >
      <ol className="tb-hist no-scrollbar" aria-label="Sua colocação por ano">
        {rows.map((r) => (
          <li key={r.year} className={cx('tb-hist__i', r.place === 1 && 'is-gold', r.place === 2 && 'is-silver', r.place === 3 && 'is-bronze', r.place == null && 'is-none', r.year === selectedYear && 'is-sel')}>
            <span className="tb-hist__y num">{r.year}</span>
            <span className="tb-hist__p num">{r.place != null ? `${r.place}º` : '—'}</span>
            <span className="tb-hist__w" title={r.winner ? `Vencedor: ${r.winner.name}` : undefined}>
              {r.place === 1 ? 'Você' : r.winner ? shortPerson(r.winner.name, 11) : ''}
            </span>
          </li>
        ))}
      </ol>
    </Section>
  )
}

// ───────────────────────── other awards ─────────────────────────

const AWARD_TONE: Partial<Record<AwardId, string>> = {
  the_best: '#6f8cff',
  golden_boot: '#ffd66e',
  golden_glove: '#6cb2ff',
  kopa: '#ff6b81',
  puskas: '#4ce0a0',
  wc_golden_ball: '#3ee6a4',
  wc_golden_boot: '#3ee6a4',
}

const AwardCard = memo(function AwardCard({ award }: { award: AwardResult }) {
  const list = award.ranking.slice(0, 5)
  const w = list[0]
  const unit = awardUnit(award.award)
  const max = w?.score || 1
  const floor = Math.min(...list.map((e) => e.score)) * 0.8
  const pct = (v: number) => 12 + 88 * ((v - floor) / Math.max(1e-6, max - floor))
  const club = getClub(w?.clubId)
  const youWon = !!w?.isUser
  return (
    <article className={cx('tb-card tb-award', youWon && 'is-you')} style={{ '--at': AWARD_TONE[award.award] ?? '#ffd66e', ...(youWon ? rowClubVars(club) : {}) } as CSSProperties}>
      <header className="tb-award__h">
        <span className="tb-award__art lx-trophy-spot">
          <Prize id={awardTrophyId(award.award)} h={58} maxW={64} />
        </span>
        <div className="tb-award__t">
          <h4>{AWARD_LABEL[award.award]}</h4>
          <p>{AWARD_HINT[award.award] ?? `Edição ${award.year}`}</p>
        </div>
        <span className="tb-award__year num">{award.year}</span>
      </header>
      {w && (
        <div className="tb-award__win">
          <Flag code={w.nationality} h={15} decorative />
          <b>{w.name}</b>
          {w.isUser && <You />}
          <span className="tb-award__club">
            {club && <Crest club={club} size={16} decorative />}
            {club?.shortName}
          </span>
          {unit && (
            <span className="tb-award__v num">
              {formatInt(awardPoints(award.award, w.score))}
              <small> {unit}</small>
            </span>
          )}
        </div>
      )}
      <ol className="tb-award__list" start={2}>
        {list.slice(1).map((e, i) => {
          const c = getClub(e.clubId)
          return (
            <li key={e.name + i} className={cx(e.isUser && 'is-you')}>
              <span className="num tb-award__p">{i + 2}</span>
              <Flag code={e.nationality} h={11} decorative />
              <span className="tb-award__n">{shortPerson(e.name, 18)}</span>
              {e.isUser && <You />}
              {c && <Crest club={c} size={13} decorative />}
              {unit && (
                <span className="tb-award__bar" aria-hidden="true">
                  <i style={{ width: `${pct(e.score)}%` }} />
                </span>
              )}
              {unit && <span className="num tb-award__s">{formatInt(awardPoints(award.award, e.score))}</span>}
            </li>
          )
        })}
      </ol>
    </article>
  )
})

// ───────────────────────── league awards ─────────────────────────

function LeagueAwards({ world, playerLeagueId }: { world: SeasonWorldResult; playerLeagueId: string }) {
  const [all, setAll] = useState(false)
  const rows = useMemo(() => {
    const m = leagueAwards(world)
    const list = [...m.entries()]
      .map(([id, v]) => ({ id, league: getLeague(id), ...v }))
      .filter((x) => x.league)
      .sort((a, b) => (a.id === playerLeagueId ? -1 : b.id === playerLeagueId ? 1 : b.league!.coefficient - a.league!.coefficient))
    return list
  }, [world, playerLeagueId])
  if (!rows.length) return null
  const shown = all ? rows : rows.slice(0, 8)
  return (
    <Section title="Prêmios das ligas" eyebrow="Craque e artilheiro de cada liga" icon={<Award aria-hidden="true" />}>
      <div className="tb-lga" role="table" aria-label="Prêmios das ligas">
        <div className="tb-lga__r tb-lga__head" role="row">
          <span role="columnheader">Liga</span>
          <span role="columnheader">Craque</span>
          <span role="columnheader">Artilheiro</span>
        </div>
        {shown.map((r) => {
          const best = r.best?.winner
          const sc = r.scorer?.winner
          return (
            <div key={r.id} role="row" className={cx('tb-lga__r', r.id === playerLeagueId && 'is-mine')}>
              <span role="cell" className="tb-lga__l">
                <CompLogo id={r.id} size={22} />
                <span>{r.league!.shortName}</span>
              </span>
              <span role="cell" data-k="Craque" className={cx('tb-lga__p', best?.isUser && 'is-you')}>
                {best ? <Person e={best} /> : '—'}
              </span>
              <span role="cell" data-k="Artilheiro" className={cx('tb-lga__p', sc?.isUser && 'is-you')}>
                {sc ? (
                  <>
                    <Person e={sc} />
                    <span className="tb-lga__g num">
                      {sc.score}
                      <BallIcon aria-hidden="true" />
                    </span>
                  </>
                ) : (
                  '—'
                )}
              </span>
            </div>
          )
        })}
      </div>
      {rows.length > 8 && (
        <button type="button" className="tb-linkbtn" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          <ChevronDown aria-hidden="true" className={cx(all && 'rotate-180')} /> {all ? 'Mostrar menos' : `Ver todas as ligas (${rows.length})`}
        </button>
      )}
    </Section>
  )
}

function Person({ e }: { e: AwardRankingEntry }) {
  const c = getClub(e.clubId)
  return (
    <span className="tb-person">
      {c ? <Crest club={c} size={16} decorative /> : <Flag code={e.nationality} h={12} decorative />}
      <span className="tb-person__n">{shortPerson(e.name, 18)}</span>
      {e.isUser && <You />}
    </span>
  )
}

export default AwardsTab

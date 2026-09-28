/**
 * "Ligas ao vivo" (route "#/ligas?liga=<leagueId>").
 * The REAL standings snapshot from GameData with qualification/relegation zones, plus
 * "Atualizar agora" → live ESPN standings (matched to our clubs by ESPN id).
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { AlertTriangle, ArrowDown, ArrowUp, CalendarDays, LayoutGrid, RefreshCw } from 'lucide-react'
import type { Club, GameData, League } from '@/engine/types'
import { navigate, useApp } from '@/store/app'
import { useCareer } from '@/store/career'
import { useData } from '@/store/data'
import { Button, Crest, CrestFallback, Eyebrow, Flag, Glass, LivePill, Modal, Skeleton, YouBadge, cx, formatSeason, signed, toast, useReducedMotion } from '@/ui/primitives'
import { useShellSlots } from '@/ui/shell/slots'
import { clubColors } from '@/ui/theme/club'
import '@/ui/shared/landing/landing.css'
import { LIVE_ERROR_TEXT, relTime, shortDay, useLive, type LiveTeam } from './espn'
import { LeagueLogo } from './LeagueLogo'
import { groupRows, liveLeagues, roundOf, shortDate, zoneLegend, zonesFor, type Zone } from './leagues'
import '@/ui/shared/achievements/unlockToasts'
import './live.css'

const REGIONS: { key: string; label: string; test: (l: League) => boolean }[] = [
  { key: 'bra', label: 'Brasil', test: (l) => l.country === 'BRA' },
  { key: 'sa', label: 'América do Sul', test: (l) => l.confed === 'CONMEBOL' && l.country !== 'BRA' },
  { key: 'eu', label: 'Europa', test: (l) => l.confed === 'UEFA' },
  { key: 'na', label: 'Américas do Norte e Central', test: (l) => l.confed === 'CONCACAF' },
  { key: 'as', label: 'Ásia, Oceania e África', test: (l) => l.confed === 'AFC' || l.confed === 'OFC' || l.confed === 'CAF' },
]

const canRefreshSource = (l: { espnSlug?: string | null }) => !!l.espnSlug

function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const h = window.setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(h)
  }, [ms])
  return now
}

function TeamCrest({ club, extra, size = 20 }: { club?: Club; extra?: LiveTeam; size?: number }) {
  if (club) return <Crest club={club} size={size} decorative />
  if (extra?.logo) return <img src={extra.logo} alt="" width={size} height={size} className="object-contain flex-none" loading="lazy" />
  return <CrestFallback abbr={extra?.abbr || '?'} primary="#3a3f4d" secondary="#8a8f9c" size={size} />
}

function NextFixtures({ league, data }: { league: League; data: GameData }) {
  const index = useData((s) => s.index)
  const days = useMemo(() => {
    const list = (data.fixtures[league.id] ?? []).filter((f) => f.date && !f.score)
    const ref = Math.max(Date.now(), new Date(data.generatedAt).getTime()) - 6 * 3600e3
    const next = list
      .filter((f) => new Date(f.date!).getTime() >= ref)
      .sort((a, b) => a.date!.localeCompare(b.date!))
      .slice(0, 8)
    const byDay = new Map<string, typeof next>()
    for (const f of next) {
      const k = new Date(f.date!).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '').replace(/ de /g, ' ')
      if (!byDay.has(k)) byDay.set(k, [])
      byDay.get(k)!.push(f)
    }
    return [...byDay.entries()]
  }, [league.id, data])
  if (!days.length) return null
  return (
    <Glass className="lv-sc" padding="none">
      <div className="lv-sc__h">
        <h3>Próximos jogos</h3>
        <span className="lv-sc__k">
          <CalendarDays size={12} className="inline -mt-0.5 mr-1" aria-hidden />
          Calendário real
        </span>
      </div>
      {days.map(([day, list]) => (
        <div key={day}>
          <div className="lv-day">{day}</div>
          {list.map((f) => {
            const h = index?.clubById.get(f.home)
            const a = index?.clubById.get(f.away)
            return (
              <div key={`${f.home}-${f.away}-${f.date}`} className="lv-fx">
                <span className="lv-fx__t">{new Date(f.date!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="lv-fx__c justify-end text-right">
                  <span>{h?.shortName ?? f.home}</span>
                  <TeamCrest club={h} size={18} />
                </span>
                <span className="lv-fx__x" aria-label="contra">
                  ×
                </span>
                <span className="lv-fx__c lv-fx__c--a">
                  <TeamCrest club={a} size={18} />
                  <span>{a?.shortName ?? f.away}</span>
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </Glass>
  )
}

function LeagueFacts({ league, data, zones, counts }: { league: League; data: GameData; zones: Zone[]; counts: Record<string, number> }) {
  const index = useData((s) => s.index)
  const country = index?.countryByCode.get(league.country)
  const champs = data.history?.champions?.[league.id] ?? []
  const last = [...champs].sort((a, b) => b.season - a.season)[0]
  const champClub = last ? index?.clubById.get(last.winner) : undefined
  const clubs = index?.clubsByLeague.get(league.id)?.length ?? data.standings[league.id]?.length ?? 0
  return (
    <Glass className="lv-sc" padding="none">
      <div className="lv-sc__h">
        <h3>Sobre a liga</h3>
        <span className="lv-sc__k">{league.tier}ª divisão</span>
      </div>
      <dl className="lv-facts">
        {country && (
          <div className="lv-fact">
            <dt>País</dt>
            <dd>
              <Flag code={country.code} iso2={country.iso2} h={13} decorative />
              {country.name}
            </dd>
          </div>
        )}
        <div className="lv-fact">
          <dt>Clubes</dt>
          <dd>{clubs}</dd>
        </div>
        <div className="lv-fact">
          <dt>Força da liga</dt>
          <dd>{Math.round(league.coefficient * 100)}/100</dd>
        </div>
        {zones.map((z) => (
          <div key={z.label} className="lv-fact">
            <dt>
              <span className="lx-zone" style={{ ['--zc' as string]: z.color, height: 14 }} />
              {z.label}
            </dt>
            <dd>{counts[z.label] ? `${counts[z.label]} ${counts[z.label] === 1 ? 'vaga' : 'vagas'}` : ''}</dd>
          </div>
        ))}
        {last && (
          <div className="lv-fact">
            <dt>Último campeão</dt>
            <dd>
              {champClub && <Crest club={champClub} size={18} decorative />}
              {champClub?.shortName ?? last.winner} · {formatSeason(last.season, league.calendar)}
            </dd>
          </div>
        )}
      </dl>
    </Glass>
  )
}

export default function LiveLeaguesScreen() {
  const rm = useReducedMotion()
  const data = useData((s) => s.data)
  const index = useData((s) => s.index)
  const query = useApp((s) => s.route.query)
  const myClubId = useCareer((s) => (s.state && !s.isFixture ? s.state.clubId : s.state?.clubId ?? null))
  const leagues = useMemo(() => liveLeagues(data), [data])
  const league = leagues.find((l) => l.id === query.liga) ?? leagues[0]
  const [allOpen, setAllOpen] = useState(false)
  const now = useNow()
  const table = useLive((s) => (league ? s.tables[league.id] : undefined))
  const status = useLive((s) => (league ? s.status[league.id] : undefined))
  const error = useLive((s) => (league ? s.errors[league.id] : undefined))
  const blocked = useLive((s) => s.blocked)
  const myClub = myClubId ? index?.clubById.get(myClubId) : undefined

  useShellSlots({ sub: 'LIGAS AO VIVO', stage: { preset: myClub ? 'club' : 'brand', club: myClub } }, [myClub?.id])

  useEffect(() => {
    if (league) useLive.getState().hydrate(league.id)
  }, [league])

  const view = useMemo(() => {
    if (!data || !league) return null
    const snapRows = data.standings[league.id] ?? []
    const rows = table?.rows?.length ? table.rows : snapRows
    const groups = groupRows(rows, table?.rank)
    const snapGroups = groupRows(snapRows)
    const snapRank = new Map<string, number>()
    const snapRow = new Map(snapRows.map((r) => [r.clubId, r]))
    for (const g of snapGroups) g.rows.forEach((r, i) => snapRank.set(r.clubId, i + 1))
    const size = groups[0]?.rows.length ?? 0
    const grouped = groups.length > 1
    const zones = grouped ? [] : zonesFor(league, size, data)
    const counts: Record<string, number> = {}
    for (const z of zones) if (z) counts[z.label] = (counts[z.label] ?? 0) + 1
    return { rows, groups, zones, legend: zoneLegend(zones), counts, snapRank, snapRow, round: roundOf(rows), grouped }
  }, [data, league, table])

  if (!data || !index || !league || !view) {
    return (
      <main id="conteudo" tabIndex={-1} className="lv-wrap outline-none" aria-busy="true">
        <Skeleton h={60} r={16} />
        <div className="mt-3">
          <Skeleton h={520} r={22} />
        </div>
      </main>
    )
  }

  const snap = data.snapshot?.[league.id]
  const season = formatSeason(snap?.season ?? 2026, league.calendar)
  const phase = snap?.phase && snap.phase !== String(snap.season) && snap.phase !== season ? snap.phase : null
  const live = !!table
  const updatedTs = table?.fetchedAt ?? new Date(data.generatedAt).getTime()
  const canRefresh = !!league.espnSlug && !blocked
  /** A tabela que continua na tela quando a ESPN falha ("27/09"). */
  const shownDay = shortDay(updatedTs)
  const liveNote = status === 'error' && error ? error : blocked && canRefreshSource(league) ? LIVE_ERROR_TEXT.blocked : null
  const loading = status === 'loading'

  const refresh = async () => {
    if (!league.espnSlug) return
    const before = table?.rows ?? data.standings[league.id] ?? []
    const res = await useLive.getState().refresh(league.id, league.espnSlug, index.clubsByLeague.get(league.id) ?? data.clubs)
    if (res) {
      const prev = new Map(before.map((r) => [r.clubId, r.points]))
      const changed = res.rows.filter((r) => prev.has(r.clubId) && prev.get(r.clubId) !== r.points).length
      toast.success(`${league.shortName} atualizada`, changed ? `${changed} ${changed === 1 ? 'clube mudou' : 'clubes mudaram'} de pontuação.` : 'Nenhuma mudança desde a última tabela.')
    }
  }

  const pick = (id: string) => navigate('/ligas', { query: { liga: id }, replace: true })
  const regionsOf = REGIONS.map((r) => ({ ...r, leagues: leagues.filter(r.test) })).filter((r) => r.leagues.length)
  const featured = leagues.slice(0, 11)
  const featuredIds = new Set(featured.map((l) => l.id))
  const chipList = [...featured, ...(featuredIds.has(league.id) ? [] : [league])]

  return (
    <main id="conteudo" tabIndex={-1} className="lv-wrap outline-none">
      <div className="lv-head">
        <div>
          <Eyebrow>Temporada 2026 · tabelas reais</Eyebrow>
          <h1>Ligas ao vivo</h1>
          <p>
            A classificação de hoje de {leagues.length} ligas — o ponto de partida da sua carreira. Atualize direto da ESPN para ver a rodada mais recente.
          </p>
        </div>
        <LivePill blink>{live ? `Ao vivo · ESPN ${relTime(updatedTs, now)}` : `Tabelas reais de ${shortDate(data.generatedAt)}`}</LivePill>
      </div>

      <div className="lv-chips-wrap">
        <div className="lv-chips" role="group" aria-label="Escolha a liga">
          {chipList.map((l, i) => (
            <span key={l.id} className="contents">
              {i === featured.length && <span className="lv-chip__sep" aria-hidden="true" />}
              <button type="button" className="lv-chip" aria-pressed={l.id === league.id} onClick={() => pick(l.id)}>
                <LeagueLogo league={l} size={26} />
                {l.shortName}
              </button>
            </span>
          ))}
          <button type="button" className="lv-chip sm:hidden" onClick={() => setAllOpen(true)}>
            <LayoutGrid size={16} aria-hidden className="ml-1.5" />
            Todas
          </button>
        </div>
        <div className="lv-chips__more">
          <Button variant="ghost" size="sm" icon={LayoutGrid} onClick={() => setAllOpen(true)}>
            Todas as ligas
          </Button>
        </div>
      </div>

      <div className="lv-grid">
        <motion.section
          key={league.id}
          className="lv-card lx-glass"
          aria-labelledby="lv-title"
          initial={rm ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="lv-th">
            <LeagueLogo league={league} size={46} />
            <div className="min-w-0">
              <h2 id="lv-title">
                {league.name} {season}
              </h2>
              <div className="lv-th__sub">
                <LivePill>{live ? 'Ao vivo · ESPN' : 'Tabela real de hoje'}</LivePill>
                <span>
                  {phase ? `${phase} · ` : ''}
                  {view.grouped ? `${view.round} jogos` : `Rodada ${view.round}${snap?.gamesPerTeam ? ` de ${snap.gamesPerTeam}` : ''}`}
                  {!live && ` · ${new Date(data.generatedAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' }).replace(/\./g, '').replace(/ de /g, ' ')}`}
                </span>
              </div>
            </div>
            <div className="lv-refresh">
              <span className="lv-refresh__t" aria-live="polite">
                <b>{loading ? 'Buscando na ESPN…' : live ? 'ESPN ao vivo' : 'Snapshot do jogo'}</b>
                atualizado {relTime(updatedTs, now)}
              </span>
              <Button variant="ghost" size="sm" icon={RefreshCw} onClick={refresh} disabled={!canRefresh || loading} className={cx(loading && 'lv-btn-spin')} title={blocked ? 'Atualização ao vivo indisponível neste ambiente' : canRefresh ? 'Buscar a tabela mais recente na ESPN' : 'Liga sem fonte ao vivo'}>
                {loading ? 'Atualizando…' : blocked ? 'Sem acesso à ESPN' : 'Atualizar agora'}
              </Button>
            </div>
          </div>

          {league.stale && !live && (
            <p className="lv-note">
              <AlertTriangle size={16} className="flex-none mt-0.5" aria-hidden />A ESPN ainda não publicou a temporada atual desta liga. No jogo, ela começa do zero.
            </p>
          )}
          {liveNote && (
            <p className={cx('lv-note', status === 'error' && 'lv-note--err')} role={status === 'error' ? 'alert' : undefined}>
              <AlertTriangle size={16} className="flex-none mt-0.5" aria-hidden />
              <span>
                {liveNote} <b>Mostrando a tabela {live ? 'ao vivo' : 'real'} de {shownDay}.</b>
              </span>
            </p>
          )}

          <div role="table" aria-label={`Classificação ${league.name}`} aria-rowcount={view.rows.length + 1}>
            <div className="lv-row lv-row--h" role="row">
              <span role="columnheader">#</span>
              <span role="columnheader">Clube</span>
              <span role="columnheader" title="Pontos">
                Pts
              </span>
              <span role="columnheader" title="Jogos">
                J
              </span>
              <span role="columnheader" className="lv-hide-sm" title="Vitórias">
                V
              </span>
              <span role="columnheader" className="lv-hide-sm" title="Empates">
                E
              </span>
              <span role="columnheader" className="lv-hide-sm" title="Derrotas">
                D
              </span>
              <span role="columnheader" title="Saldo de gols">
                SG
              </span>
              <span role="columnheader" className="lv-hide-sm" title="Gols pró e contra">
                Gols
              </span>
            </div>
            {view.groups.map((g) => (
              <div key={g.name ?? 'all'} role="rowgroup">
                {g.name && <div className="lv-group-h">{g.name}</div>}
                <div className="lv-body">
                  {g.rows.map((r, i) => {
                    const pos = i + 1
                    const zone = view.zones[pos]
                    const prevZone = i > 0 ? view.zones[pos - 1] : zone
                    const club = index.clubById.get(r.clubId)
                    const extra = table?.extra?.[r.clubId]
                    const name = club?.shortName ?? extra?.name ?? r.clubId
                    // movement only for clubs that actually played since the snapshot (tie-break rules differ)
                    const before = view.snapRow.get(r.clubId)
                    const was = live && before && (before.played !== r.played || before.points !== r.points) ? view.snapRank.get(r.clubId) : undefined
                    const moved = was ? was - pos : 0
                    const mine = !!myClubId && r.clubId === myClubId
                    const gd = r.gf - r.ga
                    return (
                      <div
                        key={r.clubId}
                        role="row"
                        className={cx('lv-row', i > 0 && (zone?.kind ?? null) !== (prevZone?.kind ?? null) && 'lv-row--zchange', mine && 'lv-row--mine')}
                        style={mine && club ? ({ ['--club' as string]: clubColors(club).primary } as CSSProperties) : undefined}
                        title={zone?.label}
                      >
                        <span className="lv-ps" role="cell">
                          <span className="lx-zone" style={{ ['--zc' as string]: zone?.color ?? 'transparent' }} aria-hidden="true" />
                          {pos}
                          {moved !== 0 && (
                            <span className={cx('lv-delta', moved > 0 ? 'lv-delta--up' : 'lv-delta--down')} aria-label={moved > 0 ? `subiu ${moved}` : `caiu ${-moved}`}>
                              {moved > 0 ? <ArrowUp size={10} strokeWidth={3} /> : <ArrowDown size={10} strokeWidth={3} />}
                            </span>
                          )}
                        </span>
                        <span className="lv-tm" role="cell">
                          <TeamCrest club={club} extra={extra} />
                          <span className="lv-tm__n">{name}</span>
                          {mine && <YouBadge>Seu clube</YouBadge>}
                          {zone && <span className="sr-only">({zone.label})</span>}
                        </span>
                        <span className="lv-pts" role="cell">
                          {r.points}
                        </span>
                        <span className="lv-n" role="cell">
                          {r.played}
                        </span>
                        <span className="lv-n lv-hide-sm" role="cell">
                          {r.won}
                        </span>
                        <span className="lv-n lv-hide-sm" role="cell">
                          {r.drawn}
                        </span>
                        <span className="lv-n lv-hide-sm" role="cell">
                          {r.lost}
                        </span>
                        <span className={cx('lv-n', gd > 0 && 'lv-n--p', gd < 0 && 'lv-n--m')} role="cell">
                          {gd === 0 ? '0' : signed(gd)}
                        </span>
                        <span className="lv-n lv-hide-sm" role="cell">
                          {r.gf}:{r.ga}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="lv-legend">
            {view.legend.map((z) => (
              <span key={z.label}>
                <i style={{ background: z.color }} />
                {z.label}
              </span>
            ))}
            {view.grouped && <span>Classificação por grupo</span>}
            <span className="lv-legend__src">Fonte: ESPN · {live ? `ao vivo, ${relTime(updatedTs, now)}` : `snapshot de ${new Date(data.generatedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`}</span>
          </div>
        </motion.section>

        <aside className="lv-side" aria-label="Detalhes da liga">
          <NextFixtures league={league} data={data} />
          <LeagueFacts league={league} data={data} zones={view.legend} counts={view.counts} />
        </aside>
      </div>

      <Modal open={allOpen} onClose={() => setAllOpen(false)} title="Todas as ligas" description={`${leagues.length} ligas com tabela real de hoje`} size="xl">
        <div className="lv-all">
          {regionsOf.map((r) => (
            <section key={r.key} className="lv-all__sec">
              <h4>{r.label}</h4>
              <div className="lv-all__grid">
                {r.leagues.map((l) => {
                  const c = index.countryByCode.get(l.country)
                  return (
                    <button
                      key={l.id}
                      type="button"
                      className="lv-all__item"
                      aria-current={l.id === league.id}
                      onClick={() => {
                        pick(l.id)
                        setAllOpen(false)
                      }}
                    >
                      <LeagueLogo league={l} size={30} />
                      <span className="min-w-0">
                        <span className="block truncate">{l.shortName}</span>
                        <small className="truncate">
                          {c?.name ?? l.country} · {l.tier}ª divisão
                        </small>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </Modal>
    </main>
  )
}

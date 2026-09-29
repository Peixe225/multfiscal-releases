/**
 * Balanço da temporada: posição final e tabela, taças (com celebração), números, evolução
 * (OVR/valor), prêmios individuais → cerimônia da Bola de Ouro → próxima temporada.
 */
import { useMemo, useState, type CSSProperties } from 'react'
import { ArrowRight, Award, ChevronDown, Medal, PartyPopper, Sparkles, TrendingDown, TrendingUp, Trophy } from 'lucide-react'
import type { AwardResult, SeasonRecord, TrophyWin } from '@/engine/types'
import { navigate } from '@/store/app'
import { getClub, getLeague, getTrophy } from '@/store/data'
import { useImmersive } from '@/store/immersive'
import { BallIcon, BootIcon, Button, Crest, ShirtIcon, clubVars, cx } from '@/ui/primitives'
import { TrophyArt } from '@/ui/trophies'
import { CompLogo, ImOvr, Kpi, PanelHead } from '../bits'
import { TrophyCelebration } from '../fx/TrophyCelebration'
import { compInfo, currentItem, fmtMoney, fmtRating, zoneName, zoneOf } from '../model/view'
import { prizeArt } from '../model/constants'

const GLOBAL_AWARDS = new Set(['ballon_dor', 'the_best', 'golden_boot', 'golden_glove', 'kopa', 'puskas', 'team_of_the_year', 'wc_golden_ball', 'wc_golden_boot'])

/**
 * Prêmios que interessam ao jogador: os globais, os da liga dele e qualquer um em que ele apareça
 * no ranking (nada de 80 "Artilheiro da liga" de todas as ligas do mundo).
 */
export function relevantAwards(all: AwardResult[], leagueId?: string): AwardResult[] {
  const out = all.filter((a) => GLOBAL_AWARDS.has(a.award) || (a.leagueId && a.leagueId === leagueId) || a.ranking.some((r) => r.isUser) || a.winner.isUser)
  const rank = (a: AwardResult) => (a.award === 'ballon_dor' ? 0 : a.winner.isUser ? 1 : a.ranking.some((r) => r.isUser) ? 2 : a.leagueId === leagueId ? 3 : 4)
  return out.sort((a, b) => rank(a) - rank(b))
}

export const AWARD_LABEL: Record<string, string> = {
  ballon_dor: 'Bola de Ouro',
  league_top_scorer: 'Artilheiro da liga',
  league_best_player: 'Craque da liga',
  golden_boot: 'Chuteira de Ouro',
  golden_glove: 'Luva de Ouro',
  the_best: 'The Best',
  kopa: 'Troféu Kopa',
  puskas: 'Prêmio Puskás',
  team_of_the_year: 'Seleção do ano',
  wc_golden_ball: 'Bola de Ouro da Copa',
  wc_golden_boot: 'Chuteira de Ouro da Copa',
}

export function seasonAwards(world: { seasons: Record<number, { awards?: AwardResult[] }> }, season: number): AwardResult[] {
  return world.seasons?.[season]?.awards ?? []
}

export default function SeasonReview() {
  const s = useImmersive((x) => x.state)!
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const [cele, setCele] = useState<TrophyWin | null>(null)
  const rec: SeasonRecord | undefined = s.seasons[s.seasons.length - 1]
  const it = currentItem(s)
  const pendingAwards = it?.kind === 'awards'
  const awards = rec ? relevantAwards(seasonAwards(s.world, rec.season), rec.leagueId) : []
  const [allAwards, setAllAwards] = useState(false)
  const table = useMemo(() => (rec ? s.world.seasons?.[rec.season]?.leagues?.[rec.leagueId]?.table ?? [] : []), [s.world, rec])
  if (!rec) {
    return (
      <main id="conteudo" tabIndex={-1} className="im-wrap outline-none">
        <p className="lx-t-body">Nenhuma temporada encerrada ainda.</p>
        <Button variant="primary" onClick={() => navigate('/imersivo')}>
          Voltar à Central
        </Button>
      </main>
    )
  }
  const club = getClub(rec.clubId)
  const league = getLeague(rec.leagueId)
  const pos = rec.leaguePosition ?? 0
  const zone = zoneOf(league, pos, table.length || 20)
  const dOvr = rec.ovrEnd - rec.ovrStart
  const gk = rec.position === 'GOL'
  const next = () =>
    void dispatch({ type: 'advance' }).then(() => navigate('/imersivo'))
  // janela da tabela: pódio + você (±2), da MESMA tabela da posição em destaque
  const mine = table.findIndex((r) => r.clubId === rec.clubId)
  const rows = (() => {
    const idx = new Set<number>([0, 1, 2])
    if (mine >= 0) for (let k = Math.max(0, mine - 2); k <= Math.min(table.length - 1, mine + 2); k++) idx.add(k)
    // buraco de uma linha só (ex.: 4º entre o G3 e a sua faixa) vira a própria linha — "…" para esconder um time só confunde
    for (const i of [...idx]) if (!idx.has(i + 1) && idx.has(i + 2)) idx.add(i + 1)
    return [...idx].filter((i) => i < table.length).sort((a, b) => a - b)
  })()
  return (
    <main id="conteudo" tabIndex={-1} className="im-wrap im-review outline-none" style={club ? (clubVars(club) as CSSProperties) : undefined}>
      <header className="im-hub__head lx-anim-rise">
        <div>
          <span className="lx-kicker lx-kicker--gold">Fim da temporada {rec.season} · {rec.age} anos</span>
          <h1 className="lx-t-display im-hub__title">Balanço</h1>
        </div>
        <div className="im-hub__actions">
          {pendingAwards ? (
            <>
              <Button variant="ghost" size="md" iconRight={ArrowRight} loading={busy} onClick={next}>
                Pular cerimônia e começar {rec.season + 1}
              </Button>
              <Button variant="primary" size="lg" icon={Award} onClick={() => navigate('/imersivo', { query: { tela: 'gala' } })}>
                Noite da Bola de Ouro
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="md" onClick={() => navigate('/imersivo')}>
              Voltar à Central
            </Button>
          )}
        </div>
      </header>

      <div className="im-review__grid">
        <div className="im-review__col is-l">
        <section className="lx-plate lx-c-lg im-review__pos lx-anim-rise" style={{ ['--i' as string]: 1 }}>
          <div className="lx-club-glow" aria-hidden="true" />
          <span className="lx-label">Classificação final</span>
          <div className="im-review__big">
            <b className={cx('num', pos === 1 && 'lx-metal-gold')}>{pos ? `${pos}º` : '—'}</b>
            <div className="min-w-0">
              <span className="im-review__lg">
                <CompLogo id={rec.leagueId} size={26} />
                {league?.shortName}
              </span>
              <span className="im-review__club">
                {club && <Crest club={club} size={26} decorative />}
                {club?.name}
              </span>
              {pos === 1 ? (
                <span className="lx-chip lx-chip--sm lx-chip--solid-gold">Campeão</span>
              ) : zone ? (
                <span className={cx('lx-chip lx-chip--sm', zone === 'reb' ? 'lx-chip--neg' : 'lx-chip--pos-ok')}>{zone === 'reb' ? '▼ Rebaixado' : zone === 'up' ? '▲ Acesso' : `Vaga · ${zoneName(league, zone)}`}</span>
              ) : null}
            </div>
          </div>
          {table.length > 0 && (
            <ol className="im-review__table">
              {rows.map((i, k) => {
                const r = table[i]
                const c = getClub(r.clubId)
                const z = zoneOf(league, i + 1, table.length)
                return (
                  <li key={r.clubId} className={cx(r.clubId === rec.clubId && 'is-me', k > 0 && rows[k - 1] !== i - 1 && 'is-gap')}>
                    <span className="num">
                      <i className="im-zbar" data-zone={z ?? undefined} aria-hidden="true" />
                      {i + 1}
                    </span>
                    {c && <Crest club={c} size={18} decorative />}
                    <b className="truncate">{c?.shortName ?? r.clubId}</b>
                    <span className="num">{r.points} pts</span>
                  </li>
                )
              })}
            </ol>
          )}
        </section>

        <section className="lx-plate lx-plate--flat lx-c-lg im-review__stats lx-anim-rise" style={{ ['--i' as string]: 3 }}>
          <PanelHead kicker="Seus números" icon={Sparkles} />
          <div className="im-review__kpis">
            <Kpi label="Jogos" value={rec.stats.apps} icon={ShirtIcon} />
            <Kpi label={gk ? 'Sem sofrer' : 'Gols'} value={gk ? rec.stats.cleanSheets ?? 0 : rec.stats.goals} icon={BallIcon} gold={!gk && rec.stats.goals >= 15} />
            <Kpi label="Assist." value={rec.stats.assists} icon={BootIcon} />
            <Kpi label="Nota" value={rec.stats.rating ? fmtRating(rec.stats.rating) : '—'} />
          </div>
          <div className="im-growth">
            <div className="im-growth__ovr">
              <ImOvr ovr={rec.ovrStart} w={72} />
              <ArrowRight size={20} aria-hidden="true" className="text-text-3" />
              <ImOvr ovr={rec.ovrEnd} w={72} countUp={{ duration: 900, delay: 300 }} from={rec.ovrStart} />
              <span className={cx('im-growth__d', dOvr > 0 ? 'is-up' : dOvr < 0 ? 'is-down' : '')}>
                {dOvr > 0 ? <TrendingUp size={16} aria-hidden="true" /> : dOvr < 0 ? <TrendingDown size={16} aria-hidden="true" /> : null}
                {dOvr > 0 ? `+${dOvr}` : dOvr} OVR
              </span>
            </div>
            <div className="im-growth__row">
              <span>
                <small>Valor de mercado</small>
                <b className="num">{fmtMoney(rec.marketValue)}</b>
              </span>
              <span>
                <small>Minutos</small>
                <b className="num">{rec.stats.minutes ?? 0}</b>
              </span>
              <span>
                <small>Potencial</small>
                <b className="num">{s.potential}</b>
              </span>
            </div>
          </div>
        </section>

        </div>
        <div className="im-review__col is-r">
        <section className={cx('lx-plate lx-c-lg im-review__trophies lx-anim-rise', rec.trophies.length === 0 && 'is-empty')} style={{ ['--i' as string]: 2 }}>
          <PanelHead kicker="Taças da temporada" icon={Trophy} gold />
          {rec.trophies.length === 0 ? (
            <div className="im-review__none">
              <Trophy size={22} aria-hidden="true" />
              <p className="lx-t-small m-0">
                Nenhuma taça desta vez{pos > 1 && pos <= 4 ? ` — ficou a ${pos - 1} ${pos - 1 === 1 ? 'posição' : 'posições'} do título da liga` : ''}. A próxima temporada é uma nova chance.
              </p>
            </div>
          ) : (
            <div className="im-review__tr">
              {rec.trophies.map((t, i) => (
                <button key={`${t.trophyId}-${i}`} type="button" className="im-review__cup lx-focus-inset" onClick={() => setCele(t)} title="Comemorar de novo">
                  <span className="lx-trophy-halo" aria-hidden="true" />
                  <TrophyArt id={t.trophyId} size={120} trophy={getTrophy(t.trophyId)} variant="svg" className="lx-trophy-in" />
                  <b>{getTrophy(t.trophyId)?.name ?? t.competitionId}</b>
                  <span className="lx-chip lx-chip--sm lx-chip--gold">
                    <PartyPopper size={11} aria-hidden="true" /> Campeão
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="lx-plate lx-plate--flat lx-c-lg im-review__awards lx-anim-rise" style={{ ['--i' as string]: 4 }}>
          <PanelHead kicker="Prêmios individuais" icon={Medal} />
          <ul className="im-awards">
            {(allAwards ? awards : awards.slice(0, 6)).map((a) => {
              const place = a.ranking.findIndex((x) => x.isUser) + 1
              const wc = a.winner.clubId ? getClub(a.winner.clubId) : undefined
              const lg = a.leagueId ? compInfo(a.leagueId) : null
              return (
                <li key={`${a.award}-${a.leagueId ?? ''}`} className={cx(place === 1 && 'is-win')}>
                  <TrophyArt id={prizeArt(a.award)} size={34} variant="svg" />
                  <span className="min-w-0">
                    <b>{AWARD_LABEL[a.award] ?? a.award}</b>
                    {lg && (
                      <small className="im-awards__lg">
                        <CompLogo id={lg.id} size={14} /> {lg.short}
                      </small>
                    )}
                    <small>
                      {pendingAwards && a.award === 'ballon_dor' ? (
                        'Revelado na cerimônia'
                      ) : (
                        <>
                          {wc && <Crest club={wc} size={14} decorative />} {a.winner.name}
                        </>
                      )}
                    </small>
                  </span>
                  {place > 0 && !(pendingAwards && a.award === 'ballon_dor') && <span className={cx('lx-chip lx-chip--sm', place === 1 ? 'lx-chip--solid-gold' : 'lx-chip--accent')}>Você: {place}º</span>}
                </li>
              )
            })}
            {awards.length === 0 && <li className="lx-t-small">Sem premiação registrada.</li>}
          </ul>
          {awards.length > 6 && (
            <button type="button" className="im-link im-awards__more" aria-expanded={allAwards} onClick={() => setAllAwards(!allAwards)}>
              {allAwards ? 'Ver menos' : `Ver todos (${awards.length})`} <ChevronDown size={13} aria-hidden="true" className={cx(allAwards && 'rotate-180')} />
            </button>
          )}
        </section>
        </div>
      </div>

      {cele && <TrophyCelebration trophy={cele} state={s} lastMatch={null} onClose={() => setCele(null)} />}
    </main>
  )
}

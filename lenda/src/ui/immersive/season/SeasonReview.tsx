/**
 * Balanço da temporada: posição final e tabela, taças (com celebração), números, evolução
 * (OVR/valor), prêmios individuais → cerimônia da Bola de Ouro → próxima temporada.
 */
import { useMemo, useState, type CSSProperties } from 'react'
import { ArrowRight, Award, Medal, PartyPopper, Sparkles, TrendingDown, TrendingUp, Trophy } from 'lucide-react'
import type { AwardResult, SeasonRecord, TrophyWin } from '@/engine/types'
import { navigate } from '@/store/app'
import { getClub, getLeague, getTrophy } from '@/store/data'
import { useImmersive } from '@/store/immersive'
import { BallIcon, BootIcon, Button, Crest, ShirtIcon, clubVars, cx, formatMoney } from '@/ui/primitives'
import { TrophyArt } from '@/ui/trophies'
import { CompLogo, ImOvr, Kpi, PanelHead } from '../bits'
import { TrophyCelebration } from '../fx/TrophyCelebration'
import { currentItem, fmtRating, zoneOf } from '../model/view'

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
  const awards = rec ? seasonAwards(s.world, rec.season) : []
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
              <Button variant="primary" size="lg" icon={Award} onClick={() => navigate('/imersivo', { query: { tela: 'gala' } })}>
                Cerimônia de premiação
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
              {zone && <span className={cx('lx-chip lx-chip--sm', zone === 'reb' ? 'lx-chip--neg' : 'lx-chip--pos-ok')}>{zone === 'lib' ? 'Vaga continental' : zone === 'sul' ? 'Copa continental secundária' : zone === 'reb' ? 'Rebaixado' : zone === 'up' ? 'Acesso' : ''}</span>}
            </div>
          </div>
          {table.length > 0 && (
            <ol className="im-review__table">
              {table.slice(0, 5).map((r, i) => {
                const c = getClub(r.clubId)
                return (
                  <li key={r.clubId} className={cx(r.clubId === rec.clubId && 'lx-row-me')}>
                    <span className="num">{i + 1}</span>
                    {c && <Crest club={c} size={18} decorative />}
                    <b className="truncate">{c?.shortName ?? r.clubId}</b>
                    <span className="num">{r.points} pts</span>
                  </li>
                )
              })}
            </ol>
          )}
        </section>

        <section className="lx-plate lx-c-lg im-review__trophies lx-anim-rise" style={{ ['--i' as string]: 2 }}>
          <PanelHead kicker="Taças da temporada" icon={Trophy} gold />
          {rec.trophies.length === 0 ? (
            <div className="im-review__none">
              <Trophy size={34} aria-hidden="true" />
              <p className="lx-t-small m-0">Nenhuma taça desta vez. A próxima temporada é uma nova chance.</p>
            </div>
          ) : (
            <div className="im-review__tr">
              {rec.trophies.map((t, i) => (
                <button key={`${t.trophyId}-${i}`} type="button" className="im-review__cup lx-focus-inset" onClick={() => setCele(t)} title="Comemorar de novo">
                  <span className="lx-trophy-halo" aria-hidden="true" />
                  <TrophyArt id={t.trophyId} size={120} trophy={getTrophy(t.trophyId)} className="lx-trophy-in" />
                  <b>{getTrophy(t.trophyId)?.name ?? t.competitionId}</b>
                  <span className="lx-chip lx-chip--sm lx-chip--gold">
                    <PartyPopper size={11} aria-hidden="true" /> Campeão
                  </span>
                </button>
              ))}
            </div>
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
                <b className="num">{formatMoney(rec.marketValue)}</b>
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

        <section className="lx-plate lx-plate--flat lx-c-lg im-review__awards lx-anim-rise" style={{ ['--i' as string]: 4 }}>
          <PanelHead kicker="Prêmios individuais" icon={Medal} />
          <ul className="im-awards">
            {awards.map((a) => {
              const place = a.ranking.findIndex((x) => x.isUser) + 1
              const wc = a.winner.clubId ? getClub(a.winner.clubId) : undefined
              return (
                <li key={a.award} className={cx(place === 1 && 'is-win')}>
                  <TrophyArt id={a.award === 'ballon_dor' ? 'ballon-dor' : a.award === 'league_top_scorer' ? 'golden-boot' : 'award-generic'} size={34} variant="svg" />
                  <span className="min-w-0">
                    <b>{AWARD_LABEL[a.award] ?? a.award}</b>
                    <small>
                      {pendingAwards && a.award === 'ballon_dor' ? 'Revelado na cerimônia' : (
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
        </section>
      </div>

      {pendingAwards && (
        <div className="im-review__cta">
          <Button variant="ghost" size="lg" iconRight={ArrowRight} loading={busy} onClick={next}>
            Pular cerimônia e começar {rec.season + 1}
          </Button>
          <Button variant="primary" size="xl" icon={Award} onClick={() => navigate('/imersivo', { query: { tela: 'gala' } })}>
            Noite da Bola de Ouro
          </Button>
        </div>
      )}
      {cele && <TrophyCelebration trophy={cele} state={s} lastMatch={null} onClose={() => setCele(null)} />}
    </main>
  )
}

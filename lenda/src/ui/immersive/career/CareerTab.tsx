/**
 * Carreira: placa do jogador (OVR, clube, KPIs, sala de troféus) + tabela da trajetória no mesmo
 * desenho da carreira do Clássico (uma linha por temporada, idade na cor do clube, troféus,
 * posição, OVR, J/G/A) com a temporada em andamento ao vivo. Links para o balanço e o Hall.
 */
import { useMemo, useState, type CSSProperties } from 'react'
import { ArrowRight, CornerDownRight, Flag as FlagIcon, Landmark, LogOut, Trophy } from 'lucide-react'
import type { ImmersiveState } from '@/engine/immersive/types'
import type { SeasonRecord, TrophyWin } from '@/engine/types'
import { navigate } from '@/store/app'
import { getClub, getCountry, getTrophy } from '@/store/data'
import { useImmersive } from '@/store/immersive'
import { BallIcon, BootIcon, Button, Crest, Flag, Modal, ShirtIcon, clubVars, cx, formatMoney } from '@/ui/primitives'
import { TrophyArt } from '@/ui/trophies'
import { ImOvr, ImOvrS, Kpi, PanelHead } from '../bits'
import { fmtRating } from '../model/view'

const AWARD_NAME: Record<string, string> = {
  ballon_dor: 'Bola de Ouro',
  golden_boot: 'Chuteira de Ouro',
  golden_glove: 'Luva de Ouro',
  the_best: 'The Best',
  kopa: 'Troféu Kopa',
  league_top_scorer: 'Artilheiro',
  league_best_player: 'Craque da liga',
  wc_golden_ball: 'Bola de Ouro da Copa',
  wc_golden_boot: 'Chuteira da Copa',
  puskas: 'Puskás',
  team_of_the_year: 'Seleção do ano',
}

function Shelf({ trophies }: { trophies: TrophyWin[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; n: number; name: string }>()
    for (const t of trophies) {
      const g = m.get(t.trophyId) ?? { id: t.trophyId, n: 0, name: getTrophy(t.trophyId)?.name ?? t.competitionId }
      g.n++
      m.set(t.trophyId, g)
    }
    return [...m.values()].sort((a, b) => b.n - a.n)
  }, [trophies])
  if (!groups.length) return <p className="lx-t-small m-0">A sala de troféus espera o primeiro título.</p>
  return (
    <div className="lx-shelf im-shelf">
      {groups.slice(0, 6).map((g) => (
        <div key={g.id} className="im-shelf__it" title={`${g.n}× ${g.name}`}>
          <TrophyArt id={g.id} size={62} trophy={getTrophy(g.id)} />
          <span className="lx-label">
            {g.n > 1 ? `${g.n}× ` : ''}
            {g.name}
          </span>
        </div>
      ))}
    </div>
  )
}

function Row({ r, gk, current }: { r: SeasonRecord; gk: boolean; current?: boolean }) {
  const club = getClub(r.clubId)
  const vars = club ? (clubVars(club) as CSSProperties) : undefined
  return (
    <div role="row" className={cx('im-crow lx-club-row', r.loan && 'lx-club-row--loan', current && 'is-current')} style={vars}>
      <span role="cell">
        <span className={cx('lx-club-age', current && 'lx-club-age--current')}>{r.age}</span>
      </span>
      <span role="cell" className="im-crow__yr num">
        {r.season}
      </span>
      <span role="cell" className="im-crow__club">
        {r.loan && <CornerDownRight size={14} className="text-text-3" aria-label="Empréstimo" />}
        {club && <Crest club={club} size={20} decorative />}
        <b className="truncate">{club?.shortName ?? r.clubId}</b>
        {r.loan && <span className="lx-chip lx-chip--sm">Emp.</span>}
        <span className="im-crow__tr">
          {r.trophies.slice(0, 4).map((t, i) => (
            <TrophyArt key={i} id={t.trophyId} size={18} variant="svg" title={getTrophy(t.trophyId)?.name} />
          ))}
          {r.awards.filter((a) => a.place === 1).map((a, i) => (
            <span key={i} className="lx-chip lx-chip--sm lx-chip--gold">
              {AWARD_NAME[a.award] ?? a.award}
            </span>
          ))}
        </span>
        {current && <span className="lx-chip lx-chip--sm lx-chip--live">Em andamento</span>}
      </span>
      <span role="cell" className="im-crow__pos">
        {r.leaguePosition ? <span className="lx-rank" data-zone={r.leaguePosition === 1 ? 'champ' : r.relegated ? 'reb' : undefined}>{r.leaguePosition}º</span> : '—'}
      </span>
      <span role="cell">
        <ImOvrS ovr={r.ovrEnd} />
      </span>
      <span role="cell" className={cx('im-crow__n num', !r.stats.apps && 'lx-zero')}>
        {r.stats.apps}
      </span>
      <span role="cell" className={cx('im-crow__n num', r.stats.goals >= 20 && 'lx-hi', !(gk ? r.stats.cleanSheets : r.stats.goals) && 'lx-zero')}>
        {gk ? r.stats.cleanSheets ?? 0 : r.stats.goals}
      </span>
      <span role="cell" className={cx('im-crow__n num max-sm:hidden', !r.stats.assists && 'lx-zero')}>
        {r.stats.assists}
      </span>
      <span role="cell" className="im-crow__n num max-md:hidden">
        {r.stats.rating ? fmtRating(r.stats.rating) : '—'}
      </span>
    </div>
  )
}

function currentRecord(s: ImmersiveState): SeasonRecord | null {
  if (!s.clubId) return null
  const st = s.seasonStats
  const last = s.seasons[s.seasons.length - 1]
  if (last && last.season === s.season) return null
  return {
    season: s.season,
    age: s.age,
    clubId: s.clubId,
    leagueId: getClub(s.clubId)?.leagueId ?? '',
    tier: 1,
    loan: !!s.parentClubId,
    period: 0,
    role: 'starter',
    ovrStart: last?.ovrEnd ?? s.ovr,
    ovrEnd: s.ovr,
    marketValue: s.marketValue,
    stats: { apps: st.apps, goals: st.goals, assists: st.assists, rating: st.apps ? Math.round((st.ratingSum / st.apps) * 10) / 10 : 0, minutes: st.minutes, cleanSheets: st.cleanSheets },
    trophies: s.trophies.filter((t) => t.season === s.season),
    awards: [],
  }
}

export default function CareerTab() {
  const s = useImmersive((x) => x.state)!
  const dispatch = useImmersive((x) => x.dispatch)
  const [confirm, setConfirm] = useState(false)
  const gk = s.identity.position === 'GOL'
  const club = getClub(s.clubId)
  const country = getCountry(s.identity.nationality)
  const cur = currentRecord(s)
  const all = cur ? [...s.seasons, cur] : s.seasons
  const tot = all.reduce((a, r) => ({ apps: a.apps + r.stats.apps, goals: a.goals + r.stats.goals, assists: a.assists + r.stats.assists }), { apps: 0, goals: 0, assists: 0 })
  const vars = club ? (clubVars(club) as CSSProperties) : undefined
  return (
    <main id="conteudo" tabIndex={-1} className="im-wrap im-career outline-none">
      <header className="im-hub__head lx-anim-rise">
        <div>
          <span className="lx-kicker">Carreira · {s.seasons.length} {s.seasons.length === 1 ? 'temporada completa' : 'temporadas completas'}</span>
          <h1 className="lx-t-display im-hub__title">Trajetória</h1>
        </div>
        <div className="im-hub__actions">
          {s.seasons.length > 0 && (
            <Button variant="ghost" size="md" icon={Trophy} onClick={() => navigate('/imersivo', { query: { tela: 'temporada' } })}>
              Último balanço
            </Button>
          )}
          <Button variant="ghost" size="md" icon={Landmark} href="#/hall">
            Hall da Fama
          </Button>
        </div>
      </header>
      {s.retired && (
        <div className="im-retired lx-anim-rise" role="status">
          <b>Carreira encerrada</b>
          <span>{s.retiredReason ?? 'Você pendurou as chuteiras.'} Aos {s.age} anos, com OVR {s.ovr} e {s.trophies.length} {s.trophies.length === 1 ? 'título' : 'títulos'}.</span>
          <Button variant="primary" size="md" iconRight={ArrowRight} onClick={() => navigate('/identidade', { query: { modo: 'imersivo', nova: 1 } })}>
            Nova carreira imersiva
          </Button>
        </div>
      )}
      <div className="im-career__grid">
        <aside className="im-career__side">
          <section className="im-career__plate lx-plate lx-c-lg" style={vars}>
            <div className="lx-club-glow" aria-hidden="true" />
            <div className="im-career__id">
              <ImOvr ovr={s.ovr} w={116} />
              <div className="min-w-0">
                <span className="im-career__chips">
                  {country && (
                    <span className="lx-chip lx-chip--sm">
                      <Flag code={country.code} iso2={country.iso2} h={11} w={15} decorative /> {country.code}
                    </span>
                  )}
                  <span className="lx-chip lx-chip--sm lx-chip--pos-ok">{s.identity.position}</span>
                  <span className="lx-chip lx-chip--sm">#{s.squadNumber}</span>
                </span>
                <b className="im-career__name">{s.identity.surname}</b>
                <span className="lx-t-small">
                  {club?.name ?? 'Sem clube'} · {s.age} anos · {formatMoney(s.marketValue)}
                </span>
              </div>
            </div>
            <div className="im-career__kpis">
              <Kpi label="Jogos" value={tot.apps} icon={ShirtIcon} />
              <Kpi label="Gols" value={tot.goals} icon={BallIcon} gold={tot.goals >= 50} />
              <Kpi label="Assist." value={tot.assists} icon={BootIcon} />
              <Kpi label="Títulos" value={s.trophies.length} icon={Trophy} gold={s.trophies.length > 0} />
            </div>
          </section>
          <section className="lx-plate lx-plate--flat lx-c-md im-panel">
            <PanelHead kicker="Sala de troféus" icon={Trophy} gold right={<span className="lx-t-small">{s.trophies.length} títulos · {s.awards.length} prêmios</span>} />
            <Shelf trophies={s.trophies} />
          </section>
          <section className="lx-plate lx-plate--flat lx-c-md im-panel">
            <PanelHead kicker="Seleção" icon={FlagIcon} />
            <div className="im-career__nat">
              {country && <Flag code={country.code} iso2={country.iso2} h={22} w={30} decorative />}
              <b>{country?.name ?? s.identity.nationality}</b>
              <span className="num">
                {s.national.apps} J · {s.national.goals} G · {s.national.assists} A
              </span>
            </div>
          </section>
        </aside>
        <section className="lx-plate lx-plate--flat lx-c-lg im-panel im-ctable" aria-label="Trajetória">
          <div role="table" aria-rowcount={all.length + 1}>
            <div role="row" className="im-crow is-head">
              <span role="columnheader">Idade</span>
              <span role="columnheader">Ano</span>
              <span role="columnheader">Clube</span>
              <span role="columnheader">Liga</span>
              <span role="columnheader">OVR</span>
              <span role="columnheader">J</span>
              <span role="columnheader">{gk ? 'SG' : 'G'}</span>
              <span role="columnheader" className="max-sm:hidden">
                A
              </span>
              <span role="columnheader" className="max-md:hidden">
                Nota
              </span>
            </div>
            {all.map((r) => (
              <Row key={r.season} r={r} gk={gk} current={cur === r} />
            ))}
            {Array.from({ length: Math.max(0, Math.min(6, 39 - s.age)) }).map((_, i) => (
              <div role="row" key={`f${i}`} className="im-crow is-future">
                <span role="cell" className="im-crow__fage num">
                  {s.age + i + 1}
                </span>
                <span role="cell" className="num">
                  {s.season + i + 1}
                </span>
                <span role="cell" className="im-crow__dash" />
              </div>
            ))}
          </div>
          {!s.retired && (
            <div className="im-ctable__foot">
              <Button variant="ghost" size="sm" icon={LogOut} onClick={() => setConfirm(true)}>
                Encerrar carreira
              </Button>
            </div>
          )}
        </section>
      </div>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        size="sm"
        title="Pendurar as chuteiras?"
        description={`${s.identity.surname} tem ${s.age} anos e OVR ${s.ovr}. A carreira termina aqui.`}
        footer={
          <div className="flex gap-2 justify-end w-full">
            <Button variant="ghost" size="md" onClick={() => setConfirm(false)}>
              Continuar jogando
            </Button>
            <Button variant="danger" size="md" iconRight={ArrowRight} onClick={() => { setConfirm(false); void dispatch({ type: 'retire' }) }}>
              Aposentar
            </Button>
          </div>
        }
      />
    </main>
  )
}

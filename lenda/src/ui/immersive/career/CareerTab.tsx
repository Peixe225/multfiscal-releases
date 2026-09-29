/**
 * Carreira: placa do jogador (OVR, clube, KPIs, sala de troféus) + tabela da trajetória no mesmo
 * desenho da carreira do Clássico (uma linha por temporada, idade na cor do clube, troféus,
 * posição, OVR, J/G/A) com a temporada em andamento ao vivo. Links para o balanço e o Hall.
 */
import { useMemo, useState, type CSSProperties } from 'react'
import { ArrowRight, CornerDownRight, Flag as FlagIcon, Landmark, LogOut, Timer, Trophy } from 'lucide-react'
import type { ImmersiveState } from '@/engine/immersive/types'
import type { SeasonRecord, TrophyWin } from '@/engine/types'
import { navigate } from '@/store/app'
import { getClub, getCountry, getTrophy } from '@/store/data'
import { useImmersive } from '@/store/immersive'
import { BallIcon, BootIcon, Button, Crest, Flag, Modal, ShirtIcon, clubVars, cx } from '@/ui/primitives'
import { TrophyArt } from '@/ui/trophies'
import { CompLogo, ImDlgTitle, ImOvrS, PanelHead } from '../bits'
import { PlayerPlate } from '../hub/panels'
import { prizeArt } from '../model/constants'
import { fmtRating, plural, zoneOf } from '../model/view'
import { getLeague } from '@/store/data'

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

const PRIZE_ART = prizeArt

function Shelf({ trophies, awards }: { trophies: TrophyWin[]; awards: { award: string; place: number }[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; art: string; n: number; name: string; prize?: boolean }>()
    for (const t of trophies) {
      const g = m.get(t.trophyId) ?? { id: t.trophyId, art: t.trophyId, n: 0, name: getTrophy(t.trophyId)?.name ?? t.competitionId }
      g.n++
      m.set(t.trophyId, g)
    }
    for (const a of awards.filter((x) => x.place === 1)) {
      const k = `p:${a.award}`
      const g = m.get(k) ?? { id: k, art: PRIZE_ART(a.award), n: 0, name: AWARD_NAME[a.award] ?? a.award, prize: true }
      g.n++
      m.set(k, g)
    }
    return [...m.values()].sort((a, b) => Number(!!a.prize) - Number(!!b.prize) || b.n - a.n)
  }, [trophies, awards])
  if (!groups.length) return <p className="lx-t-small m-0">A sala de troféus espera o primeiro título.</p>
  return (
    <div className="lx-shelf im-shelf">
      {groups.slice(0, 7).map((g) => (
        <div key={g.id} className={cx('im-shelf__it', g.prize && 'is-prize')} title={`${g.n}× ${g.name}`}>
          <span className="lx-trophy-stack">
            {Array.from({ length: Math.min(3, g.n) }).map((_, i) => (
              <TrophyArt key={i} id={g.art} size={i === 0 ? 50 : 40} variant="svg" trophy={g.prize ? undefined : getTrophy(g.id)} />
            ))}
          </span>
          <span className="lx-label">
            {g.n > 1 && <b className="lx-hi">{g.n}× </b>}
            {g.name}
          </span>
        </div>
      ))}
    </div>
  )
}

function Row({ r, gk, current, livePos }: { r: SeasonRecord; gk: boolean; current?: boolean; livePos?: number }) {
  const club = getClub(r.clubId)
  const lg = getLeague(r.leagueId)
  const z = r.leaguePosition ? (r.leaguePosition === 1 ? 'champ' : r.relegated ? 'reb' : zoneOf(lg, r.leaguePosition, 20)) : null
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
        {r.leaguePosition ? (
          <span className="im-crow__rk">
            <span className="lx-rank" data-zone={z === 'up' ? 'sul' : z ?? undefined}>
              {r.leaguePosition}º
            </span>
            {z === 'champ' ? <span className="im-crow__tag is-gold">Campeão</span> : r.relegated || z === 'reb' ? <span className="im-crow__tag is-neg">▼ Rebaixado</span> : r.promoted ? <span className="im-crow__tag is-pos">▲ Acesso</span> : null}
          </span>
        ) : current ? (
          // temporada em andamento: posição atual na tabela da liga
          <span className="lx-rank" title={livePos ? 'Posição atual na liga' : 'Tabela disponível após a primeira rodada'}>
            {livePos ? `${livePos}º` : '—'}
          </span>
        ) : (
          '—'
        )}
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
    leagueId: s.leagueId ?? getClub(s.clubId)?.leagueId ?? '',
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
  const engine = useImmersive((x) => x.engine)
  const [confirm, setConfirm] = useState(false)
  const gk = s.identity.position === 'GOL'
  const country = getCountry(s.identity.nationality)
  const cur = currentRecord(s)
  const data = useImmersive((x) => x.data)
  const livePos = useMemo(() => {
    if (!engine || !data || !s.clubId) return undefined
    try {
      const i = engine.liveTable(data, s).findIndex((row) => row.clubId === s.clubId)
      return i >= 0 ? i + 1 : undefined
    } catch {
      return undefined
    }
  }, [engine, data, s])
  const all = cur ? [...s.seasons, cur] : s.seasons
  const tot = all.reduce((a, r) => ({ apps: a.apps + r.stats.apps, goals: a.goals + r.stats.goals, assists: a.assists + r.stats.assists }), { apps: 0, goals: 0, assists: 0 })
  const prizes = s.awards.filter((a) => a.place === 1).length
  // aposentadoria: o motor diz quando vale (motor real: a partir dos 34 anos)
  const canRetire = engine?.validActions ? engine.validActions(s).includes('retire') : s.age >= 34
  const futureN = Math.max(0, Math.min(8, 39 - s.age))
  const last = all[all.length - 1]
  return (
    <main id="conteudo" tabIndex={-1} className="im-wrap im-career outline-none">
      <header className="im-hub__head lx-anim-rise">
        <div>
          <span className="lx-kicker">Carreira · {plural(s.seasons.length, 'temporada completa', 'temporadas completas')}</span>
          <h1 className="lx-t-display im-hub__title">Trajetória</h1>
        </div>
        <div className="im-hub__actions">
          {s.seasons.length > 0 && (
            <Button variant="ghost" size="md" icon={Trophy} onClick={() => navigate('/imersivo', { query: { tela: 'temporada' } })}>
              Último balanço
            </Button>
          )}
          <Button variant="ghost" size="md" icon={Landmark} href="#/hall">
            Hall das Lendas
          </Button>
        </div>
      </header>
      {s.retired && (
        <div className="im-retired lx-anim-rise" role="status">
          <b>Carreira encerrada</b>
          <span>
            {s.retiredReason ?? 'Você pendurou as chuteiras.'} Aos {s.age} anos, com OVR {s.ovr} e {plural(s.trophies.length, 'título', 'títulos')}. A trajetória está no Hall das Lendas.
          </span>
          <Button variant="primary" size="md" iconRight={ArrowRight} onClick={() => navigate('/identidade', { query: { modo: 'imersivo', nova: 1 } })}>
            Nova carreira imersiva
          </Button>
        </div>
      )}
      <div className="im-career__grid">
        <aside className="im-career__side">
          <PlayerPlate s={s} />
          <div className="lx-plate lx-plate--flat lx-c-md im-cstats">
            <span>
              <small>
                <ShirtIcon size={14} aria-hidden /> Jogos
              </small>
              <b className="num">{tot.apps}</b>
            </span>
            <span>
              <small>
                <BallIcon size={14} aria-hidden /> {gk ? 'Sem sofrer' : 'Gols'}
              </small>
              <b className={cx('num', tot.goals >= 50 && 'lx-hi')}>
                {gk ? all.reduce((a, r) => a + (r.stats.cleanSheets ?? 0), 0) : tot.goals}
                {!gk && tot.apps > 0 && <em>{(tot.goals / tot.apps).toFixed(2).replace('.', ',')}/J</em>}
              </b>
            </span>
            <span>
              <small>
                <BootIcon size={14} aria-hidden /> Assist.
              </small>
              <b className="num">{tot.assists}</b>
            </span>
            <span>
              <small>
                <Trophy size={14} aria-hidden="true" /> Títulos
              </small>
              <b className={cx('num', s.trophies.length > 0 && 'lx-metal-gold')}>{s.trophies.length}</b>
            </span>
          </div>
          <section className="lx-plate lx-plate--flat lx-c-md im-panel im-trophyroom">
            <PanelHead kicker="Sala de troféus" icon={Trophy} gold right={<span className="lx-t-small">{plural(s.trophies.length, 'título', 'títulos')} · {plural(prizes, 'prêmio', 'prêmios')}</span>} />
            <Shelf trophies={s.trophies} awards={s.awards} />
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
          <div role="table" aria-rowcount={all.length + 1} className="im-ctable__t">
            <div role="row" className="im-crow is-head">
              <span role="columnheader">Idade</span>
              <span role="columnheader">Ano</span>
              <span role="columnheader">Clube</span>
              <span role="columnheader" title="Posição final na liga (em andamento: posição atual)">
                Pos.
              </span>
              <span role="columnheader">OVR</span>
              <span role="columnheader">J</span>
              <span role="columnheader" title={gk ? 'Jogos sem sofrer gol' : 'Gols'}>
                {gk ? 'JSG' : 'G'}
              </span>
              <span role="columnheader" className="max-sm:hidden">
                A
              </span>
              <span role="columnheader" className="max-md:hidden">
                Nota
              </span>
            </div>
            {all.map((r) => (
              <Row key={r.season} r={r} gk={gk} current={cur === r} livePos={cur === r ? livePos : undefined} />
            ))}
            {!s.retired &&
              Array.from({ length: futureN }).map((_, i) => {
                const year = (last?.season ?? s.season) + i + 1
                const wc = year >= 2026 && (year - 2026) % 4 === 0
                return (
                  <div role="row" key={`f${i}`} className={cx('im-crow is-future', wc && 'is-wc')}>
                    <span role="cell" className="im-crow__fage num">
                      {(last?.age ?? s.age) + i + 1}
                    </span>
                    <span role="cell" className="num">
                      {year}
                    </span>
                    {wc ? (
                      <span role="cell" className="im-crow__wc">
                        <TrophyArt id="world-cup" size={14} variant="svg" /> Copa do Mundo {year}
                      </span>
                    ) : (
                      <span role="cell" className="im-crow__dash" />
                    )}
                  </div>
                )
              })}
            {!s.retired && (
              <div className="im-crow__left">
                <Timer size={14} aria-hidden="true" /> {plural(Math.max(0, 39 - s.age), 'temporada pela frente', 'temporadas pela frente')} até os 39
              </div>
            )}
          </div>
          {!s.retired && (
            <div className="im-ctable__foot">
              <span className="lx-t-small">{canRetire ? 'Você pode encerrar a carreira quando quiser.' : 'Encerrar a carreira: disponível a partir dos 34 anos.'}</span>
              <Button variant="ghost" size="sm" icon={LogOut} onClick={() => setConfirm(true)} disabled={!canRetire} title={canRetire ? undefined : 'Disponível a partir dos 34 anos'}>
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
        title={<ImDlgTitle kicker="Fim de carreira">Pendurar as chuteiras?</ImDlgTitle>}
        description={`${s.identity.surname} tem ${s.age} anos e OVR ${s.ovr}. A carreira termina aqui e entra no Hall das Lendas.`}
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

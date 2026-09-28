/**
 * Noite da Bola de Ouro (palco de gala, §5.12): palco `1.25fr` + ranking `440px` ao lado.
 * Spots que balançam, "Os indicados são…", envelope → revelação do 3º, do 2º, suspense e o vencedor
 * (nome gigante em ouro num espaço já reservado, confete se for você). Indicados em placas ouro com
 * camisa paramétrica, OVR e J/G/A. O ranking entra do 10º ao 4º e o pódio acompanha a revelação.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ArrowRight, Mail, SkipForward } from 'lucide-react'
import type { AwardRankingEntry, AwardResult } from '@/engine/types'
import { navigate } from '@/store/app'
import { getClub, getCountry } from '@/store/data'
import { useImmersive } from '@/store/immersive'
import { Button, Crest, Flag, clubColors, cx, tierOf, useMediaQuery, useReducedMotion, useSkipAnimations } from '@/ui/primitives'
import { TrophyArt } from '@/ui/trophies'
import { Jersey } from '@/ui/shared/identity/Jersey'
import { clubKit, nationKit } from '@/ui/shared/identity/kit'
import { Confetti } from '../fx/TrophyCelebration'
import { imSfx } from '../hooks'
import { currentItem } from '../model/view'
import { prizeArt } from '../model/constants'
import { AWARD_LABEL, seasonAwards } from './SeasonReview'

type Phase = 'intro' | 'r3' | 'r2' | 'suspense' | 'winner' | 'done'
const ORDER: Phase[] = ['intro', 'r3', 'r2', 'suspense', 'winner', 'done']
const at = (p: Phase, q: Phase) => ORDER.indexOf(p) >= ORDER.indexOf(q)
/** Posição revelada em cada fase. */
const shownPlace = (place: number, phase: Phase) => (place === 3 && at(phase, 'r3')) || (place === 2 && at(phase, 'r2')) || (place === 1 && at(phase, 'winner')) || place > 3

/** Número "de camisa" pela posição (nunca a colocação — não entrega a revelação). */
const SHIRT: Partial<Record<string, number>> = { GOL: 1, LD: 2, ZAG: 4, LE: 6, VOL: 5, MC: 8, MEI: 10, ME: 11, MD: 7, PE: 11, PD: 7, CA: 9 }

interface Line {
  apps?: number
  goals?: number
  assists?: number
  ovr?: number
}

function Nominee({ e, place, phase, i, line }: { e: AwardRankingEntry; place: number; phase: Phase; i: number; line: Line }) {
  const phone = useMediaQuery('(max-width: 44.99rem)')
  const club = e.clubId ? getClub(e.clubId) : undefined
  const country = getCountry(e.nationality)
  const shown = shownPlace(place, phase)
  const win = place === 1 && at(phase, 'winner')
  const lose = at(phase, 'winner') && place !== 1
  const c = club ? clubColors(club) : null
  const kit = club ? clubKit(club) : nationKit(country)
  const last = e.name.split(' ').slice(-1)[0]
  return (
    <article className={cx('lx-plate lx-plate--gold lx-c-lg im-nom lx-anim-rise', win && 'is-win', lose && 'is-lose', e.isUser && 'is-me')} style={{ ['--i' as string]: i, ['--nc' as string]: c?.primary ?? '#F7C948' } as CSSProperties}>
      <div className="im-nom__art">
        <Jersey name={last} number={SHIRT[e.position] ?? 10} kit={kit} className="im-nom__jersey" />
        {club && <Crest club={club} size={phone ? 22 : 30} decorative className="im-nom__crest" />}
      </div>
      <b className="im-nom__name">{e.name}</b>
      <span className="im-nom__meta">
        {country && <Flag code={country.code} iso2={country.iso2} h={11} w={15} decorative />}
        {club?.abbr ?? country?.code} · {e.position}
        {line.ovr ? (
          <span className="lx-ovr-s im-nom__ovr" data-tier={tierOf(line.ovr)}>
            {line.ovr}
          </span>
        ) : null}
      </span>
      <span className="im-nom__stats" aria-label={`${line.apps ?? '—'} jogos, ${line.goals ?? '—'} gols, ${line.assists ?? '—'} assistências`}>
        <span>
          <small>J</small>
          <b className="num">{line.apps ?? '—'}</b>
        </span>
        <span>
          <small>G</small>
          <b className={cx('num', (line.goals ?? 0) >= 20 && 'lx-hi')}>{line.goals ?? '—'}</b>
        </span>
        <span>
          <small>A</small>
          <b className="num">{line.assists ?? '—'}</b>
        </span>
      </span>
      <span className={cx('im-nom__place', shown && 'is-shown')} aria-hidden={!shown}>
        {shown ? (
          <>
            <b className="num">{place}º</b> <span className="num">{e.score.toLocaleString('pt-BR')} pts</span>
          </>
        ) : (
          '?'
        )}
      </span>
      {e.isUser && <span className="lx-you im-nom__you">Você</span>}
    </article>
  )
}

function Ranking({ a, phase, season }: { a: AwardResult; phase: Phase; season: number }) {
  const max = Math.max(1, ...a.ranking.map((r) => r.score))
  return (
    <section className="lx-plate lx-plate--gold lx-c-lg im-rank" aria-label="Ranking completo">
      <span className="lx-kicker lx-kicker--gold">Votação final · temporada {season}</span>
      <h2 className="lx-t-card im-rank__t">Ranking {AWARD_LABEL[a.award] ?? a.award}</h2>
      <ol>
        {a.ranking.map((r, i) => {
          const place = i + 1
          const shown = shownPlace(place, phase)
          const club = r.clubId ? getClub(r.clubId) : undefined
          const country = getCountry(r.nationality)
          return (
            <li key={`${r.name}-${i}`} className={cx(i === 0 && 'is-first', r.isUser && 'is-me', !shown && 'is-hidden')} style={{ ['--i' as string]: a.ranking.length - i }}>
              <span className="im-rank__pos num">{place}</span>
              {shown && club ? <Crest club={club} size={place === 1 ? 30 : 24} decorative /> : <span className="im-rank__q" aria-hidden="true">?</span>}
              <span className="min-w-0 flex-1">
                <b className="truncate">{shown ? r.name : 'A revelar'}</b>
                <small>
                  {shown && country && <Flag code={country.code} iso2={country.iso2} h={10} w={14} decorative />} {shown ? club?.shortName ?? country?.name : '—'}
                </small>
              </span>
              <span className="im-rank__pts">
                <b className="num">{shown ? r.score.toLocaleString('pt-BR') : '—'}</b>
                <i style={{ width: shown ? `${(r.score / max) * 100}%` : '0%' }} />
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export default function Ceremony() {
  const s = useImmersive((x) => x.state)!
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const rm = useReducedMotion()
  // "Pular animações" (menu) ou movimento reduzido: a revelação anda depressa
  const skip = useSkipAnimations()
  const rec = s.seasons[s.seasons.length - 1]
  const all = rec ? seasonAwards(s.world, rec.season) : []
  const main = useMemo(() => all.find((a) => a.award === 'ballon_dor') ?? all.find((a) => a.award === 'league_best_player') ?? all[0], [all])
  const others = all.filter((a) => a !== main && (!a.leagueId || a.leagueId === rec?.leagueId || a.ranking.some((r) => r.isUser))).slice(0, 4)
  const [phase, setPhase] = useState<Phase>('intro')
  const pending = currentItem(s)?.kind === 'awards'

  useEffect(() => {
    if (phase === 'intro' || phase === 'done') return
    const next: Record<Phase, [Phase, number] | null> = { intro: null, r3: ['r2', 1400], r2: ['suspense', 1400], suspense: ['winner', 1600], winner: ['done', 2200], done: null }
    const n = next[phase]
    if (!n) return
    if (phase === 'winner') imSfx.play('trophy')
    else imSfx.play('reveal')
    const t = setTimeout(() => setPhase(n[0]), skip ? 300 : n[1])
    return () => clearTimeout(t)
  }, [phase, skip])

  const lineOf = (e: AwardRankingEntry): Line => {
    if (e.isUser && rec) return { apps: rec.stats.apps, goals: rec.stats.goals, assists: rec.stats.assists, ovr: rec.ovrEnd }
    const r = s.world.rivals?.find((x) => x.name === e.name || x.shortName === e.name)
    return { apps: r?.lastSeason?.apps, goals: r?.lastSeason?.goals, assists: r?.lastSeason?.assists, ovr: r?.ovr }
  }

  if (!main || !rec) {
    return (
      <main id="conteudo" tabIndex={-1} className="im-wrap outline-none">
        <p className="lx-t-body">Sem cerimônia registrada nesta temporada.</p>
        <Button variant="primary" onClick={() => navigate('/imersivo')}>
          Voltar à Central
        </Button>
      </main>
    )
  }
  const top3 = main.ranking.slice(0, 3)
  const order = [top3[1], top3[0], top3[2]].filter(Boolean) as AwardRankingEntry[]
  const winner = top3[0]
  const youWin = !!winner?.isUser
  const userPlace = main.ranking.findIndex((r) => r.isUser) + 1
  const finish = () => (pending ? void dispatch({ type: 'advance' }).then(() => navigate('/imersivo')) : navigate('/imersivo'))
  return (
    <main id="conteudo" tabIndex={-1} className={cx('im-gala outline-none', `is-${phase}`)}>
      <div className="im-gala__spots" aria-hidden="true">
        <i className="lx-spot-cone im-gala__spot is-a" />
        <i className="lx-spot-cone im-gala__spot is-b" />
        <i className="lx-spot-cone im-gala__spot is-c" />
      </div>
      {youWin && at(phase, 'winner') && !rm && <Confetti n={90} seed={9} />}
      <div className="im-gala__layout">
        <div className="im-gala__main">
          <header className="im-gala__hd">
            <div className="im-gala__event">
              {AWARD_LABEL[main.award] ?? main.award} · temporada {rec.season}
            </div>
            <div className="im-gala__and" aria-live="polite">
              {phase === 'intro' ? 'Os indicados são…' : phase === 'suspense' ? 'E o vencedor é…' : at(phase, 'winner') ? 'O vencedor é' : 'Revelando os votos…'}
            </div>
          </header>
          <div className="im-gala__stage">
            <span className="im-gala__halo" aria-hidden="true" />
            <TrophyArt id={prizeArt(main.award)} size={220} variant="svg" className={cx('im-gala__trophy', at(phase, 'winner') && 'is-lit')} />
            <section className="im-gala__noms" aria-label="Indicados">
              {order.map((e, i) => (
                <Nominee key={e.name} e={e} place={top3.indexOf(e) + 1} phase={phase} i={i} line={lineOf(e)} />
              ))}
            </section>
          </div>
          <div className="im-gala__win">
            {at(phase, 'winner') && winner && <div className="lx-t-gala lx-metal-gold lx-gold-glow im-gala__name">{winner.name}</div>}
            {at(phase, 'winner') && (
              <p className="im-gala__sub">{youWin ? 'Você é o melhor jogador do mundo.' : userPlace ? `Você terminou em ${userPlace}º na votação.` : 'Você não entrou no top 10 desta vez.'}</p>
            )}
          </div>
          <div className="im-gala__acts">
            {phase === 'intro' ? (
              <>
                <Button variant="primary" size="xl" icon={Mail} onClick={() => setPhase('r3')} autoFocus>
                  Abrir envelope
                </Button>
                <Button variant="ghost" size="lg" icon={SkipForward} onClick={() => setPhase('done')}>
                  Pular
                </Button>
              </>
            ) : phase === 'done' ? (
              <Button variant="primary" size="xl" iconRight={ArrowRight} loading={busy} onClick={finish} autoFocus>
                {pending ? `Começar a temporada ${s.season + 1}` : 'Voltar à Central'}
              </Button>
            ) : (
              <Button variant="ghost" size="md" icon={SkipForward} onClick={() => setPhase('done')}>
                Pular
              </Button>
            )}
          </div>
        </div>
        <aside className="im-gala__side">
          <Ranking a={main} phase={phase} season={rec.season} />
          {others.length > 0 && (
            <div className="im-gala__others">
              {others.map((a) => {
                const c = a.winner.clubId ? getClub(a.winner.clubId) : undefined
                return (
                  <div key={`${a.award}-${a.leagueId ?? ''}`} className={cx('lx-plate lx-plate--flat lx-c-sm im-gala__other', a.winner.isUser && 'is-me')}>
                    <TrophyArt id={prizeArt(a.award)} size={34} variant="svg" />
                    <span className="min-w-0">
                      <span className="lx-label">{AWARD_LABEL[a.award] ?? a.award}</span>
                      <b className="truncate">
                        {c && <Crest club={c} size={16} decorative />} {a.winner.name}
                        {a.award === 'league_top_scorer' ? ` · ${a.winner.score} gols` : ''}
                      </b>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}

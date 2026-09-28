/**
 * Noite da Bola de Ouro (palco de gala): spots que balançam, "Os indicados são…", envelope →
 * revelação dramática do 3º, do 2º, suspense e o vencedor (nome gigante em ouro, confete se for
 * você) → ranking completo com pontos + outros prêmios → próxima temporada.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ArrowRight, Mail, SkipForward } from 'lucide-react'
import type { AwardRankingEntry, AwardResult } from '@/engine/types'
import { navigate } from '@/store/app'
import { getClub, getCountry } from '@/store/data'
import { useImmersive } from '@/store/immersive'
import { Button, Crest, Flag, clubColors, cx, useMediaQuery, useReducedMotion } from '@/ui/primitives'
import { sfx } from '@/ui/shell/sfx'
import { TrophyArt } from '@/ui/trophies'
import { Confetti } from '../fx/TrophyCelebration'
import { currentItem } from '../model/view'
import { AWARD_LABEL, seasonAwards } from './SeasonReview'

type Phase = 'intro' | 'r3' | 'r2' | 'suspense' | 'winner' | 'done'
const ORDER: Phase[] = ['intro', 'r3', 'r2', 'suspense', 'winner', 'done']
const at = (p: Phase, q: Phase) => ORDER.indexOf(p) >= ORDER.indexOf(q)

function Nominee({ e, place, phase, i }: { e: AwardRankingEntry; place: number; phase: Phase; i: number }) {
  const phone = useMediaQuery('(max-width: 44.99rem)')
  const club = e.clubId ? getClub(e.clubId) : undefined
  const country = getCountry(e.nationality)
  const shown = (place === 3 && at(phase, 'r3')) || (place === 2 && at(phase, 'r2')) || (place === 1 && at(phase, 'winner'))
  const win = place === 1 && at(phase, 'winner')
  const lose = at(phase, 'winner') && place !== 1
  const c = club ? clubColors(club) : null
  return (
    <article className={cx('lx-plate lx-plate--gold lx-c-lg im-nom lx-anim-rise', win && 'is-win', lose && 'is-lose', e.isUser && 'is-me')} style={{ ['--i' as string]: i, ['--nc' as string]: c?.primary ?? '#F7C948' } as CSSProperties}>
      <div className="im-nom__art">
        {club ? <Crest club={club} size={phone ? 50 : 92} decorative /> : country ? <Flag code={country.code} iso2={country.iso2} h={phone ? 32 : 60} w={phone ? 44 : 84} decorative /> : null}
      </div>
      <b className="im-nom__name">{e.name}</b>
      <span className="im-nom__meta">
        {country && <Flag code={country.code} iso2={country.iso2} h={11} w={15} decorative />}
        {club?.shortName ?? country?.name} · {e.position}
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

function Ranking({ a }: { a: AwardResult }) {
  const max = Math.max(1, ...a.ranking.map((r) => r.score))
  return (
    <section className="lx-plate lx-c-lg im-rank lx-anim-rise" aria-label="Ranking completo">
      <span className="lx-kicker lx-kicker--gold">Votação final · {a.year}</span>
      <h2 className="lx-t-card im-rank__t">Ranking {AWARD_LABEL[a.award] ?? a.award}</h2>
      <ol>
        {a.ranking.map((r, i) => {
          const club = r.clubId ? getClub(r.clubId) : undefined
          const country = getCountry(r.nationality)
          return (
            <li key={`${r.name}-${i}`} className={cx(i === 0 && 'is-first', r.isUser && 'lx-row-me')} style={{ ['--i' as string]: i }}>
              <span className="im-rank__pos num">{i + 1}</span>
              {club ? <Crest club={club} size={24} decorative /> : <span style={{ width: 24 }} />}
              <span className="min-w-0 flex-1">
                <b className="truncate">{r.name}</b>
                <small>
                  {country && <Flag code={country.code} iso2={country.iso2} h={10} w={14} decorative />} {club?.shortName ?? country?.name}
                </small>
              </span>
              <span className="im-rank__pts">
                <b className="num">{r.score.toLocaleString('pt-BR')}</b>
                <i style={{ width: `${(r.score / max) * 100}%` }} />
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
  const rec = s.seasons[s.seasons.length - 1]
  const all = rec ? seasonAwards(s.world, rec.season) : []
  const main = useMemo(() => all.find((a) => a.award === 'ballon_dor') ?? all.find((a) => a.award === 'league_best_player') ?? all[0], [all])
  const others = all.filter((a) => a !== main)
  const [phase, setPhase] = useState<Phase>('intro')
  const pending = currentItem(s)?.kind === 'awards'

  useEffect(() => {
    if (phase === 'intro' || phase === 'done') return
    const next: Record<Phase, [Phase, number] | null> = { intro: null, r3: ['r2', 1300], r2: ['suspense', 1300], suspense: ['winner', 1700], winner: ['done', 2200], done: null }
    const n = next[phase]
    if (!n) return
    if (phase === 'winner') sfx.play('trophy')
    else sfx.play('reveal')
    const t = setTimeout(() => setPhase(n[0]), rm ? 300 : n[1])
    return () => clearTimeout(t)
  }, [phase, rm])

  if (!main) {
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
      <header className="im-gala__hd">
        <div className="im-gala__event">
          {AWARD_LABEL[main.award] ?? main.award} {main.year}
        </div>
        <div className="im-gala__and" aria-live="polite">
          {phase === 'intro' ? 'Os indicados são…' : phase === 'suspense' ? 'E o vencedor é…' : at(phase, 'winner') ? 'O vencedor é' : 'Revelando os votos…'}
        </div>
      </header>
      <div className="im-gala__stage">
        <TrophyArt id={main.award === 'ballon_dor' ? 'ballon-dor' : 'award-generic'} size={200} className={cx('im-gala__trophy', at(phase, 'winner') && 'is-lit')} />
        <section className="im-gala__noms" aria-label="Indicados">
          {order.map((e, i) => (
            <Nominee key={e.name} e={e} place={top3.indexOf(e) + 1} phase={phase} i={i} />
          ))}
        </section>
      </div>
      <div className="im-gala__win">
        {at(phase, 'winner') && winner && (
          <div className="lx-t-gala lx-metal-gold lx-gold-glow im-gala__name">{winner.name}</div>
        )}
        {at(phase, 'winner') && (
          <p className="im-gala__sub">
            {youWin ? 'Você é o melhor jogador do mundo.' : userPlace ? `Você terminou em ${userPlace}º na votação.` : 'Você não entrou no top 10 desta vez.'}
          </p>
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
      {phase === 'done' && (
        <div className="im-gala__after">
          <Ranking a={main} />
          <div className="im-gala__others">
            {others.map((a) => {
              const c = a.winner.clubId ? getClub(a.winner.clubId) : undefined
              return (
                <div key={a.award} className={cx('lx-plate lx-plate--flat lx-c-sm im-gala__other', a.winner.isUser && 'is-me')}>
                  <TrophyArt id={a.award === 'league_top_scorer' ? 'golden-boot' : 'award-generic'} size={40} variant="svg" />
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
        </div>
      )}
    </main>
  )
}

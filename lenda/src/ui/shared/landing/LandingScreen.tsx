/**
 * Landing (route "#/") — "Construa sua carreira no futebol."
 * Hero with the fanned player cards, mode cards, ritmo, CTAs (Começar / Continuar / Conquistas),
 * "AO VIVO · Líderes de hoje" ticker from the real standings, features and footer.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, Check, Clock3, Layers, Play, Trophy, Tv2 } from 'lucide-react'
import type { Pace } from '@/engine/types'
import { buildHash, navigate, useApp } from '@/store/app'
import { selectHasActiveCareer, useCareer } from '@/store/career'
import { peekSavedImmersive } from '@/store/immersive'
import type { ImmersiveState } from '@/engine/immersive/types'
import { useData } from '@/store/data'
import { Button, Crest, LivePill, MedalIcon, Modal, OvrPill, Segmented, cx, useReducedMotion } from '@/ui/primitives'
import { useAchievementCatalog } from '@/ui/shell/achievementsRegistry'
import { useShellSlots } from '@/ui/shell/slots'
import { sfx } from '@/ui/shell/sfx'
import { PACE_INFO, PACES, usePrefs } from '@/ui/shared/identity/prefs'
import { shortDate } from '@/ui/shared/live/leagues'
import '@/ui/shared/achievements/unlockToasts'
import { Features } from './Features'
import { HeroArt } from './HeroArt'
import { LiveTicker } from './LiveTicker'
import './landing.css'

export function LandingNav() {
  const links: [string, string, boolean?][] = [
    ['Modo Clássico', '#/identidade'],
    ['Modo Imersivo', '#/imersivo', true],
    ['Ligas ao vivo', '#/ligas'],
    ['Hall das Lendas', '#/hall'],
  ]
  return (
    <nav aria-label="Principal" className="ld-nav max-lg:hidden">
      {links.map(([label, href, soon]) => (
        <a key={href} href={href}>
          {label}
          {soon && <span className="ld-soon">Novo</span>}
        </a>
      ))}
    </nav>
  )
}

const rise = (rm: boolean, i: number) =>
  rm ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] as const, delay: 0.05 + i * 0.06 } }

export default function LandingScreen() {
  useShellSlots({ stage: { preset: 'brand' }, center: <LandingNav /> })
  const rm = useReducedMotion()
  const data = useData((s) => s.data)
  const index = useData((s) => s.index)
  const active = useCareer(selectHasActiveCareer)
  const state = useCareer((s) => s.state)
  const unlocked = useCareer((s) => Object.keys(s.achievements).length)
  const total = useAchievementCatalog((s) => s.list.length)
  const openDialog = useApp((s) => s.openDialog)
  const query = useApp((s) => s.route.query)
  const pace = usePrefs((s) => s.pace)
  const setPace = usePrefs((s) => s.setPace)
  const [confirmNew, setConfirmNew] = useState(false)
  // modo de jogo escolhido nos cards (o Imersivo abre a identidade em ?modo=imersivo)
  const [mode, setMode] = useState<'classico' | 'imersivo'>(query.modo === 'imersivo' ? 'imersivo' : 'classico')
  const [imm, setImm] = useState<ImmersiveState | null>(null)
  useEffect(() => {
    void peekSavedImmersive().then(setImm).catch(() => {})
  }, [])
  // só há carreira imersiva salva (nenhuma clássica ativa): a landing já abre no Modo Imersivo, com "Continuar"
  const careerStatus = useCareer((s) => s.status)
  const autoMode = useRef(false)
  useEffect(() => {
    if (autoMode.current || !imm || imm.retired || query.modo || careerStatus !== 'ready') return
    autoMode.current = true
    if (!active) setMode('imersivo')
  }, [imm, active, careerStatus, query.modo])

  // screenshots / deep links: #/?conquistas=1 opens the achievements dialog
  useEffect(() => {
    if (query.conquistas) openDialog('achievements')
  }, [query.conquistas, openDialog])

  const club = state?.clubId ? index?.clubById.get(state.clubId) : undefined
  const finished = !!state && (state.phase === 'finished' || state.retired)
  const classicActive = !!state && !state.retired && active
  const other =
    mode === 'imersivo' && state && classicActive
      ? { to: '/carreira' as const, surname: state.identity.surname, age: state.age, ovr: state.ovr }
      : mode === 'classico' && classicActive && imm && !imm.retired
        ? { to: '/imersivo' as const, surname: imm.identity.surname, age: imm.age, ovr: imm.ovr }
        : null
  const day = shortDate(data?.generatedAt)
  const trophyCount = data?.trophies.length ?? 0
  const trophyLabel = trophyCount >= 20 ? `${Math.floor(trophyCount / 10) * 10}+ taças` : 'Taças reais'
  const paceOptions = useMemo(() => PACES.map((p) => ({ value: p, label: PACE_INFO[p].label })), [])
  const info = PACE_INFO[pace]

  const start = () => {
    if (mode === 'imersivo') {
      navigate('/identidade', { query: { modo: 'imersivo' } })
      return
    }
    if (active) {
      setConfirmNew(true)
      return
    }
    navigate('/identidade', { query: { ritmo: pace } })
  }

  return (
    <main id="conteudo" tabIndex={-1} className="relative z-[1] flex-1 w-full outline-none">
      <div className="ld-page">
        <div className="ld-hero">
          <div className="ld-copy">
            <motion.div {...rise(rm, 0)}>
              <LivePill>
                Temporada 2026 ao vivo
                <span className="hidden sm:inline-block w-px h-3 bg-[rgba(189,245,220,.25)]" aria-hidden />
                <span className="hidden sm:inline text-[rgba(189,245,220,.72)] font-semibold">{day ? `Tabelas reais de ${day}` : 'Tabelas reais'}</span>
              </LivePill>
            </motion.div>
            <motion.h1 className="ld-h1" {...rise(rm, 1)}>
              Construa sua carreira no <span className="lx-metal-text">futebol.</span>
            </motion.h1>
            <motion.p className="ld-lead" {...rise(rm, 2)}>
              <span className="ld-lead__long">
                Escolha sua origem, tome decisões importantes e deixe o destino te levar a uma trajetória única de <b>títulos, Bolas de Ouro e noites de Copa do Mundo</b>.
              </span>
              <span className="ld-lead__short">
                Decisões que mudam tudo, rumo a <b>títulos, Bolas de Ouro e noites de Copa</b>.
              </span>
            </motion.p>

            <motion.div className="ld-modes" role="group" aria-label="Modo de jogo" {...rise(rm, 3)}>
              <button type="button" className={cx('lx-mode ld-mode', mode === 'classico' && 'is-on')} aria-pressed={mode === 'classico'} onClick={() => { sfx.play('tap'); setMode('classico') }}>
                {mode === 'classico' && (
                  <span className="ld-mode__chk" aria-hidden="true">
                    <Check size={12} strokeWidth={3.2} />
                  </span>
                )}
                <span className="flex items-center gap-2.5 pr-7">
                  <span className="ld-mode__ic" aria-hidden="true">
                    <Layers size={18} />
                  </span>
                  <span>
                    <span className="ld-mode__t block">Modo Clássico</span>
                    <span className="ld-mode__k block">Uma decisão muda tudo</span>
                  </span>
                </span>
                <span className="ld-mode__d block">Dos 16 aos 39 anos em minutos. Propostas, lesões, polêmicas e títulos, decisão por decisão.</span>
                <span className="flex gap-1.5 mt-3 flex-wrap">
                  <span className="ld-meta">
                    <Clock3 size={12} aria-hidden /> ~10 min
                  </span>
                  <span className="ld-meta">
                    <Trophy size={12} aria-hidden /> {trophyLabel}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className={cx('lx-mode ld-mode', mode === 'imersivo' && 'is-on')}
                aria-pressed={mode === 'imersivo'}
                onClick={() => {
                  sfx.play('tap')
                  setMode('imersivo')
                }}
              >
                {mode === 'imersivo' ? (
                  <span className="ld-mode__chk" aria-hidden="true">
                    <Check size={12} strokeWidth={3.2} />
                  </span>
                ) : (
                  <span className="ld-mode__badge ld-soon">Novo</span>
                )}
                <span className="flex items-center gap-2.5 pr-16">
                  <span className="ld-mode__ic" aria-hidden="true">
                    <Tv2 size={18} />
                  </span>
                  <span>
                    <span className="ld-mode__t block">Modo Imersivo</span>
                    <span className="ld-mode__k block">Jogue partida a partida</span>
                  </span>
                </span>
                <span className="ld-mode__d block">Entre em campo nos lances decisivos, fale com a imprensa e dispute cada rodada.</span>
                <span className="ld-mini" aria-label="Prévia: Palmeiras 2 a 1 Flamengo, 78 minutos">
                  <Crest clubId="e2029" size={18} decorative />
                  <span aria-hidden>PAL</span>
                  <span className="ld-mini__sc" aria-hidden>
                    2–1
                  </span>
                  <span aria-hidden>FLA</span>
                  <Crest clubId="e819" size={18} decorative />
                  <span className="ld-mini__min" aria-hidden>
                    78&apos;
                  </span>
                </span>
              </button>
            </motion.div>

            {/* o ritmo (decisões a cada N temporadas) é só do Clássico; no Imersivo, o que esperar */}
            {mode === 'imersivo' ? (
              <motion.div className="ld-rhythm ld-rhythm--imm" {...rise(rm, 4)}>
                <span className="lx-eyebrow max-sm:hidden">Ritmo</span>
                <span className="ld-rhythm__hint" aria-live="polite">
                  <b>Semana a semana, partida a partida</b> · treino, imprensa, mercado e os lances decisivos de cada jogo
                </span>
              </motion.div>
            ) : (
              <motion.div className="ld-rhythm" {...rise(rm, 4)}>
                <span className="lx-eyebrow max-sm:hidden" id="ld-ritmo">
                  Ritmo
                </span>
                <Segmented<Pace> value={pace} onChange={setPace} options={paceOptions} aria-label="Ritmo da carreira" />
                <span className="ld-rhythm__hint" aria-live="polite">
                  <b>{info.lead}</b> · {info.tail}
                </span>
              </motion.div>
            )}

            <motion.div className="ld-ctas" {...rise(rm, 5)}>
              <Button variant="primary" size="xl" iconRight={ArrowRight} className="ld-ctas__start" onClick={start} onMouseEnter={() => void import('@/ui/shared/identity/IdentityScreen')}>
                Começar carreira
              </Button>
              {mode === 'imersivo' && imm && !imm.retired && (
                <Button variant="ghost" size="xl" className="ld-ctas__continue" onClick={() => navigate('/imersivo')} aria-label={`Continuar carreira imersiva: ${imm.identity.surname}, ${imm.age} anos, OVR ${imm.ovr}`}>
                  <span className="ld-continue">
                    <Tv2 size={18} aria-hidden />
                    <span className="min-w-0">
                      <span className="ld-continue__t">Continuar</span>
                      <span className="ld-continue__s">
                        {imm.identity.surname} · {imm.age} anos · OVR {imm.ovr}
                      </span>
                    </span>
                  </span>
                </Button>
              )}
              {mode === 'classico' && imm && !imm.retired && !classicActive && (
                <Button variant="ghost" size="xl" className="ld-ctas__continue" onClick={() => navigate('/imersivo')} aria-label={`Continuar carreira imersiva: ${imm.identity.surname}, ${imm.age} anos, OVR ${imm.ovr}`}>
                  <span className="ld-continue">
                    <Tv2 size={18} aria-hidden />
                    <span className="min-w-0">
                      <span className="ld-continue__t">Continuar · Imersivo</span>
                      <span className="ld-continue__s">
                        {imm.identity.surname} · {imm.age} anos · OVR {imm.ovr}
                      </span>
                    </span>
                  </span>
                </Button>
              )}
              {mode === 'classico' && state && classicActive && (
                <Button variant="ghost" size="xl" className="ld-ctas__continue" onClick={() => navigate('/carreira')} aria-label={`Continuar carreira: ${state.identity.surname}, ${state.age} anos, OVR ${state.ovr}`}>
                  <span className="ld-continue">
                    {club ? <Crest club={club} size={22} decorative /> : <Play size={18} aria-hidden />}
                    <span className="min-w-0">
                      <span className="ld-continue__t">Continuar</span>
                      <span className="ld-continue__s">
                        {state.identity.surname} · {state.age} anos · OVR {state.ovr}
                      </span>
                    </span>
                  </span>
                </Button>
              )}
              {state && finished && (
                <Button variant="ghost" size="xl" className="ld-ctas__continue" onClick={() => navigate('/resumo')}>
                  <span className="ld-continue">
                    <OvrPill ovr={state.ovr} size="sm" />
                    <span className="min-w-0">
                      <span className="ld-continue__t">Ver resumo</span>
                      <span className="ld-continue__s">{state.identity.surname} · carreira encerrada</span>
                    </span>
                  </span>
                </Button>
              )}
              <button type="button" className={cx('lx-icon-btn ld-medal')} aria-label={`Ver conquistas (${unlocked} de ${total})`} title="Ver conquistas" onClick={() => openDialog('achievements')}>
                <MedalIcon size={22} aria-hidden />
                <span className="ld-medal__count" aria-hidden="true">
                  {unlocked}/{total}
                </span>
              </button>
            </motion.div>
            {/* a carreira do outro modo em andamento também aparece, numa linha discreta (as duas podem existir) */}
            {other && (
              <motion.button type="button" className="ld-also" onClick={() => navigate(other.to)} {...rise(rm, 6)}>
                {other.to === '/carreira' ? <Layers size={15} aria-hidden /> : <Tv2 size={15} aria-hidden />}
                <span className="min-w-0">
                  Também em andamento: carreira {other.to === '/carreira' ? 'clássica' : 'imersiva'} de <b>{other.surname}</b> · {other.age} anos · OVR {other.ovr}
                </span>
                <ArrowRight size={14} aria-hidden className="flex-none" />
              </motion.button>
            )}
          </div>
          <HeroArt />
        </div>

        <LiveTicker />
        <Features />

        <footer className="ld-footer">
          <span>
            LENDA · projeto de fã, sem fins comerciais. Nomes, escudos e troféus pertencem aos seus respectivos detentores e aparecem só para identificação ·{' '}
            <a className="ld-footer__link" href={buildHash('/creditos')}>
              Créditos e licenças
            </a>
            {' · '}
            <a className="ld-footer__link" href={buildHash('/live')}>
              Live interativa (TikTok)
            </a>
          </span>
          <span>Dados de tabela: rodada atual de cada liga{data?.generatedAt ? ` · ${new Date(data.generatedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : ''}</span>
        </footer>
      </div>

      <Modal
        open={confirmNew}
        onClose={() => setConfirmNew(false)}
        size="sm"
        title="Começar uma nova carreira?"
        description={state ? `${state.identity.surname} está com ${state.age} anos e OVR ${state.ovr}. A nova carreira substitui a atual.` : undefined}
        footer={
          <div className="flex gap-2 justify-end flex-wrap w-full">
            <Button variant="ghost" size="md" onClick={() => { setConfirmNew(false); navigate('/carreira') }}>
              Continuar a atual
            </Button>
            <Button variant="primary" size="md" iconRight={ArrowRight} onClick={() => { setConfirmNew(false); navigate('/identidade', { query: { ritmo: pace, nova: 1 } }) }}>
              Nova carreira
            </Button>
          </div>
        }
      >
        <p className="m-0 text-[13.5px] text-text-2 leading-relaxed">A carreira atual só é substituída quando você confirmar a nova identidade. Carreiras encerradas continuam no Hall das Lendas.</p>
      </Modal>
    </main>
  )
}

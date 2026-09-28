/**
 * Landing (route "#/") — "Construa sua carreira no futebol."
 * Hero with the fanned player cards, mode cards, ritmo, CTAs (Começar / Continuar / Conquistas),
 * "AO VIVO · Líderes de hoje" ticker from the real standings, features and footer.
 */
import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, Check, Clock3, Layers, Play, Trophy, Tv2 } from 'lucide-react'
import type { Pace } from '@/engine/types'
import { navigate, useApp } from '@/store/app'
import { selectHasActiveCareer, useCareer } from '@/store/career'
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
    ['Hall da Fama', '#/hall'],
  ]
  return (
    <nav aria-label="Principal" className="ld-nav max-lg:hidden">
      {links.map(([label, href, soon]) => (
        <a key={href} href={href}>
          {label}
          {soon && <span className="ld-soon">Em breve</span>}
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

  // screenshots / deep links: #/?conquistas=1 opens the achievements dialog
  useEffect(() => {
    if (query.conquistas) openDialog('achievements')
  }, [query.conquistas, openDialog])

  const club = state?.clubId ? index?.clubById.get(state.clubId) : undefined
  const finished = !!state && (state.phase === 'finished' || state.retired)
  const day = shortDate(data?.generatedAt)
  const trophyCount = data?.trophies.length ?? 0
  const trophyLabel = trophyCount >= 20 ? `${Math.floor(trophyCount / 10) * 10}+ taças` : 'Taças reais'
  const paceOptions = useMemo(() => PACES.map((p) => ({ value: p, label: PACE_INFO[p].label })), [])
  const info = PACE_INFO[pace]

  const start = () => {
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
                <span className="hidden sm:inline text-[rgba(189,245,220,.72)] font-semibold">Tabelas reais de hoje{day ? ` · ${day}` : ''}</span>
              </LivePill>
            </motion.div>
            <motion.h1 className="ld-h1" {...rise(rm, 1)}>
              Construa sua carreira no <span className="lx-metal-text">futebol.</span>
            </motion.h1>
            <motion.p className="ld-lead" {...rise(rm, 2)}>
              Escolha sua origem, tome decisões importantes e deixe o destino te levar a uma trajetória única de <b>títulos, Bolas de Ouro e noites de Copa do Mundo</b>.
            </motion.p>

            <motion.div className="ld-modes" role="group" aria-label="Modo de jogo" {...rise(rm, 3)}>
              <button type="button" className="lx-mode ld-mode is-on" aria-pressed="true" onClick={() => sfx.play('tap')}>
                <span className="ld-mode__chk" aria-hidden="true">
                  <Check size={12} strokeWidth={3.2} />
                </span>
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
                className="lx-mode ld-mode"
                aria-pressed="false"
                aria-describedby="ld-imm-soon"
                onClick={() => {
                  sfx.play('tap')
                  navigate('/imersivo')
                }}
              >
                <span className="ld-mode__badge ld-soon" id="ld-imm-soon">
                  Em breve
                </span>
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

            <motion.div className="ld-rhythm" {...rise(rm, 4)}>
              <span className="lx-eyebrow max-sm:hidden" id="ld-ritmo">
                Ritmo
              </span>
              <Segmented<Pace> value={pace} onChange={setPace} options={paceOptions} aria-label="Ritmo da carreira" />
              <span className="ld-rhythm__hint" aria-live="polite">
                <b>{info.lead}</b> · {info.tail}
              </span>
            </motion.div>

            <motion.div className="ld-ctas" {...rise(rm, 5)}>
              <Button variant="primary" size="xl" iconRight={ArrowRight} className="ld-ctas__start" onClick={start} onMouseEnter={() => void import('@/ui/shared/identity/IdentityScreen')}>
                Começar carreira
              </Button>
              {state && !state.retired && active && (
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
          </div>
          <HeroArt />
        </div>

        <LiveTicker />
        <Features />

        <footer className="ld-footer">
          <span>LENDA · projeto de fã, sem fins comerciais. Nomes, escudos e troféus pertencem aos seus respectivos detentores.</span>
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
            <Button variant="primary" size="md" iconRight={ArrowRight} onClick={() => { setConfirmNew(false); navigate('/identidade', { query: { ritmo: pace } }) }}>
              Nova carreira
            </Button>
          </div>
        }
      >
        <p className="m-0 text-[13.5px] text-text-2 leading-relaxed">A carreira atual só é substituída quando você confirmar a nova identidade. Carreiras encerradas continuam no Hall da Fama.</p>
      </Modal>
    </main>
  )
}

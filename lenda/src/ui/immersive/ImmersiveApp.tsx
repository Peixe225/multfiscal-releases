/**
 * Modo Imersivo (route "#/imersivo") — a carreira vivida partida a partida, no grafismo
 * "Transmissão" (<html data-lx-theme="transmissao">).
 *
 *   #/imersivo                       Central da semana (hub)
 *   #/imersivo?tela=agenda|social|mercado|carreira|temporada|gala
 *   #/imersivo?fixture=<nome>        estado de exemplo (dev/screenshots) — ver ./fixtures.ts
 *
 * A partida ao vivo e a coletiva tomam a tela enquanto estiverem em andamento (state.live / state.press).
 */
import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ArrowRight, Tv2 } from 'lucide-react'
import { navigate, useApp } from '@/store/app'
import { useClub, useData } from '@/store/data'
import { useImmersive } from '@/store/immersive'
import { Button, Stadium, clubVars } from '@/ui/primitives'
import { useShellSlots } from '@/ui/shell/slots'
import { EffectsHost } from './fx/EffectsHost'
import { ImNav, ImTopActions, LiveTopCenter, PressTopCenter, type ImTab } from './shell/ImTopBar'
import { ImTicker } from './shell/ImTicker'
import { currentItem } from './model/view'
import './immersive.css'

const Hub = lazy(() => import('./hub/HubScreen'))
const MatchScreen = lazy(() => import('./match/MatchScreen'))
const PressConference = lazy(() => import('./press/PressConference'))
const SocialScreen = lazy(() => import('./social/SocialScreen'))
const MarketScreen = lazy(() => import('./market/MarketScreen'))
const CareerScreen = lazy(() => import('./career/CareerTab'))
const AgendaScreen = lazy(() => import('./hub/AgendaScreen'))
const SeasonReview = lazy(() => import('./season/SeasonReview'))
const Ceremony = lazy(() => import('./season/Ceremony'))

/** Sem clube: índigo + ouro da marca. */
const BRAND_COLORS = { primary: '#5c50ff', secondary: '#ffc45c', glow: '#5c50ff' }

const TABS: ImTab[] = ['central', 'agenda', 'social', 'mercado', 'carreira']

/** Esqueleto no grid da Central (chanfros da Transmissão); acima de 1 s vira o "preparando a temporada". */
function Loading() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 1000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="im-wrap im-loading" aria-busy="true" aria-label="Carregando o Modo Imersivo">
      <div className="im-sk im-sk--head" />
      <div className="im-hub__grid">
        <div className="im-hub__now">
          <div className="im-sk im-sk--now" />
        </div>
        <div className="im-hub__me">
          <div className="im-sk im-sk--plate" />
          <div className="im-sk im-sk--panel" />
        </div>
        <div className="im-hub__agenda">
          <div className="im-sk im-sk--strip" />
        </div>
      </div>
      {slow && (
        <div className="im-loading__lt" role="status">
          <span className="lx-lt lx-lt--live">
            <span className="lx-lt__a">
              <Tv2 aria-hidden="true" />
            </span>
            <span className="lx-lt__b">
              <span className="lx-lt__k">Transmissão</span>
              <span className="lx-lt__v">Preparando a temporada…</span>
            </span>
          </span>
          <span className="im-loading__bar" aria-hidden="true" />
        </div>
      )}
    </div>
  )
}

function NoCareer() {
  return (
    <main id="conteudo" tabIndex={-1} className="im-wrap im-empty outline-none">
      <div className="lx-plate lx-plate--glass lx-c-lg im-empty__card lx-anim-rise">
        <span className="lx-kicker">
          <span className="lx-live-dot" /> Modo Imersivo
        </span>
        <h1 className="lx-t-display mt-3 mb-0">Jogue partida a partida</h1>
        <p className="lx-t-body mt-3 mb-0">
          Treine durante a semana, entre em campo nos lances decisivos, encare a imprensa, negocie contratos e dispute cada rodada — com grafismo de transmissão de TV.
        </p>
        <div className="flex flex-wrap gap-3 mt-6">
          <Button variant="primary" size="lg" iconRight={ArrowRight} onClick={() => navigate('/identidade', { query: { modo: 'imersivo' } })}>
            Começar carreira imersiva
          </Button>
          <Button variant="ghost" size="lg" onClick={() => navigate('/')}>
            Voltar
          </Button>
        </div>
      </div>
    </main>
  )
}

export default function ImmersiveApp() {
  const status = useImmersive((s) => s.status)
  const state = useImmersive((s) => s.state)
  const fixture = useImmersive((s) => s.fixture)
  const fixtureWarning = useImmersive((s) => s.fixtureWarning)
  const dataReady = useData((s) => s.status === 'ready')
  const query = useApp((s) => s.route.query)
  const club = useClub(state?.clubId ?? null)
  const vars = useMemo(() => clubVars(club ?? BRAND_COLORS) as CSSProperties, [club])

  useEffect(() => {
    void useImmersive.getState().init()
  }, [])
  useEffect(() => {
    if (!query.fixture || !dataReady || status !== 'ready' || fixture === query.fixture) return
    void useImmersive.getState().loadFixture(query.fixture)
  }, [query.fixture, dataReady, status, fixture])

  const live = !!state?.live
  const press = !!state?.press
  // a coletiva segura a tela até o card de fechamento ser dispensado
  const [pressHold, setPressHold] = useState(false)
  useEffect(() => {
    if (press) setPressHold(true)
  }, [press])
  useEffect(() => {
    if (!state) setPressHold(false)
  }, [state])
  const it = state ? currentItem(state) : null
  const tela = query.tela ?? ''
  const inPress = press || (pressHold && !live)
  const view: string = live ? 'partida' : inPress ? 'coletiva' : state?.retired && tela !== 'temporada' && tela !== 'gala' ? 'carreira' : tela === 'temporada' || tela === 'gala' ? tela : (TABS as string[]).includes(tela) ? tela : 'central'
  const tab: ImTab | null = (TABS as string[]).includes(view) ? (view as ImTab) : null

  useShellSlots(
    {
      sub: 'IMERSIVO',
      // partida e coletiva tomam a tela: sem abas (nenhum destino que não abre)
      center: state ? live ? <LiveTopCenter /> : inPress ? <PressTopCenter /> : <ImNav active={tab} /> : null,
      extraActions: state ? <ImTopActions /> : undefined,
      stage: { hidden: true },
    },
    [!!state, live, inPress, tab],
  )

  const waiting = status !== 'ready' || !dataReady || (!!query.fixture && fixture !== query.fixture)

  return (
    <div className="im-root" style={vars} data-view={view}>
      <Stadium variant={view === 'coletiva' ? 'press' : view === 'gala' ? 'gala' : 'club'} />
      {waiting ? (
        <Loading />
      ) : !state ? (
        <NoCareer />
      ) : (
        <Suspense fallback={<Loading />}>
          {view === 'partida' ? (
            <MatchScreen />
          ) : view === 'coletiva' ? (
            <PressConference onDone={() => setPressHold(false)} />
          ) : view === 'social' ? (
            <SocialScreen />
          ) : view === 'mercado' ? (
            <MarketScreen />
          ) : view === 'carreira' ? (
            <CareerScreen />
          ) : view === 'agenda' ? (
            <AgendaScreen />
          ) : view === 'temporada' ? (
            <SeasonReview />
          ) : view === 'gala' ? (
            <Ceremony />
          ) : (
            <Hub />
          )}
        </Suspense>
      )}
      {state && !live && view !== 'gala' && view !== 'coletiva' && <ImTicker />}
      {state && <EffectsHost />}
      {fixtureWarning && fixture && (
        <div className="im-fxwarn" role="alert">
          <b>Fixture</b> {fixtureWarning}
        </div>
      )}
      {state && it?.kind === 'awards' && view === 'central' && <SeasonNudge />}
    </div>
  )
}

/** Fim de temporada processado: leva ao balanço. */
function SeasonNudge() {
  return (
    <div className="im-nudge lx-anim-rise" role="status">
      <Tv2 size={16} aria-hidden="true" />
      <span>Temporada encerrada — o balanço e a premiação estão prontos.</span>
      <Button variant="primary" size="sm" iconRight={ArrowRight} onClick={() => navigate('/imersivo', { query: { tela: 'temporada' } })}>
        Ver balanço
      </Button>
    </div>
  )
}

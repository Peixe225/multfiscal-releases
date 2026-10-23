/**
 * App shell: router, club theming on the root, ambient stage, top bar, page transitions,
 * loading splash, dialogs (menu, achievements), toasts.
 *
 * Celular (v3.5):
 *  - a Home ("/") pinta sem esperar o pacote de dados (título e "Começar carreira" na hora; o resto entra quando
 *    os dados chegam). As outras rotas esperam, com a splash;
 *  - toda tela e todo pedaço montado aqui (conquistas, live) tem uma barreira: sem rede, uma mensagem em pt-BR e
 *    nova tentativa (ver ./pedacos.ts e ./ErrorBoundary.tsx), nunca a página preta;
 *  - com a Home parada, os pedaços que a pessoa abre em seguida já vêm (identidade, conquistas, Hall, Desafios);
 *  - o "voltar" devolve a rolagem de onde a pessoa estava (a posição é guardada por entrada do histórico).
 */
import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState, type CSSProperties, type ErrorInfo, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { LoaderCircle, RotateCcw } from 'lucide-react'
import { navigate, startRouter, syncDocumentFlags, useApp, type NavKind, type RoutePath, type RouteState } from '@/store/app'
import { entradaAtual } from '@/store/historico'
import { podeDebug, podeLive, portaoDaRota, useAcesso } from '@/store/acesso'
import { useCareer } from '@/store/career'
import { useLiveSession } from '@/live/config'
import { isCaptureWindow } from '@/live/channel'
import { useClub, useData } from '@/store/data'
import { Modal, Skeleton, Stadium, Stage, Toaster, toast } from '@/ui/primitives'
import { useReducedMotion } from '@/ui/primitives/hooks'
import { clubVars, type ClubColors } from '@/ui/theme/club'
import { ErrorBoundary, podeRecarregarAgora } from './ErrorBoundary'
import { lazySite } from './lazySite'
import { MenuDialog } from './MenuDialog'
import { AvisoFaixa } from './AvisoFaixa'
import { ehFalhaDeCarga, internetVoltou, semConexaoAgora } from './pedacos'
import { PortaoTela, SeloAdmin } from './Portao'
import { CONQUISTAS, SCREENS, prefetchRoute, telaFalhou, themeFor } from './routes'
import { useSlotStore } from './slots'
import { Splash } from './Splash'
import { TopBar } from './TopBar'

/** Live interativa (TikTok): conexão, autopiloto e a faixa da live — carregados só quando usados. */
const LiveRoot = lazy(() => import('@/ui/live/LiveRoot'))

/** Só no site público (VITE_SITE=1): medição de visitantes e conta (src/site). Fora dele nem entra no bundle. */
const SiteRoot = import.meta.env.VITE_SITE === '1' ? lazySite('SiteRoot', () => import('@/site/SiteRoot')) : null

/** Brand light when there is no club (indigo + gold, from the landing mockup). */
export const BRAND_COLORS: ClubColors = { primary: '#5c50ff', secondary: '#ffc45c', glow: '#5c50ff' }

function AmbientStage({ path, theme }: { path: RoutePath; theme: 'noite' | 'transmissao' }) {
  const stage = useSlotStore((s) => s.slots.stage)
  if (stage?.hidden) return null
  if (theme === 'transmissao') return <Stadium variant={path === '/imersivo' ? undefined : 'calm'} />
  const preset = stage?.preset ?? (path === '/' ? 'brand' : path === '/hall' ? 'legend' : 'club')
  return <Stage preset={preset} club={stage?.club} colors={stage?.colors} />
}

function ScreenFallback() {
  return (
    <div className="relative z-[1] flex-1 w-full max-w-[1392px] mx-auto px-4 sm:px-6 pt-4 grid gap-3 content-start" aria-busy="true" aria-label="Carregando">
      <Skeleton h={120} r={22} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton h={220} r={22} />
        <Skeleton h={220} r={22} />
      </div>
    </div>
  )
}

/** Barreira sem tela de erro: um pedaço do shell que caiu some (e quem monta decide o que fazer). */
class Barreira extends Component<{ aoFalhar?: (e: unknown) => void; children: ReactNode }, { caiu: boolean }> {
  state = { caiu: false }
  static getDerivedStateFromError() {
    return { caiu: true }
  }
  componentDidCatch(e: unknown, info: ErrorInfo) {
    console.warn('[LENDA] um pedaço do jogo não carregou', e, info.componentStack)
    this.props.aoFalhar?.(e)
  }
  render() {
    return this.state.caiu ? null : this.props.children
  }
}

/** Resposta na hora ao toque em Conquistas enquanto o pedaço chega (raro: a Home já pré-carrega). */
function ConquistasCarregando({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Conquistas" size="lg">
      <div className="grid place-items-center gap-3 py-14 text-text-2" aria-busy="true">
        <LoaderCircle className="lx-spin" size={26} aria-hidden />
        <p className="m-0 text-[13.5px]">Carregando as conquistas…</p>
      </div>
    </Modal>
  )
}

function AchievementsHost() {
  const open = useApp((s) => s.dialog === 'achievements')
  const close = useApp((s) => s.closeDialog)
  // mount lazily after the first open, keep mounted for exit animations
  const [mounted, setMounted] = useState(false)
  const [vez, setVez] = useState(0)
  useEffect(() => {
    if (open) setMounted(true)
  }, [open])
  if (!mounted && !open) return null
  const Conquistas = CONQUISTAS.atual
  return (
    <Barreira
      key={vez}
      aoFalhar={(e) => {
        // sem rede: fecha o diálogo e avisa; a próxima vez busca o pedaço de novo (nada de tela preta)
        CONQUISTAS.falhou(e)
        if (useApp.getState().dialog === 'achievements') useApp.getState().closeDialog()
        if (semConexaoAgora()) toast.info('Sem conexão', 'As conquistas abrem quando a internet voltar.', { key: 'conquistas-rede' })
        else if (ehFalhaDeCarga(e))
          // com a internet de volta e ainda assim não veio: o navegador guardou a falha de um arquivo até recarregar
          void internetVoltou().then((ok) =>
            ok
              ? toast.info('Não deu para abrir as conquistas', 'Falta um pedaço do jogo nesta página. Recarregue: a sua carreira está salva neste aparelho.', {
                  key: 'conquistas-rede',
                  duration: 8000,
                  action: { label: 'Recarregar a página', icon: RotateCcw, onClick: () => location.reload() },
                })
              : toast.info('Sem conexão', 'As conquistas abrem quando a internet voltar.', { key: 'conquistas-rede' }),
          )
        else toast.error('Não deu para abrir as conquistas', 'Tente de novo em instantes.', { key: 'conquistas-rede' })
        setMounted(false)
        setVez((n) => n + 1)
      }}
    >
      <Suspense fallback={open ? <ConquistasCarregando onClose={close} /> : null}>
        <Conquistas open={open} onClose={close} />
      </Suspense>
    </Barreira>
  )
}

type Ocioso = (cb: () => void, o?: { timeout: number }) => number
/** O aparelho pediu para economizar dados (saveData) ou está numa rede 2G. */
const economizando = () => {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  return !!c?.saveData || /(^|-)2g$/.test(c?.effectiveType ?? '')
}
/** Roda `fn` quando o navegador sossegar (sem requestIdleCallback — Safari —, depois de `reserva` ms). */
function quandoOcioso(fn: () => void, reserva = 1200, max = 4000): () => void {
  const ric = (window as Window & { requestIdleCallback?: Ocioso }).requestIdleCallback
  if (ric) {
    const id = ric(fn, { timeout: max })
    return () => (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id)
  }
  const t = window.setTimeout(fn, reserva)
  return () => window.clearTimeout(t)
}

/**
 * Com a Home pintada: a identidade já (é o próximo toque de quase todo mundo); com o navegador ocioso, as
 * conquistas e as telas que a Home oferece (Hall, Desafios, Perfil). Sem rede agora, espera ela voltar.
 */
function usePreCargaDaHome(naHome: boolean, pronto: boolean) {
  const feito = useRef({ identidade: false, resto: false })
  useEffect(() => {
    if (!naHome || typeof window === 'undefined') return
    let cancelar = () => {}
    const ir = () => {
      if (semConexaoAgora()) return
      if (!feito.current.identidade) {
        feito.current.identidade = true
        prefetchRoute('/identidade')
      }
      if (!pronto || feito.current.resto) return
      cancelar = quandoOcioso(() => {
        if (semConexaoAgora() || feito.current.resto) return
        feito.current.resto = true
        CONQUISTAS.precarregar()
        if (economizando()) return
        prefetchRoute('/hall')
        if (import.meta.env.VITE_SITE === '1') {
          prefetchRoute('/desafios')
          prefetchRoute('/jogador')
        }
      })
    }
    const t = window.setTimeout(ir, 300)
    window.addEventListener('online', ir)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('online', ir)
      cancelar()
    }
  }, [naHome, pronto])
}

/** Posição da rolagem de cada entrada do histórico (o "voltar" devolve a pessoa onde ela estava). */
const posicoes = new Map<string, number>()
const chaveDaEntrada = () => String(entradaAtual() ?? location.hash)

function useRolagemPorEntrada(route: RouteState, kind: NavKind) {
  const chave = useRef(chaveDaEntrada())
  const restaurando = useRef(false)
  const pathAntes = useRef(route.path)
  useEffect(() => {
    let raf = 0
    const on = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (!restaurando.current) posicoes.set(chave.current, window.scrollY)
      })
    }
    window.addEventListener('scroll', on, { passive: true })
    return () => {
      window.removeEventListener('scroll', on)
      cancelAnimationFrame(raf)
    }
  }, [])
  const q = JSON.stringify(route.query)
  useEffect(() => {
    const mudouTela = pathAntes.current !== route.path
    pathAntes.current = route.path
    const k = chaveDaEntrada()
    chave.current = k
    const alvo = kind === 'voltar' || kind === 'avancar' ? posicoes.get(k) : undefined
    // tela nova (ou sem posição guardada): do topo; a mesma tela com outra query (filtros): fica onde está
    if (!alvo) {
      if (mudouTela) window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
      return
    }
    // a tela de antes sai (animação) e a nova monta (Suspense, linhas da comunidade): tenta por até ~1,5 s
    restaurando.current = true
    const t0 = performance.now()
    let raf = 0
    const fim = () => {
      restaurando.current = false
      cancelAnimationFrame(raf)
      for (const ev of ['touchstart', 'wheel', 'keydown', 'pointerdown'] as const) window.removeEventListener(ev, fim)
      posicoes.set(k, window.scrollY)
    }
    for (const ev of ['touchstart', 'wheel', 'keydown', 'pointerdown'] as const) window.addEventListener(ev, fim, { passive: true })
    const passo = () => {
      const pagina = document.querySelector<HTMLElement>(`.lx-page[data-rota="${route.path}"]`)
      const pronta = !!pagina && !pagina.querySelector(':scope > [aria-busy="true"]')
      if (pronta) {
        const max = document.documentElement.scrollHeight - window.innerHeight
        const y = Math.min(alvo, Math.max(0, max))
        if (Math.abs(window.scrollY - y) > 2) window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior })
      }
      if (performance.now() - t0 > 1500) return fim()
      raf = requestAnimationFrame(passo)
    }
    raf = requestAnimationFrame(passo)
    return fim
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.path, q])
}

export function AppShell() {
  const route = useApp((s) => s.route)
  const navDir = useApp((s) => s.navDir)
  const navKind = useApp((s) => s.navKind)
  const status = useData((s) => s.status)
  const error = useData((s) => s.error)
  const clubId = useCareer((s) => s.state?.clubId ?? null)
  const club = useClub(clubId)
  const rm = useReducedMotion()
  const theme = themeFor(route.path, route.query)
  const liveOn = useLiveSession((s) => s.on)
  // site: o que o público não vê (Live, Modo Imersivo em teste, #/kit, manutenção) — src/store/acesso.ts
  const portao = useAcesso((s) => portaoDaRota(route, s))
  const liveLiberada = useAcesso(podeLive)
  const debug = useAcesso((s) => podeDebug(s))
  const liveMounted = liveLiberada && (liveOn || route.path === '/live')
  // a Live não é pública e quem está aqui não é o admin: um modo live que ficou ligado nesta aba desliga
  const liveNegada = useAcesso((s) => s.configPronta && s.adminStatus === 'nao' && !podeLive(s))
  useEffect(() => {
    if (liveNegada && useLiveSession.getState().on) useLiveSession.getState().stop()
  }, [liveNegada])
  // a faixa da live ocupa o lugar da barra do topo onde o público vê o jogo
  const liveHud = liveLiberada && liveOn && (route.path === '/carreira' || (route.path === '/live' && route.query.tela === 'palco'))
  // janela de captura esperando o começo: sem a barra do jogo no ar (nada de menu clicável na live)
  const captureIdle = !liveOn && route.path === '/live' && route.query.tela === 'palco' && isCaptureWindow()

  useEffect(() => startRouter(), [])
  useEffect(() => syncDocumentFlags(), [])
  const carregarDados = () =>
    useData
      .getState()
      .load()
      .then(() => useCareer.getState().init())
  useEffect(() => {
    void carregarDados().catch(() => {})
  }, [])
  // os dados não vieram: tenta de novo sozinho quando a internet voltar
  useEffect(() => {
    if (status !== 'error') return
    const on = () => void tentarDadosDeNovo()
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])
  /** A splash de erro: tenta de novo; se falhar com a internet de volta (o navegador guardou a falha), recarrega. */
  const tentarDadosDeNovo = async () => {
    try {
      await carregarDados()
    } catch {
      if ((await internetVoltou()) && podeRecarregarAgora()) location.reload()
    }
  }
  // dev/screenshots: #/carreira?fixture=mid|end|reveal|new loads a fixture career (never persisted)
  const fixture = route.query.fixture
  useEffect(() => {
    if (!fixture || status !== 'ready' || !debug) return
    if (fixture === 'new' || fixture === 'mid' || fixture === 'end' || fixture === 'reveal') {
      const run = () => void useCareer.getState().loadFixture(fixture)
      if (useCareer.getState().status === 'ready') run()
      else {
        const un = useCareer.subscribe((s) => {
          if (s.status === 'ready') {
            un()
            run()
          }
        })
        return un
      }
    }
  }, [fixture, status, debug])
  useEffect(() => {
    document.documentElement.setAttribute('data-lx-theme', theme)
    useApp.setState({ theme })
  }, [theme])
  useRolagemPorEntrada(route, navKind)
  // legacy "#/" guard: unknown routes are normalised to "/"
  useEffect(() => {
    if (location.hash && location.hash.startsWith('#/') && !SCREENS[route.path]) navigate('/', { replace: true })
  }, [route.path])

  const vars = useMemo(() => clubVars(club ?? BRAND_COLORS) as CSSProperties, [club])
  // nova tentativa da tela: o lazy novo vem do getter (SCREENS) quando o shell desenha de novo
  const [, setVez] = useState(0)
  const Screen = SCREENS[route.path] ?? SCREENS['/']
  const ready = status === 'ready'
  // a Home não espera o pacote de dados (título e "Começar carreira" na hora); as outras rotas, sim
  const naHome = route.path === '/' && portao === 'ok'
  const mostrar = ready || (naHome && status !== 'error')
  usePreCargaDaHome(naHome && mostrar, ready)

  return (
    <div className="lx-app" style={vars}>
      <button
        type="button"
        className="lx-skip-link"
        onClick={() => {
          const main = document.getElementById('conteudo') ?? document.querySelector('main')
          if (main instanceof HTMLElement) {
            if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1')
            main.focus()
          }
        }}
      >
        Pular para o conteúdo
      </button>
      <AmbientStage path={route.path} theme={theme} />
      {/* o aviso do site nunca aparece na live (palco/janela de captura vão para a transmissão) */}
      {ready && portao !== 'manutencao' && !liveHud && !captureIdle && route.path !== '/live' && <AvisoFaixa />}
      {mostrar && !liveHud && !captureIdle && portao !== 'manutencao' && <TopBar path={route.path} />}
      {ready && liveMounted && (
        <Barreira>
          <Suspense fallback={null}>
            <LiveRoot />
          </Suspense>
        </Barreira>
      )}
      {mostrar && (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={route.path}
            data-rota={route.path}
            className="lx-page"
            initial={rm ? { opacity: 0 } : { opacity: 0, y: 10 * navDir }}
            animate={{ opacity: 1, y: 0, transition: { duration: rm ? 0.12 : 0.34, ease: [0.16, 1, 0.3, 1] } }}
            exit={rm ? { opacity: 0, transition: { duration: 0.08 } } : { opacity: 0, y: -6 * navDir, transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }}
          >
            <ErrorBoundary resetKey={route.path} debug={debug} aoFalharCarga={(e) => telaFalhou(route.path, e)} aoTentarDeNovo={() => setVez((n) => n + 1)}>
              <Suspense fallback={<ScreenFallback />}>{portao === 'ok' ? <Screen /> : <PortaoTela tipo={portao} />}</Suspense>
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      )}
      <AnimatePresence>{!mostrar && <Splash key="splash" error={status === 'error' ? error : null} debug={debug} onRetry={() => void tentarDadosDeNovo()} />}</AnimatePresence>
      <MenuDialog />
      <AchievementsHost />
      {ready && <SeloAdmin />}
      {SiteRoot && <SiteRoot />}
      <Toaster />
    </div>
  )
}

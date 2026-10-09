/**
 * App shell: router, club theming on the root, ambient stage, top bar, page transitions,
 * loading splash, dialogs (menu, achievements), toasts.
 */
import { Suspense, lazy, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { navigate, startRouter, syncDocumentFlags, useApp, type RoutePath } from '@/store/app'
import { useCareer } from '@/store/career'
import { useLiveSession } from '@/live/config'
import { useClub, useData } from '@/store/data'
import { Skeleton, Stadium, Stage, Toaster } from '@/ui/primitives'
import { useReducedMotion } from '@/ui/primitives/hooks'
import { clubVars, type ClubColors } from '@/ui/theme/club'
import { ErrorBoundary } from './ErrorBoundary'
import { MenuDialog } from './MenuDialog'
import { AchievementsDialog, SCREENS, themeFor } from './routes'
import { useSlotStore } from './slots'
import { Splash } from './Splash'
import { TopBar } from './TopBar'

/** Live interativa (TikTok): conexão, autopiloto e a faixa da live — carregados só quando usados. */
const LiveRoot = lazy(() => import('@/ui/live/LiveRoot'))

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

function AchievementsHost() {
  const open = useApp((s) => s.dialog === 'achievements')
  const close = useApp((s) => s.closeDialog)
  // mount lazily after the first open, keep mounted for exit animations
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (open) setMounted(true)
  }, [open])
  if (!mounted && !open) return null
  return (
    <Suspense fallback={null}>
      <AchievementsDialog open={open} onClose={close} />
    </Suspense>
  )
}

export function AppShell() {
  const route = useApp((s) => s.route)
  const navDir = useApp((s) => s.navDir)
  const status = useData((s) => s.status)
  const error = useData((s) => s.error)
  const clubId = useCareer((s) => s.state?.clubId ?? null)
  const club = useClub(clubId)
  const rm = useReducedMotion()
  const theme = themeFor(route.path, route.query)
  const liveOn = useLiveSession((s) => s.on)
  const liveMounted = liveOn || route.path === '/live'
  // a faixa da live ocupa o lugar da barra do topo onde o público vê o jogo
  const liveHud = liveOn && (route.path === '/carreira' || (route.path === '/live' && route.query.tela === 'palco'))

  useEffect(() => startRouter(), [])
  useEffect(() => syncDocumentFlags(), [])
  useEffect(() => {
    void useData
      .getState()
      .load()
      .then(() => useCareer.getState().init())
      .catch(() => {})
  }, [])
  // dev/screenshots: #/carreira?fixture=mid|end|reveal|new loads a fixture career (never persisted)
  const fixture = route.query.fixture
  useEffect(() => {
    if (!fixture || status !== 'ready') return
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
  }, [fixture, status])
  useEffect(() => {
    document.documentElement.setAttribute('data-lx-theme', theme)
    useApp.setState({ theme })
  }, [theme])
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [route.path])
  // legacy "#/" guard: unknown routes are normalised to "/"
  useEffect(() => {
    if (location.hash && location.hash.startsWith('#/') && !SCREENS[route.path]) navigate('/', { replace: true })
  }, [route.path])

  const vars = useMemo(() => clubVars(club ?? BRAND_COLORS) as CSSProperties, [club])
  const Screen = SCREENS[route.path] ?? SCREENS['/']
  const ready = status === 'ready'

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
      {ready && !liveHud && <TopBar path={route.path} />}
      {ready && liveMounted && (
        <Suspense fallback={null}>
          <LiveRoot />
        </Suspense>
      )}
      {ready && (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={route.path}
            className="lx-page"
            initial={rm ? { opacity: 0 } : { opacity: 0, y: 10 * navDir }}
            animate={{ opacity: 1, y: 0, transition: { duration: rm ? 0.12 : 0.34, ease: [0.16, 1, 0.3, 1] } }}
            exit={rm ? { opacity: 0, transition: { duration: 0.08 } } : { opacity: 0, y: -6 * navDir, transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }}
          >
            <ErrorBoundary resetKey={route.path}>
              <Suspense fallback={<ScreenFallback />}>
                <Screen />
              </Suspense>
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      )}
      <AnimatePresence>{!ready && <Splash key="splash" error={status === 'error' ? error : null} onRetry={() => location.reload()} />}</AnimatePresence>
      <MenuDialog />
      <AchievementsHost />
      <Toaster />
    </div>
  )
}

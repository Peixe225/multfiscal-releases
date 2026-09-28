/**
 * Route table (hash router). Screens are lazy chunks owned by other teams; each file default-exports
 * a component with no props. Unknown hashes fall back to "/".
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { RoutePath } from '@/store/app'

type Loader = () => Promise<Record<string, unknown>>

/** lazy() that accepts default OR a named export (teams may use either). */
function screen(load: Loader, named: string): LazyExoticComponent<ComponentType> {
  return lazy(async () => {
    const m = await load()
    const C = (m.default ?? m[named]) as ComponentType | undefined
    if (!C) throw new Error(`Tela "${named}" não exporta um componente.`)
    return { default: C }
  })
}

export const SCREENS: Record<RoutePath, LazyExoticComponent<ComponentType>> = {
  '/': screen(() => import('@/ui/shared/landing/LandingScreen'), 'LandingScreen'),
  '/identidade': screen(() => import('@/ui/shared/identity/IdentityScreen'), 'IdentityScreen'),
  '/carreira': screen(() => import('@/ui/classic/cockpit/CareerScreen'), 'CareerScreen'),
  '/resumo': screen(() => import('@/ui/classic/summary/SummaryScreen'), 'SummaryScreen'),
  '/ligas': screen(() => import('@/ui/shared/live/LiveLeaguesScreen'), 'LiveLeaguesScreen'),
  '/hall': screen(() => import('@/ui/shared/hall/HallScreen'), 'HallScreen'),
  '/imersivo': screen(() => import('@/ui/immersive/ImmersiveApp'), 'ImmersiveApp'),
  '/kit': screen(() => import('./KitScreen'), 'KitScreen'),
  '/creditos': screen(() => import('@/ui/shared/credits/CreditsScreen'), 'CreditsScreen'),
}

export const AchievementsDialog = lazy(async () => {
  const m = (await import('@/ui/shared/achievements/AchievementsDialog')) as Record<string, unknown>
  return { default: (m.default ?? m.AchievementsDialog) as ComponentType<{ open: boolean; onClose: () => void }> }
})

/** Warm a route chunk (hover/focus on links). */
export const prefetchRoute = (path: RoutePath) => {
  const loaders: Partial<Record<RoutePath, Loader>> = {
    '/identidade': () => import('@/ui/shared/identity/IdentityScreen'),
    '/carreira': () => import('@/ui/classic/cockpit/CareerScreen'),
    '/resumo': () => import('@/ui/classic/summary/SummaryScreen'),
    '/imersivo': () => import('@/ui/immersive/ImmersiveApp'),
  }
  void loaders[path]?.().catch(() => {})
}

/** Theme per route (Transmissão only for the immersive mode). */
export const themeFor = (path: RoutePath, query: Record<string, string>): 'noite' | 'transmissao' =>
  query.theme === 'transmissao' || query.theme === 'noite' ? (query.theme as 'noite' | 'transmissao') : path === '/imersivo' || (path === '/identidade' && query.modo === 'imersivo') ? 'transmissao' : 'noite'

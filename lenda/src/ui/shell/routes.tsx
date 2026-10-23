/**
 * Route table (hash router). Screens are lazy chunks owned by other teams; each file default-exports
 * a component with no props. Unknown hashes fall back to "/".
 *
 * Cada tela é um pedaço com nova tentativa (./pedacos.ts): `SCREENS[path]` devolve sempre o lazy de AGORA
 * (um novo depois de cada falha de rede), e `telaFalhou(path, erro)` avisa a falha. Assim "Tentar de novo",
 * ir ao Início e voltar, ou a internet voltando abrem a tela sem recarregar a página.
 */
import type { ComponentType, LazyExoticComponent } from 'react'
import type { RoutePath } from '@/store/app'
import { pedaco, type Pedaco } from './pedacos'

/** As telas só do site (v3.3): fora dele o roteador nem chega nelas (viram "/"), e o código não entra no bundle. */
const SITE = import.meta.env.VITE_SITE === '1'

const LANDING = pedaco(() => import('@/ui/shared/landing/LandingScreen'), 'LandingScreen')

const PEDACOS: Record<RoutePath, Pedaco> = {
  '/': LANDING,
  '/identidade': pedaco(() => import('@/ui/shared/identity/IdentityScreen'), 'IdentityScreen'),
  '/carreira': pedaco(() => import('@/ui/classic/cockpit/CareerScreen'), 'CareerScreen'),
  '/resumo': pedaco(() => import('@/ui/classic/summary/SummaryScreen'), 'SummaryScreen'),
  '/ligas': pedaco(() => import('@/ui/shared/live/LiveLeaguesScreen'), 'LiveLeaguesScreen'),
  '/hall': pedaco(() => import('@/ui/shared/hall/HallScreen'), 'HallScreen'),
  '/imersivo': pedaco(() => import('@/ui/immersive/ImmersiveApp'), 'ImmersiveApp'),
  '/kit': pedaco(() => import('./KitScreen'), 'KitScreen'),
  '/creditos': pedaco(() => import('@/ui/shared/credits/CreditsScreen'), 'CreditsScreen'),
  '/live': pedaco(() => import('@/ui/live/LiveScreen'), 'LiveScreen'),
  '/desafios': SITE ? pedaco(() => import('@/site/DesafiosTela'), 'DesafiosTela') : LANDING,
  '/jogador': SITE ? pedaco(() => import('@/site/PerfilPublico'), 'PerfilPublico') : LANDING,
  '/verificar': SITE ? pedaco(() => import('@/site/VerificarTela'), 'VerificarTela') : LANDING,
}

/** A tela de cada rota: o lazy de agora (getter — depois de uma falha de rede, um novo). */
export const SCREENS: Readonly<Record<RoutePath, LazyExoticComponent<ComponentType>>> = Object.defineProperties(
  {},
  Object.fromEntries((Object.keys(PEDACOS) as RoutePath[]).map((k) => [k, { enumerable: true, get: () => PEDACOS[k].atual }])),
) as Record<RoutePath, LazyExoticComponent<ComponentType>>

/** A tela da rota caiu com este erro: se o arquivo dela não veio, a próxima vez busca de novo. */
export const telaFalhou = (path: RoutePath, erro: unknown): boolean => PEDACOS[path]?.falhou(erro) ?? false

/** O diálogo das conquistas (pedaço próprio, montado pelo shell). */
export const CONQUISTAS = pedaco<{ open: boolean; onClose: () => void }>(() => import('@/ui/shared/achievements/AchievementsDialog'), 'AchievementsDialog')

/** Warm a route chunk (hover/focus on links, idle time on the Home). Sem conexão agora: não tenta. */
export const prefetchRoute = (path: RoutePath) => PEDACOS[path]?.precarregar()

/** Theme per route (Transmissão only for the immersive mode). */
export const themeFor = (path: RoutePath, query: Record<string, string>): 'noite' | 'transmissao' =>
  query.theme === 'transmissao' || query.theme === 'noite' ? (query.theme as 'noite' | 'transmissao') : path === '/imersivo' || (path === '/identidade' && query.modo === 'imersivo') ? 'transmissao' : 'noite'

export { pedaco, ehFalhaDeCarga, importarDeNovo, recolocarEstilosQueFalharam, type Pedaco } from './pedacos'

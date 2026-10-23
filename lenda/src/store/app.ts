/**
 * App store — route, dialogs, settings (persisted in localStorage, read pre-paint by index.html).
 *
 *   const route = useApp((s) => s.route)          // '/carreira'
 *   navigate('/resumo', { query: { id } })
 *   useApp.getState().setSetting('sound', false)
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localSeguro } from './armazem'
import { IDX_KEY, depoisDaVolta, entradaTrocada, marcarEntrada, modalDaEntrada, novoIdx, voltaPendente, voltarNoHistorico } from './historico'

export type RoutePath = '/' | '/identidade' | '/carreira' | '/resumo' | '/ligas' | '/hall' | '/imersivo' | '/kit' | '/creditos' | '/live' | '/desafios' | '/jogador' | '/verificar'
/**
 * Só no site público (VITE_SITE=1, v3.3): #/desafios (As Taças do Rei), #/jogador/<código> (perfil público) e
 * #/verificar?id=<carreira> (verificação por replay, só o admin). Fora do site viram "/" como qualquer rota desconhecida.
 */
export const SITE_ROUTES: readonly RoutePath[] = ['/desafios', '/jogador', '/verificar']
export const BASE_ROUTES: readonly RoutePath[] = ['/', '/identidade', '/carreira', '/resumo', '/ligas', '/hall', '/imersivo', '/kit', '/creditos', '/live']
export const ROUTES: readonly RoutePath[] = import.meta.env.VITE_SITE === '1' ? [...BASE_ROUTES, ...SITE_ROUTES] : BASE_ROUTES

export type DialogId = 'achievements' | 'settings' | 'menu' | null

export interface Settings {
  /** Sound effects on/off. */
  sound: boolean
  /** 0–1 master volume for SFX. */
  volume: number
  /** Skip the reveal / celebration sequences (show the end state immediately). */
  skipAnimations: boolean
  /** null = follow the OS (prefers-reduced-motion); true/false = user override. */
  reducedMotion: boolean | null
  /** Low effects: no backdrop blur / ambient loops (older phones). */
  lowFx: boolean
  /** Engine selection for development: 'auto' (real when available) | 'mock'. */
  engine: 'auto' | 'mock' | 'real'
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  volume: 0.7,
  skipAnimations: false,
  reducedMotion: null,
  lowFx: false,
  engine: 'auto',
}

/** Como a rota de agora chegou: tela nova, voltar/avançar do navegador, ou troca no lugar (replace). */
export type NavKind = 'nova' | 'voltar' | 'avancar' | 'trocar'

export interface RouteState {
  path: RoutePath
  /** Query params inside the hash: #/resumo?id=abc → { id: 'abc' } */
  query: Record<string, string>
}

interface AppStore {
  route: RouteState
  /** Previous path (for back buttons / transitions). */
  prevPath: RoutePath | null
  /** Direction hint for page transitions (1 forward, -1 back). */
  navDir: 1 | -1
  /** Como a rota de agora chegou (o shell guarda e devolve a posição da rolagem no "voltar"). */
  navKind: NavKind
  dialog: DialogId
  /** Active visual theme on <html data-lx-theme> (the shell sets it per route). */
  theme: 'noite' | 'transmissao'
  settings: Settings
  /** OS prefers-reduced-motion (live). */
  osReducedMotion: boolean
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void
  toggleSetting(key: 'sound' | 'skipAnimations' | 'lowFx'): void
  openDialog(d: Exclude<DialogId, null>): void
  closeDialog(): void
  /** internal: router sync */
  _setRoute(r: RouteState, kind?: NavKind): void
}

const ORDER: Record<RoutePath, number> = { '/': 0, '/identidade': 1, '/carreira': 2, '/resumo': 3, '/ligas': 4, '/hall': 5, '/imersivo': 6, '/kit': 7, '/creditos': 8, '/live': 9, '/desafios': 10, '/jogador': 11, '/verificar': 12 }

/** O código de convite que vai no perfil público (#/jogador/<código>): 4 a 16 letras e números, como o do convite. */
export const CODIGO_PERFIL_RE = /^[A-Za-z0-9]{4,16}$/

export function parseHash(hash: string = typeof location !== 'undefined' ? location.hash : '', routes: readonly RoutePath[] = ROUTES): RouteState {
  const raw = hash.replace(/^#/, '') || '/'
  const [p0, q = ''] = raw.split('?')
  const query: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(q)) query[k] = v
  // #/jogador/<código> (perfil público): o código vira query.codigo
  let p = p0
  const perfil = /^\/jogador\/([^/]+)\/?$/.exec(p0)
  if (perfil && routes.includes('/jogador')) {
    p = '/jogador'
    let codigo = perfil[1]
    try {
      codigo = decodeURIComponent(codigo)
    } catch {
      /* fica como veio */
    }
    query.codigo = codigo
  }
  const path = (routes as readonly string[]).includes(p) ? (p as RoutePath) : p === '' ? '/' : ('/' as RoutePath)
  return { path, query }
}

export function buildHash(path: RoutePath, query?: Record<string, string | number | undefined>): string {
  // o perfil público fica no endereço curto, como o link que o jogador compartilha: #/jogador/<código>
  if (path === '/jogador' && query?.codigo != null) {
    const { codigo, ...resto } = query
    const qs = new URLSearchParams(Object.entries(resto).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString()
    return `#/jogador/${encodeURIComponent(String(codigo))}${qs ? `?${qs}` : ''}`
  }
  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString() : ''
  return `#${path}${qs ? `?${qs}` : ''}`
}

const osMq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null

export const useApp = create<AppStore>()(
  persist(
    (set, get) => ({
      route: parseHash(),
      prevPath: null,
      navDir: 1,
      navKind: 'nova',
      dialog: null,
      theme: 'noite',
      settings: DEFAULT_SETTINGS,
      osReducedMotion: !!osMq?.matches,
      setSetting: (key, value) => set((s) => ({ settings: { ...s.settings, [key]: value } })),
      toggleSetting: (key) => set((s) => ({ settings: { ...s.settings, [key]: !s.settings[key] } })),
      openDialog: (d) => set({ dialog: d }),
      closeDialog: () => set({ dialog: null }),
      _setRoute: (r, kind = 'nova') => {
        const cur = get().route
        if (cur.path === r.path && JSON.stringify(cur.query) === JSON.stringify(r.query)) return
        set({ route: r, prevPath: cur.path, navDir: ORDER[r.path] >= ORDER[cur.path] ? 1 : -1, navKind: kind, dialog: null })
      },
    }),
    {
      name: 'lenda:settings',
      version: 1,
      // armazém seguro (./armazem.ts): o createJSONStorage só se protege quando ACESSAR o storage lança — com
      // window.localStorage null (WebView sem DOM storage) ou a cota cheia (setItem lança dentro do setState do
      // roteador) a página ficava preta. O seguro nunca lança: o que não coube fica na memória desta aba.
      storage: createJSONStorage(() => localSeguro),
      partialize: (s) => ({ settings: s.settings }),
      merge: (persisted, current) => ({
        ...current,
        settings: { ...DEFAULT_SETTINGS, ...((persisted as { settings?: Partial<Settings> })?.settings ?? {}) },
      }),
    },
  ),
)

osMq?.addEventListener?.('change', (e) => useApp.setState({ osReducedMotion: e.matches }))

/** Effective reduced-motion flag (user override, else OS). */
export const selectReducedMotion = (s: AppStore) => (s.settings.reducedMotion == null ? s.osReducedMotion : s.settings.reducedMotion)

/**
 * Navigate with the hash router.
 *
 * Com um diálogo aberto no celular a entrada de agora é a dele (mesma URL, ver store/historico.ts):
 *  - ir para outra tela TROCA essa entrada pela tela nova (o diálogo fecha com a rota): o "voltar" de lá
 *    volta para a tela de baixo, e não para uma cópia dela;
 *  - trocar a URL no lugar (replace) tira a entrada do diálogo primeiro e troca a de baixo (o diálogo fecha).
 * Com um history.back() a caminho, espera ele terminar (senão ele desfaria esta navegação).
 */
export function navigate(path: RoutePath, opts: { query?: Record<string, string | number | undefined>; replace?: boolean } = {}) {
  if (voltaPendente()) return depoisDaVolta(() => navigate(path, opts))
  const h = buildHash(path, opts.query)
  // a mesma URL: nada (com um diálogo aberto, ele mesmo tira a entrada dele ao fechar)
  if (location.hash === h) return
  const modal = modalDaEntrada()
  if (modal && opts.replace) {
    voltarNoHistorico({ removendo: modal })
    return depoisDaVolta(() => navigate(path, opts))
  }
  if (modal) {
    const i = novoIdx()
    history.replaceState({ [IDX_KEY]: i }, '', h)
    entradaTrocada(i)
    useApp.getState()._setRoute(parseHash(h), 'nova')
  } else if (opts.replace) {
    history.replaceState(history.state, '', h)
    useApp.getState()._setRoute(parseHash(h), 'trocar')
  } else {
    location.hash = h
  }
}

/** Navegar para um endereço "#/…" (links dentro dos diálogos, ver ui/primitives/Modal.tsx). */
export function navigateHash(hash: string, opts: { replace?: boolean } = {}) {
  const r = parseHash(hash)
  navigate(r.path, { query: r.query, replace: opts.replace })
}

/** Keep <html data-motion / lx-lowfx> in sync with settings. */
export function syncDocumentFlags() {
  const apply = () => {
    const s = useApp.getState()
    const root = document.documentElement
    if (selectReducedMotion(s)) root.setAttribute('data-motion', 'reduced')
    else root.removeAttribute('data-motion')
    root.classList.toggle('lx-lowfx', s.settings.lowFx)
  }
  apply()
  return useApp.subscribe(apply)
}

/** Router bootstrap: listen to hashchange. Returns an unsubscribe fn. */
export function startRouter() {
  // a posição da rolagem é do jogo (o shell guarda por entrada e devolve no "voltar"), não do navegador
  try {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  } catch {
    /* sem histórico */
  }
  const on = () => {
    // in-page anchors (#conteudo) are not routes
    if (location.hash && !location.hash.startsWith('#/')) return
    // numera a entrada (e diz se chegou pelo voltar/avançar do navegador)
    useApp.getState()._setRoute(parseHash(), marcarEntrada())
  }
  window.addEventListener('hashchange', on)
  on()
  return () => window.removeEventListener('hashchange', on)
}

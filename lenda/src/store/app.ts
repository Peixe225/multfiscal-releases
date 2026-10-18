/**
 * App store — route, dialogs, settings (persisted in localStorage, read pre-paint by index.html).
 *
 *   const route = useApp((s) => s.route)          // '/carreira'
 *   navigate('/resumo', { query: { id } })
 *   useApp.getState().setSetting('sound', false)
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

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
  _setRoute(r: RouteState): void
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
      dialog: null,
      theme: 'noite',
      settings: DEFAULT_SETTINGS,
      osReducedMotion: !!osMq?.matches,
      setSetting: (key, value) => set((s) => ({ settings: { ...s.settings, [key]: value } })),
      toggleSetting: (key) => set((s) => ({ settings: { ...s.settings, [key]: !s.settings[key] } })),
      openDialog: (d) => set({ dialog: d }),
      closeDialog: () => set({ dialog: null }),
      _setRoute: (r) => {
        const cur = get().route
        if (cur.path === r.path && JSON.stringify(cur.query) === JSON.stringify(r.query)) return
        set({ route: r, prevPath: cur.path, navDir: ORDER[r.path] >= ORDER[cur.path] ? 1 : -1, dialog: null })
      },
    }),
    {
      name: 'lenda:settings',
      version: 1,
      // sem storage (navegador bloqueando): createJSONStorage engole o erro e o zustand segue só na memória.
      // Devolver undefined daqui fazia o persist chamar getItem/setItem em undefined (página em branco).
      storage: createJSONStorage(() => localStorage),
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

/** Navigate with the hash router. */
export function navigate(path: RoutePath, opts: { query?: Record<string, string | number | undefined>; replace?: boolean } = {}) {
  const h = buildHash(path, opts.query)
  if (location.hash === h) return
  if (opts.replace) {
    history.replaceState(history.state, '', h)
    useApp.getState()._setRoute(parseHash(h))
  } else {
    location.hash = h
  }
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
  const on = () => {
    // in-page anchors (#conteudo) are not routes
    if (location.hash && !location.hash.startsWith('#/')) return
    useApp.getState()._setRoute(parseHash())
  }
  window.addEventListener('hashchange', on)
  on()
  return () => window.removeEventListener('hashchange', on)
}

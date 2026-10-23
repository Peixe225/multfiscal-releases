/**
 * v3.5 · revisão mobile, grupo "base": a medição conta quem abre e sai logo (script embutido + início no main.tsx), a
 * origem das visitas que chegam pelos apps (android-app://, navegador do TikTok/Instagram), o armazém que lê mas não
 * grava, e os polyfills do Safari 15.0–15.3.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appDoNavegador, armazem, dominioDeOrigem, origemResumida, rotaDoEndereco, sementeValida, utmComApp, utmDaVisita, type Evento } from './medicao'
import { clonar, emPosicao, instalarPolyfills, temProprio } from '../polyfills'

const UA = {
  tiktokAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-A155M Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.7339.207 Mobile Safari/537.36 trill_410603 JsSdk/1.0 NetType/4G Channel/googleplay AppName/trill app_version/41.6.3 ByteLocale/pt-BR ByteFullLocale/pt-BR Region/BR AppId/1180 Spark/1.7.8.6-bugfix AppVersion/41.6.3 BytedanceWebview/d8a21c6',
  tiktokIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_41.5.0 JsSdk/2.0 NetType/4G Channel/App Store ByteLocale/pt Region/BR isDarkMode/1 WKWebView/1 RevealType/Dialog BytedanceWebview/d8a21c6 FalconTag/',
  instagramAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-A155M Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.70 Mobile Safari/537.36 Instagram 401.0.0.48.79 Android (34/14; 450dpi; 1080x2340; samsung; SM-A155M; a15; mt6789; pt_BR; 800000000)',
  instagramIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 401.0.0.29.80 (iPhone14,7; iOS 18_5; pt_BR; pt-BR; scale=3.00; 1170x2532; 800000000) NW/3',
  facebook:
    'Mozilla/5.0 (Linux; Android 10; CUBOT X30 Build/QP1A.190711.020; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.70 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.47.109;]',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
}
const semUtm = { source: '', medium: '', campaign: '' }

describe('origem das visitas que chegam pelos apps (v3.5)', () => {
  it('android-app://<pacote>/ vira o nome da rede (o WhatsApp do Android não fica mais "com.whatsapp")', () => {
    expect(dominioDeOrigem('android-app://com.whatsapp/', 'oprojeto.online')).toBe('whatsapp')
    expect(dominioDeOrigem('android-app://com.whatsapp.w4b/', 'oprojeto.online')).toBe('whatsapp')
    expect(dominioDeOrigem('android-app://com.zhiliaoapp.musically/', 'oprojeto.online')).toBe('tiktok')
    expect(dominioDeOrigem('android-app://com.ss.android.ugc.trill/', 'oprojeto.online')).toBe('tiktok')
    expect(dominioDeOrigem('android-app://com.instagram.android/', 'oprojeto.online')).toBe('instagram')
    expect(dominioDeOrigem('android-app://com.facebook.katana/', 'oprojeto.online')).toBe('facebook')
    expect(dominioDeOrigem('android-app://com.facebook.orca/', 'oprojeto.online')).toBe('facebook')
    expect(dominioDeOrigem('android-app://com.google.android.gm/', 'oprojeto.online')).toBe('gmail')
    // app fora da lista: o pacote, como antes
    expect(dominioDeOrigem('android-app://com.exemplo.leitor/', 'oprojeto.online')).toBe('com.exemplo.leitor')
    // nada de nome herdado do Object.prototype
    expect(dominioDeOrigem('android-app://constructor/', 'oprojeto.online')).toBe('constructor')
    // os de sempre seguem iguais
    expect(dominioDeOrigem('https://www.tiktok.com/@lenda', 'oprojeto.online')).toBe('tiktok.com')
    expect(dominioDeOrigem('https://oprojeto.online/lenda/', 'oprojeto.online')).toBe('')
  })

  it('a sessão gravada por uma versão de antes ("com.whatsapp" cru) também resume certo', () => {
    expect(origemResumida({ ref: 'com.whatsapp', utm: semUtm })).toBe('whatsapp')
    expect(origemResumida({ ref: 'com.zhiliaoapp.musically', utm: semUtm })).toBe('tiktok')
    expect(origemResumida({ ref: 'whatsapp', utm: semUtm })).toBe('whatsapp')
  })

  it('o navegador de dentro do app pelo user agent', () => {
    expect(appDoNavegador(UA.tiktokAndroid)).toBe('tiktok')
    expect(appDoNavegador(UA.tiktokIos)).toBe('tiktok')
    expect(appDoNavegador(UA.instagramAndroid)).toBe('instagram')
    expect(appDoNavegador(UA.instagramIos)).toBe('instagram')
    expect(appDoNavegador(UA.facebook)).toBe('facebook')
    expect(appDoNavegador('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0]')).toBe('facebook')
    // a Custom Tab do WhatsApp e o Safari são navegadores comuns
    expect(appDoNavegador(UA.chromeAndroid)).toBe('')
    expect(appDoNavegador(UA.safari)).toBe('')
  })

  it('sem utm e sem referrer, o app vira utm implícito (medium "app"); utm, convite e referrer continuam mandando', () => {
    expect(utmComApp(semUtm, '', UA.tiktokAndroid)).toEqual({ source: 'tiktok', medium: 'app', campaign: '' })
    expect(utmComApp(semUtm, '', UA.instagramIos)).toEqual({ source: 'instagram', medium: 'app', campaign: '' })
    expect(origemResumida({ ref: '', utm: utmComApp(semUtm, '', UA.tiktokIos) })).toBe('tiktok')
    // o link curto (/lenda/tiktok) já traz o utm: fica o dele
    const doLink = { source: 'tiktok', medium: 'social', campaign: 'bio' }
    expect(utmComApp(doLink, '', UA.instagramAndroid)).toBe(doLink)
    // convite de amigo (?c=) vale mais que o app
    const convite = utmDaVisita('?c=ABCD2345')
    expect(utmComApp(convite, '', UA.tiktokAndroid)).toBe(convite)
    // com referrer (l.instagram.com), o referrer decide
    expect(utmComApp(semUtm, 'l.instagram.com', UA.instagramAndroid)).toBe(semUtm)
    // navegador comum sem nada: direto, como antes
    expect(utmComApp(semUtm, '', UA.chromeAndroid)).toBe(semUtm)
  })
})

describe('armazém e endereço (v3.5)', () => {
  it('storage que lê mas não grava (cheio / aba anônima antiga): o valor fica na memória e é lido de volta', () => {
    const dados = new Map<string, string>()
    const cheio = {
      getItem: (k: string) => dados.get(k) ?? null,
      setItem: () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      },
    } as unknown as Storage
    const a = armazem(() => cheio)
    a.set('lenda:sid', 'abc')
    expect(a.get('lenda:sid')).toBe('abc')
    // o que o storage tem de verdade continua valendo
    dados.set('lenda:vid', 'xyz')
    expect(a.get('lenda:vid')).toBe('xyz')
  })

  it('storage que funciona continua mandando: limpo por fora, não volta o valor velho da memória', () => {
    const dados = new Map<string, string>()
    const bom = { getItem: (k: string) => dados.get(k) ?? null, setItem: (k: string, v: string) => void dados.set(k, v) } as unknown as Storage
    const a = armazem(() => bom)
    a.set('lenda:carreiras:pendentes', '["x"]')
    expect(a.get('lenda:carreiras:pendentes')).toBe('["x"]')
    dados.clear()
    expect(a.get('lenda:carreiras:pendentes')).toBeNull()
  })

  it('a tela pelo endereço, no formato do servidor', () => {
    expect(rotaDoEndereco('')).toBe('/')
    expect(rotaDoEndereco('#/')).toBe('/')
    expect(rotaDoEndereco('#/hall')).toBe('/hall')
    expect(rotaDoEndereco('#/resumo?id=career-1')).toBe('/resumo')
    expect(rotaDoEndereco('#/jogador/ABCD2345')).toBe('/jogador')
    expect(rotaDoEndereco('#/QUALQUER%20coisa')).toBe('/')
    expect(rotaDoEndereco('#x')).toBe('/')
  })

  it('semente: só a que tem visitante e sessão de verdade', () => {
    const v = '11111111-1111-4111-8111-111111111111'
    const s = '22222222-2222-4222-8222-222222222222'
    const ctx = { ref: '', utm: semUtm, dev: 'mobile' as const, lang: 'pt-BR', tela: '360x800' }
    expect(sementeValida({ v, s, ctx, em: 1, rota: '/' })).not.toBeNull()
    expect(sementeValida({ v: 'x', s, ctx, em: 1, rota: '/' })).toBeNull()
    expect(sementeValida({ v, s, em: 1, rota: '/' })).toBeNull()
    expect(sementeValida(null)).toBeNull()
    expect(sementeValida('oi')).toBeNull()
  })
})

// ───────────────────────── a medição num navegador de mentira ─────────────────────────

interface Pedido {
  url: string
  corpo: { v: string; s: string; bot: number; ctx: { ref: string; utm: { source: string; medium: string }; dev: string }; ev: Evento[] }
  keepalive: boolean
}

function navegador(o: { ua?: string; referrer?: string; hash?: string; search?: string; storage?: boolean; fetchFalha?: boolean } = {}) {
  const pedidos: Pedido[] = []
  const beacons: Pedido[] = []
  const ouvintes = new Map<string, (() => void)[]>()
  const loja = () => {
    const m = new Map<string, string>()
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
      dados: m,
    }
  }
  const ls = loja()
  const ss = loja()
  const bloqueado = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  }
  const win: Record<string, unknown> = {
    innerWidth: 360,
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    setInterval: (f: () => void, ms: number) => setInterval(f, ms),
    addEventListener: (t: string, f: () => void) => ouvintes.set(t, [...(ouvintes.get(t) ?? []), f]),
  }
  Object.defineProperty(win, 'localStorage', { get: o.storage === false ? bloqueado : () => ls, configurable: true })
  Object.defineProperty(win, 'sessionStorage', { get: o.storage === false ? bloqueado : () => ss, configurable: true })
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', {
    referrer: o.referrer ?? '',
    visibilityState: 'visible',
    baseURI: 'https://oprojeto.online/lenda/',
    addEventListener: (t: string, f: () => void) => ouvintes.set(`doc:${t}`, [...(ouvintes.get(`doc:${t}`) ?? []), f]),
  })
  vi.stubGlobal('location', { hostname: 'oprojeto.online', hash: o.hash ?? '', search: o.search ?? '', href: 'https://oprojeto.online/lenda/' })
  vi.stubGlobal('screen', { width: 360, height: 800 })
  vi.stubGlobal('navigator', {
    userAgent: o.ua ?? UA.chromeAndroid,
    language: 'pt-BR',
    maxTouchPoints: 5,
    webdriver: false,
    sendBeacon: (url: string, b: Blob & { _t?: string }) => {
      beacons.push({ url, corpo: JSON.parse(b._t ?? '{}'), keepalive: true })
      return true
    },
  })
  vi.stubGlobal(
    'Blob',
    class {
      _t: string
      constructor(p: string[]) {
        this._t = p.join('')
      }
    },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string; keepalive?: boolean }) => {
      pedidos.push({ url, corpo: JSON.parse(init.body), keepalive: !!init.keepalive })
      if (o.fetchFalha) throw new TypeError('Failed to fetch')
      return { status: 204 }
    }),
  )
  return { pedidos, beacons, ls, ss, win, disparar: (t: string) => (ouvintes.get(t) ?? []).forEach((f) => f()) }
}

const views = (ps: Pedido[]) => ps.flatMap((p) => p.corpo.ev.filter((e) => e.t === 'view').map((e) => (e.d as { rota: string }).rota))

describe('medição: a visita conta antes de o jogo carregar (v3.5)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('sem o script embutido: o 1º view sai na hora (não espera 1,5 s), e a 2ª chamada só troca o estado', async () => {
    const nav = navegador({ hash: '#/hall' })
    const m = await import('./medicao')
    m.iniciarMedicao({ estadoJogo: () => ({ jogando: false, modo: null }), telaAtual: () => '/hall' })
    await vi.advanceTimersByTimeAsync(0)
    expect(nav.pedidos).toHaveLength(1)
    expect(views(nav.pedidos)).toEqual(['/hall'])
    expect(nav.pedidos[0].keepalive).toBe(true)
    // o vigias.ts (SiteRoot) chama de novo com o estado de verdade e manda o view da mesma tela: não duplica
    m.iniciarMedicao({ estadoJogo: () => ({ jogando: true, modo: 'classico' }), telaAtual: () => '/carreira' })
    m.track('view', null, { rota: '/hall' })
    await vi.advanceTimersByTimeAsync(1600)
    const hb = nav.pedidos.flatMap((p) => p.corpo.ev).filter((e) => e.t === 'hb')
    expect(hb.at(-1)).toMatchObject({ p: 1, m: 'classico' })
    expect(views(nav.pedidos)).toEqual(['/hall'])
    // tela nova vai normalmente; voltar para a de antes também
    m.track('view', null, { rota: '/carreira' })
    m.track('view', null, { rota: '/hall' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(views(nav.pedidos)).toEqual(['/hall', '/carreira', '/hall'])
    // uma sessão só, um visitante só
    expect(new Set(nav.pedidos.map((p) => p.corpo.s)).size).toBe(1)
    expect(new Set(nav.pedidos.map((p) => p.corpo.v)).size).toBe(1)
  })

  it('com o script embutido (medicaoCedo): o view vai no carregar do HTML e o bundle continua a mesma sessão sem repetir', async () => {
    const nav = navegador({ ua: UA.tiktokAndroid })
    await import('./medicaoCedo')
    const sem = (globalThis as unknown as { window: { __lendaMedicao?: { s: string; v: string; p: Promise<boolean> } } }).window.__lendaMedicao
    expect(sem).toBeTruthy()
    expect(nav.pedidos).toHaveLength(1)
    expect(nav.pedidos[0].url).toBe('https://oprojeto.online/lenda/api/e.php')
    expect(nav.pedidos[0].keepalive).toBe(true)
    expect(views(nav.pedidos)).toEqual(['/'])
    // o TikTok não manda referrer: a origem vai como utm implícito
    expect(nav.pedidos[0].corpo.ctx.utm).toMatchObject({ source: 'tiktok', medium: 'app' })
    expect(nav.pedidos[0].corpo.ctx.dev).toBe('mobile')
    expect(nav.pedidos[0].corpo.bot).toBe(0)
    await expect(sem!.p).resolves.toBe(true)
    // o bundle chega (main.tsx): mesma sessão, nenhum view a mais
    const m = await import('./medicao')
    m.iniciarMedicao({ estadoJogo: () => ({ jogando: false, modo: null }), telaAtual: () => '/' })
    m.track('view', null, { rota: '/' })
    await vi.advanceTimersByTimeAsync(11_000)
    expect(views(nav.pedidos)).toEqual(['/'])
    expect(new Set(nav.pedidos.map((p) => p.corpo.s))).toEqual(new Set([sem!.s]))
    expect(new Set(nav.pedidos.map((p) => p.corpo.v))).toEqual(new Set([sem!.v]))
    expect(nav.pedidos.length).toBeGreaterThan(1) // o batimento seguiu
  })

  it('o envio do script embutido não chegou (rede): o view vai de novo pela fila do bundle', async () => {
    const nav = navegador({ fetchFalha: true, hash: '#/desafios' })
    await import('./medicaoCedo')
    expect(nav.pedidos).toHaveLength(1)
    const m = await import('./medicao')
    m.iniciarMedicao({ estadoJogo: () => ({ jogando: false, modo: null }), telaAtual: () => '/desafios' })
    await vi.advanceTimersByTimeAsync(0)
    expect(views(nav.pedidos)).toEqual(['/desafios', '/desafios'])
  })

  it('storage bloqueado: o script embutido e o bundle ficam no mesmo visitante e na mesma sessão (pela semente)', async () => {
    const nav = navegador({ storage: false })
    await import('./medicaoCedo')
    const m = await import('./medicao')
    m.iniciarMedicao({ estadoJogo: () => ({ jogando: false, modo: null }), telaAtual: () => '/' })
    await vi.advanceTimersByTimeAsync(2000)
    expect(nav.pedidos.length).toBeGreaterThan(1)
    expect(new Set(nav.pedidos.map((p) => p.corpo.s)).size).toBe(1)
    expect(new Set(nav.pedidos.map((p) => p.corpo.v)).size).toBe(1)
    expect(views(nav.pedidos)).toEqual(['/'])
  })

  it('o WhatsApp do Android (Custom Tab, referrer android-app://com.whatsapp/) chega como whatsapp', async () => {
    const nav = navegador({ referrer: 'android-app://com.whatsapp/' })
    await import('./medicaoCedo')
    expect(nav.pedidos[0].corpo.ctx.ref).toBe('whatsapp')
    expect(nav.pedidos[0].corpo.ctx.utm.source).toBe('')
  })

  it('fechar a aba manda o que está na fila por sendBeacon', async () => {
    const nav = navegador()
    const m = await import('./medicao')
    m.iniciarMedicao({ estadoJogo: () => ({ jogando: false, modo: null }), telaAtual: () => '/' })
    await vi.advanceTimersByTimeAsync(0)
    m.track('gate_ver', null, { partidas: 5 })
    nav.disparar('pagehide')
    expect(nav.beacons.flatMap((b) => b.corpo.ev.map((e) => e.t))).toContain('gate_ver')
  })
})

// ───────────────────────── polyfills (Safari 15.0–15.3) ─────────────────────────

describe('polyfills do Safari 15.0–15.3 (v3.5)', () => {
  it('Array/String.prototype.at', () => {
    const a = [1, 2, 3]
    expect(emPosicao.call(a, -1)).toBe(3)
    expect(emPosicao.call(a, 0)).toBe(1)
    expect(emPosicao.call(a, 3)).toBeUndefined()
    expect(emPosicao.call(a, -4)).toBeUndefined()
    expect(emPosicao.call(a, 1.7)).toBe(2)
    expect(emPosicao.call([], -1)).toBeUndefined()
    expect(emPosicao.call('LENDA', -1)).toBe('A')
    expect(emPosicao.call(new Uint8Array([7, 8]), -2)).toBe(7)
  })

  it('Object.hasOwn', () => {
    expect(temProprio({ a: 1 }, 'a')).toBe(true)
    expect(temProprio({ a: 1 }, 'toString')).toBe(false)
    expect(temProprio(Object.create(null), 'x')).toBe(false)
    expect(() => temProprio(null, 'a')).toThrow(TypeError)
  })

  it('structuredClone: o mesmo resultado do de verdade para o estado da carreira', () => {
    const d = new Date(Date.UTC(2026, 9, 23))
    const comum = { id: 'career-1', seasons: [{ age: 16, club: 'fla', stats: { g: 3 } }], d }
    const origem = {
      n: 1,
      s: 'ã',
      b: true,
      nada: null,
      indef: undefined,
      lista: [1, [2, 3], { x: 4 }],
      mapa: new Map<string, unknown>([['a', comum]]),
      conj: new Set([1, 'dois']),
      d,
      re: /ab+c/gi,
      bytes: new Uint8Array([1, 2, 3]),
      comum,
      outra: comum,
    }
    const c = clonar(origem)
    expect(c).toEqual(structuredClone(origem))
    expect(c).not.toBe(origem)
    expect(c.comum).not.toBe(origem.comum)
    // referência repetida continua uma só (como no de verdade)
    expect(c.outra).toBe(c.comum)
    expect(c.mapa.get('a')).toBe(c.comum)
    expect(c.d).toBeInstanceOf(Date)
    expect(c.d).not.toBe(d)
    expect(c.bytes).toBeInstanceOf(Uint8Array)
    expect([...c.bytes]).toEqual([1, 2, 3])
    // mexer no clone não mexe no original
    c.comum.seasons[0].age = 40
    expect(origem.comum.seasons[0].age).toBe(16)
    // ciclo
    const ciclo: { eu?: unknown; n: number } = { n: 1 }
    ciclo.eu = ciclo
    const cc = clonar(ciclo)
    expect(cc.eu).toBe(cc)
    // função não clona (DataCloneError, como no de verdade)
    expect(() => clonar({ f: () => 1 })).toThrow()
    // objeto de classe vira objeto simples
    class P {
      x = 1
      dobro() {
        return this.x * 2
      }
    }
    const p = clonar(new P())
    expect(Object.getPrototypeOf(p)).toBe(Object.prototype)
    expect(p).toEqual({ x: 1 })
  })

  it('instala só o que falta (um navegador sem os três ganha os três; o de hoje não ganha nada)', () => {
    expect(instalarPolyfills()).toEqual([])
    const velho = {
      Array: function () {} as unknown as ArrayConstructor,
      String: function () {} as unknown as StringConstructor,
      Object: { prototype: Object.prototype } as unknown as ObjectConstructor,
    } as unknown as typeof globalThis
    ;(velho.Array as unknown as { prototype: object }).prototype = {}
    ;(velho.String as unknown as { prototype: object }).prototype = {}
    const postos = instalarPolyfills(velho)
    expect(postos).toEqual(['Array.prototype.at', 'String.prototype.at', 'Object.hasOwn', 'structuredClone'])
    expect(typeof (velho as unknown as { structuredClone: unknown }).structuredClone).toBe('function')
    expect((velho.Object as unknown as { hasOwn: (o: object, k: string) => boolean }).hasOwn({ a: 1 }, 'a')).toBe(true)
  })
})

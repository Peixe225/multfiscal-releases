/**
 * v3.5 · revisão mobile da carreira: a lógica das correções (o visual é conferido no Playwright,
 * servidor/teste/mobile/carreira-*.mjs).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHUNK_FALHOU, ehFalhaDePedaco, enderecoDoErro, importarDeNovo, recolocarEstilosQueFalharam } from '@/ui/classic/cockpit/chunks'
import { tournamentMarkers } from '@/ui/classic/cockpit/model'
import { isInAppBrowser, yearRanges } from '@/ui/classic/summary/model'
import { passoValido } from '@/ui/shared/identity/prefs'
import { ateDoisQuadros } from '@/store/career'
import type { Competition } from '@/engine/types'

describe('yearRanges (anos dos prêmios no resumo)', () => {
  it('3 ou mais anos seguidos viram faixa; o resto fica solto', () => {
    expect(yearRanges([2035, 2036, 2037, 2038, 2041, 2043, 2044])).toBe('2035–2038 · 2041 · 2043 · 2044')
    expect(yearRanges([2040])).toBe('2040')
    expect(yearRanges([])).toBe('')
  })
  it('ordena e tira repetidos', () => {
    expect(yearRanges([2039, 2035, 2037, 2036, 2035])).toBe('2035–2037 · 2039')
  })
  it('a carreira inteira de Bola de Ouro cabe numa faixa só', () => {
    expect(yearRanges(Array.from({ length: 11 }, (_, i) => 2035 + i))).toBe('2035–2045')
  })
})

describe('isInAppBrowser (Baixar no navegador de app)', () => {
  const UA = {
    tiktokAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.107 Mobile Safari/537.36 trill_370104 JsSdk/1.0 NetType/4G Channel/googleplay AppName/trill app_version/37.1.4 BytedanceWebview/d8a21c6',
    tiktokIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_37.1.0 JsSdk/2.0 NetType/4G Channel/App Store ByteLocale/pt Region/BR isDarkMode/1 WKWebView/1 RevealType/Dialog BytedanceWebview/d8a21c6',
    instaAndroid: 'Mozilla/5.0 (Linux; Android 15; Pixel 7 Build/AP4A.250205.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/133.0.6943.137 Mobile Safari/537.36 Instagram 370.1.0.43.96 Android',
    instaIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 370.0.0.24.108 (iPhone15,2; iOS 18_6; pt_BR; pt; scale=3.00; 1179x2556; 705050118)',
    whatsAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.107 Mobile Safari/537.36 WhatsApp/2.24.21.77',
    chromeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    samsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  }
  it('TikTok, Instagram e o WebView do Android (WhatsApp) são navegador de app', () => {
    for (const k of ['tiktokAndroid', 'tiktokIos', 'instaAndroid', 'instaIos', 'whatsAndroid'] as const) expect(isInAppBrowser(UA[k]), k).toBe(true)
  })
  it('Chrome, Safari e Samsung Internet não são', () => {
    for (const k of ['chromeAndroid', 'safariIos', 'samsung'] as const) expect(isInAppBrowser(UA[k]), k).toBe(false)
  })
})

describe('passoValido (assistente da identidade no histórico)', () => {
  const vazio = { nationality: null, surname: '', number: '10' }
  const pais = { nationality: 'BRA', surname: '', number: '10' }
  const tudo = { nationality: 'BRA', surname: 'Silva', number: '9' }
  it('volta ao passo do histórico quando o rascunho deixa', () => {
    expect(passoValido(2, tudo)).toBe(2)
    expect(passoValido(1, pais)).toBe(1)
    expect(passoValido(0, tudo)).toBe(0)
  })
  it('sem país não passa do passo 1; sem nome/número não chega ao 3', () => {
    expect(passoValido(2, vazio)).toBe(0)
    expect(passoValido(1, vazio)).toBe(0)
    expect(passoValido(2, pais)).toBe(1)
    expect(passoValido(2, { ...tudo, number: '0' })).toBe(1)
    expect(passoValido(2, { ...tudo, surname: '   ' })).toBe(1)
  })
  it('valor estranho no histórico vale o passo 1', () => {
    expect(passoValido(null, tudo)).toBe(0)
    expect(passoValido(undefined, tudo)).toBe(0)
    expect(passoValido(7, tudo)).toBe(0)
  })
})

describe('marcas de torneio da tabela (celular)', () => {
  const wc = { id: 'world-cup', name: 'Copa do Mundo da FIFA', kind: 'world_cup', schedule: { firstYear: 2026, every: 4 } } as unknown as Competition
  const euro = { id: 'euro', name: 'Eurocopa', kind: 'national_continental', confed: 'UEFA', schedule: { firstYear: 2028, every: 4 } } as unknown as Competition
  it('Copa do Mundo tem rótulo curto ("Copa 2030")', () => {
    const [m] = tournamentMarkers(2029, [wc], 'CONMEBOL' as never)
    expect(m.label).toBe('Copa do Mundo 2030')
    expect(m.short).toBe('Copa 2030')
  })
  it('os outros torneios ficam iguais', () => {
    const [m] = tournamentMarkers(2027, [euro], 'UEFA' as never)
    expect(m.short).toBe(m.label)
  })
})

describe('pedaços sob demanda da carreira (sem internet)', () => {
  afterEach(() => vi.unstubAllGlobals())
  const origem = 'https://oprojeto.online'
  it('reconhece a falha de rede dos navegadores (Chrome, Firefox, Safari e o CSS do Vite)', () => {
    for (const m of [
      'Failed to fetch dynamically imported module: https://oprojeto.online/lenda/assets/AwardsTab-x1.js',
      'error loading dynamically imported module: https://oprojeto.online/lenda/assets/SeasonTab-x1.js',
      'Importing a module script failed.',
      'Unable to preload CSS for /lenda/assets/tabs-x1.css',
    ])
      expect(ehFalhaDePedaco(new Error(m)), m).toBe(true)
    expect(ehFalhaDePedaco(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false)
    expect(CHUNK_FALHOU.test('qualquer coisa')).toBe(false)
  })
  it('tira da mensagem o endereço do .js do próprio site', () => {
    expect(enderecoDoErro(new Error('Failed to fetch dynamically imported module: https://oprojeto.online/lenda/assets/AwardsTab-x1.js'), origem)).toBe('https://oprojeto.online/lenda/assets/AwardsTab-x1.js')
    expect(enderecoDoErro(new Error('Failed to fetch dynamically imported module: https://cdn.outro.com/a.js'), origem)).toBeNull()
    expect(enderecoDoErro(new Error('Importing a module script failed.'), origem)).toBeNull()
  })
  it('importarDeNovo: repete o import de antes (a rede voltou)', async () => {
    let n = 0
    const carregar = vi.fn(async () => {
      n++
      if (n === 1) throw new Error('Failed to fetch dynamically imported module: x')
      return { default: 'ok' }
    })
    await expect(carregar()).rejects.toThrow()
    const doc = { querySelectorAll: () => [] } as unknown as Document
    vi.stubGlobal('document', doc)
    await expect(importarDeNovo(carregar)).resolves.toEqual({ default: 'ok' })
    expect(carregar).toHaveBeenCalledTimes(2)
  })
  it('recoloca a folha de estilo que não carregou (o Vite não tenta de novo sozinho)', async () => {
    const eventos: Record<string, () => void> = {}
    const novo = { dataset: {} as Record<string, string>, addEventListener: (t: string, f: () => void) => (eventos[t] = f), remove: vi.fn() }
    const velho = { sheet: null, href: '/lenda/assets/tabs-x1.css', dataset: {} as Record<string, string>, cloneNode: () => novo, after: vi.fn(() => queueMicrotask(() => eventos.load())), remove: vi.fn() }
    const ok = { sheet: {}, href: '/lenda/assets/index.css', dataset: {} }
    const doc = { querySelectorAll: () => [velho, ok] } as unknown as Document
    await recolocarEstilosQueFalharam(doc)
    expect(velho.after).toHaveBeenCalledWith(novo)
    expect(velho.remove).toHaveBeenCalled()
    expect(novo.dataset.lendaDeNovo).toBeUndefined()
  })
  it('sem rede, a folha de estilo falha de novo e a promessa rejeita (a aba mostra o aviso)', async () => {
    const eventos: Record<string, () => void> = {}
    const novo = { dataset: {} as Record<string, string>, addEventListener: (t: string, f: () => void) => (eventos[t] = f), remove: vi.fn() }
    const velho = { sheet: null, href: '/lenda/assets/tabs-x1.css', dataset: {} as Record<string, string>, cloneNode: () => novo, after: vi.fn(() => queueMicrotask(() => eventos.error())), remove: vi.fn() }
    const doc = { querySelectorAll: () => [velho] } as unknown as Document
    await expect(recolocarEstilosQueFalharam(doc)).rejects.toThrow(/Unable to preload CSS/)
    expect(novo.remove).toHaveBeenCalled()
    expect(velho.remove).not.toHaveBeenCalled()
  })
})

describe('ateDoisQuadros (o toque pinta antes da simulação)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
  it('espera dois quadros e depois uma tarefa', async () => {
    vi.useFakeTimers()
    const quadros: (() => void)[] = []
    vi.stubGlobal('requestAnimationFrame', (f: () => void) => quadros.push(f))
    vi.stubGlobal('document', { hidden: false })
    let feito = false
    const p = ateDoisQuadros().then(() => (feito = true))
    expect(quadros.length).toBe(1)
    quadros.shift()!()
    expect(quadros.length).toBe(1) // o 2º quadro
    quadros.shift()!()
    await vi.advanceTimersByTimeAsync(0)
    await p
    expect(feito).toBe(true)
  })
  it('aba escondida ou quadro travado: segue mesmo assim', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', () => 0) // nunca chama
    vi.stubGlobal('document', { hidden: false })
    let feito = false
    void ateDoisQuadros(250).then(() => (feito = true))
    await vi.advanceTimersByTimeAsync(249)
    expect(feito).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(feito).toBe(true)
  })
})

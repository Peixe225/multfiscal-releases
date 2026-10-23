/**
 * v3.5 · revisão mobile, grupo "hall": a lógica que dá para testar sem navegador.
 *  - pedaços com nova tentativa (sem rede o arquivo nem é pedido; a falha de um pedaço não troca outro);
 *  - diálogos no histórico (o "voltar" do Android fecha o de cima; Menu → Conquistas divide a entrada; navegar de
 *    dentro de um diálogo troca a entrada dele; o voltar que muda o endereço não chama o onClose);
 *  - número das entradas (voltar × avançar, para devolver a rolagem);
 *  - armazém seguro (localStorage null ou cheio não derruba a página);
 *  - onde o aviso cabe e onde a lista de clubes abre; recarga no máximo uma vez por minuto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ───────────────────────── um navegador de mentira: history + location + window ─────────────────────────

interface Entrada {
  url: string
  state: unknown
}
function navegadorFalso(inicio = 'http://x.test/lenda/#/') {
  const entradas: Entrada[] = [{ url: inicio, state: null }]
  let i = 0
  const ouvintes = new Map<string, Set<(e: unknown) => void>>()
  const disparar = (tipo: string) => ouvintes.get(tipo)?.forEach((f) => f({ type: tipo }))
  const hashDe = (u: string) => (u.includes('#') ? u.slice(u.indexOf('#')) : '')
  const location = {
    get href() {
      return entradas[i].url
    },
    get hash() {
      return hashDe(entradas[i].url)
    },
    set hash(h: string) {
      const base = entradas[i].url.split('#')[0]
      entradas.splice(i + 1)
      entradas.push({ url: `${base}${h.startsWith('#') ? h : `#${h}`}`, state: null })
      i++
      setTimeout(() => {
        disparar('popstate')
        disparar('hashchange')
      }, 0)
    },
    get origin() {
      return new URL(entradas[i].url).origin
    },
  }
  const resolver = (url: string | undefined) => (url ? new URL(url, entradas[i].url).href : entradas[i].url)
  const history = {
    get state() {
      return entradas[i].state
    },
    get length() {
      return entradas.length
    },
    pushState(state: unknown, _t: string, url?: string) {
      entradas.splice(i + 1)
      entradas.push({ url: resolver(url), state: structuredClone(state) })
      i++
    },
    replaceState(state: unknown, _t: string, url?: string) {
      entradas[i] = { url: resolver(url), state: structuredClone(state) }
    },
    go(n: number) {
      // assíncrono, como no navegador
      setTimeout(() => {
        const j = Math.max(0, Math.min(entradas.length - 1, i + n))
        if (j === i) return
        const antes = hashDe(entradas[i].url)
        i = j
        disparar('popstate')
        if (hashDe(entradas[i].url) !== antes) disparar('hashchange')
      }, 0)
    },
    back() {
      this.go(-1)
    },
    scrollRestoration: 'auto',
  }
  const window = {
    addEventListener(tipo: string, f: (e: unknown) => void) {
      if (!ouvintes.has(tipo)) ouvintes.set(tipo, new Set())
      ouvintes.get(tipo)!.add(f)
    },
    removeEventListener(tipo: string, f: (e: unknown) => void) {
      ouvintes.get(tipo)?.delete(f)
    },
  }
  return { location, history, window, entradas, indice: () => i }
}

const esperar = (ms = 5) => new Promise((r) => setTimeout(r, ms))

let nav: ReturnType<typeof navegadorFalso>
beforeEach(() => {
  vi.resetModules()
  nav = navegadorFalso()
  vi.stubGlobal('location', nav.location)
  vi.stubGlobal('history', nav.history)
  vi.stubGlobal('window', nav.window)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

// ───────────────────────── pedaços ─────────────────────────

describe('pedaços com nova tentativa', () => {
  it('sem rede o arquivo nem é pedido (o navegador guardaria a falha); com a rede de volta, o lazy novo busca', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const { pedaco, ehFalhaDeCarga } = await import('./pedacos')
    const carregar = vi.fn(async () => ({ default: () => null }))
    const p = pedaco(carregar, 'Tela')
    const primeiro = p.atual
    // o lazy guarda a função de carga; chamá-la como o React faria
    const init = (primeiro as unknown as { _payload: { _result: () => Promise<unknown> } })._payload._result
    const erro = await init().catch((e: unknown) => e)
    expect(carregar).not.toHaveBeenCalled()
    expect(ehFalhaDeCarga(erro)).toBe(true)
    expect(p.falhou(erro)).toBe(true)
    expect(p.atual).not.toBe(primeiro)
    vi.stubGlobal('navigator', { onLine: true })
    const init2 = (p.atual as unknown as { _payload: { _result: () => Promise<unknown> } })._payload._result
    await init2()
    expect(carregar).toHaveBeenCalledTimes(1)
  })

  it('uma falha que não é deste pedaço (um lazy de dentro da tela) não troca o lazy', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const { pedaco } = await import('./pedacos')
    const p = pedaco(async () => ({ default: () => null }), 'Tela')
    const antes = p.atual
    expect(p.falhou(new Error('Failed to fetch dynamically imported module: http://x.test/lenda/assets/Outra.js'))).toBe(false)
    expect(p.atual).toBe(antes)
  })

  it('reconhece as mensagens de "o arquivo não veio" do Chrome, Firefox, Safari e do Vite', async () => {
    const { ehFalhaDeCarga, enderecoDaFalha } = await import('./pedacos')
    for (const m of [
      'Failed to fetch dynamically imported module: http://x.test/lenda/assets/HallScreen-abc.js',
      'error loading dynamically imported module: http://x.test/lenda/assets/a.js',
      'Importing a module script failed.',
      'Unable to preload CSS for http://x.test/lenda/assets/hall.css',
    ])
      expect(ehFalhaDeCarga(new Error(m))).toBe(true)
    expect(ehFalhaDeCarga(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false)
    expect(enderecoDaFalha(new Error('Failed to fetch dynamically imported module: http://x.test/lenda/assets/HallScreen-abc.js'), 'http://x.test')).toBe('http://x.test/lenda/assets/HallScreen-abc.js')
    expect(enderecoDaFalha(new Error('Failed to fetch dynamically imported module: https://outro.site/a.js'), 'http://x.test')).toBeNull()
  })
})

describe('recarregar a página no máximo uma vez por minuto', () => {
  it('a segunda falha em menos de um minuto pede o botão "Recarregar"', async () => {
    const { podeRecarregarAgora } = await import('./ErrorBoundary')
    const mem = new Map<string, string>()
    const ss = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
    expect(podeRecarregarAgora(1_000_000, ss)).toBe(true)
    expect(podeRecarregarAgora(1_030_000, ss)).toBe(false)
    expect(podeRecarregarAgora(1_070_000, ss)).toBe(true)
    expect(podeRecarregarAgora(1_000_000, null)).toBe(false)
  })
})

// ───────────────────────── histórico ─────────────────────────

describe('diálogos no histórico (voltar do Android)', () => {
  it('abrir põe uma entrada com a mesma URL; o voltar fecha o diálogo e fica na tela', async () => {
    const { abrirNoHistorico } = await import('@/ui/primitives/modalHistorico')
    const fechar = vi.fn()
    const soltar = abrirNoHistorico({ fechar })
    expect(nav.history.length).toBe(2)
    expect(nav.location.hash).toBe('#/')
    nav.history.back()
    await esperar()
    expect(fechar).toHaveBeenCalledTimes(1)
    soltar() // o diálogo fechou: a entrada já saiu, nada de voltar de novo
    await esperar()
    expect(nav.indice()).toBe(0)
  })

  it('fechar pelo X tira a entrada (o próximo voltar sai da tela, sem "voltar morto")', async () => {
    const { abrirNoHistorico } = await import('@/ui/primitives/modalHistorico')
    const soltar = abrirNoHistorico({ fechar: () => {} })
    expect(nav.indice()).toBe(1)
    soltar()
    await esperar()
    expect(nav.indice()).toBe(0)
  })

  it('Menu → Conquistas no mesmo instante: o novo fica com a entrada do que fechou (voltar fecha as conquistas)', async () => {
    const { abrirNoHistorico } = await import('@/ui/primitives/modalHistorico')
    const fecharMenu = vi.fn()
    const soltarMenu = abrirNoHistorico({ fechar: fecharMenu })
    soltarMenu()
    const fecharConquistas = vi.fn()
    abrirNoHistorico({ fechar: fecharConquistas })
    await esperar()
    expect(nav.history.length).toBe(2)
    expect(nav.indice()).toBe(1)
    nav.history.back()
    await esperar()
    expect(fecharConquistas).toHaveBeenCalledTimes(1)
    expect(fecharMenu).not.toHaveBeenCalled()
  })

  it('diálogos empilhados: um voltar fecha só o de cima', async () => {
    const { abrirNoHistorico } = await import('@/ui/primitives/modalHistorico')
    const a = vi.fn()
    const b = vi.fn()
    abrirNoHistorico({ fechar: a })
    abrirNoHistorico({ fechar: b })
    nav.history.back()
    await esperar()
    expect(b).toHaveBeenCalledTimes(1)
    expect(a).not.toHaveBeenCalled()
  })

  it('escolha obrigatória: o voltar não fecha (a entrada volta)', async () => {
    const { abrirNoHistorico } = await import('@/ui/primitives/modalHistorico')
    const fechar = vi.fn()
    abrirNoHistorico({ fechar, dispensavel: () => false })
    nav.history.back()
    await esperar()
    expect(fechar).not.toHaveBeenCalled()
    expect(nav.indice()).toBe(1)
  })

  it('o voltar que muda o endereço é navegação: não chama o onClose (ele navegaria por cima)', async () => {
    const { abrirNoHistorico } = await import('@/ui/primitives/modalHistorico')
    const fechar = vi.fn()
    abrirNoHistorico({ fechar })
    nav.location.hash = '#/creditos'
    await esperar()
    expect(fechar).not.toHaveBeenCalled()
  })

  it('navegar de dentro de um diálogo troca a entrada dele pela tela nova (voltar de lá volta à tela de baixo)', async () => {
    const { abrirNoHistorico } = await import('@/ui/primitives/modalHistorico')
    const { navigate, useApp } = await import('@/store/app')
    const soltar = abrirNoHistorico({ fechar: () => {} })
    navigate('/hall')
    soltar()
    await esperar()
    expect(nav.history.length).toBe(2)
    expect(nav.location.hash).toBe('#/hall')
    expect(useApp.getState().route.path).toBe('/hall')
    expect((nav.history.state as Record<string, unknown>)?.lxModal).toBeUndefined()
  })

  it('uma navegação feita com um history.back() a caminho espera ele terminar (não é desfeita)', async () => {
    const { voltarNoHistorico, voltaPendente } = await import('@/store/historico')
    const { navigate } = await import('@/store/app')
    nav.history.pushState({ lxModal: 'm1' }, '')
    voltarNoHistorico({ removendo: 'm1' })
    expect(voltaPendente()).toBe(true)
    navigate('/hall')
    expect(nav.location.hash).toBe('#/')
    await esperar(20)
    // a volta tirou a entrada do diálogo e só então a tela nova entrou (por cima da de baixo)
    expect(nav.location.hash).toBe('#/hall')
    expect(nav.entradas.map((e) => e.url.split('#')[1])).toEqual(['/', '/hall'])
  })
})

describe('número das entradas (voltar devolve a rolagem)', () => {
  it('entrada nova ganha número; voltar e avançar são reconhecidos', async () => {
    const { marcarEntrada } = await import('@/store/historico')
    expect(marcarEntrada()).toBe('nova')
    nav.location.hash = '#/hall'
    await esperar()
    expect(marcarEntrada()).toBe('nova')
    nav.history.back()
    await esperar()
    expect(marcarEntrada()).toBe('voltar')
    nav.history.go(1)
    await esperar()
    expect(marcarEntrada()).toBe('avancar')
  })
})

// ───────────────────────── armazém seguro ─────────────────────────

describe('armazém seguro (localStorage null ou cheio)', () => {
  it('com o storage null, guarda na memória e nunca lança', async () => {
    const { armazemSeguro } = await import('@/store/armazem')
    const a = armazemSeguro(() => null)
    expect(() => a.setItem('k', 'v')).not.toThrow()
    expect(a.getItem('k')).toBe('v')
    a.removeItem('k')
    expect(a.getItem('k')).toBeNull()
  })

  it('com a cota cheia, o valor novo fica na memória (e não o velho do storage)', async () => {
    const { armazemSeguro } = await import('@/store/armazem')
    const dados = new Map<string, string>([['k', 'velho']])
    const cheio = {
      getItem: (k: string) => dados.get(k) ?? null,
      setItem: () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      },
      removeItem: (k: string) => void dados.delete(k),
    } as unknown as Storage
    const a = armazemSeguro(() => cheio)
    expect(() => a.setItem('k', 'novo')).not.toThrow()
    expect(a.getItem('k')).toBe('novo')
  })

  it('acessar o storage lançando (bloqueado) também cai na memória', async () => {
    const { armazemSeguro } = await import('@/store/armazem')
    const a = armazemSeguro(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    a.setItem('x', '1')
    expect(a.getItem('x')).toBe('1')
  })
})

// ───────────────────────── avisos e lista de clubes ─────────────────────────

describe('onde o aviso (toast) cabe no celular', () => {
  it('sem diálogo: o lugar de sempre; diálogo baixo: acima dele; diálogo alto: abaixo do cabeçalho dele', async () => {
    const { topoLivre } = await import('@/ui/primitives/Toast')
    expect(topoLivre(64, 56, 800, null)).toBeNull()
    expect(topoLivre(64, 56, 800, { top: 400, cabecalho: 460 })).toBeNull()
    expect(topoLivre(64, 56, 800, { top: 70, cabecalho: 140 })).toBe(146)
    // nunca sai da janela
    expect(topoLivre(64, 56, 300, { top: 70, cabecalho: 290 })).toBe(236)
  })
})

describe('lista da busca de clube com o teclado aberto', () => {
  it('cabe no que sobra da janela visível; sem espaço embaixo, abre para cima', async () => {
    const { lugarDaLista } = await import('@/ui/shared/hall/Comunidade')
    // campo no topo, teclado aberto (janela de 464): a lista cabe embaixo
    expect(lugarDaLista({ top: 11, bottom: 55 }, { height: 464, offsetTop: 0 }, 800)).toEqual({ max: 320, acima: false })
    // campo perto do fim da janela visível: abre para cima
    expect(lugarDaLista({ top: 378, bottom: 422 }, { height: 464, offsetTop: 0 }, 800)).toEqual({ max: 320, acima: true })
    // pouco espaço embaixo, menos ainda em cima: fica embaixo, com o que sobra
    expect(lugarDaLista({ top: 60, bottom: 104 }, { height: 200, offsetTop: 0 }, 800)).toEqual({ max: 82, acima: false })
    // deitado com o teclado (janela de 226): abre para o lado com mais espaço, do tamanho que cabe
    expect(lugarDaLista({ top: 92, bottom: 136 }, { height: 226, offsetTop: 0 }, 390)).toEqual({ max: 78, acima: true })
    // nunca menos que uma opção
    expect(lugarDaLista({ top: 30, bottom: 74 }, { height: 100, offsetTop: 0 }, 390).max).toBe(48)
  })
})

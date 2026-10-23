/**
 * Site v3.5 — revisão mobile (grupo "site"): cada correção com o caso que falhava antes.
 *   · o código de 6 dígitos colado com espaço ou com texto (o maxLength cortava antes da limpeza);
 *   · "Sem conexão" só para falha de rede; erro de JS ao desenhar um diálogo vira "Algo deu errado" + evento "erro";
 *   · as pré-cargas da conta esperam os dados, a tela pintar e o navegador sossegar (e nada com "economia de dados");
 *   · a rota mudou com um diálogo do site aberto: ele fecha (o convite obrigatório fica);
 *   · o aviso "N emblemas novos" não sai por cima de #/desafios;
 *   · a abertura do jogo não puxa mais o componente do emblema (e as regras de cor/ícone continuam as mesmas dele);
 *   · rolar só o corpo do diálogo (a conta da posição do campo dentro dele).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useApp } from '@/store/app'
import { useToasts } from '@/ui/primitives'
import { corDoEmblema as corDoComponente, iconeDoEmblema as iconeDoComponente } from '@/ui/shared/emblemas/Emblema'
import { depoisDaAbertura, economizandoDados, ehFalhaDeRede, resumoDoErro, telaDoJogoPintou } from './abertura'
import { posicaoNoCorpo } from './campos'
import { codigoDigitado, useConta } from './conta'
import { linkWhatsApp } from './ConvideAmigos'
import { corDoEmblema, iconeDoEmblema, normalizarEmblemas, receberMeusEmblemas } from './emblemas'
import { useSiteUi } from './ui'
import { fecharAoMudarDeRota } from './vigias'

const ler = (arq: string) => readFileSync(fileURLToPath(new URL(`./${arq}`, import.meta.url)), 'utf8')

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  useSiteUi.setState({ dialogo: null })
  useToasts.setState({ items: [], queue: [] })
})

describe('código de 6 dígitos (colar no celular)', () => {
  it('colado com espaço, com texto ou com quebra de linha: fica o código inteiro', () => {
    expect(codigoDigitado(' 688989')).toBe('688989')
    expect(codigoDigitado('688989 ')).toBe('688989')
    expect(codigoDigitado('Seu código: 688989')).toBe('688989')
    expect(codigoDigitado('\n    688989\n')).toBe('688989')
    expect(codigoDigitado('688 989')).toBe('688989')
    expect(codigoDigitado('688-989')).toBe('688989')
    // o código no meio de outros números (a validade do e-mail): vale o grupo de 6
    expect(codigoDigitado('Ele vale por 24 horas: 012345')).toBe('012345')
  })
  it('digitando: só dígitos, até 6', () => {
    expect(codigoDigitado('6')).toBe('6')
    expect(codigoDigitado('68a8')).toBe('688')
    expect(codigoDigitado('6889891')).toBe('688989')
  })
  it('os campos de código não têm mais o maxLength (que cortava o colado)', () => {
    for (const arq of ['VerificarEmail.tsx', 'ConviteConta.tsx']) {
      const txt = ler(arq)
      expect(txt, arq).toMatch(/codigoDigitado\(v\)/)
      expect(txt, arq).not.toMatch(/maxLength=\{6\}/)
    }
  })
  it('o e-mail manda o código sem recuo (quem seleciona a linha não leva os espaços)', () => {
    const php = readFileSync(fileURLToPath(new URL('../../servidor/api/_contas.php', import.meta.url)), 'utf8')
    expect(php).not.toMatch(/"\s+\{\$codigo\}\\n/)
    expect(php.match(/"\{\$codigo\}\\n\\n"/g)).toHaveLength(2)
  })
})

describe('"Sem conexão" só quando é a rede', () => {
  it('as mensagens do Chrome, do Safari, do Firefox e do Vite (o pedaço não veio) são rede', () => {
    expect(ehFalhaDeRede(new TypeError('Failed to fetch dynamically imported module: https://x/assets/MinhaConta-1.js'), true)).toBe(true)
    expect(ehFalhaDeRede(new TypeError('Importing a module script failed.'), true)).toBe(true)
    expect(ehFalhaDeRede(new TypeError('error loading dynamically imported module'), true)).toBe(true)
    expect(ehFalhaDeRede(new Error('Unable to preload CSS for /assets/site-1.css'), true)).toBe(true)
    expect(ehFalhaDeRede(new TypeError('Load failed'), true)).toBe(true)
  })
  it('erro de JS ao desenhar (Array.at ausente no Safari 15, um bug) não é rede', () => {
    expect(ehFalhaDeRede(new TypeError('l.at is not a function'), true)).toBe(false)
    expect(ehFalhaDeRede(new TypeError("Cannot read properties of undefined (reading 'x')"), true)).toBe(false)
    expect(ehFalhaDeRede(null, true)).toBe(false)
  })
  it('sem rede no aparelho: qualquer falha vira "Sem conexão"', () => {
    expect(ehFalhaDeRede(new TypeError('l.at is not a function'), false)).toBe(true)
  })
  it('o resumo para a medição: curto e numa linha', () => {
    expect(resumoDoErro(new TypeError('l.at\n is not a function'))).toBe('TypeError: l.at is not a function')
    expect(resumoDoErro('x'.repeat(100))).toHaveLength(64)
  })
  it('o e.php aceita o evento "erro" (onde, msg) e o cliente o manda no erro de desenho', () => {
    const php = readFileSync(fileURLToPath(new URL('../../servidor/api/e.php', import.meta.url)), 'utf8')
    expect(php).toMatch(/'compartilhar', 'erro'\]/)
    expect(php).toMatch(/'erro' => \['onde' => 't', 'msg' => 't'\]/)
    expect(ler('SiteRoot.tsx')).toMatch(/track\('erro'/)
  })
})

describe('pré-cargas depois da abertura', () => {
  const janela = (ric?: boolean) => {
    const w: Record<string, unknown> = { setTimeout, clearTimeout }
    if (ric) w.requestIdleCallback = (cb: () => void) => setTimeout(cb, 5) as unknown as number
    vi.stubGlobal('window', w)
  }
  it('esperam os dados do jogo e a tela pintar; sem requestIdleCallback (Safari), mais 1 s', () => {
    vi.useFakeTimers()
    janela(false)
    let dados = false
    let tela = false
    const fn = vi.fn()
    depoisDaAbertura(fn, { dadosProntos: () => dados, telaPintou: () => tela })
    vi.advanceTimersByTime(3000)
    expect(fn).not.toHaveBeenCalled()
    dados = true
    vi.advanceTimersByTime(3000)
    expect(fn).not.toHaveBeenCalled()
    tela = true
    vi.advanceTimersByTime(250)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10_000)
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('com requestIdleCallback, vai quando o navegador sossega; cancelar antes não roda; os dados que nunca vêm: o teto', () => {
    vi.useFakeTimers()
    janela(true)
    const fn = vi.fn()
    depoisDaAbertura(fn, { dadosProntos: () => true, telaPintou: () => true })
    vi.advanceTimersByTime(10)
    expect(fn).toHaveBeenCalledTimes(1)
    const fn2 = vi.fn()
    const parar = depoisDaAbertura(fn2, { dadosProntos: () => false, telaPintou: () => false })
    vi.advanceTimersByTime(1000)
    parar()
    vi.advanceTimersByTime(60_000)
    expect(fn2).not.toHaveBeenCalled()
    const fn3 = vi.fn()
    depoisDaAbertura(fn3, { dadosProntos: () => false, telaPintou: () => false, tetoMs: 5000 })
    vi.advanceTimersByTime(4000)
    expect(fn3).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1500)
    expect(fn3).toHaveBeenCalledTimes(1)
  })
  it('"a tela pintou" = a .lx-page sem o esqueleto de "Carregando"', () => {
    const doc = (pagina: boolean, esqueleto: boolean) => ({ querySelector: (s: string) => (s === '.lx-page' ? (pagina ? {} : null) : esqueleto ? {} : null) }) as unknown as Document
    expect(telaDoJogoPintou(doc(false, false))).toBe(false)
    expect(telaDoJogoPintou(doc(true, true))).toBe(false)
    expect(telaDoJogoPintou(doc(true, false))).toBe(true)
  })
  it('economia de dados ligada: nada de pré-carga', () => {
    expect(economizandoDados({ connection: { saveData: true } } as unknown as Navigator)).toBe(true)
    expect(economizandoDados({ connection: { saveData: false } } as unknown as Navigator)).toBe(false)
    expect(economizandoDados({} as Navigator)).toBe(false)
  })
  it('o SiteRoot não agenda mais as pré-cargas por relógio (os 2,5 s que disputavam a rede com a primeira tela)', () => {
    const txt = ler('SiteRoot.tsx')
    expect(txt).not.toMatch(/2500/)
    expect(txt).toMatch(/depoisDaAbertura/)
    expect(txt).toMatch(/economizandoDados\(\)/)
  })
})

describe('a abertura do jogo sem o componente do emblema', () => {
  it('emblemas.ts (vai na abertura: Hall público, carreiras) e desafios.ts não importam o Emblema', () => {
    for (const arq of ['emblemas.ts', 'desafios.ts', 'hallPublico.ts', 'carreiras.ts', 'vigias.ts']) {
      // só o tipo pode vir de lá (some no build)
      expect(ler(arq), arq).not.toMatch(/^import (?!type )[^\n]*from '@\/ui\/shared\/emblemas\/Emblema'/m)
    }
    // o destaque da tela inicial: a parte leve não importa a lista, o emblema nem o troféu
    const leve = ler('DestaqueDesafio.tsx')
    expect(leve).not.toMatch(/from '\.\/desafios'|Emblema'|@\/ui\/trophies/)
    expect(leve).toMatch(/import\('\.\/DestaqueDesafioCorpo'\)/)
  })
  it('as regras de cor e ícone são as mesmas do componente', () => {
    for (const c of ['#c8d0dc', '#ABCDEF', '#zzz', 'red', '', null, 3, '#1234567']) expect(corDoEmblema(c)).toBe(corDoComponente(c))
    for (const i of ['circle-dot', 'medal', 'javascript:1', 'A', '', null, 'x'.repeat(33), 'world-cup']) expect(iconeDoEmblema(i)).toBe(iconeDoComponente(i))
  })
})

describe('rota mudou com um diálogo do site aberto', () => {
  it('Entrar, Minha conta, Fale conosco: fecham', () => {
    for (const d of [{ tipo: 'conta', modo: 'manual' }, { tipo: 'perfil' }, { tipo: 'suporte' }, { tipo: 'carreiras' }, { tipo: 'verificar' }] as const) {
      useSiteUi.setState({ dialogo: d })
      fecharAoMudarDeRota()
      expect(useSiteUi.getState().dialogo, d.tipo).toBeNull()
    }
  })
  it('o convite das 5 partidas fecha como no "Agora não" (volta depois); o obrigatório fica', () => {
    const adiar = vi.spyOn(useConta.getState(), 'adiarConvite').mockImplementation(() => {})
    useConta.setState({ regras: { ...useConta.getState().regras, obrigatorio: false } })
    useSiteUi.setState({ dialogo: { tipo: 'conta', modo: 'convite' } })
    fecharAoMudarDeRota()
    expect(useSiteUi.getState().dialogo).toBeNull()
    expect(adiar).toHaveBeenCalledTimes(1)
    useConta.setState({ regras: { ...useConta.getState().regras, obrigatorio: true } })
    useSiteUi.setState({ dialogo: { tipo: 'conta', modo: 'convite' } })
    fecharAoMudarDeRota()
    expect(useSiteUi.getState().dialogo).toEqual({ tipo: 'conta', modo: 'convite' })
    useConta.setState({ regras: { ...useConta.getState().regras, obrigatorio: false } })
  })
  it('o iniciarSite assina a troca de rota (só o path: a query não fecha nada)', () => {
    expect(ler('vigias.ts')).toMatch(/s\.route\.path !== p\.route\.path\) fecharAoMudarDeRota\(\)/)
  })
})

describe('aviso de emblema novo', () => {
  const lista = () => normalizarEmblemas([{ slug: 'noite-de-gala', titulo: 'Noite de gala', icone: 'star', cor: '#b98652', em: new Date().toISOString() }])
  const avisos = () => [...useToasts.getState().items, ...useToasts.getState().queue].filter((x) => x.tone === 'gold')
  it('já em #/desafios: não cobre o título (e o emblema fica como visto)', () => {
    const antes = useApp.getState().route
    useApp.setState({ route: { path: '/desafios', query: {} } })
    receberMeusEmblemas(lista(), 501)
    expect(avisos()).toHaveLength(0)
    useApp.setState({ route: { path: '/', query: {} } })
    receberMeusEmblemas(lista(), 501)
    expect(avisos()).toHaveLength(0)
    // outra conta, fora de #/desafios: avisa
    receberMeusEmblemas(lista(), 502)
    expect(avisos()).toHaveLength(1)
    useApp.setState({ route: antes })
  })
})

describe('rolar só o corpo do diálogo', () => {
  const caixa = (top: number, h: number) => ({ top, bottom: top + h, height: h }) as DOMRect
  const corpo = (scrollTop: number, clientHeight: number, scrollHeight: number, top = 100) =>
    ({ scrollTop, clientHeight, scrollHeight, getBoundingClientRect: () => caixa(top, clientHeight) }) as unknown as HTMLElement
  const el = (top: number, h = 48) => ({ getBoundingClientRect: () => caixa(top, h) }) as unknown as HTMLElement
  it('nearest: o campo abaixo da área visível sobe só o necessário (com folga); à vista, nada', () => {
    // corpo de 300 px na tela (100–400), rolado 0; o campo em 500–548 (fora): rola até o fim dele + 24
    expect(posicaoNoCorpo(corpo(0, 300, 1200), el(500), 'nearest')).toBe(500 - 100 + 48 - 300 + 24)
    expect(posicaoNoCorpo(corpo(0, 300, 1200), el(200), 'nearest')).toBeNull()
    // acima: desce até ele − 16
    expect(posicaoNoCorpo(corpo(400, 300, 1200), el(40), 'nearest')).toBe(400 + 40 - 100 - 16)
  })
  it('center e start; e nunca passa do fim nem do começo', () => {
    expect(posicaoNoCorpo(corpo(0, 300, 1200), el(600), 'center')).toBe(600 - 100 - (300 - 48) / 2)
    expect(posicaoNoCorpo(corpo(0, 300, 1200), el(600), 'start')).toBe(600 - 100 - 12)
    expect(posicaoNoCorpo(corpo(0, 300, 500), el(600), 'start')).toBe(200)
    expect(posicaoNoCorpo(corpo(0, 300, 1200), el(105), 'start')).toBe(0)
  })
  it('nenhum scrollIntoView nos diálogos (ele rolava também o painel do sheet)', () => {
    for (const arq of ['MinhaConta.tsx', 'ConviteConta.tsx', 'FaleConosco.tsx', 'VerificarEmail.tsx', 'MinhasCarreiras.tsx']) expect(ler(arq), arq).not.toMatch(/\.scrollIntoView\(/)
    expect(ler('campos.tsx')).toMatch(/corpo\.scrollTo\(/)
  })
})

describe('Convide amigos dentro dos apps', () => {
  it('o "Mandar no WhatsApp" vai pelo wa.me com o texto e o link', () => {
    expect(linkWhatsApp('Joga o LENDA comigo: https://oprojeto.online/lenda/?c=ABCD2345')).toBe(
      'https://wa.me/?text=Joga%20o%20LENDA%20comigo%3A%20https%3A%2F%2Foprojeto.online%2Flenda%2F%3Fc%3DABCD2345',
    )
  })
  it('sem navigator.share, o "Compartilhar" avisa que copiou e onde colar', () => {
    expect(ler('ConvideAmigos.tsx')).toMatch(/Cole no WhatsApp, no Direct ou onde quiser/)
  })
})

describe('Safari antigo e celular (CSS)', () => {
  const css = ler('site.css')
  it('o sheet: a regra com dvh só dentro do @supports (com var(), ela não cai para a anterior no Safari < 15.4)', () => {
    const regra = css.split('\n').find((l) => l.startsWith('.sc-modal.lx-sheet {')) ?? ''
    expect(regra).toMatch(/max-height: calc\(var\(--sc-ih, 100vh\) \* \.92 - var\(--sc-kb, 0px\)\)/)
    expect(regra).not.toMatch(/dvh/)
    const fora = css.replace(/@supports \(height: 1dvh\) \{[\s\S]*?\n\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(fora).not.toMatch(/\d+dvh/)
    expect(css).toMatch(/@supports \(height: 1dvh\) \{\n {2}\.sc-modal\.lx-sheet \{ max-height: calc\(92dvh - var\(--sc-kb, 0px\)\); \}/)
  })
  it('os campos de link com 16 px no celular (sem zoom do iPhone)', () => {
    expect(css).toMatch(/\.sc-conv__link \.lx-input \{ font-size: 16px/)
    expect(ler('v33.css')).toMatch(/\.sv-perfil-link \.lx-input \{ font-size: 16px/)
  })
  it('a faixa de desafios: alvos de 40 px com 8 px de vão no toque', () => {
    const v34 = ler('v34.css')
    const bloco = v34.slice(v34.indexOf('@media (pointer: coarse) {'))
    expect(bloco).toMatch(/^@media \(pointer: coarse\) \{\n {2}\.s4-faixa \{[^}]*\}\n {2}\.s4-faixa__l \{ height: 40px; gap: 0 8px; \}/)
  })
})

describe('o destaque do desafio de prêmio na tela inicial', () => {
  it('o prêmio escrito com ponto no fim não sai com dois pontos; o longo termina nas reticências', async () => {
    const { fraseDoPremio } = await import('./DestaqueDesafioCorpo')
    expect(fraseDoPremio('Kit do LENDA com camisa autografada (texto de teste do painel).')).toBe(': Kit do LENDA com camisa autografada (texto de teste do painel).')
    expect(fraseDoPremio('Uma camisa')).toBe(': Uma camisa.')
    expect(fraseDoPremio('Uma camisa!')).toBe(': Uma camisa!')
    expect(fraseDoPremio('')).toBe(' o prêmio.')
    expect(fraseDoPremio(null)).toBe(' o prêmio.')
    const longo = fraseDoPremio('x'.repeat(90) + '.')
    expect(longo.endsWith('…')).toBe(true)
    expect(longo).not.toMatch(/\.\.|…\./)
  })
})

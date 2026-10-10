import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { cliqueDeAba, hrefAba, irParaAba } from '../../lib/abas'
import { precoOuConsultar } from '../../lib/formato'
import { consultaDaVisita } from '../../lib/url'
import { useUI } from '../../store/ui'
import { Icone } from '../comum'
import { useCamadaAberta } from '../Mercador'
import { avisoDoChamado, useCtaMercado } from './cta'
import { Motor, type Balao, type VitrineDaCena } from './motor'
import { carregarPacote, type Pacote } from './pacote'
import { ALTURA, LARGURA_MAX, escalaDoAparelho, palcoFaixa, type Palco } from './palco'
import { montarCena, montarRetrato, type Cena, type Chamado, type Saco } from './roteiro'
import { useVitrineDaRua } from './vitrine'
import { arteNaRua, chaveDaArte, folhaDoProduto } from './vitrine-arte'
import './Rua.css'

// A rua viva: o mercador anda, bebe a Fanta e vende para o skatista, o motoboy, o MC e o turista. Um canvas na
// resolução da arte (o CSS amplia em px inteiros do aparelho), os balões de fala por cima no DOM (texto nítido em
// Pixelify) e o que dá para tocar: o mercador (abre o casaco e oferece o Mercado) e os clientes (reagem). Duas casas:
//   - a FAIXA (RuaInicio): embaixo do perfil no computador e, na Home 2, no fim do Início do celular (RuaCelular); para
//     sozinha fora da tela, com a aba escondida, com camada por cima, no botão de pausar e com movimento reduzido (aí
//     vira uma foto: o mercador de casaco aberto atendendo);
//   - o STORY do celular, na home (StoryRua): o mundo em pé (ou a faixa larga, deitado) recortado no quadro do story;
//     quem diz se ela anda é o story (segmento à vista e tocando), o adesivo do Mercado e o toque ficam com ele.
// Para o leitor de tela é decorativa: o rótulo do grupo e o botão do mercador.
// A VITRINE (vitrine.ts): com a loja do servidor, entre um cliente e outro o mercador ergue um produto de verdade da loja
// do estado (permitido na rua: nada de álcool nem tabaco) e a plaquinha com o nome e o preço aparece uns 2,6 s; o
// próximo vem no intervalo seguinte. Tocar no produto ou na plaquinha abre a página dele; no teclado, a plaquinha é um
// link (aparece com o foco), sem aviso nenhum a cada troca. Com movimento reduzido, a foto com um produto parado (o
// próximo quando a rua volta à vista). Sem loja ou sem produto permitido, a rua de sempre.

export type EstadoRua = 'carregando' | 'foto' | 'rodando' | 'parada' | 'falhou'

/** O pedaço do mundo que o quadro do story mostra (StoryRua faz a conta). */
export interface RecorteStory {
  /** O palco (em pé ou a faixa larga do celular deitado), com o pedaço que aparece. */
  palco: Palco
  /** px do aparelho por pixel da arte (inteiro) e o dpr da conta. */
  kk: number
  dpr: number
  /** Canto de cima à esquerda do mundo no quadro (px de CSS, no pixel do aparelho). */
  left: number
  top: number
  /** Onde os balões podem ir (px de CSS do quadro): abaixo do cabeçalho e acima dos adesivos. */
  topo: number
  base: number
}

/** O que o story pede para a rua: o toque no quadro (quem foi tocado reage; o mercador é chamado). */
export interface AlcaRua {
  tocar(x: number, y: number): string | null
}

export interface StoryDaRua {
  recorte: RecorteStory
  /** O story da rua à vista e tocando (o Hero decide). */
  ativa: boolean
  alca: RefObject<AlcaRua | null>
  /** Chamaram o mercador: o story mostra o adesivo do Mercado e conta para o leitor de tela. */
  aoChamar: (c: Chamado, rodando: boolean) => void
  aoEstado: (e: EstadoRua) => void
  /** O saco dos clientes (dura enquanto o story existir). */
  saco: Saco
  /** O texto do adesivo do pé: o chamado não repete ele. */
  legenda: string
  /** O que mais os balões evitam cobrir no quadro (a dica de primeira vez), em px de CSS do quadro. */
  obstaculos?: () => { x0: number; y0: number; x1: number; y1: number }[]
  /** O segmento da rua é o que está no quadro (com movimento reduzido, a vitrine troca de produto quando ela volta). */
  aqui: boolean
  /** A plaquinha do produto entrou ou saiu (o story segura o tempo enquanto ela está à vista, como no adesivo). */
  aoVitrine?: (mostra: boolean) => void
}

export interface PropsRua {
  /** Faixa: px de CSS por pixel da arte (inteiro; vira px inteiros do aparelho). */
  k?: number
  /** Faixa: escurece as pontas (a cena não vai de ponta a ponta da tela). */
  bordas?: boolean
  className?: string
  /** No story do celular. */
  story?: StoryDaRua
  /** O elenco não montou ou o motor falhou: quem mostra a rua decide o que fica no lugar (sem ele, nada). */
  aoFalhar?: () => void
}

const REDUZ = '(prefers-reduced-motion: reduce)'
function assinarReduz(avisar: () => void) {
  try {
    const q = window.matchMedia(REDUZ)
    q.addEventListener('change', avisar)
    return () => q.removeEventListener('change', avisar)
  } catch {
    return () => {}
  }
}
const lerReduz = () => {
  try {
    return window.matchMedia(REDUZ).matches
  } catch {
    return false
  }
}
function assinarAba(avisar: () => void) {
  document.addEventListener('visibilitychange', avisar)
  return () => document.removeEventListener('visibilitychange', avisar)
}
const lerAba = () => document.visibilityState !== 'hidden'

/** ?ruaquadros[=semente]: relógio na mão (prints quadro a quadro), semente fixa. */
function modoQuadros(): number | null {
  try {
    const v = new URLSearchParams(location.search).get('ruaquadros')
    return v == null ? null : Number(v) || 7
  } catch {
    return null
  }
}

interface Montada {
  motor: Motor
  cena: Cena
  /** px de CSS por pixel da grade. */
  px: number
  /** Onde o canvas começa dentro da caixa (px de CSS). */
  ox: number
  oy: number
}

/** Um jeito de quebrar o balão: a largura máxima (null: a do CSS) e o tamanho que ele fica. */
interface Variante {
  mw: number | null
  w: number
  h: number
  linhas: number
}
interface Medida {
  vs: Variante[]
  atual: number
}
/** As quebras de cada balão (uma, duas e três linhas), medidas uma vez quando ele aparece. */
const medidas = new WeakMap<HTMLElement, Medida>()

/** Mede o balão com a largura máxima `mw`: tamanho da caixa e largura da linha mais larga (sem o giro da entrada). */
function lerBalao(el: HTMLElement, mw: number | null) {
  el.style.maxWidth = mw == null ? '' : `${mw}px`
  const corpo = el.firstElementChild as HTMLElement
  const esc = corpo.offsetWidth ? corpo.getBoundingClientRect().width / corpo.offsetWidth || 1 : 1
  const r = document.createRange()
  r.selectNodeContents(corpo)
  const linhas = new Map<number, number>()
  for (const q of r.getClientRects()) {
    const t = Math.round(q.top / esc)
    linhas.set(t, (linhas.get(t) ?? 0) + q.width / esc)
  }
  return { w: el.offsetWidth, h: el.offsetHeight, linhas: Math.max(1, linhas.size), texto: linhas.size ? Math.max(...linhas.values()) : 0 }
}

/**
 * Uma linha (a do CSS) e, se a fala quebra, duas e três, cada uma na menor largura que cabe e justa no texto (a caixa
 * encolhe até a linha mais larga): é o que deixa o balão caber de lado quando a cabeça de outro está perto de quem
 * fala. Uns 15 layouts, uma vez por balão.
 */
function medirBalao(el: HTMLElement): Variante[] {
  const v0 = lerBalao(el, null)
  const vs: Variante[] = [{ mw: null, w: v0.w, h: v0.h, linhas: v0.linhas }]
  const folga = v0.w - v0.texto
  let teto = v0.w
  for (let alvo = v0.linhas + 1; alvo <= 3; alvo++) {
    // a menor largura com até `alvo` linhas (busca binária: menos largura, mais linhas)
    let lo = 24
    let hi = teto
    while (hi - lo > 2) {
      const meio = (lo + hi) >> 1
      if (lerBalao(el, meio).linhas <= alvo) hi = meio
      else lo = meio
    }
    const a = lerBalao(el, hi)
    if (a.linhas !== alvo) continue
    // justa na linha mais larga
    const mw = Math.min(hi, Math.ceil(a.texto + folga + 1))
    const b = lerBalao(el, mw)
    vs.push(b.linhas === alvo ? { mw, w: b.w, h: b.h, linhas: alvo } : { mw: hi, w: a.w, h: a.h, linhas: alvo })
    teto = hi
  }
  el.style.maxWidth = ''
  return vs
}

interface Caixa {
  x0: number
  y0: number
  x1: number
  y1: number
  /** Quanto custa cobrir: cabeça de outro pesa muito; o letreiro e o botão de pausar, menos. */
  peso: number
}
const cobre = (x0: number, y0: number, x1: number, y1: number, c: Caixa) => Math.max(0, Math.min(x1, c.x1) - Math.max(x0, c.x0)) * Math.max(0, Math.min(y1, c.y1) - Math.max(y0, c.y0))
/** Da plaquinha ao produto: o comprimento da cauda (px de CSS). */
const CAUDA_PLACA = 7
/** Onde a cauda da plaquinha fica: embaixo (a placa em cima do produto) ou de um lado (a placa do lado dele). */
type LadoCauda = 'baixo' | 'esq' | 'dir'
/** Custo de quebrar a fala (px² cobertos que valem uma linha a mais). */
const CUSTO_LINHA = [0, 150, 1000]

export default function Rua({ k = 2, bordas = false, className, story, aoFalhar }: PropsRua) {
  const raiz = useRef<HTMLDivElement>(null)
  const tela = useRef<HTMLCanvasElement>(null)
  const camadaBaloes = useRef<HTMLDivElement>(null)
  const botaoMerc = useRef<HTMLButtonElement>(null)
  const montada = useRef<Montada | null>(null)
  const [pacote, setPacote] = useState<Pacote | null>(null)
  const [falhou, setFalhou] = useState(false)
  const [largura, setLargura] = useState(0)
  const [versao, setVersao] = useState(0)
  const [baloes, setBaloes] = useState<Balao[]>([])
  const [pausada, setPausada] = useState(false)
  // o adesivo do Mercado na faixa (no story, quem mostra é o StoryRua)
  const cta = useCtaMercado()
  // o que o leitor de tela ouve quando chamam o mercador (a cena sozinha fica muda)
  const [aviso, setAviso] = useState('')
  const reduz = useSyncExternalStore(assinarReduz, lerReduz, () => false)
  const abaVisivel = useSyncExternalStore(assinarAba, lerAba, () => true)
  // à vista de verdade (faixa): a barra de abas do celular (64 px, fixa embaixo) cobre o pé da tela
  const [naTela, setNaTela] = useState(false)
  const emStory = !!story

  // ── a vitrine: os produtos permitidos da loja do estado (vitrine.ts) e, de cada um, a arte em pixel pronta ──
  const lista = useVitrineDaRua()
  /** chave da arte do produto (vitrine-arte.ts) → a folha dele no pacote. */
  const [prontas, setProntas] = useState<ReadonlyMap<string, string>>(() => new Map())
  /** O produto da plaquinha (o erguido agora, ou o último) e se ela está à vista. */
  const [naPlaca, setNaPlaca] = useState<string | null>(null)
  const [placaVisivel, setPlacaVisivel] = useState(false)
  const placa = useRef<HTMLAnchorElement>(null)
  const vit = useRef({ lista, prontas, atual: null as string | null, focada: false })
  vit.current.lista = lista
  vit.current.prontas = prontas
  /** O que o roteiro pede: o próximo produto pronto (o mesmo enquanto a plaquinha tem o foco) e a plaquinha. */
  const controlador = useMemo<VitrineDaCena>(
    () => ({
      proximo() {
        const v = vit.current
        const ok = v.lista.filter((p) => v.prontas.has(chaveDaArte(p)))
        if (!ok.length) return null
        // o seguinte ao último mostrado, na ordem da vitrine (a lista pode ter crescido ou mudado desde ele); com o foco
        // na plaquinha, o mesmo
        const i = v.atual ? ok.findIndex((x) => x.id === v.atual) : -1
        const p = v.focada && i >= 0 ? ok[i] : ok[(i + 1) % ok.length]
        v.atual = p.id
        return { id: p.id, folha: v.prontas.get(chaveDaArte(p))! }
      },
      aoMostrar(id) {
        if (id) setNaPlaca(id)
        setPlacaVisivel(!!id)
      },
    }),
    [],
  )

  useEffect(() => {
    const el = raiz.current
    if (!el || emStory) return
    if (typeof IntersectionObserver === 'undefined') {
      setNaTela(true)
      return
    }
    const io = new IntersectionObserver(([e]) => setNaTela(e.isIntersecting), { rootMargin: '0px 0px -72px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [emStory])
  const camada = useCamadaAberta()
  const quadros = useRef(modoQuadros()).current
  const roda = emStory
    ? !!pacote && !!story.ativa && abaVisivel && !reduz && quadros == null
    : !!pacote && naTela && abaVisivel && !camada && !pausada && !reduz && quadros == null

  useEffect(() => {
    if (falhou) aoFalhar?.()
  }, [falhou, aoFalhar])

  // o elenco monta no worker quando a rua chega perto da tela (no computador e no story ela já nasce à vista); no fim do
  // Início do celular (Home 2), também com a rua até duas telas acima (quem pulou pro fim da página e vai subir de volta
  // até ela)
  const [perto, setPerto] = useState(emStory)
  useEffect(() => {
    const el = raiz.current
    if (!el || perto) return
    if (typeof IntersectionObserver === 'undefined') {
      setPerto(true)
      return
    }
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setPerto(true), { rootMargin: '200% 0px 100% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [perto])
  useEffect(() => {
    if (!perto) return
    let vivo = true
    carregarPacote().then(
      (p) => vivo && setPacote(p),
      () => vivo && setFalhou(true),
    )
    return () => {
      vivo = false
    }
  }, [perto])

  // largura da faixa (a rua remonta quando ela muda: janela que estica); no story, o recorte vem pronto
  useLayoutEffect(() => {
    const el = raiz.current
    if (!el || emStory) return
    let t = 0
    const medir = () => {
      const w = Math.round(el.clientWidth)
      setLargura((antes) => {
        if (!antes) return w
        // esticando a janela: espera parar
        window.clearTimeout(t)
        t = window.setTimeout(() => setLargura(w), 160)
        return antes
      })
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => {
      ro.disconnect()
      window.clearTimeout(t)
    }
  }, [emStory])

  /** Balões e o botão do mercador seguem quem fala / o mercador (depois de cada desenho). */
  const limites = useRef({ topo: 2, base: Infinity })
  limites.current = story ? { topo: story.recorte.topo, base: story.recorte.base } : { topo: 2, base: Infinity }
  const obstaculosRef = useRef(story?.obstaculos)
  obstaculosRef.current = story?.obstaculos
  const posicionar = useCallback(() => {
    const mo = montada.current
    const caixa = raiz.current
    if (!mo || !caixa) return
    const { motor, px, ox, oy } = mo
    const dpr = window.devicePixelRatio || 1
    const snap = (v: number) => Math.round(v * dpr) / dpr
    const W = caixa.clientWidth
    const { topo: TOPO, base: BASE } = limites.current
    const extras = obstaculosRef.current?.() ?? []
    const CAUDA = 7
    // o produto erguido (a vitrine) e a plaquinha: o balão não cobre nenhum dos dois
    const merc = motor.ator('mercador')
    const ci = merc && motor.mostrando && merc.item === motor.mostrando.folha ? motor.caixaDoItem(merc, { anim: 'segurar', i: 0 }) : null
    const produto: Caixa | null = ci ? { x0: ox + ci[0] * px, y0: oy + ci[1] * px, x1: ox + ci[2] * px, y1: oy + ci[3] * px, peso: 10 } : null
    /** Onde os balões ficaram (a plaquinha foge deles). */
    const ocupados: Caixa[] = []
    camadaBaloes.current?.querySelectorAll<HTMLElement>('[data-ator]').forEach((el) => {
      const a = motor.ator(el.dataset.ator!)
      if (!a) return
      const c = motor.cabeca(a)
      const cx = ox + c.x * px
      const cy = oy + c.y * px
      let med = medidas.get(el)
      // a fonte em pixel chegou depois da medida: mede de novo
      if (med && Math.abs(el.offsetWidth - med.vs[med.atual].w) > 1) med = undefined
      if (!med) {
        med = { vs: medirBalao(el), atual: 0 }
        medidas.set(el, med)
      }
      // o que o balão não deve cobrir: a cabeça de outro (o rosto e o capuz), o letreiro GC e o botão de pausar
      const obst: Caixa[] = []
      for (const o of motor.atores) {
        if (o === a || !o.visivel || o.efeito) continue
        if (motor.temCabeca(o)) {
          const oc = motor.cabeca(o)
          const topo = Math.min(oc.y, motor.caixa(o)[1])
          obst.push({ x0: ox + (oc.x - 10) * px, y0: oy + topo * px, x1: ox + (oc.x + 10) * px, y1: oy + (topo + 14) * px, peso: 10 })
        } else if (o.id === 'letreiro') {
          const [x0, y0, x1, y1] = motor.caixa(o)
          obst.push({ x0: ox + x0 * px, y0: oy + y0 * px, x1: ox + x1 * px, y1: oy + y1 * px, peso: 1 })
        }
      }
      if (caixa.querySelector('.rua-pausa')) obst.push({ x0: W - 38, y0: 6, x1: W - 6, y1: 38, peso: 2 })
      // no story, a dica de primeira vez pesa como uma cabeça: o balão vai para o lado ou quebra antes de cobrir ela
      for (const o of extras) obst.push({ ...o, peso: 10 })
      if (produto) obst.push(produto)
      // em cima da cabeça, um pouco para a frente (para onde ele olha), com a ponta da cauda em cima dele, dentro da
      // caixa (no story, entre o cabeçalho e os adesivos); se cobrir alguma coisa, vai para o lado ou quebra em duas
      // (três) linhas: ganha o que cobre menos
      let melhor = { custo: Infinity, iv: 0, left: 0, top: 0 }
      med.vs.forEach((v, iv) => {
        const topoIdeal = cy - CAUDA - v.h - 1
        const top = Math.min(Math.max(TOPO, topoIdeal), BASE - v.h)
        const pref = cx - v.w / 2 + (c.lado === 'dir' ? v.w * 0.18 : -v.w * 0.18)
        // a cauda (12 px da ponta da caixa, no mínimo) fica em cima de quem fala
        const lo = Math.max(4, cx - v.w + 12)
        const hi = Math.min(W - v.w - 4, cx - 12)
        const prender = (x: number) => (lo <= hi ? Math.max(lo, Math.min(hi, x)) : Math.max(4, Math.min(W - v.w - 4, pref)))
        const lugares = [pref, lo, hi]
        for (const o of obst) lugares.push(o.x0 - v.w - 4, o.x1 + 4)
        for (const l of lugares) {
          const left = prender(l)
          let custo = CUSTO_LINHA[v.linhas - med.vs[0].linhas] ?? 2000
          custo += Math.abs(left - pref) * 0.5 + (topoIdeal < TOPO ? (TOPO - topoIdeal) * 20 : 0) + (iv !== med.atual ? 60 : 0)
          // o corpo do balão (a cauda é a sobra transparente de baixo)
          for (const o of obst) custo += o.peso * cobre(left, top, left + v.w, top + v.h - CAUDA, o)
          if (custo < melhor.custo) melhor = { custo, iv, left, top }
        }
      })
      const v = med.vs[melhor.iv]
      if (melhor.iv !== med.atual) {
        med.atual = melhor.iv
        el.style.maxWidth = v.mw == null ? '' : `${v.mw}px`
      }
      el.style.transform = `translate(${snap(melhor.left)}px, ${snap(melhor.top)}px)`
      el.style.setProperty('--cauda', `${Math.round(Math.max(12, Math.min(v.w - 12, cx - melhor.left)))}px`)
      ocupados.push({ x0: melhor.left, y0: melhor.top, x1: melhor.left + v.w, y1: melhor.top + v.h, peso: 6 })
    })
    const b = botaoMerc.current
    if (merc && b) {
      const [x0, y0, x1, y1] = motor.caixa(merc)
      b.style.transform = `translate(${snap(ox + x0 * px)}px, ${snap(oy + y0 * px)}px)`
      b.style.width = `${snap((x1 - x0) * px)}px`
      b.style.height = `${snap((y1 - y0) * px)}px`
      // o adesivo do Mercado (faixa): colado na calçada, embaixo dele
      const l = cta.ref.current
      if (l) {
        const w = l.offsetWidth
        const meio = ox + merc.x * px
        l.style.transform = `translate(${snap(Math.max(6, Math.min(W - w - 6, meio - w / 2)))}px, 0) rotate(2deg)`
      }
    }
    // a plaquinha do produto: presa ao produto erguido (na pose, não no balanço da mão) ou, sem produto na mão (o foco
    // do teclado chegou nela), ao lado da cabeça do mercador. Em cima dele com a cauda embaixo, ou do lado, com a cauda
    // apontando para ele: ganha o lugar que cobre menos (as cabeças, o produto, o letreiro, os balões)
    const pl = placa.current
    if (pl && merc) {
      const hc = motor.cabeca(merc)
      const alvo = produto ?? { x0: ox + (hc.x - 6) * px, y0: oy + hc.y * px, x1: ox + (hc.x + 6) * px, y1: oy + (hc.y + 12) * px, peso: 10 }
      const w = pl.offsetWidth
      const h = pl.offsetHeight
      const cx = (alvo.x0 + alvo.x1) / 2
      const cy = (alvo.y0 + alvo.y1) / 2
      const obst: Caixa[] = [{ ...alvo, peso: 30 }, ...ocupados]
      for (const o of motor.atores) {
        if (!o.visivel || o.efeito) continue
        if (motor.temCabeca(o)) {
          const oc = motor.cabeca(o)
          const [bx0, by0, bx1, by1] = motor.caixa(o)
          const topo = Math.min(oc.y, by0)
          obst.push({ x0: ox + (oc.x - 10) * px, y0: oy + topo * px, x1: ox + (oc.x + 10) * px, y1: oy + (topo + 14) * px, peso: 10 })
          // o corpo também (a placa por cima do casaco dele esconde quem mostra)
          obst.push({ x0: ox + bx0 * px, y0: oy + by0 * px, x1: ox + bx1 * px, y1: oy + by1 * px, peso: 2 })
        } else if (o.id === 'letreiro') {
          // o GC em néon (a marca da loja na cena): a placa só cobre se não tiver outro lugar
          const [x0, y0, x1, y1] = motor.caixa(o)
          obst.push({ x0: ox + x0 * px, y0: oy + y0 * px, x1: ox + x1 * px, y1: oy + y1 * px, peso: 4 })
        }
      }
      // o botão de pausar (WCAG 2.2.2) nunca fica embaixo da placa
      if (caixa.querySelector('.rua-pausa')) obst.push({ x0: W - 44, y0: 0, x1: W, y1: 44, peso: 40 })
      for (const o of extras) obst.push({ ...o, peso: 10 })
      // no story, as bordas que passam (28% de cada lado) ficam por cima: melhor no miolo, onde o toque abre o produto
      if (emStory) obst.push({ x0: 0, y0: TOPO, x1: W * 0.28, y1: BASE, peso: 0.3 }, { x0: W * 0.72, y0: TOPO, x1: W, y1: BASE, peso: 0.3 })
      const frente: LadoCauda = merc.lado === 'dir' ? 'esq' : 'dir'
      const lugares: { lado: LadoCauda; left: number; top: number; base: number }[] = [
        // em cima: no meio, mais para trás (por cima da cabeça dele) ou mais para a frente, sempre com a cauda nele
        { lado: 'baixo', left: cx - w / 2, top: alvo.y0 - CAUDA_PLACA - h, base: 0 },
        { lado: 'baixo', left: cx - w + 16, top: alvo.y0 - CAUDA_PLACA - h, base: 10 },
        { lado: 'baixo', left: cx - 16, top: alvo.y0 - CAUDA_PLACA - h, base: 10 },
      ]
      // do lado: na frente dele (para onde olha) ou atrás, com a cauda no meio do produto, a placa no meio, mais para
      // cima ou mais para baixo (na faixa baixa do computador, por baixo do letreiro)
      for (const [lado, base] of [[frente, 30], [frente === 'esq' ? 'dir' : 'esq', 60]] as const)
        for (const top of [cy - h / 2, cy - 12, cy - h + 12, alvo.y1 - 14])
          lugares.push({ lado, left: lado === 'esq' ? alvo.x1 + CAUDA_PLACA : alvo.x0 - CAUDA_PLACA - w, top, base: base + (top === cy - h / 2 ? 0 : 8) })
      let melhor = { custo: Infinity, lado: 'baixo' as LadoCauda, left: 0, top: 0 }
      for (const l of lugares) {
        const left = Math.max(4, Math.min(W - w - 4, l.left))
        const top = Math.max(TOPO, Math.min(BASE - h, l.top))
        let custo = l.base + (Math.abs(left - l.left) + Math.abs(top - l.top)) * 2
        for (const o of obst) custo += o.peso * cobre(left, top, left + w, top + h, o)
        if (custo < melhor.custo) melhor = { custo, lado: l.lado, left, top }
      }
      pl.style.transform = `translate(${snap(melhor.left)}px, ${snap(melhor.top)}px)`
      pl.dataset.cauda = melhor.lado
      const ponta = melhor.lado === 'baixo' ? cx - melhor.left : cy - melhor.top
      pl.style.setProperty('--cauda', `${Math.round(Math.max(10, Math.min((melhor.lado === 'baixo' ? w : h) - 10, ponta)))}px`)
    }
  }, [cta.ref, emStory])

  // monta a cena (e remonta quando muda a largura, o palco do story ou a escala, o elenco ou o movimento reduzido). No
  // story, o mundo mudar de lugar no quadro (o pé desce com o aviso de local respondido, a janela encolhe com o teclado
  // do Android) não remonta: só reposiciona (efeito de baixo) e a cena continua de onde estava
  const recorte = story?.recorte
  const recorteRef = useRef(recorte)
  recorteRef.current = recorte
  const palcoStory = recorte?.palco
  const kkStory = recorte?.kk
  const dprStory = recorte?.dpr
  const saco = story?.saco
  const legenda = story?.legenda
  const [pintada, setPintada] = useState(false)
  useEffect(() => {
    const c = tela.current
    if (!pacote || !c) return
    let palco: Palco
    let px: number
    let ox: number
    let oy = 0
    const rec = recorteRef.current
    if (palcoStory && kkStory && dprStory && rec) {
      // story: o mundo inteiro no canvas, recortado pelo quadro (left/top já no pixel do aparelho)
      palco = palcoStory
      px = kkStory / dprStory
      ox = rec.left
      oy = rec.top
      c.style.width = `${palco.w * px}px`
      c.style.height = `${palco.h * px}px`
      c.style.transform = `translate(${ox}px, ${oy}px)`
    } else {
      if (!largura) return
      const dpr = window.devicePixelRatio || 1
      const kk = escalaDoAparelho(k, dpr)
      const W = Math.min(LARGURA_MAX, Math.ceil((largura * dpr) / kk))
      palco = palcoFaixa(W, bordas || W >= LARGURA_MAX)
      px = kk / dpr
      c.style.width = `${(W * kk) / dpr}px`
      c.style.height = `${(ALTURA * kk) / dpr}px`
      ox = (largura - (W * kk) / dpr) / 2
      c.style.transform = `translateX(${Math.round(ox * dpr) / dpr}px)`
    }
    let motor: Motor
    try {
      motor = new Motor({
        tela: c,
        pacote,
        palco,
        semente: quadros ?? (Date.now() & 0xffff),
        sexta: new Date().getDay() === 5,
        aoBaloes: (b) => setBaloes(b),
        aoDesenhar: () => posicionar(),
      })
    } catch {
      setFalhou(true)
      return
    }
    // no story, a rua começa com um cliente já entrando (cabe um atendimento inteiro no segmento)
    const cena = reduz ? montarRetrato(motor, { evitar: legenda }) : montarCena(motor, palcoStory ? { story: true, saco, evitar: legenda } : {})
    if (!reduz) motor.vitrine = controlador
    montada.current = { motor, cena, px, ox, oy }
    motor.desenhar()
    setPintada(true)
    setVersao((v) => v + 1)
    if (quadros != null) {
      ;(window as unknown as { __rua?: unknown }).__rua = {
        avancar: (ms: number) => motor.avancarNaMao(ms),
        motor,
        chamar: () => cena.chamar(false),
      }
    }
    return () => {
      motor.destruir()
      montada.current = null
      setBaloes([])
      // a cena nova começa sem produto na mão
      setPlacaVisivel(false)
    }
  }, [pacote, largura, k, bordas, reduz, quadros, posicionar, palcoStory, kkStory, dprStory, saco, legenda, controlador])

  // story: o mundo no novo lugar do quadro (mesma escala, mesma cena): o canvas, os balões e o botão do mercador
  const leftStory = recorte?.left
  const topStory = recorte?.top
  const topoStory = recorte?.topo
  const baseStory = recorte?.base
  useLayoutEffect(() => {
    const mo = montada.current
    const c = tela.current
    if (!mo || !c || leftStory == null || topStory == null) return
    if (mo.ox !== leftStory || mo.oy !== topStory) {
      mo.ox = leftStory
      mo.oy = topStory
      c.style.transform = `translate(${leftStory}px, ${topStory}px)`
    }
    posicionar()
  }, [leftStory, topStory, topoStory, baseStory, versao, posicionar])

  // liga e desliga o relógio
  useEffect(() => {
    const mo = montada.current
    if (!mo) return
    if (roda) mo.motor.ligar()
    else mo.motor.desligar()
  }, [roda, versao])

  // balão novo: posiciona antes de pintar
  useLayoutEffect(() => {
    posicionar()
  }, [baloes, cta.visivel, posicionar])

  // a arte de cada produto da vitrine, um por respiro do navegador, só depois que a rua já pintou o primeiro quadro (a
  // primeira tela e a abertura da cena não pagam nada por ela); a folha entra no pacote do motor
  useEffect(() => {
    if (!pacote || !pintada || !lista.length) return
    let vivo = true
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
    let cancelar = () => {}
    const ociosa = (f: () => void) => {
      if (w.requestIdleCallback && w.cancelIdleCallback) {
        const id = w.requestIdleCallback(f, { timeout: 1500 })
        cancelar = () => w.cancelIdleCallback?.(id)
      } else {
        const id = window.setTimeout(f, 120)
        cancelar = () => window.clearTimeout(id)
      }
    }
    const feitas = new Set<string>()
    const seguinte = () => {
      const p = lista.find((x) => !vit.current.prontas.has(chaveDaArte(x)) && !feitas.has(chaveDaArte(x)))
      if (!p) return
      const chave = chaveDaArte(p)
      feitas.add(chave)
      ociosa(() => {
        void arteNaRua(p).then((a) => {
          if (!vivo) return
          if (a) {
            const folha = `produto:${chave}`
            pacote.folhas[folha] = folhaDoProduto(folha, a)
            setProntas((m) => new Map(m).set(chave, folha))
          }
          seguinte()
        })
      })
    }
    seguinte()
    return () => {
      vivo = false
      cancelar()
    }
  }, [pacote, pintada, lista])

  // a plaquinha: o produto dela (sem nenhum erguido ainda, o primeiro pronto, para o teclado já achar o link) e só
  // enquanto ele estiver na vitrine (o dono tirou do site ou esgotou: some)
  const prontosNaLista = lista.filter((p) => prontas.has(chaveDaArte(p)))
  const produtoPlaca = prontosNaLista.find((p) => p.id === naPlaca) ?? (naPlaca ? null : (prontosNaLista[0] ?? null))
  const temVitrine = prontosNaLista.length > 0
  const placaAVista = placaVisivel && !!produtoPlaca
  /** O produto da plaquinha saiu da vitrine (o dono tirou do site, esgotou no estado). */
  const placaSaiu = !!naPlaca && !produtoPlaca

  // movimento reduzido: a foto com um produto erguido, parado; o próximo só quando a rua volta à vista (o segmento do
  // story de novo, a faixa que volta para a tela), nunca sozinho na frente de quem olha
  const aVista = emStory ? !!story?.aqui : naTela && abaVisivel && !camada
  useEffect(() => {
    const mo = montada.current
    if (!reduz || !mo?.cena.vitrineFoto) return
    if (!temVitrine) {
      if (mo.motor.mostrando) {
        mo.cena.vitrineFoto(null)
        mo.motor.desenhar()
      }
      setPlacaVisivel(false)
      return
    }
    // fora da vista, fica o que está; o que saiu da vitrine troca na hora
    if (!aVista && mo.motor.mostrando && !placaSaiu) return
    const p = controlador.proximo()
    mo.cena.vitrineFoto(p)
    mo.motor.desenhar()
    setNaPlaca(p?.id ?? null)
    setPlacaVisivel(!!p)
  }, [reduz, aVista, temVitrine, placaSaiu, versao, controlador])

  // o story segura o tempo dele enquanto a plaquinha está à vista (na foto ela fica, e o story corre normal)
  const aoVitrine = story?.aoVitrine
  useEffect(() => {
    aoVitrine?.(placaAVista && !reduz)
  }, [placaAVista, reduz, aoVitrine])

  // plaquinha nova (ou que saiu): posiciona antes de pintar
  useLayoutEffect(() => {
    posicionar()
  }, [placaAVista, produtoPlaca, posicionar])

  const chamar = () => {
    const mo = montada.current
    if (!mo) return
    // no computador a rua é larga e no story em pé sobra altura: cabe a fala longa em duas linhas
    const c = mo.cena.chamar(story ? story.recorte.palco.emPe : k >= 3)
    mo.motor.marcar()
    if (!mo.motor.rodando) mo.motor.desenhar()
    if (story) {
      story.aoChamar(c, mo.motor.rodando || roda)
      return
    }
    cta.abrir()
    setAviso(avisoDoChamado(c, mo.motor.rodando))
  }

  /** O produto erguido no ponto (px da grade), com folga para o alvo ter 44 px; null se não tem produto ali. */
  const produtoEm = (gx: number, gy: number, folga: number): string | null => {
    const mo = montada.current
    const merc = mo?.motor.ator('mercador')
    const p = mo?.motor.mostrando
    if (!mo || !merc || !p || merc.item !== p.folha) return null
    const c = mo.motor.caixaDoItem(merc)
    if (!c) return null
    const fx = Math.max(0, folga - (c[2] - c[0]) / 2)
    const fy = Math.max(0, folga - (c[3] - c[1]) / 2)
    return gx >= c[0] - fx && gx < c[2] + fx && gy >= c[1] - fy && gy < c[3] + fy ? p.id : null
  }
  /** Abre a página do produto, o mesmo caminho do story de produto do Início. */
  const abrirProduto = (id: string) => useUI.getState().abrirPagina(id, 'hero')

  /**
   * Toque do story no miolo do quadro (px do cliente), fora do botão do mercador: no produto erguido, abre a página
   * dele; o cliente tocado reage se pode reagir agora (o mercador, pela folga dos 44 px, é chamado). Na foto (movimento
   * reduzido) ninguém reage (o toque passa o story), mas o produto dela abre.
   */
  const tocarEm = (x: number, y: number): string | null => {
    const mo = montada.current
    const c = tela.current
    if (!mo || !c) return null
    const r = c.getBoundingClientRect()
    const gx = (x - r.left) / mo.px
    const gy = (y - r.top) / mo.px
    const folga = 22 / mo.px
    const prod = produtoEm(gx, gy, 12 / mo.px)
    if (prod) {
      abrirProduto(prod)
      return 'produto'
    }
    if (reduz) return null
    if (mo.motor.quemEsta(gx, gy, folga)?.id === 'mercador') {
      chamar()
      return 'mercador'
    }
    // só quem reage na hora segura o story (ocupado, o toque passa)
    return mo.cena.tocar(gx, gy, folga, true)
  }
  const tocarRef = useRef(tocarEm)
  tocarRef.current = tocarEm
  useEffect(() => {
    if (!story) return
    const alca = story.alca
    alca.current = { tocar: (x, y) => tocarRef.current(x, y) }
    return () => {
      alca.current = null
    }
  }, [story])

  const tocarCena = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const mo = montada.current
    if (!mo || emStory) return
    const r = e.currentTarget.getBoundingClientRect()
    const gx = (e.clientX - r.left) / mo.px
    const gy = (e.clientY - r.top) / mo.px
    const prod = produtoEm(gx, gy, 12 / mo.px)
    if (prod) return abrirProduto(prod)
    if (reduz) return
    const quem = mo.cena.tocar(gx, gy, 22 / mo.px)
    if (quem === 'mercador') chamar()
  }

  /**
   * O botão do mercador cobre o corpo dele inteiro, com o braço erguido: o produto na palma fica em cima do botão. O
   * toque (ou o clique) no produto abre o produto; no resto do mercador (e no Enter do teclado), chama ele.
   */
  const clicarMercador = (e: React.MouseEvent<HTMLButtonElement>) => {
    const mo = montada.current
    const c = tela.current
    if (mo && c && e.detail > 0) {
      const r = c.getBoundingClientRect()
      const prod = produtoEm((e.clientX - r.left) / mo.px, (e.clientY - r.top) / mo.px, 0)
      if (prod) return abrirProduto(prod)
    }
    chamar()
  }

  const apontar = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const mo = montada.current
    if (!mo || e.pointerType !== 'mouse') return
    const r = e.currentTarget.getBoundingClientRect()
    const gx = (e.clientX - r.left) / mo.px
    const gy = (e.clientY - r.top) / mo.px
    const quem = mo.motor.quemEsta(gx, gy, 0)
    e.currentTarget.style.cursor = produtoEm(gx, gy, 0) || (quem && !reduz) ? 'pointer' : ''
  }

  const estado: EstadoRua = falhou ? 'falhou' : !pacote || !pintada ? 'carregando' : reduz ? 'foto' : roda ? 'rodando' : 'parada'
  const aoEstado = story?.aoEstado
  useEffect(() => {
    aoEstado?.(estado)
  }, [estado, aoEstado])

  if (falhou) return null

  return (
    <div
      ref={raiz}
      className={`rua${pacote && pintada ? ' pronta' : ''}${emStory ? ' rua-em-story' : ''}${className ? ` ${className}` : ''}`}
      role={emStory ? undefined : 'group'}
      aria-label={emStory ? undefined : 'A rua da loja'}
      data-rua={estado}
      data-vitrine={prontosNaLista.length}
    >
      <canvas ref={tela} className="rua-tela" aria-hidden="true" onClick={tocarCena} onPointerMove={apontar} />
      {/* a plaquinha do produto da vitrine: link de verdade (abre a página dele), antes do mercador na ordem do Tab (o
          "Ver o Mercado" continua logo depois do mercador); some quando ele guarda o produto e volta com o foco */}
      {produtoPlaca && (
        <a
          ref={placa}
          className={`rua-vitrine${placaAVista ? ' mostra' : ''}`}
          href={consultaDaVisita({ produto: produtoPlaca.id })}
          data-produto={produtoPlaca.id}
          draggable={false}
          onClick={(e) => {
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
            e.preventDefault()
            abrirProduto(produtoPlaca.id)
          }}
          onFocus={() => {
            // com o foco nela, o produto dela fica (o próximo erguido é o mesmo): o nome não troca debaixo do teclado
            vit.current.focada = true
            vit.current.atual = produtoPlaca.id
            posicionar()
          }}
          onBlur={() => {
            vit.current.focada = false
          }}
        >
          <span className="rua-vitrine-placa" key={`${produtoPlaca.id}-${placaAVista ? 1 : 0}`}>
            <span className="rua-vitrine-corpo">
              <span className="sr-only">Ver </span>
              <span className="rua-vitrine-nome">{produtoPlaca.nome}</span>
              <span className="sr-only">, </span>
              <span className="rua-vitrine-preco">
                {precoOuConsultar(produtoPlaca.preco)}
                <Icone nome="link" tamanho={16} />
              </span>
            </span>
            <span className="rua-vitrine-cauda" aria-hidden="true" />
          </span>
        </a>
      )}
      <div ref={camadaBaloes} className="rua-baloes" aria-hidden="true">
        {baloes.map((b) => (
          <p key={b.id} className="rua-balao" data-ator={b.ator}>
            <span className="rua-balao-corpo">{b.texto}</span>
          </p>
        ))}
      </div>
      {pacote && (
        <button ref={botaoMerc} type="button" className="rua-mercador" aria-label="Chamar o mercador" onClick={clicarMercador} />
      )}
      {!emStory && cta.visivel && (
        <a
          ref={cta.ref}
          className="adesivo-link toque rua-cta"
          href={hrefAba('catalogo')}
          onClick={(e) => {
            if (!cliqueDeAba(e)) return
            irParaAba('catalogo')
          }}
          onBlur={cta.esconder}
        >
          <Icone nome="link" tamanho={16} />
          Ver o Mercado
        </a>
      )}
      {!emStory && (
        <span className="sr-only" aria-live="polite">
          {cta.visivel ? aviso : ''}
        </span>
      )}
      {!emStory && pacote && !reduz && quadros == null && (
        <button type="button" className="rua-pausa" aria-label={pausada ? 'Continuar a rua' : 'Pausar a rua'} onClick={() => setPausada((p) => !p)}>
          <span className="rua-pausa-disco">
            <Icone nome={pausada ? 'play' : 'pausa'} tamanho={16} />
          </span>
        </button>
      )}
    </div>
  )
}

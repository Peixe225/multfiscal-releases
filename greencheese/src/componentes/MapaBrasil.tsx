import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { brasil, cidadesNoMapa, legenda, lupa, type MalhaPixel } from '../dados/mapa-brasil'
import { canalDa, ufsAtendidas } from '../dados/canais'
import { emUf, ufPorSigla } from '../dados/ufs'
import { movimentoReduzido } from '../lib/movimento'
import { Icone } from './comum'
import './MapaBrasil.css'

// Mapa do Brasil em pixel art, com o formato de verdade de cada estado (malha do IBGE, ver scripts/gerar-mapa-brasil.mjs).
// Estado atendido = aceso (cinza claro; o do cliente, branco); sem atendimento = pontinhos apagados.
// No modo "secao", uma lupa amplia o Sudeste + SC: lá cada atendido é um botão de verdade.
// Tudo é desenhado em células inteiras: o mapa com `m` px por célula e a lupa com `l` px (sempre inteiros, nítidos).

const atendidas = new Set<string>(ufsAtendidas)

/** Atendidos de cima para baixo no mapa (MG, ES, RJ, SP, SC): a ordem da lista e do acender. */
export const ordemAtendidos: string[] = [...ufsAtendidas].sort((a, b) => {
  const [ax, ay] = lupa.rotulos[a] ?? [0, 0]
  const [bx, by] = lupa.rotulos[b] ?? [0, 0]
  return ay - by || bx - ax
})

/* ───────────── geometria (calculada uma vez por grade) ───────────── */

type Tem = (i: number, j: number) => boolean

/** Junta células vizinhas em retângulos (corrida na linha, empilhada com a de baixo) e devolve um `d` de path. */
function caminho(w: number, h: number, tem: Tem, x0 = 0, y0 = 0): string {
  const partes: { x: number; y: number; w: number; h: number }[] = []
  let abertas = new Map<string, { x: number; y: number; w: number; h: number }>()
  for (let y = y0; y < h; y++) {
    const novas = new Map<string, { x: number; y: number; w: number; h: number }>()
    let x = x0
    while (x < w) {
      if (!tem(x, y)) {
        x++
        continue
      }
      let fim = x + 1
      while (fim < w && tem(fim, y)) fim++
      const chave = `${x}:${fim}`
      const acima = abertas.get(chave)
      if (acima) {
        acima.h++
        novas.set(chave, acima)
      } else {
        const r = { x, y, w: fim - x, h: 1 }
        partes.push(r)
        novas.set(chave, r)
      }
      x = fim
    }
    abertas = novas
  }
  return partes.map((r) => `M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}z`).join('')
}

interface Geometria {
  w: number
  h: number
  em: (i: number, j: number) => string | null
  /** Centro das células de terra encostadas no mar (para afastar a lupa do continente). */
  litoral: [number, number][]
  /** Células de cada estado. */
  celulas: Record<string, [number, number][]>
  todaTerra: string
  /** Células na divisa entre dois estados (só o lado de cima/esquerda, linha de 1 célula). */
  divisa: string
  /** Células encostadas no mar. */
  costa: string
  /** Divisa entre dois atendidos: linha preta que separa os acesos. */
  divisaAcesa: string
  porUf: Record<string, string>
}

const cacheGeo = new WeakMap<MalhaPixel, Geometria>()

function geometria(malha: MalhaPixel): Geometria {
  const pronta = cacheGeo.get(malha)
  if (pronta) return pronta
  const { w, h } = malha
  const grade = malha.linhas.map((l) => [...l].map((c) => legenda[c] ?? null))
  const em = (i: number, j: number) => grade[j]?.[i] ?? null
  const naCosta: Tem = (i, j) => !!em(i, j) && (!em(i + 1, j) || !em(i - 1, j) || !em(i, j + 1) || !em(i, j - 1))
  const litoral: [number, number][] = []
  const celulas: Record<string, [number, number][]> = {}
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const s = em(i, j)
      if (!s) continue
      ;(celulas[s] ??= []).push([i, j])
      if (naCosta(i, j)) litoral.push([i + 0.5, j + 0.5])
    }
  const outro = (s: string, v: string | null) => v !== null && v !== s
  const geo: Geometria = {
    w,
    h,
    em,
    litoral,
    celulas,
    todaTerra: caminho(w, h, (i, j) => !!em(i, j)),
    divisa: caminho(w, h, (i, j) => {
      const s = em(i, j)
      return !!s && (outro(s, em(i + 1, j)) || outro(s, em(i, j + 1)))
    }),
    costa: caminho(w, h, naCosta),
    divisaAcesa: caminho(w, h, (i, j) => {
      const s = em(i, j)
      if (!s || !atendidas.has(s)) return false
      const d = em(i + 1, j)
      const b = em(i, j + 1)
      return (!!d && d !== s && atendidas.has(d)) || (!!b && b !== s && atendidas.has(b))
    }),
    porUf: Object.fromEntries(Object.keys(celulas).map((s) => [s, caminho(w, h, (i, j) => em(i, j) === s)])),
  }
  cacheGeo.set(malha, geo)
  return geo
}

// Lupa: o círculo de terra tem raio 32 células; em volta, o aro branco (1 célula, sem furo nas diagonais),
// o contorno preto (1 célula) e o cabo saindo pra baixo e pra esquerda.
const R_LUPA = lupa.w / 2
const ANEL = 2.5
const CABO = { de: R_LUPA + 1, ate: R_LUPA + 12, grossura: 1.5 }
const SEN45 = Math.SQRT1_2

interface PecasLupa {
  disco: string
  aro: string
  cabo: string
  caboContorno: string
}

const viz8 = (i: number, j: number, f: Tem) => {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && f(i + dx, j + dy)) return true
  return false
}

let pecasLupa: PecasLupa | null = null
function pecas(): PecasLupa {
  if (pecasLupa) return pecasLupa
  const c = R_LUPA
  const dentro: Tem = (i, j) => Math.hypot(i + 0.5 - c, j + 0.5 - c) <= R_LUPA
  const aro: Tem = (i, j) => !dentro(i, j) && viz8(i, j, dentro)
  const contorno: Tem = (i, j) => !dentro(i, j) && !aro(i, j) && viz8(i, j, aro)
  const [ax, ay] = [c - CABO.de * SEN45, c + CABO.de * SEN45]
  const [bx, by] = [c - CABO.ate * SEN45, c + CABO.ate * SEN45]
  const cabo: Tem = (i, j) => {
    if (dentro(i, j)) return false
    const [px, py] = [i + 0.5, j + 0.5]
    const [vx, vy] = [bx - ax, by - ay]
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)))
    return Math.hypot(px - (ax + t * vx), py - (ay + t * vy)) <= CABO.grossura
  }
  const min = -16
  const max = lupa.w + 4
  const caixa = (tem: Tem) => caminho(max, max, tem, min, min)
  pecasLupa = {
    disco: caixa((i, j) => dentro(i, j) || aro(i, j) || contorno(i, j)),
    aro: caixa(aro),
    caboContorno: caixa((i, j) => !dentro(i, j) && !cabo(i, j) && viz8(i, j, cabo)),
    cabo: caixa(cabo),
  }
  return pecasLupa
}

/** Caixa (em células do mapa inteiro) dos estados atendidos: é o que a lupa amplia. */
const focoAtendidos = (() => {
  const g = geometria(brasil)
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const s of atendidas)
    for (const [i, j] of g.celulas[s] ?? []) {
      x0 = Math.min(x0, i)
      y0 = Math.min(y0, j)
      x1 = Math.max(x1, i + 1)
      y1 = Math.max(y1, j + 1)
    }
  // 2 células de folga em volta
  return { x0: x0 - 2, y0: y0 - 2, x1: x1 + 2, y1: y1 + 2 }
})()

/* ───────────── plano: tamanho das células e onde fica a lupa, pela largura disponível ───────────── */

export interface Plano {
  w: number
  h: number
  /** px por célula do mapa inteiro. */
  m: number
  /** px por célula da lupa (0 = sem lupa). */
  l: number
  /** Canto da lupa (célula 0,0 da grade dela) e raio total, em px. */
  lupa: { x: number; y: number; r: number } | null
}

function raioTotal(l: number) {
  return Math.ceil((R_LUPA + ANEL) * l)
}
// espaço livre entre o continente e a lupa (é por onde passam as linhas do zoom)
const folgaPx = (m: number) => Math.max(14, 5 * m)

/**
 * Onde pôr a lupa, sem cobrir terra: testa a lupa embaixo do mapa (o menor y para cada x) e ao lado (o menor x
 * para cada y), sempre do lado do mar (à direita do Sudeste, nunca embaixo do RS), e fica com a de menor nota:
 * altura do palco × distância até o Sudeste. A largura não entra na nota (a coluna é a mesma de qualquer jeito),
 * mas a distância segura a lupa perto do mapa: em tela larga ela não vai parar no canto, longe do Brasil.
 */
function lugarDaLupa(W: number, m: number, l: number, hMax: number) {
  const r = raioTotal(l)
  const f = r + folgaPx(m)
  const bw = brasil.w * m
  const bh = brasil.h * m
  const sx = ((focoAtendidos.x0 + focoAtendidos.x1) / 2) * m
  const sy = ((focoAtendidos.y0 + focoAtendidos.y1) / 2) * m
  const { litoral } = geometria(brasil)
  const opcoes: { cx: number; cy: number }[] = []
  for (let cx = Math.max(r, Math.ceil(sx)); cx <= W - r; cx += 2) {
    let cy = r
    for (const [i, j] of litoral) {
      const dx = Math.abs(i * m - cx)
      if (dx < f) cy = Math.max(cy, j * m + Math.sqrt(f * f - dx * dx))
    }
    opcoes.push({ cx, cy: Math.ceil(cy) })
  }
  for (let cy = r; cy <= bh; cy += 2) {
    let cx = r
    for (const [i, j] of litoral) {
      const dy = Math.abs(j * m - cy)
      if (dy < f) cx = Math.max(cx, i * m + Math.sqrt(f * f - dy * dy))
    }
    cx = Math.ceil(cx)
    if (cx >= sx && cx + r <= W) opcoes.push({ cx, cy })
  }
  let melhor: { cx: number; cy: number; w: number; h: number } | null = null
  let nota = Infinity
  for (const p of opcoes) {
    const h = Math.max(bh, p.cy + r)
    if (h > hMax) continue
    const n = h * (1 + Math.hypot(p.cx - sx, p.cy - sy) / r)
    if (n < nota) {
      nota = n
      melhor = { ...p, w: Math.max(bw, p.cx + r), h }
    }
  }
  return melhor
}

/**
 * O palco nunca passa da largura disponível (escala inteira: nada de SVG encolhido e borrado, pino no lugar)
 * e cabe na altura da tela (celular deitado).
 */
export function planejar(W: number, comLupa: boolean, mMax = 4, altoTela = Infinity): Plano {
  const semLupa = (mm: number): Plano => {
    const m = Math.max(1, Math.min(mm, Math.floor(W / brasil.w)))
    return { w: brasil.w * m, h: brasil.h * m, m, l: 0, lupa: null }
  }
  if (!comLupa) return semLupa(mMax)
  // preferência (a primeira que cabe): Brasil e lupa maiores na tela larga; no celular, Brasil menor e lupa
  // grande (zoom de ~3×, siglas legíveis). Na largura de computador o palco não passa de ~640 px de altura
  // (a altura da lista de perfis ao lado); no celular pode ser mais alto que largo.
  const hMax = Math.min(W >= 560 ? Math.max(0.85 * W, 640) : 1.7 * W, Math.max(340, altoTela * 0.9))
  const candidatos: [number, number][] = [
    [5, 6],
    [4, 5],
    [3, 5],
    [3, 4],
    [2, 4],
    [2, 3],
  ]
  for (const [m, l] of candidatos) {
    if (W < 440 ? m > 2 : W < 560 ? m > 3 : false) continue
    if (brasil.w * m > W || 2 * raioTotal(l) > W) continue
    const pos = lugarDaLupa(W, m, l, hMax)
    if (!pos) continue
    return { w: pos.w, h: pos.h, m, l, lupa: { x: pos.cx - R_LUPA * l, y: pos.cy - R_LUPA * l, r: raioTotal(l) } }
  }
  return semLupa(2)
}

/**
 * Moldura de foco (cantos em L) em volta dos atendidos e as duas linhas pontilhadas do zoom até a lupa, em células
 * do mapa. As linhas saem das quinas da moldura que ficam do lado da lupa (lupa à direita: as duas da direita;
 * embaixo: as duas de baixo; na diagonal: as da silhueta) e vão inteiras até a lupa, por cima da terra também.
 */
function zoom(plano: Plano): { cantos: string; linhas: string } | null {
  if (!plano.lupa) return null
  const { m, l } = plano
  const { x0, y0, x1, y1 } = focoAtendidos
  const braco = 3
  const cantos =
    `M${x0} ${y0}h${braco}v1h${1 - braco}v${braco - 1}h-1z` +
    `M${x1 - braco} ${y0}h${braco}v${braco}h-1v${1 - braco}h${1 - braco}z` +
    `M${x0} ${y1 - braco}h1v${braco - 1}h${braco - 1}v1h${-braco}z` +
    `M${x1 - 1} ${y1 - braco}h1v${braco}h${-braco}v-1h${braco - 1}z`
  // lupa em células do mapa
  const cx = (plano.lupa.x + R_LUPA * l) / m
  const cy = (plano.lupa.y + R_LUPA * l) / m
  const r = ((R_LUPA + 1) * l) / m
  const rFora = plano.lupa.r / m
  const mx = (x0 + x1) / 2
  const my = (y0 + y1) / 2
  const dist = Math.hypot(cx - mx, cy - my)
  if (dist <= r + 4) return { cantos, linhas: '' }
  const [dx, dy] = [(cx - mx) / dist, (cy - my) / dist]
  const [nx, ny] = [-dy, dx]
  const lado = (p: [number, number]) => (p[0] - mx) * nx + (p[1] - my) * ny
  let quinas: [number, number][]
  if (Math.abs(dx) >= 2 * Math.abs(dy)) {
    const x = dx > 0 ? x1 : x0
    quinas = [
      [x, y0],
      [x, y1],
    ]
  } else if (Math.abs(dy) >= 2 * Math.abs(dx)) {
    const y = dy > 0 ? y1 : y0
    quinas = [
      [x0, y],
      [x1, y],
    ]
  } else {
    const todas: [number, number][] = [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ]
    quinas = [todas.reduce((u, v) => (lado(v) > lado(u) ? v : u)), todas.reduce((u, v) => (lado(v) < lado(u) ? v : u))]
  }
  // tangente do ponto P ao círculo, do lado `sinal` da linha dos centros
  const tangente = (p: [number, number], sinal: number): [number, number] => {
    const d = Math.hypot(p[0] - cx, p[1] - cy)
    const base = Math.atan2(p[1] - cy, p[0] - cx)
    const phi = Math.acos(Math.min(1, r / d))
    const cands = [base + phi, base - phi].map((t) => [cx + r * Math.cos(t), cy + r * Math.sin(t)] as [number, number])
    return cands.reduce((u, v) => (sinal * ((v[0] - cx) * nx + (v[1] - cy) * ny) > sinal * ((u[0] - cx) * nx + (u[1] - cy) * ny) ? v : u))
  }
  const pontos = new Set<string>()
  for (const p of quinas) {
    if (Math.hypot(p[0] - cx, p[1] - cy) <= rFora) continue
    const t = tangente(p, lado(p) >= 0 ? 1 : -1)
    const passos = Math.ceil(Math.max(Math.abs(t[0] - p[0]), Math.abs(t[1] - p[1])))
    for (let k = 1; k < passos; k += 2) {
      const i = Math.floor(p[0] + ((t[0] - p[0]) * k) / passos)
      const j = Math.floor(p[1] + ((t[1] - p[1]) * k) / passos)
      // fora da moldura e fora da lupa
      if (Math.hypot(i + 0.5 - cx, j + 0.5 - cy) < rFora) continue
      if (i >= x0 && i < x1 && j >= y0 && j < y1) continue
      pontos.add(`${i},${j}`)
    }
  }
  const linhas = [...pontos].map((k) => {
    const [i, j] = k.split(',')
    return `M${i} ${j}h1v1h-1z`
  })
  return { cantos, linhas: linhas.join('') }
}

/* ───────────── componente ───────────── */

interface Props {
  /** UF do cliente (sigla minúscula): ganha o pino. */
  atual: string | null
  /** "secao" = mapa + lupa (Por estado); "compacto" = só o mapa (sem atendimento, seletor). */
  modo?: 'secao' | 'compacto'
  /** Toque num estado (no mapa ou na lupa), com a sigla minúscula. */
  aoTocar?: (sigla: string) => void
  /** Acende os atendidos um a um quando o mapa entra na tela. */
  acender?: boolean
  /** UF realçada de fora (linha da lista com o mouse ou o foco). */
  realce?: string | null
  /** Balão em cima do estado tocado (ex.: "ainda não chegou"). */
  balao?: { uf: string; conteudo: ReactNode } | null
  /** Fecha o balão (Esc, toque fora dele ou no mar). Com o foco dentro do balão, ele volta para o mapa. */
  aoFecharBalao?: () => void
  /** Tamanho máximo da célula do mapa inteiro no modo compacto, em px. */
  celulaMax?: number
  className?: string
}

const NOME = (s: string) => ufPorSigla(s)?.nome ?? s.toUpperCase()

/** Folha, story ou página de produto por cima: o Esc e o toque fora são dela, não do balão. */
const camadaPorCima = () => !!document.querySelector('.folha:not(.folha-saindo), .story, .pp:not(.pp-saindo)')

export function MapaBrasil({
  atual,
  modo = 'compacto',
  aoTocar,
  acender = false,
  realce = null,
  balao = null,
  aoFecharBalao,
  celulaMax = 4,
  className,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const palcoRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const aoClicar = useRef<(e: { clientX: number; clientY: number }) => void>(() => {})
  const fecharBalao = useRef(aoFecharBalao)
  fecharBalao.current = aoFecharBalao
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [largura, setLargura] = useState(0)
  const [altoTela, setAltoTela] = useState(() => window.innerHeight)
  const [sobre, setSobre] = useState<string | null>(null)
  // o mouse está na lupa? (a dica do nome sai no rótulo da lupa, não no mapa inteiro)
  const [sobreLupa, setSobreLupa] = useState(false)
  const [toque, setToque] = useState<{ x: number; y: number } | null>(null)
  // antes de entrar na tela os atendidos ficam apagados (só com movimento e com acender)
  const [fase, setFase] = useState<'apagado' | 'acendendo' | 'aceso'>(() => (acender && !movimentoReduzido() ? 'apagado' : 'aceso'))

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setLargura(el.clientWidth)
    const ro = new ResizeObserver(() => setLargura(el.clientWidth))
    ro.observe(el)
    const tela = () => setAltoTela(window.innerHeight)
    window.addEventListener('resize', tela)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', tela)
    }
  }, [])

  const plano = useMemo(() => (largura ? planejar(largura, modo === 'secao', celulaMax, altoTela) : null), [largura, modo, celulaMax, altoTela])
  const linhasZoom = useMemo(() => (plano ? zoom(plano) : null), [plano])

  useEffect(() => {
    const el = palcoRef.current
    if (fase !== 'apagado' || !el) return
    const io = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting)) return
        io.disconnect()
        setFase('acendendo')
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [fase, plano])

  useEffect(() => {
    if (fase !== 'acendendo') return
    const t = window.setTimeout(() => setFase('aceso'), ordemAtendidos.length * 180 + 900)
    return () => window.clearTimeout(t)
  }, [fase])

  // Toque no mapa: ouvinte nativo no próprio SVG. Sem ele, o ajuste de toque do Chrome no celular desvia
  // o toque num estado (ex.: PR) para o botão da lupa mais perto (SP), porque o palco contém os botões.
  const temPlano = !!plano
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const f = (e: MouseEvent) => aoClicar.current(e)
    el.addEventListener('click', f)
    return () => el.removeEventListener('click', f)
  }, [temPlano])

  // balão aberto: Esc fecha, e tocar fora do mapa também (a não ser que uma folha esteja por cima: aí é dela)
  const temBalao = !!balao
  useEffect(() => {
    if (!temBalao) return
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || camadaPorCima()) return
      fecharBalao.current?.()
    }
    const fora = (e: globalThis.PointerEvent) => {
      if (camadaPorCima() || (e.target instanceof Node && palcoRef.current?.contains(e.target))) return
      fecharBalao.current?.()
    }
    document.addEventListener('keydown', tecla)
    document.addEventListener('pointerdown', fora)
    return () => {
      document.removeEventListener('keydown', tecla)
      document.removeEventListener('pointerdown', fora)
    }
  }, [temBalao])

  const canal = canalDa(atual)
  const cidade = canal?.cidades.length === 1 ? cidadesNoMapa[canal.cidades[0].slug] : undefined

  // o foco que estava no balão volta para o mapa: tabindex só enquanto ele tiver o foco (com tabindex fixo, o
  // clique no mapa também o focaria e o Chrome desenharia o contorno em volta do palco inteiro)
  const focarMapa = () => {
    const svg = svgRef.current
    if (!svg) return
    svg.setAttribute('tabindex', '-1')
    svg.addEventListener('blur', () => svg.removeAttribute('tabindex'), { once: true })
    svg.focus({ preventScroll: true })
  }

  const geoB = geometria(brasil)
  const geoL = geometria(lupa)

  if (!plano) return <div ref={ref} className={`mbr mbr-${modo} ${className ?? ''}`} />

  const { m, l } = plano
  const lx = plano.lupa?.x ?? 0
  const ly = plano.lupa?.y ?? 0
  const atendidoAtual = !!atual && atendidas.has(atual)
  const destaque = sobre ?? realce

  // a lupa fica por cima do mapa: o ponto está nela?
  const naLupa = (x: number, y: number) => !!plano.lupa && Math.hypot(x - (lx + R_LUPA * l), y - (ly + R_LUPA * l)) <= plano.lupa.r
  // em que estado caiu o ponteiro
  const estadoEm = (x: number, y: number): string | null => {
    if (naLupa(x, y)) return Math.hypot(x - (lx + R_LUPA * l), y - (ly + R_LUPA * l)) <= R_LUPA * l ? geoL.em(Math.floor((x - lx) / l), Math.floor((y - ly) / l)) : null
    return geoB.em(Math.floor(x / m), Math.floor(y / m))
  }
  const local = (e: { clientX: number; clientY: number }) => {
    const r = palcoRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const mover = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return
    const { x, y } = local(e)
    const s = estadoEm(x, y)
    if (s !== sobre) setSobre(s)
    const l2 = naLupa(x, y)
    if (l2 !== sobreLupa) setSobreLupa(l2)
  }
  aoClicar.current = (e) => {
    const p = local(e)
    const s = estadoEm(p.x, p.y)
    // tocar no mar fecha o balão
    if (!s) {
      if (balao) aoFecharBalao?.()
      return
    }
    if (!aoTocar) return
    setToque(p)
    aoTocar(s)
  }

  // pino: na lupa, o estado atendido do cliente vira o adesivo de localização (na sigla); no mapa inteiro nos outros casos
  const pinoNaLupa = !!plano.lupa && atendidoAtual
  const pontoB = atual ? (cidade?.brasil ?? brasil.rotulos[atual]) : undefined

  const rotuloMapa = `Mapa do Brasil. A Green Cheese entrega em ${ordemAtendidos.map(NOME).join(', ').replace(/, ([^,]*)$/, ' e $1')}.${
    atual && !atendidoAtual && ufPorSigla(atual) ? ` Tu tá ${emUf(atual)}, onde ainda não chegou.` : ''
  }`

  const estilo = { width: plano.w, height: plano.h, ['--n' as string]: ordemAtendidos.length } as CSSProperties
  // função (não componente): o React não remonta as camadas a cada render (a animação do acender recomeçaria do zero)
  const camadas = (geo: Geometria, p: string) => (
    <>
      <path d={geo.todaTerra} fill={`url(#${p}-escuro)`} />
      <path d={geo.divisa} fill={`url(#${p}-medio)`} />
      <path d={geo.costa} fill={`url(#${p}-claro)`} />
      {/* estado do cliente sem atendimento ou estado com o mouse em cima: pontinhos mais claros */}
      {Object.keys(geo.porUf)
        .filter((s) => !atendidas.has(s) && (s === destaque || s === atual || s === balao?.uf))
        .map((s) => (
          <path key={s} d={geo.porUf[s]} fill={`url(#${p}-realce)`} className={`mbr-apagado-realce ${s === balao?.uf ? 'chiando' : ''}`} />
        ))}
      {ordemAtendidos
        .filter((s) => geo.porUf[s])
        .map((s, k) => (
          <path
            key={s}
            d={geo.porUf[s]}
            className={`mbr-luz ${s === atual ? 'atual' : ''} ${s === destaque ? 'realce' : ''}`}
            style={{ ['--i' as string]: k }}
          />
        ))}
      <path d={geo.divisaAcesa} className="mbr-divisa" />
    </>
  )
  const padroes = (p: string, s: number) => {
    const t = (s - 1) / s
    return (['escuro', 'medio', 'claro', 'realce'] as const).map((tom) => (
      <pattern key={tom} id={`${p}-${tom}`} width="1" height="1" patternUnits="userSpaceOnUse">
        <rect width={t} height={t} className={`mbr-ponto-${tom}`} />
      </pattern>
    ))
  }
  const pl = pecas()
  const vizinhos = plano.lupa
    ? Object.entries(lupa.rotulos).filter(([s, [x, y]]) => !atendidas.has(s) && Math.hypot(x - R_LUPA, y - R_LUPA) < R_LUPA - 3)
    : []

  return (
    <div ref={ref} className={`mbr mbr-${modo} mbr-${fase} ${className ?? ''}`}>
      <div
        ref={palcoRef}
        className={`mbr-palco ${sobre && aoTocar ? 'tocavel' : ''}`}
        style={estilo}
        onPointerMove={mover}
        onPointerLeave={() => setSobre(null)}
      >
        <svg
          ref={svgRef}
          className="mbr-svg"
          width={plano.w}
          height={plano.h}
          viewBox={`0 0 ${plano.w} ${plano.h}`}
          shapeRendering="crispEdges"
          role="img"
          aria-label={rotuloMapa}
        >
          <defs>
            {padroes(`${id}m`, m)}
            {plano.lupa && padroes(`${id}l`, l)}
          </defs>
          <g transform={`scale(${m})`}>
            {camadas(geoB, `${id}m`)}
            {linhasZoom && (
              <>
                <path d={linhasZoom.linhas} className="mbr-zoom-linha" />
                <path d={linhasZoom.cantos} className="mbr-zoom-canto" />
              </>
            )}
          </g>
          {plano.lupa && (
            <g transform={`translate(${lx} ${ly}) scale(${l})`} className="mbr-lupa">
              <path d={pl.caboContorno} className="mbr-preto" />
              <path d={pl.disco} className="mbr-preto" />
              {camadas(geoL, `${id}l`)}
              <path d={pl.aro} className="mbr-aro" />
              <path d={pl.cabo} className="mbr-aro" />
            </g>
          )}
        </svg>

        {/* siglas dos vizinhos na lupa (PR entre SP e SC…): só leitura */}
        {vizinhos.map(([s, [x, y]]) => (
          <span key={s} className="mbr-vizinho px" style={{ left: lx + x * l, top: ly + y * l }} aria-hidden="true">
            {s.toUpperCase()}
          </span>
        ))}

        {/* os atendidos na lupa: botões de verdade, alvo de 44 px na sigla. O do cliente vira o adesivo de localização
            do site em miniatura (pino + "RJ"): do tamanho da sigla, não cobre a faixa fina do RJ ou do ES nem a sigla vizinha */}
        {plano.lupa && (
          <div className="mbr-botoes" role="group" aria-label="Lupa no Sudeste e em Santa Catarina">
            {ordemAtendidos.map((s) => {
              const eh = s === atual
              const c = canalDa(s)
              const [x, y] = lupa.rotulos[s]
              const cidades = c?.cidades.length ? c.cidades.map((z) => z.nome).join(', ') : 'cidade a confirmar'
              return (
                <button
                  key={s}
                  type="button"
                  className={`mbr-uf toque ${eh ? 'atual' : ''} ${destaque === s ? 'realce' : ''}`}
                  style={{ left: lx + x * l, top: ly + y * l }}
                  onClick={() => aoTocar?.(s)}
                  onMouseEnter={() => setSobre(s)}
                  onFocus={() => setSobre(s)}
                  onBlur={() => setSobre(null)}
                  // a sigla visível vem primeiro no nome (rótulo no nome, WCAG 2.5.3): "SP, São Paulo: …"
                  aria-label={`${s.toUpperCase()}, ${NOME(s)}: ${cidades}${eh ? ', teu atendimento' : ''}`}
                  aria-current={eh ? 'true' : undefined}
                >
                  <span className="mbr-sigla px">
                    {eh && <Icone nome="pin" tamanho={12} className="mbr-sigla-pin" />}
                    {s.toUpperCase()}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* pino no mapa inteiro */}
        {atual && pontoB && !pinoNaLupa && (
          <span key={atual} className="mbr-pino" style={{ left: pontoB[0] * m, top: pontoB[1] * m }} aria-hidden="true">
            <Icone nome="pin" tamanho={16} />
          </span>
        )}

        {/* nome do estado com o mouse em cima (os atendidos da lupa já têm a sigla e o botão) */}
        {sobre && !balao && !(plano.lupa && atendidas.has(sobre)) && (() => {
          const ponto: [number, number] | undefined =
            sobreLupa && lupa.rotulos[sobre]
              ? [lx + lupa.rotulos[sobre][0] * l, ly + lupa.rotulos[sobre][1] * l]
              : brasil.rotulos[sobre] && [brasil.rotulos[sobre][0] * m, brasil.rotulos[sobre][1] * m]
          return ponto ? (
            <Dica key={sobre} ponto={ponto} larguraPalco={plano.w}>
              {NOME(sobre)}
              <span className="legenda">{atendidas.has(sobre) ? ' · tem Green Cheese' : ' · ainda não chegou'}</span>
            </Dica>
          ) : null
        })()}

        {balao && (
          <Balao
            larguraPalco={plano.w}
            alturaPalco={plano.h}
            ponto={toque ?? (brasil.rotulos[balao.uf] ? { x: brasil.rotulos[balao.uf][0] * m, y: brasil.rotulos[balao.uf][1] * m } : { x: plano.w / 2, y: plano.h / 2 })}
            aoSairComFoco={focarMapa}
          >
            {balao.conteudo}
          </Balao>
        )}
      </div>
    </div>
  )
}

/** Nome do estado com o mouse em cima: centrado no ponto, mas sem sair do palco (nem por baixo da barra lateral). */
function Dica({ ponto, larguraPalco, children }: { ponto: [number, number]; larguraPalco: number; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    // mais larga que o palco (mapa compacto): centrada no palco
    const left = w >= larguraPalco ? (larguraPalco - w) / 2 : Math.max(0, Math.min(larguraPalco - w, ponto[0] - w / 2))
    // perto do topo (Roraima, Amapá) ela desce para baixo do ponto
    const top = ponto[1] - h - 10 < 0 ? ponto[1] + 12 : ponto[1] - h - 10
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }))
  }, [ponto, larguraPalco])
  return (
    <span ref={ref} className="mbr-dica" style={pos ?? { left: 0, top: 0, visibility: 'hidden' }} aria-hidden="true">
      {children}
    </span>
  )
}

/**
 * Balão de fala apontando para o ponto tocado, sem sair do palco: abre embaixo do ponto e, perto da base do
 * palco (o RS na lupa), abre em cima, com o bico embaixo. Se o foco estiver nele quando fechar, o foco vai para o mapa.
 */
function Balao({
  ponto,
  larguraPalco,
  alturaPalco,
  aoSairComFoco,
  children,
}: {
  ponto: { x: number; y: number }
  larguraPalco: number
  alturaPalco: number
  aoSairComFoco: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const sair = useRef(aoSairComFoco)
  sair.current = aoSairComFoco
  const [pos, setPos] = useState<{ top: number; cima: boolean } | null>(null)
  const larg = Math.min(250, larguraPalco)
  const left = Math.max(0, Math.min(larguraPalco - larg, ponto.x - larg / 2))

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const h = el.offsetHeight
    const embaixo = ponto.y + 12
    let top = embaixo
    let cima = false
    if (embaixo + h > alturaPalco) {
      if (ponto.y - 12 - h >= 0) {
        top = ponto.y - 12 - h
        cima = true
      } else top = Math.max(0, alturaPalco - h)
    }
    setPos((p) => (p && p.top === top && p.cima === cima ? p : { top, cima }))
  })

  // a limpeza do efeito roda com o balão ainda na página: dá para saber se o foco estava nele
  useLayoutEffect(
    () => () => {
      if (ref.current?.contains(document.activeElement)) sair.current()
    },
    [],
  )

  return (
    <div
      ref={ref}
      className={`mbr-balao ${pos?.cima ? 'cima' : ''}`}
      style={{
        left,
        top: pos?.top ?? ponto.y + 12,
        width: larg,
        visibility: pos ? undefined : 'hidden',
        ['--bico' as string]: `${Math.max(14, Math.min(larg - 14, ponto.x - left))}px`,
      }}
    >
      {children}
    </div>
  )
}

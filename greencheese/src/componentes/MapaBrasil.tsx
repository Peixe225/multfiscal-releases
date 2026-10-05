import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { brasil, cidadesNoMapa, legenda, lupa, type MalhaPixel } from '../dados/mapa-brasil'
import { canalDa, ufsAtendidas } from '../dados/canais'
import { emUf, ufPorSigla } from '../dados/ufs'
import { movimentoReduzido } from '../lib/movimento'
import { Icone } from './comum'
import { AdesivoLocal } from './Local'
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
  /** Centro das células de terra (para afastar a lupa do continente). */
  terra: [number, number][]
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
  const terra: [number, number][] = []
  const siglas = new Set<string>()
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const s = em(i, j)
      if (!s) continue
      terra.push([i + 0.5, j + 0.5])
      siglas.add(s)
    }
  const outro = (s: string, v: string | null) => v !== null && v !== s
  const geo: Geometria = {
    w,
    h,
    em,
    terra,
    todaTerra: caminho(w, h, (i, j) => !!em(i, j)),
    divisa: caminho(w, h, (i, j) => {
      const s = em(i, j)
      return !!s && (outro(s, em(i + 1, j)) || outro(s, em(i, j + 1)))
    }),
    costa: caminho(w, h, (i, j) => !!em(i, j) && (!em(i + 1, j) || !em(i - 1, j) || !em(i, j + 1) || !em(i, j - 1))),
    divisaAcesa: caminho(w, h, (i, j) => {
      const s = em(i, j)
      if (!s || !atendidas.has(s)) return false
      const d = em(i + 1, j)
      const b = em(i, j + 1)
      return (!!d && d !== s && atendidas.has(d)) || (!!b && b !== s && atendidas.has(b))
    }),
    porUf: Object.fromEntries([...siglas].map((s) => [s, caminho(w, h, (i, j) => em(i, j) === s)])),
  }
  cacheGeo.set(malha, geo)
  return geo
}

// Lupa: o círculo de terra tem raio 32 células; em volta, o aro branco (1 célula, sem furo nas diagonais),
// o contorno preto (1 célula) e o cabo saindo pra baixo e pra esquerda (o lado livre embaixo do mapa).
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
  for (let j = 0; j < g.h; j++)
    for (let i = 0; i < g.w; i++) {
      const s = g.em(i, j)
      if (!s || !atendidas.has(s)) continue
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

/** Lupa abaixo do mapa, encostada à direita, sem cobrir terra. */
function lupaEmbaixo(W: number, m: number, l: number) {
  const r = raioTotal(l)
  const cx = W - r
  const folga = r + folgaPx(m)
  let cy = r
  for (const [i, j] of geometria(brasil).terra) {
    const dx = Math.abs(i * m - cx)
    if (dx < folga) cy = Math.max(cy, j * m + Math.sqrt(folga * folga - dx * dx))
  }
  return { cx, cy: Math.ceil(cy), r }
}

/** Lupa ao lado do mapa, na altura do Sudeste, sem cobrir terra. */
function lupaAoLado(W: number, m: number, l: number) {
  const r = raioTotal(l)
  const cy = Math.max(r, Math.round(lupa.noBrasil.cy * m))
  const folga = r + folgaPx(m)
  let cx = r
  for (const [i, j] of geometria(brasil).terra) {
    const dy = Math.abs(j * m - cy)
    if (dy < folga) cx = Math.max(cx, i * m + Math.sqrt(folga * folga - dy * dy))
  }
  cx = Math.ceil(cx)
  return cx + r <= W ? { cx, cy, r } : null
}

export function planejar(W: number, comLupa: boolean, mMax = 4): Plano {
  const mapa = (m: number) => ({ w: brasil.w * m, h: brasil.h * m })
  if (!comLupa) {
    const m = Math.max(1, Math.min(mMax, Math.floor(W / brasil.w)))
    return { ...mapa(m), m, l: 0, lupa: null }
  }
  // preferência por largura (a primeira que cabe): no desktop, Brasil maior e lupa grande, na altura da lista de perfis;
  // no celular, Brasil menor e lupa grande (zoom de ~3×, siglas legíveis)
  const candidatos: [number, number][] = [
    [4, 5],
    [3, 5],
    [3, 4],
    [2, 4],
    [2, 3],
  ].filter(([m]) => (W >= 560 ? true : W >= 440 ? m <= 3 : m <= 2)) as [number, number][]
  for (const [m, l] of candidatos) {
    const base = mapa(m)
    if (base.w > W || 2 * raioTotal(l) > W) continue
    const lado = lupaAoLado(W, m, l)
    const baixo = lupaEmbaixo(W, m, l)
    const pos = lado && lado.cy + lado.r <= baixo.cy + baixo.r ? lado : baixo
    return {
      w: Math.max(base.w, pos.cx + pos.r),
      h: Math.max(base.h, pos.cy + pos.r),
      m,
      l,
      lupa: { x: pos.cx - R_LUPA * l, y: pos.cy - R_LUPA * l, r: pos.r },
    }
  }
  return { ...mapa(2), m: 2, l: 0, lupa: null }
}

/** Moldura de foco (cantos em L) em volta dos atendidos e as duas linhas pontilhadas do zoom até a lupa, em células do mapa. */
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
  const quinas: [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ]
  const lado = (p: [number, number]) => (p[0] - mx) * nx + (p[1] - my) * ny
  const a = quinas.reduce((u, v) => (lado(v) > lado(u) ? v : u))
  const b = quinas.reduce((u, v) => (lado(v) < lado(u) ? v : u))
  // tangente do ponto P ao círculo, do lado `sinal` da linha dos centros
  const tangente = (p: [number, number], sinal: number): [number, number] => {
    const d = Math.hypot(p[0] - cx, p[1] - cy)
    const base = Math.atan2(p[1] - cy, p[0] - cx)
    const phi = Math.acos(Math.min(1, r / d))
    const cands = [base + phi, base - phi].map((t) => [cx + r * Math.cos(t), cy + r * Math.sin(t)] as [number, number])
    return cands.reduce((u, v) => (sinal * ((v[0] - cx) * nx + (v[1] - cy) * ny) > sinal * ((u[0] - cx) * nx + (u[1] - cy) * ny) ? v : u))
  }
  const geo = geometria(brasil)
  const pontos = new Set<string>()
  for (const [p, sinal] of [
    [a, 1],
    [b, -1],
  ] as const) {
    const t = tangente(p, sinal)
    const passos = Math.ceil(Math.max(Math.abs(t[0] - p[0]), Math.abs(t[1] - p[1])))
    for (let k = 1; k < passos; k += 2) {
      const i = Math.floor(p[0] + ((t[0] - p[0]) * k) / passos)
      const j = Math.floor(p[1] + ((t[1] - p[1]) * k) / passos)
      // pontilhado só no mar, fora da moldura e fora da lupa
      if (geo.em(i, j) || Math.hypot(i + 0.5 - cx, j + 0.5 - cy) < rFora) continue
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
  /** Texto do adesivo de localização no estado do cliente (cidade ou estado). */
  textoPino?: string | null
  /** Tamanho máximo da célula do mapa inteiro no modo compacto, em px. */
  celulaMax?: number
  className?: string
}

const NOME = (s: string) => ufPorSigla(s)?.nome ?? s.toUpperCase()

export function MapaBrasil({ atual, modo = 'compacto', aoTocar, acender = false, realce = null, balao = null, textoPino = null, celulaMax = 4, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const palcoRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const aoClicar = useRef<(e: { clientX: number; clientY: number }) => void>(() => {})
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [largura, setLargura] = useState(0)
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
    return () => ro.disconnect()
  }, [])

  const plano = useMemo(() => (largura ? planejar(largura, modo === 'secao', celulaMax) : null), [largura, modo, celulaMax])
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

  const geoB = geometria(brasil)
  const geoL = geometria(lupa)

  if (!plano) return <div ref={ref} className={`mbr mbr-${modo} ${className ?? ''}`} />

  const { m, l } = plano
  const lx = plano.lupa?.x ?? 0
  const ly = plano.lupa?.y ?? 0
  const atendidoAtual = !!atual && atendidas.has(atual)
  const destaque = sobre ?? realce
  const canal = canalDa(atual)
  const cidade = canal?.cidades.length === 1 ? cidadesNoMapa[canal.cidades[0].slug] : undefined

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
    if (!aoTocar) return
    const p = local(e)
    const s = estadoEm(p.x, p.y)
    if (!s) return
    setToque(p)
    aoTocar(s)
  }

  // pino: na lupa quando o estado do cliente é atendido; no mapa inteiro nos outros casos
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
        <svg ref={svgRef} className="mbr-svg" width={plano.w} height={plano.h} viewBox={`0 0 ${plano.w} ${plano.h}`} shapeRendering="crispEdges" role="img" aria-label={rotuloMapa}>
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

        {/* os atendidos na lupa: botões de verdade */}
        {plano.lupa && (
          <div className="mbr-botoes" role="group" aria-label="Lupa no Sudeste e em Santa Catarina">
            {ordemAtendidos.map((s) => {
              const eh = s === atual
              const c = canalDa(s)
              const cid = eh && c?.cidades.length === 1 ? cidadesNoMapa[c.cidades[0].slug] : undefined
              const [x, y] = cid?.lupa ?? lupa.rotulos[s]
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
                  aria-label={`${NOME(s)}: ${cidades}${eh ? ', teu atendimento' : ''}`}
                  aria-current={eh ? 'true' : undefined}
                >
                  {eh && textoPino && pinoNaLupa ? (
                    <span className="mbr-pino-lupa">
                      <AdesivoLocal texto={textoPino} tamanho="p" inclinacao={-4} />
                    </span>
                  ) : (
                    <span className="mbr-sigla px">{s.toUpperCase()}</span>
                  )}
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
          const ponto = sobreLupa && lupa.rotulos[sobre] ? [lx + lupa.rotulos[sobre][0] * l, ly + lupa.rotulos[sobre][1] * l] : brasil.rotulos[sobre] && [brasil.rotulos[sobre][0] * m, brasil.rotulos[sobre][1] * m]
          return ponto ? (
            <span className="mbr-dica" style={{ left: ponto[0], top: ponto[1] }} aria-hidden="true">
              {NOME(sobre)}
              <span className="legenda">{atendidas.has(sobre) ? ' · tem Green Cheese' : ' · ainda não chegou'}</span>
            </span>
          ) : null
        })()}

        {balao && (
          <Balao
            larguraPalco={plano.w}
            ponto={toque ?? (brasil.rotulos[balao.uf] ? { x: brasil.rotulos[balao.uf][0] * m, y: brasil.rotulos[balao.uf][1] * m } : { x: plano.w / 2, y: plano.h / 2 })}
          >
            {balao.conteudo}
          </Balao>
        )}
      </div>
    </div>
  )
}

/** Balão de fala apontando para o ponto tocado, sem sair do palco. */
function Balao({ ponto, larguraPalco, children }: { ponto: { x: number; y: number }; larguraPalco: number; children: ReactNode }) {
  const larg = Math.min(250, larguraPalco)
  const left = Math.max(0, Math.min(larguraPalco - larg, ponto.x - larg / 2))
  return (
    <div className="mbr-balao" style={{ left, top: ponto.y + 12, width: larg, ['--bico' as string]: `${Math.max(14, Math.min(larg - 14, ponto.x - left))}px` }}>
      {children}
    </div>
  )
}

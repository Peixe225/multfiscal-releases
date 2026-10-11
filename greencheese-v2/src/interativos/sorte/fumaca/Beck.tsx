// O beck bolado (volta do 3c9b2bd, redesenhado pra queimar): tubo de seda cônico, ponta torcida em cima e piteira de
// papel cru embaixo, no estilo "realista" do dichavador (gradientes de cilindro, fibra do papel). viewBox 0 0 60 240.
// Agora ele acende (pedido do Ian em 11/10): a torcida queima com um "pop", a brasa acende na linha de queima, o papel
// queima de cima pra baixo e deixa a cinza, que pende. A chama, as faíscas e a fumaça são desenho animado (o motor da
// fumaça); aqui fica só o objeto. Nada de folha nem broto: é papel e mais nada.
// As partes que mudam a cada quadro são mexidas por pintarBeck (atributos), sem React no meio.
import { memo } from 'react'

/** Tons do papel natural (cru), os mesmos do beck de antes. */
const PAPEL = { claro: '#f3e6cf', base: '#e6d4b4', escuro: '#c9b08a' }
const PITEIRA = { claro: '#f3ead6', base: '#e9dcc0', escuro: '#c8b48c', traco: '#a8936a' }

// tubo levemente cônico: boca (piteira) com d = 26, ponta com d = 35, comprimento ~6,8d
const TOPO = 37
const BASE = 212
const TUBO = 'M12.5 37Q30 32.5 47.5 37L43 212Q30 216.5 17 212Z'
const TORCIDA = 'M12.6 37.5C13.6 27 21 19.5 26.4 12.6L30.6 3.6L34.4 11.4C38.6 18.4 46.4 27.2 47.4 37.5Q30 33 12.6 37.5Z'
const PITEIRA_LADO = 'M17 196Q30 199.5 43 196L43 212Q30 216.5 17 212Z'
/** Até onde o papel queima (y da linha de queima com queima = 1). */
const QUEIMA_MAX = 158

/** Meia largura do tubo na altura y. */
export function meiaLargura(y: number): number {
  return 17.5 - (4.5 * (y - TOPO)) / (BASE - TOPO)
}

/** A linha de queima (y no viewBox) pra uma fração queimada. */
export function linhaDeQueima(q: number): number {
  return TOPO + Math.min(1, Math.max(0, q)) * (QUEIMA_MAX - TOPO)
}

/** Ponto da brasa no viewBox (centro da linha de queima). */
export function pontoDaBrasa(q: number): [number, number] {
  return [30, linhaDeQueima(q)]
}

/** A ponta da torcida (onde a chama acende), no viewBox. */
export const PONTA_TORCIDA: [number, number] = [30.4, 6]

export interface EstadoBeck {
  /** 0–1: quanto do papel já queimou. */
  queima: number
  /** 0–1: a brasa acesa (0 antes do pop). */
  brasa: number
  /** 0–1: o brilho da brasa (puxada). */
  luz: number
  /** 0–1: a torcida (1 inteira; some no pop). */
  torcida: number
  /** Giro em volta do próprio eixo (rad): a costura e a fibra passam, a luz fica parada. */
  giro: number
  /** A cinza pende pro lado da gravidade (-1 a 1, já no referencial do beck). */
  pende: number
}

export interface PartesBeck {
  corte: SVGRectElement
  costura: SVGPathElement
  fibra: SVGPatternElement
  queimado: SVGPathElement
  brasa: SVGEllipseElement
  brasaLuz: SVGEllipseElement
  aro: SVGEllipseElement
  cinza: SVGPathElement
  rachas: SVGPathElement
  pontos: SVGPathElement
  torcida: SVGGElement
}

const ID_PADRAO = 'fm-beck'
let seq = 0

/** O desenho. `id` único por instância (os gradientes e o recorte). */
function DesenhoDoBeck({ id }: { id?: string }) {
  const u = (s: string) => `${id ?? ID_PADRAO}-${s}`
  return (
    <svg viewBox="0 0 60 240" width="100%" height="100%" aria-hidden="true" focusable="false" overflow="visible" data-beck>
      <defs>
        <linearGradient id={u('cil')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={PAPEL.escuro} />
          <stop offset="0.12" stopColor={PAPEL.base} />
          <stop offset="0.26" stopColor={PAPEL.claro} />
          <stop offset="0.36" stopColor={PAPEL.claro} />
          <stop offset="0.55" stopColor={PAPEL.base} />
          <stop offset="0.82" stopColor={PAPEL.escuro} />
          <stop offset="0.94" stopColor={PAPEL.base} />
          <stop offset="1" stopColor={PAPEL.escuro} />
        </linearGradient>
        <linearGradient id={u('pit')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={PITEIRA.escuro} />
          <stop offset="0.28" stopColor={PITEIRA.claro} />
          <stop offset="0.6" stopColor={PITEIRA.base} />
          <stop offset="1" stopColor={PITEIRA.escuro} />
        </linearGradient>
        {/* a cinza: cilindro cinza com a luz no mesmo lado do papel */}
        <linearGradient id={u('cinza')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#6f6a66" />
          <stop offset="0.2" stopColor="#a9a39d" />
          <stop offset="0.34" stopColor="#d9d4ce" />
          <stop offset="0.6" stopColor="#a39d97" />
          <stop offset="1" stopColor="#5e5955" />
        </linearGradient>
        <radialGradient id={u('brasa')} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff2c0" />
          <stop offset="0.35" stopColor="#ffb534" />
          <stop offset="0.72" stopColor="#ff5418" />
          <stop offset="1" stopColor="#8a1a06" />
        </radialGradient>
        <linearGradient id={u('queimado')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#24160c" stopOpacity="0.95" />
          <stop offset="0.45" stopColor="#5b3a1e" stopOpacity="0.7" />
          <stop offset="1" stopColor="#a87a45" stopOpacity="0" />
        </linearGradient>
        {/* fibra do papel cru: passa com o giro (patternTransform), a luz do cilindro fica */}
        <pattern id={u('fibra')} width="24" height="30" patternUnits="userSpaceOnUse">
          <path d="M2 3l5 1.2M14 8l6-.6M5 15l4 1M17 21l5 .8M9 26l4-.4M20 2l2 1" stroke="#6b5636" strokeOpacity="0.16" strokeWidth="0.5" strokeLinecap="round" fill="none" />
          <path d="M8 6l4 .5M1 20l4-.6M13 28l5 .4" stroke="#fff" strokeOpacity="0.2" strokeWidth="0.55" strokeLinecap="round" fill="none" />
          <circle cx="11" cy="12" r="0.45" fill="#6b5636" fillOpacity="0.25" />
          <circle cx="21" cy="25" r="0.4" fill="#6b5636" fillOpacity="0.22" />
        </pattern>
        <clipPath id={u('corte')}>
          <rect data-parte="corte" x="0" y={TOPO - 6} width="60" height="240" />
        </clipPath>
        <clipPath id={u('tubo')}>
          <path d={TUBO} />
        </clipPath>
      </defs>

      {/* o papel que ainda não queimou (o corte desce com a linha de queima) */}
      <g clipPath={`url(#${u('corte')})`}>
        <path d={TUBO} fill={`url(#${u('cil')})`} />
        <path d={TUBO} fill={`url(#${u('fibra')})`} data-parte="fibra-fill" />
        <g clipPath={`url(#${u('tubo')})`}>
          <path data-parte="costura" d="M50 40L14 210" stroke="#000" strokeWidth="0.9" opacity="0.08" fill="none" />
          {/* o queimado logo abaixo da brasa: papel tostado que clareia pra baixo */}
          <path data-parte="queimado" d="" fill={`url(#${u('queimado')})`} />
        </g>
      </g>

      <g data-parte="piteira-g">
        <path d={PITEIRA_LADO} fill={`url(#${u('cil')})`} />
        <path d={PITEIRA_LADO} fill={`url(#${u('pit')})`} opacity="0.55" />
        <path d="M17 196Q30 199.5 43 196" fill="none" stroke={PAPEL.escuro} strokeWidth="0.7" opacity="0.7" />
        {/* boca: o papel cru dobrado em "M" à vista */}
        <ellipse cx="30" cy="212.2" rx="13" ry="3.9" fill={PITEIRA.base} stroke={PITEIRA.escuro} strokeWidth="0.8" />
        <path d="M19.5 212.6L23 210L26.4 214.4L30 209.7L33.6 214.4L37 210L40.5 212.6" fill="none" stroke={PITEIRA.traco} strokeWidth="0.9" strokeLinejoin="round" />
      </g>

      {/* a brasa: o aro aceso em volta da linha de queima, o miolo e a luz que pulsa na puxada */}
      <ellipse data-parte="aro" cx="30" cy={TOPO} rx="18" ry="4.2" fill="#ff6a1a" opacity="0" />
      <ellipse data-parte="brasa" cx="30" cy={TOPO} rx="17" ry="3.2" fill={`url(#${u('brasa')})`} opacity="0" />
      <ellipse data-parte="brasa-luz" cx="30" cy={TOPO} rx="15" ry="2.6" fill="#fff4c4" opacity="0" />

      {/* a cinza, que cresce da linha de queima pra cima e pende */}
      <path data-parte="cinza" d="" fill={`url(#${u('cinza')})`} stroke="#3f3a36" strokeWidth="0.5" strokeOpacity="0.6" />
      <path data-parte="rachas" d="" fill="none" stroke="#4d4743" strokeWidth="0.55" strokeOpacity="0.7" strokeLinecap="round" />
      <path data-parte="pontos" d="" fill="#ff8a2a" />

      <g data-parte="ponta" style={{ transformOrigin: '30px 37px', transformBox: 'view-box' }}>
        <path d={TORCIDA} fill={`url(#${u('cil')})`} />
        <path d={TORCIDA} fill={`url(#${u('fibra')})`} />
        {/* 3 dobras da torcida, fechada */}
        <g fill="none" stroke={PAPEL.escuro} strokeLinecap="round">
          <path d="M16 34C19 26 24 18 29.4 9" strokeWidth="1.1" opacity="0.9" />
          <path d="M25 35.5C27 27 29 18 31.4 7" strokeWidth="1" opacity="0.8" />
          <path d="M40 34.5C37 26 34.6 18 32.6 9" strokeWidth="1" opacity="0.7" />
        </g>
        <path d="M21 31C23 24 26.5 18 29.6 12" fill="none" stroke="#fff" strokeWidth="0.9" opacity="0.6" strokeLinecap="round" />
      </g>
    </svg>
  )
}

/** O beck (memo: o jogo re-renderiza a cada fase e o SVG não muda; o que mexe é o pintarBeck, nos atributos). */
export const Beck = memo(DesenhoDoBeck)

/** Um id novo por instância (os gradientes do SVG são globais na página). */
export function idDoBeck(): string {
  seq += 1
  return `${ID_PADRAO}${seq}`
}

export function partesDoBeck(raiz: Element | null): PartesBeck | null {
  if (!raiz) return null
  const um = <T extends Element>(s: string) => raiz.querySelector<T>(`[data-parte="${s}"]`)
  const corte = um<SVGRectElement>('corte')
  const costura = um<SVGPathElement>('costura')
  const fibra = raiz.querySelector<SVGPatternElement>('pattern')
  const queimado = um<SVGPathElement>('queimado')
  const brasa = um<SVGEllipseElement>('brasa')
  const brasaLuz = um<SVGEllipseElement>('brasa-luz')
  const aro = um<SVGEllipseElement>('aro')
  const cinza = um<SVGPathElement>('cinza')
  const rachas = um<SVGPathElement>('rachas')
  const pontos = um<SVGPathElement>('pontos')
  const torcida = um<SVGGElement>('ponta')
  if (!corte || !costura || !fibra || !queimado || !brasa || !brasaLuz || !aro || !cinza || !rachas || !pontos || !torcida) return null
  return { corte, costura, fibra, queimado, brasa, brasaLuz, aro, cinza, rachas, pontos, torcida }
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString()

/** O último estado pintado por elemento (não reescreve atributo igual). */
const ultimo = new WeakMap<PartesBeck, string>()

/** Pinta o estado do beck (só atributos; chamado a cada quadro pelo motor). */
export function pintarBeck(p: PartesBeck, e: EstadoBeck): void {
  const chave = `${e.queima.toFixed(3)}|${e.brasa.toFixed(2)}|${e.luz.toFixed(2)}|${e.torcida.toFixed(2)}|${e.giro.toFixed(2)}|${e.pende.toFixed(2)}`
  if (ultimo.get(p) === chave) return
  ultimo.set(p, chave)
  const yb = linhaDeQueima(e.queima)
  const acesa = e.brasa > 0.01
  // o papel some acima da linha de queima (com a brasa acesa, ela come 1 unidade a mais)
  p.corte.setAttribute('y', f1(acesa ? yb + 0.6 : TOPO - 6))

  // giro: a costura passa pela frente (some atrás) e a fibra corre; a luz do cilindro não mexe
  const s = Math.sin(e.giro)
  const c = Math.cos(e.giro)
  const xt = 30 + 16.5 * s
  const xb = 30 + 12.5 * Math.sin(e.giro - 0.38)
  p.costura.setAttribute('d', `M${f1(xt)} ${f1(Math.max(TOPO, yb) + 2)}L${f1(xb)} 210`)
  p.costura.setAttribute('opacity', f1(Math.max(0, c) * 0.12))
  p.fibra.setAttribute('patternTransform', `translate(${f1(((e.giro / (Math.PI * 2)) % 1) * 24)} 0)`)

  // o queimado (tostado) logo abaixo da brasa: borda de cima irregular
  if (acesa) {
    const w = meiaLargura(yb) + 1
    const z = [0, 1.6, 0.4, 2.2, 0.8, 1.9, 0.2, 1.4]
    let d = `M${f1(30 - w)} ${f1(yb)}`
    for (let i = 0; i <= 8; i++) d += `L${f1(30 - w + (2 * w * i) / 8)} ${f1(yb + 1.2 + z[i % 8])}`
    d += `L${f1(30 + w)} ${f1(yb + 9)}L${f1(30 - w)} ${f1(yb + 9)}Z`
    p.queimado.setAttribute('d', d)
  } else p.queimado.setAttribute('d', '')

  // a brasa: elipse da seção do cilindro na linha de queima
  const rx = meiaLargura(yb) - 0.2
  for (const el of [p.brasa, p.brasaLuz, p.aro]) el.setAttribute('cy', f1(yb))
  p.aro.setAttribute('rx', f1(rx + 1.2))
  p.brasa.setAttribute('rx', f1(rx))
  p.brasaLuz.setAttribute('rx', f1(rx * (0.62 + 0.3 * e.luz)))
  p.aro.setAttribute('opacity', f1(e.brasa * (0.35 + 0.5 * e.luz)))
  p.brasa.setAttribute('opacity', f1(e.brasa))
  p.brasaLuz.setAttribute('opacity', f1(e.brasa * (0.15 + 0.85 * e.luz)))

  // a cinza: o que queimou vira um cilindro cinza um pouco mais curto, que pende pro lado da gravidade
  const L = (yb - TOPO) * 0.9
  if (acesa && L > 1.2) {
    const yTop = yb - L
    const wb = meiaLargura(yb) * 0.97
    const wt = meiaLargura(yTop) * 0.9
    const dx = e.pende * Math.pow(L / 50, 2) * 7
    const mx = dx * 0.35
    const r = Math.min(3, L * 0.3)
    const d =
      `M${f1(30 - wb)} ${f1(yb - 0.8)}` +
      `Q${f1(30 - (wb + wt) / 2 + mx)} ${f1(yb - L / 2)} ${f1(30 - wt + dx)} ${f1(yTop + r)}` +
      `Q${f1(30 + dx)} ${f1(yTop - r * 0.7)} ${f1(30 + wt + dx)} ${f1(yTop + r)}` +
      `Q${f1(30 + (wb + wt) / 2 + mx)} ${f1(yb - L / 2)} ${f1(30 + wb)} ${f1(yb - 0.8)}` +
      `Q30 ${f1(yb + 1.6)} ${f1(30 - wb)} ${f1(yb - 0.8)}Z`
    p.cinza.setAttribute('d', d)
    // rachas em volta do cilindro (arcos rasos) a cada ~6 unidades
    let rc = ''
    for (let y = yb - 4; y > yTop + 2; y -= 5.6) {
      const k = (yb - y) / L
      const xo = dx * k * k
      const w = meiaLargura(y) * 0.9
      rc += `M${f1(30 - w * 0.86 + xo)} ${f1(y)}Q${f1(30 + xo)} ${f1(y + 1.4)} ${f1(30 + w * 0.7 + xo)} ${f1(y - 0.3)}`
    }
    p.rachas.setAttribute('d', rc)
    // brasinhas vivas no pé da cinza (piscam com a luz)
    const n = 6
    let pt = ''
    for (let i = 0; i < n; i++) {
      const x = 30 - wb + 2 + ((2 * wb - 4) * (i + 0.5)) / n
      const yy = yb - 1.3 - ((i * 7) % 3) * 0.5
      const rr = 0.55 + 0.35 * e.luz
      pt += `M${f1(x - rr)} ${f1(yy)}a${f1(rr)} ${f1(rr)} 0 1 0 ${f1(2 * rr)} 0a${f1(rr)} ${f1(rr)} 0 1 0 ${f1(-2 * rr)} 0`
    }
    p.pontos.setAttribute('d', pt)
    p.pontos.setAttribute('opacity', f1(0.35 + 0.65 * e.luz))
  } else {
    p.cinza.setAttribute('d', '')
    p.rachas.setAttribute('d', '')
    p.pontos.setAttribute('d', '')
  }

  // a torcida: inteira até o pop, aí incha e some
  const t = Math.max(0, e.torcida)
  p.torcida.style.transform = t >= 0.999 ? '' : `scale(${f1(t > 0.5 ? 1 + (1 - t) * 0.5 : t * 2.5)})`
  p.torcida.style.opacity = t <= 0.001 ? '0' : '1'
}

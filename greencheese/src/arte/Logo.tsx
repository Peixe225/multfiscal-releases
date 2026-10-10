// Logo da Green Cheese em SVG: círculo preto, cuia em traço de pincel branco, GREEN CHEESE grosso e inclinado
// dentro da cuia, tesoura aberta em cima. Paths e grades em logo-paths.ts (gerado por scripts/gerar-logo.mjs).
//
// Dois desenhos:
//   completo → o vetor (acima de 40 px).
//   compacto → grade pixelada à mão (24 ou 32 blocos, crispEdges): cuia sem pé ocupando o círculo, GC em massa,
//              tesoura simplificada. desenho="auto" (padrão) escolhe pelo tamanho real: número ≤ 40, ou mede o SVG
//              quando o tamanho vem do CSS (ex.: "100%" dentro do Avatar).
//
// Respiro entre elementos (texto e tesoura sobre a cuia, lâmina da frente sobre a de trás, furo do parafuso):
// <mask>, transparente de verdade — sobre dither, halo do produto ou #121212 não aparece contorno preto.
//
// Ganchos de animação (desenho completo; anime só transform e opacity):
//   .logo-cuia · .logo-texto (.logo-texto-green, .logo-texto-cheese) · .logo-tesoura
//   .logo-lamina-a / .logo-lamina-b giram em torno do parafuso (LOGO_PIVO). Fechar = girar LOGO_FECHAR.a / .b graus.
//     CSS/WAAPI: el.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${LOGO_FECHAR.a}deg)` }], …)
//     GSAP:      gsap.to(el, { rotation: LOGO_FECHAR.a }) — sem configurar nada (com ou sem svgOrigin: LOGO_ORIGEM_GSAP).
//     Um OU outro no mesmo elemento: o GSAP grava atributo transform e transform-origin 0 0 no style. Para passar
//     ao CSS depois, rode o GSAP dentro de gsap.context() e chame ctx.revert() antes (o pivô volta sozinho).
//   As máscaras acompanham as lâminas e o texto sozinhas (<use> dos próprios elementos animados); só o recorte
//   do aro atrás do GREEN é fixo (se o texto entrar animado, o aro já espera aberto no lugar dele).
// Montagem em blocos (abertura): <LogoPixel>; cada passo é um <path data-ordem> para acender em sequência por opacity.
import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject, type SVGProps } from 'react'
import { flushSync } from 'react-dom'
import {
  LOGO_CIRCULO,
  LOGO_CUIA,
  LOGO_FOLGA,
  LOGO_GRADES,
  LOGO_LAMINAS,
  LOGO_PIVO,
  LOGO_PIXELS,
  LOGO_TEXTO,
  LOGO_VIEWBOX,
} from './logo-paths'

export { LOGO_VIEWBOX, LOGO_PIVO, LOGO_FECHAR, LOGO_PIXELS } from './logo-paths'

/** Parafuso no formato do svgOrigin do GSAP (opcional: sem ele o GSAP já acha o mesmo pivô). */
export const LOGO_ORIGEM_GSAP = `${LOGO_PIVO.x} ${LOGO_PIVO.y}`

/** Até este tamanho (px) o desenho "auto" vira compacto; até LOGO_LIMITE_GRADE_24 usa a grade de 24 blocos. */
export const LOGO_LIMITE_COMPACTO = 40
export const LOGO_LIMITE_GRADE_24 = 30

export interface LogoProps {
  /** Largura/altura do SVG (número = px, ou valor CSS como "100%"). Padrão 120. */
  tamanho?: number | string
  className?: string
  /** Texto acessível. Padrão vazio = decorativo (aria-hidden), para quando já há "GREEN CHEESE" ou aria-label ao lado. */
  titulo?: string
  /** 'circulo' (padrão) = foto de perfil; 'sem-circulo' = só o desenho, sobre qualquer fundo. */
  variante?: 'circulo' | 'sem-circulo'
  /** 'auto' (padrão) escolhe pelo tamanho; 'completo' = vetor; 'compacto' = grade pixel. */
  desenho?: 'auto' | 'completo' | 'compacto'
  /**
   * Desenho completo via <symbol> único com <use> (um só conjunto de paths no DOM para vários logos).
   * Sem ganchos de animação: não use na abertura.
   */
  simbolo?: boolean
  style?: CSSProperties
}

// ---------------------------------------------------------------------------
// Utilidades

/** Grade de caracteres → path de retângulos (corridas horizontais), coordenadas inteiras. */
function gradeParaD(linhas: readonly string[], marca: (ch: string) => boolean = (ch) => ch === '#'): string {
  let d = ''
  linhas.forEach((l, y) => {
    for (let x = 0; x < l.length; ) {
      if (!marca(l[x])) {
        x++
        continue
      }
      let w = 1
      while (x + w < l.length && marca(l[x + w])) w++
      d += `M${x} ${y}h${w}v1h-${w}z`
      x += w
    }
  })
  return d
}

const D_GRADE = { 24: gradeParaD(LOGO_GRADES[24]), 32: gradeParaD(LOGO_GRADES[32]) } as const

/** useId do React vira id seguro para url(#…) e href. */
const idSeguro = (bruto: string) => 'logo' + bruto.replace(/[^a-zA-Z0-9_-]/g, '')

/** Mede a largura real do SVG quando o tamanho vem do CSS (antes da pintura; depois, a cada resize). */
function useLarguraReal(ref: RefObject<SVGSVGElement | null>, ativo: boolean): number | null {
  const [px, setPx] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!ativo || !el) return
    const largura = el.clientWidth || el.getBoundingClientRect().width
    if (largura > 0) setPx(largura)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width
      // flushSync: troca o desenho no mesmo quadro, sem piscar o errado
      if (w > 0) flushSync(() => setPx((v) => (v !== null && Math.abs(v - w) < 0.5 ? v : w)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, ativo])
  return ativo ? px : null
}

/**
 * A lâmina gira em torno do parafuso, em coordenadas do viewBox. Vai como atributo de apresentação (não no style):
 * o GSAP grava transform-origin 0 0 no style enquanto anima e, no revert, apaga o style — o atributo volta a valer.
 */
// (o React converte transformOrigin em transform-origin; só falta nos tipos dele)
const ATRIBUTO_PIVO = { transformOrigin: `${LOGO_PIVO.x} ${LOGO_PIVO.y}` } as unknown as SVGProps<SVGGElement>

/**
 * Caixa invisível do tamanho do viewBox dentro de cada lâmina: a caixa do elemento passa a começar em 0,0,
 * então o transform-origin acima vale igual para o CSS (view-box ou fill-box) e para o GSAP (que mede pela caixa).
 */
const caixaGiro = <rect className="logo-caixa" width="512" height="512" fill="none" stroke="none" pointerEvents="none" />

// ---------------------------------------------------------------------------
// Desenho completo

function DesenhoCompleto({ base }: { base: string }) {
  const id = {
    texto: `${base}-t`,
    a: `${base}-a`,
    b: `${base}-b`,
    mCuia: `${base}-mc`,
    mB: `${base}-mb`,
    mFuro: `${base}-mf`,
  }
  const area = { maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 512, height: 512 } as const
  const recorte = { fill: '#000', stroke: '#000', strokeWidth: LOGO_FOLGA * 2, strokeLinejoin: 'round' } as const
  return (
    <>
      <defs>
        {/* o que passa por cima da cuia abre um respiro nela; o aro some atrás do GREEN inteiro (recorte fixo) */}
        <mask id={id.mCuia} {...area}>
          <rect width="512" height="512" fill="#fff" />
          <g {...recorte}>
            <path d={LOGO_TEXTO.recorte} />
            <use href={`#${id.texto}`} />
            <use href={`#${id.a}`} />
            <use href={`#${id.b}`} />
          </g>
        </mask>
        {/* lâmina da frente sobre a de trás */}
        <mask id={id.mB} {...area}>
          <rect width="512" height="512" fill="#fff" />
          <g {...recorte}>
            <use href={`#${id.a}`} />
          </g>
        </mask>
        {/* furo do parafuso, atravessando as duas peças */}
        <mask id={id.mFuro} {...area}>
          <rect width="512" height="512" fill="#fff" />
          <circle cx={LOGO_PIVO.x} cy={LOGO_PIVO.y} r={LOGO_PIVO.r} fill="#000" />
        </mask>
      </defs>
      <g fill="#fff">
        <g className="logo-cuia" mask={`url(#${id.mCuia})`}>
          <path d={LOGO_CUIA} />
        </g>
        <g className="logo-texto" id={id.texto}>
          <path className="logo-texto-green" d={LOGO_TEXTO.green} />
          <path className="logo-texto-cheese" d={LOGO_TEXTO.cheese} />
        </g>
        <g className="logo-tesoura" mask={`url(#${id.mFuro})`}>
          <g mask={`url(#${id.mB})`}>
            <g className="logo-lamina-b" id={id.b} {...ATRIBUTO_PIVO}>
              {caixaGiro}
              <path d={LOGO_LAMINAS.b} />
            </g>
          </g>
          <g className="logo-lamina-a" id={id.a} {...ATRIBUTO_PIVO}>
            {caixaGiro}
            <path d={LOGO_LAMINAS.a} />
          </g>
        </g>
      </g>
    </>
  )
}

// <symbol> único (opt-in via simbolo): sprite escondido no body, com máscaras estáticas.
const ID_SIMBOLO = 'gc-logo-simbolo'

function garantirSimbolo() {
  if (typeof document === 'undefined' || document.getElementById(ID_SIMBOLO)) return
  const area = 'maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512"'
  const corte = `fill="#000" stroke="#000" stroke-width="${LOGO_FOLGA * 2}" stroke-linejoin="round"`
  const cheio = '<rect width="512" height="512" fill="#fff"/>'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden">
<defs>
<mask id="${ID_SIMBOLO}-mc" ${area}>${cheio}<g ${corte}><path d="${LOGO_TEXTO.recorte}"/><path d="${LOGO_TEXTO.cheese}"/><path d="${LOGO_LAMINAS.a}"/><path d="${LOGO_LAMINAS.b}"/></g></mask>
<mask id="${ID_SIMBOLO}-mb" ${area}>${cheio}<path ${corte} d="${LOGO_LAMINAS.a}"/></mask>
<mask id="${ID_SIMBOLO}-mf" ${area}>${cheio}<circle cx="${LOGO_PIVO.x}" cy="${LOGO_PIVO.y}" r="${LOGO_PIVO.r}" fill="#000"/></mask>
</defs>
<symbol id="${ID_SIMBOLO}" viewBox="${LOGO_VIEWBOX}"><g fill="#fff">
<path mask="url(#${ID_SIMBOLO}-mc)" d="${LOGO_CUIA}"/><path d="${LOGO_TEXTO.green}"/><path d="${LOGO_TEXTO.cheese}"/>
<g mask="url(#${ID_SIMBOLO}-mf)"><path mask="url(#${ID_SIMBOLO}-mb)" d="${LOGO_LAMINAS.b}"/><path d="${LOGO_LAMINAS.a}"/></g>
</g></symbol></svg>`
  const tmp = document.createElement('div')
  tmp.innerHTML = svg
  const el = tmp.firstElementChild
  if (el) document.body.appendChild(el)
}

// ---------------------------------------------------------------------------

export function Logo({
  tamanho = 120,
  className,
  titulo = '',
  variante = 'circulo',
  desenho = 'auto',
  simbolo = false,
  style,
}: LogoProps) {
  const ref = useRef<SVGSVGElement>(null)
  const bruto = useId()
  const base = idSeguro(bruto)
  const idTitulo = `${base}-titulo`
  const decorativo = titulo === ''
  const medir = desenho === 'auto' && typeof tamanho !== 'number'
  const medido = useLarguraReal(ref, medir)
  const px = typeof tamanho === 'number' ? tamanho : medido

  // completo, ou a grade 24/32 do compacto
  let qual: 'completo' | 24 | 32 = 'completo'
  if (desenho === 'compacto' || (desenho === 'auto' && px !== null && px <= LOGO_LIMITE_COMPACTO)) {
    qual = px !== null && px <= LOGO_LIMITE_GRADE_24 ? 24 : 32
  }
  const usarSimbolo = simbolo && qual === 'completo'

  useLayoutEffect(() => {
    if (usarSimbolo) garantirSimbolo()
  }, [usarSimbolo])

  const lado = qual === 'completo' ? LOGO_CIRCULO.r * 2 : qual
  let miolo: ReactNode
  if (qual !== 'completo') miolo = <path className="logo-grade" fill="#fff" d={D_GRADE[qual]} />
  else if (usarSimbolo) miolo = <use href={`#${ID_SIMBOLO}`} width="512" height="512" />
  else miolo = <DesenhoCompleto base={base} />

  const classes = ['logo', `logo--${variante}`, `logo--${qual === 'completo' ? 'completo' : 'compacto'}`, className].filter(Boolean).join(' ')

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={qual === 'completo' ? LOGO_VIEWBOX : `0 0 ${qual} ${qual}`}
      width={tamanho}
      height={tamanho}
      className={classes}
      // flex: none — numa linha flex estreita o logo não encolhe até sumir
      style={{ flex: 'none', display: 'block', ...style }}
      shapeRendering={qual === 'completo' ? undefined : 'crispEdges'}
      role={decorativo ? undefined : 'img'}
      aria-hidden={decorativo ? true : undefined}
      aria-labelledby={decorativo ? undefined : idTitulo}
      focusable="false"
    >
      {!decorativo && <title id={idTitulo}>{titulo}</title>}
      {variante === 'circulo' && (
        <circle className="logo-fundo" cx={lado / 2} cy={lado / 2} r={lado / 2} fill="#000" shapeRendering="geometricPrecision" />
      )}
      {miolo}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Logo em blocos (abertura): o desenho completo rasterizado em 64×64, agrupado em passos.
// Cada passo é um <path data-ordem="n" style="--ordem: n">, já em ordem no DOM: a cuia sobe do fundo,
// o texto entra da esquerda para a direita e a tesoura chega da ponta para os aros.
// Acender (só opacity):
//   GSAP: gsap.fromTo(svg.querySelectorAll('[data-ordem]'), { opacity: 0 }, { opacity: 1, duration: 0.01, stagger: 0.03, ease: 'none' })
//   CSS:  .logo-pixel [data-ordem] { animation: acende 1ms calc(var(--ordem) * 30ms) both } @keyframes acende { from { opacity: 0 } }
//   prefers-reduced-motion: não anime (mostra tudo de uma vez, corte seco).

export const LOGO_PIXEL_PASSOS = 24

export interface LogoPixelProps {
  tamanho?: number | string
  className?: string
  titulo?: string
  variante?: 'circulo' | 'sem-circulo'
  /** Em quantos passos dividir a montagem. Padrão LOGO_PIXEL_PASSOS. */
  passos?: number
  style?: CSSProperties
}

type Camada = 'cuia' | 'texto' | 'tesoura'
interface PassoPixel {
  ordem: number
  camada: Camada
  d: string
}

function montarPassos(passos: number): PassoPixel[] {
  const n = LOGO_PIXELS.lado
  const celulas: Record<Camada, [number, number][]> = { cuia: [], texto: [], tesoura: [] }
  const nome: Record<string, Camada> = { c: 'cuia', t: 'texto', s: 'tesoura' }
  LOGO_PIXELS.linhas.forEach((l, y) => {
    for (let x = 0; x < n; x++) {
      const c = nome[l[x]]
      if (c) celulas[c].push([x, y])
    }
  })
  // tremor determinístico, para a varredura não sair reta demais
  const tremor = (x: number, y: number) => ((x * 7 + y * 13) % 9) / 9
  const chave: Record<Camada, (x: number, y: number) => number> = {
    cuia: (x, y) => -y * 1.4 + Math.abs(x - n / 2) * 0.15 + tremor(x, y) * 4, // sobe do fundo
    texto: (x, y) => x + y * 0.35 + tremor(x, y) * 3, // da esquerda para a direita
    tesoura: (x, y) => -x + tremor(x, y) * 3, // da ponta das lâminas para os aros
  }
  const total = Math.max(3, Math.round(passos))
  const fatia: Record<Camada, number> = { cuia: 0, texto: 0, tesoura: 0 }
  fatia.cuia = Math.max(1, Math.round(total * 0.45))
  fatia.texto = Math.max(1, Math.round(total * 0.3))
  fatia.tesoura = Math.max(1, total - fatia.cuia - fatia.texto)
  const saida: PassoPixel[] = []
  let ordem = 0
  for (const camada of ['cuia', 'texto', 'tesoura'] as const) {
    const lista = [...celulas[camada]].sort((p, q) => chave[camada](p[0], p[1]) - chave[camada](q[0], q[1]))
    const k = fatia[camada]
    for (let i = 0; i < k; i++) {
      const parte = lista.slice(Math.floor((i * lista.length) / k), Math.floor(((i + 1) * lista.length) / k))
      if (!parte.length) continue
      const marcadas = new Set(parte.map(([x, y]) => y * n + x))
      const linhas = Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => (marcadas.has(y * n + x) ? '#' : '.')).join(''))
      saida.push({ ordem: ordem++, camada, d: gradeParaD(linhas) })
    }
  }
  return saida
}

export function LogoPixel({ tamanho = 120, className, titulo = '', variante = 'circulo', passos = LOGO_PIXEL_PASSOS, style }: LogoPixelProps) {
  const bruto = useId()
  const idTitulo = `${idSeguro(bruto)}-titulo`
  const decorativo = titulo === ''
  const grupos = useMemo(() => montarPassos(passos), [passos])
  const n = LOGO_PIXELS.lado
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${n} ${n}`}
      width={tamanho}
      height={tamanho}
      className={['logo-pixel', `logo--${variante}`, className].filter(Boolean).join(' ')}
      style={{ flex: 'none', display: 'block', ...style }}
      shapeRendering="crispEdges"
      role={decorativo ? undefined : 'img'}
      aria-hidden={decorativo ? true : undefined}
      aria-labelledby={decorativo ? undefined : idTitulo}
      focusable="false"
    >
      {!decorativo && <title id={idTitulo}>{titulo}</title>}
      {variante === 'circulo' && <circle className="logo-fundo" cx={n / 2} cy={n / 2} r={n / 2} fill="#000" shapeRendering="geometricPrecision" />}
      <g fill="#fff">
        {grupos.map((g) => (
          <path key={g.ordem} className={`logo-pixel-${g.camada}`} data-ordem={g.ordem} style={{ ['--ordem' as string]: g.ordem } as CSSProperties} d={g.d} />
        ))}
      </g>
    </svg>
  )
}

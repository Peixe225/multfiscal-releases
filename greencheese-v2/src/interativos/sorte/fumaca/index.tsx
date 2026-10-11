// A revelação da fumaça do Teste minha sorte (pedido do Ian em 11/10): o beck bolado sai da câmara do dichavador, é
// aceso e fumado, solta muita fumaça e o prêmio aparece destacado no meio dela; quanto mais raro, mais viajada.
// Componente sozinho (não lê store do site): o jogo (JogoSorte) e o painel (Testar a animação) usam o mesmo.
// CONTRATO: as props abaixo (src/lib/raridade.ts tem as raridades e as cores).
//
// Este arquivo é leve (o DOM: o beck, o cartão do prêmio, os dois canvas e o anúncio pro leitor de tela); o motor (o
// relógio, o WebGL/canvas 2D, as partículas: motor.ts e o resto da pasta) baixa à parte, por import dinâmico, quando o
// jogo abre (preCarregarFumaca). O roteiro de cada raridade está em roteiro.ts; a técnica, em gl.ts e no LEIA-ME.
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { INFO_RARIDADE, type Raridade } from '../../../lib/raridade'
import { modoLeve } from '../tato'
import { Beck } from './Beck'
import css from './fumaca.css?inline'
import type { Motor } from './motor'
import { TINTA_RARIDADE } from './tinta'

export interface PremioNaFumaca {
  /** O destaque em pixel: "15% OFF", "LEVA 4 PAGA 3", "BRINDE". */
  destaque: string
  /** O nome do produto (ou da categoria) do prêmio. */
  produto: string
  raridade: Raridade
}

export interface PropsRevelacaoFumaca {
  premio: PremioNaFumaca
  /** O desenho/foto do produto, pintado por quem chama (o site usa o ProdutoVisual; o painel, a foto do produto). */
  visual?: ReactNode
  /** 'jogo': dentro do Teste minha sorte; 'previa': o teste do painel (mostra o selo PRÉVIA e nunca vale cupom). */
  modo: 'jogo' | 'previa'
  /** Movimento reduzido: sem animação, já no quadro final (a fumaça parada e o prêmio). */
  reduzido?: boolean
  /** A animação chegou no auge (o prêmio no meio da fumaça) e assentou. */
  onPronto?: () => void
  /** A pessoa tocou pra pular. */
  onPular?: () => void
}

/* ───────────── CSS e o motor (à parte) ───────────── */

const ID_CSS = 'gc-css-fumaca'
if (typeof document !== 'undefined') {
  let el = document.getElementById(ID_CSS) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = ID_CSS
    document.head.appendChild(el)
  }
  el.textContent = css
}

let carregando: Promise<typeof import('./motor')> | null = null
/** Baixa o motor da fumaça (o jogo chama quando abre: na hora do prêmio ele já está aqui). */
export function preCarregarFumaca(): Promise<typeof import('./motor')> {
  carregando ??= import('./motor').catch((e) => {
    carregando = null
    throw e
  })
  return carregando
}

/** O evento que o jogo manda pra fumaça se desfazer (o story entra saindo dela). */
const DISSIPAR = 'fumaca:dissipar'
interface PedidoDissipar {
  seg: number
  ok: () => void
}

/**
 * No jogo, depois do auge: a fumaça vira o fundo do story e se desfaz (as nuvens encolhem e abrem pra fora, o prêmio e
 * o brilho somem). `raiz` é o elemento que contém a RevelacaoFumaca. Resolve quando acabou (ou na hora, sem fumaça).
 */
export function dissiparFumaca(raiz: Element | null, seg = 0.9): Promise<void> {
  const alvo = raiz?.matches('.fm') ? raiz : raiz?.querySelector('.fm')
  if (!alvo) return Promise.resolve()
  return new Promise<void>((ok) => {
    alvo.dispatchEvent(new CustomEvent<PedidoDissipar>(DISSIPAR, { detail: { seg, ok } }))
  })
}

/** Modo leve: aparelho fraco (o jogo mede no gesto) ou economia de dados: o desenho mais simples (canvas 2D). */
function leveAgora(): boolean {
  try {
    const rede = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    return modoLeve() || !!rede?.saveData
  } catch {
    return modoLeve()
  }
}

/** Laboratório (só em dev): o tamanho do pixel, o modo suave e o canvas 2D forçado. */
interface OpcoesLab {
  pixel?: number
  suave?: boolean
  forcar2d?: boolean
  leve?: boolean
  glSoftware?: boolean
}
function opcoesLab(): OpcoesLab {
  if (!import.meta.env.DEV) return {}
  const lab = ((window as unknown as { __fumacaLab?: OpcoesLab }).__fumacaLab ?? {}) as OpcoesLab
  // ?gl=software (só em dev): o WebGL emulado do headless, pras mídias e pro laboratório
  let glSoftware = lab.glSoftware
  try {
    if (new URLSearchParams(location.search).get('gl') === 'software') glSoftware = true
  } catch {
    /* sem URL */
  }
  return { ...lab, glSoftware }
}

/** A frase do leitor de tela quando o prêmio aparece: "Prêmio épico: 15% OFF, Piteira de vidro RAW." */
export function anuncioDoPremio(p: PremioNaFumaca): string {
  return `Prêmio ${INFO_RARIDADE[p.raridade].nome.toLowerCase()}: ${p.destaque}, ${p.produto}.`
}

/** Tecla que pula: Enter/Espaço fora de campo de texto e de botão de outra coisa. */
function teclaQuePula(e: KeyboardEvent, raiz: HTMLElement, modo: 'jogo' | 'previa'): boolean {
  if ((e.key !== 'Enter' && e.key !== ' ') || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return false
  const alvo = e.target
  if (!(alvo instanceof Element) || alvo === document.body || raiz.contains(alvo)) return true
  if (modo !== 'jogo') return false
  return !alvo.closest('input, textarea, select, button, a, [contenteditable="true"]')
}

/* ───────────── componente ───────────── */

export function RevelacaoFumaca({ premio, visual, modo, reduzido = false, onPronto, onPular }: PropsRevelacaoFumaca) {
  const info = INFO_RARIDADE[premio.raridade]
  const idBeck = `fmb${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const raiz = useRef<HTMLDivElement>(null)
  const palco = useRef<HTMLDivElement>(null)
  const beck = useRef<HTMLDivElement>(null)
  const fumaca = useRef<HTMLCanvasElement>(null)
  const faiscas = useRef<HTMLCanvasElement>(null)
  const cartao = useRef<HTMLDivElement>(null)
  const carimbo = useRef<HTMLParagraphElement>(null)
  const [anuncio, setAnuncio] = useState('')
  const [suave] = useState(() => !!opcoesLab().suave)
  const cb = useRef({ onPronto, onPular, premio })
  cb.current = { onPronto, onPular, premio }
  const motor = useRef<Motor | null>(null)
  const pronto = useRef(false)
  const pularAoChegar = useRef(false)

  useLayoutEffect(() => {
    const r = raiz.current
    const els = { raiz: r, palco: palco.current, fumaca: fumaca.current, faiscas: faiscas.current, beck: beck.current, cartao: cartao.current }
    if (!r || !els.palco || !els.fumaca || !els.faiscas || !els.beck || !els.cartao) return
    let vivo = true
    let m: Motor | null = null
    pronto.current = false
    r.dataset.fase = 'acende'
    const terminou = () => {
      if (pronto.current) return
      pronto.current = true
      cb.current.onPronto?.()
    }
    const anunciar = () => setAnuncio(anuncioDoPremio(cb.current.premio))
    const lab = opcoesLab()
    // o motor nasce no quadro seguinte ao da montagem: a montagem (React + layout) e o motor (canvas, shader, primeiro
    // desenho) não caem no mesmo quadro (no jogo, o beck do dichavador segura a pose até o da fumaça aparecer)
    const depoisDoQuadro = <T,>(v: T) => new Promise<T>((ok) => requestAnimationFrame(() => ok(v)))
    preCarregarFumaca().then(depoisDoQuadro).then(
      ({ criarMotor }) => {
        if (!vivo) return
        m = criarMotor(
          { raiz: r, palco: els.palco!, fumaca: els.fumaca!, faiscas: els.faiscas!, beck: els.beck!, cartao: els.cartao!, carimbo: carimbo.current },
          { raridade: premio.raridade, previa: modo === 'previa', reduzido, leve: lab.leve ?? leveAgora(), pixel: lab.pixel, suave: lab.suave, forcar2d: lab.forcar2d, glSoftware: lab.glSoftware, aoPremio: anunciar, aoPronto: terminou },
        )
        motor.current = m
        r.dataset.desenho = m.tipo
        if (import.meta.env.DEV) (window as unknown as { __fumaca?: Motor }).__fumaca = m
        if (pularAoChegar.current) {
          pularAoChegar.current = false
          m.pular()
        }
      },
      () => {
        // o motor não baixou (rede caiu): o prêmio aparece parado, sem fumaça
        if (!vivo) return
        const c = cartao.current
        if (c) Object.assign(c.style, { opacity: '1', visibility: 'visible' })
        if (carimbo.current) Object.assign(carimbo.current.style, { opacity: '1', visibility: 'visible' })
        if (beck.current) beck.current.style.visibility = 'hidden'
        r.dataset.fase = 'pronto'
        anunciar()
        terminou()
      },
    )
    // a fumaça se desfaz quando o jogo pede (o story entra)
    const dissipar = (e: Event) => {
      const d = (e as CustomEvent<PedidoDissipar>).detail
      if (m) void m.dissipar(d.seg).then(d.ok)
      else d.ok()
    }
    r.addEventListener(DISSIPAR, dissipar)
    return () => {
      vivo = false
      r.removeEventListener(DISSIPAR, dissipar)
      m?.destruir()
      motor.current = null
    }
    // o motor recomeça só se a raridade, o modo ou o movimento mudarem (o texto do prêmio troca sem recomeçar)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [premio.raridade, modo, reduzido])

  // pular: um toque de verdade (sem arrasto) ou Enter/Espaço; no jogo, o JogoSorte leva direto pro story pronto
  useEffect(() => {
    const r = raiz.current
    if (!r || reduzido) return
    let ini: { x: number; y: number; id: number } | null = null
    const pular = () => {
      if (pronto.current) return false
      cb.current.onPular?.()
      if (motor.current) motor.current.pular()
      else pularAoChegar.current = true
      return true
    }
    const desce = (e: PointerEvent) => {
      ini = e.isPrimary ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null
    }
    const sobe = (e: PointerEvent) => {
      const i = ini
      ini = null
      if (!i || e.pointerId !== i.id || Math.hypot(e.clientX - i.x, e.clientY - i.y) > 10) return
      pular()
    }
    const cancela = () => {
      ini = null
    }
    const tecla = (e: KeyboardEvent) => {
      if (!teclaQuePula(e, r, modo) || pronto.current) return
      e.preventDefault()
      e.stopPropagation()
      pular()
    }
    r.addEventListener('pointerdown', desce)
    r.addEventListener('pointerup', sobe)
    r.addEventListener('pointercancel', cancela)
    window.addEventListener('keydown', tecla, true)
    return () => {
      r.removeEventListener('pointerdown', desce)
      r.removeEventListener('pointerup', sobe)
      r.removeEventListener('pointercancel', cancela)
      window.removeEventListener('keydown', tecla, true)
    }
  }, [reduzido, modo])

  const cores = { '--fm-cor': info.cor, '--fm-clara': info.clara, '--fm-escura': info.escura, '--fm-tinta': TINTA_RARIDADE[premio.raridade] } as CSSProperties
  return (
    <div ref={raiz} className={`fm fm-${premio.raridade}${suave ? ' fm-suave' : ''}`} style={cores} data-raridade={premio.raridade} data-modo={modo}>
      <div ref={palco} className="fm-palco" aria-hidden="true">
        <div ref={beck} className="fm-beck">
          <Beck id={idBeck} />
        </div>
        <canvas ref={fumaca} className="fm-fumaca" width={1} height={1} />
        <canvas ref={faiscas} className="fm-faiscas" width={1} height={1} />
        <div ref={cartao} className="fm-cartao" data-premio>
          <div className="fm-visual">{visual}</div>
          <p ref={carimbo} className="fm-carimbo fm-px">
            {info.carimbo}
          </p>
          <p className="fm-destaque fm-px">{premio.destaque}</p>
          <p className="fm-produto">{premio.produto}</p>
        </div>
      </div>
      {modo === 'previa' && <span className="fm-selo fm-px">PRÉVIA</span>}
      <p className="fm-sr" aria-live="polite">
        {anuncio}
      </p>
    </div>
  )
}

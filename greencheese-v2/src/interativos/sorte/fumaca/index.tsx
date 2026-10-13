// A revelação da fumaça do Teste minha sorte (pedido do Ian em 11/10): o beck bolado sai da câmara do dichavador, é
// aceso com um isqueiro de desenho e fumado (cada puxada: antecipação, a brasa incandesce, a linha de queima anda, a
// cinza cresce, pende e cai), a fumaça de desenho animado enche a tela e a viagem da raridade acontece nela; o prêmio
// aparece destacado no meio da fumaça. Quanto mais raro, mais viajada (roteiro.ts).
// Componente sozinho (não lê store do site): o jogo (JogoSorte) e o painel (Testar a animação) usam o mesmo.
// CONTRATO: as props abaixo (src/lib/raridade.ts tem as raridades e as cores).
//
// Este arquivo é leve (o DOM: o canvas, o cartão do prêmio e o anúncio pro leitor de tela); o motor (relógio, o pintor
// em pixel, as partículas: motor.ts e o resto da pasta) baixa à parte, por import dinâmico, quando o jogo abre
// (preCarregarFumaca).
//
// Sozinha (painel, laboratório) ela começa quando monta e cuida do toque/Enter que pula. No jogo ela é CONDUZIDA: dentro
// de um elemento com [data-fumaca-conduzida] ela monta cedo (no giro), cria o motor e espera; o jogo manda começar
// (comecarFumaca, com a câmara de onde o beck sobe), pular (pularFumaca), soltar o cartão pro voo até o story
// (soltarCartaoFumaca) e se desfazer (dissiparFumaca). Nada disso muda as props.
import { useDeferredValue, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { INFO_RARIDADE, type Raridade } from '../../../lib/raridade'
import { modoLeve } from '../tato'
import type { Origem } from './cena'
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

export type { Origem }

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

/* ───────────── o jogo conduz (eventos no elemento .fm: as props não mudam) ───────────── */

const COMECAR = 'fumaca:comecar'
const PULAR = 'fumaca:pular'
const SOLTAR = 'fumaca:soltar'
const DISSIPAR = 'fumaca:dissipar'
/** A fumaça avisa quem conduz: o motor está pronto (data-desenho) ou não baixou (data-falhou). */
const PRONTA = 'fumaca:pronta'

const alvoDe = (raiz: Element | null): HTMLElement | null => (raiz?.matches('.fm') ? (raiz as HTMLElement) : (raiz?.querySelector<HTMLElement>('.fm') ?? null))

/** O motor já está pronto pra começar (resolve true) ou não baixou (false). */
export function fumacaPronta(raiz: Element | null): Promise<boolean> {
  const alvo = alvoDe(raiz)
  if (!alvo) return Promise.resolve(false)
  if (alvo.dataset.desenho) return Promise.resolve(true)
  if (alvo.dataset.falhou != null) return Promise.resolve(false)
  return new Promise((ok) => alvo.addEventListener(PRONTA, () => ok(!!alvo.dataset.desenho), { once: true }))
}

/** O beck começa a subir (no jogo, de dentro da câmara do dichavador: a origem, em px do palco da fumaça). */
export function comecarFumaca(raiz: Element | null, origem: Origem | null): void {
  alvoDe(raiz)?.dispatchEvent(new CustomEvent<Origem | null>(COMECAR, { detail: origem }))
}

/** Pula pro auge (o prêmio e o carimbo no lugar). */
export function pularFumaca(raiz: Element | null): void {
  alvoDe(raiz)?.dispatchEvent(new CustomEvent(PULAR))
}

/** O cartão do prêmio passa a ser do jogo (voa até o story): devolve as partes dele pra medir e animar. */
export function soltarCartaoFumaca(raiz: Element | null): { cartao: HTMLElement; visual: HTMLElement | null; carimbo: HTMLElement | null; destaque: HTMLElement | null; nome: HTMLElement | null } | null {
  const alvo = alvoDe(raiz)
  const cartao = alvo?.querySelector<HTMLElement>('.fm-cartao')
  if (!alvo || !cartao) return null
  alvo.dispatchEvent(new CustomEvent(SOLTAR))
  return { cartao, visual: cartao.querySelector('.fm-visual'), carimbo: cartao.querySelector('.fm-carimbo'), destaque: cartao.querySelector('.fm-destaque'), nome: cartao.querySelector('.fm-produto') }
}

interface PedidoDissipar {
  seg: number
  ok: () => void
}

/**
 * No jogo, depois do auge: a fumaça abre como cortina (seg) e o resto dela sobe e se desfaz no fundo do story. Resolve
 * quando acabou tudo (ou na hora, sem fumaça).
 */
export function dissiparFumaca(raiz: Element | null, seg = 0.52): Promise<void> {
  const alvo = alvoDe(raiz)
  if (!alvo) return Promise.resolve()
  return new Promise<void>((ok) => {
    alvo.dispatchEvent(new CustomEvent<PedidoDissipar>(DISSIPAR, { detail: { seg, ok } }))
  })
}

/** Modo leve: aparelho fraco (o jogo mede no gesto) ou economia de dados: a célula maior (5 px). */
function leveAgora(): boolean {
  try {
    const rede = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    return modoLeve() || !!rede?.saveData
  } catch {
    return modoLeve()
  }
}

/** Laboratório (só em dev): o tamanho da célula e o modo leve. */
interface OpcoesLab {
  pixel?: number
  leve?: boolean
}
function opcoesLab(): OpcoesLab {
  if (!import.meta.env.DEV) return {}
  return ((window as unknown as { __fumacaLab?: OpcoesLab }).__fumacaLab ?? {}) as OpcoesLab
}

/** A frase do leitor de tela quando o prêmio aparece: "Prêmio épico: 15% OFF, Piteira de vidro RAW." */
export function anuncioDoPremio(p: PremioNaFumaca): string {
  return `Prêmio ${INFO_RARIDADE[p.raridade].nome.toLowerCase()}: ${p.destaque}, ${p.produto}.`
}

/** Tecla que pula: Enter/Espaço fora de campo de texto e de botão de outra coisa. */
function teclaQuePula(e: KeyboardEvent, raiz: HTMLElement): boolean {
  if ((e.key !== 'Enter' && e.key !== ' ') || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return false
  const alvo = e.target
  if (!(alvo instanceof Element) || alvo === document.body || raiz.contains(alvo)) return true
  return false
}

/* ───────────── componente ───────────── */

export function RevelacaoFumaca({ premio, visual, modo, reduzido = false, onPronto, onPular }: PropsRevelacaoFumaca) {
  const info = INFO_RARIDADE[premio.raridade]
  const raiz = useRef<HTMLDivElement>(null)
  const palco = useRef<HTMLDivElement>(null)
  const fumaca = useRef<HTMLCanvasElement>(null)
  const cartao = useRef<HTMLDivElement>(null)
  const carimbo = useRef<HTMLParagraphElement>(null)
  const holo = useRef<HTMLSpanElement>(null)
  const [anuncio, setAnuncio] = useState('')
  // o desenho do produto entra depois, sem pressa (montar a arte realista no estalo travava a câmera deitando)
  const visualAdiado = useDeferredValue(visual)
  const cb = useRef({ onPronto, onPular, premio })
  cb.current = { onPronto, onPular, premio }
  const config = useRef({ raridade: premio.raridade, previa: modo === 'previa', reduzido })
  config.current = { raridade: premio.raridade, previa: modo === 'previa', reduzido }
  const motor = useRef<Motor | null>(null)
  const pronto = useRef(false)
  const conduzida = useRef(false)

  useLayoutEffect(() => {
    const r = raiz.current
    const els = { palco: palco.current, fumaca: fumaca.current, cartao: cartao.current }
    if (!r || !els.palco || !els.fumaca || !els.cartao) return
    let vivo = true
    let m: Motor | null = null
    const esperar = !!r.closest('[data-fumaca-conduzida]')
    conduzida.current = esperar
    let pedido: { origem: Origem | null } | null = null
    let pularAoChegar = false
    let pedidoDissipar: PedidoDissipar | null = null
    let solto = false
    pronto.current = false
    const terminou = () => {
      if (pronto.current) return
      pronto.current = true
      cb.current.onPronto?.()
    }
    const anunciar = () => setAnuncio(anuncioDoPremio(cb.current.premio))
    const lab = opcoesLab()
    preCarregarFumaca().then(
      ({ criarMotor }) => {
        if (!vivo) return
        const c = config.current
        m = criarMotor(
          { raiz: r, palco: els.palco!, fumaca: els.fumaca!, cartao: els.cartao!, carimbo: carimbo.current, holo: holo.current },
          { raridade: c.raridade, previa: c.previa, reduzido: c.reduzido, leve: lab.leve ?? leveAgora(), pixel: lab.pixel, esperar, aoPremio: anunciar, aoPronto: terminou },
        )
        motor.current = m
        r.dataset.desenho = m.tipo
        if (import.meta.env.DEV) (window as unknown as { __fumaca?: Motor }).__fumaca = m
        if (solto) m.soltarCartao()
        if (pedido) m.comecar(pedido.origem)
        if (pularAoChegar) m.pular()
        if (pedidoDissipar) void m.dissipar(pedidoDissipar.seg).then(pedidoDissipar.ok)
        r.dispatchEvent(new CustomEvent(PRONTA))
      },
      () => {
        // o motor não baixou (rede caiu): o prêmio aparece parado, sem fumaça
        if (!vivo) return
        r.dataset.falhou = ''
        r.dispatchEvent(new CustomEvent(PRONTA))
        const mostrar = () => {
          const c = cartao.current
          if (c) Object.assign(c.style, { opacity: '1', visibility: 'visible', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' })
          if (carimbo.current) Object.assign(carimbo.current.style, { opacity: '1', visibility: 'visible' })
          r.dataset.fase = 'pronto'
          anunciar()
          terminou()
        }
        if (!esperar || pedido || pularAoChegar) mostrar()
        else r.addEventListener(COMECAR, mostrar, { once: true })
      },
    )
    // o jogo conduz: começar, pular, soltar o cartão, se desfazer
    const comecar = (e: Event) => {
      const origem = (e as CustomEvent<Origem | null>).detail ?? null
      if (m) m.comecar(origem)
      else pedido = { origem }
    }
    const pular = () => {
      if (m) m.pular()
      else pularAoChegar = true
    }
    const soltar = () => {
      solto = true
      m?.soltarCartao()
    }
    const dissipar = (e: Event) => {
      const d = (e as CustomEvent<PedidoDissipar>).detail
      if (m) void m.dissipar(d.seg).then(d.ok)
      else if (r.dataset.falhou != null) d.ok()
      else pedidoDissipar = d
    }
    r.addEventListener(COMECAR, comecar)
    r.addEventListener(PULAR, pular)
    r.addEventListener(SOLTAR, soltar)
    r.addEventListener(DISSIPAR, dissipar)
    return () => {
      vivo = false
      r.removeEventListener(COMECAR, comecar)
      r.removeEventListener(PULAR, pular)
      r.removeEventListener(SOLTAR, soltar)
      r.removeEventListener(DISSIPAR, dissipar)
      pedidoDissipar?.ok()
      m?.destruir()
      motor.current = null
    }
    // o motor nasce uma vez; raridade, modo e movimento reconfiguram ele (efeito abaixo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // a raridade (ou o modo, ou o movimento) mudou: a mesma fumaça, outra cena (no jogo: o prêmio chegou no estalo)
  const chave = `${premio.raridade}|${modo}|${reduzido}`
  const ultimaChave = useRef(chave)
  useEffect(() => {
    if (ultimaChave.current === chave) return
    ultimaChave.current = chave
    pronto.current = false
    setAnuncio('')
    motor.current?.reconfigurar(config.current)
  }, [chave])

  // pular (sozinha: painel e laboratório): um toque de verdade (sem arrasto) ou Enter/Espaço
  useEffect(() => {
    const r = raiz.current
    if (!r || reduzido || r.closest('[data-fumaca-conduzida]')) return
    let ini: { x: number; y: number; id: number } | null = null
    const pular = () => {
      if (pronto.current) return
      cb.current.onPular?.()
      motor.current?.pular()
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
      if (!teclaQuePula(e, r) || pronto.current) return
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
    <div ref={raiz} className={`fm fm-${premio.raridade}`} style={cores} data-raridade={premio.raridade} data-modo={modo}>
      <div ref={palco} className="fm-palco" aria-hidden="true">
        <canvas ref={fumaca} className="fm-fumaca" width={1} height={1} />
        <div ref={cartao} className="fm-cartao" data-premio>
          <p ref={carimbo} className="fm-carimbo fm-px">
            {premio.raridade === 'lendario' && <span ref={holo} className="fm-holo" />}
            <span className="fm-carimbo-txt">{info.carimbo}</span>
          </p>
          <div className="fm-visual">{visualAdiado}</div>
          <div className="fm-texto">
            <p className="fm-destaque fm-px">{premio.destaque}</p>
            <p className="fm-produto">{premio.produto}</p>
          </div>
        </div>
      </div>
      {modo === 'previa' && <span className="fm-selo fm-px">PRÉVIA</span>}
      {/* do raro pra cima a revelação é longa: uma dica discreta de que dá pra pular (o leitor de tela já ouve no "Abriu!") */}
      <span className="fm-dica fm-px" aria-hidden="true">
        toque pra pular
      </span>
      <p className="fm-sr" aria-live="polite">
        {anuncio}
      </p>
    </div>
  )
}

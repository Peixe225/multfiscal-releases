// O motor da revelação da fumaça (baixa à parte: import dinâmico do index.tsx, só quando o jogo abre). Um relógio
// próprio em requestAnimationFrame (o quadro é função do tempo, ver cena.ts), o desenho (WebGL ou canvas 2D), as
// partículas, o beck e o cartão do prêmio no DOM (só transform e opacity), a vibração por raridade e os marcos
// (o prêmio apareceu, assentou). Pausa com a aba escondida; desmontou, não sobra nada rodando.
import type { Raridade } from '../../../lib/raridade'
import { vibrar, type Pulso } from '../tato'
import { partesDoBeck, pintarBeck, type PartesBeck } from './Beck'
import { Cena, type Geo } from './cena'
import { criarGL, type Desenho, type Recurso } from './gl'
import { Particulas } from './particulas'
import { criar2D } from './plano'
import { poseDoBeck } from './pose'

export interface ElementosMotor {
  raiz: HTMLElement
  palco: HTMLElement
  fumaca: HTMLCanvasElement
  faiscas: HTMLCanvasElement
  beck: HTMLElement
  cartao: HTMLElement
  carimbo: HTMLElement | null
}

export interface OpcoesMotor {
  raridade: Raridade
  previa: boolean
  reduzido: boolean
  leve: boolean
  /** Laboratório: tamanho do pixel da fumaça (px de CSS) e o modo suave (sem pixel, contorno nítido). */
  pixel?: number
  suave?: boolean
  /** Laboratório: força o canvas 2D. */
  forcar2d?: boolean
  /** Laboratório e mídias (só em dev): aceita o WebGL emulado no processador (headless), que no ar vira canvas 2D. */
  glSoftware?: boolean
  aoPremio: () => void
  aoPronto: () => void
}

export interface Motor {
  readonly tipo: 'gl' | '2d'
  readonly duracao: number
  /** Pula pro quadro final (o prêmio assentado). */
  pular(): void
  /** No jogo: a fumaça se desfaz (o story entra saindo dela); resolve quando acabou. */
  dissipar(seg?: number): Promise<void>
  tempo(): number
  irPara(t: number): void
  definirVelocidade(v: number): void
  destruir(): void
}

type Fase = 'acende' | 'puxada' | 'sopro' | 'viagem' | 'premio' | 'pronto' | 'dissipando' | 'fim'

/** O que cada raridade desenha (o shader compila só com isso). */
const RECURSOS: Record<Raridade, Recurso[]> = {
  comum: [],
  raro: ['RAIOS', 'ANEIS'],
  epico: ['ONDA', 'PSI', 'ROSTO'],
  lendario: ['PSI', 'TUNEL', 'FORMAS', 'RAIOS', 'FLASH'],
}

const PULSO_PREMIO: Record<Raridade, Pulso> = { comum: 'premio', raro: 'premioRaro', epico: 'premioEpico', lendario: 'premioLendario' }

export function criarMotor(el: ElementosMotor, o: OpcoesMotor): Motor {
  const cena = new Cena(o.raridade, o.previa)
  const rot = cena.rot
  const t0 = cena.t0
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const suave = !!o.suave && !o.leve
  const pix = suave ? 1 / dpr : (o.pixel ?? (o.leve ? 5 : 4))
  const linha = suave ? Math.round(3 * dpr) : 1

  let desenho: Desenho | null = null
  const usar2D = () => {
    desenho?.destruir()
    // o canvas que já teve WebGL não dá 2D: troca o elemento por um novo
    const novo = document.createElement('canvas')
    novo.className = el.fumaca.className
    el.fumaca.replaceWith(novo)
    el.fumaca = novo
    desenho = criar2D(novo)
    medir()
    pintar()
  }
  if (!o.leve && !o.forcar2d) desenho = criarGL(el.fumaca, () => queueMicrotask(usar2D), RECURSOS[o.raridade], !!o.glSoftware)
  if (!desenho) desenho = criar2D(el.fumaca)
  const particulas = new Particulas(el.faiscas, cena)
  const partes: PartesBeck | null = partesDoBeck(el.beck)

  let t = o.reduzido ? cena.fim : 0
  let velocidade = 1
  let raf = 0
  let ultimo = 0
  let destruido = false
  let anunciou = false
  let pronto = false
  let dissipaDe = -1
  let dissipaDur = 0.9
  let fimDissipa: (() => void) | null = null
  let geo: Geo | null = null
  let impar = false
  let faseAtual = ''

  function medir() {
    const r = el.raiz
    const W = r.clientWidth
    const H = r.clientHeight
    if (!W || !H) return false
    const pose = poseDoBeck(W, H)
    const c = el.cartao
    const cw = c.offsetWidth
    const ch = c.offsetHeight
    const cy = Math.round(H * 0.5)
    c.style.left = `${Math.round(W / 2 - cw / 2)}px`
    c.style.top = `${Math.round(cy - ch / 2)}px`
    const v = c.querySelector<HTMLElement>('.fm-visual')
    const x0 = W / 2 - cw / 2
    const y0 = cy - ch / 2
    const vis = v ? { vx: x0 + v.offsetLeft + v.offsetWidth / 2, vy: y0 + v.offsetTop + v.offsetHeight / 2, vw: v.offsetWidth, vh: v.offsetHeight } : { vx: W / 2, vy: cy, vw: cw, vh: ch }
    geo = { W, H, u: Math.min(W, H), pose, premio: { x: W / 2, y: cy, w: cw, h: ch, ...vis } }
    cena.definirGeo(geo)
    const cols = Math.ceil(W / pix)
    const lins = Math.ceil(H / pix)
    desenho?.medir(cols, lins, linha, !suave)
    for (const cv of [el.fumaca, el.faiscas]) {
      cv.style.width = `${cols * pix}px`
      cv.style.height = `${lins * pix}px`
    }
    particulas.medir(Math.ceil(W / (suave ? 4 : pix)), Math.ceil(H / (suave ? 4 : pix)), suave ? 4 : pix)
    if (suave) {
      el.faiscas.style.width = `${Math.ceil(W / 4) * 4}px`
      el.faiscas.style.height = `${Math.ceil(H / 4) * 4}px`
    }
    el.beck.style.width = `${Math.round(pose.h * 0.25)}px`
    el.beck.style.height = `${pose.h}px`
    return true
  }

  const estilo = new WeakMap<HTMLElement, string>()
  const pôr = (e: HTMLElement, transform: string, opacity: number) => {
    const chave = `${transform}|${opacity.toFixed(3)}`
    if (estilo.get(e) === chave) return
    estilo.set(e, chave)
    e.style.transform = transform
    e.style.opacity = opacity.toFixed(3)
    e.style.visibility = opacity <= 0.001 ? 'hidden' : 'visible'
  }
  const r2 = (n: number) => Math.round(n * 100) / 100

  function fase(): Fase {
    if (dissipaDe >= 0) return t - dissipaDe >= dissipaDur ? 'fim' : 'dissipando'
    const tt = t - t0
    if (pronto || tt >= rot.pronto) return 'pronto'
    if (tt >= rot.premio) return 'premio'
    if (tt >= rot.cheio + 0.1) return 'viagem'
    if (tt >= rot.sopro) return 'sopro'
    if (tt >= rot.puxadas[0].de) return 'puxada'
    return 'acende'
  }

  function pintar() {
    if (!geo || destruido) return
    const dis = dissipaDe >= 0 ? Math.min(1, (t - dissipaDe) / dissipaDur) : 0
    cena.calcular(t, dis)
    const d = cena.dom
    const dbg = import.meta.env.DEV ? (window as unknown as { __fumacaDbg?: Record<string, boolean> }).__fumacaDbg : undefined
    if (!dbg?.semDesenho) {
      if (dis < 1) desenho?.pintar(cena.q)
      else desenho?.limpar()
    }
    if (!dbg?.semParticulas) particulas.pintar(t, dis)
    if (partes && !dbg?.semBeck) pintarBeck(partes, d.beck)
    const bw = geo.pose.h * 0.25
    pôr(el.beck, `translate(${r2(d.beckX - bw / 2)}px,${r2(d.beckY - geo.pose.h / 2)}px) rotate(${r2(d.beckAng)}deg)`, d.beckAlfa)
    pôr(el.palco, d.palcoEsc === 1 && !d.palcoX && !d.palcoY ? 'none' : `translate(${r2(d.palcoX)}px,${r2(d.palcoY)}px) scale(${d.palcoEsc.toFixed(4)})`, 1)
    pôr(el.cartao, `translate(${r2(d.cartaoX)}px,${r2(d.cartaoY)}px) scale(${d.cartaoEsc.toFixed(3)}) rotate(${r2(d.cartaoAng)}deg)`, d.cartaoAlfa)
    if (el.carimbo) {
      pôr(el.carimbo, `rotate(-7deg) scale(${d.carimboEsc.toFixed(3)})`, d.carimboAlfa)
      el.carimbo.style.setProperty('--holo', d.carimboHolo.toFixed(3))
    }
    const f = fase()
    if (f !== faseAtual) {
      faseAtual = f
      el.raiz.dataset.fase = f
    }
    if (d.premioVisivel && !anunciou) {
      anunciou = true
      o.aoPremio()
    }
  }

  /** Marcos que vibram (uma vez, só andando pra frente). */
  function marcos(de: number, ate: number) {
    const passou = (x: number) => de < x + t0 && ate >= x + t0
    if (passou(rot.pop)) vibrar('trava')
    for (const p of rot.puxadas) if (passou(p.de + 0.1)) vibrar('quarto')
    if (passou(rot.premio)) vibrar(PULSO_PREMIO[o.raridade])
    if (rot.raridade === 'lendario' && rot.tunel && passou(rot.tunel.clarao)) vibrar('estalo')
    if (passou(rot.carimbo)) vibrar('trava')
  }

  function quadro(agora: number) {
    raf = 0
    if (destruido) return
    const dt = Math.min(0.05, Math.max(0, (agora - ultimo) / 1000)) * velocidade
    ultimo = agora
    // depois de assentar, a fumaça só gira devagar: 30 qps bastam
    impar = !impar
    const antes = t
    t += dt
    if (!(pronto && impar && dissipaDe < 0)) {
      marcos(antes, t)
      pintar()
    }
    if (!pronto && t >= cena.fim) {
      pronto = true
      o.aoPronto()
    }
    if (dissipaDe >= 0 && t - dissipaDe >= dissipaDur) {
      desenho?.limpar()
      particulas.pintar(t, 1)
      fimDissipa?.()
      fimDissipa = null
      return
    }
    agendar()
  }

  /** Agenda o próximo quadro; `retomar`: começou agora (ou voltou da aba escondida), o relógio não salta. */
  function agendar(retomar = false) {
    if (raf || destruido || o.reduzido || document.hidden) return
    if (retomar) ultimo = performance.now()
    raf = requestAnimationFrame(quadro)
  }

  const visivel = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    } else agendar(true)
  }
  document.addEventListener('visibilitychange', visivel)

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => medir() && pintar()) : null
  ro?.observe(el.raiz)
  if (medir()) pintar()
  if (o.reduzido) {
    // quadro final parado: o prêmio no meio da fumaça desenhada
    pronto = true
    queueMicrotask(() => {
      if (destruido) return
      o.aoPronto()
    })
  } else agendar(true)

  const motor: Motor = {
    get tipo() {
      return desenho?.tipo ?? '2d'
    },
    duracao: cena.fim,
    pular() {
      if (destruido || pronto) return
      t = Math.max(t, cena.fim)
      pintar()
      if (!anunciou) {
        anunciou = true
        o.aoPremio()
      }
      vibrar(PULSO_PREMIO[o.raridade])
      pronto = true
      o.aoPronto()
      agendar(true)
    },
    dissipar(seg = 0.9) {
      if (destruido) return Promise.resolve()
      if (dissipaDe >= 0) return new Promise<void>((ok) => (fimDissipa = ok))
      dissipaDur = seg
      dissipaDe = t
      if (o.reduzido) {
        dissipaDe = t - seg
        pintar()
        return Promise.resolve()
      }
      return new Promise<void>((ok) => {
        fimDissipa = ok
        agendar(true)
      })
    },
    tempo: () => t,
    irPara(nt: number) {
      t = Math.max(0, nt)
      pintar()
    },
    definirVelocidade(v: number) {
      velocidade = Math.max(0, v)
    },
    destruir() {
      destruido = true
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      document.removeEventListener('visibilitychange', visivel)
      ro?.disconnect()
      desenho?.destruir()
      desenho = null
      fimDissipa?.()
      fimDissipa = null
    },
  }
  return motor
}

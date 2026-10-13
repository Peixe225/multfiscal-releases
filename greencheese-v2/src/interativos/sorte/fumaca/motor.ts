// O motor da revelação da fumaça (baixa à parte: import dinâmico do index.tsx, quando o jogo abre). Um relógio próprio
// em requestAnimationFrame (o quadro é função do tempo, ver cena.ts), o pintor em pixel (pixel.ts: um canvas só, no
// processador, a mesma arte em todo aparelho), as partículas, o cartão do prêmio no DOM (só transform e opacity), a
// vibração por raridade e os marcos (o prêmio apareceu, assentou).
// No jogo o motor nasce cedo (durante o giro) e ESPERA: o jogo diz quando começar (comecar, com a câmara do dichavador
// de onde o beck sobe); nada de montar React, medir ou criar canvas na hora do estalo. Pausa com a aba escondida;
// desmontou, não sobra nada rodando.
import type { Raridade } from '../../../lib/raridade'
import { vibrar, type Pulso } from '../tato'
import { Cena, type Geo, type Origem } from './cena'
import { Particulas } from './particulas'
import { criarPintor, type Desenho } from './pixel'
import { poseDoBeck } from './pose'
import { ROTEIROS } from './roteiro'

export interface ElementosMotor {
  raiz: HTMLElement
  palco: HTMLElement
  fumaca: HTMLCanvasElement
  cartao: HTMLElement
  carimbo: HTMLElement | null
  holo: HTMLElement | null
}

export interface OpcoesMotor {
  raridade: Raridade
  previa: boolean
  reduzido: boolean
  leve: boolean
  /** Laboratório: o tamanho da célula (px de CSS). */
  pixel?: number
  /** No jogo: espera o `comecar` (o beck sobe da câmara do dichavador). */
  esperar: boolean
  aoPremio: () => void
  aoPronto: () => void
}

export interface Motor {
  readonly tipo: 'pixel'
  readonly duracao: number
  readonly comecou: boolean
  /** No jogo: o beck começa a subir (da câmara, se vier a origem; senão, do pé da tela). */
  comecar(origem: Origem | null): void
  /** Pula pro quadro final (o prêmio assentado). */
  pular(): void
  /** No jogo: o cartão do prêmio passa a ser do jogo (ele voa até o story); o motor para de mexer nele. */
  soltarCartao(): void
  /** No jogo: a fumaça abre como cortina (seg) e o resto sobe e se desfaz no fundo do story; resolve no fim. */
  dissipar(seg?: number): Promise<void>
  /** A raridade (ou o movimento) mudou: refaz a cena, sem recriar o canvas. */
  reconfigurar(o: Pick<OpcoesMotor, 'raridade' | 'previa' | 'reduzido'>): void
  tempo(): number
  irPara(t: number): void
  definirVelocidade(v: number): void
  destruir(): void
}

type Fase = 'espera' | 'sobe' | 'acende' | 'puxada' | 'sopro' | 'viagem' | 'premio' | 'pronto' | 'dissipando' | 'resto' | 'fim'

const PULSO_PREMIO: Record<Raridade, Pulso> = { comum: 'premio', raro: 'premioRaro', epico: 'premioEpico', lendario: 'premioLendario' }
const RESTO = 1.2

export function criarMotor(el: ElementosMotor, o: OpcoesMotor): Motor {
  let opc = { raridade: o.raridade, previa: o.previa, reduzido: o.reduzido }
  let cena = new Cena(opc.raridade, opc.previa)
  const pix = o.pixel ?? (o.leve ? 5 : 4)
  const pintor: Desenho | null = criarPintor(el.fumaca)
  let particulas = new Particulas(cena)
  const ligarParticulas = () => {
    if (!pintor) return
    pintor.aoPintar = (buf, cols, lins, p, q) => particulas.pintar(buf, cols, lins, p, q.t, dis(), q.texto, (i, j) => pintor.campoFrente(i, j) > 0.25)
  }
  ligarParticulas()
  const definirIso = () => {
    const iso = cena.rot.iso
    pintor?.definirIso(iso ? iso.cores : null, iso ? iso.contorno : '#000000')
  }
  definirIso()

  let comecou = !o.esperar
  let t = 0
  let velocidade = 1
  let raf = 0
  let ultimo = 0
  let destruido = false
  let anunciou = false
  let pronto = false
  let cartaoSolto = false
  let dissipaDe = -1
  let dissipaDur = 0.52
  let fimDissipa: (() => void) | null = null
  let geo: Geo | null = null
  let impar = false
  // o próximo quadro pinta mesmo no ritmo de 30 qps (depois de pular, o final aparece no quadro seguinte ao toque)
  let forcar = false
  let faseAtual = ''
  let beckY = ''
  let alfa = ''

  const dis = () => (dissipaDe >= 0 ? Math.min(1, (t - dissipaDe) / dissipaDur) : 0)
  const resto = () => (dissipaDe >= 0 ? Math.max(0, Math.min(1, (t - dissipaDe - dissipaDur) / RESTO)) : 0)

  function medir() {
    const r = el.raiz
    const W = r.clientWidth
    const H = r.clientHeight
    if (!W || !H) return false
    const c = el.cartao
    const cw = c.offsetWidth
    const ch = c.offsetHeight
    const cy = Math.round(H * 0.5)
    const x0 = Math.round(W / 2 - cw / 2)
    const y0 = Math.round(cy - ch / 2)
    c.style.left = `${x0}px`
    c.style.top = `${y0}px`
    const v = c.querySelector<HTMLElement>('.fm-visual')
    const tx = c.querySelector<HTMLElement>('.fm-texto')
    const vis = v ? { vx: x0 + v.offsetLeft + v.offsetWidth / 2, vy: y0 + v.offsetTop + v.offsetHeight / 2, vw: v.offsetWidth, vh: v.offsetHeight } : { vx: W / 2, vy: cy, vw: cw, vh: ch }
    const E = cena.rot.escala
    // o retângulo do texto já na escala final do cartão (em volta do centro dele)
    const txt = tx
      ? { tx0: W / 2 + (x0 + tx.offsetLeft - W / 2) * E, ty0: cy + (y0 + tx.offsetTop - cy) * E, tx1: W / 2 + (x0 + tx.offsetLeft + tx.offsetWidth - W / 2) * E, ty1: cy + (y0 + tx.offsetTop + tx.offsetHeight - cy) * E }
      : { tx0: 0, ty0: 0, tx1: -1, ty1: -1 }
    geo = { W, H, u: Math.min(W, H), pose: poseDoBeck(W, H), premio: { x: W / 2, y: cy, w: cw, h: ch, ...vis, ...txt } }
    cena.definirGeo(geo)
    pintor?.medir(W, H, pix)
    particulas.medir()
    const cols = Math.ceil(W / pix)
    const lins = Math.ceil(H / pix)
    el.fumaca.style.width = `${cols * pix}px`
    el.fumaca.style.height = `${lins * pix}px`
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
    if (!comecou) return 'espera'
    if (dissipaDe >= 0) {
      const a = t - dissipaDe
      return a < dissipaDur ? 'dissipando' : a < dissipaDur + RESTO ? 'resto' : 'fim'
    }
    const r = cena.rot
    if (pronto || t >= r.pronto) return 'pronto'
    if (t >= r.premio) return 'premio'
    if (t >= r.cheio) return 'viagem'
    if (t >= r.sopro) return 'sopro'
    if (t >= r.puxadas[0].de) return 'puxada'
    if (t >= r.pousa) return 'acende'
    return 'sobe'
  }

  function pintar() {
    if (!geo || destruido || !comecou) return
    const dbg = import.meta.env.DEV ? (window as unknown as { __fumacaDbg?: Record<string, boolean> }).__fumacaDbg : undefined
    const dd = dis()
    const rr = resto()
    cena.calcular(t, dd, rr)
    const q = cena.q
    const d = cena.dom
    if (!dbg?.semDesenho) {
      const t0 = import.meta.env.DEV ? performance.now() : 0
      if (rr < 1) pintor?.pintar(q)
      else pintor?.limpar()
      if (import.meta.env.DEV) {
        const w = window as unknown as { __fumacaPerf?: [number, number][] }
        if (w.__fumacaPerf) w.__fumacaPerf.push([+t.toFixed(2), +(performance.now() - t0).toFixed(1)])
      }
    }
    const a = q.alfa.toFixed(2)
    if (a !== alfa) {
      alfa = a
      el.fumaca.style.opacity = a
    }
    pôr(el.palco, !d.palcoX && !d.palcoY ? 'none' : `translate(${r2(d.palcoX)}px,${r2(d.palcoY)}px)`, 1)
    if (!cartaoSolto) {
      pôr(el.cartao, `translate(${r2(d.cartaoX)}px,${r2(d.cartaoY)}px) scale(${d.cartaoEsc.toFixed(3)}) rotate(${r2(d.cartaoAng)}deg)`, d.cartaoAlfa)
      if (el.carimbo) pôr(el.carimbo, `rotate(-6deg) scale(${d.carimboEsc.toFixed(3)})`, d.carimboAlfa)
      if (el.holo && d.carimboAlfa > 0) el.holo.style.transform = `translateX(${(-d.carimboHolo * 66.67).toFixed(2)}%)`
    }
    const f = fase()
    if (f !== faseAtual) {
      faseAtual = f
      el.raiz.dataset.fase = f
    }
    // pros testes: onde está o beck (a 12 qps, enquanto ele está à vista)
    const by = q.beck.vis ? String(Math.round((q.beck.y0 + q.beck.ay * q.beck.L * 0.5) / 4) * 4) : ''
    if (by !== beckY) {
      beckY = by
      if (by) el.raiz.dataset.beck = by
      else delete el.raiz.dataset.beck
    }
    if (d.premioVisivel && !anunciou) {
      anunciou = true
      o.aoPremio()
    }
  }

  /** Marcos que vibram (uma vez, só andando pra frente). */
  function marcos(de: number, ate: number) {
    const r = cena.rot
    const passou = (x: number) => de < x && ate >= x
    if (passou(r.isqueiro.clique)) vibrar('trava')
    if (passou(r.isqueiro.pega)) vibrar('trava')
    for (const p of r.puxadas) if (passou(p.puxa + 0.1)) vibrar('quarto')
    if (passou(r.premio)) vibrar(PULSO_PREMIO[opc.raridade])
    if (r.portal && passou(r.portal.clarao)) vibrar('estalo')
    if (passou(r.carimbo)) vibrar('trava')
  }

  function quadro(agora: number) {
    raf = 0
    if (destruido) return
    const dt = Math.min(0.05, Math.max(0, (agora - ultimo) / 1000)) * velocidade
    ultimo = agora
    // depois de assentar, a fumaça só respira: 30 qps bastam
    impar = !impar
    const antes = t
    t += dt
    if (forcar || !(pronto && impar && dissipaDe < 0)) {
      forcar = false
      marcos(antes, t)
      pintar()
    }
    if (!pronto && t >= cena.fim) {
      pronto = true
      o.aoPronto()
    }
    if (dissipaDe >= 0 && t - dissipaDe >= dissipaDur + RESTO) {
      pintor?.limpar()
      el.raiz.dataset.fase = faseAtual = 'fim'
      fimDissipa?.()
      fimDissipa = null
      return
    }
    agendar()
  }

  /** Agenda o próximo quadro; `retomar`: começou agora (ou voltou da aba escondida), o relógio não salta. */
  function agendar(retomar = false) {
    if (raf || destruido || !comecou || opc.reduzido || document.hidden) return
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
  ro?.observe(el.cartao)

  function iniciar() {
    if (opc.reduzido) {
      // quadro final parado: o prêmio no meio da fumaça desenhada
      t = cena.fim
      pronto = true
      pintar()
      queueMicrotask(() => {
        if (!destruido) o.aoPronto()
      })
    } else {
      pintar()
      agendar(true)
    }
  }

  // aquecimento: enquanto espera (convite, giro), nos momentos ociosos, calcula uns quadros de cada raridade sem subir
  // pro canvas. O primeiro quadro de verdade (no estalo) já acha o código compilado e as tabelas prontas: sem tranco.
  type Ocioso = { timeRemaining(): number; didTimeout: boolean }
  const w = window as Window & { requestIdleCallback?: (cb: (d: Ocioso) => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
  let ocioso = 0
  let ociosoIdle = false
  let aquecido = false
  function aquecer() {
    if (aquecido || !pintor || !geo || opc.reduzido || comecou) return
    aquecido = true
    const fila: [Raridade, number][] = []
    const ordem: Raridade[] = [opc.raridade, ...(['comum', 'raro', 'epico', 'lendario'] as Raridade[]).filter((x) => x !== opc.raridade)]
    for (const rr of ordem) {
      const R = ROTEIROS[rr]
      for (const tt of [0.05, 0.4, R.isqueiro.lambe, R.puxadas[0].puxa, R.sopro + 0.2, R.cheio, R.premio + 0.3, R.pronto]) fila.push([rr, tt])
    }
    let c: Cena | null = null
    let p: Particulas | null = null
    let atual = ''
    const passo = (d?: Ocioso) => {
      ocioso = 0
      if (destruido || comecou || !geo) return
      let n = 0
      while (fila.length && (n === 0 ? !d || d.didTimeout || d.timeRemaining() > 9 : !!d && d.timeRemaining() > 14)) {
        const [rr, tt] = fila.shift()!
        if (rr !== atual) {
          c = new Cena(rr, opc.previa)
          c.definirGeo(geo)
          p = new Particulas(c)
          p.medir()
          atual = rr
        }
        c!.calcular(tt, 0, 0)
        const ao = pintor.aoPintar
        const pp = p!
        pintor.aoPintar = (buf, cols, lins, px, q) => pp.pintar(buf, cols, lins, px, q.t, 0, q.texto, (i, j) => pintor.campoFrente(i, j) > 0.25)
        pintor.pintar(c!.q, false)
        pintor.aoPintar = ao
        n++
      }
      if (fila.length) agendarOcio()
      else {
        definirIso()
        pintor.limpar()
      }
    }
    const agendarOcio = () => {
      ociosoIdle = !!w.requestIdleCallback
      ocioso = w.requestIdleCallback ? w.requestIdleCallback(passo, { timeout: 2000 }) : window.setTimeout(passo, 80)
    }
    // espera a montagem assentar (o convite acabou de aparecer)
    ociosoIdle = false
    ocioso = window.setTimeout(agendarOcio, 700)
  }
  const pararAquecer = () => {
    if (!ocioso) return
    if (ociosoIdle) w.cancelIdleCallback?.(ocioso)
    else window.clearTimeout(ocioso)
    ocioso = 0
  }

  medir()
  if (comecou) iniciar()
  else {
    el.raiz.dataset.fase = faseAtual = 'espera'
    aquecer()
  }

  const motor: Motor = {
    tipo: 'pixel',
    get duracao() {
      return cena.fim
    },
    get comecou() {
      return comecou
    },
    comecar(origem) {
      if (destruido || comecou) return
      pararAquecer()
      cena.definirOrigem(origem)
      comecou = true
      t = 0
      // o cartão pode ter mudado de tamanho (o texto do prêmio chegou depois da montagem)
      medir()
      iniciar()
    },
    pular() {
      if (destruido || pronto) return
      if (!comecou) {
        pararAquecer()
        comecou = true
        medir()
      }
      t = Math.max(t, cena.fim)
      // o quadro final sai no próximo quadro de tela (nada pesado dentro do toque)
      forcar = true
      if (opc.reduzido) pintar()
      if (!anunciou) {
        anunciou = true
        o.aoPremio()
      }
      vibrar(PULSO_PREMIO[opc.raridade])
      pronto = true
      o.aoPronto()
      agendar(true)
    },
    soltarCartao() {
      // pulou e o quadro final ainda não saiu: sai agora (o voo mede o cartão no lugar dele)
      if (forcar && comecou && !destruido) {
        forcar = false
        pintar()
      }
      cartaoSolto = true
    },
    dissipar(seg = 0.52) {
      if (destruido || !comecou) return Promise.resolve()
      if (dissipaDe >= 0) return new Promise<void>((ok) => (fimDissipa = ok))
      dissipaDur = seg
      dissipaDe = t
      if (opc.reduzido) {
        dissipaDe = t - seg - RESTO
        pintar()
        return Promise.resolve()
      }
      return new Promise<void>((ok) => {
        fimDissipa = ok
        agendar(true)
      })
    },
    reconfigurar(n) {
      if (destruido) return
      const mudouCena = n.raridade !== opc.raridade || n.previa !== opc.previa
      opc = { ...n }
      if (mudouCena) {
        cena = new Cena(opc.raridade, opc.previa)
        particulas = new Particulas(cena)
        ligarParticulas()
        definirIso()
      }
      // o carimbo do lendário ganha a camada do brilho holográfico (o React acabou de pôr)
      el.holo = el.carimbo?.querySelector<HTMLElement>('.fm-holo') ?? null
      t = 0
      pronto = false
      anunciou = false
      dissipaDe = -1
      medir()
      if (comecou) iniciar()
    },
    tempo: () => t,
    irPara(nt: number) {
      if (!comecou) {
        comecou = true
        medir()
      }
      t = Math.max(0, nt)
      pintar()
    },
    definirVelocidade(v: number) {
      velocidade = Math.max(0, v)
    },
    destruir() {
      destruido = true
      pararAquecer()
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      document.removeEventListener('visibilitychange', visivel)
      ro?.disconnect()
      pintor?.destruir()
      fimDissipa?.()
      fimDissipa = null
    },
  }
  return motor
}

/** A duração de cada raridade (o jogo enche o segmento "Prêmio" do cromo junto). */
export function duracaoDa(r: Raridade): number {
  return ROTEIROS[r].pronto
}

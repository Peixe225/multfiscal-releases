// Motor da rua: um canvas na resolução da grade (1 px do canvas = 1 pixel da arte; o CSS amplia em escala inteira de
// px do aparelho, com image-rendering: pixelated), um relógio próprio (rAF com acumulador em passos fixos) e os
// roteiros em geradores (roteiro.ts) que pedem "espera 300 ms" ou "espera até ele chegar". Desenha só quando algum
// quadro troca (~10 vezes por segundo); parado, nem o rAF roda.

import type { Folha, Lado, Pacote, QuadroMeta } from './pacote'
import { ALTURA, ASFALTO, CALCADA, CHAO, LUZ_TOPO, MEIO_FIO, POSTE_PE, lugares, type Lugares } from './palco'

/** Passo fixo do relógio (ms). */
const PASSO = 1000 / 60
/** Uma volta do rAF nunca empurra mais que isto (aba que volta, travada do aparelho): nada de pulo. */
const MAX_DT = 250

export interface Ator {
  id: string
  folha: Folha
  anim: string
  i: number
  /** ms que faltam no quadro atual. */
  resto: number
  lado: Lado
  /** Âncora (meio dos pés) na grade. */
  x: number
  /** Linha do chão. */
  y: number
  /** Ordem de desenho (o chão em que pisa); o gato nos engradados fica no fundo. */
  prof: number
  visivel: boolean
  /** Item na mão (id da folha), desenhado no ponto `mao` do quadro. */
  item: string | null
  /** Pega do item diferente da dele (o motoboy pega a sacola por baixo). */
  itemPega: [number, number] | null
  sombra: boolean
  /** Eventos que já passaram desde que a animação começou. */
  eventos: Set<string>
  /** Animação sem laço que já mostrou o último quadro. */
  acabou: boolean
  /** Andando até aqui (o passo para nele, sem passar; o roteiro solta). */
  alvo: number | null
  /** Faixa do chão de destino (sobe ou desce 1 linha por quadro, andando). */
  alvoY: number | null
  /** Pediram a reação (toque); o roteiro atende quando dá. */
  querReagir: boolean
  /** Efeito: some quando a animação acaba (ou em `ate`); sobe 1 linha a cada `sobe` ms (nota musical). */
  efeito?: { sobe: number; prox: number; ate: number }
  /** Ponto fixo do canto de cima (efeitos), em vez da âncora. */
  canto?: boolean
}

export interface Balao {
  id: number
  ator: string
  texto: string
  ate: number
}

export type Espera = number | (() => boolean) | undefined
export type Roteiro = Generator<Espera, void, void>

interface Fio {
  gen: Roteiro
  ate: number
  cond: (() => boolean) | null
  vivo: boolean
}

export interface Fala {
  /** Ponto da cabeça (topo da caixa, no meio da cabeça) em px da grade. */
  x: number
  y: number
  lado: Lado
}

export interface OpcoesMotor {
  tela: HTMLCanvasElement
  pacote: Pacote
  largura: number
  /** Escurece as bordas da esquerda e da direita (cena que não vai de ponta a ponta). */
  bordas: boolean
  semente: number
  /** Sexta-feira (o "Sextou!" só sai nela). */
  sexta: boolean
  aoBaloes: (b: Balao[]) => void
  aoDesenhar: () => void
}

/** Meio da cabeça de cada um (x no lado direito), para o balão. */
const CABECA: Record<string, number> = { mercador: 25, skatista: 25, motoboy: 33, mc: 20, turista: 23, gato: 5 }

/** Gerador de números com semente (mulberry32): a mesma semente, a mesma rua (prints e testes). */
function aleatorio(semente: number) {
  let s = semente >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

export class Motor {
  readonly ctx: CanvasRenderingContext2D
  readonly pacote: Pacote
  readonly w: number
  readonly h = ALTURA
  readonly lugar: Lugares
  readonly rand: () => number
  readonly sexta: boolean
  t = 0
  atores: Ator[] = []
  baloes: Balao[] = []
  private fios: Fio[] = []
  private fundo: HTMLCanvasElement
  private sujo = true
  private raf = 0
  private ultimo = 0
  private acum = 0
  private proxBalao = 1
  private op: OpcoesMotor
  /** Quem reage a evento de quadro (roteiro.ts liga: flash, arranque, notas). */
  aoEvento: (a: Ator, ev: string) => void = () => {}
  /** O mercador foi chamado (toque ou teclado): o roteiro abre o casaco quando ele puder. */
  chamado = false
  /** O mercador está entre uma coisa e outra (pode atender o chamado). */
  mercadorLivre = false
  /** Em que pé está a vez: vivendo, a caminho do ponto, no ponto esperando, atendendo. */
  fase: 'vida' | 'rumo' | 'ponto' | 'ato' = 'vida'

  constructor(op: OpcoesMotor) {
    this.op = op
    this.pacote = op.pacote
    this.w = op.largura
    const ctx = op.tela.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('sem canvas 2d')
    this.ctx = ctx
    op.tela.width = this.w
    op.tela.height = this.h
    ctx.imageSmoothingEnabled = false
    this.lugar = lugares(this.w)
    this.rand = aleatorio(op.semente)
    this.sexta = op.sexta
    this.fundo = this.montarFundo()
  }

  /* ───────────── atores ───────────── */

  folha(id: string): Folha {
    const f = this.pacote.folhas[id]
    if (!f) throw new Error(`rua: sem ${id}`)
    return f
  }

  criar(id: string, op: Partial<Pick<Ator, 'x' | 'y' | 'lado' | 'prof' | 'visivel' | 'sombra'>> & { anim?: string; folha?: string } = {}): Ator {
    const folha = this.folha(op.folha ?? id)
    const anim = op.anim ?? Object.keys(folha.anims)[0]
    const a: Ator = {
      id,
      folha,
      anim,
      i: 0,
      resto: folha.anims[anim].q[0].ms,
      lado: op.lado ?? 'dir',
      x: op.x ?? 0,
      y: op.y ?? CHAO.meio,
      prof: op.prof ?? op.y ?? CHAO.meio,
      visivel: op.visivel ?? true,
      item: null,
      itemPega: null,
      sombra: op.sombra ?? false,
      eventos: new Set(),
      acabou: false,
      alvo: null,
      alvoY: null,
      querReagir: false,
    }
    this.atores.push(a)
    this.sujo = true
    return a
  }

  ator(id: string): Ator | undefined {
    return this.atores.find((a) => a.id === id)
  }

  remover(a: Ator) {
    this.atores = this.atores.filter((x) => x !== a)
    this.baloes = this.baloes.filter((b) => b.ator !== a.id)
    this.sujo = true
  }

  /** Começa a animação do quadro 0 (o evento do quadro 0 já vale). */
  tocar(a: Ator, anim: string, lado?: Lado) {
    const meta = a.folha.anims[anim]
    if (!meta) throw new Error(`rua: ${a.id} sem ${anim}`)
    a.anim = anim
    a.i = 0
    a.resto = meta.q[0].ms
    a.acabou = false
    a.eventos = new Set()
    if (lado) a.lado = lado
    const ev = meta.q[0].evento
    if (ev) {
      a.eventos.add(ev)
      this.aoEvento(a, ev)
    }
    this.sujo = true
  }

  /** Fica num quadro só (pose), sem andar. */
  pose(a: Ator, anim: string, i: number, lado?: Lado) {
    this.tocar(a, anim, lado)
    a.i = i
    a.resto = Infinity
    a.acabou = true
  }

  quadro(a: Ator): QuadroMeta {
    return a.folha.anims[a.anim].q[a.i]
  }

  /** Ponto da mão do quadro atual, na grade (pixel de cima à esquerda). */
  mao(a: Ator): [number, number] | null {
    const m = this.quadro(a).mao
    if (!m) return null
    const [cx, cy] = this.canto(a)
    const mx = a.lado === 'dir' ? m[0] : a.folha.w - 1 - m[0]
    return [cx + mx, cy + m[1]]
  }

  /** Canto de cima à esquerda do quadro na grade. */
  canto(a: Ator): [number, number] {
    if (a.canto) return [Math.round(a.x), Math.round(a.y)]
    const ax = a.lado === 'dir' ? a.folha.ancora.x : a.folha.w - a.folha.ancora.x
    return [Math.round(a.x - ax), Math.round(a.y - a.folha.ancora.y)]
  }

  /** Caixa visível do quadro atual na grade: x0, y0, x1, y1. */
  caixa(a: Ator): [number, number, number, number] {
    const [cx, cy] = this.canto(a)
    const [x0, y0, x1, y1] = this.quadro(a).caixa
    return a.lado === 'dir' ? [cx + x0, cy + y0, cx + x1, cy + y1] : [cx + a.folha.w - x1, cy + y0, cx + a.folha.w - x0, cy + y1]
  }

  /**
   * Onde o balão de `a` aponta: o meio da cabeça, no topo dela quando ele está parado. Preso à âncora, não ao quadro:
   * o balão não pula junto com a cabeça no beat (só anda quando ele anda).
   */
  cabeca(a: Ator): Fala {
    const [cx, cy] = this.canto(a)
    const topo = (a.folha.anims.parado ?? a.folha.anims[a.anim]).q[0].caixa[1]
    const hx = CABECA[a.id] ?? a.folha.w / 2
    return { x: cx + (a.lado === 'dir' ? hx : a.folha.w - hx), y: cy + topo, lado: a.lado }
  }

  /** Gente (tem cabeça para balão e para tocar): o mercador, os clientes e o gato. */
  temCabeca(a: Ator): boolean {
    return CABECA[a.id] != null
  }

  /** Um efeito solto (flash, linhas, nota), com o canto de cima em (x, y); some quando acaba (ou depois de `vida`). */
  efeito(id: string, x: number, y: number, lado: Lado = 'dir', sobe = 0, vida = 0) {
    const a = this.criar(`${id}-${Math.round(this.t)}-${this.atores.length}`, { folha: id, x, y, lado, prof: 1000, anim: 'parado' })
    a.canto = true
    a.efeito = { sobe, prox: this.t + sobe, ate: vida ? this.t + vida : 0 }
    return a
  }

  /* ───────────── balões ───────────── */

  /** Um balão por vez: quem fala agora tira o balão de quem falou antes (conversa em turnos, nada encavalado). */
  falar(a: Ator, texto: string, ms = 1800) {
    this.baloes = [{ id: this.proxBalao++, ator: a.id, texto, ate: this.t + ms }]
    this.op.aoBaloes(this.baloes)
  }

  calar(a: Ator) {
    if (!this.baloes.some((b) => b.ator === a.id)) return
    this.baloes = this.baloes.filter((b) => b.ator !== a.id)
    this.op.aoBaloes(this.baloes)
  }

  /* ───────────── roteiros ───────────── */

  /** Roda um roteiro em paralelo. Devolve quem diz se ele ainda está vivo (e quem para). */
  lancar(gen: Roteiro): { vivo: () => boolean; parar: () => void } {
    const f: Fio = { gen, ate: 0, cond: null, vivo: true }
    this.fios.push(f)
    this.retomar(f)
    return {
      vivo: () => f.vivo,
      parar: () => {
        f.vivo = false
      },
    }
  }

  private retomar(f: Fio) {
    // até 50 passos seguidos sem esperar (um roteiro em laço sem espera não trava a página)
    for (let n = 0; n < 50 && f.vivo; n++) {
      const r = f.gen.next()
      if (r.done) {
        f.vivo = false
        return
      }
      const v = r.value
      if (typeof v === 'number') {
        f.ate = this.t + v
        f.cond = null
        if (v > 0) return
      } else if (typeof v === 'function') {
        if (v()) continue
        f.cond = v
        return
      } else {
        // undefined: no próximo passo do relógio
        f.ate = this.t + PASSO / 2
        f.cond = null
        return
      }
    }
  }

  /* ───────────── relógio ───────────── */

  /** Um passo do relógio: quadros, efeitos, balões e roteiros. */
  avancar(dt: number) {
    this.t += dt
    for (const a of [...this.atores]) this.andarQuadro(a, dt)
    // balões vencidos
    const vivos = this.baloes.filter((b) => b.ate > this.t)
    if (vivos.length !== this.baloes.length) {
      this.baloes = vivos
      this.op.aoBaloes(vivos)
    }
    for (const f of [...this.fios]) {
      if (!f.vivo) continue
      if (f.cond ? f.cond() : this.t >= f.ate) {
        f.cond = null
        this.retomar(f)
      }
    }
    this.fios = this.fios.filter((f) => f.vivo)
  }

  private andarQuadro(a: Ator, dt: number) {
    if (a.efeito) {
      if (a.efeito.ate && this.t >= a.efeito.ate) {
        this.remover(a)
        return
      }
      // a nota sobe em degrau
      if (a.efeito.sobe && this.t >= a.efeito.prox) {
        a.y -= 1
        a.efeito.prox += a.efeito.sobe
        this.sujo = true
      }
    }
    a.resto -= dt
    const meta = a.folha.anims[a.anim]
    while (a.resto <= 0) {
      const q = meta.q[a.i]
      const ultimo = a.i === meta.q.length - 1
      if (ultimo && !meta.laco) {
        a.resto = Infinity
        a.acabou = true
        // efeito sem vida própria some quando acaba
        if (a.efeito && !a.efeito.ate) this.remover(a)
        return
      }
      // deixa o quadro: anda o passo dele (sem passar do alvo) e sobe/desce de faixa
      if (q.passo) {
        let nx = a.x + (a.lado === 'dir' ? q.passo : -q.passo)
        // chegou: fica no alvo (o roteiro solta quando para de andar)
        if (a.alvo != null && (a.lado === 'dir' ? nx >= a.alvo : nx <= a.alvo)) nx = a.alvo
        a.x = nx
      }
      if (a.alvoY != null && a.alvoY !== a.y) {
        a.y += Math.sign(a.alvoY - a.y)
        a.prof = a.y
        if (a.y === a.alvoY) a.alvoY = null
      }
      a.i = ultimo ? 0 : a.i + 1
      a.resto += meta.q[a.i].ms
      const ev = meta.q[a.i].evento
      if (ev) {
        a.eventos.add(ev)
        this.aoEvento(a, ev)
      }
      this.sujo = true
    }
  }

  ligar() {
    if (this.raf) return
    this.ultimo = performance.now()
    this.acum = 0
    const volta = (agora: number) => {
      this.raf = requestAnimationFrame(volta)
      const dt = Math.min(MAX_DT, agora - this.ultimo)
      this.ultimo = agora
      this.acum += dt
      while (this.acum >= PASSO) {
        this.avancar(PASSO)
        this.acum -= PASSO
      }
      if (this.sujo) this.desenhar()
    }
    this.raf = requestAnimationFrame(volta)
  }

  desligar() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  get rodando() {
    return this.raf !== 0
  }

  /** Avança o relógio na mão (prints quadro a quadro) e desenha. */
  avancarNaMao(ms: number) {
    for (let t = 0; t < ms; t += PASSO) this.avancar(PASSO)
    this.desenhar()
  }

  /* ───────────── desenho ───────────── */

  /** Muro, porta, engradados, calçada, meio-fio e asfalto, uma vez só; o topo some no preto em pontilhado. */
  private montarFundo(): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = this.w
    c.height = this.h
    const g = c.getContext('2d')!
    g.imageSmoothingEnabled = false
    g.fillStyle = '#000'
    g.fillRect(0, 0, this.w, this.h)
    const lad = this.pacote.ladrilhos
    const repetir = (id: string, y0: number, y1: number) => {
      const l = lad[id]
      if (!l) return
      for (let y = y0; y < y1; y += l.h) for (let x = 0; x < this.w; x += l.w) g.drawImage(l.img, 0, 0, l.w, Math.min(l.h, y1 - y), x, y, l.w, Math.min(l.h, y1 - y))
    }
    // muro alinhado por baixo: a última fiada de tijolo encosta na calçada
    const muro = lad.muro
    if (muro) {
      const inicio = CALCADA - Math.ceil(CALCADA / muro.h) * muro.h
      for (let y = inicio; y < CALCADA; y += muro.h) for (let x = 0; x < this.w; x += muro.w) g.drawImage(muro.img, x, y)
    }
    this.desenharSo(g, this.folha('porta'), 'parado', 0, 'dir', this.lugar.porta, CALCADA)
    repetir('calcada', CALCADA, MEIO_FIO)
    repetir('meioFio', MEIO_FIO, ASFALTO)
    repetir('asfalto', ASFALTO, ALTURA)
    this.desenharSo(g, this.folha('engradado'), 'parado', 0, this.lugar.engradado > this.lugar.porta ? 'dir' : 'esq', this.lugar.engradado, CHAO.fundo)
    // o muro some no preto nas primeiras linhas (Bayer): a rua sai do escuro, sem borda dura
    g.fillStyle = '#000'
    const SOME = 22
    for (let y = 0; y < SOME; y++) {
      const limiar = (y / SOME) * 16
      for (let x = 0; x < this.w; x++) if (BAYER[y % 4][x % 4] >= limiar) g.fillRect(x, y, 1, 1)
    }
    if (this.op.bordas) {
      const B = 14
      for (let x = 0; x < B; x++) {
        const limiar = (x / B) * 16
        for (let y = 0; y < this.h; y++)
          if (BAYER[y % 4][x % 4] >= limiar) {
            g.fillRect(x, y, 1, 1)
            g.fillRect(this.w - 1 - x, y, 1, 1)
          }
      }
    }
    return c
  }

  private desenharSo(g: CanvasRenderingContext2D, f: Folha, anim: string, i: number, lado: Lado, x: number, y: number) {
    const q = f.anims[anim].q[i]
    const cel = lado === 'dir' ? q.d : q.e
    const ax = lado === 'dir' ? f.ancora.x : f.w - f.ancora.x
    g.drawImage(f.img, (cel % f.colunas) * f.w, Math.floor(cel / f.colunas) * f.h, f.w, f.h, Math.round(x - ax), Math.round(y - f.ancora.y), f.w, f.h)
  }

  private desenharAtor(a: Ator) {
    const f = a.folha
    const q = this.quadro(a)
    const cel = a.lado === 'dir' ? q.d : q.e
    const [cx, cy] = this.canto(a)
    this.ctx.drawImage(f.img, (cel % f.colunas) * f.w, Math.floor(cel / f.colunas) * f.h, f.w, f.h, cx, cy, f.w, f.h)
    if (a.item) {
      const m = this.mao(a)
      const it = this.pacote.folhas[a.item]
      if (m && it) {
        // a pega do item (pixel) no pixel da mão; virado junto com quem segura
        const qi = it.anims.parado.q[0]
        const [ax, ay] = a.itemPega ?? [it.ancora.x, it.ancora.y]
        const px = a.lado === 'dir' ? ax : it.w - 1 - ax
        const ci = a.lado === 'dir' ? qi.d : qi.e
        this.ctx.drawImage(it.img, (ci % it.colunas) * it.w, Math.floor(ci / it.colunas) * it.h, it.w, it.h, m[0] - px, m[1] - ay, it.w, it.h)
      }
    }
  }

  desenhar() {
    this.sujo = false
    const g = this.ctx
    g.drawImage(this.fundo, 0, 0)
    const vis = this.atores.filter((a) => a.visivel)
    // sombras no chão, antes de todo mundo
    for (const a of vis) {
      if (!a.sombra) continue
      const s = this.pacote.folhas[`sombra-${a.id}`]
      if (s) this.desenharSo(g, s, 'parado', 0, 'dir', Math.round(a.x), Math.round(a.y))
    }
    vis.sort((p, q) => p.prof - q.prof)
    for (const a of vis) this.desenharAtor(a)
    this.op.aoDesenhar()
  }

  /** Pede um desenho no próximo quadro (mudança de fora: balão, item). */
  marcar() {
    this.sujo = true
  }

  /** Quem está no ponto (x, y) da grade, de cima para baixo; com folga para o alvo ter 44 px. */
  quemEsta(x: number, y: number, folga: number): Ator | undefined {
    const vis = this.atores.filter((a) => a.visivel && !a.efeito && CABECA[a.id] != null).sort((p, q) => q.prof - p.prof)
    return vis.find((a) => {
      const [x0, y0, x1, y1] = this.caixa(a)
      const fx = Math.max(0, folga - (x1 - x0) / 2)
      const fy = Math.max(0, folga - (y1 - y0) / 2)
      return x >= x0 - fx && x < x1 + fx && y >= y0 - fy && y < y1 + fy
    })
  }

  /** Para tudo e solta o canvas. */
  destruir() {
    this.desligar()
    this.fios = []
    this.atores = []
  }

  /** Cenário que mexe (luz do poste, letreiro) e o poste, na ordem do chão. */
  montarCenario() {
    const L = this.lugar
    this.criar('luz', { x: L.poste + 12, y: LUZ_TOPO, prof: -2, anim: 'parado' })
    this.criar('letreiro', { x: L.porta, y: CALCADA - 50, prof: -1, anim: 'parado' })
    this.criar('poste', { x: L.poste, y: POSTE_PE, prof: POSTE_PE + 0.5, anim: 'parado' })
  }
}

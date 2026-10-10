// O formato do elenco da rua, pronto para um motor de cena desenhar num canvas.
//
// Personagem
//   w × h      tamanho de todos os quadros dele (px da grade; 1 px da grade = 1 "pixel" da arte).
//   ancora     ponto dos pés: x = meio entre os pés (borda entre colunas), y = linha do chão (logo abaixo da sola).
//              O motor põe a âncora na posição do personagem na calçada: desenha o quadro em
//              (posX - ancora.x × k, chaoY - ancora.y × k), com k = px de tela por px da grade.
//   cores      paleta por índice: cores[0] é o transparente; o resto, cores CSS.
//   animacoes  por nome. Cada uma tem `dir` (olhando para a direita, como foi desenhada) e `esq` (já espelhada,
//              com letreiro e logo legíveis). No `esq` a âncora vira w - ancora.x.
//   retrato    o quadro parado sugerido para o movimento reduzido (a cena vira uma foto, ninguém anda).
//
// Quadro
//   px         índice da cor por pixel, linha a linha (w × h). 0 = transparente.
//   ms         duração sugerida (voz pixel: troca seca de quadro, nada de interpolar).
//   passo      quanto o personagem anda para a frente (px da grade) ao trocar para o próximo quadro. É o que faz o pé
//              não escorregar no chão: some o passo à posição (dir) ou subtraia (esq) a cada troca.
//   mao        onde fica o item segurado (o ponto de pega do item vai aqui), ou null. No `esq` já vem espelhado.
//   evento     nome de um momento para sincronizar com o outro personagem (ex.: 'pega', 'paga', 'flash').
//
// Escala recomendada: 3 px de tela por px da grade no celular (o mercador fica com 132 × 192 px, como no repost) e
// 2 px quando a cena precisa caber mais gente; no computador, 3 a 5. Sempre inteira e alinhada ao pixel do aparelho.

import { montarCodigos, VAZIO, type Aro, type Camada, type Ponto } from './compor'

export type Lado = 'dir' | 'esq'

export interface Quadro {
  px: Uint8Array
  ms: number
  passo: number
  mao: Ponto | null
  evento?: string
}

export interface Animacao {
  nome: string
  /** O que a animação mostra (para o laboratório e para quem monta a cena). */
  sobre: string
  /** Volta ao primeiro quadro no fim; sem laço, para no último. */
  laco: boolean
  dir: Quadro[]
  esq: Quadro[]
  /** Soma dos ms. */
  duracao: number
}

export interface Personagem {
  id: string
  nome: string
  w: number
  h: number
  ancora: Ponto
  cores: string[]
  animacoes: Record<string, Animacao>
  /** O quadro parado sugerido (movimento reduzido: a cena vira uma foto bonita). */
  retrato: { animacao: string; quadro: number }
}

/* ───────────── definição (o que cada arquivo de personagem escreve) ───────────── */

export interface QuadroDef {
  camadas: readonly Camada[]
  mao?: Ponto | null
  ms?: number
  passo?: number
  evento?: string
}

export interface AnimacaoDef {
  sobre: string
  quadros: readonly (readonly Camada[] | QuadroDef)[]
  /** Um valor para todos ou um por quadro (o `ms` do QuadroDef ganha dos dois). */
  ms: number | readonly number[]
  laco?: boolean
  passo?: number | readonly number[]
}

export interface PersonagemDef {
  id: string
  nome: string
  w: number
  h: number
  ancora: Ponto
  paleta: Record<string, string>
  aro?: Aro
  animacoes: Record<string, AnimacaoDef>
  /** Quadro parado sugerido; sem ele, o primeiro de `parado` (ou da primeira animação). */
  retrato?: { animacao: string; quadro: number }
}

const ehDef = (q: readonly Camada[] | QuadroDef): q is QuadroDef => !Array.isArray(q)

function porQuadro(v: number | readonly number[] | undefined, i: number, padrao: number): number {
  if (v == null) return padrao
  if (typeof v === 'number') return v
  return v[i] ?? v[v.length - 1] ?? padrao
}

// Identidade de cada peça (para a chave dos quadros iguais), sem olhar o desenho dela.
const ids = new WeakMap<object, number>()
let proximo = 1
function idDe(pc: object): number {
  let id = ids.get(pc)
  if (!id) {
    id = proximo++
    ids.set(pc, id)
  }
  return id
}
function chaveDe(camadas: readonly Camada[]): string {
  return camadas
    .map((c) => {
      const op = c[3] as { troca?: object; virar?: boolean; sobre?: boolean } | undefined
      return `${idDe(c[0])}:${Math.round(c[1])}:${Math.round(c[2])}${op ? `:${op.troca ? idDe(op.troca) : ''}${op.virar ? 'v' : ''}${op.sobre ? 's' : ''}` : ''}`
    })
    .join('|')
}

/** Monta todos os quadros (dos dois lados) de um personagem. Barato: roda uma vez, quando a cena carrega. */
export function criarPersonagem(def: PersonagemDef): Personagem {
  const letras = Object.keys(def.paleta)
  const cores = ['transparent', ...letras.map((l) => def.paleta[l])]
  // código da letra → índice na paleta
  const indice = new Uint8Array(128)
  letras.forEach((l, i) => (indice[l.charCodeAt(0)] = i + 1))
  const paraPx = (cod: Uint8Array) => {
    const px = new Uint8Array(cod.length)
    for (let i = 0; i < cod.length; i++) if (cod[i]) px[i] = indice[cod[i]]
    return px
  }

  // quadros iguais (o mesmo jeito parado repetido em várias animações) montam uma vez e dividem os pixels
  const feitos = new Map<string, [Uint8Array, Uint8Array]>()
  const montar = (camadas: readonly Camada[]): [Uint8Array, Uint8Array] => {
    const chave = chaveDe(camadas)
    let par = feitos.get(chave)
    if (!par) {
      par = [paraPx(montarCodigos(def.w, def.h, camadas, false, def.aro)), paraPx(montarCodigos(def.w, def.h, camadas, true, def.aro))]
      feitos.set(chave, par)
    }
    return par
  }

  const animacoes: Record<string, Animacao> = {}
  for (const [nome, a] of Object.entries(def.animacoes)) {
    const dir: Quadro[] = []
    const esq: Quadro[] = []
    a.quadros.forEach((q, i) => {
      const d: QuadroDef = ehDef(q) ? q : { camadas: q }
      const base = {
        ms: d.ms ?? porQuadro(a.ms, i, 150),
        passo: d.passo ?? porQuadro(a.passo, i, 0),
        evento: d.evento,
      }
      const mao = d.mao ?? null
      const [pxDir, pxEsq] = montar(d.camadas)
      dir.push({ ...base, px: pxDir, mao })
      esq.push({ ...base, px: pxEsq, mao: mao && { x: def.w - 1 - mao.x, y: mao.y } })
    })
    animacoes[nome] = { nome, sobre: a.sobre, laco: a.laco ?? false, dir, esq, duracao: dir.reduce((s, q) => s + q.ms, 0) }
  }
  const retrato = def.retrato ?? { animacao: animacoes.parado ? 'parado' : Object.keys(animacoes)[0], quadro: 0 }
  return { id: def.id, nome: def.nome, w: def.w, h: def.h, ancora: def.ancora, cores, animacoes, retrato }
}

/** Âncora do lado pedido. */
export function ancoraDo(per: Personagem, lado: Lado): Ponto {
  return lado === 'dir' ? per.ancora : { x: per.w - per.ancora.x, y: per.ancora.y }
}

/** Índice do quadro no tempo `t` (ms desde o começo da animação). Sem laço, fica no último. */
export function quadroNoTempo(a: Animacao, t: number): number {
  const n = a.dir.length
  if (n <= 1 || a.duracao <= 0) return 0
  let resto = a.laco ? ((t % a.duracao) + a.duracao) % a.duracao : Math.max(0, t)
  for (let i = 0; i < n; i++) {
    resto -= a.dir[i].ms
    if (resto < 0) return i
  }
  return n - 1
}

/** Um quadro em texto (para conferir, ou para desenhar parado com o PixelArte: monte a paleta com `paletaDe`). */
export function quadroEmLinhas(per: Personagem, q: Quadro): string[] {
  const letra = (i: number) => (i === 0 ? VAZIO : String.fromCharCode(0x40 + i))
  const linhas: string[] = []
  for (let y = 0; y < per.h; y++) {
    let s = ''
    for (let x = 0; x < per.w; x++) s += letra(q.px[y * per.w + x])
    linhas.push(s)
  }
  return linhas
}

/** Paleta das letras de `quadroEmLinhas` (A = cores[1], B = cores[2]…). */
export function paletaDe(per: Personagem): Record<string, string> {
  return Object.fromEntries(per.cores.slice(1).map((c, i) => [String.fromCharCode(0x41 + i), c]))
}

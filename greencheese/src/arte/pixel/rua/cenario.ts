// O cenário da rua, na mesma escala de pixel do elenco: muro com textura em pontilhado, calçada, meio-fio, asfalto,
// poste com a luz caindo em pontilhado (Bayer) e a porta da loja com o letreiro GC em neon. Preto puro dominante,
// só os cinzas da paleta (o neon do GC é branco e o farol de dentro, um cinza claro); nada de céu colorido.
//
// Peças que se repetem (muro, calçada, meio-fio, asfalto) são ladrilhos: o motor repete na horizontal. As outras são
// objetos com âncora no pé (poste, porta), no mesmo formato do elenco (modelo.ts). A luz do poste é uma camada à
// parte, desenhada por cima do muro e da calçada e por baixo das pessoas.

import { p, type Peca } from './compor'
import { criarPersonagem, type Personagem } from './modelo'

export const paletaCenario: Record<string, string> = {
  d: '#262626',
  e: '#3a3a3a',
  m: '#636363',
  c: '#a8a8a8',
  w: '#ffffff',
  k: '#141414',
}

/** Bayer 4 × 4: o limiar de cada pixel do pontilhado (0 a 15). */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

/** Uma peça gerada pixel a pixel. */
function gerar(w: number, h: number, cor: (x: number, y: number) => string): Peca {
  const linhas: string[] = []
  for (let y = 0; y < h; y++) {
    let s = ''
    for (let x = 0; x < w; x++) s += cor(x, y)
    linhas.push(s)
  }
  return { w, h, linhas }
}

/* ───────────── ladrilhos ───────────── */

/**
 * Muro de tijolo rebocado, quase todo preto: as juntas em k (um pixel sim, um não), e a aresta de cima de uns
 * tijolos pegando um resto de luz em d, bem ralo. 24 × 24, emenda sem costura.
 */
const muro = gerar(24, 24, (x, y) => {
  const fiada = Math.floor(y / 6)
  const off = fiada % 2 ? 6 : 0
  const xx = (x + off) % 12
  if (y % 6 === 5) return (x + y) % 2 ? 'k' : '.'
  if (xx === 11) return y % 2 ? 'k' : '.'
  if (y % 6 === 0 && (Math.floor((x + off) / 12) + fiada) % 3 === 0 && xx > 1 && xx < 9) return x % 3 === 0 ? 'd' : '.'
  return '.'
})

/**
 * Calçada vista de leve por cima: a borda do fundo (encosta no muro) escura, as juntas das placas em diagonal (dá a
 * profundidade) e um grão ralo; o lado da rua pega mais luz. 24 × 8; as pessoas pisam no meio (linha 4).
 */
const calcada = gerar(24, 8, (x, y) => {
  if (y === 0) return 'k'
  if ((x + y * 2) % 12 === 0) return y > 4 ? 'e' : 'd'
  const luz = y / 8
  return BAYER[y % 4][x % 4] < luz * 5 ? 'd' : '.'
})

/** Meio-fio: a quina de cima pega a luz, a face cai na sombra. 24 × 4. */
const meioFio = gerar(24, 4, (x, y) => {
  if (y === 0) return 'm'
  if (y === 1) return x % 8 === 7 ? 'd' : 'e'
  if (y === 2) return BAYER[y % 4][x % 4] < 8 ? 'd' : 'k'
  return 'k'
})

/** Asfalto: preto com grão bem ralo. 24 × 12. */
const asfalto = gerar(24, 12, (x, y) => ((x * 7 + y * 13) % 29 === 0 ? 'd' : (x * 3 + y * 5) % 47 === 0 ? 'e' : '.'))

export interface Ladrilho {
  id: string
  sobre: string
  peca: Peca
}

export const ladrilhos: Record<string, Ladrilho> = {
  muro: { id: 'muro', sobre: 'Muro de tijolo rebocado, quase preto (repete na horizontal e na vertical).', peca: muro },
  calcada: { id: 'calcada', sobre: 'Calçada: a linha de cima é onde as pessoas pisam (âncora y).', peca: calcada },
  meioFio: { id: 'meioFio', sobre: 'Meio-fio, logo abaixo da calçada.', peca: meioFio },
  asfalto: { id: 'asfalto', sobre: 'Asfalto, por onde a moto chega.', peca: asfalto },
}

/* ───────────── poste e a luz dele ───────────── */

/**
 * Poste de rua (96 de altura; a cena do Início pede outra altura para a lâmpada caber na faixa): cano fino com aro de
 * luz, braço curvo e a luminária acesa em cima. Âncora no pé.
 */
function pecaPoste(altura = 96): Peca {
  const topo = [
    '......eeeeeeeeeeee...',
    '.....emmmmmmmmmmmme..',
    '.....eddddddddddcwc..',
    '....me.........cwwwc.',
    '....me..........ccc..',
  ]
  const cano = '...mde...............'
  const pe = ['..mmdee..............', '..mddee..............', '.mmddeee.............', '.eeeeeee.............']
  const linhas = [...topo, ...Array.from({ length: altura - topo.length - pe.length }, () => cano), ...pe]
  return { w: 21, h: linhas.length, linhas }
}

/**
 * A luz que cai da luminária: um cone em pontilhado Bayer, denso perto da lâmpada e ralo no chão, e a poça de luz
 * na calçada. Só cinza escuro (d) e médio (e): por cima do muro preto lê como luz, sem estourar. 2 quadros: o
 * segundo um pouco mais fraco (a lâmpada de vapor tremendo de vez em quando).
 */
function luzDoPoste(forca: number, h = 96): Peca {
  const w = 64
  return gerar(w, h, (x, y) => {
    const cx = w / 2
    const abre = 3 + (y / h) * 28 // o cone abre para baixo
    const dx = Math.abs(x + 0.5 - cx) / abre
    // poça no chão: as últimas linhas acendem numa elipse larga
    const fundo = y > h - 8 ? Math.max(0, 1 - Math.abs(x + 0.5 - cx) / 30) * ((y - (h - 8)) / 8) : 0
    if (dx > 1 && !fundo) return '.'
    const perto = 1 - y / h // mais forte perto da lâmpada
    const v = dx > 1 ? 0 : (1 - dx * dx) * (0.3 + 0.7 * perto * perto) * forca
    const t = (BAYER[y % 4][x % 4] + 0.5) / 16
    const total = Math.max(v, fundo * 0.7 * forca)
    if (total > 0.55 && t < total - 0.4) return 'e'
    return t < total * 0.7 ? 'd' : '.'
  })
}

/* ───────────── porta da loja e o letreiro ───────────── */

/**
 * Porta da loja: batente com aro, porta de enrolar descida até 3/4 com as caneletas, e na fresta de baixo a luz de
 * dentro em pontilhado. Âncora no pé, no meio.
 */
const porta = (() => {
  const w = 30
  const h = 48
  return gerar(w, h, (x, y) => {
    if (x === 0 || x === w - 1) return 'm'
    if (x === 1 || x === w - 2) return 'e'
    if (y === 0) return 'm'
    if (y === 1) return 'e'
    // porta de enrolar: caneletas a cada 3 linhas, até a linha 38
    if (y < 39) return y % 3 === 2 ? 'k' : y % 3 === 0 ? 'e' : 'd'
    if (y === 39) return 'm' // a barra de baixo da porta
    // fresta: a luz de dentro, mais forte no chão
    const v = (y - 39) / 9
    return BAYER[y % 4][x % 4] < v * 10 ? 'e' : BAYER[y % 4][x % 4] < v * 14 ? 'd' : '.'
  })
})()

/** O GC do letreiro (letras de 5 de altura, traço de 1), em branco. Não espelha. */
const gc = p(
  `
  .www..www.
  w....w....
  w.ww.w....
  w..w.w....
  .www..www.
`,
  { fixa: true },
)

/** Letreiro em neon: moldura com o tubo aceso (w), o halo em c pontilhado e o GC no meio. */
function letreiro(aceso: boolean): Peca {
  const w = 18
  const h = 11
  const base = gerar(w, h, (x, y) => {
    const borda = x === 1 || x === w - 2 || y === 1 || y === h - 2
    const dentro = x > 1 && x < w - 2 && y > 1 && y < h - 2
    const fora = x === 0 || x === w - 1 || y === 0 || y === h - 1
    if (borda) return aceso ? 'c' : 'e'
    if (fora) return aceso && (x + y) % 2 === 0 ? 'd' : '.'
    if (dentro) return aceso && (x + y) % 2 === 0 ? 'd' : 'k'
    return '.'
  })
  const linhas = base.linhas.map((l) => [...l])
  gc.linhas.forEach((l, j) => {
    for (let i = 0; i < l.length; i++) if (l[i] !== '.') linhas[3 + j][4 + i] = aceso ? 'w' : 'm'
  })
  return { w, h, linhas: linhas.map((l) => l.join('')), fixa: true }
}

/** Dois engradados de plástico vazios, empilhados contra o muro (o gato sobe e senta em cima). 18 × 20, âncora no pé. */
const engradado = (() => {
  const um = [
    'mmmmmmmmmmmmmmmmmm',
    'meeeeeeeeeeeeeeeem',
    'me.ee.ee.ee.ee.eem',
    'me.ee.ee.ee.ee.eem',
    'meeeeeeeeeeeeeeeem',
    'me.ee.ee.ee.ee.eem',
    'me.ee.ee.ee.ee.eem',
    'meeeeeeeeeeeeeeeem',
    'dddddddddddddddddd',
    'dd..............dd',
  ]
  // o de cima um pouco torto para a direita (pilha de rua, não de loja)
  const cima = um.map((l) => '.' + l.slice(0, 17))
  return p([...cima, ...um].join('\n'))
})()

/* ───────────── montagem ───────────── */

function objeto(id: string, nome: string, pecas: Peca[], ancora: { x: number; y: number }, ms: number[], sobre: string, laco = true): Personagem {
  const w = Math.max(...pecas.map((q) => q.w))
  const h = Math.max(...pecas.map((q) => q.h))
  return criarPersonagem({
    id,
    nome,
    w,
    h,
    ancora,
    paleta: paletaCenario,
    animacoes: { parado: { sobre, quadros: pecas.map((q) => [[q, 0, 0]] as const), ms, laco } },
  })
}

/** Poste de `altura` linhas (âncora no pé). A cena do Início pede o dela, para a lâmpada caber na faixa. */
export function criarPoste(altura = 96): Personagem {
  const pc = pecaPoste(altura)
  return objeto('poste', 'Poste', [pc], { x: 5, y: pc.h }, [1000], 'Poste com a luminária acesa (âncora no pé).', false)
}

/** Luz do poste com `altura` linhas, da lâmpada até a poça no chão (âncora no alto). */
export function criarLuz(altura = 96): Personagem {
  return objeto(
    'luz',
    'Luz do poste',
    [luzDoPoste(1, altura), luzDoPoste(1, altura), luzDoPoste(0.8, altura), luzDoPoste(1, altura)],
    { x: 32, y: 0 },
    [2600, 90, 70, 1800],
    'Cone de luz em pontilhado; a âncora fica no alto (debaixo da lâmpada). Treme de leve de vez em quando.',
  )
}

export const objetos: Record<string, Personagem> = {
  poste: criarPoste(),
  luz: criarLuz(),
  engradado: objeto('engradado', 'Engradados', [engradado], { x: 9, y: engradado.h }, [1000], 'Dois engradados empilhados contra o muro; o gato senta em cima para ganhar carinho (âncora no pé).', false),
  porta: objeto('porta', 'Porta da loja', [porta], { x: 15, y: porta.h }, [1000], 'Porta de enrolar a 3/4, com a luz de dentro na fresta (âncora no pé, no meio).', false),
  letreiro: objeto(
    'letreiro',
    'Letreiro GC',
    [letreiro(true), letreiro(false), letreiro(true), letreiro(false), letreiro(true)],
    { x: 9, y: 11 },
    [3200, 70, 90, 60, 2400],
    'Letreiro GC em neon, em cima da porta; pisca seco de vez em quando (âncora embaixo, no meio).',
  ),
}

/* ───────────── sombra no chão ───────────── */

/**
 * Sombra de chão de cada um, como a do mercador ao lado do perfil: três linhas em d (o cinza da bolha), mais largas no
 * meio, pontilhadas nas pontas. Âncora no meio da linha do meio: o motor põe no ponto do chão de quem pisa, antes de
 * desenhar a pessoa (a linha de cima fica atrás da sola).
 */
function sombra(largura: number): Peca {
  const linhas = [0.78, 1, 0.7].map((f) => {
    const w = Math.round(largura * f)
    const ini = Math.floor((largura - w) / 2)
    return Array.from({ length: largura }, (_, x) => {
      if (x < ini || x >= ini + w) return '.'
      const ponta = x < ini + 2 || x >= ini + w - 2
      return ponta ? (x % 2 ? 'd' : '.') : 'd'
    }).join('')
  })
  return { w: largura, h: 3, linhas }
}

const larguraDaSombra: Record<string, number> = { mercador: 30, skatista: 28, motoboy: 50, mc: 18, turista: 22, gato: 14 }

/** Uma sombra por personagem do elenco (mesmo id). */
export const sombras: Record<string, Personagem> = Object.fromEntries(
  Object.entries(larguraDaSombra).map(([id, w]) => [id, objeto(`sombra-${id}`, `Sombra (${id})`, [sombra(w)], { x: Math.floor(w / 2), y: 1 }, [1000], 'Sombra no chão (âncora no meio).', false)]),
)

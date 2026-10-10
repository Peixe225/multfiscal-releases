// O MC underground: capuz na cabeça, fone grande branco por cima do capuz, corrente dourada com medalha, moletom
// índigo, calça jogger preta e tênis de cano alto. Chega balançando no beat (cabeça e ombros em degraus), faz o toque
// de mão com o mercador em 3 tempos, leva uma lata de Arizona e sai dançando (as notas musicais saem do fone).
// Tocado: para numa pose de b-boy (braços cruzados, queixo para cima).
//
// Boneco: cabeça (capuz + fone), moletom e tênis desenhados; braços e pernas gerados com a luz de cima.
// Quadro 40 × 68, chão na linha 68. Olhando para a direita.

import { camadasDaManga, manga, p, trocar, type Camada, type Peca, type Ponto } from './compor'
import { lataArizona } from './itens'
import { criarPersonagem, type AnimacaoDef, type QuadroDef } from './modelo'

const W = 40
const H = 68

const paleta: Record<string, string> = {
  // moletom índigo: aro, luz, base, sombra, fundo
  Q: '#8293d2',
  O: '#5768aa',
  o: '#3a467c',
  r: '#262e56',
  R: '#171c38',
  // calça jogger preta
  J: '#525252',
  j: '#262626',
  i: '#161616',
  // fone branco
  h: '#ececec',
  H: '#a8a8a8',
  E: '#5a5a5a',
  // corrente dourada
  c: '#e0b040',
  C: '#fff0a0',
  d: '#8f6a1e',
  // pele
  A: '#93624a',
  a: '#6a4430',
  b: '#42281a',
  e: '#0c0808',
  // tênis de cano alto: branco, cadarço vermelho, sola
  w: '#e8e8e8',
  g: '#a8a8a8',
  G: '#585858',
  L: '#d0303a',
  // a lata de Arizona (mesmas cores dos itens)
  z: '#7ccaa8',
  Z: '#e892ad',
  q: '#fdf6e4',
  k: '#1d5a3b',
  m: '#a8a8a8',
}

const aro = {
  o: ['Q', 'O'],
  O: ['Q', 'O'],
  r: ['O', 'o'],
  R: ['o', 'r'],
  j: ['J', 'J'],
  i: ['J', 'j'],
  a: ['A', 'a'],
  b: ['a', 'a'],
} as const

/* ───────────── cabeça: capuz + fone ───────────── */

// Capuz arredondado, o rosto na abertura da direita (a borda do capuz faz sombra na testa), o fone grande no lugar da
// orelha e o arco por cima do capuz.
const cabeca = p(`
  ......hhhhhh.....
  ....hhOOOOOOhh...
  ...hOOooooooOOh..
  ..hhoooooooooooO.
  .HHhhhoooobbbbbO.
  HhhhHhhoooaaaaaAo
  hhEEHhhoobaeaaeAo
  hhEEHhhoobaaaaaaA
  HhhhHhhooobaaaab.
  .HHhhhoooooabbb..
  ...hoooooooooo...
  ....ooooooooo....
`)
/** Olhos fechados (curtindo o som) e a boca do riso; postos na linha dos olhos (6 da cabeça). */
const curtindo = p(`
  ..........bb.bb.
`)
const riso = p(`
  ..............
  ..............
  ...........beb
`)

/* ───────────── tronco: moletom com a corrente ───────────── */

const moletom = p(`
  ..rOOOOOOOO...
  .rOoooooooOO..
  rOoooooooooOO.
  roooooooooooO.
  rooooooooooooo
  rroooooooooooo
  rroooooooooooo
  rrooooooooooor
  rrrooorrrrrrrr
  rrroooooooooor
  rrrooooooooorr
  rrrroooooooorr
  rrrrrrrrrrrrrr
  RRRRRRRRRRRRRR
  .RRRRRRRRRRRR.
`)
/** Corrente dourada com a medalha, por cima do moletom (balança 1 px no beat). */
const corrente = p(`
  c.......c
  .c.....c.
  ..c...c..
  ...cCc...
  ...cdc...
  ....c....
`)

/* ───────────── pés e mãos ───────────── */

/** Tênis de cano alto (o tornozelo fica na coluna 3). */
const tenis = p(`
  .www....
  .wLw....
  wwLww...
  wwwwwgw.
  wwwwwwww
  GGGGGGGG
`)
/** Na ponta (passo de dança, pé que sai do chão). */
const tenisPonta = p(`
  .www...
  .wLw...
  wwLww..
  wwwwwg.
  .wwwwww
  ...GGGG
`)
/** Mão aberta de pé (primeiro tempo do toque), punho (terceiro) e a lata na mão. */
const maoAberta = p(`
  a.a.
  aaaa
  aaaA
  .aa.
`)
const punho = p(`
  aaa
  aaA
  .b.
`)

/** A lata de Arizona nas letras desta paleta (o c daqui é o ouro da corrente). */
const lata = trocar(lataArizona, { c: 'm', G: 'k' })

const PELE = { miolo: 'a', luz: 'a', sombra: 'b' }
const MANGA = { miolo: 'o', luz: 'O', sombra: 'r' }
const CALCA = { miolo: 'j', luz: 'j', sombra: 'i' }

type Perna = readonly [joelho: Ponto, tornozelo: Ponto, tenis?: Peca]
type Braco = readonly [cotovelo: Ponto, pulso: Ponto, mao?: Peca | null]

interface Pose {
  cx?: number
  cy?: number
  /** Cabeça a mais (o aceno no beat: desce 1 a 2 px além do corpo). */
  cabeca?: number
  longe: Perna
  perto: Perna
  bracoLonge: Braco
  bracoPerto: Braco
  rosto?: Peca
  correnteDx?: number
  extra?: Camada[]
  mao?: Ponto | null
  evento?: string
}

const pt = (x: number, y: number): Ponto => ({ x, y })

const OMBRO_LONGE = pt(13.5, 25.5)
const OMBRO_PERTO = pt(23.5, 25.5)
const QUADRIL_LONGE = pt(15.5, 37.5)
const QUADRIL_PERTO = pt(20.5, 37.5)
const TRONCO = pt(10, 23)
const CABECA = pt(8, 12)
const CHAO_T = 60.5

function boneco(ps: Pose): QuadroDef {
  const cx = ps.cx ?? 0
  const cy = ps.cy ?? 0
  const ch = ps.cabeca ?? 0
  const mais = (a: Ponto) => pt(a.x + cx, a.y + cy)
  const camadas: Camada[] = []
  const perna = (quadril: Ponto, [joelho, tornozelo, tn]: Perna) => [
    ...camadasDaManga(manga([mais(quadril), joelho, tornozelo], 2.5, CALCA)),
    [tn ?? tenis, Math.round(tornozelo.x) - 3, Math.round(tornozelo.y) + 1] as const,
  ]
  const braco = (ombro: Ponto, [cotovelo, pulso, mao]: Braco) => {
    const mg = camadasDaManga(manga([mais(ombro), cotovelo, pulso], 2.2, MANGA))
    const m: Camada[] =
      mao === null ? [] : mao ? [[mao, Math.round(pulso.x) - 1, Math.round(pulso.y) - 1]] : camadasDaManga(manga([pulso, pulso], 1.5, PELE))
    return { mg, m }
  }
  const bl = braco(OMBRO_LONGE, ps.bracoLonge)
  camadas.push(...bl.m, ...bl.mg)
  camadas.push(...perna(QUADRIL_LONGE, ps.longe))
  camadas.push(...perna(QUADRIL_PERTO, ps.perto))
  camadas.push([moletom, TRONCO.x + cx, TRONCO.y + cy])
  camadas.push([corrente, 13 + cx + (ps.correnteDx ?? 0), 24 + cy])
  camadas.push([cabeca, CABECA.x + cx, CABECA.y + cy + ch])
  if (ps.rosto) camadas.push([ps.rosto, CABECA.x + cx, CABECA.y + cy + ch + 6])
  const bp = braco(OMBRO_PERTO, ps.bracoPerto)
  camadas.push(...bp.mg, ...bp.m)
  camadas.push(...(ps.extra ?? []))
  return { camadas, mao: ps.mao ?? null, evento: ps.evento }
}

/* ───────────── poses ───────────── */

// Parado no beat: o corpo desce 1 no tempo, a cabeça 2 (atrasada), os ombros sobem e descem.
function noBeat(tempo: 0 | 1, op: Partial<Pose> = {}): QuadroDef {
  const cy = tempo
  return boneco({
    cy,
    cabeca: tempo,
    longe: [pt(15.5, 49.5), pt(14.5, CHAO_T)],
    perto: [pt(21.5, 49.5), pt(22.5, CHAO_T)],
    bracoLonge: [pt(12.5, 33.5 + cy), pt(14.5, 40.5 + cy)],
    bracoPerto: [pt(24.5, 33.5 + cy), pt(22.5, 40.5 + cy)],
    correnteDx: tempo,
    ...op,
  })
}

// Andar no beat: passo largo e quicado, a cabeça manda (desce no apoio), os braços soltos.
function andando(fase: 0 | 1 | 2 | 3): QuadroDef {
  const cy = [0, 2, 0, 2][fase]
  const pernas: [Perna, Perna][] = [
    [[pt(13.5, 49.5), pt(10.5, CHAO_T)], [pt(24.5, 48.5), pt(26.5, CHAO_T)]],
    [[pt(15.5, 50.5), pt(14.5, CHAO_T - 2), tenisPonta], [pt(22.5, 50.5), pt(22.5, CHAO_T)]],
    [[pt(22.5, 48.5), pt(25.5, CHAO_T)], [pt(16.5, 49.5), pt(11.5, CHAO_T)]],
    [[pt(18.5, 50.5), pt(19.5, CHAO_T)], [pt(18.5, 50.5), pt(17.5, CHAO_T - 2), tenisPonta]],
  ]
  const [l, p2] = pernas[fase]
  const bal = [1, 0, -1, 0][fase]
  return boneco({
    cy,
    cabeca: cy ? 1 : 0,
    longe: l,
    perto: p2,
    bracoLonge: [pt(12.5 + bal, 33.5 + cy), pt(13.5 + 2 * bal, 40.5 + cy)],
    bracoPerto: [pt(24.5 - bal, 33.5 + cy), pt(24.5 - 2 * bal, 40.5 + cy)],
    correnteDx: fase % 2,
  })
}

// Dança de saída com a lata: passo para o lado e volta, braço da lata erguido no tempo.
function dancando(fase: 0 | 1 | 2 | 3): QuadroDef {
  const cy = [0, 2, 0, 1][fase]
  const pernas: [Perna, Perna][] = [
    [[pt(13.5, 49.5), pt(11.5, CHAO_T)], [pt(23.5, 49.5), pt(25.5, CHAO_T)]],
    [[pt(16.5, 51.5), pt(15.5, CHAO_T)], [pt(22.5, 49.5), pt(26.5, CHAO_T - 3), tenisPonta]],
    [[pt(14.5, 49.5), pt(12.5, CHAO_T)], [pt(22.5, 49.5), pt(23.5, CHAO_T)]],
    [[pt(15.5, 49.5), pt(11.5, CHAO_T - 3), tenisPonta], [pt(21.5, 51.5), pt(21.5, CHAO_T)]],
  ]
  const [l, p2] = pernas[fase]
  const alto = fase % 2 === 1
  return boneco({
    cy,
    cabeca: cy ? 1 : 0,
    longe: l,
    perto: p2,
    bracoLonge: [pt(10.5, 31.5 + cy), pt(alto ? 8.5 : 10.5, alto ? 26.5 + cy : 36.5 + cy)],
    bracoPerto: [pt(27.5, 28.5 + cy), pt(28.5, alto ? 18.5 + cy : 22.5 + cy), null],
    rosto: alto ? curtindo : riso,
    correnteDx: fase % 2,
    extra: [[lata, 27, (alto ? 10 : 14) + cy]],
    evento: fase === 1 ? 'nota' : undefined,
  })
}

const toque1: Braco = [pt(28.5, 29.5), pt(33.5, 23.5), maoAberta]
const toque2: Braco = [pt(28.5, 31.5), pt(34.5, 29.5), punho]
const toque3: Braco = [pt(28.5, 31.5), pt(33.5, 30.5), punho]
const estende: Braco = [pt(28.5, 31.5), pt(34.5, 29.5)]
const segurando: Braco = [pt(27.5, 32.5), pt(28.5, 27.5), null]

const animacoes: Record<string, AnimacaoDef> = {
  chegar: {
    sobre: 'Chega andando no beat: passo quicado, a cabeça desce no apoio, ombros e corrente balançam.',
    quadros: [andando(0), andando(1), andando(2), andando(3)],
    ms: 150,
    passo: 3,
    laco: true,
  },
  parado: {
    sobre: 'Parado curtindo o som: cabeça e ombros no tempo, em degrau; fecha o olho de vez em quando.',
    quadros: [noBeat(0), noBeat(1), noBeat(0), noBeat(1), noBeat(0), noBeat(1, { rosto: curtindo }), noBeat(0, { rosto: curtindo }), noBeat(1)],
    ms: 250,
    laco: true,
  },
  toque: {
    sobre: 'Toque de mão em 3 tempos com o mercador: palma no alto ("toque1"), aperto ("toque2"), punho que volta ("toque3"); ri no fim.',
    quadros: [
      noBeat(0),
      noBeat(0, { bracoPerto: [pt(27.5, 32.5), pt(30.5, 30.5)] }),
      noBeat(0, { bracoPerto: toque1, mao: pt(34, 22), evento: 'toque1' }),
      noBeat(1, { bracoPerto: toque2, mao: pt(35, 29), evento: 'toque2' }),
      noBeat(1, { bracoPerto: toque2 }),
      noBeat(0, { bracoPerto: toque3, mao: pt(34, 30), evento: 'toque3' }),
      noBeat(0, { bracoPerto: [pt(25.5, 30.5), pt(26.5, 25.5), punho], rosto: riso }),
      noBeat(1, { rosto: riso }),
    ],
    ms: [160, 120, 260, 260, 120, 260, 300, 300],
  },
  pegar: {
    sobre: 'Estica a mão, pega a lata de Arizona (evento "pega") e ergue na altura do rosto, curtindo.',
    quadros: [
      noBeat(0),
      noBeat(0, { bracoPerto: estende, mao: pt(35, 29) }),
      noBeat(0, { bracoPerto: estende, mao: pt(35, 29), evento: 'pega' }),
      noBeat(1, { bracoPerto: segurando, extra: [[lata, 27, 19]], rosto: riso }),
      noBeat(0, { bracoPerto: segurando, extra: [[lata, 27, 18]], rosto: curtindo }),
    ],
    ms: [150, 300, 300, 260, 400],
  },
  sair: {
    sobre: 'Sai dançando com a lata erguida: passo para o lado no tempo, olho fechado; evento "nota" a cada tempo (o motor solta uma nota musical do fone).',
    quadros: [dancando(0), dancando(1), dancando(2), dancando(3)],
    ms: 220,
    passo: [3, 2, 3, 2],
    laco: true,
  },
  reagir: {
    sobre: 'Tocado: pose de b-boy, braços cruzados e queixo para cima; segura e volta ao beat.',
    quadros: [
      noBeat(0),
      noBeat(0, { cx: -1, bracoPerto: [pt(25.5, 31.5), pt(16.5, 31.5)], bracoLonge: [pt(12.5, 31.5), pt(21.5, 30.5)], rosto: riso }),
      noBeat(0, { cx: -1, cabeca: -1, bracoPerto: [pt(25.5, 31.5), pt(16.5, 31.5)], bracoLonge: [pt(12.5, 31.5), pt(21.5, 30.5)], rosto: curtindo }),
      noBeat(1),
    ],
    ms: [100, 200, 800, 200],
  },
}

export const mc = criarPersonagem({
  id: 'mc',
  nome: 'MC',
  w: W,
  h: H,
  ancora: { x: 18, y: H },
  paleta,
  aro,
  animacoes,
})

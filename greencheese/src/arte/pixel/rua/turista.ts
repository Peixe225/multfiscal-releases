// O turista gringo: baixinho e redondo, chapéu de pescador cor de areia, camisa estampada verde-água com bolinhas
// coral e amarelas, pochete preta com o zíper amarelo, câmera pendurada no pescoço, bermuda cáqui, meia branca e
// sandália. Chega lendo o mapa aberto (o rosto some atrás dele), para, se espanta, tira FOTO do mercador (flash em
// degrau), compra uma piteira de vidro, paga e sai feliz guardando a câmera. Tocado: faz uma selfie.
//
// Boneco: cabeça, camisa, pochete, câmera, mapa e pés desenhados; braços (manga curta + braço) e pernas (bermuda +
// canela) gerados com a luz de cima. Quadro 44 × 62, chão na linha 62. Olhando para a direita.

import { camadasDaManga, manga, p, type Camada, type Peca, type Ponto } from './compor'
import { criarPersonagem, type AnimacaoDef, type QuadroDef } from './modelo'

const W = 44
const H = 62

const paleta: Record<string, string> = {
  // chapéu de pescador cor de areia
  H: '#ead9a8',
  h: '#bea676',
  u: '#7e6c46',
  // pele clara, bochecha e nariz rosados
  A: '#f2c6a6',
  a: '#d49a7a',
  b: '#a06a54',
  v: '#e8766a',
  e: '#1a1210',
  // camisa verde-água estampada
  T: '#62c4b8',
  t: '#2e8a84',
  s: '#1f625e',
  S: '#143f3c',
  c: '#ff8a70',
  y: '#ffd25a',
  w: '#f4f4f4',
  // bermuda cáqui
  K: '#d6bd88',
  k: '#a48b5a',
  g: '#6e5c3a',
  // sandália
  n: '#7a4e2c',
  N: '#4a2e18',
  // pochete e câmera (pretas com aro), zíper amarelo, lente
  f: '#1e1e1e',
  F: '#5a5a5a',
  Y: '#e2e84a',
  L: '#8aa3b8',
  // mapa: papel, dobra, rua, rio, o ponto vermelho
  P: '#efe3c4',
  m: '#c6b38c',
  r: '#8aa3b8',
  R: '#d0303a',
}

const aro = {
  t: ['T', 'T'],
  s: ['t', 't'],
  S: ['s', 's'],
  k: ['K', 'K'],
  g: ['k', 'k'],
  h: ['H', 'H'],
  f: ['F', 'F'],
  a: ['A', 'a'],
  b: ['a', 'a'],
} as const

/* ───────────── cabeça ───────────── */

// Chapéu de pescador com a aba caída em volta, rosto redondo de 3/4 na sombra da aba, bochecha rosada, sorriso.
const cabeca = p(`
  .....HHHHH.....
  ....Hhhhhhh....
  ...Hhhhhhhhh...
  ..HHhhhhhhhhHH.
  .Hhhhhhhhhhhhhh
  .uuuuuuuuuuuuu.
  ...aaaaaaaaaa..
  ...aaaaeaaaeaA.
  ..aaavaaaaavaA.
  ...aaaaaNNNNa..
  ....aaaaabba...
  .....bbbbbb....
`)
/** Olhos arregalados (o susto ao ver o mercador). */
const espanto = p(`
  .......w...w..
  .......e...e..
`)
/** Olho fechado de contente e a boca aberta de riso. */
const feliz = p(`
  ..............
  .......b...b..
  ..............
  ........NNNN..
  ........beeb..
`)

/* ───────────── tronco: camisa estampada, barriga para a frente ───────────── */

const camisa = p(`
  ....TTTTTTTT.....
  ..TTttwwttttTT...
  .TttcttwtttyttT..
  TttttttyttttcttT.
  tttyttttttcttttt.
  tttttcttttttyttTt
  sttttttttttttttct
  sstcttttyttttttty
  sstttttttttcttttt
  ssttttcttttttttts
  sssttttttttytttss
  ssssttttttttttsss
  .SsssssssssssssS.
  ..SSSSSSSSSSSSS..
`)
/** Pochete na barriga: preta, zíper amarelo, a alça some atrás. */
const pochete = p(`
  FFFFFFFFFF
  fYYYYYYYYf
  ffffffffff
  .ffffffff.
`)
/** Câmera pendurada no peito pela alça. */
const cameraPeito = p(`
  F.....F
  .F...F.
  ..FFFF.
  .ffffff
  fLLffff
  fLwffFf
  .fffff.
`)
/** Câmera no olho (de lado): o corpo na frente do rosto, a lente para a frente. */
const cameraOlho = p(`
  .FFFF..
  ffffffL
  ffffffL
  fffffLw
  .ffff..
`)
/** O clarão do flash na câmera, no quadro do clique. */
const clarao = p(`
  ..w..
  .www.
  wwwww
  .www.
  ..w..
`)

/** Mapa aberto nas duas mãos, de frente para ele (o verso, com as dobras); 2 jeitos para tremular. */
const mapa1 = p(`
  .mPPPPPPmPPPPPPm.
  mPPPPPPPmPPPPPPPm
  PPPrPPPPmPPPRPPPP
  PPPrrPPPmPPPPPPPP
  PPPPrPPPmPPPPrrPP
  mmmmmmmmmmmmmmmmm
  PPPPPPPPmPPPPPPPP
  PPrrrPPPmPPPrPPPP
  PPPPPPPPmPPPPPPPP
  .mPPPPPPmPPPPPPm.
`)
const mapa2 = p(`
  ..mPPPPPmPPPPPm..
  .mPPPPPPmPPPPPPm.
  mPPrPPPPmPPPRPPPm
  PPPrrPPPmPPPPPPPP
  PPPPrPPPmPPPPrrPP
  mmmmmmmmmmmmmmmmm
  PPPPPPPPmPPPPPPPP
  PPrrrPPPmPPPrPPPP
  mPPPPPPPmPPPPPPPm
  .mmPPPPPmPPPPPmm.
`)
/** Mapa dobrado ao meio (guardando). */
const mapaDobrado = p(`
  mPPPPPPm
  PPrPPRPP
  PPrrPPPP
  PPPPPrPP
  mmmmmmmm
`)

/* ───────────── pés ───────────── */

/** Meia branca e sandália (o tornozelo fica na coluna 2). */
const pe = p(`
  .ww....
  .ww....
  wwwaa..
  nnnnnnn
  NNNNNNN
`)
const pePonta = p(`
  .ww...
  .www..
  .wwwaa
  ..nnnn
  ...NNN
`)

/** Mão com dois dedos (o "paz e amor" da selfie). */
const maoPaz = p(`
  a.a.
  a.a.
  aaaa
  .aa.
`)

const PELE = { miolo: 'a', luz: 'A', sombra: 'b' }
const MANGA = { miolo: 't', luz: 'T', sombra: 's' }
const BERMUDA = { miolo: 'k', luz: 'K', sombra: 'g' }

type Perna = readonly [joelho: Ponto, tornozelo: Ponto, pe?: Peca]
type Braco = readonly [cotovelo: Ponto, pulso: Ponto, mao?: Peca | null]

interface Pose {
  cx?: number
  cy?: number
  /** Balanço de lado do andar de pato: a cabeça e o tronco inclinam 1 px. */
  ginga?: number
  longe: Perna
  perto: Perna
  bracoLonge: Braco
  bracoPerto: Braco
  rosto?: Peca | null
  camera?: 'peito' | 'olho' | 'nao'
  extra?: Camada[]
  frente?: Camada[]
  mao?: Ponto | null
  evento?: string
}

const pt = (x: number, y: number): Ponto => ({ x, y })

const OMBRO_LONGE = pt(14.5, 28.5)
const OMBRO_PERTO = pt(25.5, 28.5)
const QUADRIL_LONGE = pt(16.5, 42.5)
const QUADRIL_PERTO = pt(23.5, 42.5)
const TRONCO = pt(11, 27)
const CABECA = pt(13, 16)
const CHAO_T = 56.5

function boneco(ps: Pose): QuadroDef {
  const cx = ps.cx ?? 0
  const cy = ps.cy ?? 0
  const gx = ps.ginga ?? 0
  const mais = (a: Ponto, g = 0) => pt(a.x + cx + g, a.y + cy)
  const camadas: Camada[] = []
  const perna = (quadril: Ponto, [joelho, tornozelo, pc]: Perna): Camada[] => [
    ...camadasDaManga(manga([joelho, tornozelo], 1.8, PELE)),
    ...camadasDaManga(manga([mais(quadril), pt((quadril.x + cx + joelho.x) / 2, (quadril.y + cy + joelho.y) / 2 + 1)], 3.4, BERMUDA)),
    [pc ?? pe, Math.round(tornozelo.x) - 2, Math.round(tornozelo.y) + 1],
  ]
  const braco = (ombro: Ponto, [cotovelo, pulso, mao]: Braco) => {
    const o = mais(ombro, gx)
    const meio = pt((o.x + cotovelo.x) / 2, (o.y + cotovelo.y) / 2)
    const pele = camadasDaManga(manga([meio, cotovelo, pulso], 1.8, PELE))
    const mg = camadasDaManga(manga([o, meio], 2.6, MANGA))
    const m: Camada[] = mao === null ? [] : mao ? [[mao, Math.round(pulso.x) - 1, Math.round(pulso.y) - 2]] : camadasDaManga(manga([pulso, pulso], 1.5, PELE))
    return [...pele, ...mg, ...m]
  }
  camadas.push(...braco(OMBRO_LONGE, ps.bracoLonge))
  camadas.push(...perna(QUADRIL_LONGE, ps.longe))
  camadas.push(...perna(QUADRIL_PERTO, ps.perto))
  camadas.push([camisa, TRONCO.x + cx + gx, TRONCO.y + cy])
  camadas.push([pochete, 16 + cx, 39 + cy])
  if ((ps.camera ?? 'peito') === 'peito') camadas.push([cameraPeito, 19 + cx + gx, 28 + cy])
  camadas.push([cabeca, CABECA.x + cx + gx, CABECA.y + cy])
  if (ps.rosto) camadas.push([ps.rosto, CABECA.x + cx + gx, CABECA.y + cy + 6])
  camadas.push(...(ps.extra ?? []))
  camadas.push(...braco(OMBRO_PERTO, ps.bracoPerto))
  camadas.push(...(ps.frente ?? []))
  return { camadas, mao: ps.mao ?? null, evento: ps.evento }
}

/* ───────────── poses ───────────── */

/** O "!" do susto, em cima do chapéu. */
const exclamacao = p(`
  ww
  ww
  ww
  ..
  ww
`)


const pernasParado: [Perna, Perna] = [
  [pt(16.5, 49.5), pt(15.5, CHAO_T)],
  [pt(24.5, 49.5), pt(25.5, CHAO_T)],
]

function parado(op: Partial<Pose> = {}): QuadroDef {
  const cy = op.cy ?? 0
  return boneco({
    longe: pernasParado[0],
    perto: pernasParado[1],
    bracoLonge: [pt(12.5, 35.5 + cy), pt(13.5, 41.5 + cy)],
    bracoPerto: [pt(27.5, 35.5 + cy), pt(27.5, 41.5 + cy)],
    ...op,
  })
}

/** Andar de pato: passo curto, o corpo ginga de um lado para o outro e quica. `mapa` = lendo o mapa aberto. */
function andando(fase: 0 | 1 | 2 | 3, mapa: boolean, feliz2 = false): QuadroDef {
  const cy = [0, 1, 0, 1][fase]
  const ginga = [0, 1, 0, -1][fase]
  const pernas: [Perna, Perna][] = [
    [[pt(15.5, 49.5), pt(13.5, CHAO_T)], [pt(25.5, 49.5), pt(27.5, CHAO_T)]],
    [[pt(17.5, 50.5), pt(17.5, CHAO_T - 2), pePonta], [pt(23.5, 50.5), pt(24.5, CHAO_T)]],
    [[pt(23.5, 49.5), pt(25.5, CHAO_T)], [pt(17.5, 49.5), pt(15.5, CHAO_T)]],
    [[pt(18.5, 50.5), pt(19.5, CHAO_T)], [pt(22.5, 50.5), pt(21.5, CHAO_T - 2), pePonta]],
  ]
  const [l, p2] = pernas[fase]
  if (mapa) {
    return boneco({
      cy,
      ginga,
      longe: l,
      perto: p2,
      bracoLonge: [pt(13.5, 33.5 + cy), pt(15.5, 25.5 + cy)],
      bracoPerto: [pt(30.5, 33.5 + cy), pt(32.5, 25.5 + cy)],
      rosto: null,
      extra: [[fase % 2 ? mapa2 : mapa1, 15 + ginga, 19 + cy]],
    })
  }
  const bal = [1, 0, -1, 0][fase]
  return boneco({
    cy,
    ginga,
    longe: l,
    perto: p2,
    bracoLonge: [pt(12.5 + bal, 35.5 + cy), pt(12.5 + 2 * bal, 41.5 + cy)],
    bracoPerto: [pt(27.5 - bal, 35.5 + cy), pt(28.5 - 2 * bal, 40.5 + cy)],
    rosto: feliz2 ? feliz : undefined,
  })
}

// Braços com a câmera no olho (os dois seguram).
const fotoLonge: Braco = [pt(18.5, 34.5), pt(24.5, 24.5), null]
const fotoPerto: Braco = [pt(29.5, 33.5), pt(28.5, 25.5), null]
const comCameraNoOlho = (op: Partial<Pose> = {}) =>
  parado({ camera: 'olho', bracoLonge: fotoLonge, bracoPerto: fotoPerto, frente: [[cameraOlho, 23, 21], ...(op.frente ?? [])], ...op })

const animacoes: Record<string, AnimacaoDef> = {
  chegar: {
    sobre: 'Chega lendo o mapa aberto na frente do rosto, andando de pato (ginga de lado e quica); o mapa tremula.',
    quadros: [andando(0, true), andando(1, true), andando(2, true), andando(3, true)],
    ms: 170,
    passo: 2,
    laco: true,
  },
  parado: {
    sobre: 'Parado, sorrindo, respira; pisca de contente.',
    quadros: [parado(), parado({ cy: 1 }), parado(), parado({ rosto: feliz })],
    ms: [700, 500, 700, 200],
    laco: true,
  },
  espantar: {
    sobre: 'Abaixa o mapa, vê o mercador e arregala o olho (o "!" sobe em cima do chapéu); dobra o mapa e guarda na pochete.',
    quadros: [
      parado({ bracoLonge: [pt(17.5, 36.5), pt(20.5, 33.5), null], bracoPerto: [pt(30.5, 36.5), pt(32.5, 33.5), null], frente: [[mapa1, 19, 26]] }),
      parado({ bracoLonge: [pt(17.5, 36.5), pt(20.5, 33.5), null], bracoPerto: [pt(30.5, 36.5), pt(32.5, 33.5), null], frente: [[mapa1, 19, 26]], rosto: espanto, cy: -1, extra: [[exclamacao, 19, 4]], evento: 'susto' }),
      parado({ bracoPerto: [pt(28.5, 36.5), pt(29.5, 34.5), null], frente: [[mapaDobrado, 26, 30]], rosto: espanto }),
      parado({ bracoPerto: [pt(27.5, 38.5), pt(25.5, 40.5)] }),
      parado(),
    ],
    ms: [200, 500, 260, 220, 300],
  },
  foto: {
    sobre: 'Leva a câmera ao olho, mira, CLIQUE (evento "flash": o motor estoura o flash na lente e pisca a cena em degrau), confere a foto e sorri.',
    quadros: [
      parado(),
      parado({ bracoPerto: [pt(28.5, 35.5), pt(27.5, 31.5)] }),
      comCameraNoOlho(),
      comCameraNoOlho({ cy: 1 }),
      comCameraNoOlho({ frente: [[clarao, 29, 20]], evento: 'flash' }),
      comCameraNoOlho(),
      parado({ camera: 'nao', bracoPerto: [pt(28.5, 36.5), pt(28.5, 32.5), null], frente: [[cameraOlho, 25, 29]], rosto: feliz }),
      parado({ rosto: feliz }),
    ],
    ms: [150, 150, 260, 240, 90, 300, 500, 300],
  },
  pegar: {
    sobre: 'Estica a mão e pega a piteira de vidro (evento "pega"), olha contente.',
    quadros: [
      parado(),
      parado({ bracoPerto: [pt(30.5, 33.5), pt(34.5, 29.5)], mao: pt(35, 28) }),
      parado({ bracoPerto: [pt(30.5, 33.5), pt(34.5, 29.5)], mao: pt(35, 28), evento: 'pega' }),
      parado({ bracoPerto: [pt(29.5, 37.5), pt(28.5, 32.5)], mao: pt(28, 31), rosto: feliz }),
      parado({ bracoPerto: [pt(28.5, 38.5), pt(23.5, 40.5)], evento: 'guarda' }),
      parado({ rosto: feliz }),
    ],
    ms: [150, 300, 300, 400, 260, 300],
  },
  pagar: {
    sobre: 'Abre a pochete, tira a nota e estende (evento "paga" com a nota na mão).',
    quadros: [
      parado(),
      parado({ bracoPerto: [pt(27.5, 38.5), pt(23.5, 40.5)] }),
      parado({ bracoPerto: [pt(30.5, 33.5), pt(34.5, 29.5)], mao: pt(35, 28) }),
      parado({ bracoPerto: [pt(30.5, 33.5), pt(34.5, 29.5)], mao: pt(35, 28), evento: 'paga' }),
      parado(),
    ],
    ms: [150, 260, 300, 400, 300],
  },
  sair: {
    sobre: 'Sai feliz, de olho fechado, andando de pato com um pulinho; a câmera guardada no peito.',
    quadros: [andando(0, false, true), andando(1, false, true), andando(2, false, true), andando(3, false, true)],
    ms: 160,
    passo: 2,
    laco: true,
  },
  reagir: {
    sobre: 'Tocado: vira a câmera para si e faz uma selfie com o "paz e amor" (flash pequeno).',
    quadros: [
      parado(),
      parado({ camera: 'nao', bracoPerto: [pt(30.5, 30.5), pt(33.5, 23.5), null], frente: [[cameraOlho, 31, 18, { virar: true }]], bracoLonge: [pt(11.5, 30.5), pt(10.5, 23.5), maoPaz] }),
      parado({ camera: 'nao', bracoPerto: [pt(30.5, 30.5), pt(33.5, 23.5), null], frente: [[cameraOlho, 31, 18, { virar: true }], [clarao, 29, 16]], bracoLonge: [pt(11.5, 30.5), pt(10.5, 23.5), maoPaz], rosto: feliz, evento: 'flash' }),
      parado({ camera: 'nao', bracoPerto: [pt(30.5, 30.5), pt(33.5, 23.5), null], frente: [[cameraOlho, 31, 18, { virar: true }]], bracoLonge: [pt(11.5, 30.5), pt(10.5, 23.5), maoPaz], rosto: feliz }),
      parado({ rosto: feliz }),
    ],
    ms: [100, 300, 90, 400, 300],
  },
}


export const turista = criarPersonagem({
  id: 'turista',
  nome: 'Turista',
  w: W,
  h: H,
  ancora: { x: 20, y: H },
  paleta,
  aro,
  animacoes,
})

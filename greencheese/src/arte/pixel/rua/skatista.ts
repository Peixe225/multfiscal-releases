// O skatista: alto e magro, boné de aba reta virado para trás, moletom largo laranja-queimado, jeans largo
// empilhando em cima do tênis branco grandão, e o skate. Chega rodando, freia arrastando o pé, aponta para o casaco
// do mercador, leva um livreto de seda (guarda no bolso canguru), paga, sobe no skate, rema e sai dando um ollie.
// Tocado, ele dá um pop shove-it no lugar (o skate gira embaixo dele).
//
// Boneco: cabeça, moletom e tênis desenhados; pernas e braços gerados (manga) com a luz de cima, como o mercador.
// Quadro 44 × 78. As poses são escritas com o chão na linha 72 e descem 6 linhas no quadro (sobra para o ollie).
// Âncora no chão, no meio dos pés. Olhando para a direita.

import { camadasDaManga, manga, p, type Camada, type Peca, type Ponto } from './compor'
import { criarPersonagem, type AnimacaoDef, type QuadroDef } from './modelo'

const W = 44
const H = 78
/** As poses usam o chão em 72; o quadro tem 6 linhas a mais em cima. */
const DY = 6

const paleta: Record<string, string> = {
  // pele (luz de poste por cima, o resto na sombra)
  A: '#c08a62',
  a: '#8a5a3c',
  b: '#5a3826',
  e: '#140e0c', // olho
  // cabelo e boné (preto, com aro cinza)
  h: '#161616',
  k: '#222222',
  K: '#5a5a5a',
  // moletom laranja-queimado: aro, luz, base, sombra, fundo da dobra
  Q: '#e0874a',
  O: '#b45a2c',
  o: '#84401f',
  r: '#5a2a15',
  R: '#38190c',
  w: '#e8e8e8', // cordão, tênis
  // jeans largo
  J: '#86a4c6',
  j: '#56749a',
  i: '#3c5372',
  I: '#28384e',
  // tênis
  g: '#a8a8a8',
  G: '#5a5a5a',
  // skate: madeira, lixa, truck e roda
  d: '#b07c4c',
  D: '#6e4a2c',
  l: '#141414',
  L: '#4a4a4a',
  t: '#8aa3b8',
  T: '#4d5762',
  u: '#d8cfb4',
  U: '#8f876e',
}

/** Luz de cima na borda da silhueta (o aro m do mercador, em cada material). */
const aro = {
  o: ['Q', 'O'],
  O: ['Q', 'O'],
  r: ['O', 'o'],
  R: ['o', 'r'],
  i: ['J', 'j'],
  j: ['J', 'j'],
  I: ['j', 'i'],
  k: ['K', 'K'],
  h: ['K', 'K'],
  a: ['A', 'a'],
  b: ['a', 'b'],
} as const

/* ───────────── cabeça (boné para trás, rosto de 3/4) ───────────── */

// Copa baixa colada na cabeça, aba reta para trás (esquerda) na altura da testa, e na frente a abertura do
// regulador com o cabelo aparecendo. Orelha atrás, nariz para fora, queixo na sombra.
const cabeca = p(`
  .....kkkkk....
  ...kkkkkkkkk..
  ..kkkkkkkkkkk.
  kkkkkkkkkkkhk.
  ...hkkkkkkkkk.
  ...hhaAAAAAAA.
  ...haaaaeaaea.
  ...abaaaaaaaaA
  ....baaaaaaab.
  ....baaaaabb..
  .....bbbbb....
`)
/** Olhos fechados (piscar). */
const piscar = p(`
  ........b..b
`)
/** Sorriso (depois do shove-it, quando pega a seda). */
const sorriso = p(`
  .........ab
`)

/* ───────────── tronco: moletom largo ───────────── */

// Ombros largos e caídos, capuz embolado atrás da nuca, cordão branco, bolso canguru, barra com punho.
// A luz vem de cima: ombros acesos, peito na base, barriga e barra na sombra.
const moletom = p(`
  ...oOOOO.........
  ..oOOooOOw.OO....
  .oOoooooOw.OoOO..
  oOooooooowooooOO.
  ooooooooowoooooOo
  ooooooooooooooooo
  ooooooooooooooooo
  roooooooooooooooo
  rroooooooooooooor
  rroooooooooooooor
  rrooooorrrrrroooo
  rrrooooooooooooor
  rrroooooooooooorr
  rrrroooooooooorrr
  rrrrrooooooorrrrr
  rrrrrrrrrrrrrrrrr
  rrrrrrrrrrrrrrrrr
  RrrrrrrrrrrrrrrrR
  RrrrrrrrrrrrrrrrR
  RRRRRRRRRRRRRRRRR
  RRRRRRRRRRRRRRRRR
`)

/* ───────────── pés e mãos ───────────── */

/** Tênis grandão de lado, bico para a direita (o tornozelo fica na coluna 3). */
const tenis = p(`
  ...www.....
  ..wwwgww...
  .wwwwwwwww.
  wwwwwwwwwww
  GGGGGGGGGGG
`)
/** Na ponta (empurrando o chão, arrastando no freio). */
const tenisPonta = p(`
  ..www....
  .wwwgw...
  .wwwwwww.
  ..wwwwwww
  ....GGGGG
`)
/** A barra do jeans empilhada em cima do tênis. */
const barra = p(`
  .ijjjjji.
  IiiiiiiiI
`)

/** Mão apontando (indicador para a direita). */
const dedo = p(`
  .aa...
  aaaaaA
  .bb...
`)
/** Palma aberta para cima (recebe). */
const palma = p(`
  a....
  aaaaA
  .bbb.
`)

/* ───────────── skate ───────────── */

/** De lado: lixa preta com aro em cima, madeira na borda, truck e rodas; rabeta e bico sobem. 28 × 8. */
const skate = p(`
  L..........................L
  lL........................Ll
  .lLLLLLLLLLLLLLLLLLLLLLLLLl.
  ..dddddddddddddddddddddddd..
  .....tTt............tTt.....
  ....uuuU...........uuuU.....
  ....uUuU...........uUuU.....
  .....UU.............UU......
`)
/** Rodas giradas (o miolo troca de lado): alterna com o de cima para rodar. */
const skateRoda = p(`
  L..........................L
  lL........................Ll
  .lLLLLLLLLLLLLLLLLLLLLLLLLl.
  ..dddddddddddddddddddddddd..
  .....tTt............tTt.....
  ....uUuU...........uUuU.....
  ....uuuU...........uuuU.....
  .....UU.............UU......
`)
/**
 * Na batida do ollie: rabeta no chão, bico para cima. Gerado em degrau de 3: em cada linha a lixa acesa (L) por cima
 * e a madeira (d) por baixo, emendando na diagonal (tábua cheia, sem furo); trucks e rodas pendurados nas pontas.
 */
const skatePop: Peca = (() => {
  const w = 28
  const h = 13
  const t = Array.from({ length: h }, () => Array<string>(w).fill('.'))
  const por = (x: number, y: number, c: string) => {
    if (x >= 0 && x < w && y >= 0 && y < h) t[y][x] = c
  }
  for (let r = 0; r < 10; r++) {
    const x0 = 25 - 3 * r
    for (let i = 0; i < 6; i++) por(x0 + i, r, i < 3 ? 'L' : 'd')
  }
  // truck e rodas da frente (debaixo do bico) e de trás (debaixo da rabeta)
  const rodas = (x: number, y: number) => {
    ;['tTt', 'uuuU', 'uUuU', '.UU.'].forEach((l, j) => [...l].forEach((c, i) => c !== '.' && por(x + i - (j ? 1 : 0), y + j, c)))
  }
  rodas(21, 4)
  rodas(7, 9)
  return { w, h, linhas: t.map((l) => l.join('')) }
})()

/** De ponta (girando no shove-it): só a largura da tábua, as duas rodas lado a lado. 8 × 7. */
const skatePonta = p(`
  .LLLLLL.
  llllllll
  .dddddd.
  ..tTTt..
  .uUttuU.
  .uU..uU.
  ..U...U.
`)
/** No meio do giro: a tábua encurtada pela perspectiva. 16 × 8. */
const skateMeio = p(`
  L..............L
  lLLLLLLLLLLLLLLl
  .dddddddddddddd.
  ...tTt....tTt...
  ..uuuU...uuuU...
  ..uUuU...uUuU...
  ...UU.....UU....
  ................
`)

/** Riscos no chão do freio (o tênis raspando; nada de poeira). */
const raspa1 = p(`
  GG.G..G
`)
const raspa2 = p(`
  .G.GG.G
`)

/* ───────────── boneco ───────────── */

const PELE = { miolo: 'a', luz: 'a', sombra: 'b' }
const MANGA = { miolo: 'o', luz: 'O', sombra: 'r' }
const JEANS = { miolo: 'i', luz: 'j', sombra: 'I' }

type Perna = readonly [joelho: Ponto, tornozelo: Ponto, tenis?: Peca]
type Braco = readonly [cotovelo: Ponto, pulso: Ponto, mao?: Peca]

interface Pose {
  /** Deslocamento do corpo (tronco, cabeça, ombros, quadril). */
  cx?: number
  cy?: number
  longe: Perna
  perto: Perna
  bracoLonge: Braco
  bracoPerto: Braco
  skate?: readonly [Peca, number, number] | null
  rosto?: Peca
  extra?: Camada[]
  /** Ponto da mão de perto que segura um item (coordenadas da pose). */
  mao?: Ponto | null
  evento?: string
}

// Encaixes no corpo parado (cx = cy = 0), chão em 72 (sola na linha 71).
const OMBRO_LONGE = { x: 15.5, y: 26.5 }
const OMBRO_PERTO = { x: 25.5, y: 26.5 }
const QUADRIL_LONGE = { x: 17.5, y: 43.5 }
const QUADRIL_PERTO = { x: 22.5, y: 43.5 }
const TRONCO = { x: 11, y: 24 }
const CABECA = { x: 15, y: 13 }

/** Tornozelo de quem pisa no chão e de quem pisa no skate (lixa na linha 66). */
const CHAO_T = 65.5
const SK_T = 60.5
/** Linha de cima do skate deitado no chão. */
const SK_Y = 64

const pt = (x: number, y: number): Ponto => ({ x, y })
const mais = (a: Ponto, dx: number, dy: number) => pt(a.x + dx, a.y + dy)
const desce = (c: Camada): Camada => [c[0], c[1], c[2] + DY, ...(c[3] ? [c[3]] : [])] as unknown as Camada

function boneco(ps: Pose): QuadroDef {
  const cx = ps.cx ?? 0
  const cy = ps.cy ?? 0
  const camadas: Camada[] = []
  if (ps.skate) camadas.push(ps.skate)

  const perna = (quadril: Ponto, [joelho, tornozelo, tn]: Perna) => {
    const mg = manga([mais(quadril, cx, cy), joelho, tornozelo], 3.1, JEANS)
    const t = tn ?? tenis
    const tx = Math.round(tornozelo.x)
    const ty = Math.round(tornozelo.y)
    return [...camadasDaManga(mg), [barra, tx - 4, ty - 1] as const, [t, tx - 3, ty + 1] as const]
  }
  const braco = (ombro: Ponto, [cotovelo, pulso, mao]: Braco) => {
    const mg = manga([mais(ombro, cx, cy), cotovelo, pulso], 2.3, MANGA)
    const px = Math.round(pulso.x)
    const py = Math.round(pulso.y)
    const m: Camada[] = mao ? [[mao, px - 1, py - 1]] : camadasDaManga(manga([pulso, pulso], 1.6, PELE))
    return { manga: camadasDaManga(mg), mao: m }
  }

  const bl = braco(OMBRO_LONGE, ps.bracoLonge)
  camadas.push(...bl.mao, ...bl.manga)
  camadas.push(...perna(QUADRIL_LONGE, ps.longe))
  camadas.push(...perna(QUADRIL_PERTO, ps.perto))
  camadas.push([moletom, TRONCO.x + cx, TRONCO.y + cy])
  camadas.push([cabeca, CABECA.x + cx, CABECA.y + cy])
  if (ps.rosto) camadas.push([ps.rosto, CABECA.x + cx, CABECA.y + cy + 6])
  const bp = braco(OMBRO_PERTO, ps.bracoPerto)
  camadas.push(...bp.manga, ...bp.mao)
  camadas.push(...(ps.extra ?? []))
  const mao = ps.mao ? pt(ps.mao.x, ps.mao.y + DY) : null
  return { camadas: camadas.map(desce), mao, evento: ps.evento }
}

/* ───────────── poses ───────────── */

// Em cima do skate (skate em x = 7): pé de trás na rabeta, pé da frente sobre o truck da frente.
function rodando(op: { roda?: boolean; cy?: number; skate?: readonly [Peca, number, number] } = {}): QuadroDef {
  const cy = op.cy ?? -1
  return boneco({
    cy,
    longe: [pt(15.5, 52.5 + cy), pt(13.5, SK_T)],
    perto: [pt(27.5, 52.5 + cy), pt(27.5, SK_T)],
    bracoLonge: [pt(12.5, 34.5 + cy), pt(10.5, 41.5 + cy)],
    bracoPerto: [pt(29.5, 34.5 + cy), pt(32.5, 40.5 + cy)],
    skate: op.skate ?? [op.roda ? skateRoda : skate, 7, SK_Y],
  })
}

// No chão, o pé de perto em cima do skate parado (skate em x = 7), o de longe no chão atrás da rabeta.
interface OpEmPe {
  cy?: number
  rosto?: Peca
  bracoPerto?: Braco
  mao?: Ponto | null
  evento?: string
}
function emPe(op: OpEmPe = {}): QuadroDef {
  const cy = op.cy ?? 0
  return boneco({
    cy,
    longe: [pt(15.5, 55.5), pt(12.5, CHAO_T)],
    perto: [pt(27.5, 51.5 + cy), pt(27.5, SK_T)],
    bracoLonge: [pt(13.5, 35.5 + cy), pt(13.5, 43.5 + cy)],
    bracoPerto: op.bracoPerto ?? [pt(27.5, 35.5 + cy), pt(28.5, 43.5 + cy)],
    skate: [skate, 7, SK_Y],
    rosto: op.rosto,
    mao: op.mao,
    evento: op.evento,
  })
}

/** Freio: o pé de trás arrasta no chão atrás da rabeta, o corpo joga para trás. */
function freando(fase: 0 | 1 | 2 | 3): QuadroDef {
  const cx = fase === 0 ? -1 : -2
  const pe: Perna = fase === 0 ? [pt(12.5, 51.5), pt(7.5, 57.5), tenis] : fase === 3 ? [pt(10.5, 55.5), pt(6.5, CHAO_T), tenis] : [pt(9.5, 54.5), pt(4.5, 64.5), tenisPonta]
  return boneco({
    cx,
    cy: 0,
    longe: pe,
    perto: [pt(26.5, 51.5), pt(27.5, SK_T)],
    bracoLonge: [pt(10.5, 32.5), pt(6.5, 36.5)],
    bracoPerto: [pt(29.5, 32.5), pt(34.5, 35.5)],
    skate: [skate, 7, SK_Y],
    extra: fase === 1 ? [[raspa1, 0, 71]] : fase === 2 ? [[raspa2, 0, 71]] : [],
  })
}

/** Remando: pé da frente no skate, o de trás empurra o chão (fases 0 a 3). */
function remando(fase: 0 | 1 | 2 | 3): QuadroDef {
  const pes: Perna[] = [
    [pt(21.5, 55.5), pt(19.5, CHAO_T), tenis],
    [pt(17.5, 56.5), pt(13.5, CHAO_T), tenis],
    [pt(12.5, 55.5), pt(7.5, 64.5), tenisPonta],
    [pt(15.5, 53.5), pt(14.5, 59.5), tenis],
  ]
  const cy = fase === 0 || fase === 1 ? 1 : 0
  return boneco({
    cx: 1,
    cy,
    longe: pes[fase],
    perto: [pt(28.5, 52.5 + cy), pt(27.5, SK_T)],
    bracoLonge: [pt(13.5, 34.5 + cy), pt(fase === 2 ? 15.5 : 11.5, 41.5 + cy)],
    bracoPerto: [pt(30.5, 34.5 + cy), pt(fase === 2 ? 29.5 : 33.5, 40.5 + cy)],
    skate: [fase % 2 ? skateRoda : skate, 7, SK_Y],
  })
}

/** Ollie: agacha, bate a rabeta, sobe com o skate colado no pé, desce e aterrissa. */
function ollie(fase: 0 | 1 | 2 | 3 | 4): QuadroDef {
  switch (fase) {
    case 0: // agacha
      return boneco({
        cy: 3,
        longe: [pt(17.5, 52.5), pt(13.5, SK_T)],
        perto: [pt(29.5, 51.5), pt(27.5, SK_T)],
        bracoLonge: [pt(12.5, 37.5), pt(9.5, 43.5)],
        bracoPerto: [pt(29.5, 37.5), pt(31.5, 44.5)],
        skate: [skate, 7, SK_Y],
      })
    case 1: // bate a rabeta: o bico sobe, o pé da frente sobe junto
      return boneco({
        cy: -3,
        longe: [pt(12.5, 50.5), pt(6.5, 62.5)],
        perto: [pt(28.5, 46.5), pt(24.5, 55.5)],
        bracoLonge: [pt(11.5, 31.5), pt(7.5, 34.5)],
        bracoPerto: [pt(30.5, 31.5), pt(35.5, 33.5)],
        skate: [skatePop, 0, 60],
      })
    case 2: // no alto: skate nivelado embaixo dos pés, joelhos dobrados
      return boneco({
        cy: -9,
        longe: [pt(18.5, 43.5), pt(13.5, SK_T - 8)],
        perto: [pt(29.5, 42.5), pt(27.5, SK_T - 8)],
        bracoLonge: [pt(10.5, 25.5), pt(6.5, 28.5)],
        bracoPerto: [pt(31.5, 25.5), pt(36.5, 27.5)],
        skate: [skate, 7, SK_Y - 8],
      })
    case 3: // descendo
      return boneco({
        cy: -5,
        longe: [pt(16.5, 47.5), pt(13.5, SK_T - 4)],
        perto: [pt(28.5, 46.5), pt(27.5, SK_T - 4)],
        bracoLonge: [pt(11.5, 29.5), pt(7.5, 33.5)],
        bracoPerto: [pt(30.5, 29.5), pt(35.5, 32.5)],
        skate: [skateRoda, 7, SK_Y - 4],
      })
    default: // aterrissa: agacha de novo
      return boneco({
        cy: 3,
        longe: [pt(17.5, 52.5), pt(13.5, SK_T)],
        perto: [pt(29.5, 51.5), pt(27.5, SK_T)],
        bracoLonge: [pt(11.5, 36.5), pt(8.5, 40.5)],
        bracoPerto: [pt(30.5, 36.5), pt(34.5, 40.5)],
        skate: [skate, 7, SK_Y],
      })
  }
}

/** Pop shove-it no lugar: sobe com os dois pés, o skate gira embaixo (de lado → meio → ponta → meio → de lado). */
function shoveIt(fase: 0 | 1 | 2 | 3 | 4): QuadroDef {
  const sk: (readonly [Peca, number, number])[] = [
    [skate, 7, SK_Y],
    [skateMeio, 13, SK_Y - 3],
    [skatePonta, 17, SK_Y - 4],
    [skateMeio, 13, SK_Y - 3],
    [skate, 7, SK_Y],
  ]
  const cy = [3, -6, -8, -6, 3][fase]
  const t = [SK_T, SK_T - 9, SK_T - 11, SK_T - 9, SK_T][fase]
  return boneco({
    cy,
    longe: [pt(17.5, 52.5 + cy - 3), pt(15.5, t)],
    perto: [pt(27.5, 51.5 + cy - 3), pt(26.5, t)],
    bracoLonge: [pt(11.5, 34.5 + cy), pt(fase % 4 ? 6.5 : 9.5, fase % 4 ? 29.5 + cy : 41.5 + cy)],
    bracoPerto: [pt(30.5, 34.5 + cy), pt(fase % 4 ? 35.5 : 32.5, fase % 4 ? 29.5 + cy : 41.5 + cy)],
    skate: sk[fase],
    rosto: fase === 4 ? sorriso : undefined,
  })
}

// Braço de perto em cada gesto (o resto é o emPe).
const apontaMeio: Braco = [pt(30.5, 34.5), pt(34.5, 33.5)]
const aponta: Braco = [pt(31.5, 31.5), pt(37.5, 29.5), dedo]
const estende: Braco = [pt(31.5, 35.5), pt(37.5, 35.5), palma]
const segura: Braco = [pt(31.5, 35.5), pt(37.5, 35.5)]
const olhaItem: Braco = [pt(30.5, 38.5), pt(29.5, 33.5)]
const noBolso: Braco = [pt(28.5, 38.5), pt(23.5, 39.5)]

const animacoes: Record<string, AnimacaoDef> = {
  rodar: {
    sobre: 'Chega rodando no skate, joelho dobrado; as rodas giram (2 quadros).',
    quadros: [rodando(), rodando({ roda: true })],
    ms: 90,
    passo: 5,
    laco: true,
  },
  frear: {
    sobre: 'Freia arrastando o pé de trás no chão (riscos no chão, sem poeira); o skate para e ele fica com um pé em cima.',
    quadros: [freando(0), freando(1), freando(2), freando(1), freando(3), emPe()],
    ms: [90, 100, 110, 130, 160, 300],
    passo: [4, 3, 3, 2, 1, 0],
  },
  parado: {
    sobre: 'De pé, um pé em cima do skate parado; respira e pisca.',
    quadros: [emPe(), emPe({ cy: 1 }), emPe(), emPe({ rosto: piscar })],
    ms: [600, 500, 600, 120],
    laco: true,
  },
  apontar: {
    sobre: 'Aponta para o casaco do mercador ("esse aí"), com uma sacudida no meio. Evento "aponta".',
    quadros: [
      emPe(),
      emPe({ bracoPerto: apontaMeio }),
      emPe({ bracoPerto: aponta, evento: 'aponta' }),
      emPe({ bracoPerto: aponta, cy: 1 }),
      emPe({ bracoPerto: aponta }),
      emPe({ bracoPerto: apontaMeio }),
      emPe(),
    ],
    ms: [150, 120, 300, 140, 400, 140, 300],
  },
  pegar: {
    sobre: 'Estica a mão aberta, pega o livreto (evento "pega"), olha, sorri e guarda no bolso canguru (evento "guarda").',
    quadros: [
      emPe(),
      emPe({ bracoPerto: estende, mao: pt(38, 34) }),
      emPe({ bracoPerto: segura, mao: pt(38, 35), evento: 'pega' }),
      emPe({ bracoPerto: olhaItem, mao: pt(29, 32), rosto: sorriso }),
      emPe({ bracoPerto: olhaItem, mao: pt(29, 32), rosto: sorriso }),
      emPe({ bracoPerto: noBolso, evento: 'guarda' }),
      emPe({ rosto: sorriso }),
    ],
    ms: [150, 300, 300, 260, 300, 260, 300],
  },
  pagar: {
    sobre: 'Tira a nota do bolso e estende para o mercador (evento "paga" com a nota na mão), e volta.',
    quadros: [
      emPe(),
      emPe({ bracoPerto: noBolso }),
      emPe({ bracoPerto: segura, mao: pt(38, 35) }),
      emPe({ bracoPerto: segura, mao: pt(38, 35), evento: 'paga' }),
      emPe({ bracoPerto: estende }),
      emPe(),
    ],
    ms: [150, 260, 300, 400, 200, 300],
  },
  reagir: {
    sobre: 'Tocado: pop shove-it no lugar — agacha, sobe, o skate gira embaixo dele e volta aos pés; aterrissa sorrindo.',
    quadros: [emPe(), shoveIt(0), shoveIt(1), shoveIt(2), shoveIt(3), shoveIt(4), emPe({ rosto: sorriso })],
    ms: [120, 140, 90, 90, 90, 160, 400],
  },
  subir: {
    sobre: 'Põe o pé de trás na rabeta: de pé no skate, pronto para remar.',
    quadros: [emPe(), remando(3), rodando()],
    ms: [120, 120, 160],
  },
  remar: {
    sobre: 'Rema: o pé de trás empurra o chão e volta (4 quadros); o skate anda mais a cada empurrão.',
    quadros: [remando(0), remando(1), remando(2), remando(3)],
    ms: [120, 110, 110, 120],
    passo: [2, 4, 5, 4],
    laco: true,
  },
  ollie: {
    sobre: 'Ollie andando: agacha, bate a rabeta, sobe com o skate colado nos pés, desce e aterrissa (passo constante).',
    quadros: [ollie(0), ollie(1), ollie(2), ollie(2), ollie(3), ollie(4), rodando()],
    ms: [110, 80, 110, 90, 90, 130, 120],
    passo: 5,
  },
}

export const skatista = criarPersonagem({
  id: 'skatista',
  nome: 'Skatista',
  w: W,
  h: H,
  ancora: { x: 21, y: 72 + DY },
  paleta,
  aro,
  animacoes,
})

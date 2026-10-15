// O gato de rua (opcional na cena): cinza-escuro com aro de luz, olho amarelo aceso como o do mercador. Atravessa
// em cima do muro, desce, senta em cima dos engradados, e quando o mercador vem fazer carinho ele empina a cabeça
// contra a mão dele (olho fechado, rabo em pé). Quadro 18 × 16, chão na linha 16. Olhando para a direita.

import { p, type Peca } from './compor'
import { criarPersonagem, type AnimacaoDef } from './modelo'

const W = 18
const H = 16

const paleta: Record<string, string> = {
  m: '#7a7a7a', // aro de luz em cima
  e: '#3e3e3e', // pelo
  d: '#262626', // barriga, perna de trás (longe)
  y: '#ffd27a', // olho aceso
  r: '#d88a8a', // nariz
}

/** Andando de lado, rabo para cima; 4 jeitos de perna (as de longe em d). */
const andar = [
  p(`
  ..m...............
  .m.m..........m.m.
  .m............mmmm
  ..m...........mymm
  ..m.mmmmmmmmmmmmmr
  ...meeeeeeeeeeeee.
  ....eeeeeeeeeeee..
  ....deeeeeeeeeed..
  ....e.d.....e.d...
  ....e..d....e..d..
`),
  p(`
  .m................
  m.m...........m.m.
  m.............mmmm
  .m............mymm
  ..m.mmmmmmmmmmmmmr
  ...meeeeeeeeeeeee.
  ....eeeeeeeeeeee..
  ....deeeeeeeeeed..
  .....ed......ed...
  .....ed......ed...
`),
  p(`
  ..m...............
  .m.m..........m.m.
  .m............mmmm
  ..m...........mymm
  ..m.mmmmmmmmmmmmmr
  ...meeeeeeeeeeeee.
  ....eeeeeeeeeeee..
  ....deeeeeeeeeed..
  ....d.e.....d.e...
  ...d...e...d...e..
`),
  p(`
  ...m..............
  ..m.m.........m.m.
  ..m...........mmmm
  ..m...........mymm
  ..m.mmmmmmmmmmmmmr
  ...meeeeeeeeeeeee.
  ....eeeeeeeeeeee..
  ....deeeeeeeeeed..
  .....de......de...
  .....de......de...
`),
]

/** Sentado de lado, rabo enrolado no chão; o segundo com a ponta do rabo mexendo. */
const sentado = p(`
  ........m.m.
  ........mmmm
  ........mymm
  ........meer
  .......meee.
  ......meeee.
  .....meeeee.
  .....eeeeee.
  ....deeeeee.
  ....deeeeed.
  .mmmdeedeed.
`)
const sentadoRabo = p(`
  ........m.m.
  ........mmmm
  ........mymm
  ........meer
  .......meee.
  ......meeee.
  .....meeeee.
  .....eeeeee.
  m...deeeeee.
  .m..deeeeed.
  ..mmdeedeed.
`)
const piscando = p(`
  ........m.m.
  ........mmmm
  ........memm
  ........meer
  .......meee.
  ......meeee.
  .....meeeee.
  .....eeeeee.
  ....deeeeee.
  ....deeeeed.
  .mmmdeedeed.
`)

/** Ganhando carinho: sentado, a cabeça empinada contra a mão, olho fechado de gosto, rabo em pé. */
const carinho1 = p(`
  ........m.m.
  ........mmmm
  ........memm
  ........meer
  ........mee.
  m.....meeee.
  m....meeeee.
  .m...eeeeee.
  .m..deeeeee.
  ..m.deeeeed.
  ..mmdeedeed.
`)
const carinho2 = p(`
  .........m.m
  .........mmm
  ........mmem
  ........meer
  .......meee.
  .m....meeee.
  m....meeeee.
  m....eeeeee.
  .m..deeeeee.
  ..m.deeeeed.
  ..mmdeedeed.
`)

/** Pulo para descer do muro: encolhe, se estica no ar, aterrissa. */
const encolhe = p(`
  ..............
  ..............
  ...........m.m
  ...........mmm
  .m.........mym
  m..mmmmmmmmmmr
  m.meeeeeeeeee.
  .meeeeeeeeeed.
  ..dd.ee...dd..
`)
const noAr = p(`
  ..................
  m.................
  .m............m.m.
  ..m...........mmmm
  ...mmmmmmmmmmmmymm
  ...meeeeeeeeeeeemr
  ....eeeeeeeeeeee..
  ..dd..........eeed
  .d..............d.
`)

/** Encaixa a peça com a cabeça (lado direito) sempre no mesmo lugar e os pés no chão. */
const em = (pc: Peca, dx = 0) => [[pc, W - pc.w + dx, H - pc.h] as const]

const animacoes: Record<string, AnimacaoDef> = {
  andar: {
    sobre: 'Anda de lado, macio, rabo para cima balançando (4 quadros). Serve em cima do muro e na calçada.',
    quadros: andar.map((pc) => em(pc)),
    ms: 140,
    passo: 2,
    laco: true,
  },
  pular: {
    sobre: 'Desce do muro: encolhe, se estica no ar e aterrissa (o motor desce a âncora até o chão no quadro do ar).',
    quadros: [em(encolhe), em(noAr), em(encolhe)],
    ms: [180, 220, 160],
    passo: [0, 6, 0],
  },
  parado: {
    sobre: 'Sentado, rabo enrolado; a ponta do rabo mexe e ele pisca devagar.',
    quadros: [em(sentado), em(sentadoRabo), em(sentado), em(piscando)],
    ms: [900, 300, 900, 200],
    laco: true,
  },
  carinho: {
    sobre: 'Sentado nos engradados, empina a cabeça contra a mão do mercador, de olho fechado e rabo em pé (o mercador faz "carinho").',
    quadros: [em(sentado), em(carinho1), em(carinho2), em(carinho1), em(carinho2), em(sentado)],
    ms: [200, 300, 260, 300, 260, 300],
  },
}

export const gato = criarPersonagem({
  id: 'gato',
  nome: 'Gato de rua',
  w: W,
  h: H,
  ancora: { x: 9, y: H },
  paleta,
  animacoes,
})

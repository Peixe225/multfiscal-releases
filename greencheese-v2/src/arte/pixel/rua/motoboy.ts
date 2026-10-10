// O motoboy: capacete fechado amarelo com viseira escura, jaqueta azul-marinho com faixa refletiva, a bag térmica
// quadrada nas costas com o GC em pixel e uma moto pequena (eco do ícone de moto dos destaques, em escala de cena).
// Chega rodando, encosta e põe o pé no chão, levanta a viseira, pega a sacola do pedido com o mercador, guarda na
// bag, fecha a viseira e sai acelerando (só linhas de velocidade atrás). Tocado: pisca o farol e faz joia.
//
// Moto desenhada em peças (tanque, banco, motor, escape, garfo, farol), rodas geradas girando; o piloto é um boneco
// sentado (tronco, pernas e braços gerados, capacete e bag desenhados). Quadro 64 × 60, chão na linha 60.

import { camadasDaManga, manga, p, type Camada, type Peca, type Ponto } from './compor'
import { criarPersonagem, type AnimacaoDef, type QuadroDef } from './modelo'

const W = 64
const H = 60

const paleta: Record<string, string> = {
  // capacete amarelo
  Y: '#f2cc58',
  y: '#c89a24',
  o: '#7e5e14',
  // viseira: fumê com o reflexo do poste
  v: '#141a22',
  V: '#5a7590',
  X: '#c8d8e8',
  // jaqueta azul-marinho e a faixa refletiva
  N: '#5a6c96',
  n: '#34405e',
  m: '#222a3e',
  M: '#151a28',
  f: '#c8d0d8',
  // calça jeans escura e bota (q também é o preto do banco)
  c: '#34405a',
  C: '#56658a',
  q: '#161616',
  // luva
  l: '#1e1e1e',
  L: '#5a5a5a',
  // pele (só com a viseira aberta)
  A: '#d9a882',
  a: '#a87a58',
  e: '#141010',
  // bag térmica: preta, aro, logo branco
  s: '#1a1a1a',
  S: '#5e5e5e',
  w: '#f2f2f2',
  // moto: carenagem escura, metal, cromado, banco, farol, lanterna
  b: '#2c2c2c',
  B: '#646464',
  W: '#e6e6e6',
  g: '#a8a8a8',
  G: '#5a5a5a',
  k: '#121212',
  K: '#585858',
  h: '#fff0b8',
  H: '#c8b070',
  r: '#e0283c',
  R: '#7a1420',
  // tanque e carenagem
  Z: '#d0403e',
  z: '#8e1c24',
}

/** Luz de cima na borda da silhueta. */
const aro = {
  y: ['Y', 'Y'],
  o: ['y', 'y'],
  n: ['N', 'N'],
  m: ['n', 'n'],
  M: ['m', 'm'],
  c: ['C', 'C'],
  q: ['C', 'C'],
  l: ['L', 'L'],
  s: ['S', 'S'],
  b: ['B', 'B'],
  k: ['K', 'K'],
  z: ['Z', 'Z'],
} as const

/* ───────────── rodas (geradas, girando) ───────────── */

/**
 * Roda de raio externo 7: pneu preto com a luz só no alto, aro fino de metal, miolo escuro com dois raios discretos e
 * o cubo; um ponto claro no aro (a válvula) marca o giro.
 */
function roda(angulo: number): Peca {
  const n = 15
  const c = 7
  const linhas: string[] = []
  const vx = c + Math.cos(angulo) * 5
  const vy = c + Math.sin(angulo) * 5
  for (let j = 0; j < n; j++) {
    let s = ''
    for (let i = 0; i < n; i++) {
      const dx = i - c
      const dy = j - c
      const d = Math.hypot(dx, dy)
      if (d > 7.4) s += '.'
      else if (d > 5.6) s += dy <= -5 ? 'K' : 'k'
      else if (d > 4.6) s += Math.hypot(i - vx, j - vy) < 0.8 ? 'W' : 'G'
      else if (d < 1.6) s += 'g'
      else {
        // dois raios em cruz, girando com a válvula
        const a = Math.atan2(dy, dx) - angulo
        const raio = Math.abs(Math.sin(2 * a)) < 0.28
        s += raio ? 'b' : 'k'
      }
    }
    linhas.push(s)
  }
  return { w: n, h: n, linhas }
}
const rodas = [0, 1, 2].map((k) => roda(-Math.PI / 2 + (k * 2 * Math.PI) / 3))

/* ───────────── moto (peças) ───────────── */

// Tanque e carenagem vermelhos (lê como moto de relance), quadro e paralamas pretos, motor e escape de metal.
const banco = p(`
  ..SSSSSSSSSSSSS.
  .Sqqqqqqqqqqqqqq
  Sqqqqqqqqqqqqqqq
  .qqqqqqqqqqqqqq.
`)
const tanque = p(`
  ...ZZZZZZ...
  .ZZzWWzzzZZ.
  ZzzWzzzzzzzZ
  zzzzzzzzzzzz
  .zzzzzzzzzz.
  ...zzzzzz...
`)
const lateral = p(`
  qqqqqqqqqqqqq
  ZZZZZZZZZZZZz
  zzzzzzzzzzzzz
  zzzzzzzzzzzz.
  .zzzzzzzzzz..
`)
const rabeta = p(`
  .......ZZZZZ
  rrZZZZZzzzzz
  Rzzzzzzzzzz.
  ..bbbbb.....
`)
const paralamaTras = p(`
  ...BBBBBBBBB...
  .BBbbbbbbbbbBB.
  Bb...........bB
`)
const motor = p(`
  .GGGGGGGG.
  GgGgGgGgGG
  GgGgGgGgGG
  GGGGGGGGGG
  .GGGGGGGG.
`)
const escape = p(`
  ............GGGGG
  .gWWWWWWWWWWWWWg.
  GgggggggggggggG..
  .GGGGGGGG........
`)
const balanca = p(`
  ..........GG
  .......GGG..
  ....GGG.....
  .GGG........
  GG..........
`)
const garfo = p(`
  gG.....
  gG.....
  .gG....
  .gG....
  ..gG...
  ..gG...
  ...gG..
  ...gG..
  ....gG.
  ....gG.
  .....gG
  .....gG
`)
const farol = p(`
  .HHH.
  Hhhhh
  Hhhhh
  Hhhhh
  .HHH.
`)
const guidao = p(`
  ..ll.
  .GG..
  GG...
`)
const paralamaFrente = p(`
  ..BBBBBBBBB..
  .Bbbbbbbbbbb.
  Bb.........bB
`)
const pedal = p(`
  gg
`)
const descanso = p(`
  G...
  .G..
  .G..
  ..G.
  ..G.
  ..GG
`)

/** A moto sem rodas, no quadro (rodas: traseira centro 13.5, dianteira 47.5, linha 52.5). */
function moto(op: { farol?: boolean; descanso?: boolean } = {}): Camada[] {
  return [
    [balanca, 13, 47],
    [paralamaTras, 6, 43],
    [rabeta, 3, 37],
    [motor, 22, 45],
    [lateral, 15, 39],
    [escape, 4, 48],
    [banco, 13, 35],
    [tanque, 28, 33],
    [garfo, 41, 39],
    [paralamaFrente, 41, 43],
    [farol, 44, 34],
    [guidao, 37, 30],
    [pedal, 31, 48],
    ...(op.descanso ? [[descanso, 22, 52] as const] : []),
    ...(op.farol ? [[facho, 49, 33] as const] : []),
  ]
}
/** Facho do farol aceso (pisca quando ele é tocado): pontilhado, mais ralo longe. */
const facho = p(`
  .h.h.h..h...h...
  h.h.h.h...h.....
  .h.h.h.h.h...h..
  h.h.h.h...h.....
  .h.h.h..h...h...
`)

/* ───────────── piloto ───────────── */

/** Capacete fechado de 3/4, viseira descida com o reflexo do poste. */
const capacete = p(`
  ....yyyyy....
  ..yyyyyyyyy..
  .yyyyyyyyyyy.
  yyyyyyyvvvvvv
  yyyyyyvvVVvvv
  yyyyyvvvvXVvv
  yyyyyyvvvvvv.
  oyyyyyyyyyyy.
  .oyyyyyyyyy..
  ..ooooooooo..
`)
/** Viseira levantada: o vidro sobe para a testa e o rosto aparece. */
const capaceteAberto = p(`
  ....yyyyy....
  ..yyyyvvvvv..
  .yyyyvvVVvvv.
  yyyyyyyaaaaay
  yyyyyyaaeaeAy
  yyyyyaaaaaaAy
  yyyyyyaaaaay.
  oyyyyyyyyyyy.
  .oyyyyyyyyy..
  ..ooooooooo..
`)
/** No meio do caminho (a viseira subindo ou descendo). */
const capaceteMeio = p(`
  ....yyyyy....
  ..yyyyyyyyy..
  .yyyyyvvvvvv.
  yyyyyyvvVVvvy
  yyyyyyvXVvvAy
  yyyyyaaaaaaAy
  yyyyyyaaaaay.
  oyyyyyyyyyyy.
  .oyyyyyyyyy..
  ..ooooooooo..
`)

/** A bag térmica nas costas: caixa preta com aro, alça e o GC branco (não espelha). */
const bag = p(
  `
  SSSSSSSSSSSSSS
  SssssssssssssS
  SssssssssssssS
  SsswwwsswwwssS
  SswssssswssssS
  SswswwsswssssS
  SswsswsswssssS
  SsswwwsswwwssS
  SssssssssssssS
  SssssssssssssS
  SffffffffffffS
  SssssssssssssS
  SssssssssssssS
  .SSSSSSSSSSSS.
`,
  { fixa: true },
)
/** A tampa da bag aberta (para guardar o pedido): sobe e mostra o fundo escuro. */
const bagAberta = p(
  `
  .SSSSSSSSSSSS.
  SqqqqqqqqqqqqS
`,
  { fixa: true },
)

/** Luva fechada no guidão / com o polegar para cima (joia). */
const luva = p(`
  .lL
  llL
  .l.
`)
const joia = p(`
  .L.
  .l.
  lll
  llL
  .l.
`)
/** Bota no pedal ou no chão. */
const bota = p(`
  .qqq..
  qqqqqq
  qqqqqqq
  CCCCCCC
`)

const JAQUETA = { miolo: 'm', luz: 'n', sombra: 'M' }
const MANGA = { miolo: 'm', luz: 'n', sombra: 'M' }
const CALCA = { miolo: 'c', luz: 'C', sombra: 'q' }

type Braco = readonly [cotovelo: Ponto, pulso: Ponto, mao?: Peca]

interface Pose {
  /** Corpo inteiro (vibração do motor, inclinar para arrancar). */
  cx?: number
  cy?: number
  /** Moto inteira (tremida do motor). */
  my?: number
  roda?: number
  capacete?: Peca
  bracoPerto?: Braco
  /** Perna de perto: no pedal (padrão) ou no chão. */
  peNoChao?: boolean
  tampaAberta?: boolean
  /** Braço de perto passa por trás do capacete (levando o pedido para a bag). */
  bracoAtras?: boolean
  farol?: boolean
  descanso?: boolean
  extra?: Camada[]
  mao?: Ponto | null
  evento?: string
}

const pt = (x: number, y: number): Ponto => ({ x, y })

/** Encaixes do piloto sentado (cx = cy = 0). */
const QUADRIL = pt(23.5, 34.5)
const OMBRO = pt(29.5, 22.5)
const GUIDAO = pt(38.5, 31.5)

function quadro(ps: Pose): QuadroDef {
  const cx = ps.cx ?? 0
  const cy = ps.cy ?? 0
  const my = ps.my ?? 0
  const r = rodas[(ps.roda ?? 0) % 3]
  const camadas: Camada[] = []
  // rodas e moto
  camadas.push([r, 6, 45], [r, 40, 45])
  for (const c of moto({ farol: ps.farol, descanso: ps.descanso })) camadas.push([c[0], c[1], c[2] + my])
  const q = pt(QUADRIL.x + cx, QUADRIL.y + cy + my)
  const o = pt(OMBRO.x + cx, OMBRO.y + cy + my)
  // braço de longe: no guidão, atrás do tanque
  camadas.push(...camadasDaManga(manga([pt(o.x - 2, o.y), pt(34.5 + cx, 28.5 + cy + my), pt(GUIDAO.x - 1, GUIDAO.y + my)], 2, MANGA)))
  // perna de longe: no pedal do outro lado (só o joelho aparece por cima do tanque)
  camadas.push(...camadasDaManga(manga([q, pt(31.5 + cx, 34.5 + cy + my), pt(30.5, 44.5 + my)], 2.6, CALCA)))
  // tronco inclinado para a frente
  camadas.push(...camadasDaManga(manga([q, pt(27.5 + cx, 28.5 + cy + my), o], 4.6, JAQUETA)))
  camadas.push([faixa, o.x - 7, o.y + 8])
  // bag nas costas
  const bx = Math.round(o.x) - 21
  const by = Math.round(o.y) - 3
  camadas.push([bag, bx, by])
  if (ps.tampaAberta) camadas.push([bagAberta, bx, by - 2])
  // braço de perto (por trás do capacete quando leva o pedido para a bag; senão, na frente de tudo)
  const [cot, pul, mao] = ps.bracoPerto ?? [pt(34.5 + cx, 28.5 + cy + my), pt(GUIDAO.x, GUIDAO.y + my), luva]
  const braco: Camada[] = [...camadasDaManga(manga([o, cot, pul], 2.2, MANGA)), ...(mao ? [[mao, Math.round(pul.x) - 1, Math.round(pul.y) - 1] as const] : [])]
  if (ps.bracoAtras) camadas.push(...braco)
  // capacete
  camadas.push([ps.capacete ?? capacete, Math.round(o.x) - 4, Math.round(o.y) - 13])
  // perna de perto
  if (ps.peNoChao) {
    camadas.push(...camadasDaManga(manga([q, pt(30.5 + cx, 41.5), pt(33.5, 54.5)], 2.8, CALCA)))
    camadas.push([bota, 31, 56])
  } else {
    camadas.push(...camadasDaManga(manga([q, pt(32.5 + cx, 35.5 + cy + my), pt(30.5, 45.5 + my)], 2.8, CALCA)))
    camadas.push([bota, 28, 45 + my])
  }
  if (!ps.bracoAtras) camadas.push(...braco)
  camadas.push(...(ps.extra ?? []))
  return { camadas, mao: ps.mao ?? null, evento: ps.evento }
}

/** Faixa refletiva no peito. */
const faixa = p(`
  ..ffffff
  ffffff..
`)

/* ───────────── poses ───────────── */

const parado = (op: Partial<Pose> = {}) => quadro({ peNoChao: true, descanso: false, ...op })

const estendeMao: Braco = [pt(37.5, 24.5), pt(43.5, 25.5), luva]
const levantaViseira: Braco = [pt(35.5, 20.5), pt(36.5, 13.5), luva]
const guardaNaBag: Braco = [pt(29.5, 13.5), pt(22.5, 13.5), luva]
const fazJoia: Braco = [pt(37.5, 26.5), pt(41.5, 20.5), joia]

const animacoes: Record<string, AnimacaoDef> = {
  chegar: {
    sobre: 'Chega rodando, farol aceso; as rodas giram (3 quadros).',
    quadros: [quadro({ roda: 0 }), quadro({ roda: 1 }), quadro({ roda: 2 })],
    ms: 70,
    passo: 6,
    laco: true,
  },
  encostar: {
    sobre: 'Freia e encosta: as rodas diminuem, a moto afunda na frente, e ele põe o pé no chão.',
    quadros: [quadro({ roda: 0 }), quadro({ roda: 1, cx: 1 }), quadro({ roda: 2, cx: 1, my: 1 }), quadro({ roda: 0, cx: 1 }), parado()],
    ms: [80, 100, 120, 160, 300],
    passo: [5, 4, 3, 1, 0],
  },
  parado: {
    sobre: 'Parado com o pé no chão, motor ligado: a moto treme 1 px.',
    quadros: [parado(), parado({ my: 1 })],
    ms: [110, 110],
    laco: true,
  },
  abrirViseira: {
    sobre: 'Levanta a viseira com a mão: o rosto aparece.',
    quadros: [parado(), parado({ bracoPerto: levantaViseira }), parado({ bracoPerto: levantaViseira, capacete: capaceteMeio }), parado({ capacete: capaceteAberto })],
    ms: [120, 140, 120, 300],
  },
  pegar: {
    sobre: 'Viseira aberta: estica a mão, pega a sacola (evento "pega"), leva por cima do ombro, abre a tampa da bag e guarda (evento "guarda").',
    quadros: [
      parado({ capacete: capaceteAberto }),
      parado({ capacete: capaceteAberto, bracoPerto: estendeMao, mao: pt(44, 26) }),
      parado({ capacete: capaceteAberto, bracoPerto: estendeMao, mao: pt(44, 26), evento: 'pega' }),
      parado({ capacete: capaceteAberto, bracoPerto: [pt(35.5, 18.5), pt(33.5, 12.5), luva], mao: pt(33, 12), tampaAberta: true }),
      parado({ capacete: capaceteAberto, bracoPerto: guardaNaBag, mao: pt(22, 13), tampaAberta: true, bracoAtras: true }),
      parado({ capacete: capaceteAberto, bracoPerto: guardaNaBag, tampaAberta: true, bracoAtras: true, evento: 'guarda' }),
      parado({ capacete: capaceteAberto }),
    ],
    ms: [140, 240, 300, 200, 260, 220, 260],
  },
  fecharViseira: {
    sobre: 'Desce a viseira: rosto some atrás do fumê.',
    quadros: [parado({ capacete: capaceteAberto }), parado({ bracoPerto: levantaViseira, capacete: capaceteMeio }), parado({ bracoPerto: levantaViseira }), parado()],
    ms: [120, 120, 140, 200],
  },
  sair: {
    sobre: 'Tira o pé do chão, inclina e acelera: as rodas giram cada vez mais rápido e o passo cresce (o motor acrescenta as linhas de velocidade atrás).',
    quadros: [quadro({ roda: 0 }), quadro({ roda: 1, cx: 1 }), quadro({ roda: 2, cx: 1 }), quadro({ roda: 0, cx: 1, evento: 'arranca' }), quadro({ roda: 1, cx: 1 }), quadro({ roda: 2, cx: 1 })],
    ms: [140, 100, 80, 70, 60, 60],
    passo: [1, 3, 5, 8, 10, 12],
  },
  reagir: {
    sobre: 'Tocado: pisca o farol duas vezes e faz joia com a mão.',
    quadros: [
      parado(),
      parado({ farol: true }),
      parado(),
      parado({ farol: true, bracoPerto: fazJoia }),
      parado({ bracoPerto: fazJoia }),
      parado({ bracoPerto: fazJoia, my: 1 }),
      parado(),
    ],
    ms: [100, 120, 100, 160, 300, 300, 200],
  },
}

export const motoboy = criarPersonagem({
  id: 'motoboy',
  nome: 'Motoboy',
  w: W,
  h: H,
  ancora: { x: 30, y: H },
  paleta,
  aro,
  animacoes,
})

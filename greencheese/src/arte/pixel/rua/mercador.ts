// O mercador na rua: os movimentos novos para a cena do Início, feitos em cima das grades que ele já tem
// (mercador.ts e mercador-garrafa.ts). Capuz, olhos, bandana, mochila, saco, lanterna, casaco e botas são os mesmos
// pixels; aqui entram o braço solto (manga gerada com a mesma luz), as mãos, a lata e as trocas de quadro.
//
// Na rua ele anda de casaco fechado (o corpo da pose da sacola vazia, sem a garrafa) e só abre para mostrar a
// mercadoria. O forro da cena mostra só o que pode aparecer: no lado direito, onde no repost ficam as garrafas, entram
// a Fanta Ghost Face Punch e o Arizona Green Tea; o resto (seda, Coca-Cola Vanilla) é o mesmo, e a piteira de vidro
// entra no lugar do isqueiro. O lado esquerdo abre com as camadas do repost (pega, meio, aberto), que só têm
// acessório. Ele bebe refrigerante: tira a Fanta do casaco, dá um gole inclinando a cabeça e guarda.
//
// Quadro 54 × 64: a grade 44×64 dele posta em (2, 0). Âncora no meio das botas, no chão (linha 63).

import { mercador, apresentacao } from '../mercador'
import { mercadorGarrafa } from '../mercador-garrafa'
import { camadasDaManga, deLinhas, faixa, manga, p, recorte, type Camada, type Peca, type Ponto } from './compor'
import { lataArizona, lataFanta, lataFantaGole, paletaItens, piteiraVidro } from './itens'
import { criarPersonagem, type AnimacaoDef } from './modelo'

const W = 54
const H = 64
/** Onde a grade 44×64 dele começa no quadro. */
const BX = 2

export const paletaMercador: Record<string, string> = {
  ...paletaItens,
  ...mercador.paleta,
  // o forro do repost (OCB, RAW, Smoking, piteira de papel, dichavador): letras das camadas do mercador.ts
  k: '#101011',
  b: '#c08a55',
  B: '#7d5530',
  n: '#8a5a36',
  t: '#c9a27a',
  i: '#8aa3b8',
  I: '#4d5762',
}

/** Cola peças numa cópia das linhas (para montar os corpos base uma vez). 'x' apaga. */
function colado(base: Peca, pecas: readonly (readonly [Peca, number, number])[]): Peca {
  const linhas = base.linhas.map((l) => [...l])
  for (const [pc, x0, y0] of pecas) {
    pc.linhas.forEach((l, j) => {
      for (let i = 0; i < l.length; i++) {
        const c = l[i]
        const y = y0 + j
        const x = x0 + i
        if (c === '.' || !linhas[y] || x < 0 || x >= base.w) continue
        linhas[y][x] = c === 'x' ? '.' : c
      }
    })
  }
  return { w: base.w, h: base.h, linhas: linhas.map((l) => l.join('')) }
}

const ret = (w: number, h: number, c: string) => p(Array.from({ length: h }, () => c.repeat(w)).join('\n'))

/* ───────────── corpo de casaco fechado, sem o braço direito ───────────── */

const garrafa = deLinhas(mercadorGarrafa.linhas)

/** Tira o braço erguido e a garrafa: tudo à direita do capuz até o ombro. Grade 44×64. */
const apagaBraco = p(`
  ..............xxxxxxxxxxxxxxx
  ..............xxxxxxxxxxxxxxx
  ..............xxxxxxxxxxxxxxx
  ..............xxxxxxxxxxxxxxx
  ..............xxxxxxxxxxxxxxx
  ..............xxxxxxxxxxxxxxx
  ..............xxxxxxxxxxxxxxx
  ..............xxxxxxxxxxxxxxx
  ..............xxxxxxxxxxxxxxx
  ..............xxxxxxxxxxxxxxx
  ...............xxxxxxxxxxxxxx
  ................xxxxxxxxxxxxx
  .................xxxxxxxxxxxx
  ..................xxxxxxxxxxx
  ...................xxxxxxxxxx
  ...................xxxxxxxxxx
  ..................xxxxxxxxxxx
  ..................xxxxxxxxxxx
`)

/** O ombro direito sem braço: desce do capuz em degrau, com o aro de luz em cima. */
const ombro = p(`
  m...
  mm..
  emm.
  eeem
`)

/** Corpo fechado (linhas 0–56: sem as botas, que andam soltas), na grade 44×64. */
const tronco = colado(faixa(garrafa, 0, 57), [
  [apagaBraco, 15, 0],
  [ombro, 29, 10],
])

/* ───────────── corpo da vitrine: o do repost, com refrigerante no lugar das garrafas ───────────── */

/** Cordão de onde pende a Fanta e o do Arizona (o da direita, que já descia em diagonal no repost). */
const cordaoFanta = p(`
  e
  e
  e
`)
const cordaoArizona = p(`
  ...e
  ..e.
  .e..
  .e..
`)

const repost = deLinhas(mercador.linhas)
const vitrine = colado(faixa(repost, 0, 59), [
  // forro limpo onde ficavam as garrafas do repost
  [ret(14, 14, 'd'), 26, 17],
  [ret(7, 1, 'd'), 33, 31],
  [ret(4, 1, 'd'), 35, 32],
  // forro limpo onde estava o isqueiro
  [ret(5, 8, 'd'), 27, 42],
  [cordaoFanta, 29, 17],
  [lataFanta, 28, 20],
  [cordaoArizona, 35, 17],
  [lataArizona, 35, 21],
  [piteiraVidro, 29, 42],
])

/** As camadas do repost que abrem o lado esquerdo (só acessórios). */
const camadaRepost = (nome: string) => {
  const q = apresentacao.find((a) => a.nome === nome)
  if (!q) throw new Error(`camada ${nome} não existe no mercador.ts`)
  return deLinhas(q.grade.linhas)
}
const pega = camadaRepost('pega')
const meio = camadaRepost('meio')
const aberto = camadaRepost('aberto')

/* ───────────── botas ───────────── */

/** Bota de trás (longe): 7 × 5, o bico para a frente. */
const botaLonge = recorte(garrafa, 10, 57, 7, 5)
/** Bota da frente (perto): 8 × 6. */
const botaPerto = recorte(garrafa, 21, 57, 8, 6)
/** No ar, passando: o bico desce, o salto sobe. */
const botaLongeAr = p(`
  .mme..
  .meee.
  .meeee
  ..meee
  ...mmm
`)
const botaPertoAr = p(`
  mme....
  meee...
  meeee..
  .meeeee
  ..meeee
  ...mmmm
`)

/* ───────────── braço direito: manga gerada + luva ───────────── */

const COR_MANGA = { miolo: 'e', luz: 'm', sombra: 'd' }
const R = 2.4
/** Ombro (no quadro): todo braço sai daqui. */
const OMBRO: Ponto = { x: 34.5, y: 14.5 }

/** Luva sem dedo caída, como a da outra mão (4 × 5). Pulso no meio de cima. */
const luvaCaida = p(`
  eccm
  cccm
  cccm
  cece
  cece
`)
/** Mão fechada segurando (o item vem por cima). 4 × 4, pulso à esquerda. */
const luvaSegura = p(`
  ccc.
  cccm
  ccce
  .ce.
`)
/** Mão aberta com a palma para cima (receber). 6 × 3, pulso à esquerda. */
const luvaPalma = p(`
  .c....
  cccccc
  .eeee.
`)
/** Mão aberta de pé, palma para a frente (aceno e o primeiro tempo do toque). 5 × 6, pulso embaixo. */
const luvaAberta = p(`
  .cc..
  .cccc
  ccccc
  .ccce
  ..cce
  ..cc.
`)
/** A mesma, os dedos inclinados para o outro lado (segundo quadro do aceno). */
const luvaAberta2 = p(`
  ..cc..
  ..cccc
  .ccccc
  .cccce
  ..cce.
  ..cc..
`)
/** Punho fechado de lado (terceiro tempo do toque). 4 × 4. */
const luvaPunho = p(`
  .cc.
  cccc
  cecm
  .mm.
`)

interface Braco {
  camadas: Camada[]
  mao: Ponto | null
}

/** Braço pelo cotovelo e pelo pulso (no quadro), com a luva posta pelo canto de cima à esquerda. */
function braco(cotovelo: Ponto, pulso: Ponto, luva: Peca | null, canto: Ponto, mao: Ponto | null = null, extra: Camada[] = []): Braco {
  const mg = manga([OMBRO, cotovelo, pulso], R, COR_MANGA)
  return { camadas: [...camadasDaManga(mg), ...(luva ? [[luva, canto.x, canto.y] as const] : []), ...extra], mao }
}

/** Caído do lado do corpo; `balanco` leva a mão para a frente (+) ou para trás (−) no andar. */
const caido = (balanco = 0) =>
  braco({ x: 34.5 + balanco * 0.5, y: 23.5 }, { x: 34.5 + balanco, y: 30.5 }, luvaCaida, { x: 33 + balanco, y: 32 })

/** Mão dentro do casaco, na altura do peito (pegando ou guardando alguma coisa). */
const noCasaco = braco({ x: 35.5, y: 22.5 }, { x: 27.5, y: 20.5 }, p(`
  d.
  dm
  dm
  .m
`), { x: 24, y: 18 })

/** Segurando a lata na frente do peito. */
const lataNoPeito = braco({ x: 36.5, y: 24.5 }, { x: 32.5, y: 21.5 }, luvaSegura, { x: 30, y: 19 }, null, [[lataFanta, 30, 13]])

/** A lata na boca (por baixo da bandana), deitada, o cotovelo para fora. */
const lataNaBoca = braco({ x: 37.5, y: 20.5 }, { x: 30.5, y: 14.5 }, luvaSegura, { x: 28, y: 12 }, null, [[lataFantaGole, 24, 10]])

/** Estendido para a frente na altura do peito: dá ou recebe. */
const estendido = (luva: Peca, canto: Ponto, mao: Ponto | null, pulso: Ponto = { x: 45.5, y: 24.5 }) =>
  braco({ x: 39.5, y: 23.5 }, pulso, luva, canto, mao)
const dando = estendido(luvaSegura, { x: 46, y: 22 }, { x: 48, y: 23 })
const palma = estendido(luvaPalma, { x: 46, y: 22 }, { x: 49, y: 22 })
const punhoFrente = estendido(luvaPunho, { x: 45, y: 22 }, { x: 47, y: 23 }, { x: 44.5, y: 24.5 })

/** Meio caminho entre caído e erguido (o aceno sobe e desce por aqui). */
const meioAlto = braco({ x: 38.5, y: 18.5 }, { x: 41.5, y: 12.5 }, luvaAberta, { x: 39, y: 6 })
/** Erguido, a mão aberta acima do ombro, nos dois tempos do aceno. */
const alto1 = braco({ x: 39.5, y: 12.5 }, { x: 40.5, y: 6.5 }, luvaAberta, { x: 38, y: 0 })
const alto2 = braco({ x: 39.5, y: 12.5 }, { x: 41.5, y: 6.5 }, luvaAberta2, { x: 39, y: 0 })

/** Os três tempos do toque com o MC: palma de pé, mão apertada, punho. */
const toque1 = braco({ x: 40.5, y: 21.5 }, { x: 46.5, y: 18.5 }, luvaAberta, { x: 45, y: 12 }, { x: 47, y: 14 })
const toque2 = estendido(luvaSegura, { x: 46, y: 22 }, { x: 48, y: 23 })
const toque3 = punhoFrente

/** Pegando a beirada do casaco para abrir: a mão na barra da frente, a beirada sai do corpo. */
const abaPuxada = p(`
  .mm.
  mddm
  mddm
  mddm
  .mdm
  .mdm
  .mdm
  .mdm
  .mdm
  .mde
  .mde
  .mde
  .mde
  .mde
  ..me
  ..me
  ..me
  ..mm
`)
const puxaAba = braco({ x: 37.5, y: 23.5 }, { x: 38.5, y: 30.5 }, luvaSegura, { x: 37, y: 29 }, null, [[abaPuxada, 35, 30]])

/** Agachado, a mão aberta lá embaixo na frente (o carinho no gato); o segundo quadro alisa 1 px. */
const carinho1 = braco({ x: 39.5, y: 23.5 }, { x: 43.5, y: 30.5 }, luvaPalma, { x: 43, y: 29 }, { x: 46, y: 30 })
const carinho2 = braco({ x: 39.5, y: 23.5 }, { x: 44.5, y: 30.5 }, luvaPalma, { x: 44, y: 29 }, { x: 47, y: 30 })

/* ───────────── olhos e cabeça ───────────── */

// Olhos na linha 9 da grade, colunas 22 e 25 (no quadro, 24 e 27), num rosto vazio: a sombra do capuz é o fundo.
const OLHO = { x: 22 + BX, y: 9 }
const apagaOlhos = p('x..x')
const olho = p('y')
/** Olhos apertados de contente (dois risquinhos). */
const olhosRiso = p('yy.yy')

type Olhar = number | 'fechados' | 'riso'
function olhos(o: Olhar, dx = 0, dy = 0): Camada[] {
  const base: Camada = [apagaOlhos, OLHO.x + dx, OLHO.y + dy]
  if (o === 'fechados') return [base]
  if (o === 'riso') return [base, [olhosRiso, OLHO.x - 1 + dx, OLHO.y + dy]]
  return [base, [olho, OLHO.x + o + dx, OLHO.y + dy], [olho, OLHO.x + 3 + o + dx, OLHO.y + dy]]
}

/** Capuz, bandana e olhos (para inclinar a cabeça no gole e balançar no riso). */
const capuz = recorte(tronco, 15, 0, 14, 17)

/* ───────────── lanterna e luva de trás (balançam no andar) ───────────── */

const lanterna = recorte(tronco, 0, 13, 6, 14)
const apagaLanterna = ret(6, 14, 'x')
/** A barra do casaco (da costura da linha 50 até a franja), que vai e vem no andar. */
const barra = faixa(tronco, 50, 57)
const apagaBarra = ret(44, 7, 'x')

/* ───────────── montagem dos quadros ───────────── */

interface Pose {
  /** Corpo inteiro para baixo (apoio do passo). */
  dy?: number
  /** Do peito para cima (respirar, rir). */
  peito?: number
  longe?: readonly [number, number, Peca?]
  perto?: readonly [number, number, Peca?]
  braco?: Braco
  olhar?: Olhar
  /** Inclina a cabeça: capuz deslocado. */
  cabeca?: readonly [number, number]
  lanterna?: number
  /** A barra do casaco desloca na horizontal (balanço do andar). */
  barra?: number
  /** Agachado: do quadril para cima desce tantos px por cima da barra (o casaco embola). */
  agachar?: number
  /** Corpo base: fechado (padrão) ou a vitrine do repost. */
  vitrine?: boolean
  extra?: Camada[]
}

const peitoCima = faixa(tronco, 0, 24)

function q(pose: Pose = {}): { camadas: Camada[]; mao: Ponto | null } {
  const dy = pose.dy ?? 0
  const pt = pose.peito ?? 0
  const [lx, ly, lp] = pose.longe ?? [0, 0]
  const [px, py, pp] = pose.perto ?? [0, 0]
  const camadas: Camada[] = [
    [lp ?? botaLonge, 10 + BX + lx, 57 + ly],
    [pp ?? botaPerto, 21 + BX + px, 57 + py],
  ]
  if (pose.vitrine) {
    camadas.push([vitrine, BX, dy])
  } else if (pose.agachar) {
    camadas.push([faixa(tronco, 44, 57), BX, 44 + dy], [faixa(tronco, 0, 44), BX, dy + pose.agachar])
  } else {
    camadas.push([tronco, BX, dy])
    // peito deslocado: os olhos de baixo apareceriam pelo rosto vazado
    if (pt) camadas.push([apagaOlhos, OLHO.x, OLHO.y + dy], [peitoCima, BX, dy + pt])
    if (pose.lanterna) camadas.push([apagaLanterna, BX, 13 + dy + pt], [lanterna, BX + pose.lanterna, 13 + dy + pt])
    if (pose.barra) camadas.push([apagaBarra, BX, 50 + dy], [barra, BX + pose.barra, 50 + dy])
  }
  const ag = pose.agachar ?? 0
  const [cx, cy0] = pose.cabeca ?? [0, 0]
  const cy = cy0 + ag
  // cabeça mexida: apaga os olhos do lugar de antes (senão aparecem pelo rosto vazado do capuz deslocado)
  if (cx || cy0) camadas.push([apagaOlhos, OLHO.x, OLHO.y + dy + pt + ag], [capuz, 15 + BX + cx, dy + pt + cy])
  if (pose.olhar !== undefined && pose.olhar !== 0) camadas.push(...olhos(pose.olhar, cx, dy + pt + cy))
  const b = pose.braco ?? (pose.vitrine ? null : caido())
  if (b) for (const c of b.camadas) camadas.push([c[0], c[1], c[2] + dy + pt + ag, ...(c[3] ? [c[3]] : [])] as unknown as Camada)
  camadas.push(...(pose.extra ?? []))
  const mao = b?.mao ? { x: b.mao.x, y: b.mao.y + dy + pt + ag } : null
  return { camadas, mao }
}

/** Quadro da vitrine com as camadas do repost por cima (o lado esquerdo abrindo). */
const naVitrine = (...camadas: Peca[]) => {
  const base = q({ vitrine: true })
  return { camadas: [...base.camadas, ...camadas.map((c) => [c, BX, 0] as const)], mao: null }
}

const animacoes: Record<string, AnimacaoDef> = {
  parado: {
    sobre: 'De pé, casaco fechado, respirando devagar (ombros, capuz e mochila descem 1 px); pisca no fim.',
    quadros: [q(), q({ peito: 1 }), q({ peito: 1 }), q(), q({ olhar: 'fechados' })],
    ms: [700, 240, 700, 600, 120],
    laco: true,
  },
  olhar: {
    sobre: 'Olha em volta: os olhos e depois o capuz vão para trás, voltam, vão para a frente; pisca.',
    quadros: [
      q(),
      q({ olhar: -1 }),
      q({ olhar: -1, cabeca: [-1, 0] }),
      q({ olhar: -1 }),
      q(),
      q({ olhar: 1 }),
      q({ olhar: 1, cabeca: [1, 0] }),
      q({ olhar: 'fechados' }),
      q(),
    ],
    ms: [300, 160, 600, 160, 200, 160, 600, 110, 300],
  },
  andar: {
    sobre: 'Anda curvado, devagar: 6 quadros, desce no apoio, a bota no ar passa por baixo da barra, a mão balança e a lanterna chega atrasada.',
    quadros: [
      q({ perto: [3, 0], longe: [-3, 0], braco: caido(-1), lanterna: 0, barra: 1 }),
      q({ dy: 1, perto: [2, 0], longe: [-2, -1, botaLongeAr], braco: caido(0), lanterna: -1, barra: 1 }),
      q({ perto: [0, 0], longe: [1, -1, botaLongeAr], braco: caido(1), lanterna: -1 }),
      q({ perto: [-3, 0], longe: [3, 0], braco: caido(1), lanterna: 0, barra: -1 }),
      q({ dy: 1, perto: [-2, -1, botaPertoAr], longe: [2, 0], braco: caido(0), lanterna: 1, barra: -1 }),
      q({ perto: [0, -1, botaPertoAr], longe: [0, 0], braco: caido(-1), lanterna: 1 }),
    ],
    ms: 160,
    passo: 2,
    laco: true,
  },
  beber: {
    sobre: 'Tira a Fanta Ghost Face Punch do casaco, leva por baixo da bandana, inclina a cabeça no gole (duas vezes), suspira de olho fechado e guarda.',
    quadros: [
      q(),
      q({ braco: noCasaco }),
      q({ braco: lataNoPeito }),
      q({ braco: lataNoPeito, olhar: 1 }),
      q({ braco: lataNaBoca, cabeca: [0, -1], olhar: 'fechados' }),
      q({ braco: lataNaBoca, cabeca: [0, -1], olhar: 'fechados', peito: 1 }),
      q({ braco: lataNaBoca, cabeca: [0, -1], olhar: 'fechados' }),
      q({ braco: lataNoPeito, olhar: 'riso', peito: 1 }),
      q({ braco: lataNoPeito, olhar: 'riso' }),
      q({ braco: noCasaco }),
      q(),
    ],
    ms: [300, 220, 260, 320, 380, 220, 380, 420, 380, 240, 300],
  },
  passar: {
    sobre: 'Tira o item do casaco e estende para o cliente (mão com ponto de pega). Evento "oferece" com a mão esticada; "solta" quando o cliente pega.',
    quadros: [
      q(),
      q({ braco: noCasaco }),
      { ...q({ braco: dando }), evento: 'oferece' },
      q({ braco: dando }),
      { ...q({ braco: estendido(luvaSegura, { x: 46, y: 22 }, null) }), evento: 'solta' },
      q({ braco: caido(1) }),
      q(),
    ],
    ms: [200, 240, 300, 500, 260, 200, 300],
  },
  receber: {
    sobre: 'Estende a palma, recebe a moeda ou a nota (evento "recebe"), fecha a mão, guarda no casaco e acena com a cabeça.',
    quadros: [
      q(),
      { ...q({ braco: palma }), evento: 'estende' },
      q({ braco: palma }),
      { ...q({ braco: punhoFrente }), evento: 'recebe' },
      q({ braco: noCasaco }),
      q({ olhar: 'riso', peito: 1 }),
      q({ olhar: 'riso' }),
      q(),
    ],
    ms: [200, 300, 500, 260, 300, 220, 300, 300],
  },
  acenar: {
    sobre: 'Ergue a mão aberta e acena três vezes.',
    quadros: [
      q(),
      q({ braco: meioAlto }),
      q({ braco: alto1, olhar: 'riso' }),
      q({ braco: alto2, olhar: 'riso' }),
      q({ braco: alto1, olhar: 'riso' }),
      q({ braco: alto2, olhar: 'riso' }),
      q({ braco: alto1 }),
      q({ braco: meioAlto }),
      q(),
    ],
    ms: [160, 140, 200, 200, 200, 200, 240, 140, 300],
  },
  rir: {
    sobre: 'Ri de olho apertado: os ombros sacodem e o capuz balança.',
    quadros: [
      q({ olhar: 'riso' }),
      q({ olhar: 'riso', peito: 1 }),
      q({ olhar: 'riso', cabeca: [1, 0] }),
      q({ olhar: 'riso', peito: 1 }),
      q({ olhar: 'riso', cabeca: [-1, 0] }),
      q({ olhar: 'riso', peito: 1 }),
      q({ olhar: 'riso' }),
      q(),
    ],
    ms: [140, 120, 140, 120, 140, 120, 300, 300],
  },
  aprovar: {
    sobre: 'Balança a cabeça que sim, duas vezes.',
    quadros: [q(), q({ cabeca: [0, 1], olhar: 1 }), q(), q({ cabeca: [0, 1], olhar: 1 }), q()],
    ms: [200, 200, 180, 200, 300],
  },
  abrir: {
    sobre: 'Abre o casaco para mostrar a mercadoria: puxa a aba da direita (refrigerantes) e depois a da esquerda (sedas, dichavador, piteiras). Para aberto.',
    quadros: [q(), q({ braco: puxaAba }), naVitrine(), naVitrine(pega), naVitrine(pega, meio), naVitrine(pega, meio, aberto)],
    ms: [160, 160, 260, 125, 125, 400],
  },
  mostrar: {
    sobre: 'Casaco todo aberto, parado (pose da foto); pisca de vez em quando.',
    quadros: [
      naVitrine(pega, meio, aberto),
      { camadas: [...naVitrine(pega, meio, aberto).camadas, ...olhos('fechados')], mao: null },
    ],
    ms: [2200, 120],
    laco: true,
  },
  fechar: {
    sobre: 'Fecha o casaco: a aba da esquerda volta, depois a da direita.',
    quadros: [naVitrine(pega, meio), naVitrine(pega), naVitrine(), q({ braco: puxaAba }), q()],
    ms: [125, 125, 200, 160, 300],
  },
  carinho: {
    sobre: 'Curva um pouco (o casaco embola) e faz carinho no gato sentado nos engradados, de olho apertado; evento "carinho".',
    quadros: [
      q(),
      q({ agachar: 1, braco: caido(1) }),
      { ...q({ agachar: 2, braco: carinho1, olhar: 'riso' }), evento: 'carinho' },
      q({ agachar: 2, braco: carinho2, olhar: 'riso' }),
      q({ agachar: 2, braco: carinho1, olhar: 'riso' }),
      q({ agachar: 2, braco: carinho2, olhar: 'riso' }),
      q({ agachar: 1, braco: caido(1) }),
      q(),
    ],
    ms: [200, 160, 320, 260, 260, 320, 160, 300],
  },
  toque: {
    sobre: 'Toque de mão com o MC em 3 tempos: palma (evento "toque1"), aperto ("toque2"), punho ("toque3"), e volta.',
    quadros: [
      q(),
      q({ braco: meioAlto }),
      { ...q({ braco: toque1 }), evento: 'toque1' },
      { ...q({ braco: toque2 }), evento: 'toque2' },
      q({ braco: toque2, peito: 1 }),
      { ...q({ braco: toque3 }), evento: 'toque3' },
      q({ braco: toque3, olhar: 'riso' }),
      q({ braco: caido(1), olhar: 'riso' }),
      q(),
    ],
    ms: [160, 120, 260, 260, 120, 260, 300, 200, 300],
  },
}

export const mercadorRua = criarPersonagem({
  id: 'mercador',
  nome: 'Mercador',
  w: W,
  h: H,
  ancora: { x: 19 + BX, y: 63 },
  paleta: paletaMercador,
  animacoes,
  // parado, de casaco todo aberto mostrando a mercadoria (o quadro mais bonito dele)
  retrato: { animacao: 'mostrar', quadro: 0 },
})

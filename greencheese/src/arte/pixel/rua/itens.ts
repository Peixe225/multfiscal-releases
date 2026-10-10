// Itens e efeitos da rua, na mesma escala de pixel do mercador: o que passa de mão em mão (lata, livreto de seda,
// sacola GC, piteira, moeda, nota) e os efeitos (flash da câmera, linhas de velocidade, notas musicais).
//
// Cada item é um "personagem" de uma peça só (mesmo formato do elenco, modelo.ts): a âncora é o ponto de pega, que o
// motor põe em cima do ponto `mao` do quadro de quem segura. Efeito tem a âncora no meio (flash) ou na ponta de onde
// sai (linhas de velocidade: na traseira da moto).
//
// Produtos com as cores do catálogo: Fanta Ghost Face Punch (lata preta, máscara branca, ponche rosa), Arizona
// Green Tea (lata alta verde-menta com os pontos rosa e a faixa creme), Coca-Cola Vanilla, seda OCB (capa preta),
// piteira de vidro RAW.

import { p, type Peca } from './compor'
import { criarPersonagem, type Personagem } from './modelo'

export const paletaItens: Record<string, string> = {
  m: '#636363', // aro (luz do poste)
  e: '#3a3a3a',
  d: '#262626',
  c: '#a8a8a8', // metal da lata, papel na sombra
  w: '#ffffff',
  // Fanta Ghost Face Punch
  f: '#141414',
  F: '#d8325f',
  // Arizona Green Tea
  z: '#7ccaa8',
  Z: '#e892ad',
  q: '#fdf6e4',
  G: '#1d5a3b',
  // Coca-Cola Vanilla
  r: '#c8102e',
  R: '#f1e3c0',
  // seda OCB
  k: '#101011',
  // piteira de vidro
  v: '#9fd6e3',
  // dinheiro: moeda de real (dourada) e nota de 50 (marrom)
  o: '#e0b24a',
  O: '#9a7428',
  n: '#c8a070',
  N: '#7d5a36',
  // sacola GC (papel preto com o logo branco)
  s: '#1c1c1c',
}

/* ───────────── peças (o mercador e os clientes usam as mesmas) ───────────── */

/** Fanta Ghost Face Punch em pé, 4 × 7: tampa de metal, a máscara branca, o ponche rosa escorrendo. */
export const lataFanta = p(`
  cccc
  mwwf
  mfwf
  mwwf
  FFFF
  mFfF
  cccc
`)

/** A Fanta inclinada na boca (gole): a tampa embaixo à esquerda (na boca), o fundo para cima. 6 × 6. */
export const lataFantaGole = p(`
  ....cc
  ...cfF
  ..fwwF
  .fwwf.
  cffF..
  cc....
`)

/** Arizona Green Tea, a lata alta (680 ml), 4 × 9: verde-menta, pontos rosa, faixa creme com o nome em verde. */
export const lataArizona = p(`
  cccc
  zqqz
  zZzz
  qGGq
  zzZz
  Zzzz
  zzZz
  zZzz
  cccc
`)

/** Coca-Cola Vanilla, 4 × 7: vermelha com a faixa creme. */
export const lataCoca = p(`
  cccc
  rrrr
  rwwr
  RRRR
  rrrr
  rrrr
  cccc
`)

/** Livreto de seda OCB: capa preta com aro, o papel branco saindo em cima. 5 × 5. */
export const livretoSeda = p(`
  .www.
  mwwwm
  mkkkm
  mkwkm
  mmmmm
`)

/** Piteira de vidro: tubinho com o brilho de um lado. 2 × 6. */
export const piteiraVidro = p(`
  vw
  vw
  vw
  vw
  vw
  vv
`)

/** Sacola do pedido: papel preto com aro, alça e o GC em pixel (não espelha). 9 × 11. */
export const sacolaGC = p(
  `
  ..m...m..
  .m.....m.
  mmmmmmmmm
  msssssssd
  mwwwswwwd
  mwssswssd
  mwswswssd
  mwswswssd
  mwwwswwwd
  msssssssd
  eeeeeeeee
`,
  { fixa: true },
)

/** Moeda de um real, de frente e de lado (gira na mão ou no ar). */
const moedaFrente = p(`
  .oo.
  owoO
  ooOO
  .OO.
`)
const moedaLado = p(`
  .o.
  .o.
  .O.
  .O.
`)
const moedaFina = p(`
  .w.
  .o.
  .O.
  .O.
`)

/** Nota de cinquenta dobrada ao meio. 6 × 4. */
export const nota = p(`
  nnnnnn
  nNnnwn
  nNNnnn
  NNNNNN
`)

/* ───────────── efeitos ───────────── */

/** Flash da câmera: estoura grande, encolhe, some em pontos (troca seca, sem fade). Âncora no meio. */
const flash1 = p(`
  .....w.....
  .....w.....
  ..w..w..w..
  ...wwwww...
  ...wwwww...
  wwwwwwwwwww
  ...wwwww...
  ...wwwww...
  ..w..w..w..
  .....w.....
  .....w.....
`)
const flash2 = p(`
  ...........
  ...........
  .....c.....
  ....www....
  ...c.w.c...
  ..cwwwwwc..
  ...c.w.c...
  ....www....
  .....c.....
  ...........
  ...........
`)
const flash3 = p(`
  ...........
  ...........
  ...........
  ...m...m...
  ...........
  .....c.....
  ...........
  ...m...m...
  ...........
  ...........
  ...........
`)

/** Linhas de velocidade atrás da moto: só riscos retos, que passam e somem. Âncora na ponta direita. */
const vel1 = p(`
  ......cccccccccc
  ................
  ..wwwwwwwwwwwwww
  ................
  ........cccccccc
  ................
  ...mmmmmmmmmmm..
`)
const vel2 = p(`
  ..cccccccccc....
  ................
  wwwwwwwwwwww....
  ................
  ....cccccccc....
  ................
  mmmmmmmmmm......
`)
const vel3 = p(`
  cccccc..........
  ................
  wwwwww..........
  ................
  cccc............
  ................
  mmmm............
`)

/** Notas musicais (o beat do MC): colcheia e semicolcheias, em branco com a sombra cinza. */
const colcheia = p(`
  ..wm
  ..ww
  ..w.
  ..w.
  www.
  ww..
`)
const semicolcheia = p(`
  ..wwww
  ..wmmw
  ..w..w
  ..w..w
  www.ww
  ww.ww.
`)

/* ───────────── montagem ───────────── */

function item(id: string, nome: string, pc: Peca, pega: { x: number; y: number }, sobre: string): Personagem {
  return criarPersonagem({
    id,
    nome,
    w: pc.w,
    h: pc.h,
    ancora: pega,
    paleta: paletaItens,
    animacoes: { parado: { sobre, quadros: [[[pc, 0, 0]]], ms: 1000 } },
  })
}

function efeito(id: string, nome: string, pecas: Peca[], ancora: { x: number; y: number }, ms: number[], sobre: string, laco = false): Personagem {
  const w = Math.max(...pecas.map((q) => q.w))
  const h = Math.max(...pecas.map((q) => q.h))
  return criarPersonagem({
    id,
    nome,
    w,
    h,
    ancora,
    paleta: paletaItens,
    animacoes: { parado: { sobre, quadros: pecas.map((q) => [[q, 0, 0]] as const), ms, laco } },
  })
}

// Pega: o pixel que fica dentro da mão (a mão do quadro desenha por baixo; o item vem por cima).
export const itens: Record<string, Personagem> = {
  lataFanta: item('lataFanta', 'Fanta Ghost Face Punch', lataFanta, { x: 1, y: 4 }, 'A lata da Fanta Ghost Face Punch na mão.'),
  lataArizona: item('lataArizona', 'Arizona Green Tea', lataArizona, { x: 1, y: 5 }, 'A lata alta do Arizona Green Tea na mão.'),
  lataCoca: item('lataCoca', 'Coca-Cola Vanilla', lataCoca, { x: 1, y: 4 }, 'A Coca-Cola Vanilla na mão.'),
  seda: item('seda', 'Livreto de seda OCB', livretoSeda, { x: 1, y: 3 }, 'O livreto de seda que o skatista leva.'),
  piteira: item('piteira', 'Piteira de vidro', piteiraVidro, { x: 0, y: 4 }, 'A piteira de vidro que o turista compra.'),
  sacola: item('sacola', 'Sacola do pedido GC', sacolaGC, { x: 4, y: 1 }, 'A sacola do pedido, pela alça, com o GC (não espelha).'),
  nota: item('nota', 'Nota de cinquenta', nota, { x: 1, y: 2 }, 'A nota com que o cliente paga.'),
  moeda: efeito('moeda', 'Moeda', [moedaFrente, moedaLado, moedaFina, moedaLado], { x: 2, y: 2 }, [140, 90, 90, 90], 'A moeda girando (na mão ou no ar).', true),
  flash: efeito('flash', 'Flash da câmera', [flash1, flash2, flash3], { x: 5, y: 5 }, [70, 90, 110], 'O flash estoura e some em degrau; o motor pode piscar a cena de branco junto (opacidade em degraus).'),
  velocidade: efeito('velocidade', 'Linhas de velocidade', [vel1, vel2, vel3], { x: 16, y: 3 }, [70, 70, 90], 'Riscos atrás da moto que arranca (âncora na traseira).', false),
  colcheia: efeito('colcheia', 'Nota musical', [colcheia], { x: 1, y: 5 }, [400], 'Nota que sobe do fone do MC (o motor sobe em degraus).'),
  semicolcheia: efeito('semicolcheia', 'Notas musicais', [semicolcheia], { x: 1, y: 5 }, [400], 'Duas notas ligadas, a outra do beat.'),
}

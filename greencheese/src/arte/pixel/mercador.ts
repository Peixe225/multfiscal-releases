// O mercador do RE4 em pixel art, para o repost: capuz fundo com o rosto na sombra, dois olhos acesos,
// bandana roxa (a única cor dele), mochila enorme com o saco amarrado em cima, casaco comprido aberto na mão.
// No forro, em vez de arma, a mercadoria da loja: uísque quadrado, gin verde, lata, livreto de seda e isqueiro,
// cada um numa altura, pendurados. A aba cai da mão e abre para baixo (borda com degraus, dobras e barra irregular).
//
// Grade 44×64 → 176 px (4 px por pixel) ou 132 px (3 px) de largura. Capuz e aba têm aro m por fora, para não
// sumirem no preto do OLED; o rosto é transparente de propósito (o fundo do quadro faz a sombra) e fica fechado
// pelo capuz em cima e dos dois lados.
//
// No fim do arquivo, a apresentação: camadas na mesma grade em que ele abre o outro lado do casaco (tabacaria no
// forro) e dá uns tragos (estes só com config.mercadorTraga).

import type { Grade } from './grades'

export const mercador: Grade = {
  w: 44,
  h: 64,
  linhas: [
    '............................................',
    '..................mm........................',
    '.....mccecm......cmmm.......................',
    'mm..mcwccecccm..cmmmem......................',
    'mmmcmwccccecccm.cmmmmemm....................',
    '.mmcccccccecccmcmmmmmeeem...................',
    'mmmcccccccceccccmmmmmeeeem..................',
    'mm..mccccccecccmmmmmedddddm.................',
    '.....mmmmmmmemcmmmmmm.....em................',
    '..mmmmmmmmmmmmcmmmme..y..y.em...............',
    'meeeeeeeeeeeeemmmmme.......em.........m.....',
    'meeeeeeeeeeeeemmmmmeepppppppm........ccm....',
    '.ddddddddddd.emmmmmeepppppppmmmmmm..cccm....',
    '.eeee.....mmmemmmmmeepppppppmeeeeemmccec....',
    'emmmme..mcmmmeemmmmeeppppppmeeeeeeemmccm....',
    'emmmme.mcmcmmmeemmmeeeppppmeeeeeeeem.mm.....',
    'eeeeeemcmedemmeeeemmeeeppmeddeeeeedddddmm...',
    'emcmmemcmedemmeeeeeeeeeddddddmmdddddddedm...',
    'emmmmemcmedemmeeemeeeeeedddddaAddddddeddm...',
    'emmmmemcmedemmeeemeeeeemdddddaAdddddedddem..',
    'emmmmemcmedemmeeemeeeeemddddaaaAdddeddddem..',
    'emmmmemcmedemmeeemeeeeedmddawaaAAdddmmddem..',
    'eeeeeemcmedemmeeemeeeeedmddawaaAAdddggddem..',
    '.mmmm.mmmedemmeeemeeeeeddmdeeeeeAdddggdddem.',
    'meeeemmmeedccceeemeeeeeddmdecceeAddggggddem.',
    'meeeemmmmedceceeeeeeeeeddddeeeeeAdggggggdem.',
    '.eeee.mcmedccceeemeeeeeddddaaaaAAdgwggggdem.',
    '......mcmedemmeeemeeeeeddddaaaaAAdgwcccgdem.',
    '......mcmedemmeeemeeeeeddddaaaaAAdgccrcgdem.',
    '.....mmcmedemmeeemeeeeeddddaaaaAAdgccccgdem.',
    '.....mmcmedemmeeemeeeeedddddddddddggggggdem.',
    '.....mcccmdemmeeeeeeeeedddddwwwwddggggggdem.',
    '.....eeeeedeeeeeemeeeeeddddswwwwsddggggddem.',
    '......eccmeeeeeeemeeeeeddddssssssddddddddem.',
    '......cccmeeeeeeemeeeeeddddseeeesdddddddem..',
    '......cccmeeeeeeemeeeeeddddssssssdddddddem..',
    '......cecedeeeeeemeeeeeddddddddddddccccdem..',
    '......ceceeeeeeeeemeeeeddddddddddedrwrrdem..',
    '......eeeeeeeeedeeeeeeeddddddddddedrwrrdem..',
    '......mmmmmeeeedmmmmeeeddddddddddedrwrrddem.',
    '.....mdddddmmmmmddddmmeddddddddddedrrrrddem.',
    '.....mmmeeedddddeemeddeddddddddddedrrrrddem.',
    '.....mmmeeeeeeedeemeeeeddddddcdddedrrrrddem.',
    '.....mmceeeeeeedeemeeeedddddcccddedccccddem.',
    '.....mmceeeeeeedeemeeeedddddoooddedddddddem.',
    '.....mmmeeeeeeedeeeeeeedddddoooddeddddeddem.',
    '.....mmmeeeeeeedeemeeeedddddoooddeddddeddem.',
    '.....mmmeeeeeeedeemeeeedddddooodedddddedddem',
    '....mmmeeeeeeeedeemeeeedddddooodeddddddeddem',
    '....mmmmmmeeeeedmmmmeeedddddooodeddddddeddem',
    '....ddddddmmmmmmddddmmedddddddddeddddddeddem',
    '....mmmeeeddddddeemeddedddddddddeddddddeddem',
    '....mmmeeeeeeeedeeeeeeedddddddddeddddddeddem',
    '....mmceeeeeeeedeemeeeedddddddddeddddddeddem',
    '...mmmceeeeeeeedeemeeeedddddddddedddddddedem',
    '...mmmeeeeeeeeedeemeeeddddddddddedddddddedem',
    '...m.mm.e.mm..me.m.e.mddmmmmddddmmmdddddedem',
    '...........mme.......mme....mmmm...mmmmdddmm',
    '...........mee.......meee..............mmm..',
    '...........meee......meeee..................',
    '...........meeee.....meeeeee................',
    '..........mmmmmmm....meeeeee................',
    '.....................mmmmmmmm...............',
    '............................................',
  ],
  paleta: {
    m: '#636363', // --chiado: luz do casaco, aro do capuz e da aba, tampas (3,5:1 no preto: a silhueta não some no OLED)
    e: '#3a3a3a', // casaco na sombra, luva, botas, dobras do forro: por dentro do aro, nunca sozinho na borda do capuz/aba
    d: '#262626', // --bolha: forro do casaco, vão entre a manga e o corpo
    c: '#a8a8a8', // --legenda: saco de lona, luvas sem dedo, punho, fivela
    w: '#ffffff', // brilho pontual: vidro, lata, folha saindo do livreto
    p: '#6e4aa8', // bandana: a única cor do mercador (3:1 no preto)
    y: '#ffd27a', // olhos acesos dentro do capuz
    a: '#c8832f', // Jack Daniel's (a mesma cor do catálogo)
    A: '#8a5520', // lado do uísque na sombra (garrafa quadrada)
    g: '#3f8a5a', // Gin Tanqueray (catálogo)
    r: '#d21f35', // Coca-Cola Vanilla (catálogo)
    s: '#8f9bb3', // capa do livreto de seda OCB (catálogo), com a folha branca saindo em cima
    o: '#e2552f', // Isqueiro Clipper (catálogo)
  },
}

/** Só os olhos, em currentColor: desenhado por cima, na cor do fundo, faz o mercador piscar. Mesma grade, mesmo encaixe de pixel. */
export const palpebras: Grade = {
  w: mercador.w,
  h: mercador.h,
  linhas: mercador.linhas.map((l) => l.replace(/[^y]/g, '.').replace(/y/g, 'x')),
}

/* ───────────── apresentação: abre o outro lado do casaco e dá uns tragos ───────────── */
//
// Camadas por cima do mercador, na mesma grade 44×64: o PixelArte encaixa todas no mesmo pixel de tela da base.
// Em cada camada, '.' deixa ver o de baixo, 'x' apaga (pinta na cor do fundo do quadro, via currentColor) e o resto
// pinta com a paleta. A ordem do array é a ordem de empilhar; quando cada uma aparece fica no Rodape.css
// (voz pixel: opacidade em degrau, steps(1), um tique = 125 ms).
//
// O forro da esquerda mostra só acessório de tabacaria que a loja vende, nada de derivado do tabaco (Anvisa,
// RDC 840/2023): livretos de seda OCB (capa preta), RAW (parda) e Smoking (marrom), dichavador de metal com a tampa
// recartilhada, piteira de vidro e livreto de piteira de papel. O cigarro do trago é genérico: papel branco, sem marca.

const paletaApresentacao: Record<string, string> = {
  ...mercador.paleta,
  k: '#101011', // capa do livreto OCB: preta, sempre dentro de aro m (senão some no forro e no OLED)
  b: '#c08a55', // seda RAW (catálogo)
  B: '#7d5530', // faixa do RAW, mais escura
  n: '#8a5a36', // seda Smoking Brown (catálogo)
  t: '#c9a27a', // livreto de piteira de papel RAW (catálogo)
  v: '#9fd6e3', // piteira de vidro (catálogo)
  i: '#8aa3b8', // dichavador de metal (catálogo)
  I: '#4d5762', // dichavador na sombra: recartilhado e junta das partes
}

/** Uma camada da apresentação: o retângulo de arte posto em (x, y) numa grade vazia do tamanho do mercador. */
function camada(x: number, y: number, linhas: string[]): Grade {
  const vazia = '.'.repeat(mercador.w)
  const saida = Array.from({ length: mercador.h }, () => vazia)
  linhas.forEach((l, i) => {
    saida[y + i] = vazia.slice(0, x) + l + vazia.slice(x + l.length)
  })
  return { w: mercador.w, h: mercador.h, linhas: saida, paleta: paletaApresentacao }
}

/** Pega a beirada do casaco: o antebraço sai do pendurado e uma fresta do forro aparece. */
const pega = camada(5, 18, [
  'emcmedemmeeememcce',
  'emcmedemmeeccmccce',
  'emcmedemmccmmcecce',
  'emcmedeccmmeemccme',
  'emcmmccmmeeememmdd',
  '.mmmmmmeeeeememddd',
  'mmeeeeccceeememddd',
  'mmeeeececeeeeemddd',
  '.meeeeccceeememddd',
  '.meeeeemmeeememddd',
  '.meeeeemmeeememddd',
  'xmeeeeemmeeememddd',
  'xmeeeeemmeeememddd',
  'xmeeeeemmeeeeemddd',
  'xmeeeeeeeeeememddd',
  '.meeeeeeeeeememddd',
  '.meeeeeeeeeememddd',
  '.meeeeeeeeeememddd',
  '.meeedeeeeeememddd',
  '.meeeeeeeeeeemmddd',
  '.meeeeeeeedeeemddd',
])

/** Meio aberto: a mão a meio caminho, só a coluna de dentro do forro à vista. */
const meio = camada(3, 14, [
  'mme..mmmmmeemmmmeepp',
  'mme.meeeeemeemmmeeep',
  'eeexxmeeeemeeeemmeee',
  'mmexmccmmmmmdddddmee',
  'mmemcccmdddddddddmee',
  'mmececcmddwwwwdddmee',
  'mmemccmedmwwwwmddmee',
  'mmemmedddmkkkkmddmee',
  'eeemeddddmkwwkmddmee',
  'mm.meddddmkkkkmddmee',
  'eemmeddddmmmmmmddmee',
  'eemmeddddddddddddmee',
  'ee.meddddddddddddmee',
  '...medddddcwccdddmee',
  '...meddddiIiIiIddmee',
  '..xmeddddiiiiiiddmee',
  '..xmeddddIIIIIIddmee',
  '..xmeddddiiiiiiddmee',
  '..xmedddddIIIIdddmee',
  '...meddddddddddddmee',
  '...meddedddddddddmee',
  '...meddedddddddddmee',
  '...meddeddddvddddmee',
  '...meddedddwvddddmee',
  '...meddedddwvddddmee',
  '...meddedddwvddddmee',
  '..xmeddedddwvddddmee',
  '..xmeddedddwvddddmee',
  '..xmeddeddddvddddmee',
  '..medddedddddddddmee',
  '..medddedddddddddmee',
  '.meddddedddddddddmee',
  '.meddddedddddddddmee',
  '.meddddedddddddddmee',
  '.meddddedddddddddmee',
  '.meddddedddddddddmee',
  '.meddddedddddddddmee',
  '.meddddedddddddddmee',
  '.meddddedddddddddmee',
  '.meddddedddddddddmee',
  'xmeddddedddddddddmee',
  'xmeddddedddddddddmee',
  'xmeddddmmmdddmmmmmmd',
  '.mmmm...mme.......mm',
])

/** Aberto: a mão no alto segura a aba, como do outro lado; o forro mostra a tabacaria. */
const aberto = camada(0, 10, [
  'memeeeeeeeeeeemmmmme...',
  'mmcceeeeeeeeeemmmmmeepp',
  '.mcccddmmmmmmemmmmmeepp',
  '.ceccmmeeeeeeemmmmmeepp',
  'xmccmmeeeeeeeeemmmmeepp',
  'xxmmxmeeeeeeeeeemmmeeep',
  'mmdddddeeeeeddeeeemmeee',
  'mdedddddddmmddddddddmee',
  'mddeddddddddddddddddmee',
  'meddeddddddddwwwwdddmee',
  'medddeddddddmwwwwmddmee',
  'meddddddddddmkkkkmddmee',
  'medddwwwwdddmkwwkmddmee',
  'meddbwwwwbddmkkkkmddmee',
  'meddbbbbbbddmmmmmmddmee',
  'meddbBBBBbddddddddddmee',
  'meddbbbbbbddddddddddmee',
  'medddddddddddcwccdddmee',
  'meddddddddddiIiIiIddmee',
  'medddwwwddddiiiiiiddmee',
  'meddnwwwndddIIIIIIddmee',
  'meddnnnnndddiiiiiiddmee',
  'meddntttnddddIIIIdddmee',
  'meddnnnnndddddddddddmee',
  'meddddddddedddddddddmee',
  'meddddddddedddddddddmee',
  'meddddddddeddddvddddmee',
  'meddddddddedddwvddddmee',
  'meddddddddedddwvddddmee',
  'meddtttttdedddwvddddmee',
  'meddtBBBtdedddwvddddmee',
  'meddtttttdedddwvddddmee',
  'meddddddddeddddvddddmee',
  'meddddddddedddddddddmee',
  'meddddddddedddddddddmee',
  'meddedddddedddddddddmee',
  'meddedddddedddddddddmee',
  'meddedddddedddddddddmee',
  'meddedddddedddddddddmee',
  'meddedddddedddddddddmee',
  'meddedddddedddddddddmee',
  'meddedddddedddddddddmee',
  'meddedddddedddddddddmee',
  'meddedddddedddddddddmee',
  'mededdddddedddddddddmee',
  'mededdddddedddddddddmee',
  'mededddddmmmddddmmmmmmd',
  'mmdddmmmm..mme.......mm',
])

/** Cigarro na mão, de pé na altura do peito, brasa fraca em cima. */
const baixo = camada(5, 16, [
  'emcmedemoee',
  'emcmedemwee',
  'emcmedemwee',
  'emcmedecwce',
  'emcmmmmcccm',
  'emcmccmcecm',
  'emmmmmmmmme',
  '.meeeeemmee',
  'mmeeeecccee',
  'mmeeeececee',
  '.meeeecccee',
  '.meeeeemmee',
  '.meeeeemmee',
  'xmeeeeemmee',
  'xmeeeeemmee',
  'xmeeeeemmee',
  'xmeeeeeeeee',
  '.meeeeeeeee',
  '.meeeeeeeee',
  '.meeeeeeeee',
  '.meeedeeeee',
  '.meeeeeeeee',
  '.meeeeeeeed',
])

/** Na boca: a mão encosta na beirada da bandana, o cigarro entre os dedos, brasa para fora. */
const boca = camada(5, 14, [
  'e..mcmmmeemmmmmcc',
  'e.mcmcmmmeowwwccc',
  'emcmedemmeeeeeccm',
  'emcmedemmeecceeee',
  'emcmedemmccmmeeee',
  'emcmedeccmmeeeeee',
  'emcmeccmmeeemeeee',
  'emcccmmeeeeemeeee',
  'emmmmeemmeeemeeee',
  '.meeeeemmeeemeeee',
  'mmeeeeccceeemeeee',
  'mmeeeececeeeeeeee',
  '.meeeeccceeemeeee',
  '.meeeeemmeeemeeee',
  '.meeeeemmeeemeeee',
  'xmeeeeemmeeemeeee',
  'xmeeeeemmeeemeeee',
  'xmeeeeemmeeeeeeee',
  'xmeeeeeeeeeemeeee',
  '.meeeeeeeeeemeeee',
  '.meeeeeeeeeemeeee',
  '.meeeeeeeeeemeeee',
  '.meeedeeeeeemeeee',
  '.meeeeeeeeeeemeee',
  '.meeeeeeeedeeeeee',
])

/** Puxando: a brasa acende (por cima de "boca"). */
const brasa1 = camada(15, 15, [
  'y',
])

/** Puxando mais: a brasa no máximo. */
const brasa2 = camada(14, 15, [
  'yw',
])

/** Fumaça 1: sai pela beirada de cima da bandana, dentro do capuz. */
const fumaca1 = camada(25, 10, [
  '.cc.',
  'cwwc',
  '.cc.',
])

/** Fumaça 2: a baforada passa a beira do capuz; um fio novo sai atrás. */
const fumaca2 = camada(26, 5, [
  '..ccc.',
  '.cwwcc',
  '.cwccc',
  '..ccc.',
  '......',
  '......',
  'cc....',
  'cc....',
])

/** Fumaça 3: sobe para a direita e começa a apagar. */
const fumaca3 = camada(27, 2, [
  '...mcm.',
  '..mcccm',
  '..mccmm',
  '...mmm.',
  '.......',
  '.cc....',
  'cwc....',
  '.cc....',
])

/** Fumaça 4: desmancha no alto. */
const fumaca4 = camada(29, 0, [
  '...m.m.',
  '..m.e.m',
  '...e.m.',
  '.......',
  '.mm....',
  'mccm...',
  '.mm....',
])

/** Fumaça 5: o último fio some. */
const fumaca5 = camada(31, 1, [
  '.e.m',
  'm.e.',
  '.e..',
])

export type NomeQuadro = 'pega' | 'meio' | 'aberto' | 'baixo' | 'boca' | 'brasa1' | 'brasa2' | 'fumaca1' | 'fumaca2' | 'fumaca3' | 'fumaca4' | 'fumaca5'

/** Camadas na ordem de empilhar. As de `trago` só entram com config.mercadorTraga. */
export const apresentacao: readonly { nome: NomeQuadro; grade: Grade; trago?: true }[] = [
  { nome: 'pega', grade: pega },
  { nome: 'meio', grade: meio },
  { nome: 'aberto', grade: aberto },
  { nome: 'baixo', grade: baixo, trago: true },
  { nome: 'boca', grade: boca, trago: true },
  { nome: 'brasa1', grade: brasa1, trago: true },
  { nome: 'brasa2', grade: brasa2, trago: true },
  { nome: 'fumaca1', grade: fumaca1, trago: true },
  { nome: 'fumaca2', grade: fumaca2, trago: true },
  { nome: 'fumaca3', grade: fumaca3, trago: true },
  { nome: 'fumaca4', grade: fumaca4, trago: true },
  { nome: 'fumaca5', grade: fumaca5, trago: true },
]

// O mercador do RE4 em pixel art, para o repost: capuz fundo com o rosto na sombra, dois olhos acesos,
// bandana roxa (a única cor dele), mochila enorme com o saco amarrado em cima, casaco comprido aberto na mão.
// No forro, em vez de arma, a mercadoria da loja: uísque quadrado, gin verde, lata, livreto de seda e isqueiro,
// cada um numa altura, pendurados. A aba cai da mão e abre para baixo (borda com degraus, dobras e barra irregular).
//
// Grade 44×64 → 176 px (4 px por pixel) ou 132 px (3 px) de largura. Capuz e aba têm aro m por fora, para não
// sumirem no preto do OLED; o rosto é transparente de propósito (o fundo do quadro faz a sombra) e fica fechado
// pelo capuz em cima e dos dois lados.

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

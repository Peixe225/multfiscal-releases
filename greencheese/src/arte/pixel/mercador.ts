// O mercador do RE4 em pixel art, para o repost: capuz fundo com o rosto na sombra, dois olhos acesos,
// bandana roxa (a única cor dele), mochila enorme com o saco amarrado em cima, casaco comprido aberto na mão.
// No forro, em vez de arma, a mercadoria da loja: uísque quadrado, gin verde, lata, livreto de seda e isqueiro.
//
// Grade 44×64 → 176 px (4 px por pixel) ou 132 px (3 px) de largura. Tudo que é escuro tem borda mais clara
// para não sumir no preto do OLED; o rosto é transparente de propósito (o fundo do quadro faz a sombra).

import type { Grade } from './grades'

export const mercador: Grade = {
  w: 44,
  h: 64,
  linhas: [
    '............................................',
    '..................mm........................',
    '.....mccecm......cmme.......................',
    'm...mcwccecccm..cmmmee......................',
    'mm.emwccccecccm.cmmmmeee....................',
    '.mmeccccccecccmcmmmmmeeee...................',
    'mm.eccccccceccccmmmmmeeeee..................',
    'm...mccccccecccmmmmmeddddd..................',
    '.....mmmmmmmemcmmmmed.....m.................',
    '..mmmmmmmmmmmmcmmmme..y..y.m................',
    'meeeeeeeeeeeeemmmmme.......m..........m.....',
    'meeeeeeeeeeeeemmmmmeepppppppm........ccm....',
    '.ddddddddddd.emmmmmeepppppppmmmmmm..cccm....',
    '.eeee.....mmmemmmmmeepppppppmeeeeemmccec....',
    'emmmme..mcmmmeemmmmeeppppppmeeeeeeemmccm....',
    'emmmme.mcmcmmmeemmmeeeppppmeeeeeeeem.mm.....',
    'eeeeeemcmedemmeeeemmeeeppmeddeeeeedmddedm...',
    'emcmmemcmedemmeeeeeeeeepeddddddddddddedem...',
    'emmmmemcmedemmeeemeeeepeddddddddddddedddm...',
    'emmmmemcmedemmeeemeeeeemddddddeedddddeeddm..',
    'emmmmemcmedemmeeemeeeeemddddddaAdddddggddm..',
    'emmmmemcmedemmeeemeeeeedmddddaaaAdddggggdm..',
    'eeeeeemcmedemmeeemeeeeedmdddawaaAAdggggggm..',
    '.mmmm.mmmedemmeeemeeeeeddmddawaaAAdgwggggm..',
    'meeeemmmeedccceeemeeeeeddmddeeeeeAdgwcccgm..',
    'meeeemmmmedceceeeeeeeeedddmdecceeAdgccrcgm..',
    '.eeee.mcmedccceeemeeeeedddmdeeeeeAdgccccgm..',
    '......mcmedemmeeemeeeeeddddmaaaaAAdggggggm..',
    '......mcmedemmeeemeeeeeddddmaaaaAAdggggggm..',
    '.....mmcmedemmeeemeeeeedddddaaaaAAddggggdm..',
    '.....mmcmedemmeeemeeeeeddddddddddddddddddm..',
    '.....mcccmdemmeeeeeeeeeddddddddddddddddddm..',
    '.....eeeeedeeeeeemeeeeeddddddccccdddwwwddm..',
    '......eccmeeeeeeemeeeeeemeeedrrrrddmmmmmdm..',
    '......cccmeeeeeeemeeeeeddddddrwrrddm...mdme.',
    '......cccmeeeeeeemeeeeeddddddrwrrddmcccmdme.',
    '......cecedeeeeeemeeeeeddddddrwrrddm...mdme.',
    '......ceceeeeeeeeemeeeeddddddrrrrddm...mdme.',
    '......eeeeeeeeedeeeeeeeddddddrrrrddmmmmmddme',
    '......mmmmmeeeedmmmmeeeddddddccccdddddddddme',
    '.....mdddddmmmmmddddmmedddddddddddddddddddme',
    '.....mmmeeedddddeemeddeddddddddeddddddddddme',
    '.....mmmeeeeeeedeemeeeeddddddddeddddddddddme',
    '.....mmceeeeeeedeemeeeeddddddddedddcddddddme',
    '.....mmceeeeeeedeemeeeeddddddddeddcccdddddme',
    '.....mmmeeeeeeedeeeeeeeddddddddeddooodddddme',
    '.....mmmeeeeeeedeemeeeeddddddddeddoooddeddme',
    '.....mmmeeeeeeedeemeeeeddddddddeddoooddeddme',
    '....mmmeeeeeeeedeemeeeeddddddddeddoooddeddme',
    '....mmmmmmeeeeedmmmmeeeddddddddeddoooddeddme',
    '....ddddddmmmmmmddddmmeddddddddeddoooddeddme',
    '....mmmeeeddddddeemeddeddddddddedddddddeddme',
    '....mmmeeeeeeeedeeeeeeeddddddddddddddddeddme',
    '....mmceeeeeeeedeemeeeeddddddddddddddddeddme',
    '...mmmceeeeeeeedeemeeeeddddddddddddddddeddme',
    '...mmmeeeeeeeeedeemeeedddddddddddddddddeddme',
    '...m.mm.e.mm..me.m.e.mddddddddddddddddddddm.',
    '...........mme.......mme....mm.mme.mm.mmmmm.',
    '...........mee.......meee............m.mmmm.',
    '...........meee......meeee..................',
    '...........meeee.....meeeeee................',
    '..........mmmmmmm....meeeeee................',
    '.....................mmmmmmmm...............',
    '............................................',
  ],
  paleta: {
    m: '#636363', // --chiado: luz do casaco e do capuz, bordas (3,5:1 no preto: a silhueta não some no OLED)
    e: '#3a3a3a', // casaco na sombra, luva, botas: sempre encostado em m ou c
    d: '#262626', // --bolha: forro do casaco, vão entre a manga e o corpo
    c: '#a8a8a8', // --legenda: saco de lona, luvas sem dedo, punho, fivela
    w: '#ffffff', // brilho pontual: vidro, lata, papel saindo do livreto
    p: '#6e4aa8', // bandana: a única cor do mercador (3:1 no preto)
    y: '#ffd27a', // olhos acesos dentro do capuz
    a: '#c8832f', // Jack Daniel's (a mesma cor do catálogo)
    A: '#8a5520', // lado do uísque na sombra (garrafa quadrada)
    g: '#3f8a5a', // Gin Tanqueray (catálogo)
    r: '#d21f35', // Coca-Cola Vanilla (catálogo)
    o: '#e2552f', // Isqueiro Clipper (catálogo)
  },
}

/** Só os olhos, em currentColor: desenhado por cima, na cor do fundo, faz o mercador piscar. Mesma grade, mesmo encaixe de pixel. */
export const palpebras: Grade = {
  w: mercador.w,
  h: mercador.h,
  linhas: mercador.linhas.map((l) => l.replace(/[^y]/g, '.').replace(/y/g, 'x')),
}

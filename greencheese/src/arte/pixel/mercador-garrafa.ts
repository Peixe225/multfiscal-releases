// O mercador do repost numa pose só dele, para a sacola vazia: casaco fechado e o braço erguido segurando a garrafa
// de uísque pelo gargalo, como quem mostra a mercadoria. Mesma grade 44×64 (132 px a 3 px por pixel), mesmas letras e
// a mesma paleta do mercador.ts: mochila, saco de lona, capuz com aro, olhos acesos e bandana são os mesmos pixels.
// A garrafa é a do bonequinho que a sacola vazia tinha antes (tampa, gargalo, rótulo escuro com a faixa branca), maior
// e com o lado em sombra, como a do forro do repost; o punho fechado cobre o gargalo, que aparece em cima e embaixo dele.
// Embaixo das botas, a sombra pontilhada no chão que o bonequinho também tinha.
//
// Grade à parte: a do repost não muda, porque as camadas da apresentação (mercador.ts) dependem dela pixel a pixel.

import type { Grade } from './grades'
import { mercador } from './mercador'

export const mercadorGarrafa: Grade = {
  w: 44,
  h: 64,
  linhas: [
    '.......................................mm...',
    '..................mm...................aA...',
    '.....mccecm......cmmm..................aA...',
    'mm..mcwccecccm..cmmmem................cccm..',
    'mmmcmwccccecccm.cmmmmemm...........mmccccm..',
    '.mmcccccccecccmcmmmmmeeem.........meeccecm..',
    'mmmcccccccceccccmmmmmeeeem.......meeemccm...',
    'mm..mccccccecccmmmmmedddddm.....meeed..aA...',
    '.....mmmmmmmemcmmmmmm.....em...meeeed.aaaAA.',
    '..mmmmmmmmmmmmcmmmme..y..y.em.meeemd.awaaaAA',
    'meeeeeeeeeeeeemmmmme.......emmeeemed.awaaaAA',
    'meeeeeeeeeeeeemmmmmeepppppppmmeemed..addddAA',
    '.ddddddddddd.emmmmmeepppppppmmeeeed..awwwwAA',
    '.eeee.....mmmemmmmmeepppppppmeeeeed..addddAA',
    'emmmme..mcmmmeemmmmeeppppppmeeeeem...adccdAA',
    'emmmme.mcmcmmmeemmmeeeppppmeeeeeem...addddAA',
    'eeeeeemcmedemmeeeemmeeeppmeddeeem....aaaaaAA',
    'emcmmemcmedemmeeeeeeeeedmeeeemeem....AAAAAAA',
    'emmmmemcmedemmeeemeeeeedmeeeemedm...........',
    'emmmmemcmedemmeeemeeeeedmeeeemedm...........',
    'emmmmemcmedemmeeemeeeeecceeeemedm...........',
    'emmmmemcmedemmeeemeeeeedmeeeemedm...........',
    'eeeeeemcmedemmeeemeeeeedmeeeemedm...........',
    '.mmmm.mmmedemmeeemeeeeedmeeeemedm...........',
    'meeeemmmeedccceeemeeeeedmeeeemedm...........',
    'meeeemmmmedceceeeeeeeeedmeeeemedm...........',
    '.eeee.mcmedccceeemeeeeedmeeeemedm...........',
    '......mcmedemmeeemeeeeecceeeemedm...........',
    '......mcmedemmeeemeeeeedmeeeemeedm..........',
    '.....mmcmedemmeeemeeeeedmeeeemeedm..........',
    '.....mmcmedemmeeemeeeeedmeeeemeedm..........',
    '.....mcccmdemmeeeeeeeeedmeeeemeedm..........',
    '.....eeeeedeeeeeemeeeeedmeeeemeedm..........',
    '......eccmeeeeeeemeeeeedmeeeemeedm..........',
    '......cccmeeeeeeemeeeeecceeeemeedm..........',
    '......cccmeeeeeeemeeeeedmeeeemeedm..........',
    '......cecedeeeeeemeeeeedmeeeemeedm..........',
    '......ceceeeeeeeeemeeeedmeeeemeedm..........',
    '......eeeeeeeeedeeeeeeedmeeeemeedm..........',
    '......mmmmmeeeedmmmmeeedmmmmdeeeem..........',
    '.....mdddddmmmmmddddmmedddddmmmmmm..........',
    '.....mmmeeedddddeemeddedeeeeddddddm.........',
    '.....mmmeeeeeeedeemeeeedmeeedeemedm.........',
    '.....mmceeeeeeedeemeeeedmeeedeemedm.........',
    '.....mmceeeeeeedeemeeeedmeeedeemedm.........',
    '.....mmmeeeeeeedeeeeeeedmeeedeemedm.........',
    '.....mmmeeeeeeedeemeeeedmeeedeemedm.........',
    '.....mmmeeeeeeedeemeeeedmeeedeemedm.........',
    '....mmmeeeeeeeedeemeeeedmeeedeemedm.........',
    '....mmmmmmeeeeedmmmmeeedmmmmdeeeeem.........',
    '....ddddddmmmmmmddddmmedddddmmmmmmm.........',
    '....mmmeeeddddddeemeddedeeeedddddddm........',
    '....mmmeeeeeeeedeeeeeeedmeeedeemeedm........',
    '....mmceeeeeeeedeemeeeedmeeedeemeedm........',
    '...mmmceeeeeeeedeemeeeedmeeedeemeedm........',
    '...mmmeeeeeeeeedeemeeeddmeeedeemeedm........',
    '...m.mm.e.mm..me.m.e.mdmm.me.m.em.mm........',
    '...........mme.......mme....................',
    '...........mee.......meee...................',
    '...........meee......meeee..................',
    '...........meeee.....meeeeee................',
    '..........mmmmmmm....meeeeee................',
    '......d.d.d.d.d.d.d..mmmmmmmm.d.d.d.........',
    '.........d.d.d.d.d.d.d.d.d.d.d.d............',
  ],
  paleta: mercador.paleta,
}

/** Só os olhos, em currentColor: por cima, na cor do fundo, faz ele piscar (como as pálpebras do repost). */
export const palpebrasGarrafa: Grade = {
  w: mercadorGarrafa.w,
  h: mercadorGarrafa.h,
  linhas: mercadorGarrafa.linhas.map((l) => l.replace(/[^y]/g, '.').replace(/y/g, 'x')),
}

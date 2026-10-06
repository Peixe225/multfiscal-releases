// Ícones das abas (barra do celular e lateral do computador), no molde do Instagram: contorno quando a aba está
// fechada, cheio quando é a aba atual. E o rosto do mercador, que mora no centro da barra na Home 2.
// Mesmo formato de grades.ts ('.' transparente, 'x' = currentColor, outras letras da paleta).
import type { Grade } from './grades'
import { mercador } from './mercador'

function g(linhas: string[], paleta?: Record<string, string>): Grade {
  return { w: linhas[0]?.length ?? 0, h: linhas.length, linhas, paleta }
}

/**
 * Recorta um retângulo de uma grade (mesma paleta). Usado uma vez para tirar o rosto do mercador da grade 44×64;
 * o resultado foi conferido a 8x e congelado como grade literal (rostoMercador), com os pixels soltos limpos à mão.
 */
export function recortar(grade: Grade, x: number, y: number, w: number, h: number): Grade {
  const linhas = grade.linhas.slice(y, y + h).map((l) => l.slice(x, x + w).padEnd(w, '.'))
  return { w, h, linhas, paleta: grade.paleta }
}

export const iconesAbas = {
  // Casa do Início: telhado em degrau, paredes retas e a porta no meio (o 'estrela' saiu da lateral).
  casa: g([
    '................',
    '.......xx.......',
    '......x..x......',
    '.....x....x.....',
    '....x......x....',
    '...x........x...',
    '..x..........x..',
    '..x..........x..',
    '..x..........x..',
    '..x...xxxx...x..',
    '..x...x..x...x..',
    '..x...x..x...x..',
    '..x...x..x...x..',
    '..x...x..x...x..',
    '..xxxxx..xxxxx..',
    '................',
  ]),
  // A mesma casa, cheia (aba atual), com a porta vazada.
  'casa-cheia': g([
    '................',
    '.......xx.......',
    '......xxxx......',
    '.....xxxxxx.....',
    '....xxxxxxxx....',
    '...xxxxxxxxxx...',
    '..xxxxxxxxxxxx..',
    '..xxxxxxxxxxxx..',
    '..xxxxxxxxxxxx..',
    '..xxxxxxxxxxxx..',
    '..xxxxx..xxxxx..',
    '..xxxxx..xxxxx..',
    '..xxxxx..xxxxx..',
    '..xxxxx..xxxxx..',
    '..xxxxx..xxxxx..',
    '................',
  ]),
  // Lupa com traço de 2 pixels (aba Catálogo aberta), como a busca "selecionada" do Instagram.
  'lupa-grossa': g([
    '................',
    '...xxxxxx.......',
    '..xxxxxxxx......',
    '.xxx....xxx.....',
    '.xx......xx.....',
    '.xx......xx.....',
    '.xx......xx.....',
    '.xx......xx.....',
    '.xxx....xxx.....',
    '..xxxxxxxxx.....',
    '...xxxxxxxxx....',
    '.........xxxx...',
    '..........xxxx..',
    '...........xxxx.',
    '............xxx.',
    '................',
  ]),
}

/**
 * Rosto do mercador para o centro da barra (32 px = 2 px por pixel): capuz, os dois olhos acesos e a bandana roxa.
 * Saiu de recortar(mercador, 14, 1, 16, 16), sem o pixel do saco solto na borda esquerda. É a exceção colorida da
 * barra, como a foto do perfil na barra do Instagram.
 */
export const rostoMercador: Grade = g(
  [
    '....mm..........',
    '...cmmm.........',
    '..cmmmem........',
    '..cmmmmemm......',
    '.cmmmmmeeem.....',
    'ccmmmmmeeeem....',
    'cmmmmmedddddm...',
    'cmmmmmm.....em..',
    'cmmmme..y..y.em.',
    'mmmmme.......em.',
    'mmmmmeepppppppm.',
    'mmmmmeepppppppmm',
    'mmmmmeepppppppme',
    'emmmmeeppppppmee',
    'eemmmeeeppppmeee',
    'eeeemmeeeppmedde',
  ],
  mercador.paleta,
)

/** As pálpebras do rosto (os olhos em currentColor), para piscar junto com o mercador grande. */
export const palpebrasRosto: Grade = g(rostoMercador.linhas.map((l) => l.replace(/[^y]/g, '.').replace(/y/g, 'x')))

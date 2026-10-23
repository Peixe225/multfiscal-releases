// Ícones das abas (barra do celular e lateral do computador), no molde do Instagram: contorno quando a aba está
// fechada, cheio quando é a aba atual.
// Mesmo formato de grades.ts ('.' transparente, 'x' = currentColor, outras letras da paleta).
import type { Grade } from './grades'

function g(linhas: string[], paleta?: Record<string, string>): Grade {
  return { w: linhas[0]?.length ?? 0, h: linhas.length, linhas, paleta }
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
  // Caixa de importação do Rateio: a fita em cima e a linha de corte tracejada descendo pela frente (a caixa que a
  // galera divide).
  caixa: g([
    '................',
    '....xxxxxxxx....',
    '...x...xx...x...',
    '..x....xx....x..',
    '.xxxxxxxxxxxxxx.',
    '.x.....xx.....x.',
    '.x.....xx.....x.',
    '.x............x.',
    '.x.....xx.....x.',
    '.x............x.',
    '.x.....xx.....x.',
    '.x............x.',
    '.x.....xx.....x.',
    '.x............x.',
    '.xxxxxxxxxxxxxx.',
    '................',
  ]),
  // A mesma caixa, cheia (aba atual): a fita, a dobra da tampa e o corte vazados.
  'caixa-cheia': g([
    '................',
    '....xxxxxxxx....',
    '...xxxx..xxxx...',
    '..xxxxx..xxxxx..',
    '.x............x.',
    '.xxxxxx..xxxxxx.',
    '.xxxxxx..xxxxxx.',
    '.xxxxxxxxxxxxxx.',
    '.xxxxxx..xxxxxx.',
    '.xxxxxxxxxxxxxx.',
    '.xxxxxx..xxxxxx.',
    '.xxxxxxxxxxxxxx.',
    '.xxxxxx..xxxxxx.',
    '.xxxxxxxxxxxxxx.',
    '.xxxxxxxxxxxxxx.',
    '................',
  ]),
}

// O pôster da rua, desenhado no build (vite.config.ts) com o mesmo motor e o mesmo elenco da página, num canvas de
// mentira: o quadro 0 da rua parada (montarElenco). O story do celular mostra ele na hora, antes de o pedaço da rua e
// o worker chegarem, e a animação assume por cima sem piscar (o primeiro quadro dela é este mesmo, no mesmo lugar).
// Só roda no Node (o vite.config.ts carrega este arquivo só quando o pôster é pedido): nada daqui vai para o navegador.

import { montar } from './montar'
import { Motor } from './motor'
import { PEDIDO, type Folha, type LadrilhoPronto, type Pacote, type PacoteBruto } from './pacote'
import { EM_PE, LARGURA_DEITADO, palcoEmPe, palcoFaixaStory } from './palco'
import { montarElenco } from './roteiro'
import { TelaFalsa, type ImagemCrua } from './tela-falsa'

export interface Poster {
  w: number
  h: number
  rgba: Uint8ClampedArray
}

/** O pôster de uma das duas cenas: o mundo em pé (story do celular) ou a faixa larga (story do celular deitado). */
export function pintarPoster(bruto: PacoteBruto, cena: 'emPe' | 'faixa'): Poster {
  const img = (i: number) => bruto.imagens[i] as ImagemCrua as unknown as CanvasImageSource
  const folhas: Record<string, Folha> = {}
  bruto.folhas.forEach((f, i) => (folhas[f.id] = { ...f, img: img(i) }))
  const ladrilhos: Record<string, LadrilhoPronto> = {}
  bruto.ladrilhos.forEach((l, i) => (ladrilhos[l.id] = { ...l, img: img(bruto.folhas.length + i) }))
  const pacote: Pacote = { folhas, ladrilhos }
  const palco = cena === 'emPe' ? palcoEmPe({ x0: 0, x1: EM_PE.w }) : palcoFaixaStory(LARGURA_DEITADO)
  const tela = new TelaFalsa()
  const m = new Motor({
    tela: tela as unknown as HTMLCanvasElement,
    pacote,
    palco,
    semente: 1,
    sexta: false,
    aoBaloes: () => {},
    aoDesenhar: () => {},
    criarTela: (w, h) => new TelaFalsa(w, h) as unknown as HTMLCanvasElement,
  })
  montarElenco(m)
  m.desenhar()
  return { w: m.w, h: m.h, rgba: tela.pixels() }
}

/** Os dois pôsteres, com o elenco montado aqui mesmo (o mesmo pedido da página). */
export async function pintarPosteres(): Promise<Record<'emPe' | 'faixa', Poster>> {
  const bruto = await montar(PEDIDO)
  return { emPe: pintarPoster(bruto, 'emPe'), faixa: pintarPoster(bruto, 'faixa') }
}

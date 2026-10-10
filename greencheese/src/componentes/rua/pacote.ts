// O elenco da rua pronto para desenhar: cada personagem (item, objeto, sombra) vira uma folha — os quadros únicos
// numa imagem só, em células de w × h, a 1 px por pixel — mais o que o motor precisa de cada quadro (tempo, passo,
// mão, evento, caixa do que é visível). Montar os 280 quadros custa uns 200 ms de CPU: vai num worker, longe do
// toque; sem worker (navegador velho, arquivo único), monta aqui mesmo, no tempo ocioso.

import { POSTE_EM_PE, POSTE_FAIXA } from './palco'

export type Lado = 'dir' | 'esq'

export interface QuadroMeta {
  /** Célula da folha do lado direito e do esquerdo. */
  d: number
  e: number
  ms: number
  passo: number
  evento?: string
  /** Ponto da mão (lado direito; o esquerdo espelha: w - 1 - x). */
  mao: [number, number] | null
  /** Caixa do que é visível no lado direito: x0, y0, x1, y1 (x1 e y1 fora). */
  caixa: [number, number, number, number]
}

export interface AnimMeta {
  laco: boolean
  duracao: number
  q: QuadroMeta[]
}

export interface FolhaMeta {
  id: string
  w: number
  h: number
  ancora: { x: number; y: number }
  /** Colunas de células na imagem. */
  colunas: number
  anims: Record<string, AnimMeta>
  retrato: { animacao: string; quadro: number }
}

export interface Folha extends FolhaMeta {
  img: CanvasImageSource
}

export interface LadrilhoPronto {
  id: string
  w: number
  h: number
  img: CanvasImageSource
}

/** Imagem crua (RGBA) para quem não tem createImageBitmap no worker. */
export interface Crua {
  w: number
  h: number
  dados: Uint8ClampedArray
}

/** O que o montar devolve (e o worker manda): metadados e as imagens, na mesma ordem. */
export interface PacoteBruto {
  folhas: FolhaMeta[]
  ladrilhos: { id: string; w: number; h: number }[]
  /** Uma por folha e depois uma por ladrilho. */
  imagens: (ImageBitmap | Crua)[]
}

export interface Pacote {
  folhas: Record<string, Folha>
  ladrilhos: Record<string, LadrilhoPronto>
}

/** Pedido ao montador: os postes (id, id da luz e altura). A faixa e o story em pé saem juntos, uma vez só. */
export interface PedidoPacote {
  postes: { poste: string; luz: string; altura: number }[]
}

/** O pedido de sempre: o poste baixo da faixa e o alto do story em pé (o mesmo pacote serve às duas cenas). */
export const PEDIDO: PedidoPacote = {
  postes: [
    { poste: 'poste', luz: 'luz', altura: POSTE_FAIXA },
    { poste: 'poste-alto', luz: 'luz-alta', altura: POSTE_EM_PE },
  ],
}

function paraImagem(i: ImageBitmap | Crua): CanvasImageSource {
  if (!('dados' in i)) return i
  const c = document.createElement('canvas')
  c.width = i.w
  c.height = i.h
  c.getContext('2d')?.putImageData(new ImageData(i.dados as Uint8ClampedArray<ArrayBuffer>, i.w, i.h), 0, 0)
  return c
}

function montarPacote(b: PacoteBruto): Pacote {
  const folhas: Record<string, Folha> = {}
  b.folhas.forEach((f, i) => (folhas[f.id] = { ...f, img: paraImagem(b.imagens[i]) }))
  const ladrilhos: Record<string, LadrilhoPronto> = {}
  b.ladrilhos.forEach((l, i) => (ladrilhos[l.id] = { ...l, img: paraImagem(b.imagens[b.folhas.length + i]) }))
  return { folhas, ladrilhos }
}

/** Montagem aqui mesmo (sem worker): o montador num pedaço à parte, quando o navegador respira. */
async function montarAqui(pedido: PedidoPacote): Promise<Pacote> {
  await new Promise<void>((ok) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(() => ok(), { timeout: 1500 })
    else setTimeout(ok, 200)
  })
  const { montar } = await import('./montar')
  return montarPacote(await montar(pedido))
}

const prontos = new Map<string, Promise<Pacote>>()

/** O elenco pronto (uma vez só: a faixa e o story em pé usam o mesmo; a segunda chamada reaproveita). */
export function carregarPacote(pedido: PedidoPacote = PEDIDO): Promise<Pacote> {
  const chave = pedido.postes.map((p) => `${p.poste}:${p.altura}`).join()
  let p = prontos.get(chave)
  if (!p) {
    p = new Promise<Pacote>((ok) => {
      let w: Worker
      try {
        w = new Worker(new URL('./elenco.worker.ts', import.meta.url), { type: 'module' })
      } catch {
        ok(montarAqui(pedido))
        return
      }
      let feito = false
      const plano = () => {
        if (feito) return
        feito = true
        w.terminate()
        ok(montarAqui(pedido))
      }
      w.onmessage = (e: MessageEvent<PacoteBruto | { erro: string }>) => {
        if (feito) return
        if ('erro' in e.data) return plano()
        feito = true
        w.terminate()
        ok(montarPacote(e.data))
      }
      w.onerror = plano
      w.onmessageerror = plano
      w.postMessage(pedido)
    })
    // falhou de vez: a próxima tentativa monta de novo
    p.catch(() => prontos.delete(chave))
    prontos.set(chave, p)
  }
  return p
}

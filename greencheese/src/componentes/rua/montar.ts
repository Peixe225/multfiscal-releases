// Monta o pacote da rua (ver pacote.ts): roda no worker (elenco.worker.ts) ou, sem worker, aqui mesmo. Cada
// personagem vira uma folha com os quadros únicos (o mesmo quadro repetido em várias animações entra uma vez) em
// células de w × h; as cores saem direto no RGBA, sem canvas.

import { cenario, criarLuz, criarPoste, elenco, itens, paletaCenario, sombras, type Personagem } from '../../arte/pixel/rua'
import type { Peca } from '../../arte/pixel/rua/compor'
import type { AnimMeta, Crua, FolhaMeta, PacoteBruto, PedidoPacote } from './pacote'

const rgba = new Map<string, number>()
/** '#rrggbb' → 0xRRGGBB. */
function corDe(css: string): number {
  let c = rgba.get(css)
  if (c == null) {
    c = parseInt(css.slice(1), 16)
    rgba.set(css, c)
  }
  return c
}

function folhaDe(per: Personagem): { meta: FolhaMeta; img: Crua } {
  // quadros únicos (dir e esq), na ordem em que aparecem
  const celulas = new Map<Uint8Array, number>()
  const lista: Uint8Array[] = []
  const celula = (px: Uint8Array) => {
    let i = celulas.get(px)
    if (i == null) {
      i = lista.length
      celulas.set(px, i)
      lista.push(px)
    }
    return i
  }
  const anims: Record<string, AnimMeta> = {}
  for (const [nome, a] of Object.entries(per.animacoes)) {
    anims[nome] = {
      laco: a.laco,
      duracao: a.duracao,
      q: a.dir.map((q, i) => {
        // caixa do visível (para tocar no personagem e pôr o balão em cima da cabeça)
        let x0 = per.w
        let y0 = per.h
        let x1 = 0
        let y1 = 0
        for (let y = 0; y < per.h; y++)
          for (let x = 0; x < per.w; x++)
            if (q.px[y * per.w + x]) {
              if (x < x0) x0 = x
              if (x >= x1) x1 = x + 1
              if (y < y0) y0 = y
              if (y >= y1) y1 = y + 1
            }
        if (x1 === 0) x0 = y0 = 0
        return {
          d: celula(q.px),
          e: celula(a.esq[i].px),
          ms: q.ms,
          passo: q.passo,
          ...(q.evento ? { evento: q.evento } : {}),
          mao: q.mao ? [q.mao.x, q.mao.y] : null,
          caixa: [x0, y0, x1, y1],
        }
      }),
    }
  }
  const colunas = Math.max(1, Math.ceil(Math.sqrt((lista.length * per.h) / per.w)))
  const linhas = Math.ceil(lista.length / colunas)
  const W = colunas * per.w
  const H = linhas * per.h
  const dados = new Uint8ClampedArray(W * H * 4)
  const cores = per.cores.map((c) => (c === 'transparent' ? -1 : corDe(c)))
  lista.forEach((px, n) => {
    const ox = (n % colunas) * per.w
    const oy = Math.floor(n / colunas) * per.h
    for (let y = 0; y < per.h; y++)
      for (let x = 0; x < per.w; x++) {
        const ci = px[y * per.w + x]
        if (!ci) continue
        const c = cores[ci]
        if (c < 0) continue
        const o = ((oy + y) * W + ox + x) * 4
        dados[o] = c >> 16
        dados[o + 1] = (c >> 8) & 255
        dados[o + 2] = c & 255
        dados[o + 3] = 255
      }
  })
  return { meta: { id: per.id, w: per.w, h: per.h, ancora: per.ancora, colunas, anims, retrato: per.retrato }, img: { w: W, h: H, dados } }
}

function ladrilhoDe(id: string, pc: Peca): Crua & { id: string } {
  const dados = new Uint8ClampedArray(pc.w * pc.h * 4)
  pc.linhas.forEach((l, y) => {
    for (let x = 0; x < pc.w; x++) {
      const css = paletaCenario[l[x]]
      if (!css) continue
      const c = corDe(css)
      const o = (y * pc.w + x) * 4
      dados[o] = c >> 16
      dados[o + 1] = (c >> 8) & 255
      dados[o + 2] = c & 255
      dados[o + 3] = 255
    }
  })
  return { id, w: pc.w, h: pc.h, dados }
}

/** Monta tudo. Com createImageBitmap (worker), as imagens já saem prontas para transferir. */
export async function montar(pedido: PedidoPacote): Promise<PacoteBruto> {
  const pers: Personagem[] = [
    ...Object.values(elenco),
    ...Object.values(itens),
    cenario.objetos.porta,
    cenario.objetos.letreiro,
    cenario.objetos.engradado,
    criarPoste(pedido.alturaPoste),
    criarLuz(pedido.alturaLuz),
    // sombras com o id do personagem na frente: sombra-mercador…
    ...Object.values(sombras),
  ]
  const folhas: FolhaMeta[] = []
  const cruas: Crua[] = []
  for (const per of pers) {
    const { meta, img } = folhaDe(per)
    folhas.push(meta)
    cruas.push(img)
  }
  const lad = Object.values(cenario.ladrilhos).map((l) => ladrilhoDe(l.id, l.peca))
  cruas.push(...lad)
  const bitmap = typeof createImageBitmap === 'function' && typeof ImageData !== 'undefined'
  const imagens = bitmap
    ? await Promise.all(cruas.map((c) => createImageBitmap(new ImageData(c.dados as Uint8ClampedArray<ArrayBuffer>, c.w, c.h))))
    : cruas
  return { folhas, ladrilhos: lad.map(({ id, w, h }) => ({ id, w, h })), imagens }
}

// Base das ilustrações realistas dos produtos (SVG). Cada produto é um componente que devolve um <g>
// desenhado no quadro 0 0 360 640 (9:16), fundo TRANSPARENTE, produto centrado em x = 180.
//
// CONVENÇÕES (todas as ilustrações seguem, para a vitrine parecer uma sessão de fotos só):
// - Luz principal de cima à esquerda; reflexo vertical claro a ~22–30% da largura do objeto; núcleo de sombra a ~70–80%;
//   fio de luz de recorte (rim light) bem fino na borda direita. Nada de chão nem sombra projetada: o produto flutua no preto.
// - Ocupação: garrafas de y≈60 a y≈580; latas de y≈130 a y≈560; livretos/acessórios inclinados ou em perspectiva
//   ocupando ~70% da altura útil. O centro visual fica em y≈320.
// - Rótulo com o NOME DA MARCA legível (é o que identifica o produto no card de ~170 px de largura): marca com no mínimo
//   ~34 unidades de altura de letra. Evocar a identidade (cores, formas, tipo de letra), sem copiar logotipo à risca.
// - IDs de <defs> SEMPRE prefixados com a prop `id` (vários produtos iguais na mesma página).
// - Só gradientes, formas e texto. Evitar filtros (feGaussianBlur etc.): pesam no celular. No máximo um blur pequeno.
// - Fontes de texto: use as pilhas abaixo (existem no Android, iPhone e desktop).

import type { ComponentType } from 'react'

export const QUADRO = { w: 360, h: 640 } as const

export interface PropsArte {
  /** Prefixo único para os ids de <defs>. */
  id: string
}

export type Arte = ComponentType<PropsArte>

/** Pilhas de fonte para rótulos. */
export const FONTE = {
  serifa: "Georgia, 'Times New Roman', Times, serif",
  serifaPesada: "'Bodoni 72', 'Didot', Georgia, 'Times New Roman', serif",
  sans: "'Helvetica Neue', Helvetica, Arial, 'Segoe UI', Roboto, sans-serif",
  sansPesada: "'Arial Black', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  condensada: "'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', Arial, sans-serif",
  script: "'Brush Script MT', 'Segoe Script', 'Snell Roundhand', cursive",
} as const

/** Gradiente horizontal "cilíndrico" (vidro/lata): escuro nas bordas, reflexo à esquerda, núcleo de sombra à direita. */
export function cilindro(base: string, opts: { claro?: string; escuro?: string; reflexo?: string } = {}) {
  const claro = opts.claro ?? 'rgba(255,255,255,0.55)'
  const escuro = opts.escuro ?? 'rgba(0,0,0,0.55)'
  const reflexo = opts.reflexo ?? 'rgba(255,255,255,0.9)'
  return [
    { o: 0, c: escuro },
    { o: 0.08, c: base },
    { o: 0.2, c: claro },
    { o: 0.26, c: reflexo },
    { o: 0.32, c: claro },
    { o: 0.5, c: base },
    { o: 0.74, c: escuro },
    { o: 0.92, c: base },
    { o: 1, c: escuro },
  ]
}

/** <linearGradient> pronto a partir de paradas. */
export function Gradiente({ id, paradas, x1 = 0, y1 = 0, x2 = 1, y2 = 0 }: { id: string; paradas: { o: number; c: string }[]; x1?: number; y1?: number; x2?: number; y2?: number }) {
  return (
    <linearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2}>
      {paradas.map((p, i) => (
        <stop key={i} offset={p.o} stopColor={p.c} />
      ))}
    </linearGradient>
  )
}

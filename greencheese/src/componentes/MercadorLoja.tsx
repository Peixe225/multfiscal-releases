import { useRef } from 'react'
import { PixelArte } from '../arte/PixelArte'
import type { Grade } from '../arte/pixel/grades'
import { abrirCasacoJa, MercadorAnimado, useMercadorAnda } from './Mercador'
import './MercadorLoja.css'

// O mercador de pé ao lado do perfil, no Início do computador: só ele, sem moldura, sem texto e sem link, como quem
// toma conta da loja. Abre o casaco (e, com config.mercadorTraga, dá uns tragos) só na tela, com a aba à vista e sem
// camada por cima; o mouse em cima abre o casaco na hora. Decorativo: o Hero.tsx escolhe a escala (3×, 4× ou 5×) pela
// sobra ao lado do perfil e tira ele quando não cabe.

/**
 * Sombra de chão em pixel, na largura da grade do mercador (44): três linhas atrás das botas (sola nas linhas 61 e 62
 * da grade 44×64), mais larga no meio, centrada nos pés (não na mochila).
 */
const SOMBRA: Grade = {
  w: 44,
  h: 3,
  linhas: [
    '........xxxxxxxxxxxxxxxxxxxxxxx.............',
    '.....xxxxxxxxxxxxxxxxxxxxxxxxxxxxx..........',
    '.........xxxxxxxxxxxxxxxxxxxxx..............',
  ],
}

export function MercadorLoja({ escala }: { escala: number }) {
  const figura = useRef<HTMLDivElement>(null)
  const anda = useMercadorAnda(figura)
  return (
    <div
      className="mercador-loja"
      style={{ ['--k' as string]: `${escala}px` }}
      aria-hidden="true"
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse' && anda) abrirCasacoJa(figura.current)
      }}
    >
      <PixelArte grade={SOMBRA} escala={escala} className="mercador-loja-sombra" />
      <MercadorAnimado refFigura={figura} tamanho={44 * escala} anda={anda} />
    </div>
  )
}

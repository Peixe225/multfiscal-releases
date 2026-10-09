import { useRef, useState, useSyncExternalStore } from 'react'
import { PixelArte } from '../arte/PixelArte'
import type { Grade } from '../arte/pixel/grades'
import { abrirCasacoJa, MercadorAnimado, useMercadorAnda } from './Mercador'
import './MercadoTopo.css'

// O topo da aba Mercado: o mercador de pé, como o dono da banca recebendo quem chega ("Chega mais."), com a animação
// que ele já tem (abre o casaco; os tragos só com config.mercadorTraga). Tocar nele abre o casaco na hora e ele fala
// outra coisa; o mouse em cima também abre. É o único mercador da aba (o repost do fim saiu).

/** Sombra de chão em pixel, na largura da grade dele (44), atrás das botas (sola nas linhas 61 e 62). */
const SOMBRA: Grade = {
  w: 44,
  h: 3,
  linhas: [
    '........xxxxxxxxxxxxxxxxxxxxxxx.............',
    '.....xxxxxxxxxxxxxxxxxxxxxxxxxxxxx..........',
    '.........xxxxxxxxxxxxxxxxxxxxx..............',
  ],
}

const FALAS = ['Chega mais.', 'Vem no certo!', 'Quem já usou sabe da qualidade.'] as const

// celular pequeno (320–360 de largura ou até 700 de altura) e deitado: o mercador a 2×, para a primeira fileira de
// produtos começar na primeira tela
const BAIXA = '(max-height: 500px), (max-width: 360px), (max-width: 899px) and (max-height: 700px)'
function assinarBaixa(avisar: () => void) {
  try {
    const q = window.matchMedia(BAIXA)
    q.addEventListener('change', avisar)
    return () => q.removeEventListener('change', avisar)
  } catch {
    return () => {}
  }
}
const lerBaixa = () => {
  try {
    return window.matchMedia(BAIXA).matches
  } catch {
    return false
  }
}

export function MercadoTopo({ legenda }: { legenda: string }) {
  const figura = useRef<HTMLDivElement>(null)
  const anda = useMercadorAnda(figura)
  const [fala, setFala] = useState(0)
  const k = useSyncExternalStore(assinarBaixa, lerBaixa, () => false) ? 2 : 3
  const tocar = () => {
    abrirCasacoJa(figura.current)
    setFala((f) => (f + 1) % FALAS.length)
  }
  return (
    <header className={`aba-cab mercado-topo${k === 2 ? ' compacto' : ''}`} style={{ ['--k' as string]: `${k}px` }}>
      {/* o título vem antes do mercador no DOM (o CSS põe o mercador à esquerda e o balão em cima): abrir a aba leva o
          foco ao h1, como antes, e o leitor de tela entra ouvindo "Mercado" */}
      <div className="mercado-topo-texto">
        <h1 id="catalogo-titulo" className="aba-titulo px" tabIndex={-1}>
          Mercado
        </h1>
        <p className="aba-legenda legenda">{legenda}</p>
        {/* o balão dele: muda quando tocam (decorativo: sem região viva, que a busca usa a dela) */}
        <p className="mercado-fala">
          <span className="mercado-fala-corpo px">{FALAS[fala]}</span>
        </p>
      </div>
      <button
        type="button"
        className="mercado-dono"
        aria-label="Mercador: abrir o casaco"
        onClick={tocar}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse' && anda) abrirCasacoJa(figura.current)
        }}
      >
        <PixelArte grade={SOMBRA} escala={k} className="mercado-dono-sombra" />
        <MercadorAnimado refFigura={figura} tamanho={44 * k} anda={anda} />
      </button>
    </header>
  )
}

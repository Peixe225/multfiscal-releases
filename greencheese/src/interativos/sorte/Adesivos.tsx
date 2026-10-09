import { useEffect, useRef, useState, type Ref } from 'react'
import { PixelArte } from '../../arte/PixelArte'
import type { Grade } from '../../arte/pixel/grades'
import { ProdutoVisual } from '../../arte/ProdutoVisual'
import { Icone } from '../../componentes/comum'
import { copiarTexto } from '../../lib/copiar'
import { diasEntre, formatarFalta, formatarValidade } from '../../lib/cupom'
import type { Produto } from '../../lib/tipos'
import { useUI } from '../../store/ui'
import { T } from './textos'
import './estilo'
import '../../lib/fonte-codigo'

// As peças do prêmio no molde dos stories do Instagram, desenhadas no estilo do site (sem copiar bitmap):
// o anel e o selo dos Melhores amigos, o adesivo do código (como o adesivo de link: tocar copia) e o adesivo de
// contagem da validade. O story do prêmio, os cupons da Minha conta e o "Hoje saiu" da espera usam as mesmas.
// Verde só aqui (anel e selo): é a semântica do próprio Instagram, "isso é só pra você" (DECISOES, item 13).

export const VERDE_AMIGOS = '#1cd14f'

/** Estrela branca no círculo verde (16×16), o selo dos Melhores amigos. */
const SELO: Grade = {
  w: 16,
  h: 16,
  paleta: { g: VERDE_AMIGOS, w: '#ffffff' },
  linhas: [
    '.....gggggg.....',
    '...gggggggggg...',
    '..gggggggggggg..',
    '.ggggggwwgggggg.',
    '.ggggggwwgggggg.',
    'ggggggwwwwgggggg',
    'gggwwwwwwwwwwggg',
    'ggggwwwwwwwwgggg',
    'gggggwwwwwwggggg',
    'gggggwwwwwwggggg',
    'ggggwwwggwwwgggg',
    '.gggwwggggwwggg.',
    '.gggggggggggggg.',
    '..gggggggggggg..',
    '...gggggggggg...',
    '.....gggggg.....',
  ],
}

/** "★ Melhores amigos" do cabeçalho do story (o texto fica fora do verde: branco no preto, contraste AA). */
export function SeloAmigos({ className }: { className?: string }) {
  return (
    <span className={`selo-amigos ${className ?? ''}`}>
      <PixelArte grade={SELO} tamanho={16} />
      <span>{T.melhoresAmigos}</span>
    </span>
  )
}

/**
 * A bolinha de story da bandeja do Instagram com o anel dos Melhores amigos e o produto do prêmio dentro.
 * `vista`: o anel fica cinza, como o story que já foi visto (cupom usado, vencido).
 */
export function BolhaPremio({ produto, tamanho = 56, vista = false, className }: { produto: Produto | null; tamanho?: number; vista?: boolean; className?: string }) {
  return (
    <div className={`bolha-premio${vista ? ' vista' : ''} ${className ?? ''}`} style={{ width: tamanho, height: tamanho }} aria-hidden="true">
      <div className="bolha-premio-dentro">{produto ? <ProdutoVisual produto={produto} largura={72} revelar={false} indisponivel={vista} rotulo={null} /> : <Icone nome="dichavador" tamanho={32} />}</div>
    </div>
  )
}

interface PropsCodigo {
  /** null = ainda não existe (nasce ao guardar): o adesivo aparece trancado. */
  codigo: string | null
  /** Trancado: tocar leva pra guardar o prêmio. Sem isto, o trancado é só aviso. */
  aoTrancado?: () => void
  /** Cupom usado/vencido: o adesivo fica apagado (ainda copia). */
  apagado?: boolean
  className?: string
  refRaiz?: Ref<HTMLDivElement>
}

/**
 * Adesivo do código, no molde do adesivo de link do story: tocar copia, o texto vira "COPIADO" num degrau e volta.
 * Trancado (sem conta), mostra o cadeado e "Guarda pra liberar o código". As duas faces ficam montadas (a do trancado
 * por baixo, escondida) para o estalo de destravar (JogoSorte) não depender de render no meio da animação.
 */
export function AdesivoCodigo({ codigo, aoTrancado, apagado = false, className, refRaiz }: PropsCodigo) {
  const avisar = useUI((s) => s.avisar)
  const [copiado, setCopiado] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copiar = () => {
    if (!codigo) return
    if (!copiarTexto(codigo)) {
      avisar(T.naoCopiou)
      return
    }
    setCopiado(true)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopiado(false), 1800)
  }
  return (
    <div ref={refRaiz} className={`ad-codigo-caixa ${className ?? ''}`} data-codigo data-trancado={codigo ? undefined : ''}>
      {codigo ? (
        <button type="button" className={`ad-codigo toque${apagado ? ' apagado' : ''}`} data-copiado={copiado ? '' : undefined} onClick={copiar} aria-label={T.ariaCopiar(codigo)}>
          <Icone nome={copiado ? 'check' : 'copiar'} tamanho={16} className="ad-codigo-icone" />
          <span className="ad-codigo-txt px" aria-hidden="true">
            <span data-letras>
              {codigo.split('').map((ch, i) => (
                <span key={i}>{ch}</span>
              ))}
            </span>
            <span>{T.copiadoAdesivo}</span>
          </span>
        </button>
      ) : (
        <button type="button" className="ad-codigo ad-codigo-trancado toque" onClick={aoTrancado} tabIndex={aoTrancado ? undefined : -1} aria-disabled={aoTrancado ? undefined : true}>
          <span className="ad-cadeado" aria-hidden="true">
            <Icone nome="cadeado" tamanho={16} className="ad-cadeado-fechado" />
            <Icone nome="cadeado-aberto" tamanho={16} className="ad-cadeado-aberto" />
          </span>
          <span className="ad-codigo-txt">{T.codigoTrancado}</span>
        </button>
      )}
      <span className="sr-only" aria-live="polite">
        {copiado ? T.copiado : ''}
      </span>
    </div>
  )
}

interface PropsContagem {
  /** Guardado: até quando vale. null = antes de guardar (conta `dias` a partir de quando guardar). */
  validoAte: number | null
  /** Dias de validade depois de guardar (antes de guardar). */
  dias?: number
  agora: number
  className?: string
  refRaiz?: Ref<HTMLDivElement>
}

/** Adesivo de contagem regressiva, no molde do adesivo de contagem do story: o título e os dígitos em quadradinhos. */
export function AdesivoContagem({ validoAte, dias = 7, agora, className, refRaiz }: PropsContagem) {
  const n = validoAte != null ? Math.max(0, diasEntre(agora, validoAte)) : dias
  const digitos = String(Math.min(n, 99)).padStart(2, '0').split('')
  const titulo = validoAte != null ? T.valeAte(formatarValidade(validoAte)) : T.valeDepois
  const rotulo = n === 0 ? T.venceHoje : n === 1 ? T.dia : T.dias
  const sr = validoAte != null ? T.contagemGuardado(formatarValidade(validoAte), formatarFalta(validoAte, agora)) : T.contagemAntes(dias)
  return (
    <div ref={refRaiz} className={`ad-contagem ${className ?? ''}`} data-contagem>
      <p className="ad-contagem-titulo" aria-hidden="true">
        {titulo}
      </p>
      <p className="ad-contagem-num" aria-hidden="true">
        {digitos.map((d, i) => (
          <span key={i} className="ad-contagem-tile px">
            {d}
          </span>
        ))}
        <span className="ad-contagem-rot">{rotulo}</span>
      </p>
      <p className="sr-only">{sr}</p>
    </div>
  )
}

/** Brilho de 4 pontas em pixel (7×7): os que piscam em volta do destaque na revelação. */
export function Brilho({ className }: { className: string }) {
  return (
    <svg className={`sp-brilho ${className}`} data-brilho viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <path d="M3 0h1v2h1v1h2v1h-2v1h-1v2h-1v-2h-1v-1h-2v-1h2v-1h1z" fill="currentColor" />
    </svg>
  )
}

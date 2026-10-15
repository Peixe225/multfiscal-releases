import type { CSSProperties, ReactNode } from 'react'
import { ProdutoVisual } from '../arte/ProdutoVisual'
import { precoOuConsultar } from '../lib/formato'
import type { Produto } from '../lib/tipos'
import { restamEm } from '../store/catalogo'
import { useLocal } from '../store/local'
import { inclinacao } from './comum'
import { AdesivoLocal } from './Local'
import './StoryQuadro.css'

interface Props {
  produto: Produto
  /** 'card' (grade), 'hero' (story da home) ou 'tela' (story aberto). */
  escala: 'card' | 'hero' | 'tela'
  /** null = estado não escolhido (não mostra disponibilidade). */
  disponivel: boolean | null
  /** Texto do adesivo de localização (cidade ou estado). */
  lugar?: string | null
  revelar?: boolean
  prioridade?: boolean
  /** Cabeçalho (barrinhas + perfil) — só no hero e na tela. */
  topo?: ReactNode
  /** Adesivos interativos (variação, combo, sacola) — só na tela. */
  adesivos?: ReactNode
  /** Legenda do story (adesivo de texto). */
  legenda?: ReactNode
  /** Esconde o preço (quando o adesivo de combo já mostra os preços). */
  semPreco?: boolean
  artePropsExtra?: { flutuar?: boolean }
  className?: string
  style?: CSSProperties
}

/** "RESTA 1" · "RESTAM 3": o adesivo do estoque no limite do "restam X" do painel. */
export function textoRestam(n: number): string {
  return n === 1 ? 'RESTA 1' : `RESTAM ${n}`
}

/** O adesivo do estoque acabando, colado de lado na arte (card, story do Início, story aberto e página do produto). */
export function AdesivoRestam({ n, className }: { n: number; className?: string }) {
  return <span className={`adesivo-restam px${className ? ` ${className}` : ''}`}>{textoRestam(n)}</span>
}

/**
 * O story deles, como componente: fundo preto, produto flutuando com brilho, nome e preço em pixel,
 * "DISPONÍVEL ✅" e o adesivo da cidade. A mesma composição em 3 escalas.
 */
export function StoryQuadro({
  produto,
  escala,
  disponivel,
  lugar,
  revelar = true,
  prioridade = false,
  topo,
  adesivos,
  legenda,
  semPreco = false,
  artePropsExtra,
  className,
  style,
}: Props) {
  const indisponivel = disponivel === false
  const larguraArte = escala === 'card' ? 72 : escala === 'hero' ? 108 : 108
  // o estoque contado chegou no "restam X" do painel nesse estado: o adesivo RESTAM 3 na arte
  const uf = useLocal((s) => s.uf)
  const restam = disponivel === true ? restamEm(produto, uf) : null
  return (
    <div className={`sq sq-${escala} ${indisponivel ? 'sq-off' : ''} ${className ?? ''}`} style={{ ...style, ['--brilho' as string]: produto.cor }}>
      {topo}
      {lugar && (
        <div className="sq-adesivo">
          <AdesivoLocal texto={lugar} tamanho={escala === 'card' ? 'p' : 'm'} inclinacao={inclinacao(produto.id)} />
        </div>
      )}
      <div className={`sq-arte ${artePropsExtra?.flutuar && !indisponivel ? 'sq-flutua' : ''}`} data-arte={produto.id}>
        <ProdutoVisual produto={produto} largura={larguraArte} indisponivel={indisponivel} revelar={revelar} prioridade={prioridade} rotulo={null} />
        {restam != null && <AdesivoRestam n={restam} className="sq-restam" />}
      </div>
      <div className="sq-texto">
        <p className="sq-nome px">{produto.nome}</p>
        {produto.detalhe && escala !== 'card' && <p className="sq-detalhe">{produto.detalhe}</p>}
        {!semPreco && <p className="sq-preco px">{precoOuConsultar(produto.preco)}</p>}
        {disponivel === true && <p className="sq-disp px">DISPONÍVEL ✅</p>}
        {indisponivel && <p className="sq-disp sq-indisp px">INDISPONÍVEL</p>}
        {legenda}
      </div>
      {adesivos && <div className="sq-adesivos">{adesivos}</div>}
    </div>
  )
}

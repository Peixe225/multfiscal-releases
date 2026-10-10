// Como o cliente vê no site (espelha o StoryQuadro do site): o card da grade, no preto, com o produto flutuando no
// halo da cor dele, o nome e o preço em pixel e o "DISPONÍVEL ✅" do estado; o adesivo "RESTAM 3" no canto da arte
// quando o estoque chega no número dos ajustes. E o story do Início em miniatura (as barrinhas e o produto da vez).
import { Logo } from '../../arte/Logo'
import { brl } from '../formato'
import { ArteProduto, type ProdutoArte } from './Arte'
import type { Situacao } from './dados'

export interface DadosPrevia extends ProdutoArte {
  preco: number | null
  detalhe: string
}

/** O card da grade. situacao null = estado não escolhido (o site não mostra disponibilidade). */
export function PreviaCard({ p, situacao, restam, largura = 168 }: { p: DadosPrevia; situacao: Situacao | null; restam: number | null; largura?: number }) {
  const off = situacao != null && situacao !== 'disponivel' && situacao !== 'acabando'
  return (
    <div className={`pn-sq${off ? ' pn-sq-off' : ''}`} style={{ width: largura }}>
      <div className="pn-sq-arte">
        <ArteProduto produto={p} largura={Math.round(largura * 0.43)} cinza={off} />
        {/* o adesivo do site (StoryQuadro): colado de lado no canto da arte */}
        {restam != null && !off && <p className="pn-sq-restam px">{restam === 1 ? 'RESTA 1' : `RESTAM ${restam}`}</p>}
      </div>
      <div className="pn-sq-texto">
        <p className="pn-sq-nome px">{p.nome || 'Nome do produto'}</p>
        <p className="pn-sq-preco px">{p.preco == null ? 'Consultar' : brl(p.preco)}</p>
        {situacao != null && !off && <p className="pn-sq-disp px">DISPONÍVEL ✅</p>}
        {off && <p className="pn-sq-disp pn-sq-indisp px">INDISPONÍVEL</p>}
      </div>
    </div>
  )
}

/**
 * O story do Início em miniatura: as barrinhas (uma por produto e, com a rua do mercador ligada, a dela antes, já
 * passada, como no celular da home; na Home 2 a rua fica no fim do Início, fora do story), o perfil do estado e o
 * produto da vez.
 */
export function PreviaStory({ produtos, atual, instagram, largura = 200, comRua = false }: { produtos: DadosPrevia[]; atual: number; instagram: string; largura?: number; comRua?: boolean }) {
  const p = produtos[atual] ?? produtos[0]
  return (
    <div className="pn-sq pn-sq-story" style={{ width: largura }}>
      <div className="pn-sq-barras" aria-hidden="true">
        {comRua && (
          <span>
            <i style={{ transform: 'scaleX(1)' }} />
          </span>
        )}
        {produtos.map((x, i) => (
          <span key={x.id}>
            <i style={{ transform: `scaleX(${i < atual ? 1 : i === atual ? 0.5 : 0})` }} />
          </span>
        ))}
      </div>
      <div className="pn-sq-perfil">
        <span className="pn-sq-avatar" aria-hidden="true">
          <Logo tamanho={20} />
        </span>
        <span className="pn-sq-insta">{instagram}</span>
      </div>
      {p ? (
        <>
          <div className="pn-sq-arte">
            <ArteProduto produto={p} largura={Math.round(largura * 0.42)} />
          </div>
          <div className="pn-sq-texto">
            <p className="pn-sq-nome px">{p.nome}</p>
            <p className="pn-sq-preco px">{p.preco == null ? 'Consultar' : brl(p.preco)}</p>
            <p className="pn-sq-disp px">DISPONÍVEL ✅</p>
          </div>
        </>
      ) : (
        <p className="pn-sq-vazio">Nenhum produto à venda nesse estado.</p>
      )}
    </div>
  )
}

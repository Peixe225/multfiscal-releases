// O prêmio dito do jeito do site (src/lib/cupom.ts: destaqueDo e fraseDoPremio) e a prévia do destaque: o story dos
// Melhores amigos em miniatura, com o anel e o selo verdes (a única exceção ao "verde só no ✅", como no site).
import { Logo } from '../../arte/Logo'
import { ArteProduto } from './Arte'
import type { LojaAdmin, PremioAdmin, ProdutoAdmin, TipoPremio, ValorPremio } from './tipos'

const VERDE_AMIGOS = '#1cd14f'

type PremioBase = Pick<PremioAdmin, 'tipo' | 'valor' | 'titulo' | 'aplicaA'>

/** "LEVA 4 PAGA 3", "15% OFF", "BRINDE". */
export function destaqueDo(tipo: TipoPremio, valor: ValorPremio): string {
  if (tipo === 'leve-x-pague-y' && typeof valor === 'object' && 'leve' in valor) return `LEVA ${valor.leve} PAGA ${valor.pague}`
  if (tipo === 'desconto-percentual' && typeof valor === 'number') return `${valor}% OFF`
  return 'BRINDE'
}

const singular = (n: string) => (n.toLowerCase().endsWith('s') ? n.toLowerCase().slice(0, -1) : n.toLowerCase())

/** O destaque e em que produto (o brinde: o produto que vem; desconto: o produto, ou "em qualquer seda"). */
export function fraseDoPremio(p: PremioBase, l: LojaAdmin): { destaque: string; alvo: string; produto: ProdutoAdmin | null } {
  const destaque = destaqueDo(p.tipo, p.valor)
  if (p.tipo === 'brinde' && typeof p.valor === 'object' && 'produto' in p.valor) {
    const valor = p.valor
    const b = l.produtos.find((x) => x.id === valor.produto) ?? null
    return { destaque, alvo: b ? `${valor.qtd > 1 ? `${valor.qtd} × ` : ''}${b.nome}` : p.titulo, produto: b }
  }
  const alvos = (p.aplicaA.produtos ?? []).map((id) => l.produtos.find((x) => x.id === id)).filter((x): x is ProdutoAdmin => !!x)
  if (alvos.length) return { destaque, alvo: alvos.map((x) => x.nome).join(' ou '), produto: alvos[0] }
  const cats = (p.aplicaA.categorias ?? []).map((id) => l.categorias.find((c) => c.id === id)?.nome).filter((x): x is string => !!x).map(singular)
  return { destaque, alvo: cats.length ? `em qualquer ${cats.join(' ou ')}` : p.titulo, produto: null }
}

export function nomeDoPremio(p: PremioBase, l: LojaAdmin): string {
  const { destaque, alvo } = fraseDoPremio(p, l)
  return alvo.startsWith('em ') ? `${destaque} ${alvo}` : `${destaque} · ${alvo}`
}

/** O selo dos Melhores amigos do site (estrela branca no círculo verde, 16×16, src/interativos/sorte/Adesivos.tsx). */
const SELO = [
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
]
const CAMINHOS = (['g', 'w'] as const).map((cor) => SELO.flatMap((linha, y) => [...linha].map((c, x) => (c === cor ? `M${x} ${y}h1v1h-1z` : ''))).join(''))

function Selo() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <path d={CAMINHOS[0]} fill={VERDE_AMIGOS} />
      <path d={CAMINHOS[1]} fill="#ffffff" />
    </svg>
  )
}

/** O story do prêmio em miniatura (o que a pessoa vê quando o dichavador abre), com o cabeçalho do site. */
export function PreviaPremio({ p, l, instagram, largura = 224 }: { p: PremioBase & { descricao: string }; l: LojaAdmin; instagram: string; largura?: number }) {
  const { destaque, alvo, produto } = fraseDoPremio(p, l)
  return (
    <div className="pn-sq pn-sq-premio" style={{ width: largura }}>
      <div className="pn-sq-barras" aria-hidden="true">
        <span>
          <i style={{ transform: 'scaleX(1)' }} />
        </span>
      </div>
      <div className="pn-sq-perfil">
        <span className="pn-sq-avatar" style={{ boxShadow: `0 0 0 2px ${VERDE_AMIGOS}` }} aria-hidden="true">
          <Logo tamanho={20} />
        </span>
        <span className="pn-sq-cab">
          <span className="pn-sq-cab-linha">
            <span className="pn-sq-insta">{instagram}</span>
            <span className="pn-sq-tempo">agora</span>
          </span>
          <span className="pn-sq-selo">
            <Selo />
            Melhores amigos
          </span>
        </span>
      </div>
      <div className="pn-sq-arte">{produto && <ArteProduto produto={produto} largura={Math.round(largura * 0.38)} />}</div>
      <div className="pn-sq-texto">
        <p className="pn-sq-deu px">DEU SORTE!</p>
        <p className="pn-sq-destaque px">{destaque}</p>
        <p className="pn-sq-alvo">{alvo}</p>
        {p.descricao && <p className="pn-sq-apoio">{p.descricao}</p>}
      </div>
    </div>
  )
}

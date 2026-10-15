// O bloco da loja no Início: o que pede atenção nos produtos (esgotado em algum estado, acabando, fora do site) e os
// atalhos que não estão no topo do Início (Teste minha sorte e os ajustes da loja). Produtos, Estados e Stories ficam
// nos atalhos de cima e no "Mais".
import { Link } from '../Moldura'
import { caminho } from '../rotas'
import { Ic } from '../ui'
import { contagens, useLoja } from './dados'

export function ResumoLoja() {
  const { dados: l } = useLoja()
  if (!l) return null
  const c = contagens(l)
  const linhas = [
    c.esgotados > 0 && { href: caminho.produtosVer('esgotados'), texto: c.esgotados === 1 ? '1 produto esgotado' : `${c.esgotados} produtos esgotados`, sub: 'Chegou a 0 no estoque em algum estado: saiu do site lá.' },
    c.acabando > 0 && { href: caminho.produtosVer('acabando'), texto: c.acabando === 1 ? '1 produto acabando' : `${c.acabando} produtos acabando`, sub: `Com “restam X” no site (${l.ajustes.restamAte} ou menos).` },
    c.fora > 0 && { href: caminho.produtosVer('fora'), texto: c.fora === 1 ? '1 produto fora do site' : `${c.fora} produtos fora do site`, sub: 'Guardados no painel, sem aparecer pra ninguém.' },
  ].filter((x): x is { href: string; texto: string; sub: string } => !!x)
  return (
    <section className="pn-bloco pn-resumo-loja" aria-labelledby="h-loja-resumo">
      <div className="pn-h2-linha">
        <h2 id="h-loja-resumo" className="pn-h2">
          Loja
        </h2>
        <Link href={caminho.produtos} className="pn-link">
          Produtos
        </Link>
      </div>
      {linhas.length > 0 ? (
        <ul className="pn-pendencias">
          {linhas.map((x) => (
            <li key={x.href}>
              <Link href={x.href} className="pn-pendencia toque">
                <span className="pn-pendencia-txt">
                  <strong>{x.texto}</strong>
                  <span>{x.sub}</span>
                </span>
                <Ic nome="chevron-dir" tamanho={16} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pn-vazio">
          <Ic nome="check" tamanho={16} /> {c.noSite === 1 ? '1 produto no site' : `${c.noSite} produtos no site`}, nada esgotado.
        </p>
      )}
      <div className="pn-atalhos pn-atalhos-2">
        <Link href={caminho.sorte} className="pn-atalho toque">
          <Ic nome="dichavador" tamanho={24} />
          <span>Teste minha sorte</span>
        </Link>
        <Link href={caminho.loja} className="pn-atalho toque">
          <Ic nome="loja" tamanho={24} />
          <span>Ajustes da loja</span>
        </Link>
      </div>
    </section>
  )
}

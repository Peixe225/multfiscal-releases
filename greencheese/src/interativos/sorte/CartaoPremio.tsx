import { useId, type Ref } from 'react'
import { ProdutoVisual } from '../../arte/ProdutoVisual'
import { TONS_PAPEL, type Papel } from '../../arte/realista/beck'
import { PadraoFibras } from '../../arte/realista/papel-livreto'
import { Icone } from '../../componentes/comum'
import { config } from '../../dados/config'
import type { ValorPremio } from '../../dados/sorte'
import { copiarTexto } from '../../lib/copiar'
import { formatarValidade } from '../../lib/cupom'
import { destaqueDo } from '../../lib/cupom-uso'
import { produtoPorId } from '../../store/catalogo'
import type { Cupom } from '../../store/conta'
import { useUI } from '../../store/ui'
import { regrasSorte } from '../../dados/sorte'
import { T } from './textos'

// Cartão do prêmio: o papel do beck desenrolado, colado como adesivo (-2°), texto preto, a única cor é o produto.
// Sem conta, o código fica sob um mosaico de pixel e nem existe ainda (só nasce quando o prêmio é guardado).

export interface DadosCartao {
  titulo: string
  regra: string
  descricao?: string
  comoUsar?: string
  aplicaA: { produtos?: string[]; categorias?: string[] }
  papel: Papel
  demo: boolean
  /** Dias de validade depois de guardar (prêmio ainda sem conta). Guardado, vale a data do cupom. */
  validadeDias?: number
  valor: ValorPremio
}

export interface RefsCartao {
  cartao?: Ref<HTMLDivElement>
  rolo?: Ref<HTMLDivElement>
  pos?: Ref<HTMLDivElement>
}

interface Props {
  dados: DadosCartao
  /** Cupom guardado (mostra o código e a validade). null = ainda sem conta: código mascarado. */
  cupom: Cupom | null
  idTitulo: string
  refs?: RefsCartao
  /** O mosaico ainda cobre o código (dissolve no "GUARDADO"). */
  mosaico?: boolean
  /** Carimbo "GUARDADO" à vista. */
  guardado?: boolean
}

/** Produto que aparece na linha do cartão: o alvo do cupom, ou o brinde. */
function produtoDoCartao(d: DadosCartao) {
  const id = d.valor.tipo === 'brinde' ? d.valor.valor.produto : d.aplicaA.produtos?.[0]
  return produtoPorId(id)
}

export function CartaoPremio({ dados, cupom, idTitulo, refs, mosaico, guardado }: Props) {
  const fib = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const tons = TONS_PAPEL[dados.papel]
  const produto = produtoDoCartao(dados)
  const exemplo = dados.demo && config.carimboDeExemplo
  const abrirPagina = useUI((s) => s.abrirPagina)
  const avisar = useUI((s) => s.avisar)
  const codigo = cupom?.codigo ?? null
  const cobrir = !codigo || mosaico
  return (
    <div ref={refs?.pos} className="cartao-pos">
      <div ref={refs?.cartao} className={`cartao-premio cartao-${dados.papel}`} style={{ ['--papel' as string]: tons.base, ['--papel-claro' as string]: tons.claro, ['--papel-escuro' as string]: tons.escuro }}>
        <svg className="cartao-fibras" aria-hidden="true" focusable="false" width="100%" height="100%">
          <defs>
            <PadraoFibras id={`${fib}-f`} escura="#6b5636" clara="#ffffff" forca={tons.fibra * 0.9} finas={tons.finas} />
          </defs>
          <rect width="100%" height="100%" fill={`url(#${fib}-f)`} />
        </svg>
        <p className="cartao-cola px px-16" aria-hidden="true">
          {T.faixaCartao.split(' · ')[0]}
          <span className="cartao-cola-marca"> · {T.faixaCartao.split(' · ')[1]}</span>
        </p>
        <div className="cartao-corpo">
          {exemplo && (
            <span className="cartao-exemplo carimbo" data-carimbo>
              {T.exemplo}
            </span>
          )}
          {guardado && (
            <span className="cartao-guardado px" data-guardado aria-hidden="true">
              {T.guardado}
            </span>
          )}
          <p className="cartao-deu px px-16" data-linha>
            {T.deuSorte}
          </p>
          <p className="cartao-destaque px" data-linha aria-hidden="true">
            {destaqueDo(dados.valor)}
          </p>
          <h3 id={idTitulo} className="cartao-titulo" tabIndex={-1} data-linha>
            {dados.titulo}
          </h3>
          <p className="cartao-regra" data-linha>
            {dados.regra}
          </p>
          {dados.descricao && <p className="cartao-sub">{dados.descricao}</p>}
          {produto && (
            <div className="cartao-produto">
              <span className="cartao-mini">
                <ProdutoVisual produto={produto} largura={45} revelar={false} brilho={false} />
              </span>
              <span className="cartao-produto-nome">{produto.nome}</span>
              <button type="button" className="cartao-ver toque" onClick={() => abrirPagina(produto.id, 'link')}>
                {T.verProduto}
              </button>
            </div>
          )}
          {(cupom || dados.validadeDias != null) && (
            <p className="cartao-validade">{cupom ? T.validadeGuardado(formatarValidade(cupom.validoAte)) : T.validadeSemConta(dados.validadeDias!)}</p>
          )}
          <p className="cartao-confirma">{T.lojaConfirma}</p>
          {dados.comoUsar && <p className="cartao-sub">{dados.comoUsar}</p>}
          <div className="cartao-codigo" data-codigo>
            <span className="cartao-codigo-rot">{T.codigo}</span>
            {cobrir ? (
              <span className="cartao-codigo-valor px px-24" role="img" aria-label={codigo ? codigo : T.codigoMascarado}>
                <span aria-hidden="true">{regrasSorte.prefixo}-</span>
                <span className="cartao-mosaico" data-mosaico aria-hidden="true">
                  {codigo && <span className="cartao-mosaico-por-baixo">{codigo.slice(regrasSorte.prefixo.length + 1)}</span>}
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              </span>
            ) : (
              <span className="cartao-codigo-valor px px-24" data-letras>
                {codigo.split('').map((ch, i) => (
                  <span key={i}>{ch}</span>
                ))}
              </span>
            )}
            {codigo && (
              <button
                type="button"
                className="cartao-copiar toque"
                onClick={() => avisar(copiarTexto(codigo) ? T.copiado : T.naoCopiou)}
                aria-label={`${T.copiar} o código ${codigo}`}
              >
                <Icone nome="copiar" tamanho={16} />
                {T.copiar}
              </button>
            )}
          </div>
        </div>
      </div>
      <div ref={refs?.rolo} className={`cartao-rolo cartao-${dados.papel}`} aria-hidden="true" style={{ ['--papel' as string]: tons.base, ['--papel-claro' as string]: tons.claro, ['--papel-escuro' as string]: tons.escuro }} />
    </div>
  )
}

/** Faixa compacta de papel no lugar do cartão, durante o cadastro. */
export function FaixaPremio({ titulo, papel }: { titulo: string; papel: Papel }) {
  const tons = TONS_PAPEL[papel]
  return (
    <p className="faixa-premio" style={{ background: tons.base }}>
      <Icone nome="dichavador" tamanho={16} />
      <span>{T.faixaPremio(titulo)}</span>
    </p>
  )
}

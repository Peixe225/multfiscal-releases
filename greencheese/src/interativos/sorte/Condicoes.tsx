import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Icone } from '../../componentes/comum'
import { movimentoReduzido } from '../../lib/movimento'
import { T } from './textos'
import './estilo'

// "Ver condições": tudo que é regra do prêmio (validade, reserva sem conta, 1 por pedido, a loja confirma…) fica
// fechado num texto clicável, no cartão do prêmio e no ingresso da Minha conta. Disclosure (aria-expanded): o foco
// fica no botão e o rótulo não muda (só a seta vira). Ao abrir, a lista entra na tela sem ir pra baixo da barra dos
// botões do prêmio quando ela gruda no pé por cima do cartão (celular em pé); deitado, a barra fica ao lado.

/** As condições de um cupom, na ordem: o que vale, como usar, até quando (e a reserva sem conta) e as de sempre. */
export function listaCondicoes({ regra, comoUsar, validade, reserva }: { regra: string; comoUsar?: string; validade: string | null; reserva?: string | null }): string[] {
  const ponto = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`)
  return [ponto(regra), ...(comoUsar ? [ponto(comoUsar)] : []), ...(validade ? [validade] : []), ...(reserva ? [reserva] : []), T.condUmPorPedido, T.condEstado, T.condLoja]
}

/** Topo da barra dos botões quando ela gruda no pé da área que rola, por cima da lista (na horizontal); senão null. */
function topoDaBarra(barra: HTMLElement | null | undefined, lista: DOMRect, area: DOMRect): number | null {
  if (!barra || getComputedStyle(barra).position !== 'sticky') return null
  const b = barra.getBoundingClientRect()
  const cobre = b.left < lista.right && b.right > lista.left
  return cobre && b.bottom >= area.bottom - 4 ? b.top : null
}

/** Primeiro ancestral que rola na vertical (a coluna do jogo, a folha da Minha conta). */
function rolagemDe(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return null
}

interface Props {
  itens: string[]
  /** Fica na mesma linha do botão, à direita (ex.: "Ver produto"). */
  lado?: ReactNode
  className?: string
}

export function Condicoes({ itens, lado, className }: Props) {
  const [aberto, setAberto] = useState(false)
  const id = useId()
  const botao = useRef<HTMLButtonElement>(null)
  const painel = useRef<HTMLDivElement>(null)

  // abriu: rola só o que falta pra lista aparecer acima da barra grudada (ou do pé da coluna), sem tirar o botão da tela
  useEffect(() => {
    const el = painel.current
    const b = botao.current
    if (!aberto || !el || !b) return
    const sc = rolagemDe(el)
    if (!sc) return
    const barra = el.closest('.sorte')?.querySelector<HTMLElement>('.sorte-barra')
    const s = sc.getBoundingClientRect()
    const limite = (topoDaBarra(barra, el.getBoundingClientRect(), s) ?? s.bottom) - 12
    const falta = Math.min(el.getBoundingClientRect().bottom - limite, b.getBoundingClientRect().top - s.top - 4)
    if (falta > 0) sc.scrollBy({ top: falta, behavior: movimentoReduzido() ? 'auto' : 'smooth' })
  }, [aberto])

  return (
    <div className={`cond ${className ?? ''}`}>
      <div className="cond-linha">
        <button ref={botao} type="button" className="cond-botao toque" aria-expanded={aberto} aria-controls={id} onClick={() => setAberto((v) => !v)}>
          {T.verCondicoes}
          <Icone nome="chevron-dir" tamanho={16} className="cond-seta" />
        </button>
        {lado}
      </div>
      <div ref={painel} id={id} className="cond-painel" hidden={!aberto}>
        <ul className="cond-lista">
          {itens.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

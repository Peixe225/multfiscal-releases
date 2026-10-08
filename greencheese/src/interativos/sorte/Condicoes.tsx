import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Icone } from '../../componentes/comum'
import { movimentoReduzido } from '../../lib/movimento'
import { T } from './textos'
import './estilo'

// "Ver condições": tudo que é regra do prêmio (validade, reserva sem conta, 1 por pedido, a loja confirma…) fica
// fechado num texto clicável, no story do prêmio e nos cupons da Minha conta. Disclosure (aria-expanded): o foco
// fica no botão e o rótulo não muda (só a seta vira). No story (`sobre`), a lista abre por cima dele, acima da linha,
// sem empurrar nada; na Minha conta abre no lugar e a folha rola só o que falta pra ela aparecer.

/** As condições de um cupom, na ordem: o que vale, como usar, até quando (e a reserva sem conta) e as de sempre. */
export function listaCondicoes({ regra, comoUsar, validade, reserva }: { regra: string; comoUsar?: string; validade: string | null; reserva?: string | null }): string[] {
  const ponto = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`)
  return [ponto(regra), ...(comoUsar ? [ponto(comoUsar)] : []), ...(validade ? [validade] : []), ...(reserva ? [reserva] : []), T.condUmPorPedido, T.condEstado, T.condLoja]
}

/** Primeiro ancestral que rola na vertical (a folha da Minha conta). */
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
  /** Abre por cima (dentro do story do prêmio), sem mexer no layout nem na rolagem. */
  sobre?: boolean
}

export function Condicoes({ itens, lado, className, sobre = false }: Props) {
  const [aberto, setAberto] = useState(false)
  const id = useId()
  const botao = useRef<HTMLButtonElement>(null)
  const painel = useRef<HTMLDivElement>(null)

  // abriu no lugar: rola só o que falta pra lista aparecer acima do pé da folha, sem tirar o botão da tela
  useEffect(() => {
    const el = painel.current
    const b = botao.current
    if (!aberto || !el || !b || sobre) return
    const sc = rolagemDe(el)
    if (!sc) return
    const s = sc.getBoundingClientRect()
    const limite = s.bottom - 12
    const falta = Math.min(el.getBoundingClientRect().bottom - limite, b.getBoundingClientRect().top - s.top - 4)
    if (falta > 0) sc.scrollBy({ top: falta, behavior: movimentoReduzido() ? 'auto' : 'smooth' })
  }, [aberto, sobre])

  return (
    <div className={`cond${sobre ? ' cond-sobre' : ''} ${className ?? ''}`}>
      <div className="cond-linha">
        <button ref={botao} type="button" className="cond-botao toque" aria-expanded={aberto} aria-controls={id} onClick={() => setAberto((v) => !v)}>
          {T.verCondicoes}
          <Icone nome="chevron-dir" tamanho={16} className="cond-seta" />
        </button>
        {lado}
      </div>
      {/* por cima do story a lista pode rolar dentro dela: dá pra focar e rolar pelo teclado */}
      <div ref={painel} id={id} className="cond-painel" hidden={!aberto} {...(sobre ? { tabIndex: 0, role: 'region', 'aria-label': T.condicoes } : {})}>
        <ul className="cond-lista">
          {itens.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

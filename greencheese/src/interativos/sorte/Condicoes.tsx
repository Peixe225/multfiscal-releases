import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Icone } from '../../componentes/comum'
import { movimentoReduzido } from '../../lib/movimento'
import { T } from './textos'
import './estilo'

// "Ver condições": tudo que é regra do prêmio (validade, reserva sem conta, 1 por pedido, a loja confirma…) fica
// fechado num texto clicável, no story do prêmio e nos cupons da Minha conta. Disclosure (aria-expanded): o foco
// fica no botão e o rótulo não muda (só a seta vira). No story (`sobre`), a lista abre por cima dele, acima da linha,
// sem empurrar nada: vem logo depois do botão na ordem do Tab, o que ela cobre sai do Tab (quem usa avisa por
// `aoAlternar`) e o Esc fecha só ela (`prenderEsc`, da casca do jogo). Na Minha conta abre no lugar e a folha rola só o
// que falta pra ela aparecer.

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
  /** Abriu ou fechou (o story deixa inerte o que a lista cobre). */
  aoAlternar?: (aberto: boolean) => void
  /** Registra quem fecha no Esc enquanto a lista está aberta (devolve o "desregistrar"); sem isto, o Esc é de quem está por fora. */
  prenderEsc?: (fechar: () => void) => () => void
}

export function Condicoes({ itens, lado, className, sobre = false, aoAlternar, prenderEsc }: Props) {
  const [aberto, setAberto] = useState(false)
  const [mais, setMais] = useState(false)
  const id = useId()
  const botao = useRef<HTMLButtonElement>(null)
  const painel = useRef<HTMLDivElement>(null)

  const alternar = (v: boolean) => {
    setAberto(v)
    aoAlternar?.(v)
  }
  const fechar = useCallback(() => {
    setAberto(false)
    aoAlternar?.(false)
    botao.current?.focus({ preventScroll: true })
  }, [aoAlternar])

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

  // por cima do story: o Esc fecha a lista (e não o jogo) e o foco volta pro botão
  useEffect(() => {
    if (!aberto || !sobre || !prenderEsc) return
    return prenderEsc(fechar)
  }, [aberto, sobre, prenderEsc, fechar])

  // a lista que rola mostra um degradê no pé enquanto tem mais embaixo (senão parece cortada no meio da linha)
  useEffect(() => {
    const el = painel.current
    if (!aberto || !sobre || !el) return
    const medir = () => setMais(el.scrollTop + el.clientHeight < el.scrollHeight - 2)
    medir()
    el.addEventListener('scroll', medir, { passive: true })
    return () => el.removeEventListener('scroll', medir)
  }, [aberto, sobre])

  // desmontou aberta (o story saiu): quem usa não fica com a parte coberta inerte
  useEffect(() => () => aoAlternar?.(false), [aoAlternar])

  const lista = (
    // por cima do story a lista pode rolar dentro dela: dá pra focar e rolar pelo teclado
    <div ref={painel} id={id} className="cond-painel" hidden={!aberto} data-mais={sobre && mais ? '' : undefined} {...(sobre ? { tabIndex: 0, role: 'region', 'aria-label': T.condicoes } : {})}>
      <ul className="cond-lista">
        {itens.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  )
  return (
    <div className={`cond${sobre ? ' cond-sobre' : ''} ${className ?? ''}`}>
      <div className="cond-linha">
        <button ref={botao} type="button" className="cond-botao toque" aria-expanded={aberto} aria-controls={id} onClick={() => alternar(!aberto)}>
          {T.verCondicoes}
          <Icone nome="chevron-dir" tamanho={16} className="cond-seta" />
        </button>
        {/* por cima do story a lista fica fora do fluxo: no DOM, logo depois do botão (é a próxima parada do Tab) */}
        {sobre && lista}
        {lado}
      </div>
      {!sobre && lista}
    </div>
  )
}

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { movimentoReduzido } from '../lib/movimento'
import { produtoPorId, disponivelEm } from '../store/catalogo'
import { useChat } from '../store/chat'
import { useLocal } from '../store/local'
import { contarItens, useSacola } from '../store/sacola'
import { useUI } from '../store/ui'
import { Icone } from './comum'

/**
 * A barra de resposta do story, fixa no rodapé do celular: "Enviar mensagem…" abre o chat
 * (no hero, responde ao produto que está passando) e a sacola fica no lugar do coração.
 */
export function BarraMensagem() {
  const n = useSacola((s) => contarItens(s.itens))
  const itens = useSacola((s) => s.itens)
  const adicionar = useSacola((s) => s.adicionar)
  const setSacola = useUI((s) => s.setSacola)
  const heroProduto = useUI((s) => s.heroProduto)
  const abrir = useChat((s) => s.abrir)
  const uf = useLocal((s) => s.uf)
  const contador = useRef<HTMLSpanElement>(null)
  const anterior = useRef(n)

  // o dígito troca em degrau (sem escala elástica)
  useEffect(() => {
    if (n !== anterior.current && contador.current && !movimentoReduzido()) {
      gsap.fromTo(contador.current, { y: -8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.24, ease: 'steps(3)' })
    }
    anterior.current = n
  }, [n])

  const responder = () => {
    const p = produtoPorId(heroProduto)
    if (p && uf && disponivelEm(p, uf)) {
      if (!itens.some((i) => i.id === p.id)) adicionar(p.id, p.variacoes?.[0]?.id ?? null, 1)
      abrir('pedido', { respondendo: [p.id] })
    } else abrir('pedido')
  }

  return (
    <div className="barra-fixa" role="region" aria-label="Pedido">
      <div className="barra-resposta">
        <button type="button" className="barra-pilula toque" onClick={responder}>
          Enviar mensagem…
        </button>
        <button type="button" className="icone-botao toque barra-sacola" onClick={() => setSacola(true)} aria-label={`Sacola: ${n} ${n === 1 ? 'item' : 'itens'}`}>
          <Icone nome="sacola" tamanho={26} />
          {n > 0 && (
            <span ref={contador} className="barra-contador px">
              {n}
            </span>
          )}
        </button>
      </div>
    </div>
  )
}

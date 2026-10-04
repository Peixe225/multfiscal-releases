import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ufsAtendidas } from '../dados/canais'
import { ufs } from '../dados/ufs'
import { movimentoReduzido } from '../lib/movimento'
import './MapaBlocos.css'

interface Props {
  /** UF atual (sigla minúscula). */
  atual: string | null
  /** Tamanho do bloco em px. */
  bloco?: number
  aoTocar?: (sigla: string) => void
  /** Acende os atendidos um por um quando o mapa entra na tela. */
  acender?: boolean
  className?: string
}

/** Mapa do Brasil em blocos: 27 UFs em posição aproximada; os 5 atendidos acesos. */
export function MapaBlocos({ atual, bloco = 36, aoTocar, acender = false, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !acender) return
    const luzes = el.querySelectorAll<HTMLElement>('.mapa-luz')
    if (movimentoReduzido()) {
      gsap.set(luzes, { opacity: 1 })
      return
    }
    gsap.set(luzes, { opacity: 0 })
    let feito = false
    const io = new IntersectionObserver(
      (es) => {
        if (feito || !es.some((e) => e.isIntersecting)) return
        feito = true
        // acende estado por estado, em degraus (voz pixel)
        gsap.to(luzes, { opacity: 1, duration: 0.24, ease: 'steps(3)', stagger: 0.16, delay: 0.1 })
        io.disconnect()
      },
      { threshold: 0.4 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [acender])

  return (
    <div
      ref={ref}
      className={`mapa ${className ?? ''}`}
      style={{ ['--bloco' as string]: `${bloco}px` }}
      role="group"
      aria-label="Mapa do Brasil em blocos: estados onde a Green Cheese entrega"
    >
      {ufs.map((u) => {
        const s = u.sigla.toLowerCase()
        const aceso = ufsAtendidas.includes(s as never)
        const eh = atual === s
        const conteudo = (
          <>
            {aceso && <span className="mapa-luz" aria-hidden="true" />}
            <span className="mapa-sigla px">{u.sigla}</span>
            {eh && <span className="mapa-pin" aria-hidden="true" />}
          </>
        )
        const estilo = { gridColumn: u.x + 1, gridRow: u.y + 1 }
        const rotulo = `${u.nome}${aceso ? ' — tem Green Cheese' : ' — ainda não chegou'}${eh ? ' (seu estado)' : ''}`
        return aoTocar ? (
          <button
            key={u.sigla}
            type="button"
            className={`mapa-uf toque ${aceso ? 'aceso' : ''} ${eh ? 'atual' : ''}`}
            style={estilo}
            onClick={() => aoTocar(s)}
            aria-label={rotulo}
            aria-pressed={eh}
          >
            {conteudo}
          </button>
        ) : (
          <span key={u.sigla} className={`mapa-uf ${aceso ? 'aceso' : ''} ${eh ? 'atual' : ''}`} style={estilo} title={rotulo}>
            {conteudo}
          </span>
        )
      })}
    </div>
  )
}

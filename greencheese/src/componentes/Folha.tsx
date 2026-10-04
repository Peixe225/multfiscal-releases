import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { gsap } from 'gsap'
import { useCamadaNoHistorico } from '../lib/historico'
import { movimentoReduzido } from '../lib/movimento'
import { liberarRolagem, travarRolagem } from '../lib/rolagem'
import { Icone } from './comum'

interface Props {
  id: string
  aberta: boolean
  aoFechar: () => void
  /** Nome acessível do diálogo. */
  rotulo: string
  cabecalho?: ReactNode
  rodape?: ReactNode
  children: ReactNode
  className?: string
}

/** Folha que sobe de baixo: preto puro, canto em degrau, fio cinza. Arrastar a alça para baixo fecha. */
export function Folha({ id, aberta, aoFechar, rotulo, cabecalho, rodape, children, className }: Props) {
  const [montada, setMontada] = useState(aberta)
  const folha = useRef<HTMLDivElement>(null)
  const cortina = useRef<HTMLDivElement>(null)
  const voltarFoco = useRef<HTMLElement | null>(null)

  useCamadaNoHistorico(aberta, id, aoFechar)

  useEffect(() => {
    if (aberta) {
      voltarFoco.current = document.activeElement as HTMLElement
      setMontada(true)
    }
  }, [aberta])

  // entrada e saída: só transform/opacity, voz "app" (lisa)
  useLayoutEffect(() => {
    if (!montada) return
    const f = folha.current
    const c = cortina.current
    if (!f || !c) return
    const reduz = movimentoReduzido()
    if (aberta) {
      travarRolagem()
      gsap.fromTo(c, { opacity: 0 }, { opacity: 1, duration: reduz ? 0 : 0.2, ease: 'none' })
      gsap.fromTo(f, { yPercent: 100 }, { yPercent: 0, duration: reduz ? 0 : 0.42, ease: 'expo.out' })
      const foco = f.querySelector<HTMLElement>('[data-foco-inicial]') ?? f
      requestAnimationFrame(() => foco.focus({ preventScroll: true }))
      return () => liberarRolagem()
    }
    gsap.to(c, { opacity: 0, duration: reduz ? 0 : 0.18, ease: 'none' })
    gsap.to(f, {
      yPercent: 100,
      duration: reduz ? 0 : 0.28,
      ease: 'power3.in',
      onComplete: () => {
        setMontada(false)
        voltarFoco.current?.focus?.({ preventScroll: true })
      },
    })
  }, [aberta, montada])

  // Esc fecha
  useEffect(() => {
    if (!aberta) return
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        aoFechar()
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [aberta, aoFechar])

  // arrastar a alça para baixo
  const arrasto = useRef<{ y0: number; t0: number } | null>(null)
  const aoDescer = (e: React.PointerEvent) => {
    arrasto.current = { y0: e.clientY, t0: performance.now() }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const aoMover = (e: React.PointerEvent) => {
    if (!arrasto.current || !folha.current) return
    const dy = Math.max(0, e.clientY - arrasto.current.y0)
    gsap.set(folha.current, { y: dy })
  }
  const aoSoltar = (e: React.PointerEvent) => {
    if (!arrasto.current || !folha.current) return
    const dy = Math.max(0, e.clientY - arrasto.current.y0)
    const v = dy / Math.max(1, performance.now() - arrasto.current.t0)
    arrasto.current = null
    if (dy > 110 || v > 0.6) {
      gsap.set(folha.current, { y: 0 })
      aoFechar()
    } else gsap.to(folha.current, { y: 0, duration: 0.25, ease: 'power3.out' })
  }

  if (!montada) return null
  return (
    <>
      <div ref={cortina} className="cortina" onClick={aoFechar} aria-hidden="true" />
      <div
        ref={folha}
        className={`folha degrau-topo ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={rotulo}
        tabIndex={-1}
        data-lenis-prevent
      >
        <div
          className="folha-alca"
          onPointerDown={aoDescer}
          onPointerMove={aoMover}
          onPointerUp={aoSoltar}
          onPointerCancel={aoSoltar}
          style={{ touchAction: 'none' }}
          aria-hidden="true"
        >
          <i />
          <i />
          <i />
        </div>
        <div className="folha-topo">
          <div className="folha-titulo">{cabecalho}</div>
          <button type="button" className="icone-botao toque" onClick={aoFechar} aria-label="Fechar">
            <Icone nome="fechar" tamanho={20} />
          </button>
        </div>
        <div className="folha-corpo">{children}</div>
        {rodape && <div className="folha-rodape">{rodape}</div>}
      </div>
    </>
  )
}

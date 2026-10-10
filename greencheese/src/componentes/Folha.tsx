import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { gsap } from 'gsap'
import { prenderTab } from '../lib/foco'
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
  /**
   * Corpo só de texto, que pode passar da altura da tela (ex.: "Como funciona"): o corpo vira uma região com nome,
   * focável e com o foco ao abrir, pra setas, PageDown e Espaço rolarem (sem nada focável dentro, o teclado não chegava
   * no fim do texto).
   */
  rotuloCorpo?: string
}

/** Para onde o foco volta quando cada folha aberta fechar (a folha aberta de dentro de outra herda a reserva dela). */
const retornoDe = new WeakMap<Element, HTMLElement | null>()

/** Folha de cima: a última aberta que não está saindo (as folhas entram no DOM na ordem das camadas). */
export function folhaDoTopo(): HTMLElement | null {
  const abertas = document.querySelectorAll<HTMLElement>('.folha:not(.folha-saindo)')
  return abertas[abertas.length - 1] ?? null
}

/** Folha que sobe de baixo: preto puro, canto em degrau, fio cinza. Arrastar a alça para baixo fecha. */
export function Folha({ id, aberta, aoFechar, rotulo, cabecalho, rodape, children, className, rotuloCorpo }: Props) {
  const [montada, setMontada] = useState(aberta)
  const folha = useRef<HTMLDivElement>(null)
  const cortina = useRef<HTMLDivElement>(null)
  const voltarFoco = useRef<HTMLElement | null>(null)
  /** Quem abriu a folha de onde esta saiu (ex.: o "Trocar" da página, por trás do seletor que abriu a confirmação). */
  const reservaFoco = useRef<HTMLElement | null>(null)
  /** Até quando a cortina ignora o clique: o 2º toque de um toque duplo no botão que abriu não fecha a folha. */
  const cortinaDesde = useRef(0)
  // aoFechar muda a cada render de quem usa a folha: o Esc e a alça leem sempre o atual
  const fecharRef = useRef(aoFechar)
  fecharRef.current = aoFechar

  useCamadaNoHistorico(aberta, id, aoFechar)

  useEffect(() => {
    if (aberta) {
      const ativo = document.activeElement instanceof HTMLElement ? document.activeElement : null
      voltarFoco.current = ativo
      const outra = ativo?.closest('.folha')
      reservaFoco.current = outra ? (retornoDe.get(outra) ?? null) : null
      cortinaDesde.current = performance.now() + 350
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
      retornoDe.set(f, voltarFoco.current?.isConnected ? voltarFoco.current : reservaFoco.current)
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
        // com outra folha ainda aberta (o chat sob a sacola, ou o chat que o "Fazer pedido" abriu), o foco fica nela:
        // só volta pra quem abriu se ele estiver dentro dela; quem abriu pode ter saído da tela (a linha do seletor,
        // sob a confirmação): vale a reserva
        // Sem folha, vale a camada modal de cima (story, página do produto): um story que abriu enquanto a folha
        // saía (sacola vazia → miniatura) fica com o foco, que não volta pro botão da página por trás dele
        const outras = [...document.querySelectorAll<HTMLElement>('.folha:not(.folha-saindo)')].filter((x) => x !== f)
        const topo = outras[outras.length - 1]
        const modais = document.querySelectorAll<HTMLElement>('.story, .pp:not(.pp-saindo)')
        const caixa = topo ?? modais[modais.length - 1]
        const alvo = [voltarFoco.current, reservaFoco.current].find((el) => el?.isConnected && (!caixa || caixa.contains(el)))
        if (alvo) alvo.focus({ preventScroll: true })
        else if (topo && !topo.contains(document.activeElement)) topo.focus({ preventScroll: true })
      },
    })
  }, [aberta, montada])

  // Esc fecha só a folha de cima (com a sacola aberta por cima do chat, sai a sacola)
  useEffect(() => {
    if (!aberta) return
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !folha.current || folhaDoTopo() !== folha.current) return
      e.stopImmediatePropagation()
      fecharRef.current()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [aberta])

  // Tab fica preso na folha (o foco não vai parar na página por trás da cortina)
  const prender = (e: React.KeyboardEvent<HTMLDivElement>) => {
    prenderTab(e, folha.current)
  }

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
      fecharRef.current()
    } else gsap.to(folha.current, { y: 0, duration: 0.25, ease: 'power3.out' })
  }

  if (!montada) return null
  return (
    <>
      <div
        ref={cortina}
        className="cortina"
        onClick={() => {
          if (performance.now() >= cortinaDesde.current) fecharRef.current()
        }}
        // tocar na cortina não tira o foco da folha (ele cairia no body)
        onMouseDown={(e) => e.preventDefault()}
        aria-hidden="true"
      />
      <div
        ref={folha}
        className={`folha degrau-topo ${aberta ? '' : 'folha-saindo'} ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={rotulo}
        tabIndex={-1}
        onKeyDown={prender}
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
        {rotuloCorpo ? (
          <div className="folha-corpo" role="region" aria-label={rotuloCorpo} tabIndex={0} data-foco-inicial>
            {children}
          </div>
        ) : (
          <div className="folha-corpo">{children}</div>
        )}
        {rodape && <div className="folha-rodape">{rodape}</div>}
      </div>
    </>
  )
}

import { Fragment, useLayoutEffect, useRef, type FocusEvent } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { movimentoReduzido } from '../lib/movimento'
import { useLocal } from '../store/local'
import { useCanais } from '../store/loja'
import { trocarEstado } from '../lib/troca'
import { Icone } from './comum'
import './Faixa.css'

gsap.registerPlugin(ScrollTrigger)

// voltas do trilho: anda uma volta inteira com a rolagem, e as de depois cobrem a largura da tela até o fim (com 5
// perfis uma volta tem ~1550 px, menos que a faixa de um monitor largo)
const VOLTAS = 3

/** Foco que veio do teclado (o toque e o clique focam o botão sem :focus-visible). */
function focoDeTeclado(el: Element): boolean {
  try {
    return el.matches(':focus-visible')
  } catch {
    return false
  }
}

/**
 * A faixa em pixel com os estados: a lista de perfis que a marca posta no story, separados pela moto.
 * Só anda com a rolagem (para quando a pessoa para). Cada @ troca o site para aquele estado. Só os perfis confirmados
 * (os canais): o que ainda está a confirmar fica em canais.ts, fora da tela.
 */
export function Faixa() {
  const ref = useRef<HTMLDivElement>(null)
  const trilho = useRef<HTMLDivElement>(null)
  const anda = useRef<gsap.core.Tween | null>(null)
  const uf = useLocal((s) => s.uf)
  // os estados da loja (o dono ativa e desativa no painel): a faixa mostra os de agora
  const canais = useCanais()

  useLayoutEffect(() => {
    const el = ref.current
    const t = trilho.current
    if (!el || !t || movimentoReduzido()) return
    const ctx = gsap.context(() => {
      anda.current = gsap.fromTo(
        t,
        { x: 0 },
        {
          x: () => -(t.scrollWidth / VOLTAS),
          ease: 'none',
          modifiers: { x: (x: string) => `${Math.round(parseFloat(x) / 2) * 2}px` },
          scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: 0.3, invalidateOnRefresh: true },
        },
      )
    })
    return () => {
      anda.current = null
      ctx.revert()
    }
  }, [])

  // Teclado: o trilho anda com a rolagem e levava o @ focado pra fora da faixa (sem anel à vista). No foco do teclado,
  // a rolagem solta o trilho e ele traz o botão pra dentro, num corte; quando o foco sai da faixa, volta a andar com a
  // rolagem. Toque e clique também focam o botão, mas sem :focus-visible: aí o trilho segue com a rolagem.
  const aoFocar = (e: FocusEvent<HTMLDivElement>) => {
    const el = ref.current
    const t = trilho.current
    const b = e.target as HTMLElement
    if (!el || !t || !anda.current || !b.classList.contains('faixa-item') || !focoDeTeclado(b)) return
    anda.current.scrollTrigger?.disable(false)
    el.scrollLeft = 0 // o navegador pode ter rolado a faixa (overflow) atrás do botão
    const f = el.getBoundingClientRect()
    const r = b.getBoundingClientRect()
    const folga = 24
    let dx = 0
    if (r.left < f.left + folga) dx = f.left + folga - r.left
    else if (r.right > f.right - folga) dx = f.right - folga - r.right
    if (dx) gsap.set(t, { x: Math.round((Number(gsap.getProperty(t, 'x')) || 0) + dx) })
  }
  const aoSair = (e: FocusEvent<HTMLDivElement>) => {
    if (ref.current?.contains(e.relatedTarget as Node | null)) return
    anda.current?.scrollTrigger?.enable()
  }

  // mudou a lista (a loja do servidor chegou com outro estado): o trilho mede de novo a volta
  const primeira = useRef(true)
  useLayoutEffect(() => {
    if (primeira.current) {
      primeira.current = false
      return
    }
    ScrollTrigger.refresh()
  }, [canais])

  const itens = (copia: number) => (
    <>
      {canais.map((c) => (
        <Fragment key={`${copia}-${c.uf}`}>
          <button
            type="button"
            className={`faixa-item px toque${c.uf === uf ? ' atual' : ''}${copia ? ' faixa-copia' : ''}`}
            onClick={() => trocarEstado(c.uf)}
            tabIndex={copia ? -1 : 0}
            aria-hidden={copia ? true : undefined}
            aria-label={copia ? undefined : `Trocar para ${c.nome} (@${c.instagram})`}
          >
            @{c.instagram}
          </button>
          <Icone nome="moto" tamanho={24} className={`faixa-moto${copia ? ' faixa-copia' : ''}`} />
        </Fragment>
      ))}
    </>
  )

  return (
    <div ref={ref} className="faixa" role="region" aria-label="Todos os perfis da Green Cheese" onFocus={aoFocar} onBlur={aoSair}>
      <div ref={trilho} className="faixa-trilho">
        {Array.from({ length: VOLTAS }, (_, v) => (
          <Fragment key={v}>{itens(v)}</Fragment>
        ))}
      </div>
    </div>
  )
}

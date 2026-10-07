import { Fragment, useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { canais } from '../dados/canais'
import { movimentoReduzido } from '../lib/movimento'
import { useLocal } from '../store/local'
import { trocarEstado } from '../lib/troca'
import { Icone } from './comum'
import './Faixa.css'

gsap.registerPlugin(ScrollTrigger)

// voltas do trilho: anda uma volta inteira com a rolagem, e as de depois cobrem a largura da tela até o fim (com 5
// perfis uma volta tem ~1550 px, menos que a faixa de um monitor largo)
const VOLTAS = 3

/**
 * A faixa em pixel com os estados: a lista de perfis que a marca posta no story, separados pela moto.
 * Só anda com a rolagem (para quando a pessoa para). Cada @ troca o site para aquele estado. Só os perfis confirmados
 * (os canais): o que ainda está a confirmar fica em canais.ts, fora da tela.
 */
export function Faixa() {
  const ref = useRef<HTMLDivElement>(null)
  const trilho = useRef<HTMLDivElement>(null)
  const uf = useLocal((s) => s.uf)

  useLayoutEffect(() => {
    const el = ref.current
    const t = trilho.current
    if (!el || !t || movimentoReduzido()) return
    const ctx = gsap.context(() => {
      gsap.fromTo(
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
    return () => ctx.revert()
  }, [])

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
    <div ref={ref} className="faixa" role="region" aria-label="Todos os perfis da Green Cheese">
      <div ref={trilho} className="faixa-trilho">
        {Array.from({ length: VOLTAS }, (_, v) => (
          <Fragment key={v}>{itens(v)}</Fragment>
        ))}
      </div>
    </div>
  )
}

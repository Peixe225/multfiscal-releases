import { Fragment, useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { canais, perfisAConfirmar } from '../dados/canais'
import { linkPerfil } from '../lib/mensagem'
import { movimentoReduzido } from '../lib/movimento'
import { useLocal } from '../store/local'
import { trocarEstado } from '../lib/troca'
import { Icone } from './comum'
import './Faixa.css'

gsap.registerPlugin(ScrollTrigger)

/**
 * A faixa em pixel com os estados: a lista de perfis que a marca posta no story, separados pela moto.
 * Só anda com a rolagem (para quando a pessoa para). Cada @ troca o site para aquele estado.
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
          x: () => -(t.scrollWidth / 2),
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
            className={`faixa-item px toque ${c.uf === uf ? 'atual' : ''}`}
            onClick={() => trocarEstado(c.uf)}
            tabIndex={copia ? -1 : 0}
            aria-hidden={copia ? true : undefined}
            aria-label={copia ? undefined : `Trocar para ${c.nome} (@${c.instagram})`}
          >
            @{c.instagram}
          </button>
          <Icone nome="moto" tamanho={24} className="faixa-moto" />
        </Fragment>
      ))}
      {perfisAConfirmar.map((p) => (
        <Fragment key={`${copia}-${p.instagram}`}>
          <a
            className="faixa-item px toque"
            href={linkPerfil(p.instagram)}
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={copia ? -1 : 0}
            aria-hidden={copia ? true : undefined}
          >
            @{p.instagram} <span className="carimbo faixa-confirmar">{p.nota}</span>
          </a>
          <Icone nome="moto" tamanho={24} className="faixa-moto" />
        </Fragment>
      ))}
    </>
  )

  return (
    <div ref={ref} className="faixa" role="region" aria-label="Todos os perfis da Green Cheese">
      <div ref={trilho} className="faixa-trilho">
        {itens(0)}
        {itens(1)}
      </div>
    </div>
  )
}

import { useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { canalDa } from '../dados/canais'
import { deUf, ufPorSigla } from '../dados/ufs'
import { ehDesktop, movimentoReduzido } from '../lib/movimento'
import { nomeCidade, useLocal } from '../store/local'
import { useUI } from '../store/ui'
import { Icone } from './comum'
import './Local.css'

gsap.registerPlugin(ScrollTrigger)

/** Texto do adesivo para o estado atual. */
export function useTextoLocal(): { texto: string; procurando: boolean; vazio: boolean } {
  const { uf, cidade, cidadeInformada, detectando } = useLocal()
  if (!uf) return { texto: detectando ? 'Procurando' : 'De onde você é?', procurando: detectando, vazio: !detectando }
  const canal = canalDa(uf)
  const c = nomeCidade(canal, cidade, cidadeInformada)
  return { texto: c ?? ufPorSigla(uf)?.nome ?? uf.toUpperCase(), procurando: false, vazio: false }
}

/** O adesivo de localização do Instagram: caixa branca, pino, cidade em caixa-alta. */
export function AdesivoLocal({
  texto,
  procurando = false,
  tamanho = 'm',
  inclinacao = -4,
  aoTocar,
  rotulo,
  className,
}: {
  texto: string
  procurando?: boolean
  tamanho?: 'p' | 'm' | 'g'
  inclinacao?: number
  aoTocar?: () => void
  rotulo?: string
  className?: string
}) {
  const conteudo = (
    <>
      <Icone nome="pin" tamanho={tamanho === 'p' ? 12 : tamanho === 'g' ? 20 : 16} className="adesivo-local-pin" />
      <span className="adesivo-local-txt">{texto}</span>
      {procurando && <span className="adesivo-local-cursor" aria-hidden="true" />}
    </>
  )
  const estilo = { transform: `rotate(${inclinacao}deg)` }
  const cls = `adesivo-local adesivo-local-${tamanho} ${className ?? ''}`
  return aoTocar ? (
    <button type="button" className={`${cls} toque`} style={estilo} onClick={aoTocar} aria-label={rotulo ?? `Local: ${texto}. Trocar cidade`}>
      {conteudo}
    </button>
  ) : (
    <span className={cls} style={estilo}>
      {conteudo}
    </span>
  )
}

/**
 * Adesivo fixo no topo (celular): começa colado dentro do story do hero, torto; ao rolar ele "descola"
 * e gruda no topo, sempre visível. Tocar abre o seletor.
 */
export function TopoLocal() {
  const { texto, procurando } = useTextoLocal()
  const setSeletor = useUI((s) => s.setSeletor)
  const ref = useRef<HTMLDivElement>(null)
  const faixa = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    const f = faixa.current
    if (!el || !f || ehDesktop()) return
    const reduz = movimentoReduzido()
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: document.documentElement,
          start: 0,
          end: () => Math.max(200, window.innerHeight * 0.5),
          scrub: reduz ? false : 0.4,
        },
      })
      tl.fromTo(el, { y: 0, rotate: -4, scale: 1 }, { y: -50, rotate: 0, scale: 0.88, ease: 'none' }, 0)
      tl.fromTo(f, { opacity: 0 }, { opacity: 1, ease: 'none' }, 0.6)
    })
    return () => ctx.revert()
  }, [])

  return (
    <>
      <div ref={faixa} className="topo-faixa" aria-hidden="true" />
      <div ref={ref} className="topo-local">
        <AdesivoLocal texto={texto} procurando={procurando} inclinacao={0} aoTocar={() => setSeletor(true)} />
      </div>
    </>
  )
}

/** Enquete do story para o palpite de IP: "Parece que é de Minas Gerais — Teófilo Otoni" [É daí] | [Trocar]. */
export function EnqueteLocal({ className }: { className?: string }) {
  const { uf, cidade, confirmado, origem, confirmar } = useLocal()
  const setSeletor = useUI((s) => s.setSeletor)
  if (!uf || confirmado || origem !== 'ip') return null
  const canal = canalDa(uf)
  const c = nomeCidade(canal, cidade, null)
  return (
    <div className={`enquete ${className ?? ''}`} role="group" aria-label="Confirmar seu estado">
      <p className="enquete-pergunta">
        Parece que é {deUf(uf)}
        {c ? ` — ${c}` : ''}
      </p>
      <div className="enquete-opcoes">
        <button type="button" className="enquete-opcao toque" onClick={confirmar}>
          É daí
        </button>
        <button type="button" className="enquete-opcao toque" onClick={() => setSeletor(true)}>
          Trocar
        </button>
      </div>
    </div>
  )
}

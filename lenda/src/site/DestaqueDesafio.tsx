/**
 * O destaque do desafio na tela inicial (v3.3): só aparece com um desafio valendo. A lista é pedida depois que a tela
 * pintou e o navegador sossegou (nada de atrasar a abertura do jogo); sem rede ou com o servidor antigo, nada aparece.
 */
import { useEffect } from 'react'
import { ArrowRight } from 'lucide-react'
import { navigate } from '@/store/app'
import { TrophyArt } from '@/ui/trophies'
import { criterioEmFrase, temDesafioAtivo, textoCriterio, useDesafios, valendo } from './desafios'
import './v33.css'

/** Espera antes de pedir a lista (a tela inicial e o jogo vêm primeiro). */
const ESPERA_MS = 1800

export default function DestaqueDesafio() {
  const ativo = useDesafios(temDesafioAtivo)
  const d = useDesafios((s) => s.lista.find((x) => valendo(x)) ?? null)
  useEffect(() => {
    let feito = false
    const pedir = () => {
      if (feito) return
      feito = true
      void useDesafios.getState().carregar()
    }
    const ocioso = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    const t = window.setTimeout(() => (ocioso ? ocioso(pedir, { timeout: 4000 }) : pedir()), ESPERA_MS)
    return () => window.clearTimeout(t)
  }, [])
  if (!ativo || !d) return null
  const icone = d.criterio.todasConquistas ? 'ballon-dor' : 'world-cup'
  return (
    <button type="button" className="sv-destaque" onClick={() => navigate('/desafios')} aria-label={`Desafio valendo: ${d.titulo}. ${textoCriterio(d.criterio)}. Ver as regras`}>
      <span className="sv-destaque__i" aria-hidden="true">
        <TrophyArt id={icone} size={42} />
      </span>
      <span className="sv-destaque__t">
        <b>{d.titulo}</b>
        <span>
          Desafio valendo: {criterioEmFrase(d.criterio)}. O primeiro leva{d.premio ? `: ${d.premio.length > 80 ? `${d.premio.slice(0, 78)}…` : d.premio}` : ' o prêmio'}.
        </span>
      </span>
      <ArrowRight aria-hidden="true" />
    </button>
  )
}

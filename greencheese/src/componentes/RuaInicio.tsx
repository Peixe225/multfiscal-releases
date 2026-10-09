import { Component, lazy, Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { alturaDaFaixa } from './rua/palco'
import { useUI } from '../store/ui'
import './RuaInicio.css'

// A vaga da rua viva no Início do computador (embaixo do perfil): reserva a altura exata da faixa desde o primeiro
// quadro (zero pulo) e só baixa a rua (pedaço à parte, com o elenco montando num worker) no primeiro respiro depois da
// abertura. A primeira tela não paga nada por ela. No celular a rua é o primeiro story (rua/StoryRua.tsx).

const Rua = lazy(() => import('./rua/Rua'))

/** Um pedaço que não baixou (4G oscilando) deixa a vaga preta, sem derrubar o Início. */
class Guarda extends Component<{ children: ReactNode }, { erro: boolean }> {
  state = { erro: false }
  static getDerivedStateFromError() {
    return { erro: true }
  }
  render() {
    return this.state.erro ? null : this.props.children
  }
}

// a altura muda com o zoom do navegador (DPR): a faixa acompanha
function assinarDpr(avisar: () => void) {
  window.addEventListener('resize', avisar)
  return () => window.removeEventListener('resize', avisar)
}
const lerDpr = () => window.devicePixelRatio || 1

export function RuaInicio({ k, bordas, className }: { k: number; bordas?: boolean; className?: string }) {
  const aberturaAtiva = useUI((s) => s.aberturaAtiva)
  const dpr = useSyncExternalStore(assinarDpr, lerDpr, () => 1)
  const [montar, setMontar] = useState(false)
  useEffect(() => {
    if (aberturaAtiva || montar) return
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setMontar(true), { timeout: 2500 })
      return () => w.cancelIdleCallback?.(id)
    }
    const t = setTimeout(() => setMontar(true), 1200)
    return () => clearTimeout(t)
  }, [aberturaAtiva, montar])
  return (
    <div className={`rua-vaga${className ? ` ${className}` : ''}`} style={{ height: alturaDaFaixa(k, dpr) }}>
      {montar && (
        <Guarda>
          <Suspense fallback={null}>
            <Rua k={k} bordas={bordas} />
          </Suspense>
        </Guarda>
      )}
    </div>
  )
}

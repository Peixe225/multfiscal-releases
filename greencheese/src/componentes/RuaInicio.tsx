import { Component, lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { alturaDaFaixa } from './rua/palco'
import { useRuaNoCelular } from '../store/loja'
import { useUI } from '../store/ui'
import { Icone } from './comum'
import './RuaInicio.css'

// A vaga da rua viva no Início: reserva a altura exata da faixa desde o primeiro quadro (zero pulo) e só baixa a rua
// (pedaço à parte, com o elenco montando num worker) depois da abertura. A primeira tela não paga nada por ela.
//   - computador (Hero.tsx, embaixo do perfil): baixa no primeiro respiro, porque ela está na primeira tela;
//   - celular (RuaCelular, no fim do Início, depois da grade): só quando a vaga chega perto da tela, rolando.

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

/** Quanto antes de a vaga entrar na tela o pedaço da rua começa a baixar (rolando para baixo, no celular). */
const FOLGA_PERTO = '0px 0px 120% 0px'

/** Espera o primeiro respiro do navegador (o computador) ou a vaga chegar perto da tela (o celular). */
function useMontar(vaga: RefObject<HTMLDivElement | null>, quando: 'respiro' | 'perto'): boolean {
  const aberturaAtiva = useUI((s) => s.aberturaAtiva)
  const [montar, setMontar] = useState(false)
  useEffect(() => {
    if (aberturaAtiva || montar) return
    if (quando === 'perto') {
      const el = vaga.current
      if (!el) return
      if (typeof IntersectionObserver === 'undefined') {
        setMontar(true)
        return
      }
      // a vista escondida (outra aba) conta como fora da tela: só baixa com o Início à vista
      const io = new IntersectionObserver(([e]) => e.isIntersecting && setMontar(true), { rootMargin: FOLGA_PERTO })
      io.observe(el)
      return () => io.disconnect()
    }
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setMontar(true), { timeout: 2500 })
      return () => w.cancelIdleCallback?.(id)
    }
    const t = setTimeout(() => setMontar(true), 1200)
    return () => clearTimeout(t)
  }, [aberturaAtiva, montar, quando, vaga])
  return montar
}

export function RuaInicio({ k, bordas, className, quando = 'respiro' }: { k: number; bordas?: boolean; className?: string; quando?: 'respiro' | 'perto' }) {
  const dpr = useSyncExternalStore(assinarDpr, lerDpr, () => 1)
  const vaga = useRef<HTMLDivElement>(null)
  const montar = useMontar(vaga, quando)
  return (
    <div ref={vaga} className={`rua-vaga${className ? ` ${className}` : ''}`} style={{ height: alturaDaFaixa(k, dpr) }}>
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

const CELULAR = '(max-width: 899px)'
function assinarCelular(avisar: () => void) {
  try {
    const q = window.matchMedia(CELULAR)
    q.addEventListener('change', avisar)
    return () => q.removeEventListener('change', avisar)
  } catch {
    return () => {}
  }
}
const lerCelular = () => {
  try {
    return window.matchMedia(CELULAR).matches
  } catch {
    return false
  }
}

/**
 * A rua no fim do Início do celular, depois da grade e antes do rodapé (pedido do Ian em 09/10): faixa de ponta a ponta,
 * a 2 px por pixel da arte, com um título pequeno em cima. No computador ela mora no hero, embaixo do perfil. O dono
 * desliga no painel (Stories do Início, a chave `ruaNoStory` da loja): desligada, o celular fica sem a rua.
 */
export function RuaCelular() {
  const celular = useSyncExternalStore(assinarCelular, lerCelular, () => false)
  const ligada = useRuaNoCelular()
  if (!celular || !ligada) return null
  return (
    <section className="rua-fim" aria-labelledby="rua-fim-titulo">
      <h2 id="rua-fim-titulo" className="rua-fim-titulo">
        <Icone nome="pin" tamanho={16} />
        Na rua da loja
      </h2>
      <RuaInicio k={2} className="rua-celular" quando="perto" />
    </section>
  )
}

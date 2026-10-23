/**
 * Pedaço opcional do site (src/site) carregado sob demanda, sem poder derrubar a tela em volta.
 *
 *   const SalvarNaConta = import.meta.env.VITE_SITE === '1' ? lazySite('SalvarNaConta', () => import('@/site/SalvarNaConta')) : null
 *   <SalvarNaConta careerId={id} finished />                 // sem rede: some (null), sem erro na tela
 *   <MinhaConta aoFalhar={() => …} />                        // quem usa fica sabendo (ex.: fecha o diálogo)
 *   precarregarSite('MinhaConta', () => import('./MinhaConta'))
 *
 * A nova tentativa é a dos pedaços do jogo (./pedacos.ts): sem conexão o arquivo nem é pedido (o navegador
 * guardaria a falha até recarregar a página); depois de uma falha, um lazy novo busca o arquivo de novo (com as
 * folhas de estilo que não vieram e "?tentativa=…"). Com o componente já montado, tenta de novo quando a internet
 * volta (evento "online"). A mesma `chave` em vários lugares (e na pré-carga) divide esse estado: uma pré-carga
 * que falhou já faz o primeiro uso buscar o arquivo de novo.
 */
import { Component, Suspense, useEffect, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react'
import { pedaco, type Pedaco } from './pedacos'

type Carregar<P> = () => Promise<{ default: ComponentType<P> }>

const estados = new Map<string, Pedaco<object>>()

function estadoDe<P extends object>(chave: string, carregar: Carregar<P>): Pedaco<P> {
  const ja = estados.get(chave) as Pedaco<P> | undefined
  if (ja) return ja
  const e = pedaco<P>(carregar, chave)
  estados.set(chave, e as unknown as Pedaco<object>)
  return e
}

/** Baixa o pedaço sem montar nada; se falhar, o próximo uso já busca de novo. Sem conexão agora, não tenta. */
export function precarregarSite<P extends object>(chave: string, carregar: Carregar<P>): void {
  estadoDe(chave, carregar).precarregar()
}

class Barreira extends Component<{ aoFalhar: (e: unknown) => void; children: ReactNode }, { falhou: boolean }> {
  state = { falhou: false }
  static getDerivedStateFromError() {
    return { falhou: true }
  }
  componentDidCatch(e: unknown, info: ErrorInfo) {
    console.warn('[LENDA] pedaço do site não carregou', e, info.componentStack)
    this.props.aoFalhar(e)
  }
  render() {
    return this.state.falhou ? null : this.props.children
  }
}

export type PropsSite<P> = P & { aoFalhar?: (e: unknown) => void }

export function lazySite<P extends object>(chave: string, carregar: Carregar<P>, o: { aoFalhar?: (e: unknown) => void } = {}): ComponentType<PropsSite<P>> {
  const estado = estadoDe(chave, carregar)
  function LazySite({ aoFalhar, ...props }: PropsSite<P>) {
    const [C, setC] = useState(() => estado.atual)
    const [caiu, setCaiu] = useState(false)
    const [vez, setVez] = useState(0)
    useEffect(() => {
      if (!caiu || typeof window === 'undefined') return
      const voltar = () => {
        setC(() => estado.atual)
        setCaiu(false)
        setVez((n) => n + 1)
      }
      window.addEventListener('online', voltar)
      return () => window.removeEventListener('online', voltar)
    }, [caiu])
    if (caiu) return null
    return (
      <Barreira
        key={vez}
        aoFalhar={(e) => {
          // um lazy novo só uma vez por falha (várias cópias montadas caem juntas: o pedaço confere de qual veio)
          estado.falhou(e)
          setCaiu(true)
          o.aoFalhar?.(e)
          aoFalhar?.(e)
        }}
      >
        <Suspense fallback={null}>
          <C {...(props as unknown as P)} />
        </Suspense>
      </Barreira>
    )
  }
  return LazySite
}

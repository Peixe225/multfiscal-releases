/**
 * Pedaço opcional do site (src/site) carregado sob demanda, sem poder derrubar a tela em volta.
 *
 *   const SalvarNaConta = import.meta.env.VITE_SITE === '1' ? lazySite('SalvarNaConta', () => import('@/site/SalvarNaConta')) : null
 *   <SalvarNaConta careerId={id} finished />                 // sem rede: some (null), sem erro na tela
 *   <MinhaConta aoFalhar={() => …} />                        // quem usa fica sabendo (ex.: fecha o diálogo)
 *   precarregarSite('MinhaConta', () => import('./MinhaConta'))
 *
 * O React.lazy guarda a rejeição para sempre: depois de uma falha, o próximo uso ganha um lazy novo. E o
 * navegador guarda a falha do import() por endereço até recarregar a página: o lazy novo busca o mesmo arquivo
 * com "?tentativa=…" (o endereço vem da mensagem de erro; o Chrome e o Firefox o põem, o Safari não — lá tenta
 * o import() de novo). Com o componente já montado, tenta de novo quando a internet volta (evento "online").
 * A mesma `chave` em vários lugares (e na pré-carga) divide esse estado: uma pré-carga que falhou já faz o
 * primeiro uso buscar o arquivo de novo.
 */
import { Component, Suspense, lazy, useEffect, useState, type ComponentType, type ErrorInfo, type LazyExoticComponent, type ReactNode } from 'react'

type Carregar<P> = () => Promise<{ default: ComponentType<P> }>

interface Estado<P> {
  carregar: Carregar<P>
  atual: LazyExoticComponent<ComponentType<P>>
  /** Endereço do arquivo, tirado de uma falha. */
  endereco: string | null
}

const estados = new Map<string, Estado<object>>()

function estadoDe<P extends object>(chave: string, carregar: Carregar<P>): Estado<P> {
  const ja = estados.get(chave) as Estado<P> | undefined
  if (ja) return ja
  const e: Estado<P> = { carregar, atual: lazy(carregar), endereco: null }
  estados.set(chave, e as unknown as Estado<object>)
  return e
}

/** Endereço do pedaço que não veio, tirado da mensagem do navegador (só do próprio site). */
function enderecoDaFalha(e: unknown): string | null {
  const m = /(https?:\/\/[^\s'"?#]+?\.js)\b/.exec(String((e as { message?: unknown } | null)?.message ?? ''))
  if (!m || typeof location === 'undefined') return null
  try {
    return new URL(m[1]).origin === location.origin ? m[1] : null
  } catch {
    return null
  }
}

/** Depois de uma falha: lazy novo, direto no arquivo (sem o pré-carregamento do Vite, cuja falha faria o main.tsx recarregar a página). */
function falhou<P extends object>(e: Estado<P>, erro: unknown) {
  e.endereco = enderecoDaFalha(erro) ?? e.endereco
  e.atual = lazy(() => {
    if (!e.endereco) return e.carregar()
    const u = `${e.endereco}?tentativa=${Date.now()}`
    return import(/* @vite-ignore */ u) as Promise<{ default: ComponentType<P> }>
  })
}

/** Baixa o pedaço sem montar nada; se falhar, o próximo uso já busca de novo. */
export function precarregarSite<P extends object>(chave: string, carregar: Carregar<P>): void {
  const e = estadoDe(chave, carregar)
  const meu = e.atual
  carregar().catch((erro: unknown) => {
    if (e.atual === meu) falhou(e, erro)
  })
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
          // um lazy novo só uma vez por falha (várias cópias montadas caem juntas)
          if (C === estado.atual) falhou(estado, e)
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

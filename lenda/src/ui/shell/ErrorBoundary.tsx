import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Changing this resets the boundary (e.g. the route path). */
  resetKey?: unknown
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[LENDA] erro na tela', error, info.componentStack)
  }
  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="relative z-[1] flex-1 grid place-items-center px-4 py-10">
        <div className="lx-glass p-6 max-w-[460px] w-full rounded-[22px]" role="alert">
          <div className="flex items-center gap-3">
            <span className="grid place-items-center w-11 h-11 rounded-md bg-negative-bg text-negative flex-none">
              <TriangleAlert size={20} aria-hidden />
            </span>
            <h1 className="font-display text-[20px] font-extrabold tracking-[-0.02em] m-0">Algo deu errado nesta tela</h1>
          </div>
          <p className="text-[13px] text-text-2 mt-3 mb-0 break-words">{this.state.error.message}</p>
          <div className="flex gap-2.5 mt-5">
            <button type="button" className="lx-btn lx-btn--primary lx-btn--md" onClick={() => this.setState({ error: null })}>
              <RotateCcw aria-hidden /> Tentar de novo
            </button>
            <a className="lx-btn lx-btn--ghost lx-btn--md" href="#/">
              Início
            </a>
          </div>
        </div>
      </main>
    )
  }
}

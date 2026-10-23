/**
 * A tela da rota caiu. Duas conversas diferentes com quem joga:
 *  - o arquivo da tela não veio (sem internet, 4G que caiu): "Sem conexão…" + Tentar de novo. Tenta sozinho
 *    quando a internet volta (evento "online"). Se a nova tentativa falhar COM a internet de volta (o navegador
 *    guardou a falha de um arquivo até recarregar), confere a conexão e recarrega a página — a carreira está
 *    salva no aparelho. No máximo uma recarga por minuto (depois, um botão "Recarregar");
 *  - um erro de código: "Algo deu errado nesta tela", sem a mensagem técnica (ela fica no console; o admin
 *    vê com `debug`).
 *
 * `aoFalharCarga(erro)`: quem monta a tela marca o pedaço como falho (o próximo lazy busca de novo).
 * `aoTentarDeNovo()`: quem monta a tela desenha de novo com o lazy novo (as children vêm de lá).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw, TriangleAlert, WifiOff } from 'lucide-react'
import { ehFalhaDeCarga, internetVoltou, semConexaoAgora } from './pedacos'

interface Props {
  children: ReactNode
  /** Changing this resets the boundary (e.g. the route path). */
  resetKey?: unknown
  /** Mostrar a mensagem técnica do erro (só o admin). */
  debug?: boolean
  aoFalharCarga?: (erro: unknown) => void
  aoTentarDeNovo?: () => void
}
interface State {
  error: Error | null
  /** Conferindo a internet antes de recarregar a página. */
  conferindo: boolean
  /** Já recarregou há pouco: a pessoa decide (botão "Recarregar"). */
  pedirRecarga: boolean
}

const RECARGA_KEY = 'lenda:recarregou-tela'
const RECARGA_INTERVALO_MS = 60_000

/** Pode recarregar a página agora (no máximo uma vez por minuto nesta aba)? Marca a recarga. */
export function podeRecarregarAgora(agora = Date.now(), ss: Pick<Storage, 'getItem' | 'setItem'> | null = typeof sessionStorage !== 'undefined' ? sessionStorage : null): boolean {
  try {
    if (!ss) return false
    const antes = Number(ss.getItem(RECARGA_KEY) || 0)
    if (antes && agora - antes < RECARGA_INTERVALO_MS && agora >= antes) return false
    ss.setItem(RECARGA_KEY, String(agora))
    return true
  } catch {
    return false
  }
}

/** O erro é de "o arquivo da tela não veio" (ou o aparelho está sem rede)? */
export const ehErroDeConexao = (e: unknown) => ehFalhaDeCarga(e) || semConexaoAgora()

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, conferindo: false, pedirRecarga: false }
  /** A última nova tentativa foi feita com a internet de volta. */
  private tentouComRede = false
  private aoVoltarRede: (() => void) | null = null
  private timer = 0

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    if (!ehErroDeConexao(error)) {
      console.error('[LENDA] erro na tela', error, info.componentStack)
      return
    }
    // sem rede não é bug: aviso no console (a tela fala com a pessoa)
    console.warn('[LENDA] a tela não veio (rede)', error.message)
    this.props.aoFalharCarga?.(error)
    if (this.tentouComRede && !semConexaoAgora()) void this.recarregarSePuder()
    this.ouvirRede()
  }
  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey) {
      this.tentouComRede = false
      if (this.state.error) this.setState({ error: null, conferindo: false, pedirRecarga: false })
    }
    if (!this.state.error) this.pararDeOuvir()
  }
  componentWillUnmount() {
    this.pararDeOuvir()
  }

  private ouvirRede() {
    if (this.aoVoltarRede || typeof window === 'undefined') return
    // a interface volta antes da internet: espera um pouco antes de tentar
    this.aoVoltarRede = () => {
      clearTimeout(this.timer)
      this.timer = window.setTimeout(() => this.state.error && this.tentar(), 800)
    }
    window.addEventListener('online', this.aoVoltarRede)
  }
  private pararDeOuvir() {
    if (this.aoVoltarRede) window.removeEventListener('online', this.aoVoltarRede)
    this.aoVoltarRede = null
    clearTimeout(this.timer)
  }

  private tentar = () => {
    this.tentouComRede = !semConexaoAgora()
    this.props.aoTentarDeNovo?.()
    this.setState({ error: null, conferindo: false, pedirRecarga: false })
  }

  private async recarregarSePuder() {
    this.setState({ conferindo: true })
    const ok = await internetVoltou()
    if (ok && podeRecarregarAgora()) {
      document.getElementById('root')?.style.setProperty('visibility', 'hidden')
      location.reload()
      return
    }
    this.setState({ conferindo: false, pedirRecarga: ok })
  }

  render() {
    const { error, conferindo, pedirRecarga } = this.state
    if (!error) return this.props.children
    const conexao = ehErroDeConexao(error)
    const titulo = pedirRecarga ? 'Não deu para abrir esta tela' : conexao ? 'Sem conexão' : 'Algo deu errado nesta tela'
    const texto = pedirRecarga
      ? 'A internet voltou, mas esta tela não terminou de baixar. Recarregue a página: a sua carreira está salva neste aparelho.'
      : conexao
        ? 'Sem conexão: não deu para abrir esta tela. Confira a internet e toque em Tentar de novo.'
        : 'Toque em Tentar de novo. Se continuar, volte ao início: a sua carreira está salva neste aparelho.'
    const Ico = conexao ? WifiOff : TriangleAlert
    return (
      <main className="relative z-[1] flex-1 grid place-items-center px-4 py-10">
        <div className="lx-glass p-6 max-w-[460px] w-full rounded-[22px]" role="alert">
          <div className="flex items-center gap-3">
            <span className="grid place-items-center w-11 h-11 rounded-md bg-negative-bg text-negative flex-none">
              <Ico size={20} aria-hidden />
            </span>
            <h1 className="font-display text-[20px] font-extrabold tracking-[-0.02em] m-0">{titulo}</h1>
          </div>
          <p className="text-[14px] text-text-2 mt-3 mb-0 leading-relaxed">{conferindo ? 'Conferindo a conexão…' : texto}</p>
          {this.props.debug && <p className="text-[12px] text-text-3 mt-2 mb-0 break-words font-mono">{error.message}</p>}
          <div className="flex gap-2.5 mt-5 flex-wrap">
            {pedirRecarga ? (
              <button type="button" className="lx-btn lx-btn--primary lx-btn--md" onClick={() => location.reload()}>
                <RotateCcw aria-hidden /> Recarregar
              </button>
            ) : (
              <button type="button" className="lx-btn lx-btn--primary lx-btn--md" disabled={conferindo} onClick={this.tentar}>
                <RotateCcw aria-hidden /> Tentar de novo
              </button>
            )}
            <a className="lx-btn lx-btn--ghost lx-btn--md" href="#/">
              Início
            </a>
          </div>
        </div>
      </main>
    )
  }
}

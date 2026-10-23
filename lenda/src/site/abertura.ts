/**
 * A abertura do jogo no celular (4G lento, v3.5): o que é do site e não é a primeira tela espera o jogo aparecer e o
 * navegador sossegar, e o "Sem conexão" dos diálogos só vale para falha de rede (um erro de JS ganha outra mensagem).
 *
 *   const parar = depoisDaAbertura(() => precarregar())   // dados do jogo prontos + a tela pintou + ocioso (ou 1 s)
 *   economizandoDados()                                    // o aparelho pediu para economizar dados (saveData)
 *   ehFalhaDeRede(erro)                                    // o import()/CSS não veio ou o aparelho está sem rede?
 */
import { useData } from '@/store/data'

type Ocioso = (cb: () => void, o?: { timeout: number }) => number

export interface OpcoesAbertura {
  /** Os dados do jogo já carregaram (padrão: useData pronto). */
  dadosProntos?: () => boolean
  /** A tela do jogo já está desenhada, sem o esqueleto de "Carregando" (padrão: telaDoJogoPintou). */
  telaPintou?: () => boolean
  /** Sem requestIdleCallback (Safari): espera isto depois de a tela pintar. */
  reservaMs?: number
  /** Com requestIdleCallback: o máximo que espera o navegador sossegar. */
  ociosoMaxMs?: number
  /** Desiste de esperar a tela (os dados falharam, por exemplo) e roda assim mesmo depois disto. */
  tetoMs?: number
}

/** A tela da rota já está desenhada (a .lx-page existe e não é o esqueleto de "Carregando" do Suspense). */
export function telaDoJogoPintou(doc: Pick<Document, 'querySelector'> | undefined = typeof document !== 'undefined' ? document : undefined): boolean {
  if (!doc) return false
  return !!doc.querySelector('.lx-page') && !doc.querySelector('.lx-page > [aria-busy="true"]')
}

/**
 * Roda `fn` uma vez, depois que os dados do jogo carregaram, a tela pintou e o navegador ficou ocioso (requestIdleCallback;
 * sem ele, `reservaMs`). Devolve o cancelar.
 */
export function depoisDaAbertura(fn: () => void, o: OpcoesAbertura = {}): () => void {
  if (typeof window === 'undefined') return () => {}
  const dadosProntos = o.dadosProntos ?? (() => useData.getState().status === 'ready')
  const telaPintou = o.telaPintou ?? (() => telaDoJogoPintou())
  const reserva = o.reservaMs ?? 1000
  const teto = o.tetoMs ?? 15_000
  const ric = (window as Window & { requestIdleCallback?: Ocioso }).requestIdleCallback
  const cancelarRic = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback
  const t0 = Date.now()
  let feito = false
  let timer = 0
  let idle = 0
  const rodar = () => {
    if (feito) return
    feito = true
    fn()
  }
  const conferir = () => {
    if (feito) return
    if ((dadosProntos() && telaPintou()) || Date.now() - t0 >= teto) {
      if (ric) idle = ric(rodar, { timeout: o.ociosoMaxMs ?? 3000 })
      else timer = window.setTimeout(rodar, reserva)
      return
    }
    timer = window.setTimeout(conferir, 200)
  }
  conferir()
  return () => {
    feito = true
    window.clearTimeout(timer)
    if (idle && cancelarRic) cancelarRic(idle)
  }
}

/** O aparelho pediu para economizar dados (Chrome do Android com "Economia de dados", navigator.connection.saveData). */
export function economizandoDados(nav: Navigator | undefined = typeof navigator !== 'undefined' ? navigator : undefined): boolean {
  return !!(nav as (Navigator & { connection?: { saveData?: boolean } }) | undefined)?.connection?.saveData
}

/**
 * As mensagens de quando o pedaço do site não veio pela rede: Chrome ("Failed to fetch dynamically imported module"),
 * Safari ("Importing a module script failed", "Load failed"), Firefox ("error loading dynamically imported module"), o
 * pré-carregamento do Vite ("Unable to preload CSS") e os nomes de erro de chunk.
 */
const FALHA_DE_REDE = /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|unable to preload css|loading (css )?chunk|chunkloaderror|networkerror|load failed|failed to fetch/i

/** Falha de rede (o import()/CSS não veio, ou o aparelho está offline) × erro de JS ao desenhar (um bug: outra mensagem). */
export function ehFalhaDeRede(e: unknown, online: boolean = typeof navigator === 'undefined' || navigator.onLine !== false): boolean {
  if (!online) return true
  if (e == null) return false
  const o = e as { name?: unknown; message?: unknown }
  const msg = typeof e === 'string' ? e : `${typeof o.name === 'string' ? o.name : ''}: ${typeof o.message === 'string' ? o.message : ''}`
  return FALHA_DE_REDE.test(msg)
}

/** O começo da mensagem de um erro, para a medição (até 64 letras, sem quebras de linha). */
export function resumoDoErro(e: unknown): string {
  const o = e as { name?: unknown; message?: unknown } | null
  const msg = typeof e === 'string' ? e : o && typeof o.message === 'string' ? `${typeof o.name === 'string' && o.name !== 'Error' ? `${o.name}: ` : ''}${o.message}` : String(e)
  return msg.replace(/\s+/g, ' ').trim().slice(0, 64)
}

// Folha do painel: a mesma do site (preto, canto em degrau, fio cinza; cortina em screen-door), embaixo no celular
// e no meio no computador. Diálogo de verdade: foco preso dentro, Esc fecha, o foco volta pra quem abriu, a página
// de trás não rola, e o voltar do Android fecha a folha (ela entra no histórico).
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { depoisDaVolta, tirarFolhaDoHistorico } from './rotas'
import { Ic } from './ui'

let contador = 0
const abertas: string[] = []
function focaveis(raiz: HTMLElement): HTMLElement[] {
  return Array.from(
    raiz.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  ).filter((el) => el.offsetParent !== null || el === document.activeElement)
}

interface Props {
  aberta: boolean
  aoFechar: () => void
  titulo: ReactNode
  /** Texto curto embaixo do título. */
  sub?: ReactNode
  children: ReactNode
  /** Fica fixo no pé da folha (os botões). */
  rodape?: ReactNode
  /** Larga no computador (listas). */
  larga?: boolean
  /** Enquanto trabalha (salvando), não fecha por fora nem pelo Esc. */
  preso?: boolean
  /** Quem recebe o foco ao abrir (senão, o título). */
  focoInicial?: React.RefObject<HTMLElement | null>
  /** Papel do diálogo: alertdialog nas confirmações. */
  papel?: 'dialog' | 'alertdialog'
  /** Sem o X (a folha só sai pelo que está nela). */
  semFechar?: boolean
  /** Classe a mais na folha (o Estúdio do produto, que ocupa mais espaço). */
  className?: string
  /**
   * O passo da folha que tem mais de um (escolher → confirmar): quando troca, o conteúdo é outro e o foco vai de novo
   * pro `focoInicial` (ou o título), como ao abrir. Sem isso o foco ficava no botão que o React reaproveitou no rodapé,
   * e um segundo Enter fazia outra coisa (revisão de 22/10).
   */
  passo?: string
}

export function Folha(props: Props) {
  if (!props.aberta) return null
  return createPortal(<FolhaAberta {...props} />, document.body)
}

function FolhaAberta({ aoFechar, titulo, sub, children, rodape, larga, preso, focoInicial, papel = 'dialog', semFechar, className, passo }: Props) {
  const idTitulo = useId()
  const idSub = useId()
  const ref = useRef<HTMLDivElement>(null)
  const tituloRef = useRef<HTMLHeadingElement>(null)
  const meu = useRef(`f${++contador}`)
  const fechar = useRef(aoFechar)
  fechar.current = aoFechar
  const presoRef = useRef(preso)
  presoRef.current = preso

  useEffect(() => {
    const id = meu.current
    const antes = document.activeElement as HTMLElement | null
    abertas.push(id)
    document.documentElement.classList.add('pn-travado')
    const aoVoltar = () => {
      if ((history.state as { folha?: string } | null)?.folha !== id) fechar.current()
    }
    let vivo = true
    // outra folha acabou de fechar e o voltar dela ainda não veio: entra no histórico depois dele
    const entrar = () => {
      if (!vivo) return
      history.pushState({ ...(history.state ?? {}), folha: id }, '', location.href)
      window.addEventListener('popstate', aoVoltar)
    }
    const pendente = depoisDaVolta()
    if (pendente) void pendente.then(entrar)
    else entrar()
    ;(focoInicial?.current ?? tituloRef.current)?.focus({ preventScroll: true })
    return () => {
      vivo = false
      window.removeEventListener('popstate', aoVoltar)
      abertas.splice(abertas.indexOf(id), 1)
      if (!abertas.length) document.documentElement.classList.remove('pn-travado')
      // fechou pelo botão (ou terminou a ação): tira a entrada da folha do histórico
      if ((history.state as { folha?: string } | null)?.folha === id) tirarFolhaDoHistorico()
      if (antes && document.contains(antes)) antes.focus({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // trocou de passo: o foco vai pro começo do passo novo (o leitor de tela lê o título dele)
  const passoVisto = useRef(passo)
  useEffect(() => {
    if (passoVisto.current === passo) return
    passoVisto.current = passo
    ;(focoInicial?.current ?? tituloRef.current)?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passo])

  const aoTeclar = (e: React.KeyboardEvent) => {
    if (abertas[abertas.length - 1] !== meu.current) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      if (!presoRef.current) fechar.current()
      return
    }
    if (e.key !== 'Tab' || !ref.current) return
    const lista = focaveis(ref.current)
    if (!lista.length) return
    const primeiro = lista[0]
    const ultimo = lista[lista.length - 1]
    if (e.shiftKey && (document.activeElement === primeiro || document.activeElement === tituloRef.current)) {
      e.preventDefault()
      ultimo.focus()
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault()
      primeiro.focus()
    }
  }

  return (
    <div className="pn-folha-raiz" onKeyDown={aoTeclar}>
      <div className="cortina" aria-hidden="true" onClick={() => !presoRef.current && fechar.current()} />
      <div
        ref={ref}
        className={`folha degrau-topo pn-folha${larga ? ' pn-folha-larga' : ''}${className ? ` ${className}` : ''}`}
        role={papel}
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={sub ? idSub : undefined}
      >
        <div className="folha-alca" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="folha-topo pn-folha-topo">
          <div className="pn-folha-cab">
            <h2 id={idTitulo} ref={tituloRef} tabIndex={-1} className="folha-titulo pn-folha-titulo">
              {titulo}
            </h2>
            {sub && (
              <p id={idSub} className="pn-folha-sub">
                {sub}
              </p>
            )}
          </div>
          {!semFechar && (
            <button type="button" className="icone-botao pn-x" onClick={() => !presoRef.current && fechar.current()} aria-label="Fechar" aria-disabled={preso || undefined}>
              <Ic nome="fechar" tamanho={16} />
            </button>
          )}
        </div>
        <div className="folha-corpo pn-folha-corpo">{children}</div>
        {rodape && <div className="folha-rodape pn-folha-rodape">{rodape}</div>}
      </div>
    </div>
  )
}

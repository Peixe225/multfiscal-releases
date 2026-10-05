import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as KeyboardEventReact, type ReactNode } from 'react'
import { gsap } from 'gsap'
import { canalDa } from '../dados/canais'
import { Avatar, Icone } from '../componentes/comum'
import { folhaDoTopo } from '../componentes/Folha'
import { useConta, marcarVisto } from '../lib/conta'
import { prenderTab } from '../lib/foco'
import { useCamadaNoHistorico } from '../lib/historico'
import { ehDesktop, movimentoReduzido } from '../lib/movimento'
import { liberarRolagem, travarRolagem } from '../lib/rolagem'
import { atualizarParametros } from '../lib/url'
import { useLocal } from '../store/local'
import { useUI } from '../store/ui'
import type { Interativo } from './registro'
import './interativos.css'

// Casca da "aba" de um interativo, no molde da página do produto: tela cheia que entra pela direita no celular,
// diálogo sobre a cortina pontilhada no desktop. Cuida do histórico (voltar do Android e Esc, com uma 2ª entrada
// quando o jogo abre uma subtela como o cadastro), do foco (entra no h2 do jogo, Tab preso, volta pra quem abriu),
// da rolagem travada atrás e do ?jogo= na URL. O jogo vem dentro (children) e fala com a casca pelo contexto.

interface ContextoCasca {
  /** Onde o jogo põe o "cromo" de story (segmentos acima do topo). */
  cromo: HTMLElement | null
  /** O jogo abriu uma subtela (cadastro): o voltar e o Esc chamam `voltar` em vez de fechar. null = sem subtela. */
  definirSubtela: (voltar: (() => void) | null) => void
  fechar: () => void
  /** O corpo que rola (para "rola a coluna pro topo"). */
  corpo: HTMLElement | null
}

const Contexto = createContext<ContextoCasca>({ cromo: null, definirSubtela: () => {}, fechar: () => {}, corpo: null })

export function useCasca(): ContextoCasca {
  return useContext(Contexto)
}

/** Seletor do alvo de foco do jogo (o h2 da fase atual, tabIndex -1). */
export const FOCO_JOGO = '[data-foco-jogo]'

interface Props {
  interativo: Interativo
  aberto: boolean
  aoFechar: () => void
  /** A saída terminou: pode desmontar. */
  aoSair: () => void
  children: ReactNode
}

export function CascaInterativo({ interativo, aberto, aoFechar, aoSair, children }: Props) {
  const raiz = useRef<HTMLDivElement>(null)
  const janela = useRef<HTMLDivElement>(null)
  const cortina = useRef<HTMLDivElement>(null)
  const [cromo, setCromo] = useState<HTMLElement | null>(null)
  const [corpo, setCorpo] = useState<HTMLElement | null>(null)
  const [subtela, setSubtela] = useState<{ voltar: () => void } | null>(null)
  const voltarFoco = useRef<HTMLElement | null>(null)
  const conta = useConta()
  const uf = useLocal((s) => s.uf)
  const instagram = canalDa(uf)?.instagram ?? null
  const setConta = useUI((s) => s.setConta)
  const fecharRef = useRef(aoFechar)
  fecharRef.current = aoFechar
  const subRef = useRef(subtela)
  subRef.current = subtela

  const definirSubtela = useCallback((voltar: (() => void) | null) => setSubtela(voltar ? { voltar } : null), [])

  // histórico: a camada e, por cima, a subtela (cadastro/entrar) — o voltar desce um nível de cada vez
  useCamadaNoHistorico(aberto, `interativo-${interativo.id}`, aoFechar)
  useCamadaNoHistorico(aberto && !!subtela, `interativo-${interativo.id}-cadastro`, () => subRef.current?.voltar())

  // quem tinha o foco ao abrir (o foco volta pra ele) e "já visto" (some o selo "novo")
  useLayoutEffect(() => {
    if (!aberto) return
    const ativo = document.activeElement
    voltarFoco.current = ativo instanceof HTMLElement && ativo !== document.body ? ativo : voltarFoco.current
    marcarVisto(interativo.id)
  }, [aberto, interativo.id])

  // ?jogo=<param> enquanto aberta (a volta do histórico é acertada no módulo da camada, ver Interativo.tsx)
  useEffect(() => {
    atualizarParametros({ jogo: aberto ? interativo.param : null })
  }, [aberto, interativo.param])

  // rolagem da página travada atrás; as animações em loop da página (chiado, cursor, mercador) param por trás
  useEffect(() => {
    if (!aberto) return
    travarRolagem()
    document.documentElement.classList.add('com-casca')
    return () => {
      liberarRolagem()
      document.documentElement.classList.remove('com-casca')
    }
  }, [aberto])

  // entrada e saída (voz app, só transform/opacity; movimento reduzido = corte)
  useLayoutEffect(() => {
    const j = janela.current
    const c = cortina.current
    if (!j) return
    const reduz = movimentoReduzido()
    const desk = ehDesktop()
    if (aberto) {
      gsap.killTweensOf([j, c])
      if (reduz) gsap.set([j, c].filter(Boolean), { clearProps: 'transform,opacity' })
      else if (desk) {
        gsap.fromTo(j, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.2, ease: 'power3.out', clearProps: 'transform,opacity' })
        if (c) gsap.fromTo(c, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'none' })
      } else gsap.fromTo(j, { xPercent: 100 }, { xPercent: 0, duration: 0.26, ease: 'power3.out', clearProps: 'transform' })
      // foco no h2 do jogo (ou na janela, enquanto o jogo baixa)
      const raf = requestAnimationFrame(() => (j.querySelector<HTMLElement>(FOCO_JOGO) ?? j).focus({ preventScroll: true }))
      return () => cancelAnimationFrame(raf)
    }
    const fim = () => {
      const volta = voltarFoco.current
      // a saída pode ter aberto uma folha ("Usar agora" → sacola): o foco fica nela
      if (volta?.isConnected && !folhaDoTopo()) volta.focus({ preventScroll: true })
      aoSair()
    }
    if (reduz) {
      fim()
      return
    }
    const tl = gsap.timeline({ onComplete: fim })
    if (desk) {
      tl.to(j, { opacity: 0, y: 16, duration: 0.2, ease: 'power3.in' }, 0)
      if (c) tl.to(c, { opacity: 0, duration: 0.2, ease: 'none' }, 0)
    } else tl.to(j, { xPercent: 100, duration: 0.24, ease: 'power3.in' }, 0)
    return () => {
      tl.kill()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto])

  // Esc: a folha de cima ou a página do produto por cima cuidam do delas; na subtela, volta; senão, fecha
  useEffect(() => {
    if (!aberto) return
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.querySelector('.folha') || document.querySelector('.pp:not(.pp-saindo)')) return
      e.preventDefault()
      e.stopPropagation()
      if (subRef.current) subRef.current.voltar()
      else fecharRef.current()
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [aberto])

  // foco que escapa pra página por trás volta pro h2 do jogo (com folha ou página do produto por cima, elas cuidam)
  useEffect(() => {
    if (!aberto) return
    const guarda = (e: FocusEvent) => {
      const r = raiz.current
      const alvo = e.target
      if (!r || !(alvo instanceof Element) || r.contains(alvo)) return
      if (alvo.closest('.folha, .pp') || document.querySelector('.folha') || document.querySelector('.pp:not(.pp-saindo)')) return
      ;(r.querySelector<HTMLElement>(FOCO_JOGO) ?? janela.current)?.focus({ preventScroll: true })
    }
    document.addEventListener('focusin', guarda)
    return () => document.removeEventListener('focusin', guarda)
  }, [aberto])

  // Tab preso na casca; com uma folha por cima, o foco que ficou aqui vai pra ela
  const prender = (e: KeyboardEventReact<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const folha = folhaDoTopo()
    if (folha) {
      e.preventDefault()
      folha.focus()
      return
    }
    prenderTab(e, janela.current)
  }

  // valor estável: o jogo registra a subtela num efeito que depende dele (objeto novo a cada render = laço)
  const contexto = useMemo(() => ({ cromo, definirSubtela, fechar: aoFechar, corpo }), [cromo, definirSubtela, aoFechar, corpo])

  return (
    <div ref={raiz} className={`casca${aberto ? '' : ' casca-saindo'}`} role="dialog" aria-modal="true" aria-label={interativo.titulo} onKeyDown={prender} data-lenis-prevent>
      <div ref={cortina} className="casca-cortina cortina" onClick={aoFechar} onMouseDown={(e) => e.preventDefault()} aria-hidden="true" />
      <div ref={janela} className="casca-janela" tabIndex={-1}>
        <div ref={setCromo} className="casca-cromo" />
        <header className="casca-topo">
          <button type="button" className="icone-botao toque casca-voltar" onClick={aoFechar} aria-label="Voltar">
            <Icone nome="chevron-esq" tamanho={32} />
          </button>
          <p className="casca-loja">
            <Avatar tamanho={28} />
            <span className="casca-loja-txt">
              <strong>{interativo.titulo}</strong>
              <span className="legenda">interativo · {instagram ? `@${instagram}` : 'Green Cheese'}</span>
            </span>
          </p>
          {conta && (
            <button type="button" className="icone-botao toque" onClick={() => setConta(true)} aria-label="Minha conta">
              <Icone nome="conta" tamanho={24} />
            </button>
          )}
          <button type="button" className="icone-botao toque casca-fechar" onClick={aoFechar} aria-label="Fechar">
            <Icone nome="fechar" tamanho={20} />
          </button>
        </header>
        <div ref={setCorpo} className="casca-corpo">
          <Contexto.Provider value={contexto}>{children}</Contexto.Provider>
        </div>
      </div>
    </div>
  )
}

/** Fallback enquanto o jogo baixa (Suspense). */
export function CarregandoJogo() {
  return (
    <p className="casca-carregando px px-16" role="status">
      carregando…
    </p>
  )
}
